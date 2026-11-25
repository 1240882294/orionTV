import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  PanResponder,
  LayoutChangeEvent,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import {
  ChevronLeft,
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Maximize,
  Minimize,
  SkipBack,
  SkipForward,
  Cast,
  Lock,
  LockOpen,
} from "lucide-react-native";
import usePlayerStore from "@/stores/playerStore";
import useDetailStore from "@/stores/detailStore";

interface MobilePlayerControlsProps {
  showControls: boolean;
  setShowControls: (show: boolean) => void;
  /** 打开投屏面板；不传就不显示投屏入口（电视端不需要） */
  onOpenCast?: () => void;
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
        updateFromX(evt.nativeEvent.pageX);
      },
      onPanResponderMove: (_evt, gesture) => {
        updateFromX(gesture.moveX);
      },
      onPanResponderRelease: () => {
        setLocalRatio(null);
        onCommit(ratioRef.current);
      },
      onPanResponderTerminate: () => {
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
  onOpenCast,
}) => {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  const {
    status,
    episodes,
    currentEpisodeIndex,
    isFullscreen,
    showEpisodeModal,
    showSpeedModal,
    showSourceModal,
    screenLocked,
    togglePlayPause,
    toggleFullscreen,
    setScreenLocked,
    playEpisode,
    seekBy,
    beginSeek,
    updateSeekPreview,
    commitSeek,
    progressPosition,
  } = usePlayerStore();

  const { detail } = useDetailStore();
  const [interactionTick, setInteractionTick] = useState(0);
  // 锁定后那枚锁自动淡出，避免一直压在画面上；点屏幕重新出现
  const [lockHintVisible, setLockHintVisible] = useState(true);
  const [lockHintTick, setLockHintTick] = useState(0);

  const touch = useCallback(() => setInteractionTick((v) => v + 1), []);

  const isPlaying = status?.isLoaded ? !!status.isPlaying : false;
  const duration = status?.isLoaded ? status.durationMillis || 0 : 0;
  const currentEpisodeTitle = episodes[currentEpisodeIndex]?.title;
  // 弹窗打开期间不自动隐藏控件，否则关掉弹窗后一片黑（锁屏时不隐藏，否则解锁入口会消失）
  const anyModalOpen = showEpisodeModal || showSpeedModal || showSourceModal;

  // 播放中 4 秒无操作自动隐藏控件
  useEffect(() => {
    if (!showControls || !isPlaying || anyModalOpen || screenLocked) return;
    const timer = setTimeout(() => setShowControls(false), 4000);
    return () => clearTimeout(timer);
  }, [showControls, isPlaying, anyModalOpen, screenLocked, interactionTick, setShowControls]);

  // 锁屏图标：锁定 2.6 秒后自动消隐；点屏幕用 lockHintTick 重新计时
  useEffect(() => {
    if (!screenLocked) {
      setLockHintVisible(true);
      return;
    }
    setLockHintVisible(true);
    const timer = setTimeout(() => setLockHintVisible(false), 2600);
    return () => clearTimeout(timer);
  }, [screenLocked, lockHintTick]);

  const guard = (fn: () => void) => () => {
    touch();
    fn();
  };

  const canPrev = currentEpisodeIndex > 0;
  const canNext = currentEpisodeIndex >= 0 && currentEpisodeIndex < episodes.length - 1;

  const prevEpisode = () => {
    if (canPrev) playEpisode(currentEpisodeIndex - 1);
  };
  const nextEpisode = () => {
    if (canNext) playEpisode(currentEpisodeIndex + 1);
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
        // 标记来源为控件进度条：此时不要再显示全屏手势预览条，否则两条进度条会叠在一起
        beginSeek("slider");
      }
      updateSeekPreview(ratio, "slider");
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

  // 锁屏：只留解锁入口，其余控件全部不渲染（手势层也由 play.tsx 一并屏蔽）
  // 注意：这里不能整层换成另一个 View。整层替换会让视频所在的 SurfaceView 重新参与
  // 合成，安卓上会短暂留下一层按旧尺寸拉伸的画面，看起来就是上下两条「蒙版」。
  // 现在保持同一个容器，只切换子节点，画面层不会被动到。
  if (screenLocked) {
    return (
      <View style={[styles.overlay, styles.overlayLocked]} pointerEvents="box-none">
        {/* 点任意位置：把解锁按钮叫出来（否则图标自动消隐后没法解锁） */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => {
            setLockHintVisible(true);
            setLockHintTick((v) => v + 1);
          }}
        />
        {lockHintVisible ? (
          <View style={styles.lockSlot} pointerEvents="box-none">
            <Pressable
              onPress={() => {
                // 解锁后顺手把控件亮出来，省得用户以为没反应
                setScreenLocked(false);
                setShowControls(true);
                touch();
              }}
              style={styles.lockCircle}
              hitSlop={14}
              accessibilityLabel="解锁"
            >
              <Lock color="white" size={20} />
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  }

  if (!showControls) return null;

  // 横屏时上方是刘海/挖孔，左右要避开；竖屏时上方是状态栏
  const topInset = isLandscape ? Math.max(insets.top, 8) : insets.top + 8;
  const bottomInset = Math.max(insets.bottom, isLandscape ? 10 : 16);
  const sideInset = Math.max(insets.left, insets.right, isLandscape ? 20 : 12);

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      {/* 左侧居中：锁屏。锁定后同一位置变成解锁，只有一个图标，不带文字 */}
      <View style={styles.lockSlot} pointerEvents="box-none">
        <Pressable
          onPress={guard(() => setScreenLocked(true))}
          style={styles.lockCircle}
          hitSlop={12}
          accessibilityLabel="锁屏"
        >
          <LockOpen color="white" size={20} />
        </Pressable>
      </View>

      {/* 顶部：返回 + 标题 + 全屏 */}
      <View
        style={[
          styles.topBar,
          {
            paddingTop: topInset,
            paddingLeft: sideInset,
            paddingRight: sideInset,
          },
        ]}
      >
        <Pressable onPress={guard(onBack)} style={styles.iconButton} hitSlop={10}>
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
        <Pressable onPress={guard(() => toggleFullscreen())} style={styles.iconButton} hitSlop={10}>
          {isFullscreen ? <Minimize color="white" size={22} /> : <Maximize color="white" size={22} />}
        </Pressable>
      </View>

      {/* 中间：快退 15s / 播放暂停 / 快进 15s */}
      <View style={styles.centerRow} pointerEvents="box-none">
        <Pressable onPress={guard(() => seekBy(-15000))} style={styles.sideButton} hitSlop={8}>
          <RotateCcw color="white" size={isLandscape ? 26 : 30} />
          <Text style={styles.badgeText}>15</Text>
        </Pressable>

        <Pressable
          onPress={guard(() => togglePlayPause())}
          style={[styles.playButton, isLandscape && styles.playButtonLandscape]}
          hitSlop={8}
        >
          {isPlaying ? (
            <Pause color="white" size={isLandscape ? 32 : 38} fill="white" />
          ) : (
            <Play color="white" size={isLandscape ? 32 : 38} fill="white" />
          )}
        </Pressable>

        <Pressable onPress={guard(() => seekBy(15000))} style={styles.sideButton} hitSlop={8}>
          <RotateCw color="white" size={isLandscape ? 26 : 30} />
          <Text style={styles.badgeText}>15</Text>
        </Pressable>
      </View>

      {/* 底部：进度条 + 选集 / 倍速 / 线路 / 全屏 */}
      <View
        style={[
          styles.bottomBar,
          {
            paddingBottom: bottomInset,
            paddingLeft: sideInset,
            paddingRight: sideInset,
          },
        ]}
      >
        <SeekSlider
          progress={progressPosition}
          duration={duration}
          onPreview={onPreview}
          onCommit={onCommit}
        />

        <View style={styles.actionRow}>
          <Pressable
            onPress={guard(prevEpisode)}
            disabled={!canPrev}
            style={[styles.actionButton, !canPrev && styles.actionButtonDisabled]}
            hitSlop={6}
          >
            <SkipBack color="white" size={18} />
            <Text style={styles.actionText}>上一集</Text>
          </Pressable>

          <Pressable
            onPress={guard(nextEpisode)}
            disabled={!canNext}
            style={[styles.actionButton, !canNext && styles.actionButtonDisabled]}
            hitSlop={6}
          >
            <SkipForward color="white" size={18} />
            <Text style={styles.actionText}>下一集</Text>
          </Pressable>

          {onOpenCast ? (
            <Pressable
              onPress={guard(() => {
                setShowControls(true);
                onOpenCast();
              })}
              style={styles.actionButton}
              hitSlop={6}
            >
              <Cast color="white" size={18} />
              <Text style={styles.actionText}>投屏</Text>
            </Pressable>
          ) : null}
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
    // 关键：必须压在视频层与点击层之上，否则触摸会被下层吃掉，表现为「按钮全部没反应」
    zIndex: 30,
    elevation: 30,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
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
  playButtonLandscape: {
    width: 60,
    height: 60,
    borderRadius: 30,
  },
  bottomBar: {
    paddingTop: 6,
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
    marginTop: 6,
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  actionButtonDisabled: {
    opacity: 0.35,
  },
  actionText: {
    color: "white",
    fontSize: 12,
  },
  // 锁定态不压暗画面：只保留一个可点的空层，背景交给视频本身
  overlayLocked: {
    backgroundColor: "transparent",
  },
  // 锁 / 解锁共用同一个槽位：屏幕最左侧、纵向居中
  lockSlot: {
    position: "absolute",
    left: 10,
    top: "50%",
    marginTop: -22,
    zIndex: 41,
    elevation: 41,
  },
  lockCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.45)",
  },
});
