/**
 * 动态 Expo 配置（优先级高于 app.json，app.json 作为基础配置被继承）。
 *
 * 这里做三件事：
 * 1. Android 最低系统版本。默认 API 23（Android 6.0）：
 *    React Native 0.74 / Expo SDK 51 预编译的 Hermes 与 fabricjni 原生库
 *    本身按 API 23 构建，链接器不允许把 21 作为目标（CXX1214），
 *    所以 21 只能作为实验开关保留，无法产出可运行包。
 *    如需尝试：ORION_MIN_SDK=21 yarn prebuild
 * 2. 平台锁定为 Android（本项目只维护电视端安卓链路）。
 * 3. 按 ORION_CHANNEL 选择电视端 / 手机端各自的版本号（两端独立发版）。
 */
const DEFAULT_MIN_SDK = 23; // Android 6.0（RN 0.74 的实际下限）
const COMPILE_SDK = 34;
const TARGET_SDK = 34;

/**
 * 电视端与手机端独立维护、独立发版，版本号彻底分开：
 * **手机端主版本号取偶数（2.x、4.x…），电视端取奇数（3.x、5.x…）**，永远不会撞号。
 *
 * 构建时用 ORION_CHANNEL=tv|phone 选对应版本（不传按 phone）。
 * 与 `constants/UpdateConfig.ts` 里的 CHANNEL_VERSIONS 必须保持一致，
 * 否则 APK 显示的版本和运行时比较用的版本会对不上。
 */
const CHANNEL_META = {
  phone: { version: "2.1.3", versionCode: 2114 },
  tv: { version: "3.0.10", versionCode: 3017 },
};
const BUILD_CHANNEL = process.env.ORION_CHANNEL === "tv" ? "tv" : "phone";
// 允许命令行直接指定版本号，发测试版时不用改这个文件再改回去
const APP_VERSION = process.env.ORION_VERSION || CHANNEL_META[BUILD_CHANNEL].version;
const VERSION_CODE = CHANNEL_META[BUILD_CHANNEL].versionCode;

module.exports = ({ config }) => {
  const rawMinSdk = Number(process.env.ORION_MIN_SDK ?? DEFAULT_MIN_SDK);
  const minSdkVersion = Number.isFinite(rawMinSdk) ? rawMinSdk : DEFAULT_MIN_SDK;
  const rawVersionCode = Number(process.env.ORION_VERSION_CODE ?? VERSION_CODE);
  const versionCode = Number.isFinite(rawVersionCode) ? rawVersionCode : VERSION_CODE;

  // 覆盖 expo-build-properties 里的 Android 构建参数
  const plugins = (config.plugins || []).map((plugin) => {
    if (Array.isArray(plugin) && plugin[0] === "expo-build-properties") {
      const original = plugin[1] || {};
      return [
        "expo-build-properties",
        {
          ...original,
          android: {
            ...(original.android || {}),
            minSdkVersion,
            compileSdkVersion: COMPILE_SDK,
            targetSdkVersion: TARGET_SDK,
            // 老系统上不启用新架构，减少运行时不兼容面
            newArchEnabled: false,
            enableProguardInReleaseBuilds: true,
            enableShrinkResourcesInReleaseBuilds: true,
          },
        },
      ];
    }
    return plugin;
  });

  const android = { ...(config.android || {}) };
  // networkSecurityConfig 不是 Expo 的合法字段，之前一直被静默忽略；
  // Android 5.0 本身不校验明文流量，这里用 usesCleartextTraffic 显式声明即可。
  delete android.networkSecurityConfig;
  android.usesCleartextTraffic = true;

  return {
    ...config,
    // 版本号一律按渠道取，不能沿用 app.json / 上次 prebuild 的旧值，
    // 否则 APK 的 versionName 是 3.0.5-test.2，JS 里读到的却是 1.3.0-test.1
    version: APP_VERSION,
    platforms: ["android"],
    android: {
      ...android,
      versionCode,
    },
    plugins,
  };
};
