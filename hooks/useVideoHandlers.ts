import { useCallback, RefObject, useMemo } from 'react';
import { Video, ResizeMode } from 'expo-av';
import Toast from 'react-native-toast-message';
import usePlayerStore from '@/stores/playerStore';

interface UseVideoHandlersProps {
  videoRef: RefObject<Video>;
  currentEpisode: { url: string; title: string } | undefined;
  /** 实际交给播放器的地址（可能是去广告后的本地列表） */
  sourceUrl?: string;
  /** 播放出错时的前置处理；返回 true 表示已接管（例如回退到原始地址），不再切源 */
  beforeError?: (error: any) => boolean;
  initialPosition: number;
  introEndTime?: number;
  playbackRate: number;
  handlePlaybackStatusUpdate: (status: any) => void;
  deviceType: string;
  detail?: { poster?: string };
  /** 画面填充方式：全屏用 COVER 铺满，小窗用 CONTAIN 完整显示 */
  resizeMode?: ResizeMode;
}

export const useVideoHandlers = ({
  videoRef,
  currentEpisode,
  sourceUrl,
  beforeError,
  initialPosition,
  introEndTime,
  playbackRate,
  handlePlaybackStatusUpdate,
  deviceType,
  detail,
  resizeMode,
}: UseVideoHandlersProps) => {
  
  const onLoad = useCallback(async () => {
    console.info(`[PERF] Video onLoad - video ready to play`);

    // ① 先把播放指令发出去。
    //    以前是「先 seek 再 play」串在同一个 try 里：HLS 的 seek 要现拉目标位置的分片，
    //    弱网下动辄好几秒、甚至直接抛错，await 卡住后面那句 playAsync 就永远不执行，
    //    画面已经出来了却停在暂停状态 —— 用户点播放时播放器又尚未就绪，报「操作失败」。
    try {
      await videoRef.current?.playAsync();
      console.info(`[AUTOPLAY] playAsync on load ok`);
    } catch (error) {
      // 起播失败交给 shouldPlay 与用户点击兜底，不阻断后面的 seek
      console.warn(`[AUTOPLAY] playAsync on load failed:`, error);
    }

    // ② 再跳到上次位置。失败只影响进度，不影响已经起来的播放。
    const jumpPosition = initialPosition || introEndTime || 0;
    if (jumpPosition > 0) {
      try {
        console.info(`[PERF] Setting initial position to ${jumpPosition}ms`);
        // HLS 上做「精确 seek」要等到目标分片对齐才算完，弱网里能卡十秒以上。
        // 给 5 秒宽容度：允许落到附近的关键帧，用户感知不到差别，但能立刻完成。
        await videoRef.current?.setPositionAsync(jumpPosition, {
          toleranceMillisBefore: 5000,
          toleranceMillisAfter: 5000,
        });
        // 部分机型 seek 结束会把播放状态重置成暂停，这里补一枪
        await videoRef.current?.playAsync();
      } catch (error) {
        console.warn(`[AUTOPLAY] seek to ${jumpPosition}ms failed, keep playing:`, error);
      }
    }

    usePlayerStore.setState({ isLoading: false });
    console.info(`[PERF] Video loading complete - isLoading set to false`);
  }, [videoRef, initialPosition, introEndTime]);

  const onLoadStart = useCallback(() => {
    if (!currentEpisode?.url) return;
    
    console.info(`[PERF] Video onLoadStart - starting to load video: ${currentEpisode.url.substring(0, 100)}...`);
    usePlayerStore.setState({ isLoading: true });
  }, [currentEpisode?.url]);

  const onError = useCallback((error: any) => {
    if (!currentEpisode?.url) return;

    // 去广告的本地列表播不了时先回退原地址，别急着换线路
    if (beforeError?.(error)) return;
    
    console.error(`[ERROR] Video playback error:`, error);
    
    // 检测SSL证书错误和其他网络错误
    const errorString = (error as any)?.error?.toString() || error?.toString() || '';
    const isSSLError = errorString.includes('SSLHandshakeException') || 
                      errorString.includes('CertPathValidatorException') ||
                      errorString.includes('Trust anchor for certification path not found');
    const isNetworkError = errorString.includes('HttpDataSourceException') ||
                         errorString.includes('IOException') ||
                         errorString.includes('SocketTimeoutException');
    
    if (isSSLError) {
      console.error(`[SSL_ERROR] SSL certificate validation failed for URL: ${currentEpisode.url}`);
      Toast.show({ 
        type: "error", 
        text1: "SSL证书错误，正在尝试其他播放源...",
        text2: "请稍候"
      });
      usePlayerStore.getState().handleVideoError('ssl', currentEpisode.url);
    } else if (isNetworkError) {
      console.error(`[NETWORK_ERROR] Network connection failed for URL: ${currentEpisode.url}`);
      Toast.show({ 
        type: "error", 
        text1: "网络连接失败，正在尝试其他播放源...",
        text2: "请稍候"
      });
      usePlayerStore.getState().handleVideoError('network', currentEpisode.url);
    } else {
      console.error(`[VIDEO_ERROR] Other video error for URL: ${currentEpisode.url}`);
      Toast.show({ 
        type: "error", 
        text1: "视频播放失败，正在尝试其他播放源...",
        text2: "请稍候"
      });
      usePlayerStore.getState().handleVideoError('other', currentEpisode.url);
    }
  }, [currentEpisode?.url, beforeError]);

  // 优化的Video组件props
  const videoProps = useMemo(() => ({
    source: { uri: sourceUrl || currentEpisode?.url || '' },
    posterSource: { uri: detail?.poster ?? "" },
    resizeMode: resizeMode ?? ResizeMode.CONTAIN,
    rate: playbackRate,
    onPlaybackStatusUpdate: handlePlaybackStatusUpdate,
    onLoad,
    onLoadStart,
    onError,
    // 统一使用自定义控件：手机端需要横屏、滑动手势与底部选集/倍速，原生控件会抢占触摸
    useNativeControls: false,
    shouldPlay: true,
  }), [
    currentEpisode?.url,
    sourceUrl,
    detail?.poster,
    playbackRate,
    handlePlaybackStatusUpdate,
    onLoad,
    onLoadStart,
    onError,
    deviceType,
    resizeMode,
  ]);

  return {
    onLoad,
    onLoadStart,
    onError,
    videoProps,
  };
};