import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, test, vi } from 'vitest';

const { getParameter, secrets } = vi.hoisted(() => {
  const secrets: Record<string, string> = {
    '/seo/test/ls-api-key': 'key-1',
    '/seo/test/ls-webhook-secret': 'wh-secret-a',
  };
  return { getParameter: vi.fn(async (name: string) => secrets[name]), secrets };
});
vi.mock('@aws-lambda-powertools/parameters/ssm', () => ({ getParameter }));

vi.mock('../src/config', () => ({
  config: {
    LEMONSQUEEZY_API_KEY_PARAM: '/seo/test/ls-api-key',
    LEMONSQUEEZY_API_KEY: '',
    LEMONSQUEEZY_WEBHOOK_SECRET_PARAM: '/seo/test/ls-webhook-secret',
    LEMONSQUEEZY_WEBHOOK_SECRET: '',
    LEMONSQUEEZY_STORE_ID: '111',
    LEMONSQUEEZY_VARIANT_PAID: '201',
    LEMONSQUEEZY_VARIANT_EXPERT: '202',
    WEB_ORIGIN: 'https://app.example.com',
  },
}));

import { getBillingProvider } from '../src/clients/billing';

const sign = (body: string, secret: string) =>
  createHmac('sha256', secret).update(body).digest('hex');

describe('getBillingProvider', () => {
  afterEach(() => vi.restoreAllMocks());

  test('uses the currently resolved secrets, so SSM rotation applies without a restart', async () => {
    const body = '{"meta":{}}';
    const before = await getBillingProvider();
    expect(before.verifyWebhook(body, sign(body, 'wh-secret-a'))).toBe(true);

    // Rotate the SecureString: once Powertools' cache expires, getParameter
    // returns the new value — the provider must pick it up.
    secrets['/seo/test/ls-webhook-secret'] = 'wh-secret-b';
    const after = await getBillingProvider();
    expect(after.verifyWebhook(body, sign(body, 'wh-secret-b'))).toBe(true);
  });

  test('checkout redirects back to the billing activation page for this deployment', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: { attributes: { url: 'https://ls/checkout/x' } } }), {
        status: 201,
      }),
    );
    const provider = await getBillingProvider();
    await provider.createCheckout({ tier: 'paid', orgId: 'o1', userEmail: 'u@e.com' });
    const [, init] = fetchMock.mock.calls[0]!;
    const sent = JSON.parse(String(init?.body));
    expect(sent.data.attributes.product_options.redirect_url).toBe(
      'https://app.example.com/billing?checkout=success',
    );
  });
});
