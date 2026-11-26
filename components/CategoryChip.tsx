import React, { useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View, Platform, StyleProp, ViewStyle, TextStyle } from "react-native";
import { useButtonAnimation } from "@/hooks/useAnimation";

/**
 * 首页分类胶囊。
 *
 * 原来的分类按钮是 StyledButton 的默认样式 —— 绿色实心块 + 绿色描边，
 * 在深色大屏上非常"安卓 4.0"。主流 TV 端（Netflix / Disney+ / 爱奇艺）
 * 现在都是胶囊 + 毛玻璃 + 选中态反白，这里对齐这个做法：
 *
 *   未选中：5% 白底，文字 68% 白
 *   选中  ：近白实底，文字压深，加一点外发光
 *   焦点  ：白色描边 + 提亮，和选中态用不同手段区分（描边 vs 实底），
 *           这样"我正在这个上面"和"当前选的是这个"不会混
 */

interface Props {
  label: string;
  selected?: boolean;
  onPress: () => void;
  hasTVPreferredFocus?: boolean;
  /** 二级标签用，字号和留白都小一档，免得一行挤成一片 */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

export const CategoryChip: React.FC<Props> = ({
  label,
  selected = false,
  onPress,
  hasTVPreferredFocus,
  compact = false,
  style,
  textStyle,
}) => {
  const [focused, setFocused] = useState(false);
  const animationStyle = useButtonAnimation(focused, 1.06);

  return (
    <Animated.View style={[animationStyle, { zIndex: focused ? 10 : 1 }, style]}>
      <Pressable
        focusable
        hasTVPreferredFocus={hasTVPreferredFocus}
        onPress={onPress}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        android_ripple={Platform.isTV ? { color: "transparent" } : { color: "rgba(255,255,255,0.16)" }}
        style={[
          styles.chip,
          compact && styles.chipCompact,
          selected ? styles.chipSelected : styles.chipIdle,
          focused && !selected && styles.chipFocused,
          focused && selected && styles.chipSelectedFocused,
        ]}
      >
        <Text
          numberOfLines={1}
          style={[
            styles.label,
            compact && styles.labelCompact,
            selected ? styles.labelSelected : styles.labelIdle,
            focused && !selected && styles.labelFocused,
            textStyle,
          ]}
        >
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: 22,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: "transparent",
  },
  chipCompact: {
    paddingHorizontal: 16,
    paddingVertical: 7,
  },
  chipIdle: {
    // 底图本身已经很暗，6% 白在 #0A0D14 上几乎等于没有，
    // 10% 才刚好让胶囊"浮"出来又不像按钮
    backgroundColor: "rgba(255,255,255,0.10)",
    borderColor: "rgba(255,255,255,0.07)",
  },
  chipFocused: {
    backgroundColor: "rgba(255,255,255,0.22)",
    borderColor: "rgba(255,255,255,0.92)",
  },
  chipSelected: {
    backgroundColor: "#F2F5F8",
    shadowColor: "#7FB6FF",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 12,
    elevation: 8,
  },
  chipSelectedFocused: {
    backgroundColor: "#FFFFFF",
    borderColor: "rgba(255,255,255,0.55)",
  },
  label: {
    fontSize: 16,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
  labelCompact: {
    fontSize: 14,
    fontWeight: "500",
  },
  labelIdle: {
    color: "rgba(255,255,255,0.66)",
  },
  labelFocused: {
    color: "#FFFFFF",
  },
  labelSelected: {
    color: "#0A0D14",
    fontWeight: "700",
  },
});

export default CategoryChip;
