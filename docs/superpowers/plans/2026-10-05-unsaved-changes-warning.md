# W69 implementation plan

> 2026-10-06: Hours (A261 step 5) deleted `station-hours-form` and added the Hours page's own editors (`packages/venue-service/src/dashboard/hours-screen.ts`), which this document does not list.

> **For agentic workers:** Use `superpowers:executing-plans` for inline execution, as the runner directs. Read the TDD skill before implementation or test code.

**Goal:** Warn before a voluntary leave discards unsaved form values across every audited owner.

**Architecture:** One browser-safe coordinator in ui-core tracks owner snapshots and decides leave requests. UI renders its confirmation and intercepts dialogs/history; app and module forms supply their own value comparisons and successful-write boundaries.

**Tech stack:** TypeScript, Lit, native dialogs/history and Vitest browser mode with Playwright Chromium.

**Spec:** [Unsaved-changes design](../specs/2026-10-05-unsaved-changes-warning-design.md).

## Global constraints

- Entire modal and page scope remains W69 even if delivered in two PRs; no migrations, new domain dependencies, compatibility layer or sensitive draft storage.
- Native Keep/Discard protection uses one mechanism; forced security exits stay immediate. Submission, fiscal, monetary and automatic order-save behavior retain their existing semantics.
- Use existing tokens, EN/ES copy, both themes and phone/desktop inspection. Preserve every behavioral assertion and record intentional changed checks under the owner's FYI rule.
- Implementation uses focused TDD; the normal hook runs once and current-head CI owns package coverage. Reconcile advancing owners before execution and finishing.

## Review focus

- A child save commits only that child; a background read or failed refresh cannot reset another draft (Tasks 2, 4, 6).
- Unindexed same-document Back/Forward must ask, without guessed traversal deltas or history loops (Task 5).
- A save, editor replacement or forced security reset makes a pending answer inert (Tasks 2, 3, 5).
- Opaque file selections and exact decimal comparisons survive snapshotting; invalid raw input and reverts remain distinguishable (Tasks 2, 4, 6).
- Multiple independent writes commit separately; persisted/automatic order drafts retain their actual lifecycle (Task 6).

Implement the [design](../specs/2026-10-05-unsaved-changes-warning-design.md) against the complete [owner inventory](2026-10-05-unsaved-changes-audit.md). The baseline is `5597e06923b64acacf9df54ed6e8fb42e7fa411e`. You may stage delivery as **PR 1: shared mechanism and all modal/dialog owners** followed by **PR 2: page owners and shell navigation**. Both PRs use the same registry and confirmation. The page work remains W69 scope, not a new backlog item. A first PR alone does not complete W69.

This is a documentation deliverable, not evidence that these tests or changes exist. During implementation, read the TDD skill before writing code. For every task below, add a behavioral case first, run the stated focused command and observe the expected assertion fail, implement the smallest change, then rerun and read the Tests count. Missing imports or broken fixtures are not the expected red result. Keep all existing behavioral assertions.

## 1. Reconcile the candidate tree

- [ ] Read current `CLAUDE.md`, the relevant topic files and the owner's W69 queue entry. Run the audit discovery commands and `git diff --name-only 5597e06923b64acacf9df54ed6e8fb42e7fa411e..HEAD`. Inspect every advancing owner rather than treating the baseline inventory as current.
- [ ] Check `packages/ui-core/package.json`, `packages/ui-core/scripts/build.mjs`, `packages/ui-core/src/index.ts`, `packages/ui/package.json`, `packages/ui/src/index.ts`, `packages/ui/src/url-state.ts` and `packages/dashboard-kit/package.json`. Add `./unsaved-changes` to both ui-core export maps and its barrel; let the manifest-driven build include it. No domain dependency, new package, server registry, migration or compatibility layer.
- [ ] Read every `wt-dialog`/`wt-modal` consumer returned by the audit's final consumer search, including `.open` assignments and `wt-close` handlers. Assign each dismissal, successful write, forced teardown and busy phase a reason. Do not silently turn a programmatic close into a protected user action or a bypass.
- [ ] Inspect combined changes from W70a #1265, Lane D prep-stations-tabs, Lane C device-edit-dialog-edges, Lane A receipt-top-block, A231 and W41s-10c when available on main. Preserve their sizing, tabs, dialog edges and form behavior. Overlap is waived; whoever lands second rebases. Never edit their branches.

## 2. Shared dirty state and leave decisions

- [ ] Add `packages/ui-core/src/unsaved-changes.test.ts`, then `packages/ui-core/src/unsaved-changes.ts`. Export `DraftOwner`, `DraftScope`, `LeaveRequest`, `ConfirmLeave`, `LeaveOutcome`, `LeaveCoordinator` and `createLeaveCoordinator(confirm, target)` with the design signatures. Every owner input handler calls `scope.changed()`; writes call `scope.commit(submitted)`, and teardown calls `scope.dispose()`. Scopes capture detached canonical payloads and provide current/equal/restore; commit takes the exact submitted snapshot. The coordinator requests one visual decision through an injected renderer, rather than importing ui.
- [ ] Assert change/revert; defaults normalized on both sides; unordered map/set equality supplied by owner; ordered rows still dirty; invalid raw input remains dirty; rejected write retains draft; committed write followed by failed refresh is clean; edits made during save remain dirty against the submitted baseline. Compare observed values and proceed/reset calls, not private implementation fields.
- [ ] Assert one pending decision, Keep causes zero reset/leave calls, Discard acts once on affected scopes only, dirty child blocks parent close, child Save does not commit parent, clean child does not conceal dirty parent. Assert disconnect/replaced identity/save/security invalidation makes an old answer inert and unregisters unload protection.
- [ ] Implement dirty-only `beforeunload` lifecycle using the same registry. Assert listener absent while clean, installed when dirty, event cancelled with nonempty returnValue, removed on revert/save/dispose/security reset. A synthetic event tests registration/cancellation only; it cannot establish that a native warning appears.

```sh
pnpm --filter @waitron/ui-core test src/unsaved-changes.test.ts
pnpm --filter @waitron/ui-core test:package
```

Expected red: the test's leave callback runs while dirty, a reverted value still asks, or an old decision resets a committed/new scope. Package-consumer checks must establish the new source and built public entry are importable; extend `packages/ui-core/test/package-consumer.test.mjs` with the real export, not only manifest-text assertions.

## 3. Confirmation and native dialog interception

- [ ] Extend `packages/ui/src/components/wt-dialog.test.ts` and `wt-modal.test.ts` before changing their owners. Add `packages/ui/src/components/wt-unsaved-changes.test.ts` and `wt-unsaved-changes.a11y.test.ts`; implement `wt-unsaved-changes.ts`, export/register through existing ui conventions. Supply explicit `.heading`, `.message`, `.keepLabel` and `.discardLabel` properties from `apps/dashboard/src/i18n/strings.ts`, `apps/till/src/i18n/strings.ts` and `apps/setup/src/i18n/strings.ts` at each shell's single confirmation renderer, with EN “Keep editing”/“Discard changes” and ES “Seguir editando”/“Descartar cambios”. Use only declared `--wt-*` tokens. Emit `wt-unsaved-choice` with detail `{ decision: "keep" | "discard" }`, bubbles/composed true, and stop the initiating click before re-emitting. The confirmation itself is not a dirty scope.
- [ ] Implement the design's exact `requestClose`, `beforeClose` and `closeAfter` APIs on WtDialog, inherited by WtModal. Native Escape synchronously prevents cancel and holds `closedby=none` while guarded; asynchronous decision keeps the owner open. All explicit dismiss controls use that API. Preserve unguarded/nondismissible behavior, reopening and focus assertions. Do not introduce backdrop close where absent.
- [ ] Test actual native Escape with Playwright keyboard input, repeated Escape while asking, delayed native close from an earlier opening, owner rerender while pending, child `wt-close` propagation, parent/child dirty combinations, Discard once and Keep focus restoration. Dispatch real events when testing composedPath; do not pass an undispatched KeyboardEvent to a handler.
- [ ] Assert confirmation initial focus on Keep editing, Escape means Keep, explicit destructive Discard, accessible name/description and complete keyboard order. Run axe in both themes for each state. Inspect actual screenshots at 390×844 and 1280×900 in EN and ES. Retain compact/standard/wide/nested modal sizing tests, including W70a after rebase.

```sh
pnpm --filter @waitron/ui test src/components/wt-dialog.test.ts src/components/wt-modal.test.ts src/components/wt-unsaved-changes.test.ts src/components/wt-unsaved-changes.a11y.test.ts
```

Expected red: Escape closes the editor before a decision, the parent handles the child's close, focus leaves the editor on Keep, or repeated close opens two confirmations. A passing attribute test is insufficient; assert native dialog open state, visible values and focus.

## 4. Product-first modal rollout, then every modal owner

- [ ] Wire Product Add/Edit, standalone Related Product variant, category/color, unit, extras list/item rows, options list/labels and image editor first. In `product-editor.ts`, derive the snapshot from the existing normalized submit body, including deleted inherited fields and variant-only nulls. Use list identity when comparing modifier selections. Do not make reordered positional rows equal. Preserve parent edits through nested Save/Discard and refresh.
- [ ] Wire menu/section/layout metadata, add-to-menus/add-products and member replacement; staff/person credentials, shift, purchase, device pairing settings/edit, printer Add/Edit/calibration, reader edits and profile subforms. Replace printers' local discard arming with the shared renderer. Assign each write's success boundary independently.
- [ ] Wire contributed venue-service station/exception/hours/watcher/department/zone forms; media Upload/Edit; booking Add/Edit; adjustment reason modal; SumUp/Stripe connect and reader forms. Pairing wait/cleanup stays unchanged.
- [ ] Wire till modifier, party-name, seat, station choice, dead-end choices, split/transfer/serve/name/review dialogs, tender input, bill payment/refund/adjustment/cancellation/departure, collection and supervisor proof. Scope the protection to unsubmitted inputs. Never add a question between explicit Submit and its sale/payment/provider operation. Existing busy phases and result displays remain exempt.
- [ ] For every P modal row in the audit, add assertions in its listed owner suite: edit then Cancel/Escape retains values; Discard emits the existing cancellation once; revert skips warning; emitted normalized value matches the committed baseline; rejected write warns; successful write followed by refresh refusal does not warn. Test an existing backdrop only where present. For every E family, assert close remains direct and automatic writes retain their normal trigger.

Run the exact sibling suite from the audit after each owner change using `pnpm --filter <package> test <package-relative-suite>`. These are the focused first-pass groups; the audit's additional suites supply each owner's coverage rather than stopping after these examples:

```sh
pnpm --filter @waitron/dashboard test src/widgets/product-editor.test.ts src/widgets/variant-form.test.ts src/widgets/unit-form.test.ts src/widgets/extra-list-form.test.ts src/widgets/option-list-form.test.ts src/widgets/option-label-form.test.ts src/screens/catalogue-screen.test.ts
pnpm --filter @waitron/dashboard test src/screens/menus-screen.test.ts src/widgets/section-details-form.test.ts src/widgets/add-to-menus.test.ts src/widgets/section-add-products.test.ts src/widgets/member-list-editor.test.ts
pnpm --filter @waitron/dashboard test src/screens/staff-screen.test.ts src/widgets/person-form.test.ts src/widgets/person-edit.test.ts src/widgets/shift-dialog.test.ts src/widgets/purchase-form.test.ts src/screens/devices-screen.test.ts src/screens/printers-screen.test.ts src/screens/payments-screen.test.ts src/screens/profile-screen.test.ts
pnpm --filter @waitron/venue-service test src/dashboard/prep-stations-screen.test.ts src/dashboard/venue-operations-screen.test.ts src/dashboard/station-hours-form.test.ts src/dashboard/watcher-form.test.ts
pnpm --filter @waitron/media test src/dashboard/image-library.test.ts src/dashboard/image-library.narrow.test.ts
pnpm --filter @waitron/bookings test src/dashboard/booking-form.test.ts src/dashboard/bookings-screen.test.ts
pnpm --filter @waitron/adjustments test src/dashboard/reasons-screen.test.ts
pnpm --filter @waitron/payments-sumup test src/dashboard/sumup-connect-form.test.ts src/dashboard/sumup-add-reader.test.ts
pnpm --filter @waitron/payments-stripe test src/dashboard/stripe-connect-form.test.ts src/dashboard/stripe-add-reader.test.ts
pnpm --filter @waitron/till test src/widgets/modifier-picker.test.ts src/widgets/party-name-dialog.test.ts src/widgets/seat-dialog.test.ts src/widgets/station-choice-dialog.test.ts src/widgets/dead-ends-dialog.test.ts src/widgets/tender-pay.test.ts src/screens/till-table-order-screen.test.ts
pnpm --filter @waitron/till test src/widgets/bill-pay-dialog.test.ts src/widgets/bill-refund-dialog.test.ts src/widgets/adjustment-dialog.test.ts src/widgets/cancel-credit-dialog.test.ts src/widgets/unpaid-departure-dialog.test.ts src/widgets/find-bill-dialog.test.ts src/widgets/supervisor-override-dialog.test.ts
```

Expected red in each P owner: its real Cancel/native Escape currently emits close or removes the editor with edited fields. Negative control: an unchanged/reverted owner still closes directly. Nested control: saving an option label closes that child while editing parent options still asks. Keep existing unrelated assertions, including held-order identity/pricing and pairing cleanup.

## 5. Shared history adapter and shell integration

- [ ] Add `packages/ui/src/navigation-guard.test.ts` and `navigation-guard.ts`; extend `url-state.test.ts` before changing `url-state.ts`. Keep dirty truth in ui-core; the ui adapter manages browser route/history sequencing and accepts the shared coordinator. Existing controllers subscribe to accepted routes after one adapter has intercepted traversal. Replace direct receipt-preview push/replace/popstate calls in `apps/dashboard/src/screens/receipts-screen.ts` and direct replaceState calls in `apps/dashboard/src/dashboard-app.ts` and `apps/dashboard/src/screens/login-screen.ts`; otherwise they can bypass restored-route sequencing or erase the index. Cover these paths in receipt/login/shell owner suites.
- [ ] Assert namespaced index preserves unrelated history.state/query parameters; initial replace seeds an index; approved writes push once; same URL and disconnected controllers do not push. On dirty Back/Forward, restore accepted indexed entry before asking, Keep restores URL and visible page, Discard replays once. Confirm both directions and multiple controllers receive only accepted snapshots.
- [ ] Assert rapid Back twice/concurrent sidebar request cannot replace pending destination; restoration events cannot prompt recursively; generation protects save/disconnect/reconnect/session reset; an unindexed same-document entry preserves the mounted draft, replaces only the traversed entry with the accepted URL/state in a fresh tracking epoch, then asks. Keep remains there; Discard replaces that same entry with the captured destination and publishes once. Assert both Back/Forward answers, preserved unrelated state, no guessed history.go, no new push and no loops. Use real Chromium history in addition to callback tests.
- [ ] Extend `dashboard-app.test.ts`, `till-app.test.ts`, `setup-app.test.ts`; add exact new `apps/dashboard/src/dashboard-app.unsaved-changes.test.ts`, `apps/till/src/till-app.unsaved-changes.test.ts`, `apps/setup/src/setup-app.unsaved-changes.test.ts` for route matrices. Intercept sidebar/menu/tab/breadcrumb/deep link/profile/locale/context and Back/Forward before mutation, including ordinary same-app anchors emitted by contributed screens. Add a clicked image-usage-link assertion to `packages/media/src/dashboard/image-library.test.ts` and shell suite; modified/new-tab/download links retain their behavior. Voluntary logout asks before API call; expiry, suspension, inactive session, inactivity lock and operator/device switch never ask and invalidate pending decisions.
- [ ] Test native reload in Chromium after an actual input activation, accepting and rejecting the native dialog via a Playwright provider browser command. Put command support in the affected app's `vitest.config.ts`, with the behavioral case in its new shell suite. Clean/reverted/saved scope has no prompt. Document unsupported/no-activation behavior without promising every platform. Do not use a custom dialog for direct browser leaving.

```sh
pnpm --filter @waitron/ui test src/navigation-guard.test.ts src/url-state.test.ts
pnpm --filter @waitron/dashboard test src/dashboard-app.test.ts src/dashboard-app.unsaved-changes.test.ts
pnpm --filter @waitron/till test src/till-app.test.ts src/till-app.unsaved-changes.test.ts
pnpm --filter @waitron/setup test src/setup-app.test.ts src/setup-app.unsaved-changes.test.ts
```

Expected red: route/URL/session changes before Keep; rejected Back leaves the wrong URL; a restoration loops or fires duplicate prompts; logout API called despite Keep. Forced-exit control must still immediately leave and clear typed secrets.

## 6. All page, inline-row and setup owners

- [ ] Dashboard pages: device profiles, canvas/card settings, floor table rows, service-status rows, recipe selections, my-schedule requests, receipt parts, backup/export and stream settings; login methods/steps and contributed reason limit/venue inline settings. Inspect the exact body in each owner before supplying its comparison. Reset only the saved row/part. Protect leave of staged tabs, not view tabs within one retained form. Receipt Save must exercise one successful part with one failed part and a failed following refresh.
- [ ] Setup: admin, venue, certificate, configuration import, archive/bucket/cloud restore, connect/adopt and reset proof. Each Next writes its existing patch into the root draft and clears only its child scope. Root remains protected through preview/review until provisioning succeeds. Back preserves a root draft; unpatched step input asks. Mode/start-over asks before removing root values. Review/provisioning/fiscal-test/results and safety acknowledgements stay exempt as specified in the audit.
- [ ] Till: independent schedule requests and enrolment name/proof; local pre-command table/review inputs. Keep party DraftSync automatic saves, serialized writes, flush, refused writes, takeover and logout close intact. Counter retained view/logout needs no basket warning; memory-only destructive switch/unload does. W69 Discard resets local edits without deleting persisted order, changing hashes/numbering or issuing a payment command.
- [ ] Execute every P/E page row's listed suites. Add a representative distinct edited field and actual request-body assertion for each independent form in a grouped owner. Do not infer coverage for absence from cover-request, reader rename from connect, or one receipt write from another.

```sh
pnpm --filter @waitron/dashboard test src/screens/device-profiles-screen.test.ts src/screens/canvas-editor-screen.test.ts src/screens/floor-screen.test.ts src/screens/service-status-screen.test.ts src/screens/recipe-screen.test.ts src/widgets/recipe-editor.test.ts src/screens/my-schedule-screen.test.ts
pnpm --filter @waitron/dashboard test src/screens/receipts-screen.test.ts src/screens/backup-screen.test.ts src/screens/stream-settings-panel.test.ts src/screens/login-screen.test.ts src/screens/units-screen.test.ts
pnpm --filter @waitron/venue-service test src/dashboard/venue-operations-screen.test.ts src/dashboard/service-settings-panel.test.ts src/dashboard/prep-stations-screen.test.ts
pnpm --filter @waitron/adjustments test src/dashboard/reasons-screen.test.ts src/dashboard/adjustment-report-screen.test.ts
pnpm --filter @waitron/setup test src/setup-app.unsaved-changes.test.ts src/screens/admin-screen.test.ts src/screens/venue-screen.test.ts src/screens/cert-screen.test.ts src/screens/live-source-screen.test.ts src/screens/restore-screen.test.ts src/screens/restore-bucket-screen.test.ts src/screens/cloud-restore-screen.test.ts src/screens/connect-screen.test.ts src/screens/reset-screen.test.ts
pnpm --filter @waitron/till test src/screens/till-schedule-screen.test.ts src/screens/till-enrol-screen.test.ts src/screens/till-lock-screen.test.ts src/screens/till-counter-screen.test.ts src/screens/till-table-order-screen.test.ts src/state/working-order.test.ts src/state/draft-sync.test.ts
```

Expected red: changing selected profile/recipe/table/step destroys the dirty payload; setup child Next makes root falsely clean; first saved receipt part is warned about after another part fails; forced lock waits for the new prompt. Autosave control: existing party draft reaches its existing API and retains refusal handling without any W69 prompt.

## 7. Evidence, deletion controls and completion

- [ ] Add no tests that merely repeat registry implementation. Exercise owner values, actual emitted bodies, native openness, URLs, focus and call counts. Keep negative controls: clean/read-only/reverted/successful save/automatic save. Do not weaken any historical behavioral assertion to fit a new mechanism.
- [ ] Run critical deletion controls only in a disposable detached clone of the complete candidate tree with dependencies installed. Remove the pre-close interception and run `pnpm --filter @waitron/ui test src/components/wt-dialog.test.ts`; expected failure is the edited owner closing while asking. Separately remove history request interception and run `pnpm --filter @waitron/ui test src/navigation-guard.test.ts`; expected failure is rejected traversal changing accepted URL/view. A control that fails only because an import is missing is inconclusive. Restore/remove the disposable copy; never swap source files in the feature worktree.
- [ ] Before Chromium runs, inspect `memory_pressure` and heavy/testing processes, and avoid concurrent coverage directories. Run focused tests during development; retain output with actual Tests counts. Package-wide tests/coverage belong to CI on current head, including affected contributed packages and consumers. Do not add a whole-workspace local run or duplicate the normal pre-push hook.
- [ ] Update `docs/developers/design-system.md` Forms/Dialog sections and `docs/developers/conventions-ui.md` with the shared API, baseline/success boundary, forced-exit exemption and native-prompt limits. Keep the audit current with implemented owner decisions.
- [ ] Inspect confirmation and representative nested/modal/page flows in both themes at phone and desktop widths; run token-painting and axe states for the new primitive. Recheck each audit row as implemented or exemption tested. Repeat path discovery to catch advancing owners, not as a substitute for behavioral assertions.
- [ ] For deliberately changed existing checks, include PR “Changed test checks”: `file:line`, previous assertion, replacement assertion, design paragraph and why equally strict; add the owner's FYI entry via the parent workflow. Controversial weakening/unasked semantic changes retain their existing STOP rule. No additional approval gate is introduced by this plan.
- [ ] Update a matching W69 backlog row in the same implementation change if one exists by then; otherwise the parent adds its concise in-progress entry. Do not mark W69 done after PR 1. Completion requires all protected/exempt owner coverage, normal hook once and current-head required CI. This bounded planning invocation does not commit, finish, land or change campaign state.
