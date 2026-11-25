package com.oriontv.legacy

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.RecyclerView

class SearchActivity : AppCompatActivity() {
    private val results = mutableListOf<SearchItem>()
    private lateinit var adapter: PosterAdapter
    private lateinit var input: EditText
    private lateinit var status: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_search)

        input = findViewById(R.id.keyword)
        status = findViewById(R.id.status)

        adapter = PosterAdapter(R.layout.item_poster_grid, { index ->
            val item = results.getOrNull(index) ?: return@PosterAdapter
            DetailActivity.start(this, item.source, item.id, item.title)
        })

        val list = findViewById<RecyclerView>(R.id.results)
        list.layoutManager = GridLayoutManager(this, 5)
        list.adapter = adapter
        list.itemAnimator = null

        findViewById<TextView>(R.id.submit).setOnClickListener { search() }
        input.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_SEARCH) {
                search()
                true
            } else false
        }

        val keyword = intent.getStringExtra(EXTRA_KEYWORD)
        if (!keyword.isNullOrBlank()) {
            input.setText(keyword)
            search()
        } else {
            input.requestFocus()
        }
    }

    private fun search() {
        val keyword = input.text.toString().trim()
        if (keyword.isEmpty()) {
            status.text = "请输入片名"
            return
        }
        status.text = "搜索中…"
        Ui.io({ Api.search(keyword) }) { result ->
            result.onSuccess { list ->
                results.clear()
                results.addAll(list)
                adapter.submit(list.map { PosterVM(it.title, it.poster, it.year) })
                status.text = if (list.isEmpty()) "没有找到「$keyword」" else "共 ${list.size} 个结果"
                if (list.isNotEmpty()) {
                    findViewById<RecyclerView>(R.id.results).requestFocus()
                }
            }.onFailure {
                status.text = it.message ?: "搜索失败"
            }
        }
    }

    companion object {
        private const val EXTRA_KEYWORD = "keyword"

        fun start(context: Context, keyword: String) {
            val intent = Intent(context, SearchActivity::class.java)
            intent.putExtra(EXTRA_KEYWORD, keyword)
            context.startActivity(intent)
        }
    }
}
