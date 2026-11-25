# 构建记录（v1.0.0）

本文件记录可复现的构建环境与步骤，便于下次直接照做。

## 一、环境

| 组件 | 版本 | 说明 |
|---|---|---|
| Node.js | 22.13.1 | 建议 20/22 |
| Yarn | 1.22 | 项目使用 Yarn 1 |
| JDK | 17.0.10 (Zulu) | **必须 17**，Java 20 会与 AGP 8.2 冲突 |
| Gradle | 8.8 | 项目 wrapper 声明 8.8 |
| Android SDK Platform | 34 | compileSdk / targetSdk |
| Android Build-Tools | 34.0.0 | aapt2 / apksigner / zipalign |
| NDK | 26.1.10909125 | expo-av、reanimated 等需源码编译 |
| CMake | 3.22.1（SDK 自带） | 原生构建 |

环境变量：

```sh
export JAVA_HOME=/opt/jdk17
export ANDROID_HOME=/opt/android-sdk
export ANDROID_SDK_ROOT=/opt/android-sdk
export PATH=$JAVA_HOME/bin:$PATH
```

## 二、构建步骤

```sh
# 1. 安装依赖
yarn install --frozen-lockfile

# 2. 生成 Android 原生工程（会覆盖 android/ 目录）
#    该脚本内部还会执行 copy-config，把 xml/AndroidManifest.xml 覆盖到生成目录
yarn prebuild

# 3. 写入 SDK 路径
echo "sdk.dir=$ANDROID_HOME" > android/local.properties

# 4. 出包（release，使用项目自带 debug.keystore 签名）
cd android
NODE_ENV=production ./gradlew assembleRelease
```

产物路径：`android/app/build/outputs/apk/release/app-release.apk`

## 三、内存受限环境（≤8GB）必须调整

默认 `reactNativeArchitectures` 会同时编 4 个 ABI，且 Gradle/CMake 默认按 CPU 核数
全速并行，在 8GB 容器里会被 OOM 杀掉。本次构建的调整：

```properties
# android/gradle.properties
org.gradle.jvmargs=-Xmx2560m -XX:MaxMetaspaceSize=512m
org.gradle.parallel=false
org.gradle.workers.max=1
kotlin.compiler.execution.strategy=in-process
reactNativeArchitectures=arm64-v8a
```

同时设置环境变量限制 ninja 并行：

```sh
export CMAKE_BUILD_PARALLEL_LEVEL=2
export NODE_OPTIONS=--max-old-space-size=2560
```

32 位包单独构建，避免两个 ABI 同时编译：

```sh
./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a
```

## 四、按 ABI 拆分与签名

Gradle 产出的 universal APK 里，32 位目录缺少仅编译了 64 位的
`libexpo-av.so`、`libexpo-modules-core.so`、`libreanimated.so`、`librnscreens.so`，
直接给 32 位设备装会启动崩溃。因此按 ABI 拆包：

```sh
# 仅保留目标 ABI
zip -d app-release.apk "lib/armeabi-v7a/*" "lib/x86/*" "lib/x86_64/*"

# 4 字节对齐
zipalign -p -f 4 app-release.apk aligned.apk

# 重新签名（debug.keystore，别名 androiddebugkey，口令 android）
apksigner sign --ks android/app/debug.keystore \
  --ks-pass pass:android --key-pass pass:android \
  --ks-key-alias androiddebugkey --out OrionTV-1.0.0-arm64.apk aligned.apk
```

## 五、本次构建已知问题与处理

| 问题 | 原因 | 处理 |
|---|---|---|
| `init.gradle` 解析失败 | 环境预置脚本语法错误（`url` 缺等号、`mavelCentral` 拼写错） | 改写为 `google()` + `mavenCentral()` |
| Gradle 发行包下载超时 | `services.gradle.org` 不通 | 改用镜像 `mirrors.cloud.tencent.com`，直接调用本地 Gradle 8.8 |
| `minSdkVersion 21 < 23 (hermes-android)` | 预编译 AAR 声明 23 | 清单加 `tools:overrideLibrary`；最终仍提升至 23 |
| `CXX1214 ... library was built for 23` | 原生库二进制层面要求 23 | 无法绕过，minSdk 定为 23 |
| Gradle daemon 消失 | 8GB cgroup + 全核并行编译 OOM | 限制 JVM 堆、workers 与 ninja 并行 |
| 32 位 APK 启动崩溃风险 | 4 个自编译 so 仅存在 arm64 | 按 ABI 拆包，分别发布 |

## 六、包信息

```
package: com.oriontv
versionName: 1.1.0
versionCode: 3
minSdkVersion: 23 (Android 6.0)
targetSdkVersion: 34
签名: CN=Android Debug（调试证书，仅侧载）
```

## 七、v1.1.0 双端构建（电视 32 位 / 手机 64 位）

电视端和手机端使用同一份 JS，只在打包时指定不同 ABI，因此不需要两份原生工程。

> **打包前必须先固化渠道**（否则 JS 里仍是上一包的值，电视包会把自己当成手机端）：
>
> ```sh
> node scripts/apply-build-info.js        # 读 ORION_CHANNEL / ORION_VERSION / ORION_VERSION_CODE
> ```
>
> 该脚本会重写 `src/constants/BuildInfo.ts`，运行时的「当前版本 / 更新渠道」都从这里取。
> 渠道不再按 `Platform.isTV` 判断 —— 32 位电视包装到手机上也能跑，靠设备猜会判错。

```sh
# 电视端：仅 32 位
cd android
ORION_CHANNEL=tv ORION_VERSION=3.0.5-test.2 ORION_VERSION_CODE=3005 \
  ./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a
cp app/build/outputs/apk/release/app-release.apk \
   ../../OrionTV-TV-3.0.5-test.2-armeabi-v7a.apk

# 手机端：仅 64 位（Gradle 会复用缓存，只需重编原生库）
ORION_CHANNEL=phone ORION_VERSION=2.0.4 ORION_VERSION_CODE=2004 \
  ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
cp app/build/outputs/apk/release/app-release.apk \
   ../../OrionTV-Phone-2.0.4-arm64-v8a.apk
```

由于每次只编一个 ABI，APK 内只包含该 ABI 的原生库，不再需要 `zip -d` 剔除其他架构，
Gradle 自带的 v1/v2 签名在拷贝后依然有效；如需重签仍按第四节流程处理。

`android/gradle.properties` 在 8GB 容器里的关键参数：

```properties
org.gradle.jvmargs=-Xmx2560m -XX:MaxMetaspaceSize=768m
org.gradle.workers.max=2
org.gradle.parallel=false
kotlin.compiler.execution.strategy=in-process
reactNativeArchitectures=armeabi-v7a
```
