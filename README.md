# Mox Market

**[Live site](https://mox-market.vercel.app)** (still serves V1 while V2 is built)

Mox Market answers one question about a Magic: The Gathering card: *is this asking price a good price?* V2 returns a **Buy / Fair / Wait** recommendation with a one-sentence reason built only from observed price facts. V2 is in progress: the engine contract, the test tooling and the migration baseline land first (story S1.1), and the live site keeps serving the V1 build until the V2 result page, attribution footer and entry points are on `main`.

Built by **Twin Spruce Studio** (`@tss/mox-market`).

> **Note:** This project was created as a personal tool and as an exploration of what modern AI tooling can achieve when given a structured local information system as context. The codebase was generated through collaborative AI-assisted development using Claude Code, guided by a knowledge base of project history, design decisions, and technical constraints.

## Getting started

Follow these steps in order from a fresh clone. Nothing else is needed.

### Prerequisites

- [nvm](https://github.com/nvm-sh/nvm) and **Node 22** (pinned in `.nvmrc` and `package.json` `engines`). Next 16, Prisma 7 and the test tooling do not run on Node 18.
- A local **Postgres 16** on `localhost:5432`: [Docker Desktop](https://www.docker.com/products/docker-desktop/) with Compose (recommended; `compose.yaml` defines it), or the [Supabase CLI](https://supabase.com/docs/guides/cli) as an alternative (see Troubleshooting).

### Install

```bash
nvm install
nvm use
npm ci
```

`npm ci` also runs `prisma generate` (the `postinstall` script), which writes the Prisma client to `src/generated/prisma`.

### Environment

```bash
cp .env.example .env
```

`.env.example` holds local placeholders only: both database URLs point at `localhost`, and `CRON_SECRET` is `replace-me` (generate a real one with `openssl rand -hex 32`; it is needed from S0.3). Never put a production URL or a real secret in any `.env*` file.

| Variable | Read by |
|----------|---------|
| `POSTGRES_PRISMA_URL` | the app at runtime (`src/lib/prisma.ts`, the only name it reads) |
| `POSTGRES_URL_NON_POOLING` | Prisma CLI and migrations (`prisma.config.ts`), integration tests |
| `CRON_SECRET` | the price-sync cron route (from S0.3) |
| `POSTGRES_SSL_ROOT_CERT` | the app at runtime, for a remote (Supabase) host only: the root certificate, PEM, that the database's certificate must chain to (`src/lib/prisma-pool.ts`). Set in Vercel by Josh (Production step (e)); leave it out of `.env*` locally, where `localhost` uses no TLS |
| `ALLOW_PROD_INGEST` | the MTGJson ingest script, path C only (`docs/runbooks/mtgjson-ingest.md`): set to 1 **inline** by Josh on the one production command, never stored in any `.env*` file (a copy there is ignored) |

### Database

```bash
docker compose up -d --wait db
npx prisma migrate deploy
```

This starts Postgres 16 and applies every migration in `prisma/migrations/`: `0000_baseline` (the V1 `tracked_cards` and `price_snapshots` tables) and `0001_price_history` (F0's `price_history`, `mtgjson_identifiers` and `price_sync_runs` tables and their enums). The price-history tables start empty, so every card reads `insufficient_data` until you load them with the MTGJson ingest's path B (see "MTGJson price history" below).

### Run

```bash
npm run dev        # http://localhost:3000
npm test           # Vitest: unit, component, integration and type tests
npm run lint       # ESLint 9 flat config
npm run build      # prisma generate + next build
npm run test:report  # writes docs/test-report.md, grouped by feature
```

Integration tests (`*.int.test.ts`) create and drop their own scratch database on the server named by `POSTGRES_URL_NON_POOLING`, and refuse any host other than `localhost` or `127.0.0.1`. If no local Postgres answers within 3 seconds they skip with a warning; in CI (`CI=true`) they fail instead.

### Troubleshooting

| Symptom | Fix |
|---------|-----|
| `SyntaxError`, `Unsupported engine` or `Prisma only supports Node.js >= 20.19` | You are on the default Node 18. Run `nvm use` in this directory first (every new shell). |
| `P1001: Can't reach database server at localhost:5432` | Postgres is not running: `docker compose up -d --wait db`, then retry. |
| `docker compose up` fails with `port is already allocated` on 5432 | Another Postgres holds the port. Stop it (`brew services stop postgresql@14`, or the EDB `postgresql-14` launch daemon: `sudo launchctl unload /Library/LaunchDaemons/postgresql-14.plist`), then retry. Check with `lsof -nP -iTCP:5432 -sTCP:LISTEN`. |
| Supabase CLI instead of Docker Compose | `supabase start` serves Postgres on port **54322**: change both URLs in `.env` to `postgresql://postgres:postgres@localhost:54322/postgres`. |
| `migrate guard: refused ... ALLOW_PROD_MIGRATE=1` | A Prisma command that can connect pointed at a Supabase host, possibly through a `?host=` parameter or the shadow database URL. Fix your `.env` to use localhost. A refusal naming a `host query parameter` means a `?host=` points somewhere other than `localhost`, `127.0.0.1` or a socket directory: remove it. Only Josh's production steps (below) set the flag, inline. Known limit: `prisma --config <other file>` never loads `prisma.config.ts`, so it bypasses the guard; never do that against production. |
| `Error: POSTGRES_PRISMA_URL unset` | The app reads only `POSTGRES_PRISMA_URL`: `cp .env.example .env` (or export it), then rerun. `DATABASE_URL` is not read. |
| `P3005: The database schema is not empty` | `migrate deploy` found tables that no migration created (for example from a schema created before Migrate). Locally, drop and recreate the dev database: `docker compose down -v && docker compose up -d --wait db`, then `npx prisma migrate deploy`. Never do this against production. |

## Database and migrations

Prisma Migrate is the only schema tool (ruling C1.01 = A). Migrations live in `prisma/migrations/` and are numbered `0000_baseline` (S1.1), `0001_price_history` (S0.1), `0002_recommendation_log` (S5.1). Apply them locally with:

```bash
npx prisma migrate deploy
```

Agents and CI only ever migrate a local database. `prisma.config.ts` runs a guard (`prisma/migrate-guard.ts`) that refuses every Prisma command that can connect when any host it would reach is `*.supabase.co` or `*.pooler.supabase.com`, unless `ALLOW_PROD_MIGRATE=1` is set. It checks the URL's hostname, any `?host=` parameter (which overrides the hostname), every `--url` value and, for commands that use one, the shadow database URL; a URL with `hostaddr=`, an empty host, or a `?host=` naming anything but `localhost`, `127.0.0.1` or a socket directory is refused outright, flag or not (put a remote host in the URL itself). The flag is set **inline** for one command and **never stored in any `.env*` file**; a copy in `.env` is ignored. The living ER diagram is `docs/architecture/erd.md`.

### Production (Josh only, after the S0.1 merge, before production deploys resume)

Production's schema was created before Prisma Migrate owned it, so it is baselined once (S1.1's `0000_baseline`), and then `0001_price_history` is applied. `0001` is additive: it creates F0's three tables and their enums, turns on row level security for them, and leaves V1's tables untouched, so `0001` needs no `pg_dump`. That exemption covers `0001` only: any later migration that drops, renames or rewrites anything needs a manual `pg_dump` first (AGENTS.md, Migrations). `0001` runs in one transaction, so it applies completely or not at all. Josh runs the steps below in order, after the S0.1 merge and before production deploys resume, from a checkout of the S0.1 merge commit (`git switch --detach <the S0.1 merge commit>`), so no later migration is pending. Run from Josh's laptop; the URL is typed at a hidden prompt, so it never reaches shell history or any `.env*` file, and `ALLOW_PROD_MIGRATE=1` is set inline on each command:

```bash
read -rs 'PROD_DB_URL?Production session-pooler URL (host *.pooler.supabase.com, port 5432): '; echo
git show 9a2837b:prisma/schema.prisma > "${TMPDIR:-/tmp}/schema-0000.prisma"   # the baseline-era schema (S1.1 merge)
# (a) Read-only: production against the baseline-era schema.
POSTGRES_URL_NON_POOLING="$PROD_DB_URL" ALLOW_PROD_MIGRATE=1 npx prisma migrate diff --from-config-datasource --to-schema "${TMPDIR:-/tmp}/schema-0000.prisma"
# expect "No difference detected." Any difference: stop, resolve nothing, ask Bitey.
# (b) Record the baseline as applied (no DDL).
POSTGRES_URL_NON_POOLING="$PROD_DB_URL" ALLOW_PROD_MIGRATE=1 npx prisma migrate resolve --applied 0000_baseline
# (c0) Pre-check: this checkout holds exactly the two migrations, and production has only 0001 pending.
test "$(ls -1 prisma/migrations | grep -E '^[0-9]{4}_' | tr '\n' ' ')" = "0000_baseline 0001_price_history " && echo "migrations: OK" || echo "STOP: this checkout has other migrations"
POSTGRES_URL_NON_POOLING="$PROD_DB_URL" ALLOW_PROD_MIGRATE=1 npx prisma migrate status
# expect "migrations: OK", and status naming 0001_price_history as the only migration not yet applied. Anything else: stop, apply nothing, ask Bitey.
# (c) Apply 0001_price_history (additive, one transaction).
POSTGRES_URL_NON_POOLING="$PROD_DB_URL" ALLOW_PROD_MIGRATE=1 npx prisma migrate deploy
# (d) Confirm: both migrations applied, and production matches the schema.
POSTGRES_URL_NON_POOLING="$PROD_DB_URL" ALLOW_PROD_MIGRATE=1 npx prisma migrate status
POSTGRES_URL_NON_POOLING="$PROD_DB_URL" ALLOW_PROD_MIGRATE=1 npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma
# expect "No difference detected."
unset PROD_DB_URL
```

Step (a) compares against the baseline-era schema because `prisma/schema.prisma` now also holds F0's tables, which production lacks until step (c). Use the session-pooler string (port 5432). Never use the transaction pooler (6543), and use the direct `db.<ref>.supabase.co` host only on an IPv6 network. `resolve` runs no DDL: it creates `_prisma_migrations` and records one row. To undo it before step (c), delete that row (`DELETE FROM _prisma_migrations WHERE migration_name = '0000_baseline'`). Until step (c) runs, preview deployments, which share the production database, show "Price history temporarily unavailable" on every result.

**After step (d)**, in the Supabase dashboard: the Security Advisor lists no `rls_disabled_in_public` finding for `price_history`, `mtgjson_identifiers` or `price_sync_runs` (V1's two tables may still be listed; they predate this story).

**If step (c) fails:** stop. Because `0001` is one transaction, none of its objects is left behind; Prisma marks the migration failed, and a second deploy refuses with P3009. With the same inline prefix, run `migrate status` to confirm, then `migrate resolve --rolled-back 0001_price_history`, find the cause with Bitey, and only then re-run step (c). Prisma may print "current transaction is aborted" instead of the first error. Never use `migrate resolve --applied 0001_price_history` unless all three tables, their enums, the CHECK, both autovacuum settings and row level security are present.

**(e) Runtime read path, before production deploys resume.** Steps (a) to (d) go through the Prisma CLI, which encrypts but does not verify the server certificate. The app's runtime client (`src/lib/prisma-pool.ts`) always verifies a remote host's certificate and host name, and Supabase signs its certificates with its own root CA, which Node does not trust by default. So: download that root certificate from the Supabase dashboard (Database settings, SSL configuration), set its PEM text as `POSTGRES_SSL_ROOT_CERT` in Vercel for Production and Preview, redeploy a preview, and open `/Esper%20Sentinel?price=74.99` there. Expect "No price history yet for this printing." (the tables stay empty until Josh's path C ingest, `docs/runbooks/mtgjson-ingest.md`), not "Price history temporarily unavailable", and no `history_read_failed` or `freshness_read_failed` line in the function logs. A failure line ends with its codes: `TlsConnectionError` means the certificate is missing or wrong, `TableDoesNotExist 42P01` means step (c) has not reached that database.

## MTGJson price history

F0's history (`price_history`, `mtgjson_identifiers`, `price_sync_runs`) is loaded from MTGJson v5 by `scripts/ingest-mtgjson-history.ts`: paper TCGplayer retail USD only, the last 31 UTC dates, gated, in integer cents (`docs/architecture/data-provenance.md`). The full procedure, including production, is the runbook: [`docs/runbooks/mtgjson-ingest.md`](docs/runbooks/mtgjson-ingest.md).

```bash
npx tsx scripts/ingest-mtgjson-history.ts --dry-run                         # path A: download into .cache/mtgjson, report, no database
npx tsx scripts/ingest-mtgjson-history.ts --source-dir .cache/mtgjson       # path B: load your local database (localhost only)
```

Path B writes to `POSTGRES_URL_NON_POOLING` and refuses any host but `localhost` or `127.0.0.1`. It takes about four minutes and ≈285 MB of database space. Path C (production) is Josh's alone.

## Stack

- **Next.js 16** (App Router) + React 19 + TypeScript, on **Node 22**
- **Tailwind CSS 4** with the Mox jewel palette (`src/app/tokens.css`)
- **Prisma 7** + Postgres (Supabase in production, Postgres 16 locally and in CI)
- **Scryfall API** for card data and daily price estimates
- **Vitest 4** + React Testing Library, **ESLint 9**, GitHub Actions CI
- **Vercel** hosting

## License

MIT
