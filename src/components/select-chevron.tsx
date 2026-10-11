// The selectors' decorative chevron (S2.3d6): hidden from assistive tech,
// no text. No hooks, so either side of the boundary may render it.
export function SelectChevron() {
  return (
    <svg
      className="mm-selector-chevron"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M6 8l4 4 4-4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
