import { useTranslations } from 'next-intl';
import { Button, Card, CardContent } from '@/components/ui';

export function FinishedState({
  onReviewAnswers,
  onStartOver,
}: {
  onReviewAnswers: () => void;
  onStartOver: () => void;
}) {
  const t = useTranslations('Onboarding.finished');

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-10 sm:px-6 lg:px-8">
      <Card className="mx-auto max-w-2xl">
        <CardContent>
          <p className="font-semibold text-primary text-sm">{t('eyebrow')}</p>
          <h1 className="mt-2 font-bold text-3xl text-gray-900">{t('title')}</h1>
          <p className="mt-3 text-gray-600">{t('description')}</p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Button onClick={onReviewAnswers}>{t('reviewAnswers')}</Button>
            <Button variant="outline" onClick={onStartOver}>
              {t('startOver')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
