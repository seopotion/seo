import type { Metadata } from 'next';
import type { Locale } from '@/i18n/routing';
import { languageAlternates, localizedPath } from '@/i18n/urls';

type PrivacyPageProps = {
  params: Promise<{ locale: Locale }>;
};

type PrivacySubsection = {
  afterBullets?: string[];
  bullets?: string[];
  paragraphs: string[];
  title: string;
};

type PrivacySection = {
  afterBullets?: string[];
  bullets?: string[];
  paragraphs: string[];
  subsections?: PrivacySubsection[];
  title: string;
};

const sections: PrivacySection[] = [
  {
    title: '1. Personal Data We Collect',
    paragraphs: ['The personal data we collect depends on how you interact with Seopotion.'],
    subsections: [
      {
        title: 'Account and Contact Information',
        paragraphs: ['When you create or use an account, we may collect:'],
        bullets: [
          'your name;',
          'email address;',
          'account identifiers;',
          'authentication information;',
          'account preferences; and',
          'information you provide when communicating with us.',
        ],
        afterBullets: [
          'Passwords, where used, are stored in secured form rather than as readable plain-text passwords.',
        ],
      },
      {
        title: 'Subscription and Transaction Information',
        paragraphs: [
          'When you purchase a Seopotion subscription through Paddle, we may receive limited information about the transaction, such as:',
        ],
        bullets: [
          'your name;',
          'email address;',
          'billing country or address;',
          'subscription plan;',
          'subscription status;',
          'transaction identifiers;',
          'amounts paid;',
          'purchase and renewal history; and',
          'refund or cancellation status.',
        ],
        afterBullets: [
          'Payment transactions are processed by Paddle, which acts as the Merchant of Record.',
          'Seopotion does not directly process or store your complete payment-card details.',
          'Paddle processes payment and checkout information in accordance with its own privacy policy and applicable terms.',
        ],
      },
    ],
  },
  {
    title: '2. Information You Provide Through Seopotion',
    paragraphs: [
      'To provide the Service, we may process information that you submit to the platform, including:',
    ],
    bullets: [
      'website URLs;',
      'company or business information;',
      'products and services;',
      'target audiences;',
      'countries and languages;',
      'keywords;',
      'content topics;',
      'article instructions;',
      'writing preferences;',
      'prompts;',
      'uploaded or entered text;',
      'content settings;',
      'internal website links;',
      'calls to action;',
      'images or media information; and',
      'other information you choose to provide.',
    ],
    afterBullets: [
      'This information is used to analyze your website and generate, edit, manage, and publish content through Seopotion.',
    ],
  },
  {
    title: '3. Website and Business Information',
    paragraphs: [
      'When you ask Seopotion to analyze a website, we may automatically retrieve and process information available from that website.',
      'This may include:',
    ],
    bullets: [
      'publicly accessible website pages;',
      'page titles and descriptions;',
      'products and services;',
      'business descriptions;',
      'blog content;',
      'internal links;',
      'website structure;',
      'publicly available contact or business information; and',
      "other content necessary to understand the website and provide Seopotion's functionality.",
    ],
    afterBullets: [
      'You should only submit websites that you are authorized to analyze or use with the Service.',
    ],
  },
  {
    title: '4. CMS and Website Integrations',
    paragraphs: [
      'If you connect a content management system or website to Seopotion, we may process:',
    ],
    bullets: [
      'website identifiers;',
      'CMS account or site identifiers;',
      'authentication or access tokens;',
      'integration configuration;',
      'page and post information;',
      'publishing status; and',
      'information necessary to create, edit, or publish content on the connected website.',
    ],
    afterBullets: [
      'We use this information only as necessary to provide the integration and the functionality you request.',
      'You may disconnect supported integrations through the Service where that functionality is available.',
    ],
  },
  {
    title: '5. Generated Content',
    paragraphs: ['We process and store content generated through Seopotion, including:'],
    bullets: [
      'article topics;',
      'outlines;',
      'generated articles;',
      'images or media references;',
      'internal-link recommendations;',
      'content revisions;',
      'publishing information; and',
      'associated settings.',
    ],
    afterBullets: [
      'This information is processed so that you can generate, review, edit, manage, and publish content through the platform.',
    ],
  },
  {
    title: '6. Expert-Led Growth',
    paragraphs: [
      'If you subscribe to Expert-Led Growth, limited additional information may be reviewed by a Seopotion SEO expert in order to provide the human component of the subscription.',
      'This may include:',
    ],
    bullets: [
      'your Seopotion account settings;',
      'website and business information;',
      'generated content;',
      'content priorities;',
      'publishing information; and',
      'communications relating to your account.',
    ],
    afterBullets: [
      'The expert component consists of limited account management and review of selected content generated through the Seopotion platform.',
      'We do not use access to your account for purposes unrelated to providing your Seopotion subscription.',
    ],
  },
  {
    title: '7. Technical and Usage Information',
    paragraphs: [
      'When you visit or use Seopotion, we may automatically collect technical information necessary to operate and secure the Service, such as:',
    ],
    bullets: [
      'IP address;',
      'browser type;',
      'device type;',
      'operating system;',
      'date and time of access;',
      'pages or features accessed;',
      'login activity;',
      'error information;',
      'security events; and',
      'application and server logs.',
    ],
    afterBullets: [
      'We use this information to operate the Service, troubleshoot problems, maintain security, prevent abuse, and understand how the Service performs.',
    ],
  },
  {
    title: '8. Support Communications',
    paragraphs: [
      'If you contact us, we may process information contained in your communication, including:',
    ],
    bullets: [
      'your name;',
      'email address;',
      'message content;',
      'screenshots or files you voluntarily provide;',
      'support history; and',
      'information necessary to investigate your request.',
    ],
    afterBullets: [
      'Please avoid sending sensitive personal information unless it is genuinely necessary to resolve your request.',
    ],
  },
  {
    title: '9. How We Use Personal Data',
    paragraphs: ['We process personal data for purposes including:'],
    subsections: [
      {
        title: 'Providing the Service',
        paragraphs: ['To:'],
        bullets: [
          'create and maintain your account;',
          'analyze websites;',
          'generate content;',
          'provide editing and publishing functionality;',
          'operate CMS integrations;',
          'provide Expert-Led Growth features;',
          'administer subscriptions; and',
          'provide customer support.',
        ],
        afterBullets: [
          'Where applicable, this processing is necessary to provide the Service you have requested and perform our agreement with you.',
        ],
      },
      {
        title: 'Operating and Improving Seopotion',
        paragraphs: ['We may process usage, technical, and service information to:'],
        bullets: [
          'maintain and improve the Service;',
          'diagnose errors;',
          'evaluate feature performance;',
          'improve usability;',
          'maintain system reliability; and',
          'develop new functionality.',
        ],
        afterBullets: [
          'Where applicable, we rely on our legitimate interest in operating and improving Seopotion, provided that those interests do not override your fundamental rights and freedoms.',
        ],
      },
      {
        title: 'Security and Fraud Prevention',
        paragraphs: ['We may process information to:'],
        bullets: [
          'protect accounts;',
          'detect unauthorized access;',
          'investigate abuse;',
          'prevent fraud;',
          'enforce our Terms of Service; and',
          'protect Seopotion and its users.',
        ],
      },
      {
        title: 'Legal Compliance',
        paragraphs: ['We may process and retain information when necessary to:'],
        bullets: [
          'comply with applicable laws;',
          'comply with lawful governmental or regulatory requests;',
          'maintain legally required records;',
          'establish, exercise, or defend legal claims; and',
          'comply with accounting, tax, fraud-prevention, or other legal obligations.',
        ],
      },
      {
        title: 'Communications',
        paragraphs: ['We may use your contact information to send:'],
        bullets: [
          'account notifications;',
          'security alerts;',
          'subscription information;',
          'service announcements;',
          'support responses; and',
          'other communications necessary to provide the Service.',
        ],
      },
    ],
  },
  {
    title: '10. Marketing Communications',
    paragraphs: [
      'We will not use personal data received from Paddle solely for product fulfillment or transaction administration to send unrelated direct marketing unless we have an appropriate legal basis or consent where required.',
      'If you separately choose to receive marketing communications from Seopotion, you may unsubscribe at any time using the unsubscribe mechanism provided or by contacting support@seopotion.co.',
      'Service-related communications, such as security notices, transaction-related information, or important changes to the Service, are not marketing communications and may still be sent when necessary.',
    ],
  },
  {
    title: '11. Legal Bases for Processing',
    paragraphs: [
      'Depending on your location and the circumstances, we may process personal data on one or more of the following legal bases:',
    ],
    bullets: [
      'processing is necessary to enter into or perform an agreement with you;',
      'processing is necessary for compliance with a legal obligation;',
      'processing is necessary for our legitimate interests, provided those interests do not override your rights and freedoms;',
      'processing is necessary for the establishment, exercise, or protection of legal rights; or',
      'you have provided consent where consent is required.',
    ],
    afterBullets: [
      'Where processing is based on consent, you may withdraw that consent at any time, without affecting processing that occurred lawfully before withdrawal.',
    ],
  },
  {
    title: '12. How We Share Personal Data',
    paragraphs: [
      'We do not sell your personal data.',
      'We may share personal data only where reasonably necessary to operate Seopotion, including with the categories described below.',
    ],
    subsections: [
      {
        title: 'Paddle',
        paragraphs: [
          'Paddle processes purchases as Merchant of Record.',
          'Paddle independently collects and processes payment and transaction information under its own privacy policy.',
          'Paddle may provide Seopotion with limited customer and transaction information necessary to:',
        ],
        bullets: [
          'deliver the Service;',
          'administer subscriptions;',
          'provide customer support;',
          'process orders;',
          'handle refunds and cancellations;',
          'prevent fraud; and',
          'maintain transaction records.',
        ],
      },
      {
        title: 'Hosting and Infrastructure Providers',
        paragraphs: ['We may use third-party infrastructure and hosting providers to:'],
        bullets: [
          'host the website and application;',
          'operate databases;',
          'store data;',
          'deliver network infrastructure; and',
          'maintain backups and security.',
        ],
        afterBullets: [
          'These providers may process personal data only to the extent necessary to provide their services to us.',
        ],
      },
      {
        title: 'AI and Software Service Providers',
        paragraphs: [
          'Seopotion may use third-party technology providers, including artificial-intelligence and software infrastructure providers, to perform functions such as:',
        ],
        bullets: [
          'generating or analyzing content;',
          'processing text;',
          'analyzing websites;',
          'providing application infrastructure; and',
          'supporting Service functionality.',
        ],
        afterBullets: [
          'Information submitted to Seopotion may therefore be processed by these providers where necessary to provide requested functionality.',
          'You should not submit sensitive personal data, confidential personal records, health information, financial credentials, government identification numbers, or other highly sensitive information as article instructions or content unless strictly necessary and legally permitted.',
        ],
      },
      {
        title: 'Service Providers',
        paragraphs: ['We may use other providers for functions such as:'],
        bullets: [
          'email delivery;',
          'customer support;',
          'security;',
          'monitoring;',
          'analytics;',
          'error reporting; and',
          'technical infrastructure.',
        ],
        afterBullets: [
          'We require service providers to process personal data only for appropriate purposes and subject to applicable data-protection requirements.',
        ],
      },
      {
        title: 'Legal Requirements',
        paragraphs: ['We may disclose information where reasonably necessary to:'],
        bullets: [
          'comply with applicable law;',
          'respond to lawful requests from authorities;',
          'enforce our agreements;',
          'prevent fraud or security incidents;',
          'protect the rights or safety of Seopotion, our users, or others; or',
          'establish, exercise, or defend legal claims.',
        ],
      },
    ],
  },
  {
    title: '13. Third-Party Personal Data',
    paragraphs: [
      'You may provide Seopotion with information that relates to other individuals, for example through website content or material included in article instructions.',
      'If you provide personal data relating to another person, you are responsible for ensuring that you have an appropriate legal basis and authority to provide and process that information through Seopotion.',
      'Seopotion is not intended to be used as a repository for sensitive personal information.',
    ],
  },
  {
    title: '14. International Data Transfers',
    paragraphs: [
      'Seopotion operates from Türkiye and may use technology and service providers located in other countries.',
      'As a result, personal data may be processed or stored outside your country of residence, including in countries whose data-protection laws may differ from those in your jurisdiction.',
      'Where applicable law requires safeguards for an international transfer of personal data, we will use a legally permitted transfer mechanism or other appropriate safeguards.',
      'This may include contractual safeguards or other transfer mechanisms recognized under applicable data-protection law.',
    ],
  },
  {
    title: '15. Data Retention',
    paragraphs: [
      'We retain personal data only for as long as reasonably necessary for the purposes for which it was collected, including to:',
    ],
    bullets: [
      'provide an active account and subscription;',
      'maintain content and publishing history;',
      'provide customer support;',
      'maintain security and prevent fraud;',
      'meet legal, tax, accounting, and regulatory requirements;',
      'resolve disputes; and',
      'enforce our agreements.',
    ],
    afterBullets: [
      'The retention period may differ depending on the type of information and our legal obligations.',
      'When personal data is no longer reasonably required, we will delete, anonymize, or otherwise securely dispose of it, subject to applicable legal requirements and reasonable backup-retention practices.',
    ],
  },
  {
    title: '16. Account Closure and Deletion',
    paragraphs: [
      'You may request closure of your Seopotion account by contacting support@seopotion.co.',
      'When an account is closed, we will delete or anonymize personal data that is no longer necessary, subject to information we must retain for legitimate legal, security, fraud-prevention, transaction, or recordkeeping purposes.',
      "Information processed independently by Paddle remains subject to Paddle's retention practices and privacy policy.",
    ],
  },
  {
    title: '17. Security',
    paragraphs: [
      'We use reasonable technical and organizational safeguards designed to protect personal data against:',
    ],
    bullets: [
      'unauthorized access;',
      'unlawful processing;',
      'accidental loss;',
      'alteration;',
      'disclosure; and',
      'destruction.',
    ],
    afterBullets: [
      'However, no internet-based service or method of electronic storage can be guaranteed to be completely secure.',
      'You are responsible for maintaining the confidentiality of your account credentials and for promptly notifying us if you suspect unauthorized access to your account.',
    ],
  },
  {
    title: '18. Cookies and Similar Technologies',
    paragraphs: [
      'Seopotion may use strictly necessary cookies or similar technologies required for:',
    ],
    bullets: [
      'authentication;',
      'security;',
      'maintaining sessions;',
      'remembering essential preferences; and',
      'operating the Service.',
    ],
    afterBullets: [
      'If Seopotion introduces non-essential analytics, advertising, or marketing cookies that require consent under applicable law, we will provide appropriate information and consent controls before using those technologies where legally required.',
      'Third-party services embedded in or connected to Seopotion may operate their own technologies in accordance with their privacy policies.',
    ],
  },
  {
    title: '19. Your Privacy Rights',
    paragraphs: [
      'Depending on where you live, applicable data-protection laws may give you rights regarding your personal data.',
      'These may include the right to:',
    ],
    bullets: [
      'learn whether we process your personal data;',
      'request information about personal data we process;',
      'understand the purposes for which your data is used;',
      'know the recipients or categories of recipients to whom your personal data has been transferred;',
      'request correction of inaccurate or incomplete information;',
      'request deletion or destruction of personal data where legally applicable;',
      'request that corrections or deletions be communicated to relevant recipients where required;',
      'object to certain processing;',
      'object to certain decisions based solely on automated processing where applicable;',
      'request restriction of processing where applicable;',
      'receive or request portability of your personal data where applicable;',
      'withdraw consent where processing is based on consent; and',
      'lodge a complaint with a competent data-protection authority.',
    ],
    afterBullets: [
      'Under Türkiye\'s Personal Data Protection Law No. 6698 ("KVKK"), data subjects also have the rights provided under Article 11 of that law.',
    ],
  },
  {
    title: '20. Exercising Your Rights',
    paragraphs: [
      'To make a privacy request, contact support@seopotion.co.',
      'Please describe the request and identify the account or email address concerned.',
      'We may request additional information where reasonably necessary to verify your identity and protect your information from unauthorized disclosure.',
      'We will respond within the period required by applicable law.',
      "Requests under Türkiye's KVKK will be handled in accordance with the procedures and time limits established under applicable Turkish data-protection law.",
    ],
  },
  {
    title: '21. Automated and AI-Assisted Processing',
    paragraphs: [
      'Seopotion uses automated and artificial-intelligence technologies as part of its content-generation and website-analysis functionality.',
      'These systems may process information you provide in order to:',
    ],
    bullets: [
      'analyze websites;',
      'identify content topics;',
      'generate article outlines;',
      'generate or revise written content;',
      'recommend internal links;',
      'assist with content planning; and',
      'provide related software functionality.',
    ],
    afterBullets: [
      'These automated systems are primarily used to create and assist with website content.',
      "We do not use Seopotion's content-generation systems to make decisions that determine your eligibility for employment, credit, insurance, healthcare, or similar significant legal or personal matters.",
    ],
  },
  {
    title: '22. Children',
    paragraphs: [
      'Seopotion is not directed at children and is not designed as a service for children.',
      'We do not knowingly collect personal data from children who are not legally able to provide the information or use the Service under applicable law.',
      'If you believe a child has provided us with personal information inappropriately, contact us at support@seopotion.co.',
    ],
  },
  {
    title: '23. Third-Party Websites',
    paragraphs: [
      'Seopotion may contain links to or integrate with websites and services operated by third parties.',
      'Their collection and processing of personal information is governed by their own privacy policies and practices.',
      'We are not responsible for the privacy practices of third-party websites or services that we do not control.',
    ],
  },
  {
    title: '24. Changes to This Privacy Policy',
    paragraphs: [
      'We may update this Privacy Policy as Seopotion develops, our processing practices change, or applicable laws and regulations change.',
      'We will publish the current version at seopotion.co and update the "Last updated" date above.',
      'Where required by applicable law, we will provide additional notice or obtain consent before making a material change that affects how personal data is processed.',
    ],
  },
  {
    title: '25. Contact',
    paragraphs: [
      'For questions, requests, or concerns concerning this Privacy Policy or the processing of your personal data, contact:',
      'Deniz Yazagan\nData Controller and operator of Seopotion\nIstanbul, Türkiye',
      'Email: support@seopotion.co\nWebsite: seopotion.co',
    ],
  },
];

export async function generateMetadata({ params }: PrivacyPageProps): Promise<Metadata> {
  const { locale } = await params;
  const canonical = localizedPath('/privacy', locale);

  return {
    title: 'Privacy Policy',
    description: 'Privacy Policy for Seopotion.',
    alternates: {
      canonical,
      languages: languageAlternates('/privacy'),
    },
  };
}

function PolicyContent({
  afterBullets,
  paragraphs,
  bullets,
}: Pick<PrivacySection, 'afterBullets' | 'paragraphs' | 'bullets'>) {
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

export default function PrivacyPage() {
  return (
    <main className="bg-white px-6 py-16 text-gray-700 sm:py-24">
      <article className="mx-auto max-w-3xl">
        <header className="mb-12 border-gray-200 border-b pb-8">
          <h1 className="font-bold text-4xl text-gray-900 sm:text-5xl">Privacy Policy</h1>
          <p className="mt-4 text-gray-500">Last updated: August 13, 2026</p>
          <div className="mt-8 space-y-4 leading-7">
            <p>
              This Privacy Policy explains how personal data is collected, used, stored, and shared
              when you visit seopotion.co, create a Seopotion account, use the Seopotion software
              platform, purchase a subscription, or otherwise interact with us.
            </p>
            <p>
              Seopotion is operated by Deniz Yazagan, an individual operating from Türkiye
              (&quot;Seopotion&quot;, &quot;we&quot;, &quot;us&quot;, or &quot;our&quot;).
            </p>
            <p>
              For personal data processed directly by Seopotion, Deniz Yazagan is the data
              controller.
            </p>
            <p>You may contact us regarding privacy matters at:</p>
            <p className="whitespace-pre-line">
              Email: support@seopotion.co{`\n`}Website: seopotion.co{`\n`}Location: Istanbul,
              Türkiye
            </p>
          </div>
        </header>

        <div className="space-y-10 leading-7">
          {sections.map((section) => (
            <section key={section.title}>
              <h2 className="mb-4 font-bold text-2xl text-gray-900">{section.title}</h2>
              <PolicyContent
                afterBullets={section.afterBullets}
                paragraphs={section.paragraphs}
                bullets={section.bullets}
              />
              {section.subsections && (
                <div className="mt-6 space-y-6">
                  {section.subsections.map((subsection) => (
                    <section key={subsection.title}>
                      <h3 className="mb-3 font-semibold text-xl text-gray-900">
                        {subsection.title}
                      </h3>
                      <PolicyContent
                        afterBullets={subsection.afterBullets}
                        paragraphs={subsection.paragraphs}
                        bullets={subsection.bullets}
                      />
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
