// T3 (AC-10; F2 §Default printing; C1.26, C1.46 = A): selectDefaultPrinting
// applies F2's predicate verbatim, and scryfallPriceCents converts once.
import type { ScryfallCard } from "@/types/scryfall";
import { describe, expect, test } from "vitest";
import {
  ESPER_SENTINEL_PRINTS,
  MH2_12_ID,
  scryfallCard,
} from "./__fixtures__/esper-sentinel-prints";
import {
  priceCentsFor,
  scryfallPriceCents,
  selectDefaultPrinting,
} from "./printings";

const prices = (usd: string | null, usd_foil: string | null) => ({
  usd,
  usd_foil,
  usd_etched: null,
  eur: null,
  eur_foil: null,
  tix: null,
});

/** The mh2 #12 candidate plus `extra`, cheaper ones that must lose. */
const withMh2 = (...extra: ScryfallCard[]) => [
  scryfallCard({ id: MH2_12_ID, prices: prices("59.17", "76.47") }),
  ...extra,
];

/** Deterministic shuffles of a list (rotations and the reverse). */
function shuffles<T>(items: readonly T[]): T[][] {
  const out: T[][] = [[...items].reverse()];
  for (let i = 1; i < items.length; i += 1) {
    out.push([...items.slice(i), ...items.slice(0, i)]);
  }
  return out;
}

describe("selectDefaultPrinting on the Esper Sentinel fixture (T3)", () => {
  test("normal → mh2 #12 at 5917; foil → mh2 #12 at 7647", () => {
    const normal = selectDefaultPrinting(ESPER_SENTINEL_PRINTS, "normal");
    expect(normal?.id).toBe(MH2_12_ID);
    expect(normal && priceCentsFor(normal, "normal")).toBe(5917);
    const foil = selectDefaultPrinting(ESPER_SENTINEL_PRINTS, "foil");
    expect(foil?.id).toBe(MH2_12_ID);
    expect(foil && priceCentsFor(foil, "foil")).toBe(7647);
  });

  test("the fixture's excluded printings are cheaper than the pick, so the predicate decides", () => {
    const cheaper = ESPER_SENTINEL_PRINTS.filter((p) =>
      ["sld", "pmh2", "j21", "wc21"].includes(p.set),
    );
    expect(cheaper).toHaveLength(4);
    for (const p of cheaper) {
      const cents =
        priceCentsFor(p, "normal") ?? priceCentsFor(p, "foil") ?? Infinity;
      expect(cents, p.set).toBeLessThan(5917);
    }
  });

  test("shuffling the input never changes the pick", () => {
    for (const order of shuffles(ESPER_SENTINEL_PRINTS)) {
      expect(selectDefaultPrinting(order, "normal")?.id).toBe(MH2_12_ID);
      expect(selectDefaultPrinting(order, "foil")?.id).toBe(MH2_12_ID);
    }
  });

  test.each<[string, Partial<ScryfallCard>]>([
    ["memorabilia", { set_type: "memorabilia" }],
    ["the promo flag", { promo: true }],
    ["a promo set_type", { set_type: "promo" }],
    ["token", { set_type: "token" }],
    ["minigame", { set_type: "minigame" }],
    ["box (C1.46 = A)", { set_type: "box" }],
    ["digital", { digital: true }],
  ])("a %s printing is never picked even when cheapest", (_name, overrides) => {
    const cheap = scryfallCard({
      id: "99999999-9999-4999-8999-999999999999",
      prices: prices("0.10", "0.10"),
      ...overrides,
    });
    expect(selectDefaultPrinting(withMh2(cheap), "normal")?.id).toBe(MH2_12_ID);
    expect(selectDefaultPrinting(withMh2(cheap), "foil")?.id).toBe(MH2_12_ID);
  });

  test("a printing without the mapped finish is skipped (normal → nonfoil, foil → foil)", () => {
    const foilOnly = scryfallCard({
      id: "aaaaaaaa-0000-4000-8000-000000000001",
      finishes: ["foil"],
      prices: prices("0.10", "0.10"),
    });
    const nonfoilOnly = scryfallCard({
      id: "aaaaaaaa-0000-4000-8000-000000000002",
      finishes: ["nonfoil"],
      prices: prices("0.10", "0.10"),
    });
    const etchedOnly = scryfallCard({
      id: "aaaaaaaa-0000-4000-8000-000000000003",
      finishes: ["etched"],
      prices: prices("0.10", "0.10"),
    });
    expect(
      selectDefaultPrinting(withMh2(foilOnly, etchedOnly), "normal")?.id,
    ).toBe(MH2_12_ID);
    expect(
      selectDefaultPrinting(withMh2(nonfoilOnly, etchedOnly), "foil")?.id,
    ).toBe(MH2_12_ID);
    expect(selectDefaultPrinting(withMh2(foilOnly), "foil")?.id).toBe(
      foilOnly.id,
    );
  });

  test.each([[null], [""], ["abc"], ["0.00"], ["-1"]])(
    "a printing whose price for the finish is %j is skipped",
    (bad) => {
      const unpriced = scryfallCard({
        id: "bbbbbbbb-0000-4000-8000-000000000001",
        released_at: "2000-01-01",
        prices: prices(bad, bad),
      });
      expect(selectDefaultPrinting(withMh2(unpriced), "normal")?.id).toBe(
        MH2_12_ID,
      );
      expect(selectDefaultPrinting(withMh2(unpriced), "foil")?.id).toBe(
        MH2_12_ID,
      );
    },
  );

  test("a tie on price goes to the earliest released_at, then the lowest id", () => {
    const later = scryfallCard({
      id: "00000000-0000-4000-8000-00000000000a",
      released_at: "2022-01-01",
      prices: prices("10.00", null),
    });
    const earlier = scryfallCard({
      id: "ffffffff-0000-4000-8000-00000000000b",
      released_at: "2020-01-01",
      prices: prices("10.00", null),
    });
    const sameDayHighId = scryfallCard({
      id: "ffffffff-0000-4000-8000-00000000000c",
      released_at: "2020-01-01",
      prices: prices("10.00", null),
    });
    const sameDayLowId = scryfallCard({
      id: "11111111-0000-4000-8000-00000000000d",
      released_at: "2020-01-01",
      prices: prices("10.00", null),
    });
    expect(selectDefaultPrinting([later, earlier], "normal")?.id).toBe(
      earlier.id,
    );
    for (const order of shuffles([
      later,
      earlier,
      sameDayHighId,
      sameDayLowId,
    ])) {
      expect(selectDefaultPrinting(order, "normal")?.id).toBe(sameDayLowId.id);
    }
  });

  test("no candidate → null", () => {
    expect(selectDefaultPrinting([], "normal")).toBeNull();
    const onlyExcluded = ESPER_SENTINEL_PRINTS.filter(
      (p) => p.id !== MH2_12_ID,
    ).map((p) => ({ ...p, digital: true }));
    expect(selectDefaultPrinting(onlyExcluded, "normal")).toBeNull();
    expect(selectDefaultPrinting(onlyExcluded, "foil")).toBeNull();
  });
});

describe("scryfallPriceCents (T3)", () => {
  test.each([
    ["59.17", 5917],
    ["0.01", 1],
    ["76.47", 7647],
    ["1234.5", 123450],
  ])("%j → %i", (price, cents) => {
    expect(scryfallPriceCents(price)).toBe(cents);
  });

  test.each([
    [null],
    [undefined],
    [""],
    ["abc"],
    ["0.00"],
    ["-3"],
    ["1e3"],
    ["0.004"],
  ])("%j → null", (price) => {
    expect(scryfallPriceCents(price)).toBeNull();
  });
});
