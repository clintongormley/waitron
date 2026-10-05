# Warn before you lose unsaved changes

You should be able to close an editor without losing work by accident. W69 adds one shared warning for edited forms across the dashboard, till, setup wizard and contributed management screens. When you try to leave, **Keep editing** preserves the form and receives initial focus; **Discard changes** explicitly abandons only the drafts that the requested action would leave.

This follows the owner's W69 instructions of 2026-10-04 and 2026-10-05, including protection when leaving any page and the changed-test-check rule. The source baseline is `5597e06923b64acacf9df54ed6e8fb42e7fa411e`. The [audit](../plans/2026-10-05-unsaved-changes-audit.md) records observed owners and proposed treatment; the [plan](../plans/2026-10-05-unsaved-changes-warning.md) covers the entire item, optionally in two PRs. Source inspection is not runtime verification.

## What counts as unsaved

A form is dirty when the values you would submit differ from the values captured after its initial defaults and loaded values were applied. Changing a value and changing it back clears the warning. Compare normalized payloads, rather than keystrokes, interaction flags or raw server objects. Object key order is irrelevant. Selection sets compare membership; ordered rows, variants, menu positions and preference lists retain order wherever the write assigns positions. An empty value becomes null only where the existing submitter does that. Invalid input remains distinguishable rather than disappearing into a default. No validation, monetary rounding or request body changes are part of W69.

Capture a detached baseline once per editor identity. A background read must not overwrite that baseline or the current draft. After a write succeeds, commit the submitted snapshot immediately, before a subsequent refresh. If the user edited again while the write ran, compare that newer draft with the committed snapshot. A failed write stays dirty. Independently saved rows and receipt settings parts commit independently; a partial failure cannot clear another part's changes.

Read-only views, unchanged or reverted forms, successful saves and existing automatic saves are exempt. Search, report and preview controls that do not author a staged write are exempt. Explicitly submitted credential and payment-input forms receive the same protection before submission, but W69 never adds a confirmation to the submission itself. Acknowledgements in safety confirmations remain those confirmations, without another discard question.

## One shared mechanism, with owners supplying the meaning

Use `@waitron/ui-core` for a browser-safe dirty registry and leave coordinator. Its existing explicit source and publication exports, barrel and browser build support a new `./unsaved-changes` entry. It has no domain dependency. Render the confirmation through `@waitron/ui`, alongside `wt-dialog` and `wt-modal`. Do not put the mechanism in a server package or introduce a dependency from `dashboard-kit` to application forms. The existing URL controller lives in `packages/ui/src/url-state.ts`.

The proposed interfaces are deliberately small:

```ts
type LeaveReason = "cancel" | "escape" | "backdrop" | "navigation" | "signout";
type LeaveDecision = "keep" | "discard";
type LeaveOutcome = "proceeded" | "kept" | "busy" | "stale";
interface DraftOwner<T> {
  id: object;
  parent?: object;
  current(): T;
  snapshot(value: T): T;
  equal(a: T, b: T): boolean;
  restore(snapshot: T): void;
}
interface DraftScope<T> {
  readonly id: object;
  changed(): void;
  isDirty(): boolean;
  commit(submitted: T): void;
  dispose(): void;
}
interface LeaveRequest {
  scopes: readonly object[];
  reason: LeaveReason;
  proceed(): void | Promise<void>;
}
type ConfirmLeave = (
  question: { reason: LeaveReason; dirtyScopes: readonly object[] },
  signal: AbortSignal,
) => Promise<LeaveDecision>;
interface LeaveCoordinator {
  register<T>(owner: DraftOwner<T>): DraftScope<T>;
  request(request: LeaveRequest): Promise<LeaveOutcome>;
  isDirty(scopes?: readonly object[]): boolean;
  forceReset(): void;
  dispose(): void;
}
declare function createLeaveCoordinator(confirm: ConfirmLeave, target: Window): LeaveCoordinator;
```

`register` captures `snapshot(current())` after initialization. Each owner calls `changed` after an input changes its comparison payload, including a revert; that notification updates the dirty-only unload listener immediately. `commit` snapshots the submitted values, updates the baseline and invalidates an outstanding decision affecting that scope. Disposal unregisters the owner. Owners detach mutable arrays/maps in `snapshot`; opaque File references may be retained in memory for identity comparison, and existing Decimal values keep their exact comparison representation. Snapshotting must not clone a File into an unequal selection, log secrets or change the submitted request.

`request` returns `busy` without a second question while one is pending. It returns `kept` on Keep, `stale` after an affected scope changes identity/baseline or security reset, and `proceeded` only after its one continuation finishes. A failed continuation rejects to its existing caller's error handling. A clean request proceeds directly. The renderer receives an AbortSignal; abort dismisses its question without a Discard decision, and a late renderer result cannot run the continuation. `forceReset` aborts the question, unregisters scopes and removes unload handling without restoring domain data; the existing forced-exit owner clears its sensitive form values immediately. `dispose` also removes document listeners and releases all captured references.

The registry does not retain credentials in storage, serialize drafts into history, log payloads or know how to save an entity. Owners supply a canonical payload reader and a local reset. A parent-child relationship allows closing a parent to cover its dirty descendants with one question. Closing a child covers that child only. Saving a variant or option-label into its parent commits the child and updates the parent draft; it does not commit the parent's server write. Discarding an image editor cannot delete an already uploaded image or reset the containing product.

Allow one pending confirmation per application. A second leave request is refused while the first is pending, rather than replacing its destination. Keep editing, Escape on the confirmation, and its dismissal all resolve to stay. Discard restores affected local drafts and then performs the original action once. A save, disconnect, replaced editor or forced session change invalidates stale answers. Before applying Discard, re-evaluate current scope generations and baseline versions so a completed save cannot be undone by an old prompt.

## Closing a dialog

Today `wt-dialog` handles native `cancel` and delayed `close`; it suppresses stale close reports when the native dialog has reopened and reopens a nondismissible dialog. `wt-modal` inherits that behavior. Preserve these assertions and trace every consumer before changing this shared gate.

Add `WtDialog.requestClose(reason: LeaveReason): Promise<boolean>` and a `beforeClose` property of type `(reason: LeaveReason) => Promise<boolean>`, inherited by `wt-modal`. The owner supplies a coordinator request with its scopes and a no-op proceed callback; approval lets requestClose perform the existing native close and owner close report once. `closeAfter("saved" | "security")` is the explicit successful-write/forced-teardown bypass. Each attempt captures the dialog opening generation before awaiting. Keep existing open bindings for rendering, but route user dismissal mutations through requestClose. Native Escape must be prevented while the decision is outstanding; hold native `closedby` at `none` for a guarded dialog so repeated Escape cannot silently close its owner. Explicit Cancel, close icons, app-owned Back and an existing backdrop dismissal use the same request path. Do not add backdrop dismissal to owners that do not have it. Successful writes and forced security teardown have explicit bypass reasons; setting `open=false` must not become an undocumented way to bypass a user dismissal.

The confirmation stays above the original editor. Keep editing returns focus to the relevant editor control, leaving parent and child values intact. Discard closes only after approval. Child `wt-close` events cannot close a parent through bubbling. Handle delayed native reports with an opening/request generation, rather than assuming every report describes the current opening. Retain existing nondismissible busy phases, payment cancellation and pairing cleanup.

## Leaving a page

Route direct history consumers in `receipts-screen.ts` (including its popstate preview restorer), `dashboard-app.ts` and `login-screen.ts` through the accepted-history adapter as well as every UrlStateController. A login redirect must preserve the adapter namespace when replacing other state. Connect sidebar, menu, tab, breadcrumb, product deep link, profile opening/closing, in-app Back/Forward and voluntary signout to the same coordinator before route or session mutation. Scope the request to the forms the destination leaves. Same-app links, including contributed image-usage links and breadcrumbs, must request navigation before their default click changes the document; inspect the dispatched click's composedPath. Preserve modified clicks, new-tab targets and downloads because they do not leave this editor. Tabs that contain staged forms are covered; purely visual tabs within one retained draft do not discard values or create a new baseline. Language switches that recreate a screen also use the gate. Voluntary signout asks before calling logout. Forced session expiry, suspension, server-required signout, inactivity lock and security/operator switches bypass the prompt, cancel any pending question, and discard local sensitive form values. Existing retained order state follows its existing lifecycle.

Replace independent `popstate` restoration with one document-level history adapter in `@waitron/ui`. All `UrlStateController` instances subscribe after that adapter has accepted a route. Keep an index in a namespaced history-state member while preserving other state. On traversal to an indexed same-document entry, restore the previous accepted entry with `history.go(delta)` without publishing a route, then ask once. After approval, replay the requested traversal once; Keep editing stays at the restored entry. Use a generation and explicit restoring/replaying phases, including rapid multiple Back presses, disconnect, save and session reset. There must be no push-on-cancel history loop. Initial entries are indexed with replaceState; unindexed same-document entries take a guarded fallback, because their popstate does not fire beforeunload. Capture the destination URL/state, keep the accepted screen and draft mounted, and replace the traversed entry with the accepted URL/state before asking. Start a new history-tracking epoch at index zero on that entry, so old indices cannot imply a guessed delta. Keep editing stays on that replacement; Discard replaces the same entry with the captured destination/state, preserving unrelated state and the new namespace, then publishes it once. This fallback rewrites the traversed entry rather than adding entries; document-boundary navigation uses the native unload warning separately. Test both answers, both traversal directions, old-epoch entries, repeated requests and absence of recursive prompts or extra pushes.

Register `beforeunload` only while at least one nonexempt scope is dirty; remove it after revert, successful commit, disposal or forced reset. Request the standard browser warning with `preventDefault()` and a nonempty `returnValue`. Custom dialogs cannot guarantee interception of reload, external navigation or browser leaving.

| External claim                              | Primary-source words                                                                                                                                                                                                                                                                | Consequence                                                                                                                                                                                                          |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native unload warning, consulted 2026-10-05 | WHATWG says the document must have “sticky activation” and “The message shown to the user is not customizable”. [Prompt to unload a document](https://html.spec.whatwg.org/multipage/browsing-the-web.html#prompt-to-unload-a-document) also leaves the decision to the user agent. | Use the native wording and test a user-activated Chromium reload. Do not promise a prompt without activation or on every platform. Mobile process termination and platform-specific reliability are unverified here. |

## Order drafts and in-flight work

`apps/till/src/state/draft-sync.ts` already saves party drafts automatically, flushes during existing transitions and closes its writer according to the current logout sequence. Those drafts are exempt; preserve that sequence, refusal handling and takeover behavior. Do not call an order deletion, cancellation or payment reversal as a W69 discard action.

`WorkingOrderStore` retains counter state across current in-app views and logout. Its dirty flag is about its server line synchronization, not all UI values, and cannot serve as the form registry. Protect a memory-only/unassigned basket against browser unload or a destructive local replacement that loses it, comparing its actual order payload including its label. A view change or logout that retains that basket needs no basket warning. A retrieved order can have local edits protected against replacement, without deleting its persisted row. Local modifier, station, split, transfer, payment-entry and reason forms are separate scopes until their explicit existing action accepts the values. Autosaving basket notes remain part of the store rather than a second independent editor.

Security always wins over a warning. No new credential or order storage is introduced. Nothing makes an external provider, fiscal filing, sale, payment submission, hash or invoice-number allocation wait on this mechanism. In-flight operations retain their current busy/nondismissible behavior and results.

## Acceptance and delivery constraints

Exercise native dialog behavior in real Chromium, including repeated Escape, delayed close, nested forms and focus. Check the shared confirmation with axe in both themes, EN and ES, at phone and desktop widths, using existing tokens and the modal sizing contract. Preserve W70a #1265's landed compact-height behavior when reconciling main; do not flatten standard, wide or nested modal height.

Every protected audit row needs a behavioral assertion on its actual submitted values and leave route, plus clean/revert/save exemptions. Every exempt family needs an assertion that it remains exempt. Reuse existing suites and keep their behavioral assertions. The owner's moved-item rule permits equally strict changed checks with a PR “Changed test checks” record and FYI entry; it does not authorize weakening fiscal, payment, session or permission checks.

Re-audit advancing source before implementation and before PR finishing. W70a, Lane D prep-station tabs, Lane C device dialog edges, Lane A receipt top block, A231 and W41s-10c overlap is waived; whoever lands second rebases and verifies the combined behavior. No migration or backward-compatibility work is needed. No genuine product question remains open in this design; unknown browser-platform behavior is an explicitly limited guarantee, not a request to change the product contract.
