import { describe, expect, test } from 'vitest';
import { INLINE_IMAGE_COUNT } from '../src/config';
import {
  buildImagePlanPrompt,
  extractH2s,
  injectImageAfterHeading,
  parseImagePlan,
} from '../src/images';

const content = '# Title\n\nintro\n\n## First Section\n\nbody one\n\n## Second Section\n\nbody two';
const headings = ['First Section', 'Second Section'];

const validPlan = {
  cover: { prompt: 'a hero scene', alt: 'a hero image' },
  inline: [
    { prompt: 'p1', alt: 'alt one', section_heading: 'First Section' },
    { prompt: 'p2', alt: 'alt two', section_heading: 'Second Section' },
  ],
};

describe('extractH2s', () => {
  test('returns H2 texts in order, ignoring H1/H3', () => {
    expect(extractH2s(content)).toEqual(headings);
    expect(extractH2s('# only h1\n\n### h3')).toEqual([]);
  });
});

describe('buildImagePlanPrompt', () => {
  test('carries headings, style, language, and the inline count', () => {
    const messages = buildImagePlanPrompt({
      businessName: 'Acme',
      businessDescription: 'widgets',
      language: 'English',
      imageStyle: 'flat illustration',
      articleTitle: 'T',
      metaDescription: 'M',
      headings,
    });
    expect(messages[0]!.role).toBe('system');
    expect(messages[0]!.content).toContain(`exactly ${INLINE_IMAGE_COUNT}`);
    expect(messages[0]!.content).toContain('English');
    expect(messages[1]!.content).toContain('First Section | Second Section');
    expect(messages[1]!.content).toContain('flat illustration');
  });
});

describe('parseImagePlan', () => {
  test('accepts a valid plan (with an optional code fence)', () => {
    expect(parseImagePlan(JSON.stringify(validPlan), headings)).toEqual(validPlan);
    expect(parseImagePlan(`\`\`\`json\n${JSON.stringify(validPlan)}\n\`\`\``, headings)).toEqual(
      validPlan,
    );
  });

  test('rejects wrong inline count', () => {
    const bad = { ...validPlan, inline: validPlan.inline.slice(0, 1) };
    expect(() => parseImagePlan(JSON.stringify(bad), headings)).toThrow(/exactly/);
  });

  test('fills omitted section headings from unused article headings in order', () => {
    const omitted = {
      ...validPlan,
      inline: [
        { prompt: 'p1', alt: 'alt one' },
        { prompt: 'p2', alt: 'alt two', section_heading: 'Second Section' },
      ],
    };

    expect(parseImagePlan(JSON.stringify(omitted), headings)).toEqual(validPlan);
  });

  test('rejects unknown and duplicate headings, and empty alt', () => {
    const unknown = {
      ...validPlan,
      inline: [validPlan.inline[0]!, { prompt: 'p', alt: 'a', section_heading: 'Nope' }],
    };
    expect(() => parseImagePlan(JSON.stringify(unknown), headings)).toThrow(/unknown heading/);

    const dup = {
      ...validPlan,
      inline: [validPlan.inline[0]!, { ...validPlan.inline[1]!, section_heading: 'First Section' }],
    };
    expect(() => parseImagePlan(JSON.stringify(dup), headings)).toThrow(/reuses heading/);

    const emptyAlt = { ...validPlan, cover: { prompt: 'p', alt: '' } };
    expect(() => parseImagePlan(JSON.stringify(emptyAlt), headings)).toThrow();
  });
});

describe('injectImageAfterHeading', () => {
  test('inserts the image right after the heading line', () => {
    const out = injectImageAfterHeading(content, 'First Section', 'alt one', 'https://cdn/x.png');
    const lines = out.split('\n');
    const idx = lines.indexOf('## First Section');
    expect(lines[idx + 1]).toBe('');
    expect(lines[idx + 2]).toBe('![alt one](https://cdn/x.png)');
    // the rest of the document is untouched
    expect(out).toContain('## Second Section\n\nbody two');
  });

  test('is anchored to the exact heading — unknown heading throws', () => {
    expect(() => injectImageAfterHeading(content, 'Missing', 'a', 'u')).toThrow(/not found/);
  });
});
