import { groupByTitle, normalizeTitle } from "../searchGrouping";
import type { SearchResult } from "../api";

/** 造一条搜索结果：只有 source 不同，其余照抄，模拟「同一部剧在 N 个源」 */
function makeItem(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: 1,
    title: "愚者之夜",
    poster: "https://img.example/a.jpg",
    episodes: ["https://cdn.example/1.m3u8"],
    source: "ffzy",
    source_name: "非凡影视",
    year: "2026",
    ...overrides,
  };
}

describe("搜索结果按线路聚合", () => {
  it("同一部剧的多个源折叠成一张卡，线路数等于源数", () => {
    const list = [
      makeItem({ source: "ffzy", source_name: "非凡影视" }),
      makeItem({ source: "360", source_name: "360资源" }),
      makeItem({ source: "maoyan", source_name: "TV-猫眼资源" }),
    ];

    const groups = groupByTitle(list);

    expect(groups).toHaveLength(1);
    expect(groups[0].sources).toHaveLength(3);
    expect(groups[0].title).toBe("愚者之夜");
  });

  it("不同剧不会互相合并（剧名不同就分开）", () => {
    const list = [
      makeItem({ title: "愚者之夜" }),
      makeItem({ title: "仙逆", source: "360" }),
      makeItem({ title: "破事精英", source: "maoyan" }),
    ];

    expect(groupByTitle(list).map((g) => g.title)).toEqual(["愚者之夜", "仙逆", "破事精英"]);
  });

  it("输出顺序保持服务端返回的顺序，不重排", () => {
    const list = [
      makeItem({ title: "B剧", source: "s1" }),
      makeItem({ title: "A剧", source: "s1" }),
      makeItem({ title: "B剧", source: "s2" }),
    ];

    expect(groupByTitle(list).map((g) => g.title)).toEqual(["B剧", "A剧"]);
  });

  it("同名但年份都不同时拆成两部（动画 / 电视剧）", () => {
    const list = [
      makeItem({ title: "三体", year: "2023", source: "s1" }),
      makeItem({ title: "三体", year: "2024", source: "s2" }),
      makeItem({ title: "三体", year: "2023", source: "s3" }),
    ];

    const groups = groupByTitle(list);

    expect(groups).toHaveLength(2);
    expect(groups[0].sources.map((s) => s.source)).toEqual(["s1", "s3"]);
    expect(groups[1].sources.map((s) => s.source)).toEqual(["s2"]);
  });

  it("一方年份为空时仍合并，不因为缺年份拆卡", () => {
    const list = [
      makeItem({ title: "三体", year: "2023", source: "s1" }),
      makeItem({ title: "三体", year: "", source: "s2" }),
    ];

    const groups = groupByTitle(list);

    expect(groups).toHaveLength(1);
    expect(groups[0].year).toBe("2023");
  });

  it("标题里的年份/清晰度标注不参与比较（愚者之夜(2026) 与 愚者之夜 合并）", () => {
    const list = [
      makeItem({ title: "愚者之夜(2026)", year: "2026", source: "s1" }),
      makeItem({ title: "愚者之夜【HD】", year: "2026", source: "s2" }),
      makeItem({ title: "愚者之夜", year: "2026", source: "s3" }),
    ];

    expect(groupByTitle(list)).toHaveLength(1);
  });

  it("全角空格和全角括号也能归一化到同一个 key", () => {
    expect(normalizeTitle("愚者之夜（2026）")).toBe(normalizeTitle("愚者之夜"));
    expect(normalizeTitle("　愚者之夜  ")).toBe("愚者之夜");
  });

  it("集数取组内最全的那个源，不是求和", () => {
    const list = [
      makeItem({ source: "s1", episodes: ["1", "2"] }),
      makeItem({ source: "s2", episodes: ["1", "2", "3", "4", "5"] }),
      makeItem({ source: "s3", episodes: [] }),
    ];

    expect(groupByTitle(list)[0].totalEpisodes).toBe(5);
  });

  it("空列表和空标题不会崩", () => {
    expect(groupByTitle([])).toEqual([]);
    expect(groupByTitle([makeItem({ title: "  " })])).toEqual([]);
  });
});
