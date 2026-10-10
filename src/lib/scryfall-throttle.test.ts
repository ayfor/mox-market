// S2.1 ADV-1: the real throttle, never mocked here. A request's deadline
// covers its wait in the throttle queue, the queue refuses callers whose slot
// is too far away, and so a flood of autocomplete calls can neither hang a
// result render nor grow the queue without bound. Each test loads fresh
// modules, so the throttle's slot clock starts empty.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ESPER_PRINTS_URI } from "./__fixtures__/esper-sentinel-prints";
import {
  AUTOCOMPLETE_MAX_QUEUE_MS,
  SCRYFALL_MAX_QUEUE_MS,
  SCRYFALL_TIMEOUT_MS,
} from "./evaluation/consts";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-10T12:00:00.000Z"));
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Fresh throttle and Scryfall client modules sharing one slot clock. */
async function fresh() {
  const throttleModule = await import("./throttle");
  const scryfall = await import("./scryfall");
  return { ...throttleModule, scryfall };
}

/** Reserves `n` slots, 100 ms apart, starting now. */
function fill(throttle: (typeof import("./throttle"))["throttle"], n: number) {
  for (let i = 0; i < n; i += 1) void throttle().catch(() => {});
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/** A fetch that never answers but rejects when its signal aborts. */
const hangingFetch = (_url: RequestInfo | URL, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () =>
      reject(new DOMException("aborted", "AbortError")),
    );
  });

/** Settles to "resolved" or the error's name, never rejecting. */
const outcomeOf = (promise: Promise<unknown>) =>
  promise.then(
    () => "resolved",
    (error: unknown) => (error as Error).name,
  );

describe("throttle (ADV-1)", () => {
  test("spaces callers 100 ms apart, the first at once", async () => {
    const { throttle } = await fresh();
    const at: number[] = [];
    const start = Date.now();
    for (let i = 0; i < 3; i += 1) {
      void throttle().then(() => at.push(Date.now() - start));
    }
    await vi.advanceTimersByTimeAsync(250);
    expect(at).toEqual([0, 100, 200]);
  });

  test("refuses a caller whose slot is past maxWaitMs at once, reserving nothing", async () => {
    const { throttle, ThrottleBacklogError } = await fresh();
    fill(throttle, 3); // slots at 0, 100 and 200; the next is at 300
    await expect(throttle({ maxWaitMs: 299 })).rejects.toBeInstanceOf(
      ThrottleBacklogError,
    );
    const at: number[] = [];
    void throttle({ maxWaitMs: 300 }).then(() => at.push(Date.now()));
    await vi.advanceTimersByTimeAsync(300);
    expect(at).toHaveLength(1);
  });

  test("an abort while queued rejects with the signal's reason and keeps the slot used", async () => {
    const { throttle } = await fresh();
    fill(throttle, 1);
    const controller = new AbortController();
    const waiting = outcomeOf(throttle({ signal: controller.signal }));
    controller.abort();
    await expect(waiting).resolves.toBe("AbortError");
    const at: number[] = [];
    const start = Date.now();
    void throttle().then(() => at.push(Date.now() - start));
    await vi.advanceTimersByTimeAsync(200);
    expect(at).toEqual([200]);
  });

  test("an already aborted signal rejects before reserving a slot", async () => {
    const { throttle } = await fresh();
    const controller = new AbortController();
    controller.abort();
    await expect(throttle({ signal: controller.signal })).rejects.toThrow();
    const at: number[] = [];
    void throttle().then(() => at.push(Date.now()));
    await vi.advanceTimersByTimeAsync(0);
    expect(at).toHaveLength(1);
  });
});

describe("the request deadline covers the queue (ADV-1)", () => {
  test("200 queued callers: getCardByName rejects within SCRYFALL_TIMEOUT_MS, Scryfall never called", async () => {
    const { throttle, scryfall } = await fresh();
    fetchMock.mockImplementation(async () => json({ id: "x" }));
    fill(throttle, 200);
    const outcome = outcomeOf(scryfall.getCardByName("Esper Sentinel", true));
    await vi.advanceTimersByTimeAsync(SCRYFALL_TIMEOUT_MS + 1);
    await expect(outcome).resolves.toBe("ThrottleBacklogError");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("a 3 s queue then a hung Scryfall: aborts 8 s after the call, not 8 s after the slot", async () => {
    const { throttle, scryfall } = await fresh();
    fetchMock.mockImplementation(hangingFetch);
    fill(throttle, 30); // the next slot is 3 s away, inside SCRYFALL_MAX_QUEUE_MS
    let settled = "pending";
    void outcomeOf(scryfall.getCardByName("Esper Sentinel", true)).then(
      (o) => (settled = o),
    );
    await vi.advanceTimersByTimeAsync(3_000);
    expect(fetchMock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(SCRYFALL_TIMEOUT_MS - 3_000 - 1);
    expect(settled).toBe("pending");
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe("AbortError");
  });

  test("a 3 s queue then a healthy Scryfall: the lookup resolves after its slot", async () => {
    const { throttle, scryfall } = await fresh();
    fetchMock.mockImplementation(async () =>
      json({ id: "x", name: "Esper Sentinel" }),
    );
    fill(throttle, 30);
    const card = scryfall.getCardByName("Esper Sentinel", true);
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(card).resolves.toMatchObject({ name: "Esper Sentinel" });
    expect(vi.getTimerCount()).toBe(0);
  });

  test(`a slot more than SCRYFALL_MAX_QUEUE_MS away is refused at once`, async () => {
    const { throttle, scryfall } = await fresh();
    fill(throttle, SCRYFALL_MAX_QUEUE_MS / 100 + 1);
    await expect(
      scryfall.getAllPrintings({ prints_search_uri: ESPER_PRINTS_URI }),
    ).rejects.toThrow(/backlog/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("autocomplete is refused past AUTOCOMPLETE_MAX_QUEUE_MS but waits within it", async () => {
    const { throttle, scryfall } = await fresh();
    fetchMock.mockImplementation(async () =>
      json({ object: "catalog", data: ["Esper Sentinel"] }),
    );
    fill(throttle, AUTOCOMPLETE_MAX_QUEUE_MS / 100 + 1);
    await expect(scryfall.autocomplete("esper")).rejects.toThrow(/backlog/);
    expect(fetchMock).not.toHaveBeenCalled();

    vi.resetModules();
    const again = await fresh();
    fill(again.throttle, 5);
    const names = again.scryfall.autocomplete("esper");
    await vi.advanceTimersByTimeAsync(500);
    await expect(names).resolves.toEqual(["Esper Sentinel"]);
  });
});

describe("callers under a flood (ADV-1)", () => {
  test("the autocomplete route answers 502 no-store at once, never calling Scryfall", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { throttle } = await fresh();
    const { GET } = await import("@/app/api/cards/autocomplete/route");
    fill(throttle, 200);
    const response = await GET(
      new Request("http://localhost/api/cards/autocomplete?q=esper"),
    );
    expect(response.status).toBe(502);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("buildEvaluation with a lookup stuck behind the queue gives { status: 'error' } within the budget", async () => {
    const { throttle, scryfall } = await fresh();
    const { buildEvaluation } =
      await import("@/lib/evaluation/build-evaluation");
    const { emptyHistoryReader } =
      await import("@/lib/evaluation/history-reader");
    fetchMock.mockImplementation(hangingFetch);
    fill(throttle, 200);
    const log = vi.fn();
    let settled: unknown = "pending";
    void buildEvaluation(
      { card: "Esper Sentinel", askingPriceCents: 7499, finish: "normal" },
      {
        scryfall: {
          getCardByName: scryfall.getCardByName,
          getAllPrintings: scryfall.getAllPrintings,
        },
        reader: emptyHistoryReader,
        now: () => new Date(),
        log,
      },
    ).then((evaluation) => (settled = evaluation));
    await vi.advanceTimersByTimeAsync(SCRYFALL_TIMEOUT_MS);
    expect(settled).toEqual({ status: "error" });
    expect(log).toHaveBeenCalledWith("scryfall_failed", expect.any(Error));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
