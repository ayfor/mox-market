// T6 (AC-14; C1.32): withTimeout races a read to its budget.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { HISTORY_TIMEOUT_MS } from "./consts";
import { HistoryTimeoutError, withTimeout } from "./with-timeout";

const after = <T>(ms: number, value: T) =>
  new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("withTimeout (T6)", () => {
  test("HISTORY_TIMEOUT_MS is 500", () => {
    expect(HISTORY_TIMEOUT_MS).toBe(500);
  });

  test("resolves with the value before the deadline (499 ms)", async () => {
    const result = withTimeout(() => after(499, "rows"), HISTORY_TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(499);
    await expect(result).resolves.toBe("rows");
  });

  test("rejects with HistoryTimeoutError at 500 ms", async () => {
    const result = withTimeout(() => new Promise<never>(() => {}), 500);
    const outcome = result.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(499);
    let settled = false;
    void result.then(
      () => (settled = true),
      () => (settled = true),
    );
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const error = await outcome;
    expect(error).toBeInstanceOf(HistoryTimeoutError);
    expect((error as HistoryTimeoutError).timeoutMs).toBe(500);
  });

  test("a read slower than the budget (501 ms) rejects", async () => {
    const outcome = withTimeout(() => after(501, "late"), 500).catch(
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(501);
    expect(await outcome).toBeInstanceOf(HistoryTimeoutError);
  });

  test("passes a rejection through", async () => {
    const boom = new Error("db down");
    await expect(withTimeout(() => Promise.reject(boom), 500)).rejects.toBe(
      boom,
    );
  });

  test("clears its timer on settle, either way", async () => {
    await withTimeout(() => Promise.resolve(1), 500);
    expect(vi.getTimerCount()).toBe(0);
    await withTimeout(() => Promise.reject(new Error("x")), 500).catch(
      () => {},
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  test("a read that throws synchronously becomes a rejection", async () => {
    const boom = new Error("sync");
    const run = () =>
      withTimeout((): Promise<number> => {
        throw boom;
      }, 500);
    let pending: Promise<number> | undefined;
    expect(() => {
      pending = run();
    }).not.toThrow();
    await expect(pending).rejects.toBe(boom);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("a read that rejects after the deadline raises no unhandled rejection", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const late = new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error("late failure")), 800),
      );
      const outcome = withTimeout(() => late, 500).catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(500);
      expect(await outcome).toBeInstanceOf(HistoryTimeoutError);
      await vi.advanceTimersByTimeAsync(300);
      vi.useRealTimers();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });
});
