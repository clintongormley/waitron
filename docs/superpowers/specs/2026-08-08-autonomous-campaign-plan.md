# Autonomous campaign plan — 2026-08-08 → 2026-08-14

**Status: armed.** The owner is away Sun 2026-08-09 → Fri 2026-08-14 and the weekly quota renews Tue
2026-08-11 01:00. This document records a plan, agreed with the owner on 2026-08-08, to run an
**unattended autonomous implementation campaign** over that window: work down an ordered queue of
already-specced projects, each implemented with TDD and integrated via `finish-branch` →
`land-branch`, with **no human present**.

This is the committed record. The **operational** files live outside the repo, uncommitted, at
`~/waitron-campaign/`: `RUNNER.md` (the runbook each run follows), `queue.md` (the ordered worklist +
live status), `run.sh` (the launchd wrapper), and `progress.log` (a running note the runner appends).

## Decisions (owner, 2026-08-08)

- **Integration: full autonomy.** Each item is taken to `finish-branch` then `land-branch` — merged
  to `main` unattended once CI is green and Copilot findings are addressed. (The standing rule is
  "never merge without approval"; choosing this flow *is* that approval, granted for this window.)
- **Execution host: this Mac**, not a cloud routine — because the gate leans on Docker/Testcontainers
  for the real-Postgres tests (RLS, concurrency, the immutability guards), which the cloud sandbox may
  lack. Requires the Mac powered on, logged in (keychain unlocked), and Docker Desktop running.
- **Pictures (menu UI): local-file storage** (a `products.image` path column + a server upload/serve
  route), not bytes-in-DB.
- **Order: sync leads**; small tasks interleaved between the big pieces.
- **Excluded** (not autonomy-safe): anything advisor-blocked (F3/Q14/SumUp/non-común tax modules/the
  cloud-hosting question), open product decisions (orphan-drift hold, migrate-gate), the migration
  baseline collapse (backlog says "not now"), and the fiscal-core refactors (finalize\*/alta-builder)
  that want a supervised huella-invariance review. **Recipes/BOM was offered and declined** for this
  window (too many product + food-safety decisions to model unsupervised).

## The queue (ordered; one item in flight at a time)

Big pieces (🅑) carry a committed spec + plan dated 2026-08-08; small tasks (🅢) carry an inline brief
in `~/waitron-campaign/queue.md` (each derived from a `docs/backlog.md` follow-up entry).

1. 🅑 **Sync slice 1 — commercial outbox.** The backlog's largest unbuilt piece (design + 9 passing
   container gates already on `main`). Slice 1 = the `sync_log` + capture-trigger outbox and the
   apply loop for the **commercial lane only**; the fiscal `registros`/hash-chain lane is **deferred
   to an owner-reviewed slice** (unrepairable core).
2. 🅢 Shared `createErrorBoundary` (dedup the identical `run` boundary in management-api/till-api).
3. 🅑 **Reporting — date-range VAT summary + `modelo 303`.** Scope corrected during planning
   (verified 2026-08-08): persisting the filed desglose and making `computeVatSummary` exact
   **already landed in #66** (`sales.vat_breakdown`, migration 0032; `vat-summary.ts:9,28` reads it),
   so this slice builds only the genuinely-unstarted `computeVatSummaryForPeriod` (date range) and
   `computeVatReturn` (modelo 303 output-VAT aggregate, per-obligado). Pure reads over the existing
   column — **no migration**. Must not change `computeHuella`.
4. 🅢 Hoist `percentOf`/`taxOf` into `@waitron/shared` (third copy).
5. 🅑 **Catalogue / menu management UI.** The owner-facing item editor that does not exist yet: a
   `/management-api` write surface + dashboard screens (price/VAT/allergens/categories) + **local-file
   product images**.
6. 🅢 otplib v13 + `totp.ts` rewrite.
7. 🅢 `errors.reachability.test.ts` real fix (a `tsc`-based downstream probe; the current test passes
   with the import removed).
8. 🅑 **Counter POS layout & receipt editors** (lowest priority; the `LayoutDef`/config seam exists,
   unread).
9. 🅢 First-admin dashboard password (the one gap before a true end-to-end first login).
10. 🅢 Dashboard 1c row-edit actions (wire the no-op "Editar" button to existing `DashboardApi` methods).
11. 🅢 Dashboard 1c i18n layer (codes → localised copy, mirroring `apps/till/src/i18n`).

## Autonomy guardrails (full text in `RUNNER.md` §3)

- One item in flight at a time (serial execution; interleaving is by queue *order*, not concurrency —
  avoids `drizzle/meta/_journal.json` migration collisions with no human to untangle them).
- **Never autonomously land anything touching the unrepairable fiscal core** (`computeHuella`, the
  hash chain, invoice numbering, `registros_facturacion`, the alta builders). If an item drifts into
  them: leave a PR marked `needs-owner-review`, do not land.
- Never land on a red gate, failing guard suite, or an unresolved Critical/Important finding — leave
  the PR, mark `blocked`, move on.
- TDD always; prove every new guard by deletion. Receipts for claims (CLAUDE.md §1).
- Bounded failure: an item that fails twice is `blocked`; three consecutive blocks stops the campaign.

## Mechanism (verified 2026-08-08, not assumed)

`~/Library/LaunchAgents/com.waitron.campaign.plist` fires `~/waitron-campaign/run.sh` every 30 min.
The wrapper no-ops unless inside the window (Tue 2026-08-11 01:07 → Fri 2026-08-14 08:00), a
`~/waitron-campaign/STOP` sentinel is absent, Docker is reachable, and no lock is held; otherwise it
runs `claude -p` (reading `RUNNER.md`) under `caffeinate`. Verified end-to-end before arming:

- headless `claude -p` authenticates and returns (receipt: a trivial prompt round-tripped);
- headless `claude -p --dangerously-skip-permissions` uses tools (receipt: returned `BRANCH=main`
  via the Bash tool);
- the **full launchd → wrapper → claude chain** authenticates under launchd's own session and uses
  tools (receipt: a throwaway `RunAtLoad` agent returned `LAUNCHD_CHAIN_OK=main`, rc=0, Docker "UP");
- the wrapper correctly no-ops out of window (receipt: run on 2026-08-08 wrote no run log).

## Control

- **Stop early:** `touch ~/waitron-campaign/STOP` (resume: `rm` it).
- **Uninstall:** `launchctl bootout gui/$(id -u)/com.waitron.campaign` then remove the plist.
- **Monitor:** `~/waitron-campaign/progress.log`, `~/waitron-campaign/logs/run-*.log`, `gh pr list`.

## On return

Review: landed PRs (already on `main`), any PRs left open marked `blocked` or `needs-owner-review`,
`progress.log`, and the fiscal `registros`/hash-chain sync lane deliberately deferred from item 1.
