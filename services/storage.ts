import AsyncStorage from "@react-native-async-storage/async-storage";
import { api, PlayRecord as ApiPlayRecord, Favorite as ApiFavorite } from "./api";
import { storageConfig } from "./storageConfig";
import Logger from '@/utils/Logger';

const logger = Logger.withTag('Storage');

// --- Storage Keys ---
const STORAGE_KEYS = {
  SETTINGS: "mytv_settings",
  PLAYER_SETTINGS: "mytv_player_settings",
  FAVORITES: "mytv_favorites",
  PLAY_RECORDS: "mytv_play_records",
  SEARCH_HISTORY: "mytv_search_history",
  LOGIN_CREDENTIALS: "mytv_login_credentials",
} as const;

// --- Type Definitions (aligned with api.ts) ---
// Re-exporting for consistency, though they are now primarily API types
export type PlayRecord = ApiPlayRecord & {
  introEndTime?: number;
  outroStartTime?: number;
};
export type Favorite = ApiFavorite;

export interface PlayerSettings {
  introEndTime?: number;
  outroStartTime?: number;
  playbackRate?: number;
}

export interface AppSettings {
  apiBaseUrl: string;
  /** 播放时自动过滤 m3u8 里的广告分片（默认开启） */
  adBlockEnabled?: boolean;
  remoteInputEnabled: boolean;
  videoSource: {
    enabledAll: boolean;
    sources: {
      [key: string]: boolean;
    };
  };
  m3uUrl: string;
}

export interface LoginCredentials {
  username: string;
  password: string;
}

// --- Helper ---
const generateKey = (source: string, id: string) => `${source}+${id}`;

// --- 播放记录写入串行化 ---
// save / remove / 按标题去重 都是「读—改—写」：并发执行时，后写的一方会拿旧快照
// 整体覆盖回去，把刚删掉的旧线路记录又写活，最近播放里就出现同一部片两条记录。
// 这里用一条串行队列把它们排队，保证临界区里只有一次读改写。
let playRecordWriteQueue: Promise<unknown> = Promise.resolve();

const withPlayRecordWriteLock = <T>(task: () => Promise<T>): Promise<T> => {
  const run = playRecordWriteQueue.then(task, task);
  playRecordWriteQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
};

const normalizeRecordTitle = (title?: string) => (title || "").replace(/\s+/g, "");

/**
 * 找出同一部影片挂在其他线路下的记录 key（切源后应当被清掉的旧记录）。
 * 年份只在两边都有值时才比较，避免旧记录缺年份时把同名不同年的剧误删。
 */
const pickStalePlayRecordKeys = (
  records: Record<string, { title?: string; year?: string } | undefined>,
  keepKey: string,
  title?: string,
  year?: string
): string[] => {
  const targetTitle = normalizeRecordTitle(title);
  if (!targetTitle) return [];
  const targetYear = (year || "").trim();

  return Object.keys(records).filter((key) => {
    if (key === keepKey) return false;
    const record = records[key];
    if (!record) return false;
    if (normalizeRecordTitle(record.title) !== targetTitle) return false;
    const recordYear = (record.year || "").trim();
    if (targetYear && recordYear && recordYear !== targetYear) return false;
    return true;
  });
};

const splitPlayRecordKey = (key: string): [string, string] | null => {
  const cut = key.indexOf("+");
  if (cut <= 0 || cut >= key.length - 1) return null;
  return [key.slice(0, cut), key.slice(cut + 1)];
};

// --- PlayerSettingsManager (Uses AsyncStorage) ---
export class PlayerSettingsManager {
  static async getAll(): Promise<Record<string, PlayerSettings>> {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.PLAYER_SETTINGS);
      return data ? JSON.parse(data) : {};
    } catch (error) {
      logger.info("Failed to get all player settings:", error);
      return {};
    }
  }

  static async get(source: string, id: string): Promise<PlayerSettings | null> {
    const perfStart = performance.now();
    logger.info(`[PERF] PlayerSettingsManager.get START - source: ${source}, id: ${id}`);
    
    const allSettings = await this.getAll();
    const result = allSettings[generateKey(source, id)] || null;
    
    const perfEnd = performance.now();
    logger.info(`[PERF] PlayerSettingsManager.get END - took ${(perfEnd - perfStart).toFixed(2)}ms, found: ${!!result}`);
    
    return result;
  }

  static async save(source: string, id: string, settings: PlayerSettings): Promise<void> {
    const allSettings = await this.getAll();
    const key = generateKey(source, id);
    // Only save if there are actual values to save
    if (settings.introEndTime !== undefined || settings.outroStartTime !== undefined || settings.playbackRate !== undefined) {
      allSettings[key] = { ...allSettings[key], ...settings };
    } else {
      // If all are undefined, remove the key
      delete allSettings[key];
    }
    await AsyncStorage.setItem(STORAGE_KEYS.PLAYER_SETTINGS, JSON.stringify(allSettings));
  }

  static async remove(source: string, id: string): Promise<void> {
    const allSettings = await this.getAll();
    delete allSettings[generateKey(source, id)];
    await AsyncStorage.setItem(STORAGE_KEYS.PLAYER_SETTINGS, JSON.stringify(allSettings));
  }

  static async clearAll(): Promise<void> {
    await AsyncStorage.removeItem(STORAGE_KEYS.PLAYER_SETTINGS);
  }
}

// --- FavoriteManager (Dynamic: API or LocalStorage) ---
export class FavoriteManager {
  private static getStorageType() {
    return storageConfig.getStorageType();
  }

  static async getAll(): Promise<Record<string, Favorite>> {
    if (this.getStorageType() === "localstorage") {
      try {
        const data = await AsyncStorage.getItem(STORAGE_KEYS.FAVORITES);
        return data ? JSON.parse(data) : {};
      } catch (error) {
        logger.info("Failed to get all local favorites:", error);
        return {};
      }
    }
    return (await api.getFavorites()) as Record<string, Favorite>;
  }

  static async save(source: string, id: string, item: Favorite): Promise<void> {
    const key = generateKey(source, id);
    if (this.getStorageType() === "localstorage") {
      const allFavorites = await this.getAll();
      allFavorites[key] = { ...item, save_time: Date.now() };
      await AsyncStorage.setItem(STORAGE_KEYS.FAVORITES, JSON.stringify(allFavorites));
      return;
    }
    await api.addFavorite(key, item);
  }

  static async remove(source: string, id: string): Promise<void> {
    const key = generateKey(source, id);
    if (this.getStorageType() === "localstorage") {
      const allFavorites = await this.getAll();
      delete allFavorites[key];
      await AsyncStorage.setItem(STORAGE_KEYS.FAVORITES, JSON.stringify(allFavorites));
      return;
    }
    await api.deleteFavorite(key);
  }

  static async isFavorited(source: string, id: string): Promise<boolean> {
    const key = generateKey(source, id);
    if (this.getStorageType() === "localstorage") {
      const allFavorites = await this.getAll();
      return !!allFavorites[key];
    }
    const favorite = await api.getFavorites(key);
    return favorite !== null;
  }

  static async toggle(source: string, id: string, item: Favorite): Promise<boolean> {
    const isFav = await this.isFavorited(source, id);
    if (isFav) {
      await this.remove(source, id);
      return false;
    } else {
      await this.save(source, id, item);
      return true;
    }
  }

  static async clearAll(): Promise<void> {
    if (this.getStorageType() === "localstorage") {
      await AsyncStorage.removeItem(STORAGE_KEYS.FAVORITES);
      return;
    }
    await api.deleteFavorite();
  }
}

// --- PlayRecordManager (Dynamic: API or LocalStorage) ---
export class PlayRecordManager {
  private static getStorageType() {
    return storageConfig.getStorageType();
  }

  static async getAll(): Promise<Record<string, PlayRecord>> {
    const perfStart = performance.now();
    const storageType = this.getStorageType();
    logger.info(`[PERF] PlayRecordManager.getAll START - storageType: ${storageType}`);
    
    let apiRecords: Record<string, PlayRecord> = {};
    if (storageType === "localstorage") {
      try {
        const data = await AsyncStorage.getItem(STORAGE_KEYS.PLAY_RECORDS);
        apiRecords = data ? JSON.parse(data) : {};
      } catch (error) {
        logger.info("Failed to get all local play records:", error);
        return {};
      }
    } else {
      const apiStart = performance.now();
      logger.info(`[PERF] API getPlayRecords START`);
      
      apiRecords = await api.getPlayRecords();
      
      const apiEnd = performance.now();
      logger.info(`[PERF] API getPlayRecords END - took ${(apiEnd - apiStart).toFixed(2)}ms, records: ${Object.keys(apiRecords).length}`);
    }

    const localSettings = await PlayerSettingsManager.getAll();
    const mergedRecords: Record<string, PlayRecord> = {};
    for (const key in apiRecords) {
      mergedRecords[key] = {
        ...apiRecords[key],
        ...localSettings[key],
      };
    }
    
    const perfEnd = performance.now();
    logger.info(`[PERF] PlayRecordManager.getAll END - took ${(perfEnd - perfStart).toFixed(2)}ms, total records: ${Object.keys(mergedRecords).length}`);
    
    return mergedRecords;
  }

  static async save(source: string, id: string, record: Omit<PlayRecord, "save_time">): Promise<void> {
    const key = generateKey(source, id);
    const { introEndTime, outroStartTime, ...apiRecord } = record;

    // Player settings are always saved locally
    await PlayerSettingsManager.save(source, id, { introEndTime, outroStartTime });

    await withPlayRecordWriteLock(async () => {
      if (this.getStorageType() === "localstorage") {
        const allRecords = await this.readLocalRecords();
        const fullRecord = { ...apiRecord, save_time: Date.now() };
        allRecords[key] = { ...allRecords[key], ...fullRecord };

        // 兜底去重：同一部影片换线路后只保留刚写入的这一条。
        // 放在写锁内与写入同一批完成，避免和删除操作互相覆盖。
        const staleKeys = pickStalePlayRecordKeys(allRecords, key, apiRecord.title, apiRecord.year);
        for (const staleKey of staleKeys) {
          delete allRecords[staleKey];
        }

        await AsyncStorage.setItem(STORAGE_KEYS.PLAY_RECORDS, JSON.stringify(allRecords));

        for (const staleKey of staleKeys) {
          const parts = splitPlayRecordKey(staleKey);
          if (parts) await PlayerSettingsManager.remove(parts[0], parts[1]);
        }
      } else {
        await api.savePlayRecord(key, apiRecord);
        // 服务端按 key 存储，同样会留下旧线路那条，写入后顺手清掉
        if (apiRecord.title) {
          try {
            const allRecords = await api.getPlayRecords();
            const staleKeys = pickStalePlayRecordKeys(allRecords, key, apiRecord.title, apiRecord.year);
            for (const staleKey of staleKeys) {
              await api.deletePlayRecord(staleKey);
            }
          } catch (error) {
            logger.debug("Failed to prune stale play records on server:", error);
          }
        }
      }
    });
  }

  /** 读取本地原始播放记录（不合并播放器设置），供写操作做「读—改—写」 */
  private static async readLocalRecords(): Promise<Record<string, PlayRecord>> {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.PLAY_RECORDS);
      return data ? JSON.parse(data) : {};
    } catch (error) {
      logger.info("Failed to read local play records:", error);
      return {};
    }
  }

  static async get(source: string, id: string): Promise<PlayRecord | null> {
    const perfStart = performance.now();
    const key = generateKey(source, id);
    const storageType = this.getStorageType();
    logger.info(`[PERF] PlayRecordManager.get START - source: ${source}, id: ${id}, storageType: ${storageType}`);
    
    const records = await this.getAll();
    const result = records[key] || null;
    
    const perfEnd = performance.now();
    logger.info(`[PERF] PlayRecordManager.get END - took ${(perfEnd - perfStart).toFixed(2)}ms, found: ${!!result}`);
    
    return result;
  }

  /**
   * 按标题找同一部影片挂在其他线路下的最近一条记录（只读，不改数据）。
   *
   * 播放记录以「线路 + id」为键存，换源后新线路必然查不到自己的记录，
   * 于是「看到第几集、看到第几分钟」全丢，只能手动选集 —— 这就是
   * 切线路后进度归零的根因。这里做跨源兜底：新线路没记录时拿旧线路的顶上。
   *
   * 等新线路真正播满保护期、写入记录时，save() 里的去重会把旧记录清掉，
   * 记录自然迁移到新线路，不会留下两条。
   */
  static async findByTitle(title: string, year?: string): Promise<PlayRecord | null> {
    const targetTitle = normalizeRecordTitle(title);
    if (!targetTitle) return null;

    try {
      const records = await this.getAll();
      // keepKey 传一个不存在的 key：只按标题/年份筛，不排除任何一条
      const keys = pickStalePlayRecordKeys(records, "__none__", title, year);
      if (keys.length === 0) return null;

      let best: PlayRecord | null = null;
      for (const key of keys) {
        const record = records[key];
        if (!record) continue;
        if (!best || (record.save_time || 0) > (best.save_time || 0)) best = record;
      }
      return best;
    } catch (error) {
      logger.debug("Failed to find play record by title:", error);
      return null;
    }
  }

  static async remove(source: string, id: string): Promise<void> {
    const key = generateKey(source, id);
    await PlayerSettingsManager.remove(source, id); // Always remove local settings

    await withPlayRecordWriteLock(async () => {
      if (this.getStorageType() === "localstorage") {
        const allRecords = await this.readLocalRecords();
        delete allRecords[key];
        await AsyncStorage.setItem(STORAGE_KEYS.PLAY_RECORDS, JSON.stringify(allRecords));
      } else {
        await api.deletePlayRecord(key);
      }
    });
  }

  /**
   * 同一部影片换源后，清掉其他线路留下的旧记录，只保留 keepKey 这一条。
   * 否则一部片子看过两个源，最近播放里就会出现两条一样的封面。
   * year 可选：同名不同年的剧（重制版）不会互相误删。
   */
  static async removeDuplicatesByTitle(title: string, keepKey: string, year?: string): Promise<void> {
    if (!(title || "").trim()) return;

    await withPlayRecordWriteLock(async () => {
      if (this.getStorageType() === "localstorage") {
        const allRecords = await this.readLocalRecords();
        const staleKeys = pickStalePlayRecordKeys(allRecords, keepKey, title, year);
        if (staleKeys.length === 0) return;

        for (const key of staleKeys) {
          delete allRecords[key];
        }
        await AsyncStorage.setItem(STORAGE_KEYS.PLAY_RECORDS, JSON.stringify(allRecords));

        for (const key of staleKeys) {
          const parts = splitPlayRecordKey(key);
          if (parts) await PlayerSettingsManager.remove(parts[0], parts[1]);
        }
      } else {
        const allRecords = await api.getPlayRecords();
        const staleKeys = pickStalePlayRecordKeys(allRecords, keepKey, title, year);
        for (const key of staleKeys) {
          await api.deletePlayRecord(key);
        }
      }
    });
  }

  static async clearAll(): Promise<void> {
    await PlayerSettingsManager.clearAll(); // Always clear local settings

    await withPlayRecordWriteLock(async () => {
      if (this.getStorageType() === "localstorage") {
        await AsyncStorage.removeItem(STORAGE_KEYS.PLAY_RECORDS);
      } else {
        await api.deletePlayRecord();
      }
    });
  }
}

// --- SearchHistoryManager (Dynamic: API or LocalStorage) ---
export class SearchHistoryManager {
  private static getStorageType() {
    return storageConfig.getStorageType();
  }

  /** 本地那份历史：不管服务端模式，都留一份，未登录/服务端不支持时兜底 */
  private static async getLocal(): Promise<string[]> {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.SEARCH_HISTORY);
      const parsed = data ? JSON.parse(data) : [];
      return Array.isArray(parsed) ? parsed.filter((k) => typeof k === "string") : [];
    } catch (error) {
      logger.info("Failed to get local search history:", error);
      return [];
    }
  }

  private static async setLocal(list: string[]): Promise<void> {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.SEARCH_HISTORY, JSON.stringify(list));
    } catch (error) {
      logger.info("Failed to save local search history:", error);
    }
  }

  static async get(): Promise<string[]> {
    if (this.getStorageType() === "localstorage") {
      return this.getLocal();
    }
    // 服务端模式：拿到就用，拿不到（未登录 / 接口不支持）退回本地那份
    try {
      const remote = await api.getSearchHistory();
      if (Array.isArray(remote) && remote.length > 0) return remote;
    } catch (error) {
      logger.info("Failed to get remote search history, fallback to local:", error);
    }
    return this.getLocal();
  }

  static async add(keyword: string): Promise<void> {
    const trimmed = keyword.trim();
    if (!trimmed) return;

    // 先写本地：电视端「最近搜索」不依赖登录状态
    const local = await this.getLocal();
    await this.setLocal([trimmed, ...local.filter((k) => k !== trimmed)].slice(0, 20));

    if (this.getStorageType() === "localstorage") return;
    try {
      await api.addSearchHistory(trimmed);
    } catch (error) {
      logger.info("Failed to add remote search history:", error);
    }
  }

  static async clear(): Promise<void> {
    await AsyncStorage.removeItem(STORAGE_KEYS.SEARCH_HISTORY).catch(() => undefined);
    if (this.getStorageType() === "localstorage") return;
    try {
      await api.deleteSearchHistory();
    } catch (error) {
      logger.info("Failed to clear remote search history:", error);
    }
  }
}

// --- SettingsManager (Uses AsyncStorage) ---
export class SettingsManager {
  static async get(): Promise<AppSettings> {
    const defaultSettings: AppSettings = {
      apiBaseUrl: "",
      adBlockEnabled: true,
      remoteInputEnabled: true,
      videoSource: {
        enabledAll: true,
        sources: {},
      },
      m3uUrl: "",
    };
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.SETTINGS);
      return data ? { ...defaultSettings, ...JSON.parse(data) } : defaultSettings;
    } catch (error) {
      logger.info("Failed to get settings:", error);
      return defaultSettings;
    }
  }

  static async save(settings: Partial<AppSettings>): Promise<void> {
    const currentSettings = await this.get();
    const updatedSettings = { ...currentSettings, ...settings };
    await AsyncStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(updatedSettings));
  }

  static async reset(): Promise<void> {
    await AsyncStorage.removeItem(STORAGE_KEYS.SETTINGS);
  }
}

// --- LoginCredentialsManager (Uses AsyncStorage) ---
export class LoginCredentialsManager {
  static async get(): Promise<LoginCredentials | null> {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.LOGIN_CREDENTIALS);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      logger.info("Failed to get login credentials:", error);
      return null;
    }
  }

  static async save(credentials: LoginCredentials): Promise<void> {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.LOGIN_CREDENTIALS, JSON.stringify(credentials));
    } catch (error) {
      logger.error("Failed to save login credentials:", error);
    }
  }

  static async clear(): Promise<void> {
    try {
      await AsyncStorage.removeItem(STORAGE_KEYS.LOGIN_CREDENTIALS);
    } catch (error) {
      logger.error("Failed to clear login credentials:", error);
    }
  }
}
