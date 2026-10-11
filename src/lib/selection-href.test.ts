// T4 (AC-5; C2-B.7) and T5 (AC-6): the switch href is query-only and keeps
// the URL's price verbatim, so the path segment is never rebuilt; and the
// next-selection rule never changes the other control silently.
import { describe, expect, test } from "vitest";
import {
  H2R_4_ID,
  MH2_12_ID,
  MH2_328_ID,
  PLST_ID,
  SLD_2123_ID,
} from "./__fixtures__/esper-sentinel-prints";
import {
  decodeCardSegment,
  parseResultParams,
} from "./evaluation/result-params";
import type { ShownFinish } from "./recommendation/ui-copy";
import {
  nextSelection,
  selectionHref,
  type SelectableOption,
  type ShownSelection,
} from "./selection-href";

/** A read-only search params object, shaped like Next's ReadonlyURLSearchParams. */
class ReadonlySearchParams {
  readonly #inner: URLSearchParams;
  constructor(init: string) {
    this.#inner = new URLSearchParams(init);
  }
  get(name: string): string | null {
    return this.#inner.get(name);
  }
  toString(): string {
    return this.#inner.toString();
  }
}

describe("selectionHref (T4, AC-5)", () => {
  test("from price=74.99, foil on mh2 #12 → exactly the query-only href", () => {
    expect(
      selectionHref(new URLSearchParams("price=74.99"), {
        printing: MH2_12_ID,
        finish: "foil",
      }),
    ).toBe(
      "?price=74.99&finish=foil&printing=f3537373-ef54-4578-9d05-6216420ee349",
    );
  });

  test.each([
    ["$74.99", "price=%2474.99"],
    ["1,234.50", "price=1%2C234.50"],
    ["74.99 ", "price=74.99%20"],
    ["a&b=c", "price=a%26b%3Dc"],
  ])("the price %j is kept verbatim and encoded as %s", (price, encoded) => {
    const search = new URLSearchParams();
    search.set("price", price);
    const href = selectionHref(search, {
      printing: SLD_2123_ID,
      finish: "normal",
    });
    expect(href).toBe(`?${encoded}&finish=normal&printing=${SLD_2123_ID}`);
    expect(new URLSearchParams(href.slice(1)).get("price")).toBe(price);
  });

  test("an existing finish and printing are replaced; unknown params are dropped", () => {
    const href = selectionHref(
      new URLSearchParams(
        `price=5&finish=normal&printing=${PLST_ID}&utm_source=x&card=Jace&next=/evil`,
      ),
      { printing: MH2_328_ID, finish: "foil" },
    );
    expect(href).toBe(`?price=5&finish=foil&printing=${MH2_328_ID}`);
    const params = new URLSearchParams(href.slice(1));
    expect([...params.keys()]).toEqual(["price", "finish", "printing"]);
  });

  test("a repeated price keeps the first", () => {
    expect(
      selectionHref(new URLSearchParams("price=1&price=2"), {
        printing: MH2_12_ID,
        finish: "normal",
      }),
    ).toBe(`?price=1&finish=normal&printing=${MH2_12_ID}`);
  });

  test("starts with ? and holds no /", () => {
    const href = selectionHref(new URLSearchParams("price=1/2"), {
      printing: MH2_12_ID,
      finish: "normal",
    });
    expect(href.startsWith("?")).toBe(true);
    expect(href).not.toContain("/");
  });

  test("works with a read-only search params object and never mutates its input", () => {
    const readonly = new ReadonlySearchParams("price=74.99&finish=normal");
    expect(
      selectionHref(readonly, { printing: MH2_12_ID, finish: "foil" }),
    ).toBe(`?price=74.99&finish=foil&printing=${MH2_12_ID}`);
    const mutable = new URLSearchParams("price=74.99&finish=normal&x=1");
    const before = mutable.toString();
    selectionHref(mutable, { printing: MH2_12_ID, finish: "foil" });
    expect(mutable.toString()).toBe(before);
  });

  // S2.4 AC-4's names: the switch keeps each one's path segment byte for byte.
  test.each([
    ["/Fire%20%2F%2F%20Ice?price=2", "Fire // Ice", 200],
    ["/%2B2%20Mace?price=0.25", "+2 Mace", 25],
    ["/Question%20Elemental%3F?price=3", "Question Elemental?", 300],
    ["/Lim-D%C3%BBl's%20Vault?price=1", "Lim-Dûl's Vault", 100],
    ["/Esper%20Sentinel?price=74.99", "Esper Sentinel", 7499],
  ])(
    "resolved against %s: the pathname is unchanged and parses to the same card and cents",
    (current, card, cents) => {
      const base = new URL(current, "https://mox-market.test");
      const href = selectionHref(base.searchParams, {
        printing: H2R_4_ID,
        finish: "foil",
      });
      const next = new URL(href, base);
      expect(next.pathname).toBe(base.pathname);
      expect(next.origin).toBe(base.origin);
      const segment = next.pathname.slice(1);
      expect(decodeCardSegment(segment)).toBe(card);
      const search = Object.fromEntries(next.searchParams);
      expect(parseResultParams(segment, search)).toEqual({
        kind: "ok",
        card,
        price: base.searchParams.get("price"),
        askingPriceCents: cents,
        finish: "foil",
        printing: H2R_4_ID,
        paramsKey: `${card}|${cents}|foil|${H2R_4_ID}`,
      });
    },
  );
});

/** mh2 #12 (both), sld #2123 (foil only), plst (normal only), mh2 #328 (both). */
const OPTIONS: readonly SelectableOption[] = [
  { id: SLD_2123_ID, finishes: ["foil"] },
  { id: PLST_ID, finishes: ["normal"] },
  { id: MH2_12_ID, finishes: ["normal", "foil"] },
  { id: MH2_328_ID, finishes: ["normal", "foil"] },
];

const shown = (
  printingId: string,
  finish: ShownFinish,
  offeredFinishes: readonly ShownFinish[] = OPTIONS.find(
    (o) => o.id === printingId,
  )?.finishes ?? ["normal", "foil"],
): ShownSelection => ({ printingId, finish, offeredFinishes });

describe("nextSelection (T5, AC-6)", () => {
  test("a finish change from a default render writes the shown printing's id", () => {
    expect(
      nextSelection(shown(MH2_12_ID, "normal"), { finish: "foil" }, OPTIONS),
    ).toEqual({ printing: MH2_12_ID, finish: "foil" });
  });

  test("a printing change keeps the finish when that printing offers it", () => {
    expect(
      nextSelection(shown(MH2_12_ID, "normal"), { printing: PLST_ID }, OPTIONS),
    ).toEqual({ printing: PLST_ID, finish: "normal" });
  });

  test("mh2 #12 / normal → sld #2123 (foil only) gives foil", () => {
    expect(
      nextSelection(
        shown(MH2_12_ID, "normal"),
        { printing: SLD_2123_ID },
        OPTIONS,
      ),
    ).toEqual({ printing: SLD_2123_ID, finish: "foil" });
  });

  test("plst (normal only) from foil gives normal", () => {
    expect(
      nextSelection(shown(MH2_12_ID, "foil"), { printing: PLST_ID }, OPTIONS),
    ).toEqual({ printing: PLST_ID, finish: "normal" });
  });

  test("a printing offering both from foil keeps foil", () => {
    expect(
      nextSelection(
        shown(MH2_12_ID, "foil"),
        { printing: MH2_328_ID },
        OPTIONS,
      ),
    ).toEqual({ printing: MH2_328_ID, finish: "foil" });
  });

  test("the shown printing again, or the shown finish again → null", () => {
    expect(
      nextSelection(
        shown(MH2_12_ID, "normal"),
        { printing: MH2_12_ID },
        OPTIONS,
      ),
    ).toBeNull();
    expect(
      nextSelection(shown(MH2_12_ID, "normal"), { finish: "normal" }, OPTIONS),
    ).toBeNull();
  });

  test("an id not in options or a finish the printing does not offer → null", () => {
    expect(
      nextSelection(
        shown(MH2_12_ID, "normal"),
        { printing: "00000000-0000-4000-8000-000000000000" },
        OPTIONS,
      ),
    ).toBeNull();
    expect(
      nextSelection(shown(PLST_ID, "normal"), { finish: "foil" }, OPTIONS),
    ).toBeNull();
    expect(
      nextSelection(shown(MH2_12_ID, "normal"), { printing: "x" }, [
        { id: "x", finishes: [] },
      ]),
    ).toBeNull();
  });

  test("the AC-9 state: sld shown with normal requested; choosing Foil → sld / foil", () => {
    const ac9 = shown(SLD_2123_ID, "normal", ["foil"]);
    expect(nextSelection(ac9, { finish: "foil" }, OPTIONS)).toEqual({
      printing: SLD_2123_ID,
      finish: "foil",
    });
    // From there a printing offering normal keeps the requested normal.
    expect(nextSelection(ac9, { printing: MH2_12_ID }, OPTIONS)).toEqual({
      printing: MH2_12_ID,
      finish: "normal",
    });
  });

  test("never returns etched, even when asked for it or offered it by a cast", () => {
    const etched = "etched" as ShownFinish;
    expect(
      nextSelection(shown(MH2_12_ID, "normal"), { finish: etched }, OPTIONS),
    ).toBeNull();
    expect(
      nextSelection(shown(MH2_12_ID, "normal"), { printing: "x" }, [
        { id: "x", finishes: [etched] },
      ]),
    ).toBeNull();
    expect(
      nextSelection(shown(MH2_12_ID, "normal"), { printing: "x" }, [
        { id: "x", finishes: [etched, "foil"] },
      ]),
    ).toEqual({ printing: "x", finish: "foil" });
  });

  test("the first offered finish is normal before foil, whatever the option's order", () => {
    expect(
      nextSelection(shown(SLD_2123_ID, "foil", ["foil"]), { printing: "x" }, [
        { id: "x", finishes: ["normal"] },
      ]),
    ).toEqual({ printing: "x", finish: "normal" });
    // A shown finish no option offers (only a cast can make one) takes the
    // option's first finish in normal-then-foil order.
    expect(
      nextSelection(
        shown(PLST_ID, "etched" as ShownFinish, ["normal"]),
        { printing: "y" },
        [{ id: "y", finishes: ["foil", "normal"] }],
      ),
    ).toEqual({ printing: "y", finish: "normal" });
  });
});
