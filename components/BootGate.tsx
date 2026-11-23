import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TVFocusGuideView,
  useTVEventHandler,
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
  onFocused?: () => void;
  primary?: boolean;
  preferredFocus?: boolean;
  icon?: React.ReactNode;
}

/**
 * 电视端按钮：遥控器聚焦时放大并描边，触屏端点击即可。
 */
const FocusButton = ({
  label,
  onPress,
  onFocused,
  primary,
  preferredFocus,
  icon,
}: FocusButtonProps) => {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      focusable
      hasTVPreferredFocus={preferredFocus}
      onFocus={() => {
        setFocused(true);
        onFocused?.();
      }}
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

  // 电视遥控器兜底：焦点落在按钮上时按「确定」直接触发该按钮，
  // 与 Pressable 的 onPress 通过时间窗去重，避免同一次按键执行两次。
  const activeActionRef = useRef<() => void>(() => {});
  const lastFireRef = useRef(0);
  const fire = useCallback((action: () => void) => {
    const now = Date.now();
    if (now - lastFireRef.current < 350) return;
    lastFireRef.current = now;
    action();
  }, []);

  useTVEventHandler((event) => {
    if (!Platform.isTV || !isBlocking || !isFailed) return;
    if (event.eventType === "select") {
      fire(activeActionRef.current);
    }
  });

  const goSettings = useCallback(() => {
    dismiss();
    // 已经在设置页时不要再 push，避免路由栈里堆同一页
    if (pathname !== "/settings") {
      router.push("/settings");
    }
  }, [dismiss, pathname, router]);

  const primaryAction = useCallback(() => {
    if (phase === "unconfigured") {
      goSettings();
    } else {
      retry();
    }
  }, [phase, goSettings, retry]);
  const dismissAction = () => dismiss();

  // 错误页出现时把默认动作指向主按钮，遥控器未见焦点时也能响应
  useEffect(() => {
    if (isFailed) {
      activeActionRef.current = primaryAction;
    }
  }, [isFailed, primaryAction]);

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

  const ActionsWrap: any = Platform.isTV ? TVFocusGuideView : View;

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

          <ActionsWrap style={styles.actions} autoFocus>
            <FocusButton
              label={phase === "unconfigured" ? "去设置服务器" : "重新连接"}
              primary
              preferredFocus
              onFocused={() => {
                activeActionRef.current = primaryAction;
              }}
              onPress={() => fire(primaryAction)}
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
                onFocused={() => {
                  activeActionRef.current = goSettings;
                }}
                onPress={() => fire(goSettings)}
                icon={<Settings size={17} color="#cfd6e0" />}
              />
            )}
            <FocusButton
              label="稍后再说"
              onFocused={() => {
                activeActionRef.current = dismissAction;
              }}
              onPress={() => fire(dismissAction)}
              icon={<SkipForward size={17} color="#98a2b3" />}
            />
          </ActionsWrap>

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
