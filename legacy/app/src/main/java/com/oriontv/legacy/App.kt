package com.oriontv.legacy

import androidx.multidex.MultiDexApplication

class App : MultiDexApplication() {
    override fun onCreate() {
        super.onCreate()
        Prefs.init(this)
    }
}
