import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Cache } from "./cache.js";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

let dbPath: string;
let cache: Cache;

beforeEach(() => {
  const dir = join("/tmp", `cache-test-${randomBytes(8).toString("hex")}`);
  dbPath = join(dir, "cache.db");
  cache = new Cache(dbPath);
});

afterEach(() => {
  cache.close();
  rmSync(dbPath.replace(/\/cache\.db$/, ""), { recursive: true, force: true });
});

describe("Cache", () => {
  test("get/set roundtrip", () => {
    cache.set("k1", { foo: "bar" }, 60_000);
    expect(cache.get("k1")).toEqual({ foo: "bar" });
  });

  test("returns undefined for missing key", () => {
    expect(cache.get("nope")).toBeUndefined();
  });

  test("expires after TTL", async () => {
    cache.set("k1", "val", 50);
    expect(cache.get("k1")).toBe("val");
    await new Promise((r) => setTimeout(r, 100));
    expect(cache.get("k1")).toBeUndefined();
  });

  test("overwrites existing key", () => {
    cache.set("k1", "old", 60_000);
    cache.set("k1", "new", 60_000);
    expect(cache.get("k1")).toBe("new");
  });

  test("cross-instance sharing", () => {
    cache.set("shared", [1, 2, 3], 60_000);
    const other = new Cache(dbPath);
    expect(other.get("shared")).toEqual([1, 2, 3]);
    other.close();
  });

  test("cleanup removes expired rows", async () => {
    cache.set("short", "a", 50);
    cache.set("long", "b", 60_000);
    await new Promise((r) => setTimeout(r, 100));
    // Force cleanup by creating a new instance (cleanup runs on open)
    const fresh = new Cache(dbPath);
    expect(fresh.get("short")).toBeUndefined();
    expect(fresh.get("long")).toBe("b");
    fresh.close();
  });

  test("handles complex JSON values", () => {
    const complex = {
      users: [{ id: "1", name: "test" }],
      count: 42,
      nested: { deep: true },
    };
    cache.set("complex", complex, 60_000);
    expect(cache.get("complex")).toEqual(complex);
  });
});
