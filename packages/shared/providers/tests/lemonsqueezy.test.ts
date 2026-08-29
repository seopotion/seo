import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createLemonSqueezyProvider } from '../src/billing/lemonsqueezy';

const cfg = {
  apiKey: 'test-key',
  webhookSecret: 'whsec_test',
  storeId: '111',
  variantByTier: { paid: '201', expert: '202' } as const,
  redirectUrl: 'https://app.example.com/billing?checkout=success',
};
const provider = createLemonSqueezyProvider(cfg);

const sign = (body: string) => createHmac('sha256', cfg.webhookSecret).update(body).digest('hex');

// Minimal LS webhook body: meta.event_name + meta.custom_data + data.
const wh = (over: {
  event: string;
  variantId?: string;
  status?: string;
  orgId?: string;
  subId?: string;
  customerId?: number;
  renewsAt?: string | null;
}) =>
  JSON.stringify({
    meta: {
      event_name: over.event,
      custom_data: over.orgId ? { org_id: over.orgId } : undefined,
    },
    data: {
      id: over.subId ?? 'sub_1',
      attributes: {
        customer_id: over.customerId ?? 55,
        variant_id: Number(over.variantId ?? '201'),
        status: over.status ?? 'active',
        renews_at: over.renewsAt === undefined ? '2026-08-22T00:00:00.000000Z' : over.renewsAt,
      },
    },
  });

describe('lemonsqueezy verifyWebhook', () => {
  test('accepts a correct signature', () => {
    const body = wh({ event: 'subscription_created', orgId: 'o1' });
    expect(provider.verifyWebhook(body, sign(body))).toBe(true);
  });
  test('rejects a tampered body', () => {
    const body = wh({ event: 'subscription_created', orgId: 'o1' });
    expect(provider.verifyWebhook(`${body} `, sign(body))).toBe(false);
  });
  test('rejects a wrong secret', () => {
    const body = wh({ event: 'subscription_created', orgId: 'o1' });
    const bad = createHmac('sha256', 'nope').update(body).digest('hex');
    expect(provider.verifyWebhook(body, bad)).toBe(false);
  });
});

describe('lemonsqueezy parseWebhookEvent', () => {
  test('subscription_created -> activated with tier from variant + orgId', () => {
    const e = provider.parseWebhookEvent(
      wh({
        event: 'subscription_created',
        variantId: '202',
        orgId: 'o1',
        subId: 'sub_9',
        customerId: 7,
      }),
    );
    expect(e).toEqual({
      type: 'subscription_activated',
      orgId: 'o1',
      providerCustomerId: '7',
      providerSubscriptionId: 'sub_9',
      tier: 'expert',
      currentPeriodEnd: new Date('2026-08-22T00:00:00.000000Z'),
    });
  });
  test('subscription_updated past_due -> updated with mapped status', () => {
    const e = provider.parseWebhookEvent(
      wh({ event: 'subscription_updated', variantId: '201', status: 'past_due', subId: 'sub_9' }),
    );
    expect(e).toMatchObject({
      type: 'subscription_updated',
      providerSubscriptionId: 'sub_9',
      tier: 'paid',
      status: 'past_due',
    });
  });
  test('subscription_cancelled -> cancelled (sub id only)', () => {
    const e = provider.parseWebhookEvent(wh({ event: 'subscription_cancelled', subId: 'sub_9' }));
    expect(e).toEqual({ type: 'subscription_cancelled', providerSubscriptionId: 'sub_9' });
  });
  test('subscription_expired -> expired', () => {
    const e = provider.parseWebhookEvent(wh({ event: 'subscription_expired', subId: 'sub_9' }));
    expect(e).toEqual({ type: 'subscription_expired', providerSubscriptionId: 'sub_9' });
  });
  test('unknown variant -> null', () => {
    expect(
      provider.parseWebhookEvent(
        wh({ event: 'subscription_created', variantId: '999', orgId: 'o1' }),
      ),
    ).toBeNull();
  });
  test('unhandled event name -> null', () => {
    expect(provider.parseWebhookEvent(wh({ event: 'order_created' }))).toBeNull();
  });
  test('malformed payloads -> null, never a throw', () => {
    expect(provider.parseWebhookEvent('not json at all')).toBeNull();
    expect(provider.parseWebhookEvent('{}')).toBeNull();
    expect(provider.parseWebhookEvent('{"meta":{},"data":{}}')).toBeNull();
    expect(provider.parseWebhookEvent('null')).toBeNull();
  });
  test('null renews_at on updated (e.g. cancelled) -> event without currentPeriodEnd', () => {
    const e = provider.parseWebhookEvent(
      wh({ event: 'subscription_updated', status: 'cancelled', subId: 'sub_9', renewsAt: null }),
    );
    expect(e).toEqual({
      type: 'subscription_updated',
      providerSubscriptionId: 'sub_9',
      tier: 'paid',
      status: 'cancelled',
      currentPeriodEnd: undefined,
    });
  });
  test('missing/invalid renews_at on created -> null (never store a garbage period end)', () => {
    expect(
      provider.parseWebhookEvent(
        wh({ event: 'subscription_created', orgId: 'o1', renewsAt: null }),
      ),
    ).toBeNull();
  });
});

describe('lemonsqueezy cancelSubscription', () => {
  afterEach(() => vi.restoreAllMocks());
  test('DELETEs the subscription', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 200 }));
    await provider.cancelSubscription('sub_9');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://api.lemonsqueezy.com/v1/subscriptions/sub_9');
    expect(init?.method).toBe('DELETE');
  });
  test('throws on a non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 404 }));
    await expect(provider.cancelSubscription('sub_9')).rejects.toThrow(
      'LemonSqueezy subscription cancel failed: 404',
    );
  });
});

describe('lemonsqueezy createCheckout', () => {
  afterEach(() => vi.restoreAllMocks());
  test('POSTs a checkout with org_id in custom data and returns the url', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: { attributes: { url: 'https://ls/checkout/abc' } } }), {
        status: 201,
      }),
    );
    const { url } = await provider.createCheckout({
      tier: 'paid',
      orgId: 'o1',
      userEmail: 'u@e.com',
    });
    expect(url).toBe('https://ls/checkout/abc');
    const [, init] = fetchMock.mock.calls[0]!;
    const sent = JSON.parse(String(init?.body));
    expect(sent.data.attributes.checkout_data.custom).toEqual({ org_id: 'o1' });
    expect(sent.data.attributes.checkout_data.email).toBe('u@e.com');
    expect(sent.data.attributes.product_options.redirect_url).toBe(cfg.redirectUrl);
    expect(sent.data.relationships.variant.data.id).toBe('201');
  });
});

describe('lemonsqueezy createCheckout (discounts)', () => {
  afterEach(() => vi.restoreAllMocks());

  const okCheckout = () =>
    new Response(JSON.stringify({ data: { attributes: { url: 'https://ls/checkout/x' } } }), {
      status: 201,
    });

  test('always disables the hosted discount field; passes discount_code when given', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okCheckout());
    await provider.createCheckout({
      tier: 'paid',
      orgId: 'o1',
      userEmail: 'a@b.c',
      discountCode: 'LAUNCH30',
    });
    const body = JSON.parse(String(spy.mock.calls[0]?.[1]?.body));
    expect(body.data.attributes.checkout_options).toEqual({ discount: false });
    expect(body.data.attributes.checkout_data.discount_code).toBe('LAUNCH30');
  });

  test('omits discount_code when no code is applied (field still disabled)', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okCheckout());
    await provider.createCheckout({ tier: 'paid', orgId: 'o1', userEmail: 'a@b.c' });
    const body = JSON.parse(String(spy.mock.calls[0]?.[1]?.body));
    expect(body.data.attributes.checkout_options).toEqual({ discount: false });
    expect('discount_code' in body.data.attributes.checkout_data).toBe(false);
  });
});

describe('lemonsqueezy createDiscount / deleteDiscount', () => {
  afterEach(() => vi.restoreAllMocks());

  test('createDiscount maps repeating fields and limits; returns the LS id', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ data: { id: 'disc_9' } }), { status: 201 }));
    const res = await provider.createDiscount({
      name: 'Launch promo',
      code: 'LAUNCH30',
      percent: 30,
      duration: 'repeating',
      durationInMonths: 3,
      maxRedemptions: 50,
      expiresAt: new Date('2026-12-31T00:00:00Z'),
    });
    expect(res).toEqual({ providerDiscountId: 'disc_9' });
    const [url, init] = spy.mock.calls[0] ?? [];
    expect(String(url)).toBe('https://api.lemonsqueezy.com/v1/discounts');
    const attrs = JSON.parse(String(init?.body)).data.attributes;
    expect(attrs).toEqual({
      name: 'Launch promo',
      code: 'LAUNCH30',
      amount: 30,
      amount_type: 'percent',
      duration: 'repeating',
      duration_in_months: 3,
      is_limited_redemptions: true,
      max_redemptions: 50,
      expires_at: '2026-12-31T00:00:00.000Z',
    });
    expect(JSON.parse(String(init?.body)).data.relationships.store.data.id).toBe(cfg.storeId);
  });

  test('createDiscount forever/unlimited sends no months/limits keys', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { id: 'disc_10' } }), { status: 201 }),
      );
    await provider.createDiscount({
      name: 'Team free',
      code: 'TEAMFREE',
      percent: 100,
      duration: 'forever',
    });
    const attrs = JSON.parse(String(spy.mock.calls[0]?.[1]?.body)).data.attributes;
    expect(attrs).toEqual({
      name: 'Team free',
      code: 'TEAMFREE',
      amount: 100,
      amount_type: 'percent',
      duration: 'forever',
    });
  });

  test('createDiscount throws on a non-2xx response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 422 }));
    await expect(
      provider.createDiscount({ name: 'X', code: 'XXX', percent: 10, duration: 'once' }),
    ).rejects.toThrow(/discount create failed: 422/);
  });

  test('deleteDiscount DELETEs; 404 is success (already gone); 500 throws', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response('boom', { status: 500 }));
    await provider.deleteDiscount('disc_9');
    expect(String(spy.mock.calls[0]?.[0])).toBe('https://api.lemonsqueezy.com/v1/discounts/disc_9');
    expect(spy.mock.calls[0]?.[1]?.method).toBe('DELETE');
    await provider.deleteDiscount('disc_9'); // 404 -> resolves
    await expect(provider.deleteDiscount('disc_9')).rejects.toThrow(/discount delete failed: 500/);
  });
});
