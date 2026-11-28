import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  View,
  TextInput,
  StyleSheet,
  Alert,
  BackHandler,
  Keyboard,
  Modal,
  TouchableOpacity,
  Pressable,
  findNodeHandle,
  useWindowDimensions,
} from "react-native";
import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import VideoCard from "@/components/VideoCard";
import VideoLoadingAnimation from "@/components/VideoLoadingAnimation";
import { api, ApiError, SearchResult } from "@/services/api";
import { Search, QrCode, Keyboard as KeyboardIcon, ArrowLeft, X } from "lucide-react-native";
import { StyledButton } from "@/components/StyledButton";
import { useRemoteControlStore } from "@/stores/remoteControlStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useRouter } from "expo-router";
import { Colors } from "@/constants/Colors";
import Toast from "react-native-toast-message";
import CustomScrollView from "@/components/CustomScrollView";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";
import { getCommonResponsiveStyles } from "@/utils/ResponsiveStyles";
import ResponsiveNavigation from "@/components/navigation/ResponsiveNavigation";
import ResponsiveHeader from "@/components/navigation/ResponsiveHeader";
import { DeviceUtils } from "@/utils/DeviceUtils";
import SearchKeyboard from "@/components/SearchKeyboard";
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
  /** 电视端：是否已进入「搜索结果」视图（进入后键盘区收起） */
  const [showResult, setShowResult] = useState(false);
  /** 实际发起搜索用的词，用于结果页标题 */
  const [searchTerm, setSearchTerm] = useState("");
  /** 方案一的兜底：系统输入法弹窗 */
  const [systemInputVisible, setSystemInputVisible] = useState(false);

  const textInputRef = useRef<TextInput>(null);
  const systemInputRef = useRef<TextInput>(null);
  /** 键盘图标按钮：弹窗关掉后把焦点还给它，否则电视上会「焦点消失」 */
  const keyboardIconRef = useRef<View>(null);
  /** 输入框的原生 tag：手机端联想行的 nextFocusUp 指回它（电视端不再依赖这个） */
  const [inputNativeTag, setInputNativeTag] = useState<number | null>(null);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const { showModal: showRemoteModal, lastMessage, targetPage, clearMessage } = useRemoteControlStore();
  const { remoteInputEnabled } = useSettingsStore();
  const router = useRouter();
  const { height } = useWindowDimensions();

  /**
   * 回填搜索框文字（手机端 / 远程输入用）。
   *
   * 手机端输入框是**非受控**的（只给 defaultValue，不给 value），原因：
   * 受控输入框 + 中文输入法在安卓上会打架 —— 每次 setState 都带着旧的 value 重渲染，
   * 输入法的组词会被打断或丢字。
   * 电视端没有输入法参与（字母键盘自己管），所以不受这个限制。
   */
  const applyKeyword = useCallback((text: string) => {
    setKeyword(text);
    textInputRef.current?.setNativeProps({ text });
  }, []);

  // 响应式布局配置
  const responsiveConfig = useResponsiveLayout();
  const commonStyles = getCommonResponsiveStyles(responsiveConfig);
  const { deviceType, spacing } = responsiveConfig;
  const isTV = deviceType === "tv";

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

  /**
   * 词库预热。
   *
   * 内置种子是分批灌的（600 条一批），每批结束都会回调一次，
   * 页面据此重算候选 —— 用户看到的是候选越输越多，而不是开场卡住不动。
   */
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      if (!cancelled) setSuggestVersion((v) => v + 1);
    };
    ensureSuggestIndex(false, refresh)
      .then(refresh)
      .catch(() => {
        /* 词库拉取失败不影响搜索本身 */
      });
    const timers = [600, 2400].map((delay) => setTimeout(refresh, delay));
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, []);

  /**
   * 关键词变化就重算候选。
   *
   * 这里刻意只读不写：不 setKeyword、不动焦点、不阻塞输入。
   * 电视端 keyword 是用户点出来的拼音串，手机端是输入法打的中文，两种都走这一个入口：
   * 纯字母按首字母 + 全拼前缀匹配，中文按标题包含匹配。
   */
  useEffect(() => {
    const q = keyword.trim();
    if (!q) {
      // 还没输入时给「热门推荐」：搜索页一进来就能看到联想确实在
      setSuggestions(deviceType === "mobile" ? [] : hotTitles(isTV ? 6 : 4));
      return;
    }
    setSuggestions(suggestTitles(q, isTV ? 8 : 4));
  }, [keyword, suggestVersion, deviceType, isTV]);

  const handleSearch = async (searchText?: string) => {
    const term = typeof searchText === "string" ? searchText : keyword;
    if (!term.trim()) {
      Keyboard.dismiss();
      return;
    }
    Keyboard.dismiss();
    setLoading(true);
    setError(null);
    setShowResult(true);
    setSearchTerm(term);
    const startedAt = Date.now();
    try {
      const response = await api.searchVideos(term);
      const cost = Date.now() - startedAt;
      logger.info(`[SEARCH] "${term}" hit ${response.results.length} in ${cost}ms`);
      if (response.results.length > 0) {
        setResults(response.results);
        // 搜到的标题回填词库，下次打首字母就能联想到
        rememberTitles(
          response.results.slice(0, 12).map((item) => item.title),
          1
        );
      } else {
        setResults([]);
        setError("没有找到相关内容");
      }
    } catch (err) {
      const cost = Date.now() - startedAt;
      setResults([]);
      // 超时和「接口报错」是两回事：前者再点一次往往就过了，后者要查服务端
      const isTimeout = err instanceof ApiError && err.kind === "timeout";
      setError(
        isTimeout ? "网络较慢，搜索超时了。稍等片刻再点一次，或换个关键词。" : "搜索失败，请稍后重试。"
      );
      logger.info(`[SEARCH] "${term}" failed after ${cost}ms:`, err);
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

  /** 电视端：字母键输入 */
  const handleKey = useCallback((ch: string) => {
    setKeyword((prev) => (prev.length >= 24 ? prev : prev + ch.toLowerCase()));
  }, []);

  const handleBackspace = useCallback(() => {
    setKeyword((prev) => prev.slice(0, -1));
  }, []);

  const handleClear = useCallback(() => {
    setKeyword("");
  }, []);

  /**
   * 电视端「搜索」键：
   * 有候选就用最匹配的那部片去搜（用户点了半天字母，意图就是它）；
   * 没有候选就提示换招，别让他对着空结果发呆。
   */
  const handleTVSubmit = useCallback(() => {
    const q = keyword.trim();
    if (!q) return;
    const best = suggestions[0];
    if (best) {
      rememberTitles([best.title], 2);
      void handleSearch(best.title);
      return;
    }
    if (/[\u4e00-\u9fa5]/.test(q)) {
      void handleSearch(q);
      return;
    }
    // 不弹 Alert：TV 上的原生对话框焦点容易丢，改用 Toast，视线不动就能看到
    Toast.show({
      type: "info",
      text1: "词库里没有这部片子",
      text2: "点右上角键盘图标可用系统输入法打中文",
      visibilityTime: 3500,
    });
  }, [keyword, suggestions]);

  // 结果页按遥控器返回键应该回到键盘，而不是直接退出搜索页
  useEffect(() => {
    if (!isTV || !showResult) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setShowResult(false);
      setResults([]);
      setError(null);
      setKeyword("");
      setSearchTerm("");
      return true;
    });
    return () => sub.remove();
  }, [isTV, showResult]);

  /** 从结果页回到键盘 */
  const handleBackToKeyboard = useCallback(() => {
    setShowResult(false);
    setResults([]);
    setError(null);
    setKeyword("");
    setSearchTerm("");
  }, []);

  /**
   * 关掉系统输入法弹窗。
   * 弹窗的 Dialog 窗口一销毁，焦点就没主了（电视上表现为「整个页面没有高亮」），
   * 所以主动把焦点送回键盘图标按钮。
   */
  const closeSystemInput = useCallback(() => {
    setSystemInputVisible(false);
    [120, 460].forEach((delay) =>
      setTimeout(() => {
        const node = keyboardIconRef.current as any;
        if (!node?.setNativeProps) return;
        node.setNativeProps({ hasTVPreferredFocus: false });
        requestAnimationFrame(() => {
          (keyboardIconRef.current as any)?.setNativeProps?.({ hasTVPreferredFocus: true });
        });
      }, delay)
    );
  }, []);

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
  const dynamicStyles = createResponsiveStyles(deviceType, spacing, height);

  /* ------------------------------------------------------------------ *
   * 手机 / 平板：保持原来的系统输入法输入
   * ------------------------------------------------------------------ */
  const renderMobileContent = () => (
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

      {suggestions.length > 0 && (
        <View style={dynamicStyles.suggestPanel}>
          <View style={dynamicStyles.suggestHead}>
            <ThemedText style={dynamicStyles.suggestTitle}>
              {keyword.trim() ? "猜你想搜" : "热门推荐"}
            </ThemedText>
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

  /* ------------------------------------------------------------------ *
   * 电视：字母键盘 + 右侧实时候选
   * ------------------------------------------------------------------ */
  const renderTVResult = () => (
    <>
      <View style={dynamicStyles.tvResultHeader}>
        <Pressable
          focusable
          onPress={handleBackToKeyboard}
          // 进结果页时焦点落在「重新搜索」上，遥控器按确认就能回去改词
          {...({ hasTVPreferredFocus: true } as any)}
          style={({ focused }: { focused?: boolean }) => [
            dynamicStyles.tvBackButton,
            focused && dynamicStyles.tvBackButtonFocused,
          ]}
        >
          <ArrowLeft color="white" size={24} />
          <ThemedText style={dynamicStyles.tvBackText}>重新搜索</ThemedText>
        </Pressable>

        <ThemedText style={dynamicStyles.tvResultTitle} numberOfLines={1}>
          「{searchTerm}」的结果
          {!loading && results.length > 0 ? ` · ${results.length} 部` : ""}
        </ThemedText>
      </View>

      {loading ? (
        <VideoLoadingAnimation showProgressBar={false} />
      ) : error ? (
        <View style={[commonStyles.center, { flex: 1 }]}>
          <ThemedText style={dynamicStyles.errorText}>{error}</ThemedText>
          <ThemedText style={dynamicStyles.tvEmptyHint}>
            换个说法再试，或者只输首字母（如 psjy 找「破事精英」）
          </ThemedText>
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

  const renderTVKeyboard = () => (
    <>
      <View style={dynamicStyles.tvHeader}>
        <View style={dynamicStyles.tvDisplay}>
          {keyword ? (
            <ThemedText style={dynamicStyles.tvDisplayText} numberOfLines={1}>
              {keyword}
            </ThemedText>
          ) : (
            <ThemedText style={dynamicStyles.tvPlaceholder}>点字母拼拼音，或输首字母</ThemedText>
          )}
          <View style={dynamicStyles.tvCaret} />
          <View style={{ flex: 1 }} />
          {keyword ? (
            <ThemedText style={dynamicStyles.tvCandidateCount}>
              {suggestions.length > 0 ? `${suggestions.length} 个候选` : "无匹配"}
            </ThemedText>
          ) : null}
        </View>

        {/* 方案一的后门：词库里没有的片子，还能退回系统输入法 */}
        <Pressable
          ref={keyboardIconRef}
          focusable
          onPress={() => setSystemInputVisible(true)}
          style={({ focused }: { focused?: boolean }) => [
            dynamicStyles.tvIconButton,
            focused && dynamicStyles.tvIconButtonFocused,
          ]}
        >
          <KeyboardIcon color="white" size={26} />
        </Pressable>

        <Pressable
          focusable
          onPress={handleQrPress}
          style={({ focused }: { focused?: boolean }) => [
            dynamicStyles.tvIconButton,
            focused && dynamicStyles.tvIconButtonFocused,
          ]}
        >
          <QrCode color="white" size={26} />
        </Pressable>
      </View>

      <View style={dynamicStyles.tvBody}>
        <View style={dynamicStyles.tvKeyboardCol}>
          <SearchKeyboard
            onKey={handleKey}
            onBackspace={handleBackspace}
            onClear={handleClear}
            onSubmit={handleTVSubmit}
            autoFocus
          />
        </View>

        <View style={dynamicStyles.tvSuggestCol}>
          <ThemedText style={dynamicStyles.tvSuggestHead}>
            {keyword.trim()
              ? suggestions.length > 0
                ? "猜你想搜"
                : "没有匹配的剧名"
              : "热门搜索"}
          </ThemedText>

          <View style={dynamicStyles.tvSuggestList}>
            {suggestions.map((item) => (
              <Pressable
                key={item.title}
                focusable
                onPress={() => handlePickSuggestion(item.title)}
                style={({ focused }: { focused?: boolean }) => [
                  dynamicStyles.tvSuggestRow,
                  focused && dynamicStyles.tvSuggestRowFocused,
                ]}
              >
                <ThemedText style={dynamicStyles.tvSuggestText} numberOfLines={1}>
                  {item.title}
                </ThemedText>
              </Pressable>
            ))}

            {keyword.trim() && suggestions.length === 0 ? (
              <View style={dynamicStyles.tvEmptyBox}>
                <ThemedText style={dynamicStyles.tvEmptyText}>
                  这个词不在离线词库里。可以点右上角键盘图标用系统输入法打中文，
                  或者用手机扫码输入。
                </ThemedText>
              </View>
            ) : null}
          </View>
        </View>
      </View>

      <ThemedText style={dynamicStyles.tvFooterHint}>
        方向键移动 · 确认键输入 / 选词 · 返回键删一个字
      </ThemedText>
    </>
  );

  const content = (
    <ThemedView style={[commonStyles.container, dynamicStyles.container]}>
      {isTV ? (showResult ? renderTVResult() : renderTVKeyboard()) : renderMobileContent()}
    </ThemedView>
  );

  // 根据设备类型决定是否包装在响应式导航中
  if (deviceType === 'tv') {
    return (
      <>
        {content}
        <SystemInputModal
          visible={systemInputVisible}
          inputRef={systemInputRef}
          onClose={closeSystemInput}
          onSubmit={(text) => {
            setSystemInputVisible(false);
            applyKeyword(text);
            void handleSearch(text);
          }}
        />
      </>
    );
  }

  return (
    <ResponsiveNavigation>
      <ResponsiveHeader title="搜索" showBackButton />
      {content}
    </ResponsiveNavigation>
  );
}

/**
 * 系统输入法兜底弹窗（方案一）。
 *
 * 只在用户主动点键盘图标时出现，平时完全不影响字母键盘的焦点链。
 * 单独开一个 Modal，输完关掉，主页面焦点回到键盘，不会留下"焦点不知道跑哪去了"的状态。
 *
 * 输入框刻意做成**非受控**：受控 TextInput 在安卓上每敲一个字都带着旧 value 重渲染，
 * 中文输入法的组词会被打断 —— 这正是老版本「有候选时中文打不进去」的根因。
 * 这里文字只存在 draftRef 里，程序不改写它。
 */
const SystemInputModal: React.FC<{
  visible: boolean;
  inputRef: React.RefObject<TextInput>;
  onClose: () => void;
  onSubmit: (text: string) => void;
}> = ({ visible, inputRef, onClose, onSubmit }) => {
  const draftRef = useRef("");

  useEffect(() => {
    if (!visible) return;
    draftRef.current = "";
    // 打开时清空并聚焦；Dialog 刚创建时 focus 会被吞，多试几轮
    const timers = [90, 420, 900].map((delay) =>
      setTimeout(() => {
        inputRef.current?.setNativeProps?.({ text: "" });
        inputRef.current?.focus?.();
      }, delay)
    );
    return () => timers.forEach(clearTimeout);
  }, [visible, inputRef]);

  const submit = () => {
    const text = draftRef.current.trim();
    if (text) onSubmit(text);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={modalStyles.overlay}>
        <View style={modalStyles.card}>
          <View style={modalStyles.header}>
            <ThemedText style={modalStyles.title}>用系统输入法搜索</ThemedText>
            <Pressable
              focusable
              onPress={onClose}
              style={({ focused }: { focused?: boolean }) => [
                modalStyles.iconButton,
                focused && modalStyles.iconButtonFocused,
              ]}
            >
              <X color="white" size={22} />
            </Pressable>
          </View>

          <ThemedText style={modalStyles.hint}>
            打中文全名，按确认键直接搜。词库里没有的片子走这条路。
          </ThemedText>

          <TextInput
            ref={inputRef}
            style={modalStyles.input}
            defaultValue=""
            onChangeText={(text) => {
              draftRef.current = text;
            }}
            placeholder="输入片名..."
            placeholderTextColor="#77777f"
            returnKeyType="search"
            onSubmitEditing={submit}
            selectTextOnFocus
            autoCorrect={false}
            autoCapitalize="none"
          />

          <Pressable
            focusable
            onPress={submit}
            style={({ focused }: { focused?: boolean }) => [
              modalStyles.submit,
              focused && modalStyles.submitFocused,
            ]}
          >
            <ThemedText style={modalStyles.submitText}>搜索</ThemedText>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
};

const modalStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.72)",
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    width: 660,
    maxWidth: "86%",
    backgroundColor: "#17191e",
    borderRadius: 16,
    padding: 28,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#fff",
    flex: 1,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "transparent",
  },
  iconButtonFocused: {
    borderColor: "#fff",
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  hint: {
    fontSize: 15,
    color: "rgba(255,255,255,0.5)",
    marginBottom: 16,
  },
  input: {
    height: 64,
    borderRadius: 10,
    backgroundColor: "#22262e",
    borderWidth: 2,
    borderColor: "#3d4453",
    paddingHorizontal: 18,
    fontSize: 24,
    color: "#fff",
  },
  submit: {
    marginTop: 18,
    height: 62,
    borderRadius: 10,
    backgroundColor: Colors.dark.primary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "transparent",
  },
  submitFocused: {
    borderColor: "#fff",
    backgroundColor: "#3b82f6",
  },
  submitText: {
    fontSize: 22,
    fontWeight: "700",
    color: "#fff",
  },
});

const createResponsiveStyles = (deviceType: string, spacing: number, screenHeight: number) => {
  const isMobile = deviceType === 'mobile';
  const isTV = deviceType === 'tv';
  const minTouchTarget = DeviceUtils.getMinTouchTargetSize();

  // 电视端尺寸跟着屏幕高度走，1080p 和 720p 都不会挤成一团
  const tvRowHeight = Math.max(46, Math.min(screenHeight * 0.062, 68));
  const tvSuggestFont = Math.max(18, Math.min(tvRowHeight * 0.44, 28));

  return StyleSheet.create({
    container: {
      flex: 1,
      paddingTop: isTV ? 36 : 0,
    },

    /* ---------- 手机 / 平板 ---------- */
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
      borderRadius: 8,
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
      borderRadius: 8,
      marginRight: deviceType !== 'mobile' ? spacing / 2 : 0,
    },
    qrButton: {
      width: isMobile ? minTouchTarget : 50,
      height: isMobile ? minTouchTarget : 50,
      justifyContent: "center",
      alignItems: "center",
      borderRadius: 8,
    },
    errorText: {
      color: "red",
      fontSize: isMobile ? 14 : 16,
      textAlign: "center",
    },
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

    /* ---------- 电视：键盘 + 候选 ---------- */
    tvHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      paddingHorizontal: 40,
      paddingBottom: 18,
    },
    tvDisplay: {
      flex: 1,
      height: 76,
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: "#141820",
      borderWidth: 2,
      borderColor: "#2d3542",
      borderRadius: 12,
      paddingHorizontal: 22,
    },
    tvDisplayText: {
      fontSize: 32,
      color: "#ffffff",
      letterSpacing: 2,
    },
    tvPlaceholder: {
      fontSize: 26,
      color: "#586170",
    },
    tvCaret: {
      width: 3,
      height: 34,
      backgroundColor: Colors.dark.primary,
      marginLeft: 3,
    },
    tvCandidateCount: {
      fontSize: 18,
      color: "#6b7482",
    },
    tvIconButton: {
      width: 76,
      height: 76,
      borderRadius: 12,
      backgroundColor: "rgba(255,255,255,0.06)",
      borderWidth: 2,
      borderColor: "rgba(255,255,255,0.08)",
      alignItems: "center",
      justifyContent: "center",
    },
    tvIconButtonFocused: {
      borderColor: "#ffffff",
      backgroundColor: "rgba(77,159,255,0.28)",
    },
    tvBody: {
      flex: 1,
      flexDirection: "row",
      gap: 34,
      paddingHorizontal: 40,
      paddingTop: 6,
    },
    tvKeyboardCol: {
      flex: 46,
      maxWidth: 900,
    },
    tvSuggestCol: {
      flex: 54,
      minWidth: 0,
    },
    tvSuggestHead: {
      fontSize: 20,
      color: "rgba(255,255,255,0.45)",
      marginBottom: 10,
      marginLeft: 4,
    },
    tvSuggestList: {
      flex: 1,
    },
    tvSuggestRow: {
      height: tvRowHeight,
      justifyContent: "center",
      paddingHorizontal: 18,
      marginBottom: 8,
      borderRadius: 10,
      borderWidth: 2,
      borderColor: "transparent",
    },
    tvSuggestRowFocused: {
      borderColor: "#ffffff",
      backgroundColor: "rgba(255,255,255,0.08)",
    },
    tvSuggestText: {
      fontSize: tvSuggestFont,
      color: "#e8eaed",
    },
    tvEmptyBox: {
      paddingHorizontal: 18,
      paddingTop: 6,
    },
    tvEmptyText: {
      fontSize: 19,
      lineHeight: 32,
      color: "rgba(255,255,255,0.42)",
    },
    tvFooterHint: {
      fontSize: 17,
      color: "rgba(255,255,255,0.28)",
      paddingHorizontal: 42,
      paddingVertical: 12,
    },
    tvResultHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 20,
      paddingHorizontal: 40,
      paddingBottom: 16,
    },
    tvBackButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      height: 62,
      paddingHorizontal: 22,
      borderRadius: 10,
      borderWidth: 2,
      borderColor: "rgba(255,255,255,0.1)",
      backgroundColor: "rgba(255,255,255,0.06)",
    },
    tvBackButtonFocused: {
      borderColor: "#ffffff",
      backgroundColor: "rgba(77,159,255,0.28)",
    },
    tvBackText: {
      fontSize: 22,
      color: "#ffffff",
    },
    tvResultTitle: {
      flex: 1,
      fontSize: 24,
      color: "rgba(255,255,255,0.62)",
    },
    tvEmptyHint: {
      marginTop: 12,
      fontSize: 18,
      color: "rgba(255,255,255,0.4)",
      textAlign: "center",
    },
  });
};
