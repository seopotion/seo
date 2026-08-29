import type { ReactNode } from 'react';
import { ProductAccessGuard } from './ProductAccessGuard';
import { ProductShell } from './ProductShell';

export default function ProductLayout({ children }: { children: ReactNode }) {
  return (
    <ProductAccessGuard>
      <ProductShell>{children}</ProductShell>
    </ProductAccessGuard>
  );
}
