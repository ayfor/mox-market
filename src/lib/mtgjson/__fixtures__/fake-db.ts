// A fake Db for unit tests (S0.2d22's unit half): records every statement's
// text and parameter arrays and answers the handful of queries the store
// sends. It never opens a socket; integration tests use a scratch database.
import type { Db, QueryResultLike } from "../store";

export interface Statement {
  readonly text: string;
  readonly values: readonly unknown[];
}

export interface FailRule {
  readonly match: RegExp;
  /** 1-based count of matches; the nth matching statement throws. */
  readonly nth: number;
  readonly error: Error;
}

export interface FakeDbOptions {
  /** pg_database_size() answers, read in order; the last one repeats. */
  readonly sizes?: readonly number[];
  /** Whether price_history is empty for the pre-check. */
  readonly empty?: boolean;
  /** Throw from the matching statement; several rules count independently. */
  readonly failOn?: FailRule | readonly FailRule[];
  /** Called with each statement before it is answered (an abort hook). */
  readonly onStatement?: (statement: Statement) => void;
}

export class FakeDb implements Db {
  readonly statements: Statement[] = [];
  ended = false;
  private sizeReads = 0;
  private readonly matches: number[];
  private readonly rules: readonly FailRule[];

  constructor(private readonly options: FakeDbOptions = {}) {
    const failOn = options.failOn;
    this.rules =
      failOn === undefined
        ? []
        : Array.isArray(failOn)
          ? (failOn as readonly FailRule[])
          : [failOn as FailRule];
    this.matches = this.rules.map(() => 0);
  }

  async query(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResultLike> {
    const statement = { text, values };
    this.statements.push(statement);
    this.options.onStatement?.(statement);
    for (const [i, rule] of this.rules.entries()) {
      if (!rule.match.test(text)) continue;
      this.matches[i] += 1;
      if (this.matches[i] === rule.nth) throw rule.error;
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
