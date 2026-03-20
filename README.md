# discord-mcp

Read-only Discord MCP server for Claude Code. Access channels, messages, threads, DMs, and search — all through your Discord user token.

## Setup

Requires [Bun](https://bun.sh) runtime.

### Via GitHub (no clone needed)

```bash
claude mcp add discord -s user -e DISCORD_TOKEN=your_token_here -- bunx --bun github:interstella-5555/discord-mcp
```

### From local clone

```bash
git clone git@github.com:interstella-5555/discord-mcp.git
cd discord-mcp
bun install
claude mcp add discord -s user -e DISCORD_TOKEN=your_token_here -- bun src/index.ts
```

### Getting your Discord token

1. Open Discord **in your browser** (not the desktop app)
2. Open DevTools: `Cmd+Option+I` (Mac) or `F12` (Windows/Linux)
3. Go to the **Network** tab
4. Do anything in Discord (send a message, switch channels)
5. Click any request to `https://discord.com/api/...`
6. In the **Headers** tab, find `Authorization` — that's your token
7. Copy the value (it does NOT start with `Bot`)

> **Important:** Never share your token. Anyone with it has full access to your Discord account.

## Tools

| Tool | Description |
|---|---|
| `get_me` | Current user info |
| `list_guilds` | List servers you're in (use to get guild IDs) |
| `list_channels` | Server channels grouped by category |
| `read_messages` | Read messages from any channel/thread/DM |
| `list_dms` | List DM conversations |
| `search_messages` | Search messages with filters |
| `list_threads` | List active/archived threads |
| `list_pinned_messages` | Pinned messages in a channel |
| `get_user_info` | User info with server details |
| `get_thread_participants` | Thread participant list |
| `list_reactions` | Who reacted with an emoji |

## Testing with MCP Inspector

The [MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector) lets you test tools interactively in a browser UI.

```bash
DISCORD_TOKEN=your_token \
  bunx --bun @modelcontextprotocol/inspector bun src/index.ts
```

This opens a browser UI where you can:
- See all 11 registered tools
- Call any tool with custom inputs
- View formatted responses
- Monitor server logs

## Logs

All requests are logged as JSON lines to:
- **stderr** (visible in terminal)
- **`~/.discord-mcp/logs/YYYY-MM-DD.log`** (persistent, for tuning)

Aggregate stats are printed every 50 requests and on process exit.

## Rate Limiting

- Global throttle: 1 request per 3-7 seconds (randomized jitter)
- Retry on 429: max 2 retries with backoff
- Respects Discord `X-RateLimit-*` headers

## Disclaimer

Using user tokens for API automation is against Discord's Terms of Service. This tool is for personal use only. Read-only access with conservative throttling minimizes risk.
