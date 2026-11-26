import { fullPinyinOf, fullPinyinOfChar, fullPinyinVariantsOf } from "../pinyinFull";

describe("拼音全拼表", () => {
  it("常见剧名能转成全拼", () => {
    expect(fullPinyinOf("仙逆")).toBe("xianni");
    expect(fullPinyinOf("破事精英")).toBe("poshijingying");
    expect(fullPinyinOf("漫长的季节")).toBe("manchangdejijie");
    expect(fullPinyinOf("哈尔滨一九四四")).toBe("haerbinyijiusisi");
  });

  it("多音字返回全部读音，第一个是主读音", () => {
    const letters = fullPinyinOfChar("长");
    expect(letters).toContain("chang");
    expect(letters).toContain("zhang");
    expect(letters[0]).toBe("chang");
  });

  it("标点、空格不参与拼接（不然遥控器永远打不出来）", () => {
    expect(fullPinyinOf("庆余年 第二季")).toBe("qingyuniandierji");
    expect(fullPinyinOf("年会不能停！")).toBe("nianhuibunengting");
  });

  it("字母和数字原样保留", () => {
    expect(fullPinyinOf("三体2")).toBe("santi2");
    expect(fullPinyinOfChar("A")).toEqual(["a"]);
  });

  it("表外字符返回空", () => {
    expect(fullPinyinOfChar("★")).toEqual([]);
  });

  it("多音字变体有数量上限，不会组合爆炸", () => {
    const list = fullPinyinVariantsOf("长长的", 2);
    expect(list.length).toBeLessThanOrEqual(2);
    expect(list[0]).toBe("changchangde");
  });
});
