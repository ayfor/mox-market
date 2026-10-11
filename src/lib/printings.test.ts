// T3 (AC-10; F2 §Default printing; C1.26, C1.46 = A): selectDefaultPrinting
// applies F2's predicate verbatim, and scryfallPriceCents converts once.
// S2.3 adds T2 (offeredFinishes, AC-4) and T3 (selectablePrintings, AC-1,
// AC-2).
import type { ScryfallCard } from "@/types/scryfall";
import { describe, expect, test } from "vitest";
import {
  ESPER_SENTINEL_PRINTS,
  etchedOnlyPrinting,
  H2R_4_ID,
  J21_ID,
  MH2_12_ID,
  MH2_328_ID,
  PLST_ID,
  PMH2_12S_ID,
  scryfallCard,
  SLD_2123_ID,
  WC21_ID,
} from "./__fixtures__/esper-sentinel-prints";
import {
  compareCollectorNumbers,
  offeredFinishes,
  priceCentsFor,
  scryfallPriceCents,
  selectablePrintings,
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

// --- S2.3: offeredFinishes and selectablePrintings ---------------------------
describe("offeredFinishes (T2, AC-4)", () => {
  test.each<[string, unknown, string[]]>([
    [
      "nonfoil, foil, etched",
      ["nonfoil", "foil", "etched"],
      ["normal", "foil"],
    ],
    ["foil, nonfoil (normal first)", ["foil", "nonfoil"], ["normal", "foil"]],
    ["foil", ["foil"], ["foil"]],
    ["nonfoil", ["nonfoil"], ["normal"]],
    ["etched", ["etched"], []],
    ["empty", [], []],
    ["missing", undefined, []],
    ["not an array", "nonfoil,foil", []],
    ["an object", { 0: "foil", length: 1 }, []],
    ["non-string entries", [1, null, { foil: true }, ["foil"]], []],
    ["glossy (not a shown finish)", ["glossy"], []],
  ])("%s → %j", (_name, finishes, expected) => {
    const offered = offeredFinishes({
      finishes: finishes as ScryfallCard["finishes"],
    });
    expect(offered).toEqual(expected);
    expect(offered).not.toContain("etched");
  });
});

describe("compareCollectorNumbers (T3, AC-2)", () => {
  test("numeric-aware without ICU: 4 < 12 < 12s < 12★ < 328, 9 < 10", () => {
    const sorted = ["328", "12★", "12s", "12", "4", "10", "9"].sort(
      compareCollectorNumbers,
    );
    expect(sorted).toEqual(["4", "9", "10", "12", "12s", "12★", "328"]);
  });

  test("numbers sort before text-led numbers; leading zeros compare as the number", () => {
    expect(["MH2-12", "2", "★1"].sort(compareCollectorNumbers)).toEqual([
      "2",
      "MH2-12",
      "★1",
    ]);
    expect(compareCollectorNumbers("012", "12")).not.toBe(0);
    expect(compareCollectorNumbers("012", "13")).toBeLessThan(0);
    expect(compareCollectorNumbers("12", "12")).toBe(0);
  });

  test("very long digit runs compare by value, not by Number precision", () => {
    expect(
      compareCollectorNumbers("90071992547409931", "90071992547409930"),
    ).toBeGreaterThan(0);
  });
});

describe("selectablePrintings on the Esper Sentinel fixture (T3, AC-1, AC-2)", () => {
  const EXPECTED_ORDER = [
    SLD_2123_ID, // 2025-03-03
    PLST_ID, // 2022-03-01
    WC21_ID, // 2021-12-01
    H2R_4_ID, // 2021-06-18 #4
    MH2_12_ID, // 2021-06-18 #12
    PMH2_12S_ID, // 2021-06-18 #12s
    MH2_328_ID, // 2021-06-18 #328
  ];

  test("exactly the seven paper printings, promo, box and memorabilia included; j21 (digital) absent", () => {
    const ids = selectablePrintings(ESPER_SENTINEL_PRINTS).map((p) => p.id);
    expect(ids).toEqual(EXPECTED_ORDER);
    expect(ids).not.toContain(J21_ID);
    expect(new Set(ids).size).toBe(7);
  });

  test("mh2 #12 and mh2 #328 are separate entries on the same released_at", () => {
    const options = selectablePrintings(ESPER_SENTINEL_PRINTS);
    const mh2 = options.filter((p) => p.set === "mh2");
    expect(mh2.map((p) => p.collector_number)).toEqual(["12", "328"]);
    expect(new Set(mh2.map((p) => p.released_at)).size).toBe(1);
  });

  test("an etched-only printing and one with digital undefined are absent", () => {
    const undefinedDigital = scryfallCard({
      id: "aaaaaaaa-0000-4000-8000-000000000001",
      digital: undefined as unknown as boolean,
    });
    const ids = selectablePrintings([
      ...ESPER_SENTINEL_PRINTS,
      etchedOnlyPrinting(),
      undefinedDigital,
    ]).map((p) => p.id);
    expect(ids).toEqual(EXPECTED_ORDER);
  });

  test("a printing with nonfoil, foil and etched is listed", () => {
    const triple = scryfallCard({
      id: "aaaaaaaa-0000-4000-8000-000000000002",
      released_at: "2026-01-01",
      finishes: ["nonfoil", "foil", "etched"],
    });
    expect(selectablePrintings([triple])[0]?.id).toBe(triple.id);
  });

  test("ties: released_at newest first, then collector number, then id", () => {
    const at = (id: string, released_at: string, collector_number: string) =>
      scryfallCard({ id, released_at, collector_number });
    const list = [
      at("b0000000-0000-4000-8000-000000000000", "2020-01-01", "12"),
      at("a0000000-0000-4000-8000-000000000000", "2020-01-01", "12"),
      at("c0000000-0000-4000-8000-000000000000", "2020-01-01", "9"),
      at("d0000000-0000-4000-8000-000000000000", "2021-01-01", "100"),
      at("e0000000-0000-4000-8000-000000000000", "2020-01-01", "12★"),
    ];
    expect(selectablePrintings(list).map((p) => p.id[0])).toEqual([
      "d",
      "c",
      "a",
      "b",
      "e",
    ]);
  });

  test("an id repeated across pages appears once, the first kept", () => {
    const first = ESPER_SENTINEL_PRINTS.find((p) => p.id === MH2_12_ID)!;
    const repeat = { ...first, set_name: "A later copy" };
    const options = selectablePrintings([
      ...ESPER_SENTINEL_PRINTS,
      repeat,
    ]).filter((p) => p.id === MH2_12_ID);
    expect(options).toHaveLength(1);
    expect(options[0]).toBe(first);
  });

  test.each(["id", "set", "set_name", "collector_number", "released_at"])(
    "an entry without a string %s is left out",
    (field) => {
      const broken = {
        ...scryfallCard({ id: "aaaaaaaa-0000-4000-8000-000000000003" }),
        [field]: 12,
      } as unknown as ScryfallCard;
      const missing = {
        ...scryfallCard({ id: "aaaaaaaa-0000-4000-8000-000000000004" }),
        [field]: undefined,
      } as unknown as ScryfallCard;
      const ids = selectablePrintings([
        ...ESPER_SENTINEL_PRINTS,
        broken,
        missing,
      ]).map((p) => p.id);
      expect(ids).toEqual(EXPECTED_ORDER);
    },
  );

  test("null and non-object entries are skipped, never thrown on", () => {
    const list = [
      null,
      "x",
      ...ESPER_SENTINEL_PRINTS,
    ] as unknown as ScryfallCard[];
    expect(selectablePrintings(list).map((p) => p.id)).toEqual(EXPECTED_ORDER);
  });

  test("the input array is not mutated", () => {
    const input = [...ESPER_SENTINEL_PRINTS];
    const before = [...input];
    selectablePrintings(input);
    expect(input).toEqual(before);
    expect(input.map((p) => p.id)).toEqual(before.map((p) => p.id));
  });

  test("50 seeded shuffles of the input give the same output", () => {
    let seed = 20261010;
    const random = () => {
      // A 32-bit LCG: deterministic, no Math.random.
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const expected = selectablePrintings(ESPER_SENTINEL_PRINTS);
    for (let run = 0; run < 50; run += 1) {
      const shuffled = [...ESPER_SENTINEL_PRINTS];
      for (let i = shuffled.length - 1; i > 0; i -= 1) {
        const j = Math.floor(random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      expect(selectablePrintings(shuffled)).toEqual(expected);
    }
  });

  test("selectDefaultPrinting is unchanged: the default is still mh2 #12, not the newest option", () => {
    expect(selectDefaultPrinting(ESPER_SENTINEL_PRINTS, "normal")?.id).toBe(
      MH2_12_ID,
    );
    expect(selectablePrintings(ESPER_SENTINEL_PRINTS)[0].id).toBe(SLD_2123_ID);
  });
});
