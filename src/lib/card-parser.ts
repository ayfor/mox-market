/**
 * Card list parser.
 * Extracts card names from pasted text in various formats:
 * - Plain names (one per line)
 * - MTGO format: "4 Lightning Bolt"
 * - Arena format: "4 Lightning Bolt (M21) 199"
 * - Sideboard markers: "Sideboard", "SB:", etc. (stripped)
 */

export interface ParsedLine {
  raw: string;
  quantity: number;
  cardName: string;
  setCode: string | null;
  collectorNumber: string | null;
}

export interface ParseResult {
  parsed: ParsedLine[];
  skipped: string[];
}

// Lines to ignore entirely
const SKIP_PATTERNS = [
  /^\s*$/,                          // empty lines
  /^(sideboard|sb:|maybeboard|companion|commander|deck)\s*$/i,
  /^\/\//,                          // comments
  /^#/,                             // comments
  /^-{2,}/,                         // dividers
];

// Quantity prefix: "4x", "4 ", "4× "
const QUANTITY_RE = /^(\d+)\s*[x×]?\s+/i;

// Arena set code + collector number: "(M21) 199" or "[MH2] 45"
const ARENA_SUFFIX_RE = /\s+[\[(]([A-Z0-9]{2,6})[\])]\s+(\d+[a-z]?)\s*$/i;

// Standalone set code in brackets: "[MH2]" or "(DMU)"
const SET_CODE_RE = /\s+[\[(]([A-Z0-9]{2,6})[\])]\s*$/i;

/**
 * Parse a block of text into card name entries.
 */
export function parseCardList(text: string): ParseResult {
  const lines = text.split(/\r?\n/);
  const parsed: ParsedLine[] = [];
  const skipped: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Skip empty/marker lines
    if (SKIP_PATTERNS.some((p) => p.test(line))) {
      continue;
    }

    let remaining = line;
    let quantity = 1;
    let setCode: string | null = null;
    let collectorNumber: string | null = null;

    // Extract quantity prefix
    const qtyMatch = remaining.match(QUANTITY_RE);
    if (qtyMatch) {
      quantity = parseInt(qtyMatch[1], 10);
      remaining = remaining.slice(qtyMatch[0].length);
    }

    // Extract Arena-style suffix: (SET) 123
    const arenaMatch = remaining.match(ARENA_SUFFIX_RE);
    if (arenaMatch) {
      setCode = arenaMatch[1].toUpperCase();
      collectorNumber = arenaMatch[2];
      remaining = remaining.slice(0, -arenaMatch[0].length).trim();
    } else {
      // Try standalone set code
      const setMatch = remaining.match(SET_CODE_RE);
      if (setMatch) {
        setCode = setMatch[1].toUpperCase();
        remaining = remaining.slice(0, -setMatch[0].length).trim();
      }
    }

    const cardName = remaining.trim();

    // Validate: card names should be at least 2 chars and contain letters
    if (cardName.length < 2 || !/[a-zA-Z]/.test(cardName)) {
      skipped.push(rawLine);
      continue;
    }

    parsed.push({
      raw: rawLine,
      quantity,
      cardName,
      setCode,
      collectorNumber,
    });
  }

  return { parsed, skipped };
}
