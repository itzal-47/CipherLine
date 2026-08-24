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

export function getRoomParticipantKey(roomCode: string, nickname: string): string {
  return `cipherline_participant_${roomCode}_${nickname}`;
}

export function saveParticipantId(roomCode: string, nickname: string, participantId: string) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(getRoomParticipantKey(roomCode, nickname), participantId);
}

export function getSavedParticipantId(roomCode: string, nickname: string): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(getRoomParticipantKey(roomCode, nickname));
}

export function clearParticipantId(roomCode: string, nickname: string) {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(getRoomParticipantKey(roomCode, nickname));
}
