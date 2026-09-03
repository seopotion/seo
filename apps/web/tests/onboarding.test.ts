import { SetupPresetsSchema } from '@shared/schemas';
import { describe, expect, test } from 'vitest';
import {
  buildFinalizeBody,
  buildPresetsPatch,
  mapPresetsToFormPatch,
} from '../app/[locale]/(authenticated)/onboarding/api';
import {
  competitorErrorKey,
  MAX_COMPETITORS,
  normalizeCompetitorDomain,
  normalizeCompetitorList,
  prepareCompetitor,
} from '../app/[locale]/(authenticated)/onboarding/competitors';
import {
  initialForm,
  MAX_TARGET_AUDIENCES,
} from '../app/[locale]/(authenticated)/onboarding/constants';
import {
  clearOnboardingIntegrations,
  toOnboardingIntegrationIds,
} from '../app/[locale]/(authenticated)/onboarding/integrations';
import type { OnboardingForm, TextEntry } from '../app/[locale]/(authenticated)/onboarding/types';
import {
  stringsToTextEntries,
  textEntriesToStrings,
} from '../app/[locale]/(authenticated)/onboarding/utils';
import { validateStep } from '../app/[locale]/(authenticated)/onboarding/validation';
import enMessages from '../messages/en.json';
import trMessages from '../messages/tr.json';

const connectedAt = '2026-08-20T12:00:00.000Z';

function entries(values: string[]): TextEntry[] {
  return values.map((value, index) => ({ id: `audience-${index}`, value }));
}

function validateAudience(targetAudience: TextEntry[], audienceDraft = '') {
  const form: OnboardingForm = { ...initialForm, targetAudience };

  return validateStep({
    audienceDraft,
    competitorDraft: '',
    form,
    scanState: 'complete',
    stepIndex: 2,
    t: (key, values) => (values ? `${key}:${values.max}` : key),
  });
}

function competitorEntries(values: string[]): TextEntry[] {
  return values.map((value, index) => ({ id: `competitor-${index}`, value }));
}

function validateCompetitors(competitors: TextEntry[], { competitorDraft = '' } = {}) {
  const form: OnboardingForm = { ...initialForm, competitors };

  return validateStep({
    audienceDraft: 'Plant operators',
    competitorDraft,
    form,
    scanState: 'complete',
    stepIndex: 2,
    t: (key, values) => (values ? `${key}:${values.max}` : key),
  });
}

describe('onboarding integrations', () => {
  test('finalize sends verified integration IDs and a trimmed referral source', () => {
    const form: OnboardingForm = {
      ...initialForm,
      integrations: ['wordpress'],
      referralSource: ' LinkedIn ',
    };

    expect(buildFinalizeBody('org-1', form, ['wordpress'])).toEqual({
      org_id: 'org-1',
      referral_source: 'LinkedIn',
      integrations: ['wordpress'],
    });
  });

  test('finalize keeps integration metadata optional', () => {
    expect(buildFinalizeBody('org-1', initialForm, [])).toEqual({
      org_id: 'org-1',
      integrations: [],
    });
  });

  test('finalize ignores stale form metadata and uses the freshly verified providers', () => {
    const staleForm: OnboardingForm = {
      ...initialForm,
      integrations: ['wordpress'],
    };

    expect(buildFinalizeBody('org-2', staleForm, [])).toEqual({
      org_id: 'org-2',
      integrations: [],
    });
  });

  test('changing or rescanning a website clears providers from the previous org', () => {
    const form: OnboardingForm = {
      ...initialForm,
      integrations: ['wordpress'],
    };

    expect(clearOnboardingIntegrations(form).integrations).toEqual([]);
    expect(clearOnboardingIntegrations(initialForm)).toBe(initialForm);
  });

  test('maps persisted connections to onboarding provider IDs without duplicates', () => {
    expect(
      toOnboardingIntegrationIds([
        {
          id: 'wordpress-1',
          provider: 'wordpress',
          target: 'https://example.com',
          connected_at: connectedAt,
          last_error: null,
        },
        {
          id: 'static-site-1',
          provider: 'static-site',
          target: 'owner/repo@main',
          connected_at: connectedAt,
          last_error: null,
        },
        {
          id: 'wordpress-2',
          provider: 'wordpress',
          target: 'https://example.com',
          connected_at: connectedAt,
          last_error: null,
        },
      ]),
    ).toEqual(['wordpress', 'static-site']);
  });
});

describe('onboarding CTA preference', () => {
  test('defaults to enabled and persists an explicit disabled choice', () => {
    expect(initialForm.includeCta).toBe(true);

    const patch = buildPresetsPatch({ ...initialForm, includeCta: false });
    expect(patch.article_preferences?.engagement?.include_cta).toBe(false);
  });

  test('hydrates the CTA choice from generated presets', () => {
    const presets = SetupPresetsSchema.parse({
      business: { name: 'Acme', language: 'English', country: 'US', description: 'Widgets' },
      audience: { target: ['Makers'], competitors: [] },
      blog: { sitemap_url: '', main_blog_url: '', best_articles: [] },
      article_preferences: {
        content_seo: { article_style: 'Practical', llm_instructions: '' },
        engagement: {
          image_direction: { medium: 'photograph', palette: '', notes: '' },
          include_cta: false,
        },
      },
    });

    expect(mapPresetsToFormPatch(presets).includeCta).toBe(false);
  });

  test('provides CTA labels in English and Turkish settings surfaces', () => {
    expect(enMessages.Onboarding.articleSettings.includeCta).toBe('Call to action');
    expect(enMessages.ArticleSettingsPage.fields.includeCta.label).toBe('Call to action');
    expect(trMessages.Onboarding.articleSettings.includeCta).toBe('Harekete geçirici mesaj');
    expect(trMessages.ArticleSettingsPage.fields.includeCta.label).toBe('Harekete geçirici mesaj');
  });
});

describe('competitor normalization', () => {
  test('reduces any URL form to the bare domain DataForSEO receives', () => {
    for (const [input, domain] of [
      ['competitor.com', 'competitor.com'],
      ['  https://WWW.Competitor.com/pricing?utm=1#top  ', 'competitor.com'],
      ['http://competitor.com:8080', 'competitor.com'],
      ['www.competitor.com/', 'competitor.com'],
      ['sub.competitor.co.uk', 'sub.competitor.co.uk'],
    ]) {
      expect(normalizeCompetitorDomain(input as string)).toEqual({ ok: true, domain });
    }
  });

  test('punycodes an internationalized domain the way the provider expects', () => {
    expect(normalizeCompetitorDomain('münchen.de')).toEqual({
      ok: true,
      domain: 'xn--mnchen-3ya.de',
    });
  });

  test('rejects a company name rather than turning it into a garbage target', () => {
    // The failure this whole field guards against: `bareDomain('Acme Corp')`
    // happily returns "acme corp" and the provider lookup silently finds nothing.
    for (const value of ['Acme Corp', 'acme', 'localhost', '.com', '-bad.com', '1.2.3.4']) {
      expect(normalizeCompetitorDomain(value)).toEqual({ ok: false, reason: 'not_a_domain' });
    }
  });

  test('reports an empty value separately from an unparseable one', () => {
    expect(normalizeCompetitorDomain('   ')).toEqual({ ok: false, reason: 'empty' });
  });
});

describe('competitor entry rules', () => {
  test('treats a URL for an already-listed domain as a duplicate', () => {
    expect(prepareCompetitor('https://www.competitor.com/blog', ['competitor.com'])).toEqual({
      ok: false,
      reason: 'duplicate',
    });
  });

  test('caps the list — each competitor is its own provider request', () => {
    const existing = Array.from({ length: MAX_COMPETITORS }, (_, index) => `rival${index}.com`);

    expect(prepareCompetitor('newrival.com', existing)).toEqual({ ok: false, reason: 'max' });
    expect(prepareCompetitor('newrival.com', existing.slice(1))).toEqual({
      ok: true,
      domain: 'newrival.com',
    });
  });

  test('maps every rejection to a message key both surfaces share', () => {
    expect(competitorErrorKey('duplicate')).toBe('competitorsDuplicate');
    expect(competitorErrorKey('max')).toBe('competitorsMax');
    expect(competitorErrorKey('not_a_domain')).toBe('competitorDomain');
    expect(competitorErrorKey('empty')).toBe('competitorDomain');
  });

  test('normalizes a stored list, dropping unusable values and duplicates', () => {
    expect(
      normalizeCompetitorList([
        'https://www.pani.global/',
        'Acme Corp',
        'pani.global',
        'rival.io/pricing',
      ]),
    ).toEqual(['pani.global', 'rival.io']);
  });
});

describe('onboarding competitor validation', () => {
  test('accepts an empty competitor list without an opt-out', () => {
    expect(validateCompetitors([]).competitors).toBeUndefined();
  });

  test('accepts a competitor still sitting in the draft input', () => {
    expect(
      validateCompetitors([], { competitorDraft: 'competitor.com' }).competitors,
    ).toBeUndefined();
  });

  test('rejects a draft that is not a domain', () => {
    expect(validateCompetitors([], { competitorDraft: 'Acme Corp' }).competitorDraft).toBe(
      'competitorDomain',
    );
    expect(
      validateCompetitors([], { competitorDraft: 'competitor.com' }).competitorDraft,
    ).toBeUndefined();
  });

  test('rejects a stored entry that is not a domain', () => {
    expect(validateCompetitors(competitorEntries(['Acme Corp'])).competitors).toBe(
      'competitorsValidDomains',
    );
  });

  test('counts the draft against the cap', () => {
    const full = competitorEntries(
      Array.from({ length: MAX_COMPETITORS }, (_, index) => `rival${index}.com`),
    );

    expect(validateCompetitors(full).competitors).toBeUndefined();
    expect(validateCompetitors(full, { competitorDraft: 'newrival.com' }).competitors).toBe(
      `competitorsMax:${MAX_COMPETITORS}`,
    );
  });
});

describe('competitor onboarding copy', () => {
  test('describes competitors as optional supplementary evidence in English and Turkish', () => {
    expect(enMessages.Onboarding.audience).toMatchObject({
      competitorUrls: 'Competitor websites (optional)',
      competitorsHelp:
        'If you know genuinely comparable companies, add their domains as an optional supplementary signal. Your strategy works without competitor domains.',
    });
    expect(trMessages.Onboarding.audience).toMatchObject({
      competitorUrls: 'Rakip web siteleri (isteğe bağlı)',
      competitorsHelp:
        'İşletmenizle gerçekten karşılaştırılabilir şirketler biliyorsanız alan adlarını isteğe bağlı ek bir sinyal olarak ekleyin. Stratejiniz rakip alan adları olmadan da çalışır.',
    });
  });

  test('contains no competitor opt-out or required-validation copy', () => {
    expect(enMessages.Onboarding.audience).not.toHaveProperty('competitorsSkip');
    expect(enMessages.Onboarding.audience).not.toHaveProperty('competitorsSkipNote');
    expect(enMessages.Onboarding.validation).not.toHaveProperty('competitorsRequired');
    expect(trMessages.Onboarding.audience).not.toHaveProperty('competitorsSkip');
    expect(trMessages.Onboarding.audience).not.toHaveProperty('competitorsSkipNote');
    expect(trMessages.Onboarding.validation).not.toHaveProperty('competitorsRequired');
  });
});

describe('audience entry mapping', () => {
  test('maps multiple API strings to multiple trimmed entries', () => {
    const mapped = stringsToTextEntries(
      [' Desalination plant operators ', 'Water utility managers'],
      'audience',
    );

    expect(mapped.map((entry) => entry.value)).toEqual([
      'Desalination plant operators',
      'Water utility managers',
    ]);
  });

  test('keeps a natural-language comma in one entry', () => {
    const mapped = stringsToTextEntries(['plant operators, and managers'], 'audience');

    expect(mapped.map((entry) => entry.value)).toEqual(['plant operators, and managers']);
  });

  test('serializes multiple entries to separate strings without joining them', () => {
    expect(textEntriesToStrings(entries(['Plant operators', 'Utility managers']))).toEqual([
      'Plant operators',
      'Utility managers',
    ]);
  });

  test('removes whitespace-only values in both directions', () => {
    expect(
      stringsToTextEntries([' ', ' Operators '], 'audience').map((entry) => entry.value),
    ).toEqual(['Operators']);
    expect(textEntriesToStrings(entries([' ', ' Managers ']))).toEqual(['Managers']);
  });
});

describe('onboarding audience validation', () => {
  test('rejects a draft that would create an eighth entry', () => {
    const errors = validateAudience(
      entries(Array.from({ length: MAX_TARGET_AUDIENCES }, (_, index) => `Audience ${index}`)),
      'Eighth audience',
    );

    expect(errors.targetAudience).toBe(`targetAudienceMax:${MAX_TARGET_AUDIENCES}`);
  });

  test('accepts seven entries', () => {
    const errors = validateAudience(
      entries(Array.from({ length: MAX_TARGET_AUDIENCES }, (_, index) => `Audience ${index}`)),
    );

    expect(errors.targetAudience).toBeUndefined();
  });

  test('still requires at least one entry or draft', () => {
    expect(validateAudience([]).targetAudience).toBe('targetAudienceRequired');
    expect(validateAudience([], 'Audience draft').targetAudience).toBeUndefined();
  });
});
