package com.oriontv.legacy

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.EditText
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

class LoginActivity : AppCompatActivity() {
    private lateinit var username: EditText
    private lateinit var password: EditText
    private lateinit var hint: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_login)

        username = findViewById(R.id.username)
        password = findViewById(R.id.password)
        hint = findViewById(R.id.hint)

        username.setText(Prefs.username)
        password.setText(Prefs.password)

        findViewById<TextView>(R.id.submit).setOnClickListener { submit() }
    }

    private fun submit() {
        val user = username.text.toString().trim()
        val pass = password.text.toString()
        if (user.isEmpty() || pass.isEmpty()) {
            hint.text = "用户名和密码都要填"
            return
        }
        hint.text = "正在登录…"
        Ui.io({ Api.login(user, pass) }) { result ->
            result.onSuccess { ok ->
                if (ok) {
                    startActivity(Intent(this, HomeActivity::class.java))
                    finish()
                } else {
                    hint.text = "用户名或密码错误"
                }
            }.onFailure {
                hint.text = it.message ?: "登录失败"
            }
        }
    }
}
