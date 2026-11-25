/**
 * 投屏相关的公共类型。
 *
 * 两种投屏通道：
 * - orion：投给同样装了 OrionTV 的电视/盒子，走 HTTP 指令，播放与进度上报都由电视端完成，最可靠
 * - dlna：投给电视自带的投屏接收器（标准 UPnP AVTransport），播放发生在电视上，
 *         进度只能由手机端轮询代报
 */
export type CastProtocol = "orion" | "dlna";

/** 电视端投屏接收端口（手机端扫描这个端口来发现设备） */
export const ORION_CAST_PORT = 12347;

export interface CastDevice {
  /** orion: orion@ip；dlna: udn 或 location */
  id: string;
  name: string;
  host: string;
  protocol: CastProtocol;
  /** 设备型号，用于在列表里区分同名的多台设备 */
  model?: string;
  /** DLNA 设备描述地址 */
  location?: string;
  /** DLNA AVTransport 控制地址（已绝对化） */
  controlUrl?: string;
  /** OrionTV 电视端的版本，方便排查 */
  version?: string;
}

/** 投屏中的实时状态，统一两种通道的字段，UI 不用关心底层协议 */
export interface CastStatus {
  playing: boolean;
  /** 秒 */
  position: number;
  /** 秒，0 表示电视没给时长 */
  duration: number;
  /** 当前集（从 1 开始），orion 通道才有 */
  episodeIndex?: number;
  /** 当前线路名，orion 通道才有 */
  sourceName?: string;
  title?: string;
}

export interface CastPlayRequest {
  title: string;
  source: string;
  sourceName: string;
  id: string;
  episodeIndex: number;
  /** 秒，从该位置开始播 */
  position: number;
  /** 播放地址（已按需做过地址处理） */
  url: string;
}

export interface CastController {
  device: CastDevice;
  play(request: CastPlayRequest): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  seek(positionSeconds: number): Promise<void>;
  stop(): Promise<void>;
  getStatus(): Promise<CastStatus>;
  /** 电视是否还活着。DLNA 用 GetTransportInfo 探活，orion 用 /ping */
  ping(): Promise<boolean>;
}
