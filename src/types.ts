// Discord API v10 response types (read-only subset)

export interface DiscordUser {
  id: string;
  username: string;
  discriminator: string;
  global_name: string | null;
  avatar: string | null;
}

export interface DiscordGuildMember {
  user?: DiscordUser;
  nick: string | null;
  roles: string[];
  joined_at: string;
}

export interface DiscordAttachment {
  id: string;
  filename: string;
  size: number;
  url: string;
  width?: number;
  height?: number;
  content_type?: string;
}

export interface DiscordReaction {
  emoji: { id: string | null; name: string | null };
  count: number;
}

export interface DiscordMessage {
  id: string;
  channel_id: string;
  author: DiscordUser;
  content: string;
  timestamp: string;
  edited_timestamp: string | null;
  attachments: DiscordAttachment[];
  reactions?: DiscordReaction[];
  thread?: { id: string; name: string; message_count: number };
  referenced_message?: DiscordMessage | null;
  type: number;
}

export interface DiscordChannel {
  id: string;
  type: number;
  name?: string;
  topic?: string;
  parent_id?: string | null;
  position?: number;
  last_message_id?: string | null;
}

export interface DiscordDMChannel {
  id: string;
  type: number;
  recipients: DiscordUser[];
  last_message_id: string | null;
}

export interface DiscordThread {
  id: string;
  name: string;
  parent_id: string;
  message_count: number;
  member_count: number;
  archived: boolean;
  owner_id?: string;
}

export interface DiscordThreadMember {
  id?: string;
  user_id?: string;
  join_timestamp: string;
}

export interface DiscordSearchResult {
  messages: DiscordMessage[][];
  total_results: number;
}

export interface DiscordReactionUser {
  id: string;
  username: string;
  global_name: string | null;
}

export interface DiscordPartialGuild {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
  permissions: string;
  approximate_member_count?: number;
  approximate_presence_count?: number;
}

// Channel types enum
export const ChannelType = {
  GUILD_TEXT: 0,
  DM: 1,
  GUILD_VOICE: 2,
  GROUP_DM: 3,
  GUILD_CATEGORY: 4,
  GUILD_ANNOUNCEMENT: 5,
  GUILD_STAGE_VOICE: 13,
  GUILD_FORUM: 15,
  GUILD_MEDIA: 16,
} as const;

// Rate limit response
export interface RateLimitHeaders {
  remaining: number | null;
  resetAfter: number | null;
  bucket: string | null;
}

// Logger types
export interface RequestLog {
  ts: string;
  tool: string;
  endpoint: string;
  status: number;
  ms: number;
  delay: number;
  queue: number;
  response_size: number;
  items_count: number;
  cache_hit: boolean;
  params: Record<string, unknown>;
  // 429-specific fields
  retry_after?: number;
  retry?: number;
  ratelimit_remaining?: number;
  ratelimit_reset_after?: number;
}
