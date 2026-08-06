import { afterEach, describe, expect, it, vi } from 'vitest';
import robots from '../app/robots';

describe('robots', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('disallows everything when NEXT_PUBLIC_NOINDEX is set', () => {
    vi.stubEnv('NEXT_PUBLIC_NOINDEX', '1');
    expect(robots().rules).toEqual({ userAgent: '*', disallow: '/' });
  });

  it('allows the public tree by default', () => {
    const result = robots();
    expect(result.rules).toMatchObject({ userAgent: '*', allow: '/' });
    expect(result.sitemap).toContain('/sitemap.xml');
  });
});
