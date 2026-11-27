#!/usr/bin/env python3
"""
测试版转正后，自动清理低版本测试版 Release。

规则：凡是 GitHub 上标记为 pre-release（测试版）的 Release，若其版本号
低于同一通道当前正式版（version.json 里登记的版本），就删掉 Release
连同标签。已转正的测试版不再需要留存 —— 更新检查只读 version.json /
version-test.json，删掉 Release 不影响任何已装机器升级。

用法：
    python3 tools/pruneBetaReleases.py            # 只列出，不删（预演）
    python3 tools/pruneBetaReleases.py --apply    # 真正删除

通道判定：tag 以 tv- 开头算电视端，phone- 开头算手机端。
版本比较：把 3.0.7-test.5 这样的串拆成 (3,0,7)，test 后缀视为低于同号正式版。
"""

import json
import re
import subprocess
import sys

REPO = "1240882294/orionTV"
APPLY = "--apply" in sys.argv


def gh(args: list) -> str:
    r = subprocess.run(["gh"] + args, capture_output=True, text=True, timeout=120)
    if r.returncode != 0:
        raise RuntimeError(f"gh {' '.join(args)} 失败: {r.stderr.strip()}")
    return r.stdout


def channel_of(tag: str) -> str:
    if tag.startswith("tv-"):
        return "tv"
    if tag.startswith("phone-"):
        return "phone"
    return "legacy"


def version_key(tag: str):
    """把 tag 转成可比较的元组：正式版 (x,y,z,0)，测试版 (x,y,z,-1)。"""
    m = re.match(r"^[a-z]+-v?(\d+)\.(\d+)\.(\d+)(-test\.\d+)?$", tag)
    if not m:
        return None
    major, minor, patch, test = m.groups()
    # 测试版排在同号正式版之前
    return (int(major), int(minor), int(patch), -1 if test else 0)


def main() -> None:
    formal = json.loads(open("version.json", encoding="utf-8").read())["channels"]
    formal_key = {}
    for ch in ("tv", "phone"):
        v = formal[ch]["version"]
        formal_key[ch] = version_key(f"x-v{v}")

    releases = json.loads(gh([f"api", f"repos/{REPO}/releases?per_page=100"]))
    betas = [r for r in releases if r.get("prerelease")]

    print(f"当前正式版：tv {formal['tv']['version']} / phone {formal['phone']['version']}")
    print(f"测试版共 {len(betas)} 个\n")

    doomed = []
    for r in betas:
        tag = r["tag_name"]
        ch = channel_of(tag)
        key = version_key(tag)
        if key is None or ch not in formal_key or formal_key[ch] is None:
            print(f"  跳过  {tag:22s} 无法判定版本/通道")
            continue
        if key < formal_key[ch]:
            doomed.append((tag, ch))
            print(f"  待删  {tag:22s} 低于 {ch} 正式版")
        else:
            print(f"  保留  {tag:22s} 不低于 {ch} 正式版")

    if not doomed:
        print("\n没有需要清理的测试版。")
        return

    if not APPLY:
        print(f"\n预演模式：共 {len(doomed)} 个待删。加 --apply 真正删除。")
        return

    print(f"\n开始删除 {len(doomed)} 个测试版……")
    for tag, _ in doomed:
        try:
            gh(["release", "delete", tag, "--yes", "--cleanup-tag"])
            print(f"  已删除  {tag}")
        except Exception as e:  # noqa: BLE001
            print(f"  失败    {tag}: {e}")


if __name__ == "__main__":
    main()
