# A668-5 — Till allergen information

**Goal:** Replace the Allergens screen with product information on long press and nutrition icons beside order-line names.

**Spec:** [Approved A668 design](../specs/2026-10-14-a668-allergen-info-editor-and-till-design.md), especially the 2026-10-15 till answers.

**Execution:** Native, inline, test first. One branch and one pull request. No migration.

## Constraints and integration

- Reuse the shared `Gestures` recogniser and `NUTRITION_ICONS`.
- Owner answer 2026-10-16: Shift+F10 or the context-menu key opens the focused product’s information; Enter adds. The three Spanish labels are approved.
- A normal click anywhere on a product, including its mark, selects it once. A held mouse press opens information and never selects it. Double clicks remain two selections.
- Information opens for all products. Its Add action follows the existing product-selection path, including variants, extras and weighing.
- Read a dish's own values and keep extras separate, following `state/as-served.ts`; this slice changes presentation, not nutrition calculation.
- Unreviewed dishes have no order-line icons. Kitchen allergen text chips remain; their unreviewed warning goes.
- Lane F's parked A737 changes the ticket case in `TillApp.#drillBody` and inserts a refund dialog in `render`. Watcher waiver in Lane G questions, 2026-10-16 20:45, permits these different hunks. Whoever integrates second preserves both behaviours and assertions.
- Reuse approved EN/ES labels where their wording fits. Any new Spanish wording needs the owner before landing.
- A669-1 stays parked on A771. Do not add its allergy prompts or tables to this slice.

## 1. Product information and gestures

Files: `widgets/menu-browser.ts`, new `widgets/product-info.ts`, new `widgets/nutrition-icons.ts` and focused sibling tests under `apps/till/src`.

- [ ] Browser RED: marks for an allergen or diet; none for reviewed-empty or unreviewed; held click opens information with no basket change; short click on mark selects once; double click selects twice; keyboard selection remains available.
- [ ] Implement a product information dialog with staff name, icon plus allergen wording and kinds, diet labels, review state, Close and Add. Use the existing selection path after Add.
- [ ] Browser GREEN: all four review/mark states, variants with different nutrition, Add through modifiers and weighing, cancel/disconnect without a delayed selection, both themes and EN/ES at 390/1280 px. Run axe over the dialog.

## 2. Icons on unsent and sent order lines

Files: `widgets/basket.ts`, `screens/till-table-order-screen.ts`, their tests, and existing server line reads/types if their payload lacks nutrition.

- [ ] RED: dish/variant/extra fixtures use different allergens; icons follow the selected dish's name on counter, table draft, pending persisted and sent lines, including older bills. Unknown nutrition renders no icons, and extras never change the dish's own set.
- [ ] Render icon names with accessible localized labels, including cereal/nut kinds and direct No meat/No fish declarations. Retire the separate As served and diet rows on order lines. Preserve order-line gestures for A738.
- [ ] GREEN: focused suites, database-backed read checks for any added fields, following the kitchen queue’s live effective product read, and unchanged money/permissions behaviour.

## 3. Retire the old screen and kitchen warning

Files: `navigation.ts`, `till-app.ts`, `widgets/till-shell.ts`, `screens/till-counter-screen.ts`, `screens/till-allergen-screen*`, `widgets/station-queue.ts`, `screens/till-expo-screen.ts`, strings and their consumers.

- [ ] RED: old URL cannot open the retired destination; no shell/counter entry; pending kitchen items show no unreviewed warning while declared allergen chips remain.
- [ ] Delete screen, its screen-only tests, print path and exclusive strings. Change existing assertions only where the approved spec changes their behaviour, retaining equally strict new assertions.
- [ ] GREEN: shell/app/counter/kitchen suites plus types. Trace all consumers with `rg`; audit prose in developer products/design-system and operator products guides.

## 4. Finish and land

- [ ] Delete A668's finished backlog entry; preserve separate follow-ups and A669. Update the three guides and document changed test checks in the PR and campaign questions.
- [ ] Inspect real Chromium renders in EN/ES, light/dark, at measured 390/1280 px. Retain images and geometry receipts locally.
- [ ] Signed commits, finish-branch: necessary integration, one installed independent Claude run-it candidate, triage, focused checks, normal push hook, exact-head required CI.
- [ ] Land only green under the campaign main lock; install main, remove only this registered worktree and local/remote branch, verify exact-merge CI and checkpoint the queue.

## Review focus

Held click followed by a native click must not add a dish. Repeated taps must not disappear into double-tap recognition. Pointer cancellation and scrolling must not select. A variant must display its own nutrition. Persisted table rows read the same effective live dish nutrition as the kitchen queue; retrieved counter lines retain their existing snapshot path. Test each in its owning task above.
