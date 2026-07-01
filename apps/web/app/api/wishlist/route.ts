import { NextResponse } from 'next/server';
import {
  createOrUpdateWishlistSignup,
  type WishlistSignupInput,
  WishlistValidationError,
} from '../../../lib/wishlist';

function parseBody(body: unknown): WishlistSignupInput {
  if (!body || typeof body !== 'object') {
    throw new WishlistValidationError();
  }

  const data = body as Record<string, unknown>;
  const honeypot = typeof data.honeypot === 'string' ? data.honeypot : undefined;

  if (honeypot?.trim() && typeof data.email !== 'string') {
    return {
      email: '',
      honeypot,
    };
  }

  if (typeof data.email !== 'string') {
    throw new WishlistValidationError();
  }

  return {
    email: data.email,
    source: typeof data.source === 'string' ? data.source : undefined,
    utmSource: typeof data.utmSource === 'string' ? data.utmSource : undefined,
    utmMedium: typeof data.utmMedium === 'string' ? data.utmMedium : undefined,
    utmCampaign: typeof data.utmCampaign === 'string' ? data.utmCampaign : undefined,
    referrer: typeof data.referrer === 'string' ? data.referrer : undefined,
    honeypot,
  };
}

export async function POST(request: Request) {
  try {
    let requestBody: unknown;
    try {
      requestBody = await request.json();
    } catch {
      throw new WishlistValidationError();
    }

    const body = parseBody(requestBody);
    await createOrUpdateWishlistSignup(body);

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof WishlistValidationError) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    console.error('Wishlist API error', error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
