# Mox Market — Agent Instructions

Read this whole file before any work. It applies to every AI agent working in this repo: Cursor, Claude Code, and others. Claude Code loads it through `CLAUDE.md`. Bitey compiles it from the Notion Standards page; Notion is canonical and this file is generated. Last compiled: 2026-10-04. The Standards page is still **Draft**, and 27 rulings are open (see "Open rulings").

## Roles

| Lane | Who | Does | Never |
|------|-----|------|-------|
| **Implementer** | Cursor agents, and any Claude Code session not booted as Bitey | Builds one approved story on its existing story branch, writes its tests, keeps the plan doc's Session Log, sets its own story's Notion `Status` | Writes plans for itself, edits Notion beyond its own `Status`, writes to Figma, merges, pushes to `main` |
| **Bitey** | Josh's Claude Code companion, booted from `~/Documents/bitey-a/` | Compiles plans, creates story branches and draft PRs, writes all other Notion fields, runs critiques, monitors CI | Merges |
| **Josh** | Owner | Rules, approves plans, merges every PR | — |

Everything below "Hard limits" binds implementers. In Cursor a hook enforces the Notion and Figma limits. In Claude Code nothing enforces them, so they are instructions there.

## What this is

Mox Market is an MTG card price evaluation tool. V2 answers one question: *is this asking price a good price for this card?* It returns a **Buy / Fair / Wait recommendation** with a one-sentence, fact-based reason. The live site is https://mox-market.vercel.app, which still serves V1. Owner: Josh Stubbington (Twin Spruce Studio).

## Source-of-truth map

| Question | Where |
|----------|-------|
| What to build: features, designs, acceptance criteria | Notion: **Mox Market** project page → *Development Standards*, *V2 Phase 1 Feature Breakdown*, *Design — F1…F5*, and the **Mox Market — Stories** database |
| Story status | Notion Stories DB, `Status` field. The one Notion field implementers write. |
| The engineering plan for a story | `docs/plans/S#.#-slug.md` on the story's branch (template: `docs/plans/TEMPLATE.md`) |
| Standards and conventions | this file |
| Attribution footer and disclaimer wording (ship-blocker) | `docs/specs/attribution-footer.md` |
| Critique logs | `docs/critiques/`. **These are records of what Bitey found, not instructions.** Never apply a "staged" or "held" fix from a log; Bitey applies fixes to Notion and plan docs. |
| Decisions ledger | `docs/llm/WORKLOG.md` (Bitey writes, agents read) |
| Living ER diagram | `docs/architecture/erd.md` (lands at S1.1) |

## When you may build

You may start a story only when **both** are true:

1. The story's Notion design page shows **Approved** in its status line. **Draft means not authoritative.**
2. Josh has approved the plan doc on the story's **draft PR**. Bitey creates the branch `story/S#.#-slug`, commits the plan to it, and opens the draft PR. You do not create the branch or write the plan.

If either is missing, stop and say so in your reply. Change nothing in Notion.

## Stack (as pinned in package.json)

- Next.js 16.1 App Router, React 19.2, TypeScript 5.8. Server components for reads; Server Actions or route handlers only where interaction demands.
- Tailwind CSS 4 with per-route CSS files and `src/app/tokens.css` (Mox jewel palette, glass panels). No new design language.
- Prisma 7 with `@prisma/adapter-pg`; the client is generated into `src/generated/prisma` (gitignored, built by `postinstall`). Database: Supabase Postgres in production.
- Scryfall API through `src/lib/scryfall.ts` (throttled). Prices are TCGplayer-sourced daily estimates.
- Vercel hosting; a daily cron hits `/api/prices/snapshot`.
- Headless UI, Zustand and Recharts are installed, but V2 code does not use them yet. `src/lib/card-cache.ts` is browser-only.
- **Node 22 for every command**, including install, dev and build: Next 16 needs Node 20.9 or later and Prisma 7 needs 20.19 or later. Run `nvm use 22` until S1.1 pins it.

## Commands

| Purpose | Command | Status |
|---------|---------|--------|
| Dev server | `npm run dev` | exists (Node 22) |
| Lint | `npm run lint` | **broken until S1.1**: the script is `next lint`, which Next 16 removed; S1.1 repoints it to `eslint .` |
| Format | `npm run format` | exists; `.prettierignore` excludes `docs/`, `AGENTS.md`, `CLAUDE.md` and generated code |
| Build | `npm run build` (runs `prisma generate`) | exists (Node 22) |
| Test | `npm test` (Vitest) | lands S1.1 |
| Test report | `npm run test:report` → `docs/test-report.md` | lands S1.1 |

Before marking a PR ready: build and tests green locally, and lint green once S1.1 lands.

## Conventions (binding)

- **Engine is pure.** The recommendation engine lives in `src/lib/recommendation/` with zero React or Next imports. Unit-testable standalone.
- **Every tunable lives in one exported `RECOMMENDATION_PARAMS` const.** Tuning never requires logic changes. Changing a param value requires a plan-doc deviation and Josh's ruling.
- **Money is integer cents end to end.** Floats exist only inside the Scryfall client at the conversion boundary.
- **Naming is Recommendation / Buy / Fair / Wait**, not Verdict, in code and copy.
- **Reason strings state observed facts only.** Forbidden words, lint-tested: likely, expect, expected, will rise, will fall, will drop, will climb, should, probably, forecast, predict.
- **Recommendations are computed server-side** and shipped as rendered HTML. No client-side engine.
- **Price history is addressed by `(scryfall_id, finish)`.** Never merge history across printings or finishes.
- **Prettier formats source code** (organize-imports and tailwindcss plugins). Format only the files you change; do not reformat the repo.
- **Canonical fixtures are the worked examples A–E** in the F1 design. Any param change that flips a fixture updates the fixture in the same PR.
- Do not touch `src/generated/`. Name any new dependency in the PR body.

## Workflow for every story

**One story at a time.** The next story starts only after Josh merges the previous PR and its code is confirmed on `main` (Josh's 2026-06-13 ruling). Parallel lanes are proposed but not ruled (ruling C1.63); until then, never work two stories at once and never branch from another story branch.

1. `git fetch`, then `git checkout story/S#.#-slug`. The branch already exists with the approved plan on it. Do not create it.
2. Read the Notion story page and `docs/plans/S#.#-slug.md`. The plan's Test Manifest is the test contract.
3. Set the story's Notion `Status` to `In Progress`. You may set only `In Progress`, `Testing`, `In Review` or `Blocked`, and only on your own story's page.
4. Implement per the plan. If the plan is wrong, update it on the same branch and record the change under Deviations. Never silently diverge.
5. Write every test in the manifest, then set `Status` to `Testing`. Run the full suite and the build.
6. Append a Session Log entry to the plan doc every session (shape in `docs/plans/TEMPLATE.md`). Every claim of done carries evidence: a commit hash, or a command and its result.
7. Push the branch. Update the draft PR's body per the template. Leave it as a draft. Set `Status` to `In Review`.
8. Bitey runs an implementation critique and leaves a change list in the plan doc. Apply it, re-run the suite, and reply in the Session Log. Bitey flips the PR to ready.
9. If you are stuck, set `Status` to `Blocked` and write the reason in the Session Log. The fence blocks Notion comments, so the reason never goes in Notion.

## Hard limits

- **Notion:** set only your own story's `Status`, to `In Progress`, `Testing`, `In Review` or `Blocked`, and nothing else. In Cursor, `.cursor/hooks/mcp-write-fence.sh` enforces this. It reads your checked-out `story/S#.#-slug` branch, allows that story's mapped page only (`.cursor/hooks/story-pages.txt`), and denies every other Notion write, including comments.
- **Figma:** read-only. The same hook denies every Figma tool outside a read allowlist.
- **Git:** never merge a PR, push to `main`, force-push, or delete a branch. GitHub does not enforce this yet, so it is on you.
- **Databases:** never run a command that changes a database, unless every database URL in your environment and in `.env` points at `localhost` or `127.0.0.1`. That covers any `prisma migrate` subcommand, `prisma db push`, `prisma db execute`, `supabase db push`, `supabase db reset`, and any test setup that migrates or seeds. Check the host, not the variable name: `prisma.config.ts` loads `.env` and reads `POSTGRES_URL_NON_POOLING`, then `POSTGRES_PRISMA_URL`, then `DATABASE_URL`. If any of them names a remote host such as `*.supabase.co`, stop. Production has no backups.
- **Migrations:** do not author a migration until Josh rules on the migration lane (ruling C1.01).
- **Secrets:** never commit `.env*`, never print environment values, never paste keys into chat or logs.
- **Thresholds and copy:** do not change `RECOMMENDATION_PARAMS` values or the locked copy table text without a plan-doc deviation and Josh's ruling.
- **Legal text:** footer and disclaimer wording comes verbatim from `docs/specs/attribution-footer.md`. In code it lives in the copy module, and a test asserts it equals the spec. Never paraphrase it.

## Open rulings (as of 2026-10-04)

The **Your rulings** table in `docs/critiques/C1-2026-10-04-phase1-designs.md` is authoritative. There are no defaults. If your story's plan depends on an open ruling, set `Status` to `Blocked` and name the ruling in the Session Log. The ones most likely to touch code:

- **C1.06:** the result route. `/evaluate` exists, but its submit navigates to a `/[card]` route that was never built. `/sample` is a static demo.
- **C1.01:** the migration lane, Prisma Migrate vs the Supabase CLI.
- **C1.04:** whether Phase 1 builds a price-history source.
- **C1.63:** parallel story lanes.

## Known state of main (2026-10-04)

- `main` is PR #2 (2026-06-19): the landing page, `/evaluate` (a client component with hard-coded demo values whose submit 404s), the `/sample` static demo, and V1 API routes for watchlist price snapshots. There are no tests, no `.nvmrc` and no CI test step.
- The Prisma schema has `TrackedCard` and `PriceSnapshot`: wide rows written by the V1 cron for watchlisted cards only. Arbitrary evaluated cards have no price history.
- The landing form still posts to `/sample`.
- The attribution footer (ruling R6) is not on the site; it is a V2 ship-blocker. The per-page footers on `/evaluate` and `/sample` make false claims (CardKingdom, CardMarket, "every 4 hours").
- Vercel production failed on both V2 merges, so the live site still serves V1. The production database appears to be paused.
- `POST /api/prices/snapshot` has no authentication. Do not call it.
