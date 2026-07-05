import { Button, Progress } from '../../../../components/ui';
import { cn } from '../../../../lib/utils';

export function ProgressSteps({
  currentStep,
  onStepClick,
  steps,
}: {
  currentStep: number;
  onStepClick: (stepIndex: number) => void;
  steps: readonly string[];
}) {
  const progressValue = ((currentStep + 1) / steps.length) * 100;

  return (
    <div className="mb-6">
      <Progress value={progressValue} aria-label="Onboarding progress" />
      <ol className="mt-4 flex gap-1 overflow-x-auto" aria-label="Onboarding steps">
        {steps.map((step, index) => {
          const active = index === currentStep;
          const complete = index < currentStep;

          return (
            <li key={step} className="min-w-30 flex-1">
              <Button
                variant={active ? 'secondary' : 'ghost'}
                onClick={() => onStepClick(index)}
                disabled={index > currentStep}
                aria-current={active ? 'step' : undefined}
                className={cn(
                  'h-full w-full flex-col items-start gap-0.5 whitespace-normal p-2 text-left',
                  active && 'bg-card text-card-foreground shadow-xs',
                  complete && 'text-foreground',
                  index > currentStep && 'text-muted-foreground',
                )}
              >
                <span className="block text-muted-foreground text-xs">Step {index + 1}</span>
                <span>{step}</span>
              </Button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
