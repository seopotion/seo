import { ErrorMessage } from '../components/ErrorMessage';
import { ToggleSwitch } from '../components/ToggleSwitch';
import { articleStyles, inputClass, internalLinkCounts, labelClass } from '../constants';
import type { Errors, OnboardingForm, UpdateOnboardingField } from '../types';

export function ArticleSettingsStep({
  errors,
  form,
  updateField,
}: {
  errors: Errors;
  form: OnboardingForm;
  updateField: UpdateOnboardingField;
}) {
  return (
    <div>
      <h2 className="font-bold text-2xl text-gray-900">Article Settings</h2>

      <div className="mt-6 grid gap-5 md:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="articleStyle">
            Article style
          </label>
          <select
            id="articleStyle"
            value={form.articleStyle}
            onChange={(event) => updateField('articleStyle', event.target.value)}
            className={inputClass}
            aria-invalid={Boolean(errors.articleStyle)}
          >
            <option value="">Select style</option>
            {articleStyles.map((style) => (
              <option key={style} value={style}>
                {style}
              </option>
            ))}
          </select>
          <ErrorMessage>{errors.articleStyle}</ErrorMessage>
        </div>

        <div>
          <label className={labelClass} htmlFor="internalLinksCount">
            Internal links count
          </label>
          <select
            id="internalLinksCount"
            value={form.internalLinksCount}
            onChange={(event) => updateField('internalLinksCount', event.target.value)}
            className={inputClass}
          >
            {internalLinkCounts.map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </select>
        </div>

        <ToggleSwitch
          label="Table of contents"
          checked={form.tableOfContents}
          onChange={(checked) => updateField('tableOfContents', checked)}
        />
        <ToggleSwitch
          label="YouTube videos"
          checked={form.youtubeVideos}
          onChange={(checked) => updateField('youtubeVideos', checked)}
        />
      </div>
    </div>
  );
}
