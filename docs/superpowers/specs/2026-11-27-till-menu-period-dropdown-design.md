# The till's menu names itself, and says which period is on

Status: approved by the owner on 2026-11-27, from the mock-ups below. Backlog entry A1624. It adds to
the till and handheld redesign ([2026-11-26 spec](2026-11-26-till-handheld-redesign-design.md),
§5 "The menu and dish options") and is built on top of it.

## 1. Why

On 2026-11-27 the owner extended Lunch's hours on the demo venue and still did not see the Lunch
menu on the till. The cause was that the venue was still in its pre-lunch Bar period, so the till
was selling the Bar menu. Nothing on the till said so: today's status line reads only "Open" or
"Open · until 13:00" (`apps/till/src/widgets/service-period.ts`), and the menu shows its name only
when there is more than one menu to choose from (`apps/till/src/widgets/menu-switcher.ts` draws
nothing for one menu).

The 2026-11-26 redesign's menu (frame `d`) opens straight onto search and the section path, and its
spec never mentions choosing between menus, so it had also dropped today's menu picker without
saying so. This design puts the picker back and makes it explain itself.

## 2. Decisions (owner, 2026-11-27)

1. **The menu's name is always a dropdown at the top of the menu**, even when only one menu is on.
   Owner: "we should always have the dropdown even if there is only one menu".
2. **It opens downwards, from the box itself**, not as a list rising from the bottom. Owner: "i
   think it should open from the same edge as where it is located". This is an exception to the
   redesign's rule that every pop-up menu rises from the bottom (§2 point 3 of the 2026-11-26 spec),
   for a control at the top of the screen.
3. **The period appears only inside the open dropdown**, as **Now** and **Next** above the list of
   menus. Owner: "we only need the period descriptors in the open dropdown, to avoid adding too much
   noise". The closed box shows only the menu's name.
4. **The floor shows nothing new.** The zone button keeps its one line, as the redesign drew it. A
   second line on the zone button was drawn and dropped with decision 3.
5. **The calendar's own problems (today's period and today's date are hard to see) wait for the
   calendar redesign session** (A1625). They are not part of this build.

## 3. What it shows

The period is the one running in **the department of the order's zone**, as the server already
works it out (`resolveDepartmentService`, `packages/venue-service/src/menu-timetable.ts`).

**The closed box** reads the selected menu's name ("Bar menu"). When no menu is on, it reads
"No menu on" and opens to say why.

**The open dropdown**, from top to bottom:

- **Now**: the running period's name and when it ends: "**Bar** until 13:00". Between periods:
  "**Closed** no period on".
- **Next**: the next period that starts later in the same business day, with its start and end:
  "**Lunch** 13:00 to 16:30". After the last period of the business day there is no Next row. The
  next business day is never shown.
- **The menus on now**, one row each, the selected one ticked and tinted. With one menu the row is
  only its name. With more than one, each row has a second line saying who it is for: "For guests"
  or "For staff" (the menu's `audience`). One tap on a row selects that menu and closes the
  dropdown, as today's picker does.

Which menus are listed, and in which order, follows today's picker (`orderableMenus` in
`apps/till/src/menu-filter.ts`: the menus that can be ordered from now, guests' menus before staff
menus). A menu kept on from a period that ended earlier in the business day (the
`endedPeriodName` the server sends) stays listed as the till offers it today; the plan reads how it
is offered today and keeps it.

**A zone kept open later** is no longer a case: Keep open is removed (§6). The mock-up's "**Lunch**
kept open until 17:15" box shows something that will not exist.

### Worked cases (from the mock-up's bottom strip)

| Situation                           | Now                             | Next                      |
| ----------------------------------- | ------------------------------- | ------------------------- |
| Bar runs, Lunch starts when it ends | **Bar** until 13:00             | **Lunch** 13:00 to 16:30  |
| Lunch runs, a gap before Dinner     | **Lunch** until 16:30           | **Dinner** 20:00 to 23:30 |
| The last period of the day          | **Dinner** until 23:30          | (no row)                  |
| Between periods                     | **Closed** no period on         | **Dinner** 20:00 to 23:30 |

## 4. How it looks

Mock-ups (not committed; shared folder): `~/waitron-campaign-shared/mockups/2026-11-27-period-line/`
— `period-line-light.html` and `period-line-dark.html` with `base.css`, rendered as
`period-line-light.png` and `period-line-dark.png`. The approved frames are the **second version**
(the three phones headed "1 · The menu, closed", "2 · Open, one menu on", "3 · Open, two menus on").
`build-v1.sh` is the dropped first version (a second line on the zone button and under the menu's
name); it is kept only as a record of what was turned down.

- **The box** (frame 1): at the top of the menu sheet, above the search field, full width with the
  sheet's 12 side margins. It is the redesign's bill dropdown box (§14.4 of the 2026-11-26 spec):
  outlined, 44 tall, 8 radius, on the surface colour. The menu's name at the left, 17 bold.
  `chevron-down` at the right edge, 20. No count ("1 of 2") and no second line.
- **Open** (frames 2 and 3): the box takes a 2px teal border (its 1px border plus a 1px teal ring)
  and its chevron turns to `chevron-up`. The panel hangs just under the box (2 below), the same
  width, 12 radius, on the surface colour with a 1px border and `--wt-shadow-2`. A scrim
  (black at about 42%) covers the menu below the box; the box itself stays unscrimmed.
- **Now and Next** at the top of the panel, padded 14 top, 16 sides, 12 bottom: a two-column grid,
  the labels "Now" and "Next" in the first column, 52 wide, 13 semibold muted; the value 15, the
  period's name bold, the times muted. 6 between the two rows. Labels are plain words, not small
  capitals.
- **Menu rows**: under a line, each row 56 tall, 16 side padding, a line between rows. A teal
  `check` (22 wide column) before the selected row, and that row on the lifted (light blue) fill. The
  name 17 semibold; "For guests" or "For staff" 13 muted under it only when there is more than one
  row. No icon before a row, no chevron after it.
- **No menu on**: the box reads "No menu on"; the panel shows Now and Next and no menu rows.
- **The till** (redesign frame `m`, wide layout): the box sits at the top of the menu column on the
  left, and the panel drops down over that column only.
- Dark theme: the same tokens; frame `period-line-dark.png`.

## 5. What has to change

- **The server** sends, beside the running period's name and end it already sends in
  `GET /api/menu-state`'s `service` (`periodName`, and the run's end in `keepOpen.endsAt`), **the
  next period of the business day**: its name, start and end, or nothing after the last. The
  department's runs for the day are already in hand where `resolveDepartmentService` works out the
  running one (`serviceRuns`), so this is a read of the same list.
- **The till** replaces `till-menu-switcher` (today's `wt-combobox`, drawn only for two or more
  menus) with the always-present box and its panel, on the phone's menu sheet and the till's menu
  column. Today's "Open · until 13:00" line in `service-period.ts` is the redesign's business; this
  build adds nothing to the floor.
- **Wording** in English and Spanish, with the till's existing Spanish words: "periodo" for a period
  (`menu.department_closed`) and "carta" for a menu (`menu.switcher`).
- **The till's guide**, English and Spanish, says in one sentence where to see which period is on
  and why a menu is missing (CLAUDE.md, "A screen change updates its guide").
- Tests at the box (closed, open with one menu, open with two, no menu on, and every Next case in
  the table above), and a browser test that the panel opens downwards from the box.

## 6. Keep open is removed; a closed zone asks instead (owner, 2026-11-27)

Backlog entry A1626, a separate build from A1624.

**What Keep open did.** A zone (the dining room, the terrace) can close before its department's
periods end. From its closing minute it takes nothing new: no new guests are seated, an occupied
table cannot add a dish or raise a quantity, a seated party cannot place a first order, and guests
or bills cannot move in from another zone (a presented bill can). Paying, splitting, moving dishes
between bills, a new empty bill, a note, and an extra on a dish already sent still work. Tables are
not cleared. Receipt: `apps/server/src/till-api.zone-closed.test.ts`, 27 cases, all passing on
`main` at `c6acae0136` on 2026-11-27. Keep open, on the till with a manager's PIN (the server asks
for `venue.configure`, `apps/server/src/keep-open-api.ts`), moved that closing minute later for the
day.

**Why it goes.** The owner: "it is not a waiter's decision to keep the kitchen open. it would be a
manager's decision, and would maybe happen in the dashboard instead. we already have a way to say
'send this to the kitchen even though it has closed' which allows us to deal with late orders." The
2026-11-26 till redesign had no place for it either (its zone section in ☰ lists Add a spare table,
Taken off and Back to the plan).

**What replaces it.** The owner chose this over keeping a closed zone strict:

- **A closed zone asks, as an ended period does.** Where a closed zone refuses today (seating, a
  new dish or a higher quantity, a first order, guests or a bill moving in), the till asks first and
  then does it: "Terrace closed at 22:00", with a choice to go ahead or not. It follows the late
  send's pattern (`apps/till/src/widgets/late-send-dialog.ts`: "{period} has ended", "Check with
  the station before sending", "Station agreed — send", "Don't send them"), with wording about the
  zone rather than a station. No manager's PIN. When both the zone has closed and the dish's period
  has ended, the person is asked once, naming both.
- **What still works after closing is unchanged** (paying and the rest listed above), and nothing
  is cleared.
- **A planned change to a day's hours** is made in the dashboard's Calendar, as a special day for
  that zone, as it can be today.
- **Removed:** the till's Keep open button and dialog (`apps/till/src/widgets/keep-open.ts`,
  `keep-open-dialog.ts`), its server route, the stored zone extensions and their activity-log kind
  (`zone.keep_open_ended`), and every mention in the guides (`apps/server/src/guide/en/table-service.md`
  and its Spanish twin, among others the plan finds). Before go-live this needs no data migration
  (CLAUDE.md, "No backwards-compatibility or data-migration code until Waitron is in production").
- The plan traces every reader of the zone's closing state (`zoneKeepOpen` in `GET /api/menu-state`, and
  the other `packages/venue-service` files that name keep-open, such as `floor-layout-due.ts` and
  `business-day-schedule.ts`) before removing the field,
  and every reader of the closed-zone refusal `service_zone.closed`, which now becomes a question
  rather than a refusal for the cases above.
