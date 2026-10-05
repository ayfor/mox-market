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
