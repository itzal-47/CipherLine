import { afterEach, describe, expect, it, vi } from 'vitest';
import { grantAiConsent, hasAiConsent, revokeAiConsent } from './aiConsent';

describe('consentimento do EiVORAK', () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('guarda e retira o consentimento na chave versionada', () => {
    expect(hasAiConsent()).toBe(false);
    grantAiConsent();
    expect(localStorage.getItem('cipherline_ai_consent_v1')).toBe('true');
    expect(hasAiConsent()).toBe(true);
    revokeAiConsent();
    expect(hasAiConsent()).toBe(false);
  });

  it('devolve false e não lança quando o storage falha', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('storage indisponível'); });
    expect(hasAiConsent()).toBe(false);
  });
});
