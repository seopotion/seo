import { useTranslations } from 'next-intl';
import { Input, Label } from '@/components/ui';
import { ErrorMessage } from '../components/ErrorMessage';
import { blogPostFields } from '../constants';
import type { Errors, OnboardingForm, UpdateOnboardingField } from '../types';

export function BlogInfoStep({
  errors,
  form,
  updateBlogPost,
  updateField,
}: {
  errors: Errors;
  form: OnboardingForm;
  updateBlogPost: (index: number, value: string) => void;
  updateField: UpdateOnboardingField;
}) {
  const t = useTranslations('Onboarding.blog');

  return (
    <div>
      <h2 className="font-bold text-2xl text-foreground">{t('title')}</h2>

      <div className="mt-6 grid gap-5 md:grid-cols-2">
        <div>
          <Label htmlFor="sitemapUrl">{t('sitemapUrl')}</Label>
          <Input
            className="mt-2"
            id="sitemapUrl"
            type="url"
            value={form.sitemapUrl}
            onChange={(event) => updateField('sitemapUrl', event.target.value)}
            placeholder="https://example.com/sitemap.xml"
            aria-invalid={Boolean(errors.sitemapUrl)}
          />
          <ErrorMessage>{errors.sitemapUrl}</ErrorMessage>
        </div>

        <div>
          <Label htmlFor="blogPageUrl">{t('blogPageUrl')}</Label>
          <Input
            className="mt-2"
            id="blogPageUrl"
            type="url"
            value={form.blogPageUrl}
            onChange={(event) => updateField('blogPageUrl', event.target.value)}
            placeholder="https://example.com/blog"
            aria-invalid={Boolean(errors.blogPageUrl)}
          />
          <ErrorMessage>{errors.blogPageUrl}</ErrorMessage>
        </div>

        <div className="md:col-span-2">
          <p className="font-medium text-sm leading-none">{t('bestPosts')}</p>
          <div className="mt-2 grid gap-3">
            {blogPostFields.map((field) => (
              <div key={field.id}>
                <label className="sr-only" htmlFor={field.id}>
                  {t(`blogPostFields.${field.labelKey}`)}
                </label>
                <Input
                  id={field.id}
                  type="url"
                  value={form.blogPosts[field.index]}
                  onChange={(event) => updateBlogPost(field.index, event.target.value)}
                  placeholder={`https://example.com/blog/post-${field.index + 1}`}
                  aria-invalid={Boolean(errors[field.id])}
                />
                <ErrorMessage>{errors[field.id]}</ErrorMessage>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
