import { create } from "zustand";
import Toast from "react-native-toast-message";
import { AVPlaybackStatus, Video } from "expo-av";
import { RefObject } from "react";
import { PlayRecord, PlayRecordManager, PlayerSettingsManager } from "@/services/storage";
import useDetailStore, { episodesSelectorBySource } from "./detailStore";
import Logger from '@/utils/Logger';

const logger = Logger.withTag('PlayerStore');

/**
 * 切源后的记录保护期。
 *
 * 切线路时十有八九是「这条卡了，换一条试试」，可能几秒钟就退出去再换。
 * 如果这时候把记录覆盖成新线路的「第 1 集、0 秒」，用户原来看到哪儿就没了 ——
 * 手机端反馈的「切完线路记录丢了」就是这么来的。
 *
 * 规则：切源后累计播放不足 30 秒，一律不写记录，旧线路那条原封不动。
 * 播满 30 秒说明这条线路确实在用，才允许覆盖（覆盖时会顺手清掉旧线路那条）。
 */
const SWITCH_RECORD_GUARD_MS = 30 * 1000;

interface Episode {
  url: string;
  title: string;
}

interface PlayerState {
  videoRef: RefObject<Video> | null;
  currentEpisodeIndex: number;
  episodes: Episode[];
  status: AVPlaybackStatus | null;
  isLoading: boolean;
  showControls: boolean;
  showEpisodeModal: boolean;
  showSourceModal: boolean;
  showSpeedModal: boolean;
  showNextEpisodeOverlay: boolean;
  isSeeking: boolean;
  seekPosition: number;
  /** 本次 seek 的来源：手势滑动 / 控件进度条 / 快进按钮。只用于决定是否显示全屏预览条 */
  seekSource: "gesture" | "slider" | "button" | null;
  /** 本次 seek 相对原位置的变化量（毫秒），电视端用来显示「快进 20 秒」 */
  seekDeltaMillis: number;
  progressPosition: number;
  initialPosition: number;
  playbackRate: number;
  isFullscreen: boolean;
  /** 屏幕锁：锁上后手势、点击都不响应，只留一个解锁入口 */
  screenLocked: boolean;
  introEndTime?: number;
  outroStartTime?: number;
  setVideoRef: (ref: RefObject<Video>) => void;
  loadVideo: (options: {
    source: string;
    id: string;
    title: string;
    episodeIndex: number;
    position?: number;
  }) => Promise<void>;
  playEpisode: (index: number) => void;
  togglePlayPause: () => void;
  seek: (duration: number) => void;
  handlePlaybackStatusUpdate: (newStatus: AVPlaybackStatus) => void;
  setLoading: (loading: boolean) => void;
  setShowControls: (show: boolean) => void;
  setShowEpisodeModal: (show: boolean) => void;
  setShowSourceModal: (show: boolean) => void;
  setShowSpeedModal: (show: boolean) => void;
  setShowNextEpisodeOverlay: (show: boolean) => void;
  setPlaybackRate: (rate: number) => void;
  setIsFullscreen: (fullscreen: boolean) => void;
  toggleFullscreen: () => void;
  setScreenLocked: (locked: boolean) => void;
  beginSeek: (source?: "gesture" | "slider" | "button") => void;
  updateSeekPreview: (ratio: number, source?: "gesture" | "slider" | "button", deltaMillis?: number) => void;
  commitSeek: (ratio?: number) => Promise<void>;
  seekBy: (deltaMillis: number) => Promise<void>;
  setIntroEndTime: () => void;
  setOutroStartTime: () => void;
  reset: () => void;
  _seekTimeout?: NodeJS.Timeout;
  _isRecordSaveThrottled: boolean;
  /** 上一次 loadVideo 用的线路，用来判断这次调用是「首次播放」还是「换线路」 */
  _loadedSource: string | null;
  /** 切源保护期是否还生效（播满 30 秒自动解除） */
  _switchGuard: boolean;
  /** 保护期内累计的实际播放时长，只有 isPlaying 时才累加 */
  _switchPlayedMs: number;
  /** 上一次状态回调的时间戳，用来算播放时长增量 */
  _lastStatusAt: number;
  // Internal helper
  _savePlayRecord: (updates?: Partial<PlayRecord>, options?: { immediate?: boolean }) => void;
  handleVideoError: (errorType: 'ssl' | 'network' | 'other', failedUrl: string) => Promise<void>;
}

const usePlayerStore = create<PlayerState>((set, get) => ({
  videoRef: null,
  episodes: [],
  currentEpisodeIndex: -1,
  status: null,
  isLoading: true,
  showControls: false,
  showEpisodeModal: false,
  showSourceModal: false,
  showSpeedModal: false,
  showNextEpisodeOverlay: false,
  isSeeking: false,
  seekPosition: 0,
  seekSource: null,
  seekDeltaMillis: 0,
  progressPosition: 0,
  initialPosition: 0,
  playbackRate: 1.0,
  isFullscreen: false,
  screenLocked: false,
  introEndTime: undefined,
  outroStartTime: undefined,
  _seekTimeout: undefined,
  _isRecordSaveThrottled: false,
  _loadedSource: null,
  _switchGuard: false,
  _switchPlayedMs: 0,
  _lastStatusAt: 0,

  setVideoRef: (ref) => set({ videoRef: ref }),

  loadVideo: async ({ source, id, episodeIndex, position, title }) => {
    const perfStart = performance.now();
    logger.info(`[PERF] PlayerStore.loadVideo START - source: ${source}, id: ${id}, title: ${title}`);

    // 判断这次是不是「换线路」：上一次加载用的线路和这次不同，就进保护期。
    // 首次进入播放页 _loadedSource 为 null，不算切源，记录照常写。
    const prevLoadedSource = get()._loadedSource;
    const isSourceSwitch = !!prevLoadedSource && prevLoadedSource !== source;
    set({
      _loadedSource: source,
      _switchGuard: isSourceSwitch,
      _switchPlayedMs: 0,
      _lastStatusAt: 0,
    });
    if (isSourceSwitch) {
      logger.info(`[RECORD] Source switched ${prevLoadedSource} -> ${source}, play record protected for 30s`);
    }

    let detail = useDetailStore.getState().detail;
    let episodes: string[] = [];
    
    // 如果有detail，使用detail的source获取episodes；否则使用传入的source
    if (detail && detail.source) {
      logger.info(`[INFO] Using existing detail source "${detail.source}" to get episodes`);
      episodes = episodesSelectorBySource(detail.source)(useDetailStore.getState());
    } else {
      logger.info(`[INFO] No existing detail, using provided source "${source}" to get episodes`);
      episodes = episodesSelectorBySource(source)(useDetailStore.getState());
    }

    set({
      isLoading: true,
    });

    const needsDetailInit = !detail || !episodes || episodes.length === 0 || detail.title !== title;
    logger.info(`[PERF] Detail check - needsInit: ${needsDetailInit}, hasDetail: ${!!detail}, episodesCount: ${episodes?.length || 0}`);

    if (needsDetailInit) {
      const detailInitStart = performance.now();
      logger.info(`[PERF] DetailStore.init START - ${title}`);
      
      await useDetailStore.getState().init(title, source, id);
      
      const detailInitEnd = performance.now();
      logger.info(`[PERF] DetailStore.init END - took ${(detailInitEnd - detailInitStart).toFixed(2)}ms`);
      
      detail = useDetailStore.getState().detail;
      
      if (!detail) {
        logger.error(`[ERROR] Detail not found after initialization for "${title}" (source: ${source}, id: ${id})`);
        
        // 检查DetailStore的错误状态
        const detailStoreState = useDetailStore.getState();
        if (detailStoreState.error) {
          logger.error(`[ERROR] DetailStore error: ${detailStoreState.error}`);
          set({ 
            isLoading: false,
            // 可以选择在这里设置一个错误状态，但playerStore可能没有error字段
          });
        } else {
          logger.error(`[ERROR] DetailStore init completed but no detail found and no error reported`);
          set({ isLoading: false });
        }
        return;
      }
      
      // 使用DetailStore找到的实际source来获取episodes，而不是原始的preferredSource
      logger.info(`[INFO] Using actual source "${detail.source}" instead of preferred source "${source}"`);  
      episodes = episodesSelectorBySource(detail.source)(useDetailStore.getState());
      
      if (!episodes || episodes.length === 0) {
        logger.error(`[ERROR] No episodes found for "${title}" from source "${detail.source}" (${detail.source_name})`);
        
        // 尝试从searchResults中直接获取episodes
        const detailStoreState = useDetailStore.getState();
        logger.info(`[INFO] Available sources in searchResults: ${detailStoreState.searchResults.map(r => `${r.source}(${r.episodes?.length || 0} episodes)`).join(', ')}`);
        
        // 如果当前source没有episodes，尝试使用第一个有episodes的source
        const sourceWithEpisodes = detailStoreState.searchResults.find(r => r.episodes && r.episodes.length > 0);
        if (sourceWithEpisodes) {
          logger.info(`[FALLBACK] Using alternative source "${sourceWithEpisodes.source}" with ${sourceWithEpisodes.episodes.length} episodes`);
          episodes = sourceWithEpisodes.episodes;
          // 更新detail为有episodes的source
          detail = sourceWithEpisodes;
        } else {
          logger.error(`[ERROR] No source with episodes found in searchResults`);
          set({ isLoading: false });
          return;
        }
      }
      
      logger.info(`[SUCCESS] Detail and episodes loaded - source: ${detail.source_name}, episodes: ${episodes.length}`);
    } else {
      logger.info(`[PERF] Skipping DetailStore.init - using cached data`);
      
      // 即使是缓存的数据，也要确保使用正确的source获取episodes
      if (detail && detail.source && detail.source !== source) {
        logger.info(`[INFO] Cached detail source "${detail.source}" differs from provided source "${source}", updating episodes`);
        episodes = episodesSelectorBySource(detail.source)(useDetailStore.getState());
        
        if (!episodes || episodes.length === 0) {
          logger.warn(`[WARN] Cached detail source "${detail.source}" has no episodes, trying provided source "${source}"`);
          episodes = episodesSelectorBySource(source)(useDetailStore.getState());
        }
      }
    }

    // 最终验证：确保我们有有效的detail和episodes数据
    if (!detail) {
      logger.error(`[ERROR] Final check failed: detail is null`);
      set({ isLoading: false });
      return;
    }
    
    if (!episodes || episodes.length === 0) {
      logger.error(`[ERROR] Final check failed: no episodes available for source "${detail.source}" (${detail.source_name})`);
      set({ isLoading: false });
      return;
    }
    
    logger.info(`[SUCCESS] Final validation passed - detail: ${detail.source_name}, episodes: ${episodes.length}`);

    try {
      const storageStart = performance.now();
      logger.info(`[PERF] Storage operations START`);
      
      let playRecord = await PlayRecordManager.get(detail!.source, detail!.id.toString());
      const storagePlayRecordEnd = performance.now();
      logger.info(`[PERF] PlayRecordManager.get took ${(storagePlayRecordEnd - storageStart).toFixed(2)}ms`);

      // 新线路上没有自己的记录 —— 正常，因为记录是按「线路 + id」存的。
      // 这时用同一部剧在旧线路下的记录兜底，否则切完线路进度和集数全归零。
      if (!playRecord && detail!.title) {
        playRecord = await PlayRecordManager.findByTitle(detail!.title, detail!.year);
        if (playRecord) {
          logger.info(
            `[RECORD] Fallback to another source's record: ep${playRecord.index}, ${playRecord.play_time}s (${playRecord.source_name})`
          );
        }
      }

      const playerSettings = await PlayerSettingsManager.get(detail!.source, detail!.id.toString());
      const storageEnd = performance.now();
      logger.info(`[PERF] PlayerSettingsManager.get took ${(storageEnd - storagePlayRecordEnd).toFixed(2)}ms`);
      logger.info(`[PERF] Total storage operations took ${(storageEnd - storageStart).toFixed(2)}ms`);
      
      const initialPositionFromRecord = playRecord?.play_time ? playRecord.play_time * 1000 : 0;
      const savedPlaybackRate = playerSettings?.playbackRate || 1.0;

      // episodeIndex < 0 表示调用方没指定（例如切线路时还没播起来、store 里是初始值 -1）。
      // 这种情况必须用记录里的集数兜底，否则选集索引是 -1，取不到播放地址，
      // 界面就永远停在加载中，用户只能手动选集才能恢复。
      const recordEpisodeIndex = playRecord?.index ? Math.max(0, playRecord.index - 1) : 0;

      // 集数以谁为准：
      // - 从「继续观看」卡片进来（带 position）→ 以记录为准。
      //   卡片上的集数和进度都来自同一条记录，只要跟着记录走，两者就不会打架；
      //   之前首页卡片把 1 基的 index 当 0 基显示，导致「记录 12 集、进去是 11 集」，
      //   这里再加一道保险，避免任何入口传参偏差演变成集数与进度错配。
      // - 从详情页点选集进来（不带 position）→ 以路由参数为准，用户是主动选这一集。
      const fromRecordEntry = typeof position === "number" && position > 0 && !!playRecord;
      const baseEpisodeIndex = fromRecordEntry
        ? recordEpisodeIndex
        : episodeIndex >= 0
          ? episodeIndex
          : recordEpisodeIndex;

      // 换线路后集数可能变少（记录是第 12 集，新线路只有 10 集）。
      // 越界索引取不到播放地址，界面会永远停在加载中 —— 夹到末集并降级位置，
      // 否则会拿着上一集的进度去播放一个更短的视频，直接跳到结尾。
      const lastEpisodeIndex = Math.max(episodes.length - 1, 0);
      const resolvedEpisodeIndex = Math.min(Math.max(baseEpisodeIndex, 0), lastEpisodeIndex);
      const clampedByRange = resolvedEpisodeIndex !== baseEpisodeIndex;
      if (clampedByRange) {
        logger.warn(
          `[RECORD] Episode index ${baseEpisodeIndex + 1} out of range (total ${episodes.length}), clamped to ${resolvedEpisodeIndex + 1}`
        );
      }
      if (episodeIndex < 0 && !fromRecordEntry) {
        logger.info(`[RECORD] Episode index missing (-1), fallback to record: ep${resolvedEpisodeIndex + 1}`);
      }
      if (fromRecordEntry) {
        logger.info(
          `[RECORD] Restore from record: ep${resolvedEpisodeIndex + 1}/${episodes.length}, ${Math.floor(
            initialPositionFromRecord / 1000
          )}s (route said ep${episodeIndex + 1})`
        );
      }
      
      const episodesMappingStart = performance.now();
      const mappedEpisodes = episodes.map((ep, index) => ({
        url: ep,
        title: `第 ${index + 1} 集`,
      }));
      const episodesMappingEnd = performance.now();
      logger.info(`[PERF] Episodes mapping (${episodes.length} episodes) took ${(episodesMappingEnd - episodesMappingStart).toFixed(2)}ms`);
      
      set({
        isLoading: false,
        currentEpisodeIndex: resolvedEpisodeIndex,
        // 集数被夹住说明记录已经和当前线路对不上，旧进度不再可信，从头开始
        initialPosition: clampedByRange
          ? 0
          : fromRecordEntry
            ? initialPositionFromRecord
            : position || initialPositionFromRecord,
        playbackRate: savedPlaybackRate,
        episodes: mappedEpisodes,
        introEndTime: playRecord?.introEndTime || playerSettings?.introEndTime,
        outroStartTime: playRecord?.outroStartTime || playerSettings?.outroStartTime,
      });
      
      const perfEnd = performance.now();
      logger.info(`[PERF] PlayerStore.loadVideo COMPLETE - total time: ${(perfEnd - perfStart).toFixed(2)}ms`);
      
    } catch (error) {
      logger.debug("Failed to load play record", error);
      set({ isLoading: false });
      
      const perfEnd = performance.now();
      logger.info(`[PERF] PlayerStore.loadVideo ERROR - total time: ${(perfEnd - perfStart).toFixed(2)}ms`);
    }
  },

  playEpisode: async (index) => {
    const { episodes, videoRef } = get();
    if (index >= 0 && index < episodes.length) {
      set({
        currentEpisodeIndex: index,
        showNextEpisodeOverlay: false,
        initialPosition: 0,
        progressPosition: 0,
        seekPosition: 0,
      });
      try {
        await videoRef?.current?.replayAsync();
      } catch (error) {
        logger.debug("Failed to replay video:", error);
        Toast.show({ type: "error", text1: "播放失败" });
      }
    }
  },

  togglePlayPause: async () => {
    const { status, videoRef } = get();
    if (status?.isLoaded) {
      try {
        if (status.isPlaying) {
          await videoRef?.current?.pauseAsync();
        } else {
          await videoRef?.current?.playAsync();
        }
      } catch (error) {
        logger.debug("Failed to toggle play/pause:", error);
        Toast.show({ type: "error", text1: "操作失败" });
      }
    }
  },

  seek: async (duration) => {
    const { status, videoRef } = get();
    if (!status?.isLoaded || !status.durationMillis) return;

    const newPosition = Math.max(0, Math.min(status.positionMillis + duration, status.durationMillis));
    try {
      await videoRef?.current?.setPositionAsync(newPosition);
    } catch (error) {
      logger.debug("Failed to seek video:", error);
      Toast.show({ type: "error", text1: "快进/快退失败" });
    }

    set({
      isSeeking: true,
      seekSource: "button",
      seekPosition: newPosition / status.durationMillis,
    });

    if (get()._seekTimeout) {
      clearTimeout(get()._seekTimeout);
    }
    const timeoutId = setTimeout(() => set({ isSeeking: false, seekSource: null, seekDeltaMillis: 0 }), 1000);
    set({ _seekTimeout: timeoutId });
  },

  setIntroEndTime: () => {
    const { status, introEndTime: existingIntroEndTime } = get();
    const detail = useDetailStore.getState().detail;
    if (!status?.isLoaded || !detail) return;

    if (existingIntroEndTime) {
      // Clear the time
      set({ introEndTime: undefined });
      get()._savePlayRecord({ introEndTime: undefined }, { immediate: true });
      Toast.show({
        type: "info",
        text1: "已清除片头时间",
      });
    } else {
      // Set the time
      const newIntroEndTime = status.positionMillis;
      set({ introEndTime: newIntroEndTime });
      get()._savePlayRecord({ introEndTime: newIntroEndTime }, { immediate: true });
      Toast.show({
        type: "success",
        text1: "设置成功",
        text2: "片头时间已记录。",
      });
    }
  },

  setOutroStartTime: () => {
    const { status, outroStartTime: existingOutroStartTime } = get();
    const detail = useDetailStore.getState().detail;
    if (!status?.isLoaded || !detail) return;

    if (existingOutroStartTime) {
      // Clear the time
      set({ outroStartTime: undefined });
      get()._savePlayRecord({ outroStartTime: undefined }, { immediate: true });
      Toast.show({
        type: "info",
        text1: "已清除片尾时间",
      });
    } else {
      // Set the time
      if (!status.durationMillis) return;
      const newOutroStartTime = status.durationMillis - status.positionMillis;
      set({ outroStartTime: newOutroStartTime });
      get()._savePlayRecord({ outroStartTime: newOutroStartTime }, { immediate: true });
      Toast.show({
        type: "success",
        text1: "设置成功",
        text2: "片尾时间已记录。",
      });
    }
  },

  _savePlayRecord: (updates = {}, options = {}) => {
    const { immediate = false } = options;

    // 切源保护期：新线路还没播满 30 秒，这一条记录就不该动。
    // immediate 的写入（片头/片尾时间）跟进度无关，放行。
    if (!immediate) {
      const guard = get();
      if (guard._switchGuard) {
        if (guard._switchPlayedMs < SWITCH_RECORD_GUARD_MS) {
          // 状态回调约 500ms 一次，这里用 debug 级别，别刷屏
          logger.debug(
            `[RECORD] Skip save - switched source but only played ${Math.round(guard._switchPlayedMs / 1000)}s (<30s)`
          );
          return;
        }
        // 播够了，解除保护，之后按正常节奏写
        set({ _switchGuard: false });
        logger.info(`[RECORD] Switch guard released, record will be overwritten`);
      }
    }

    if (!immediate) {
      if (get()._isRecordSaveThrottled) {
        return;
      }
      set({ _isRecordSaveThrottled: true });
      setTimeout(() => {
        set({ _isRecordSaveThrottled: false });
      }, 10000); // 10 seconds
    }

    const { detail } = useDetailStore.getState();
    const { currentEpisodeIndex, episodes, status, introEndTime, outroStartTime } = get();
    if (detail && status?.isLoaded) {
      const existingRecord = {
        introEndTime,
        outroStartTime,
      };
      PlayRecordManager.save(detail.source, detail.id.toString(), {
        title: detail.title,
        cover: detail.poster || "",
        index: currentEpisodeIndex + 1,
        total_episodes: episodes.length,
        play_time: Math.floor(status.positionMillis / 1000),
        total_time: status.durationMillis ? Math.floor(status.durationMillis / 1000) : 0,
        source_name: detail.source_name,
        year: detail.year || "",
        ...existingRecord,
        ...updates,
      });
    }
  },

  handlePlaybackStatusUpdate: (newStatus) => {
    if (!newStatus.isLoaded) {
      if (newStatus.error) {
        logger.debug(`Playback Error: ${newStatus.error}`);
      }
      set({ status: newStatus });
      return;
    }

    const { currentEpisodeIndex, episodes, outroStartTime, playEpisode } = get();
    const detail = useDetailStore.getState().detail;

    // 累计「真正在播」的时长，供切源保护期判断。
    // 只认 isPlaying：缓冲中、暂停、卡死都不算 —— 否则切到一条卡死的线路上
    // 干等 30 秒也会被当成「这条在用」，保护就失效了。
    const guardState = get();
    let guardPatch: { _switchPlayedMs?: number; _lastStatusAt: number } = { _lastStatusAt: 0 };
    if (newStatus.isPlaying) {
      const now = Date.now();
      const last = guardState._lastStatusAt || now;
      // 状态回调约 500ms 一次；单次增量封顶 2 秒，防止应用切后台后一次性加太多
      const delta = Math.min(Math.max(now - last, 0), 2000);
      guardPatch = {
        _lastStatusAt: now,
        ...(guardState._switchGuard ? { _switchPlayedMs: guardState._switchPlayedMs + delta } : {}),
      };
    }

    if (
      outroStartTime &&
      newStatus.durationMillis &&
      newStatus.positionMillis >= newStatus.durationMillis - outroStartTime
    ) {
      if (currentEpisodeIndex < episodes.length - 1) {
        playEpisode(currentEpisodeIndex + 1);
        return; // Stop further processing for this update
      }
    }

    if (detail && newStatus.durationMillis) {
      get()._savePlayRecord();

      const isNearEnd = newStatus.positionMillis / newStatus.durationMillis > 0.95;
      if (isNearEnd && currentEpisodeIndex < episodes.length - 1 && !outroStartTime) {
        set({ showNextEpisodeOverlay: true });
      } else {
        set({ showNextEpisodeOverlay: false });
      }
    }

    if (newStatus.didJustFinish) {
      if (currentEpisodeIndex < episodes.length - 1) {
        playEpisode(currentEpisodeIndex + 1);
      }
    }

    const progressPosition = newStatus.durationMillis ? newStatus.positionMillis / newStatus.durationMillis : 0;
    set({ status: newStatus, progressPosition, ...guardPatch });
  },

  setLoading: (loading) => set({ isLoading: loading }),
  setShowControls: (show) => set({ showControls: show }),
  setShowEpisodeModal: (show) => set({ showEpisodeModal: show }),
  setShowSourceModal: (show) => set({ showSourceModal: show }),
  setShowSpeedModal: (show) => set({ showSpeedModal: show }),
  setShowNextEpisodeOverlay: (show) => set({ showNextEpisodeOverlay: show }),

  setPlaybackRate: async (rate) => {
    const { videoRef } = get();
    const detail = useDetailStore.getState().detail;
    
    try {
      await videoRef?.current?.setRateAsync(rate, true);
      set({ playbackRate: rate });
      
      // Save the playback rate preference
      if (detail) {
        await PlayerSettingsManager.save(detail.source, detail.id.toString(), { playbackRate: rate });
      }
    } catch (error) {
      logger.debug("Failed to set playback rate:", error);
    }
  },

  setIsFullscreen: (fullscreen) => set({ isFullscreen: fullscreen }),

  toggleFullscreen: () => set({ isFullscreen: !get().isFullscreen }),

  setScreenLocked: (locked) => set({ screenLocked: locked }),

  // 手势滑动开始：进入进度预览状态
  beginSeek: (source = "gesture") => {
    const { status } = get();
    if (!status?.isLoaded || !status.durationMillis) return;
    if (get()._seekTimeout) {
      clearTimeout(get()._seekTimeout);
      set({ _seekTimeout: undefined });
    }
    set({
      isSeeking: true,
      seekSource: source,
      seekPosition: status.positionMillis / status.durationMillis,
      seekDeltaMillis: 0,
    });
  },

  // 手势滑动中：只更新预览，不动播放器
  updateSeekPreview: (ratio, source, deltaMillis) => {
    set({
      isSeeking: true,
      ...(source ? { seekSource: source } : {}),
      ...(typeof deltaMillis === "number" ? { seekDeltaMillis: deltaMillis } : {}),
      seekPosition: Math.max(0, Math.min(1, ratio)),
    });
  },

  // 手势结束：真正跳转
  commitSeek: async (ratio) => {
    const { status, videoRef } = get();
    if (!status?.isLoaded || !status.durationMillis) {
      set({ isSeeking: false, seekSource: null });
      return;
    }

    const targetRatio = typeof ratio === "number" ? Math.max(0, Math.min(1, ratio)) : get().seekPosition;
    const targetMillis = Math.max(0, Math.min(targetRatio * status.durationMillis, status.durationMillis));

    set({ isSeeking: true, seekPosition: targetRatio });
    try {
      await videoRef?.current?.setPositionAsync(targetMillis);
    } catch (error) {
      logger.debug("Failed to commit seek:", error);
    }

    if (get()._seekTimeout) clearTimeout(get()._seekTimeout);
    // 松手即收起全屏预览条，避免和控件里的进度条同时出现（重影）；
    // isSeeking 再保留一会儿，等播放器上报新位置，防止进度条回跳。
    set({ seekSource: null });
    const timeoutId = setTimeout(() => set({ isSeeking: false, seekDeltaMillis: 0 }), 500);
    set({ _seekTimeout: timeoutId });
  },

  // 快进/快退固定时长（毫秒）
  seekBy: async (deltaMillis) => {
    const { status, videoRef } = get();
    if (!status?.isLoaded || !status.durationMillis) return;

    const targetMillis = Math.max(
      0,
      Math.min(status.positionMillis + deltaMillis, status.durationMillis)
    );

    try {
      await videoRef?.current?.setPositionAsync(targetMillis);
    } catch (error) {
      logger.debug("Failed to seek by offset:", error);
    }

    set({
      isSeeking: true,
      seekSource: "button",
      seekPosition: targetMillis / status.durationMillis,
      seekDeltaMillis: targetMillis - status.positionMillis,
      progressPosition: targetMillis / status.durationMillis,
    });

    if (get()._seekTimeout) clearTimeout(get()._seekTimeout);
    const timeoutId = setTimeout(() => set({ isSeeking: false, seekSource: null, seekDeltaMillis: 0 }), 800);
    set({ _seekTimeout: timeoutId });
  },

  reset: () => {
    set({
      episodes: [],
      currentEpisodeIndex: 0,
      status: null,
      isLoading: true,
      showControls: false,
      showEpisodeModal: false,
      showSourceModal: false,
      showSpeedModal: false,
      showNextEpisodeOverlay: false,
      initialPosition: 0,
      playbackRate: 1.0,
      isFullscreen: false,
      screenLocked: false,
      isSeeking: false,
      seekPosition: 0,
      seekSource: null,
      seekDeltaMillis: 0,
      progressPosition: 0,
      introEndTime: undefined,
      outroStartTime: undefined,
      // 离开播放页即重置会话：下次进来算「首次播放」，记录照常写
      _loadedSource: null,
      _switchGuard: false,
      _switchPlayedMs: 0,
      _lastStatusAt: 0,
    });
  },

  handleVideoError: async (errorType: 'ssl' | 'network' | 'other', failedUrl: string) => {
    const perfStart = performance.now();
    logger.error(`[VIDEO_ERROR] Handling ${errorType} error for URL: ${failedUrl}`);
    
    const detailStoreState = useDetailStore.getState();
    const { detail } = detailStoreState;
    const { currentEpisodeIndex } = get();
    
    if (!detail) {
      logger.error(`[VIDEO_ERROR] Cannot fallback - no detail available`);
      set({ isLoading: false });
      return;
    }
    
    // 标记当前source为失败
    const currentSource = detail.source;
    const errorReason = `${errorType} error: ${failedUrl.substring(0, 100)}...`;
    useDetailStore.getState().markSourceAsFailed(currentSource, errorReason);
    
    // 获取下一个可用的source
    const fallbackSource = useDetailStore.getState().getNextAvailableSource(currentSource, currentEpisodeIndex);
    
    if (!fallbackSource) {
      logger.error(`[VIDEO_ERROR] No fallback sources available for episode ${currentEpisodeIndex + 1}`);
      Toast.show({ 
        type: "error", 
        text1: "播放失败", 
        text2: "所有播放源都不可用，请稍后重试" 
      });
      set({ isLoading: false });
      return;
    }
    
    logger.info(`[VIDEO_ERROR] Switching to fallback source: ${fallbackSource.source} (${fallbackSource.source_name})`);
    
    try {
      // 更新DetailStore的当前detail为fallback source
      await useDetailStore.getState().setDetail(fallbackSource);
      
      // 重新加载当前集数的episodes
      const newEpisodes = fallbackSource.episodes || [];
      if (newEpisodes.length > currentEpisodeIndex) {
        const mappedEpisodes = newEpisodes.map((ep, index) => ({
          url: ep,
          title: `第 ${index + 1} 集`,
        }));
        
        // 出错自动换源也算切线路：从当前进度接着播，并进记录保护期
        const lastStatus = get().status;
        const currentPosition = lastStatus?.isLoaded ? lastStatus.positionMillis : undefined;

        set({
          episodes: mappedEpisodes,
          isLoading: false, // 让Video组件重新渲染
          initialPosition: currentPosition ?? get().initialPosition,
          _loadedSource: fallbackSource.source,
          _switchGuard: true,
          _switchPlayedMs: 0,
          _lastStatusAt: 0,
        });
        
        const perfEnd = performance.now();
        logger.info(`[VIDEO_ERROR] Successfully switched to fallback source in ${(perfEnd - perfStart).toFixed(2)}ms`);
        logger.info(`[VIDEO_ERROR] New episode URL: ${newEpisodes[currentEpisodeIndex].substring(0, 100)}...`);
        
        Toast.show({ 
          type: "success", 
          text1: "已切换播放源", 
          text2: `正在使用 ${fallbackSource.source_name}` 
        });
      } else {
        logger.error(`[VIDEO_ERROR] Fallback source doesn't have episode ${currentEpisodeIndex + 1}`);
        set({ isLoading: false });
      }
    } catch (error) {
      logger.error(`[VIDEO_ERROR] Failed to switch to fallback source:`, error);
      set({ isLoading: false });
    }
  },
}));

export default usePlayerStore;

export const selectCurrentEpisode = (state: PlayerState) => {
  // 增强数据安全性检查
  if (
    state.episodes &&
    Array.isArray(state.episodes) &&
    state.episodes.length > 0 &&
    state.currentEpisodeIndex >= 0 &&
    state.currentEpisodeIndex < state.episodes.length
  ) {
    const episode = state.episodes[state.currentEpisodeIndex];
    // 确保episode有有效的URL
    if (episode && episode.url && episode.url.trim() !== "") {
      return episode;
    } else {
      // 仅在调试模式下打印
      if (__DEV__) {
        logger.debug(`[PERF] selectCurrentEpisode - episode found but invalid URL: ${episode?.url}`);
      }
    }
  } else {
    // 仅在调试模式下打印
    if (__DEV__) {
      logger.debug(`[PERF] selectCurrentEpisode - no valid episode: episodes.length=${state.episodes?.length}, currentIndex=${state.currentEpisodeIndex}`);
    }
  }
  return undefined;
};
