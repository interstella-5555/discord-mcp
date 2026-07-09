// Optional file output for large read results. When a read tool is called with
// `output_to_file`, the full (already-stripped) result is written to disk and the
// tool returns only a compact summary, so bulk history export never floods the
// MCP client's context. Enabled per-call; default behavior is unchanged.

import { writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";

// Where `output_to_file: true` (and relative paths) resolve to. Defaults to an
// ephemeral dir under the OS temp dir; set DISCORD_MCP_EXPORT_DIR to persist
// exports elsewhere. Callers can also pass an absolute path to bypass this.
export function exportsDir(): string {
  return process.env.DISCORD_MCP_EXPORT_DIR || join(tmpdir(), "discord-mcp-exports");
}

// Discord snowflake -> filesystem-safe UTC timestamp, e.g. "2026-07-09T04-47-58-560Z".
export function snowflakeStamp(id: string): string {
  const ms = Number((BigInt(id) >> 22n) + 1420070400000n);
  return new Date(ms).toISOString().replace(/[:.]/g, "-");
}

// Resolve the output path from the `output_to_file` value:
//   true / ""       -> <exportsDir>/<defaultName>.json
//   "name.json"     -> <exportsDir>/name.json   (relative)
//   "/abs/path.json"-> used as-is               (absolute)
export function resolveOutputPath(spec: string | boolean, defaultName: string): string {
  if (typeof spec === "string" && spec.trim().length > 0) {
    return isAbsolute(spec) ? spec : join(exportsDir(), spec);
  }
  return join(exportsDir(), `${defaultName}.json`);
}

export interface FileResult {
  path: string;
  bytes: number;
  count?: number;
  newest_id?: string;
  oldest_id?: string;
}

// Serialize `data` to the resolved path and return a compact summary. When `data`
// is a message array (newest-first, as Discord returns it), expose count and the
// id cursors so the caller can paginate further without reading the file back.
export function writeResultToFile(
  spec: string | boolean,
  data: unknown,
  defaultName: string,
): FileResult {
  const path = resolveOutputPath(spec, defaultName);
  mkdirSync(dirname(path), { recursive: true });
  const text = JSON.stringify(data);
  writeFileSync(path, text);

  const summary: FileResult = { path, bytes: text.length };
  if (Array.isArray(data)) {
    summary.count = data.length;
    const first = data[0] as { id?: string } | undefined;
    const last = data[data.length - 1] as { id?: string } | undefined;
    if (first?.id) summary.newest_id = first.id;
    if (last?.id) summary.oldest_id = last.id;
  }
  return summary;
}
