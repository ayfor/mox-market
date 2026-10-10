"use client";

// Card search (S2.1d15, C1.30): a Headless UI combobox over free text. The
// typed text is the form's card value; picking a suggestion replaces it.
// Suggestions come from GET /api/cards/autocomplete, 150 ms after the last
// keystroke at 2 or more trimmed characters; a newer keystroke aborts the
// older request, and any failure just shows no suggestions.
import {
  AUTOCOMPLETE_DEBOUNCE_MS,
  AUTOCOMPLETE_MIN_CHARS,
  CARD_PARAM_MAX_CHARS,
} from "@/lib/evaluation/consts";
import {
  Combobox,
  ComboboxInput,
  ComboboxOption,
  ComboboxOptions,
} from "@headlessui/react";
import { useCallback, useEffect, useRef, useState } from "react";

export interface CardComboboxProps {
  readonly id: string;
  readonly value: string;
  readonly onChange: (card: string) => void;
  readonly autoFocus?: boolean;
}

/** The route's names, or [] for anything that is not a string array. */
function suggestionsOf(body: unknown): string[] {
  const data = (body as { data?: unknown } | null)?.data;
  return Array.isArray(data) && data.every((name) => typeof name === "string")
    ? data
    : [];
}

export function CardCombobox({
  id,
  value,
  onChange,
  autoFocus = false,
}: CardComboboxProps) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  /** Bumped on every keystroke, so only the newest request may answer. */
  const generation = useRef(0);

  const cancel = useCallback(() => {
    generation.current += 1;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    inFlight.current?.abort();
    inFlight.current = null;
  }, []);

  useEffect(() => () => cancel(), [cancel]);

  const search = (text: string) => {
    cancel();
    const query = text.trim();
    if ([...query].length < AUTOCOMPLETE_MIN_CHARS) {
      setSuggestions([]);
      return;
    }
    const mine = generation.current;
    timer.current = setTimeout(() => {
      timer.current = null;
      const controller = new AbortController();
      inFlight.current = controller;
      fetch(`/api/cards/autocomplete?q=${encodeURIComponent(query)}`, {
        signal: controller.signal,
      })
        .then(async (res) => (res.ok ? suggestionsOf(await res.json()) : []))
        .catch(() => [])
        .then((names) => {
          if (mine === generation.current) setSuggestions(names);
        });
    }, AUTOCOMPLETE_DEBOUNCE_MS);
  };

  return (
    <Combobox
      value={value}
      onChange={(picked: string | null) => {
        if (picked === null) return;
        cancel();
        setSuggestions([]);
        onChange(picked);
      }}
    >
      <ComboboxInput
        id={id}
        className="mm-input"
        autoComplete="off"
        autoFocus={autoFocus}
        maxLength={CARD_PARAM_MAX_CHARS}
        // Server-rendered HTML carries the prefilled card before hydration.
        defaultValue={value}
        displayValue={(card: string | null) => card ?? ""}
        onChange={(event) => {
          onChange(event.target.value);
          search(event.target.value);
        }}
      />
      {suggestions.length > 0 && (
        <ComboboxOptions className="mm-combobox-options">
          {suggestions.map((name) => (
            <ComboboxOption
              key={name}
              value={name}
              className="mm-combobox-option"
            >
              {name}
            </ComboboxOption>
          ))}
        </ComboboxOptions>
      )}
    </Combobox>
  );
}
