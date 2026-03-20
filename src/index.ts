#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import ms from "ms";
import { defaultCache } from "./cache.js";
import { DiscordClient } from "./discord.js";
import { Logger } from "./logger.js";
import { defaultThrottle } from "./throttle.js";
import { stripMessages, stripSearchResults, stripDMList, stripUserResponse, stripGuilds } from "./strip.js";
import type {
  DiscordUser,
  DiscordChannel,
  DiscordMessage,
  DiscordDMChannel,
  DiscordSearchResult,
  DiscordThread,
  DiscordGuildMember,
  DiscordPartialGuild,
  DiscordThreadMember,
  DiscordReactionUser,
} from "./types.js";

// When true, returns full Discord API JSON without stripping.
// When false (default), strips responses to reduce token usage (~76% smaller).
// Stripping removes: user cosmetics (avatar, banner, clan, etc.), empty arrays,
// null values, redundant fields, and deduplicates nested user objects.
// Full raw responses are always saved to ~/.discord-mcp/logs/responses/ regardless.
const RAW_MODE = false;

function json(data: unknown): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

function jsonMessages(data: unknown): { content: [{ type: "text"; text: string }] } {
  return json(RAW_MODE ? data : stripMessages(data));
}

// --- Config from env ---
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

if (!DISCORD_TOKEN) {
  console.error("DISCORD_TOKEN env var is required");
  process.exit(1);
}

// --- Init ---
const logger = await Logger.create();
const discord = new DiscordClient(DISCORD_TOKEN, logger);

const server = new McpServer({
  name: "discord-mcp",
  version: "1.0.0",
});

function requireGuildId(guild_id?: string): string {
  if (!guild_id) {
    throw new Error(
      "guild_id is required. Use list_guilds to find your guild ID."
    );
  }
  return guild_id;
}

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
      cacheTtl: ms("5m"),
    });
    return json(RAW_MODE ? user : stripUserResponse(user as unknown as Record<string, unknown>));
  }
);

server.registerTool(
  "list_guilds",
  {
    description:
      "List all Discord servers (guilds) the current user is a member of. Returns server names and IDs.",
    inputSchema: z.object({
      with_counts: z
        .boolean()
        .optional()
        .describe("Include approximate member and presence counts (default false)"),
    }),
  },
  async ({ with_counts }) => {
    const params = new URLSearchParams();
    if (with_counts) params.set("with_counts", "true");
    const query = params.toString();
    const path = `/users/@me/guilds${query ? `?${query}` : ""}`;

    const guilds = await discord.request<DiscordPartialGuild[]>(
      "GET",
      path,
      {
        tool: "list_guilds",
        cacheTtl: ms("3m"),
      }
    );
    return json(RAW_MODE ? guilds : stripGuilds(guilds));
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
          "Guild ID (use list_guilds to find)"
        ),
    }),
  },
  async ({ guild_id }) => {
    const gid = requireGuildId(guild_id);
    const channels = await discord.request<DiscordChannel[]>(
      "GET",
      `/guilds/${gid}/channels`,
      {
        tool: "list_channels",
        params: { guild_id: gid },
        cacheTtl: ms("5m"),
      }
    );
    return json(channels);
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
        cacheTtl: ms("30s"),
      }
    );
    return jsonMessages(messages);
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
        cacheTtl: ms("1m"),
      }
    );
    return json(RAW_MODE ? dms : stripDMList(dms));
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
        .describe("Guild ID (use list_guilds to find)"),
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
    const gid = requireGuildId(guild_id);
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
        cacheTtl: ms("1m"),
      }
    );
    return json(RAW_MODE ? results : stripSearchResults(results as unknown as Record<string, unknown>));
  }
);


server.registerTool(
  "list_threads",
  {
    description:
      "List threads in a channel. By default lists active threads; set archived=true for archived threads.",
    inputSchema: z.object({
      channel_id: z.string().describe("Parent channel ID"),
      guild_id: z
        .string()
        .optional()
        .describe("Guild ID (required for active threads, use list_guilds to find)"),
      archived: z
        .boolean()
        .optional()
        .describe("List archived threads instead of active (default false)"),
    }),
  },
  async ({ channel_id, guild_id, archived }) => {
    let threads: DiscordThread[];

    if (archived) {
      const response = await discord.request<{ threads: DiscordThread[] }>(
        "GET",
        `/channels/${channel_id}/threads/archived/public`,
        {
          tool: "list_threads",
          params: { channel_id, archived: true },
          cacheTtl: ms("2m"),
        }
      );
      threads = response.threads;
    } else {
      const gid = requireGuildId(guild_id);
      const response = await discord.request<{ threads: DiscordThread[] }>(
        "GET",
        `/guilds/${gid}/threads/active`,
        {
          tool: "list_threads",
          params: { channel_id, archived: false },
          cacheTtl: ms("2m"),
        }
      );
      // Filter to only threads from this channel
      threads = response.threads.filter((t) => t.parent_id === channel_id);
    }

    return json(threads);
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
        cacheTtl: ms("3m"),
      }
    );
    return jsonMessages(messages);
  }
);

server.registerTool(
  "get_user_info",
  {
    description:
      "Get info about a Discord user. Optionally include server-specific info (nickname, roles, join date) by providing guild_id.",
    inputSchema: z.object({
      user_id: z.string().describe("Discord user ID"),
      guild_id: z
        .string()
        .optional()
        .describe("Guild ID for server-specific info (use list_guilds to find)"),
    }),
  },
  async ({ user_id, guild_id }) => {
    const gid = requireGuildId(guild_id);

    // Guild member endpoint works with user tokens; /users/{id} requires bot/OAuth2 scopes
    let member: DiscordGuildMember | undefined;
    try {
      member = await discord.request<DiscordGuildMember>(
        "GET",
        `/guilds/${gid}/members/${user_id}`,
        {
          tool: "get_user_info",
          params: { user_id, guild_id: gid },
          cacheTtl: ms("5m"),
        }
      );
    } catch {
      // User might not be in this guild
    }

    if (member?.user) {
      const userData = { ...member.user, member };
      return json(RAW_MODE ? userData : stripUserResponse(userData as unknown as Record<string, unknown>));
    }

    // Fallback to /users/{id} for users not in the guild
    const user = await discord.request<DiscordUser>(
      "GET",
      `/users/${user_id}`,
      {
        tool: "get_user_info",
        params: { user_id },
        cacheTtl: ms("5m"),
      }
    );
    return json(RAW_MODE ? user : stripUserResponse(user as unknown as Record<string, unknown>));
  }
);

server.registerTool(
  "get_thread_participants",
  {
    description: "Get list of participants in a thread",
    inputSchema: z.object({
      channel_id: z.string().describe("Thread channel ID"),
    }),
  },
  async ({ channel_id }) => {
    const members = await discord.request<DiscordThreadMember[]>(
      "GET",
      `/channels/${channel_id}/thread-members`,
      {
        tool: "get_thread_participants",
        params: { channel_id },
        cacheTtl: ms("2m"),
      }
    );
    return json(members);
  }
);

server.registerTool(
  "list_reactions",
  {
    description:
      "Get users who reacted with a specific emoji on a message",
    inputSchema: z.object({
      channel_id: z.string().describe("Channel ID containing the message"),
      message_id: z.string().describe("Message ID"),
      emoji: z
        .string()
        .describe(
          "Emoji to check (unicode emoji like 👍 or custom emoji format name:id)"
        ),
    }),
  },
  async ({ channel_id, message_id, emoji }) => {
    const encodedEmoji = encodeURIComponent(emoji);
    const users = await discord.request<DiscordReactionUser[]>(
      "GET",
      `/channels/${channel_id}/messages/${message_id}/reactions/${encodedEmoji}`,
      {
        tool: "list_reactions",
        params: { channel_id, message_id, emoji },
        cacheTtl: ms("1m"),
      }
    );
    return json(users);
  }
);

// --- Start server ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Discord MCP server running on stdio");

  process.stdin.on("end", () => {
    logger.printStats();
    defaultCache.close();
    defaultThrottle.close();
    process.exit(0);
  });

  process.on("SIGINT", () => {
    logger.printStats();
    defaultCache.close();
    defaultThrottle.close();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    logger.printStats();
    defaultCache.close();
    defaultThrottle.close();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
