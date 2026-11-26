import AsyncStorage from "@react-native-async-storage/async-storage";
import { initialsOf, initialsVariantsOf } from "@/utils/pinyinInitials";
import { FavoriteManager, PlayRecordManager, SearchHistoryManager } from "./storage";
import { api } from "./api";
import Logger from "@/utils/Logger";

const logger = Logger.withTag("SearchSuggest");

/**
 * 首字母联想词库。
 *
 * 电视上用遥控器打中文几乎不可行，所以搜索页提供字母键盘：
 * 输入 `psjy` 就应该能联想到「破事精英」。
 *
 * 词库完全落在本地，来源按可靠性叠加：
 *   1. 搜索历史（用户真的搜过）
 *   2. 播放记录标题（真的看过）
 *   3. 收藏标题
 *   4. 豆瓣榜单标题（冷启动时的种子，覆盖当下热门）
 *   5. 每次搜索返回的标题（边用边学）
 *
 * 首字母靠 `utils/pinyinInitials.ts` 里的离线字表转换，运行时零依赖。
 */

const STORAGE_KEY = "search_suggest_index_v1";
const MAX_ENTRIES = 3000;
const SAVE_DEBOUNCE_MS = 1500;
const SEED_TTL_MS = 6 * 60 * 60 * 1000;

export interface SuggestEntry {
  title: string;
  /** 主读音首字母串，如「破事精英」→ psjy */
  initials: string;
  /** 多音字展开后的所有写法，匹配时任一命中即可（「甄嬛传」→ zhz / zqc） */
  variants: string[];
  /** 被命中次数，用于排序 */
  hits: number;
  updatedAt: number;
}

let entries: SuggestEntry[] = [];
let loadedAt = 0;
let loadTask: Promise<void> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** 纯字母数字才算「首字母查询」，其余按中文片段匹配 */
function isInitialsQuery(query: string): boolean {
  return /^[a-z0-9]+$/.test(query);
}

function normalizeTitle(title: string): string {
  return (title || "").replace(/\s+/g, " ").trim();
}

function sortEntries(list: SuggestEntry[]): SuggestEntry[] {
  return list.sort((a, b) => {
    if (b.hits !== a.hits) return b.hits - a.hits;
    return b.updatedAt - a.updatedAt;
  });
}

async function persist(): Promise<void> {
  try {
    // 只留最近的 MAX_ENTRIES 条，避免无限膨胀
    const trimmed = sortEntries([...entries]).slice(0, MAX_ENTRIES);
    entries = trimmed;
    // variants 是推导出来的，不必落盘：读回来时按标题重算，省一半存储
    const serialized = trimmed.map(({ title, initials, hits, updatedAt }) => ({
      title,
      initials,
      hits,
      updatedAt,
    }));
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(serialized));
  } catch (e) {
    logger.warn("persist suggest index failed", e);
  }
}

function schedulePersist(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void persist();
  }, SAVE_DEBOUNCE_MS);
}

/** 批量写入标题；已存在的只累加命中次数，不重复存 */
function upsertSync(titles: string[], weight = 1): boolean {
  let changed = false;
  const now = Date.now();
  for (const raw of titles) {
    const title = normalizeTitle(raw);
    if (!title) continue;
    const initials = initialsOf(title);
    if (!initials) continue;
    const variants = initialsVariantsOf(title);
    const existing = entries.find((e) => e.title === title);
    if (existing) {
      existing.hits += weight;
      existing.updatedAt = now;
      existing.initials = initials;
      existing.variants = variants;
    } else {
      entries.push({ title, initials, variants, hits: weight, updatedAt: now });
    }
    changed = true;
  }
  return changed;
}

/** 豆瓣榜单当种子：冷启动时也能联想到当下热门剧 */
async function fetchDoubanSeeds(): Promise<string[]> {
  const jobs: { type: "movie" | "tv"; tag: string }[] = [
    { type: "tv", tag: "热门" },
    { type: "tv", tag: "国产剧" },
    { type: "tv", tag: "综艺" },
    { type: "tv", tag: "喜剧" },
    { type: "tv", tag: "悬疑" },
    { type: "tv", tag: "爱情" },
    { type: "movie", tag: "热门" },
    { type: "movie", tag: "经典" },
    { type: "movie", tag: "top250" },
    { type: "movie", tag: "动作" },
  ];

  const results = await Promise.allSettled(
    jobs.map((job) => api.getDoubanData(job.type, job.tag, 20, 0))
  );

  const titles: string[] = [];
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const item of r.value?.list || []) {
      if (item?.title) titles.push(item.title);
    }
  }
  return titles;
}

async function loadLocalEntries(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    entries = parsed
      .filter((e: any) => e && typeof e.title === "string" && typeof e.initials === "string")
      .map((e: any) => ({
        title: e.title,
        initials: e.initials,
        // 旧数据没有 variants 字段，读出来时按当前字表重算一次
        variants: Array.isArray(e.variants) && e.variants.length ? e.variants : initialsVariantsOf(e.title),
        hits: Number(e.hits) || 1,
        updatedAt: Number(e.updatedAt) || 0,
      }));
  } catch (e) {
    logger.warn("load suggest index failed", e);
  }
}

/** 从本机已有的数据（历史 / 记录 / 收藏）补齐词库 */
async function loadLocalSeeds(): Promise<void> {
  const titles: string[] = [];

  const [history, favorites, records] = await Promise.allSettled([
    SearchHistoryManager.get(),
    FavoriteManager.getAll(),
    PlayRecordManager.getAll(),
  ]);

  if (history.status === "fulfilled" && Array.isArray(history.value)) {
    titles.push(...history.value);
  }
  if (favorites.status === "fulfilled" && favorites.value) {
    for (const fav of Object.values(favorites.value)) {
      if (fav?.title) titles.push(fav.title);
      if (fav?.search_title) titles.push(fav.search_title);
    }
  }
  if (records.status === "fulfilled" && records.value) {
    for (const rec of Object.values(records.value)) {
      if (rec?.title) titles.push(rec.title);
    }
  }

  if (titles.length && upsertSync(titles, 2)) schedulePersist();
}

async function loadRemoteSeeds(): Promise<void> {
  try {
    const titles = await fetchDoubanSeeds();
    if (titles.length && upsertSync(titles, 1)) schedulePersist();
  } catch (e) {
    logger.warn("load douban seeds failed", e);
  }
}

/**
 * 确保词库已就绪。第一次调用会读本地 + 拉种子；
 * 之后 6 小时内直接复用内存，不再打网络。
 */
export function ensureSuggestIndex(force = false): Promise<void> {
  if (loadTask) return loadTask;
  if (!force && loadedAt && Date.now() - loadedAt < SEED_TTL_MS) return Promise.resolve();

  loadTask = (async () => {
    await loadLocalEntries();
    await loadLocalSeeds();
    // 豆瓣种子单独放最后，慢也不阻塞前面的本地词
    loadedAt = Date.now();
    await loadRemoteSeeds();
  })()
    .catch((e) => logger.warn("ensure suggest index failed", e))
    .finally(() => {
      loadTask = null;
    });

  return loadTask;
}

/**
 * 匹配与排序的纯函数，方便单测，不碰存储。
 * - 纯字母/数字：按首字母前缀匹配
 * - 含中文：按标题包含匹配
 */
export function rankSuggestions(
  list: SuggestEntry[],
  query: string,
  limit = 8
): SuggestEntry[] {
  const q = (query || "").trim().toLowerCase();
  if (!q) return [];

  const matched = list.filter((entry) => {
    if (!isInitialsQuery(q)) return entry.title.toLowerCase().includes(q);
    // 多音字任一写法命中即可
    if (entry.initials.startsWith(q)) return true;
    return (entry.variants || []).some((v) => v.startsWith(q));
  });

  // 完全一致 > 更短的前缀（更贴近输入）> 命中次数 > 最近更新
  matched.sort((a, b) => {
    const aExact = a.initials === q || (a.variants || []).includes(q) ? 0 : 1;
    const bExact = b.initials === q || (b.variants || []).includes(q) ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    const aTitleExact = a.title.toLowerCase() === q ? 0 : 1;
    const bTitleExact = b.title.toLowerCase() === q ? 0 : 1;
    if (aTitleExact !== bTitleExact) return aTitleExact - bTitleExact;
    if (a.initials.length !== b.initials.length) return a.initials.length - b.initials.length;
    if (b.hits !== a.hits) return b.hits - a.hits;
    return b.updatedAt - a.updatedAt;
  });

  return matched.slice(0, limit);
}

/** 给出联想结果，数据来自当前内存词库 */
export function suggestTitles(query: string, limit = 8): SuggestEntry[] {
  return rankSuggestions(entries, query, limit);
}

/** 把一次搜索/一次播放的标题记进词库，越用越准 */
export function rememberTitles(titles: string[], weight = 3): void {
  if (!titles?.length) return;
  if (upsertSync(titles, weight)) schedulePersist();
}

/** 供测试与调试：清空内存与本地词库 */
export async function resetSuggestIndex(): Promise<void> {
  entries = [];
  loadedAt = 0;
  loadTask = null;
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** 供测试：直接看当前词条数 */
export function suggestIndexSize(): number {
  return entries.length;
}
