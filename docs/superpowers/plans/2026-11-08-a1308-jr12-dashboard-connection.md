# A1308 jr12 — the dashboard's connection: 30 seconds of silence is down, database-only timers quiet while connected — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Owner lands:** no (rules §6).

**Goal:** The dashboard's one live connection (`packages/dashboard-kit/src/live-connection.ts`)
counts about 30 seconds with no event as down; while it is up, the re-read timers of queries whose
answer depends on database rows alone stop, and every other timer keeps running; the server
publishes the in-memory states nothing publishes today, so open screens hear those changes at once.

**Architecture:** `LiveConnection` records when it last heard anything (the server sends a
`keepalive` every 15 seconds, `apps/server/src/live-api.ts:136`, kept by jr11) and treats 30 seconds
of silence as an error: in Chromium a silent server leaves an `EventSource` open with no error after
45 seconds (jobs.md §1, test 2). `LiveData` (`packages/dashboard-kit/src/live-data.ts:80-87`) learns
whether the connection is up and skips a timed re-read while it is **only for a query marked
`quietWhileConnected`**. The mark is opt-in, given only to the queries an audit found to read
database rows alone; a new or unlisted query keeps its timer. The server publishes `pairing`,
`printer_discovery`, `email_inbox` and `backup_status` on the `LiveEvents` bus when they change
(today they are accepted interests that nothing publishes, `apps/server/src/live-resources.ts:3-23`).

**Why opt-in (a decision against the design's wording).** jobs.md §3 says "re-read on a timer only
while the live connection is down". An audit of every timed dashboard query (2026-11-08, read, not
run; below) found about thirty whose server answer depends on the clock, server memory or something
outside the database: a timer-free screen would show a stale "open now", a stale menu that went live
by time, or a stale Mailpit inbox. Those keep their timers until their server reads stop depending on
the clock; that is beyond this part. **Owner, 2026-11-09:** confirmed — those reads keep their timers
(in jr12, jr13 and jr14).

**Spec:** [jobs.md §1 "Browsers hold one live connection" (the 30-second rule covers the dashboard too); §2 "Browsers"; §3 rows "Dashboard background re-reads", "Dashboard printer and device pairing helpers", "Till payment and receipt status re-reads", "Product image refresh"; §6 J7](../specs/2026-11-02-rationalisation/jobs.md);
README §10 "Applied as the design" ("The 30-second silence rule applies to the dashboard as well as
tills"). Slice rules apply.

## What it builds

1. `LIVE_SILENCE_MS = 30_000` in `LiveConnection`; silence closes the stream, re-reads once, and
   reconnects with today's back-off (1 s doubling to 30 s, `live-connection.ts:151-155`).
2. `LiveData.setConnected(up: boolean)`; a timer tick is skipped while up only for a query with
   `quietWhileConnected: true`.
3. `quietWhileConnected: true` on exactly the database-only queries below (the audit's names in
   `QUERY_DEPENDENCIES`, `apps/dashboard/src/api/live-queries.ts`). A name marked * was only skimmed
   by the audit: the builder reads its server function first and leaves it off if it reads the clock,
   memory or anything outside the database.
   - Catalogue: `getCatalogueSettings`, `listCatalogues`, `getMenuStructure`, `getMenuPrices`,
     `getMenuHome`, `listCategories`, `getCategory`, `listLibraryProducts`, `listProducts`,
     `listUnits`, `listOptionLists`, `getOptionList`, `listExtraLists`, `getExtraList`, `listMadeAt`*.
   - Theme: `getVenueTheme`, `listThemes`.
   - Printing: `listPrinters`, `listPrinterProfiles`, `listPrinterStationNames`, `listPagePrinters`,
     `listPrinterStations`, `getPrinterDeleteImpact`*. (`listRecentJobs` is not here since #2594:
     see item 4, memory.)
   - Payments: `listReaders`, `listReaderHolders`, `getProfileReaders`, `listHeldPayments`.
   - Reports with explicit days: `getDailyClose`, `getSalesPeriod`, `getCategorySales`,
     `getReportPrinters`, `getOrderPrinters`, `listOrderStaff`.
   - Staff: `listStaff`, `getStaffRoster`, `getProfile`, `listPendingAbsences`, `listPendingSwaps`,
     `getRoster`, `listMySwaps`, `listMyAbsences`.
   - Venue and devices: `listDeviceProfiles`, `getDeviceProfile`, `listProfileKitchenScreens`,
     `getProfileScopeChoices`, `listDevices`, `listStations`, `listCourses`, `listZones`,
     `getFloorPlan`, `getStationDeleteImpact`, `getCourseDeleteImpact`, `getReceiptLanguage`,
     `getVenueDefaults`, `getVenuePrivacy`.
   - Other: `listPurchaseInvoices`, `clockMisdated`, `clockMisdatedHandled` (and `getProductRecipe`,
     `listIngredients` only if slice 4a left them).
   - Database plus values fixed at boot (a restart drops the connection, which re-reads): 
     `getContentLanguages`, `getContentTranslationGaps`, `getContentTranslationTargets`,
     `getContentTranslationCells`, `getGoogleConfig`, `getLocales`, `getDepartmentReceipt`.
   - Published by this plan: `pairingMode` (its answer is only `isOpen`/`openUntil`, `join-api.ts:157-158`).
   - Package screens' own timed queries: `packages/bookings/src/dashboard/bookings-screen.ts:190`,
     `packages/media/src/dashboard/image-library.ts:671`*, `packages/adjustments/src/dashboard/reasons-screen.ts:533, :579`,
     `adjustment-report-screen.ts:411`, `apps/dashboard/src/widgets/content-translations-dialog.ts:287`,
     `packages/venue-service/src/dashboard/prep-stations-screen.ts:430`*, and `model-watch.ts`'s
     floor-plan-sets, period-choices and stations watches*.
4. Kept on their timers while connected, by the audit's reason (no mark):
   - **clock:** `getZoneDeleteImpact`, `getDepartmentDeleteImpact`, `getMenuStatuses`,
     `getMenuStatus`, `getMenuPreview`, `getLiveMenu`, `getMenuRead`, `getMenuPublications`,
     `getSalesOverview`, `getOverdueOrders`, `listOrderPages`, `getOrder`, `getFolderRouting`,
     `getVenueDetails`, `listAlerts`, `listHandledAlerts`, `listMyShifts`/`getPlannedVsActual` (not
     traced), the bookings screen's tables (`/management-api/tables` → `listTables(tx, new Date())`,
     `management-api.ts:1545`), the venue-service loader, routing and opening-hours watches, the
     adjustment report's "current" range;
   - **memory:** `listRecentJobs` (since #2594, `5f11ab6405`, each USB or Bluetooth job still
     waiting carries `waitReason: "printer.not_visible"` when no fresh agent report in the server's
     in-memory discovered list names its printer, `apps/server/src/print-api.ts:1497-1526` on
     `48d527dbc8`, and the dashboard re-reads it every 15 seconds for that,
     `apps/dashboard/src/api/live-queries.ts:604`), `getDiskStop`, `joinRequests`,
     `listDiscoveredPrinters`, `listStuckPayments`,
     `listStuckBillPayments`, `listStuckBillRefunds`, `listStuckTenderRefunds`, `getStreamSettings`,
     `getContentLanguageRules`;
   - **outside the database:** `listAgents` (the OS's addresses), `getContentSuggestions` and
     the dialog at `content-translations-dialog.ts:312`, `getEmailInbox` (Mailpit), `listServers`,
     `getBackupStatus`, `getCloudStatus`, `getCloudBilling`, `getBoxHealth`;
   - **dependencies not declared** (no change would ever wake them): `listPaymentProviders`,
     `getReaderDeleteImpact`, `getDeviceDeleteImpact`.
5. The two screen timers jobs.md §3 names:
   - the printers screen's 2-second scan reads (`apps/dashboard/src/screens/printers-screen.ts:1156, :1379, :1701`)
     keep their timer while a scan window is open — the discovered list lives in server memory and
     ages by the clock (`print-api.ts:942-943`) — and also re-read at once on `printer_discovery`;
   - the order-detail dialog's 5-second delivery re-read (`apps/dashboard/src/widgets/order-detail-dialog.ts:226`) keeps its timer (the delivery read expires claims by the clock,
     `invoice-delivery.ts:262`) and also re-reads at once on a change to `invoice_deliveries`,
     `print_jobs` or `outgoing_mail`.
6. Server publishers: `pairing` when the pairing window opens, closes, is claimed, or a hold lapses
   (a one-shot timer at the earliest hold's end, `apps/server/src/pairing-mode.ts:34-…`);
   `printer_discovery` when a pull adds a device or changes one's description
   (`apps/server/src/print-api.ts:626, :648`) — not on every pull, which comes every 2 seconds per
   agent and mostly restamps `lastSeenAt`; `email_inbox` when the mail sender delivers to the
   practice inbox (3a-ii's `runMailPass`, `apps/server/src/mail-sender.ts`, after a `sent` outcome
   whose delivery mode is the practice inbox); `backup_status` when a destination outcome, the
   stopped-run record or the loaded settings change (`BackupSupervisor`'s `#recordResult`/`#recordUpload`,
   `runStopped` set or cleared in `runOnce`, the end of `reload`) and when the bucket copy's state
   changes (`StreamSupervisor`'s status transitions).
7. `google_config`: if the environment part has moved Google sign-in into a settings document,
   `getGoogleConfig`'s dependencies become that document's change type and `google_config` leaves
   `liveResourceTypes`; otherwise "configured" is fixed until restart (`management-api.ts:798-806`).

Every management route also checks the session's idle timeout with `Date.now()`
(`packages/identity/src/management-session.ts:79`); a quiet query does not notice an expiry by
itself, but the stream's recheck at each keepalive does (jr11), and answers `session-invalid`.

## What it leaves out

The till (jr13, jr14). Making the clock-dependent reads publish their own boundaries.

## Files

- Modify: `packages/dashboard-kit/src/live-connection.ts`, `live-connection.test.ts`,
  `live-connection.lifecycle.test.ts`, `live-data.ts`, `live-data.test.ts`,
  `apps/dashboard/src/api/live-queries.ts` (`:584-610` and the quiet set), the package screens in
  item 3, `apps/dashboard/src/screens/printers-screen.ts`, the order-detail dialog,
  `apps/server/src/pairing-mode.ts`, `print-api.ts`, `mail-sender.ts`, `backup-supervisor.ts`,
  `backup-sweep.ts`, `stream-host.ts` (or `packages/stream`'s supervisor status hook),
  `live-resources.ts`, `boot.ts` (hand the bus to each), and each one's test
- Create: `apps/server/src/live-publish.ts` (`publishState(bus: LiveEvents, type: string, log: Logger): void`,
  absorbing a throw as `changeSubscriber` does, `live-api.ts:41-49`)

## Size

| Hand-written | Lines |
| --- | --- |
| Code: connection 45, data 25, quiet set and package marks 50, printers and order-detail re-reads 30, publishers 90, `boot.ts` 15 | **~255** |
| Tests: connection 120, data 50, quiet-set guard 20, screen re-reads 40, publishers 160 | **~390** |
| Total | **~645** |

## Finish line

1. `pnpm --filter @waitron/dashboard-kit exec vitest run src/live-connection.test.ts src/live-connection.lifecycle.test.ts src/live-connection.session-generation.test.ts src/live-data.test.ts` — passes.
2. `pnpm --filter @waitron/dashboard exec vitest run src/api/live-queries.test.ts src/screens/printers-screen.test.ts` and `src/widgets/order-detail-dialog.delivery.test.ts` — pass (browser mode; check free memory first).
3. `pnpm --filter @waitron/server exec vitest run src/pairing-mode.test.ts src/print-api.test.ts src/mail-sender.test.ts src/backup-supervisor.test.ts src/live-publish.test.ts src/stream-host.test.ts` — passes.
4. `pnpm exec vitest run scripts/live-subscriptions.test.ts` — passes. Typecheck, format; protection list EQUAL.

## Expected protection-list difference

**EQUAL.**

## Stop points (beyond rules §5)

1. A starred query's server function reads the clock, memory or outside: leave it off and record it;
   not a stop. A query in item 3 the builder finds is not database-only: stop and ask.
2. `live-connection.session-generation.test.ts` needs a changed assertion.

## Needs

jr11 (its keepalive and lock-free wake check). 3a-ii (the mail sender, `runMailPass`).

## Global Constraints

- Automatic dashboard reads stay passive session activity (CLAUDE.md §3).
- A publisher never throws into the code that changed the state.
- The silence rule never closes a stream that is still delivering keepalives.
- A query is quiet while connected only if marked; the default is today's timer.

## Review Focus

1. **A box that loses power with a dashboard open.** Within about 30 seconds the dashboard re-reads
   and every timer runs again. Task 1's silence case.
2. **A menu queued to go live at 18:00, dashboard open and connected.** `getMenuStatuses` keeps its
   timer, so the screen shows it live within its interval, as today.
3. **Two dashboards open, one opens pairing.** The other sees the window open through `pairing`,
   and sees it close when the hold lapses. Task 3.
4. **A new query added later without the mark.** It keeps its timer (opt-in). Task 2's guard.
5. **A page hidden and shown** (`pagehide`/`pageshow`). The silence timer is cleared while suspended
   and started again on return (`live-connection.ts:32-48`).

---

### Task 1: Silence counts as down

- [ ] **Step 1: Failing tests** (`live-connection.test.ts`, fake timers, the injected `open`):
  `"no event for 30 seconds closes the stream, re-reads once and reconnects"`;
  `"a keepalive every 15 seconds keeps it open indefinitely"`;
  `"the silence clock starts at open and restarts at every event"`;
  `"a suspended page runs no silence check"`; `"the connection tells LiveData it is up at ready and down at error or silence"`.
- [ ] **Step 2–4:** FAIL; implement (a 5-second check interval comparing `Date.now()` with the last
  event; any named event or `open` counts); PASS. Commit: "Count thirty seconds of silence on the dashboard's stream as down".

### Task 2: Database-only timers quiet while connected

**Interfaces:** `ResourceQuery<T>.quietWhileConnected?: boolean`; `LiveData.setConnected(up: boolean): void`
(`up` starts false). The timer callback (`live-data.ts:83-86`) marks the entry dirty unless
`connected && query.quietWhileConnected`. `live-queries.ts` exports `QUIET_WHILE_CONNECTED:
ReadonlySet<DashboardQueryName>` (item 3's dashboard names) and `dashboardQuery` sets the mark from it.

- [ ] **Step 1: Failing tests** (`live-data.test.ts`): `"a quiet query does not re-read on its timer while connected"`;
  `"it re-reads on its timer while down"`; `"an unmarked query re-reads on its timer either way"`.
  `live-queries.test.ts`: `"only database-only queries are quiet while connected"` — pins
  `QUIET_WHILE_CONNECTED` to item 3's list and asserts no name from item 4 is in it.
  The printers screen and order-detail dialog: `"a printer_discovery change re-reads the scan at once"`;
  `"a delivery change re-reads the order's deliveries at once"`.
- [ ] **Step 2–4:** FAIL; implement; mark the package screens' queries; PASS. Commit: "Keep database-only dashboard reads quiet while the live connection is up".

### Task 3: The server publishes its in-memory states

- [ ] **Step 1: Failing tests**, one per publisher, each subscribing to a `LiveEvents` bus:
  `"opening, closing and claiming the pairing window publishes pairing"`;
  `"a hold lapsing publishes pairing at its end"`; `"a pull that finds a new device publishes printer_discovery; a pull that changes nothing does not"`;
  `"a mail delivered to the practice inbox publishes email_inbox; one sent over SMTP does not"`;
  `"a backup destination outcome publishes backup_status"`; `"the bucket copy changing state publishes backup_status"`;
  `"a publisher whose bus throws does not fail the caller"`.
- [ ] **Step 2–4:** FAIL; implement through `publishState`; hand `liveEvents` from `boot.ts`
  (`:2215`) to each; settle item 7 (`google_config`); PASS. Update `live-resources.ts`'s comment
  (`:3-9`), which says nothing publishes these. Commit: "Publish pairing, discovery, inbox and backup states to open dashboards".
