import { META_DESCRIPTION_MAX, META_DESCRIPTION_MIN, META_TITLE_MAX } from '@shared/schemas';
import type { ReactNode } from 'react';
import type { ArticleDraft } from '../lib/queries';

export const ARTICLE_INPUT_CLASS =
  'mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100 disabled:cursor-not-allowed disabled:opacity-50';

export function ArticleFields({
  draft,
  disabled = false,
  onChange,
}: {
  draft: ArticleDraft;
  disabled?: boolean;
  onChange: (field: keyof ArticleDraft, value: string) => void;
}) {
  return (
    <div className="space-y-4">
      <Field id="title" label="Title">
        <input
          id="title"
          type="text"
          value={draft.title}
          disabled={disabled}
          onChange={(event) => onChange('title', event.target.value)}
          className={ARTICLE_INPUT_CLASS}
        />
      </Field>

      <Field id="slug" label="Slug">
        <input
          id="slug"
          type="text"
          value={draft.slug}
          disabled={disabled}
          onChange={(event) => onChange('slug', event.target.value)}
          className={`${ARTICLE_INPUT_CLASS} font-mono`}
        />
      </Field>

      <Field
        id="meta_title"
        label="Meta title"
        hint={
          <Counter length={draft.meta_title.length} max={META_TITLE_MAX} label={META_TITLE_MAX} />
        }
      >
        <input
          id="meta_title"
          type="text"
          value={draft.meta_title}
          disabled={disabled}
          onChange={(event) => onChange('meta_title', event.target.value)}
          className={ARTICLE_INPUT_CLASS}
        />
      </Field>

      <Field
        id="meta_description"
        label="Meta description"
        hint={
          <Counter
            length={draft.meta_description.length}
            min={META_DESCRIPTION_MIN}
            max={META_DESCRIPTION_MAX}
            label={`${META_DESCRIPTION_MIN}–${META_DESCRIPTION_MAX}`}
          />
        }
      >
        <textarea
          id="meta_description"
          rows={3}
          value={draft.meta_description}
          disabled={disabled}
          onChange={(event) => onChange('meta_description', event.target.value)}
          className={ARTICLE_INPUT_CLASS}
        />
      </Field>

      <Field
        id="content"
        label="Content"
        hint={
          <span className="text-xs text-neutral-500">
            Markdown — <code>## headings</code>, <code>**bold**</code>, <code>![alt](url)</code>{' '}
            images, plus a raw <code>&lt;iframe&gt;</code> for the YouTube embed
          </span>
        }
      >
        <textarea
          id="content"
          rows={28}
          value={draft.content}
          disabled={disabled}
          onChange={(event) => onChange('content', event.target.value)}
          className={`${ARTICLE_INPUT_CLASS} font-mono text-xs leading-5`}
        />
      </Field>
    </div>
  );
}

export function ArticleFieldErrors({ fields }: { fields: Record<string, string> }) {
  return (
    <ul className="mt-1 list-disc pl-5">
      {Object.entries(fields).map(([field, message]) => (
        <li key={field}>
          <span className="font-mono text-xs">{field}</span>: {message}
        </li>
      ))}
    </ul>
  );
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="flex flex-wrap items-baseline gap-2 text-sm text-neutral-400">
        {label} {hint}
      </label>
      {children}
    </div>
  );
}

function Counter({
  length,
  min = 0,
  max,
  label,
}: {
  length: number;
  min?: number;
  max: number;
  label: string | number;
}) {
  const ok = length >= min && length <= max;
  return (
    <span className={`text-xs ${ok ? 'text-neutral-500' : 'text-amber-300'}`}>
      {length}/{label}
    </span>
  );
}
