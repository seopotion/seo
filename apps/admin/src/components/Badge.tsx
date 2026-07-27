import type { ReactNode } from 'react';

export type Tone = 'neutral' | 'good' | 'warn' | 'bad';

const TONES: Record<Tone, string> = {
  neutral: 'border-neutral-700 bg-neutral-800 text-neutral-300',
  good: 'border-emerald-700 bg-emerald-950 text-emerald-300',
  warn: 'border-amber-700 bg-amber-950 text-amber-300',
  bad: 'border-red-700 bg-red-950 text-red-300',
};

/** Status pill used across the workspace header and lists. */
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`rounded border px-2 py-0.5 text-xs whitespace-nowrap ${TONES[tone]}`}>
      {children}
    </span>
  );
}
