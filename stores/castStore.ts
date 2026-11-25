/**
 * 投屏会话状态机。
 *
 * 负责：扫描设备、建立会话、轮询遥控、以及最关键的「电视被关掉时把进度结算掉」。
 *
 * 进度为什么要在这里兜：投屏时播放发生在电视上，手机端的播放器是暂停的，
 * 原来那套 _savePlayRecord 完全不会触发。DLNA 电视又不会自己连服务器，
 * 所以只能由手机端每 5 秒问一次位置，发现设备失联就把最后一次位置写回去。
 * 走 OrionTV 互投时不用管——那份进度由电视端自己上报。
 */
import { create } from "zustand";
import { CastDevice, CastPlayRequest, CastStatus } from "@/services/cast/types";
import { discoverDlnaDevices } from "@/services/cast/dlna";
import { createDlnaController } from "@/services/cast/dlna";
import { createOrionController, discoverOrionDevices } from "@/services/cast/orion";
import { PlayRecordManager } from "@/services/storage";
import Logger from "@/utils/Logger";

const logger = Logger.withTag("CastStore");

/** 遥控器界面要展示的片子信息，与投屏地址分开存 */
export interface CastSession {
  title: string;
  source: string;
  sourceName: string;
  id: string;
  /** 从 0 开始 */
  episodeIndex: number;
  totalEpisodes: number;
  cover: string;
  year: string;
}

type Controller = ReturnType<typeof createOrionController> | ReturnType<typeof createDlnaController>;

interface CastState {
  devices: CastDevice[];
  scanning: boolean;
  activeDevice: CastDevice | null;
  session: CastSession | null;
  status: CastStatus | null;
  /** 电视不支持 Seek 时置 false，UI 就别再显示可拖动的进度条 */
  seekSupported: boolean;
  busy: boolean;
  error: string | null;

  scan: () => Promise<void>;
  startCast: (device: CastDevice, request: CastPlayRequest, session: CastSession) => Promise<void>;
  castAgain: (request: CastPlayRequest, session: CastSession) => Promise<void>;
  toggle: () => Promise<void>;
  seekTo: (position: number) => Promise<void>;
  seekBy: (delta: number) => Promise<void>;
  disconnect: () => Promise<void>;
  refreshStatus: () => Promise<void>;
}

const POLL_INTERVAL = 5000;
/** 连续失败几次认定电视已关闭 */
const OFFLINE_TOLERANCE = 2;
/** 播放中每隔这么久把进度写一次，防止手机被系统杀掉导致进度全丢 */
const PROGRESS_SAVE_INTERVAL = 60000;

let controller: Controller | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let pollFailures = 0;
let lastSavedAt = 0;
let lastGoodStatus: CastStatus | null = null;
let disconnectGuard = false;

function clearPoll() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  pollFailures = 0;
}

export const useCastStore = create<CastState>((set, get) => {
  /** 把最后一次已知位置写回服务器（只对 DLNA 通道，orion 由电视自己报） */
  const reportProgress = async (reason: string) => {
    const { activeDevice, session } = get();
    if (!activeDevice || !session) return;
    if (activeDevice.protocol !== "dlna") return;

    const status = lastGoodStatus;
    if (!status || status.position <= 0) return;

    try {
      await PlayRecordManager.save(session.source, session.id, {
        title: session.title,
        cover: session.cover,
        index: session.episodeIndex + 1,
        total_episodes: session.totalEpisodes,
        play_time: Math.floor(status.position),
        total_time: Math.floor(status.duration),
        source_name: session.sourceName,
        year: session.year,
      });
      lastSavedAt = Date.now();
      logger.info(
        `[Cast] progress saved (${reason}) ${session.title} ep${session.episodeIndex + 1} @ ${Math.floor(status.position)}s`
      );
    } catch (error) {
      logger.info("[Cast] save progress failed", error);
    }
  };

  const poll = async () => {
    if (!controller) return;
    try {
      const status = await controller.getStatus();
      pollFailures = 0;
      lastGoodStatus = status;
      set({ status, error: null });

      if (Date.now() - lastSavedAt > PROGRESS_SAVE_INTERVAL && status.playing) {
        await reportProgress("interval");
      }
    } catch (error) {
      pollFailures += 1;
      logger.debug(`[Cast] poll failed ${pollFailures}/${OFFLINE_TOLERANCE}`);

      if (pollFailures >= OFFLINE_TOLERANCE && !disconnectGuard) {
        // 电视被关掉/断网：先把最后位置结算掉，再断开
        disconnectGuard = true;
        await reportProgress("tv-offline");
        clearPoll();
        controller = null;
        set({
          activeDevice: null,
          session: null,
          status: null,
          error: "电视已断开，已按最后进度保存播放记录。",
        });
        disconnectGuard = false;
      }
    }
  };

  const beginPolling = () => {
    clearPoll();
    pollTimer = setInterval(poll, POLL_INTERVAL);
    poll().catch(() => {});
  };

  return {
    devices: [],
    scanning: false,
    activeDevice: null,
    session: null,
    status: null,
    seekSupported: true,
    busy: false,
    error: null,

    scan: async () => {
      if (get().scanning) return;
      set({ scanning: true, error: null });
      try {
        // 两条通道并行扫；任一失败不影响另一条
        const [dlna, orion] = await Promise.all([
          discoverDlnaDevices().catch(() => [] as CastDevice[]),
          discoverOrionDevices().catch(() => [] as CastDevice[]),
        ]);
        // 电视端投屏优先排前面：它更可靠，用户大概率要选它
        const devices = [...orion, ...dlna];
        set({ devices, scanning: false });
        if (devices.length === 0) {
          set({ error: "没有找到可投屏的设备，确认手机和电视连的是同一个 Wi-Fi。" });
        }
      } catch (error) {
        logger.info("[Cast] scan failed", error);
        set({ scanning: false, error: "扫描失败，请重试。" });
      }
    },

    startCast: async (device, request, session) => {
      set({ busy: true, error: null });
      try {
        controller =
          device.protocol === "orion" ? createOrionController(device) : createDlnaController(device);
        await controller.play(request);

        // 立刻拉一次状态，拿电视给的时长（进度条要用）
        lastSavedAt = Date.now();
        lastGoodStatus = null;
        set({
          activeDevice: device,
          session,
          busy: false,
          seekSupported: true,
          status: { playing: true, position: request.position, duration: 0 },
        });
        beginPolling();
      } catch (error) {
        controller = null;
        logger.info("[Cast] start failed", error);
        const message = error instanceof Error ? error.message : String(error);
        set({
          busy: false,
          activeDevice: null,
          session: null,
          error: /unsupported|不支持/i.test(message)
            ? "这台电视不支持该片源的格式，可以试试投到装了 OrionTV 的盒子。"
            : `投屏失败：${message}`,
        });
        throw error;
      }
    },

    /** 已连接状态下换集/换线路：不重建会话，只推新地址 */
    castAgain: async (request, session) => {
      if (!controller) throw new Error("尚未连接电视");
      set({ busy: true, error: null });
      try {
        await controller.play(request);
        lastGoodStatus = { playing: true, position: request.position, duration: 0 };
        set({ session, busy: false, status: lastGoodStatus });
      } catch (error) {
        set({ busy: false, error: "切换失败，电视可能已断开。" });
        throw error;
      }
    },

    toggle: async () => {
      if (!controller) return;
      const playing = get().status?.playing;
      try {
        if (playing) {
          await controller.pause();
          // 暂停是用户主动行为，立刻结算一次进度
          await reportProgress("paused");
        } else {
          await controller.resume();
        }
        set((state) => ({
          status: state.status ? { ...state.status, playing: !playing } : state.status,
        }));
      } catch (error) {
        set({ error: "操作失败，电视可能已断开。" });
      }
    },

    seekTo: async (position) => {
      if (!controller) return;
      const clamped = Math.max(0, position);
      try {
        if (controller.device.protocol === "dlna") {
          const ok = await (controller as ReturnType<typeof createDlnaController>).trySeek(clamped);
          if (!ok) {
            set({ seekSupported: false, error: "这台电视不支持拖动进度，换集或从头播可以用。" });
            return;
          }
        } else {
          await controller.seek(clamped);
        }
        set((state) => ({
          status: state.status ? { ...state.status, position: clamped } : state.status,
          error: null,
        }));
      } catch (error) {
        set({ error: "跳转失败。" });
      }
    },

    seekBy: async (delta) => {
      const status = get().status;
      if (!status) return;
      const target = Math.max(0, Math.min(status.duration || Number.MAX_SAFE_INTEGER, status.position + delta));
      await get().seekTo(target);
    },

    disconnect: async () => {
      const hadSession = !!get().session;
      clearPoll();
      // DLNA 断开前结算一次，避免用户手动停止时丢进度
      if (hadSession) await reportProgress("disconnect");
      try {
        await controller?.stop();
      } catch {
        // 电视已经不理人了，忽略
      }
      controller = null;
      lastGoodStatus = null;
      set({ activeDevice: null, session: null, status: null, error: null, seekSupported: true });
    },

    refreshStatus: async () => {
      await poll();
    },
  };
});

/** 退出播放页时收尾：结算进度并断开，避免定时器泄漏 */
export async function shutdownCast(): Promise<void> {
  const state = useCastStore.getState();
  if (state.activeDevice) {
    await state.disconnect();
  } else {
    clearPoll();
    controller = null;
  }
}
