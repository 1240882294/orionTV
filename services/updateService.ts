// UpdateService.ts
import * as FileSystem from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import Toast from 'react-native-toast-message';
import {
  UPDATE_CONFIG,
  getUpdateChannel,
  getCurrentVersion as readChannelVersion,
  UpdateChannel,
} from '../constants/UpdateConfig';
import Logger from '@/utils/Logger';
import { Platform } from 'react-native';

const logger = Logger.withTag('UpdateService');

interface ChannelInfo {
  version?: string;
  url?: string;
  mirrors?: string[];
  notes?: string;
  abi?: string;
  size?: number;
  /** 安装包 MD5，清单提供时用于下载后完整性校验（防半截包 / 被代理替换） */
  md5?: string;
}

interface RemoteManifest {
  version?: string;
  notes?: string;
  channels?: Partial<Record<UpdateChannel, ChannelInfo>>;
}

export interface VersionInfo {
  version: string;
  downloadUrl: string;
  /** 备用下载地址（镜像），按顺序尝试 */
  mirrors: string[];
  /** 更新说明 */
  notes: string;
  /** 当前设备使用的渠道：tv（32 位）/ phone（64 位） */
  channel: UpdateChannel;
  /** 安装包字节数（清单提供时用于完整性校验） */
  size?: number;
  /** 安装包 MD5（清单提供时用于完整性校验） */
  md5?: string;
}

/**
 * 只在 Android 平台使用的常量（iOS 不会走到下载/安装流程）
 */
const ANDROID_MIME_TYPE = 'application/vnd.android.package-archive';

/** 下载开始后的观察窗口：这段时间的平均速度低于阈值就判定为「假快」线路 */
const SLOW_PROBE_MS = 6_000;
/** 低速阈值（KB/s）；bytes/ms 与 KB/s 数值等价 */
const SLOW_THRESHOLD_KB = 80;
/** 测速时只拉这么多字节，够区分 1.4MB/s 与 14KB/s */
const SPEED_PROBE_BYTES = 512 * 1024;
const SPEED_PROBE_TIMEOUT_MS = 2_500;

const fetchWithTimeout = async (url: string, timeoutMs: number): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
};

class UpdateService {
  private static instance: UpdateService;
  static getInstance(): UpdateService {
    if (!UpdateService.instance) {
      UpdateService.instance = new UpdateService();
    }
    return UpdateService.instance;
  }

  /** --------------------------------------------------------------
   *  1️⃣ 远程版本检查
   *     依次尝试清单地址（GitHub 直连 -> 镜像 -> jsDelivr），
   *     按当前设备渠道取对应安装包。
   * --------------------------------------------------------------- */
  async checkVersion(): Promise<VersionInfo> {
    const channel = getUpdateChannel();
    let lastError: unknown = null;

    for (const baseUrl of UPDATE_CONFIG.MANIFEST_URLS) {
      try {
        const separator = baseUrl.includes('?') ? '&' : '?';
        const url = `${baseUrl}${separator}t=${Date.now()}`;
        const response = await fetchWithTimeout(url, 10_000);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const manifest = (await response.json()) as RemoteManifest;
        const channelInfo: ChannelInfo = manifest?.channels?.[channel] ?? {};
        const remoteVersion = channelInfo.version || manifest?.version;

        if (!remoteVersion) {
          throw new Error('更新清单缺少版本号');
        }

        const fallbackUrl = UPDATE_CONFIG.getDownloadUrl(remoteVersion, channel);
        const downloadUrl = channelInfo.url || fallbackUrl;
        const mirrored = UPDATE_CONFIG.DOWNLOAD_MIRRORS.map(prefix => `${prefix}${downloadUrl}`);

        // 去重：清单自带镜像 + 通用镜像 + 直连兜底
        const mirrors = [
          ...(channelInfo.mirrors || []),
          ...mirrored,
          fallbackUrl,
        ].filter((item, index, arr) => !!item && item !== downloadUrl && arr.indexOf(item) === index);

        logger.info(`[Update] manifest=${baseUrl} channel=${channel} version=${remoteVersion}`);
        return {
          version: remoteVersion,
          downloadUrl,
          mirrors,
          notes: channelInfo.notes || manifest?.notes || '',
          channel,
          size: typeof channelInfo.size === 'number' ? channelInfo.size : undefined,
          md5: typeof channelInfo.md5 === 'string' ? channelInfo.md5 : undefined,
        };
      } catch (e) {
        lastError = e;
        logger.warn(`[Update] checkVersion failed on ${baseUrl}`, e);
      }
    }

    Toast.show({
      type: 'error',
      text1: '检查更新失败',
      text2: '无法获取版本信息，请检查网络',
    });
    throw lastError instanceof Error ? lastError : new Error('检查更新失败');
  }

  /** --------------------------------------------------------------
   *  2️⃣ 清理旧的 APK 文件（使用 expo-file-system 的 API）
   * --------------------------------------------------------------- */
  private async cleanOldApkFiles(): Promise<void> {
    try {
      const dirUri = FileSystem.documentDirectory; // e.g. file:///data/user/0/.../files/
      if (!dirUri) {
        throw new Error('Document directory is not available');
      }
      const listing = await FileSystem.readDirectoryAsync(dirUri);
      const apkFiles = listing.filter(name => name.startsWith('OrionTV_v') && name.endsWith('.apk'));

      if (apkFiles.length <= 2) return;

      const sorted = apkFiles.sort((a, b) => {
        const numA = parseInt(a.replace(/[^0-9]/g, ''), 10);
        const numB = parseInt(b.replace(/[^0-9]/g, ''), 10);
        return numB - numA; // 倒序（最新在前）
      });

      const stale = sorted.slice(2); // 保留最新的两个
      for (const file of stale) {
        const path = `${dirUri}${file}`;
        try {
          await FileSystem.deleteAsync(path, { idempotent: true });
          logger.debug(`Deleted old APK: ${file}`);
        } catch (e) {
          logger.warn(`Failed to delete ${file}`, e);
        }
      }
    } catch (e) {
      logger.warn('cleanOldApkFiles error', e);
    }
  }

  /** --------------------------------------------------------------
   *  3️⃣ 下载 APK：主地址失败时自动切换镜像
   * --------------------------------------------------------------- */
  /**
   * 探测单个地址的下载速度，返回 bytes/ms（数值上等于 KB/s）。
   *
   * 只取前 512KB（Range 请求），最多等 2.5 秒：
   * - 正常的源 0.3~0.6 秒就回来了；
   * - GitHub 直连被限速时 2.5 秒只下几十 KB，直接超时记 0 分排到最后。
   *
   * 返回 0 表示不可用（非 206 / 超时 / 报错）。
   */
  private async probeSpeed(
    url: string,
    probeBytes = SPEED_PROBE_BYTES,
    timeoutMs = SPEED_PROBE_TIMEOUT_MS,
  ): Promise<number> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { Range: `bytes=0-${probeBytes - 1}` },
      });
      // 只有 206 才是真的只返回了探测那一段；
      // 返回 200 说明服务端忽略了 Range，硬读会把整个 20+MB 拉进内存。
      if (res.status !== 206) {
        controller.abort();
        return 0;
      }
      const buf = await res.arrayBuffer();
      const elapsed = Math.max(1, Date.now() - startedAt);
      return buf.byteLength / elapsed;
    } catch {
      return 0;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 按实测速度给候选地址排序，快的在前、测不通的垫底。
   *
   * 这一步是关键：GitHub 直连在国内「连得上但只有十几 KB/s」，不会抛错，
   * 旧逻辑会一直卡在直连上慢慢下，永远轮不到 1.4MB/s 的镜像。
   */
  private async rankCandidates(candidates: string[]): Promise<string[]> {
    if (candidates.length <= 1) return candidates;
    const startedAt = Date.now();
    const probed = await Promise.all(
      candidates.map(async url => ({ url, speed: await this.probeSpeed(url) })),
    );
    const usable = probed.filter(item => item.speed > 0).sort((a, b) => b.speed - a.speed);
    const dead = probed.filter(item => item.speed === 0);
    logger.info(
      `[Update] probe ${Date.now() - startedAt}ms: ` +
        probed.map(item => `${Math.round(item.speed)}KB/s`).join(' / '),
    );
    return [...usable, ...dead].map(item => item.url);
  }

  /** 下载后校验大小与 MD5；清单没提供校验信息时直接放行（兼容旧清单） */
  private async verifyApk(
    uri: string,
    expected?: { size?: number; md5?: string },
  ): Promise<boolean> {
    if (!expected || (!expected.size && !expected.md5)) return true;
    try {
      const info = await FileSystem.getInfoAsync(uri, { md5: !!expected.md5 });
      if (!info.exists) return false;
      if (expected.size && typeof info.size === 'number' && info.size !== expected.size) {
        logger.warn(`[Update] size mismatch: got ${info.size}, want ${expected.size}`);
        return false;
      }
      if (expected.md5 && info.md5 && info.md5.toLowerCase() !== expected.md5.toLowerCase()) {
        logger.warn(`[Update] md5 mismatch: got ${info.md5}, want ${expected.md5}`);
        return false;
      }
      return true;
    } catch (e) {
      logger.warn('[Update] verify failed', e);
      return false;
    }
  }

  async downloadApk(
    url: string,
    onProgress?: (percent: number) => void,
    mirrors: string[] = [],
    expected?: { size?: number; md5?: string },
  ): Promise<string> {
    await this.cleanOldApkFiles();

    // 先测速再决定从哪条线开始下，而不是无脑先试 GitHub 直连
    const candidates = await this.rankCandidates(
      [url, ...mirrors].filter((item, index, arr) => !!item && arr.indexOf(item) === index),
    );

    let lastError: unknown = null;

    for (let i = 0; i < candidates.length; i += 1) {
      const candidate = candidates[i];
      const timestamp = Date.now();
      const fileName = `OrionTV_v${timestamp}_${i}.apk`;
      const fileUri = `${FileSystem.documentDirectory}${fileName}`;

      try {
        logger.info(`[Update] downloading (${i + 1}/${candidates.length}): ${candidate}`);

        let slowAborted = false;
        const startedAt = Date.now();
        let resumable: ReturnType<typeof FileSystem.createDownloadResumable> | null = null;

        resumable = FileSystem.createDownloadResumable(candidate, fileUri, {}, progress => {
          if (onProgress && progress.totalBytesExpectedToWrite) {
            const percent = Math.floor(
              (progress.totalBytesWritten / progress.totalBytesExpectedToWrite) * 100,
            );
            onProgress(percent);
          }

          // 前 6 秒平均速度低于 80KB/s：说明测速那个窗口是「假快」，中止换下一条
          const elapsed = Date.now() - startedAt;
          if (!slowAborted && elapsed >= SLOW_PROBE_MS) {
            const avgKbPerSec = progress.totalBytesWritten / elapsed;
            if (avgKbPerSec < SLOW_THRESHOLD_KB) {
              slowAborted = true;
              logger.warn(
                `[Update] too slow ${Math.round(avgKbPerSec)}KB/s, switching: ${candidate}`,
              );
              resumable?.pauseAsync().catch(() => {});
            }
          }
        });

        const result = await resumable.downloadAsync();
        if (!result || !result.uri) {
          throw new Error('Download failed: No URI available');
        }

        // 走公共代理时多一道校验：大小对不上或 MD5 不一致就当作坏包，换下一条
        if (!(await this.verifyApk(result.uri, expected))) {
          await FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(() => {});
          throw new Error('Downloaded file failed integrity check');
        }

        logger.debug(`APK downloaded to ${result.uri}`);
        return result.uri;
      } catch (e) {
        lastError = e;
        logger.warn(`[Update] download failed: ${candidate}`, e);
        // 删掉这一轮残留的半截文件（路径要和上面实际用的一致）
        await FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(() => {});
      }
    }

    Toast.show({
      type: 'error',
      text1: '下载失败',
      text2: '所有下载地址均不可用，请检查网络后重试',
    });
    throw lastError instanceof Error ? lastError : new Error('Download failed');
  }

  /** --------------------------------------------------------------
   *  4️⃣ 安装 APK（只在 Android 可用，使用 expo-intent-launcher）
   * --------------------------------------------------------------- */
  async installApk(fileUri: string): Promise<void> {
    // ① 先确认文件存在
    const exists = await FileSystem.getInfoAsync(fileUri);
    if (!exists.exists) {
      throw new Error(`APK not found at ${fileUri}`);
    }

    // ② Android 7.0（API 24）起才允许把 content:// 交给安装器；
    //    更老的系统（含 Android 5.0）必须用 file://，否则会抛
    //    "exposed beyond app through Intent.getData()"。
    const sdkInt = typeof Platform.Version === "number" ? Platform.Version : 0;
    const targetUri = sdkInt >= 24 ? await FileSystem.getContentUriAsync(fileUri) : fileUri;

    // ③ 只在 Android 里执行
    if (Platform.OS === 'android') {
      try {
        // FLAG_ACTIVITY_NEW_TASK = 0x10000000 (1)
        // FLAG_GRANT_READ_URI_PERMISSION = 0x00000010
        const flags = sdkInt >= 24 ? 1 | 0x00000010 : 1;

        await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
          data: targetUri,
          type: ANDROID_MIME_TYPE,
          flags,
        });
      } catch (e: any) {
        if (e.message?.includes('Activity not found')) {
          Toast.show({
            type: 'error',
            text1: '安装失败',
            text2: '系统没有找到可以打开 APK 的应用，请检查系统设置',
          });
        } else if (e.message?.includes('permission')) {
          Toast.show({
            type: 'error',
            text1: '安装失败',
            text2: '请在设置里允许“未知来源”安装',
          });
        } else {
          Toast.show({
            type: 'error',
            text1: '安装失败',
            text2: '未知错误，请稍后重试',
          });
        }
        throw e;
      }
    } else {
      Toast.show({
        type: 'error',
        text1: '安装失败',
        text2: 'iOS 设备无法直接安装 APK',
      });
      throw new Error('APK install not supported on iOS');
    }
  }

  /** --------------------------------------------------------------
   *  5️⃣ 版本比对工具
   * --------------------------------------------------------------- */
  /**
   * 解析成「主版本号 + 预发布段」。
   * `1.3.0-test.6` → { nums: [1,3,0], pre: ["test", 6] }
   */
  private parseVersion(version: string) {
    const clean = String(version || "").trim().replace(/^v/i, "").split("+")[0];
    const dash = clean.indexOf("-");
    const core = dash >= 0 ? clean.slice(0, dash) : clean;
    const preRaw = dash >= 0 ? clean.slice(dash + 1) : "";
    return {
      nums: core.split(".").map((part) => {
        const num = parseInt(part, 10);
        return Number.isFinite(num) ? num : 0;
      }),
      pre: preRaw
        ? preRaw.split(".").map((part) => (/^\d+$/.test(part) ? Number(part) : part))
        : ([] as Array<string | number>),
    };
  }

  /**
   * 比较版本号，按语义化版本的规则：
   * 主版本号逐段比；主版本相同时「正式版 > 预发布版」（1.3.0 > 1.3.0-test.6）。
   * 之前直接 split('.').map(Number) 会把 `0-test` 拆成 NaN，
   * 导致比较退化成「不算大也不算小」，测试版用户永远收不到正式版更新。
   */
  compareVersions(v1: string, v2: string): number {
    const a = this.parseVersion(v1);
    const b = this.parseVersion(v2);

    for (let i = 0; i < Math.max(a.nums.length, b.nums.length); i += 1) {
      const n1 = a.nums[i] ?? 0;
      const n2 = b.nums[i] ?? 0;
      if (n1 > n2) return 1;
      if (n1 < n2) return -1;
    }

    if (a.pre.length === 0 && b.pre.length > 0) return 1;
    if (a.pre.length > 0 && b.pre.length === 0) return -1;

    for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i += 1) {
      const p1 = a.pre[i];
      const p2 = b.pre[i];
      if (p1 === undefined) return -1;
      if (p2 === undefined) return 1;
      if (typeof p1 === "number" && typeof p2 === "number") {
        if (p1 !== p2) return p1 > p2 ? 1 : -1;
      } else {
        const s1 = String(p1);
        const s2 = String(p2);
        if (s1 !== s2) return s1 > s2 ? 1 : -1;
      }
    }

    return 0;
  }

  getCurrentVersion(): string {
    return readChannelVersion();
  }

  getChannel(): UpdateChannel {
    return getUpdateChannel();
  }

  isUpdateAvailable(remoteVersion: string): boolean {
    return this.compareVersions(remoteVersion, readChannelVersion()) > 0;
  }
}

/* 单例导出 */
export default UpdateService.getInstance();
