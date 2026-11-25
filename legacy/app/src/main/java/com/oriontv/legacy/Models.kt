package com.oriontv.legacy

import org.json.JSONArray
import org.json.JSONObject

data class DoubanItem(
    val title: String,
    val poster: String,
    val rate: String
)

data class SearchItem(
    val id: String,
    val title: String,
    val poster: String,
    val episodes: List<String>,
    val source: String,
    val sourceName: String,
    val year: String,
    val desc: String
) {
    /** 收藏 / 播放记录的 key，与现有客户端保持一致：source + id */
    val key: String get() = "$source+$id"
}

data class VideoDetail(
    val id: String,
    val title: String,
    val poster: String,
    val source: String,
    val sourceName: String,
    val desc: String,
    val year: String,
    val area: String,
    val remarks: String
)

data class FavoriteItem(
    val key: String,
    val cover: String,
    val title: String,
    val sourceName: String,
    val totalEpisodes: Int,
    val searchTitle: String,
    val year: String,
    val saveTime: Long
)

data class PlayRecordItem(
    val key: String,
    val title: String,
    val cover: String,
    val sourceName: String,
    val index: Int,
    val totalEpisodes: Int,
    val playTime: Long,
    val totalTime: Long,
    val year: String,
    val saveTime: Long
)

object Json {
    fun parseDouban(body: String): List<DoubanItem> {
        val list = JSONObject(body).optJSONArray("list") ?: return emptyList()
        return (0 until list.length()).mapNotNull { i ->
            val o = list.optJSONObject(i) ?: return@mapNotNull null
            val title = o.optString("title").trim()
            if (title.isEmpty()) null else DoubanItem(
                title = title,
                poster = o.optString("poster"),
                rate = o.optString("rate")
            )
        }
    }

    fun parseSearch(body: String): List<SearchItem> {
        val arr = JSONObject(body).optJSONArray("results") ?: return emptyList()
        return parseSearchArray(arr)
    }

    fun parseSearchArray(arr: JSONArray): List<SearchItem> {
        return (0 until arr.length()).mapNotNull { i ->
            val o = arr.optJSONObject(i) ?: return@mapNotNull null
            val title = o.optString("title").trim()
            if (title.isEmpty()) return@mapNotNull null
            val episodes = mutableListOf<String>()
            val ep = o.optJSONArray("episodes")
            if (ep != null) {
                for (j in 0 until ep.length()) episodes.add(ep.optString(j))
            }
            SearchItem(
                id = o.optString("id"),
                title = title,
                poster = o.optString("poster"),
                episodes = episodes,
                source = o.optString("source"),
                sourceName = o.optString("source_name"),
                year = o.optString("year"),
                desc = o.optString("desc")
            )
        }
    }

    fun parseDetail(body: String): VideoDetail {
        val o = JSONObject(body)
        return VideoDetail(
            id = o.optString("id"),
            title = o.optString("title"),
            poster = o.optString("poster"),
            source = o.optString("source"),
            sourceName = o.optString("source_name"),
            desc = o.optString("desc"),
            year = o.optString("year"),
            area = o.optString("area"),
            remarks = o.optString("remarks")
        )
    }

    fun parseFavorites(body: String): List<FavoriteItem> {
        val o = runCatching { JSONObject(body) }.getOrNull() ?: return emptyList()
        val out = mutableListOf<FavoriteItem>()
        val keys = o.keys()
        while (keys.hasNext()) {
            val key = keys.next()
            val v = o.optJSONObject(key) ?: continue
            out.add(
                FavoriteItem(
                    key = key,
                    cover = v.optString("cover"),
                    title = v.optString("title"),
                    sourceName = v.optString("source_name"),
                    totalEpisodes = v.optInt("total_episodes"),
                    searchTitle = v.optString("search_title", v.optString("title")),
                    year = v.optString("year"),
                    saveTime = v.optLong("save_time")
                )
            )
        }
        return out
    }

    fun parsePlayRecords(body: String): List<PlayRecordItem> {
        val o = runCatching { JSONObject(body) }.getOrNull() ?: return emptyList()
        val out = mutableListOf<PlayRecordItem>()
        val keys = o.keys()
        while (keys.hasNext()) {
            val key = keys.next()
            val v = o.optJSONObject(key) ?: continue
            out.add(
                PlayRecordItem(
                    key = key,
                    title = v.optString("title"),
                    cover = v.optString("cover"),
                    sourceName = v.optString("source_name"),
                    index = v.optInt("index"),
                    totalEpisodes = v.optInt("total_episodes"),
                    playTime = v.optLong("play_time"),
                    totalTime = v.optLong("total_time"),
                    year = v.optString("year"),
                    saveTime = v.optLong("save_time")
                )
            )
        }
        return out
    }
}
