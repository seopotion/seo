import type { ReactNode } from 'react';
import { ActiveOrganizationProvider } from '@/lib/organizations';
import { DashboardQueryProvider } from './DashboardQueryProvider';
import { ProductAccessGuard } from './ProductAccessGuard';
import { ProductShell } from './ProductShell';

export default function ProductLayout({ children }: { children: ReactNode }) {
  return (
    <DashboardQueryProvider>
      <ProductAccessGuard>
        <ActiveOrganizationProvider>
          <ProductShell>{children}</ProductShell>
        </ActiveOrganizationProvider>
      </ProductAccessGuard>
    </DashboardQueryProvider>
  );
}
