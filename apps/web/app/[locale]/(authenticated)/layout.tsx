import type { ReactNode } from 'react';
import { AuthGuard } from './AuthGuard';
import { DashboardQueryProvider } from './DashboardQueryProvider';

export default function AuthenticatedLayout({ children }: { children: ReactNode }) {
  return (
    <DashboardQueryProvider>
      <AuthGuard>{children}</AuthGuard>
    </DashboardQueryProvider>
  );
}
