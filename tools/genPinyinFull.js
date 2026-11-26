#!/usr/bin/env node
/**
 * 生成 utils/pinyinFull.ts —— 汉字 → 拼音全拼的离线字表。
 *
 * 为什么需要它：
 * 电视端搜索页要让人用遥控器点字母就把中文剧名搜出来。只有首字母表不够 ——
 * 用户点 `xianni` 得能命中「仙逆」，点 `xiann` 也得能命中。所以需要每个字的
 * 完整拼音（不含声调），才能把「标题 → 拼音串」拼出来做前缀匹配。
 *
 * 用法：
 *   npm i pinyin-pro --no-save
 *   node tools/genPinyinFull.js
 *
 * 产物会覆盖 utils/pinyinFull.ts，不要手改生成物。
 * 表体积约 70KB（比首字母表还小），打进 APK 增量约 20KB。
 */
const fs = require("fs");
const path = require("path");

let pinyin;
try {
  ({ pinyin } = require("pinyin-pro"));
} catch (e) {
  console.error("[gen-pinyin] 缺少依赖，请先执行：npm i pinyin-pro --no-save");
  process.exit(1);
}

const groups = {}; // 全拼 -> 该读音的字（合并成一个字符串省体积）
const multi = {}; // 多音字 -> 空格分隔的多个读音
let count = 0;

for (let cp = 0x4e00; cp <= 0x9fa5; cp++) {
  const ch = String.fromCodePoint(cp);
  let arr;
  try {
    arr = pinyin(ch, { multiple: true, toneType: "none", type: "array" });
  } catch {
    arr = [];
  }
  if (!Array.isArray(arr) || !arr.length) continue;
  const list = [...new Set(arr.map((s) => s.replace(/[^a-z]/g, "")).filter(Boolean))];
  if (!list.length) continue;
  (groups[list[0]] = groups[list[0]] || []).push(ch);
  if (list.length > 1) multi[ch] = list.join(" ");
  count++;
}

const keys = Object.keys(groups).sort();
let out = "";
out += "// 由 tools/genPinyinFull.js 调用 pinyin-pro 离线生成，请勿手改。\n";
out += `// 覆盖 Unicode 基本汉字区 U+4E00–U+9FA5 共 ${count} 字，${keys.length} 个音节（不含声调）。\n`;
out += "// GROUPS 按全拼归组；MULTI 是多音字，值是空格分隔的所有读音，第一个为最常用读音。\n";
out += "// 运行时零依赖：启动时建一次反查表，之后只做查表 + 字符串拼接。\n\n";
out += "const GROUPS: Record<string, string> = {\n";
for (const k of keys) out += `  ${JSON.stringify(k)}: ${JSON.stringify(groups[k].join(""))},\n`;
out += "};\n\n";
out += "const MULTI: Record<string, string> = {\n";
for (const k of Object.keys(multi).sort()) out += `  ${JSON.stringify(k)}: ${JSON.stringify(multi[k])},\n`;
out += "};\n\n";

out += `
/** 汉字 -> 所有拼音（多音字多个，第一个最常用）。字母数字原样返回。 */
const CHAR_TO_PINYIN: Map<string, string[]> = (() => {
  const map = new Map<string, string[]>();
  for (const [py, chars] of Object.entries(GROUPS)) {
    for (const ch of chars) {
      const cur = map.get(ch);
      if (cur) cur.push(py);
      else map.set(ch, [py]);
    }
  }
  for (const [ch, list] of Object.entries(MULTI)) {
    map.set(ch, list.split(" "));
  }
  return map;
})();

/** 取单个字符的所有读音；标点、表外字返回空数组 */
export function fullPinyinOfChar(ch: string): string[] {
  if (!ch) return [];
  const lower = ch.toLowerCase();
  if (/^[a-z0-9]$/.test(lower)) return [lower];
  return CHAR_TO_PINYIN.get(ch) ?? [];
}

/**
 * 把标题转成全拼串（不含声调、不含分隔符），多音字取最常用读音。
 * 「破事精英」 -> poshijingying
 */
export function fullPinyinOf(text: string): string {
  if (!text) return "";
  let out = "";
  for (const ch of text) {
    const list = fullPinyinOfChar(ch);
    if (list.length) out += list[0];
  }
  return out;
}

/** 把标题切成音节数组，用于按词边界做更精确的匹配 */
export function pinyinSyllablesOf(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const ch of text) {
    const list = fullPinyinOfChar(ch);
    if (list.length) out.push(list[0]);
  }
  return out;
}

/**
 * 展开多音字，得到若干种全拼写法，第一个一定是主读音。
 *
 * 只会对**真正有多音字**的标题展开，且用 maxVariants 封顶 ——
 * 四字标题全是多音字时组合会爆炸（2^4），没必要。
 * 全拼写法的收益远小于首字母（用户打全拼时基本就打主读音），
 * 所以只做 4 种，够兜住「甄嬛传 = zhenhuanchuan / zhenqiongchuan」这类。
 */
export function fullPinyinVariantsOf(text: string, maxVariants = 4): string[] {
  if (!text) return [];
  const parts: string[][] = [];
  for (const ch of text) {
    const list = fullPinyinOfChar(ch);
    if (list.length) parts.push(list);
  }
  if (!parts.length) return [];

  const out: string[] = [];
  const walk = (index: number, acc: string) => {
    if (out.length >= maxVariants) return;
    if (index === parts.length) {
      if (!out.includes(acc)) out.push(acc);
      return;
    }
    for (const py of parts[index]) {
      if (out.length >= maxVariants) return;
      walk(index + 1, acc + py);
    }
  };
  walk(0, "");
  return out;
}
`;

const target = path.join(__dirname, "..", "utils", "pinyinFull.ts");
fs.writeFileSync(target, out);
console.log(`[gen-pinyin] 写入 ${target}：${count} 字 / ${keys.length} 音节 / ${out.length} 字节`);
