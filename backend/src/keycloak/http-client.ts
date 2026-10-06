import { Agent, EnvHttpProxyAgent, request, type Dispatcher } from 'undici';
import {
  KeycloakHttpError,
  KeycloakNetworkError,
  WafBlockedError,
} from './errors.js';
import { RateLimiter, defaultSleep, type Sleep } from './rate-limiter.js';

const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const MAX_BACKOFF_MS = 60_000;

export interface HttpClientOptions {
  maxConcurrency: number;
  minIntervalMs: number;
  maxRetries: number;
  retryBaseDelayMs: number;
  requestTimeoutMs: number;
  httpsProxy?: string;
  httpProxy?: string;
  noProxy?: string;
  now?: () => number;
  sleep?: Sleep;
}

export interface HttpRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

export function header(res: HttpResponse, name: string): string | undefined {
  const value = res.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

export function isJson(res: HttpResponse): boolean {
  if ((header(res, 'content-type') ?? '').includes('json')) return true;
  const trimmed = res.body.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

/**
 * Cliente HTTP do RH-SSO: toda requisição passa pelo limitador, falhas
 * transitórias são repetidas com backoff e bloqueios do WAF são sinalizados.
 */
export class KeycloakHttpClient {
  readonly limiter: RateLimiter;
  private readonly dispatcher: Dispatcher;
  private readonly sleep: Sleep;

  constructor(private readonly options: HttpClientOptions) {
    this.sleep = options.sleep ?? defaultSleep;
    this.limiter = new RateLimiter(
      options.maxConcurrency,
      options.minIntervalMs,
      options.now ?? Date.now,
      this.sleep,
    );
    this.dispatcher =
      options.httpsProxy || options.httpProxy
        ? new EnvHttpProxyAgent({
            httpsProxy: options.httpsProxy ?? options.httpProxy,
            httpProxy: options.httpProxy ?? options.httpsProxy,
            noProxy: options.noProxy ?? '',
          })
        : new Agent();
  }

  async send(req: HttpRequest): Promise<HttpResponse> {
    for (let attempt = 0; ; attempt++) {
      let res: HttpResponse;
      try {
        res = await this.limiter.schedule(() => this.execute(req));
      } catch (err) {
        if (attempt >= this.options.maxRetries) throw new KeycloakNetworkError(err);
        this.limiter.delayAll(this.backoff(attempt));
        continue;
      }

      if (RETRYABLE_STATUS.has(res.status)) {
        if (attempt >= this.options.maxRetries) throw new KeycloakHttpError(res.status, res.body);
        this.limiter.delayAll(this.retryAfterMs(res) ?? this.backoff(attempt));
        continue;
      }

      if (res.status === 403 && !isJson(res)) throw new WafBlockedError(res.status, res.body);

      return res;
    }
  }

  async close(): Promise<void> {
    await this.dispatcher.close();
  }

  private async execute(req: HttpRequest): Promise<HttpResponse> {
    const res = await request(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body,
      dispatcher: this.dispatcher,
      headersTimeout: this.options.requestTimeoutMs,
      bodyTimeout: this.options.requestTimeoutMs,
    });
    const body = await res.body.text();
    return { status: res.statusCode, headers: res.headers, body };
  }

  private backoff(attempt: number): number {
    return Math.min(this.options.retryBaseDelayMs * 2 ** attempt, MAX_BACKOFF_MS);
  }

  private retryAfterMs(res: HttpResponse): number | undefined {
    const value = header(res, 'retry-after');
    if (!value) return undefined;
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const date = Date.parse(value);
    return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
  }
}
