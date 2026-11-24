import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  useWindowDimensions,
} from "react-native";
import { useRouter } from "expo-router";
import {
  ChevronLeft,
  Maximize,
  Play,
  Pause,
  RefreshCw,
  SkipBack,
  SkipForward,
} from "lucide-react-native";
import useDetailStore from "@/stores/detailStore";
import usePlayerStore from "@/stores/playerStore";
import {
  SourceSpeedResult,
  SPEED_COLORS,
  formatSpeed,
  getCachedSpeeds,
  gradeSpeed,
  setCachedSpeeds,
  speedCacheKey,
  subscribeSpeeds,
  testSourcesSpeed,
} from "@/services/sourceSpeedTest";
import Logger from "@/utils/Logger";

const logger = Logger.withTag("TVInfoPanel");

/** 顶部返回栏高度 */
export const TV_PANEL_HEADER_HEIGHT = 64;
/** 面板左右留白 */
export const TV_PANEL_PADDING = 32;

/**
 * 电视端退出大屏后的布局尺寸。
 * 左侧是 16:9 小窗，右侧是信息栏，两边宽度按窗口比例分配。
 */
export const getTVVideoBox = (windowWidth: number) => {
  const padding = TV_PANEL_PADDING;
  const width = Math.round((windowWidth - padding * 3) * 0.58);
  return {
    padding,
    width,
    height: Math.round((width * 9) / 16),
    top: TV_PANEL_HEADER_HEIGHT + 20,
    rightWidth: Math.max(280, windowWidth - padding * 3 - width),
  };
};

const formatTime = (milliseconds: number) => {
  if (isNaN(milliseconds) || milliseconds < 0) return "00:00";
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours.toString().padStart(2, "0")}:${minutes
      .toString()
      .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
};

interface Props {
  windowWidth: number;
}

/**
 * 播放进度 + 上一集/播放/下一集。
 * 单独订阅 status，主面板就不会因为进度每秒刷新而把整排集数按钮重新渲染一遍
 * （电视盒子的 JS 线程比手机弱，这一步省下来是实打实的）。
 */
const TVPlaybackBar: React.FC<{ canPrev: boolean; canNext: boolean }> = ({ canPrev, canNext }) => {
  const status = usePlayerStore((state) => state.status);
  const progressPosition = usePlayerStore((state) => state.progressPosition);
  const togglePlayPause = usePlayerStore((state) => state.togglePlayPause);
  const playEpisode = usePlayerStore((state) => state.playEpisode);
  const currentEpisodeIndex = usePlayerStore((state) => state.currentEpisodeIndex);

  const isPlaying = status?.isLoaded ? !!status.isPlaying : false;
  const duration = status?.isLoaded ? status.durationMillis || 0 : 0;
  const positionMillis = status?.isLoaded ? status.positionMillis : 0;

  return (
    <>
      <View style={styles.progressRow}>
        <Text style={styles.timeText}>{formatTime(positionMillis)}</Text>
        <View style={styles.track}>
          <View
            style={[
              styles.trackFilled,
              { width: `${Math.max(0, Math.min(1, progressPosition)) * 100}%` },
            ]}
          />
        </View>
        <Text style={styles.timeText}>{formatTime(duration)}</Text>
      </View>

      <View style={styles.actions}>
        <Pressable
          onPress={() => playEpisode(currentEpisodeIndex - 1)}
          focusable
          disabled={!canPrev}
          style={({ pressed, focused }: { pressed: boolean; focused?: boolean }) => [
            styles.actionButton,
            (focused || pressed) && styles.focused,
            !canPrev && styles.disabled,
          ]}
        >
          <SkipBack color="white" size={22} />
          <Text style={styles.actionLabel}>上一集</Text>
        </Pressable>

        <Pressable
          onPress={togglePlayPause}
          focusable
          style={({ pressed, focused }: { pressed: boolean; focused?: boolean }) => [
            styles.actionButton,
            styles.actionPrimary,
            (focused || pressed) && styles.focused,
          ]}
        >
          {isPlaying ? (
            <Pause color="white" size={22} fill="white" />
          ) : (
            <Play color="white" size={22} fill="white" />
          )}
          <Text style={styles.actionLabel}>{isPlaying ? "暂停" : "播放"}</Text>
        </Pressable>

        <Pressable
          onPress={() => playEpisode(currentEpisodeIndex + 1)}
          focusable
          disabled={!canNext}
          style={({ pressed, focused }: { pressed: boolean; focused?: boolean }) => [
            styles.actionButton,
            (focused || pressed) && styles.focused,
            !canNext && styles.disabled,
          ]}
        >
          <SkipForward color="white" size={22} />
          <Text style={styles.actionLabel}>下一集</Text>
        </Pressable>
      </View>
    </>
  );
};

/**
 * 电视端小屏模式：大屏缩下来以后，左边继续播，右边能看简介、换线路、选集。
 * 全部按钮都做了遥控器焦点态，方向键移动、确定键触发。
 */
export const TVPlayerInfoPanel: React.FC<Props> = ({ windowWidth }) => {
  const router = useRouter();
  const box = getTVVideoBox(windowWidth);
  const { height: windowHeight } = useWindowDimensions();
  // 720p 电视的逻辑分辨率可能只有 960×540，这时把字和间距收一收，别溢出屏幕
  const compact = windowWidth < 1100;

  // 信息区自然位置在视频下方；屏幕太矮时往上顶，避免按钮掉出屏幕
  const naturalTop = box.top + box.height + 18;
  const leftTop = Math.min(naturalTop, Math.max(TV_PANEL_HEADER_HEIGHT + 60, windowHeight - 200));
  const leftClamped = leftTop < naturalTop;

  const { detail, searchResults, setDetail } = useDetailStore();
  const episodes = usePlayerStore((state) => state.episodes);
  const currentEpisodeIndex = usePlayerStore((state) => state.currentEpisodeIndex);
  const playEpisode = usePlayerStore((state) => state.playEpisode);
  const loadVideo = usePlayerStore((state) => state.loadVideo);
  const setIsFullscreen = usePlayerStore((state) => state.setIsFullscreen);
  const setShowControls = usePlayerStore((state) => state.setShowControls);

  const [speeds, setSpeeds] = useState<Record<string, SourceSpeedResult>>({});
  const [testing, setTesting] = useState(false);
  // 遥控器焦点落在小窗画面上时给个明显边框，否则电视上根本看不出选中了
  const [videoFocused, setVideoFocused] = useState(false);
  const mountedRef = useRef(true);
  const runIdRef = useRef(0);

  const sourcesKey = searchResults.map((item) => item.source).join("|");
  const keyword = (detail?.title || "").trim();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 面板出现时读取打开视频那次测速的结果，切大屏/小屏不重复测
  useEffect(() => {
    if (!keyword || !sourcesKey) return;
    setSpeeds(getCachedSpeeds(keyword) ?? {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, sourcesKey]);

  // 测速结果随时同步（播放前测速、线路弹窗手动测速都会推过来）
  useEffect(() => {
    const key = speedCacheKey(keyword);
    return subscribeSpeeds((changedKey, results) => {
      if (!mountedRef.current || changedKey !== key) return;
      setSpeeds(results);
    });
  }, [keyword]);

  const runSpeedTest = useCallback(() => {
    if (!keyword || searchResults.length === 0) return;
    const runId = ++runIdRef.current;
    setTesting(true);

    testSourcesSpeed(searchResults, keyword, (result) => {
      if (!mountedRef.current || runId !== runIdRef.current) return;
      setSpeeds((prev) => ({ ...prev, [result.source]: result }));
      setCachedSpeeds(keyword, { [result.source]: result }, true);
    })
      .then((results) => {
        if (runId === runIdRef.current) setCachedSpeeds(keyword, results);
        if (mountedRef.current && runId === runIdRef.current) setTesting(false);
      })
      .catch((error) => {
        logger.debug("speed test aborted", error);
        if (mountedRef.current && runId === runIdRef.current) setTesting(false);
      });
  }, [keyword, searchResults]);

  const onSelectSource = (index: number) => {
    const target = searchResults[index];
    if (!target || target.source === detail?.source) return;
    const status = usePlayerStore.getState().status;
    const currentPosition = status?.isLoaded ? status.positionMillis : undefined;
    setDetail(target);
    loadVideo({
      source: target.source,
      id: target.id.toString(),
      episodeIndex: currentEpisodeIndex,
      title: target.title,
      position: currentPosition,
    });
  };

  const onSelectEpisode = (index: number) => {
    if (index === currentEpisodeIndex) return;
    playEpisode(index);
  };

  const enterFullscreen = () => {
    setIsFullscreen(true);
    setShowControls(false);
  };

  const meta = [detail?.year, detail?.type_name].filter(Boolean).join(" · ");
  const currentSpeed = detail?.source ? speeds[detail.source] : undefined;
  const currentGrade = gradeSpeed(currentSpeed);

  return (
    <View style={styles.root} pointerEvents="box-none">
      {/* 小窗画面：遥控器可选中，确定键直接放大回全屏 */}
      <Pressable
        onPress={enterFullscreen}
        focusable
        onFocus={() => setVideoFocused(true)}
        onBlur={() => setVideoFocused(false)}
        style={({ pressed }: { pressed: boolean }) => [
          styles.videoHitArea,
          {
            top: box.top,
            left: box.padding,
            width: box.width,
            height: box.height,
          },
          (videoFocused || pressed) && styles.videoHitAreaFocused,
        ]}
      >
        {videoFocused ? (
          <View style={styles.videoHint} pointerEvents="none">
            <Maximize color="white" size={18} />
            <Text style={styles.videoHintText}>按确定键全屏</Text>
          </View>
        ) : null}
      </Pressable>

      {/* 顶部栏 */}
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          focusable
          style={({ pressed, focused }: { pressed: boolean; focused?: boolean }) => [
            styles.headerButton,
            (focused || pressed) && styles.focused,
          ]}
        >
          <ChevronLeft color="white" size={26} />
        </Pressable>

        <Text style={[styles.headerTitle, compact && styles.headerTitleCompact]} numberOfLines={1}>
          {detail?.title || "正在播放"}
          {episodes[currentEpisodeIndex]?.title ? ` · ${episodes[currentEpisodeIndex].title}` : ""}
        </Text>

        <Pressable
          onPress={enterFullscreen}
          focusable
          hasTVPreferredFocus
          style={({ pressed, focused }: { pressed: boolean; focused?: boolean }) => [
            styles.fullscreenButton,
            (focused || pressed) && styles.focused,
          ]}
        >
          <Maximize color="white" size={20} />
          <Text style={styles.fullscreenText}>全屏</Text>
        </Pressable>
      </View>

      {/* 左侧：小窗下方的标题、进度与操作 */}
      <View
        style={[
          styles.leftColumn,
          {
            top: leftTop,
            left: box.padding,
            width: box.width,
            ...(leftClamped
              ? { backgroundColor: "rgba(11,11,12,0.94)", borderRadius: 12, padding: 14 }
              : {}),
          },
        ]}
        pointerEvents="box-none"
      >
        <Text style={[styles.title, compact && styles.titleCompact]} numberOfLines={1}>
          {detail?.title || ""}
        </Text>

        <View style={styles.metaRow}>
          {meta ? <Text style={styles.meta}>{meta}</Text> : null}
          {detail?.source_name ? (
            <View style={styles.sourceTag}>
              <Text style={styles.sourceTagText}>{detail.source_name}</Text>
            </View>
          ) : null}
          {currentSpeed ? (
            <View style={styles.speedRow}>
              <View style={[styles.speedDot, { backgroundColor: SPEED_COLORS[currentGrade] }]} />
              <Text style={[styles.speedText, { color: SPEED_COLORS[currentGrade] }]}>
                {formatSpeed(currentSpeed)}
              </Text>
            </View>
          ) : null}
        </View>

        <TVPlaybackBar
          canPrev={currentEpisodeIndex > 0}
          canNext={currentEpisodeIndex < episodes.length - 1}
        />
      </View>

      {/* 右侧：简介、播放源、选集 */}
      <View
        style={[
          styles.rightColumn,
          {
            top: TV_PANEL_HEADER_HEIGHT,
            left: box.padding * 2 + box.width,
            width: box.rightWidth + box.padding,
            paddingRight: box.padding,
          },
        ]}
      >
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          {detail?.desc ? (
            <>
              <Text style={styles.sectionTitle}>剧情简介</Text>
              <Text style={styles.desc}>{detail.desc}</Text>
            </>
          ) : null}

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>播放源（{searchResults.length}）</Text>
            <Pressable
              onPress={runSpeedTest}
              focusable
              disabled={testing}
              style={({ pressed, focused }: { pressed: boolean; focused?: boolean }) => [
                styles.retest,
                (focused || pressed) && styles.focused,
              ]}
            >
              {testing ? (
                <ActivityIndicator size="small" color="#9ca3af" />
              ) : (
                <RefreshCw color="#d1d5db" size={14} />
              )}
              <Text style={styles.retestText}>
                {testing ? "测速中" : Object.keys(speeds).length ? "重新测速" : "测速"}
              </Text>
            </Pressable>
          </View>

          <View style={styles.sourceList}>
            {searchResults.map((item, index) => {
              const speed = speeds[item.source];
              const grade = gradeSpeed(speed);
              const isCurrent = detail?.source === item.source;
              return (
                <Pressable
                  key={`${item.source}-${index}`}
                  onPress={() => onSelectSource(index)}
                  focusable
                  style={({ pressed, focused }: { pressed: boolean; focused?: boolean }) => [
                    styles.sourceItem,
                    isCurrent && styles.sourceItemActive,
                    (focused || pressed) && styles.focused,
                  ]}
                >
                  <View style={styles.sourceHead}>
                    <Text style={styles.sourceName} numberOfLines={1}>
                      {item.source_name || item.source}
                    </Text>
                    {isCurrent ? <Text style={styles.currentBadge}>当前</Text> : null}
                  </View>
                  <View style={styles.sourceMeta}>
                    <Text style={styles.sourceMetaText}>{item.episodes?.length ?? 0} 集</Text>
                    {item.resolution ? <Text style={styles.sourceMetaText}>{item.resolution}</Text> : null}
                    <View style={[styles.speedDot, { backgroundColor: SPEED_COLORS[grade] }]} />
                    <Text style={[styles.speedText, { color: SPEED_COLORS[grade] }]} numberOfLines={1}>
                      {speed ? formatSpeed(speed) : "未测速"}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>播放列表</Text>
            <Text style={styles.sectionHint}>
              共 {episodes.length} 集 · 当前第 {Math.max(1, currentEpisodeIndex + 1)} 集
            </Text>
          </View>

          <View style={styles.episodeGrid}>
            {episodes.map((episode, index) => {
              const isCurrent = index === currentEpisodeIndex;
              return (
                <Pressable
                  key={`episode-${index}`}
                  onPress={() => onSelectEpisode(index)}
                  focusable
                  style={({ pressed, focused }: { pressed: boolean; focused?: boolean }) => [
                    styles.episodeItem,
                    isCurrent && styles.episodeItemActive,
                    (focused || pressed) && styles.focused,
                  ]}
                >
                  <Text style={[styles.episodeText, isCurrent && styles.episodeTextActive]}>
                    {episode.title || `第 ${index + 1} 集`}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {episodes.length === 0 ? (
            <Text style={styles.emptyText}>当前线路暂无可播放剧集，换一条线路试试</Text>
          ) : null}
        </ScrollView>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 15,
    backgroundColor: "transparent",
  },
  header: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: TV_PANEL_HEADER_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 18,
    backgroundColor: "#0b0b0c",
  },
  headerButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "transparent",
  },
  headerTitle: {
    flex: 1,
    color: "white",
    fontSize: 20,
    fontWeight: "700",
    marginHorizontal: 16,
  },
  headerTitleCompact: {
    fontSize: 16,
  },
  fullscreenButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.14)",
    borderWidth: 2,
    borderColor: "transparent",
  },
  fullscreenText: {
    color: "white",
    fontSize: 14,
    fontWeight: "600",
  },
  videoHitArea: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
    borderWidth: 3,
    borderColor: "transparent",
    borderRadius: 6,
  },
  videoHitAreaFocused: {
    borderColor: "#ffffff",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  videoHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.62)",
  },
  videoHintText: {
    color: "white",
    fontSize: 14,
    fontWeight: "600",
  },
  leftColumn: {
    position: "absolute",
    backgroundColor: "transparent",
  },
  title: {
    color: "white",
    fontSize: 26,
    fontWeight: "700",
    lineHeight: 32,
  },
  titleCompact: {
    fontSize: 20,
    lineHeight: 26,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 8,
  },
  meta: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 14,
  },
  sourceTag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  sourceTagText: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 12,
  },
  speedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  speedDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  speedText: {
    fontSize: 12,
  },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 12,
  },
  timeText: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 13,
    fontVariant: ["tabular-nums"],
    minWidth: 46,
  },
  track: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.22)",
    overflow: "hidden",
  },
  trackFilled: {
    height: "100%",
    backgroundColor: "#22c55e",
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginTop: 14,
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 2,
    borderColor: "transparent",
  },
  actionPrimary: {
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  actionLabel: {
    color: "white",
    fontSize: 14,
    fontWeight: "600",
  },
  disabled: {
    opacity: 0.35,
  },

  rightColumn: {
    position: "absolute",
    bottom: 0,
    backgroundColor: "#0b0b0c",
  },
  scrollContent: {
    paddingLeft: 24,
    paddingTop: 20,
    paddingBottom: 48,
  },
  sectionTitle: {
    color: "white",
    fontSize: 17,
    fontWeight: "700",
  },
  desc: {
    color: "rgba(255,255,255,0.68)",
    fontSize: 14,
    lineHeight: 24,
    marginTop: 10,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 24,
    marginBottom: 12,
    gap: 12,
  },
  sectionHint: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 12,
  },
  retest: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 2,
    borderColor: "transparent",
  },
  retestText: {
    color: "#d1d5db",
    fontSize: 12,
  },
  sourceList: {
    gap: 10,
  },
  sourceItem: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: "#1a1a1c",
    borderWidth: 2,
    borderColor: "transparent",
  },
  sourceItemActive: {
    backgroundColor: "rgba(34,197,94,0.16)",
    borderColor: "rgba(34,197,94,0.6)",
  },
  sourceHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sourceName: {
    color: "white",
    fontSize: 15,
    fontWeight: "600",
    flexShrink: 1,
  },
  currentBadge: {
    color: "#4ade80",
    fontSize: 11,
    fontWeight: "700",
  },
  sourceMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 7,
  },
  sourceMetaText: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
  },
  episodeGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  episodeItem: {
    minWidth: 74,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1a1a1c",
    borderWidth: 2,
    borderColor: "transparent",
  },
  episodeItemActive: {
    backgroundColor: "rgba(34,197,94,0.18)",
    borderColor: "rgba(34,197,94,0.6)",
  },
  episodeText: {
    color: "rgba(255,255,255,0.82)",
    fontSize: 13,
  },
  episodeTextActive: {
    color: "#4ade80",
    fontWeight: "700",
  },
  focused: {
    borderColor: "white",
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  emptyText: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 13,
    marginTop: 14,
  },
});
