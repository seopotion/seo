import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { ArticleContentPreview } from '../components/article/ArticleContentPreview';

const render = (content: string) =>
  renderToStaticMarkup(createElement(ArticleContentPreview, { content }));

describe('ArticleContentPreview code', () => {
  test('renders a fenced block as one <pre> without the fences or info string', () => {
    const html = render(['Intro:', '```bash', 'git push home main', '```', 'Outro.'].join('\n\n'));

    expect(html).toContain('<pre');
    expect(html).toContain('git push home main');
    expect(html).not.toContain('```');
    expect(html).not.toContain('>bash<');
  });

  test('keeps blank lines and #-comments inside the fence out of the block parser', () => {
    const html = render(
      ['```bash', '#!/bin/bash', '# post-receive hook', '', 'git pull origin main', '```'].join(
        '\n',
      ),
    );

    expect(html.match(/<pre/g)).toHaveLength(1);
    expect(html).not.toContain('<h1');
    expect(html).toContain('# post-receive hook\n\ngit pull origin main');
  });

  test('preserves the indentation of fenced code', () => {
    const html = render(['```yaml', 'services:', '  api:', '    ports:', '```'].join('\n'));

    expect(html).toContain('services:\n  api:\n    ports:');
  });

  test('renders inline code spans as <code>', () => {
    const html = render('Run `docker compose up -d` first.');

    expect(html).toMatch(/<code[^>]*>docker compose up -d<\/code>/);
    expect(html).not.toContain('`');
  });
});

describe('ArticleContentPreview GFM', () => {
  test('renders headings, bold and images', () => {
    const html = render(['## Section', '**Bold** text.', '![alt](https://x/1.png)'].join('\n\n'));

    expect(html).toContain('<h2');
    expect(html).toContain('<strong');
    expect(html).toContain('https://x/1.png');
    expect(html).toContain('alt="alt"');
  });

  test('renders lists rather than leaking their markers', () => {
    const html = render(['- first', '- second', '', '1. one', '2. two'].join('\n'));

    expect(html).toContain('<ul');
    expect(html).toContain('<ol');
    expect(html.match(/<li/g)).toHaveLength(4);
    expect(html).not.toMatch(/>\s*- first/);
  });

  test('renders GFM tables', () => {
    const html = render(['| Metric | Value |', '| --- | --- |', '| Clicks | 140 |'].join('\n'));

    expect(html).toContain('<table');
    expect(html).toMatch(/<th[^>]*>Metric<\/th>/);
    expect(html).toMatch(/<td[^>]*>140<\/td>/);
  });

  test('renders links as safe new-tab anchors', () => {
    const html = render('See [the guide](https://example.com/guide).');

    expect(html).toContain('href="https://example.com/guide"');
    expect(html).toContain('rel="noreferrer noopener"');
    expect(html).not.toContain('[the guide]');
  });

  test('renders blockquotes and strikethrough', () => {
    const html = render(['> Quoted line.', '', 'A ~~struck~~ word.'].join('\n'));

    expect(html).toContain('<blockquote');
    expect(html).toContain('<del');
    expect(html).not.toContain('~~');
  });

  test('escapes raw HTML in the body instead of mounting it', () => {
    const html = render('Hi <img src=x onerror="alert(1)"> there.');

    expect(html).not.toMatch(/<img[^>]*onerror/);
    expect(html).toContain('&lt;img src=x onerror=');
  });
});
