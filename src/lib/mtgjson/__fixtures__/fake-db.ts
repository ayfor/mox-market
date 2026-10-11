// A fake Db for unit tests (S0.2d22's unit half): records every statement's
// text and parameter arrays and answers the handful of queries the store
// sends. It never opens a socket; integration tests use a scratch database.
import type { Db, QueryResultLike } from "../store";

export interface Statement {
  readonly text: string;
  readonly values: readonly unknown[];
}

export interface FakeDbOptions {
  /** pg_database_size() answers, read in order; the last one repeats. */
  readonly sizes?: readonly number[];
  /** Whether price_history is empty for the pre-check. */
  readonly empty?: boolean;
  /** Throw this from the matching statement (1-based count of matches). */
  readonly failOn?: { match: RegExp; nth: number; error: Error };
}

export class FakeDb implements Db {
  readonly statements: Statement[] = [];
  ended = false;
  private sizeReads = 0;
  private matches = 0;

  constructor(private readonly options: FakeDbOptions = {}) {}

  async query(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResultLike> {
    this.statements.push({ text, values });
    const fail = this.options.failOn;
    if (fail && fail.match.test(text)) {
      this.matches += 1;
      if (this.matches === fail.nth) throw fail.error;
    }
    if (/pg_database_size/.test(text)) {
      const sizes = this.options.sizes ?? [100_000_000];
      const size = sizes[Math.min(this.sizeReads, sizes.length - 1)];
      this.sizeReads += 1;
      return { rowCount: 1, rows: [{ bytes: String(size) }] };
    }
    if (/NOT EXISTS/.test(text)) {
      return { rowCount: 1, rows: [{ empty: this.options.empty ?? true }] };
    }
    if (/INSERT INTO "price_sync_runs"/.test(text)) {
      return { rowCount: 1, rows: [{ id: 1 }] };
    }
    if (/unnest/.test(text)) {
      const first = values[0];
      return { rowCount: Array.isArray(first) ? first.length : 0, rows: [] };
    }
    return { rowCount: 0, rows: [] };
  }

  async end(): Promise<void> {
    this.ended = true;
  }

  /** Statements whose text matches. */
  matching(pattern: RegExp): Statement[] {
    return this.statements.filter((s) => pattern.test(s.text));
  }

  /** Index of each statement whose text matches, in order. */
  indexesOf(pattern: RegExp): number[] {
    return this.statements.flatMap((s, i) => (pattern.test(s.text) ? [i] : []));
  }
}
