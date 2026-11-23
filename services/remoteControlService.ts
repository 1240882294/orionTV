import TCPHttpServer from "./tcpHttpServer";
import type { HttpResponse } from "./tcpHttpServer";
import Logger from '@/utils/Logger';

const logger = Logger.withTag('RemoteControl');

const getRemotePageHTML = () => {
  return `
  <!DOCTYPE html>
  <html lang="zh-CN">
  <head>
    <title>OrionTV 远程输入</title>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <meta name="theme-color" content="#121212">
    <style>
      * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
      html, body { height: 100%; }
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif; display: flex; flex-direction: column; margin: 0; background-color: #121212; color: #fff; padding: env(safe-area-inset-top) 20px env(safe-area-inset-bottom); }
      header { padding: 22px 0 8px; }
      h1 { font-size: 20px; margin: 0 0 6px; }
      .sub { font-size: 13px; color: #9a9a9a; line-height: 1.5; }
      #container { flex: 1; display: flex; flex-direction: column; justify-content: center; max-width: 520px; width: 100%; margin: 0 auto; }
      #text { width: 100%; min-height: 54px; padding: 14px 16px; font-size: 17px; line-height: 1.4; border-radius: 12px; border: 1px solid #333; background-color: #1f1f1f; color: #fff; outline: none; resize: none; }
      #text:focus { border-color: #007AFF; }
      button { width: 100%; margin-top: 14px; padding: 16px; font-size: 18px; font-weight: 600; border: none; border-radius: 12px; background-color: #007AFF; color: #fff; cursor: pointer; }
      button:active { background-color: #0056b3; }
      button:disabled { background-color: #2b2b2b; color: #777; }
      #status { margin-top: 12px; font-size: 13px; color: #9a9a9a; min-height: 18px; text-align: center; }
      #status.ok { color: #37c871; }
      #status.err { color: #ff6b6b; }
      #history { margin-top: 22px; }
      #history .title { font-size: 12px; color: #777; margin-bottom: 6px; }
      .item { font-size: 14px; color: #bbb; padding: 8px 0; border-bottom: 1px solid #222; word-break: break-all; }
      footer { padding: 16px 0 24px; font-size: 12px; color: #555; text-align: center; }
    </style>
  </head>
  <body>
    <header>
      <h1>远程输入</h1>
      <div class="sub">在此输入文字，点击发送后电视端立即收到。</div>
    </header>
    <div id="container">
      <textarea id="text" rows="2" placeholder="请输入要发送到电视的文字…" autofocus autocapitalize="off" autocomplete="off"></textarea>
      <button id="send" onclick="send()">发送到电视</button>
      <div id="status"></div>
      <div id="history"><div class="title">最近发送</div><div id="historyList"></div></div>
    </div>
    <footer>OrionTV · 手机与电视需在同一 Wi-Fi</footer>
    <script>
      var input = document.getElementById("text");
      var button = document.getElementById("send");
      var statusEl = document.getElementById("status");
      var historyList = document.getElementById("historyList");

      function setStatus(text, type) {
        statusEl.textContent = text || "";
        statusEl.className = type || "";
      }

      window.addEventListener("DOMContentLoaded", function () {
        fetch("/handshake", { method: "POST" })
          .then(function () { setStatus("已连接电视", "ok"); })
          .catch(function () { setStatus("连接失败，请确认电视端已开启远程输入", "err"); });
        if (window.matchMedia("(pointer: fine)").matches) {
          input.focus();
        }
      });

      function addHistory(text) {
        var item = document.createElement("div");
        item.className = "item";
        item.textContent = text;
        historyList.insertBefore(item, historyList.firstChild);
        while (historyList.childNodes.length > 5) {
          historyList.removeChild(historyList.lastChild);
        }
      }

      function send() {
        var value = input.value.trim();
        if (!value) {
          setStatus("请先输入内容", "err");
          return;
        }
        button.disabled = true;
        setStatus("发送中…", "");
        fetch("/message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: value })
        })
          .then(function (res) {
            if (!res.ok) throw new Error("HTTP " + res.status);
            addHistory(value);
            input.value = "";
            setStatus("已发送", "ok");
          })
          .catch(function () {
            setStatus("发送失败，请检查网络", "err");
          })
          .then(function () {
            button.disabled = false;
            input.focus();
          });
      }

      input.addEventListener("keydown", function (event) {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          send();
        }
      });
    </script>
  </body>
  </html>
  `;
};

class RemoteControlService {
  private httpServer: TCPHttpServer;
  private onMessage: (message: string) => void = () => {};
  private onHandshake: () => void = () => {};

  constructor() {
    this.httpServer = new TCPHttpServer();
    this.setupRequestHandler();
  }

  private setupRequestHandler() {
    this.httpServer.setRequestHandler((request): HttpResponse => {
      logger.debug("[RemoteControl] Received request:", request.method, request.url);

      try {
        if (request.method === "GET" && (request.url === "/" || request.url === "/index.html")) {
          return {
            statusCode: 200,
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              "Cache-Control": "no-store",
            },
            body: getRemotePageHTML(),
          };
        } else if (request.method === "GET" && request.url === "/favicon.ico") {
          return {
            statusCode: 204,
            headers: { "Content-Type": "image/x-icon" },
            body: "",
          };
        } else if (request.method === "POST" && request.url === "/message") {
          try {
            const parsedBody = JSON.parse(request.body || "{}");
            const message = parsedBody.message;
            if (message) {
              this.onMessage(message);
            }
            return {
              statusCode: 200,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ status: "ok" }),
            };
          } catch (parseError) {
            logger.info("[RemoteControl] Failed to parse message body:", parseError);
            return {
              statusCode: 400,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ error: "Invalid JSON" }),
            };
          }
        } else if (request.method === "POST" && request.url === "/handshake") {
          this.onHandshake();
          return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "ok" }),
          };
        } else {
          return {
            statusCode: 404,
            headers: { "Content-Type": "text/plain" },
            body: "Not Found",
          };
        }
      } catch (error) {
        logger.info("[RemoteControl] Request handler error:", error);
        return {
          statusCode: 500,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "Internal Server Error" }),
        };
      }
    });
  }

  public init(actions: { onMessage: (message: string) => void; onHandshake: () => void }) {
    this.onMessage = actions.onMessage;
    this.onHandshake = actions.onHandshake;
  }

  public async startServer(): Promise<string> {
    logger.debug("[RemoteControl] Attempting to start server...");

    try {
      const url = await this.httpServer.start();
      logger.debug(`[RemoteControl] Server started successfully at: ${url}`);
      return url;
    } catch (error) {
      logger.info("[RemoteControl] Failed to start server:", error);
      throw new Error(error instanceof Error ? error.message : "Failed to start server");
    }
  }

  public stopServer() {
    logger.debug("[RemoteControl] Stopping server...");
    this.httpServer.stop();
  }

  public isRunning(): boolean {
    return this.httpServer.getIsRunning();
  }
}

export const remoteControlService = new RemoteControlService();
