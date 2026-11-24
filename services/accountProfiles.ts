import AsyncStorage from "@react-native-async-storage/async-storage";
import { LoginCredentialsManager, SettingsManager } from "./storage";
import Logger from "@/utils/Logger";

const logger = Logger.withTag("AccountProfiles");

/** 多账号列表。键名带 mytv_ 前缀，账号扫描时能看到这份痕迹。 */
const PROFILES_KEY = "mytv_account_profiles";
const ACTIVE_KEY = "mytv_active_account_id";

export interface AccountProfile {
  /** 用户名小写归一化后的标识 */
  id: string;
  username: string;
  password: string;
  /** 账号所属服务器地址（归一化）。换服务器后旧账号不应出现在列表里 */
  server: string;
  addedAt: number;
  /** 最近一次切换/登录的时间，用于列表排序与展示 */
  lastUsedAt: number;
}

const normalizeId = (username: string) => username.trim().toLowerCase();

/** 服务器地址归一化，仅用于比较 */
export const normalizeServer = (url?: string) =>
  String(url || "")
    .trim()
    .replace(/\/+$/, "")
    .toLowerCase();

/** 读取当前服务器地址：优先内存里的设置，失败再读本地 */
const currentServer = async (): Promise<string> => {
  try {
    const settings = await SettingsManager.get();
    return normalizeServer(settings?.apiBaseUrl);
  } catch {
    return "";
  }
};

const readProfiles = async (): Promise<AccountProfile[]> => {
  try {
    const raw = await AsyncStorage.getItem(PROFILES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.username === "string" && item.username.trim().length > 0)
      .map((item) => ({
        id: item.id || normalizeId(item.username),
        username: item.username,
        password: typeof item.password === "string" ? item.password : "",
        server: typeof item.server === "string" ? item.server : "",
        addedAt: Number(item.addedAt) || Date.now(),
        lastUsedAt: Number(item.lastUsedAt) || Number(item.addedAt) || Date.now(),
      }));
  } catch (error) {
    logger.warn("读取多账号列表失败", error);
    return [];
  }
};

const writeProfiles = async (profiles: AccountProfile[]): Promise<void> => {
  try {
    await AsyncStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
  } catch (error) {
    logger.error("保存多账号列表失败", error);
  }
};

/**
 * 多账号管理。
 *
 * 和 LoginCredentialsManager 的分工：
 * - 本模块维护「所有登录过的账号」清单，供用户管理与切换；
 * - LoginCredentialsManager 始终只保存「当前生效的账号」，启动流程继续读它，
 *   这样 bootStore 不需要感知多账号的存在。
 *
 * 两者在切换/新增/退出时同步写入，避免出现「列表里显示 A，实际用 B 登录」。
 */
export const AccountProfileManager = {
  /** 读取全部账号（首次调用会把旧版本的单账号凭据迁移成一条档案） */
  async getAll(): Promise<AccountProfile[]> {
    const profiles = await readProfiles();
    if (profiles.length > 0) return profiles;

    // 迁移：1.3.x 及以前只存了一份凭据，没有账号列表
    const legacy = await LoginCredentialsManager.get();
    if (legacy?.username) {
      const now = Date.now();
      const migrated: AccountProfile = {
        id: normalizeId(legacy.username),
        username: legacy.username,
        password: legacy.password ?? "",
        server: await currentServer(),
        addedAt: now,
        lastUsedAt: now,
      };
      await writeProfiles([migrated]);
      await AsyncStorage.setItem(ACTIVE_KEY, migrated.id);
      logger.info(`已把旧版本账号迁移为多账号档案：${migrated.username}`);
      return [migrated];
    }
    return [];
  },

  async getActiveId(): Promise<string | null> {
    try {
      return await AsyncStorage.getItem(ACTIVE_KEY);
    } catch (error) {
      logger.warn("读取当前账号标识失败", error);
      return null;
    }
  },

  async getActive(): Promise<AccountProfile | null> {
    const [profiles, activeId] = await Promise.all([this.getAll(), this.getActiveId()]);
    if (activeId) {
      const matched = profiles.find((item) => item.id === activeId);
      if (matched) return matched;
    }
    // 没有记录 activeId 时，用当前生效的凭据兜底匹配
    const credentials = await LoginCredentialsManager.get();
    if (credentials?.username) {
      return profiles.find((item) => item.id === normalizeId(credentials.username)) ?? null;
    }
    return null;
  },

  /** 新增或更新一个账号，并把它设为当前账号 */
  async upsert(username: string, password: string): Promise<AccountProfile> {
    const trimmed = username.trim();
    const id = normalizeId(trimmed);
    const now = Date.now();
    const server = await currentServer();
    const profiles = await readProfiles();
    const existing = profiles.find((item) => item.id === id);

    const profile: AccountProfile = existing
      ? { ...existing, username: trimmed, password, server, lastUsedAt: now }
      : { id, username: trimmed, password, server, addedAt: now, lastUsedAt: now };

    const next = existing
      ? profiles.map((item) => (item.id === id ? profile : item))
      : [...profiles, profile];

    await writeProfiles(next);
    await AsyncStorage.setItem(ACTIVE_KEY, profile.id);
    await LoginCredentialsManager.save({ username: profile.username, password: profile.password });
    logger.info(`账号已保存并设为当前：${profile.username}`);
    return profile;
  },

  /** 把指定账号设为当前账号（同步写入启动流程读取的凭据） */
  async setActive(id: string): Promise<AccountProfile | null> {
    const profiles = await readProfiles();
    const profile = profiles.find((item) => item.id === id);
    if (!profile) return null;

    const next = profiles.map((item) =>
      item.id === id ? { ...item, lastUsedAt: Date.now() } : item
    );
    await writeProfiles(next);
    await AsyncStorage.setItem(ACTIVE_KEY, id);
    await LoginCredentialsManager.save({ username: profile.username, password: profile.password });
    logger.info(`切换到账号：${profile.username}`);
    return profile;
  },

  /**
   * 退出当前账号：把它从本机账号列表里移除，并清掉启动流程用的凭据。
   * 退出后重启也不会自动登录回这个账号，符合「退出」的语义。
   */
  async clearActive(): Promise<void> {
    const activeId = await this.getActiveId();
    const credentials = await LoginCredentialsManager.get();
    const targetId = activeId || (credentials?.username ? normalizeId(credentials.username) : null);

    if (targetId) {
      const profiles = await readProfiles();
      await writeProfiles(profiles.filter((item) => item.id !== targetId));
      logger.info(`已退出并从本机移除账号：${targetId}`);
    }

    await AsyncStorage.removeItem(ACTIVE_KEY);
    await LoginCredentialsManager.clear();
  },
};

export default AccountProfileManager;
