import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { Locale } from '@/i18n/routing';

type TermsPageProps = {
  params: Promise<{ locale: Locale }>;
};

type TermsSection = {
  afterBullets?: string[];
  bullets?: string[];
  paragraphs: string[];
  title: string;
};

const sections: TermsSection[] = [
  {
    title: '1. The Service',
    paragraphs: [
      'Seopotion is a software-as-a-service platform designed to assist users with researching, creating, editing, managing, and publishing SEO-oriented website content.',
      'Depending on the features available under your subscription, the Service may include:',
    ],
    bullets: [
      'website and business-profile analysis;',
      'keyword and topic research;',
      'AI-assisted article generation;',
      'content planning;',
      'internal-link recommendations and insertion;',
      'image or media insertion;',
      'article editing and review tools;',
      'integrations with supported content management systems;',
      'manual or automated publishing; and',
      'content history and management tools.',
    ],
    afterBullets: [
      'Users may review and edit generated articles before publication. Where automated publishing is enabled by the user, content may be published without the user manually reviewing each article immediately before publication.',
      'Features may be added, changed, improved, replaced, or removed as the Service develops, provided that we do not materially reduce the core functionality of a paid subscription during its current billing period without a reasonable basis.',
    ],
  },
  {
    title: '2. Business',
    paragraphs: [
      'The Business subscription includes access to the Seopotion software plus human review of up to 10 articles per month that were generated through Seopotion.',
      'The software platform remains the primary product supplied under the subscription. The human review is a limited quality-control layer for selected software-generated output.',
      'An authorized reviewer may review and reasonably edit selected drafts for business and brand fit, readability and clarity, article structure, internal-link relevance, obvious factual issues or inconsistencies, and on-page SEO fundamentals.',
      'Business is not an agency, consulting, or advisory engagement and does not include management of the customer’s overall SEO or marketing activities.',
      'Business does not include custom SEO strategy or roadmaps, human-written articles from scratch, backlink outreach or manual link building, paid advertising, social media management, community distribution, public relations, off-platform campaign execution, dedicated staff, unlimited reviews, or unlimited reviewer hours.',
    ],
  },
  {
    title: '3. Eligibility and Accounts',
    paragraphs: [
      'You must have the legal capacity to enter into a binding agreement in your jurisdiction to use the Service.',
      'You may use Seopotion for business, professional, or personal purposes.',
      'You are responsible for:',
    ],
    bullets: [
      'providing accurate account information;',
      'keeping your login credentials secure;',
      'all activity occurring through your account;',
      'ensuring that people you authorize to access your account comply with these Terms; and',
      'notifying us promptly if you believe your account has been accessed without authorization.',
    ],
  },
  {
    title: '4. Subscription Plans and Pricing',
    paragraphs: [
      'Growth',
      '$60 USD per month, billed monthly; or $540 USD per year, billed annually.',
      'Growth includes access to the Seopotion software and the applicable features and usage limits displayed on our pricing page or during checkout.',
      'Business',
      '$400 USD per month, billed monthly; or $3,600 USD per year, billed annually.',
      'Business includes the Seopotion software plus the limited article-review feature described in Section 2.',
      'The prices and features displayed on the Seopotion pricing page and at checkout at the time of purchase form part of your subscription terms.',
      'We may change prices for future purchases or renewal periods. Where required by applicable law, appropriate notice will be provided before a price change applies to an existing subscription.',
    ],
  },
  {
    title: '5. Payments Through Lemon Squeezy',
    paragraphs: [
      'Payments for Seopotion subscriptions are processed by Lemon Squeezy, which acts as the Merchant of Record for transactions processed through Lemon Squeezy.',
      'When you purchase a subscription through Lemon Squeezy, your payment transaction is also subject to Lemon Squeezy’s applicable terms and policies.',
      'Lemon Squeezy is responsible for processing the transaction, collecting payment, handling applicable transaction taxes where required, issuing payment documentation, and administering payment-related matters in accordance with its terms.',
      'These Terms govern your access to and use of the Seopotion product itself.',
      'If there is a conflict between these Terms and Lemon Squeezy’s terms regarding a matter handled by Lemon Squeezy, including payment processing, billing, cancellation, statutory withdrawal rights, or transaction refunds, Lemon Squeezy’s applicable terms will govern that transaction to the extent required.',
    ],
  },
  {
    title: '6. Automatic Renewal and Cancellation',
    paragraphs: [
      'Seopotion subscriptions are recurring subscriptions.',
      'Monthly subscriptions automatically renew each month and annual subscriptions automatically renew each year unless canceled before the next renewal.',
      'You may cancel your subscription at any time using the subscription-management functionality made available through Lemon Squeezy or another cancellation method provided to you.',
      'Unless applicable law requires otherwise, cancellation takes effect at the end of your current paid billing period. You may continue using the Service until that period ends.',
      'Canceling a subscription prevents future renewals but does not automatically create a right to a refund for amounts already paid.',
    ],
  },
  {
    title: '7. No Free Trial and 30-Day Money-Back Guarantee',
    paragraphs: [
      'Seopotion does not currently offer a free trial.',
      'We offer a 30-day money-back guarantee on the initial purchase of a Seopotion subscription.',
      'If you are not satisfied with the Service, you may request a refund within 30 calendar days following your initial purchase.',
      'The guarantee applies to both monthly and annual subscriptions and to both Growth and Business plans.',
      'Refund requests for purchases processed by Lemon Squeezy are administered through Lemon Squeezy.',
      "This voluntary guarantee does not limit any statutory cancellation, withdrawal, refund, or consumer-protection rights you may have under applicable law or under Lemon Squeezy's applicable terms and policies.",
      "Renewals are not covered by Seopotion's voluntary initial-purchase money-back guarantee unless we expressly state otherwise. Any statutory or Lemon Squeezy-provided rights relating to a renewal remain unaffected.",
    ],
  },
  {
    title: '8. Customer Content',
    paragraphs: [
      'You retain ownership of the website content, text, instructions, data, trademarks, logos, materials, and other information that you provide to Seopotion ("Customer Content").',
      'You grant Seopotion a limited, worldwide, non-exclusive license to access, copy, process, modify, and use Customer Content only as reasonably necessary to:',
      'You represent that you have the necessary rights and permissions to provide Customer Content to us and to authorize its processing as described in these Terms.',
    ],
    bullets: [
      'provide the Service;',
      'generate requested content;',
      'operate integrations;',
      'troubleshoot and maintain the Service;',
      'prevent misuse or security incidents; and',
      'comply with applicable law.',
    ],
  },
  {
    title: '9. Generated Content',
    paragraphs: [
      'Content created through Seopotion for your account ("Generated Content") is intended for your use.',
      'Subject to payment of all applicable subscription fees, to the extent Seopotion has any intellectual-property rights in Generated Content created specifically for you, Seopotion assigns those rights to you to the extent permitted by applicable law.',
      'Seopotion retains all rights in the underlying software, models, workflows, systems, prompts, templates, technology, interfaces, algorithms, and other materials used to provide the Service.',
      'Because Generated Content may be created using artificial-intelligence technologies:',
      'Nothing in these Terms transfers ownership of the Seopotion platform or its underlying technology to you.',
    ],
    bullets: [
      'we do not guarantee that Generated Content is unique;',
      'similar or identical content may be generated for other users;',
      'we do not guarantee that Generated Content is eligible for copyright or other intellectual-property protection in every jurisdiction;',
      'Generated Content may contain errors, inaccuracies, or incomplete information; and',
      'you are responsible for reviewing Generated Content before relying on or publishing it.',
    ],
  },
  {
    title: '10. Your Responsibility for Published Content',
    paragraphs: [
      'You are responsible for the final content that you publish or authorize Seopotion to publish.',
      'You must review Generated Content to the extent reasonably appropriate for your use case, particularly where factual accuracy, legal compliance, intellectual-property rights, professional advice, or potentially sensitive claims are involved.',
      'If you enable automatic publishing, you acknowledge that Seopotion may publish Generated Content to your connected website without manual approval of each individual article.',
      'You remain responsible for content published through your account even when automatic publishing is enabled.',
    ],
  },
  {
    title: '11. SEO Results and No Guarantee of Rankings',
    paragraphs: [
      'Seopotion provides tools intended to assist with SEO-oriented content creation and publishing.',
      'We do not guarantee any particular search-engine ranking, amount of website traffic, number of impressions, backlinks, leads, customers, sales, revenue, or other business result.',
      'Search-engine performance depends on numerous factors outside Seopotion’s control, including your website, domain history, competition, technical SEO, content quality, search-engine algorithms, market conditions, and actions taken by third parties.',
      'Search engines may change their algorithms, policies, ranking systems, and treatment of content at any time.',
      'Statements, recommendations, scores, suggestions, forecasts, or analyses produced by Seopotion should not be interpreted as guarantees of future results.',
    ],
  },
  {
    title: '12. Third-Party Services and CMS Integrations',
    paragraphs: [
      'Seopotion may integrate with third-party products and services such as content management systems, hosting providers, AI services, analytics tools, image providers, or other platforms.',
      'Your use of a third-party service may also be governed by that third party’s terms and privacy practices.',
      'You authorize Seopotion to communicate with connected third-party services as necessary to provide functionality that you request.',
      'We are not responsible for interruptions, changes, errors, suspension, termination, or other actions caused by third-party services outside our reasonable control.',
      'You are responsible for ensuring that you have permission to connect any website, account, CMS, or other third-party resource to Seopotion.',
    ],
  },
  {
    title: '13. Acceptable Use',
    paragraphs: ['You may not use Seopotion to:'],
    bullets: [
      'violate applicable law or regulation;',
      'infringe another person’s intellectual-property, privacy, publicity, or other rights;',
      'publish content that you do not have the right to use;',
      'distribute malware or malicious code;',
      'obtain unauthorized access to systems, accounts, or data;',
      'impersonate another person or organization;',
      'conduct fraudulent, deceptive, abusive, or unlawful activities;',
      'interfere with or attempt to disrupt the Service;',
      'reverse engineer or attempt to extract the source code of the Service except where applicable law expressly permits it;',
      'bypass usage, account, or security restrictions;',
      'use automated means to overload or abuse the Service; or',
      'resell, sublicense, or commercially redistribute access to the Service unless we have expressly authorized this in writing.',
    ],
    afterBullets: ['We may suspend or terminate accounts that violate this section.'],
  },
  {
    title: '14. Intellectual Property in Seopotion',
    paragraphs: [
      'Except for Customer Content and rights assigned in Generated Content under Section 9, all intellectual-property rights in Seopotion and the Service belong to Deniz Yazagan or the applicable licensors.',
      'This includes the software, website, design, databases, functionality, workflow, source code, branding, trademarks, documentation, and underlying technology.',
      'During an active subscription, we grant you a limited, non-exclusive, non-transferable, revocable right to access and use the Service in accordance with these Terms.',
      'This right ends when your subscription or account terminates.',
    ],
  },
  {
    title: '15. Service Availability',
    paragraphs: [
      'We aim to provide a reliable Service, but we do not guarantee uninterrupted or error-free availability.',
      'The Service may occasionally be unavailable because of maintenance, updates, technical failures, third-party infrastructure, security incidents, or circumstances outside our reasonable control.',
      'We may modify or update the Service as reasonably necessary for security, legal compliance, product development, technical compatibility, or other legitimate operational purposes.',
    ],
  },
  {
    title: '16. Suspension and Termination',
    paragraphs: [
      'You may stop using the Service at any time.',
      'We may suspend or terminate your access if:',
    ],
    bullets: [
      'you materially violate these Terms;',
      'payment for your subscription cannot be completed;',
      'your activity creates a security or legal risk;',
      'you use the Service fraudulently or unlawfully;',
      'continued provision of the Service would violate applicable law or a third-party platform requirement; or',
      'we discontinue the Service.',
    ],
    afterBullets: [
      'Where reasonably possible and legally permitted, we will provide notice before terminating access for a remediable breach.',
      'Termination does not affect rights or obligations that arose before termination.',
    ],
  },
  {
    title: '17. Disclaimer',
    paragraphs: [
      'To the fullest extent permitted by applicable law, the Service is provided on an "as available" basis.',
      'Seopotion is a software tool and does not provide legal, tax, financial, or other regulated professional advice.',
      'SEO recommendations, Generated Content, keyword suggestions, business analyses, and other outputs may contain inaccuracies and should be reviewed before being relied upon.',
      'Nothing in these Terms excludes warranties, guarantees, rights, or remedies that cannot lawfully be excluded, including mandatory consumer rights.',
    ],
  },
  {
    title: '18. Limitation of Liability',
    paragraphs: [
      'Nothing in these Terms excludes or limits liability where doing so would be prohibited by applicable law.',
      'For users acting in the course of a business, trade, craft, or profession, to the fullest extent permitted by applicable law:',
      'These limitations do not apply where liability cannot legally be limited.',
      'For consumers, nothing in this section reduces any mandatory consumer-protection rights available under applicable law.',
    ],
    bullets: [
      'Seopotion will not be liable for indirect, incidental, special, consequential, or punitive damages;',
      'Seopotion will not be liable for loss of profits, revenue, business opportunities, goodwill, anticipated savings, search rankings, traffic, or data resulting from use of the Service; and',
      'Seopotion’s total aggregate liability arising out of or relating to the Service will not exceed the amount paid for your Seopotion subscription during the 12 months immediately preceding the event giving rise to the claim.',
    ],
  },
  {
    title: '19. Indemnification by Business Users',
    paragraphs: [
      'If you use Seopotion in connection with a business, trade, profession, or commercial activity, you agree, to the extent permitted by applicable law, to indemnify Seopotion against third-party claims, damages, liabilities, and reasonable costs resulting from:',
      'This section does not apply to consumers to the extent prohibited by applicable law.',
    ],
    bullets: [
      'Customer Content that you provide;',
      'content you publish using the Service;',
      'your infringement of third-party rights;',
      'your unlawful use of the Service; or',
      'your material violation of these Terms.',
    ],
  },
  {
    title: '20. Privacy',
    paragraphs: [
      'Our collection and processing of personal information is described in the Seopotion Privacy Policy, which should be read together with these Terms.',
      'Lemon Squeezy separately processes information relating to purchases and payments in accordance with Lemon Squeezy’s own privacy notice.',
    ],
  },
  {
    title: '21. Changes to These Terms',
    paragraphs: [
      'We may update these Terms from time to time to reflect changes to the Service, applicable law, security requirements, business practices, or third-party requirements.',
      'The current version will be published on seopotion.co with an updated "Last updated" date.',
      'Where required by applicable law, we will provide reasonable notice of material changes affecting an existing paid subscription.',
      'If you do not agree to updated Terms, you may stop using the Service and cancel your subscription before the changes take effect.',
    ],
  },
  {
    title: '22. Governing Law',
    paragraphs: [
      'These Terms are governed by the laws of the Republic of Türkiye, without regard to conflict-of-law principles.',
      'Subject to any mandatory rights available to consumers under applicable law, disputes arising from these Terms or the use of Seopotion will be subject to the jurisdiction of the competent courts and enforcement offices of Istanbul, Türkiye.',
      'If you are a consumer and the law of your country provides mandatory rights relating to applicable law, jurisdiction, dispute resolution, or consumer protection, those rights are not excluded by this section.',
      'The terms governing your payment transaction with Lemon Squeezy may contain separate governing-law and dispute provisions applicable to the transaction between you and Lemon Squeezy.',
    ],
  },
  {
    title: '23. Severability',
    paragraphs: [
      'If any provision of these Terms is determined to be invalid, illegal, or unenforceable, the remaining provisions will remain in effect to the fullest extent permitted by law.',
    ],
  },
  {
    title: '24. Entire Agreement',
    paragraphs: [
      'These Terms, together with the Privacy Policy, applicable plan information, and any other terms expressly incorporated into them, form the agreement between you and Seopotion regarding your use of the Service.',
      'Your purchase transaction through Lemon Squeezy is additionally subject to Lemon Squeezy’s applicable terms.',
    ],
  },
  {
    title: '25. Contact',
    paragraphs: [
      'Seopotion is operated by:',
      'Deniz Yazagan\nIndividual operator of Seopotion\nIstanbul, Türkiye',
      'Email: support@seopotion.co\nWebsite: seopotion.co',
    ],
  },
];

export function generateMetadata(): Metadata {
  return {
    title: 'Terms of Service',
    description: 'Terms of Service for Seopotion.',
    alternates: {
      canonical: '/terms',
    },
  };
}

export default async function TermsPage({ params }: TermsPageProps) {
  const { locale } = await params;
  if (locale !== 'en') redirect('/terms');

  return (
    <main className="bg-white px-6 py-16 text-gray-700 sm:py-24">
      <article className="mx-auto max-w-3xl">
        <header className="mb-12 border-gray-200 border-b pb-8">
          <h1 className="font-bold text-4xl text-gray-900 sm:text-5xl">Terms of Service</h1>
          <p className="mt-4 text-gray-500">Last updated: August 13, 2026</p>
          <div className="mt-8 space-y-4 leading-7">
            <p>
              These Terms of Service (&quot;Terms&quot;) govern your access to and use of Seopotion,
              including the website at seopotion.co, the Seopotion software platform, and related
              features and services (collectively, the &quot;Service&quot;).
            </p>
            <p>
              Seopotion is operated by Deniz Yazagan, an individual operating from Türkiye
              (&quot;Seopotion&quot;, &quot;we&quot;, &quot;us&quot;, or &quot;our&quot;).
            </p>
            <p>
              You can contact us at{' '}
              <a
                className="text-blue-700 underline hover:text-blue-800"
                href="mailto:support@seopotion.co"
              >
                support@seopotion.co
              </a>
              .
            </p>
            <p>
              By creating an account, purchasing a subscription, or using the Service, you agree to
              these Terms.
            </p>
          </div>
        </header>

        <div className="space-y-10 leading-7">
          {sections.map((section) => (
            <section key={section.title}>
              <h2 className="mb-4 font-bold text-2xl text-gray-900">{section.title}</h2>
              <div className="space-y-4">
                {section.paragraphs.map((paragraph) => (
                  <p key={paragraph} className="whitespace-pre-line">
                    {paragraph}
                  </p>
                ))}
              </div>
              {section.bullets && (
                <ul className="mt-4 list-disc space-y-2 pl-6">
                  {section.bullets.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
              )}
              {section.afterBullets && (
                <div className="mt-4 space-y-4">
                  {section.afterBullets.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
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
