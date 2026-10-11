"use client";

// The entry form (S2.1d5, S2.1d16; AC-9): card search and asking price, on
// /evaluate and above every result or lookup miss. Empty fields disable
// submit with the helper; a card that fails the server's guard or an invalid
// price shows its message inline and never navigates (ADV-6). A valid submit
// sets the one-shot marker, then pushes resultHref(card, price) inside the
// shared transition, so the result slot shows the skeleton at once (AC-8); a
// newer submit while one is pending navigates again, and the latest wins
// (ADV-8), and the superseded submit's marker is removed (S2.4 ADV-5). The
// validator and the marker are shared with the landing form (S2.4d3). Under
// the result page's ResultField it tells the slot when the card field no
// longer holds the URL's card (a miss message hides, S2.4 ADV-4), and after
// an ambiguous miss the card field offers suggestions on focus (S2.4 ADV-7).
import { FORM_LABELS } from "@/lib/copy/result-labels";
import {
  checkEntry,
  clearSubmitMarker,
  isEntryEmpty,
  markSubmit,
} from "@/lib/entry-submit";
import { UI_COPY } from "@/lib/recommendation/ui-copy";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type SVGProps,
} from "react";
import { CardCombobox } from "./card-combobox";
import "./entry-form.css";
import { useResultField } from "./result-field";
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
  const { setCardStale, miss } = useResultField();
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
  const [seenSwitches, setSeenSwitches] = useState(navigation.switches);
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

  // A selector switch evaluates the URL's card and price (AC-5), so the
  // fields show them again: an unsubmitted edit is dropped rather than shown
  // beside a result it did not produce (S2.3 ADV-6, S2.3d13; Josh can
  // overturn). Edits typed after the switch survive it as before (ADV-8).
  if (seenSwitches !== navigation.switches) {
    setSeenSwitches(navigation.switches);
    setCard(initialCard);
    setPrice(initialPrice);
    setError(initialError);
    setCardError(false);
    setBaseline({ card: initialCard, price: initialPrice });
  }

  // Never builds an href during render, so no typed text can throw here (ADV-2).
  const empty = isEntryEmpty(card, price);

  // A miss message is about the URL's card: stale once the field holds
  // another name, or once the form shows its own card error (ADV-4).
  const cardStale = card !== initialCard || cardError;
  useEffect(() => {
    setCardStale(cardStale);
  }, [cardStale, setCardStale]);

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
    // supersedes it, and the superseded push never lands, so its marker goes
    // (ADV-5). A storage failure there never blocks this push.
    const superseded = navigation.isPending ? lastHref.current : null;
    if (superseded === href) return;
    if (superseded !== null) clearSubmitMarker(superseded);
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
            suggestOnFocus={miss === "ambiguous"}
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
