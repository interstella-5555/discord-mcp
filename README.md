# discord-mcp

Read-only Discord MCP server for Claude Code. Access channels, messages, threads, DMs, and search — all through your Discord user token.

## Setup

Requires [Bun](https://bun.sh) runtime.

### Add to Claude Code

```bash
claude mcp add discord -s user -e DISCORD_TOKEN=your_token_here -- bunx --bun github:interstella-5555/discord-mcp
```

Adds the server globally (`-s user`) — use this when you have a single Discord account across all projects.

### Per-directory token with direnv

If you use multiple Discord accounts or only want the token available in specific directories, use [direnv](https://direnv.net) instead of hardcoding the token in the MCP config:

1. Add the server without the `-e` flag:

```bash
claude mcp add discord -s user -- bunx --bun github:interstella-5555/discord-mcp
```

2. Create an `.envrc` in the parent directory where you want the token available:

```bash
# ~/code/.envrc
export DISCORD_TOKEN=your_token_here
```

3. Allow it:

```bash
direnv allow ~/code/.envrc
```

The server will pick up `DISCORD_TOKEN` from the environment. It will only be set when you're inside `~/code/` (or any subdirectory), so different directories can use different tokens.

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

## Logs

Logged as JSON lines to **`~/.discord-mcp/logs/YYYY-MM-DD.log`**.

Aggregate stats are printed every 50 requests and on process exit.

## Rate Limiting

- Global throttle: 1 request per 3-7 seconds (randomized jitter)
- Retry on 429: max 2 retries with backoff
- Respects Discord `X-RateLimit-*` headers

## Disclaimer

Using user tokens for API automation is against Discord's Terms of Service. This tool is for personal use only. Read-only access with conservative throttling minimizes risk.
