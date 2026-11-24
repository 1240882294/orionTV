import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { ChevronRight, Users } from "lucide-react-native";
import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import { Colors } from "@/constants/Colors";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";
import { useUserStore } from "@/stores/userStore";
import { useSettingsStore } from "@/stores/settingsStore";

interface UserAccountSectionProps {
  onFocus?: () => void;
  onBlur?: () => void;
}

/**
 * 设置 → 用户管理入口。
 *
 * 只负责展示当前账号并打开面板，真正的切换/退出逻辑在 UserManagementModal 里，
 * 与电视端首页右上角共用同一套实现。
 */
export const UserAccountSection: React.FC<UserAccountSectionProps> = ({ onFocus, onBlur }) => {
  const deviceType = useResponsiveLayout().deviceType;
  const [focused, setFocused] = useState(false);
  const profiles = useUserStore((state) => state.profiles);
  const activeId = useUserStore((state) => state.activeId);
  const openUserModal = useUserStore((state) => state.open);
  const refreshUsers = useUserStore((state) => state.refresh);
  const storageType = useSettingsStore((state) => state.serverConfig?.StorageType);

  const localMode = storageType === "localstorage";
  const activeProfile = profiles.find((item) => item.id === activeId);
  const accountName = activeProfile?.username ?? "";
  const count = profiles.length;

  // 进设置页先读一次，否则面板没打开过时这里拿不到账号
  useEffect(() => {
    void refreshUsers();
  }, [refreshUsers, storageType]);

  return (
    <ThemedView style={[styles.card, focused && styles.cardFocused]}>
      <Pressable
        focusable
        style={styles.row}
        onFocus={() => {
          setFocused(true);
          onFocus?.();
        }}
        onBlur={() => {
          setFocused(false);
          onBlur?.();
        }}
        onPress={openUserModal}
      >
        <View style={styles.iconWrap}>
          <Users size={deviceType === "tv" ? 24 : 20} color={Colors.dark.primary} />
        </View>

        <View style={styles.info}>
          <ThemedText style={styles.title}>用户管理</ThemedText>
          <ThemedText style={styles.description} numberOfLines={1}>
            {localMode
              ? "当前服务器为免登录模式"
              : accountName
              ? `当前账号：${accountName}${count > 1 ? ` · 共 ${count} 个账号` : ""}`
              : "未登录账号，可添加账号或切换"}
          </ThemedText>
        </View>

        <ChevronRight size={deviceType === "tv" ? 26 : 20} color="rgba(255,255,255,0.45)" />
      </Pressable>
    </ThemedView>
  );
};

const styles = StyleSheet.create({
  card: {
    padding: 18,
    marginBottom: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#333",
  },
  cardFocused: {
    borderColor: Colors.dark.primary,
    backgroundColor: "#007AFF10",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,122,255,0.12)",
  },
  info: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: "600",
  },
  description: {
    fontSize: 12,
    color: "rgba(255,255,255,0.5)",
    marginTop: 4,
  },
});

export default UserAccountSection;
