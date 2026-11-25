/**
 * OrionTV 互投客户端（手机端）。
 *
 * 为什么还要单独做一条通道：盒子上的 OrionTV 不是 DLNA 渲染器，标准 DLNA
 * 根本投不过去；而走 App 内通道，电视端能用自己那套去广告、带 UA/Referer
 * 的播放链路，也能由电视端自己把进度写回服务器，比手机代报可靠得多。
 *
 * 发现方式：TCP 扫本网段 12347 端口。不依赖 UDP 组播，路由器限制组播时也能用。
 */
import TcpSocket from "react-native-tcp-socket";
import NetInfo from "@react-native-community/netinfo";
import type { CastDevice, CastPlayRequest, CastStatus } from "./types";
import { ORION_CAST_PORT } from "./types";
import Logger from "@/utils/Logger";

const logger = Logger.withTag("Cast/Orion");

const PROBE_TIMEOUT = 380;
const PROBE_CONCURRENCY = 40;
const HTTP_TIMEOUT = 6000;

function timeout<T>(task: (signal?: AbortSignal) => Promise<T>, ms = HTTP_TIMEOUT): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return task(controller.signal).finally(() => clearTimeout(timer));
}

/** 只要 TCP 能连上就算开放；连不上/被拒绝都按关闭处理 */
function isPortOpen(host: string, port: number, ms = PROBE_TIMEOUT): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let socket: ReturnType<typeof TcpSocket.createConnection> | null = null;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket?.destroy();
      } catch {
        // 已销毁
      }
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), ms);
    try {
      socket = TcpSocket.createConnection({ host, port }, () => finish(true));
      socket.on("error", () => finish(false));
      socket.on("close", () => finish(false));
    } catch {
      finish(false);
    }
  });
}

/** 确认 12347 上跑的确实是 OrionTV，而不是别的恰好占了这个端口的服务 */
async function pingDevice(host: string): Promise<CastDevice | null> {
  try {
    const response = await timeout(
      (signal) => fetch(`http://${host}:${ORION_CAST_PORT}/cast/ping`, { signal }),
      900
    );
    if (!response.ok) return null;
    const data = await response.json();
    if (!data || data.app !== "oriontv") return null;
    return {
      id: `orion@${host}`,
      name: data.name || host,
      host,
      protocol: "orion",
      model: data.model || undefined,
      version: data.version || undefined,
    };
  } catch {
    return null;
  }
}

/** 取本机 WiFi 地址，顺便确认确实在局域网上 */
export async function getLocalIp(): Promise<string | null> {
  const net = await NetInfo.fetch();
  const ip = (net.details as { ipAddress?: string } | null)?.ipAddress;
  if (ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip)) return ip;
  return null;
}

/**
 * 扫 /24 网段找电视端。
 * 254 个地址按 40 并发分批，实测 2~3 秒出结果，比 SSDP 更稳（不怕路由器屏蔽组播）。
 */
export async function discoverOrionDevices(): Promise<CastDevice[]> {
  const localIp = await getLocalIp();
  if (!localIp) return [];

  const prefix = localIp.split(".").slice(0, 3).join(".");
  const hosts: string[] = [];
  for (let i = 1; i <= 254; i += 1) {
    const host = `${prefix}.${i}`;
    if (host !== localIp) hosts.push(host);
  }

  const open: string[] = [];
  for (let i = 0; i < hosts.length; i += PROBE_CONCURRENCY) {
    const batch = hosts.slice(i, i + PROBE_CONCURRENCY);
    const results = await Promise.all(batch.map((host) => isPortOpen(host, ORION_CAST_PORT)));
    batch.forEach((host, index) => {
      if (results[index]) open.push(host);
    });
  }

  if (open.length === 0) return [];
  const devices = await Promise.all(open.map(pingDevice));
  const found = devices.filter((item): item is CastDevice => !!item);
  logger.info(`[Orion] scanned ${hosts.length} hosts, found ${found.length}`);
  return found;
}

export function createOrionController(device: CastDevice) {
  const base = `http://${device.host}:${ORION_CAST_PORT}`;

  async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
    return timeout(async (signal) => {
      const response = await fetch(`${base}${path}`, {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`电视端返回 ${response.status}`);
      return text ? JSON.parse(text) : {};
    });
  }

  return {
    device,
    play: async (request: CastPlayRequest) => {
      await post("/cast/play", request);
    },
    pause: async () => {
      await post("/cast/control", { action: "pause" });
    },
    resume: async () => {
      await post("/cast/control", { action: "resume" });
    },
    seek: async (position: number) => {
      await post("/cast/control", { action: "seek", position });
    },
    stop: async () => {
      await post("/cast/control", { action: "stop" }).catch(() => {});
    },
    getStatus: async (): Promise<CastStatus> => {
      return timeout(async (signal) => {
        const response = await fetch(`${base}/cast/status`, { signal });
        if (!response.ok) throw new Error(`电视端返回 ${response.status}`);
        const data = await response.json();
        return {
          playing: !!data.playing,
          position: Number(data.position) || 0,
          duration: Number(data.duration) || 0,
          episodeIndex: Number(data.episodeIndex) || undefined,
          sourceName: data.sourceName || undefined,
          title: data.title || undefined,
        };
      }, 5000);
    },
    ping: async () => {
      const found = await pingDevice(device.host);
      return !!found;
    },
  };
}
