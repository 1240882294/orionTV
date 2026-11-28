import { speedOf, type SourceSpeedResult, type SpeedTestTarget } from "./sourceSpeedTest";

/**
 * 启动流程的选线决策。
 *
 * 单独抽出来是为了可测：播放页里的编排（拉线路 → 测速 → 挑最优 → 15 秒看门狗）
 * 依赖 React 生命周期，而「用哪份缓存、最终挑哪条」是纯函数，值得单独覆盖。
 */

export interface CacheSplit<T extends SpeedTestTarget> {
  /** 缓存里已经测成功、可直接复用的线路 */
  hit: Record<string, SourceSpeedResult>;
  /** 缓存没覆盖（或上次测失败）需要补测的线路 */
  missing: T[];
}

/**
 * 把候选线路拆成「缓存已覆盖」和「需要补测」两组。
 *
 * 缓存按片名存，可能只覆盖了一部分线路（上次提前结束、或者线路列表后来变多），
 * 所以必须逐条比对，不能因为有缓存就整体跳过测速。
 * 失败结果不算覆盖：那多半是当时的网络抖动，补测才有机会翻盘。
 */
export function splitByCacheCoverage<T extends SpeedTestTarget>(
  candidates: T[],
  cached: Record<string, SourceSpeedResult> | null | undefined
): CacheSplit<T> {
  const hit: Record<string, SourceSpeedResult> = {};
  const missing: T[] = [];

  candidates.forEach((item) => {
    const record = cached?.[item.source];
    if (record?.ok) hit[item.source] = record;
    else missing.push(item);
  });

  return { hit, missing };
}

export interface PickResult<T> {
  chosen: T;
  /** 选中线路的实测速度（B/s），0 表示没测出速度 */
  bps: number;
  /** 是否放弃了用户原本选的线路 */
  switched: boolean;
}

/**
 * 过滤掉已经判定「出不了画面」的线路。
 *
 * 全都排除时退回全集：宁可再试一次，也不能让播放页落到「无源可播」。
 */
export function filterCandidates<T extends SpeedTestTarget>(
  candidates: T[],
  excluded: ReadonlySet<string>
): T[] {
  if (excluded.size === 0) return candidates;
  const remaining = candidates.filter((item) => !excluded.has(item.source));
  return remaining.length > 0 ? remaining : candidates;
}

/**
 * 从候选里挑一条：
 * - 有速度数据就排序，用户选的线路不低于最快的一半时尊重用户选择，否则换最快的；
 * - 一条都没测出速度时，退回用户选的线路（或第一条），保证有源可播。
 */
export function pickBestSource<T extends SpeedTestTarget>(
  candidates: T[],
  speeds: Record<string, SourceSpeedResult>,
  preferredSource?: string
): PickResult<T> | null {
  if (candidates.length === 0) return null;

  const preferred = preferredSource
    ? candidates.find((item) => item.source === preferredSource) ?? null
    : null;

  const ranked = candidates
    .map((item) => ({ item, bps: speedOf(speeds[item.source]) }))
    .filter((entry) => entry.bps > 0)
    .sort((a, b) => b.bps - a.bps);

  if (ranked.length === 0) {
    return { chosen: preferred ?? candidates[0], bps: 0, switched: false };
  }

  const fastest = ranked[0];
  const preferredBps = preferred ? speedOf(speeds[preferred.source]) : 0;
  const keepPreferred = !!preferred && preferredBps > 0 && preferredBps * 2 >= fastest.bps;

  return {
    chosen: keepPreferred && preferred ? preferred : fastest.item,
    bps: keepPreferred ? preferredBps : fastest.bps,
    switched: (keepPreferred && preferred ? preferred : fastest.item).source !== preferredSource,
  };
}
