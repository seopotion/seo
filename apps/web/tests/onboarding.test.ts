import { describe, expect, test } from 'vitest';
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
