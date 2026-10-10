"use client";

// The entry form (S2.1d5, S2.1d16; AC-9): card search and asking price.
// Empty fields disable submit with the helper; an invalid price shows the
// validation string inline and never navigates. A valid submit pushes the
// result route inside the shared transition, so the result slot shows the
// skeleton at once (AC-8). /evaluate uses it today; S2.4 adds the landing form.
import { FORM_LABELS } from "@/lib/copy/result-labels";
import {
  normalisePrice,
  parsePriceCents,
} from "@/lib/evaluation/result-params";
import { UI_COPY } from "@/lib/recommendation/ui-copy";
import { useId, useState, type FormEvent, type SVGProps } from "react";
import { CardCombobox } from "./card-combobox";
import "./entry-form.css";
import { useResultNavigation } from "./result-navigation";

export interface EntryFormProps {
  readonly initialCard?: string;
  readonly initialPrice?: string;
  /** The server rejected the price or finish: show the validation string. */
  readonly initialError?: boolean;
  readonly autoFocus?: boolean;
}

const ArrowRightIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" {...p}>
    <path
      d="M4 10h12m0 0l-5-5m5 5l-5 5"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** The result route for a card and a typed price; finish defaults to normal. */
function resultHref(card: string, price: string): string {
  return `/${encodeURIComponent(card.trim())}?price=${encodeURIComponent(normalisePrice(price))}`;
}

export function EntryForm({
  initialCard = "",
  initialPrice = "",
  initialError = false,
  autoFocus = false,
}: EntryFormProps) {
  const navigation = useResultNavigation();
  const [card, setCard] = useState(initialCard);
  const [price, setPrice] = useState(initialPrice);
  const [error, setError] = useState(initialError);
  const id = useId();
  const cardId = `${id}-card`;
  const priceId = `${id}-price`;
  const helperId = `${id}-helper`;
  const errorId = `${id}-error`;

  const empty = card.trim() === "" || price.trim() === "";

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (empty || navigation.isPending) return;
    if (parsePriceCents(price) === null) {
      setError(true);
      return;
    }
    navigation.navigate(resultHref(card, price));
  };

  return (
    <form className="mm-form-panel" onSubmit={submit} noValidate>
      <div className="mm-form-row">
        <div className="mm-field mm-field--grow">
          <label className="mm-field-label" htmlFor={cardId}>
            {FORM_LABELS.card}
          </label>
          <CardCombobox
            id={cardId}
            value={card}
            onChange={setCard}
            autoFocus={autoFocus}
          />
        </div>
        <div className="mm-field mm-field--price">
          <label className="mm-field-label" htmlFor={priceId}>
            {FORM_LABELS.price}
          </label>
          <input
            id={priceId}
            className="mm-input"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={price}
            aria-invalid={error}
            aria-describedby={error ? errorId : undefined}
            onChange={(event) => {
              setPrice(event.target.value);
              setError(false);
            }}
          />
        </div>
        <div className="mm-field mm-field--btn">
          <button
            type="submit"
            className="mm-evaluate-btn"
            disabled={empty}
            aria-describedby={empty ? helperId : undefined}
          >
            {FORM_LABELS.submit}
            <ArrowRightIcon />
          </button>
        </div>
      </div>
      {error && (
        <p className="mm-form-error" id={errorId} role="alert">
          {UI_COPY.validationError}
        </p>
      )}
      {empty && (
        <p className="mm-form-hint" id={helperId}>
          {UI_COPY.submitHelper}
        </p>
      )}
    </form>
  );
}
