// F4's chip row near the card identity (S4.1d11): a server component, so no
// client JavaScript. Each chip is focusable; its tooltip is the title
// attribute, a CSS bubble on hover and keyboard focus, and the chip's
// accessible description (a hidden span, so it is read once, as the
// description). Only non-default fields
// get a chip (S4.1d8); with none, nothing renders, so there is no empty row.
import { categoryChips } from "@/lib/evaluation/category-chips";
import type { CardCategory } from "@/lib/recommendation/types";
import "./category-chips.css";

export function CategoryChips({
  category,
}: {
  category: CardCategory | null | undefined;
}) {
  const chips = categoryChips(category);
  if (chips.length === 0) return null;
  return (
    <ul className="mm-category-chips">
      {chips.map((chip) => {
        const tipId = `mm-category-tip-${chip.key}`;
        return (
          <li key={chip.key} className="mm-category-item">
            <span
              className="mm-category-chip"
              data-chip={chip.key}
              tabIndex={0}
              title={chip.tooltip}
              data-tooltip={chip.tooltip}
              aria-describedby={tipId}
            >
              {chip.label}
            </span>
            <span id={tipId} className="mm-category-tip" hidden>
              {chip.tooltip}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
