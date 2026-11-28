#!/usr/bin/env node
/**
 * 补齐 android/local.properties 里的 sdk.dir。
 *
 * 为什么需要这个脚本：
 * `expo prebuild --clean` 会把 `android/` 整个删掉重建，`local.properties` 是
 * 构建机本地文件（不进版本库），重建后就不存在了。缺少它 gradle 会报
 * `SDK location not found`，而这个错误在 expo 的 autolinking 阶段抛出，
 * 表现成「:expo 配置失败 / Could not get unknown property 'release'」，
 * 跟真实原因差得很远，很容易被误导去查 AGP 版本。
 *
 * 查找顺序：ANDROID_HOME → ANDROID_SDK_ROOT → /opt/android-sdk。
 * 全部不存在就跳过，交给 gradle 自己报错（有人在 IDE 里构建，不依赖这里）。
 *
 * 用法：
 *   node scripts/ensure-local-props.js
 */
const fs = require("fs");
const path = require("path");

const projectRoot = path.join(__dirname, "..");
const androidDir = path.join(projectRoot, "android");
const propsPath = path.join(androidDir, "local.properties");

const candidates = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, "/opt/android-sdk"];
const sdkDir = candidates.find((dir) => dir && fs.existsSync(path.join(dir, "platforms")));

if (!sdkDir) {
  console.log("[ensure-local-props] 未找到 Android SDK，跳过（gradle 若报 SDK location not found 请设 ANDROID_HOME）");
  process.exit(0);
}

if (!fs.existsSync(androidDir)) {
  console.log("[ensure-local-props] android/ 不存在，先跑 prebuild");
  process.exit(0);
}

let content = "";
if (fs.existsSync(propsPath)) {
  content = fs.readFileSync(propsPath, "utf8");
}

const line = `sdk.dir=${sdkDir}`;
if (/^\s*sdk\.dir\s*=/m.test(content)) {
  const updated = content.replace(/^\s*sdk\.dir\s*=.*$/m, line);
  if (updated !== content) {
    fs.writeFileSync(propsPath, updated);
    console.log(`[ensure-local-props] sdk.dir 已更新为 ${sdkDir}`);
  } else {
    console.log(`[ensure-local-props] sdk.dir 已正确（${sdkDir}）`);
  }
} else {
  const prefix = content && !content.endsWith("\n") ? content + "\n" : content;
  fs.writeFileSync(propsPath, prefix + line + "\n");
  console.log(`[ensure-local-props] 已写入 ${line}`);
}
