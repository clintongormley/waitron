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

**Server (one rule, one helper).** `refuseLateUnsent(tx, orderId, dishLineIds, lateSend)`:
1. Of the dish lines about to fire, keep those with no late mark already (`readLateSendMarks`).
2. Each one's menu: its own `working_line_contexts.menu_id`; a set lunch's course takes its lunch's
   recorded menu (the rule `priceOrderLines` already uses through `RECORDED_OFFER`).
3. Late = that menu is in the department's `endedMenus` now, not in `orderableMenuIds`, and the
   product is not also sold in a running menu (`productsOfferedIn`) — the same three tests as entry.
4. Late without a matching `lateSend` → `menu_period.ended` with the same params as today
   (`menus`, `menuItemIds`, `needsManager`), so the till's window code needs no new reading.
   With one → `lateSend.confirm`, then write `late_period_name`/`late_confirmed_by` on the dish's
   context and its unsent extras' contexts BEFORE `fireLines`, so the ticket prints the mark.
Called from `placeOrder`, `sendLines` and `fireOrderLines`'s fresh lines; the three routes parse
`lateSend` and run through `withLateSendCheck` like the edit routes already do.

**Till.** Place, Send, Fire course and Fire line catch `menu_period.ended` and open the existing
window listing the stored dishes being sent (matched by offer id among the lines sent, as the
per-dish edit flow already does with `extrasAddedTo`, till-app.ts:16374). "Station agreed — send"
retries with `lateSend`; the secondary choice becomes "Don't send them": closes the window and
leaves the dishes stored, unsent (nothing is removed). API client: `placeOrder`, `sendLines`,
`fireGroup`, `fireHeldLine` gain an optional `lateSend`.

**Paying a saved counter bill and moving a bill to a table do not ask** (watcher 21:57): a payment
is never refused once money may have moved, and a move is not a choice to send. Both still MARK a
late dish (period name, no confirmer): `late_confirmed_by` is nullable and nothing reads it
(`git grep late_confirmed_by` outside migrations and fixtures: only the schema and the context
writer, `packages/venue-service/src/operations.ts:1445-1446`), and the ticket's `afterPeriod` reads
only `late_period_name` (`readLateSendMarks`, operations.ts:1311). The same helper runs in "mark only"
mode on `fireDishesAtPayment` (`apps/server/src/bill-payments.ts:845`) and `move-bill.ts:625`.

**Tests.** Server: one case per path (late dish refused `menu_period.ended`; with `lateSend` it
fires and its ticket line carries the mark; a held-course release never asks; an also-sold product
and a dish marked at entry never ask; a set lunch's course chosen late asks). Till browser: the
window opens on a refused Place and a refused Send, Agreed retries with `lateSend`, Don't send
leaves the dishes. Deletion control on the helper call in each path.

**Tasks (implementers, each well under 100 tool calls).**
1. Server: venue-service gains a writer that sets the mark on existing contexts; `refuseLateUnsent`
   (ask and mark modes) in apps/server; wired into `placeOrder`, `sendLines`, `fireOrderLines`
   (fresh lines) with the place, lines/send, groups fire and fire-line routes parsing `lateSend`
   through `withLateSendCheck`; mark-only mode at payment and move. Server tests per path.
2. Till: API client `placeOrder`, `sendLines`, `fireGroup`, `fireHeldLine` take optional `lateSend`;
   listing stored dishes from a refusal (`state/late-send.ts` `refusedLines` / `lateSendAsked` gain a
   way to list stored lines by id); the four call sites open the window; "Don't send them" wording
   (new purpose or string, EN/ES). Browser tests.
3. Docs: kitchen guide EN/ES (`kitchen-service.md`), `docs/developers/conventions-data.md` beside the
   A1085 rule, `design-system.md` window wording; PR body names the paths that only mark.

**Size.** Server about 120 production lines + tests; till about 150 production lines (four call
sites, one listing helper, one new string) + browser tests. Larger than a small item.
