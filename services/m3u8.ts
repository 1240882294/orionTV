import Logger from '@/utils/Logger';

const logger = Logger.withTag('M3U8');

interface CacheEntry {
  resolution: string | null;
  timestamp: number;
}

const resolutionCache: { [url: string]: CacheEntry } = {};
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * 探测单个地址的超时。分辨率只是「显示用」的附加信息，
 * 拿到拿不到都不该拖住播放 —— 之前这里没有超时，只要某条线路的
 * m3u8 连接挂住（不返回也不断开），detailStore.init 里的 Promise.all
 * 就永远等不完，界面卡在「正在获取线路…」。
 */
const RESOLUTION_PROBE_TIMEOUT_MS = 4000;

export const getResolutionFromM3U8 = async (
  url: string,
  signal?: AbortSignal
): Promise<string | null> => {
  const perfStart = performance.now();
  logger.info(`[PERF] M3U8 resolution detection START - url: ${url.substring(0, 100)}...`);
  
  // 1. Check cache first
  const cachedEntry = resolutionCache[url];
  if (cachedEntry && Date.now() - cachedEntry.timestamp < CACHE_DURATION) {
    const perfEnd = performance.now();
    logger.info(`[PERF] M3U8 resolution detection CACHED - took ${(perfEnd - perfStart).toFixed(2)}ms, resolution: ${cachedEntry.resolution}`);
    return cachedEntry.resolution;
  }

  if (!url.toLowerCase().endsWith(".m3u8")) {
    logger.info(`[PERF] M3U8 resolution detection SKIPPED - not M3U8 file`);
    return null;
  }

  try {
    // 自带超时，并与外部 signal 联动：外面取消也要立刻停
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RESOLUTION_PROBE_TIMEOUT_MS);
    const onOuterAbort = () => controller.abort();
    signal?.addEventListener("abort", onOuterAbort);

    try {
      const fetchStart = performance.now();
      const response = await fetch(url, { signal: controller.signal });
      const fetchEnd = performance.now();
      logger.info(`[PERF] M3U8 fetch took ${(fetchEnd - fetchStart).toFixed(2)}ms, status: ${response.status}`);

      if (!response.ok) {
        return null;
      }

      const parseStart = performance.now();
      const playlist = await response.text();
      const lines = playlist.split("\n");
      let highestResolution = 0;
      let resolutionString: string | null = null;

      for (const line of lines) {
        if (line.startsWith("#EXT-X-STREAM-INF")) {
          const resolutionMatch = line.match(/RESOLUTION=(\d+)x(\d+)/);
          if (resolutionMatch) {
            const height = parseInt(resolutionMatch[2], 10);
            if (height > highestResolution) {
              highestResolution = height;
              resolutionString = `${height}p`;
            }
          }
        }
      }

      const parseEnd = performance.now();
      logger.info(`[PERF] M3U8 parsing took ${(parseEnd - parseStart).toFixed(2)}ms, lines: ${lines.length}`);

      // 2. Store result in cache
      resolutionCache[url] = {
        resolution: resolutionString,
        timestamp: Date.now(),
      };

      const perfEnd = performance.now();
      logger.info(`[PERF] M3U8 resolution detection COMPLETE - took ${(perfEnd - perfStart).toFixed(2)}ms, resolution: ${resolutionString}`);

      return resolutionString;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onOuterAbort);
    }
  } catch (error) {
    const perfEnd = performance.now();
    logger.info(`[PERF] M3U8 resolution detection ERROR - took ${(perfEnd - perfStart).toFixed(2)}ms, error: ${error}`);
    return null;
  }
};
