# Discord MCP Server Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a read-only Discord MCP server for Claude Code with 10 tools, conservative throttling (3-7s jitter), and structured JSON line logging.

**Architecture:** TypeScript MCP server using stdio transport. DiscordClient class handles auth, throttle queue, retry (max 2), and in-memory cache. Formatters convert Discord API responses to LLM-readable text. Logger tracks every request for later tuning.

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk`, `zod`, `bun` (runtime, test runner, package manager)

**Design doc:** `docs/plans/2026-03-09-discord-mcp-design.md`

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `src/index.ts` (minimal placeholder to verify build)

**Step 1: Create package.json**

```json
{
  "name": "discord-mcp",
  "version": "1.0.0",
  "type": "module",
  "bin": {
    "discord-mcp": "./build/index.js"
  },
  "scripts": {
    "build": "tsc",
    "test": "bun test",
    "inspector": "bunx @modelcontextprotocol/inspector node build/index.js"
  },
  "files": ["build"]
}
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "./build",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```

**Step 3: Create .gitignore**

```
node_modules/
build/
.env
```

**Step 4: Install dependencies**

Run:
```bash
bun add @modelcontextprotocol/sdk zod
bun add -D @types/node typescript @types/bun
```

**Step 5: Create placeholder src/index.ts**

```typescript
#!/usr/bin/env node
console.error("discord-mcp server starting...");
```

**Step 6: Verify build**

Run: `bun run build`
Expected: `build/index.js` created, no errors.

**Step 7: Commit**

```bash
git add package.json tsconfig.json .gitignore src/index.ts bun.lockb
git commit -m "chore: scaffold project with dependencies"
```

---

### Task 2: Types

**Files:**
- Create: `src/types.ts`

**Step 1: Write Discord API types**

```typescript
// Discord API v10 response types (read-only subset)

export interface DiscordUser {
  id: string;
  username: string;
  discriminator: string;
  global_name: string | null;
  avatar: string | null;
}

export interface DiscordGuildMember {
  user?: DiscordUser;
  nick: string | null;
  roles: string[];
  joined_at: string;
}

export interface DiscordAttachment {
  id: string;
  filename: string;
  size: number;
  url: string;
  width?: number;
  height?: number;
  content_type?: string;
}

export interface DiscordReaction {
  emoji: { id: string | null; name: string | null };
  count: number;
}

export interface DiscordMessage {
  id: string;
  channel_id: string;
  author: DiscordUser;
  content: string;
  timestamp: string;
  edited_timestamp: string | null;
  attachments: DiscordAttachment[];
  reactions?: DiscordReaction[];
  thread?: { id: string; name: string; message_count: number };
  referenced_message?: DiscordMessage | null;
  type: number;
}

export interface DiscordChannel {
  id: string;
  type: number;
  name?: string;
  topic?: string;
  parent_id?: string | null;
  position?: number;
  last_message_id?: string | null;
}

export interface DiscordDMChannel {
  id: string;
  type: number;
  recipients: DiscordUser[];
  last_message_id: string | null;
}

export interface DiscordThread {
  id: string;
  name: string;
  parent_id: string;
  message_count: number;
  member_count: number;
  archived: boolean;
  owner_id?: string;
}

export interface DiscordThreadMember {
  id?: string;
  user_id?: string;
  join_timestamp: string;
}

export interface DiscordSearchResult {
  messages: DiscordMessage[][];
  total_results: number;
}

export interface DiscordReactionUser {
  id: string;
  username: string;
  global_name: string | null;
}

// Channel types enum
export const ChannelType = {
  GUILD_TEXT: 0,
  DM: 1,
  GUILD_VOICE: 2,
  GROUP_DM: 3,
  GUILD_CATEGORY: 4,
  GUILD_ANNOUNCEMENT: 5,
  GUILD_STAGE_VOICE: 13,
  GUILD_FORUM: 15,
  GUILD_MEDIA: 16,
} as const;

// Rate limit response
export interface RateLimitHeaders {
  remaining: number | null;
  resetAfter: number | null;
  bucket: string | null;
}

// Logger types
export interface RequestLog {
  ts: string;
  tool: string;
  endpoint: string;
  status: number;
  ms: number;
  delay: number;
  queue: number;
  response_size: number;
  items_count: number;
  cache_hit: boolean;
  params: Record<string, unknown>;
  // 429-specific fields
  retry_after?: number;
  retry?: number;
  ratelimit_remaining?: number;
  ratelimit_reset_after?: number;
}
```

**Step 2: Commit**

```bash
git add src/types.ts
git commit -m "feat: add Discord API and logger types"
```

---

### Task 3: Logger

**Files:**
- Create: `src/logger.ts`
- Create: `tests/logger.test.ts`

**Step 1: Write the logger tests**

```typescript
import { describe, it, expect, beforeEach, vi, mock } from "bun:test";
import { Logger } from "../src/logger.js";

describe("Logger", () => {
  let logger: Logger;

  beforeEach(() => {
    logger = new Logger();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("logs a request as JSON line to stderr", () => {
    logger.logRequest({
      ts: "2024-03-09T14:00:00Z",
      tool: "get_me",
      endpoint: "GET /users/@me",
      status: 200,
      ms: 150,
      delay: 4.5,
      queue: 0,
      response_size: 512,
      items_count: 1,
      cache_hit: false,
      params: {},
    });

    expect(console.error).toHaveBeenCalledOnce();
    const logged = JSON.parse(
      (console.error as ReturnType<typeof vi.fn>).mock.calls[0][0]
    );
    expect(logged.tool).toBe("get_me");
    expect(logged.status).toBe(200);
  });

  it("tracks stats correctly", () => {
    logger.logRequest({
      ts: "2024-03-09T14:00:00Z",
      tool: "read_messages",
      endpoint: "GET /channels/1/messages",
      status: 200,
      ms: 200,
      delay: 5.0,
      queue: 0,
      response_size: 1024,
      items_count: 50,
      cache_hit: false,
      params: {},
    });
    logger.logRequest({
      ts: "2024-03-09T14:00:05Z",
      tool: "search_messages",
      endpoint: "GET /guilds/1/messages/search",
      status: 429,
      ms: 50,
      delay: 4.1,
      queue: 2,
      response_size: 100,
      items_count: 0,
      cache_hit: false,
      params: {},
      retry_after: 5.0,
      retry: 1,
      ratelimit_remaining: 0,
      ratelimit_reset_after: 5.0,
    });

    const stats = logger.getStats();
    expect(stats.totalRequests).toBe(2);
    expect(stats.requestsByTool["read_messages"]).toBe(1);
    expect(stats.requestsByTool["search_messages"]).toBe(1);
    expect(stats.errors429).toBe(1);
    expect(stats.peakQueueDepth).toBe(2);
  });

  it("tracks peak queue depth", () => {
    logger.logRequest({
      ts: "t1",
      tool: "a",
      endpoint: "e",
      status: 200,
      ms: 1,
      delay: 1,
      queue: 5,
      response_size: 0,
      items_count: 0,
      cache_hit: false,
      params: {},
    });
    logger.logRequest({
      ts: "t2",
      tool: "b",
      endpoint: "e",
      status: 200,
      ms: 1,
      delay: 1,
      queue: 2,
      response_size: 0,
      items_count: 0,
      cache_hit: false,
      params: {},
    });

    expect(logger.getStats().peakQueueDepth).toBe(5);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/logger.test.ts`
Expected: FAIL — `Cannot find module '../src/logger.js'`

**Step 3: Implement logger**

```typescript
import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { RequestLog } from "./types.js";

interface Stats {
  totalRequests: number;
  requestsByTool: Record<string, number>;
  errors429: number;
  error429Details: { tool: string; ts: string }[];
  avgDelayMs: number;
  minDelayMs: number;
  maxDelayMs: number;
  avgResponseMs: number;
  peakQueueDepth: number;
  peakQueueTs: string;
  startTime: number;
}

export class Logger {
  private stats: Stats = {
    totalRequests: 0,
    requestsByTool: {},
    errors429: 0,
    error429Details: [],
    avgDelayMs: 0,
    minDelayMs: Infinity,
    maxDelayMs: 0,
    avgResponseMs: 0,
    peakQueueDepth: 0,
    peakQueueTs: "",
    startTime: Date.now(),
  };

  private totalDelay = 0;
  private totalResponseMs = 0;
  private readonly STATS_INTERVAL = 50;
  private readonly logDir: string;
  private readonly logFile: string;

  constructor(logDir?: string) {
    this.logDir = logDir ?? join(homedir(), ".discord-mcp", "logs");
    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true });
    }
    const date = new Date().toISOString().split("T")[0];
    this.logFile = join(this.logDir, `${date}.log`);
  }

  private writeToFile(line: string): void {
    try {
      appendFileSync(this.logFile, line + "\n");
    } catch {
      // If file write fails, still continue — don't crash the server
    }
  }

  logRequest(log: RequestLog): void {
    const line = JSON.stringify(log);
    console.error(line);
    this.writeToFile(line);

    this.stats.totalRequests++;
    this.stats.requestsByTool[log.tool] =
      (this.stats.requestsByTool[log.tool] || 0) + 1;

    this.totalDelay += log.delay;
    this.totalResponseMs += log.ms;
    this.stats.avgDelayMs = this.totalDelay / this.stats.totalRequests;
    this.stats.avgResponseMs = this.totalResponseMs / this.stats.totalRequests;

    if (log.delay < this.stats.minDelayMs) this.stats.minDelayMs = log.delay;
    if (log.delay > this.stats.maxDelayMs) this.stats.maxDelayMs = log.delay;

    if (log.queue > this.stats.peakQueueDepth) {
      this.stats.peakQueueDepth = log.queue;
      this.stats.peakQueueTs = log.ts;
    }

    if (log.status === 429) {
      this.stats.errors429++;
      this.stats.error429Details.push({ tool: log.tool, ts: log.ts });
    }

    if (this.stats.totalRequests % this.STATS_INTERVAL === 0) {
      this.printStats();
    }
  }

  getStats(): Stats {
    return { ...this.stats };
  }

  printStats(): void {
    const uptime = Date.now() - this.stats.startTime;
    const hours = Math.floor(uptime / 3600000);
    const minutes = Math.floor((uptime % 3600000) / 60000);

    const summary = [
      "=== Discord MCP Stats ===",
      `Uptime: ${hours}h ${minutes}m`,
      `Total requests: ${this.stats.totalRequests}`,
      `Requests by tool: ${JSON.stringify(this.stats.requestsByTool)}`,
      `429 errors: ${this.stats.errors429}${this.stats.error429Details.length > 0 ? ` (${this.stats.error429Details.map((e) => `${e.tool} @ ${e.ts}`).join(", ")})` : ""}`,
      `Avg delay: ${this.stats.avgDelayMs.toFixed(1)}s (min: ${this.stats.minDelayMs === Infinity ? "N/A" : this.stats.minDelayMs.toFixed(1)}s, max: ${this.stats.maxDelayMs.toFixed(1)}s)`,
      `Avg response time: ${this.stats.avgResponseMs.toFixed(0)}ms`,
      `Peak queue depth: ${this.stats.peakQueueDepth}${this.stats.peakQueueTs ? ` (at ${this.stats.peakQueueTs})` : ""}`,
    ].join("\n");

    console.error(summary);
    this.writeToFile(summary);
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/logger.test.ts`
Expected: All 3 tests PASS.

**Step 5: Commit**

```bash
git add src/logger.ts tests/logger.test.ts
git commit -m "feat: add request logger with stats aggregation"
```

---

### Task 4: Discord Client

**Files:**
- Create: `src/discord.ts`
- Create: `tests/discord.test.ts`

**Step 1: Write tests for throttle queue and cache**

```typescript
import { describe, it, expect, beforeEach, vi, mock } from "bun:test";
import { DiscordClient } from "../src/discord.js";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("DiscordClient", () => {
  let client: DiscordClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new DiscordClient("test-token", "test-guild");
  });

  describe("throttle", () => {
    it("enforces minimum delay between requests", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () => JSON.stringify({ id: "1" }),
      });

      const start = Date.now();
      await client.request("GET", "/users/@me", { tool: "get_me" });
      await client.request("GET", "/users/@me", { tool: "get_me" });
      const elapsed = Date.now() - start;

      // Second request should have waited at least 3s (min jitter)
      expect(elapsed).toBeGreaterThanOrEqual(2900);
    }, 15000);
  });

  describe("cache", () => {
    it("caches responses with permanent TTL", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () => JSON.stringify({ id: "1", username: "test" }),
      });

      const r1 = await client.request("GET", "/users/@me", {
        tool: "get_me",
        cacheTtl: Infinity,
      });
      const r2 = await client.request("GET", "/users/@me", {
        tool: "get_me",
        cacheTtl: Infinity,
      });

      expect(mockFetch).toHaveBeenCalledOnce();
      expect(r1).toEqual(r2);
    });

    it("does not cache when cacheTtl is not set", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () => JSON.stringify([]),
      });

      await client.request("GET", "/channels/1/messages", {
        tool: "read_messages",
      });
      await client.request("GET", "/channels/1/messages", {
        tool: "read_messages",
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);
    }, 15000);
  });

  describe("retry on 429", () => {
    it("retries with retry_after delay", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: new Headers({
            "retry-after": "1",
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset-after": "1",
          }),
          text: async () =>
            JSON.stringify({
              retry_after: 1,
              global: false,
              message: "You are being rate limited.",
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          text: async () => JSON.stringify({ id: "1" }),
        });

      const result = await client.request("GET", "/users/@me", {
        tool: "get_me",
      });
      expect(result).toEqual({ id: "1" });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    }, 15000);

    it("throws after max retries exceeded", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        headers: new Headers({ "retry-after": "1" }),
        text: async () =>
          JSON.stringify({ retry_after: 1, global: false }),
      });

      await expect(
        client.request("GET", "/users/@me", { tool: "get_me" })
      ).rejects.toThrow("Rate limited");
    }, 30000);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/discord.test.ts`
Expected: FAIL — `Cannot find module '../src/discord.js'`

**Step 3: Implement DiscordClient**

```typescript
import { Logger } from "./logger.js";
import type { RateLimitHeaders, RequestLog } from "./types.js";

interface RequestOptions {
  tool: string;
  params?: Record<string, unknown>;
  cacheTtl?: number; // ms, Infinity for permanent
  itemsCount?: number;
}

interface CacheEntry {
  data: unknown;
  expiry: number; // timestamp, Infinity for permanent
}

export class DiscordClient {
  private readonly baseUrl = "https://discord.com/api/v10";
  private readonly token: string;
  readonly defaultGuildId: string;
  private readonly logger: Logger;

  // Throttle state
  private lastRequestTime = 0;
  private queue: Array<{
    resolve: () => void;
  }> = [];
  private processing = false;

  // Cache
  private cache = new Map<string, CacheEntry>();

  // Constants
  private readonly MIN_DELAY_MS = 3000;
  private readonly MAX_DELAY_MS = 7000;
  private readonly MAX_RETRIES = 2;

  constructor(token: string, defaultGuildId: string, logger?: Logger) {
    this.token = token;
    this.defaultGuildId = defaultGuildId;
    this.logger = logger ?? new Logger();
  }

  private getJitterDelay(): number {
    return (
      this.MIN_DELAY_MS +
      Math.random() * (this.MAX_DELAY_MS - this.MIN_DELAY_MS)
    );
  }

  private async waitForSlot(): Promise<number> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    const delay = this.getJitterDelay();
    const waitTime = Math.max(0, delay - elapsed);

    if (waitTime > 0) {
      await new Promise((r) => setTimeout(r, waitTime));
    }

    this.lastRequestTime = Date.now();
    return waitTime / 1000; // return delay in seconds for logging
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

  async request<T = unknown>(
    method: string,
    path: string,
    options: RequestOptions
  ): Promise<T> {
    const cacheKey = `${method}:${path}`;

    // Check cache
    if (options.cacheTtl) {
      const cached = this.cache.get(cacheKey);
      if (cached && (cached.expiry === Infinity || cached.expiry > Date.now())) {
        this.logger.logRequest({
          ts: new Date().toISOString(),
          tool: options.tool,
          endpoint: `${method} ${path}`,
          status: 200,
          ms: 0,
          delay: 0,
          queue: this.queue.length,
          response_size: 0,
          items_count: options.itemsCount ?? 0,
          cache_hit: true,
          params: options.params ?? {},
        });
        return cached.data as T;
      }
    }

    // Wait for throttle slot
    const queueDepth = this.queue.length;
    const delaySeconds = await this.waitForSlot();

    // Execute with retry
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt++) {
      const start = Date.now();

      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: this.token,
          "Content-Type": "application/json",
          "User-Agent": "discord-mcp/1.0",
        },
      });

      const responseText = await response.text();
      const elapsed = Date.now() - start;
      const rateLimits = this.parseRateLimitHeaders(response.headers);

      const log: RequestLog = {
        ts: new Date().toISOString(),
        tool: options.tool,
        endpoint: `${method} ${path}`,
        status: response.status,
        ms: elapsed,
        delay: delaySeconds,
        queue: queueDepth,
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
          const backoff = retryAfter * 1000 + this.getJitterDelay();
          await new Promise((r) => setTimeout(r, backoff));
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
        this.cache.set(cacheKey, {
          data,
          expiry:
            options.cacheTtl === Infinity
              ? Infinity
              : Date.now() + options.cacheTtl,
        });
      }

      return data as T;
    }

    throw lastError ?? new Error("Request failed");
  }

  getLogger(): Logger {
    return this.logger;
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/discord.test.ts`
Expected: All 4 tests PASS. The throttle test may take ~3s due to jitter delay.

**Step 5: Commit**

```bash
git add src/discord.ts tests/discord.test.ts
git commit -m "feat: add DiscordClient with throttle, retry, and cache"
```

---

### Task 5: Formatters

**Files:**
- Create: `src/formatters.ts`
- Create: `tests/formatters.test.ts`

**Step 1: Write formatter tests**

```typescript
import { describe, it, expect } from "bun:test";
import {
  formatMessages,
  formatChannels,
  formatSearchResults,
  formatDMList,
  formatUser,
  formatPinnedMessages,
  formatThreadParticipants,
  formatReactions,
} from "../src/formatters.js";
import type {
  DiscordMessage,
  DiscordChannel,
  DiscordDMChannel,
  DiscordUser,
  DiscordGuildMember,
  DiscordSearchResult,
  DiscordThreadMember,
  DiscordReactionUser,
} from "../src/types.js";
import { ChannelType } from "../src/types.js";

const makeMessage = (overrides: Partial<DiscordMessage> = {}): DiscordMessage => ({
  id: "1",
  channel_id: "100",
  author: { id: "10", username: "alice", discriminator: "0", global_name: "Alice", avatar: null },
  content: "Hello world",
  timestamp: "2024-03-09T12:34:00.000Z",
  edited_timestamp: null,
  attachments: [],
  type: 0,
  ...overrides,
});

describe("formatMessages", () => {
  it("formats basic messages with timestamps and authors", () => {
    const result = formatMessages([makeMessage()]);
    expect(result).toContain("@alice");
    expect(result).toContain("Hello world");
    expect(result).toContain("12:34");
  });

  it("shows attachments as metadata", () => {
    const msg = makeMessage({
      attachments: [
        { id: "1", filename: "screenshot.png", size: 1200000, url: "https://cdn.discordapp.com/a/b/screenshot.png", width: 1920, height: 1080 },
      ],
    });
    const result = formatMessages([msg]);
    expect(result).toContain("screenshot.png");
    expect(result).toContain("1.2MB");
    expect(result).toContain("1920x1080");
  });

  it("shows thread info", () => {
    const msg = makeMessage({
      thread: { id: "200", name: "Bug discussion", message_count: 5 },
    });
    const result = formatMessages([msg]);
    expect(result).toContain("Bug discussion");
    expect(result).toContain("5 messages");
  });
});

describe("formatChannels", () => {
  it("groups channels by category", () => {
    const channels: DiscordChannel[] = [
      { id: "1", type: ChannelType.GUILD_CATEGORY, name: "Engineering", position: 0 },
      { id: "2", type: ChannelType.GUILD_TEXT, name: "general", parent_id: "1", position: 0 },
      { id: "3", type: ChannelType.GUILD_TEXT, name: "random", parent_id: null, position: 1 },
    ];
    const result = formatChannels(channels);
    expect(result).toContain("Engineering");
    expect(result).toContain("#general");
    expect(result).toContain("#random");
  });
});

describe("formatDMList", () => {
  it("formats DM conversations", () => {
    const dms: DiscordDMChannel[] = [
      { id: "1", type: ChannelType.DM, recipients: [{ id: "10", username: "alice", discriminator: "0", global_name: "Alice", avatar: null }], last_message_id: "999" },
      { id: "2", type: ChannelType.GROUP_DM, recipients: [
        { id: "10", username: "alice", discriminator: "0", global_name: null, avatar: null },
        { id: "11", username: "bob", discriminator: "0", global_name: null, avatar: null },
      ], last_message_id: "888" },
    ];
    const result = formatDMList(dms);
    expect(result).toContain("@alice");
    expect(result).toContain("Group:");
    expect(result).toContain("bob");
  });
});

describe("formatUser", () => {
  it("formats user with guild member info", () => {
    const user: DiscordUser = { id: "10", username: "alice", discriminator: "0", global_name: "Alice Smith", avatar: null };
    const member: DiscordGuildMember = { nick: "ali", roles: ["123"], joined_at: "2023-01-01T00:00:00Z" };
    const result = formatUser(user, member);
    expect(result).toContain("alice");
    expect(result).toContain("Alice Smith");
    expect(result).toContain("ali");
  });
});

describe("formatSearchResults", () => {
  it("formats search results with context", () => {
    const results: DiscordSearchResult = {
      messages: [[makeMessage({ content: "deployment issue on staging" })]],
      total_results: 1,
    };
    const result = formatSearchResults(results);
    expect(result).toContain("1 result");
    expect(result).toContain("deployment issue on staging");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/formatters.test.ts`
Expected: FAIL — `Cannot find module '../src/formatters.js'`

**Step 3: Implement formatters**

```typescript
import type {
  DiscordMessage,
  DiscordChannel,
  DiscordDMChannel,
  DiscordUser,
  DiscordGuildMember,
  DiscordSearchResult,
  DiscordThreadMember,
  DiscordReactionUser,
  DiscordAttachment,
} from "./types.js";
import { ChannelType } from "./types.js";

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function formatDate(iso: string): string {
  return new Date(iso).toISOString().split("T")[0];
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatAttachment(att: DiscordAttachment): string {
  const dims = att.width && att.height ? `, ${att.width}x${att.height}` : "";
  return `  📎 ${att.filename} (${formatFileSize(att.size)}${dims}) ${att.url}`;
}

function formatSingleMessage(msg: DiscordMessage): string {
  const time = formatTimestamp(msg.timestamp);
  const author = `@${msg.author.username}`;
  const lines: string[] = [];

  const reply = msg.referenced_message
    ? ` (replying to @${msg.referenced_message.author.username})`
    : "";

  lines.push(`[${time}] ${author}${reply}: ${msg.content}`);

  for (const att of msg.attachments) {
    lines.push(formatAttachment(att));
  }

  if (msg.thread) {
    lines.push(
      `  -> [thread: "${msg.thread.name}" | ${msg.thread.message_count} messages]`
    );
  }

  if (msg.reactions && msg.reactions.length > 0) {
    const reactionStr = msg.reactions
      .map((r) => `${r.emoji.name} (${r.count})`)
      .join(" | ");
    lines.push(`  ${reactionStr}`);
  }

  return lines.join("\n");
}

export function formatMessages(
  messages: DiscordMessage[],
  channelName?: string
): string {
  if (messages.length === 0) return "No messages found.";

  const sorted = [...messages].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  const header = channelName
    ? `#${channelName} | ${formatDate(sorted[0].timestamp)}`
    : formatDate(sorted[0].timestamp);

  const body = sorted.map(formatSingleMessage).join("\n");
  return `${header}\n\n${body}`;
}

function channelTypeLabel(type: number): string {
  switch (type) {
    case ChannelType.GUILD_TEXT: return "text";
    case ChannelType.GUILD_VOICE: return "voice";
    case ChannelType.GUILD_ANNOUNCEMENT: return "announcement";
    case ChannelType.GUILD_STAGE_VOICE: return "stage";
    case ChannelType.GUILD_FORUM: return "forum";
    case ChannelType.GUILD_MEDIA: return "media";
    default: return "text";
  }
}

export function formatChannels(channels: DiscordChannel[]): string {
  const categories = channels.filter(
    (c) => c.type === ChannelType.GUILD_CATEGORY
  );
  const nonCategories = channels.filter(
    (c) => c.type !== ChannelType.GUILD_CATEGORY
  );

  const lines: string[] = [];

  // Channels without category
  const uncategorized = nonCategories.filter((c) => !c.parent_id);
  if (uncategorized.length > 0) {
    for (const ch of uncategorized.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))) {
      lines.push(`  #${ch.name} (${channelTypeLabel(ch.type)})`);
    }
  }

  // Channels grouped by category
  for (const cat of categories.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))) {
    lines.push(`\nCategory: ${cat.name}`);
    const children = nonCategories
      .filter((c) => c.parent_id === cat.id)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    for (const ch of children) {
      lines.push(`  #${ch.name} (${channelTypeLabel(ch.type)})`);
    }
  }

  return lines.join("\n");
}

export function formatDMList(dms: DiscordDMChannel[]): string {
  if (dms.length === 0) return "No DM conversations.";

  const lines: string[] = ["DM Conversations:"];
  let i = 1;

  for (const dm of dms) {
    if (dm.type === ChannelType.DM) {
      const user = dm.recipients[0];
      lines.push(`${i}. @${user.username} (id: ${dm.id})`);
    } else if (dm.type === ChannelType.GROUP_DM) {
      const names = dm.recipients.map((r) => r.username).join(", ");
      lines.push(`${i}. Group: ${names} (id: ${dm.id})`);
    }
    i++;
  }

  return lines.join("\n");
}

export function formatUser(
  user: DiscordUser,
  member?: DiscordGuildMember
): string {
  const lines: string[] = [
    `Username: @${user.username}`,
    `Display name: ${user.global_name ?? user.username}`,
    `ID: ${user.id}`,
  ];

  if (member) {
    if (member.nick) lines.push(`Server nickname: ${member.nick}`);
    lines.push(`Joined: ${formatDate(member.joined_at)}`);
  }

  return lines.join("\n");
}

export function formatSearchResults(results: DiscordSearchResult): string {
  if (results.total_results === 0) return "No results found.";

  const lines: string[] = [
    `Found ${results.total_results} result${results.total_results === 1 ? "" : "s"}:`,
    "",
  ];

  let i = 1;
  for (const messageGroup of results.messages) {
    // The first message in each group is the matched message
    const msg = messageGroup[0];
    if (!msg) continue;

    const time = `${formatDate(msg.timestamp)} ${formatTimestamp(msg.timestamp)}`;
    lines.push(`${i}. [${time}] @${msg.author.username}: ${msg.content}`);
    i++;
  }

  return lines.join("\n");
}

export function formatPinnedMessages(messages: DiscordMessage[]): string {
  if (messages.length === 0) return "No pinned messages.";
  return `Pinned messages (${messages.length}):\n\n${messages.map(formatSingleMessage).join("\n\n")}`;
}

export function formatThreadParticipants(
  members: DiscordThreadMember[]
): string {
  if (members.length === 0) return "No participants.";
  return `Thread participants (${members.length}):\n${members.map((m) => `- User ID: ${m.user_id ?? m.id ?? "unknown"} (joined: ${formatDate(m.join_timestamp)})`).join("\n")}`;
}

export function formatReactions(
  users: DiscordReactionUser[],
  emoji: string
): string {
  if (users.length === 0) return `No reactions with ${emoji}.`;
  return `Reactions ${emoji} (${users.length}):\n${users.map((u) => `- @${u.username}${u.global_name ? ` (${u.global_name})` : ""}`).join("\n")}`;
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/formatters.test.ts`
Expected: All tests PASS.

**Step 5: Commit**

```bash
git add src/formatters.ts tests/formatters.test.ts
git commit -m "feat: add response formatters for all tool outputs"
```

---

### Task 6: Server + Tools Batch 1 (get_me, list_channels, read_messages, list_dms)

**Files:**
- Modify: `src/index.ts`

**Step 1: Implement server setup and first 4 tools**

Replace `src/index.ts` with:

```typescript
#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { DiscordClient } from "./discord.js";
import { Logger } from "./logger.js";
import {
  formatMessages,
  formatChannels,
  formatDMList,
  formatUser,
} from "./formatters.js";
import type {
  DiscordUser,
  DiscordChannel,
  DiscordMessage,
  DiscordDMChannel,
} from "./types.js";

// --- Config from env ---
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;

if (!DISCORD_TOKEN) {
  console.error("DISCORD_TOKEN env var is required");
  process.exit(1);
}
if (!DISCORD_GUILD_ID) {
  console.error("DISCORD_GUILD_ID env var is required");
  process.exit(1);
}

// --- Init ---
const logger = new Logger();
const discord = new DiscordClient(DISCORD_TOKEN, DISCORD_GUILD_ID, logger);

const server = new McpServer({
  name: "discord-mcp",
  version: "1.0.0",
});

// --- Tools ---

server.registerTool(
  "get_me",
  {
    description:
      "Get current Discord user info (username, ID, display name)",
    inputSchema: z.object({}),
  },
  async () => {
    const user = await discord.request<DiscordUser>("GET", "/users/@me", {
      tool: "get_me",
      cacheTtl: Infinity,
    });
    return {
      content: [{ type: "text" as const, text: formatUser(user) }],
    };
  }
);

server.registerTool(
  "list_channels",
  {
    description:
      "List all channels in a Discord server, grouped by category",
    inputSchema: z.object({
      guild_id: z
        .string()
        .optional()
        .describe(
          "Guild ID (defaults to DISCORD_GUILD_ID from config)"
        ),
    }),
  },
  async ({ guild_id }) => {
    const gid = guild_id || discord.defaultGuildId;
    const channels = await discord.request<DiscordChannel[]>(
      "GET",
      `/guilds/${gid}/channels`,
      {
        tool: "list_channels",
        params: { guild_id: gid },
        cacheTtl: Infinity,
      }
    );
    return {
      content: [{ type: "text" as const, text: formatChannels(channels) }],
    };
  }
);

server.registerTool(
  "read_messages",
  {
    description:
      "Read messages from any channel, thread, DM, or forum post. Use 'around' to get context around a specific message.",
    inputSchema: z.object({
      channel_id: z.string().describe("Channel, thread, or DM channel ID"),
      limit: z
        .number()
        .min(1)
        .max(100)
        .optional()
        .describe("Number of messages to fetch (1-100, default 50)"),
      before: z
        .string()
        .optional()
        .describe("Get messages before this message ID"),
      after: z
        .string()
        .optional()
        .describe("Get messages after this message ID"),
      around: z
        .string()
        .optional()
        .describe("Get messages around this message ID (for context)"),
    }),
  },
  async ({ channel_id, limit, before, after, around }) => {
    const params = new URLSearchParams();
    params.set("limit", String(limit ?? 50));
    if (before) params.set("before", before);
    if (after) params.set("after", after);
    if (around) params.set("around", around);

    const messages = await discord.request<DiscordMessage[]>(
      "GET",
      `/channels/${channel_id}/messages?${params}`,
      {
        tool: "read_messages",
        params: { channel_id, limit: limit ?? 50, before, after, around },
      }
    );
    return {
      content: [
        { type: "text" as const, text: formatMessages(messages) },
      ],
    };
  }
);

server.registerTool(
  "list_dms",
  {
    description:
      "List DM conversations (direct messages and group DMs). Returns channel IDs you can use with read_messages.",
    inputSchema: z.object({}),
  },
  async () => {
    const dms = await discord.request<DiscordDMChannel[]>(
      "GET",
      "/users/@me/channels",
      {
        tool: "list_dms",
        cacheTtl: 5 * 60 * 1000, // 5 min
      }
    );
    return {
      content: [{ type: "text" as const, text: formatDMList(dms) }],
    };
  }
);

// --- Start server ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Discord MCP server running on stdio");

  process.on("SIGINT", () => {
    logger.printStats();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    logger.printStats();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
```

**Step 2: Build and verify**

Run: `bun run build`
Expected: No compilation errors.

**Step 3: Test with MCP Inspector**

Run: `DISCORD_TOKEN=your_token DISCORD_GUILD_ID=your_guild bunx @modelcontextprotocol/inspector node build/index.js`

Test each tool in the Inspector UI:
- `get_me` — should return your user info
- `list_channels` — should return server channels grouped by category
- `read_messages` — pick a channel_id from list_channels, should return messages
- `list_dms` — should return DM conversations

**Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: add server with get_me, list_channels, read_messages, list_dms tools"
```

---

### Task 7: Tools Batch 2 (search_messages, list_threads, list_pinned_messages)

**Files:**
- Modify: `src/index.ts`

**Step 1: Add 3 more tools after the `list_dms` registration**

Add before `// --- Start server ---`:

```typescript
import {
  formatSearchResults,
  formatPinnedMessages,
} from "./formatters.js";
import type {
  DiscordSearchResult,
  DiscordThread,
} from "./types.js";

server.registerTool(
  "search_messages",
  {
    description:
      "Search messages in a Discord server. Supports filtering by content, author, channel, attachments, and date range.",
    inputSchema: z.object({
      guild_id: z
        .string()
        .optional()
        .describe("Guild ID (defaults to config)"),
      query: z
        .string()
        .optional()
        .describe("Search text content"),
      author_id: z
        .string()
        .optional()
        .describe("Filter by author user ID"),
      channel_id: z
        .string()
        .optional()
        .describe("Filter by channel ID"),
      has: z
        .enum(["link", "embed", "file", "video", "image", "sound", "sticker"])
        .optional()
        .describe("Filter by attachment type"),
      before: z
        .string()
        .optional()
        .describe("Messages before this date (YYYY-MM-DD) or snowflake ID"),
      after: z
        .string()
        .optional()
        .describe("Messages after this date (YYYY-MM-DD) or snowflake ID"),
      in_thread: z
        .boolean()
        .optional()
        .describe("Only search in threads"),
    }),
  },
  async ({ guild_id, query, author_id, channel_id, has, before, after, in_thread }) => {
    const gid = guild_id || discord.defaultGuildId;
    const params = new URLSearchParams();
    if (query) params.set("content", query);
    if (author_id) params.set("author_id", author_id);
    if (channel_id) params.set("channel_id", channel_id);
    if (has) params.set("has", has);
    if (before) params.set("max_id", before);
    if (after) params.set("min_id", after);
    if (in_thread) params.set("channel_type", "11"); // PUBLIC_THREAD

    const results = await discord.request<DiscordSearchResult>(
      "GET",
      `/guilds/${gid}/messages/search?${params}`,
      {
        tool: "search_messages",
        params: { guild_id: gid, query, author_id, channel_id, has, before, after, in_thread },
      }
    );
    return {
      content: [
        { type: "text" as const, text: formatSearchResults(results) },
      ],
    };
  }
);

server.registerTool(
  "list_threads",
  {
    description:
      "List threads in a channel. By default lists active threads; set archived=true for archived threads.",
    inputSchema: z.object({
      channel_id: z.string().describe("Parent channel ID"),
      archived: z
        .boolean()
        .optional()
        .describe("List archived threads instead of active (default false)"),
    }),
  },
  async ({ channel_id, archived }) => {
    let threads: DiscordThread[];

    if (archived) {
      const response = await discord.request<{ threads: DiscordThread[] }>(
        "GET",
        `/channels/${channel_id}/threads/archived/public`,
        {
          tool: "list_threads",
          params: { channel_id, archived: true },
        }
      );
      threads = response.threads;
    } else {
      const gid = discord.defaultGuildId;
      const response = await discord.request<{ threads: DiscordThread[] }>(
        "GET",
        `/guilds/${gid}/threads/active`,
        {
          tool: "list_threads",
          params: { channel_id, archived: false },
        }
      );
      // Filter to only threads from this channel
      threads = response.threads.filter((t) => t.parent_id === channel_id);
    }

    if (threads.length === 0) {
      return {
        content: [{ type: "text" as const, text: "No threads found." }],
      };
    }

    const lines = threads.map(
      (t) =>
        `- "${t.name}" (id: ${t.id}, messages: ${t.message_count}, members: ${t.member_count}${t.archived ? ", archived" : ""})`
    );
    return {
      content: [
        {
          type: "text" as const,
          text: `Threads (${threads.length}):\n${lines.join("\n")}`,
        },
      ],
    };
  }
);

server.registerTool(
  "list_pinned_messages",
  {
    description: "Get pinned messages in a channel or thread",
    inputSchema: z.object({
      channel_id: z.string().describe("Channel or thread ID"),
    }),
  },
  async ({ channel_id }) => {
    const messages = await discord.request<DiscordMessage[]>(
      "GET",
      `/channels/${channel_id}/pins`,
      {
        tool: "list_pinned_messages",
        params: { channel_id },
      }
    );
    return {
      content: [
        { type: "text" as const, text: formatPinnedMessages(messages) },
      ],
    };
  }
);
```

Note: the imports at the top of `src/index.ts` need to be updated to include `formatSearchResults` and `formatPinnedMessages` in the existing import from `./formatters.js`, and `DiscordSearchResult` and `DiscordThread` in the import from `./types.js`.

**Step 2: Build and verify**

Run: `bun run build`
Expected: No compilation errors.

**Step 3: Test with MCP Inspector**

Test: `search_messages` with a query, `list_threads` on a channel, `list_pinned_messages`.

**Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: add search_messages, list_threads, list_pinned_messages tools"
```

---

### Task 8: Tools Batch 3 (get_user_info, get_thread_participants, list_reactions)

**Files:**
- Modify: `src/index.ts`

**Step 1: Add final 3 tools**

Add before `// --- Start server ---`:

```typescript
import {
  formatThreadParticipants,
  formatReactions,
} from "./formatters.js";
import type {
  DiscordGuildMember,
  DiscordThreadMember,
  DiscordReactionUser,
} from "./types.js";

server.registerTool(
  "get_user_info",
  {
    description:
      "Get info about a Discord user. Optionally include server-specific info (nickname, roles, join date) by providing guild_id.",
    inputSchema: z.object({
      user_id: z.string().describe("Discord user ID"),
      guild_id: z
        .string()
        .optional()
        .describe("Guild ID for server-specific info (defaults to config)"),
    }),
  },
  async ({ user_id, guild_id }) => {
    const user = await discord.request<DiscordUser>(
      "GET",
      `/users/${user_id}`,
      {
        tool: "get_user_info",
        params: { user_id },
      }
    );

    let member: DiscordGuildMember | undefined;
    const gid = guild_id || discord.defaultGuildId;
    try {
      member = await discord.request<DiscordGuildMember>(
        "GET",
        `/guilds/${gid}/members/${user_id}`,
        {
          tool: "get_user_info",
          params: { user_id, guild_id: gid },
        }
      );
    } catch {
      // User might not be in this guild
    }

    return {
      content: [
        { type: "text" as const, text: formatUser(user, member) },
      ],
    };
  }
);

server.registerTool(
  "get_thread_participants",
  {
    description: "Get list of participants in a thread",
    inputSchema: z.object({
      channel_id: z.string().describe("Thread channel ID"),
    }),
  },
  async ({ channel_id }) => {
    const members = await discord.request<DiscordThreadMember[]>(
      "GET",
      `/channels/${channel_id}/thread-members`,
      {
        tool: "get_thread_participants",
        params: { channel_id },
      }
    );
    return {
      content: [
        {
          type: "text" as const,
          text: formatThreadParticipants(members),
        },
      ],
    };
  }
);

server.registerTool(
  "list_reactions",
  {
    description:
      "Get users who reacted with a specific emoji on a message",
    inputSchema: z.object({
      channel_id: z.string().describe("Channel ID containing the message"),
      message_id: z.string().describe("Message ID"),
      emoji: z
        .string()
        .describe(
          "Emoji to check (unicode emoji like 👍 or custom emoji format name:id)"
        ),
    }),
  },
  async ({ channel_id, message_id, emoji }) => {
    const encodedEmoji = encodeURIComponent(emoji);
    const users = await discord.request<DiscordReactionUser[]>(
      "GET",
      `/channels/${channel_id}/messages/${message_id}/reactions/${encodedEmoji}`,
      {
        tool: "list_reactions",
        params: { channel_id, message_id, emoji },
      }
    );
    return {
      content: [
        { type: "text" as const, text: formatReactions(users, emoji) },
      ],
    };
  }
);
```

Note: update imports at the top of `src/index.ts` to include `formatThreadParticipants`, `formatReactions`, and the relevant types.

**Step 2: Build and verify**

Run: `bun run build`
Expected: No compilation errors.

**Step 3: Test with MCP Inspector**

Test all 3 new tools.

**Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: add get_user_info, get_thread_participants, list_reactions tools"
```

---

### Task 9: README

**Files:**
- Create: `README.md`

**Step 1: Write README**

```markdown
# discord-mcp

Read-only Discord MCP server for Claude Code. Access channels, messages, threads, DMs, and search — all through your Discord user token.

## Setup

```bash
bun install
bun run build
```

## Running

```bash
# Direct run (for testing)
DISCORD_TOKEN=your_token DISCORD_GUILD_ID=your_guild bun run build/index.js

# Or via Claude Code (see Configuration below)
```

## Configuration

Add to your Claude Code MCP config:

```bash
claude mcp add discord -t stdio -e DISCORD_TOKEN=your_token -e DISCORD_GUILD_ID=your_guild -- node /absolute/path/to/discord-mcp/build/index.js
```

Or manually in settings:

```json
{
  "mcpServers": {
    "discord": {
      "command": "node",
      "args": ["/absolute/path/to/discord-mcp/build/index.js"],
      "env": {
        "DISCORD_TOKEN": "your_user_token_here",
        "DISCORD_GUILD_ID": "your_default_guild_id"
      }
    }
  }
}
```

### Getting your Discord token

1. Open Discord **in your browser** (not the desktop app)
2. Open DevTools: `Cmd+Option+I` (Mac) or `F12` (Windows/Linux)
3. Go to the **Network** tab
4. Do anything in Discord (send a message, switch channels)
5. Click any request to `https://discord.com/api/...`
6. In the **Headers** tab, find `Authorization` — that's your token
7. Copy the value (it does NOT start with `Bot`)

> **Important:** Never share your token. Anyone with it has full access to your Discord account.

### Getting a Guild ID

1. Open Discord Settings → Advanced → enable **Developer Mode**
2. Right-click the server name in the sidebar
3. Click **Copy Server ID**

## Tools

| Tool | Description |
|---|---|
| `get_me` | Current user info |
| `list_channels` | Server channels grouped by category |
| `read_messages` | Read messages from any channel/thread/DM |
| `list_dms` | List DM conversations |
| `search_messages` | Search messages with filters |
| `list_threads` | List active/archived threads |
| `list_pinned_messages` | Pinned messages in a channel |
| `get_user_info` | User info with server details |
| `get_thread_participants` | Thread participant list |
| `list_reactions` | Who reacted with an emoji |

## Testing with MCP Inspector

The [MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector) lets you test tools interactively in a browser UI.

```bash
# Build first
bun run build

# Launch inspector
DISCORD_TOKEN=your_token DISCORD_GUILD_ID=your_guild \
  bunx @modelcontextprotocol/inspector node build/index.js
```

This opens a browser UI where you can:
- See all 10 registered tools
- Call any tool with custom inputs
- View formatted responses
- Monitor server logs

## Logs

All requests are logged as JSON lines to:
- **stderr** (visible in terminal)
- **`~/.discord-mcp/logs/YYYY-MM-DD.log`** (persistent, for tuning)

Aggregate stats are printed every 50 requests and on process exit.

## Rate Limiting

- Global throttle: 1 request per 3-7 seconds (randomized jitter)
- Retry on 429: max 2 retries with backoff
- Respects Discord `X-RateLimit-*` headers

## Disclaimer

Using user tokens for API automation is against Discord's Terms of Service. This tool is for personal use only. Read-only access with conservative throttling minimizes risk.
```

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with setup, tools, and testing guide"
```

---

## Final verification

After all tasks:

1. `bun run build` — clean build
2. `bun test` — all unit tests pass
3. MCP Inspector — all 10 tools work
4. Connect to Claude Code and test real usage
