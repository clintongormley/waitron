# D-form-plumbing: shared form feedback, first slice

**Result:** share repeated form feedback through `@waitron/ui`, without visible change. Source: Lane D `queue.md`, D-form-plumbing; [C47](../../backlog/dashboard.md#the-form-plumbing-is-hand-written-per-form). Prior Claude approach read: 138s, `/Users/clintongormley/waitron-campaign-d/receipts/form-plumbing/plan-review.md`. Watcher cleared narrowed adoption on 2026-11-12 at 16:54, conditionally below about 600 changed lines; no owner-design approval. No new plan read requested.

**First slice:** create `packages/ui/src/form-feedback.ts`; export through `packages/ui/src/index.ts`. Move existing `bottomMessage` string joiner unchanged there, documenting its distinction from the `formMessage` template. Re-export from `apps/dashboard/src/i18n/form-message.ts`; translator stays. Adopt only these `apps/dashboard/src/widgets/*.ts` forms, inspected at their lifecycle/submit/render paths:

| Form | Attempt | Refusal dismissal | Focus | Bottom composition |
| --- | --- | --- | --- | --- |
| unit-form | yes | keyed | direct + after-render | manual |
| person-form | yes | keyed | direct + after-render | manual |
| person-edit | yes | keyed | direct + after-render | manual |
| section-details-form | yes | keyed | direct + after-render | manual |
| include-folder-form | none | keyed | direct | manual |
| category-color-form | none | keyed | direct | manual |
| option-label-form | yes | keyed | direct + after-render | manual |

**Contract:** `FormFeedback(host: ReactiveControllerHost)` starts `attempted=false`. `reset()` clears attempt+dismissals; `newRefusal()` clears only dismissals, called by `willUpdate` on refusal PROPERTY IDENTITY change, never contents comparison. Identical-content new objects revive refusals; same-object rebinding does not. Retain primitive-property change checks. `dismiss(...keys)` dismisses keys; `press(...keys)` attempts+dismisses. `remaining(errors)` filters ONLY dismissed keys, preserving falsey values, types and entry order; caller truthy filtering stays. Shared-state mutations request host update. `async focus(rootGetter)` awaits `host.updateComplete`, then existing `focusFirstInvalid`, returning focused element/null. Direct calls from `updated()` stay direct.

Preserve manual bottom-message assembly/domain mapping: the joiner alone is not shared error policy. Keep closed-dialog dismissed booleans separate, save scopes, generation gates, validators, precedence, translations, events, strings, markup and focus roots/fallbacks. Add no attempt behavior where absent.

**Validation:** TDD in `packages/ui/src/form-feedback.test.ts`: small real Lit host, no fabricated mocks; attempt/reset; selective dismissal/new-identity integration; one joiner case; one render-before-focus case with real field and returned-element assertion. No repeated traversal suite/broad harness. Existing caller tests stay unchanged; run all seven stems' sibling suites, including save-state/unsaved/accessibility variants. Helper: `pnpm --filter @waitron/ui test src/form-feedback.test.ts`; require test counts. One manual representative refusal check; no repeated eight-combination sweeps per invisible batch. Normal hook/CI follows.

**Driver gate:** provisional forecast: production +120/-140, tests +100/-0, support 0, docs ~50 changed. Measure representative unit-form extraction before final estimate/build clearance; write first-slice forecast in `progress.log`. Under about 600 changed lines, build without further question/plan read; above that, post count to watcher first.

**Later:** exclude equipment-label (one joiner), variant-form (one attempt flag), floor-plan-editor (no named plumbing). All other original forms deferred, not promised; inventory repetition at each later slice's start. Split at useful form boundaries around 1,000 changed lines, not five predetermined PRs. After slice one, narrow backlog scope; keep remaining dashboard/module/till work open.

**Measured 12 November:** Unit extraction +13/-21 production lines; its existing 36 cases
passed before and after. First-slice forecast: production +130/-150, tests +100/-0,
support files 0, docs/plan about 70 changed; about 450 total, within the watcher's conditional
clearance. The shared helper's four tests failed for missing exports before implementation,
then passed. Receipt: Lane D `progress.log`, 12 November after 16:54 clearance.
