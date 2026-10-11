// Imported FIRST by scripts/ingest-mtgjson-history.ts (S0.2d16, ADV.15). It
// imports nothing, so CommonJS and ESM both evaluate it before any other
// module of the script: ALLOW_PROD_INGEST is read before any module or the
// .env loader could set it, and a copy stored in any .env* file never
// counts. tests/contract/mtgjson-env-order.test.ts pins the order and that no
// module the script reaches loads an env file itself.
export const INLINE_ALLOW_PROD_INGEST: string | undefined =
  process.env.ALLOW_PROD_INGEST;
