jest.mock("../api", () => ({
  api: { measureThroughput: jest.fn() },
}));

import fs from "fs";
import path from "path";

import { api } from "../api";
import { testSourcesSpeed, type SourceSpeedResult } from "../sourceSpeedTest";
import { filterCandidates, pickBestSource, splitByCacheCoverage } from "../sourceSelection";

const MB = 1024 * 1024;

const target = (source: string) => ({ source, source_name: `线路${source}` });

const speed = (source: string, bytesPerSec: number): SourceSpeedResult => ({
  source,
  bytesPerSec,
  ms: 100,
  bytes: 1024,
  ok: true,
  method: "api",
});

/**
 * 启动流程回归：打开视频 → 拉取线路 → 补测缺的 → 挑最优 → 15 秒看门狗排除重选。
 *
 * 这里覆盖的是纯决策部分（缓存覆盖度、测速提前退出、挑最优、失败线路排除），
 * 也就是 3.0.10 之前出问题的那几段。
 */
describe("启动流程", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("缓存只覆盖 3 条时，8 条候选全部参与，缺的 5 条都要补测", () => {
    const candidates = ["a", "b", "c", "d", "e", "f", "g", "h"].map(target);
    const cached = {
      a: speed("a", 1 * MB),
      b: speed("b", 2 * MB),
      c: speed("c", 900 * 1024),
    };

    const { hit, missing } = splitByCacheCoverage(candidates, cached);

    expect(Object.keys(hit).sort()).toEqual(["a", "b", "c"]);
    expect(missing.map((item) => item.source)).toEqual(["d", "e", "f", "g", "h"]);
  });

  it("缓存里的失败结果不算覆盖，必须补测", () => {
    const candidates = ["a", "b"].map(target);
    const cached = {
      a: speed("a", 2 * MB),
      b: { ...speed("b", 0), bytesPerSec: null, ok: false, method: "none" as const },
    };

    const { hit, missing } = splitByCacheCoverage(candidates, cached);

    expect(Object.keys(hit)).toEqual(["a"]);
    expect(missing.map((item) => item.source)).toEqual(["b"]);
  });

  it("当前线路够快时至少测 3 条才提前结束，且在途已完成的结果不会被丢掉", async () => {
    // 前两条并发起跑：a 很快，b 很慢。a 完成后会继续领 c、d，
    // 到第 3 条时触发提前结束 —— 此时 b 还在途，它的结果必须保留。
    const delays: Record<string, number> = { a: 1, b: 60, c: 1, d: 1, e: 60 };
    (api.measureThroughput as jest.Mock).mockImplementation(async (_q: string, source: string) => {
      const ms = delays[source] ?? 5;
      await new Promise((resolve) => setTimeout(resolve, ms));
      return { bytes: 2 * MB, ms };
    });

    const candidates = ["a", "b", "c", "d", "e"].map(target);
    const results = await testSourcesSpeed(candidates, "测试片", undefined, {
      concurrency: 2,
      totalTimeoutMs: 5000,
      shouldStop: (partial, done, total) =>
        done >= Math.min(3, total) && (partial.a?.bytesPerSec ?? 0) >= MB,
    });

    expect(Object.keys(results).length).toBeGreaterThanOrEqual(3);
    expect(results.b).toBeDefined();
    expect(results.b?.ok).toBe(true);
  });

  it("候选不足 3 条时不会提前结束，全部测完", async () => {
    (api.measureThroughput as jest.Mock).mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return { bytes: 2 * MB, ms: 1 };
    });

    const results = await testSourcesSpeed(["a", "b"].map(target), "测试片", undefined, {
      concurrency: 2,
      totalTimeoutMs: 5000,
      shouldStop: (partial, done, total) =>
        done >= Math.min(3, total) && (partial.a?.bytesPerSec ?? 0) >= MB,
    });

    expect(Object.keys(results).sort()).toEqual(["a", "b"]);
  });

  it("挑最优：当前线路不足最快的一半就换线", () => {
    const candidates = ["a", "b"].map(target);
    const speeds = { a: speed("a", 500 * 1024), b: speed("b", 2 * MB) };

    const pick = pickBestSource(candidates, speeds, "a");

    expect(pick?.chosen.source).toBe("b");
    expect(pick?.switched).toBe(true);
  });

  it("挑最优：当前线路够快就保留用户选择", () => {
    const candidates = ["a", "b"].map(target);
    const speeds = { a: speed("a", 1.2 * MB), b: speed("b", 2 * MB) };

    const pick = pickBestSource(candidates, speeds, "a");

    expect(pick?.chosen.source).toBe("a");
    expect(pick?.switched).toBe(false);
  });

  it("挑最优：当前线路测速失败时换到有速度的那条", () => {
    const candidates = ["a", "b"].map(target);
    const speeds = { a: { ...speed("a", 0), bytesPerSec: null, ok: false }, b: speed("b", MB) };

    const pick = pickBestSource(candidates, speeds, "a");

    expect(pick?.chosen.source).toBe("b");
  });

  it("挑最优：全部没速度时仍返回用户选的线路，不能空手", () => {
    const candidates = ["a", "b"].map(target);
    const pick = pickBestSource(candidates, {}, "a");

    expect(pick?.chosen.source).toBe("a");
    expect(pick?.bps).toBe(0);
  });

  it("看门狗：排除失败线路后不会再选中它；全部排除时退回全集", () => {
    const candidates = ["a", "b", "c"].map(target);

    const afterFirst = filterCandidates(candidates, new Set(["a"]));
    expect(afterFirst.map((item) => item.source)).toEqual(["b", "c"]);

    const afterSecond = filterCandidates(candidates, new Set(["a", "b"]));
    expect(afterSecond.map((item) => item.source)).toEqual(["c"]);

    // 三轮都失败：不能返回空数组，否则播放页拿不到任何线路
    const allExcluded = filterCandidates(candidates, new Set(["a", "b", "c"]));
    expect(allExcluded).toHaveLength(3);
  });
});

describe("播放准备流程（源码约束）", () => {
  const playSource = fs.readFileSync(path.resolve(__dirname, "../../app/play.tsx"), "utf8");

  it("init 必须等全量线路，不能再挂 12 秒总闸", () => {
    expect(playSource).toContain("await state.init(title, source, id);");
    expect(playSource).not.toContain("INIT_TIMEOUT_MS");
    // 总闸一旦回到 init 上，继续观看直进播放就只剩 1 条线路
    expect(playSource).not.toMatch(/Promise\.race\(\s*\[\s*state\.init/);
  });

  it("15 秒无画面要重选，并且是累积排除失败线路", () => {
    expect(playSource).toContain("const FIRST_FRAME_TIMEOUT_MS = 15000");
    expect(playSource).toContain("excludedSourcesRef.current.add(currentSource)");
    expect(playSource).toContain("useRef<Set<string>>(new Set())");
  });

  it("测速前先按缓存覆盖度拆分，缺的补测", () => {
    expect(playSource).toContain("splitByCacheCoverage(candidates, cachedAll)");
    expect(playSource).toContain("pickBestSource(candidates, speeds, preferredSource)");
  });
});
