package com.oriontv.legacy

import android.content.Context
import android.content.SharedPreferences

/**
 * 本机配置：服务器地址、cookie、账号。老盒子上 SharedPreferences 足够，
 * 不引入 Room / DataStore（它们要么要求更高 API，要么体积更大）。
 */
object Prefs {
    private lateinit var sp: SharedPreferences

    fun init(context: Context) {
        sp = context.applicationContext.getSharedPreferences("orion_legacy", Context.MODE_PRIVATE)
    }

    var baseUrl: String
        get() = sp.getString("base_url", "") ?: ""
        set(value) = sp.edit().putString("base_url", value).apply()

    var cookies: String
        get() = sp.getString("cookies", "") ?: ""
        set(value) = sp.edit().putString("cookies", value).apply()

    var username: String
        get() = sp.getString("username", "") ?: ""
        set(value) = sp.edit().putString("username", value).apply()

    var password: String
        get() = sp.getString("password", "") ?: ""
        set(value) = sp.edit().putString("password", value).apply()

    var storageType: String
        get() = sp.getString("storage_type", "") ?: ""
        set(value) = sp.edit().putString("storage_type", value).apply()

    fun clearSession() {
        sp.edit().putString("cookies", "").apply()
    }

    fun logout() {
        sp.edit().putString("cookies", "").putString("password", "").apply()
    }
}
