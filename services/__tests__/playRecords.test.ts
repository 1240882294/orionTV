// 内存版 AsyncStorage：测试里直接读 mockStore 断言落盘结果
const mockStore = new Map<string, string>();

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStore.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockStore.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      mockStore.delete(key);
    }),
    getAllKeys: jest.fn(async () => Array.from(mockStore.keys())),
  },
}));

jest.mock("../api", () => ({
  api: {
    getPlayRecords: jest.fn(async () => ({})),
    savePlayRecord: jest.fn(async () => ({ success: true })),
    deletePlayRecord: jest.fn(async () => ({ success: true })),
  },
}));

jest.mock("../storageConfig", () => ({
  storageConfig: {
    getStorageType: () => "localstorage",
  },
}));

import { PlayRecordManager } from "../storage";

const PLAY_RECORDS_KEY = "mytv_play_records";

const readRecords = (): Record<string, { title?: string; year?: string; play_time?: number }> =>
  JSON.parse(mockStore.get(PLAY_RECORDS_KEY) || "{}");

const makeRecord = (title: string, extra: Record<string, unknown> = {}) => ({
  title,
  cover: "https://example.com/cover.jpg",
  index: 1,
  total_episodes: 24,
  play_time: 120,
  total_time: 2400,
  source_name: "线路",
  year: "2024",
  ...extra,
});

beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
});

describe("PlayRecordManager 换线路去重", () => {
  it("换线路保存新记录时会清掉旧线路那条", async () => {
    await PlayRecordManager.save("sourceA", "1", makeRecord("庆余年"));
    expect(Object.keys(readRecords())).toEqual(["sourceA+1"]);

    await PlayRecordManager.save("sourceB", "2", makeRecord("庆余年"));

    expect(Object.keys(readRecords())).toEqual(["sourceB+2"]);
    // 旧线路的播放设置也一起清掉
    expect(mockStore.get("mytv_player_settings")).not.toContain("sourceA+1");
  });

  it("并发保存与去重时不会复活旧记录", async () => {
    await PlayRecordManager.save("sourceA", "1", makeRecord("庆余年"));

    await Promise.all([
      PlayRecordManager.save("sourceB", "2", makeRecord("庆余年")),
      PlayRecordManager.removeDuplicatesByTitle("庆余年", "sourceB+2", "2024"),
      PlayRecordManager.save("sourceC", "3", makeRecord("庆余年")),
    ]);

    const keys = Object.keys(readRecords());
    expect(keys).toHaveLength(1);
    expect(["sourceB+2", "sourceC+3"]).toContain(keys[0]);
  });

  it("被删除线路的进度不会被迟到的写入带回", async () => {
    await PlayRecordManager.save("sourceA", "1", makeRecord("漫长的季节"));

    // 模拟「去重」和「迟到的旧线路进度保存」交错发生
    const prune = PlayRecordManager.removeDuplicatesByTitle("漫长的季节", "sourceB+2", "2024");
    const lateSave = PlayRecordManager.save("sourceB", "2", makeRecord("漫长的季节"));
    await Promise.all([prune, lateSave]);

    const keys = Object.keys(readRecords());
    expect(keys).toHaveLength(1);
    expect(keys[0]).toBe("sourceB+2");
  });

  it("同名不同年份的影片不会被误删", async () => {
    await PlayRecordManager.save("sourceA", "1", makeRecord("射雕英雄传", { year: "1983" }));
    await PlayRecordManager.save("sourceB", "2", makeRecord("射雕英雄传", { year: "2017" }));

    expect(Object.keys(readRecords()).sort()).toEqual(["sourceA+1", "sourceB+2"]);
  });

  it("标题空格差异不会导致漏删", async () => {
    await PlayRecordManager.save("sourceA", "1", makeRecord(" 三体 "));
    await PlayRecordManager.save("sourceB", "2", makeRecord("三体"));

    expect(Object.keys(readRecords())).toEqual(["sourceB+2"]);
  });

  it("删除记录只删指定 key，其余记录保留", async () => {
    await PlayRecordManager.save("sourceA", "1", makeRecord("片甲"));
    await PlayRecordManager.save("sourceB", "2", makeRecord("片乙"));

    await PlayRecordManager.remove("sourceA", "1");

    expect(Object.keys(readRecords())).toEqual(["sourceB+2"]);
  });
});
