/**
 * DLNA / UPnP AVTransport 投屏客户端。
 *
 * 只做三件事：发现渲染器、把地址推给它、按需做播放控制。
 * 不走任何第三方 SDK，全部是本文件里的 SSDP + SOAP。
 *
 * 为什么不用现成的 dlna 库：它们大多停在 RN 0.6x，且强行引入一套自己的
 * 设备模型；投屏真正需要的只有 4 个 SOAP 动作，自己写反而更可控。
 */
import dgram from "react-native-udp";
import type { CastDevice, CastPlayRequest, CastStatus } from "./types";
import Logger from "@/utils/Logger";

const logger = Logger.withTag("Cast/DLNA");

const SSDP_ADDRESS = "239.255.255.250";
const SSDP_BROADCAST = "255.255.255.255";
const SSDP_PORT = 1900;
const AVT = "urn:schemas-upnp-org:service:AVTransport:1";
const RCS = "urn:schemas-upnp-org:service:RenderingControl:1";

const SEARCH_TARGETS = [
  "urn:schemas-upnp-org:device:MediaRenderer:1",
  "urn:schemas-upnp-org:service:AVTransport:1",
];

const REQUEST_TIMEOUT = 6000;

/** fetch 在部分老 ROM 上没有 AbortController 的超时语义，统一包一层 */
async function withTimeout<T>(task: (signal?: AbortSignal) => Promise<T>, ms = REQUEST_TIMEOUT): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await task(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

function xmlTag(xml: string, tag: string): string | null {
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i").exec(xml);
  return match ? match[1].trim() : null;
}

/** 把相对 controlURL 拼成绝对地址，不依赖 URL 构造函数（老 Hermes 上不完整） */
function resolveUrl(base: string, relative: string): string {
  if (/^https?:\/\//i.test(relative)) return relative;
  const origin = /^(https?:\/\/[^/]+)/i.exec(base);
  if (!origin) return relative;
  return `${origin[1]}${relative.startsWith("/") ? "" : "/"}${relative}`;
}

function hostOf(url: string): string {
  const match = /^https?:\/\/([^/:]+)/i.exec(url);
  return match ? match[1] : "";
}

/** 解析设备描述，取出 AVTransport 的 controlURL 与设备名 */
export function parseDeviceDescription(xml: string, location: string): Partial<CastDevice> | null {
  const deviceBlock = /<device>([\s\S]*?)<\/device>/i.exec(xml)?.[1] ?? xml;
  const name = xmlTag(deviceBlock, "friendlyName");
  if (!name) return null;
  const model = xmlTag(deviceBlock, "modelName") ?? undefined;

  // 只保留 AVTransport 那个 service 块，避免拿到 RenderingControl 的 controlURL
  const services = Array.from(xml.matchAll(/<service>([\s\S]*?)<\/service>/gi)).map((m) => m[1]);
  const avt = services.find((block) => (xmlTag(block, "serviceType") ?? "").includes("AVTransport"));
  const controlRaw = avt ? xmlTag(avt, "controlURL") : null;

  return {
    name: decodeXml(name),
    model: model ? decodeXml(model) : undefined,
    location,
    controlUrl: controlRaw ? resolveUrl(location, controlRaw) : undefined,
    host: hostOf(location),
  };
}

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function encodeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 发 M-SEARCH 找渲染器。
 *
 * 组播和广播都发一遍：组播是规范要求，但部分路由/ROM 会挡；
 * 广播虽然不合规范，实际测试中电视反而更愿意回。
 */
export function discoverDlnaDevices(timeoutMs = 2600): Promise<CastDevice[]> {
  return new Promise<CastDevice[]>((resolve) => {
    const seen = new Map<string, CastDevice>();
    let closed = false;
    let socket: ReturnType<typeof dgram.createSocket> | null = null;

    const finish = async () => {
      if (closed) return;
      closed = true;
      try {
        socket?.close();
      } catch {
        // 已关闭
      }
      resolve(Array.from(seen.values()));
    };

    try {
      socket = dgram.createSocket({ type: "udp4" });
      socket.on("error", (error: Error) => {
        logger.info("[DLNA] socket error", error);
        finish();
      });

      socket.on("message", (data: Buffer, rinfo: { address: string }) => {
        const text = data.toString("utf8");
        if (!/^HTTP\/1\.1 200/i.test(text)) return;
        const location = /^LOCATION:\s*(.+)$/im.exec(text)?.[1]?.trim();
        if (!location) return;
        if (seen.has(location)) return;
        // 先占位，避免同一个设备回多个 ST 时被反复拉描述
        seen.set(location, {
          id: `dlna@${location}`,
          name: rinfo.address,
          host: rinfo.address,
          protocol: "dlna",
          location,
        });
      });

      socket.bind(0, () => {
        for (const target of SEARCH_TARGETS) {
          const message = Buffer.from(
            [
              "M-SEARCH * HTTP/1.1",
              `HOST: ${SSDP_ADDRESS}:${SSDP_PORT}`,
              'MAN: "ssdp:discover"',
              "MX: 2",
              `ST: ${target}`,
              "",
              "",
            ].join("\r\n")
          );
          try {
            socket?.send(message, 0, message.length, SSDP_PORT, SSDP_ADDRESS, () => {});
            socket?.send(message, 0, message.length, SSDP_PORT, SSDP_BROADCAST, () => {});
          } catch (error) {
            logger.debug("[DLNA] send failed", error);
          }
        }
      });
    } catch (error) {
      logger.info("[DLNA] create socket failed", error);
      finish();
      return;
    }

    setTimeout(finish, timeoutMs);
  }).then(async (devices) => {
    // 补齐设备名与控制地址；拿不到 AVTransport 的直接丢弃（投不了）
    const enriched = await Promise.all(
      devices.map(async (device) => {
        try {
          const xml = await withTimeout(async (signal) => {
            const response = await fetch(device.location!, { signal });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.text();
          });
          const parsed = parseDeviceDescription(xml, device.location!);
          if (!parsed?.controlUrl || !parsed.name) return null;
          return { ...device, ...parsed, name: parsed.name } as CastDevice;
        } catch (error) {
          logger.debug("[DLNA] describe failed", device.location, error);
          return null;
        }
      })
    );
    return enriched.filter((item): item is CastDevice => !!item);
  });
}

/* ------------------------------ SOAP ------------------------------ */

async function soap(
  controlUrl: string,
  service: string,
  action: string,
  args: Record<string, string | number>
): Promise<string> {
  const body =
    `<?xml version="1.0"?>` +
    `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ` +
    `s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">` +
    `<s:Body><u:${action} xmlns:u="${service}">` +
    Object.entries(args)
      .map(([key, value]) => `<${key}>${encodeXml(String(value))}</${key}>`)
      .join("") +
    `</u:${action}></s:Body></s:Envelope>`;

  return withTimeout(async (signal) => {
    const response = await fetch(controlUrl, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": 'text/xml; charset="utf-8"',
        SOAPACTION: `"${service}#${action}"`,
      },
      body,
    });
    const text = await response.text();
    if (!response.ok) {
      // UPnP 的错误是 500 + 错误码，把错误码提出来便于降级判断
      const code = /<errorCode>(\d+)<\/errorCode>/i.exec(text)?.[1];
      throw new Error(`SOAP ${action} ${response.status}${code ? ` (${code})` : ""}`);
    }
    return text;
  });
}

function parseHms(value: string | null | undefined): number {
  if (!value) return 0;
  const match = /^(\d+):(\d+):(\d+)/.exec(value.trim());
  if (!match) return 0;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function toHms(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/**
 * 推流前把多码率 master 换成单码率 media playlist。
 * 不少电视的 DLNA 只认 media playlist，给 master 会直接黑屏。
 */
function pickMediaPlaylist(text: string, baseUrl: string): string | null {
  if (!/#EXT-X-STREAM-INF/i.test(text)) return null;
  const lines = text.split("\n").map((line) => line.trim());
  let best: { bandwidth: number; uri: string } | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].startsWith("#EXT-X-STREAM-INF")) continue;
    const bandwidth = Number(/BANDWIDTH=(\d+)/i.exec(lines[i])?.[1] ?? 0);
    const uri = lines[i + 1];
    if (uri && !uri.startsWith("#")) {
      if (!best || bandwidth > best.bandwidth) best = { bandwidth, uri: resolveUrl(baseUrl, uri) };
    }
  }
  return best?.uri ?? null;
}

/** 生成交给电视的最终地址：master 降级为单码率，失败就用原地址 */
export async function toDirectPlayableUrl(url: string): Promise<string> {
  if (!/\.m3u8(?:[?#]|$)/i.test(url)) return url;
  try {
    const text = await withTimeout(async (signal) => {
      const response = await fetch(url, { signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.text();
    }, 4000);
    return pickMediaPlaylist(text, url) ?? url;
  } catch {
    return url;
  }
}

/* ------------------------------ 控制器 ------------------------------ */

class DlnaController {
  constructor(private readonly device: CastDevice) {}

  private get control(): string {
    if (!this.device.controlUrl) throw new Error("设备缺少 AVTransport 控制地址");
    return this.device.controlUrl;
  }

  private call(action: string, args: Record<string, string | number> = {}): Promise<string> {
    return soap(this.control, AVT, action, { InstanceID: 0, ...args });
  }

  async play(request: CastPlayRequest): Promise<void> {
    const url = await toDirectPlayableUrl(request.url);
    // CurrentURIMetaData 留空：HLS 的 protocolInfo 各家要求不一致，
    // 传空反而是兼容性最好的选择（实测大部分电视接受）。
    await this.call("SetAVTransportURI", { CurrentURI: url, CurrentURIMetaData: "" });
    await this.call("Play", { Speed: 1 });
    if (request.position > 0) {
      // 部分渲染器要等进入 PLAYING 之后才接受 Seek
      setTimeout(() => {
        this.seek(request.position).catch((error) => logger.debug("[DLNA] initial seek failed", error));
      }, 700);
    }
  }

  async pause(): Promise<void> {
    await this.call("Pause");
  }

  async resume(): Promise<void> {
    await this.call("Play", { Speed: 1 });
  }

  /** 返回 true 表示电视接受该跳转；false 表示不支持，UI 提示不要重试 */
  async trySeek(positionSeconds: number): Promise<boolean> {
    try {
      await this.call("Seek", { Unit: "REL_TIME", Target: toHms(positionSeconds) });
      return true;
    } catch (error) {
      logger.info("[DLNA] seek unsupported", error);
      return false;
    }
  }

  async seek(positionSeconds: number): Promise<void> {
    const ok = await this.trySeek(positionSeconds);
    if (!ok) throw new Error("该电视不支持拖动进度");
  }

  async stop(): Promise<void> {
    await this.call("Stop");
  }

  async getStatus(): Promise<CastStatus> {
    const info = await this.call("GetPositionInfo");
    const transport = await this.call("GetTransportInfo").catch(() => "");
    const state = xmlTag(transport, "CurrentTransportState") ?? "";
    return {
      playing: state === "PLAYING",
      position: parseHms(xmlTag(info, "RelTime")),
      duration: parseHms(xmlTag(info, "TrackDuration")),
      title: this.device.name,
    };
  }

  async ping(): Promise<boolean> {
    try {
      await this.call("GetTransportInfo");
      return true;
    } catch {
      return false;
    }
  }

  async setVolume(volume: number): Promise<void> {
    await soap(this.control, RCS, "SetVolume", {
      InstanceID: 0,
      Channel: "Master",
      DesiredVolume: Math.max(0, Math.min(100, Math.round(volume))),
    });
  }
}

export function createDlnaController(device: CastDevice) {
  const controller = new DlnaController(device);
  return {
    device,
    play: (request: CastPlayRequest) => controller.play(request),
    pause: () => controller.pause(),
    resume: () => controller.resume(),
    seek: (position: number) => controller.seek(position),
    stop: () => controller.stop(),
    getStatus: () => controller.getStatus(),
    ping: () => controller.ping(),
    /** 内部用：Seek 失败时 UI 需要知道是「不支持」还是「网络错」 */
    trySeek: (position: number) => controller.trySeek(position),
    setVolume: (volume: number) => controller.setVolume(volume),
  };
}
