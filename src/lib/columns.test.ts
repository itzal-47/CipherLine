import { describe, expect, it } from 'vitest';
import { PARTICIPANT_COLUMNS, PROFILE_COLUMNS } from './columns';

describe('colunas permitidas para profiles e participants', () => {
  it('não pede colunas sensíveis', () => {
    const requestedColumns = [...Object.values(PROFILE_COLUMNS), ...Object.values(PARTICIPANT_COLUMNS)].join(',');
    expect(requestedColumns).not.toMatch(/\b(email|secret_hash|device_id)\b/i);
  });
});
