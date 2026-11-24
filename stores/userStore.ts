import { create } from "zustand";
import Toast from "react-native-toast-message";
import { api, ApiError, isConnectionFailure } from "@/services/api";
import { AccountProfileManager, AccountProfile, normalizeServer } from "@/services/accountProfiles";
import { useSettingsStore } from "./settingsStore";
import useAuthStore from "./authStore";
import useFavoritesStore from "./favoritesStore";
import useHomeStore, { clearHomeCache } from "./homeStore";
import Logger from "@/utils/Logger";

const logger = Logger.withTag("UserStore");

interface UserState {
  visible: boolean;
  busy: boolean;
  profiles: AccountProfile[];
  activeId: string | null;
  /** 服务器是否处于免登录模式（localstorage），该模式没有多账号概念 */
  localMode: boolean;
  open: () => void;
  close: () => void;
  refresh: () => Promise<void>;
  switchTo: (id: string) => Promise<boolean>;
  loginAs: (username: string, password: string) => Promise<boolean>;
  logoutCurrent: () => Promise<void>;
}

/**
 * 切换 / 新增账号后刷新所有跟账号相关的数据。
 *
 * 必须清首页内存缓存并重新拉收藏、播放记录：
 * 否则切到 B 账号后 5 分钟内首页还是 A 账号的分类数据。
 */
const reloadAccountData = async () => {
  useAuthStore.getState().applyBootSession(true);
  clearHomeCache();
  useFavoritesStore.setState({ favorites: [], error: null });
  await Promise.allSettled([
    useFavoritesStore.getState().fetchFavorites(),
    useHomeStore.getState().refreshPlayRecords(),
    useHomeStore.getState().fetchInitialData(),
  ]);
};

const errorText = (error: unknown): string => {
  if (error instanceof ApiError) {
    switch (error.kind) {
      case "unauthorized":
        return "账号或密码不正确";
      case "timeout":
        return "服务器响应超时，请稍后重试";
      case "network":
        return "网络连接失败，请检查网络后重试";
      case "server":
        return "服务器暂时不可用，请稍后重试";
      default:
        break;
    }
  }
  if (isConnectionFailure(error)) return "网络连接失败，请检查网络后重试";
  if (error instanceof Error && error.message) return error.message;
  return "账号或密码不可用";
};

export const useUserStore = create<UserState>((set, get) => ({
  visible: false,
  busy: false,
  profiles: [],
  activeId: null,
  localMode: false,

  open: () => {
    set({ visible: true });
    void get().refresh();
  },

  close: () => {
    if (get().busy) return;
    set({ visible: false });
  },

  refresh: async () => {
    const [all, activeId] = await Promise.all([
      AccountProfileManager.getAll(),
      AccountProfileManager.getActiveId(),
    ]);
    // 账号跟服务器绑定：换了服务器地址后，旧服务器的账号不该出现在列表里
    const server = normalizeServer(useSettingsStore.getState().apiBaseUrl);
    const profiles = server
      ? all.filter((item) => !item.server || item.server === server)
      : all;
    const storageType = useSettingsStore.getState().serverConfig?.StorageType;
    set({
      profiles,
      activeId: profiles.some((item) => item.id === activeId) ? activeId : null,
      localMode: storageType === "localstorage",
    });
  },

  switchTo: async (id) => {
    const { profiles, activeId, busy } = get();
    if (busy) return false;
    if (id === activeId && useAuthStore.getState().isLoggedIn) {
      Toast.show({ type: "info", text1: "已经是当前账号" });
      return true;
    }
    const target = profiles.find((item) => item.id === id);
    if (!target) return false;

    const previous = await AccountProfileManager.getActive();
    set({ busy: true });
    try {
      await api.login(target.username, target.password);
      await AccountProfileManager.setActive(id);
      await reloadAccountData();
      set({ activeId: id });
      Toast.show({ type: "success", text1: `已切换到 ${target.username}` });
      logger.info(`切换账号成功：${target.username}`);
      return true;
    } catch (error) {
      logger.warn("切换账号失败", error);
      // 登录没成功就把当前凭据还原，别让启动流程下次用错账号
      if (previous) {
        await AccountProfileManager.setActive(previous.id).catch(() => undefined);
      }
      Toast.show({
        type: "error",
        text1: "切换失败",
        text2: errorText(error),
        visibilityTime: 3000,
      });
      return false;
    } finally {
      set({ busy: false });
    }
  },

  loginAs: async (username, password) => {
    if (get().busy) return false;
    const trimmed = username.trim();
    if (!trimmed || !password) {
      Toast.show({ type: "error", text1: "请输入用户名和密码" });
      return false;
    }
    set({ busy: true });
    try {
      await api.login(trimmed, password);
      const profile = await AccountProfileManager.upsert(trimmed, password);
      await reloadAccountData();
      await get().refresh();
      set({ activeId: profile.id });
      Toast.show({ type: "success", text1: "登录成功", text2: `已添加账号 ${profile.username}` });
      return true;
    } catch (error) {
      logger.warn("新增账号登录失败", error);
      Toast.show({
        type: "error",
        text1: "登录失败",
        text2: errorText(error),
        visibilityTime: 3000,
      });
      return false;
    } finally {
      set({ busy: false });
    }
  },

  logoutCurrent: async () => {
    if (get().busy) return;
    set({ busy: true });
    try {
      await useAuthStore.getState().logout();
    } catch (error) {
      logger.warn("退出登录请求失败，仍清理本地状态", error);
    } finally {
      // 退出后必须把两个账号的数据清干净，否则登录框后面的首页还是旧账号内容
      useFavoritesStore.setState({ favorites: [], error: null });
      clearHomeCache();
      useHomeStore.setState({ contentData: [], error: null });
      set({ busy: false });
      await get().refresh();
      Toast.show({ type: "success", text1: "已退出当前账号" });
    }
  },
}));

export default useUserStore;
