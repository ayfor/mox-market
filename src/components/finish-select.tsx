"use client";

// FinishSelect (S2.3d6; AC-4, AC-9, AC-11; C2-B.12): a Headless UI Listbox
// over the shown printing's offered finishes, normal before foil; etched is
// never offered (C1.08 = A). Its value is the requested finish even when the
// printing does not offer it (AC-9: "Normal" shown, "Foil" offered), and
// with no offered finish it is disabled. Names come from FINISH_LABELS.
// Presentational, like PrintingSelect.
import {
  FINISH_LABELS,
  UI_COPY,
  type ShownFinish,
} from "@/lib/recommendation/ui-copy";
import {
  Field,
  Label,
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
} from "@headlessui/react";
import type { Ref } from "react";
import { SelectChevron } from "./select-chevron";

export interface FinishSelectProps {
  /** The shown printing's offered finishes. */
  readonly options: readonly ShownFinish[];
  /** The requested finish. */
  readonly value: ShownFinish;
  /** Called once per commit (Enter or a click), never on arrow keys. */
  readonly onCommit: (finish: ShownFinish) => void;
  readonly buttonRef?: Ref<HTMLButtonElement>;
}

/** Only the finishes FINISH_LABELS names, so etched never renders. */
const isShownFinish = (finish: string): finish is ShownFinish =>
  Object.hasOwn(FINISH_LABELS, finish);

export function FinishSelect({
  options,
  value,
  onCommit,
  buttonRef,
}: FinishSelectProps) {
  const offered = options.filter(isShownFinish);
  return (
    <Field className="mm-selector mm-selector--finish">
      <Label className="mm-selector-label">{UI_COPY.finishLabel}</Label>
      <Listbox
        value={value}
        onChange={onCommit}
        disabled={offered.length === 0}
      >
        <ListboxButton ref={buttonRef} className="mm-selector-button">
          <span className="mm-selector-value">{FINISH_LABELS[value]}</span>
          <SelectChevron />
        </ListboxButton>
        <ListboxOptions modal={false} className="mm-selector-options">
          {offered.map((finish) => (
            <ListboxOption
              key={finish}
              value={finish}
              className="mm-selector-option"
            >
              {FINISH_LABELS[finish]}
            </ListboxOption>
          ))}
        </ListboxOptions>
      </Listbox>
    </Field>
  );
}
