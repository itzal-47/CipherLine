import { webcrypto } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCachedKey } from './crypto';
import {
  DECRYPT_FAILED as V2_DECRYPT_FAILED,
  NO_KEY,
  generateRoomSecret,
  type Ctx,
} from './cryptoV2';
import { forgetAllRoomSecrets, getRoomSecret, saveRoomSecret } from './roomKeys';
import { createRoomCrypto, getJoinToken, panicWipeCrypto } from './roomCrypto';

const roomCode = 'ROOM-WRAPPER';
const context: Ctx = { roomCode, messageId: 'message-123', type: 'text' };

beforeAll(() => {
  // jsdom pode expor getRandomValues sem implementar subtle; usa Web Crypto do Node nos testes.
  vi.stubGlobal('crypto', webcrypto);
});

beforeEach(() => {
  clearCachedKey();
  forgetAllRoomSecrets();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('roomCrypto v1', () => {
  it('faz roundtrip de texto e binário com a cifragem v1', async () => {
    const room = createRoomCrypto({ roomCode, cryptoVersion: 1 });
    const ctx = { messageId: 'ignored', type: 'audio' as const };
    const text = 'Mensagem antiga 🔒';
    const encryptedText = await room.encryptText(text, ctx);
    expect(await room.decryptText(encryptedText, ctx)).toBe(text);

    const bytes = new Uint8Array([0, 1, 127, 128, 255]);
    const encryptedBinary = await room.encryptBinary(bytes.buffer, ctx);
    expect(new Uint8Array(await room.decryptBinary(encryptedBinary, ctx))).toEqual(bytes);
    expect(room.version).toBe(1);
    expect(room.hasKey).toBe(true);
  });

  it('recusa texto com prefixo v2 sem tentar decifrar como v1', async () => {
    const room = createRoomCrypto({ roomCode, cryptoVersion: 1 });
    await expect(room.decryptText('v2.ciphertext', { messageId: 'm', type: 'text' }))
      .resolves.toBe(V2_DECRYPT_FAILED);
  });

  it('converte a falha v1 no marcador de falha e não regista dados', async () => {
    const room = createRoomCrypto({ roomCode, cryptoVersion: 1 });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(room.decryptText('não é base64', { messageId: 'm', type: 'text' }))
      .resolves.toBe(V2_DECRYPT_FAILED);
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});

describe('roomCrypto v2', () => {
  it('faz roundtrip de texto Unicode e binário com o contexto e código da sala', async () => {
    const secret = generateRoomSecret();
    const room = createRoomCrypto({ roomCode, cryptoVersion: 2, secret });
    const text = 'Olá, CipherLine! 🔐 ñ 漢字';
    const encryptedText = await room.encryptText(text, context);
    expect(encryptedText.startsWith('v2.')).toBe(true);
    expect(await room.decryptText(encryptedText, context)).toBe(text);

    const binaryContext = { messageId: context.messageId, type: 'audio' as const };
    const bytes = new Uint8Array([0, 1, 127, 128, 255, 42]);
    const encryptedBinary = await room.encryptBinary(bytes.buffer, binaryContext);
    expect(new Uint8Array(encryptedBinary)[0]).toBe(0x02);
    expect(new Uint8Array(await room.decryptBinary(encryptedBinary, binaryContext))).toEqual(bytes);
    expect(room.hasKey).toBe(true);
  });

  it('sem segredo lança NO_KEY ao cifrar e devolve NO_KEY ao decifrar', async () => {
    const room = createRoomCrypto({ roomCode, cryptoVersion: 2 });
    const ctx = { messageId: 'm', type: 'text' as const };
    expect(room.hasKey).toBe(false);
    await expect(room.encryptText('texto', ctx)).rejects.toThrow('NO_KEY');
    await expect(room.encryptBinary(new ArrayBuffer(0), ctx)).rejects.toThrow('NO_KEY');
    await expect(room.decryptText('v2.invalid', ctx)).resolves.toBe(NO_KEY);
  });

  it('recusa texto v1 válido sem fallback', async () => {
    const legacyRoom = createRoomCrypto({ roomCode, cryptoVersion: 1 });
    const ctx = { messageId: 'm', type: 'text' as const };
    const legacyCiphertext = await legacyRoom.encryptText('v1 legítimo', ctx);
    const currentRoom = createRoomCrypto({ roomCode, cryptoVersion: 2, secret: generateRoomSecret() });
    await expect(currentRoom.decryptText(legacyCiphertext, ctx))
      .resolves.toBe(V2_DECRYPT_FAILED);

    const legacyBinary = await legacyRoom.encryptBinary(new Uint8Array([1, 2, 3]).buffer, ctx);
    await expect(currentRoom.decryptBinary(legacyBinary, ctx)).rejects.toThrow();
  });

  it('devolve DECRYPT_FAILED se messageId, type ou roomCode forem diferentes', async () => {
    const secret = generateRoomSecret();
    const room = createRoomCrypto({ roomCode, cryptoVersion: 2, secret });
    const ctx = { messageId: 'm-1', type: 'text' as const };
    const ciphertext = await room.encryptText('texto protegido', ctx);
    await expect(room.decryptText(ciphertext, { ...ctx, messageId: 'm-2' })).resolves.toBe(V2_DECRYPT_FAILED);
    await expect(room.decryptText(ciphertext, { ...ctx, type: 'poll' })).resolves.toBe(V2_DECRYPT_FAILED);

    const otherRoom = createRoomCrypto({ roomCode: 'ROOM-OTHER', cryptoVersion: 2, secret });
    await expect(otherRoom.decryptText(ciphertext, ctx)).resolves.toBe(V2_DECRYPT_FAILED);
  });

  it('devolve DECRYPT_FAILED com segredo errado sem lançar nem registar conteúdo', async () => {
    const cipheringRoom = createRoomCrypto({ roomCode, cryptoVersion: 2, secret: generateRoomSecret() });
    const decryptingRoom = createRoomCrypto({ roomCode, cryptoVersion: 2, secret: generateRoomSecret() });
    const ctx = { messageId: 'm', type: 'text' as const };
    const ciphertext = await cipheringRoom.encryptText('plaintext de teste', ctx);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(decryptingRoom.decryptText(ciphertext, ctx)).resolves.toBe(V2_DECRYPT_FAILED);
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('trata segredo inválido como ausente sem lançar na criação', () => {
    const room = createRoomCrypto({ roomCode, cryptoVersion: 2, secret: 'segredo-inválido' });
    expect(room.hasKey).toBe(false);
  });

  it('deriva joinToken determinístico e específico da sala', async () => {
    const secret = generateRoomSecret();
    const first = await getJoinToken(roomCode, secret);
    expect(await getJoinToken(roomCode, secret)).toBe(first);
    expect(await getJoinToken('ROOM-OTHER', secret)).not.toBe(first);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe('panicWipeCrypto', () => {
  it('limpa segredos de sala guardados e a cache v1', () => {
    const secret = generateRoomSecret();
    saveRoomSecret(roomCode, secret);
    expect(getRoomSecret(roomCode)).toBe(secret);
    panicWipeCrypto();
    expect(getRoomSecret(roomCode)).toBeNull();
  });
});

