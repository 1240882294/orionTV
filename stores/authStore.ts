import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "@/services/api";
import { LoginCredentialsManager } from "@/services/storage";
import { AccountProfileManager } from "@/services/accountProfiles";
import { isBootRunning } from "@/services/appSession";
import { useSettingsStore, getServerConfigPromise } from "./settingsStore";
import Toast from "react-native-toast-message";
import Logger from "@/utils/Logger";

const logger = Logger.withTag('AuthStore');

interface AuthState {
  isLoggedIn: boolean;
  isLoginModalVisible: boolean;
  showLoginModal: () => void;
  hideLoginModal: () => void;
  checkLoginStatus: (apiBaseUrl?: string) => Promise<void>;
  // 用已保存的用户名/密码自动重连会话；失败才弹登录框。
  restoreSession: () => Promise<void>;
  // 启动流程（bootStore）校验完成后回写结果，避免首页再次重复校验
  applyBootSession: (loggedIn: boolean) => void;
  logout: () => Promise<void>;
}

// 并发去重：多个请求同时 401 时只触发一次自动登录
let restorePromise: Promise<void> | null = null;

// 登录态校验结果的有效期：启动流程刚校验过，首页挂载时无需再跑一遍
// （否则冷启动会连续触发两次校验，失败时用户会看到两条一样的提示）
const VERIFY_REUSE_MS = 5000;
let lastVerifiedAt = 0;

const useAuthStore = create<AuthState>((set, get) => ({
  isLoggedIn: false,
  isLoginModalVisible: false,
  showLoginModal: () => set({ isLoginModalVisible: true }),
  hideLoginModal: () => set({ isLoginModalVisible: false }),
  checkLoginStatus: async (apiBaseUrl?: string) => {
    // 启动流程正在扫描/连接账号，首页挂载时不要再重复校验一遍
    // （重复校验会多打一轮请求，失败时还会重复弹「检查网络」）
    if (isBootRunning()) {
      return;
    }
    if (!apiBaseUrl) {
      set({ isLoggedIn: false, isLoginModalVisible: false });
      return;
    }
    // 刚校验过且仍是已登录状态，直接复用结果
    if (get().isLoggedIn && Date.now() - lastVerifiedAt < VERIFY_REUSE_MS) {
      return;
    }
    try {
      // 确保拿到服务器配置。冷启动时第一次 getServerConfig 请求常因网络栈未就绪而失败，
      // 因此最多重试几次（每次间隔短暂等待），拿到 StorageType 才继续；全部失败才提示。
      // 直接 await 真实请求（不用固定超时轮询），既处理"慢"也处理"第一次失败"。
      let serverConfig = useSettingsStore.getState().serverConfig;
      const maxAttempts = 3;
      for (let attempt = 0; attempt < maxAttempts && !serverConfig?.StorageType; attempt++) {
        if (attempt > 0) {
          // 重试前短暂等待，给冷启动的网络/服务器一点时间就绪
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        if (useSettingsStore.getState().isLoadingServerConfig) {
          // 已在加载：直接 await 正在进行的请求 Promise，等它真正完成
          const pending = getServerConfigPromise();
          if (pending) {
            await pending;
          }
        } else {
          // 尚未开始拉取（或上次失败）：主动拉取并等待结果
          await useSettingsStore.getState().fetchServerConfig();
        }
        serverConfig = useSettingsStore.getState().serverConfig;
      }

      if (!serverConfig?.StorageType) {
        // 到这里说明配置确实拉取失败（网络不通/地址错误/接口异常）
        Toast.show({ type: "error", text1: "请检查网络或者服务器地址是否可用" });
        return;
      }

      const authToken = await AsyncStorage.getItem('authCookies');
      if (!authToken || authToken.trim() === '') {
        if (serverConfig && serverConfig.StorageType === "localstorage") {
          const loginResult = await api.login().catch(() => {
            set({ isLoggedIn: false, isLoginModalVisible: true });
          });
          if (loginResult && loginResult.ok) {
            set({ isLoggedIn: true });
          }
        } else {
          // 非 localstorage：需要账号密码。优先用已保存凭据自动重新登录，
          // 会话超时(401)时也能静默续期，只有重登失败才弹登录框。
          await get().restoreSession();
        }
      } else {
        set({ isLoggedIn: true, isLoginModalVisible: false });
      }
    } catch (error) {
      logger.error("Failed to check login status:", error);
      if (error instanceof Error && error.message === "UNAUTHORIZED") {
        // 会话已过期：用保存的凭据尝试自动重连，失败再弹登录框。
        await get().restoreSession();
      } else {
        set({ isLoggedIn: false });
      }
    }
  },
  restoreSession: async () => {
    // 并发去重：多个 401 同时触发时只执行一次自动登录
    if (!restorePromise) {
      restorePromise = (async () => {
        const creds = await LoginCredentialsManager.get();
        if (!creds || !creds.username) {
          // 无可用凭据，需要用户手动登录。
          set({ isLoggedIn: false, isLoginModalVisible: true });
          return;
        }
        try {
          // 用保存的用户名/密码自动登录，服务器会在成功时刷新 authCookies。
          const result = await api.login(creds.username, creds.password);
          if (result && result.ok) {
            set({ isLoggedIn: true, isLoginModalVisible: false });
          } else {
            throw new Error("UNAUTHORIZED");
          }
        } catch (error) {
          // 自动登录失败，仍需用户手动输入。
          logger.warn("restoreSession auto-login failed, showing login modal.", error);
          await AsyncStorage.removeItem("authCookies");
          set({ isLoggedIn: false, isLoginModalVisible: true });
        }
      })().finally(() => {
        restorePromise = null;
      });
    }
    return restorePromise;
  },
  applyBootSession: (loggedIn: boolean) => {
    lastVerifiedAt = Date.now();
    set({ isLoggedIn: loggedIn, isLoginModalVisible: false });
  },
  logout: async () => {
    lastVerifiedAt = 0;
    try {
      await api.logout();
    } catch (error) {
      // 服务器没连上也要完成本地登出，否则用户以为退出了、实际下次启动又自动登录
      logger.error("Failed to logout:", error);
    }
    try {
      // 退出 = 从本机移除这个账号（含保存的密码），下次启动不会自动登录回来
      await AccountProfileManager.clearActive();
    } catch (error) {
      logger.warn("清理本机账号失败", error);
    }
    set({ isLoggedIn: false, isLoginModalVisible: true });
  },
}));

// 注册会话恢复回调：API 层遇到 401 时自动重登并重试
api.setSessionRestorer(async () => {
  await useAuthStore.getState().restoreSession();
  return useAuthStore.getState().isLoggedIn;
});

export default useAuthStore;
