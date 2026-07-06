'use client';

import { useTranslations } from 'next-intl';
import { type FormEvent, type ReactNode, useState } from 'react';
import {
  Button,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from '@/components/ui';
import { articleStyles, internalLinkCounts } from '../../onboarding/constants';

type ArticleSettingsForm = {
  autoPublish: boolean;
  articleStyle: string;
  internalLinksCount: string;
  tableOfContents: boolean;
};

const initialArticleSettings: ArticleSettingsForm = {
  articleStyle: articleStyles[1].value,
  autoPublish: false,
  internalLinksCount: internalLinkCounts[1],
  tableOfContents: true,
};

export default function ArticleSettingsPage() {
  const t = useTranslations('ArticleSettingsPage');
  const optionsT = useTranslations('Onboarding.options');
  const [settings, setSettings] = useState<ArticleSettingsForm>(initialArticleSettings);

  function updateSetting<Field extends keyof ArticleSettingsForm>(
    field: Field,
    value: ArticleSettingsForm[Field],
  ) {
    setSettings((currentSettings) => ({
      ...currentSettings,
      [field]: value,
    }));
  }

  function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // TODO: Wire this to persisted article settings once the product API is available.
  }

  return (
    <form className="grid w-full gap-4" onSubmit={saveSettings}>
      <SwitchSetting
        checked={settings.autoPublish}
        description={t('fields.autoPublish.description')}
        id="auto-publish"
        label={t('fields.autoPublish.label')}
        onCheckedChange={(checked) => updateSetting('autoPublish', checked)}
      />

      <div className="grid gap-2 rounded-md border border-slate-200 bg-white p-4">
        <div>
          <Label htmlFor="article-style">{t('fields.articleStyle.label')}</Label>
          <p className="mt-1 text-slate-500 text-sm">{t('fields.articleStyle.description')}</p>
        </div>
        <Select
          value={settings.articleStyle}
          onValueChange={(value) => updateSetting('articleStyle', value)}
        >
          <SelectTrigger id="article-style" className="max-w-md">
            <SelectValue placeholder={t('fields.articleStyle.placeholder')} />
          </SelectTrigger>
          <SelectContent>
            {articleStyles.map((style) => (
              <SelectItem key={style.value} value={style.value}>
                {optionsT(`articleStyles.${style.labelKey}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-2 rounded-md border border-slate-200 bg-white p-4">
        <div>
          <Label htmlFor="internal-links">{t('fields.internalLinks.label')}</Label>
          <p className="mt-1 text-slate-500 text-sm">{t('fields.internalLinks.description')}</p>
        </div>
        <Select
          value={settings.internalLinksCount}
          onValueChange={(value) => updateSetting('internalLinksCount', value)}
        >
          <SelectTrigger id="internal-links" className="max-w-md">
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

      <SwitchSetting
        checked={settings.tableOfContents}
        description={t('fields.tableOfContents.description')}
        id="table-of-contents"
        label={t('fields.tableOfContents.label')}
        onCheckedChange={(checked) => updateSetting('tableOfContents', checked)}
      />

      <div className="flex justify-end">
        <Button type="submit">{t('actions.save')}</Button>
      </div>
    </form>
  );
}

function SwitchSetting({
  checked,
  description,
  id,
  label,
  onCheckedChange,
}: {
  checked: boolean;
  description: ReactNode;
  id: string;
  label: ReactNode;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <Label htmlFor={id}>{label}</Label>
        <p className="mt-1 text-slate-500 text-sm">{description}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}
