import { useCallback, useEffect, useRef, useState } from "react";
import { useSettingsStore } from "@/stores/settingsStore";
import {
  AdBlockResolveResult,
  reportAdBlockPlaybackFailure,
  resolveAdFreePlaybackUrl,
} from "@/services/adblock";

export interface AdFreePlaybackState {
  /** 交给播放器的地址；未就绪时为 undefined（显示加载动画） */
  url?: string;
  /** 正在拉取并清洗播放列表 */
  resolving: boolean;
  blockedSegments: number;
  blockedSeconds: number;
  /** 当前是否使用本地清洗后的播放列表 */
  local: boolean;
  /** 直播列表（无法落地，原样播放） */
  live: boolean;
  reason?: string;
}

const IDLE: AdFreePlaybackState = {
  url: undefined,
  resolving: false,
  blockedSegments: 0,
  blockedSeconds: 0,
  local: false,
  live: false,
  reason: undefined,
};

/**
 * 播放地址的「去广告」解析。
 * 地址变化时先清空 playUrl（避免用旧地址播新集），解析完成后返回可播放地址。
 * 任何失败都会退回原始地址，保证不影响正常播放。
 */
export function useAdFreePlayback(rawUrl?: string, waitBudgetMs = 2500) {
  const enabled = useSettingsStore((state) => state.adBlockEnabled);
  const [state, setState] = useState<AdFreePlaybackState>({
    ...IDLE,
    url: rawUrl,
  });
  const resultRef = useRef<AdBlockResolveResult | null>(null);
  const runIdRef = useRef(0);

  useEffect(() => {
    const runId = ++runIdRef.current;
    resultRef.current = null;

    if (!rawUrl) {
      setState({ ...IDLE });
      return;
    }

    const isHls = /\.m3u8(?:[?#]|$)/i.test(rawUrl);
    if (!enabled || !isHls) {
      setState({ ...IDLE, url: rawUrl });
      return;
    }

    setState({ ...IDLE, resolving: true, url: undefined });

    // 到点还没清洗完就先播原地址，避免为了去广告让用户干等
    let budgetTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      if (runId !== runIdRef.current) return;
      runIdRef.current += 1;
      resultRef.current = null;
      setState({ ...IDLE, url: rawUrl, reason: "budget-timeout" });
    }, waitBudgetMs);

    resolveAdFreePlaybackUrl(rawUrl, { enabled: true })
      .then((result) => {
        if (budgetTimer) {
          clearTimeout(budgetTimer);
          budgetTimer = null;
        }
        if (runId !== runIdRef.current) return;
        resultRef.current = result;
        setState({
          url: result.url,
          resolving: false,
          blockedSegments: result.removedSegments,
          blockedSeconds: result.removedSeconds,
          local: result.local,
          live: result.live,
          reason: result.reason,
        });
      })
      .catch(() => {
        if (budgetTimer) {
          clearTimeout(budgetTimer);
          budgetTimer = null;
        }
        if (runId !== runIdRef.current) return;
        setState({ ...IDLE, url: rawUrl, reason: "error" });
      });

    return () => {
      if (budgetTimer) clearTimeout(budgetTimer);
    };
  }, [rawUrl, enabled, waitBudgetMs]);

  /** 本地列表播不了时回退到原始地址；返回 true 表示已接管这次错误 */
  const revertToOriginal = useCallback((): boolean => {
    const result = resultRef.current;
    if (!result || !result.local) return false;
    reportAdBlockPlaybackFailure(result);
    resultRef.current = null;
    setState((prev) => ({
      ...prev,
      url: result.originalUrl,
      local: false,
      resolving: false,
      reason: "playback-fallback",
    }));
    return true;
  }, []);

  return { ...state, revertToOriginal };
}
