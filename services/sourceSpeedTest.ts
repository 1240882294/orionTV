import { api } from "./api";
import Logger from "@/utils/Logger";

const logger = Logger.withTag("SourceSpeedTest");

/** 单个源的测速结果 */
export interface SourceSpeedResult {
  source: string;
  /** 往返耗时（毫秒）；失败时为 null */
  ms: number | null;
  ok: boolean;
}

export type SpeedGrade = "testing" | "fast" | "good" | "normal" | "slow" | "fail";

/** 测速超时：源站慢的时候不要拖住整个弹窗 */
const TIMEOUT_MS = 6000;
/** 并发数：太多会打满后端带宽，反而把结果测歪 */
const CONCURRENCY = 4;

/**
 * 对单个源测速。
 *
 * 走的是 App 自己的服务端代理 `/api/search/one`，因此测出来的是
 * 「服务端 → 源站」的真实响应延迟，和用户切源后能不能马上出结果一致。
 * 搜索结果为空不算失败——只要 HTTP 通了，就说明源站活着。
 */
export async function testSourceSpeed(source: string, keyword: string): Promise<SourceSpeedResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    await api.searchVideo(keyword, source, controller.signal);
    const ms = Date.now() - startedAt;
    return { source, ms, ok: true };
  } catch (error) {
    logger.debug(`speed test failed: ${source}`, error);
    return { source, ms: null, ok: false };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 批量测速，返回 「source -> 结果」的映射。
 * 每完成一个就回调一次，弹窗可以边测边显示，不用等全部结束。
 */
export async function testSourcesSpeed(
  sources: string[],
  keyword: string,
  onResult?: (result: SourceSpeedResult) => void
): Promise<Record<string, SourceSpeedResult>> {
  const results: Record<string, SourceSpeedResult> = {};
  const queue = [...sources];

  const worker = async () => {
    while (queue.length > 0) {
      const source = queue.shift();
      if (!source) break;
      const result = await testSourceSpeed(source, keyword);
      results[source] = result;
      onResult?.(result);
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, sources.length) }, worker));
  return results;
}

/** 延迟分级，用于决定颜色与文案 */
export function gradeSpeed(result?: SourceSpeedResult | null): SpeedGrade {
  if (!result) return "testing";
  if (!result.ok || result.ms === null) return "fail";
  if (result.ms < 300) return "fast";
  if (result.ms < 800) return "good";
  if (result.ms < 2000) return "normal";
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

/** 把结果格式化成 "128ms · 良好" 这样的展示文案 */
export function formatSpeed(result?: SourceSpeedResult | null): string {
  const grade = gradeSpeed(result);
  if (!result || result.ms === null) return SPEED_LABELS[grade];
  return `${result.ms}ms · ${SPEED_LABELS[grade]}`;
}
