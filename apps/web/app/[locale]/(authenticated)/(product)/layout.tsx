import type { ReactNode } from 'react';
import { DashboardQueryProvider } from './DashboardQueryProvider';
import { ProductAccessGuard } from './ProductAccessGuard';
import { ProductShell } from './ProductShell';

export default function ProductLayout({ children }: { children: ReactNode }) {
  return (
    <DashboardQueryProvider>
      <ProductAccessGuard>
        <ProductShell>{children}</ProductShell>
      </ProductAccessGuard>
    </DashboardQueryProvider>
  );
}
