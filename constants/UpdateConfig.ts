import { Platform } from "react-native";

/**
 * 远程更新配置
 *
 * 更新清单不再依赖上游仓库，改为读取本项目仓库根目录的 version.json。
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
 * 渠道覆盖：不少国产电视盒子 `Platform.isTV` 为 false（系统没声明 leanback 特性），
 * 但界面确实是电视布局。这时若按 `Platform.isTV` 判成 phone，32 位盒子会下到 64 位包、
 * 装不上。所以允许布局层在识别出电视布局时把渠道钉成 tv。
 */
let channelOverride: UpdateChannel | null = null;

export const setUpdateChannelOverride = (channel: UpdateChannel | null) => {
  channelOverride = channel;
};

/** 电视端与手机端使用同一份代码，运行时按设备能力区分更新渠道。 */
export const getUpdateChannel = (): UpdateChannel =>
  channelOverride ?? (Platform.isTV ? "tv" : "phone");

/**
 * 两个客户端从 2026-11 起独立维护、独立发版，版本号也彻底分开：
 * **手机端主版本号取偶数（2.x、4.x…），电视端取奇数（3.x、5.x…）**，
 * 这样无论各自怎么迭代，两边的版本号都不会相同。
 *
 * 这里必须是「当前渠道」的版本，而不是 package.json 里那个统一值，
 * 否则电视端发版会连带把手机端判成有新版本（更新日志还会串）。
 * 发版时只改对应渠道这一行。
 */
export const CHANNEL_VERSIONS: Record<UpdateChannel, string> = {
  tv: "3.0.3",
  phone: "2.0.4",
};

/** 当前设备所属渠道的版本号（用于和远端清单比较） */
export const getCurrentVersion = (): string => CHANNEL_VERSIONS[getUpdateChannel()];

export const UPDATE_CONFIG = {
  // 自动检查更新
  AUTO_CHECK: true,

  // 检查更新间隔（毫秒）
  CHECK_INTERVAL: 12 * 60 * 60 * 1000, // 12 小时

  // 更新清单地址（按顺序回退，前面的不通就试后面的）
  MANIFEST_URLS: [
    `${RAW_BASE}/version.json`,
    `https://ghfast.top/${RAW_BASE}/version.json`,
    `https://cdn.jsdelivr.net/gh/${OWNER}/${REPO}@${BRANCH}/version.json`,
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
