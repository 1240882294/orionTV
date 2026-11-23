import React, { useCallback, useRef, useState } from "react";
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
import QRCode from "react-native-qrcode-svg";
import { Maximize2 } from "lucide-react-native";
import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import { useSettingsStore } from "@/stores/settingsStore";
import { useRemoteControlStore } from "@/stores/remoteControlStore";
import { useButtonAnimation } from "@/hooks/useAnimation";
import { Colors } from "@/constants/Colors";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";

interface RemoteInputSectionProps {
  onChanged: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onPress?: () => void;
}

/**
 * 远程管理
 *
 * - 保留「远程连接」开关（启用后电视端会启动局域网 HTTP 服务）
 * - 新增二维码：手机扫码后直接打开远程输入页，无需手动输入 IP
 * - 电视端可放大二维码，方便坐在沙发上扫描
 */
export const RemoteInputSection: React.FC<RemoteInputSectionProps> = ({
  onChanged,
  onFocus,
  onBlur,
}) => {
  const { remoteInputEnabled, setRemoteInputEnabled } = useSettingsStore();
  const { isServerRunning, serverUrl, error, showModal } = useRemoteControlStore();
  const [rowFocused, setRowFocused] = useState(false);
  const [qrFocused, setQrFocused] = useState(false);
  const animationStyle = useButtonAnimation(rowFocused, 1.02);
  const deviceType = useResponsiveLayout().deviceType;

  const qrSize = deviceType === "tv" ? 148 : 128;

  // 遥控器「确定」与 Pressable.onPress 会同时触发，用时间窗去重
  const lastFireRef = useRef(0);
  const fire = useCallback((action?: () => void) => {
    if (!action) return;
    const now = Date.now();
    if (now - lastFireRef.current < 350) return;
    lastFireRef.current = now;
    action();
  }, []);

  const toggle = useCallback(() => {
    setRemoteInputEnabled(!remoteInputEnabled);
    onChanged();
  }, [remoteInputEnabled, setRemoteInputEnabled, onChanged]);

  const openQr = useCallback(() => {
    showModal();
  }, [showModal]);

  useTVEventHandler((event) => {
    if (!Platform.isTV || event.eventType !== "select") return;
    if (rowFocused) {
      fire(toggle);
    } else if (qrFocused) {
      fire(openQr);
    }
  });

  const handleSectionFocus = () => {
    setRowFocused(true);
    onFocus?.();
  };

  const handleSectionBlur = () => {
    setRowFocused(false);
    onBlur?.();
  };

  return (
    <ThemedView
      style={[
        styles.card,
        (rowFocused || qrFocused) && styles.cardFocused,
      ]}
    >
      <Pressable
        focusable
        style={styles.settingItem}
        onFocus={handleSectionFocus}
        onBlur={handleSectionBlur}
        onPress={() => fire(toggle)}
      >
        <View style={styles.settingInfo}>
          <ThemedText style={styles.settingName}>远程管理</ThemedText>
          <ThemedText style={styles.settingDescription}>
            允许手机连接电视，扫码即可直接输入
          </ThemedText>
        </View>
        <Animated.View style={animationStyle}>
          {Platform.OS === "ios" && Platform.isTV ? (
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => fire(toggle)}
              style={styles.statusLabel}
            >
              <ThemedText style={styles.statusValue}>
                {remoteInputEnabled ? "已启用" : "已禁用"}
              </ThemedText>
            </TouchableOpacity>
          ) : (
            <Switch
              value={remoteInputEnabled}
              onValueChange={() => {}}
              trackColor={{ false: "#767577", true: Colors.dark.primary }}
              thumbColor={remoteInputEnabled ? "#ffffff" : "#f4f3f4"}
              pointerEvents="none"
            />
          )}
        </Animated.View>
      </Pressable>

      {remoteInputEnabled && (
        <View style={styles.statusContainer}>
          <View style={styles.statusItem}>
            <ThemedText style={styles.statusLabel}>服务状态：</ThemedText>
            <ThemedText
              style={[
                styles.statusValue,
                { color: isServerRunning ? Colors.dark.primary : "#FF6B6B" },
              ]}
            >
              {isServerRunning ? "运行中" : "已停止"}
            </ThemedText>
          </View>

          {serverUrl && (
            <View style={styles.statusItem}>
              <ThemedText style={styles.statusLabel}>访问地址：</ThemedText>
              <ThemedText style={styles.statusValue}>{serverUrl}</ThemedText>
            </View>
          )}

          {!!serverUrl && (
            <View style={styles.qrBlock}>
              <View style={styles.qrFrame}>
                <QRCode value={serverUrl} size={qrSize} backgroundColor="white" color="black" />
              </View>
              <ThemedText style={styles.qrHint}>
                用手机相机或微信扫一扫，直接打开输入页
              </ThemedText>

              <Pressable
                focusable
                onFocus={() => setQrFocused(true)}
                onBlur={() => setQrFocused(false)}
                onPress={() => fire(openQr)}
                style={[styles.qrButton, qrFocused && styles.qrButtonFocused]}
              >
                <Maximize2 size={deviceType === "tv" ? 18 : 16} color="#fff" />
                <ThemedText style={styles.qrButtonText}>放大二维码</ThemedText>
              </Pressable>
            </View>
          )}

          {error && (
            <View style={styles.statusItem}>
              <ThemedText style={styles.statusLabel}>错误：</ThemedText>
              <ThemedText style={[styles.statusValue, { color: "#FF6B6B" }]}>{error}</ThemedText>
            </View>
          )}
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
  settingName: {
    fontSize: Platform.isTV ? 20 : 16,
    fontWeight: "bold",
    marginBottom: 4,
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
  qrBlock: {
    marginTop: 8,
    alignItems: "center",
  },
  qrFrame: {
    padding: 12,
    backgroundColor: "#ffffff",
    borderRadius: 10,
  },
  qrHint: {
    marginTop: 12,
    fontSize: Platform.isTV ? 15 : 13,
    color: "#bbb",
    textAlign: "center",
  },
  qrButton: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: Platform.isTV ? 10 : 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#555",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  qrButtonFocused: {
    borderColor: Colors.dark.primary,
    backgroundColor: "rgba(0,122,255,0.18)",
  },
  qrButtonText: {
    fontSize: Platform.isTV ? 15 : 13,
    color: "#fff",
  },
});
