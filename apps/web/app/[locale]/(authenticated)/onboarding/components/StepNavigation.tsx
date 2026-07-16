import { useTranslations } from 'next-intl';
import { Button, Separator } from '@/components/ui';

export function StepNavigation({
  currentStep,
  finishLabel,
  isFinishDisabled = false,
  isNextDisabled,
  isFinalStep,
  onBack,
  onFinish,
  onNext,
}: {
  currentStep: number;
  finishLabel?: string;
  isFinishDisabled?: boolean;
  isNextDisabled: boolean;
  isFinalStep: boolean;
  onBack: () => void;
  onFinish: () => void;
  onNext: () => void;
}) {
  const t = useTranslations('Onboarding.actions');
  const resolvedFinishLabel = finishLabel ?? t('getStarted');

  return (
    <div className="mt-8">
      <Separator />
      <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
        <Button variant="outline" onClick={onBack} disabled={currentStep === 0}>
          {t('back')}
        </Button>
        {isFinalStep ? (
          <Button onClick={onFinish} disabled={isFinishDisabled}>
            {resolvedFinishLabel}
          </Button>
        ) : (
          <Button onClick={onNext} disabled={isNextDisabled}>
            {t('next')}
          </Button>
        )}
      </div>
    </div>
  );
}
