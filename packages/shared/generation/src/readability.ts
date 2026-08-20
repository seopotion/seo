const MIN_PROSE_WORDS = 3;

function stripFencedCode(markdown: string): string {
  const prose: string[] = [];
  let fence: { marker: string; length: number } | null = null;

  for (const line of markdown.split('\n')) {
    const match = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (match) {
      const delimiter = match[1];
      if (!delimiter) continue;
      const marker = delimiter.startsWith('`') ? '`' : '~';
      if (!fence) fence = { marker, length: delimiter.length };
      else if (marker === fence.marker && delimiter.length >= fence.length) fence = null;
      continue;
    }
    if (!fence) prose.push(line);
  }

  return prose.join('\n');
}

function readableText(markdown: string): string {
  return stripFencedCode(markdown)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|pre|code)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/(`+)[^`\n]*\1/g, ' ')
    .replace(/!\[[^\]]*\]\([^\n)]*\)/g, ' ')
    .replace(/!\[[^\]]*\]\[[^\]]*\]/g, ' ')
    .replace(/^\s{0,3}\[[^\]]+\]:\s*\S+.*$/gm, ' ')
    .replace(/\[([^\]]+)\]\([^\n)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
    .replace(/<https?:\/\/[^>]+>/gi, ' ')
    .replace(/(?:https?:\/\/|www\.)[^\s<]+/gi, (url) => url.match(/[.!?]+$/)?.[0] ?? ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:#\d+|#x[\da-f]+|[a-z]+);/gi, ' ')
    .replace(/^\s{0,3}(?:#{1,6}|>|[-+*]|\d+[.)])\s+/gm, '. ')
    .replace(/^\s{0,3}(?:[-*_]\s*){3,}$/gm, ' ')
    .replace(/\n\s*\n+/g, '. ')
    .replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~])/g, '$1')
    .replace(/[*_~#>|[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function wordsIn(text: string): string[] {
  return text.match(/[a-z]+(?:['’][a-z]+)*/gi) ?? [];
}

function syllablesIn(word: string): number {
  const normalized = word
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z]/g, '');
  if (normalized.length <= 3) return 1;

  let syllables = normalized.match(/[aeiouy]+/g)?.length ?? 0;
  if (normalized.endsWith('e') && !/[^aeiouy]le$/.test(normalized)) syllables -= 1;
  if (/[^td]ed$/.test(normalized)) syllables -= 1;
  if (/[^sxz]es$/.test(normalized) && !/(?:ch|sh)es$/.test(normalized)) syllables -= 1;

  return Math.max(1, syllables);
}

export function fleschKincaidGrade(markdown: string): number | null {
  const text = readableText(markdown);
  const sentences = text.split(/[.!?]+/).filter((part) => wordsIn(part).length > 0);
  const words = wordsIn(text);
  if (words.length < MIN_PROSE_WORDS || sentences.length === 0) return null;

  const syllables = words.reduce((total, word) => total + syllablesIn(word), 0);
  const grade =
    0.39 * (words.length / sentences.length) + 11.8 * (syllables / words.length) - 15.59;
  return Math.round(grade * 10) / 10;
}
