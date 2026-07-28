import type { ReactNode } from 'react';

/**
 * The one table look in the panel. Operator tables are dense and deliberately
 * scroll sideways rather than hiding columns — the whole point of these screens
 * is seeing every field the system has.
 */
export function Table({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded border border-neutral-800">
      <table className="w-full text-sm">
        <thead className="bg-neutral-900 text-xs tracking-wider text-neutral-500 uppercase">
          <tr>{head}</tr>
        </thead>
        <tbody className="divide-y divide-neutral-800">{children}</tbody>
      </table>
    </div>
  );
}

export function Th({ children, numeric }: { children: ReactNode; numeric?: boolean }) {
  return (
    <th
      scope="col"
      className={`px-3 py-2 font-semibold whitespace-nowrap ${numeric ? 'text-right' : 'text-left'}`}
    >
      {children}
    </th>
  );
}

export function Td({ children, numeric }: { children: ReactNode; numeric?: boolean }) {
  return (
    <td className={`px-3 py-2 align-top ${numeric ? 'text-right tabular-nums' : ''}`}>
      {children}
    </td>
  );
}
