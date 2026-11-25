package com.oriontv.legacy

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView

class HomeActivity : AppCompatActivity() {
    private val records = mutableListOf<PlayRecordItem>()
    private val movies = mutableListOf<DoubanItem>()
    private val shows = mutableListOf<DoubanItem>()

    private lateinit var recordsAdapter: PosterAdapter
    private lateinit var moviesAdapter: PosterAdapter
    private lateinit var showsAdapter: PosterAdapter

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_home)

        val loading = findViewById<TextView>(R.id.loading)
        val emptyRecords = findViewById<TextView>(R.id.emptyRecords)

        recordsAdapter = PosterAdapter { index ->
            val item = records.getOrNull(index) ?: return@PosterAdapter
            val parts = item.key.split("+", limit = 2)
            if (parts.size == 2) {
                DetailActivity.start(this, parts[0], parts[1], item.title)
            } else {
                SearchActivity.start(this, item.title)
            }
        }
        moviesAdapter = PosterAdapter { index ->
            movies.getOrNull(index)?.let { SearchActivity.start(this, it.title) }
        }
        showsAdapter = PosterAdapter { index ->
            shows.getOrNull(index)?.let { SearchActivity.start(this, it.title) }
        }

        bindList(R.id.listRecords, recordsAdapter)
        bindList(R.id.listMovies, moviesAdapter)
        bindList(R.id.listTv, showsAdapter)

        findViewById<TextView>(R.id.btnSearch).setOnClickListener {
            startActivity(Intent(this, SearchActivity::class.java))
        }
        findViewById<TextView>(R.id.btnSettings).setOnClickListener {
            startActivity(Intent(this, SettingsActivity::class.java))
        }

        var pending = 3
        fun done() {
            pending -= 1
            if (pending == 0) {
                loading.visibility = View.GONE
                emptyRecords.visibility = if (records.isEmpty()) View.VISIBLE else View.GONE
            }
        }

        Ui.io({ Api.playRecords() }) { result ->
            result.onSuccess {
                records.clear()
                records.addAll(it.sortedByDescending { r -> r.saveTime })
                recordsAdapter.submit(records.map { r ->
                    PosterVM(r.title, r.cover, if (r.totalEpisodes > 0) "${r.index + 1}/${r.totalEpisodes}" else "")
                })
            }.onFailure { handleError(it) }
            done()
        }

        Ui.io({ Api.douban("movie", "热门") }) { result ->
            result.onSuccess {
                movies.clear()
                movies.addAll(it)
                moviesAdapter.submit(it.map { d -> PosterVM(d.title, d.poster, d.rate) })
            }.onFailure { handleError(it) }
            done()
        }

        Ui.io({ Api.douban("tv", "热门") }) { result ->
            result.onSuccess {
                shows.clear()
                shows.addAll(it)
                showsAdapter.submit(it.map { d -> PosterVM(d.title, d.poster, d.rate) })
            }.onFailure { handleError(it) }
            done()
        }
    }

    private fun bindList(id: Int, adapter: PosterAdapter) {
        val list = findViewById<RecyclerView>(id)
        list.layoutManager = LinearLayoutManager(this, LinearLayoutManager.HORIZONTAL, false)
        list.adapter = adapter
        list.itemAnimator = null
    }

    private fun handleError(error: Throwable) {
        if (error is ApiException && error.kind == "unauthorized") {
            startActivity(Intent(this, LoginActivity::class.java))
            finish()
            return
        }
        Ui.toast(this, error.message ?: "加载失败")
    }
}
