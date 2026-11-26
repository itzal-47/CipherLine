import { describe, expect, it } from 'vitest';
import { buildInviteUrl, generateRoomSecret } from './cryptoV2';

describe('buildInviteUrl', () => {
  it('keeps the room secret only in the URL fragment', () => {
    const secret = generateRoomSecret();
    const invite = buildInviteUrl('https://cipherline.example', 'ROOM-1234', secret);
    const fragmentIndex = invite.indexOf('#');

    expect(fragmentIndex).toBeGreaterThan(-1);
    expect(invite.slice(fragmentIndex)).toBe(`#k=${secret}`);
    expect(invite.slice(0, fragmentIndex)).not.toContain(secret);
  });
});
