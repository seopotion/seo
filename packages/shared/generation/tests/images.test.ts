import { IMAGE_MEDIA, type ImageDirection } from '@shared/schemas';
import { describe, expect, test } from 'vitest';
import { INLINE_IMAGE_COUNT } from '../src/config';
import type { ImageSlot } from '../src/images';
import {
  buildImagePlanPrompt,
  diagramLabels,
  extractH2s,
  findTextRisk,
  IMAGE_COMPOSITIONS,
  IMAGE_LIGHTING,
  IMAGE_PLAN_RESPONSE_SCHEMA,
  imagePrompt,
  injectImageAfterHeading,
  MAX_DIAGRAM_LABELS,
  NO_TEXT_DIRECTIVE,
  parseImagePlan,
  usableObjects,
  withNoTextDirective,
} from '../src/images';

const content = '# Title\n\nintro\n\n## First Section\n\nbody one\n\n## Second Section\n\nbody two';
const headings = ['First Section', 'Second Section'];

const validPlan = {
  cover: {
    subject: 'a hero idea',
    composition: 'still_life',
    lighting: 'natural_daylight',
    objects: ['brass gear'],
    alt: 'a hero image',
  },
  inline: [
    {
      subject: 's1',
      composition: 'macro',
      lighting: 'soft_studio',
      objects: ['stone'],
      alt: 'alt one',
      section_heading: 'First Section',
    },
    {
      subject: 's2',
      composition: 'abstract',
      lighting: 'cool_ambient',
      objects: [],
      alt: 'alt two',
      section_heading: 'Second Section',
    },
  ],
};

const photo: ImageDirection = { medium: 'photograph', palette: '', notes: '' };
const direction = (patch: Partial<ImageDirection>): ImageDirection => ({ ...photo, ...patch });

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
    imageDirection: direction({ medium: 'flat_illustration', notes: 'hardware, workbenches' }),
    articleTitle: 'T',
    metaDescription: 'M',
    headings,
  };

  test('carries headings, language, and the inline count', () => {
    const messages = buildImagePlanPrompt(input);
    expect(messages[0]!.role).toBe('system');
    expect(messages[0]!.content).toContain(`exactly ${INLINE_IMAGE_COUNT}`);
    expect(messages[0]!.content).toContain('English');
    expect(messages[1]!.content).toContain('First Section | Second Section');
  });

  // #312: the medium is fixed by the org preset; the planner is told which
  // kind of picture it is planning for and what subjects the org favours.
  test('states the preset medium and notes instead of asking for them', () => {
    const [system, user] = buildImagePlanPrompt(input).map((m) => String(m.content));
    expect(user).toContain('Images are flat vector illustrations.');
    expect(user).toContain('Subject preferences: hardware, workbenches');
    expect(system).not.toContain('medium:');
    expect(system).not.toContain('palette');
  });

  test('omits the subject line when notes are empty', () => {
    const [, user] = buildImagePlanPrompt({ ...input, imageDirection: photo }).map((m) =>
      String(m.content),
    );
    expect(user).toContain('Images are photographs.');
    expect(user).not.toContain('Subject preferences');
  });

  // #289: the planner used to write the prompt, and no wording stopped it
  // asking for lettering. It names objects and enums (#309) and never sees a prompt.
  test('asks for enums and objects and says its answer is not the prompt', () => {
    const [system] = buildImagePlanPrompt(input).map((m) => String(m.content));
    for (const value of [...IMAGE_COMPOSITIONS, ...IMAGE_LIGHTING]) {
      expect(system).toContain(value);
    }
    expect(system).toContain('DIFFERENT composition');
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

  test('bans silkscreen printing and chip markings on circuit boards', () => {
    // A local fal render of a still-life/top-down circuit board produced
    // legible garbled digits and a logo-like squiggle in the PCB silkscreen
    // area even with the ban in place — the surfaces list didn't call out
    // circuit boards, so the model treated them as fair game (#312 render check).
    expect(NO_TEXT_DIRECTIVE).toContain('circuit boards');
    expect(NO_TEXT_DIRECTIVE).toContain('silkscreen');
  });
});

describe('parseImagePlan', () => {
  test('accepts a valid plan (with an optional code fence)', () => {
    // The input JSON carries no `labels` (a pre-existing plan shape); the schema
    // default fills it in as an empty list — see 'parseImagePlan labels' below.
    const expected = {
      cover: { ...validPlan.cover, labels: [] },
      inline: validPlan.inline.map((slot) => ({ ...slot, labels: [] })),
    };
    expect(parseImagePlan(JSON.stringify(validPlan), headings)).toEqual(expected);
    expect(parseImagePlan(`\`\`\`json\n${JSON.stringify(validPlan)}\n\`\`\``, headings)).toEqual(
      expected,
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

  test('rejects an unknown composition', () => {
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
    objects: ['server rack', 'coiled cable'],
    labels: [],
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
    expect(imagePrompt(direction({ medium }), slot({})).startsWith(opening)).toBe(true);
  });

  test.each([
    ['macro', 'an extreme close-up of server rack, showing its texture and detail'],
    [
      'environment',
      'a wide scene evoking deployment automation, with server rack, coiled cable in their natural setting',
    ],
    [
      'abstract',
      'an abstract composition of geometric shapes, textured surfaces and light evoking deployment automation, sharp and detailed, with no recognisable objects',
    ],
    ['silhouette', 'server rack, coiled cable in silhouette against a bright, plain background'],
    ['top_down', 'server rack, coiled cable seen from directly above, laid out on a plain surface'],
  ] as const)('renders the %s composition', (composition, clause) => {
    expect(imagePrompt(photo, slot({ composition }))).toContain(clause);
  });

  test('environment without objects omits the setting clause', () => {
    const prompt = imagePrompt(photo, slot({ composition: 'environment', objects: [] }));
    expect(prompt).toContain('a wide scene evoking deployment automation.');
    expect(prompt).not.toContain('natural setting');
  });

  // An abstract topic gets an evocative scene instead of blank stationery (#309).
  test('compositions that need objects downgrade to abstract when none survive', () => {
    for (const composition of ['still_life', 'macro', 'silhouette', 'top_down'] as const) {
      const prompt = imagePrompt(
        photo,
        slot({ composition, objects: ['architecture diagram', 'laptop'] }),
      );
      expect(prompt).toContain('textured surfaces and light evoking deployment automation');
      expect(prompt).not.toContain('diagram');
    }
  });

  test('carries lighting and the preset palette, drops a risky or empty one', () => {
    const lit = imagePrompt(
      direction({ palette: 'warm amber and slate' }),
      slot({ lighting: 'golden_hour' }),
    );
    expect(lit).toContain('Warm golden-hour light with long shadows.');
    expect(lit).toContain('Palette: warm amber and slate.');
    expect(imagePrompt(direction({ palette: 'neon signage colours' }), slot({}))).not.toContain(
      'Palette:',
    );
    expect(imagePrompt(direction({ palette: '  ' }), slot({}))).not.toContain('Palette:');
  });

  // #312: one palette per org, so every slot of every article shares it.
  test('every slot gets the same preset palette', () => {
    const teal = direction({ palette: 'teal and sand' });
    for (const composition of IMAGE_COMPOSITIONS) {
      expect(imagePrompt(teal, slot({ composition }))).toContain('Palette: teal and sand.');
    }
  });

  // Measured: given prose and no such clause, fal renders the prompt itself as
  // a page of garbled text (#286).
  test('always disclaims being a document, worded per medium', () => {
    expect(imagePrompt(photo, slot({}))).toContain(
      'A real physical scene, not a document, page, poster, slide or screen.',
    );
    expect(imagePrompt(direction({ medium: 'line_art' }), slot({}))).toContain(
      'A single illustrated scene, not a document, page, poster, slide, chart or screen.',
    );
    // `diagram` is the one medium that carries text; it has its own prompt branch.
    for (const medium of IMAGE_MEDIA.filter((m) => m !== 'diagram')) {
      const prompt = imagePrompt(direction({ medium }), slot({}));
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

describe('diagramLabels', () => {
  test('trims, collapses whitespace, drops blanks and case-insensitive duplicates, caps at 5', () => {
    expect(
      diagramLabels([' API  Gateway ', '', 'api gateway', 'Queue', 'Worker', 'DB', 'Cache', 'CDN']),
    ).toEqual(['API Gateway', 'Queue', 'Worker', 'DB', 'Cache']);
    expect(MAX_DIAGRAM_LABELS).toBe(5);
  });
});

describe('imagePrompt for the diagram medium', () => {
  const diagram = direction({ medium: 'diagram', palette: 'deep navy and white' });
  const slot = {
    subject: 'how a scan task moves from the API to the worker',
    composition: 'still_life' as const,
    lighting: 'natural_daylight' as const,
    objects: ['server rack'],
    labels: ['API', 'SQS queue', 'Worker', 'MongoDB'],
  };

  test('asks for a labelled schematic with exactly the planned labels and no other text', () => {
    const prompt = imagePrompt(diagram, slot);
    expect(prompt).toContain(
      'A clean, flat schematic diagram explaining how a scan task moves from the API to the worker',
    );
    expect(prompt).toContain('exactly these 4 labels');
    expect(prompt).toContain('"API", "SQS queue", "Worker", "MongoDB"');
    expect(prompt).toContain('Palette: deep navy and white.');
    expect(prompt).toContain('No other words, captions, titles, logos or watermarks.');
    // The no-text ban and the photographic clauses do not apply to diagrams.
    expect(prompt).not.toContain('No text, lettering, signage or logos anywhere in the frame.');
    expect(prompt).not.toContain('server rack');
    expect(prompt).not.toContain('daylight');
  });

  test('with no usable labels it asks for a wordless diagram', () => {
    const prompt = imagePrompt(diagram, { ...slot, labels: ['', '  '] });
    expect(prompt).toContain('No text anywhere in the image.');
    expect(prompt).not.toContain('exactly these');
  });

  test('every non-diagram medium ignores labels', () => {
    for (const medium of IMAGE_MEDIA.filter((m) => m !== 'diagram')) {
      const prompt = imagePrompt(direction({ medium }), slot);
      expect(prompt).not.toContain('SQS queue');
      expect(prompt).toContain('No text, lettering, signage or logos anywhere in the frame.');
    }
  });
});

describe('buildImagePlanPrompt for the diagram medium', () => {
  const input = {
    businessName: 'Piper',
    businessDescription: 'infra tooling',
    language: 'English',
    imageDirection: direction({ medium: 'diagram' }),
    articleTitle: 'T',
    metaDescription: 'M',
    headings,
  };

  test('asks for labels and says they are the only words rendered', () => {
    const [system, user] = buildImagePlanPrompt(input).map((m) => String(m.content));
    expect(user).toContain('Images are labelled schematic diagrams.');
    expect(system).toContain('labels: 3 to 5 short labels');
    expect(system).toContain('at most 3 words each');
    expect(system).toContain('ONLY words that will appear in the image');
    expect(system).toContain('written in English');
    expect(system).toContain(`exactly ${INLINE_IMAGE_COUNT}`);
    expect(system).not.toContain('Never a screen, diagram');
  });

  test('non-diagram media are told to return no labels', () => {
    const [system] = buildImagePlanPrompt({ ...input, imageDirection: photo }).map((m) =>
      String(m.content),
    );
    expect(system).toContain('labels: return an empty list');
  });
});

describe('parseImagePlan labels', () => {
  test('a plan without labels parses to empty label lists', () => {
    const plan = parseImagePlan(JSON.stringify(validPlan), headings);
    expect(plan.cover.labels).toEqual([]);
    expect(plan.inline[0]!.labels).toEqual([]);
  });

  test('labels are required on the wire schema', () => {
    const cover = (
      IMAGE_PLAN_RESPONSE_SCHEMA.schema.properties as Record<string, { required: string[] }>
    ).cover!;
    expect(cover.required).toContain('labels');
  });
});
