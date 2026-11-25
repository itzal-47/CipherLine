const STORAGE_PREFIX = 'cipherline_rk2:';
const SECRET_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const roomSecrets = new Map<string, string>();

function isValidSecret(secret: unknown): secret is string {
  if (typeof secret !== 'string' || !SECRET_PATTERN.test(secret)) return false;
  try {
    const base64 = secret.replace(/-/g, '+').replace(/_/g, '/') + '==';
    const binary = atob(base64);
    return binary.length === 16;
  } catch {
    return false;
  }
}

function getStorage(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function saveRoomSecret(code: string, secret: string): void {
  if (!isValidSecret(secret)) throw new Error('Segredo inválido.');
  roomSecrets.set(code, secret);
  try {
    getStorage()?.setItem(`${STORAGE_PREFIX}${code}`, secret);
  } catch {
    // O registo em memória continua disponível quando o armazenamento é bloqueado.
  }
}

export function getRoomSecret(code: string): string | null {
  const inMemory = roomSecrets.get(code);
  if (inMemory !== undefined) return isValidSecret(inMemory) ? inMemory : null;

  let storedValue: string | null = null;
  try {
    storedValue = getStorage()?.getItem(`${STORAGE_PREFIX}${code}`) ?? null;
  } catch {
    return null;
  }

  if (!isValidSecret(storedValue)) return null;
  roomSecrets.set(code, storedValue);
  return storedValue;
}

export function forgetRoomSecret(code: string): void {
  roomSecrets.delete(code);
  try {
    getStorage()?.removeItem(`${STORAGE_PREFIX}${code}`);
  } catch {
    // A remoção em memória ainda é aplicada quando o armazenamento é bloqueado.
  }
}

export function forgetAllRoomSecrets(): void {
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

