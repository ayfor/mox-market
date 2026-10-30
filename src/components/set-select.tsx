"use client";

// The entry forms' optional Set picker (UI patch 2026-10-30): a Headless UI
// Listbox like the result page's PrintingSelect, with its classes and
// chevron, so arrow keys move the active option and only Enter or a click
// commits, and its visible label names it (the label's for= reaches the
// button). Its first option, "Any set" (value ""), is the default and leaves
// the printing to the result page. Until the card field holds a name the
// printings route resolved it is aria-disabled, not disabled (review UI-3):
// Tab still reaches it and its state ("Loading sets", "Sets unavailable")
// is announced through its name (no aria-busy: the result page reserves
// that for its skeleton), while Headless UI ignores clicks and keys on it. Enter on
// the closed button opens the list rather than submitting the form (UI-7).
//
// useCardPrintings fetches GET /api/cards/printings when the user picks a
// suggestion, leaves the card field or focuses the picker, after a short
// debounce; a newer request aborts the older one, only the newest may
// answer, and unmounting aborts it. A name the card guard rejects (a lone
// surrogate, a control character) is never sent and never sits on "Loading
// sets" (PS-2). Results are keyed by the trimmed name they answer, so the
// picker only ever shows the printings of the name now in the field, and
// the forms key the chosen printing by trimmed card text the same way.
import { SET_PICKER_LABELS } from "@/lib/copy/result-labels";
import { PRINTINGS_LOOKUP_DEBOUNCE_MS } from "@/lib/evaluation/consts";
import { parseCardParam } from "@/lib/evaluation/result-params";
import {
  Field,
  Label,
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
} from "@headlessui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { SelectChevron } from "./select-chevron";
import "./selection-controls.css";
import "./set-select.css";

/** One printing as the route sends it. */
export interface PrintingChoice {
  readonly id: string;
  readonly setName: string;
  readonly setCode: string;
  readonly collectorNumber: string;
  readonly label: string;
}

/** The printings lookup for one trimmed name. */
export type PrintingsLookup =
  | { readonly name: string; readonly status: "loading" }
  | {
      readonly name: string;
      readonly status: "ready";
      readonly printings: readonly PrintingChoice[];
    }
  /** No such card (404), or a name the route rejects (400). */
  | { readonly name: string; readonly status: "missing" }
  /** The route or Scryfall failed. */
  | { readonly name: string; readonly status: "error" };

/** A chosen printing, tied to the trimmed card text it was chosen under. */
export interface SetChoice {
  readonly card: string;
  readonly printing: string;
}

/** No set chosen. */
export const ANY_SET: SetChoice = Object.freeze({ card: "", printing: "" });

/** The choice of `printing` under `card`, keyed by the trimmed text (UI-8). */
export function setChoiceFor(card: string, printing: string): SetChoice {
  return { card: card.trim(), printing };
}

/** The chosen printing id while the trimmed card text is unchanged, else "". */
export function chosenPrinting(choice: SetChoice, card: string): string {
  return choice.card === card.trim() ? choice.printing : "";
}

const isChoice = (value: unknown): value is PrintingChoice => {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.setName === "string" &&
    typeof v.setCode === "string" &&
    typeof v.collectorNumber === "string" &&
    typeof v.label === "string"
  );
};

/** The route's printings, or null for a body that is not a choice array. */
function choicesOf(body: unknown): PrintingChoice[] | null {
  const data = (body as { data?: unknown } | null)?.data;
  return Array.isArray(data) && data.every(isChoice) ? data : null;
}

export function useCardPrintings() {
  const [lookup, setLookup] = useState<PrintingsLookup | null>(null);
  const current = useRef<PrintingsLookup | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  /** Bumped on every request, so only the newest may answer. */
  const generation = useRef(0);

  const show = useCallback((next: PrintingsLookup) => {
    current.current = next;
    setLookup(next);
  }, []);

  const cancel = useCallback(() => {
    generation.current += 1;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    inFlight.current?.abort();
    inFlight.current = null;
  }, []);

  useEffect(() => () => cancel(), [cancel]);

  /** Look up `card`'s printings, unless that name is loading or loaded. */
  const request = useCallback(
    (card: string) => {
      const trimmed = card.trim();
      if (trimmed === "") return;
      const known = current.current;
      if (known?.name === trimmed && known.status !== "error") return;
      cancel();
      // A name the card guard rejects is never sent (PS-2).
      const name = parseCardParam(trimmed);
      if (name === null) {
        show({ name: trimmed, status: "missing" });
        return;
      }
      const mine = generation.current;
      show({ name, status: "loading" });
      timer.current = setTimeout(() => {
        timer.current = null;
        const controller = new AbortController();
        inFlight.current = controller;
        // Built inside the chain, so any throw ends in the error state.
        Promise.resolve()
          .then(() =>
            fetch(`/api/cards/printings?name=${encodeURIComponent(name)}`, {
              signal: controller.signal,
            }),
          )
          .then(async (res): Promise<PrintingsLookup> => {
            if (res.status === 404 || res.status === 400) {
              return { name, status: "missing" };
            }
            const printings = res.ok ? choicesOf(await res.json()) : null;
            return printings === null
              ? { name, status: "error" }
              : { name, status: "ready", printings };
          })
          .catch((): PrintingsLookup => ({ name, status: "error" }))
          .then((next) => {
            if (mine !== generation.current) return;
            inFlight.current = null;
            show(next);
          });
      }, PRINTINGS_LOOKUP_DEBOUNCE_MS);
    },
    [cancel, show],
  );

  return { lookup, request };
}

export interface SetSelectProps {
  /** The card field's text now. */
  readonly card: string;
  readonly lookup: PrintingsLookup | null;
  /** The chosen printing id, or "" for any set. */
  readonly value: string;
  readonly onChange: (printing: string) => void;
  /** The picker was focused: look the card's printings up (UI-3). */
  readonly onRequest?: () => void;
  /** The wrapper's whole class string. */
  readonly className: string;
  /** The visible label's whole class string. */
  readonly labelClassName: string;
  /** The open list's whole class string. */
  readonly optionsClassName?: string;
}

export function SetSelect({
  card,
  lookup,
  value,
  onChange,
  onRequest,
  className,
  labelClassName,
  optionsClassName = "mm-selector-options mm-set-options",
}: SetSelectProps) {
  // Only a lookup for the name in the field counts.
  const shown = lookup !== null && lookup.name === card.trim() ? lookup : null;
  const printings = shown?.status === "ready" ? shown.printings : [];
  const unavailable = printings.length === 0;
  const loading = shown?.status === "loading";
  const anyLabel = loading
    ? SET_PICKER_LABELS.loading
    : shown?.status === "error"
      ? SET_PICKER_LABELS.unavailable
      : SET_PICKER_LABELS.any;
  const selected = printings.find((p) => p.id === value);

  return (
    <Field className={className}>
      <Label className={labelClassName}>{SET_PICKER_LABELS.label}</Label>
      <Listbox value={selected?.id ?? ""} onChange={onChange}>
        {({ open }: { open: boolean }) => (
          <>
            <ListboxButton
              className="mm-selector-button mm-set-button"
              aria-disabled={unavailable || undefined}
              onFocus={() => onRequest?.()}
              onKeyDown={(event) => {
                // Headless UI submits the form on Enter; open the list
                // instead, as ArrowDown does (UI-7).
                if (event.key !== "Enter" || open) return;
                event.preventDefault();
                event.currentTarget.dispatchEvent(
                  new KeyboardEvent("keydown", {
                    key: "ArrowDown",
                    bubbles: true,
                    cancelable: true,
                  }),
                );
              }}
            >
              <span className="mm-selector-value">
                {selected?.label ?? anyLabel}
              </span>
              <SelectChevron />
            </ListboxButton>
            <ListboxOptions modal={false} className={optionsClassName}>
              <ListboxOption value="" className="mm-selector-option">
                {SET_PICKER_LABELS.any}
              </ListboxOption>
              {printings.map((printing) => (
                <ListboxOption
                  key={printing.id}
                  value={printing.id}
                  className="mm-selector-option"
                >
                  {printing.label}
                </ListboxOption>
              ))}
            </ListboxOptions>
          </>
        )}
      </Listbox>
    </Field>
  );
}
