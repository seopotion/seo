import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createLemonSqueezyProvider } from '../src/billing/lemonsqueezy';

const cfg = {
  apiKey: 'test-key',
  webhookSecret: 'whsec_test',
  storeId: '111',
  variantByTier: { paid: '201', expert: '202' } as const,
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
        renews_at: '2026-08-22T00:00:00.000000Z',
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
    expect(sent.data.relationships.variant.data.id).toBe('201');
  });
});
