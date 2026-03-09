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
  formatSearchResults,
  formatPinnedMessages,
} from "./formatters.js";
import type {
  DiscordUser,
  DiscordChannel,
  DiscordMessage,
  DiscordDMChannel,
  DiscordSearchResult,
  DiscordThread,
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

server.registerTool(
  "search_messages",
  {
    description:
      "Search messages in a Discord server. Supports filtering by content, author, channel, attachments, and date range.",
    inputSchema: z.object({
      guild_id: z
        .string()
        .optional()
        .describe("Guild ID (defaults to config)"),
      query: z
        .string()
        .optional()
        .describe("Search text content"),
      author_id: z
        .string()
        .optional()
        .describe("Filter by author user ID"),
      channel_id: z
        .string()
        .optional()
        .describe("Filter by channel ID"),
      has: z
        .enum(["link", "embed", "file", "video", "image", "sound", "sticker"])
        .optional()
        .describe("Filter by attachment type"),
      before: z
        .string()
        .optional()
        .describe("Messages before this date (YYYY-MM-DD) or snowflake ID"),
      after: z
        .string()
        .optional()
        .describe("Messages after this date (YYYY-MM-DD) or snowflake ID"),
      in_thread: z
        .boolean()
        .optional()
        .describe("Only search in threads"),
    }),
  },
  async ({ guild_id, query, author_id, channel_id, has, before, after, in_thread }) => {
    const gid = guild_id || discord.defaultGuildId;
    const params = new URLSearchParams();
    if (query) params.set("content", query);
    if (author_id) params.set("author_id", author_id);
    if (channel_id) params.set("channel_id", channel_id);
    if (has) params.set("has", has);
    if (before) params.set("max_id", before);
    if (after) params.set("min_id", after);
    if (in_thread) params.set("channel_type", "11"); // PUBLIC_THREAD

    const results = await discord.request<DiscordSearchResult>(
      "GET",
      `/guilds/${gid}/messages/search?${params}`,
      {
        tool: "search_messages",
        params: { guild_id: gid, query, author_id, channel_id, has, before, after, in_thread },
      }
    );
    return {
      content: [
        { type: "text" as const, text: formatSearchResults(results) },
      ],
    };
  }
);

server.registerTool(
  "list_threads",
  {
    description:
      "List threads in a channel. By default lists active threads; set archived=true for archived threads.",
    inputSchema: z.object({
      channel_id: z.string().describe("Parent channel ID"),
      archived: z
        .boolean()
        .optional()
        .describe("List archived threads instead of active (default false)"),
    }),
  },
  async ({ channel_id, archived }) => {
    let threads: DiscordThread[];

    if (archived) {
      const response = await discord.request<{ threads: DiscordThread[] }>(
        "GET",
        `/channels/${channel_id}/threads/archived/public`,
        {
          tool: "list_threads",
          params: { channel_id, archived: true },
        }
      );
      threads = response.threads;
    } else {
      const gid = discord.defaultGuildId;
      const response = await discord.request<{ threads: DiscordThread[] }>(
        "GET",
        `/guilds/${gid}/threads/active`,
        {
          tool: "list_threads",
          params: { channel_id, archived: false },
        }
      );
      // Filter to only threads from this channel
      threads = response.threads.filter((t) => t.parent_id === channel_id);
    }

    if (threads.length === 0) {
      return {
        content: [{ type: "text" as const, text: "No threads found." }],
      };
    }

    const lines = threads.map(
      (t) =>
        `- "${t.name}" (id: ${t.id}, messages: ${t.message_count}, members: ${t.member_count}${t.archived ? ", archived" : ""})`
    );
    return {
      content: [
        {
          type: "text" as const,
          text: `Threads (${threads.length}):\n${lines.join("\n")}`,
        },
      ],
    };
  }
);

server.registerTool(
  "list_pinned_messages",
  {
    description: "Get pinned messages in a channel or thread",
    inputSchema: z.object({
      channel_id: z.string().describe("Channel or thread ID"),
    }),
  },
  async ({ channel_id }) => {
    const messages = await discord.request<DiscordMessage[]>(
      "GET",
      `/channels/${channel_id}/pins`,
      {
        tool: "list_pinned_messages",
        params: { channel_id },
      }
    );
    return {
      content: [
        { type: "text" as const, text: formatPinnedMessages(messages) },
      ],
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
