// ============================================================
// Operações sensíveis do participante.
//
// Todas as escritas (mensagem, reação, recibo, presença, etc.)
// passam por RPCs SECURITY DEFINER que exigem o par
// (participantId, secret). O RLS bloqueia escritas diretas —
// só estas funções conseguem tocar nas tabelas.
// ============================================================

import { supabase } from './supabase';
import { getDeviceId, getSavedParticipantCreds } from './device';
import { PARTICIPANT_COLUMNS } from './columns';
import { SECURE_READS } from './flags';

export interface SecureJoinResult {
  participantId: string;
  secret: string;
  roomId: string;
  isPermanent: boolean;
  cryptoVersion: 1 | 2;
}

/**
 * Entra numa sala de forma segura: cria (ou reusa) o participante
 * e obtém um segredo único que será exigido em todas as operações
 * sensíveis.
 */
export async function joinRoomSecure(
  roomCode: string,
  nickname: string,
  userId: string | null = null,
  joinToken?: string | null,
): Promise<SecureJoinResult> {
  const stored = getSavedParticipantCreds(roomCode, nickname);
  let secret = stored?.secret || null;

  // Se não houver segredo no localStorage, o cliente gera um agora.
  // Isto garante que a sessão sobrevive a F5 e mudanças de aba.
  if (!secret) {
    secret = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  }

  const { data, error } = await supabase.rpc('join_room_secure', {
    p_code: roomCode,
    p_nickname: nickname,
    p_device_id: getDeviceId(),
    p_user_id: userId,
    p_secret: secret, // Envia o segredo (novo ou já guardado)
    p_join_token: joinToken ?? null,
  });

  if (error || !data || data.length === 0) {
    throw new Error(error?.message || 'FALHA AO ENTRAR NA SALA');
  }

  const row = data[0];
  return {
    participantId: row.participant_id,
    secret: secret, // Devolve o segredo que o cliente gerou/guardou
    roomId: row.room_id,
    isPermanent: row.is_permanent,
    cryptoVersion: row.crypto_version === 2 ? 2 : 1,
  };
}

/**
 * Verifica se o par (participantId, secret) ainda é válido.
 */
export async function verifyParticipant(
  participantId: string,
  secret: string | null,
): Promise<boolean> {
  if (!secret) {
    if (SECURE_READS) return false;
    const { data } = await supabase
      .from('participants')
      .select(PARTICIPANT_COLUMNS.identity)
      .eq('id', participantId)
      .maybeSingle();
    return !!data;
  }

  const { data, error } = await supabase.rpc('verify_participant', {
    p_participant_id: participantId,
    p_secret: secret,
  });

  if (error) return false;
  return data === true;
}

// ============================================================
// Escritas verificadas por segredo
// ============================================================

export async function insertMessageSecure(params: {
  roomId: string;
  participantId: string;
  secret: string;
  encryptedContent: string;
  burnConfig?: unknown;
  messageType?: 'text' | 'audio' | 'image' | 'capsule' | 'poll';
  storagePath?: string | null;
  durationSeconds?: number | null;
  replyToMessageId?: string | null;
  capsuleUnlockAt?: string | null;
  targetParticipantId?: string | null;
  pollData?: unknown;
  burnAfterListen?: boolean;
  fileName?: string | null;
  messageId?: string;
}) {
  const { data, error } = await supabase.rpc('insert_message_secure', {
    p_room_id: params.roomId,
    p_participant_id: params.participantId,
    p_secret: params.secret,
    p_encrypted_content: params.encryptedContent,
    p_burn_config: params.burnConfig ?? null,
    p_message_type: params.messageType ?? 'text',
    p_storage_path: params.storagePath ?? null,
    p_duration_seconds: params.durationSeconds ?? null,
    p_reply_to_message_id: params.replyToMessageId ?? null,
    p_capsule_unlock_at: params.capsuleUnlockAt ?? null,
    p_target_participant_id: params.targetParticipantId ?? null,
    p_poll_data: params.pollData ?? null,
    p_burn_after_listen: params.burnAfterListen ?? false,
    p_file_name: params.fileName ?? null,
    ...(params.messageId ? { p_message_id: params.messageId } : {}),
  });
  if (error) throw error;
  return data;
}

export async function votePollSecure(messageId: string, participantId: string, secret: string, optionId: string) {
  const { error } = await supabase.rpc('vote_poll_secure', {
    p_message_id: messageId,
    p_participant_id: participantId,
    p_secret: secret,
    p_option_id: optionId,
  });
  if (error) throw error;
}

export async function deleteMessageSecure(
  messageId: string,
  participantId: string,
  secret: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('delete_message_secure', {
    p_message_id: messageId,
    p_participant_id: participantId,
    p_secret: secret,
  });
  if (error) throw error;
  return data === true;
}

export async function reactSecure(
  messageId: string,
  participantId: string,
  secret: string,
  emoji: string,
) {
  const { data, error } = await supabase.rpc('react_secure', {
    p_message_id: messageId,
    p_participant_id: participantId,
    p_secret: secret,
    p_emoji: emoji,
  });
  if (error) throw error;
  return data;
}

export async function unreactSecure(
  messageId: string,
  participantId: string,
  secret: string,
  emoji: string,
) {
  const { error } = await supabase.rpc('unreact_secure', {
    p_message_id: messageId,
    p_participant_id: participantId,
    p_secret: secret,
    p_emoji: emoji,
  });
  if (error) throw error;
}

export async function markReadSecure(
  messageId: string,
  participantId: string,
  secret: string,
) {
  await supabase.rpc('mark_read_secure', {
    p_message_id: messageId,
    p_participant_id: participantId,
    p_secret: secret,
  });
}

export async function updatePresenceSecure(
  participantId: string,
  secret: string,
) {
  await supabase.rpc('update_presence_secure', {
    p_participant_id: participantId,
    p_secret: secret,
  });
}

export async function upsertPasteSecure(
  roomId: string,
  participantId: string,
  secret: string,
  encryptedContent: string,
) {
  await supabase.rpc('upsert_paste_secure', {
    p_room_id: roomId,
    p_participant_id: participantId,
    p_secret: secret,
    p_encrypted_content: encryptedContent,
  });
}

export async function updateRoomSecure(params: {
  roomId: string;
  participantId: string;
  secret: string;
  name?: string | null;
  isPublic?: boolean | null;
  topic?: string | null;
  deadManSwitchDays?: number | null;
}) {
  await supabase.rpc('update_room_secure', {
    p_room_id: params.roomId,
    p_participant_id: params.participantId,
    p_secret: params.secret,
    p_name: params.name ?? null,
    p_is_public: params.isPublic ?? null,
    p_topic: params.topic ?? null,
    p_dead_man_switch_days: params.deadManSwitchDays ?? null,
  });
}

export async function updateParticipantProfileSecure(
  participantId: string,
  secret: string,
  showProfile: boolean | null,
) {
  await supabase.rpc('update_participant_profile_secure', {
    p_participant_id: participantId,
    p_secret: secret,
    p_show_profile: showProfile,
  });
}

export async function leaveRoomSecure(
  participantId: string,
  secret: string,
) {
  await supabase.rpc('leave_room_secure', {
    p_participant_id: participantId,
    p_secret: secret,
  });
}

export async function updateRoomBurnConfigSecure(
  roomId: string,
  participantId: string,
  secret: string,
  burnConfig: unknown,
) {
  const { error } = await supabase.rpc('update_room_burn_config_secure', {
    p_room_id: roomId,
    p_participant_id: participantId,
    p_secret: secret,
    p_burn_config: burnConfig,
  });
  if (error) throw error;
}

export async function insertAiReplySecure(
  roomId: string,
  callerParticipantId: string,
  callerSecret: string,
  encryptedReply: string,
  messageId: string,
  contextIncluded: boolean,
) {
  const { data, error } = await supabase.rpc('insert_ai_reply_secure', {
    p_room_id: roomId,
    p_caller_participant_id: callerParticipantId,
    p_caller_secret: callerSecret,
    p_encrypted_reply: encryptedReply,
    p_message_id: messageId,
    p_context_included: contextIncluded,
  });
  if (error) throw error;
  return data;
}

export async function deleteParticipantCompletelySecure(
  participantId: string,
  secret: string,
) {
  await supabase.rpc('delete_participant_completely_secure', {
    p_participant_id: participantId,
    p_secret: secret,
  });
}

export async function togglePinMessageSecure(
  messageId: string,
  participantId: string,
  secret: string,
) {
  const { data, error } = await supabase.rpc('toggle_pin_message_secure', {
    p_message_id: messageId,
    p_participant_id: participantId,
    p_secret: secret,
  });
  if (error) throw error;
  return data;
}
