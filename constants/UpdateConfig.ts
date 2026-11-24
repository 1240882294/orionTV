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

  // 兜底下载地址：清单里没给 url 时按版本号拼 GitHub Release 地址
  getDownloadUrl(version: string, channel: UpdateChannel = getUpdateChannel()): string {
    const file =
      channel === "tv"
        ? `OrionTV-TV-${version}-armeabi-v7a.apk`
        : `OrionTV-Phone-${version}-arm64-v8a.apk`;
    return `https://github.com/${OWNER}/${REPO}/releases/download/v${version}/${file}`;
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
