"use client";

// The lookup-miss state (S2.4d9; AC-6, AC-7, AC-10; C1.29): one message from
// F1's UI-strings table where the panel would go, and nothing else: no
// panel, tiles, disclaimer, Retry or skeleton. The form above it is the
// result page's own entry form, already prefilled. Under the page's
// ResultField the message is a Description, so it names itself in the card
// combobox's aria-describedby. A new submit swaps the slot for the skeleton,
// which unmounts the message and drops the tie; editing the card away from
// the URL's card, or the form showing its own card error, hides it too, so
// a stale message never describes a different name (S2.4 ADV-4).
import {
  useResultField,
  type LookupMissStatus,
} from "@/components/result-field";
import { UI_COPY } from "@/lib/recommendation/ui-copy";
import { Description } from "@headlessui/react";
import { useEffect } from "react";

export type { LookupMissStatus } from "@/components/result-field";

const MESSAGES: Readonly<Record<LookupMissStatus, string>> = Object.freeze({
  ambiguous: UI_COPY.ambiguousCard,
  not_found: UI_COPY.cardNotFound,
});

export function LookupMiss({ status }: { status: LookupMissStatus }) {
  const { inField, cardStale, setMiss } = useResultField();
  // The form offers suggestions on focus after an ambiguous miss (ADV-7).
  useEffect(() => {
    setMiss(status);
    return () => setMiss(null);
  }, [status, setMiss]);

  if (cardStale) return null;
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
