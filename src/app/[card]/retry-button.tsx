"use client";

// The error panel's retry (AC-4): refreshes the result route inside the shared
// transition, so the slot shows the skeleton until the new render arrives.
// When a selector switch lands on the error panel, the control just used is
// gone, so the switch's focus request moves focus here instead of leaving it
// on <body>, and the request is spent (S2.3 ADV-2).
import { useResultNavigation } from "@/components/result-navigation";
import { FORM_LABELS } from "@/lib/copy/result-labels";
import { useEffect, useRef } from "react";

export function RetryButton() {
  const { isPending, refresh, takeFocus } = useResultNavigation();
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (takeFocus() !== null) button.current?.focus();
  }, [takeFocus]);
  return (
    <button
      ref={button}
      type="button"
      className="mm-retry-btn"
      disabled={isPending}
      onClick={() => refresh()}
    >
      {FORM_LABELS.retry}
    </button>
  );
}
