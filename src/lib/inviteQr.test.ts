import { describe, expect, it } from 'vitest';
import { buildInviteUrl, generateRoomSecret } from './cryptoV2';
import { renderInviteQrSvg } from './inviteQr';

describe('renderInviteQrSvg', () => {
  it('renders the invitation locally as a compact SVG without exposing the secret as text', async () => {
    const secret = generateRoomSecret();
    const svg = await renderInviteQrSvg(buildInviteUrl('https://cipherline.example', 'ROOM-1234', secret));

    expect(svg).toMatch(/^<svg\b/);
    expect(new TextEncoder().encode(svg).length).toBeLessThan(20_000);
    expect(svg).not.toContain(secret);
  });
});
