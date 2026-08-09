import { types } from '@electric-sql/pglite';

// Shared by the app (src/db/index.ts) and the node test scripts
// (pglite-smoke-test.mjs, pglite-sim-test.mjs) so both talk to PGlite
// through the same wire-type handling. See SPEC.md §5.
export const DATA_DIR = 'idb://termometro';

export const pgliteParsers = {
  // int8 (bigint) comes back from the wire as a string; the app deals in
  // cents as bigint everywhere, never float/Decimal.
  [types.INT8]: (value) => BigInt(value),
  // sum(bigint) widens to numeric in plain views (card_bill.amount_cents) —
  // there are no fractional numeric columns in this schema, so the same
  // bigint handling applies here too.
  [types.NUMERIC]: (value) => BigInt(value),
  // Postgres sends dates as 'YYYY-MM-DD' text; PGlite's default parser turns
  // that into a UTC-midnight Date, which formats a day early in
  // America/Belem. Keep it as the raw string and format only at display time.
  [types.DATE]: (value) => value,
};
