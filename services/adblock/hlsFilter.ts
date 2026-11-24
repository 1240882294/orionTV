/**
 * HLS 播放列表清洗：把贴片/插播广告从 m3u8 里剔除，并把所有相对地址改成绝对地址，
 * 这样清洗后的列表可以被写成手机本地文件直接交给播放器（本地文件没有 base URL 可解析）。
 *
 * 识别依据（按可信度排序）：
 * 1. SCTE-35 标记：`#EXT-X-CUE-OUT` / `#EXT-X-CUE-OUT-CONT` 与 `#EXT-X-CUE-IN` 之间的分片；
 * 2. 片头贴片：开头几段来自「全片只出现一两次的域名」，且累计时长不超过 2 分钟；
 * 3. 明显的广告域名 / 路径（doubleclick、preroll、ads 等）。
 *
 * 为了避免把正片删掉，前两类都带「时长 + 占比」保护：一旦疑似广告超过总时长 30%
 * 或超过 5 分钟，就认为这个源是在用 CUE 做内容分段，放弃删除。
 */
import { hostOf, isLikelyAdUri, resolveUrl } from "./hlsUrl";

export interface FilterOptions {
  /** 疑似广告占总时长超过该比例时，判定为误判并放弃删除 */
  maxAdRatio?: number;
  /** CUE 标记广告的总时长上限（秒） */
  maxCueSeconds?: number;
  /** 片头贴片的累计时长上限（秒） */
  maxPrerollSeconds?: number;
}

export interface FilterResult {
  playlist: string;
  /** 被删除的分片数 */
  removedSegments: number;
  /** 被删除分片的总时长（秒） */
  removedSeconds: number;
  /** 原列表总时长（秒） */
  totalSeconds: number;
  changed: boolean;
}

interface RawSegment {
  tags: string[];
  uri: string;
  duration: number;
  cue: boolean;
}

const DEFAULT_OPTIONS: Required<FilterOptions> = {
  maxAdRatio: 0.3,
  maxCueSeconds: 300,
  maxPrerollSeconds: 120,
};

/** 只用于广告标记的标签，输出时一律丢掉 */
const AD_MARKER_TAG =
  /^#EXT-X-(CUE-OUT|CUE-OUT-CONT|CUE-IN|SCTE35|ASSET)\b|^#EXT-OATCLS-SCTE35\b/i;

/** 删除广告分片时必须保留、并顺延到下一段的标签（解密/初始化信息） */
const CARRY_TAG = /^#EXT-X-(KEY|MAP)\b/i;

export function isMasterPlaylist(text: string): boolean {
  return /^#EXT-X-STREAM-INF:/im.test(text);
}

export function hasEndList(text: string): boolean {
  return /^#EXT-X-ENDLIST/im.test(text);
}

function extinfDuration(tags: string[]): number {
  for (let i = tags.length - 1; i >= 0; i -= 1) {
    const tag = tags[i];
    if (tag.startsWith("#EXTINF:")) {
      const value = parseFloat(tag.slice("#EXTINF:".length));
      return Number.isFinite(value) && value > 0 ? value : 0;
    }
  }
  return 0;
}

/** 标签里的 URI="..." 也要绝对化，否则本地文件播放时找不到密钥/初始化分片 */
function absolutizeTag(line: string, baseUrl: string): string {
  if (!/^#EXT-X-(KEY|SESSION-KEY|MAP|MEDIA|I-FRAME-STREAM-INF|SESSION-DATA)/i.test(line)) {
    return line;
  }
  return line.replace(/URI="([^"]*)"/gi, (_match, uri: string) => `URI="${resolveUrl(uri, baseUrl)}"`);
}

function isAdMarker(line: string): boolean {
  const upper = line.toUpperCase();
  if (upper.startsWith("#EXT-X-CUE-IN")) return true;
  if (upper.startsWith("#EXT-X-CUE-OUT")) return true;
  if (upper.startsWith("#EXT-X-DATERANGE")) {
    // 只丢掉明确标记为广告的 DATERANGE，普通内容元数据保留
    return /CLASS="(ad|com\.apple\.hls\.interstitial)"/i.test(line) || /SCTE35-(OUT|IN)/i.test(line);
  }
  return AD_MARKER_TAG.test(line);
}

/** 解析出所有分片及其前置标签 */
function parseSegments(text: string, baseUrl: string): {
  header: string[];
  segments: RawSegment[];
  footer: string[];
} {
  const lines = text.split(/\r?\n/);
  const header: string[] = [];
  const footer: string[] = [];
  const segments: RawSegment[] = [];

  let pending: string[] = [];
  let cueOpen = false;
  let sawSegment = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (!line.startsWith("#")) {
      segments.push({
        tags: pending,
        uri: resolveUrl(line, baseUrl),
        duration: extinfDuration(pending),
        cue: cueOpen,
      });
      pending = [];
      sawSegment = true;
      continue;
    }

    const upper = line.toUpperCase();
    if (upper.startsWith("#EXT-X-CUE-IN")) {
      cueOpen = false;
      continue;
    }
    if (upper.startsWith("#EXT-X-CUE-OUT")) {
      // 包含 CUE-OUT-CONT：有些源只发 CONT 不发 OUT
      cueOpen = true;
      continue;
    }
    if (isAdMarker(line)) continue;

    if (!sawSegment && !upper.startsWith("#EXTINF")) {
      // 第一段之前的标签（VERSION / TARGETDURATION / KEY / MAP …）都是全局头
      header.push(line);
      continue;
    }
    pending.push(line);
  }

  // 最后一个分片之后的标签（ENDLIST 等）
  if (pending.length > 0) footer.push(...pending);

  return { header, segments, footer };
}

/**
 * 找出片头贴片：主线正片通常来自同一个「主力域名」，
 * 只有出现在主力域名之前的、之后不再出现的域名才算贴片。
 * 这样整片同一个 CDN 的源不会被误删。
 */
function findPreroll(segments: RawSegment[], maxSeconds: number): Set<number> {
  const result = new Set<number>();
  if (segments.length < 2) return result;

  const hostCount = new Map<string, number>();
  for (const segment of segments) {
    const host = hostOf(segment.uri);
    if (!host) continue;
    hostCount.set(host, (hostCount.get(host) ?? 0) + 1);
  }

  let mainHost = "";
  let mainCount = 0;
  let mainLastIndex = -1;
  hostCount.forEach((count, host) => {
    let lastIndex = -1;
    for (let i = segments.length - 1; i >= 0; i -= 1) {
      if (hostOf(segments[i].uri) === host) {
        lastIndex = i;
        break;
      }
    }
    // 出现次数多、且更靠后的域名才是正片主线（片头贴片一般只在开头出现）
    if (count > mainCount || (count === mainCount && lastIndex > mainLastIndex)) {
      mainCount = count;
      mainHost = host;
      mainLastIndex = lastIndex;
    }
  });
  if (!mainHost) return result;

  // 主力域名从第几段开始；此刻之前的段才可能是贴片
  let mainStart = segments.findIndex((segment) => hostOf(segment.uri) === mainHost);
  if (mainStart <= 0) return result;
  mainStart = Math.min(mainStart, 3);

  let acc = 0;
  for (let i = 0; i < mainStart; i += 1) {
    const host = hostOf(segments[i].uri);
    if (!host) break;
    // 这个域名在后面正片里还出现，说明是同一 CDN 的轮转，不能删
    const appearsLater = segments
      .slice(mainStart)
      .some((segment) => hostOf(segment.uri) === host);
    if (appearsLater) break;

    acc += segments[i].duration;
    if (acc > maxSeconds) break;
    result.add(i);
  }

  return result;
}

export function filterMediaPlaylist(
  text: string,
  baseUrl: string,
  options: FilterOptions = {}
): FilterResult {
  const { maxAdRatio, maxCueSeconds, maxPrerollSeconds } = { ...DEFAULT_OPTIONS, ...options };
  const { header, segments, footer } = parseSegments(text, baseUrl);

  const totalSeconds = segments.reduce((sum, item) => sum + item.duration, 0);
  const original: FilterResult = {
    playlist: text,
    removedSegments: 0,
    removedSeconds: 0,
    totalSeconds,
    changed: false,
  };

  // 少于两段没什么可过滤的，直接原样返回（也避免把单段列表清空）
  if (segments.length < 2) return original;

  const cueAds = new Set<number>();
  let cueSeconds = 0;
  segments.forEach((segment, index) => {
    if (segment.cue) {
      cueAds.add(index);
      cueSeconds += segment.duration;
    }
  });

  // 保护：CUE 覆盖太多说明不是广告，而是内容分段
  const cueTrusted =
    cueAds.size > 0 && cueSeconds > 0 && cueSeconds <= maxCueSeconds && cueSeconds <= totalSeconds * maxAdRatio;
  if (!cueTrusted) cueAds.clear();

  const prerollAds = findPreroll(segments, maxPrerollSeconds);

  const keywordAds = new Set<number>();
  segments.forEach((segment, index) => {
    if (cueAds.has(index) || prerollAds.has(index)) return;
    if (isLikelyAdUri(segment.uri)) keywordAds.add(index);
  });

  // 关键字规则最容易误伤（有些源整条路径就叫 /ad/xxx），超过三成就不采信
  if (keywordAds.size > Math.max(1, Math.floor(segments.length * 0.3))) {
    keywordAds.clear();
  }

  const adIndexes = new Set<number>([...cueAds, ...prerollAds, ...keywordAds]);
  if (adIndexes.size === 0) return original;

  const kept = segments.filter((_, index) => !adIndexes.has(index));
  if (kept.length === 0) return original;

  // 删除开头的分片后，MEDIA-SEQUENCE 要顺延，否则播放器会认为序列倒退
  let leadingRemoved = 0;
  while (leadingRemoved < segments.length && adIndexes.has(leadingRemoved)) {
    leadingRemoved += 1;
  }

  const outHeader = header.map((rawLine) => {
    const line = absolutizeTag(rawLine, baseUrl);
    const upper = line.toUpperCase();
    if (upper.startsWith("#EXT-X-MEDIA-SEQUENCE:") && leadingRemoved > 0) {
      const base = parseInt(line.slice("#EXT-X-MEDIA-SEQUENCE:".length), 10) || 0;
      return `#EXT-X-MEDIA-SEQUENCE:${base + leadingRemoved}`;
    }
    if (upper.startsWith("#EXT-X-DISCONTINUITY-SEQUENCE:") && leadingRemoved > 0) {
      const base = parseInt(line.slice("#EXT-X-DISCONTINUITY-SEQUENCE:".length), 10) || 0;
      return `#EXT-X-DISCONTINUITY-SEQUENCE:${base + leadingRemoved}`;
    }
    return line;
  });

  const out: string[] = [...outHeader];
  // 被删分片里的 KEY / MAP 不能丢：它可能作用于后续正片，顺延到下一段之前
  let carry: string[] = [];

  segments.forEach((segment, index) => {
    if (adIndexes.has(index)) {
      segment.tags.forEach((tag) => {
        if (CARRY_TAG.test(tag)) carry.push(absolutizeTag(tag, baseUrl));
      });
      return;
    }

    const carrySet = new Set(carry);
    if (carry.length > 0) {
      out.push(...carry);
      carry = [];
    }
    for (const tag of segment.tags) {
      if (isAdMarker(tag) || carrySet.has(tag)) continue;
      out.push(absolutizeTag(tag, baseUrl));
    }
    out.push(segment.uri);
  });

  out.push(...footer);

  const removedSeconds = segments
    .filter((_, index) => adIndexes.has(index))
    .reduce((sum, segment) => sum + segment.duration, 0);

  return {
    playlist: out.join("\n"),
    removedSegments: adIndexes.size,
    removedSeconds,
    totalSeconds,
    changed: true,
  };
}

export interface VariantInfo {
  attrs: string;
  uri: string;
  bandwidth: number;
}

/** 解析 master 列表里的清晰度变体 */
export function parseMasterPlaylist(text: string, baseUrl: string): VariantInfo[] {
  const lines = text.split(/\r?\n/);
  const variants: VariantInfo[] = [];
  let pendingAttrs: string | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("#EXT-X-STREAM-INF:")) {
      pendingAttrs = line.slice("#EXT-X-STREAM-INF:".length);
      continue;
    }
    if (line.startsWith("#")) continue;
    if (pendingAttrs === null) continue;

    const bandwidthMatch = pendingAttrs.match(/BANDWIDTH=(\d+)/i);
    variants.push({
      attrs: pendingAttrs,
      uri: resolveUrl(line, baseUrl),
      bandwidth: bandwidthMatch ? parseInt(bandwidthMatch[1], 10) : 0,
    });
    pendingAttrs = null;
  }

  return variants;
}

/**
 * 重写 master 列表：把变体地址替换成本地清洗后的地址，
 * 其余（音频轨、字幕、I-FRAME 列表）保留并绝对化。
 */
export function rewriteMasterPlaylist(
  text: string,
  baseUrl: string,
  replacements: Map<string, string>
): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  let expectVariantUri = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("#EXT-X-STREAM-INF:")) {
      out.push(line);
      expectVariantUri = true;
      continue;
    }

    if (line.startsWith("#EXT-X-MEDIA:")) {
      out.push(
        line.replace(/URI="([^"]*)"/i, (_match, uri: string) => {
          const absolute = resolveUrl(uri, baseUrl);
          return `URI="${replacements.get(absolute) ?? absolute}"`;
        })
      );
      continue;
    }

    if (!line.startsWith("#")) {
      const absolute = resolveUrl(line, baseUrl);
      if (expectVariantUri) {
        out.push(replacements.get(absolute) ?? absolute);
        expectVariantUri = false;
      } else {
        out.push(replacements.get(absolute) ?? absolute);
      }
      continue;
    }

    out.push(line);
  }

  return out.join("\n");
}
