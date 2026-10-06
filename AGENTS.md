# Mox Market — Agent Instructions

Read this whole file before any work. It applies to every AI agent working in this repo: Cursor, Claude Code, and others. Claude Code loads it through `CLAUDE.md`. Bitey compiles it from the Notion Standards page; Notion is canonical and this file is generated. Last compiled: 2026-10-05. The Standards page is still **Draft**, and 27 rulings are open (see "Open rulings").

## Roles

| Lane | Who | Does | Never |
|------|-----|------|-------|
| **Implementer** | Cursor agents always, and any Claude Code session not booted as Bitey | Builds one approved story on its existing story branch, writes its tests, keeps the plan doc's Session Log, sets its own story's Notion `Status` | Writes plans for itself, edits Notion beyond its own `Status`, writes to Figma, edits the harness, merges, pushes to `main` |
| **Bitey** | Josh's Claude Code companion, booted from `~/Documents/bitey-a/` | Compiles plans, creates story branches and draft PRs, commits `.cursor/hooks/active-story.json` on each story branch, keeps `story-pages.json` current, writes all other Notion fields, runs critiques, flips PRs to ready, monitors CI | Merges |
| **Josh** | Owner | Rules, approves plans, merges every PR | — |

The Git, Databases, Migrations, Secrets, Endpoints and Legal-text limits bind **every** agent, Bitey included. The Notion, Figma and Harness limits bind implementers. In Cursor a hook enforces the Notion and Figma limits. In Claude Code nothing enforces them, so they are instructions there.

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
2. Josh has approved the plan. The signal is **both** the `plan-approved` label on the story's draft PR (`gh pr view <n> --json labels`) **and** a line `Plan approved by Josh, YYYY-MM-DD` with his words in the plan doc's Review section. Josh applies the label himself, or Bitey applies it only when recording his approval. PR comments and review states never count: Josh, Bitey and Cursor all act as the same GitHub account.

Bitey creates the branch `story/S#.#-slug`, commits the plan and `.cursor/hooks/active-story.json` to it, and opens the draft PR. You do not create the branch or write the plan. If anything above is missing, stop and say so in your reply. Change nothing in Notion.

## Stack (as pinned in package.json)

- Next.js 16.1 App Router, React 19.2, TypeScript 5.8. Server components for reads; Server Actions or route handlers only where interaction demands.
- Tailwind CSS 4 with per-route CSS files and `src/app/tokens.css` (Mox jewel palette, glass panels). No new design language.
- Prisma 7 with `@prisma/adapter-pg`; the client is generated into `src/generated/prisma` (gitignored, built by `postinstall`). Database: Supabase Postgres in production.
- Scryfall API through `src/lib/scryfall.ts` (throttled). Prices are TCGplayer-sourced daily estimates.
- Vercel hosting; a daily cron hits `/api/prices/snapshot`.
- Headless UI, Zustand and Recharts are installed, but V2 code does not use them yet. `src/lib/card-cache.ts` is browser-only.
- **Node 22 for every command**, including install, dev and build: Next 16 needs Node 20.9 or later and Prisma 7 needs 20.19 or later. The default shell is zsh with Node 18, and each agent shell call starts fresh, so load Node 22 in the same command every time: `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run build`. Never install or switch Node globally.

## Commands

| Purpose | Command | Status |
|---------|---------|--------|
| Dev server | `npm run dev` | exists (Node 22) |
| Lint | `npm run lint` | **broken until S1.1**: the script is `next lint`, which Next 16 removed; S1.1 repoints it to `eslint .` |
| Format | `npx prettier --write <files you changed>` | Do **not** run `npm run format`: it rewrites the whole repo, including files you must not touch |
| Build | `npm run build` (runs `prisma generate`) | exists (Node 22) |
| Test | `npm test` (Vitest) | lands S1.1 (Vitest 4.x with React Testing Library, ruling C1.49 = A) |
| Test report | `npm run test:report` → `docs/test-report.md` | lands S1.1 |

Before setting `In Review`: build and tests green locally, and lint green once S1.1 lands.

## Conventions (binding)

- **Engine is pure.** The recommendation engine lives in `src/lib/recommendation/` with zero React or Next imports. Unit-testable standalone.
- **Every tunable lives in one exported `RECOMMENDATION_PARAMS` const.** Tuning never requires logic changes. Changing a param value requires a plan-doc deviation and Josh's ruling.
- **Money is integer cents end to end.** Floats exist only inside the Scryfall client at the conversion boundary.
- **Naming is Recommendation / Buy / Fair / Wait**, not Verdict, in code and copy (Josh's 2026-06-01 call; the type-family rename is confirmed in each approved plan).
- **Reason strings state observed facts only.** Forbidden words, lint-tested: likely, expect, expected, will rise, will fall, will drop, will climb, should, probably, forecast, predict.
- **Recommendations are computed server-side** and shipped as rendered HTML. No client-side engine.
- **Price history is addressed by `(scryfall_id, finish)`.** Never merge history across printings or finishes.
- **Prettier formats source code** (organize-imports and tailwindcss plugins). Format only the files you change; do not reformat the repo.
- **Canonical fixtures are the worked examples A–E** in the F1 design. Any param change that flips a fixture updates the fixture in the same PR.
- Do not touch `src/generated/`. Name any new dependency in the PR body.

## Workflow for every story

**Lanes (ruling C1.63 = A, 2026-10-05).** Each agent works one story at a time. Bitey may run file-disjoint stories in parallel, each in its own worktree branched from `main` and never stacked. Stories that change the schema (S1.1, S0.1, S5.1) run one at a time. Your branch, worktree and lane come from Bitey; never branch from another story branch.

1. `git fetch`, then `git checkout story/S#.#-slug`. The branch already exists with the approved plan on it. Do not create it.
2. Read the Notion story page and `docs/plans/S#.#-slug.md`. The plan's Test Manifest is the test contract.
3. Set the story's Notion `Status` to `In Progress`. You may set only `In Progress`, `Testing`, `In Review` or `Blocked`, and only on your own story's page.
4. Implement per the plan. If the plan is wrong, update it on the same branch and record the change under Deviations. Never silently diverge.
5. Write every test in the manifest, then set `Status` to `Testing`.
6. Before `In Review`: run the full suite and the build; from S1.1 on, run `npm run test:report` and commit `docs/test-report.md`; fill in the plan's Results table; capture functional evidence for each acceptance criterion (UI stories: preview screenshots and logs; engine and tooling stories: the test-report section plus command output).
7. Append a Session Log entry to the plan doc every session (shape in `docs/plans/TEMPLATE.md`). Every claim of done carries evidence: a commit hash, or a command and its result. Commit and push it.
8. Push the branch. Fill in the draft PR's body per `docs/plans/PR-BODY.md`. Leave it as a draft. Set `Status` to `In Review`.
9. Bitey runs an implementation critique and leaves a change list in the plan doc. Apply it, re-run the suite, and reply in the Session Log. Bitey flips the PR to ready.
10. If you are stuck, set `Status` to `Blocked`, write the reason in the Session Log, and commit and push it. The fence blocks Notion comments, so the reason never goes in Notion; Bitey mirrors it there.

## Hard limits

- **Notion:** set only your own story's `Status`, to `In Progress`, `Testing`, `In Review` or `Blocked`, and nothing else. Pass the bare page ID (32 hex digits, dashes optional), never a URL. In Cursor, `.cursor/hooks/mcp-write-fence.sh` enforces this. It allows a Status write only from the `story/S#.#-slug` branch named in `.cursor/hooks/active-story.json`, only on that story's page in `.cursor/hooks/story-pages.json`, and denies every other Notion write, including comments.
- **Figma:** read-only. The same hook denies every Figma tool outside a read allowlist. It recognizes Figma by its tool names as well as its server name, so a renamed server is still fenced.
- **Other MCP servers:** only Cursor's built-in servers are allowed. The hook denies any other server until Bitey adds it, so ask before relying on a new one.
- **Harness:** never edit `.cursor/**`, `AGENTS.md`, `CLAUDE.md`, `docs/llm/WORKLOG.md`, `docs/plans/TEMPLATE.md`, `docs/plans/PR-BODY.md` or `docs/specs/**`. If the fence denies something, stop, log it in the Session Log, and ask Bitey. The fence catches mistakes: Cursor guards its `.json` anchors with an approval prompt and the script's hash is pinned, but Cursor's unrestricted mode skips those prompts, so the fence cannot stop a determined agent.
- **Git:** never merge a PR, push to `main`, force-push, or delete a branch. A GitHub ruleset on `main` requires a pull request and blocks force pushes and deletion, but it cannot stop a merge: Josh, Bitey and Cursor all act as the same account. Josh merges.
- **Databases:** never run a command that changes a database, unless every database URL in your environment and in every `.env*` file points at `localhost` or `127.0.0.1`. That covers any `prisma migrate` subcommand, `prisma db push`, `prisma db execute`, `supabase db push`, `supabase db reset`, and any test setup that migrates or seeds. Check the host, not the variable name: `prisma.config.ts` loads `.env` and reads `POSTGRES_URL_NON_POOLING`, then `POSTGRES_PRISMA_URL`, then `DATABASE_URL`, and Next also loads `.env.local`. This prints hostnames only, never credentials:
  `{ env; cat .env* 2>/dev/null; } | grep -oE 'postgres(ql)?://[^[:space:]"]+' | sed -E 's#^[^@]*@##; s#[:/?].*##' | sort -u`
  If it shows anything other than `localhost` or `127.0.0.1`, stop. Production has no backups.
- **Migrations:** Prisma Migrate is the only schema tool (ruling C1.01 = A). Author a migration only when your story's approved plan includes one. Numbering: `0000` baseline (S1.1), `0001` price_history (S0.1), `0002` recommendation_log (S5.1). Apply migrations only to a local database; applying to production is Josh's step, after a manual `pg_dump` before any destructive change.
- **Secrets:** never commit `.env*`, never print environment values, never paste keys into chat or logs.
- **Endpoints:** never call `/api/prices/snapshot` with any method. Its GET writes rows for the cron, and its POST has no authentication.
- **Thresholds and copy:** do not change `RECOMMENDATION_PARAMS` values or the locked copy table text without a plan-doc deviation and Josh's ruling.
- **Legal text:** footer and disclaimer wording comes verbatim from `docs/specs/attribution-footer.md`. In code it lives in the copy module, and a test asserts it equals the spec. Never paraphrase it.

## Rulings (all 27 decided 2026-10-05)

Every C1 ruling is decided. The full table is in `docs/critiques/C1-2026-10-04-phase1-designs.md` and `docs/llm/WORKLOG.md`. The ones that shape code most:

- **C1.06 = A:** results render at `/[card]?price=&finish=` as an async server component. `/` and `/evaluate` submit there (story S2.4), and `/sample` retires and redirects to the demo link.
- **C1.04 = A:** Phase 1 builds the MTGJson price-history pipeline (Design F0, stories S0.1–S0.3) before S2.1.
- **C1.01 = A:** Prisma Migrate (see Hard limits).
- **C1.08 = A:** the printing selector is its own story, S2.3. Etched stays hidden in Phase 1.
- **C1.13 = C:** the demo link `/Esper%20Sentinel?price=74.99` stays; its result floats with the market.
- **C1.63 = A:** parallel lanes (see Workflow).
- **C1.49 = A:** Vitest 4.x with React Testing Library.

Still open for Josh's gate: Design F0's Open Question 1 (a cron GET carve-out from the no-writes-in-GET rule) and F2's `printing=<scryfall id>` parameter. If your story's plan depends on one, set `Status` to `Blocked` and name it in the Session Log.

## Known state of main (2026-10-04)

- App code on `main` is still PR #2 (2026-06-19); PR #3 added only this harness. The app has the landing page, `/evaluate` (a client component with hard-coded demo values whose submit 404s), the `/sample` static demo, and V1 API routes for watchlist price snapshots. There are no tests, no `.nvmrc` and no CI test step.
- The Prisma schema has `TrackedCard` and `PriceSnapshot`: wide rows written by the V1 cron for watchlisted cards only. Arbitrary evaluated cards have no price history.
- The landing form still posts to `/sample`.
- The attribution footer (ruling R6) is not on the site; it is a V2 ship-blocker. The per-page footers on `/evaluate` and `/sample` make false claims (CardKingdom, CardMarket, "every 4 hours").
- **Production deploys are paused.** The Vercel project's Ignored Build Step skips every production build, so merges to `main` do not deploy and the live site serves the March 2026 V1 build until the R6 footer story lands. Preview deploys build normally, and the Vercel check on PRs is meaningful again.
- The Supabase database was resumed on 2026-10-05 after a months-long pause. The live V1 site's history API still returns 500; leave it.
- `/api/prices/snapshot` writes on GET and has an unauthenticated POST; `CRON_SECRET` was never set, so the GET guard is skipped too. A Vercel Firewall rule denies the path on the live site. Do not call it with any method; S0.3 deletes it.
