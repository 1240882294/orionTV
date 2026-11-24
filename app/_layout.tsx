import { DarkTheme, DefaultTheme, ThemeProvider } from "@react-navigation/native";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { Platform, View, StyleSheet } from "react-native";
import * as ScreenOrientation from "expo-screen-orientation";
import Toast from "react-native-toast-message";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { useSettingsStore } from "@/stores/settingsStore";
import { useRemoteControlStore } from "@/stores/remoteControlStore";
import LoginModal from "@/components/LoginModal";
import { RemoteControlModal } from "@/components/RemoteControlModal";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";
import useBootStore from "@/stores/bootStore";
import BootGate from "@/components/BootGate";
import { UpdateModal } from "@/components/UpdateModal";
import { initUpdateStore, useUpdateStore } from "@/stores/updateStore";
import { UPDATE_CONFIG } from "@/constants/UpdateConfig";
import Logger from '@/utils/Logger';

const logger = Logger.withTag('RootLayout');

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = "dark";
  const [loaded, error] = useFonts({
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
  });
  const { loadSettings, remoteInputEnabled } = useSettingsStore();
  const { startServer, stopServer } = useRemoteControlStore();
  const responsiveConfig = useResponsiveLayout();
  const bootPhase = useBootStore((state) => state.phase);
  const bootStart = useBootStore((state) => state.start);
  const bootDismissed = useBootStore((state) => state.dismissed);
  // 启动闸门显示期间把下面的页面从布局里摘掉：
  // 否则电视端的焦点会落在被遮住的首页控件上，遥控器按「确定」没有任何反应。
  const bootBlocking = !bootDismissed && bootPhase !== "ready";

  // 手机端固定竖屏：取消「跟随系统自动横竖屏」
  // 只有播放页在用户点全屏时才切横屏，返回后由播放页恢复竖屏
  // 注意：电视盒子不一定被识别为 Platform.isTV，这里还要排除宽度判定为 tv 的设备，
  // 否则会把电视强制锁成竖屏。
  useEffect(() => {
    const isHandheld = Platform.OS === "android" && !Platform.isTV && responsiveConfig.deviceType !== "tv";
    if (isHandheld) {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch((err) => {
        logger.debug("Portrait lock failed", err);
      });
    }
  }, []);

  // 启动序列：读配置 -> 扫描账号 -> 连接服务器 -> 刷新账号
  // 连接失败会停在 BootGate 的错误页，不会带着空数据进入首页
  useEffect(() => {
    const initializeApp = async () => {
      await loadSettings({ fetchConfig: false });
      await bootStart();
    };
    initializeApp();
  }, [loadSettings, bootStart]);

  // 启动流程结束后才收起启动图，避免出现「白屏 -> 启动页 -> 首页」的闪动
  const bootSettled =
    bootPhase === "ready" || bootPhase === "offline" || bootPhase === "unconfigured";

  useEffect(() => {
    if ((loaded || error) && bootSettled) {
      SplashScreen.hideAsync();
      if (error) {
        logger.warn(`Error in loading fonts: ${error}`);
      }
    }
  }, [loaded, error, bootSettled]);

  // 远程更新：启动页结束后静默查一次（12 小时内不重复查），有新版才弹窗
  useEffect(() => {
    if (!bootSettled) return;
    let cancelled = false;

    const checkRemoteUpdate = async () => {
      await initUpdateStore();
      if (cancelled) return;

      const { lastCheckTime, skipVersion, checkForUpdate, setShowUpdateModal, remoteVersion } =
        useUpdateStore.getState();
      if (Date.now() - lastCheckTime < UPDATE_CONFIG.CHECK_INTERVAL) return;

      // 启动阶段的检查不弹「已是最新版本」的提示
      const hasUpdate = await checkForUpdate(true);
      if (cancelled || !hasUpdate) return;
      if (useUpdateStore.getState().remoteVersion === skipVersion) return;
      setShowUpdateModal(true);
      logger.info(`[Update] 发现新版本 ${remoteVersion}`);
    };

    // 延后 3 秒，别和启动时的账号连接抢带宽
    const timer = setTimeout(checkRemoteUpdate, 3000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [bootSettled]);

  useEffect(() => {
    // 只有在非手机端才启动远程控制服务器
    if (remoteInputEnabled && responsiveConfig.deviceType !== "mobile") {
      startServer();
    } else {
      stopServer();
    }
  }, [remoteInputEnabled, startServer, stopServer, responsiveConfig.deviceType]);

  if (!loaded && !error) {
    return null;
  }

  return (
    <SafeAreaProvider>
      <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
        <View style={[styles.container, bootBlocking && styles.hidden]}>
          <Stack>
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="detail" options={{ headerShown: false }} />
            {Platform.OS !== "web" && <Stack.Screen name="play" options={{ headerShown: false }} />}
            <Stack.Screen name="search" options={{ headerShown: false }} />
            <Stack.Screen name="settings" options={{ headerShown: false }} />
            <Stack.Screen name="favorites" options={{ headerShown: false }} />
            <Stack.Screen name="+not-found" />
          </Stack>
        </View>
        <Toast />
        <LoginModal />
        <RemoteControlModal />
        <UpdateModal />
        <BootGate />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  hidden: {
    // display:none 会连同原生焦点一起移除，遥控器只能落在启动闸门的按钮上
    display: "none",
  },
});
