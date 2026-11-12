# D-form-plumbing, slice 3: six dashboard forms

Draft: separate GPT-6.1 Sol, high effort; checked by the driver. Awaiting Claude read and watcher clearance.

Request verbatim, `/Users/clintongormley/waitron-campaign-d/queue.md`, D-form-plumbing:

> every form assembles its bottom message, waits for the render, calls focusFirstInvalid and remembers the first press and which refusals the person has since changed, in several shapes. Make one helper that the dashboard's forms use, in a package the module screens and the image library can reach (@waitron/ui or similar, never apps/dashboard, which packages/media cannot import), and move the forms onto it. Behaviour stays as design-system.md → Forms says; no visible change.

**Finish line:** all six inventoried forms share attempt/footer plumbing; two also share render-before-focus. Reuse unchanged `packages/ui/src/form-feedback.ts` exports `FormFeedback` and `bottomMessage`. No new feedback policy or API. Evidence below is source inventory, not run proof.

**Inventory/build:** modify these six files in `apps/dashboard/src/widgets/`. Each repeats attempt and footer work.

| Source pointers | Share; keep local |
| --- | --- |
| `email-settings-form.ts:190,303` | Attempt plus `bottomMessage`, correction first. Keep refusal clearing/SMTP mappings, Save/Test separation and render wait followed by connectivity-guarded focus. |
| `menu-copy-dialog.ts:67,105,146` | Attempt, `message`, `focus(shadowRoot)` replacing the explicit render wait/walk. Keep request-error precedence and field-only edit clearing. |
| `attendance-export-dialog.ts:230,248,308` | Attempt, `message`, render-before-focus. Compose `bottomMessage(message(...), unavailable)` to preserve action → read → correction → unavailable order. Keep refusal deletion, read/action separation and request/download generations. |
| `attendance-proposal-dialog.ts:117,257,303` | Attempt plus `bottomMessage`, correction first. Keep `reasonEdited`, refusal-property change check, raw `reasonRefusal` suppression of general error, row validation and immediate `focusFirstInvalid` call. |
| `invoice-email-dialog.ts:59,129,170` | Attempt and `message`; keep refusal/bottom strings and named-field focus after rendering, including opening focus. |
| `theme-name-dialog.ts:81,168,253` | Attempt and `message`; keep refusal/bottom strings, either edit clearing both, warnings, savable-at-open policy and named-field focus after rendering. |

Use one feedback instance per form; `press()` at existing attempts. Preserve reset boundaries; proposal's repeated closed `willUpdate` path assigns `feedback.attempted = false` without requesting another update. Never put `reset/newRefusal` in repeated render/closed paths. No dismissal-set conversion: local clearing and refusal identities stay. Dialog dismissal stays separate. Preserve validation, mapping, precedence, events, polling/requests, draft lifecycle and direct-focus timing.

**Checks:** retain assertions in these six sibling `*.test.ts`, `*.unsaved.test.ts` and existing `*.a11y.test.ts` files. Cases include email “keeps a refused field editable and the changed save retryable”, export “marks every invalid field only after submission and focuses the first, then allows correction”, proposal “a refusal naming the reason marks that field without disabling retry and clears when it changes”, invoice opening-focus/refusal/reopen cases and theme “the browser's own checks speak after the first Save”. Menu's `Copy menu: $width $locale $theme` lacks focus assertions: focus Copy before pressing; assert invalid submission returns focus to Name. Keep its matrix. Pure refactor; new behavior needs red/green first.

Run once before/after adoption, requiring test counts:

`cd apps/dashboard && pnpm test src/widgets/{email-settings-form,menu-copy-dialog,attendance-export-dialog,attendance-proposal-dialog,invoice-email-dialog,theme-name-dialog}*.test.ts`

No helper/dependency retest or additional visual matrix. Normal hook, scoped CI and finish-branch follow.

**Docs/scope:** narrow `docs/backlog/dashboard.md`, retaining remaining dashboard/module/media/provider/till work. Forms contract stays unchanged; no product/guide changes, with guide exemption requiring watcher agreement. Exclude Product variant-row focus, invoice-customer privacy flow and till/setup. Prior clearance covered slice one only; slice two is on main (#2985). Driver obtains Claude approach review and fresh watcher build clearance; no owner design approval recorded.

**Estimate:** production +85/−105; tests +8/−0; docs including this plan 95 changed; support 0; total about 293. No generated files. Material growth returns to the watcher under RUNNER.
