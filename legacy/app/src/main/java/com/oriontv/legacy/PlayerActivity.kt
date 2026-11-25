package com.oriontv.legacy

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import com.google.android.exoplayer2.ExoPlayer
import com.google.android.exoplayer2.MediaItem
import com.google.android.exoplayer2.PlaybackException
import com.google.android.exoplayer2.Player
import com.google.android.exoplayer2.source.DefaultMediaSourceFactory
import com.google.android.exoplayer2.ui.PlayerView

class PlayerActivity : AppCompatActivity() {
    private var player: ExoPlayer? = null
    private var meta: PlayMeta? = null
    private var currentUrl: String = ""
    private var nextUrl: String? = null
    private lateinit var errorView: TextView
    private lateinit var tipView: TextView

    private val handler = Handler(Looper.getMainLooper())
    private val saveTask = object : Runnable {
        override fun run() {
            persist()
            handler.postDelayed(this, 15_000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_player)

        val intent = intent
        val url = intent.getStringExtra(EXTRA_URL) ?: run {
            finish()
            return
        }
        meta = PlayMeta(
            title = intent.getStringExtra(EXTRA_TITLE) ?: "",
            cover = intent.getStringExtra(EXTRA_COVER) ?: "",
            source = intent.getStringExtra(EXTRA_SOURCE) ?: "",
            id = intent.getStringExtra(EXTRA_ID) ?: "",
            sourceName = intent.getStringExtra(EXTRA_SOURCE_NAME) ?: "",
            year = intent.getStringExtra(EXTRA_YEAR) ?: "",
            index = intent.getIntExtra(EXTRA_INDEX, 0),
            total = intent.getIntExtra(EXTRA_TOTAL, 1)
        )
        nextUrl = intent.getStringExtra(EXTRA_NEXT_URL)

        val view = findViewById<PlayerView>(R.id.player)
        view.controllerShowTimeoutMs = 3500
        view.setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING)
        errorView = findViewById(R.id.error)
        tipView = findViewById(R.id.tip)

        // 播放失败时给出可读原因，而不是黑屏干等
        errorView.setOnClickListener { errorView.visibility = View.GONE; start(url) }

        start(url)
        handler.postDelayed(saveTask, 15_000)
    }

    private fun start(url: String) {
        currentUrl = url
        errorView.visibility = View.GONE
        tipView.visibility = View.VISIBLE
        tipView.text = "正在连接 ${Host.of(url)} …"

        player?.release()

        // 关键：用 OkHttp 当数据源。Android 4.4 自带的 HttpURLConnection
        // 只协商 TLS 1.0，https 的 m3u8 会直接握手失败（表现为一直黑屏）。
        val dataSource = OkHttpDataSource.Factory(Api.httpClient())

        val exo = ExoPlayer.Builder(this)
            .setMediaSourceFactory(DefaultMediaSourceFactory(dataSource))
            .build()
        player = exo
        findViewById<PlayerView>(R.id.player).player = exo

        exo.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                when (state) {
                    Player.STATE_BUFFERING -> {
                        tipView.visibility = View.VISIBLE
                        tipView.text = "缓冲中…"
                    }
                    Player.STATE_READY -> tipView.visibility = View.GONE
                    Player.STATE_ENDED -> {
                        persist()
                        val next = nextUrl
                        if (!next.isNullOrBlank()) {
                            val m = meta ?: return
                            startActivity(buildIntent(this@PlayerActivity, next, m.copy(index = m.index + 1)))
                            finish()
                        } else {
                            tipView.visibility = View.VISIBLE
                            tipView.text = "播放结束"
                        }
                    }
                }
            }

            override fun onPlayerError(error: PlaybackException) {
                tipView.visibility = View.GONE
                errorView.visibility = View.VISIBLE
                errorView.text = describe(error)
                NetLog.add("PLAYER ${error.errorCode} ${error.errorCodeName} ${Host.of(currentUrl)}")
            }
        })

        exo.setMediaItem(MediaItem.fromUri(url))
        exo.prepare()
        exo.playWhenReady = true
    }

    /** 把 ExoPlayer 的错误码翻译成用户能看懂的话 */
    private fun describe(error: PlaybackException): String {
        val base = when (error.errorCode) {
            PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED,
            PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT ->
                "网络连接失败：源站连不上或被防火墙拦截"
            PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS ->
                "源站返回错误状态码（可能是链接过期或需要 Referer）"
            PlaybackException.ERROR_CODE_IO_FILE_NOT_FOUND -> "视频地址不存在（404）"
            PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED,
            PlaybackException.ERROR_CODE_PARSING_MANIFEST_MALFORMED ->
                "视频格式不对，可能不是有效的 m3u8"
            PlaybackException.ERROR_CODE_DECODER_INIT_FAILED,
            PlaybackException.ERROR_CODE_DECODING_FAILED ->
                "本机解码器不支持该编码（老盒子常见：HEVC/H.265、4K）"
            PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED ->
                "编码格式不支持，建议换一个播放源"
            else -> "播放失败"
        }
        return "$base\n（错误码 ${error.errorCode}，点此重试）\n${Host.of(currentUrl)}"
    }

    override fun onStop() {
        super.onStop()
        persist()
    }

    override fun onDestroy() {
        handler.removeCallbacks(saveTask)
        player?.release()
        player = null
        super.onDestroy()
    }

    private fun persist() {
        val exo = player ?: return
        val m = meta ?: return
        val duration = exo.duration
        if (duration <= 0 || m.title.isBlank()) return
        Ui.io({
            Api.savePlayRecord(
                key = "${m.source}+${m.id}",
                title = m.title,
                cover = m.cover,
                sourceName = m.sourceName,
                index = m.index,
                totalEpisodes = m.total,
                positionMs = exo.currentPosition,
                durationMs = duration,
                year = m.year
            )
        }) { }
    }

    private fun buildIntent(context: Context, url: String, m: PlayMeta): Intent =
        Intent(context, PlayerActivity::class.java).apply {
            putExtra(EXTRA_URL, url)
            putExtra(EXTRA_TITLE, m.title)
            putExtra(EXTRA_COVER, m.cover)
            putExtra(EXTRA_SOURCE, m.source)
            putExtra(EXTRA_ID, m.id)
            putExtra(EXTRA_SOURCE_NAME, m.sourceName)
            putExtra(EXTRA_YEAR, m.year)
            putExtra(EXTRA_INDEX, m.index)
            putExtra(EXTRA_TOTAL, m.total)
        }

    data class PlayMeta(
        val title: String,
        val cover: String,
        val source: String,
        val id: String,
        val sourceName: String,
        val year: String,
        val index: Int,
        val total: Int
    )

    private object Host {
        fun of(url: String): String = runCatching {
            val uri = Uri.parse(url)
            val scheme = uri.scheme ?: "http"
            val host = uri.host ?: return@runCatching url
            "$scheme://$host/"
        }.getOrDefault(url)
    }

    companion object {
        private const val EXTRA_URL = "url"
        private const val EXTRA_TITLE = "title"
        private const val EXTRA_COVER = "cover"
        private const val EXTRA_SOURCE = "source"
        private const val EXTRA_ID = "id"
        private const val EXTRA_SOURCE_NAME = "source_name"
        private const val EXTRA_YEAR = "year"
        private const val EXTRA_INDEX = "index"
        private const val EXTRA_TOTAL = "total"
        private const val EXTRA_NEXT_URL = "next_url"

        fun start(
            context: Context,
            url: String,
            title: String,
            cover: String,
            source: String,
            id: String,
            sourceName: String,
            year: String,
            index: Int,
            total: Int,
            nextUrl: String? = null
        ) {
            val intent = Intent(context, PlayerActivity::class.java).apply {
                putExtra(EXTRA_URL, url)
                putExtra(EXTRA_TITLE, title)
                putExtra(EXTRA_COVER, cover)
                putExtra(EXTRA_SOURCE, source)
                putExtra(EXTRA_ID, id)
                putExtra(EXTRA_SOURCE_NAME, sourceName)
                putExtra(EXTRA_YEAR, year)
                putExtra(EXTRA_INDEX, index)
                putExtra(EXTRA_TOTAL, total)
                if (nextUrl != null) putExtra(EXTRA_NEXT_URL, nextUrl)
            }
            context.startActivity(intent)
        }
    }
}
