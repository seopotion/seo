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

  test('strips unsafe raw HTML instead of mounting it', () => {
    const html = render(
      'Hi <img src="https://x/1.png" onerror="alert(1)"> <b onclick="alert(1)">bold</b> <script>alert(1)</script> there.',
    );

    expect(html).not.toMatch(/<img[^>]*onerror/);
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert(1)');
    expect(html).toContain('<b>bold</b>');
  });
});

describe('ArticleContentPreview raw HTML', () => {
  // The generator injects the YouTube embed as a raw <iframe> (#85), which
  // publishes verbatim to WordPress and the static site, so the preview must
  // mount it rather than show the markup as text.
  const embed =
    '<iframe width="560" height="315" src="https://www.youtube-nocookie.com/embed/i-VO5IuYSH4" ' +
    'title="Deployment Automation Explained" frameborder="0" ' +
    'allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" ' +
    'referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>';

  test('renders the YouTube embed iframe', () => {
    const html = render(['## Section', embed, 'After the video.'].join('\n\n'));

    expect(html).toMatch(
      /<iframe[^>]*src="https:\/\/www\.youtube-nocookie\.com\/embed\/i-VO5IuYSH4"/,
    );
    expect(html).toMatch(/<iframe[^>]*title="Deployment Automation Explained"/);
    expect(html).toMatch(/<iframe[^>]*allowfullscreen/i);
    expect(html).not.toContain('&lt;iframe');
  });

  test('drops iframes that are not YouTube embeds', () => {
    const html = render(
      [
        '<iframe src="https://evil.example/embed/x"></iframe>',
        '<iframe src="https://www.youtube-nocookie.com/watch?v=x"></iframe>',
      ].join('\n\n'),
    );

    expect(html).not.toContain('<iframe');
  });
});
