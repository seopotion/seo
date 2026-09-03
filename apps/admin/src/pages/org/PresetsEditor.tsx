import { IMAGE_MEDIA, type ImageMedium } from '@shared/schemas';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useMemo, useState } from 'react';
import { errorText } from '../../lib/errors';
import { diffPresets, normalizePresets, type Presets } from '../../lib/presets';
import { updatePresets } from '../../lib/queries';

/** `audience.target` caps at 7 in `SetupPresetsSchema` — the API 400s past it. */
const MAX_AUDIENCE = 7;

/** Option labels for the `IMAGE_MEDIA` enum — the stored value is the enum key. */
const MEDIUM_LABEL: Record<ImageMedium, string> = {
  photograph: 'Photograph',
  flat_illustration: 'Flat illustration',
  three_d_render: '3D render',
  watercolor: 'Watercolor',
  line_art: 'Line art',
  isometric: 'Isometric',
};

const INPUT =
  'w-full rounded border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-100';

const LABEL = 'text-xs font-medium text-neutral-400';

const CARD = 'rounded border border-neutral-800 bg-neutral-900 p-5';

/**
 * The presets an operator can edit at any setup status (design §6) — the same
 * shape the scanner generated and the customer's onboarding screens write.
 *
 * One draft, one Save: the schema is small enough that per-section forms would
 * only add state. What keeps the save narrow is the diff, not the layout —
 * `diffPresets` sends just the subtrees that changed, so a save here can never
 * overwrite a section the operator did not open.
 */
export function PresetsEditor({ orgId, presets }: { orgId: string; presets: Presets | null }) {
  if (!presets) {
    return (
      <section className={CARD}>
        <Heading />
        <p className="mt-3 text-sm text-neutral-400">
          This org has no presets yet — run its scan first.
        </p>
      </section>
    );
  }
  // Keyed by org: the workspace stays mounted across an org switch, and a draft
  // carried into another org would patch it with the previous org's values.
  return <PresetsForm key={orgId} orgId={orgId} presets={presets} />;
}

function PresetsForm({ orgId, presets }: { orgId: string; presets: Presets }) {
  const queryClient = useQueryClient();
  // Both start from the presets the form opened with. The baseline stays put
  // even if the org refetches mid-edit, so the diff is always "what this
  // operator changed" — a concurrent edit to an untouched field survives the
  // save (the API merges it) instead of being reverted by a stale value.
  const [baseline, setBaseline] = useState<Presets>(presets);
  const [draft, setDraft] = useState<Presets>(presets);

  const normalized = useMemo(() => normalizePresets(draft), [draft]);
  const patch = useMemo(() => diffPresets(baseline, normalized), [baseline, normalized]);
  const changed = Object.keys(patch);
  const tooManySegments = normalized.audience.target.length > MAX_AUDIENCE;

  const save = useMutation({
    mutationFn: () => updatePresets(orgId, patch),
    onSuccess: (data) => {
      // The merged presets come back — adopting them as the new baseline clears
      // the dirty state without waiting for the org refetch to land.
      setBaseline(data.presets);
      setDraft(data.presets);
      queryClient.invalidateQueries({ queryKey: ['org', orgId] });
    },
  });

  const business = draft.business;
  const audience = draft.audience;
  const blog = draft.blog;
  const contentSeo = draft.article_preferences.content_seo;
  const engagement = draft.article_preferences.engagement;
  const publishing = draft.article_preferences.publishing;

  const setBusiness = (values: Partial<Presets['business']>) =>
    setDraft((current) => ({ ...current, business: { ...current.business, ...values } }));
  const setAudience = (values: Partial<Presets['audience']>) =>
    setDraft((current) => ({ ...current, audience: { ...current.audience, ...values } }));
  const setBlog = (values: Partial<Presets['blog']>) =>
    setDraft((current) => ({ ...current, blog: { ...current.blog, ...values } }));
  const setContentSeo = (values: Partial<Presets['article_preferences']['content_seo']>) =>
    setDraft((current) => ({
      ...current,
      article_preferences: {
        ...current.article_preferences,
        content_seo: { ...current.article_preferences.content_seo, ...values },
      },
    }));
  const setEngagement = (values: Partial<Presets['article_preferences']['engagement']>) =>
    setDraft((current) => ({
      ...current,
      article_preferences: {
        ...current.article_preferences,
        engagement: { ...current.article_preferences.engagement, ...values },
      },
    }));
  const direction = engagement.image_direction;
  const setDirection = (values: Partial<typeof direction>) =>
    setEngagement({ image_direction: { ...direction, ...values } });
  const setPublishing = (values: Partial<Presets['article_preferences']['publishing']>) =>
    setDraft((current) => ({
      ...current,
      article_preferences: {
        ...current.article_preferences,
        publishing: { ...current.article_preferences.publishing, ...values },
      },
    }));

  return (
    <section className={CARD}>
      <Heading />

      <div className="mt-5 grid gap-6 md:grid-cols-2">
        <Group title="Business">
          <TextField
            label="Name"
            value={business.name}
            onChange={(name) => setBusiness({ name })}
          />
          <TextAreaField
            label="Description"
            value={business.description}
            onChange={(description) => setBusiness({ description })}
          />
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Language"
              value={business.language}
              onChange={(language) => setBusiness({ language })}
            />
            <TextField
              label="Country"
              value={business.country}
              onChange={(country) => setBusiness({ country })}
            />
          </div>
        </Group>

        <Group title="Audience">
          <ListField
            label={`Target segments (max ${MAX_AUDIENCE})`}
            value={audience.target}
            onChange={(target) => setAudience({ target })}
          />
          {tooManySegments && (
            <p className="text-xs text-red-400">
              At most {MAX_AUDIENCE} segments — remove some before saving.
            </p>
          )}
          <ListField
            label="Competitors"
            rows={6}
            value={audience.competitors}
            onChange={(competitors) => setAudience({ competitors })}
          />
        </Group>

        <Group title="Blog">
          <TextField
            label="Sitemap URL"
            value={blog.sitemap_url}
            onChange={(sitemap_url) => setBlog({ sitemap_url })}
          />
          <TextField
            label="Main blog URL"
            value={blog.main_blog_url}
            onChange={(main_blog_url) => setBlog({ main_blog_url })}
          />
          <ListField
            label="Best articles"
            rows={6}
            value={blog.best_articles}
            onChange={(best_articles) => setBlog({ best_articles })}
          />
        </Group>

        <Group title="Article preferences">
          <TextField
            label="Article style"
            value={contentSeo.article_style}
            onChange={(article_style) => setContentSeo({ article_style })}
          />
          <TextAreaField
            label="LLM instructions"
            value={contentSeo.llm_instructions}
            onChange={(llm_instructions) => setContentSeo({ llm_instructions })}
          />
          <label className="block">
            <span className={LABEL}>Internal links per article</span>
            <select
              className={`${INPUT} mt-1`}
              value={contentSeo.internal_links_count}
              onChange={(event) =>
                setContentSeo({ internal_links_count: Number(event.target.value) })
              }
            >
              {[0, 1, 2, 3].map((count) => (
                <option key={count} value={count}>
                  {count}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={LABEL}>Image medium</span>
            <select
              className={`${INPUT} mt-1`}
              value={direction.medium}
              onChange={(event) => setDirection({ medium: event.target.value as ImageMedium })}
            >
              {IMAGE_MEDIA.map((medium) => (
                <option key={medium} value={medium}>
                  {MEDIUM_LABEL[medium]}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-neutral-500">
              The kind of picture every article image is.
            </span>
          </label>
          <TextField
            label="Image palette"
            hint="Up to 6 words naming the colours; empty for none."
            value={direction.palette}
            onChange={(palette) => setDirection({ palette })}
          />
          <TextField
            label="Image subject notes"
            hint="What the pictures should favour showing."
            value={direction.notes}
            onChange={(notes) => setDirection({ notes })}
          />
          <CheckField
            label="Table of contents"
            checked={contentSeo.table_of_contents}
            onChange={(table_of_contents) => setContentSeo({ table_of_contents })}
          />
          <CheckField
            label="YouTube embeds"
            checked={engagement.youtube_videos}
            onChange={(youtube_videos) => setEngagement({ youtube_videos })}
          />
          <CheckField
            label="Auto-publish"
            hint="Customer-visible: generated articles go straight to their WordPress site."
            checked={publishing.auto_publish}
            onChange={(auto_publish) => setPublishing({ auto_publish })}
          />
        </Group>
      </div>

      {save.isError && (
        <p className="mt-4 text-sm text-red-400">
          {errorText(save.error, 'Could not save the presets.')}
        </p>
      )}
      {save.isSuccess && changed.length === 0 && (
        <p className="mt-4 text-sm text-emerald-400">Presets saved.</p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-neutral-800 pt-4">
        <button
          type="button"
          disabled={changed.length === 0 || tooManySegments || save.isPending}
          onClick={() => save.mutate()}
          className="rounded bg-neutral-100 px-3 py-1.5 text-sm font-semibold text-neutral-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {save.isPending ? 'Saving…' : 'Save presets'}
        </button>
        <button
          type="button"
          disabled={changed.length === 0 || save.isPending}
          onClick={() => setDraft(baseline)}
          className="rounded border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Discard changes
        </button>
        <span className="text-xs text-neutral-500">
          {changed.length === 0
            ? 'No changes.'
            : `Sends only: ${changed.join(', ')} — every other section is left untouched.`}
        </span>
      </div>
    </section>
  );
}

function Heading() {
  return (
    <div>
      <h2 className="text-xs font-semibold tracking-wider text-neutral-500 uppercase">Presets</h2>
      <p className="mt-1 text-xs text-neutral-500">
        Editable at any setup status. They steer every future strategy run and article — already
        generated articles are unaffected.
      </p>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-neutral-300">{title}</h3>
      {children}
    </div>
  );
}

function TextField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className={LABEL}>{label}</span>
      <input
        className={`${INPUT} mt-1`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint && <span className="mt-1 block text-xs text-neutral-500">{hint}</span>}
    </label>
  );
}

function TextAreaField({
  label,
  hint,
  value,
  onChange,
  rows = 4,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
}) {
  return (
    <label className="block">
      <span className={LABEL}>{label}</span>
      <textarea
        rows={rows}
        className={`${INPUT} mt-1`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint && <span className="mt-1 block text-xs text-neutral-500">{hint}</span>}
    </label>
  );
}

/**
 * Lines in, array out. The merge replaces arrays wholesale, so the save always
 * carries the whole edited list — the hint says so, because "I only added one
 * competitor" and "I sent the entire competitor list" look identical from here.
 */
function ListField({
  label,
  value,
  onChange,
  rows = 4,
}: {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  rows?: number;
}) {
  return (
    <TextAreaField
      label={label}
      hint="One per line. Saving replaces the whole list."
      rows={rows}
      value={value.join('\n')}
      onChange={(text) => onChange(text.split('\n'))}
    />
  );
}

function CheckField({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 shrink-0"
      />
      <span>
        {label}
        {hint && <span className="block text-xs text-amber-300/80">{hint}</span>}
      </span>
    </label>
  );
}
