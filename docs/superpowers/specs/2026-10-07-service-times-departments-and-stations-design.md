# Service times, departments, zones and prep stations

> **2026-10-09, A366 slice 2:** this earlier account of address-owned local entries, their cap
> or individually coloured special dates is historical. Local holidays are now own named days
> without an entry cap; named-day kinds and public facts determine Calendar fills. See
> [public holidays](../../developers/public-holidays.md) and
> [the current Calendar contract](../../developers/design-system.md). The slice is awaiting review.

> **2026-10-08:** A366 slice 1 Task 10 retires `resolveOpeningDateHours`; its station week,
> named-date and default-opening checks move to the retained Hours model and station-state
> readers. See [slice 1 plan](../plans/2026-10-07-a366-slice-1-service-periods.md).

> **2026-10-09 receipt revision:** the owner's 2026-10-08 ~22:30 answers 1–16 supersede
> the receipt mock-up and earlier slice 7 defaults. Section 11 and the
> [revised slice 7 plan](../plans/2026-10-08-a366-slice-7-receipts-per-department.md)
> state the target contract. Slice 1 landed in #1460; receipt work remains unbuilt.

> **2026-10-09 departments revision:** the owner's completed slice 6 answers (~09:40–10:05)
> govern sections 6, 9.1, 12–14 and the
> [revised slice 6 plan](../plans/2026-10-08-a366-slice-6-departments.md). Always open the
> department list, even with one department; every department page has its parent link.
> Empty zone hints contain only the inherited value. Receipt modes are auto/on_request
> (Always/On request), with pre-live reset instead of converting obsolete modes. Cancel
> precedes Save everywhere. Slice 3A landed in #1469 at
> `87b46b024fcac68a6240949964768b9fbc7d4972`; 6A and then 7A remain pending in Lane E.

**Status:** owner decisions of 2026-10-07, from one brainstorm with mockups. The owner approved
this written spec on 2026-10-07, including section 15's three defaults. Backlog item **A366**. Behaviour below is the target design, not a
claim about what runs today; section 2 records the code read when the design was approved,
with source pointers. The dated slice 6 plan inventory describes the newer base as a source audit.

**What this replaces.** Where this document disagrees with an earlier one, this one wins:

- [Departments, service styles and opening hours](2026-10-03-departments-service-styles-hours-design.md)
  (A254): §4 (opening hours). Its §3 open questions about counter tabs and its advisor questions
  stay open and are not settled here.
- [Venue operations](2026-10-03-venue-operations-design.md) (A261): §4 (departments and zones),
  §5's authored receipt fields, preview and top-block order, §6 (prep stations) and §7 (hours),
  except §7.1's public-holiday sources.
- [Invoice PDF, email and office printing](2026-10-03-invoice-pdf-email-and-office-printing-design.md):
  its venue-wide withdrawal-contact source is superseded by section 11's separate department/
  default contact resolver. The accepted consent snapshot and other delivery rules remain.
- [Devices, menus and service zones](2026-10-04-devices-menus-and-service-zones-design.md): §2
  (menus and the department timetable) and the station and watcher bindings in §4.
- [Product folders, menus that include menus, and prep station routing](2026-09-30-catalogue-menus-routing-design.md):
  §5.7 (opening hours and fallbacks) and §5.9 (watchers).

The mockups the owner approved are kept outside the tree, in the brainstorm session; this document
describes them in words.

## 1. Why

Today a department's opening hours and its menu timetable are two weekly grids describing almost
the same thing, on two screens, and nothing checks one against the other. Prep stations have a
third grid. The Departments and zones page mixes department and zone settings in one table, keeps
an older pair of tables below it, and links away to edit the receipt. The owner asked for one idea
instead of three, and for configuration pages that are only about configuration.

## 2. Code snapshot when approved (2026-10-07)

- **Department hours change nothing at the till.** `resolveOpeningDateHours`
  (`packages/venue-service/src/hours.ts`) is exported and called nowhere; department hours were
  meant as the public hours (A254 §4). Station hours do act: a closed station sends its work along
  its fallback chain (`packages/venue-service/src/routing.ts`).
- **The menu timetable only picks the menu the till opens on.** `resolveZoneMenus`
  (`packages/venue-service/src/menu-timetable.ts`) chooses a default; staff can order from any of
  the department's menus at any time. Zones can choose their own menu per period and their own
  all-day menu.
- **Hours and the timetable share only the list of special dates** (`special_dates`,
  `packages/venue-service/src/schema/hours.ts`).
- **A menu can include another menu** (`packages/catalogue/src/menu-inclusion.ts`): the included
  menu appears as one folder, and a product reached two ways is one item with one price.
  _(2026-10-07: since #1372 (A322) each include can instead show the included menu's sections
  directly, or be a folder with its own name, photo and colour.)_
- **Routing is a grid** since #1363 (A261-4): rows are products, categories and All categories;
  columns are zones and Every zone; each set cell names a station or No preparation.
- **Kitchen tickets are routed per station**: each station's ticket prints on each of its printers
  separately (`routeKitchenTickets`, `apps/server/src/kitchen-print.ts`). A printer attached to a
  watcher already prints one combined ticket per send, with a section per followed station (the
  watcher block of the same file).
- **A device profile belongs to one department**, and a till is refused a bill from another
  department's zone (`service_zone.not_allowed`, `apps/server/src/zone-access.ts`).
- **A receipt prints in one language**, the first of `locations.invoice_locales`; staff can print a
  copy in another of the country's receipt languages (#1022). The receipt's subtitle and footer
  hold one text each (`packages/layouts/src/types.ts`).
  _(2026-10-09: this describes the pre-slice-7 shape. Section 11 replaces the authored fields
  with department fields and per-language maps; the address switch stays venue-wide.)_
- **Local holidays are capped at two a year** (`holiday.local_limit`,
  `packages/venue-service/src/holidays.ts`), Spain's count of official local holidays per town.
  Nothing outside the opening-hours calendar reads holidays.

## 3. The ideas

| Idea | What it is |
| --- | --- |
| Department | A separate business inside the venue, such as the Deli: its own brand on the receipt, its own periods and menus, its own staff access. Tabs cross between departments only by a transfer. |
| Zone | An area of a department, such as the Terrace. It follows the department's periods and menus; it can differ only in its service settings and in being closed for part of the department's open time. |
| Period | A name and its menus, such as "Lunch". It has no times of its own. |
| Day | Time ranges, in 15-minute steps, each assigned a period. It runs from the business-day changeover (`locations.day_cutover`, 06:00 by default) to the same time the next day. |
| Normal week | A department's seven days. |
| Named day | A date with a name: a public holiday, or one of the venue's own days. It may have its own hours. |
| Prep station | Where a dish is made. It has no hours to set. |
| Kitchen display | A device whose profile is a kitchen display's: a screen on a kitchen or pass wall, with nobody signed in. It runs exactly one kitchen screen: a station screen (whose Move to station appears only with the profile's "Takes orders"), a pass screen (whose Fire, Ready and Away appear only with the profile's "Run the pass") or a monitor. |
| Kitchen screen | What a device profile offers and a device chooses: a station screen, a pass screen or a pass monitor. |
| Working screen | A kitchen screen with buttons: a station screen or a pass screen. Any device can run one. |
| Station screen | A working screen showing some prep stations' queues, with buttons to start, ready and finish dishes; on a kitchen display, also Move to station on each waiting dish. |
| Pass screen | A working screen showing the pass queue for some stations and zones, with Done on each dish; with the profile's "Run the pass", also Fire, Ready and Away. |
| Monitor | A view-only kitchen screen with no buttons, such as a wall screen showing the pass queue. The pass monitor is the first; any device whose profile offers it may run one (owner, 2026-10-09). |

_(2026-10-08: "Monitor" narrowed to view-only screens and the kitchen screen entries added, from the
owner's answers to the slice 5 plan; the earlier entry called every kitchen screen a monitor. See
§9.4. 2026-10-09: the owner opened the pass monitor to every kind of device.)_

A terrace that closes earlier than the bar is a **zone**, not a department: as a department its
tabs could only reach the bar's till by transfer, its staff would be walled off, and its periods
would be set up twice.

## 4. Periods and menus

**A period has one menu that customers see, plus optional menus only staff can order from.**

- The menu is what the till opens on, and what a future customer-facing surface (online ordering,
  SP15, not started) would show. It can include other menus, so Lunch is the Lunch menu including
  Desserts, Drinks and Coffees; its section order is the menu's own.
- Staff-only menus can be ordered by staff during the period and are never shown to customers: a
  restaurant waiter can order from the Deli menu during Lunch if Lunch lists it.
- A dish served longer than a meal goes in its own menu that several periods include. Desserts after
  the kitchen closes: Lunch and Afternoon both include Desserts.
- A happy hour needs nothing new: a "Happy hour" period whose menu includes Drinks and sets its own
  prices. A menu's own price already beats the price in any menu it includes.
- Periods belong to a department. Two departments may each have a "Lunch".

**A department's opening hours are worked out from its periods.** Any time with no period is
closed. They are never typed in separately.

**A new department starts with one period, "Open", holding all its menus, 09:00–17:00 Monday to
Friday** (owner, 2026-10-07). Setup shows those hours and where to change them, because a venue
set up on a Saturday or after 17:00 cannot make a test sale until it does.

**The day runs changeover to changeover**, so a bar open until 03:00 is one block on Friday. No
period can run past the changeover. A day whose clocks change keeps today's rule: a time the clocks
skip is refused (`skippedEndpoint`).

## 5. At the till

**Owner update, 2026-10-08:** the earlier after-period sending rule below is superseded.
Each period gets a signed number of minutes from its end, negative for last orders before
it, positive for sending leftovers after it. Slice 1 fixes it at 0 and accepts new dishes
only while their own period runs. See [slice 1 decision 1](../plans/2026-10-07-a366-slice-1-service-periods.md).
**A432 implementation update, 2026-10-08:** the configurable signed offset now separates
selection from sending. A negative offset stops both before the end; a positive offset keeps
sending open after selection ends. Cutoffs are exclusive and placement bounds apply.
See the [A432 decisions and implementation plan](../plans/2026-10-08-a432-period-end-offset.md).
The bullets below preserve the earlier design.

- **Only the current period's menus can be ordered**, the customer menu and its staff-only menus.
  The till opens on the customer menu.
- **Items already on an order when a period ends can still be sent after it.** New items from a
  menu the new period does not offer are refused.
- **When no period is running**, nothing can be ordered in that department.
- **When a zone is closed**, no new order starts there. Its open tabs can still be paid, or moved to
  another zone.
- **A manager can extend for today only**: "Keep Lunch open until 14:30 today", "Keep the Terrace
  open until 01:30 today". An extension ends at the changeover, like a station's "Open for today".
  It cannot open a zone while its department is closed.

## 6. Zones

**Service settings, the same on a department and a zone.** The department sets each one; a zone
leaves the field empty to follow it, and the empty field's placeholder shows the department's
value.

- **How orders start:** table service (a tab, paid at the end) or counter service (a one-off sale).
  Slice 6 retains today's zone rule: table seating in a counter zone is refused and table zones
  stay out of the counter picker. Choosing per order remains A254 §3.1's open question, not a
  behaviour this design claims is implemented (slice 6 plan, source audit and Task A3b).
- **When counter service is used:** paid before preparation or at collection. The department
  has a switch, "Print a numbered collection ticket"; a zone offers Print / Don't print and a
  clearable empty state whose placeholder is only the department's inherited Print or Don't print.
- **Print a receipt:** Always / On request, stored as auto/on_request only. A zone can clear it to
  null, showing only the inherited localized value as its placeholder. No inheritance prefix or
  follow option label is shown. Obsolete never policy values are refused in the final
  writers, imports and checks; existing pre-live venues reset rather than convert those rows.

The service style (`table_tab`, `prepay`, `ticket_then_pay` in `departments.default_service_mode`)
goes: table service, counter service paid before preparation, and counter service paid at
collection replace its three values as configuration. The recorded order context
`order_service_contexts.service_mode` and shared ServiceMode retain table_tab/prepay/ticket_then_pay
in slice 6. The owner requested a separate future split into served-at (table/counter) and
payment-due (before-kitchen/collection/end-tab); it remains in the backlog.

**Closed times.** A zone can be closed for part of its department's open time, never open when the
department is closed. It has no periods or menus of its own. Closed times are set per day of the
normal week and per named day, in the same editor as periods (section 9.2). "The Terrace closes at
23:30 Monday to Thursday and Sunday, and at 01:00 Friday and Saturday" is two closed blocks copied
across the week.

## 7. Named days and the calendar

- **Public holidays** come from the country and region lists, as today (A261 §7.1).
- **The venue's own days are unlimited.** Each has a date, a name, a kind (a holiday or a working
  day), whether it repeats every year, and whether it keeps the normal week's hours or has its own.
  "Bar's anniversary" and "World Cup final" are own days. A town's two official local holidays are
  entered as own days; the two-a-year cap goes.
- **Colour shows the kind:** public holiday, own holiday, named working day. A mark shows the day
  has its own hours.
- A day with its own hours replaces that date for every department and zone; each department and
  zone is edited on it as on a normal-week day. "Close the whole venue" stays.

## 8. Prep stations

**No hours to set.** A station is open whenever something it makes can be ordered, worked out from
the periods and routing. The default station is always open.

**Routing cells can name periods.** A grid cell keeps its station and can add stations for named
periods, which are tried before the cell's plain choice. Example, on the Cocktails row's Every zone
cell: "Upstairs bar; during Breakfast, Mid morning, Lunch and Afternoon: Downstairs bar". The
periods offered are grouped by department and limited to those whose menus include the row's
products; a zone column offers only its department's periods. Deleting a period that a cell names
warns first.

In the grid a cell with period choices shows its station with a line beneath, such as
"Breakfast–Afternoon: Downstairs bar". A zone cell that sets nothing inherits the whole Every zone
cell, period line included, as it inherits a station today. Clicking a cell opens its editor: one
line per choice (periods → station, removable), "Any other time" → the cell's station, and "+
Different station during some periods". A period can be in one line only (owner, 2026-10-07, on
the grid mockup).

**"Close for today" asks where the work goes** at the moment of closing, offering the default
station first. There is no fallback to configure in advance; the "If closed, work goes to" setting
goes.

**A station's tickets print on one or more printers, and a shared printer gets one combined ticket
per send.** When several stations list the same printer, that printer prints one ticket covering
just those stations' dishes, with a section per station. Example: X prints on PX; Y on PY and P; Z
on PZ and P. A send with a dish for each prints X's dish on PX, Y's on PY, Z's on PZ, and on P one
ticket holding Y's and Z's dishes. A printer listed on every station prints the whole send: the pass
ticket. It prints once per send, not the whole order at once. Reprints and correction slips follow
the same grouping. The rule against one printer both making and watching goes.

## 9. Dashboard

The Venue operations menu holds three pages: Departments, Opening hours and Prep stations.
Nothing on them shows live state. Live controls are in section 10.

### 9.1 Departments

- **The list:** department, trading name, zones and a Setup column that shows only what is missing
  (department has no opening periods; a zone menu is unpublished or empty) or "Disabled".
  Use the existing readiness reader's issues, not a new missing-period-menu code. Open, Rename and
  Disable (or Enable) are in each row's ⋮ menu.
  The bare address always shows this list, even with one department. Every department page has
  a Departments parent link above its one item-name heading, following A335/A398. This owner
  override supersedes A254 §2's bypass without rewriting that historical spec.
- **Settings tab:** name; the Service settings of section 6, with a line naming the zones that
  differ; tab transfers (who this department may send tabs to, and which device profile receives
  them), shown only with two or more active departments. Saving forms and dialogs put Cancel
  first, then Save, with A331 draftScopeFor/saveActionState, a save-handler early return, and
  unsaved-change/reconnect checks.
- **Zones tab:** one button per zone and "+ Add zone". A zone shows its name, its service settings,
  a one-line summary of its closed times linking to Opening hours, and a ⋮ menu with Rename, Move to
  another department and Disable. A zone with tables shows a small plan preview and "Edit floor
  plan", which opens the full-screen editor; a zone without tables shows "Add a floor plan". There
  is no separate "tonight" plan in this design.
- **Receipt tab:** section 11; authored fields require `layout.configure`. The global address
  switch, receipt language and sales description stay in Venue settings. Slice 7 Part A first
  provides a department picker there; Part B moves the department editor into this tab.

### 9.2 Opening hours

- **Week:** a picker lists All departments, each department with its zones beneath it, and the
  prep stations. A switch shows the normal week or a real week (‹ › steps through weeks, with named
  days applied).
  - All departments: every department side by side for the week, scrolling sideways when there are
    many.
  - A department: drag down a day to choose a range and pick a period, or "+ New period". Drag a
    block's edge to resize it. Each day's menu has "Copy this day to…" and "Clear".
  - A zone: the department's periods faded; drag to mark closed times.
  - A prep station: read-only, when something it makes can be ordered. This answers "what are the
    kitchen's times three weeks from now".
- **Periods:** a department picker and its periods: colour and name, the customer menu (with what
  it includes), staff-only menus, and the days it is placed on. Add, edit and delete.
- **Day:** one date, every department with its zones beside it as narrow columns; editable.
- **Calendar:** a month with named days coloured by kind, and adding or editing a named day.

### 9.3 Prep stations

Three tabs: **Stations**, **Routing** and **Settings** (ticket timing, as today). The Tickets and
Watchers tabs go.

- **Stations:** station, the printers its tickets print on, "Shown on" (the devices whose monitors
  show it, a read-out), and a link to Opening hours for when it gets orders. Edit, Make default and
  Disable are in the ⋮ menu. Editing a station sets its name, its printers and "Show the rest of
  the order". _(2026-10-08: "monitors" here means §9.4's revised kitchen screens and monitors.)_
- **Routing:** the grid of #1363, with section 8's period choices in a cell. The "Where is this
  made?" tester goes (owner, 2026-10-07): the grid lays out every answer, and the station-closed
  explanations it gave no longer arise. The one thing only the tester showed is how extras are
  routed (`chooseExtraMaker`, `packages/venue-service/src/routing.ts`): an extra with no cell of
  its own or above it, which therefore falls through to the default station, is made with its dish
  instead, and so is an extra whose cell says No preparation. A cell that names a station, even the
  default one, sends the extra to that station (owner, 2026-10-07, A371). Only such an empty cell,
  and a No preparation cell, say so, for example "Downstairs bar (default) — as an extra, follows
  its dish"; a cell that names the default station does not.

### 9.4 Device profiles and devices

_(2026-10-08: revised to the owner's answers to the slice 5 plan,
[2026-10-08-a366-slice-5-monitors.md](../plans/2026-10-08-a366-slice-5-monitors.md), which holds
the detail. The earlier text called every kitchen screen a monitor, kept them to one kind of
device, and made "Run the pass" a profile action. Revised again 2026-10-09 to the owner's later
answers: any profile may offer a pass monitor; adding a station back to a profile gives it back to
a device still showing it as no longer available; a switched-off station keeps its waiting dishes
on a station screen.)_

Watchers go. A **device profile** says which kitchen screens its devices may run and what each may
show:

- **Station screen** (a working screen; buttons to start, ready and finish dishes): which stations.
  On a kitchen display whose profile has "Takes orders", each waiting dish (not an extra) also has
  Move to station (2026-10-09, A439). The server refuses a dish at a station the screen does not
  work, and records the device that moved it, and the person once one can sign in on a display.
- **Pass screen** (a working screen; Done on each dish, and Fire, Ready and Away): which stations
  and which zones. Whether Fire, Ready and Away show is a setting of the profile's screens, "Run
  the pass"; the server keeps checking the action each one takes (taking orders, preparing,
  handing over).
- **Pass monitor** (view-only, no buttons): which stations and which zones. Any profile may offer
  it (owner, 2026-10-09); it shows what the till's "All stations" pass board shows, limited to
  those stations and zones. On a till or handheld it is the Pass screen (plan default).

**Any device can run a station or pass screen.** A kitchen display runs exactly one kitchen screen,
with nobody signed in: the device is the one acting. A till's or handheld's choice narrows its
Station and Pass screens, and the person signed in acts. Done marks belong to the device, with the
person when someone is signed in. A kitchen display may later allow a sign-in that lapses only
after a long idle time (owner, 2026-10-08; backlog A436).

A **device** picks its profile, then its kitchen screen, then its stations and zones within what
the profile allows. Narrowing a profile is allowed: each device using it loses what was removed
and remembers what it lost, the dashboard says which devices changed, and the device shows "This
station is no longer available: Deli" in that station's place until someone chooses its stations
again. Adding the station back to the profile gives it back to a device still showing that line,
and the line clears; a device where someone has chosen since is not switched back, and the station
is simply offered again (owner, 2026-10-09). A station switched off on its own page shows the same
line on a kitchen display's station screen, with the dishes still waiting there below it until
they are done; new work goes elsewhere (owner, 2026-10-09). Today a device binds exactly one
station or watcher. Floor plan and sales monitors are later work.

## 10. Live controls

Not on the dashboard's configuration pages. "Close for today" and "Open for today" for a station
are on the till and the kitchen display; a manager's "keep … open until … today" is on the till.
The backlog's existing item for opening or closing a station from the till (S11) is folded in.
This placement was the designer's default; the owner did not choose between it and a live area of
the dashboard.

## 11. Receipts per department

**Revised 2026-10-09 from the owner's answers of 2026-10-08 ~22:30.** You edit one
department's authored receipt fields. Part A provides a Department picker in Venue settings →
Receipts that chooses both what you edit and what you preview; global settings are below it.
Part B puts the editor in the department's Receipt tab after slice 6 provides that page.

- **Only logo, phone, email, subtitle and footer move to departments.** Logo and contact fields
  are the same in every language. Trading name and its print switch keep their existing
  department-policy ownership and are recorded on the sale; Print a receipt (always, on
  request; auto/on_request), with the zones that differ, remains the service setting of section 6.
- **Current authored fields, recorded department.** A print, reprint, copy, A4 invoice and till
  receipt read that sale's recorded department's current fields, including when the department
  has been disabled. Only the trading name and its switch are the sale's receipt-header snapshot.
  A null department or absent header prints **no department authored fields**, with no default
  department fallback or trading name. Legal identity/NIF remain; the **current venue address** follows the
  **one global Print the address switch**. That switch stays in Venue settings.
- **Exact top order on thermal, A4, preview and till:** logo, trading name, **subtitle**, legal
  name, current address (global switch), phone, email, DUPLICADO, NIF. Absent optional fields
  are omitted without reordering. Keep the fiscal QR prefix and mandatory filed full-invoice
  particulars; the optional current address also follows this order on full invoices, while
  their filed domicile remains separate and the global switch cannot hide it. Label the field
  “Subtitle” / “Subtítulo”, with a placeholder saying it prints under the trading name.
- **Subtitle and footer, written per language.** Use the installed pack's receipt languages
  plus the current receipt language, with that language first; Spain offers Spanish, Catalan,
  Galician and Basque, without adding English. Resolve each field separately: text in the
  printed language → text in the venue's **CURRENT receipt language** → nothing. Blank means
  unwritten. Never take a third language's text. The original/reprint keeps the filed language
  even when the venue's receipt language has since changed.
- **Languages are stacked, not tabs.** Each heading names the language and carries ⚠ when a
  field there is missing but exists in another language, including a missing current-language
  field. No warning when all optional text is empty; explain the warning once. A refusal
  naming a language appears under that exact field and scrolls it into view, with the localized
  form summary on its own line above the buttons. Translations remain optional.
- **Independent preview language.** Its picker starts on the current receipt language and
  changes only the preview. Preview uses the department draft, current fallback language and
  global address-switch draft, with the same order and resolution as printing.
- **Permissions and draft safety.** Require `layout.configure` wherever receipt fields are
  edited. All saving forms use `draftScopeFor`, `saveActionState` and a save-handler early
  return, with unsaved-change tests and #1422 reconnect coverage. Save stays quiet/disabled
  until its draft changes. Switching departments negotiates that department's draft only;
  global drafts survive, and late work cannot overwrite another department's draft. No disabled
  default entry is needed for no-department printing; explicit disabled-department maintenance
  links can still open that department.
- **Consent has a separate contact fallback.** For invoice email delivery, a missing department
  uses the location's designated default department's contact. Retain the watcher default:
  missing/invalid department email also tries the default, and no valid default email means
  no email offer. Email and optional valid phone come from the **same** chosen contact, with
  provider availability still required. Offer and consent check share that resolver; accepted
  consent records that contact and is not rewritten by later edits. This rule never supplies
  authored fields to a no-department printed receipt.
- **Sale answers, not boot.** Each fresh sale, replay and bill-payment invoice answer carries
  its current resolved trim and separate global address presentation. Boot carries no
  department authored fields; an empty trim clears a previous department's fields.

The taxpayer's legal name, tax number, current venue address, **global Print the address switch**,
receipt language and description of what the business sells stay in Venue settings. Authored
fields live in venue-service's `department_receipts`; media reads department rows for logo usage.
Malformed imported optional fields and pictures are dropped defensively. Keep bounded logo
reads, unchanged-picture reuse and the requirement for a printable picture at both paper widths
when saving a logo. Bound optional receipt retrieval and contain recoverable automatic-print
failures so they do not undo a sale, with real read/format/enqueue/transaction probes during
implementation. This is no universal guarantee that a failed engine transaction can commit.

No old authored fields are carried over and no backfill or compatibility reader is added.
The existing global address switch persists without a reset; department receipts start empty.
The revised plan retains the existing global singleton for that switch and requires actual
SQL/upgrade/foreign-key probes before making migration-runtime claims.

## 12. What goes away

The Menu timetable screen; department and station hours; the all-day menu; zone menu choices; a
department's separate list of orderable menus (it becomes its periods' menus); the configured
service style (the recorded order mode stays); single-department list bypass; obsolete receipt-policy
never value; inheritance-prefix hints and labeled follow options; the tree table,
"Ready for service" section and old department/zone tabs; the "?" help on Order number; the
station fallback setting; the "Where is this made?" tester; watchers and the Tickets and Watchers tabs; the two-a-year local-holiday
cap; Venue settings' authored logo, phone, email, single-string subtitle and footer, which become
department fields (subtitle/footer per language); boot-authored receipt trim and the preview-only
department picker. The venue-wide address switch remains. The earlier slice 7 plan's default
department print fallback, any-language third fallback, per-department address switch and
language tabs are superseded design defaults, not behaviours claimed to have been implemented.

Waitron is not live, so data is dropped and recreated rather than converted (CLAUDE.md §3). Each
slice that changes a shipped table says "venue reset needed" in its pull request's first line.

## 13. Build order

The numbered slices describe the product areas. Owner-approved lane order overrides the original
serial order: slices 1 and 3A have landed; Lane E builds slice 6 Part A now, then slice 7.
Slice 6 Parts B/C stay with Lane D after slice 2/A429 respectively. Active slices 2 and 5 have
an explicit overlap waiver with 6A; whoever lands second reconciles source and regenerates journal
clashes. No other-lane checkout edits. Item 7 retains the approved two-PR split:

1. **Periods with menus.** Periods with a customer menu and staff-only menus; days and the normal
   week; the till sells only the current period's menus; the Opening hours page's Week (department
   view), Periods and Day views. Retires the menu timetable, department hours and the all-day menu.
2. **Zone closed times and named days.** The zone layer in the editor; refusing new orders in a
   closed zone; named days with kinds and repeats; real weeks; the Calendar.
3. **Manager extensions and live station controls on the till and kitchen display**, including
   "Close for today" asking where the work goes.
4. **Prep stations.** Station hours and fallbacks removed; worked-out times in the Week view;
   period choices in routing cells; combined tickets on shared printers; the Stations page slimmed.
5. **Monitors.** Device profiles' monitors and the device's choice; watchers retired.
   _(2026-10-08: superseded in its words by §9.4's revised model: kitchen screens and monitors.)_
6. **Departments.** The list, the Settings and Zones tabs, "How orders start", the service settings
   in the same words for both; the tree table and old tabs removed.
7. **Receipts per department**, with translated subtitle and footer, in two PRs: Part A's
   standalone department editor and Part B's Department Receipt tab (depends on slice 6).
   _(2026-10-09 lane order: slice 3A already landed #1469; BUILD proceeds with A366-6A, then
   A366-7A. Do not repeat the landed slice 3A build or receipt STEP 0 documentation work.)_

## 14. Later work, not in this design

- Shift planning that uses a station's worked-out times plus closing-up time.
- Floor plan and sales monitors.
- A "tonight" copy of the floor plan that resets each day.
- A254 §3.1's questions about tabs at a counter, and its advisor questions.
- Split the recorded order service mode into served-at and payment-due facts (owner, 2026-10-09;
  [backlog](../../backlog/service-periods.md#split-an-orders-recorded-service-mode-into-two-facts)).

## 15. Defaults the owner accepted with the spec

1. Live controls go to the till and kitchen display only (section 10).
2. A watcher printer that followed one zone (a "Terrace runner" printer) has no replacement:
   combined tickets are set on stations, which have no zone filter. Monitors keep the zone filter
   for screens. _(2026-10-08: pass screens and pass monitors both keep it; see §9.4's revised
   model.)_
3. Today a watcher keeps its own "Done" marks (`watcher_item_marks`); a pass monitor keeps that
   behaviour, per device. _(2026-10-08: superseded by §9.4's revised model: the Done marks are
   the pass screen's, per device, with the person when someone is signed in; a pass monitor has
   none.)_
