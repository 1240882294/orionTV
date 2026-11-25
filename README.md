# OrionTV 📺

一个基于 React Native TVOS 和 Expo 构建的播放器，旨在提供流畅的视频观看体验。

> **本仓库说明**
>
> 这是基于上游 [orion-lib/OrionTV](https://github.com/orion-lib/OrionTV) 的二次修改版本，
> 主要改动：启动时扫描账号 → 连接服务器 → 校验并刷新 → 失败提示；仅保留 Android 平台。
>
> - 版本从 `1.0.0` 起算，改动明细见 [CHANGELOG.md](./CHANGELOG.md)
> - **2026-11-25 起电视端与手机端独立维护、独立发版，版本号彻底分开**（见下）
> - 构建环境与步骤见 [BUILD.md](./BUILD.md)
> - 安装包在 **Releases** 里下载（同一个 Release 只放本端的包）。点下面任一入口即可：
>
>   | 入口 | 内容 |
>   |---|---|
>   | [📦 全部版本 / All Releases](../../releases) | 所有正式版 + 测试版都在这页；**手机端请从这里进** |
>   | [电视端最新正式版 tv-v3.0.3](../../releases/tag/tv-v3.0.3) | `OrionTV-TV-3.0.3-armeabi-v7a.apk` |
>   | [电视端测试版 tv-v3.0.5-test.2](../../releases/tag/tv-v3.0.5-test.2) | `OrionTV-TV-3.0.5-test.2-armeabi-v7a.apk`（列表里带 `Pre-release` 标记） |
>   | [手机端最新正式版 phone-v2.0.4](../../releases/tag/phone-v2.0.4) | `OrionTV-Phone-2.0.4-arm64-v8a.apk` |
>
> ⚠️ 仓库首页右侧的 **Releases** 小卡片只显示一个 `Latest`（当前是电视端 v3.0.3），
> 手机端和测试版不在那里，必须点上面的「全部版本」。
>
> 主线支持 Android 6.0 及以上。

## 🔢 版本号与发版规则（重要）

两端虽然共用同一份代码，但**版本号、更新清单、Release 全部独立**：

| 端 | 版本号规则 | 当前正式版 | 测试版 | versionCode | Release tag |
|---|---|---|---|---|---|
| 手机 | **主版本号取偶数**（2.x、4.x、6.x…） | `2.0.4` | — | 2004 | `phone-v2.0.4` |
| 电视 | **主版本号取奇数**（3.x、5.x、7.x…） | `3.0.3` | `3.0.5-test.2` | 3003 / 3005 | `tv-v3.0.3` / `tv-v3.0.5-test.2` |

> 测试版用 `x.y.z-test.n` 命名，Release 勾选 **Pre-release**，不计入 `Latest`，
> 只有主动打开对应 tag 才能装到；测试通过后把同一份代码改成正式版本号再发一次。

一奇一偶，两端版本号永远不可能相同，也不会出现「手机端收到电视端更新日志」的情况。

发版时只动自己那一端：

1. 改 `app.config.js` 的 `CHANNEL_META` 与 `scripts/apply-build-info.js` 的 `DEFAULT_META` 中**对应渠道**那一行（两处保持一致）；
2. 只改 `version.json` 里**对应渠道**节点（另一端的 `version` 保持不动，那边就不会弹更新）；
3. 打这一端的包之前先固化渠道：`ORION_CHANNEL=tv ORION_VERSION=x.y.z ORION_VERSION_CODE=nnnn node scripts/apply-build-info.js`，
   它会重写 `src/constants/BuildInfo.ts` —— APK 里显示的版本号和更新渠道都取自这里；
4. 只在对应的 tag（`tv-vX.Y.Z` / `phone-vX.Y.Z`）建 Release，只上传这一个 APK。

修复电视端 bug 时，手机端版本号、`version.json` 的 `phone` 节点、手机端 Release 都不动，手机用户不会收到任何提示。


## 📱 双端说明

同一套代码会在运行时识别设备形态，自动切换界面与更新渠道：

| 端 | 架构 | 安装包 | 界面 | 更新渠道 | 当前版本 |
|---|---|---|---|---|---|
| 电视 | armeabi-v7a（32 位） | `OrionTV-TV-*` | 遥控器焦点导航 | `tv` | `3.0.3`（测试版 `3.0.5-test.2`） |
| 手机 | arm64-v8a（64 位） | `OrionTV-Phone-*` | 底部标签栏 + 响应式头部 | `phone` | `2.0.4` |

远程管理（扫码输入）只在电视 / 平板端显示；手机端作为输入设备使用。

手机端播放页支持：点「全屏」切横屏、左右滑动画面快进/快退、底部选集与倍速、进度条拖动。
从「继续观看」进入播放时默认横屏。列表页固定竖屏，不跟随手机旋转。

## 🔄 远程更新

应用会读取仓库根目录的 [`version.json`](./version.json) 检查新版本，**只比较自己渠道那一段**：

```json
{
  "version": "2.0.4",
  "notes": "顶层字段仅作旧客户端兜底",
  "channels": {
    "tv": {
      "version": "3.0.3",
      "versionCode": 3003,
      "notes": "电视端更新说明（手机端看不到）",
      "url": "https://github.com/1240882294/orionTV/releases/download/tv-v3.0.3/OrionTV-TV-3.0.3-armeabi-v7a.apk",
      "mirrors": ["https://gh-proxy.com/https://github.com/..."]
    },
    "phone": {
      "version": "2.0.4",
      "versionCode": 2004,
      "notes": "手机端更新说明（电视端看不到）",
      "url": "https://github.com/1240882294/orionTV/releases/download/phone-v2.0.4/OrionTV-Phone-2.0.4-arm64-v8a.apk",
      "mirrors": ["https://gh-proxy.com/https://github.com/..."]
    }
  }
}
```

> 想只发给测试机、不打扰正式用户时，**不要把测试版号写进这里**：
> `version.json` 里的 `version` 一旦高于线上版本，该端所有用户点「检查更新」都会收到提示。
> 测试版直接发到对应 tag，让人手动装 APK 即可。

电视端只读 `channels.tv`，手机端只读 `channels.phone`，更新日志也各用各的 `notes`。
只改一端时，另一端的 `version` 原样保留，那边不会收到任何更新提示。

设置 → 远程更新 可以手动检查；下载完成后直接拉起系统安装器。
清单地址按 GitHub 直连 → ghfast → jsDelivr 回退，APK 下载同样支持镜像切换。

## ✨ 功能特性

- **框架跨平台支持**: 同时支持构建 Apple TV 和 Android TV。
- **现代化前端**: 使用 Expo、React Native TVOS 和 TypeScript 构建，性能卓越。
- **Expo Router**: 基于文件系统的路由，使导航逻辑清晰简单。
- **TV 优化的 UI**: 专为电视遥控器交互设计的用户界面，支持大屏 / 小窗切换。
- **广告过滤**: 播放前清洗 m3u8 列表，自动跳过片头贴片与插播广告，可在设置中关闭。
- **远程更新**: 启动静默检查 + 设置页手动检查，按设备渠道下发对应架构安装包。

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

默认 `minSdkVersion = 23`（Android 6.0），由 `app.config.js` 注入。

> 注意：React Native 0.74 与 Expo SDK 51 预编译的 Hermes / fabricjni 原生库按 API 23 构建，
> NDK 链接器拒绝以 21 为目标（`CXX1214`），因此 21 只能作为实验开关保留，
> 无法产出可运行包。`ORION_MIN_SDK` 环境变量仍可用于实验。

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
