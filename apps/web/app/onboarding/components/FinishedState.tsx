import { Button } from '../../../components/ui';

export function FinishedState({
  onReviewAnswers,
  onStartOver,
}: {
  onReviewAnswers: () => void;
  onStartOver: () => void;
}) {
  return (
    <main className="min-h-screen bg-gray-50 px-4 py-10 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-2xl rounded-lg border border-gray-200 bg-white p-6 shadow-xs sm:p-8">
        <p className="font-semibold text-primary text-sm">Onboarding complete</p>
        <h1 className="mt-2 font-bold text-3xl text-gray-900">You&apos;re ready to start.</h1>
        <p className="mt-3 text-gray-600">
          Your mock onboarding flow is complete. The next implementation pass can wire these answers
          into setup status, scanning, and persistence.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Button onClick={onReviewAnswers}>Review answers</Button>
          <Button variant="outline" onClick={onStartOver}>
            Start over
          </Button>
        </div>
      </section>
    </main>
  );
}
