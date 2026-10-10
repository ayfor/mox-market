// T18 (S1.3, AC-1, AC-5; S1.3d7): fillTemplate reads each locked template's
// placeholders from its literal type, so a missing or misspelt key fails the
// build. Type-level only: each call is wrapped so it never runs.
import { describe, expectTypeOf, test } from "vitest";
import {
  FALLBACK_NOTICE,
  fillTemplate,
  type Placeholders,
  REASON_COPY,
} from "./copy";
import { UI_COPY } from "./ui-copy";

describe("fillTemplate's typed values", () => {
  test("a template's placeholders are a union of its keys", () => {
    expectTypeOf<
      Placeholders<typeof REASON_COPY.within>
    >().toEqualTypeOf<"X">();
    expectTypeOf<Placeholders<typeof UI_COPY.printingOption>>().toEqualTypeOf<
      "set_name" | "SET" | "collector_number"
    >();
    expectTypeOf<Placeholders<typeof UI_COPY.historyLine>>().toEqualTypeOf<
      "N" | "relativeTime"
    >();
    expectTypeOf<
      Placeholders<typeof REASON_COPY.atMarket>
    >().toEqualTypeOf<never>();
  });

  test("a missing key does not compile", () => {
    expectTypeOf(() => {
      // @ts-expect-error X is required by "Within {X}% of market"
      fillTemplate(REASON_COPY.within, {});
    }).toBeFunction();
  });

  test("an extra key does not compile", () => {
    expectTypeOf(() => {
      // @ts-expect-error Y is not a placeholder of "Within {X}% of market"
      fillTemplate(REASON_COPY.within, { X: 5, Y: 1 });
    }).toBeFunction();
  });

  test("a misspelt key does not compile", () => {
    expectTypeOf(() => {
      // @ts-expect-error the placeholder is finish, not Finish
      fillTemplate(FALLBACK_NOTICE, { Finish: "Foil" });
    }).toBeFunction();
  });

  test("the exact keys compile", () => {
    expectTypeOf(() => {
      fillTemplate(REASON_COPY.within, { X: 5 });
      fillTemplate(FALLBACK_NOTICE, { finish: "Foil" });
    }).toBeFunction();
    expectTypeOf(fillTemplate(REASON_COPY.within, { X: 5 })).toBeString();
  });

  test("the printing option needs set_name, SET and collector_number", () => {
    expectTypeOf(() => {
      // @ts-expect-error collector_number is missing
      fillTemplate(UI_COPY.printingOption, {
        set_name: "Modern Horizons 2",
        SET: "MH2",
      });
      fillTemplate(UI_COPY.printingOption, {
        set_name: "Modern Horizons 2",
        SET: "MH2",
        collector_number: "12",
      });
    }).toBeFunction();
  });

  test("a string-typed template accepts any record", () => {
    const template: string = "{X} and {Y}";
    expectTypeOf(() => {
      fillTemplate(template, { X: 1 });
      fillTemplate(template, {});
      fillTemplate(template, { anything: "at all" });
    }).toBeFunction();
  });
});
