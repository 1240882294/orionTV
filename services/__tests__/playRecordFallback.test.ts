/**
 * 播放记录跨线路兜底。
 *
 * 记录按「线路 + id」存，换线路后新线路查不到自己的记录 —— 这是
 * 「切完线路要求手动选集」的根因。findByTitle 负责拿同剧旧线路的记录顶上。
 */
import { PlayRecordManager } from "../storage";
import { api } from "../api";

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

jest.mock("../api", () => ({
  api: {
    getPlayRecords: jest.fn(async () => ({})),
    savePlayRecord: jest.fn(async () => undefined),
    deletePlayRecord: jest.fn(async () => undefined),
  },
}));

const mockGetAll = api.getPlayRecords as jest.Mock;

const record = (over: Partial<Record<string, unknown>> = {}) => ({
  title: "狂飙",
  source_name: "线路A",
  cover: "",
  index: 5,
  total_episodes: 39,
  play_time: 600,
  total_time: 2400,
  save_time: 100,
  year: "2023",
  ...over,
});

beforeEach(() => {
  mockGetAll.mockReset();
});

describe("PlayRecordManager.findByTitle", () => {
  it("同剧多条线路时取最近更新的那条", async () => {
    mockGetAll.mockResolvedValue({
      "a+1": record({ source_name: "线路A", index: 5, play_time: 600, save_time: 100 }),
      "b+2": record({ source_name: "线路B", index: 7, play_time: 900, save_time: 200 }),
      "c+3": record({ title: "三体", source_name: "线路C", index: 2, save_time: 300 }),
    });

    const hit = await PlayRecordManager.findByTitle("狂飙", "2023");
    expect(hit).not.toBeNull();
    expect(hit?.index).toBe(7);
    expect(hit?.play_time).toBe(900);
  });

  it("标题里的空格不影响匹配", async () => {
    mockGetAll.mockResolvedValue({
      "a+1": record({ title: "漫长的 季节", save_time: 10 }),
    });

    const hit = await PlayRecordManager.findByTitle("漫长的季节");
    expect(hit?.title).toBe("漫长的 季节");
  });

  it("同名不同年不互相顶替", async () => {
    mockGetAll.mockResolvedValue({
      "a+1": record({ year: "1998", save_time: 10 }),
    });

    expect(await PlayRecordManager.findByTitle("狂飙", "2023")).toBeNull();
  });

  it("只有一条记录、年份缺失时仍然匹配", async () => {
    mockGetAll.mockResolvedValue({
      "a+1": record({ year: "", save_time: 10 }),
    });

    const hit = await PlayRecordManager.findByTitle("狂飙", "2023");
    expect(hit).not.toBeNull();
  });

  it("查不到时返回 null", async () => {
    mockGetAll.mockResolvedValue({
      "a+1": record({ title: "繁花" }),
    });

    expect(await PlayRecordManager.findByTitle("狂飙")).toBeNull();
  });

  it("空标题直接返回 null，不去扫全表", async () => {
    expect(await PlayRecordManager.findByTitle("   ")).toBeNull();
    expect(mockGetAll).not.toHaveBeenCalled();
  });
});
