# LLM Worklog

Append-only. Written by Bitey at gates and merges: Josh's rulings (verbatim where it matters), what was generated, what the human changed. Per-story detail lives in each `docs/plans/S#.#-*.md` (Decisions, Review, Session Log); this file is the cross-story ledger. Coding agents read it and do not write it. Times ET.

## 2026-06-13 — Branching rule (carried from the billd pilot)
RULING — every story PR branches from `main` and targets `main`, and **stories run sequentially**: the next story branches only after the previous PR is merged and confirmed on `main`. No stacking on unmerged story branches. Cause: a stacked S1.2 merged into a deleted parent and auth never reached `main`. (Parallel lanes proposed 2026-10-04 as ruling C1.63; the rule stands until Josh rules.)

## 2026-07-05 — Autodev Stages 0–3 drafted
Standards, Feature Breakdown F1–F5, five design pages, nine-story cut, all Draft in Notion. A "bulletproof pass r1" fixed 9 items on F1 and 5 on F4 the same day. Standards left four pending decisions for Josh.

## 2026-08-20 — Gate evidence pack
Vitest + RTL ratified on evidence; Supabase CLI four-rule migration lane recommended (Free tier: no backups, manual dump before destructive DDL, one deploy channel); the `/evaluate` and `Recommendation*` naming calls marked pure taste. Awaiting Josh's sign-off.

## 2026-09-19 — Cursor joins
Josh installed Cursor 3.21 with the Notion and Figma plugins. Bridge decided: `AGENTS.md` + `.cursor/rules/` as the compiled standards, plan docs as work orders, PRs as the review gate, Notion Task DB as the status truth, a hook as the write fence.

## 2026-10-04 — Rulings: one design-gate round; adversarial critique before every gate
RULING — *"Lets do as you say for 1 design gate round."* Ordinary stories get one round of Josh's review after Bitey's critique; multi-round stays for verdict math, schema, money.
RULING — *"Lets create an adversarial counterpart protocol for you to critique designs as well as implementation on completion. Critique runs should be completed prior to my viewing with logs to communicate what holes were poked where and what the resulting actions were."* → vault `protocol--adversarial-critique`; logs land in `docs/critiques/`.
GENERATED — this harness branch (`chore/agent-harness`): AGENTS.md, CLAUDE.md import, two scoped Cursor rules, the MCP write-fence hook, plan template, this ledger, the attribution footer spec. Critique C1 of the Phase 1 designs launched the same session.

## 2026-10-04 (later) — Harness PR review before merge
Josh asked whether PR #3 was ready. An implementation-mode critique found it was not; three reviewers, one refuter per finding, nothing refuted.
FIXED — the MCP write fence failed open. Cursor sends `tool_input` as a JSON string, and its MCP executor ignores `ask`, so every Notion page update, including full rewrites, passed. The hook now decodes the string, never emits `ask`, allowlists reads per server, and allows a Status-only update only on the page mapped to the checked-out story branch. 29 synthetic cases pass.
FIXED — AGENTS.md: the plan gate (approved design and approved plan, branch created by Bitey), the sequential-stories rule (earlier text carried only "no stacking"), database limits keyed on host, Roles, open rulings with no defaults, Node 22 for every command, `Blocked` reasons go to the Session Log. This ledger's 2026-06-13 entry corrected the same way before merge.
OPEN for Josh — branch protection on `main` (none today; the repo is public), pausing production deploys until the R6 footer lands, and the unauthenticated snapshot POST before the database is unpaused.
FIXED (re-verify round, same day) — an independent re-check closed all ten prior findings and found new ones, now fixed: the fence's trust anchors moved to Cursor-protected `.json` files (`story-pages.json`; a per-branch `active-story.json` that Bitey commits, so an agent-made story branch cannot claim a page), the script's SHA-256 is pinned in `hooks.json` (an edited script fails closed), `page_id` must be one bare ID, `export_video` allowed as a read. AGENTS.md: a checkable plan-approval signal (`plan-approved` label plus a recorded approval line; comments never count because everyone acts as `ayfor`), Node 22 loaded per command (`source ~/.nvm/nvm.sh`), every-agent vs implementer limits, a harness no-edit limit, hostname-only database check across all `.env*`, the snapshot endpoint off-limits for every method, Stage 4d steps assigned, `docs/plans/PR-BODY.md` added. 20 hook cases pass through the full `hooks.json` command.
NOTE — the raw critic files were removed from this branch's tree but remain in its earlier commits; squash-merging PR #3 keeps them out of `main`'s history.
FIXED (Codex review on PR #3, P1) — a Figma server registered under a key without "figma" fell through to the final allow, so `use_figma` passed. The hook now recognizes the official Figma plugin by its tool names as well as its server name, and denies any server that is not Notion, Figma, or one of Cursor's four built-ins. 17 cases pass, including Codex's.

## 2026-10-05 — CI fixed; production paused; endpoint blocked; main protected
FOUND — every Vercel deployment since April failed before building with "Resource provisioning failed": the Vercel Marketplace Supabase store `sb-mox-market` was suspended (free-tier pause). No build-command override existed; the earlier dashboard-build-step theory was wrong.
RULING — Josh resumed Supabase, then *"go ahead with all three"*: (1) production paused via the Ignored Build Step (production builds skipped; previews build); (2) a Vercel Firewall rule denies `/api/prices/snapshot` (its GET guard is skipped because `CRON_SECRET` was never set, and its POST has no auth); (3) the merged harness branch redeployed as a preview, Ready in 58s.
RULING — Josh created the `main protection` ruleset: PR required, force push and deletion blocked, no bypass. Required approvals set to 0 after Bitey flagged that 1 would lock a single-account repo. Josh still merges.

## 2026-10-05 — C1 rulings and the apply pass
RULING — Josh answered the six Phase 1 shape rulings directly (*"1 - build the history nw · 2 - option A · 3 - go with recommendation · 4 - A · 5 - Esper Sentinel · 6 - A"*, then *"go with C"* for the demo) and *"For remainder, proceed with recommendations"*. Overrides of the recommendation: C1.04 (build the history pipeline now), C1.08 (printing selector story), C1.13 (keep the $74.99 demo link).

| Ruling | Question | Decision | How decided |
|---|---|---|---|
| C1.01 | Migration lane: Prisma Migrate vs Supabase CLI | **A** | recommendation accepted |
| C1.04 | Does Phase 1 build a price-history source? | **A** | Josh, overriding the recommendation |
| C1.05 | Empty/thin history: recommendation or insufficient_data | **B** | recommendation accepted |
| C1.06 | Result route shape and /sample fate | **A** | Josh, matching the recommendation |
| C1.07 | Two Phase 1 definitions (action-file DoD vs Notion cut) | **A** | Josh, matching the recommendation |
| C1.08 | Printing selector in Phase 1, and etched | **A** | Josh, overriding the recommendation |
| C1.09 | High-confidence threshold and window anchor | **A** | recommendation accepted |
| C1.10 | Trend dead zone | **A** | recommendation accepted |
| C1.11 | Cap on trend shift and stacked widening | **A** | recommendation accepted |
| C1.12 | F3 density axis | **A** | recommendation accepted |
| C1.13 | Esper Sentinel canonical demo | **C** | Josh, overriding the recommendation |
| C1.14 | Recommendation badge palette | **A** | recommendation accepted |
| C1.15 | Global abuse breaker for anonymous writes | **A** | recommendation accepted |
| C1.28 | Log writes only from actions, never renders | **A** | recommendation accepted |
| C1.39 | Timed-out log write must still commit | **A** | recommendation accepted |
| C1.40 | Buy/Fair/Wait vs Task DB 'hold' | **A** | recommendation accepted |
| C1.41 | Integer basis points vs float deltas | **A** | recommendation accepted |
| C1.42 | rawKind column | **A** | recommendation accepted |
| C1.43 | Per-story Notion tasks vs protocol amendment | **B** | recommendation accepted |
| C1.44 | Recent Evaluations list (split from C1.33) | **A** | recommendation accepted |
| C1.45 | /import and /about nav tabs (split from C1.29) | **B** | recommendation accepted |
| C1.46 | Box printings as default (split from C1.26) | **A** | recommendation accepted |
| C1.47 | shockAnnotation while Tier 2 is dark (split from C1.37) | **A** | recommendation accepted |
| C1.48 | Keep S1.3 or fold into S1.2 (split from C1.64) | **B** | recommendation accepted |
| C1.49 | Standards pending-decisions list is stale | **A** | recommendation accepted |
| C1.63 | Parallel lanes vs 'sequential stories only' | **A** | Josh, matching the recommendation |
| C1.65 | Free-text PII retention | **A** | recommendation accepted |

GENERATED — all staged and held fixes plus the ruling edits applied to the Notion Phase 1 pages and vault notes, each page snapshotted first, independently verified, then two consistency fix-up passes. New pages: Design F0 and stories S0.1–S0.3 (price-history pipeline), S2.2 (attribution footer), S2.3 (printing selector), S2.4 (entry points), and a Task DB task for the pipeline. All Draft, awaiting Josh's one gate round. Open at the gate: F0 Open Question 1 (cron GET carve-out) and F2's printing=<id> param.

## 2026-10-05 (later) — Josh's gate comments
RULING — *"/evaluate is the entry form, /sample can be used to dev UI but is retired once we are able to query specific cards."* Recorded on Standards decision 1, F2 and S2.4.
RULING — *"yes [use] scryfall ID to diff card printings"*: F2 Open Question 1 resolved; `printing=<scryfall card id>`.
RULING — *"lets do a narrow exception in this case"*: F0 Open Question 1 resolved. Vercel Cron only calls with GET, so a cron route may write on GET only when it fails closed on `CRON_SECRET` (500 unset, 401 missing or wrong, constant-time compare). Only `/api/prices/sync-mtgjson` (S0.3) today; any new cron route needs the same guard and a line in Standards §Conventions.

## 2026-10-07 — Board rulings (another Bitey session)
RULING — R01: Mox Phase 1 runs undated, story by story. R02: all four gate briefs ratified; on the Mox Standards page that reads "the Testing conventions (Vitest + RTL scope) and the migration lane (one history, one tool)", i.e. the four rules applied on Prisma Migrate (C1.01 = A).

## 2026-10-08 — C2 rulings
RULING — *"1 - A, 2 - A, 3 - A, 4 - A, 5 - A"*:
- **C2-B.2 = A:** production resumes only after S2.1, S2.2 and S2.4 are on main and Josh signs off; F0's bulk load (path C) runs the same day.
- **C2-A.2 = A:** until S0.3's cron runs in production, Josh keeps the Supabase free project awake with a read-only query at least every 6 days (calendar reminder every 5 days from 2026-10-09).
- **C2-B.8 = A:** the missing UI strings (submit helper, validation error, selector labels and option template, Normal/Foil, "soon", stale flag) are added to F1's UI-strings table now.
- **C2-B.3 = A:** S2.2 branches from main after S1.1 merges (it needs S1.1's Vitest and RTL).
- **C2-B.11 = A:** a /{card} URL with no price renders the entry form prefilled, with no Scryfall call; no reserved-name list.

## 2026-10-10 — Night run (Josh's overnight directive)
MERGED — S1.1 Engine contract, params & test tooling baseline: F1's typed engine contract and RECOMMENDATION_PARAMS land with Vitest 4 + RTL, ESLint 9, the Node 22 pin, a postgres:16 CI workflow and the 0000_baseline migration behind the prod-migrate guard; adversarial review 8 findings (8 fixed); Codex 1 comment (1 fixed).
MERGED — S2.2 Attribution footer & recommendation disclaimer: one SiteFooter from the root layout renders the three R6 attribution lines and the Fan Content Policy link verbatim from the spec through src/lib/copy/legal.ts (which also holds the recommendation disclaimer for S2.1), and the false per-page footers on /evaluate and /sample are gone, with production still paused (C2-B.2); adversarial review 6 findings (6 fixed); Codex 0 comments (none to fix).
MERGED — S1.2 Basic price-only Buy / Fair / Wait recommendation: computeRecommendation() lands as pure integer-cent functions in src/lib/recommendation/ with strict integer-bp bands (C1.41 = A), insufficient_data below 7 window snapshots (C1.05 = B), depth-based confidence, every F1 descriptive signal on exact BigInt sums and slopes, and the foil fallbackNotice, and F1's worked examples A–G, A-rising, D-buy and D0 pass as fixtures, with D5, D6, D8, D9 and D11 recorded in the plan as choices Josh can overturn; adversarial review 8 findings (8 fixed); Codex 1 comment (1 fixed).
MERGED — S1.3 Explanation copy lock + params guardrail: every F1 reason template, clause and notice and every F2 UI string is now a frozen constant with one source (recommendation/copy.ts, recommendation/ui-copy.ts, copy/legal.ts), one forbidden-phrase list lint-tests every copy module and every reason the engine assembles, and RECOMMENDATION_PARAMS and PARAMS_VERSION (46ec1cd7) are pinned together in one inline snapshot that a CI run cannot rewrite, with no math or param change (C1.48 = B) and the singular history line (S1.3d15) left for Josh; adversarial review 9 findings (8 fixed, 1 pinned as locked copy for Josh's ruling); Codex 0 comments (no review: usage limit, none to fix).
MERGED — S2.1 Live recommendation on the evaluation page: /[card]?price=&finish= now renders as an async server component that resolves the card and F2's default printing on Scryfall, runs S1.2's engine on the server with S1.3's locked copy and the recommendation disclaimer directly below the reason line, reads history only through a PriceHistoryReader whose default empty implementation keeps every card at insufficient_data until S0.1 supplies the real reader (pivot: F0 still Draft), adds CardCombobox over GET /api/cards/autocomplete, and deletes the Math.random client mock and Recent Evaluations, with S2.1d23 (foil default) and S2.1d24 (thousands-only commas) left as choices Josh can overturn; adversarial review 8 findings (8 fixed); Codex 0 comments (no review: usage limit, none to fix).
