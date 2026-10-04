# C1-E — Design F4 (Card Classification) + S4.1 · Design F5 (Recommendation Log & Disagree) + S5.1, S5.2

Critic: Read the F4, F5, S4.1, S5.1, S5.2 Notion pages plus Standards, Feature Breakdown and F2 for cross-checks; the vault gate briefs §Mox P1, verdict spec §§1–2, 5–12, action file Phase 1, legal §5.2, autodev protocol; the repo at `/Users/joshstubbington/Documents/local_development/mox-market` (note: working tree is on `chore/agent-harness`, two commits past origin/main `7268e28`; the new tracked `AGENTS.md` is cited where it bears) — `prisma/schema.prisma`, `prisma.config.ts`, `src/lib/prisma.ts`, `src/types/scryfall.ts`, `src/lib/scryfall.ts`, `src/app/evaluate/*`, `src/app/api/prices/*`, `README.md`, `vercel.json`, generated client; fetched Scryfall's card-object docs and `/sets/8ed` to verify field claims. Read-only throughout.

## Findings (ranked)

| ID | Sev | Conf | Location | Hole (one sentence) | Class |
|----|-----|------|----------|---------------------|-------|
| C1-E.1 | blocker | high | F5 §Functionality "Prisma model `RecommendationLog` (new migration)"; S5.1 AC-1 "`migrate deploy` integration test" | The artifacts prescribe Prisma Migrate while the gate brief ratified the Supabase CLI lane; the repo has zero migration history (prod built by `prisma db push`), so the first migration needs a baseline step nobody names, and `prisma migrate dev` with the README's `.env` offers to reset the production database on a Free tier with no backups. | RULING + FIX |
| C1-E.2 | major | high | F5 §Functionality "Never on share-link opens, OG unfurl renders, or any bot-reachable GET" | F2 never says whether compute is a Server Action or a URL-addressable page render; the shipped client navigates by GET (`router.push`), under which every reload/back/prefetch/crawler hit logs a row and the session cookie cannot be set (Next.js forbids `cookies().set()` in Server Components). | FIX |
| C1-E.3 | major | high | F5 §Functionality "in-memory token bucket … backstopped by a global daily breaker" | On Vercel the bucket and the "global" breaker are per-instance and reset on cold start, the breaker has no threshold anywhere, and the only unbounded unauthenticated write — the log row per compute — has no guard at all. | RULING |
| C1-E.4 | major | high | F4 §Workflows "`released_at` missing on printing → fall back to card-level release" | Scryfall's `released_at` is a required `Date` on the card object (a printing) and no card-level release field exists, so the fallback is a phantom, `unknown` is unreachable, and the fields-table source "set `released_at`" invites a `/sets/:code` fetch that breaks "zero new API calls". | FIX |
| C1-E.5 | major | high (contradiction) / med (`after()`) | F5 §Decisions baked in "fire-and-forget logging (UX never blocks on the log)" vs §Functionality "awaited up to 300ms" | The Decisions list still carries the pre-revision model; and the 300 ms timeout path leaves an insert pending after the response, which Vercel does not guarantee to finish unless it is handed to `after()`. | FIX |
| C1-E.6 | major | high | S5.2 AC-2 "fixture: `<b>x</b><script>alert(1)</script>` stores exactly `x`" | "Strip HTML tags" yields `xalert(1)`, not `x`; the stated rule and its fixture cannot both be satisfied, so the implementer must guess. | FIX |
| C1-E.7 | minor | high | F4 §UI "`Reserved List` · `Recent print (<6mo)` · `EDH top-1000` · `Modern-legal`" | The data model stores `formatProfile: competitive`, which cannot render "Modern-legal" (it does not know which format qualified). | FIX |
| C1-E.8 | minor | high | F4 §Functionality "`recent` (< 6 months from set release)" | A "pure" classifier with a hidden `Date.now()` is not pure, and S4.1 AC-1's "<6-month printing" fixture fails about six months after it is written; bucket boundaries (≤1000? <6 months in days?) are unstated. | FIX |
| C1-E.9 | minor | high | F4 §Functionality "`digital` = printing not available in paper per Scryfall `games`" | `games` is not declared on `ScryfallCard` (src/types/scryfall.ts:65–113) while `digital: boolean` already is; and the design never says which object is classified (the selected printing vs the default). | FIX |
| C1-E.10 | minor | med | F5 §Functionality model field list; S5.1 Description | Table/column mapping, FK posture, enum-vs-string for `kind`/`finish`/`confidence`, indexes, id generator and `category` null semantics are all left to the implementer against a schema that maps every name to snake_case. | FIX |
| C1-E.11 | minor | med | F5 §Functionality "Once Tier 2 serves live, `adjustedKind` is null" | After the flip the raw-vs-adjusted flip rate (one of the three calibration queries F5 names) can no longer be computed, and no story is named as the writer of `adjustedKind` (S5.1 lands with it always null). | RULING |
| C1-E.12 | minor | high | F5 §Functionality "`paramsVersion` (string — hash/tag of RECOMMENDATION_PARAMS…)" | Hash and tag are different mechanisms with different failure modes; the design does not pick, nor say which module computes it. | FIX |
| C1-E.13 | minor | med | S5.2 AC-3 "single row, single flag, 200 response"; F5 W1 edge "unknown row id → silent no-op" | The disagree path is a Server Action (no status codes) with no return contract; what the user sees on `not_found`, and whether an idempotent repeat consumes a bucket token, are unspecified. | FIX |
| C1-E.14 | nit | high | F4 header "Independent of F3 (parallel-safe after F1)" | S4.1 says "Depends on S2.1 (+ S5.1 for the log column)"; S4.1 AC-5 "when present" vs AC-4 "always written" leaves null-category semantics undefined. | FIX |
| C1-E.15 | nit | low | F5 §Decisions baked in "No PII, no accounts" | A 200-char free-text field will receive volunteered emails/names; no retention or purge rule is stated. | RULING |

## Detail

### C1-E.1 — Migration lane unresolved, no baseline, and a data-loss trap on the first migration
**Location:** F5 §Functionality "Prisma model `RecommendationLog` (new migration)"; S5.1 AC-1 "migration creates the table from an empty DB (`migrate deploy` integration test)"; S5.1 Notes "prod migration policy is Standards pending decision 4"; Standards pending decision 4 "via Prisma migration on the shared Supabase instance".
**Hole:** Three sources disagree on the lane and none addresses the repo's actual state.
- Gate briefs §Mox P1 (2026-08-20, after these designs) ratify "the official Supabase CLI migration lane with four rules" — `supabase db push` from one channel, dump before destructive DDL.
- `AGENTS.md` (committed on `chore/agent-harness`, 2026-10-04) line 88: "Migration lane: Prisma Migrate files vs the Supabase CLI four-rule lane. **Do not author a migration until this is ruled.**" and line 76 forbids running `prisma migrate deploy`/`db push`/`supabase db push` against any `POSTGRES_*` URL.
- Protocol line 167 assumes Prisma: "`migrate deploy` creates the schema from scratch".
**Evidence:**
- `prisma/` contains only `schema.prisma` (no `migrations/`); `git ls-files` has no migration or `supabase/` files; `prisma.config.ts` sets `migrations.path: "prisma/migrations"` and `datasource.url: POSTGRES_URL_NON_POOLING ?? POSTGRES_PRISMA_URL ?? DATABASE_URL`.
- `README.md:47–48`: "Set POSTGRES_PRISMA_URL and POSTGRES_URL_NON_POOLING in .env / npx prisma db push" — prod was created by `db push`; neither `_prisma_migrations` nor `supabase_migrations.schema_migrations` records the two existing tables.
- Consequence A (either lane): the first migration must baseline `tracked_cards` + `price_snapshots` and be marked applied on prod, or `migrate deploy` / `db push` fails on "relation already exists". No artifact mentions baselining.
- Consequence B (Prisma lane): `prisma migrate dev` against a database with tables but no history reports drift and offers to reset the database; with the README's `.env`, `prisma.config.ts` resolves to the prod Supabase direct URL first. Gate brief rule 3: "the Free plan has no automated backups and no PITR". `migrate dev` also needs a shadow database, which Supabase's `postgres` role does not get by default.
- Consequence C: running Prisma Migrate and Supabase CLI against one schema gives two ledgers that each see the other's DDL as drift (the known foot-gun).
- Consequence D: `package.json` build is `prisma generate && next build`; `vercel.json` has only the cron. There is no "normal deploy path" that applies migrations; until someone runs it, every log write fails (fail-open, so silently: zero calibration rows).
**Proposed fix:**
RULING — pick the lane.
- Option A (recommend): Prisma Migrate, with the gate brief's four rules transplanted verbatim (timestamped file in repo; one channel; dump before destructive DDL; rollback note). Rationale: Prisma already owns the schema, `prisma.config.ts` is in place, no Docker or second ledger; the four rules are tool-agnostic.
- Option B: Supabase CLI lane; then `schema.prisma` becomes a mirror maintained by `prisma db pull` after each push, and the `prisma-client` generator must still run — more moving parts for one developer.
FIX regardless — replace S5.1 AC-1 with: "AC-1: a baseline migration capturing the existing `tracked_cards`/`price_snapshots` schema is committed first and marked applied on prod (`prisma migrate resolve --applied <baseline>` or `supabase migration repair`); the `recommendation_log` migration is additive (CREATE TABLE only) and runnable from an empty local DB in the integration test; `migrate dev` is run only against a local Postgres; prod application is Josh's manual step (per `AGENTS.md` Hard limits) before the deploy that ships S5.1."

### C1-E.2 — Log-write trigger rule is unenforceable until the compute path is pinned
**Location:** F5 §Functionality "Log-write triggers (exhaustive): user-initiated evaluate submits… Never on … any bot-reachable GET"; F2 §Functionality "page/server action resolves card".
**Hole:** F5's trigger rule presumes the server can tell a user submit from a GET. F2 leaves the mechanism open ("page/server action"), and the only shipped code navigates by URL.
**Evidence:**
- `src/app/evaluate/evaluate-client.tsx:400–401`: `router.push(\`/${encodeURIComponent(name)}?price=${price}\`)`; recent-list rows link to `/${name}?price=…&finish=…` (line 241). The action file's Phase 1 DoD also assumes a URL result page ("lands on `/Esper%20Sentinel?price=75`").
- If F2 renders the recommendation in a Server Component reached by URL: browser reload, back/forward, `<Link>` prefetch, link unfurlers and crawlers all execute "a computed recommendation" → a log row each. F5 W1 step 2 explicitly refuses to dedupe ("still logs"). The ~30/50/20 distribution query then measures crawler traffic.
- Next.js: `cookies().set()` is only permitted in Server Actions and Route Handlers; a page render cannot set the "httpOnly random-UUID cookie … set on the first write-capable interaction".
- Standards §Conventions permits "Server Actions / route handlers only where interaction demands" — a submit is exactly that.
**Proposed fix:** Add to F5 §Functionality: "The log write happens only inside the evaluate Server Action (POST) that performs the compute, never in a page/RSC render. If F2 makes results URL-addressable, a render from URL re-computes for display but does not log; only the action logs." Mirror as S5.1 AC: "a GET of a result URL writes no row (integration test)". Cross-reference to the F2 critic: F2 must choose Server Action for compute.

### C1-E.3 — Abuse guard: honest about the wrong weakness, missing a number, guarding the cheap write
**Location:** F5 §Functionality "Abuse guard = in-memory token bucket keyed on it, max 5 disagrees/hour; trivially resettable and accepted at hobby scale, backstopped by a global daily breaker".
**Hole:**
1. "Trivially resettable" names the cookie-clear weakness only. On Vercel Functions each instance has its own memory and is recycled; the bucket is per-instance and the "global daily breaker" is not global — its effective cap is (instances × threshold), unknown and unbounded by design. The design should say this, or move the breaker to the database.
2. The breaker has no threshold; S5.2 has no AC for it; nothing says whether it covers disagrees only or log writes.
3. Disagrees are already self-limited: each needs a distinct row id that only the evaluator's own page carries, and the update is idempotent. The unbounded, unauthenticated write is the log row per compute (one per F2 action, no cap anywhere in F2 or F5). On the Free tier's 500 MB, a dumb bot at ~10 req/s fills ~1 M rows/day.
**Evidence:** Feature Breakdown F5 scope "basic abuse guard" (covers the feature, not just disagrees); schema has no counters table; `src/lib/throttle.ts` shows the same in-memory-on-serverless pattern already in the codebase (Scryfall spacing), so the implementer will copy it without realising the breaker needs different semantics.
**Proposed fix (RULING):**
- A (recommend): keep the per-cookie bucket in memory and *state* "per-instance, best-effort"; implement the daily breaker as `SELECT count(*) FROM recommendation_log WHERE created_at > now() - interval '24 hours'` (needs the `createdAt` index from C1-E.10) checked before each log write and each disagree, thresholds `LOG_DAILY_CAP` / `DISAGREE_DAILY_CAP` in an ops const (not `RECOMMENDATION_PARAMS`, which is engine-only per AGENTS.md). When tripped: skip the write, render normally (fail-open), console warn once per instance.
- B: accept hobby-scale exposure explicitly in Decisions baked in, with the sentence "both limits are per-instance and reset on cold start".

### C1-E.4 — `released_at` fallback does not exist; `unknown` unreachable; "set released_at" risks a new fetch
**Location:** F4 §Workflows "`released_at` missing on printing → fall back to card-level release, else `unknown` age"; §Fields source "set `released_at`"; S4.1 AC-3 "missing `released_at` falls back card-level, else `unknown`".
**Hole:** Scryfall's card object *is* a printing. Its `released_at` is documented as `Date` (not Nullable): "The date this card was first released." There is no oracle-level/card-level release field on the object; the first-printing date would require a search by `oracle_id` ordered by release — a new API call. The fields table's "set `released_at`" is the Set object's field, reachable only via `/sets/:code` — also a new call. Either reading sends the implementer to violate "Zero new API calls".
**Evidence:** Scryfall docs (fetched 2026-10-04): `released_at Date — The date this card was first released.`; `src/types/scryfall.ts:71` declares `released_at: string` (required). The era cutoff itself checks out: `/sets/8ed` → `released_at: 2003-07-28`.
**Proposed fix:** Fields row: source = "`card.released_at` (printing-level, always present)". Delete the fallback sentence. Either drop `unknown` from the enum, or keep it strictly as a parse guard and rewrite AC-3: "an unparseable `released_at` string yields `age: unknown` and the age chip is omitted". Add one line stating that age is the age of the *printing* being priced (consistent with history keyed by `(scryfall_id, finish)`), so a 2025 reprint of a 1994 card is `recent`.

### C1-E.5 — Fire-and-forget still in Decisions; timeout path can drop rows on Vercel
**Location:** F5 §Decisions baked in "fire-and-forget logging (UX never blocks on the log)"; §Functionality "The write is awaited up to 300ms"; S5.1 revision note "fire-and-forget replaced by awaited-with-timeout".
**Hole:** The r1 revision changed the body and the story but not the Decisions list, which is the list Josh rules on. Separately, "awaited up to 300ms" implies `Promise.race`; the losing insert keeps running only while the function is alive. Vercel does not guarantee post-response work completes unless it is registered via `after()` (`next/server`, stable; repo is on Next 16.1.6). Without it the timeout path — the very path chosen to protect UX — silently loses calibration rows.
**Evidence:** F5 text as quoted; `node_modules/next/package.json` version 16.1.6.
**Proposed fix:** Decisions line → "log write awaited ≤300 ms, then detached via `after()` so it still commits; UX never blocks beyond 300 ms". Add to W1 edge cases: "timed-out-but-committed rows exist and simply carry no disagree control". S5.1 AC-5 gains: "a write that resolves after 300 ms still produces a row (fault-injection with a 500 ms delay)".

### C1-E.6 — Sanitisation rule and fixture are mutually exclusive
**Location:** S5.2 AC-2 "reason is trimmed, stripped of HTML tags and control characters (fixture: `<b>x</b><script>alert(1)</script>` stores exactly `x`)".
**Hole:** Tag stripping on that input produces `xalert(1)`. Producing exactly `x` requires removing `<script>` *element content*, which the rule does not say. An implementer who writes a tag-strip (the usual regex or a DOM-free helper) fails the fixture; one who targets the fixture over-removes legitimate text in other cases.
**Evidence:** Direct recomputation of the fixture against the stated rule.
**Proposed fix:** Pick one and make the pipeline explicit, in order: (1) remove `<script>…</script>` and `<style>…</style>` including content, (2) strip remaining tags, (3) remove C0/C1 control characters, (4) trim, (5) cap at 200 Unicode code points. Fixture then stores `x`. If the simpler rule is preferred (the field is never rendered), change the fixture expectation to `xalert(1)`. Say "cap after strip" either way — otherwise a 200-char tag soup becomes an empty string after the cap.

### C1-E.7 — Chip copy not derivable from `CardCategory`
**Location:** F4 §UI "`Modern-legal`"; §Functionality `formatProfile`: `competitive` if legal in ANY of Standard/Pioneer/Modern.
**Hole:** The enum collapses the qualifying format. The chip row cannot say "Modern-legal" vs "Standard-legal" from `competitive` alone.
**Proposed fix:** Chip copy "Competitive-format legal", tooltip "Legal in Standard, Pioneer or Modern as of the last Scryfall fetch". Or extend the type with `competitiveFormats: ('standard'|'pioneer'|'modern')[]` (still free data). Also drop the word "legal" from the `edh` chip or name it "Commander-legal" consistently.

### C1-E.8 — Classifier needs an injected clock; boundaries unstated
**Location:** F4 §Functionality "`recent` (< 6 months from set release)"; §Decisions "thresholds for buckets (6mo, rank 1000/5000) in `RECOMMENDATION_PARAMS`"; S4.1 AC-1 "a <6-month printing".
**Hole:** Purity rule (Standards, AGENTS.md, `.cursor/rules/recommendation-engine.mdc`: "No literals in logic", pure functions) plus a wall-clock comparison means either an impure function or a fixture that rots. "6 months" has no day count; "top-1000" does not say whether rank 1000 is inside.
**Proposed fix:** `classify(card: ScryfallCard, now: Date): CardCategory`; params `recentPrintingDays: 183`, `edhrecTop1Rank: 1000`, `edhrecTop2Rank: 5000`, `modernEraStart: '2003-07-28'`; rules `ageDays < recentPrintingDays`, `rank <= 1000`, `rank <= 5000`. Fixtures pin `now`.

### C1-E.9 — `games` not in the type; which card object is classified is unstated
**Location:** F4 §Functionality "`digital` = printing not available in paper per Scryfall `games`"; §Fields source "`games` lacks paper".
**Hole:** `src/types/scryfall.ts:65–113` has no `games`; it already has `digital: boolean` (line 110) and `reserved` (109), `edhrec_rank?` (112), `legalities` (84), `released_at` (71). Scryfall docs: `digital — True if this card was only released in a video game`; `games — … paper, arena, mtgo, astral, and/or sega`. Either source works; the design must pick and, if `games`, add it to the type. The design also never states which object the classifier receives. `reserved`, `edhrec_rank`, `legalities` are oracle-stable; `released_at`, `digital`, `games`, `set_type` vary per printing.
**Evidence:** F2 populates the set selector from `getPrintings()` (`src/lib/scryfall.ts:144–155`, full card objects, `unique=prints`), so the selected printing's object is in hand without a new call — the "zero new API calls" claim holds provided F2 retains that object for the W2 recompute rather than re-fetching by id.
**Proposed fix:** "Classifier input is the Scryfall card object of the printing being priced (the same `(scryfall_id, finish)` key as the history). `digital` = `card.digital`" — or add `games: ("paper"|"arena"|"mtgo"|"astral"|"sega")[]` to `ScryfallCard` in the same PR and derive `!games.includes('paper')`. S4.1 AC-6's fetch spy already covers the no-call property.

### C1-E.10 — Model left underspecified against a schema with strong conventions
**Location:** F5 §Functionality model field list; S5.1 Description.
**Hole / evidence:**
- `prisma/schema.prisma` maps every table and column (`@@map("tracked_cards")`, `@map("set_name")`); Feature Breakdown and Standards call the table `recommendation_log`. The design gives camelCase names only.
- FK: evaluated cards are mostly not in `tracked_cards` (AGENTS.md line 93: "written by the V1 cron for watchlisted cards only"); a relation to `TrackedCard` would make most inserts fail. The design should say "no FK; `cardId` is a bare Scryfall id".
- `kind` must later gain `sell_now`/`hold` (Standards addendum 4); Prisma enum = migration per change, `String` + engine-side union = none. `finish`, `confidence` same question.
- Indexes: calibration queries are by `createdAt`, `kind`, `paramsVersion`; C1-E.3's breaker needs `createdAt`.
- Id: `cuid()` (v1) is time-ordered and partly predictable; the id is the only capability guarding the disagree update. `cuid(2)` or `uuid(7)` cost nothing.
- `category Json?` (S5.1) vs F4 "the category json is always written … defaults ARE the record": null must mean "row written before S4.1 landed" and should be said.
**Proposed fix:** Put one Prisma block in F5: `model RecommendationLog { id String @id @default(cuid(2)); createdAt DateTime @default(now()) @map("created_at"); cardId String @map("card_id"); setCode String @map("set_code"); finish String; askingPriceCents Int @map("asking_price_cents"); marketPriceCents Int @map("market_price_cents"); kind String; confidence String; paramsVersion String @map("params_version"); category Json?; adjustedKind String? @map("adjusted_kind"); disagreed Boolean @default(false); disagreeReason String? @map("disagree_reason") @db.VarChar(200); @@index([createdAt]); @@index([kind, paramsVersion]); @@map("recommendation_log") }` with the note "no relation to `tracked_cards`; string columns validated by the engine's unions".

### C1-E.11 — `adjustedKind` loses the comparison the moment it matters; writer unnamed
**Location:** F5 §Functionality "Once Tier 2 serves live, `adjustedKind` is null"; "Calibration queries … raw-vs-adjusted flip rate"; S5.1 "Lands before F3".
**Hole:** While dark, `kind` = Tier 1 and `adjustedKind` = Tier 2 — fine. After the flip, `kind` = Tier 2 and the Tier-1 kind is gone, so flip-rate and spec §9.4's A/B on `trendShiftFactor` cannot be computed on live data. Separately, S5.1 ships with `adjustedKind` always null; S3.1/S3.2 must populate it but neither F5 nor S5.1 names the owner, and `TIER2_ENABLED` is referenced without a home.
**Proposed fix (RULING):** A (recommend): add `rawKind String` (Tier-1 kind, always written) alongside `adjustedKind String?`; `kind` stays "served". One extra column now, no migration later. B: keep as designed and record "post-flip comparison is out of scope". Either way add to F5: "S3.1 owns writing `adjustedKind`; `TIER2_ENABLED` is defined in F3's design".

### C1-E.12 — `paramsVersion`: hash or tag, computed where
**Location:** F5 §Functionality "`paramsVersion` (string — hash/tag of RECOMMENDATION_PARAMS…)"; §Fields default "current", validation "stamped by engine".
**Hole:** A content hash is self-maintaining and makes "did the params change" mechanically true; a human tag is readable but will be forgotten on the first tuning PR (and AGENTS.md says param changes need a ruling anyway, so the tag would be a second ledger). The design must choose, and say which module exports it (engine or F5 write path).
**Proposed fix:** "`paramsVersion` = first 8 hex chars of SHA-256 over `JSON.stringify(RECOMMENDATION_PARAMS)` with sorted keys, exported from `src/lib/recommendation/params.ts` as `PARAMS_VERSION`; `TIER2_ENABLED` is not part of the hash (adjustedKind records it)." Add a fixture: changing any param value changes `PARAMS_VERSION`.

### C1-E.13 — Disagree action has no return contract
**Location:** S5.2 AC-3 "200 response"; AC-4 "writes nothing"; F5 W1 edge "unknown row id → silent no-op + console warn"; W2 edge "double-submit → idempotent".
**Hole:** The mechanism is a Server Action called from the client panel (consistent with Standards; not a finding), which returns a value, not an HTTP status. Unspecified: what the client renders on `not_found` ("Thanks" would be a lie; nothing would look broken), whether an idempotent repeat consumes a bucket token, and the shape the client branches on.
**Proposed fix:** `type DisagreeResult = { status: 'ok' | 'rate_limited' | 'not_found' }`; client shows the confirmation on `ok` and `not_found` (quiet, no distinction), the "Too many reports — try again later" copy on `rate_limited`; idempotent repeats return `ok` without consuming a token. Rewrite AC-3/AC-4 in those terms.

### C1-E.14 — Dependency header and null-category semantics
**Location:** F4 header "Independent of F3 (parallel-safe after F1)"; S4.1 Notes "Depends on S2.1 (+ S5.1 for the log column)"; S4.1 AC-4 vs AC-5.
**Proposed fix:** Header → "parallel-safe after S2.1 and S5.1". Add to F5 Fields: "`category` null ⇔ row written before S4.1; from S4.1 on, always a full object (F4: defaults are the record)".

### C1-E.15 — Volunteered PII in free text; no retention statement
**Location:** F5 §Decisions baked in "No PII, no accounts"; §Functionality `disagreeReason` (nullable, 200).
**Hole:** The claim is true of designed collection; a free-text field will receive emails and names from users. Legal §5.2 does not require anything here, so this is posture, not compliance. Low confidence that Josh cares at hobby scale; verify by asking.
**Proposed fix (RULING):** Add one line: "free text may contain volunteered PII; `disagreeReason` is purged after 12 months (SQL job, Phase 2 if not sooner)" — or state the exposure is accepted.

## Implementer questions not answered by the artifact
- Which migration tool, who runs it against prod, and when relative to the Vercel deploy that ships S5.1 (table absent ⇒ every write fails silently)? Is there a baseline migration for the two existing tables? (C1-E.1)
- Is the evaluate compute a Server Action or a page render? Which one writes the log row and sets the cookie? (C1-E.2)
- What database do the S5.1 "integration" and "fault-injection" tests run against? S1.1 provisions Vitest, not a Postgres; Supabase local needs Docker. Nothing names it.
- Are `insufficient_data` recommendations logged, and does the ~30/50/20 query exclude them? Given AGENTS.md line 93 ("Price history for an arbitrary evaluated card does not exist yet"), most Phase 1 rows will be `insufficient_data`/`low` unless F2 changes that — F2's problem, but F5's calibration queries should state the filter.
- When F2's finish fallback fires ("no foil — showing Normal"), is `finish` the requested or the served finish, and is `marketPriceCents` the fallback price?
- Which card object does `classify` receive — the selected printing from `getPrintings` or a re-fetched-by-id object on W2? (C1-E.9)
- Breaker threshold, scope (disagrees only vs log writes), and storage (memory vs DB)? (C1-E.3)
- `paramsVersion` derivation and owner module? (C1-E.12)
- Column names/maps, FK posture, enum vs string, indexes, id generator? (C1-E.10)
- Sanitisation order (strip → control chars → trim → cap) and the unit of "200 chars" (code points vs UTF-16 units)? (C1-E.6)
- Cookie attributes (`SameSite`, `Secure`, `Path`) and which action sets it first?
- Return contract of the disagree action; UX on `not_found`; does an idempotent repeat consume a token? (C1-E.13)
- Day count for "6 months"; inclusivity of rank 1000/5000; `future`-legal preview-season cards — `competitive` or `casual` until release?
- Tooltip mechanism for "what's this?" (Headless UI popover vs native `title`) — design-language question, not blocking.

## Leads checked and refuted
- **F5 awaited-300ms vs fire-and-forget** — confirmed, not refuted (C1-E.5): body + S5.1 say awaited; the Decisions list still says fire-and-forget.
- **In-memory bucket "accepted at hobby scale" honesty** — partially refuted: the sentence is honest about cookie reset but silent on per-instance memory and the non-global breaker; the real gap is the unguarded log write (C1-E.3).
- **Json column / `prisma-client` generator / adapter-pg gap** — refuted. Prisma 7.5.0 installed; the generated namespace already exports `JsonValue`/`InputJsonValue` (`src/generated/prisma/internal/prismaNamespace.ts:98,101`); `Json?` on Postgres through `@prisma/adapter-pg` needs nothing new. New model needs nothing the setup lacks.
- **Disagree as a Server Action from a client component; consistency with F2's server path** — refuted as a hole. Standards allows "Server Actions / route handlers only where interaction demands"; F2 says compute is server-side; a client-panel action calling a server action is the idiomatic Next 16 shape. Only the vocabulary ("200 response") and return contract are off (C1-E.13).
- **Row id as the only capability for the disagree update** — acceptable: no PII, the id appears only in the evaluator's own HTML, no enumeration endpoint, update is idempotent and one-way. Worst case is calibration poisoning, which the (fixed) breaker bounds. Recommend `cuid(2)`/`uuid(7)` (folded into C1-E.10); no signed token needed.
- **F4 field presence** — `reserved`, `edhrec_rank?`, `released_at`, `legalities`, `digital` are all declared in `src/types/scryfall.ts`; only `games` is missing (C1-E.9). `released_at` is printing-level and required (C1-E.4). `edhrec_rank` nullable per docs, so the `unranked` path is real.
- **Age cutoff 2003-07-28** — verified against `/sets/8ed` (`released_at: 2003-07-28`). Correct.
- **formatProfile totality** — refuted: the rule is exhaustive (`casual` is the else branch), so silver-border, Alchemy-only, tokens and banned-everywhere cards all get a value. Two taxonomy notes, not holes: Legacy/Vintage/Pauper-only staples (e.g. Brainstorm) land in `edh`; preview-season cards are `not_legal` in Standard until release (only `future` is `legal`) and classify `casual` for a few days.
- **"Zero new API calls" vs F2's prints lookup** — refuted: `getPrintings` returns full card objects, so the selected printing is already in hand; the claim holds if F2 keeps the object for W2 recompute (noted in C1-E.9).
- **S5.1 AC-2 cents fixture** — `Math.round(parseFloat("19.99") × 100)` → `Math.round(1998.9999999999998)` → `1999`. Correct.
- **Story AC coverage of stated edge cases** — mostly covered: unknown row id (S5.2 AC-7 covers the no-id path; the unknown-id path itself has no AC — add one returning `not_found`), double-submit (AC-3), rate-limit copy (AC-4), missing `edhrec_rank` (S4.1 AC-2), digital-only (AC-1). Not covered: the global breaker (C1-E.3), the post-300 ms commit (C1-E.5), GET-does-not-log (C1-E.2).
- **Spec §9 alignment** — F5's columns are a strict superset of §9's `(timestamp, card_id, asking, market, kind, confidence)`; the 30/50/20 hypothesis matches §9.2; no PII matches §9.1. §9.4's `?cohort=` A/B has no column — correctly out of Phase 1 scope, not a finding.
