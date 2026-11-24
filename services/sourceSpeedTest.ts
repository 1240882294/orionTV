import { api } from "./api";
import Logger from "@/utils/Logger";

const logger = Logger.withTag("SourceSpeedTest");

/** 参与测速的源：只需要拿到 m3u8 地址即可 */
export interface SpeedTestTarget {
  source: string;
  source_name?: string;
  episodes?: string[];
}

/** 单个源的测速结果 */
export interface SourceSpeedResult {
  source: string;
  /** 实测下载速度（字节/秒）；失败时为 null */
  bytesPerSec: number | null;
  /** 采样耗时（毫秒） */
  ms: number | null;
  /** 实际下载的字节数 */
  bytes: number;
  ok: boolean;
  /** 测速方式：真实视频分片 / 接口吞吐 */
  method: "segment" | "api" | "none";
}

export type SpeedGrade = "testing" | "fast" | "good" | "normal" | "slow" | "fail";

/** 采样 512KB：足够反映带宽，又不会在慢源上卡太久 */
const SAMPLE_BYTES = 512 * 1024;
const PLAYLIST_TIMEOUT_MS = 4000;
const SEGMENT_TIMEOUT_MS = 7000;
const CONCURRENCY = 4;
const TOTAL_TIMEOUT_MS = 12000;

/** 把 m3u8 里的相对地址拼成绝对地址（不依赖 URL polyfill，RN 上更稳） */
function resolveUrl(base: string, relative: string): string {
  if (/^https?:\/\//i.test(relative)) return relative;
  const originMatch = base.match(/^(https?:\/\/[^/]+)/i);
  const origin = originMatch ? originMatch[1] : "";
  if (relative.startsWith("//")) return `https:${relative}`;
  if (relative.startsWith("/")) return `${origin}${relative}`;
  const cut = base.lastIndexOf("/");
  return cut > 8 ? `${base.slice(0, cut + 1)}${relative}` : relative;
}

/** master playlist 里挑码率最高的一路：数据量大，测出来的速度更接近真实播放 */
function pickVariant(playlist: string, baseUrl: string): string | null {
  const lines = playlist.split(/\r?\n/).map((line) => line.trim());
  let best: { uri: string; bandwidth: number } | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].startsWith("#EXT-X-STREAM-INF")) continue;
    const bandwidth = Number(lines[i].match(/BANDWIDTH=(\d+)/)?.[1] ?? 0);
    const uri = lines[i + 1];
    if (!uri || uri.startsWith("#")) continue;
    if (!best || bandwidth > best.bandwidth) best = { uri, bandwidth };
  }
  return best ? resolveUrl(baseUrl, best.uri) : null;
}

/** media playlist 里取第一个分片地址 */
function pickSegment(playlist: string, baseUrl: string): string | null {
  const lines = playlist.split(/\r?\n/).map((line) => line.trim());
  const uri = lines.find((line) => line.length > 0 && !line.startsWith("#"));
  return uri ? resolveUrl(baseUrl, uri) : null;
}

async function fetchText(url: string, timeoutMs: number, signal?: AbortSignal): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * 真实测速：下载第一个视频分片的前 512KB。
 * 这是「线路速度」最直接的度量——切过去播放时的下载速率就是这个量级。
 */
async function measureSegmentSpeed(
  playlistUrl: string,
  signal?: AbortSignal
): Promise<{ bytesPerSec: number; ms: number; bytes: number } | null> {
  let currentUrl = playlistUrl;
  let playlist = await fetchText(currentUrl, PLAYLIST_TIMEOUT_MS, signal);
  if (!playlist) return null;

  // 最多解两层：master -> media
  for (let depth = 0; depth < 2 && playlist.includes("#EXT-X-STREAM-INF"); depth += 1) {
    const next = pickVariant(playlist, currentUrl);
    if (!next) return null;
    currentUrl = next;
    playlist = await fetchText(currentUrl, PLAYLIST_TIMEOUT_MS, signal);
    if (!playlist) return null;
  }
  if (playlist.includes("#EXT-X-STREAM-INF")) return null;

  const segmentUrl = pickSegment(playlist, currentUrl);
  if (!segmentUrl) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEGMENT_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);
  const startedAt = Date.now();
  try {
    const response = await fetch(segmentUrl, {
      headers: { Range: `bytes=0-${SAMPLE_BYTES - 1}` },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    const ms = Math.max(1, Date.now() - startedAt);
    if (!buffer || buffer.byteLength === 0) return null;
    return { bytes: buffer.byteLength, ms, bytesPerSec: buffer.byteLength / (ms / 1000) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * 对单个源测速。
 *
 * 优先下载真实视频分片；分片拿不到（源站拒绝 Range、直链失效等）时，
 * 退化为测「服务端取源信息」的吞吐量，保证每个源都能给出一个速度值。
 */
export async function testSourceSpeed(
  target: SpeedTestTarget,
  keyword: string,
  signal?: AbortSignal
): Promise<SourceSpeedResult> {
  const playlistUrl = target.episodes?.find((url) => /\.m3u8(\?|$)/i.test(url));

  if (playlistUrl) {
    const segment = await measureSegmentSpeed(playlistUrl, signal);
    if (segment) {
      return {
        source: target.source,
        bytesPerSec: segment.bytesPerSec,
        ms: segment.ms,
        bytes: segment.bytes,
        ok: true,
        method: "segment",
      };
    }
  }

  try {
    const stats = await api.measureThroughput(keyword, target.source, signal);
    const ms = Math.max(stats.ms, 1);
    return {
      source: target.source,
      bytesPerSec: stats.bytes / (ms / 1000),
      ms,
      bytes: stats.bytes,
      ok: true,
      method: "api",
    };
  } catch (error) {
    logger.debug(`speed test failed: ${target.source}`, error);
    return { source: target.source, bytesPerSec: null, ms: null, bytes: 0, ok: false, method: "none" };
  }
}

export interface SpeedTestOptions {
  concurrency?: number;
  /** 整体超时：超过这个时间不再等剩下的源，用已测出的结果先播 */
  totalTimeoutMs?: number;
  /** 每测完一个就判断是否已经够用，够用就提前结束 */
  shouldStop?: (results: Record<string, SourceSpeedResult>, done: number, total: number) => boolean;
  signal?: AbortSignal;
}

/**
 * 批量测速，返回 「source -> 结果」的映射。
 * 每完成一个就回调一次，界面可以边测边显示。
 */
export async function testSourcesSpeed(
  targets: SpeedTestTarget[],
  keyword: string,
  onResult?: (result: SourceSpeedResult, done: number, total: number) => void,
  options: SpeedTestOptions = {}
): Promise<Record<string, SourceSpeedResult>> {
  const {
    concurrency = CONCURRENCY,
    totalTimeoutMs = TOTAL_TIMEOUT_MS,
    shouldStop,
    signal,
  } = options;

  const results: Record<string, SourceSpeedResult> = {};
  const queue = [...targets];
  const total = targets.length;
  let done = 0;
  let stopped = false;

  const controller = new AbortController();
  const timer = setTimeout(() => {
    stopped = true;
    controller.abort();
  }, totalTimeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);

  const worker = async () => {
    while (!stopped && queue.length > 0) {
      const target = queue.shift();
      if (!target) break;
      const result = await testSourceSpeed(target, keyword, controller.signal);
      if (stopped) break;
      results[target.source] = result;
      done += 1;
      onResult?.(result, done, total);
      if (shouldStop?.(results, done, total)) {
        stopped = true;
        break;
      }
    }
  };

  try {
    await Promise.all(
      Array.from({ length: Math.min(concurrency, Math.max(total, 1)) }, worker)
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }

  return results;
}

const MB = 1024 * 1024;

/** 速度分级，用于决定颜色与文案 */
export function gradeSpeed(result?: SourceSpeedResult | null): SpeedGrade {
  if (!result) return "testing";
  if (!result.ok || !result.bytesPerSec) return "fail";
  if (result.bytesPerSec >= 2 * MB) return "fast";
  if (result.bytesPerSec >= 800 * 1024) return "good";
  if (result.bytesPerSec >= 300 * 1024) return "normal";
  return "slow";
}

export const SPEED_COLORS: Record<SpeedGrade, string> = {
  testing: "rgba(255,255,255,0.45)",
  fast: "#22c55e",
  good: "#84cc16",
  normal: "#f59e0b",
  slow: "#f97316",
  fail: "#ef4444",
};

export const SPEED_LABELS: Record<SpeedGrade, string> = {
  testing: "测速中",
  fast: "极快",
  good: "良好",
  normal: "一般",
  slow: "较慢",
  fail: "不可用",
};

/** 把 B/s 格式化成 "1.2 MB/s" / "320 KB/s" */
export function formatRate(bytesPerSec: number): string {
  if (bytesPerSec >= MB) return `${(bytesPerSec / MB).toFixed(1)} MB/s`;
  return `${Math.max(1, Math.round(bytesPerSec / 1024))} KB/s`;
}

/** 把结果格式化成 "1.2 MB/s · 极快" 这样的展示文案 */
export function formatSpeed(result?: SourceSpeedResult | null): string {
  const grade = gradeSpeed(result);
  if (!result || !result.ok || result.bytesPerSec === null) return SPEED_LABELS[grade];
  return `${formatRate(result.bytesPerSec)} · ${SPEED_LABELS[grade]}`;
}

/** 只取速度值，用于排序 */
export function speedOf(result?: SourceSpeedResult | null): number {
  if (!result || !result.ok || !result.bytesPerSec) return 0;
  return result.bytesPerSec;
}

// ---------------------------------------------------------------------------
// 测速结果缓存
//
// 需求：只在「打开视频」时测一次速，之后（切全屏 / 切竖屏 / 打开线路弹窗）
// 都直接复用这次结果，需要更新时由用户手动点「测速」。所以这里用一个带 TTL 的
// 进程内缓存，并把变更广播给正在展示速度的界面。
// ---------------------------------------------------------------------------

/** 缓存有效期：10 分钟，超过则视为过期，重新打开视频时会再测一次 */
const CACHE_TTL_MS = 10 * 60 * 1000;

interface SpeedCacheEntry {
  at: number;
  results: Record<string, SourceSpeedResult>;
}

const speedCache = new Map<string, SpeedCacheEntry>();

type SpeedListener = (title: string, results: Record<string, SourceSpeedResult>) => void;
const speedListeners = new Set<SpeedListener>();

const cacheKeyOf = (title: string) => (title || "").trim().toLowerCase();

/** 读取缓存；不存在或已过期返回 null */
export function getCachedSpeeds(title: string): Record<string, SourceSpeedResult> | null {
  const entry = speedCache.get(cacheKeyOf(title));
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL_MS) return null;
  return entry.results;
}

/** 写入缓存并通知订阅者；merge=true 时与已有结果合并（用于逐个完成的增量更新） */
export function setCachedSpeeds(
  title: string,
  results: Record<string, SourceSpeedResult>,
  merge = false
): void {
  const key = cacheKeyOf(title);
  if (!key) return;
  const prev = merge ? speedCache.get(key)?.results ?? {} : {};
  const next = { ...prev, ...results };
  speedCache.set(key, { at: Date.now(), results: next });
  speedListeners.forEach((listener) => {
    try {
      listener(key, next);
    } catch {
      // 单个订阅者异常不影响其他界面
    }
  });
}

/** 订阅测速结果变更，返回取消订阅函数 */
export function subscribeSpeeds(listener: SpeedListener): () => void {
  speedListeners.add(listener);
  return () => {
    speedListeners.delete(listener);
  };
}

/** 输入标题时的匹配键，供界面判断推送是否属于当前影片 */
export function speedCacheKey(title: string): string {
  return cacheKeyOf(title);
}
