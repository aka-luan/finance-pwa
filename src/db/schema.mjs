// schema.sql is written in two halves, separated by the marker below:
// types/tables/indexes first, then functions and views declared with
// `create or replace`. A database persisted in IndexedDB keeps its tables
// across releases but has no migration story yet, so the second half is
// re-applied on every boot and a fixed calculation reaches an existing
// install without touching its data. Only functions and views propagate
// this way — adding or changing a column will need a real migration.
export const REPLACEABLE_MARKER = '-- >>> funções e views: reaplicadas a cada boot >>>';

export function splitSchema(schemaSql) {
  const parts = schemaSql.split(REPLACEABLE_MARKER);
  if (parts.length !== 2) {
    throw new Error(
      `schema.sql precisa conter exatamente um marcador "${REPLACEABLE_MARKER}" (achei ${parts.length - 1})`,
    );
  }
  return { tables: parts[0], replaceable: parts[1] };
}
