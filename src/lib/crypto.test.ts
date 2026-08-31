import { describe, it, expect, beforeEach } from 'vitest';
import {
  encryptText,
  decryptText,
  encryptBinary,
  decryptBinary,
  generateRoomCode,
  clearCachedKey,
} from './crypto';

describe('encryptText / decryptText', () => {
  beforeEach(() => clearCachedKey());

  it('round-trips plaintext correctly', async () => {
    const plaintext = 'Olá, isto é uma mensagem secreta! 🔒';
    const roomCode = 'TEST-CODE';
    const encrypted = await encryptText(plaintext, roomCode);
    const decrypted = await decryptText(encrypted, roomCode);
    expect(decrypted).toBe(plaintext);
  });

  it('produces ciphertext that does not contain the plaintext', async () => {
    const plaintext = 'informação sensível';
    const encrypted = await encryptText(plaintext, 'ROOM-1');
    expect(encrypted).not.toContain(plaintext);
  });

  it('produces different ciphertext each time (random IV)', async () => {
    const plaintext = 'mesma mensagem';
    const a = await encryptText(plaintext, 'ROOM-1');
    const b = await encryptText(plaintext, 'ROOM-1');
    expect(a).not.toBe(b);
  });

  it('fails to decrypt with the wrong room code, without throwing', async () => {
    const encrypted = await encryptText('segredo', 'ROOM-CORRECT');
    const result = await decryptText(encrypted, 'ROOM-WRONG');
    expect(result).toBe('[DECRYPT_FAILED]');
  });

  it('handles switching between multiple room codes without cache bleed', async () => {
    // Regressão: garante que o cache de chave (por código de sala) não
    // vaza entre salas diferentes usadas em sequência.
    const encryptedA = await encryptText('mensagem da sala A', 'ROOM-A');
    const encryptedB = await encryptText('mensagem da sala B', 'ROOM-B');

    const decryptedA = await decryptText(encryptedA, 'ROOM-A');
    const decryptedB = await decryptText(encryptedB, 'ROOM-B');

    expect(decryptedA).toBe('mensagem da sala A');
    expect(decryptedB).toBe('mensagem da sala B');

    // Cruzado deve falhar
    const crossDecrypt = await decryptText(encryptedA, 'ROOM-B');
    expect(crossDecrypt).toBe('[DECRYPT_FAILED]');
  });

  it('handles empty string plaintext', async () => {
    const encrypted = await encryptText('', 'ROOM-EMPTY');
    const decrypted = await decryptText(encrypted, 'ROOM-EMPTY');
    expect(decrypted).toBe('');
  });
});

describe('encryptBinary / decryptBinary', () => {
  beforeEach(() => clearCachedKey());

  it('round-trips binary data correctly', async () => {
    const original = new Uint8Array([0, 1, 2, 255, 128, 64, 10, 20, 30]);
    const encrypted = await encryptBinary(original.buffer, 'ROOM-BIN');
    const decrypted = new Uint8Array(await decryptBinary(encrypted, 'ROOM-BIN'));
    expect(Array.from(decrypted)).toEqual(Array.from(original));
  });

  it('rejects decryption with the wrong room code', async () => {
    const original = new Uint8Array([1, 2, 3]);
    const encrypted = await encryptBinary(original.buffer, 'ROOM-CORRECT');
    await expect(decryptBinary(encrypted, 'ROOM-WRONG')).rejects.toThrow();
  });
});

describe('generateRoomCode', () => {
  it('generates codes matching the XXXX-XXXX format', () => {
    const code = generateRoomCode();
    expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  it('never includes ambiguous characters (0/O, 1/I)', () => {
    // O gerador usa um alfabeto sem 0, O, 1, I para evitar confusão visual
    for (let i = 0; i < 50; i++) {
      const code = generateRoomCode();
      expect(code).not.toMatch(/[01OI]/);
    }
  });

  it('generates different codes across calls (no obvious collisions)', () => {
    const codes = new Set(Array.from({ length: 100 }, () => generateRoomCode()));
    expect(codes.size).toBe(100);
  });
});
