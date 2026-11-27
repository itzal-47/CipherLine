import { describe, expect, it } from 'vitest';
import { friendlyEivorakError } from './eivorakErrors';

describe('friendlyEivorakError', () => {
  it('shows the rate limit message for HTTP 429', () => {
    expect(friendlyEivorakError({ context: { status: 429 } }, null))
      .toBe('EIVORAK: LIMITE DE USO ATINGIDO. TENTA MAIS TARDE.');
  });

  it('shows the invalid room session message for HTTP 401', () => {
    expect(friendlyEivorakError({ context: { status: 401 } }, null))
      .toBe('EIVORAK: SESSÃO DA SALA INVÁLIDA. ENTRA NA SALA DE NOVO.');
  });

  it('shows the oversized request message for HTTP 413', () => {
    expect(friendlyEivorakError({ context: { status: 413 } }, null))
      .toBe('EIVORAK: PEDIDO DEMASIADO GRANDE.');
  });

  it('uses the generic message for an unknown error', () => {
    expect(friendlyEivorakError({}, null))
      .toBe('EIVORAK NÃO RESPONDEU — TENTE DE NOVO');
  });
});
