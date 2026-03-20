// Strips Discord API responses to reduce token usage for LLM consumption.
// Toggle RAW_MODE in index.ts to bypass stripping.
// Full raw responses are always logged to ~/.discord-mcp/logs/responses/.

function stripUser(user: Record<string, unknown>): Record<string, unknown> {
  if (!user) return user;
  const result: Record<string, unknown> = {
    id: user.id,
    username: user.username,
  };
  if (user.global_name) result.global_name = user.global_name;
  if (user.bot) result.bot = true;
  return result;
}

function stripAttachment(att: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {
    filename: att.filename,
    size: att.size,
    url: att.url,
  };
  if (att.width) result.width = att.width;
  if (att.height) result.height = att.height;
  if (att.content_type) result.content_type = att.content_type;
  return result;
}

function stripMention(user: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { id: user.id, username: user.username };
  if (user.global_name) result.global_name = user.global_name;
  return result;
}

function stripEmbed(embed: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (embed.type) result.type = embed.type;
  if (embed.title) result.title = embed.title;
  if (embed.description) result.description = embed.description;
  if (embed.url) result.url = embed.url;
  return result;
}

function stripReaction(reaction: Record<string, unknown>): Record<string, unknown> {
  const emoji = reaction.emoji as Record<string, unknown>;
  return {
    emoji: { id: emoji?.id, name: emoji?.name },
    count: reaction.count,
  };
}

function stripMessage(msg: Record<string, unknown>, depth = 0): Record<string, unknown> {
  const result: Record<string, unknown> = {
    id: msg.id,
    type: msg.type,
    author: msg.author ? stripUser(msg.author as Record<string, unknown>) : null,
    content: msg.content,
    timestamp: msg.timestamp,
  };

  if (msg.edited_timestamp != null) {
    result.edited_timestamp = msg.edited_timestamp;
  }

  if (msg.flags) {
    result.flags = msg.flags;
  }

  const attachments = msg.attachments as unknown[];
  if (attachments?.length) {
    result.attachments = attachments.map((a) => stripAttachment(a as Record<string, unknown>));
  }

  const embeds = msg.embeds as unknown[];
  if (embeds?.length) {
    result.embeds = embeds.map((e) => stripEmbed(e as Record<string, unknown>));
  }

  const reactions = msg.reactions as unknown[];
  if (reactions?.length) {
    result.reactions = reactions.map((r) => stripReaction(r as Record<string, unknown>));
  }

  const mentions = msg.mentions as Record<string, unknown>[];
  if (mentions?.length) {
    result.mentions = mentions.map(stripMention);
  }

  if (msg.message_reference != null) {
    result.message_reference = msg.message_reference;
  }

  if (msg.referenced_message != null && depth < 1) {
    result.referenced_message = stripMessage(
      msg.referenced_message as Record<string, unknown>,
      depth + 1,
    );
  }

  if (msg.thread != null) {
    result.thread = msg.thread;
  }

  if (msg.sticker_items != null) {
    result.sticker_items = msg.sticker_items;
  }

  if (msg.poll != null) {
    result.poll = msg.poll;
  }

  return result;
}

export function stripMessages(data: unknown): unknown {
  if (!Array.isArray(data)) return data;
  return data.map((msg) => stripMessage(msg as Record<string, unknown>));
}

export function stripSearchResults(data: Record<string, unknown>): unknown {
  const messages = data.messages as unknown[][];
  return {
    total_results: data.total_results,
    messages: messages?.map((group) =>
      group.map((msg) => stripMessage(msg as Record<string, unknown>)),
    ),
  };
}

// Strip user objects in DM channel recipients
export function stripDMList(data: unknown): unknown {
  if (!Array.isArray(data)) return data;
  return data.map((dm) => {
    const channel = dm as Record<string, unknown>;
    const recipients = channel.recipients as Record<string, unknown>[];
    return {
      ...channel,
      recipients: recipients?.map(stripUser),
    };
  });
}

// Strip user object from get_user_info / get_me responses
export function stripUserResponse(data: Record<string, unknown>): Record<string, unknown> {
  const result = stripUser(data);
  // Preserve member info if present (get_user_info with guild_id)
  if (data.member) {
    const member = data.member as Record<string, unknown>;
    result.member = {
      nick: member.nick,
      roles: member.roles,
      joined_at: member.joined_at,
    };
  }
  return result;
}

// Strip guild list (icon, permissions are waste)
export function stripGuilds(data: unknown): unknown {
  if (!Array.isArray(data)) return data;
  return data.map((g) => {
    const guild = g as Record<string, unknown>;
    const result: Record<string, unknown> = {
      id: guild.id,
      name: guild.name,
    };
    if (guild.owner) result.owner = guild.owner;
    if (guild.approximate_member_count) result.approximate_member_count = guild.approximate_member_count;
    return result;
  });
}
