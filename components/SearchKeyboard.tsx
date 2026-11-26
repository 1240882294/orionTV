import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { Colors } from "@/constants/Colors";

/**
 * 电视端搜索页的字母键盘。
 *
 * 为什么要自己画键盘，而不是用系统输入法：
 * Android TV 上 TextInput 一拿到焦点，方向键会先被输入法/光标消费掉，
 * 只有消费不掉才冒泡给焦点系统 —— 表现就是「候选行能按 ↓ 进去，按 ↑ 回不到输入框」。
 * 这个行为在 RN 层面改不了（nextFocusUp 指回去也会被输入法窗口挡住）。
 *
 * 所以干脆不给输入法机会：搜索框只做展示，输入全部由这个键盘产生，
 * 方向键永远归 App，焦点链完全可控。
 *
 * 布局沿用电视盒子上常见的 6×6（A–Z + 0–9），遥控器按方向键就是走格子。
 */

const ROWS = [
  ["A", "B", "C", "D", "E", "F"],
  ["G", "H", "I", "J", "K", "L"],
  ["M", "N", "O", "P", "Q", "R"],
  ["S", "T", "U", "V", "W", "X"],
  ["Y", "Z", "1", "2", "3", "4"],
  ["5", "6", "7", "8", "9", "0"],
];

const GAP = 10;

interface Props {
  onKey: (ch: string) => void;
  onBackspace: () => void;
  onClear: () => void;
  onSubmit: () => void;
  /** 进入页面时把焦点落到第一个键上（只做一次，之后不再抢焦点） */
  autoFocus?: boolean;
}

export const SearchKeyboard: React.FC<Props> = ({
  onKey,
  onBackspace,
  onClear,
  onSubmit,
  autoFocus = false,
}) => {
  const { width } = useWindowDimensions();
  const [boxWidth, setBoxWidth] = useState(0);
  const firstKeyRef = useRef<View>(null);

  /**
   * 初始焦点。
   *
   * 只依赖 autoFocus，不跟着每次按键重渲染跑 —— 否则用户把焦点移到右侧候选，
   * 一敲键盘又被拽回第一个键，永远选不中候选。
   * `hasTVPreferredFocus` 是原生 prop，值真的变化才会重新 requestFocus，
   * 所以先置 false 再置 true；Dialog/窗口刚创建时会吞掉第一次，多试两轮。
   */
  useEffect(() => {
    if (!autoFocus) return;
    const fire = () => {
      const node = firstKeyRef.current as any;
      if (!node?.setNativeProps) return;
      node.setNativeProps({ hasTVPreferredFocus: false });
      requestAnimationFrame(() => {
        (firstKeyRef.current as any)?.setNativeProps?.({ hasTVPreferredFocus: true });
      });
    };
    const timers = [160, 520, 1100].map((delay) => setTimeout(fire, delay));
    return () => timers.forEach(clearTimeout);
  }, [autoFocus]);

  // 键宽由容器实际宽度反推，720p 和 1080p 都能撑满不留大片空白
  const usable = boxWidth || Math.min(width * 0.46, 900);
  const keyWidth = (usable - GAP * 5) / 6;
  const keyHeight = Math.max(52, Math.min(keyWidth / 1.45, 116));
  const fontSize = Math.max(15, Math.min(keyHeight * 0.46, 40));

  const keyStyle = useCallback(
    ({ focused }: { focused?: boolean }) => [
      {
        width: keyWidth,
        height: keyHeight,
        borderRadius: 10,
        borderWidth: 2,
        borderColor: focused ? "#ffffff" : "rgba(255,255,255,0.08)",
        backgroundColor: focused ? "rgba(77,159,255,0.28)" : "rgba(255,255,255,0.06)",
        alignItems: "center" as const,
        justifyContent: "center" as const,
      },
    ],
    [keyWidth, keyHeight]
  );

  return (
    <View
      style={styles.wrap}
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width;
        if (w > 0 && Math.abs(w - boxWidth) > 1) setBoxWidth(w);
      }}
    >
      {ROWS.map((row, rowIndex) => (
        <View key={`row-${rowIndex}`} style={styles.row}>
          {row.map((ch, chIndex) => (
            <Pressable
              key={ch}
              ref={rowIndex === 0 && chIndex === 0 ? firstKeyRef : undefined}
              focusable
              onPress={() => onKey(ch)}
              style={keyStyle}
              // 遥控器按确认键时给个明确反馈，避免「点了没反应」的错觉
              android_ripple={{ color: "rgba(255,255,255,0.18)" }}
            >
              <ThemedText style={{ fontSize, fontWeight: "600", color: "#e9ecf1" }}>{ch}</ThemedText>
            </Pressable>
          ))}
        </View>
      ))}

      <View style={[styles.row, { marginTop: GAP }]}>
        <Pressable
          focusable
          onPress={onBackspace}
          style={({ focused }: { focused?: boolean }) => [
            {
              width: keyWidth * 2 + GAP,
              height: keyHeight,
              borderRadius: 10,
              borderWidth: 2,
              borderColor: focused ? "#ffffff" : "rgba(255,255,255,0.08)",
              backgroundColor: focused ? "rgba(77,159,255,0.28)" : "rgba(255,255,255,0.06)",
              alignItems: "center",
              justifyContent: "center",
            },
          ]}
        >
          <ThemedText style={{ fontSize: fontSize * 0.86, color: "#c3cad6" }}>删除</ThemedText>
        </Pressable>

        <Pressable
          focusable
          onPress={onClear}
          style={({ focused }: { focused?: boolean }) => [
            {
              width: keyWidth * 2 + GAP,
              height: keyHeight,
              borderRadius: 10,
              borderWidth: 2,
              borderColor: focused ? "#ffffff" : "rgba(255,255,255,0.08)",
              backgroundColor: focused ? "rgba(77,159,255,0.28)" : "rgba(255,255,255,0.06)",
              alignItems: "center",
              justifyContent: "center",
            },
          ]}
        >
          <ThemedText style={{ fontSize: fontSize * 0.86, color: "#c3cad6" }}>清空</ThemedText>
        </Pressable>

        <Pressable
          focusable
          onPress={onSubmit}
          style={({ focused }: { focused?: boolean }) => [
            {
              width: keyWidth * 2 + GAP,
              height: keyHeight,
              borderRadius: 10,
              borderWidth: 2,
              borderColor: focused ? "#ffffff" : "transparent",
              backgroundColor: focused ? "#3b82f6" : Colors.dark.primary,
              alignItems: "center",
              justifyContent: "center",
            },
          ]}
        >
          <ThemedText style={{ fontSize: fontSize * 0.86, color: "#ffffff", fontWeight: "600" }}>
            搜索
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    width: "100%",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: GAP,
  },
});

export default SearchKeyboard;
