# OrionTV 📺

一个基于 React Native TVOS 和 Expo 构建的播放器，旨在提供流畅的视频观看体验。

> **本仓库说明**
>
> 这是基于上游 [orion-lib/OrionTV](https://github.com/orion-lib/OrionTV) 的二次修改版本，
> 主要改动：启动时扫描账号 → 连接服务器 → 校验并刷新 → 失败提示；仅保留 Android 平台。
>
> - 版本从 `1.0.0` 起算，改动明细见 [CHANGELOG.md](./CHANGELOG.md)
> - 构建环境与步骤见 [BUILD.md](./BUILD.md)
> - 安装包在 [Releases](../../releases) 页面下载（arm64 / armv7 分开）
>
> 当前支持 Android 6.0 及以上。

## ✨ 功能特性

- **框架跨平台支持**: 同时支持构建 Apple TV 和 Android TV。
- **现代化前端**: 使用 Expo、React Native TVOS 和 TypeScript 构建，性能卓越。
- **Expo Router**: 基于文件系统的路由，使导航逻辑清晰简单。
- **TV 优化的 UI**: 专为电视遥控器交互设计的用户界面。

## 🛠️ 技术栈

- **前端**:
  - [React Native TVOS](https://github.com/react-native-tvos/react-native-tvos)
  - [Expo](https://expo.dev/) (~51.0)
  - [Expo Router](https://docs.expo.dev/router/introduction/)
  - [Expo AV](https://docs.expo.dev/versions/latest/sdk/av/)
  - TypeScript

## 📂 项目结构

本项目采用类似 monorepo 的结构：

```
.
├── app/              # Expo Router 路由和页面
├── assets/           # 静态资源 (字体, 图片, TV 图标)
├── components/       # React 组件
├── constants/        # 应用常量 (颜色, 样式)
├── hooks/            # 自定义 Hooks
├── services/         # 服务层 (API, 存储)
├── package.json      # 前端依赖和脚本
└── ...
```

## 🚀 快速开始

### 环境准备

请确保您的开发环境中已安装以下软件：

- [Node.js](https://nodejs.org/) 18 / 20 (LTS 版本)
- [Yarn](https://yarnpkg.com/) 1.22
- [Android Studio](https://developer.android.com/studio)（含 Android TV 模拟器，或一台可 adb 连接的电视盒子）
- JDK 17

> 当前分支只维护 **Android TV** 链路，不生成 iOS 工程。

### 项目启动

```sh

# 安装依赖
yarn

# [首次运行或依赖更新后] 生成原生工程
# 只生成 android/，并按 app.config.js 写入 minSdkVersion
yarn prebuild

# 运行在 Android TV 模拟器或真机上
yarn android

# 打一个 release APK
yarn build
```

### 启动流程

应用每次启动都会先走一遍账号连接，连接成功后才进入首页：

1. 读取本地保存的服务器地址；没有则停在「去设置服务器」
2. 扫描本机保存的账号（凭据 / 会话 / 缓存）
3. 连接服务器拿 `/api/server-config`
4. 用保存的凭据登录（localstorage 模式直接建会话）
5. 刷新账号数据（收藏、播放记录、首页内容缓存）
6. 任一步连接失败 → 全屏提示「网络连接失败，请检查网络」并提供重试

### Android 最低版本

默认 `minSdkVersion = 21`（Android 5.0 Lollipop），由 `app.config.js` 注入。
需要临时回退到官方下限（API 23 / Android 6.0）时：

```sh
ORION_MIN_SDK=23 yarn prebuild && yarn build
```

> 注意：React Native 0.74 与 Expo SDK 51 官方最低支持到 API 23，API 21 属于
> 兼容层放行（见 `xml/AndroidManifest.xml` 的 `tools:overrideLibrary`），
> 必须在真实 5.0/5.1 电视盒子上验证后再发布。

## 使用

- 1.2.x 以上版本需配合 [MoonTV](https://github.com/senshinya/MoonTV) 使用。


## 📜 主要脚本

- `yarn start`: 以 TV 模式启动 Metro Bundler。
- `yarn android`: 在 Android TV 上构建并运行应用。
- `yarn prebuild`: 生成原生工程（仅 android），并套用 TV 清单配置。
- `yarn build`: 生成 release APK。
- `yarn copy-config`: 把 `xml/AndroidManifest.xml` 覆盖到原生工程。
- `yarn lint`: 检查代码风格。
- `yarn typecheck`: TypeScript 类型检查。

## 📝 License

本项目采用 MIT 许可证。

## ⚠️ 免责声明

OrionTV 仅作为视频搜索工具，不存储、上传或分发任何视频内容。所有视频均来自第三方 API 接口提供的搜索结果。如有侵权内容，请联系相应的内容提供方。

本项目开发者不对使用本项目产生的任何后果负责。使用本项目时，您必须遵守当地的法律法规。

## 🌟 Star History

[![Star History Chart](https://api.star-history.com/svg?repos=zimplexing/OrionTV&type=Date)](https://www.star-history.com/#zimplexing/OrionTV&Date)

## 🙏 致谢

本项目受到以下开源项目的启发：

- [MoonTV](https://github.com/senshinya/MoonTV) - 一个基于 Next.js 的视频聚合应用
- [LibreTV](https://github.com/LibreSpark/LibreTV) - 一个开源的视频流媒体应用

感谢以下项目提供 API Key 的赞助

- [gpt-load](https://github.com/tbphp/gpt-load) - 一个高性能的 OpenAI 格式 API 多密钥轮询代理服务器，支持负载均衡，使用 Go 语言开发
