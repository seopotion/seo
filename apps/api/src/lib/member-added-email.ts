import { config } from '../config';

/**
 * The one transactional email the app sends today (#336): "you were added to
 * a workspace". Plain text, English only — the recipient has not logged in yet,
 * so there is no locale to honour. Access does not depend on this mail.
 */
export function memberAddedEmail(input: {
  ownerEmail: string;
  recipient: string;
  websiteUrl: string;
}): { subject: string; text: string } {
  const { ownerEmail, recipient, websiteUrl } = input;
  return {
    subject: `You've been added to ${websiteUrl} on SEOPotion`,
    text: [
      `${ownerEmail} added you to the SEOPotion workspace for ${websiteUrl}.`,
      '',
      `Sign in with Google using this address (${recipient}) and the`,
      'workspace will appear in your account:',
      '',
      `${config.WEB_ORIGIN}/`,
      '',
      "If you weren't expecting this, you can ignore this email.",
      '',
    ].join('\n'),
  };
}
