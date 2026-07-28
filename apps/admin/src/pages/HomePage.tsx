/**
 * Placeholder for the org search that opens every operator workflow
 * (design/admin-panel.md §2: search → org detail → act). Wired up in the next
 * subtask of #151.
 */
export function HomePage() {
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold">Find an organization</h1>
      <input
        type="search"
        disabled
        placeholder="Org id, owner email, or website URL"
        className="mt-6 w-full rounded border border-neutral-800 bg-neutral-900 px-4 py-2 text-neutral-500"
      />
      <p className="mt-3 text-sm text-neutral-500">Org search lands in the next subtask.</p>
    </div>
  );
}
