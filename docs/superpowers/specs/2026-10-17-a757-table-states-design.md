# A757 — Table states: the lifecycle, how each state is shown, and retiring the Tables tab

Status: **answered (Q29–Q34 all A, 2026-10-17); slices 1, 2 and 7 built 2026-10-19, slices 3 and 4 built 2026-10-20; slices 5, 6 and 8 left (§11).**
Backlog entry: `docs/backlog.md` "A757" and
[its detail](../../backlog/till.md#a757-table-states-review-the-lifecycle-then-retire-the-tables-tab).

**2026-10-19:** Q29–Q34 were all answered A by the owner on 2026-10-17, and the build depends only
on A756's first pull request, #1852, which landed; slice 1 is built by
`docs/superpowers/plans/2026-10-19-a757-1-clearing-per-department.md`.

Pictures: `docs/backlog/mockups/a757-table-states/` (01–11; 03, 04, 07, 08, 09 and 11 also in dark,
`-dark.png`). They are drawn in HTML with the till's own colour values, not screenshots of the
running till; the symbols on them (⏱ ▶ ⏸ 🛎 ✓ 🍽 € 🧹 ⊘) stand in for icons the build draws with
`wt-icon`, which takes 16×16 shapes registered by name
(`packages/ui-core/src/components/wt-icon.ts:9-13`). The generator is kept outside the repository.

The first version of this design asked six questions, numbered Q1–Q6 here and Q15–Q20 in the
owner's list. They are now decisions, given in the owner's numbering.

## Decided

Before this design (owner, 2026-10-16):

- The Tables tab in Venue settings goes.
- Optional states are switched on or off per department, in the department dialog's Service tab
  (A756), "Needs clearing" among them.
- An optional state is one the code understands — it knows when the state can appear and what
  clears it — not a label a waiter puts on any table.
- A773 adds a Requested state (the waiter fired a dish, the pass has not released it yet); the
  held mark counts it.
- "Bill requested" stays always available: it appears only when someone taps it and clears when the
  bill is paid. A508's "Waiter called" joins the per-department switches when A508 is built.

The owner's answers (2026-10-17):

- **Q15 (was Q1): A.** Venue-made statuses (VIP, Allergy, Birthday) are retired. A birthday or VIP
  goes in the party's name; an allergy goes through A669. Section 2.
- **Q16 (was Q2): A.** No hand-set "Held for a guest" state now; a quick booking covers it.
- **Q17 (was Q3): A, plus a countdown.** A quiet "⏸ Held N" chip whenever anything is held; a
  filled amber "Time to fire" that pulses when due; held dishes stop counting as late. **Added by
  the owner:** the table shows how long until Time to fire — "⏸ Held 2 · fire in 4 min" — on the
  card and on the map. Section 5.1, picture 03.
- **Q18 (was Q4): A, at two speeds.** Overdue and Forgotten pulse; Waiting does not, and its outline
  turns amber. **Changed by the owner:** Forgotten pulses faster than Overdue. Reduced motion: nothing
  moves; Overdue a thick red outline, Forgotten a red edge. A738's Waiting tab uses the same two
  speeds. Section 5.2, picture 04.
- **Added with Q18:** a zone tab for a zone not on screen carries the most urgent state of any table
  in it, pulsing at that state's speed; "Time to fire" and check-back reminders count too.
  Section 7, picture 08.
- **Q19 (was Q5): A.** An order-list row reads "6 items · 2 held · 2 ready · €58.20" in Held orders,
  Waiting and Transfers. Section 5.3, picture 05.
- **Added while answering Q18–Q20: service steps.** The owner asked for check-back reminders ("mains
  were delivered 20 minutes ago — check on the table for drinks or desserts"), then widened it:
  "When they're seated do we need statuses like setup table (bread, menus, water). Maybe they're
  optional and can be deleted. What's the difference between seated and take order? There may be
  several take order moments e.g. after the mains, after desserts, check on drinks. We need a
  separate status for no attention needed." Section 8 (steps) and section 9 (nothing needed),
  pictures 10 and 11.
- **Added with the steps:** "I'm not sure if these small dots will be visible enough on a handheld.
  Perhaps we should use the whole table to indicate status." The map shows a table's most urgent
  state on the whole table, with a cue that does not rely on colour. Section 6, picture 09.
- **Q20 (was Q6): A.** "Reserved" takes the map's pale amber; "Take order", now a service step, keeps
  a step's look. Section 5.4, picture 06.
- **One order of precedence** decides the table's colour on the map, its card and the zone tab
  (the owner, with the zone tabs and again with the whole-table map). Section 4, picture 07.

The owner's answers (2026-10-17), second round:

- **Q29: A.** Set up (when seated), Take order (2 min after Set up), Anything else? (10 min after
  everything is served). The venue edits or deletes them.
- **Q30: A.** Any order sent after a step started clears it; Done is for when the guests want nothing.
- **Q31: A.** A fifth start, "every N minutes since the last order", for venues that want it; not in
  the starter set.
- **Q32: A.** A seated table that needs nothing is pale blue with ✓ ("Nothing needed"); solid blue
  means "go to this table".
- **Q33: A.** Ready does not pulse on the map; only Overdue, Forgotten and Time to fire move.
- **Q34: A.** The order of precedence as drawn in section 4.

All file references are to `main` at `5ade0d4f5`.

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
| **Seated** | a `party_tables` row with `left_at` empty (`packages/db/src/schema/parties.ts:76-101`) | `POST /api/tables/:id/seat` → `seatTable` (`apps/server/src/parties.ts:95-116`) → `openTab`, which refuses a table that is inactive, joined, needs clearing or already open (`apps/server/src/working-order.ts:1396-1420`); seating a booking calls the same `seatTable` (`packages/bookings/src/bookings.ts:237-245`) | the party leaves (below) |
| **Bill requested** | `parties.bill_requested_at` (`parties.ts:46`) | the Bill requested action, `POST /api/parties/:id/bill-request` (`apps/server/src/bill-request.ts:29-55`) | nothing left to pay (`clearBillRequestIfPaid`, `bill-request.ts:63-91`), or the action again |
| **Paid** | not stored: a party with no open bill and nothing outstanding (`apps/till/src/widgets/table-details-sheet.ts:23-27`) | the last payment | the party leaves |
| **Needs clearing** | `dining_tables.needs_clearing_since` (`packages/db/src/schema/dining-tables.ts:24`) | the party leaves while the venue's switch is on: Finish table, unpaid departure, moving guests away, combining parties, splitting a group — all through `leaveForClearing` (`parties.ts:657-668`) | Mark cleared, `POST /api/tables/:id/cleared` (`parties.ts:767-774`), which does not refuse a table that needs no clearing; also a floor reset, a split, or guests passed to the table (`floor-today-reset-table.ts:116`, `floor-today-split-group.ts:153`, `floor-today-store.ts:404`, `floor-today-parts.ts:86`) |
| **Taken off today** | `floor_today_tables.taken_off` (`packages/db/src/schema/floor-plans.ts:259`) | Take off (`floor-today-store.ts:675-691`), refused for a table in use | Put back |
| **Joined** | three kinds: a party across tables, today's merge, and a saved joined table (`table-actions.ts:143-173`, `floor-today-merges.ts:146`, `packages/db/src/joined-parts.ts:47`) | Join / merge | Split, or the party leaving |

The switch "Needs clearing" is one value for the whole venue, `service_settings.clearing_workflow`
(`packages/venue-service/src/schema/settings.ts`), read once each time a party leaves
(`parties.ts:663`). Switching it off does not clear tables already marked
(`packages/venue-service/src/kitchen-notices.ts:340-345`).
**2026-10-19:** slice 1 replaced this with each department's switch, `departments.needs_clearing`
(§3.1); `kitchen-notices.ts` no longer holds it.

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
| `release_due` | the next held group has a reminder time, which may still be ahead (`apps/server/src/order-groups.ts:1103-1139`; `packages/shared/src/table-signals.ts:17`) | badge "Time to fire", amber border — drawn only once that time has come (`till-floor-screen.ts:713-715`) |
| `held_unavailable` | a held group holds something no longer sellable | chip "Unavailable: …", red border |
| `bill_requested` | as above | chip "Bill requested", filled purple |
| `needs_clearing` | as above | a card of its own with Mark cleared |

**Not shown today:** a table with held dishes whose reminder is not yet due is not marked as holding
anything. Its held dishes are counted in the card's "N to serve" badge with every other unserved
dish (`pending_to_serve`, `apps/server/src/working-order.ts:7686`), and they turn its outline blue,
then red, as they age — but nothing says they are held unless one has become unavailable. Because `timingBand` counts held dishes, **a course held on purpose for 15 minutes
makes the card flash "Forgotten" with no wait chip beside it** — the open point that Task 10 left in `docs/backlog/till.md` ("decide whether `timingBand` should
also count only dishes sent"), now marked decided there. The floor map (`wt-floor-map`) draws only a fill (free, reserved,
seated, bill, clearing — `apps/till/src/state/floor-map.ts:13-21`) and one dot in the table's corner
(forgotten red, beating ready green, `floor-map.ts:23-26`). Both dots blink once a second unless
motion is reduced: the blink is set on every dot, not only the red one
(`packages/ui/src/components/wt-floor-map.ts:341-377`).

**2026-10-20:** slice 3 marks a table holding dishes on the list card and the unplaced token, and
`timingBand` counts fired dishes only; see §5.1.

### 1.3 What planned work adds

- **A773-2 — Requested** (spec `2026-10-16-a773-courses-and-groups-design.md:69-72, 381-385`):
  a fired dish for a station that waits for the pass, until the pass releases it. A773 also removes
  "En route" (`:405-411`) and makes finishing a table with held or requested dishes ask first
  (`:518-522`). Its own line for A757 (`:540`): "the floor's held-items mark should count requested
  lines as well as held ones."
- **A508 — the table's QR code** (`docs/backlog/till.md:537-557`): a guest can call a waiter, or ask
  for the bill. Not queued to a lane. It would add one signal (**Waiter called**) and reuse **Bill
  requested** for the guest's request.
- **A738 — the counter's Waiting tab "flashes while it holds an order"** (`docs/backlog/till.md:1923-1924`).
  Not built. No shared pulse exists today: apart from the loading spinner (`wt-spinner`), the only
  repeating animations are the 1 s forgotten flash,
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

**Decided (Q15, owner 2026-10-17: A): retire venue-made statuses entirely** — the table, the column, the trigger,
the till's status section and floor chip, the dashboard screen, the demo seed's three labels and the
configuration transfer's copy. Waitron is not live, so nothing is carried forward
(CLAUDE.md §3, "No backwards-compatibility … until Waitron is in production").
**2026-10-19:** built by slice 2
(`docs/superpowers/plans/2026-10-19-a757-2-retire-venue-statuses.md`); the Tables tab is gone.

## 3. The lifecycle after the answers

Picture 02. The two layers stay.

**Who is at the table:** Free → Seated → (Needs clearing, when on for the table's department) →
Free. Taken off and Joined stay as they are. Reserved stays a note about the next booking, not a
state. No hand-set "Held for a guest" (Q16).

**What the table needs** is any number of things at once while a party is seated (plus Needs
clearing once it has left). Section 4 lists them in order of urgency.

**Seated and Take order are different things, and the revision says so.** Seated is who is at the
table: a `party_tables` row with no `left_at` (`packages/db/src/schema/parties.ts:76-101`). Take order
is today a fixed prompt worked out on every floor read: an open party whose bills have no line and
which has no open draft (`apps/server/src/table-signals.ts:218-220`, described at
`packages/shared/src/table-signals.ts:8-9`). After the first order nothing prompts a waiter to go
back to the table. In this revision Take order becomes one of the venue's **service steps**
(section 8), and Seated stops implying "something to do": a seated table with nothing to do shows
**Nothing needed** (section 9).

### 3.1 Needs clearing, per department

Unchanged from the first version. The switch moves from `service_settings.clearing_workflow`
(`packages/venue-service/src/schema/settings.ts:18`) to the department (the department dialog's
Service tab, A756, section "Table states"). A table's department is its zone's
(`zone_service_policies.department_id`, `packages/venue-service/src/schema/service.ts:56`).
`leaveForClearing` reads the switch of each table's own department instead of one venue value —
when a party spanning two departments leaves, each table follows its own. The build plan settles
what a table whose zone has no department row reads (expected: off). Settled 2026-10-19 by the
slice 1 plan: off — such a table drops out of the join from table to department
(`docs/superpowers/plans/2026-10-19-a757-1-clearing-per-department.md`, Decision 3). Not live, so the venue value is
dropped, not copied (A756's own note, `docs/backlog/kitchen.md:217-218`).

## 4. One order of precedence

Picture 07. When a table needs several things at once, **the highest one in this list** decides:

- the table's colour and cue on the floor map (section 6);
- the card's outline and which chip comes first (the card still shows every chip it has);
- the zone tab, when the table's zone is not on screen (section 7);
- the order screen's status pin, which today takes the map's fill and dot (`statusPin`,
  `apps/till/src/state/floor-map.ts:104-111`, used at `apps/till/src/widgets/table-status.ts:130`).

| # | State | Map: the whole table | Cue (not colour) | Moves | Reduced motion |
|---|---|---|---|---|---|
| 1 | **Forgotten** (oldest fired dish past the station's forgotten time, 15 min by default) | red | ⏱ Forgotten | fast pulse, 1 s | red table; card red edge |
| 2 | **Overdue** (10 min) | its own colour, thick red outline | ⏱ Overdue | slow pulse, 2 s | thick red outline |
| 3 | **Unavailable** (a held dish can no longer be sold) | amber | ⊘ Out | no | — |
| 4 | **Time to fire** (the next held group is due) | amber | ▶ Fire | slow pulse, 2 s | amber table; card thick amber outline |
| 5 | **Waiter called** (A508, later) | purple | 🙋 Called | no | — |
| 6 | **Bill requested** | purple (today's bill colour) | € Bill | no | — |
| 7 | **Ready** (dishes ready to take out) | green | 🍽 and the count | no (Q33) | — |
| 8 | **A service step** (section 8) | seated blue | 🛎 and the step's name | no | — |
| 9 | **Not sent** (a draft not sent) | seated blue | ✎ Not sent | no | — |
| 10 | **Waiting** (5 min) | its own colour, amber outline | ⏱ and the minutes | no | — |
| 11 | **Needs clearing** (party gone) | dashed amber outline | 🧹 Clear | no | — |
| 12 | **Held, not due** | Nothing needed's colour | ⏸ and the minutes left | no | — |
| 13 | **Nothing needed** (section 9) | pale seated blue | ✓ | no | — |
| 14 | **Reserved** (free, a booking within 30 min) | today's reserved colour | the booking's time | no | — |
| 15 | **Free** | today's free colour | none | no | — |

Why this order: 1–4 are things going wrong or due now in the kitchen, which a waiter must act on
before the food suffers; 5–6 are guests waiting for staff; 7 is food waiting at the pass; 8–9 are
the waiter's own next jobs; 10 is a warning with nothing yet to do; 11 is an empty table to reset;
12–15 need nothing now. The owner is asked to confirm it (Q34).

Two colours are shared on purpose and told apart by their cue: Unavailable and Time to fire (both
amber: something about the held course needs the waiter), and Waiter called and Bill requested
(both purple: the guest asked). **Needs clearing changes from a filled amber table to a dashed amber
outline**, because in the dark theme its fill and Time to fire's amber are almost the same colour —
`--wt-color-warning` `#f2b24c` and `--wt-color-table-clearing` `#f5b34a`
(`packages/ui-core/src/tokens/colors.css:147,233`) — and the dashes also say "out of use until
cleared" without colour.

**Merged and joined tables** take the highest state of their members, as the map's fill and dot do
today (`combinedStatus`, `apps/till/src/state/floor-map.ts:32-40`).

**Allergy (A669)** is not in the list: its red "!" on the map (A669's spec,
`docs/superpowers/specs/2026-10-14-a669-allergy-at-the-table-design.md:172`) is a fact about the
guests that stays shown whatever the table's state, and it does not colour a zone tab.

**2026-10-20:** built by slice 4 (plan `docs/superpowers/plans/2026-10-20-a757-4-precedence-pulses.md`)
for the list card: the till ranks a table's states with `tableStates`
(`apps/till/src/state/table-precedence.ts`), and the card's outline and the order of its marks
follow it. Waiter called (row 5) is not built and has no place in the ranking yet. The unplaced
token rings from its own timing band and due reminder only. The map, the zone tabs and the order
screen's status pin are slice 5's.

## 5. How each state is shown on the card

### 5.1 Held dishes and the countdown (Q17)

Picture 03. Every table with held dishes (and, once A773-2 stores them, requested ones) shows a
quiet chip: **"⏸ Held 2"**. Once the due time is known it counts down: **"⏸ Held 2 · fire in 4
min"**. When the time comes the chip becomes the filled amber **"▶ Time to fire"** and the card's
outline pulses slowly (section 5.2). Spanish: "⏸ 2 retenidos · marchar en 4 min"; the due chip keeps
today's "Hora de marchar" (`apps/till/src/i18n/strings.ts:2359`).

Where the time comes from, today: the floor read already carries each party's reminder, with its due
time when there is one (`release_due` with `dueAt`, `packages/shared/src/table-signals.ts:16-17`; the
till's copy is `party.reminder`, `apps/till/src/api/client.ts:1861`). `releaseReminder`
(`apps/server/src/order-groups.ts:1118-1139`) sets it to the venue's reminder minutes after the last
dish of the groups before it is served, or to a snooze time. It has **no time** while a dish fired
before it is still unserved, and there is no reminder at all when the venue has reminders off. The
setting is `service_settings.release_reminder_minutes`, 10 by default
(`packages/venue-service/src/schema/settings.ts:28`); A756 moves it to the department.

So:

- **No time yet** (a dish fired before it is still unserved, or nothing fired before it has a dish
  to serve yet — for example when everything was held): "⏸ Held 2", no countdown. With reminders
  off there is no reminder at all, so the chip never counts down and never turns into Time to fire.
- **A time ahead:** "fire in N min", N rounded up to whole minutes, "fire in 1 min" for the last
  minute. A snoozed group counts down to the snooze.
- **Due:** "▶ Time to fire", pulsing.

The till redraws itself today only at the moment a reminder falls due
(`#watchReminders`, `apps/till/src/screens/till-floor-screen.ts:717-728`), and re-reads the floor
every 15 s only in map view (`:701-711`). A countdown needs one redraw a minute while any table shows
one; the build adds that.

**On the map** a table counting down stays in the Nothing needed colour with the cue "⏸ 4′" (four
minutes left) or "⏸ Held 2" while it has no time; when due, the whole table turns amber with "▶
Fire" and pulses slowly.

**Held dishes stop counting as late.** Today the card's outline and its Forgotten badge come from
`timingBand`, which counts every unserved dish with a ticket, held or not (the
`wol.served_at is null and ti.id is not null` filter, `apps/server/src/working-order.ts:7717`, read at
`:7760-7768`), while the Waiting/Overdue chips count fired dishes only
(`isNotNull(ticketItems.firedAt)`, `apps/server/src/table-signals.ts:76`). The build makes
`timingBand` count fired dishes only, so T7 in picture 03 shows "⏸ Held 2 · fire in 4 min" at 21:16,
not "Forgotten". This settles Task 10's open point in `docs/backlog/till.md`, which this revision marks decided.

**2026-10-20:** built by slice 3 (plan `docs/superpowers/plans/2026-10-20-a757-3-held-mark-countdown.md`):
the floor read carries a `held` signal with the count; the list card and the unplaced token show the
held chip, its countdown and the filled Time to fire chip; `timingBand` counts fired dishes only. The
pulse is slice 4's, the map's cue slice 5's; requested dishes wait for A773-2.

### 5.2 Two pulse speeds (Q18)

Picture 04.

- **Waiting (5 min):** no pulse. Its card outline changes from blue to amber, matching its chip
  (today `.card.age-warm` draws `--wt-color-primary`, `apps/till/src/screens/till-floor-screen.ts:343-345`,
  though the comment above it says amber).
- **Overdue (10 min):** red outline, **slow pulse: one cycle every 2 s.**
- **Forgotten (15 min):** red outline and the filled red "Forgotten" badge, **fast pulse: one cycle
  every 1 s.** Today's forgotten flash already runs at 1 s
  (`till-floor-screen.ts:358-366`), so the fast speed is the one staff already see.
- **Time to fire:** slow pulse (section 5.1).
- **What moves:** only a ring around the card or table, from full strength down to 30% and back
  (ease in and out). The fill and the words never move, and at its dimmest the ring is still there,
  so a still frame still shows the state. Today's flash fades the outline to nothing
  (`till-floor-screen.ts:362-366`).
- **Reduced motion:** nothing moves. Overdue keeps a steady thick red outline; Forgotten fills the
  card's left edge red and keeps its badge; Time to fire keeps a thick amber outline. The till reads
  the preference on every draw (`#prefersReducedMotion`, `till-floor-screen.ts:1895-1897`) and the map
  has its own (`reducedMotion`, `packages/ui/src/components/wt-floor-map.ts:388-389`).

Two motion values are added beside the existing ones in `packages/ui-core/src/tokens/structure.css:44-47`:
`--wt-duration-pulse-slow: 2000ms` and `--wt-duration-pulse-fast: 1000ms`, with one keyframe set in
`packages/ui`. The floor card, the unplaced-table token (`wt-table-token.ts:90`), the map, the zone
tabs, A738's Waiting tab and A773's Held line read them. The kitchen screen and the pass flash
Forgotten at 1 s today (`apps/till/src/widgets/station-queue.ts:448`,
`apps/till/src/screens/till-expo-screen.ts:208`); they move to the fast token with no visible change.
Whether Overdue pulses on those screens is not A757's to decide.

The values are chosen so the two read as clearly different without being frantic: 2 s is a slow
breath, 1 s is twice as urgent, and both are far below three flashes a second, the WCAG 2.3.1 limit
for flashing.

**2026-10-20:** built by slice 4 (plan `docs/superpowers/plans/2026-10-20-a757-4-precedence-pulses.md`):
`--wt-duration-pulse-slow`, `--wt-duration-pulse-fast` and `--wt-opacity-pulse-dim` in
`structure.css`, one keyframe set in `packages/ui/src/floor-ring.ts`; the list card and the
unplaced token ring Overdue and Time to fire slowly, Forgotten fast and Waiting in steady amber;
the kitchen screen and the pass read the fast token. The map, its dot and the zone tabs are slice
5's.

### 5.3 Item counts in the order lists (Q19)

Decided as proposed. Held orders' rows read "4 · €24.50" today, where 4 counts **lines**, extras'
own lines included (`itemCount`, `apps/server/src/working-order.ts:4414`). They become:

> **#12 T4** — 6 items · 2 held · 2 ready · €58.20

- **Items** = what was ordered: a counted dish by its quantity, a weighed dish as one, extras not
  counted.
- Then each state with at least one item, in the order a dish moves: not sent, held (including
  requested), waiting (in the kitchen), ready. Served items are the rest and are not listed.
- In **Held orders**, **Waiting** and **Transfers**. Not on the **Pass**, whose card already lists
  every item with its state, and not in the **payment panel**, which shows no order row
  (`apps/till/src/widgets/tender-pay.ts:1181-1228`). A765 adds the table's name to the same rows and
  builds to this.

### 5.4 Reserved and Take order (Q20)

Decided as proposed: **Reserved takes the map's reserved colour** (the pale amber fill,
`--wt-color-table-reserved`), so the list card and the map say Reserved the same way. Take order is
now a service step and looks like every step (section 8). The first version also named "Bill requested" and "N en
camino" as look-alikes, after the backlog; on the list card they no longer are: Bill requested has
been filled purple since A472 (`apps/till/src/widgets/signal-chips.ts:65-69`) and "N en camino" is
filled blue (`till-floor-screen.ts:467-470`). A773 removes En route anyway.

**2026-10-20:** slice 4 built the Reserved half: Reserved is pale amber on the list card and the
unplaced token (`--wt-color-table-reserved`, text `--wt-color-on-table-reserved`). Take order keeps
its blue-bordered chip until slice 8 gives service steps their look; it already ranks as a step.

## 6. The floor map: the whole table shows its state

Pictures 09 (busy floor, phone width, both themes) and 03, 04.

Today a map table has a fill — free, reserved, seated, bill or clearing — and at most one small dot
in its corner, red for forgotten or green for ready (`FloorMapFill` and `FloorMapDot`,
`packages/ui/src/floor-map-fills.ts:3-5`; worked out in `apps/till/src/state/floor-map.ts:13-31`;
drawn at `wt-floor-map.ts:910-917`). Held, Time to fire, Overdue and Waiting have no mark of their own on
the map; a course held long enough does show, wrongly, as the red forgotten dot, because the dot
reads `timingBand` (`floor-map.ts:24`). The owner judged the dot too small for a handheld.

Proposed: **the table's whole shape shows its highest state from section 4** — a fill, or a thick
outline inside the shape for Overdue and Waiting, or dashes for Needs clearing — and under the
table's name a short **cue**: an icon plus a word or a number (⏱ Overdue, ▶ Fire, 🍽 2, ⏸ 4′, 🛎
Dessert?). The cue is what a colour-blind waiter reads, and it is also read out: the table's
spoken description already carries its state ("Seated, 2 ready", `wt-floor-map.ts:901`) and will
carry the new state's words. A long step name is cut to fit with an ellipsis; the table's details
show it in full.

The pulse is a ring outside the shape, so neighbouring tables need room: picture 09 keeps 12 px
between tables, and the ring reaches 7 px out.

`wt-floor-map` takes, per table, one state instead of a fill and a dot (a change to its documented
properties, `docs/developers/design-system.md:695`). Two colours are new tokens: Nothing needed's
pale blue and the text colour on a ready (green) table — there is no `--wt-color-on-success` today
(none in `colors.css`).

**A check the build must make:** the map hides a table's name when the table is drawn smaller than
28 px (`NAME_MIN_PX`, `packages/ui/src/floor-plan-geometry.ts:5`; `showsName`, `:324-326`), and the
cue goes with it. A small table on a phone then shows its state by colour and its spoken description
only. The build measures the owner's real plan (Santet, 24 tables) at 390 px; if tables fall below
the limit, that comes back to the owner.

## 7. Zone tabs carry the most urgent hidden state

Picture 08 (light and dark, 390 px, reduced motion).

Today a zone tab is a plain button, filled for the zone on screen
(`#tab`, `apps/till/src/screens/till-floor-screen.ts:1883-1893`), shown only when there is more than
one zone (`:1774`). The till already holds every zone's tables: the screen filters the zone on screen
out of them (`:1724`), and the "ready" summary reads all zones (`:2035`). So the tabs need no new
read.

Proposed: a tab for a zone **not on screen** takes the highest state, from section 4's rows 1–11, of
any table in that zone: its background tinted with the state's colour, a 4 px bar of that colour
along its bottom, and the state's icon after the zone's name ("Terrace ⏱"). It pulses at the state's
speed: viewing Inside, the Terrace tab pulses fast and red when a Terrace table is Forgotten.
Rows 12–15 leave the tab plain. The tab on screen shows nothing extra, because its tables are in
view. Reduced motion: nothing moves; a Forgotten tab is filled red so it still stands out.

The tabs scroll sideways when they do not fit (`overflow-x: auto`, `till-floor-screen.ts:259-268`). A
tab carrying a state can be scrolled out of sight on a phone, so the toolbar's edge shows the icon
of the most urgent tab beyond it ("🛎 ›"); tapping it scrolls that tab into view.

## 8. Service steps a venue defines

Pictures 10 and 02.

A **service step** is a reminder to go to a table. The owner's examples: set up the table (bread,
menus, water) right after seating; take the order; ask about dessert after the mains; coffee or the
bill after dessert; check on drinks. This absorbs the check-back reminders the owner first asked for.

**Where it is set:** the department dialog's Service tab (A756), under "Table states", below Needs
clearing and the reminder to fire the next course. A list per department: each step has a **name**
(shown on the card, cut to fit on the map) and a **start**; steps can be added, dragged into order
and deleted, like A756's Courses page. A department may have none: a bar that does not visit tables
deletes them all.

**What starts a step** — one of four, each plus a number of minutes (0 = at once):

1. **When seated** — the party sits down.
2. **After the step before** — the step above it in the list is done.
3. **A course served** — every dish of a named course on the party's order is served. Today each
   order line records its course (`working_order_lines.course_id`,
   `packages/db/src/schema/orders.ts:197`) and the moment it is fully served (`served_at`,
   `orders.ts:194`), so "Mains served at 21:32" is the latest `served_at` among the party's Mains
   lines once none is left unserved — the same reckoning the fire reminder makes for groups
   (`releaseReminder`, `apps/server/src/order-groups.ts:1118-1139`). Courses belong to the venue, not
   the department (`kitchen_courses.location_id`, `packages/db/src/schema/kitchen-courses.ts:16`).
4. **Everything served** — nothing ordered is left unserved and nothing is held. This needs no named
   course, so a new venue can have it before it has made any courses. I believe a venue set up from
   scratch starts with none: the code that creates courses is the dashboard's course editor
   (`createCourse`, `apps/server/src/kitchen.ts:347-368`) and the configuration import, which copies
   another venue's courses (`kitchen_courses` in `packages/db/src/configuration-transfer.ts:38`) —
   found by searching for every writer of `kitchen_courses` outside tests and migrations, not by
   setting up a venue.

**A step starts again each time its start happens again**: "Everything served · 10 min" fires after
the mains and again after the desserts. A step whose start never happens never shows (no Dessert?
for a party that ordered no mains).

**What a waiter sees:** one step at a time per table — the latest one started — as a blue chip on the
card with its own **Done** button ("🛎 Dessert? | Done"), and on the map a seated-blue table with "🛎
Dessert?". One tap on Done clears it. From the map, the table's details (the map's details gesture,
`wt-table-details`, `wt-floor-map.ts`'s events in `design-system.md:695`) list the step with Done.
A step also clears when the party leaves. Whether an order sent clears it too is Q30. Take order
keeps today's rule as well: it clears when an order is started, as `take_order` does
(`apps/server/src/table-signals.ts:218`).

**The starter set for a new venue** (Q29): **Set up** (when seated, 0 min), **Take order** (after the
step before, 2 min), **Anything else?** (everything served, 10 min). Picture 10 also shows a
"Dessert?" step the venue added itself.

**Worked example** (picture 10): T9 is seated at 20:30 → "Set up". The waiter brings bread and water
and taps Done at 20:33 → at 20:35 "Take order". The order is sent; the chip clears. The mains are all
served at 21:32 → at 21:42 "Dessert?" (the venue's own step). The guests want nothing; Done at 21:45
→ "✓ Nothing needed".

**What it stores** (for the plan): the steps per department, in the venue-service module's own
tables (a `state` table, `docs/developers/conventions-data.md`), and each party's done steps with the
time and who tapped Done. The server sends the active step with the floor read as a new signal, with
its start time, so the till redraws when a step's minutes run out, as it does for a reminder today
(`till-floor-screen.ts:717-728`).

**2026-10-19:** slice 7 stores the steps in `service_steps` (plan
`docs/superpowers/plans/2026-10-19-a757-7-service-step-settings.md`): five starts, minutes 0–120
(at least 1 for the repeating start), a course start names a `kitchen_courses` row and goes when
that course is deleted (a step left first that started after the step before then starts when
seated); a department created in the dashboard, or the one provisioning inserts,
starts with the three starter steps, named in English when the venue's first receipt language is
English and in Spanish otherwise (a configuration import brings the bundle's steps instead). Each
party's done steps are slice 8's.

## 9. Nothing needed: its own look

Picture 11. The owner: "We need a separate status for no attention needed."

A seated table with **nothing in rows 1–11** of section 4 — no step, no late or waiting order,
nothing due, unavailable, ready, unsent or requested — shows **Nothing needed**: on the map a pale
tint of the seated blue with "✓"; on the card a soft left edge and "✓ Nothing needed" in muted text
(Spanish "✓ Nada pendiente"). A held course still counting down is also calm: it shows "⏸ 4′"
instead of "✓". A paid party still seated shows "Paid", as today.

This changes what today's solid seated blue means. Today every seated table is solid blue
(`--wt-color-table-seated`). After this revision solid blue means **"go to this table"** — a service
step or an order not sent — and a seated table that needs nothing is pale. The alternative, keeping
solid blue for every seated table and marking a step only by its icon, is Q32.

Free stays pale green. Nothing needed and Free differ by colour (pale blue and pale green) and by the
cue: a calm table shows "✓", a free one nothing.

**2026-10-20:** built by slice 4 on the list card: a seated table whose most urgent state is a held
course still counting down, or nothing at all, has a soft left edge, `--wt-color-primary-disabled`
until slice 5 adds the map's pale blue; the second also says "✓ Nothing needed" ("✓ Nada
pendiente"), unless its party has paid, which keeps "Paid". The map's pale tint is slice 5's.

## 10. The Tables tab goes

Once Needs clearing has moved (section 3.1) and venue-made statuses are retired (section 2), the tab is
empty and goes: `VENUE_SETTINGS_TABS` (`apps/dashboard/src/screens/venue-settings-screen.ts:11-16`),
the core panel `{ key: "statuses", tab: "tables" }` (`apps/dashboard/src/dashboard-app.ts:309-317`)
and the venue-service panel `venue-service-tables`
(`packages/venue-service/src/dashboard/index.ts:153-171`). The open note that its colour-field
labels are clipped to an ellipsis at 390 and 1280 px (`docs/backlog.md:4048-4052`; "C…" in
`docs/backlog/till.md:1438-1439`) goes with it.
**2026-10-19:** slice 1 removed `venue-service-tables`; the core `statuses` panel is the tab's only
content.
**2026-10-19:** built by slice 2
(`docs/superpowers/plans/2026-10-19-a757-2-retire-venue-statuses.md`); the Tables tab is gone.

## 11. Build slices

Each slice is one pull request one implementer can finish well under ~100 tool calls.

1. **Needs clearing per department** — the department column (migration), `leaveForClearing` reads
   each table's department, the switch in A756's Service tab, the venue switch and the Tables tab's
   clearing panel go. FULL review (migration).
2. **Retire venue-made statuses** — the table, column and trigger (migration; regenerate, never
   hand-edit), routes and their error codes (`status.not_found`, `status.inactive`,
   `status.label_taken`), the till's status section and chip, the dashboard screen, the Tables tab,
   the live subscription `listStatuses`, which watches the `table_service_statuses` table
   (`apps/dashboard/src/api/live-queries.ts:520`),
   the demo seed, the configuration transfer (`packages/db/src/configuration-transfer.ts:47`) and the
   two data-retention inventories that list it (`docs/superpowers/specs/2026-10-16-a664-*`). FULL
   review.
3. **Held mark and countdown** — the held count on the floor read, the chip and its countdown on the
   card and the unplaced token, the minute redraw; `timingBand` counts fired dishes only; requested
   dishes counted once A773-2 stores them. LIGHT review.
4. **The precedence order, two pulses and Nothing needed on the card** — one function that ranks a
   table's states (section 4), the two motion tokens and keyframes, Waiting's outline to amber,
   Reserved's colour, the calm look. LIGHT review.
5. **The whole-table map and the zone tabs** — `wt-floor-map` takes one state per table (a change to
   a shared `packages/ui` component used by the till: FULL review, cross-package contract), the new
   colour tokens, the zone tabs and the toolbar edge; the 28 px check of section 6 on Santet's plan.
6. **Item counts by state** — the server sends each order's counts by state with the held-orders
   summary and the Waiting and Transfers lists; the till rows show them. FULL review (a till read
   path).
7. **Service steps: the settings** — the venue-service tables (migration), the list in A756's
   Service tab, the starter set for a new venue. FULL review (migration).
8. **Service steps on the floor** — the server's step signal, the Done route and its permission, the
   chip and map cue, clearing rules (Q30). FULL review (a till write route: CLAUDE.md §3 asks for a
   profile-action row and a refusing case).

Order: 1 and 2 need A756's Service tab and touch the same tab, so they go in that order; 3, 4 and 6
are independent of A756; 5 follows 4; 7 needs A756 and 1; 8 follows 4 and 7.

---

## Open questions (Q29–Q34)

Answered 2026-10-17: all A.

Numbered in the owner's list; each is one decision with a recommended default.

**Q29. The service steps a new venue starts with** [10-service-steps.png, 02-lifecycle.png]
Example: T9 is seated at 20:30. With A, "Set up" shows at once; Done at 20:33 → "Take order" at
20:35; everything served at 21:32 → "Anything else?" at 21:42, and again after the desserts.
- **A (recommended):** Set up (when seated), Take order (2 min after Set up), Anything else? (10 min
  after everything is served). The venue edits or deletes them.
- **B:** Take order only (what the till does today); the venue adds the rest.
- **C:** none; each department builds its own list.

**Q30. Does sending an order clear the step showing?** [10-service-steps.png]
Example: at 21:42 T9 shows "Dessert?". The waiter takes two desserts and sends them.
- **A (recommended):** yes — any order sent after a step started clears it; Done is for when the
  guests want nothing. Take order already works this way.
- **B:** no — only Done clears a step (Take order still clears on ordering).

**Q31. A step that repeats, for "check on drinks"** [10-service-steps.png]
Example: the bar wants a reminder at T2 every 20 minutes without an order: last round at 22:00 →
"Drinks?" at 22:20, and again at 22:40 if nothing is ordered.
- **A (recommended):** add a fifth start, "every N minutes since the last order", for venues that
  want it; not in the starter set.
- **B:** no repeating steps; a step starts only from the four starts in the design.

**Q32. What does solid seated blue mean?** [11-calm.png, 09-busy-floor.png]
Example: T9 is seated and needs nothing; T6 has "Dessert?" due.
- **A (recommended):** T9 is pale blue with ✓ ("Nothing needed"); solid blue means "go to this
  table" (T6).
- **B:** T9 stays solid blue as today; T6 is also solid blue, told apart by its 🛎 and the step's
  name.

**Q33. Does Ready pulse on the map?** [07-precedence.png, 09-busy-floor.png]
Example: T5's two croquetas are ready at the pass. Today the map's ready dot blinks once a second,
like the forgotten one.
- **A (recommended):** no — the green table with "🍽 2" stays still; only Overdue, Forgotten and
  Time to fire move, so movement always means "late or due".
- **B:** yes, at the slow speed (2 s).

**Q34. The order of precedence** [07-precedence.png]
Example: T4 has a dish ready, the bill requested and a step due. Under the order drawn, the table is
purple (Bill requested), and its card lists all three.
- **A (recommended):** the order as drawn: Forgotten, Overdue, Unavailable, Time to fire, Waiter
  called, Bill requested, Ready, a step, Not sent, Waiting, Needs clearing, Held, Nothing needed,
  Reserved, Free.
- **B:** as drawn, with the changes you name (for example Ready above Bill requested).
