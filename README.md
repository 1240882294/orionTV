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
>   | [📦 全部版本 / All Releases](../../releases) | 所有正式版与测试版都在这页 |
>   | [电视端最新正式版 tv-v3.0.10](../../releases/tag/tv-v3.0.10) | `OrionTV-TV-3.0.10-armeabi-v7a.apk`（窄屏盒子集数口径 / 记录越界兜底 / `[DEVICE]` 日志） |
>   | [手机端最新正式版 phone-v2.1.3](../../releases/tag/phone-v2.1.3) | `OrionTV-Phone-2.1.3-arm64-v8a.apk`（继续观看卡片集数不再多一集 + 记录兜底） |
>   | [🧪 当前推送中的测试版](../../releases/tag/tv-v3.0.11-test.1) | 电视 `3.0.11-test.1` / 手机 `2.1.4-test.1`：恢复全量选线与全量测速，修「线路只剩一条」与换线误删最近观看 |
>
> ⚠️ **`version.json` 与 `version-test.json` 当前同时指向上面的测试版**，正式用户与测试用户都会收到更新提示；这是临时安排，转正后两个清单会改回正式版号。
>
> ⚠️ 仓库首页右侧的 **Releases** 小卡片只显示一个 `Latest`（当前是手机端 v2.1.3），
> 电视端不在那里，要点上面的「全部版本」。
> 发测试版时同样只出现在「全部版本」里，带灰色 `Pre-release` 标记，不计入 `Latest`。
>
> 主线支持 Android 6.0 及以上。

> **测试版也能收到更新提示**：测试包（版本号带 `-test`）读的是根目录的
> [`version-test.json`](./version-test.json)，正式包读 [`version.json`](./version.json)，
> 两份清单互不干扰 —— 发测试版不会打扰正式用户，正式版也不会把测试机拉回旧版本。
> 判定依据是打包时写进 `constants/BuildInfo.ts` 的 `BUILD_VERSION` 是否含 `-test`。

## 🔢 版本号与发版规则（重要）

两端虽然共用同一份代码，但**版本号、更新清单、Release 全部独立**：

| 端 | 版本号规则 | 当前正式版 | 当前测试版 | versionCode | Release tag |
|---|---|---|---|---|---|
| 手机 | **主版本号取偶数**（2.x、4.x、6.x…） | `2.1.3` | 无（2.1.3-test.1 已转正） | 2114 | `phone-v2.1.3` |
| 电视 | **主版本号取奇数**（3.x、5.x、7.x…） | `3.0.10` | 无（3.0.10-test.1 已转正） | 3017 | `tv-v3.0.10` |

> 测试版用 `x.y.z-test.n` 命名，Release 勾选 **Pre-release**，不计入 `Latest`，
> 只有主动打开对应 tag 才能装到；测试通过后把同一份代码改成正式版本号再发一次。
>
> **versionCode 必须比在测的测试包大**，否则测试机装不上正式版：
> 手机 2.1.3 取 **2114**（在测的 `2.1.3-test.1` 是 2113），
> 电视 3.0.10 取 **3017**（在测的 `3.0.10-test.1` 是 3016）。
> 同理，测试版修 bug 重发时也要递增 —— `2.1.1-test.1`（2108）因缺原生库闪退，
> 重发的 `test.2` 用 2109 才能覆盖已装的坏包。

一奇一偶，两端版本号永远不可能相同，也不会出现「手机端收到电视端更新日志」的情况。

发版时只动自己那一端：

1. 改 `app.config.js` 的 `CHANNEL_META` 与 `scripts/apply-build-info.js` 的 `DEFAULT_META` 中**对应渠道**那一行（两处保持一致）；
2. 只改清单里**对应渠道**节点（另一端保持不动，那边就不会弹更新）：
   发测试版改 `version-test.json`；发正式版改 `version.json`，
   同时把 `version-test.json` 也指向正式包（否则测试机收不到转正通知，见下）；
3. 打这一端的包之前先固化渠道：`ORION_CHANNEL=tv ORION_VERSION=x.y.z ORION_VERSION_CODE=nnnn node scripts/apply-build-info.js`，
   它会重写 `constants/BuildInfo.ts` —— APK 里显示的版本号、更新渠道、读哪份清单都取自这里；
4. 只在对应的 tag（`tv-vX.Y.Z` / `phone-vX.Y.Z`）建 Release，只上传这一个 APK。

修复电视端 bug 时，手机端版本号、`version.json` 的 `phone` 节点、手机端 Release 都不动，手机用户不会收到任何提示。


## 📱 双端说明

界面形态在运行时按屏幕宽度识别（`Platform.isTV` 或宽 ≥1024dp 判为电视、≥768dp 判为平板），
**更新渠道则由安装包固化**（`BUILD_CHANNEL`），装错包不会拉错架构的安装包：

| 端 | 架构 | 安装包 | 界面 | 更新渠道 | 当前版本 |
|---|---|---|---|---|---|
| 电视 | armeabi-v7a（32 位） | `OrionTV-TV-*` | 遥控器焦点导航 | `tv` | `3.0.10` |
| 手机 | arm64-v8a（64 位） | `OrionTV-Phone-*` | 底部标签栏 + 响应式头部 | `phone` | `2.1.3` |

> ⚠️ **打手机包必须显式指定 ABI**：`gradle.properties` 里的 `reactNativeArchitectures`
> 默认是 `armeabi-v7a`（电视端用），`app/build.gradle` 的 `abiFilters` 只管 app 自己。
> 只改 `abiFilters` 时，reanimated / screens / expo-av / expo-modules-core 四个模块仍只编 v7a，
> 合包时缺 arm64 的 so 不会报错，装上是**点开就闪退**。
> 手机包一律：
>
> ```sh
> ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
> ```
>
> 出包后核对 so 数量：`unzip -l xxx.apk | grep -c '\.so$'`，手机包应为 **48**。

远程管理（扫码输入）只在电视 / 平板端显示；手机端作为输入设备使用。

手机端播放页支持：点「全屏」切横屏、左右滑动画面快进/快退、底部选集与倍速、进度条拖动。
从「继续观看」进入播放时默认横屏。列表页固定竖屏，不跟随手机旋转。

## 🔒 播放页手势与锁屏

| 操作 | 效果 |
|---|---|
| 左右滑动画面 | 快进 / 快退（松手生效） |
| 点画面 | 显示 / 隐藏控件 |
| 长按画面右半侧 | 临时 3 倍速，松手恢复原速 |
| 屏幕最左侧、纵向居中的 🔓 | 锁定屏幕：手势与点击全部失效，图标 2.6 秒后自动淡出，点画面唤回 |

全屏底部功能栏是 **上一集 / 下一集**；选集、倍速、切换线路回竖屏操作。
竖屏信息面板顺序为「播放列表 → 播放源」。

## 🔄 远程更新

应用检查更新时读哪份清单，由包内 `BUILD_VERSION` 是否含 `-test` 决定：

| 包类型 | 读取的清单 | 内容 |
|---|---|---|
| 正式包（`2.1.3`、`3.0.10`） | [`version.json`](./version.json) | 只放正式版，测试用户不会被打扰 |
| 测试包（如 `2.1.3-test.1`） | [`version-test.json`](./version-test.json) | 测试通道；转正时也靠它把正式包推给测试机 |

两份清单结构完全一样，都**只比较自己渠道那一段**：

```json
{
  "version": "3.0.10",
  "notes": "顶层字段仅作旧客户端兜底",
  "channels": {
    "tv": {
      "version": "3.0.10",
      "versionCode": 3017,
      "size": 21592075,
      "md5": "32fb1a3ad8a2f7dca1f1a3522c1bc771",
      "notes": "电视端更新说明（手机端看不到）",
      "url": "https://github.com/1240882294/orionTV/releases/download/tv-v3.0.10/OrionTV-TV-3.0.10-armeabi-v7a.apk",
      "mirrors": ["https://gh-proxy.com/https://github.com/..."]
    },
    "phone": {
      "version": "2.1.3",
      "versionCode": 2114,
      "size": 26795780,
      "md5": "f3180b82b1d960b618ce86f46f254211",
      "notes": "手机端更新说明（电视端看不到）",
      "url": "https://github.com/1240882294/orionTV/releases/download/phone-v2.1.3/OrionTV-Phone-2.1.3-arm64-v8a.apk",
      "mirrors": ["https://gh-proxy.com/https://github.com/..."]
    }
  }
}
```

> **测试版不要写进 `version.json`**：正式清单里的版本号一高过线上版本，
> 该端所有正式用户点「检查更新」都会收到提示。测试版号写 `version-test.json` ——
> 只有已经装着测试包的人才会读到，正式用户完全无感。

### 测试版转正时怎么推给测试用户

测试包只读 `version-test.json`，正式版发完如果不改这份清单，测试机永远收不到转正通知。
做法是把**正式版的版本号和包地址**写进 `version-test.json`：

```jsonc
// version-test.json（转正后）
"phone": {
  "version": "2.1.3",        // 正式版号，不带 -test
  "versionCode": 2114,       // 必须大于在测的 2113
  "url": ".../download/phone-v2.1.3/OrionTV-Phone-2.1.3-arm64-v8a.apk"
}
```

`compareVersions` 里「同号段内正式版 > 预发布版」，所以 `2.1.3` 判定大于 `2.1.3-test.1`，
测试机检查更新就会看到提示，下载的是正式包。装上之后 `IS_TEST_BUILD` 变 false，
改读 `version.json`，后续测试版不再推给这台机器。

转正完成后把旧的测试版 Release 删掉（`tools/pruneBetaReleases.py --apply`
或 `gh release delete <tag> --cleanup-tag`），避免有人从「全部版本」里翻到旧测试包。

电视端只读 `channels.tv`，手机端只读 `channels.phone`，更新日志也各用各的 `notes`。
只改一端时，另一端的 `version` 原样保留，那边不会收到任何更新提示。

设置 → 远程更新 可以手动检查；下载完成后直接拉起系统安装器。
清单地址按 GitHub 直连 → ghfast → jsDelivr 回退，APK 下载同样支持镜像切换。

## ✨ 功能特性

- **框架跨平台支持**: 同时支持构建 Apple TV 和 Android TV。
- **现代化前端**: 使用 Expo、React Native TVOS 和 TypeScript 构建，性能卓越。
- **Expo Router**: 基于文件系统的路由，使导航逻辑清晰简单。
- **TV 优化的 UI**: 专为电视遥控器交互设计的用户界面，支持大屏 / 小窗切换。
- **字母键盘搜索（电视端）**: 遥控器方向键直接选字母，不依赖系统输入法；
  自带 6900 条离线词库，全拼 + 首字母双索引（`xiann` / `xn` 都能出「仙逆」），
  内置词不落盘、不联网。
- **广告过滤**: 播放前清洗 m3u8 列表，自动跳过片头贴片与插播广告，可在设置中关闭。
- **播放容错**: 分辨率探测单线路 4 秒超时、剧集初始化 12 秒总闸；
  15 秒不出画面自动拉黑当前线路重选（最多 2 次）；切线路沿用原集数与原进度，
  且新线路播放不足 30 秒不覆盖原记录。
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
├── constants/        # 应用常量、BuildInfo（打包时生成）与更新配置
├── hooks/            # 自定义 Hooks
├── services/         # 服务层 (API, 存储, m3u8 解析, 搜索联想索引)
├── stores/           # 状态管理 (播放器、账号、收藏)
├── utils/            # 工具函数（含离线拼音表 pinyinFull.ts）
├── scripts/          # 打包辅助：apply-build-info / set-abi / pruneBetaReleases
├── tools/            # 离线数据生成：拼音表、背景图、Release 清理
├── version.json      # 正式版更新清单
├── version-test.json # 测试版更新清单
└── package.json      # 前端依赖和脚本
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

# 打 release APK —— 按渠道选，别用裸的 gradlew
yarn build:tv      # 电视端 32 位，armeabi-v7a
yarn build:phone   # 手机端 64 位，arm64-v8a
```

> 两个 build 脚本都是「prebuild → set-abi → assembleRelease」三步。
> `scripts/set-abi.js` 负责把 ABI 同时写进 `gradle.properties` 和 `app/build.gradle` ——
> 少了这步，手机包会缺 4 个 arm64 原生库，装上去直接闪退（见上文的警告）。

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
- `yarn build:tv` / `yarn build:phone`: 生成对应渠道的 release APK（自动固化 ABI）。
- `node scripts/set-abi.js tv|phone`: 只改 ABI 配置，不打包。
- `node scripts/apply-build-info.js`: 固化渠道与版本号到 `constants/BuildInfo.ts`（发版前必跑）。
- `yarn copy-config`: 把 `xml/AndroidManifest.xml` 覆盖到原生工程。
- `yarn lint`: 检查代码风格。
- `yarn typecheck`: TypeScript 类型检查。
- `yarn test-ci`: 跑单元测试（播放记录兜底、拼音索引等）。

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
