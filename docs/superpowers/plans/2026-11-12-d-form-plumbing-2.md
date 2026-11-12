# D-form-plumbing, slice 2: message assembly and two list editors

**PLAN FOR APPROVAL.** Author: separate GPT-6.1 Sol, high effort. Parent driver owns Claude approach review and watcher clearance; neither exists yet for this slice. The 12 November 16:54 conditional clearance is spent on PR2977 (`a58168dd8ad3421622f3da92b593bdcba4fe304c`). No owner design approval claimed.

**Ask verbatim**, `/Users/clintongormley/waitron-campaign-d/queue.md`, D-form-plumbing:

> every form assembles its bottom message, waits for the render, calls `focusFirstInvalid` and remembers the first press and which refusals the person has since changed, in several shapes. Make one helper that the dashboard's forms use, in a package the module screens and the image library can reach (`@waitron/ui` or similar, never `apps/dashboard`, which `packages/media` cannot import), and move the forms onto it. Behaviour stays as design-system.md → Forms says; no visible change.
>
> one-page plan first (which forms move, which stay and why, size), Claude read, PLAN FOR APPROVAL. If it passes about 1,000 lines, split it: the helper plus the dashboard's own forms first, the module screens next. Delete or narrow the backlog entry in the same pull request.

**Build after clearance.** Extend existing `packages/ui/src/form-feedback.ts` with `message(errors: Record<string, string | undefined>, fieldKeys: ReadonlySet<string>, fixFields: string): string`. Join truthy messages outside caller-computed visible-field keys in entry order, then one supplied translated correction when keys exist. No filtering dismissals again, translation lookup, or domain mapping. Keep `bottomMessage`'s signature; `packages/ui/src/index.ts:123` already exports the class, requiring no export change, dependency, module or framework.

Replace assembly only in `apps/dashboard/src/widgets/{unit-form,person-form,person-edit,section-details-form,include-folder-form,category-color-form,option-label-form}.ts`. Preserve current keys; Category colour supplies `color` only when marked. Receipt: their render blocks, respectively lines 332, 251, 275, 230, 312, 50, 299.

Adopt `FormFeedback` state/focus in `apps/dashboard/src/widgets/{option-list-form,extra-list-form}.ts`: reset on reseed, clear dismissals on existing `fieldErrors` identity changes, dismiss edits, filter remaining refusals. On submit use `newRefusal()` then `press(...Object.keys(serverErrors))`, preserving replacement rather than union semantics. Keep local assembly excluding `labels`/`items`, stable row-id remapping, precedence and nested editor. Their wrappers (lines 271/312) already await render: replace that wait/focus with `feedback.focus(shadowRoot)`, retaining null-result `.table-wrap` fallback and existing `updated()` invocation. Preserve seven forms' direct-focus timing, modal roots, dialog-dismissal booleans, validators, draft scopes and save behavior everywhere.

**Verification during implementation.** Add one focused behavior test in `packages/ui/src/form-feedback.test.ts`: mixed unshown refusals plus marked field, empty messages and entry order; expect refusals then one correction, no field text. Run failing first, implement minimally, rerun:

`pnpm --filter @waitron/ui test src/form-feedback.test.ts`

Keep existing identity/reset/render-focus assertions. Run every existing sibling suite, including accessibility, save-state, unsaved and staff-identity:

`cd apps/dashboard && pnpm test src/widgets/{unit-form,person-form,person-edit,section-details-form,include-folder-form,category-color-form,option-label-form,option-list-form,extra-list-form}*.test.ts`

These named paths retain mappings, footer/retry, removal/table-focus, nested-editor and draft assertions. Add caller assertions only for an identified missing relied-on behavior. Require test counts. No whole-package run or repeated manual visual matrix; normal hook/scoped CI and finish-branch whole-branch review follow the risk contract.

**Remainder and size.** Defer purchase-form and remaining dashboard/module/media/payment-provider adoption to inventoried batches. Equipment-label (one joiner), variant-form (one flag), floor-plan-editor (no repeated plumbing) stay local. No till/setup work. Narrow `docs/backlog/dashboard.md` and update Forms in `docs/developers/design-system.md`, keeping the full ask open. From inspected assembly/state/focus lines: forecast production +85/−115, tests +25/−0, support 0; docs about 80 changed including this plan, three documentation files total; about 305 changed overall, under 600 and below 1,000. No generated files. This forecast grants no build clearance.
