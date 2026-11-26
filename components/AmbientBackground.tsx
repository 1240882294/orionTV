import React from "react";
import { ImageBackground, StyleSheet, View, ViewStyle, StyleProp } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

/**
 * 首页环境背景。
 *
 * 之前全站是 #151718 纯色底，在电视大屏上会显成"一块黑板"——
 * 海报卡片贴在上面没有层次，四角也没有去处。
 *
 * 现在改成：一张 1920×1080 的深色氛围壁纸（顶部左右两抹冷光、中下部沉黑）
 * 打底，上面压两层遮罩控制对比度：
 *   1. 顶部轻压 —— 让「首页」标题和右上角图标有依托，又不至于把光压没
 *   2. 底部压深 —— 卡片网格落在接近纯黑上，海报本身的颜色才立得住
 *
 * 壁纸自己已经做了向下压暗（见 tools/genBackground.py），
 * 这里的两层遮罩是"第二道保险"：不同电视的对比度/背光差异很大，
 * 只靠图片容易在便宜屏上泛灰，多一层渐变就能兜住。
 */

// 相对路径引资源：Metro 对 require 的别名解析不如 import 稳，这里不冒险
const BG = require("../assets/images/bg-home.jpg");

interface Props {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export const AmbientBackground: React.FC<Props> = ({ children, style }) => (
  <ImageBackground source={BG} style={[styles.root, style]} resizeMode="cover" fadeDuration={220}>
    {/* 顶部：压一点亮度，保证标题与图标可读 */}
    <LinearGradient
      pointerEvents="none"
      colors={["rgba(4,6,12,0.42)", "rgba(4,6,12,0.12)", "transparent"]}
      locations={[0, 0.42, 1]}
      style={styles.topVeil}
    />
    {/* 底部：卡片区沉到接近黑，海报对比度靠这一层 */}
    <LinearGradient
      pointerEvents="none"
      colors={["transparent", "rgba(5,7,13,0.55)", "rgba(4,6,11,0.88)"]}
      locations={[0, 0.55, 1]}
      style={styles.bottomVeil}
    />
    <View style={styles.content}>{children}</View>
  </ImageBackground>
);

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#080b14",
  },
  topVeil: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: "46%",
  },
  bottomVeil: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "72%",
  },
  content: {
    flex: 1,
  },
});

export default AmbientBackground;
