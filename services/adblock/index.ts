/**
 * 广告过滤（HLS）
 *
 * 思路：播放器只认一个 URL，无法在原生播放器内部拦截广告请求，
 * 所以先把 m3u8 拉下来、把广告分片剔除、把所有地址改成绝对地址，
 * 再写成 App 缓存目录里的本地播放列表交给播放器。
 * 这样正片照常走 CDN，广告分片根本不会被请求。
 *
 * 安全兜底：
 * - 只处理 .m3u8，且只处理带 `#EXT-X-ENDLIST` 的点播列表（直播列表会滚动，落地会卡死）；
 * - 请求加超时（默认 4s），超时/失败一律回退原始地址；
 * - 某条线路的本地列表播放失败时，把它的域名拉黑，本次运行不再尝试；
 * - 过滤规则本身带「误判保护」，详见 hlsFilter.ts。
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import RNBlobUtil from "react-native-blob-util";
import Logger from "@/utils/Logger";
import { hostOf } from "./hlsUrl";
import {
  filterMediaPlaylist,
  hasEndList,
  isMasterPlaylist,
  parseMasterPlaylist,
  rewriteMasterPlaylist,
} from "./hlsFilter";

const logger = Logger.withTag("AdBlock");

const CACHE_TTL = 10 * 60 * 1000;
const CACHE_LIMIT = 40;
const MAX_VARIANTS = 4;
const STATS_KEY = "orion_adblock_stats";

/** 惰性取缓存目录：模块加载阶段不触碰原生模块，避免冷启动时拿到未初始化的常量 */
let localDir: string | null = null;
function getLocalDir(): string {
  if (!localDir) {
    localDir = `${RNBlobUtil.fs.dirs.CacheDir}/adblock`;
  }
  return localDir;
}

const USER_AGENT =
  "Mozilla/5.0 (Linux; Android 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

export interface AdBlockResolveOptions {
  enabled: boolean;
  /** 单次请求超时（毫秒） */
  timeoutMs?: number;
}

export interface AdBlockResolveResult {
  /** 真正交给播放器的地址 */
  url: string;
  originalUrl: string;
  /** 被剔除的广告分片数量 */
  removedSegments: number;
  /** 被剔除的广告时长（秒） */
  removedSeconds: number;
  /** 是否换成了本地清洗后的播放列表 */
  local: boolean;
  /** 直播列表（无法落地，保持原样） */
  live: boolean;
  /** 是否真的执行过过滤流程 */
  applied: boolean;
  reason?: string;
}

export interface AdBlockStats {
  segments: number;
  seconds: number;
  updatedAt: number;
}

const cache = new Map<string, { result: AdBlockResolveResult; at: number }>();
const inflight = new Map<string, Promise<AdBlockResolveResult>>();
/** 本地列表播放失败的域名，本次运行内不再尝试 */
const failedHosts = new Set<string>();

let dirReady = false;
let writtenFiles = 0;

function hashKey(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

async function ensureDir(): Promise<void> {
  if (dirReady) return;
  const dir = getLocalDir();
  const exists = await RNBlobUtil.fs.isDir(dir).catch(() => false);
  if (!exists) {
    await RNBlobUtil.fs.mkdir(dir).catch(() => {});
  }
  dirReady = true;
}

/** 缓存目录里的小文件越攒越多时清一次，避免占用过多空间 */
async function pruneIfNeeded(): Promise<void> {
  if (writtenFiles < 80) return;
  writtenFiles = 0;
  try {
    const dir = getLocalDir();
    const files = await RNBlobUtil.fs.ls(dir);
    await Promise.all(
      files.filter((name) => name.endsWith(".m3u8")).map((name) => RNBlobUtil.fs.unlink(`${dir}/${name}`))
    );
    logger.info(`[AdBlock] pruned ${files.length} cached playlists`);
  } catch (error) {
    logger.debug("[AdBlock] prune failed", error);
  }
}

async function writeLocalPlaylist(name: string, content: string): Promise<string> {
  await ensureDir();
  await pruneIfNeeded();
  const path = `${getLocalDir()}/${name}`;
  await RNBlobUtil.fs.writeFile(path, content, "utf8");
  writtenFiles += 1;
  return `file://${path}`;
}

async function fetchText(url: string, timeoutMs: number): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "*/*" },
    });
    if (!response.ok) return null;
    const text = await response.text();
    return text && text.includes("#EXTM3U") ? text : null;
  } catch (error) {
    logger.debug(`[AdBlock] fetch failed: ${url.slice(0, 80)}`, error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function runFilter(rawUrl: string, timeoutMs: number): Promise<AdBlockResolveResult> {
  const base: AdBlockResolveResult = {
    url: rawUrl,
    originalUrl: rawUrl,
    removedSegments: 0,
    removedSeconds: 0,
    local: false,
    live: false,
    applied: true,
  };

  const text = await fetchText(rawUrl, timeoutMs);
  if (!text) return { ...base, reason: "fetch-failed" };

  // 多码率 master：逐个清洗变体，再生成一份指向本地列表的 master
  if (isMasterPlaylist(text)) {
    const variants = parseMasterPlaylist(text, rawUrl)
      .sort((a, b) => b.bandwidth - a.bandwidth)
      .slice(0, MAX_VARIANTS);

    if (variants.length === 0) return { ...base, reason: "no-variant" };

    const replacements = new Map<string, string>();
    let removedSegments = 0;
    let removedSeconds = 0;

    await Promise.all(
      variants.map(async (variant) => {
        const media = await fetchText(variant.uri, timeoutMs);
        if (!media || !hasEndList(media)) return;
        const filtered = filterMediaPlaylist(media, variant.uri);
        if (!filtered.changed) return;
        try {
          const localUri = await writeLocalPlaylist(`${hashKey(variant.uri)}.m3u8`, filtered.playlist);
          replacements.set(variant.uri, localUri);
          removedSegments += filtered.removedSegments;
          removedSeconds += filtered.removedSeconds;
        } catch (error) {
          logger.debug("[AdBlock] write variant failed", error);
        }
      })
    );

    if (replacements.size === 0) return { ...base, reason: "clean" };

    try {
      const master = rewriteMasterPlaylist(text, rawUrl, replacements);
      const localUri = await writeLocalPlaylist(`${hashKey(rawUrl)}-master.m3u8`, master);
      await recordAdBlockStats(removedSegments, removedSeconds);
      logger.info(
        `[AdBlock] master cleaned - variants: ${replacements.size}, removed: ${removedSegments} segments`
      );
      return { ...base, url: localUri, local: true, removedSegments, removedSeconds };
    } catch (error) {
      logger.debug("[AdBlock] write master failed", error);
      return { ...base, reason: "write-failed" };
    }
  }

  // 直播 m3u8 会不断滚动，落地成文件就会卡死，直接透传
  if (!hasEndList(text)) {
    return { ...base, live: true, reason: "live" };
  }

  const filtered = filterMediaPlaylist(text, rawUrl);
  if (!filtered.changed) return { ...base, reason: "clean" };

  try {
    const localUri = await writeLocalPlaylist(`${hashKey(rawUrl)}.m3u8`, filtered.playlist);
    await recordAdBlockStats(filtered.removedSegments, filtered.removedSeconds);
    logger.info(`[AdBlock] playlist cleaned - removed ${filtered.removedSegments} segments`);
    return {
      ...base,
      url: localUri,
      local: true,
      removedSegments: filtered.removedSegments,
      removedSeconds: filtered.removedSeconds,
    };
  } catch (error) {
    logger.debug("[AdBlock] write playlist failed", error);
    return { ...base, reason: "write-failed" };
  }
}

/**
 * 把原始播放地址转换为「已去广告」的地址。
 * 任何异常都会回退为原始地址，绝不因为去广告导致播不了。
 */
export async function resolveAdFreePlaybackUrl(
  rawUrl: string,
  options: AdBlockResolveOptions
): Promise<AdBlockResolveResult> {
  const fallback: AdBlockResolveResult = {
    url: rawUrl,
    originalUrl: rawUrl,
    removedSegments: 0,
    removedSeconds: 0,
    local: false,
    live: false,
    applied: false,
  };

  if (!options.enabled) return { ...fallback, reason: "disabled" };
  if (!rawUrl || !/^https?:\/\//i.test(rawUrl)) return { ...fallback, reason: "not-http" };
  if (!/\.m3u8(?:[?#]|$)/i.test(rawUrl)) return { ...fallback, reason: "not-hls" };

  const host = hostOf(rawUrl);
  if (host && failedHosts.has(host)) return { ...fallback, reason: "host-disabled" };

  const cached = cache.get(rawUrl);
  if (cached && Date.now() - cached.at < CACHE_TTL) return cached.result;

  const existing = inflight.get(rawUrl);
  if (existing) return existing;

  const task = runFilter(rawUrl, options.timeoutMs ?? 4000)
    .catch((error) => {
      logger.debug("[AdBlock] unexpected failure", error);
      return { ...fallback, reason: "error" };
    })
    .then((result) => {
      if (cache.size >= CACHE_LIMIT) {
        const oldest = Array.from(cache.entries()).sort((a, b) => a[1].at - b[1].at)[0];
        if (oldest) cache.delete(oldest[0]);
      }
      cache.set(rawUrl, { result, at: Date.now() });
      inflight.delete(rawUrl);
      return result;
    });

  inflight.set(rawUrl, task);
  return task;
}

/** 本地清洗列表播放失败时调用：这条线路的域名本次运行内不再尝试本地化 */
export function reportAdBlockPlaybackFailure(result: AdBlockResolveResult): void {
  if (!result.local) return;
  const host = hostOf(result.originalUrl);
  if (host) {
    failedHosts.add(host);
    logger.info(`[AdBlock] disable local playlist for host: ${host}`);
  }
  // 已写好的本地列表可能有问题，从缓存里清掉，下次重新判断
  cache.delete(result.originalUrl);
}

export async function getAdBlockStats(): Promise<AdBlockStats> {
  try {
    const raw = await AsyncStorage.getItem(STATS_KEY);
    if (!raw) return { segments: 0, seconds: 0, updatedAt: 0 };
    const parsed = JSON.parse(raw) as Partial<AdBlockStats>;
    return {
      segments: parsed.segments ?? 0,
      seconds: parsed.seconds ?? 0,
      updatedAt: parsed.updatedAt ?? 0,
    };
  } catch (error) {
    return { segments: 0, seconds: 0, updatedAt: 0 };
  }
}

async function recordAdBlockStats(segments: number, seconds: number): Promise<void> {
  if (segments <= 0) return;
  try {
    const current = await getAdBlockStats();
    const next: AdBlockStats = {
      segments: current.segments + segments,
      seconds: Math.round(current.seconds + seconds),
      updatedAt: Date.now(),
    };
    await AsyncStorage.setItem(STATS_KEY, JSON.stringify(next));
  } catch (error) {
    logger.debug("[AdBlock] save stats failed", error);
  }
}

export async function clearAdBlockStats(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STATS_KEY);
  } catch (error) {
    logger.debug("[AdBlock] clear stats failed", error);
  }
}
