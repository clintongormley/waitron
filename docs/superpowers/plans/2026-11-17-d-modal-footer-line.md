# D-MODAL-FOOTER-LINE

Finish line: either remove a reproduced, unintended blue footer-top line through the shared primitive, or retire the stale observation with measured evidence. Source: `/Users/clintongormley/waitron-campaign-d/queue.md`, D-MODAL-FOOTER-LINE.

Driver checks this separately authored plan; Claude reviews it; watcher clears it before build. No owner approval request.

1. **Reproduce before deciding.** Record the current main SHA and browser version. Start from `packages/ui/src/components/wt-dialog.ts:67–74`: opening-focus outline suppression already exists. Read the November 10 non-reproduction in `docs/backlog/dashboard.md`; it is context, not new evidence.

   Reuse `apps/dashboard/src/widgets/person-edit.ts`, `person-edit.test.ts`’s “keeps any other server refusal…” case, `mountWidget`, and UI `mount`/`openAfterEscape` helpers. Open the real editor by `userEvent.click`, edit, and deliver `connection.failed` without field errors. Also click-open a compact `wt-modal` “Delete Ada?” question using existing modal markup; leave the floor editor alone. Exercise fresh pointer opening and opening after Escape, light/dark, 390×844/1280×900. Use `page.viewport`; measure `window.innerWidth`. Restore viewport/theme and await `wt-close` when closing.

   Before/after refusal and on Delete opening, capture screenshots under ignored `__screenshots__/` and record deep active element, `:focus-visible`, opening-focus class, outline style/width/colour/offset, body/footer rectangles, footer border colour, and scroll/client heights. Compare the painted line with these measurements. ArrowDown and Shift+Tab back to the body must retain visible keyboard focus.

2. **Choose from evidence.** If reproduced, add the smallest browser assertion that fails for that line before implementation, then fix only `packages/ui/src/components/wt-dialog.ts` and/or `packages/ui/src/components/wt-modal.ts`. Conditional tests: `packages/ui/src/components/wt-dialog.test.ts`, `packages/ui/src/components/wt-modal.test.ts`; extend `apps/dashboard/src/widgets/person-edit.test.ts` only for demonstrated integration behaviour. Preserve refusal announcements and `wt-form-error-summary`. No framework.

   Validate by behavioural owner: dashboard’s named no-field refusal case; UI’s new regression and existing opening/ArrowDown/Shift+Tab cases. Use package-scoped `exec vitest run <file> -t <case>`; inspect counts. Repeat the visual matrix. No whole-package suites.

3. **Close documentation.** Remove the footer-line sub-bullet and reconcile its duplicate observation/bundle wording in `docs/backlog/dashboard.md` and index in `docs/backlog.md`, retaining summary retirement. If absent, record exact commands/measurements in the eventual commit; remove temporary probes, build nothing, add no permanent tests.

Expected changed lines if fixed: production 10–40; tests 30–120; docs 10–40 (about 50–200 total). If absent: production/tests zero; docs-only removal and evidence.

**Driver reproduction, before build:** on main-derived 93a8d857ee, Chromium158.0.8127.18, the real person editor and compact question showed no unwanted line across EN/ES × light/dark ×390/1280 (8 cases; first matrix8passed, extended matrix8passed). Body outlines were none before/after no-field refusal, on pointer question opening and after Escape; the keyboard control was solid. Screenshots show the existing1px grey footer border in both themes. Evidence: local `receipts/modal-footer-line/{probe-complete.log,probe.json,measurements.json}` and32screenshots; no production change. Recommend the non-reproduction closure path after review/clearance.
