# Model seats experiment — Fable 5.1 vs Opus 5.1 vs gpt-6-astra in the run-it reviewer seat

**Date:** 2026-09-05. **Question:** which model earns the `/finish-branch` run-it reviewer seat, the
one seat with a record of finding bugs every read-only layer missed (#119, #124, #195), now that the
session default is being moved off Fable for cost and Codex (`gpt-6-astra`, ChatGPT plan) is available.

## Design

A throwaway branch off `main` (`ff37904d`) with one commit touching only
`apps/server/src/working-order.ts`, carrying three planted defects of the classes CLAUDE.md §1 and
§5 exist for:

1. **Lock-order swap in `mergeTabs`** — `dining_tables` locked before `working_orders`, the inverse of
   `payWorkingOrder`'s order, with a new comment claiming the two classes are "acquired together" inside
   one statement. The existing `move-merge.rls.test.ts` race (real Postgres) catches it; the docstring
   above it was left standing as a contradicting twin.
2. **Adjacency-only duplicate check in `assertDistinctTransferLines`** — the `Set` replaced by a
   `previous === lineNo` comparison, justified by "the till sends batches sorted". Every existing
   duplicate test uses an adjacent pair, so no suite catches it; a `[1, 2, 1]` batch fabricates quantity.
3. **False receipt in the PR description** — "Ran `pnpm --filter @waitron/server test move-merge
   transfer-lines split-bill`: green" (the rls suite fails on that command).

Each reviewer got the identical brief (the finish-branch step 2 run-it paragraph verbatim, the diff,
the PR description, an output format with a claims/experiments table) and its own worktree at the
head commit with dependencies installed. Fable and Opus ran as fresh Claude subagents from a Fable
session; Astra ran through `codex exec --sandbox workspace-write` with the network switch on. None
was told what was planted.

## Results

| | Fable 5.1 | Opus 5.1 | gpt-6-astra |
|---|---|---|---|
| Planted 1 (deadlock) | found; deterministic two-backend staging, pay the victim; base order as control | found; race test 5/5 red, victim probe 3/3 | found; paused-pay staging 3/3, base control 3/3, sale count 0 vs 1 |
| Planted 2 (duplicates) | found; `[1,2,1]` on both verbs, 4 from 3; base rejects | found; probe with control (Set restored) | found; exhaustive oracle over 364 batches, fiscal filing of the inflated total shown |
| Planted 3 (false receipt) | falsified by running the command | falsified | falsified |
| Motivation claim ("table-less order refused") | falsified, filed Minor | falsified, filed Critical | falsified, filed Important |
| Unplanted stale claims found | `mergeTabs` docstring twin | `mergeTabs` twin **plus `unjoinTable` docstring** (`working-order.ts:2656`, "MATCHES … mergeTabs") | `mergeTabs` twin **plus the planner claim** (`:2170` "UNINDEXED `tab_id`, so both backends seq-scan"; `EXPLAIN` as `app_user` shows `LockRows → Sort → Bitmap Heap Scan` on the tenant index) |
| False positives | 0 | 0 (merge-vs-unjoin race labelled UNVERIFIED) | 0 (two claims labelled UNVERIFIED) |
| Verdict | No | No | No |
| Wall clock | 5.5 min | 5.5 min | 14 min |
| Tokens (as reported by the harness) | 94.7k | 84.6k | 3.08M input (2.97M cached), 22.8k output, 9.9k reasoning |
| Billed to | Claude, Fable rate | Claude, Opus rate (half of Fable per token) | ChatGPT plan |
| Worktree left | clean | clean | clean but for an untracked `review-artifacts/` (probe sources and logs, useful) |

Both unplanted findings were verified afterwards against `main` by reading the source and Astra's
archived plan output; both are real stale claims and are recorded in `docs/backlog.md` → _Debt_.

## Reading

- On the planted defects there is no separation: all three ran the decisive experiments with a control
  in the other direction, and all three refused the merge.
- Fable found nothing the others did not, at the highest price per token. Its one edge was the tightest
  deadlock staging (it showed the sale as the victim, which the race test asserts and which Opus's
  runs did not exhibit).
- Opus and Astra each found one real stale claim outside the diff that the others missed. Astra was
  the most thorough (it also ran the whole server coverage suite, 2,494 tests, and an exhaustive
  duplicate oracle) and the slowest, and it costs nothing from the Claude budget.
- One experiment on one file with defects of known classes is a probe, not a measurement of the seat.
  The yardstick in CLAUDE.md §6 (fix rounds before land, diff-review catches, false claims at
  whole-branch review, Codex tasks needing a Claude fix round) is what decides over the till-reroute
  slices.

## Decision (owner, 2026-09-06)

Run-it reviewer to Astra; plan-vs-spec review to Astra as well (Fable writes the plan, so it is
still a different reader); Fable keeps the sessions the owner talks in, a new fresh-context review
of any spec touching CLAUDE.md §5, and fix-loop round five; Opus keeps the execution driver, the
per-task reviewer and the convention reviewer, so every stage has one reader that is not the code's
author. Copilot's automatic review was switched off. Rule text: `~/.claude/CLAUDE.md`, `CLAUDE.md`
§6, `/finish-branch` step 2. Still pending: dispatching `/simplify`'s lenses through Codex.
