import { webcrypto } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildInviteUrl,
  decryptBinaryV2,
  decryptTextV2,
  deriveRoomKeys,
  encryptBinaryV2,
  encryptTextV2,
  generateRoomSecret,
  parseInviteUrl,
  type Ctx,
} from './cryptoV2';
import {
  forgetAllRoomSecrets,
  forgetRoomSecret,
  getRoomSecret,
  saveRoomSecret,
} from './roomKeys';

const context: Ctx = { roomCode: 'TEST-ROOM', messageId: 'message-123', type: 'text' };

beforeAll(() => {
  // jsdom pode expor getRandomValues sem implementar subtle; use Web Crypto do Node só nos testes.
  vi.stubGlobal('crypto', webcrypto);
});

beforeEach(() => {
  localStorage.clear();
  forgetAllRoomSecrets();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('crypto v2', () => {
  it('faz roundtrip de texto Unicode e binário', async () => {
    const secret = generateRoomSecret();
    const plaintext = 'Olá, CipherLine! 🔐 ñ 漢字';
    const encryptedText = await encryptTextV2(plaintext, secret, context);
    expect(await decryptTextV2(encryptedText, secret, context)).toBe(plaintext);

    const input = new Uint8Array([0, 1, 127, 128, 255, 42]);
    const encryptedBinary = await encryptBinaryV2(input.buffer, secret, { ...context, type: 'audio' });
    const decryptedBinary = new Uint8Array(
      await decryptBinaryV2(encryptedBinary, secret, { ...context, type: 'audio' }),
    );
    expect(decryptedBinary).toEqual(input);
  });

  it('falha com contexto AAD diferente e com um byte adulterado', async () => {
    const secret = generateRoomSecret();
    const encrypted = await encryptTextV2('segredo', secret, context);
    await expect(decryptTextV2(encrypted, secret, { ...context, messageId: 'other-message' })).rejects.toThrow();
    await expect(decryptTextV2(encrypted, secret, { ...context, type: 'poll' })).rejects.toThrow();
    await expect(decryptTextV2(encrypted, secret, { ...context, roomCode: 'OTHER-ROOM' })).rejects.toThrow();

    const binaryContext = { ...context, type: 'image' as const };
    const encryptedBinary = new Uint8Array(await encryptBinaryV2(new Uint8Array([3, 4, 5]).buffer, secret, binaryContext));
    encryptedBinary[encryptedBinary.length - 1] ^= 1;
    await expect(decryptBinaryV2(encryptedBinary.buffer, secret, binaryContext)).rejects.toThrow();
  });

  it('não aceita prefixos de texto alterados nem cabeçalhos binários inválidos ou curtos', async () => {
    const secret = generateRoomSecret();
    const encrypted = await encryptTextV2('texto', secret, context);
    await expect(decryptTextV2(`x${encrypted.slice(1)}`, secret, context)).rejects.toThrow();
    await expect(decryptTextV2(encrypted.slice(3), secret, context)).rejects.toThrow();
    await expect(decryptBinaryV2(new Uint8Array([0x03, ...new Array(28).fill(0)]).buffer, secret, context)).rejects.toThrow();
    await expect(decryptBinaryV2(new Uint8Array([0x02, 1, 2]).buffer, secret, context)).rejects.toThrow();
  });

  it('separa as chaves de texto e mídia', async () => {
    const secret = generateRoomSecret();
    const textCipher = await encryptTextV2('texto', secret, context);
    const binaryCipher = await encryptBinaryV2(new Uint8Array([7, 8]).buffer, secret, context);
    const bytes = new Uint8Array(binaryCipher);
    const binaryPayload = bytes.subarray(1);
    const binaryString = Array.from(binaryPayload, (byte) => String.fromCharCode(byte)).join('');
    await expect(decryptTextV2(`v2.${btoa(binaryString)}`, secret, context)).rejects.toThrow();

    const encodedText = atob(textCipher.slice(3));
    const textPayload = new Uint8Array(encodedText.length + 1);
    textPayload[0] = 0x02;
    for (let index = 0; index < encodedText.length; index += 1) {
      textPayload[index + 1] = encodedText.charCodeAt(index);
    }
    await expect(decryptBinaryV2(textPayload.buffer, secret, context)).rejects.toThrow();
  });

  it('deriva joinToken determinístico, por sala, e distinto do segredo', async () => {
    const secret = generateRoomSecret();
    const first = await deriveRoomKeys(secret, 'ROOM-A');
    const again = await deriveRoomKeys(secret, 'ROOM-A');
    const otherRoom = await deriveRoomKeys(secret, 'ROOM-B');
    expect(first.joinToken).toBe(again.joinToken);
    expect(first.joinToken).not.toBe(otherRoom.joinToken);
    expect(first.joinToken).not.toBe(secret);
  });

  it('mantém as CryptoKeys não extraíveis', async () => {
    const keys = await deriveRoomKeys(generateRoomSecret(), 'ROOM-KEYS');
    expect(keys.text.extractable).toBe(false);
    expect(keys.media.extractable).toBe(false);
    expect(keys.text.algorithm.name).toBe('AES-GCM');
    expect(keys.media.algorithm.name).toBe('AES-GCM');
  });

  it('constrói e analisa convites e rejeita segredos inválidos', () => {
    const secret = generateRoomSecret();
    const invite = buildInviteUrl('https://cipherline.example', 'ROOM A', secret);
    expect(invite).toBe(`https://cipherline.example/?room=ROOM%20A#k=${secret}`);
    expect(parseInviteUrl(invite)).toEqual({ roomCode: 'ROOM A', secret });
    expect(parseInviteUrl('?room=ROOM%20A#k=' + secret)).toEqual({ roomCode: 'ROOM A', secret });
    expect(parseInviteUrl('?room=ROOM-A')).toEqual({ roomCode: 'ROOM-A', secret: null });
    expect(parseInviteUrl('not a url%')).toEqual({ roomCode: null, secret: null });

    for (const invalid of ['short', `${secret}a`, `${secret.slice(0, 21)}!`]) {
      expect(parseInviteUrl(`/?room=R#k=${invalid}`).secret).toBeNull();
      expect(() => buildInviteUrl('https://cipherline.example', 'R', invalid)).toThrow();
    }
  });

  it('gera 1000 segredos distintos', () => {
    const secrets = new Set(Array.from({ length: 1000 }, () => generateRoomSecret()));
    expect(secrets.size).toBe(1000);
    expect([...secrets].every((secret) => /^[A-Za-z0-9_-]{22}$/.test(secret))).toBe(true);
  });

  it('faz roundtrip de binário de 5 MB em blocos', async () => {
    const secret = generateRoomSecret();
    const source = new Uint8Array(5 * 1024 * 1024);
    for (let index = 0; index < source.length; index += 1) source[index] = (index * 31) % 256;
    const encrypted = await encryptBinaryV2(source.buffer, secret, { ...context, type: 'media' });
    const result = new Uint8Array(await decryptBinaryV2(encrypted, secret, { ...context, type: 'media' }));
    let matches = result.length === source.length;
    for (let index = 0; matches && index < source.length; index += 1) {
      if (result[index] !== source[index]) matches = false;
    }
    expect(matches).toBe(true);
  });

  it('usa IV aleatório em cada cifragem da mesma mensagem', async () => {
    const secret = generateRoomSecret();
    const first = await encryptTextV2('igual', secret, context);
    const second = await encryptTextV2('igual', secret, context);
    expect(second).not.toBe(first);
  });

  it('valida o segredo antes de o usar em todas as operações criptográficas', async () => {
    const invalid = 'A'.repeat(21);
    const error = await deriveRoomKeys(invalid, 'ROOM').catch((caught: Error) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).not.toContain(invalid);
    await expect(encryptTextV2('x', invalid, context)).rejects.toThrow();
    await expect(decryptTextV2('v2.AAAAAAAAAAAAAAAAAAAA', invalid, context)).rejects.toThrow();
    await expect(encryptBinaryV2(new ArrayBuffer(0), invalid, context)).rejects.toThrow();
    await expect(decryptBinaryV2(new Uint8Array([2, ...new Array(28).fill(0)]).buffer, invalid, context)).rejects.toThrow();
  });
});

describe('roomKeys', () => {
  it('guarda, recupera, valida e remove segredos da memória e do localStorage', () => {
    const secret = generateRoomSecret();
    saveRoomSecret('ROOM-1', secret);
    expect(getRoomSecret('ROOM-1')).toBe(secret);
    expect(localStorage.getItem('cipherline_rk2:ROOM-1')).toBe(secret);

    localStorage.setItem('cipherline_rk2:INVALID', 'valor-invalido');
    expect(getRoomSecret('INVALID')).toBeNull();
    forgetRoomSecret('ROOM-1');
    expect(getRoomSecret('ROOM-1')).toBeNull();
    expect(localStorage.getItem('cipherline_rk2:ROOM-1')).toBeNull();
  });

  it('remove todas as chaves com o prefixo de salas', () => {
    saveRoomSecret('ROOM-1', generateRoomSecret());
    localStorage.setItem('cipherline_rk2:STALE', 'invalid');
    localStorage.setItem('unrelated', 'keep');
    forgetAllRoomSecrets();
    expect(localStorage.getItem('cipherline_rk2:ROOM-1')).toBeNull();
    expect(localStorage.getItem('cipherline_rk2:STALE')).toBeNull();
    expect(localStorage.getItem('unrelated')).toBe('keep');
  });

  it('mantém o registo em memória se uma escrita no localStorage falhar', () => {
    const secret = generateRoomSecret();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage indisponível');
    });
    expect(() => saveRoomSecret('ROOM-MEMORY', secret)).not.toThrow();
    expect(getRoomSecret('ROOM-MEMORY')).toBe(secret);
  });
});
