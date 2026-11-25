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
    
    try {
      // 1. 先设置位置（如果需要）
      const jumpPosition = initialPosition || introEndTime || 0;
      if (jumpPosition > 0) {
        console.info(`[PERF] Setting initial position to ${jumpPosition}ms`);
        await videoRef.current?.setPositionAsync(jumpPosition);
      }
      
      // 2. 显式调用播放以确保自动播放
      console.info(`[AUTOPLAY] Attempting to start playback after onLoad`);
      await videoRef.current?.playAsync();
      console.info(`[AUTOPLAY] Auto-play successful after onLoad`);
      
      usePlayerStore.setState({ isLoading: false });
      console.info(`[PERF] Video loading complete - isLoading set to false`);
    } catch (error) {
      console.warn(`[AUTOPLAY] Failed to auto-play after onLoad:`, error);
      // 即使自动播放失败，也要设置加载完成状态
      usePlayerStore.setState({ isLoading: false });
      // 不显示错误提示，因为自动播放失败是常见且预期的情况
    }
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