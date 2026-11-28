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

import fs from "fs";
import path from "path";
import { PlayRecordManager } from "../storage";

const PLAY_RECORDS_KEY = "mytv_play_records";

const readRecords = (): Record<string, { title?: string; year?: string }> =>
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

/**
 * 历史 bug：「获取不到视频之后，最近观看里那条记录消失了」。
 *
 * 根因不是记录写入失败，而是 detailStore.setDetail 在切线路时无条件调用
 * removeDuplicatesByTitle(title, 新线路key) —— 新线路一帧都没播，它自己的记录
 * 还不存在，这次「去重」删掉的其实是唯一的旧记录。
 */
describe("切线路误删最近观看（历史 bug 复现）", () => {
  it("新线路还没有记录时，按标题去重会把唯一一条删光", async () => {
    await PlayRecordManager.save("sourceA", "1", makeRecord("庆余年"));
    expect(Object.keys(readRecords())).toEqual(["sourceA+1"]);

    // v1.3.0-test.3 起，setDetail 切到 sourceB 时执行的就是这一句
    await PlayRecordManager.removeDuplicatesByTitle("庆余年", "sourceB+2", "2024");

    // 结果：这部剧从「最近观看」里彻底消失
    expect(Object.keys(readRecords())).toEqual([]);
  });

  it("修复后：只有新线路真正写入记录时才清理旧线路那条", async () => {
    await PlayRecordManager.save("sourceA", "1", makeRecord("庆余年"));
    // 切到 sourceB 但没有产生新记录 —— 旧记录必须原样保留
    expect(Object.keys(readRecords())).toEqual(["sourceA+1"]);

    // 等 sourceB 真正播起来、写入记录时，写入路径顺手清掉旧线路
    await PlayRecordManager.save("sourceB", "2", makeRecord("庆余年"));
    expect(Object.keys(readRecords())).toEqual(["sourceB+2"]);
  });

  it("setDetail 里不再出现按标题删除记录的调用（防回归）", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../../stores/detailStore.ts"),
      "utf8"
    );
    const start = source.indexOf("setDetail: async");
    expect(start).toBeGreaterThan(-1);

    const body = source.slice(start, start + 900);
    expect(body).not.toContain("removeDuplicatesByTitle");
  });
});
