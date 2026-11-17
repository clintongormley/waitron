# D-ESCAPE-WHILE-SAVING implementation plan

**Author:** separate GPT-6.1 Sol high-effort invocation. **Status:** Claude approach review and watcher clearance pending under campaign D `RUNNER.md` rule 0; no owner plan approval claimed.

**Finish line:** cover `/Users/clintongormley/waitron-campaign-d/queue.md` D-ESCAPE-WHILE-SAVING: two Escapes cannot dismiss a window during its write; success closes correctly, refusal retains its draft/target. No defect or required fix is established by this read-only inspection. Reuse Lit/Vitest Chromium harnesses; one branch within the runner's three-hour budget.

## Build after review and clearance

- [ ] **Reproduce first.** Read the TDD skill before code. Hold the client write with an existing promise gate; press the real Save/Delete button; await one write call and busy rendering. Follow `apps/dashboard/src/widgets/option-label-form.test.ts` (“holds the dialog open against Escape only while it is saving”): focus the native dialog's body, press `userEvent.keyboard("{Escape}")`, await `closeReportsDelivered()`, assert native `dialog.open`, retained draft/target and no `wt-close`; repeat while the write remains held. Synthetic keys, `updateComplete` alone and sleeps do not establish close delivery.
- [ ] **Cover these paths**, using local `it.each` success/refusal rows. Preserve existing duplicate-submit, Enter, refusal, selection and post-save dismissal assertions:

  | File | Exact proposed test name and paths |
  | --- | --- |
  | `apps/dashboard/src/screens/menus-screen.test.ts` | `keeps %s delete open through two delivered Escapes, then %s`: row `delete-section` / `deleteSection`, selection `delete-selected` / `deleteSections`; success and refusal. Reuse `api`, `deferred`, `mountLunch`, `rowAction`, `modal`, `inModal`, and selection helpers `pressSelect`, `tick`, `openDelete`, `confirmDelete` within their existing nested describe blocks; keep row/selection cases in their respective scopes. |
  | `apps/dashboard/src/screens/modifiers-screen.test.ts` | `keeps %s delete open through two delivered Escapes, then %s`: extras / `deleteExtraList` and options / `deleteOptionList`; success and refusal, using the existing inline promise gate. Reuse `api`, `mount`, `selectTab`, `clickInTable`, `deleteDialog`, `confirmDelete` and the existing held-write pattern. |
  | `packages/media/src/dashboard/image-library.test.ts` | `keeps %s image save open through two delivered Escapes, then %s`: upload / `uploadImage`, edit / `updateImage`. Also `keeps image delete open through two delivered Escapes, then %s`: `deleteImage`. Reuse `mount`, `deferred`, `field`, `chooseFile`, `openDialog`, `dialogClosed`, `bottomOf`; strengthen existing single-Escape cases. |

  Import dashboard delivery/close helpers from `apps/dashboard/src/widgets/test-helpers.ts`; media gets only a local copy of the existing throwaway-dialog delivery helper, without an app dependency. Settle each promise: success asserts one correct payload, refreshed data and closure after the delivery barrier (media removes its window; do not await an event from a removed modal). Refusal asserts localized error, exact names/file/framing or deletion selection/target, native window open and retry enabled. Keep the media edit's real Escape dismissal after refusal, awaiting its existing `dialogClosed`.
- [ ] **Fix only reproduced failures**, red then green, in `apps/dashboard/src/screens/menus-screen.ts`, `apps/dashboard/src/screens/modifiers-screen.ts`, or `packages/media/src/dashboard/image-library.ts`. Reuse existing `dismissible`, busy and close handling; trace consumers before altering a helper's gate. Only a reproduced shared fault permits `packages/ui/src/components/wt-dialog.ts` and a regression in `packages/ui/src/components/wt-dialog.test.ts`; retain API and behavioral assertions. If nothing fails, keep checks without production edits and name the exact flows/keys in the eventual commit.

## Verification and completion

From the checkout root, append `-t 'two delivered Escapes'` for reproduction, then run complete changed files; require nonzero Tests counts and successful exits:

```sh
pnpm --filter @waitron/dashboard exec vitest run src/screens/menus-screen.test.ts src/screens/modifiers-screen.test.ts
pnpm --filter @waitron/media exec vitest run --project browser src/dashboard/image-library.test.ts src/dashboard/image-library.unsaved.test.ts
```

If UI changes, also run `pnpm --filter @waitron/ui exec vitest run src/components/wt-dialog.test.ts`. Check machine headroom; run sequentially. No whole-package local suites; normal hook/current-head scoped CI through `finish-branch`.

Look at each changed window in **EN/ES × light/dark × 390×844/1280×900**: held write, refusal and success closure; inspect draft/target, message, buttons, focus and overflow. Use the harness or `wa-wt demo waitron-fix-d-escape-while-saving`; captures stay untracked; restore locale/theme/viewport. After all flows pass, delete both the “Repeated Escape checks for menu, modifier and media writes” section and its “Bundle: Wt dialog lifecycle” bullet/link in `docs/backlog/dashboard.md`.

**Excluded:** server changes; Home/End caret keys; covered-dialog restoration; department/zone wrappers; till extras picker; framing/lifecycle expansion; unrelated dashboard leftovers; new protocols, dependencies or support frameworks.

**Forecast (added/removed):** production **20/5**, conditional; tests **220/35**; support **15/0**; docs **55/10**, including plan/backlog. Total **360 lines**; report actual categories separately. Before **540 lines (1.5×)** or scope expansion, stop for watcher deviation with the smallest alternative; shared-dialog growth follows the queue's WATCHER-NEEDED rule.
