// Vitest's stand-in for the `server-only` package (S2.1d3). The package
// throws unless it is resolved under the `react-server` condition, which only
// Next's server build sets, so vitest.config.mts aliases it here. `next build`
// still resolves the real package and fails any client module that reaches
// the engine or buildEvaluation.
export {};
