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

interface EntryOptions {
  initials: string;
  hits?: number;
  updatedAt?: number;
  variants?: string[];
  fullPinyin?: string;
  fullVariants?: string[];
  firstSyllable?: string;
}

const entry = (title: string, opts: EntryOptions): SuggestEntry => ({
  title,
  initials: opts.initials,
  variants: opts.variants ?? [opts.initials],
  fullPinyin: opts.fullPinyin ?? "",
  fullVariants: opts.fullVariants ?? (opts.fullPinyin ? [opts.fullPinyin] : []),
  firstSyllable: opts.firstSyllable ?? "",
  hits: opts.hits ?? 1,
  updatedAt: opts.updatedAt ?? 0,
  seed: false,
});

const LIBRARY: SuggestEntry[] = [
  entry("破事精英", { initials: "psjy", hits: 5, updatedAt: 1000, fullPinyin: "poshijingying", firstSyllable: "po" }),
  entry("破冰行动", { initials: "pbxd", hits: 3, updatedAt: 2000, fullPinyin: "pobingxingdong", firstSyllable: "po" }),
  entry("平凡的世界", { initials: "pfsj", hits: 1, updatedAt: 3000, fullPinyin: "pingfandeshijie", firstSyllable: "ping" }),
  entry("庆余年", { initials: "qyn", hits: 8, updatedAt: 4000, fullPinyin: "qingyunian", firstSyllable: "qing" }),
  entry("庆余年 第二季", { initials: "qyndej", hits: 4, updatedAt: 5000, fullPinyin: "qingyuniandierji", firstSyllable: "qing" }),
  entry("仙逆", { initials: "xn", hits: 2, updatedAt: 6000, fullPinyin: "xianni", firstSyllable: "xian" }),
  entry("仙剑奇侠传", { initials: "xjqxc", hits: 2, updatedAt: 6000, fullPinyin: "xianjianqixiachuan", firstSyllable: "xian" }),
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

describe("全拼联想（电视端字母键盘）", () => {
  it("完整全拼能命中", () => {
    expect(rankSuggestions(LIBRARY, "xianni").map((i) => i.title)).toEqual(["仙逆"]);
  });

  it("全拼只打到一半也能命中（不用等打完）", () => {
    const titles = rankSuggestions(LIBRARY, "xian").map((i) => i.title);
    expect(titles).toContain("仙逆");
    expect(titles).toContain("仙剑奇侠传");
  });

  it("首字母和全拼并存，两种打法都能命中同一部片", () => {
    expect(rankSuggestions(LIBRARY, "psjy")[0].title).toBe("破事精英");
    expect(rankSuggestions(LIBRARY, "poshijing")[0].title).toBe("破事精英");
    expect(rankSuggestions(LIBRARY, "poshijingying")[0].title).toBe("破事精英");
  });

  it("全拼打错时不瞎猜", () => {
    expect(rankSuggestions(LIBRARY, "qwerty")).toEqual([]);
  });
});

describe("排序不跑偏", () => {
  // 「降临」的「降」是多音字（jiang / xiang），xianglin 会以 xian 开头，
  // 但它只有两个字 —— 只按标题长度排就会挤掉用户真正想要的「仙逆 第一季」。
  const tricky: SuggestEntry[] = [
    entry("降临", { initials: "jl", fullPinyin: "jianglin", fullVariants: ["jianglin", "xianglin"], firstSyllable: "jiang" }),
    entry("仙逆 第一季", { initials: "xndyj", fullPinyin: "xiannidiyiji", firstSyllable: "xian" }),
    entry("香水", { initials: "xs", fullPinyin: "xiangshui", firstSyllable: "xiang" }),
  ];

  it("首音节整段命中优先于多音变体的巧合匹配", () => {
    const list = rankSuggestions(tricky, "xian");
    expect(list[0].title).toBe("仙逆 第一季");
  });

  it("短标题但只是变体命中的，排在后面", () => {
    const titles = rankSuggestions(tricky, "xian").map((i) => i.title);
    expect(titles.indexOf("仙逆 第一季")).toBeLessThan(titles.indexOf("降临"));
  });
});
