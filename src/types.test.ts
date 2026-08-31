import { describe, it, expect } from 'vitest';
import { createBurnConfig, burnConfigToJson, jsonToBurnConfig, BURN_PRESETS } from './types';

describe('createBurnConfig', () => {
  it('maps known presets to their correct duration in seconds', () => {
    expect(createBurnConfig('off')).toEqual({ mode: 'off', seconds: 0 });
    expect(createBurnConfig('on_read')).toEqual({ mode: 'on_read', seconds: 6 });
    expect(createBurnConfig('24h')).toEqual({ mode: '24h', seconds: 86400 });
    expect(createBurnConfig('7d')).toEqual({ mode: '7d', seconds: 604800 });
  });

  it('uses the custom seconds value when mode is custom', () => {
    expect(createBurnConfig('custom', 120)).toEqual({ mode: 'custom', seconds: 120 });
  });

  it('falls back to 0 seconds for custom mode without a value', () => {
    expect(createBurnConfig('custom')).toEqual({ mode: 'custom', seconds: 0 });
  });

  it('BURN_PRESETS values stay consistent with real-world durations', () => {
    expect(BURN_PRESETS['24h']).toBe(24 * 60 * 60);
    expect(BURN_PRESETS['7d']).toBe(7 * 24 * 60 * 60);
  });
});

describe('burnConfigToJson / jsonToBurnConfig round trip', () => {
  it('round-trips a burn config through JSON correctly', () => {
    const config = createBurnConfig('7d');
    const json = burnConfigToJson(config);
    const parsed = jsonToBurnConfig(JSON.parse(json));
    expect(parsed).toEqual(config);
  });

  it('returns null for invalid/missing input', () => {
    expect(jsonToBurnConfig(null)).toBeNull();
    expect(jsonToBurnConfig(undefined)).toBeNull();
    expect(jsonToBurnConfig('not an object')).toBeNull();
    expect(jsonToBurnConfig({})).toBeNull();
    expect(jsonToBurnConfig({ mode: 'off' })).toBeNull(); // falta seconds
  });

  it('accepts a well-formed object even without going through JSON.stringify first', () => {
    const parsed = jsonToBurnConfig({ mode: 'custom', seconds: 42 });
    expect(parsed).toEqual({ mode: 'custom', seconds: 42 });
  });
});
