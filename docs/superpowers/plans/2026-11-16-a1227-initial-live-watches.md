# A1227 — Initial dashboard live watches

**Ask:** “Check screens that watch after an awaited read: decide whether they should watch those types from the start, avoiding a replacement of the initial live stream after loading.” Recorded in `docs/backlog/dashboard.md`, A1227.

**Status:** Sol-high author; driver checked; Claude approach review 267s (`receipts/a1227/plan-review.md`, external). Corrected plan cleared by the watcher in campaign questions.md, 2026-11-16 07:47. No owner design approval.

**Driver baseline:** Chromium, real `LiveData`/`LiveConnection`, fake EventSource transport: holding/releasing Approvals’ staff read produced **2 opens / 1 close**; expected-one assertion failed. External `receipts/a1227/baseline-chromium.log` and red patch retained.

## Inventory and scope

Source inventory; paths under `apps/dashboard/src/screens/`. Change each `.ts` and matching `.test.ts`:

| File | Register together immediately | Types missing before later registration |
| --- | --- | --- |
| `approvals-screen.ts:91` | Staff and both queues | `absences`, `shift_swaps`, `shifts` |
| `attendance-corrections-screen.ts:210` | Lookups and mode-selected queue/hours | Attendance record types; hours also adds `pay_period_settings` |
| `my-schedule-screen.ts:297` | Roster and shifts/swaps/absences | `shifts`, `roster_versions`, `employments`, `settings.business_day`, `settings.venue`, `shift_swaps`, `absences` |
| `modifiers-screen.ts:163` | Lists/languages and products | `products`, `categories` |
| `printers-screen.ts:1336` | Existing batch and discovery | `printer_discovery` |

Dependencies: `apps/dashboard/src/api/live-queries.ts`; Attendance’s record set: `packages/workforce/src/dashboard/live-queries.ts:1`. Arguments are independent; preserve display prerequisites below.

Source-read exclusions:

- Access roles: one watch. Backup panel, Content languages and Products: later types already covered.
- Staff adds `persons` through table-owned sorting (`staff-screen.ts:271,545`), independently of roles. Menus restores its URL watch synchronously (`menus-screen.ts:1280`; `packages/ui/src/url-state.ts:45`); included-menu types are covered.
- Sales seed release still replaces its stream (unmeasured; outside delayed registration). Cloud emergency people add `persons`/`person_roles`/`roles` after eligibility/permission (`cloud-services-screen.ts:189`); retain that prerequisite. My Hours’ types match; Appearance adds none. No other delayed initial types found; interaction-only watches retain selections.

## Build and prove after clearance

- [ ] Restore the preserved Approvals red test. In all six affected test files (including `attendance-corrections-screen.hours.test.ts`), hold staff/lookups/roster/one initial list, mount, start real `LiveConnection`, then release and await displayed results. Use the transport pattern at `dashboard-app.test.ts:6487`. Assert first URL includes later types, **one open, zero closes before cleanup**. Watch each new case fail before fixing.
- [ ] Register independent watches synchronously. Preserve display prerequisites: Approvals queues/actions wait for staff names; My Schedule lists/actions wait for its first roster answer; Attendance queue/details/day actions wait for lookups, including Hours arriving first. Test pending and failed prerequisites plus recovery; retain names, self-action restrictions, drafts and action-error assertions. Remove only obsolete sequencing assertions/flags and rewrite their comments.
- [ ] Printers: start discovery with its own immediate catch before awaiting the existing batch; choose the default view after that batch, independently of discovery success; only discovery failures mark discovery unread. Test discovery arriving first and refusing while lists succeed. Preserve passive refreshes and post-load URL/editor steps.
- [ ] Run focused suites with `pnpm --filter @waitron/dashboard exec vitest run src/screens/<file>.test.ts`. Deliberately restore each delayed registration in turn: its stream assertion must fail; restore fixes and rerun. Extract existing `streamsOver` into `src/widgets/test-helpers.ts`; reuse it in these tests and `dashboard-app.test.ts`. Retire only no-secondary-request assertions.

One PR; expected five production files, seven test files, one support file, three docs: **650 changed lines: production 160, tests 380, support 40, docs 70** (additions plus removals; outside-opinion stop 975). Docs: plan and two backlog deletions. Sales stays in the PR thread under campaign loose-ends rules. No framework, dependency declarations, ledger, server or layout work. Finish through normal review/hook/current-head CI; delete A1227 and its index bullet when landing.
