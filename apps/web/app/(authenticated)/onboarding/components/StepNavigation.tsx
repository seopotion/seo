import { Button, Separator } from '../../../../components/ui';

export function StepNavigation({
  currentStep,
  finishLabel = 'Get Started',
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
  return (
    <div className="mt-8">
      <Separator />
      <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
        <Button variant="outline" onClick={onBack} disabled={currentStep === 0}>
          Back
        </Button>
        {isFinalStep ? (
          <Button onClick={onFinish} disabled={isFinishDisabled}>
            {finishLabel}
          </Button>
        ) : (
          <Button onClick={onNext} disabled={isNextDisabled}>
            Next
          </Button>
        )}
      </div>
    </div>
  );
}
