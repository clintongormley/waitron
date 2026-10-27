# A807 and A808 — one kitchen-note slip per printer, one notice per station, and the reprint time: build plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax. Implementers are
> dispatched as `subagent_type: "implementer"`.

**Goal:** One pull request, branch `feat/a807-a808-kitchen-note-slips`, worktree
`/Users/clintongormley/workspace/worktrees/waitron-feat-a807-a808-kitchen-note-slips`.

- **A807 (owner, 2026-10-17).** When the order's note for the kitchen is changed or removed, each printer gets ONE slip
  listing the affected dishes, and each station gets ONE notice the cook acknowledges once, instead of a slip and a notice
  per dish. Done when the three-dish edit in `apps/server/src/order-kitchen-note.corrections.test.ts` shows one slip per
  printer and one notice per station. Decision record: `docs/backlog/kitchen.md:529-532`.
- **A808 (owner, 2026-10-17).** A reprinted kitchen ticket's heading reads `*** REPRINT HH:MM ***`, the time of the
  reprint, and the original send time stays on the ticket. Done when a ticket test pins both times on one reprint.

**Spec:** the two entries above (`docs/backlog.md:1574-1575`, `:1598-1601`; `docs/backlog/kitchen.md:188-194`).

**How claims are marked.** **(ran)** means run on 2026-10-27 against `main` at `6bda92e5b` (this worktree's base);
**(read)** means read in the code at that commit, not run.

---

## Architecture

**A807, the notice.** Keep recording one `kitchen_notices` row per dish, exactly as today. The station read
(`listStationsNotices`) folds the rows of one kitchen-note change into one notice, and acknowledging that notice clears
every row in the fold. No migration, no schema change.

A **fold** is the rows at one station that share the order, the `created_at` value and the before/after note values.
Rows written by one `recordKitchenNotices` call share `created_at` (one `nowIso()` for the whole insert,
`packages/venue-service/src/kitchen-notices.ts:172`). Only a `changed` row can carry `order_note_change`
(`kitchen-notices.ts:87-96`). Fold key, in SQL:

```sql
case when order_note_change is null then id
     else json_array(working_order_id, created_at,
                     json_extract(order_note_change, '$.before'), json_extract(order_note_change, '$.after'))
end
```

The key compares values, not JSON text, so key order cannot split a fold. A null `before` and a null `after` stay
different. A row with no note change is a fold of one (its own `id`). (ran: a `node:sqlite` probe, SQLite 3.54.0,
gave the same key for `{"before":"x","after":null}` and `{"after":null,"before":"x"}`, and different keys for
`[...,"x",null]`, `[...,"x","y"]` and `[...,null,"y"]`. A plain row's key was its id.)

The notice sent to the till gains one optional field. Every other field keeps its meaning:

```ts
/** On a kitchen-note change, every dish it affects at this station, in the order recorded. */
dishes?: { lineName: string; unitName: Record<string, string> | null; soldInEach: boolean;
           quantity: Decimal /* the till's copy: string */; note: string | null; wasStarted: boolean }[];
```

`dishes` is present exactly when `orderNoteChange` is. The notice's `id` and its own per-dish fields are the fold's
first row's (lowest `rowid`). So `dishes[0]` repeats them, and a reader that does not know `dishes` still sees a valid
one-dish notice. Every other kind of notice (recalled, void, moved, rerouted, allergy, and quantity or extra `changed`)
has no `dishes` and is read, ranked and acknowledged exactly as today.

**The fifty-notice limit.** Today the read keeps a station's newest 50 rows (`row_number()`, `kitchen-notices.ts:247-250`,
`NOTICE_LIMIT` `:64`). The read keeps that row ranking unchanged. A fold is kept WHOLE when any of its rows ranks within
50: one more query level takes `min(newest) over (partition by station_id, fold_key)` and filters on that. A plain row's
minimum is its own rank, so which plain rows are kept does not change. It is still one statement (the guard is
`kitchen-notices.test.ts:1393`).

**A807, the slip.** `printCorrectionSlips` (`apps/server/src/kitchen-print.ts:1103-1197`) keeps its shared start: the
held-paper filter per dish (`:1110-1118`), the printer read and the line, station and order-header reads. For a
kitchen-note change it then routes as a kitchen ticket does. Since A366 slice 4A (#1489), `routeKitchenTickets`
(`kitchen-print.ts:479-509`) gives one ticket per printer, carrying every involved station that lists that printer, in
station-name order (`:616`), grouped by paper layout (`groupByLayout`, `:149-159`). So a note change gives one slip per
printer, and a printer shared by two stations prints one slip with a section per station. Every other kind keeps its
per-dish loop (`:1159-1196`). The note-change branch stays INSIDE `printCorrectionSlips`, which keeps it among the three
rendering roots A964's plan threads language through (`docs/superpowers/plans/2026-10-22-a964-kitchen-language.md:166-170`).

**A808.** `KitchenTicket.reprint?: boolean` becomes `reprintedAt?: Date`. The heading prints `*** REPRINT HH:MM ***`
through the same `hhmm` as the ticket's own time line (`apps/server/src/kitchen-ticket.ts:322-326`). On a reprint, the
time line (`firedAt`) becomes the original send time instead of the reprint time it prints today (`firedAt: new Date()`
for every ticket, `kitchen-print.ts:654`; `reprintOrderTickets`' comment says "stamped with the reprint time, not the
original fire time", `:1759-1760`). The KDS-4 follow-up that A808 answers named exactly this: "reprint stamps the reprint
wall-clock, not the original `ticket_items.fired_at` … thread `fired_at` through" (`git show dd791ffc9`, the backlog's
KDS-4 line).

---

## Global constraints

- `CLAUDE.md` §1: a sentence about behaviour carries a receipt. "Pre-existing" and "unreachable" are claims and get
  checked with `git log`/`git blame`.
- **No migration, no new error code, no new table.** If a task seems to need one, STOP and report.
- **General code is English only.** No new Spanish literal in `apps/server/src/*.ts` or `apps/till/src/widgets/*.ts`. The
  multi-dish slip uses only words the single-dish slip already prints (`kitchen-ticket.ts:471-480`, `:506-511`). Move
  those branches into a helper unchanged; do not reword or duplicate them. A964 moves them into `apps/server/src/i18n/`.
  The till needs no new words: dish lines reuse `dishLine`, and the started mark reuses `station.notice.started`.
  `scripts/english-only.test.ts` is weaker than its name: it skips `apps/*`, so review greps the diff for Spanish.
- **Other notice kinds do not change:** recalled, void, moved, rerouted, allergy_changed, allergy_removed, and a
  quantity or extra `changed`. Their rows, wire shape, ranking, slips and acknowledgement stay as they are.
- **Changed test checks:** only the ones listed below, each authorised by the spec sentence named. Any OTHER existing
  assertion that fails is a **STOP for the owner**: report it, do not edit it.
- Run focused tests with `env -u AI_AGENT -u CLAUDECODE` and read the `Tests` count (CLAUDE.md §4). Before each commit,
  run `pnpm --filter <package> typecheck` for each package touched, then `pnpm format:check`. Commit with
  `git commit -s`, staging named paths only, with plain-English messages.
- Review path: **FULL**. This changes what kitchen paper prints, and the shape of the notice in the cross-package
  contract (`packages/module/src/module.ts` ↔ `apps/till/src/api/client.ts`). Per-task reviews run, plus the full
  `/finish-branch` wave with both Codex review angles.

## Decisions

1. **The unit is the bill (working order).** One slip per printer per affected bill, and one notice per station per
   affected bill. Reasons: `enqueueOrderKitchenNoteChange` already handles one bill at a time (`kitchen-print.ts:876-884`).
   `recordKitchenNotices` takes one order and labels every row with that order's number and label (`kitchen-notices.ts:119-171`).
   The slip header prints one order number and one table (`readOrderHeader`, `:436-442`; `formatCorrectionSlip`, `kitchen-ticket.ts:501-504`),
   as every kitchen ticket does. A party with two bills therefore gets two slips per printer and two notices per station,
   each naming its own bill. The owner may revisit this; it is not built.
2. **The notice folds at read time (option a), with no migration.** Option (b), a row per station holding a dish list,
   would need a venue-service migration. `line_name` and `quantity` are `NOT NULL`
   (`packages/venue-service/src/schema/kitchen-notices.ts:46`, `:50`), so (b) also needs either a table rebuild or a
   second, overlapping column, plus a new write path. (a) changes one read and one update in one file, plus two optional
   wire fields.
3. **Acknowledging any row of a fold clears the whole fold.** One `UPDATE … WHERE` the fold key matches, at the same
   station and `acknowledged_at is null`. Already-acknowledged rows keep their first time, as today (`kitchen-notices.ts:308`).
   So the screen's id and a cached older id both clear the notice the cook saw.
4. **A fold is kept whole at the fifty limit** (Architecture). Plain rows keep exactly today's cut.
5. **The slip uses the station's ticket grouping.** Each station's section goes through `arrangeTicketItems` with that
   station's `ticketGrouping`, ordered by group then line (`byGroupThenLine`). This is what a reprint does when it gathers
   every round's dishes (`planKitchenTickets`, `kitchen-print.ts:603-617`). So three one-burger rounds print
   `3.000 x BURG` under the default `combined`, while the notice lists the three dishes as recorded. Group headings work
   as on a ticket: `GROUP n` once under the header when every dish shares a group (`onlyGroupOf`), otherwise before each
   run, with no late-send marks (a correction describes the change, not the agreed send, as the MOVED slip does,
   `kitchen-ticket.ts:279-283`).
6. **The slip's layout.** `*** <heading> ***`, then the stations joined with ` · ` (as the shared ticket does,
   `kitchen-ticket.ts:349-353`), the table, the order number, the time, then the new note or the removed-note line, then
   `Was:`/`Antes:` (all as today, `:500-511`). Then a station name before each section, ONLY when the slip carries more
   than one station (as the shared ticket does, `:366-372`), and its dishes through `emitItem` (a dish's own note prints
   as `  * <note>`). With one station and one dish the bytes match today's single-dish slip (Task 4 pins this).
7. **A808's words are a literal in `kitchen-ticket.ts`**: `` `*** REPRINT ${hhmm(reprintedAt)} ***` ``. `REPRINT`,
   `HOLD`, `FIRE` and `GROUP` print in English on every paper today (`docs/backlog/kitchen.md:20-25`), and A964 moves them
   all into its catalogue with a `{time}` placeholder (its plan, line 123). No Spanish is added.
8. **The reprint's original send time is the earliest send among the dishes on that ticket.** For fired work this is
   `ticket_items.fired_at`. For the HOLD part it is `order_groups.hold_printed_at`, which is stamped when the group's HOLD
   ticket is queued (`apps/server/src/order-groups.ts:2050-2062`). The earliest is found with `Date.parse`, never by
   comparing the stored text (the text-comparison risk is in `docs/backlog/kitchen.md:226-231`). With one send there is
   no choice to make. With several it follows C78's earliest-fired-dish rule. **The owner may choose otherwise** (see
   "Not settled").
9. **A808's clock is the one the ticket already uses**: `Date#getHours`/`getMinutes` in the server process's time zone
   (`kitchen-ticket.ts:322-326`, unchanged since `29bc12130`, 2026-08-28). "Now" reaches the formatter as `reprintedAt`,
   created once per reprint in `planKitchenTickets`, so a test pins it with `vi.useFakeTimers({ toFake: ["Date"] })`.
   Faking Date alone is already done beside `useVenueDb` (`apps/server/src/find-bill-bills.test.ts:643`).

---

## Changed test checks

Each one changes because of the spec sentence named; nothing else may change.

**A808, "The heading reads `*** REPRINT HH:MM ***`, the local time of the reprint":**

| file:line | old | new |
| --- | --- | --- |
| `apps/server/src/kitchen-ticket.test.ts:424`, `:430` | `"*** REPRINT ***"` | `"*** REPRINT 15:20 ***"` (helper `:399-413` gains `reprintedAt: new Date(2026, 7, 17, 15, 20)`; time lines `:428`, `:434` stay `"14:30"`) |
| `apps/server/src/kitchen-ticket.test.ts:956`, `:962` | title "opens a reprint with \*\*\* REPRINT \*\*\*…"; `["*** REPRINT ***", ...plain]` | title "opens a reprint with its reprint time and keeps the send time"; `["*** REPRINT 15:20 ***", ...plain]` (`plain` holds `14:30`): **A808's done test** |
| `apps/server/src/kitchen-ticket.test.ts:1569` | `"*** REPRINT ***"` | `"*** REPRINT 13:40 ***"` (setup `:1554` gets `reprintedAt: new Date(2026, 7, 17, 13, 40)`) |
| `apps/server/src/print-problems.test.ts:893`, `:929`, `:933`, `:943`, `:975`, `:1000`, `:1027`, `:1064`, `:1071` | `"*** REPRINT ***"` | `REPRINTED`, declared beside `TIME` (`:861`) as `expect.stringMatching(/^\*\*\* REPRINT \d\d:\d\d \*\*\*$/)` |
| `apps/server/src/kitchen-print.test.ts:2000` | `.toBe("*** REPRINT ***")` | `.toMatch(/^\*\*\* REPRINT \d\d:\d\d \*\*\*$/)` |
| `apps/server/src/kitchen-print.test.ts:2471` | `"*** REPRINT ***"` | `expect.stringMatching(/^\*\*\* REPRINT \d\d:\d\d \*\*\*$/)` |
| `apps/server/src/order-groups.test.ts:4107` | `.toBe("*** REPRINT ***")` | `.toMatch(/^\*\*\* REPRINT \d\d:\d\d \*\*\*$/)` |
| `apps/server/src/kitchen-print.shared-printers.test.ts:456` | `"*** REPRINT ***"` | `expect.stringMatching(/^\*\*\* REPRINT \d\d:\d\d \*\*\*$/)` |
| `apps/server/src/kitchen-print.shared-printers.test.ts:501`, `:503` | `text === "*** REPRINT ***"`; `lastIndexOf("*** REPRINT ***")` | the same regex `.test(text)`; `findLastIndex` with it (count 2 and the split unchanged) |

Setup only, with no assertion changed: `reprint: true` becomes `reprintedAt: new Date(…)` at
`kitchen-ticket.allergy.test.ts:155` and `kitchen-ticket.kitchen-note.test.ts:28`. `made-here.routes.test.ts:535`
(`toContain("REPRINT")`) still holds. Receipt for the list: `rg -n 'REPRINT' apps packages scripts --glob '*.ts'` (ran);
nothing pins `REIMPR…` or another spelling. No existing test pins a reprint's time line to the reprint time: the
integration tests use `TIME = /^\d\d:\d\d$/` (`print-problems.test.ts:861`) or skip that line.

**A807, "Print one slip per printer listing the affected dishes, and raise ONE notice the cook acknowledges once per
station":**

| file:line | old | new |
| --- | --- | --- |
| `apps/server/src/order-kitchen-note.corrections.test.ts:510` | title "uses the existing per-dish acknowledgement and correction paper for a shared instruction" | "gives a shared instruction one slip at the printer and one notice at the station for three dishes" |
| `…corrections.test.ts:518` | `toHaveLength(3)` | `toHaveLength(1)` |
| `…corrections.test.ts:519-523` | three equal `orderNoteChange` entries | one: `[{ before: "Old time", after: "New shared time" }]` |
| `…corrections.test.ts:524` | `before.length + 3` | `before.length + 1` |
| `apps/server/src/order-groups.test.ts:631` | `expect(paper[0]).not.toContain("GROUP 3\n")` | `expect(paper[0]).toContain("GROUP 5\n2.000 x K-FLAN")` and `expect(paper[0]).toContain("GROUP 3\n4.000 x K-OCTO")` |

The `order-groups.test.ts:631` row: that test's one printer serves the one station holding every dish
(`order-groups.test.ts:153-235`, `:450-470`), so the flan's slip now also lists the octopus, shown as group 3. The old
line meant "flan is not labelled by its position 3". The new pair keeps that meaning (flan under its permanent 5, the
octopus under its permanent 3), and `:629-630` stay unchanged. (read)

Setup only: `kitchen-ticket.kitchen-note.test.ts:131-155` calls the new `formatKitchenNoteChangeSlip` with
`stations: [{ stationName: "Grill", items: [item] }]` in place of `formatCorrectionSlip({ kind: "ORDER NOTE CHANGED", item, … })`.
Its four assertions (`:149-152`) stay unchanged.

**Unchanged, and why.** Tests that count raw `kitchen_notices` rows keep their counts, because rows stay per dish
(`order-kitchen-note.corrections.test.ts:161-163`, `:198`, `:233`, `:256`, `:273-274`, `:426-429`;
`collect-at-counter.test.ts:378-389`). The one-dish slip and notice tests (`corrections.test.ts:112-154`, `:211-347`)
see the same paper and notices. (read; Tasks 3 and 5 run them.)

---

## Task 1 — A808: the reprint heading carries the reprint time

**Files:** `apps/server/src/kitchen-ticket.ts`, `apps/server/src/kitchen-print.ts`, and the test files in A808's table.

- [ ] **Test first.** In `kitchen-ticket.test.ts`, change `:956-963` as tabled: `formatKitchenTicket({ ...station(items),
      reprintedAt: new Date(2026, 7, 17, 15, 20) }, KITCHEN_80)`, then `expect(again).toEqual(["*** REPRINT 15:20 ***", ...plain])`,
      where `plain` already contains `"14:30"` (`at`, `:943`). Change `:399-413`/`:424`/`:430` and `:1554`/`:1569` as tabled.
- [ ] Run `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/server exec vitest run src/kitchen-ticket.test.ts`.
      Expect three failures: the reprint line is missing, because `reprintedAt` is not read yet.
- [ ] Implement. In `KitchenTicket` (`kitchen-ticket.ts:56-86`), replace `reprint?: boolean` with `reprintedAt?: Date`,
      update its doc line (`:56-58`), and print `` `*** REPRINT ${hhmm(ticket.reprintedAt)} ***` `` at `:347`. In
      `planKitchenTickets` (`kitchen-print.ts:645-654`), set `const now = new Date()` once, with `firedAt: now` and
      `reprintedAt: reprint ? now : undefined`. The time line is unchanged in this task.
- [ ] Update the setup-only sites and every integration row in A808's table. Run
      `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/server exec vitest run src/kitchen-ticket.test.ts src/kitchen-ticket.allergy.test.ts src/kitchen-ticket.kitchen-note.test.ts src/print-problems.test.ts src/kitchen-print.test.ts src/kitchen-print.shared-printers.test.ts src/order-groups.test.ts src/made-here.routes.test.ts`.
      Expect every case to pass, with a non-zero `Tests` count.
- [ ] Commit: "Kitchen reprints say when they were reprinted (A808)".

## Task 2 — A808: a reprint keeps the original send time

**Files:** `apps/server/src/kitchen-print.ts`, `apps/server/src/print-problems.test.ts`.

- [ ] **Test first.** Add a case to `print-problems.test.ts` beside `:909`, titled "A808 prints the reprint time in the
      heading and each part's original send time below the order".
      Using `holdingVenue()`, seat "Mesa 4" and submit `[{ release: "fire", lines: [line(v, "burger")] }, { release:
      "hold", lines: [line(v, "fish")] }]`, then a second submit `[{ release: "fire", lines: [line(v, "burger")] }]`.
      Set the two burger `ticket_items.fired_at` values to `new Date(2026, 9, 27, 14, 30).toISOString()` (the first) and
      `14:05` (the second, to prove "earliest", not "first"). Set the held group's `order_groups.hold_printed_at` to
      `14:10`. Then `vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 9, 27, 15, 20))`, reprint,
      and `vi.useRealTimers()` in a `finally`. Assert the kitchen printer's new job lines equal `["*** REPRINT 15:20 ***",
      "Cocina", "Mesa 4", <order line>, "14:05", "GROUP 1", …burger entries as arranged…, "*** REPRINT 15:20 ***",
      "*** HOLD ***", "Cocina", "Mesa 4", <order line>, "14:10", "GROUP 2", "1.000 x K-FISH"]`. Take the order line and
      the burger entries from the job's own lines, as `:924` does with `head()`, and pin the two times and the two headings.
- [ ] Run `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/server exec vitest run src/print-problems.test.ts -t A808`.
      Expect failure: both time lines print `15:20`.
- [ ] Implement. Add `sentAt?: string` to `FiredItem` (`kitchen-print.ts:64-73`), documented as "the original send time,
      set by `readReprintParts` only". In `readReprintParts` (`:1681-1725`), select `ticketItems.firedAt` for fired items.
      Add `holdPrintedAt: orderGroups.holdPrintedAt` to `readOnHoldTickets`' select (`:1279-1299`, which already joins
      `orderGroups`) and use it for held items. In `planKitchenTickets`, a reprint route's `firedAt` is the earliest
      `Date.parse(item.sentAt!)` among `firedItems` at the route's stations. Every reprint item carries `sentAt`:
      `planKitchenTickets` is called with `reprint: true` only from `reprintOrderTickets` (`:1782`, `:1787`; check with
      `rg -n 'reprint: true' apps/server/src/kitchen-print.ts`). Update the `reprintOrderTickets` comment (`:1759-1760`)
      to say the heading carries the reprint time and the ticket keeps the original send time.
- [ ] Run the Task 1 command plus `src/till-api.reprint.test.ts src/move-merge.test.ts src/made-here.test.ts src/kitchen-print.allergy.test.ts`.
      Expect every case to pass. Commit: "A reprinted kitchen ticket keeps the time its dishes were first sent (A808)".

## Task 3 — A807: one notice per station for a kitchen-note change

**Files:** `packages/venue-service/src/kitchen-notices.ts`, `packages/venue-service/src/kitchen-notices.test.ts`,
`packages/module/src/module.ts` (`StationNotice`, `:633-653`, and the doc lines `:1377-1395`).

- [ ] **Test first.** Add `describe("A807 one notice per kitchen-note change")` to `kitchen-notices.test.ts`, using the
      file's `venue()`/`seedOrder()` helpers (`seedOrder(v.locationId, 4, null)` gives `burgerLineId` and `lemonadeLineId`).
      Write these cases:
      (a) One `recordKitchenNotices` call, `"changed"` with `{ orderNoteChange: { before: "A", after: "B" } }`, with
          burger and lemonade at `v.grill` and burger at `v.bar`. Grill lists ONE notice whose `dishes` maps to
          `["BRGR", "Lemonade"]` (in order given), whose `id` is the first raw row's id, and whose `lineName` is `"BRGR"`.
          Bar lists one notice with one dish.
      (b) `acknowledgeKitchenNotice(tx, v.cfg, <grill notice id>)` sets `acknowledged_at` on BOTH grill rows (raw select)
          and leaves bar's null. Acknowledging the SECOND grill row's id first, in a fresh venue, also clears both.
          A repeat keeps the first time (copy the move-back technique at `:1429-1433`).
      (c) Each of these stays a separate notice: two calls with different changes; the same change on two orders; the same
          change on one order with `created_at` moved apart by hand.
      (d) The limit, with the business-day setup of `:1314-1318`. Record a three-dish fold, move its rows' `created_at` to
          `minutesAgo(2)`, then add 48 `void` rows with
          `noticeAt(…, minutesAgo(1), …)`. The read gives 49 notices, and the fold's has three dishes. Today it keeps only
          two of the fold's rows, as two separate notices.
      (e) A `"changed"` notice with `direction` and one with `cancelledExtra` have no `dishes` property (`not.toHaveProperty`).
- [ ] Run `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/venue-service exec vitest run src/kitchen-notices.test.ts -t A807`.
      Expect (a), (b) and (d) to fail: there is no `dishes`, and each row is its own notice. (c) and (e) pass already;
      they are controls.
- [ ] Implement in `listStationsNotices` (`kitchen-notices.ts:217-283`). Add the fold key to `ranked`, add a middle
      level with `min(newest) over (partition by station_id, fold_key) as fold_newest`, and filter on `fold_newest <= NOTICE_LIMIT`
      in place of `newest`. In the loop, group rows by station and fold key: the first row of a fold becomes the notice,
      gaining `dishes` (every row's `lineName`, `unitName`, `soldInEach`, `quantity`, `note`, `wasStarted`); later rows
      only add a dish. In `acknowledgeKitchenNotice` (`:290-313`), read the row's station and fold key, then update every
      unacknowledged row with that station and fold key. Add `dishes?` to `KitchenNotice` (`:24-45`) and to
      `StationNotice` (`module.ts:633-653`). Reword `module.ts:1377` and `:1389-1390`: the read is "the newest fifty, a
      kitchen-note change's notice kept whole", and acknowledging clears "one notice, every dish of a kitchen-note change
      included".
- [ ] Run the whole file: `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/venue-service exec vitest run src/kitchen-notices.test.ts src/kitchen-allergy.test.ts`.
      Every existing case must pass unchanged, including `:1221`, `:1292`, `:1314` (limit) and `:1393` (one statement).
      Typecheck `@waitron/module`, `@waitron/venue-service` and `@waitron/server`. Commit: "A kitchen-note change shows
      as one notice per station, listing its dishes (A807)".

## Task 4 — A807: the slip that lists a kitchen-note change's dishes

**Files:** `apps/server/src/kitchen-ticket.ts`, `apps/server/src/kitchen-ticket.kitchen-note.test.ts`.

- [ ] **Test first.** In `kitchen-ticket.kitchen-note.test.ts`, for each `layout`:
      (a) Change `:131-155` to call `formatKitchenNoteChangeSlip({ locale, stations: [{ stationName: "Grill", items: [item] }],
          tableLabel: "Table 2", orderNumber: "17", at, orderNoteChange })` (setup only).
      (b) Add "prints one station's single dish exactly as the single-dish slip did". Its expected lines are written out
          from today's `formatCorrectionSlip` output for the same input, captured BEFORE the implementation step, for
          both the edit and the removal, in English and Spanish.
      (c) Add "lists two stations' dishes under each station's name". Use stations `Grill` with `[{ qty: 2, name: "Burger",
          note: "No onions" }]` and `Pastry` with `[{ qty: 1, name: "Flan" }]`. Expect the line after the heading to be
          `"Grill · Pastry"`, and the lines from `Was: Old time` on to be `["Was: Old time", "Grill", "2 x Burger",
          "  * No onions", "Pastry", "1 x Flan", ""]`.
      (d) Add "names a shared group once, and heads a second group". Expect `GROUP 1` once under the header when both
          dishes share group 1, and `GROUP 1`/`GROUP 2` before their runs otherwise.
- [ ] Run `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/server exec vitest run src/kitchen-ticket.kitchen-note.test.ts`.
      Expect failure: `formatKitchenNoteChangeSlip` is not exported.
- [ ] Implement. Export `KitchenNoteChangeSlip { locale; stations: KitchenTicketStation[]; tableLabel: string | null;
      orderNumber; at: string; orderNoteChange: KitchenNoteChange }` and `formatKitchenNoteChangeSlip` (Decision 6). Use
      `onlyGroupOf`, and `emitGrouped(…, lateMarks false)` per station. Move the note-change heading branch of `slipHeader`
      (`:471-480`) and the body (`:505-511`) into one helper that the new formatter calls, with the words unchanged. Remove
      the `"ORDER NOTE CHANGED"` member from the formatter's `CorrectionSlip` only (`:425`). The private
      `CorrectionChange` in `kitchen-print.ts:822` keeps it, because Task 5 renders it. Its only producer is
      `enqueueOrderKitchenNoteChange` (`kitchen-print.ts:878-882`; check with `rg -n 'ORDER NOTE CHANGED' apps packages --glob '*.ts'`).
- [ ] Run the file again and `src/kitchen-ticket.test.ts`; expect both to pass. `@waitron/server`'s typecheck fails in
      `printCorrectionSlips`' per-dish loop (`kitchen-print.ts:1159-1196`) until Task 5 handles the note change before
      that loop, so Tasks 4 and 5 make ONE commit, at the end of Task 5.

## Task 5 — A807: one slip per printer, and the done test

**Files:** `apps/server/src/kitchen-print.ts`, `apps/server/src/order-kitchen-note.corrections.test.ts`,
`apps/server/src/order-groups.test.ts`.

- [ ] **Test first.** Make the A807 rows of the changed-checks table. After the existing three-dish assertions, add:
      the one notice's `dishes` has length 3; the new job's printed lines contain `"3.000 x BURG"` exactly once; replaying
      `set` with the same `submissionId` and starting revisions adds no notice row and no job (as `:139-140` does).
      `VENUE_SERVICE.acknowledgeKitchenNotice(tx, v.cfg, notice.id)` then leaves `listStationNotices` empty, and all
      three raw rows acknowledged.
      Add "A807 prints one slip per printer for stations that share one". Create stations Grill and Pastry, both attached
      to printer `P` (80 mm), and Bar on its own printer `Q` (58 mm), built as `:284-306` builds its stations. Route
      Burger to Grill, Flan to Pastry and Paella to Bar. Seat a table with a note, order Burger twice and Flan and Paella
      once, and change the note. Assert: `P` gets one new job whose lines start `["*** NOTA PARA COCINA CAMBIADA ***",
      "Grill · Pastry"]` and end `["Grill", "2.000 x BURG", "Pastry", "1.000 x FLAN", ""]`; `Q` gets one job listing
      `1.000 x PAELLA`; the listed notices are Grill one (two dishes), Pastry one and Bar one.
- [ ] Run `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/server exec vitest run src/order-kitchen-note.corrections.test.ts src/order-groups.test.ts -t 'A807|shared instruction|order-note change slips'`.
      Expect failure: three jobs and per-dish slips.
- [ ] Implement in `printCorrectionSlips`. After the shared reads (`:1110-1151`), for `change.kind === "ORDER NOTE CHANGED"`,
      sort the stations by `compareStationNames`. Then call
      `routeKitchenTickets(sortedIds, mappingsByStation(mappingRows))`, build each station's items as `:1162-1189` builds
      one item (fired quantity, `group`, `groupLabel`), sort them by `byGroupThenLine` using `itemsByLine`'s
      `lineNo`/`position`, arrange them with the station's `ticketGrouping`, and format one `formatKitchenNoteChangeSlip`
      per route, enqueued to each printer in it. Leave every other kind's loop untouched. The held-paper filter stays
      first, so a dish at a station without its group's HOLD paper prints nowhere but keeps its notice (the notice is
      recorded before printing, `:876-879`).
- [ ] Run every server file that touches a kitchen-note change, a correction or a reprint:
      `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/server exec vitest run src/order-kitchen-note src/kitchen-ticket src/kitchen-print src/order-groups.test.ts src/print-problems.test.ts src/move-merge.test.ts src/collect-at-counter.test.ts src/till-api.kitchen-note.test.ts src/till-api.allergy-kitchen.test.ts src/kitchen-allergy`.
      Expect everything to pass. Any failure outside the changed-checks table is a STOP. Commit Tasks 4 and 5 together:
      "A kitchen-note change prints one slip per printer, listing its dishes (A807)".

## Task 6 — A807: the kitchen screen shows the dishes of one notice

**Files:** `apps/till/src/api/client.ts` (`KitchenNotice`, `:1607-1632`), `apps/till/src/widgets/station-queue.ts`
(`#notice`, `:1001-1065`), `apps/till/src/widgets/station-queue.kitchen-note.test.ts`.

- [ ] **Test first.** Add "A807 lists every dish of one note-change notice and acknowledges it once" in EN and ES. The
      notice is `{ ...notice, orderNoteChange: { before: "Old train", after: "New train" }, dishes: [<Burger, No onions>,
      <2 Croquetas, wasStarted true>, <Flan>] }`. Expect one `[data-notice]` with three `.notice-line` texts `1× Burger`,
      `2× Croquetas` and `1× Flan` in order, "No onions" after the first, the started mark (`station.notice.started`)
      beside the second only, and one Got it button whose `aria-label` names all three. A click dispatches
      `{ noticeId: notice.id }`. At 390 px wide, no dish line overflows (copy the bounds check at `:94-99`).
- [ ] Run `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/till exec vitest run src/widgets/station-queue.kitchen-note.test.ts`
      (check free memory first, CLAUDE.md §4). Expect failure: only one dish line is drawn.
- [ ] Implement. Add `dishes?` to the till's `KitchenNotice`, with the module type's doc line. In `#notice`, when `dishes`
      is present, draw each dish as `.notice-line` plus its started mark and its own note. Otherwise draw exactly today's
      markup. Join the dish lines with ", " in the button's `aria-label`. Use only existing tokens in any CSS.
- [ ] Run the file plus `src/widgets/station-queue.test.ts src/screens/till-station-screen.test.ts`; expect all to pass.
      Typecheck `@waitron/till`. Commit: "The kitchen screen lists every dish of a kitchen-note change in one notice (A807)".

## Task 7 — Guides, English and Spanish

**Files:** `apps/server/src/guide/en/kitchen-service.md`, `apps/server/src/guide/es/kitchen-service.md`. Follow
`~/.claude/docs-writing-style.md`.

- [ ] In `{#corrections}`, add two sentences. Changing or removing the order's note for the kitchen gives each station one
      notice listing the affected dishes, and **Got it** (**Entendido**) clears it. Each kitchen printer prints one slip
      listing the dishes of the stations it serves.
- [ ] In `{#reprints}`, add one sentence: a reprint's heading shows when it was reprinted (`*** REPRINT 15:20 ***`),
      and the time under the order number stays the time the dishes were first sent.
- [ ] Run `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and
      `pnpm exec vitest run scripts/guide-links.test.ts`. Commit: "Kitchen guide: one notice per kitchen-note change, and the reprint time".

## Task 8 — Backlog and docs

- [ ] Delete the A807 and A808 entries from `docs/backlog.md` (`:1574-1575`, `:1598-1601`), and A807's section from
      `docs/backlog/kitchen.md` (`:188-194`).
- [ ] In `docs/backlog/kitchen.md:529-532`, replace "To be built as A807." with "Built in A807 (#<PR>)". Add that a party
      with two bills gets a slip and a notice per bill (Decision 1).
- [ ] Change `docs/backlog/kitchen.md:20` from `*** REPRINT ***` to `*** REPRINT HH:MM ***`.
- [ ] Change the A964 entry (`docs/backlog.md:5782`) to recheck only A773-2's printing reservations. Add one dated pointer
      line under the BUILD gate of A964's plan (`docs/superpowers/plans/2026-10-22-a964-kitchen-language.md:21`). It
      says: A807/A808 landed in #<PR>; note-change slips are built inside `printCorrectionSlips` by
      `formatKitchenNoteChangeSlip`; the reprint heading is the literal `` `*** REPRINT ${hhmm(reprintedAt)} ***` `` in
      `kitchen-ticket.ts`; the wording-inventory line numbers have moved.
- [ ] Add a short entry under the kitchen area of `docs/backlog.md`: "Kitchen paper prints its times in the server
      process's time zone (left open by A808, #<PR>)". Receipts: `hhmm` uses `Date#getHours`
      (`apps/server/src/kitchen-ticket.ts:322-326`). `deploy/Dockerfile` and `deploy/compose.yml` set no `TZ`
      (`docs/developers/testing-guide.md:2489-2493`). A696 covers invoices and receipts only.
- [ ] Docs-only edits go in this PR (they describe this change). Commit: "Backlog: A807 and A808 are built".

## Task 9 — LOOK

- [ ] Start the stack with `wa-wt demo waitron-feat-a807-a808-kitchen-note-slips` (ports from `wa-wt ls`). Seat a table,
      send three dishes across two stations, and change the table's note for the kitchen. Open the kitchen screen in the
      light and dark themes, and at 390 px wide. Expect one notice per station listing its dishes, with nothing cut or
      overflowing.
- [ ] Look at the paper on the dashboard's `/manage/demo-printer` with the demo printer at 58 mm and then 80 mm (Printers
      screen). Check the note-change slip and a reprint whose heading shows the reprint time above the original send
      time. If the demo printer's width cannot be changed, write each slip's bytes from a throwaway, uncommitted test
      through `previewPrintJob` to PNGs, as A964's Task 5 describes, and open those. Record what you saw in the PR. This
      is rendered output, not proof of physical printing.

## Guard suites

`pnpm exec vitest run scripts/english-only.test.ts scripts/guide-links.test.ts scripts/style-token-names.test.ts scripts/primary-coloured-text.test.ts`
(the last two only if Task 6 adds CSS). There is no migration, error code or table, so the migration, error-code and
classification guards do not apply. Package suites and coverage run in CI (CLAUDE.md §2). Read CI's `changes` outputs to
confirm `@waitron/venue-service`, `@waitron/module`, `@waitron/server` and `@waitron/till` were all selected.

## Review focus

1. **The fold.** Only rows of one kitchen-note change at one station and one bill fold together. Acknowledging any of
   them clears exactly that fold. Nothing folds across orders, changes, times or kinds.
2. **The fifty limit.** For every row with no note change, the kept set is identical to today's.
3. **Paper.** The held-paper filter applies per dish before routing. A shared printer gets one slip. A station without
   a printer still gets its notice. A one-station, one-dish slip prints the same bytes as before.
4. **The reprint's times.** The heading uses the reprint's "now", and the time line uses the earliest `fired_at` (or
   `hold_printed_at` for the HOLD part), compared as times, not as text.
5. **The contract.** The module's `StationNotice` and the till's `KitchenNotice` match. Other notice kinds carry no
   `dishes`.
6. **No new Spanish in general code.** The note-change words are moved, not reworded.

## Not settled (owner)

- **Which "original send time" a reprint covering several sends prints.** This plan uses the earliest (Decision 8).
  The alternatives are the latest send, or one time per send.
- **The time zone of kitchen paper** (Task 8's new entry). A808's "local time" is the process zone's, like the
  ticket's existing time.
- **Per bill, not per party** (Decision 1).
