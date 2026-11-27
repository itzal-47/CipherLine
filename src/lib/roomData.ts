import { supabase } from './supabase';
import { PARTICIPANT_COLUMNS } from './columns';
import type { MessageRow as BaseMessageRow, Reaction, ReadReceipt } from '@/types';

export interface MessageRow extends BaseMessageRow {
  file_name?: string | null;
  ai_generated?: boolean;
  ai_context_included?: boolean;
}

export interface ParticipantRow {
  id: string;
  nickname: string;
  last_seen: string;
  show_profile: boolean;
  user_id: string | null;
}

export type ReactionRow = Reaction;
export type ReceiptRow = ReadReceipt;

export interface ParticipantBrief {
  nickname: string;
  show_profile: boolean;
  user_id: string | null;
}

export interface RoomSnapshot {
  messages: MessageRow[] | null;
  participants: ParticipantRow[] | null;
  reactions: ReactionRow[];
  receipts: ReceiptRow[];
}

export interface RoomEventHandlers {
  onMessageInsert?: (row: MessageRow) => void;
  onMessageUpdate?: (row: MessageRow) => void;
  onMessageDelete?: (oldRow: Partial<MessageRow>) => void;
  onReactionInsert?: (row: ReactionRow) => void;
  onReactionDelete?: (oldRow: Partial<ReactionRow>) => void;
  onReceiptInsert?: (row: ReceiptRow) => void;
  onParticipantInsert?: (row: ParticipantRow) => void;
  onParticipantUpdate?: (row: ParticipantRow) => void;
  onParticipantDelete?: (oldRow: Partial<ParticipantRow>) => void;
  onPasteChange?: (payload: { new?: { encrypted_content?: string | null } | null }) => void;
  onStatus?: (status: string) => void;
}

export interface RoomEventsUnsubscribe {
  (): void;
  /** Recreates only chat, reactions and receipts after a chat-channel reconnect. */
  reconnectChat(): void;
}

export async function fetchRoomSnapshot(roomId: string): Promise<RoomSnapshot> {
  const [{ data: messages }, { data: participants }] = await Promise.all([
    supabase.from('messages').select('*').eq('room_id', roomId).order('created_at', { ascending: false }).limit(100),
    supabase.from('participants').select(PARTICIPANT_COLUMNS.room).eq('room_id', roomId),
  ]);

  let reactions: ReactionRow[] = [];
  let receipts: ReceiptRow[] = [];
  const messageIds = (messages ?? []).map((message) => message.id);
  if (messageIds.length > 0) {
    const [reactionResult, receiptResult] = await Promise.all([
      supabase.from('reactions').select('*').in('message_id', messageIds),
      supabase.from('read_receipts').select('*').in('message_id', messageIds),
    ]);
    reactions = reactionResult.data ?? [];
    receipts = receiptResult.data ?? [];
  }

  return { messages, participants, reactions, receipts };
}

export async function fetchParticipants(roomId: string) {
  return await supabase.from('participants').select(PARTICIPANT_COLUMNS.room).eq('room_id', roomId);
}

export async function fetchParticipantBrief(participantId: string) {
  return await supabase.from('participants').select(PARTICIPANT_COLUMNS.sender).eq('id', participantId).maybeSingle();
}

export async function fetchParticipantShowProfile(participantId: string) {
  return await supabase.from('participants').select(PARTICIPANT_COLUMNS.showProfile).eq('id', participantId).maybeSingle();
}

export async function fetchParticipantUserId(participantId: string) {
  return await supabase.from('participants').select(PARTICIPANT_COLUMNS.user).eq('id', participantId).maybeSingle();
}

export async function countParticipants(roomId: string) {
  return await supabase.from('participants').select(PARTICIPANT_COLUMNS.identity, { count: 'exact', head: true }).eq('room_id', roomId);
}

export async function fetchRoomMediaPaths(roomId: string) {
  return await supabase.from('messages').select('storage_path').eq('room_id', roomId).not('storage_path', 'is', null);
}

export async function fetchPaste(roomId: string): Promise<string | null> {
  const { data } = await supabase.from('room_pastes').select('encrypted_content').eq('room_id', roomId).maybeSingle();
  return data?.encrypted_content ?? null;
}

export function subscribeRoomEvents(roomId: string, handlers: RoomEventHandlers): RoomEventsUnsubscribe {
  const channels: { all: ReturnType<typeof supabase.channel>[]; chat: ReturnType<typeof supabase.channel>[] } = { all: [], chat: [] };
  const remove = (targets: ReturnType<typeof supabase.channel>[]) => {
    targets.splice(0).forEach((channel) => { void supabase.removeChannel(channel); });
  };
  const addChatChannels = () => {
    const chat = supabase.channel(`chat-${roomId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` }, (payload) => handlers.onMessageInsert?.(payload.new as MessageRow))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` }, (payload) => handlers.onMessageUpdate?.(payload.new as MessageRow))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` }, (payload) => handlers.onMessageDelete?.(payload.old as Partial<MessageRow>))
      .subscribe((status) => handlers.onStatus?.(status));
    const reactions = supabase.channel(`reactions-${roomId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'reactions' }, (payload) => handlers.onReactionInsert?.(payload.new as ReactionRow))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'reactions' }, (payload) => handlers.onReactionDelete?.(payload.old as Partial<ReactionRow>))
      .subscribe();
    // Mantém o comentário sobre a deduplicação dos recibos junto do tratamento no ecrã.
    const receipts = supabase.channel(`receipts-${roomId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'read_receipts' }, (payload) => handlers.onReceiptInsert?.(payload.new as ReceiptRow))
      .subscribe();
    channels.chat.push(chat, reactions, receipts);
    channels.all.push(chat, reactions, receipts);
  };

  const paste = supabase.channel(`paste-${roomId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'room_pastes', filter: `room_id=eq.${roomId}` }, (payload) => handlers.onPasteChange?.(payload as { new?: { encrypted_content?: string | null } | null }))
    .subscribe();
  channels.all.push(paste);
  addChatChannels();
  const presence = supabase.channel(`presence-${roomId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'participants', filter: `room_id=eq.${roomId}` }, (payload) => handlers.onParticipantInsert?.(payload.new as ParticipantRow))
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'participants', filter: `room_id=eq.${roomId}` }, (payload) => handlers.onParticipantDelete?.(payload.old as Partial<ParticipantRow>))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'participants', filter: `room_id=eq.${roomId}` }, (payload) => handlers.onParticipantUpdate?.(payload.new as ParticipantRow))
    .subscribe();
  channels.all.push(presence);

  const unsubscribe = (() => remove(channels.all)) as RoomEventsUnsubscribe;
  unsubscribe.reconnectChat = () => {
    const previousChatChannels = [...channels.chat];
    remove(channels.chat);
    channels.all = channels.all.filter((channel) => !previousChatChannels.includes(channel));
    addChatChannels();
  };
  return unsubscribe;
}
