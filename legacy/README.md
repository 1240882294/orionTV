# OrionTV 经典版（legacy）

面向 **Android 4.4（API 19/20）** 老电视盒子的独立客户端。

`src/` 下的主线是 React Native + Expo（minSdk 23，Android 6.0 起），
RN 全系最低只到 API 21，Hermes / fabricjni 的原生库更是按 23 编译，
在 4.4 上无法通过链接器。所以这一端**不共享 JS 代码**，用原生 Kotlin 重写。

## 与主线的关系

| | 主线（`/src`） | 经典版（`/legacy`） |
|---|---|---|
| 技术栈 | React Native 0.74 + Expo 51 | Kotlin + 原生 View |
| 最低系统 | Android 6.0（API 23） | **Android 4.4（API 19）** |
| 包名 | `com.oriontv` | `com.oriontv.legacy` |
| 版本号 | 手机 2.x / 电视 3.x | **1.x** |
| Release tag | `phone-v*` / `tv-v*` | **`legacy-v*`** |
| 更新清单 | `version.json` 的 `tv` / `phone` | 暂不接入（手动装包） |

包名不同，两个客户端可以同时装在一台设备上，互不覆盖。

## 功能进度

### v1.0.0-test.1（当前）

- 服务器地址配置 + 连接测试（`/api/server-config`）
- 登录：`localstorage` 模式自动建会话，其余走账号密码
- 首页：继续观看、热门电影、热门剧集
- 搜索：关键词搜索
- 详情：简介、播放源切换、选集
- 播放：ExoPlayer + HLS，播完自动下一集
- 收藏 / 取消收藏
- 播放进度记录（每 15 秒 + 退出时保存）
- 设置：服务器地址、退出登录

### 后续版本

- 搜索首字母联想（把 `src/utils/pinyinInitials.ts` 的码表导出成资源）
- 多用户管理
- 扫码远程输入（老盒子没有输入法，这条很关键）
- 应用内更新（`version.json` 增加 `legacy` 节点）
- 广告过滤、播放源测速
- 小屏（缩屏）模式

## 技术取舍

- **ExoPlayer 2.18.7**：Media3 要求 API 21，只能用 2.x 分支。
- **OkHttp 3.12.13**：最后一个支持 API 19 的版本，自带老系统的 TLS 1.2 适配。
- **multidex**：API 19 没有原生 multidex，`MultiDexApplication` + `multiDexEnabled true`。
- **不用协程**：老盒子内存紧张，网络请求用 `Executors` + `Handler`，少一层运行时。
- **不做资源压缩/混淆**：方便定位线上问题；包体 5.4 MB，可接受。

## 构建

```sh
cd legacy
JAVA_HOME=/opt/jdk17 ANDROID_HOME=/opt/android-sdk \
  /opt/gradle/gradle-8.8/bin/gradle :app:assembleRelease --max-workers=2
```

产物：`app/build/outputs/apk/release/app-release.apk`

签名用的是 `app/legacy.keystore`（与主线同一张调试证书，SHA-256 `fac61745…`），
后续版本可直接覆盖安装。

## 目录

```
legacy/
├── app/src/main/java/com/oriontv/legacy/
│   ├── Api.kt              接口与 Cookie 会话
│   ├── Models.kt           数据模型与 JSON 解析
│   ├── Prefs.kt            本机配置
│   ├── MainActivity.kt     启动路由
│   ├── SetupActivity.kt    服务器配置
│   ├── LoginActivity.kt    登录
│   ├── HomeActivity.kt     首页
│   ├── SearchActivity.kt   搜索
│   ├── DetailActivity.kt   详情 / 选集 / 换源
│   ├── PlayerActivity.kt   ExoPlayer 播放
│   ├── SettingsActivity.kt 设置
│   ├── PosterAdapter.kt    海报列表
│   └── ChipAdapter.kt      源 / 集数按钮
└── app/src/main/res/       布局与焦点样式
```
