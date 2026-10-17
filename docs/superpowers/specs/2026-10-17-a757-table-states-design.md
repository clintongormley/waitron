# A757 — Table states: the lifecycle, how each state is shown, and retiring the Tables tab

Status: **design, waiting for the owner's answers (questions Q1–Q6 at the end).** Nothing is built
until they are answered. Backlog entry: `docs/backlog.md` "A757" and
[its detail](../../backlog/till.md#a757-table-states-review-the-lifecycle-then-retire-the-tables-tab).
Mock-ups: `docs/backlog/mockups/a757-table-states/` (light theme; Q3 and Q4 also in dark, `-dark.png`;
generated from HTML drawn with the till's own colour tokens, not screenshots of the running till).

Already decided by the owner (2026-10-16), not reopened here:

- The Tables tab in Venue settings goes.
- Optional states are switched on or off per department, in the department dialog's Service tab
  (A756), "Needs clearing" among them.
- An optional state is one the code understands — it knows when the state can appear and what
  clears it — not a label a waiter puts on any table ("maybe"; this review confirms it, §4).
- A773 adds a Requested state (the waiter fired a dish, the pass has not released it yet); the
  held mark counts it.

All file references are to `main` at `4e18f2a28`.

---

## 1. What a table goes through today

A table has two layers. **Who is at it** is one state at a time. **What is happening at it** is any
number of signals at once, while a party is seated.

### 1.1 Who is at it — one at a time

```
             seat (walk-in or a booking)            Finish table / unpaid departure /
  ┌──────┐ ───────────────────────────► ┌────────┐  move away / split away   ┌────────────────┐
  │ Free │                              │ Seated │ ────────────────────────► │ Needs clearing │
  └──────┘ ◄─────────────────────────── └────────┘   (only when the venue    └────────────────┘
     ▲       same, when "Needs clearing"     │        has it switched on)            │
     │       is switched off                 │                                       │
     └───────────────────────────────────────┼─────────── Mark cleared ──────────────┘
                                             │
                            Bill requested ──┤ (a mark on the party, cleared when nothing is owed)
                            Paid ────────────┘ (worked out: nothing owed, no open bill)
```

| State | Stored where | What moves a table into it | What moves it out |
|---|---|---|---|
| **Free** | nothing: no open party, no clearing mark | Mark cleared; or leaving, when clearing is off | Seating |
| **Reserved** | not a table state: the floor shows the next booking ("Reserved 21:00") beside Free, 30 minutes' grace (`packages/bookings/src/floor.ts:7,25-57`) | a booking for the table | the booking is seated, cancelled or missed |
| **Seated** | a `party_tables` row with `left_at` empty (`packages/db/src/schema/parties.ts:76-101`) | `POST /api/tables/:id/seat` → `seatTable` (`apps/server/src/parties.ts:95-116`) → `openTab`, which refuses a table that is inactive, joined, needs clearing or already open (`apps/server/src/working-order.ts:1399-1419`); seating a booking calls the same `seatTable` (`packages/bookings/src/bookings.ts:237-245`) | the party leaves (below) |
| **Bill requested** | `parties.bill_requested_at` (`parties.ts:46`) | the Bill requested action, `POST /api/parties/:id/bill-request` (`apps/server/src/bill-request.ts:29-55`) | nothing left to pay (`clearBillRequestIfPaid`, `bill-request.ts:63-91`), or the action again |
| **Paid** | not stored: a party with no open bill and nothing outstanding (`apps/till/src/widgets/table-details-sheet.ts:23-27`) | the last payment | the party leaves |
| **Needs clearing** | `dining_tables.needs_clearing_since` (`packages/db/src/schema/dining-tables.ts:24`) | the party leaves while the venue's switch is on: Finish table, unpaid departure, moving guests away, combining parties, splitting a group — all through `leaveForClearing` (`parties.ts:657-668`) | Mark cleared, `POST /api/tables/:id/cleared` (`parties.ts:767-774`), which does not refuse a table that needs no clearing; also a floor reset, a split, or guests passed to the table (`floor-today-reset-table.ts:116`, `floor-today-split-group.ts:153`, `floor-today-store.ts:404`, `floor-today-parts.ts:86`) |
| **Taken off today** | `floor_today_tables.taken_off` (`packages/db/src/schema/floor-plans.ts:259`) | Take off (`floor-today-store.ts:675-691`), refused for a table in use | Put back |
| **Joined** | three kinds: a party across tables, today's merge, and a saved joined table (`table-actions.ts:143-173`, `floor-today-merges.ts:146`, `packages/db/src/joined-parts.ts:47`) | Join / merge | Split, or the party leaving |

The switch "Needs clearing" is one value for the whole venue, `service_settings.clearing_workflow`
(`packages/venue-service/src/schema/settings.ts`), read once each time a party leaves
(`parties.ts:663`). Switching it off does not clear tables already marked
(`packages/venue-service/src/kitchen-notices.ts:340-345`).

### 1.2 What is happening at it — signals while seated

Worked out by the server on every floor read (`apps/server/src/table-signals.ts:214-262`; types in
`packages/shared/src/table-signals.ts:7-21`). The till reads the floor every 15 s in map view
(`apps/till/src/screens/till-floor-screen.ts:701-711`).

| Signal | When | Shown today (list card) |
|---|---|---|
| `take_order` | the party's bills have no lines and no open draft | chip "Take order", blue border |
| `unsent_draft` | a draft not sent yet | dashed amber badge per draft |
| `ready` | a fired dish is ready at a station (counted per station) | chip "Grill: 2 ready", green border |
| `long_wait` warm / overdue / forgotten | the worst band over unserved **fired** dishes, each against its own station's limits — 5 / 10 / 15 min by default (`apps/server/src/table-signals.ts:72-78,121`; `packages/db/src/schema/kitchen-timing.ts:7-37`) | chips "Waiting" (amber), "Overdue" (red). The card's outline and its "Forgotten" badge come from a **different** reckoning, `timingBand` (`apps/server/src/working-order.ts:7702-7717`), which counts **held** dishes too: warm draws a **blue** inner outline (`till-floor-screen.ts:343-345` — the comment there says amber), overdue a red one, forgotten a red outline **flashing** once a second plus a filled red "Forgotten" badge |
| `release_due` | the next held group has a reminder time, which may still be ahead (`apps/server/src/order-groups.ts:1104-1137`; `packages/shared/src/table-signals.ts:17`) | badge "Time to fire", amber border — drawn only once that time has come (`till-floor-screen.ts:713-715`) |
| `held_unavailable` | a held group holds something no longer sellable | chip "Unavailable: …", red border |
| `bill_requested` | as above | chip "Bill requested", filled purple |
| `needs_clearing` | as above | a card of its own with Mark cleared |

**Not shown today:** a table with held dishes whose reminder is not yet due looks like a table
with nothing held — unless a held dish has become unavailable, or its age turns the card's outline
amber or red. Because `timingBand` counts held dishes, **a course held on purpose for 15 minutes
makes the card flash "Forgotten" with no wait chip beside it** — the open point at
`docs/backlog/till.md:2288-2292` ("decide whether `timingBand` should also count only dishes sent"). The floor map (`wt-floor-map`) draws only a fill (free, reserved,
seated, bill, clearing — `apps/till/src/state/floor-map.ts:13-21`) and one dot (forgotten flashing
red, beating ready green, `floor-map.ts:23-26`).

### 1.3 What planned work adds

- **A773-2 — Requested** (spec `2026-10-16-a773-courses-and-groups-design.md:69-72, 381-385`):
  a fired dish for a station that waits for the pass, until the pass releases it. A773 also removes
  "En route" (`:405-411`) and makes finishing a table with held or requested dishes ask first
  (`:518-522`). Its own line for A757 (`:540`): "the floor's held-items mark should count requested
  lines as well as held ones."
- **A508 — the table's QR code** (`docs/backlog/till.md:537-557`): a guest can call a waiter, or ask
  for the bill. Not queued to a lane. It would add one signal (**Waiter called**) and reuse **Bill
  requested** for the guest's request.
- **A738 — the counter's Waiting tab "flashes while it holds an order"** (`docs/backlog/till.md:1914-1915`).
  Not built. No shared pulse exists today: the only repeating animations are the 1 s forgotten flash,
  copied in `till-floor-screen.ts:358-366`, `station-queue.ts`, `till-expo-screen.ts` and
  `wt-table-token.ts`, and the map's own `dot-flash` (`wt-floor-map.ts:351`).

---

## 2. Venue-made statuses, and what becomes of them

Today a venue makes up labels with a colour (`table_service_statuses`,
`packages/db/src/schema/table-service-statuses.ts:9-25`). A waiter puts one on a table from the
table screen (`apps/till/src/screens/till-table-order-screen.ts:4429-4455`); a table carries one
(`dining_tables.status_id`); the floor list shows it as a bordered chip with a dot. The code does not
know what any label means. It **clears** the label when a party is seated (`working-order.ts:1429`),
when a party leaves (`parties.ts:666`), on a move (`table-actions.ts:115`), and when a party closes,
through a database trigger (`packages/db/drizzle/0139_floor_retire_recreate_table_triggers.sql`).

What venues have made:

- **The demo seed:** VIP, "Allergy at this table", Birthday (`apps/server/scripts/demo-seed/floor.ts:198-202`).
- **Santet (the owner's real data):** none. Read from its database on 2026-10-17 (a closed copy,
  last written 13 Oct): `table_service_statuses` has no rows, none of its 24 tables carries one, and
  "Needs clearing" is off.

Each demo label is a fact about the **guests**, not a state of the **table**, and each already has,
or is getting, a home the code understands:

| Label | Its home |
|---|---|
| Allergy | A669, an allergy at the table: the till asks "Any allergies at this table?" at the first Send, and the floor gets its own allergy signal (`docs/backlog.md` A669, spec `2026-10-14-a669-allergy-at-the-table-design.md`) |
| VIP, Birthday | the party's name, which the floor card already shows (`till-floor-screen.ts:2076`) |

**Recommendation (Q1): retire venue-made statuses entirely** — the table, the column, the trigger,
the till's status section and floor chip, the dashboard screen, the demo seed's three labels and the
configuration transfer's copy. Waitron is not live, so nothing is carried forward
(CLAUDE.md §3, "No backwards-compatibility … until Waitron is in production").

## 3. The lifecycle as proposed

The two layers stay. Changes are marked **new** or **changed**.

**Who is at it:** Free → Seated → (Needs clearing, when on for the table's department) → Free.
Taken off and Joined stay as they are. Reserved stays a note about the next booking, not a state.

**What is happening at it** (any number at once, while seated), in the order a waiter cares about:

| Signal | Optional? | Appears when | Clears when |
|---|---|---|---|
| Take order | always | seated, nothing ordered | something is ordered |
| Not sent | always | a draft not sent | sent or discarded |
| **Held (new mark)** | always | any held dish, **or a requested one (A773-2)** | none left held or requested |
| Time to fire | always | the next held group is due (today's rule) | fired, snoozed |
| Waiting → Overdue → Forgotten | always | as today | served |
| Ready | always | as today | served |
| Unavailable | always | as today | removed or available again |
| Bill requested | always | the Bill requested action (or, with A508, the guest) | nothing owed |
| **Waiter called** (A508, later) | **per department**, with A508's QR switch | a guest taps Call a waiter | a waiter opens the table or taps Done |
| Paid | always | nothing owed, no open bill | the party leaves |
| Needs clearing | **per department** | the party leaves | Mark cleared |

So the only optional state today is **Needs clearing**; A508 adds **Waiter called** to the same
place when it is built. "Bill requested" stays always available: it appears only when someone taps
it, and clears itself when the bill is paid, which is the behaviour the owner described.

**A hand-set "Held for a guest" state** (a free table kept free, raised by A267,
`docs/backlog/till.md:1284-1290`) is not proposed; it is Q2.

### 3.1 Needs clearing, per department

The switch moves from `service_settings.clearing_workflow` to the department (the department
dialog's Service tab, A756, section "Table states"). A table's department is its zone's
(`zone_service_policies.department_id`, `packages/venue-service/src/schema/service.ts:51-80`).
`leaveForClearing` reads the switch of each table's own department instead of one venue value —
when a party spanning two departments leaves, each table follows its own. The build plan settles what
a table whose zone has no department row reads (expected: off). Not live, so the venue value is
dropped, not copied (A756's own note, `docs/backlog/kitchen.md:212-214`).

## 4. How each state is shown

Board: `docs/backlog/mockups/a757-table-states/`. One picture per question.

### 4.1 Held items (Q3)

Every table with held or requested dishes shows a **Held** chip with the count of held items:
"Held 3". It is quiet (neutral border), so it reads as information, not a call to act. When the next
group falls due, the chip is replaced by today's **Time to fire** badge, made stronger: filled amber
and pulsing (§4.2). On the floor map, where only a dot fits, a table with held items gets a small
pause mark in its corner; a due one pulses.

**Held dishes stop counting as late.** The card's outline and Forgotten badge follow the same
reckoning as the chips — fired dishes only — so a course held on purpose shows "Held", never
"Forgotten". This settles the open point at `docs/backlog/till.md:2288-2292`.

### 4.2 Late orders pulse (Q4)

One pulse for the whole till, defined once in `packages/ui` (a motion token beside
`--wt-duration-disclosure`, design-system.md:428-454), used by the floor, A738's Waiting tab and
A773's Sent box: the outline brightens and fades over 2 s, never a colour or motion behind text.

- **Warm (5 min):** no pulse. Its outline changes from blue to amber, fixing today's mismatch with
  its own chip.
- **Overdue (10 min):** red outline, **pulses**.
- **Forgotten (15 min):** red outline, pulses, plus the filled red "Forgotten" badge it has today.
- **Time to fire:** pulses (§4.1).
- **Reduced motion:** nothing moves. Overdue keeps a steady thick red outline; Forgotten fills the
  card's edge red. The words on the chips carry the difference too, as today.

### 4.3 Item counts in the order lists (Q5)

Held orders' rows read "4 · €24.50", where 4 counts **lines**, extras' own lines included
(`working-order.ts:4414`). Proposed:

> **#12 Terrace 4** — 6 items · 2 held · 3 waiting · 1 ready · €24.50

- **Items** = what was ordered: a counted dish by its quantity, a weighed dish as one, extras not
  counted.
- Then each state with at least one item, in the order a dish moves: not sent, held (including
  requested), waiting (in the kitchen), ready. Served items are the rest and are not listed.
- In **Held orders**, **Waiting** and **Transfers**. Not on the **Pass**, whose card already lists
  every item with its state, and not in the **payment panel**, which shows no order row
  (`apps/till/src/widgets/tender-pay.ts:1181-1228`). A765 adds the table's name to the same rows and
  builds to this.

### 4.4 Two chips that look alike (Q6)

The backlog's open point (`docs/backlog/till.md:2288-2296`): "Take order" looks like "Reserved"
(both a blue border), and "Bill requested" like "N en camino" (both filled). A773 removes En route,
which settles the second. For the first: **Reserved takes the map's reserved colour** (a pale amber
fill, `--wt-color-table-reserved`), so the list card and the map say Reserved the same way.

## 5. The Tables tab goes

Once Needs clearing has moved (§3.1) and venue-made statuses are retired (§2), the tab is empty and
goes: `VENUE_SETTINGS_TABS` (`apps/dashboard/src/screens/venue-settings-screen.ts:11-16`), the core
panel `{ key: "statuses", tab: "tables" }` (`apps/dashboard/src/dashboard-app.ts:309-317`) and the
venue-service panel `venue-service-tables` (`packages/venue-service/src/dashboard/index.ts:153-171`).
The open note that its colour-field labels are clipped to an ellipsis at 390 and 1280 px
(`docs/backlog.md:4020`; "C…" in `docs/backlog/till.md:1433`) goes with it.

## 6. Build slices (after the answers; the BUILD waits for A756 to land)

Each slice is one pull request one implementer can finish well under ~100 tool calls.

1. **Needs clearing per department** — the department column (migration), `leaveForClearing` reads
   each table's department, the switch in A756's Service tab, the venue switch and the Tables tab's
   clearing panel go. FULL review (migration).
2. **Retire venue-made statuses** (if Q1 = A) — the table, column and trigger (migration; regenerate,
   never hand-edit), routes and their error codes (`status.not_found`, `status.inactive`, `status.label_taken`), the till's
   status section and chip, the dashboard screen, the Tables tab, the live subscription name
   `table_service_statuses` (`apps/dashboard/src/api/live-queries.ts:520`), the demo seed, the
   configuration transfer (`packages/db/src/configuration-transfer.ts:47`) and the two data-retention
   inventories that list it (`docs/superpowers/specs/2026-10-16-a664-*`). FULL review.
3. **The held mark** — list card, unplaced token and map; counts requested lines once A773-2 stores
   them (until then, held only); `timingBand` counts fired dishes only. LIGHT review.
4. **One pulse** — the motion token and keyframes in `packages/ui`, applied to overdue, forgotten
   and Time to fire on card, token and map dot; warm's outline to amber; Reserved's colour (Q6).
   LIGHT review.
5. **Item counts by state** — the server sends each order's counts by state with the held-orders
   summary and the Waiting and Transfers lists; the till rows show them. FULL review (a till read
   path).

Order: 1 and 2 need A756's Service tab and touch the same tab, so they go in that order; 3, 4 and 5
are independent of A756 and of each other.

---

## Owner questions

Each is one decision, with a recommended default. Mock-ups named in brackets.

**Q1. Venue-made statuses (VIP, Allergy, Birthday…)** [01-made-up-statuses.png]
- **A (recommended):** retire them. Allergies go through A669; VIP or Birthday go in the party's
  name. Santet has none.
- **B:** keep them, as notes on the table screen only, managed from the Floor plan page instead of a
  Tables tab.

**Q2. A hand-set "Held for a guest" on a free table** [02-lifecycle.png]
- **A (recommended):** not now. A booking already shows Reserved; a quick hold is a booking with no
  name.
- **B:** yes, an optional state per department: set on a free table, cleared when seated or after a
  time the venue sets.

**Q3. Held dishes on the floor** [03-held-mark.png]
- **A (recommended):** a quiet "Held 3" chip whenever anything is held (or at the pass); when due,
  a filled amber "Time to fire" that pulses. On the map, a small pause mark; due pulses. Held
  dishes stop counting as late, so a course held on purpose never shows "Forgotten" (today it can).
- **B:** as today: nothing until the reminder is due.

**Q4. Which late orders pulse** [04-late-orders.png]
- **A (recommended):** overdue and forgotten pulse; warm does not, and its outline turns amber.
- **B:** only forgotten pulses (today's flash, made the shared pulse).
- **C:** all three pulse.

**Q5. What an order-list row counts** [05-order-rows.png]
- **A (recommended):** "6 items · 2 held · 3 waiting · 1 ready · €24.50" — items as ordered,
  then each state that has any; served not listed. In Held orders, Waiting and Transfers.
- **B:** the total items only: "6 items · €24.50".

**Q6. Reserved and Take order look alike** [06-chips.png]
- **A (recommended):** Reserved takes the map's pale amber reserved colour; Take order keeps its
  blue border.
- **B:** leave them.
