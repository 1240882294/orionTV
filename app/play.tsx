import React, { useEffect, useRef, useCallback, memo, useMemo, useState } from "react";
import {
  StyleSheet,
  BackHandler,
  AppState,
  AppStateStatus,
  View,
  Text,
  Platform,
  PanResponder,
  useWindowDimensions,
  StatusBar,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Video, ResizeMode } from "expo-av";
import { useKeepAwake } from "expo-keep-awake";
import * as ScreenOrientation from "expo-screen-orientation";
import * as NavigationBar from "expo-navigation-bar";
import { ThemedView } from "@/components/ThemedView";
import { PlayerControls } from "@/components/PlayerControls";
import { MobilePlayerControls } from "@/components/MobilePlayerControls";
import {
  MobilePlayerInfoPanel,
  MOBILE_PLAYER_HEADER_HEIGHT,
  getMobileVideoHeight,
} from "@/components/MobilePlayerInfoPanel";
import { TVPlayerInfoPanel, getTVVideoBox } from "@/components/TVPlayerInfoPanel";
import { EpisodeSelectionModal } from "@/components/EpisodeSelectionModal";
import { SourceSelectionModal } from "@/components/SourceSelectionModal";
import { SpeedSelectionModal } from "@/components/SpeedSelectionModal";
import { SeekingBar } from "@/components/SeekingBar";
import { CastPanel } from "@/components/CastPanel";
import VideoLoadingAnimation from "@/components/VideoLoadingAnimation";
import useDetailStore from "@/stores/detailStore";
import { useTVRemoteHandler } from "@/hooks/useTVRemoteHandler";
import Toast from "react-native-toast-message";
import usePlayerStore, { selectCurrentEpisode } from "@/stores/playerStore";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";
import { useVideoHandlers } from "@/hooks/useVideoHandlers";
import { useAdFreePlayback } from "@/hooks/useAdFreePlayback";
import { testSourcesSpeed, speedOf, getCachedSpeeds, setCachedSpeeds } from "@/services/sourceSpeedTest";
import { useCastStore, shutdownCast } from "@/stores/castStore";
import Logger from "@/utils/Logger";

const logger = Logger.withTag("PlayScreen");

// 手势横向满屏滑动对应的时长（毫秒）—— 5 分钟，兼顾精度与跨度
const SWIPE_FULL_WIDTH_MS = 5 * 60 * 1000;

// 双击判定窗口：两次点击间隔小于它算双击（暂停/播放），否则算单击（显隐控件）
const DOUBLE_TAP_MS = 260;

/** 播放前测速的整体等待上限：再慢也要先播起来 */
const PREPARE_TIMEOUT_MS = 8000;
/** 用户选的线路已经够快时提前结束测速 */
const GOOD_ENOUGH_BPS = 1024 * 1024;

// 优化的加载动画组件
const LoadingContainer = memo(
  ({ style, currentEpisode }: { style: any; currentEpisode: { url: string; title: string } | undefined }) => {
    logger.info(
      `[PERF] Video component NOT rendered - waiting for valid URL. currentEpisode: ${!!currentEpisode}, url: ${
        currentEpisode?.url ? "exists" : "missing"
      }`
    );
    return (
      <View style={style}>
        <VideoLoadingAnimation showProgressBar />
      </View>
    );
  }
);

LoadingContainer.displayName = "LoadingContainer";

export default function PlayScreen() {
  const videoRef = useRef<Video>(null);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  useKeepAwake();

  // 响应式布局配置
  const { deviceType } = useResponsiveLayout();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  // 设备类型以进入页面前的布局为准：横屏后宽度变大会被误判成 tablet/tv
  const initialDeviceTypeRef = useRef(deviceType);

  // TV 判定：电视端（Platform.isTV）或进入时就是宽屏布局的设备
  const isTVDevice = Platform.isTV || initialDeviceTypeRef.current === "tv";
  const isTouchDevice = !isTVDevice;

  // 投屏面板：只有手机端有入口
  const [showCastPanel, setShowCastPanel] = useState(false);

  const {
    episodeIndex: episodeIndexStr,
    position: positionStr,
    source: sourceStr,
    id: videoId,
    title: videoTitle,
  } = useLocalSearchParams<{
    episodeIndex: string;
    position?: string;
    source?: string;
    id?: string;
    title?: string;
  }>();
  const episodeIndex = parseInt(episodeIndexStr || "0", 10);
  const position = positionStr !== undefined && positionStr !== "" ? parseInt(positionStr, 10) : undefined;

  const { detail } = useDetailStore();
  const source = sourceStr || detail?.source;
  const id = videoId || detail?.id.toString();
  const title = videoTitle || detail?.title;
  const {
    isLoading,
    showControls,
    initialPosition,
    introEndTime,
    playbackRate,
    isFullscreen,
    setVideoRef,
    handlePlaybackStatusUpdate,
    setShowControls,
    setIsFullscreen,
    screenLocked,
    reset,
    loadVideo,
  } = usePlayerStore();
  const currentEpisode = usePlayerStore(selectCurrentEpisode);

  // 播放前准备（获取线路 + 测速）
  const [preparing, setPreparing] = useState(true);
  const [prepareLabel, setPrepareLabel] = useState("正在准备播放…");
  const [prepareDone, setPrepareDone] = useState(0);
  const [prepareTotal, setPrepareTotal] = useState(0);
  const [prepareName, setPrepareName] = useState("");

  // 去广告：先清洗播放列表，再交给播放器；失败/本地列表播不了会自动回退原始地址
  const adFree = useAdFreePlayback(currentEpisode?.url);
  const playUrl = adFree.url;
  const revertAdBlock = adFree.revertToOriginal;
  // 保持引用稳定，避免每次渲染都重建 Video 的 props
  const handleBeforeError = useCallback(() => revertAdBlock(), [revertAdBlock]);

  // 使用Video事件处理hook
  const { videoProps } = useVideoHandlers({
    videoRef,
    currentEpisode,
    sourceUrl: playUrl,
    beforeError: handleBeforeError,
    initialPosition,
    introEndTime,
    playbackRate,
    handlePlaybackStatusUpdate,
    deviceType,
    detail: detail || undefined,
    // 全屏时铺满整个窗口，避免上下留边；竖屏小窗仍按 16:9 完整显示
    resizeMode: isTouchDevice && isFullscreen ? ResizeMode.COVER : ResizeMode.CONTAIN,
  });

  // 过滤成功时轻提示一次，避免同一集重复弹出
  const adNoticeRef = useRef("");
  useEffect(() => {
    if (adFree.blockedSegments <= 0) return;
    const key = `${currentEpisode?.url}|${adFree.blockedSegments}`;
    if (adNoticeRef.current === key) return;
    adNoticeRef.current = key;
    Toast.show({
      type: "success",
      text1: "广告已过滤",
      text2: `已跳过 ${adFree.blockedSegments} 个广告片段`,
      visibilityTime: 2500,
    });
  }, [adFree.blockedSegments, currentEpisode?.url]);

  // 首帧先按全屏排，等进入页面的方向设置生效后再判断要不要小窗，避免先闪一下小屏
  const [layoutReady, setLayoutReady] = useState(false);

  // 电视端小屏模式：视频在左上角小窗，右侧展示剧集资料
  const tvCompact = isTVDevice && !isFullscreen && !!detail && layoutReady;

  // TV遥控器处理 - 总是调用hook；小屏模式下把方向键让给焦点导航
  const tvRemoteHandler = useTVRemoteHandler(!tvCompact);

  // 手机端进入播放页默认显示控件
  useEffect(() => {
    if (isTouchDevice) {
      setShowControls(true);
    }
  }, [isTouchDevice, setShowControls]);

  // 进入播放页即大屏播放：电视端天生满屏，手机端从「最近播放」进来也是横屏全屏
  useEffect(() => {
    if (isTVDevice) {
      setIsFullscreen(true);
      setLayoutReady(true);
      return;
    }
    if (position !== undefined) {
      setIsFullscreen(true);
      setShowControls(true);
    }
    setLayoutReady(true);
    // 仅在进入页面时判定一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 屏幕方向：手机端由播放页接管，取消跟随系统自动旋转
  useEffect(() => {
    if (isTVDevice || Platform.OS !== "android") return;

    const lock = async () => {
      try {
        await ScreenOrientation.lockAsync(
          isFullscreen
            ? ScreenOrientation.OrientationLock.LANDSCAPE
            : ScreenOrientation.OrientationLock.PORTRAIT_UP
        );
      } catch (error) {
        logger.debug("Failed to lock screen orientation:", error);
      }
    };
    lock();
  }, [isFullscreen, isTVDevice]);

  // 全屏时隐藏系统导航条，避免白色手势条压在进度条上
  useEffect(() => {
    if (isTVDevice || Platform.OS !== "android") return;

    const apply = async () => {
      try {
        if (isFullscreen) {
          await NavigationBar.setBehaviorAsync("overlay-swipe");
          await NavigationBar.setVisibilityAsync("hidden");
        } else {
          await NavigationBar.setVisibilityAsync("visible");
        }
      } catch (error) {
        logger.debug("Failed to toggle navigation bar:", error);
      }
    };
    apply();
  }, [isFullscreen, isTVDevice]);

  // 离开播放页恢复竖屏与导航条，避免影响其他页面
  useEffect(() => {
    if (isTVDevice || Platform.OS !== "android") return;
    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
      NavigationBar.setVisibilityAsync("visible").catch(() => {});
    };
  }, [isTVDevice]);

  // 手势：横向滑动快进/快退
  const windowWidthRef = useRef(windowWidth);
  const seekStartRef = useRef(0);
  const swipeRatioRef = useRef(0);

  useEffect(() => {
    windowWidthRef.current = windowWidth;
  }, [windowWidth]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_evt, gesture) =>
          Math.abs(gesture.dx) > 14 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.2,
        onMoveShouldSetPanResponderCapture: (_evt, gesture) =>
          Math.abs(gesture.dx) > 14 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.2,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          const state = usePlayerStore.getState();
          if (!state.status?.isLoaded || !state.status.durationMillis) return;
          seekStartRef.current = state.status.positionMillis;
          state.beginSeek("gesture");
          // 手势快进时收起控件，只留中间的预览卡片，避免两套进度条同时出现
          state.setShowControls(false);
        },
        onPanResponderMove: (_evt, gesture) => {
          const state = usePlayerStore.getState();
          if (!state.status?.isLoaded || !state.status.durationMillis) return;

          const duration = state.status.durationMillis;
          const width = windowWidthRef.current || 1;
          const span = Math.min(duration, SWIPE_FULL_WIDTH_MS);
          const delta = (gesture.dx / width) * span;
          const target = Math.max(0, Math.min(seekStartRef.current + delta, duration));

          swipeRatioRef.current = target / duration;
          state.updateSeekPreview(swipeRatioRef.current, "gesture");
        },
        onPanResponderRelease: () => {
          const state = usePlayerStore.getState();
          if (state.isSeeking) {
            state.commitSeek(swipeRatioRef.current);
          }
        },
        onPanResponderTerminate: () => {
          const state = usePlayerStore.getState();
          if (state.isSeeking) {
            state.commitSeek(swipeRatioRef.current);
          }
        },
      }),
    []
  );

  // 长按画面右侧：临时 3 倍速，松手恢复。不写入用户偏好，也不改 store 里的 playbackRate
  const BOOST_RATE = 3;
  const boostRef = useRef(false);
  const longPressXRef = useRef(0);
  const [boosting, setBoosting] = useState(false);

  const rememberTouchX = useCallback((event: { nativeEvent?: { locationX?: number } }) => {
    longPressXRef.current = event?.nativeEvent?.locationX ?? 0;
  }, []);

  const startBoost = useCallback(() => {
    if (!isTouchDevice || screenLocked) return;
    // 只认右半边：左侧保留「点一下显隐控件」的习惯
    if (longPressXRef.current < windowWidth * 0.6) return;
    const state = usePlayerStore.getState();
    if (!state.status?.isLoaded) return;
    boostRef.current = true;
    setBoosting(true);
    state.videoRef?.current?.setRateAsync(BOOST_RATE, true).catch(() => {});
  }, [isTouchDevice, screenLocked, windowWidth]);

  const stopBoost = useCallback(() => {
    if (!boostRef.current) return;
    boostRef.current = false;
    setBoosting(false);
    const state = usePlayerStore.getState();
    state.videoRef?.current?.setRateAsync(state.playbackRate || 1, true).catch(() => {});
  }, []);

  // 退出页面时别把 3 倍速留在播放器上
  useEffect(
    () => () => {
      if (boostRef.current) {
        boostRef.current = false;
        const state = usePlayerStore.getState();
        state.videoRef?.current?.setRateAsync(state.playbackRate || 1, true).catch(() => {});
      }
    },
    []
  );

  // 离开播放页时统一清理，避免准备流程重跑时把播放状态清掉
  useEffect(() => {
    return () => {
      logger.info(`[PERF] PlayScreen unmounting - calling reset()`);
      reset();
      // 投屏中直接退出播放页：结算进度并断开，别把定时器留在后台
      shutdownCast();
    };
  }, [reset]);

  // 进入播放页：先拿线路 -> 测速挑最优 -> 再加载视频
  // 用路由参数做 key，避免「写回选中的源」触发 effect 重入、反复测速
  const prepareKey = `${title ?? ""}|${id ?? ""}|${episodeIndex}|${position ?? ""}|${sourceStr ?? ""}`;

  useEffect(() => {
    let cancelled = false;
    setVideoRef(videoRef);
    setPreparing(true);
    setPrepareLabel("正在准备播放…");
    setPrepareDone(0);
    setPrepareTotal(0);
    setPrepareName("");

    const prepare = async () => {
      if (!source || !id || !title) {
        logger.info(`[PREP] Missing params - source: ${!!source}, id: ${!!id}, title: ${!!title}`);
        if (!cancelled) setPreparing(false);
        return;
      }

      // 1. 确保剧集数据可用
      let state = useDetailStore.getState();
      const needInit = !state.detail || state.detail.title !== title || state.searchResults.length === 0;
      if (needInit) {
        setPrepareLabel("正在获取线路…");
        await state.init(title, source, id);
        if (cancelled) return;
        state = useDetailStore.getState();
      }

      const candidates =
        state.searchResults.length > 0 ? state.searchResults : state.detail ? [state.detail] : [];
      const preferredSource = sourceStr || state.detail?.source || source;

      if (candidates.length === 0) {
        logger.warn("[PREP] No candidate sources, load with given params");
        if (!cancelled) setPreparing(false);
        loadVideo({ source, id, episodeIndex, position, title });
        return;
      }

      // 2. 测速挑最优线路：只在本次打开视频时测一次，结果写入缓存供其他界面复用
      const cached = getCachedSpeeds(title);
      if (cached) {
        logger.info("[PREP] Reuse cached speed results");
      } else {
        setPrepareLabel("正在测速 · 正在挑选最优线路");
        setPrepareTotal(candidates.length);
        setPrepareDone(0);
      }

      const speeds =
        cached ??
        (await testSourcesSpeed(
          candidates,
          title,
          (result, done) => {
            if (cancelled) return;
            setPrepareDone(done);
            if (result.ok) {
              const matched = candidates.find((item) => item.source === result.source);
              setPrepareName(matched?.source_name || result.source);
            }
            // 增量写入缓存：竖屏信息面板一出现就能看到已测完的线路
            setCachedSpeeds(title, { [result.source]: result }, true);
          },
          {
            totalTimeoutMs: PREPARE_TIMEOUT_MS,
            // 用户选的线路已经够快就不用等剩下的源，早点开播
            shouldStop: (results) =>
              !!preferredSource && speedOf(results[preferredSource]) >= GOOD_ENOUGH_BPS,
          }
        ));
      if (cancelled) return;

      if (!cached) {
        // 补齐没测到的源，避免缓存里缺少条目被当成「未测速」
        setCachedSpeeds(title, speeds);
      }

      const ranked = candidates
        .map((item) => ({ item, bps: speedOf(speeds[item.source]) }))
        .filter((entry) => entry.bps > 0)
        .sort((a, b) => b.bps - a.bps);

      const preferred = candidates.find((item) => item.source === preferredSource);
      const preferredBps = preferred ? speedOf(speeds[preferred.source]) : 0;

      let chosen = preferred ?? candidates[0];
      if (ranked.length > 0) {
        const fastest = ranked[0];
        // 用户明确选了线路，且速度不低于最快线路的一半，就尊重用户选择
        const keepPreferred = !!preferred && preferredBps > 0 && preferredBps * 2 >= fastest.bps;
        chosen = keepPreferred && preferred ? preferred : fastest.item;
        if (chosen.source !== preferredSource) {
          logger.info(
            `[PREP] Switch to faster source: ${chosen.source_name} (${Math.round(
              speedOf(speeds[chosen.source]) / 1024
            )} KB/s)`
          );
        }
      }

      setPrepareLabel("正在加载视频…");

      // 3. 让 playerStore 使用选中的源
      const current = useDetailStore.getState().detail;
      if (!current || current.source !== chosen.source) {
        await useDetailStore.getState().setDetail(chosen);
        if (cancelled) return;
      }

      loadVideo({
        source: chosen.source,
        id: chosen.id.toString(),
        episodeIndex,
        position,
        title,
      });

      if (!cancelled) setPreparing(false);
    };

    prepare().catch((error) => {
      logger.debug("[PREP] prepare failed", error);
      if (!cancelled) {
        setPreparing(false);
        if (source && id && title) {
          loadVideo({ source, id, episodeIndex, position, title });
        }
      }
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prepareKey]);

  // 优化的屏幕点击处理
  const onScreenPress = useCallback(() => {
    if (isTVDevice) {
      tvRemoteHandler.onScreenPress();
    } else {
      setShowControls(!showControls);
    }
  }, [isTVDevice, tvRemoteHandler, setShowControls, showControls]);

  /**
   * 双击暂停/播放。
   *
   * RN 的 Pressable 没有 numberOfTaps，所以自己按时间差判定：
   * 单击延迟 DOUBLE_TAP_MS 再执行（显隐控件），期间来了第二次点击就取消这次单击、
   * 改成切换播放状态 —— 这样双击不会顺带把控件闪一下。
   */
  const lastTapAtRef = useRef(0);
  const singleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleScreenTap = useCallback(() => {
    const now = Date.now();
    const isDoubleTap = now - lastTapAtRef.current < DOUBLE_TAP_MS;

    if (isDoubleTap) {
      // 清掉时间戳，避免第三次点击又被判成双击
      lastTapAtRef.current = 0;
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }
      const state = usePlayerStore.getState();
      if (!state.status?.isLoaded) return;
      void state.togglePlayPause();
      // 亮出控件：中央的播放/暂停按钮本身就是最准确的反馈，
      // 不要再自绘一层图标——那是同一位置两个圆叠加，会重影
      state.setShowControls(true);
      return;
    }

    lastTapAtRef.current = now;
    if (singleTapTimerRef.current) clearTimeout(singleTapTimerRef.current);
    singleTapTimerRef.current = setTimeout(() => {
      singleTapTimerRef.current = null;
      onScreenPress();
    }, DOUBLE_TAP_MS);
  }, [onScreenPress]);

  // 投屏期间本机保持暂停：用户可能在手机上误点播放，声音会和电视叠在一起
  useEffect(() => {
    const unsubscribe = useCastStore.subscribe((state) => {
      if (!state.activeDevice) return;
      const player = usePlayerStore.getState();
      if (player.status?.isLoaded && player.status.isPlaying) {
        player.videoRef?.current?.pauseAsync().catch(() => {});
      }
    });
    return unsubscribe;
  }, []);

  // 离开页面时别留着未执行的单击定时器
  useEffect(
    () => () => {
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }
    },
    []
  );

  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState === "background" || nextAppState === "inactive") {
        videoRef.current?.pauseAsync();
      }
    };

    const subscription = AppState.addEventListener("change", handleAppStateChange);

    return () => {
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    const backAction = () => {
      // 电视端大屏时，先缩成小窗（右边能看到剧集/线路）
      if (isTVDevice && isFullscreen) {
        setIsFullscreen(false);
        setShowControls(false);
        return true;
      }
      // 手机端全屏时，先退出全屏
      if (isTouchDevice && isFullscreen) {
        setIsFullscreen(false);
        setShowControls(true);
        return true;
      }
      if (showControls) {
        setShowControls(false);
        return true;
      }
      router.back();
      return true;
    };

    const backHandler = BackHandler.addEventListener("hardwareBackPress", backAction);

    return () => backHandler.remove();
  }, [showControls, setShowControls, router, isTouchDevice, isTVDevice, isFullscreen, setIsFullscreen]);

  useEffect(() => {
    let timeoutId: NodeJS.Timeout | null = null;

    if (isLoading) {
      timeoutId = setTimeout(() => {
        if (usePlayerStore.getState().isLoading) {
          usePlayerStore.setState({ isLoading: false });
          Toast.show({ type: "error", text1: "播放超时，请重试" });
        }
      }, 60000); // 1 minute
    }

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [isLoading]);

  // 竖屏信息面板：退出全屏后显示剧集简介、线路与集数
  const showInfoPanel = isTouchDevice && !isFullscreen && !!detail && layoutReady;
  const videoTop = MOBILE_PLAYER_HEADER_HEIGHT + insets.top;
  const videoHeight = getMobileVideoHeight(windowWidth);
  const tvBox = getTVVideoBox(windowWidth);

  const videoLayerStyle = showInfoPanel
    ? {
        position: "absolute" as const,
        top: videoTop,
        left: 0,
        right: 0,
        height: videoHeight,
        backgroundColor: "black",
        overflow: "hidden" as const,
        zIndex: 0,
      }
    : tvCompact
    ? {
        position: "absolute" as const,
        top: tvBox.top,
        left: tvBox.padding,
        width: tvBox.width,
        height: tvBox.height,
        backgroundColor: "black",
        overflow: "hidden" as const,
        zIndex: 0,
      }
    : {
        // 显式钉死窗口尺寸：absoluteFill 只是跟随父级，横屏切换那一帧父级可能还没量准，
        // 解码层会按旧尺寸糊一层旧画面，表现为上下两条「蒙版」
        position: "absolute" as const,
        top: 0,
        left: 0,
        width: windowWidth,
        height: windowHeight,
        backgroundColor: "black",
        overflow: "hidden" as const,
        zIndex: 0,
      };

  if (!detail && !preparing) {
    return <VideoLoadingAnimation showProgressBar />;
  }

  const preparePercent = prepareTotal > 0 ? Math.round((prepareDone / prepareTotal) * 100) : 0;

  return (
    <ThemedView focusable style={styles.container}>
      <StatusBar hidden={isTouchDevice && isFullscreen} barStyle="light-content" />

      {/* 1. 视频层：只负责画面，不接收触摸 */}
      <View style={videoLayerStyle}>
        {playUrl ? (
          <Video ref={videoRef} style={styles.videoPlayer} {...videoProps} />
        ) : (
          <LoadingContainer style={styles.loadingContainer} currentEpisode={currentEpisode} />
        )}
      </View>

      {/* 2. 手势 + 点击层：父级接横向滑动快进，子级 Pressable 负责显隐控件 / 长按右半屏 3 倍速 */}
      {!showInfoPanel && !tvCompact && (
        <View
          style={styles.tapLayer}
          {...(isTouchDevice && !screenLocked ? panResponder.panHandlers : {})}
        >
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={isTouchDevice ? (screenLocked ? undefined : handleScreenTap) : onScreenPress}
            onPressIn={isTouchDevice ? rememberTouchX : undefined}
            onLongPress={isTouchDevice ? startBoost : undefined}
            onPressOut={isTouchDevice ? stopBoost : undefined}
            delayLongPress={380}
          />
        </View>
      )}

      {/* 3. 加载覆盖层 */}
      {playUrl && isLoading && !preparing && (
        <View style={styles.loadingOverlay} pointerEvents="none">
          <VideoLoadingAnimation showProgressBar />
        </View>
      )}

      {/* 4. 控件层：电视端大屏 */}
      {isTVDevice && isFullscreen && showControls && (
        <View style={styles.tvControlsLayer} pointerEvents="box-none">
          <PlayerControls showControls={showControls} setShowControls={setShowControls} />
        </View>
      )}

      {/* 5. 控件层：手机端全屏（组件内部自带 zIndex/elevation） */}
      {isTouchDevice && isFullscreen && (
        <MobilePlayerControls
          showControls={showControls}
          setShowControls={setShowControls}
          onOpenCast={() => setShowCastPanel(true)}
        />
      )}

      {/* 6. 手机端竖屏信息面板 */}
      {showInfoPanel && (
        <MobilePlayerInfoPanel
          videoTop={videoTop}
          videoHeight={videoHeight}
          onOpenCast={() => setShowCastPanel(true)}
        />
      )}

      {/* 7. 电视端小屏模式：右侧剧集资料 */}
      {tvCompact && <TVPlayerInfoPanel windowWidth={windowWidth} />}

      {/* 快进/快退进度提示：手机端给手势用，电视端给遥控器快进键用 */}
      {!showInfoPanel && !tvCompact && (
        <SeekingBar
          sources={isTVDevice ? ["button"] : ["gesture"]}
          variant={isTVDevice ? "tv" : "mobile"}
        />
      )}

      {/* 长按右半屏的 3 倍速提示 */}
      {boosting && (
        <View style={styles.boostWrap} pointerEvents="none">
          <View style={styles.boostBadge}>
            <Text style={styles.boostText}>3× 倍速</Text>
          </View>
        </View>
      )}

      {/* 8. 播放前测速遮罩 */}
      {preparing && (
        <View style={styles.prepareOverlay}>
          <ActivityIndicator size="large" color="#ffffff" />
          <Text style={styles.prepareTitle}>{prepareLabel}</Text>
          {prepareTotal > 0 ? (
            <>
              <Text style={styles.prepareSub}>
                {prepareDone}/{prepareTotal} 条线路{prepareName ? ` · 最近完成 ${prepareName}` : ""}
              </Text>
              <View style={styles.prepareTrack}>
                <View style={[styles.prepareFill, { width: `${Math.max(6, preparePercent)}%` }]} />
              </View>
            </>
          ) : null}
          <Text style={styles.prepareHint}>速度越快的线路越不容易卡顿</Text>
        </View>
      )}

      {/* 电视端选集走小屏右侧的播放列表，不再弹这个面板 */}
      {!isTVDevice && <EpisodeSelectionModal />}
      <SourceSelectionModal />
      <SpeedSelectionModal />

      {/* 投屏面板：设备选择 + 遥控器 */}
      {isTouchDevice && (
        <CastPanel visible={showCastPanel} onClose={() => setShowCastPanel(false)} />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "black",
  },
  videoPlayer: {
    ...StyleSheet.absoluteFillObject,
  },
  tapLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
    backgroundColor: "transparent",
  },
  boostWrap: {
    position: "absolute",
    top: 56,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 45,
  },
  boostBadge: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.62)",
  },
  boostText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },
  loadingContainer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.8)",
    justifyContent: "center",
    alignItems: "center",
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.8)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 20,
  },
  tvControlsLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 25,
  },
  prepareOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 60,
    backgroundColor: "rgba(0,0,0,0.88)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
  },
  prepareTitle: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
    marginTop: 18,
    textAlign: "center",
  },
  prepareSub: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 12,
    marginTop: 8,
    textAlign: "center",
  },
  prepareTrack: {
    width: "70%",
    maxWidth: 320,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.16)",
    marginTop: 12,
    overflow: "hidden",
  },
  prepareFill: {
    height: "100%",
    backgroundColor: "#22c55e",
  },
  prepareHint: {
    color: "rgba(255,255,255,0.35)",
    fontSize: 11,
    marginTop: 16,
  },
});
