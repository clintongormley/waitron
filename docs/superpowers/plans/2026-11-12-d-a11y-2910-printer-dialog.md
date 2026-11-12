# D-a11y-2910: printer dialog contrast

## Request

Recorded in the local Lane D campaign receipt `receipts/d-a11y-2910/request.md`, word for word:

- **Ask:** `apps/dashboard/src/screens/printers-screen.a11y.test.ts` "keeps setup forms inside desktop and phone dialogs" (light and dark) fails axe color-contrast [serious] at `#printer-details-used-by` on #2896, #2914 and perf/a1398-2 (test-dashboard (4)). It started after #2910 (bf3fead0bf, 06:04: `.body` in wt-dialog.ts gained a position), whose PR CI ran only the ui package, not the dashboard that depends on it (CLAUDE.md §2: PRs test changed packages, not dependents).
- **Do:** run that test on main and on bf3fead0bf^ in a throwaway checkout to confirm the cause, then fix forward in the shared primitive (or the screen, if the primitive is right), keeping #2910's hint containment and its regression test. Never weaken or skip the accessibility check. Run the dashboard's other dialog a11y files too. Small; one PR; tell lanes K and L in their questions.md when it lands.

## Evidence and result

Driver's receipts: campaign `receipts/d-a11y-2910`. System font passes main `14931d8078` and parent `41272511e3`; Arial fails main in both themes, matching CI's Used-by heading/Delete-button ratios 2.71/2.11, but passes that parent. Footer positioning passes both; body `z-index: 0` or background does not. Diagnostic source changes were restored before plan review.

The screenshot shows no visible heading/button overlap. The claim is limited to the reproduced axe failure; footer-over-body paint order is the source-based explanation. `git rev-parse bf3fead0bf^` returned `41272511e386ddfede0a593207d60730a8e09b6f`. Preserve A1259 hidden-hint containment while preventing this stacked-dialog contrast-scan regression.

## Build and validate

1. In `apps/dashboard/src/screens/printers-screen.a11y.test.ts`, pin `--wt-font-family: Arial, sans-serif` only in the selected fixture, with one short comment naming the layout it exercises. Preserve every assertion; no extra sweep. Run `pnpm --filter @waitron/dashboard exec vitest run src/screens/printers-screen.a11y.test.ts -t 'keeps setup forms inside desktop and phone dialogs'`; observe both themes fail for the reported contrast reason.
2. Add only `position: relative` to `.footer` in `packages/ui/src/components/wt-dialog.ts`; retain `.body` positioning. Rerun green. Keep unchanged `wt-dialog.test.ts`'s “keeps hinted fields inside the body without scrolling the native dialog”.
3. Run `pnpm --filter @waitron/ui exec vitest run src/components/wt-dialog.test.ts src/components/wt-dialog.a11y.test.ts src/components/wt-modal.test.ts src/components/wt-modal.a11y.test.ts`; keep the behavioral files and modal accessibility suite unchanged; the shared dialog accessibility guard below is the cleared exception. Run the 45 dashboard accessibility files selected by `wt-modal|wt-dialog|openDetails|detailsEdit`; record their exact paths locally. Also run dialog accessibility files in other consumer packages, selected by `wt-modal|wt-dialog|WtDialog|WtModal`, plus staffing and payment-provider accessibility files for indirect consumers. Use focused file runs, not whole-package suites. Require actual passing test counts. The dashboard fixture edit selects its package for PR CI: require every selected ui/dashboard job, including all four dashboard shards, to pass on the current head.
4. Inspect local EN/ES, light/dark, phone/desktop screenshots using a screenshot-only temporary probe. Keep probe and mockups uncommitted. Backlog search found no entry naming this regression, so no backlog change is needed.

## Bounds and clearance

Forecast after 08:18 clearance: production +1/-0; tests +22–38/-0; support 0; docs 25–40 lines. No palettes, controls, helpers, guide wording or other behaviour. Claude reviewed this plan (198 seconds); the driver accepted the test-selection, current-head CI, font fallback, parent-SHA and claim limits. Neither review nor clearance is owner design approval. One PR; notify K/L after landing.

**Clearance:** The watcher cleared this plan on 2026-11-12 at 07:56 in Lane D questions.md: “Build the one-line shared footer fix and the fixture font line, keep #2910's hint containment and its regression test unchanged, and weaken no assertion.” This is watcher clearance, not owner design approval.

**Shared guard, watcher 08:18:** The angle run-it reviewer found that UI-only changes do not run the dashboard guard. The watcher cleared one 15-minute attempt in Lane D questions.md at 08:18, adding 20–35 lines to `wt-dialog.a11y.test.ts`. Reuse its mount and axe helpers with stacked dialogs and clipped grid content aligned with the footer button. The shared case failed in both themes with only the footer position deleted (the same 2.71/2.11 ratios), then passed with it restored. No helper or production branch was added.
