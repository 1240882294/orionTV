/**
 * 投屏相关的公共类型。
 *
 * 只走标准 DLNA（UPnP AVTransport）：投给电视自带的投屏接收器。
 * 播放发生在电视上，进度只能由手机端轮询代报。
 */
export type CastProtocol = "dlna";

export interface CastDevice {
  /** dlna: udn 或 location */
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
}

/** 投屏中的实时状态，UI 不用关心底层协议 */
export interface CastStatus {
  playing: boolean;
  /** 秒 */
  position: number;
  /** 秒，0 表示电视没给时长 */
  duration: number;
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
  /** 电视是否还活着（GetTransportInfo 探活） */
  ping(): Promise<boolean>;
}
