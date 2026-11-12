# Lane D: provider form feedback batch

**Draft, 12 November 2026.** Separate Sol-high author; Claude approach read complete (136 seconds).
Driver applied its text corrections; watcher clearance is pending before build.
No owner approval claimed. Only this plan written; no implementation or tests run. The report is
`receipts/form-plumbing-provider/plan-review.md` in Lane D.

**Original queue ask, verbatim:** "every form assembles its bottom message, waits for the render, calls focusFirstInvalid and remembers the first press and which refusals the person has since changed, in several shapes. Make one helper that the dashboard's forms use, in a package the module screens and the image library can reach (@waitron/ui or similar, never apps/dashboard, which packages/media cannot import), and move the forms onto it. Behaviour stays as design-system.md → Forms says; no visible change."

**Finish line:** four provider forms reuse existing `FormFeedback` and `bottomMessage` from
`@waitron/ui`, preserving visible behavior. Read [Forms](../../developers/design-system.md#forms),
[UI conventions](../../developers/conventions-ui.md) and the
[previous slice](2026-11-12-d-form-plumbing-2.md). Both packages already depend on UI and its
exported helper. No helper redesign, API expansion, dependency or framework.

**Inventory and boundary** (source inspection, not runtime verification):

| Source | Decision |
| --- | --- |
| `packages/payments-stripe/src/dashboard/stripe-connect-form.ts` | Move now: attempt/reset, two-part bottom message and awaited focus. |
| `packages/payments-stripe/src/dashboard/stripe-add-reader.ts` | Move now: same repetition, plus a local Reader ID refusal and its focus. |
| `packages/payments-sumup/src/dashboard/sumup-connect-form.ts` | Move now: same repetition; merchant discovery also resets the attempt. |
| `packages/payments-sumup/src/dashboard/sumup-add-reader.ts` | Move now: same repetition; Try again resets the attempt. Pairing machinery stays local. |
| `packages/adjustments/src/dashboard/reasons-screen.ts` | Later: independent reason/limit feedback and focus roots; server-field, translation and void-requirement mappings. |
| `packages/venue-service/src/dashboard/department-dialogs.ts` | Later: feedback beside create/rename/move and impact confirmations. |
| `packages/venue-service/src/dashboard/department-settings.ts` | Later: tabs, transfer fields and keyed service-step refusals need separate review. |
| `packages/venue-service/src/dashboard/department-edit-dialog.ts` | Stay: settings/receipt wrapper; no independent form-feedback state. |
| `packages/venue-service/src/dashboard/zone-edit-dialog.ts` | Later with venue forms: policy mappings, live snapshots and guarded refusal focus. |

`apps/dashboard/src/widgets/product-editor.ts` still repeats feedback; defer a bounded inventory
until active A1515 work clears. By the queue boundary, widgets `email-settings-form.ts`,
`attendance-proposal-dialog.ts`, `invoice-email-dialog.ts` and `theme-name-dialog.ts` stay local.
Venue-service also has `routing-cell-editor`, `period-dialog`, `station-editor`, `seasons-window`,
`range-dialog`, `floor-plan-set-dialog` and `special-day-painter`; these remain uninventoried for
later batches. Keep the backlog broad enough to retain them. Already migrated dashboard/image-library
callers stay unchanged. No till/setup.

- [ ] **Migrate only the four provider source files above.** Replace local attempt flags with a
  per-form `FormFeedback(this)`: only `press()` and `reset()` write attempt state, including
  merchant discovery; never assign `feedback.attempted` directly. Use `focus`
  on the same root instead of render-then-focus sequences. Use `bottomMessage` for the existing
  refusal followed by the translated correction when fields are marked; no synthetic error maps.
  Keep domain refusal storage/clearing local. `packages/ui/src/form-feedback.test.ts` owns helper
  semantics; callers own mapping/message/focus/reset.
- [ ] **Preserve caller decisions.** Credential rejection stays a general bottom refusal, retryable
  with unchanged credentials; edits retain it until another press. Stripe Add maps only
  `reader.reference_unknown` carrying `field: "reference"` under Reader ID: retain the submitted-value
  comparison, clear only on reference edit or retry, and focus after rendering. Its footer shows
  the correction when `blocked || refusedReference !== ""`. Request refusals
  alone never disable actions; local validation still does. SumUp merchant discovery reveals its
  picker quietly; a later empty press marks/focuses it, and selecting sends the same merchant code.
  Try again retains the reader name, clears the code and resets attempt state. Add no message
  clearing there. Keep secret
  clearing, Enter, opening guards, callbacks, drafts, submitted snapshots, contributed
  Save gates and busy exemptions. Leave clients, request bodies, discovery, polling, countdown,
  timeout/expiry, unpair cleanup and every provider operation untouched.
- [ ] **Run existing caller checks before and after each migration.** In each provider's
  `src/dashboard/`, use `{stripe,sumup}-connect-form.test.ts` and
  `{stripe,sumup}-add-reader.test.ts`, their exact matching `*.unsaved.test.ts` siblings, and
  `sumup-connect-form.a11y.test.ts`. Named anchors include “says a refusal and the generic sentence
  together when the key then breaks” (both Connect suites), “drops a Reader ID refusal that arrives
  after the Reader ID was changed”, “marks an unpicked merchant on a press, focuses the picker,
  and clears once one is chosen”, and “starts the form again after Try again: the cleared code is
  not marked and Pair works”. Retain all behavioral assertions. If an actual missing behavior
  assertion is found, add it in its caller suite, reproduce the failure before the minimal fix,
  then watch it pass. No speculative tests.

Run separately from the checkout root, requiring reported test counts:

```sh
pnpm --filter @waitron/payments-stripe test --project browser src/dashboard/stripe-connect-form src/dashboard/stripe-add-reader
pnpm --filter @waitron/payments-sumup test --project browser src/dashboard/sumup-connect-form src/dashboard/sumup-add-reader
```

**Completion/size:** inspect structural reuse and identical wording, gates and operations;
normal hook, scoped CI and `finish-branch` follow. In implementation, narrow
`docs/backlog/dashboard.md`'s form-plumbing entry, retaining remaining work and linking here.
Forecast: production **+55/−85 lines**; tests **+0/−0 expected**, revisited for a demonstrated gap;
support **0**, including moved support; docs approximately **80 added/5 removed** including plan
and backlog; generated **0**. Four existing feedback blocks keep this well below roughly 1,000
changed lines. Form code only: no payment-provider implementation, server, schema or money changes.
