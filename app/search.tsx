import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  View,
  TextInput,
  StyleSheet,
  Alert,
  Keyboard,
  TouchableOpacity,
  Pressable,
  findNodeHandle,
} from "react-native";
import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import VideoCard from "@/components/VideoCard";
import VideoLoadingAnimation from "@/components/VideoLoadingAnimation";
import { api, SearchResult } from "@/services/api";
import { Search, QrCode } from "lucide-react-native";
import { StyledButton } from "@/components/StyledButton";
import { useRemoteControlStore } from "@/stores/remoteControlStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useRouter } from "expo-router";
import { Colors } from "@/constants/Colors";
import CustomScrollView from "@/components/CustomScrollView";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";
import { getCommonResponsiveStyles } from "@/utils/ResponsiveStyles";
import ResponsiveNavigation from "@/components/navigation/ResponsiveNavigation";
import ResponsiveHeader from "@/components/navigation/ResponsiveHeader";
import { DeviceUtils } from "@/utils/DeviceUtils";
import {
  ensureSuggestIndex,
  hotTitles,
  rememberTitles,
  suggestTitles,
  SuggestEntry,
} from "@/services/searchSuggestIndex";
import Logger from '@/utils/Logger';

const logger = Logger.withTag('SearchScreen');

export default function SearchScreen() {
  const [keyword, setKeyword] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<SuggestEntry[]>([]);
  // 词库是分批到位的（先内置种子，再本地历史，最后网络榜单），这个版本号用来触发重新匹配
  const [suggestVersion, setSuggestVersion] = useState(0);
  const textInputRef = useRef<TextInput>(null);
  /** 输入框的原生 tag：联想行的 nextFocusUp 指回它，遥控器按上就能回到输入框 */
  const [inputNativeTag, setInputNativeTag] = useState<number | null>(null);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const { showModal: showRemoteModal, lastMessage, targetPage, clearMessage } = useRemoteControlStore();
  const { remoteInputEnabled } = useSettingsStore();
  const router = useRouter();

  /**
   * 回填搜索框文字。
   *
   * 输入框是**非受控**的（只给 defaultValue，不给 value），原因：
   * 受控输入框 + 中文输入法在安卓上会打架 —— 每次 setState 都带着旧的 value 重渲染，
   * 输入法的组词会被打断或丢字，表现为「联想有候选时中文打不进去」。
   * 所以文字只由输入法自己维护，程序需要改写时（远程输入、点联想词）走 setNativeProps。
   */
  const applyKeyword = useCallback((text: string) => {
    setKeyword(text);
    textInputRef.current?.setNativeProps({ text });
  }, []);

  // 响应式布局配置
  const responsiveConfig = useResponsiveLayout();
  const commonStyles = getCommonResponsiveStyles(responsiveConfig);
  const { deviceType, spacing } = responsiveConfig;

  useEffect(() => {
    if (lastMessage && targetPage === 'search') {
      logger.debug("Received remote input:", lastMessage);
      const realMessage = lastMessage.split("_")[0];
      applyKeyword(realMessage);
      handleSearch(realMessage);
      clearMessage(); // Clear the message after processing
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastMessage, targetPage]);

  // useEffect(() => {
  //   // Focus the text input when the screen loads
  //   const timer = setTimeout(() => {
  //     textInputRef.current?.focus();
  //   }, 200);
  //   return () => clearTimeout(timer);
  // }, []);

  /**
   * 首字母联想词库预热：本地搜索历史 + 收藏 + 播放记录，再叠加豆瓣榜单。
   * 词库只读本地内存，匹配不发网络请求，输入过程中不会有卡顿。
   */
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      if (!cancelled) setSuggestVersion((v) => v + 1);
    };
    ensureSuggestIndex()
      .then(refresh)
      .catch(() => {
        /* 词库拉取失败不影响搜索本身 */
      });
    // 本地词库很快就好，网络榜单慢一些：分两次补刷，别让候选一直空着
    const timers = [400, 2000].map((delay) => setTimeout(refresh, delay));
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, []);

  /**
   * 关键词变化就重算候选。
   *
   * 这里刻意只读不写：不 setKeyword、不动焦点、不阻塞输入。
   * 之前那版一边过滤一边回写输入框，联想为空时连中文都敲不进去。
   */
  useEffect(() => {
    const q = keyword.trim();
    const limit = deviceType === "tv" ? 6 : 4;
    if (!q) {
      // 还没输入时给「热门推荐」：搜索页一进来就能看到联想确实在
      setSuggestions(deviceType === "mobile" ? [] : hotTitles(limit));
      return;
    }
    setSuggestions(suggestTitles(q, limit));
  }, [keyword, suggestVersion, deviceType]);

  const handleSearch = async (searchText?: string) => {
    const term = typeof searchText === "string" ? searchText : keyword;
    if (!term.trim()) {
      Keyboard.dismiss();
      return;
    }
    Keyboard.dismiss();
    setLoading(true);
    setError(null);
    try {
      const response = await api.searchVideos(term);
      if (response.results.length > 0) {
        setResults(response.results);
        // 搜到的标题回填词库，下次打首字母就能联想到
        rememberTitles(
          response.results.slice(0, 12).map((item) => item.title),
          1
        );
      } else {
        setError("没有找到相关内容");
      }
    } catch (err) {
      setError("搜索失败，请稍后重试。");
      logger.info("Search failed:", err);
    } finally {
      setLoading(false);
    }
  };

  const onSearchPress = () => handleSearch();

  /** 点联想词：填回输入框、收起候选、直接搜 */
  const handlePickSuggestion = (title: string) => {
    applyKeyword(title);
    setSuggestions([]);
    rememberTitles([title], 2);
    void handleSearch(title);
  };

  const handleQrPress = () => {
    if (!remoteInputEnabled) {
      Alert.alert("远程输入未启用", "请先在设置页面中启用远程输入功能", [
        { text: "取消", style: "cancel" },
        { text: "去设置", onPress: () => router.push("/settings") },
      ]);
      return;
    }
    showRemoteModal('search');
  };

  const renderItem = ({ item }: { item: SearchResult; index: number }) => (
    <VideoCard
      id={item.id.toString()}
      source={item.source}
      title={item.title}
      poster={item.poster}
      year={item.year}
      sourceName={item.source_name}
      api={api}
    />
  );

  // 动态样式
  const dynamicStyles = createResponsiveStyles(deviceType, spacing);

  const renderSearchContent = () => (
    <>
      <View style={dynamicStyles.searchContainer}>
        <TouchableOpacity
          activeOpacity={1}
          style={[
            dynamicStyles.inputContainer,
            {
              borderColor: isInputFocused ? Colors.dark.primary : "transparent",
            },
          ]}
          onPress={() => textInputRef.current?.focus()}
        >
          <TextInput
            ref={textInputRef}
            nativeID="search-keyword-input"
            style={dynamicStyles.input}
            placeholder="搜索电影、剧集..."
            placeholderTextColor="#888"
            defaultValue=""
            onChangeText={setKeyword}
            onSubmitEditing={onSearchPress}
            onFocus={() => setIsInputFocused(true)}
            onBlur={() => setIsInputFocused(false)}
            onLayout={() => {
              // 拿到原生 tag，联想行才能通过 nextFocusUp 指回输入框
              const tag = findNodeHandle(textInputRef.current);
              if (tag && tag !== inputNativeTag) setInputNativeTag(tag);
            }}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
          />
        </TouchableOpacity>
        <StyledButton style={dynamicStyles.searchButton} onPress={onSearchPress}>
          <Search size={deviceType === 'mobile' ? 20 : 24} color="white" />
        </StyledButton>
        {deviceType !== 'mobile' && (
          <StyledButton style={dynamicStyles.qrButton} onPress={handleQrPress}>
            <QrCode size={deviceType === 'tv' ? 24 : 20} color="white" />
          </StyledButton>
        )}
      </View>

      {/* 首字母联想：只是候选，不抢输入焦点，也不改用户已经敲进去的内容 */}
      {suggestions.length > 0 && (
        <View style={dynamicStyles.suggestPanel}>
          <View style={dynamicStyles.suggestHead}>
            <ThemedText style={dynamicStyles.suggestTitle}>
              {keyword.trim() ? "猜你想搜" : "热门推荐"}
            </ThemedText>
            {deviceType !== 'mobile' && (
              <ThemedText style={dynamicStyles.suggestTip}>
                按 ↓ 选词 · 按 ↑ 回输入框
              </ThemedText>
            )}
          </View>
          {suggestions.map((item) => (
            <Pressable
              key={item.title}
              focusable
              nextFocusUp={inputNativeTag ?? undefined}
              onPress={() => handlePickSuggestion(item.title)}
              style={({ focused }: { focused?: boolean }) => [
                dynamicStyles.suggestRow,
                focused && dynamicStyles.suggestRowFocused,
              ]}
            >
              <Search size={deviceType === 'mobile' ? 14 : 18} color="#8b93a1" />
              <ThemedText style={dynamicStyles.suggestText} numberOfLines={1}>
                {item.title}
              </ThemedText>
            </Pressable>
          ))}
        </View>
      )}

      {keyword.trim().length > 0 && suggestions.length === 0 && deviceType !== 'mobile' && (
        <ThemedText style={dynamicStyles.suggestEmpty}>
          没匹配到剧名，直接输入中文即可搜索；也可点右上角二维码用手机输入
        </ThemedText>
      )}

      {loading ? (
        <VideoLoadingAnimation showProgressBar={false} />
      ) : error ? (
        <View style={[commonStyles.center, { flex: 1 }]}>
          <ThemedText style={dynamicStyles.errorText}>{error}</ThemedText>
        </View>
      ) : (
        <CustomScrollView
          data={results}
          renderItem={renderItem}
          loading={loading}
          error={error}
          emptyMessage="输入关键词开始搜索"
        />
      )}
    </>
  );

  const content = (
    <ThemedView style={[commonStyles.container, dynamicStyles.container]}>
      {renderSearchContent()}
    </ThemedView>
  );

  // 根据设备类型决定是否包装在响应式导航中
  if (deviceType === 'tv') {
    return content;
  }

  return (
    <ResponsiveNavigation>
      <ResponsiveHeader title="搜索" showBackButton />
      {content}
    </ResponsiveNavigation>
  );
}

const createResponsiveStyles = (deviceType: string, spacing: number) => {
  const isMobile = deviceType === 'mobile';
  const minTouchTarget = DeviceUtils.getMinTouchTargetSize();

  return StyleSheet.create({
    container: {
      flex: 1,
      paddingTop: deviceType === 'tv' ? 50 : 0,
    },
    searchContainer: {
      flexDirection: "row",
      paddingHorizontal: spacing,
      marginBottom: spacing,
      alignItems: "center",
      paddingTop: isMobile ? spacing / 2 : 0,
    },
    inputContainer: {
      flex: 1,
      height: isMobile ? minTouchTarget : 50,
      backgroundColor: "#2c2c2e",
      borderRadius: isMobile ? 8 : 8,
      marginRight: spacing / 2,
      borderWidth: 2,
      borderColor: "transparent",
      justifyContent: "center",
    },
    input: {
      flex: 1,
      paddingHorizontal: spacing,
      color: "white",
      fontSize: isMobile ? 16 : 18,
    },
    searchButton: {
      width: isMobile ? minTouchTarget : 50,
      height: isMobile ? minTouchTarget : 50,
      justifyContent: "center",
      alignItems: "center",
      borderRadius: isMobile ? 8 : 8,
      marginRight: deviceType !== 'mobile' ? spacing / 2 : 0,
    },
    qrButton: {
      width: isMobile ? minTouchTarget : 50,
      height: isMobile ? minTouchTarget : 50,
      justifyContent: "center",
      alignItems: "center",
      borderRadius: isMobile ? 8 : 8,
    },
    errorText: {
      color: "red",
      fontSize: isMobile ? 14 : 16,
      textAlign: "center",
    },
    // 联想候选：和搜索框同宽，纵向排列，遥控器可按方向键进入
    suggestPanel: {
      marginHorizontal: spacing,
      marginBottom: spacing,
      paddingVertical: 8,
      paddingHorizontal: 10,
      borderRadius: 10,
      backgroundColor: "rgba(255,255,255,0.05)",
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.08)",
    },
    suggestHead: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 4,
      paddingHorizontal: 4,
    },
    suggestTitle: {
      color: "rgba(255,255,255,0.45)",
      fontSize: isMobile ? 11 : 13,
    },
    suggestTip: {
      color: "rgba(255,255,255,0.28)",
      fontSize: 12,
    },
    suggestRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      height: isMobile ? 38 : 46,
      paddingHorizontal: 8,
      borderRadius: 8,
      borderWidth: 2,
      borderColor: "transparent",
    },
    suggestRowFocused: {
      borderColor: "white",
      backgroundColor: "rgba(255,255,255,0.12)",
    },
    suggestText: {
      color: "#e8eaed",
      fontSize: isMobile ? 15 : 18,
      flexShrink: 1,
    },
    suggestEmpty: {
      marginHorizontal: spacing,
      marginBottom: spacing,
      marginTop: -spacing / 2,
      color: "rgba(255,255,255,0.4)",
      fontSize: isMobile ? 12 : 14,
    },
  });
};
