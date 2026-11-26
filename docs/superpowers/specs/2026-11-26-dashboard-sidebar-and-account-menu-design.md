# The dashboard sidebar and account menu: clearer sections, real icons, and who is signed in

Status: approved by the owner, 2026-11-26 (interactive design session, quoted below), after a
critique and three rounds of a working prototype on Claude's own dev stack. Points marked **my call**
were the session's; the owner saw each one in the prototype and did not change it. Item A1606.

## Why

A critique of the sidebar and the banner's account menu scored 25 of 40. The section names were
12 px teal capitals, so eight teal headings competed with the teal that marks the current page. The
section icons were 12 px, sat in the margin 16 px left of the text, and came from two drawing styles
(four in the banner). Several pages were in the wrong section, and the account menu never said who
was signed in.

The owner, on the critique:

- "i'm not crazy about the current icons and how they're displayed"
- First fix: "Icons and headings together"; scope: "Sidebar and account menu".
- On Purchasing: "the whole purchasing area is a future project for when restaurants use waitron for
  placing orders, but it is a long way off" (so it stays its own section, low in the list).
- On the Calendar: "calendar is tricky - a lot of it is about setting up the opening times of each
  department and thus the prep stations. it requires seasons and periods. all of which sit under
  venue. and it is also used to build the staff rotas … moving it away from venue setup may break
  that connection." Then, of the Rota entry described in decision 3: "it feels weird having the
  calendar in two places, but leave it like that for now".
- On languages: "there could be more than 2 languages to select from", "could be many".
- Page icons: asked whether pages need icons; told no, and why (decision 6); then "go".
- Language list alignment and flags: told left-aligned, and no flags (decision 9); then "go".

## Not in this work

- A role name in the account menu (needs a role read the dashboard does not make today; **my call**
  to leave it out).
- Any change to what a page does, who may open it, or its address. Only where it appears, its name
  and the shell's look change.
- Icons on pages (decision 6).

## Decisions

### 1. The sections and their pages, in order

Every page, core or module, carries an `order` number within its section, and the sidebar sorts one
list by it. This replaces core pages before module pages before `itemsAfterModules`.

| Section (English / Spanish) | Pages, in order |
| --- | --- |
| *(no heading)* | Overview, Bookings (decision 4) |
| **Sales and tax** / **Ventas e impuestos** (was Reporting / Informes) | Sales & takings, Orders, Invoices, Adjustment report, Check card payments, VAT return (modelo 303), Fiscal filing |
| **Team** / **Equipo** | Approvals, Rota (decision 3), Hours, Time corrections, Planned vs actual, Users, Staff roles, Access roles |
| **Products and menus** / **Productos y cartas** | Products, Menus, Set menus, Modifiers, Image library, Content languages, Courses, Units |
| **Venue setup** / **Configuración del local** (was Venue operations / Operaciones del local) | Venue settings, Departments and zones, Calendar, Seasons, Periods, Prep stations, Floor plans, Voids and comps, Appearance |
| **Hardware** / **Hardware** | Devices, Printers, Card readers, Device profiles |
| **Purchasing** / **Compras** | Purchases |
| **System** / **Sistema** | Box status, Backups, Servers, Cloud services, Email, Modules, Diagnostics, Handover intervals |

- The **Service** section is gone: Bookings moved up, Calendar back to Venue setup, Voids and comps
  to Venue setup.
- Moves: Content languages (System → Products and menus), Appearance (System → Venue setup),
  Handover intervals (Reporting → System), Voids and comps (Service → Venue setup).
- **"Card payments" becomes "Card readers" / "Lectores de tarjetas"** (the page of card readers),
  so it no longer reads like "Check card payments".
- Order inside a section: daily pages first, then weekly, then set-once (**my call**, from the
  critique).

### 2. Ordering is declared by each page

A module's page already has `order`; a core page gains one. Module pages keep declaring their own
section and order: core never names a module's page.

### 3. A Rota entry under Team opens the Calendar on its Rota tab

- The rota stays a tab of the one Calendar (Opening hours, Staffing, Rota): staffing is painted on
  the same seasons and special days as the opening hours, and the rota is filled from it.
- Team gets a **Rota** / **Turnos** entry, second, that opens the Calendar on the Rota tab
  (`/opening-hours/view/rota`). The staffing module's rota calendar view declares this entry
  itself (its section, order and label); core never names the view. Shown only to someone who may
  open the rota view.
- On the Rota tab, the sidebar marks **Rota** under Team as the current page and opens Team. On any
  other Calendar tab it marks **Calendar** under Venue setup. Pressing Calendar while the Rota tab
  shows opens the Calendar on Opening hours.
- Provisional: the owner called the two entrances "weird" and kept them "for now".

### 4. Bookings is a top-level row under Overview

Pages with no section heading sit at the sections' level, each with its own icon, with a hairline
below the last. A module may place a page there; it then declares its icon. **My call**: Bookings
is used daily, and a Service section with one page would be a heading over one row.

### 5. The sidebar's look

- **Icons: Google Material Symbols, Outlined, weight 400**, converted from their 960 grid to
  `wt-icon`'s 16 grid (attribution already in `apps/dashboard/src/icons.ts`). Section icons:
  Overview `home`, Bookings `event`, Sales and tax `receipt_long`, Team `group`, Products and menus
  `menu_book`, Venue setup `storefront`, Hardware `devices`, Purchasing `shopping_cart`, System
  `dns`. The folded strip's search keeps `search`.
- **Size and place**: 18 px (`--wt-font-size-lg`) inside the row, in its own column, then a 12 px gap
  (`--wt-space-3`) and the name. 20 px in the folded strip's 44 px buttons. **This revises A654
  (2026-10-15)**, which put the icon in the margin before a heading aligned with its pages; A654's
  other half stays: no icon is ever drawn in the primary colour.
- **Colour**: icons `--wt-color-text-muted` at rest; `--wt-color-text` on hover and for the section
  holding the current page.
- **Section names**: `--wt-color-text`, 14 px (`--wt-font-size-md`), semi-bold, sentence case, no
  letter spacing. 8 px (`--wt-space-2`) above each section.
- **Pages**: indented so their text starts under the section name's text; muted 14 px regular as
  today. The current page keeps its teal leading line and bold teal text: **teal marks only the
  current page**.
- **The open/close arrow** shows always, muted (**my call**: a closed section gave no sign it opens).
- **The folded strip's panel**: its pages are not indented, as it has no icon column.
- Touch and fine-pointer row heights stay as today (44 px on touch, 32 px with a mouse).

### 6. Pages get no icons

About 45 pages, many abstract (Periods, Seasons, Units, Courses, Modifiers, Diagnostics beside Box
status), would need invented, look-alike icons, and some would repeat their section's icon. An icon
then stops marking a section. Hierarchy comes from indentation and type instead.

### 7. The banner's buttons

- Bell, help, report a problem and the account button: one style (Material Outlined
  `notifications`, `help`, `feedback`, `person`), all 18 px, in 44 px buttons.
- **Report a problem** is icon-only at every width; its name stays as the button's accessible name
  and tooltip.
- **Help** draws the `help` icon instead of a typed "?"; while help mode is on, the button has a pale
  fill (`--wt-color-surface-lifted`), so it reads as a switch.
- The bell's count sits at the bell's top corner and does not cover the bell.

### 8. The account menu

- **The button shows the person's initials** (first letter of the first and last words of the
  display name, upper-cased) in a 28 px circle; the person icon only until the name is known. Its
  accessible name is "Account menu: <name>".
- **The menu opens with the name, then the email** (muted, ellipsis if long), then a line, then
  Account settings, a line, Theme, Language, a line, About Waitron and Log out.
- **Theme**: the label "Theme" on its own line, then three equal buttons, each with its icon and a
  word: Light / Dark / Device (Claro / Oscuro / Dispositivo; a new short string `theme.device_short`,
  the long "Follow device" stays the accessible name). The chosen one has a pale fill
  (`--wt-color-surface-lifted`) and a teal outline, never a solid teal block.
- **Language**: a row with the muted label "Language" and a button showing the current language's
  name and a down-arrow; it opens the language chooser's existing list of every language, so any
  number fits. The account menu stays open while that list is open; picking a language closes both.

### 9. The language list

Left-aligned, each language in its own name (Español, English, Català …), the current one marked as
the list already marks it. **No flags**: a flag names a country, not a language, and in Spain flags
beside Catalan, Basque or Galician carry political weight.

### 10. Shared pieces this changes

`theme-choices.ts` and `wt-language-chooser.ts` (and `wt-help-switch.ts`) are also used by the till
and the setup pages. Every place they appear takes the new look; check each by looking (both themes,
phone width) and adjust there only if something breaks. The down-arrow on the language button
appears wherever that button does.

## What the build also changes

- `docs/developers/design-system.md`, "Dashboard sidebar navigation": rewrite for decisions 1–5,
  marking the A654 revision with a dated pointer; the A654 entry in
  `docs/backlog/dashboard.md`'s decisions gets the same pointer.
- The guides, English and Spanish, wherever they name a moved or renamed section or page (for
  example `opening-hours.md` "under **Venue operations**", `printers.md` "**Card payments** in
  Hardware", `servers.md` "open **Reporting**, then **Handover intervals**"). Grep both languages for
  the old names.
- Tests that pin the old order, labels, icon names, or the icon's margin placement change with the
  decisions above; the behaviour they guard (permission filtering, search, folding, the strip panel's
  keyboard handling) stays asserted.

## References

- Approved pictures (never commit): `~/workspace/repos/waitron/.impeccable/shots/nav-a1606-*.png`,
  1 to 10. Picture 1 shows the final order; pictures 2 and 9 predate decisions 3 and 4, so for order
  this spec wins.
- The prototype's changes, for reference only (untested, with shortcuts marked PROTOTYPE that the
  build must not copy): `~/waitron-campaign-d/a1606-nav-prototype.patch`.
- The critique: `~/workspace/repos/waitron/.impeccable/critique/2026-11-26T12-09-22Z__apps-dashboard-src-dashboard-app-ts.md`.
