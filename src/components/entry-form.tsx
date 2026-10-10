"use client";

// The entry form (S2.1d5, S2.1d16; AC-9): card search and asking price, on
// /evaluate and above every result or lookup miss. Empty fields disable
// submit with the helper; a card that fails the server's guard or an invalid
// price shows its message inline and never navigates (ADV-6). A valid submit
// sets the one-shot marker, then pushes resultHref(card, price) inside the
// shared transition, so the result slot shows the skeleton at once (AC-8); a
// newer submit while one is pending navigates again, and the latest wins
// (ADV-8). The validator and the marker are shared with the landing form
// (S2.4d3).
import { FORM_LABELS } from "@/lib/copy/result-labels";
import { checkEntry, markSubmit } from "@/lib/entry-submit";
import { UI_COPY } from "@/lib/recommendation/ui-copy";
import { useId, useRef, useState, type FormEvent, type SVGProps } from "react";
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

interface FieldValues {
  readonly card: string;
  readonly price: string;
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
  const [cardError, setCardError] = useState(false);
  /** What the fields last took from the URL or last submitted (ADV-8). */
  const [baseline, setBaseline] = useState<FieldValues>({
    card: initialCard,
    price: initialPrice,
  });
  const [fromUrl, setFromUrl] = useState({
    card: initialCard,
    price: initialPrice,
    error: initialError,
  });
  const lastHref = useRef<string | null>(null);
  const id = useId();
  const cardId = `${id}-card`;
  const priceId = `${id}-price`;
  const helperId = `${id}-helper`;
  const errorId = `${id}-error`;
  const cardErrorId = `${id}-card-error`;

  // A navigation landed (or back/forward): take the URL's values, but only
  // into fields the user has not edited since the last sync or submit, so an
  // edit typed while a result loads survives it (ADV-8). The page no longer
  // remounts the form on every navigation.
  if (
    fromUrl.card !== initialCard ||
    fromUrl.price !== initialPrice ||
    fromUrl.error !== initialError
  ) {
    setFromUrl({ card: initialCard, price: initialPrice, error: initialError });
    const cardClean = card === baseline.card;
    const priceClean = price === baseline.price;
    if (cardClean) {
      setCard(initialCard);
      setCardError(false);
    }
    if (priceClean) {
      setPrice(initialPrice);
      setError(initialError);
    }
    setBaseline({
      card: cardClean ? initialCard : baseline.card,
      price: priceClean ? initialPrice : baseline.price,
    });
  }

  const empty = checkEntry(card, price).status === "empty";

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const entry = checkEntry(card, price);
    if (entry.status === "empty") return;
    if (entry.status === "bad_card") {
      setCardError(true);
      return;
    }
    if (entry.status === "bad_price") {
      setError(true);
      return;
    }
    const href = entry.href;
    // The same query again while it loads changes nothing; a different one
    // supersedes it.
    if (navigation.isPending && href === lastHref.current) return;
    lastHref.current = href;
    setBaseline({ card, price });
    // The marker first, so S5.1 finds it on the page the push lands on.
    markSubmit(href);
    navigation.navigate(href);
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
            onChange={(next) => {
              setCard(next);
              setCardError(false);
            }}
            autoFocus={autoFocus}
            invalid={cardError}
            errorMessageId={cardErrorId}
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
            aria-busy={navigation.isPending || undefined}
            aria-describedby={empty ? helperId : undefined}
          >
            {FORM_LABELS.submit}
            <ArrowRightIcon />
          </button>
        </div>
      </div>
      {cardError && (
        <p className="mm-form-error" id={cardErrorId} role="alert">
          {UI_COPY.cardNotFound}
        </p>
      )}
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
