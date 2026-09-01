# UI review — the polished-product walkthrough tracker

The authoritative state of **Track 1** (UI/UX polish & correctness) from [backlog.md](backlog.md).

We walk every chunk of functionality in **customer-journey order**: Claude boots the app and shows
the owner how each area works today (screenshots + plain English), the owner then plays with it and
corrects what is wrong or unintuitive, and the fixes land. This file records where we are so the
walkthrough survives a context clear.

**Run path:** `pnpm dev:setup && pnpm dev` — till <http://localhost:5190>, dashboard
<http://localhost:5191>, setup <http://localhost:5192>. Till PIN **5555**; dashboard
**owner@demo.waitron.local / dashPass123**.

**Status legend:**

- ⬜ **not examined** — not yet looked at
- 🔍 **shown** — Claude has walked it; awaiting the owner's hands-on pass
- 👤 **reviewing** — owner is playing with it / feeding back
- 🔧 **corrections logged** — issues captured below, fixes not yet landed
- ✅ **done** — reviewed, and any corrections have landed

## Walkthrough order & status

| # | Area | App | Status | Corrections logged |
| --- | --- | --- | --- | --- |
| 1 | First-run setup & onboarding wizard | setup | ⬜ | inactive in trading mode — may skip or review separately |
| 2 | Till login & shift start (PIN) | till | 🔍 | shown 2026-09-01 — see candidates below, awaiting owner |
| 3 | Counter / walk-up sales — menu, basket, modifiers, notes/doneness, park/retrieve, pay, receipt | till | ⬜ | |
| 4 | Tables & tabs — floor view, open / move / join / merge / transfer / split | till | ⬜ | |
| 5 | Coursing & rounds — build, hold/fire, course move, recall/cancel | till | ⬜ | |
| 6 | Handheld tableside ordering & cash-at-table | till (handheld) | ⬜ | |
| 7 | KDS — stations, tickets, courses/fire, expo, printing, timing alerts | till (KDS) | ⬜ | |
| 8 | Payments — cash, manual card, integrated reader, tips | till | ⬜ | |
| 9 | Dashboard home — business overview | dashboard | ⬜ | |
| 10 | Menu management — products, recipes, images, allergens, dietary, modifiers, membership | dashboard | ⬜ | |
| 11 | Floor plan editor (spatial canvas) | dashboard | ⬜ | |
| 12 | Table & service status config | dashboard | ⬜ | |
| 13 | Stations, routing & printers (Impresoras) config | dashboard | ⬜ | |
| 14 | Reporting — daily close, cierre Z, VAT, modelo 303, purchase invoices | dashboard | ⬜ | |
| 15 | Staff / users / roles / login methods | dashboard | ⬜ | |
| 16 | Workforce — registro de jornada, scheduling, roster, requests | dashboard | ⬜ | |
| 17 | Bookings — reservations day-list | dashboard | ⬜ | |
| 18 | Diagnostics & logs viewer | dashboard | ⬜ | |
| 19 | Device management — enrol / revoke | dashboard | ⬜ | |
| 20 | Locations / venue config — invoice locales, printing, cash-drawer policy | dashboard | ⬜ | |

## Corrections log

As the owner finds issues they land here as a checklist per area, then become fixes. Keep each item
one line; the fix's detail belongs in its PR/commit, not here.

### 2 — Till login & shift start

Candidates from the first look (awaiting owner confirmation — not yet fixes):

- [ ] Layout is sparse and top-left-aligned with a large empty area — reads more like a debug form
      than a polished POS lock screen (no centring, no branding, no "tap to begin").
- [ ] "Choose your name" (who you are) sits directly above "Set up as kitchen display / waiter
      handheld" (what this device is) — two different concepts stacked with no separation; a staff
      member could tap a device-mode button by mistake.
- [ ] The admin user shows as **"Administradora"** (Spanish) among otherwise English staff names with
      an `en-GB` locale — likely a seed-data naming choice; confirm whether the admin should have a
      real person name.
- [ ] `en-GB` locale toggle is a small button bottom-left — confirm it belongs on the login screen and
      whether it should read as a language name ("English") rather than a locale code.
