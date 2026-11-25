package com.oriontv.legacy

import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.MediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import org.json.JSONObject
import java.io.IOException
import java.io.UnsupportedEncodingException
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

class ApiException(message: String, val kind: String, val code: Int = 0) : IOException(message)

/**
 * 与 MoonTV / OrionTV 服务端对接的最小客户端。
 *
 * 只依赖 OkHttp 3.12：它是最后一个支持 Android 4.4 的分支，
 * 并且内置了 API 19 上的 TLS 1.2 适配（老盒子的系统 socket 默认不启用 TLS 1.2）。
 */
object Api {
    private const val JSON_TYPE = "application/json; charset=utf-8"
    private val JSON: MediaType? = MediaType.parse(JSON_TYPE)

    private val cookieStore = LinkedHashMap<String, Cookie>()

    @Volatile
    var baseUrl: String = ""
        private set

    /** 复用全局连接池，仅挂上会话 cookie */
    private val client: OkHttpClient by lazy {
        Http.client.newBuilder()
            .cookieJar(object : CookieJar {
                override fun saveFromResponse(url: HttpUrl, cookies: MutableList<Cookie>) {
                    synchronized(cookieStore) {
                        for (cookie in cookies) cookieStore[cookie.name()] = cookie
                    }
                    persistCookies()
                }

                override fun loadForRequest(url: HttpUrl): MutableList<Cookie> {
                    synchronized(cookieStore) {
                        return cookieStore.values.toMutableList()
                    }
                }
            })
            .build()
    }

    fun isConfigured(): Boolean = baseUrl.isNotBlank()

    /**
     * 播放专用客户端：基于带 cookie 的 client，但去掉 callTimeout。
     * 70 秒的整体上限是防搜索卡死的，播放是长时间连续读取，超时会把正在播的流掐断。
     */
    private val mediaClient: OkHttpClient by lazy {
        client.newBuilder()
            .callTimeout(0, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .build()
    }

    /** 播放器的数据源也复用这条连接（保留 cookie，带正确 UA，且不限整体调用时长） */
    fun httpClient(): OkHttpClient = mediaClient

    fun setBaseUrl(input: String) {
        var url = input.trim()
        if (url.isEmpty()) return
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            url = "http://$url"
        }
        url = url.trimEnd('/')
        baseUrl = url
        Prefs.baseUrl = url
        restoreCookies()
    }

    fun restore() {
        baseUrl = Prefs.baseUrl.trimEnd('/')
        restoreCookies()
    }

    private fun persistCookies() {
        synchronized(cookieStore) {
            Prefs.cookies = cookieStore.values.joinToString("; ") { "${it.name()}=${it.value()}" }
        }
    }

    private fun restoreCookies() {
        if (baseUrl.isBlank()) return
        val raw = Prefs.cookies
        if (raw.isBlank()) return
        val url = runCatching { HttpUrl.parse(baseUrl) }.getOrNull() ?: return
        synchronized(cookieStore) {
            for (part in raw.split(";")) {
                val cookie = runCatching { Cookie.parse(url, part.trim()) }.getOrNull() ?: continue
                cookieStore[cookie.name()] = cookie
            }
        }
    }

    private fun execute(method: String, path: String, body: RequestBody?, retry: Boolean): String {
        if (baseUrl.isBlank()) throw ApiException("请先设置服务器地址", "not-configured")
        val request = Request.Builder()
            .url(baseUrl + path)
            .header("User-Agent", Http.UA)
            .header("Accept", "application/json, text/plain, */*")
            .method(method, body)
            .build()

        val response = try {
            client.newCall(request).execute()
        } catch (e: java.net.SocketTimeoutException) {
            throw ApiException("请求超时（资源站响应太慢），请重试", "timeout")
        } catch (e: IOException) {
            throw ApiException("网络连接失败，请检查网络或服务器地址", "network")
        }

        response.use { resp ->
            if (resp.code() == 401 && retry && !path.startsWith("/api/login")) {
                val relogged = runCatching { relogin() }.getOrDefault(false)
                if (relogged) return execute(method, path, body, false)
                throw ApiException("登录已过期，请重新登录", "unauthorized", 401)
            }
            if (!resp.isSuccessful) {
                throw ApiException("服务器返回 ${resp.code()}", "server", resp.code())
            }
            return resp.body()?.string() ?: ""
        }
    }

    private fun get(path: String): String = execute("GET", path, null, true)

    private fun post(path: String, json: JSONObject): String =
        execute("POST", path, RequestBody.create(JSON, json.toString()), true)

    private fun delete(path: String): String = execute("DELETE", path, null, true)

    // ---- 会话 ----

    fun serverConfig(): JSONObject = JSONObject(get("/api/server-config"))

    fun login(username: String?, password: String?): Boolean {
        val json = JSONObject()
        if (!username.isNullOrEmpty()) json.put("username", username)
        if (!password.isNullOrEmpty()) json.put("password", password)
        val text = execute("POST", "/api/login", RequestBody.create(JSON, json.toString()), false)
        val ok = runCatching { JSONObject(text).optBoolean("ok") }.getOrDefault(false)
        if (ok) {
            if (!username.isNullOrEmpty()) Prefs.username = username
            if (!password.isNullOrEmpty()) Prefs.password = password
        }
        return ok
    }

    /** 会话过期后自动重登：localstorage 模式直接空登录，其余用本机记住的账号 */
    private fun relogin(): Boolean {
        val storage = Prefs.storageType
        return if (storage == "localstorage" || Prefs.username.isBlank()) {
            login(null, null)
        } else {
            login(Prefs.username, Prefs.password)
        }
    }

    fun logout() {
        runCatching { post("/api/logout", JSONObject()) }
        Prefs.logout()
        synchronized(cookieStore) { cookieStore.clear() }
    }

    // ---- 内容 ----

    fun douban(type: String, tag: String, pageSize: Int = 18, pageStart: Int = 0): List<DoubanItem> {
        val url = "/api/douban?type=$type&tag=${encode(tag)}&pageSize=$pageSize&pageStart=$pageStart"
        return Json.parseDouban(get(url))
    }

    fun search(keyword: String): List<SearchItem> {
        return Json.parseSearch(get("/api/search?q=${encode(keyword)}"))
    }

    /** 取某一资源站的具体剧集地址（m3u8） */
    fun searchOne(keyword: String, resourceId: String): List<SearchItem> {
        val url = "/api/search/one?q=${encode(keyword)}&resourceId=${encode(resourceId)}"
        return Json.parseSearch(get(url)).filter { it.title == keyword }
    }

    fun detail(source: String, id: String): VideoDetail {
        return Json.parseDetail(get("/api/detail?source=${encode(source)}&id=${encode(id)}"))
    }

    // ---- 收藏 / 记录 ----

    fun favorites(): List<FavoriteItem> = Json.parseFavorites(get("/api/favorites"))

    fun addFavorite(key: String, item: SearchItem) {
        val favorite = JSONObject()
            .put("cover", item.poster)
            .put("title", item.title)
            .put("source_name", item.sourceName)
            .put("total_episodes", item.episodes.size)
            .put("search_title", item.title)
            .put("year", item.year)
        val body = JSONObject().put("key", key).put("favorite", favorite)
        post("/api/favorites", body)
    }

    fun deleteFavorite(key: String) {
        delete("/api/favorites?key=${encode(key)}")
    }

    fun playRecords(): List<PlayRecordItem> = Json.parsePlayRecords(get("/api/playrecords"))

    fun savePlayRecord(
        key: String,
        title: String,
        cover: String,
        sourceName: String,
        index: Int,
        totalEpisodes: Int,
        positionMs: Long,
        durationMs: Long,
        year: String
    ) {
        val record = JSONObject()
            .put("title", title)
            .put("source_name", sourceName)
            .put("cover", cover)
            .put("index", index)
            .put("total_episodes", totalEpisodes)
            .put("play_time", positionMs / 1000.0)
            .put("total_time", durationMs / 1000.0)
            .put("year", year)
        post("/api/playrecords", JSONObject().put("key", key).put("record", record))
    }

    fun deletePlayRecord(key: String) {
        delete("/api/playrecords?key=${encode(key)}")
    }

    // ---- 工具 ----

    /**
     * 图片一律走服务端代理：4.4 的系统 socket 默认不协商 TLS 1.2，
     * 豆瓣图床那种只支持 TLS 1.2+ 的站直连必然握手失败，表现就是「全是空白」。
     * 代理地址是局域网 http，稳定得多。
     */
    fun imageUrl(raw: String): String {
        val value = raw.trim()
        if (value.isEmpty()) return ""
        if (value.contains("/api/image-proxy")) return value
        val absolute = when {
            value.startsWith("//") -> "https:$value"
            value.startsWith("http") -> value
            else -> return value
        }
        if (baseUrl.isBlank()) return absolute
        return baseUrl + "/api/image-proxy?url=" + encode(absolute)
    }

    fun encode(value: String): String = try {
        URLEncoder.encode(value, "UTF-8")
    } catch (e: UnsupportedEncodingException) {
        value
    }
}
