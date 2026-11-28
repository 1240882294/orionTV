import { API, ApiError } from "../api";
import { api } from "../api";
import { fetchDoubanSeeds } from "../searchSuggestIndex";

// api / 词库都间接用到存储，jest 下给个内存版本
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
    getAllKeys: jest.fn(async () => []),
  },
}));

/**
 * 电视端「联想词点下去搜索失败」的回归测试。
 *
 * 现场特征：同一个词，用系统输入法打中文能搜到，点联想词却报「搜索失败」；
 * 而且先用系统输入法搜过一次之后，再点联想词又好了。
 *
 * 原因有两层：
 *  1) 搜索页一打开就并发拉 10 个豆瓣榜单灌词库，把弱网带宽抢干；
 *  2) /api/search 只有 8 秒超时且不重试，首包等不到就直接抛给界面。
 * 第 2 条正是「用过一次之后就好了」的机制：第二次连接已经热了。
 */

const okResponse = (results: unknown[]) =>
  ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({ results }),
  }) as any;

describe("聚合搜索的超时与重试", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("第一次超时会自动重试，用户不会看到「搜索失败」", async () => {
    const client = new API("http://example.com");
    const fetchSpy = jest
      .spyOn(client as any, "performFetch")
      .mockRejectedValueOnce(new ApiError("TIMEOUT", "timeout"))
      .mockResolvedValueOnce(okResponse([{ id: 1, title: "仙逆" }]));

    const res = await client.searchVideos("仙逆");

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(res.results).toHaveLength(1);
  });

  it("断网不重试：重试也没用，只会让用户多等一轮", async () => {
    const client = new API("http://example.com");
    const fetchSpy = jest
      .spyOn(client as any, "performFetch")
      .mockRejectedValueOnce(new ApiError("NETWORK_ERROR", "network"));

    await expect(client.searchVideos("仙逆")).rejects.toBeInstanceOf(ApiError);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("401 不重试：_fetch 内部已经处理过重登", async () => {
    const client = new API("http://example.com");
    const fetchSpy = jest
      .spyOn(client as any, "performFetch")
      .mockRejectedValueOnce(new ApiError("UNAUTHORIZED", "unauthorized", 401));

    await expect(client.searchVideos("仙逆")).rejects.toBeInstanceOf(ApiError);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("搜索超时比普通请求宽松（否则弱网首包必挂）", async () => {
    const client = new API("http://example.com");
    const timeouts: number[] = [];
    jest
      .spyOn(client as any, "performFetch")
      .mockImplementation((_url: string, _init: any, timeoutMs: number) => {
        timeouts.push(timeoutMs);
        return Promise.resolve(okResponse([]));
      });

    await client.searchVideos("仙逆");

    expect(timeouts[0]).toBeGreaterThan(8000);
  });
});

describe("词库预热的豆瓣榜单限流", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("同时最多 2 个请求在飞，不能把首搜带宽抢干", async () => {
    let inFlight = 0;
    let peak = 0;
    const spy = jest.spyOn(api, "getDoubanData").mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return { list: [{ title: "某片" }] } as any;
    });

    const titles = await fetchDoubanSeeds();

    expect(spy).toHaveBeenCalledTimes(10);
    expect(peak).toBeLessThanOrEqual(2);
    expect(titles).toHaveLength(10);
  });
});
