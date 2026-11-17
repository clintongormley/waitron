# Routing handover at 390 px

**Finish:** Spanish routing headings fit at 390 px in both themes without weakening geometry assertions.

**Source:** LaneD questions.md, watcher2026-11-17 04:52 PRIORITY:
> "Lane E's pp5 CI (run 44010882278, venue-service shard 2) shows 'Routing handover renders in Spanish, light and dark, at 390 px' failing on main since #3612 (d4cc4ee022); your PR's scoped CI did not test venue-service. Before D-PAINT-CHANGEOVER-EDGE: reproduce it on main, fix the cause in a small PR from main without weakening any geometry assertion, run venue-service's tests for that file, land it, and tell lane E in its questions.md. Note in docs/developers ci-and-gates' list if the cause is a shared primitive change that scoped CI misses for dependents."

**Files/test owners:**
- UI: `packages/ui/src/components/wt-data-table.ts`; `packages/ui/src/components/wt-data-table.head-and-cells.test.ts`.
- Venue-service: unchanged `packages/venue-service/src/dashboard/prep-stations-screen.test.ts`.
- Dashboard: unchanged `apps/dashboard/src/widgets/menu-structure-table.test.ts`.
- Docs: `docs/developers/ci-and-gates.md`; `docs/developers/design-system.md` only if clarification needed.

**Steps:**
1. Claude approach review; watcher clearance before build.
2. Using supplied main 77bc77e31b reproduction, add one primitive regression: part-local heading 4px/body 12px; inherited/explicit 8px. Observe failure first.
3. Remove host default; resolve `var(--wt-table-cell-padding-inline,var(--wt-space-3))` at th/td and narrow tree-arrow calculation.
4. Run primitive spacing/tree tests, entire unchanged 334-case venue-service file, and Structure narrow cases: 4px, contained 44px tree; toolbar unchanged.
5. Record measured dependency gap; finish reviews (two for cross-package contract), CI, authorised landing, Lane E notification.

**Exclusions:** Screen styling, APIs, tokens, frameworks, CI selection, migrations, guides.

**Size:** Production 3–6/test 15–25/docs 8–15 lines; total under 100.
