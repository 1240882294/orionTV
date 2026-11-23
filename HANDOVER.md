# OrionTV 项目交接说明（v1.2.0）

> 一句话：基于 React Native TVOS + Expo 的安卓播放器，同一套代码出「电视 32 位」和「手机 64 位」两个包。
> 本文档面向接手人，按「现状 → 怎么跑 → 怎么改 → 怎么发 → 坑在哪」的顺序组织。

- **归档时间**：2026-11-23 23:40
- **当前版本**：`1.2.0`（`versionCode 4`）
- **包名**：`com.oriontv`　**最低系统**：Android 6.0（API 23）

---

## 一、资产位置

| 类型 | 地址 |
|---|---|
| GitHub 仓库 | https://github.com/1240882294/orionTV |
| 当前 Release | https://github.com/1240882294/orionTV/releases/tag/v1.2.0 |
| 远程更新清单 | https://raw.githubusercontent.com/1240882294/orionTV/main/version.json |
| 资料库项目空间 | https://www.workbuddy.cn/space/d/xgfzHFgsiHxo5lqM3KUW6M |
| 上游项目 | https://github.com/orion-lib/OrionTV |

---

## 二、当前功能状态

| 模块 | 状态 | 说明 |
|---|---|---|
| 启动流程 | ✅ 可用 | 扫描本地账号 → 连接服务器 → 校验刷新 → 失败停在提示页（`BootGate`） |
| 电视端界面 | ✅ 可用 | 遥控器焦点导航，启动闸门期间隐藏底层页面避免抢焦点 |
| 手机端界面 | ✅ 可用 | 底部标签栏 + 响应式头部，远程管理区块自动隐藏 |
| 远程管理 | ✅ 可用 | 开关 + 二维码扫码直达输入页 + 全屏二维码 |
| 远程更新 | ✅ 可用 | 读 `version.json`，分 `tv` / `phone` 渠道，多镜像回退，一键安装 |
| 手机播放页 | ✅ 可用（待真机复验） | 横屏全屏、滑动快进/快退、底部选集/倍速、进度条拖动、最近播放默认横屏 |
| 屏幕方向 | ✅ 可用（待真机复验） | 列表页固定竖屏，播放页主动切横屏 |
| 电视直播 | ⛔ 已移除 | v1.0.1 按需求删除 `live.tsx` 及相关组件 |

---

## 三、环境与构建

### 3.1 依赖环境

| 组件 | 版本 / 路径 |
|---|---|
| Node.js | 22.x |
| JDK | 17（`/opt/jdk17`） |
| Android SDK | 34（`/opt/android-sdk`） |
| NDK | 26.1.10909125 |
| Gradle | 8.8（`/opt/gradle/gradle-8.8`） |

### 3.2 首次准备

```sh
cd src
yarn install --frozen-lockfile

export JAVA_HOME=/opt/jdk17
export ANDROID_HOME=/opt/android-sdk
export ANDROID_SDK_ROOT=/opt/android-sdk
export PATH=$JAVA_HOME/bin:$PATH

# 生成原生工程（仅首次或新增原生配置时）
EXPO_TV=1 npx expo prebuild --platform android --no-install
```

> ⚠️ `prebuild --clean` 会重写 `android/`，手工调过的 `gradle.properties`（堆内存、ABI、workers）会丢，需要重新设置。
> 新增 Expo Module（如 `expo-screen-orientation`）**不需要** prebuild，Gradle 阶段自动链接。

### 3.3 打包

```sh
cd android
./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a,arm64-v8a
```

内存不足时逐 ABI 编译：`-PreactNativeArchitectures=armeabi-v7a`。

### 3.4 拆包与签名

`zip -d` 会破坏签名，拆完必须重新 zipalign + 签名：

```sh
BT=/opt/android-sdk/build-tools/34.0.0
cp app-release.apk /tmp/tv.apk    && zip -d /tmp/tv.apk    "lib/arm64-v8a/*" "lib/x86/*" "lib/x86_64/*"
cp app-release.apk /tmp/phone.apk && zip -d /tmp/phone.apk "lib/armeabi-v7a/*" "lib/x86/*" "lib/x86_64/*"

for f in tv phone; do
  $BT/zipalign -p -f 4 /tmp/$f.apk /tmp/$f-aligned.apk
  $BT/apksigner sign --ks app/debug.keystore --ks-pass pass:android \
    --key-pass pass:android --ks-key-alias androiddebugkey \
    --out ../../OrionTV-$f-1.2.0.apk /tmp/$f-aligned.apk
done
```

### 3.5 关键 Gradle 参数

```properties
org.gradle.jvmargs=-Xmx6144m -XX:MaxMetaspaceSize=1024m
org.gradle.workers.max=4
reactNativeArchitectures=armeabi-v7a,arm64-v8a
```

内存 < 8GB 时降到 `-Xmx2560m`、`workers.max=2`、并逐 ABI 编译。

---

## 四、发版流程

1. 改版本号（三处保持一致）
   - `src/package.json` → `version`
   - `src/app.config.js` → `APP_VERSION` / `VERSION_CODE`
   - `src/android/app/build.gradle` → `versionName` / `versionCode`
2. 更新 `src/CHANGELOG.md`
3. 编译、拆包、签名
4. 更新 `src/version.json`（`version`、`versionCode`、两个渠道的 `url` 与 `mirrors`）
5. 推送源码（git 协议在当前环境不可用，走 REST API）

```sh
# 逐文件上传 blob → 建 tree → 建 commit → 更新 ref
gh api repos/<owner>/orionTV/git/blobs -X POST --input - ...
```

6. 创建 Release 并上传 APK

```sh
gh release create v1.2.0 OrionTV-TV-*.apk OrionTV-Phone-*.apk \
  -R 1240882294/orionTV -t "标题" -F release-notes.md
```

> **顺序很重要**：先让 `version.json` 指向的 Release 存在，再让客户端读清单，否则会 404。

---

## 五、代码地图

| 路径 | 职责 |
|---|---|
| `app/_layout.tsx` | 根布局：启动序列、竖屏锁、自动检查更新、启动闸门遮挡 |
| `app/index.tsx` | 首页（继续观看 / 推荐） |
| `app/detail.tsx` | 详情页与选集入口 |
| `app/play.tsx` | 播放页：TV / 触摸端分流、滑动快进、方向控制 |
| `app/search.tsx` | 搜索页（挂远程输入弹窗） |
| `app/settings.tsx` | 设置页（远程管理、远程更新、清除数据） |
| `components/BootGate.tsx` | 启动状态机界面 + 电视焦点兜底 |
| `components/MobilePlayerControls.tsx` | 手机播放控件（新增于 v1.2.0） |
| `components/PlayerControls.tsx` | 电视播放控件 |
| `components/EpisodeSelectionModal.tsx` | 选集弹窗（自适应宽度） |
| `components/SpeedSelectionModal.tsx` | 倍速弹窗（自适应宽度） |
| `components/RemoteControlModal.tsx` | 全屏二维码 |
| `services/api.ts` | 接口层：8s 超时、`ApiError` 分类 |
| `services/accountScanner.ts` | 本地账号扫描 |
| `services/appSession.ts` | 账号校验与刷新 |
| `services/remoteControlService.ts` | 远程输入 HTTP 服务 + 手机端页面 |
| `services/tcpHttpServer.ts` | 轻量 TCP HTTP 服务 |
| `services/updateService.ts` | 远程更新：清单拉取、镜像回退、下载 |
| `stores/bootStore.ts` | 启动状态机 |
| `stores/playerStore.ts` | 播放状态（含 `isFullscreen`、手势 seek） |
| `stores/updateStore.ts` | 更新状态 |
| `stores/remoteControlStore.ts` | 远程服务状态 |
| `constants/UpdateConfig.ts` | 更新源配置与镜像列表 |

---

## 六、已知约束（改之前务必知道）

| 约束 | 原因 |
|---|---|
| `minSdk = 23` 无法下调到 21 | RN 0.74 / Expo 51 预编译的 Hermes 与 fabricjni 按 API 23 构建，链接器直接拒绝（`CXX1214`） |
| 电视只发 32 位、手机只发 64 位 | 单 ABI 包避免 32 位电视误装 64 位包；混装会 `INSTALL_FAILED_NO_MATCHING_ABIS` |
| 使用 debug 证书 | 仅侧载分发；上架应用商店需换正式 keystore 并妥善保管 |
| 手机端关闭原生播放控件 | 原生控件抢占触摸且自带全屏不切横屏，改用 `MobilePlayerControls` |
| 设备类型取进入时快照 | 手机横屏后逻辑宽度变 800+，会被误判成 tablet/tv |

---

## 七、常见问题排查

| 现象 | 原因 | 处理 |
|---|---|---|
| 电视遥控器点「去设置服务器」无反应 | 底层页面仍参与焦点竞争 | `BootGate` 显示期间容器 `display:none`，并用 `TVFocusGuideView` + `autoFocus` 兜底 |
| 64 位电视装不上 | 装到只含 arm64 的包 | 改用 `armeabi-v7a` 电视包 |
| 手机界面跟着旋转乱转 | 方向未锁 | `_layout.tsx` 已锁 `PORTRAIT_UP`，检查是否被其他页面覆盖 |
| 点全屏没转横屏 | 部分定制 ROM 忽略 `setRequestedOrientation` | 属系统限制，退化为竖屏放大播放 |
| 远程更新提示 404 | `version.json` 指向的 Release 不存在 | 先发 Release 再更新清单 |
| Gradle 编译被 OOM 杀掉 | JVM 堆 + CMake 并行过高 | 降 `-Xmx`、`workers.max`，逐 ABI 编译 |

---

## 八、待办清单

- [ ] **真机验证 v1.2.0**：全屏横屏、滑动快进、选集/倍速弹窗、最近播放默认横屏、返回恢复竖屏
- [ ] 电视端回归：遥控器操作、启动闸门、远程输入二维码
- [ ] 全局 `ErrorBoundary`（当前异常会整页白屏）
- [ ] 远程服务鉴权（当前同网段即可访问，建议加 token）
- [ ] 接入 CI 自动打包（`.github/workflows` 需仓库 `workflow` 权限，当前 token 无该 scope）
- [ ] 正式签名证书（如需上架）

---

## 九、归档目录说明

```
OrionTV-归档-v1.2.0/
├── README.md                 归档导航
├── 01-交接说明.md            本文件
├── 02-版本记录/
│   ├── CHANGELOG.md          全版本改动
│   ├── 进度日志-v1.2.0.md    本轮进度快照
│   └── 操作日志-v1.2.0.md    本轮改动明细与技术决策
├── 03-技术与构建/
│   ├── PROJECT.md            项目档案（版本履历、产物清单）
│   ├── BUILD.md              完整构建手册与踩坑记录
│   ├── 启动流程改造说明.md    启动状态机设计说明
│   └── 项目开发评估.html      初版代码质量评估
├── 04-源码/                  源码 zip（不含 node_modules / android）
├── 05-安装包/                双端 APK
└── 06-历史补丁/              Android 启动改造 patch
```
