import AsyncStorage from "@react-native-async-storage/async-storage";

// region: --- Interface Definitions ---
export interface DoubanItem {
  title: string;
  poster: string;
  rate?: string;
}

export interface DoubanResponse {
  code: number;
  message: string;
  list: DoubanItem[];
}

export interface VideoDetail {
  id: string;
  title: string;
  poster: string;
  source: string;
  source_name: string;
  desc?: string;
  type?: string;
  year?: string;
  area?: string;
  director?: string;
  actor?: string;
  remarks?: string;
}

export interface SearchResult {
  id: number;
  title: string;
  poster: string;
  episodes: string[];
  source: string;
  source_name: string;
  class?: string;
  year: string;
  desc?: string;
  type_name?: string;
}

export interface Favorite {
  cover: string;
  title: string;
  source_name: string;
  total_episodes: number;
  search_title: string;
  year: string;
  save_time?: number;
}

export interface PlayRecord {
  title: string;
  source_name: string;
  cover: string;
  index: number;
  total_episodes: number;
  play_time: number;
  total_time: number;
  save_time: number;
  year: string;
}

export interface ApiSite {
  key: string;
  api: string;
  name: string;
  detail?: string;
}

export interface ServerConfig {
  SiteName: string;
  StorageType: "localstorage" | "redis" | string;
}

/**
 * 请求错误分类。启动流程需要区分「网络不通」和「账号不对」，
 * 否则会出现网络断了却一直弹登录框、或者密码错了却提示检查网络的情况。
 */
export type ApiErrorKind =
  | "network" // 无法建立连接（断网、地址不可达、DNS 失败）
  | "timeout" // 连接上了但迟迟没有响应
  | "unauthorized" // 401，需要登录或重登
  | "server" // 4xx / 5xx
  | "not-configured" // 还没填服务器地址
  | "unknown";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;

  constructor(message: string, kind: ApiErrorKind, status?: number) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
  }
}

/** 是否属于「连不上服务器」这一类问题（需要提示检查网络） */
export const isConnectionFailure = (error: unknown): boolean =>
  error instanceof ApiError && (error.kind === "network" || error.kind === "timeout");

/** 是否属于「账号本身有问题」（需要重新登录） */
export const isAuthFailure = (error: unknown): boolean =>
  error instanceof ApiError && error.kind === "unauthorized";

/** 默认超时：弱网电视盒子下 8 秒足够建立连接，再久也基本没救了 */
const DEFAULT_TIMEOUT_MS = 8000;

/**
 * 聚合搜索的超时与重试。
 *
 * /api/search 由服务端聚合所有源，弱网下首包可能要好几秒。单次 8 秒、
 * 最多 3 次尝试（退避 0 / 0.4s / 1.2s），总上限约 26 秒。
 *
 * 只对「超时」重试：断网、401、5xx 再试也没用，只会让用户多等一轮。
 * 搜索页通过 onAttempt 把「第 2/3 次」显示出来，避免界面看着像卡死。
 */
const SEARCH_TIMEOUT_MS = 8000;
const SEARCH_ATTEMPTS = 3;
const SEARCH_BACKOFF_MS = [0, 400, 1200];

export interface SearchOptions {
  /** 总尝试次数，默认 3（首次 + 2 次重试） */
  attempts?: number;
  /** 单次超时，默认 8000ms */
  timeoutMs?: number;
  /** 每次重试前的等待，默认 [0, 400, 1200] */
  backoffMs?: number[];
  /** 每发起一次尝试回调一次，用于界面提示「第 n/m 次」 */
  onAttempt?: (attempt: number, total: number) => void;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 估算 UTF-8 字节数：测速要按真实字节算带宽，不能直接用字符数 */
function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

type ApiRequestOptions = RequestInit & { timeoutMs?: number };

export class API {
  public baseURL: string = "";

  // 会话恢复回调（由 authStore 注册），401 时自动重登并重试一次
  private sessionRestorer: (() => Promise<boolean>) | null = null;

  constructor(baseURL?: string) {
    if (baseURL) {
      this.baseURL = baseURL;
    }
  }

  public setBaseUrl(url: string) {
    this.baseURL = url;
  }

  public setSessionRestorer(restorer: (() => Promise<boolean>) | null) {
    this.sessionRestorer = restorer;
  }

  /**
   * 带超时的单次请求。把「超时」「断网」「HTTP 错误」翻译成 ApiError，
   * 避免调用方拿到浏览器/RN 原生那种信息量极低的 TypeError。
   */
  private async performFetch(
    url: string,
    init: RequestInit,
    timeoutMs: number
  ): Promise<Response> {
    const controller = new AbortController();
    const externalSignal = init.signal ?? undefined;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    const onExternalAbort = () => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort();
      } else {
        externalSignal.addEventListener?.("abort", onExternalAbort);
      }
    }

    try {
      return await fetch(`${this.baseURL}${url}`, { ...init, signal: controller.signal });
    } catch (error) {
      // 调用方主动取消（例如搜索请求被新的输入顶掉），原样抛出
      if (externalSignal?.aborted) {
        throw error;
      }
      if (timedOut) {
        throw new ApiError("TIMEOUT", "timeout");
      }
      throw new ApiError("NETWORK_ERROR", "network");
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener?.("abort", onExternalAbort);
    }
  }

  private async _fetch(url: string, options: ApiRequestOptions = {}): Promise<Response> {
    if (!this.baseURL) {
      throw new ApiError("API_URL_NOT_SET", "not-configured");
    }

    const { timeoutMs = DEFAULT_TIMEOUT_MS, ...init } = options;

    // 框架默认会携带 cookie，无需手动设置
    const response = await this.performFetch(url, init, timeoutMs);

    if (response.status === 401) {
      // 会话过期：自动重登后重试一次（登录接口本身除外，避免循环）
      if (this.sessionRestorer && !url.startsWith("/api/login")) {
        const restored = await this.sessionRestorer();
        if (restored) {
          const retryResponse = await this.performFetch(url, init, timeoutMs);
          if (retryResponse.status === 401) {
            throw new ApiError("UNAUTHORIZED", "unauthorized", 401);
          }
          if (!retryResponse.ok) {
            throw new ApiError(
              `HTTP error! status: ${retryResponse.status}`,
              "server",
              retryResponse.status
            );
          }
          return retryResponse;
        }
      }
      throw new ApiError("UNAUTHORIZED", "unauthorized", 401);
    }

    if (!response.ok) {
      throw new ApiError(`HTTP error! status: ${response.status}`, "server", response.status);
    }

    return response;
  }

  async login(username?: string | undefined, password?: string): Promise<{ ok: boolean }> {
    const response = await this._fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    // 存储cookie到AsyncStorage
    const cookies = response.headers.get("Set-Cookie");
    if (cookies) {
      await AsyncStorage.setItem("authCookies", cookies);
    }

    return response.json();
  }

  async logout(): Promise<{ ok: boolean }> {
    const response = await this._fetch("/api/logout", {
      method: "POST",
    });
    await AsyncStorage.setItem("authCookies", '');
    return response.json();
  }

  async getServerConfig(): Promise<ServerConfig> {
    const response = await this._fetch("/api/server-config");
    return response.json();
  }

  async getFavorites(key?: string): Promise<Record<string, Favorite> | Favorite | null> {
    const url = key ? `/api/favorites?key=${encodeURIComponent(key)}` : "/api/favorites";
    const response = await this._fetch(url);
    return response.json();
  }

  async addFavorite(key: string, favorite: Omit<Favorite, "save_time">): Promise<{ success: boolean }> {
    const response = await this._fetch("/api/favorites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, favorite }),
    });
    return response.json();
  }

  async deleteFavorite(key?: string): Promise<{ success: boolean }> {
    const url = key ? `/api/favorites?key=${encodeURIComponent(key)}` : "/api/favorites";
    const response = await this._fetch(url, { method: "DELETE" });
    return response.json();
  }

  async getPlayRecords(): Promise<Record<string, PlayRecord>> {
    const response = await this._fetch("/api/playrecords");
    return response.json();
  }

  async savePlayRecord(key: string, record: Omit<PlayRecord, "save_time">): Promise<{ success: boolean }> {
    const response = await this._fetch("/api/playrecords", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, record }),
    });
    return response.json();
  }

  async deletePlayRecord(key?: string): Promise<{ success: boolean }> {
    const url = key ? `/api/playrecords?key=${encodeURIComponent(key)}` : "/api/playrecords";
    const response = await this._fetch(url, { method: "DELETE" });
    return response.json();
  }

  async getSearchHistory(): Promise<string[]> {
    const response = await this._fetch("/api/searchhistory");
    return response.json();
  }

  async addSearchHistory(keyword: string): Promise<string[]> {
    const response = await this._fetch("/api/searchhistory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword }),
    });
    return response.json();
  }

  async deleteSearchHistory(keyword?: string): Promise<{ success: boolean }> {
    const url = keyword ? `/api/searchhistory?keyword=${keyword}` : "/api/searchhistory";
    const response = await this._fetch(url, { method: "DELETE" });
    return response.json();
  }

  getImageProxyUrl(imageUrl: string): string {
    return `${this.baseURL}/api/image-proxy?url=${encodeURIComponent(imageUrl)}`;
  }

  async getDoubanData(
    type: "movie" | "tv",
    tag: string,
    pageSize: number = 16,
    pageStart: number = 0
  ): Promise<DoubanResponse> {
    const url = `/api/douban?type=${type}&tag=${encodeURIComponent(tag)}&pageSize=${pageSize}&pageStart=${pageStart}`;
    const response = await this._fetch(url);
    return response.json();
  }

  /**
   * 聚合搜索（服务端并发查所有源再合并）。
   *
   * 只对「超时」重试一次，别的错误重试没意义：
   * - network：断网，重试还是断；
   * - unauthorized：401 由 _fetch 内部已经重登重试过；
   * - server：4xx/5xx 是服务端自己的问题。
   *
   * 超时之所以值得重试，是因为第一次已经把 DNS/TCP/TLS 都建立起来了，
   * 第二次在已热连接上跑，往往 1 秒内就返回 —— 这正是「用过一次之后就好了」的机制。
   */
  async searchVideos(
    query: string,
    options: SearchOptions = {}
  ): Promise<{ results: SearchResult[] }> {
    const url = `/api/search?q=${encodeURIComponent(query)}`;
    const attempts = Math.max(1, options.attempts ?? SEARCH_ATTEMPTS);
    const timeoutMs = options.timeoutMs ?? SEARCH_TIMEOUT_MS;
    const backoff = options.backoffMs ?? SEARCH_BACKOFF_MS;

    let lastError: unknown;
    for (let i = 0; i < attempts; i += 1) {
      if (i > 0) {
        const wait = backoff[Math.min(i, backoff.length - 1)] ?? 0;
        if (wait > 0) await sleep(wait);
      }
      options.onAttempt?.(i + 1, attempts);
      try {
        const response = await this._fetch(url, { timeoutMs });
        return response.json();
      } catch (error) {
        // 只有超时值得再试一次：连接已建立，下一轮通常 1~2 秒就回来
        if (!(error instanceof ApiError) || error.kind !== "timeout") throw error;
        lastError = error;
      }
    }
    throw lastError ?? new ApiError("TIMEOUT", "timeout");
  }

  async searchVideo(query: string, resourceId: string, signal?: AbortSignal): Promise<{ results: SearchResult[] }> {
    const url = `/api/search/one?q=${encodeURIComponent(query)}&resourceId=${encodeURIComponent(resourceId)}`;
    const response = await this._fetch(url, { signal });
    const { results } = await response.json();
    return { results: results.filter((item: any) => item.title === query )};
  }

  /**
   * 测速专用：读完整响应体，返回字节数与耗时。
   * 拿不到视频分片时，用它来估算「服务端取源信息」的传输速度。
   */
  async measureThroughput(
    query: string,
    resourceId: string,
    signal?: AbortSignal
  ): Promise<{ bytes: number; ms: number }> {
    const url = `/api/search/one?q=${encodeURIComponent(query)}&resourceId=${encodeURIComponent(resourceId)}`;
    const startedAt = Date.now();
    const response = await this._fetch(url, { signal, timeoutMs: 8000 });
    const text = await response.text();
    return { bytes: utf8ByteLength(text), ms: Math.max(1, Date.now() - startedAt) };
  }

  async getResources(signal?: AbortSignal): Promise<ApiSite[]> {
    const url = `/api/search/resources`;
    const response = await this._fetch(url, { signal });
    return response.json();
  }

  async getVideoDetail(source: string, id: string): Promise<VideoDetail> {
    const url = `/api/detail?source=${source}&id=${id}`;
    const response = await this._fetch(url);
    return response.json();
  }
}

// 默认实例
export let api = new API();
