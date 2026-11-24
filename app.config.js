/**
 * 动态 Expo 配置（优先级高于 app.json，app.json 作为基础配置被继承）。
 *
 * 这里只做两件事：
 * 1. Android 最低系统版本。默认 API 23（Android 6.0）：
 *    React Native 0.74 / Expo SDK 51 预编译的 Hermes 与 fabricjni 原生库
 *    本身按 API 23 构建，链接器不允许把 21 作为目标（CXX1214），
 *    所以 21 只能作为实验开关保留，无法产出可运行包。
 *    如需尝试：ORION_MIN_SDK=21 yarn prebuild
 * 2. 平台锁定为 Android（本项目只维护电视端安卓链路）。
 */
const DEFAULT_MIN_SDK = 23; // Android 6.0（RN 0.74 的实际下限）
const COMPILE_SDK = 34;
const TARGET_SDK = 34;
const APP_VERSION = "1.3.0-test.2";
const VERSION_CODE = 6;

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
    version: config.version ?? APP_VERSION,
    platforms: ["android"],
    android: {
      ...android,
      versionCode,
    },
    plugins,
  };
};
