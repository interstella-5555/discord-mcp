import { randomInt } from "node:crypto";
import pThrottle from "p-throttle";
import { TTLCache } from "@isaacs/ttlcache";
import ms from "ms";
import { Logger } from "./logger.js";
import type { RateLimitHeaders, RequestLog } from "./types.js";

interface RequestOptions {
  tool: string;
  params?: Record<string, unknown>;
  cacheTtl?: number; // ms, Infinity for permanent
  itemsCount?: number;
}

// Cryptographically random delay between min and max ms
function jitter(minMs: number, maxMs: number): Promise<number> {
  const delay = randomInt(minMs, maxMs + 1);
  return new Promise((resolve) => setTimeout(() => resolve(delay), delay));
}

export class DiscordClient {
  private readonly baseUrl = "https://discord.com/api/v10";
  private readonly token: string;
  readonly defaultGuildId: string;
  private readonly logger: Logger;

  // Throttle: p-throttle ensures max 1 call per 3s, jitter adds 0-4s on top → 3-7s total
  private readonly throttledFetch: ReturnType<ReturnType<typeof pThrottle>>;

  // Cache — TTL entries auto-expire, Infinity entries use permanentCache
  private ttlCache = new TTLCache<string, unknown>({ max: 500 });
  private permanentCache = new Map<string, unknown>();

  // Constants
  private readonly MIN_JITTER_MS = 0;
  private readonly MAX_JITTER_MS = ms("4s");
  private readonly MAX_RETRIES = 2;

  constructor(token: string, defaultGuildId: string, logger?: Logger) {
    this.token = token;
    this.defaultGuildId = defaultGuildId;
    this.logger = logger ?? new Logger();

    const throttle = pThrottle({ limit: 1, interval: ms("3s") });
    this.throttledFetch = throttle(async (url: string, init: RequestInit) => {
      // Add random jitter on top of the 3s base throttle
      await jitter(this.MIN_JITTER_MS, this.MAX_JITTER_MS);
      return fetch(url, init);
    });
  }

  private parseRateLimitHeaders(headers: Headers): RateLimitHeaders {
    return {
      remaining: headers.has("x-ratelimit-remaining")
        ? parseInt(headers.get("x-ratelimit-remaining")!, 10)
        : null,
      resetAfter: headers.has("x-ratelimit-reset-after")
        ? parseFloat(headers.get("x-ratelimit-reset-after")!)
        : null,
      bucket: headers.get("x-ratelimit-bucket"),
    };
  }

  private cacheGet(key: string, ttl: number): unknown | undefined {
    if (ttl === Infinity) {
      return this.permanentCache.get(key);
    }
    return this.ttlCache.get(key);
  }

  private cacheSet(key: string, data: unknown, ttl: number): void {
    if (ttl === Infinity) {
      this.permanentCache.set(key, data);
    } else {
      this.ttlCache.set(key, data, { ttl });
    }
  }

  async request<T = unknown>(
    method: string,
    path: string,
    options: RequestOptions
  ): Promise<T> {
    const cacheKey = `${method}:${path}`;

    // Check cache
    if (options.cacheTtl) {
      const cached = this.cacheGet(cacheKey, options.cacheTtl);
      if (cached !== undefined) {
        this.logger.logRequest({
          ts: new Date().toISOString(),
          tool: options.tool,
          endpoint: `${method} ${path}`,
          status: 200,
          ms: 0,
          delay: 0,
          queue: 0,
          response_size: 0,
          items_count: options.itemsCount ?? 0,
          cache_hit: true,
          params: options.params ?? {},
        });
        return cached as T;
      }
    }

    // Execute with retry
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt++) {
      const start = Date.now();

      const response = await this.throttledFetch(
        `${this.baseUrl}${path}`,
        {
          method,
          headers: {
            Authorization: this.token,
            "Content-Type": "application/json",
            "User-Agent": "discord-mcp/1.0",
          },
        }
      ) as Response;

      const responseText = await response.text();
      const elapsed = Date.now() - start;
      const rateLimits = this.parseRateLimitHeaders(response.headers);

      const log: RequestLog = {
        ts: new Date().toISOString(),
        tool: options.tool,
        endpoint: `${method} ${path}`,
        status: response.status,
        ms: elapsed,
        delay: elapsed / 1000,
        queue: 0,
        response_size: responseText.length,
        items_count: 0,
        cache_hit: false,
        params: options.params ?? {},
      };

      if (response.status === 429) {
        let retryAfter = 5; // default fallback
        try {
          const body = JSON.parse(responseText);
          retryAfter = body.retry_after ?? retryAfter;
        } catch {}

        log.retry_after = retryAfter;
        log.retry = attempt + 1;
        log.ratelimit_remaining = rateLimits.remaining ?? undefined;
        log.ratelimit_reset_after = rateLimits.resetAfter ?? undefined;
        this.logger.logRequest(log);

        if (attempt < this.MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, retryAfter * 1000));
          continue;
        }

        lastError = new Error(
          `Rate limited on ${method} ${path} after ${this.MAX_RETRIES} retries`
        );
        break;
      }

      if (!response.ok) {
        this.logger.logRequest(log);
        throw new Error(
          `Discord API error ${response.status}: ${responseText}`
        );
      }

      const data = JSON.parse(responseText);
      log.items_count = Array.isArray(data)
        ? data.length
        : data?.messages
          ? data.messages.length
          : 1;
      this.logger.logRequest(log);

      // Cache if requested
      if (options.cacheTtl) {
        this.cacheSet(cacheKey, data, options.cacheTtl);
      }

      return data as T;
    }

    throw lastError ?? new Error("Request failed");
  }

  getLogger(): Logger {
    return this.logger;
  }
}
