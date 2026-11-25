import { webcrypto } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createRoomCrypto, DECRYPT_FAILED, NO_KEY } from './roomCryptoClient';
import { generateRoomSecret } from './cryptoV2';

beforeAll(() => {
  vi.stubGlobal('crypto', webcrypto);
});

describe('roomCryptoClient', () => {
  it('returns NO_KEY when v2 has no room secret', async () => {
    const roomCrypto = createRoomCrypto({ roomCode: 'TEST-ROOM', cryptoVersion: 2, secret: null });

    expect(roomCrypto.hasKey).toBe(false);
    await expect(roomCrypto.encryptText('texto', { messageId: 'message-1', type: 'text' })).resolves.toBe(NO_KEY);
    await expect(roomCrypto.decryptText('ciphertext', { messageId: 'message-1', type: 'text' })).resolves.toBe(NO_KEY);
  });

  it('binds v2 text to the room, message ID and type', async () => {
    const roomCrypto = createRoomCrypto({ roomCode: 'TEST-ROOM', cryptoVersion: 2, secret: generateRoomSecret() });
    const context = { messageId: 'message-1', type: 'text' as const };
    const ciphertext = await roomCrypto.encryptText('mensagem privada', context);

    await expect(roomCrypto.decryptText(ciphertext, context)).resolves.toBe('mensagem privada');
    await expect(roomCrypto.decryptText(ciphertext, { ...context, messageId: 'message-2' })).resolves.toBe(DECRYPT_FAILED);
  });
});
