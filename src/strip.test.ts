import { describe, test, expect } from "bun:test";
import { stripMessages, stripSearchResults, stripDMList, stripUserResponse, stripGuilds } from "./strip.js";

// Minimal Discord API message fixture
function makeMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "123",
    type: 0,
    content: "hello",
    timestamp: "2026-03-11T09:00:00.000Z",
    edited_timestamp: null,
    channel_id: "456",
    tts: false,
    pinned: false,
    mention_everyone: false,
    flags: 0,
    position: 5,
    mentions: [],
    mention_roles: [],
    attachments: [],
    embeds: [],
    components: [],
    author: {
      id: "789",
      username: "alice",
      discriminator: "0",
      avatar: "abc123hash",
      public_flags: 0,
      flags: 0,
      banner: null,
      accent_color: null,
      global_name: "Alice",
      avatar_decoration_data: null,
      collectibles: null,
      display_name_styles: null,
      banner_color: null,
      clan: { identity_guild_id: "111", identity_enabled: true, tag: "TEST", badge: "badge123" },
      primary_guild: { identity_guild_id: "111", identity_enabled: true, tag: "TEST", badge: "badge123" },
    },
    ...overrides,
  };
}

function makeUser(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "789",
    username: "alice",
    discriminator: "0",
    avatar: "abc123hash",
    public_flags: 0,
    flags: 0,
    banner: null,
    accent_color: null,
    global_name: "Alice",
    avatar_decoration_data: null,
    collectibles: null,
    display_name_styles: null,
    banner_color: null,
    clan: null,
    primary_guild: null,
    ...overrides,
  };
}

describe("stripMessages", () => {
  test("keeps essential fields", () => {
    const result = stripMessages([makeMessage()]) as Record<string, unknown>[];
    expect(result).toHaveLength(1);
    const msg = result[0];
    expect(msg.id).toBe("123");
    expect(msg.type).toBe(0);
    expect(msg.content).toBe("hello");
    expect(msg.timestamp).toBe("2026-03-11T09:00:00.000Z");
  });

  test("strips user to id, username, global_name", () => {
    const result = stripMessages([makeMessage()]) as Record<string, unknown>[];
    const author = result[0].author as Record<string, unknown>;
    expect(author.id).toBe("789");
    expect(author.username).toBe("alice");
    expect(author.global_name).toBe("Alice");
    expect(author.avatar).toBeUndefined();
    expect(author.discriminator).toBeUndefined();
    expect(author.clan).toBeUndefined();
    expect(author.primary_guild).toBeUndefined();
    expect(author.banner).toBeUndefined();
    expect(author.avatar_decoration_data).toBeUndefined();
  });

  test("keeps channel_id; drops tts, pinned, mention_everyone, position, components", () => {
    const result = stripMessages([makeMessage({ channel_id: "456" })]) as Record<string, unknown>[];
    const msg = result[0];
    expect(msg.channel_id).toBe("456");
    expect(msg.tts).toBeUndefined();
    expect(msg.pinned).toBeUndefined();
    expect(msg.mention_everyone).toBeUndefined();
    expect(msg.position).toBeUndefined();
    expect(msg.components).toBeUndefined();
  });

  test("omits edited_timestamp when null", () => {
    const result = stripMessages([makeMessage()]) as Record<string, unknown>[];
    expect(result[0].edited_timestamp).toBeUndefined();
  });

  test("keeps edited_timestamp when set", () => {
    const result = stripMessages([makeMessage({ edited_timestamp: "2026-03-11T10:00:00.000Z" })]) as Record<string, unknown>[];
    expect(result[0].edited_timestamp).toBe("2026-03-11T10:00:00.000Z");
  });

  test("omits flags when 0", () => {
    const result = stripMessages([makeMessage()]) as Record<string, unknown>[];
    expect(result[0].flags).toBeUndefined();
  });

  test("keeps flags when non-zero (e.g. forwarded)", () => {
    const result = stripMessages([makeMessage({ flags: 16384 })]) as Record<string, unknown>[];
    expect(result[0].flags).toBe(16384);
  });

  test("omits empty arrays (attachments, embeds, mentions, mention_roles)", () => {
    const result = stripMessages([makeMessage()]) as Record<string, unknown>[];
    const msg = result[0];
    expect(msg.attachments).toBeUndefined();
    expect(msg.embeds).toBeUndefined();
    expect(msg.mentions).toBeUndefined();
    expect(msg.mention_roles).toBeUndefined();
  });

  test("strips attachments to filename, size, url, dimensions, content_type", () => {
    const result = stripMessages([makeMessage({
      attachments: [{
        id: "att1",
        filename: "test.png",
        size: 12345,
        url: "https://cdn.discord.com/test.png",
        proxy_url: "https://media.discord.com/test.png",
        width: 800,
        height: 600,
        content_type: "image/png",
        original_content_type: "image/png",
        content_scan_version: 4,
        placeholder: "base64data",
        placeholder_version: 1,
        title: "test",
      }],
    })]) as Record<string, unknown>[];
    const att = (result[0].attachments as Record<string, unknown>[])[0];
    expect(att.filename).toBe("test.png");
    expect(att.size).toBe(12345);
    expect(att.url).toBe("https://cdn.discord.com/test.png");
    expect(att.width).toBe(800);
    expect(att.height).toBe(600);
    expect(att.content_type).toBe("image/png");
    expect(att.id).toBeUndefined();
    expect(att.proxy_url).toBeUndefined();
    expect(att.placeholder).toBeUndefined();
    expect(att.title).toBeUndefined();
  });

  test("strips embeds to type, title, description, url", () => {
    const result = stripMessages([makeMessage({
      embeds: [{
        type: "rich",
        title: "Link Preview",
        description: "A description",
        url: "https://example.com",
        thumbnail: { url: "https://example.com/thumb.png", proxy_url: "https://proxy/thumb.png", width: 100, height: 100 },
        provider: { name: "Example" },
        footer: { text: "footer", proxy_icon_url: "https://proxy/icon.png" },
      }],
    })]) as Record<string, unknown>[];
    const embed = (result[0].embeds as Record<string, unknown>[])[0];
    expect(embed.type).toBe("rich");
    expect(embed.title).toBe("Link Preview");
    expect(embed.description).toBe("A description");
    expect(embed.url).toBe("https://example.com");
    expect(embed.thumbnail).toBeUndefined();
    expect(embed.provider).toBeUndefined();
    expect(embed.footer).toBeUndefined();
  });

  test("strips reactions to emoji + count", () => {
    const result = stripMessages([makeMessage({
      reactions: [{
        emoji: { id: null, name: "🔥" },
        count: 3,
        count_details: { burst: 0, normal: 3 },
        burst_colors: [],
        me_burst: false,
        burst_me: false,
        me: true,
        burst_count: 0,
      }],
    })]) as Record<string, unknown>[];
    const reaction = (result[0].reactions as Record<string, unknown>[])[0];
    expect(reaction).toEqual({ emoji: { id: null, name: "🔥" }, count: 3 });
  });

  test("strips mentions to id, username, global_name", () => {
    const result = stripMessages([makeMessage({
      mentions: [makeUser({ id: "999", username: "bob", global_name: "Bob" })],
    })]) as Record<string, unknown>[];
    const mention = (result[0].mentions as Record<string, unknown>[])[0];
    expect(mention).toEqual({ id: "999", username: "bob", global_name: "Bob" });
  });

  test("keeps message_reference when present", () => {
    const ref = { type: 0, channel_id: "456", message_id: "111", guild_id: "222" };
    const result = stripMessages([makeMessage({ message_reference: ref })]) as Record<string, unknown>[];
    expect(result[0].message_reference).toEqual(ref);
  });

  test("strips referenced_message recursively", () => {
    const referenced = makeMessage({ id: "original", content: "original msg" });
    const result = stripMessages([makeMessage({
      type: 19,
      referenced_message: referenced,
      message_reference: { message_id: "original" },
    })]) as Record<string, unknown>[];
    const ref = result[0].referenced_message as Record<string, unknown>;
    expect(ref.id).toBe("original");
    expect(ref.content).toBe("original msg");
    expect((ref.author as Record<string, unknown>).avatar).toBeUndefined();
  });

  test("caps referenced_message depth at 1 (no nested refs)", () => {
    const deep = makeMessage({ id: "deep", referenced_message: makeMessage({ id: "deeper" }) });
    const result = stripMessages([makeMessage({
      type: 19,
      referenced_message: deep,
    })]) as Record<string, unknown>[];
    const ref = result[0].referenced_message as Record<string, unknown>;
    expect(ref.id).toBe("deep");
    expect(ref.referenced_message).toBeUndefined();
  });

  test("handles referenced_message: null (deleted original)", () => {
    const result = stripMessages([makeMessage({
      type: 19,
      referenced_message: null,
      message_reference: { message_id: "deleted123" },
    })]) as Record<string, unknown>[];
    expect(result[0].referenced_message).toBeUndefined();
    expect(result[0].message_reference).toEqual({ message_id: "deleted123" });
  });

  test("handles null author (system/webhook edge case)", () => {
    const result = stripMessages([makeMessage({ author: null })]) as Record<string, unknown>[];
    expect(result[0].author).toBeNull();
  });

  test("keeps bot flag on author", () => {
    const result = stripMessages([makeMessage({
      author: makeUser({ bot: true, username: "webhook-bot" }),
    })]) as Record<string, unknown>[];
    expect((result[0].author as Record<string, unknown>).bot).toBe(true);
  });

  test("keeps thread, sticker_items, poll when present", () => {
    const result = stripMessages([makeMessage({
      thread: { id: "t1", name: "thread", message_count: 5 },
      sticker_items: [{ id: "s1", name: "sticker", format_type: 1 }],
      poll: { question: { text: "yes or no?" } },
    })]) as Record<string, unknown>[];
    expect(result[0].thread).toBeDefined();
    expect(result[0].sticker_items).toBeDefined();
    expect(result[0].poll).toBeDefined();
  });

  test("returns non-array data unchanged", () => {
    expect(stripMessages("not an array")).toBe("not an array");
    expect(stripMessages(null)).toBeNull();
  });
});

describe("stripSearchResults", () => {
  test("strips nested message groups", () => {
    const data = {
      total_results: 1,
      messages: [[makeMessage({ content: "found it" })]],
    };
    const result = stripSearchResults(data) as Record<string, unknown>;
    expect(result.total_results).toBe(1);
    const groups = result.messages as Record<string, unknown>[][];
    expect(groups[0][0].content).toBe("found it");
  });
});

describe("stripDMList", () => {
  test("strips recipient user objects", () => {
    const dms = [{
      id: "dm1",
      type: 1,
      last_message_id: "999",
      recipients: [makeUser({ username: "bob", global_name: "Bob" })],
    }];
    const result = stripDMList(dms) as Record<string, unknown>[];
    const recipient = (result[0].recipients as Record<string, unknown>[])[0];
    expect(recipient.username).toBe("bob");
    expect(recipient.global_name).toBe("Bob");
    expect(recipient.avatar).toBeUndefined();
    expect(recipient.clan).toBeUndefined();
  });
});

describe("stripUserResponse", () => {
  test("strips user fields", () => {
    const result = stripUserResponse(makeUser());
    expect(result.username).toBe("alice");
    expect(result.global_name).toBe("Alice");
    expect(result.avatar).toBeUndefined();
    expect(result.discriminator).toBeUndefined();
  });

  test("preserves member info when present", () => {
    const result = stripUserResponse({
      ...makeUser(),
      member: { nick: "Ali", roles: ["role1"], joined_at: "2025-01-01", deaf: false, mute: false },
    });
    const member = result.member as Record<string, unknown>;
    expect(member.nick).toBe("Ali");
    expect(member.roles).toEqual(["role1"]);
    expect(member.joined_at).toBe("2025-01-01");
    expect(member.deaf).toBeUndefined();
  });
});

describe("stripGuilds", () => {
  test("keeps id, name, owner, member count; drops icon, permissions", () => {
    const guilds = [{
      id: "g1",
      name: "Test Server",
      icon: "iconhash",
      owner: true,
      permissions: "2147483647",
      approximate_member_count: 100,
      approximate_presence_count: 50,
    }];
    const result = stripGuilds(guilds) as Record<string, unknown>[];
    expect(result[0]).toEqual({ id: "g1", name: "Test Server", owner: true, approximate_member_count: 100 });
  });
});

describe("size reduction", () => {
  test("achieves significant reduction on realistic data", () => {
    const messages = Array.from({ length: 10 }, (_, i) =>
      makeMessage({
        id: String(i),
        content: `message ${i}`,
        mentions: i % 3 === 0 ? [makeUser({ id: `mention${i}` })] : [],
        reactions: i % 4 === 0 ? [{ emoji: { id: null, name: "👍" }, count: 1, count_details: { burst: 0, normal: 1 }, me: false, burst_colors: [], me_burst: false, burst_me: false, burst_count: 0 }] : undefined,
      })
    );
    const rawSize = JSON.stringify(messages).length;
    const strippedSize = JSON.stringify(stripMessages(messages)).length;
    const reduction = ((rawSize - strippedSize) / rawSize) * 100;
    expect(reduction).toBeGreaterThan(60);
  });
});
