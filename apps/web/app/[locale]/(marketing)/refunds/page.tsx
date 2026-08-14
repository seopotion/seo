import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { Locale } from '@/i18n/routing';

type RefundsPageProps = {
  params: Promise<{ locale: Locale }>;
};

type RefundSubsection = {
  paragraphs: string[];
  title: string;
};

type RefundSection = {
  afterBullets?: string[];
  bullets?: string[];
  paragraphs: string[];
  subsections?: RefundSubsection[];
  title: string;
};

const sections: RefundSection[] = [
  {
    title: '1. 30-Day Money-Back Guarantee',
    paragraphs: [
      'Seopotion offers a 30-day money-back guarantee on your initial subscription purchase.',
      'This guarantee applies to both:',
    ],
    bullets: ['Growth subscriptions; and', 'Business subscriptions.'],
    afterBullets: [
      'It applies whether you purchase a monthly or annual subscription.',
      'If you are not satisfied with Seopotion, you may request a full refund within 30 calendar days of your initial purchase date.',
      'You do not need to provide a specific reason to request a refund under this guarantee.',
    ],
  },
  {
    title: '2. What the 30-Day Guarantee Covers',
    paragraphs: [
      'The voluntary Seopotion 30-day money-back guarantee applies to the first payment made when you initially purchase a subscription.',
      'For example, it applies to:',
    ],
    bullets: [
      'your first Growth monthly payment;',
      'your first Growth annual payment;',
      'your first Business monthly payment; or',
      'your first Business annual payment.',
    ],
    afterBullets: [
      'If an eligible refund is approved under this guarantee, the amount paid for the initial subscription purchase will be refunded.',
    ],
  },
  {
    title: '3. Subscription Renewals',
    paragraphs: [
      'Seopotion subscriptions automatically renew unless canceled before the next renewal date.',
      'Our voluntary 30-day money-back guarantee does not automatically apply to recurring renewal payments.',
      'However, you may have additional refund, cancellation, or withdrawal rights under:',
    ],
    bullets: [
      'applicable consumer-protection law;',
      "Lemon Squeezy's terms and policies;",
      'other mandatory laws applicable to your transaction.',
    ],
    afterBullets: [
      'Nothing in this Refund Policy limits any rights that cannot legally be excluded.',
      'Lemon Squeezy may also determine that a refund is appropriate in circumstances covered by its own policies.',
    ],
  },
  {
    title: '4. How to Request a Refund',
    paragraphs: [
      "If you want to request a refund under Seopotion's 30-day money-back guarantee, contact support@seopotion.co.",
      'Please include:',
    ],
    bullets: [
      'the email address used for the purchase;',
      'the subscription or order details, if available; and',
      'a short statement that you are requesting a refund.',
    ],
    afterBullets: [
      'You may also request assistance through Lemon Squeezy using the transaction-management or support options provided in your Lemon Squeezy purchase confirmation or receipt.',
      'Because Lemon Squeezy is the Merchant of Record, eligible refunds for Lemon Squeezy-processed transactions are issued through Lemon Squeezy.',
      'Seopotion does not send refunds directly to your payment card or bank account outside Lemon Squeezy for transactions processed by Lemon Squeezy.',
    ],
  },
  {
    title: '5. Refund Processing',
    paragraphs: [
      'Once a refund is approved, Lemon Squeezy processes the refund.',
      'Where possible, the refund will be returned to the payment method originally used for the transaction.',
      'The time required for refunded funds to appear may depend on Lemon Squeezy, your payment method, your bank, or your card provider.',
    ],
  },
  {
    title: '6. Statutory Consumer Rights',
    paragraphs: [
      'Our 30-day money-back guarantee is a voluntary Seopotion policy and is separate from any mandatory rights you may have as a consumer.',
      'Depending on your country or region, you may have statutory rights to cancel, withdraw from, or receive a refund for certain digital products or services.',
      "These rights may be different from or more favorable than Seopotion's voluntary refund policy.",
      "Where applicable consumer law or Lemon Squeezy's mandatory buyer protections provide greater rights than this Refund Policy, those rights will apply.",
      'Nothing in this Refund Policy is intended to waive, restrict, or replace mandatory consumer rights.',
    ],
  },
  {
    title: '7. Türkiye',
    paragraphs: [
      'Consumers purchasing from Türkiye may have statutory withdrawal or refund rights applicable to certain digital-content or digital-service transactions.',
      "These statutory rights exist independently of Seopotion's voluntary 30-day money-back guarantee.",
      "Where Turkish consumer-protection law or Lemon Squeezy's applicable buyer protections give you rights beyond this policy, those rights remain unaffected.",
    ],
  },
  {
    title: '8. Technical Problems or Material Product Defects',
    paragraphs: [
      'If you experience a persistent technical problem that prevents you from accessing or using material features of Seopotion as described, please contact us at support@seopotion.co.',
      'We will reasonably attempt to investigate and resolve the issue.',
      'If a material technical problem cannot be resolved, you may request a refund.',
      'Lemon Squeezy may also provide refunds for qualifying technical or product defects in accordance with its own policies and applicable consumer-protection laws.',
    ],
  },
  {
    title: '9. Business',
    paragraphs: [
      'Business consists primarily of access to the Seopotion software platform together with human review of up to 10 selected Seopotion-generated articles per month.',
      'The human-review feature is ancillary to the software subscription.',
      'Business does not include agency campaign management, human-written-from-scratch content, backlink outreach, paid advertising, or external marketing distribution.',
      'The same 30-day initial-purchase money-back guarantee applies to Business.',
      'If a valid refund request is submitted within the 30-day guarantee period, the fact that an included article review has already been provided does not by itself exclude the subscription from Seopotion’s voluntary 30-day guarantee.',
      'Any additional statutory rights or Lemon Squeezy protections remain unaffected.',
    ],
  },
  {
    title: '10. Cancellation Is Different From a Refund',
    paragraphs: ['Canceling a subscription and requesting a refund are separate actions.'],
    subsections: [
      {
        title: 'Cancellation',
        paragraphs: [
          'You may cancel your subscription to prevent future renewal charges.',
          'After cancellation, your subscription will generally remain available until the end of the period for which you have already paid, unless otherwise required by law or stated by Lemon Squeezy.',
        ],
      },
      {
        title: 'Refund',
        paragraphs: [
          'A refund returns some or all of a payment that has already been made.',
          'Canceling a subscription does not automatically refund previous payments.',
          'If you want both to cancel and request a refund, you should make both intentions clear when contacting us or Lemon Squeezy.',
        ],
      },
    ],
  },
  {
    title: '11. Annual Subscriptions',
    paragraphs: [
      'Annual subscriptions are paid in advance for a one-year subscription period.',
      "Your initial annual subscription purchase is covered by Seopotion's 30-day money-back guarantee.",
      'After the 30-day voluntary guarantee period expires, annual subscription payments are generally non-refundable under Seopotion’s voluntary policy, except where:',
    ],
    bullets: [
      'applicable law requires a refund;',
      "Lemon Squeezy's policies provide a refund;",
      'there is a qualifying material product defect; or',
      'we expressly agree otherwise.',
    ],
    afterBullets: [
      'You may cancel an annual subscription before its next renewal to prevent another annual payment.',
    ],
  },
  {
    title: '12. Monthly Subscriptions',
    paragraphs: [
      'Monthly subscriptions are billed once per monthly billing period.',
      "Your initial monthly subscription payment is covered by Seopotion's 30-day money-back guarantee.",
      'After the initial guarantee period, previous monthly subscription payments are generally non-refundable under Seopotion’s voluntary policy, except where:',
    ],
    bullets: [
      'applicable law requires a refund;',
      "Lemon Squeezy's policies provide a refund;",
      'there is a qualifying material product defect; or',
      'we expressly agree otherwise.',
    ],
    afterBullets: ['You may cancel before your next renewal to prevent future monthly charges.'],
  },
  {
    title: '13. Duplicate, Incorrect, or Unauthorized Charges',
    paragraphs: ['If you believe that:'],
    bullets: [
      'you were charged more than once for the same purchase;',
      'you were charged an incorrect amount;',
      'a transaction was made in error; or',
      'a transaction was unauthorized,',
    ],
    afterBullets: [
      'please contact us or Lemon Squeezy promptly.',
      "These situations may be handled separately from Seopotion's voluntary 30-day money-back guarantee and may qualify for correction or refund under Lemon Squeezy's policies or applicable law.",
    ],
  },
  {
    title: '14. Chargebacks and Payment Disputes',
    paragraphs: [
      'If you have a problem with a purchase, we encourage you to contact us or Lemon Squeezy before initiating a chargeback or payment dispute.',
      'We will reasonably attempt to resolve legitimate billing, technical, cancellation, or refund issues.',
      'Nothing in this section limits your legal rights to dispute an unauthorized or otherwise disputable transaction through your payment provider.',
    ],
  },
  {
    title: '15. Changes to This Refund Policy',
    paragraphs: [
      'We may update this Refund Policy from time to time.',
      'Changes will be published on seopotion.co with an updated "Last updated" date.',
      'Changes to our voluntary refund policy will not reduce refund rights that have already arisen from a transaction completed under an earlier version of this policy, and they will not affect mandatory rights provided by applicable law.',
    ],
  },
  {
    title: '16. Contact',
    paragraphs: [
      'For questions about cancellations, refunds, or your Seopotion subscription, contact:',
      'Deniz Yazagan\nOperator of Seopotion\nIstanbul, Türkiye',
      'Email: support@seopotion.co\nWebsite: seopotion.co',
      'For purchases processed by Lemon Squeezy, buyers may also use the transaction-management and support options provided by Lemon Squeezy in their purchase confirmation or receipt.',
    ],
  },
];

export function generateMetadata(): Metadata {
  return {
    title: 'Refund Policy',
    description: 'Refund Policy for Seopotion.',
    alternates: {
      canonical: '/refunds',
    },
  };
}

function RefundContent({
  afterBullets,
  bullets,
  paragraphs,
}: Pick<RefundSection, 'afterBullets' | 'bullets' | 'paragraphs'>) {
  return (
    <>
      <div className="space-y-4">
        {paragraphs.map((paragraph) => (
          <p key={paragraph} className="whitespace-pre-line">
            {paragraph}
          </p>
        ))}
      </div>
      {bullets && (
        <ul className="mt-4 list-disc space-y-2 pl-6">
          {bullets.map((bullet) => (
            <li key={bullet}>{bullet}</li>
          ))}
        </ul>
      )}
      {afterBullets && (
        <div className="mt-4 space-y-4">
          {afterBullets.map((paragraph) => (
            <p key={paragraph} className="whitespace-pre-line">
              {paragraph}
            </p>
          ))}
        </div>
      )}
    </>
  );
}

export default async function RefundsPage({ params }: RefundsPageProps) {
  const { locale } = await params;
  if (locale !== 'en') redirect('/refunds');

  return (
    <main className="bg-white px-6 py-16 text-gray-700 sm:py-24">
      <article className="mx-auto max-w-3xl">
        <header className="mb-12 border-gray-200 border-b pb-8">
          <h1 className="font-bold text-4xl text-gray-900 sm:text-5xl">Refund Policy</h1>
          <p className="mt-4 text-gray-500">Last updated: August 13, 2026</p>
          <div className="mt-8 space-y-4 leading-7">
            <p>
              This Refund Policy explains the refund and cancellation rules that apply to purchases
              of Seopotion subscriptions.
            </p>
            <p>Seopotion is operated by Deniz Yazagan, an individual operating from Türkiye.</p>
            <p>
              Payments for Seopotion are processed by Lemon Squeezy, which acts as the Merchant of
              Record for purchases made through Lemon Squeezy.
            </p>
            <p>
              If you have questions about a refund, you can contact us at{' '}
              <a
                className="text-blue-700 underline hover:text-blue-800"
                href="mailto:support@seopotion.co"
              >
                support@seopotion.co
              </a>
              .
            </p>
          </div>
        </header>

        <div className="space-y-10 leading-7">
          {sections.map((section) => (
            <section key={section.title}>
              <h2 className="mb-4 font-bold text-2xl text-gray-900">{section.title}</h2>
              <RefundContent
                afterBullets={section.afterBullets}
                bullets={section.bullets}
                paragraphs={section.paragraphs}
              />
              {section.subsections && (
                <div className="mt-6 space-y-6">
                  {section.subsections.map((subsection) => (
                    <section key={subsection.title}>
                      <h3 className="mb-3 font-semibold text-xl text-gray-900">
                        {subsection.title}
                      </h3>
                      <RefundContent paragraphs={subsection.paragraphs} />
                    </section>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      </article>
    </main>
  );
}
