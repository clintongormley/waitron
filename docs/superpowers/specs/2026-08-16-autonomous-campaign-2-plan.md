# Autonomous campaign plan — 2 (2026-08-18 → 2026-08-25)

**Status: prepared 2026-08-16; arming for a 2026-08-18 07:00 start.** The owner is away
Wed 2026-08-19 → Tue 2026-08-25 and may run the first item(s) manually on Mon 2026-08-17. This
document records the plan, agreed with the owner on 2026-08-16, to run a second **unattended
autonomous implementation campaign**: work down an ordered queue of pre-specced items, each
implemented with TDD and integrated via `finish-branch` → `land-branch`, with **no human present**.

This is the committed record; it mirrors the first campaign
([2026-08-08-autonomous-campaign-plan.md](2026-08-08-autonomous-campaign-plan.md), which ran
2026-08-09 → 14 and landed #74–#82). The **operational** files live outside the repo, uncommitted, at
`~/waitron-campaign/`: `RUNNER.md` (the per-firing runbook), `queue.md` (the ordered worklist + live
status), `run.sh` (the launchd wrapper), `progress.log` (the runner's running note).

## Decisions (owner, 2026-08-16)

- **Scope: four big items** the owner chose from the tidied backlog — (1) recipe-authoring UI, (2)
  nested sub-recipes, (3) reporting modelo-303 download + quarter/annual periods, (4) sync node-token
  rotation + retention-ops, (5) identity-config flow-down. (Five queue items: the "menu/recipe finish"
  pick is two items, UI then nesting.)
- **Small items: "as many as fit"** — a batch of clean, non-fiscal debt knock-offs interleaved between
  the big items, plus a pool pulled whenever the queue is exhausted or a big item is blocked.
- **Integration: full autonomy** — each item taken to `finish-branch` then `land-branch`, merged to
  `main` unattended once CI is green and Copilot findings are addressed. (The standing "never merge
  without approval" rule is satisfied by choosing this flow, granted for this window.)
- **Execution host: this Mac** (same as campaign 1) — the gate leans on Docker/Testcontainers for the
  real-Postgres RLS/concurrency/immutability suites the cloud sandbox may lack. Requires the Mac
  powered on, logged in, Docker Desktop running.
- **Window: Tue 2026-08-18 07:00 → Tue 2026-08-25 08:00.** Starts Tuesday morning on the fresh weekly
  quota (reset Tue 01:00), so the whole run is on one quota week; ends the morning the owner returns.
  The owner may run the first item(s) manually on Mon 2026-08-17 — anything landed then is marked
  `landed` in `queue.md` so the autonomous run picks up only what is left.
- **Order: recipe/menu leads**, then reporting, then the two sync-family items; small tasks interleaved.

## The queue (ordered; one item in flight at a time — full detail in `~/waitron-campaign/queue.md`)

Big items (🅑) carry a committed spec + plan dated 2026-08-16; small items (🅢) carry an inline brief in
`queue.md` (each derived from a `docs/backlog.md` follow-up entry).

1. 🅑 **Recipe-authoring UI** (sub-project 18) — dashboard surface on the #89 backend; new
   `recipe.manage`; allergen picker seeded from `manual_allergens`. No migration.
2. 🅢 Drop unused `@waitron/shared` dep · 3. 🅢 Normalize the real-PG test filename.
4. 🅑 **Nested sub-recipes** (sub-project 18) — `recipe_lines.component_product_id` XOR `ingredient_id`;
   published-allergen fold (never under-declare); recursive-CTE cycle detection; Kahn-ordered
   propagation. Migration 0043 (packages/db). *Depends on item 1.*
5. 🅢 Hoist `codeOf()` · 6. 🅢 Drop the double `listStaff()`.
7. 🅑 **Reporting — modelo 303 download + quarter/annual** (sub-project 8) — `GET
   /management-api/reports/modelo-303`, new `report.export`, `LiquidationPeriod` union; annual aggregate
   but `toDr303Record` refuses an annual file (that is modelo 390). No migration.
8. 🅢 Non-UUID id → 4xx · 9. 🅢 Park idempotency.
10. 🅑 **Sync — node-token rotation + retention-ops** (#33 §14) — accepted-token SET rotation +
    cursor-report channel + boot retention sweep + explicit (never automatic) `evictSubscriber`.
    Migration 0003 (packages/sync).
11. 🅢 Passkey `transports` populate · 12. 🅢 Pin passkey `userVerification=required`.
13. 🅑 **Identity-config flow-down** (#86) — enrol `persons` + `webauthn_credentials` on the ordered
    lane; exclude all session/challenge tables; app-layer read-only secondary. Migration 0003/0004
    (packages/sync — re-number after item 10). *Shares the packages/sync migration with item 10, so
    they land serially; adds a `@waitron/sync → @waitron/identity` package edge.*

Then the small-item pool (P1–P12 in `queue.md`): create-error-in-modal, select-value-order, passkey
RP-ID-required-at-boot, dup-credential→4xx, place-replay-symmetry, re-hold, node-scope held-order
lookups, `#boot` catch, basket touch-target, malformed-JSON→4xx (cross-cutting), PATCH-authorize-once,
allergen-name drift-guard.

## Autonomy guardrails (full text in `RUNNER.md` §3, H1–H10)

- **H1** one item in flight (serial; interleaving is by queue *order*, avoiding `_journal.json`
  migration collisions). **H2** never autonomously land anything touching the unrepairable fiscal core
  (`computeHuella`, the hash chain, invoice numbering, `registros_facturacion`, the alta builders) —
  on drift, leave the PR `needs-owner-review`, do not land. **H3** never land on a red gate / failing
  guard / unresolved Critical-Important finding. **H4** TDD always, prove every guard by deletion.
  **H5** receipts for claims. **H10** an item that fails twice → `blocked`; three blocks in a row →
  stop the campaign.
- Every spec carries a **Fiscal safety (H2)** section (grep-verified clean) and an
  **Owner-review-assumptions** section naming the decisions to flag `needs-owner-review` rather than
  land unattended (food-safety allergen propagation, permission names, automatic-eviction drift, the
  TOTP-at-rest dependency, the annual-303 decision).

## Mechanism (to verify before arming, not assume)

`~/Library/LaunchAgents/com.waitron.campaign.plist` fires `~/waitron-campaign/run.sh` every 30 min
(`StartInterval=1800`). The wrapper no-ops unless inside the window (Tue 2026-08-18 07:00 → Tue
2026-08-25 08:00), the `~/waitron-campaign/STOP` sentinel is absent, Docker is reachable, and no lock
is held; otherwise it runs `claude -p` (reading `RUNNER.md`) under `caffeinate`. Verify before arming:
the plist is loaded, and `run.sh` no-ops correctly before the window opens (no `claude` launched, no
run log).

## Control

- **Stop early:** `touch ~/waitron-campaign/STOP` (resume: `rm` it).
- **Disarm entirely:** `launchctl bootout gui/$(id -u)/com.waitron.campaign`.
- **Monitor:** `~/waitron-campaign/progress.log`, `~/waitron-campaign/logs/run-*.log`, `gh pr list`.

## On return

Review: landed PRs (already on `main`), any PRs left open marked `blocked` or `needs-owner-review`,
`progress.log`, and the deliberately-excluded bigger threads (fiscal-lane sync H2, cloud-mirror,
promotion/fencing, plate costing / stock / inventory / procurement, the advisor-blocked reporting
slices) — the full remaining-big-items list is in `docs/backlog.md`.
