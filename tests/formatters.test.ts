import { describe, it, expect } from "bun:test";
import {
  formatMessages,
  formatChannels,
  formatSearchResults,
  formatDMList,
  formatUser,
  formatPinnedMessages,
  formatThreadParticipants,
  formatReactions,
} from "../src/formatters.js";
import type {
  DiscordMessage,
  DiscordChannel,
  DiscordDMChannel,
  DiscordUser,
  DiscordGuildMember,
  DiscordSearchResult,
  DiscordThreadMember,
  DiscordReactionUser,
} from "../src/types.js";
import { ChannelType } from "../src/types.js";

const makeMessage = (overrides: Partial<DiscordMessage> = {}): DiscordMessage => ({
  id: "1",
  channel_id: "100",
  author: { id: "10", username: "alice", discriminator: "0", global_name: "Alice", avatar: null },
  content: "Hello world",
  timestamp: "2024-03-09T12:34:00.000Z",
  edited_timestamp: null,
  attachments: [],
  type: 0,
  ...overrides,
});

describe("formatMessages", () => {
  it("formats basic messages with timestamps and authors", () => {
    const result = formatMessages([makeMessage()]);
    expect(result).toContain("@alice");
    expect(result).toContain("Hello world");
    expect(result).toContain("12:34");
  });

  it("shows attachments as metadata", () => {
    const msg = makeMessage({
      attachments: [
        { id: "1", filename: "screenshot.png", size: 1200000, url: "https://cdn.discordapp.com/a/b/screenshot.png", width: 1920, height: 1080 },
      ],
    });
    const result = formatMessages([msg]);
    expect(result).toContain("screenshot.png");
    expect(result).toContain("1.1MB");
    expect(result).toContain("1920x1080");
  });

  it("shows thread info", () => {
    const msg = makeMessage({
      thread: { id: "200", name: "Bug discussion", message_count: 5 },
    });
    const result = formatMessages([msg]);
    expect(result).toContain("Bug discussion");
    expect(result).toContain("5 messages");
  });
});

describe("formatChannels", () => {
  it("groups channels by category", () => {
    const channels: DiscordChannel[] = [
      { id: "1", type: ChannelType.GUILD_CATEGORY, name: "Engineering", position: 0 },
      { id: "2", type: ChannelType.GUILD_TEXT, name: "general", parent_id: "1", position: 0 },
      { id: "3", type: ChannelType.GUILD_TEXT, name: "random", parent_id: null, position: 1 },
    ];
    const result = formatChannels(channels);
    expect(result).toContain("Engineering");
    expect(result).toContain("#general");
    expect(result).toContain("#random");
  });
});

describe("formatDMList", () => {
  it("formats DM conversations", () => {
    const dms: DiscordDMChannel[] = [
      { id: "1", type: ChannelType.DM, recipients: [{ id: "10", username: "alice", discriminator: "0", global_name: "Alice", avatar: null }], last_message_id: "999" },
      { id: "2", type: ChannelType.GROUP_DM, recipients: [
        { id: "10", username: "alice", discriminator: "0", global_name: null, avatar: null },
        { id: "11", username: "bob", discriminator: "0", global_name: null, avatar: null },
      ], last_message_id: "888" },
    ];
    const result = formatDMList(dms);
    expect(result).toContain("@alice");
    expect(result).toContain("Group:");
    expect(result).toContain("bob");
  });
});

describe("formatUser", () => {
  it("formats user with guild member info", () => {
    const user: DiscordUser = { id: "10", username: "alice", discriminator: "0", global_name: "Alice Smith", avatar: null };
    const member: DiscordGuildMember = { nick: "ali", roles: ["123"], joined_at: "2023-01-01T00:00:00Z" };
    const result = formatUser(user, member);
    expect(result).toContain("alice");
    expect(result).toContain("Alice Smith");
    expect(result).toContain("ali");
  });
});

describe("formatSearchResults", () => {
  it("formats search results with context", () => {
    const results: DiscordSearchResult = {
      messages: [[makeMessage({ content: "deployment issue on staging" })]],
      total_results: 1,
    };
    const result = formatSearchResults(results);
    expect(result).toContain("1 result");
    expect(result).toContain("deployment issue on staging");
  });
});
