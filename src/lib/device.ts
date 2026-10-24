// ============================================================
// Identidade persistida localmente.
//
// Formato NOVO (v2): guarda { participantId, secret } em JSON — o
// secret é o que autoriza operações sensíveis (LOTE 5).
//
// Formato ANTIGO (v1): guardava só o participantId em texto. A leitura
// continua a aceitar — quem estava numa sala antes do LOTE 5 não perde
// acesso. Ao reentrar (dashboard, reload), ganha automaticamente um
// segredo novo via join_room_secure.
// ============================================================

const DEVICE_ID_KEY = 'cipherline_device_id';

export function getDeviceId(): string {
  if (typeof localStorage === 'undefined') return 'unknown';
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

// ---------- Credenciais de participante ----------

const PARTICIPANT_KEY_PREFIX = 'cipherline_participant';

function credsKey(roomCode: string, nickname: string): string {
  return `${PARTICIPANT_KEY_PREFIX}_${roomCode}_${nickname}`;
}

export interface StoredParticipantCreds {
  participantId: string;
  /** null = legacy (sem segredo). Será preenchido ao reentrar. */
  secret: string | null;
}

export function saveParticipantCreds(
  roomCode: string,
  nickname: string,
  participantId: string,
  secret: string | null,
): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(
      credsKey(roomCode, nickname),
      JSON.stringify({ participantId, secret }),
    );
  } catch {
    // modo privado pode falhar — segue sem persistir
  }
}

export function getSavedParticipantCreds(
  roomCode: string,
  nickname: string,
): StoredParticipantCreds | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(credsKey(roomCode, nickname));
  if (!raw) return null;

  // Tenta JSON (formato novo)
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.participantId === 'string') {
      return {
        participantId: parsed.participantId,
        secret: typeof parsed.secret === 'string' ? parsed.secret : null,
      };
    }
  } catch {
    // não é JSON — formato antigo
  }

  // Formato antigo (v1): era só o uuid em texto
  return { participantId: raw, secret: null };
}

export function clearParticipantCreds(roomCode: string, nickname: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(credsKey(roomCode, nickname));
}

// --- Aliases antigos (compatibilidade com chamadas existentes) ---
// Podem ser removidos depois de confirmar que nada mais os usa.

export function saveParticipantId(roomCode: string, nickname: string, participantId: string): void {
  saveParticipantCreds(roomCode, nickname, participantId, null);
}

export function getSavedParticipantId(roomCode: string, nickname: string): string | null {
  return getSavedParticipantCreds(roomCode, nickname)?.participantId ?? null;
}

export function clearParticipantId(roomCode: string, nickname: string): void {
  clearParticipantCreds(roomCode, nickname);
}

// ---------- Mensagens escondidas localmente ("apagar só para mim") ----------

function hiddenMessagesKey(roomId: string): string {
  return `cipherline_hidden_messages_${roomId}`;
}

export function getHiddenMessageIds(roomId: string): Set<string> {
  if (typeof localStorage === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(hiddenMessagesKey(roomId));
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

export function hideMessageLocally(roomId: string, messageId: string): void {
  if (typeof localStorage === 'undefined') return;
  const ids = getHiddenMessageIds(roomId);
  ids.add(messageId);
  localStorage.setItem(hiddenMessagesKey(roomId), JSON.stringify(Array.from(ids)));
}