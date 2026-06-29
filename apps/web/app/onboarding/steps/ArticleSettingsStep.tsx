import {
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui';
import { ErrorMessage } from '../components/ErrorMessage';
import { ToggleSwitch } from '../components/ToggleSwitch';
import { articleStyles, internalLinkCounts } from '../constants';
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
          <Label htmlFor="articleStyle">Article style</Label>
          <Select
            value={form.articleStyle || undefined}
            onValueChange={(value) => updateField('articleStyle', value)}
          >
            <SelectTrigger
              id="articleStyle"
              className="mt-2"
              aria-invalid={Boolean(errors.articleStyle)}
            >
              <SelectValue placeholder="Select style" />
            </SelectTrigger>
            <SelectContent>
              {articleStyles.map((style) => (
                <SelectItem key={style} value={style}>
                  {style}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ErrorMessage>{errors.articleStyle}</ErrorMessage>
        </div>

        <div>
          <Label htmlFor="internalLinksCount">Internal links count</Label>
          <Select
            value={form.internalLinksCount}
            onValueChange={(value) => updateField('internalLinksCount', value)}
          >
            <SelectTrigger id="internalLinksCount" className="mt-2">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {internalLinkCounts.map((count) => (
                <SelectItem key={count} value={count}>
                  {count}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
