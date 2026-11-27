import { describe, expect, it } from 'vitest';
import { buildRecentContext } from './eivorakContext';

describe('buildRecentContext', () => {
  it('devolve contexto vazio quando não foi pedido', () => {
    expect(buildRecentContext([{ senderNickname: 'Lia', plaintext: 'Olá' }], false)).toBe('');
  });

  it('preserva o formato actual quando o contexto é incluído', () => {
    expect(buildRecentContext([
      { senderNickname: 'Lia', plaintext: 'Olá' },
      { senderNickname: 'Miro', plaintext: 'Tudo bem?' },
    ], true)).toBe('Lia: Olá\nMiro: Tudo bem?');
  });
});
