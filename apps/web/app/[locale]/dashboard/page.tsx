import { redirect } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';

export default async function DashboardRedirectPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;

  redirect({ href: '/home', locale });
}
