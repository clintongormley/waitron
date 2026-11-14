# A1528-4: fixed department window

**Status:** unattended Lane I draft. The driver reviews and commits it, then Claude reviews it; watcher clearance is required before building. No owner approval of this design is claimed.
**Request:** `~/waitron-campaign-i/queue.md`, A1528-4, and `docs/backlog.md`, A1528: keep the title and tabs above scrolling content and Save/Cancel in the actual modal footer on every tab.
**Finish line:** Details, Service, Receipts and Transfers retain their title, tabs and one visible Cancel/Save pair while their content scrolls, including at phone width. The selected editor owns the actions and message.
**Boundary:** build from current main; this draft read `d8dd5fde5f`. Lane C owns invoice-description placement; fiscal behavior is excluded. Preserve its changes; whoever lands second resolves overlaps. No other dialogs opt in, no page-wide sticky actions, new controllers, records, action-state copies, dependencies or save/error rules. 

**Reuse:** `wt-dialog`/`wt-modal` already own the body, footer messages and accessible heading; `wt-tabs` retains panels. Keep `department-settings` and `department-receipt-editor` as the owners of their existing save, validation, Enter and draft-scope behavior. Reuse `wt-form-actions`, `saveActionState`, `submitOnEnter` and `draftScopeFor`.

## Implementation, with failing behavioral tests before each code change

- [ ] **Fixed heading:** add Boolean `fixedHeading` (`fixed-heading`, default false) to shared `wt-dialog`; enable it on the department modal. Factor its existing heading/help/description markup once; opted in, render it in a non-shrinking sibling before `.body`, preserving IDs, naming and help behavior. Keep the default layout. Match modal header/body/footer inline padding through existing tokens; remove the opted-in body's top gap so tabs start directly below the heading.
- [ ] **Sticky tabs:** add Boolean `sticky` (default false) to `wt-tabs`; enable it on department settings in external-actions mode. Only opted in, make `.tab-row` sticky at the scrolling body's top with an opaque token-painted background and stacking above panel content. Keep retained panels, horizontal overflow and keyboard selection; add no second vertical scroller.
- [ ] **Reuse the action rendering:** give `department-settings` and the receipt editor `renderFooter(slot?: "footer"): unknown`, extracting their current action markup verbatim, including lexical click handlers. Add `externalActions` (property only, default false); standalone rendering stays inline. The dialog enables it on settings, which forwards it to the mounted receipt editor. Settings delegates `renderFooter` to receipts only on Receipts; the other tabs use its own row. Supply `slot="footer"` on the returned `wt-form-actions` itself, directly under `wt-modal`, so the primitive lifts its error above the buttons.
- [ ] **Refresh without copied state:** editors emit a bubbling/composed `footer-change` after updates in external mode; the current dialog requests a render and calls the form's method. Notify independently of the receipt invalid-mark early return; ignore departed editors and avoid render loops. Expose each owner's Lit Save ref as `get saveButton(): HTMLElement | null`; use it for Enter and receipt-refusal focus after footer rendering. A hidden receipt must never submit through department Save. Retain existing guards, refusal retry, close-after-save and combined unsaved prompt.

## Exact file ownership

Prefixes below are directory abbreviations only: **U** = `packages/ui/src/components/`; **V** = `packages/venue-service/src/dashboard/`; **D** = `apps/dashboard/src/`.

- Production: U `wt-dialog.ts`, `wt-modal.ts`, `wt-tabs.ts`; V `department-settings.ts`, `department-edit-dialog.ts`; D `screens/department-receipt-editor.ts`.
- Primitive tests: U `wt-dialog.test.ts`, `wt-dialog.a11y.test.ts`, `wt-modal.test.ts`, `wt-modal.a11y.test.ts`, `wt-tabs.test.ts`, `wt-tabs.a11y.test.ts`.
- Module tests/fixtures: `packages/venue-service/src/testing/department-edit-fixture.ts`; V `department-edit-dialog.test.ts`, `department-edit-dialog.unsaved.test.ts`, `department-edit-dialog-transfers.a11y.test.ts`, `department-settings.test.ts`, `venue-departments-shell.actions.test.ts`, `venue-departments-policy.test.ts`, `venue-operations-loader.test.ts`, `service-edit-dialog.legacy.test.ts`, `departments-zones-shell.test.ts`.
- Dashboard tests/fixtures: create D `dashboard-app.department-window.test.ts`; modify D `dashboard-app.receipt-tab.test.ts`, `testing/department-receipt-editor-fixture.ts`.
- Documentation: `apps/server/src/guide/en/data-protection.md` and its `es` twin, `docs/developers/design-system.md`, `docs/backlog.md`. Extend receipt-editing directions under `{#invoice-notice}`; preserve heading IDs. Document opt-ins and footer delegation; replace the row-below-tabs description. Delete only A1528's delivered fixed-window bullet, leaving Lane C's work intact.

## Behavioral proof and focused commands

- [ ] **Primitives own mechanics:** at 390 and 1280 px, overflow real content and measure heading/help/description, tab strip and footer before/after scrolling; content moves and the frame stays put. Check default-off controls still scroll, modal padding alignment, keyboard focus and tab/panel associations. Override spacing/surface tokens and assert computed paint. Run axe for fixed/default heading, description/help on/off and sticky tabs in both themes, including overflowing content and a footer error.
- [ ] **Mounted dashboard owns integration:** reuse `mountReceiptApp`/`mountReceiptTab` from D `testing/department-receipt-app-fixture.ts`, supplying two departments for Transfers. On all four tabs assert actual footer-slot assignment, exactly one visible pair, native button bounds and fixed geometry after overflow, EN/ES, light/dark, phone/desktop. Use real editors and `userEvent` for selected-endpoint saves, dirty/busy/Enter behavior and refusal retry. Preserve existing cancel, retained-draft and unsaved assertions instead of duplicating their matrix.
- [ ] **Receipt refusal regression:** retain D `dashboard-app.receipt-tab.test.ts`'s delayed fieldless refusal after switching to Details: return to Receipts by replacing the address, show exactly one footer alert, focus the visible native Save and allow retry. Preserve field focus/tab marks, standalone behavior and all existing assertions. Update placement locators and grow the receipt stub for external actions; record these changes in the PR.
- [ ] Run each new assertion red, then green; run these named suites after the implementation. Browser runs are sequential, after the repository's memory-headroom check. Restore incoming viewport/locale; inspect uncommitted captures in both themes at phone/desktop widths.

```sh
pnpm --filter @waitron/ui test src/components/wt-{dialog,modal,tabs}{,.a11y}.test.ts src/components/wt-tabs.help.test.ts
pnpm --filter @waitron/venue-service test --project browser src/dashboard/department-edit-dialog src/dashboard/department-settings src/dashboard/{venue-departments-shell.actions,venue-departments-policy,venue-operations-loader,service-edit-dialog.legacy,departments-zones-shell}.test.ts
pnpm --filter @waitron/dashboard test --project browser src/dashboard-app.{department-window,receipt-tab}.test.ts src/screens/department-receipt-editor
pnpm --filter @waitron/server test src/guide-content.test.ts
pnpm exec vitest run scripts/guide-links.test.ts
```

**Estimate:** production +160/−65 lines; tests/fixtures +350/−55; documentation +25/−10 (about 665 changed lines). If scope materially grows, return it to Claude and the watcher before building. After focused checks, use `finish-branch`, normal push gates and current-head scoped CI; the dashboard/module contract requires the house's two Claude review angles. This draft launches no review, build, commit or merge.
