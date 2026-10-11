// S0.2d17 (AC-9; S0.1d20's posture): the ingest client's config. A local
// URL passes through unchanged; a remote one loses its URL TLS parameters
// and gets verified TLS with the pinned root. Never rejectUnauthorized:
// false, never plaintext. ADV.4: keepalive and a client-side query timeout.
// ADV.18: the TLS assertions also read pg's own effective parameters, since
// pg merges the parsed connection string over the explicit config. Config
// only: a pg.Client is constructed but never connected.
import pg from "pg";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  INGEST_APPLICATION_NAME,
  INGEST_CONNECT_TIMEOUT_MS,
  INGEST_KEEPALIVE_DELAY_MS,
  INGEST_QUERY_TIMEOUT_MS,
  ingestClientConfig,
} from "./db";

const PEM = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n";

describe("ingestClientConfig (S0.2d17)", () => {
  test("a local URL passes through, with no TLS forced on it", () => {
    const url = "postgresql://postgres:postgres@localhost:55432/mox_market";
    expect(ingestClientConfig(url)).toEqual({
      connectionString: url,
      connectionTimeoutMillis: INGEST_CONNECT_TIMEOUT_MS,
      query_timeout: INGEST_QUERY_TIMEOUT_MS,
      keepAlive: true,
      keepAliveInitialDelayMillis: INGEST_KEEPALIVE_DELAY_MS,
      application_name: INGEST_APPLICATION_NAME,
    });
  });

  test.each([
    "postgresql://postgres:postgres@localhost:55432/mox_market",
    "postgresql://u:p@db.x.supabase.co:5432/postgres",
  ])(
    "keepalive and a 120 s client-side query timeout, local or remote (ADV.4): %s",
    (url) => {
      const config = ingestClientConfig(url, { caCert: PEM });
      expect(INGEST_QUERY_TIMEOUT_MS).toBe(120_000);
      expect(config).toMatchObject({
        keepAlive: true,
        keepAliveInitialDelayMillis: 10_000,
        query_timeout: 120_000,
      });
      const params = (
        new pg.Client(config) as unknown as {
          connectionParameters: Record<string, unknown>;
        }
      ).connectionParameters;
      expect(params.keepalives).toBe(1);
      expect(params.query_timeout).toBe(120_000);
    },
  );

  test.each([
    "postgresql://u:p@db.x.supabase.co:5432/postgres",
    "postgresql://u:p@aws-0-x.pooler.supabase.com:5432/postgres?sslmode=disable",
    "postgresql://u:p@db.x.supabase.co:5432/postgres?sslmode=no-verify&ssl=false",
  ])("a remote URL gets verified TLS with the pinned root: %s", (url) => {
    const config = ingestClientConfig(url, { caCert: PEM });
    expect(config.ssl).toEqual({ rejectUnauthorized: true, ca: PEM });
    expect(config.connectionString).not.toMatch(/ssl/i);
  });

  describe("pg's effective TLS, after it merges the parsed URL (ADV.18)", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    test.each([
      "postgresql://u:p@db.x.supabase.co:5432/postgres?sslmode=disable",
      "postgresql://u:p@db.x.supabase.co:5432/postgres?sslmode=no-verify&ssl=false",
      "postgresql://u:p@db.x.supabase.co:5432/postgres?SSLMODE=disable",
      "postgresql://u:p@aws-0-x.pooler.supabase.com:5432/postgres?ssl=0&sslmode=prefer",
    ])(
      "verified with the pinned root even with PGSSLMODE=disable: %s",
      (url) => {
        vi.stubEnv("PGSSLMODE", "disable");
        const client = new pg.Client(ingestClientConfig(url, { caCert: PEM }));
        const params = (
          client as unknown as { connectionParameters: { ssl: unknown } }
        ).connectionParameters;
        expect(params.ssl).toEqual({ rejectUnauthorized: true, ca: PEM });
      },
    );

    test("the raw URL alone would have turned TLS off (why the strip matters)", () => {
      const client = new pg.Client({
        connectionString:
          "postgresql://u:p@db.x.supabase.co:5432/postgres?sslmode=disable",
        ssl: { rejectUnauthorized: true, ca: PEM },
      });
      expect(
        (client as unknown as { connectionParameters: { ssl: unknown } })
          .connectionParameters.ssl,
      ).toBe(false);
    });

    test("a URL with no password takes it from PGPASSWORD (the runbook's path C)", () => {
      vi.stubEnv("PGPASSWORD", "from-the-hidden-prompt");
      const client = new pg.Client(
        ingestClientConfig(
          "postgresql://postgres.ref@aws-0-x.pooler.supabase.com:5432/postgres",
          { caCert: PEM },
        ),
      );
      expect(
        (client as unknown as { connectionParameters: { password: unknown } })
          .connectionParameters.password,
      ).toBe("from-the-hidden-prompt");
    });
  });

  test("a remote URL without a pinned root still verifies (Node's CA store)", () => {
    const config = ingestClientConfig(
      "postgresql://u:p@db.x.supabase.co/postgres",
    );
    expect(config.ssl).toEqual({ rejectUnauthorized: true });
  });

  test("an unparsable URL throws without echoing it", () => {
    expect(() => ingestClientConfig("postgresql://u:s3cret@[bad")).toThrow(
      /does not parse/,
    );
    try {
      ingestClientConfig("postgresql://u:s3cret@[bad");
    } catch (error) {
      expect((error as Error).message).not.toContain("s3cret");
    }
  });
});
