/**
 * HLS(m3u8) 播放列表的 URL 解析与广告识别规则。
 *
 * 这里刻意只做「纯函数 + 正则」，不依赖 React Native，方便单测。
 */

/** 明显的广告域名（CDN / 广告投放平台） */
const AD_HOST_PATTERNS: RegExp[] = [
  /(^|\.)doubleclick\.net$/i,
  /(^|\.)googlesyndication\.com$/i,
  /(^|\.)googleadservices\.com$/i,
  /(^|\.)imasdk\.googleapis\.com$/i,
  /(^|\.)adservice\.google\.[a-z.]+$/i,
  /(^|\.)adsystem\.com$/i,
  /(^|\.)adnxs\.com$/i,
  /(^|\.)criteo\.(com|net)$/i,
  /(^|\.)taboola\.com$/i,
  /(^|\.)outbrain\.com$/i,
  /(^|\.)scorecardresearch\.com$/i,
  /(^|\.)admaster\.com\.cn$/i,
  /(^|\.)miaozhen\.com$/i,
  /(^|\.)irs01\.(com|net)$/i,
];

/**
 * 路径 / 文件名里的广告段标识。
 * 用分隔符包住关键字，避免把 download、shadow、loader 这类正常单词误判。
 */
const AD_PATH_PATTERN =
  /(?:^|[/._-])(ad|ads|adv|advert|adverts|advertisement|advertising|preroll|pre-roll|midroll|mid-roll|postroll|post-roll|promo|promos|sponsor|sponsored|trailer|interstitial)(?:[/._-]|$)/i;

/** 从 URI 里取出 host（无 host 返回空串） */
export function hostOf(uri: string): string {
  const match = uri.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i);
  if (!match) return "";
  return match[1].toLowerCase().replace(/:\d+$/, "");
}

/** 直接按域名/路径判断是不是广告资源 */
export function isLikelyAdUri(uri: string): boolean {
  if (!uri) return false;
  const host = hostOf(uri);
  if (host && AD_HOST_PATTERNS.some((pattern) => pattern.test(host))) return true;

  // 只看 path + query，不看协议与 host，避免 host 里恰好含 ad 字样被误杀
  const rest = uri.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]+/i, "");
  return AD_PATH_PATTERN.test(rest);
}

/**
 * 相对地址转绝对地址。
 * RN 里的 URL 实现不完整，这里手写一套够用的 RFC 3986 相对解析。
 */
export function resolveUrl(relative: string, base: string): string {
  const ref = (relative || "").trim();
  if (!ref) return base;
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) return ref; // 已是绝对地址（含 data:）
  if (ref.startsWith("//")) {
    const scheme = base.match(/^([a-z][a-z0-9+.-]*):/i);
    return `${scheme ? scheme[1] : "https"}:${ref}`;
  }

  const baseMatch = base.match(/^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)/i);
  if (!baseMatch) return ref;
  const [, scheme, authority, basePath] = baseMatch;

  if (ref.startsWith("#")) return `${scheme}://${authority}${basePath}${ref}`;
  if (ref.startsWith("?")) return `${scheme}://${authority}${basePath}${ref}`;
  if (ref.startsWith("/")) return `${scheme}://${authority}${normalizePath(ref)}`;

  const dir = basePath.slice(0, basePath.lastIndexOf("/") + 1) || "/";
  return `${scheme}://${authority}${normalizePath(dir + ref)}`;
}

/** 折叠路径里的 ./ 与 ../，保留 query / hash */
function normalizePath(path: string): string {
  const hashIndex = path.search(/[?#]/);
  const tail = hashIndex >= 0 ? path.slice(hashIndex) : "";
  const pure = hashIndex >= 0 ? path.slice(0, hashIndex) : path;

  const trailingSlash = pure.endsWith("/");
  const parts = pure.split("/");
  const stack: string[] = [];

  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (part === "." || part === "") {
      // 开头的空串代表根目录，保留
      if (i === 0) stack.push("");
      continue;
    }
    if (part === "..") {
      if (stack.length > 1) stack.pop();
      continue;
    }
    stack.push(part);
  }

  let result = stack.join("/");
  if (!result.startsWith("/")) result = `/${result}`;
  if (trailingSlash && !result.endsWith("/")) result += "/";
  return result + tail;
}
