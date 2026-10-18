# A495: change the business-day start without regrouping history

> 2026-10-18, A788: dated scheduling, Replace, Cancel and `hours.clock_change_pending` are replaced: a new start takes effect at the next changeover — see `docs/superpowers/specs/2026-10-18-a788-business-day-next-changeover-design.md`.

You can schedule a new business-day start for a future date. Reports use the start belonging to each date, rather than applying today's setting to every sale. The preceding day becomes shorter or longer once; existing historical windows and recorded closes stay unchanged.

**Planning authority:** the owner authorized unattended design defaults on 2026-10-11. The choices below are the planner's defaults, not separately approved owner decisions. Implementation stays inline with the driver. This is fiscal-adjacent; the owner must approve landing. This document does not authorize a merge.

**Inspected base:** `61420546c556de629432fb42ff41bdea4308bc55`. All source observations below are **source-only, unverified at runtime**, except the explicitly reported existing test runs. Recheck consumers after rebasing. No product code, test, campaign state, settings or fiscal files were changed during planning.

## Required text, verbatim

From `docs/backlog.md:1299`:

```text
- **A495. Change the business-day start from a future date (owner, 2026-10-11).** Refused today once
  a venue has sales, because reports would regroup old days. Store the start with the date it takes
  effect. Fiscal-adjacent: the owner lands it.
  [Detail](backlog/service-periods.md#a495-change-the-business-day-start-from-a-future-date)
```

From `docs/backlog/service-periods.md:198`:

```text
## A495. Change the business-day start from a future date

**A495 (owner, 2026-10-11) — OPEN.** Fiscal-adjacent: the owner lands it.

Today the time zone and the business-day start cannot be changed once the venue has a sale, an
order or a daily close (`apps/server/src/venue-details.ts`, A261 step 7, #1281). The reason is in
[the venue details plan](../superpowers/plans/2026-10-05-venue-details.md), items C4 and C5:
- reports work out each day's window from the CURRENT time zone and start, so a change would
  regroup old sales;
- a daily close is append-only and hash-chained, and it stores its business day but not the start
  used to work it out, so recomputed reports would disagree with recorded closes.

The owner wants the start to be changeable. Store it with the date it takes effect, so earlier days
keep the start they had, and have reports, closes and anything else keyed by business day read the
start in force on each day. The same plan lists those other readers: station overrides (C6), and
backups and email (C8). Whether the time zone takes the same route is part of the design. Related
open entry: "Changing the business-day start after saving service hours" (A366-1 follow-up).
```

From `docs/backlog/service-periods.md:67`:

```text
## Changing the business-day start after saving service hours

The second A366-1 review directly changed the stored setting from 05:00 to 03:00. A saved
22:00–04:30 range and an all-day 05:00–05:00 range then reported closed; re-saving the latter
returned `menu_timetable.invalid` (`empty`). The settings route was not run. Reproduce through
that route before deciding whether to remap, refuse the change, or require re-authoring the hours.
Receipt: campaign lane D `receipts/a366-1/finish-second-report.md`, finding 2 (2026-10-08).
```

## Decisions and limits

- Retain the time zone's existing sales/order/close history lock. Also lock it once any cutover change exists. A495 does not version time zones, change the fiscal clock, invoice allocation, recorded issue offsets, workforce dates or civil-date VAT returns.
- Keep `locations.day_cutover` as the initial start, not a cache of the latest start. Add dated changes; every operational reader resolves a date or instant through the complete timeline. Never copy an activated value back onto `locations`.
- After setup, every changed start uses the dated route, even before sales. General venue-details PATCH accepts an equivalent cutover but refuses a changed one with `venue.business_day_invalid`, field `dayCutover`, reason `effective_date_required`. This removes the current pre-history path that can invalidate authored hours immediately.
- Allow one pending change per location, with arbitrarily many retained effective changes. Pending means its new boundary has not arrived, including its final locked day. No activation job or startup write is needed.
- A new effective business date `E` must be between today's business date plus **2 calendar days** and plus **366 calendar days**, inclusive. Choosing tomorrow could change today's ending boundary. Default the form to the earliest permitted date.
- A pending change can be replaced or cancelled only before **the start of `E−1`**. After that, changing it would change a day already in progress. A replacement must satisfy both the old change's lock time and its own lock time; it replaces, never adds, a second pending row.
- Refuse incompatible schedules with actionable references. Never silently remap wall times, delete hours or turn an all-day range into a shorter range. Time-related schedule editing is paused while a change is pending; edit hours first, or cancel the pending change while cancellation is permitted.
- No old-installation conversion or compatibility reader. An empty change table uses the initial location setting. Do not edit shipped migration files. Keep all already-recorded history on a database using this feature; a pre-live reset is an installation/development option, not an action performed by the editor.

Alternatives rejected: an immediate scalar edit regroups history; replacing the scalar when a timer fires loses restart safety and date-aware forecasts; multiple pending changes require more editing and schedule-combination rules than A495 needs. Versioning all authored schedules would be a separate project.

## One date, one boundary

Let `C(d)` be the last dated cutover whose `effectiveBusinessDay <= d`, otherwise the initial location cutover. `B(d)` is the UTC instant of calendar date `d` at `C(d)` in the explicitly stored IANA time zone. A business day is **`[B(d), B(d+1))`**. A multi-day report is **`[B(from), B(to+1))`**; resolve each end independently. Passing only `C(from)` to both ends is incorrect across a change.

Preserve the existing reporting boundary conversion, including its two-pass time-zone conversion, rather than reinterpreting historical DST windows. Expose that existing conversion as the single date-boundary primitive. For Madrid's 02:30 start, existing tests pin the spring boundary to `2026-03-29T01:30:00.000Z` (03:30 after the skipped hour), and the autumn boundary to the second 02:30, `2026-10-25T01:30:00.000Z` (`business-day.test.ts:215`). These are existing test receipts for those cases, not evidence for every IANA zone. Keep the conversion algorithm unchanged for other zones and add measured fixtures before describing their behavior.

Find an instant's day by chronological boundary comparisons, not `wall time < current cutover`. Starting from its venue civil date, compare neighboring `B(d)` values until `B(d) <= instant < B(d+1)`; use a bounded search and refuse unreadable/non-increasing boundaries. This does not change old report windows. It deliberately makes live day selectors agree with those windows during a repeated/skipped hour; do not relabel stored overrides or other history. At a repeated 02:30 start, the first 02:45 remains yesterday, the second 02:29 remains yesterday, and the second 02:30 begins today. Day identity never runs backwards during the repeated hour. A same-cutover request is an equivalent no-op, with no revision or change-feed event.

For a cutover change, require unique, existent local occurrences for both old and proposed cutovers on `E−1`, `E` and `E+1`, with increasing boundary instants. Refuse a transition near a skipped/repeated boundary; choose a nearby date. This bounds A495's transition problem without prohibiting a start such as 02:30 forever. Ordinary later DST dates continue to use the unchanged reporting conversion. Never use `getTimezoneOffset()`, browser zone defaults, a fixed 24-hour instant addition or machine-local midnight to activate a change.

Example in Madrid away from DST, effective `2026-11-04`:

| Change | Nov 2 | Transitional Nov 3 | Nov 4 |
| --- | --- | --- | --- |
| 05:00 → 03:00 | Nov 2 05:00 to Nov 3 05:00 | Nov 3 05:00 to Nov 4 03:00, **22 hours** | Nov 4 03:00 to Nov 5 03:00 |
| 05:00 → 07:00 | Nov 2 05:00 to Nov 3 05:00 | Nov 3 05:00 to Nov 4 07:00, **26 hours** | Nov 4 07:00 to Nov 5 07:00 |

Each ending instant is the next day's starting instant. At exactly Nov 4 03:00 or 07:00, respectively, the new date begins. Use UTC ISO strings for SQL bounds and exact Decimal amounts for totals. DST can make an ordinary day 23 or 25 elapsed hours; do not calculate day length from 24 hours. The examples describe the proposed algorithm, not executed A495 code.

## Preserve everything that already happened

At acceptance and every queued write, read the timeline and the current instant **inside the acquired transaction**. Recheck the minimum date and lock time there; a preview grants no write authority. Use a persisted monotonically increasing `clockRevision` so stale editors, including schedule–cancel–schedule sequences, cannot overwrite another editor's decision. Check it before equivalence handling. A stale request gets HTTP 409 and keeps its draft.

Before scheduling/replacing, refuse if a saved close has `business_day >= E−1`, even an empty or future-dated close. Also refuse if any existing timestamp used by an affected history window is at or after `min(B_old(E), B_candidate(E))`: sales issuance, voids, tender settlement, bill-payment receipt, completed bill-payment refunds, working-order opening, or kitchen-notice creation. This conservative check catches future timestamps after a clock error. Normal past history is allowed. A current day's ending boundary and its overrides must compare identical before/after the write. Check the same history protection for cancellation against the pending and restored timelines.

New timestamps arriving after scheduling use the committed timeline. API writers must not accept retrospective cutover changes. At or after `B(E−1)` the writer refuses replacing/deleting the retained change. Restart evaluates the same stored rule at the same supplied instant; it does not lose pending state. History protection still applies if the system's UTC clock is corrected backwards. This design assumes a usable UTC instant: it cannot establish that an empty day passed during an unobserved clock reversal without another persisted clock watermark, which is outside A495. DST repetition is not a UTC clock reversal and is handled by boundary comparison. Direct administrator SQL edits are outside this editor's enforcement.

`recordDailyClose` obtains its location timeline through the input node within the existing transaction, then computes its date's two bounds. Remove the caller-supplied current cutover from its input; retain the explicit stored-zone consistency check. Do not add anything to `DailyClose`, `DailyCloseSnapshot`, the stored row or the hash payload. Keep `daily-close-hash.ts`, chain verification and their golden assertions byte-for-byte unchanged. Freeze before/after entire existing close rows and chain heads in integration tests, and compare historical derived report totals separately. There is no production scheduled close writer at the inspected base: `rg -n 'recordDailyClose\('` outside tests/docs finds only its definition and `apps/server/scripts/daily-close-z-demo.ts:193`. Do not invent an automatic close duty.

## Hours without hidden reinterpretation

Service ranges belong to a business date, although named-day facts remain civil calendar dates. Resolve each actual date's clock separately, including yesterday's sending grace, a repeated named day's occurrences, zone closed times and station forecasts. A normal-week editor uses the current date's start as its reference and validates against **every retained distinct cutover plus the pending one**. This finite conservative rule keeps its unversioned wall-time rows readable on historical grids. A one-off dated row uses its own date's start and next boundary. An annual row must validate under all retained/pending cutovers. Editing the normal week still edits the normal week for past views, as today; A495 preserves grouping, not snapshots of authored schedules.

Compatibility requires the complete raw schedule set, including disabled departments/zones and dormant named-day rows. For each recurring or future-applicable range, parse under old and proposed cutovers; require nonempty ordered nonoverlapping ranges, identical calendar-day ownership of each endpoint, and identical ownership of the period's signed wall-minute ordering/sending cutoff. Validate neighbor placements and named-day overrides as well as offsets, including zero offsets. Require these ranges/cutoffs to avoid the wall-time strip between the two cutovers on the transition morning. A whole-day equal-endpoint range always conflicts with a changed start. Zone closed ranges obey the same geometric checks. Past one-off dated rows that will not recur are read with their historical clock and are not a scheduling blocker.

Consequences: 05:00–05:00 refuses both changes until re-authored; 22:00–04:30 refuses 05:00 → 03:00 because it crosses the new boundary; 09:00–17:00 accepts either example. 22:00–04:30 can accept 05:00 → 07:00 if its sending offset remains outside the changed strip and does not clash with its next placement. Return a bounded list (first 20, plus total count) of conflicts identifying department/zone, weekday or named-day id/date, range/period and reason. Show links to Opening hours. Current `assertPeriodEndOffsets` alone is insufficient: it does not parse all ranges, and its optional fast exit skips zero-offset cases (`menu-timetable.ts:221`). Reproduce the quoted follow-up through the real venue-details route before extending the validator; do not report it as reproduced by this planner.

While pending, refuse time-affecting writes to weeks, dated ranges, calendar date/repeat/own-hours/closure choices and period offsets, including clone/copy/import paths. Unchanged writes and pure names/colours/menu membership changes remain allowed. Time-affecting client writes also carry `expectedClockRevision` from their loaded model; re-read revision/pending status under the lock, and refuse stale drafts even if pending has since activated or been cancelled. Internal provisioning/import writers use the revision read inside their own transaction. Today's keep-open actions resolve their day/time under the acquired transaction and remain available but cannot extend into the moved strip or beyond the actual following boundary on `E−1`; cancellation of today's extension remains allowed. Station Close for today lasts through its resolved business day, including the 26-hour case; it does not reopen at the old scalar time.

Keep ordinary wall-time schedule and offset semantics; DST does not turn offsets into elapsed UTC durations. On the 26-hour transition, the added tail is closed for department service and sending. On the 22-hour transition, the removed tail belongs to the following day. Calculate a service minute from the civil-date distance to the business date and its start, **without modulo 1440**; the added tail reaches minutes 1440–1559 and must not replay the first two hours. Clamp service and extension resolution to `[B(d), B(d+1))`. Yesterday's grace uses yesterday's start and cutoff, not today's start plus an assumed 1440 minutes.

A range starting at that date's cutover starts at `B(d)`; a range ending at that cutover ends at `B(d+1)`, including an existing equal-endpoint all-day range. Compare those boundary endpoints as instants rather than rejecting them just because a repeated/skipped hour puts the wall-minute coordinate beyond 1440. Thus an initial 02:30 all-day schedule still covers the first autumn 02:45 on yesterday's date, until the second 02:30 boundary, and the spring morning until the existing 03:30 boundary. Other repeated wall minutes keep the existing wall-time schedule matching within their chronologically selected day. This boundary-end rule also applies to running/ended and sending/keep-open checks, not only the department's open flag. The compatibility refusal means no authored range ends at the former cutover in an accepted longer transition, so this rule cannot open its deliberately closed extra tail.

Real-week columns crossing a change each receive their own `dayCutover`, start/end ISO bounds and a transition note. Read-only station forecasts use that same per-date context. Extend the grid with a per-column end offset: shorter columns stop at their actual end and longer columns show the closed tail beyond 1440; do not draw a misleading full ordinary day. Normal-week grids remain the existing 1440-wall-minute reference. Browser Today markers use the shared chronological resolver and explicit zone, not `businessDateToday`'s current single-cutover comparison. No browser import of the database-backed reporting package.

## Storage and contracts

The clock belongs to the core location identity and is consumed by reporting even without venue-service. Add **core** tables in `packages/db/src/schema/business-day-clock.ts`, with this reason in the signed-off implementation commit:

- `location_business_day_settings`: `location_id` primary key/FK to `locations.id`, `revision` nonnegative whole count. Absence reads as revision 0; a write creates/increments it within the same transaction. It survives cancellation.
- `location_day_cutover_changes`: composite primary key `(location_id, effective_business_day)`, FK to `locations.id`, canonical real `YYYY-MM-DD` date and `HH:MM:00` cutover. No redundant activation flag or cached current value.

Both are `state`, with no `appendOnly()` declaration: the future row can legitimately be replaced/deleted. Applied-history protection is the domain writer's rule. Declare keys and shape CHECKs in the TypeScript schema; the writer additionally validates real dates and ordering. Use the column vocabulary, export through both db barrels, generate a new additive core migration, and let the core descriptor/manifest retain the tables in its existing set. No new migration-set dependency, fiscal table or append-only manifest entry. Run classification, graph, constraints, manifest and real offending writes; inspecting generated SQL alone is insufficient. Full database backups/restore retain both tables; configuration cloning does not.

Exact shared browser-safe types/functions (new `packages/shared/src/business-day-clock.ts`, exported from shared; DB reader stays in reporting):

```ts
type CutoverChange = Readonly<{ effectiveBusinessDay: string; dayCutover: string }>;
type BusinessDayClock = Readonly<{
  timeZone: string; dayCutover: string; cutoverChanges: readonly CutoverChange[];
}>;
type BusinessDayBounds = Readonly<{ startAt: string; endAt: string }>;
cutoverForBusinessDay(clock: BusinessDayClock, day: string): string;
businessDayBoundaryAt(clock: BusinessDayClock, day: string): string;
businessDayBounds(clock: BusinessDayClock, day: string): BusinessDayBounds;
businessDayAt(clock: BusinessDayClock, at: Date): string;
```

Extend `readLocationClock(tx, locationId)` to return a required `BusinessDayClock`. Its `dayCutover` is always the baseline, so runtime service code must use a separate `serviceDayContext(clock, day)` with `{dayCutover, startAt, endAt, endMinute}` for the chosen date; never overwrite the baseline property to represent today. Yesterday gets a separate context. Change internal reporting day/range inputs to carry required `cutoverChanges`; propagate them explicitly through all report, order and adjustment callers. This is an internal contract update, not an optional field whose absence can silently lose history. `currentBusinessDay`, `venueMomentAt`, `businessDayStart` delegate to the new resolver. Stored/wire report output shapes stay unchanged.

Add `VENUE_SERVICE.assertBusinessDayClockChange(tx, cfg, before, candidate, effectiveBusinessDay): Promise<void>` for schedule compatibility and `assertBusinessDayScheduleWrite(tx, cfg, changeKind, at, expectedClockRevision): Promise<void>` for the pending guard. Implement in new `packages/venue-service/src/business-day-schedule.ts` and expose through the module's existing venue-service seat; core/shared do not depend on venue-service. `before` and `candidate` are `BusinessDayClock`; `expectedClockRevision` is a nonnegative integer; `changeKind` is `"time" | "metadata"`, decided from actual old/new values, not a client claim. Metadata/equivalent writes skip the temporal guards. Use `BusinessDayClockConflict = {departmentId:string; zoneId?:string; weekday?:number; specialDateId?:string; date?:string; periodId?:string; rangeIndex:number; reason:"range"|"endpoint_day"|"all_day"|"sending_cutoff"|"transition_strip"}` in preview/error payloads. Optional owner fields reflect the conflicting row; order by department, zone, date/weekday, range. The guard throws `hours.clock_change_pending` (409, `{effectiveBusinessDay:string}`) or `hours.clock_changed` (409, `{}`). Register those codes and `venue.business_day_hours_conflict` in venue-service's error registry and map them in its route boundary/EN/ES copy; the other new venue codes belong to the server registry. No duplicate code registration.

In `VenueDetailsModel`, add `businessDayClock: { clock: BusinessDayClock; revision: number; currentBusinessDay: string|null; pending: null | { effectiveBusinessDay: string; dayCutover: string; startsAt: string; locksAt: string; editable: boolean } }`. `details.dayCutover` displays the resolved current start, or the raw initial value when the clock is unreadable. Its policy permits scheduling after history; remove the start from the general edit form. Scalar PATCH always refuses a changed start. Unreadable clocks retain the existing visible recovery state and refuse scheduling; this feature does not create a clock-repair path. Time-zone changes before history remain permitted only with no cutover changes and the existing validation; `venue.detail_locked` and its policy gain reason `business_day_history` when the timeline itself prevents a zone edit.

Use dedicated authenticated routes under `/management-api/venue-details/business-day-start`: GET `/preview?effectiveBusinessDay=…&dayCutover=…&expectedClockRevision=…`; PUT `{ effectiveBusinessDay, dayCutover, expectedClockRevision }` to create/replace; DELETE `{ expectedClockRevision }` to cancel. Reads require `venue.view`, writes `venue.configure`. Route time is sampled inside the gated transaction via `deps.now`. Preview returns `{ revision, previousDay, effectiveDay, locksAt, conflicts, conflictCount, backupDeadlines }`, where each day is `{businessDay:string; dayCutover:string; startAt:string; endAt:string}` and deadlines use the existing `{archive:string|null; cloud:string|null}` shape. A preview never mutates. An already-cancelled DELETE with the current revision is a no-op; an outdated revision still refuses.

Register `venue.business_day_invalid` (400, `{field, reason}`), `venue.business_day_changed` (409), `venue.business_day_locked` (409, `{reason}`), and `venue.business_day_hours_conflict` (409, `{conflicts, conflictCount}`), plus localized EN/ES copy. Fields are `effectiveBusinessDay`, `dayCutover`, `expectedClockRevision`; reject null, arrays, unknown keys, malformed dates/times and noninteger revisions. Whole-hour times are not required. No-op at the active cutover is allowed only without a pending row; with a pending row use explicit cancellation.

## Screens, queries, schedulers and transfer

Add a small Business-day start editor under Venue details, with current start, pending start/date, lock deadline and Change/Replace/Cancel actions. Keep A494's general layout/legal-name work out of A495. Require date and time, show the transition's prior-day length and two boundaries, explain that earlier reports stay grouped, and require acknowledgement of the transition before save. Use existing field/dialog primitives, semantic names, `draftScopeFor`, quiet unchanged save, inline field errors and one bottom error line. Keep refused requests retryable; live refresh preserves drafts and action errors. Successful writes close the editor before a separate refresh. Add an unsaved-dialog test.

Add both new change-source names to all affected dashboard/venue-service dependencies. A time boundary changes no row: existing passive timer refreshes must update current/pending state, routing, hours and Today markers. Do not create a timer that writes an activation flag. Preview generation keys include date and revision; an older response cannot enable Save after a newer choice or another editor's write.

Automatic backup scheduling resolves **each future candidate date**, not today's active scalar: fire after `B(d)` plus the existing elapsed 30-minute margin and stable 0–10-minute jitter. Weekday restrictions use `d`'s venue civil weekday. Explicit wall times and interval schedules retain their existing semantics. A deadline already advertised by archive or cloud scheduling is retained through replace/cancel/activation/restart according to its existing lifetime; the next calculation uses the latest timeline. A candidate derived before a newly scheduled change can consequently fire once at the former time; preview displays that retained deadline. Cloud's persisted `nextAt` retains its current restart behavior. Ordinary archive restart continues its existing immediate-copy behavior. Account email formatting reads only the locked time zone; invoice email retry/claim timing and payment/fiscal duties are elapsed-time duties, not business-day schedules. Boot's clock-reading closures must return the full timeline freshly.

Configuration exports flatten to the **active start at the export instant**, omit both history/revision tables, and refuse export while any pending change exists. This conservative refusal avoids cloning a timeline into a fresh venue or exporting schedules waiting for a different start. Existing pre-live bundle versions receive no compatibility layer. Imports create a fresh location using that scalar and leave the new tables empty/revision 0. Configuration validation and provisioning compare the resolved current setting where they describe a current venue; setup into an existing trading location stays refused. Full venue reset deletes timeline/settings with the venue; mere configuration replacement must never clear a trading timeline. Cold restore continues its retained timeline without scheduling an activation write.

## Source trace checklist

All entries in this table are source-only observations. Listed tests establish only their explicitly reported assertions.

| Consumer and evidence | A495 obligation |
| --- | --- |
| Initial column `packages/db/src/schema/tenants.ts:83`; provisioning normalization `venue-plan.ts:125`, equality/insert `venue-apply.ts:141`, `:182`; CLI `cli.ts:205`; server setup `setup-api.ts:390`, `:426`; setup screens/client `apps/setup/src/screens/venue-screen.ts`, `review-screen.ts`, `setup-app.ts`, `api/client.ts` | Initial baseline and setup only; no setup history rewrite. Seed/fixture scripts remain initial-clock callers, update required input types. |
| `apps/server/src/venue-details.ts:73`, `:157`, `:220`, `:242`; `location-settings-api.ts:88`, `:98`, `:114`; preview `venue-clock-preview.ts:10`, `:45`; model `venue-detail-types.ts:1`; dashboard `venue-details-form.ts:4`, panel `:249`, `:385`, API client | Separate baseline PATCH from dated writes; recheck under queue; date/revision preview and localized UI. Preserve unrelated policies. |
| Reporting `business-day.ts:131`, `:158`, `:170`, `:220`, `:264`, `:272`; server `report-api.ts:140`, `:201`, `:275`, `:309`, `:350` | Full timeline, independent start/following-date end; overview defaults agree with intervals. |
| `vat-summary.ts:108`, `:124`; `counts.ts:15`, `:29`; `cash-up.ts:36`, `:57`, `:64`, `:72`; `top-sellers.ts:27`; `category-sales.ts:193` (all reporting) | Preserve issue/void/reversal/settlement/bill-payment/refund scopes and exact totals. No money algorithm change. |
| Reporting `daily-close.ts:17`, `record-daily-close.ts:31`, `:39`, `:52`; schema `daily-closes.ts`; hash `daily-close-hash.ts:90`; verifier `verify-daily-close-chain.ts:51`; demo `daily-close-z-demo.ts:193` | Resolve historical clock within close transaction; snapshot/hash/old rows unchanged. No production close scheduler found by whole-tree caller search. |
| `apps/server/src/orders-api.ts:122`, `:141`, `:214`; `orders-list.ts:137`, `:280`, `:295`; adjustments `routes.ts:175`, `reports.ts:148` | Today/default and explicit ranges carry timeline, including working-order-opening anchor for adjustments. |
| `apps/server/src/floor-today-store.ts:77`, `:105`, `:434`, `:460` | Today's plan and sweep use chronological business day; no premature reset at former start. |
| Venue-service `station-times.ts:10`, `:44`; `routing-store.ts:385`, `:433`, `:647`, `:1059`; `routing-periods.ts:114`, `:137`; `kitchen-notices.ts:198` | Resolve today's overrides, notice lower bound, expiry labels and period ordering; preserve ticket assignments/history. |
| Venue-service `hours-clock.ts:17`; `service-day.ts:22`, `:30`, `:111`, `:140`; `hours-occurrences.ts:38`; `menu-timetable.ts:134`, `:222`, `:294`, `:441`, `:712`, `:752`, `:825`, `:974` | Date-specific validation, calendar-day ownership, chronological minutes, yesterday grace and dated/normal-week selection. |
| Venue-service `zone-closed-times.ts:21`, `:69`, `:170`, `:218`; `keep-open.ts:30`, `:54`, `:108`, `:208`, `:246`; `operations.ts:1470`; `period-end-offset.ts:38`, `:88`; `hours.ts` named-day switch/copy/move writers | Same pending guard, actual following boundary, time-related calendar writes and offsets. No new grace-retention policy. |
| Venue-service `named-days.ts:88`; `holiday-types.ts:69`; `menu-timetable-types.ts:53`; `station-service-times.ts:82`, `:132`, `:151` | Per-date contexts for past/future/normal/dated forecasts; keep civil holiday facts unchanged. |
| Venue-service dashboard `opening-hours-day.ts:40`, `:384`, `:708`; `opening-hours-screen.ts:832`; `opening-hours-week.ts:318`; `opening-hours-zone-week.ts:213`; `opening-hours-station.ts:95`; `opening-hours-all.ts:53`; `department-zones.ts:358`; `range-dialog.ts:128`, `:148`; `service-grid.ts:444`, `:519` | Date-aware columns, Today labels, normalization/sorting/draft validation and visible short/long-day bounds. Every scalar grid consumer must choose an actual date or the normal-week reference. |
| `apps/server/src/boot.ts:1717`, `:2201`; `backup-schedule.ts:63`, `:73`; `backup-sweep.ts:177`, `:189`; `cloud-snapshot-worker.ts:185`, `:190`, `:199` | Fresh timeline closures, future candidate clocks, retained deadlines and restart behavior. |
| `boot.ts:1492`, `:1588`, `:1688`, `:2097`; `invoice-email-worker.ts:22`; `venue-time-zone.ts:5`; `till-backend.ts:14`; core `record-sale.ts:278`, `:315`; reporting `vat-return.ts:35`; bookings `floor.ts:4` → `wall-clock.ts:54` | Email zone stays locked; claims/retries, fiscal/payment duties, stored civil issue dates, workforce and bookings are not re-keyed to business dates. No change to these date definitions. |
| Server transfer `configuration-transfer.ts:78`, `:120`, `:144`, `:594`, `:660`; venue-service transfer `configuration-transfer.ts:223`, `:254`, `:427`; core transfer `packages/db/src/configuration-transfer.ts:29`; setup/boot prepare/import path | Export active scalar, pending refusal, exclude history; validate real import and reset/provisioning paths. New tables are not transferable configuration. |
| Server `reset-request.ts:82`, `:102` → `db-wipe.ts:18`; `restore.ts:208`, `:337`, `:375`; `rejoin-command.ts:140` | Whole venue reset/wipe replaces the file and therefore the timeline; restore places the whole `venue.db`. Preserve lock/restore/fiscal hooks; add retained-clock assertions to existing real-path tests. |
| Core `classification.ts:76`, `:240`; composition `modules.ts:94`; migrations manifest core entry; dashboard queries `apps/dashboard/src/api/live-queries.ts:125`, `:145`, `:408`, `:477`; venue-service `dashboard/live-queries.ts` | State classification gives both change sources; dependencies on clock-sensitive reads plus passive timer activation refresh. |
| Adjustments `dashboard/live-queries.ts:4`, `:5`; `adjustment-report-screen.ts:299`, `:338` | Add clock sources to report/entries watches; retain passive 60-second refresh and cursor replacement checks. |

Audit commands: `rg -n 'dayCutover|day_cutover' packages apps scripts --glob '!**/drizzle/**' --glob '!**/*.test.*'`; `rg -n 'readLocationClock|resolveVenueClock|venueMomentAt|venueLocalMoment|serviceMomentAt|businessDayOf|currentBusinessDay|businessDayStart|businessDayWindow|businessDayRangeWindow|validatedRangeWindow' packages apps --glob '!**/*.test.*'`; whole-tree `recordDailyClose` caller search. Read both identifiers and surrounding prose after implementation. Initial-value demos and test fixtures are callers too; they cannot retain an input shape that omits the required timeline.

## Evidence, risks and handoff

Existing tests run here, no edits:

| Command | Observed result |
| --- | --- |
| `pnpm --filter @waitron/reporting test src/business-day.test.ts` | 1 file, 53 tests passed |
| `pnpm --filter @waitron/venue-service exec vitest run --project node src/service-day.test.ts` | 1 file, 52 tests passed |
| `pnpm --filter @waitron/server test src/venue-details.test.ts src/boot.clock-wiring.test.ts` | 2 files, 94 tests passed |

The first attempted service-day command, `pnpm --filter @waitron/venue-service test --project node …`, was rejected by pnpm as an unknown option and ran no tests; the corrected `exec vitest` command above supplied the receipt. These passes describe the existing implementation, not A495. No A495 behavior, visual, migration, deletion-control or fiscal-isolation test was run by the planner.

Main risks are the boundary-versus-wall-date mismatch during DST, the 26-hour tail replaying early hours, hidden timetable/offset/clone writers, and omitted timelines at report boundaries. The bounded schedule policy deliberately makes some edits unavailable while pending and keeps recurring schedules valid under old starts. ICU behavior beyond existing tested zones remains a runtime verification obligation. Requirements do not force a fiscal invariant change; stop and report if implementation discovers one. The implementation plan supplies failing-first tests, visual inspection, normal hook/current-head CI, one complete Claude run-it review during `finish-branch`, and the owner landing checkpoint.
