export function ProgressSteps({
  currentStep,
  onStepClick,
  steps,
}: {
  currentStep: number;
  onStepClick: (stepIndex: number) => void;
  steps: readonly string[];
}) {
  return (
    <ol className="mb-6 flex gap-1 overflow-x-auto" aria-label="Onboarding progress">
      {steps.map((step, index) => {
        const active = index === currentStep;
        const complete = index < currentStep;

        return (
          <li key={step} className="min-w-30 flex-1">
            <button
              type="button"
              onClick={() => onStepClick(index)}
              disabled={index > currentStep}
              aria-current={active ? 'step' : undefined}
              className={`h-full w-full p-2 text-left text-sm transition ${
                active
                  ? ' bg-white font-bold text-gray-950'
                  : complete
                    ? 'border-gray-300 bg-white font-semibold text-gray-700 hover:bg-gray-50'
                    : 'border-gray-200 bg-gray-100 text-gray-500'
              }`}
            >
              <span className="block text-xs text-gray-500">Step {index + 1}</span>
              <span>{step}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
