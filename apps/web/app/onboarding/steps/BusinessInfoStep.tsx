import { ErrorMessage } from '../components/ErrorMessage';
import { countries, inputClass, labelClass, languages } from '../constants';
import type { Errors, OnboardingForm, UpdateOnboardingField } from '../types';

export function BusinessInfoStep({
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
      <h2 className="font-bold text-2xl text-gray-900">About Your Business</h2>

      <div className="mt-6 grid gap-5 md:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="businessName">
            Business name
          </label>
          <input
            id="businessName"
            type="text"
            value={form.businessName}
            onChange={(event) => updateField('businessName', event.target.value)}
            className={inputClass}
            aria-invalid={Boolean(errors.businessName)}
          />
          <ErrorMessage>{errors.businessName}</ErrorMessage>
        </div>

        <div>
          <label className={labelClass} htmlFor="language">
            Language
          </label>
          <select
            id="language"
            value={form.language}
            onChange={(event) => updateField('language', event.target.value)}
            className={inputClass}
            aria-invalid={Boolean(errors.language)}
          >
            <option value="">Select language</option>
            {languages.map((language) => (
              <option key={language} value={language}>
                {language}
              </option>
            ))}
          </select>
          <ErrorMessage>{errors.language}</ErrorMessage>
        </div>

        <div>
          <label className={labelClass} htmlFor="country">
            Country
          </label>
          <select
            id="country"
            value={form.country}
            onChange={(event) => updateField('country', event.target.value)}
            className={inputClass}
            aria-invalid={Boolean(errors.country)}
          >
            <option value="">Select country</option>
            {countries.map((country) => (
              <option key={country} value={country}>
                {country}
              </option>
            ))}
          </select>
          <ErrorMessage>{errors.country}</ErrorMessage>
        </div>

        <div className="md:col-span-2">
          <label className={labelClass} htmlFor="businessDescription">
            Business description
          </label>
          <textarea
            id="businessDescription"
            value={form.businessDescription}
            onChange={(event) => updateField('businessDescription', event.target.value)}
            rows={5}
            className={inputClass}
          />
        </div>
      </div>
    </div>
  );
}
