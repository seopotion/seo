import { describe, expect, test } from 'vitest';
import { INTEGRATION_PROVIDERS, IntegrationSchema } from '../src/integration';
import { ONBOARDING_INTEGRATIONS } from '../src/org';

const base = {
  id: 'int_1',
  org_id: 'org_1',
  connected_at: new Date('2026-07-30T10:00:00.000Z'),
};

const wordpress = {
  ...base,
  provider: 'wordpress',
  site_url: 'https://clewas.com',
  token_enc: 'base64-ciphertext',
};

const staticSite = {
  ...base,
  provider: 'static-site',
  host: 'github',
  installation_id: 12345,
  repo: 'unmarble/unmarble-website',
  branch: 'main',
  content_path: 'seopotion/',
};

describe('IntegrationSchema', () => {
  test('parses each provider and defaults last_error to null', () => {
    expect(IntegrationSchema.parse(wordpress)).toMatchObject({
      provider: 'wordpress',
      token_enc: 'base64-ciphertext',
      last_error: null,
    });
    expect(IntegrationSchema.parse(staticSite)).toMatchObject({
      provider: 'static-site',
      repo: 'unmarble/unmarble-website',
      last_error: null,
    });
  });

  test('the union keeps provider fields apart', () => {
    // The discriminator picks exactly one member, so WordPress fields do not
    // satisfy a static-site row — or the reverse.
    const { provider: _p, ...wordpressFields } = wordpress;
    expect(() =>
      IntegrationSchema.parse({ ...wordpressFields, provider: 'static-site' }),
    ).toThrow();
    expect(() => IntegrationSchema.parse({ ...base, provider: 'wordpress' })).toThrow();
    // Onboarding-only platforms are not connectable.
    expect(() => IntegrationSchema.parse({ ...base, provider: 'framer' })).toThrow();
  });

  test('rejects an installation id that cannot be one', () => {
    expect(() => IntegrationSchema.parse({ ...staticSite, installation_id: 0 })).toThrow();
    expect(() => IntegrationSchema.parse({ ...staticSite, installation_id: 1.5 })).toThrow();
  });

  test('every connectable provider is selectable at onboarding', () => {
    // One-directional invariant (design/integrations-model.md § Onboarding vs.
    // connected): onboarding also lists platforms we cannot write to.
    for (const provider of INTEGRATION_PROVIDERS) {
      expect(ONBOARDING_INTEGRATIONS).toContain(provider);
    }
  });
});
