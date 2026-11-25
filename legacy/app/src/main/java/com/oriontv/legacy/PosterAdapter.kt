package com.oriontv.legacy

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView

data class PosterVM(
    val title: String,
    val poster: String,
    val badge: String = ""
)

/**
 * 横向海报列表。卡片本身是 focusable 的，遥控器左右移动即切换选中项，
 * 确定键由 View 默认的 DPAD_CENTER → performClick 处理。
 */
class PosterAdapter(
    private val layoutRes: Int = R.layout.item_poster,
    private val onClick: (Int) -> Unit
) :
    RecyclerView.Adapter<PosterAdapter.Holder>() {

    private val items = mutableListOf<PosterVM>()

    fun submit(list: List<PosterVM>) {
        items.clear()
        items.addAll(list)
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder {
        val view = LayoutInflater.from(parent.context).inflate(layoutRes, parent, false)
        return Holder(view)
    }

    override fun getItemCount(): Int = items.size

    override fun onBindViewHolder(holder: Holder, position: Int) {
        val item = items[position]
        holder.title.text = item.title
        if (item.badge.isBlank()) {
            holder.rate.visibility = View.GONE
        } else {
            holder.rate.visibility = View.VISIBLE
            holder.rate.text = item.badge
        }
        Images.load(holder.image, Api.imageUrl(item.poster), item.title)

        holder.itemView.setOnClickListener { onClick(position) }
        holder.itemView.setOnFocusChangeListener { v, hasFocus ->
            v.animate()
                .scaleX(if (hasFocus) 1.07f else 1f)
                .scaleY(if (hasFocus) 1.07f else 1f)
                .setDuration(120)
                .start()
        }
    }

    class Holder(view: View) : RecyclerView.ViewHolder(view) {
        val image: ImageView = view.findViewById(R.id.poster)
        val title: TextView = view.findViewById(R.id.title)
        val rate: TextView = view.findViewById(R.id.rate)
    }
}
