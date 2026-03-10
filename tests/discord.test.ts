import { describe, it, expect, beforeEach, vi, mock } from "bun:test";
import { DiscordClient } from "../src/discord.js";

// Mock global fetch
const mockFetch = vi.fn();
const originalFetch = globalThis.fetch;
globalThis.fetch = mockFetch as unknown as typeof fetch;

describe("DiscordClient", () => {
  let client: DiscordClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new DiscordClient("test-token");
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

    it("serializes concurrent requests through the queue", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () => JSON.stringify({ id: "1" }),
      });

      // Fire 3 requests concurrently
      const start = Date.now();
      await Promise.all([
        client.request("GET", "/a", { tool: "t1" }),
        client.request("GET", "/b", { tool: "t2" }),
        client.request("GET", "/c", { tool: "t3" }),
      ]);
      const elapsed = Date.now() - start;

      expect(mockFetch).toHaveBeenCalledTimes(3);

      // 3 requests with p-throttle(1/3s) + jitter(0-4s) each:
      // minimum total ≈ 0 + 3s + 3s = 6s (first is immediate, 2 intervals)
      expect(elapsed).toBeGreaterThanOrEqual(5900);
    }, 30000);
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
