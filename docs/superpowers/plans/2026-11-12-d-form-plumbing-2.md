# D-form-plumbing, slice 2: message assembly and two list editors

**PLAN FOR APPROVAL.** Author: separate GPT-6.1 Sol, high effort, corrected by the driver after Claude's 275-second approach read (`receipts/form-plumbing-2/plan-review.md` in Lane D). Watcher clearance is pending. The 12 November 16:54 conditional clearance is spent on PR2977 (`a58168dd8ad3421622f3da92b593bdcba4fe304c`). No owner design approval claimed.

**Finish line:** ten dashboard editors share repeated feedback through `@waitron/ui`, with their current fields, wording and behavior preserved. Source: Lane D queue, D-form-plumbing; [backlog](../../backlog/dashboard.md#the-form-plumbing-is-hand-written-per-form). The review brief quotes the full ask verbatim. Remaining forms stay open.

**Build after clearance.** Add an instance method to existing `FormFeedback` in `packages/ui/src/form-feedback.ts`: `message(errors: Record<string, string | undefined>, fieldKeys: ReadonlySet<string>, fixFields: string): string`. It reads no instance state. Join truthy messages (excluding empty strings and `undefined`) outside caller-computed field keys in entry order, then one supplied translated correction exactly when `fieldKeys.size > 0`. No filtering dismissals again, translation lookup, or domain mapping. Keep `bottomMessage`'s signature and existing class export; no export, dependency or framework added.

Replace assembly in `apps/dashboard/src/widgets/{unit-form,person-form,person-edit,section-details-form,include-folder-form,category-color-form,option-label-form}.ts`. Preserve current keys; Category colour supplies `color` only when marked. These seven already share attempt/dismissal/focus.

Adopt state/dismissal/focus in widgets `{option-list-form,extra-list-form,purchase-form}.ts`: reset on reseed/reopen, call `newRefusal()` at existing refusal identity checks, dismiss edits, filter remaining refusals, and `press(...Object.keys(currentRefusals))` on submit. Preserve domain mapping and precedence. Lists use `message({ ...errors, labels: undefined }, fieldKeys, text)` (`items` for Extras); the table still owns that sentence. Purchase uses its existing field keys. List wrappers retain `feedback.focus(shadowRoot)`'s null-result table fallback. Purchase keeps direct `updated()` focus. Preserve stable row ids, nested editors, validators, draft scopes, save gates, dialog dismissal and all direct-focus timing.

**Verification:** one test in `packages/ui/src/form-feedback.test.ts` asserts mixed unshown refusals plus marked field, truthy filtering/order, no field text, no correction without marked fields, and empty input returning `""`. Observe failure before implementing, then pass:

`pnpm --filter @waitron/ui test src/form-feedback.test.ts`

Keep existing helper assertions. Run unchanged caller suites, including accessibility/save-state/unsaved/staff-identity:

`cd apps/dashboard && pnpm test src/widgets/{unit-form,person-form,person-edit,section-details-form,include-folder-form,category-color-form,option-label-form,option-list-form,extra-list-form,purchase-form}*.test.ts`

Callers own mappings, footer/retry, table focus/removal, nested editors and drafts. Require counts; no speculative caller tests or repeated visual matrix. Normal hook/scoped CI and finish-branch reviews follow.

**Stay/defer:** Product editor needs separate inventory of variant-row refusals and named-field focus. Email settings, menu copy, attendance export/proposal, invoice customer/email and theme-name retain multi-job plumbing for a later bounded batch, not exclusion as single-job forms. Equipment-label, home-shortcut and print-job-reprint keep simple joining; variant-form keeps one flag; floor-plan-editor has no named repeated plumbing. Page-printer-add and misdated-note need their direct-focus lifecycle inventoried later. Module/media/Stripe/SumUp/adjustments/departments/zones remain later batches; no till/setup work.

**Docs/size:** narrow `docs/backlog/dashboard.md`; update Forms in `docs/developers/design-system.md`; keep `catalogue.md`'s separate list-plumbing entry unchanged. Forecast from inspected lines: production +80/−135, tests +30/−0, support 0, docs about 90 changed including this plan; about 335 overall, no generated files. No build clearance implied.
