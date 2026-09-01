import { describe, expect, test } from 'vitest';
import { INLINE_IMAGE_COUNT } from '../src/config';
import {
  buildImagePlanPrompt,
  extractH2s,
  findTextRisk,
  injectImageAfterHeading,
  NO_TEXT_DIRECTIVE,
  parseImagePlan,
  photoPrompt,
  usableObjects,
  withNoTextDirective,
} from '../src/images';

const content = '# Title\n\nintro\n\n## First Section\n\nbody one\n\n## Second Section\n\nbody two';
const headings = ['First Section', 'Second Section'];

const validPlan = {
  cover: { subject: 'a hero idea', objects: ['brass gear'], alt: 'a hero image' },
  inline: [
    { subject: 's1', objects: ['stone'], alt: 'alt one', section_heading: 'First Section' },
    { subject: 's2', objects: ['rope'], alt: 'alt two', section_heading: 'Second Section' },
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
  const input = {
    businessName: 'Acme',
    businessDescription: 'widgets',
    language: 'English',
    imageStyle: 'flat illustration',
    articleTitle: 'T',
    metaDescription: 'M',
    headings,
  };

  test('carries headings, style, language, and the inline count', () => {
    const messages = buildImagePlanPrompt(input);
    expect(messages[0]!.role).toBe('system');
    expect(messages[0]!.content).toContain(`exactly ${INLINE_IMAGE_COUNT}`);
    expect(messages[0]!.content).toContain('English');
    expect(messages[1]!.content).toContain('First Section | Second Section');
    expect(messages[1]!.content).toContain('flat illustration');
  });

  // #289: the planner used to write the prompt, and no wording stopped it
  // asking for lettering. It now names objects and never sees a prompt.
  test('asks for objects and says its answer is not the prompt', () => {
    const system = String(buildImagePlanPrompt(input).at(0)!.content);
    expect(system).toContain('objects');
    expect(system).toContain('carries writing');
    expect(system).toContain('You are NOT writing the image prompt');
    expect(system).toContain('not "Raspberry Pi"');
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
        { subject: 's1', objects: ['stone'], alt: 'alt one' },
        { subject: 's2', objects: ['rope'], alt: 'alt two', section_heading: 'Second Section' },
      ],
    };

    expect(parseImagePlan(JSON.stringify(omitted), headings)).toEqual(validPlan);
  });

  test('rejects unknown and duplicate headings, and empty alt', () => {
    const unknown = {
      ...validPlan,
      inline: [
        validPlan.inline[0]!,
        { subject: 's', objects: [], alt: 'a', section_heading: 'Nope' },
      ],
    };
    expect(() => parseImagePlan(JSON.stringify(unknown), headings)).toThrow(/unknown heading/);

    const dup = {
      ...validPlan,
      inline: [validPlan.inline[0]!, { ...validPlan.inline[1]!, section_heading: 'First Section' }],
    };
    expect(() => parseImagePlan(JSON.stringify(dup), headings)).toThrow(/reuses heading/);

    const emptyAlt = { ...validPlan, cover: { subject: 's', objects: [], alt: '' } };
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

describe('photoPrompt', () => {
  test('photographs the objects when there are any', () => {
    const prompt = photoPrompt('deployment automation', ['server rack', 'coiled cable']);
    expect(prompt).toContain('server rack, coiled cable');
    expect(prompt).not.toContain('evoking deployment automation');
    expect(findTextRisk(prompt)).toBeNull();
  });

  test('falls back to the subject when nothing usable survives', () => {
    const prompt = photoPrompt('deployment automation', ['architecture diagram', 'laptop']);
    expect(prompt).toContain('evoking deployment automation');
    expect(findTextRisk(prompt)).toBeNull();
  });

  // Measured: given prose and no such clause, fal renders the prompt itself as
  // a page of garbled text (#286).
  test('always disclaims being a document', () => {
    for (const prompt of [photoPrompt('a subject', []), photoPrompt('a subject', ['a stone'])]) {
      expect(prompt).toContain('not a document, page, poster, slide or screen');
    }
  });
});

describe('usableObjects', () => {
  test('keeps concrete objects, tidied', () => {
    expect(usableObjects(['  server   rack ', 'network cable'])).toEqual([
      'server rack',
      'network cable',
    ]);
  });

  // A returned "deployment badge" came back stamped "NRLUMA B OLOPYMENT".
  test('drops objects that carry writing in real life', () => {
    expect(
      usableObjects(['server rack', 'deployment badge', 'laptop', 'certificate', 'gear']),
    ).toEqual(['server rack', 'gear']);
  });

  test('drops objects that name a banned subject outright', () => {
    expect(usableObjects(['architecture diagram', 'coiled cable'])).toEqual(['coiled cable']);
  });

  test('caps the list and tolerates an empty answer', () => {
    expect(usableObjects(['a', 'b', 'c', 'd', 'e'])).toHaveLength(4);
    expect(usableObjects([])).toEqual([]);
  });
});
