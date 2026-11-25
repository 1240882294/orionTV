package com.oriontv.legacy

import android.content.Intent
import android.os.Bundle
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

/**
 * 启动路由：没填服务器 → 配置页；localstorage 模式自动建会话；其余进首页，
 * 首页请求若返回 401 会再跳登录页。
 */
class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        val status = findViewById<TextView>(R.id.status)

        Api.restore()

        if (Api.baseUrl.isBlank()) {
            startActivity(Intent(this, SetupActivity::class.java))
            finish()
            return
        }

        status.text = "正在连接服务器…"
        Ui.io({
            val config = Api.serverConfig()
            val storage = config.optString("StorageType")
            Prefs.storageType = storage
            if (storage == "localstorage" && Prefs.cookies.isBlank()) {
                Api.login(null, null)
            }
            config
        }) { result ->
            result.onSuccess {
                startActivity(Intent(this, HomeActivity::class.java))
                finish()
            }.onFailure {
                status.text = it.message ?: "连接失败"
                startActivity(Intent(this, SetupActivity::class.java))
                finish()
            }
        }
    }
}
