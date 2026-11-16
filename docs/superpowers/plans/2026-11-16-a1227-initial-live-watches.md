# A1227 — Initial dashboard live watches

**Ask:** “Check screens that watch after an awaited read: decide whether they should watch those types from the start, avoiding a replacement of the initial live stream after loading.” Recorded in `docs/backlog/dashboard.md`, A1227.

**Status:** Plan only. The driver arranges Claude review and watcher clearance before implementation; neither has happened here.

**Baseline supplied by driver:** Chromium, real `LiveData`/`LiveConnection`, fake EventSource transport: holding Approvals’ staff read then releasing it produced **2 opens / 1 close**; expected-one assertion failed. External receipt: `receipts/a1227/baseline-chromium.log`; red patch retained externally.

## Inventory and scope

Source inspection found these independent watches starting after reads. Paths are under `apps/dashboard/src/screens/`; each row changes the named `.ts` and matching `.test.ts`.

| File | Register together immediately | Types missing before later registration |
| --- | --- | --- |
| `approvals-screen.ts:91` | Staff and both queues | `absences`, `shift_swaps`, `shifts` |
| `attendance-corrections-screen.ts:210` | Lookups and mode-selected queue/hours | Attendance record types; hours also adds `pay_period_settings` |
| `my-schedule-screen.ts:297` | Roster and shifts/swaps/absences | `shifts`, `roster_versions`, `employments`, `settings.business_day`, `settings.venue`, `shift_swaps`, `absences` |
| `modifiers-screen.ts:163` | Lists/languages and products | `products`, `categories` |
| `printers-screen.ts:1336` | Existing batch and discovery | `printer_discovery` |

Dependencies: `apps/dashboard/src/api/live-queries.ts`; Attendance’s record set: `packages/workforce/src/dashboard/live-queries.ts:1`. None of these query arguments needs an earlier answer.

Retain these inspected boundaries:

- Access roles has one watch. Backup’s stream-settings panel uses already-covered types. Content languages’ gaps/receipt watches cover later settings; Products’ routing/modifier watches cover later products.
- Staff adds `persons` through the table’s actual sort event (`staff-screen.ts:271,545`), independently of awaited roles; retain table-owned sorting. Menus restores its URL-selected watch synchronously (`menus-screen.ts:1280`; `packages/ui/src/url-state.ts:45`); loaded lists validate the address, not supply its id. Included-menu status types are already covered.
- Sales registers reports/categories/seed synchronously; seed release and range replacement are different behavior. Cloud emergency people add `persons`/`person_roles`/`roles` after registration eligibility and permission (`cloud-services-screen.ts:189`); retain that prerequisite. My Hours’ inbox/hours dependencies match. Appearance cards add no initial watches. Remaining core screens add no delayed initial types; interaction-only detail watches retain their selections.

## Build and prove after clearance

- [ ] Restore the preserved Approvals red test. In all six affected test files (including `attendance-corrections-screen.hours.test.ts`), hold staff/lookups/roster/one initial list, mount, start real `LiveConnection`, then release and await displayed results. Fake only transport as in `dashboard-app.test.ts:6487`. Assert first URL includes later types, **one open, zero closes before cleanup**. Watch each new case fail before fixing.
- [ ] Register independent watches synchronously using existing `Promise.all` and controller error callbacks. Keep post-load URL/editor/default-view work after required answers. Remove obsolete sequencing flags/comments; retain per-read failures/recovery, action messages, drafts, disconnect protection and passive refreshes. Cover both answer orders, including Hours’ person selection and printer discovery arriving first. Preserve behavioral assertions when replacing old sequencing expectations.
- [ ] Run focused suites with `pnpm --filter @waitron/dashboard exec vitest run src/screens/<file>.test.ts`. Deliberately restore each delayed registration in turn: its stream assertion must fail; restore fixes and rerun. Reuse a small transport helper in existing `src/widgets/test-helpers.ts` only if useful.

One PR; expected five production files, six test files, zero/one support file, three/four docs: **600 changed lines: production 120, tests 360, support 40, docs 80** (additions plus removals; outside-opinion stop 900). Docs comprise this plan, two backlog deletions and any changed developer guidance. No framework, dependency declarations, subscription ledger, server or layout work. Finish through normal review/hook/current-head CI; delete A1227 and its index bullet when landing.
