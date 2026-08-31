import { timelockEncrypt, timelockDecrypt, mainnetClient, roundAt, defaultChainInfo, Buffer } from 'tlock-js';

/**
 * Cifra um texto de forma que SÓ pode ser decifrado depois do horário
 * indicado — não por regra de aplicação, mas por matemática: a rede
 * pública drand só produz a "chave" daquele momento quando o tempo chega
 * de verdade, e nem ela mesma consegue prever isso antes da hora.
 *
 * unlockAt: instante futuro (Date) em que a cápsula pode ser aberta.
 */
export async function timelockEncryptText(plaintext: string, unlockAt: Date): Promise<string> {
  const roundNumber = roundAt(unlockAt.getTime(), defaultChainInfo);
  const payload = Buffer.from(plaintext, 'utf-8');
  return timelockEncrypt(roundNumber, payload, mainnetClient());
}

/**
 * Tenta decifrar uma cápsula do tempo. Lança erro se o horário ainda não
 * chegou (a rede drand ainda não gerou a randomização daquela rodada) —
 * quem chamar deve tratar isso como "ainda trancada", não como falha real.
 */
export async function timelockDecryptText(ciphertext: string): Promise<string> {
  const buf = await timelockDecrypt(ciphertext, mainnetClient());
  return buf.toString('utf-8');
}
