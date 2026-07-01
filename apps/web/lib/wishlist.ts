import { createSupabaseServerClient } from './supabase/server';

export type WishlistSignupInput = {
  email: string;
  source?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  referrer?: string;
  honeypot?: string;
};

export class WishlistValidationError extends Error {
  constructor() {
    super('Invalid wishlist signup input.');
    this.name = 'WishlistValidationError';
  }
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_TEXT_LENGTH = 500;

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function optionalText(value: string | undefined) {
  if (!value) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  return trimmed.slice(0, MAX_TEXT_LENGTH);
}

export async function createOrUpdateWishlistSignup(input: WishlistSignupInput) {
  if (input.honeypot?.trim()) {
    return { ok: true };
  }

  const email = normalizeEmail(input.email);
  if (!EMAIL_PATTERN.test(email)) {
    throw new WishlistValidationError();
  }

  const supabase = createSupabaseServerClient();
  const { error } = await supabase.from('wishlist_signups').upsert(
    {
      email,
      source: optionalText(input.source),
      utm_source: optionalText(input.utmSource),
      utm_medium: optionalText(input.utmMedium),
      utm_campaign: optionalText(input.utmCampaign),
      referrer: optionalText(input.referrer),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'email' },
  );

  if (error) {
    console.error('Wishlist signup failed', {
      code: error.code,
      message: error.message,
    });
    throw new Error('Wishlist signup failed.');
  }

  return { ok: true };
}
