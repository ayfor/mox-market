// User-input bounds (S1.1d11 = A). Not verdict tunables, so they stay outside
// RECOMMENDATION_PARAMS and PARAMS_VERSION. Crypto-free, so a client form may
// import it (F2's message: "Enter a price from $0.01 to $100,000, like 74.99.").

/** $100,000.00 in integer cents, inclusive. */
export const MAX_ASKING_PRICE_CENTS = 10_000_000;

/** $0.01 in integer cents, inclusive. */
export const MIN_ASKING_PRICE_CENTS = 1;
