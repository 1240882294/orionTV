import { BUILD_CHANNEL, BUILD_VERSION } from "./BuildInfo";

/**
 * 远程更新配置
 *
 * 更新清单不再依赖上游仓库，改为读取本项目仓库根目录的 version.json。
 * 测试包读同目录下的 version-test.json —— 两条通道各看各的，互不推送。
 * 清单结构（见仓库根目录 version.json）：
 * {
 *   "version": "1.1.0",
 *   "notes": "更新说明",
 *   "channels": {
 *     "tv":    { "version": "1.1.0", "url": "...", "mirrors": ["..."] },
 *     "phone": { "version": "1.1.0", "url": "...", "mirrors": ["..."] }
 *   }
 * }
 *
 * 电视端取 tv 渠道（32 位 armeabi-v7a），手机端取 phone 渠道（64 位 arm64-v8a）。
 */
const OWNER = "1240882294";
const REPO = "orionTV";
const BRANCH = "main";

const RAW_BASE = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}`;

export type UpdateChannel = "tv" | "phone";

/**
 * 这个安装包是不是测试版：版本号里带 `-test` 段（3.0.7-test.3）。
 *
 * 测试版和正式版读**两份不同的清单**：
 *   - 正式包 → version.json（只有正式版本号）
 *   - 测试包 → version-test.json（只有测试版本号）
 *
 * 两条通道互不可见，所以测试版发多少版都不会推给正式用户；
 * 反过来，正式版用户也永远不会被推去装测试包。
 */
export const IS_TEST_BUILD = /-test(\.|$)/i.test(BUILD_VERSION);

/** 当前包要拉的清单文件名 */
export const getManifestFile = (): string =>
  IS_TEST_BUILD ? "version-test.json" : "version.json";

/**
 * 渠道以**安装包**为准，不看当前设备。
 *
 * 电视端和手机端是两份独立的包，但 JS 只有一份，所以渠道必须在打包时固化，
 * 由 `scripts/apply-build-info.js` 写进 `BuildInfo.ts`。
 *
 * 不能用 `Platform.isTV` 判：
 * - 32 位电视包装到手机上能正常跑，此时 `Platform.isTV` 为 false，
 *   旧逻辑会把自己当成手机端 —— 设置页显示「手机版 v2.0.4」（其实是 3.0.4-test.1），
 *   检查更新还会去下 64 位手机包，等于把另一端的包装进来；
 * - 反过来不少电视盒子不声明 leanback 特性，`Platform.isTV` 也是 false，
 *   32 位盒子会拿到 64 位包，直接装不上。
 *
 * 设备形态仍然由 `useResponsiveLayout().deviceType` 决定，只影响界面布局。
 */

/** 安装包自带的版本号（构建时写入，与 APK 的 versionName 同源） */
export const getInstalledVersion = (): string => BUILD_VERSION;

/** 当前安装包属于哪一端 */
export const getInstalledChannel = (): UpdateChannel => BUILD_CHANNEL;

/** 当前渠道，等同于安装包渠道 */
export const getUpdateChannel = (): UpdateChannel => BUILD_CHANNEL;

/**
 * 当前版本号 = 安装包版本号。
 *
 * 不再从「渠道 → 版本表」里查：
 * 电视端主版本取奇数（3.x、5.x…）、手机端取偶数（2.x、4.x…），
 * 两端各自迭代互不影响，版本号也永远不会撞。
 */
export const getCurrentVersion = (): string => BUILD_VERSION;

export const UPDATE_CONFIG = {
  // 自动检查更新
  AUTO_CHECK: true,

  // 检查更新间隔（毫秒）
  CHECK_INTERVAL: 12 * 60 * 60 * 1000, // 12 小时

  // 更新清单地址（按顺序回退，前面的不通就试后面的）
  // 正式包只读 version.json，测试包只读 version-test.json
  MANIFEST_URLS: [
    `${RAW_BASE}/${getManifestFile()}`,
    `https://ghfast.top/${RAW_BASE}/${getManifestFile()}`,
    `https://cdn.jsdelivr.net/gh/${OWNER}/${REPO}@${BRANCH}/${getManifestFile()}`,
  ],

  // 兜底下载地址：清单里没给 url 时按「渠道 + 版本号」拼 GitHub Release 地址。
  // 两端独立发版，Release tag 也按渠道区分（tv-v3.0.0 / phone-v2.0.0），
  // 避免同一 tag 上混着两端的包，用户下错位数。
  getDownloadUrl(version: string, channel: UpdateChannel = getUpdateChannel()): string {
    const file =
      channel === "tv"
        ? `OrionTV-TV-${version}-armeabi-v7a.apk`
        : `OrionTV-Phone-${version}-arm64-v8a.apk`;
    return `https://github.com/${OWNER}/${REPO}/releases/download/${channel}-v${version}/${file}`;
  },

  // GitHub 直连不通时使用的下载镜像前缀
  DOWNLOAD_MIRRORS: ["https://ghfast.top/", "https://gh-proxy.com/"],

  // 是否显示更新日志
  SHOW_RELEASE_NOTES: true,

  // 是否允许跳过版本
  ALLOW_SKIP_VERSION: true,

  // 下载超时时间（毫秒）
  DOWNLOAD_TIMEOUT: 10 * 60 * 1000, // 10 分钟

  // 是否在 WIFI 下自动下载
  AUTO_DOWNLOAD_ON_WIFI: false,

  // 更新通知设置
  NOTIFICATION: {
    ENABLED: true,
    TITLE: "OrionTV 更新",
    DOWNLOADING_TEXT: "正在下载新版本...",
    DOWNLOAD_COMPLETE_TEXT: "下载完成，点击安装",
  },
};
