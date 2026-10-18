# A582 — Help mode: a "?" in the top bar marks everything that has help

Status: **design, waiting for the owner's answer to one question (Q37 in lane C's questions file,
repeated in §9 below). Nothing is built until then.** Backlog entry: `docs/backlog.md` "A582" and
[its detail](../../backlog/dashboard.md#a582-help-mode-a--in-the-top-bar-marks-everything-that-has-help-owner-2026-10-13).
Pictures: `docs/backlog/mockups/a582-help-mode/` (drawn in HTML with the apps' colour tokens, not
screenshots; 02 also in dark, `-dark.png`).

File references are to `main` at `2337d76e3`. **(read)** marks a conclusion from reading code, not
from running it. Nothing in this design was run: it changes no behaviour, and every statement about
today's code is (read).

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
menu; the logo column is the one that shrinks, as it already does for the other controls.

### 3.2 Tills and handhelds (picture 04)

The "?" joins the bar beside the language chooser. Like every other item it moves into More when
the bar runs out of room, where it becomes a "Help" row with an on/off mark; at phone width it is
always there. When help is on and the "?" is inside More, More's own button carries a small dot, so
the person can see help is on without opening the menu.

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

### 3.3 Kitchen screens and monitors (picture 05)

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
  where it sits, without changing the layout around it.
- **Where it goes.** In a field's existing `help` slot; beside a heading; on a table column through a
  `help` text on the column's definition in `wt-data-table`; on a tab through a `help` text on the
  tab item in `wt-tabs`; in a dialog's heading or a folding section's (`wt-disclosure`).
  `wt-price-input`, `wt-number-stepper` and `wt-file-input` gain the `help` slot `wt-input` has;
  the other field primitives gain one when a screen first needs it. The primitives draw the badge; a screen never draws its own.
- **The box** keeps today's behaviour (opens below, pushed up when there is no room; clamped inside
  the window; Escape, a click outside, a second tap or focus leaving close it) and gains an optional "Read more in the guide" link and, on a till, the sheet.
- **The switch** is a small piece of shared state in `packages/ui`, beside the theme choice
  (`packages/ui/src/theme-choice.ts`), that each app's top bar drives and every badge follows.

## 6. Keyboard, screen readers and staying on

- The switch is a toggle button ("Help", pressed or not). Each badge is a real button named for its
  part ("Help: Selling unit"), reachable with Tab only while help is on. The box is announced as the
  badge's description, as today.
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
   in both themes on and off.
2. **The dashboard**: the banner switch; `help` on table columns and tabs; the four dashboard "?"
   become badges; Products as the first screen with help on every part that needs it.
3. **Guide pages on the box**: the three guides move to `docs/guide/en/` and get Spanish twins;
   built into the image; served at `/help/<language>/<page>`; "Read more" from Products. A new
   unauthenticated route, so its review is FULL. If rendering the guides needs a new third-party
   library, its licence notice ships with it (`CLAUDE.md` §3).
4. **Tills and handhelds**: the bar switch and its More row; badges on Counter, Floor and Order; the
   guide sheet; off on lock or a change of person.
5. **Kitchen screens and monitors**: the corner switch; badges on the station board, the pass and
   the monitor; off after two minutes without a touch.

After these, each screen gains help when a change touches it. Not in this work: a search box over
the guide, videos, help text a venue can edit (which would need storage), help on the till's PIN
screen (a sign-in screen, kept out to keep these slices off the sign-in path), and help in the setup
wizard beyond what it has.

## 9. The owner's question (Q37)

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
