# D-DIALOG-LOOSE-ENDS implementation plan

**Goal:** Keep the station chooser and its buttons still while staff choose a station; retire the four backlog observations once current evidence and watcher clearance settle them.
**Authority:** Exact ask: `/Users/clintongormley/waitron-campaign-d/queue.md`, D-DIALOG-LOOSE-ENDS, “Ask”.
The queue authorizes the outcome. Separate Sol-high draft checked by the driver; Claude reviewed it in `receipts/dialog-loose-ends/plan-review.md` (213 seconds), with all corrections taken.
The watcher cleared the plan and both scope boundaries at `/Users/clintongormley/waitron-campaign-d/questions.md`, “WATCHER 2026-11-17 07:08 — D-DIALOG-LOOSE-ENDS: plan CLEARED, both boundaries”: “the station note is the till chooser (A331 batch 5, #1414), and its one local body-width fix is fine in this PR even though it is the till, since it is reproduced and small; the measured closures go docs-only in the same PR.”
That clearance retains the theme dialog's specified Back wording. No owner approval of this design is recorded.
**Execution:** Inline, using `superpowers:executing-plans` and TDD after clearance; no new helpers or framework.

## Evidence and smallest result

Driver probes on main base `7f0ad91e2605f37c13171964ac13c15d364a544c` (2026-11-17, about 06:56):

- Theme first-save/copy: visible native Back dismisses after `wt-close` without submitting; “A331 look canvas (copy)” fits at 1280px and 390px (2 passed at each width).
- Printer discovery: fresh and retained/disabled rows say Add; fresh opens “Add a printer”/Add, retained adds directly without naming (2 passed).
- Till station choice: native width changes from 245.53125px to 204.734375px after choosing Grill; width invariant fails (1 failed).

Receipts and saved temporary probe texts: `/Users/clintongormley/waitron-campaign-d/receipts/dialog-loose-ends/` (`theme-probe.log`, `theme-phone-probe.log`, `printer-probe.log`, `station-probe.log`).
These are driver measurements, not executions by the plan author. Paste the probe bodies, source SHA, commands and counts into the PR so deletion evidence can be repeated.

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
  Keep brief/report outside the checkout and candidate fixed during review; watcher clearance must explicitly cover the till boundary and retaining Back, specified at `2026-10-19-a841-theme-editor-design.md:650`.
- [ ] In a disposable current-main checkout, replay the saved temporary probes if main moved; retain SHA, commands, counts and measurements outside the repo, then remove probes.
  Theme: `pnpm --filter @waitron/dashboard exec vitest run src/widgets/theme-name-dialog.test.ts -t 'D-DIALOG'`.
  Printer: `pnpm --filter @waitron/dashboard exec vitest run src/screens/printers-screen.test.ts -t 'D-DIALOG'`.
  Station: `pnpm --filter @waitron/till exec vitest run src/widgets/station-choice-dialog.test.ts -t 'D-DIALOG'`.
- [ ] Add “keeps station dialog width and footer positions stable when choices change”; run `pnpm --filter @waitron/till exec vitest run src/widgets/station-choice-dialog.test.ts -t 'keeps station dialog width'` and observe the expected geometry failure before CSS.
  Measure the open native dialog and both native footer buttons before/after choosing short and long names, including a closed-station label; allow at most 1px width/x/y change.
  Cover Make at and Move to at 390/1280px in English, plus one Spanish phone case; assert actual `window.innerWidth`, no horizontal body overflow, and dialog/buttons within the viewport.
  Use existing `pageAt`/`resetPage` and mount/choose helpers; await component updates/fonts, and restore viewport/locale after the case. Keep the full language/theme matrix in visual inspection.
- [ ] Apply only the token-backed body width above; rerun the named test and require a passing Tests count.
- [ ] Run `pnpm --filter @waitron/till exec vitest run src/widgets/station-choice-dialog.test.ts src/widgets/station-choice-dialog.save-state.test.ts src/widgets/station-choice-dialog.unsaved.test.ts src/widgets/station-choice-dialog.a11y.test.ts`.
  Geometry belongs to the widget test; existing suites retain Save-state, submission, refusal, close/draft and accessibility assertions. No route, payment or shared-primitive tests need changing.
- [ ] Capture and LOOK at initial/short/long choices for both modes in en/es × light/dark × 390/1280; keep screenshots uncommitted. Check labels, footer stability and phone containment.
- [ ] Delete the four backlog points only with current receipts; put reproduction commands/measurements in commit/PR evidence, not backlog history. Add no guide prose for this sizing-only change unless staff instructions actually change.
- [ ] Driver commits with `git commit -s`, then runs normal `finish-branch`: initial rebase, one Claude run-it review in an installed disposable checkout, fixes and one fresh read of fixes; normal push hook and current-head selected CI checks must pass.

## Limits and size

Leave Back wording and already-correct dashboard source/tests alone. Exclude purchases/staff synthetic-event work, Bluetooth Pair, bill attestation, devices (#3636), A1517 renderer and unrelated station screens.
No shared `wt-modal`/`wt-dialog`, API, payment, fiscal, migration, token or translation changes are proposed.
Expected: code about +8; tests about +45; documentation about +50/−8 including this plan; under 150 changed lines overall. Material departure returns to the watcher before build.

## Review correction cleared 2026-11-17 07:28

The first run-it read reproduced point (2) with “Evening service look (copy)”:
199.125px of text in 182px of native input room at 390/1280px. The original
sample fitting by 5px did not settle the queued ordinary-name defect.
The watcher cleared fixing it here in `questions.md`, “WATCHER 2026-11-17 07:28”:
“fix it in this branch with the one local token-backed width on theme-name-dialog.ts .fields
(the same min(form width, dialog width minus padding) rule) and the focused real-input
name-fit and viewport checks at 390 and 1280, keeping Back and the rest.”
This supersedes the theme-source exclusion above: change only that width in
`apps/dashboard/src/widgets/theme-name-dialog.ts` and its widget regression test.
Inspect EN/ES, light/dark, phone/desktop; run the widget, a11y and unsaved suites,
then one fresh fixes read. Revised forecast: production +8; tests about +80;
docs about +65/−8; under 190 changed lines, no generated files.
