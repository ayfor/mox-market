// S0.2's Db interface over a Prisma client (S0.3d5): the daily sync writes
// through the shared `prisma` from src/lib/prisma.ts (verified TLS for every
// remote host, S0.1d20; pg's default pool, not the bounded historyPrisma,
// S0.1d21), so the store's statements run unchanged on the runtime client.
//
// A statement that returns rows (it starts with SELECT or WITH, or carries
// RETURNING) goes through $queryRawUnsafe, and rowCount is the number of rows
// it returned; every other statement goes through $executeRawUnsafe, whose
// count is the affected-row count S0.2's upserts and the prune report.
// "Unsafe" only means Prisma takes a prebuilt text: every SQL text the sync
// sends is a module constant with $n placeholders and no interpolation, and
// every value travels as a bound parameter (T12). Never string-concatenated
// SQL. The client is shared, so nothing here disconnects it.
import type { Db, QueryResultLike } from "./store";

/** The slice of a Prisma client the adapter uses. */
export interface RawSqlClient {
  $queryRawUnsafe(query: string, ...values: unknown[]): Promise<unknown>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
}

/** True when a statement answers with rows (SELECT, WITH or RETURNING). */
export function returnsRows(text: string): boolean {
  return /^\s*(SELECT|WITH)\b/i.test(text) || /\bRETURNING\b/i.test(text);
}

/** S0.2's Db over a Prisma client; a rejected call rejects unchanged. */
export function prismaDb(client: RawSqlClient): Db {
  return {
    async query(
      text: string,
      values: readonly unknown[] = [],
    ): Promise<QueryResultLike> {
      if (returnsRows(text)) {
        const rows = await client.$queryRawUnsafe(text, ...values);
        const list = Array.isArray(rows)
          ? (rows as Record<string, unknown>[])
          : [];
        return { rowCount: list.length, rows: list };
      }
      const count = await client.$executeRawUnsafe(text, ...values);
      return { rowCount: count, rows: [] };
    },
  };
}
