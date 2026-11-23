import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { usePathname, useRouter } from "expo-router";
import { AlertTriangle, RefreshCw, Settings, SkipForward } from "lucide-react-native";
import useBootStore, { BootPhase } from "@/stores/bootStore";

const PHASE_TEXT: Record<BootPhase, string> = {
  idle: "正在准备…",
  config: "正在读取配置…",
  scan: "正在扫描账号…",
  connect: "正在连接服务器…",
  sync: "正在刷新账号数据…",
  ready: "",
  offline: "",
  unconfigured: "",
};

interface FocusButtonProps {
  label: string;
  onPress: () => void;
  primary?: boolean;
  preferredFocus?: boolean;
  icon?: React.ReactNode;
}

/**
 * 电视端按钮：遥控器聚焦时放大并描边，触屏端点击即可。
 */
const FocusButton = ({ label, onPress, primary, preferredFocus, icon }: FocusButtonProps) => {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      focusable
      hasTVPreferredFocus={preferredFocus}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={[
        styles.button,
        primary ? styles.buttonPrimary : styles.buttonGhost,
        focused && (primary ? styles.buttonPrimaryFocused : styles.buttonGhostFocused),
      ]}
    >
      {icon}
      <Text style={[styles.buttonText, primary ? styles.buttonTextPrimary : styles.buttonTextGhost]}>
        {label}
      </Text>
    </Pressable>
  );
};

/**
 * 启动闸门：在账号扫描与服务器连接完成前覆盖在整个应用之上。
 * 连接失败时停留在这里，明确提示检查网络，并提供重试与去设置入口。
 */
export default function BootGate() {
  const { phase, running, attempt, errorTitle, errorMessage, dismissed, retry, dismiss } =
    useBootStore();
  const router = useRouter();
  const pathname = usePathname();

  const opacity = useRef(new Animated.Value(1)).current;
  const [hidden, setHidden] = useState(false);

  const isBlocking = !dismissed && phase !== "ready";
  const isFailed = phase === "offline" || phase === "unconfigured";

  useEffect(() => {
    if (isBlocking) {
      setHidden(false);
      opacity.setValue(1);
      return;
    }
    Animated.timing(opacity, {
      toValue: 0,
      duration: 220,
      useNativeDriver: Platform.OS !== "web",
    }).start(({ finished }) => {
      if (finished) setHidden(true);
    });
  }, [isBlocking, opacity]);

  if (hidden) return null;

  const goSettings = () => {
    dismiss();
    // 已经在设置页时不要再 push，避免路由栈里堆同一页
    if (pathname !== "/settings") {
      router.push("/settings");
    }
  };

  return (
    <Animated.View
      style={[styles.overlay, { opacity }]}
      pointerEvents={isBlocking ? "auto" : "none"}
    >
      <View style={styles.brand}>
        <Text style={styles.brandMark}>ORION TV</Text>
        <Text style={styles.brandSub}>电视端账号连接</Text>
      </View>

      {!isFailed ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#4cc9f0" />
          <Text style={styles.phaseText}>{PHASE_TEXT[phase]}</Text>
          {running && phase !== "scan" ? (
            <Text style={styles.hintText}>首次连接可能需要几秒钟</Text>
          ) : null}
        </View>
      ) : (
        <View style={styles.errorCard}>
          <View style={styles.errorIconWrap}>
            <AlertTriangle size={30} color="#f5a524" />
          </View>
          <Text style={styles.errorTitle}>{errorTitle || "网络连接失败"}</Text>
          <Text style={styles.errorMessage}>{errorMessage || "请检查网络连接后重试。"}</Text>

          {attempt > 1 ? (
            <Text style={styles.attemptText}>已尝试 {attempt} 次仍未连接成功</Text>
          ) : null}

          <View style={styles.actions}>
            <FocusButton
              label={phase === "unconfigured" ? "去设置服务器" : "重新连接"}
              primary
              preferredFocus
              onPress={phase === "unconfigured" ? goSettings : () => retry()}
              icon={
                phase === "unconfigured" ? (
                  <Settings size={17} color="#0b0d10" />
                ) : (
                  <RefreshCw size={17} color="#0b0d10" />
                )
              }
            />
            {phase === "unconfigured" ? null : (
              <FocusButton
                label="去检查服务器设置"
                onPress={goSettings}
                icon={<Settings size={17} color="#cfd6e0" />}
              />
            )}
            <FocusButton
              label="稍后再说"
              onPress={dismiss}
              icon={<SkipForward size={17} color="#98a2b3" />}
            />
          </View>

          <Text style={styles.footerHint}>
            连接不成功时应用不会加载内容，请确认电视已联网且服务器地址正确。
          </Text>
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#0b0d10",
    zIndex: 999,
    elevation: 999,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  brand: {
    position: "absolute",
    top: 56,
    alignItems: "center",
  },
  brandMark: {
    fontSize: 15,
    letterSpacing: 6,
    color: "#4cc9f0",
    fontWeight: "700",
  },
  brandSub: {
    marginTop: 6,
    fontSize: 12,
    letterSpacing: 2,
    color: "#5b6675",
  },
  center: {
    alignItems: "center",
  },
  phaseText: {
    marginTop: 22,
    fontSize: 16,
    color: "#e8eaed",
    letterSpacing: 1,
  },
  hintText: {
    marginTop: 10,
    fontSize: 12.5,
    color: "#6b7482",
  },
  errorCard: {
    width: "100%",
    maxWidth: 520,
    alignItems: "center",
    backgroundColor: "#12151a",
    borderWidth: 1,
    borderColor: "#242a33",
    borderRadius: 16,
    paddingVertical: 34,
    paddingHorizontal: 28,
  },
  errorIconWrap: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: "rgba(245,165,36,0.12)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#f2f4f7",
    letterSpacing: 0.5,
  },
  errorMessage: {
    marginTop: 10,
    fontSize: 14,
    lineHeight: 22,
    color: "#98a2b3",
    textAlign: "center",
  },
  attemptText: {
    marginTop: 8,
    fontSize: 12,
    color: "#f5a524",
  },
  actions: {
    marginTop: 24,
    width: "100%",
    alignItems: "center",
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 260,
    paddingVertical: 13,
    paddingHorizontal: 22,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: "transparent",
    marginBottom: 10,
  },
  buttonPrimary: {
    backgroundColor: "#4cc9f0",
  },
  buttonPrimaryFocused: {
    backgroundColor: "#6fd8f7",
    borderColor: "#ffffff",
    transform: [{ scale: 1.03 }],
  },
  buttonGhost: {
    backgroundColor: "transparent",
    borderColor: "#2c3440",
  },
  buttonGhostFocused: {
    borderColor: "#4cc9f0",
    backgroundColor: "rgba(76,201,240,0.08)",
    transform: [{ scale: 1.03 }],
  },
  buttonText: {
    fontSize: 14.5,
    fontWeight: "600",
    marginLeft: 9,
  },
  buttonTextPrimary: {
    color: "#0b0d10",
  },
  buttonTextGhost: {
    color: "#cfd6e0",
  },
  footerHint: {
    marginTop: 14,
    fontSize: 11.5,
    lineHeight: 18,
    color: "#5b6675",
    textAlign: "center",
  },
});
