// S0.2d17 (AC-9; S0.1d20's posture): the ingest client's config. A local
// URL passes through unchanged; a remote one loses its URL TLS parameters
// and gets verified TLS with the pinned root. Never rejectUnauthorized:
// false, never plaintext. Config only: nothing connects here.
import { describe, expect, test } from "vitest";
import {
  INGEST_APPLICATION_NAME,
  INGEST_CONNECT_TIMEOUT_MS,
  ingestClientConfig,
} from "./db";

const PEM = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n";

describe("ingestClientConfig (S0.2d17)", () => {
  test("a local URL passes through, with no TLS forced on it", () => {
    const url = "postgresql://postgres:postgres@localhost:55432/mox_market";
    expect(ingestClientConfig(url)).toEqual({
      connectionString: url,
      connectionTimeoutMillis: INGEST_CONNECT_TIMEOUT_MS,
      application_name: INGEST_APPLICATION_NAME,
    });
  });

  test.each([
    "postgresql://u:p@db.x.supabase.co:5432/postgres",
    "postgresql://u:p@aws-0-x.pooler.supabase.com:5432/postgres?sslmode=disable",
    "postgresql://u:p@db.x.supabase.co:5432/postgres?sslmode=no-verify&ssl=false",
  ])("a remote URL gets verified TLS with the pinned root: %s", (url) => {
    const config = ingestClientConfig(url, { caCert: PEM });
    expect(config.ssl).toEqual({ rejectUnauthorized: true, ca: PEM });
    expect(config.connectionString).not.toMatch(/ssl/i);
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
