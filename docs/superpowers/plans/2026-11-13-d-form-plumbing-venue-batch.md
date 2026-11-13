# Lane D: venue form feedback batch

**13 November 2026.** Separate GPT-6.1 Sol high-effort author; driver checked the draft against source.
Claude approach read and watcher clearance are pending. No implementation until both
complete. This proposes scope inside the queue ask; no owner design approval is claimed.

**Original queue ask, verbatim**, recorded in
`/Users/clintongormley/waitron-campaign-d/queue.md`, D-form-plumbing:
"every form assembles its bottom message, waits for the render, calls focusFirstInvalid and remembers the first press and which refusals the person has since changed, in several shapes. Make one helper that the dashboard's forms use, in a package the module screens and the image library can reach (@waitron/ui or similar, never apps/dashboard, which packages/media cannot import), and move the forms onto it. Behaviour stays as design-system.md → Forms says; no visible change."

**Finish line:** reuse existing `packages/ui/src/form-feedback.ts` exports in three
venue forms. Venue-service already depends on UI. Follow
[Forms](../../developers/design-system.md#forms) and
[UI conventions](../../developers/conventions-ui.md).
No helper redesign, APIs, dependencies, fake field keys or flattened Map errors.

**Inventory: source inspection, not runtime verification.** Unless qualified, paths below
are under `packages/venue-service/src/dashboard/`; all listed form sources end in `.ts`.
The [provider plan](2026-11-12-d-form-plumbing-provider-batch.md) supplies the prior partial inventory.

| Sources | Decision and reason |
| --- | --- |
| `period-dialog`, `floor-plan-set-dialog`, `seasons-window` | Move now: each repeats attempt/reset, render-before-focus and a two-part footer join. See their `save()` and render/footer methods. |
| `range-dialog` | Later: attempt/focus only, without compound footer or request refusal. |
| `routing-cell-editor`, `station-editor`, `special-day-painter` | Later: routing's Map/line errors, station's printer-drop handling, painter's offers/notices need separate treatment. |
| `department-dialogs`, `department-settings`, `zone-edit-dialog` | Later: impact confirmations, tab-aware focus and guarded late refusal focus respectively. |
| `department-edit-dialog` | Stay local: settings/receipt wrapper, no independent feedback. |
| `packages/adjustments/src/dashboard/reasons-screen.ts` | Later: separate editor and limit focus roots. |
| `apps/dashboard/src/widgets/product-editor.ts` | Deferred while A1515 is active. |

Already shipped dashboard, image-library and provider batches stay untouched.
The four prior exclusions (`email-settings-form`, `attendance-proposal-dialog`,
`invoice-email-dialog`, `theme-name-dialog`) stay local. Till/setup are outside lane scope.

- [ ] **Replace plumbing in only the three selected sources.** Give each form
  `new FormFeedback(this)`; use `press()`/`reset()` at existing attempt/reset sites,
  read `feedback.attempted`, and call `focus(this.shadowRoot!)` only where local validation
  currently waits then focuses that same root. Use `bottomMessage` with the existing
  refusal first and correction second. Keep domain refusal mapping/clearing local,
  including seasons' submitted row keys and Map errors. Leave other focus behavior
  unchanged, including focus after binning a season.
- [ ] **Preserve caller decisions.** Keep draft scopes, identity/generation guards,
  pending/dirty/busy gates, request bodies and event semantics. Reset only where the
  current form resets; retain field-specific dismissal and retry behavior.
- [ ] **Run caller suites before and after.** In the directory above, retain all nine:
  `period-dialog.test.ts`, `period-dialog.unsaved.test.ts`, `period-dialog.a11y.test.ts`;
  `floor-plan-set-dialog.test.ts`, `floor-plan-set-dialog.unsaved.test.ts`,
  `floor-plan-set-dialog.a11y.test.ts`; `seasons-window.test.ts`,
  `seasons-window.unsaved.test.ts`, `seasons-window.a11y.test.ts`.
  Inspected assertion anchors include “a Save refused only for its colour moves focus
  to the colour field”, “Save with a field missing explains it beside the field and
  at the bottom”, “a refused field stays with the row the request named, not the row
  now at that place” and “a Discard restores the baseline but never reuses a new row's key”.

```sh
pnpm --filter @waitron/venue-service exec vitest run --project browser src/dashboard/period-dialog src/dashboard/floor-plan-set-dialog src/dashboard/seasons-window
```

`packages/ui/src/form-feedback.test.ts` owns helper semantics; callers retain mapping,
footer, focus and reset assertions. Add a genuinely missing caller assertion before
refactoring, passing against old code. Any bugfix requires an observed failing test
first. No speculative helper tests, rewritten assertions or moved test files.

- [ ] **After clearance:** compare before/after in EN/ES, light/dark, phone/desktop,
  including invalid/refused/reset states. No visible change or guide text is proposed
  because staff steps stay unchanged. Narrow the backlog, retaining deferred forms;
  use the normal hook, scoped current-head CI and `finish-branch` after the hold lifts.

**Forecast:** production **+45/−55 lines**; tests likely **+0/−0**; support/generated **0**;
docs separately approximately **75 lines**. Stop and return to the watcher at
**1.5× forecast growth** or a material scope change.
