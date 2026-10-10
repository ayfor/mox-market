"use client";

// The result page's form and result slot as one field (S2.4d9). A Headless
// UI Field (display: contents) wraps both, so a lookup-miss message, a
// Description in the slot, names itself in the card combobox's
// aria-describedby; ComboboxInput overwrites an aria-describedby passed to it
// directly (S2.1 D-16). The context carries two facts across the form and the
// slot: whether the card field still holds the URL's card (a miss message
// about the URL's card hides once it does not, S2.4 ADV-4), and which miss
// the slot shows (the form offers suggestions on focus after an ambiguous
// one, S2.4 ADV-7). Outside a ResultField (on /evaluate) both are inert.
import { Field } from "@headlessui/react";
import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/** The two answers a named lookup can give without a card. */
export type LookupMissStatus = "ambiguous" | "not_found";

export interface ResultFieldState {
  /** True under ResultField, where a Description has a Field to register with. */
  readonly inField: boolean;
  /**
   * The card field no longer holds the URL's card, or shows its own card
   * error: a miss message about the URL's card is stale (ADV-4).
   */
  readonly cardStale: boolean;
  readonly setCardStale: (stale: boolean) => void;
  /** The miss the slot shows for the URL's card, or null (ADV-7). */
  readonly miss: LookupMissStatus | null;
  readonly setMiss: (miss: LookupMissStatus | null) => void;
}

const noop = () => {};

const OUTSIDE: ResultFieldState = Object.freeze({
  inField: false,
  cardStale: false,
  setCardStale: noop,
  miss: null,
  setMiss: noop,
});

const ResultFieldContext = createContext<ResultFieldState>(OUTSIDE);

/** The result page's form and result slot as one field (S2.4d9). */
export function ResultField({ children }: { children: ReactNode }) {
  const [cardStale, setCardStale] = useState(false);
  const [miss, setMiss] = useState<LookupMissStatus | null>(null);
  const state = useMemo<ResultFieldState>(
    () => ({ inField: true, cardStale, setCardStale, miss, setMiss }),
    [cardStale, miss],
  );
  return (
    <Field className="mm-result-field">
      <ResultFieldContext.Provider value={state}>
        {children}
      </ResultFieldContext.Provider>
    </Field>
  );
}

/** The enclosing ResultField's state; inert outside one. */
export function useResultField(): ResultFieldState {
  return useContext(ResultFieldContext);
}
