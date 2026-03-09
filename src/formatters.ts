import type {
  DiscordMessage,
  DiscordChannel,
  DiscordDMChannel,
  DiscordUser,
  DiscordGuildMember,
  DiscordSearchResult,
  DiscordThreadMember,
  DiscordReactionUser,
  DiscordAttachment,
} from "./types.js";
import { ChannelType } from "./types.js";

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function formatDate(iso: string): string {
  return new Date(iso).toISOString().split("T")[0];
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatAttachment(att: DiscordAttachment): string {
  const dims = att.width && att.height ? `, ${att.width}x${att.height}` : "";
  return `  📎 ${att.filename} (${formatFileSize(att.size)}${dims}) ${att.url}`;
}

function formatSingleMessage(msg: DiscordMessage): string {
  const time = formatTimestamp(msg.timestamp);
  const author = `@${msg.author.username}`;
  const lines: string[] = [];

  const reply = msg.referenced_message
    ? ` (replying to @${msg.referenced_message.author.username})`
    : "";

  lines.push(`[${time}] ${author}${reply}: ${msg.content}`);

  for (const att of msg.attachments) {
    lines.push(formatAttachment(att));
  }

  if (msg.thread) {
    lines.push(
      `  -> [thread: "${msg.thread.name}" | ${msg.thread.message_count} messages]`
    );
  }

  if (msg.reactions && msg.reactions.length > 0) {
    const reactionStr = msg.reactions
      .map((r) => `${r.emoji.name} (${r.count})`)
      .join(" | ");
    lines.push(`  ${reactionStr}`);
  }

  return lines.join("\n");
}

export function formatMessages(
  messages: DiscordMessage[],
  channelName?: string
): string {
  if (messages.length === 0) return "No messages found.";

  const sorted = [...messages].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  const header = channelName
    ? `#${channelName} | ${formatDate(sorted[0].timestamp)}`
    : formatDate(sorted[0].timestamp);

  const body = sorted.map(formatSingleMessage).join("\n");
  return `${header}\n\n${body}`;
}

function channelTypeLabel(type: number): string {
  switch (type) {
    case ChannelType.GUILD_TEXT: return "text";
    case ChannelType.GUILD_VOICE: return "voice";
    case ChannelType.GUILD_ANNOUNCEMENT: return "announcement";
    case ChannelType.GUILD_STAGE_VOICE: return "stage";
    case ChannelType.GUILD_FORUM: return "forum";
    case ChannelType.GUILD_MEDIA: return "media";
    default: return "text";
  }
}

export function formatChannels(channels: DiscordChannel[]): string {
  const categories = channels.filter(
    (c) => c.type === ChannelType.GUILD_CATEGORY
  );
  const nonCategories = channels.filter(
    (c) => c.type !== ChannelType.GUILD_CATEGORY
  );

  const lines: string[] = [];

  // Channels without category
  const uncategorized = nonCategories.filter((c) => !c.parent_id);
  if (uncategorized.length > 0) {
    for (const ch of uncategorized.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))) {
      lines.push(`  #${ch.name} (${channelTypeLabel(ch.type)})`);
    }
  }

  // Channels grouped by category
  for (const cat of categories.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))) {
    lines.push(`\nCategory: ${cat.name}`);
    const children = nonCategories
      .filter((c) => c.parent_id === cat.id)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    for (const ch of children) {
      lines.push(`  #${ch.name} (${channelTypeLabel(ch.type)})`);
    }
  }

  return lines.join("\n");
}

export function formatDMList(dms: DiscordDMChannel[]): string {
  if (dms.length === 0) return "No DM conversations.";

  const lines: string[] = ["DM Conversations:"];
  let i = 1;

  for (const dm of dms) {
    if (dm.type === ChannelType.DM) {
      const user = dm.recipients[0];
      lines.push(`${i}. @${user.username} (id: ${dm.id})`);
    } else if (dm.type === ChannelType.GROUP_DM) {
      const names = dm.recipients.map((r) => r.username).join(", ");
      lines.push(`${i}. Group: ${names} (id: ${dm.id})`);
    }
    i++;
  }

  return lines.join("\n");
}

export function formatUser(
  user: DiscordUser,
  member?: DiscordGuildMember
): string {
  const lines: string[] = [
    `Username: @${user.username}`,
    `Display name: ${user.global_name ?? user.username}`,
    `ID: ${user.id}`,
  ];

  if (member) {
    if (member.nick) lines.push(`Server nickname: ${member.nick}`);
    lines.push(`Joined: ${formatDate(member.joined_at)}`);
  }

  return lines.join("\n");
}

export function formatSearchResults(results: DiscordSearchResult): string {
  if (results.total_results === 0) return "No results found.";

  const lines: string[] = [
    `Found ${results.total_results} result${results.total_results === 1 ? "" : "s"}:`,
    "",
  ];

  let i = 1;
  for (const messageGroup of results.messages) {
    // The first message in each group is the matched message
    const msg = messageGroup[0];
    if (!msg) continue;

    const time = `${formatDate(msg.timestamp)} ${formatTimestamp(msg.timestamp)}`;
    lines.push(`${i}. [${time}] @${msg.author.username}: ${msg.content}`);
    i++;
  }

  return lines.join("\n");
}

export function formatPinnedMessages(messages: DiscordMessage[]): string {
  if (messages.length === 0) return "No pinned messages.";
  return `Pinned messages (${messages.length}):\n\n${messages.map(formatSingleMessage).join("\n\n")}`;
}

export function formatThreadParticipants(
  members: DiscordThreadMember[]
): string {
  if (members.length === 0) return "No participants.";
  return `Thread participants (${members.length}):\n${members.map((m) => `- User ID: ${m.user_id ?? m.id ?? "unknown"} (joined: ${formatDate(m.join_timestamp)})`).join("\n")}`;
}

export function formatReactions(
  users: DiscordReactionUser[],
  emoji: string
): string {
  if (users.length === 0) return `No reactions with ${emoji}.`;
  return `Reactions ${emoji} (${users.length}):\n${users.map((u) => `- @${u.username}${u.global_name ? ` (${u.global_name})` : ""}`).join("\n")}`;
}
