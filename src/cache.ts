import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const CLEANUP_PROBABILITY = 0.02; // ~1 in 50 writes

export class Cache {
  private db: Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cache (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      )
    `);
    this.cleanup();
  }

  get(key: string): unknown | undefined {
    const row = this.db
      .query<{ value: string }, [string, number]>(
        "SELECT value FROM cache WHERE key = ? AND expires_at > ?"
      )
      .get(key, Date.now());
    return row ? JSON.parse(row.value) : undefined;
  }

  set(key: string, value: unknown, ttlMs: number): void {
    this.db
      .query("INSERT OR REPLACE INTO cache (key, value, expires_at) VALUES (?, ?, ?)")
      .run(key, JSON.stringify(value), Date.now() + ttlMs);
    if (Math.random() < CLEANUP_PROBABILITY) this.cleanup();
  }

  private cleanup(): void {
    this.db.query("DELETE FROM cache WHERE expires_at <= ?").run(Date.now());
  }

  close(): void {
    this.db.close();
  }
}

export const defaultCache = new Cache(
  join(homedir(), ".discord-mcp", "cache.db")
);
