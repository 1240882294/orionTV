import { useEffect, useRef, useCallback } from "react";
import { useTVEventHandler, HWEvent } from "react-native";
import usePlayerStore from "@/stores/playerStore";

const SEEK_STEP = 20 * 1000; // 单击快进/快退的时间步长（毫秒）
const LONG_SEEK_STEP = 10 * 1000; // 长按每 200ms 累加的时长
const LONG_SEEK_INTERVAL = 200;

// 定时器延迟时间（毫秒）
const CONTROLS_TIMEOUT = 5000;

interface LongSeekState {
  timer: NodeJS.Timeout;
  /** 兜底定时器：个别电视长按不发送「松手」事件，超时就自己收尾 */
  safety: NodeJS.Timeout;
  /** 长按开始时的播放位置 */
  start: number;
  /** 当前预览到的目标位置 */
  target: number;
}

/** 长按期间多久没收到事件就当作已松手 */
const LONG_SEEK_IDLE_MS = 4000;

/**
 * 管理播放器控件的显示/隐藏、遥控器事件和自动隐藏定时器。
 *
 * @param enabled 小屏（信息面板）模式下传 false：这时方向键要交给焦点导航去移动焦点
 * @returns onScreenPress - 一个函数，用于处理屏幕点击事件，以显示控件并重置定时器。
 */
export const useTVRemoteHandler = (enabled = true) => {
  const { showControls, setShowControls, showEpisodeModal, togglePlayPause, seek } = usePlayerStore();

  const controlsTimer = useRef<NodeJS.Timeout | null>(null);
  const longSeekRef = useRef<LongSeekState | null>(null);

  // 重置或启动隐藏控件的定时器
  const resetTimer = useCallback(() => {
    // 清除之前的定时器
    if (controlsTimer.current) {
      clearTimeout(controlsTimer.current);
    }
    // 设置新的定时器
    controlsTimer.current = setTimeout(() => {
      setShowControls(false);
    }, CONTROLS_TIMEOUT);
  }, [setShowControls]);

  // 当控件显示时，启动定时器
  useEffect(() => {
    if (!enabled) {
      if (controlsTimer.current) clearTimeout(controlsTimer.current);
      return;
    }
    if (showControls) {
      resetTimer();
    } else {
      // 如果控件被隐藏，清除定时器
      if (controlsTimer.current) {
        clearTimeout(controlsTimer.current);
      }
    }

    // 组件卸载时清除定时器
    return () => {
      if (controlsTimer.current) {
        clearTimeout(controlsTimer.current);
      }
    };
  }, [showControls, resetTimer, enabled]);

  // 长按预览结束后才真正跳转，避免每 200ms 打断播放器一次
  const stopLongSeek = useCallback(() => {
    const long = longSeekRef.current;
    if (!long) return;
    clearInterval(long.timer);
    clearTimeout(long.safety);
    longSeekRef.current = null;

    const state = usePlayerStore.getState();
    if (state.isSeeking) state.commitSeek(state.seekPosition);
  }, []);

  const startLongSeek = useCallback((direction: 1 | -1) => {
    if (longSeekRef.current) return;

    const state = usePlayerStore.getState();
    if (!state.status?.isLoaded || !state.status.durationMillis) return;

    const duration = state.status.durationMillis;
    const start = state.status.positionMillis;
    state.beginSeek("button");

    let target = start;
    let finished = false;
    let long: LongSeekState | null = null;

    const armSafety = () => {
      if (!long) return;
      clearTimeout(long.safety);
      long.safety = setTimeout(() => stopLongSeek(), LONG_SEEK_IDLE_MS);
    };

    const tick = () => {
      if (finished) return;
      const current = usePlayerStore.getState();
      const total = current.status?.isLoaded ? current.status.durationMillis || duration : duration;
      target = Math.max(0, Math.min(target + direction * LONG_SEEK_STEP, total));
      current.updateSeekPreview(total > 0 ? target / total : 0, "button", target - start);
      armSafety();

      // 顶到两头就停掉定时器，位置留在那里等松手提交
      if ((direction > 0 && target >= total) || (direction < 0 && target <= 0)) {
        finished = true;
        if (long) clearInterval(long.timer);
      }
    };

    long = {
      timer: setInterval(tick, LONG_SEEK_INTERVAL),
      safety: setTimeout(() => {}, 0),
      start,
      target,
    };
    longSeekRef.current = long;
    tick();
  }, [stopLongSeek]);

  // 切到小屏模式或离开页面时，把长按中的预览收掉，别留在画面中间
  useEffect(() => {
    if (!enabled) stopLongSeek();
    return () => {
      if (longSeekRef.current) {
        clearInterval(longSeekRef.current.timer);
        clearTimeout(longSeekRef.current.safety);
        longSeekRef.current = null;
      }
    };
  }, [enabled, stopLongSeek]);

  // 处理遥控器事件
  const handleTVEvent = useCallback(
    (event: HWEvent) => {
      if (!enabled) return;
      if (showEpisodeModal) {
        return;
      }

      // 长按松手：把预览的位置真正提交给播放器
      if (event.eventType === "longRight" || event.eventType === "longLeft") {
        if (event.eventKeyAction === 1) {
          stopLongSeek();
        }
      }

      resetTimer();

      if (showControls) {
        // 如果控制条已显示，则不处理后台的快进/快退等操作
        // 避免与控制条上的按钮焦点冲突
        return;
      }

      switch (event.eventType) {
        case "select":
          togglePlayPause();
          setShowControls(true);
          break;
        case "left":
          seek(-SEEK_STEP);
          break;
        case "longLeft":
          if (event.eventKeyAction === 0) startLongSeek(-1);
          break;
        case "right":
          seek(SEEK_STEP);
          break;
        case "longRight":
          if (event.eventKeyAction === 0) startLongSeek(1);
          break;
        case "down":
          setShowControls(true);
          break;
      }
    },
    [
      showControls,
      showEpisodeModal,
      setShowControls,
      resetTimer,
      togglePlayPause,
      seek,
      startLongSeek,
      stopLongSeek,
      enabled,
    ]
  );

  useTVEventHandler(handleTVEvent);

  // 处理屏幕点击事件
  const onScreenPress = () => {
    if (!enabled) return;
    // 切换控件的显示状态
    const newShowControls = !showControls;
    setShowControls(newShowControls);

    // 如果控件变为显示状态，则重置定时器
    if (newShowControls) {
      resetTimer();
    }
  };

  return { onScreenPress };
};
