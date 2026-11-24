import { filterMediaPlaylist, parseMasterPlaylist, rewriteMasterPlaylist } from "../hlsFilter";
import { isLikelyAdUri, resolveUrl } from "../hlsUrl";

const BASE = "https://cdn.example.com/vod/2024/movie/index.m3u8";

const buildPlaylist = (segments: { uri: string; duration: number; extra?: string }[], header: string[] = []) =>
  [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    "#EXT-X-TARGETDURATION:10",
    ...header,
    ...segments.flatMap((segment) => [
      `#EXTINF:${segment.duration.toFixed(3)},`,
      ...(segment.extra ? [segment.extra] : []),
      segment.uri,
    ]),
    "#EXT-X-ENDLIST",
  ].join("\n");

describe("resolveUrl", () => {
  it("处理同级、上级、根路径与协议相对地址", () => {
    expect(resolveUrl("seg1.ts", BASE)).toBe("https://cdn.example.com/vod/2024/movie/seg1.ts");
    expect(resolveUrl("../other/seg2.ts", BASE)).toBe("https://cdn.example.com/vod/2024/other/seg2.ts");
    expect(resolveUrl("/abs/seg3.ts", BASE)).toBe("https://cdn.example.com/abs/seg3.ts");
    expect(resolveUrl("//cdn2.example.com/seg4.ts", BASE)).toBe("https://cdn2.example.com/seg4.ts");
    expect(resolveUrl("https://a.com/x.ts", BASE)).toBe("https://a.com/x.ts");
  });
});

describe("isLikelyAdUri", () => {
  it("命中广告域名与广告路径", () => {
    expect(isLikelyAdUri("https://securepubads.g.doubleclick.net/x.ts")).toBe(true);
    expect(isLikelyAdUri("https://cdn.example.com/vod/preroll/001.ts")).toBe(true);
    expect(isLikelyAdUri("https://cdn.example.com/vod/ads/a1.ts")).toBe(true);
  });

  it("不误伤正常分片", () => {
    expect(isLikelyAdUri("https://cdn.example.com/vod/download/001.ts")).toBe(false);
    expect(isLikelyAdUri("https://cdn.example.com/vod/shadow/001.ts")).toBe(false);
    expect(isLikelyAdUri("https://cdn.example.com/vod/head/001.ts")).toBe(false);
  });
});

describe("filterMediaPlaylist", () => {
  it("没有广告时不改动列表", () => {
    const text = buildPlaylist([
      { uri: "s1.ts", duration: 10 },
      { uri: "s2.ts", duration: 10 },
    ]);
    const result = filterMediaPlaylist(text, BASE);
    expect(result.changed).toBe(false);
    expect(result.removedSegments).toBe(0);
  });

  it("剔除 CUE-OUT / CUE-IN 之间的广告段", () => {
    const text = buildPlaylist([
      { uri: "s1.ts", duration: 300 },
      { uri: "ad1.ts", duration: 15, extra: "#EXT-X-CUE-OUT:30" },
      { uri: "ad2.ts", duration: 15, extra: "#EXT-X-CUE-OUT-CONT:15/30" },
      { uri: "s2.ts", duration: 300, extra: "#EXT-X-CUE-IN" },
      { uri: "s3.ts", duration: 300 },
    ]);

    const result = filterMediaPlaylist(text, BASE);
    expect(result.changed).toBe(true);
    expect(result.removedSegments).toBe(2);
    expect(result.removedSeconds).toBe(30);
    expect(result.playlist).not.toContain("ad1.ts");
    expect(result.playlist).not.toContain("ad2.ts");
    expect(result.playlist).toContain("https://cdn.example.com/vod/2024/movie/s1.ts");
    expect(result.playlist).toContain("https://cdn.example.com/vod/2024/movie/s3.ts");
    expect(result.playlist).toContain("#EXT-X-ENDLIST");
  });

  it("CUE 覆盖比例过高时判定为内容分段，不做删除", () => {
    const segments = [
      { uri: "s1.ts", duration: 10 },
      { uri: "c1.ts", duration: 60, extra: "#EXT-X-CUE-OUT:60" },
      { uri: "s2.ts", duration: 10, extra: "#EXT-X-CUE-IN" },
    ];
    const result = filterMediaPlaylist(buildPlaylist(segments), BASE);
    expect(result.changed).toBe(false);
  });

  it("片头贴片：开头来自独立域名且时长较短", () => {
    const text = buildPlaylist([
      { uri: "https://ad-cdn.other.com/pre1.ts", duration: 15 },
      { uri: "https://ad-cdn.other.com/pre2.ts", duration: 15 },
      { uri: "s1.ts", duration: 10 },
      { uri: "s2.ts", duration: 10 },
    ]);

    const result = filterMediaPlaylist(text, BASE);
    expect(result.changed).toBe(true);
    expect(result.removedSegments).toBe(2);
    expect(result.playlist).not.toContain("ad-cdn.other.com");
  });

  it("关键字命中的广告段被删除", () => {
    const text = buildPlaylist([
      { uri: "s1.ts", duration: 10 },
      { uri: "https://cdn.example.com/vod/preroll/ins.ts", duration: 10 },
      { uri: "s2.ts", duration: 10 },
    ]);
    const result = filterMediaPlaylist(text, BASE);
    expect(result.removedSegments).toBe(1);
    expect(result.playlist).not.toContain("preroll");
  });

  it("所有分片都被判为广告时保留原列表", () => {
    const text = buildPlaylist([
      { uri: "https://ads.example.com/a1.ts", duration: 10 },
      { uri: "https://ads.example.com/a2.ts", duration: 10 },
    ]);
    const result = filterMediaPlaylist(text, BASE);
    expect(result.changed).toBe(false);
  });

  it("删除开头分片后修正 MEDIA-SEQUENCE", () => {
    const text = buildPlaylist(
      [
        { uri: "https://ad-cdn.other.com/pre1.ts", duration: 10 },
        { uri: "s1.ts", duration: 10 },
        { uri: "s2.ts", duration: 10 },
      ],
      ["#EXT-X-MEDIA-SEQUENCE:100"]
    );
    const result = filterMediaPlaylist(text, BASE);
    expect(result.removedSegments).toBe(1);
    expect(result.playlist).toContain("#EXT-X-MEDIA-SEQUENCE:101");
  });

  it("删除广告段时保留 EXT-X-KEY", () => {
    const text = [
      "#EXTM3U",
      "#EXT-X-VERSION:3",
      '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
      "#EXTINF:10.000,",
      "#EXT-X-CUE-OUT:10",
      "ad1.ts",
      "#EXTINF:300.000,",
      "#EXT-X-CUE-IN",
      "s1.ts",
      "#EXTINF:300.000,",
      "s2.ts",
      "#EXT-X-ENDLIST",
    ].join("\n");

    const result = filterMediaPlaylist(text, BASE);
    expect(result.removedSegments).toBe(1);
    expect(result.playlist).toContain("key.bin");
    expect(result.playlist).toContain("https://cdn.example.com/vod/2024/movie/key.bin");
    expect(result.playlist).toContain("s1.ts");
  });
});

describe("master playlist", () => {
  const master = [
    "#EXTM3U",
    '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360',
    "360/index.m3u8",
    "#EXT-X-STREAM-INF:BANDWIDTH=2400000,RESOLUTION=1280x720",
    "720/index.m3u8",
  ].join("\n");

  it("解析变体并按地址绝对化", () => {
    const variants = parseMasterPlaylist(master, BASE);
    expect(variants).toHaveLength(2);
    expect(variants[1].bandwidth).toBe(2400000);
    expect(variants[1].uri).toBe("https://cdn.example.com/vod/2024/movie/720/index.m3u8");
  });

  it("重写变体地址", () => {
    const replacement = new Map([
      ["https://cdn.example.com/vod/2024/movie/720/index.m3u8", "file:///cache/720.m3u8"],
    ]);
    const result = rewriteMasterPlaylist(master, BASE, replacement);
    expect(result).toContain("file:///cache/720.m3u8");
    expect(result).toContain("https://cdn.example.com/vod/2024/movie/360/index.m3u8");
  });
});
