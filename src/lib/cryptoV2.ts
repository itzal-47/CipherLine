export const V2_PREFIX = 'v2.';
export const NO_KEY = '[NO_KEY]';
export const DECRYPT_FAILED = '[DECRYPT_FAILED]';

export type MsgType = 'text' | 'audio' | 'image' | 'capsule' | 'poll' | 'paste' | 'media';

export interface Ctx {
  roomCode: string;
  messageId: string;
  type: MsgType;
}

const SECRET_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const HKDF_SALT = new TextEncoder().encode('cipherline/v2');
const IV_LENGTH = 12;
const GCM_TAG_LENGTH = 16;
const BASE64_BLOCK_SIZE = 0x8000;
const MAX_CACHED_KEYS = 15;
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

interface DerivedRoomKeys {
  text: CryptoKey;
  media: CryptoKey;
  joinToken: string;
}

const derivedKeysCache = new Map<string, Promise<DerivedRoomKeys>>();

function getSubtleCrypto(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('Web Crypto não está disponível.');
  return subtle;
}

function encodeBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];

  let offset = 0;
  while (offset < bytes.length) {
    let end = Math.min(offset + BASE64_BLOCK_SIZE, bytes.length);
    if (end < bytes.length) end -= (end - offset) % 3;
    const encodedParts: string[] = [];

    for (let index = offset; index < end; index += 3) {
      const first = bytes[index];
      const hasSecond = index + 1 < end;
      const hasThird = index + 2 < end;
      const second = hasSecond ? bytes[index + 1] : 0;
      const third = hasThird ? bytes[index + 2] : 0;
      encodedParts.push(
        BASE64_ALPHABET[first >> 2]
          + BASE64_ALPHABET[((first & 0x03) << 4) | (second >> 4)]
          + (hasSecond ? BASE64_ALPHABET[((second & 0x0f) << 2) | (third >> 6)] : '=')
          + (hasThird ? BASE64_ALPHABET[third & 0x3f] : '='),
      );
    }
    chunks.push(encodedParts.join(''));
    offset = end;
  }

  return chunks.join('');
}

function decodeBase64(value: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('Dados cifrados inválidos.');
  }

  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function encodeBase64Url(bytes: Uint8Array): string {
  return encodeBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(value: string): Uint8Array {
  if (!SECRET_PATTERN.test(value)) throw new Error('Segredo inválido.');
  const standard = value.replace(/-/g, '+').replace(/_/g, '/') + '==';
  const bytes = decodeBase64(standard);
  if (bytes.length !== 16 || encodeBase64Url(bytes) !== value) {
    throw new Error('Segredo inválido.');
  }
  return bytes;
}

function getSecretBytes(secret: string): Uint8Array {
  try {
    return decodeBase64Url(secret);
  } catch {
    throw new Error('Segredo inválido.');
  }
}

function cacheKey(roomCode: string, secret: string): string {
  return JSON.stringify([roomCode, secret]);
}

function rememberCacheEntry(key: string, value: Promise<DerivedRoomKeys>): void {
  derivedKeysCache.delete(key);
  derivedKeysCache.set(key, value);
  while (derivedKeysCache.size > MAX_CACHED_KEYS) {
    const oldestKey = derivedKeysCache.keys().next().value as string | undefined;
    if (oldestKey === undefined) break;
    derivedKeysCache.delete(oldestKey);
  }
}

async function deriveRoomKeysInternal(secretBytes: Uint8Array, roomCode: string): Promise<DerivedRoomKeys> {
  const subtle = getSubtleCrypto();
  const inputKey = await subtle.importKey('raw', secretBytes, 'HKDF', false, ['deriveKey', 'deriveBits']);
  const deriveAesKey = (purpose: 'text' | 'media') => subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: HKDF_SALT,
      info: new TextEncoder().encode(`room:${roomCode}|${purpose}`),
    },
    inputKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );

  const [text, media, joinBits] = await Promise.all([
    deriveAesKey('text'),
    deriveAesKey('media'),
    subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: HKDF_SALT,
        info: new TextEncoder().encode(`room:${roomCode}|join`),
      },
      inputKey,
      256,
    ),
  ]);

  return { text, media, joinToken: encodeBase64Url(new Uint8Array(joinBits)) };
}

export function generateRoomSecret(): string {
  const bytes = new Uint8Array(16);
  getSubtleCrypto();
  globalThis.crypto.getRandomValues(bytes);
  return encodeBase64Url(bytes);
}

export async function deriveRoomKeys(secret: string, roomCode: string): Promise<DerivedRoomKeys> {
  const secretBytes = getSecretBytes(secret);
  const key = cacheKey(roomCode, secret);
  const cached = derivedKeysCache.get(key);
  if (cached) {
    derivedKeysCache.delete(key);
    derivedKeysCache.set(key, cached);
    return cached;
  }

  const pending = deriveRoomKeysInternal(secretBytes, roomCode);
  rememberCacheEntry(key, pending);
  try {
    return await pending;
  } catch (error) {
    derivedKeysCache.delete(key);
    throw error;
  }
}

function getAdditionalData(ctx: Ctx): Uint8Array {
  return new TextEncoder().encode(`cl2|${ctx.roomCode}|${ctx.messageId}|${ctx.type}`);
}

async function encryptBytes(data: Uint8Array, key: CryptoKey, ctx: Ctx): Promise<Uint8Array> {
  const iv = new Uint8Array(IV_LENGTH);
  globalThis.crypto.getRandomValues(iv);
  const encrypted = await getSubtleCrypto().encrypt(
    { name: 'AES-GCM', iv, additionalData: getAdditionalData(ctx), tagLength: 128 },
    key,
    data,
  );
  const result = new Uint8Array(iv.length + encrypted.byteLength);
  result.set(iv);
  result.set(new Uint8Array(encrypted), iv.length);
  return result;
}

async function decryptBytes(data: Uint8Array, key: CryptoKey, ctx: Ctx): Promise<Uint8Array> {
  if (data.length < IV_LENGTH + GCM_TAG_LENGTH) throw new Error('Dados cifrados inválidos.');
  const iv = data.subarray(0, IV_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH);
  const decrypted = await getSubtleCrypto().decrypt(
    { name: 'AES-GCM', iv, additionalData: getAdditionalData(ctx), tagLength: 128 },
    key,
    ciphertext,
  );
  return new Uint8Array(decrypted);
}

export async function encryptTextV2(plaintext: string, secret: string, ctx: Ctx): Promise<string> {
  const keys = await deriveRoomKeys(secret, ctx.roomCode);
  const encrypted = await encryptBytes(new TextEncoder().encode(plaintext), keys.text, ctx);
  return V2_PREFIX + encodeBase64(encrypted);
}

export async function decryptTextV2(ciphertext: string, secret: string, ctx: Ctx): Promise<string> {
  getSecretBytes(secret);
  if (!ciphertext.startsWith(V2_PREFIX)) throw new Error('Formato de texto cifrado inválido.');
  const encrypted = decodeBase64(ciphertext.slice(V2_PREFIX.length));
  const keys = await deriveRoomKeys(secret, ctx.roomCode);
  const plaintext = await decryptBytes(encrypted, keys.text, ctx);
  return new TextDecoder().decode(plaintext);
}

export async function encryptBinaryV2(data: ArrayBuffer, secret: string, ctx: Ctx): Promise<ArrayBuffer> {
  const keys = await deriveRoomKeys(secret, ctx.roomCode);
  const encrypted = await encryptBytes(new Uint8Array(data), keys.media, ctx);
  const result = new Uint8Array(1 + encrypted.length);
  result[0] = 0x02;
  result.set(encrypted, 1);
  return result.buffer;
}

export async function decryptBinaryV2(data: ArrayBuffer, secret: string, ctx: Ctx): Promise<ArrayBuffer> {
  getSecretBytes(secret);
  const bytes = new Uint8Array(data);
  if (bytes[0] !== 0x02 || bytes.length < 1 + IV_LENGTH + GCM_TAG_LENGTH) {
    throw new Error('Formato binário cifrado inválido.');
  }
  const keys = await deriveRoomKeys(secret, ctx.roomCode);
  const plaintext = await decryptBytes(bytes.subarray(1), keys.media, ctx);
  return plaintext.buffer;
}

export function buildInviteUrl(origin: string, roomCode: string, secret: string): string {
  getSecretBytes(secret);
  return `${origin}/?room=${encodeURIComponent(roomCode)}#k=${secret}`;
}

export function parseInviteUrl(url: string): { roomCode: string | null; secret: string | null } {
  try {
    const parsed = new URL(url, 'https://cipherline.invalid');
    const roomCode = parsed.searchParams.get('room');
    const hashParams = new URLSearchParams(parsed.hash.replace(/^#/, ''));
    const candidateSecret = hashParams.get('k');
    let secret: string | null = null;
    if (candidateSecret !== null) {
      try {
        getSecretBytes(candidateSecret);
        secret = candidateSecret;
      } catch {
        secret = null;
      }
    }
    return { roomCode, secret };
  } catch {
    return { roomCode: null, secret: null };
  }
}
