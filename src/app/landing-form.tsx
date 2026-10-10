"use client";

// The landing page's form (S2.4d4; AC-2, AC-15; C1.06 = A). Two plain inputs
// in the designed layout, through the same validator, marker and builder as
// the entry form (S2.4d3): empty fields disable submit with the helper, a
// rejected card or price shows its message inline and never navigates, and a
// valid submit sets the marker, then pushes resultHref(card, price) inside a
// transition (aria-busy while it is pending). No action or method: without
// JavaScript nothing posts anywhere.
import { useResultNavigation } from "@/components/result-navigation";
import { LANDING_COPY } from "@/lib/copy/entry-points";
import { FORM_LABELS } from "@/lib/copy/result-labels";
import { checkEntry, markSubmit } from "@/lib/entry-submit";
import { UI_COPY } from "@/lib/recommendation/ui-copy";
import { useId, useRef, useState, type FormEvent } from "react";

export function LandingForm() {
  const navigation = useResultNavigation();
  const [card, setCard] = useState("");
  const [price, setPrice] = useState("");
  const [cardError, setCardError] = useState(false);
  const [priceError, setPriceError] = useState(false);
  const lastHref = useRef<string | null>(null);
  const id = useId();
  const helperId = `${id}-helper`;
  const cardErrorId = `${id}-card-error`;
  const priceErrorId = `${id}-price-error`;

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
      setPriceError(true);
      return;
    }
    const href = entry.href;
    // The same query again while it loads changes nothing.
    if (navigation.isPending && href === lastHref.current) return;
    lastHref.current = href;
    // The marker first, so S5.1 finds it on the page the push lands on.
    markSubmit(href);
    navigation.navigate(href);
  };

  return (
    <form className="landing-form" onSubmit={submit} noValidate>
      <input
        className="landing-form-input"
        type="text"
        name="card"
        placeholder={LANDING_COPY.cardPlaceholder}
        aria-label={FORM_LABELS.card}
        autoComplete="off"
        value={card}
        aria-invalid={cardError || undefined}
        aria-describedby={cardError ? cardErrorId : undefined}
        onChange={(event) => {
          setCard(event.target.value);
          setCardError(false);
        }}
      />
      <input
        className="landing-form-input price"
        type="text"
        name="price"
        placeholder={LANDING_COPY.pricePlaceholder}
        aria-label={FORM_LABELS.price}
        inputMode="decimal"
        autoComplete="off"
        value={price}
        aria-invalid={priceError || undefined}
        aria-describedby={priceError ? priceErrorId : undefined}
        onChange={(event) => {
          setPrice(event.target.value);
          setPriceError(false);
        }}
      />
      <button
        className="landing-form-submit"
        type="submit"
        disabled={empty}
        aria-busy={navigation.isPending || undefined}
        aria-describedby={empty ? helperId : undefined}
      >
        {FORM_LABELS.submit}
      </button>
      <div className="landing-form-messages">
        {cardError && (
          <p className="landing-form-error" id={cardErrorId} role="alert">
            {UI_COPY.cardNotFound}
          </p>
        )}
        {priceError && (
          <p className="landing-form-error" id={priceErrorId} role="alert">
            {UI_COPY.validationError}
          </p>
        )}
        {empty && (
          <p className="landing-form-hint" id={helperId}>
            {UI_COPY.submitHelper}
          </p>
        )}
      </div>
    </form>
  );
}
