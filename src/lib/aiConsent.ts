const AI_CONSENT_KEY = 'cipherline_ai_consent_v1';

export function hasAiConsent(): boolean {
  try {
    return localStorage.getItem(AI_CONSENT_KEY) === 'true';
  } catch {
    return false;
  }
}

export function grantAiConsent(): void {
  try {
    localStorage.setItem(AI_CONSENT_KEY, 'true');
  } catch {
    // Sem storage disponível, o consentimento não fica guardado.
  }
}

export function revokeAiConsent(): void {
  try {
    localStorage.removeItem(AI_CONSENT_KEY);
  } catch {
    // A ausência de storage não deve interromper as definições.
  }
}
