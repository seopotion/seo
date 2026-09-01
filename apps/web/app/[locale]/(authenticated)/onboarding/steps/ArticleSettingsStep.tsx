import { useTranslations } from 'next-intl';
import {
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui';
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
  const t = useTranslations('Onboarding.articleSettings');
  const optionsT = useTranslations('Onboarding.options');

  return (
    <div>
      <h2 className="font-bold text-2xl text-foreground">{t('title')}</h2>

      <div className="mt-6 grid gap-5 md:grid-cols-2">
        <div>
          <Label htmlFor="articleStyle">{t('articleStyle')}</Label>
          <Select
            value={form.articleStyle || undefined}
            onValueChange={(value) => updateField('articleStyle', value)}
          >
            <SelectTrigger
              id="articleStyle"
              className="mt-2"
              aria-invalid={Boolean(errors.articleStyle)}
            >
              <SelectValue placeholder={t('selectStyle')} />
            </SelectTrigger>
            <SelectContent>
              {articleStyles.map((style) => (
                <SelectItem key={style.value} value={style.value}>
                  {optionsT(`articleStyles.${style.labelKey}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ErrorMessage>{errors.articleStyle}</ErrorMessage>
        </div>

        <div>
          <Label htmlFor="internalLinksCount">{t('internalLinksCount')}</Label>
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
          label={t('tableOfContents')}
          checked={form.tableOfContents}
          onChange={(checked) => updateField('tableOfContents', checked)}
        />
        <ToggleSwitch
          label={t('youtubeVideos')}
          checked={form.youtubeVideos}
          onChange={(checked) => updateField('youtubeVideos', checked)}
        />
        <ToggleSwitch
          label={t('includeCta')}
          checked={form.includeCta}
          onChange={(checked) => updateField('includeCta', checked)}
        />
      </div>
    </div>
  );
}
