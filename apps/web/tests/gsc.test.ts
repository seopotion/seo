import { describe, expect, test } from 'vitest';
import { type GscSite, matchGscProperty } from '../lib/gsc-match';

function site(site_url: string): GscSite {
  return { site_url, permission_level: 'siteOwner' };
}

describe('matchGscProperty', () => {
  test('matches an sc-domain property whose domain equals the host', () => {
    expect(matchGscProperty('https://clewas.com', [site('sc-domain:clewas.com')])).toBe(
      'sc-domain:clewas.com',
    );
  });

  test('matches an sc-domain property for a subdomain of the site', () => {
    expect(matchGscProperty('https://blog.x.com', [site('sc-domain:x.com')])).toBe(
      'sc-domain:x.com',
    );
  });

  test('strips www on both the website and the property host', () => {
    expect(matchGscProperty('https://www.x.com', [site('https://x.com/')])).toBe('https://x.com/');
    expect(matchGscProperty('https://x.com', [site('https://www.x.com/')])).toBe(
      'https://www.x.com/',
    );
  });

  test('prefers an sc-domain match over a URL-prefix match', () => {
    const sites = [site('https://x.com/'), site('sc-domain:x.com')];
    expect(matchGscProperty('https://x.com', sites)).toBe('sc-domain:x.com');
  });

  test('falls back to a URL-prefix host match when no sc-domain matches', () => {
    const sites = [site('sc-domain:other.com'), site('https://x.com/')];
    expect(matchGscProperty('https://x.com', sites)).toBe('https://x.com/');
  });

  test('returns null when nothing matches', () => {
    expect(matchGscProperty('https://x.com', [site('sc-domain:other.com')])).toBeNull();
  });

  test('returns null for an unparseable website URL', () => {
    expect(matchGscProperty('not a url', [site('sc-domain:x.com')])).toBeNull();
  });
});
