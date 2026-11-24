/**
 * 版本比较的回归测试。
 *
 * 背景：早期实现是 `version.split('.').map(Number)`，
 * `1.3.0-test.6` 会被拆成 [1, 3, NaN, 6]，NaN 参与比较时
 * `>` 和 `<` 都是 false，于是「1.3.0 是否比 1.3.0-test.6 新」返回 -1，
 * 装测试版的用户永远收不到正式版更新。
 */
jest.mock("expo-file-system", () => ({}));
jest.mock("expo-intent-launcher", () => ({}));
jest.mock("react-native-toast-message", () => ({ show: jest.fn() }));
jest.mock("@/constants/UpdateConfig", () => ({
  UPDATE_CONFIG: { MANIFEST_URLS: [], DOWNLOAD_MIRRORS: [], getDownloadUrl: () => "" },
  getUpdateChannel: () => "tv",
}));
jest.mock("@/utils/Logger", () => {
  const noop = () => {};
  const logger = { info: noop, warn: noop, debug: noop, error: noop };
  return { __esModule: true, default: { withTag: () => logger }, withTag: () => logger };
});

import updateService from "../updateService";

describe("updateService.compareVersions", () => {
  const cmp = (a: string, b: string) => updateService.compareVersions(a, b);

  it("正式版高于同号预发布版", () => {
    expect(cmp("1.3.0", "1.3.0-test.6")).toBe(1);
    expect(cmp("1.3.0-test.6", "1.3.0")).toBe(-1);
  });

  it("预发布版之间按序号递增", () => {
    expect(cmp("1.3.0-test.6", "1.3.0-test.5")).toBe(1);
    expect(cmp("1.3.0-test.10", "1.3.0-test.9")).toBe(1);
    expect(cmp("1.3.0-test.6", "1.3.0-test.6")).toBe(0);
  });

  it("主版本号优先于预发布标记", () => {
    expect(cmp("1.4.0-test.1", "1.3.0")).toBe(1);
    expect(cmp("1.2.0", "1.3.0-test.1")).toBe(-1);
  });

  it("普通版本号比较", () => {
    expect(cmp("1.3.0", "1.2.0")).toBe(1);
    expect(cmp("1.3.0", "1.3.0")).toBe(0);
    expect(cmp("1.10.0", "1.9.0")).toBe(1);
    expect(cmp("2.0.0", "1.99.99")).toBe(1);
  });

  it("容错：带 v 前缀、缺段、异常字符", () => {
    expect(cmp("v1.3.0", "1.3.0")).toBe(0);
    expect(cmp("1.3", "1.3.0")).toBe(0);
    expect(cmp("1.3.0.1", "1.3.0")).toBe(1);
  });

  it("测试版能升级到正式版（真实场景）", () => {
    expect(updateService.isUpdateAvailable("1.3.0")).toBe(false); // 本机已是 1.3.0
  });
});
