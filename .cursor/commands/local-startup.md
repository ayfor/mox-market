Start my local Mox Market dev environment and tell me what state it is in. This automates README "Local startup". Work in the repo root.

This is an ops task, not a story: you build nothing, so AGENTS.md's "When you may build" gate and story workflow do not apply. Do not plan, branch, commit, push or edit tracked files, and do not write to Notion, Figma or GitHub. AGENTS.md's Hard limits still bind you in full; the rules below add to them.

Rules
- Permissions: the read-only checks in steps 4, 6 and 7 (netstat, ps, lsof, curl to localhost) and the guarded database commands in steps 5 and 8 cannot run in the sandbox. Ask me once, at the start, to approve full permissions for those commands only. For any other command, keep the stop rule below.
- Local databases only. Never export, set or unset POSTGRES_PRISMA_URL, POSTGRES_URL_NON_POOLING, DATABASE_URL or any PG* variable. Run every database command (step 5, and path B if I approve it) in the same terminal call as GUARD, written as `GUARD && <command>`, where GUARD stands for the whole one-line command below. If it prints STOP, stop and tell me.
  GUARD:
  ```
  B=$({ env; cat .env* 2>/dev/null; } | grep -oE "postgres(ql)?://[^[:space:]\"]+" | sed -E "s|^[a-z]+://||; s|^[^/?#]*@||; s|[:/?#].*||" | grep -vxE "localhost|127\.0\.0\.1"; { env; cat .env* 2>/dev/null; } | grep -oE "postgres(ql)?://[^[:space:]\"]+" | grep -oiE "[?&]host(addr)?=[^&#]*"; env | grep -oE "^PG(HOST|HOSTADDR|SERVICE|SERVICEFILE)="); if [ -n "$B" ]; then echo "STOP: non-local database setting: $B"; false; else echo "host checks: local only"; fi
  ```
- Never open, cat, grep or print any .env* file yourself: they hold passwords and CRON_SECRET. Use only the commands below. (.cache/mtgjson/Meta.json is not an env file and is fine to read.)
- Never: touch production or any Supabase host, run the ingest with --production, set ALLOW_PROD_INGEST or ALLOW_PROD_MIGRATE, run `vercel env pull`, `npm install`, `dropdb`, `createdb`, `initdb`, `docker compose down -v`, `prisma migrate reset`, `migrate dev`, `migrate resolve`, `db push` or `db execute`, delete postmaster.pid, or apply README Troubleshooting fixes.
- The only database commands you may run are `prisma migrate status`, `prisma migrate deploy` and the step 5 query.
- Ask me first before: loading or refreshing price history (path A downloads about 380 MB; paths A and B each took about 5 minutes on an idle Mac), creating a database or cluster, applying migrations on a branch other than main, or stopping or restarting any process you did not start.
- Every node, npm and npx command starts with `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null &&`, because each terminal call may be a fresh shell and the default Node is too old. The commands below already include it; run them exactly as written.
- Stop on anything this prompt does not name: a failed command, an error code or output you did not expect. Quote it and stop; do not try variants. If I reject a command, or a command outside the approved set fails with "Operation not permitted" or another sandbox error, stop and report it; a sandbox error is not evidence that a service is down.
- The only file you may create is .env, copied from .env.example if it is missing. Build output and logs (.next/, ~/.mox-market/pg.log) are fine.

Steps
1. Node: `source ~/.nvm/nvm.sh && nvm use 22` must select Node 22.
2. Dependencies: if node_modules or src/generated/prisma is missing, run `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm ci`.
3. Environment: if .env is missing, `cp .env.example .env`. Run GUARD. Then print the database host and port, nothing else:
   ```
   source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && node --env-file=.env -e 'try{const u=new URL(process.env.POSTGRES_URL_NON_POOLING);console.log(u.hostname+":"+(u.port||"5432"))}catch{console.error("POSTGRES_URL_NON_POOLING missing or invalid")}'
   ```
4. Postgres: run `netstat -anv -p tcp | grep LISTEN | grep -E '[.:]<port> '` (lsof without sudo misses servers that other users own). One of the middle columns reads process:pid (for example `postgres:69096`); run `ps -o user=,command= -p <pid>` on that pid.
   - It is `postgres -D` followed by `$HOME/.mox-market/pgdata`: it is up. Go to step 5.
   - Nothing listens: start the first setup that applies, then run the netstat check again.
     - Native: ~/.mox-market/pgdata/PG_VERSION exists. Run `/Library/PostgreSQL/$(cat ~/.mox-market/pgdata/PG_VERSION)/bin/pg_ctl -D ~/.mox-market/pgdata -l ~/.mox-market/pg.log start -w`. If that binary does not exist, stop; never use the pg_ctl on PATH. If it fails, quote the last 20 lines of ~/.mox-market/pg.log and stop.
     - Docker: `docker info` succeeds. Run `docker compose up -d --wait db`.
     - Supabase CLI: the port is 54322 and `supabase` is installed. Run `supabase start`.
     - None of these: stop and tell me. Do not set one up.
   - Anything else holds the port (a postgres with another data directory, ssh, kubectl, cloud-sql-proxy, pgbouncer, a process owned by another user): stop and tell me. It may forward to a remote database.
5. Migrations and history: run `GUARD && source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx prisma migrate status`.
   - "Database schema is up to date!": continue.
   - Pending migrations: if `git branch --show-current` prints main, run `GUARD && source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx prisma migrate deploy`, then status again. On any other branch, list them and ask me.
   - P1001: go back to step 4 once, then stop. Any other result (P1000, P1003, P3005, P3009, drift, "migrate guard: refused"): quote it and stop.
   Then run the history query:
   ```
   GUARD && source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && node --env-file=.env -e 'const {Client}=require("pg");(async()=>{const c=new Client({connectionString:process.env.POSTGRES_URL_NON_POOLING});await c.connect();const h=await c.query("select count(*)::int as rows, max(date)::text as newest_price_date from price_history");const r=await c.query("select trigger, status, source_date::text, finished_at from price_sync_runs order by id desc limit 1");console.log(JSON.stringify({history:h.rows[0],lastRun:r.rows[0]??null}));await c.end()})().catch(e=>{console.error(e.code||e.name);process.exit(1)})'
   ```
   Judge freshness only from newest_price_date. The page's "newest … ago" line and the out-of-date banner both measure when rows were loaded, so a load from an old cache makes stale prices look current.
6. Dev server: run `lsof -nP -tiTCP:3000 -sTCP:LISTEN`.
   - A PID: Next 16 renames its listener to `next-server (v16.x)`, so check its parent and directory. `ps -o command= -p "$(ps -o ppid= -p <pid>)"` must end in `node_modules/.bin/next dev`, and `lsof -a -p <pid> -d cwd -Fn` must print `n` followed by this repo's root (`pwd -P`). If both match, reuse it and never stop or restart it. You cannot see its output, so you cannot confirm `.env` loaded or see `[evaluation]` lines; say so in the report. Anything else on 3000: stop and tell me.
   - Nothing: start `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run dev` with your terminal's background option, never in the foreground. Wait with `for i in {1..60}; do curl -s -o /dev/null --max-time 2 http://localhost:3000/ && break; sleep 2; done`, then read that terminal's output and confirm it includes `- Environments: .env`.
7. Smoke check. Run exactly this, and never print the raw page (about 100 KB on one line):
   ```
   curl -s --max-time 60 -w '\nHTTP_STATUS %{http_code}\n' 'http://localhost:3000/Esper%20Sentinel?price=74.99' | grep -oE "HTTP_STATUS [0-9]+|Price history: [0-9]+ snapshots, newest [a-z0-9 ]+ ago|No price history yet for this printing|Price history temporarily unavailable|Price data is temporarily out of date|Couldn.t reach price data|Couldn.t find that card" | sort -u
   ```
   Report every line; more than one can apply.
   - "Price history: N snapshots, newest …": history is served.
   - "No price history yet for this printing": the tables are empty.
   - "Price history temporarily unavailable": the reader failed. If you started the server, quote its `[evaluation]` lines, which name an error and a code such as `POSTGRES_PRISMA_URL_UNSET` or `42P01`. If you reused it, say you cannot see them, and suggest I restart it where its output is visible.
   - "Price data is temporarily out of date": no successful load in the last 48 hours. It can appear alongside any of the others.
   - "Couldn't reach price data", "Couldn't find that card", a status other than 200, or only the status line: the card did not render (for example, Scryfall is unreachable). Report it and stop.
8. Report. Print this table even if you stopped early: put the stop reason first, fill in the rows you reached, and write "not run" for the rest. Finish with `git status --porcelain` and list anything it prints.

   | Item | State |
   |------|-------|
   | Node | version |
   | Postgres | setup, port, already running or started by you |
   | Migrations | up to date, or what was applied |
   | History | rows, newest_price_date, last run trigger, status and source_date |
   | Cache | the date from .cache/mtgjson/Meta.json, or "missing" |
   | Dev server | URL; reused or started; `.env` loaded, or "not observable (reused)" |
   | Smoke check | the lines from step 7 |

   Read the cache date with `grep -oE '"date": *"[0-9-]+"' .cache/mtgjson/Meta.json | head -1`. Then say what I should do next, if anything. If the history is empty or newest_price_date is more than 2 days old, offer a refresh and wait for my answer:
   - Cache dated today (UTC): path B alone, `GUARD && source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx tsx scripts/ingest-mtgjson-history.ts --source-dir .cache/mtgjson`.
   - Cache older or missing: path A, `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx tsx scripts/ingest-mtgjson-history.ts --dry-run` (downloads today's files), then path B as above. Never offer path B alone on an older cache.
   After a refresh, list any dates the reports show as missing; those are MTGJson gaps, not load errors.
