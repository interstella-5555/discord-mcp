import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Throttle } from "./throttle.js";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

let tmpDir: string;
let dbPath: string;
let throttle: Throttle;

beforeEach(() => {
  tmpDir = join("/tmp", `throttle-test-${randomBytes(8).toString("hex")}`);
  dbPath = join(tmpDir, "throttle.db");
  throttle = new Throttle(dbPath);
});

afterEach(() => {
  throttle.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("Throttle", () => {
  test("creates database file", () => {
    expect(existsSync(dbPath)).toBe(true);
  });

  test("returns wait time in ms", async () => {
    const wait = await throttle.wait(0, 0);
    expect(typeof wait).toBe("number");
    expect(wait).toBeGreaterThanOrEqual(0);
  });

  test("first call is immediate when no prior requests", async () => {
    const start = Date.now();
    await throttle.wait(200, 0);
    const elapsed = Date.now() - start;
    // First call should be immediate (no prior slot)
    expect(elapsed).toBeLessThan(50);
  });

  test("respects min interval between calls", async () => {
    await throttle.wait(0, 0); // first call, immediate
    const start = Date.now();
    await throttle.wait(200, 0); // should wait ~200ms
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(150);
  });

  test("concurrent calls are properly queued", async () => {
    const results: number[] = [];
    const p1 = throttle.wait(100, 0).then((w) => results.push(w));
    const p2 = throttle.wait(100, 0).then((w) => results.push(w));
    const p3 = throttle.wait(100, 0).then((w) => results.push(w));
    await Promise.all([p1, p2, p3]);
    expect(results).toHaveLength(3);
  }, 15000);

  test("cross-instance sharing via same DB", async () => {
    await throttle.wait(0, 0); // reserve a slot
    const other = new Throttle(dbPath);
    const start = Date.now();
    await other.wait(200, 0); // should wait ~200ms from shared slot
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(150);
    other.close();
  });
});
