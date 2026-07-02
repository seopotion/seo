import { TextEntryList } from '../components/TextEntryList';
import type { Errors, OnboardingForm } from '../types';

export function AudienceCompetitorsStep({
  audienceDraft,
  competitorDraft,
  errors,
  form,
  onAddAudience,
  onAddCompetitor,
  onAudienceDraftChange,
  onCompetitorDraftChange,
  onRemoveAudience,
  onRemoveCompetitor,
}: {
  audienceDraft: string;
  competitorDraft: string;
  errors: Errors;
  form: OnboardingForm;
  onAddAudience: () => void;
  onAddCompetitor: () => void;
  onAudienceDraftChange: (value: string) => void;
  onCompetitorDraftChange: (value: string) => void;
  onRemoveAudience: (id: string) => void;
  onRemoveCompetitor: (id: string) => void;
}) {
  const audienceErrors = errors.targetAudience ? [errors.targetAudience] : undefined;
  const competitorErrors = [errors.competitorDraft, errors.competitors].filter(
    (error): error is string => Boolean(error),
  );

  return (
    <div>
      <h2 className="font-bold text-2xl text-gray-900">Target Audience And Competitors</h2>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <TextEntryList
          draft={audienceDraft}
          entries={form.targetAudience}
          errors={audienceErrors}
          inputId="targetAudience"
          label="Target audience"
          onAdd={onAddAudience}
          onDraftChange={onAudienceDraftChange}
          onRemove={onRemoveAudience}
          placeholder="SaaS founders"
        />

        <TextEntryList
          ariaInvalid={Boolean(errors.competitorDraft || errors.competitors)}
          draft={competitorDraft}
          entries={form.competitors}
          errors={competitorErrors}
          inputId="competitorUrl"
          inputType="url"
          label="Competitor website URLs"
          onAdd={onAddCompetitor}
          onDraftChange={onCompetitorDraftChange}
          onRemove={onRemoveCompetitor}
          placeholder="https://competitor.com"
        />
      </div>
    </div>
  );
}
