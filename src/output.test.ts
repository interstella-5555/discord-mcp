import { test, expect } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { resolveOutputPath, snowflakeStamp, writeResultToFile, exportsDir } from "./output.js";

test("snowflakeStamp decodes a Discord snowflake to a UTC timestamp", () => {
  // Discord's documented example snowflake.
  expect(snowflakeStamp("175928847299117063").slice(0, 10)).toBe("2016-04-30");
});

test("exportsDir defaults under the OS temp dir", () => {
  const prev = process.env.DISCORD_MCP_EXPORT_DIR;
  delete process.env.DISCORD_MCP_EXPORT_DIR;
  expect(exportsDir().startsWith(tmpdir())).toBe(true);
  if (prev !== undefined) process.env.DISCORD_MCP_EXPORT_DIR = prev;
});

test("exportsDir honors the DISCORD_MCP_EXPORT_DIR override", () => {
  const prev = process.env.DISCORD_MCP_EXPORT_DIR;
  process.env.DISCORD_MCP_EXPORT_DIR = join(tmpdir(), "custom-exports");
  expect(exportsDir()).toBe(join(tmpdir(), "custom-exports"));
  if (prev === undefined) delete process.env.DISCORD_MCP_EXPORT_DIR;
  else process.env.DISCORD_MCP_EXPORT_DIR = prev;
});

test("resolveOutputPath: true uses the default name under exportsDir", () => {
  expect(resolveOutputPath(true, "chan_x")).toBe(join(exportsDir(), "chan_x.json"));
});

test("resolveOutputPath: a relative string resolves under exportsDir", () => {
  expect(resolveOutputPath("foo.json", "def")).toBe(join(exportsDir(), "foo.json"));
});

test("resolveOutputPath: an absolute string is used as-is", () => {
  const abs = join(tmpdir(), "abs.json");
  expect(resolveOutputPath(abs, "def")).toBe(abs);
  expect(isAbsolute(resolveOutputPath(abs, "def"))).toBe(true);
});

test("writeResultToFile writes the data and returns count + id cursors for arrays", () => {
  const path = join(tmpdir(), `dmcp-output-test-${process.pid}.json`);
  const data = [{ id: "300" }, { id: "200" }, { id: "100" }]; // newest-first
  const r = writeResultToFile(path, data, "unused");
  expect(r.path).toBe(path);
  expect(r.count).toBe(3);
  expect(r.newest_id).toBe("300");
  expect(r.oldest_id).toBe("100");
  expect(r.bytes).toBeGreaterThan(0);
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(data);
  rmSync(path);
});

test("writeResultToFile omits cursors for non-array data", () => {
  const path = join(tmpdir(), `dmcp-output-test2-${process.pid}.json`);
  const r = writeResultToFile(path, { total_results: 5, messages: [] }, "unused");
  expect(r.count).toBeUndefined();
  expect(r.newest_id).toBeUndefined();
  rmSync(path);
});
