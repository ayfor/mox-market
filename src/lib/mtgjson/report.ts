// The ingest report (S0.2d19; AC-6): one plain-text block with stable
// labels, printed for every mode. It carries counts, dates, sizes and the
// source meta only: never a URL, a credential or an environment value.
import type { BasisResult } from "./basis";
import {
  PROJECTED_BYTES_PER_IDENTIFIER_ROW,
  PROJECTED_BYTES_PER_PRICE_ROW,
} from "./consts";
import type { IngestReport } from "./ingest";
import { rowsEmitted, windowDates } from "./transform";

const n = (value: number) => value.toLocaleString("en-US");
const mb = (bytes: number) => `${(bytes / 1e6).toFixed(1)} MB`;
const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const percent = (bp: number) =>
  `${bp >= 0 ? "+" : ""}${(bp / 100).toFixed(2)}%`;

/** Projected storage for the rows a run emitted (S0.2d2's per-row constants). */
export function projectedBytes(
  priceRows: number,
  identifierRows: number,
): {
  prices: number;
  identifiers: number;
  total: number;
} {
  const prices = priceRows * PROJECTED_BYTES_PER_PRICE_ROW;
  const identifiers = identifierRows * PROJECTED_BYTES_PER_IDENTIFIER_ROW;
  return { prices, identifiers, total: prices + identifiers };
}

/** The window's dates with no emitted row, ascending. */
export function missingDates(report: IngestReport): string[] {
  if (report.prices === null) return [];
  const byDate = report.prices.rowsByDate;
  return windowDates(report.runDate).filter((d) => !byDate.get(d));
}

/** The newest window date with rows and its count: the AC-12 rows/day figure. */
export function rowsPerDay(
  report: IngestReport,
): { date: string; rows: number } | null {
  if (report.prices === null) return null;
  const dates = windowDates(report.runDate).reverse();
  for (const date of dates) {
    const rows = report.prices.rowsByDate.get(date) ?? 0;
    if (rows > 0) return { date, rows };
  }
  return null;
}

function basisLines(basis: BasisResult): string[] {
  const lines = [
    `basis sample (F0 Open Question 3): requested ${basis.requested}, seed ${basis.seed}, eligible series ${n(basis.eligibleSeries)}`,
    `  pairs: ${basis.pairs.length} (skipped: not found ${basis.skippedNotFound}, no Scryfall price ${basis.skippedNoPrice}, request errors ${basis.skippedErrors})`,
  ];
  for (const pair of basis.pairs) {
    lines.push(
      `  ${pair.scryfallId} ${pair.finish.padEnd(6)} MTGJson ${dollars(pair.mtgjsonCents)} (${pair.mtgjsonDate}) vs Scryfall ${dollars(pair.scryfallCents)} (${pair.scryfallDate}) gap ${percent(pair.gapBp)}`,
    );
  }
  lines.push(
    `  median absolute gap: ${basis.medianAbsGapBp === null ? "n/a" : percent(basis.medianAbsGapBp).replace("+", "")}`,
    `  median signed gap: ${basis.medianSignedGapBp === null ? "n/a" : percent(basis.medianSignedGapBp)}`,
    `  verdict: ${
      basis.medianAbsGapBp === null
        ? "no pairs"
        : basis.flagged
          ? "OVER 2%: open ruling for Josh (should in-gate printings use MTGJson's newest price as currentPriceCents?)"
          : "within 2%"
    }`,
  );
  return lines;
}

/** The report as text (T9 pins every label). */
export function formatReport(report: IngestReport): string {
  const lines: string[] = [];
  const window = windowDates(report.runDate);
  lines.push(
    "MTGJson ingest report",
    `mode: ${report.mode}${report.identifiersOnly ? " (identifiers only)" : ""}`,
    `run date (UTC): ${report.runDate} (window ${window[0]} to ${window[window.length - 1]})`,
    `source: ${report.source}`,
    "source meta:",
    ...report.files.map(
      (f) =>
        `  ${f.file}: date ${f.date ?? "none"}, version ${f.version ?? "none"}`,
    ),
  );
  const ids = report.identifiers;
  lines.push(
    `identifiers: read ${n(ids.identifiersRead)}, stored ${n(ids.stored)}, printings ${n(ids.printings)}, invalidIdentifiers ${n(ids.invalidIdentifiers)}, duplicate identifier uuids ${n(ids.duplicateIdentifierUuids)}`,
  );
  const p = report.prices;
  if (p !== null) {
    const total = rowsEmitted(p);
    lines.push(
      "prices:",
      `  price entries: ${n(p.priceEntries)}`,
      `  rows by finish: normal ${n(p.rowsByFinish.normal)}, foil ${n(p.rowsByFinish.foil)}, etched ${n(p.rowsByFinish.etched)} (total ${n(total)})`,
      `  distinct series: ${n(p.distinctSeries)}`,
      `  distinct printings: ${n(p.distinctPrintings)}`,
      `  gate: rank only ${n(p.gate.rankOnly)}, price only ${n(p.gate.priceOnly)}, both ${n(p.gate.both)}, dropped ${n(p.gate.dropped)}, no valid price ${n(p.gate.noValidPrice)}`,
      `  unmappedUuids: ${n(p.unmappedUuids)}`,
      `  scryfallCollisions: ${n(p.scryfallCollisions)}`,
      `  collisionLosses: ${n(p.collisionLosses)}`,
      `  duplicateUuids: ${n(p.duplicateUuids)}`,
      `  duplicateKeys: ${n(report.duplicateKeys)}`,
      `  invalidPrices: ${n(p.invalidPrices)}`,
      `  invalidDates: ${n(p.invalidDates)}`,
      `  nonUsdCurrency: ${n(p.nonUsdCurrency)}`,
      `  out of window: before ${n(p.beforeWindow)}, after runDate ${n(p.afterRunDate)}`,
      `  non-object entries: ${n(report.parse.nonObjectEntries)}`,
      "rows per date:",
    );
    for (const date of window) {
      const rows = p.rowsByDate.get(date) ?? 0;
      lines.push(`  ${date}  ${rows > 0 ? n(rows) : "MISSING"}`);
    }
    const missing = missingDates(report);
    lines.push(
      `  missing dates: ${missing.length === 0 ? "none" : missing.join(", ")}`,
    );
    const perDay = rowsPerDay(report);
    lines.push(
      `  rows/day (newest date ${perDay?.date ?? "none"}): ${perDay === null ? 0 : n(perDay.rows)}`,
    );
    const projected = projectedBytes(total, ids.stored);
    lines.push(
      `projected bytes: price rows ${n(total)} x ${PROJECTED_BYTES_PER_PRICE_ROW} B = ${mb(projected.prices)}; identifiers ${n(ids.stored)} x ${PROJECTED_BYTES_PER_IDENTIFIER_ROW} B = ${mb(projected.identifiers)}; total ${mb(projected.total)}`,
    );
  } else {
    const projected = projectedBytes(0, ids.stored);
    lines.push(
      `projected bytes: identifiers ${n(ids.stored)} x ${PROJECTED_BYTES_PER_IDENTIFIER_ROW} B = ${mb(projected.identifiers)}`,
    );
  }
  const w = report.write;
  if (w !== null) {
    lines.push(
      `write: status ${w.status}, run id ${w.runId}, chunks ${n(w.chunks)}`,
      `  rows written: ${n(w.rowsWritten)} (price rows ${n(w.priceRowsWritten)}, identifier rows ${n(w.identifierRowsWritten)})`,
      `  rows pruned: ${n(w.rowsPruned)}`,
      `  db bytes: before ${mb(w.dbBytesBefore)}, after ${w.dbBytes === null ? "unknown" : mb(w.dbBytes)}`,
    );
  }
  if (report.basis !== null) lines.push(...basisLines(report.basis));
  lines.push(
    `warnings: ${report.warnings.length === 0 ? "none" : ""}`,
    ...report.warnings.map((line) => `  ${line}`),
    `peak RSS: ${mb(report.peakRssBytes)}`,
    `duration: ${(report.durationMs / 1000).toFixed(1)} s`,
  );
  return lines.join("\n");
}
