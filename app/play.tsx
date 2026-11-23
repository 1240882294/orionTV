import React, { useEffect, useRef, useCallback, memo, useMemo } from "react";
import {
  StyleSheet,
  BackHandler,
  AppState,
  AppStateStatus,
  View,
  Platform,
  PanResponder,
  useWindowDimensions,
  StatusBar,
  Pressable,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Video } from "expo-av";
import { useKeepAwake } from "expo-keep-awake";
import * as ScreenOrientation from "expo-screen-orientation";
import * as NavigationBar from "expo-navigation-bar";
import { ThemedView } from "@/components/ThemedView";
import { PlayerControls } from "@/components/PlayerControls";
import { MobilePlayerControls } from "@/components/MobilePlayerControls";
import { EpisodeSelectionModal } from "@/components/EpisodeSelectionModal";
import { SourceSelectionModal } from "@/components/SourceSelectionModal";
import { SpeedSelectionModal } from "@/components/SpeedSelectionModal";
import { SeekingBar } from "@/components/SeekingBar";
import VideoLoadingAnimation from "@/components/VideoLoadingAnimation";
import useDetailStore from "@/stores/detailStore";
import { useTVRemoteHandler } from "@/hooks/useTVRemoteHandler";
import Toast from "react-native-toast-message";
import usePlayerStore, { selectCurrentEpisode } from "@/stores/playerStore";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";
import { useVideoHandlers } from "@/hooks/useVideoHandlers";
import Logger from "@/utils/Logger";

const logger = Logger.withTag("PlayScreen");

// 手势横向满屏滑动对应的时长（毫秒）—— 5 分钟，兼顾精度与跨度
const SWIPE_FULL_WIDTH_MS = 5 * 60 * 1000;

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
  useKeepAwake();

  // 响应式布局配置
  const { deviceType } = useResponsiveLayout();
  const { width: windowWidth } = useWindowDimensions();

  // 设备类型以进入页面前的布局为准：横屏后宽度变大会被误判成 tablet/tv
  const initialDeviceTypeRef = useRef(deviceType);

  // TV 判定：电视端（Platform.isTV）或进入时就是宽屏布局的设备
  const isTVDevice = Platform.isTV || initialDeviceTypeRef.current === "tv";
  const isTouchDevice = !isTVDevice;

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
    reset,
    loadVideo,
  } = usePlayerStore();
  const currentEpisode = usePlayerStore(selectCurrentEpisode);

  // 使用Video事件处理hook
  const { videoProps } = useVideoHandlers({
    videoRef,
    currentEpisode,
    initialPosition,
    introEndTime,
    playbackRate,
    handlePlaybackStatusUpdate,
    deviceType,
    detail: detail || undefined,
  });

  // TV遥控器处理 - 总是调用hook，但根据设备类型决定是否使用结果
  const tvRemoteHandler = useTVRemoteHandler();

  // 手机端进入播放页默认显示控件
  useEffect(() => {
    if (isTouchDevice) {
      setShowControls(true);
    }
  }, [isTouchDevice, setShowControls]);

  // 从「最近播放」记录进入时，默认直接横屏全屏播放
  useEffect(() => {
    if (!isTouchDevice) return;
    if (position !== undefined) {
      setIsFullscreen(true);
      setShowControls(true);
    }
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
          state.beginSeek();
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
          state.updateSeekPreview(swipeRatioRef.current);
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

  useEffect(() => {
    const perfStart = performance.now();
    logger.info(`[PERF] PlayScreen useEffect START - source: ${source}, id: ${id}, title: ${title}`);

    setVideoRef(videoRef);
    if (source && id && title) {
      logger.info(`[PERF] Calling loadVideo with episodeIndex: ${episodeIndex}, position: ${position}`);
      loadVideo({ source, id, episodeIndex, position, title });
    } else {
      logger.info(`[PERF] Missing required params - source: ${!!source}, id: ${!!id}, title: ${!!title}`);
    }

    const perfEnd = performance.now();
    logger.info(`[PERF] PlayScreen useEffect END - took ${(perfEnd - perfStart).toFixed(2)}ms`);

    return () => {
      logger.info(`[PERF] PlayScreen unmounting - calling reset()`);
      reset(); // Reset state when component unmounts
    };
  }, [episodeIndex, source, position, setVideoRef, reset, loadVideo, id, title]);

  // 优化的屏幕点击处理
  const onScreenPress = useCallback(() => {
    if (isTVDevice) {
      tvRemoteHandler.onScreenPress();
    } else {
      setShowControls(!showControls);
    }
  }, [isTVDevice, tvRemoteHandler, setShowControls, showControls]);

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
  }, [showControls, setShowControls, router, isTouchDevice, isFullscreen, setIsFullscreen]);

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

  if (!detail) {
    return <VideoLoadingAnimation showProgressBar />;
  }

  return (
    <ThemedView focusable style={styles.container}>
      <StatusBar hidden={isTouchDevice && isFullscreen} barStyle="light-content" />

      {/* 1. 视频层：只负责画面，不接收触摸 */}
      <View style={styles.videoLayer}>
        {currentEpisode?.url ? (
          <Video ref={videoRef} style={styles.videoPlayer} {...videoProps} />
        ) : (
          <LoadingContainer style={styles.loadingContainer} currentEpisode={currentEpisode} />
        )}
      </View>

      {/* 2. 手势 + 点击层：父级接横向滑动快进，子级 Pressable 负责切换控件显隐 */}
      <View style={styles.tapLayer} {...(isTouchDevice ? panResponder.panHandlers : {})}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onScreenPress} />
      </View>

      {/* 3. 加载覆盖层 */}
      {currentEpisode?.url && isLoading && (
        <View style={styles.loadingOverlay} pointerEvents="none">
          <VideoLoadingAnimation showProgressBar />
        </View>
      )}

      {/* 4. 控件层：电视端 */}
      {isTVDevice && showControls && (
        <View style={styles.tvControlsLayer} pointerEvents="box-none">
          <PlayerControls showControls={showControls} setShowControls={setShowControls} />
        </View>
      )}

      {/* 5. 控件层：手机端（组件内部自带 zIndex/elevation） */}
      {isTouchDevice && <MobilePlayerControls showControls={showControls} setShowControls={setShowControls} />}

      {/* 滑动预览条 */}
      <SeekingBar />

      <EpisodeSelectionModal />
      <SourceSelectionModal />
      <SpeedSelectionModal />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "black",
  },
  videoLayer: {
    ...StyleSheet.absoluteFillObject,
    // 注意：这里不能设 zIndex，否则会把上面的控件层压住，导致按钮全部点不动
    zIndex: 0,
  },
  videoPlayer: {
    ...StyleSheet.absoluteFillObject,
  },
  tapLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
    backgroundColor: "transparent",
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
});
