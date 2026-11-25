package com.oriontv.legacy

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.appcompat.app.AppCompatActivity
import com.google.android.exoplayer2.ExoPlayer
import com.google.android.exoplayer2.MediaItem
import com.google.android.exoplayer2.Player
import com.google.android.exoplayer2.ui.PlayerView

class PlayerActivity : AppCompatActivity() {
    private var player: ExoPlayer? = null
    private var meta: PlayMeta? = null
    private var nextUrl: String? = null

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

        val exo = ExoPlayer.Builder(this).build()
        player = exo
        view.player = exo

        exo.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_ENDED) {
                    persist()
                    val next = nextUrl
                    if (!next.isNullOrBlank()) {
                        val m = meta ?: return
                        val newIndex = m.index + 1
                        startActivity(
                            buildIntent(
                                this@PlayerActivity, next, m.copy(index = newIndex)
                            )
                        )
                        finish()
                    }
                }
            }
        })

        exo.setMediaItem(MediaItem.fromUri(url))
        exo.prepare()
        exo.playWhenReady = true
        handler.postDelayed(saveTask, 15_000)
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
