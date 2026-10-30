// The printing line (S2.1d13): "Modern Horizons 2 (MH2) · #12", one string
// everywhere. The result page's header and PrintingSelect options, and the
// printings route's Set picker labels, all build it here on the server, so
// no client module reaches the template code (C1.54).
import { fillTemplate } from "@/lib/recommendation/copy";
import { UI_COPY } from "@/lib/recommendation/ui-copy";
import type { ScryfallCard } from "@/types/scryfall";

/** "Modern Horizons 2 (MH2) · #12": set name, upper-case set code, number. */
export function printingLine(
  printing: Pick<ScryfallCard, "set" | "set_name" | "collector_number">,
): string {
  return fillTemplate(UI_COPY.printingOption, {
    set_name: printing.set_name,
    SET: printing.set.toUpperCase(),
    collector_number: printing.collector_number,
  });
}
