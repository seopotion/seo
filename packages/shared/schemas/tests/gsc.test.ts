import { describe, expect, test } from 'vitest';
import { GscConnectionSchema, isGscConnected } from '../src/gsc';

const base = {
  id: 'c1',
  org_id: 'org_1',
  refresh_token_enc: 'ZW5j',
  site_url: 'sc-domain:clewas.com',
  google_email: 'owner@clewas.com',
  connected_at: new Date(),
  last_refresh_failed_at: null,
};

describe('GscConnectionSchema', () => {
  test('parses a complete connection', () => {
    expect(GscConnectionSchema.parse(base).site_url).toBe('sc-domain:clewas.com');
  });

  test('site_url and last_refresh_failed_at are nullable, not optional', () => {
    expect(GscConnectionSchema.parse({ ...base, site_url: null }).site_url).toBeNull();
    expect(() => GscConnectionSchema.parse({ ...base, site_url: undefined })).toThrow();
  });
});

describe('isGscConnected', () => {
  test('true only for a complete, healthy connection', () => {
    expect(isGscConnected(GscConnectionSchema.parse(base))).toBe(true);
  });

  test('false for null, pending site pick, or failed refresh', () => {
    expect(isGscConnected(null)).toBe(false);
    expect(isGscConnected(GscConnectionSchema.parse({ ...base, site_url: null }))).toBe(false);
    expect(
      isGscConnected(GscConnectionSchema.parse({ ...base, last_refresh_failed_at: new Date() })),
    ).toBe(false);
  });
});
