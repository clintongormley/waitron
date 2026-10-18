# A582 — Help mode: a "?" in the top bar marks everything that has help

Status: **approved by the owner on 2026-10-18, with one change** (his answer to Q37, §9). On a till
or handheld there is no Help row in the More menu: the "?" that turns help on stays in the bar at
the top right at every width (§3.2). With help on, an open menu shows a blue "?" beside each option
that has help (§3.3). Being built in lane C: slice 1 on branch `feat/a582-1-help-badge`.
Backlog entry: `docs/backlog.md` "A582" and
[its detail](../../backlog/dashboard.md#a582-help-mode-a--in-the-top-bar-marks-everything-that-has-help-owner-2026-10-13).
Pictures: `docs/backlog/mockups/a582-help-mode/` (drawn in HTML with the apps' colour tokens, not
screenshots; 02 also in dark, `-dark.png`).

**Decided (owner, 2026-10-18), each as recommended in §9:**

- (a) The look: a "?" in each top bar (the kitchen screens' corner); badges hang over a part's
  corner so nothing moves; a badge opens a short box with an optional "Read more in the guide";
  everything else keeps working while help is on. With the change above.
- (b) Guide pages are served by the box itself, in English and Spanish, opening in a new tab on the
  dashboard and in a full-screen sheet on a till.
- (c) Help stays on until reload or sign-out on the dashboard, until the till locks or the person
  changes, and until two minutes pass without a touch on a kitchen screen.
- (d) The dashboard's always-visible "?" buttons become help-mode badges; the setup wizard keeps
  its own.
- (e) The order: badge and switch, then the dashboard with Products first, then guide pages, then
  tills and handhelds, then kitchen screens and monitors (§8).

File references are to `main` at `2337d76e3`, except those in §3.2, §3.3 and §5's menu line,
added for the owner's change, which are to `main` at `f316485d0`. **(read)** marks a conclusion from
reading code, not from running it. The measurements in §3.2 and §3.3 were run, and each says what
ran; every other statement about today's code is (read).

**Words.** A **badge** is the small circled "?" that help mode shows beside one part of a page. The
**switch** is the circled "?" in the top bar that turns help mode on and off. A **guide page** is a
longer piece of user documentation, like today's `docs/products.md`. A **device** is anything the
till app runs on: a till, a handheld, a kitchen screen or a monitor.

---

## 1. What the owner asked for

The owner's words (2026-10-13): "a question mark with a circle around it up in the top nav bar. And
when you click it, it highlights lots of things on the page with the circle with a question mark
inside. And then if you click any of those, it gives you help or it takes you to a page on the
documentation. So it's essentially a help mode that you can turn on and off. It doesn't obscure the
page during the normal use, but you can get help about anything you want very quickly." And: "This
for the dashboard and the devices, handhelds and tills. And probably the screens, monitors as well."

Answering this design (2026-10-18): "The ayuda in the menu should go. Turn on help in the top right,
open the menu, see options with a blue ? next to them, click the ? to see help."

## 2. What exists today

- **A "?" popover already exists.** `wt-help-tooltip` (`packages/ui/src/components/wt-help-tooltip.ts`)
  draws a circled "?" button that opens a small box of text below it (pushed up to stay inside the
  window when there is no room below), closes on Escape, a click outside, a second tap on the "?" or focus leaving it, and keeps
  itself 8 px inside the window (`positionTooltip`). It is always visible. The
  dashboard uses it in four places: Department and Starting zone on the device profile form
  (`apps/dashboard/src/screens/device-profiles-screen.ts:2136`, `:2197`), the Staff list's status
  filter (`staff-screen.ts:401`) and a unit's decimal places (`widgets/unit-form.ts:372`); the SumUp
  connect form uses it too (`packages/payments-sumup/src/dashboard/sumup-connect-form.ts:247`). The
  setup wizard uses it on six of its screens (connect, restore, restore from a bucket, live source,
  certificate, venue). (read)
- **The rule beside it.** A short explanation is a field's hint, shown as its placeholder; the "?"
  is only for an explanation too long for a hint or a field that starts filled in (owner,
  2026-10-03; `docs/developers/design-system.md` → Forms). A237 lists the "?" buttons that still
  break that rule. Help mode does not change the rule: hints stay where they are.
- **Some fields already have a place for a "?".** `wt-input` and `wt-textarea` (both in
  `packages/ui-core`) and `wt-combobox` have a `help` slot that puts whatever is in it beside the
  field box, outside the box's own click area. No other field primitive has one, including
  `wt-price-input`, `wt-number-stepper` and `wt-file-input`; the setup wizard puts its "?" beside a
  file field instead. No table column, tab, dialog heading or folding section (`wt-disclosure`) has
  one either. (read)
- **Three user guides already exist**, kept current by the changes that touch their screens:
  `docs/products.md`, `docs/modifiers.md` and `docs/content-and-images.md`, in English only. Nothing
  in the apps links to them, and the box does not serve them. (The backlog detail's "documentation
  does not exist yet" predates them being noticed; this design corrects it.)
- **The top bars.**
  - Dashboard: the banner (`apps/dashboard/src/dashboard-app.ts`, `#banner()`) ends with the language
    chooser, the alerts bell and the account menu. Below 48rem the banner becomes two rows and the
    controls keep the first row's trailing edge. (read)
  - Till and handheld: one bar (`apps/till/src/widgets/till-shell.ts`) of tabs, destination
    buttons, the language chooser, the person menu and More. Items move into More in a fixed order
    as room runs out (`LEAVE_ORDER`); at phone width everything but the tabs, the language code and
    More is in More. The More menu is already tight at 320 px (backlog: Log out falls below its
    bottom edge). (read)
  - Kitchen screens and monitors have no bar, by the owner's decision of 2026-09-04: a corner at the
    top right holds the theme and language choosers. A monitor (the pass monitor) has no other
    control at all (`apps/till/src/screens/till-expo-screen.ts`). (read)
- **Strings.** The dashboard and the till each have an English and a Spanish table
  (`apps/dashboard/src/i18n/strings.ts`, `apps/till/src/i18n/strings.ts`); the Spanish table is typed
  so a missing Spanish string fails the type check. A module's screens have their own tables. Shared
  `wt-*` primitives show no fixed words: each screen passes its own translated text, and any default
  a primitive has is English. (read)

## 3. The design, as someone sees it

### 3.1 The dashboard (pictures 01–03)

A circled "?" sits in the banner between the alerts bell and the account menu, at every width. It
looks like the bell: muted, outlined, a 44 px target.

**Ana, a new manager, opens Products** and is not sure what the unit on the Price field is for (it
reads "Each" and opens a Pricing unit window). She taps the "?" in the banner. It fills in the
primary colour and reads as pressed (to a screen reader, "Help, on"). Small circled "?" badges appear
beside the parts of the page that have help: the Price field's unit, the VAT field, the Availability
column, the Variants section. **Nothing on the page moves**: each badge hangs over the top trailing
corner of the thing it explains, drawn above it, taking no room of its own.

She taps the badge by the unit. A box opens under it:

> **Unit** — Leave it on Each for things you sell one at a time. Pick another unit when you sell by
> weight or volume, such as cheese by the kilo or wine by the litre. [Read more in the guide]

(Every help text in this design is an example of the voice, not the final wording; the slice that
adds it checks it against the code.) "Read more in the guide" opens the Products guide page at its
selling-unit section, in a new browser tab, so her form stays as it was. The box closes on Escape, a
tap elsewhere, or a second tap on the same badge, exactly as today's `wt-help-tooltip` does.

**While help is on, the page works normally.** Tapping the unit itself still opens the Pricing unit
window; only a badge opens help. So Ana can leave help on while she fills in her first product. She
turns it off with the banner "?" again.

**Help stays on as she moves between pages**, and goes off when she reloads, signs out, or her
session ends (§6).

At phone width (picture 03) the banner keeps the "?" in its first row with the bell and the account
menu; the logo column is the one that shrinks, as it already does for the other controls. That
shrinking has a floor, and an earlier measurement says the "?" alone goes below it: in A681's plan
review (2026-10-17, `docs/developers/design-system.md` → Dashboard banner), a 52 px stand-in in the
signed-in banner shrank the lockup to 15 px at 360 px and 45 px at 390 px, below the 60 px that
`apps/dashboard/src/dashboard-app.test.ts:5587` requires. (read: that receipt was not re-run for
this design.) Slice 2 finds the room and its plan says how. The "?" stays in the banner, not in the
account menu. The owner's answer was about the till's menu, but "Turn on help in the top right"
reads as applying to the dashboard too; that is this design's reading, not his words about the
dashboard.

### 3.2 Tills and handhelds (picture 04)

The "?" sits at the top right of the bar at every width (owner, 2026-10-18). It goes just after the
language chooser, before the person's name and More, or in the chooser's place once the chooser
has moved into More (below). **It never moves into More.** It is not one of the items in `LEAVE_ORDER`
(`apps/till/src/widgets/till-shell.ts:50`), so More has no Help row and no "help is on" mark: the
filled "?" in the bar already shows that help is on. Turning help on or off from the bar happens
outside every menu, so a menu opened afterwards is drawn with or without its badges (§3.3).

**How the bar makes room for it.** The "?" is a 44 px button plus the gap before it: 12 px above
phone width and 8 px at phone width (`till-shell.ts:204` and `:247`). That is 56 or 52 px the bar did
not have to find before.

- **Above phone width** (wider than 40rem, `PHONE_WIDTH` in
  `apps/till/src/widgets/language-chooser-styles.ts:4`), the bar already measures itself and moves
  items into More one at a time until it fits on one row (`#fit`, `till-shell.ts:481`). The "?"
  never leaves, like the language chooser, so its width is simply part of what the bar measures. The
  items leave in the same order as today, each at a slightly wider screen. Measured 2026-10-18 on
  `main` at `f316485d0`, with a throwaway Vitest browser test in `apps/till` (headless Chromium,
  deleted afterwards). The test mounted `till-shell` in Spanish with Find a bill, Pass, Kitchen, My
  schedule, Profile and Transfers present, with 56 px of padding standing in for the "?", from 660
  to 1500 px in steps of 20 px, beside the same bar without it. The test covered the handheld's
  tabs, the till's, and the till's with a counter-zone menu. The Waitron name left first, then
  Transfers, Equipment, Profile, My schedule and Kitchen, the same order as without the stand-in;
  with it, Pass also left at 660 px on the till with a counter-zone menu. At none of the widths
  sampled did the stand-in send more than one extra item into More. At 1300 px, for example,
  Transfers was in More with it and on the bar without it.
- **At phone width** the bar does no measuring (`#fit` returns early, `till-shell.ts:484`). Every
  item in `LEAVE_ORDER` is already in More (`till-shell.ts:392`), so the bar holds only the tabs,
  the language chooser and More. The tabs take the room that is left and scroll sideways when it is
  not enough (`till-shell.ts:129–137` and `:238`). Measured on the same day and commit with another
  throwaway test of the same kind, at 320, 360 and 390 px
  in Spanish and in English, with a 44 px stand-in placed after the language chooser, comparing the
  width the tab strip needed with the width it got:

  | Bar at phone width                                  | 320 px                       | 360 px                       | 390 px |
  | --------------------------------------------------- | ---------------------------- | ---------------------------- | ------ |
  | Handheld: Sala, Pedido                              | needs 135, gets 132 (EN 133/131) | fits                     | fits   |
  | Till form factor: Mostrador, Sala                   | needs 159, gets 132 (EN 149/131) | fits                     | fits   |
  | Till with a counter-zone menu: Mostrador: … ▾, Sala | needs 178, gets 132 (EN 184/131) | needs 178, gets 172 (EN 184/171) | fits |

  Without the stand-in, which is today's bar, the strip got 184 px at 320 (183 in English), and
  every case fitted except one: English with a counter-zone menu was already 1 px short. With the
  language chooser taken off the bar and the stand-in in its place, the strip got 192 px at 320,
  232 at 360 and 262 at 390, and every case fitted.

  **The rule:** at phone width, when the bar does not fit on one row with the "?", the language
  chooser is the next item to leave. At phone width it is the only item left on the bar that can.
  It moves into More, where it still opens the same list of languages. Today nothing at phone width
  checks whether the bar fits, so slice 4 adds that check: the bar's existing check for "too wide"
  (`#wraps`, `till-shell.ts:472`, which compares the bar's and the tab strip's needed widths with
  the widths they get) runs at phone width for this one step. The slice 4 plan decides where in More the chooser
  goes and in what form. On a handheld this keeps the chooser on the bar at 360 px
  and wider and moves it into More at 320 px. On a till-form-factor device it moves into More at
  320 px, and at 360 px too when the till has a counter-zone menu. Once the chooser has left, the
  tabs get 8 px more than they get today (9 in English), so every bar measured that fits today
  still fits. The cost: a
  language change at 320 px takes one more tap, and More gains a row on a screen where it is already
  taller than the room it gets (`docs/backlog.md`, "On a short phone the till's More menu is taller
  than the room it gets").

**Marc, on his first shift at the counter**, does not know what Hold (Aparcar) does. He turns help
on; badges appear beside Hold, the Held orders list, Guests and the payment buttons (the Held orders
list shows only when the till has held or waiting orders, and Guests only when the till asks for
guests). He taps the one by Hold:

> **Hold** — Puts this order aside, with a name if you want one, so you can start another: for
> example when a customer goes to find their wallet. It waits under Held orders; Retrieve brings it
> back. Discard throws it away, but not while it holds part of a payment or one is going through.

A badge on a till is a 32 px target with a 24 px circle (on the dashboard, 24 px and 20 px), so a
thumb can hit it without the badge covering more than the corner of the button under it. A long
press is not used: on a till it already opens a product's information and, on the floor plan, a
table's details.

A guide page opened from a till shows in a full-screen sheet over the till with a Close button,
never a new tab: a till runs full-screen and has no tab bar to come back by.

**On a till, help goes off when the till locks or the person changes**, so the next person never
starts with badges on.

### 3.3 Badges inside menus (picture 04)

With help on, opening a menu shows a blue "?" at the trailing end of each option that has help:
the till's More and person menus, the dashboard's account menu, a table row's ⋮ menu (each a
`wt-row-actions`). Tapping that "?" opens the help box for that option (owner, 2026-10-18). Help is
switched from the bar, outside every menu, and a tap outside an open menu closes it. So usually a
menu gets its badges when it opens. Help can still change while a menu is open: a keyboard user
can move focus out of an open menu back to the bar's "?" with Shift+Tab, because focus leaving a
`wt-row-actions` menu does not close it (read: it closes on a chosen action or Escape,
`wt-row-actions.ts:180–192`, and on a tap outside through the browser's own popover behaviour,
`:208`; nothing in it listens for focus leaving). Then the open menu shows or hides its badges at once, and slice 2
tests that case.

- **Its own button, beside the option.** The badge is a separate button next to the option, never
  inside it: a button inside a button is not valid HTML, and the tap would reach both. The option
  keeps its full height and the rest of the row's width. The badge takes a 44 px square
  (`--wt-tap-min`) at the row's trailing end, outside the option's tap area, with the same circle
  as a page badge (24 px on a till and a handheld, 20 px on the dashboard). Unlike a page badge, a
  menu badge takes room of its own: hung over the option's corner, it would cover the option's
  label or part of the place a person taps to run it. A menu that has badges can be up to that
  square wider.
- **A tap on the "?"** opens the help box under the badge, kept inside the window as everywhere. It
  does not run the option and does not close the menu. A tap on the option itself runs it and
  closes the menu, as today, and closes an open box with it. A second tap on the "?" or Escape
  closes the box. The first Escape closes only the box and puts focus back on the "?"; the next one
  closes the menu.
  `wt-row-actions` closes on a click on any button inside it unless the click passed through an
  element marked `data-keep-open` (`packages/ui/src/components/wt-row-actions.ts:147`, read). The
  menu badge carries that mark. Measured 2026-10-18 with a throwaway Vitest browser test in
  `apps/till` (headless Chromium, deleted afterwards). A `wt-row-actions` held a row with a
  `wt-button` option and today's `wt-help-tooltip` beside it marked `data-keep-open`. A click on
  the "?" left the menu open, opened the box and did not run the option. Escape closed the box,
  with the menu still open and focus on the "?". A second Escape closed the menu. A click on the
  option ran it and closed the menu, and with the box open it closed the box too. The control, the
  same row without `data-keep-open`: a click on the "?" closed the menu, and the box was not open
  afterwards.
- **Keyboard.** `wt-row-actions` moves between its items with Tab, not the arrow keys; its only key
  of its own is Escape (`wt-row-actions.ts:185`, read). So the badge is its own Tab stop, straight
  after its option, and Enter or Space opens its box. While help is off the badge is not drawn and
  adds no stop. Measured in the same test: Tab from the menu's button went to the option, then its
  "?", then the next option. With focus on the "?", Enter opened the box, a second Enter closed it,
  and Space opened it again, each time with the menu still open and the option not run.
- **Not in this work:** the menus whose options move with the arrow keys, which are the language
  and theme choosers, through `MenuPopover` (`packages/ui/src/menu-popover.ts:134`). Also left out
  are lists marked `role="menu"` inside a `wt-row-actions`, such as the till's counter-zone menu
  (`till-shell.ts:750`), because a plain button inside `role="menu"` is not a menu item to a screen
  reader. None of their options (a language, a theme, a counter zone) needs help. Whichever of
  these menus first needs a badge settles how one is reached there; in an arrow-key menu, the
  arrow-right key from the option is one way.
- **What a screen reader hears.** The option is heard as today, for example "Cocina, button". The
  badge is a separate button named "Help:" and the option's label ("Ayuda: Cocina"), announced as
  expanded or collapsed. Once open, its box is read as the badge's description, as
  `wt-help-tooltip` does today (`packages/ui/src/components/wt-help-tooltip.ts:127–129`, read).
  `wt-row-actions`' popup is not `role="menu"` (`wt-row-actions.ts:208`, read), so a second button
  in a row is valid there.

### 3.4 Kitchen screens and monitors (picture 05)

They have no bar, so the "?" joins the theme and language corner. On a station board or the pass,
badges explain the board's buttons and what its colours and times mean. On a monitor, which has no
buttons, they explain what the screen shows. Help goes off after two minutes with no touch, because a
kitchen screen is often left alone and nobody would think to turn it off.

## 4. Where the help text lives, and who writes it

- **The short text** in a badge's box lives in the app's own strings tables, next to the screen's
  other strings, under keys named for the screen and the part (for example
  `help.products.selling_unit`). English and Spanish are both required, which the type check already
  enforces. One to four sentences; what the part does and when to use it, never a restatement of its
  label. A module's screens keep their help in the module's own tables.
- **The longer text** is a guide page. The three existing guides move to `docs/guide/en/` and gain
  Spanish twins in `docs/guide/es/`. The box serves them itself, at `/help/<language>/<page>`,
  built into the image with the apps. So help works with no internet connection, and the page always
  describes the version installed on that box rather than a newer one on a website. A page not yet
  written in a language shows the English page with one line at the top saying so. Publishing the
  same pages on a public website later needs nothing from this design.
- **Who writes it.** The change that builds or changes a screen writes that screen's help, as it
  writes its labels, and updates the guide page in the same change when behaviour changes (the
  guides already work this way). Help text is a claim about behaviour, so the house rule on claims
  applies (`CLAUDE.md` §1): the reviewer checks each one against the code. Not every part needs help:
  a screen adds a badge where the label and hint do not already say enough.

## 5. How a screen marks a part (for the build)

- **One shared element.** `wt-help-tooltip` grows into the help-mode badge (renamed `wt-help`, or
  kept under its name; the plan decides). It reads one app-wide help switch. While help is off it
  draws nothing and takes no room. While on, it draws the badge over the top trailing corner of
  where it sits, without changing the layout around it. The exception is a menu row, where it
  takes its own square (§3.3).
- **Where it goes.** In a field's existing `help` slot; beside a heading; on a table column through a
  `help` text on the column's definition in `wt-data-table`; on a tab through a `help` text on the
  tab item in `wt-tabs`; in a dialog's heading or a folding section's (`wt-disclosure`).
  `wt-price-input`, `wt-number-stepper` and `wt-file-input` gain the `help` slot `wt-input` has;
  the other field primitives gain one when a screen first needs it. The primitives draw the badge; a screen never draws its own.
- **In a menu (§3.3)**, the badge is the same element, placed by a menu-row element that
  `packages/ui` adds for `wt-row-actions` (the slice 2 plan names it). The row lays out the option
  with the badge in its own square at the trailing end, and marks the badge `data-keep-open` so the
  menu stays open (`wt-row-actions.ts:147`). A screen gives an option its help text through that
  row; it never draws the badge or the row's layout itself.
- **The box** keeps today's behaviour (opens below, pushed up when there is no room; clamped inside
  the window; Escape, a click outside, a second tap or focus leaving close it) and gains an optional "Read more in the guide" link and, on a till, the sheet.
- **The switch** is a small piece of shared state in `packages/ui`, beside the theme choice
  (`packages/ui/src/theme-choice.ts`), that each app's top bar drives and every badge follows.

## 6. Keyboard, screen readers and staying on

- The switch is a toggle button ("Help", pressed or not). Each badge is a real button named for its
  part ("Help: Selling unit"), reachable with Tab only while help is on. The box is announced as the
  badge's description, as today. In a menu, the badge is the Tab stop straight after its option
  (§3.3).
- Help stays on across pages in one browser tab and goes off on reload, sign-out or session end
  (dashboard), on lock or a change of person (till and handheld), and after two minutes without a
  touch (kitchen screen and monitor). It is not saved anywhere, so it needs no migration and no
  server change. The alternative, remembering it per device as the theme choice does, would leave a
  shared till showing badges to whoever signs in next.

## 7. What happens to today's always-visible "?" buttons

- **On the dashboard** (device profiles' Department and Starting zone, Staff's status filter, a
  unit's decimal places, SumUp's connect form) they become help-mode badges: hidden until help is
  on. This settles A237's dashboard half.
- **The setup wizard keeps its always-visible "?"**. It has no top bar to hold a switch, it is used
  once, by someone setting up a box, who needs every explanation at that moment. A237's setup half
  (which of those should be hints) stays open as it is.

## 8. Slices

Each slice is one pull request one implementer can finish (well under ~100 tool calls).

1. **The badge and the switch** in `packages/ui`: help-mode state, the badge drawn only while on,
   with no layout change; `wt-price-input`, `wt-number-stepper` and `wt-file-input` gain the
   `help` slot; `wt-disclosure` and `wt-dialog` take one beside their heading; the
   design-system entry. Tests: the badge takes no room while off (measured), paints from tokens, axe
   in both themes on and off. Slice 1 is only the badge, the switch and the help slots on fields
   and headings. Badges inside menus are not part of it.
2. **The dashboard**: the banner switch, with room found for it at phone width (§3.1); `help` on
   table columns and tabs; §7's dashboard "?" buttons become badges; Products as the first screen with
   help on every part that needs it. **The menu-option badge** (§3.3) is built here: the menu-row
   element in `packages/ui`, `data-keep-open` on its badge, the Tab order, and its tests (a tap on
   the "?" opens the box without running the option or closing the menu, Escape closes the box
   first). Its first users are the dashboard's account menu and the ⋮ row menus (`wt-row-actions`).
3. **Guide pages on the box**: the three guides move to `docs/guide/en/` and get Spanish twins;
   built into the image; served at `/help/<language>/<page>`; "Read more" from Products. A new
   unauthenticated route, so its review is FULL. If rendering the guides needs a new third-party
   library, its licence notice ships with it (`CLAUDE.md` §3).
4. **Tills and handhelds**: the bar switch at the top right at every width, never in More, with
   the language chooser moving into More at phone width when the bar does not fit (§3.2); option
   badges in the More and person menus, through slice 2's menu row; badges on Counter, Floor and
   Order; the guide sheet; off on lock or a change of person.
5. **Kitchen screens and monitors**: the corner switch; badges on the station board, the pass and
   the monitor; off after two minutes without a touch.

After these, each screen gains help when a change touches it. Not in this work: a search box over
the guide, videos, help text a venue can edit (which would need storage), help on the till's PIN
screen (a sign-in screen, kept out to keep these slices off the sign-in path), and help in the setup
wizard beyond what it has.

## 9. The owner's question (Q37)

**Answered 2026-10-18:** approved, with (a)–(e) as recommended and one change. On a till or handheld
there is no Help row in More: the "?" stays in the bar at the top right at every width. With help
on, an open menu shows a blue "?" beside each option that has help. §3.2 and §3.3 now describe that.
The question below is the record of what was asked, and its §3.2 was the version before the change.

**Do you approve help mode as described, with these five choices?** Each has a recommended answer;
"all recommended" is a complete answer.

- **(a) The look.** A "?" in each top bar (the kitchen screens' corner); badges that hang over a
  part's corner so nothing moves; tapping a badge opens a short box with an optional "Read more in
  the guide". Everything else keeps working while help is on. Recommended: **yes**. (Pictures 01–05.)
- **(b) Where the long help lives.** Recommended: **guide pages served by the box itself, in English
  and Spanish**, opening in a new tab on the dashboard and in a full-screen sheet on a till. The
  alternative is a public website: always reachable from a phone at home, but useless when the venue's
  internet is down, and it can describe a newer version than the box runs. (Picture 06.)
- **(c) How long help stays on.** Recommended: **until reload or sign-out on the dashboard, until the
  till locks or the person changes, and two minutes without a touch on a kitchen screen**. The
  alternative is remembering it per device, like the theme choice.
- **(d) Today's "?" buttons.** Recommended: **the dashboard's become help-mode badges; the setup
  wizard keeps its always-visible "?"**.
- **(e) The order.** Recommended: **badge and switch, then the dashboard with Products as the first
  screen, then guide pages, then tills and handhelds, then kitchen screens and monitors.** The
  alternative is to bring tills forward to second.
