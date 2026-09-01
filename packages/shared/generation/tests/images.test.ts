import { describe, expect, test } from 'vitest';
import { INLINE_IMAGE_COUNT } from '../src/config';
import {
  buildImagePlanPrompt,
  buildImagePlanRetryPrompt,
  buildWordlessSubjectsPrompt,
  extractH2s,
  findImagePlanTextRisks,
  findTextRisk,
  injectImageAfterHeading,
  NO_TEXT_DIRECTIVE,
  parseImagePlan,
  parseWordlessSubjects,
  withNoTextDirective,
  wordlessPrompt,
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

  test('heading-shaped lines inside a fenced code block are not headings', () => {
    const fenced = [
      '# Title',
      '',
      'intro',
      '',
      '## Real Section',
      '',
      '```markdown',
      '## Fake Section',
      '```',
      '',
      'body',
    ].join('\n');
    expect(extractH2s(fenced)).toEqual(['Real Section']);
  });

  test('honours CommonMark indentation: up to 3 spaces is a heading, 4+ is code', () => {
    expect(extractH2s('   ## Three Space')).toEqual(['Three Space']);
    // 4+ spaces or a tab opens an indented code block — not a heading
    expect(extractH2s('    ## Four Space')).toEqual([]);
    expect(extractH2s('\t## Tab Indented')).toEqual([]);
    // ### stays excluded whatever the indent
    expect(extractH2s('   ### Three Space H3')).toEqual([]);
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

  test('bans text and logos in the planned scene', () => {
    const messages = buildImagePlanPrompt({
      businessName: 'Acme',
      businessDescription: 'widgets',
      language: 'English',
      imageStyle: '',
      articleTitle: 'T',
      metaDescription: 'M',
      headings,
    });
    expect(messages[0]!.content).toContain('NO text and NO logos');
    // An org whose image_style asks for screenshots must not win over the ban.
    expect(messages[0]!.content).toContain('image style NEVER overrides these rules');
  });
});

describe('withNoTextDirective', () => {
  test('appends the no-text ban to the planned prompt', () => {
    const prompt = withNoTextDirective('  a hero scene  ');
    expect(prompt.startsWith('a hero scene')).toBe(true);
    expect(prompt).toContain(NO_TEXT_DIRECTIVE);
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

  test('skips a heading-shaped line inside a fenced code block', () => {
    const fenced = [
      '```markdown',
      '## First Section',
      '```',
      '',
      '## First Section',
      '',
      'body',
    ].join('\n');
    const out = injectImageAfterHeading(fenced, 'First Section', 'alt one', 'https://cdn/x.png');
    const lines = out.split('\n');
    // the code sample is untouched; the image lands after the real heading
    expect(lines.slice(0, 3)).toEqual(['```markdown', '## First Section', '```']);
    expect(lines[5]).toBe('');
    expect(lines[6]).toBe('![alt one](https://cdn/x.png)');
  });
});

describe('findTextRisk', () => {
  test.each([
    ['A technical diagram showing a Git push command', 'diagram'],
    ['A split-screen technical visualization of two architectures', 'split-screen'],
    ['A monitor displaying a dashboard of deployment metrics', 'monitor'],
    ['A workbench with labelled drawers', 'labelled'],
    ['A storefront with signage above the door', 'signage'],
    ['A laptop showing a CLI screenshot', 'screenshot'],
  ])('flags %s', (prompt, term) => {
    expect(findTextRisk(prompt)).toBe(term);
  });

  test.each([
    'A Raspberry Pi and a laptop on a wooden desk under warm lamp light',
    'A server rack with blinking indicators, no text or signage anywhere',
    'A quiet workshop bench, free of lettering and without any logos',
    'Abstract flowing light representing encrypted data, avoiding words',
  ])('passes %s', (prompt) => {
    expect(findTextRisk(prompt)).toBeNull();
  });

  // The gate runs on the PLANNED prompt, before withNoTextDirective appends the
  // ban — the directive names the very surfaces it is forbidding, so it is not
  // meant to survive this check.
});

describe('image plan text gate', () => {
  const risky = {
    cover: { prompt: 'An infographic of the deployment flow', alt: 'a' },
    inline: [
      { prompt: 'A calm photo of a server rack', alt: 'b', section_heading: 'First Section' },
      {
        prompt: 'A whiteboard covered in architecture notes',
        alt: 'c',
        section_heading: 'Second Section',
      },
    ],
  };

  test('reports every offending slot with the term it asked for', () => {
    expect(findImagePlanTextRisks(risky)).toEqual([
      { slot: 'cover', term: 'infographic' },
      { slot: 'Second Section', term: 'whiteboard' },
    ]);
  });

  test('a clean plan has no risks', () => {
    expect(findImagePlanTextRisks(validPlan)).toEqual([]);
  });

  test('the retry names each rejected slot and its term', () => {
    const retry = buildImagePlanRetryPrompt(findImagePlanTextRisks(risky));
    expect(retry.role).toBe('user');
    expect(retry.content).toContain('"cover" asks for infographic');
    expect(retry.content).toContain('"Second Section" asks for whiteboard');
  });

  test('the wordless fallback names the subject and is itself safe', () => {
    const prompt = wordlessPrompt('Setting Up Your Home Server');
    expect(prompt).toContain('Setting Up Your Home Server');
    expect(findTextRisk(prompt)).toBeNull();
  });

  test('with objects it photographs them instead of the abstract subject', () => {
    const prompt = wordlessPrompt('deployment automation', [
      'server rack',
      'network cable',
      'gear',
    ]);
    expect(prompt).toContain('server rack, network cable, gear');
    expect(prompt).not.toContain('evoking deployment automation');
    expect(findTextRisk(prompt)).toBeNull();
  });

  // Measured: given prose and no such clause, fal renders the prompt itself as
  // a page of garbled text (#286).
  test('every fallback disclaims being a document', () => {
    for (const prompt of [wordlessPrompt('a subject'), wordlessPrompt('a subject', ['a stone'])]) {
      expect(prompt).toContain('not a document, page, poster, slide or screen');
    }
  });
});

describe('parseWordlessSubjects', () => {
  const reply = (objects: string[]) => JSON.stringify({ objects });

  test('keeps concrete objects, tidied', () => {
    expect(parseWordlessSubjects(reply(['  server   rack ', 'network cable']))).toEqual([
      'server rack',
      'network cable',
    ]);
  });

  // A returned "deployment badge" came back stamped "NRLUMA B OLOPYMENT".
  test('drops objects that carry writing in real life', () => {
    expect(
      parseWordlessSubjects(
        reply(['server rack', 'deployment badge', 'laptop', 'certificate', 'gear']),
      ),
    ).toEqual(['server rack', 'gear']);
  });

  test('drops objects that name a banned subject outright', () => {
    expect(parseWordlessSubjects(reply(['architecture diagram', 'coiled cable']))).toEqual([
      'coiled cable',
    ]);
  });

  test('caps the list and tolerates an empty answer', () => {
    expect(parseWordlessSubjects(reply(['a', 'b', 'c', 'd', 'e']))).toHaveLength(4);
    expect(parseWordlessSubjects(reply([]))).toEqual([]);
  });

  test('the prompt asks for bare-surfaced objects and carries the business context', () => {
    const messages = buildWordlessSubjectsPrompt('reverse osmosis', 'Clewas sells water filters.');
    expect(messages[0]!.content).toContain('carries writing');
    expect(messages[1]!.content).toContain('reverse osmosis');
    expect(messages[1]!.content).toContain('Clewas sells water filters.');
  });
});
