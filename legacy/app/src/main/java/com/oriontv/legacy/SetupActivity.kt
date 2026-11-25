package com.oriontv.legacy

import android.content.Intent
import android.os.Bundle
import android.widget.EditText
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

class SetupActivity : AppCompatActivity() {
    private lateinit var input: EditText
    private lateinit var hint: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_setup)

        input = findViewById(R.id.url)
        hint = findViewById(R.id.hint)
        input.setText(Prefs.baseUrl)

        findViewById<TextView>(R.id.test).setOnClickListener { testConnection() }
        findViewById<TextView>(R.id.save).setOnClickListener { save() }
    }

    private fun testConnection() {
        val url = input.text.toString().trim()
        if (url.isEmpty()) {
            hint.text = "请先填写服务器地址"
            return
        }
        hint.text = "正在测试…"
        Ui.io({
            Api.setBaseUrl(url)
            Api.serverConfig()
        }) { result ->
            result.onSuccess { config ->
                val name = config.optString("SiteName", "服务器")
                val storage = config.optString("StorageType")
                Prefs.storageType = storage
                hint.text = "连接成功：$name（$storage）"
            }.onFailure {
                hint.text = "连接失败：${it.message}"
            }
        }
    }

    private fun save() {
        val url = input.text.toString().trim()
        if (url.isEmpty()) {
            hint.text = "请先填写服务器地址"
            return
        }
        Api.setBaseUrl(url)
        startActivity(Intent(this, MainActivity::class.java))
        finish()
    }
}
