export const REPLACEABLE_MARKER: string;

export interface SchemaSections {
  tables: string;
  replaceable: string;
}

export function splitSchema(schemaSql: string): SchemaSections;
