import React from "react";
import { View, StyleSheet, Text } from "react-native";
import usePlayerStore from "@/stores/playerStore";

type SeekSource = "gesture" | "slider" | "button";

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

interface Props {
  /** 哪些来源的 seek 需要显示这条预览：手机端只用手势，电视端用快进键 */
  sources?: SeekSource[];
  /** 电视端用更大的字号，隔远了也能看清 */
  variant?: "mobile" | "tv";
}

/**
 * 快进/快退时的进度预览。
 *
 * 同一时刻只允许一套进度反馈：手势滑动、进度条拖动、快进按钮各自有归属，
 * 混在一起就会两条进度条叠着重影，所以用 seekSource 做区分。
 */
export const SeekingBar = ({ sources = ["gesture"], variant = "mobile" }: Props) => {
  const { isSeeking, seekSource, seekPosition, seekDeltaMillis, status } = usePlayerStore();

  if (!isSeeking || !seekSource || !sources.includes(seekSource) || !status?.isLoaded) {
    return null;
  }

  const durationMillis = status.durationMillis || 0;
  const currentPositionMillis = seekPosition * durationMillis;
  const isTV = variant === "tv";
  const deltaSeconds = Math.round(((seekDeltaMillis || 0) as number) / 1000);
  const deltaLabel =
    deltaSeconds === 0 ? "" : deltaSeconds > 0 ? `快进 ${deltaSeconds} 秒` : `快退 ${Math.abs(deltaSeconds)} 秒`;

  return (
    <View style={styles.layer} pointerEvents="none">
      <View style={[styles.card, isTV && styles.cardTV]}>
        {deltaLabel ? (
          <Text style={[styles.deltaText, isTV && styles.deltaTextTV]}>{deltaLabel}</Text>
        ) : null}
        <Text style={[styles.timeText, isTV && styles.timeTextTV]}>
          {formatTime(currentPositionMillis)} / {formatTime(durationMillis)}
        </Text>
        <View style={[styles.track, isTV && styles.trackTV]}>
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
  cardTV: {
    minWidth: 340,
    paddingHorizontal: 34,
    paddingVertical: 22,
    borderRadius: 16,
  },
  deltaText: {
    color: "#4ade80",
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 6,
  },
  deltaTextTV: {
    fontSize: 18,
    marginBottom: 8,
  },
  timeText: {
    color: "white",
    fontSize: 17,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  timeTextTV: {
    fontSize: 30,
  },
  track: {
    width: 180,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.28)",
    marginTop: 10,
    overflow: "hidden",
  },
  trackTV: {
    width: 300,
    height: 6,
    borderRadius: 3,
    marginTop: 14,
  },
  filled: {
    height: "100%",
    backgroundColor: "#22c55e",
    borderRadius: 2,
  },
});
