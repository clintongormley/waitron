# A797 — The fixed screens for the handheld, the kitchen screen and the pass (A182 part 1)

Status: **design, waiting for the owner's answer to one question (Q42 in lane C's questions file,
repeated in §10 below). Nothing is built until then.** Backlog entries: `docs/backlog.md` "Design the
fixed screens for each kind of device" (two entries) and
[its detail](../../backlog/till.md#build-good-screens-for-each-kind-of-device-and-retire-canvases-a182-owner-2026-10-01).
Pictures: `docs/backlog/mockups/a797-device-screens/` (01–06; 01 and 03 also in dark, `-dark.png`).
They are drawn in HTML with the apps' colour values (`packages/ui-core/src/tokens/colors.css`), not
screenshots of the running till; symbols such as 🍽 ⏱ ▶ stand in for icons the build draws with
`wt-icon`. The generator is kept outside the repository.

File references are to `main` at `9c8c4c08e`. **(read)** marks a conclusion from reading code, not
from running it. Nothing in this design was run: it changes no behaviour, and every statement about
today's code is (read). Some of the reading was done by a search helper; a fresh-context review on
2026-10-18 re-read the citations in §2 and §5 line by line and corrected those that did not say what
the sentence said. The plan still re-reads each citation before relying on it.

**Words.**
- A **handheld** is a waiter's phone (or a tablet) running the till app; its profile's form factor is
  `phone-portrait` or `tablet-landscape`.
- A **kitchen screen** is a display at a preparation **station** (Grill, Cold, Bar) showing what that
  station must make. Today's code calls it the station screen or KDS (kitchen display system).
- The **pass** is the counter where plated food waits to be taken out; the **pass screen** shows the
  whole kitchen's progress to the person running it (Spanish "el pase"; the code says "expo"). A
  **pass monitor** is a pass screen with no buttons.
- A device's **profile** is the set of permissions the venue gives a kind of device (take orders, take
  card payments, show the pass…); the **form factor** says what shape of device it is.
- **Group**, **held**, **fire**, **requested**, **ready** and **served** are A773's words: a group is
  dishes of one table sent, held and fired together; held means sent but not to be cooked yet; fire
  means "cook this now"; requested means the waiter fired it and it waits for the pass to release it;
  ready means cooked and waiting to go out; served means at the table.
- A773's **order panel** has a **Sent** box (everything already sent) above a **New order** box (what
  the waiter has added but not sent).
- A803's **bill switcher** is the one control, "Bill 1 of 2 · €38.50 ▾", that picks which of a
  table's bills is on screen, with **Bill ⋯** and **Table ⋯** menus beside it.
- **☰** is the menu button at the right of the top bar. The **"?"** beside it turns help mode on
  (A582).
- A **zone** is an area of the venue (Inside, Terrace, Bar). The **Device Home Page** is the block of
  shortcut tiles a menu shows first on a device (W93).

---

## 1. What the owner asked for

The backlog's words (`docs/backlog/till.md:1036-1041` at `9c8c4c08e`, before this design's own
edit to that entry): "Start from the screens in
`apps/till/src/screens/` and the fixed-screen contract. Decide how each workflow fits narrow and wide
screens and what a venue may choose per device. Counter's remaining owner-approved redesign is
A738–A739. The handheld, kitchen screen and pass need their own designs. Menu Device Home Page,
receipt configuration and the floor-plan editor stay separate."

And the owner's two earlier decisions behind it (`docs/backlog/till.md`, "Fixed screens instead of
a screen designer (A182)"): ship screens
written in code rather than a designer venues drag and resize; "delete the canvases functionality. we
provide prebuilt screens with configuration settings." The canvases went in #1800; this design does
not bring a screen designer back.

Standing owner decisions this design follows and does not re-ask: nothing optional between PIN
sign-in and work, secondary features in ☰; any device does everything except the cash drawer, which
follows the profile (owner, 2026-10-03) — so a handheld gets a till's "Zones on this device" without
a question (§3.6); product text as short as the meaning allows.

## 2. What exists today

### 2.1 Which screens a device gets

`builtInScreensFor` gives a till Counter and Floor, a handheld (`phone-portrait` or
`tablet-landscape`) Floor and Order, and a kitchen display (`kds`) Kitchen; the first is home
(`apps/till/src/built-in-screens.ts:5-18`) (read). Both handheld form factors map to one device kind
and get the same screens; nothing else in `apps/till/src` tells them apart, so a tablet differs from a
phone only by width (`apps/till/src/layout.ts:29-31`) (read). The seeded handheld profile, "Móvil",
may take orders, take hand-keyed card payments, prepare, hand over and clock in; it may not take cash,
use an integrated card reader or print receipts; the tablet profile has no capabilities and is not
seeded (`packages/layouts/src/device-profile.ts:110-117`, `:132-150`) (read).

### 2.2 The top bar

One bar (`apps/till/src/widgets/till-shell.ts`) holds the screen tabs, then destination buttons
(Find a bill, Pass, Kitchen, My schedule, Profile, Equipment, Transfers), the language chooser, the
person's name with clock actions and Log out. Above phone width it moves items into ☰ one at a time
until it fits (`LEAVE_ORDER`, `:50-59`; `#fit`, `:481-508`); at phone width (40rem,
`apps/till/src/widgets/language-chooser-styles.ts:4`) every one of those items is in ☰ and the bar
keeps only the tabs, the language chooser and ☰ (`till-shell.ts:390-399`, `:739-786`) (read). The
theme choice sits beside Log out, so at phone width it is already in ☰ with the person's name
(`till-shell.ts:671-681`) (read).
Settings (Zones on this device) appears in ☰ only on a till (`:708`) (read). The handheld's tabs read
"Floor"/"Sala" and "Order"/"Pedido" (`apps/till/src/i18n/strings.ts:278-279`, `:1862-1863`) (read).
A kitchen display has no bar: a corner holds the theme and language choosers
(`till-shell.ts:733-737`) (read). A582 adds the "?" to the bar at every width and to the corner
(`docs/superpowers/specs/2026-10-18-a582-help-mode-design.md:136-143`, `:273-278`).

### 2.3 Handheld: Floor

After the PIN (and the attendance questions or clock-in page when they apply), a handheld lands on
Floor (`apps/till/src/till-app.ts:4020-4024`, `:13533-13590`) (read). The floor shows zone tabs when
there is more than one zone (`apps/till/src/screens/till-floor-screen.ts:1850-1855`), a map when the
zone has placed tables and a list otherwise; a tap on List/Map pins the choice for the session only
(`:620-621`, `:956-957`). At phone width the List/Map switch moves into the zone menu (`:1918-1928`,
`:1702-1716`). A "Ready" summary per station sits above the tables, covering every zone
(`#stationSummary`, `:2205-2244`). The floor re-reads every 15 s, in map view only (`:746-756`) (all
read). A757 redesigns how each table's state is drawn (§7).

### 2.4 Handheld: Order

Opening a table on a handheld switches to the Order tab; on a till it opens over Floor
(`till-app.ts:4336-4343`) (read). The order screen's layout follows its width, not the device: from
720 px it shows the menu and the order side by side (`DRAFT_SIDE_BY_SIDE_MIN_WIDTH`,
`apps/till/src/screens/till-table-order-screen.ts:158`); below that it shows the menu only, with a
bottom bar holding the last-added dish's − + and "Review (n)", which opens the order as a separate
view with its own Back (`:2877-2900`, `:2746-2780`) (read). A "drawer" holds today's current orders,
to-serve and served lists, the total, Pay (where the profile allows a payment) and the bill and table
actions (`:2675-2689`, `:3438-3451`, `:5024-5066`) (read). A773-1 replaces those lists with its order
panel; A803 replaces the bill and table actions with its switcher and two ⋯ menus (§7).

### 2.5 Kitchen screen

A `kds` device boots with no sign-in straight into its kitchen screen (`till-app.ts:3042-3059`) and
draws it only when its profile has `act-as-kds` (`:12788-12790`) (read). Which board it shows — a
station screen, a pass screen or a pass monitor — is chosen for the device on the dashboard's Devices
page, one per kitchen display (the kinds, `packages/venue-service/src/schema/kitchen-screens.ts:18`;
the per-device choice, `device_kitchen_screens`, `:116-137`; one only on a kitchen display,
`checkChoice`, `packages/venue-service/src/kitchen-screens.ts:489-494`); with none available it shows
a notice and re-reads every 15 s (`apps/till/src/kitchen-screen-notice.ts:11-24`, `:65-120`) (read).

The station screen (`apps/till/src/screens/till-station-screen.ts`) may show several stations,
merged into one queue or stacked, a toggle kept per device in the browser (`:859-876`, `:64`,
`:312-329`) (read). It has two views, Board and Tickets (`:1007-1014`):
- **Board:** three columns, New / Preparing / Ready (Nuevo / Preparando / Listo), one cell per dish
  with its order number and table beside it (`apps/till/src/widgets/station-queue.ts:46`,
  `:1054-1067`, `:1091-1096`; `strings.ts:603-605`, `:2173-2175`) (read).
- **Tickets:** one card per order with its courses or groups, notes, extras and allergens
  (`station-queue.ts:900-997`) (read).

Tapping a dish moves it New → Preparing → Ready; with the "ticket" bump mode the whole order moves
(`station-queue.ts:1140-1147`, `:656-676`) (read). A kitchen display never shows Fire buttons today
(`advanceOnly`, `till-station-screen.ts:871`, `:912`) (read). A card's left edge turns blue, then red
as it ages, and a forgotten one flashes once a second (`station-queue.ts:410-455`) (read). The
station's Open/Closed-for-today control needs a manager PIN (`apps/till/src/widgets/station-today.ts:129-137`)
(read). There are no dish counts and no "all day" view (search of the station files, read). The
screen polls every 15 s (`till-station-screen.ts:56`, `:338`) (read).

### 2.6 Pass

The pass is a screen kind, not a device kind (`schema/kitchen-screens.ts:18`); there is no
`expo_pass` kind in the code, though the 2026-08-17 expo design proposed one (read). A `kds` device
chosen as a pass draws `till-expo-screen` (`till-app.ts:12795-12830`); a till or a handheld whose
profile has `show-expo` opens it from the bar's "Pass" (`till-shell.ts:559-562`;
`till-app.ts:6868-6872`), and the till profile has it by default, the handheld profile not
(`device-profile.ts:94-116`) (read). The board is one wrapping row of order cards, each with its
courses or groups and each dish's station and state (`apps/till/src/screens/till-expo-screen.ts:141-146`,
`:861-880`, `:1032-1045`) (read). Its buttons are Fire (only when the venue's fire control is "expo"),
Course/Group ready, Away, and per-dish Done (`:1110-1170`, `:1053-1060`). Fire, Ready and Away
show only where the profile has `run-the-pass` and the board is not a monitor (`#drawsLevers`,
`:846-848`; `till-app.ts:12816`), and the seeded kitchen profile does not have it
(`device-profile.ts:118`); Done shows on every pass screen (`till-expo-screen.ts:940`, `:1017`)
(read). A pass screen keeps a dish until this device marks it Done; a monitor drops a
section once its dishes are away (`apps/server/src/pass-board.ts:51-127`) (read). It polls every 15 s
(`till-expo-screen.ts:64`) (read).

## 3. The design, as someone sees it

The counter till is A738–A739's and is not changed here. Everything below keeps today's rule that
the profile decides what a device may do and a hidden screen is not a missing permission
(`docs/developers/design-system.md:4886-4899`).

### 3.1 Handheld at phone width (pictures 01, 02)

**Top bar** (picture 01): **Floor**, the open table's tab named after the table (**T4**; no tab
before a table is opened), then **"?"** and **☰**. Nothing else. The person's name, the clock actions
and theme are in ☰ at phone width today (§2.2); the language chooser joins them (picture 01, right):

> ● Ana — Working · Break · Clock out · My hours
> Pass (only if the profile allows it) · Find a bill · My schedule · Profile (two or more profiles)
> Settings: Zones on this device · Card reader · printer · Language · Theme
> Log out

This follows A738's counter rule — everything secondary in ☰ for good — and goes further: A738
keeps the operator's name and Pass on the counter's bar (`docs/backlog/till.md`, "A738", "Top bar"),
while a phone has no room for them. Today the language chooser stays on the phone bar (§2.2); it
moves into ☰ (part (a)). A582's "?" stays on
the bar at every width, as the owner decided. On a tablet the bar has room for the name as well
(picture 06).

**Floor** (picture 01): the zone tabs, with A757's mark on a tab whose zone holds an urgent table, and
the zone's ⋯ menu (List/Map, Add spare, Taken off, Reset plan, as today). The tables are drawn as
A757 designs them (whole-table colour plus a cue: ⏱ Forgotten, ▶ Fire, € Bill, 🍽 2…), and A669's
red "!" for a table with an allergy. Two changes:
- **Ready dishes move to a bar at the bottom**: "🍽 Ready · T5 · 2 · T9 · 1 · Open ›", tapping a
  table opens it. It replaces today's Ready summary above the tables at phone width (part (b)); it
  shows only while something is ready. Above phone width the summary stays where it is.
- **List or Map is remembered on the device**, per zone, instead of for the session (today, §2.3). No
  question: it is what a waiter who prefers the list would expect.

**Order** (picture 02): under the bar, A803's bill switcher with Bill ⋯ and Table ⋯; under that, two
views side by side as a switch, **Menu** and **Order · 3** (the number counts the New order) (part
(c)).
- **Menu:** search and Filter (A738), the menus offered now (Cena, Bebidas, Postres), then the menu's
  Device Home Page and the rest of the menu as tiles, at the handheld's column count (W93; 3 by
  default). A number on a tile counts how many are in the New order. The bottom bar reads "New order ·
  3 items — 2 × Croquetas · 1 × Secreto" with **Send all**, so Ana can send without leaving the menu.
  Tapping the words opens Order.
- **Order:** A773's order panel, unchanged: the Sent box, the New order box with its groups, Move
  to…, Fire and Send all; then the bill's total, the table's remaining total (A803), and Hold · Pay.
  Pay shows only where the profile allows a payment, as today.
- **Which view a table opens on:** Menu when nothing has been sent yet; Order once anything has been
  sent, so Ana sees what is ready or due first (part (c)).
- A line's ⓘ opens A738's line window; allergy marks (A669) and "Lunch ended" (A789) show in the New
  order exactly as on the counter.

**Pass on a handheld** (picture 05, right): when the profile allows it, ☰ → Pass opens the pass as a
third tab; the three parts (§3.5) stand one under the other. That is close to A773's own single
list, which has two parts, Waiting for you to fire and In the kitchen, and keeps a ready group in
the second (A773 §5, its picture 6); a separate Ready part is this design's addition.

### 3.2 Handheld on a tablet (picture 06)

From 720 px wide, the order screen shows Menu and Order side by side, as it does today; the switch
goes. The floor is the same as on a phone with more tables in view.

### 3.3 Kitchen screen, wide (picture 03; dark 03-dark)

No bar. The corner keeps "?", theme and language (A582). A thin header names the station, its
Open/Closed-for-today state (tapping it opens today's control, which still needs a manager PIN), and
"5 dishes to make · 1 late".

**One card per table's group** (part (d)), in four columns as food moves: **Coming up** (A773: held
dishes, and dishes fired but waiting for the pass, drawn dimmed and dashed), **Waiting** (today's
"New", renamed by A773), **Preparing**, **Ready**. A card shows the table (or "Counter #12"), the
group and its course, the bill's name if it has one (A803), its timer, its dishes with their extras
and notes, the kitchen note, and A669's red allergy line under the dish it concerns. The coloured band
along its top is its age: green, then amber, then red, and a forgotten card pulses at A757's fast
speed (`docs/superpowers/specs/2026-10-17-a757-table-states-design.md:327-329`).
- **Tap a dish** to move that dish on one step; **tap the card's heading** to move every dish on the
  card one step. A card sits in the column of its least advanced dish. No Fire button: A773 removes
  it from stations (`docs/superpowers/specs/2026-10-16-a773-courses-and-groups-design.md:467-468`).
- **The Tickets view goes**, with its Board/Tickets switch: the card is the ticket. Merged/Stacked
  stays for a screen showing several stations.
- **"To make"** (part (e)): a narrow column on the right counting each dish waiting or being made
  ("Secreto ibérico 2"), with what is coming up after a + ("+2"). It is what a grill cook looks at
  to know how many steaks to put on.

### 3.4 Kitchen screen, narrow (picture 05, left)

Where four columns do not fit (below about 1000 px; the build measures), one column shows at a time
and the columns become tabs with counts ("Waiting · 2"); a tab holding a late card carries a red bar,
as A757's zone tabs do. "To make" becomes a tab at the end. A kitchen screen on a phone is not a
target; it gets the same tabs.

### 3.5 Pass, wide (picture 04)

No bar; the corner as on a kitchen screen. The header names the pass and what it covers (its zones
and stations). Three columns (part (f)), left to right as food moves:
- **To fire:** A773's "Waiting for you to fire": one card per requested group, oldest first, labelled
  New order, Next course or Added, with how long it has waited and **Fire**; lines at stations that do
  not wait are listed for information ("already at the Bar"), as A773 says.
- **In the kitchen:** each fired group with each dish's state and station ("Preparing · Grill").
- **Ready:** each group with dishes ready and how long ("ready 9 min"); a card stays until the waiter
  marks its dishes served or the table is cleared (A773 §5). No Done, no Away. A773 keeps such a
  group under In the kitchen; splitting it into its own column is this design's.

Cards carry the bill's name (A803) and A669's allergy line. A **pass monitor** shows the same columns
with no buttons. Below about 1000 px (a till's Pass, a handheld) the three parts stand one under the
other (picture 05, right).

### 3.6 What a venue chooses, and where

Nothing about the layout is a setting. What a venue chooses is what it chooses today, plus one
addition:

| Where | Choice | Today or new |
| --- | --- | --- |
| Profile (dashboard) | what its devices may do; zones; whether Pass, Kitchen and My schedule are offered; which kitchen screens its displays may show | today |
| Device (dashboard, Devices) | which station screen, pass or monitor a kitchen display shows | today |
| Device (on the device, ☰ → Settings) | **Zones on this device** on a handheld: which of the profile's zones it shows and which it opens on | **new on a handheld**, following "any device does everything" (§1); a till has it today |
| Device (on the device) | card reader and printer; Merged/Stacked on a several-station kitchen screen; List/Map per zone | today, List/Map now remembered |

## 4. Worked examples (Bar Santet, Saturday dinner)

1. **Ana, handheld.** 20:40. She signs in with her PIN and is on Floor, Inside. The Terrace tab shows
   ▶: T3 out there is due its mains. The bottom bar says "🍽 Ready · T5 · 2". She taps T5, which opens
   on Order (it has sent dishes); the Sent box is outlined; she takes the croquetas out and taps them
   served. Back on Floor she opens T4, newly seated: it opens on Menu. She adds 2 × Croquetas de jamón
   and a Secreto ibérico, which A773 places in Fire now and a held Mains group; at the first Send,
   A669 asks about allergies and she records seat 3, gluten. She taps Send all on the bottom bar
   without leaving the menu.
2. **Jordi, Grill kitchen screen.** The secreto for T4 appears under Coming up, dimmed, "Held".
   "To make" shows "Secreto ibérico 2 +2". When Ana fires T4's mains at 21:15, Grill waits for the
   pass, so the card stays under Coming up marked "Waiting for the pass" until Marta fires it, then
   moves to Waiting with a green band. Jordi taps the card's heading to start both dishes; when the
   secreto is plated he taps the dish, and the card moves to Ready only when the entrecot is ready
   too.
3. **Marta, the pass.** T4's mains arrive under To fire, labelled Next course, "waiting 0 min". Marta
   checks the starters have gone out and taps Fire; the card moves to In the kitchen with each dish's
   state. When both are ready it moves to Ready, "ready 1 min", and stays there until Ana marks them
   served. Later T4 adds patatas bravas on Bill 2, named Clint (A803): that card arrives labelled
   Added and says "T4 · Bill 2 · Clint", with the allergy line under the bravas reading
   "ALLERGY · Seat 3: Gluten (wheat)" (picture 04).
4. **A second handheld on the terrace.** Luis works only the terrace. On his phone, ☰ → Settings →
   Zones on this device, he leaves Terrace ticked and unticks Inside and Bar; his Floor shows no zone
   tabs. The profile still allows all three, so a manager's phone with the same profile shows them all.

## 5. What the server and data side needs

Mostly presentation over reads that exist; no migration is expected. Each point is (read) and the
plan confirms it before relying on it.
- **Kitchen cards per group** are built from the station read the screen already has
  (`GET /api/device/station-screen`, `apps/till/src/api/client.ts:3176-3182`), which carries course or
  group sections per order (`station-queue.ts:951-997`) (read). **Coming up** needs held and requested lines
  on that read, which A773-2 adds (A773 §5, `:468`, "Their new Coming up column holds held and requested
  lines").
- **"To make"** counts what the screen already holds; no new read.
- **The pass's columns** read what A773-2's rebuilt pass read returns; this design asks nothing more
  of it than A773 does.
- **Bill names** on kitchen cards and the pass come with A803's named-bill slice
  (`docs/superpowers/specs/2026-10-18-a803-bills-and-tables-design.md:78-82`).
- **Remembered List/Map and the opening view** are kept in the browser, as Merged/Stacked is today
  (`till-station-screen.ts:64`, `:312-329`).
- **Zones on a handheld.** The choice is stored per device and profile in `device_zone_selections`
  (`packages/venue-service/src/schema/device-zone-selection.ts:4-29`), which has no form-factor column
  or check; nor does its migration (`packages/venue-service/drizzle/0056_device_zone_selection.sql`,
  searched for `check`, `trigger` and `form_factor`). `GET` and `PUT /api/device/zones`
  (`apps/server/src/device-api.ts:336-367`) and the helper both use, `currentZoneDevice`
  (`apps/server/src/device-zones.ts:9-21`), do not check the form factor (read). What ties the choice
  to tills is the till app: it reads the selection at sign-in only on a till
  (`apps/till/src/till-app.ts:3928-3933`), narrows Floor's zones by it only on a till (`:12712-12716`),
  and shows Settings only on a till (`till-shell.ts:708`) (read). `deviceZoneNavigation` already
  keeps a handheld's table zones (`apps/till/src/state/device-zones.ts:14-17`) (read). One server
  reader applies the selection only on a till: `GET /api/default-service-zone/offers`, which picks a
  counter order's zone (`apps/server/src/till-api.ts:1423-1450`; on a handheld it falls back to the
  profile's zone, `:1447-1450`) (read). The plan decides whether that route should follow the
  selection on a handheld, and traces every reader before changing any. No migration is expected.

## 6. What is removed or retired

- **Handheld:** the language chooser on the phone bar (into ☰); the order screen's "Review (n)"
  button and its separate review view with its own Back, below 720 px (replaced by the Menu / Order
  switch and the bottom bar's Send all); the Ready summary above the floor at phone width (replaced
  by the bottom bar); the "Order" tab label (replaced by the table's name).
- **Kitchen screen:** the Tickets view and the Board/Tickets switch; the per-dish cells of today's
  Board (replaced by group cards); "New" as a column name (A773's "Waiting").
- **Pass:** the wrapping row of order cards on a wide screen (replaced by three columns). Done, Away
  and the venue-wide fire control are A773-2's removals, not this design's.

Each string that goes is removed in English and Spanish in the same slice.

## 7. How this meets the other designs, and what waits for what

- **A773 (courses, groups and the pass).** The handheld's Order view is A773's order panel as
  designed for phone width (A773 §3.6, picture 4); this design only decides how it shares the phone
  with the menu. The kitchen screen's four columns and the pass's three parts are A773's states laid
  out for a wide screen. Lane G is building A773-1 now; **the handheld order slice waits for A773-1**,
  and **the Coming up column and the pass slice wait for A773-2**. If A773-2's plan is written after
  Q42 is answered, it can build its pass and station changes straight into these layouts, and slices
  6–7 shrink to what is left.
- **A803 (bills and tables).** The bill switcher and its two ⋯ menus sit under the handheld's bar;
  bill names reach the kitchen and the pass. The handheld order slice also waits for A803's switcher
  slice; until then it keeps today's bill controls.
- **A757 (table states).** The floor's table colours, cues, pulses and zone-tab marks are A757's.
  A757's design is approved: the owner answered Q15–Q20, and on 2026-10-17 answered Q29–Q34 all "A"
  (lane C's questions file, "OWNER ANSWERS (2026-10-17 …) — A757 revised, Q29–Q34"; the A757 spec's
  own status line, `a757-table-states-design.md:3-4`, still calls them open). Among them, Ready does
  not pulse (Q33), which this design follows. The handheld floor draws whatever A757 lands. The kitchen screen and pass use A757's fast
  pulse token for Forgotten.
- **A738–A739 (the counter).** Same rule for ☰, same line window, same Filter, same Hold · Pay. The
  counter is not changed here.
- **A582 (help mode).** The "?" stays on the handheld bar at every width and in the kitchen and pass
  corner. A582's badges will explain the new parts (the bottom bar, the columns, "To make").
- **A789 (last orders).** Its "Lunch ended" mark and window appear in the handheld's New order as on
  the counter; its "After Lunch — agreed" mark appears on a kitchen card and a pass card.
- **A668 / A669 (allergens, an allergy at the table).** A669's red "!" on the floor, its marks in the
  New order, and its red allergy line on kitchen and pass cards
  (`docs/superpowers/specs/2026-10-14-a669-allergy-at-the-table-design.md:172-174`, `:197-198`) are
  drawn where those cards sit here; A669 builds them.

## 8. Build slices

Each is one pull request one implementer can finish well under ~100 tool calls, and leaves `main`
working. Review path: **FULL** when the slice touches a till write route, a live-subscription source,
a cross-package contract or a migration; **LIGHT** otherwise.

1. **The handheld's bar.** The open table's name as the tab; language and theme into ☰ at phone
   width; the order of ☰'s items. Till app only. LIGHT. Independent.
2. **Zones on this device on a handheld.** ☰ → Settings on a handheld; the till app reads the
   selection at sign-in and narrows Floor by it on a handheld as on a till, and the plan decides
   whether `GET /api/default-service-zone/offers` follows it too (§5). FULL (it changes which zones a
   signed-in device works in, and may change a till route). Independent.
3. **The handheld floor's Ready bar and remembered List/Map.** LIGHT. Independent of A757; draws the
   tables as they are drawn when it lands.
4. **The handheld order at phone width:** the Menu / Order switch, the bottom bar with Send all, the
   tile counts, the opening view. LIGHT (it calls A773's existing Send). **Waits for A773-1** and,
   for the switcher row, A803's switcher slice.
5. **Kitchen screen cards:** one card per group in today's three columns, tap a dish or a heading,
   the age band, the header line; the Tickets view goes. LIGHT while the heading tap reuses today's
   per-dish device route, as a kitchen display's whole-order bump already does
   (`till-station-screen.ts:604-625`; `apps/server/src/device-api.ts:579`); FULL if it needs a new
   write route. Independent of A773, but A773-2 edits the same station files, so the two are not
   built at the same time.
6. **"To make" and the narrow kitchen tabs.** LIGHT. After 5.
7. **Coming up on the kitchen screen, and the pass's three columns** (and its single list when
   narrow). LIGHT if A773-2 has already changed the reads; **waits for A773-2**, and is folded into
   A773-2's own slices if its plan is written after Q42.

Order: 1, 2, 3 and 5 can run in any order; 4 after A773-1; 6 after 5; 7 after A773-2.

## 9. Not decided here

- Exact widths where the kitchen screen and pass switch to tabs or a single list; the build measures
  on a real kitchen tablet.
- A larger text size for kitchen screens read from a distance, kept on the device. Not asked: no
  owner report of small text yet.
- A "My tables" filter on the handheld floor. Whether a party records its waiter was not checked.
- Whether a dish leaves a station's Ready column on its own; today's rule is kept and the plan traces
  it.
- What becomes of the venue's bump mode (one dish or the whole order per tap, `station-queue.ts:656-676`)
  once a dish tap and a heading tap both exist; the plan traces where it is set and read before
  removing or keeping it.
- The wording of the bottom bar and the opening rule's edge cases (a table with only served dishes
  opens on Order).
- Exact Spanish strings: "Por marchar", "En cocina", "Listo" for the pass columns, and "Por hacer"
  for "To make", are the builder's proposals for the owner's review at land.

## 10. The owner's question (Q42)

**Q42. Do you approve the handheld, kitchen screen and pass as designed, with these choices?** "All
recommended" is a complete answer.

- **(a) The handheld's top bar** (picture 01). Recommended: **Floor, the open table (T4), "?" and ☰;
  the language button joins your name, the clock and theme in ☰**, which are already there at phone
  width. Alternative: keep the language button on the bar, as today. (Not asked: a handheld gets a
  till's "Zones on this device" in ☰ → Settings, following "any device does everything"; example 4.)
- **(b) Ready dishes on the handheld floor** (picture 01). Recommended: **a bar at the bottom,
  "🍽 Ready · T5 · 2 · T9 · 1", tap to open the table**. Alternative: keep today's Ready list above
  the tables.
- **(c) The handheld order** (picture 02). Recommended: **two views, Menu and Order, switched under the
  bill line; the menu's bottom bar shows the new order and Send all; a new table opens on Menu, a
  table with anything sent opens on Order**. Alternative: as today, the menu with a "Review (3)"
  button, and Send only from the review.
- **(d) The kitchen screen's cards** (picture 03). Recommended: **one card per table's group, across
  Coming up · Waiting · Preparing · Ready; tap a dish to move it on, tap the heading to move the whole
  card; the Tickets view goes**. Alternative: keep today's two views (a row per dish, or a card per
  order), chosen on each screen.
- **(e) "To make" on the kitchen screen** (picture 03). Recommended: **a column on the right counting
  each dish waiting or being made, with what is coming up after a +**. Alternative: none.
- **(f) The pass on a wide screen** (picture 04). Recommended: **three columns, To fire · In the
  kitchen · Ready** (A773's "Waiting for you to fire" shortened to "To fire", and ready groups given
  their own column). Alternative: A773's single list, top to bottom, at every width. On a phone or
  till it is one list either way (picture 05).
- **(g) The order of the work.** Recommended: **the seven slices in §8, in that order**, with A773-2
  building its pass and station parts straight into these layouts.
