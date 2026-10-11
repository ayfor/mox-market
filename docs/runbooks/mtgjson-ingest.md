# Runbook: MTGJson price-history ingest

The one-shot bulk load of F0's price history (Design F0 W1) and the identifier refresh (W4), with `scripts/ingest-mtgjson-history.ts`. Story S0.2; plan `docs/plans/S0.2-mtgjson-ingest.md`. The daily sync that keeps the history fresh afterwards is S0.3's cron route, `/api/prices/sync-mtgjson` (README, "Daily price sync").

## What the script does

It reads three MTGJson v5 files: `Meta.json`, `AllIdentifiers.json.gz` (≈233 MB) and `AllPrices.json.gz` (≈149 MB). By default it downloads them into `.cache/mtgjson/`, which git ignores; `--source-dir <dir>` reads them from a directory instead, with no network. The `.gz` files are gunzipped as streams and parsed with `stream-json`; nothing is ever decompressed to disk.

Before any database connection it checks that every file's `meta.version` starts with `5.` and that each `.gz` file's `data` object follows its `meta`, checks the files' dates (a refusal on path C, a warning otherwise), gunzips each `.gz` file end to end to check its CRC, and reads AllIdentifiers into memory (a file with no usable identifier is refused). Then it keeps paper TCGplayer retail USD only, the 31 UTC dates from today − 30 to today, and the gated series (EDHREC rank ≤ 5,000 or newest price ≥ $1.00), converts prices to integer cents, and keeps one MTGJson UUID per Scryfall id (side null, else `a`, else the lowest side).

A write run then upserts, in this order and in its own commits: `mtgjson_identifiers` (identifiers first), then `price_history` (prices), in chunks of 5,000 rows. Every upsert is idempotent: a re-run with the same data writes 0 rows and moves no `synced_at`. Then it prunes rows dated before today − 30, runs `ANALYZE`, and records one `price_sync_runs` row (`bulk`, or `identifiers` for W4).

## Who runs what

| Path | Command | Who | Database |
|------|---------|-----|----------|
| A, dry-run | `npx tsx scripts/ingest-mtgjson-history.ts --dry-run` | an agent or Josh | none: no URL is read and no client is created |
| B, local | `npx tsx scripts/ingest-mtgjson-history.ts --source-dir .cache/mtgjson` | an agent or Josh | `POSTGRES_URL_NON_POOLING` on `localhost` or `127.0.0.1` only |
| C, production | see "Path C" below | **Josh only**, from his laptop, after his sign-off | Supabase, through `--production` and the inline flag |
| W4, identifier refresh | add `--identifiers-only` to path B or C | B: an agent or Josh; C: Josh only | as for that path |

No agent, test or CI job ever runs path C or passes `--production`. The script refuses, before any download or connection, any URL that is unset, does not parse, names an empty host, carries `hostaddr` or a `host` query parameter, names `::1` or a socket directory, omits its port or its database, carries a `port`, `dbname`, `database`, `user` or `options` query parameter, or writes a local host other than exactly `localhost` or `127.0.0.1`, so the printed target line is what `pg` dials. It refuses any host other than `localhost` and `127.0.0.1` unless `--production` and the inline flag are both present, and `--production` also needs `POSTGRES_SSL_ROOT_CERT` (PEM) and refuses a local host. It prints `target database: <host>:<port>/<db> (local|PRODUCTION)` before connecting and never prints a user name, password or environment value.

## Exit codes

| Code | Meaning | What to do |
|------|---------|------------|
| 0 | `ok` | Nothing. The report is on stdout. |
| 1 | run error after the run row started | Earlier chunks stay committed and the run row says `error` with the message. Read the message, fix the cause, and re-run: a re-run is safe (idempotent upserts). A source that yields no price row at all (`NothingToWriteError`) also ends here, without a prune. Ctrl-C (or SIGTERM) after the run row started stops at the next chunk and finishes the row `error` (interrupted); a second Ctrl-C exits at once. If the run row stayed `running` (a lost connection, or that second Ctrl-C), S0.3's next sync marks it `error` after an hour; a statement that never answers fails after 120 s. |
| 2 | refused before any write | A usage error, the target guard, a version or file check, a source with no `data` or no usable identifier, a stale source on path C, a gzip check, a failed connection or the budget pre-check. Ctrl-C before the run row started also exits 2. Nothing was written, not even a run row. Read the message. |
| 3 | `budget_stop` | The database passed 450 MB at a re-check or at the end of the run. Earlier chunks stay committed and the prune ran. **Stop and ask Bitey** before any re-run. |

## Path A: the dry-run

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null
git check-ignore -v .cache/mtgjson/AllPrices.json.gz   # must print the .gitignore rule
npx tsx scripts/ingest-mtgjson-history.ts --dry-run
```

It downloads the three files (≈382 MB) and prints the report: rows by finish, distinct series and printings, the gate breakdown, unmapped UUIDs, Scryfall-id collisions, invalid prices and dates, rows for each of the 31 dates (a date MTGJson has not published shows `MISSING`), rows/day, projected bytes, peak RSS, duration and each file's meta. To re-read the cached files without downloading, add `--source-dir .cache/mtgjson`.

The price-basis sample (F0 Open Question 3) compares the newest MTGJson price with Scryfall's live price for N kept series, through the app's throttled Scryfall client:

```bash
npx tsx scripts/ingest-mtgjson-history.ts --dry-run --source-dir .cache/mtgjson --basis-sample 25
```

## Path B: local Postgres

Print the database hosts first (AGENTS.md, Databases): both commands must print only `localhost` or `127.0.0.1`, and the second must print nothing.

```bash
{ env; cat .env* 2>/dev/null; } | grep -oE 'postgres(ql)?://[^[:space:]"]+' | sed -E 's#^[^@]*@##; s#[:/?].*##' | sort -u
{ env; cat .env* 2>/dev/null; } | grep -oE 'postgres(ql)?://[^[:space:]"]+' | grep -oiE '[?&]host(addr)?=[^&#]*' | sort -u
npx prisma migrate deploy
npx tsx scripts/ingest-mtgjson-history.ts --source-dir .cache/mtgjson
npx tsx scripts/ingest-mtgjson-history.ts --source-dir .cache/mtgjson   # expect "rows written: 0"
```

Then measure the tables:

```sql
SELECT relname, pg_total_relation_size(oid) AS total, pg_relation_size(oid) AS heap, pg_indexes_size(oid) AS indexes
FROM pg_class WHERE relname IN ('price_history', 'mtgjson_identifiers', 'price_sync_runs');
SELECT pg_database_size(current_database());
```

Once loaded, `/Esper%20Sentinel?price=74.99` on `npm run dev` evaluates from local history instead of reading `insufficient_data`.

## Identifier refresh (W4)

When a set releases, or a sync's `unmapped_uuids` climbs, refresh the UUID map without touching prices:

```bash
npx tsx scripts/ingest-mtgjson-history.ts --identifiers-only --source-dir .cache/mtgjson
```

It never opens `AllPrices.json.gz`, writes no price row, does not prune, and records an `identifiers` run, which `getHistoryFreshness()` never counts. For production it follows path C's rules (Josh only, the same preconditions and the same inline flag).

## Path C: production (Josh only)

### Preconditions, in this order

1. **Josh's sign-off is recorded** in `docs/llm/WORKLOG.md` (a dated line: "path C approved for <date>").
2. **Supabase is active**: the project answered a read-only query within the last 6 days (the keep-awake reminder, ruling C2-A.2 = A), and the dashboard does not show it paused.
3. **`0001_price_history` is applied**: README "Production" steps (a) to (d), run after the S0.1 merge and after S1.1's baseline diff and resolve (steps (a) and (b)).
4. **README step (e) is done**: `POSTGRES_SSL_ROOT_CERT` set in Vercel and the preview smoke check passed.
5. **`POSTGRES_SSL_ROOT_CERT` (PEM) is in Josh's shell**: the same Supabase root certificate, exported for this session only. The script's client verifies the server certificate and host name like the runtime client (S0.1d20), so without it the run is refused.
6. **A `pg_dump` is taken** (below), the same UTC day.
7. **At least 340 MB is free**: the read-only size check below prints 160,000,000 bytes or less. The script refuses a first run with less, and any run over 400 MB.

### Steps

Run from a checkout of `main`, on Node 22, the same UTC day as the production deploy in the rollout order below. The host and user come from the Supabase dashboard (Connect, session pooler); the password is typed at a hidden prompt into `PGPASSWORD`, which `psql`, `pg_dump` and the script's `pg` client all read from the environment, so it never appears in a URL, a process's arguments, shell history or any `.env*` file. `PGSSLMODE=verify-full` with the pinned root makes `psql` and `pg_dump` verify the server's certificate and host name, as the script does (S0.1d20); libpq's default (`prefer`) neither verifies nor insists on TLS. The opt-in flag `ALLOW_PROD_INGEST` is set to 1 **inline** on the one path C command and is **never stored in any `.env*` file**; a copy in `.env` is ignored.

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null
read -r 'PGHOST?Session-pooler host (*.pooler.supabase.com): '
read -r 'PGUSER?Database user (postgres.<project ref>): '
read -rs 'PGPASSWORD?Database password: '; echo
export PGHOST PGUSER PGPASSWORD PGPORT=5432 PGDATABASE=postgres
export PGSSLMODE=verify-full PGSSLROOTCERT="$HOME/Downloads/prod-ca-2021.crt"   # Supabase's root CA, PEM
export POSTGRES_SSL_ROOT_CERT="$(cat "$PGSSLROOTCERT")"
# Read-only size check: expect 160000000 or less.
PGOPTIONS='-c default_transaction_read_only=on' psql -Atc "SELECT pg_database_size(current_database())"
# Dump outside the repository (the repo is public; *.dump is gitignored only as a backstop).
# pg_dump must be at least the server's major version.
mkdir -p "$HOME/mox-backups"
pg_dump -Fc -f "$HOME/mox-backups/mox-market-$(date -u +%Y%m%d).dump"
# Path A the same day, so path C loads exactly what the dry-run reported. Go on only if it prints "warnings: none".
npx tsx scripts/ingest-mtgjson-history.ts --dry-run
# Path C: identifiers, then prices, in one run. The URL names host, port and database and carries no password.
POSTGRES_URL_NON_POOLING="postgresql://$PGUSER@$PGHOST:5432/postgres" ALLOW_PROD_INGEST=1 npx tsx scripts/ingest-mtgjson-history.ts --production --source-dir .cache/mtgjson
unset PGHOST PGUSER PGPASSWORD PGPORT PGDATABASE PGSSLMODE PGSSLROOTCERT POSTGRES_SSL_ROOT_CERT
```

Use the session pooler (port 5432), as for README "Production". Never the transaction pooler (6543). The script refuses a URL without an explicit port and database, or with a `port`, `dbname`, `database`, `user` or `options` query parameter, so the target line is what it dials.

**Stop unless path A printed `warnings: none`.** A warning there means the files are stale, dated differently from each other, or yield no rows; path C itself refuses a source whose AllPrices is more than one day older than the run date or whose Meta.json date differs, but any other warning is also a reason to stop and ask Bitey.

Expect `target database: <pooler host>:5432/postgres (PRODUCTION)`, then the report with `write: status ok`. The first run writes ≈2.2M price rows; the measured footprint is below. After it, path C sets `synced_at = now()` on all 31 dates, so every printing's history line reads "just now" for up to 36 hours (critique C2-A.7, dismissed as acceptable).

If the run exits 1, re-run the same command: earlier chunks stay committed and the upserts are idempotent. If it exits 3, stop and ask Bitey. A multi-day gap after a failed cron can be refilled by re-running path C under the same preconditions (AllPrices holds 90 days).

### Production rollout order

Step 0, after the S0.1 merge: README "Production" (a) to (d), which are S1.1's baseline diff and resolve and then `0001_price_history`, and (e), `POSTGRES_SSL_ROOT_CERT` in Vercel with a preview smoke check. Then, in this order:

1. Set `CRON_SECRET` in Vercel **Production only**, before production deploys resume. Until then the sync route answers 500 and writes nothing.
2. Resume production deploys after S0.3 is merged and Josh signs off, and confirm a production deployment containing `/api/prices/sync-mtgjson` is live.
3. The same UTC day: path C, identifiers then prices, with the preconditions above.
4. The next day: confirm a cron `ok` run whose `rows_written` is within 10% of the dry-run's rows/day.

Josh removes the Vercel Firewall rule on `/api/prices/snapshot` (V1's writer, deleted by S0.3) only after a production deployment without it is live (step 2); until then the live V1 build still serves that route, and the rule keeps it unreachable.

Start path C outside 16:30 to 18:00 UTC, so it never runs alongside the 17:00 UTC cron: both upsert `price_history`, and a row-lock wait or deadlock between them could end the cron run `error` (S0.3 ADV.5).

```sql
SELECT trigger, status, started_at, finished_at, rows_written, unmapped_uuids, db_bytes
FROM price_sync_runs ORDER BY id DESC LIMIT 5;
```

After step 4, the keep-awake reminder can stop: the daily cron keeps the project awake.

## Measured footprint (path B, S0.2 evidence)

Path B on MTGJson's files of 2026-10-10 (version 5.3.0+20261010), runDate 2026-10-11, into an empty local database on Postgres 14.8 (Supabase runs a newer major; row and index sizes are the same format):

| Table | Rows | Total | Heap | Indexes | Bytes per row |
|-------|-----:|------:|-----:|--------:|--------------:|
| `price_history` | 2,186,341 | 269.5 MB | 149.3 MB | 120.1 MB | 123.2 |
| `mtgjson_identifiers` | 123,830 | 13.4 MB | 9.4 MB | 3.9 MB | 107.8 |
| `price_sync_runs` | 2 | 0.05 MB | 0.01 MB | 0.03 MB | n/a |

`pg_database_size()` went from 9.2 MB to 292.0 MB: **the F0 load adds 282.9 MB**. The first run took 258 s (peak RSS 265 MB) and wrote 2,186,341 price rows and 123,830 identifiers; the second identical run took 272 s, wrote 0 rows and moved no `synced_at`.

**Projected production size after path C** = production's size before it + 282.9 MB, plus F0's +20% churn allowance on `price_history` (≈54 MB) once the daily sync's deletes and inserts start, until S0.3 measures it:

| Production before path C | After path C | With churn (+54 MB) | Against the limits |
|-------------------------:|-------------:|--------------------:|--------------------|
| 30 MB | 313 MB | 367 MB | under the 400 MB warning |
| 63 MB | 346 MB | 400 MB | at the 400 MB warning |
| 113 MB | 396 MB | 450 MB | at the 450 MB stop |
| 160 MB (the most the 340 MB-free rule allows) | 443 MB | 497 MB | over the warning at once, over the stop with churn |

The measured load fits the ruled precondition (282.9 MB < 340 MB free, and 337 MB with churn), but a start near the 160 MB that rule allows would leave the database over 400 MB: S0.3's sync would warn every day and the next bulk run would be refused, and churn would reach the 450 MB stop. **Open ruling for Josh (S0.2 plan, Review):** proceed with path C only when the read-only size check prints 63,000,000 or less, or rule a different bound. The script itself enforces only the ruled 340 MB free.
