import AsyncStorage from "@react-native-async-storage/async-storage";
import { initialsOf, initialsVariantsOf } from "@/utils/pinyinInitials";
import { fullPinyinOf, fullPinyinVariantsOf, pinyinSyllablesOf } from "@/utils/pinyinFull";
import { FavoriteManager, PlayRecordManager, SearchHistoryManager } from "./storage";
import { api } from "./api";
import { BUILTIN_SEED_TITLES } from "./searchSuggestSeed";
import Logger from "@/utils/Logger";

const logger = Logger.withTag("SearchSuggest");

/**
 * 影片标题词库（首字母 + 全拼双索引）。
 *
 * 电视端搜索页没有系统输入法，用户点字母键拼出拼音，这里负责把拼音变成中文剧名：
 *   psjy       → 破事精英（首字母）
 *   poshijing  → 破事精英（全拼打到一半）
 *   poshijingying → 破事精英（全拼打完）
 *
 * 词库来源，按可靠性叠加：
 *   1. 内置离线表（6848 条豆瓣榜单片名，打包进 App，冷启动就有）
 *   2. 搜索历史 / 播放记录 / 收藏（用户自己的东西，权重更高）
 *   3. 豆瓣实时榜单（联网时补充当下新剧）
 *   4. 每次搜索返回的标题（边用边学）
 *
 * 两个性能约束决定了这里的写法：
 * - 6848 条一次性建索引，低端电视上要几百毫秒，会卡住首帧 → 分批灌入；
 * - 按标题查重不能线性扫（O(n²) 会到千万级比较）→ 维护一张 Map。
 */

const STORAGE_KEY = "search_suggest_index_v1";
const MAX_ENTRIES = 3000;
const SAVE_DEBOUNCE_MS = 1500;
const SEED_TTL_MS = 6 * 60 * 60 * 1000;
/** 每批灌多少条种子。600 条在低端电视上约 20~30ms，不会掉帧 */
const SEED_BATCH = 600;

export interface SuggestEntry {
  title: string;
  /** 主读音首字母串，如「破事精英」→ psjy */
  initials: string;
  /** 多音字展开后的首字母写法，匹配时任一命中即可（「甄嬛传」→ zhz / zqc） */
  variants: string[];
  /** 全拼串，如「破事精英」→ poshijingying。电视端字母键盘主要靠它 */
  fullPinyin: string;
  /** 多音字展开后的全拼写法，最多 4 种 */
  fullVariants: string[];
  /**
   * 标题第一个字的音节，如「仙逆」→ xian。
   *
   * 排序要用：用户打 xian 时，「仙逆」是首音节整段命中，「降临」只是 xiáng 这个
   * 多音变体碰巧以 xian 开头 —— 前者明显更符合意图。没有这个字段就只能按标题长度排，
   * 结果「降临」排在「仙逆」前面。
   */
  firstSyllable: string;
  /** 被命中次数，用于排序 */
  hits: number;
  updatedAt: number;
  /** 内置种子不落盘：每次启动都从代码重建，省一次几十 KB 的 JSON 解析 */
  seed: boolean;
}

let entries: SuggestEntry[] = [];
/** 标题 -> 词条，避免线性查重 */
let byTitle = new Map<string, SuggestEntry>();
let loadedAt = 0;
let loadTask: Promise<void> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let builtinLoaded = false;
let seedCursor = 0;
let seedTimer: ReturnType<typeof setTimeout> | null = null;
/** 热门榜缓存：空输入时每次渲染都排序 6800 条太浪费 */
let hotCache: SuggestEntry[] | null = null;

/** 纯字母数字才算「拼音查询」，其余按中文片段匹配 */
function isPinyinQuery(query: string): boolean {
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

function invalidateHot(): void {
  hotCache = null;
}

function pushEntry(entry: SuggestEntry): void {
  entries.push(entry);
  byTitle.set(entry.title, entry);
  invalidateHot();
}

function buildEntry(title: string, weight: number, seed: boolean, now: number): SuggestEntry {
  const syllables = pinyinSyllablesOf(title);
  return {
    title,
    initials: initialsOf(title),
    variants: initialsVariantsOf(title),
    fullPinyin: fullPinyinOf(title),
    fullVariants: fullPinyinVariantsOf(title),
    firstSyllable: syllables[0] || "",
    hits: weight,
    updatedAt: now,
    seed,
  };
}

async function persist(): Promise<void> {
  try {
    // 种子不落盘（每次启动从代码重建），只存用户自己的数据
    const own = entries.filter((e) => !e.seed);
    const trimmed = sortEntries([...own]).slice(0, MAX_ENTRIES);
    const serialized = trimmed.map(({ title, hits, updatedAt }) => ({ title, hits, updatedAt }));
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

/**
 * 灌入内置种子：幂等。
 * 命中已存在的词条（比如用户之前搜过同名剧）只标记来源，不改权重 ——
 * 用户数据已经在本地表里存着，等 loadLocalEntries 回来再合并。
 */
function addSeedTitles(titles: string[]): void {
  // 种子统一用 0 作为时间戳。
  // 如果用 Date.now()，分批灌入时后一批的时间戳一定更大，"热门推荐"就会变成
  // 最后一批（最冷门）的片子 —— 排序里 updatedAt 是次级键，但同分时它会生效。
  // 固定 0 之后同分条目保持数组顺序，也就是词库文件里精心排好的热度顺序。
  const now = 0;
  for (const raw of titles) {
    const title = normalizeTitle(raw);
    if (!title || byTitle.has(title)) continue;
    const initials = initialsOf(title);
    if (!initials) continue;
    pushEntry(buildEntry(title, 1, true, now));
  }
}

/** 灌入用户数据（历史/收藏/记录/搜索回包）：累加权重，并标记为需要落盘 */
function addOwnTitles(titles: string[], weight: number): boolean {
  const now = Date.now();
  let changed = false;
  for (const raw of titles) {
    const title = normalizeTitle(raw);
    if (!title) continue;
    const existing = byTitle.get(title);
    if (existing) {
      // 之前的种子条目被用户真实用到了：转成"自己的数据"
      existing.hits = Math.max(existing.hits, weight) + (existing.seed ? 0 : weight);
      existing.updatedAt = now;
      existing.seed = false;
      changed = true;
      continue;
    }
    const initials = initialsOf(title);
    if (!initials) continue;
    pushEntry(buildEntry(title, weight, false, now));
    changed = true;
  }
  if (changed) invalidateHot();
  return changed;
}

/** 豆瓣榜单同时最多打几个：原来 10 个并发，弱网电视上会把首搜的带宽抢干 */
const DOUBAN_CONCURRENCY = 2;

/** 豆瓣榜单当种子：冷启动后联网补充当下新剧 */
export async function fetchDoubanSeeds(): Promise<string[]> {
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

  const titles: string[] = [];
  // 分批串行：每批最多 DOUBAN_CONCURRENCY 个在飞
  for (let i = 0; i < jobs.length; i += DOUBAN_CONCURRENCY) {
    const batch = jobs.slice(i, i + DOUBAN_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((job) => api.getDoubanData(job.type, job.tag, 20, 0))
    );
    for (const r of results) {
      if (r.status !== "fulfilled") continue;
      for (const item of r.value?.list || []) {
        if (item?.title) titles.push(item.title);
      }
    }
  }
  return titles;
}

/**
 * 分批灌入内置种子。
 *
 * 第一批（600 条）同步插完，保证搜索页第一次渲染就有候选；
 * 剩下的每 24ms 补一批，把几百毫秒的索引构建摊开，不阻塞遥控器响应。
 * 每批结束回调 onProgress，页面据此刷新候选列表。
 */
function loadBuiltinSeedsInBatches(onProgress: () => void): void {
  if (builtinLoaded) return;
  builtinLoaded = true;

  const total = BUILTIN_SEED_TITLES.length;
  const first = BUILTIN_SEED_TITLES.slice(0, SEED_BATCH);
  addSeedTitles(first);
  seedCursor = first.length;
  onProgress();

  const pump = () => {
    if (seedCursor >= total) {
      seedTimer = null;
      return;
    }
    const batch = BUILTIN_SEED_TITLES.slice(seedCursor, seedCursor + SEED_BATCH);
    seedCursor += batch.length;
    addSeedTitles(batch);
    onProgress();
    seedTimer = setTimeout(pump, 24);
  };
  seedTimer = setTimeout(pump, 24);
}

async function loadLocalEntries(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    const now = Date.now();
    for (const e of parsed) {
      if (!e || typeof e.title !== "string") continue;
      const title = normalizeTitle(e.title);
      if (!title) continue;
      const existing = byTitle.get(title);
      if (existing) {
        existing.hits = Math.max(existing.hits, Number(e.hits) || 1);
        existing.updatedAt = Number(e.updatedAt) || now;
        existing.seed = false;
        continue;
      }
      const entry = buildEntry(title, Number(e.hits) || 1, false, Number(e.updatedAt) || now);
      if (!entry.initials) continue;
      pushEntry(entry);
    }
    invalidateHot();
  } catch (e) {
    logger.warn("load suggest index failed", e);
  }
}

/** 从本机已有数据（历史 / 收藏 / 记录）补齐词库 */
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

  if (titles.length && addOwnTitles(titles, 2)) schedulePersist();
}

async function loadRemoteSeeds(): Promise<void> {
  try {
    const titles = await fetchDoubanSeeds();
    if (titles.length && addOwnTitles(titles, 1)) schedulePersist();
  } catch (e) {
    logger.warn("load douban seeds failed", e);
  }
}

/** 豆瓣榜单只补一次：成功与否都记下来，避免每次搜索都重打 */
let remoteSeedsTask: Promise<void> | null = null;
let remoteSeedsDone = false;

/**
 * 补拉豆瓣榜单（后台）。
 *
 * 只在**第一次搜索成功之后**调用，打开搜索页时不碰网络 ——
 * 弱网下这 10 个请求会把首个搜索的带宽抢干，用户看到的就是「点了没反应」。
 */
export function warmRemoteSeeds(): void {
  if (remoteSeedsDone || remoteSeedsTask) return;
  remoteSeedsTask = loadRemoteSeeds()
    .catch(() => undefined)
    .finally(() => {
      remoteSeedsDone = true;
      remoteSeedsTask = null;
    });
}

/**
 * 确保词库已就绪。第一次调用会灌种子 + 读本地，之后 6 小时内复用内存。
 *
 * `remote=false`（默认）时**不拉豆瓣**：本地词库（6908 条内置 + 用户历史）
 * 已经够联想，网络留给真正的搜索。需要补新剧时由搜索成功后调 warmRemoteSeeds()。
 */
export function ensureSuggestIndex(
  force = false,
  onProgress?: () => void,
  options: { remote?: boolean } = {}
): Promise<void> {
  if (loadTask) return loadTask;
  if (!force && loadedAt && Date.now() - loadedAt < SEED_TTL_MS) return Promise.resolve();

  loadTask = (async () => {
    // 内置种子同步开第一批：搜索页第一次渲染就能出候选
    loadBuiltinSeedsInBatches(onProgress ?? (() => undefined));
    await loadLocalEntries();
    await loadLocalSeeds();
    loadedAt = Date.now();
    // 豆瓣种子默认不在搜索页拉，见 warmRemoteSeeds 的说明
    if (options.remote) await loadRemoteSeeds();
  })()
    .catch((e) => logger.warn("ensure suggest index failed", e))
    .finally(() => {
      loadTask = null;
    });

  return loadTask;
}

/**
 * 匹配与排序的纯函数，方便单测，不碰存储。
 *
 * - 纯字母/数字：首字母前缀、全拼前缀，任一命中即可
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
    if (!isPinyinQuery(q)) return entry.title.toLowerCase().includes(q);
    if (entry.initials.startsWith(q)) return true;
    if ((entry.variants || []).some((v) => v.startsWith(q))) return true;
    if (entry.fullPinyin && entry.fullPinyin.startsWith(q)) return true;
    if ((entry.fullVariants || []).some((v) => v.startsWith(q))) return true;
    return false;
  });

  /**
   * 匹配质量分级，数字越小越贴近用户意图。
   *
   * 只按「谁更短」排会翻车：用户打 xian 想找「仙逆」，
   * 但「降临」的多音变体 xianglin 也以 xian 开头，而它只有两个字，
   * 于是排到了「仙逆 第一季」前面。分级之后「首音节整段命中」优先，
   * 这种情况就正常了。
   */
  const qualityOf = (e: SuggestEntry): number => {
    // 0：某个写法被完整打出来了，基本是唯一解
    if (e.initials === q || e.fullPinyin === q) return 0;
    if ((e.variants || []).includes(q) || (e.fullVariants || []).includes(q)) return 0;
    if (!isPinyinQuery(q)) return 0; // 中文是包含匹配，不分级
    // 1：第一个字的音打完了（xian → 仙逆）
    if (e.firstSyllable && e.firstSyllable === q) return 1;
    // 2：第一个字的音打了一半
    if (e.firstSyllable && e.firstSyllable.startsWith(q)) return 2;
    // 3：全拼前缀（含多音写法）
    if (e.fullPinyin && e.fullPinyin.startsWith(q)) return 3;
    if ((e.fullVariants || []).some((v) => v.startsWith(q))) return 3;
    // 4：首字母前缀
    return 4;
  };

  matched.sort((a, b) => {
    const qa = qualityOf(a);
    const qb = qualityOf(b);
    if (qa !== qb) return qa - qb;

    const aTitleExact = a.title.toLowerCase() === q ? 0 : 1;
    const bTitleExact = b.title.toLowerCase() === q ? 0 : 1;
    if (aTitleExact !== bTitleExact) return aTitleExact - bTitleExact;

    // 同一档里：用过的（热度高）优先，其次标题更短的（更像正片而不是第 N 季）
    if (b.hits !== a.hits) return b.hits - a.hits;
    if (a.title.length !== b.title.length) return a.title.length - b.title.length;
    return b.updatedAt - a.updatedAt;
  });

  return matched.slice(0, limit);
}

/** 给出联想结果，数据来自当前内存词库 */
export function suggestTitles(query: string, limit = 8): SuggestEntry[] {
  return rankSuggestions(entries, query, limit);
}

/**
 * 还没输入时的「热门推荐」。
 *
 * 排序先看权重（用户搜过/看过的排前面），同权重时**内置种子优先**：
 * 内置表本身就是按豆瓣热度排好的，稳定可预期；
 * 豆瓣实时榜单是后补的，它的 updatedAt 永远最新，若按更新时间排会整批顶到最前面，
 * 于是每次打开搜索页「热门搜索」都不一样 —— 那不是榜单，是随机的。
 */
export function hotTitles(limit = 6): SuggestEntry[] {
  if (!hotCache) {
    hotCache = [...entries].sort((a, b) => {
      if (b.hits !== a.hits) return b.hits - a.hits;
      if (a.seed !== b.seed) return a.seed ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    });
  }
  return hotCache.slice(0, limit);
}

/** 把一次搜索/一次播放的标题记进词库，越用越准 */
export function rememberTitles(titles: string[], weight = 3): void {
  if (!titles?.length) return;
  if (addOwnTitles(titles, weight)) schedulePersist();
}

/** 供测试与调试：清空内存与本地词库 */
export async function resetSuggestIndex(): Promise<void> {
  entries = [];
  byTitle = new Map();
  loadedAt = 0;
  loadTask = null;
  builtinLoaded = false;
  seedCursor = 0;
  hotCache = null;
  if (seedTimer) {
    clearTimeout(seedTimer);
    seedTimer = null;
  }
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

/** 供测试：直接看某个标题的全拼 */
export function fullPinyinOfTitle(title: string): string {
  return fullPinyinOf(title);
}
