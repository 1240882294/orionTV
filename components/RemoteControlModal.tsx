import React from "react";
import { Modal, Platform, StyleSheet, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { useRemoteControlStore } from "@/stores/remoteControlStore";
import { ThemedView } from "./ThemedView";
import { ThemedText } from "./ThemedText";
import { StyledButton } from "./StyledButton";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";

/**
 * 远程输入二维码（全屏）
 * 扫码后手机浏览器会直接打开远程输入页，电视端无需输入 IP。
 */
export const RemoteControlModal: React.FC = () => {
  const { isModalVisible, hideModal, serverUrl, error } = useRemoteControlStore();
  const { deviceType } = useResponsiveLayout();

  const qrSize = deviceType === "tv" ? 300 : deviceType === "tablet" ? 240 : 200;

  return (
    <Modal
      animationType="fade"
      transparent={true}
      visible={isModalVisible}
      onRequestClose={hideModal}
      statusBarTranslucent
    >
      <View style={styles.modalContainer}>
        <ThemedView style={styles.modalContent}>
          <ThemedText style={styles.title}>手机扫码输入</ThemedText>

          <View style={[styles.qrContainer, { width: qrSize + 24, height: qrSize + 24 }]}>
            {serverUrl ? (
              <QRCode value={serverUrl} size={qrSize} backgroundColor="white" color="black" />
            ) : (
              <ThemedText style={styles.statusText}>
                {error ? `错误: ${error}` : "正在生成二维码..."}
              </ThemedText>
            )}
          </View>

          {!!serverUrl && (
            <ThemedText style={styles.serverUrlText}>{serverUrl}</ThemedText>
          )}

          <ThemedText style={styles.instructions}>
            使用手机相机或微信扫一扫，即可在手机上直接输入文字，电视端会立即收到。{"\n"}
            手机与电视需要连接同一个 Wi-Fi。
          </ThemedText>

          <StyledButton
            text="关闭"
            onPress={hideModal}
            style={styles.button}
            variant="primary"
            hasTVPreferredFocus={Platform.isTV}
          />
        </ThemedView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.75)",
    padding: 24,
  },
  modalContent: {
    width: "100%",
    maxWidth: 520,
    padding: 24,
    borderRadius: 14,
    alignItems: "center",
  },
  title: {
    fontSize: Platform.isTV ? 26 : 20,
    fontWeight: "bold",
    marginBottom: 16,
    paddingTop: 6,
  },
  qrContainer: {
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderRadius: 12,
    marginBottom: 16,
  },
  statusText: {
    textAlign: "center",
    fontSize: 16,
    color: "#333",
    paddingHorizontal: 24,
  },
  serverUrlText: {
    marginBottom: 10,
    fontSize: Platform.isTV ? 18 : 14,
    color: "#9ad0ff",
    letterSpacing: 0.5,
  },
  instructions: {
    textAlign: "center",
    marginBottom: 24,
    fontSize: Platform.isTV ? 16 : 14,
    lineHeight: Platform.isTV ? 26 : 22,
    color: "#ccc",
  },
  button: {
    width: "100%",
  },
});
