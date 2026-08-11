import { useTranslations } from 'next-intl';
import { TextEntryList } from '../components/TextEntryList';
import { ToggleSwitch } from '../components/ToggleSwitch';
import type { Errors, OnboardingForm } from '../types';

export function AudienceCompetitorsStep({
  audienceDraft,
  competitorDraft,
  competitorsSkipped,
  errors,
  form,
  onAddAudience,
  onAddCompetitor,
  onAudienceDraftChange,
  onCompetitorDraftChange,
  onCompetitorsSkippedChange,
  onRemoveAudience,
  onRemoveCompetitor,
}: {
  audienceDraft: string;
  competitorDraft: string;
  competitorsSkipped: boolean;
  errors: Errors;
  form: OnboardingForm;
  onAddAudience: () => void;
  onAddCompetitor: () => void;
  onAudienceDraftChange: (value: string) => void;
  onCompetitorDraftChange: (value: string) => void;
  onCompetitorsSkippedChange: (skipped: boolean) => void;
  onRemoveAudience: (id: string) => void;
  onRemoveCompetitor: (id: string) => void;
}) {
  const t = useTranslations('Onboarding.audience');
  const audienceErrors = errors.targetAudience ? [errors.targetAudience] : undefined;
  const competitorErrors = [errors.competitorDraft, errors.competitors].filter(
    (error): error is string => Boolean(error),
  );

  return (
    <div>
      <h2 className="font-bold text-2xl text-gray-900">{t('title')}</h2>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <TextEntryList
          draft={audienceDraft}
          entries={form.targetAudience}
          errors={audienceErrors}
          inputId="targetAudience"
          label={t('targetAudience')}
          onAdd={onAddAudience}
          onDraftChange={onAudienceDraftChange}
          onRemove={onRemoveAudience}
          placeholder={t('targetAudiencePlaceholder')}
        />

        <div>
          <TextEntryList
            ariaInvalid={Boolean(errors.competitorDraft || errors.competitors)}
            description={t('competitorsHelp')}
            draft={competitorDraft}
            entries={form.competitors}
            errors={competitorErrors}
            inputId="competitorUrl"
            label={t('competitorUrls')}
            onAdd={onAddCompetitor}
            onDraftChange={onCompetitorDraftChange}
            onRemove={onRemoveCompetitor}
            placeholder="competitor.com"
          />

          <p className="mt-2 text-gray-500 text-sm">{t('competitorsHint')}</p>

          <div className="mt-3">
            <ToggleSwitch
              checked={competitorsSkipped}
              label={t('competitorsSkip')}
              onChange={onCompetitorsSkippedChange}
            />
            {competitorsSkipped && (
              <p className="mt-2 text-gray-500 text-sm">{t('competitorsSkipNote')}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
