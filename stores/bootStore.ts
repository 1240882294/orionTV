import { create } from "zustand";
import Toast from "react-native-toast-message";
import { api, ApiError, isAuthFailure, isConnectionFailure } from "@/services/api";
import { LoginCredentialsManager, SettingsManager } from "@/services/storage";
import { storageConfig } from "@/services/storageConfig";
import { scanLocalAccount, ScannedAccount } from "@/services/accountScanner";
import { setBootRunning } from "@/services/appSession";
import { useSettingsStore } from "./settingsStore";
import useAuthStore from "./authStore";
import useFavoritesStore from "./favoritesStore";
import useHomeStore, { clearHomeCache } from "./homeStore";
import Logger from "@/utils/Logger";

const logger = Logger.withTag("BootStore");

export type BootPhase =
  | "idle"
  | "config" // 读取本地服务器配置
  | "scan" // 扫描本机保存的账号
  | "connect" // 连接服务器
  | "sync" // 校验账号并刷新数据
  | "ready"
  | "offline" // 连接失败，需要用户检查网络
  | "unconfigured"; // 还没填服务器地址

interface BootState {
  phase: BootPhase;
  running: boolean;
  attempt: number;
  /** 扫描到的本地账号信息（不含密码） */
  account: ScannedAccount | null;
  accountName?: string;
  errorTitle: string;
  errorMessage: string;
  /** 用户选择「稍后再说」，允许先进应用 */
  dismissed: boolean;
  start: (options?: { force?: boolean }) => Promise<void>;
  retry: () => Promise<void>;
  dismiss: () => void;
}

/** 把异常翻译成给用户看的话术，网络类问题一律引导检查网络 */
const describeFailure = (error: unknown): { title: string; message: string } => {
  if (error instanceof ApiError) {
    switch (error.kind) {
      case "timeout":
        return {
          title: "连接超时",
          message: "服务器一直没有响应，请检查网络连接后重试。",
        };
      case "network":
        return {
          title: "网络连接失败",
          message: "请检查电视的网络连接，确认 Wi-Fi 或网线已连接后重试。",
        };
      case "server":
        return {
          title: "服务器暂时不可用",
          message: `服务器返回异常（${error.status ?? "未知"}），请稍后重试。`,
        };
      case "unauthorized":
        return {
          title: "账号验证失败",
          message: "账号或密码可能已失效，请重新登录。",
        };
      case "not-configured":
        return {
          title: "尚未配置服务器",
          message: "请先在设置中填写服务器地址。",
        };
      default:
        break;
    }
  }
  return {
    title: "网络连接失败",
    message: "请检查网络连接后重试。",
  };
};

/** 校验账号：优先用已保存的凭据，没有就尝试延续历史会话 */
const authenticate = async (
  account: ScannedAccount,
  storageType: string
): Promise<{ loggedIn: boolean; authError: boolean }> => {
  // localstorage 模式服务端不校验账号，直接建立会话即可。
  // 这里即使失败也不弹登录框：该模式没有可输入的账号，弹了也无从下手。
  if (storageType === "localstorage") {
    const result = await api.login();
    return { loggedIn: Boolean(result?.ok), authError: false };
  }

  // redis 等模式：用保存的用户名/密码静默重登
  const credentials = await LoginCredentialsManager.get();
  if (credentials?.username) {
    try {
      const result = await api.login(credentials.username, credentials.password);
      return { loggedIn: Boolean(result?.ok), authError: !result?.ok };
    } catch (error) {
      if (isConnectionFailure(error)) throw error;
      return { loggedIn: false, authError: true };
    }
  }

  // 没有凭据但本机留有会话：探测一个受保护接口，401 就说明会话已失效
  if (account.hasSavedSession) {
    try {
      await api.getFavorites();
      return { loggedIn: true, authError: false };
    } catch (error) {
      if (isConnectionFailure(error)) throw error;
      return { loggedIn: false, authError: false };
    }
  }

  // 既没有凭据也没有历史会话：这类服务器（redis）必须登录才能取数据，
  // 直接进入会让首页空白，所以标记为需要登录，由调用方弹登录框。
  return { loggedIn: false, authError: true };
};

/** 账号刷新：清掉上一个账号的内容缓存，重新拉收藏与播放记录 */
const refreshAccountData = async (loggedIn: boolean) => {
  clearHomeCache();
  await Promise.allSettled([
    useFavoritesStore.getState().fetchFavorites(),
    loggedIn ? useHomeStore.getState().refreshPlayRecords() : Promise.resolve(),
  ]);
};

export const useBootStore = create<BootState>((set, get) => ({
  phase: "idle",
  running: false,
  attempt: 0,
  account: null,
  accountName: undefined,
  errorTitle: "",
  errorMessage: "",
  dismissed: false,

  start: async (options = {}) => {
    if (get().running) return;
    if (!options.force && get().phase === "ready") return;

    set({
      running: true,
      attempt: get().attempt + 1,
      phase: "config",
      errorTitle: "",
      errorMessage: "",
      dismissed: false,
    });
    setBootRunning(true);

    const fail = (error: unknown) => {
      const { title, message } = describeFailure(error);
      logger.warn(`启动中断：${title} - ${message}`, error);
      set({ phase: "offline", running: false, errorTitle: title, errorMessage: message });
      Toast.show({ type: "error", text1: title, text2: message, visibilityTime: 4000 });
    };

    try {
      // ① 本地配置：没有服务器地址时不算网络故障，引导去设置
      const settings = await SettingsManager.get().catch(() => null);
      const apiBaseUrl = settings?.apiBaseUrl?.trim() || "";
      if (!apiBaseUrl) {
        set({ phase: "unconfigured", running: false });
        return;
      }
      api.setBaseUrl(apiBaseUrl);

      // ② 扫描账号
      set({ phase: "scan" });
      const account = await scanLocalAccount();
      set({ account, accountName: account.displayName });

      // ③ 连接服务器
      set({ phase: "connect" });
      let serverConfig;
      try {
        serverConfig = await api.getServerConfig();
      } catch (error) {
        fail(error);
        return;
      }
      if (!serverConfig?.StorageType) {
        fail(new ApiError("INVALID_CONFIG", "server"));
        return;
      }
      storageConfig.setStorageType(serverConfig.StorageType);
      useSettingsStore.setState({ serverConfig, isLoadingServerConfig: false });

      // ④ 校验并刷新账号
      set({ phase: "sync" });
      let auth;
      try {
        auth = await authenticate(account, serverConfig.StorageType);
      } catch (error) {
        // 账号问题不当作网络故障：不显示「检查网络」，直接弹登录框
        if (isAuthFailure(error)) {
          useAuthStore.getState().applyBootSession(false);
          useAuthStore.setState({ isLoginModalVisible: true });
          set({ phase: "ready", running: false });
          await refreshAccountData(false).catch(() => undefined);
          return;
        }
        fail(error);
        return;
      }

      useAuthStore.getState().applyBootSession(auth.loggedIn);
      await refreshAccountData(auth.loggedIn);

      set({ phase: "ready", running: false });

      // 连接就绪后主动拉一次首页数据：
      // 首页在启动阶段发出的请求会因为未连接而失败，不能指望它自己恢复
      void useHomeStore.getState().fetchInitialData().catch(() => undefined);

      if (auth.authError) {
        // 账号问题不走「检查网络」提示，直接让用户重新登录
        useAuthStore.setState({ isLoginModalVisible: true });
        Toast.show({
          type: "error",
          text1: "账号验证失败",
          text2: "请重新登录后继续使用。",
          visibilityTime: 3500,
        });
      }
    } catch (error) {
      // 兜底：任何未预料的异常都不该把用户卡在启动页
      fail(error);
    } finally {
      setBootRunning(false);
    }
  },

  retry: async () => {
    await get().start({ force: true });
  },

  dismiss: () => set({ dismissed: true }),
}));

export default useBootStore;
