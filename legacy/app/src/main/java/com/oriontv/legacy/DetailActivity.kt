package com.oriontv.legacy

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.ImageView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView

/**
 * 详情页：按片名搜出所有资源站，可切换播放源、点集数直接播放。
 * 与现有 TV 端一致 —— 剧集地址来自 /api/search 的 episodes，/api/detail 只补简介等元数据。
 */
class DetailActivity : AppCompatActivity() {
    private lateinit var poster: ImageView
    private lateinit var titleView: TextView
    private lateinit var metaView: TextView
    private lateinit var descView: TextView
    private lateinit var favoriteBtn: TextView
    private lateinit var statusView: TextView

    private lateinit var sourcesAdapter: ChipAdapter
    private lateinit var episodesAdapter: ChipAdapter

    private var query: String = ""
    private var preferredSource: String? = null
    private val sources = mutableListOf<SearchItem>()
    private var current: SearchItem? = null
    private var favorited = false
    private var detailDesc: String = ""
    private var detailMeta: String = ""
    /** 当前源的基础信息（年份 · 源名），详情元数据在此基础上拼接，避免反复切换源时越拼越长 */
    private var baseMeta: String = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_detail)

        poster = findViewById(R.id.poster)
        titleView = findViewById(R.id.title)
        metaView = findViewById(R.id.meta)
        descView = findViewById(R.id.desc)
        favoriteBtn = findViewById(R.id.btnFavorite)
        statusView = findViewById(R.id.status)

        query = intent.getStringExtra(EXTRA_TITLE) ?: ""
        preferredSource = intent.getStringExtra(EXTRA_SOURCE)
        titleView.text = query
        statusView.text = "正在搜索各资源站…（约 10–30 秒）"
        statusView.setOnClickListener { load() }

        sourcesAdapter = ChipAdapter(R.layout.item_source) { index -> selectSource(index) }
        episodesAdapter = ChipAdapter(R.layout.item_episode) { index -> play(index) }

        val sourceList = findViewById<RecyclerView>(R.id.sources)
        sourceList.layoutManager = LinearLayoutManager(this, LinearLayoutManager.HORIZONTAL, false)
        sourceList.adapter = sourcesAdapter
        sourceList.itemAnimator = null

        val episodeList = findViewById<RecyclerView>(R.id.episodes)
        episodeList.layoutManager = GridLayoutManager(this, 7)
        episodeList.adapter = episodesAdapter
        episodeList.itemAnimator = null

        favoriteBtn.setOnClickListener { toggleFavorite() }

        load()
    }

    private fun load() {
        if (query.isBlank()) {
            statusView.text = "缺少片名"
            return
        }
        statusView.text = "正在搜索各资源站…（约 10–30 秒）"
        Ui.io({ Api.search(query) }) { result ->
            result.onSuccess { list ->
                sources.clear()
                sources.addAll(list)
                if (list.isEmpty()) {
                    statusView.text = "没有找到可用资源（点此重试）"
                    return@onSuccess
                }
                sourcesAdapter.submit(list.map { it.sourceName.ifBlank { it.source } })
                val index = list.indexOfFirst { it.source == preferredSource }.coerceAtLeast(0)
                selectSource(index)
            }.onFailure {
                statusView.text = "${it.message ?: "加载失败"}（点此重试）"
            }
        }
    }

    private fun selectSource(index: Int) {
        val item = sources.getOrNull(index) ?: return
        current = item
        titleView.text = item.title
        baseMeta = listOf(item.year, item.sourceName).filter { it.isNotBlank() }.joinToString(" · ")
        metaView.text = baseMeta

        Images.load(poster, Api.imageUrl(item.poster), item.title)

        val labels = item.episodes.indices.map { i ->
            if (item.episodes.size == 1) "播放" else "第 ${i + 1} 集"
        }
        episodesAdapter.submit(labels)
        statusView.text = if (item.episodes.isEmpty()) "该源暂无可用剧集" else "${item.episodes.size} 集 · ${item.sourceName}"

        loadDetail(item)
        loadFavoriteState(item)
    }

    private fun loadDetail(item: SearchItem) {
        Ui.io({ Api.detail(item.source, item.id) }) { result ->
            result.onSuccess { detail ->
                // 切源后旧请求可能后到，丢弃过期结果
                if (current?.id != item.id) return@onSuccess
                detailDesc = detail.desc
                detailMeta = listOf(detail.year, detail.area, detail.remarks)
                    .filter { it.isNotBlank() }
                    .joinToString(" · ")
                descView.text = detailDesc
                metaView.text = listOf(baseMeta, detailMeta)
                    .filter { it.isNotBlank() }
                    .joinToString(" · ")
                if (detail.poster.isNotBlank() && item.poster.isBlank()) {
                    Images.load(poster, Api.imageUrl(detail.poster), item.title)
                }
            }
        }
    }

    private fun loadFavoriteState(item: SearchItem) {
        Ui.io({ Api.favorites() }) { result ->
            result.onSuccess { list ->
                favorited = list.any { it.key == item.key }
                updateFavoriteButton()
            }
        }
    }

    private fun updateFavoriteButton() {
        favoriteBtn.text = if (favorited) "已收藏（点此取消）" else "收藏"
    }

    private fun toggleFavorite() {
        val item = current ?: return
        val target = !favorited
        Ui.io({
            if (target) Api.addFavorite(item.key, item) else Api.deleteFavorite(item.key)
        }) { result ->
            result.onSuccess {
                favorited = target
                updateFavoriteButton()
                Ui.toast(this, if (target) "已收藏" else "已取消收藏")
            }.onFailure {
                Ui.toast(this, it.message ?: "操作失败")
            }
        }
    }

    private fun play(index: Int) {
        val item = current ?: return
        val url = item.episodes.getOrNull(index) ?: return
        PlayerActivity.start(
            this,
            url = url,
            title = item.title,
            cover = item.poster,
            source = item.source,
            id = item.id,
            sourceName = item.sourceName,
            year = item.year,
            index = index,
            total = item.episodes.size,
            nextUrl = item.episodes.getOrNull(index + 1)
        )
    }

    companion object {
        private const val EXTRA_TITLE = "title"
        private const val EXTRA_SOURCE = "source"
        private const val EXTRA_ID = "id"

        fun start(context: Context, source: String?, id: String?, title: String) {
            val intent = Intent(context, DetailActivity::class.java)
            intent.putExtra(EXTRA_TITLE, title)
            intent.putExtra(EXTRA_SOURCE, source)
            intent.putExtra(EXTRA_ID, id)
            context.startActivity(intent)
        }
    }
}
