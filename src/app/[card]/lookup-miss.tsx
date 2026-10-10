"use client";

// The lookup-miss state (S2.4d9; AC-6, AC-7, AC-10; C1.29): one message from
// F1's UI-strings table where the panel would go, and nothing else: no
// panel, tiles, disclaimer, Retry or skeleton. The form above it is the
// result page's own entry form, already prefilled. ResultField wraps that
// form and the result slot in one Headless UI Field (display: contents), so
// the message, a Description, names itself in the card combobox's
// aria-describedby; ComboboxInput overwrites an aria-describedby passed to it
// directly (S2.1 D-16). A new submit swaps the slot for the skeleton, which
// unmounts the message and drops the tie.
import { UI_COPY } from "@/lib/recommendation/ui-copy";
import { Description, Field } from "@headlessui/react";
import { createContext, useContext, type ReactNode } from "react";

/** True under ResultField, where a Description has a Field to register with. */
const InResultField = createContext(false);

/** The result page's form and result slot as one field (S2.4d9). */
export function ResultField({ children }: { children: ReactNode }) {
  return (
    <Field className="mm-result-field">
      <InResultField.Provider value={true}>{children}</InResultField.Provider>
    </Field>
  );
}

/** The two answers a named lookup can give without a card. */
export type LookupMissStatus = "ambiguous" | "not_found";

const MESSAGES: Readonly<Record<LookupMissStatus, string>> = Object.freeze({
  ambiguous: UI_COPY.ambiguousCard,
  not_found: UI_COPY.cardNotFound,
});

export function LookupMiss({ status }: { status: LookupMissStatus }) {
  const inField = useContext(InResultField);
  const message = MESSAGES[status];
  return (
    <div
      className="mm-result mm-result-message mm-lookup-miss"
      data-status={status}
      role="status"
    >
      {inField ? (
        <Description as="p" className="mm-result-message-text">
          {message}
        </Description>
      ) : (
        // Outside the page's field (a unit render) there is no card field to
        // describe, and a Description would throw.
        <p className="mm-result-message-text">{message}</p>
      )}
    </div>
  );
}
