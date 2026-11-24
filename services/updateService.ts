// UpdateService.ts
import * as FileSystem from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import Toast from 'react-native-toast-message';
import { version as currentVersion } from '../package.json';
import { UPDATE_CONFIG, getUpdateChannel, UpdateChannel } from '../constants/UpdateConfig';
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
}

/**
 * 只在 Android 平台使用的常量（iOS 不会走到下载/安装流程）
 */
const ANDROID_MIME_TYPE = 'application/vnd.android.package-archive';

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
  async downloadApk(
    url: string,
    onProgress?: (percent: number) => void,
    mirrors: string[] = [],
  ): Promise<string> {
    await this.cleanOldApkFiles();

    const candidates = [url, ...mirrors].filter(
      (item, index, arr) => !!item && arr.indexOf(item) === index,
    );

    let lastError: unknown = null;

    for (let i = 0; i < candidates.length; i += 1) {
      const candidate = candidates[i];
      try {
        logger.info(`[Update] downloading (${i + 1}/${candidates.length}): ${candidate}`);
        const timestamp = Date.now();
        const fileName = `OrionTV_v${timestamp}_${i}.apk`;
        const fileUri = `${FileSystem.documentDirectory}${fileName}`;

        const downloadResumable = FileSystem.createDownloadResumable(
          candidate,
          fileUri,
          {},
          progress => {
            if (onProgress && progress.totalBytesExpectedToWrite) {
              const percent = Math.floor(
                (progress.totalBytesWritten / progress.totalBytesExpectedToWrite) * 100,
              );
              onProgress(percent);
            }
          },
        );

        const result = await downloadResumable.downloadAsync();
        if (result && result.uri) {
          logger.debug(`APK downloaded to ${result.uri}`);
          return result.uri;
        }
        throw new Error('Download failed: No URI available');
      } catch (e) {
        lastError = e;
        logger.warn(`[Update] download failed: ${candidate}`, e);
        // 删除可能残留的半截文件
        try {
          await FileSystem.deleteAsync(
            `${FileSystem.documentDirectory}OrionTV_v${Date.now()}_${i}.apk`,
            { idempotent: true },
          );
        } catch {
          // ignore
        }
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
  compareVersions(v1: string, v2: string): number {
    // 先丢掉 -test.4 / +build 这类后缀，否则「1.3.0」和「1.3.0-test.6」会被拆出 NaN，
    // 比大小直接失效，测试版用户永远收不到正式版更新。
    const normalize = (version: string) =>
      version
        .split(/[-+]/)[0]
        .split('.')
        .map((part) => {
          const num = parseInt(part, 10);
          return Number.isFinite(num) ? num : 0;
        });
    const p1 = normalize(v1);
    const p2 = normalize(v2);
    for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
      const n1 = p1[i] ?? 0;
      const n2 = p2[i] ?? 0;
      if (n1 > n2) return 1;
      if (n1 < n2) return -1;
    }
    return 0;
  }

  getCurrentVersion(): string {
    return currentVersion;
  }

  getChannel(): UpdateChannel {
    return getUpdateChannel();
  }

  isUpdateAvailable(remoteVersion: string): boolean {
    return this.compareVersions(remoteVersion, currentVersion) > 0;
  }
}

/* 单例导出 */
export default UpdateService.getInstance();
