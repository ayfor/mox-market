"use client";

// The landing page's form (S2.4d4; AC-2, AC-15; C1.06 = A), in the designed
// layout, through the same validator, marker and builder as the entry form
// (S2.4d3): empty fields disable submit with the helper, a rejected card or
// price shows its message inline and never navigates, and a valid submit
// sets the marker, then pushes resultHref(card, price) inside a transition
// (aria-busy while it is pending). No action or method: without JavaScript
// nothing posts anywhere.
//
// UI patch (2026-10-30): the card field is the entry form's CardCombobox,
// with the landing input's look and its list opening upward, since the
// panel clips anything below the form; and the optional Set picker sits
// beside it. A chosen set adds its printing to the href; changing the card
// text resets it to "Any set". The form is a Headless UI Field and the card
// error its Description, so the combobox names the error in its
// aria-describedby, which Headless UI sets itself (review UI-5).
import { CardCombobox } from "@/components/card-combobox";
import { useResultNavigation } from "@/components/result-navigation";
import {
  ANY_SET,
  chosenPrinting,
  setChoiceFor,
  SetSelect,
  useCardPrintings,
  type SetChoice,
} from "@/components/set-select";
import { LANDING_COPY } from "@/lib/copy/entry-points";
import { FORM_LABELS } from "@/lib/copy/result-labels";
import {
  checkEntry,
  clearSubmitMarker,
  isEntryEmpty,
  markSubmit,
} from "@/lib/entry-submit";
import { UI_COPY } from "@/lib/recommendation/ui-copy";
import { Description, Field } from "@headlessui/react";
import { useId, useRef, useState, type FormEvent } from "react";

export function LandingForm() {
  const navigation = useResultNavigation();
  const [card, setCard] = useState("");
  const [price, setPrice] = useState("");
  const [cardError, setCardError] = useState(false);
  const [priceError, setPriceError] = useState(false);
  const printings = useCardPrintings();
  const [setChoice, setSetChoice] = useState<SetChoice>(ANY_SET);
  const lastHref = useRef<string | null>(null);
  const id = useId();
  const cardId = `${id}-card`;
  const helperId = `${id}-helper`;
  const cardErrorId = `${id}-card-error`;
  const priceErrorId = `${id}-price-error`;

  // Never builds an href during render, so no typed text can throw here (ADV-2).
  const empty = isEntryEmpty(card, price);
  const printing = chosenPrinting(setChoice, card);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const entry = checkEntry(card, price, printing);
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
    // The same query again while it loads changes nothing; a different one
    // supersedes it, and the superseded push never lands, so its marker goes
    // (ADV-5). A storage failure there never blocks this push.
    const superseded = navigation.isPending ? lastHref.current : null;
    if (superseded === href) return;
    if (superseded !== null) clearSubmitMarker(superseded);
    lastHref.current = href;
    // The marker first, so S5.1 finds it on the page the push lands on.
    markSubmit(href);
    navigation.navigate(href);
  };

  return (
    <Field as="form" className="landing-form" onSubmit={submit} noValidate>
      <div className="landing-form-card">
        <CardCombobox
          id={cardId}
          name="card"
          placeholder={LANDING_COPY.cardPlaceholder}
          ariaLabel={FORM_LABELS.card}
          inputClassName="landing-form-input"
          optionsClassName="mm-combobox-options mm-combobox-options--above"
          value={card}
          invalid={cardError}
          errorMessageId={cardErrorId}
          onChange={(next) => {
            setCard(next);
            setCardError(false);
            if (next.trim() !== card.trim()) setSetChoice(ANY_SET);
          }}
          onCommit={printings.request}
        />
      </div>
      <SetSelect
        card={card}
        lookup={printings.lookup}
        value={printing}
        onChange={(next) => setSetChoice(setChoiceFor(card, next))}
        onRequest={() => printings.request(card)}
        className="landing-form-set"
        labelClassName="landing-form-set-label"
        optionsClassName="mm-selector-options mm-set-options mm-set-options--above"
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
          <Description
            as="p"
            className="landing-form-error"
            id={cardErrorId}
            role="alert"
          >
            {UI_COPY.cardNotFound}
          </Description>
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
    </Field>
  );
}
