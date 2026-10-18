# A789 — Last orders without an offset: a period is when its menu can be ordered

Status: **design, waiting for the owner's answer to one question (Q39 in lane C's questions file,
repeated in §11 below). Nothing is built until then.** Backlog entry: `docs/backlog.md` "A789".
Pictures: `docs/backlog/mockups/a789-last-orders/` (drawn in HTML with the apps' colour tokens, not
screenshots; 02 also in dark, `-dark.png`).

File references are to `main` at `d9adb0e8f`. **(read)** marks a conclusion from reading code, not
from running it. Nothing in this design was run: it changes no behaviour, and every statement about
today's code is (read).

**Words.** A **period** is a named stretch of a department's day with its own menu (Lunch, Dinner).
An **unsent dish** is a dish on the till's order that has not yet gone to the kitchen. The **end
offset** is today's per-period setting that moves last orders before or after the period's end.
**Keep open** is today's till button "Keep {period} open later today"; the **zone** version, "Keep
{zone} open later today", is a different button and stays.

---

## 1. What the owner asked for

The owner's words, 2026-10-17: "Maybe there is no offset. Lunch is when you can order lunch. If you
want a post lunch period when you can't order food, you can make it a different period." Then, on a
suggestion of a venue-wide grace time for sending: "instead of the grace period, have the order warn
that that dish is no longer being offered and to confirm with the kitchen." And: delete the period
"Keep open" feature, because a late send now warns; keep the zone one.

So:
1. The end offset goes. A period's own menu decides what can be ordered while it runs.
2. A dish taken before its period ended but sent after it is not refused silently: the till warns
   that the dish is no longer offered and asks the waiter to check with the kitchen; once they
   confirm, it is sent.
3. The period Keep open goes; the zone Keep open stays.

## 2. What exists today

**The end offset** (read). Each period has `endOffsetMinutes` (column `end_offset_minutes` on
`menu_periods`, `packages/venue-service/src/schema/menus.ts:18`, default 0; the parser accepts
−1439…1439, `period-end-offset.ts:18`). For Lunch
12:00–14:00, −15 stops picking and sending at 13:45; +15 stops picking at 14:00 and lets unsent
dishes be sent until 14:15 (`docs/developers/conventions-data.md:557`). The dashboard's period dialog
shows it as "Period end offset (minutes)" with the line "Negative: stop new dishes before the end.
Positive: send leftovers after the end. 0: use the period end."
(`packages/venue-service/src/dashboard/strings.ts:713-715`).

**Two windows.** `resolveDepartmentService` (`packages/venue-service/src/menu-timetable.ts:373`)
works out, for a moment, which menus can be **picked** (`orderableMenuIds`) and which can be **sent**
(`sendableMenuIds`); they differ only by a positive offset (`:425-450`). It also lists the menus of
periods that have already ended (`endedMenuIds`, `:468`), which nothing outside tests reads today. It
also lists the previous business day's periods (`day.previousRanges`, `:451-454`), so §5's same-day
rule cannot use it as it stands.

**The server's check.** `priceOrderLines` (`apps/server/src/working-order.ts:517`) refuses a new line
whose menu is not in the sending list with `menu_period.not_running` (`:612-624`); a quantity
increase on a stored line is checked against the picking list instead (`:5242`, `:5263`). It runs
when an order is opened or paid at the counter (`createOpenOrder`, `:1276`), when a table's round or
a saved draft is sent (`priceTabRound`, `:2541`) and when a held order's lines are edited
(`applyLineEdits`, `:5326`). Sending lines the server already holds — a held course fired later —
does not check the period (`sendLines`, `placeOrder`, `fireGroup`), and neither does saving a draft.

**The till.** It reads the menu state every 15 seconds (`apps/till/src/state/menu-state-poll.ts`) and
switches to the next period's menu when the period changes (`apps/till/src/till-app.ts:4596-4651`).
A menu that cannot be picked is hidden from the picker (`menu-filter.ts:55-71`). A line is judged by
the menu of the offer it names: the same product on another menu does not help it, on the till
(`till-app.ts:1150`) or on the server (`working-order.ts:612-624`; the Tostada case in
`apps/server/src/till-api.service-periods.test.ts:466-478`). An unsent dish whose
menu can no longer be sent is marked `period_ended` ("Last orders have ended") and holds Pay and Send
(`till-app.ts:1141-1152`, `:5017`, `:9392`). With offset 0 that happens at the period's end: today a
dish taken at 13:59 and sent at 14:01 is held on the till, and the server would refuse it.

**Keep open (the period one).** A manager, or someone with their PIN (`venue_service.manage`), moves
today's end of the running period later; one row per department per business day in
`period_extensions` (`packages/venue-service/src/schema/period-extensions.ts`), written by
`keepPeriodOpen` (`keep-open.ts:115`), laid over today's times by `withExtension`
(`service-day.ts:161`), which shortens or drops the next period. Kitchen routing that names a period
follows the extended one (`routing-store.ts:838`). The dashboard's period delete preview and the
department delete count these rows.

**Keep open (the zone one).** Its own table (`zone_extensions`), route and strings. It shares four
pieces with the period one: the zone check reads the period extension when it works out how late
the department runs (`keep-open.ts:187-189`, `:238`, `:279`); one `GET …/keep-open` answer carries
both halves; one till widget serves both and holds the zone's pending write typed as the period's
(`PeriodExtensionWrite`, `apps/till/src/widgets/keep-open.ts:41`); and the dialog component and four
strings are shared.

**Staffing is not affected.** The staffing grid draws planned period times as guides
(`packages/venue-service/src/planned-service-guides.ts:82`, drawn by
`packages/staffing/src/dashboard/staffing-grid.ts:699-719`); no rota rule reads a period end or an
extension (`packages/staffing/src/rota.ts`). The guides' "sending" band is drawn to the end plus the
offset (`planned-service-guides.ts:220-223`); with the offset gone it ends at the period's end.

## 3. The design, as someone sees it

Bar Santet's Restaurant department: **Lunch 12:00–14:00** (the full menu), **Sobremesa 14:00–16:00**
(a menu of drinks, coffee and desserts), **Dinner 20:00–23:30**.

### 3.1 The dashboard (picture 01)

The period dialog loses its End offset field and its explanation. Nothing replaces it. To stop food
and keep serving drinks, the manager adds a period after Lunch whose menu has only drinks — the owner's
"post lunch period". The Week and Year painters, seasons and special days are unchanged; they only lose
the refusals that were about the offset.

### 3.2 The till at the end of a period (pictures 02 and 04)

- **Picking.** At 14:00 the till switches to Sobremesa's menu, as it does today. Lunch's dishes can no
  longer be picked. (Up to 15 seconds may pass before the till notices, as today; the server's check
  is the backstop.)
- **An unsent dish from Lunch** stays on the order, marked with the warning colour and a symbol:
  "Lunch ended". Pay and Send are not held any more.
- **Send** (or Pay at the counter) with such dishes opens one short window:

  > **Lunch has ended**
  > Check with the kitchen before sending:
  > 2 × Tortilla · 1 × Entrecot
  > [Remove them] [Kitchen agreed — send]

  "Remove them" takes those dishes off and goes back to the order; "Kitchen agreed — send" sends
  everything. Anyone who can send can confirm: the check is with the kitchen, not with a manager.
- **A dish the running period also sells** — a caña taken from Lunch's menu, which Sobremesa also
  sells — is not marked and needs no check: the kitchen or bar is still making it. It is sent at the
  price it was taken at (Lunch's). This is new: today the caña is held with the tortilla (§2).

The same window appears on a handheld, at phone width (picture 04).

### 3.3 The kitchen (picture 03)

A dish sent this way carries a mark on its kitchen ticket and on the kitchen screen: **"After Lunch —
agreed"**, so the cook who agreed recognises it and another cook does not think it is a mistake.

### 3.4 Keep open

The till's "Keep {period} open later today" button and dialog go. The zone button stays and works as
today, with one change that follows from the removal: a zone can be kept open only as late as its
department's own times for the day, because nothing extends the department's day any more (picture
02's top bar shows the period line without the period button).

**What this removes from the floor.** Today a manager can keep Lunch open for a party that arrives at
14:10. After this change, once Lunch has ended nobody can pick a Lunch dish that Sobremesa does not
sell; only dishes already on an order before 14:00 can still go, with the kitchen's agreement. Part
(f) of the question asks whether that is what the owner wants.

## 4. Worked examples

1. **13:59, sent at 14:01.** Ana takes 2 × Tortilla and 1 × Caña for table 4 at 13:59 and taps Send at
   14:01. Tortilla is only on Lunch's menu; Caña is on both. The window lists only "2 × Tortilla". Ana
   asks the kitchen, taps "Kitchen agreed — send". The kitchen ticket shows the tortillas under
   "After Lunch — agreed" and the caña as normal. Both are priced as Lunch.
2. **A coffee at 14:30.** Marc opens table 7 in Sobremesa and picks a café con leche from Sobremesa's
   menu. Nothing is marked; it is sent as normal.
3. **A steak at 14:30.** The entrecot is not on Sobremesa's menu, so Marc cannot pick it. If an entrecot
   taken at 13:55 is still unsent at 14:30, Send shows the window as in example 1.
4. **A draft left overnight.** A Dinner dish saved on a draft at 23:20 and not sent before the
   business day's changeover (06:00) is refused the next morning, as today: the window is for dishes
   from a period that ended earlier the **same** business day. The till marks it "Dinner ended" and
   its only choice is Remove.
5. **A held course fired after Lunch.** Desserts sent to the kitchen on hold at 13:40 and fired at
   14:20 go as today, with no window: the kitchen already had them.

## 5. What the server checks and records

When a new line's menu is not one that can be picked now:
- if the line's dish (and variant) is on a menu that can be picked now, it is accepted, at the price
  of the offer the line names (example 1's caña). This is new: today the server judges a line only
  by its own offer's menu (§2). It needs one more read of the running menus' offers by product and
  variant, made once per request before the loop over lines (CLAUDE.md §3, "Resolve shared
  catalogue data once");
- else if the menu belongs to a period of the same department that ended earlier in the same
  business day (`endedMenuIds` narrowed to today, §2), the request is refused with a new code (proposed `menu_period.ended`, naming the
  department, the ended menus and the lines) **unless the request confirms those menus**. The
  confirmation names each ended menu it covers, so a window shown for Lunch cannot carry a dish from a
  menu that ended after the window was shown;
- else it is refused as today with `menu_period.not_running`.

Raising the quantity of a line already sent is a new pick: after its period it is refused, as today
(`working-order.ts:5242`, `:5263`). Every other check stays: the zone's closed times (`assertZoneTakesNewOrders`), the menu version,
availability, sold out, the device profile and the person's permissions. The refusal code goes in the
till's error strings in English and Spanish.

A line sent with a confirmation records that it was sent after its period ended and who confirmed
it (the signed-in person). The kitchen ticket and the kitchen screen read that record for the mark in
§3.3. This needs a migration (a column on the order line; the plan decides where).

## 6. What is removed

Each slice lists every consumer again before deleting; this list is the starting point (read).

- **The end offset:** the column (`menu_periods.end_offset_minutes`, added by venue-service
  migration `0034` and carried by `0057`'s rebuild; dropped by a new migration, never by editing those), its parser and clash rules (`period-end-offset.ts`), the clash
  checks in `menu-timetable.ts` (`endOffsetClash` and its three wrappers, `assertWeekEndOffsets`),
  the refusal reason `end_offset` in `menu_timetable.invalid`, `season.invalid`,
  `special_day.invalid` and `venue.detail_invalid`, `menu_period.invalid`'s `endOffsetMinutes` field
  and its reasons, the offset parsing in the period routes (`routes.ts:1164-1255`), the import check
  (`validateEndOffsets`, `configuration-transfer.ts:394`), the period dialog's field and its strings
  (`menu.end_offset`, `menu.offset_*`, `season.offset_*`), the module contract's
  `assertPeriodEndOffsets` (`packages/module/src/module.ts:626`), and the separate sending list
  (`sendableMenuIds`, and `sendable` on each menu the till reads).
- **The period Keep open:** the table `period_extensions` (and its row in `classification.ts:32`),
  `keepPeriodOpen`, `withExtension` (period-only: the zone check's ranges become the day's own), the `PUT …/period-extension` route, the codes `period_extension.invalid` and
  `.not_allowed`, the till's period button, dialog and period-only strings (`keep_open.button`,
  `heading`, `ends`, `ended`, `delays`, `drops`, `line_extended`), the dashboard's "kept open today"
  lines in the period delete preview, the department delete count and its string
  (`venue.delete_item_period_extensions`, `service-delete-copy.ts:22`), the dashboard live-subscription
  names that read the table (`packages/venue-service/src/dashboard/live-queries.ts:41`, `:184`, and
  `apps/dashboard/src/api/live-queries.ts:71` — they travel together, CLAUDE.md §3), the test fixture
  `apps/server/src/testing/clear-provision-fixture.ts:14`, and the guard lists that name
  the table (`scripts/schema-constraints.test.ts`, `scripts/migration-upgrade.test.ts`).
- **Backlog entries that go with them:** "Sending grace after a period extension is replaced or
  expires", "The end-offset check accepts a cutoff past the changeover", and the A789 entry itself.

**Not removed — the attendance offset.** `endOffsetMinutes` on a clock-in session
(`packages/workforce/src/projection.ts:37-42`) is the time zone's offset at clock-out, a different
thing with the same name. It stays.

**Database.** Dropping the column and the table changes no other data. The plan reads the SQL drizzle
generates for the column: a rebuild of `menu_periods` would empty its cascading children
(`menu_period_staff_menus`, `period_extensions`, `routing_cell_periods`) and be refused while
`department_day_ranges`, whose key has no delete rule (`schema/seasons.ts:154-158`), holds rows —
every venue with a timetable (CLAUDE.md §3; `scripts/migration-upgrade.test.ts:527-530` records both
for `0057`). Before go-live a venue may be reset; the PR's first line says
so if one is needed.

## 7. What stays, under a plainer name

- **Checks that refuse something today even with every offset at 0** are kept. `assertPeriodEndOffsets`
  runs the clash check even when every offset is 0, when the time zone changes, and the business-day
  changeover's `sending_cutoff` conflict can refuse with offset 0 (`business-day-schedule.ts:399-430`). The plan finds, by running
  the existing tests with the offset removed, which of these cases still refuse, keeps each one, and
  renames its reason and words so they no longer say "last orders" or "offset".
- **`keep_open.line_until`** ("{period} · until {time}") is the till's normal period line, not only the
  extended one; it stays, renamed. It is drawn from the service's `keepOpen` field
  (`apps/till/src/widgets/service-period.ts:23-27`, built by `keepOpenSubject`,
  `menu-timetable.ts:338-371`): the period's name and end stay as its source; only `extendedUntil`
  goes.
- **The zone Keep open's shared pieces** — the `GET …/keep-open` answer, the dialog and the four shared
  strings — stay with the zone; its write gets its own type.

## 8. Lane G's A773 (courses and groups)

A773's design (`docs/superpowers/specs/2026-10-16-a773-courses-and-groups-design.md:259-262`,
"Warnings in the list") marks a line that cannot be sold now, including one whose period ended, and
says "Neither kind is ever sent". This design changes that for a period that ended: such a line is
sent after the kitchen agrees. A773 also retires the "Check before sending" window (`:264`); this
design does not bring it back. Its window opens only when Send (or Fire) includes a dish whose period
has ended, and in A773's editor the mark is the one A773 already puts in the list. A773-1
(lane G, in progress) rewrites the till's order editor and its Send. So the till slice here waits
for A773-1 to land and is built in A773's editor; the watcher is asked to tell lane G (questions file).

## 9. Slices

Each leaves `main` working on its own.

1. **Retire the end offset.** Column, rules, checks, import, dialog field, strings, docs. Picking and
   sending become one window. After this slice alone a dish sent after its period is held on the till
   and refused by the server, as today with offset 0.
2. **Delete the period Keep open**, splitting the zone pieces off first.
3. **The server accepts a confirmed late send** (§5), records it, and the kitchen ticket and screen
   show the mark. The till does not send a confirmation yet, so nothing changes on the floor.
4. **The till's warning and window** (§3.2) on the counter, table and handheld screens. Waits for lane
   G's A773-1.

Slices 1 and 2 are independent of each other.

## 10. Not decided here

How the confirmation travels (a field on the send, or a second request), the code's final name
(grep the `menu_period.*` siblings), and where the record lives are the plan's. The plan grows each
"(read)" above into a test before relying on it.

## 11. The owner's question (Q39)

**Q39. Do you approve last orders as designed, with these choices?** "All recommended" is a complete
answer.

- **(a) The look and words** (pictures 02–04): the dish marked "Lunch ended"; Send opens "Lunch has
  ended — Check with the kitchen before sending: …" with [Remove them] [Kitchen agreed — send].
  Recommended: **yes**.
- **(b) Who can confirm.** Recommended: **anyone who can send**, no manager PIN. Alternative: a
  manager's PIN.
- **(c) A dish the running period also sells** (the caña). Recommended: **sent without the window, at
  the price it was taken at.** Alternative: every dish from the ended period goes in the window.
- **(d) How long a late send is possible.** Recommended: **until the business day's changeover**; a
  dish left unsent past it can only be removed. Alternative: only until the next period of the same
  department ends.
- **(e) The kitchen mark.** Recommended: **"After Lunch — agreed" on the ticket and kitchen screen, and
  the order line records who confirmed** (one new column). Alternative: no mark and no record.
- **(f) A late arrival once Lunch has ended.** With the period Keep open deleted, nobody can pick a
  Lunch-only dish after 14:00. Recommended: **accept that** — "Lunch is when you can order lunch".
  Alternative: a manager can still pick from an ended menu, with the same kitchen window.
- **(g) The order of the work.** Recommended: **the four slices in §9, in that order.**
