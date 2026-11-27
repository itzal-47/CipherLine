const GENERIC_EIVORAK_ERROR = 'EIVORAK NÃO RESPONDEU — TENTE DE NOVO';

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : null;
}

export function friendlyEivorakError(error: unknown, data: unknown): string {
  const context = asRecord(asRecord(error)?.context);
  const status = context?.status;
  const responseData = asRecord(data);
  const errorCode = responseData?.error;

  if (status === 429 || errorCode === 'RATE_LIMIT' || errorCode === 'GLOBAL_LIMIT') {
    return 'EIVORAK: LIMITE DE USO ATINGIDO. TENTA MAIS TARDE.';
  }
  if (status === 401 || errorCode === 'UNAUTHORIZED') {
    return 'EIVORAK: SESSÃO DA SALA INVÁLIDA. ENTRA NA SALA DE NOVO.';
  }
  if (status === 413) {
    return 'EIVORAK: PEDIDO DEMASIADO GRANDE.';
  }

  const detail = responseData?.error ?? asRecord(error)?.message;
  return typeof detail === 'string' && detail.length > 0
    ? `EIVORAK: ${detail.slice(0, 80)}`
    : GENERIC_EIVORAK_ERROR;
}
