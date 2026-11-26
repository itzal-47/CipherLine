import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PARTICIPANT_COLUMNS, PROFILE_COLUMNS } from './columns';

describe('colunas permitidas para profiles e participants', () => {
  it('não pede colunas sensíveis', () => {
    const requestedColumns = [...Object.values(PROFILE_COLUMNS), ...Object.values(PARTICIPANT_COLUMNS)].join(',');
    expect(requestedColumns).not.toMatch(/\b(email|secret_hash|device_id)\b/i);
  });

  it('não usa relações embutidas com todas as colunas em src', () => {
    const srcDir = join(process.cwd(), 'src');
    const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return files(path);
      return entry.isFile() && !entry.name.endsWith('.test.ts') ? [path] : [];
    });
    for (const file of files(srcDir)) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/(?:profiles|participants)\s*\(\s*\*\s*\)/);
    }
  });
});
