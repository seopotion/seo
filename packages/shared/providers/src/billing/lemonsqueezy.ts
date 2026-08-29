import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PaidTier, SubscriptionStatus } from '@shared/schemas';
import type { BillingProvider } from './types';

const LS_API = 'https://api.lemonsqueezy.com/v1';
const JSON_API = 'application/vnd.api+json';

export interface LemonSqueezyConfig {
  apiKey: string;
  webhookSecret: string;
  storeId: string;
  variantByTier: Record<PaidTier, string>;
  /** Where checkout sends the buyer afterwards (the app's activation page). */
  redirectUrl: string;
}

/** LS date fields can be null (e.g. `renews_at` after cancellation) — never
 * let those become epoch/Invalid Dates. */
function parseDate(value: unknown): Date | undefined {
  if (typeof value !== 'string') return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Map a LemonSqueezy subscription status to our neutral status. */
function mapStatus(ls: string): SubscriptionStatus {
  switch (ls) {
    case 'active':
    case 'on_trial':
      return 'active';
    case 'past_due':
    case 'unpaid':
    case 'paused':
      return 'past_due';
    case 'cancelled':
      return 'cancelled';
    case 'expired':
      return 'expired';
    default:
      return 'past_due';
  }
}

export function createLemonSqueezyProvider(cfg: LemonSqueezyConfig): BillingProvider {
  // Reverse map: LS variant id (string) -> our tier.
  const tierByVariant = new Map<string, PaidTier>(
    (Object.entries(cfg.variantByTier) as [PaidTier, string][]).map(([tier, id]) => [id, tier]),
  );

  return {
    name: 'lemonsqueezy',

    async createCheckout({ tier, orgId, userEmail, discountCode }) {
      const res = await fetch(`${LS_API}/checkouts`, {
        method: 'POST',
        headers: {
          Accept: JSON_API,
          'Content-Type': JSON_API,
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({
          data: {
            type: 'checkouts',
            attributes: {
              checkout_data: {
                email: userEmail,
                custom: { org_id: orgId },
                ...(discountCode ? { discount_code: discountCode } : {}),
              },
              // Codes must pass our validation first — hide LS's own field.
              checkout_options: { discount: false },
              product_options: { redirect_url: cfg.redirectUrl },
            },
            relationships: {
              store: { data: { type: 'stores', id: cfg.storeId } },
              variant: { data: { type: 'variants', id: cfg.variantByTier[tier] } },
            },
          },
        }),
      });
      if (!res.ok) {
        throw new Error(`LemonSqueezy checkout failed: ${res.status} ${await res.text()}`);
      }
      const json = (await res.json()) as { data: { attributes: { url: string } } };
      return { url: json.data.attributes.url };
    },

    verifyWebhook(rawBody, signature) {
      const expected = createHmac('sha256', cfg.webhookSecret).update(rawBody).digest('hex');
      const a = Buffer.from(expected, 'utf8');
      const b = Buffer.from(signature, 'utf8');
      return a.length === b.length && timingSafeEqual(a, b);
    },

    parseWebhookEvent(rawBody) {
      // The signature only proves the sender; the shape is still untrusted.
      // Anything malformed is an ignore (null), never a throw — a throw would
      // 500 and put the provider into a pointless retry loop.
      let payload: {
        meta?: { event_name?: unknown; custom_data?: { org_id?: string } };
        data?: {
          id?: unknown;
          attributes?: {
            customer_id?: unknown;
            variant_id?: unknown;
            status?: unknown;
            renews_at?: unknown;
          };
        };
      } | null;
      try {
        payload = JSON.parse(rawBody);
      } catch {
        return null;
      }
      const event = payload?.meta?.event_name;
      const subId = payload?.data?.id;
      const attrs = payload?.data?.attributes;
      if (typeof event !== 'string' || typeof subId !== 'string' || !attrs) return null;

      switch (event) {
        case 'subscription_created': {
          const tier = tierByVariant.get(String(attrs.variant_id));
          const orgId = payload?.meta?.custom_data?.org_id;
          const currentPeriodEnd = parseDate(attrs.renews_at);
          if (!tier || !orgId || !currentPeriodEnd) return null;
          return {
            type: 'subscription_activated',
            orgId,
            providerCustomerId: String(attrs.customer_id),
            providerSubscriptionId: subId,
            tier,
            currentPeriodEnd,
          };
        }
        case 'subscription_updated': {
          const tier = tierByVariant.get(String(attrs.variant_id));
          if (!tier) return null;
          return {
            type: 'subscription_updated',
            providerSubscriptionId: subId,
            tier,
            status: mapStatus(String(attrs.status)),
            currentPeriodEnd: parseDate(attrs.renews_at),
          };
        }
        case 'subscription_cancelled':
          return { type: 'subscription_cancelled', providerSubscriptionId: subId };
        case 'subscription_expired':
          return { type: 'subscription_expired', providerSubscriptionId: subId };
        default:
          return null;
      }
    },

    async cancelSubscription(providerSubscriptionId) {
      const res = await fetch(`${LS_API}/subscriptions/${providerSubscriptionId}`, {
        method: 'DELETE',
        headers: { Accept: JSON_API, Authorization: `Bearer ${cfg.apiKey}` },
      });
      if (!res.ok) {
        throw new Error(
          `LemonSqueezy subscription cancel failed: ${res.status} ${await res.text()}`,
        );
      }
    },

    async createDiscount({
      name,
      code,
      percent,
      duration,
      durationInMonths,
      maxRedemptions,
      expiresAt,
    }) {
      const res = await fetch(`${LS_API}/discounts`, {
        method: 'POST',
        headers: {
          Accept: JSON_API,
          'Content-Type': JSON_API,
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({
          data: {
            type: 'discounts',
            attributes: {
              name,
              code,
              amount: percent,
              amount_type: 'percent',
              duration,
              ...(duration === 'repeating' ? { duration_in_months: durationInMonths } : {}),
              ...(maxRedemptions
                ? { is_limited_redemptions: true, max_redemptions: maxRedemptions }
                : {}),
              ...(expiresAt ? { expires_at: expiresAt.toISOString() } : {}),
            },
            relationships: { store: { data: { type: 'stores', id: cfg.storeId } } },
          },
        }),
      });
      if (!res.ok) {
        throw new Error(`LemonSqueezy discount create failed: ${res.status} ${await res.text()}`);
      }
      const json = (await res.json()) as { data: { id: string } };
      return { providerDiscountId: json.data.id };
    },

    async deleteDiscount(providerDiscountId) {
      const res = await fetch(`${LS_API}/discounts/${providerDiscountId}`, {
        method: 'DELETE',
        headers: { Accept: JSON_API, Authorization: `Bearer ${cfg.apiKey}` },
      });
      // 404 = already deleted — deactivation must be idempotent.
      if (!res.ok && res.status !== 404) {
        throw new Error(`LemonSqueezy discount delete failed: ${res.status} ${await res.text()}`);
      }
    },

    async getCustomerPortalUrl(providerCustomerId) {
      const res = await fetch(`${LS_API}/customers/${providerCustomerId}`, {
        headers: { Accept: JSON_API, Authorization: `Bearer ${cfg.apiKey}` },
      });
      if (!res.ok) {
        throw new Error(`LemonSqueezy customer fetch failed: ${res.status} ${await res.text()}`);
      }
      const json = (await res.json()) as {
        data: { attributes: { urls: { customer_portal: string } } };
      };
      return { url: json.data.attributes.urls.customer_portal };
    },
  };
}
