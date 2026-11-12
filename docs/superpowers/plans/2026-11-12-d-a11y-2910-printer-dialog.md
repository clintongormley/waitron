# D-a11y-2910: printer dialog contrast

## Request

Recorded at `/Users/clintongormley/waitron-campaign-d/receipts/d-a11y-2910/request.md`, word for word:

- **Ask:** `apps/dashboard/src/screens/printers-screen.a11y.test.ts` "keeps setup forms inside desktop and phone dialogs" (light and dark) fails axe color-contrast [serious] at `#printer-details-used-by` on #2896, #2914 and perf/a1398-2 (test-dashboard (4)). It started after #2910 (bf3fead0bf, 06:04: `.body` in wt-dialog.ts gained a position), whose PR CI ran only the ui package, not the dashboard that depends on it (CLAUDE.md §2: PRs test changed packages, not dependents).
- **Do:** run that test on main and on bf3fead0bf^ in a throwaway checkout to confirm the cause, then fix forward in the shared primitive (or the screen, if the primitive is right), keeping #2910's hint containment and its regression test. Never weaken or skip the accessibility check. Run the dashboard's other dialog a11y files too. Small; one PR; tell lanes K and L in their questions.md when it lands.

## Evidence and result

Driver's provisional receipts: campaign `receipts/d-a11y-2910`. System font passes main `14931d8078` and parent `41272511e3`; Arial fails main in both themes, matching CI's Used-by heading/Delete-button ratios 2.71/2.11, but passes that parent. Footer positioning passes both; body `z-index: 0` or background does not. No implementation retained.

Preserve A1259 hidden-hint containment while preventing this stacked-dialog contrast regression.

## Build and validate

1. In `apps/dashboard/src/screens/printers-screen.a11y.test.ts`, pin `--wt-font-family: Arial` only in the selected fixture. Preserve every assertion; no extra sweep. Run `pnpm --filter @waitron/dashboard exec vitest run src/screens/printers-screen.a11y.test.ts -t 'keeps setup forms inside desktop and phone dialogs'`; observe both themes fail for the reported contrast reason.
2. Add only `position: relative` to `.footer` in `packages/ui/src/components/wt-dialog.ts`; retain `.body` positioning. Rerun green. Keep unchanged `wt-dialog.test.ts`'s “keeps hinted fields inside the body without scrolling the native dialog”.
3. Run `pnpm --filter @waitron/ui exec vitest run src/components/wt-dialog.test.ts src/components/wt-dialog.a11y.test.ts src/components/wt-modal.test.ts src/components/wt-modal.a11y.test.ts`; leave these files unchanged. Run focused dashboard accessibility files using dialogs, including indirect consumers. Require actual passing test counts.
4. Inspect local EN/ES, light/dark, phone/desktop screenshots using a screenshot-only temporary probe. Keep probe and mockups uncommitted. Search backlog; update only an entry naming this regression.

## Bounds and clearance

Forecast: production +1/-0; tests +1–3/-0; support 0; docs 20–40 lines. No palettes, controls, helpers, guide wording or other behaviour. Claude reviews this plan, then the watcher clears it before implementation; neither is owner design approval. One PR; notify K/L after landing.
