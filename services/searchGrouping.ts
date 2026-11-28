import type { SearchResult } from "./api";

/**
 * 搜索结果分组。
 *
 * 服务端 `/api/search` 是逐源返回的：同一部剧在 N 个源各有一条记录，
 * 搜索页直接平铺就会出现「愚者之夜 × 9」这种重复卡（实测 189 条里
 * 真正不同的剧只有个位数）。详情页本来就是按 `source` 把这些记录合并成
 * 线路列表的，所以搜索页只需要在展示层折叠一次。
 */
export interface GroupedResult {
  /** 归一化后的标题，仅用于分组定位 */
  key: string;
  /** 展示用标题（取组内第一条原标题） */
  title: string;
  year: string;
  poster: string;
  /** 组内代表条目，卡片跳转用 */
  primary: SearchResult;
  /** 组内全部源，数量即线路数 */
  sources: SearchResult[];
  /** 组内最全的那个源的集数，卡片角标展示用 */
  totalEpisodes: number;
}

/** 全角括号、方括号、书名号里的内容多半是年份/清晰度/语言标注，不参与比较 */
const BRACKET_RE = /[（(【\[][^）)】\]]*[）)】\]]/g;

/**
 * 标题归一化：全角转半角 → 去括号标注 → 压缩空白与连接符 → 转小写。
 *
 * 只做保守清洗：宁可少合并（多出一张卡，不好看但不错），
 * 也不做「删掉国语/高清/完整版」这类后缀裁剪，避免把不同剧并到一起。
 */
export function normalizeTitle(title: string): string {
  if (!title) return "";
  const halfWidth = title
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, " ");
  return halfWidth
    .replace(BRACKET_RE, " ")
    .replace(/[\s·・\-—_]+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * 按标题聚合，年份做兜底区分。
 *
 * - 归一化标题相同才可能同组；
 * - 两条都带年份且不同 → 拆成两组（同名不同版：动画/电视剧）；
 * - 任一方年份为空 → 视为同一组（很多源不返回年份，不能因此拆开）；
 * - 输出顺序 = 首次出现的顺序，即服务端的热度顺序，不重排。
 */
export function groupByTitle(list: readonly SearchResult[]): GroupedResult[] {
  const buckets = new Map<string, GroupedResult[]>();
  const ordered: GroupedResult[] = [];

  for (const item of list) {
    const title = (item.title || "").trim();
    if (!title) continue;

    const key = normalizeTitle(title) || title;
    const year = (item.year || "").trim();

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
    }

    // 年份不冲突才能进同一组：空年视为兼容
    let target = bucket.find((g) => !g.year || !year || g.year === year);
    if (!target) {
      target = {
        key,
        title,
        year,
        poster: item.poster || "",
        primary: item,
        sources: [],
        totalEpisodes: 0,
      };
      bucket.push(target);
      ordered.push(target);
    }

    target.sources.push(item);
    if (!target.year && year) target.year = year;
    // 组内第一条可能没海报，用后面有图的补上，避免卡片空白
    if (!target.poster && item.poster) target.poster = item.poster;
    if (!target.primary.poster && item.poster) target.primary = item;

    const episodes = item.episodes?.length ?? 0;
    if (episodes > target.totalEpisodes) target.totalEpisodes = episodes;
  }

  return ordered;
}
