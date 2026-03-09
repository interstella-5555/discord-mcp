# Discord MCP Server — Design Document

## Overview

Read-only MCP server for Claude Code that provides access to Discord via user token authentication. Primary use cases: searching for context related to tickets, reading threads when pinged, understanding discussions across channels.

## Stack

- TypeScript + `@modelcontextprotocol/sdk` + `zod`
- Transport: stdio
- No external dependencies beyond the MCP SDK

## Configuration

Exclusively via env vars passed in MCP server config. No `.env` file, no fallbacks.

- `DISCORD_TOKEN` — user token from browser session
- `DISCORD_GUILD_ID` — default guild for tools that need it (can be overridden per-call)

Claude Code config example:
```json
{
  "mcpServers": {
    "discord": {
      "command": "node",
      "args": ["/path/to/discord-mcp/build/index.js"],
      "env": {
        "DISCORD_TOKEN": "...",
        "DISCORD_GUILD_ID": "123456789"
      }
    }
  }
}
```

## Project Structure

```
src/
  index.ts          — server setup + tool registration (10 tools)
  discord.ts        — DiscordClient (auth, throttle, retry, cache, logging)
  formatters.ts     — response formatting for LLM readability
  types.ts          — TypeScript types for Discord API responses
  logger.ts         — request logging and stats aggregation
```

## Authentication

User token (from browser DevTools). Sent as `Authorization` header **without** `Bot` prefix. Discord API v10 (`https://discord.com/api/v10`).

Headers per request:
- `Authorization: <token>`
- `Content-Type: application/json`
- `User-Agent: discord-mcp/1.0`

## Throttling

Global throttle: **1 request per 3-7 seconds** (randomized jitter to avoid machine-like patterns).

Implementation: simple queue in `DiscordClient`. Before each request, wait `3000 + Math.random() * 4000` ms since the last request. All tool invocations (even from parallel agents) go through the same queue since it's one MCP server process.

Rationale:
- User tokens have no official rate limit docs — Discord can ban for automation
- Read-only use case doesn't need speed
- 3-7s is ~5x slower than the minimum 1100ms recommended by selfbot community
- Jitter makes the pattern look human

## Retry Policy

1 initial attempt + max 2 retries = **3 requests max per call**.

On 429 response:
1. Read `retry_after` from response body
2. Wait `retry_after` seconds + jitter
3. Retry (max 2 times)

Also respect `X-RateLimit-*` headers from every response:
- If `X-RateLimit-Remaining` = 0, wait `X-RateLimit-Reset-After` before next request

## Cache

| Data | TTL | Rationale |
|---|---|---|
| `list_channels` | Process lifetime | Channels rarely change |
| `get_me` | Process lifetime | User doesn't change |
| `list_dms` | 5 minutes | New DMs can appear |
| Everything else | No cache | Live data |

Implementation: `Map<string, { data, expiry }>` in memory.

## Tools (10 total)

| Tool | Parameters | Discord API Endpoint |
|---|---|---|
| `get_me` | — | `GET /users/@me` |
| `list_channels` | `guild_id?` | `GET /guilds/{guild_id}/channels` |
| `read_messages` | `channel_id`, `limit?` (def 50), `before?`, `after?`, `around?` | `GET /channels/{channel_id}/messages` |
| `list_dms` | — | `GET /users/@me/channels` |
| `search_messages` | `guild_id?`, `query?`, `author_id?`, `channel_id?`, `has?`, `before?`, `after?`, `in_thread?` | `GET /guilds/{guild_id}/messages/search` |
| `list_threads` | `channel_id`, `archived?` | `GET /guilds/{guild_id}/threads/active` + `GET /channels/{channel_id}/threads/archived/public` |
| `list_pinned_messages` | `channel_id` | `GET /channels/{channel_id}/pins` |
| `get_user_info` | `user_id`, `guild_id?` | `GET /users/{user_id}` + `GET /guilds/{guild_id}/members/{user_id}` |
| `get_thread_participants` | `channel_id` | `GET /channels/{channel_id}/thread-members` |
| `list_reactions` | `channel_id`, `message_id`, `emoji` | `GET /channels/{channel_id}/messages/{message_id}/reactions/{emoji}` |

Tools that accept `guild_id?` default to `DISCORD_GUILD_ID` env var.

## Response Formatting

All tools return human-readable text, not raw JSON. Optimized for LLM token efficiency.

**Messages:**
```
#general | 2024-03-09

[12:34] @alice: Hey, kto widzia PR #123?
[12:35] @bob: Tak, reviewuje teraz
  -> [thread: "PR #123 review" | 5 messages]
  📎 screenshot.png (1.2MB, 1920x1080) cdn.discordapp.com/...
```

**Attachments:** URL + metadata (filename, size, dimensions). No image downloading — saves rate limit budget and context tokens.

**Channels:**
```
Category: Engineering
  #general (text)
  #code-review (text)
  #standup (forum)
```

**Search results:**
```
Found 3 results for "deployment issue":

1. #devops [2024-03-08 14:22] @alice: deployment issue on staging...
2. #general [2024-03-07 09:11] @bob: anyone seen the deployment issue...
3. Thread: "Fix deploy" [2024-03-06 16:00] @carol: ...
```

**DMs:**
```
DM Conversations:
1. @alice (last: 2024-03-09)
2. @bob (last: 2024-03-07)
3. Group: alice, bob, carol (last: 2024-03-05)
```

## Logging & Stats

All logging via `console.error()` (safe for stdio transport). Format: JSON lines for grepability.

**Per-request log:**
```json
{
  "ts": "2024-03-09T14:22:05Z",
  "tool": "search_messages",
  "endpoint": "GET /guilds/.../messages/search",
  "status": 200,
  "ms": 312,
  "delay": 5.2,
  "queue": 0,
  "response_size": 4821,
  "items_count": 25,
  "cache_hit": false,
  "params": { "query": "deployment issue", "guild_id": "..." }
}
```

**429 error log (additional fields):**
```json
{
  "retry_after": 5.0,
  "retry": 1,
  "ratelimit_remaining": 0,
  "ratelimit_reset_after": 5.0
}
```

**Aggregate stats (logged every 50 requests + on process exit):**
```
=== Discord MCP Stats ===
Uptime: 2h 34m
Total requests: 47
Requests by tool: { search_messages: 12, read_messages: 18, list_channels: 1, ... }
429 errors: 2 (search_messages @ 14:22:05, read_messages @ 15:01:12)
Avg delay: 4.8s (min: 3.1s, max: 6.9s)
Avg response time: 234ms
Peak queue depth: 4 (at 14:22:03, drained in 22s, 4 requests)
```

## Risk Acknowledgment

Using user tokens for API automation is against Discord's Terms of Service. This tool is for personal use only. Mitigations:
- Read-only (no message sending)
- Conservative throttling (3-7s between requests)
- Respects all rate limit headers
- Retry with backoff on 429
