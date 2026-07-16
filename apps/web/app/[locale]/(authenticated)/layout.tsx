import type { ReactNode } from 'react';
import { AuthGuard } from './AuthGuard';

export default function AuthenticatedLayout({ children }: { children: ReactNode }) {
  return <AuthGuard>{children}</AuthGuard>;
}
