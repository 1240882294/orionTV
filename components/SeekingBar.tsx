import React from "react";
import { View, StyleSheet, Text } from "react-native";
import usePlayerStore from "@/stores/playerStore";

const formatTime = (milliseconds: number) => {
  if (isNaN(milliseconds) || milliseconds < 0) {
    return "00:00";
  }
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}`;
  }
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
};

/**
 * 手势滑动时的进度预览。
 *
 * 只在「左右滑动画面」这种手势时出现；控件里的进度条拖动、快进按钮都有自己的反馈，
 * 如果这里也显示，就会出现两条进度条叠在一起的重影。
 */
export const SeekingBar = () => {
  const { isSeeking, seekSource, seekPosition, status } = usePlayerStore();

  if (!isSeeking || seekSource !== "gesture" || !status?.isLoaded) {
    return null;
  }

  const durationMillis = status.durationMillis || 0;
  const currentPositionMillis = seekPosition * durationMillis;

  return (
    <View style={styles.layer} pointerEvents="none">
      <View style={styles.card}>
        <Text style={styles.timeText}>
          {formatTime(currentPositionMillis)} / {formatTime(durationMillis)}
        </Text>
        <View style={styles.track}>
          <View style={[styles.filled, { width: `${Math.max(0, Math.min(1, seekPosition)) * 100}%` }]} />
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  // 居中悬浮，不占底部空间，避免和控件层重叠
  layer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 40,
    elevation: 40,
  },
  card: {
    minWidth: 220,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: "rgba(0,0,0,0.72)",
    alignItems: "center",
  },
  timeText: {
    color: "white",
    fontSize: 17,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  track: {
    width: 180,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.28)",
    marginTop: 10,
    overflow: "hidden",
  },
  filled: {
    height: "100%",
    backgroundColor: "#22c55e",
    borderRadius: 2,
  },
});
