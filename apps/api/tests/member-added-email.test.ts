import { describe, expect, test, vi } from 'vitest';

vi.mock('../src/config', () => ({ config: { WEB_ORIGIN: 'https://app.example' } }));

import { memberAddedEmail } from '../src/lib/member-added-email';

describe('memberAddedEmail', () => {
  const mail = memberAddedEmail({
    ownerEmail: 'owner@example.com',
    recipient: 'new@example.com',
    websiteUrl: 'https://clewas.com',
  });

  test('subject names the website', () => {
    expect(mail.subject).toBe("You've been added to https://clewas.com on SEOPotion");
  });

  test('body says who added them, which address to sign in with, and links home', () => {
    expect(mail.text).toBe(
      [
        'owner@example.com added you to the SEOPotion workspace for https://clewas.com.',
        '',
        'Sign in with Google using this address (new@example.com) and the',
        'workspace will appear in your account:',
        '',
        'https://app.example/',
        '',
        "If you weren't expecting this, you can ignore this email.",
        '',
      ].join('\n'),
    );
  });
});
