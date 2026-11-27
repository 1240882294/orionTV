#!/usr/bin/env node
/**
 * 按渠道固化 Android 构建 ABI。
 *
 * 为什么需要这个脚本：
 * - `android/` 不进版本库，由 `expo prebuild --clean` 每次重新生成，
 *   手写在 app/build.gradle 里的 `abiFilters` 会被抹掉；
 * - gradle.properties 里 `reactNativeArchitectures` 是全局 NDK 目标，
 *   默认值按电视端写死成 armeabi-v7a；
 * - 只改 abiFilters 不管用：它只约束 app 自身，reanimated / screens /
 *   expo-av / expo-modules-core 四个模块仍只编 v7a，合包时找不到 arm64
 *   的 so 不会报错，装到 64 位手机上就是点开即闪退。
 *
 * 所以打手机包必须在 prebuild 之后、gradlew 之前跑一次本脚本，
 * 同时改 gradle.properties（决定各模块编哪个 ABI）和 build.gradle（决定合包保留哪个 ABI）。
 *
 * 用法：
 *   node scripts/set-abi.js phone   # arm64-v8a
 *   node scripts/set-abi.js tv      # armeabi-v7a
 */
const fs = require("fs");
const path = require("path");

const CHANNEL_ABI = {
  phone: "arm64-v8a",
  tv: "armeabi-v7a",
};

const channel = process.argv[2] === "tv" ? "tv" : "phone";
const abi = CHANNEL_ABI[channel];
const root = path.resolve(__dirname, "..");
const gradlePath = path.join(root, "android/app/build.gradle");
const propsPath = path.join(root, "android/gradle.properties");

if (!fs.existsSync(gradlePath)) {
  console.error(`[set-abi] 找不到 ${gradlePath}，请先执行 yarn prebuild`);
  process.exit(1);
}

// 1) gradle.properties —— 全局 NDK 目标，决定每个原生模块编哪个架构
let props = fs.readFileSync(propsPath, "utf8");
if (/^reactNativeArchitectures=.*$/m.test(props)) {
  props = props.replace(/^reactNativeArchitectures=.*$/m, `reactNativeArchitectures=${abi}`);
} else {
  props = `${props.trimEnd()}\nreactNativeArchitectures=${abi}\n`;
}
fs.writeFileSync(propsPath, props);

// 2) app/build.gradle —— 合包时只保留这个 ABI
let gradle = fs.readFileSync(gradlePath, "utf8");
if (/abiFilters\s*["'][^"']+["']/.test(gradle)) {
  gradle = gradle.replace(/abiFilters\s*["'][^"']+["']/g, `abiFilters "${abi}"`);
} else {
  const withNdk = gradle.replace(
    /(\n\s*applicationId\s*['"][^'"]+['"])/,
    `$1\n        ndk {\n            abiFilters "${abi}"\n        }`
  );
  if (withNdk === gradle) {
    console.error("[set-abi] app/build.gradle 里没找到 applicationId，无法插入 abiFilters");
    process.exit(1);
  }
  gradle = withNdk;
}
fs.writeFileSync(gradlePath, gradle);

console.log(`[set-abi] ${channel} -> ${abi}（gradle.properties + app/build.gradle 已更新）`);
console.log("[set-abi] 出包后请核对：unzip -l xxx.apk | grep -c '\\.so$'  （手机包应为 48）");
