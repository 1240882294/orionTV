import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ChevronLeft, Maximize, Play, Pause, RefreshCw, Cast } from "lucide-react-native";
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

const logger = Logger.withTag("MobileInfoPanel");

/** 顶部返回栏高度（不含状态栏） */
export const MOBILE_PLAYER_HEADER_HEIGHT = 52;

/** 竖屏时视频预览区的 16:9 高度 */
export const getMobileVideoHeight = (width: number) => Math.round((width * 9) / 16);

interface Props {
  /** 视频区顶部偏移（状态栏 + 返回栏） */
  videoTop: number;
  /** 视频区高度 */
  videoHeight: number;
  /** 打开投屏面板；不传则不显示投屏入口 */
  onOpenCast?: () => void;
}

/**
 * 手机端退出全屏后的信息面板。
 * 上方保留视频预览，下方是剧集简介、线路（带实测速度）和播放列表，
 * 这样退出全屏后不用回详情页也能换集换源。
 */
export const MobilePlayerInfoPanel: React.FC<Props> = ({ videoTop, videoHeight, onOpenCast }) => {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { detail, searchResults, setDetail } = useDetailStore();
  const {
    episodes,
    currentEpisodeIndex,
    status,
    playEpisode,
    loadVideo,
    togglePlayPause,
    setIsFullscreen,
    setShowControls,
  } = usePlayerStore();

  const [expanded, setExpanded] = useState(false);
  const [speeds, setSpeeds] = useState<Record<string, SourceSpeedResult>>({});
  const [testing, setTesting] = useState(false);
  const mountedRef = useRef(true);
  const runIdRef = useRef(0);

  const isPlaying = status?.isLoaded ? !!status.isPlaying : false;

  const sourcesKey = searchResults.map((item) => item.source).join("|");
  const keyword = (detail?.title || "").trim();

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

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 面板出现时只读取打开视频时那一次测速的结果，切全屏/竖屏不再自动重测
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

  const onSelectSource = (index: number) => {
    const target = searchResults[index];
    if (!target || target.source === detail?.source) return;
    const position = status?.isLoaded ? status.positionMillis : undefined;
    setDetail(target);
    loadVideo({
      source: target.source,
      id: target.id.toString(),
      episodeIndex: currentEpisodeIndex,
      title: target.title,
      position,
    });
  };

  const onSelectEpisode = (index: number) => {
    if (index === currentEpisodeIndex) return;
    playEpisode(index);
  };

  const enterFullscreen = () => {
    setIsFullscreen(true);
    setShowControls(true);
  };

  const meta = [detail?.year, detail?.type_name].filter(Boolean).join(" · ");
  const episodeCount = episodes.length;

  return (
    <View style={styles.root} pointerEvents="box-none">
      {/* 顶部返回栏 */}
      <View style={[styles.header, { height: videoTop, paddingTop: insets.top }]}>
        <Pressable onPress={() => router.back()} style={styles.headerButton} hitSlop={10}>
          <ChevronLeft color="white" size={26} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {detail?.title || "正在播放"}
        </Text>
        {onOpenCast ? (
          <Pressable onPress={onOpenCast} style={styles.headerButton} hitSlop={10}>
            <Cast color="white" size={20} />
          </Pressable>
        ) : null}
        <Pressable onPress={enterFullscreen} style={styles.headerButton} hitSlop={10}>
          <Maximize color="white" size={20} />
        </Pressable>
      </View>

      {/* 视频预览区：点画面进全屏，右下角保留播放/暂停 */}
      <View style={{ height: videoHeight }} pointerEvents="box-none">
        <Pressable style={StyleSheet.absoluteFill} onPress={enterFullscreen} />
        <View style={styles.videoActions} pointerEvents="box-none">
          <Pressable onPress={togglePlayPause} style={styles.floatButton} hitSlop={8}>
            {isPlaying ? (
              <Pause color="white" size={18} fill="white" />
            ) : (
              <Play color="white" size={18} fill="white" />
            )}
          </Pressable>
          <Pressable onPress={enterFullscreen} style={styles.floatButton} hitSlop={8}>
            <Maximize color="white" size={18} />
          </Pressable>
        </View>
      </View>

      {/* 信息区 */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 32 }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title} numberOfLines={2}>
          {detail?.title || ""}
        </Text>
        {meta ? <Text style={styles.meta}>{meta}</Text> : null}

        {detail?.desc ? (
          <View style={styles.descBlock}>
            <Text style={styles.desc} numberOfLines={expanded ? undefined : 4}>
              {detail.desc}
            </Text>
            <Pressable onPress={() => setExpanded((value) => !value)} hitSlop={6}>
              <Text style={styles.expandText}>{expanded ? "收起" : "展开"}</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>播放源（{searchResults.length}）</Text>
          <Pressable onPress={runSpeedTest} style={styles.retest} disabled={testing} hitSlop={6}>
            {testing ? (
              <ActivityIndicator size="small" color="#9ca3af" />
            ) : (
              <RefreshCw color="#9ca3af" size={13} />
            )}
            <Text style={styles.retestText}>
              {testing ? "测速中" : Object.keys(speeds).length ? "重新测速" : "测速"}
            </Text>
          </Pressable>
        </View>

        <View style={styles.sourceGrid}>
          {searchResults.map((item, index) => {
            const speed = speeds[item.source];
            const grade = gradeSpeed(speed);
            const isCurrent = detail?.source === item.source;
            return (
              <Pressable
                key={`${item.source}-${index}`}
                onPress={() => onSelectSource(index)}
                style={[styles.sourceItem, isCurrent && styles.sourceItemActive]}
              >
                <Text style={styles.sourceName} numberOfLines={1}>
                  {item.source_name || item.source}
                </Text>
                <View style={styles.badgeRow}>
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{item.episodes?.length ?? 0} 集</Text>
                  </View>
                  {item.resolution ? (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{item.resolution}</Text>
                    </View>
                  ) : null}
                </View>
                <View style={styles.speedRow}>
                  <View style={[styles.speedDot, { backgroundColor: SPEED_COLORS[grade] }]} />
                  <Text
                    style={[styles.speedText, { color: SPEED_COLORS[grade] }]}
                    numberOfLines={1}
                  >
                    {speed ? formatSpeed(speed) : "未测速"}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        <View style={[styles.sectionHeader, { marginTop: 20 }]}>
          <Text style={styles.sectionTitle}>播放列表</Text>
          <Text style={styles.sectionHint}>
            共 {episodeCount} 集 · 当前第 {Math.max(1, currentEpisodeIndex + 1)} 集
          </Text>
        </View>

        <View style={styles.episodeGrid}>
          {episodes.map((episode, index) => {
            const isCurrent = index === currentEpisodeIndex;
            return (
              <Pressable
                key={`episode-${index}`}
                onPress={() => onSelectEpisode(index)}
                style={[styles.episodeItem, isCurrent && styles.episodeItemActive]}
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
  );
};

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 15,
    // 背景必须透明：视频层在面板下方，透过视频区才能看到画面
    backgroundColor: "transparent",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 6,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  headerButton: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    color: "white",
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
  },
  videoActions: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "flex-end",
    gap: 10,
    padding: 12,
  },
  floatButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
    zIndex: 2,
  },
  scroll: {
    flex: 1,
    backgroundColor: "#0b0b0c",
  },
  title: {
    color: "white",
    fontSize: 20,
    fontWeight: "700",
    marginTop: 14,
  },
  meta: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 12,
    marginTop: 6,
  },
  descBlock: {
    marginTop: 12,
  },
  desc: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 13,
    lineHeight: 21,
  },
  expandText: {
    color: "#60a5fa",
    fontSize: 13,
    marginTop: 6,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 18,
    marginBottom: 10,
  },
  sectionTitle: {
    color: "white",
    fontSize: 16,
    fontWeight: "700",
  },
  sectionHint: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 12,
  },
  retest: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  retestText: {
    color: "#9ca3af",
    fontSize: 11,
  },
  sourceGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  sourceItem: {
    width: "48.5%",
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "#1c1c1e",
    borderWidth: 1,
    borderColor: "transparent",
  },
  sourceItemActive: {
    borderColor: "#22c55e",
    backgroundColor: "rgba(34,197,94,0.16)",
  },
  sourceName: {
    color: "white",
    fontSize: 13,
    fontWeight: "600",
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5,
    marginTop: 6,
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  badgeText: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 10,
  },
  speedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 6,
  },
  speedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  speedText: {
    fontSize: 10,
    flexShrink: 1,
  },
  episodeGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  episodeItem: {
    width: "23%",
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1c1c1e",
    borderWidth: 1,
    borderColor: "transparent",
  },
  episodeItemActive: {
    borderColor: "#22c55e",
    backgroundColor: "rgba(34,197,94,0.18)",
  },
  episodeText: {
    color: "rgba(255,255,255,0.82)",
    fontSize: 12,
  },
  episodeTextActive: {
    color: "#4ade80",
    fontWeight: "700",
  },
  emptyText: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 12,
    marginTop: 12,
  },
});
