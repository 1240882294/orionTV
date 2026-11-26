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
import Toast from "react-native-toast-message";

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
  /** 登录失败的常驻提示（Toast 3 秒就没了，用户回头看不到失败原因） */
  const [formError, setFormError] = useState<string | null>(null);
  /** 首次打开面板时账号还没从本机存储读回来，先显示「读取中」而不是空态 */
  const [hydrating, setHydrating] = useState(false);

  const usernameRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  /**
   * 刚打开的时间戳。
   *
   * 电视端按「确认」打开面板时，那一下按键会在 Modal 挂载后继续派发，
   * 落到全屏的关闭遮罩上 —— 面板弹出又被自己关掉，用户看到的就是「点了没反应」。
   * 打开后 450ms 内忽略遮罩点击，把这个穿透挡掉。
   */
  const openedAtRef = useRef(0);

  // react-native-tvos 的原生 TextInput 支持 hasTVPreferredFocus，RN 的 TS 类型里没有
  const tvPreferredFocusProps: any = isTV ? { hasTVPreferredFocus: true } : {};

  /**
   * 电视端把焦点拉到「添加账号」。
   *
   * 之前试过 `TVFocusGuideView autoFocus`：那是 tvOS 的 prop，Android TV 上不生效，
   * 面板弹出来焦点其实还留在下层的设置页，用户按确认什么都没发生 ——
   * 这就是「点添加账号没反应」的真正原因。
   *
   * `hasTVPreferredFocus` 是原生 prop，setter 里会直接 requestFocus()。
   * Modal 的 Dialog 窗口刚创建时 requestFocus 会被丢掉，所以这里延时重试几次。
   */
  const addButtonRef = useRef<View>(null);
  const focusAddButton = useCallback(() => {
    const node = addButtonRef.current as any;
    if (!node?.setNativeProps) return;
    // 先置 false 再置 true：值真的变化，原生才会重新走一遍 requestFocus
    node.setNativeProps({ hasTVPreferredFocus: false });
    requestAnimationFrame(() => {
      (addButtonRef.current as any)?.setNativeProps?.({ hasTVPreferredFocus: true });
    });
  }, []);

  /**
   * 每次打开**一律**进「用户管理」列表页，绝不自动跳到添加表单。
   *
   * 这里踩过一个坑：`open()` 只是 `set({ visible: true })`，账号数据是随后
   * 异步 `refresh()` 才读出来的。如果在这一帧就按 `profiles.length === 0`
   * 判定「没有账号」并直接进添加表单，那么冷启动第一次点右上角必定蹦到
   * 「添加账号」，第二次打开（数据已在内存）又正常 —— 就是用户反馈的那个
   * 「只有第一次启动才会出现」的 bug。
   *
   * 正确做法：永远停在列表页，列表为空就显示空态文案，用户点下方
   * 「添加账号」再进表单。数据还没到时先等一次刷新，避免闪一下空态。
   */
  useEffect(() => {
    if (visible) {
      openedAtRef.current = Date.now();
      setView("list");
      setConfirmLogout(false);
      setUsername("");
      setPassword("");
      setFocusedField(null);
      setFormError(null);

      let cancelled = false;
      const state = useUserStore.getState();
      // 内存里还没有账号数据时才等一次刷新（open() 里那次可能还没回来）
      const needWait = state.profiles.length === 0 && !state.activeId;
      setHydrating(needWait);
      if (needWait) {
        state
          .refresh()
          .catch(() => undefined)
          .finally(() => {
            if (!cancelled) setHydrating(false);
          });
      }
      return () => {
        cancelled = true;
      };
    }
  }, [visible]);

  /** 遮罩 / 关闭按钮统一走这里：打开后的头 450ms 不响应，避免按键穿透把面板关掉 */
  const requestClose = useCallback(() => {
    if (Date.now() - openedAtRef.current < 450) return;
    close();
  }, [close]);

  // 电视端进入表单时把焦点直接放到用户名，遥控器不用先摸索
  useEffect(() => {
    if (!visible || !isTV || view !== "add") return;
    const timer = setTimeout(() => {
      usernameRef.current?.focus();
    }, 320);
    return () => clearTimeout(timer);
  }, [visible, isTV, view]);

  /**
   * 列表页的初始焦点固定在「添加账号」上。
   * 账号行不再抢初始焦点：它的 onPress 在「当前账号」上是空操作，
   * 焦点停在那一行时按确认看起来就是「点了没反应」。
   */
  useEffect(() => {
    if (!visible || !isTV || view !== "list" || localMode) return;
    const timers = [140, 480, 1000].map((delay) => setTimeout(focusAddButton, delay));
    return () => timers.forEach(clearTimeout);
  }, [visible, isTV, view, localMode, focusAddButton]);

  const activeProfile = profiles.find((item) => item.id === activeId);

  const handleSwitch = useCallback(
    async (id: string) => {
      const ok = await switchTo(id);
      if (ok) close();
    },
    [switchTo, close]
  );

  /**
   * 把焦点送回输入框。
   *
   * 电视端登录失败后，焦点停在「登录并保存」按钮上，遥控器按上却回不到输入框
   * （Modal 的 Dialog 窗口里，输入法还占着方向键），用户就没法改密码重试。
   * 这里直接对输入框 requestFocus，并多试几次 —— 第一次常常被窗口/输入法吞掉。
   */
  const focusField = useCallback((field: "username" | "password") => {
    const getTarget = () => (field === "username" ? usernameRef.current : passwordRef.current);
    getTarget()?.focus();
    [120, 420, 900].forEach((delay) => {
      setTimeout(() => getTarget()?.focus(), delay);
    });
  }, []);

  const handleAdd = useCallback(async () => {
    setFormError(null);
    // 空值先挡掉：直接聚焦到空的那个框，别让用户自己找
    if (!username.trim()) {
      setFormError("请输入用户名");
      focusField("username");
      return;
    }
    if (!password) {
      setFormError("请输入密码");
      focusField("password");
      return;
    }

    const ok = await loginAs(username, password);
    if (ok) {
      setView("list");
      setUsername("");
      setPassword("");
      close();
      return;
    }

    // 失败：保留用户名，把光标送回密码框，选中原文，直接重打就能覆盖
    setFormError("账号或密码不正确，请重新输入");
    focusField("password");
  }, [loginAs, username, password, close, focusField]);

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
        <Pressable style={StyleSheet.absoluteFill} onPress={requestClose} focusable={false} />

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
              onPress={requestClose}
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
                    {hydrating ? (
                      <View style={styles.emptyBox}>
                        <ActivityIndicator color={Colors.dark.primary} />
                        <ThemedText style={[styles.emptyText, { marginTop: 10 }]}>
                          正在读取本机账号…
                        </ThemedText>
                      </View>
                    ) : profiles.length === 0 ? (
                      <View style={styles.emptyBox}>
                        <ThemedText style={styles.emptyText}>
                          还没有保存过账号，点下方「添加账号」登录。
                        </ThemedText>
                      </View>
                    ) : (
                      profiles
                        .slice()
                        .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
                        .map((profile) => {
                          const isActive = profile.id === activeId;
                          return (
                            <Pressable
                              key={profile.id}
                              focusable
                              onPress={() => {
                                if (isActive) {
                                  // 焦点停在这一行时按确认，什么都不发生很像「按钮坏了」
                                  Toast.show({ type: "info", text1: "当前正在使用该账号" });
                                  return;
                                }
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
                        ref={addButtonRef}
                        focusable
                        hasTVPreferredFocus={isTV}
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

                      {/* 没登录时没有可退出的账号，按钮留着只会让人点了个寂寞 */}
                      {activeId && (
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
                      )}
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

              {formError ? (
                <View style={styles.formError}>
                  <ThemedText style={styles.formErrorText}>{formError}</ThemedText>
                </View>
              ) : null}

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
                onChangeText={(text) => {
                  setUsername(text);
                  if (formError) setFormError(null);
                }}
                focusable
                selectTextOnFocus
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
                onChangeText={(text) => {
                  setPassword(text);
                  if (formError) setFormError(null);
                }}
                focusable
                selectTextOnFocus
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
  formError: {
    marginBottom: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: "rgba(255,59,48,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,59,48,0.45)",
  },
  formErrorText: {
    color: "#ff6961",
    fontSize: 13,
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
