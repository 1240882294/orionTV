package com.oriontv.legacy

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Shader
import android.graphics.Typeface
import android.os.Handler
import android.os.Looper
import android.util.LruCache
import android.widget.ImageView
import okhttp3.Request
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/**
 * 极简图片加载器。
 *
 * 之前用的 Glide 在 Android 4.4 的盒子上完全不出图（4.16 对 API 19 的兼容已经很不稳），
 * 而且它有自己的网络栈 —— 既不复用连接池，也不带会话 cookie。
 * 这里换成 OkHttp + BitmapFactory 自己管，行为完全可控，体积也小了 1.5MB。
 *
 * 能力：内存 LRU、磁盘缓存、按控件尺寸降采样（老设备内存小，原图直接 OOM）、
 * 失败时画片名首字占位（至少还能认出是哪部片）。
 */
object Images {
    private val main = Handler(Looper.getMainLooper())

    private val memory: LruCache<String, Bitmap> by lazy {
        val max = Runtime.getRuntime().maxMemory()
        val size = (max / 8).coerceIn(4L * 1024 * 1024, 16L * 1024 * 1024).toInt()
        object : LruCache<String, Bitmap>(size) {
            override fun sizeOf(key: String, value: Bitmap): Int = value.byteCount
        }
    }

    /** 并发 3 条足够：老盒子 CPU 弱，开太多反而互相拖慢 */
    private val pool = ThreadPoolExecutor(
        3, 3, 30, TimeUnit.SECONDS,
        LinkedBlockingQueue<Runnable>()
    ).apply { allowCoreThreadTimeOut(true) }

    fun load(view: ImageView, rawUrl: String, title: String = "") {
        val url = rawUrl.trim()
        view.tag = url
        if (url.isEmpty()) {
            view.setImageBitmap(placeholder(view, title))
            return
        }

        memory.get(url)?.let {
            view.setImageBitmap(it)
            return
        }

        // 磁盘读取和解码都放到后台：第一屏十几张图，主线程读盘会明显卡顿
        pool.execute {
            val cached = readDisk(view, url)
            if (cached != null) {
                memory.put(url, cached)
                main.post {
                    if (view.tag == url) view.setImageBitmap(cached)
                }
                return@execute
            }

            val bitmap = runCatching { download(view, url) }.getOrNull()
            main.post {
                // 列表滚动会复用控件，旧请求回来时不能覆盖新内容
                if (view.tag != url) return@post
                if (bitmap != null) {
                    memory.put(url, bitmap)
                    view.setImageBitmap(bitmap)
                } else {
                    view.setImageBitmap(placeholder(view, title))
                }
            }
        }
    }

    private fun download(view: ImageView, url: String): Bitmap? {
        val request = Request.Builder()
            .url(url)
            .header("User-Agent", Http.UA)
            .header("Accept", "image/avif,image/webp,image/*,*/*;q=0.8")
            .build()

        Http.quickClient.newCall(request).execute().use { response ->
            if (!response.isSuccessful) return null
            val body = response.body() ?: return null
            val contentType = response.header("Content-Type") ?: ""
            // 服务端出错时可能返回一段 JSON / HTML，别当图片硬解
            if (contentType.startsWith("text/") || contentType.contains("json")) return null
            val bytes = body.bytes()
            if (bytes.isEmpty()) return null
            val bitmap = decode(bytes, targetWidth(view), targetHeight(view)) ?: return null
            writeDisk(view, url, bytes)
            return bitmap
        }
    }

    private fun decode(bytes: ByteArray, reqW: Int, reqH: Int): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

        val options = BitmapFactory.Options().apply {
            inSampleSize = sampleSize(bounds.outWidth, bounds.outHeight, reqW, reqH)
            inPreferredConfig = Bitmap.Config.RGB_565 // 老设备省一半内存，海报够看
        }
        return runCatching { BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options) }.getOrNull()
    }

    private fun sampleSize(width: Int, height: Int, reqW: Int, reqH: Int): Int {
        var sample = 1
        var w = width
        var h = height
        while (w / 2 >= reqW && h / 2 >= reqH) {
            w /= 2
            h /= 2
            sample *= 2
        }
        return sample
    }

    private fun targetWidth(view: ImageView): Int {
        val density = view.resources.displayMetrics.density
        return if (view.width > 0) view.width else (160 * density).toInt()
    }

    private fun targetHeight(view: ImageView): Int {
        val density = view.resources.displayMetrics.density
        return if (view.height > 0) view.height else (240 * density).toInt()
    }

    // ---- 磁盘缓存 ----

    private fun cacheDir(view: ImageView): File =
        File(view.context.cacheDir, "posters").apply { if (!exists()) mkdirs() }

    private fun cacheFile(view: ImageView, url: String): File =
        File(cacheDir(view), hash(url))

    private fun readDisk(view: ImageView, url: String): Bitmap? {
        val file = cacheFile(view, url)
        if (!file.exists() || file.length() == 0L) return null
        return runCatching {
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeFile(file.absolutePath, bounds)
            val options = BitmapFactory.Options().apply {
                inPreferredConfig = Bitmap.Config.RGB_565
                inSampleSize = sampleSize(bounds.outWidth, bounds.outHeight, targetWidth(view), targetHeight(view))
            }
            BitmapFactory.decodeFile(file.absolutePath, options)
        }.getOrNull() ?: run {
            file.delete()
            null
        }
    }

    private fun writeDisk(view: ImageView, url: String, bytes: ByteArray) {
        runCatching {
            val dir = cacheDir(view)
            // 粗略限量：超过 60MB 直接清空，老盒子存储小，别把空间吃光
            if (dir.length() > 60L * 1024 * 1024) {
                dir.listFiles()?.forEach { it.delete() }
            }
            cacheFile(view, url).writeBytes(bytes)
        }
    }

    private fun hash(text: String): String {
        val digest = MessageDigest.getInstance("MD5").digest(text.toByteArray())
        return digest.joinToString("") { String.format("%02x", it) }
    }

    // ---- 占位 ----

    private val placeholders = HashMap<String, Bitmap>()

    private fun placeholder(view: ImageView, title: String): Bitmap {
        val key = title.take(1).ifBlank { "?" }
        // 占位图只是「没图时能认出是哪部片」，不需要按控件真实尺寸生成：
        // 320x480 的 RGB_565 一张就 300KB，几十张直接把 4.4 的小堆吃光
        val w = targetWidth(view).coerceIn(120, 240)
        val h = targetHeight(view).coerceIn(160, 360)
        val cacheKey = "$key-$w-$h"
        placeholders[cacheKey]?.let { return it }

        val bitmap = runCatching {
            val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.RGB_565)
            val canvas = Canvas(bmp)
            val paint = Paint(Paint.ANTI_ALIAS_FLAG)
            paint.shader = LinearGradient(
                0f, 0f, w.toFloat(), h.toFloat(),
                Color.rgb(0x1B, 0x24, 0x33), Color.rgb(0x11, 0x1A, 0x26),
                Shader.TileMode.CLAMP
            )
            canvas.drawRect(0f, 0f, w.toFloat(), h.toFloat(), paint)
            paint.shader = null

            paint.color = Color.rgb(0x35, 0x45, 0x5A)
            paint.textSize = h * 0.34f
            paint.typeface = Typeface.DEFAULT_BOLD
            paint.textAlign = Paint.Align.CENTER
            val baseline = h / 2f - (paint.descent() + paint.ascent()) / 2f
            canvas.drawText(key, w / 2f, baseline, paint)
            bmp
        }.getOrElse { Bitmap.createBitmap(1, 1, Bitmap.Config.RGB_565) }

        if (placeholders.size > 10) placeholders.clear()
        placeholders[cacheKey] = bitmap
        return bitmap
    }

    fun clearAll(view: ImageView) {
        memory.evictAll()
        cacheDir(view).listFiles()?.forEach { it.delete() }
    }
}
