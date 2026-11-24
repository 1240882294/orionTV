import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  TouchableOpacity,
  useTVEventHandler,
  View,
} from "react-native";
import { ShieldCheck } from "lucide-react-native";
import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import { useSettingsStore } from "@/stores/settingsStore";
import { useButtonAnimation } from "@/hooks/useAnimation";
import { Colors } from "@/constants/Colors";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";
import { AdBlockStats, getAdBlockStats } from "@/services/adblock";

interface AdBlockSectionProps {
  onChanged?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
}

const formatDuration = (seconds: number): string => {
  if (!seconds) return "0 秒";
  if (seconds < 60) return `${Math.round(seconds)} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return rest > 0 ? `${minutes} 分 ${rest} 秒` : `${minutes} 分钟`;
};

/**
 * 广告过滤设置
 *
 * 只过滤播放列表里的广告分片（贴片/插播），不改动正片画面。
 * 开关即时生效，不需要点「保存设置」，避免触发重新连接账号。
 */
export const AdBlockSection: React.FC<AdBlockSectionProps> = ({ onChanged, onFocus, onBlur }) => {
  const { adBlockEnabled, setAdBlockEnabled } = useSettingsStore();
  const [focused, setFocused] = useState(false);
  const [stats, setStats] = useState<AdBlockStats>({ segments: 0, seconds: 0, updatedAt: 0 });
  const animationStyle = useButtonAnimation(focused, 1.02);
  const deviceType = useResponsiveLayout().deviceType;
  const lastFireRef = useRef(0);

  useEffect(() => {
    getAdBlockStats().then(setStats).catch(() => {});
  }, [adBlockEnabled]);

  // 遥控器「确定」与 Pressable.onPress 会同时触发，用时间窗去重
  const fire = useCallback(
    (action: () => void) => {
      const now = Date.now();
      if (now - lastFireRef.current < 350) return;
      lastFireRef.current = now;
      action();
    },
    []
  );

  const toggle = useCallback(() => {
    setAdBlockEnabled(!adBlockEnabled);
    onChanged?.();
  }, [adBlockEnabled, setAdBlockEnabled, onChanged]);

  useTVEventHandler((event) => {
    if (!Platform.isTV || event.eventType !== "select") return;
    if (focused) fire(toggle);
  });

  return (
    <ThemedView style={[styles.card, focused && styles.cardFocused]}>
      <Pressable
        focusable
        style={styles.settingItem}
        onFocus={() => {
          setFocused(true);
          onFocus?.();
        }}
        onBlur={() => {
          setFocused(false);
          onBlur?.();
        }}
        onPress={() => fire(toggle)}
      >
        <View style={styles.settingInfo}>
          <View style={styles.titleRow}>
            <ShieldCheck size={deviceType === "tv" ? 22 : 18} color={Colors.dark.primary} />
            <ThemedText style={styles.settingName}>广告过滤</ThemedText>
          </View>
          <ThemedText style={styles.settingDescription}>
            自动剔除播放列表里的片头广告和插播广告
          </ThemedText>
        </View>
        <Animated.View style={animationStyle}>
          {Platform.OS === "ios" && Platform.isTV ? (
            <TouchableOpacity activeOpacity={0.8} onPress={() => fire(toggle)} style={styles.statusLabel}>
              <ThemedText style={styles.statusValue}>{adBlockEnabled ? "已开启" : "已关闭"}</ThemedText>
            </TouchableOpacity>
          ) : (
            <Switch
              value={adBlockEnabled}
              onValueChange={() => {}}
              trackColor={{ false: "#767577", true: Colors.dark.primary }}
              thumbColor={adBlockEnabled ? "#ffffff" : "#f4f3f4"}
              pointerEvents="none"
            />
          )}
        </Animated.View>
      </Pressable>

      {adBlockEnabled && (
        <View style={styles.statusContainer}>
          <View style={styles.statusItem}>
            <ThemedText style={styles.statusLabel}>累计跳过：</ThemedText>
            <ThemedText style={[styles.statusValue, { color: Colors.dark.primary }]}>
              {stats.segments > 0
                ? `${stats.segments} 个广告片段 · 约 ${formatDuration(stats.seconds)}`
                : "暂无记录"}
            </ThemedText>
          </View>
          <View style={styles.statusItem}>
            <ThemedText style={styles.statusLabel}>识别方式：</ThemedText>
            <ThemedText style={styles.statusValue}>广告标记 / 广告域名 / 片头贴片</ThemedText>
          </View>
          <ThemedText style={styles.hint}>
            只在播放时过滤 m3u8 播放列表，不改动正片；个别线路为直播型列表，暂不支持过滤。
          </ThemedText>
        </View>
      )}
    </ThemedView>
  );
};

const styles = StyleSheet.create({
  card: {
    padding: 20,
    marginBottom: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#333",
  },
  cardFocused: {
    borderColor: Colors.dark.primary,
    backgroundColor: "#007AFF10",
  },
  settingItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
  },
  settingInfo: {
    flex: 1,
    paddingRight: 12,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  settingName: {
    fontSize: Platform.isTV ? 20 : 16,
    fontWeight: "bold",
  },
  settingDescription: {
    fontSize: Platform.isTV ? 15 : 13,
    color: "#888",
  },
  statusContainer: {
    marginTop: 8,
    padding: 16,
    backgroundColor: "#2a2a2c",
    borderRadius: 8,
  },
  statusItem: {
    flexDirection: "row",
    marginBottom: 8,
  },
  statusLabel: {
    fontSize: Platform.isTV ? 15 : 14,
    color: "#ccc",
    minWidth: 80,
  },
  statusValue: {
    fontSize: Platform.isTV ? 15 : 14,
    flex: 1,
  },
  hint: {
    marginTop: 4,
    fontSize: Platform.isTV ? 13 : 12,
    color: "#777",
    lineHeight: 18,
  },
});
