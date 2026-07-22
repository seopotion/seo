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

    async createCheckout({ tier, orgId, userEmail }) {
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
              checkout_data: { email: userEmail, custom: { org_id: orgId } },
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
      const payload = JSON.parse(rawBody) as {
        meta: { event_name: string; custom_data?: { org_id?: string } };
        data: {
          id: string;
          attributes: {
            customer_id: number;
            variant_id: number;
            status: string;
            renews_at: string;
          };
        };
      };
      const event = payload.meta.event_name;
      const subId = payload.data.id;
      const attrs = payload.data.attributes;

      switch (event) {
        case 'subscription_created': {
          const tier = tierByVariant.get(String(attrs.variant_id));
          const orgId = payload.meta.custom_data?.org_id;
          if (!tier || !orgId) return null;
          return {
            type: 'subscription_activated',
            orgId,
            providerCustomerId: String(attrs.customer_id),
            providerSubscriptionId: subId,
            tier,
            currentPeriodEnd: new Date(attrs.renews_at),
          };
        }
        case 'subscription_updated': {
          const tier = tierByVariant.get(String(attrs.variant_id));
          if (!tier) return null;
          return {
            type: 'subscription_updated',
            providerSubscriptionId: subId,
            tier,
            status: mapStatus(attrs.status),
            currentPeriodEnd: new Date(attrs.renews_at),
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
