import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { usePathname, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowLeft, Check, LogOut, Plus, Users, X } from "lucide-react-native";
import { ThemedText } from "@/components/ThemedText";
import { useUserStore } from "@/stores/userStore";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";
import { Colors } from "@/constants/Colors";

/**
 * 用户管理面板（手机端设置页 / 电视端首页右上角共用）。
 *
 * 支持：切换已登录过的账号、添加新账号、退出当前账号。
 * 电视端整块面板可遥控器操作：账号行、按钮都是 focusable，
 * 焦点进入时高亮（电视上没有 hover，只能靠边框判断选中）。
 */
export const UserManagementModal: React.FC = () => {
  const {
    visible,
    busy,
    profiles,
    activeId,
    localMode,
    close,
    switchTo,
    loginAs,
    logoutCurrent,
  } = useUserStore();
  const { deviceType } = useResponsiveLayout();
  const isTV = deviceType === "tv";
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const router = useRouter();
  const pathname = usePathname();

  const [view, setView] = useState<"list" | "add">("list");
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [focusedField, setFocusedField] = useState<"username" | "password" | null>(null);

  const usernameRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  // react-native-tvos 的原生 TextInput 支持 hasTVPreferredFocus，RN 的 TS 类型里没有
  const tvPreferredFocusProps: any = isTV ? { hasTVPreferredFocus: true } : {};

  // 每次打开都回到列表首页，避免上次停在「添加账号」表单
  useEffect(() => {
    if (visible) {
      setView("list");
      setConfirmLogout(false);
      setUsername("");
      setPassword("");
      setFocusedField(null);
    }
  }, [visible]);

  // 电视端进入表单时把焦点直接放到用户名，遥控器不用先摸索
  useEffect(() => {
    if (!visible || !isTV || view !== "add") return;
    const timer = setTimeout(() => {
      usernameRef.current?.focus();
    }, 180);
    return () => clearTimeout(timer);
  }, [visible, isTV, view]);

  const activeProfile = profiles.find((item) => item.id === activeId);

  const handleSwitch = useCallback(
    async (id: string) => {
      const ok = await switchTo(id);
      if (ok) close();
    },
    [switchTo, close]
  );

  const handleAdd = useCallback(async () => {
    const ok = await loginAs(username, password);
    if (ok) {
      setView("list");
      setUsername("");
      setPassword("");
      close();
    }
  }, [loginAs, username, password, close]);

  const handleLogout = useCallback(async () => {
    await logoutCurrent();
    setConfirmLogout(false);
    close();
    // 设置页里 LoginModal 不显示，退出后回首页才看得到登录框
    if (pathname.includes("settings")) {
      router.replace("/");
    }
  }, [logoutCurrent, pathname, router, close]);

  const cardWidth = Math.min(isTV ? 720 : 560, width * (isTV ? 0.66 : 0.88));
  const maxCardHeight = height * 0.86;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.overlay}>
        {/* 点空白关闭：铺一层绝对定位的遮罩，卡片自身的点击不会传到这里。
            加 focusable={false}：否则电视端焦点会跑进这层看不见的遮罩里，输入框就选不中了。 */}
        <Pressable style={StyleSheet.absoluteFill} onPress={close} focusable={false} />

        <View
          style={[
            styles.card,
            {
              width: cardWidth,
              maxHeight: maxCardHeight,
              paddingTop: isTV ? 26 : 20,
              paddingBottom: isTV ? 22 : 18,
              marginTop: insets.top,
              marginBottom: insets.bottom,
            },
          ]}
        >
          {/* 标题栏 */}
          <View style={styles.header}>
            {view === "add" ? (
              <Pressable
                onPress={() => setView("list")}
                focusable
                style={({ focused }: { focused?: boolean }) => [
                  styles.iconButton,
                  focused && styles.iconButtonFocused,
                ]}
              >
                <ArrowLeft color="white" size={isTV ? 26 : 22} />
              </Pressable>
            ) : (
              <Users color={Colors.dark.primary} size={isTV ? 30 : 24} />
            )}

            <ThemedText style={[styles.title, isTV && styles.titleTV]}>
              {view === "add" ? "添加账号" : "用户管理"}
            </ThemedText>

            <View style={{ flex: 1 }} />

            <Pressable
              onPress={close}
              focusable
              style={({ focused }: { focused?: boolean }) => [
                styles.iconButton,
                focused && styles.iconButtonFocused,
              ]}
            >
              <X color="white" size={isTV ? 26 : 22} />
            </Pressable>
          </View>

          {view === "list" ? (
            <>
              <ThemedText style={styles.subtitle}>
                {localMode
                  ? "当前服务器为免登录模式，没有多账号可切换"
                  : activeProfile
                  ? `当前账号：${activeProfile.username}`
                  : "当前未登录账号"}
              </ThemedText>

              {!localMode && (
                <>
                  <ScrollView
                    style={styles.list}
                    contentContainerStyle={styles.listContent}
                    showsVerticalScrollIndicator={false}
                  >
                    {profiles.length === 0 ? (
                      <View style={styles.emptyBox}>
                        <ThemedText style={styles.emptyText}>
                          还没有保存过其他账号，点下方「添加账号」登录。
                        </ThemedText>
                      </View>
                    ) : (
                      profiles
                        .slice()
                        .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
                        .map((profile, index) => {
                          const isActive = profile.id === activeId;
                          return (
                            <Pressable
                              key={profile.id}
                              focusable
                              hasTVPreferredFocus={!confirmLogout && index === 0}
                              onPress={() => {
                                if (isActive) return;
                                void handleSwitch(profile.id);
                              }}
                              style={({ pressed, focused }: { pressed: boolean; focused?: boolean }) => [
                                styles.profileRow,
                                (focused || pressed) && styles.profileRowFocused,
                                isActive && styles.profileRowActive,
                              ]}
                            >
                              <View style={[styles.avatar, isActive && styles.avatarActive]}>
                                <ThemedText style={styles.avatarText}>
                                  {profile.username.slice(0, 1).toUpperCase()}
                                </ThemedText>
                              </View>

                              <View style={{ flex: 1 }}>
                                <View style={styles.nameRow}>
                                  <ThemedText style={[styles.name, isTV && styles.nameTV]} numberOfLines={1}>
                                    {profile.username}
                                  </ThemedText>
                                  {isActive && (
                                    <View style={styles.currentBadge}>
                                      <Check color="white" size={12} />
                                      <ThemedText style={styles.currentBadgeText}>当前</ThemedText>
                                    </View>
                                  )}
                                </View>
                                <ThemedText style={styles.meta}>
                                  {isActive
                                    ? "正在使用"
                                    : `上次使用 ${formatTime(profile.lastUsedAt)}`}
                                </ThemedText>
                              </View>

                              {!isActive && (
                                <ThemedText style={styles.switchLabel}>切换</ThemedText>
                              )}
                            </Pressable>
                          );
                        })
                    )}
                  </ScrollView>

                  {profiles.length === 1 && !confirmLogout && (
                    <ThemedText style={styles.hint}>
                      想换用其他账号？点「添加账号」登录一次，之后就能在这里直接切换。
                    </ThemedText>
                  )}

                  {confirmLogout ? (
                    <View style={styles.confirmBox}>
                      <View style={{ flex: 1 }}>
                        <ThemedText style={styles.confirmTitle}>确认退出当前账号？</ThemedText>
                        <ThemedText style={styles.confirmHint}>退出后需要重新输入账号密码</ThemedText>
                      </View>
                      <View style={styles.confirmActions}>
                        <Pressable
                          focusable
                          hasTVPreferredFocus
                          onPress={() => setConfirmLogout(false)}
                          style={({ focused }: { focused?: boolean }) => [
                            styles.smallButton,
                            focused && styles.smallButtonFocused,
                          ]}
                        >
                          <ThemedText style={styles.smallButtonText}>取消</ThemedText>
                        </Pressable>
                        <Pressable
                          focusable
                          onPress={() => void handleLogout()}
                          style={({ focused }: { focused?: boolean }) => [
                            styles.smallButton,
                            styles.dangerButton,
                            focused && styles.dangerButtonFocused,
                          ]}
                        >
                          <ThemedText style={styles.smallButtonText}>退出</ThemedText>
                        </Pressable>
                      </View>
                    </View>
                  ) : (
                    <View style={styles.footer}>
                      <Pressable
                        focusable
                        hasTVPreferredFocus={profiles.length === 0 && !confirmLogout}
                        onPress={() => setView("add")}
                        style={({ focused }: { focused?: boolean }) => [
                          styles.footerButton,
                          styles.primaryButton,
                          focused && styles.primaryButtonFocused,
                        ]}
                      >
                        <Plus color="white" size={18} />
                        <ThemedText style={styles.footerButtonText}>添加账号</ThemedText>
                      </Pressable>

                      <Pressable
                        focusable
                        onPress={() => setConfirmLogout(true)}
                        style={({ focused }: { focused?: boolean }) => [
                          styles.footerButton,
                          styles.outlineButton,
                          focused && styles.outlineButtonFocused,
                        ]}
                      >
                        <LogOut color="white" size={18} />
                        <ThemedText style={styles.footerButtonText}>退出当前账户</ThemedText>
                      </Pressable>
                    </View>
                  )}
                </>
              )}

              {localMode && (
                <Pressable
                  focusable
                  hasTVPreferredFocus
                  onPress={close}
                  style={({ focused }: { focused?: boolean }) => [
                    styles.footerButton,
                    styles.primaryButton,
                    { marginTop: 18 },
                    focused && styles.primaryButtonFocused,
                  ]}
                >
                  <ThemedText style={styles.footerButtonText}>知道了</ThemedText>
                </Pressable>
              )}
            </>
          ) : (
            <>
              <ThemedText style={styles.subtitle}>
                登录另一个账号，成功后会自动切换并把账号保存在本机
              </ThemedText>

              <TextInput
                ref={usernameRef}
                style={[
                  styles.input,
                  isTV && styles.inputTV,
                  focusedField === "username" && styles.inputFocused,
                ]}
                placeholder="用户名"
                placeholderTextColor="#77777f"
                autoCapitalize="none"
                autoCorrect={false}
                value={username}
                onChangeText={setUsername}
                returnKeyType="next"
                blurOnSubmit={false}
                onFocus={() => setFocusedField("username")}
                onBlur={() => setFocusedField((current) => (current === "username" ? null : current))}
                onSubmitEditing={() => passwordRef.current?.focus()}
                {...tvPreferredFocusProps}
              />
              <TextInput
                ref={passwordRef}
                style={[
                  styles.input,
                  isTV && styles.inputTV,
                  focusedField === "password" && styles.inputFocused,
                ]}
                placeholder="密码"
                placeholderTextColor="#77777f"
                secureTextEntry
                value={password}
                onChangeText={setPassword}
                returnKeyType="go"
                onFocus={() => setFocusedField("password")}
                onBlur={() => setFocusedField((current) => (current === "password" ? null : current))}
                onSubmitEditing={() => void handleAdd()}
              />

              <Pressable
                focusable
                disabled={busy}
                onPress={() => void handleAdd()}
                style={({ focused }: { focused?: boolean }) => [
                  // 注意：这里不能用 footerButton（它带 flex:1），
                  // 纵向布局里 flexBasis:0 会把按钮高度压成一条线，导致「看不到登录按钮」
                  styles.submitButton,
                  isTV && styles.submitButtonTV,
                  styles.primaryButton,
                  focused && styles.primaryButtonFocused,
                  busy && styles.disabled,
                ]}
              >
                {busy ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <ThemedText style={styles.footerButtonText}>登录并保存</ThemedText>
                )}
              </Pressable>

              <ThemedText style={styles.addHint}>
                账号密码只保存在本机，用于下次自动登录；不会上传到其他服务器。
              </ThemedText>
            </>
          )}

          {busy && view === "list" && (
            <View style={styles.busyMask} pointerEvents="none">
              <ActivityIndicator color={Colors.dark.primary} size="large" />
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
};

const formatTime = (timestamp: number): string => {
  if (!timestamp) return "—";
  const date = new Date(timestamp);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  if (sameDay) return `今天 ${hh}:${mm}`;
  return `${date.getMonth() + 1}-${date.getDate()} ${hh}:${mm}`;
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.72)",
    justifyContent: "center",
    alignItems: "center",
  },
  card: {
    backgroundColor: "#141416",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#2a2a2f",
    paddingHorizontal: 22,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  title: {
    color: "white",
    fontSize: 20,
    fontWeight: "700",
  },
  titleTV: {
    fontSize: 24,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "transparent",
  },
  iconButtonFocused: {
    borderColor: "white",
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  subtitle: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 13,
    marginTop: 10,
    marginBottom: 14,
  },
  list: {
    flexGrow: 0,
  },
  listContent: {
    gap: 10,
    paddingBottom: 4,
  },
  emptyBox: {
    paddingVertical: 26,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  emptyText: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 14,
    textAlign: "center",
  },
  profileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 2,
    borderColor: "transparent",
  },
  profileRowFocused: {
    borderColor: "white",
    backgroundColor: "rgba(255,255,255,0.13)",
  },
  profileRowActive: {
    backgroundColor: "rgba(0,122,255,0.12)",
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2f2f35",
  },
  avatarActive: {
    backgroundColor: Colors.dark.primary,
  },
  avatarText: {
    color: "white",
    fontSize: 17,
    fontWeight: "700",
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  name: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
    flexShrink: 1,
  },
  nameTV: {
    fontSize: 18,
  },
  currentBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: Colors.dark.primary,
  },
  currentBadgeText: {
    color: "white",
    fontSize: 11,
    fontWeight: "600",
  },
  meta: {
    color: "rgba(255,255,255,0.42)",
    fontSize: 12,
    marginTop: 3,
  },
  switchLabel: {
    color: Colors.dark.primary,
    fontSize: 14,
    fontWeight: "600",
  },
  hint: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 10,
  },
  footer: {
    flexDirection: "row",
    gap: 12,
    marginTop: 18,
  },
  footerButton: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 2,
    borderColor: "transparent",
  },
  // 纵向堆叠时可用的按钮：显式给高度，不参与 flex 分配
  submitButton: {
    height: 50,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 2,
    borderColor: "transparent",
    marginTop: 6,
  },
  submitButtonTV: {
    height: 58,
  },
  footerButtonText: {
    color: "white",
    fontSize: 15,
    fontWeight: "600",
  },
  primaryButton: {
    backgroundColor: Colors.dark.primary,
  },
  primaryButtonFocused: {
    borderColor: "white",
  },
  outlineButton: {
    backgroundColor: "transparent",
    borderColor: "#3a3a40",
  },
  outlineButtonFocused: {
    borderColor: "white",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  disabled: {
    opacity: 0.6,
  },
  confirmBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 16,
    padding: 14,
    borderRadius: 12,
    backgroundColor: "rgba(255,59,48,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,59,48,0.45)",
  },
  confirmTitle: {
    color: "white",
    fontSize: 14,
    fontWeight: "600",
  },
  confirmHint: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 12,
    marginTop: 3,
  },
  confirmActions: {
    flexDirection: "row",
    gap: 8,
  },
  smallButton: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: "#3a3a40",
  },
  smallButtonFocused: {
    borderColor: "white",
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  smallButtonText: {
    color: "white",
    fontSize: 14,
    fontWeight: "600",
  },
  dangerButton: {
    backgroundColor: "#c9302c",
    borderColor: "#c9302c",
  },
  dangerButtonFocused: {
    borderColor: "white",
  },
  input: {
    height: 50,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#33333a",
    paddingHorizontal: 16,
    color: "white",
    fontSize: 16,
    marginBottom: 12,
  },
  inputTV: {
    height: 58,
    fontSize: 18,
  },
  inputFocused: {
    borderColor: Colors.dark.primary,
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  addHint: {
    color: "rgba(255,255,255,0.35)",
    fontSize: 12,
    marginTop: 14,
    lineHeight: 18,
  },
  busyMask: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.35)",
    borderRadius: 18,
  },
});

export default UserManagementModal;
