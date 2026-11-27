/**
 * 构建信息（由 scripts/apply-build-info.js 在打包前生成，请勿手改）。
 *
 * 为什么需要这个文件：
 * 电视端和手机端是两份独立的 APK，但 JS 只有一份。渠道必须在打包时固化，
 * 否则运行期只能靠 `Platform.isTV` 去猜 —— 32 位电视包装在手机上会被猜成手机端，
 * 设置页显示成「手机版 v2.0.4」，检查更新还会去下 64 位手机包。
 *
 * 打包前执行：
 *   ORION_CHANNEL=tv ORION_VERSION=3.0.5-test.2 ORION_VERSION_CODE=3005 \
 *     node scripts/apply-build-info.js
 */
export type BuildChannel = "tv" | "phone";

export const BUILD_CHANNEL: BuildChannel = "tv";
export const BUILD_VERSION = "3.0.9";
export const BUILD_VERSION_CODE = 3015;
