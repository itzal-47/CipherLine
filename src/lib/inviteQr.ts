/** QR rendering is loaded only when the person asks to show the code. */
export async function renderInviteQrSvg(url: string): Promise<string> {
  const { renderSVG } = await import('uqr');
  return renderSVG(url, { ecc: 'M', border: 2 });
}
