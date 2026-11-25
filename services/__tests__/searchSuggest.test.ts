import { rankSuggestions, SuggestEntry } from "../searchSuggestIndex";
jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

jest.mock("../storage", () => ({
  FavoriteManager: { getAll: jest.fn(async () => ({})) },
  PlayRecordManager: { getAll: jest.fn(async () => ({})) },
  SearchHistoryManager: { get: jest.fn(async () => []) },
}));

jest.mock("../api", () => ({
  api: { getDoubanData: jest.fn(async () => ({ list: [] })) },
}));

const entry = (
  title: string,
  initials: string,
  hits = 1,
  updatedAt = 0,
  variants?: string[]
): SuggestEntry => ({
  title,
  initials,
  variants: variants ?? [initials],
  hits,
  updatedAt,
});

const LIBRARY: SuggestEntry[] = [
  entry("破事精英", "psjy", 5, 1000),
  entry("破冰行动", "pbxd", 3, 2000),
  entry("平凡的世界", "pfsj", 1, 3000),
  entry("庆余年", "qyn", 8, 4000),
  entry("庆余年 第二季", "qyndej", 4, 5000),
];

describe("首字母联想", () => {
  it("输入首字母能联想到中文剧名", () => {
    const list = rankSuggestions(LIBRARY, "ps");
    expect(list.map((i) => i.title)).toEqual(["破事精英"]);
  });

  it("前缀匹配多个时按命中次数排序", () => {
    const list = rankSuggestions(LIBRARY, "p");
    expect(list[0].title).toBe("破事精英"); // hits 最高
    expect(list).toHaveLength(3);
  });

  it("完全一致的首字母排在前面", () => {
    const list = rankSuggestions(LIBRARY, "qyn");
    expect(list[0].title).toBe("庆余年"); // 完全一致，优先于更长的 qyndej
    expect(list[1].title).toBe("庆余年 第二季");
  });

  it("没有匹配时返回空", () => {
    expect(rankSuggestions(LIBRARY, "zzz")).toEqual([]);
  });

  it("中文输入按标题包含匹配", () => {
    const list = rankSuggestions(LIBRARY, "庆余");
    expect(list.map((i) => i.title)).toContain("庆余年");
    expect(list.map((i) => i.title)).toContain("庆余年 第二季");
  });

  it("空输入不返回任何建议", () => {
    expect(rankSuggestions(LIBRARY, "")).toEqual([]);
    expect(rankSuggestions(LIBRARY, "   ")).toEqual([]);
  });

  it("限制返回条数", () => {
    expect(rankSuggestions(LIBRARY, "p", 2)).toHaveLength(2);
  });
});
