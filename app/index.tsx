import React, { useEffect, useCallback, useRef, useState } from "react";
import { View, StyleSheet, ActivityIndicator, FlatList, Pressable, Animated, StatusBar, Platform, BackHandler, ToastAndroid } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ThemedText } from "@/components/ThemedText";
import { api } from "@/services/api";
import VideoCard from "@/components/VideoCard";
import { useFocusEffect, useRouter } from "expo-router";
import { Search, Settings, Users, Heart } from "lucide-react-native";
import useHomeStore, { RowItem, Category } from "@/stores/homeStore";
import { useUserStore } from "@/stores/userStore";
import CustomScrollView from "@/components/CustomScrollView";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";
import { getCommonResponsiveStyles } from "@/utils/ResponsiveStyles";
import ResponsiveNavigation from "@/components/navigation/ResponsiveNavigation";
import { useApiConfig, getApiConfigErrorMessage } from "@/hooks/useApiConfig";
import { AmbientBackground } from "@/components/AmbientBackground";
import { CategoryChip } from "@/components/CategoryChip";
import { useButtonAnimation } from "@/hooks/useAnimation";

const LOAD_MORE_THRESHOLD = 200;

/**
 * 顶部图标按钮（收藏 / 搜索 / 设置 / 账户）。
 *
 * 原来直接复用 StyledButton ghost，焦点态是「灰底 + 绿描边」，在深色壁纸上
 * 显得脏。改成玻璃圆底：静态 7% 白，焦点时翻成白色实底、图标转深色 ——
 * 和分类胶囊的选中逻辑一致，整屏只有一套视觉语言。
 */
const HeaderIconButton: React.FC<{
  onPress: () => void;
  children: (color: string) => React.ReactNode;
}> = ({ onPress, children }) => {
  const [focused, setFocused] = useState(false);
  const animationStyle = useButtonAnimation(focused, 1.08);

  return (
    <Animated.View style={[animationStyle, { zIndex: focused ? 10 : 1 }]}>
      <Pressable
        focusable
        onPress={onPress}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[headerButtonStyles.button, focused && headerButtonStyles.buttonFocused]}
      >
        {children(focused ? "#0A0D14" : "rgba(255,255,255,0.86)")}
      </Pressable>
    </Animated.View>
  );
};

const headerButtonStyles = StyleSheet.create({
  button: {
    width: 44,
    height: 44,
    borderRadius: 22,
    marginLeft: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  buttonFocused: {
    backgroundColor: "#F2F5F8",
    borderColor: "#FFFFFF",
    shadowColor: "#7FB6FF",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 14,
    elevation: 8,
  },
});

export default function HomeScreen() {
  const router = useRouter();
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const insets = useSafeAreaInsets();

  // 响应式布局配置
  const responsiveConfig = useResponsiveLayout();
  const commonStyles = getCommonResponsiveStyles(responsiveConfig);
  const { deviceType, spacing } = responsiveConfig;

  const {
    categories,
    selectedCategory,
    contentData,
    loading,
    loadingMore,
    error,
    fetchInitialData,
    loadMoreData,
    selectCategory,
    refreshPlayRecords,
    clearError,
  } = useHomeStore();
  const openUserModal = useUserStore((state) => state.open);
  const apiConfigStatus = useApiConfig();

  useFocusEffect(
    useCallback(() => {
      refreshPlayRecords();
    }, [refreshPlayRecords])
  );

    // 双击返回退出逻辑（只限当前页面）
  const backPressTimeRef = useRef<number | null>(null);

  useFocusEffect(
    useCallback(() => {
    const handleBackPress = () => {
      const now = Date.now();

      // 如果还没按过返回键，或距离上次超过2秒
      if (!backPressTimeRef.current || now - backPressTimeRef.current > 2000) {
        backPressTimeRef.current = now;
        ToastAndroid.show("再按一次返回键退出", ToastAndroid.SHORT);
        return true; // 拦截返回事件，不退出
      }

      // 两次返回键间隔小于2秒，退出应用
      BackHandler.exitApp();
      return true;
    };

    // 仅限 Android 平台启用此功能
    if (Platform.OS === "android") {
      const backHandler = BackHandler.addEventListener("hardwareBackPress", handleBackPress);

      // 返回首页时重置状态
      return () => {
        backHandler.remove();
        backPressTimeRef.current = null;
      };
    }
  }, [])
);

  // 统一的数据获取逻辑
  useEffect(() => {
    if (!selectedCategory) return;

    // 如果是容器分类且没有选择标签，设置默认标签
    if (selectedCategory.tags && !selectedCategory.tag) {
      const defaultTag = selectedCategory.tags[0];
      setSelectedTag(defaultTag);
      selectCategory({ ...selectedCategory, tag: defaultTag });
      return;
    }

    // 只有在API配置完成且分类有效时才获取数据
    if (apiConfigStatus.isConfigured && !apiConfigStatus.needsConfiguration) {
      // 对于有标签的分类，需要确保有标签才获取数据
      if (selectedCategory.tags && selectedCategory.tag) {
        fetchInitialData();
      }
      // 对于无标签的分类，直接获取数据
      else if (!selectedCategory.tags) {
        fetchInitialData();
      }
    }
  }, [
    selectedCategory,
    selectedCategory?.tag,
    apiConfigStatus.isConfigured,
    apiConfigStatus.needsConfiguration,
    fetchInitialData,
    selectCategory,
  ]);

  // 清除错误状态的逻辑
  useEffect(() => {
    if (apiConfigStatus.needsConfiguration && error) {
      clearError();
    }
  }, [apiConfigStatus.needsConfiguration, error, clearError]);

  useEffect(() => {
    if (!loading && contentData.length > 0) {
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();
    } else if (loading) {
      fadeAnim.setValue(0);
    }
  }, [loading, contentData.length, fadeAnim]);

  const handleCategorySelect = (category: Category) => {
    setSelectedTag(null);
    selectCategory(category);
  };

  const handleTagSelect = (tag: string) => {
    setSelectedTag(tag);
    if (selectedCategory) {
      const categoryWithTag = { ...selectedCategory, tag: tag };
      selectCategory(categoryWithTag);
    }
  };

  const renderCategory = ({ item }: { item: Category }) => {
    const isSelected = selectedCategory?.title === item.title;
    return (
      <CategoryChip
        label={item.title}
        selected={isSelected}
        onPress={() => handleCategorySelect(item)}
        style={dynamicStyles.categoryButton}
      />
    );
  };

  const renderContentItem = ({ item }: { item: RowItem; index: number }) => (
    <VideoCard
      id={item.id}
      source={item.source}
      title={item.title}
      poster={item.poster}
      year={item.year}
      rate={item.rate}
      progress={item.progress}
      playTime={item.play_time}
      episodeIndex={item.episodeIndex}
      sourceName={item.sourceName}
      totalEpisodes={item.totalEpisodes}
      api={api}
      onRecordDeleted={fetchInitialData}
    />
  );

  const renderFooter = () => {
    if (!loadingMore) return null;
    return <ActivityIndicator style={{ marginVertical: 20 }} size="large" />;
  };

  // 检查是否需要显示API配置提示
  const shouldShowApiConfig = apiConfigStatus.needsConfiguration && selectedCategory && !selectedCategory.tags;

  // TV端和平板端的顶部导航
  const renderHeader = () => {
    if (deviceType === "mobile") {
      // 移动端不显示顶部导航，使用底部Tab导航
      return null;
    }

    return (
      <View style={dynamicStyles.headerContainer}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <ThemedText style={dynamicStyles.headerTitle}>首页</ThemedText>
        </View>
        <View style={dynamicStyles.rightHeaderButtons}>
          <HeaderIconButton onPress={() => router.push("/favorites")}>
            {(color) => <Heart color={color} size={22} />}
          </HeaderIconButton>
          <HeaderIconButton onPress={() => router.push({ pathname: "/search" })}>
            {(color) => <Search color={color} size={22} />}
          </HeaderIconButton>
          <HeaderIconButton onPress={() => router.push("/settings")}>
            {(color) => <Settings color={color} size={22} />}
          </HeaderIconButton>
          <HeaderIconButton onPress={openUserModal}>
            {(color) => <Users color={color} size={22} />}
          </HeaderIconButton>
        </View>
      </View>
    );
  };

  // 动态样式
  const dynamicStyles = StyleSheet.create({
    container: {
      flex: 1,
      paddingTop: deviceType === "mobile" ? insets.top : deviceType === "tablet" ? insets.top + 20 : 40,
    },
    headerContainer: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: spacing * 1.5,
      marginBottom: spacing,
    },
    headerTitle: {
      fontSize: deviceType === "mobile" ? 24 : deviceType === "tablet" ? 28 : 30,
      fontWeight: "700",
      letterSpacing: 1.2,
      paddingTop: 12,
      color: "#F4F7FB",
      textShadowColor: "rgba(0,0,0,0.45)",
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 8,
    },
    rightHeaderButtons: {
      flexDirection: "row",
      alignItems: "center",
    },
    categoryContainer: {
      paddingBottom: spacing / 2,
    },
    categoryListContent: {
      paddingHorizontal: spacing,
    },
    categoryButton: {
      marginHorizontal: deviceType === "tv" ? 5 : spacing / 2,
    },
    subCategoryButton: {
      marginHorizontal: 5,
    },
    contentContainer: {
      flex: 1,
    },
  });

  const content = (
    <AmbientBackground style={[commonStyles.container, dynamicStyles.container]}>
      {/* 状态栏 */}
      {deviceType === "mobile" && <StatusBar barStyle="light-content" />}

      {/* 顶部导航 */}
      {renderHeader()}

      {/* 分类选择器 */}
      <View style={dynamicStyles.categoryContainer}>
        <FlatList
          data={categories}
          renderItem={renderCategory}
          keyExtractor={(item) => item.title}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={dynamicStyles.categoryListContent}
        />
      </View>

      {/* 子分类标签 */}
      {selectedCategory && selectedCategory.tags && (
        <View style={dynamicStyles.categoryContainer}>
          <FlatList
            data={selectedCategory.tags}
            renderItem={({ item, index }) => {
              const isSelected = selectedTag === item;
              return (
                <CategoryChip
                  compact
                  hasTVPreferredFocus={index === 0}
                  label={item}
                  selected={isSelected}
                  onPress={() => handleTagSelect(item)}
                  style={dynamicStyles.subCategoryButton}
                />
              );
            }}
            keyExtractor={(item) => item}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={dynamicStyles.categoryListContent}
          />
        </View>
      )}

      {/* 内容网格 */}
      {shouldShowApiConfig ? (
        <View style={commonStyles.center}>
          <ThemedText type="subtitle" style={{ padding: spacing, textAlign: "center" }}>
            {getApiConfigErrorMessage(apiConfigStatus)}
          </ThemedText>
        </View>
      ) : apiConfigStatus.isValidating ? (
        <View style={commonStyles.center}>
          <ActivityIndicator size="large" />
          <ThemedText type="subtitle" style={{ padding: spacing, textAlign: "center" }}>
            正在验证服务器配置...
          </ThemedText>
        </View>
      ) : apiConfigStatus.error && !apiConfigStatus.isValid ? (
        <View style={commonStyles.center}>
          <ThemedText type="subtitle" style={{ padding: spacing, textAlign: "center" }}>
            {apiConfigStatus.error}
          </ThemedText>
        </View>
      ) : loading ? (
        <View style={commonStyles.center}>
          <ActivityIndicator size="large" />
        </View>
      ) : error ? (
        <View style={commonStyles.center}>
          <ThemedText type="subtitle" style={{ padding: spacing }}>
            {error}
          </ThemedText>
        </View>
      ) : (
        <Animated.View style={[dynamicStyles.contentContainer, { opacity: fadeAnim }]}>
          <CustomScrollView
            data={contentData}
            renderItem={renderContentItem}
            loading={loading}
            loadingMore={loadingMore}
            error={error}
            onEndReached={loadMoreData}
            loadMoreThreshold={LOAD_MORE_THRESHOLD}
            emptyMessage={selectedCategory?.tags ? "请选择一个子分类" : "该分类下暂无内容"}
            ListFooterComponent={renderFooter}
          />
        </Animated.View>
      )}
    </AmbientBackground>
  );

  // 根据设备类型决定是否包装在响应式导航中
  if (deviceType === "tv") {
    return content;
  }

  return <ResponsiveNavigation>{content}</ResponsiveNavigation>;
}
