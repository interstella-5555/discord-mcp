import { appendFile, writeFile, mkdir, readdir, unlink } from "node:fs/promises";
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
  private readonly responseDir: string;

  private constructor(logDir: string, logFile: string, responseDir: string) {
    this.logDir = logDir;
    this.logFile = logFile;
    this.responseDir = responseDir;
  }

  private static readonly RETENTION_DAYS = 3;

  static async create(logDir?: string): Promise<Logger> {
    const dir = logDir ?? join(homedir(), ".discord-mcp", "logs");
    const responseDir = join(dir, "responses");
    await mkdir(responseDir, { recursive: true });
    const date = new Date().toISOString().split("T")[0];
    const logFile = join(dir, `${date}.log`);
    const logger = new Logger(dir, logFile, responseDir);
    logger.pruneOldResponses().catch(() => {});
    return logger;
  }

  private async pruneOldResponses(): Promise<void> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - Logger.RETENTION_DAYS);
    const files = await readdir(this.responseDir);
    for (const file of files) {
      // filename: 2026-03-11T19-41-23-456Z_tool_params.json
      const dateStr = file.slice(0, 10);
      if (dateStr < cutoff.toISOString().split("T")[0]) {
        unlink(join(this.responseDir, file)).catch(() => {});
      }
    }
  }

  private writeToFile(line: string): void {
    appendFile(this.logFile, line + "\n").catch(() => {});
  }

  logResponse(tool: string, params: Record<string, unknown>, data: unknown): void {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const paramsB64 = Buffer.from(JSON.stringify(params)).toString("base64url");
    const filename = `${ts}_${tool}_${paramsB64}.json`;
    writeFile(join(this.responseDir, filename), JSON.stringify(data, null, 2)).catch(() => {});
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
