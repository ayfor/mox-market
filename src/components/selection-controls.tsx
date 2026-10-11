"use client";

// The result page's printing and finish selectors (S2.3d6, S2.3d7; AC-5,
// AC-6, AC-12). One change handler, commitSelection, turns a commit into a
// query-only navigation inside the shared transition: nextSelection decides
// the new selection (a finish switch keeps the shown printing), and
// selectionHref keeps the URL's price and the path segment as they are. A
// switch writes no submit marker: S2.4's marker means a form submit. S5.1
// adds the switch's logRecommendation call to commitSelection (C2-B.4).
// When the selectors mount after a switch, focus returns to the control
// that changed.
import type { ShownFinish } from "@/lib/recommendation/ui-copy";
import {
  nextSelection,
  selectionHref,
  type SelectionChange,
} from "@/lib/selection-href";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { FinishSelect } from "./finish-select";
import { PrintingSelect } from "./printing-select";
import { useResultNavigation, type FocusTarget } from "./result-navigation";
import "./selection-controls.css";

/** One PrintingSelect option, as the server builds it. */
export interface SelectionOption {
  readonly id: string;
  readonly label: string;
  /** The printing's offered finishes, normal before foil. */
  readonly finishes: readonly ShownFinish[];
}

export interface SelectionControlsProps {
  readonly options: readonly SelectionOption[];
  /** The evaluated printing. */
  readonly printingId: string;
  readonly printingLabel: string;
  /** The requested finish (the URL's), which FinishSelect shows. */
  readonly finish: ShownFinish;
  /** The evaluated printing's offered finishes. */
  readonly offeredFinishes: readonly ShownFinish[];
}

export function SelectionControls({
  options,
  printingId,
  printingLabel,
  finish,
  offeredFinishes,
}: SelectionControlsProps) {
  const navigation = useResultNavigation();
  const searchParams = useSearchParams();
  const printingButton = useRef<HTMLButtonElement>(null);
  const finishButton = useRef<HTMLButtonElement>(null);
  const { takeFocus } = navigation;

  // A switch unmounted the control just used; this mount takes the request.
  useEffect(() => {
    const target = takeFocus();
    if (target === "printing") printingButton.current?.focus();
    else if (target === "finish") finishButton.current?.focus();
  }, [takeFocus]);

  /** The single change handler (C2-B.4). */
  const commitSelection = (change: SelectionChange, control: FocusTarget) => {
    const next = nextSelection(
      { printingId, finish, offeredFinishes },
      change,
      options,
    );
    if (next === null) return;
    navigation.navigate(selectionHref(searchParams, next), { focus: control });
  };

  return (
    <div className="mm-selector-row">
      <PrintingSelect
        buttonRef={printingButton}
        options={options}
        value={printingId}
        valueLabel={printingLabel}
        onCommit={(id) => commitSelection({ printing: id }, "printing")}
      />
      <FinishSelect
        buttonRef={finishButton}
        options={offeredFinishes}
        value={finish}
        onCommit={(next) => commitSelection({ finish: next }, "finish")}
      />
    </div>
  );
}
