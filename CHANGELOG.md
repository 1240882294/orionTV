# 更新日志

本项目基于上游 [orion-lib/OrionTV](https://github.com/orion-lib/OrionTV) 源码二次修改，
版本号从 `1.0.0` 重新起算，与上游 1.3.14 的对应关系在每条记录里注明。

## v1.0.1 — 2026-11-23

修复首版安装包在电视上的两个可用性问题，并按需求移除直播功能。

### 修复

- **遥控器在启动引导页按「确定」无反应**
  根因：引导页是全屏浮层，但下面的首页仍在同一窗口里，电视端焦点落在被遮住的首页控件上，
  按确定实际触发的是一个看不见的按钮。现在引导页显示期间把页面容器设为 `display: none`，
  原生焦点随视图一起移除；按钮外层改用 `TVFocusGuideView`（`autoFocus`）接管焦点，
  并额外监听遥控器 `select` 事件直接触发当前聚焦按钮，与 `onPress` 之间用 350ms 时间窗去重。
- **64 位电视无法安装**
  改为单包同时包含 `arm64-v8a` 与 `armeabi-v7a` 两套原生库，不再需要用户判断电视系统位数；
  同时把清单里由权限隐含的 `android.hardware.microphone`、`android.hardware.wifi`
  显式声明为 `required="false"`，避免部分电视安装器按硬件特性做过滤。

### 变更

- **移除电视直播功能**：删除 `app/live.tsx`、`components/LivePlayer.tsx`、
  `components/settings/LiveStreamSection.tsx`、`services/m3u.ts`，
  并清理首页顶部「直播」入口、手机底部导航、平板侧边栏、手机标签容器中的直播项，
  以及设置页的「直播源地址」配置块。点播链路（`services/m3u8.ts`、播放页）不受影响。
- 版本号 `1.0.0` → `1.0.1`，`versionCode` 1 → 2。

## v1.0.0 — 2026-11-23

首个自行编译并发布安装包的版本。上游基线：`OrionTV 1.3.14`（commit `41c7a60`）。

### 新增

- **启动账号扫描流程**（`stores/bootStore.ts`、`services/accountScanner.ts`）
  冷启动顺序固定为：读取服务器配置 → 扫描本地账号痕迹 → 连接服务器 → 校验账号 →
  刷新账号数据 → 进入首页。任一步失败都会停在引导页，不会带着空数据进首页。
- **启动闸门页**（`components/BootGate.tsx`）
  全屏展示当前阶段与失败原因，按错误类型区分文案（断网 / 超时 / 服务端异常），
  提供「重新连接」「去检查设置」「稍后再说」三个入口。
- **账号扫描服务**（`services/accountScanner.ts`）
  只读地汇总本地登录凭据、会话 Cookie、收藏与播放记录缓存，推断当前可用账号，
  不修改任何存储，密码不进入 React 组件状态。
- **会话保障服务**（`services/appSession.ts`）
  启动时统一建立/恢复会话，供启动流程与业务层复用，避免重复登录。
- **API 超时与错误分类**（`services/api.ts`）
  `_fetch` 增加 8 秒 AbortController 超时，错误归类为
  `network / timeout / server / UNAUTHORIZED`，启动流程据此决定是提示检查网络
  还是直接弹登录框。

### 变更

- **仅保留 Android 平台**：`platforms: ["android"]`，prebuild 只生成 `android/`，
  移除 iOS 脚本与 Apple TV 相关构建入口。
- **Android 最低版本调整为 API 23（Android 6.0）**：
  上游 RN 0.74 / Expo SDK 51 预编译的 Hermes 与 fabricjni 原生库按 API 23 构建，
  NDK 链接器拒绝以 21 为目标（`CXX1214`），因此 21 无法产出可运行包。
  `app.config.js` 保留 `ORION_MIN_SDK` 环境变量作为实验开关。
- 账号校验失败时不再误报「检查网络」，改为弹出登录框。
- 启动期只校验一次会话，避免首页挂载时重复请求导致连弹两条相同提示。
- 连接成功后清空首页内容缓存再拉取，防止串号显示上一个账号的数据。
- README 中的脚本名改为与 `package.json` 实际一致（`yarn prebuild` / `yarn android`）。

### 兼容性说明

- 支持设备：Android 6.0 及以上，arm64-v8a / armeabi-v7a。
- Android 5.0/5.1 暂不支持。要支持需将 RN/Expo 降至 0.70 / SDK 45 一代，
  属分支级改造，不在本次范围内。

### 安装包

见 GitHub Releases 中的 `v1.0.0`：

| 文件 | 架构 | 适用 |
|---|---|---|
| `OrionTV-1.0.0-arm64.apk` | arm64-v8a | 绝大多数 64 位电视 / 盒子 |
| `OrionTV-1.0.0-armv7.apk` | armeabi-v7a | 32 位老款盒子 |

包名 `com.oriontv`，使用调试证书签名，仅供侧载安装，不用于应用商店上架。
