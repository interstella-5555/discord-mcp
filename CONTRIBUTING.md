# Contributing

## Local development setup

```bash
git clone git@github.com:interstella-5555/discord-mcp.git
cd discord-mcp
bun install
claude mcp add discord -s user -e DISCORD_TOKEN=your_token_here -- bun src/index.ts
```

## Testing with MCP Inspector

The [MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector) lets you test tools interactively in a browser UI.

```bash
DISCORD_TOKEN=your_token \
  bunx --bun @modelcontextprotocol/inspector bun src/index.ts
```

This opens a browser UI where you can:
- See all registered tools
- Call any tool with custom inputs
- View formatted responses
- Monitor server logs
