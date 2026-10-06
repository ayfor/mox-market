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

