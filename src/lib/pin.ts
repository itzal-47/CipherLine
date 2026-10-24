// Utility para gerir o PIN de Quick Lock de forma segura.
// Usa SHA-256 para nao guardar o PIN em texto claro no localStorage.

const PIN_HASH_KEY = 'cipherline_pin_hash';

async function hashPin(pin: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(pin);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function hasPin(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return !!localStorage.getItem(PIN_HASH_KEY);
}

export async function setPin(pin: string): Promise<void> {
  const hash = await hashPin(pin);
  localStorage.setItem(PIN_HASH_KEY, hash);
}

export async function verifyPin(pin: string): Promise<boolean> {
  const storedHash = localStorage.getItem(PIN_HASH_KEY);
  if (!storedHash) return false;
  const inputHash = await hashPin(pin);
  return storedHash === inputHash;
}

export function clearPin(): void {
  localStorage.removeItem(PIN_HASH_KEY);
}