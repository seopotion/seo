import type { LlmMessage } from '@shared/providers';
import { toStrictJsonSchema } from '@shared/schemas';
import { z } from 'zod';
import { parseJsonObject } from './json';

/** Inputs for the video-pick prompt — the article surface + search candidates (#85). */
export interface VideoPickInput {
  articleTitle: string;
  metaDescription: string;
  headings: string[];
  candidates: { title: string; description: string; channel: string }[];
}

export const VideoPickSchema = z.object({
  video_index: z.number().int().nullable(),
  section_heading: z.string().nullable(),
});

export const VIDEO_PICK_RESPONSE_SCHEMA = toStrictJsonSchema(VideoPickSchema, 'video_pick');

export function buildVideoPickPrompt(input: VideoPickInput): LlmMessage[] {
  const system = [
    'You choose one YouTube video to embed in a blog article, or none.',
    'Rules: video_index is the 0-based index of the most relevant candidate, or null',
    'when no candidate is genuinely relevant to the article — prefer null over a weak',
    'match. When video_index is set, section_heading MUST be copied EXACTLY from the',
    'provided section list: the section the video best supports.',
  ].join('\n');

  const user = [
    `Article title: ${input.articleTitle}`,
    `Article summary: ${input.metaDescription}`,
    `Sections: ${input.headings.join(' | ')}`,
    'Candidates:',
    ...input.candidates.map((c, i) => `${i}. ${c.title} — ${c.channel} — ${c.description}`),
  ].join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/**
 * Parse + validate a pick. Returns null when the LLM chose no video; throws on
 * an out-of-range index or a heading not present in the article.
 */
export function parseVideoPick(
  text: string,
  candidateCount: number,
  headings: string[],
): { video_index: number; section_heading: string } | null {
  const pick = VideoPickSchema.parse(parseJsonObject(text));
  if (pick.video_index === null) return null;
  if (pick.video_index < 0 || pick.video_index >= candidateCount)
    throw new Error(`video pick index out of range: ${pick.video_index}`);
  if (pick.section_heading === null || !headings.includes(pick.section_heading))
    throw new Error(`video pick references unknown heading: ${pick.section_heading}`);
  return { video_index: pick.video_index, section_heading: pick.section_heading };
}

/** Minimal HTML attribute escaping for the iframe title. */
function escapeAttr(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
}

/** Privacy-enhanced YouTube embed markup, injected into the article markdown (#85). */
export function buildVideoEmbed(videoId: string, title: string): string {
  return (
    `<iframe width="560" height="315" src="https://www.youtube-nocookie.com/embed/${videoId}" ` +
    `title="${escapeAttr(title)}" frameborder="0" ` +
    `allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" ` +
    `referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`
  );
}

/**
 * Best-effort ISO 639-1 code from the free-form presets language name —
 * search.list relevanceLanguage requires a code; return undefined (param
 * omitted) when unmappable.
 */
const LANGUAGE_CODES: Record<string, string> = {
  arabic: 'ar',
  chinese: 'zh',
  czech: 'cs',
  danish: 'da',
  dutch: 'nl',
  english: 'en',
  finnish: 'fi',
  french: 'fr',
  german: 'de',
  greek: 'el',
  hebrew: 'he',
  hindi: 'hi',
  hungarian: 'hu',
  indonesian: 'id',
  italian: 'it',
  japanese: 'ja',
  korean: 'ko',
  norwegian: 'no',
  polish: 'pl',
  portuguese: 'pt',
  romanian: 'ro',
  russian: 'ru',
  spanish: 'es',
  swedish: 'sv',
  thai: 'th',
  turkish: 'tr',
  ukrainian: 'uk',
  vietnamese: 'vi',
};

export function languageCodeFromName(name: string): string | undefined {
  const n = name.trim().toLowerCase();
  if (/^[a-z]{2}$/.test(n)) return n;
  return LANGUAGE_CODES[n];
}
