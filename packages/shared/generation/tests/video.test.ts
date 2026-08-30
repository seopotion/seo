import { describe, expect, test } from 'vitest';
import {
  buildVideoEmbed,
  buildVideoPickPrompt,
  injectBlockAfterHeading,
  languageCodeFromName,
  parseVideoPick,
} from '../src';

const headings = ['Intro', 'Deep Dive'];

describe('buildVideoPickPrompt', () => {
  test('numbers candidates from 0 and includes article surface + sections', () => {
    const [system, user] = buildVideoPickPrompt({
      articleTitle: 'Best Widgets',
      metaDescription: 'All about widgets.',
      headings,
      candidates: [
        { title: 'Widgets 101', description: 'intro vid', channel: 'WidgetCo' },
        { title: 'Advanced widgets', description: 'deep', channel: 'Maker' },
      ],
    });
    expect(system!.role).toBe('system');
    expect(system!.content).toContain('video_index is the 0-based index');
    expect(user!.content).toContain('Best Widgets');
    expect(user!.content).toContain('Intro | Deep Dive');
    expect(user!.content).toContain('0. Widgets 101');
    expect(user!.content).toContain('1. Advanced widgets');
  });
});

describe('parseVideoPick', () => {
  test('returns the pick when index and heading are valid', () => {
    const pick = parseVideoPick('{"video_index": 1, "section_heading": "Deep Dive"}', 2, headings);
    expect(pick).toEqual({ video_index: 1, section_heading: 'Deep Dive' });
  });

  test('returns null when the LLM picks no video', () => {
    expect(
      parseVideoPick('{"video_index": null, "section_heading": null}', 2, headings),
    ).toBeNull();
  });

  test('throws on an out-of-range index', () => {
    expect(() =>
      parseVideoPick('{"video_index": 5, "section_heading": "Intro"}', 2, headings),
    ).toThrow(/out of range/);
  });

  test('throws on an unknown heading', () => {
    expect(() =>
      parseVideoPick('{"video_index": 0, "section_heading": "Nope"}', 2, headings),
    ).toThrow(/unknown heading/);
  });
});

describe('buildVideoEmbed', () => {
  test('builds a nocookie iframe with an escaped title', () => {
    const html = buildVideoEmbed('v1', 'Tom & "Jerry" <3');
    expect(html).toContain('https://www.youtube-nocookie.com/embed/v1');
    expect(html).toContain('title="Tom &amp; &quot;Jerry&quot; &lt;3"');
    expect(html).toContain('allowfullscreen');
  });
});

describe('injectBlockAfterHeading', () => {
  test('inserts the block right after the matching H2', () => {
    const out = injectBlockAfterHeading('## Intro\n\ntext', 'Intro', '<iframe/>');
    expect(out).toBe('## Intro\n\n<iframe/>\n\ntext');
  });

  test('throws when the heading is missing', () => {
    expect(() => injectBlockAfterHeading('## Other\n', 'Intro', 'x')).toThrow(/heading not found/);
  });

  test('a heading that only exists inside a fenced code block is not found', () => {
    const fenced = ['```markdown', '## Intro', '```', '', 'text'].join('\n');
    expect(() => injectBlockAfterHeading(fenced, 'Intro', '<iframe/>')).toThrow(
      /heading not found/,
    );
  });
});

describe('languageCodeFromName', () => {
  test('maps common names, passes through 2-letter codes, undefined otherwise', () => {
    expect(languageCodeFromName('English')).toBe('en');
    expect(languageCodeFromName('  turkish ')).toBe('tr');
    expect(languageCodeFromName('DE')).toBe('de');
    expect(languageCodeFromName('Global (English)')).toBeUndefined();
  });
});
