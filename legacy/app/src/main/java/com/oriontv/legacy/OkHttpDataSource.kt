package com.oriontv.legacy

import android.net.Uri
import com.google.android.exoplayer2.C
import com.google.android.exoplayer2.upstream.BaseDataSource
import com.google.android.exoplayer2.upstream.DataSource
import com.google.android.exoplayer2.upstream.DataSpec
import okhttp3.Call
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.IOException
import java.io.InputStream

/**
 * 用 OkHttp 做 ExoPlayer 的数据源。
 *
 * 官方的 `extension-okhttp` 从 2.18 起把 minSdk 提到了 21，4.4 的盒子用不了，
 * 所以这里自己包一层。好处是：
 * - 复用全局连接池和 cookie；
 * - TLS 由 OkHttp 处理，4.4 系统 socket 只支持 TLS 1.0 的问题不存在；
 * - UA / Referer 可控 —— 不少源站对裸 ExoPlayer 的 UA 直接 403。
 */
class OkHttpDataSource(private val client: OkHttpClient) : BaseDataSource(false) {

    private var call: Call? = null
    private var response: Response? = null
    private var input: InputStream? = null
    private var uri: Uri? = null
    private var bytesRemaining: Long = 0
    private var opened = false

    @Throws(IOException::class)
    override fun open(dataSpec: DataSpec): Long {
        transferInitializing(dataSpec)

        val builder = Request.Builder()
            .url(dataSpec.uri.toString())
            .header("User-Agent", Http.UA)
            .header("Accept", "*/*")
            .header("Referer", originOf(dataSpec.uri))

        val position = dataSpec.position
        val length = dataSpec.length
        if (position > 0 || length != C.LENGTH_UNSET.toLong()) {
            val end = if (length == C.LENGTH_UNSET.toLong()) "" else (position + length - 1).toString()
            builder.header("Range", "bytes=$position-$end")
        }

        val newCall = client.newCall(builder.build())
        call = newCall
        val newResponse = newCall.execute()
        response = newResponse
        if (!newResponse.isSuccessful) {
            throw IOException("HTTP ${newResponse.code()} ${dataSpec.uri}")
        }
        val body = newResponse.body() ?: throw IOException("响应体为空")
        input = body.byteStream()
        uri = dataSpec.uri

        val contentLength = body.contentLength()
        bytesRemaining = when {
            dataSpec.length != C.LENGTH_UNSET.toLong() -> dataSpec.length
            contentLength >= 0 -> contentLength
            else -> C.LENGTH_UNSET.toLong()
        }

        opened = true
        bytesTransferred(0)
        transferStarted(dataSpec)
        return bytesRemaining
    }

    @Throws(IOException::class)
    override fun read(buffer: ByteArray, offset: Int, readLength: Int): Int {
        if (readLength == 0) return 0
        if (bytesRemaining == 0L) return C.RESULT_END_OF_INPUT

        val toRead = if (bytesRemaining == C.LENGTH_UNSET.toLong()) {
            readLength
        } else {
            minOf(bytesRemaining, readLength.toLong()).toInt()
        }
        val read = input?.read(buffer, offset, toRead) ?: C.RESULT_END_OF_INPUT
        if (read == -1) return C.RESULT_END_OF_INPUT
        if (bytesRemaining != C.LENGTH_UNSET.toLong()) bytesRemaining -= read
        bytesTransferred(read)
        return read
    }

    override fun getUri(): Uri? = uri

    override fun close() {
        runCatching { input?.close() }
        input = null
        runCatching { response?.close() }
        response = null
        runCatching { call?.cancel() }
        call = null
        if (opened) {
            opened = false
            transferEnded()
        }
    }

    private fun originOf(uri: Uri): String {
        val scheme = uri.scheme ?: "http"
        val host = uri.host ?: return uri.toString()
        return "$scheme://$host/"
    }

    class Factory(private val client: OkHttpClient) : DataSource.Factory {
        override fun createDataSource(): DataSource = OkHttpDataSource(client)
    }
}
