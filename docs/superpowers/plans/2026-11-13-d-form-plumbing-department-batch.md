# Lane D: department and zone form plumbing

Scope proposed on 13 November 2026; pending Claude read and watcher clearance.
The separate plan author inspected sources only; no runtime verification or owner approval is claimed.

**Queue ask, verbatim**, `/Users/clintongormley/waitron-campaign-d/queue.md`, D-form-plumbing:
"every form assembles its bottom message, waits for the render, calls focusFirstInvalid and remembers the first press and which refusals the person has since changed, in several shapes. Make one helper that the dashboard's forms use, in a package the module screens and the image library can reach (@waitron/ui or similar, never apps/dashboard, which packages/media cannot import), and move the forms onto it. Behaviour stays as design-system.md → Forms says; no visible change."

**Result:** remove repeated attempt and footer mechanics in only these production files:
`packages/venue-service/src/dashboard/department-dialogs.ts`, `department-settings.ts`
and `zone-edit-dialog.ts`. All shortened caller paths below share that directory.
Reuse `packages/ui/src/form-feedback.ts` unchanged: `FormFeedback` and `bottomMessage`.
No helper API, dependency, generic framework, or wrapper replacing a single line.

**Sources:** [prior inventory](2026-11-13-d-form-plumbing-venue-batch.md),
[backlog entry](../../backlog/dashboard.md#the-form-plumbing-is-hand-written-per-form),
[Forms](../../developers/design-system.md#forms) and [UI conventions](../../developers/conventions-ui.md).
Read sites: `department-dialogs.ts:108,293,341,448,506`;
`department-settings.ts:245,250,267,314,366,588,602,683,728,789,1007`;
`zone-edit-dialog.ts:126,142,175,198,236,257,311`.

1. Give each caller `new FormFeedback(this)`, replace its attempt writes with `press()`
   and its existing attempt resets with `reset()`; read `feedback.attempted` everywhere.
   Keep the existing local refusal maps and field-specific deletion on edits and retries.
   Do not rewrite domain refusals or introduce keyed dismissal where local clearing already works.
2. Replace each footer join with `bottomMessage`, preserving message order and conditions.
   Department dialogs retain `failure || impactFailure`; settings retains `highlighted`,
   including its distinction between a service-step list refusal and marked row fields.
   Keep field text out of the footer and retain refusal plus correction when both apply.
3. Use `feedback.focus(this.shadowRoot!)` only for the unguarded invalid-Save callbacks
   in department dialogs and the zone editor. Keep settings' `showFirstInvalid()` local:
   it selects the first offered marked tab before rendering, then checks `isConnected`.
   Keep department refusal focus's `isConnected` and zone refusal focus's `current(id, generation)`
   inside their existing render-promise callbacks. `FormFeedback.focus` has no post-render
   caller predicate; moving a check before its await would change the guarded behavior.
   Receipt-specific focus (`receiptInvalid`/`receiptRefused`) remains local and unchanged.
4. Preserve draft scopes, restore/cancel baselines, impact loading and delete confirmation,
   service-step row keys/errors, tab events, pending/refreshing and identity guards,
   request bodies, write/refresh ordering, retry availability and saved/written/closed events.

**Focused checks, before and after implementation:** retain every existing assertion.
Run the matching browser, unsaved and accessibility suites using these file prefixes:

```sh
pnpm --filter @waitron/venue-service exec vitest run --project browser src/dashboard/department-dialogs src/dashboard/department-settings src/dashboard/department-edit-dialog src/dashboard/department-service-steps src/dashboard/zone-edit-dialog
```

This selects each caller's `.test.ts`, `.unsaved.test.ts` and `.a11y.test.ts`, plus
`zone-edit-dialog-policy.test.ts`, `zone-edit-dialog-lifecycle.test.ts` and the receipt wrapper's
`department-edit-dialog-transfers.a11y.test.ts`. Read the reported files and Tests count.
Behavior anchors: `department-dialogs.test.ts` has native validation/correction in EN/ES,
"$dialog.kind reopens clean after a recorded $outcome" and "ignores a departed refusal after the dialog is replaced".
`department-settings.test.ts` has "Save with a blank name from the Service tab shows Details, marks it and focuses the name",
step-field refusals that reveal Service, and "a list refusal beside a highlighted field keeps Correct the highlighted fields at the bottom".
`zone-edit-dialog.test.ts` pins blank-name messages/no write and old-zone completion;
`zone-edit-dialog-policy.test.ts` pins "a refused setting focuses its native control" and retry after refusal.
Unsaved anchors include settings' "navigation asks, Keep retains and Discard restores the whole form"
and zone's "pending Save blocks closing and retains a newer name after the submitted draft commits".
Use concrete deletion controls for changed attempt/reset/focus/footer behavior; restore each deletion.
Only if a control exposes a caller gap, add its missing assertion to the existing caller suite,
passing on old behavior first. An actual bugfix needs an observed failing test before the fix.
Retain local before/after appearance evidence per form, in both themes and at phone width;
do not commit screenshots. No visible changes or guide text: staff steps and feedback stay the same.

After delivery, narrow only the delivered backlog scope. Keep range, routing, station, painter,
adjustments and product editor deferred; leave migrated Period/Floor-plan/Seasons/provider/media forms untouched.
Forecast: production **+25–35 / −25–35 lines**; tests **+0–40 / −0**, only for demonstrated gaps;
support/generated **0**. No package-wide local test run. **1.5× forecast growth is a watcher deviation**,
as is a material scope change; return for clearance before expanding this batch.
