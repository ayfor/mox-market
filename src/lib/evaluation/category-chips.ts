// F4's chip rule (S4.1d8): one chip per CardCategory field whose value
// differs from its Fields-table default, in Fields-table order (reservedList,
// age, popularity, formatProfile, digital). A fully-default category, or
// null (nothing classified), gives no chip. Pure and client-safe: it reads
// the copy module and types only.
import { CATEGORY_CHIPS, type CategoryChipKey } from "@/lib/copy/category";
import type {
  CardAge,
  CardCategory,
  FormatProfile,
  Popularity,
} from "@/lib/recommendation/types";

/** One rendered chip: its key, label and one-sentence tooltip. */
export interface CategoryChip {
  readonly key: CategoryChipKey;
  readonly label: string;
  readonly tooltip: string;
}

/** Each age's chip; the default (unknown) has none. */
const AGE_CHIPS: Readonly<Record<CardAge, CategoryChipKey | null>> = {
  recent: "recent",
  "modern-era": "modernEra",
  "vintage-era": "vintageEra",
  unknown: null,
};

/** Each popularity bucket's chip; the default (unranked) has none. */
const POPULARITY_CHIPS: Readonly<Record<Popularity, CategoryChipKey | null>> = {
  top1000: "top1000",
  top5000: "top5000",
  longtail: "longtail",
  unranked: null,
};

/** Each format profile's chip; the default (casual) has none. */
const FORMAT_CHIPS: Readonly<Record<FormatProfile, CategoryChipKey | null>> = {
  competitive: "competitive",
  edh: "edh",
  casual: null,
};

/** The chip a lookup table gives a value, or null for a default or unknown value. */
function chipFor<V extends string>(
  table: Readonly<Record<V, CategoryChipKey | null>>,
  value: V,
): CategoryChipKey | null {
  return Object.prototype.hasOwnProperty.call(table, value)
    ? table[value]
    : null;
}

/** The chips for a category, in Fields-table order; [] for null or all defaults. */
export function categoryChips(
  category: CardCategory | null | undefined,
): CategoryChip[] {
  if (category === null || category === undefined) return [];
  const keys: (CategoryChipKey | null)[] = [
    category.reservedList === true ? "reservedList" : null,
    chipFor(AGE_CHIPS, category.age),
    chipFor(POPULARITY_CHIPS, category.popularity),
    chipFor(FORMAT_CHIPS, category.formatProfile),
    category.digital === true ? "digital" : null,
  ];
  return keys
    .filter((key): key is CategoryChipKey => key !== null)
    .map((key) => ({ key, ...CATEGORY_CHIPS[key] }));
}
