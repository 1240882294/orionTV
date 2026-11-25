import { requireNativeModule } from "expo-modules-core";

export interface UdpMessage {
  data: string;
  address: string;
}

interface OrionUdpNative {
  open(port: number): Promise<number>;
  send(host: string, port: number, payload: string): Promise<boolean>;
  close(): Promise<void>;
  addListener(event: "onMessage", listener: (message: UdpMessage) => void): { remove: () => void };
}

let cached: OrionUdpNative | null = null;
let unavailable = false;

/**
 * 拿原生模块。失败返回 null 而不是抛异常 —— 投屏只是附加功能，
 * 拿不到 UDP 时应该退化成「提示不可用」，绝不能把整个应用带崩。
 */
export function getUdp(): OrionUdpNative | null {
  if (cached) return cached;
  if (unavailable) return null;
  try {
    cached = requireNativeModule<OrionUdpNative>("OrionUdp");
    return cached;
  } catch {
    unavailable = true;
    return null;
  }
}

export function isUdpAvailable(): boolean {
  return getUdp() !== null;
}
