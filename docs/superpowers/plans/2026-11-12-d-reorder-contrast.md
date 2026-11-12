# D: Reorder and contrast plan

Authority: watcher, 2026-11-12 07:00, `~/waitron-campaign-d/queue.md`:

> backlog bundles "Reorder controller" (2 entries, size S, `docs/backlog/dashboard.md#bundle-reorder-controller`) and "Contrast pass" (1 entry, size S, `#bundle-contrast-pass`). One branch, one PR, since they are small and in one area. Plan first (short), Claude read, then PLAN FOR APPROVAL. Fix in the shared primitive where the entry is about one, and check by screenshot.

Driver checks/commits this plan, obtains Claude approach review, then watcher clearance before building. This is not owner design approval.

**Finish line:** resolve these three observations with reproducible evidence and minimal established fixes, or watcher-cleared documentation of no reproduced defect. No controller rewrite, renderer, helper framework, canvas changes or unrelated cleanup.

**Establish what fails first.** Read `docs/backlog/dashboard.md:346,467,498,810` and the design-system lifted-surface, reorder and routing contracts. The 12-second Spanish/dark/390px miss later passed; cause remains unknown. Capture elapsed time, scrollTop/scrollHeight/clientHeight, pointer coordinates, drag state and visible scroll-box bounds throughout a held drag, including at any deadline. Distinguish reaching the limit from stalled progress; never increase a deadline as a repair.

Current Prep stations composes `packages/venue-service/src/dashboard/{prep-stations-screen,station-table,routing-grid}.ts`: Stations uses `wt-data-table` without grips; Routes uses cell buttons. Do not resurrect the historical `:6556` drag test. Reproduce shared reorder observations with the existing `packages/ui/src/reorder-table.test.ts` hosts and the live `packages/venue-service/src/dashboard/department-service-steps.ts` consumer. Capture dark-theme cell seams and bottom-row shadow; inspect painted cells, stacking and overflow before assigning either cause.

Measure current Stations hover targets and Routes painted/plain/inherited/warning/refusal states against their actual backgrounds: text ≥4.5:1, focus outline ≥3:1. Reuse `routing-grid.a11y.test.ts`'s existing hover measurements/contrast function, `@waitron/ui/src/{test-helpers,a11y-helpers}.ts` and registered pointer commands in `vitest-pointer-gestures.ts`. Reading these tests proves no current pass.

**Conditional repair and checks.** Before production edits, record the failing screenshot/measurement and add a regression that fails for that behaviour; rerun it after the smallest fix. Shared drag geometry/paint belongs in `packages/ui/src/reorder-table.ts`, scroll logic only if implicated in `drag-edge-scroll.ts`; assertions belong in their existing `.test.ts` files. Consumer-only failures stay in the named consumer and its `.test.ts`. Shared table paint belongs in `packages/ui/src/components/wt-data-table.ts` and its `.test.ts`; routing-specific paint/contrast belongs in `routing-grid.ts` and its existing `.test.ts`/`.a11y.test.ts`. Stations integration uses `station-table.a11y.test.ts`; full-screen wiring uses `prep-stations-screen.a11y.test.ts`. Preserve behavioural assertions and use declared tokens.

Focused commands (package-relative filenames):

```sh
pnpm --filter @waitron/ui test src/reorder-table.test.ts src/drag-edge-scroll.test.ts src/components/wt-data-table.test.ts
pnpm --filter @waitron/venue-service test --project browser src/dashboard/{department-service-steps,station-table,routing-grid}.test.ts src/dashboard/{station-table,routing-grid,prep-stations-screen}.a11y.test.ts
```

Inspect local screenshots EN/ES × light/dark × desktop/390px, including held/bottom-row drag and hovered targets; retain images locally. Report inconclusive causes as unknown. For obsolete/nonreproducing entries, send receipts and proposed docs-only disposition to watcher before deleting backlog. Update `docs/backlog/dashboard.md` and changed contract claims in `docs/developers/design-system.md` only after disposition.

Estimated changed lines: production 0–60; tests 0–120; support 0 (reuse); docs 10–35 plus this plan. Material growth returns to watcher.
