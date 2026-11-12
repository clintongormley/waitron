# D-form-plumbing, slice 3: dashboard and image-library feedback

Drafted by separate GPT-6.1 Sol, high effort; revised by the driver after Claude's 261-second approach read. Awaiting watcher build clearance; no owner design approval claimed.

**Ask/finish line:** continue [shared form plumbing](../../backlog/dashboard.md#the-form-plumbing-is-hand-written-per-form), with no visible change. Menu copy, attendance export and the image-library editor reuse unchanged `FormFeedback` and `bottomMessage` from `@waitron/ui`. The image library advances the cross-package part of the ask. Remaining forms stay open. Inventory is source-read evidence, not run proof.

**Build one bounded batch:**

| File | Share; preserve locally |
| --- | --- |
| `apps/dashboard/src/widgets/menu-copy-dialog.ts:67,105,146` | Attempt state, render-before-focus and footer joining. Keep request-error precedence, field-only edit clearing, drafts and generations. |
| `apps/dashboard/src/widgets/attendance-export-dialog.ts:129,248,308` | Attempt state, render-before-focus and footer joining. Keep refusal deletion, read/action separation, request/download generations and action → read → correction → unavailable order. |
| `packages/media/src/dashboard/image-library.ts:708,837,862,1070` | Attempt state, render-before-focus and footer joining. Keep language/file mapping, checked-field precedence, save-error prefix, correction text, edit/reload lifecycle, framing, draft scopes and request generations. |

Use one feedback instance per form, `press()` at current attempts, and `reset()` at existing reset boundaries outside `willUpdate`. Menu's opening-time reset inside `willUpdate` may assign `feedback.attempted = false`; never introduce an unconditional update loop. Refusal objects/strings and their clearing remain local; no dismissal-set conversion.

Use `bottomMessage` directly with the existing ordered conditional messages; do not introduce synthetic field keys or nest `message()` to preserve order. Replace explicit render-wait/focus walks with `feedback.focus` at the same submission/refusal sites and roots. Media retains its editor-modal root; preserve query-after-render ordering if that requires keeping its small wrapper. Do not broaden focus to the library. No helper/API, event, validation, request or product behavior changes.

**Stay/defer:** email settings and attendance proposal retain their flag/joiner because guarded/immediate focus and refusal handling stay local. Invoice email and theme-name also keep their flag/joiner and named-field/opening focus. Product variant-row focus, invoice-customer privacy flow, other dashboard/module/provider forms and till/setup remain outside this batch.

**Checks:** keep all existing assertions. Run before/after, requiring counts:

`cd apps/dashboard && pnpm test src/widgets/{menu-copy-dialog,attendance-export-dialog}*.test.ts`

`pnpm --filter @waitron/media test src/dashboard/image-library` (from repository root)

Caller suites own invalid-field/footer/focus, refusal edit/retry, reopen, drafts and save-state behavior. Media already asserts mixed general/field message order and file/default-language focus. Add one standalone menu-copy test: enter an already-used name, focus Copy, press, assert Name receives focus. Do not expand its screenshot matrix. Pure refactor; new behavior needs red/green first. No dependency retesting or extra visual matrix; normal hook, scoped CI and finish-branch follow.

**Docs/size:** narrow `docs/backlog/dashboard.md`; retain remaining work. No Forms-contract/guide changes; request watcher agreement for unchanged guide text. Slice two was cleared at 18:01 on 12 November (its plan records it); no earlier clearance covers this batch. Forecast production +55/−75, tests +25/−0, docs about 75 changed including this plan, support 0; about 230 overall, no generated files. Material growth returns to the watcher under RUNNER.
