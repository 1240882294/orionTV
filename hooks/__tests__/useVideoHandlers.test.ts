import React from "react";
import TestRenderer, { act } from "react-test-renderer";

// playerStore 间接依赖 AsyncStorage，jest 下给个内存版本
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
    getAllKeys: jest.fn(async () => []),
  },
}));

import { useVideoHandlers } from "../useVideoHandlers";

/**
 * 手机端「画面出来了却是暂停、点播放报操作失败」的回归测试。
 *
 * 现场特征：从「最近观看」进播放页，画面已经正确，但停在暂停；
 * 点中间播放键弹「操作失败」。
 *
 * 原因：onLoad 里「先 seek 再 play」串行 await。HLS seek 要现拉目标分片，
 * 弱网下卡住或抛错，后面那句 playAsync 就永远不执行 —— 播放指令从未发出。
 */

type Call = "play" | "seek";

function setup(initialPosition: number, seekImpl?: () => Promise<void>) {
  const calls: Call[] = [];
  const video = {
    playAsync: jest.fn(async () => {
      calls.push("play");
      return { isLoaded: true, isPlaying: true };
    }),
    setPositionAsync: jest.fn(async () => {
      calls.push("seek");
      if (seekImpl) await seekImpl();
      return { isLoaded: true, isPlaying: false };
    }),
  };
  const videoRef = { current: video } as any;

  let handlers: any;
  function Probe() {
    handlers = useVideoHandlers({
      videoRef,
      currentEpisode: { url: "http://example.com/a.m3u8", title: "第1集" },
      sourceUrl: "http://example.com/a.m3u8",
      initialPosition,
      playbackRate: 1,
      handlePlaybackStatusUpdate: () => undefined,
      deviceType: "mobile",
    });
    return null;
  }

  act(() => {
    TestRenderer.create(React.createElement(Probe));
  });

  return { calls, video, handlers };
}

describe("起播顺序：播放不能被 seek 挡住", () => {
  it("带进度进入时，play 先发出去，seek 在后面", async () => {
    const { calls, handlers } = setup(954000);

    await act(async () => {
      await handlers.onLoad();
    });

    expect(calls[0]).toBe("play");
    expect(calls).toContain("seek");
  });

  it("seek 抛错（弱网拉不到目标分片）时已经起播，且不把错误抛给界面", async () => {
    const { video, handlers } = setup(954000, () => Promise.reject(new Error("seek timeout")));

    await expect(
      act(async () => {
        await handlers.onLoad();
      })
    ).resolves.not.toThrow();

    expect(video.playAsync).toHaveBeenCalledTimes(1);
  });

  it("seek 结束后补一枪 play：部分机型 seek 完成会把状态重置成暂停", async () => {
    const { video, handlers } = setup(954000);

    await act(async () => {
      await handlers.onLoad();
    });

    expect(video.playAsync).toHaveBeenCalledTimes(2);
  });

  it("seek 带宽容度，不做精确对齐（HLS 精确 seek 会卡十几秒）", async () => {
    const { video, handlers } = setup(954000);

    await act(async () => {
      await handlers.onLoad();
    });

    const [, tolerances] = video.setPositionAsync.mock.calls[0];
    expect(tolerances).toEqual(
      expect.objectContaining({
        toleranceMillisBefore: expect.any(Number),
        toleranceMillisAfter: expect.any(Number),
      })
    );
  });

  it("从头播放（无进度）时只调一次 play，不产生多余 seek", async () => {
    const { video, handlers } = setup(0);

    await act(async () => {
      await handlers.onLoad();
    });

    expect(video.playAsync).toHaveBeenCalledTimes(1);
    expect(video.setPositionAsync).not.toHaveBeenCalled();
  });
});
