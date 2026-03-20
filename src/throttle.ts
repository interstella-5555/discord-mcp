// Cross-process throttle using SQLite.
// Reservation pattern: acquire DB lock for microseconds, then sleep outside lock.
// Shared state ensures global rate limiting across all MCP server instances.

import { Database } from "bun:sqlite";
import { randomInt } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class Throttle {
  private db: Database;
  private reserve;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA busy_timeout = 30000");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS throttle (
        id         INTEGER PRIMARY KEY CHECK (id = 1),
        next_slot  INTEGER NOT NULL DEFAULT 0
      )
    `);
    this.db.exec("INSERT OR IGNORE INTO throttle (id, next_slot) VALUES (1, 0)");

    // Prepared transaction: atomic read-modify-write
    this.reserve = this.db.transaction(
      (minIntervalMs: number, jitter: number, now: number) => {
        const row = this.db
          .query<{ next_slot: number }, []>("SELECT next_slot FROM throttle WHERE id = 1")
          .get();
        const lastSlot = row?.next_slot ?? 0;
        // If enough time passed since last slot, go now. Otherwise queue after it.
        const slot = Math.max(now, lastSlot + minIntervalMs + jitter);
        this.db.query("UPDATE throttle SET next_slot = ? WHERE id = 1").run(slot);
        return slot;
      }
    );
  }

  async wait(minIntervalMs = 3000, maxJitterMs = 4000): Promise<number> {
    const now = Date.now();
    const jitter = randomInt(0, maxJitterMs + 1);

    // Atomic: read last slot, reserve next one (millisecond transaction)
    const slot = this.reserve(minIntervalMs, jitter, now) as number;

    const waitMs = Math.max(0, slot - now);
    if (waitMs > 0) await sleep(waitMs);
    return waitMs;
  }

  close(): void {
    this.db.close();
  }
}

export const defaultThrottle = new Throttle(
  join(homedir(), ".discord-mcp", "throttle.db")
);
