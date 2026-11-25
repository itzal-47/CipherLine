import { decryptText, encryptText } from './crypto';
import { DECRYPT_FAILED, NO_KEY, decryptTextV2, deriveRoomKeys, encryptTextV2, type MsgType } from './cryptoV2';
import { forgetAllRoomSecrets } from './roomKeys';

type CryptoVersion = 1 | 2;

export function createRoomCrypto(options: { roomCode: string; cryptoVersion: CryptoVersion; secret: string | null }) {
  const secret = options.secret;
  return {
    hasKey: options.cryptoVersion === 1 || Boolean(secret),
    encryptText: async (plaintext: string, context: { messageId: string; type: MsgType }) => {
      if (options.cryptoVersion === 1) return encryptText(plaintext, options.roomCode);
      if (!secret) return NO_KEY;
      return encryptTextV2(plaintext, secret, { roomCode: options.roomCode, ...context });
    },
    decryptText: async (ciphertext: string, context: { messageId: string; type: MsgType }) => {
      if (options.cryptoVersion === 1) return decryptText(ciphertext, options.roomCode);
      if (!secret) return NO_KEY;
      try {
        return await decryptTextV2(ciphertext, secret, { roomCode: options.roomCode, ...context });
      } catch {
        return DECRYPT_FAILED;
      }
    },
  };
}

export async function getJoinToken(roomCode: string, secret: string): Promise<string> {
  return (await deriveRoomKeys(secret, roomCode)).joinToken;
}

export { DECRYPT_FAILED, NO_KEY };

export function panicWipeCrypto(): void {
  forgetAllRoomSecrets();
}
