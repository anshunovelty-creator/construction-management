export interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

/** The fields that differ between two stored rows (from the master_changes log). */
export function changedFields(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): FieldChange[] {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  keys.delete('created_at');
  return [...keys]
    .filter((key) => JSON.stringify(before?.[key] ?? null) !== JSON.stringify(after?.[key] ?? null))
    .sort()
    .map((field) => ({ field, before: before?.[field] ?? null, after: after?.[field] ?? null }));
}
