# Mox Market — Agent Instructions

Read this whole file before any work. It applies to every AI agent working in this repo (Cursor, Claude Code, others). Claude Code loads it through `CLAUDE.md`. It is compiled by Bitey from the Notion Standards page; Notion is canonical, this file is generated. Last compiled: 2026-10-04 (Standards page still **Draft**, see "Pending rulings").

## What this is

Mox Market is an MTG card price evaluation tool. V2 answers one question: *is this asking price a good price for this card?* It returns a **Buy / Fair / Wait recommendation** with a one-sentence, fact-based reason. Live at https://mox-market.vercel.app. Owner: Josh Stubbington (Twin Spruce Studio). Bitey is Josh's Claude Code companion; it compiles work orders, critiques designs and PRs, and monitors. Josh merges every PR. Nobody else merges.

## Source-of-truth map

| Question | Where |
|----------|-------|
| What to build: features, designs, acceptance criteria | Notion: **Mox Market** project page → *Development Standards*, *V2 Phase 1 Feature Breakdown*, *Design — F1…F5*, and the **Mox Market — Stories** database |
| Story status | Notion Stories DB, `Status` field. The one Notion field agents write. |
| The engineering plan for a story | `docs/plans/S#.#-slug.md` in this repo (template: `docs/plans/TEMPLATE.md`) |
| Standards and conventions | this file |
| Attribution footer and disclaimer wording (ship-blocker) | `docs/specs/attribution-footer.md` |
| Critique logs (what Bitey found and fixed before Josh reviewed) | `docs/critiques/` |
| Decisions ledger | `docs/llm/WORKLOG.md` (Bitey writes, agents read) |
| Living ER diagram | `docs/architecture/erd.md` (lands at S1.1) |

Every Notion page carries a status line at the top. **Draft means not authoritative.** Build only from pages marked Approved, or from a plan doc in `docs/plans/` that Bitey compiled for your story. If your story has no plan doc, stop and say so in your reply. Do not write one yourself unless asked.

## Stack (as pinned in package.json)

- Next.js 16.1 App Router, React 19.2, TypeScript 5.8. Server components for reads; Server Actions or route handlers only where interaction demands.
- Tailwind CSS 4 with per-route CSS files and `src/app/tokens.css` (Mox jewel palette, glass panels). No UI kit; Headless UI 2 for primitives. No new design language.
- Zustand 5 for genuine client state only. Recharts 2 for charts.
- Prisma 7 with `@prisma/adapter-pg`, client generated into `src/generated/prisma` (gitignored, built by `postinstall`). Database: Supabase Postgres (prod) via `POSTGRES_PRISMA_URL`.
- Scryfall API through `src/lib/scryfall.ts` (throttled, cached). Prices are TCGplayer-sourced daily estimates.
- Vercel hosting; a daily cron hits `/api/prices/snapshot`.
- Node: the machine default is 18; Vitest 4 needs **Node 22**. Use `nvm use 22` until `.nvmrc` lands in S1.1.

## Commands

| Purpose | Command | Status |
|---------|---------|--------|
| Dev server | `npm run dev` | exists |
| Lint | `npm run lint` | exists |
| Format | `npm run format` | exists |
| Build | `npm run build` (runs `prisma generate`) | exists |
| Test | `npm test` (Vitest) | lands S1.1 |
| Test report | `npm run test:report` → `docs/test-report.md` | lands S1.1 |

Before any PR: lint, build, and test all green locally.

## Conventions (binding)

- **Engine is pure.** The recommendation engine lives in `src/lib/recommendation/` with zero React or Next imports. Unit-testable standalone.
- **Every tunable lives in one exported `RECOMMENDATION_PARAMS` const.** Tuning never requires logic changes. Changing a param value requires a plan-doc deviation and Josh's ruling.
- **Money is integer cents end to end.** Floats exist only inside the Scryfall client at the conversion boundary.
- **Naming is Recommendation / Buy / Fair / Wait**, not Verdict, in code and copy (pending ratification, see below; use Recommendation unless told otherwise).
- **Reason strings state observed facts only.** Forbidden words, lint-tested: likely, expect, expected, will rise, will fall, will drop, will climb, should, probably, forecast, predict.
- **Recommendations are computed server-side** and shipped as rendered HTML. No client-side engine.
- **Price history is keyed by `(scryfall_id, finish)`.** Never merge history across printings or finishes.
- **Prettier is the format authority** (organize-imports and tailwindcss plugins). Lint green before any PR.
- **Canonical fixtures are the worked examples A–E** from the F1 design. Any param change that flips a fixture updates the fixture in the same PR.
- Do not touch `src/generated/`. Do not add dependencies without naming them in the PR body.

## Workflow for every story

1. `git checkout main && git pull`. Branch `story/S#.#-slug` from `main`. Never branch from another story branch. If a dependency is unmerged, wait.
2. Read the Notion story page and `docs/plans/S#.#-slug.md`. The plan's Test Manifest is the test contract.
3. Set the story's Notion `Status` to `In Progress`. Statuses: Draft → Ready → Planning → In Progress → Testing → In Review → Done; `Blocked` from any state with a reason on the story page.
4. Implement per the plan. If the plan is wrong, update it in the same branch and record the change under Deviations. Never silently diverge.
5. Write every test in the manifest. Run the full suite, lint, and build.
6. Append a Session Log entry to the plan doc every session (shape in `docs/plans/TEMPLATE.md`). Claims of done carry evidence: a commit hash or a command and its result.
7. Open a PR against `main` titled `S#.# — {story name}`, body per the template. Keep it draft until green. Set `Status` to `In Review`.
8. Bitey runs an implementation critique on the branch and leaves a change list in the plan doc. Apply it, re-run the suite, reply in the Session Log.
9. Never merge. Never push to `main`. Josh merges.

## Hard limits

- **Notion:** write only your own story's `Status`. Do not edit design pages, the Standards page, the Feature Breakdown, other stories, or any other database. A hook in `.cursor/hooks/` denies other Notion writes.
- **Figma:** read-only. The same hook denies Figma write tools.
- **Production database:** never run `supabase db push`, `prisma migrate deploy`, or `prisma db push` against a `POSTGRES_*` or Supabase URL. Schema changes are migration files, applied locally only. Prod application is Josh's step. The Free tier has no backups.
- **Secrets:** never commit `.env*`, never print environment values, never paste keys into chat or logs.
- **Thresholds and copy:** do not change `RECOMMENDATION_PARAMS` values or the locked copy table text without a plan-doc deviation and Josh's ruling.
- **Legal text:** footer and disclaimer wording comes verbatim from `docs/specs/attribution-footer.md`. Never paraphrase it.

## Pending rulings (as of 2026-10-04)

The Standards page is Draft with these open decisions. Until Josh rules, use the default in bold.

1. Live surface: **`/evaluate`** (merged in PR #2) vs `/sample` (static demo).
2. Type naming: **`Recommendation*`** vs the spec's `Verdict*`.
3. Test stack: **Vitest 4 + React Testing Library**, Playwright deferred (evidence-ratified 2026-08-20, awaiting Josh's sign-off).
4. Migration lane: Prisma Migrate files vs the Supabase CLI four-rule lane. **Do not author a migration until this is ruled.**

## Known state of main (2026-10-04)

- `main` = PR #2 (2026-06-19): landing page, `/evaluate` (client component, hard-coded demo values), `/sample` static demo, V1 API routes for watchlist price snapshots. No tests, no `.nvmrc`, no CI test step.
- Prisma schema: `TrackedCard` + `PriceSnapshot` (wide rows, written by the V1 cron for watchlisted cards only). Price history for an arbitrary evaluated card does not exist yet.
- The landing form still posts to `/sample`.
- The attribution footer (ruling R6) is not on the site. It is a V2 ship-blocker.
