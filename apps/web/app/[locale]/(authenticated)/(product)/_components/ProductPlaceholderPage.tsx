import { useTranslations } from 'next-intl';
import { Card, CardContent } from '@/components/ui';

export function ProductPlaceholderPage() {
  const t = useTranslations('ProductPlaceholderPage');

  return (
    <div>
      <Card className="max-w-3xl border-border shadow-none">
        <CardContent>
          <p className="font-medium text-foreground text-sm">{t('title')}</p>
          <p className="mt-2 text-muted-foreground text-sm">{t('description')}</p>
        </CardContent>
      </Card>
    </div>
  );
}
