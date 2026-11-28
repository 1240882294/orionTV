// 内存版 AsyncStorage
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
    getSearchHistory: jest.fn(async () => []),
    addSearchHistory: jest.fn(async () => []),
    deleteSearchHistory: jest.fn(async () => ({ success: true })),
  },
}));

let mockStorageType: string | undefined = "localstorage";
jest.mock("../storageConfig", () => ({
  storageConfig: {
    getStorageType: () => mockStorageType,
  },
}));

import { SearchHistoryManager } from "../storage";
import { api } from "../api";

const mockApi = api as unknown as {
  getSearchHistory: jest.Mock;
  addSearchHistory: jest.Mock;
  deleteSearchHistory: jest.Mock;
};

/**
 * 电视端「最近搜索」的数据源。
 *
 * 之前全项目没有任何地方写过搜索历史，列表永远是空的；
 * 现在由搜索页在发起搜索时写入，且**不管服务端存储模式都留一份本地**，
 * 否则未登录的电视上这一列永远不出现。
 */
describe("搜索历史", () => {
  beforeEach(() => {
    mockStore.clear();
    mockStorageType = "localstorage";
    mockApi.getSearchHistory.mockReset();
    mockApi.getSearchHistory.mockResolvedValue([]);
    mockApi.addSearchHistory.mockReset();
    mockApi.addSearchHistory.mockResolvedValue([]);
  });

  it("本地模式：写入后能读出来，最新的在最前", async () => {
    await SearchHistoryManager.add("仙逆");
    await SearchHistoryManager.add("凡人修仙传");

    expect(await SearchHistoryManager.get()).toEqual(["凡人修仙传", "仙逆"]);
  });

  it("重复搜同一个词不会堆两条，而是提到最前", async () => {
    await SearchHistoryManager.add("仙逆");
    await SearchHistoryManager.add("花千骨");
    await SearchHistoryManager.add("仙逆");

    expect(await SearchHistoryManager.get()).toEqual(["仙逆", "花千骨"]);
  });

  it("最多保留 20 条", async () => {
    for (let i = 0; i < 25; i += 1) {
      await SearchHistoryManager.add(`片名${i}`);
    }
    const list = await SearchHistoryManager.get();
    expect(list).toHaveLength(20);
    expect(list[0]).toBe("片名24");
  });

  it("服务端模式：本地也写一份，未登录时仍能读到", async () => {
    mockStorageType = "api";
    mockApi.getSearchHistory.mockRejectedValue(new Error("未登录"));

    await SearchHistoryManager.add("仙逆");

    expect(mockApi.addSearchHistory).toHaveBeenCalledWith("仙逆");
    expect(await SearchHistoryManager.get()).toEqual(["仙逆"]);
  });

  it("服务端模式：服务端有数据时优先用服务端的", async () => {
    mockStorageType = "api";
    mockApi.getSearchHistory.mockResolvedValue(["服务端记录"]);

    expect(await SearchHistoryManager.get()).toEqual(["服务端记录"]);
  });

  it("空词不写", async () => {
    await SearchHistoryManager.add("   ");
    expect(await SearchHistoryManager.get()).toEqual([]);
  });
});
