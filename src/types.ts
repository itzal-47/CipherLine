export type Screen = 'home' | 'create' | 'join' | 'chat' | 'expired' | 'login' | 'dashboard';

export interface UserProfile {
  id: string;
  email: string;
  nickname: string;
  created_at: string;
}

export interface RoomMember {
  id: string;
  room_id: string;
  user_id: string;
  joined_at: string;
  role: string;
  is_archived: boolean;
  is_pinned: boolean;
  is_muted: boolean;
  last_read_at: string | null;
}

export interface PublicRoom {
  id: string;
  code: string;
  topic: string | null;
  member_count: number;
  created_at: string;
}

export interface BurnConfig {
  mode: 'off' | '24h' | '7d' | 'on_read' | 'custom';
  seconds: number;
}

export const BURN_PRESETS: Record<string, number> = {
  off: 0,
  '24h': 86400,
  '7d': 604800,
  on_read: 6,
};

export function createBurnConfig(mode: BurnConfig['mode'], customSeconds?: number): BurnConfig {
  if (mode === 'custom' && customSeconds) {
    return { mode, seconds: customSeconds };
  }
  return { mode, seconds: BURN_PRESETS[mode] ?? 0 };
}

export function burnConfigToJson(config: BurnConfig): string {
  return JSON.stringify(config);
}

export function jsonToBurnConfig(json: unknown): BurnConfig | null {
  if (!json || typeof json !== 'object') return null;
  const obj = json as Record<string, unknown>;
  if (obj.mode && obj.seconds !== undefined) {
    return { mode: obj.mode as BurnConfig['mode'], seconds: obj.seconds as number };
  }
  return null;
}

export interface Room {
  id: string;
  code: string;
  created_at: string;
  expires_at: string | null;
  is_permanent: boolean;
  default_burn_config: BurnConfig | null;
  is_public: boolean;
  owner_id: string | null;
  topic: string | null;
}

export interface Participant {
  id: string;
  room_id: string;
  nickname: string;
  joined_at: string;
  last_seen: string;
  device_id: string | null;
}

export type MessageType = 'text' | 'audio' | 'image';

export interface MessageRow {
  id: string;
  room_id: string;
  sender_id: string;
  encrypted_content: string;
  created_at: string;
  read_at: string | null;
  destroyed_at: string | null;
  burn_config: BurnConfig | null;
  message_type: MessageType;
  storage_path: string | null;
  duration_seconds: number | null;
  reply_to_message_id: string | null;
}

export interface Reaction {
  id: string;
  message_id: string;
  participant_id: string;
  emoji: string;
  created_at: string;
}

export interface ReadReceipt {
  id: string;
  message_id: string;
  participant_id: string;
  read_at: string;
}

export interface DecodedMessage {
  id: string;
  senderId: string;
  senderNickname: string;
  encryptedContent: string;
  plaintext: string;
  createdAt: string;
  isOwn: boolean;
  state: 'scrambled' | 'decoding' | 'decoded' | 'destroying' | 'destroyed';
  destroyAt: number | null;
  burnConfig: BurnConfig | null;
  reactions: Reaction[];
  readBy: ReadReceipt[];
  messageType: MessageType;
  storagePath: string | null;
  durationSeconds: number | null;
  replyToMessageId: string | null;
  replyToSenderNickname: string | null;
  replyToPlaintext: string | null;
}
