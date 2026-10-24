const enc = new TextEncoder();
const dec = new TextDecoder();

function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBuf(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// Cache multi-sala (evita recalcular PBKDF2 a cada mensagem no Dashboard)
const keyCache = new Map<string, CryptoKey>();
const MAX_CACHE_SIZE = 15; // Guarda as ultimas 15 salas abertas

export async function deriveKey(roomCode: string): Promise<CryptoKey> {
  if (keyCache.has(roomCode)) {
    const key = keyCache.get(roomCode)!;
    // Move para o fim do Map (LRU simples)
    keyCache.delete(roomCode);
    keyCache.set(roomCode, key);
    return key;
  }

  const salt = enc.encode(`cipherline-salt-${roomCode}`);
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(roomCode),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );

  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );

  // Se o cache estiver cheio, remove o mais antigo (primeiro do Map)
  if (keyCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = keyCache.keys().next().value;
    if (oldestKey) keyCache.delete(oldestKey);
  }

  keyCache.set(roomCode, key);
  return key;
}

export async function encryptBinary(data: ArrayBuffer, roomCode: string): Promise<ArrayBuffer> {
  const key = await deriveKey(roomCode);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    data,
  );

  const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.byteLength);
  return combined.buffer;
}

export async function decryptBinary(encryptedData: ArrayBuffer, roomCode: string): Promise<ArrayBuffer> {
  const key = await deriveKey(roomCode);
  const combined = new Uint8Array(encryptedData);
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  return crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext,
  );
}

export async function encryptText(plaintext: string, roomCode: string): Promise<string> {
  const key = await deriveKey(roomCode);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(plaintext),
  );

  const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.byteLength);

  return bufToBase64(combined.buffer);
}

export async function decryptText(ciphertextB64: string, roomCode: string): Promise<string> {
  try {
    const key = await deriveKey(roomCode);
    const combined = new Uint8Array(base64ToBuf(ciphertextB64));
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext,
    );
    return dec.decode(plaintext);
  } catch {
    return '[DECRYPT_FAILED]';
  }
}

export function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const segment = () =>
    Array.from(crypto.getRandomValues(new Uint8Array(4)))
      .map((b) => chars[b % chars.length])
      .join('');
  return `${segment()}-${segment()}`;
}

export function clearCachedKey() {
  keyCache.clear();
}
