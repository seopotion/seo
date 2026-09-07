import { MAX_MANUAL_ARTICLE_IMAGES } from '@shared/schemas';
import { useRef, useState } from 'react';
import { errorText } from '../lib/errors';
import {
  finalizeImageUpload,
  type ImageUploadMetadata,
  prepareImageUpload,
  uploadImageFile,
} from '../lib/image-uploads';
import type { ArticleDetail } from '../lib/queries';

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
  const [progress, setProgress] = useState(0);
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
      file.size > 5 * 1024 * 1024
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
        const prepared = await prepareImageUpload(article.id, {
          role: placement === 'cover' ? 'cover' : 'inline',
          section_heading: placement === 'cover' ? null : placement.slice('h2:'.length),
          alt: alt.trim(),
          content_type: file.type as ImageUploadMetadata['content_type'],
          size: file.size,
        });
        await uploadImageFile(prepared.upload_url, prepared.headers, file, setProgress);
        uploadToken = prepared.upload_token;
        setToken(uploadToken);
      }
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
            </figure>
          ))}
      </div>
      {manual && (
        <>
          <p className="mt-3 text-sm text-neutral-400">
            Images are optional. Upload up to {MAX_MANUAL_ARTICLE_IMAGES} images total, including at
            most one cover (WebP, JPEG, PNG; 5 MiB each). Choosing an occupied placement replaces
            its image. The cover stays outside the Markdown.
          </p>
          <p className="mt-2 text-sm text-neutral-400">
            {images.length} of {MAX_MANUAL_ARTICLE_IMAGES} images uploaded.
          </p>
          {disabled && !busy && (
            <p className="mt-2 text-sm text-amber-300">Save your edits before uploading images.</p>
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
          {busy && (
            <div className="mt-3" role="status">
              <progress aria-label="Image upload progress" value={progress} max={100} />
              <span className="ml-2 text-sm">
                {token ? 'Finalizing image…' : `Uploading: ${progress}%`}
              </span>
            </div>
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
