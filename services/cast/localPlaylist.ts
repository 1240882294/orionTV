/**
 * 把去广告后的本地播放列表用 HTTP 暴露给电视。
 *
 * 去广告的实现是「把 m3u8 落到 App 缓存目录再让播放器读 file://」，
 * 投屏时电视拿不到 file://，只能由手机起一个极小的只读服务转发这段文本。
 *
 * 只转发播放列表（几 KB），分片仍然由电视直连 CDN，不占手机带宽。
 */
import RNBlobUtil from "react-native-blob-util";
import TCPHttpServer, { type HttpRequest, type HttpResponse } from "../tcpHttpServer";
import Logger from "@/utils/Logger";

const logger = Logger.withTag("Cast/Playlist");

const PLAYLIST_PORT = 12348;

let server: TCPHttpServer | null = null;
let current: string | null = null;
let starting: Promise<string> | null = null;

export async function publishPlaylist(fileUrl: string): Promise<string> {
  const path = fileUrl.replace(/^file:\/\//, "");
  current = await RNBlobUtil.fs.readFile(path, "utf8");

  if (starting) return starting;

  starting = (async () => {
    let base: string;
    if (!server) {
      const instance = new TCPHttpServer(PLAYLIST_PORT);
      instance.setRequestHandler((request: HttpRequest): HttpResponse => {
        if (request.method !== "GET" && request.method !== "HEAD") {
          return { statusCode: 405, headers: { "Content-Type": "text/plain" }, body: "Method Not Allowed" };
        }
        return {
          statusCode: 200,
          headers: {
            // 电视对 MIME 比较挑，两个常见写法都带上兼容
            "Content-Type": "application/vnd.apple.mpegurl",
            "Cache-Control": "no-store",
          },
          body: current ?? "",
        };
      });
      base = await instance.start();
      server = instance;
      logger.info(`[Cast] playlist server on ${PLAYLIST_PORT}`);
    } else {
      // start() 是幂等的，顺便刷新一次本机地址（切换 Wi-Fi 后 IP 会变）
      base = await server.start();
    }
    return `${base}/playlist.m3u8`;
  })()
    .catch((error) => {
      logger.info("[Cast] playlist server failed", error);
      throw error;
    })
    .finally(() => {
      starting = null;
    });

  return starting;
}

export function unpublishPlaylist(): void {
  current = null;
}
