import { supabase } from './supabase';
import { SECURE_READS } from './flags';
import { PARTICIPANT_COLUMNS } from './columns';
import type { MessageRow as BaseMessageRow, Reaction, ReadReceipt } from '@/types';

export interface RoomCredentials {
  roomId: string;
  participantId: string;
  secret: string;
}

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
  nickname?: string;
  show_profile: boolean;
  user_id: string | null;
}

export interface RoomSnapshot {
  messages: MessageRow[] | null;
  participants: ParticipantRow[] | null;
  reactions: ReactionRow[];
  receipts: ReceiptRow[];
  paste?: string | null;
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
  onAuthError?: () => void;
}

export interface RoomEventsUnsubscribe {
  (): void;
  reconnectChat(): void;
}

type SecureEvent = { id: number; kind: string; row: Record<string, unknown> };
type Channel = ReturnType<typeof supabase.channel>;

const cursors = new Map<string, number>();

export function isRoomAuthError(error: unknown): boolean {
  const value = error as { message?: string; details?: string; hint?: string } | null;
  const message = [value?.message, value?.details, value?.hint].filter(Boolean).join(' ');
  return message.includes('INVALID_SECRET') || message.includes('NOT_IN_ROOM');
}

function invalidCredentialsError(): Error {
  return new Error('INVALID_SECRET');
}

function rpcCredentials(creds: RoomCredentials) {
  if (!creds.secret) throw invalidCredentialsError();
  return {
    p_room_id: creds.roomId,
    p_participant_id: creds.participantId,
    p_secret: creds.secret,
  };
}

async function getSecureSnapshot(creds: RoomCredentials, limit = 100) {
  const { data, error } = await supabase.rpc('get_room_snapshot_secure', {
    ...rpcCredentials(creds),
    p_limit: limit,
  });
  if (error) throw error;
  const result = data as {
    cursor?: number;
    messages?: MessageRow[];
    participants?: ParticipantRow[];
    reactions?: ReactionRow[];
    receipts?: ReceiptRow[];
    paste?: string | null;
  } | null;
  cursors.set(creds.roomId, Number(result?.cursor) || 0);
  return result;
}

export async function fetchRoomSnapshot(creds: RoomCredentials): Promise<RoomSnapshot> {
  if (SECURE_READS) {
    const snapshot = await getSecureSnapshot(creds);
    return {
      messages: snapshot?.messages ?? [],
      participants: snapshot?.participants ?? [],
      reactions: snapshot?.reactions ?? [],
      receipts: snapshot?.receipts ?? [],
      paste: snapshot?.paste ?? null,
    };
  }

  const [{ data: messages }, { data: participants }] = await Promise.all([
    supabase.from('messages').select('*').eq('room_id', creds.roomId).order('created_at', { ascending: false }).limit(100),
    supabase.from('participants').select(PARTICIPANT_COLUMNS.room).eq('room_id', creds.roomId),
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

export async function fetchParticipants(creds: RoomCredentials) {
  if (SECURE_READS) {
    if (!creds.secret) return { data: null, error: invalidCredentialsError() };
    const { data, error } = await supabase.rpc('get_participants_secure', rpcCredentials(creds));
    return { data: (data as ParticipantRow[] | null) ?? null, error };
  }
  return await supabase.from('participants').select(PARTICIPANT_COLUMNS.room).eq('room_id', creds.roomId);
}

export async function fetchParticipantBrief(creds: RoomCredentials, targetId: string) {
  if (SECURE_READS) {
    if (!creds.secret) return { data: null, error: invalidCredentialsError() };
    const { data, error } = await supabase.rpc('get_participant_secure', {
      ...rpcCredentials(creds), p_target_id: targetId,
    });
    return { data: data as ParticipantBrief | null, error };
  }
  return await supabase.from('participants').select(PARTICIPANT_COLUMNS.sender).eq('id', targetId).maybeSingle();
}

export async function fetchParticipantShowProfile(creds: RoomCredentials) {
  if (SECURE_READS) {
    const { data, error } = await fetchParticipantBrief(creds, creds.participantId);
    return { data, error };
  }
  return await supabase.from('participants').select(PARTICIPANT_COLUMNS.showProfile).eq('id', creds.participantId).maybeSingle();
}

export async function fetchParticipantUserId(creds: RoomCredentials, targetId: string) {
  if (SECURE_READS) {
    const { data, error } = await fetchParticipantBrief(creds, targetId);
    return { data, error };
  }
  return await supabase.from('participants').select(PARTICIPANT_COLUMNS.user).eq('id', targetId).maybeSingle();
}

export async function countParticipants(roomId: string) {
  if (SECURE_READS) return { data: null, count: null, error: new Error('SECURE_READS does not expose participant counts') };
  return await supabase.from('participants').select(PARTICIPANT_COLUMNS.identity, { count: 'exact', head: true }).eq('room_id', roomId);
}

export async function fetchRoomMediaPaths(creds: RoomCredentials) {
  if (SECURE_READS) {
    if (!creds.secret) return { data: null, error: invalidCredentialsError() };
    const { data, error } = await supabase.rpc('get_room_media_paths_secure', rpcCredentials(creds));
    return { data: (data as string[] | null)?.map((storage_path) => ({ storage_path })) ?? null, error };
  }
  return await supabase.from('messages').select('storage_path').eq('room_id', creds.roomId).not('storage_path', 'is', null);
}

export async function fetchPaste(creds: RoomCredentials): Promise<string | null> {
  if (SECURE_READS) {
    const { data, error } = await supabase.rpc('get_paste_secure', rpcCredentials(creds));
    if (error) throw error;
    return (data as string | null) ?? null;
  }
  const { data } = await supabase.from('room_pastes').select('encrypted_content').eq('room_id', creds.roomId).maybeSingle();
  return data?.encrypted_content ?? null;
}

function removeChannels(channels: Channel[]) {
  channels.splice(0).forEach((channel) => { void supabase.removeChannel(channel); });
}

function subscribeLegacyRoomEvents(creds: RoomCredentials, handlers: RoomEventHandlers): RoomEventsUnsubscribe {
  const channels: { all: Channel[]; chat: Channel[] } = { all: [], chat: [] };
  const addChatChannels = () => {
    const chat = supabase.channel(`chat-${creds.roomId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${creds.roomId}` }, (payload) => handlers.onMessageInsert?.(payload.new as MessageRow))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `room_id=eq.${creds.roomId}` }, (payload) => handlers.onMessageUpdate?.(payload.new as MessageRow))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages', filter: `room_id=eq.${creds.roomId}` }, (payload) => handlers.onMessageDelete?.(payload.old as Partial<MessageRow>))
      .subscribe((status) => handlers.onStatus?.(status));
    const reactions = supabase.channel(`reactions-${creds.roomId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'reactions' }, (payload) => handlers.onReactionInsert?.(payload.new as ReactionRow))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'reactions' }, (payload) => handlers.onReactionDelete?.(payload.old as Partial<ReactionRow>))
      .subscribe();
    const receipts = supabase.channel(`receipts-${creds.roomId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'read_receipts' }, (payload) => handlers.onReceiptInsert?.(payload.new as ReceiptRow))
      .subscribe();
    channels.chat.push(chat, reactions, receipts);
    channels.all.push(chat, reactions, receipts);
  };
  const paste = supabase.channel(`paste-${creds.roomId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'room_pastes', filter: `room_id=eq.${creds.roomId}` }, (payload) => handlers.onPasteChange?.(payload as { new?: { encrypted_content?: string | null } | null }))
    .subscribe();
  channels.all.push(paste);
  addChatChannels();
  const presence = supabase.channel(`presence-${creds.roomId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'participants', filter: `room_id=eq.${creds.roomId}` }, (payload) => handlers.onParticipantInsert?.(payload.new as ParticipantRow))
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'participants', filter: `room_id=eq.${creds.roomId}` }, (payload) => handlers.onParticipantDelete?.(payload.old as Partial<ParticipantRow>))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'participants', filter: `room_id=eq.${creds.roomId}` }, (payload) => handlers.onParticipantUpdate?.(payload.new as ParticipantRow))
    .subscribe();
  channels.all.push(presence);
  const unsubscribe = (() => removeChannels(channels.all)) as RoomEventsUnsubscribe;
  unsubscribe.reconnectChat = () => {
    const previousChat = [...channels.chat];
    removeChannels(channels.chat);
    channels.all = channels.all.filter((channel) => !previousChat.includes(channel));
    addChatChannels();
  };
  return unsubscribe;
}

function dispatchEvent(event: SecureEvent, handlers: RoomEventHandlers) {
  const row = event.row;
  switch (event.kind) {
    case 'message_insert': handlers.onMessageInsert?.(row as unknown as MessageRow); break;
    case 'message_update': handlers.onMessageUpdate?.(row as unknown as MessageRow); break;
    case 'message_delete': handlers.onMessageDelete?.(row as Partial<MessageRow>); break;
    case 'reaction_insert': handlers.onReactionInsert?.(row as unknown as ReactionRow); break;
    case 'reaction_delete': handlers.onReactionDelete?.(row as Partial<ReactionRow>); break;
    case 'receipt_insert': handlers.onReceiptInsert?.(row as unknown as ReceiptRow); break;
    case 'participant_insert': handlers.onParticipantInsert?.(row as unknown as ParticipantRow); break;
    case 'participant_update': handlers.onParticipantUpdate?.(row as unknown as ParticipantRow); break;
    case 'participant_delete': handlers.onParticipantDelete?.(row as Partial<ParticipantRow>); break;
    case 'paste': handlers.onPasteChange?.({ new: row as { encrypted_content?: string | null } }); break;
  }
}

function subscribeSecureRoomEvents(creds: RoomCredentials, handlers: RoomEventHandlers): RoomEventsUnsubscribe {
  let cursor = cursors.get(creds.roomId);
  let priming = true;
  const seen = new Set<number>();
  let channel: Channel | null = null;
  let polling = false;
  let pollAgain = false;
  let stopped = false;
  let authErrorSent = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const interval = setInterval(() => { void poll(); }, 15000);

  const stopPolling = () => {
    stopped = true;
    clearInterval(interval);
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = null;
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('online', onOnline);
  };

  const handleError = (error: unknown) => {
    if (isRoomAuthError(error)) {
      if (!authErrorSent) {
        authErrorSent = true;
        stopPolling();
        handlers.onAuthError?.();
      }
      return;
    }
  };

  const poll = async () => {
    if (stopped) return;
    if (polling) { pollAgain = true; return; }
    polling = true;
    try {
      if (cursor === undefined) {
        try {
          const snapshot = await getSecureSnapshot(creds, 1);
          cursor = Number(snapshot?.cursor) || 0;
          priming = true;
        } catch (error) { handleError(error); return; }
      }
      for (let page = 0; page < 5 && !stopped; page += 1) {
        const { data, error } = await supabase.rpc('get_room_events_secure', {
          ...rpcCredentials(creds), p_after: Math.max((cursor ?? 0) - 30, 0),
        });
        if (error) { handleError(error); break; }
        const result = data as { events?: SecureEvent[]; cursor?: number; more?: boolean } | null;
        const events = [...(result?.events ?? [])].sort((a, b) => a.id - b.id);
        for (const event of events) {
          if (seen.has(event.id)) continue;
          seen.add(event.id);
          if (priming && event.id <= (cursor ?? 0)) continue;
          dispatchEvent(event, handlers);
        }
        cursor = Math.max(cursor ?? 0, Number(result?.cursor) || 0);
        cursors.set(creds.roomId, cursor);
        for (const id of seen) if (id < cursor - 300) seen.delete(id);
        priming = false;
        if (!result?.more) break;
      }
    } catch (error) {
      handleError(error);
    } finally {
      polling = false;
      if (pollAgain && !stopped) { pollAgain = false; void poll(); }
    }
  };

  const schedulePoll = () => {
    if (stopped) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => { debounceTimer = null; void poll(); }, 150);
  };
  const onVisibilityChange = () => { if (document.visibilityState === 'visible') schedulePoll(); };
  const onOnline = () => schedulePoll();
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('online', onOnline);

  const createChannel = () => {
    channel = supabase.channel(`room-sync-${creds.roomId}`)
      .on('broadcast', { event: 'sync' }, () => schedulePoll())
      .subscribe((status) => {
        handlers.onStatus?.(status);
        if (status === 'SUBSCRIBED') schedulePoll();
      });
  };
  createChannel();

  const unsubscribe = (() => {
    stopPolling();
    if (channel) { void supabase.removeChannel(channel); channel = null; }
  }) as RoomEventsUnsubscribe;
  unsubscribe.reconnectChat = () => {
    if (channel) { void supabase.removeChannel(channel); channel = null; }
    if (!stopped) createChannel();
  };
  return unsubscribe;
}

export function subscribeRoomEvents(creds: RoomCredentials, handlers: RoomEventHandlers): RoomEventsUnsubscribe {
  return SECURE_READS ? subscribeSecureRoomEvents(creds, handlers) : subscribeLegacyRoomEvents(creds, handlers);
}

export function watchForOtherParticipant(creds: RoomCredentials, onFound: () => void): () => void {
  if (!SECURE_READS) {
    let found = false;
    const channel = supabase.channel(`room-${creds.roomId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'participants', filter: `room_id=eq.${creds.roomId}` }, (payload) => {
        if (!found && payload.new.id !== creds.participantId) { found = true; onFound(); }
      })
      .subscribe();
    return () => { void channel.unsubscribe(); };
  }

  let cancelled = false;
  let found = false;
  const check = async () => {
    if (cancelled || found) return;
    const { data, error } = await fetchParticipants(creds);
    if (cancelled || found) return;
    if (error) {
      if (isRoomAuthError(error)) cancel();
      return;
    }
    if (data?.some((participant) => participant.id !== creds.participantId)) {
      found = true;
      cancel();
      onFound();
    }
  };
  const channel = supabase.channel(`room-sync-${creds.roomId}`)
    .on('broadcast', { event: 'sync' }, () => { void check(); })
    .subscribe();
  const interval = setInterval(() => { void check(); }, 3000);
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    clearInterval(interval);
    void supabase.removeChannel(channel);
  };
  void check();
  return cancel;
}
