# C1 — Consolidated findings (Mox Market V2 Phase 1 designs)

Scope: Standards (Stage 0), Feature Breakdown (Stage 1), Designs F1–F5, Stories S1.1–S5.2. Six critics (A–F), adversarial verification (source + consequence lenses). Consolidated 2026-10-04.

**Counts:** 87 surviving findings → **66 clusters**: 3 blocker · 36 major · 25 minor · 2 nit. **Actions:** 43 FIX · 23 RULING · 0 DISMISS · 0 DEFER (deferrals noted inside clusters). 3 findings refuted.

Severity follows the consequence lens where one voted, otherwise the source lens, otherwise the critic. Old text below is quoted as the verifiers saw it; the executor must confirm each string on the live Notion page before replacing. New ACs say "add AC" without a number; renumber once at the end (C1.64).

**Apply order.** Fixes that wait on a ruling: C1.03 ← C1.01 · C1.20 ← C1.04 · C1.27, C1.29 ← C1.06 · C1.26, C1.30 ← C1.08 · C1.23 (fixture C, param value) ← C1.09, C1.10 · C1.25, C1.36, C1.56 ← C1.10, C1.11, C1.41 · C1.32 ← C1.05 · C1.33 ← C1.14, C1.44 · C1.60 ← C1.15, C1.42 · C1.58 ← C1.48.

## Index

| cid | sev | action | title | members | targets |
|-----|-----|--------|-------|---------|---------|
| C1.01 | blocker | RULING | Migration lane: Prisma Migrate vs Supabase CLI | A.5, E.1 | Standards, S1.1, S5.1, GateBriefs, Protocol, Repo |
| C1.02 | blocker | FIX | R6 footer and recommendation disclaimer have no owner; shipped footer copy is false | A.1, C.2, F.2 | Standards, Breakdown, F2, S2.1, new S2.2, Repo |
| C1.03 | blocker | FIX | Baseline migration and prod-safety guards | F.6 | S1.1, S5.1, Standards, Repo |
| C1.04 | major | RULING | Does Phase 1 build a price-history source? | A.2, C.1, F.1, D.11 | Breakdown, Standards, F2, F3, F5, S2.1, S3.1, S3.2, ActionFile, Repo |
| C1.05 | major | RULING | Empty/thin history: recommendation or insufficient_data | B.3 | F1, F2, S1.2, VaultSpec, Methodology |
| C1.06 | major | RULING | Result route shape and /sample fate | A.3, C.7, F.3 | Standards, F2, S2.1, F7, S7.1, ActionFile, GateBriefs, Repo |
| C1.07 | major | RULING | Two Phase 1 definitions (action-file DoD vs Notion cut) | F.8 | ActionFile, Breakdown, S2.1, F2, Standards |
| C1.08 | major | RULING | Printing selector in Phase 1, and etched | F.5 | S2.1, F2, Breakdown, ActionFile |
| C1.09 | major | RULING | High-confidence threshold and window anchor | B.6 | F1, S1.1, S1.2, Methodology |
| C1.10 | major | RULING | Trend dead zone | D.3 | F3, F1, S3.1, S1.2, VaultSpec |
| C1.11 | major | RULING | Cap on trend shift and stacked widening | D.9 | F3, S3.1, VaultSpec |
| C1.12 | major | RULING | F3 density axis | D.6 | F3, S3.2, F1 |
| C1.13 | major | RULING | Esper Sentinel canonical demo | B.7 | F1, F2, ActionFile, Repo |
| C1.14 | major | RULING | Recommendation badge palette | C.13 | F2, S2.1, Repo, ActionFile, DesignLanguage |
| C1.15 | major | RULING | Global abuse breaker for anonymous writes | E.3 | F5, S5.1, S5.2, Standards |
| C1.16 | major | FIX | `npm run lint` does not exist on Next 16 | A.4 | Standards, S1.1, Repo |
| C1.17 | major | FIX | Local dev DB and env contract | A.9 | Standards, S1.1, Repo |
| C1.18 | major | FIX | Stale Auth.js addendum | A.6 | Standards, Phase 2+ pages |
| C1.19 | major | FIX | Production serves V1; deploy pre-flight unowned | C.3 | Standards, F2, ActionFile, Breakdown, Repo |
| C1.20 | major | FIX | Data-reality statement (split from C1.04) | — | Standards, Breakdown, F2 |
| C1.21 | major | FIX | Foil fallback belongs to the caller | B.1 | F1, F2, S1.1, S1.2, S2.1 |
| C1.22 | major | FIX | History series contract: asOf, one row per UTC date, per-finish rows | B.2, D.10 | F1, F3, F2, S1.2, S2.1, Repo |
| C1.23 | major | FIX | F1 signal definitions and complete param list | B.5, D.5, D.13, F.9, B.12 | F1, F3, S1.1, S1.2, S3.1, S3.2 |
| C1.24 | major | FIX | Tier-1 canonical reason strings and rounding | B.4, F.7, B.9, B.10 | F1, F3, S1.3, S1.2 |
| C1.25 | major | FIX | Reason frames when the shift crosses zero | D.8 | F1, S1.3, F3, S3.1 |
| C1.26 | major | FIX | Default printing rule | B.8, C.5 | F1, F2, S2.1, Repo, Vault |
| C1.27 | major | FIX | Result surface data flow | C.4 | F2, S2.1, Repo |
| C1.28 | major | FIX | Log writes only from actions, never renders | A.12, E.2, F.13 | Standards, Breakdown, F5, F2, S5.1 |
| C1.29 | major | FIX | Entry points rewired | C.6 | S2.1 / new story, F2, Repo |
| C1.30 | major | FIX | Card search: no autocomplete exists; new route needed | C.10 | F2, S2.1, Standards, Repo |
| C1.31 | major | FIX | Staleness clock | C.8 | F1, F2, S2.1, Repo |
| C1.32 | major | FIX | Database unreachable path | C.9 | F2, S2.1, Repo |
| C1.33 | major | FIX | Remove Math.random verdicts from /evaluate | C.11 | S2.1, F2, Repo |
| C1.34 | major | FIX | Tier 2 formula drops Buy-side asymmetry | D.1 | F3, VaultSpec, S1.1 |
| C1.35 | major | FIX | volWiden starts at CV 0, not 0.15 | D.2, B.13 | F3, S3.2, F1, VaultSpec |
| C1.36 | major | FIX | S3.1 AC-2 rising fixture | D.4, F.4 | S3.1, F1, S1.1, S1.2 |
| C1.37 | major | FIX | Dark-launch engine API | D.7 | F3, F2, S3.1, S3.2, F5 |
| C1.38 | major | FIX | F4 uses printing-level fields; phantom fallback | E.4, A.11, E.9 | F4, S4.1, Breakdown, Repo |
| C1.39 | major | FIX | Timed-out log write must still commit | E.5 | F5, S5.1 |
| C1.40 | minor | RULING | Buy/Fair/Wait vs Task DB "hold" | A.8 | Breakdown, Standards, F1, TaskDB |
| C1.41 | minor | RULING | Integer basis points vs float deltas | F.10 | F1, S1.2, S3.1, F3 |
| C1.42 | minor | RULING | rawKind column | E.11 | F5, S5.1, S3.1, F3 |
| C1.43 | minor | RULING | Per-story Notion tasks vs protocol amendment | F.12 | Protocol, StoriesDB |
| C1.44 | minor | RULING | Recent Evaluations list (split from C1.33) | — | S2.1, F2, Repo |
| C1.45 | minor | RULING | /import and /about nav tabs (split from C1.29) | — | S2.1, Repo, DesignLanguage |
| C1.46 | minor | RULING | Box printings as default (split from C1.26) | — | F2, S2.1 |
| C1.47 | minor | RULING | shockAnnotation while Tier 2 is dark (split from C1.37) | — | F3, S3.1, S3.2 |
| C1.48 | minor | RULING | Keep S1.3 or fold into S1.2 (split from C1.64) | — | S1.3, S1.2 |
| C1.49 | minor | FIX | Standards pending-decisions list is stale | A.10 | Standards |
| C1.50 | minor | FIX | F4 classifier purity and thresholds | E.8 | F4, S4.1 |
| C1.51 | minor | FIX | Stale stack claims and header dates | A.13 | Standards, Breakdown, S1.1, Repo |
| C1.52 | minor | FIX | Input and URL-param validation | C.14 | F2, S2.1, Repo |
| C1.53 | minor | FIX | Verification harness and evidence rules | A.14, C.15, F.11 | Standards, S1.1, S2.1, S5.1, Repo |
| C1.54 | minor | FIX | All user-facing strings in the locked copy module | C.16, D.14 | F1, F2, F3, S1.3, S2.1, S3.1 |
| C1.55 | minor | FIX | Shock move definition and tooltip | D.12 | F3, F1, S3.2, Methodology |
| C1.56 | minor | FIX | Boundary fixtures that can actually be equal | D.15 | S3.1, S3.2 |
| C1.57 | minor | FIX | Fixture coverage and superseded spec examples | B.11 | S1.2, F1, VaultSpec |
| C1.58 | minor | FIX | S1.3 AC-4 is tautological | B.14 | S1.3 |
| C1.59 | minor | FIX | Competitive-format chip copy | E.7 | F4 |
| C1.60 | minor | FIX | F5 Prisma model block | E.10 | F5, S5.1 |
| C1.61 | minor | FIX | paramsVersion mechanism | E.12 | F5, S5.1, F1 |
| C1.62 | minor | FIX | Disagree action result shape | E.13 | S5.2, F5 |
| C1.63 | minor | FIX | Parallel lanes vs "sequential stories only" | F.14 | Standards, S3.1, StoriesDB |
| C1.64 | minor | FIX | AC hygiene | B.15, F.15 | F1, S1.1, S1.2, S1.3, S2.1 |
| C1.65 | nit | RULING | Free-text PII retention | E.15 | F5 |
| C1.66 | nit | FIX | F4 dependency header; null category semantics | E.14 | F4, S4.1, F5 |

---

## Blockers

### C1.01 — Migration lane: Prisma Migrate vs Supabase CLI · blocker · RULING
**Rationale.** Standards decision 4 says "via Prisma migration … applied to prod only via the normal deploy path"; the gate brief (2026-08-20) recommends the Supabase CLI lane; AGENTS.md:88 says "Do not author a migration until this is ruled", which stops S5.1, S5.2 and the S1.1 baseline (C1.03). The "normal deploy path" applies nothing: build is `prisma generate && next build`, vercel.json holds only the cron. Schema policy is Josh's.
**Ruling.** Which tool owns Mox schema history? **A** Prisma Migrate (`prisma/migrations`, schema.prisma authoritative) with the gate brief's four rules translated: one committed migration file per change; local proof by `prisma migrate reset`/`migrate deploy` on an empty local DB; one prod channel = Josh's laptop running `prisma migrate deploy` over `POSTGRES_URL_NON_POOLING` before merging the PR that needs it (never the Vercel build, never an agent); `pg_dump` (or `supabase db dump --db-url`) before destructive DDL; rollback note plus expand/contract. **B** Supabase CLI lane; schema.prisma becomes a `prisma db pull` mirror. **Recommend A:** the schema is already Prisma 7 with `migrations.path` configured, no `supabase/` directory exists, and AGENTS.md and the protocol already name Prisma commands.
**After the ruling.** Standards §Pending 4: delete "applied to prod only via the normal deploy path" and move the four rules into §Conventions as "one history, one tool". Record in docs/llm/WORKLOG.md. AGENTS.md:88 drops the hold.
**Members.**
- A.5: the four rules are written for Supabase CLI; the repo has no migration history, so first `migrate deploy` fails P3005; Free tier has no backups.
- E.1: three sources disagree on the lane; `migrate dev` with the README `.env` offers to reset prod.

### C1.02 — R6 footer and recommendation disclaimer have no owner; shipped footer copy is false · blocker · FIX
**Rationale.** R6 (2026-07-25) makes the attribution footer a V2 ship-blocker, and the action file (line 42) puts it in the DoD. No Phase 1 page or story owns the three footer lines or the legal §5.2 disclaimer, and AGENTS.md lets Cursor build only from approved pages, so nobody lands it. The shipped footers say "CardKingdom and CardMarket. Updated every 4 hours", but the cron runs daily (`0 6 * * *`) and the UI shows only TCGplayer prices. Use the wording in `docs/specs/attribution-footer.md` (chore/agent-harness 569ca60), which substitutes "Recommendations" for "Verdicts". Do not paste pack A.2 verbatim.
**Fix.**
1. Stories DB, new story **S2.2 "Attribution footer & recommendation disclaimer"** (Feature F2, Order 1.5). Description: "One SiteFooter rendered from src/app/layout.tsx on every route. Strings imported from docs/specs/attribution-footer.md; vendor the file in this PR if chore/agent-harness is unmerged." ACs:
   - The three footer lines from docs/specs/attribution-footer.md render verbatim on /, /evaluate and /sample. A snapshot test imports the strings from the spec file.
   - "Fan Content Policy" links to https://company.wizards.com/en/legal/fancontentpolicy.
   - The per-page footers at evaluate-client.tsx:337–343 and sample/decision-analysis.tsx:768–771 are deleted. No rendered page contains "CardKingdom", "CardMarket" or "Updated every 4 hours".
   - Plain visible text, with no hover, expand or modal.
   - Footer and panel copy contain none of "trust our", "proven", "guarantee that", "guaranteed accura". "guaranteed" appears only when preceded by "not ".
   - If C1.06 retires /sample, assert the redirect instead of the /sample footer.
   - Notes: "Explicit carve-out from '/sample untouched' for the footer string only. Must merge no later than S2.1 and before any V2 production deploy."
2. S2.1, add AC: "The recommendation disclaimer from docs/specs/attribution-footer.md renders inside the panel directly below the badge for every kind, including insufficient_data (snapshot test)."
3. S2.1 AC-7: replace `("prices via Scryfall (TCGplayer)")` → `("Market price via Scryfall (TCGplayer), updated daily")`.
4. F2 §UI: replace `Data footer — source ("Scryfall/TCGplayer, daily")` → `Data footer — source ("Market price via Scryfall (TCGplayer), updated daily")`. Add the bullet "Recommendation disclaimer directly below the reason line, always visible (S2.1). R6 site footer lives in layout.tsx (S2.2)."
5. F2 and S2.1: replace "/sample remains untouched" → "/sample remains untouched except the footer string removed by S2.2".
6. Breakdown F2 scope: append "Ships the R6 site footer and recommendation disclaimer (S2.2; S2.1 disclaimer AC)." §Goals: add "Phase 1 is shipped only when S2.2 is on production."
7. Standards §Conventions: add "Legal copy comes verbatim from docs/specs/attribution-footer.md; never paraphrase." Add a Phase 1 exit criterion (phase-level, not per-story DoD): "Every route renders the site footer and the result surface renders the recommendation disclaimer, both from docs/specs/attribution-footer.md."
**Members.**
- A.1: neither Standards nor Breakdown owns the R6 footer or the §5.2 line, and the shipped footer claims are false.
- C.2: F2 and S2.1 specify only a source label, not the mandated lines; three different strings exist for one obligation.
- F.2: no story owns the footer or disclaimer; S2.1 puts TCGplayer-branded prices on screen.

### C1.03 — Baseline migration and prod-safety guards · blocker · FIX (apply after C1.01; text written for option A)
**Rationale.** `prisma/` holds only schema.prisma, and prod was built with `db push`, so the first `migrate deploy` fails with P3005 unless a baseline exists. prisma.config.ts resolves `POSTGRES_URL_NON_POOLING` first, and README:47 fills that variable with prod. AGENTS.md:76 bans `migrate deploy` and `db push` against prod but not `migrate dev` or `migrate reset`, which offer to reset a Free-tier database that has no backups. The consequence lens rated this a blocker because story text alone cannot prevent it; repo guards are needed. Prisma 7.5 removed `--to-schema-datamodel`.
**Fix.**
- S1.1, add AC: "prisma/migrations/0000_baseline/migration.sql is generated with `npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script` from the schema as it stands before any new model. `prisma migrate deploy` against an empty local Postgres creates tracked_cards, price_snapshots, the index and the FK (integration test)."
- S1.1, add AC: "README Database Setup replaces `npx prisma db push` with the migrate flow and documents Josh's one-time prod step: (a) `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma` reports no difference; (b) `npx prisma migrate resolve --applied 0000_baseline`."
- S1.1, add AC: "prisma.config.ts refuses migrate commands against hosts matching *.supabase.co or *.pooler.supabase.com unless ALLOW_PROD_MIGRATE=1 is set (unit test on the guard)."
- AGENTS.md:76 (chore/agent-harness): add `prisma migrate dev` and `prisma migrate reset` to the commands forbidden against POSTGRES_* or Supabase URLs.
- S5.1 AC-1: replace "migration creates the table from an empty DB (`migrate deploy` integration test)" → "`0001_recommendation_log` is additive (CREATE TABLE only). `migrate deploy` from an empty DB applies 0000 then 0001 (integration test). Josh applies 0001 on prod with `migrate deploy` before merging the S5.1 PR (PR-template checkbox)." Notes: add "Blocked until the S1.1 baseline is merged and Josh has run the prod `migrate resolve`."
- Standards §Conventions: "Schema stories are serialized. S5.1 is the only Phase 1 schema story unless C1.04 or C1.15 adds one."
- If C1.01 = B: the baseline uses `supabase db pull` plus `supabase migration repair --status applied`, and local proof uses `supabase db reset`.
**Members.**
- F.6: there is no baseline and no owner for `migrate resolve`; the gate brief and the stories assume different tools.

---

## Majors — rulings

### C1.04 — Does Phase 1 build a price-history source? · major · RULING
**Rationale.** price_snapshots is V1's wide row (usd/usdFoil/eur/eurFoil/tix, no etched). The cron reads tracked_cards, whose only writer was deleted in cb4737d, so every newly evaluated card has zero history. The MTGJson pipeline (action file B2–B7) and the Aug 5 DoD ("real verdicts … for the populated MTGJson subset") appear in no story. The consequence lens rated this major, not blocker: F1 and S1.2 AC-4 already render an honest low-confidence result on current price alone. That makes it a scope call. Side effect: F3's dark launch logs nothing informative until history accrues.
**Ruling.** Does Phase 1 build a history source? **A** Yes, MTGJson F0 (narrow schema, bulk ingest, `0 17 * * *` sync) as gated story S2.0 before S3.1. This is the Aug 5 intent. It adds 2–3 stories and needs C1.01 ruled, a dump before the destructive table replace, and Supabase unpaused with about 340 MB free. **B** No bulk pipeline. Ratify a current-price-only launch plus a write-through accrual floor: each user-submitted evaluation upserts tracked_cards through a lib function extracted from `snapshotSpecificCards` (in-process, never the unauthenticated POST), deduped per card per UTC day and capped (for example 5,000 tracked cards; C1.15 limits). The existing 06:00 UTC cron then builds history: medium confidence at 14 days, high at 28–30. MTGJson moves to a Phase 2 lane. **C** Ship as designed with no accrual, so every card stays low confidence. **Recommend B:** it needs no schema change and is not blocked by C1.01, the design already renders thin data honestly, and a phase that has slipped four times needs the smallest loop that ships. Pick A only if you re-affirm the Aug 5 MTGJson DoD, which turns this into a re-plan.
**After the ruling.**
- Under B: S2.1 (or a small story after it), add AC: "a user-submitted evaluation of an untracked printing upserts tracked_cards at most once per UTC day; the cap is enforced (fixtures)". F3 W2, add "the dark-launch comparison is uninformative until ~14–30 days of accrual". Action-file DoD per C1.07.
- Under A: add F0 to the Breakdown, S2.0 stories to the Stories DB, and a ninth Task DB entry. Order: S1.1 baseline → S2.0 → S3.1.
- Either way, apply C1.20.
**Members.**
- A.2: no feature builds history; the cron reads a frozen tracked_cards; the finish key does not exist in the table.
- C.1: an arbitrary card on /evaluate has zero history; the MTGJson ingest is in no Phase 1 artifact.
- F.1: no story builds history; F3 never activates; F5 calibrates noise.
- D.11: first-time cards read as thin data for weeks; calibration assumes thin data is the exception.

### C1.05 — Empty/thin history: recommendation or insufficient_data · major · RULING
**Rationale.** F1 lists "minSnapshotsForVerdict 1" yet says an empty history still yields a verdict. F2 W1 says "no/insufficient history → insufficient_data panel". Spec §3/§8 say insufficient_data. The action file, the research note and the public-methodology note say fewer than 7 snapshots → insufficient_data. The r1 reversal was Bitey's own unrecorded change. The answer depends on C1.04.
**Ruling.** With fewer than 7 snapshots and a valid market price, does a card get Buy/Fair/Wait? **A** Yes, at any history: minSnapshotsForVerdict 0, confidence low, and F2 shows a "provisional" chip instead of a bare badge below 7 snapshots. **B** No: insufficient_data below 7 snapshots (action file A2/E2, research §9, /about methodology text). **Recommend A if C1.04 = B** (otherwise every launch-day card is refused), **B if C1.04 = A**. Also confirm: a missing or ≤0 market price → insufficient_data, never a throw (the spec §3/§4E side, which F1 already takes).
**After the ruling.** Align everything in one pass:
- F1: the param, the confidence bullet, and "Decisions baked in" (name the superseded spec §7 row 3 and §8 rows 8–9).
- S1.2 AC-4, second clause.
- F2 W1 edge "no/insufficient history → `insufficient_data` panel".
- Spec §2/§8, and public-methodology lines 197/240/280.
- Under A, also add the thin-data clause to the buy/fair templates when snapshotCount30d < 14, with zero-history copy "no price history yet for this printing" replacing "only 0 days of price history".
**Members.**
- B.3: three artifacts disagree on empty history; the param says 1 while the behaviour says 0; the reversals are unrecorded.

### C1.06 — Result route shape and /sample fate · major · RULING
**Rationale.** The action file ruled `/[card]` and retiring /sample on 2026-05-01 (retirement conditional on /[card] going live). Spec §12 puts the engine in the /[card] page, and merged evaluate-client already pushes `/${name}?price=` to a route that does not exist. Meanwhile F2's "Decisions baked in" says "/evaluate is the live surface", Standards decision 1 reopens both questions, and F7/S7.1 assume `/evaluate?card=`. That is four shapes, and a "Decisions baked in" item, so it needs Josh.
**Ruling.** Where do results render? **A** `/[card]?price=&finish=` as an async server component. /evaluate stays the entry form, the / form targets the result route, and /sample is retired (redirect per C1.13) once /[card] serves. **B** `/evaluate?card=&finish=&price=` renders the panel in place. This overturns the 2026-05-01 "too form-y" ruling, and /sample then needs its own re-ruling. **Recommend A:** it honours three recorded sources, and the merged code already navigates there. It requires changing the F7/S7.1 share URL.
**After the ruling.**
- Standards decision 1: record the answer and delete "(or is retired at Josh's discretion)".
- Name the route in F2 (header, Decisions baked in, Open Questions), S2.1 (description, AC-1), AGENTS.md:85, F7 and S7.1 AC-1.
- Under A, F2 adds: "Static routes win over [card]. A pre-Scryfall guard (≤141 chars, printable charset) calls notFound(). Future top-level routes must be static segments."
**Members.**
- A.3: /evaluate pushes to a nonexistent /[card]; / posts to static /sample; the decision is hedged against the recorded ruling.
- C.7: the design works under neither surface answer; it reopens the 2026-05-01 retirement ruling.
- F.3: three-way unresolved result surface; no story builds the route or rewires the forms.

### C1.07 — Two Phase 1 definitions · major · RULING
**Rationale.** The action-file DoD (lines 149–153) wants the full bento, no hardcoded Esper Sentinel constants, /sample retired, and a 3-card smoke test. The Notion cut ships a four-tile panel and keeps /sample. Its non-goals list none of the dropped items, and the action file's "Cut from Phase 1" list (:67) contradicts the cut, which includes F5 and the selectors.
**Ruling.** Are the Notion Breakdown and Stories the Phase 1 scope document, with the action file rewritten to match? **A** Yes. Confirm the panel-first cut, and:
- Add D2 (card name/set/image per R3/R4) to S2.1.
- List chart, prices-by-finish tile, range-bar visual and actions tile under Breakdown non-goals → Phase 2.
- Rewrite action-file DoD lines 149–153 and the :67 cut list.
- Add a closing checklist (not a story): clean-clone bootstrap (protocol line 170) and a production smoke test on 3 cards (chase rare, bulk card, Reserved List).

**B** The bento DoD stands; add stories for D2/D5/D6/D7/D8 and the C2/C3 refactor. **Recommend A:** action file :36 already scopes Phase 1 to the 8 Task DB tasks the cut covers, and the bento adds four or more stories to a phase that keeps slipping.
**Members.**
- F.8: the action-file DoD requires the full bento and /sample retired; the cut delivers a panel and keeps /sample.

### C1.08 — Printing selector in Phase 1, and etched · major · RULING
**Rationale.** S2.1 AC-5/AC-10 and F2 W2 pull in the multi-printing picker that the action file deliberately cut (:67, :160). No selector UI exists on main.
**Ruling.** Does Phase 1 ship a printing selector? **A** Yes, as a separate story S2.3 after S2.1 (F2 W2 and S2.1 AC-5 move there). **B** No. S2.1 resolves the name, picks the default printing server-side (C1.26), and adds a normal/foil toggle on the form passed as `?finish=`. The printing selector moves to the Phase 2+ Breakdown. Under either option, etched is hidden in Phase 1 because no stored series has an etched column. **Recommend B:** it honours the recorded cut, keeps S2.1 to one PR, and AC-5's never-blend test means little while per-printing history is nearly empty (C1.04).
**After the ruling (B).**
- F2 §Functionality: "set + finish selectors" → "finish toggle (normal/foil)". Strike set switching from W2.
- F2 Fields row "set | select | printings of resolved card" → "set | derived | default printing (C1.26)".
- Move S2.1 AC-5 to the Phase 2+ Breakdown. AC-10 stays.
**Members.**
- F.5: S2.1 absorbs a picker the action file cut, on top of ten other ACs; it is not one PR.

### C1.09 — High-confidence threshold and window anchor · major · RULING
**Rationale.** With a 30-date window, "30 → high" means every day must be present. One missed cron demotes every card for 30 days, and before the daily sync today's row is always missing. The MTGJson investigation (line 404) already recommended softening the threshold to 28.
**Ruling.** What counts as high confidence? **A** At least 28 of the trailing 30 UTC dates (new param highConfidenceSnapshotCount: 28; medium 14–27). The window is the 30 UTC dates ending at asOf − 1, so today's not-yet-synced row never counts. **B** Keep 30/30, anchored at today. **C** Keep 30/30 and explain it in the chip tooltip. **Recommend A:** it confirms an existing vault recommendation and stops one missed run from downgrading the whole catalogue.
**After the ruling.** S1.2 AC-3 → "<14 low; 14–27 medium; ≥28 high". The value goes into the C1.23 param list. Public-methodology lines 136/207 carry the same number.
**Members.**
- B.6: high confidence requires 30/30 attendance; it is unreachable before the daily sync and lost for 30 days after any miss.

### C1.10 — Trend dead zone · major · RULING
**Rationale.** Example C's slope of −0.4 %/day is below the ±0.5 %/day label threshold, so it reads "flat", yet S3.1 AC-1 wants "falling 12%" and a −6 shift. The shift has no dead zone: at +0.45 %/day the card is labelled "flat" but its thresholds still shift by +6.75.
**Ruling.** Does trendThresholdPct gate the shift as well as the label? **A** Dead zone: shift = 0 when |slope30dPct| < trendThresholdPct, with label and shift decided by the same test. Re-pin example C at −0.6 %/day (−18 %/30d). **A′** Ramped dead zone: effective monthly trend = sign(m)·max(0, |m| − 30 × trendThresholdPct). **B** Keep the shift continuous and lower the threshold to 0.1 %/day. **Recommend A:** one test makes every shifted recommendation explainable. A′ quietly retunes trendShiftFactor. A's step at the threshold is bounded to one band width if C1.11 = A.
**After the ruling.** Re-pin example C in F1, S3.1 AC-1, spec §2, Example C and the §8 fixture `30d_falling_12pct`. trendThresholdPct and minSnapshotsForTrend move into the F1 params (C1.23).
**Members.**
- D.3: example C is "flat" under its own threshold while AC-1 demands "falling 12%"; the threshold gates only the label.

### C1.11 — Cap on trend shift and stacked widening · major · RULING
**Rationale.** F3 applies the shift "un-capped": at +60 %/30d an ask up to +21.67 % over market is a Buy. A steady slope moves only 10–14 % in 7 days, so the shock annotation (≥35 %) never fires. volWiden 2.0 × confWiden 1.5 = 3.0× gives Buy < −25 % and Wait > +15 %. F3 says "un-capped" explicitly, so changing it needs Josh.
**Ruling.** Cap the Tier 2 adjustments? **A** Clamp trendShift to ±fairBand (the trend moves the band at most its own width) and cap wideningFactor = min(volWiden × confWiden, 2.0). **B** Keep un-capped, as F3 is written. **C** Reopen the 2026-04-25 annotation-not-override ruling and zero the shift when a shock is detected. **Recommend A:** the problem is magnitude, not direction. It keeps trend-following and bounds the worst recommendation.
**After the ruling (A).**
- Re-pin S3.1 AC-1 in the same PR: shift −6 clamps to −5, giving thresholds −13.33 / 0.
- Correct F3 W1 "shock annotation will accompany it", which is false for steady slopes.
- Update spec §3 Tier 2.
- C1.25's "but" frames become unreachable.
**Members.**
- D.9: the monster-trend shift is uncapped and widening stacks to 3×, so Buy fires 21 % over market.

### C1.12 — F3 density axis · major · RULING
**Rationale.** In F1's fixed 30-date window, density < 50 % is the same as count ≤ 14, which F1 already makes low (except at exactly 14). Staleness is the only new information. S3.2 says "<50%" in one place and "≤50%" in another. Daily cron rows measure our cron's attendance, not trading liquidity.
**Ruling.** What does F3's third axis measure? **A** Drop density. The axis becomes freshness: utcDay(asOf) − latest.date > staleDays (7) → confidence capped at low. **B** Keep a recent-density rule (rows in the last 14 UTC days / 14 < 0.5 → low) alongside staleness. **Recommend A:** density over our own cron rows is not liquidity, and B adds a param pair for a narrow case.
**After the ruling.**
- Add staleDays 7 (plus recentWindowDays/minRecentDensity under B) to F3's table and RECOMMENDATION_PARAMS. asOf comes from C1.22.
- S3.2 Description and AC-3: use one inequality ("<").
- AC-3 fixture under A: "≥14 rows, latest 8 days old → low; latest 7 days old → medium". Under B: 16 rows, 6 in the last 14 days, latest today → low; control with 7 recent rows → medium.
**Members.**
- D.6: density duplicates the count tiers; the inequality, denominator and clock are unstated.

### C1.13 — Esper Sentinel canonical demo · major · RULING
**Rationale.** −7.99 % > −8.33 %, so the $74.99 demo is Fair under the locked bands. On the live route it would be judged against Scryfall's current price ($59.17 on 2026-10-04), so ?price=74.00 shows Wait. Nobody has ruled that the flagship demo flips.
**Ruling.** What is the canonical demo? **A** Drop the fixed-price demo link; the landing form is the demo. **B** Derive the demo link server-side (ask = floor(market × 0.9), always a Buy). **C** Keep ?price=74.99 and accept a result that floats with the market. **Recommend A:** any fixed price drifts with the market. Do not tune buyThresholdAsymmetry to fit a demo.
**After the ruling.**
- F1 row A: add "formerly the $74.99 handoff demo, which is Fair under 5%/0.6".
- Under A: remove the canonical URL from action file :105/:183, and send the /sample redirect (C1.06) to the entry form.
- If /sample survives, decision-analysis.tsx:780 → 74.00 and :788 bands → locked bands.
**Members.**
- B.7: the fixture was shaved to $74.00 without noting that the demo, /sample and the canonical URL now show Fair.

### C1.14 — Recommendation badge palette · major · RULING
**Rationale.** F2 says "Buy (Emerald) / Fair (neutral/Gold) / Wait (Sapphire) … never red for Wait". tokens.css ships Fair = Sapphire and Wait = Ruby, and "Gold" is not a V2 token. The design-language note contradicts itself (L76–78 vs L138). Standards already makes the existing tokens canonical.
**Ruling.** Which tokens color the badge? **A** tokens.css as shipped: Buy `--verdict-buy` (Emerald), Fair `--verdict-fair` (Sapphire), Wait `--verdict-wait` (Ruby). Reword "never red" to "Ruby is the brand accent, not an alarm color". **B** Design-language L76–78: Fair Grey Olive, Wait White @ 50 %. This needs a Standards exception to "tokens canonical" and a tokens.css edit in S2.1. **Recommend A:** Standards makes existing tokens canonical, and the Jul 25 Figma library and design-language L138 already use Emerald/Sapphire/Ruby.
**After the ruling.**
- F2 §UI: replace "Buy (Emerald) / Fair (neutral/Gold) / Wait (Sapphire) per the jewel palette; never red for Wait" with the chosen mapping, naming the three `--verdict-*` tokens.
- S2.1 AC-2: "palette per design: no red" → "badge uses --verdict-buy/--verdict-fair/--verdict-wait for buy/fair/wait (RTL asserts per kind)".
- Edit the losing source: design-language L76–78 under A; L138 and action file L109 under B.
**Members.**
- C.13: four sources disagree on the colors, and "Gold" is not a token, so AC-2 cannot be tested.

### C1.15 — Global abuse breaker for anonymous writes · major · RULING
**Rationale.** The in-memory token bucket is per instance on Vercel, so the "global daily breaker" is not global and has no threshold, storage or AC. The real unbounded write is one log row per compute: at 10 req/s that is about 864k rows a day against a 500 MB Free tier. F5 has no disagree timestamp, so a disagree cap cannot count on created_at.
**Ruling.** How are anonymous writes bounded? **A** Keep the per-cookie disagree bucket in memory, documented as "per-instance, best-effort". Add a DB-backed daily breaker: one day-keyed `abuse_counters(day PK, log_writes, disagrees)` row updated by INSERT … ON CONFLICT … RETURNING, checked before each log write and each disagree against LOG_DAILY_CAP and DISAGREE_DAILY_CAP. The caps live in an ops const (`src/lib/ops/limits.ts`). When tripped: skip the write, render normally, warn once per instance. The same caps bound C1.04 accrual writes. **B** Accept hobby-scale exposure and write "both limits are per-instance and reset on cold start" into Decisions baked in. **Recommend A:** one counter row is O(1) and atomic, and it closes the only unbounded anonymous write.
**After the ruling (A).**
- The counter table joins the S5.1 migration (C1.60).
- Standards and AGENTS.md:50: "Every tunable lives in one exported RECOMMENDATION_PARAMS" → "Every engine tunable…", so ops caps stay out of the engine.
- S5.1/S5.2 add a breaker AC: when tripped, no row is written and the panel renders with no row id.
**Members.**
- E.3: the per-instance bucket and "global" breaker are not global; no threshold; log writes are uncapped.

---

## Majors — fixes

### C1.16 — `npm run lint` does not exist on Next 16 · major · FIX
**Rationale.** package.json has `"lint": "next lint"`, and Next 16.1.6 removed that command. No ESLint config is installed. DoD 5 fails on every story. ESLint is the only option consistent with Standards, which already names Prettier for formatting.
**Fix.**
- Standards Commands row `Lint | npm run lint | exists` → status "lands S1.1", note "script is `next lint`, removed in Next 16; S1.1 repoints it to `eslint .`". Make the same edit at AGENTS.md:39.
- Standards DoD 5 "Lint + build green" → "Lint + build green (lint from S1.1 on; until then build green — `next build` type-checks)".
- S1.1 Description: add "ESLint 9 flat config (eslint.config.mjs) with eslint-config-next@16.1.6; `lint` script → `eslint .`". Add AC: "`npm run lint` exits 0 on the baseline."
- If a typecheck script is wanted, use `next typegen && tsc --noEmit`.
**Members.**
- A.4: `next lint` was removed in Next 16; no ESLint is installed; DoD 5 fails from day one.

### C1.17 — Local dev DB and env contract · major · FIX
**Rationale.** "local Postgres (dev)" has nothing behind it: `.gitignore` has `.env*` with no exception, there is no .env.example, and src/lib/prisma.ts silently falls back to "". F5 writes, migrations and integration tests have nowhere to run. Keep the existing env var names, which Vercel's Supabase integration already uses.
**Fix.**
- Standards §Stack: "Supabase Postgres (prod) / local Postgres (dev)" → "Supabase Postgres (prod) / local Postgres (dev), provisioned per C1.01: Prisma lane → Docker Postgres 16 (`docker compose up db`) or `supabase start`; Supabase lane → `supabase start`. Env vars keep their names: POSTGRES_PRISMA_URL (pooled runtime) and POSTGRES_URL_NON_POOLING (migrations); local values point at the local DB."
- S1.1: `.gitignore` gains `!.env.example`. A tracked .env.example lists POSTGRES_PRISMA_URL, POSTGRES_URL_NON_POOLING and CRON_SECRET with local placeholders. src/lib/prisma.ts replaces `?? ""` with a thrown "POSTGRES_PRISMA_URL unset".
- S1.1, add AC: "Onboarding contract (template §10): README Getting Started works from zero, including DB provision and migrate; the clean-clone check passes with no steps beyond the README."
- Standards §Testing: the copied test-report.mjs warns on a missing POSTGRES_PRISMA_URL, not DATABASE_URL.
- Compile vault template §10 into docs/plans/TEMPLATE.md on chore/agent-harness.
**Members.**
- A.9: the dev DB is asserted without support; no .env.example; env reads disagree; nowhere to run migrations or tests.

### C1.18 — Stale Auth.js addendum · major · FIX
**Rationale.** The gate brief §Mox P2+ (Aug 20) excludes Auth.js (never stable, maintenance mode) and keeps the suite convention unchanged. The addendum still proposes Auth.js and makes it suite-wide. The brief is a recommendation, so keep "proposed". Three Phase 2+ pages inherit the stale text.
**Fix.**
- Standards Phase 2+ addendum 1: replace the paragraph from "proposed **Auth.js v5**" through "becomes the studio convention for the suite." with:
  > **Auth provider (F8 prerequisite):** proposed **Supabase Auth** per the gate brief (§Mox P2+, 2026-08-20), using `@supabase/ssr` server-side sessions. **Auth.js excluded** (v5 never shipped stable; maintenance mode since Sept 2025). **Clerk is the documented upgrade path** (bcrypt export/import; Supabase third-party-auth). **App-specific; the suite convention is unchanged.** Prisma connects as one DB role (`src/lib/prisma.ts`), so RLS and `auth.uid()` do not apply to Prisma queries. User-owned tables are scoped in the app layer (`where: { userId }`); RLS is defense-in-depth only. Ratify at the Phase 2+ gate.
- Apply the same correction to the Phase 2+ Feature Breakdown F8 line (394a7227e26f81bf9d22d1da7252b265), Design F8 Accounts (394a7227e26f814fa0b6d797e105eb2f) and story "Accounts baseline" (394a7227e26f817397bfccbcbc704aa2).
**Members.**
- A.6: the addendum proposes Auth.js and a suite convention, both overturned by the Aug 20 gate brief.

### C1.19 — Production serves V1; deploy pre-flight unowned · major · FIX
**Rationale.** On 2026-10-04, mox-market.vercel.app served the V1 dashboard, /evaluate and /sample returned 404, and /api/prices/history returned 500 (Supabase paused). Nothing merged since March has deployed, and no story or checklist owns the pipeline. The consequence lens rated it major: the implementer is not misled, but Josh could plan as if merge means shipped.
**Fix.**
- Standards decision 1: "PR #2 (merged 2026-06-19) added a live `/evaluate` page" → "PR #2 (merged 2026-06-19) added `/evaluate` on main (merged, not deployed: production served V1 as of 2026-10-04)".
- F2: "`/evaluate` is the live surface" → "the target surface (route per C1.06)".
- Standards Pending: append "Deploy pre-flight (owner Josh, ~15 min, before S1.1): checklist in actions/action--mox-market-v2.md §Pre-sprint actions."
- Action file §Pre-sprint actions, add this checklist:
  - (a) Vercel Git: repo = ayfor/mox-market and Production Branch = main.
  - (b) Read the last production deployment log, and check that the Node pin is ≥ 20.9 and matches S1.1's .nvmrc/engines.
  - (c) Un-pause Supabase.
  - (d) Confirm POSTGRES_PRISMA_URL and CRON_SECRET on Vercel.
  - (e) `/api/prices/history` → 400, then `?cardIds=x` → 200 `{"history":{"x":[]}}`.
  - (f) Confirm the 06:00 UTC cron ran once after the un-pause.
  - (g) A throwaway PR produces a preview deployment; record the result.
- Breakdown §Goals, Phase 1 close item: "production serves the result surface with the R6 footer; smoke test 3 cards."
- AGENTS.md "Known state of main": add "Production serves V1, not main; Phase-0 ops item, Josh."
- Do not add a Vercel-preview evidence requirement to S2.1; the implementer cannot touch Vercel.
**Members.**
- C.3: production still serves V1 and the DB is paused; no story owns the deploy pipeline.

### C1.20 — Data-reality statement (split from C1.04) · major · FIX
**Rationale.** Whatever C1.04 decides, three gate pages describe history that does not exist, so Josh would approve a scope that cannot deliver.
**Fix.**
- Standards §Stack: "Deployment: Vercel, daily cron snapshots price history to Supabase" → "Deployment: Vercel. The V1 daily cron (06:00 UTC) snapshots only cards in tracked_cards (the V1 watchlist set, frozen since 2026-04-25); evaluated cards have no history until the C1.04 source lands."
- Standards §Conventions: "Snapshots keyed by `(scryfall_id, finish)`" → "History is addressed by `(scryfall_id, finish)`. In the current wide table that is a column choice: usd for normal, usdFoil for foil, no etched."
- Breakdown F2: "computed from live Scryfall price + history" → "computed from the live Scryfall price plus any stored history (none for most cards at launch; C1.04)".
- F2 §Functionality: "fetches current price + history (existing scryfall.ts + price-history tables)" → "fetches the current price (scryfall.ts) and any stored history from price_snapshots (wide rows: usd/usdFoil, no etched)". Add "Expected launch-day state: most recommendations are low confidence, with three history tiles '—'."
**Members.** None directly; split from C1.04 (A.2, C.1, F.1, D.11).

### C1.21 — Foil fallback belongs to the caller · major · FIX
**Rationale.** F1 tells the engine to fall back from foil to normal, but MarketSnapshot carries one price and one history, so a pure engine can only return insufficient_data. S1.2 AC-5 cannot be implemented as written.
**Fix.**
- F1 MarketSnapshot: add `appliedFinish: 'normal' | 'foil' | 'etched'`. Do not add requestedFinish; `RecommendationInput.finish` already is the requested finish.
- F1, add rule: "The caller sets appliedFinish to the requested finish if that Scryfall price (usd/usd_foil/usd_etched) is non-null, else normal. normal never falls back. If the normal price is also null, pass currentPriceCents: null. `signals.fallbackNotice = market.appliedFinish !== input.finish && kind !== 'insufficient_data'`."
- F1 W1 step 2: delete "(after finish fallback)". Insert step "1b. Caller builds MarketSnapshot: selects appliedFinish and loads history for that finish."
- S1.2 AC-4: delete "(after finish fallback)".
- S1.2 AC-5 → "Given finish 'foil' and MarketSnapshot { appliedFinish: 'normal', currentPriceCents: <normal> }, the recommendation computes on the supplied price and fallbackNotice = true. With appliedFinish === finish it is false. On insufficient_data it is false."
- S1.1 AC-1 types include appliedFinish.
- S2.1, add AC: "Fixture with usd_foil null and foil requested → the snapshot carries the normal price, appliedFinish 'normal' and normal-finish history. Fixture with usd null, usd_foil present and normal requested → insufficient_data (no reverse fallback)."
**Members.**
- B.1: the engine gets one price and one history, so it cannot perform the foil→normal fallback that AC-5 requires.

### C1.22 — History series contract · major · FIX
**Rationale.** A pure engine has no clock, so "trailing 30 UTC days" has no anchor. price_snapshots allows several rows per day (createMany on both the cron GET and an unauthenticated POST), so counts and confidence can inflate. Each wide row holds usd and usdFoil together, so a foil series must skip rows with null usdFoil.
**Fix.**
- F1 MarketSnapshot: add `asOf: string` — the UTC date of the request, passed by the caller. The engine never reads the clock.
- F1 §Functionality: "use the trailing 30 UTC days" → "use the 30 UTC dates ending at the anchor defined in C1.09 (relative to asOf)".
- F1, add invariant: "history holds at most one entry per UTC date. The engine first keeps the latest entry per date (idempotent). Entries outside the window are ignored, never validated."
- F1 Fields: "0–365 entries" → "any length; only the window is read". Market-data problems never throw.
- F2 / S2.1 adapter text: "select price_snapshots rows whose price column for appliedFinish is non-null (usd → normal, usdFoil → foil); map timestamp to UTC date; keep the latest row per date; convert to integer cents at the adapter."
- S1.2, add fixture: 3 entries on one date → snapshotCount30d = 1. S2.1, add AC: a row whose price for the finish is null is never counted.
- Repo (S1.1): POST /api/prices/snapshot requires CRON_SECRET (no V2 caller remains).
**Members.**
- B.2: no window anchor; no per-day dedupe; ownership of entries over 365 unstated.
- D.10: no uniqueness per day; one row holds both finishes; counts are implementation-defined.

### C1.23 — F1 signal definitions and complete param list · major · FIX
**Rationale.** S1.2 AC-7 asserts exact signal values that F1 never defines. trendDirection needs trendThresholdPct and minSnapshotsForTrend, which are filed as "F3 params dark". No CV minimum is given, "30 → high" is a literal rather than a param, and slope/interpolation are claimed by both S1.2 and S3.1. On std: population std is chosen (the verified B.5 correction) over the critic's sample std in D.13.
**Fix.**
- F1: add a **Signal definitions** block. All series are deduped per C1.22.
  - `median30dCents`: lower median for even counts (integer). Null below minSnapshotsForRange (14).
  - `range30dCents {low, high, avg}`: avg = Math.round(mean). Null below 14.
  - `rangePosition` = clamp((askingCents − low)/(high − low), 0, 1). Null when high === low or below 14.
  - `slope30dPct`: OLS slope of priceCents on UTC-day index over the window, interpolating linearly across gaps for this computation only (W1), ÷ window mean × 100. Source: public-methodology §Signal 2; F1 wins where that note differs (it still says trendShiftFactor 0.3). `slope7dPct` is the same over the last 7 dates. Both null below minSnapshotsForTrend (7).
  - `monthlyTrend` = slope30dPct × 30, regardless of row count.
  - `volatility30d`: population std / mean over real, non-interpolated rows. Null below minSnapshotsForVolatility (14), which gives volWiden 1.0.
  - `trendDirection`: rising iff slope30dPct > +trendThresholdPct, falling iff < −trendThresholdPct, else flat. Null below minSnapshotsForTrend. How the threshold gates the shift is decided in C1.10.
- F1 params, replacing "…lowConfidenceSnapshotCount 14, plus the F3 params dark": add trendThresholdPct 0.5, minSnapshotsForTrend 7, minSnapshotsForVolatility 14, and highConfidenceSnapshotCount (value per C1.09). Change the confidence bullet "30 → high" to "≥ highConfidenceSnapshotCount → high". S1.1 AC-2 lists the same params.
- F1 fixture C: list the 30 values. Linear 8464 → 7536 in −32 steps gives OLS −32 ÷ mean 8000 = −0.4000 %/day; replace "CV 0.07" with 0.035. If C1.10 = A, re-pin at −0.6 %/day: 8696 → 7304 in −48 steps.
- S1.2 AC-7: add slope7dPct, plus an A/B assertion that rangePosition is null at zero width. Move S3.1 AC-5 (gap interpolation) to S1.2.
- S3.1 description "least-squares 30-day slope (gap interpolation, ≥7 snapshots else null)" → "applies trendShift = monthlyTrend × trendShiftFactor using the slope S1.2 computes; adds the trend clause".
- F3 references F1 definitions instead of restating them.
- S3.2 AC-2: assert volatility30d === null for fixture D.
**Members.**
- B.5: AC-7 demands exact signals F1 never defines; trend params are mis-filed as dark.
- D.5: the slope denominator and convention are unstated in F1/F3 (the definition exists in the methodology note).
- D.13: no CV minimum or std definition; AC-2's 1.5 depends on it.
- F.9: slope and interpolation are owned by two stories; no volatility minimum; slope7dPct is missing from AC-7.
- B.12: the high-confidence 30 is a literal, not a param.

### C1.24 — Tier-1 canonical reason strings and rounding · major · FIX
**Rationale.** The canonical examples carry "trend is flat", which no tier can produce: the clause is F3-only and has no flat arm. The fair example drops "market" compared with its own template. "of the 30-day market average" is false, because delta is measured against today's price. The rounding rule is unstated. Strike "trend is flat"; F1's own rule is "secondary if compelling".
**Fix.**
- F1 copy table, fair template: "Within {X}% of the 30-day market average{; trend clause}." → "Within {X}% of market{; trend clause}." Record in the F1 revision note as a deliberate deviation from spec §6 (delta is computed against currentPrice).
- Buy canonical: "9% below market; trend is flat." → "9% below market."
- Fair canonical: "Within 2% of the 30-day average; trend is flat." → "Within 2% of market."
- Strike the "{; range clause}" placeholder from the buy template; no row defines it.
- Add rule row: "X = Math.round(Math.abs(deltaPct)). If X === 0 the fair sentence is 'At market price{; trend clause}.'" Add fixture: 8130 vs 8150 → −0.25 % → "At market price."
- Relabel column "Canonical example" → "Tier-1 canonical (S1.3)". Move Tier-2 examples (C's "falling 12%") to F3.
- Fixtures: Tier-1 reasons are asserted exactly; the substring column is kept for Tier-2 only.
- S1.3 AC-3: "reasons for examples A, B, and E match the F1 copy table verbatim" → "assembled Tier-1 reasons equal exactly: A and C '9% below market.'; B 'Within 2% of market.'; D '19% above market; only 6 days of price history.'; E the copy-table insufficient_data sentence."
**Members.**
- B.4: the canonical examples are unreachable at any tier; "trend is flat" has no template.
- F.7: S1.3 AC-3 cannot be satisfied; no rounding rule; the two forbidden-phrase lists differ.
- B.9: "of the 30-day market average" misstates what X measures.
- B.10: the rounding rule is unwritten; "Within 0%" is possible.

### C1.25 — Reason frames when the shift crosses zero · major · FIX (apply after C1.11)
**Rationale.** A shifted threshold allows a Wait at a negative delta and a Buy at a positive one, so the templates would emit "−0.5% above market". The fair band can also extend past ±bandPct, giving "Within 9%" in a 5 % band. F3 W1 promises "states both facts", which the locked table cannot express.
**Fix.**
- F1 copy table, fair row: "Within {X}% of market{; trend clause}." when |delta| ≤ bandPct; otherwise "{X}% {below/above} market{; trend clause}." This applies under any C1.11 outcome.
- If C1.11 = B (uncapped), also add:
  - wait-below: "{X}% below market, but the 30-day trend is falling {Y}%."
  - buy-above: "{X}% above market, but the 30-day trend is rising {Y}%."
  - The frame is selected by kind × sign of delta, never by trendDirection. Y = Math.round(|monthlyTrend|). A "but" template consumes the single trend-clause slot.
  - Fixtures: C-history with ask 8100 → wait, "1% below market, but the 30-day trend is falling 12%."; +60 %/30d with a +20 % ask → buy, "20% above market, but the 30-day trend is rising 60%."
- If C1.11 = A, the "but" frames are unreachable (buy threshold < 0 < wait threshold always). Add only the fair row and a fixture with −9.20 % Fair under example C → "9% below market; 30-day trend is falling {Y}%."
- S1.3 owns the strings; S3.1 owns the fixtures.
**Members.**
- D.8: the templates hard-code below/above, so shifted thresholds produce false or absurd reasons.

### C1.26 — Default printing rule · major · FIX
**Rationale.** cardId is already a Scryfall printing, so setCode is redundant and has no precedence rule. "Non-promo" is undefined, and ScryfallCard lacks promo/finishes. On live data, `order=usd` returns the most expensive promo first with null prices interleaved, which contradicts the JSDoc. Print lists paginate at 175. Three vault definitions disagree.
**Fix.**
- F1: delete the Fields row "setCode | string? | valid set for card | optional | cheapest non-promo" and, in §Functionality, "optional `setCode` (defaults to the cheapest-by-USD non-promo printing)". Revision note: "printing = cardId; deviates from spec §1 VerdictInput per the spec's own L36 comment".
- F2: replace "cheapest non-promo" (Fields set default) and "defaults: cheapest non-promo, normal" (W1 step 2) with "defaults: selectDefaultPrinting(prints, finish) (§Default printing), finish normal". Add **§Default printing**:
  - Fetch prints via the resolved card's `prints_search_uri`, following `next_page` until `has_more` is false.
  - Candidates: `promo === false && set_type !== 'promo' && digital === false && finishes includes the mapped finish (normal→nonfoil, foil→foil, etched→etched) && that finish's price (usd/usd_foil/usd_etched) is non-null` (box per C1.46).
  - Pick the minimum price; on a tie, the earliest released_at.
  - No candidate → use the named-lookup card and let the C1.21 fallback apply.
  - Server order is a hint only.
- Repo: add `promo`, `finishes` and `prints_search_uri` to ScryfallCard (src/types/scryfall.ts). Add a pure helper `selectDefaultPrinting` in src/lib/printings.ts. Rewrite the getPrintings JSDoc to "Scryfall lowest-known-USD order, nulls interleaved; callers filter and sort".
- S2.1 AC-10: "cheapest-by-USD non-promo printing … fixture card with promo + non-promo printings" → "selectDefaultPrinting applies the F2 predicate verbatim. Fixture = the Esper Sentinel print list (sld 2123 foil-only, pmh2 promo, plst, mh2 328, h2r, mh2 12, j21 digital) → normal mh2 12 ($59.17), foil mh2 12 ($76.47). A paginated fixture (has_more true) is followed."
- Vault: mark notes/software--mox-market-workflows.md Procedure 3 "DEFAULT to most recent standard printing" as superseded. Fix the resolveCard() citation in mtgjson investigation G2.
**Members.**
- B.8: setCode vs cardId has no precedence; "non-promo" is undefined; live order picks the most expensive promo.
- C.5: the rule is unimplementable against live Scryfall; the type lacks fields; a third definition exists in the vault.

### C1.27 — Result surface data flow · major · FIX (route name per C1.06)
**Rationale.** F2 says "page/server action" without choosing, and /evaluate is a client page that mocks the result. "No new API surface needed" is false. A searchParams-driven RSC with Suspense is the only shape that satisfies RSC-first, "ships with HTML", the W2 recompute and AC-8 together. Logging is kept out of render (C1.28).
**Fix.**
- F2 §Functionality: replace the sentence beginning "Server-side: page/server action resolves card" and the clause "no new API surface needed beyond the existing route handlers" with:
  > The result page is an async server component. It validates searchParams → `<Suspense key={paramsKey} fallback={<PanelSkeleton/>}>` → async panel → `loadMarketSnapshot()` (Scryfall and Prisma called directly; never self-fetch /api/prices/*) → `computeRecommendation()`. The form and finish control only `router.push` new params inside `useTransition`; the key unmounts the previous panel (S2.1 AC-8). Render never writes to the DB (C1.28). The one new route handler is GET /api/cards/autocomplete (C1.30).
- S2.1 AC-1 stays testable under this model.
**Members.**
- C.4: "page/server action" is unresolved; the existing handlers neither resolve nor compute.

### C1.28 — Log writes only from actions, never renders · major · FIX
**Rationale.** F5 says "Never on … any bot-reachable GET", and F2 says "one per compute, not per render". Under a GET-rendered result page both can hold only if the write happens in an action. A single-action rule would also forbid F9's scheduled job, so the rule is "non-GET entry points". This is implied by F5's own trigger list, so it is a FIX (F.13's option (a)).
**Fix.**
- Standards §Conventions: add "No DB writes during RSC render or in GET route handlers. Writes happen in Server Actions or non-GET handlers."
- F5 §Functionality, after the trigger list, add: "Log writes originate only from non-GET entry points: the `logRecommendation` Server Action, which the client invokes after a user submit or finish switch (it recomputes server-side from the submitted params, never trusting a client kind, and returns the row id for the disagree control), and, in Phase 2, F9's scheduled job. Never from a page render, prefetch, share-link open or GET handler. The session cookie is set only inside actions."
- Breakdown F5: "server-side write on every computed recommendation" → "server-side write once per user-submitted evaluation".
- F2: "every computed recommendation writes an F5 log row (one per compute, not per render)" → "each user-submitted evaluation writes one F5 log row via logRecommendation; renders never log".
- S5.1 AC-2: "each computed recommendation on `/evaluate` writes exactly one row" → "each logRecommendation invocation writes exactly one row".
- S5.1, add AC: "any GET render of the result surface, with or without params, writes zero rows (integration test)".
- Result route metadata: `robots: { index: false }`.
**Members.**
- A.12: a write "on every computed recommendation" fires during GET renders; "compute" is undefined.
- E.2: the trigger rule assumes the server can tell a submit from a GET; F2 leaves the mechanism open.
- F.13: GET-rendered results make every crawler hit a log row.

### C1.29 — Entry points rewired · major · FIX (route per C1.06)
**Rationale.** The landing form (page.tsx:104 `action="/sample"`) posts to a static page that ignores its params, and the /evaluate submit and recent rows push to a dead route. No story owns this, yet the Breakdown claims F2 "closes the MVP loop". Field names `card`/`price` already match.
**Fix.**
- New story "Entry points", sequenced right after S2.1 (number assigned after the rulings).
- The page.tsx:104 form action points at the C1.06 result route.
- The result route normalises price (strip $, commas, whitespace) and validates per C1.52, then resolves the card with getCardByName(name, true). Three fixtures:
  - exact or fuzzy hit → the panel renders;
  - Scryfall 404 type "ambiguous" → form prefilled, "Pick from the suggestions", no compute;
  - not found → form prefilled, "Couldn't find that card".
- Retarget the evaluate-client.tsx navigations at :241, :400 and :413 to the result route.
- AC: "submitting on / lands on the result surface and it computes; /evaluate submit and recent-row click land there too."
- Update AGENTS.md:94 in the same PR. Strings go in copy.ts (C1.54). Nav tabs are decided in C1.45.
**Members.**
- C.6: the front-door form posts to /sample and the nav links 404; no Phase 1 story owns the entry points.

### C1.30 — Card search: no autocomplete exists; new route needed · major · FIX
**Rationale.** V1's card-search.tsx was deleted in cb4737d. The autocomplete() helper has no importers and swallows errors. Browsers cannot set Scryfall's required User-Agent, so a typeahead needs a server route. getCardByName turns every 404 into null, so "ambiguous" cannot be told apart from "not found".
**Fix.**
- F2 §Functionality: "card search (existing autocomplete)" → "card search: CardCombobox (Headless UI) backed by a new GET /api/cards/autocomplete?q= route handler that proxies Scryfall server-side (throttle and User-Agent from scryfall.ts; ≥2 chars, 150 ms client debounce, Cache-Control s-maxage=86400)".
- Repo (S2.1 or the entry-points story):
  - Remove `catch { return [] }` from autocomplete (scryfall.ts:65–67) and getPrintings (:152–154).
  - getCardByName throws a ScryfallApiError carrying the response `type`, so the UI can map "ambiguous" → "Pick from the suggestions".
- Standards §Stack: "existing wrapper with throttle + card cache" → "existing wrapper with server-side throttle and User-Agent; card-cache.ts is V1 localStorage residue, not a server cache".
- S1.1: correct the README:13/:26 descriptions of deleted V1 features.
- If C1.08 = A, a PrintingSelect/FinishSelect (Scryfall "nonfoil" ↔ "normal") lands in S2.3.
**Members.**
- C.10: S2.1 silently absorbs a combobox and selectors that do not exist; "no new API surface" is false.

### C1.31 — Staleness clock · major · FIX
**Rationale.** The current price is fetched live, so fetchedAt always equals now and the 36h flag is dead code. Only stored history can go stale, and an untracked card has no timestamp at all. The window anchor is asOf (C1.22), not this field.
**Fix.**
- F1 MarketSnapshot: rename `fetchedAt` ("Last refreshed (used for staleness flag in UI, not algorithm)") → `latestSnapshotAt: Date | null`. It is the timestamp of the newest price_snapshots row for the card whose price column for appliedFinish is non-null, and null when there is none.
- F2 §UI: "fetchedAt staleness flag when > 36h" → "History line under the source label: 'Price history: {N} snapshots, newest {relative time}'. Stale flag iff latestSnapshotAt !== null && now − latestSnapshotAt > STALENESS_FLAG_HOURS (36; UI consts module, not RECOMMENDATION_PARAMS). When null: 'No price history yet for this printing.'"
- Global banner: one query `MAX(timestamp) FROM price_snapshots` older than 48h → "Price data is temporarily out of date."
- F3's 7-day rule (C1.12) stays an engine param computed from history.
- Leave STALE_MS in evaluate-client.tsx:29 alone (it tracks the age of the user's cached result); add a comment.
- S2.1 AC-7: add the history line and the null case.
**Members.**
- C.8: one fetchedAt, two clocks, plus a no-history case; the design never says which drives the flag.

### C1.32 — Database unreachable path · major · FIX (wording per C1.05)
**Rationale.** A paused Supabase project is the live failure mode on this stack (prod history API 500 today). F2 covers only Scryfall failure. A DB outage must never be shown to the user as "zero days of history".
**Fix.**
- F2 W1, add edge case: "History query rejects or exceeds HISTORY_TIMEOUT_MS (500; exported beside the ops limits, not a magic number) → proceed with history = [] under the C1.05 rule, but replace the thin-data note with 'Price history temporarily unavailable'; log the error server-side. Scryfall failure remains the hard error panel."
- S2.1, add AC: "a fault-injected Prisma rejection and a fault-injected delay past HISTORY_TIMEOUT_MS each render the panel with the unavailable note and no 500 (two fixtures). The F5 write in the same request fails open, so the disagree control is absent."
- Repo (S1.1): wrap the snapshot cron GET in try/catch, return a 500 with a body, and add a heartbeat per investigation G5. Cross-reference: C1.19 checklist (f).
**Members.**
- C.9: no behaviour is defined for an unreachable DB, the stack's live failure mode.

### C1.33 — Remove Math.random verdicts from /evaluate · major · FIX
**Rationale.** evaluate-client.tsx:380 fabricates a market price (price × random 0.85–1.20) and renders Buy/Fair/Wait pills next to the real panel, contradicting F2's "No client-side computation".
**Fix.**
- S2.1: delete the mock market block (evaluate-client.tsx:377–395) and its `/[card]` push (retargeted per C1.29).
- S2.1, add ACs: "`grep -r Math.random src/` is empty" and "no Buy/Fair/Wait pill on the page derives from client-side math".
- Restyle `.mm-pill--wait` per C1.14. The list's fate is decided in C1.44.
**Members.**
- C.11: fabricated pills persist in localStorage and render beside real recommendations.

### C1.34 — Tier 2 formula drops Buy-side asymmetry · major · FIX
**Rationale.** F3 copied spec §3 Tier 2, which the 2026-05-01 propagation skipped. All three fixtures (F1 C −14.33, S3.1 AC-1, S3.2 AC-1 −16.67) require dividing by 0.6.
**Fix.**
- F3 §Functionality: replace "`buyThreshold = −band + shift`, `waitThreshold = +band + shift`" with "`fairBand = fairBandPct × volWiden × confWiden` (subject to C1.11); `buyThreshold = −(fairBand / buyThresholdAsymmetry) + trendShift`; `waitThreshold = +fairBand + trendShift`. Order: widen → apply asymmetry on the Buy side → shift both."
- Expose `signals.buyThresholdPct` and `signals.waitThresholdPct` (S1.1 types; Tier 1 values −8.33 / +5).
- Vault spec §3 Tier 2 (lines 184–185): same correction, plus a §10 propagation note.
**Members.**
- D.1: the formula omits the 0.6 asymmetry that every fixture assumes.

### C1.35 — volWiden starts at CV 0, not 0.15 · major · FIX
**Rationale.** As written, widening starts at CV 0 and saturates at 0.15, which the table calls the CV that "begins widening". Example C (CV 0.07), spec §4A and the S3.x fixtures all assume a gated formula. This changes behaviour for 0 < CV < 0.15 compared with the literal text; it follows every example and the param semantics.
**Fix.**
- F3 volatility bullet: "`volWiden = min(1 + CV/0.15, 2.0)`" → "`volWiden = clamp(CV / volatileCV, 1.0, volatilityWideningCap)`".
- Table meaning for volatileCV: "CV that begins widening" → "CV at which widening begins (1.0×); cap reached at CV = volatilityWideningCap × volatileCV (0.30)".
- Make the same replacement in the S3.2 Description and in vault spec §3 (line 172).
- S3.2, add AC: "CV exactly 0.15 → wideningFactor 1.0, bandPct 5."
- F1 example C's CV comes from the C1.23 series (0.035 → volWiden 1.0).
**Members.**
- D.2: the literal formula saturates at the CV the table says starts widening; the pinned thresholds fail.
- B.13: example C at CV 0.07 gives volWiden 1.467, not the 1.0 its pinned thresholds use.

### C1.36 — S3.1 AC-2 rising fixture · major · FIX (after C1.34, C1.35)
**Rationale.** AC-2 cites "example A history", but F1's A is flat, and under the asymmetric bands AC-1 assumes, −2 % with +8.1 %/30d is Fair. The fixture below holds under C1.10 A or B and under C1.11 A or B; it fails only under A′, in which case re-pin it.
**Fix.**
- F1 canonical table, add **A-rising** (A stays flat): "30 daily snapshots, linear ramp 7304 → 8696 (+48 c/day; OLS ÷ mean 8000 = +0.60 %/day = +18 %/30d; CV 0.052); market 8000; asking 7600 (delta −5.00 %)."
- S3.1 AC-2: "rising-market fixture (example A history) … a −2% delta becomes Buy-eligible" → "A-rising: Tier 1 Fair (−5.00 > −8.33); Tier 2 Buy, reason contains 'rising 18%'. Asserts buyThresholdPct/waitThresholdPct: uncapped +0.67 / +14.00; under C1.11 A −3.33 / +10.00."
- S3.1 AC-1 also asserts the effective thresholds.
**Members.**
- D.4: F1's A is flat, and −2 % stays Fair under the asymmetric bands.
- F.4: AC-1 assumes asymmetry while AC-2 is only true without it; the cited fixture is wrong.

### C1.37 — Dark-launch engine API · major · FIX
**Rationale.** F1's Recommendation has one kind. F3 adds no way for F5 to get both kinds, and its confidence cap, clauses and band signals are not gated by TIER2_ENABLED, so the dark launch would change served output.
**Fix.**
- F3 §Functionality, add "Engine API (dark launch)":
  - `computeRecommendation(input, market, params): Recommendation` keeps its S1.2 signature and is the only thing F2 renders. It returns the Tier 1 result when `TIER2_ENABLED` is off and the Tier 2 result when on.
  - F3 adds `computeTieredRecommendation(...) → { tier1: Recommendation; tier2: Recommendation | null }` (tier2 null only for insufficient_data). F2's server path switches to it in S3.1 to feed F5.
  - When the flag is off, the served confidence, reason, bandPct 5 and wideningFactor 1.0 are Tier 1. The liquidity cap and trend/volatility clauses appear only on tier2. Descriptive signals are F1-owned and identical on both.
  - F5 logs served.kind as `kind` and served.confidence as `confidence`. `adjustedKind` = tier2.kind while off, null while on.
- S3.1 AC-4: "served kind is identical to S1.2" → "with TIER2_ENABLED off, the served Recommendation deep-equals the S1.2 result across the full fixture matrix (kind, confidence, reason, every S1.2 signal, bandPct 5, wideningFactor 1.0)". Add the same clause to S3.2 AC-6.
- Prefix S3.2 AC-2/AC-3 with "on tier2". S3.1 Description: `rawKind` → `adjustedKind`. shockAnnotation is decided in C1.47.
**Members.**
- D.7: no API for raw and adjusted kinds; ungated F3 effects leak into served output while dark.

### C1.38 — F4 uses printing-level fields; phantom fallback · major · FIX
**Rationale.** Scryfall's `released_at` is required and printing-level. No card-level release field exists, and fetching the first printing or the set would break "zero new API calls". So the fallback is fictional and "unknown" is unreachable. `games` is not on the type, but `digital` is. edhrec_rank is optional.
**Fix.**
- F4 Fields source: "set `released_at`" → "`card.released_at` (printing-level, always present)". Apply the same change to §Functionality "age: … from set `released_at`".
- Delete the W1 edge case "`released_at` missing on printing → fall back to card-level release, else `unknown` age".
- F4, add: "Age is the age of the printing being priced, so a 2025 reprint of a 1994 card is recent. A future-dated released_at (preview) → recent, with age clamped at 0. Unparseable → unknown, chip omitted. Classifier input is the Scryfall card object of the printing being priced (the object F2 resolved; never re-fetched). `digital = card.digital`. No edhrec_rank → popularity bucket 'unranked'."
- F4: "`digital` = printing not available in paper per Scryfall `games`" → "`digital` = card.digital".
- S4.1 AC-3: "missing `released_at` falls back card-level, else `unknown`" → "an unparseable released_at yields age: unknown and the age chip is omitted". AC-1: add a future-date fixture.
- Breakdown F4: "age… set release date" → "printing age (card.released_at)".
**Members.**
- E.4: the card-level fallback does not exist without a new call; `unknown` is unreachable.
- A.11: printing age vs card age is undefined; no edhrec null branch.
- E.9: `games` is not on the type; the classifier input object is unstated.

### C1.39 — Timed-out log write must still commit · major · FIX
**Rationale.** The r1 change to "awaited up to 300ms" changed the body but not the Decisions list Josh rules on. On Vercel, the losing insert of a Promise.race is not guaranteed to finish unless it is handed to `after()` (Next 16.1.6). Under plain Vitest, `after()` throws E468.
**Fix.**
- F5 Decisions baked in: "fire-and-forget logging (UX never blocks on the log)" → "log write awaited ≤300 ms; on timeout the same pending insert promise is handed to `after()` from next/server with a `.catch` that logs, so it still commits; UX never blocks beyond 300 ms; never re-issue the insert".
- F5 W1, add edge cases: "timed-out-but-committed rows exist and simply carry no disagree control" and "a timeout is logged as indeterminate, not failed".
- S5.1 AC-5, add: "the write helper takes a `detach` parameter defaulting to `after`. A 500 ms fault-injected write, with the collected detached task awaited, still produces a row."
**Members.**
- E.5: the Decisions list still says fire-and-forget; the timeout path can lose rows without after().

---

## Minors — rulings

### C1.40 — Buy/Fair/Wait vs Task DB "hold" · minor · RULING
**Rationale.** The Task DB, which is the source of truth, says "buy / wait / hold". F1 uses buy/fair/wait, and the Standards addendum reuses "hold" as a sell-side kind. Standards credits Buy–Fair–Wait to "Josh's call 2026-06-01", but that call ruled only "recommendation, not verdict".
**Ruling.** Ratify Buy / Fair / Wait as the buy-side vocabulary (Task DB "hold" = Fair)? **A** Yes. Retitle the Task DB rows, their bodies, and the milestone "V2 MVP Verdict — buy/wait/hold" (projects/active--mox-market.md:15). **B** Adopt "hold" as the buy-side neutral, which re-keys the spec, the F1 enum, the locked copy, Standards and AGENTS.md. **Recommend A:** retitling three Notion rows is cheaper than re-keying four artifacts.
**After the ruling (A).**
- Breakdown F1 "Covers Task DB": restore the full title "Build the basic price-only buy / wait / hold recommendation" and add "(Task DB 'hold' = Fair)".
- Standards provenance "Josh's call 2026-06-01" → "spec vocabulary; ratified at this gate (C1.40)".
- The sell-side `hold` rename is deferred to the Phase 2+ gate (F9 locked only "Sell Now").
**Members.**
- A.8: "hold" means Fair in the Task DB and a sell-side kind in the addendum; no reconciliation.

### C1.41 — Integer basis points vs float deltas · minor · RULING
**Rationale.** S1.2 AC-2 and S3.1 AC-6 assert equality on floats. Shifted thresholds make AC-6 tautological.
**Ruling.** Compare deltas in integer basis points? **A** `deltaBp = Math.round((asking − market) × 10000 / market)`. Thresholds are rounded to whole bp (−833, +500; shifted and widened thresholds rounded before comparing), and "equality → Fair" becomes exact. **B** Keep floats and replace the exact-equality ACs with straddle tests ±1 bp. **Recommend A:** it matches the integer-cents convention and makes both ACs deterministic; the ±1 bp shift at the boundary is negligible.
**After the ruling (A).** F1 adds deltaBp, and the reason's X comes from deltaBp / 100. S1.2 AC-2 boundaries are stated in bp. C1.56 fixtures are re-pinned.
**Members.**
- F.10: exact-equality ACs on float deltas; AC-6 is unfalsifiable.

### C1.42 — rawKind column · minor · RULING
**Rationale.** After the Tier 2 flip, `kind` = Tier 2 and `adjustedKind` is null, so the Tier-1 kind is lost and the spec §9.4 A/B cannot be computed on live data.
**Ruling.** Add `rawKind` (Tier-1 kind, always written)? **A** Yes, rawKind String alongside adjustedKind; kind stays "served". **B** No; record "post-flip comparison out of scope". **Recommend A:** one column now avoids a migration later.
**After the ruling.** Regardless of the answer, F5 states: "S3.1 owns writing adjustedKind; TIER2_ENABLED is defined in F3 (RECOMMENDATION_PARAMS)." Under A, rawKind goes into the C1.60 model block.
**Members.**
- E.11: the post-flip comparison is impossible; the adjustedKind owner is unnamed.

### C1.43 — Per-story Notion tasks vs protocol amendment · minor · RULING
**Rationale.** Protocol Stage 3 requires four Task-DB tasks per story. All 36 are missing, and the Stories DB has no relation to the Task DB.
**Ruling.** **A** Create the 36 tasks and add a Tasks relation on the Stories DB. **B** Amend Stage 3: the Stories Status field (Planning → In Progress → Testing → In Review) replaces per-story tasks, and the 8 Task DB rows stay as the feature-level mirror. **Recommend B:** AGENTS.md already makes Status the one field agents write, and 36 tasks would duplicate it.
**Members.**
- F.12: 0 of 36 required tasks exist; there is no relation property.

### C1.44 — Recent Evaluations list (split from C1.33) · minor · RULING
**Rationale.** The list is a Claude Design handoff element, so removing it is a scope call, not an implied fix.
**Ruling.** Keep the Recent Evaluations list? **A** Remove it in S2.1; it returns with F6/F7. **B** Keep it, persisting the server result under `mm-recent-v3` in F6's entry shape, with a shape-validated hydrate, row click to the result route, and the Wait pill restyled per C1.14. **Recommend A:** smallest S2.1 and no stale client state.
**Members.** None directly; split from C1.33 (C.11).

### C1.45 — /import and /about nav tabs (split from C1.29) · minor · RULING
**Rationale.** Both nav links 404, and the design-language note declares the navbar canonical ("don't redesign on import").
**Ruling.** **A** Remove both tabs. **B** Keep both as aria-disabled, non-navigating "soon" segments. **C** Drop Import and ship a one-paragraph /about stub from the public-methodology note. **Recommend B:** no 404s, and the canonical navbar stays intact.
**Members.** None directly; split from C1.29 (C.6).

### C1.46 — Box printings as default (split from C1.26) · minor · RULING
**Rationale.** 24 of 70 Lightning Bolt printings are set_type "box" (Secret Lair and similar) with promo false, so the predicate keeps them as default candidates.
**Ruling.** May set_type "box" printings be the default? **A** No; "box" joins the exclusion list. **B** Yes, predicate as written. **Recommend A:** the default should be a mainstream printing a user recognises.
**Members.** None directly; split from C1.26 (B.8).

### C1.47 — shockAnnotation while Tier 2 is dark (split from C1.37) · minor · RULING
**Rationale.** F3 calls the annotation "not a verdict change". Whether it shows during the dark launch decides whether served output is literally unchanged.
**Ruling.** **A** Render it regardless of the flag, exempt from the deep-equal. **B** Gate it with TIER2_ENABLED. **Recommend A:** it is a factual statement (tooltip per C1.55), not a recommendation change.
**Members.** None directly; split from C1.37 (D.7).

### C1.48 — Keep S1.3 or fold into S1.2 (split from C1.64) · minor · RULING
**Rationale.** S1.3 is a remnant of a Notion task. Its threshold confirmation is already in S1.2 AC-1/2. What is unique to it is copy.ts, the forbidden-phrase lint and the params guardrail.
**Ruling.** **A** Fold those into S1.2 as extra ACs. **B** Keep S1.3, retitled "Explanation copy lock + params guardrail", with "confirm thresholds" dropped. **Recommend B:** copy is a taste call, and a separate small PR lets you review the strings in minutes while S1.2 stays about the math.
**Members.** None directly; split from C1.64 (F.15).

---

## Minors — fixes

### C1.49 — Standards pending-decisions list is stale · minor · FIX
**Rationale.** Item 3 (test stack) has an evidence-ratified answer in the gate brief. Item 4 goes to C1.01. Open items are missing, and the money unit appears only in the Phase 2+ addendum, although integer cents is the studio convention.
**Fix.**
- Standards: turn Pending 3 into §Testing text: "Vitest 4.x (pinned; v5 RCs in flight) + RTL for units and components; async Server Components are E2E-or-untested by policy (gate brief §Mox P1)."
- §Conventions: add "Money: integer cents end to end in the engine contract; Scryfall string prices are parsed once at the boundary with Math.round(Number(p) * 100)."
- Replace the pending list with pointers to: C1.06 (route), C1.01 (migration lane), C1.04 (history source), C1.05 (thin history), C1.40 (vocabulary), and the C1.19 deploy pre-flight.
**Members.**
- A.10: items 3/4 have gate-brief answers that are not reflected; real open items are missing.

### C1.50 — F4 classifier purity and thresholds · minor · FIX
**Rationale.** A wall-clock comparison either makes the classifier impure or makes the fixture rot after six months. "6 months" and "top-1000" have no exact boundaries.
**Fix.**
- F4: signature `classify(card: ScryfallCard, now: Date): CardCategory` (now = asOf from the caller).
- F4, add params to RECOMMENDATION_PARAMS: recentPrintingDays 183, edhrecTop1Rank 1000, edhrecTop2Rank 5000, modernEraStart '2003-07-28'.
- F4: "`recent` (< 6 months from set release)" → "ageDays < recentPrintingDays". Ranks use `rank <= 1000` and `rank <= 5000`.
- S4.1 fixtures pin `now`.
**Members.**
- E.8: hidden clock in the classifier; undefined boundaries.

### C1.51 — Stale stack claims and header dates · minor · FIX
**Rationale.** Several stack claims are not exercised by V2:
- Headless UI, Recharts, Zustand and @vercel/postgres have no V2 importers.
- card-cache is localStorage-only.
- "display conversion exists" is false for V2.
- The header date range is past and conflicts with the Task DB.
**Fix.**
- Standards §Stack, replacing the "Headless UI 2; Recharts 2…" line: "present in package.json; V2 code exercises only Next/React/Tailwind/Prisma/Scryfall. Unused V1 residue (recharts, zustand, @vercel/postgres, src/lib/currency.ts, src/lib/card-cache.ts, src/store/watchlist.ts; headlessui unless C1.30's combobox adopts it) is removed in S1.1 or re-adopted by the story that needs it."
- Breakdown non-goals: delete "display conversion exists".
- Breakdown header: delete "Jun 1 – Jul 31" (the Notion Task DB owns dates).
**Members.**
- A.13: unused dependencies are presented as stack; a client-only cache is presented as server; stale dates.

### C1.52 — Input and URL-param validation · minor · FIX
**Rationale.** 74.99 × 100 = 7498.999… in JS. An engine throw would become a 500. Once params travel in the URL, card/set/finish are attacker-controlled strings that each trigger Scryfall calls.
**Fix.**
- F2 Fields, asking price: "number input, > 0, ≤ 100,000, 2dp, client + server validation" → "text input; normalise (strip $, commas, whitespace); must match ^\d{1,6}(\.\d{1,2})?$, > 0 and ≤ 100000; cents = Math.round(Number(s) * 100); the server re-validates and renders the inline error (never a 500) on InvalidRecommendationInputError".
- F2: "URL params: finish ∈ {normal, foil, etched}; set ^[a-z0-9]{2,6}$; card ≤ 141 printable chars; all rejected before any Scryfall call."
- S2.1 AC-9, add fixtures: "$74.99" → 7499; "74.999", "1e3" and "0" are rejected; a 200-char card is rejected with no Scryfall call.
**Members.**
- C.14: no string→cents rule; engine errors are not mapped; URL params are unbounded.

### C1.53 — Verification harness and evidence rules · minor · FIX
**Rationale.** Several harness pieces are missing:
- DoD 4 cannot be met by non-UI stories.
- The protocol lists CI as a prerequisite, but none exists.
- S2.1's async-RSC ACs have no harness.
- S5.1's integration test has no database.
- RTL is not landed.
**Fix.**
- Standards DoD 4: "Functional evidence captured against each AC" → "Functional evidence captured against each AC (UI stories: preview-driven screenshots/logs; engine/tooling stories: the test-report section covering the AC plus command output)".
- S1.1, add ACs:
  - "RTL + jsdom configured with an environment glob for *.test.tsx".
  - "A GitHub Actions workflow runs lint, build and npm test on PRs".
- S5.1 Notes: "Integration tests run against the local DB from C1.17, reset per run; never a POSTGRES_* prod URL."
- S2.1, add a Verification block:
  - Unit (Vitest): selectDefaultPrinting (AC-10), the snapshot adapter including finish isolation, input validation (AC-9), the staleness predicate (AC-7).
  - Component (RTL): skeleton and clear-on-submit (AC-8); panel states by props (AC-2/3/4/6).
  - Server logic is extracted into a pure `buildEvaluation()` with Scryfall mocked, for AC-3/4/5.
- S2.1 AC-1: "verified via RSC payload" → "the engine entry imports 'server-only' and the build passes; manual `curl -H 'RSC: 1'` evidence".
- S2.1 Notes: "S2.1 is the e2e-worthy UI story; Playwright yes/no is decided at its 4a plan gate."
**Members.**
- A.14: non-UI stories cannot "drive" ACs; DoD 4 needs an evidence rule.
- C.15: S2.1 has no harness for RSC/fixture ACs; automated vs manual is unstated.
- F.11: .env.example, CI, RTL, the integration DB and the RSC test strategy are missing.

### C1.54 — All user-facing strings in the locked copy module · minor · FIX
**Rationale.** F2 introduces six strings outside F1's locked table, one of which contradicts it. F3 has a second thin-data string and no staleness clause. "TIER2_ENABLED … per Standards decision" points at no decision, and the flag has no home.
**Fix.**
- F1 copy table (or a sibling ui-copy.ts under the same lint): add F2's strings — error panel "Couldn't reach price data — try again.", submit helper text, validation error, thin-data note, the C1.31 history line, stale flag and null case, the C1.32 unavailable note, the C1.29 ambiguous/not-found copy, and the C1.02 source label.
- F3: "noted in reason as 'thin price data'" → "uses F1's thin-data clause ('only {n} days of price history')".
- Add a stale clause "latest price data is {d} days old" (fires per C1.12).
- F3 W2: "`TIER2_ENABLED` param defaulting per Standards decision" → "`TIER2_ENABLED: false` in RECOMMENDATION_PARAMS; flipping it is a code change that changes PARAMS_VERSION (C1.61)". Mirror this in S3.1.
**Members.**
- C.16: six F2 strings sit outside the locked table; "printing" vs "set" conflict.
- D.14: two thin-data strings; no stale clause; TIER2_ENABLED has no home.

### C1.55 — Shock move definition and tooltip · minor · FIX
**Rationale.** "7-day move" has four plausible definitions, three sources disagree, and the spec's tooltip ("markets typically retrace…") is a forecast that the forbidden-phrase lint would fail.
**Fix.**
- F3: "Shock annotation: |7-day move| ≥ 35%" → "sevenDayMovePct = (latest.priceCents − ref.priceCents) / ref.priceCents × 100. latest = the newest real row; ref = the newest real row dated ≥ 7 UTC days before latest. Null (no annotation) if either is missing. Trigger: |move| ≥ shockMagnitudePct (35)."
- F1 copy table: locked tooltip "Price moved {+/−X}% over the last 7 days."
- S3.2 AC-4 builds its fixture from this definition.
- Align the public-methodology note ("single-day > 25% or 7-day cumulative > 30%").
**Members.**
- D.12: the move is undefined, the fixture is nondeterministic, and the tooltip is a forecast.

### C1.56 — Boundary fixtures that can actually be equal · minor · FIX (values re-pinned after C1.10/C1.11/C1.41)
**Rationale.** −43/3 % lands exactly on integer cents only when market is a multiple of 300. S3.2 has no widened-boundary AC, and its CV-0.30 series is unspecified.
**Fix.**
- S3.1 AC-6: "delta exactly equal to a shifted threshold → Fair" → "market 30000, asking 25700 (−14.333…%) with shift −6 → fair; asking 25699 → buy".
- S3.2, add AC: "market 30000, asking 25000 (−16.667%) with CV 0.30 and zero slope → fair; 24999 → buy".
- S3.2 AC-1: "CV-0.30 fixture = alternating ±30 % around 8150, OLS slope 0; shock annotation expected".
**Members.**
- D.15: exact equality is IEEE-incidental; there is no widened-boundary AC; the CV fixture is unspecified.

### C1.57 — Fixture coverage and superseded spec examples · minor · FIX
**Rationale.** S1.2 never pins C's Tier-1 kind or D's confidence, and there is no Wait+high or medium fixture. Spec §8 row 7 and §4 Example A are stale and unannotated.
**Fix.**
- S1.2 AC-1: "worked examples A (buy), B (fair), E (insufficient)" → "A, B, C (Tier 1), D and E pass with exact kind and confidence".
- F1, add fixtures F = 9000 vs 8150 (+10.43 %, 30 flat → wait/high) and G = B's inputs with 20 snapshots (fair/medium).
- F1 note: "spec §8 row 7 (80 vs 82 → wait) is superseded by D; spec §4 Example A ($74.99 → Buy at ±3 %) is superseded by F1 row A (Fair under 5 %/0.6)." Patch both spec rows.
**Members.**
- B.11: C/D kinds are unasserted; no wait+high or medium fixture; a wrong spec row is unannotated.

### C1.58 — S1.3 AC-4 is tautological · minor · FIX (title per C1.48)
**Rationale.** A test that paramsVersion === '2026-07-05' passes whatever the values are.
**Fix.**
- S1.3 AC-4: "a fixture pins the current `paramsVersion` value against the 2026-07-05 threshold set" → "an inline-snapshot test asserts the full RECOMMENDATION_PARAMS object together with PARAMS_VERSION; changing any value without updating the snapshot fails the suite".
- Drop "confirm the asymmetric thresholds against fixtures" from S1.3's description; S1.2 AC-1/2 own that.
**Members.**
- B.14: AC-4 passes regardless of values; threshold confirmation duplicates S1.2.

### C1.59 — Competitive-format chip copy · minor · FIX
**Rationale.** `formatProfile: competitive` cannot say which format qualified, so the "Modern-legal" chip has no data behind it.
**Fix.**
- F4 §UI: chip "`Modern-legal`" → "`Competitive-format legal`", with tooltip "Legal in Standard, Pioneer or Modern as of the last Scryfall fetch".
- The EDH chip reads "Commander-legal".
**Members.**
- E.7: the chip names a format the data model does not store.

### C1.60 — F5 Prisma model block · minor · FIX (columns per C1.15, C1.42)
**Rationale.** The repo maps every name to snake_case. An FK to tracked_cards would fail most inserts. Enums would need a migration per new kind. Indexes and the id generator are unstated. The id is the only capability guarding disagree, so it should not be predictable.
**Fix.** Add to F5 §Functionality:
```
model RecommendationLog {
  id               String   @id @default(cuid(2))
  createdAt        DateTime @default(now()) @map("created_at")
  cardId           String   @map("card_id")
  setCode          String   @map("set_code")
  finish           String
  askingPriceCents Int      @map("asking_price_cents")
  marketPriceCents Int      @map("market_price_cents")
  kind             String
  confidence       String
  paramsVersion    String   @map("params_version")
  category         Json?
  adjustedKind     String?  @map("adjusted_kind")
  disagreed        Boolean  @default(false)
  disagreedAt      DateTime? @map("disagreed_at")
  disagreeReason   String?  @map("disagree_reason") @db.VarChar(200)
  @@index([createdAt])
  @@index([kind, paramsVersion])
  @@map("recommendation_log")
}
```
Add the note: "No relation to tracked_cards. String columns are validated by the engine's unions. category null ⇔ the row was written before S4.1. rawKind is added if C1.42 = A; the abuse_counters table is added if C1.15 = A." S5.1 references this block.
**Members.**
- E.10: table/column mapping, FK posture, enums, indexes and id generator are left to the implementer.

### C1.61 — paramsVersion mechanism · minor · FIX
**Rationale.** "hash/tag" names two mechanisms. A content hash maintains itself. On TIER2_ENABLED: the hash includes it, deliberately departing from E.12's proposal, so that a flip starts a new calibration epoch (consistent with C1.54).
**Fix.**
- F5: "`paramsVersion` (string — hash/tag of RECOMMENDATION_PARAMS…)" → "paramsVersion = PARAMS_VERSION: the first 8 hex chars of SHA-256 over JSON.stringify(RECOMMENDATION_PARAMS) with sorted keys, exported from src/lib/recommendation/params.ts. TIER2_ENABLED is part of the hashed object."
- Add fixture: changing any param value changes PARAMS_VERSION.
**Members.**
- E.12: hash vs tag is unpicked; the computing module is unnamed.

### C1.62 — Disagree action result shape · minor · FIX
**Rationale.** A Server Action returns a value, not "a 200". The not_found and idempotent-repeat behaviour is unspecified.
**Fix.**
- S5.2 and F5: add `type DisagreeResult = { status: 'ok' | 'rate_limited' | 'not_found' }`.
- The client shows the confirmation on `ok` and `not_found` (quietly, with no distinction) and "Too many reports — try again later" on `rate_limited`. Idempotent repeats return `ok` without consuming a token.
- S5.2 AC-3: "single row, single flag, 200 response" → "single row, single flag, status 'ok'". Rewrite AC-4 in the same terms.
**Members.**
- E.13: HTTP vocabulary on an action; client branches undefined.

### C1.63 — Parallel lanes vs "sequential stories only" · minor · FIX
**Rationale.** The protocol's Agent Lanes (2026-10-04) allow parallel worktrees, and several story pairs are file-disjoint. S3.1's "Sequential after S5.2" is a rule artifact, not a dependency.
**Fix.**
- Standards DoD 5: "PR from `main`, targeting `main`, sequential stories only" → "branched from and targeting `main`; schema/migration stories serialized; other stories may run in parallel worktrees and rebase on main before marking ready".
- Stories DB: encode lanes in `Order` or a `Lane` select:
  - S2.2 footer runs in parallel from day 1.
  - The main lane is S1.1 → S1.2 → S1.3 → S2.1 → S5.1 → {S5.2 ∥ S3.1} → {S3.2 ∥ S4.1}.
- Delete S3.1's "Sequential after S5.2 in build order".
**Members.**
- F.14: Standards contradicts the protocol; the Order field encodes one lane.

### C1.64 — AC hygiene · minor · FIX
**Rationale.** Small inconsistencies an implementer would otherwise resolve by guessing:
- printing vs set;
- two forbidden-phrase lists;
- out-of-order AC numbers;
- a Phase 2 feature map in a Phase 1 AC;
- "buy/wait/hold" in S1.2's description;
- example E's confidence is unpinned.
Palette (C1.14) and the S1.3 fold (C1.48) are split out as rulings.
**Fix.**
- F1 copy table: insufficient_data sentence "…try a different set." → "…try a different printing." (matches F1 W1 and F2).
- S1.3 AC-2: replace its own list with "the F1 forbidden-phrase list (single source)".
- S1.1: renumber all ACs sequentially, after every C1 addition.
- S1.1 AC-6: "map covering F1–F11" → "map covering F1–F5 plus an Unmapped bucket; extended per phase".
- S1.2 description: "buy/wait/hold" → "buy/fair/wait".
- F1 fixture E: confidence "—" → "low (not rendered)". S1.2 AC-1 pins it.
- One source-label string everywhere (C1.02).
**Members.**
- B.15: printing/set wording, forbidden lists, AC order, the F6–F11 reference, buy/wait/hold.
- F.15: AC hygiene, plus the palette and S1.3-fold questions (split to C1.14 and C1.48).

---

## Nits

### C1.65 — Free-text PII retention · nit · RULING
**Rationale.** "No PII" holds for designed collection, but the 200-char disagreeReason will receive volunteered emails and names. No retention rule exists. This is posture, not compliance (§5.2 requires nothing here).
**Ruling.** **A** Purge disagreeReason after 12 months (SQL job, Phase 2). **B** Accept the exposure and say so under Decisions baked in. **Recommend A:** cheap, and it keeps "No PII" true in practice.
**Members.**
- E.15: free text can hold volunteered PII; no purge rule.

### C1.66 — F4 dependency header; null category semantics · nit · FIX
**Rationale.** The F4 header contradicts S4.1's stated dependencies. S4.1 AC-4 and AC-5 leave a null category undefined.
**Fix.**
- F4 header: "Independent of F3 (parallel-safe after F1)" → "Independent of F3; parallel-safe after S2.1 and S5.1".
- F5 Fields: "category null ⇔ row written before S4.1; from S4.1 on always a full object".
**Members.**
- E.14: header vs Notes dependency; "when present" vs "always written".

---

## Refuted

- **C1-A.7** (spec §4 examples use the retired ±3 % band, so F1 has incompatible fixtures): F1 already re-derives A–E at 5 %/0.6 with new inputs, and S1.2 cites F1, not the spec. The residual Tier 2 asymmetry gap is covered by C1.34, and the stale spec rows by C1.57.
- **C1-C.12** (F2 makes S2.1 author the log migration ahead of S5.1): F2 attributes the write to F5, S5.1 owns the migration, and AGENTS.md:88 blocks any migration until ruled. Every link in the failure chain is blocked.
- **C1-E.6** (S5.2 strip-then-cap fixture is unsatisfiable): a library-grade stripper (DOMPurify with KEEP_CONTENT) drops script content and returns "x". The fixture correctly tells a naive regex from a real stripper.
