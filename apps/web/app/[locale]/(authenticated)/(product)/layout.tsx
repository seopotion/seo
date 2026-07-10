import type { ReactNode } from 'react';
import { ActiveOrganizationProvider } from '@/lib/organizations';
import { ProductAccessGuard } from './ProductAccessGuard';
import { ProductShell } from './ProductShell';

export default function ProductLayout({ children }: { children: ReactNode }) {
  return (
    <ProductAccessGuard>
      <ActiveOrganizationProvider>
        <ProductShell>{children}</ProductShell>
      </ActiveOrganizationProvider>
    </ProductAccessGuard>
  );
}
