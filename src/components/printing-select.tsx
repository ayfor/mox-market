"use client";

// PrintingSelect (S2.3d6; AC-1, AC-11; C2-B.12): a Headless UI Listbox, so
// arrow keys move the active option and only Enter or a click commits. Its
// visible label is the field label, and its button's accessible name starts
// with it. Presentational: the server builds every option label with
// printingLine (UI_COPY.printingOption), so this module imports no template
// code. When the shown printing is not among the options (the named-card
// fallback), the button still shows its label and no option is selected.
// Classes are whole strings; state styling uses Headless UI's data
// attributes (S2.4 ADV.1).
import { UI_COPY } from "@/lib/recommendation/ui-copy";
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

export interface PrintingSelectOption {
  readonly id: string;
  /** "Modern Horizons 2 (MH2) · #12", built on the server. */
  readonly label: string;
}

export interface PrintingSelectProps {
  readonly options: readonly PrintingSelectOption[];
  /** The shown printing's id; it may match no option. */
  readonly value: string;
  /** The shown printing's label, on the button whether or not an option matches. */
  readonly valueLabel: string;
  /** Called once per commit (Enter or a click), never on arrow keys. */
  readonly onCommit: (printingId: string) => void;
  readonly buttonRef?: Ref<HTMLButtonElement>;
}

export function PrintingSelect({
  options,
  value,
  valueLabel,
  onCommit,
  buttonRef,
}: PrintingSelectProps) {
  return (
    <Field className="mm-selector mm-selector--printing">
      <Label className="mm-selector-label">{UI_COPY.printingLabel}</Label>
      <Listbox
        value={value}
        onChange={onCommit}
        disabled={options.length === 0}
      >
        <ListboxButton ref={buttonRef} className="mm-selector-button">
          <span className="mm-selector-value">{valueLabel}</span>
          <SelectChevron />
        </ListboxButton>
        <ListboxOptions modal={false} className="mm-selector-options">
          {options.map((option) => (
            <ListboxOption
              key={option.id}
              value={option.id}
              className="mm-selector-option"
            >
              {option.label}
            </ListboxOption>
          ))}
        </ListboxOptions>
      </Listbox>
    </Field>
  );
}
