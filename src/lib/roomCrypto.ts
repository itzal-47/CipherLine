import {
  DECRYPT_FAILED as V2_DECRYPT_FAILED,
  NO_KEY,
  V2_PREFIX,
  decryptBinaryV2,
  decryptTextV2,
  deriveRoomKeys,
  encryptBinaryV2,
  encryptTextV2,
  isValidRoomSecret,
  type MsgType,
} from './cryptoV2';
import {
  clearCachedKey,
  decryptBinary as decryptBinaryV1,
  decryptText as decryptTextV1,
  encryptBinary as encryptBinaryV1,
  encryptText as encryptTextV1,
} from './crypto';
import { forgetAllRoomSecrets } from './roomKeys';

export interface MsgCtx {
  messageId: string;
  type: MsgType;
}

export interface RoomCrypto {
  readonly version: 1 | 2;
  readonly hasKey: boolean;
  encryptText(plaintext: string, ctx: MsgCtx): Promise<string>;
  decryptText(ciphertext: string, ctx: MsgCtx): Promise<string>;
  encryptBinary(data: ArrayBuffer, ctx: MsgCtx): Promise<ArrayBuffer>;
  decryptBinary(data: ArrayBuffer, ctx: MsgCtx): Promise<ArrayBuffer>;
}

export function createRoomCrypto(opts: {
  roomCode: string;
  cryptoVersion: 1 | 2;
  secret?: string | null;
}): RoomCrypto {
  const { roomCode, cryptoVersion } = opts;
  const secret = cryptoVersion === 2 && isValidRoomSecret(opts.secret) ? opts.secret : null;
  const ctxForRoom = (ctx: MsgCtx) => ({ ...ctx, roomCode });

  if (cryptoVersion === 1) {
    return {
      version: 1,
      hasKey: true,
      encryptText: (plaintext) => encryptTextV1(plaintext, roomCode),
      async decryptText(ciphertext) {
        if (ciphertext.startsWith(V2_PREFIX)) return V2_DECRYPT_FAILED;
        const plaintext = await decryptTextV1(ciphertext, roomCode);
        return plaintext === V2_DECRYPT_FAILED ? V2_DECRYPT_FAILED : plaintext;
      },
      encryptBinary: (data) => encryptBinaryV1(data, roomCode),
      decryptBinary: (data) => decryptBinaryV1(data, roomCode),
    };
  }

  return {
    version: 2,
    hasKey: secret !== null,
    async encryptText(plaintext, ctx) {
      if (secret === null) throw new Error('NO_KEY');
      return encryptTextV2(plaintext, secret, ctxForRoom(ctx));
    },
    async decryptText(ciphertext, ctx) {
      if (secret === null) return NO_KEY;
      if (!ciphertext.startsWith(V2_PREFIX)) return V2_DECRYPT_FAILED;
      try {
        return await decryptTextV2(ciphertext, secret, ctxForRoom(ctx));
      } catch {
        return V2_DECRYPT_FAILED;
      }
    },
    async encryptBinary(data, ctx) {
      if (secret === null) throw new Error('NO_KEY');
      return encryptBinaryV2(data, secret, ctxForRoom(ctx));
    },
    async decryptBinary(data, ctx) {
      if (secret === null) throw new Error('NO_KEY');
      return decryptBinaryV2(data, secret, ctxForRoom(ctx));
    },
  };
}

export async function getJoinToken(roomCode: string, secret: string): Promise<string> {
  return (await deriveRoomKeys(secret, roomCode)).joinToken;
}

export function panicWipeCrypto(): void {
  clearCachedKey();
  forgetAllRoomSecrets();
}

