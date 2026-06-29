import {
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '../../../components/ui';
import { ErrorMessage } from '../components/ErrorMessage';
import { countries, languages } from '../constants';
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
          <Label htmlFor="businessName">Business name</Label>
          <Input
            className="mt-2"
            id="businessName"
            type="text"
            value={form.businessName}
            onChange={(event) => updateField('businessName', event.target.value)}
            aria-invalid={Boolean(errors.businessName)}
          />
          <ErrorMessage>{errors.businessName}</ErrorMessage>
        </div>

        <div>
          <Label htmlFor="language">Language</Label>
          <Select
            value={form.language || undefined}
            onValueChange={(value) => updateField('language', value)}
          >
            <SelectTrigger id="language" className="mt-2" aria-invalid={Boolean(errors.language)}>
              <SelectValue placeholder="Select language" />
            </SelectTrigger>
            <SelectContent>
              {languages.map((language) => (
                <SelectItem key={language} value={language}>
                  {language}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ErrorMessage>{errors.language}</ErrorMessage>
        </div>

        <div>
          <Label htmlFor="country">Country</Label>
          <Select
            value={form.country || undefined}
            onValueChange={(value) => updateField('country', value)}
          >
            <SelectTrigger id="country" className="mt-2" aria-invalid={Boolean(errors.country)}>
              <SelectValue placeholder="Select country" />
            </SelectTrigger>
            <SelectContent>
              {countries.map((country) => (
                <SelectItem key={country} value={country}>
                  {country}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ErrorMessage>{errors.country}</ErrorMessage>
        </div>

        <div className="md:col-span-2">
          <Label htmlFor="businessDescription">Business description</Label>
          <Textarea
            className="mt-2"
            id="businessDescription"
            value={form.businessDescription}
            onChange={(event) => updateField('businessDescription', event.target.value)}
            rows={5}
          />
        </div>
      </div>
    </div>
  );
}
