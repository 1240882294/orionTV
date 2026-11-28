#!/usr/bin/env node
/**
 * 把「这一包属于哪一端、版本号多少」固化进 src/constants/BuildInfo.ts。
 *
 * 打包前必须执行，否则 APK 里的 JS 会沿用上一次的值（默认 phone 2.0.4），
 * 电视包装到手机上就会显示成手机版。
 *
 * 用法：
 *   ORION_CHANNEL=tv ORION_VERSION=3.0.5-test.2 ORION_VERSION_CODE=3005 \
 *     node scripts/apply-build-info.js
 *
 * 只传 ORION_CHANNEL 时会用下面的 DEFAULT_META 兜底。
 */
const fs = require("fs");
const path = require("path");

// 与 src/app.config.js 的 CHANNEL_META 保持一致
const DEFAULT_META = {
  phone: { version: "2.1.3", versionCode: 2114 },
  tv: { version: "3.0.10", versionCode: 3017 },
};

const channel = process.env.ORION_CHANNEL === "tv" ? "tv" : "phone";
const meta = DEFAULT_META[channel];
const version = process.env.ORION_VERSION || meta.version;
const versionCode = Number(process.env.ORION_VERSION_CODE || meta.versionCode);

if (!Number.isFinite(versionCode) || versionCode <= 0) {
  console.error(`[build-info] ORION_VERSION_CODE 无效: ${process.env.ORION_VERSION_CODE}`);
  process.exit(1);
}

const target = path.join(__dirname, "..", "constants", "BuildInfo.ts");
const content = `/**
 * 构建信息（由 scripts/apply-build-info.js 在打包前生成，请勿手改）。
 *
 * 为什么需要这个文件：
 * 电视端和手机端是两份独立的 APK，但 JS 只有一份。渠道必须在打包时固化，
 * 否则运行期只能靠 \`Platform.isTV\` 去猜 —— 32 位电视包装在手机上会被猜成手机端，
 * 设置页显示成「手机版 v2.0.4」，检查更新还会去下 64 位手机包。
 *
 * 打包前执行：
 *   ORION_CHANNEL=tv ORION_VERSION=3.0.5-test.2 ORION_VERSION_CODE=3005 \\
 *     node scripts/apply-build-info.js
 */
export type BuildChannel = "tv" | "phone";

export const BUILD_CHANNEL: BuildChannel = "${channel}";
export const BUILD_VERSION = "${version}";
export const BUILD_VERSION_CODE = ${versionCode};
`;

fs.writeFileSync(target, content, "utf8");
console.log(`[build-info] ${channel} ${version} (${versionCode}) -> ${path.relative(process.cwd(), target)}`);
