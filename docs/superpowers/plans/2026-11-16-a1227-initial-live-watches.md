# A1227 — Initial dashboard live watches

**Ask:** “Check screens that watch after an awaited read: decide whether they should watch those types from the start, avoiding a replacement of the initial live stream after loading.” Recorded in `docs/backlog/dashboard.md`, A1227.

**Status:** Plan only. Separate Sol-high author; driver checked it; Claude reviewed the approach (267 seconds, external `receipts/a1227/plan-review.md`). Corrected below; watcher clearance is pending. No owner design approval is claimed.

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

Dependencies: `apps/dashboard/src/api/live-queries.ts`; Attendance’s record set: `packages/workforce/src/dashboard/live-queries.ts:1`. The arguments are independent; display prerequisites below still apply.

Retain these inspected boundaries:

- Access roles has one watch. Backup’s stream-settings panel uses already-covered types. Content languages’ gaps/receipt watches cover later settings; Products’ routing/modifier watches cover later products.
- Source-read only: Staff adds `persons` through the table’s actual sort event (`staff-screen.ts:271,545`), independently of awaited roles; retain table-owned sorting. Menus restores its URL-selected watch synchronously (`menus-screen.ts:1280`; `packages/ui/src/url-state.ts:45`); loaded lists validate the address, not supply its id. Included-menu status types are already covered.
- Sales registers reports/categories/seed synchronously; its seed release still replaces the stream and remains outside this delayed-registration fix (unmeasured). Cloud emergency people add `persons`/`person_roles`/`roles` after registration eligibility and permission (`cloud-services-screen.ts:189`); retain that prerequisite. My Hours’ inbox/hours dependencies match. Appearance cards add no initial watches. Source inspection found no other delayed initial types; interaction-only detail watches retain their selections.

## Build and prove after clearance

- [ ] Restore the preserved Approvals red test. In all six affected test files (including `attendance-corrections-screen.hours.test.ts`), hold staff/lookups/roster/one initial list, mount, start real `LiveConnection`, then release and await displayed results. Fake only transport as in `dashboard-app.test.ts:6487`. Assert first URL includes later types, **one open, zero closes before cleanup**. Watch each new case fail before fixing.
- [ ] Register independent watches synchronously. Preserve display prerequisites: Approvals queues/actions wait for staff names; My Schedule lists/actions wait for its first roster answer; Attendance queue/details/day actions wait for lookups, including Hours arriving first. Test pending and failed prerequisites plus recovery; retain names, self-action restrictions, drafts and action-error assertions. Remove only obsolete sequencing assertions/flags and rewrite their comments.
- [ ] Printers: start discovery with its own immediate catch before awaiting the existing batch; choose the default view after that batch, independently of discovery success; only discovery failures mark discovery unread. Test discovery arriving first and refusing while lists succeed. Preserve passive refreshes and post-load URL/editor steps.
- [ ] Run focused suites with `pnpm --filter @waitron/dashboard exec vitest run src/screens/<file>.test.ts`. Deliberately restore each delayed registration in turn: its stream assertion must fail; restore fixes and rerun. Extract existing `streamsOver` into `src/widgets/test-helpers.ts`; reuse it in these tests and `dashboard-app.test.ts`. Keep existing recovery/name assertions; change only expectations that secondary reads have not started.

One PR; expected five production files, seven test files, one support file, three docs: **650 changed lines: production 160, tests 380, support 40, docs 70** (additions plus removals; outside-opinion stop 975). Docs comprise this plan and two backlog deletions. Record the excluded Sales behavior in the PR; no unrelated backlog item (campaign loose-ends rule). No framework, dependency declarations, subscription ledger, server or layout work. Finish through normal review/hook/current-head CI; delete A1227 and its index bullet when landing.
