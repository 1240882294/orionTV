import fs from "fs";
import path from "path";

const read = (relative: string) =>
  fs.readFileSync(path.resolve(__dirname, "../../" + relative), "utf8");

/**
 * 历史 bug 回归（源码约束）。
 *
 * 这里的每一条都对应一个真实上线过的问题；用静态断言锁住，
 * 避免以后重构时又悄悄退回去（尤其是「顺手优化」最容易复发的几处）。
 * 交互类问题（投屏、键盘搜索、焦点）无法在此覆盖，仍需实机回归。
 */
describe("历史 bug 回归", () => {
  it("继续观看卡片集数是 1 基，三端都不再多加 1", () => {
    const cards = [
      "components/VideoCard.mobile.tsx",
      "components/VideoCard.tablet.tsx",
      "components/VideoCard.tv.tsx",
    ];
    cards.forEach((file) => {
      const src = read(file);
      expect(src).toContain("第{episodeIndex}集");
      expect(src).not.toContain("第{episodeIndex + 1}");
      expect(src).not.toContain("第{episodeIndex! + 1}");
    });
  });

  it("带进度进入播放时以播放记录为准（卡片与播放页不再打架）", () => {
    expect(read("stores/playerStore.ts")).toContain("Restore from record");
  });

  it("切线路 30 秒内不写记录（坏线路不会覆盖旧进度）", () => {
    expect(read("stores/playerStore.ts")).toContain("Switch guard");
  });

  it("m3u8 分辨率探测有 4 秒超时（「卡在正在获取」的根因）", () => {
    expect(read("services/m3u8.ts")).toContain("RESOLUTION_PROBE_TIMEOUT_MS = 4000");
  });

  it("切线路时不删除「最近观看」里的旧记录", () => {
    const src = read("stores/detailStore.ts");
    const start = src.indexOf("setDetail: async");
    expect(start).toBeGreaterThan(-1);
    expect(src.slice(start, start + 900)).not.toContain("removeDuplicatesByTitle");
  });

  it("播放准备不再用总闸截断线路列表", () => {
    const src = read("app/play.tsx");
    expect(src).not.toContain("INIT_TIMEOUT_MS");
    expect(src).toContain("await state.init(title, source, id);");
    expect(src).toContain("const FIRST_FRAME_TIMEOUT_MS = 15000");
  });
});
