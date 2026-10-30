// F4's category chips (S4.1d9, S4.1d10): one label and one factual tooltip
// sentence per chip. F4's UI section words six labels and the competitive
// tooltip; the rest is new, factual and minimal, and open for Josh's ruling
// (S4.1d9). Tooltips end without a period, as F4's quoted tooltip does. The
// numbers are literal; category.test.ts ties each to its RECOMMENDATION_PARAMS
// field, so a param change fails until the copy is re-ruled. String literals
// only, so client components may import it. Its own module, not
// result-labels.ts, which a parallel UI lane edits (S4.1d15).

/** Each chip's label and tooltip, keyed by chip, in F4's Fields-table order. */
export const CATEGORY_CHIPS = Object.freeze({
  reservedList: Object.freeze({
    label: "Reserved List",
    tooltip: "On the Reserved List as of the last Scryfall fetch",
  }),
  recent: Object.freeze({
    label: "Recent print (<6mo)",
    tooltip:
      "This printing was released in the last 183 days or is not yet released",
  }),
  modernEra: Object.freeze({
    label: "Modern-era print",
    tooltip:
      "This printing was released on or after 2003-07-28, the 8th Edition release date",
  }),
  vintageEra: Object.freeze({
    label: "Vintage-era print",
    tooltip:
      "This printing was released before 2003-07-28, the 8th Edition release date",
  }),
  top1000: Object.freeze({
    label: "EDH top-1000",
    tooltip: "EDHREC rank 1 to 1000 as of the last Scryfall fetch",
  }),
  top5000: Object.freeze({
    label: "EDH top-5000",
    tooltip: "EDHREC rank 1001 to 5000 as of the last Scryfall fetch",
  }),
  longtail: Object.freeze({
    label: "EDH rank over 5000",
    tooltip: "EDHREC rank above 5000 as of the last Scryfall fetch",
  }),
  competitive: Object.freeze({
    label: "Competitive-format legal",
    tooltip:
      "Legal in Standard, Pioneer or Modern as of the last Scryfall fetch",
  }),
  edh: Object.freeze({
    label: "Commander-legal",
    tooltip:
      "Legal in Commander but not in Standard, Pioneer or Modern as of the last Scryfall fetch",
  }),
  digital: Object.freeze({
    label: "Digital",
    tooltip: "This printing exists only in digital form",
  }),
} as const);

export type CategoryChipKey = keyof typeof CATEGORY_CHIPS;
