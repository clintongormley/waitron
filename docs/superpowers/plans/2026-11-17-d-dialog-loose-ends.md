# D-DIALOG-LOOSE-ENDS implementation plan

**Goal:** Keep the station chooser and its buttons still while staff choose a station; remove the four resolved backlog observations.
**Authority:** Exact ask: `/Users/clintongormley/waitron-campaign-d/queue.md`, D-DIALOG-LOOSE-ENDS, “Ask”.
The queue authorizes the outcome. This separately authored plan awaits Claude review and watcher clearance; no owner plan approval is claimed.
**Scope decision for the watcher:** The reproduced station defect belongs to the till, despite the queue's dashboard heading.
Clear that boundary explicitly before building; do not substitute an unrelated dashboard station screen.
**Execution:** Inline, using `superpowers:executing-plans` and TDD after clearance; no new helpers or framework.

## Evidence and smallest result

Driver probes on main base `7f0ad91e2605f37c13171964ac13c15d364a544c` (2026-11-17, about 06:56):

- Theme first-save/copy: visible native Back dismisses after `wt-close` without submitting; “A331 look canvas (copy)” fits at 1280px (2 passed).
- Printer discovery: fresh and retained/disabled rows say Add; fresh opens “Add a printer”/Add, retained adds directly without naming (2 passed).
- Till station choice: native width changes from 245.53125px to 204.734375px after choosing Grill; width invariant fails (1 failed).

Receipts and saved temporary probe texts: `/Users/clintongormley/waitron-campaign-d/receipts/dialog-loose-ends/` (`theme-probe.log`, `printer-probe.log`, `station-probe.log`).
These are driver measurements, not new executions by this plan author. Recheck against current main before build/backlog deletion if it has moved.

## Files and reuse

- `apps/till/src/widgets/station-choice-dialog.ts`: size only its `.body` using the existing sibling pattern below.
- `apps/till/src/widgets/station-choice-dialog.test.ts`: add focused browser geometry assertions using existing `mount`/`choose` helpers.
- `docs/backlog/dashboard.md`: remove the Hardware forms' three stale observations and the fixed Station dialog width subsection; preserve surrounding work.
- `docs/superpowers/plans/2026-11-17-d-dialog-loose-ends.md`: this plan; `docs/backlog.md` only if an actual index/count becomes stale.

Reuse `find-bill-dialog.ts:50` / `split-joined-dialog.ts:46`: `width: min(var(--wt-form-max-width), calc(var(--wt-dialog-max-width) - 2 * var(--wt-space-5)))`.
Keep `wt-dialog`, `trackDialog()`, combobox, footer slots, event payloads and draft/close handling as they are.

## Build and checks

- [ ] Before building, driver obtains Claude plan review with `~/workspace/tools/claude-seat.sh review-branch <checkout> <brief-file> <report-file>`; inspect completed findings, address them, then obtain watcher clearance.
  Brief quotes the queue ask verbatim with its location, names this separately invoked Codex author and plan, then asks: simplest delivery of the ask/anything unasked; then correctness/buildability.
  Keep brief/report outside the checkout and candidate fixed during review; watcher clearance must explicitly cover the till boundary.
- [ ] In a disposable current-main checkout, replay the saved temporary probes if main moved; retain SHA, commands, counts and measurements outside the repo, then remove probes.
  Theme: `pnpm --filter @waitron/dashboard exec vitest run src/widgets/theme-name-dialog.test.ts -t 'D-DIALOG'`.
  Printer: `pnpm --filter @waitron/dashboard exec vitest run src/screens/printers-screen.test.ts -t 'D-DIALOG'`.
  Station: `pnpm --filter @waitron/till exec vitest run src/widgets/station-choice-dialog.test.ts -t 'D-DIALOG'`.
- [ ] Add “keeps station dialog width and footer positions stable when choices change”; run `pnpm --filter @waitron/till exec vitest run src/widgets/station-choice-dialog.test.ts -t 'keeps station dialog width'` and observe the expected geometry failure before CSS.
  Measure the open native dialog and both native footer buttons before/after choosing short and long names, including a closed-station label; allow at most 1px width/x/y change.
  Cover Make at and Move to, en/es, light/dark and 390/1280px; assert actual `window.innerWidth`, no horizontal body overflow, and dialog/buttons within the viewport.
  Use `page.viewport`, await component updates/fonts before measuring, and restore incoming viewport, locale and theme in `finally`; reuse the themed mount fixture.
- [ ] Apply only the token-backed body width above; rerun the named test and require a passing Tests count.
- [ ] Run `pnpm --filter @waitron/till exec vitest run src/widgets/station-choice-dialog.test.ts src/widgets/station-choice-dialog.save-state.test.ts src/widgets/station-choice-dialog.unsaved.test.ts src/widgets/station-choice-dialog.a11y.test.ts`.
  Geometry belongs to the widget test; existing suites retain Save-state, submission, refusal, close/draft and accessibility assertions. No route, payment or shared-primitive tests need changing.
- [ ] Capture and LOOK at initial/short/long choices for both modes in en/es × light/dark × 390/1280; keep screenshots uncommitted. Check labels, footer stability and phone containment.
- [ ] Delete the four backlog points only with current receipts; put reproduction commands/measurements in commit/PR evidence, not backlog history. Add no guide prose for this sizing-only change unless staff instructions actually change.
- [ ] Driver commits with `git commit -s`, then runs normal `finish-branch`: initial rebase, one Claude run-it review in an installed disposable checkout, fixes and one fresh read of fixes; normal push hook and current-head selected CI checks must pass.

## Limits and size

Leave Back wording and already-correct dashboard source/tests alone. Exclude purchases/staff synthetic-event work, Bluetooth Pair, bill attestation, devices (#3636), A1517 renderer and unrelated station screens.
No shared `wt-modal`/`wt-dialog`, API, payment, fiscal, migration, token or translation changes are proposed.
Expected: code about +8; tests about +55; documentation about +50/−8 including this plan; under 150 changed lines overall. Material departure returns to the watcher before build.
