import { ErrorMessage } from '../components/ErrorMessage';
import { blogPostFields, inputClass, labelClass } from '../constants';
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
  return (
    <div>
      <h2 className="font-bold text-2xl text-gray-900">Blog Info</h2>

      <div className="mt-6 grid gap-5 md:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="sitemapUrl">
            Sitemap URL
          </label>
          <input
            id="sitemapUrl"
            type="url"
            value={form.sitemapUrl}
            onChange={(event) => updateField('sitemapUrl', event.target.value)}
            placeholder="https://example.com/sitemap.xml"
            className={inputClass}
            aria-invalid={Boolean(errors.sitemapUrl)}
          />
          <ErrorMessage>{errors.sitemapUrl}</ErrorMessage>
        </div>

        <div>
          <label className={labelClass} htmlFor="blogPageUrl">
            Blog page URL
          </label>
          <input
            id="blogPageUrl"
            type="url"
            value={form.blogPageUrl}
            onChange={(event) => updateField('blogPageUrl', event.target.value)}
            placeholder="https://example.com/blog"
            className={inputClass}
            aria-invalid={Boolean(errors.blogPageUrl)}
          />
          <ErrorMessage>{errors.blogPageUrl}</ErrorMessage>
        </div>

        <div className="md:col-span-2">
          <p className={labelClass}>Best 3 blog posts</p>
          <div className="mt-2 grid gap-3">
            {blogPostFields.map((field) => (
              <div key={field.id}>
                <label className="sr-only" htmlFor={field.id}>
                  {field.label}
                </label>
                <input
                  id={field.id}
                  type="url"
                  value={form.blogPosts[field.index]}
                  onChange={(event) => updateBlogPost(field.index, event.target.value)}
                  placeholder={`https://example.com/blog/post-${field.index + 1}`}
                  className={inputClass}
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
