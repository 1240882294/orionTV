"""
生成首页环境壁纸（assets/images/bg-home.jpg）。

为什么不用现成的图片：
  1. 影视海报有版权，随便用一张会在应用商店审核时被抓；
  2. 网络图大小不可控，电视端首帧加载会拖慢启动；
  3. 这张图要满足很具体的约束 —— 顶部有氛围光、中下部必须沉到接近纯黑，
     否则海报卡片的对比度会掉。自己算最省事。

做法：
  四角双线性渐变打底 → 两三个高斯光斑用 screen 混合叠加（不是普通 alpha，
  screen 只提亮不压暗，光晕边缘才自然）→ 暗角 → 向下压暗 → 低频颗粒
  （颗粒是为了防 8bit 渐变在电视上出现色带，非常关键）。

用法：
  pip install numpy pillow
  python tools/genBackground.py

调参入口在文件末尾 build() 的调用里：
  corners  四个角的底色 (左上, 右上, 左下, 右下)
  glows    (cx, cy, rx, ry, color, power)，cx/cy/rx/ry 都是 0~1 的相对值
  fade     向下压暗强度，卡片区越挤就调越大
"""

import os
import numpy as np
from PIL import Image, ImageFilter

W, H = 1920, 1080
OUT = os.path.join(os.path.dirname(__file__), "..", "assets", "images", "bg-home.jpg")

yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
nx, ny = xx / W, yy / H


def base_grad(corners):
    c_tl, c_tr, c_bl, c_br = [np.array(c, np.float32) for c in corners]
    top = c_tl * (1 - nx)[..., None] + c_tr * nx[..., None]
    bot = c_bl * (1 - nx)[..., None] + c_br * nx[..., None]
    return top * (1 - ny)[..., None] + bot * ny[..., None]


def glow(img, cx, cy, rx, ry, color, power):
    """椭圆高斯光斑，screen 混合。power 别超过 0.45，否则整屏发灰。"""
    d = ((nx - cx) / rx) ** 2 + ((ny - cy) / ry) ** 2
    g = np.clip(np.exp(-d * 2.1) * power, 0, 1)[..., None]
    col = np.array(color, np.float32)[None, None, :] * g
    return 255.0 - (255.0 - img) * (255.0 - col) / 255.0


def finish(img, vig=0.40, fade=0.48, top_light=3.0):
    a = np.asarray(img, np.float32)
    # 暗角
    r = np.sqrt(((nx - 0.5) * 1.10) ** 2 + ((ny - 0.5) * 0.92) ** 2) / 0.60
    v = np.clip(1 - np.clip(r - 0.42, 0, 1) ** 1.5 * vig * 2.4, 0.15, 1)[..., None]
    a = a * v
    # 向下压暗：电视端最关键的一步，卡片区必须接近黑
    if fade:
        f = np.clip((ny - 0.18) / 0.82, 0, 1)[..., None] ** 1.25
        a = a * (1 - f * fade)
    # 顶部微亮，模拟环境光
    a = a + (np.clip(1 - ny * 3.0, 0, 1) ** 2 * top_light)[..., None]
    img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGB")
    return img.filter(ImageFilter.GaussianBlur(1.0))


def grain(img, amt=2.2):
    """低频颗粒。不加这层，1080p 电视上会出现明显的渐变色带。"""
    a = np.asarray(img, np.float32)
    rng = np.random.default_rng(9)
    s = rng.normal(0, amt, (H // 3, W // 3)).astype(np.float32)
    n = np.asarray(Image.fromarray((s + 128).astype(np.uint8)).resize((W, H), Image.BILINEAR), np.float32) - 128
    return Image.fromarray(np.clip(a + n[..., None], 0, 255).astype(np.uint8), "RGB")


def build(out_path, corners, glows, vig=0.40, fade=0.48, top=3.0):
    img = base_grad(corners)
    for g in glows:
        img = glow(img, *g)
    img = finish(img, vig, fade, top)
    img = grain(img)
    img.save(out_path, "JPEG", quality=88, optimize=True, progressive=True)
    print(out_path, os.path.getsize(out_path) // 1024, "KB")


if __name__ == "__main__":
    # 当前在用的是这一版：深海军蓝底 + 顶部左冷蓝、右上靛紫，中下部沉黑
    build(
        OUT,
        corners=((11, 17, 34), (13, 20, 42), (9, 12, 22), (11, 15, 28)),
        glows=[
            (0.10, -0.08, 0.58, 0.52, (30, 108, 215), 0.38),
            (0.94, 0.06, 0.50, 0.46, (92, 62, 178), 0.34),
        ],
        vig=0.40,
        fade=0.48,
        top=3.0,
    )
