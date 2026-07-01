import { errorClass } from '../constants';

export function ErrorMessage({ children }: { children?: string }) {
  if (!children) return null;

  return <p className={errorClass}>{children}</p>;
}
