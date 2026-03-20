import { describe, it, expect, beforeEach, vi, mock } from "bun:test";
import { Logger } from "../src/logger.js";

describe("Logger", () => {
  let logger: Logger;

  beforeEach(async () => {
    logger = await Logger.create();
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
