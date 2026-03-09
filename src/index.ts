#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { DiscordClient } from "./discord.js";
import { Logger } from "./logger.js";
import {
  formatMessages,
  formatChannels,
  formatDMList,
  formatUser,
} from "./formatters.js";
import type {
  DiscordUser,
  DiscordChannel,
  DiscordMessage,
  DiscordDMChannel,
} from "./types.js";

// --- Config from env ---
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;

if (!DISCORD_TOKEN) {
  console.error("DISCORD_TOKEN env var is required");
  process.exit(1);
}
if (!DISCORD_GUILD_ID) {
  console.error("DISCORD_GUILD_ID env var is required");
  process.exit(1);
}

// --- Init ---
const logger = new Logger();
const discord = new DiscordClient(DISCORD_TOKEN, DISCORD_GUILD_ID, logger);

const server = new McpServer({
  name: "discord-mcp",
  version: "1.0.0",
});

// --- Tools ---

server.registerTool(
  "get_me",
  {
    description:
      "Get current Discord user info (username, ID, display name)",
    inputSchema: z.object({}),
  },
  async () => {
    const user = await discord.request<DiscordUser>("GET", "/users/@me", {
      tool: "get_me",
      cacheTtl: Infinity,
    });
    return {
      content: [{ type: "text" as const, text: formatUser(user) }],
    };
  }
);

server.registerTool(
  "list_channels",
  {
    description:
      "List all channels in a Discord server, grouped by category",
    inputSchema: z.object({
      guild_id: z
        .string()
        .optional()
        .describe(
          "Guild ID (defaults to DISCORD_GUILD_ID from config)"
        ),
    }),
  },
  async ({ guild_id }) => {
    const gid = guild_id || discord.defaultGuildId;
    const channels = await discord.request<DiscordChannel[]>(
      "GET",
      `/guilds/${gid}/channels`,
      {
        tool: "list_channels",
        params: { guild_id: gid },
        cacheTtl: Infinity,
      }
    );
    return {
      content: [{ type: "text" as const, text: formatChannels(channels) }],
    };
  }
);

server.registerTool(
  "read_messages",
  {
    description:
      "Read messages from any channel, thread, DM, or forum post. Use 'around' to get context around a specific message.",
    inputSchema: z.object({
      channel_id: z.string().describe("Channel, thread, or DM channel ID"),
      limit: z
        .number()
        .min(1)
        .max(100)
        .optional()
        .describe("Number of messages to fetch (1-100, default 50)"),
      before: z
        .string()
        .optional()
        .describe("Get messages before this message ID"),
      after: z
        .string()
        .optional()
        .describe("Get messages after this message ID"),
      around: z
        .string()
        .optional()
        .describe("Get messages around this message ID (for context)"),
    }),
  },
  async ({ channel_id, limit, before, after, around }) => {
    const params = new URLSearchParams();
    params.set("limit", String(limit ?? 50));
    if (before) params.set("before", before);
    if (after) params.set("after", after);
    if (around) params.set("around", around);

    const messages = await discord.request<DiscordMessage[]>(
      "GET",
      `/channels/${channel_id}/messages?${params}`,
      {
        tool: "read_messages",
        params: { channel_id, limit: limit ?? 50, before, after, around },
      }
    );
    return {
      content: [
        { type: "text" as const, text: formatMessages(messages) },
      ],
    };
  }
);

server.registerTool(
  "list_dms",
  {
    description:
      "List DM conversations (direct messages and group DMs). Returns channel IDs you can use with read_messages.",
    inputSchema: z.object({}),
  },
  async () => {
    const dms = await discord.request<DiscordDMChannel[]>(
      "GET",
      "/users/@me/channels",
      {
        tool: "list_dms",
        cacheTtl: 5 * 60 * 1000, // 5 min
      }
    );
    return {
      content: [{ type: "text" as const, text: formatDMList(dms) }],
    };
  }
);

// --- Start server ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Discord MCP server running on stdio");

  process.on("SIGINT", () => {
    logger.printStats();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    logger.printStats();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
