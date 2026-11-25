package com.oriontv.legacy

import android.os.Bundle
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import okhttp3.Request
import okhttp3.ResponseBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * 网络诊断。
 *
 * 老电视盒子上「图不显示」「点进去一直转圈」「黑屏」都可能是网络这一层的问题，
 * 但设备上不方便抓 logcat。这里把关键请求挨个跑一遍，把状态码、耗时、
 * 字节数、错误类型直接印在屏幕上 —— 用户截个图就能定位到底卡在哪一环。
 */
class DiagnosticsActivity : AppCompatActivity() {
    private lateinit var output: TextView
    private lateinit var scroll: android.widget.ScrollView
    private val sb = StringBuilder()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_diagnostics)
        output = findViewById(R.id.output)
        scroll = findViewById(R.id.scroll)

        findViewById<TextView>(R.id.btnRun).setOnClickListener { run() }
        findViewById<TextView>(R.id.btnClear).setOnClickListener {
            NetLog.clear()
            sb.setLength(0)
            render("日志已清空。点「重新检测」开始诊断。")
        }
        findViewById<TextView>(R.id.btnBack).setOnClickListener { finish() }

        run()
    }

    private fun run() {
        sb.setLength(0)
        render("开始诊断…")
        Ui.io({ buildReport() }) { result ->
            result.onSuccess { render(it) }
                .onFailure { render("诊断中断：${it.message ?: it.javaClass.simpleName}\n\n${sb}") }
        }
    }

    private fun render(text: String) {
        output.text = text
    }

    private fun line(text: String = "") {
        sb.append(text).append('\n')
        Ui.post { render(sb.toString()) }
    }

    private fun buildReport(): String {
        line("服务器：${Api.baseUrl.ifBlank { "（未设置）" }}")
        line("系统版本：Android ${android.os.Build.VERSION.RELEASE}（API ${android.os.Build.VERSION.SDK_INT}）")
        line("设备：${android.os.Build.MODEL}")
        line("")

        if (Api.baseUrl.isBlank()) {
            line("！还没有设置服务器地址，先回设置页填写。")
            return sb.toString()
        }

        var poster = ""

        // 1. 服务器配置：只验证服务可达 + 解析出 storage 模式
        line("① 服务器配置 /api/server-config")
        val config = fetch("${Api.baseUrl}/api/server-config", Mode.TEXT)
        line("   ${config.summary}")
        if (config.ok) {
            runCatching {
                val json = JSONObject(config.body)
                line("   站点：${json.optString("SiteName").ifBlank { "-" }} · 存储：${json.optString("StorageType")}")
            }
        }
        line("")

        // 2. 豆瓣列表：首页数据源，顺便拿一张海报做后续测试
        line("② 首页数据 /api/douban")
        val douban = fetch("${Api.baseUrl}/api/douban?type=movie&tag=${Api.encode("热门")}&pageSize=3&pageStart=0", Mode.TEXT)
        line("   ${douban.summary}")
        if (douban.ok) {
            runCatching {
                val list = JSONObject(douban.body).optJSONArray("list")
                line("   条目数：${list?.length() ?: 0}")
                if (list != null && list.length() > 0) {
                    val first = list.optJSONObject(0)
                    poster = first?.optString("poster") ?: ""
                    line("   首条：${first?.optString("title")} · 海报：${if (poster.isBlank()) "空" else poster.take(60)}")
                }
            }.onFailure { line("   JSON 解析失败：${it.message}") }
        }
        line("")

        // 3. 图片代理：正常情况下这里必须返回 image/*
        line("③ 图片代理 /api/image-proxy（没图就是这一环坏了）")
        if (poster.isBlank()) {
            line("   跳过：豆瓣没返回海报地址")
        } else {
            val proxied = Api.imageUrl(poster)
            val result = fetch(proxied, Mode.BINARY, quick = true)
            line("   ${result.summary}")
            if (!result.ok) line("   → 代理不可用，App 里所有海报都会是首字占位")
        }
        line("")

        // 4. 原图直连：用来区分「代理坏了」还是「设备 TLS 太老」
        line("④ 海报原图直连（对比用）")
        if (poster.isBlank()) {
            line("   跳过")
        } else {
            val direct = fetch(poster, Mode.BINARY, quick = true)
            line("   ${direct.summary}")
            if (!direct.ok) line("   → 4.4 系统 socket 只支持 TLS 1.0，直连图床失败属正常，走代理即可")
        }
        line("")

        // 5. 搜索：详情页取剧集的唯一来源
        line("⑤ 搜索 /api/search（详情页/播放列表靠它）")
        val keyword = "庆余年"
        val search = fetch("${Api.baseUrl}/api/search?q=${Api.encode(keyword)}", Mode.TEXT, quick = false)
        line("   ${search.summary}")
        var firstEpisode = ""
        if (search.ok) {
            runCatching {
                val results = JSONObject(search.body).optJSONArray("results")
                line("   结果数：${results?.length() ?: 0}")
                if (results != null && results.length() > 0) {
                    val first = results.optJSONObject(0)
                    val episodes = first?.optJSONArray("episodes")
                    firstEpisode = episodes?.optString(0) ?: ""
                    line("   首个源：${first?.optString("source_name")} · ${episodes?.length() ?: 0} 集")
                }
            }.onFailure { line("   JSON 解析失败：${it.message}") }
        }
        line("")

        // 6. 剧集地址探测：只取前 2KB，看返回 200/206 还是被拒
        line("⑥ 剧集地址探测（验证 m3u8 是否真的可播）")
        if (firstEpisode.isBlank()) {
            line("   跳过：搜索没拿到剧集地址")
        } else {
            val media = fetch(firstEpisode, Mode.BINARY, quick = false, rangeHeader = true)
            line("   ${media.summary}")
            line("   地址：${firstEpisode.take(90)}")
            if (media.ok) line("   首行：${media.body.lineSequence().firstOrNull()?.take(100)}")
        }
        line("")

        line("—— 最近请求日志 ——")
        line(NetLog.dump())
        return sb.toString()
    }

    private enum class Mode { TEXT, BINARY }

    private data class Probe(val ok: Boolean, val summary: String, val body: String)

    private fun fetch(
        url: String,
        mode: Mode,
        quick: Boolean = false,
        rangeHeader: Boolean = false
    ): Probe {
        val start = System.currentTimeMillis()
        val builder = Request.Builder().url(url).header("User-Agent", Http.UA)
        if (rangeHeader) builder.header("Range", "bytes=0-2047")
        val client = if (quick) Http.quickClient else Http.client.newBuilder()
            .readTimeout(50, TimeUnit.SECONDS)
            .build()

        return try {
            client.newCall(builder.build()).execute().use { response ->
                val cost = System.currentTimeMillis() - start
                val type = response.header("Content-Type") ?: "-"
                val length = response.header("Content-Length")
                val body = response.body()

                if (mode == Mode.TEXT) {
                    val text = body?.string() ?: ""
                    Probe(
                        ok = response.isSuccessful,
                        summary = "HTTP ${response.code()} · ${cost}ms · ${text.toByteArray().size / 1024}KB · $type",
                        body = text
                    )
                } else {
                    val bytes = body?.let { readPrefix(it, 8192) } ?: ByteArray(0)
                    Probe(
                        ok = response.isSuccessful,
                        summary = "HTTP ${response.code()} · ${cost}ms · 读取 ${bytes.size}B/${Http.formatSize(length ?: "?")} · $type",
                        body = bytes.toString(Charsets.UTF_8)
                    )
                }
            }
        } catch (e: Exception) {
            val cost = System.currentTimeMillis() - start
            Probe(false, "失败 · ${cost}ms · ${e.javaClass.simpleName}: ${e.message}", "")
        }
    }

    private fun readPrefix(body: ResponseBody, limit: Int): ByteArray {
        val input = body.byteStream()
        val buffer = ByteArray(limit)
        var read = 0
        while (read < limit) {
            val n = input.read(buffer, read, limit - read)
            if (n <= 0) break
            read += n
        }
        return buffer.copyOf(read)
    }

    companion object {
        fun start(context: android.content.Context) {
            context.startActivity(android.content.Intent(context, DiagnosticsActivity::class.java))
        }
    }
}
