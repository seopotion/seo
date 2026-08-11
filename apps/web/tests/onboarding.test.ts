import { describe, expect, test } from 'vitest';
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
import type { OnboardingForm, TextEntry } from '../app/[locale]/(authenticated)/onboarding/types';
import {
  stringsToTextEntries,
  textEntriesToStrings,
} from '../app/[locale]/(authenticated)/onboarding/utils';
import { validateStep } from '../app/[locale]/(authenticated)/onboarding/validation';

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

function validateCompetitors(
  competitors: TextEntry[],
  { competitorDraft = '', competitorsSkipped = false } = {},
) {
  const form: OnboardingForm = { ...initialForm, competitors };

  return validateStep({
    audienceDraft: 'Plant operators',
    competitorDraft,
    competitorsSkipped,
    form,
    scanState: 'complete',
    stepIndex: 2,
    t: (key, values) => (values ? `${key}:${values.max}` : key),
  });
}

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
  test('blocks the step when no competitor was given', () => {
    expect(validateCompetitors([]).competitors).toBe('competitorsRequired');
  });

  test('accepts a competitor still sitting in the draft input', () => {
    expect(
      validateCompetitors([], { competitorDraft: 'competitor.com' }).competitors,
    ).toBeUndefined();
  });

  test('lets the deliberate skip through, but only when it was chosen', () => {
    expect(validateCompetitors([], { competitorsSkipped: true }).competitors).toBeUndefined();
    expect(validateCompetitors([], { competitorsSkipped: false }).competitors).toBe(
      'competitorsRequired',
    );
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
