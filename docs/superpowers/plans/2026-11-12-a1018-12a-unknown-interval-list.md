# A1018 Slice 12a: unknown-interval list

**Request/authority.** Lane J queue A1018: “Simple controlled and emergency handover, with Cloud only a placement”.
Watcher `questions.md`, 2026-11-12 10:10, set the boundary: derive from `handover_activations.evidence`, reuse A1342,
leave Task 10.6 there; archive/reset stay out. Claude reviewed the plan (309 seconds) and corrections (123 seconds).
The watcher cleared this corrected plan on 2026-11-12 at 11:06 with the two limits below. No owner approval of this plan is claimed. Source: [original Slice 12a](2026-11-02-a1018-handover-build.md#slice-12a--the-reconciliation-list-and-lines-beside-the-reports)
and [design §5](../specs/2026-10-23-a1018-simple-handover-design.md#5-point-3-fiscal-only-return-with-a-visible-business-gap), narrowed by the [later returned-fact/reset decisions](../../backlog/replication-cloud.md#returned-originals-and-their-recorded-facts-a1342-2026-11-10).

**Smallest usable finish.** With `report.view`, you can open Reports → Handover intervals and inspect committed emergency
takeovers without the old box: current source/destination box names, latest dated activity (or “Unknown”), declaration/activation times,
and the entered reason. Label the copy's latest activity, declaration on the new box and activation on the new box; render in the venue's zone. The possible window spans `lastCopy.lastChangeAtMs`
to `declaredAtMs`, not proven copy/final-sale limits. Preserve backwards clock dates; invent neither duration nor zero money. Returned sales alone never close it.

**Read basis, not runtime qualification.** `apps/server/src/handover-emergency-api.ts:58,344` defines/constructs/signs/stores
declaration binding, wording version, locale, three true statements, reason, lastCopy, provider:null, actor, declaredAtMs and
replaces; `handover-emergency-check.ts:10,29` defines copy/activity. `apps/server/src/handover-activation.ts:132` commits
venue evidence (`packages/db/src/schema/handover/activations.ts:14`); `packages/handover/src/activations.ts:20` reads by id.
Operations/events are node-local (`packages/node-db/src/schema/node-handover.ts:33,70`; readers `packages/node-db/src/handover.ts:86,128`).
A1342 inserts absent sales (`packages/fiscal-verifactu/src/handover-return.ts:292`); reporting reads sales/tenders
(`packages/reporting/src/vat-summary.ts:57`, `vat-return.ts:38`, `cash-up.ts:89`). Reuse unchanged; no shadow rows/totals/marker.

**Storage decision/exclusions.** No new table: committed evidence supplies this read-only list. Leave original 12a's persistent
acknowledgement, responsible-person assignment, resolution, correction references, completion matching, returned-invoice detail
rows and report annotations unavailable pending watcher review. No originals store/relay, batch protocol, audit ledger, duplicate
source records or archive/reset changes. Two cleared limits: nothing warns beside cash-up or affected reports, so staff open Reports, then Handover intervals; an interval stays unconfirmed in this cut even after a complete return. One later bounded slice, **12a follow-up: report warnings and return completion**, covers both report adjacency and closure, with its own plan and review. Task 10.6 stays with A1342, including “never overwrite receiver verdicts”. Do not alter
fiscal records, hashes, invoice allocation, series, filing, cash-up/close snapshots or meanings, promotion/activation, schemas or module seats.

**Build, with failing behavioral cases first, observed red then minimal implementation and green.**

- [x] **Server projection/API (0–60 min).** Create `apps/server/src/handover-intervals.ts` with
  `readHandoverIntervals(tx: Transaction)` returning typed display rows; select venue emergency activations newest first, tie-break operation id.
  Reuse `nodes.name` for box labels; follow `handover-emergency-api.ts:226–230` to read the stored body; export its existing `Declaration` type from that file.
  No evidence cross-check/fallback branch, node.db dependency, current-chart requirement or guessed recovered status.
  Modify `apps/server/src/report-api.ts`: GET `/management-api/reports/handover-intervals`, existing session +
  `report.view` gate, no-store, read only. Reuse its existing boot mount (`apps/server/src/boot.ts:3004`) after own-page
  and passive-read middleware (`:1348`); add no write or by-id endpoint.
  New `apps/server/src/report-api.handover-intervals.test.ts` owns real-DB projection and HTTP admission with
  `useVenueDb`: “committed emergency history shows both box names without local operations; controlled activations stay out”;
  “the row remains listed and its activity stays null after sales return”; “signed-out and missing report.view cannot read the list”.
  Adapt `report-api.reports.test.ts:496–507`'s activation pattern for emergency/real evidence; reuse its session pattern at `:213–227`.
- [x] **Dashboard (60–120 min).** Create `apps/dashboard/src/screens/handover-intervals-screen.ts`; use `wt-data-table`
  loading/empty/error states. State unconfirmed completeness and amounts once above the table; no constant columns or evidence dialog. Modify `apps/dashboard/src/api/client.ts` (typed list GET,
  explicit passive:true), `dashboard-app.ts` (core screen, Reports entry and direct-route permission), `i18n/strings.ts`
  (EN/ES) and `help-guide.ts` (`servers.reconciliation`). Navigation lives in `dashboard-app.ts:143,235`; generic routing
  already covers the address (`navigation.ts:7`). Reuse table/cell parts (`screens/servers-screen.ts:410,540`), tokens,
  and `guideHref`; no new primitive, polling or subscription. New screen `.test.ts` owns “empty, failed/retry and populated
  lists stay distinct”, “EN/ES rows show the reason and label each clock in the venue zone, including a step backwards”; new screen `.a11y.test.ts`
  owns keyboard retry and axe in both themes. New `apps/dashboard/src/dashboard-app.handover-intervals.test.ts`
  owns “report.view shows navigation/direct address; without it the list does not load”; existing
  `apps/dashboard/src/api/client.test.ts` owns “automatic interval GET carries x-waitron-live:1”. Restore locale per case.
- [ ] **Docs/finish (120–180 min).** Update `apps/server/src/guide/en/servers.md` and `apps/server/src/guide/es/servers.md`
  with shared `{#reconciliation}`; state both cleared limits above plainly, say what you can inspect, and: if the old box returns, check the return status on its page before deciding whether to reset it. Update only A1018's
  scope in `docs/backlog.md`, `docs/backlog/replication-cloud.md` and this plan. Support: existing
  `apps/dashboard/src/widgets/test-helpers.ts` and suite-local server seeds; no new support file. Focused commands:
  `pnpm --filter @waitron/server exec vitest run src/report-api.handover-intervals.test.ts`;
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/handover-intervals-screen.test.ts src/screens/handover-intervals-screen.a11y.test.ts src/dashboard-app.handover-intervals.test.ts`;
  `pnpm --filter @waitron/dashboard exec vitest run src/api/client.test.ts -t 'automatic interval GET'`.
  Inspect EN/ES, phone/desktop, both themes; existing guide/link guards, normal hook and current-head scoped CI follow.
  No prose/fixture/count tests or whole local suites. Reserve this last hour for finish-branch review, fixes, hook and PR;
  CI may finish later. At three active hours without the usable PR, stop/report to watcher; no scaffold-only finish.

**Estimate, added/removed lines.** Production +245/−5; tests +300/−0; support +20/−0 (suite-local); docs +35/−5; generated 0/0;
total 610 changed lines. Stop for watcher/outside opinion before 1.5× (915) or persistent state/report growth. The watcher cleared these exclusions at 11:06 on 2026-11-12.

**2026-11-12 follow-up split:** the watcher cleared [warnings as PR 1](2026-11-12-a1018-12a-warnings-return-completion.md) at 13:49; durable receiver completion now gets its own later short plan.
