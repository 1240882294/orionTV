/**
 * 手机端投屏面板：设备选择 + 投屏后的遥控器。
 *
 * 投屏后手机就是遥控器：进度、快进快退、暂停、选集、换线路都从这里发指令，
 * 本机播放会暂停，避免电视和手机同时出声。
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import {
  Cast,
  ChevronDown,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Tv,
  Wifi,
  X,
} from "lucide-react-native";
import { useCastStore } from "@/stores/castStore";
import usePlayerStore from "@/stores/playerStore";
import useDetailStore from "@/stores/detailStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { resolveAdFreePlaybackUrl } from "@/services/adblock";
import { publishPlaylist } from "@/services/cast/localPlaylist";
import type { CastDevice, CastPlayRequest } from "@/services/cast/types";

interface CastPanelProps {
  visible: boolean;
  onClose: () => void;
}

const formatTime = (seconds: number) => {
  if (!seconds || !Number.isFinite(seconds) || seconds < 0) return "00:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
};

/** 投屏前把地址准备好：DLNA 要把去广告的列表转发出去，互投则交给电视端自己处理 */
async function prepareUrl(rawUrl: string, device: CastDevice): Promise<string> {
  if (device.protocol === "orion") return rawUrl;

  const adBlockEnabled = useSettingsStore.getState().adBlockEnabled;
  if (!adBlockEnabled || !/\.m3u8(?:[?#]|$)/i.test(rawUrl)) return rawUrl;

  try {
    const result = await resolveAdFreePlaybackUrl(rawUrl, { enabled: true });
    if (result.local && result.url.startsWith("file://")) {
      return await publishPlaylist(result.url);
    }
    return result.url;
  } catch {
    // 去广告失败就直投原始地址，不能因此投不出去
    return rawUrl;
  }
}

export function CastPanel({ visible, onClose }: CastPanelProps) {
  const { height } = useWindowDimensions();
  const {
    devices,
    scanning,
    activeDevice,
    session,
    status,
    seekSupported,
    busy,
    error,
    scan,
    startCast,
    castAgain,
    toggle,
    seekBy,
    seekTo,
    disconnect,
  } = useCastStore();

  const [casting, setCasting] = useState(false);
  const [barWidth, setBarWidth] = useState(0);
  const [showEpisodes, setShowEpisodes] = useState(false);
  const [showSources, setShowSources] = useState(false);

  const detail = useDetailStore((state) => state.detail);
  const sources = useDetailStore((state) => state.sources);

  useEffect(() => {
    if (!visible) return;
    if (activeDevice) return;
    if (devices.length === 0) {
      scan();
    }
  }, [visible, activeDevice, devices.length, scan]);

  const currentEpisodeIndex = usePlayerStore((state) => state.currentEpisodeIndex);

  const buildSession = useCallback(() => {
    const store = usePlayerStore.getState();
    const currentDetail = useDetailStore.getState().detail;
    if (!currentDetail) return null;
    return {
      title: currentDetail.title,
      source: currentDetail.source,
      sourceName: currentDetail.source_name,
      id: String(currentDetail.id),
      episodeIndex: store.currentEpisodeIndex,
      totalEpisodes: store.episodes.length,
      cover: currentDetail.poster || "",
      year: currentDetail.year || "",
    };
  }, []);

  const castEpisode = useCallback(
    async (device: CastDevice, episodeIndex: number, position = 0) => {
      const store = usePlayerStore.getState();
      const currentDetail = useDetailStore.getState().detail;
      const episode = store.episodes[episodeIndex];
      if (!currentDetail || !episode?.url) {
        throw new Error("当前没有可投的播放地址");
      }

      const url = await prepareUrl(episode.url, device);
      const request: CastPlayRequest = {
        title: currentDetail.title,
        source: currentDetail.source,
        sourceName: currentDetail.source_name,
        id: String(currentDetail.id),
        episodeIndex,
        position: Math.floor(position),
        url,
      };
      return request;
    },
    []
  );

  const onPickDevice = async (device: CastDevice) => {
    const sessionData = buildSession();
    if (!sessionData) return;
    const store = usePlayerStore.getState();
    const position = store.status?.isLoaded ? (store.status.positionMillis || 0) / 1000 : 0;

    setCasting(true);
    try {
      const request = await castEpisode(device, sessionData.episodeIndex, position);
      // 投屏成功后再暂停本机，避免投失败时用户这边也没画面
      await store.videoRef?.current?.pauseAsync().catch(() => {});
      await startCast(device, request, sessionData);
    } catch {
      // store 里已经有 error，这里不用重复提示
    } finally {
      setCasting(false);
    }
  };

  const onSelectEpisode = async (index: number) => {
    if (!activeDevice || !session) return;
    setShowEpisodes(false);
    try {
      const request = await castEpisode(activeDevice, index, 0);
      const store = usePlayerStore.getState();
      await castAgain(request, { ...session, episodeIndex: index, totalEpisodes: store.episodes.length });
    } catch {
      // error 已在 store
    }
  };

  const onSelectSource = async (sourceKey: string) => {
    if (!activeDevice || !session) return;
    setShowSources(false);
    const target = useDetailStore.getState().searchResults.find((item) => item.source === sourceKey);
    if (!target) return;
    try {
      await useDetailStore.getState().setDetail(target);
      const nextDetail = useDetailStore.getState().detail;
      if (!nextDetail) return;
      const index = Math.min(session.episodeIndex, Math.max(0, nextDetail.episodes.length - 1));
      const url = await prepareUrl(nextDetail.episodes[index], activeDevice);
      await castAgain(
        {
          title: nextDetail.title,
          source: nextDetail.source,
          sourceName: nextDetail.source_name,
          id: String(nextDetail.id),
          episodeIndex: index,
          position: 0,
          url,
        },
        { ...session, source: nextDetail.source, sourceName: nextDetail.source_name, episodeIndex: index }
      );
    } catch {
      // error 已在 store
    }
  };

  const progressRatio = useMemo(() => {
    if (!status?.duration) return 0;
    return Math.max(0, Math.min(1, status.position / status.duration));
  }, [status]);

  const renderDeviceList = () => (
    <View style={styles.section}>
      <View style={styles.rowBetween}>
        <Text style={styles.sectionTitle}>选择投屏设备</Text>
        <Pressable onPress={() => scan()} hitSlop={8} style={styles.refreshButton}>
          {scanning ? <ActivityIndicator size="small" color="#8ab4ff" /> : <Wifi color="#8ab4ff" size={16} />}
          <Text style={styles.refreshText}>{scanning ? "正在扫描" : "重新扫描"}</Text>
        </Pressable>
      </View>

      <Text style={styles.hint}>手机和电视需要连同一个 Wi-Fi。列表里的「电视」优先，投它最稳。</Text>

      {devices.map((device) => (
        <Pressable
          key={device.id}
          style={styles.deviceItem}
          onPress={() => onPickDevice(device)}
          disabled={casting}
        >
          <View style={styles.deviceIcon}>
            {device.protocol === "orion" ? <Tv color="#8ab4ff" size={18} /> : <Cast color="#8ab4ff" size={18} />}
          </View>
          <View style={styles.deviceInfo}>
            <Text style={styles.deviceName} numberOfLines={1}>
              {device.name}
            </Text>
            <Text style={styles.deviceMeta} numberOfLines={1}>
              {device.protocol === "orion" ? "OrionTV 电视端 · 推荐" : `DLNA · ${device.host}`}
              {device.version ? ` · v${device.version}` : ""}
            </Text>
          </View>
          {casting ? <ActivityIndicator size="small" color="#8ab4ff" /> : null}
        </Pressable>
      ))}

      {!scanning && devices.length === 0 ? (
        <Text style={styles.empty}>没有发现设备。确认电视已开机、和手机在同一 Wi-Fi，然后点「重新扫描」。</Text>
      ) : null}
    </View>
  );

  const renderRemote = () => {
    const duration = status?.duration ?? 0;
    const position = status?.position ?? 0;

    return (
      <View style={styles.section}>
        <View style={styles.nowCasting}>
          <View style={styles.deviceIcon}>
            <Cast color="#8ab4ff" size={18} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.deviceName} numberOfLines={1}>
              正在投屏到 {activeDevice?.name}
            </Text>
            <Text style={styles.deviceMeta} numberOfLines={1}>
              {session?.title}
              {session ? ` · 第 ${session.episodeIndex + 1} 集` : ""}
              {session?.sourceName ? ` · ${session.sourceName}` : ""}
            </Text>
          </View>
          <Pressable onPress={() => disconnect()} hitSlop={8} style={styles.disconnect}>
            <Text style={styles.disconnectText}>断开</Text>
          </Pressable>
        </View>

        <View style={styles.progressRow}>
          <Text style={styles.time}>{formatTime(position)}</Text>
          <Pressable
            style={styles.progressTrack}
            onLayout={(event) => setBarWidth(event.nativeEvent.layout.width)}
            onPress={(event) => {
              if (!duration || !barWidth) return;
              const ratio = Math.max(0, Math.min(1, event.nativeEvent.locationX / barWidth));
              seekTo(ratio * duration);
            }}
            disabled={!seekSupported}
          >
            <View style={[styles.progressFill, { width: `${progressRatio * 100}%` }]} />
          </Pressable>
          <Text style={styles.time}>{formatTime(duration)}</Text>
        </View>

        {!seekSupported ? <Text style={styles.warn}>这台电视不支持拖动进度，可以用快进/快退按钮试试。</Text> : null}

        <View style={styles.controls}>
          <Pressable style={styles.controlButton} onPress={() => seekBy(-10)}>
            <RotateCcw color="#fff" size={24} />
            <Text style={styles.controlLabel}>10 秒</Text>
          </Pressable>
          <Pressable style={styles.playButton} onPress={() => toggle()}>
            {status?.playing ? <Pause color="#fff" size={26} /> : <Play color="#fff" size={26} />}
          </Pressable>
          <Pressable style={styles.controlButton} onPress={() => seekBy(10)}>
            <RotateCw color="#fff" size={24} />
            <Text style={styles.controlLabel}>10 秒</Text>
          </Pressable>
        </View>

        <View style={styles.actionRow}>
          <Pressable style={styles.actionButton} onPress={() => setShowEpisodes((v) => !v)}>
            <Text style={styles.actionText}>选集</Text>
            <ChevronDown color="#9aa4b2" size={14} />
          </Pressable>
          <Pressable style={styles.actionButton} onPress={() => setShowSources((v) => !v)}>
            <Text style={styles.actionText}>换线路</Text>
            <ChevronDown color="#9aa4b2" size={14} />
          </Pressable>
        </View>

        {showEpisodes ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipList}>
            {(detail?.episodes ?? []).map((_, index) => {
              const active = index === (session?.episodeIndex ?? currentEpisodeIndex);
              return (
                <Pressable
                  key={`ep-${index}`}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => onSelectEpisode(index)}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{index + 1}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        {showSources ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipList}>
            {sources.map((item) => {
              const active = item.source === session?.source;
              return (
                <Pressable
                  key={item.source}
                  style={[styles.chip, styles.chipWide, active && styles.chipActive]}
                  onPress={() => onSelectSource(item.source)}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{item.source_name}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}
      </View>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { maxHeight: height * 0.72 }]}>
        <View style={styles.header}>
          <Text style={styles.title}>{activeDevice ? "投屏遥控器" : "投屏"}</Text>
          <Pressable onPress={onClose} hitSlop={10} style={styles.closeButton}>
            <X color="#9aa4b2" size={20} />
          </Pressable>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <ScrollView showsVerticalScrollIndicator={false}>
          {activeDevice ? renderRemote() : renderDeviceList()}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: {
    backgroundColor: "#161a20",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 18,
    paddingBottom: 24,
    paddingTop: 14,
  },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  title: { color: "#fff", fontSize: 16, fontWeight: "600" },
  closeButton: { padding: 4 },
  section: { gap: 12 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { color: "#fff", fontSize: 14, fontWeight: "600" },
  refreshButton: { flexDirection: "row", alignItems: "center", gap: 6 },
  refreshText: { color: "#8ab4ff", fontSize: 13 },
  hint: { color: "#6f7885", fontSize: 12, lineHeight: 18 },
  deviceItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "#1e242c",
  },
  deviceIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(138,180,255,0.12)",
  },
  deviceInfo: { flex: 1 },
  deviceName: { color: "#fff", fontSize: 14, fontWeight: "600" },
  deviceMeta: { color: "#8b95a3", fontSize: 11, marginTop: 2 },
  empty: { color: "#8b95a3", fontSize: 12, lineHeight: 18, paddingVertical: 8 },
  nowCasting: { flexDirection: "row", alignItems: "center", gap: 10 },
  disconnect: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: "#2a313a" },
  disconnectText: { color: "#ff8a8a", fontSize: 12 },
  progressRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  progressTrack: { flex: 1, height: 20, justifyContent: "center" },
  progressFill: { height: 4, borderRadius: 2, backgroundColor: "#8ab4ff" },
  time: { color: "#c8d0da", fontSize: 11, minWidth: 44, textAlign: "center", fontVariant: ["tabular-nums"] },
  warn: { color: "#ffb86b", fontSize: 11 },
  controls: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 46, paddingVertical: 6 },
  controlButton: { alignItems: "center", gap: 4 },
  controlLabel: { color: "#8b95a3", fontSize: 10 },
  playButton: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(138,180,255,0.18)",
  },
  actionRow: { flexDirection: "row", gap: 10 },
  actionButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "#1e242c",
  },
  actionText: { color: "#c8d0da", fontSize: 13 },
  chipList: { gap: 8, paddingVertical: 4 },
  chip: {
    minWidth: 44,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#1e242c",
    alignItems: "center",
  },
  chipWide: { minWidth: 76 },
  chipActive: { backgroundColor: "rgba(138,180,255,0.2)", borderWidth: 1, borderColor: "#8ab4ff" },
  chipText: { color: "#c8d0da", fontSize: 12 },
  chipTextActive: { color: "#8ab4ff", fontWeight: "600" },
  error: { color: "#ff8a8a", fontSize: 12, marginBottom: 8, lineHeight: 18 },
});
