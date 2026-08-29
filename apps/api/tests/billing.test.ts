import type { Context, Next } from 'hono';
import { testClient } from 'hono/testing';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { AuthEnv } from '../src/middlewares/auth';

const { loadOwnedOrg } = vi.hoisted(() => ({ loadOwnedOrg: vi.fn() }));
vi.mock('../src/lib/load-owned-org', () => ({ loadOwnedOrg }));

const { applyBillingEvent } = vi.hoisted(() => ({ applyBillingEvent: vi.fn() }));
vi.mock('../src/lib/billing/apply-event', () => ({ applyBillingEvent }));

const { findLatestByOrg, promoCodeRepo, promoRedemptionRepo } = vi.hoisted(() => ({
  findLatestByOrg: vi.fn(),
  promoCodeRepo: { findByCode: vi.fn() },
  promoRedemptionRepo: {
    upsertPending: vi.fn(),
    countConfirmed: vi.fn(),
    findConfirmedByCodeAndOrg: vi.fn(),
  },
}));
vi.mock('@shared/db', () => ({
  SubscriptionRepo: { findLatestByOrg },
  PromoCodeRepo: promoCodeRepo,
  PromoRedemptionRepo: promoRedemptionRepo,
}));

const {
  createCheckout,
  verifyWebhook,
  parseWebhookEvent,
  getCustomerPortalUrl,
  cancelSubscription,
} = vi.hoisted(() => ({
  createCheckout: vi.fn(),
  verifyWebhook: vi.fn(),
  parseWebhookEvent: vi.fn(),
  getCustomerPortalUrl: vi.fn(),
  cancelSubscription: vi.fn(),
}));
vi.mock('../src/clients/billing', () => ({
  getBillingProvider: async () => ({
    name: 'lemonsqueezy',
    createCheckout,
    verifyWebhook,
    parseWebhookEvent,
    getCustomerPortalUrl,
    cancelSubscription,
  }),
}));

vi.mock('../src/middlewares/auth', async (orig) => {
  const actual = await orig<typeof import('../src/middlewares/auth')>();
  return {
    ...actual,
    authMiddleware: async (c: Context<AuthEnv>, next: Next) => {
      c.set('auth', { userId: 'u1', email: 'u1@example.com' });
      await next();
    },
  };
});

import app from '../src/routes/billing';

describe('POST /checkout', () => {
  beforeEach(() => vi.clearAllMocks());

  test('403 when the org is not owned', async () => {
    loadOwnedOrg.mockResolvedValueOnce(null);
    const res = await testClient(app).checkout.$post({ json: { org_id: 'o1', tier: 'paid' } });
    expect(res.status).toBe(403);
  });

  test('409 when already paid on the same tier', async () => {
    loadOwnedOrg.mockResolvedValueOnce({ id: 'o1', user_id: 'u1', plan: 'paid' });
    const res = await testClient(app).checkout.$post({ json: { org_id: 'o1', tier: 'paid' } });
    expect(res.status).toBe(409);
  });

  test('409 when an expert org requests paid (already entitled at a higher tier)', async () => {
    loadOwnedOrg.mockResolvedValueOnce({ id: 'o1', user_id: 'u1', plan: 'expert' });
    const res = await testClient(app).checkout.$post({ json: { org_id: 'o1', tier: 'paid' } });
    expect(res.status).toBe(409);
  });

  test('200 when a paid org requests expert (a real upgrade)', async () => {
    loadOwnedOrg.mockResolvedValueOnce({ id: 'o1', user_id: 'u1', plan: 'paid' });
    createCheckout.mockResolvedValueOnce({ url: 'https://ls/checkout/upgrade' });
    const res = await testClient(app).checkout.$post({ json: { org_id: 'o1', tier: 'expert' } });
    expect(res.status).toBe(200);
    expect(createCheckout).toHaveBeenCalledWith({
      tier: 'expert',
      orgId: 'o1',
      userEmail: 'u1@example.com',
    });
  });

  test('200 returns the checkout url', async () => {
    loadOwnedOrg.mockResolvedValueOnce({ id: 'o1', user_id: 'u1', plan: 'free' });
    createCheckout.mockResolvedValueOnce({ url: 'https://ls/checkout/abc' });
    const res = await testClient(app).checkout.$post({ json: { org_id: 'o1', tier: 'paid' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: 'https://ls/checkout/abc' });
    expect(createCheckout).toHaveBeenCalledWith({
      tier: 'paid',
      orgId: 'o1',
      userEmail: 'u1@example.com',
    });
  });
});

describe('POST /portal', () => {
  beforeEach(() => vi.clearAllMocks());

  test('404 when there is no subscription', async () => {
    loadOwnedOrg.mockResolvedValueOnce({ id: 'o1', user_id: 'u1', plan: 'paid' });
    findLatestByOrg.mockResolvedValueOnce(null);
    const res = await testClient(app).portal.$post({ json: { org_id: 'o1' } });
    expect(res.status).toBe(404);
  });

  test('200 returns the portal url', async () => {
    loadOwnedOrg.mockResolvedValueOnce({ id: 'o1', user_id: 'u1', plan: 'paid' });
    findLatestByOrg.mockResolvedValueOnce({ provider_customer_id: 'c1' });
    getCustomerPortalUrl.mockResolvedValueOnce({ url: 'https://ls/billing' });
    const res = await testClient(app).portal.$post({ json: { org_id: 'o1' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: 'https://ls/billing' });
  });
});

describe('POST /promo/validate', () => {
  const promo = {
    id: 'p'.repeat(24),
    code: 'LAUNCH30',
    name: 'Launch promo',
    percent: 30,
    duration: 'repeating' as const,
    duration_in_months: 3,
    max_redemptions: 50,
    active: true,
    ls_discount_id: 'disc_1',
    created_at: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    loadOwnedOrg.mockResolvedValue({ id: 'o1', user_id: 'u1', plan: 'free' });
    promoRedemptionRepo.findConfirmedByCodeAndOrg.mockResolvedValue(null);
    promoRedemptionRepo.countConfirmed.mockResolvedValue(0);
  });

  test('403 when the org is not owned', async () => {
    loadOwnedOrg.mockResolvedValueOnce(null);
    const res = await testClient(app).promo.validate.$post({
      json: { org_id: 'o1', code: 'LAUNCH30' },
    });
    expect(res.status).toBe(403);
  });

  test('200 with the discount terms; input is trimmed and uppercased', async () => {
    promoCodeRepo.findByCode.mockResolvedValueOnce(promo);
    const res = await testClient(app).promo.validate.$post({
      json: { org_id: 'o1', code: '  launch30 ' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      valid: true,
      code: 'LAUNCH30',
      percent: 30,
      duration: 'repeating',
      duration_in_months: 3,
    });
    expect(promoCodeRepo.findByCode).toHaveBeenCalledWith('LAUNCH30');
  });

  test.each([
    ['not_found', () => promoCodeRepo.findByCode.mockResolvedValueOnce(null)],
    ['inactive', () => promoCodeRepo.findByCode.mockResolvedValueOnce({ ...promo, active: false })],
    [
      'expired',
      () =>
        promoCodeRepo.findByCode.mockResolvedValueOnce({
          ...promo,
          expires_at: new Date(Date.now() - 1000),
        }),
    ],
    [
      'already_redeemed',
      () => {
        promoCodeRepo.findByCode.mockResolvedValueOnce(promo);
        promoRedemptionRepo.findConfirmedByCodeAndOrg.mockResolvedValueOnce({ id: 'r1' });
      },
    ],
    [
      'exhausted',
      () => {
        promoCodeRepo.findByCode.mockResolvedValueOnce(promo);
        promoRedemptionRepo.countConfirmed.mockResolvedValueOnce(50);
      },
    ],
  ])('422 %s', async (reason, arrange) => {
    arrange();
    const res = await testClient(app).promo.validate.$post({
      json: { org_id: 'o1', code: 'LAUNCH30' },
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ valid: false, reason });
  });
});

describe('POST /webhook/lemonsqueezy', () => {
  beforeEach(() => vi.clearAllMocks());

  test('401 on a bad signature', async () => {
    verifyWebhook.mockReturnValueOnce(false);
    const res = await app.request('/webhook/lemonsqueezy', {
      method: 'POST',
      headers: { 'X-Signature': 'bad', 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(401);
    expect(applyBillingEvent).not.toHaveBeenCalled();
  });

  test('200 and applies a parsed event', async () => {
    verifyWebhook.mockReturnValueOnce(true);
    parseWebhookEvent.mockReturnValueOnce({
      type: 'subscription_expired',
      providerSubscriptionId: 'sub_1',
    });
    const res = await app.request('/webhook/lemonsqueezy', {
      method: 'POST',
      headers: { 'X-Signature': 'good', 'Content-Type': 'application/json' },
      body: '{"meta":{}}',
    });
    expect(res.status).toBe(200);
    expect(applyBillingEvent).toHaveBeenCalledWith(
      { type: 'subscription_expired', providerSubscriptionId: 'sub_1' },
      expect.objectContaining({ name: 'lemonsqueezy' }),
    );
  });

  test('200 no-op on an unknown/ignored event', async () => {
    verifyWebhook.mockReturnValueOnce(true);
    parseWebhookEvent.mockReturnValueOnce(null);
    const res = await app.request('/webhook/lemonsqueezy', {
      method: 'POST',
      headers: { 'X-Signature': 'good', 'Content-Type': 'application/json' },
      body: '{"meta":{}}',
    });
    expect(res.status).toBe(200);
    expect(applyBillingEvent).not.toHaveBeenCalled();
  });
});
