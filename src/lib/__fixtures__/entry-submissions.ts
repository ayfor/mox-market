// S2.4's entry fixtures (AC-1, AC-3, AC-4): one table of submissions with the
// exact link each must produce, and one table of rejected inputs. The
// result-href, entry-submit, landing-form and /evaluate tests all import it,
// so identical input is proven to yield identical URLs from both forms. Test
// support only: no app code imports it.

export interface EntrySubmission {
  readonly card: string;
  readonly price: string;
  readonly href: string;
  /** The card the result route must decode back to (card.trim()). */
  readonly decoded: string;
  /** The asking price in cents. */
  readonly cents: number;
}

/** AC-1's five fixtures, then AC-4's "Lim-Dûl's Vault". */
export const ENTRY_SUBMISSIONS: readonly EntrySubmission[] = Object.freeze([
  {
    card: "Esper Sentinel",
    price: "$74.99",
    href: "/Esper%20Sentinel?price=74.99",
    decoded: "Esper Sentinel",
    cents: 7499,
  },
  {
    card: " Jace, the Mind Sculptor ",
    price: " 1,234.50 ",
    href: "/Jace%2C%20the%20Mind%20Sculptor?price=1234.50",
    decoded: "Jace, the Mind Sculptor",
    cents: 123450,
  },
  {
    card: "Fire // Ice",
    price: "2",
    href: "/Fire%20%2F%2F%20Ice?price=2",
    decoded: "Fire // Ice",
    cents: 200,
  },
  {
    card: "+2 Mace",
    price: "0.25",
    href: "/%2B2%20Mace?price=0.25",
    decoded: "+2 Mace",
    cents: 25,
  },
  {
    card: "Question Elemental?",
    price: "3",
    href: "/Question%20Elemental%3F?price=3",
    decoded: "Question Elemental?",
    cents: 300,
  },
  {
    card: "Lim-Dûl's Vault",
    price: "1",
    href: "/Lim-D%C3%BBl's%20Vault?price=1",
    decoded: "Lim-Dûl's Vault",
    cents: 100,
  },
]);

export type RejectedStatus = "empty" | "bad_card" | "bad_price";

export interface RejectedEntry {
  readonly name: string;
  readonly card: string;
  readonly price: string;
  readonly status: RejectedStatus;
}

/** Inputs that must never navigate, with what the form shows instead. */
export const REJECTED_ENTRIES: readonly RejectedEntry[] = Object.freeze([
  { name: "both empty", card: "", price: "", status: "empty" },
  { name: "an empty card", card: "", price: "74.99", status: "empty" },
  {
    name: "an empty price",
    card: "Esper Sentinel",
    price: "",
    status: "empty",
  },
  { name: "a whitespace card", card: "   ", price: "74.99", status: "empty" },
  {
    name: "a whitespace price",
    card: "Esper Sentinel",
    price: " \t",
    status: "empty",
  },
  { name: "card '.'", card: ".", price: "5", status: "bad_card" },
  { name: "card '..'", card: "..", price: "5", status: "bad_card" },
  { name: "card ' .. '", card: " .. ", price: "5", status: "bad_card" },
  {
    name: "a tab in the card",
    card: "Esper\tSentinel",
    price: "5",
    status: "bad_card",
  },
  {
    name: "U+0085 in the card",
    card: "Esper\u0085Sentinel",
    price: "5",
    status: "bad_card",
  },
  {
    name: "price 74.999",
    card: "Esper Sentinel",
    price: "74.999",
    status: "bad_price",
  },
  {
    name: "price 1e3",
    card: "Esper Sentinel",
    price: "1e3",
    status: "bad_price",
  },
  { name: "price 0", card: "Esper Sentinel", price: "0", status: "bad_price" },
  {
    name: "price 0.00",
    card: "Esper Sentinel",
    price: "0.00",
    status: "bad_price",
  },
  {
    name: "price -1",
    card: "Esper Sentinel",
    price: "-1",
    status: "bad_price",
  },
  {
    name: "price 100000.01",
    card: "Esper Sentinel",
    price: "100000.01",
    status: "bad_price",
  },
  {
    name: "price 74,99",
    card: "Esper Sentinel",
    price: "74,99",
    status: "bad_price",
  },
  {
    name: "fullwidth digits",
    card: "Esper Sentinel",
    price: "１２",
    status: "bad_price",
  },
]);

/** Names that stress the one-segment encoding (T1, T4). */
export const HOSTILE_NAMES: readonly string[] = Object.freeze([
  "100%",
  "A#B",
  "Who/What/When/Where/Why",
  "Ach! Hans, Run!",
  "Gisa's Bidding",
  "a&b=c",
  "\u{1F600}".repeat(141),
  "Lim-Dûl's Vault",
]);
