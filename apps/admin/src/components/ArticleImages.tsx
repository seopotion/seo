import { MAX_MANUAL_ARTICLE_IMAGES, MAX_MANUAL_IMAGE_SOURCE_BYTES } from '@shared/schemas';
import { useRef, useState } from 'react';
import { errorText } from '../lib/errors';
import {
  finalizeImageUpload,
  type ImageUploadMetadata,
  prepareImageUpload,
  removeArticleImage,
  uploadImageFile,
} from '../lib/image-uploads';
import { optimizeImage } from '../lib/optimize-image';
import type { ArticleDetail } from '../lib/queries';
import { ConfirmDialog } from './ConfirmDialog';

export function ArticleImages({
  article,
  disabled,
  onBusy,
  onUploaded,
}: {
  article: ArticleDetail;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  onUploaded: (article: ArticleDetail) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [alt, setAlt] = useState('');
  const [placement, setPlacement] = useState('cover');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState<ArticleDetail['images'][number] | null>(
    null,
  );
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<'optimizing' | 'uploading' | 'finalizing'>('optimizing');
  const [optimized, setOptimized] = useState<Awaited<ReturnType<typeof optimizeImage>> | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const manual = article.keyword_id === null;
  const images = article.images ?? [];
  const headings = article.image_headings ?? [];
  const atLimit = images.length >= MAX_MANUAL_ARTICLE_IMAGES;
  const canReplace = images.some((image) =>
    placement === 'cover'
      ? image.role === 'cover'
      : image.role === 'inline' && image.section_heading === placement.slice('h2:'.length),
  );

  async function upload() {
    if (!file || !alt.trim()) return;
    if (
      !['image/webp', 'image/jpeg', 'image/png'].includes(file.type) ||
      file.size === 0 ||
      file.size > MAX_MANUAL_IMAGE_SOURCE_BYTES
    ) {
      setError('Choose a WebP, JPEG, or PNG file up to 5 MiB.');
      return;
    }
    setError(null);
    setBusy(true);
    onBusy(true);
    try {
      let uploadToken = token;
      if (!uploadToken) {
        setProgress(0);
        setPhase('optimizing');
        setOptimized(null);
        const result = await optimizeImage(file);
        setOptimized(result);
        const prepared = await prepareImageUpload(article.id, {
          role: placement === 'cover' ? 'cover' : 'inline',
          section_heading: placement === 'cover' ? null : placement.slice('h2:'.length),
          alt: alt.trim(),
          content_type: result.file.type as ImageUploadMetadata['content_type'],
          size: result.file.size,
        });
        setPhase('uploading');
        await uploadImageFile(prepared.upload_url, prepared.headers, result.file, setProgress);
        uploadToken = prepared.upload_token;
        setToken(uploadToken);
      }
      setPhase('finalizing');
      const updated = await finalizeImageUpload(article.id, uploadToken);
      onUploaded(updated);
      setToken(null);
      setFile(null);
      setAlt('');
      if (fileInput.current) fileInput.current.value = '';
    } catch (err) {
      setError(errorText(err, 'Could not upload the image. Try again.'));
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }

  async function remove() {
    if (!pendingRemoval || disabled || busy) return;
    const image = pendingRemoval;
    setPendingRemoval(null);
    setError(null);
    setBusy(true);
    setRemoving(true);
    onBusy(true);
    try {
      const updated = await removeArticleImage(article.id, image.url);
      setToken(null);
      onUploaded(updated);
    } catch (err) {
      setError(errorText(err, 'Could not remove the image. Try again.'));
    } finally {
      setRemoving(false);
      setBusy(false);
      onBusy(false);
    }
  }

  return (
    <section className="mt-8 rounded border border-neutral-800 bg-neutral-900 p-5">
      <h2 className="font-semibold">Article images</h2>
      <div className="mt-3 grid gap-4 sm:grid-cols-3">
        {images
          .filter((image) => image.url)
          .map((image) => (
            <figure key={image.url}>
              <img
                src={image.url}
                alt={image.alt}
                className="max-h-40 w-full rounded object-contain"
              />
              <figcaption className="mt-2 text-sm text-neutral-400">
                {image.role === 'cover' ? 'Cover' : image.section_heading} · {image.alt}
              </figcaption>
              {manual && (
                <button
                  type="button"
                  aria-label={`Remove image: ${image.alt}`}
                  disabled={disabled || busy}
                  onClick={() => setPendingRemoval(image)}
                  className="mt-2 rounded border border-red-800 px-3 py-1.5 text-sm text-red-300 disabled:opacity-40"
                >
                  Remove
                </button>
              )}
            </figure>
          ))}
      </div>
      {manual && (
        <>
          <p className="mt-3 text-sm text-neutral-400">
            Images are optional. Upload up to {MAX_MANUAL_ARTICLE_IMAGES} images total, including at
            most one cover. Select WebP, JPEG, or PNG files up to 5 MiB each. Images are
            automatically converted to WebP, resized to at most 1200 px per edge, and compressed to
            at most 100 KB before uploading. Choosing an occupied placement replaces its image. The
            cover stays outside the Markdown.
          </p>
          <p className="mt-2 text-sm text-neutral-400">
            {images.length} of {MAX_MANUAL_ARTICLE_IMAGES} images uploaded.
          </p>
          {disabled && !busy && (
            <p className="mt-2 text-sm text-amber-300">
              Save your edits before uploading or removing images.
            </p>
          )}
          <fieldset disabled={disabled || busy} className="mt-4 space-y-3">
            <label className="block text-sm">
              Image file
              <input
                ref={fileInput}
                type="file"
                accept="image/webp,image/jpeg,image/png"
                className="mt-1 block w-full"
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                  setOptimized(null);
                  setToken(null);
                  setError(null);
                }}
              />
            </label>
            <label className="block text-sm">
              Descriptive alt text
              <input
                value={alt}
                maxLength={300}
                required
                className="mt-1 block w-full rounded bg-neutral-800 p-2"
                onChange={(event) => {
                  setAlt(event.target.value);
                  setToken(null);
                }}
              />
            </label>
            <label className="block text-sm">
              Image placement
              <select
                value={placement}
                className="mt-1 block w-full rounded bg-neutral-800 p-2"
                onChange={(event) => {
                  setPlacement(event.target.value);
                  setToken(null);
                }}
              >
                <option
                  value="cover"
                  disabled={atLimit && !images.some((image) => image.role === 'cover')}
                >
                  Cover
                </option>
                {headings.map((heading) => (
                  <option
                    key={heading}
                    value={`h2:${heading}`}
                    disabled={
                      atLimit &&
                      !images.some(
                        (image) => image.role === 'inline' && image.section_heading === heading,
                      )
                    }
                  >
                    After H2: {heading}
                  </option>
                ))}
              </select>
            </label>
            {!headings.length && (
              <p className="text-sm text-neutral-400">
                Add a uniquely named H2 section to place an inline image.
              </p>
            )}
            <button
              type="button"
              disabled={!file || !alt.trim() || (atLimit && !canReplace)}
              onClick={upload}
              className="rounded bg-neutral-100 px-3 py-1.5 text-sm font-semibold text-neutral-900 disabled:opacity-40"
            >
              {token ? 'Retry finalization' : 'Upload image'}
            </button>
          </fieldset>
          {optimized && (
            <p className="mt-3 text-sm text-neutral-400">
              Optimized: {optimized.width} × {optimized.height} px ·{' '}
              {(optimized.file.size / 1000).toFixed(1)} KB · WebP
            </p>
          )}
          {busy && !removing && (
            <div className="mt-3" role="status">
              {phase === 'uploading' && (
                <progress aria-label="Image upload progress" value={progress} max={100} />
              )}
              <span className="ml-2 text-sm">
                {phase === 'optimizing'
                  ? 'Optimizing…'
                  : phase === 'finalizing'
                    ? 'Finalizing…'
                    : `Uploading: ${progress}%`}
              </span>
            </div>
          )}
          {removing && (
            <p role="status" className="mt-3 text-sm">
              Removing image…
            </p>
          )}
          {pendingRemoval && (
            <ConfirmDialog
              title="Remove image?"
              body={`Remove “${pendingRemoval.alt}” from this article? This saves immediately. Published sites change only after you publish an update.`}
              confirmLabel="Remove image"
              variant="danger"
              onCancel={() => setPendingRemoval(null)}
              onConfirm={remove}
            />
          )}
          {error && (
            <p role="alert" className="mt-3 text-sm text-red-400">
              {error}
            </p>
          )}
        </>
      )}
    </section>
  );
}
