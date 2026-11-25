/**
 * 电视端投屏接收器。
 *
 * 监听 12347，接受手机端发来的「播这个」指令，直接走电视端自己的播放链路：
 * 去广告、UA/Referer、选集、进度上报都是现成的，不重复实现一遍。
 *
 * 只在电视端设备上启动；手机端即使误启也不影响（只是多占一个端口）。
 */
import { Platform } from "react-native";
import Constants from "expo-constants";
import { router } from "expo-router";
import TCPHttpServer, { type HttpRequest, type HttpResponse } from "../tcpHttpServer";
import usePlayerStore from "@/stores/playerStore";
import useDetailStore from "@/stores/detailStore";
import { ORION_CAST_PORT } from "./types";
import Logger from "@/utils/Logger";

const logger = Logger.withTag("Cast/Receiver");

interface PlayPayload {
  title?: string;
  source?: string;
  id?: string;
  episodeIndex?: number;
  position?: number;
}

interface ControlPayload {
  action?: "pause" | "resume" | "seek" | "stop";
  position?: number;
}

function json(statusCode: number, body: unknown): HttpResponse {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  };
}

function deviceName(): string {
  const constants = Platform.constants as { Model?: string; Brand?: string; Manufacturer?: string } | undefined;
  const model = constants?.Model || constants?.Model?.trim();
  if (model && !/^(android|google)$/i.test(model)) return model;
  const brand = constants?.Brand || constants?.Manufacturer;
  return brand ? `${brand} TV` : "OrionTV 电视";
}

class OrionCastReceiver {
  private server: TCPHttpServer | null = null;
  private starting: Promise<void> | null = null;

  async start(): Promise<void> {
    if (this.server) return;
    if (this.starting) return this.starting;

    this.starting = (async () => {
      const server = new TCPHttpServer(ORION_CAST_PORT);
      server.setRequestHandler(this.handleRequest);
      await server.start();
      this.server = server;
      logger.info(`[CastReceiver] listening on ${ORION_CAST_PORT}`);
    })()
      .catch((error) => {
        // 端口被占（例如用户也在用远程输入）不影响电视正常使用，只记日志
        logger.info("[CastReceiver] start failed", error);
      })
      .finally(() => {
        this.starting = null;
      });

    return this.starting;
  }

  private handleRequest = async (request: HttpRequest): Promise<HttpResponse> => {
    const path = request.url.split("?")[0];

    try {
      if (request.method === "GET" && path === "/cast/ping") {
        return json(200, {
          app: "oriontv",
          tv: true,
          name: deviceName(),
          model: (Platform.constants as { Model?: string } | undefined)?.Model ?? "",
          version: Constants.expoConfig?.version ?? "",
        });
      }

      if (request.method === "GET" && path === "/cast/status") {
        return json(200, this.status());
      }

      if (request.method === "POST" && path === "/cast/play") {
        await this.play(JSON.parse(request.body || "{}") as PlayPayload);
        return json(200, { ok: true });
      }

      if (request.method === "POST" && path === "/cast/control") {
        await this.control(JSON.parse(request.body || "{}") as ControlPayload);
        return json(200, { ok: true });
      }

      return json(404, { error: "not found" });
    } catch (error) {
      logger.info("[CastReceiver] request failed", path, error);
      return json(500, { error: String(error) });
    }
  };

  /** 已经在播同一部片时直接切集/切线路，不再压一层播放页 */
  private async play(payload: PlayPayload): Promise<void> {
    const { title, source, id, episodeIndex = 0, position = 0 } = payload;
    if (!title || !source || !id) throw new Error("缺少 title/source/id");

    const detail = useDetailStore.getState().detail;
    const player = usePlayerStore.getState();
    const sameVideo = !!detail && detail.source === source && String(detail.id) === String(id);
    const alreadyPlaying = !!player.status?.isLoaded;

    if (sameVideo && alreadyPlaying) {
      await player.loadVideo({ source, id, title, episodeIndex, position });
      return;
    }

    router.push({
      pathname: "/play",
      params: {
        title,
        source,
        id,
        episodeIndex: String(episodeIndex),
        position: String(position),
      },
    });
  }

  private async control(payload: ControlPayload): Promise<void> {
    const video = usePlayerStore.getState().videoRef?.current;
    if (!video) throw new Error("播放器尚未就绪");

    switch (payload.action) {
      case "pause":
      case "stop":
        await video.pauseAsync();
        break;
      case "resume":
        await video.playAsync();
        break;
      case "seek":
        await video.setPositionAsync(Math.max(0, Number(payload.position) || 0) * 1000);
        break;
      default:
        throw new Error(`未知操作 ${payload.action}`);
    }
  }

  private status() {
    const { status, currentEpisodeIndex } = usePlayerStore.getState();
    const detail = useDetailStore.getState().detail;
    const loaded = status && status.isLoaded ? status : null;

    return {
      playing: loaded ? loaded.isPlaying : false,
      position: loaded ? Math.floor((loaded.positionMillis || 0) / 1000) : 0,
      duration: loaded ? Math.floor((loaded.durationMillis || 0) / 1000) : 0,
      // 手机端按 1 起算展示
      episodeIndex: currentEpisodeIndex >= 0 ? currentEpisodeIndex + 1 : 0,
      sourceName: detail?.source_name ?? "",
      title: detail?.title ?? "",
    };
  }

  stop(): void {
    this.server?.stop();
    this.server = null;
  }
}

export const castReceiver = new OrionCastReceiver();

export function startCastReceiver(): void {
  castReceiver.start().catch((error) => logger.info("[CastReceiver] start error", error));
}
