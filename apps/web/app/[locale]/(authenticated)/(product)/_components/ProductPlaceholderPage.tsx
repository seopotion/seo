import { useTranslations } from 'next-intl';
import { Card, CardContent } from '@/components/ui';

export function ProductPlaceholderPage() {
  const t = useTranslations('ProductPlaceholderPage');

  return (
    <div>
      <Card className="max-w-3xl border-slate-200 shadow-none">
        <CardContent>
          <p className="font-medium text-slate-900 text-sm">{t('title')}</p>
          <p className="mt-2 text-slate-600 text-sm">{t('description')}</p>
        </CardContent>
      </Card>
    </div>
  );
}
