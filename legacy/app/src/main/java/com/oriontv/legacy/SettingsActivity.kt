package com.oriontv.legacy

import android.content.Intent
import android.os.Bundle
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

class SettingsActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)

        findViewById<TextView>(R.id.server).text = "服务器：${Api.baseUrl}"
        findViewById<TextView>(R.id.version).text =
            "版本：${BuildConfig.VERSION_NAME}（经典版 · Android 4.4）"

        findViewById<TextView>(R.id.btnServer).setOnClickListener {
            startActivity(Intent(this, SetupActivity::class.java))
            finish()
        }

        findViewById<TextView>(R.id.btnLogout).setOnClickListener {
            Ui.io({ Api.logout() }) {
                Ui.post {
                    startActivity(Intent(this, LoginActivity::class.java))
                    finish()
                }
            }
        }

        findViewById<TextView>(R.id.btnBack).setOnClickListener { finish() }
    }
}
