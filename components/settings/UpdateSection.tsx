import React from "react";
import { View, StyleSheet, Platform, ActivityIndicator } from "react-native";
import { ThemedText } from "../ThemedText";
import { StyledButton } from "../StyledButton";
import { useUpdateStore } from "@/stores/updateStore";
import { getUpdateChannel } from "@/constants/UpdateConfig";

/**
 * 远程更新
 *
 * - 从项目仓库的 version.json 读取最新版本
 * - 电视端走 32 位渠道，手机端走 64 位渠道
 * - 检查到新版本后可直接下载并拉起系统安装器
 */
export function UpdateSection() {
  const {
    currentVersion,
    remoteVersion,
    updateAvailable,
    releaseNotes,
    channel,
    downloading,
    downloadProgress,
    checkForUpdate,
    downloadAndInstall,
    isLatestVersion,
    error,
  } = useUpdateStore();

  const [checking, setChecking] = React.useState(false);
  const [installing, setInstalling] = React.useState(false);

  const busy = checking || downloading || installing;

  const handleCheckUpdate = async () => {
    setChecking(true);
    try {
      await checkForUpdate(false);
    } finally {
      setChecking(false);
    }
  };

  const handleUpdateNow = async () => {
    setInstalling(true);
    try {
      if (!updateAvailable) {
        const hasUpdate = await checkForUpdate(false);
        if (!hasUpdate) return;
      }
      await downloadAndInstall();
    } finally {
      setInstalling(false);
    }
  };

  // 渠道以实时判定为准：布局层可能把电视盒子的渠道钉成 tv，store 里的快照会滞后
  const activeChannel = getUpdateChannel() || channel;
  const channelLabel = activeChannel === "tv" ? "电视版 · 32 位" : "手机版 · 64 位";

  return (
    <View style={styles.sectionContainer}>
      <View style={styles.titleRow}>
        <ThemedText style={styles.sectionTitle}>远程更新</ThemedText>
        <View style={styles.channelBadge}>
          <ThemedText style={styles.channelText}>{channelLabel}</ThemedText>
        </View>
      </View>

      <View style={styles.row}>
        <ThemedText style={styles.label}>当前版本</ThemedText>
        <ThemedText style={styles.value}>v{currentVersion}</ThemedText>
      </View>

      {updateAvailable && (
        <View style={styles.row}>
          <ThemedText style={styles.label}>最新版本</ThemedText>
          <ThemedText style={[styles.value, styles.newVersion]}>v{remoteVersion}</ThemedText>
        </View>
      )}

      {isLatestVersion && remoteVersion && (
        <View style={styles.row}>
          <ThemedText style={styles.label}>状态</ThemedText>
          <ThemedText style={[styles.value, styles.latestVersion]}>已是最新版本</ThemedText>
        </View>
      )}

      {updateAvailable && !!releaseNotes && (
        <View style={styles.notesBox}>
          <ThemedText style={styles.notesTitle}>更新内容</ThemedText>
          <ThemedText style={styles.notesText}>{releaseNotes}</ThemedText>
        </View>
      )}

      {error && (
        <View style={styles.row}>
          <ThemedText style={styles.label}>检查结果</ThemedText>
          <ThemedText style={[styles.value, styles.errorText]}>{error}</ThemedText>
        </View>
      )}

      {downloading && (
        <View style={styles.row}>
          <ThemedText style={styles.label}>下载进度</ThemedText>
          <ThemedText style={styles.value}>{downloadProgress}%</ThemedText>
        </View>
      )}

      <View style={styles.buttonContainer}>
        {updateAvailable ? (
          <StyledButton onPress={handleUpdateNow} disabled={busy} style={styles.button}>
            {busy ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <ThemedText style={styles.buttonText}>
                {downloading ? `下载中 ${downloadProgress}%` : `更新到 v${remoteVersion}`}
              </ThemedText>
            )}
          </StyledButton>
        ) : (
          <StyledButton onPress={handleCheckUpdate} disabled={busy} style={styles.button}>
            {checking ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <ThemedText style={styles.buttonText}>检查更新</ThemedText>
            )}
          </StyledButton>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionContainer: {
    marginBottom: 24,
    padding: 16,
    backgroundColor: Platform.select({
      ios: "rgba(255, 255, 255, 0.05)",
      android: "rgba(255, 255, 255, 0.05)",
      default: "transparent",
    }),
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#333",
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
    paddingTop: 8,
  },
  sectionTitle: {
    fontSize: Platform.isTV ? 24 : 20,
    fontWeight: "bold",
  },
  channelBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(0, 122, 255, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(0, 122, 255, 0.4)",
  },
  channelText: {
    fontSize: Platform.isTV ? 14 : 12,
    color: "#4da3ff",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  label: {
    fontSize: Platform.isTV ? 18 : 16,
    color: "#999",
  },
  value: {
    fontSize: Platform.isTV ? 18 : 16,
  },
  newVersion: {
    color: "#00bb5e",
    fontWeight: "bold",
  },
  latestVersion: {
    color: "#00bb5e",
    fontWeight: "500",
  },
  errorText: {
    color: "#ff6b6b",
    fontWeight: "500",
    flex: 1,
    textAlign: "right",
    marginLeft: 12,
  },
  notesBox: {
    marginTop: 4,
    marginBottom: 8,
    padding: 12,
    borderRadius: 8,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
  },
  notesTitle: {
    fontSize: Platform.isTV ? 16 : 14,
    color: "#bbb",
    marginBottom: 6,
  },
  notesText: {
    fontSize: Platform.isTV ? 15 : 13,
    color: "#ddd",
    lineHeight: Platform.isTV ? 24 : 20,
  },
  buttonContainer: {
    flexDirection: "row",
    gap: 12,
    marginTop: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  button: {
    width: "90%",
    ...(Platform.isTV && {
      borderWidth: 2,
      borderColor: "transparent",
    }),
  },
  buttonText: {
    color: "#ffffff",
    fontSize: Platform.isTV ? 16 : 14,
    fontWeight: "500",
  },
});
