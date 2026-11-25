import { clearDerivedKeyCache, isValidRoomSecret } from './cryptoV2';

const STORAGE_PREFIX = 'cipherline_rk2:';
const roomSecrets = new Map<string, string>();

function getStorage(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function saveRoomSecret(code: string, secret: string): void {
  if (!isValidRoomSecret(secret)) throw new Error('Segredo inválido.');
  roomSecrets.set(code, secret);
  try {
    getStorage()?.setItem(`${STORAGE_PREFIX}${code}`, secret);
  } catch {
    // O registo em memória continua disponível quando o armazenamento é bloqueado.
  }
}

export function getRoomSecret(code: string): string | null {
  const inMemory = roomSecrets.get(code);
  if (inMemory !== undefined) return isValidRoomSecret(inMemory) ? inMemory : null;

  let storedValue: string | null = null;
  try {
    storedValue = getStorage()?.getItem(`${STORAGE_PREFIX}${code}`) ?? null;
  } catch {
    return null;
  }

  if (!isValidRoomSecret(storedValue)) return null;
  roomSecrets.set(code, storedValue);
  return storedValue;
}

export function forgetRoomSecret(code: string): void {
  clearDerivedKeyCache();
  roomSecrets.delete(code);
  try {
    getStorage()?.removeItem(`${STORAGE_PREFIX}${code}`);
  } catch {
    // A remoção em memória ainda é aplicada quando o armazenamento é bloqueado.
  }
}

export function forgetAllRoomSecrets(): void {
  clearDerivedKeyCache();
  roomSecrets.clear();
  try {
    const storage = getStorage();
    if (!storage) return;

    const keysToRemove: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      try {
        const key = storage.key(index);
        if (key?.startsWith(STORAGE_PREFIX)) keysToRemove.push(key);
      } catch {
        // Continua a tentar apagar as restantes entradas.
      }
    }
    for (const key of keysToRemove) {
      try {
        storage.removeItem(key);
      } catch {
        // Uma falha de armazenamento não impede as restantes remoções.
      }
    }
  } catch {
    // localStorage pode estar indisponível, por exemplo em modo privado.
  }
}

