import { describe, expect, test } from 'vitest';
import { INLINE_IMAGE_COUNT } from '../src/config';
import type { ImageSlot } from '../src/images';
import {
  buildImagePlanPrompt,
  extractH2s,
  findTextRisk,
  IMAGE_COMPOSITIONS,
  IMAGE_LIGHTING,
  IMAGE_MEDIA,
  imagePrompt,
  injectImageAfterHeading,
  NO_TEXT_DIRECTIVE,
  parseImagePlan,
  usableObjects,
  withNoTextDirective,
} from '../src/images';

const content = '# Title\n\nintro\n\n## First Section\n\nbody one\n\n## Second Section\n\nbody two';
const headings = ['First Section', 'Second Section'];

const validPlan = {
  medium: 'photograph',
  cover: {
    subject: 'a hero idea',
    composition: 'still_life',
    lighting: 'natural_daylight',
    palette: 'warm amber and slate',
    objects: ['brass gear'],
    alt: 'a hero image',
  },
  inline: [
    {
      subject: 's1',
      composition: 'macro',
      lighting: 'soft_studio',
      palette: '',
      objects: ['stone'],
      alt: 'alt one',
      section_heading: 'First Section',
    },
    {
      subject: 's2',
      composition: 'abstract',
      lighting: 'cool_ambient',
      palette: '',
      objects: [],
      alt: 'alt two',
      section_heading: 'Second Section',
    },
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
  // asking for lettering. It names objects and enums (#309) and never sees a prompt.
  test('asks for enums and objects and says its answer is not the prompt', () => {
    const [system, user] = buildImagePlanPrompt(input).map((m) => String(m.content));
    for (const value of [...IMAGE_MEDIA, ...IMAGE_COMPOSITIONS, ...IMAGE_LIGHTING]) {
      expect(system).toContain(value);
    }
    expect(system).toContain('DIFFERENT composition');
    expect(system).toContain('palette');
    expect(system).toContain('carries writing');
    expect(system).toContain('You are NOT writing the image prompt');
    expect(system).toContain('not "Raspberry Pi"');
    expect(user).toContain('Preferred image style: flat illustration');
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

  test('rejects an inline entry without a section heading', () => {
    const { section_heading: _dropped, ...bare } = validPlan.inline[0]!;
    const omitted = { ...validPlan, inline: [bare, validPlan.inline[1]!] };
    expect(() => parseImagePlan(JSON.stringify(omitted), headings)).toThrow();
  });

  test('rejects an unknown medium or composition', () => {
    expect(() =>
      parseImagePlan(JSON.stringify({ ...validPlan, medium: 'oil' }), headings),
    ).toThrow();
    const bad = { ...validPlan, cover: { ...validPlan.cover, composition: 'collage' } };
    expect(() => parseImagePlan(JSON.stringify(bad), headings)).toThrow();
  });

  test('rejects unknown and duplicate headings, and empty alt', () => {
    const unknown = {
      ...validPlan,
      inline: [validPlan.inline[0]!, { ...validPlan.inline[1]!, section_heading: 'Nope' }],
    };
    expect(() => parseImagePlan(JSON.stringify(unknown), headings)).toThrow(/unknown heading/);

    const dup = {
      ...validPlan,
      inline: [validPlan.inline[0]!, { ...validPlan.inline[1]!, section_heading: 'First Section' }],
    };
    expect(() => parseImagePlan(JSON.stringify(dup), headings)).toThrow(/reuses heading/);

    const emptyAlt = { ...validPlan, cover: { ...validPlan.cover, alt: '' } };
    expect(() => parseImagePlan(JSON.stringify(emptyAlt), headings)).toThrow();
  });

  // #309: variety is enforced, not requested. A duplicate takes the first
  // unused composition in IMAGE_COMPOSITIONS order.
  test('reassigns duplicate compositions so the three slots differ', () => {
    const same = {
      ...validPlan,
      cover: { ...validPlan.cover, composition: 'macro' },
      inline: [
        { ...validPlan.inline[0]!, composition: 'macro' },
        { ...validPlan.inline[1]!, composition: 'macro' },
      ],
    };
    const plan = parseImagePlan(JSON.stringify(same), headings);
    expect([plan.cover.composition, ...plan.inline.map((i) => i.composition)]).toEqual([
      'macro',
      'still_life',
      'environment',
    ]);
  });

  test('leaves already-distinct compositions alone', () => {
    const plan = parseImagePlan(JSON.stringify(validPlan), headings);
    expect([plan.cover.composition, ...plan.inline.map((i) => i.composition)]).toEqual([
      'still_life',
      'macro',
      'abstract',
    ]);
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

describe('imagePrompt', () => {
  const slot = (patch: Partial<Omit<ImageSlot, 'alt'>>): Omit<ImageSlot, 'alt'> => ({
    subject: 'deployment automation',
    composition: 'still_life',
    lighting: 'natural_daylight',
    palette: '',
    objects: ['server rack', 'coiled cable'],
    ...patch,
  });

  test.each([
    ['photograph', 'A photograph of server rack, coiled cable, arranged on a plain surface.'],
    [
      'flat_illustration',
      'A flat vector illustration of server rack, coiled cable, arranged on a plain surface.',
    ],
    [
      'three_d_render',
      'A 3D rendered scene of server rack, coiled cable, arranged on a plain surface.',
    ],
    [
      'watercolor',
      'A watercolor painting of server rack, coiled cable, arranged on a plain surface.',
    ],
    [
      'line_art',
      'A minimal line-art illustration of server rack, coiled cable, arranged on a plain surface.',
    ],
    [
      'isometric',
      'An isometric illustration of server rack, coiled cable, arranged on a plain surface.',
    ],
  ] as const)('opens with the %s medium clause', (medium, opening) => {
    expect(imagePrompt(medium, slot({})).startsWith(opening)).toBe(true);
  });

  test.each([
    ['macro', 'an extreme close-up of server rack, showing its texture and detail'],
    [
      'environment',
      'a wide scene evoking deployment automation, with server rack, coiled cable in their natural setting',
    ],
    [
      'abstract',
      'abstract shapes, light and texture evoking deployment automation, with no recognisable objects',
    ],
    ['silhouette', 'server rack, coiled cable in silhouette against a bright, plain background'],
    ['top_down', 'server rack, coiled cable seen from directly above, laid out on a plain surface'],
  ] as const)('renders the %s composition', (composition, clause) => {
    expect(imagePrompt('photograph', slot({ composition }))).toContain(clause);
  });

  test('environment without objects omits the setting clause', () => {
    const prompt = imagePrompt('photograph', slot({ composition: 'environment', objects: [] }));
    expect(prompt).toContain('a wide scene evoking deployment automation.');
    expect(prompt).not.toContain('natural setting');
  });

  // An abstract topic gets an evocative scene instead of blank stationery (#309).
  test('compositions that need objects downgrade to abstract when none survive', () => {
    for (const composition of ['still_life', 'macro', 'silhouette', 'top_down'] as const) {
      const prompt = imagePrompt(
        'photograph',
        slot({ composition, objects: ['architecture diagram', 'laptop'] }),
      );
      expect(prompt).toContain('abstract shapes, light and texture evoking deployment automation');
      expect(prompt).not.toContain('diagram');
    }
  });

  test('carries lighting and a safe palette, drops a risky or empty one', () => {
    const lit = imagePrompt(
      'photograph',
      slot({ lighting: 'golden_hour', palette: 'warm amber and slate' }),
    );
    expect(lit).toContain('Warm golden-hour light with long shadows.');
    expect(lit).toContain('Palette: warm amber and slate.');
    expect(imagePrompt('photograph', slot({ palette: 'neon signage colours' }))).not.toContain(
      'Palette:',
    );
    expect(imagePrompt('photograph', slot({ palette: '  ' }))).not.toContain('Palette:');
  });

  // Measured: given prose and no such clause, fal renders the prompt itself as
  // a page of garbled text (#286).
  test('always disclaims being a document, worded per medium', () => {
    expect(imagePrompt('photograph', slot({}))).toContain(
      'A real physical scene, not a document, page, poster, slide or screen.',
    );
    expect(imagePrompt('line_art', slot({}))).toContain(
      'A single illustrated scene, not a document, page, poster, slide, chart or screen.',
    );
    for (const medium of IMAGE_MEDIA) {
      const prompt = imagePrompt(medium, slot({}));
      expect(prompt).toContain('No text, lettering, signage or logos anywhere in the frame.');
      expect(findTextRisk(prompt)).toBeNull();
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
