// T10 (AC-7; C1.31; S2.1d12): the 36-hour flag, the 48-hour banner and the
// relative time on the history line.
import { describe, expect, test } from "vitest";
import { STALE_BANNER_HOURS, STALENESS_FLAG_HOURS } from "./consts";
import { isHistoryStale, isSyncStale, relativeTime } from "./staleness";

const NOW = new Date("2026-10-10T12:00:00.000Z");
const HOUR = 3_600_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe("isHistoryStale (T10)", () => {
  test("STALENESS_FLAG_HOURS is 36", () => {
    expect(STALENESS_FLAG_HOURS).toBe(36);
  });

  test("false for null, at exactly 36 h, for an invalid date and a future date", () => {
    expect(isHistoryStale(null, NOW)).toBe(false);
    expect(isHistoryStale(ago(36 * HOUR), NOW)).toBe(false);
    expect(isHistoryStale(new Date("not a date"), NOW)).toBe(false);
    expect(isHistoryStale(ago(-5 * HOUR), NOW)).toBe(false);
  });

  test("true at 36 h + 1 ms", () => {
    expect(isHistoryStale(ago(36 * HOUR + 1), NOW)).toBe(true);
  });
});

describe("isSyncStale (T10)", () => {
  test("STALE_BANNER_HOURS is 48", () => {
    expect(STALE_BANNER_HOURS).toBe(48);
  });

  test("true for null and an unreadable date", () => {
    expect(isSyncStale(null, NOW)).toBe(true);
    expect(isSyncStale(new Date("garbage"), NOW)).toBe(true);
  });

  test("false at exactly 48 h and for a future date; true at 48 h + 1 ms", () => {
    expect(isSyncStale(ago(48 * HOUR), NOW)).toBe(false);
    expect(isSyncStale(ago(-HOUR), NOW)).toBe(false);
    expect(isSyncStale(ago(48 * HOUR + 1), NOW)).toBe(true);
  });
});

describe("relativeTime (T10)", () => {
  test.each([
    [0, "1 minute ago"],
    [59_999, "1 minute ago"],
    [60_000, "1 minute ago"],
    [5 * 60_000, "5 minutes ago"],
    [59 * 60_000, "59 minutes ago"],
    [HOUR, "1 hour ago"],
    [3 * HOUR, "3 hours ago"],
    [37 * HOUR, "37 hours ago"],
    [48 * HOUR - 1, "47 hours ago"],
    [48 * HOUR, "2 days ago"],
    [5 * 24 * HOUR, "5 days ago"],
  ])("%i ms → %j", (elapsed, text) => {
    expect(relativeTime(ago(elapsed), NOW)).toBe(text);
  });

  test("never a future phrase: a future date reads 1 minute ago", () => {
    expect(relativeTime(ago(-3 * HOUR), NOW)).toBe("1 minute ago");
  });
});
