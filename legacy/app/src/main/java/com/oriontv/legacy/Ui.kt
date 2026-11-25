package com.oriontv.legacy

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.view.View
import android.widget.Toast
import java.util.concurrent.Executors

object Ui {
    private val main = Handler(Looper.getMainLooper())
    private val pool = Executors.newFixedThreadPool(4)

    /** 老盒子上不要在主线程碰网络，统一丢到线程池，结果回主线程 */
    fun <T> io(work: () -> T, done: (Result<T>) -> Unit) {
        pool.execute {
            val result = runCatching { work() }
            main.post { done(result) }
        }
    }

    fun post(action: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) action() else main.post(action)
    }

    fun toast(context: Context, message: String) {
        Toast.makeText(context.applicationContext, message, Toast.LENGTH_SHORT).show()
    }

    fun dp(context: Context, value: Int): Int =
        (value * context.resources.displayMetrics.density).toInt()

    /** 遥控器焦点进出时的轻微放大，让当前选中项一眼可见 */
    fun focusScale(view: View, scale: Float = 1.07f) {
        view.setOnFocusChangeListener { v, hasFocus ->
            v.animate()
                .scaleX(if (hasFocus) scale else 1f)
                .scaleY(if (hasFocus) scale else 1f)
                .setDuration(120)
                .start()
        }
    }
}
