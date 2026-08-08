import Image from 'next/image';
import type { ReactNode } from 'react';

export function ArticleContentPreview({ content }: { content: string }) {
  const blocks = content
    .trim()
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  return (
    <article className="grid gap-4 wrap-break-word text-slate-800">
      {blocks.map((block, index) => {
        const heading = getMarkdownHeading(block);
        const key = `${index}-${block}`;

        if (heading?.level === 1) {
          return (
            <h1 key={key} className="font-semibold text-2xl text-slate-950 leading-tight">
              {heading.text}
            </h1>
          );
        }

        if (heading?.level === 2) {
          return (
            <h2 key={key} className="font-semibold text-lg text-slate-950 leading-snug">
              {heading.text}
            </h2>
          );
        }

        if (heading?.level === 3) {
          return (
            <h3 key={key} className="font-semibold text-base text-slate-950 leading-snug">
              {heading.text}
            </h3>
          );
        }

        return <ArticleContentBlock key={key} block={block} />;
      })}
    </article>
  );
}

/** A non-heading block: prose split around any inline `![alt](url)` images. */
function ArticleContentBlock({ block }: { block: string }) {
  return (
    <>
      {splitBlockIntoSegments(block).map((segment, index) => {
        const key = `${index}-${segment.type === 'image' ? segment.url : segment.text}`;

        return segment.type === 'image' ? (
          <Image
            key={key}
            src={segment.url}
            alt={segment.alt}
            width={640}
            height={360}
            unoptimized
            className="aspect-video w-full rounded-md border border-slate-200 object-cover"
          />
        ) : (
          <p key={key} className="whitespace-pre-wrap text-sm leading-7">
            {renderInlineMarkdown(segment.text)}
          </p>
        );
      })}
    </>
  );
}

/** Render inline `**bold**` spans; everything else stays plain text. */
function renderInlineMarkdown(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(/\*\*(.+?)\*\*/g)) {
    const start = match.index;

    if (start > lastIndex) {
      nodes.push(text.slice(lastIndex, start));
    }

    nodes.push(
      <strong key={start} className="font-semibold text-slate-950">
        {match[1]}
      </strong>,
    );
    lastIndex = start + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

type ArticleContentSegment =
  | { type: 'image'; alt: string; url: string }
  | { type: 'text'; text: string };

/** Split a block's lines so inline images render as images and prose as paragraphs. */
function splitBlockIntoSegments(block: string): ArticleContentSegment[] {
  const segments: ArticleContentSegment[] = [];
  let textLines: string[] = [];

  const flushText = () => {
    if (textLines.length) {
      segments.push({ type: 'text', text: textLines.join('\n') });
      textLines = [];
    }
  };

  for (const line of block.split('\n')) {
    const image = parseMarkdownImage(line.trim());

    if (image) {
      flushText();
      segments.push({ type: 'image', alt: image.alt, url: image.url });
    } else {
      textLines.push(line);
    }
  }

  flushText();
  return segments;
}

function parseMarkdownImage(line: string) {
  const match = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(line);

  if (!match) {
    return null;
  }

  return { alt: match[1].trim(), url: match[2].trim() };
}

function getMarkdownHeading(block: string) {
  const match = /^(#{1,3})\s+(.+)$/.exec(block);

  if (!match) {
    return null;
  }

  return {
    level: match[1].length,
    text: match[2].trim(),
  };
}
