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

### Database

```bash
docker compose up -d --wait db
npx prisma migrate deploy
```

This starts Postgres 16 and applies every migration in `prisma/migrations/` (today `0000_baseline`: the V1 `tracked_cards` and `price_snapshots` tables). There is no seed step yet.

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
| `migrate guard: refused ... ALLOW_PROD_MIGRATE=1` | A Prisma command that can connect pointed at a Supabase host. Fix your `.env` to use localhost. Only Josh's production steps (below) set the flag, inline. Known limit: `prisma --config <other file>` never loads `prisma.config.ts`, so it bypasses the guard; never do that against production. |
| `Error: POSTGRES_PRISMA_URL unset` | The app reads only `POSTGRES_PRISMA_URL`: `cp .env.example .env` (or export it), then rerun. `DATABASE_URL` is not read. |
| `P3005: The database schema is not empty` | `migrate deploy` found tables that no migration created (for example from a schema created before Migrate). Locally, drop and recreate the dev database: `docker compose down -v && docker compose up -d --wait db`, then `npx prisma migrate deploy`. Never do this against production. |

## Database and migrations

Prisma Migrate is the only schema tool (ruling C1.01 = A). Migrations live in `prisma/migrations/` and are numbered `0000_baseline` (S1.1), `0001_price_history` (S0.1), `0002_recommendation_log` (S5.1). Apply them locally with:

```bash
npx prisma migrate deploy
```

Agents and CI only ever migrate a local database. `prisma.config.ts` runs a guard (`prisma/migrate-guard.ts`) that refuses every Prisma command that can connect when its host is `*.supabase.co` or `*.pooler.supabase.com`, unless `ALLOW_PROD_MIGRATE=1` is set. The flag is set **inline** for one command and **never stored in any `.env*` file**; a copy in `.env` is ignored. The living ER diagram is `docs/architecture/erd.md`.

### Production (Josh only, once, after the S1.1 merge)

Production's schema was created before Prisma Migrate owned it, so it is baselined once, before S0.1 applies `0001_price_history`. Run from Josh's laptop; the URL is typed at a hidden prompt, so it never reaches shell history or any `.env*` file:

```bash
read -rs 'PROD_DB_URL?Production session-pooler URL (host *.pooler.supabase.com, port 5432): '; echo
POSTGRES_URL_NON_POOLING="$PROD_DB_URL" ALLOW_PROD_MIGRATE=1 npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma
# expect "No difference detected." Any difference: stop, resolve nothing, ask Bitey.
POSTGRES_URL_NON_POOLING="$PROD_DB_URL" ALLOW_PROD_MIGRATE=1 npx prisma migrate resolve --applied 0000_baseline
unset PROD_DB_URL
```

Use the session-pooler string (port 5432). Never use the transaction pooler (6543), and use the direct `db.<ref>.supabase.co` host only on an IPv6 network. `resolve` runs no DDL: it creates `_prisma_migrations` and records one row. To undo it, delete that row (`DELETE FROM _prisma_migrations WHERE migration_name = '0000_baseline'`).

## Stack

- **Next.js 16** (App Router) + React 19 + TypeScript, on **Node 22**
- **Tailwind CSS 4** with the Mox jewel palette (`src/app/tokens.css`)
- **Prisma 7** + Postgres (Supabase in production, Postgres 16 locally and in CI)
- **Scryfall API** for card data and daily price estimates
- **Vitest 4** + React Testing Library, **ESLint 9**, GitHub Actions CI
- **Vercel** hosting

## License

MIT
