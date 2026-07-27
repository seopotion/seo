/** Tab routes that exist so the shell (and deep links) are complete, but whose
 * screens land in later subtasks of #151. */
export function PlaceholderTab({ name }: { name: string }) {
  return <p className="text-sm text-neutral-500">{name} lands in a later subtask.</p>;
}
