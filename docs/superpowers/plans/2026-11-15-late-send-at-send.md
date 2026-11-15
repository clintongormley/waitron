# LATE-SEND-AT-SEND — plan (lane B, 2026-11-15)

Cleared by the watcher 2026-11-15 21:57 (lane B's questions file): one PR in lane B, defaults (a) and (b)
below, and "if the station's 'after <period>' mark can be shown without naming a confirmer, show it on
those two paths". The owner's own words: "ask for everything" (2026-11-15, relayed by the watcher).

**Outcome.** A dish that was stored before its period (say Lunch) ended and is sent to the kitchen
after it asks "Station agreed" (or a manager's PIN where the department needs one), exactly as a
dish entered late does today, and its ticket carries the after-period mark. Owner's rule (2026-11-15,
watcher's window): "we ask for everything".

**What happens today.** The late check runs only when a dish is ENTERED (`priceOrderLines`,
`apps/server/src/working-order.ts:697-811`). Five things later send a stored, unsent dish (no sent
stamp, no ticket item) with no check:

| Path | Server | Till caller |
|---|---|---|
| Counter Place of a parked order | `POST /working-orders/:id/place` → `placeOrder` (working-order.ts:7299) | `#onPlaceOrder` till-app.ts:8203 |
| Table Send of stored lines | `POST /working-orders/:id/lines/send` → `sendLines` (2668) | `#onSendLines` 14887 |
| Fire a held course / one held line | `POST /parties/:id/groups/:gid/fire`, `/groups/fire-line` → `fireOrderLines` (2502) | `#onFireGroup` 14510, `#onFireHeldLine` 14526 |
| Pay a saved counter bill | `POST /working-orders/:id/payments` → `fireDishesAtPayment` (bill-payments.ts:845) | `#onCounterBillPay` 20361 |
| Move a bill to a table | `move-bill.ts:625` | move dialog |

A dish already holding a ticket item (sent on hold, or in a held course) counts as sent, as A1085
decided; releasing a held course later is normal service and never asks.

**Revision 2 (after the fresh plan review, 2026-11-15 ~23:30; findings in lane B's progress.log).**
What the review established by reading (receipts are the file:line pointers):
- On a TABLE, only a set lunch's courses are ever stored unsent: every ordinary table dish goes to
  the kitchen, held or not, when it is entered; `sendLines` and `fireOrderLines` pick up only lines
  with a parent (working-order.ts:2522, :2727). So table Send / Fire course / Fire line can only ask
  about a lunch course stored before the period ended. On the COUNTER, a parked order's dishes are
  stored unsent until Place or payment.
- `fireOrderLines` is also called where no person chooses to send: finishing or collecting a party
  (`releaseHeldWorkOf`, order-groups.ts:1045 → :1144, from finish-party-service.ts:234) and
  splitting a table or moving a bill onto one (`groupArrivingDishes`, order-groups.ts:2892, from
  table-actions.ts:446 and move-bill.ts:268, :288).
- Payment fires through `fireDishesAtPayment` (till-sale.ts:2076), called from till-sale.ts:869,
  :1384, :1861, :2015 and bill-payments.ts:845.
- A check inside `fireLines` itself would be wrong: an ordinary edit re-fires copied lunch courses
  with their sent time cleared (working-order.ts:6770-6796) and fires every newly entered line.
- The mark written earlier in the same transaction IS printed: `enqueueKitchenTickets` reads
  `readLateSendMarks` (kitchen-print.ts:304); the station screen reads it when shown (:8519). The
  ticket reads only the dish line's own mark, so each lunch course is marked on its own line.

**Server: one helper, `lateUnsentDishes(tx, orderId, lines, mode)`, mode `{ ask: LateSendConfirmation | undefined }` or `"mark"`.**
1. Of the dish lines about to fire, skip those already marked (`readLateSendMarks`) and those sent on
   hold (a held line with no preparation has no ticket and no sent time, working-order.ts:2431-2467:
   it counts as sent, as A1085 decided).
2. Menu: the line's `working_line_contexts.menu_id` (a lunch course already records the lunch's
   menu item and menu, working-order.ts:1009-1019). Department: the order's CURRENT zone, read now,
   as entry does (working-order.ts:704-708).
3. Late = that menu is in the department's `endedMenus` now, not in `orderableMenuIds`, and the
   product — for a lunch course, the LUNCH's product and variant from its recorded offer
   (working-order.ts:722, :755) — is not also sold in a running menu (`productsOfferedIn`).
4. Mode ask: late and unconfirmed → `menu_period.ended` with today's params plus
   `workingOrderLineIds` (the stored lines, so the till lists them by id); confirmed →
   `lateSend.confirm` and write `late_period_name` + `late_confirmed_by`. Mode mark: write
   `late_period_name` only (confirmer null). Writes happen before `fireLines`.
`fireOrderLines` gains a REQUIRED argument `late: { ask: LateSendConfirmation | undefined } | "mark"`
so every caller chooses: the fire-group and fire-line routes ask; `releaseHeldWorkOf` and
`groupArrivingDishes` mark. `sendLines` and `placeOrder` ask. `fireDishesAtPayment` and the
counter-bill move (`adoptZone`, move-bill.ts:625) mark. The place, lines/send, groups fire and
fire-line routes parse `lateSend` through `withLateSendCheck`, like the edit routes.

**Till.** Lists the refused dishes by the refusal's `workingOrderLineIds` (the counter basket and the
table screen both hold their stored lines' ids); a dish whose line the till does not hold (Fire
course reaches every bill of the party, order-groups.ts:1137-1145) is listed by name from the
refusal's offer ids, or the window shows the period only — the implementer checks which the till
can do and says so. "Station agreed — send" retries with `lateSend`; Fire line's loop
(till-app.ts:14559) retries from the refused line on. The secondary choice: on Place, the existing
choice keeps its meaning for new basket lines (removes them, till-app.ts:7269-7286) and leaves
stored dishes unsent; on the table, "Don't send them" closes the window and leaves the courses.
API client: `placeOrder`, `sendLines`, `fireGroup`, `fireHeldLine` take an optional `lateSend`.

**Not covered (one line each in the PR):** a dish parked on an EARLIER business day and placed
today — `endedMenus` lists only menus that ended today (menu-timetable.ts:286-303), so it goes
unmarked (a counter order left parked overnight is not a real event; owner rule "real events only").
A course released from a hold is judged only if it reaches a station (its make-at choice, or
routing): no column records that a no-preparation course was sent on hold, so a no-preparation
course changed into a held lunch before the period ended is not asked (nothing prints for it), and
one sent on hold with no preparation and later given a station asks when released (review finding,
2026-11-16).

**Tasks (implementers, each well under 100 tool calls; tests first).**
1a. Server, counter: the helper (both modes) + venue-service mark writer; `placeOrder` asks (place
    route parses `lateSend`); `fireDishesAtPayment` and `adoptZone` mark. Tests: parked dish placed
    after its period refused with line ids; with `lateSend` placed and its ticket marked; also-sold
    and entry-marked dishes never ask; payment and move mark with no confirmer; deletion controls.
1b. Server, table: `fireOrderLines`' required argument at every caller; `sendLines`, fire and
    fire-line routes ask; finish/split/move mark. Tests: a lunch course stored before the period and
    sent/fired after asks; with `lateSend` its own ticket line is marked; a held no-preparation
    course never asks; finishing the party marks without asking.
2a. Till, counter Place: list by line id, retry with `lateSend`, secondary choice as above. Browser tests.
2b. Till, table Send / Fire course / Fire line for lunch courses. Browser tests.
3.  Docs: kitchen guide EN/ES, conventions-data.md:734 (confirmer may be absent on marked-only
    paths), design-system window wording; PR body names the mark-only paths and the earlier-day gap.

**Size.** Server about 200 production lines, till about 200, plus tests. Watcher cleared a medium
item in lane B (21:57).
