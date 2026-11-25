package com.oriontv.legacy

import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Response
import java.text.SimpleDateFormat
import java.util.ArrayDeque
import java.util.Date
import java.util.Locale
import java.util.concurrent.TimeUnit

/**
 * 请求日志环。
 *
 * 老盒子上没法方便地抓 logcat，而「图不显示 / 播不了」这两类问题
 * 只有看到 HTTP 状态码和耗时才能判断是网络、认证还是设备本身。
 * 这里把最近若干条请求留在内存里，设置页的诊断入口直接展示。
 */
object NetLog {
    private const val MAX = 60
    private val lines = ArrayDeque<String>()
    private val time = SimpleDateFormat("HH:mm:ss", Locale.US)

    fun add(message: String) {
        val line = "${time.format(Date())} $message"
        synchronized(lines) {
            lines.addLast(line)
            while (lines.size > MAX) lines.removeFirst()
        }
    }

    fun dump(): String = synchronized(lines) {
        if (lines.isEmpty()) "（暂无请求记录）" else lines.joinToString("\n")
    }

    fun clear() = synchronized(lines) { lines.clear() }
}

/**
 * 全局共享的 HTTP 栈。
 *
 * 关键点：
 * - OkHttp 3.12 是最后一个支持 API 19 的分支，且自带 TLS 1.2 兜底
 *   （Android 4.4 的系统 socket 默认只协商 TLS 1.0，直连 https 图片/源站会握手失败）；
 * - 图片、API、播放数据源共用同一个客户端，复用连接池，老盒子上省一次握手就是几百毫秒；
 * - 统一 UA。默认的 `okhttp/3.x` 在部分 CDN 和源站会被拒，主线 RN 端用的是浏览器 UA。
 */
object Http {
    /** 用浏览器 UA，兼容性最好；资源站/CDN 对裸 okhttp 有拦截的情况不少 */
    const val UA =
        "Mozilla/5.0 (Linux; Android 4.4; OrionTV Legacy) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/78.0.3904.108 Mobile Safari/537.36"

    /** 搜索要聚合多个资源站，20 秒经常不够；连接本身仍然 12 秒就放弃 */
    private const val CONNECT_TIMEOUT = 12L
    const val READ_TIMEOUT = 45L

    val client: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(CONNECT_TIMEOUT, TimeUnit.SECONDS)
            .readTimeout(READ_TIMEOUT, TimeUnit.SECONDS)
            .writeTimeout(READ_TIMEOUT, TimeUnit.SECONDS)
            .callTimeout(70, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .addInterceptor(LoggingInterceptor)
            .build()
    }

    /** 短超时的客户端，给「诊断」和图片用：卡住就尽快失败，别让界面干等 */
    val quickClient: OkHttpClient by lazy {
        client.newBuilder()
            .connectTimeout(8, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .callTimeout(20, TimeUnit.SECONDS)
            .build()
    }

    private object LoggingInterceptor : Interceptor {
        override fun intercept(chain: Interceptor.Chain): Response {
            val request = chain.request()
            val start = System.currentTimeMillis()
            return try {
                val response = chain.proceed(request)
                val cost = System.currentTimeMillis() - start
                val length = response.header("Content-Length") ?: response.header("content-length") ?: "?"
                NetLog.add(
                    "${response.code()} ${request.method()} ${shortPath(request.url().toString())} " +
                        "${cost}ms ${formatSize(length)}"
                )
                response
            } catch (e: Exception) {
                val cost = System.currentTimeMillis() - start
                NetLog.add(
                    "ERR ${request.method()} ${shortPath(request.url().toString())} " +
                        "${cost}ms ${e.javaClass.simpleName}: ${e.message ?: ""}"
                )
                throw e
            }
        }
    }

    fun shortPath(url: String): String {
        val withoutScheme = url.substringAfter("://", url)
        val path = withoutScheme.substringAfter('/', "")
        return "/" + path.take(90)
    }

    fun formatSize(raw: String): String {
        val bytes = raw.toLongOrNull() ?: return "-"
        return when {
            bytes >= 1024 * 1024 -> String.format(Locale.US, "%.1fMB", bytes / 1024.0 / 1024.0)
            bytes >= 1024 -> String.format(Locale.US, "%.1fKB", bytes / 1024.0)
            else -> "${bytes}B"
        }
    }
}
