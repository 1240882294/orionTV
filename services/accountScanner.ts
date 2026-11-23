import AsyncStorage from "@react-native-async-storage/async-storage";
import { LoginCredentialsManager } from "./storage";
import Logger from "@/utils/Logger";

const logger = Logger.withTag("AccountScanner");

/** 与账号相关的本地存储键（含历史遗留键名） */
const ACCOUNT_KEY_PREFIXES = ["mytv_", "oriontv_", "authCookies"];

export interface ScannedAccount {
  /** 本地是否保存了可用的用户名/密码 */
  hasCredentials: boolean;
  /** 本地是否留有会话 cookie（上次登录成功过） */
  hasSavedSession: boolean;
  /** 本地是否有该账号的收藏 / 播放记录缓存 */
  hasCachedUserData: boolean;
  /** 命中的账号相关键，便于日志排查 */
  matchedKeys: string[];
  /** 仅用于 UI 展示，不含密码 */
  displayName?: string;
}

/**
 * 扫描本机保存的账号痕迹。
 *
 * 只读、不修改任何数据，也绝不把密码带出本函数 —— 需要登录时由调用方
 * 重新从 LoginCredentialsManager 取值，避免明文密码在组件树/状态里流转。
 */
export async function scanLocalAccount(): Promise<ScannedAccount> {
  const result: ScannedAccount = {
    hasCredentials: false,
    hasSavedSession: false,
    hasCachedUserData: false,
    matchedKeys: [],
  };

  try {
    const credentials = await LoginCredentialsManager.get();
    if (credentials?.username) {
      result.hasCredentials = true;
      result.displayName = credentials.username;
    }
  } catch (error) {
    logger.warn("读取本地账号凭据失败", error);
  }

  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const matched = allKeys.filter((key) =>
      ACCOUNT_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))
    );
    result.matchedKeys = matched;

    const cookies = await AsyncStorage.getItem("authCookies");
    result.hasSavedSession = Boolean(cookies && cookies.trim().length > 0);

    result.hasCachedUserData =
      matched.includes("mytv_favorites") || matched.includes("mytv_play_records");
  } catch (error) {
    logger.warn("扫描本地账号存储失败", error);
  }

  logger.info(
    `账号扫描完成：凭据=${result.hasCredentials} 会话=${result.hasSavedSession} 缓存=${result.hasCachedUserData} 命中键=${result.matchedKeys.length}`
  );

  return result;
}
