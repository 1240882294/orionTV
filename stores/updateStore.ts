import { create } from 'zustand';
import updateService from '../services/updateService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import Logger from '@/utils/Logger';
import type { UpdateChannel } from '@/constants/UpdateConfig';

const logger = Logger.withTag('UpdateStore');

interface UpdateState {
  // 状态
  updateAvailable: boolean;
  currentVersion: string;
  remoteVersion: string;
  downloadUrl: string;
  mirrors: string[];
  releaseNotes: string;
  channel: UpdateChannel;
  /** 清单里给的安装包大小与 MD5，用于下载后校验 */
  expectedSize: number | null;
  expectedMd5: string | null;
  downloading: boolean;
  downloadProgress: number;
  downloadedPath: string | null;
  /** 已拉起系统安装器，但可能被系统静默拦下，需要引导用户去授权 */
  installRequested: boolean;
  error: string | null;
  lastCheckTime: number;
  skipVersion: string | null;
  showUpdateModal: boolean;
  isLatestVersion: boolean;

  // 操作
  checkForUpdate: (silent?: boolean) => Promise<boolean>;
  startDownload: () => Promise<void>;
  installUpdate: () => Promise<void>;
  downloadAndInstall: () => Promise<void>;
  /** 打开系统的「安装未知应用」授权页 */
  openInstallSettings: () => Promise<void>;
  setShowUpdateModal: (show: boolean) => void;
  skipThisVersion: () => Promise<void>;
  reset: () => void;
  /** 渠道确定/变化后刷新「当前版本」，两端版本号已分开，不能再沿用启动时的快照 */
  refreshChannel: () => void;
}

const STORAGE_KEYS = {
  LAST_CHECK_TIME: 'update_last_check_time',
  SKIP_VERSION: 'update_skip_version',
};

export const useUpdateStore = create<UpdateState>((set, get) => ({
  // 初始状态
  updateAvailable: false,
  currentVersion: updateService.getCurrentVersion(),
  remoteVersion: '',
  downloadUrl: '',
  mirrors: [],
  releaseNotes: '',
  channel: updateService.getChannel(),
  expectedSize: null,
  expectedMd5: null,
  downloading: false,
  downloadProgress: 0,
  downloadedPath: null,
  installRequested: false,
  error: null,
  lastCheckTime: 0,
  skipVersion: null,
  showUpdateModal: false,
  isLatestVersion: false,

  // 检查更新，返回是否有新版本
  checkForUpdate: async (silent = false) => {
    try {
      // 渠道可能在启动后才被布局识别并覆盖（电视盒子 Platform.isTV 常为 false），
      // 所以每次检查都重新取一次「当前渠道版本」，不能用 store 初始化时那份快照。
      set({
        error: null,
        isLatestVersion: false,
        currentVersion: updateService.getCurrentVersion(),
        channel: updateService.getChannel(),
      });

      const skipVersion = await AsyncStorage.getItem(STORAGE_KEYS.SKIP_VERSION);

      const versionInfo = await updateService.checkVersion();
      const isUpdateAvailable = updateService.isUpdateAvailable(versionInfo.version);
      const shouldShowUpdate = isUpdateAvailable && versionInfo.version !== skipVersion;
      const isLatest = !isUpdateAvailable;

      // 同一个版本的包如果之前已经下好了，直接复用，不用再下一遍 20 多 MB
      const cachedApk = await updateService.recallDownload(versionInfo.version);

      set({
        remoteVersion: versionInfo.version,
        downloadUrl: versionInfo.downloadUrl,
        mirrors: versionInfo.mirrors,
        releaseNotes: versionInfo.notes,
        channel: versionInfo.channel,
        expectedSize: versionInfo.size ?? null,
        expectedMd5: versionInfo.md5 ?? null,
        downloadedPath: cachedApk,
        installRequested: false,
        updateAvailable: isUpdateAvailable,
        lastCheckTime: Date.now(),
        skipVersion,
        showUpdateModal: shouldShowUpdate && !silent,
        isLatestVersion: isLatest,
      });

      if (!silent && isLatest) {
        Toast.show({
          type: 'success',
          text1: '已是最新版本',
          text2: `当前版本 v${updateService.getCurrentVersion()} 已是最新版本`,
          visibilityTime: 3000,
        });
      }

      await AsyncStorage.setItem(
        STORAGE_KEYS.LAST_CHECK_TIME,
        Date.now().toString()
      );

      return isUpdateAvailable;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : '检查更新失败',
        updateAvailable: false,
        isLatestVersion: false,
      });
      return false;
    }
  },

  // 开始下载
  startDownload: async () => {
    const { downloadUrl, mirrors, expectedSize, expectedMd5 } = get();

    if (!downloadUrl) {
      set({ error: '下载地址无效' });
      return;
    }

    try {
      set({
        downloading: true,
        downloadProgress: 0,
        error: null,
      });

      const filePath = await updateService.downloadApk(
        downloadUrl,
        (progress) => {
          set({ downloadProgress: progress });
        },
        mirrors,
        {
          size: expectedSize ?? undefined,
          md5: expectedMd5 ?? undefined,
        },
      );

      // 记下来，弹窗关掉或进程被杀后还能找回这个包
      await updateService.rememberDownload(get().remoteVersion, filePath);

      set({
        downloadedPath: filePath,
        downloading: false,
        downloadProgress: 100,
        installRequested: false,
      });
    } catch (error) {
      set({
        downloading: false,
        downloadProgress: 0,
        error: error instanceof Error ? error.message : '下载失败',
      });
    }
  },

  // 安装更新
  installUpdate: async () => {
    const { downloadedPath } = get();

    if (!downloadedPath) {
      set({ error: '安装文件不存在' });
      return;
    }

    try {
      set({ error: null });
      await updateService.installApk(downloadedPath);
      // 不要立刻关弹窗：系统可能把安装器静默拦下（未授权「安装未知应用」），
      // 关掉弹窗用户就彻底没线索了。保留弹窗，并显示去授权的入口。
      set({ installRequested: true });
    } catch (error) {
      logger.error('安装失败:', error);
      set({
        installRequested: false,
        error: error instanceof Error ? error.message : '安装失败',
      });
    }
  },

  /** 打开系统的「安装未知应用」授权页 */
  openInstallSettings: async () => {
    await updateService.openInstallPermissionSettings();
  },

  // 一键更新：下载完成后立即拉起安装器
  downloadAndInstall: async () => {
    await get().startDownload();
    const { downloadedPath, downloading, error } = get();
    if (downloadedPath && !downloading && !error) {
      await get().installUpdate();
    }
  },

  setShowUpdateModal: (show: boolean) => {
    set({ showUpdateModal: show });
  },

  skipThisVersion: async () => {
    const { remoteVersion } = get();

    if (remoteVersion) {
      await AsyncStorage.setItem(STORAGE_KEYS.SKIP_VERSION, remoteVersion);
      set({
        skipVersion: remoteVersion,
        showUpdateModal: false,
      });
    }
  },

  refreshChannel: () => {
    set({
      currentVersion: updateService.getCurrentVersion(),
      channel: updateService.getChannel(),
    });
  },

  reset: () => {
    set({
      downloading: false,
      downloadProgress: 0,
      downloadedPath: null,
      installRequested: false,
      error: null,
      showUpdateModal: false,
      isLatestVersion: false,
    });
  },
}));

export const initUpdateStore = async () => {
  try {
    const lastCheckTime = await AsyncStorage.getItem(STORAGE_KEYS.LAST_CHECK_TIME);
    const skipVersion = await AsyncStorage.getItem(STORAGE_KEYS.SKIP_VERSION);

    useUpdateStore.setState({
      lastCheckTime: lastCheckTime ? parseInt(lastCheckTime, 10) : 0,
      skipVersion: skipVersion || null,
    });
  } catch (error) {
    logger.error('初始化更新存储失败:', error);
  }
};
