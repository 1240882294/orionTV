import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  FlatList,
  Pressable,
  ActivityIndicator,
  Platform,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { RefreshCw } from "lucide-react-native";
import useDetailStore from "@/stores/detailStore";
import usePlayerStore from "@/stores/playerStore";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";
import {
  SourceSpeedResult,
  SPEED_COLORS,
  formatSpeed,
  gradeSpeed,
  testSourcesSpeed,
} from "@/services/sourceSpeedTest";
import Logger from "@/utils/Logger";

const logger = Logger.withTag("SourceSelectionModal");

export const SourceSelectionModal: React.FC = () => {
  const { showSourceModal, setShowSourceModal, loadVideo, currentEpisodeIndex, status } = usePlayerStore();
  const { searchResults, detail, setDetail } = useDetailStore();

  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { deviceType } = useResponsiveLayout();

  // 电视端右侧抽屉，手机/平板底部抽屉
  const isTV = Platform.isTV || deviceType === "tv";
  const isLandscape = width > height;

  const [speeds, setSpeeds] = useState<Record<string, SourceSpeedResult>>({});
  const [testing, setTesting] = useState(false);
  const mountedRef = useRef(true);
  const runIdRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const runSpeedTest = useCallback(() => {
    const keyword = (detail?.title || searchResults[0]?.title || "").trim();
    const sources = searchResults.map((r) => r.source);
    if (!keyword || sources.length === 0) return;

    const runId = ++runIdRef.current;
    setTesting(true);
    // 开新一轮时清掉旧结果，避免把上一轮的延迟当成当前的
    setSpeeds({});

    testSourcesSpeed(sources, keyword, (result) => {
      if (!mountedRef.current || runId !== runIdRef.current) return;
      setSpeeds((prev) => ({ ...prev, [result.source]: result }));
    })
      .then(() => {
        if (mountedRef.current && runId === runIdRef.current) setTesting(false);
      })
      .catch((error) => {
        logger.debug("speed test aborted", error);
        if (mountedRef.current && runId === runIdRef.current) setTesting(false);
      });
  }, [detail?.title, searchResults]);

  // 每次打开弹窗都重新测速：源站状态会变，缓存反而误导用户
  useEffect(() => {
    if (showSourceModal) {
      runSpeedTest();
    }
  }, [showSourceModal, runSpeedTest]);

  const onSelectSource = (index: number) => {
    const target = searchResults[index];
    if (!target) return;
    logger.debug("onSelectSource", index, target.source, detail?.source);
    if (target.source !== detail?.source) {
      setDetail(target);

      // 切源时保留当前进度
      const currentPosition = status?.isLoaded ? status.positionMillis : undefined;
      loadVideo({
        source: target.source,
        id: target.id.toString(),
        episodeIndex: currentEpisodeIndex,
        title: target.title,
        position: currentPosition,
      });
    }
    setShowSourceModal(false);
  };

  const onClose = () => setShowSourceModal(false);

  const columns = isTV ? 3 : isLandscape ? 4 : 2;

  return (
    <Modal visible={showSourceModal} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[
            isTV ? styles.panelTV : styles.panelMobile,
            isTV
              ? { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }
              : { paddingBottom: insets.bottom + 12, maxHeight: height * 0.78 },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.header}>
            <View style={styles.headerTextWrap}>
              <Text style={styles.modalTitle}>选择播放源</Text>
              <Text style={styles.headerHint}>
                {testing ? "正在测速…" : `共 ${searchResults.length} 个源，延迟越低越流畅`}
              </Text>
            </View>
            <Pressable onPress={runSpeedTest} style={styles.retestButton} hitSlop={8} disabled={testing}>
              {testing ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <RefreshCw color="white" size={16} />
              )}
              <Text style={styles.retestText}>{testing ? "测速中" : "重新测速"}</Text>
            </Pressable>
          </View>

          <FlatList
            key={`sources-${columns}`}
            data={searchResults}
            numColumns={columns}
            keyExtractor={(item, index) => `source-${item.source}-${index}`}
            contentContainerStyle={styles.sourceList}
            showsVerticalScrollIndicator={false}
            renderItem={({ item, index }) => {
              const speed = speeds[item.source];
              const grade = gradeSpeed(speed);
              const isCurrent = detail?.source === item.source;
              return (
                <Pressable
                  onPress={() => onSelectSource(index)}
                  focusable
                  hasTVPreferredFocus={isCurrent}
                  style={({ pressed, focused }: { pressed: boolean; focused?: boolean }) => [
                    styles.sourceItem,
                    isCurrent && styles.sourceItemActive,
                    (focused || pressed) && styles.sourceItemFocused,
                  ]}
                >
                  <Text style={styles.sourceName} numberOfLines={1}>
                    {item.source_name || item.source}
                  </Text>

                  <View style={styles.metaRow}>
                    <View style={[styles.speedDot, { backgroundColor: SPEED_COLORS[grade] }]} />
                    <Text style={[styles.speedText, { color: SPEED_COLORS[grade] }]} numberOfLines={1}>
                      {formatSpeed(speed)}
                    </Text>
                    {item.resolution ? (
                      <Text style={styles.resolutionText} numberOfLines={1}>
                        {item.resolution}
                      </Text>
                    ) : null}
                  </View>

                  {isCurrent ? <Text style={styles.currentBadge}>当前源</Text> : null}
                </Pressable>
              );
            }}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  panelTV: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    width: 620,
    backgroundColor: "rgba(18,18,18,0.97)",
    paddingHorizontal: 20,
  },
  panelMobile: {
    width: "100%",
    backgroundColor: "rgba(18,18,18,0.97)",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 14,
    paddingTop: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
    gap: 12,
  },
  headerTextWrap: {
    flex: 1,
  },
  modalTitle: {
    color: "white",
    fontSize: 17,
    fontWeight: "700",
  },
  headerHint: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
    marginTop: 3,
  },
  retestButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  retestText: {
    color: "white",
    fontSize: 12,
  },
  sourceList: {
    paddingBottom: 8,
  },
  sourceItem: {
    flex: 1,
    margin: 4,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: 1,
    borderColor: "transparent",
  },
  sourceItemActive: {
    backgroundColor: "rgba(59,130,246,0.22)",
    borderColor: "rgba(59,130,246,0.75)",
  },
  sourceItemFocused: {
    borderColor: "white",
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  sourceName: {
    color: "white",
    fontSize: 14,
    fontWeight: "600",
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
    gap: 5,
  },
  speedDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  speedText: {
    fontSize: 11,
    flexShrink: 1,
  },
  resolutionText: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 10,
    marginLeft: "auto",
  },
  currentBadge: {
    color: "#93c5fd",
    fontSize: 10,
    marginTop: 4,
  },
});
