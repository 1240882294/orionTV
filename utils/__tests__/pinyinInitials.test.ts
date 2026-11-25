import { initialsOf, initialOfChar, initialsVariantsOf } from "../pinyinInitials";

describe("拼音首字母表", () => {
  it("常见剧名转首字母", () => {
    expect(initialsOf("破事精英")).toBe("psjy");
    expect(initialsOf("十万狂花入梦来")).toBe("swkhrml");
    expect(initialsOf("三体")).toBe("st");
    expect(initialsOf("狂飙")).toBe("kb");
  });

  it("忽略空格与标点，数字保留", () => {
    expect(initialsOf("庆余年 第二季")).toBe("qyndej");
    expect(initialsOf("长安十二时辰 (2019)")).toBe("casesc2019");
    expect(initialsOf(" 漫长的季节 ")).toBe("mcdjj");
  });

  it("字母和数字原样保留，英文名可混排", () => {
    expect(initialsOf("CSI 犯罪现场")).toBe("csifzxc");
    expect(initialsOf("1920")).toBe("1920");
  });

  it("生僻字也能取到首字母", () => {
    expect(initialsOf("琅琊榜")).toBe("lyb");
    expect(initialsOf("「开端」")).toBe("kd");
  });

  it("多音字会展开成多种写法", () => {
    // 「嬛」首读音是 qiong，但观众更常读 huan，两种都得能联想
    expect(initialsOf("甄嬛传")).toBe("zqc");
    const variants = initialsVariantsOf("甄嬛传");
    expect(variants[0]).toBe("zqc");
    expect(variants).toContain("zhz");

    expect(initialsVariantsOf("长安十二时辰")).toContain("zasesc");
    expect(initialsVariantsOf("长安十二时辰")[0]).toBe("casesc");
  });

  it("展开数量有上限，防止组合爆炸", () => {
    // 四个多音字组成的标题组合数会超限，这里只保证不超过上限且主串在前
    const variants = initialsVariantsOf("长长长长长", 8);
    expect(variants.length).toBeLessThanOrEqual(8);
    expect(variants[0]).toBe("ccccc");
  });

  it("单字转换", () => {
    expect(initialOfChar("破")).toBe("p");
    expect(initialOfChar("A")).toBe("a");
    expect(initialOfChar("7")).toBe("7");
    expect(initialOfChar("，")).toBe("");
  });

  it("空值安全", () => {
    expect(initialsOf("")).toBe("");
    expect(initialsOf("   ")).toBe("");
  });
});
