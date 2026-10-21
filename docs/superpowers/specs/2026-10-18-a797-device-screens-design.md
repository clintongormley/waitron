# A797 — The fixed screens for the handheld, the kitchen screen and the pass (A182 part 1)

Status: **design REVISED 2026-10-21 for the owner's answer to Q42** (2026-10-18 ~22:55: parts
(a)–(f) approved with changes, (g) approved; lane C's questions file, "OWNER NOTES on Q42 (A797)"
and "OWNER ANSWER to Q42 … COMPLETE"). Every owner note is folded in below; §10 records the answer
and asks **Q51**, only what the notes leave open. **Settled by the notes, buildable without Q51:**
§8's slices 1–5, 8–9c now (slices 1–3 build the recommended short-name rule and button mark,
which another Q51 answer changes in one place); 10–11 once A803's slice 3 lands; 12, which A773-2
builds, and 12b after it. **Waiting on Q51:** slices 6–7, until (c) says where the Ready bar's warning time lives.
New words wait for (f) and (g) before landing, not before building. The first version (2026-10-18) is kept where it records what was true: §2 is unchanged.
Backlog entries: `docs/backlog.md` "Design the fixed screens for each kind of device" (two entries) and
[its detail](../../backlog/till.md#build-good-screens-for-each-kind-of-device-and-retire-canvases-a182-owner-2026-10-01).

Pictures, in `docs/backlog/mockups/a797-device-screens/` (redrawn for this revision; `-dark` is the
dark theme): **01** `01-handheld-floor` (+ dark), **02** `02-handheld-order`, **03**
`03-kitchen-screen` (+ dark), **04** `04-pass`, **05** `05-narrow`, **06** `06-handheld-tablet`,
**07** `07-columns-settings`, **08** `08-unoccupied-dashes` (+ dark), **09** `09-short-names`. They
are drawn in HTML with the apps' colour values (`packages/ui-core/src/tokens/colors.css`), not
screenshots of the running till; symbols such as 🍽 ⏱ ▶ ✎ stand in for icons the build draws with
`wt-icon`. The generator is kept outside the repository. Where a picture and this text disagree,
the text wins.

File references in §2 are to `main` at `9c8c4c08e`; the rest are to `main` at `9eb9ac6e8`.
**(read)** marks a conclusion from reading code, not from running it. Nothing in this design was
run: it changes no behaviour, and every statement about today's code is (read). The plan re-reads
each citation before relying on it.

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
  ready means cooked and waiting to go out; served means at the table. The owner's "one card per
  batch" (Q42 (d)) means one card per **group**; this design says group.
- A773's **order panel** has a **Sent** box (everything already sent) above a **New order** box (what
  the waiter has added but not sent). **Unsent dishes** are the dishes in a New order.
- A803's **bill switcher** is the drop-down, "Bill 1 of 2 · €38.50 ▾", that picks which of a
  table's bills is on screen; after the owner's Q42 changes it sits beside one **⋮ menu** (a kebab
  menu: three dots opening a list of actions).
- A table's **short name** is a second, short name for it ("T1" for "Terrace 1"), new in this
  revision (§3.7).
- **☰** is the menu button at the right of the top bar. The **"?"** beside it turns help mode on
  (A582).
- A **zone** is an area of the venue (Inside, Terrace, Bar). The **Device Home Page** is the block of
  shortcut tiles a menu shows first on a device (W93).
- **Quiet** describes a button drawn in the plain `secondary` look because something rules its
  action out for now (`docs/developers/design-system.md:2659-2667`, owner decisions A416 and A427).

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
a question (§3.6); product text as short as the meaning allows; **"same language everywhere"**
(owner, Q42, 2026-10-18 ~22:40): one word per meaning across the kitchen screen, the pass and the
till (§3.8).

## 2. What exists today

_2026-10-21: left as written at `9c8c4c08e`. Many line numbers have moved since: A738's cleanup
(#1905) rebuilt the till's bar, the floor's Ready summary is now at
`apps/till/src/screens/till-floor-screen.ts:2801-2810` (read), and A773-1 (#1897) has landed._

### 2.1 Which screens a device gets

`builtInScreensFor` gives a till Counter and Floor, a handheld (`phone-portrait` or
`tablet-landscape`) Floor and Order, and a kitchen display (`kds`) Kitchen; the first is home
(`apps/till/src/built-in-screens.ts:5-18`) (read). Both handheld form factors map to one device kind
and get the same screens; nothing else in `apps/till/src` tells them apart, so a tablet differs from a
phone only by width (`apps/till/src/layout.ts:29-31`) (read). The seeded handheld profile, "Móvil",
may take orders, take hand-keyed card payments, prepare, hand over and clock in; it may not take cash,
use an integrated card reader or print receipts; the tablet profile has no capabilities and is not
seeded (`packages/layouts/src/device-profile.ts:110-117`, `:132-150`) (read).
_2026-10-20: superseded for Móvil by A796's default 15 — Móvil takes reader cards and cash and
prints receipts, never the drawer
([2026-10-19-a796-handheld-payments-design.md](2026-10-19-a796-handheld-payments-design.md), §8);
this paragraph is left as it was written._

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
(`docs/developers/design-system.md:4886-4899` at `9c8c4c08e`).

### 3.1 Handheld at phone width (pictures 01, 02)

**Top bar** (picture 01): **Floor**, then **one button per table where the signed-in person has
unsent dishes**, then **"?"** and **☰**. A button reads **"✎ T4"**: A757's Unsent cue (✎, the map's
"Unsent", `apps/till/src/i18n/strings.ts:935`) before the table's short name (§3.7). The table on
screen is drawn highlighted, like a selected tab. The owner's rules (Q42 (a)):
- **Several bills at one table with this person's unsent dishes give one button.**
- **Tapping it opens the table on the bill this person last worked on, if it still has their unsent
  dishes; otherwise on another of their bills there with unsent dishes.** "Last worked on" is the
  bill whose New order this person saved most recently (`order_drafts.updated_at`,
  `packages/db/src/schema/order-drafts.ts:37`), so it holds on a second phone signed in as the same
  person; a tie goes to the lower bill number.
- **The button goes when the person has no bill there with unsent dishes**: all sent, or every such
  bill taken over by someone else (A773's one editor per bill). A bill has one open New order at a
  time (`order_drafts_open_owner_uq`, `order-drafts.ts:51-53`), so "this person's unsent dishes"
  means the bills whose open New order is theirs (read).
- **Floor, tapped after leaving a table, opens on that table's zone**, not the zone viewed before.
- **The bar once a table is finished** (the owner asked this to be said): while the table is on
  screen it keeps its highlighted button, without ✎ once nothing of this person's is unsent there;
  when the person leaves it, the button goes. A finished table (Finish table, or the party gone)
  has no New order left, so it never has a button. With no unsent dishes anywhere the bar is Floor,
  "?" and ☰.
- **"✎ T4" rather than "‹ T4"** (the owner asked whether a plain "T4" reads as "back to T4"):
  recommended, because the button is there *because* something is unsent, and ✎ says that with the
  same mark the map draws on the same table; the highlighted button says "you are here". A "‹"
  says "go back" but not why, and a phone's own back gesture already means "previous screen". The
  alternative is Q51 (b).
- **A bill switcher that hides unsent dishes** (picture 02): when another bill of the table holds
  this person's unsent dishes, the closed switcher says so — "Bill 1 of 3 · €67.00 ▾ · ✎ Bill 2
  unsent" — and the open list marks that bill "✎ Unsent" the same way. The owner's example said
  "not sent"; the till's word for it is "Unsent" ("Sin enviar", `strings.ts:935`, `:2637`), and the
  owner's same-language rule keeps that one word (§3.8).

Everything else is in ☰: the person's name and clock actions, theme and, new, the language chooser
(picture 01, right):

> ● Ana — Working · Break · Clock out · My hours
> Pass (only if the profile allows it) · Find a bill · My schedule · Profile (two or more profiles)
> Settings: Zones on this device · Card reader · printer · Language · Theme
> Log out

On a tablet the bar has room for the name as well (picture 06). A582's "?" stays on the bar at every
width.

**Floor** (picture 01): the zone tabs, with A757's mark on a tab whose zone holds an urgent table,
the zone's ⋯ menu (List/Map, Add spare, Taken off, Reset plan, as today), and the tables drawn as
A757 built them (whole-table colour and a cue; A669's red "!" for an allergy). Changes:
- **The Ready bar** at the bottom of the screen: "🍽 Ready · T5 · 2 · T9 · 1 · Open ›"; tapping a
  table opens it, and Open › opens the table whose food has waited longest. It shows only while
  something is ready, and replaces at phone width today's summary above the tables
  (`#stationSummary`, `till-floor-screen.ts:2801-2810`) (read). Above phone width the summary stays
  where it is, retitled from "Ready to serve" to "Ready" so the word is the bar's (Q51 (f)).
- **The Ready bar warns when food waits** (owner, Q42 (b)): once a ready dish has waited at the pass
  longer than its station's **ready warning time** (3 minutes by default, §3.6; Q51 (c)), the bar
  turns amber (`--wt-color-warning`, `packages/ui-core/src/tokens/colors.css:26`, dark `:161`) and
  pulses slowly at A757's slow speed (`--wt-duration-pulse-slow`, 2 s,
  `packages/ui-core/src/tokens/structure.css:49`), its edge dimming to `--wt-color-warning-pulse-dim`
  as A738's Waiting tab does. It names the table waiting longest first, with the minutes: "🍽 Ready
  4 min · T5 · 2 · T9 · 1 · Open ›". Under reduced motion nothing moves and the amber stays. The minutes count
  from the moment the dish was ready (`ticket_items.ready_at`, stamped by `advanceSet`,
  `apps/server/src/working-order.ts:7233-7237`), not from when it was fired (§5).
- **List or Map is remembered on the device**, per zone, instead of for the session.

**Order** (picture 02), under the bar:
- **A803's controls as the owner changed them** (Q42, picture 02; lane G's A803 queue entry): the
  bill drop-down shows **even with one bill** ("Bill 1 · €38.50 ▾"), so "+ New bill" is always in
  it; **one ⋮ menu** replaces Bill ⋯ and Table ⋯, with a "Bill 1" section and a "Whole table"
  section; **Full invoice moves to the payment step**; **no Hold on the table screen**. A803's
  slice 3 builds these (`docs/superpowers/plans/2026-10-19-a803-bills-and-tables.md:241-294`).
- **Two views as a switch, Menu and Order · 3** (the number counts the New order).
- **Menu:** search and Filter (A738), the menus offered now (Cena, Bebidas, Postres), then the menu's
  Device Home Page and the rest as tiles, 3 across by default (W93). A number on a tile counts how
  many are in the New order. **A bar fixed at the bottom** while the menu scrolls, shown only while
  the New order has something: "New order · 3 items — 2 × Croquetas · 1 × Secreto" with **Send
  all**. Tapping the words opens Order.
- **Order:** A773's order panel (the Sent box; the New order box with its groups, Move to… and Fire).
  **Its foot is fixed** too: the bill's total, the table's remaining total (A803) and **Pay**, with
  **Send all** above them while this bill has unsent dishes. **Pay is quiet while this bill has
  unsent dishes**, still tappable, and a tap explains "Send or remove the unsent dishes before
  paying." (`strings.ts:1451`); another bill's unsent dishes do not quiet it. Pay shows only where
  the profile allows a payment.
- **Which view a table opens on:** Menu when nothing has been sent yet; Order once anything has.
- A line's ⓘ opens A738's line window; allergy marks (A669) and "Lunch ended" (A789) show in the New
  order exactly as on the counter.

**Pass on a handheld** (picture 05, right): when the profile allows it, ☰ → Pass opens the pass as a
list whose parts follow the pass's columns, in the order chosen for it (§3.5).

### 3.2 Handheld on a tablet (picture 06)

From 720 px wide the order screen shows Menu and Order side by side, as today; the switch goes. The
bar's table buttons, the Ready bar and its warning are as on a phone.

### 3.3 Kitchen screen, wide (pictures 03, 03-dark)

No bar. The corner holds "?" (A582), theme, language and, new, **Columns** (§3.6). A thin header
names the station, its Open/Closed-for-today state (tapping it opens today's control, which still
needs a manager PIN), and "5 dishes to make · 1 late".

**Columns**, left to right by default (Q42 (d), (e) and the Held note):
- **Overview** (first; was "To make"): one row per dish waiting or being made, with its count
  ("Secreto ibérico 2"), and after a + how many are held ("+2"). It is what a grill cook reads to
  know how many steaks to put on. Shown by default on a kitchen screen.
- **Held** (was "Coming up"): held dishes, and dishes fired but waiting for the pass, the second
  marked **"Waiting for the pass"**. Both are held from the station's point of view: it must not
  start them. Drawn dimmed and dashed.
- **Waiting** (released, not started), **Preparing** (the cook has started), **Ready**.

**One card per group** (Q42 (d)), or per counter order. A card shows the table's short name (or
"Counter #12"), the group and its course, the bill's name if it has one (A803), its timer, its
dishes with extras and notes, the kitchen note, and A669's red allergy line under the dish it
concerns. The band along its top is its age: green, then amber, then red; a forgotten card pulses at
A757's fast speed.
- **Tap a dish** to move it on one step; **tap the card's heading** to move every dish on it one
  step. A card sits in the column of its least advanced dish. No Fire button (A773).
- **The Tickets view goes**, with its Board/Tickets switch: the card is the ticket. Merged/Stacked
  stays for a screen showing several stations.
- **Tap a column's heading to collapse it** (Q42 (e)): a collapsed column keeps its heading and
  count ("Ready · 3"); one tap reopens it. Every column; remembered on the device.
- **Column order is not changed on the live screen** (the owner withdrew long-press dragging, so
  nobody reorders by mistake mid-service): it is set in corner → Columns (§3.6, picture 07).

### 3.4 Kitchen screen, narrow (picture 05, left)

Where the columns do not fit (below about 1000 px; the build measures), one column shows at a time
and the columns become tabs with counts ("Waiting · 2"), **in the chosen order, so Overview is the
first tab** by default; a hidden column has no tab. A tab holding a late card carries a red bar, as
A757's zone tabs do. A kitchen screen on a phone is not a target; it gets the same tabs.

### 3.5 Pass, wide (picture 04)

No bar; the corner as on a kitchen screen. The header names the pass and what it covers (its zones
and stations). Columns, left to right by default (Q42 (f)):
- **Overview** (optional, **off by default** on the pass, the owner's call; first when shown, a
  proposed default): the same counts, over what this pass sees.
- **Held** (optional; shown by default, a default this design proposes and the owner can change):
  held courses, in firing order.
- **To fire:** one card per requested group, oldest first, labelled with what it is (Next course,
  Added, or a table's first order: wording in Q51 (f)), with how long it has waited and **Fire**.
- **In progress** (was "In the kitchen": the station may not be a kitchen): each released group not
  yet all ready, each dish's state and station ("Preparing · Grill").
- **Ready:** each group whose every station's part is ready, with how long ("ready 9 min"); a card
  stays until the waiter marks its dishes served or the table is cleared (A773 §5). No Done, no Away.

**Dishes from stations that do not wait for the pass** (the Bar's vino tinto) are listed in their
group **dimmed, with their state and station** ("Vino tinto · Ready · Bar"), for information only:
no button touches them, and hiding them changes neither a group's readiness nor what Fire releases
(A773-2 plan, line 97). Whether they show is set in the profile and on the device (§3.6; Q51 (d)).

The pass has the kitchen screen's column features: tap a heading to collapse; order and show/hide in
Columns; remembered on the device. Cards carry the table's short name, the bill's name (A803) and
A669's allergy line. A **pass monitor** shows the same columns with no buttons. Below about 1000 px
(a till's Pass, a handheld) the columns become sections of one list, in the same order, each
collapsible by its heading (picture 05, right). On a till or handheld, where the pass sits under the
bar, **Columns** is a button in the pass's own header.

### 3.6 What a venue chooses, and where

Nothing about the layout is a setting except what the owner made one in Q42.

| Where | Choice | Today or new |
| --- | --- | --- |
| Profile (dashboard) | what its devices may do; zones; whether Pass, Kitchen and My schedule are offered; which kitchen screens its displays may show | today |
| Profile (dashboard), per pass and pass-monitor choice | **Other stations' dishes**: show the dimmed dishes of stations that do not wait for the pass (default: show) | new (A773-2 builds it) |
| Device (dashboard, Devices) | which station screen, pass or monitor a kitchen display shows | today |
| Device (on the device, corner → **Columns**, or the pass header's Columns on a till or handheld; picture 07) | **per screen** (and per station screen): the columns in order with move up / move down, a **Show** switch for each (on a kitchen screen the owner named Overview's; the same switch for every column is this design's call, as A773-2's plan has it, line 101), and on a pass **Other stations' dishes**: Profile setting / Show / Hide | new; the order, shown and collapsed columns are kept in the device's browser (A773-2 plan, line 101, `waitron.kitchenColumns.v1.`); the dishes choice is kept on the server against the device |
| Device (on the live screen) | which columns are collapsed (tap a heading) | new, remembered on the device |
| Device (on the device, ☰ → Settings) | **Zones on this device** on a handheld | new on a handheld, following "any device does everything"; a till has it today |
| Device (on the device) | card reader and printer; Merged/Stacked on a several-station kitchen screen; List/Map per zone | today, List/Map now remembered |
| Venue (dashboard, Venue settings → Kitchen → **Late flags**, `apps/dashboard/src/screens/venue-settings-screen.ts:11`, `kitchen-screen.ts:22-28`; each station may override, `packages/venue-service/src/dashboard/station-editor.ts:54-59`) | **Ready warning after (min)**: 3 by default, a fourth field after "Warm after", "Overdue after" and "Forgotten after" | new (Q51 (c)) |
| Venue (dashboard, floor-plan editor) | each table's **short name** | new (§3.7) |

**How the profile's and the device's "Other stations' dishes" combine** (recommended, Q51 (d)): the
profile sets the default for its passes; a device may choose Show or Hide for itself, or "Profile
setting" to follow the profile, which is where every device starts. So a manager who changes the
profile changes every pass that has not chosen for itself. A773-2's plan proposes the same (its author's choice, not the
owner's: `deviceOverride ?? profileDefault`, plan line 99), so the two designs agree. The device's
choice is kept on the server against the device (A773-2's nullable override, plan lines 99–100),
not in its browser like the columns, so a manager can see it and it survives a cleared browser.

### 3.7 Table short names (picture 09)

Every table gets a **short name** beside its full name (owner, Q42 (a), ~21:12).
- **Filled in automatically** from the full name when the table is made or renamed (Q51 (a)):
  "Terrace 1" → "T1", "Top floor 1" → "TF1", and a name already that short is kept ("12", "B2"). The
  field shows the automatic value, and the venue may type over it.
- **Unique in the venue.** Saving a short name another table already uses is refused, with the
  refusal under the Short name field ("Terrace 1 already uses T1"), so the venue changes one ("Top
  floor 1" → "TF1"). When the automatic short name clashes, it is still proposed in the field and
  the save refuses it the same way; nothing picks another one silently. Compared ignoring case
  ("t1" is "T1"), and enforced by the database (§5).
- **Where it shows:** tight places show the short name — the handheld's bar buttons, the Ready bar,
  kitchen-screen cards and pass cards. The table's own header and receipts show the full name.
- **Where it is edited:** the floor-plan editor's table panel (its Name field,
  `apps/dashboard/src/screens/floor-plan-table-panel.ts:235`), Add tables, whose automatic naming
  (a prefix and a number, `floor-plan-add-tables.ts:282-306`) proposes a short name for each new
  table in its preview, and Add joined table (`floor-plan-add-joined-table.ts:263`).
- **Other screens that should read it** (this design's proposal; each is a later, separate choice):
  the floor map, in place of the full name where the full name does not fit (today a name is hidden
  on a table drawn under 28 px, `NAME_MIN_PX`, `packages/ui/src/floor-plan-geometry.ts:5`); and the
  printed kitchen ticket's table line (`tableLabel`, `apps/server/src/kitchen-ticket.ts:68`, `:77`),
  which prints the full name today. Both are listed in §9, not built here.

### 3.8 One word per meaning

The owner's rule (Q42, ~22:40): **"Same language everywhere."** Every column or label word on the
three screens, with its one meaning. K = kitchen screen, P = pass, T = till and handheld; "Q51 (f)"
marks a clash this design asks about. File references are to `apps/till/src/i18n/strings.ts` unless
named.

| Word | Where | Its one meaning | Conflict |
| --- | --- | --- | --- |
| Overview | K, P column | counts of dishes waiting or being made, held ones after a + | none |
| Held | K, P column; T group and table state ⏸ | sent, but not to be cooked yet (on K also: fired, waiting for the pass) | **Find a bill's "Held" filter** (`:557`, «En espera» `:2273`) means an open order at no table with nothing paid (`apps/server/src/find-bill-bills.ts:81-83`), not a held course. The owner chose «En espera» for held dishes on 2026-10-20 "matching the order screen, station and find page" (lane C's questions file, "OWNER ANSWER — #1914 R4") — kept, Q51 (f) |
| Waiting for the pass | K (in Held); T (Sent box, "1 waiting for the pass") | fired by the waiter, not yet released by the pass (A773's Requested) | A773 §3.3 and A773-2's plan (line 229) write "at the pass", which also reads as "ready, standing at the pass" — Q51 (f) |
| To fire | P column | requested groups this pass must fire | A757's "Time to fire" (T) is the waiter's own Fire; the same action by a different person, kept |
| Waiting | K column; T table state | K: released to the station, not started; T: a fired dish older than the first limit | **also** the till bar's **Waiting** tab (`:310`, «En espera» `:2039`): counter orders sent and not paid, or paid and not handed over (`apps/till/src/api/client.ts:1283-1285`), from A738's owner-approved counter design (`docs/backlog/till.md:2267`) — kept, Q51 (f) |
| Warm (dashboard) | Late flags "Warm after (min)" «Tibio a partir de (min)» (`apps/dashboard/src/i18n/strings.ts:1266`, `:4317`); station editor "Warm" «En demora» and "Warm after (min)" «Aviso a partir de (min)» (`packages/venue-service/src/dashboard/strings.ts:225`, `:252`, `:1136`, `:1164`) | the limit after which T says Waiting | two English words for one meaning, and three Spanish ones; Overdue likewise: «Atrasado a partir de» (`apps/dashboard/src/i18n/strings.ts:4318`), «Retrasado» and «Atraso a partir de» (venue-service `:1137`, `:1165`), «Con retraso» on T (`:2729`) — Q51 (f) |
| Preparing | K column; T row status (`:1075`) | the cook has started | the station editor says "Being made" (venue-service `:223`). Spanish: «Preparando» on K (`:2374`), «En preparación» on T (`:2771`), the word the owner chose for "preparation started" on 2026-10-19 (A758 design, D23, `docs/superpowers/specs/2026-10-17-a758-adjustment-reasons-design.md:76`, `:864-871`) — kept, Q51 (f) |
| In progress | P column | released and not yet all ready (waiting or preparing) | **the till's payment state** "In progress" «En curso» for a payment still going through (`:1557`, `:3248`; the schema allows that state for either method, `packages/db/src/schema/bill-payments.ts:22-23`), built in #956; A796's decided design uses «En curso» for it (`docs/superpowers/specs/2026-10-19-a796-handheld-payments-design.md:511`); I found no owner decision naming the word — Q51 (f) |
| Ready | K, P column; T table state, rows, Ready bar | cooked, waiting to go out (on P: every station's part) | above phone width the floor's summary is titled "Ready to serve" «Listo para servir» (`:1007`, `:2705`) — Q51 (f) |
| Unsent | T map cue, bar ✎, switcher mark | in a New order, not sent | none; the owner's "not sent" example is written "Unsent" |
| New order | T box | this bill's unsent dishes | **A773's pass card label "New order"** means a table's first send or a counter order (A773 design `:430-431`; A773-2 plan line 90) — Q51 (f) |
| Added, Next course | P card labels | a later addition fired; a held group fired | none |
| Overdue, Forgotten | K card band; T table states | late against the station's limits | Overdue's Spanish, see Warm |

## 4. Worked examples (Bar Santet, Saturday dinner)

1. **Ana, handheld.** 20:40. She signs in and is on Floor, Inside. The bar reads Floor, "?" and ☰.
   She opens T4, newly seated: it opens on Menu. She adds 2 × Croquetas and a Secreto ibérico; the
   fixed bar at the bottom shows "New order · 3 items". T9 waves, so she taps Floor: it opens on
   Inside, T4's zone, and the bar now reads **"✎ T4"**. At T9 she adds two drinks and sends them from
   the fixed bar; while she is on T9 its button stays highlighted, without ✎, and goes when she
   leaves. She taps **✎ T4**, which opens Bill 1, the bill she was working on; at the first Send,
   A669 asks about allergies and she records seat 3, gluten. Pay sat quiet until she sent.
2. **Ana, the Ready bar.** 20:44: "🍽 Ready · T5 · 2 · Open ›" at the bottom of Floor. At 20:47 the
   croquetas for T5 have been ready 3 minutes: the bar turns amber and pulses slowly, "🍽 Ready
   3 min · T5 · 2 · Open ›".
   She taps T5, which opens on Order, and marks them served; the bar goes.
3. **Ana, two bills.** Later Clint, at T4, wants his own bill. Ana adds Bill 2 from the drop-down and
   puts patatas bravas in it, then goes back to Bill 1 to add bread. The switcher reads "Bill 1 of 2
   · €38.50 ▾ · ✎ Bill 2 unsent", so she does not forget the bravas. T4 still has one button.
4. **Jordi, Grill kitchen screen.** Overview, first on the left, shows "Secreto ibérico 2 +2". T4's
   mains sit under **Held**. When Ana fires them at 21:15, Grill waits for the pass, so the card
   stays under Held marked "Waiting for the pass" until Marta fires it, then moves to Waiting with
   a green band. Jordi taps the card's heading to start both dishes; when the secreto is plated he
   taps the dish, and the card moves to Ready only when the entrecot is ready too. The runners take
   food from the pass, so he has collapsed Ready to its heading, "Ready · 3"; it stays collapsed
   after a restart. The head chef set the column order once, in corner → Columns.
5. **Marta, the pass.** Held shows T7's desserts, held. T4's mains arrive under To fire, labelled
   Next course, "waiting 0 min". She checks the starters have gone out and taps Fire; the card moves
   to **In progress** with each dish's state; in the same group "Vino tinto · Ready · Bar" is dimmed,
   because the Bar does not wait for the pass. When both mains are ready the card moves to Ready,
   "ready 1 min", and stays until Ana marks them served. Clint's bravas arrive labelled Added, "T4 ·
   Bill 2 · Clint", with "ALLERGY · Seat 3: Gluten (wheat)" under them (picture 04). Overview is
   off on her pass, as by default.
6. **Luis, terrace only.** In ☰ → Settings → Zones on this device he unticks Inside and Bar; his
   Floor shows no zone tabs, while a manager's phone with the same profile still shows all three.

## 5. What the server and data side needs

Each point is (read); the plan confirms it before relying on it.
- **Short names** (slice 1). Tables are kept twice: the saved plan's tables (`floor_plan_tables`,
  name unique per zone, `packages/db/src/schema/floor-plans.ts:121-131`) and the live tables
  (`dining_tables`, name unique per venue, `packages/db/src/schema/dining-tables.ts:19`, `:27`); a
  reset makes live tables from the plan's (`apps/server/src/floor-today-store.ts:684-689`). Both
  gain a short name, the live table's unique per venue. A save checks names across the venue
  (`namesTaken`, `apps/server/src/floor-plan.ts:313-324`, refusing at `:378-383`); short names need
  the same check, the reset's temporary renaming (`spareLabels`, `floor-today-store.ts:840-857`)
  must cover them too, and the save fills a missing one by Q51 (a)'s rule so a seed or import that
  sends none still gets one. **Case:** today the dashboard's save compares names exactly
  (`taken.has(label)`, `floor-plan.ts:382`), the till's renaming ignores case (`sameName`,
  `apps/server/src/floor-today-name.ts:16-18`), and the database key on names
  (`dining_tables_location_label_key`) compares exactly. Recommended for short names: ignore case,
  since "t1" and "T1" read alike at a glance, and let the database enforce it on the live tables
  through a stored lower-cased copy of the short name under a plain unique key with the venue, not
  an index on `lower(short_name)`: CLAUDE.md §3 records that a drizzle-kit 0.31.11 rebuild writes an
  expression index back in a form this engine refuses. Nothing in the database ties that copy to
  the short name (a CHECK would force a rebuild of the table), so every writer must fill both; the
  plan lists the writers and tests each. The plan's tables have no venue column, so the save's check
  guards them, as it guards names. **Error code `table.short_name_taken`**
  (`{ shortName, takenBy, field: "shortName" }`, `takenBy` the other table's full name, so the
  refusal can say "Terrace 1 already uses T1"), beside `table.label_taken`
  (`apps/server/src/errors.ts:377`): the domain is the table, as its siblings' is. It joins the HTTP status maps (`till-api.ts:551`,
  `management-api.ts:270`) and both apps' code catalogues (`apps/dashboard/src/i18n/codes.ts:578`,
  `apps/till/src/i18n/codes.ts:189`). **Migration**, a schema change on a pre-live database: no
  backfill code, a venue reset is acceptable, said in the PR's first line. The plan must not let
  drizzle rebuild `dining_tables` (CLAUDE.md §3: a rebuild runs with foreign keys on); a nullable
  column that the save always fills is the expected shape. **Every table gets one:** the
  configuration export copies every `dining_tables` and `floor_plan_tables` column it does not omit
  (`packages/db/src/configuration-transfer.ts:43-50`), so the column travels with no change; the
  demo seed's names are already short ("1"–"8", "T1"–"T5", "B1"–"B3",
  `apps/server/scripts/demo-seed/floor.ts`); provisioning creates zones and, I believe, no tables
  (`packages/venue-service/src/provisioning.ts:105`). The floor read carries it from slice 1. The
  kitchen card shows its order's `group.label` today (`apps/till/src/widgets/station-queue.ts:921`,
  `:1104`) and the pass card `tableLabel` (`apps/till/src/screens/till-expo-screen.ts:955`); the
  station read gains the short name in slice 8b. For the pass, A773-2's `PassCard` has no short
  name (plan line 96), and its plan leaves only the handheld's short names to A797 (lines 19, 50, 311);
  this design proposes that A797 adds it to the pass read after A773-2 lands (slice 12b), and asks
  lane G to confirm. Each is a change to what a server read sends the till, so FULL.
- **Whose unsent dishes** (slice 3). The floor read gives each party's unsent New orders with the
  owner's name only (`UnsentDraft`, `apps/server/src/order-drafts.ts:343-348`); the bar needs the
  owner's id and the draft's last-saved time (`order_drafts.owner_id`, `.updated_at`,
  `order-drafts.ts:33`, `:37`). A till read change, no migration.
- **Ready warning time** (slice 6, as Q51 (c) recommends). A new minutes value beside the late
  flags' three: `kitchen_timing_defaults` (one row per venue,
  `packages/db/src/schema/kitchen-timing.ts:7-25`) and its per-station override
  `kitchen_station_timing` (`:30`). **Migration.** The floor read's `ready` signal already lists
  ready dishes per station (`byStation`, `packages/shared/src/table-signals.ts:13`); each station's
  entry gains its oldest ready time and that station's warning minutes, which the server works out
  as it already works out each station's other limits (`apps/server/src/table-signals.ts:58-60`).
  The till then turns the bar amber when any station's dishes at a table pass their own limit, so a
  salad and a secreto at one table are judged separately. A cross-package contract. If the owner
  picks the department alternative, the signal carries one limit per table instead.
- **From when A757's waiting clock counts for a dish that is ready but not served** (the owner asked):
  **from when it was fired.** The table's Waiting, Overdue and Forgotten come from every fired,
  unserved dish (`apps/server/src/table-signals.ts:74-75`), timed from `queued_at`
  (`:123`), which firing sets to the fired time (`apps/server/src/working-order.ts:2470`, `:2683`),
  and which is set again when a held dish is re-routed at its release (`rerouteHeldAtRelease`,
  `apps/server/src/station-move.ts:27`, `:146`) and when dishes are moved to another station
  (`moveDishesToStation`, `:199`, `:332`). The owner confirmed on 2026-10-20 that a released course
  is timed from its release (Ruling B, lane C's questions file, "OWNER ANSWER — #1914 Ruling B").
  Nothing filters on the dish's
  state, so a ready dish keeps the clock running until served, and `ready_at` is not read there
  (read). A757 §4 says the same ("oldest fired dish"). A773-2's branch (`feat/a773-2-pass-lifetime`
  at `f39ba0ce1`) changes which quantities that read counts, not its clock (read). So the Ready bar's
  warning keeps its own clock, from `ready_at`: a T5 dish fired 12 minutes ago and ready for 4 shows
  "Overdue" on the map and "Ready 4 min" on the bar.
- **Other stations' dishes** on the pass: a profile column and a nullable device override on the
  existing kitchen-screen choices (`packages/venue-service/src/schema/kitchen-screens.ts:26`,
  `:116`), with a device route to change the override. **Migration**, A773-2's (plan lines 99–100).
- **Columns** (order, shown, collapsed) are kept in the device's browser, keyed by venue, device,
  screen kind and station (A773-2 plan, line 101). Nothing on the server.
- **Kitchen cards per group** are built from the station read the screen already has; **Held**
  needs held and requested lines on it, which A773-2 adds. **Overview** counts what the screen
  holds; on the pass it counts A773-2's `overview` facts (plan line 96) through the same function.
- **Zones on a handheld:** the choice is stored per device and profile, with no form-factor column
  (`packages/venue-service/src/schema/device-zone-selection.ts:4-13`); the service reads the form
  factor only into a fingerprint of the stored choice (`packages/venue-service/src/device-zone-selection.ts:28`,
  `:98`). Only the till app, and one server reader, `GET /api/default-service-zone/offers`
  (`apps/server/src/till-api.ts:1423-1450` at `9c8c4c08e`), tie it to tills. The plan decides whether
  that route follows it on a handheld, tracing every reader first.

## 6. What is removed or retired

- **Handheld:** the language chooser on the phone bar (into ☰); the "Order" tab and the open table's
  tab named after it (replaced by the table buttons); below 720 px the order screen's "Review (n)"
  (`strings.ts:1313`) and its separate review view (replaced by the Menu / Order switch and the fixed
  bars); the Ready summary above the floor at phone width (replaced by the Ready bar).
- **Table screen (A803's, drawn here):** **Hold**; the **Bill ⋯ and Table ⋯** pair (one ⋮ menu); the
  Full invoice button beside the pay ways (to the payment step).
- **Kitchen screen:** the Tickets view and its switch; the per-dish cells of today's Board; "New" as
  a column name (`strings.ts:660`, A773's "Waiting").
- **Pass:** the wrapping row of order cards (replaced by columns). Done, Away and the venue-wide fire
  control are A773-2's removals.
- **Design words retired before any code used them:** "Coming up" (now Held), "In the kitchen" (now
  In progress) and "To make" (now Overview).

Each string that goes is removed in English and Spanish in the same slice.

## 7. How this meets the other designs, and who builds what

- **A773-2 (lane G, in flight on `feat/a773-2-pass-lifetime`).** Its plan already carries Q42's
  answer (its "Dated authority amendment", lines 15–19) and splits the work so neither lane builds
  twice. **A773-2 builds:** the Requested state and the pass's release; the pass read with its Held,
  To fire, In progress, Ready and Overview facts; the pass's columns; the kitchen screen's Held
  contents (held and requested, "Waiting for the pass"); the dimmed other-station dishes and their
  profile and device setting; and the Columns controller **only if A797's has not landed** when its
  task starts (plan line 289). **A797 builds:** short names; the handheld's bar, zones and Ready bar
  with its warning; the kitchen's group cards and the one Overview function; the Columns controller
  and the corner panel; the handheld order layout and the switcher's unsent marks. Both lanes edit
  `station-queue.ts`, `till-station-screen.ts` and `till-expo-screen.ts`, so they take turns and hand
  over before editing (plan line 19). **Short names on the pass:** A773-2's plan leaves the
  handheld's short names to A797 (lines 19, 50, 311) and says nothing of the pass's; this design
  proposes A797 adds them to the pass read after A773-2 lands (slice 12b), for lane G to confirm.
  **Overview on the pass** counts A773-2's facts through A797's one counting function (slice 9c),
  and A773-2 builds no second one (plan lines 96, 311). If A773-2 reaches its pass task before slice 9c lands, this design proposes
  that the pass ships without Overview, which is optional and off by default there, and slice 12b
  adds it; lane G should confirm. The Columns controller meets A773-2's interface (plan lines
  289–291) whichever lane builds it. A773-2's plan also makes three choices its author made, not
  the owner, which this design proposes as defaults the owner can change: the profile sets the
  other-station dishes default and a device may override it (Q51 (d)); Held is shown on the pass by
  default; Overview comes first when shown (plan lines 17, 99, 101).
- **A803 (lane G).** The owner's Q42 changes to its controls are on its queue entry and in its plan's
  slice 3 (one drop-down even for one bill, one ⋮ menu with two sections, Full invoice at payment,
  no Hold, Pay quiet while this bill has unsent dishes). This design draws them and adds the
  switcher's "✎ Bill 2 unsent" mark (slice 11). The handheld order slice waits for A803's slice 3.
- **A738–A739 (lane F).** On the counter the owner renamed Hold to **Park** and "Place order" to
  **Send**; that is theirs. Same ☰ rule, line window and Filter as here.
- **A757 (table states).** The floor's colours, cues, pulses and zone-tab marks are A757's, as built
  (slices 1–5 and 7). The Ready bar uses its slow pulse token; kitchen and pass cards its fast one.
  The owner's suggestion of dashes for every unoccupied table is Q51 (e); if approved it is a small
  later slice in A757's area, not part of §8.
- **A582 (help mode) and A893.** The "?" stays on the handheld bar at every width and in the kitchen
  and pass corner (A582 slice 5). The owner's "key of the different states" ("What the colours
  mean") is recorded in `docs/backlog/till.md:1436-1442` and waits for A893's review of A757's look;
  it is not designed here. A582's badges will explain the Ready bar, the columns and Overview.
- **A504 / A878, A789, A669.** "Leave it here" is A878's, built, with its Spanish (§10). "Lunch
  ended" (A789) and A669's allergy marks show where this design places the New order and the cards.

## 8. Build slices

The owner's order (Q42 (g)), with the new pieces fitted in. Each slice is one pull request one
implementer can finish well under ~100 tool calls, and leaves `main` working. Review path: **FULL**
for a migration, a till write route, a cross-package contract (here: any change to what a server
read sends to the till) or a live-subscription source; **LIGHT** otherwise. "Waits for Q51" holds
back only the part named; the rest of the slice is settled and is built now (owner: "Parts the notes
settle may be built without waiting").

**1 — The phone's top bar, zones and the Ready bar**
1. **Short names, data.** Migration; the save's uniqueness check and the database key; the refusal;
   the reset copies the name; the floor read carries it. FULL. Only the function that forms the
   automatic name depends on Q51 (a): it is built with the recommended rule, and another answer
   changes that one function and its tests.
2. **Short names, dashboard.** The field in the table panel, Add tables and Add joined table; the
   refusal under the field. LIGHT. After 1; its proposed value comes from slice 1's function.
3. **The handheld's bar.** One button per table with this person's unsent dishes and §3.1's rules
   for it (the choice of bill on opening is slice 11), the table on screen highlighted, Floor opens
   the last table's zone, language into ☰, ☰'s order; the floor read gains each New order's owner id
   and saved time. FULL. After 1; only the button's mark ("✎ T4" or "‹ T4") depends on Q51 (b),
   built as recommended.
4. **Zones on this device on a handheld.** FULL (which zones a signed-in device works in; may change
   a till route). Independent.
5. **The Ready bar and remembered List/Map.** LIGHT. Independent; it shows short names once slice 1
   has landed.
6. **Ready warning time, data.** Migration; the Late flags and station editor field; each station's
   entry in the ready signal gains its oldest ready time and its warning minutes. FULL. Waits for
   Q51 (c), which decides where the value lives.
7. **The Ready bar's warning.** Amber, slow pulse, longest-waiting table first, reduced motion. LIGHT.
   After 5 and 6.

**2 — The kitchen screen's cards, Overview and columns** (each taken in turn with A773-2, which
edits the same files)
8. **Group cards.** One card per group in today's columns; tap a dish or a heading (the heading tap
   reuses today's per-dish route); the age band; the header line; the Tickets view goes. LIGHT.
8b. **Short names on kitchen cards.** The station read gains the short name. FULL. After 1 and 8.
9. **The Columns controller and collapse.** One device-scoped store of each screen's order, shown
   and collapsed columns, with A773-2's interface (`readColumnState`, `saveColumnState`,
   `moveColumn`, `toggleColumnCollapsed`, `setColumnVisible`, and its storage key; plan lines
   101, 289–291), and heading-tap collapse on the kitchen screen. LIGHT. After 8.
9b. **The corner Columns panel.** Move up / move down and a Show switch per column. LIGHT. After 9.
9c. **Overview and the narrow tabs.** The Overview column and the one counting function A773-2's
    pass reuses; narrow tabs in the chosen order. LIGHT. After 9.

**3 — The phone's order screen** (A773-1 has landed, #1897)
10. **Handheld order at phone width.** Menu / Order switch, the fixed bottom bar with Send all, the
    fixed foot (A803 builds its contents and quiet Pay; this slice fixes it on a phone), tile counts,
    the opening view. LIGHT. Waits for A803's slice 3.
11. **The switcher's unsent marks** ("✎ Bill 2 unsent", closed and open) and the bar button's choice
    of bill. LIGHT. After 3 and A803's slice 3.

**4 — The pass and its Held column**
12. **Built by A773-2** (its tasks T7a, T7b and T7) into these layouts, once firing through the pass
    lands: the pass's columns, the kitchen's Held column, other stations' dishes and their setting.
12b. **Short names on pass cards, and Overview on the pass if A773-2 shipped without it** (§7). The
    pass read gains the short name. FULL. After 12 and 1.

## 9. Not decided here

- Exact widths where the kitchen screen and pass switch to tabs or a list; the build measures.
- Short names on the floor map where a full name does not fit, and on printed kitchen tickets
  (§3.7): later choices for the owner, not built here.
- What a tight place shows for a group joined today on the till (A504's today's joins), and for a
  table renamed for today: proposed, the members' short names joined ("T4+T5") and the saved short
  name; the plan of slice 1 settles it.
- A larger text size for kitchen screens read from a distance; a "My tables" filter on the handheld
  floor; whether a dish leaves a station's Ready column on its own; the venue's bump mode once a dish
  tap and a heading tap both exist (`station-queue.ts`; the plan traces where it is set and read).
- The wording of the fixed bottom bar and the opening rule's edge cases (a table with only served
  dishes opens on Order).

## 10. The owner's answer to Q42, and Q51

**Q42, answered 2026-10-18 ~22:55** (lane C's questions file, "OWNER NOTES on Q42 (A797)" through
"OWNER ANSWER to Q42 … COMPLETE"): (a) the bar approved with one button per table with your unsent
dishes, Floor to that table's zone, and table short names (§3.1, §3.7); (b) the Ready bar approved,
warning when food waits (§3.1); A803's controls changed and Hold dropped (§3.1); (c) approved with the
fixed Send bar and fixed foot, Pay quiet (§3.1); (d) approved, one card per group, Tickets view goes
(§3.3); (e) approved with Overview as the first column, collapse by heading, order in Columns, no
drag (§3.3, §3.6); (f) approved with Held, In progress, optional Overview off on the pass, dimmed
other-station dishes and the same column features (§3.5, §3.8); dashes for unoccupied tables
suggested (Q51 (e)); (g) the order of work approved (§8). The help key is A893's (§7).

**Q51. What the Q42 notes leave open.** "All recommended" is a complete answer. Pictures 01, 07, 08
and 09 show the recommended answers. Not asked, defaults you can change at any time: Held shown on
the pass, and Overview first when it is shown (§3.5).

- **(a) How the automatic short name is formed** (picture 09). Recommended: **a name of 4 characters
  or fewer is kept as it is; otherwise the first letter of each word, in capitals, followed by the
  number at the end of the name; a one-word name with no number keeps its first three letters; at
  most 5 characters, and the venue may type over it.** Example: "Terrace 1" → T1, "Top floor 12" →
  TF12, "12" → 12, "Window" → Win. Santet has "Terrace 1" and adds "Table 1": the form proposes T1,
  Save is refused with "Terrace 1 already uses T1" under Short name, and the manager types "Tb1".
  Alternative: the number alone ("1"), which clashes in most venues with more than one zone.
- **(b) The handheld bar's table button** (picture 01). Recommended: **"✎ T4", the table on screen
  highlighted; a table's button goes once you leave it with nothing of yours unsent there.** Example:
  Ana sends everything at T9 while on it; its button stays highlighted without ✎ until she taps
  Floor, then goes; "✎ T4" stays because T4's Bill 1 still has her croquetas. Alternative: "‹ T4",
  a back-arrow button for the last table opened, which does not say why it is there.
- **(c) The Ready bar's warning time** (picture 01). Recommended: **3 minutes by default, set in the
  dashboard's Venue settings → Kitchen → Late flags as a fourth field after "Warm after", "Overdue
  after" and "Forgotten after", and each station may set its own, as it can those three**, because
  how long food may sit depends on the food: hot grill plates go cold before a salad wilts. Example:
  Santet keeps 3 min but sets Cold to 6; T5's salad, ready for 4 minutes, leaves the bar calm, while
  T5's secreto, ready for 4, turns it amber. Alternative: one value per department, in the
  department's Service tab under "Table states", the same for every dish.
- **(d) Other stations' dishes on the pass** (picture 07). Recommended: **the profile sets the
  default (show); each pass may choose Show or Hide for itself, or follow the profile, which it
  does until someone chooses.** Example: Santet's kitchen profile shows them; Marta's pass hides
  them because the Bar is across the room; a new pass with that profile shows them. Alternative: the
  profile alone decides.
- **(e) Dashes for every unoccupied table** (pictures 08, 08-dark). Today only a table that needs
  clearing (or moving) is dashed, with thick amber dashes; a free or reserved table has its colour
  and a thin solid grey edge. Recommended: **yes: free and reserved tables keep their colours and
  cues, and their edge becomes thin grey dashes; Needs clearing keeps its thick amber dashes and
  🧹 Clear.** Dashed then means "nobody seated". The dark-theme mix-up A757 fixed stays fixed:
  Time to fire is a solid amber table, Needs clearing amber dashes around a plain one, and a
  reserved table's dashes are grey, not amber. Example: at 21:00 Santet's terrace shows T1 free
  (pale green, grey dashes), T2 reserved "21:30" (grey dashes), T3 needs clearing (amber dashes,
  🧹 Clear) and T4 Time to fire (solid amber, ▶ Fire): only T4 has people at it. Alternative: keep
  A757's look. A small later slice in A757's area if approved.
- **(f) Words that carry two meanings** (§3.8). One line each; a word you have already approved
  is kept unless you say otherwise.
  1. "Held" (a held course) and Find a bill's "Held" filter (an unpaid order at no table, «En
     espera», which you chose for both on 2026-10-20): **keep**.
  2. "Waiting" (kitchen column; a late table) and the till bar's Waiting tab (counter orders, from
     your approved counter design): **keep**.
  3. Spanish for "Preparing": «Preparando» on the kitchen screen, «En preparación» on the till (your
     choice of 2026-10-19 for "preparation started"): **keep both**.
  4. "In progress" (the pass column) and a payment still going through (built earlier, no decision
     of yours found): **rename the payment state "Processing" «Procesando»** (lane F's payment
     window; one string pair).
  5. "Waiting for the pass" and A773's planned "at the pass" on the till: **"Waiting for the
     pass" everywhere** (lane G's A773-2, not yet built).
  6. A773's planned pass label "New order" (a table's first send, or a counter order) and the
     till's New order (unsent dishes): **"First order" on the pass**; a counter order's card already
     says "Counter #12", so "First order" reads true there too (lane G's A773-2, its tests and the
     kitchen guide).
  7. "Warm" in the dashboard's kitchen settings and the till's "Waiting" for the same limit, and
     three Spanish words each for Warm and Overdue: **"Waiting after" and the till's words** (A797
     slice 6 edits those fields).
  8. "Ready to serve" (floor summary above phone width) and "Ready": **"Ready"** (A797 slice 5).
- **(g) Spanish for the new words.** Recommended:
  - Overview «Resumen»; In progress «En curso»; Waiting for the pass «Esperando al pase» ("1
    waiting for the pass" «1 esperando al pase»); First order «Primer pedido».
  - Short name «Nombre corto»; "Terrace 1 already uses T1" «Terraza 1 ya usa T1».
  - The Ready bar "Ready · T5 · 2 · T9 · 1 · Open ›" «Listo · T5 · 2 · T9 · 1 · Abrir ›»; Late flags'
    "Ready warning after (min)" «Listo sin recoger a partir de (min)», unlike Warm's «Aviso a partir
    de (min)».
  - Other stations' dishes «Platos de otras estaciones»; Profile setting «Según el perfil»; "✎
    Bill 2 unsent" «✎ Cuenta 2 sin enviar». A773-2's copy sheet proposes longer wording for the
    first two («Mostrar estaciones que no esperan al pase», «Usar la configuración del perfil»,
    its plan line 57); whichever the owner picks, both lanes use.
  - The kitchen column Waiting (A773's rename of New, «Nuevo» today) «Esperando», the word A757's
    Waiting already uses.
  - Not asked, already settled or already in the apps: Held «En espera» (owner, 2026-10-20);
    "Ready 4 min" «Listo 4 min» (owner, 2026-10-18 ~15:20, for A773-1's Sent box, lane G's
    questions file); "Leave it here" «Dejar aquí» (owner, 2026-10-19 ~00:10, A878, lane B's
    questions file); Columns «Columnas», Move up «Subir», Move down «Bajar», Show «Mostrar».
  Example: Jordi's Spanish screen reads «Resumen · En espera · Esperando · Preparando · Listo».
