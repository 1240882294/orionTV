import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  PanResponder,
  LayoutChangeEvent,
} from "react-native";
import { useRouter } from "expo-router";
import {
  ChevronLeft,
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  List,
  Gauge,
  Maximize,
  Minimize,
} from "lucide-react-native";
import usePlayerStore from "@/stores/playerStore";
import useDetailStore from "@/stores/detailStore";

interface MobilePlayerControlsProps {
  showControls: boolean;
  setShowControls: (show: boolean) => void;
}

const formatTime = (milliseconds: number) => {
  if (!milliseconds || isNaN(milliseconds) || milliseconds < 0) return "00:00";
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
};

/** 可拖动进度条（手机端专用，避免依赖 TV 端的按键式进度条） */
const SeekSlider: React.FC<{
  progress: number;
  duration: number;
  onPreview: (ratio: number) => void;
  onCommit: (ratio: number) => void;
}> = ({ progress, duration, onPreview, onCommit }) => {
  const trackRef = useRef<View>(null);
  const leftRef = useRef(0);
  const widthRef = useRef(0);
  const ratioRef = useRef(progress);
  const draggingRef = useRef(false);
  const [trackWidth, setTrackWidth] = useState(0);
  const [localRatio, setLocalRatio] = useState<number | null>(null);

  const clamp = (v: number) => Math.max(0, Math.min(1, v));

  const updateFromX = useCallback(
    (pageX: number) => {
      const width = widthRef.current || 1;
      const ratio = clamp((pageX - leftRef.current) / width);
      ratioRef.current = ratio;
      setLocalRatio(ratio);
      onPreview(ratio);
    },
    [onPreview]
  );

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (evt) => {
        draggingRef.current = true;
        updateFromX(evt.nativeEvent.pageX);
      },
      onPanResponderMove: (_evt, gesture) => {
        updateFromX(gesture.moveX);
      },
      onPanResponderRelease: () => {
        draggingRef.current = false;
        setLocalRatio(null);
        onCommit(ratioRef.current);
      },
      onPanResponderTerminate: () => {
        draggingRef.current = false;
        setLocalRatio(null);
        onCommit(ratioRef.current);
      },
    })
  ).current;

  const onLayout = (_e: LayoutChangeEvent) => {
    setTrackWidth(_e.nativeEvent.layout.width);
    trackRef.current?.measureInWindow((x, _y, w) => {
      leftRef.current = x;
      widthRef.current = w;
    });
  };

  const shownRatio = localRatio === null ? progress : localRatio;

  return (
    <View style={styles.sliderRow}>
      <Text style={styles.timeText}>{formatTime(shownRatio * duration)}</Text>
      <View
        ref={trackRef}
        style={styles.sliderTrackHitArea}
        onLayout={onLayout}
        {...panResponder.panHandlers}
      >
        <View style={styles.sliderTrack}>
          <View
            style={[
              styles.sliderFill,
              { width: `${Math.max(0, Math.min(1, shownRatio)) * 100}%` },
            ]}
          />
        </View>
        <View
          style={[
            styles.sliderThumb,
            { left: Math.max(0, Math.min(1, shownRatio)) * Math.max(0, trackWidth - 14) },
          ]}
        />
      </View>
      <Text style={styles.timeText}>{formatTime(duration)}</Text>
    </View>
  );
};

export const MobilePlayerControls: React.FC<MobilePlayerControlsProps> = ({
  showControls,
  setShowControls,
}) => {
  const router = useRouter();
  const {
    status,
    episodes,
    currentEpisodeIndex,
    playbackRate,
    isFullscreen,
    togglePlayPause,
    toggleFullscreen,
    seekBy,
    beginSeek,
    updateSeekPreview,
    commitSeek,
    setShowEpisodeModal,
    setShowSpeedModal,
    progressPosition,
  } = usePlayerStore();

  const { detail } = useDetailStore();
  const [interactionTick, setInteractionTick] = useState(0);

  const touch = useCallback(() => setInteractionTick((v) => v + 1), []);

  const isPlaying = status?.isLoaded ? !!status.isPlaying : false;
  const duration = status?.isLoaded ? status.durationMillis || 0 : 0;
  const currentEpisodeTitle = episodes[currentEpisodeIndex]?.title;

  // 播放中 4 秒无操作自动隐藏控件
  useEffect(() => {
    if (!showControls || !isPlaying) return;
    const timer = setTimeout(() => setShowControls(false), 4000);
    return () => clearTimeout(timer);
  }, [showControls, isPlaying, interactionTick, setShowControls]);

  const guard = (fn: () => void) => () => {
    touch();
    fn();
  };

  const onBack = () => {
    if (isFullscreen) {
      toggleFullscreen();
      return;
    }
    router.back();
  };

  const onPreview = useCallback(
    (ratio: number) => {
      if (!usePlayerStore.getState().isSeeking) {
        beginSeek();
      }
      updateSeekPreview(ratio);
      touch();
    },
    [beginSeek, updateSeekPreview, touch]
  );

  const onCommit = useCallback(
    (ratio: number) => {
      commitSeek(ratio);
    },
    [commitSeek]
  );

  if (!showControls) return null;

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      {/* 顶部：返回 + 标题 + 全屏 */}
      <View style={styles.topBar}>
        <Pressable
          onPress={guard(onBack)}
          style={styles.iconButton}
          hitSlop={10}
        >
          <ChevronLeft color="white" size={26} />
        </Pressable>
        <View style={styles.titleWrap}>
          <Text style={styles.title} numberOfLines={1}>
            {detail?.title || "正在播放"}
          </Text>
          {currentEpisodeTitle ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {currentEpisodeTitle}
            </Text>
          ) : null}
        </View>
        <Pressable
          onPress={guard(() => toggleFullscreen())}
          style={styles.iconButton}
          hitSlop={10}
        >
          {isFullscreen ? (
            <Minimize color="white" size={22} />
          ) : (
            <Maximize color="white" size={22} />
          )}
        </Pressable>
      </View>

      {/* 中间：快退 15s / 播放暂停 / 快进 15s */}
      <View style={styles.centerRow} pointerEvents="box-none">
        <Pressable
          onPress={guard(() => seekBy(-15000))}
          style={styles.sideButton}
          hitSlop={8}
        >
          <RotateCcw color="white" size={30} />
          <Text style={styles.badgeText}>15</Text>
        </Pressable>

        <Pressable
          onPress={guard(() => togglePlayPause())}
          style={styles.playButton}
          hitSlop={8}
        >
          {isPlaying ? (
            <Pause color="white" size={38} fill="white" />
          ) : (
            <Play color="white" size={38} fill="white" />
          )}
        </Pressable>

        <Pressable
          onPress={guard(() => seekBy(15000))}
          style={styles.sideButton}
          hitSlop={8}
        >
          <RotateCw color="white" size={30} />
          <Text style={styles.badgeText}>15</Text>
        </Pressable>
      </View>

      {/* 底部：进度条 + 选集 / 倍速 / 全屏 */}
      <View style={styles.bottomBar}>
        <SeekSlider
          progress={progressPosition}
          duration={duration}
          onPreview={onPreview}
          onCommit={onCommit}
        />

        <View style={styles.actionRow}>
          <Pressable
            onPress={guard(() => {
              setShowControls(true);
              setShowEpisodeModal(true);
            })}
            style={styles.actionButton}
            hitSlop={6}
          >
            <List color="white" size={20} />
            <Text style={styles.actionText}>选集</Text>
          </Pressable>

          <Pressable
            onPress={guard(() => {
              setShowControls(true);
              setShowSpeedModal(true);
            })}
            style={styles.actionButton}
            hitSlop={6}
          >
            <Gauge color="white" size={20} />
            <Text style={styles.actionText}>
              {playbackRate !== 1.0 ? `${playbackRate}x` : "倍速"}
            </Text>
          </Pressable>

          <Pressable
            onPress={guard(() => toggleFullscreen())}
            style={styles.actionButton}
            hitSlop={6}
          >
            {isFullscreen ? (
              <Minimize color="white" size={20} />
            ) : (
              <Maximize color="white" size={20} />
            )}
            <Text style={styles.actionText}>{isFullscreen ? "退出全屏" : "全屏"}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "space-between",
    backgroundColor: "rgba(0,0,0,0.28)",
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingTop: 14,
    paddingBottom: 8,
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  titleWrap: {
    flex: 1,
    paddingHorizontal: 8,
  },
  title: {
    color: "white",
    fontSize: 15,
    fontWeight: "600",
  },
  subtitle: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 12,
    marginTop: 2,
  },
  centerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 40,
  },
  sideButton: {
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    position: "absolute",
    color: "white",
    fontSize: 9,
    fontWeight: "700",
  },
  playButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  bottomBar: {
    paddingHorizontal: 16,
    paddingBottom: 18,
  },
  sliderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  timeText: {
    color: "white",
    fontSize: 12,
    minWidth: 46,
    textAlign: "center",
    fontVariant: ["tabular-nums"],
  },
  sliderTrackHitArea: {
    flex: 1,
    height: 32,
    justifyContent: "center",
  },
  sliderTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.3)",
    overflow: "hidden",
  },
  sliderFill: {
    height: "100%",
    backgroundColor: "white",
  },
  sliderThumb: {
    position: "absolute",
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "white",
    top: 9,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    marginTop: 8,
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  actionText: {
    color: "white",
    fontSize: 13,
  },
});
