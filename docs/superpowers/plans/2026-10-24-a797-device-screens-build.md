# A797 — The fixed screens for the handheld, the kitchen screen and the pass: build plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Implementers are dispatched as `subagent_type: "implementer"`.

**Goal:** Build design §8's slices one pull request at a time. This plan outlines every slice and
gives **slice 4 — Zones on this device on a handheld**, **slice 5 — The Ready bar and remembered
List/Map**, **slice 1 — Short names, data**, **slice 2 — Short names, dashboard**, **slice 3 —
The handheld's bar**, **slice 6 — Ready warning time, data**, **slice 7 — The Ready bar's
warning**, **slice 8 — Kitchen group cards**, **slice 8b — Short names on kitchen cards**,
**slice 9 — The Columns controller and collapse**, **slice 9b — The corner Columns panel** and
**slice 9c — Overview and the narrow tabs** in full tasks; each other slice is expanded into
tasks when it starts.

**Spec:** `docs/superpowers/specs/2026-10-18-a797-device-screens-design.md` (read it whole; this plan
argues from it). Pictures: `docs/backlog/mockups/a797-device-screens/`.

**The owner's answer to Q51 (2026-10-24 04:29, verbatim from lane C's questions file):** "Q51
approved": every recommendation in (a)–(g) stands as written, with (c)'s Ready warning time
(3 minutes by default) set in each prep station's editor beside its three late-flag times. The new
words in (f) and (g) may land. So nothing in §8 waits for Q51 any more: slices 6–7 are unblocked.

**Tech stack:** TypeScript, Hono, drizzle-orm over `node:sqlite`, Lit, Vitest 4.1.12 (node projects
for the server; real headless Chromium for `@waitron/till`, `apps/till/vitest.config.ts:56-60`).

**Words used here.** A **handheld** is a till-app device whose profile's form factor is
`phone-portrait` or `tablet-landscape` (`apps/till/src/layout.ts:21-36`). The **device's zone
choice** is what ☰ → Zones on this device saves: which of the profile's zones the device shows and
which it opens first. It is stored per device and profile (`device_zone_selections` and
`device_zone_selection_zones`, `packages/venue-service/src/schema/device-zone-selection.ts:4-54`).
The **profile's zones** are the zones the dashboard lets a profile work in; the server enforces
them on every till route (CLAUDE.md §3, "the profile's zones bound where it serves"). The device's
zone choice is a display choice inside them and grants nothing. **☰** is the More menu at the right
of the till's top bar.

How claims are marked: **(ran)** means a command was run on 2026-10-24 against `main` at
`c4d7ffa3f` (this worktree's base) and its result is quoted; **(read)** means read in the code at
that commit, not run. A probe is a throwaway change made in a scratch worktree
(`git worktree add --detach /tmp/a797-4-probe.2aHF/wt c4d7ffa3f`) to see which tests a change
breaks; it was discarded and none of it is in this branch.

---

## Global constraints

Every task's requirements include these.

- `CLAUDE.md` §1: a sentence about behaviour carries a receipt (a command run or a cited
  `file:line`); "pre-existing", "unreachable", "harmless" are claims and get checked.
- General code is English only. Spanish goes only in translation files (`apps/till/src/i18n/`,
  `apps/dashboard/src/i18n/strings.ts`, `packages/venue-service/src/dashboard/strings.ts`'s `es`
  block) and the Spanish guides under `apps/server/src/guide/es/`. Guard:
  `scripts/english-only.test.ts` (weaker than its name: it skips `apps/*`, so review greps the diff).
- Product text is as short as the meaning allows. The words Q51 (f) and (g) settled land as written
  in design §10.
- Pre-live: no backwards-compatibility or data-migration code. A venue may be reset; if a slice
  needs one, the PR's first line says so.
- Never hand-edit a migration file, a snapshot or `_journal.json`; drizzle-kit writes them
  (`pnpm --filter <pkg> db:generate --name <name>`). A number collision on rebase is fixed by
  regeneration (CLAUDE.md §3). **Read the generated SQL**: a rebuild of `dining_tables` or
  `kitchen_stations` is a STOP (foreign keys are on during a rebuild, CLAUDE.md §3).
- Coverage holds `98/98/98/95` in every package. Code a slice leaves unreached is deleted, never
  excluded or hidden under an ignore comment.
- Each implementer runs, before committing: the task's focused tests, `pnpm --filter <pkg> typecheck`
  for every package it changed, `pnpm exec eslint <every file it changed>` from the root, and
  `pnpm format:check`. **Every task ends green and committed** (`git commit -s`). The till is a
  browser package: check free memory first (`memory_pressure | grep free`), and read the `Tests`
  count, never only the exit status (CLAUDE.md §4).
- **Changed test checks.** An existing test check may change only where this spec changes what it
  checks. Each such change is listed in the PR body under "Changed test checks", one line per test,
  with the reason. A fixture change that leaves every check as it was is not a changed check but is
  listed too, under "Fixture-only". **A failing test this plan does not explain is a STOP**: report
  it, do not edit it.
- Keep the campaign ledger `/Users/clintongormley/waitron-campaign-c/item-a797-ledger.md` current at
  the end of every task, and record there **the exact name of every test the task deleted or whose
  check it changed, with one line of reason each**, so the PR's "Changed test checks" section lists
  them without re-deriving them.
- Stop only processes you started, by the ids you recorded (global rule). `wa-wt down <name>` stops
  the dev stack `wa-wt demo <name>` started.

## Build order (why slice 4 comes first)

Design §8 orders the slices 1 → 12b. The lane builds them in a different order for one reason:
**slice 1 adds a migration to the core set** (`dining_tables` and `floor_plan_tables` are core
tables, `packages/db/src/schema/dining-tables.ts:19`, `floor-plans.ts`), and the lane's parked PR
**#2037** (A756 PR 7, branch `feat/a756-7-bump-mode-per-station`, open; ran:
`gh pr view 2037 --json state,headRefName`) adds core migration `0188_station_bump_mode.sql` (ran:
`gh pr diff 2037 --name-only`). The lane may not open a second migration branch while a parked one
is open. So:

1. **Slice 4** first — independent, no migration (this plan, below).
2. **Slice 5** next — independent, LIGHT, no migration.
3. **Slices 1–3** once #2037 lands; then 6–7 (slice 6 is also a core migration, on
   `kitchen_stations`, which #2037 also changes). _2026-10-25: #2037 landed on 2026-10-24 and
   slice 4 in #2041, so slices 1–3 are no longer barred; slice 5 was built first (#2063), and
   **slice 1 is now being built** (branch `feat/a797-1-short-names-data`, its section below),
   then 2 and 3. Slice 6 is the next core migration and waits until slice 1's has landed._
4. Slices 8–9c take turns with lane G's A773-2 (design §7); 10–11 wait for A803's slice 3 (not on
   `main`: ran `git log --oneline -400 | grep -i a803` shows slice 5, #1953, and no slice 3); 12b
   follows A773-2.

**#2037 also edits files slice 4 edits** (ran: `gh pr diff 2037 --name-only`): `apps/till/src/till-app.ts`,
`apps/till/src/till-app-device-zones.test.ts`, the `apps/till/test/*-app*.ts` fixtures and this
item's design file. Whichever lands second rebases; expect small conflicts there.

---

## Slice outlines (each expanded into tasks when it starts)

Each outline: goal, file set, risks, review path, migration, dependencies, open decisions. File sets
are from grep (ran) at `c4d7ffa3f` and are re-grepped when the slice starts.

### Slice 1 — Short names, data (FULL; migration, core set)

**Goal:** design §3.7 and §5 first bullet: every live and saved table gets a short name, filled by
Q51 (a)'s rule (≤ 4 characters kept; else initials in capitals plus the trailing number; a one-word
name with no number keeps three letters; at most 5 characters), unique in the venue ignoring case;
refusal `table.short_name_taken` `{ shortName, takenBy, field: "shortName" }`; the reset copies
it; the floor read carries it.
**File set (ran: `grep -nE "label_taken|namesTaken|spareLabels|sameName"`):**
`packages/db/src/schema/dining-tables.ts` (`unique("dining_tables_location_label_key")` `:26`),
`packages/db/src/schema/floor-plans.ts`, `apps/server/src/floor-plan.ts` (`namesTaken` `:313`,
refusal `:378-382`), `apps/server/src/floor-today-store.ts` (`spareLabels` `:840`, reset `:672`),
`apps/server/src/floor-today-name.ts:16`, `apps/server/src/errors.ts:386`, the status maps
(`till-api.ts:560`, `management-api.ts:267`), both code catalogues (`apps/dashboard/src/i18n/codes.ts:578`,
`apps/till/src/i18n/codes.ts:193`), the floor read, `packages/db/src/configuration-transfer.ts`.
**Risks.** Many tables hold a key into `dining_tables` (ran: `grep -rln "diningTables.id"` lists
bookings, orders, parties, floor plans, department transfers, table clearing, service steps), so a
generated rebuild would cascade-delete their rows: declare the case-folded copy's uniqueness as a
`uniqueIndex` (a `CREATE UNIQUE INDEX`), not a `unique()` table constraint, and STOP on any
`__new_dining_tables` in the SQL. `label` is plain text with no CHECK (`packages/db/src/schema/columns.ts:162`),
so a nullable `label` column should come out as `ALTER TABLE … ADD` — read it. Every writer fills
the short name and its lower-cased copy (design §5); list them. The joined-table and renamed-today
cases (design §9) are settled in this slice's task list.
**Dependencies:** #2037 landed. **Open decisions:** the column names; what a today's join shows
(design §9 proposes "T4+T5"). _Expanded into tasks below (2026-10-25)._

### Slice 2 — Short names, dashboard (LIGHT)

**Goal:** the Short name field (Q51 (g): «Nombre corto») in the floor-plan editor's table panel
(`apps/dashboard/src/screens/floor-plan-table-panel.ts`), Add tables' preview
(`floor-plan-add-tables.ts`) and Add joined table (`floor-plan-add-joined-table.ts`), proposed from
slice 1's function; the refusal under the field ("Terrace 1 already uses T1", «Terraza 1 ya usa
T1»). **Risks:** the proposal must be the same function the server uses (one home, shared
package). Forms rules (design-system.md → Forms): marked, explained beside the field, Save quiet
until the draft changes, a `*.unsaved.test.ts`. **Dependencies:** slice 1. **Migration:** no.
_Expanded into tasks below (2026-10-26); slice 1 put the rule in `@waitron/shared`, so nothing
moves._

### Slice 3 — The handheld's bar (FULL; a till read changes)

**Goal:** design §3.1 top bar: Floor, one "✎ T4" button per table with this person's unsent dishes,
the table on screen highlighted, Floor opens the last table's zone, language into ☰, ☰ in §3.1's
order (this is where the ☰'s "Settings:" group of Zones on this device · Card reader · printer ·
Language · Theme is built; slice 4 only adds the Zones entry). The floor read's `UnsentDraft`
(`apps/server/src/order-drafts.ts:343`) gains the owner's id and the draft's saved time.
**File set:** `apps/till/src/widgets/till-shell.ts` (`LEAVE_ORDER` `:54`, `#items`, `#menu`),
`apps/till/src/till-app.ts`, `apps/server/src/order-drafts.ts` (`readUnsentDrafts` `:1242`), the
floor read's type in `apps/till/src/api/client.ts`, strings en/es. **Risks:** the shell's fit loop
(`#fit`) and its many width tests (`till-shell.test.ts`); the bill choice on opening is slice 11.
**Dependencies:** slice 1 (short names), and slice 4's ☰ entry. **Migration:** no. _Expanded into
tasks below (2026-10-26)._

### Slice 4 — Zones on this device on a handheld (FULL; full tasks below)

### Slice 5 — The Ready bar and remembered List/Map (LIGHT)

**Goal:** design §3.1 Floor: at phone width a fixed bottom "🍽 Ready · T5 · 2 · Open ›" bar
(«Listo · T5 · 2 · Abrir ›») replacing `#stationSummary` (`apps/till/src/screens/till-floor-screen.ts:2909`,
drawn at `:2392`); above phone width the summary stays, retitled "Ready" (`floor.ready_title`,
`apps/till/src/i18n/strings.ts:1018`, `:2742`; Q51 (f) 8). List/Map remembered on the device per zone
instead of the session-only `viewOverride` (`till-floor-screen.ts:831`, `:1249-1250`, `:2261`).
**Risks:** which tables the bar lists on a device whose zone choice hides some zones — after slice
4 the floor is handed only the chosen zones but every table (`till-app.ts:17752-17766`); decide
whether the bar follows the zone choice, and say so. The storage key names venue and device
(design §3.6). Until slice 1 lands the bar shows full names. **Dependencies:** none (slice 4 first,
so the zone question above is real). **Migration:** no. _Expanded into tasks below (2026-10-25)._

### Slice 6 — Ready warning time, data (FULL; migration, core set)

**Goal:** Q51 (c) as answered: a fourth minutes value per prep station, **3 by default**, set in
the station editor and Add station beside Warm, Overdue and Forgotten after (the late-flag panel and
per-station overrides went in A756 PR 5, design §3.6 note). Each station's entry in the floor read's
`ready` signal (`packages/shared/src/table-signals.ts:13`; built at `apps/server/src/table-signals.ts:113-120`)
gains its oldest `ready_at` and its warning minutes. Q51 (f) 7 renames "Warm after" to "Waiting
after" and unifies the Spanish in those fields (design §3.8 Warm row).
**File set (ran: `grep -rlnE "forgottenAfter|forgotten_after|overdueAfter"`):**
`packages/db/src/schema/kitchen-stations.ts:19-21`, `packages/shared/src/timing.ts`,
`packages/provisioning/src/kitchen-timing.ts`, `packages/venue-service/src/dashboard/station-editor.ts`,
`prep-stations-screen.ts`, `routing-client.ts`, `apps/server/src/table-signals.ts`, `kitchen.ts`,
`management-api.ts`, `working-order.ts`, `apps/dashboard/src/api/client.ts`,
`packages/reporting/src/overdue-orders.ts` (reads the limits; check it needs nothing).
**Risks:** a cross-package contract (the signal's shape); `kitchen_stations` is the table #2037
changes, so this slice starts after it and regenerates on top of `0188`; an added `count()` column
with a default is expected to be `ALTER TABLE … ADD` (no CHECK in `columns.ts`, read) — read the SQL.
**Do not add the new value to the ordered-thresholds CHECK** `kitchen_stations_thresholds_ordered`
(`packages/db/src/schema/kitchen-stations.ts:53-56`, warm < overdue < forgotten): changing a table's
CHECK makes drizzle rebuild the table (CLAUDE.md §3); check the ready-warning bound in the writer.
**Dependencies:** #2037 landed; slice 1's migration landed or not open. **Open decisions:** the
column name; whether the station editor's existing three fields keep their order with the fourth last. _Expanded into tasks below (2026-10-26)._

### Slice 7 — The Ready bar's warning (LIGHT)

**Goal:** amber (`--wt-color-warning`), slow pulse (`--wt-duration-pulse-slow`), edge dimming to
`--wt-color-warning-pulse-dim`, the longest-waiting table first with its minutes ("🍽 Ready 4 min ·
…", «Listo 4 min»), judged per station against that station's own minutes; nothing moves under
reduced motion. **Dependencies:** slices 5 and 6. **Migration:** no. **Risks:** the clock is
`ready_at`, not the waiting clock's `queued_at` (design §5); a fake-timer browser test must advance
the awaited animation frame (CLAUDE.md §4). _Expanded into tasks below (2026-10-26)._

### Slice 8 — Kitchen group cards (LIGHT)

**Goal:** design §3.3: one card per group in today's columns; tap a dish, or the heading (today's
per-dish route for each dish); the age band; the header line ("5 dishes to make · 1 late"); the
Tickets view and its switch go. **File set:** `apps/till/src/widgets/station-queue.ts` (card label
`:871`, `:946`, `:1021`), `apps/till/src/screens/till-station-screen.ts`, strings. **Risks:** lane G
edits the same files (take turns, design §7); #2037 changes `station-queue.ts` and the station
screen's bump mode (ran: `gh pr diff 2037 --name-only`), so the heading tap meets the per-station
bump mode it adds (design §9 asks the plan to trace it). **Dependencies:** #2037 landed, turn agreed
with lane G. **Migration:** no. _Expanded into tasks below (2026-10-26)._

### Slice 8b — Short names on kitchen cards (FULL; a station read changes)

**Goal:** the station read carries each table's short name; the card shows it. The read also says
whether a bill is a counter order, so a counter card reads "Counter #12" (slice 8, D5).
**Dependencies:** slices 1 and 8. **Migration:** no. _Expanded into tasks below (2026-10-27)._

### Slice 9 — The Columns controller and collapse (LIGHT)

**Goal:** one device-scoped store of each screen's order, shown and collapsed columns, meeting
A773-2's interface (`readColumnState`, `saveColumnState`, `moveColumn`, `toggleColumnCollapsed`,
`setColumnVisible`, key `waitron.kitchenColumns.v1.`; A773-2 plan lines 101, 289–291); heading-tap
collapse ("Ready · 3"). **Risks:** whichever lane builds it first, the other uses it (design §7).
**Dependencies:** slice 8. **Migration:** no. _Expanded into tasks below (2026-10-27)._

### Slice 9b — The corner Columns panel (LIGHT)

**Goal:** corner → Columns («Columnas»): Move up / Move down («Subir», «Bajar») and a Show switch
(«Mostrar») per column. A new dialog with staged input takes a draft scope and a
`*.unsaved.test.ts` (CLAUDE.md §3). The one-row header of picture 03 (the station's name, its
Open/Closed chip and the header line) comes with the corner's Columns (slice 8, D9). It wires
`moveColumn` and `setColumnVisible` from slice 9's `apps/till/src/state/kitchen-columns.ts` and
draws `hidden`, which slice 9 stores but does not draw (slice 9, D7).
**Dependencies:** slice 9. **Migration:** no. _Expanded into tasks below (2026-10-27)._ _Its
window applies each tap at once, so it takes no draft scope (its D2)._

### Slice 9c — Overview and the narrow tabs (LIGHT)

**Goal:** the Overview column («Resumen») with "Secreto ibérico 2 +2", built on the one counting
function A773-2's pass reuses; below about 1000 px the columns become tabs in the chosen order, a
late card's tab carrying a red bar. **Dependencies:** slice 9. **Migration:** no. **Open
decision:** the measured switch width (design §9). _Expanded into tasks below (2026-10-27)._

### Slice 10 — Handheld order at phone width (LIGHT)

**Goal:** design §3.1 Order: the Menu / Order · 3 switch, the fixed bottom New order bar with Send
all, the fixed foot (A803 builds its contents and quiet Pay), tile counts, the opening view (Menu
until anything is sent). "Review (n)" and its view go (`strings.ts:1313`, design §6).
**Dependencies:** A803's slice 3 (not on `main`). **Migration:** no.

### Slice 11 — The switcher's unsent marks and the bar button's bill (LIGHT)

**Goal:** "✎ Bill 2 unsent" («✎ Cuenta 2 sin enviar») on the closed switcher and "✎ Unsent" in its
list; the bar button opens the bill this person saved last (`order_drafts.updated_at`), a tie to the
lower bill number. **Dependencies:** slice 3 and A803's slice 3. **Migration:** no.

### Slice 12b — Short names on pass cards, and Overview on the pass if A773-2 shipped without it (FULL)

**Goal:** the pass read gains the short name; Overview on the pass through slice 9c's function if
A773-2's pass task landed first (design §7). **Dependencies:** A773-2's pass (slice 12) and slice 1.
**Migration:** no. **Open decision:** lane G confirms (design §7).

(Slice 12 is A773-2's, built by lane G; not in this plan.)

---

## Slice 4 — Zones on this device on a handheld (one PR, branch `feat/a797-4-handheld-zones`)

**What it changes.** A handheld gets the till's ☰ → Zones on this device. Its choice narrows the
handheld's Floor the way a till's choice narrows a till's: the Floor is handed only the chosen zones
and, once a choice is saved, opens on its "Opens first" zone (D2b); and a table's New order in
a zone the device does not show cannot be added to or sent from this device (D3). Worked example 6 (design §4): Luis unticks Inside and Bar; his Floor shows no
zone tabs, while a manager's phone with the same profile still shows all three.

**Review path: FULL.** Which zones a signed-in device works in, and **a cross-package contract
change**: the device-zones read gains `saved: boolean` (D2b) — its type in
`packages/module/src/module.ts:529-542`, its reader in `packages/venue-service/src/device-zone-selection.ts`,
the server routes that send it (`GET`/`PUT /api/device/zones`, `apps/server/src/device-api.ts:362-394`,
which pass the reader's answer through) and the till client's type (`apps/till/src/api/client.ts:14`,
`:3449-3462`, which imports the same type from `@waitron/venue-service`). No route stops refusing
or starts serving anything (D5).

**Migration: none** — `saved` is worked out from whether a stored row exists, not stored itself.
The choice is already stored per device and profile with no form-factor
column (`packages/venue-service/src/schema/device-zone-selection.ts:4-54`, read), and its read and
write ignore the form factor except to fingerprint it (`packages/venue-service/src/device-zone-selection.ts:28`,
`:98`, read). No schema file changes in this slice.

### Every reader and writer of the device's zone choice (ran: grep; each line read)

`grep -rlE "zoneSelection|zone-selection|ZoneSelection|zone_selection|deviceZones|DeviceZones|device_zone" --include='*.ts' apps packages scripts`
(ran), less migrations and snapshots:

| Where | What it does | Form-factor gate today |
| --- | --- | --- |
| `packages/venue-service/src/device-zone-selection.ts:20-112` `readDeviceZoneSelection` | the device's current profile's zones, the stored choice clipped to them (`:76-83`, `adjusted` when clipped), the first zone | none; form factor only in the fingerprint `:98` |
| same file `:114-152` `setDeviceZoneSelection` | refuses a stale fingerprint (`device_zones.changed`), a zone outside the profile or an empty choice (`device_zones.invalid`); replaces the stored set | none |
| same file `:154-167` count / remove | device delete | none |
| `apps/server/src/device-api.ts:362-394` `GET` / `PUT /api/device/zones` | `currentZoneDevice` (`apps/server/src/device-zones.ts:9-21`: still signed in, device still proven, same location, person admitted to the profile); PUT also refuses while a payment is in progress | **none** — a handheld can already read and save (see D5's receipt) |
| `apps/server/src/till-api.ts:1527-1574` `GET /api/default-service-zone/offers` | a till: counters narrowed by the choice, context = the chosen first counter; a handheld: every counter of the profile, context = the profile's start (`resolveNewOrderZone`) | **yes**, `:1540`, `:1543` |
| `apps/server/src/device-delete.ts:135`, `:207` | counts and removes on delete | none |
| `apps/till/src/state/device-zones.ts:4-33` `deviceZoneNavigation` | counter and floor zone lists, first zone, home | a handheld branch keeps only table zones (`:17`), **never reached** today because a handheld never holds a choice (next row) |
| `apps/till/src/till-app.ts:5001-5006` sign-in | reads `getDeviceZones()`; sets `profileServiceZones` from it | **till only** |
| `till-app.ts:5007-5037` | a till with no chosen counter loads empty counter offers; otherwise `listDefaultZoneOffers()`; a handheld then takes `profileServiceZones` from that route's `zones` (`:5033`) | till only (`:5008`), handheld only (`:5033`) |
| `till-app.ts:3352-3373` `#deviceNavigation`, `#homeScreen`, `#resolveScreen` | navigation from the choice; a handheld's home and screens come from `homeScreenFor`/`resolveBuiltInScreen` | till only for screens (`:3361`, `:3368`) |
| `till-app.ts:9098-9108` `#openDeviceZones` | opens the dialog | **till only** (`:9099`) |
| `till-app.ts:9149-9153` `#deviceZoneAllows` | false for a zone the choice hides; used by the counter basket (`:2365`, `:5509`) and the table order screen's `orderingAllowed` (`:17783`, `:17917`) | **till only** (`:9150`: a handheld allows every zone) |
| `till-app.ts:9155-9200` `#readLiveDeviceZones` | on each menu-poll tick (every 15 s, `apps/till/src/state/menu-state-poll.ts:4`; called at `till-app.ts:2692`) re-reads the choice; a change re-reads `/api/till` and applies when no order in a hidden zone is open | **till only** (`:9156`) |
| `till-app.ts:9202-9238` `#reconcileSavedDeviceZones` | applies a pending choice; sets `profileServiceZones` from it | none (only ever has a choice on a till) |
| `till-app.ts:9240-9290` `#saveDeviceZones`, `#hidesOrderZone` `:9139-9147` | saves; refuses hiding the zone of an open order ("Park, send or cancel this order before hiding its zone.") | none |
| `till-app.ts:17752-17766` Floor | `.zones` filtered to the choice's floor zones on a till; **every zone** on a handheld; `.selectedZoneId` from the choice's first zone | till only (`:17754`) |
| `till-app.ts:17700-17711` Counter, `:18722-18741` shell props | counter zones, Counter/Floor tabs | till only (no Counter on a handheld, `apps/till/src/built-in-screens.ts:5-10`) |
| `till-app.ts:18384-18421` | the Settings dialog (Equipment; Zones on this device) and `till-device-zones-dialog` | reached only from the till's ☰ |
| `till-app.ts:18791` | department transfers' accept-zone list (`profileServiceZones`) | — |
| `apps/till/src/widgets/till-shell.ts:893` | the till's ☰ → Settings (`open-settings`) | **till only** (`#tillMenu`) |
| `apps/till/src/widgets/till-shell.ts:716` | a handheld's bar/☰ item Equipment (`open-equipment`), no Settings and no zones entry | handheld |
| `apps/till/src/widgets/device-zones-dialog.ts` | lists the profile's zones with Show, Zone, Kind (Floor plan / Counter), Opens first | none |

What else narrows a device's zones: the **profile's zones**, which the server applies to the floor
reads themselves — `/api/tables`, `/api/tables/state` and `/api/zones` keep only the profile's zones
(`readZoneScope` + `inScope`, `apps/server/src/till-api.ts:2729-2790`, read) — and to every till
route (`till-api.profile-zones.test.ts`'s route-to-zone map, `:46-130`, read). The device's choice is
applied only in the till app; the floor read returns the profile's zones whatever the choice says.

### Plan decisions for slice 4

- **D1. A handheld reads, edits and follows its zone choice where a till does**, through one
  predicate in `TillApp`: `#choosesZones(): boolean` — true for `till`, `phone-portrait` and
  `tablet-landscape`, false for `kds` and an unknown form factor. It replaces the till-only gates at
  `till-app.ts:5001` (the sign-in read), `:9099` (`#openDeviceZones`), `:9150` (`#deviceZoneAllows`)
  and `:9156` (`#readLiveDeviceZones`). Those four gates and two more keep the feature off a handheld
  today: the Floor's zone filter (`:17754`, D2) and the shell, whose only Zones on this device entry
  is in the till's own menu (`till-shell.ts:893`, `#tillMenu`; D6). **Why:** the owner's standing
  rule "any device does everything except the cash drawer" (design §1) gives a handheld the till's
  feature without a question.
- **D2. A handheld's Floor is handed the zones its choice keeps, of every kind its Floor shows
  today.** `deviceZoneNavigation`'s handheld branch changes from "table zones only" to "every chosen
  zone", still with no Counter (`counterZoneIds: []`), and `till-app.ts:17754` filters by
  `floorZoneIds` whenever a choice is held, on a till or a handheld. **Why:** today a handheld's
  Floor is handed every zone of the profile, counter zones included (`till-app.ts:17754-17756`), and
  A740 kept it so on purpose: "the screen's existing non-seating refusals and occupied-table recovery
  remain available to the other form factors" (`docs/superpowers/plans/2026-10-16-a740-zones-on-device.md:24-25`).
  The demo shows why it matters: its Downstairs bar is a counter zone with tables B1–B3 (the seed
  sets its `orderStart` to `counter`, `apps/server/scripts/demo-seed/seed-floor.ts:88-109`; tables
  `floor.ts:184-186`), so a table-only Floor would take them off every handheld. A till can drop
  counter zones from its Floor because it has a Counter; a handheld has none
  (`built-in-screens.ts:7-8`). With no stored choice every zone in the device's zone list is chosen
  (`device-zone-selection.ts:76-78`), so the **tabs** are today's, because every zone `/api/zones`
  returns is in that list (read, not run): `/api/zones` lists the active floor zones in the
  profile's scope (`apps/server/src/tables.ts:63-78`, `till-api.ts:2756-2762`), the list is the
  active zones with a service policy in an active department (`packages/venue-service/src/operations.ts:100-129`),
  a zone is created with its policy (`createServiceZone`, `operations.ts:478-528`: it inserts the floor zone, then calls `configureZone`), and deleting a service makes its
  zones and department inactive together (`packages/venue-service/src/service-delete.ts:343-345`).
  The **opening zone** is D2b. **Alternative, for the owner if wanted:** table zones only on a
  handheld too, as on the till's Floor ("Floor contains only selected table zones",
  `docs/developers/design-system.md:5338`).
- **D2b. A handheld with no saved choice keeps today's tabs and opening zone; a saved choice's
  "Opens first" zone always applies on a handheld, a counter zone included.** (Driver's ruling,
  2026-10-24, replacing an earlier counter-zone fallback.) Today a handheld's Floor gets no
  `selectedZoneId` (`till-app.ts:17758-17763` reads the choice, which a handheld never holds), so it
  opens on the URL's zone (`till-floor-screen.ts:874-879`) or else the first tab
  (`resolveActiveTabKey`, `packages/ui/src/floor.ts:68-74`). With no stored choice the read answers
  the **profile's** start (`device-zone-selection.ts:84-90`) — and provisioning gives every
  order-taking profile the counter zone as its start (`packages/venue-service/src/provisioning.ts:156-181`),
  the demo's Downstairs bar — so following the read's start would change where every handheld
  opens. Today's read cannot tell a saved choice from none: it carries `profileId`, `snapshot`,
  `zones`, `selectedZoneIds`, `startingZoneId` and `adjusted` (`packages/module/src/module.ts:529-542`),
  and whether a row is stored enters only the hashed snapshot (`device-zone-selection.ts:106`). So
  **the read gains `saved: boolean`**, true when a stored choice exists for this device and its
  current profile (`stored !== undefined`, `device-zone-selection.ts:54-62`, returned at `:111`).
  It is per profile, because the stored row is (`schema/device-zone-selection.ts:12`). A save equal
  to the default still answers `saved: true`: the person chose, so their "Opens first" applies; the
  snapshot already changes on that save, since it hashes `stored !== undefined` (`:106`), so the
  till's 15-second re-read notices it (`till-app.ts:9174-9184` compares snapshots). On a handheld
  `deviceZoneNavigation` answers `startingZoneId` = the read's start **only when `saved`**, else
  `null`, and the Floor gets `selectedZoneId` from that (`null` → `undefined`: the URL's zone or the
  first tab, as today). With `saved`, the Floor's `willUpdate` sets the zone from `selectedZoneId`
  (`till-floor-screen.ts:935`), so a saved "Opens first" wins over the URL's zone after a reload, as
  on a till. The till's own expression (`:17758-17763`) and its use of the read are unchanged; the
  till ignores `saved`.
- **D2c. A failed zones read at a handheld's sign-in does not cost the rest of its setup.** On a
  till the read and the offers read share one `try` (`till-app.ts:5000-5040`): a failed zones read
  skips the offers, and that is the till's design — with no choice a till cannot pick its Counter
  zone, so it shows the empty-scope page with Settings and Retry (`:17885-17902`). On a handheld that
  coupling would skip the offers read and with it the service zone, the receipt print mode
  (`:5036`), the transfer accept list (`:5063`) and the basket check (`:5084`), while the next poll
  tick restores only the choice (`:9223-9224`). So on a handheld the zones read gets **its own
  `try`**: a failure leaves no choice held (the Floor unnarrowed, as today), shows
  `device_zones.read_failed` ("The zones could not be read. Try again.") in the existing
  `deviceZonesNotice` line (`:18374`), and the offers read still runs. The notice clears when a later
  read applies a choice. The till's path is the same `try` today but the fix is not the same (the
  till must stop without a choice), so **the till's behaviour is unchanged**.
- **D3. A zone the device does not show blocks working on a table's New order there**, on a
  handheld as on a till: `#deviceZoneAllows` (D1) feeds the order screen's `orderingAllowed`
  (`till-app.ts:17783`, `:17917`), which blocks exactly these (read): picking a dish
  (`store.canSelectProduct`, `till-table-order-screen.ts:1366-1369`, `:2183-2186`) and the menu
  browser (`inert`, `:2188`); dragging a New order line (`#canDragDraft`, `:1580-1591`); changing
  or removing a New order line (`#canEditDraftLine`, `:3550-3561`); Send all and Fire
  (`#submitArrangement` returns, `:3589-3598`; the send bar is disabled, `:3635-3637`). Nothing
  else on that screen reads `orderingAllowed` (ran: `grep -n orderingAllowed apps/till/src/screens/till-table-order-screen.ts`
  → `:1074`, `:1368`, `:1589`, `:2179`, `:2188`, `:3559`, `:3596`, `:3637`), so the Sent box's
  actions are not blocked. Such a table is still reachable (Find a bill, a transfer, a resumed table).
  **Why:** the till's choice already means "the zones this device works in" (it refuses to hide a
  zone with an open order, `#hidesOrderZone`, `:9139-9147`), so the handheld gets the same meaning.
- **D3b. The hide-zone guard keeps the till's rule: it checks the open table (and the counter
  basket) only.** (Coordinator's ruling, 2026-10-24.) A device can hide a zone whose other tables
  hold its saved unsent dishes; ticking the zone again brings them back. Checked: the guard has
  looked only at the counter basket and the open table's draft since it landed with the feature
  (`git blame -L 9139,9147 apps/till/src/till-app.ts` → every line `c90856059`, 2026-10-17, A740's
  #1825), so a till has the same gap (read: nothing else in `#saveDeviceZones` or
  `#reconcileSavedDeviceZones` looks at another table's drafts, `:9202-9290`). Not widened here;
  Task 5 files it in the backlog for both device kinds.
- **D4. `profileServiceZones` on a handheld keeps coming from the offers route**, not from the
  choice: `till-app.ts:5005` and `:9224` set it from the choice only on a till; `:5033` stays. **Why:**
  it is the department-transfer accept list (`till-app.ts:18791`; `apps/till/src/widgets/department-transfers.ts:246-251`,
  `:604`), which this slice does not change. (Observed, not changed: on a handheld that list holds
  only the profile's counter zones, because the route's `zones` are counters only, `till-api.ts:1537-1541`,
  `:1566-1568`; on a till it holds every profile zone. Task 5 files it in the backlog.)
- **D5. No route stops refusing or starts serving; the zones read gains one field (D2b).**
  `GET`/`PUT /api/device/zones` have no form-factor gate
  (`device-api.ts:362-394`, read), and a handheld already saves through them: the case
  "phone-portrait keeps its profile start instead of a stored Till display preference" PUTs a
  handheld's choice and expects 200 (`apps/server/src/till-api.profile-zones.test.ts:1919-1946`;
  ran: `pnpm --filter @waitron/server exec vitest run src/till-api.profile-zones.test.ts -t "keeps its profile" --reporter=verbose`
  → `Tests 4 passed`, both handheld form factors, both cases). A refusal there would have answered
  4xx and failed that `toBe(200)`. **`GET /api/default-service-zone/offers` keeps its handheld
  branch** (context = the profile's start, every profile counter listed). **Why:** on a handheld
  that route's context is not where the Floor opens (D2b); it sets the counter basket's zone, the
  menu poll's extra zone (`till-app.ts:2696-2700`) and the receipt print mode used after a payment
  (`:5036`, `:17500`). Following the choice there would change a handheld's receipt step in a venue
  whose zones print receipts differently — not something the spec asks. The two existing handheld
  cases (`:1899`, `:1919`) keep pinning it unchanged. So no row is added to the route maps atop
  `till-api.profile-actions.test.ts` (its `/api/device/zones` row, `:48`, already says "no selling
  action for display preferences") or `till-api.profile-zones.test.ts` (`:101-102`).
- **D6. ☰ on a handheld gains "Zones on this device" at every width**, after Profile and before
  Equipment, emitting the `open-device-zones` event `TillApp` already handles (`till-app.ts:18339`).
  It is a new `BarItem` `"zones"` that, like Find a bill, is always in ☰ and never on the bar
  (`till-shell.ts:493-506` adds `find-bill` to the moved set the same way). Its help badge is a new
  key `help.more.zones`. In the app ☰ is already on every handheld bar, because Find a bill is
  always offered (`till-app.ts:17670-17678`) and always moved into ☰ (`till-shell.ts:504`); only a
  shell mounted in a test without Find a bill gains a ☰ it did not have (`:1008` draws ☰ when the
  moved set is not empty). The brand's test (`:996`), which shows "Waitron" only when nothing but
  Find a bill is in ☰, must ignore `zones` too, or the brand never shows on a handheld (read, while
  making the probe's edit). **Why:** design §3.1 puts Settings — Zones on this device first — in ☰
  on a handheld at every width ("Everything else is in ☰"), and §3.6's settings table names
  "☰ → Settings". It is its own entry rather than a handheld copy of the till's Settings dialog
  because slice 3 builds §3.1's "Settings:" group in ☰ with Zones on this device and the card
  reader and printer as separate entries; a dialog here would be built only to be taken out.
  Equipment keeps its place and behaviour. **After this slice a handheld's ☰ shows**, at phone
  width: Find a bill, Pass, Kitchen, My schedule, Profile (two or more profiles), **Zones on this
  device**, Equipment, Transfers (when offered), the person's name with clock actions, My hours, Fix
  my hours, Log out and the theme choice, then the language chooser when the bar cannot hold it
  (`#items`, `till-shell.ts:674-733`; `#menu`, `:844-871`; `#operatorActions`, `:769-842`). Above
  phone width the bar keeps what fits as today and Zones on this device stays in ☰.
- **D7. Copy.** The ☰ entry is the dialog's own title, "Zones on this device" / «Zonas en este
  dispositivo» (`device_zones.title`, `apps/till/src/i18n/strings.ts:65`, `:1818`). The dialog's
  explanation already says "this device" (`:66-67`, `:1819-1820`) and needs no change. New help text
  (both in `apps/till/src/i18n/help-strings.ts`): `help.more.zones` = "Chooses which of this
  profile's zones this device shows, and which opens first." / «Elige qué zonas de este perfil
  muestra este dispositivo y cuál se abre primero.» `help.more.settings` keeps "on this till": it
  is the till's Settings and true there. No guide link from the badge: `wt-menu-row` takes only
  `help` and `help-label` (`packages/ui/src/components/wt-menu-row.ts:34-36`), and a guide link
  there is a primitive change outside this slice.
- **D8. A table's unsent dishes in the way of a hidden zone are named in a table's words, true
  where each is shown.** Today one message covers the counter basket and a table's New order:
  "Park, send or cancel this order before hiding its zone." (`device_zones.order_in_zone`,
  `strings.ts:82`), shown in two places: the zones dialog when a save would hide the open order's
  zone (`till-app.ts:9248-9249`) and the status line while a live narrowing waits
  (`:18376-18380`). A table's screen offers no Park (ran: `grep -nE 't\("[a-z_.]*(park|hold)[a-z_]*"\)' apps/till/src/screens/till-table-order-screen.ts`
  → nothing). The string predates this branch (ran: `git blame -L 82,82 apps/till/src/i18n/strings.ts`
  → `d99a9f403`, 2026-10-20). The two places differ for a table:
  - **The dialog's refusal** (the zone is still shown, so the dishes can be sent or removed): new
    key `device_zones.table_order_in_zone` = "Send or remove the unsent dishes before hiding their
    zone." / «Envía o quita los platos sin enviar antes de ocultar su zona.», after
    `bill_pay.unsent`'s wording (`strings.ts:1466`, `:3181`).
  - **The waiting live narrowing** (the pending choice already blocks the table: `#deviceZoneAllows`
    reads the pending choice first, `:9151`, so D3's Send all and line changes are blocked): new key
    `device_zones.table_order_pending` = "Leave this table to hide its zone. Its unsent dishes stay
    saved." / «Sal de esta mesa para ocultar su zona. Sus platos sin enviar quedan guardados.» Why
    it is true (read, pinned by Task 4b case 6): the guard counts the open table's draft only while
    the table is open (`:9143-9145`); leaving takes the draft off the screen (`#releaseDraft`,
    `:10255-10258`), so the guard clears and the narrowing applies; the draft itself is the
    server's saved New order. If Task 4b's case shows otherwise, STOP and report.
  The counter basket keeps its message in both places, so the cases that pin it
  (`till-app-device-zones.test.ts:262`, `:949`) do not change. **This changes a till's copy too**
  (a till at a table sees the new words); the PR lists it as a till behaviour change.

### Changed test checks (from the probes; the implementer confirms each)

The first probe (D1–D4 in the till app, D2 in `device-zones.ts`, honouring the read's start on a
handheld whether saved or not; D2b's `saved` and D2c's separate `try` came from the review
afterwards) ran these 14 files:
`src/state/device-zones.test.ts`, `till-app-allergy`, `till-app-bill-payments`,
`till-app-handheld-pay`, `till-app.nfc`, `till-app.notices`, `till-app-drafts`,
`till-app-kitchen-note`, `till-app-parties`, `till-app-table-service`, `till-app-open-table`,
`till-app-menu-refresh`, `till-app-device-zones`, `till-app-boot-and-counter` (ran: `pnpm exec
vitest run <those files>` in `apps/till` of the probe worktree → `Test Files 1 failed | 13 passed
(14)`, `Tests 2 failed | 2377 passed (2379)`). The two failures were exactly:

- `src/state/device-zones.test.ts` "phone-portrait retains its Floor home and never gains a Counter"
  and "tablet-landscape retains …" — expected `floorZoneIds: ["room"]`, `startingZoneId: "room"`.
  After D2 and D2b, with the case's selection marked `saved: true` (Task 1b's stub change), they
  are `floorZoneIds: ["bar", "room"]` and `startingZoneId: "bar"` — what the probe printed (a saved
  counter-zone start applies on a handheld). Reason: D2, D2b. The name still holds (Floor home,
  never a Counter).

The same probe then ran the other 25 `till-app*` suites and the 13 other files that mount
`TillApp` (ran: `pnpm exec vitest run` on `src/till-app-adjustments`, `-allergy.editor-recovery`,
`-allergy.move`, `-allergy.recovery`, `-counter-adjustments`, `-counter-cancel-credit`,
`-counter-move-station`, `-fingerprint-refusal`, `-floor-layout`, `-menu-timetable`,
`-service-steps`, `-setup-refresh`, `till-app.a11y`, `.attendance.a11y`, `.attendance`,
`.attendance.unsaved`, `.clock.a11y`, `.clock`, `.help-mode`, `.hours`, `.hours.unsaved`,
`.nfc.a11y`, `till-app.test.ts`, `.theme`, `.unsaved-changes`, seven `src/screens/till-table-order-screen.*`
suites, `till-counter-cleanup.look`, `adjustment-dialog.combined(.a11y|.unsaved)`, `guide-sheet`,
`sent-orders.reorder.a11y`, `till-shell.device-zones.look` → `Test Files 38 passed (38)`,
`Tests 1936 passed (1936)`). D2b's `saved`, D2c, D3b and D8 were not probed. With `saved` the
handheld stubs that say `saved: false` (Task 1b) open as today, closer to `main` than the probe
was; D2c and D8 touch paths no existing test drives on a handheld (read). The implementer treats
any new failure as a STOP.

**Probe 2 (D6, the shell).** The probe then added D6 to `till-shell.ts` (with the brand fix; its
help badge borrowed `help.more.settings`, where the build uses the new `help.more.zones`) and ran
every `src/widgets/till-shell*.test.ts`, `src/screens/device-screens.phone-margin.test.ts`,
`src/screens/till-counter-screen.layout.test.ts`, every `src/till-app*.test.ts`,
`src/widgets/guide-sheet.test.ts`, `src/screens/till-counter-cleanup.look.test.ts` and
`src/state/device-zones.test.ts` (ran: `pnpm exec vitest run <those>` → `Test Files 3 failed |
50 passed (53)`, `Tests 31 failed | 4486 passed (4517)`). The 31 are Task 2's two and these 29 in
two shell files, every one a count or list of ☰'s contents that now holds one more entry; none
failed on a layout overflow or a wrong event. Each changes for one reason, **D6: ☰ on a handheld
now always holds Zones on this device beside Find a bill.** A count is not loosened: where a case
counted ☰'s children, it now asserts the **exact list** of what ☰ holds, by each child's item
(`find-bill`, then `zones`, read through a `wt-menu-row` wrapper where there is one), so a third
entry still fails it.

- *☰ "holds only Find a bill" (`:scope > *` length 1; becomes the exact list `find-bill`,
  `zones`)*, in `till-shell.test.ts`: "draws the wide handheld header with Find a bill in More and
  every other button in priority order"; "switches layout as the screen narrows and widens, keeping
  the one language chooser"; under "till-shell above phone width": "moves the transfers, and what
  ranks below Pass and Kitchen, into More before them, then Kitchen first, with full in en-GB", the
  same "with full in es-ES", "with a compact handheld in en-GB" and "in es-ES"; "names the bar's
  transfers button with the short name in en-GB, keeping the dialog's full title" and "in es-ES";
  "labels Log out en-GB's short word, in the name menu and inside More, keeping the counter header's
  full name" and "es-ES's"; "keeps Pass and Kitchen on a compact handheld's Spanish bar at 800 wide
  when its measured width fits there"; "puts every item back on the bar, and the name, once the
  screen is wide enough"; "keeps the visible count as the status while the transfers are on the
  bar"; "waits for an open More to close before giving items back to a wider bar"; "keeps every
  item in an open More when an item earlier in the leaving order appears"; "leaves kiosk mode
  cleanly while a fit begun in kiosk mode is still under way"; "keeps fitting after it is taken off
  the page and put back".
- *☰ absent when nothing has left the bar (a test-mounted shell without Find a bill; now ☰ holds
  exactly `zones`)*: "refits when actions are added, and gives them back when they go".
- *A list or count of controls gains the entry in its place*: "fits the header, every button on
  screen, at phone width in en-GB with phone-portrait", the same "with tablet-landscape", "in es-ES
  with phone-portrait", "in es-ES with tablet-landscape" (11 controls become 12, the twelfth named);
  "puts every action button, the operator's name and the transfer count in one menu, by touch";
  "reaches every action by keyboard" (the tab order gains the entry after Profile); "keeps More in
  the bar's order, showing only the items that left" (`find-bill`, then `zones`); "offers Profile
  before Equipment only when the device can switch profile, emitting open-profile" (the check
  becomes Profile, Zones on this device, Equipment).
- *Help badges*, in `till-shell.menu-help.test.ts` under "till-shell's menu badges": "with help on,
  More shows a badge beside exactly the options that have help: handheld" (its handheld row in the
  table at `:140-150` gains `device_zones.title`); "turning help on from the bar while More is open
  shows the badges at once" (the same list); "on the bar an option with help stays a plain button,
  with no row" (its query found Zones on this device's row in ☰; narrow it to the bar).

The rest — the till's `till-shell` cases, `till-shell.help*`, `.a11y`, `.device-zones`,
`.counter-cleanup`, `.pass`, the phone-margin and counter-layout suites and all 38 `till-app*`
suites — passed with D1–D4 and D6 together.

### Review focus (inputs the spec implies and today's tests may not pin)

1. **A handheld with a stored choice under one profile switches to another profile.** The choice is
   per device and profile (`schema/device-zone-selection.ts:12`), and a switch re-runs the sign-in
   read (`till-app.ts:5001` sits in `#enterSignedIn`, which a switch calls). Expected: the Floor shows
   the new profile's own choice (or all its zones if none is stored), never the old one's. Task 4a
   pins it.
2. **A stored choice naming a zone the profile no longer allows.** The read drops it and marks
   `adjusted` (`device-zone-selection.ts:76-83`); the 15-second live read (D1) brings the change.
   Expected on a handheld: that zone's tab goes from the Floor; if the handheld has a table there
   **open** with unsent dishes, the narrowing waits with D8's pending words and applies once the
   person leaves the table. Task 4b pins it.
3. **Two devices with the same profile choose differently.** Each keeps its own (the key is the
   device, `schema/device-zone-selection.ts:12`). A till and a handheld cannot share a profile: the
   form factor is the profile's column (`deviceProfiles.formFactor`, read at `device-api.ts:691`),
   and the trigger `device_profile_form_factor_locked` refuses changing it while an active device
   uses the profile (`packages/db/src/trigger-refusals.ts:41`, read). So the case is two handhelds,
   as in worked example 6 (Luis's phone and a manager's phone). Task 1 pins it on the server; Task
   4a pins the client side.
4. **A handheld with no saved choice whose profile's start is not its first tab** — every
   provisioned order-taking profile starts on its counter zone (D2b), and a manager may set a table
   zone. Expected: the Floor opens on the URL's zone, else the first tab, never the profile's start;
   after the person saves a choice, its "Opens first" zone applies, a counter zone included.
   `/api/default-service-zone/offers` still answers the profile's start (D5); a table in a chosen
   zone takes dishes and no error shows. Task 1b pins `saved` on the server; Task 4a pins the
   opening zone with values the old and new code treat differently.
5. **The zone choice cannot be read at a handheld's sign-in** (a transient failure). Expected (D2c):
   the Floor shows the profile's zones unnarrowed, `device_zones.read_failed` shows,
   `listDefaultZoneOffers` still runs and the transfer accept list is filled; the next poll tick
   applies the choice and clears the notice. Task 4b pins it.

---

**Task order and why.** The server pin first (Task 1, no product change); the read's `saved`
field (Task 1b, server side, before anything on the till reads it); the navigation function
(Task 2); the ☰ entry (Task 3, shell only); the app in two parts (Task 4a: D1–D4 and D2b; Task 4b:
D2c and D8, the failure and narrowing paths); the docs, guide and backlog (Task 5); the LOOK
(Task 6). Each task leaves the tree green; each is sized well under 100 tool calls.

### Task 1: The server keeps two handhelds' choices apart

**Files:**
- Test: `apps/server/src/device-zones-api.test.ts` (`fixture()` `:39-109` gains a form-factor
  parameter; a new case beside "serves admitted staff…", `:123`)

**Interfaces:** none produced; pins D5 and Review focus 3.

- [ ] **Step 1: Write the case** "two handhelds on one profile keep their own zones": give
  `fixture()` a parameter `formFactor: "till" | "phone-portrait" | "tablet-landscape" = "till"` used
  in its profile insert (`:43`; the form factor cannot be changed after enrolment, Review focus 3),
  and a second session signed in on `other` (`:50`). For `"phone-portrait"`: PUT on `device` a
  choice of one zone (the fixture's venue has more than one; if it has one, add a zone with the
  venue fixtures' helper) → 200 with `selectedZoneIds` that one zone; GET on `other` → every zone,
  `adjusted: false`; `count(f)` 1 and `count(f, f.otherDeviceId)` 0.
- [ ] **Step 2: Run it** `pnpm --filter @waitron/server exec vitest run src/device-zones-api.test.ts`.
  It is expected to **pass at once** (D5: the route has no form-factor gate). That is a pin, not
  TDD; so take the control:
- [ ] **Step 3: Control by deletion.** Temporarily remove `eq(deviceZoneSelections.deviceId, deviceId)`
  from the stored-choice read (`packages/venue-service/src/device-zone-selection.ts:59`) and rerun:
  the new case must fail on `other`'s GET (it then finds `device`'s stored row with none of its own
  zone rows, so it answers one fallback zone with `adjusted: true`, `:79-83`). Restore the line;
  rerun; PASS. Record the failing message in the ledger.
- [ ] **Step 4:** typecheck server; eslint the test; `pnpm format:check`.
- [ ] **Step 5: Ledger and commit** `git commit -s -m "A797-4: pin that a handheld's zone choice is its own"`

### Task 1b: The device-zones read says whether the choice was saved

**Files:**
- Modify: `packages/module/src/module.ts:529-542` (`saved: boolean` on `DeviceZoneSelection`),
  `packages/venue-service/src/device-zone-selection.ts:111` (return `saved: stored !== undefined`)
- Test: `packages/venue-service/src/device-zone-selection.test.ts` (new case; one whole-shape
  check gains the key), `apps/server/src/device-zones-api.test.ts` (one route case)
- Stubs that build the read and must gain the field, because each is typed `DeviceZoneSelection`
  and the till's typecheck refuses it without (ran: `grep -rnE "(: |\): )DeviceZoneSelection( =| \{| =>)" --include='*.ts' apps packages`):
  `apps/till/test/device-zones.ts` (`deviceZonesFixture` `:3-31` and `deviceZonesFor` `:33-65`:
  `saved: false`, as both select every zone like an unsaved read); `apps/till/src/till-app-device-zones.test.ts`
  (`selection()` `:48`: a third parameter `saved = true`, these being chosen subsets);
  `apps/till/src/state/device-zones.test.ts` (`selection` `:5`: `saved: true`);
  `apps/till/src/widgets/device-zones-dialog.test.ts:13`, `device-zones-dialog.unsaved.test.ts:10`,
  `device-zones-dialog.a11y.test.ts:8` (`saved: true`; the dialog does not read it). Two untyped
  stubs gain it too so they stay faithful to the wire (allowed, not required):
  `apps/till/test/native-reload.ts:86-100` (`saved: false`) and `apps/till/src/api/client.test.ts:5664-5672`
  (`saved: true`; its case compares the response with itself, so no check changes).

**Interfaces:**
- Produces: `DeviceZoneSelection.saved: boolean` — true when `device_zone_selections` holds a row
  for this device and its **current** profile. Consumed by Task 2.

Every consumer of the type (ran: `grep -rnE "DeviceZoneSelection\b" --include='*.ts' apps packages`,
less `…Input`): the reader and writer (`device-zone-selection.ts:20-152`), the module port
(`module.ts:1118-1128`), the server routes (`device-api.ts:369`, `:385`, pass-through), the offers
route (`till-api.ts:1532`, reads `zones`, `selectedZoneIds`, `startingZoneId` only), the till client
(`client.ts:3449-3462`), `TillApp` (`till-app.ts:2748`, `:2753`, `:2760` and the zone methods),
`state/device-zones.ts`, `widgets/device-zones-dialog.ts:90`, `:102`. None but Task 2 reads `saved`.

**Tests that pin the read's whole shape** (ran: `grep -nE "toEqual|toStrictEqual"` beside
`startingZoneId`/`selectedZoneIds`/`adjusted` in the server, venue-service and till tests; every
other check of the read is a `toMatchObject` or compares one read with another, so it holds
unchanged): **one** — `packages/venue-service/src/device-zone-selection.test.ts` "defaults to
current profile zones and isolates devices and switched profiles" (`:108-130`, a literal `toEqual`).
It gains `saved: false` with every other value unchanged (owner's standing rule for a whole-shape
pin); list it under "Changed test checks". `apps/till/src/api/client.test.ts`'s "device zones %s
preserves method, body, signal and the response" uses `toEqual` against its own stub, so it
changes only through the stub.

- [ ] **Step 1: Failing tests.** In `device-zone-selection.test.ts`, "says whether this device saved
  a choice under its current profile": a fresh read answers `saved: false`; after `save(f, [f.dining,
  f.terrace], f.dining)` — **the default's own values** (every zone, the profile's start) — the read
  answers `saved: true`, the same `selectedZoneIds` and `startingZoneId` as before, and a different
  `snapshot`; the other device's read still answers `saved: false`; after switching the device to
  `secondProfileId` (as the file's first case does) it answers `saved: false`. The equal-to-default
  save is the control: a `saved` worked out by comparing the choice with the default would answer
  `false` there, and the case would fail. In `device-zones-api.test.ts`, extend "serves admitted
  staff without a selling action…" (`:123`) by one line before the PUT and one after: the GET's
  `json.saved` is `false`, the PUT's `json.saved` is `true` (its body equals the default, `f.input`
  being the current read, `:91-96`).
- [ ] **Step 2: Run; expect FAIL**
  `pnpm --filter @waitron/venue-service exec vitest run --project node src/device-zone-selection.test.ts`
  (`saved` is `undefined`) and `pnpm --filter @waitron/server exec vitest run src/device-zones-api.test.ts`.
- [ ] **Step 3: Implement** the type field and the return value; add `saved: false` to the
  whole-shape case's expected object; add the field to the stubs listed above.
- [ ] **Step 4: Run; expect PASS** — both commands above, then
  `pnpm --filter @waitron/till exec vitest run src/state/device-zones.test.ts src/widgets/device-zones-dialog.test.ts src/widgets/device-zones-dialog.unsaved.test.ts src/widgets/device-zones-dialog.a11y.test.ts src/api/client.test.ts src/till-app-device-zones.test.ts`
  (unchanged behaviour: the till does not read `saved` yet). Typecheck module, venue-service,
  server and till; eslint; `pnpm format:check`.
- [ ] **Step 5: Ledger and commit** `git commit -s -m "A797-4: the device-zones read says whether this device saved its choice"`

### Task 2: `deviceZoneNavigation` keeps every chosen zone on a handheld's Floor

**Files:**
- Modify: `apps/till/src/state/device-zones.ts:13-31`
- Test: `apps/till/src/state/device-zones.test.ts` (`:91-106` changes; one new `it.each`)

**Interfaces:**
- Produces (unchanged signature): `deviceZoneNavigation(formFactor: FormFactor, selection: DeviceZoneSelection): { counterZoneIds: readonly string[]; floorZoneIds: readonly string[]; startingZoneId: string | null; home: "counter" | "floor" | null }`.
  For `phone-portrait`/`tablet-landscape`: `counterZoneIds` `[]`; `floorZoneIds` every chosen zone
  the profile still offers, in `selection.zones` order, any kind (D2); `startingZoneId` the read's
  start **only when `selection.saved` and it is one of those** (any kind), else `null` (D2b: no
  fallback to the first zone, so an unsaved handheld keeps today's URL-or-first-tab opening);
  `home` `"floor"` whenever `floorZoneIds` is not empty, else `null`. `till` and `kds` unchanged.
- Consumes: Task 1b's `saved`.

- [ ] **Step 1: Change the two cases' expectations and add one.** "%s retains its Floor home and
  never gains a Counter" (`selectedZoneIds: ["bar", "room"]`, start `"bar"`, `saved: true` from
  Task 1b) now expects `{ counterZoneIds: [], floorZoneIds: ["bar", "room"], startingZoneId:
  "bar", home: "floor" }` (Changed test checks, D2, D2b). New `it.each` over both handheld form
  factors, "%s shows only the chosen zones, of every kind, and opens only on a saved start":
  `selectedZoneIds: ["shop", "garden", "foreign"]` → `floorZoneIds: ["shop", "garden"]`,
  `counterZoneIds: []`, `home: "floor"`, and `startingZoneId` `"shop"` with `saved: true` and start
  `"shop"` (a counter zone); `null` with `saved: false` and start `"shop"`; `null` with `saved:
  false` and start `"garden"` (a table zone). Before the change the table-only branch and its
  first-zone fallback (`device-zones.ts:17`, `:24-25`, read) answer `floorZoneIds: ["garden"]`,
  `startingZoneId: "garden"` for all three, so each fails.
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/till exec vitest run src/state/device-zones.test.ts`
  — the changed cases print `floorZoneIds` `["room"]` against `["bar","room"]` (the probe printed
  that), and the new one `["garden"]` against `["shop","garden"]`.
- [ ] **Step 3: Implement** the handheld branch per the Interfaces block.
- [ ] **Step 4: Run; expect PASS** (read the `Tests` count: 7 at `c4d7ffa3f` (ran: the probe
  printed `7 tests | 2 failed`) plus 2 new, an `it.each` over the two handheld form factors).
- [ ] **Step 5:** typecheck till; eslint; format check; ledger (the changed case names); commit
  `git commit -s -m "A797-4: a handheld's Floor keeps every zone its choice shows"`

### Task 3: A handheld's ☰ offers Zones on this device

**Files:**
- Modify: `apps/till/src/widgets/till-shell.ts` (`BarItem` `:42-50`, `#moved` `:493-506`, `#items`
  `:674-733`, the brand test `:996`), `apps/till/src/i18n/help-strings.ts` (`help.more.zones`, en
  `:35` area, es `:79` area)
- Test: `apps/till/src/widgets/till-shell.test.ts`, `till-shell.menu-help.test.ts` (Probe 2's 29
  changed checks are all in these two files)

**Interfaces:**
- Produces: on a handheld, a `wt-button.zones` in ☰ (never on the bar) labelled `t("device_zones.title")`,
  dispatching `open-device-zones` (`bubbles: true, composed: true`, no detail), wrapped in
  `wt-menu-row` with `help.more.zones`. Not drawn on a till (the till keeps Settings) nor a kitchen
  display (no bar).

- [ ] **Step 1: Failing tests** in `till-shell.test.ts`: (a) "a handheld's More offers Zones on this
  device at every width, emitting open-device-zones": at 390 px and at a roomy width, More holds a
  `.zones` button reading "Zones on this device" directly before `.equipment` when Equipment is in
  More, and nothing in the bar's `.session` has class `zones`; clicking it fires one
  `open-device-zones`; above phone width with room to spare the brand still shows. (b) "a till
  offers no Zones entry outside Settings": `formFactor: "till"` → no `.zones` anywhere. In
  `till-shell.menu-help.test.ts`, the `it.each` table at `:140-150`: the `"handheld"` row's
  badged keys gain `device_zones.title` between `profile.open` and `equipment.open` (that is the
  case that mounts a handheld; the case at `:305-326` mounts a till).
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/till exec vitest run src/widgets/till-shell.test.ts src/widgets/till-shell.menu-help.test.ts`
  — (a) finds no `.zones`.
- [ ] **Step 3: Implement** D6 and D7's help text: `"zones"` in `BarItem`; `zones: false` in
  `#present`'s table (it never leaves the bar because it is never on it); `moved.add("zones")` in
  `#moved` beside `find-bill`; the button in `#items` directly before Equipment's; the brand test
  at `:996` ignores `zones` as it ignores `find-bill`.
- [ ] **Step 4: Update the 29 checks Probe 2 lists**, each as its group says: a count of ☰'s
  children becomes an assertion of the **exact list** (`find-bill`, then `zones`; add one small
  helper in `till-shell.test.ts` that names ☰'s children by item); a list gains the entry in its
  place; a query is narrowed to the bar. Never loosen a count to a bigger number. Each changes
  because the spec puts Zones on this device in ☰ at every width (D6); list each in the ledger with
  that reason. A failing shell case not in Probe 2's list is a STOP.
- [ ] **Step 5: Run** the suites Probe 2 ran for the shell:
  `pnpm --filter @waitron/till exec vitest run src/widgets/till-shell.test.ts src/widgets/till-shell.menu-help.test.ts src/widgets/till-shell.help.test.ts src/widgets/till-shell.help-phone.test.ts src/widgets/till-shell.help.a11y.test.ts src/widgets/till-shell.a11y.test.ts src/widgets/till-shell.device-zones.test.ts src/widgets/till-shell.device-zones.look.test.ts src/widgets/till-shell.counter-cleanup.test.ts src/widgets/till-shell.pass.test.ts src/screens/device-screens.phone-margin.test.ts src/screens/till-counter-screen.layout.test.ts`;
  PASS with nonzero counts. Typecheck till; eslint; format check.
- [ ] **Step 6: Ledger and commit** `git commit -s -m "A797-4: a handheld's More offers Zones on this device"`

### Task 4a: The till app reads, edits and follows a handheld's zone choice

**Files:**
- Modify: `apps/till/src/till-app.ts` (`:5001-5006`, `:9098-9108`, `:9149-9156`, `:9222-9224`,
  `:17752-17766`; new private `#choosesZones()` beside `#deviceZoneAllows`)
- Test: `apps/till/src/till-app-device-zones.test.ts` (new `describe("a handheld's zones")`)

**Interfaces:**
- Consumes: Task 1b's `saved` (through Task 2); Task 2's `deviceZoneNavigation`; Task 3's
  `open-device-zones` from the ☰ entry.
- Produces: `#choosesZones(): boolean` (D1); a `mountHandheld` helper in the test file that Task 4b
  reuses.

- [ ] **Step 1: Failing tests.** Add `mountHandheld(chosen, formFactor = "phone-portrait", over = {})`,
  calling the file's `mount` (`:127-195`) with `getTill` and `getDeviceIdentity` answering that form
  factor; `selection(ids, start, saved)` from Task 1b builds each answer. Use the file's zones (`bar` prepay, `shop` ticket-then-pay, `room` and `garden` table;
  `:18-47`) and give `floorZones` distinct `displayOrder`s so the first tab is `bar`. Cases (each
  `it.each(["phone-portrait", "tablet-landscape"])` where cheap):
  1. "reads the device's zones at sign-in and narrows Floor to them" — `api.getDeviceZones` called
     once; choice `["room", "garden"]`: the floor's `.zones` ids are exactly `["room", "garden"]`;
     with every zone chosen they equal what `listZones` answered.
  2. "with one zone chosen the Floor shows no zone tabs (worked example 6)" — choice `["garden"]`:
     the floor's `nav.tabs` is absent; with `["room", "garden"]` it is present with two tabs.
  3. "keeps a chosen counter zone on the handheld's Floor and drops an unchosen one" — choice
     `["bar", "room"]`: `bar` is among the floor's `.zones` and `shop` and `garden` are not (today a
     handheld's Floor gets every zone, `:17754-17756`, so the absence is what fails first) (D2).
  4. "the More entry opens the zones dialog and a save narrows the Floor" — real click on ☰ →
     `.zones` (Task 3); `till-device-zones-dialog` opens; saving `["garden"]` calls
     `setDeviceZones` once and the floor's `.zones` become `["garden"]`.
  5. "a profile switch shows the new profile's own zones" (Review focus 1) — `getDeviceZones`
     answers profile A's choice, then after a switch profile B's; the floor follows B.
  6. "an unsaved handheld opens as today; a saved one opens on its Opens first zone" (Review
     focus 4, D2b). Two halves, each with a value the old and new code treat differently:
     (a) every zone chosen, `saved: false`, `startingZoneId: "garden"` — a **table** zone that is
     not the first tab (the first is `bar`): with no URL zone the floor's active tab is `bar`, and
     with `till-zone=room` in the URL it is `room` — never `garden`. The probe's code (start
     honoured whether saved or not) and the earlier plan's counter-only fallback both open on `garden`.
     (b) every zone chosen, `saved: true`, `startingZoneId: "shop"` — a **counter** zone: the floor
     opens on `shop`, with or without a URL zone. `main` opens on `bar` (no `selectedZoneId`), and
     the counter-only fallback ignores `shop`.
  7. "a hidden zone's table takes no new dishes; a shown one does, whatever the profile's start"
     (D3, D5) — `listDefaultZoneOffers` context `bar`, choice `["garden"]`: at a `room` table the
     order screen's `orderingAllowed` is `false` (no pick lands; Send all is disabled); at a
     `garden` table it is `true`; no `[role=alert]` shows.
  8. "the transfer accept list stays the offers route's zones" (D4) — `till-department-transfers`'s
     `.serviceZones` equals the route's `zones`, not the choice's.
  9. "a kitchen display reads no zones" — `formFactor: "kds"`: `getDeviceZones` never called.
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/till exec vitest run src/till-app-device-zones.test.ts`
  — cases 1–4 and 7 fail (no `getDeviceZones` call on a handheld; Floor unnarrowed;
  `#openDeviceZones` returns at `:9099`; ordering allowed everywhere); 5 fails on the floor's zones;
  6(b) fails (no `selectedZoneId` on a handheld today); 6(a), 8 and 9 pass already (6(a) because
  today a handheld never gets `selectedZoneId`) — they pin what must not change, and must still
  pass after Step 3.
- [ ] **Step 3: Implement** D1–D4 and D2b: add `#choosesZones()`; use it at `:5001`, `:9099`,
  `:9150`, `:9156`; set `profileServiceZones` from the choice only when `this.formFactor === "till"`
  (`:5005`, `:9224`); hand the Floor `floorZoneIds`' zones whenever `#deviceNavigation()` is not
  `null` (`:17754`); on a handheld pass `selectedZoneId` as `#deviceNavigation()?.startingZoneId ??
  undefined`, the till's expression (`:17758-17763`) unchanged. Leave `:5008` and `:5033` as they are.
- [ ] **Step 4: Run; expect PASS**, then the app suites Probe 2 ran, named for Vitest's filter (a
  zsh glob such as `src/till-app*.test.ts` from the root answers "no matches found"):
  `pnpm --filter @waitron/till exec vitest run src/till-app src/state/device-zones.test.ts src/widgets/guide-sheet.test.ts src/screens/device-screens.phone-margin.test.ts src/screens/till-counter-cleanup.look.test.ts`
  (`src/till-app` matches every `src/till-app*.test.ts` file by name). Expected: all pass. A
  handheld fixture whose `getDeviceZones` omits a zone its test uses is a fixture fix
  ("Fixture-only" list), not a changed check; anything else is a STOP.
- [ ] **Step 5:** typecheck till; eslint; format check; ledger; commit
  `git commit -s -m "A797-4: a handheld follows its Zones on this device"`

### Task 4b: A failed zones read and a waiting narrowing on a handheld

**Files:**
- Modify: `apps/till/src/till-app.ts` (`:5000-5006` and the `catch` at `:5040-5064` for D2c;
  `#hidesOrderZone` `:9139-9147`, `:9248-9249`, `:18376-18380` for D8;
  `#reconcileSavedDeviceZones` `:9202-9238` to clear D2c's notice),
  `apps/till/src/i18n/strings.ts` (`device_zones.table_order_in_zone`,
  `device_zones.table_order_pending`, English beside `:82`, Spanish beside `:1836`)
- Test: `apps/till/src/till-app-device-zones.test.ts` (in Task 4a's `describe`)

**Interfaces:**
- Consumes: Task 4a's `mountHandheld` and `#choosesZones()`.

- [ ] **Step 1: Failing tests.**
  1. "a failed zones read at sign-in keeps the handheld's other setup" (Review focus 5, D2c) —
     `getDeviceZones` rejects once, then answers `["garden"]`: after sign-in
     `listDefaultZoneOffers` **was called**, the floor's `.zones` are every zone, the status line
     reads "The zones could not be read. Try again.", the transfer accept list is the route's
     `zones` (not `[]`), and no `[role=alert]` error shows; after one poll tick the floor's
     `.zones` are `["garden"]` and the notice is gone. And a till with the same rejection still
     shows the empty-scope page (`[data-device-zones-empty]`, `:17889`) — the till's path is
     unchanged.
  2. "a live narrowing waits while the hidden zone's table is open, then applies when the person
     leaves" (Review focus 2, D8) — a `room` table **open** on the order screen with an unsent
     dish in its New order (the existing case at `:555-626` shows the set-up on a till); the poll
     tick answers `["garden"]`: `[data-device-zones-pending]` reads "Leave this table to hide its
     zone. Its unsent dishes stay saved."; the dish is not lost (the drafts server still holds it);
     tapping Floor applies the choice (the floor's `.zones` are `["garden"]`) and the drafts server
     still holds the dish.
  3. "the zones dialog refuses to hide the open table's zone in a table's words" (D8) — at the same
     open `room` table, the dialog's save of `["garden"]` is refused with "Send or remove the unsent
     dishes before hiding their zone." and `setDeviceZones` is not called.
  4. The counter basket's message is unchanged: run the existing cases at `:250` and `:931` (they
     must pass untouched).
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/till exec vitest run src/till-app-device-zones.test.ts`
  — case 1 fails on `listDefaultZoneOffers` not called; cases 2 and 3 on the old "Park, send or
  cancel…" words.
- [ ] **Step 3: Implement** D2c (on a handheld only, the zones read in its own `try`, its failure
  setting `deviceZonesNotice`, the offers read still running; the notice cleared when
  `#reconcileSavedDeviceZones` applies a choice) and D8 (`#hidesOrderZone` says which order is in
  the way; the dialog's refusal and the pending line each pick the counter or the table key). If
  case 2 shows leaving the table does **not** apply the narrowing, or the dish is not kept, STOP and
  report: D8's pending words would be untrue.
- [ ] **Step 4: Run; expect PASS**, then Task 4a's Step 4 command again.
- [ ] **Step 5:** typecheck till; eslint; format check; `pnpm exec vitest run scripts/english-only.test.ts`;
  ledger; commit `git commit -s -m "A797-4: a failed zones read and a waiting narrowing on a handheld"`

### Task 5: Docs, the user guides and the backlog follow the code

**Files:**
- Modify: `apps/server/src/guide/en/table-service.md`, `apps/server/src/guide/es/table-service.md`
  (a new section in each), `docs/developers/design-system.md:5279-5289`, `:5338-5344`,
  `docs/backlog.md:120-126`, `:2689-2700`, `docs/backlog/till.md:1012-1027` and the A740 decision
  record `:1720-1733`, `docs/superpowers/specs/2026-10-18-a797-device-screens-design.md` (status
  line, §5, §10)
- Test: `apps/server/src/guide-content.test.ts`, `scripts/guide-links.test.ts`

No user guide mentions Zones on this device today (ran: `grep -rniE "zones on this device|zonas en este dispositivo" apps/server/src/guide`
→ nothing), so there is nothing till-only to correct; the till's feature and the handheld's get one
section together.

- [ ] **Step 1: Guides** — add, after "Clear a service step", `## Choose the zones this device shows {#device-zones}`
  (English) and `## Elegir las zonas que muestra este dispositivo {#device-zones}` (Spanish), each
  three to five sentences: where it is (☰ → Settings → Zones on this device on a till; ☰ → Zones on
  this device on a phone or tablet), what it does (shows a subset of the profile's zones and which
  opens first; with one zone shown the Floor has no zone tabs), that it is kept per device and
  profile, that it grants nothing the profile does not allow, and that a table in a hidden zone takes
  no new dishes on this device and cannot send its unsent ones there. No Spanish word outside the
  Spanish file.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and
  `pnpm exec vitest run scripts/guide-links.test.ts`; PASS.
- [ ] **Step 3: design-system.md** — `:5338` "On a till, Settings → Zones on this device…" becomes
  the rule for both: a till's under ☰ → Settings, a handheld's under ☰ → Zones on this device; a
  till's Floor shows only chosen table zones, a handheld's every chosen zone (D2), and a handheld
  opens on its "Opens first" zone only once a choice is saved, and before that as it always has
  (D2b). In the handheld paragraph (`:5285-5289`) add
  "Zones on this device stays in More, like Find a bill."
- [ ] **Step 4: Backlog** — the two A797 entries and `till.md`'s A182 entry: Q51 answered
  2026-10-24 (all recommended; the Ready warning time in each prep station's editor), so nothing
  waits for Q51; slice 4 in review with this plan linked; the build order (slice 4, then 5, then 1–3
  after #2037). Add a dated line to the A740 decision record (`till.md:1720`): a handheld has the
  same choice in ☰ → Zones on this device; it narrows its Floor (every kind of zone it shows) and
  work on a hidden zone's tables (D3); it opens on its "Opens first" zone once a choice is saved
  (D2b, the read's `saved`); its new-order start stays the profile's (D5). Add two short entries in
  the till area, each worded
  as read, not as a bug confirmed by a run: (a) **hiding a zone does not check its other tables'
  unsent dishes, on a till or a handheld** (D3b: the guard checks the counter basket and the open
  table only, since A740's #1825; ticking the zone again brings them back); (b) **a handheld's
  transfer accept list holds only counter zones** (D4).
- [ ] **Step 5: Design** — status line: "Q51 answered 2026-10-24: all recommended; (c)'s Ready
  warning time in each prep station's editor; build plan `docs/superpowers/plans/2026-10-24-a797-device-screens-build.md`".
  Under §10 add the answer in one paragraph. Under §5's last bullet add one dated sentence: "The plan
  (D5) keeps `/api/default-service-zone/offers` unchanged on a handheld." Under worked example 6
  add one dated sentence: in the demo, Luis's Floor has no zone tabs only once he also unticks the
  Upstairs bar, a counter zone his profile allows (Task 6).
- [ ] **Step 6: Check** `pnpm exec prettier --file-info docs/backlog.md` prints `"ignored": true`
  (docs are not formatted; wrap by hand). `pnpm format:check` for the guide files.
- [ ] **Step 7: Commit** `git commit -s -m "docs: A797-4 — guides, design system and backlog for Zones on this device on a handheld"`

### Task 6 (visual): LOOK at a handheld's zones

- [ ] **Step 1: Start the stack** from the worktree: `wa-wt demo waitron-feat-a797-4-handheld-zones`;
  `wa-wt ls` gives the till and dashboard URLs. The demo's Restaurant department has four zones:
  Dining room and Terrace, and two counter zones, Downstairs bar (tables B1–B3) and Upstairs bar
  (`apps/server/scripts/demo-seed/floor.ts:61-63`, `:184-186`; `seed-floor.ts:88-122`). A profile
  with no zones of its own named gets every zone of its department (`packages/venue-service/src/profile-access.ts:100-111`,
  read), and provisioning starts it on the counter zone, here Downstairs bar (D2b).
- [ ] **Step 2: Make two handhelds.** Enrol two browser contexts as devices on the Handheld profile
  («Móvil», `packages/layouts/src/device-profile.ts:148-150`) from the dashboard's Devices page (a
  dev box approves a join at once, but the till still asks which device a tab is). Check in the
  dashboard which zones that profile allows and write them in the ledger before going on.
- [ ] **Step 3: Look** with the workspace's Playwright Chromium (a short script kept in
  `/Users/clintongormley/waitron-campaign-c/a797-4-scripts/`, never in the worktree), signed in, at
  **390 px** (phone) and **1024 px** (tablet), in **light and dark**, English and Spanish:
  - before any save, the Floor opens on its first tab (or the URL's zone), **not** on Downstairs
    bar (D2b);
  - ☰ → Zones on this device → the dialog: its four columns at 390 px (does anything overflow or
    wrap badly?), and the Kind column says "Counter" for Downstairs bar and Upstairs bar, zones the
    handheld's Floor shows (D2) — note whether that reads oddly; it is an owner FYI, not a defect;
  - untick Dining room, Downstairs bar **and Upstairs bar** → Save → the Floor shows Terrace with
    **no zone tabs**; untick only Dining room and Downstairs bar → **two** tabs, Terrace and
    Upstairs bar;
  - set Terrace as Opens first, sign out and in → the Floor opens on Terrace; then set Upstairs
    bar (a counter zone) as Opens first → it opens there (D2b).
- [ ] **Step 4: Compare** — on the second handheld (same profile, no choice saved) all four zone
  tabs still show (worked example 6's manager's phone).
- [ ] **Step 5: Save** every screenshot as a PNG under `/Users/clintongormley/waitron-campaign-c/a797-4-shots/`
  (`<step>-<width>-<theme>-<lang>.png`), open each and describe what was seen in the ledger and the
  PR body. Expected: the ☰ entry reads in full at 390 px; the dialog fits 390 px without sideways
  scrolling; no zone tabs with one zone.
- [ ] **Step 6: Stop** what you started: the Playwright script's process by its recorded id, then
  `wa-wt down waitron-feat-a797-4-handheld-zones`.

### Closing slice 4

- Focused runs per task as above; CI runs the package suites and coverage. Read the `changes` job's
  outputs and the till's and server's coverage jobs on the current head before calling the PR green.
- `/finish-branch` with this plan named. Review path **FULL**: two Codex run-it reviews (the second
  told to set this plan's checklist aside and test what it does not name).
- PR body sections: **Build order** (slice 4 before slice 1 because #2037 holds the core-migration
  slot; slice 5 next); **Changed test checks** (one line per test, from the ledger: Task 1b's
  whole-shape case "defaults to current profile zones and isolates devices and switched profiles",
  Task 2's two `device-zones.test.ts` cases, Task 3's 29 ☰ checks, grouped as in Probe 2); **Fixture-only** (if
  any), naming the stubs Task 1b gave `saved`; **Contract change**: the device-zones read gains
  `saved` (type, reader, routes, till client; no migration); **Decisions** D1–D8 (with D2b, D2c,
  D3b) in one line each; **Till behaviour changes**: D8's new words at a till's table (the dialog's
  refusal and the waiting narrowing); **No route stops refusing or starts serving**, with D5's
  receipt; **LOOK** (what the screenshots showed). First line: no venue reset.
- **Owner FYI** (one line in the PR and the lane's questions file, not a question): worked example
  6 says Luis's Floor shows no zone tabs once he unticks Inside and Bar; with the demo's data his
  profile also allows the Upstairs bar, a counter zone, so he must untick it too (D2 keeps counter
  zones on a handheld's Floor); and the dialog labels such a zone "Counter" though the handheld shows
  it on its Floor.
- After merge: delete the branch local and remote and check the remote one is gone; update the
  ledger; then slice 5.

## Slice 5 — The Ready bar and remembered List/Map (one PR, branch `feat/a797-5-ready-bar`)

**What it changes.** On a handheld's Floor, a bar fixed at the bottom of the screen lists the tables
with food ready: "Ready · T5 · 2 · T9 · 1 · Open ›" («Listo · T5 · 2 · T9 · 1 · Abrir ›», design
§3.1, §10 (g)). Tapping a table opens it; Open › opens the first table listed (D4). The bar shows
only while something is ready, and on a handheld it takes the place of today's per-station summary
above the tables. A till keeps the summary, retitled "Ready" «Listo» (Q51 (f) 8). And List or Map
is remembered on the device for each zone, instead of one choice for the whole session.

**Review path: LIGHT.** No server read, route, schema or shared type changes: the bar reads the
floor read's `ready` signal the till already has (`TableSignal` `ready`, `packages/shared/src/table-signals.ts:13`,
read), and the remembered view is kept in the device's browser. None of the risk triggers applies
(read: the changed files are all under `apps/till/src/` and the guides). **Migration: none.**

How claims are marked in this section: **(ran)** means run on 2026-10-25 against `main` at
`46bd9213d` (this worktree's base); **(read)** means read in the code at that commit. The probe was
a throwaway worktree (`git worktree add --detach /tmp/a797-5-probe.TwzF/wt 46bd9213d`), removed
afterwards; none of it is in this branch.

### Build order now

#2037 has landed (ran: `gh pr view 2037 --json state,mergedAt` → `MERGED 2026-10-24T09:57:19Z`;
`git merge-base --is-ancestor 6037aa68a HEAD` → on `main`), and so has slice 4 (#2041, merged
2026-10-24T11:09:11Z, ran). So slices 1–3 are no longer barred by a parked migration branch. The
lane builds slice 5 now because it is LIGHT and already started; slice 1 follows.

### Every reader and writer this slice touches (ran: grep; each line read)

| Where | What it does today |
| --- | --- |
| `apps/till/src/screens/till-floor-screen.ts:2909-2918` `#stationSummary` | the per-station "Ready to serve" list, every table of `this.tables` whatever the zone (comment `:2908`); drawn above the tables at `:2392` |
| same file `:2920-2948` `#stationRow` | "Bar: Mesa 2 ×3, Mesa 8 ×1" and, where `canOpenStation`, an "Open Bar" button emitting `show-station` |
| `apps/till/src/state/table-signals.ts:33-48` `readyByStation` | groups the `ready` signals per station, a party at several tables counted once, in the floor read's order; its only caller is `#stationSummary` (ran: `grep -rn "readyByStation" apps/till/src packages --include='*.ts'`) |
| `till-floor-screen.ts:831` `viewOverride` | one `"map" \| "list" \| undefined` for the whole screen: a tap pins it for every zone until the page reloads |
| same file `:1249-1251` `#toggleView`; `:2235` (a `#zoneOnScreen` input); `:2261` | the tap; `view = viewOverride ?? (a table on the map ? "map" : "list")` |
| same file `:2341-2352`, `:2108-2117` | the toolbar's List/Map button above phone width; at phone width the zone menu's item (`till-floor-zone-menu`'s `zone-toggle-view`) |
| same file `:994-1004` `#watchFloor` | re-reads the floor every 15 s **only while the map shows** (since #1517, ran: `git log -L994,1003:…`) |
| same file `:1034-1059` `#openTable` | a seated table emits `open-table` `{ tableId, seated: true }` |
| same file `:909` `#phone` (`PHONE_WIDTH`, `(max-width: 40rem)`, `apps/till/src/widgets/language-chooser-styles.ts:4`) | moves List/Map into the zone menu at phone width |
| `apps/till/src/till-app.ts:18205-18227` | the one `<till-floor-screen>` mount, on a till and on a handheld (ran: `grep -n "<till-floor-screen" apps/till/src/*.ts`). It hands `.zones` the zones the device's choice keeps (slice 4) and `.tables` every table of the read, unfiltered; it passes no form factor and no device id |
| `till-app.ts:2444`, `:4206-4209` `handheldMode` | true for `phone-portrait` and `tablet-landscape` (`kindOfFormFactor`, `apps/till/src/layout.ts:25-38`), set at start-up only; a profile switch updates `formFactor` but not it (Task 6) |
| `till-app.ts:5869-5890` `#menuMemory`, `#zoneMenuIdentity` | the sibling per-zone memory: `localStorage` behind a `try`, identity `{ origin: this.router?.current ?? location.origin, deviceId, profileId, zoneId }` |
| `apps/till/src/state/zone-menu-memory.ts:10-89` `ZoneMenuMemory` | the key `waitron.zoneMenu.${JSON.stringify([origin, deviceId, profileId, zoneId])}` (`:52`); an in-memory copy so a refused store still remembers for this app instance; a bad stored value is removed |
| `apps/till/src/widgets/till-shell.ts:386-390`, `:1102-1107` `main.body` | the scrolling area every tab's body is drawn in (`overflow: auto`); made `inert` while an overlay is open |
| same file `:395-400`, `:1105-1107` `.drill` | the overlay (Find a bill, Pass, Kitchen, My schedule, My hours, a till's table screen; `#pushDrill` kinds, `till-app.ts:4495`, `:8059`, `:8367`, `:8399`, `:10332`, `:5517`): `position: absolute; inset: 0` over the region, a later sibling of `main`, drawn over a Floor that stays on the page |
| `till-app.ts:5513-5519`, `:18113-18117`, `:18339-18342` | on a handheld a table opens on the **Order tab**, and only the active tab is drawn, so the Floor leaves the page (its timers stop, `till-floor-screen.ts:922-928`); on a till it opens as the overlay above |
| `till-app.ts:1680-1683`, `till-shell.ts:144`, `apps/till/index.html:13-31` | the app's root is `height: 100%` of a page padded 24 px (8 px at phone width); the shell inside it is `100dvh` tall |
| `till-app.ts:1752-1758` `.submitted-toast` | the Sent and Served toasts, fixed at `bottom: calc(var(--wt-tap-min) + 2 * var(--wt-space-3) + env(safe-area-inset-bottom))`, shown on the Floor after a send (`:11727-11729`) |
| `apps/till/src/i18n/strings.ts:1018`, `:2751` | `floor.ready_title` "Ready to serve" / «Listo para servir» |

Other per-device keys in the till, for the naming pattern (ran: `grep -rn "localStorage\|sessionStorage" apps/till/src --include='*.ts' | grep -v test`):
`waitron.makeNow.${deviceId}` (`till-app.ts:2463`), `waitron.stationScreenView.${deviceId}`
(`till-station-screen.ts:60`), `waitron.lastOperator.${deviceId}` (`till-lock-screen.ts:23`),
and `waitron.zoneMenu.…` above. The till has no venue id of its own: `TillInfo` carries
`venueName` and `nodeId`, no venue or location id (read, `apps/till/src/api/client.ts:157-208`),
which is why the sibling names the venue by the server's origin.

### Plan decisions for slice 5

- **D1. The bar lists only tables in the zones the Floor shows** (`this.zones`), so on a handheld it
  follows the device's zone choice. After slice 4 a handheld's Floor is handed exactly its chosen
  zones, every kind (slice 4 D2; `till-app.ts:18207-18211`), and with no saved choice every zone its
  profile allows. A party is listed when at least one of its tables is in a shown zone, named by
  those tables only. A table with no zone is on no tab and is left out. **Why:** the choice means
  "the zones this device works in" (slice 4 D3); worked example 6's Luis, who unticked Inside and
  Bar, would otherwise be shown Inside's food and sent by Open › to a table his device hides, where
  he can add nothing. **The till's summary keeps every zone** (its comment, `:2908`, and the case
  "covers tables in every zone, not only the zone on screen" stay as they are): it is a per-station
  view with Open {station} buttons, not a way into tables, and a till's Floor drops its counter
  zones (`till-app.ts:18210` with `floorZoneIds`, slice 4 D2), whose seated tables would otherwise
  leave it. **Alternative, for the owner:** the bar lists every zone's tables, as the summary does.
- **D2. Zero ready tables: no bar at all**, and nothing reserved for it. Design §3.1: "It shows only
  while something is ready." The summary already draws nothing then (`:2911`, pinned by "is not
  shown while nothing is ready").
- **D3. The bar is drawn on a handheld at every width, in place of the summary; a till keeps the
  summary at every width.** The floor gains `@property({ type: Boolean }) handheld = false`, which
  `TillApp` sets from its current form factor (Task 6). **This is a reading of the spec, not its
  letter.** §3.1 says the bar "replaces at phone width today's summary" and "Above phone width the
  summary stays where it is"; §3.2 says of a handheld on a tablet, whose screen is wider than 40rem,
  "The bar's table buttons, the Ready bar and its warning are as on a phone"; §6 retires "the Ready
  summary above the floor at phone width". Taken literally, a tablet handheld keeps the summary
  **and** gets the bar. The plan reads §3.1 as the phone's own section and §3.2 as "a tablet is
  drawn as a phone", so the split is handheld against till: one place for ready food on any one
  screen, the same on a phone and a tablet. A till at phone width is not a case the design draws.
  **Alternative, for the owner (the literal reading):** a tablet handheld shows both, the bar at
  the foot and the summary above the tables; a phone shows the bar only. Either way the 414 px test
  frame (`apps/till/src/widgets/test-helpers.ts:108`, inside `PHONE_WIDTH`) is a test matter, not a
  reason: a width rule would move the seven summary cases to a wider frame (the probe, below). On a
  handheld the summary's Open {station} buttons go with it; Kitchen stays in ☰ where the profile
  allows it (`till-app.ts:18224` `#allowsDestination("station")`, slice 4 D6's list).
- **D4. "Open ›" opens the first table the bar lists, in the floor read's order, until slice 7.**
  Design §3.1 says it "opens the table whose food has waited longest", but the till does not know
  when a dish became ready: the `ready` signal carries only `stationId`, `stationName` and `count`
  (`ReadyAtStation`, `packages/shared/src/table-signals.ts:38-42`, read); slice 6 adds each
  station's oldest ready time, and slice 7 orders the bar by it ("names the table waiting longest
  first"), after which Open › opens that first table without further change. The bar's order is the
  order `readyByStation` already keeps (the first table of each party as the read lists them). A
  table tapped, or Open ›, goes through `#openTable` (`:1034`), so it opens exactly as a tap on that
  table's card does; for a party at several tables, its first table in a shown zone. Open ›'s
  accessible name names the table ("Open T5" «Abrir T5»).
- **D5. What the bar says.** Each entry is the party's tables as the Floor shows them
  (`shownUnder`, `apps/till/src/state/floor-today.ts:70-72`: today's join name, else today's name,
  else the label), distinct, joined with "+", then " · " and the party's ready count summed over its
  stations. It does not use the party's `displayName`, which is the name staff gave the party when
  there is one (`client.ts:2062-2063`, read): the bar is a tight place, which design §3.7 gives the
  table's name. Until slice 1 lands these are the full names ("Mesa 2"); slice 1 swaps in the short
  name. The ready icon is the floor's own `floor-ready` icon (`packages/ui/src/floor-chips.ts:12`),
  the 🍽 of the picture. The word is `floor.ready_title`, now "Ready" «Listo» in both places (one
  key: Q51 (f) 8 retitles the summary so the word is the bar's). New keys, en / es:
  `floor.ready_bar_table` "{table} · {n}" / same; `floor.ready_bar_open` "Open ›" / «Abrir ›»;
  `floor.ready_bar_open_label` "Open {table}" / «Abrir {table}». **An entry has no label of its
  own:** its name is its visible text ("Mesa 2 · 3"), read inside the section named "Ready", so the
  name always contains what is shown (WCAG 2.5.3, label in name) and no count needs a plural form
  («Mesa 2 · 1», never «1 listos»). Open ›'s name starts with its visible word ("Open Mesa 2"; the
  › is a mark, not a word). Help (`help-strings.ts`, both
  languages): `help.floor.ready_bar` "Tables with food ready to take out. Tap one to open it; Open
  opens the first." / «Mesas con comida lista para llevar. Toca una para abrirla; Abrir abre la
  primera.» (slice 7 rewords "the first" when it reorders). No live region: the bar changes on every
  15-second read, and announcing each would talk over the waiter.
- **D6. Where the bar sits: at the foot of the shell's scrolling area, and never over an
  overlay.** `position: sticky; bottom: 0` as the last child of the floor's `.screen`, as the menu's
  weigh bar does (`apps/till/src/widgets/menu-browser.ts:351-356`), with the floor's `:host` and
  `.screen` at least the height of the scrolling area (`min-height: 100%`, a column with the bar
  pushed down by `margin-block-start: auto`) so that on a short list the bar still sits at the
  foot. And the floor's `:host` gets **`isolation: isolate`**, so nothing inside the Floor, the bar
  included, can paint over the overlay that ☰'s Find a bill, Pass, Kitchen, My schedule or My hours
  lays over a Floor that stays on the page (`till-shell.ts:395-400`, `:1105-1107`; the floor
  already raises elements with `z-index: 1`, `till-floor-screen.ts:468-470`, `:577-579`).
  **Receipts (ran, 2026-10-25):** a static copy of the page, shell, scrolling area, overlay and
  Floor (`apps/till/index.html:13-31`, `till-shell.ts:141-147`, `:378-400`, `:1102-1107`;
  `/Users/clintongormley/waitron-campaign-c/a797-5-scripts/sticky-probe.mjs`), in Playwright
  Chromium at 390 × 844 and 1024 × 844, reading the **painted colour** at the bar's centre with the
  overlay open (bar `#99cc99`, overlay `#ffffff`): window-pinned or sticky, a bar raised with
  `z-index` and no isolation painted **over** the overlay (`#99cc99`, both widths: the reviewer's
  finding reproduced); with `isolation: isolate` on the Floor both were covered (`#ffffff`). So
  sticky alone does not fix it; the isolation does. With 20 rows of cards the sticky bar left the
  last card clear when scrolled to the end, and a window-pinned one covered it. **A hit test cannot
  measure this**: `main` is `inert` while an overlay is open, and `elementFromPoint` skips inert
  elements, so it answered the overlay in every run, the failing one included; tests read the
  painted colour or `getComputedStyle`, never `elementFromPoint` alone. **To check in the real
  app (Task 6, Task 8):** in the static copy the scrolling area's bottom was 8 px below an 844 px
  window at 390 and 24 px below at 1024, because the `100dvh` shell sits inside the padded page
  (rows above); if the real app shows the bar's foot below the window, STOP and report: that is
  the shell's height, outside this slice. **Look (picture 01):** the bar is inset to the floor's
  own content edges, not full width, with rounded corners (`--wt-radius-*`), and its entries are
  small rounded labels (still buttons); one line, "Ready" at the start and Open › at the end
  staying put while the entries between scroll sideways when they do not fit. No taller than
  `var(--wt-tap-min) + 2 * var(--wt-space-3)` (`till-app.ts:1756`), so the Sent and Served toasts
  shown on the Floor after a send (`:11727-11729`) sit above it. `--wt-*` tokens only (CLAUDE.md
  §3); the calm bar takes the floor's ready chip's colours. The on-screen keyboard can cover the
  bar only while a field has focus, and the Floor's fields are all in its dialogs (ran: `grep -n
  "<wt-input\|<input\|<wt-textarea" apps/till/src/screens/till-floor-screen.ts` → nothing; its
  dialogs `:1456`–`:2661`), so that is accepted.
- **D7. A handheld's Floor re-reads every 15 s in list view too.** Today it re-reads only while the
  map shows (`#watchFloor`, `:994-1004`), and nothing else in `TillApp` re-reads the tables on a
  timer (read: `grep -n setInterval apps/till/src/till-app.ts` finds only the pending-payment re-read
  at `:17219`). A zone with no placed tables opens in list view (`:2261`), so without this the bar on
  such a zone would show what was ready when the person last opened the Floor. The rule becomes:
  re-read while the map shows **or the floor is a handheld's**. A till keeps today's rule, so the
  pinned case "does not ask while the list shows" (`till-floor-screen.refresh.test.ts:159`, which
  mounts no `handheld`) is unchanged. Cost: one `GET /api/tables/state` per handheld per 15 s,
  which a handheld on a map zone already makes, and it goes on while one of ☰'s overlays covers
  the Floor, as the map's re-read does today. It stops while a table is open: on a handheld that is
  the Order tab, which takes the Floor off the page (rows above). **Alternative, for the owner:** keep list view
  unpolled and accept a stale bar there.
- **D8. List/Map is remembered per zone, on this device, in the browser.** A new module
  `apps/till/src/state/floor-view-memory.ts`, after `ZoneMenuMemory`'s shape:
  - **Key** `waitron.floorView.${JSON.stringify([origin, deviceId, zoneId])}`, value `"map"` or
    `"list"`. `origin` is the sibling's (`this.router?.current ?? location.origin`,
    `till-app.ts:5885`), standing for the venue, since the till holds no venue id (above); a JSON
    array keeps an id containing a dot from running into the next part (the sibling's reason). **No
    profile in the key**, unlike the menu memory: which menu a zone opens on depends on the profile,
    while how a zone's tables are drawn does not.
  - **Default:** no stored value → today's rule, Map when the zone has a table on the map, else
    List (`:2261`). The value tapped is stored whether or not it equals that default, and from then
    on wins for that zone on this device, including a stored Map for a zone whose plan later empties
    (a tap on such a zone already draws an empty map: "polls an empty map with no today's rows after
    the view is chosen", `till-floor-screen.refresh.test.ts:142`).
  - **Per zone, also within the session:** `viewOverride` becomes a `ReadonlyMap<string | undefined,
    FloorView>` of this screen's taps, keyed by the zone on screen (`#zone.activeKey`), so a tap on
    Terrace no longer changes Inside. A floor with no zone on screen (the zone-menu suite's "a floor
    with no zones") has `activeKey` `undefined` and keeps its tap in that map under `undefined`, for
    the session only; only a defined key reaches the device's memory.
  - **A stored value for a zone that no longer exists** is never read (only zones on screen are
    looked up) and is not pruned: pruning would need every zone of the venue, and the device sees
    only its profile's, narrowed by its choice, so it would wipe the choice for a zone that is merely
    hidden. Zone ids are not reused (`floorZones.id` defaults to `newId`,
    `packages/db/src/schema/floor-zones.ts:16`, read).
  - **Storage that throws** (a private window, blocked site data; the till already guards this at
    `till-app.ts:5871-5876` and `till-station-screen.ts:316`): reads and writes are wrapped; the
    module keeps its own in-memory copy, so the choice still lasts for this app instance. A stored
    value that is not exactly `"map"` or `"list"` is ignored and removed, as the sibling does.
  - **Wiring:** the floor gains `viewMemory?: FloorViewChoices` (`read(zoneId)`, `remember(zoneId,
    view)`); `TillApp` builds one per `(origin, deviceId)` and hands it over, cached so a redraw does
    not hand the floor a new object (which would re-run `#zoneOnScreen`); with no `deviceId` it hands
    `undefined` and the floor remembers per zone for the session only. A floor mounted on its own in
    a test gets no memory, so no floor suite starts writing to the test browser's `localStorage`.

### Changed test checks (from the probe; the implementer confirms each)

The probe (ran, in `/tmp/a797-5-probe.TwzF/wt`): `viewOverride` made per zone as D8 says (no
storage), a `handheld` property, and a crude bar drawn **in place of the summary when
`handheld || PHONE_WIDTH`** (the width rule D3 rejects), with `TillApp` passing `.handheld`. Then
`pnpm exec vitest run src/screens/till-floor-screen src/screens/text-size.layout src/screens/device-screens src/widgets/till-shell.device-zones`
in `apps/till` → `Test Files 2 failed | 28 passed (30)`, `Tests 7 failed | 747 passed (754)`. The
seven were the summary's own cases at the 414 px default frame: in `till-floor-screen.signals.test.ts`
"lists each station's tables with their counts, a party at joined tables once", "covers tables in
every zone, not only the zone on screen", "opens the station's own view from its row where the
device has one", "offers no way into a station on a device without the station view" and "says it
in Spanish"; in `till-floor-screen.a11y.test.ts` "has no violations with signals side by side and
the stations' summary, on the list" (light and dark). Under D3 (the form factor) none of those mounts
sets `handheld`, so they keep the summary; **only one check changes**:

- `till-floor-screen.signals.test.ts` "says it in Spanish" (`:331-342`): the heading «Listo para
  servir» becomes «Listo». Reason: Q51 (f) 8. No case pins the English title (ran: `grep -rn "Ready
  to serve" apps packages` → `strings.ts:1018` only).

Then `pnpm exec vitest run src/till-app src/screens/till-counter-cleanup.look src/widgets/guide-sheet`
→ `Test Files 43 passed (43)`, `Tests 4361 passed (4361)`: the per-zone view and `.handheld`
broke no app suite. No `till-app*` suite or `apps/till/test/` fixture carries a `ready` signal
(ran: `grep -rln 'kind: "ready"\|ready(\[' apps/till/src apps/till/test --include='*.ts'` → 15
files besides `till-app.ts`: three source files and 12 tests, four of them floor-screen suites;
none is a `till-app*` suite or under `apps/till/test/`).
D7 (polling) and D8's storage were not probed; Task 5's and Task 3's commands name the suites to
run. The one class of failure the plan expects beyond the line above is Task 6 Step 4's: an app
suite counting table reads on a list-view handheld sees D7's extra read. Any other failure is a STOP.

### Review focus (inputs the spec implies and today's tests may not pin)

1. **A party at two tables in different zones, one hidden.** Listed once, named by the shown table
   only, and Open › opens the shown table (D1, D4). Task 1 pins it.
2. **A joined table today.** Both tables carry the party's signals (`readyByStation`'s comment,
   `table-signals.ts:29-32`) and one `joinName`, so the bar shows one entry with the join's name,
   not two (D5). Task 1 pins it.
3. **Two devices in one browser profile, or one device id at two venues.** The key names the origin
   and the device, so neither sees the other's choice (D8). Task 2 pins it with two identities that
   differ in one part each.
4. **Storage whose getter throws, whose `setItem` throws, or which holds "grid".** The floor still
   toggles and keeps the choice for the session; "grid" falls back to the default and is removed
   (D8). Task 2 pins all three.
5. **The Sent toast after a send, on a handheld with food ready.** It shows above the bar, not over
   it (D6). Task 7 looks.
6. **A handheld on a list-view zone when food becomes ready, and when the last of it is served.**
   The bar appears within 15 s, and goes, with its space, once a re-read has nothing ready (D7,
   D2). Task 5 pins both with fake timers.
7. **One of ☰'s overlays over a Floor with food ready** (Find a bill, Pass, Kitchen). The overlay
   is drawn over the bar, never the bar over the overlay (D6). Tasks 4b and 6 pin it by painted
   colour; Task 8 looks.
8. **A profile switch between a till profile and a handheld one on the same device.** The bar
   follows the current profile's form factor (Task 6).

---

**Task order and why.** The two pure pieces first, each with its own tests (Task 1, which tables the
bar lists and what it calls them; Task 2, the remembered view's store); the floor's per-zone view on
top of Task 2 (Task 3); the bar on top of Task 1, then its accessibility and layout (Tasks 4a, 4b);
the list-view re-read (Task 5); `TillApp`'s wiring (Task 6); the docs (Task 7); the LOOK (Task 8).
Each leaves the tree green and is sized well under 100 tool calls.

### Task 1: Which tables the Ready bar lists, and what it calls them

**Files:**
- Modify: `apps/till/src/state/table-signals.ts` (new `readyTables` beside `readyByStation` `:33`)
- Test: create `apps/till/src/state/table-signals.test.ts` (none exists; ran: `ls apps/till/src/state | grep signal`)

**Interfaces:**
- Produces: `export interface ReadyTable { partyId: string; tableId: string; name: string; count: number }`
  and `export function readyTables(tables: readonly TableState[], zoneIds: ReadonlySet<string>): ReadyTable[]`
  — one entry per party with a `ready` signal and at least one table whose `zoneId` is in
  `zoneIds`; `tableId` its first such table in `tables` order; `name` the distinct `shownUnder` of
  its such tables, in `tables` order, joined with "+"; `count` the sum of `byStation[].count`;
  entries in the order each party's first such table appears. Consumed by Task 4a.

- [ ] **Step 1: Failing tests** (build `TableState`s as `till-floor-screen.signals.test.ts:13-79`
  does; copy its `party`, `table` and `ready` helpers):
  1. "lists each party with food ready once, its count summed over its stations" — Mesa 2 (bar 3),
     Mesa 8 (bar 1, kitchen 2), a free table → `[{ name: "Mesa 2", count: 3 }, { name: "Mesa 8",
     count: 3 }]` (with ids).
  2. "names a party at joined tables by today's join name, once" — two tables of one party, both
     `today.joinName: "Mesa 5+6"` and the party's `ready` → one entry `"Mesa 5+6"`, `tableId` the
     first (Review focus 2).
  3. "names a party at two separate tables by both, and by the shown one only when a zone is hidden"
     — party at `t5` (zone `z1`) and `t6` (`z2`), no join: with both zones → `"Mesa 5+Mesa 6"`,
     `tableId: "t5"`; with only `z2` → `"Mesa 6"`, `tableId: "t6"` (Review focus 1).
  4. "leaves out a party whose tables are all in hidden zones, and a table with no zone".
  5. "uses today's name, not the party's given name" — a party with `name: "Ana"`, `displayName:
     "Ana"`, at a table with `today.name: "Ventana"` → `"Ventana"` (D5).
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/till exec vitest run src/state/table-signals.test.ts`
  (`readyTables` is not exported).
- [ ] **Step 3: Implement** per the Interfaces block, reusing `signalOf` and importing `shownUnder`
  from `./floor-today.js`.
- [ ] **Step 4: Run; expect PASS** — read the `Tests` count (5, or more if a case is an `it.each`).
- [ ] **Step 5:** `pnpm --filter @waitron/till typecheck`; `pnpm exec eslint apps/till/src/state/table-signals.ts apps/till/src/state/table-signals.test.ts`;
  `pnpm format:check`; ledger; `git commit -s -m "A797-5: which tables the Ready bar lists, and what it calls them"`

### Task 2: The device remembers List or Map per zone

**Files:**
- Create: `apps/till/src/state/floor-view-memory.ts`
- Test: create `apps/till/src/state/floor-view-memory.test.ts` (model: `zone-menu-memory.test.ts`)

**Interfaces:**
- Produces:
  ```ts
  export type FloorView = "map" | "list";
  export interface FloorViewIdentity { origin: string; deviceId: string }
  export interface FloorViewChoices {
    read(zoneId: string): FloorView | undefined;
    remember(zoneId: string, view: FloorView): void;
  }
  export function floorViewChoices(
    storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null,
    identity: FloorViewIdentity,
  ): FloorViewChoices;
  ```
  Key `waitron.floorView.${JSON.stringify([origin, deviceId, zoneId])}` (D8). Consumed by Tasks 3
  and 6.

- [ ] **Step 1: Failing tests**, each with a `Map`-backed fake storage like the sibling's test:
  1. "remembers a zone's view across a restart" — `remember("z1", "list")`; a second
     `floorViewChoices` over the same storage reads `"list"` for `z1` and `undefined` for `z2`; the
     storage holds exactly the key `waitron.floorView.["https://venue.example","device-1","z1"]`.
  2. "keeps devices and venues apart" — the same storage, identities differing only in `deviceId`,
     then only in `origin`: neither reads the other's value (Review focus 3).
  3. "ignores and removes a stored value that is not map or list" — storage holds `"grid"` under
     `z1`'s key, then `"\"map\""` (a JSON string, not the bare word): `read` answers `undefined`
     both times and the key is gone (Review focus 4).
  4. "a store that refuses every call still remembers for this instance" — `getItem`, `setItem` and
     `removeItem` all throw: `remember("z1", "map")` does not throw and `read("z1")` answers
     `"map"`; a `null` storage behaves the same.
  5. "a refused removal does not bring the bad value back" — `removeItem` throws, storage holds
     `"grid"`: two `read`s both answer `undefined`.
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/till exec vitest run src/state/floor-view-memory.test.ts`
  (no such module).
- [ ] **Step 3: Implement** after `ZoneMenuMemory` (`zone-menu-memory.ts:10-89`): an in-memory map
  of key → `FloorView | null` consulted first, writes and removals in `try`, a value accepted only
  when it is exactly `"map"` or `"list"`.
- [ ] **Step 4: Run; expect PASS** (read the count).
- [ ] **Step 5:** typecheck till; eslint both files; `pnpm format:check`; ledger;
  `git commit -s -m "A797-5: the device remembers List or Map for each zone"`

### Task 3: The Floor keeps List or Map per zone, and reads the device's memory

**Files:**
- Modify: `apps/till/src/screens/till-floor-screen.ts` (`viewOverride` `:831`, `#toggleView`
  `:1249-1251`, `#zoneOnScreen` inputs `:2230-2239` and `view` `:2261`; new
  `@property({ attribute: false }) viewMemory?: FloorViewChoices`)
- Test: create `apps/till/src/screens/till-floor-screen.view-memory.test.ts` (mount helpers as
  `till-floor-screen.zone-menu.test.ts` builds a floor with two zones; toggle with
  `toggleFloorView`, `apps/till/src/widgets/test-helpers.ts:704-716`)

**Interfaces:**
- Consumes: Task 2's `FloorViewChoices`. Produces: the `viewMemory` property, set by Task 6.

- [ ] **Step 1: Failing tests** — two zones, `z1` with a table placed on the map and `z2` with none,
  so their defaults differ (Map and List):
  1. "a tap on one zone leaves the other zone's view alone" — no `viewMemory`: on `z1` toggle to
     List; select `z2` → List (its default); toggle `z2` to Map; back to `z1` → still List. Today
     the one `viewOverride` carries `z1`'s List to `z2` and `z2`'s Map back to `z1`, so the last
     check fails.
  2. "opens each zone in the view this device remembered" — a `viewMemory` fake answering `"list"`
     for `z1` and nothing for `z2`: `z1` opens as a list (its default is Map), `z2` as a list (its
     default).
  3. "a tap tells the device's memory" — toggling on `z1` calls `remember("z1", "list")` once.
  4. "a tap this session wins over the memory" — memory answers `"list"` for `z1`; toggle → Map.
  5. "a floor with no zones toggles without remembering" — `zones: []`: the toggle still changes the
     view and `remember` is never called.
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/till exec vitest run src/screens/till-floor-screen.view-memory.test.ts`
  — case 1 on its last check, 2–4 (no `viewMemory` property is read).
- [ ] **Step 3: Implement** D8's per-zone override: `viewOverride: ReadonlyMap<string | undefined,
  FloorView>`; `#toggleView` writes a new map under `this.#zone.activeKey` (`undefined` on a floor
  with no zones) and, only when that key is defined, calls `viewMemory?.remember`; `view = viewOverride.get(key) ?? viewMemory?.read(key) ?? derived`; add
  `this.viewMemory` to `#zoneOnScreen`'s inputs. Update the property's comment (`:830`): it no
  longer says "not persisted".
- [ ] **Step 4: Run; expect PASS**, then every floor suite, which the probe ran green with the same
  per-zone change: `pnpm --filter @waitron/till exec vitest run src/screens/till-floor-screen src/screens/text-size.layout src/screens/device-screens src/widgets/till-shell.device-zones`
  (`src/screens/till-floor-screen` matches every `till-floor-screen*.test.ts` by name). Expected:
  all pass. A failure is a STOP.
- [ ] **Step 5:** typecheck till; eslint; format check; ledger; `git commit -s -m "A797-5: the Floor keeps List or Map for each zone"`

### Task 4a: A handheld's Floor shows the Ready bar; a till's summary reads "Ready"

**Files:**
- Modify: `apps/till/src/screens/till-floor-screen.ts` (new `handheld` property; new `#readyBar()`
  beside `#stationSummary` `:2909`; `#stationSummary` returns `nothing` when `handheld`; the bar
  drawn as the last child of `.screen`), `apps/till/src/i18n/strings.ts` (`floor.ready_title`
  `:1018`, `:2751`; D5's four new keys beside them), `apps/till/src/i18n/help-strings.ts`
  (`help.floor.ready_bar`, English beside `:27`, Spanish beside `:73`)
- Test: create `apps/till/src/screens/till-floor-screen.ready-bar.test.ts` (fixtures copied from
  `till-floor-screen.signals.test.ts:13-128`); change one check in `till-floor-screen.signals.test.ts`

**Interfaces:**
- Consumes: Task 1's `readyTables`, called with `new Set(this.zones.map((zone) => zone.id))`.
- Produces: `[data-ready-bar]` (a `section` named by its "Ready" text through `aria-labelledby`),
  holding the `floor-ready` icon, the word, one `wt-button[data-ready-table=<tableId>]` per entry
  (text `floor.ready_bar_table`, no `aria-label`: its text is its name, D5) and
  `wt-button[data-ready-open]` (text `floor.ready_bar_open`, `aria-label` `floor.ready_bar_open_label`
  naming the first entry), and the `help.floor.ready_bar` badge (`helpBadge`, `apps/till/src/widgets/help-badge.ts:7`).

- [ ] **Step 1: Failing tests** (mount with `handheld: true` unless the case says otherwise):
  1. "a handheld lists the tables with food ready, in place of the summary" — Mesa 2 (bar 3) and
     Mesa 8 (bar 1, kitchen 2): the bar's entries read `["Mesa 2 · 3", "Mesa 8 · 3"]`, then
     "Open ›"; no `[data-station-summary]`.
  2. "the bar lists only the zones the Floor shows" — Mesa 8 in `z2`, `zones` holding only `z1`:
     the entries are `["Mesa 2 · 3"]` (D1). With both zones, both.
  3. "tapping a table opens it, and Open opens the first" — clicking `[data-ready-table="t8"]`
     emits one `open-table` `{ tableId: "t8", seated: true }`; `[data-ready-open]` emits one for
     `t2`; its `aria-label` is "Open Mesa 2".
  4. "draws nothing while nothing is ready" — no `[data-ready-bar]` and no space kept for it (D2).
  5. "a till keeps the summary, titled Ready, and draws no bar" — `handheld` unset: the summary's
     `h2` reads "Ready" and `[data-ready-bar]` is absent.
  6. "says it in Spanish, one dish or several" — `setLocale("es")`, Mesa 2 with 1 dish ready and
     Mesa 8 with 3: the word «Listo», entries «Mesa 2 · 1» and «Mesa 8 · 3», «Abrir ›» named
     «Abrir Mesa 2»; each entry's accessible name (`computedName` through the a11y helpers the
     floor's a11y suite uses, or the button's text where it has no `aria-label`) equals its visible
     text, and no name contains «listos» (D5).
  In `till-floor-screen.signals.test.ts` "says it in Spanish" (`:336-338`): expect «Listo» (the
  section's one changed check, Q51 (f) 8; ledger).
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/till exec vitest run src/screens/till-floor-screen.ready-bar.test.ts src/screens/till-floor-screen.signals.test.ts`.
- [ ] **Step 3: Implement** D3–D5: the property, the bar's markup and plain styles (where it sits,
  its stacking and its look are Task 4b), the strings, the help badge, and `#stationSummary` returning
  `nothing` on a handheld. The summary's comment (`:2908`) gains "A handheld draws the Ready bar
  instead."
- [ ] **Step 4: Run; expect PASS**, then the floor suites (Task 3's Step 4 command). Expected: all
  pass; the seven summary cases the probe failed pass because they mount no `handheld`.
- [ ] **Step 5:** typecheck till; eslint; format check; `pnpm exec vitest run scripts/english-only.test.ts`;
  ledger (the changed Spanish check); `git commit -s -m "A797-5: a handheld's Floor shows the Ready bar"`

### Task 4b: The Ready bar sits at the foot of the scrolling area, under any overlay, in both themes

**Files:**
- Modify: `apps/till/src/screens/till-floor-screen.ts` (the floor's `:host` gains `isolation:
  isolate` and `min-height: 100%`; `.screen` becomes a column at least that tall; the bar's sticky
  styles and look, D6)
- Test: `apps/till/src/screens/till-floor-screen.ready-bar.test.ts` (layout cases),
  `apps/till/src/screens/till-floor-screen.a11y.test.ts` (new case, run by its existing light and
  dark `describe`s)

- [ ] **Step 1: Failing tests.** The layout cases mount the floor inside a stand-in for the shell's
  scrolling area: a `div` with `position: relative`, a fixed height and `overflow: auto` (the
  scrolling area, `till-shell.ts:386-390`), holding the floor, and a sibling `div` with
  `position: absolute; inset: 0` and a token background (the overlay, `:395-400`), `hidden` unless
  the case opens it. Use `pageAt(390, 844)` then `pageAt(1024, 768)` (`test-helpers.ts:117`, undone
  by `resetPage`).
  1. "sits at the foot of the scrolling area, with two tables or forty" — with two cards and with
     enough to scroll: the bar's bottom edge equals the scrolling area's bottom edge (within 1 px);
     scrolled to the end, the last card's bottom is above the bar's top. Before the change the bar
     is in the flow, so with two cards its bottom is far above the area's.
  2. "fits one line" — height at most `tap-min + 2 × space-3` read from the computed tokens (D6);
     with eight entries the word and Open › are both inside the area and the entries' strip scrolls
     sideways (`scrollWidth > clientWidth`) instead of wrapping.
  3. "is drawn under an overlay" — open the overlay; take the bar's centre point and compare the
     **painted colour** there with the overlay's background (`page.screenshot` of a 1 × 1 clip, the
     route the probe took, D6) — never `elementFromPoint` alone, which skips the `inert` Floor. Also
     assert `getComputedStyle(floor).isolation === "isolate"`. Control by deletion: remove the
     isolation and the case must fail on the colour (the probe painted the bar there). Record the
     failing colour in the ledger.
  4. a11y: "has no violations with the Ready bar, on the list" — `handheld: true`, two ready
     tables, at 390 and 1024 px, in English and Spanish, axe as the file's other cases do; the bar's
     text has the contrast axe requires in both themes.
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/till exec vitest run src/screens/till-floor-screen.ready-bar.test.ts src/screens/till-floor-screen.a11y.test.ts`
  — cases 1 and 3.
- [ ] **Step 3: Implement** D6 with `--wt-*` tokens only (guards: `packages/ui/src/no-hardcoded-chrome.test.ts`
  reads `packages/ui` alone, so check by eye that no hex, `rem` or `em` is added;
  `scripts/style-token-names.test.ts` checks the names). Text in the brand colour, if Open › is
  drawn so, reads `--wt-color-primary-text` (CLAUDE.md §3). The floor's `min-height: 100%` must not
  change a till's layout: the floor suites in Step 4, including `till-floor-screen.layout`, are the
  check.
- [ ] **Step 4: Run; expect PASS**, then the floor suites (Task 3's Step 4 command) and
  `pnpm exec vitest run scripts/style-token-names.test.ts scripts/primary-coloured-text.test.ts`.
- [ ] **Step 5:** typecheck till; eslint; format check; ledger; `git commit -s -m "A797-5: the Ready bar sits at the foot of a handheld's Floor, under any overlay"`

### Task 5: A handheld's Floor re-reads in list view too

**Files:**
- Modify: `apps/till/src/screens/till-floor-screen.ts` (`#watchFloor` `:994-1004`: re-read when
  `this.#zone.view === "map" || this.handheld`; `updated` must re-run it when `handheld` changes)
- Test: `apps/till/src/screens/till-floor-screen.refresh.test.ts` (new cases beside "does not ask
  while the list shows", `:159`)

- [ ] **Step 1: Failing tests** (the file's fake timers and `countRefreshes`):
  1. "a handheld asks every 15 s while the list shows" — mount with `handheld: true`, toggle to
     List: after 30 s, two `floor-refresh` events, each `{ poll: true }`.
  2. "the bar appears on a list-view handheld once a re-read brings food ready" — a handheld on a
     list zone with nothing ready; advance 15 s; the test answers the refresh by setting `tables`
     to a copy with Mesa 2 ready; `[data-ready-bar]` now lists "Mesa 2 · 3" (Review focus 6).
  3. "the bar and its space go once a re-read has nothing ready" — from case 2's state, the next
     refresh answers with Mesa 2 served: no `[data-ready-bar]`, and the last card's bottom moves
     down to where it was before the bar appeared (D2).
  4. "stops when the screen leaves" for a handheld in list view, as the existing case
     (`:180`) does for the map.
  The till's case "does not ask while the list shows" runs unchanged and must still pass.
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/till exec vitest run src/screens/till-floor-screen.refresh.test.ts`.
- [ ] **Step 3: Implement** D7.
- [ ] **Step 4: Run; expect PASS**, then the floor suites (Task 3's Step 4 command).
- [ ] **Step 5:** typecheck till; eslint; format check; ledger; `git commit -s -m "A797-5: a handheld's Floor keeps its Ready bar current in list view"`

### Task 6: The till app hands the Floor its form factor and the device's memory

**Files:**
- Modify: `apps/till/src/till-app.ts` (the floor mount `:18205-18227`: `.handheld=${kindOfFormFactor(this.formFactor ?? "") === "handheld"}`
  and `.viewMemory=${this.#floorViewChoices()}`; new `#floorViewChoices()` beside `#menuMemory`
  `:5869`, cached by `origin` and `deviceId`, `undefined` without a `deviceId`, storage obtained as
  `:5871-5876` does)
- Test: `apps/till/src/till-app-device-zones.test.ts` (a new `describe` inside "a handheld's zones",
  `:1140`, reusing `mountHandheld` `:1177` and `tableIn` `:1146`); clear `waitron.floorView.` keys
  in its `afterEach`, as `till-app-parties.test.ts:11279` clears its own prefix

**Why the form factor, not `handheldMode`:** `handheldMode` is set once, from the identity read at
start-up (`till-app.ts:4170`, `:4206-4209`), while a profile switch updates `formFactor`
(`#applyProfileSetup`, `:9851-9858`) and leaves `handheldMode` as it was (read: nothing else
assigns it, `grep -n "handheldMode =" apps/till/src/till-app.ts` → the declaration `:2444` and the
assignments `:4170`, `:4209`). Slice 4's
`#choosesZones` (`:9375-9381`) reads `formFactor` the same way. `kindOfFormFactor` is
`apps/till/src/layout.ts:25`.

- [ ] **Step 1: Failing tests** (both handheld form factors where cheap):
  1. "a handheld's Floor draws the Ready bar for its chosen zones only" — choice `["room"]`, a
     ready party at a `room` table and one at a `garden` table: the bar lists only the `room` table;
     a till (the file's `mount`) with the same tables draws the summary and no bar.
  2. "opening a table from the bar takes the Floor and its bar off the screen" — tap the bar's
     `room` entry: the Order tab shows, and no `till-floor-screen` (hence no `[data-ready-bar]`) is
     left in the app's shadow root (`till-app.ts:18339-18342` draws one tab). Then "an overlay from
     ☰ is drawn over the bar": back on the Floor, open ☰ → Find a bill; the painted colour at the
     bar's centre is the overlay's, read as Task 4b case 3 does (D6; `elementFromPoint` alone cannot
     tell, the Floor being `inert`). Real-app check of D6's open point: the bar's bottom edge is at
     or above `window.innerHeight` at 390 and 1024 px; if it is below, STOP and report (D6).
  3. "List or Map survives a reload on this device, per zone" — toggle the Floor's view on `room`;
     unmount and mount again with the same device id: `room` opens in the tapped view and `garden`
     in its default; `localStorage` holds exactly one `waitron.floorView.` key, naming `device` and
     `room`.
  4. "another device id in the same browser starts from the default" — mount with device id
     `other`: `room` opens in its default view.
  5. "a refused store still keeps the choice for this session" — `vi.spyOn(Storage.prototype, "setItem")`
     throwing: the toggle works, and selecting another zone and coming back keeps it.
  6. "the bar follows a profile switch" — a device that starts on a till profile and switches to a
     handheld one (the file's switch helpers, as slice 4's Review focus 1 case does): the Floor draws
     the bar after the switch (with `handheldMode` it would not).
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/till exec vitest run src/till-app-device-zones.test.ts`
  — cases 1, 2's overlay half and 6 (no `handheld` is passed), case 3 (nothing is stored).
- [ ] **Step 3: Implement** the two bindings and `#floorViewChoices()`.
- [ ] **Step 4: Run; expect PASS**, then the app suites the probe ran:
  `pnpm --filter @waitron/till exec vitest run src/till-app src/screens/till-counter-cleanup.look src/widgets/guide-sheet`
  (the probe: 43 files, 4361 tests, all passed; read the count). **Expected new failures, not a
  STOP:** from here a handheld's Floor re-reads in list view (Task 5, D7), so an app suite that
  mounts a handheld on a list-view zone, fakes `setInterval` and counts `getTablesState` calls can
  see one more call per 15 s (the fake-timer suites include `till-app-device-zones.test.ts:204` and
  `:1537`; the probe ran before D7 existed, so it could not show which). Fix each by expecting the
  extra read, list it under Changed test checks with D7 as the reason, and name it in the ledger.
  Any failure of another shape is a STOP.
- [ ] **Step 5:** typecheck till; eslint; format check; ledger; `git commit -s -m "A797-5: a handheld's Floor gets the Ready bar and remembers its view"`

### Task 7: Docs, the user guides and the backlog follow the code

**Files:**
- Modify: `apps/server/src/guide/en/table-service.md`, `apps/server/src/guide/es/table-service.md`
  (two new sections each, before "Choose the zones this device shows" `{#device-zones}`, en `:137`,
  es `:141`), `docs/developers/design-system.md` (the floor paragraph at `:978-990`),
  `docs/backlog.md` (the two A797 entries, `:120-128` and `:2766-2776`), `docs/backlog/till.md`
  (the A797 entry, `:1046`), this plan's slice 5 outline (one line: expanded below)
- Test: `apps/server/src/guide-content.test.ts`, `scripts/guide-links.test.ts`

No guide mentions the summary or List/Map today (ran: `grep -rniE "ready to serve|listo para servir|list or map|lista o mapa" apps/server/src/guide`
→ nothing).

- [ ] **Step 1: Guides.** `## See which tables have food ready {#ready-bar}` /
  `## Ver qué mesas tienen comida lista {#ready-bar}`: on a phone or tablet, a bar at the foot of
  the Floor lists the tables with food ready and how many dishes; tap a table to open it, or Open
  for the first; it lists only the zones this device shows, and goes when nothing is ready; a till
  shows the same as a "Ready" list per station above the tables. `## Show a zone as a map or a list
  {#floor-view}` / `## Ver una zona como mapa o lista {#floor-view}`: List or Map (in the zone's ⋯
  menu on a phone) is kept for each zone on this device, so the zone opens that way next time; a
  zone you have not switched opens as a map when its tables are placed, else as a list. Three to
  five sentences each; Spanish only in the Spanish file.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and
  `pnpm exec vitest run scripts/guide-links.test.ts`; PASS.
- [ ] **Step 3: design-system.md** — in the floor paragraph: "List/Map is remembered per zone on
  the device (`apps/till/src/state/floor-view-memory.ts`)." and one sentence for the bar: on a
  handheld a fixed Ready bar at the foot of the Floor replaces the per-station summary, listing the
  shown zones' tables with food ready; a till keeps the summary, titled "Ready".
- [ ] **Step 4: Backlog** — both A797 entries and `till.md`'s: slice 5 in review with this plan
  linked; slices 1–3 next (#2037 landed). D1, D3 and D7's alternatives go in the PR's Owner FYI
  (Closing slice 5), not the backlog.
- [ ] **Step 5: Check** `pnpm exec prettier --file-info docs/backlog.md` prints `"ignored": true`
  (wrap by hand); `pnpm format:check` for the guide files.
- [ ] **Step 6: Commit** `git commit -s -m "docs: A797-5 — guides, design system and backlog for the Ready bar and remembered List/Map"`

### Task 8 (visual): LOOK at the Ready bar and the remembered view

- [ ] **Step 1: Start the stack** from the worktree: `wa-wt demo waitron-feat-a797-5-ready-bar`;
  `wa-wt ls` gives the URLs. Enrol a browser context on the Handheld profile («Móvil»), as slice
  4's Task 6 did, and sign in.
- [ ] **Step 2: Make food ready.** Seat two tables in one zone and one in another, send a dish to
  each, and mark them ready on the kitchen screen (a second context on a kitchen display, or the
  station view from ☰ → Kitchen).
- [ ] **Step 3: Look** with the workspace's Playwright Chromium (the script in
  `/Users/clintongormley/waitron-campaign-c/a797-5-scripts/`, never in the worktree), at **390 px**
  and **1024 px**, **light and dark**, **English and Spanish**:
  - the bar at the foot of the Floor, its entries in full names until slice 1 lands, Open › at the
    end; on a list-view zone it appears within 15 s of a dish turning ready (D7);
  - after a send, the Sent toast sits above the bar, not over it (D6);
  - open ☰ → Find a bill, then Pass or Kitchen, over a Floor with food ready: the overlay hides the
    bar entirely (D6); and the bar's foot is on screen, not cut by the window's edge (D6's open
    point: if it is cut, STOP and report);
  - turn help on at 390 px: the bar's help badge shows and does not push "Ready" or Open › out of
    view;
  - with enough ready tables to overflow at 390 px, the entries scroll sideways and "Ready" and
    Open › stay in view;
  - the last row of tables scrolls clear of the bar;
  - untick a zone in ☰ → Zones on this device: its tables leave the bar (D1);
  - toggle List/Map on one zone, reload: it opens as left; the other zone keeps its default;
  - on a till (a third context on a till profile, 1280 px), the summary reads "Ready" / «Listo».
- [ ] **Step 4: Save** each screenshot as a PNG under `/Users/clintongormley/waitron-campaign-c/a797-5-shots/`
  (`<step>-<width>-<theme>-<lang>.png`), open each, and describe what was seen in the ledger and
  the PR body.
- [ ] **Step 5: Stop** what you started: the script's process by its recorded id, then
  `wa-wt down waitron-feat-a797-5-ready-bar`.

### Closing slice 5

- Focused runs per task as above; CI runs the till's package suites and coverage. Read the
  `changes` job's outputs and the till's coverage job on the current head before calling the PR
  green.
- `/finish-branch` with this plan named. Review path **LIGHT**: the plan-against-spec read and one
  Codex run-it review.
- PR body sections: **Build order** (#2037 and slice 4 landed; slice 1 next); **Changed test
  checks** (`till-floor-screen.signals.test.ts` "says it in Spanish", «Listo para servir» →
  «Listo», Q51 (f) 8; and any app suite Task 6 Step 4 changed for D7's extra read, from the
  ledger); **Decisions** D1–D8 in one line each; **Till behaviour changes**: the
  summary's title, and List/Map now per zone and remembered on a till too; **Handheld behaviour
  changes**: the bar replaces the summary and its Open {station} buttons, and the Floor re-reads in
  list view (D7); **LOOK** (what the screenshots showed). First line: no venue reset.
- **Owner FYI** (one line each in the PR and the lane's questions file, not questions): D1 (the bar
  follows the zone choice; the till's summary does not), D3 (a tablet handheld shows the bar in
  place of the summary; the spec's letter would show both), D4 (Open › opens the first table until
  slice 7 can order by waiting time), D7 (list view now re-reads on a handheld).
- After merge: delete the branch local and remote and check the remote one is gone; update the
  ledger; then slice 1.

---

## Slice 1 — Short names, data (one PR, branch `feat/a797-1-short-names-data`)

**What it changes.** Every table gets a **short name** beside its full name (design §3.7): "T1"
for "Terrace 1", "TF12" for "Top floor 12", "Win" for "Window", and a name of four characters or
fewer as it is ("12", "B2"). The saved plan's tables (`floor_plan_tables`) and the live tables
(`dining_tables`) both hold it, and the live tables' short names are unique in the venue ignoring
case, enforced by the database. A floor-plan save fills it by Q51 (a)'s rule when the save sends
none, and checks a sent one; a reset copies it onto the live tables, as it copies the full name;
the till's floor read carries it, and the Ready bar slice 5 built shows it ("Ready · T2 · 3"), as
slice 5's D5 promised. Nobody can type a short name yet: the dashboard's field is slice 2. A
configuration file carries it.

**Review path: FULL.** A migration in the core set (CLAUDE.md §3), a cross-package contract (the
floor read's `TableState` gains `shortName`, server `apps/server/src/working-order.ts:8189` and
the till's own copy `apps/till/src/api/client.ts:2204`), and a floor-plan save that can refuse
with a new code.

**Migration: one, core set, no venue reset** — four nullable columns and one unique index, all
`ALTER TABLE … ADD` and `CREATE UNIQUE INDEX`, no table rebuilt (the probe's generated SQL is
quoted in D1). The PR's first line says "No venue reset needed": a venue made before this slice
keeps its tables, which have no short name until their zone's plan is next saved and a reset
copies it (D7 says what the till shows meanwhile).

How claims are marked in this section: **(ran)** means run on 2026-10-25 against `main` at
`6c101a642` (this worktree's base); **(read)** means read in the code at that commit. The probes
were a throwaway worktree (`git worktree add --detach /tmp/a797-1-probe.tIZh/wt 6c101a642`),
removed afterwards; none of it is in this branch.

### Every reader and writer of a table's name (ran: grep; each line read)

The writers, from `grep -rnE "insert\((diningTables|floorPlanTables|floorResetTables)\)|update\((diningTables|floorPlanTables|floorResetTables)\)" --include='*.ts' apps packages scripts | grep -v '\.test\.ts'`
(ran) and `grep -rnE "set\(\{[^}]*\blabel\b" --include='*.ts' apps packages` (ran), each line read:

| Where | What it writes | Short name in this slice |
| --- | --- | --- |
| `apps/server/src/floor-plan.ts:546-561` `writeSave` | creates a plan table (`:554`) and updates one's label, seats and Moveable (`:557-560`); every Add tables and Add joined table on the dashboard arrives here as save entries (a joined table is a plan table with `partKeys`, `:57-66`) | fills `short_name` (D4); `changedShared` (`:602`) counts a short-name change |
| `floor-plan.ts:535-543` | steps renamed plan tables aside under spare labels before the unique `(zone_id, label)` key | none needed: `floor_plan_tables` gets no short-name index (D1) |
| `floor-plan.ts:521-531` | clears `plan_table_id` on deleted masters' live tables and reset rows | none |
| `apps/server/src/floor-today-store.ts:255-271` `resetZoneFor` | copies the layout into `floor_reset_tables` (`targetRow`, `:94-101`) | copies `short_name` (D6) |
| `floor-today-store.ts:665-680` `catchUpPass` | steps renamed live tables aside (`spareLabels`, `:840-853`; `setLabel`, `:855-857`) | short names step aside by being set to `null` first (D6); `spareLabels` unchanged |
| `floor-today-store.ts:682-697` | **the only product insert into `dining_tables`**: a table the reset makes | writes `short_name` and `short_name_key` (D6) |
| `floor-today-store.ts:698-700` | gives a live table its target's label | and its short name, together (D6) |
| `floor-today-store.ts:640`, `:651`, `:751`; `floor-today-mark-moved.ts:169`; `floor-today-merges.ts:306` | reset rows' `ready_to_move`, `pending`, `placed`, `table_id` | none; `leaveHere`'s "already has the row's name" test (`floor-today-mark-moved.ts:164-168`) compares the short name too (D6) |
| `apps/server/src/table-removal.ts:96-107` | deletes a reset row and puts it back (`.returning()`, every column) when the table's delete is refused | carries `short_name` with no change (read: it re-inserts the returned row) |
| `floor-delete.ts:201`, `:214` | `plan_table_id` only | none |
| `parties.ts:699`, `:811`; `floor-today-split-group.ts:152`; `floor-today-parts.ts:112`; `floor-today-reset-table.ts:128` | `needs_clearing_since` only | none |
| `floor-today-name.ts:21-71` `nameToday` | today's name (`floor_today_tables.name`, `floor_today_joins.name`), refused against labels and today's names (`refuseInUse`, `:78-113`, case ignored by `sameName`, `:16-18`) | none (D9) |
| `floor-today-merges.ts` (today's joins), `floor-today-split*.ts` | today's rows only | none (D8, D9) |
| `apps/server/scripts/demo-seed/seed-floor.ts:246-260` | the demo's tables, through `saveLayout` with no short name; its names are already short ("1"–"8", "T1"–"T5", "B1"–"B3", design §5) | the save proposes each (D4): the same as the label, each ≤ 4 characters |
| `packages/db/src/configuration-transfer.ts:58-67` + `packages/provisioning/src/configuration-transfer.ts:614-775` (`importConfigurationTables`) | an import inserts every column a file carries, then runs each module's `afterImport` (`:771-774`) | carries `short_name`; `short_name_key` omitted and set after import (D10) |
| `apps/server/src/testing/live-table.ts:12-28` `createTable`, `testing/party-venue.ts:192-200` `tableAt`, `packages/reporting/test/fixtures.ts:504`, `:553`, and raw inserts in tests (`working-order.test.ts`, `packages/bookings/src/*.test.ts`, `scripts/behavioural-triggers.test.ts`, `packages/db/src/schema/dining-tables.test.ts`; ran `grep -rniE "into \"?(dining_tables|floor_plan_tables|floor_reset_tables)"`) | test tables | none unless a case asks (D12) |

Provisioning makes no tables: no file under `packages/provisioning/src` names `diningTables`,
`floorPlanTables` or `floorResetTables` (ran: the `grep -rlnE` over every package, which listed
none there), so design §5's "I believe" holds.

The readers this slice changes: the till's floor read `listTablesWithState`
(`apps/server/src/working-order.ts:8232-8412`, served by `GET /api/tables/state`,
`apps/server/src/till-api.ts:2762-2774`), the plan read `readLayout`/`planTables`
(`floor-plan.ts:193-244`, served by `GET /management-api/floor-plan-sets/:setId/zones/:zoneId/floor-plan`,
`management-api.ts:1515`), the room fingerprint `roomPrints` (`apps/server/src/floor-revision.ts:63-107`,
which decides whether a catch-up moves a room's revision), and the till's `readyTables`
(`apps/till/src/state/table-signals.ts:62-85`). `GET /api/tables` (`listTables`,
`apps/server/src/tables.ts:27-53`) is not changed: no tight place reads it.

### Plan decisions for slice 1

- **D1. Four nullable columns and a unique index on the folded copy; no rebuild.**
  `dining_tables.short_name` and `dining_tables.short_name_key` (the short name folded,
  D3), unique with the venue through
  `uniqueIndex("dining_tables_location_short_name_key_uq").on(t.locationId, t.shortNameKey)`;
  `floor_plan_tables.short_name` and `floor_reset_tables.short_name`, with no key and no index.
  All `label(...)` columns (`packages/db/src/schema/columns.ts:162`), with no `.notNull()`.
  **Generated (ran, the probe, `pnpm --filter @waitron/db db:generate --name table_short_names`):**
  ```sql
  ALTER TABLE `dining_tables` ADD `short_name` text;--> statement-breakpoint
  ALTER TABLE `dining_tables` ADD `short_name_key` text;--> statement-breakpoint
  CREATE UNIQUE INDEX `dining_tables_location_short_name_key_uq` ON `dining_tables` (`location_id`,`short_name_key`);--> statement-breakpoint
  ALTER TABLE `floor_plan_tables` ADD `short_name` text;--> statement-breakpoint
  ALTER TABLE `floor_reset_tables` ADD `short_name` text;
  ```
  as `packages/db/drizzle/0191_table_short_names.sql` (the next free number, ran: `ls
  packages/db/drizzle | tail` → `0190_incident_acknowledged_note.sql`). Many tables hold keys into
  `dining_tables` (ran: `grep -rln "diningTables.id"`: bookings, orders, parties, floor plans,
  department transfers, table clearing, service steps), so a generated rebuild would run with
  foreign keys on (CLAUDE.md §3): **any `__new_` table in the generated SQL is a STOP.**
  **Why nullable (measured, ran with `node:sqlite`, SQLite 3.54.0, Node v26.11.1, on a bare
  table):** `ALTER TABLE t ADD c text NOT NULL` succeeds on an empty table and fails on one row
  with "Cannot add a NOT NULL column with default value NULL"; `ADD … DEFAULT '' NOT NULL` succeeds
  but then `CREATE UNIQUE INDEX` over `(location_id, c)` fails on two rows with "UNIQUE constraint
  failed"; a nullable column and its unique index succeed on 0, 1 and 2 rows (NULLs never clash).
  And the real migration, generated NOT NULL in a second probe (`ALTER TABLE \`dining_tables\`
  ADD \`short_name\` text NOT NULL;`), fails `scripts/migration-upgrade.test.ts` with
  `migrations.apply_failed` caused by "Cannot add a NOT NULL column with default value NULL"
  (ran: `Tests 1 failed | 3 passed (4)`). Nullable, the same suite passed with eight other guards
  (below). So NOT NULL would need a venue reset and every fixture that inserts a table (the table
  above) to change, for nothing a reader needs: D7 answers the full name where none is stored.
  **Why a stored copy, not an index on `lower(short_name)`:** the engine's `lower()` folds ASCII
  only (the catalogue folds in JavaScript for that reason, `packages/catalogue/src/product-names.ts:17`),
  and a drizzle-kit 0.31.11 rebuild writes an expression index back in a form this engine refuses
  (CLAUDE.md §3; design §5). The precedent is `custom_themes.name_key` under
  `uniqueIndex("custom_themes_name_key_uq")` (`packages/db/src/schema/custom-themes.ts:10`, `:18`).
  Nothing in the database ties the copy to the short name (a CHECK would rebuild the table), so
  every writer fills both through one helper, `shortNameColumns` (D3), and the writers' tests
  prove the copy by a clash that differs only in case. **`uniqueIndex`, not `unique()`:** both
  generate the same `CREATE UNIQUE INDEX` (probe 3, below; and the existing `unique()` keys are
  emitted so, ran: `grep -n dining_tables_location_label_key packages/db/drizzle/0000_baseline.sql`),
  so neither rebuilds; `uniqueIndex` follows the folded-key precedent. **Why no index on the plan's tables:** they have
  no venue column (`floor-plans.ts:121-140`), a per-zone index would not say "unique in the
  venue", and the save's check guards them, as it guards their labels across zones (design §5);
  and an index there would make the save step short names aside as it steps labels (`:533-543`).
  `scripts/migration-upgrade.test.ts`'s `CANDIDATES` needs nothing: the suite passed with both
  rows' new columns null (ran, below).
- **D2. The rule is one function in `@waitron/shared`**: `packages/shared/src/table-short-name.ts`,
  re-exported from `packages/shared/src/index.ts`, beside `partyTablesName`. The till, the
  dashboard and `@waitron/db` already depend on `@waitron/shared` (ran: `grep -n '"@waitron/shared"'
  apps/dashboard/package.json apps/till/package.json packages/db/package.json`), and it is the
  package the till's browser bundle already imports (`packages/shared/src/table-signals.ts` through
  `apps/till/src/state/table-signals.ts:1`), so slice 2's dashboard proposes with the server's own
  function. `proposeShortName(label)`, Q51 (a) made exact:
  1. Normalise to NFC, trim, collapse runs of white space to one space. Four characters or fewer
     → that, unchanged ("12", "B2", "t1", "Bar").
  2. Else take the run of digits that ends the name, if any (`/\p{Nd}+$/u`), and split what is
     before it into words on spaces.
  3. No number and one word → its first three characters, trimmed ("Window" → "Win",
     "Patio" → "Pat").
  4. Else the initials — each word's first letter or digit (`/[\p{L}\p{Nd}]/u`), upper-cased —
     then the number: "Terrace 1" → "T1", "Top floor 12" → "TF12", "Table12" → "T12", "Window
     seat" → "WS", "(VIP) 3" → "V3", "Café 3" → "C3".
  5. At most five characters: initials are dropped from the end first ("Top floor 1234" →
     "T1234", "The very long garden terrace 7" → "TVLG7"); a number of five or more digits keeps
     its last five ("Room 123456" → "23456"), because the end of a number is what tells a run of
     tables apart. A name with neither initials nor number keeps its first three characters,
     trimmed ("-- --" → "--").
  "Characters" are code points of the NFC form (`Array.from`), so «é» typed either way counts
  once. Upper-casing is JavaScript's `toUpperCase` (locale-free: "ß" becomes "SS", two
  characters, counted after: "ß ß ß 7" → "SSSS7", ran on the draft). The probe ran a draft of this function over these inputs (ran:
  `node try.mts` in the probe); every output above is what it printed, after the `trim` of step 3
  ("-- --" printed `"-- "` before it). "Terrace 1A" gives "T1" (its last word's initial is "1"):
  a typed short name, slice 2's, sorts that one out.
  Also exported: `SHORT_NAME_MAX = 5`, `shortNameLength(value)` (code points of the NFC form) and
  `shortNameKey(shortName)` (D3). Another answer to Q51 (a) changes this one file and its tests
  (design §8).
- **D3. Two short names clash when their keys are equal: `shortNameKey(s) = s.trim().normalize("NFC").toLowerCase().normalize("NFC")`**
  — the steps of `@waitron/identity`'s `foldForUniqueness` and the catalogue's `foldName`,
  so "t1" is "T1" (design §3.7: "Compared ignoring case"). The stored `short_name` keeps what was
  given, trimmed. `packages/db/src/table-short-names.ts` (new) exports
  `shortNameColumns(shortName: string | null): { shortName: string | null; shortNameKey: string | null }`,
  the one way a live table's two columns are written, as `nameColumns` is for products
  (`packages/catalogue/src/product-names.ts:11-13`).
- **D4. A save checks a short name it is sent, keeps the stored one of a table it did not rename,
  and proposes one otherwise.** A save entry gains `shortName?: string` (`ZonePlanSave`,
  `floor-plan.ts:54-67`; parsed in `parseZonePlanSave`, `management-api.ts:424-458`, Task 4b: a
  string, or absent; `null` is read as absent, as that parser reads a null `id`, because the plan
  read sends `shortName: null` for a table with none (D5) and a client may send the read's value
  back; anything else → `management.request_invalid` `{ field: "tables.<i>.shortName" }`).
  Resolved in `checkSave` (`:348-394`), after the labels' check (`:378-384`), by a pure function
  `resolveShortNames` (new, `apps/server/src/table-short-names.ts`). Each entry is in one of three
  classes:
  - **sent**: the entry carries `shortName`;
  - **kept**: it carries none, has an `id`, and its trimmed label equals its stored plan table's
    label — it keeps its stored short name; when that is `null` it is **proposed** instead;
  - **proposed**: it carries none and is new, or renamed (its trimmed label differs from the stored
    one) — `proposeShortName(label)`. A rename with none sent is proposed again from the new name,
    as design §3.7 fills it "when the table is made or renamed".

  **taken** maps a key to the full name of the table holding it: the venue's plan tables in other
  zones and its live tables in other zones, by their short names, plan tables first, so `takenBy`
  names the plan's table when both hold it — the same scope as the labels' `namesTaken`
  (`:313-324`), for the same reason: this zone's live tables follow the save at its next reset.
  **It also holds, folded the same way, the full name of every such table whose short name is
  `null`**: that table is shown by its full name (D7), so another table's short name equal to it
  (zone B's "Terrace 1" proposing "T1" while zone A's table labelled "T1" has none) would show
  two tables as "T1" on the Ready bar; `takenBy` is then that table's full name. Resolution, in
  this order:
  1. **Kept values, in save order, are claimed first**: they are the stored state, so a sent value
     cannot take one (design §3.7: "Saving a short name another table already uses is refused").
     A kept value that clashes with **taken** or an earlier kept value — possible only with data
     written before this slice or by a racing save — gives that entry none.
  2. **Sent values, in save order:** trimmed; blank, or longer than `SHORT_NAME_MAX` characters →
     `floor_plan.invalid` `{ field: "tables.<i>.shortName" }` (the shape `checkEntries` gives
     every field, `:273-290`); a key in **taken**, claimed by a kept value, or sent by an earlier
     entry → **`table.short_name_taken` `{ shortName, takenBy, field: "shortName" }`**,
     `shortName` as sent (trimmed), `takenBy` the other table's full name (design §5: "Terrace 1
     already uses T1").
  3. **Proposals, in save order:** taken when the key is free, else **none** (`null`). A sender
     that never chose a short name is never refused over one, and nothing picks another one
     (design §3.7: "nothing picks another one silently").

  **Why the classes:** today no sender sends one — the dashboard's `saveFromDraft` lists its
  fields (`apps/dashboard/src/screens/floor-plan-draft.ts:73-86`, read) and slice 2 adds the
  field. Without the kept class every save that sends none (today's dashboard, the seed, the
  tests) would re-propose every table's short name, replacing a stored one (once slice 2 lets a
  person type "Tb1") and letting a new table in the same save take an untouched table's. And the
  senders that never send one name tables freely: `floor-plan.test.ts` shares one database across
  its cases (`resetPerTest: false`, `:44`) and names tables `fresh(label)` = `"Counter 3-ab12cd"`
  (`:106-108`), which all propose "C3"; refusing a proposal would refuse saves that never mentioned
  a short name (probe 2, below, ran proposals as a lenient pass and none failed on it). **After
  slice 2** the dashboard always sends one (picture 09 marks the field required), so the refusal
  is what a person meets. **Alternative, for the owner:** refuse a clashing proposal too; the cost
  is that until slice 2 lands, a venue whose two tables propose the same short name (for example
  "Window 1" and "Wall 1", both "W1") could not save that zone at all, with no field to fix it.
  The plan's table gets the resolved value (`masterColumns`, `:396-398`, gains it), and
  `changedShared` (`:602-626`) counts a changed short name as a change of the zone's shared
  tables, so other sets' editors see a new revision, as for a rename. **2026-10-25, during the
  build:** a kept stored short name another table now holds leaves the table with none; and the
  save refuses (`table.label_taken`, with `takenBy`) a table it adds or renames that is left with
  no short name while another zone's table already holds its full name, folded, as a short name
  (or as its full name, having none); a table left under its stored name is never refused.
- **D5. The plan read carries each table's short name** — `PlanTable.shortName: string | null`
  (`floor-plan.ts:26-37`, filled at `:205-214`), `null` for a table with none. Slice 2's field
  shows it, or the proposal when it is `null`. One existing check changes (Changed test checks).
- **D6. A reset gives a live table its target's full name and short name together, and waits
  while either is in use.** The reset copies `short_name` into `floor_reset_tables`
  (`targetRow`, `floor-today-store.ts:94-101`; `targetsFromMaster`, `floor-reset-plan.ts:195-247`,
  which also gives a removal target the live table's own short name). In `planReset`
  (`floor-reset-plan.ts:70-149`) a `Target` and a `LiveTable` gain `shortName: string | null`
  and the input gains `shortNameKeysElsewhere: ReadonlySet<string>` (the keys of the venue's live
  tables in other zones, built beside `takenElsewhere`, `floor-today-store.ts:443-445`). Short-name
  keys live in **their own sets**, never in `fixedInUse` or `inUse`, so a label "12" never blocks
  a short name "12": every place that marks a label in use (`fixedInUse.add`, `:82`, `:90`, `:94`,
  `:107`, `:111`) marks the table's short-name key in a `fixedShortInUse` set; a `Renaming`
  (`:64-68`) gains `currentShortKey`; the fixed-point loop's `inUse.add(entry.current)` (`:128`)
  gains its twin, adding the `currentShortKey` of every entry no longer wanting its new names to
  a `shortInUse` set; and a renaming wants its new names (`:130-139`) only while its target's
  label is free of `inUse` and `claimed` **and** its target's short-name key is free of
  `shortInUse` and of the short keys claimed this pass. So a table that waits for its label keeps
  its current short name in use, and another target wanting that short name waits too, rather
  than reaching the unique index in the store. So a table whose new short name
  another table still holds keeps both its names and waits, as a table whose new label is taken
  does today ("places a table whose new name is taken in another zone, keeping its old name",
  `floor-today-store.test.ts:618`). `apply`'s shape is unchanged: `label` not null means "take the
  target's names". The catch-up (`floor-today-store.ts:665-700`): after the labels' spare step,
  every applied table whose short-name key changes has **both its short-name columns set to
  `null` first** — NULLs never clash under the unique index (D1's measurement), so this needs no
  spare short names and no change to `spareLabels` (`:840-853`), and a swap ("T1" ↔ "T2") never
  meets the index halfway; then each applied table takes its target's short name and key
  (`shortNameColumns`, D3), and a created table is inserted with both (`:682-697`). It is all one
  transaction, so no reader sees the nulls. Labels keep their spare step: their column is NOT
  NULL.
  A target with no short name gives the live table none. `roomPrints`
  (`apps/server/src/floor-revision.ts:68-90`) gains `shortName`, so a catch-up that changes only a
  short name moves the room's revision and a till's next read sees it. Mark moved's
  `leaveHere` ends a group row only when its table already has the row's label **and** exactly
  its short name (`===` on the stored values, not the key, so a case-only change "Sn1" → "SN1"
  still waits and is applied), else leaves it waiting for its names
  (`floor-today-mark-moved.ts:164-168`), as
  conventions-data.md's floor-plan section says of a row that renames its table. A short name
  saved on the dashboard reaches the till's tables at the next reset, as a rename does today
  (conventions-data.md, "A zone's floor plan").
- **D7. The floor read's `shortName` is always a string: the saved short name, else the full
  name.** `TableState.shortName: string` (`working-order.ts:8189`, from `dt.short_name` at
  `:8262`, mapped at `:8366-8368` as `r.short_name ?? r.label`); the till's `TableState` the same
  (`apps/till/src/api/client.ts:2204`). A table has none when it was made before this slice, or
  when its save found its proposal taken (D4); a tight place then shows the full name, as it does
  today. So that full name never doubles another table's short name, D4's **taken** holds, folded,
  the full names of other zones' tables that have none. One gap stays, inside one zone's save:
  a table there left with none is not compared with the save's own short names (Review focus 11). **Why on the server:** one fallback instead of one per reader (slices 3, 5, 8b and 12b
  read it), and the full name, unlike a proposal made on the fly, is unique (`dining_tables_location_label_key`).
  `TableToday` gains nothing: there is no today's short name (D8).
- **D8. Design §9 settled: a tight place shows the saved short name for a table renamed today, and
  its tables' short names joined for one of today's joins** — "T4+T5", in number order with
  "+", exactly as the map names a join with no name of its own (`mergeLabel`,
  `packages/ui/src/components/wt-floor-map.ts:144-145`), whatever today's names say. A new till
  function `tightName(table, joins)` in `apps/till/src/state/floor-today.ts` (beside `shownUnder`,
  `:70-72`): with `today.joinId` set, `mergeLabel` over the short names of that join's tables in
  `joins` (`joinMembersById` of the tables in view, built once by `readyTables`); else
  `table.shortName`. **Why:** a tight place is where a runner finds the
  physical table; a today's name is free text of up to 40 characters (`normalisePartyName`,
  `packages/shared/src/party-name.ts:4`, `:31-38`, used by `nameToday`) and not short, and the
  members' short names are unique and already on the tables. A saved joined table (one the plan
  makes, `floor_plan_table_parts`) is its own live table with its own short name, like any other.
  The Ready bar uses `tightName` in place of `shownUnder` (`table-signals.ts:72`), the swap slice
  5's D5 left to this slice; a party's entries stay its distinct names joined with "+", so a join's
  members give one entry. Slices 3, 8b and 12b use the same function (8b and 12b on their own
  reads, which carry the same two facts). **Alternative, for the owner:** a today's join shows its
  today's name when it has one.
- **D9. Today's names neither check nor change short names.** `nameToday` and today's joins
  (`floor-today-name.ts`, `floor-today-merges.ts`) are unchanged: today's names are checked against
  saved labels and other today's names (`refuseInUse`, `:78-113`), and a short name is a separate,
  saved name (D8). So a table may be named "T1" for today while another table's short name is
  "T1": the two are never shown in the same place (a tight place shows short names, D8; the map
  and headers show today's names). Owner FYI, not a question.
- **D10. A configuration file carries `short_name`, never `short_name_key`.** `dining_tables`'s
  entry (`packages/db/src/configuration-transfer.ts:58-62`) gains `"short_name_key"` in `omit`, and
  `CORE_CONFIGURATION_TRANSFER` gains `afterImport: storeTableShortNameKeys` (in
  `packages/db/src/table-short-names.ts`), which sets every `dining_tables` row's key from its
  short name, in batched `case id when … end` updates — the catalogue's precedent,
  `products.name_key` omitted and set by `storeProductNameKeys`
  (`packages/catalogue/src/product-names.ts:16-33`, declared at
  `packages/catalogue/src/configuration-transfer.ts:180`). A file that supplies the key is already
  refused (`setup.request_invalid` `{ field: "dining_tables.short_name_key" }`) by the import's
  omitted-column check (`packages/provisioning/src/configuration-transfer.ts:575-577`, read),
  pinned for products by "…a bundle neither carries one nor may supply one"
  (`apps/server/src/configuration-transfer.test.ts:3662-3683`). `validateCoreConfiguration`
  (`:10-38`) refuses `setup.request_invalid` `{ field: "dining_tables.short_name" }` (or
  `floor_plan_tables.short_name`) for a short name that is neither null nor absent nor a non-blank
  string of at most five characters, and for two rows of either table whose short names clash
  ignoring case (both tables: an import is into a new venue, so the file's rows are the venue's
  rows; `floor_plan_tables` has no index to catch it later). A file with no short names, at this
  version, imports with none; a file exported before this slice is refused anyway, by version
  (`packages/provisioning/src/configuration-transfer.ts:596-599` compares each module's applied
  migration count with the importing box's). `floor_reset_tables` is not transferred (read: not in the
  list) and gains nothing here. The composition spreads the core transfer, `afterImport` included
  (`packages/composition/src/modules.ts:118-124`, read).
- **D11. `table.short_name_taken` is a management refusal only.** Declared beside
  `table.label_taken` in `apps/server/src/errors.ts:386`; `409` in the management status map
  (`management-api.ts:268`, a clash with stored data, conventions-data.md "A refusal's HTTP
  status…"); the dashboard catalogue (`apps/dashboard/src/i18n/codes.ts:578`): "Another table
  already uses that short name" / «Otra mesa ya usa ese nombre corto» («Nombre corto», Q51 (g)).
  A catalogue message takes no parameters (`codeMessage(code, locale)`,
  `packages/dashboard-kit/src/codes.ts:16-19`), so the full "Terrace 1 already uses T1" under the
  field is slice 2's, from the refusal's `params`. **Not** in the till's status map or code
  catalogue, which the outline listed: no till route can throw it — its one thrower is the
  floor-plan save, a management route, and a reset never refuses over a name (D6 waits instead).
  A till catalogue entry would be copy nothing shows. **Alternative, for the reviewer:** add both
  now for symmetry with `table.label_taken`, which the till does throw (`floor-today-name.ts:86`).
- **D12. Test helpers write no short name unless a case asks.** `createTable`
  (`apps/server/src/testing/live-table.ts:12`) gains an optional `shortName` input, written through
  `shortNameColumns`; with none the row's columns stay null, so no existing suite changes
  (`v.table(...)` passes none). **Why:** a proposal in a fixture would clash across cases that
  share a database (D4's example), turning unrelated cases red on the unique index. Raw test
  inserts and `packages/reporting/test/fixtures.ts` are left as they are: null is a state the
  schema allows and D7 reads. The till's test builders are the opposite case — the till's type
  requires `shortName` (D7) — and each gains `shortName` equal to its label (Task 7b).
- **D13. A typed short name is at most five characters too.** Q51 (a)'s "at most 5 characters"
  sits inside the automatic rule, and "the venue may type over it" says nothing of length; the
  tight places it is for (picture 09: "✎ TF1", "TF1 · 2", "TF1 · Mains") are drawn for that
  length. So the save refuses a longer one (D4). **Alternative, for the owner:** no limit on a
  typed one.

### Changed test checks (from the probes; the implementer confirms each)

**Probe 1 (ran): the columns as D1 says, with the floor read and the plan read gaining
`shortName`** (server `TableState.shortName = r.short_name ?? r.label`, `PlanTable.shortName`),
and the till's `TableState` gaining `shortName: string`. Then:
- `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts scripts/migrations-match-schema.test.ts scripts/migration-upgrade.test.ts scripts/id-columns-are-references.test.ts scripts/journal-monotonic.test.ts`
  → `Test Files 9 passed (9)`, `Tests 498 passed (498)`.
- `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts src/write-path.e2e.test.ts`
  → `Test Files 2 passed (2)`, `Tests 20 passed (20)` (the golden huella test, unedited).
- `pnpm --filter @waitron/db exec vitest run` → `Test Files 2 failed | 100 passed (102)`,
  `Tests 2 failed | 1433 passed (1435)`. The two:
  - `packages/db/src/schema/dining-tables.test.ts` "has only the columns today's plan needs"
    (`:81-94`): the sorted column list gains `short_name` and `short_name_key`. Reason: D1.
  - `packages/db/src/schema/floor-plans.test.ts` "round-trips a plan, reset rows, today's rows and
    the new columns" (`:304`; the master's `toEqual` at `:340-346`): the master gains
    `shortName`. Reason: D1. Task 2 makes the case write `shortName: "T1"` on the master and on
    the first reset row and read both back, so the round trip covers the new columns rather than
    only their nulls.
- 142 `apps/server` suites (every `src/*.test.ts` naming `tables/state`, `listTablesWithState`,
  `floor-plan`, `readLayout`, `saveLayout`, `floorPlanTables`, `diningTables`, `dining_tables`,
  `configuration`, `tablesState` or `floor_plan_tables`; ran the `grep -rlE` and `pnpm exec vitest
  run <those>` in `apps/server`) → `Test Files 1 failed | 141 passed (142)`,
  `Tests 1 failed | 6369 passed (6370)`. The one:
  - `apps/server/src/floor-plan.test.ts` "does not read a save entry's liveTableId" (`:1225`, its
    `toEqual` at `:1247`): the read's table gains `shortName`. Reason: D5. Task 4a makes the case
    send a fresh short name and pins it exactly (probe 2 shows why an unsent one cannot be
    pinned).
  No server case pins the floor read's whole `TableState`: none failed on the new key.
- `pnpm --filter @waitron/till typecheck` → **82 errors in 71 files**, all tests or `apps/till/test/` fixtures, every one "Property
  'shortName' is missing" in a `TableState` a test builds (ran; the list is
  `/tmp/a797-1-probe.tIZh/till-tsc.txt` in the probe, regenerated by Task 7b's Step 1). No source
  file failed; the dashboard's typecheck had 0 errors. These are **Fixture-only** (Task 7b).

**Probe 2 (ran): D4's resolution (sent, then proposals if free) in the save, D6's copy, wait,
spare step and create in the reset, `roomPrints` with the short name, on top of probe 1.**
Then the same 142 `apps/server` suites and `src/floor-reset-plan.test.ts`
(ran) → `Test Files 1 failed | 142 passed (143)`, `Tests 1 failed | 6407 passed (6408)`. The one
was probe 1's: "does not read a save entry's liveTableId" printed `"shortName": "N3"` — the
proposal of that case's label `fresh("New")` (`"New-"` and six random hex characters, ending in
a digit that run). So its value depends on the random suffix, and in a database the file's cases
share (`resetPerTest: false`) it can also be `null` when an earlier case's table holds it (D4).
So the changed check makes the case send a fresh short name and pins it exactly (Task 4a). Probe
2 ran the proposals as a lenient pass over every entry; it did not run D4's kept class or the
full names in **taken** (the plan review added both), which only turn a proposal into a kept
value or `null`, never into a refusal for an entry that sent none. Reason: D5. No reset suite failed with D6's copy, wait,
spare step and create in place (the probe stepped short names aside under spare names; the plan
now sets them to `null` instead, D6, which Task 5c's swap case pins and the probe did not run):
their masters are written straight into `floor_plan_tables`
with no short name (`insertMaster`, `floor-today-store.test.ts:111-133`), so every target's is
null, which the copy carries as it is. `floor-reset-plan.test.ts` ran but failed to typecheck on
five sites (ran: `pnpm --filter @waitron/server typecheck`): its builders `t` and `l`
(`:11-33`) and two `targetsFromMaster` inputs (`:294`, `:317`, `:332`) lack `shortName`; they gain
`shortName: null` (**Fixture-only**, Task 5a). Mark moved's comparison (D6) was not probed.

The demo seed's suites, outside that list, also passed with probe 2 (ran: `pnpm exec vitest run
scripts/demo-seed/seed-floor.test.ts src/demo-seed.test.ts src/demo-seed.db.test.ts` in
`apps/server` → `Test Files 3 passed (3)`, `Tests 28 passed (28)`).

Probe 3 (ran): `unique("dining_tables_location_short_name_key_uq")` in place of `uniqueIndex`
generates the same five statements, `CREATE UNIQUE INDEX` included, so the outline's worry that a
`unique()` constraint would rebuild the table does not hold on this drizzle-kit; D1 keeps
`uniqueIndex` for the precedent, not to avoid a rebuild.

Then the till, with probe 1's type, `tightName` (D8) in `readyTables`, and `shortName` added to
the builders of the five suites that draw or compute the Ready bar
(`src/state/table-signals.test.ts`, `src/screens/till-floor-screen.ready-bar.test.ts`,
`.refresh.test.ts`, `.a11y.test.ts`, `src/till-app-device-zones.test.ts`; ran: `grep -rln
"data-ready-bar\|readyTables" apps/till/src`): `pnpm exec vitest run <those five>` in `apps/till`
→ `Test Files 1 failed | 4 passed (5)`, `Tests 2 failed | 241 passed (243)`. The two, both in
`src/state/table-signals.test.ts`:
- "names a party at joined tables by today's join name, once" (`:97-119`): printed
  `"Table 5+Table 6"` against `"Table 5+6"`, because the case's tables carry `today.joinName` but
  no `joinId`, so `tightName` sees two tables. Becomes "names a party at one of today's joins by
  its tables' short names, once": both tables `today({ joinId: "j1", joinName: "Birthday" })`
  with short names "T5" and "T6" → one entry `"T5+T6"`. Reason: D8.
- "uses today's name, not the party's given name" (`:150-160`): expected "Ventana" (today's
  name). Becomes "uses the saved short name, not today's name or the party's": `shortName: "T2"`,
  today's name "Window", party name "Alex" → `"T2"`. Reason: D8.
The four other suites pass because their builders' short name equals the label, which is what
they show today (each case's text is unchanged).

Any other failure, in any suite a task names, is a STOP.

### Review focus (inputs the spec implies and today's tests may not pin)

1. **A clash that differs only in case**: a sent "t1" where another zone's table has "T1" →
   refused, `takenBy` that table's full name (Task 4a); two live tables with keys "t1" refused by
   the database whatever their `short_name` says (Task 2); a file holding "T1" and "t1" refused on
   import (Task 6).
2. **Accented names**: "é" composed (`"\u00e9"`) and decomposed (`"e\u0301"`) are one key and
   one character (NFC, D3); "éclair 2" → "É2", "Café 3" → "C3" (Task 1). The test inputs stay
   English words (CLAUDE.md §3; `@waitron/shared` is a generic package): design §3.7's «Terraza 1»
   → «T1» is the same rule as "Terrace 1" → "T1", and its Spanish wording belongs to slice 2's
   strings.
3. **The five-character cap** with long numbers ("Room 123456" → "23456"), many words, and a
   typed six-character short name refused `floor_plan.invalid` (Tasks 1, 4).
4. **A name that is only digits** ("12" kept, "123456" → "23456"), and only symbols (Task 1).
5. **A swap of two tables' short names in one save, and then at the reset** — the save has no
   index to meet; the reset sets both tables' short names to `null` before applying them (Tasks 3,
   5a, 5c).
6. **A rename that keeps the short name**: a sent short name unchanged across a label change
   stays; a rename with none sent gets the new label's proposal (Tasks 3, 4a).
7. **A table whose new short name another zone's live table still holds**: the reset keeps both
   its old names and waits, and applies them once the other table gives it up (Tasks 5a, 5c).
8. **"Terrace 1" and "Table 1"** (design's own example): both propose "T1"; the second save with
   none sent saves "Table 1" with no short name (D4), and with "T1" sent is refused "Terrace 1
   already uses T1" in `params` (Tasks 3, 4a).
9. **A joined table today and a table renamed today** on the Ready bar: "T4+T5" and the saved
   short name (Task 8).
10. **An import of a file whose short names clash** (Task 6), and of one with none (Task 6).
11. **A full name equal to another table's short name.** Across zones D4's **taken** holds the
    full names of tables with no short name (Task 4a case 6). Inside one zone's save it does not:
    a table there left with none (its proposal taken) is not compared with the save's own short
    names, so "T1" beside a table labelled "T1" with no short name in the same zone can show two
    "T1"s. Accepted: it needs a table named exactly like another's short name, and slice 2's
    required field gives every table one.
12. **A save that sends no short name for a table it did not rename** keeps the stored one, and a
    sent short name cannot take it (Tasks 3, 4a; D4's kept class).

---

**Task order and why.** The rule first (Task 1, pure); the migration and the one write helper
(Task 2); the refusal and the pure resolution (Task 3); the save and the plan read on top of them
(Task 4a), the request's field (4b); the reset in four parts — the pure planner (5a), the
store's copy and writes (5b), swaps and waits (5c), Mark moved and the room fingerprint (5d); the configuration file (Task 6); the floor
read on the server (7a), the till's type and its fixtures (7b); the Ready bar's names (Task 8);
docs (Task 9); the LOOK (Task 10). Each leaves the tree green and is sized well under 100 tool
calls.

### Task 1: The short-name rule, in `@waitron/shared`

**Files:**
- Create: `packages/shared/src/table-short-name.ts`, `packages/shared/src/table-short-name.test.ts`
- Modify: `packages/shared/src/index.ts` (export beside `party-name.js`, `:65-72`),
  `packages/shared/src/index.test.ts` (one re-export case, as "re-exports the seating bound and its
  check", `:139`)

**Interfaces:**
- Produces: `SHORT_NAME_MAX = 5`; `shortNameLength(value: string): number`;
  `shortNameKey(shortName: string): string`; `proposeShortName(label: string): string` (D2, D3).
  Consumed by Tasks 2, 3, 5b, 6 and slice 2.

- [ ] **Step 1: Failing tests** in `table-short-name.test.ts`:
  1. `it.each` "proposes %s for %s" over every example in D2's steps 1–5 (inputs and outputs
     exactly as listed there, plus `"  terrace   7 "` → `"T7"`, `"T1"` → `"T1"`, `"t1"` → `"t1"`,
     `"ß ß ß 7"` → `"SSSS7"` (each "ß" upper-cases to "SS", so the initials are six characters and
     are cut to four to fit the number; ran on the draft), `"éclair 2"` → `"É2"`), each output also checked
     `shortNameLength(output) <= SHORT_NAME_MAX`.
  2. "keeps a name of four characters or fewer exactly, and shortens one of five" — `"Bar 2"`
     (five) → `"B2"`, `"Bar2"` (four) → `"Bar2"`: the boundary.
  3. "drops initials before digits, and keeps a long number's last five" — `"A B C D 12"` →
     `"ABC12"`, `"A B 1234"` → `"A1234"`, `"A 12345"` → `"12345"`, `"A 123456"` → `"23456"`.
  4. "counts a composed and a decomposed é as one character and one key" —
     `shortNameLength("e\u0301")` is 1, `shortNameKey("T\u00e9")` equals `shortNameKey("Te\u0301")`
     and `shortNameKey("TÉ")`.
  5. "folds case for the key, keeping the short name as given" — `shortNameKey("T1")` and
     `shortNameKey("t1")` are both `"t1"`.
  Index: "re-exports the table short-name rule" — the four names are the module's own.
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/shared exec vitest run src/table-short-name.test.ts src/index.test.ts`
  (no such module).
- [ ] **Step 3: Implement** D2's five steps and D3's key. Keep it one small function with named
  regular expressions; no Spanish in the file (the generic-package guard).
- [ ] **Step 4: Run; expect PASS** (read the `Tests` count), then the mutation check on this one
  file, which CI's `mutation-shared` job holds at a break of 90 (CLAUDE.md §2;
  `docs/developers/ci-and-gates.md`): `pnpm --filter @waitron/shared exec stryker run --mutate src/table-short-name.ts`.
  Expected: a score of at least 90. A surviving mutant is closed by a test that asserts
  something, never by an ignore comment; report one you cannot kill.
- [ ] **Step 5:** `pnpm --filter @waitron/shared typecheck`; `pnpm exec eslint packages/shared/src/table-short-name.ts packages/shared/src/table-short-name.test.ts packages/shared/src/index.ts packages/shared/src/index.test.ts`;
  `pnpm exec vitest run scripts/english-only.test.ts`; `pnpm format:check`; ledger;
  `git commit -s -m "A797-1: the rule that proposes a table's short name"`

### Task 2: The migration, and the one way a live table's two short-name columns are written

**Files:**
- Modify: `packages/db/src/schema/dining-tables.ts` (`shortName`, `shortNameKey`, the
  `uniqueIndex`, D1), `packages/db/src/schema/floor-plans.ts` (`floorPlanTables.shortName` after
  `label`, `:126`; `floorResetTables.shortName` after `label`, `:233`)
- Generate: `packages/db/drizzle/0191_table_short_names.sql`, `meta/0191_snapshot.json`,
  `meta/_journal.json` (drizzle-kit writes all three)
- Create: `packages/db/src/table-short-names.ts` (`shortNameColumns`, D3), exported from
  `packages/db/src/index.ts`; its test `packages/db/src/table-short-names.test.ts`
- Test: `packages/db/src/schema/dining-tables.test.ts` (new cases; one changed check),
  `packages/db/src/schema/floor-plans.test.ts` (one changed check)

- [ ] **Step 1: Failing tests.** In `dining-tables.test.ts` (its `seedTable`, `:41-53`, gains an
  optional short name written with `shortNameColumns`):
  1. "refuses two tables of one venue whose short names differ only in case" — "T1" then "t1" in
     `LOCATION_A`: the second insert is refused, `isRefusal(error, UNIQUE_VIOLATION)` and the
     message names `dining_tables.location_id, dining_tables.short_name_key`.
  2. "lets two venues use one short name, and any number of tables have none" — a second location
     (insert one as the file's `beforeAll` does) with "T1": accepted; two tables with no short name
     in `LOCATION_A`: accepted.
  In `table-short-names.test.ts`: "`shortNameColumns` writes the folded key beside the short
  name, and nulls for none" — `("TÉ1")` → `{ shortName: "TÉ1", shortNameKey: "té1" }`; `(null)` →
  both null.
  Changed checks (probe 1): "has only the columns today's plan needs" (`:81-94`) gains
  `short_name`, `short_name_key`; "round-trips a plan, reset rows, today's rows and the new
  columns" (`floor-plans.test.ts:304`) writes `shortName: "T1"` on the master (`:308`) and the
  first reset row (`:319`) and expects them back (`:340-346`; the reset row's
  `objectContaining`, `:369-377`).
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/db exec vitest run src/schema/dining-tables.test.ts src/schema/floor-plans.test.ts src/table-short-names.test.ts`.
- [ ] **Step 3: Implement** the schema change, then **generate, never hand-write**:
  `pnpm --filter @waitron/db db:generate --name table_short_names`. **Read the SQL.** It must be
  exactly D1's five statements. A `__new_` table, a `DROP TABLE`, or a column or index other than
  these is a **STOP**: report it with the file, do not edit it. If `main` has gained a 0191 since
  this plan, regenerate on top (CLAUDE.md §3), never renumber by hand. Then `shortNameColumns`.
- [ ] **Step 4: Run; expect PASS**, then the guard suites, from the root:
  `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts scripts/migrations-match-schema.test.ts scripts/migration-upgrade.test.ts scripts/id-columns-are-references.test.ts scripts/journal-monotonic.test.ts`
  (probe: 9 files, 498 tests, all passed; the upgrade test needs about 80 s) and
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts src/write-path.e2e.test.ts`
  (probe: 20 passed). `write-path.e2e.test.ts` passes **unedited**: if it fails, STOP. Then the db
  package: `pnpm --filter @waitron/db exec vitest run` (probe: the two changed checks were its
  only failures).
- [ ] **Step 5: Control by deletion, and the guard's limit.** In a scratch copy of the worktree
  (`git worktree add --detach <mktemp -d>/wt HEAD`, never by swapping files here; CLAUDE.md §4),
  delete the `uniqueIndex` line, regenerate, run case 1: it must fail on the insert being
  accepted; record the message in the ledger and remove the scratch worktree. Then add a third
  case, which passes and stays: "a key a writer did not fold is not refused" — a second row whose
  `short_name_key` is written by hand as `"T1"` beside a first row's `"t1"` is accepted. It pins
  D1's "nothing in the database ties the copy to the short name", so every writer goes through
  `shortNameColumns`.
- [ ] **Step 6:** typecheck db; eslint the changed files (not the generated SQL or JSON);
  `pnpm format:check`; ledger (both changed checks); `git commit -s -m "A797-1: tables get a short name, unique in the venue ignoring case"`

### Task 3: The refusal, and the rule that resolves a save's short names

**Files:**
- Modify: `apps/server/src/errors.ts` (beside `table.label_taken`, `:381-386`: the code and a
  one-line doc), `apps/server/src/management-api.ts` (status map, `:268`: `409`),
  `apps/dashboard/src/i18n/codes.ts` (beside `:578`, D11's two sentences)
- Create: `apps/server/src/table-short-names.ts` — it throws codes, so it carries
  `import "./errors.js";`, as every server file that throws one does (CLAUDE.md §3: "Every file
  that throws a code imports its registry"; e.g. `apps/server/src/tables.ts:1-3`) — and
  `apps/server/src/table-short-names.test.ts`
- Test: `apps/server/src/errors.test.ts` (one case beside "constructs zone.name_taken…", `:17`),
  `apps/dashboard/src/i18n/codes.test.ts` (one case: English and Spanish copy, not the generic)

**Interfaces:**
- Produces:
  ```ts
  export interface ShortNameEntry {
    label: string;
    shortName?: string;
    /** The stored plan table's label and short name, for an entry with an id. */
    stored?: { label: string; shortName: string | null };
  }
  /** taken: key → the full name of the table holding it (D4). Answers each entry's short name,
   * or null; throws floor_plan.invalid or table.short_name_taken. */
  export function resolveShortNames(
    entries: readonly ShortNameEntry[],
    taken: ReadonlyMap<string, string>,
  ): (string | null)[];
  ```
  Consumed by Task 4a.

- [ ] **Step 1: Failing tests** in `table-short-names.test.ts` (pure; no database):
  1. "proposes a short name for a new entry sent none" — `[{ label: "Terrace 1" }]`, nothing
     taken → `["T1"]`.
  2. "keeps a sent short name, trimmed" — `{ label: "Terrace 1", shortName: " Tb1 " }` → `"Tb1"`.
  3. "keeps a stored short name when the save sends none and the name is unchanged" —
     `{ label: "Terrace 1", stored: { label: "Terrace 1", shortName: "Tb1" } }` → `"Tb1"` (the
     proposal would be "T1"); with `stored.shortName: null` → `"T1"`.
  4. "proposes again for a renamed table sent none" — `{ label: "Terrace 9", stored: { label:
     "Terrace 1", shortName: "Tb1" } }` → `"T9"` (D4: a rename is proposed from the new name).
  5. "a sent short name does not take an untouched table's stored one" — `[{ label: "Terrace 1",
     stored: { label: "Terrace 1", shortName: "T1" } }, { label: "Table 1", shortName: "t1" }]`
     → `table.short_name_taken` `{ shortName: "t1", takenBy: "Terrace 1", field: "shortName" }`.
     And a new entry proposing "T1" beside that kept one gets `null`, the kept one `"T1"`.
  6. "refuses a sent short name another zone's table holds, ignoring case, naming that table" —
     taken `t1 → "Terrace 1"`, sent `"T1"` → `table.short_name_taken`
     `{ shortName: "T1", takenBy: "Terrace 1", field: "shortName" }` (Review focus 1, 8).
  7. "refuses the second of two entries sending one short name" — `"T1"` and `"t1"` → refused on
     the second, `takenBy` the first's label.
  8. "a sent short name wins over a proposal, and the proposal's table gets none" — `[{ label:
     "Terrace 1" }, { label: "Table 1", shortName: "T1" }]` → `[null, "T1"]` (sent values are
     resolved before proposals, D4).
  9. "gives none, never another, when the proposal is taken" — taken `t1`, `[{ label: "Table 1" }]`
     → `[null]`; and two entries proposing "W1" (`"Window 1"`, `"Wall 1"`) → `["W1", null]`.
  10. "lets two entries swap short names" — `[{ label: "A 1", shortName: "B1", stored: { label:
      "A 1", shortName: "A1" } }, { label: "B 1", shortName: "A1", stored: { label: "B 1",
      shortName: "B1" } }]` → `["B1", "A1"]`: sent entries are not kept, so their stored values
      claim nothing (Review focus 5).
  11. `it.each` "refuses %j as tables.0.shortName" — `""`, `"   "`, `"ABCDEF"` (six), and
      `"e\u0301"` six times (six characters, twelve code units before NFC) →
      `floor_plan.invalid` `{ field: "tables.0.shortName" }`; and `"ABCDE"` and `"e\u0301"` five
      times (five) are kept (Review focus 3).
  Assert the domain code and params on every refusal (CLAUDE.md §4), never `toThrow()` alone.
  `errors.test.ts`: "constructs table.short_name_taken with the short name, the table holding it
  and its field". `codes.test.ts`: the code resolves to D11's sentences in `en` and `es`.
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/server exec vitest run src/table-short-names.test.ts src/errors.test.ts` and
  `pnpm --filter @waitron/dashboard exec vitest run src/i18n/codes.test.ts`.
- [ ] **Step 3: Implement** D4's three classes in D4's order, and D11's registration. No till
  change (D11).
- [ ] **Step 4: Run; expect PASS** (read the counts).
- [ ] **Step 5:** typecheck server and dashboard; eslint; `pnpm format:check`; ledger;
  `git commit -s -m "A797-1: a save's short names are kept, proposed, or checked and refused when taken"`

### Task 4a: The floor-plan save fills and checks short names; the plan read carries them

**Files:**
- Modify: `apps/server/src/floor-plan.ts` (`PlanTable` `:26-37` and `planTables` `:205-214`;
  `ZonePlanSave` entry `:57-66` gains `shortName?: string`; `checkSave` `:348-394` — a
  `shortNamesTaken` beside `namesTaken` `:313-324`, and `resolveShortNames` after the labels'
  check, each entry with an `id` given `stored` from `masters`; `CheckedZonePlanSave` `:327-334`
  carries the resolved values; `masterColumns` `:396-398`; `writeSave`'s create and update
  `:546-561`; `changedShared` `:602-626`)
- Test: `apps/server/src/floor-plan.test.ts` (new `describe("short names")`; one changed check)

- [ ] **Step 1: Failing tests** (the file's `zone()`, `planned()`, `fresh()`, `liveTable`,
  `masterOf`, `check` and `refusal` helpers, `:59-300`). The file's cases share one database
  (`resetPerTest: false`, `:44`), so every short name a case sends or expects must be its own:
  build it from random characters, at most five (`` `S${randomUUID().slice(0, 4)}` ``), and a
  case about a proposal uses a label whose proposal is built the same way (`` `Q ${digits}` `` →
  `` `Q${digits}` ``, four random digits).
  1. "fills a new table's short name from its name when the save sends none" — label
     `` `Q ${digits}` ``: `readLayout` shows `` shortName: `Q${digits}` ``.
  2. "keeps a sent short name and reads it back" — sent `" Sab1 "`-style (spaces around a fresh
     value) → read trimmed.
  3. "keeps a stored short name when the save sends none and the name is unchanged" — save with a
     sent `S…`, then a second save of the same zone that sends none and changes only the seats:
     still `S…` (D4's kept class; before it, the proposal replaced it).
  4. "a sent short name does not take an untouched table's stored one" — the zone holds table A
     with `S…`; one save adds table B sending `S…` and sends A with none: refused
     `table.short_name_taken` with `takenBy` A's label.
  5. "refuses a short name another zone's plan table or live table uses, ignoring case" — another
     zone's master with short name `S…`, and (second half) another zone's live table with one
     (`liveTable`, then an update through `shortNameColumns`): sending the upper-cased value is
     refused `table.short_name_taken` with `takenBy` that table's full name (Review focus 1).
  6. "counts another zone's table with no short name by its full name" — another zone's live
     table labelled `` `Q${digits}` `` with no short name: a new table labelled `` `Q ${digits}` ``
     sent none gets `null` (its proposal equals that full name), and one sending
     `` `q${digits}` `` is refused with `takenBy` that label (D4's taken, D7; Review focus 11).
  7. "allows this zone's own live table's short name" — the zone's unlinked live table holds `S…`;
     a save of this zone sending `S…` passes (labels behave so, "allows this zone's unlinked live
     name…", `:1264`).
  8. "a rename with none sent takes the new name's proposal; one with its short name sent keeps
     it" (Review focus 6).
  9. "a short-name change alone moves the revision of the zone's other layouts" — two sets
     (`floor-plan-layouts.test.ts` shows the set-up; `changedShared`): change only `shortName`;
     the other set's layout revision moves.
  10. "saves a table with none when its proposal is taken" (Review focus 8): another zone's master
      holds the proposal; the save passes and `readLayout` shows `shortName: null`.
  Changed check (probe 1, 2): "does not read a save entry's liveTableId" (`:1225`; its `toEqual`
  at `:1247`): the case's input entry sends `shortName` = a fresh `` `S${randomUUID().slice(0, 4)}` ``
  (lower-case hex after an upper-case S, five characters, its own key in the shared database), and
  the whole-object `toEqual` gains `shortName: <that value>` exactly. Without a sent value the read
  is the proposal of the random label or `null` (probe 2), so it cannot be pinned. The sent field
  is a fixture change made so the one changed check stays exact. Ledger.
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/server exec vitest run src/floor-plan.test.ts`.
- [ ] **Step 3: Implement** D4 and D5. `shortNamesTaken` reads the venue's other zones' masters and
  live tables (plan tables first) into Task 3's `taken` map: each non-null short name by its key,
  and each null one's full name folded by `shortNameKey`.
- [ ] **Step 4: Run; expect PASS**, then every floor-plan and seed suite:
  `pnpm --filter @waitron/server exec vitest run src/floor-plan src/floor-today src/management-api src/service-delete src/demo-seed scripts/demo-seed/seed-floor`
  (Vitest matches by name; read the count: no file may report 0 tests run). Probe 2 ran a lenient
  proposal pass across these with one failure, the changed check above; it ran neither the kept
  class nor the full names in **taken**, which turn more proposals into a kept value or `null`,
  never into a refusal. Any other failure is a STOP.
- [ ] **Step 5:** typecheck server; eslint; format check; ledger; `git commit -s -m "A797-1: the floor-plan save keeps, fills and checks each table's short name"`

### Task 4b: The save's request reads `shortName`

**Files:**
- Modify: `apps/server/src/management-api.ts` (`parseZonePlanSave` `:424-458`, D4's parse)
- Test: `apps/server/src/management-api.test.ts` (beside the two `tables.0.partKeys` refusals at
  `:3321`, `:3331`; ran `grep -n "management.request_invalid"`)

- [ ] **Step 1: Failing tests:** `PUT …/floor-plan` with `shortName: 5` → `400
  management.request_invalid` `{ field: "tables.0.shortName" }`; with `shortName: null` → `200`,
  saved as if absent (the read then shows the proposal or the kept value); with `shortName:
  "Sx1"`-style fresh value → `200`, and the read shows it (the parser passes it through; before
  the change it drops it).
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/server exec vitest run src/management-api.test.ts`.
- [ ] **Step 3: Implement** the parse.
- [ ] **Step 4: Run; expect PASS.**
- [ ] **Step 5:** typecheck server; eslint; format check; ledger; `git commit -s -m "A797-1: the floor-plan request carries a table's short name"`

### Task 5a: The reset planner gives a table both its names, or waits

**Files:**
- Modify: `apps/server/src/floor-reset-plan.ts` (`Target` `:15-24`, `LiveTable` `:26-47`,
  `Renaming` `:64-68` gains `currentShortKey`, `planReset`'s input, its fixed in-use sets and its
  fixed-point loop `:70-149` with separate short-key sets, `targetsFromMaster` `:195-247`)
- Test: `apps/server/src/floor-reset-plan.test.ts` (new cases; builders `t` and `l`, `:11-33`,
  and the inputs at `:294`, `:317`, `:332` gain `shortName: null` — Fixture-only, probe 2)

**Interfaces:**
- Produces: `Target.shortName`, `LiveTable.shortName` (`string | null`);
  `planReset({ …, shortNameKeysElsewhere: ReadonlySet<string> })` (required); `apply`'s shape
  unchanged (D6). Consumed by Tasks 5b and 5c.

- [ ] **Step 1: Failing tests:**
  1. "waits, keeping both names, while another zone's table holds the target's short name" —
     target `t("a", "Terrace 1", { shortName: "T1" })`, live `l("a", "Old", { shortName: "O1" })`,
     `shortNameKeysElsewhere: new Set(["t1"])` → `apply` `[{ target, label: null }]`, `pending`
     holds it. With the set empty → `label: "Terrace 1"`.
  2. "compares short names ignoring case" — the same with `"T1"` held elsewhere as key `"t1"` and
     the target's `"t1"`.
  3. "lets two tables swap short names in one reset" — a: T1→T2, b: T2→T1, labels unchanged →
     both applied (Review focus 5).
  4. "a table that waits keeps its short name in use" — a held table `l("b", "B", { held: true,
     shortName: "T1" })` and another target wanting `T1` → the second waits.
  5. "a table that waits for its label keeps its short name in use, so another target wanting it
     waits" — table a, short "T1", wants label "X" which another zone holds (`takenElsewhere`
     `{"X"}`); table b wants short "T1" with a free label → a waits (label taken), and so does b
     (a keeps "T1"). Before the loop's short twin, b is applied and the store's unique index
     refuses it (D6).
  6. "a label and a short name never block each other" — table a's label "12", table b's target
     short name "12" → b applied (separate sets).
  7. "a removal frees neither name this pass" — as the label case does for a removal (`:107`).
  8. `targetsFromMaster` "copies the master's short name, and gives a removal its live table's" —
     extend its existing case's inputs and expectations by `shortName`.
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/server exec vitest run src/floor-reset-plan.test.ts`.
- [ ] **Step 3: Implement** D6's planner part (fold with `shortNameKey`).
- [ ] **Step 3b: The store's read side, so the tree compiles.** In `catchUpPass`
  (`floor-today-store.ts`): `venueTables` (`:431-440`) selects `shortName`;
  `shortNameKeysElsewhere` is built beside `takenElsewhere` (`:443-445`) from other zones'
  tables; each `LiveTable` (`:544-556`) and each reset-row `Target` (`:418-428`) carries its
  `shortName`; `zoneTables` (`:330-339`) selects it for `targetsFromMaster`. Nothing writes a
  short name yet (reset rows hold none until Task 5b), so no behaviour changes.
- [ ] **Step 4: Run; expect PASS**, then `pnpm --filter @waitron/server typecheck` and
  `pnpm --filter @waitron/server exec vitest run src/floor-today-store.test.ts src/floor-today-mark-moved.test.ts`
  (unchanged behaviour).
- [ ] **Step 5:** eslint; format check; ledger (the Fixture-only builders); `git commit -s -m "A797-1: a reset gives a table its new names together, or waits for both"`

### Task 5b: The reset copies short names onto the live tables

**Files:**
- Modify: `apps/server/src/floor-today-store.ts` (`targetRow` `:94-101`; `resetZoneFor`'s master
  map `:233-245`; the create `:682-697`; the apply `:698-700`), `apps/server/src/testing/live-table.ts`
  (`createTable` gains `shortName?: string`, D12)
- Test: `apps/server/src/floor-today-store.test.ts` (new `describe("short names at a reset")`;
  `MasterTable` and `insertMaster`, `:111-133`, gain an optional `shortName`)

- [ ] **Step 1: Failing tests** (`v.table`, `masterOf`, `editMaster`, `reset`, `tableRow`,
  `pendingRows`):
  1. "copies each master's short name onto its live table, with its folded key" — master
     `{ label: "Sn 1", shortName: "Sn1", live: t1 }` → `tableRow(t1)` has `shortName: "Sn1"`,
     `shortNameKey: "sn1"`.
  2. "makes a new table with its master's short name" — a master no live table follows → the
     created row has both columns.
  3. "a master with no short name leaves its live table with none" — and a live table that had
     one loses it (D6).
  4. "changes only a case: no wait" — master `"SN1"` over live `"Sn1"` → applied at once, key
     unchanged.
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/server exec vitest run src/floor-today-store.test.ts`.
- [ ] **Step 3: Implement** the copy (`targetRow`, the master map), the create and the apply with
  `shortNameColumns`, and `createTable`'s input.
- [ ] **Step 4: Run; expect PASS**, then every reset and today's-plan suite:
  `pnpm --filter @waitron/server exec vitest run src/floor-today src/floor-reset src/floor-plan src/table-removal src/floor-delete src/zone`
  (read the counts). Probe 2 ran this copy across them green; a failure is a STOP.
- [ ] **Step 5:** typecheck server; eslint; format check; ledger; `git commit -s -m "A797-1: a reset copies each table's short name onto today's tables"`

### Task 5c: A reset swaps short names, and waits while another table holds one

**Files:**
- Modify: `apps/server/src/floor-today-store.ts` (after the labels' spare step, `:672-680`: set
  both short-name columns to `null` on every applied table whose short-name key changes, D6)
- Test: `apps/server/src/floor-today-store.test.ts` (in Task 5b's `describe`)

- [ ] **Step 1: Failing tests:**
  1. "swaps two tables' short names" — as "swaps two tables' names" (`:461-478`), on short names:
     both end swapped. Before the null step the second apply meets the unique index (the case
     fails with the engine's `UNIQUE constraint failed: dining_tables.location_id,
     dining_tables.short_name_key`; record it in the ledger) (Review focus 5).
  2. "keeps both old names while another zone's table holds the new short name, and takes them
     once it is free" — another zone's live table with short `Sx1` (`createTable`, D12); this
     zone's master wants `Sx1`: after the reset the table keeps its label and short name and its
     row is pending (`pendingRows`); change the other table's short name (through
     `shortNameColumns`); the next catch-up (`catchUpZone`) applies both new names (Review focus 7).
  3. "a table waiting for its label keeps its short name, and the table wanting that short name
     waits too" — the store-level twin of Task 5a's case 5: table A (short `Sy1`) whose master
     renames it to a label another zone's table holds, and table B whose master gives it `Sy1`:
     after the reset both are pending, A still `Sy1`, B its old short name, and no unique error.
     Free the label; catch up: A takes its label and new short name, then B takes `Sy1` (one or
     two catch-ups; assert the end state).
- [ ] **Step 2: Run; expect FAIL** on case 1 (cases 2 and 3 pass if Task 5a's planner is right;
  they pin the store against it).
- [ ] **Step 3: Implement** the null step.
- [ ] **Step 4: Run; expect PASS**, then Task 5b's Step 4 command.
- [ ] **Step 5:** typecheck server; eslint; format check; ledger; `git commit -s -m "A797-1: a reset swaps tables' short names without meeting the unique index"`

### Task 5d: Mark moved and the room's revision see a short name

**Files:**
- Modify: `apps/server/src/floor-today-mark-moved.ts` (`leaveHere`, `:136-170`; the group read
  `:152-161` selects both short names; the comparison `:166`), `apps/server/src/floor-revision.ts`
  (`roomPrints`, `:68-90`)
- Test: `apps/server/src/floor-today-mark-moved.test.ts` (beside "keeps a rename the dashboard gave
  it, and its place", `:868`), `apps/server/src/floor-revision.test.ts` (beside "a catch-up that
  only hides a table moves the revision by one", `:165`; the one suite naming `roomPrints`, ran
  `grep -ln roomPrints apps/server/src/*.test.ts`)

- [ ] **Step 1: Failing tests:**
  1. "Leave it here keeps a row waiting whose table has its new label but not its new short name"
     — set up as `:868` does, with the master changing only the short name: after `leaveHere` the
     row is still pending and placed, and the next catch-up gives the table its short name. Before
     the change the row is ended (labels equal) and the short name never arrives.
  2. "Leave it here keeps waiting for a case-only change" — the same with `"Sn1"` → `"SN1"`: the
     row waits and the catch-up stores `"SN1"` (the comparison is `===` on stored values, D6).
  3. "a catch-up that changes only a short name moves the revision by one" — as the case at `:165`
     does for hiding a table: a master whose only change is its short name, a floor read, the
     revision moves by one. Before the change the fingerprint (`floor-revision.ts:68-90`) holds no
     short name, so it stays.
- [ ] **Step 2: Run; expect FAIL** on all three.
- [ ] **Step 3: Implement** D6's two changes.
- [ ] **Step 4: Run; expect PASS**, then Task 5b's Step 4 command.
- [ ] **Step 5:** typecheck; eslint; format check; ledger; `git commit -s -m "A797-1: Leave it here and the room's revision see a table's short name"`

### Task 6: A configuration file carries short names

**Files:**
- Modify: `packages/db/src/configuration-transfer.ts` (`dining_tables`'s `omit`, `:58-62`;
  `validateCoreConfiguration`, `:10-38`; `afterImport`), `packages/db/src/table-short-names.ts`
  (`storeTableShortNameKeys(tx)`: read every row's id and short name, fold in JavaScript, and
  set the keys in batched updates, D10)
- Test: `packages/db/src/configuration-transfer.test.ts` (validate cases; "CORE_CONFIGURATION_TRANSFER"
  `describe`, `:203`, gains the omit and the hook), `apps/server/src/configuration-transfer.test.ts`
  (one round-trip case beside the products' key case, `:3640-3684`),
  `packages/composition/src/composition.test.ts` (beside `:194`: `dining_tables`'s `omit`
  contains `short_name_key`)

- [ ] **Step 1: Failing tests:**
  1. Validate: "refuses a table short name that is blank, too long or not text" (`it.each` over
     `""`, `"ABCDEF"`, `5`) → `setup.request_invalid` `{ field: "dining_tables.short_name" }`, and
     the same for `floor_plan_tables`; "accepts a short name that is null or absent".
  2. Validate: "refuses two tables whose short names differ only in case" — `"T1"` and `"t1"` in
     `dining_tables`, then in `floor_plan_tables` (Review focus 10).
  3. Round trip (server): a venue whose zone was saved with a sent short name `"Rt1"` (through
     `saveLayout`, then a reset so the live table has it): the bundle's `dining_tables` and
     `floor_plan_tables` rows carry `short_name: "Rt1"` and no `short_name_key`; imported into the
     target venue, the live table has `short_name: "Rt1"`, `short_name_key: "rt1"`; a bundle
     supplying `short_name_key` is refused `setup.request_invalid`
     `{ field: "dining_tables.short_name_key" }` (already, by the omit).
  4. "imports a file with no short names, at this version, with none" — the bundle's rows with
     `short_name` deleted → the imported tables have both columns null (D10: a file from before
     this slice is refused by version instead).
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/db exec vitest run src/configuration-transfer.test.ts`,
  `pnpm --filter @waitron/server exec vitest run src/configuration-transfer.test.ts` and
  `pnpm --filter @waitron/composition exec vitest run`.
- [ ] **Step 3: Implement** D10.
- [ ] **Step 4: Run; expect PASS**, then `pnpm --filter @waitron/provisioning exec vitest run`
  (the import's own suites) and `pnpm exec vitest run scripts/id-columns-are-references.test.ts`.
- [ ] **Step 5:** typecheck db, server, composition; eslint; format check; ledger;
  `git commit -s -m "A797-1: a configuration file carries each table's short name"`

### Task 7a: The floor read carries each table's short name

**Files:**
- Modify: `apps/server/src/working-order.ts` (`TableState` `:8189-8222` gains `shortName:
  string`, documented as D7 says; the query `:8262`; the row type `:8240-8252`; the mapping
  `:8366-8368`)
- Test: `apps/server/src/floor-today-state.test.ts` (one of the suites reading
  `listTablesWithState` rows by field, ran `grep -ln "listTablesWithState\|tablesWithState("
  apps/server/src/*.test.ts`; new case beside "gives each planned table its today's row…", `:86`)

- [ ] **Step 1: Failing test:** "names each table by its short name, or by its full name when it
  has none" — a table with short name `"Fr1"` (`createTable`, D12) and one with none: the read
  answers `shortName: "Fr1"` and `shortName: <its label>`; and through `GET /api/tables/state`
  (the route suite's own fixture) the JSON carries the key.
- [ ] **Step 2: Run; expect FAIL.** **Step 3: Implement** D7 on the server.
- [ ] **Step 4: Run; expect PASS**, then probe 1's 142 suites by name filter:
  `pnpm --filter @waitron/server exec vitest run src/till-api src/working-order src/floor src/tables src/parties`
  (probe 1: no server case pinned the read's whole shape).
- [ ] **Step 5:** typecheck server; eslint; format check; ledger; `git commit -s -m "A797-1: the till's floor read carries each table's short name"`

### Task 7b: The till's type, and every test table it builds

**Files:**
- Modify: `apps/till/src/api/client.ts` (`TableState`, `:2204`: `shortName: string`, its doc as
  D7's), and the test files `pnpm --filter @waitron/till typecheck` then lists (probe: 82 sites in
  71 files: 69 test files and the two `apps/till/test/` fixtures)

- [ ] **Step 1:** add the field; run `pnpm --filter @waitron/till typecheck 2>&1 | grep "error TS" > <scratch outside the worktree>/till-tsc.txt`;
  expect only "Property 'shortName' is missing" errors in test files and `apps/till/test/*`
  fixtures (any error in a source file is a STOP).
- [ ] **Step 2: Fixture-only edits.** In each listed literal, beside its `label:`, add `shortName`
  **equal to the label the object ends with**: a literal label → the same literal; a builder's
  parameter → that parameter; a builder spreading `over` after its defaults →
  `shortName: over.label ?? <default label>` placed before `...over` (so a case's own `shortName`
  still wins). A small script over the error list is fine (kept outside the worktree); read its
  diff. Equal to the label, every check stays as it was: nothing in the till reads `shortName`
  before Task 8 (ran: `grep -rln "shortName" apps/till/src` on `main` → only
  `src/widgets/till-shell.test.ts`, whose `shortName` is an unrelated local, `:1947`; re-run and
  confirm).
- [ ] **Step 3: Run** `pnpm --filter @waitron/till typecheck` → 0 errors; then, memory first
  (`memory_pressure | grep free`), exactly the files Step 2 edited, and read the count:
  the test files in the error list (`cut -d'(' -f1 <scratch>/till-tsc.txt | sort -u | grep '\.test\.ts$'`)
  **plus** every test file importing the two fixtures the list names, `test/allergy-app-fixture.ts`
  and `test/bill-pay-app.ts` (`grep -rlE 'test/(allergy-app-fixture|bill-pay-app)(\.js)?"' apps/till/src`).
  Put the names in a zsh array (`files=(${(f)"$(sort -u <a> <b>)"})`, not an unquoted string,
  which zsh does not split) and run `pnpm --filter @waitron/till exec vitest run $files`. At
  `6c101a642` that was 69 + 13 files, none in both (ran), so expect `Test Files 82 passed (82)`;
  recount if the lists differ. Expected: all pass, unchanged. CI runs the till's whole suite.
- [ ] **Step 4:** eslint the changed files; format check; ledger (the Fixture-only list, by file);
  `git commit -s -m "A797-1: the till's floor read type carries the short name"`

### Task 8: The Ready bar shows short names; a join shows its tables' short names

**Files:**
- Modify: `apps/till/src/state/floor-today.ts` (`tightName`, D8, beside `shownUnder` `:70-72`),
  `apps/till/src/state/table-signals.ts` (`readyTables`, `:72`)
- Test: `apps/till/src/state/floor-today.test.ts` (new cases), `apps/till/src/state/table-signals.test.ts`
  (two changed checks, one new case), `apps/till/src/screens/till-floor-screen.ready-bar.test.ts`
  (one new case)

- [ ] **Step 1: Failing tests:**
  1. `tightName` "uses the saved short name, whatever today's name" — `shortName: "T2"`,
     `today.name: "Window"` → `"T2"`.
  2. `tightName` "names a table of today's join by the join's tables' short names, in number
     order" — three tables, two with `joinId: "j1"` and short names "T10" and "T9", join name
     "Birthday" → `"T9+T10"` for either; the third (no join) → its own.
  3. Changed checks in `table-signals.test.ts` (probe): "names a party at joined tables by
     today's join name, once" becomes "names a party at one of today's joins by its tables' short
     names, once" → `"T5+T6"`; "uses today's name, not the party's given name" becomes "uses the
     saved short name, not today's name or the party's" → `"T2"` (Reason: D8; slice 5's D5).
  4. New in `table-signals.test.ts`: "names a party at two separate tables by both short names" —
     short names "T5", "T6", no join → `"T5+T6"`.
  5. New in the ready-bar suite: "the bar shows each table's short name, not its full name" —
     label "Table 2", `shortName: "T2"` → the entry reads "T2 · 3" and Open ›'s name is "Open
     T2" (slice 5's D5 builds the name from the same entry name). English test text only
     (CLAUDE.md §3). The suite's other cases keep their
     text: their tables' short names equal their labels (Task 7b).
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/till exec vitest run src/state/floor-today.test.ts src/state/table-signals.test.ts src/screens/till-floor-screen.ready-bar.test.ts`.
- [ ] **Step 3: Implement** D8 (`mergeLabel` from `@waitron/ui`, already imported there, `:9-15`).
- [ ] **Step 4: Run; expect PASS**, then the five suites the probe ran (`src/state/table-signals
  src/screens/till-floor-screen.ready-bar src/screens/till-floor-screen.refresh
  src/screens/till-floor-screen.a11y src/till-app-device-zones`): expected all pass.
- [ ] **Step 5:** typecheck till; eslint; format check; ledger (both changed checks);
  `git commit -s -m "A797-1: the Ready bar names tables by their short names"`

### Task 9: Docs, the user guides and the backlog follow the code

**Files:**
- Modify: `apps/server/src/guide/en/table-service.md` and `apps/server/src/guide/es/table-service.md`
  ("See which tables have food ready" `{#ready-bar}`, en `:137-145`, es `:141-149`),
  `docs/developers/conventions-data.md` ("A zone's floor plan: sets, layouts and today's plan",
  `:1832`), `docs/backlog.md` (the two A797 entries, `:120-128` and `:2771-2780`),
  `docs/backlog/till.md` (A797's entry, `:1046-1060`),
  `docs/superpowers/specs/2026-10-18-a797-device-screens-design.md` (§5's short-name point, §9's
  joined-table line), this plan's slice 1 outline (one line: expanded below)
- Test: `apps/server/src/guide-content.test.ts`, `scripts/guide-links.test.ts`

The user sees two things in this slice: the Ready bar's names, and (only through the API until
slice 2) a refusal. So the guides change only where they show the bar's example.

- [ ] **Step 1: Guides.** English: the example "**Ready · Table 2 · 3**" becomes "**Ready · T2 ·
  3**", and one sentence after it: "Each table is shown by its short name, such as T2 for Table
  2; a table joined to another for today shows both, such as T4+T5." Spanish: «**Listo · Mesa 2 ·
  3**» becomes «**Listo · M2 · 3**», and «Cada mesa aparece con su nombre corto, por ejemplo M2
  para Mesa 2; una mesa unida a otra hoy muestra las dos, por ejemplo M4+M5.» No guide explains
  where the short name is set: that is slice 2's (the floor-plan editor's section).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and
  `pnpm exec vitest run scripts/guide-links.test.ts`; PASS.
- [ ] **Step 3: conventions-data.md**, in the floor-plan section, one paragraph: a table's short
  name (`short_name`) is on the plan's tables, the reset rows and the live tables; the live
  tables' folded copy `short_name_key` is unique per venue (`dining_tables_location_short_name_key_uq`)
  and written only through `shortNameColumns` (`packages/db/src/table-short-names.ts`) — **nothing
  in the database ties the copy to the short name** (a writer that skips the helper is not
  refused; Task 2's third case); the save keeps the stored one of a table it did not rename, proposes one otherwise when it is
  not sent, and checks a sent one
  across the venue's other zones (`resolveShortNames`, `apps/server/src/table-short-names.ts`); a
  reset gives a table its new label and short name together, or waits for both; a configuration
  file carries `short_name` and the import sets the key. Also, in the same section's sentence on
  renames, "as a dashboard rename does" covers a short name.
- [ ] **Step 4: Backlog.** Both A797 entries and `till.md`'s: slice 1 in review with this plan
  linked; slice 2 next. One new short entry in the till area, if the backlog does not already
  carry it (ran 2026-10-25: `grep -n "short name" docs/backlog.md docs/backlog/*.md` → only
  `till.md:1057`'s slice list and an unrelated fiscal line): **short names on the floor map where
  a full name does not fit, and on printed kitchen tickets** (design §3.7, §9: later owner
  choices, not built by A797). Take its number from `~/waitron-campaign-shared/next-item-number`:
  read it, use it, write the next number back (it read `A1100` on 2026-10-25). The owner FYIs
  (Closing slice 1) go in the PR, not the backlog. Design file: under §5's short-name point and
  §9's joined-table line, one dated sentence each pointing at this plan's D4 and D8 (a design
  records what was decided when; it gets a dated pointer, not a rewrite).
- [ ] **Step 5: Check** `pnpm exec prettier --file-info docs/backlog.md` prints `"ignored": true`
  (wrap by hand); `pnpm format:check` for the guide files.
- [ ] **Step 6: Commit** `git commit -s -m "docs: A797-1 — guides, conventions and backlog for table short names"`

### Task 10 (visual): LOOK at short names on the Ready bar

- [ ] **Step 1: Start the stack** `wa-wt demo waitron-feat-a797-1-short-names-data`; `wa-wt ls`
  for the URLs. The demo's tables are already short (`1`–`8`, `T1`–`T5`, `B1`–`B3`), so their
  short names equal their names.
- [ ] **Step 2: Make one long.** In the dashboard's floor-plan editor rename Dining room's table
  `1` to "Window 1" and save (the save proposes "W1", D4); on a till, Update layout for that zone
  (or Reset to plan) so the live table takes it (D6). Check with
  `sqlite3 <the worktree's venue folder>/venue.db "select label, short_name, short_name_key from dining_tables"`
  (read-only; `wa-wt ls` names the folder) and write the rows in the ledger.
- [ ] **Step 3: Look** with the workspace's Playwright Chromium (script kept in
  `/Users/clintongormley/waitron-campaign-c/a797-1-scripts/`), a handheld at 390 px, light and
  dark, English and Spanish: seat Window 1 and another table, send a dish to each, mark them
  ready; the bar reads "Ready · W1 · 1 · …"; join two tables for today on the till and **give the join a
  today's name, "Birthday"**, then make food ready there: the bar reads one entry "T1+T2" (before
  this slice it read "Birthday", so the look tells old from new; D8). The table's own header still shows "Window 1".
- [ ] **Step 4: Save** the PNGs under `/Users/clintongormley/waitron-campaign-c/a797-1-shots/`,
  open each, describe them in the ledger and the PR body.
- [ ] **Step 5: Stop** what you started: the script by its recorded process id, then
  `wa-wt down waitron-feat-a797-1-short-names-data`.

### Closing slice 1

- Focused runs per task as above; CI runs the package suites, coverage and the shared mutation
  job. Read the `changes` job's outputs and the coverage jobs of db, shared, server, till,
  dashboard, composition and provisioning on the current head before calling the PR green.
- `/finish-branch` with this plan named. Review path **FULL**: two Codex run-it reviews, the
  second told to set this plan's checklist aside and test what it does not name.
- PR body. **First line: "No venue reset needed."** Then: **Migration** (D1's five statements,
  quoted, and the measured reason for nullable); **Contract change** (`TableState.shortName` on
  the floor read and in the till's type; `PlanTable.shortName` on the plan read; the save's
  optional `shortName`; the refusal `table.short_name_taken`); **Changed test checks** (from the
  ledger: Task 2's two, Task 4a's one, Task 8's two); **Fixture-only** (Task 4a's sent short name
  in "does not read a save entry's liveTableId", Task 5a's builders, Task 7b's till builders by
  file); **Decisions** D1–D13 in one line each; **What a person sees**: the
  Ready bar's short names (the guides' example changed), nothing on the dashboard until slice 2;
  **LOOK**.
- **Owner FYI** (one line each in the PR and the lane's questions file, not questions): D4 (a
  save that sends none keeps an unrenamed table's short name, and a clashing proposal gives none
  rather than refusing a save that sent none), Review focus 11 (the one-zone gap), D8 (a today's join
  shows its tables' short names, not its today's name), D9, D11 (the till gets no copy for a
  refusal it cannot receive), D13.
- After merge: delete the branch local and remote and check the remote one is gone; update the
  ledger; then slice 2.

## Slice 2 — Short names, dashboard (one PR, branch `feat/a797-2-short-names-dashboard`)

**What it changes.** The dashboard's floor-plan editor gets a **Short name** field («Nombre
corto», Q51 (g)) under each table's Name (picture 09), in the selected table's form, in Add tables
and in Add joined table. The field is filled from the name by slice 1's rule ("T1" for "Terrace 1")
and follows the name until someone types over it. Every save sends every table's short name, so
the server checks each one. A short name another table already uses is refused under the field,
"Terrace 1 already uses T1" («Terraza 1 ya usa T1»). Then A1110: a "+" in a short name reads
like tables joined for today ("T1+T2"). This plan's recommended answer is the last code task, so
it can be dropped.

**Review path: LIGHT.** No server, schema, read or route changes. Slice 1's save already reads
an optional `shortName` (`parseZonePlanSave`, `apps/server/src/management-api.ts:443`, `:456`)
and refuses `table.short_name_taken` with 409 (`:269`). The plan read already carries
`PlanTable.shortName: string | null` (`apps/server/src/floor-plan.ts:31`). Every file this slice
changes is under `apps/dashboard/src/`, the guides or `docs/`, and no risk trigger applies (read).
**Migration: none.** If a task finds it needs one, or a server change, that is a STOP: report it.

How claims are marked in this section: **(ran)** means run on 2026-10-26 against `main` at
`f3084c64b` (this worktree's base); **(read)** means read in the code at that commit, not run. The
probes ran in a throwaway worktree (`git worktree add --detach /tmp/a797-2-probe.YlSp/wt
f3084c64b`), removed afterwards; their logs stay in `/tmp/a797-2-probe.YlSp/` (`tsc.txt`,
`run1.txt`–`run3.txt`). None of the probe code is in this branch.

### What the dashboard has today (read; each line opened)

| Where | What it does today |
| --- | --- |
| `packages/shared/src/table-short-name.ts:1-43` | `SHORT_NAME_MAX` (5), `shortNameLength`, `isShortNameShaped` (not blank, at most 5 characters), `shortNameKey` (folded), `proposeShortName`; re-exported at `packages/shared/src/index.ts:73-79` |
| `apps/dashboard/package.json:24` | depends on `@waitron/shared`; the floor-plan code already imports it (`apps/dashboard/src/screens/floor-plan-draft.ts:1`, `floor-plan-tables-panel.ts`) |
| `apps/dashboard/src/api/client.ts:686-705` `FloorPlan` | the plan read's type; its tables have **no** `shortName`, though the server sends one |
| `client.ts:712-724` `FloorPlanSave` | the save's body; no `shortName` |
| `client.ts:675-681` `DashboardTable` | `GET /management-api/tables`: id, label, zoneId, planTableId, createdAt; **no short name** (the editor's `venueTables`, `floor-plan-editor.ts:362`, `:598`) |
| `floor-plan-draft.ts:9-21` `DraftTable`; `:57-71` `draftFromPlan`; `:73-86` `saveFromDraft` | the draft's table, read from the plan and sent back; no short name |
| `floor-plan-draft.ts:127-160` `sameTable`/`sameDraft` | what the Save button's state and the leave guard compare (the editor's scope, `floor-plan-editor.ts:472-480`) |
| `floor-plan-draft.ts:162-174` `checkDraft` | the editor's own check at Save: `label_missing`, `label_repeated`, `parts_too_few` |
| `floor-plan-draft.ts:185-191` `patchTable`; `:278-324` `addTables`, `addJoinedTable` | panel edits; the two dialogs' adds |
| `apps/dashboard/src/screens/floor-plan-table-panel.ts:234-242` | the Name field (`name="table-name"`, `required`), patched under merge key `label:<key>`; then the Seats/Shape/Moveable row (`:243-268`) and a joined table's Made of (`:269`) |
| `floor-plan-editor.ts:280-285` `.table-slot` | the form's reserved area: `calc(3 * var(--wt-field-height) + 4 * var(--wt-space-3))`, so the list stays still between plain and joined tables; "errors scroll inside" |
| `floor-plan-editor.ts:105` `FloorPlanField`; `:139-145` `SERVER_FIELDS`; `:153-162` `tableProblem` | which panel fields a mark may name; the server's field names mapped to them; the marked table's own problem, which the mark follows |
| `floor-plan-editor.ts:171-182` `trimLabels` | after a save, trims a label that was sent padded and is unchanged since |
| `floor-plan-editor.ts:716-735` `#markCheck`, `#markProblem` | turn `checkDraft`'s answer into a mark ("check": holds Save disabled, `:1263-1269`) |
| `floor-plan-editor.ts:773-807` `#placeRefusal` | puts a refusal under a field: `table.label_taken` by its `label`, `floor_plan.invalid` by `tables.<i>.<field>` in the body it sent, `table.booked` by live table. Slice 1 added `:774-778`: `table.label_taken` **with** `takenBy` shows `floor_plan_editor.label_shown_as_short_name` |
| `floor-plan-editor.ts:1263-1269` | Save is disabled while unchanged, saving, reloading, under a check's mark or under refused typed text; **never by a refusal's mark** (design-system.md → Forms: "an error that comes back from a request … never disables the action") |
| `floor-plan-editor.ts:1022-1046` `#listMarks` | the tables list shows any standing mark under the table's name, whatever field it names |
| `apps/dashboard/src/screens/floor-plan-add-tables.ts` | Automatic naming: a prefix and a one-line preview "Terrace 11 to Terrace 15" (`#hint`, `:226-233`; `[data-preview]`, `:302`); Custom: one `table-name` field per table (`:303-316`), checked at Save against the draft and `takenElsewhere` (`:173-192`) |
| `apps/dashboard/src/screens/floor-plan-add-joined-table.ts` | Name (`:263-270`), Seats, Made of; checks at Save (`:174-192`); adds through `addJoinedTable` and places it (`:198-227`) |
| `floor-plan-editor.unsaved.test.ts`, `floor-plan-add-tables.unsaved.test.ts`, `floor-plan-add-joined-table.unsaved.test.ts` | the three leave-guard suites; the table panel has none of its own, it is inside the editor's scope |

The server side this slice relies on (read): `resolveShortNames`
(`apps/server/src/table-short-names.ts:16-61`) claims kept values, then **sent** ones (trimmed;
blank or longer than five → `floor_plan.invalid` `{ field: "tables.<i>.shortName" }`, `:45-47`;
a key already claimed → `table.short_name_taken` `{ shortName, takenBy, field: "shortName" }`,
`:48-55`, `takenBy` the label of the table that holds it), then proposals. The claimed set
starts from the venue's **other zones** (`otherZonesTaken`, `floor-plan.ts:323-343`). And
`floor-plan.ts:427-435` refuses `table.label_taken` with `takenBy` only for a table **left with
no short name**.

### Plan decisions for slice 2

- **D1. The proposal is slice 1's own function, imported, not copied.** `proposeShortName`,
  `isShortNameShaped`, `shortNameKey`, `shortNameLength` and `SHORT_NAME_MAX` already live in
  the browser-safe `@waitron/shared` (slice 1 D2, table above), which the dashboard already
  depends on and imports. Nothing moves and nothing is copied. The server's checks
  (`table-short-names.ts:1`) and the dashboard's use the same functions.
- **D2. The draft holds a short name for every table, and every save sends every one.**
  `DraftTable.shortName: string`. `draftFromPlan` fills it with the stored short name, or, when
  the plan read says `null`, the table's proposal (slice 1 D5: "Slice 2's field shows it, or the
  proposal when it is `null`"). `FloorPlanSave`'s tables gain a required `shortName: string`, and
  `saveFromDraft` sends it trimmed. So every short name in a dashboard save is a **sent** one
  (`table-short-names.ts:42-57`); the server's kept and proposed classes serve only senders that
  send none (the seed, the API). **The consequence, an Owner FYI:** a table stored with none
  (made before slice 1, or whose proposal was taken) shows its proposal. The next save of its
  zone sends that proposal and is refused under that table's field when another table holds it.
  The person types another to save the zone. This is design §3.7 as written: "When the automatic
  short name clashes, it is still proposed in the field and the save refuses it the same way;
  nothing picks another one silently". Slice 1 D4 and Review focus 11 counted on it ("slice 2's
  required field gives every table one").
- **D3. A short name follows its full name until someone types it.** A new pure helper,
  `followName(shortName, oldLabel, newLabel)`: when `shortName === proposeShortName(oldLabel)` it
  returns `proposeShortName(newLabel)`, else `shortName`. The panel's Name change, Add tables'
  Custom names and Add joined table's Name all go through it. So "Terrace 1"/"T1" renamed
  "Terrace 2" reads "T2", but "Table 1"/"Tb1" renamed "Table 2" keeps "Tb1". Typing a name
  letter by letter follows at every step, because each step's short name equals the previous
  step's proposal. **Why:** design §3.7 fills it "when the table is made or renamed" and "the
  venue may type over it"; a typed value is a choice, and nothing replaces it silently. **Unlike
  the server's rule for a sender that sends none** (slice 1 D4: a rename re-proposes), the
  dashboard keeps a typed one across a rename. **Alternative, for the owner:** re-propose on
  every rename, losing a typed one.
- **D4. The editor's own check covers what the dashboard can see: blank, too long, and
  repeated in the zone.** `checkDraft` gains, after the label's problems and before
  `parts_too_few`:
  - `short_name_missing`: the trimmed short name is blank. Message "Enter a short name." /
    «Escribe un nombre corto.»
  - `short_name_too_long`: `shortNameLength(trimmed) > SHORT_NAME_MAX`. Message "Enter up to 5
    characters." / «Escribe hasta 5 caracteres.»
  - `short_name_repeated`: a table later in the draft whose `shortNameKey` equals an earlier
    table's. Message "{takenBy} already uses {shortName}" / «{takenBy} ya usa {shortName}» (Q51
    (g), no full stop, as the design writes it). `takenBy` is the earlier table's `tableName`, and
    `shortName` is the marked table's trimmed short name.

  Like the Name's check it runs at the first Save and then follows the draft
  (`#followMark`, `floor-plan-editor.ts:752-771`). The input has **no `maxlength`**: a browser counts that in UTF-16
  code units. An "é" typed or pasted decomposed, `"e\u0301"` ("e" and a combining accent), is two
  units but one character after `normalize("NFC")`, so `maxlength=5` would cut
  `"e\u0301".repeat(5)` (ten units), which the shared rule accepts as five characters (ran: `node -e`
  → `.length` 10, NFC code points 5). A precomposed `"\u00e9"` is one unit, so a test written
  with it could not tell units from characters; the tests write the decomposed form with its
  escape. **Why only the zone:** the dashboard has no other zone's short names
  (`DashboardTable`, `client.ts:675-681`). The server refuses those clashes with the table's
  name (D6).
- **D5. Other zones are checked by the server's refusal only; no read changes.** Showing
  another zone's clash before Save would need `GET /management-api/tables` to carry short names,
  a management read change for something the refusal already says. **Alternative, for the
  reviewer:** add `shortName` to that read so Add tables can warn as it types.
- **D6. A refusal lands under the Short name of the table it names, found in the body that was
  sent.** `table.short_name_taken` carries `shortName`, `takenBy` and `field: "shortName"`, and
  no index (`table-short-names.ts:50-54`). `#placeRefusal` finds the refused entry in the body it
  sent, as `floor_plan.invalid` already does (`floor-plan-editor.ts:786-790`): the entry whose
  `shortNameKey(shortName)` equals `shortNameKey(params.shortName)`, then the draft table with
  that entry's key. D4's check stops a save whose tables share a key before it is sent, so at most
  one sent entry matches. The mark reads "{takenBy} already uses {shortName}". The table is selected (and the
  sheet opens on a phone, `#selectFlagged`). The bottom message is "Correct the highlighted
  fields to continue." (`#setMark`). **Save stays enabled**: `mark.from === "refusal"` never
  disables it (`:1263-1269`; CLAUDE.md §3, owner 2026-09-29). **This departs from picture 09**,
  which draws Save disabled after the refusal; the owner's Forms rule wins, and the mark goes when
  the field changes (`#followMark`). When no sent entry matches, the refusal's own sentence goes
  in the bottom message and nothing is selected, as for a taken label no draft table carries
  (refusals test `:178`). `SERVER_FIELDS` gains `shortName: "shortName"`, so a
  `floor_plan.invalid` naming `tables.<i>.shortName` also lands under the field.
- **D7. The dashboard's handling of `table.label_taken` with `takenBy` is deleted** (with its
  two strings and its test). The server throws it only for a table the save leaves with no short
  name (`floor-plan.ts:427-435`); after D2 every dashboard entry sends one, which is claimed or
  refused (`table-short-names.ts:42-57`), so a dashboard save never leaves one with none. The
  global rule deletes code a slice leaves unreachable rather than keeping it covered by a test
  that mocks the server. The server keeps the refusal for senders that send none; a plain
  `table.label_taken` keeps its handling. **Alternative, for the reviewer:** keep the branch as a
  defence against a future sender in the dashboard.
- **D8. In the panel, Short name sits under Name, full width, required, with its hint as its
  placeholder.** Picture 09: `name="short-name"`, `required`, label "Short name" / «Nombre
  corto», placeholder "Shown where space is tight" / «Se muestra donde hay poco espacio»
  (picture 09's caption; CLAUDE.md §3: "A field's hint is its placeholder"). Its `wt-change`
  patches `shortName` under merge key `shortName:<key>`, one undo step per typing run, as Name
  does. The reserved area grows by one field row:
  `calc(4 * var(--wt-field-height) + 5 * var(--wt-space-3))`. A joined table's form (Name,
  Short name, the row, Made of) then fits as today's three rows do, so the list still does not
  move between plain and joined tables (design-system.md, "The form reserves its space…").
- **D9. Add tables: Automatic shows the short names on a second preview line; Custom gives each
  name its own Short name field.**
  - **Automatic:** under today's preview, a second line `[data-short-preview]`, "Short names: T11
    to T15" / «Nombres cortos: T11 a T15». It uses the existing `name_range` for two or more and
    the single short name for one. (2026-10-26, LOOK fix: it uses its own `short_name_range`,
    «{first} a {last}» in Spanish, because `name_range` gave «Nombres cortos: De T11 a T15».) The proposals are of the automatic names. There is no
    per-table field: up to 100 tables, and Custom exists for choosing. **The dialog checks them at
    Save**, by `shortNameKey`, against the draft's short names and each other: the first clash is
    refused beside **Prefix**, the field that changes them, "{takenBy} already uses {shortName}",
    with the bottom message, and nothing is added (design-system.md → Forms: an invalid
    submission explains itself beside the bad field). Example: the demo's Terrace holds "T1"–"T5"
    (`apps/server/scripts/demo-seed/floor.ts:140-176`, read). No label there starts "Terrace ",
    so Add tables opened there names "Terrace 1" (`automaticNames`,
    `packages/ui/src/floor-plan-geometry.ts:337-352`), previews "Short names: T1", and Save is
    refused "T1 already uses T1" beside Prefix; with Prefix "Window" it adds "Window 1" / "W1".
    Without this check the editor would take the tables and then mark the clashes one per Save
    (D4). Other zones' clashes stay the server's (D5). **Why a second line:** the
    preview's existing checks (`floor-plan-add-tables.test.ts:116-142`, `:333-338`) stay as
    they are.
  - **Custom:** each `Name n` gets a `Short name n` («Nombre corto {n}») beside it in one row,
    `name="short-name"`, `required`, with the same placeholder as the panel's, "Shown where space
    is tight" (the hint is the placeholder, D8), following its name (D3). Checked at Save: blank
    and too long as D4; repeated (by key) against the draft's short names and earlier entries of
    the batch → "{takenBy} already uses {shortName}", where `takenBy` for an earlier entry is
    `tableName` of it, so a blank earlier name reads "Unnamed" («Sin nombre»,
    `floor-plan-draft.ts:43-45`) rather than leaving the sentence without a subject.
  - `addTables` takes an optional `shortName` per table, defaulting to the name's proposal
    (Automatic passes none, Custom passes the typed values).
- **D10. Add joined table: Short name under Name, required, following the name.** `JoinedForm`
  gains `shortName`. Checked at Save: blank, too long, and repeated against the draft's short
  names. `addJoinedTable` takes an optional `shortName` with the same default as D9.
- **D11. Save stays quiet until the draft changes, short names included.** `sameTable` compares
  `shortName`, so typing one turns Save on and typing it back turns it off, and the leave guard
  (`draftScopeFor`, `floor-plan-editor.ts:472-480`) asks about it. `trimLabels` trims a short name
  sent padded, as it trims a label (the server stores it trimmed, `table-short-names.ts:44`), so
  the saved draft equals the next read. The dialogs' `sameForm` compare short names.
- **D12. A1110: the dashboard refuses a "+" in a short name it would save that differs from
  the table's stored one: typed, or a proposal for a table stored with none, or any new
  table's.** Own last task (Task 7), droppable. What the proposal gives (ran, the probe's
  `proposeShortName`): "1+2" → "1+2" (four characters or fewer are kept whole), "T1+2" → "T1+2",
  "T1+T2" → "T2", "Table 1+2" → "T12", "10+11" → "111". So refusing "+" only in a **typed**
  short name (A1110's option a) would leave a table named "1+2" with the short name "1+2", which
  reads exactly like tables 1 and 2 joined today ("1+2", `mergeLabel`,
  `packages/ui/src/components/wt-floor-map.ts:144-145`; a party at two tables reads the same
  way, `apps/till/src/state/table-signals.ts:85`). The recommendation therefore refuses a proposal
  too: a table named "1+2" with no stored short name shows its proposal "1+2" refused under the
  field, and the person types one, such as "12" (design §3.7: nothing picks another silently).
  **A stored "+" is left alone:** slice 1's save stored "1+2" as the proposal of a table named
  "1+2" saved with none sent, and the seed, the API and a configuration file still can; refusing
  it on every save would hold Save off for every later edit of that zone until someone retyped a
  table they never touched. So `DraftTable` gains `savedShortName?: string`, set by
  `draftFromPlan` only when the plan read's `shortName` is not `null`, never sent and not compared
  by `sameTable` (like `keptSize`). (2026-10-26, review fix: a successful save also sets it, to the
  trimmed short name each sent table carried — `withSentShortNames`.) The check refuses "+" only
  when the trimmed short name differs
  from `savedShortName`. A saved joined table named after its parts ("1+2") is probably the
  commonest source. Message "Leave out +: it marks joined tables." / «Quita el +: marca mesas unidas.»
  The server, the proposal function and the configuration import are unchanged: a seed or an API
  call can still store one (a residual, Task 8's backlog step). **Why this default:** it fixes
  every tight place at once (slices 3, 8b and 12b read the same short name, slice 1 D8). It
  touches only the dashboard and goes with one revert. The other options change the till's bar
  (b) or leave the confusion (c). The owner question is in Closing slice 2.
- **D13. A1103 is not fixed here.** The new field's refusal reaches the screen by the same path
  as Name's (`#selectFlagged` opens the phone sheet over the panel), so it may meet A1103 (a
  refused field left half under the sheet's heading at 390 px). The code that scrolls the field
  was not found: nothing in the editor, its panels or `wt-sheet` scrolls or focuses it (ran:
  `grep -rn "sticky\|scrollIntoView\|scrollTop"` over `floor-plan*.ts` and `wt-sheet.ts`, and
  `grep -n "focus(\|focusFirstInvalid\|scrollIntoView"` over `floor-plan-editor.ts`,
  `floor-plan-table-panel.ts`, `floor-plan-tables-panel.ts` and `wt-sheet.ts`: nothing). The
  canvas's one focus call passes `preventScroll: true`
  (`packages/ui/src/components/wt-floor-plan-canvas.ts:1053`). So the browser is not scrolling a
  focused field into view; the cause is still unlocated, and fixing it needs it found first. The LOOK (Task 9) shoots
  the Short name refusal at 390 px, and Task 8 adds what it shows to A1103's entry. (2026-10-26: the LOOK
  found the phone sheet keeps its scroll when a refusal selects a table; see A1103 in
  `docs/backlog.md`.)

### Changed test checks (from the probes; the implementer confirms each)

**Probe 1 (ran): the types only.** `FloorPlan`'s tables gain `shortName: string | null`,
`FloorPlanSave`'s `shortName: string`, `DraftTable`'s `shortName: string`. Then `pnpm --filter
@waitron/dashboard typecheck` reported **75 errors**: 5 in `floor-plan-draft.ts` (the functions
Task 1b changes) and 70 in 15 test files, every one a fixture missing `shortName` (`tsc.txt`).
**Probe 1a (ran): `FloorPlan`'s `shortName: string | null` alone** → **46 errors, all in 8 test
files, none in a source file** (`tsc-1a.txt`): `floor-plan-draft.test.ts` (7),
`floor-plan-editor.a11y.test.ts` (5), `floor-plan-editor.deleted-zone.test.ts` (1),
`floor-plan-editor.refusals.test.ts` (10), `floor-plan-editor.save.test.ts` (9),
`floor-plan-editor.test.ts` (10), `floor-plan-editor.unsaved.test.ts` (1),
`floor-plan-table-panel.test.ts` (3). These are **Fixture-only, Task 1a**. The other 24 are
**Fixture-only, Task 1b**: `api/client.test.ts` (1), `floor-plan-add-joined-table.test.ts` (13),
`floor-plan-add-joined-table.unsaved.test.ts` (1), `floor-plan-add-tables.test.ts` (1),
`floor-plan-add-tables.unsaved.test.ts` (1), `floor-plan-draft.test.ts` (1),
`floor-plan-table-panel.test.ts` (4), `floor-plan-tables-panel.a11y.test.ts` (1),
`floor-plan-tables-panel.test.ts` (1).

**Probe 3 (ran): D2's read and send, and new tables carrying their proposal.** `shortName`
optional so no fixture changed, `draftFromPlan` filling stored-or-proposal, `saveFromDraft`
sending it trimmed, `addTables` and `addJoinedTable` setting the proposal. Then
`pnpm exec vitest run src/screens/floor-plan` in `apps/dashboard` →
`Test Files 4 failed | 11 passed (15)`, `Tests 10 failed | 467 passed (477)`. The ten, each
failing only on the new key, all Task 1b, Reason D2 (or D9/D10 for an added table):
- `floor-plan-draft.test.ts`: "keys every master table by id" (`:132`; each table read gains
  `shortName`, here "T9" and "T1", the proposals of fixture tables with none); "sends a save with
  a key per table" (`:160`); "never sends a live-table adoption field for an unsaved draft table"
  (`:190`); "sends a new table with neither id nor live table" (`:203`); "re-keys a saved draft
  from the answer's ids" (`:218`); "adds tables unplaced with fresh keys" (`:422`); "adds Long
  table not placed, made of the tables chosen" (`:734`). Each `toEqual` gains `shortName` with
  the exact value.
- `floor-plan-editor.save.test.ts` "the save body never carries a remembered place" (`:782`): the
  sent table gains `shortName: "T1"`.
- `floor-plan-add-tables.test.ts` "automatic names number on from the highest with the prefix"
  (`:145`): each added table gains `shortName` "T11", "T12", "T13".
- `floor-plan-add-joined-table.test.ts` "adds Long table, 10 seats, made of Counter 3, 4 and 5,
  at the first free spot" (`:243`): the added table gains `shortName: "LT"`.

`src/api/client.test.ts` passed in probe 3's first run, with it included (`run1.txt`: 16 files).

**Probe 4 (ran): probe 3 plus D4's short-name checks in `checkDraft` and D9's Automatic check in
Add tables.** `pnpm exec vitest run src/screens/floor-plan` → `Test Files 5 failed | 10 passed
(15)`, `Tests 11 failed | 466 passed (477)` (`run4.txt`): probe 3's ten and one more, which
probe 3 could not show because it had no D4:
- `floor-plan-editor.test.ts` "gives added tables keys no draft table holds, through saves, undo
  and redo" (`:930-981`). Its fixture holds "T1" and "T2" (`terrace()`, `:38`, `:48`) in a zone
  named "Terrace", so `addViaDialog` (`:884-889`) adds "Terrace 1" and "Terrace 2", proposing
  "T1" and "T2": D9's check refuses the add (probe 4 printed `[ 'm1', 'm2' ]` against `[ 'm1',
  'm2', 'new:1', 'new:2' ]`), and without D9's check D4's would stop the Save and the "m5" poll
  would time out. **Change (Task 2, Reason D4):** `addViaDialog` sets Prefix "Window" before
  confirming, and the mocked saved plan's m5 and m6 are labelled "Window 1" and "Window 2"
  (`:940-961`). Every assertion stays as it is. The probe ran that change: `Tests 1 passed`.

**Probe 2 (ran): a bare Short name input in the panel and in Add joined table**, on top of probe
3's read and send. Three more failures, each a list of field names gaining `"short-name"` after
`"table-name"`, Reason D8/D10:
- `floor-plan-table-panel.test.ts` "lays out Name, then Seats beside Shape and Moveable, and
  nothing more" (`:127`). Renamed "lays out Name, Short name, then Seats beside Shape and
  Moveable, and nothing more"; its list gains `"short-name"` (Task 3).
- `floor-plan-table-panel.test.ts` "a joined table's form shows Made of with its parts chosen,
  and the free tables offered" (`:442`; the list at `:459`) (Task 3).
- `floor-plan-add-joined-table.test.ts` "names every field" (`:177`) (Task 5).

**Not probed; expected:**
- `floor-plan-editor.refusals.test.ts` "a name another table uses as its short name says which
  table, in English and Spanish" (`:160-176`) is **deleted** with the code it tests (D7, Task 4).
- Add tables' Custom short-name fields (Task 6) were not probed. Its existing checks read
  `[name=table-name]` fields only (`nameFields`, `floor-plan-add-tables.test.ts:72-76`), so none
  should change; a failure there is a STOP.

Any other failure, in any suite a task names, is a STOP.

### Review focus (inputs the spec implies and today's tests may not pin)

1. **A table stored with no short name whose proposal another zone holds** (made before
   slice 1, or "Table 3" beside another zone's "Terrace 3"): the field shows "T3", and saving
   any change to the zone is refused "Terrace 3 already uses T3" under that table's field, with
   Save still enabled (D2, D6; Task 4 case 4).
2. **A rename after a typed short name, and after an automatic one**: "Tb1" stays; "T1" follows
   to "T2"; a table whose stored short name was `null` follows too (D3; Tasks 2, 3).
3. **A clash that differs only in case inside the zone**: "t1" beside "T1" is marked at Save
   (D4, by `shortNameKey`; Task 2 case 5); the server's refusal naming "t9" finds the entry that
   sent "t9" (D6; Task 4 case 3).
4. **Five characters that are more than five code units**: decomposed `"e\u0301".repeat(5)`
   (ten UTF-16 units) is accepted and `.repeat(6)` refused (D4; Task 2 case 4), and typed into
   the panel it reaches the draft whole, with no `maxlength` cutting it (Task 3 case 9).
5. **A short name typed with spaces round it**: sent trimmed, and after the save the draft holds
   it trimmed and Save is quiet again (D11; Task 4 case 6).

---

**Task order and why.** The plan read's type and its fixtures first (Task 1a, no behaviour), then
the draft holding and sending short names with the rest of the fixtures (Task 1b). Then the
draft's pure rules (Task 2). Then the panel's field (Task 3). Then the editor's marks and the server's
refusals (Task 4). Then the two dialogs (Tasks 5, 6), the "+" rule (Task 7, droppable), docs
(Task 8) and the LOOK (Task 9). Each leaves the tree green and is sized well under 100 tool calls.
The dashboard is a browser package (`grep -c browser apps/dashboard/vitest.config.ts` → 17):
check free memory first (`memory_pressure | grep free`) and read each run's `Tests` count.

### Task 1a: The plan read's type carries the short name (fixtures only)

**Files:**
- Modify: `apps/dashboard/src/api/client.ts` (`FloorPlan`'s tables `:693-703`: `shortName: string
  | null`, documented "null for a table with none"; the server already sends it,
  `apps/server/src/floor-plan.ts:31`)
- Test: the 8 files of probe 1a (Fixture-only)

Nothing reads the field yet, so no behaviour changes and no test is written first; this task
only makes the type say what the server sends, so Task 1b starts from a small error list.

- [ ] **Step 1:** add the field; `pnpm --filter @waitron/dashboard typecheck 2>&1 | grep "error TS"
  > <scratch outside the worktree>/dash-tsc-1a.txt`; expect probe 1a's 46 sites in its 8 test
  files and no source file (a source error is a STOP).
- [ ] **Step 2: Fixture-only edits, by script** (kept outside the worktree; read its diff): each
  listed plan-read literal (it has `partIds`) gets `shortName: null` beside its `label`, a table
  with none.
- [ ] **Step 3: Run** `pnpm --filter @waitron/dashboard typecheck` (0 errors), then
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/floor-plan`: all pass, unchanged
  (probe 3's baseline: 15 files).
- [ ] **Step 4:** eslint the changed files; `pnpm format:check`; ledger (the Fixture-only files);
  `git commit -s -m "A797-2: the floor-plan read's type carries the short name"`

### Task 1b: The draft reads, holds and sends every table's short name

**Files:**
- Modify: `apps/dashboard/src/api/client.ts` (`FloorPlanSave`'s tables `:714-723`:
  `shortName: string`), `apps/dashboard/src/screens/floor-plan-draft.ts` (`DraftTable` `:9-21`;
  `TablePatch` `:55` gains `"shortName"`; `draftFromPlan` `:57-71`; `saveFromDraft` `:73-86`;
  `addTables` `:278-300`; `addJoinedTable` `:302-324`)
- Test: `apps/dashboard/src/screens/floor-plan-draft.test.ts` (new cases; seven changed checks),
  and Task 1b's Fixture-only files (probe 1) and changed-check files (probe 3)

**Interfaces:**
- Produces: `DraftTable.shortName: string`;
  `addTables(draft, tables: { label: string; shortName?: string; seats: number | null; fixed:
  boolean }[], nextKey)`;
  `addJoinedTable(draft, table: { label: string; shortName?: string; seats: number | null;
  parts: readonly string[] }, nextKey)`. A missing `shortName` becomes
  `proposeShortName(label)`. `patchTable` accepts `{ shortName }`. Consumed by every later task.

- [ ] **Step 1: Failing tests** in `floor-plan-draft.test.ts`:
  1. "opens each table with its stored short name, or its name's proposal when it has none": a
     plan table `{ label: "Terrace 1", shortName: "Tb1" }` reads `"Tb1"`; `{ label: "Window",
     shortName: null }` reads `"Win"`.
  2. "sends every table's short name, trimmed": a draft table with `shortName: " Tb1 "` is sent
     `"Tb1"`; the stored-null table above is sent `"Win"` (D2).
  3. "a new table takes its name's proposal unless it is given one": `addTables` with
     `{ label: "Top floor 12" }` → `"TF12"`, with `shortName: "Up12"` → `"Up12"`; `addJoinedTable`
     the same.
  Then the seven changed checks in this file (probe 3) gain `shortName` exactly.
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/dashboard exec vitest run src/screens/floor-plan-draft.test.ts`.
- [ ] **Step 3: Implement** D2 in the types and the draft functions above.
- [ ] **Step 4: Fixture-only edits, by script** (kept outside the worktree; read its diff).
  `pnpm --filter @waitron/dashboard typecheck 2>&1 | grep "error TS" > <scratch outside the
  worktree>/dash-tsc.txt` lists probe 1's remaining 24 sites. In each, beside its `label`, a
  **draft** table (it has `parts`) gets `shortName` equal to `proposeShortName(label)`, written as a
  literal ("T1" for "T1", "C3" for "Counter 3", "LT" for "Long table"). In a builder, use its
  label parameter through `proposeShortName` imported from `@waitron/shared`. The
  `saveFloorPlan` body in `api/client.test.ts:1536` gets `shortName: "1"`. Then the three changed checks
  outside this file (probe 3: `floor-plan-editor.save.test.ts:782`,
  `floor-plan-add-tables.test.ts:145`, `floor-plan-add-joined-table.test.ts:243`) gain their
  `shortName`.
- [ ] **Step 5: Run; expect PASS**: `pnpm --filter @waitron/dashboard typecheck` (0 errors), then
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/floor-plan src/api/client.test.ts`.
  Expected: 16 files, all passing (probe: 678 tests before this task's new cases).
- [ ] **Step 6:** eslint the changed files; `pnpm format:check`; ledger (the ten changed checks,
  the Fixture-only files); `git commit -s -m "A797-2: the floor-plan draft reads and sends every table's short name"`

### Task 2: The draft's rules: a short name follows its name, and the editor's own checks

**Files:**
- Modify: `apps/dashboard/src/screens/floor-plan-draft.ts` (`followName`, `renameTable` (new);
  `sameTable` `:127-149`; `DraftProblem` and `checkDraft` `:162-174`)
- Test: `apps/dashboard/src/screens/floor-plan-draft.test.ts`; `apps/dashboard/src/screens/floor-plan-editor.test.ts`
  (one changed check, probe 4)

**Interfaces:**
- Produces:
  ```ts
  /** The short name a rename leaves: the new name's proposal while it was the old one's. */
  export function followName(shortName: string, oldLabel: string, newLabel: string): string;
  export function renameTable(draft: FloorPlanDraft, key: string, label: string): FloorPlanDraft;
  export type DraftProblem =
    | "label_missing" | "label_repeated"
    | "short_name_missing" | "short_name_too_long" | "short_name_repeated"
    | "parts_too_few";
  export interface DraftCheck {
    key: string;
    problem: DraftProblem;
    /** short_name_repeated: the earlier table's name and the short name the two share. */
    takenBy?: string;
    shortName?: string;
  }
  export function checkDraft(draft: FloorPlanDraft): DraftCheck | null;
  ```
  Consumed by Tasks 3–6 (Task 7 adds a problem).

- [ ] **Step 1: Failing tests:**
  1. "a short name follows its name while it is the name's proposal": `followName("T1",
     "Terrace 1", "Terrace 2")` → `"T2"`; `followName("Tb1", "Table 1", "Table 2")` → `"Tb1"`;
     typing "W", "Wi", …, "Window 1" from "" step by step ends at `"W1"`.
  2. "renameTable changes the name and a following short name in one change": the draft
     returned has both; the other tables are the same objects.
  3. "a changed short name is a changed draft": `sameDraft` false after `patchTable({ shortName:
     "Tb1" })`, true after patching it back (D11).
  4. `it.each` "checkDraft marks a short name that is %s": `""` and `"   "` →
     `short_name_missing`; `"ABCDEF"` and `"e\u0301".repeat(6)` (decomposed, twelve UTF-16 units,
     six characters) → `short_name_too_long`; `"ABCDE"` and `"e\u0301".repeat(5)` (ten units, five
     characters) → `null` (Review focus 4). Write the escape, not a typed "é".
  5. "checkDraft marks the later of two tables sharing a short name, ignoring case": "Terrace 1"
     (`"T1"`) then "Table 1" (`"t1"`) → `{ key: <Table 1's>, problem: "short_name_repeated",
     takenBy: "Terrace 1", shortName: "t1" }` (Review focus 3).
  6. "checkDraft reports a missing name before a missing short name, and a short name before too
     few parts": the order D4 gives.
  Changed check (probe 4): `floor-plan-editor.test.ts` "gives added tables keys no draft table
  holds, through saves, undo and redo" (`:930-981`): `addViaDialog` sets Prefix "Window", and the
  mocked saved plan's m5 and m6 are "Window 1" and "Window 2". Reason D4: the tables it added,
  "Terrace 1" and "Terrace 2", propose the fixture's own "T1" and "T2". Its assertions stay as
  they are. Ledger.
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/dashboard exec vitest run src/screens/floor-plan-draft.test.ts`.
- [ ] **Step 3: Implement** D3, D4 and D11's `sameTable`, using `proposeShortName`,
  `shortNameKey`, `shortNameLength` and `SHORT_NAME_MAX` from `@waitron/shared`.
- [ ] **Step 4: Run; expect PASS**, then `pnpm --filter @waitron/dashboard typecheck`. The editor
  compiles unchanged (`#markProblem`, `floor-plan-editor.ts:723-735`, takes the wider type); until
  Task 4 it marks a short-name problem on the Name field with the generic sentence.
- [ ] **Step 5: Run every floor-plan suite with D4 in place, before trusting the changed-check
  list:** `pnpm --filter @waitron/dashboard exec vitest run src/screens/floor-plan`. Expected:
  all pass once the changed check above is made (probe 4 found it as the only D4 failure). Any
  other failure is a STOP: report it with its message; do not edit it.
- [ ] **Step 6:** eslint; format check; ledger; `git commit -s -m "A797-2: a short name follows its name until typed, and the editor checks short names"`

### Task 3: The table panel's Short name field

**Files:**
- Modify: `apps/dashboard/src/screens/floor-plan-table-panel.ts` (a `wt-input` after Name,
  `:234-242`; Name's change goes through `renameTable`), `apps/dashboard/src/screens/floor-plan-editor.ts`
  (`.table-slot` `:280-285`, D8), `apps/dashboard/src/i18n/strings.ts` (en block `:1240-1281`, es
  block `:4625-4665`: `floor_plan_editor.short_name`, `floor_plan_editor.short_name_hint`)
- Test: `apps/dashboard/src/screens/floor-plan-table-panel.test.ts` (new cases; two changed checks),
  `apps/dashboard/src/screens/floor-plan-editor.test.ts` (one new case beside "with nothing
  selected, reserves an empty form area above the list", `:1294`),
  `apps/dashboard/src/screens/floor-plan-editor.unsaved.test.ts` (two new cases)

- [ ] **Step 1: Failing tests.** English fixture names only.
  1. Panel: "shows the table's short name under its name, required, with its hint as
     placeholder": `field(el, "short-name").value` is the fixture's short name, `required` is
     set, `placeholder` is "Shown where space is tight".
  2. Panel: "typing a short name sends one merged change": two `wt-change`s → `floor-plan-change`
     events carrying merge key `shortName:<key>`, the last draft's `shortName` the typed text
     (as "typing a name sends one merged change", `:179`).
  3. Panel: "renaming a table moves a following short name with it, and keeps a typed one":
     "Terrace 1"/"T1" renamed "Terrace 2" sends a draft with "T2"; "Table 1"/"Tb1" renamed sends
     "Tb1" (Review focus 2).
  4. Panel: "shows a refusal under Short name": `fieldErrors` `[{ field: "shortName", message:
     "Terrace 1 already uses T1" }]` → that field's `error`.
  5. Panel: "names Short name in Spanish": the label and placeholder read from the strings file,
     `es["floor_plan_editor.short_name"]` and `es["floor_plan_editor.short_name_hint"]` (CLAUDE.md
     §3: a test of a non-English screen reads its expected text from the strings file).
  6. Editor: "a joined table's form fits its reserved area without scrolling, at 1280 and 390
     px": select the fixture's joined table (`counters()`, `:1315`); the `.table-slot`'s
     `scrollHeight` ≤ `clientHeight` + 1. Before D8's height it scrolls.
  7. Unsaved: "a typed short name turns Save on, asks before Cancel, and typed back is clean
     again": through the panel's field, as "Cancel asks after a move…" (`:149`) and "undoing every
     change closes without asking" (`:192`) do for a move.
  8. Unsaved: "Undo takes back a typed short name": after Undo the field shows the old value and
     Save is quiet.
  9. Panel: "a short name of five characters reaches the draft whole, however many code units":
     typing `"e\u0301".repeat(5)` sends a draft whose `shortName` is that string, unshortened
     (D4: no `maxlength`; Review focus 4).
  Changed checks (probe 2): "lays out Name, then Seats beside Shape and Moveable, and nothing more"
  (`:127`), renamed and gaining `"short-name"`; "a joined table's form shows Made of…" (`:459`),
  gaining `"short-name"`. Ledger.
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/dashboard exec vitest run src/screens/floor-plan-table-panel.test.ts src/screens/floor-plan-editor.test.ts src/screens/floor-plan-editor.unsaved.test.ts`.
- [ ] **Step 3: Implement** D8: the field, its strings, `renameTable` for Name, the slot height.
  The field's `.error` is `this.#error("shortName")`.
- [ ] **Step 4: Run; expect PASS**, then `pnpm --filter @waitron/dashboard exec vitest run src/screens/floor-plan`
  (the a11y suites included: a new required field must pass axe in both themes,
  `floor-plan-editor.a11y.test.ts`).
- [ ] **Step 5:** typecheck dashboard; eslint; format check; ledger; `git commit -s -m "A797-2: the floor-plan editor's table form gets a Short name field"`

### Task 4: The editor marks short-name problems and places the server's refusal under the field

**Files:**
- Modify: `apps/dashboard/src/screens/floor-plan-editor.ts` (`FloorPlanField` `:105` gains
  `"shortName"`; `SERVER_FIELDS` `:139-145`; `tableProblem` `:153-162` returns `DraftCheck | null`
  and knows D4's three problems; `trimLabels` `:171-182`; `#markProblem` `:723-735`;
  `#placeRefusal` `:773-807`, D6 and D7), `apps/dashboard/src/i18n/strings.ts`
  (`short_name_missing`, `short_name_too_long`, `short_name_taken`; **delete**
  `floor_plan_editor.label_shown_as_short_name`, en `:1280-1281`, es `:4664-4665`)
- Test: `apps/dashboard/src/screens/floor-plan-editor.refusals.test.ts` (new cases; one case
  deleted), `apps/dashboard/src/screens/floor-plan-editor.save.test.ts` (one new case)

- [ ] **Step 1: Failing tests** (the file's `refusing`, `change`, `press`, `canvas`, `message`,
  `button` helpers, `:83-140`):
  1. "a blank short name is marked at Save and holds Save until filled": patch `shortName: ""`;
     Save → `fieldError` `{ key, field: "shortName", message: "Enter a short name." }`, the
     message "Correct the highlighted fields to continue.", Save disabled; type "T2" → mark gone,
     Save enabled.
  2. "two tables sharing a short name: the later is marked with the earlier's name": "T1" and
     "t1" → "T1 already uses t1" on the second; in Spanish the sentence `es` gives with the same
     values (the file already imports `es`, `:11`).
  3. "a taken short name lands under the table that sent it, naming the table holding it":
     `refusing({ code: "table.short_name_taken", params: { shortName: "t9", takenBy: "Terrace 9",
     field: "shortName" } })`, the draft's m9 sending `"t9"`: m9 selected, `fieldError` `{ key:
     "m9", field: "shortName", message: "Terrace 9 already uses t9" }`, Save **enabled**
     (D6). In Spanish the message is `fill(es["floor_plan_editor.short_name_taken"], …)` with the
     same values, read from the strings file.
  4. "a stored table with no short name sends its proposal, and a refusal of it lands under its
     field": a plan table `{ label: "Table 3", shortName: null }` added to the file's plan, whose
     tables are "T1", "T2" and "T9" (`plan()`, `:37-75`), so its proposal "T3" passes the editor's own
     check; move another table and Save; the body sends `"T3"`; refused with `takenBy: "Terrace
     3"` → marked under Table 3's Short name (Review focus 1). ("Table 1" would propose the
     fixture's own "T1", and the editor's check would stop the save before the server.)
  5. "a taken short name no sent table carries goes in the bottom message and selects nothing".
  6. In `save.test.ts`: "a short name sent with spaces round it is kept trimmed, and Save is
     quiet after" (Review focus 5).
  7. "an invalid short name the server names is marked under the field": `floor_plan.invalid`
     `{ field: "tables.0.shortName" }` → `field: "shortName"`.
  **Deleted check:** "a name another table uses as its short name says which table, in English
  and Spanish" (`:160-176`). Reason D7: no dashboard save can be refused so. Ledger.
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/dashboard exec vitest run src/screens/floor-plan-editor.refusals.test.ts src/screens/floor-plan-editor.save.test.ts`.
- [ ] **Step 3: Implement** D4's marks (field `shortName`, message by problem with `fill` for
  `short_name_taken`), D6, D7 and D11's `trimLabels`. 
- [ ] **Step 4: Run; expect PASS**, then `pnpm --filter @waitron/dashboard exec vitest run src/screens/floor-plan src/i18n`.
- [ ] **Step 5:** typecheck; eslint; format check; ledger (the deleted case);
  `git commit -s -m "A797-2: short-name problems and refusals sit under the Short name field"`

### Task 5: Add joined table's Short name

**Files:**
- Modify: `apps/dashboard/src/screens/floor-plan-add-joined-table.ts` (`JoinedForm` `:36-40`,
  `sameForm` `:50-57`, `show` `:115-121`, `#edit` `:143-166` (a Name change goes through
  `followName`), `#errors` `:174-192`, `#add` `:198-227`, the field after Name `:263-270`)
- Test: `apps/dashboard/src/screens/floor-plan-add-joined-table.test.ts` (new cases; one changed
  check), `apps/dashboard/src/screens/floor-plan-add-joined-table.unsaved.test.ts` (one new case)

- [ ] **Step 1: Failing tests:**
  1. "marks Short name required, with its hint as placeholder".
  2. "Short name follows the name until typed": Name "Long table" → "LT"; type "Lng"; Name "Long
     table 2" → still "Lng".
  3. "adds the joined table with its short name": "Long table", short "LT9" → the added table's
     `shortName: "LT9"`.
  4. "refuses a blank, a too long and a repeated short name beside the field": "", "ABCDEF", and
     the draft's "C3" typed as "c3" → "Enter a short name.", "Enter up to 5 characters.",
     "Counter 3 already uses c3"; the bottom message "Correct the highlighted fields to continue.";
     nothing added.
  5. Unsaved: "a typed short name asks before Escape, and Keep keeps it" (as `:99`).
  Changed check (probe 2): "names every field" (`:177`) → `["table-name", "short-name", "seats",
  "made-of"]`. Reason D10. Ledger.
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/dashboard exec vitest run src/screens/floor-plan-add-joined-table.test.ts src/screens/floor-plan-add-joined-table.unsaved.test.ts`.
- [ ] **Step 3: Implement** D10 (strings from Tasks 3 and 4).
- [ ] **Step 4: Run; expect PASS**; then `pnpm --filter @waitron/dashboard exec vitest run src/screens/floor-plan`.
- [ ] **Step 5:** typecheck; eslint; format check; ledger; `git commit -s -m "A797-2: Add joined table asks for a short name"`

### Task 6: Add tables shows and asks for short names

**Files:**
- Modify: `apps/dashboard/src/screens/floor-plan-add-tables.ts` (`AddForm` `:29-37` gains
  `shortNames: string[]`, resized with `names` in `#edit` `:153-163`; `AddErrors` gains
  `prefix: string` (D9's Automatic check, shown as the Prefix field's `error`) and
  `shortNames: string[]`; `sameForm` `:47-57`; `#errors` `:173-192`; `#add` `:198-224`; a second
  preview line after `:302`; a `Short name n` beside each `Name n`, `:303-316`),
  `apps/dashboard/src/i18n/strings.ts` (`floor_plan_editor.short_name_n` "Short name {n}" /
  «Nombre corto {n}», `floor_plan_editor.short_names_preview` "Short names: {names}" / «Nombres
  cortos: {names}»)
- Test: `apps/dashboard/src/screens/floor-plan-add-tables.test.ts`,
  `apps/dashboard/src/screens/floor-plan-add-tables.unsaved.test.ts`

- [ ] **Step 1: Failing tests** (the file's fixture `draft`, `:31-38`, Terrace 1/2/10 and Terrace
  bar 3):
  1. "the preview gives the short names the tables will get": count 5 → `[data-short-preview]`
     reads "Short names: T11 to T15"; count 1 → "Short names: T11"; in Spanish the text built from
     `es["floor_plan_editor.short_names_preview"]` and `es["floor_plan_editor.name_range"]`. The
     existing preview line is unchanged.
  2. "automatic short names the draft already holds are refused beside Prefix": a draft table
     "Patio" with short name "T11" (the fixture's next automatic name is "Terrace 11") → Save
     refused, Prefix's `error` "Patio already uses T11", the bottom message, nothing added;
     Prefix "Window" → added (D9). Mount the dialog with its own draft for this case; the file's
     shared `draft` stays as it is.
  Automatic names adding each table with its proposal is already pinned by Task 1b's changed
  check (`:145`).
  3. "custom naming shows a short name beside each name, following it until typed": three
     names → three `short-name` fields labelled "Short name 1"…"Short name 3", each `required`
     and with the placeholder "Shown where space is tight";
     Name 1 "Patio 1" → "P1"; type "Pt1"; Name 1 "Patio 9" → still "Pt1".
  4. "adds the custom short names as typed, trimmed": " Pt1 " → `"Pt1"`.
  5. "a custom short name blank, too long, used by the draft or twice in the batch is refused
     beside its field": `""`, `"ABCDEF"`, `"t1"` (the draft's "Terrace 1" holds "T1") and a
     batch of two "X1"s → "Enter a short name.", "Enter up to 5 characters.", "Terrace 1 already
     uses t1", and "Bar 1 already uses X1" on the second of a batch "Bar 1"/"Bar 2" both given
     "X1"; with the first name left blank the second reads "Unnamed already uses X1"; bottom
     message; nothing added.
  6. Unsaved: "a typed short name asks before Escape" (as "typed custom names ask before
     Escape…", `:96`).
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/dashboard exec vitest run src/screens/floor-plan-add-tables.test.ts src/screens/floor-plan-add-tables.unsaved.test.ts`.
- [ ] **Step 3: Implement** D9. The Name/Short name row is a two-column grid whose sizes read
  `--wt-*` tokens (no `rem`, CLAUDE.md §3); Short name is the narrower column. At 390 px the
  LOOK checks it (Task 9).
- [ ] **Step 4: Run; expect PASS**; then `pnpm --filter @waitron/dashboard exec vitest run src/screens/floor-plan`.
  Existing checks unchanged (a change is a STOP: report it).
- [ ] **Step 5:** typecheck; eslint; format check; ledger; `git commit -s -m "A797-2: Add tables shows its short names and asks for custom ones"`

### Task 7 (droppable): A short name may not contain "+" (A1110, D12)

Built as the recommended default while the owner's answer is awaited. **If the owner answers
(b) or (c) before the PR lands, drop this commit** (`git revert`, or skip the task) and keep
A1110 in the backlog with the answer.

**Files:**
- Modify: `apps/dashboard/src/screens/floor-plan-draft.ts` (`DraftTable` gains
  `savedShortName?: string`, set by `draftFromPlan` from a non-null read and, after a successful
  save, from what it sent, never sent and not
  compared by `sameTable`; `DraftProblem` gains `"short_name_plus"`, checked after
  `short_name_too_long`, only for a trimmed short name that differs from `savedShortName`), `floor-plan-editor.ts`
  (`#markProblem`, `tableProblem`), `floor-plan-add-tables.ts` and
  `floor-plan-add-joined-table.ts` (`#errors`), `apps/dashboard/src/i18n/strings.ts`
  (`floor_plan_editor.short_name_plus`: "Leave out +: it marks joined tables." / «Quita el +:
  marca mesas unidas.»)
- Test: `floor-plan-draft.test.ts`, `floor-plan-editor.refusals.test.ts`,
  `floor-plan-add-tables.test.ts`, `floor-plan-add-joined-table.test.ts`

- [ ] **Step 1: Failing tests:**
  1. Draft: `it.each` "checkDraft refuses a new or changed short name holding +: %s": `"T1+T2"`,
     `"1+2"`, `"+"` on a new table → `short_name_plus`; `"T12"` → `null`.
  2. Draft: "an untouched stored short name with + is left alone, and a changed one is not": a
     plan table stored `{ label: "1+2", shortName: "1+2" }` → `checkDraft` `null` (its zone still
     saves); patched to `"1+3"` → `short_name_plus`; patched back to `"1+2"` → `null`.
  3. Editor: "a table named 1+2 stored with no short name shows its proposal 1+2, refused at Save
     until another is typed": the field reads "1+2"; Save → "Leave out +: it marks joined tables." under Short name; type
     "12" → saved with `"12"`.
  4. Each dialog: a typed "A+B" is refused beside its field.
  5. "the full-width plus is not refused": `"T1＋T2"` (U+FF0B) → `null`. This is a stated
     limit: the till joins names with ASCII "+" only (`mergeLabel`), so only that one reads
     like a join.
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/dashboard exec vitest run src/screens/floor-plan-draft.test.ts src/screens/floor-plan-editor.refusals.test.ts src/screens/floor-plan-add-tables.test.ts src/screens/floor-plan-add-joined-table.test.ts`.
- [ ] **Step 3: Implement** D12.
- [ ] **Step 4: Run; expect PASS**; then `pnpm --filter @waitron/dashboard exec vitest run src/screens/floor-plan`.
- [ ] **Step 5:** typecheck; eslint; format check; ledger; `git commit -s -m "A797-2: a short name may not contain +, which marks joined tables (A1110)"`

### Task 8: Docs, the user guides and the backlog follow the code

**Files:**
- Modify: `apps/server/src/guide/en/table-service.md` and `apps/server/src/guide/es/table-service.md`
  (a new section before "See which tables have food ready" `{#ready-bar}`, en `:137`, es `:141`),
  `docs/developers/design-system.md` (the floor-plan editor paragraphs under "Departments and
  zones", `:5651-5663`), `docs/developers/conventions-data.md` (the short-name paragraph,
  `:1855-1877`), `docs/backlog.md` (both A797 entries, `:120-129` and `:2774-2786`; A1103 `:2807`;
  A1110 `:2849`), `docs/backlog/till.md` (A797's entry, `:1046-1062`),
  `docs/superpowers/specs/2026-10-18-a797-device-screens-design.md` (§3.7, one dated sentence),
  this plan's slice 2 outline (one line: expanded below)
- Test: `apps/server/src/guide-content.test.ts`, `scripts/guide-links.test.ts`

No guide covers the floor-plan editor today (ran: `grep -rn -i "floor plan" apps/server/src/guide/en/`
→ nothing), so the new section stands alone.

- [ ] **Step 1: Guides.** `## Give a table a short name {#short-names}` /
  `## Dar a una mesa un nombre corto {#short-names}`, three to five sentences. The till shows a
  table's short name where space is tight, such as the Ready bar. In the floor plan editor each
  table has a **Short name** under its **Name**, filled in from the name ("T1" for "Terrace 1",
  "Win" for "Window"; a name of four characters or fewer as it is). It follows the name until you
  type your own, of up to five characters. Two tables of the venue cannot share one, whatever
  the capitals: if Save says "Terrace 1 already uses T1", type another, such as "Tb1". **Add
  tables** shows the short names it will give, and lets you type them with custom names; **Add
  joined table** asks for one. With Task 7: a short name cannot contain "+", which the till uses
  for tables joined together. The Spanish twin uses «Nombre corto» and «Terraza 1 ya usa T1».
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and
  `pnpm exec vitest run scripts/guide-links.test.ts`; PASS.
- [ ] **Step 3: design-system.md.** "The form holds Name, then Seats…" becomes "The form holds
  Name, then Short name, then Seats…". Add one sentence: Short name follows Name until it is
  typed, and its hint is its placeholder. Add another: Add tables shows the short names on a
  second preview line and refuses beside Prefix one the draft already holds, and with custom names
  puts a Short name beside each Name. The reserved-area
  sentence stays true (D8).
- [ ] **Step 4: conventions-data.md.** After "A sent one is refused…", add: the dashboard's floor
  plan editor sends a short name for every table (the stored one, else its name's proposal), so
  every short name in its saves is a sent one, and only a sender that sends none (the seed, the
  API) meets the kept and proposed classes or the `table.label_taken` refusal with `takenBy`.
- [ ] **Step 5: Backlog.** In both A797 entries and `till.md`'s: slice 2 is in review, with this
  plan linked; slice 3 is next. **A1110:** with Task 7 landed, delete the entry, and add one short
  entry for what is left: the server, the API and a configuration file still accept a "+" in a
  short name. Take its number from `~/waitron-campaign-shared/next-item-number` (read it, use it,
  write the next back). With Task 7 dropped, rewrite A1110 to point at the owner's question.
  **A1103:** add one sentence on what the LOOK showed for the Short name refusal at 390 px
  (Task 9), with the picture's file name. **Design file:** under §3.7's "Unique in the venue"
  bullet, one dated sentence. Save stays enabled after the refusal, following the Forms rule,
  where picture 09 draws it disabled; see this plan's slice 2, D6.
- [ ] **Step 6: Check** `pnpm exec prettier --file-info docs/backlog.md` prints `"ignored": true`
  (wrap by hand); `pnpm format:check` for the guide files.
- [ ] **Step 7: Commit** `git commit -s -m "docs: A797-2 — guides, design system, conventions and backlog for the short-name field"`

### Task 9 (visual): LOOK at the Short name field

- [ ] **Step 1: Start the stack** `wa-wt demo waitron-feat-a797-2-short-names-dashboard`;
  `wa-wt ls` for the URLs. Sign in to the dashboard as the demo's owner; open Floor plans → a
  layout of Terrace (its tables are "T1"–"T5", short names equal to them).
- [ ] **Step 2: Look** with the workspace's Playwright Chromium (script in
  `/Users/clintongormley/waitron-campaign-c/a797-2-scripts/`, never in the worktree, process id
  recorded), at **390 px** and **1280 px**, **light and dark**, **English and Spanish**:
  - a selected table's form: Name, Short name (with its asterisk), then the Seats row; a joined
    table's form with Made of, and the list not moving between the two (D8);
  - rename Terrace's "T1" to "Terrace 1": Short name still "T1" (the proposal of both); save;
  - in Dining room, Add tables → Custom, one table "Table 1": Short name 1 proposes "T1"; Save
    the dialog, then the editor's Save → refused "Terrace 1 already uses T1" («Terrace 1 ya usa
    T1»: the table's name is the data's, the sentence the language's) under Short name, the
    table selected, the bottom message, Save **enabled** (D6); type "Tb1" → saved;
  - **at 390 px, the refused Short name in the phone sheet**: whether its label sits under the
    sheet's heading as A1103 describes for Name (D13). Record it either way;
  - Add tables → Automatic in Terrace, as it opens: the preview "Short names: T1", and Save
    refused "T1 already uses T1" beside Prefix (D9); Prefix "Window", count 3: "Short names: W1
    to W3", added;
  - Add joined table: its Short name field following the name;
  - with Task 7: Add joined table named "1+2" shows "1+2" refused with "Leave out +: …".
- [ ] **Step 3: Save** the PNGs under `/Users/clintongormley/waitron-campaign-c/a797-2-shots/`
  (`<step>-<width>-<theme>-<lang>.png`), open each, describe them in the ledger and the PR body,
  and hand Task 8's A1103 sentence its file name.
- [ ] **Step 4: Stop** what you started: the script by its recorded process id, then
  `wa-wt down waitron-feat-a797-2-short-names-dashboard`.

### Closing slice 2

- Focused runs per task as above. CI runs the dashboard's package suites and coverage. Read the
  `changes` job's outputs and the dashboard's coverage job on the current head before calling the
  PR green (the server's guide test runs in the server's job).
- `/finish-branch` with this plan named. Review path **LIGHT**: the plan-against-spec read and one
  Codex run-it review.
- PR body. **First line: "No venue reset needed."** Then: **What a person sees** (the Short name
  field in the table form, Add tables and Add joined table; the refusal under it; Save stays
  enabled after a refusal); **Decisions** D1–D13 in one line each; **Changed test checks** (from
  the ledger: Task 1b's ten, Task 2's one, Task 3's two, Task 5's one, Task 4's deleted case);
  **Fixture-only** (Task 1a's eight files, Task 1b's nine); **Departure from picture 09** (D6: Save not disabled by a refusal);
  **A1110** (D12; Task 7 is its own commit and goes with one revert); **LOOK**.
- **Owner FYI** (one line each in the PR and the lane's questions file, not questions):
  - D2: a table that has no short name yet shows its automatic one, and a save of its zone is
    refused while another table holds that, until someone types another.
  - D3: a typed short name stays when the table is renamed; an automatic one follows the name.
  - D5: a clash with another zone's table shows only when Save is pressed.
  - D6: after a refusal Save stays pressable (the Forms rule), where picture 09 drew it greyed.
  - D9: Add tables with automatic names shows the short names but has no field for them, and
    refuses beside Prefix any the zone already holds. Opened in the demo's Terrace (tables
    "T1"–"T5") it proposes "Terrace 1" / "T1" and is refused until the prefix changes; change a
    short name in the table's form afterwards.
  - D12 (if Task 7 lands): a short name already saved with "+" stays until someone changes it;
    only a new or changed one is refused.
- **Owner question, A1110** (the lane's questions file; the block is in this slice's report to
  the driver).
- After merge: delete the branch local and remote and check the remote one is gone; update the
  ledger; then slice 3.

---

## Slice 3 — The handheld's bar (one PR, branch `feat/a797-3-handheld-bar`)

**What it changes.** On a handheld (phone or tablet) the top bar becomes design §3.1's: **Floor**,
then **one button per table where the signed-in person has unsent dishes**, reading "✎ T4" (the
map's ✎ Unsent mark, then the table's short name), then **"?"** and **☰**. The table on screen has
its button drawn as the selected tab, with ✎ only while something of this person's is unsent there,
and loses it once they leave a table with nothing of theirs unsent. Several bills at one table give
one button; a table whose New orders are all sent, or taken over by someone else, has none; a
finished table never has one. The "Order" tab goes: the table's own button takes its place. Tapping
**Floor** after leaving a table opens that table's zone. **Everything else is in ☰** at every
width, in §3.1's order: the person's name and clock actions; Pass, Kitchen, Find a bill, My
schedule, Profile, Transfers; a **Settings** group of Zones on this device, Equipment, Language and
Theme; Log out last. On a tablet the person's name also stays on the bar while it fits (picture
06). To know whose dishes are unsent, the floor read's `UnsentDraft` gains the New order's owner id
and its saved time (`order_drafts.updated_at`).

Worked example 1 (design §4), as this slice builds it: Ana opens T4, adds dishes, taps **Floor**:
the Floor opens on Inside (T4's zone) and the bar reads Floor · ✎ T4 · ? · ☰. She opens T9 from
the Floor, adds two drinks, then removes one, then the other: T9's button stays highlighted,
without ✎, while she is on T9, and goes when she taps ✎ T4, which opens T4. **One step of design
§4's example differs (D13):** there Ana *sends* T9's drinks and stays on T9 with its button
highlighted without ✎; in this slice a send that empties the New order still returns the handheld
to the Floor (`till-app.ts:11754-11758`), so that moment shows only by the other ways D13 lists.
Which **bill** a button opens is slice 11's (D9); here a button opens its table the way a tap on
the Floor does, or returns to the table the app still holds as the Order tab did. _2026-10-26:
see D9's note._

**Review path: FULL.** **A change to what a server read sends the till** (design §8: "any change to
what a server read sends to the till"): `UnsentDraft` in `apps/server/src/order-drafts.ts:343-349`,
filled by `readUnsentDrafts` (`:1245-1286`), reaches the till through `listTablesWithState`
(`apps/server/src/working-order.ts:8564`, `:8600`) and `GET /api/tables/state`
(`apps/server/src/till-api.ts:2768`), and is typed again for the till at
`apps/till/src/api/client.ts:895-901`. Fields are only added; no route starts refusing or serving
anything, and no route map changes (read: the route is unchanged, only its rows gain two fields).
**Migration: none.** Both columns exist: `order_drafts.owner_id` and `updated_at`
(`packages/db/src/schema/order-drafts.ts:33`, `:37`, read). If a task finds it needs one, STOP.

How claims are marked in this section: **(ran)** means run on 2026-10-26 against `main` at
`493d023d2` (this worktree's base); **(read)** means read in the code at that commit, not run. The
probes ran in throwaway worktrees (`git worktree add --detach /tmp/a797-3-probe.MtAy/wt
493d023d2`, `wt2` at probe 1's commit and, for the fresh review's probe E, `wt3` at probe D's),
removed afterwards; their logs stay in `/tmp/a797-3-probe.MtAy/` (`server-tsc.txt`,
`till-tsc.txt`, `server-run1.txt`, `shell-runA.txt`, `shell-run2a.txt`, `shell-run1.txt`,
`shell-run2.txt`, `app-run1.txt`, `app-runE.txt`; the failing-name lists `fA.txt`, `f2a.txt`,
`f1.txt`, `f2.txt`, `fE.txt`). None of the probe code is in this branch.

### What landed already, and what is on `main` (read; each line opened)

- **Slice 4** (#2041): ☰ → Zones on this device on a handheld, a `BarItem` `"zones"` always in ☰
  (`apps/till/src/widgets/till-shell.ts:55`, `:519`, `:537`), drawn by `#items` (`:802`).
- **Slice 5** (#2063): the Ready bar on a handheld's Floor and List/Map kept per zone on the device
  (`viewMemory`, `apps/till/src/screens/till-floor-screen.ts:894`); a handheld's Floor re-reads
  every 15 s in list view too (slice 5 D7).
- **Slices 1–2** (#2076, #2083): `TableState.shortName` on every floor row
  (`apps/till/src/api/client.ts:2206-2208`: "The table's saved short name, else its full name"), and
  `tightName` (`apps/till/src/state/floor-today.ts:87-97`), which names a table of today's join by
  its members' short names ("T4+T5") and any other table by its own; the Ready bar's
  `readyTables` (`apps/till/src/state/table-signals.ts:58-90`) lists one entry per party, its
  tables' tight names joined with "+", in the floor read's order.
- **A582's "?"** is on `main`: `till-shell` draws `wt-help-switch` on a handheld's bar at every
  width (`#helpSwitch`, `till-shell.ts:729-734`, used at `:1094`), today after the language chooser
  and **before** the person's name (`:1094`; design-system.md:2311-2313). A582 slice 2b's "language
  into the account menu" (owner answer Q41 = B) is the **dashboard's** account menu
  (`docs/backlog/dashboard.md:952-953`), not the till's; on the till, a handheld's chooser sits on
  the bar and moves to the end of ☰ only at phone width when the bar does not fit (`chooserInMore`,
  `till-shell.ts:471`, `:665-675`, `:955`). So §3.1's "language into ☰" is new here (D5).

### Every reader and writer this slice touches (ran: grep; each line read)

`grep -rn "UnsentDraft\|readUnsentDrafts\|unsentDrafts" apps packages --include='*.ts' | grep -v node_modules`
(ran) → outside tests:

| Where | What it does today |
| --- | --- |
| `apps/server/src/order-drafts.ts:343-349` `UnsentDraft` | `billId`, `billNumber`, `ownerName`, `lineCount` |
| same file `:1245-1286` `readUnsentDrafts` | the open drafts with lines on each party's shown bills, grouped `(billId, ownerId)`, numbered in the bill list's order; one open draft per bill (`order_drafts_open_owner_uq`, `packages/db/src/schema/order-drafts.ts:51-53`) |
| `apps/server/src/working-order.ts:8144`, `:8564`, `:8600` | the floor read's party carries the map's entry |
| `apps/server/src/table-signals.ts:214-217` | the `unsent_draft` signal reads `ownerName` only; unchanged |
| `apps/till/src/api/client.ts:895-901`, `:2069-2070` | the till's copy of the type; `TableParty.unsentDrafts` |
| `apps/till/src/widgets/table-details-sheet.ts:18`, `:205`; `till-floor-screen.ts:2293`, `:2955`; `apps/till/src/state/table-precedence.ts:49` | the sheet's and map's "Alex has an unsent order" text and the ✎ cue; read `ownerName`/`lineCount`/length; unchanged |
| `apps/till/src/till-app.ts:10781` | the party it builds after seating a free table: `unsentDrafts: []`; unchanged |

69 test files name `unsentDrafts` (ran: `grep -rln … | grep test | wc -l`); probe 1 says which
break (below).

**The bar** (`apps/till/src/widgets/till-shell.ts`, read):

| Where | What it does today |
| --- | --- |
| `:48-57` `BarItem`; `:61-70` `LEAVE_ORDER` | transfers, equipment, profile, schedule, station, expo, find-bill, operator: first to leave first |
| `:464-471` `steps`, `chooserInMore` | above phone width, step 1 hides the brand mark and step n moves the first n − 1 present items of `LEAVE_ORDER` into ☰; at phone width the chooser moves into ☰ when the bar wraps |
| `:494-509` `#release`, `:511-524` `#present`, `:528-539` `#moved` | what ☰ holds; at phone width every present item; `find-bill` and `zones` always |
| `:656-696` `#fit` | adds steps while `#wraps()` (`:647-652`: the header or the `.tabs` strip overflows); steps back only when owed and ☰ is closed |
| `:718-727` `#chooser`; `:729-734` `#helpSwitch` | the language chooser (`layout` "menu" on the bar, "group" in a menu) and "?" |
| `:760-819` `#items` | find-bill, Pass (`expo`), Kitchen (`station`), My schedule, Profile, Zones on this device, Equipment, Transfers, in that order, on the bar or in ☰ |
| `:821-831` `#operatorAndLogout`; `:855-928` `#operatorActions` | the name's menu: clock actions, My hours, Fix my hours, then **Log out and Theme** on a handheld (`logout = formFactor !== "till"`, `:829`; `themeChoices` always, `:923-927`) |
| `:930-957` `#menu` | ☰: `#items` in ☰, then the name group, then the chooser when `chooserInMore` |
| `:959-990` `#tillMenu` | a till's ☰; **unchanged by this slice** |
| `:1011-1057` `#primaryTabs` | `role="tablist"`, each screen a `button.tab` with `role="tab"` and `aria-selected` (`:1044-1053`); styled `.tab[aria-selected="true"]` (`:271-275`) |
| `:1059-1115` `render` | handheld: brand mark only at step 0 with nothing but `find-bill`/`zones` moved (`:1082`); tabs = `builtInScreensFor` (Floor, Order, `apps/till/src/built-in-screens.ts:7-8`); session row `items · chooser · ? · name · ☰` (`:1094`) |

**The app** (`apps/till/src/till-app.ts`, read):

| Where | What it does today |
| --- | --- |
| `:19233-19289` the one `<till-shell>` | hands it `activeScreen = activeTabKey`, the affordances, the person, clock state, transfers; `screen-select` → `#requestLeave(() => #onTabSelect(screen))`, ignoring the active tab with no overlay |
| `:2446` `activeTabKey`; `:2450` `tableOpening`; `:2961` `activeTableId`; `:2989` `orderParty`; `:2952` `tables` | the open table and the floor read the app holds |
| `:2840` `#sessionPersonId` (set `:5071`, cleared `:2134`) | "the person any draft save goes in as": what an `UnsentDraft.ownerId` is compared with (D3) |
| `:5519-5530` `#orderScreenShown`, `#showOrderScreen`; `:18142-18146` `#tableOrderTabKey` | on a handheld a table opens on the Order screen (a built-in screen), shown at once while it loads |
| `:10567-10620` `#openTableFromEvent`; `:10632-10840` `#openTable` | opens a table; a different party's draft is **released** (`#releaseDraft`, `:10536-10556`: taken off the screen, its save left to answer, a failure kept in `#unsavedDrafts`, `:2633`); `activeTableId` is set when the open lands (`:10725`, `:10768`) |
| `:10399-10428` `#onTabSelect` | leaving the Order screen for Floor **flushes** the draft but keeps the table held (`activeTableId`, the draft sync); then re-reads the floor (`:10421-10427`) |
| `:16422-16455` `#leaveTable`, `#forgetParty`, `#returnToFloor` | a finished table: clears `activeTableId`, then selects Floor |
| `:11739-11758` | a send that empties the New order shows the Sent toast and **returns to Floor** (`#returnToFloor`); unchanged here |
| `:11070-11080` `#tableDraft`; `:11149-11152` | the held bill's draft store; every store change redraws the app |
| `:10476-10500` `#refreshFloor`, `#startTablesRead`, `#applyTables`; `:1953`, `:1956` `#tablesRead`, `#tablesApplied` | the floor read and its read numbers, which let a later read win |
| `:18237-18250` `<till-floor-screen>` | `.selectedZoneId` on a handheld = the saved choice's start, else `undefined` (slice 4 D2b) |

**The Floor's zone** (`till-floor-screen.ts`, read): the zone on screen comes from the address's
`till-zone` when the screen connects (`:940-946`) and is replaced by `selectedZoneId` whenever that
property changes (`:1001`), including its first value on a new element. On a handheld the Floor is
a new element on every return from the Order screen, because only the active tab is drawn
(`till-app.ts:18237`, `:18260`). So today a handheld with a saved choice returns to its "Opens
first" zone, and one without returns to the address's zone, the zone viewed before.

### Plan decisions for slice 3

- **D1. The floor read's `UnsentDraft` gains `ownerId: string` and `savedAt: string`**, the open
  draft's `owner_id` and `updated_at` as stored (ISO text, `tsString`, as `nowIso()` writes it).
  `readUnsentDrafts` selects both and groups by `orderDrafts.id` (one open draft per bill, so the
  rows are the same as today's `(billId, ownerId)` grouping; probe 1 ran this: the only failures
  were the twelve `toEqual`s that now see two more fields). The till's copy gains both, required.
  **`savedAt` is not read by the till in this slice**: slice 11 chooses a button's bill by it
  (design §3.1); it lands now because design §5 and §8 put both fields in this slice's read change,
  so slice 11 changes no server read. `ownerName` stays (the map's and the sheet's text read it).
- **D2. A handheld's bar is Floor, the table buttons, then the name (tablet, while it fits), "?"
  and ☰; nothing else is ever on it.** Pass, Kitchen, Find a bill, My schedule, Profile, Zones on
  this device, Equipment, Transfers and the language chooser are in ☰ at **every** width. Above
  phone width the bar still fits itself, but only two things leave it: the brand mark first, then
  the name (which moves into ☰ with its clock actions). **This departs from `main`**, where a
  tablet keeps Pass, Kitchen, My schedule, Profile, Equipment and Transfers on the bar while they
  fit (`LEAVE_ORDER`). **Why:** §3.1 says "Everything else is in ☰ … On a tablet the bar has room
  for the name as well (picture 06)", and §3.2 "The bar's table buttons … are as on a phone";
  picture 06 draws Floor, ✎ T4, ✎ T9, ● Ana, ?, ☰ and nothing else. The table buttons take the
  room those items had. **Alternative, for the owner:** keep today's fit on a tablet, the buttons
  competing with Pass, Kitchen and the rest for room.
- **D3. "This person's unsent dishes" are judged by `UnsentDraft.ownerId === #sessionPersonId`**,
  over every table the floor read lists. A party is listed **once**, with one button, if any of its
  shown bills has an open New order of this person's with lines (several bills give one button,
  §3.1); a party whose `state` is not `open` never is (a finished table, §3.1). The button names
  the party's tables by `tightName`, distinct, joined with "+" (as the Ready bar does), and opens
  its first table in the read's order (the read orders by `label`,
  `apps/server/src/working-order.ts`, `order by dt.label`, read). Buttons are in the read's order,
  so they do not move when one is added. **The device's zone choice does not hide a button**: a
  table in a zone the device does not show keeps its ✎ button, because the button exists to stop
  unsent dishes being forgotten, and hiding a zone with such a table is allowed (slice 4 D3b);
  opening it shows slice 4 D3's blocked order screen there. **Alternative, for the owner:** only
  the zones the device shows, as the Ready bar does (slice 5 D1).
- **D4. What the app knows better than the floor read wins, per bill.** The floor read is a
  snapshot (re-read on every return to Floor, every 15 s while the Floor shows, and after actions);
  the bar uses three sources, in this order, for each bill:
  - **The held table's bill** (the bill whose draft sync is bound, `#draftSync` with
    `#tableDraft()`): unsent when its store has a line **and the bill has not been taken by
    someone else**, judged as `sync.edit?.editorId != null && sync.edit.editorId !==
    sync.personId` (`DraftSync.edit`, a public copy of the bill's edit state,
    `apps/till/src/state/draft-sync.ts:332-334`; the same test `#editorRefusal` makes, `:448-455`).
    **Not** the store's lock: `#lockAuthority` (`:438-446`) also locks while the draft is still
    loading (`#edit === null`), while it recovers after a failed save or command
    (`#recoveryRequired`, set at `:626`, `:664`, `:844`, `:855`, `:863`), and while a local copy
    is held (`candidate !== null`), and a lock in those cases would drop ✎ exactly when the dishes
    are at risk (read). So ✎ appears on the first dish added, stays through a failed save, and goes
    when another person takes the bill or the last dish is sent or removed, without waiting for a
    read. A free table being seated
    (`orderParty === null`) uses its partyless draft (`#partylessDraft`).
  - **A released bill** (D10): what its draft held when it was released, until a floor read that
    started after its save answered has been applied, or for as long as its save failed and it sits
    in `#unsavedDrafts`.
  - **Every other bill**: the floor read.
- **D5. The language chooser is in ☰ at every width on a handheld**, in the Settings group, as the
  `layout="group"` row a till's ☰ holds (`#tillMenu`, `:978`); it is never on a handheld's bar, and
  `chooserInMore`'s phone-width move is deleted. **Why:** §3.1 "the language chooser (picture 01,
  right)" in ☰, and §6 retires "the language chooser on the phone bar (into ☰)". The kitchen
  display's corner keeps its chooser (`:1076-1079`), and a till is unchanged.
- **D6. ☰'s order, on a handheld, at every width** (§3.1, picture 01): (1) when the name is in ☰
  (phone width, or no room on a tablet): the name with its clock state, the clock actions, My hours,
  Fix my hours; (2) Pass, Kitchen, Find a bill, My schedule, Profile, Transfers (its count and
  button), each where offered; (3) a group headed **Settings** (`device_zones.settings`, "Settings"
  / «Ajustes», today's till word): Zones on this device, Equipment, Language, Theme; (4) Log out.
  Groups are separated by a token-coloured rule. The Settings group is a `div` with
  `role="group"` and `aria-labelledby` its visible heading, so a screen reader hears "Settings,
  group". **Kitchen** (not in §3.1's list) sits after Pass, both being kitchen views; **Transfers**
  and **Fix my hours** (not in the list) sit last in their groups. **On a tablet with the name on
  the bar**, the name's own menu holds only the clock actions, My hours and Fix my hours; **Log out
  and Theme leave the name's menu for ☰** (today they are in it on a handheld, `:829`, `:923`).
  **Log out is last**, as §3.1 lists it, so with every entry offered a phone's ☰ is taller than
  360×640 and Log out is reached by scrolling it (probe B: 759 px against a 632 px menu, Spanish,
  every affordance and the clock). The A681 check that pinned Log out unscrolled changes (Task 4b),
  and the open backlog entry "On a short phone the till's More menu is taller than the room it
  gets" gains the handheld's new order (Task 6). **Alternative, for the owner:** Log out before
  Settings, which keeps it unscrolled. A till's ☰ and name menu are unchanged.
- **D7. Equipment keeps its name and its one dialog.** Picture 01's "Card reader · printer" row is
  today's **Equipment** entry ("Equipment" / «Equipo», `equipment.open`), opening today's dialog,
  which also holds the cash drawer, payment-slip and invoice printers (`strings.ts:787-792`), so
  "Card reader · printer" would understate it, and it is not a word Q51 (g) settled. Slice 4 D6
  expected "the card reader and printer as separate entries"; one entry is kept because the dialog
  is one. **Departure from picture 01**; owner FYI.
- **D8. Language and Theme keep today's in-menu controls** (the chooser's group row and
  `themeChoices`' one row), only placed in the Settings group. Each is **already one row** (read:
  `wt-language-chooser`'s group layout is a label then one pressed-state button per language in a
  wrapping flex row, `packages/ui/src/components/wt-language-chooser.ts:51-60`, `:234-251`, so it
  takes a second line only when the languages do not fit the menu's width; `themeChoices` is a
  label and three icon buttons, `packages/ui/src/theme-choices.ts:60-87`, pinned one row at 320 px
  by "draws the Theme choices on one row inside More at 320 px"). So drawing picture 01's "Language
  · Español" value row would save no height and would need a menu opened inside ☰ (the chooser's
  `menu` layout is its own popover, `:276`): **not a cheap fix for D6's scroll**, which comes from
  the number of entries. Kept as today; Task 7 measures the group row's height at 360 px in Spanish.
  Owner FYI.
- **D9. A table button opens its table; which bill is slice 11's.** A button for **the table the
  app still holds** (left for Floor, `activeTableId` still set, its draft still bound) returns to
  it exactly as the Order tab did (`#onTabSelect("order")`: no re-read, the same bill and draft
  store; `till-app-kitchen-note.test.ts`'s round pins that today through the tab). A button for
  **any other table** opens it as a tap on the Floor does (`open-table` `{ tableId, seated: true }`
  through `#onOpenTable`), on the bill that path chooses today (`mainBillId`, else `billToOpen`,
  `:10731-10741`). Design §3.1's "opens the table on the bill this person last worked on" is slice
  11 (design §8 item 3: "the choice of bill on opening is slice 11"). Both go through
  `#requestLeave` and close an open overlay first (Find a bill, Pass, Kitchen, My schedule), as a
  tab does (`#onTabSelect` pops it, `:10416`). The current table's button with no overlay open does
  nothing, as the active tab does (`:19281-19286`).
  _2026-10-26: the held table's button returns to its order only while the floor read seats no
  other open party there; otherwise it opens the party the read seats there, and a party seated
  since gets no ✎ for the dishes of the party that left (commits "a table button opens the table it
  names, and a party seated since shows its ✎" and "a party seated at a table since gets no ✎ for
  the dishes of the party that left")._
- **D10. A table left for another table keeps its button.** Opening T9 from T4's screen releases
  T4's draft (`#releaseDraft`, `till-app.ts:10536-10556`) and no floor read follows, so a bar built
  from the read alone would drop ✎ T4 until the next Floor visit, though T4's dishes are saved
  unsent. So the app keeps each released bill's answer (D4: its store had a line and the bill was
  not someone else's) and acts on the save's three answers (`sync.flush()` resolves `"saved"`,
  `"failed"` or a refusal `{ refused, ownerName? }`, `:10547-10555`, `draft-sync.ts:239-244`):
  - **`"saved"`**: the record is marked with `#tablesRead` and, on a handheld, `#refreshFloor()`
    starts; the record gives way to the first read **started after** the save answered (read
    numbers, `#tablesRead`/`#tablesApplied`, `:1953`, `:1956`).
  - **`"failed"`**: the record stays while the draft sits in `#unsavedDrafts` (`:10550`): its
    dishes are on this device only, so the floor read cannot know them.
  - **A refusal** (another person took the bill, the draft was out of date, the session ended):
    the record is dropped at once and, on a handheld, `#refreshFloor()` starts, so the read
    decides; a refusal says the device's answer is no longer the truth.
  Every step runs only while the session it started in is the current one, as the callback's own
  checks do (`session !== this.#operatorSession`, `:10549-10552`), and after its
  `#leavingDrafts.delete(sync)` guard (`:10548`), so a sign-out or a server switch in between
  starts no read. Leaving for Floor needs none of this: the table stays held (D4) until the Floor's
  own read.
- **D11. The bar refreshes when the floor read does.** While a table is open nothing re-reads the
  other tables (slice 5 D7: the Floor, and its 15-second read, leave the page), so another device
  taking over one of this person's other bills shows on this device's bar at the next Floor visit.
  Nothing new polls. **Alternative, for the owner:** re-read the floor every 15 s on the Order
  screen too.
- **D12. Floor, after a table, opens on that table's zone.** The app remembers the zone of the
  last table it held on a handheld (`floorReturnZoneId`, taken in `willUpdate` whenever
  `activeTableId` changes to a table, so an open, a move of the party, Finish table and a resumed
  table all count) and hands the Floor `selectedZoneId` = that zone **when the Floor shows it**,
  else today's value (the saved "Opens first", else `undefined`); the address's `till-zone` is
  written with it, so a reload stays there. Slice 5's per-zone List/Map follows, because it is read
  per zone on screen. Before any table is opened, the Floor opens as today (slice 4 D2b). Signing
  out forgets it: `#onLogout` (`till-app.ts:18035`) clears it beside its own `till-zone` reset
  (`:18059`), and so does a server switch (`:2133-2134`). The same person signing back in with a
  table to resume (`#tableToResume`, `:18038-18047`) gets it again from that table, as any open
  does. A till is unchanged: its Floor stays on the page under a
  table, so changing `selectedZoneId` there would move it (`:1001`).
  _2026-10-26: once a table has been opened, while the Floor shows its zone, the Floor reads the
  zone from the address, which the move onto the Floor writes (`#setActiveTab`), so a language
  change keeps a zone tapped since (commit "a language change keeps the Floor on the zone the person
  tapped")._
- **D13. The table on screen.** The highlighted button is the table being opened while an open is
  under way (a new `openingTableId`, set where `#openTableFromEvent` shows the Order screen and
  cleared in its `finally` under the same `offerRequest === this.#tableOfferRequest` check that
  clears `tableOpening`, `:10625`, so an older open's clean-up never clears a newer open's mark),
  else the held table while the Order screen shows. Floor is the
  selected tab whenever no button is: on the Floor, and on the Order screen with no table (a reload
  of `/tabs/order` with nothing to resume, `:5210`). The **Order** screen stays a built-in screen
  (`built-in-screens.ts:7-8`, history still reaches it); only its tab is no longer drawn on a
  handheld. **Departure from Q51 (b) and design §4 example 1 (driver's ruling, 2026-10-26):** both
  say Ana sends everything at T9 while on it and its button stays highlighted without ✎ until she
  taps Floor. This slice keeps today's return to Floor after a send that empties the New order
  (`:11739-11758`), because what the order screen does after a send is slice 10's (handheld order
  at phone width); so that state is never reached through a send here. It is reached, and tested,
  these ways (read: the only `#returnToFloor`/`#leaveTable` callers are a send that empties the
  New order, `:11758`; an accepted transfer of the open bill, `:2054`; a bill move that leaves
  the party no bill, `:14538`; and a closed table, `:15967`): **removing the last unsent dish**
  (a line's removal, or Discard, `#onDiscardDraft` at `:12382`; neither calls either); **another
  person taking the bill** (D4); and **opening a table with nothing of this person's unsent**. (A
  partial send keeps ✎: lines remain, `:11754`.) Task 5a pins the first two. Task 6 opens the backlog entry for slice 10.
  _2026-10-26: `#showOrderScreen` sets it and `#endTableOpening` clears it with `tableOpening`; the stand-in is `shownBill` in bar-tables.ts._
- **D14. Each button is a tab.** In the bar's `role="tablist"`, a `button` with `role="tab"`,
  `aria-selected` "true" on the table on screen (as the screen tabs, `:1044-1053`), the class
  `bar-table` (not `tab`, so the many checks that count `.tab` keep counting screens) with the
  `.tab` look, and `data-bar-table` = its table id. Its content: `wt-icon name="floor-unsent"`
  (the map's ✎, registered by `@waitron/ui`'s `floor-chips.ts:15`, which the shell's
  `@waitron/ui` import loads, `packages/ui/src/index.ts:14`) `aria-hidden`, then the name. With ✎
  its accessible name is `shell.table_unsent` "{table} unsent" / «{table} sin enviar» (after Q51
  (g)'s "✎ Bill 2 unsent" «✎ Cuenta 2 sin enviar»; it contains the visible name, WCAG 2.5.3);
  without, its text. It emits `open-bar-table` `{ tableId }` (bubbles, composed). No help badge (a
  bar button carries none, design-system.md:2322). The selected look is today's selected tab
  (`:271-275`), not picture 01's filled blue. When the buttons do not fit, the strip scrolls
  sideways as it does today (`.tabs`, `:176-184`).
  _2026-10-26: the event also carries `held`, decided by `goesBack` in bar-tables.ts._
- **D15. The brand mark stays at step 0 on a wide handheld**, before Floor. Picture 06 draws none,
  but the spec says nothing of it and it is the venue's logo (design-system.md:5335-5340); with
  the other items gone it shows whenever everything fits. Owner FYI.
- **D16. "?" sits after the name and before ☰** on a handheld (picture 06: ● Ana, ?, ☰), so "?"
  and ☰ stay together at the end whether or not the name is on the bar. `main` draws "?" before the
  name (`:1094`). A till is unchanged.
- **D17. Copy.** One new key, `shell.table_unsent` (D14), in `apps/till/src/i18n/strings.ts`, en and
  es. `tab.order` ("Order" / «Pedido») is read only by `#screenTitle`'s template
  (`till-shell.ts:1007-1009`; ran: `grep -rn "tab\.order" apps/till/src`): delete it in both
  languages if the typecheck allows once no tab draws Order, else keep it and say why in the
  ledger. No other new words.

### Changed test checks (from the probes; the implementer confirms each)

Each probe ran the named suites on the probe worktree. Every failure is listed with its task and
reason. **Any failure outside these lists is a STOP.** A test listed for an earlier task may fail
again in a later task for that task's reason only if it is also in the later task's list or in
the "may fail again" note there.

**Probe 1 (ran): D1 on the server and the till's type.** Server typecheck: 0 errors
(`server-tsc.txt`). Till typecheck: **44 errors, all in 8 test files, none in a source file**
(`till-tsc.txt`): `src/screens/till-floor-screen.parties.test.ts` (21),
`till-floor-screen.precedence.test.ts` (8), `till-floor-screen.a11y.test.ts` (3),
`till-floor-screen.zone-tabs.test.ts` (1), `src/state/floor-look.test.ts` (3),
`src/state/table-precedence.test.ts` (2), `src/widgets/table-details-sheet.test.ts` (5),
`table-details-sheet.a11y.test.ts` (1): every one an `UnsentDraft` literal without the two
fields. **Fixture-only, Task 2.** And `till-app-drafts.test.ts`'s `lateSaveLiveFloor` (`:1061-1087`)
builds `unsentDrafts` inside an untyped mock, so the typecheck misses it; it gains `ownerId:
one.ownerId` and `savedAt` too (Fixture-only, Task 2), so a fake floor says whose draft it is.
`pnpm --filter @waitron/server exec vitest run src/order-drafts.db.test.ts src/party-main-bill.test.ts src/table-signals.test.ts`
→ `Test Files 1 failed | 2 passed (3)`, `Tests 12 failed | 328 passed (340)` (`server-run1.txt`).
The twelve, all in `apps/server/src/order-drafts.db.test.ts`, each a `toEqual` of the floor's
`unsentDrafts` that gains `ownerId` and `savedAt` with exact values (Task 1, Reason D1): "keeps two
bills by one editor separate and changes only the taken-over or emptied bill" (`:433`); "numbers
the bills in their shown order even when their drafts were saved in reverse" (`:459`); "keeps
Alex's and Sam's drafts apart, refuses Sam's save onto Alex's, and shows each unsent order on the
table" (`:475`); "does not show a draft with no lines as an unsent order, nor another party's
drafts" (`:511`); "names an owner with no person record as empty text, wherever the name is shown"
(`:540`); "shows one floor summary per bill even when its editors have the same name" (`:988`);
"gives Sam Alex's Beer, adds Sam's Beer into it, and refuses Alex's next save" (`:1866`); "takes a
bill in place while preserving the taker's own bill and its quantities" (`:1969`); "merges the
main bills after explicit takeover, retaining every row and the separate bill" (`:3284`);
"retains source identities and common positions through an ordinary save and takeover"
(`:4773`); "keeps a source-only draft in the floor count and allows placement saves without fresh
offers" (`:5175`); "counts each fresh and recalled row once when both sets contain several dishes"
(`:5281`).

The shell probes ran `pnpm exec vitest run src/widgets/till-shell src/screens/device-screens.phone-margin.test.ts src/screens/till-counter-screen.layout.test.ts src/widgets/guide-sheet.test.ts`
in `apps/till` (14 files, 359 tests). Probes A–C failed in five shell files (`till-shell.test.ts`,
`.a11y`, `.help`, `.help-phone`, `.menu-help`); probe D adds a sixth, `till-shell.device-zones.test.ts`.
The phone-margin, counter-layout, guide-sheet, venue-logo, device-zones look, counter-cleanup and
pass suites passed in every probe.

**Probe A (ran): D5 and D16 only** — the chooser never on a handheld's bar and always last in ☰,
☰ always drawn, "?" after the name; the fit unchanged → `Tests 39 failed | 320 passed (359)`
(`shell-runA.txt`, names in `fA.txt`). **Task 4a.** Reason for each: **D5** unless marked D16.
- `till-shell.a11y.test.ts` "the bar with its language chooser, closed and open, has no
  violations" (light and dark): it clicks the bar's chooser; it opens ☰ and checks the chooser's
  group there instead, still in both themes.
- `till-shell.help-phone.test.ts`, under "till-shell's language chooser at phone width, beside the
  Help switch": "a handheld at %ipx in %s keeps the chooser on the bar only when the bar fits"
  (360 and 390, en-GB and es-ES: four), "widening to 390 brings the chooser back to the bar", "the
  chooser does not move while More is open", "widening past phone width with More open keeps the
  chooser in More until it closes", "above phone width the chooser never leaves the bar", "going
  from 320 to above phone width puts the chooser back on the bar", "a newer fit that starts while
  an older one steps back decides where the chooser goes": **deleted** with the behaviour (the
  chooser no longer moves), replaced by Task 4a's new case. The till's cases in that file stay.
- `till-shell.help.test.ts` "the Help switch is on the bar at the top right, at handheld 390px"
  and "… 1280px": the bar's order is now name, "?", ☰ (**D16**).
- `till-shell.test.ts` under "till-shell": "places the language chooser in the bar, just before
  the operator's name" (becomes: a handheld's chooser is in ☰, never in `.session`); "shows the
  language's full name at 1280 wide and its short code at 390, always named in full" (it reads the
  bar's chooser; it reads ☰'s group row, which names each language in full at both widths).
- `till-shell.test.ts` under "till-shell at phone width": "keeps the header to one row at most 64 px
  tall" (en-GB, es-ES: the visible controls are 4, not 5); "puts every action button, the
  operator's name and the transfer count in one menu, by touch" and "reaches every action by
  keyboard" (☰ gains the chooser); "draws the wide handheld header with Find a bill in More and
  every other button in priority order" and "switches layout as the screen narrows and widens,
  keeping the one language chooser" (☰'s exact list gains `wt-language-chooser`).
- `till-shell.test.ts` under "till-shell above phone width", each a ☰ list that gains the chooser:
  "moves the transfers, and what ranks below Pass and Kitchen, into More before them, then Kitchen
  first" (full and compact handheld, en-GB and es-ES: four); "names the bar's transfers button with
  the short name" (en-GB, es-ES); "labels Log out … short word, in the name menu and inside More,
  keeping the counter header's full name" (en-GB, es-ES); "keeps Pass and Kitchen on a compact
  handheld's Spanish bar at 800 wide when its measured width fits there"; "keeps More in the bar's
  order, showing only the items that left"; "puts every item back on the bar, and the name, once the
  screen is wide enough"; "refits when actions are added, and gives them back when they go"; "keeps
  the visible count as the status while the transfers are on the bar"; "waits for an open More to
  close before giving items back to a wider bar"; "keeps every item in an open More when an item
  earlier in the leaving order appears"; "leaves kiosk mode cleanly while a fit begun in kiosk mode
  is still under way"; "keeps fitting after it is taken off the page and put back".
  A list grows by the chooser at its end; never loosen a list to a count.

**Probe B (ran): probe A plus D6** (☰'s groups and order, Theme and Log out out of the name's menu,
Log out last) → `Tests 61 failed | 298 passed (359)` (`shell-run2a.txt`, `f2a.txt`). The 22 not in
probe A are **Task 4b**'s, Reason **D6**:
- `till-shell.help-phone.test.ts` "in More the languages come last, after Theme" (becomes: the
  languages sit in the Settings group after Equipment and before Theme).
- `till-shell.help.test.ts` "above phone width items still leave for More in LEAVE_ORDER's order"
  (`shell-run2a.txt`: "660: More holds transfers,equipment,profile,schedule,operator" through
  "1500: More holds operator", 22 widths): it counts the operator as gone when ☰ holds `.logout`,
  and Log out is now always in ☰ (D6). **Task 4b makes it pass** by reading the operator's
  departure from ☰'s `.operator` (the name) instead; the leave order it checks still holds until
  Task 4d. In probe C it passed again, but only because every item was then in ☰, so its prefix
  check could not fail (read); Task 4d deletes it.
- `till-shell.menu-help.test.ts` "with help on, More shows a badge beside exactly the options that
  have help: handheld" and "turning help on from the bar while More is open shows the badges at
  once": the handheld row's badged labels follow ☰'s new order (Pass, Profile, then Zones on this
  device, Equipment in the Settings group; Transfers where shown).
- `till-shell.test.ts` under "till-shell": "the name opens the working / on_break / out clock
  actions with a text state" (three: the name's menu no longer ends with Log out); "keeps the
  theme chooser out of the bar, and puts Theme in the operator's menu just after Log out" (becomes:
  Theme is in ☰'s Settings group, after the languages, and not in the name's menu); "labels the
  operator's Theme choices in Spanish", "marks the new choice in the operator's menu when the theme
  choice changes", "asks for a theme picked in the operator's menu, closes the menu and leaves
  applying it to the app", "fills the pressed Theme choice, unlike an unpressed one and the menu's
  bordered buttons" (light and dark): each reads Theme in ☰ instead, its assertion unchanged;
  "offers Profile before Equipment only when the device can switch profile, emitting open-profile"
  (Profile, then the Settings group's Zones on this device and Equipment); "fits the header, every
  button on screen, at phone width in en-GB/es-ES with phone-portrait/tablet-landscape" (four:
  `expected 146 to be greater than 194` is its last line, `top(".station") > top(".find-bill")`
  (`till-shell.test.ts:640`): in D6's order Kitchen sits above Find a bill, so it becomes
  `top(".find-bill") > top(".station")`; its control count, 12 at `:621`, is rechecked against
  the new ☰ and stated exactly).
- `till-shell.test.ts` under "till-shell above phone width": "moves items into More in a fixed
  order as the screen narrows" (en-GB, es-ES; Task 4d deletes them, see probe C).
- `till-shell.test.ts` under "till-shell at phone width": "shows Log out inside the open More menu
  without scrolling at 360x640, in Spanish" and "… 390x664 …" (`expected 759 to be less than or
  equal to 632`/`656`): Log out is last (D6). **Rename** to "puts Log out last in More, reachable
  by scrolling it, at %ix%i, in Spanish": Log out is the menu's last child, the menu scrolls
  (`scrollHeight > clientHeight`), and after `scrollTop = scrollHeight` Log out lies inside the
  menu's box. The receipt changes; the owner's alternative is D6's.
- May fail again in Task 4b for D6 (☰ lists or order): any probe A test whose ☰ list includes the
  chooser, notably "puts every action button …", "reaches every action by keyboard" (the tab order
  follows ☰'s new order), "keeps More in the bar's order …", "labels Log out … short word …" (Log
  out is in ☰ only now) and the a11y case.

**Probe C (ran): probe B plus D2 in the shell's fit** (only the name leaves the bar) → `Tests 76
failed | 283 passed (359)` (`shell-run1.txt`, `f1.txt`). The 16 not in probe B are **Task 4d**'s,
Reason **D2**, together with probe B's "moves items into More in a fixed order" (two) and "above
phone width items still leave for More in LEAVE_ORDER's order" (Task 4b's change; it passes in
probe C only vacuously, as probe B's line says), which Task 4d deletes:
- **Deleted with the behaviour** (they state an order among several leaving items, and only the
  name leaves now): "moves items into More in a fixed order as the screen narrows" (en-GB, es-ES);
  "moves the transfers, and what ranks below Pass and Kitchen, into More before them, then Kitchen
  first" (four); "keeps Pass and Kitchen on a compact handheld's Spanish bar at 800 wide when its
  measured width fits there"; "keeps every item in an open More when an item earlier in the leaving
  order appears"; `till-shell.help.test.ts` "above phone width items still leave for More in
  LEAVE_ORDER's order". Replaced by Task 4d's new cases.
- **Retargeted to the name, keeping each case's behavioural point** (`leaveOrder` in the describe,
  `:1218-1226`, becomes the one item `["operator", ".operator-menu"]`; the cases fill the bar with
  `barTables` buttons from Task 4c, so the name competes for room as it will in use): "fits as a
  fresh bar does when the name grows, then the transfer count changes / the name shrinks, then the
  transfer count changes / the name grows, then shrinks back before the first refit has finished"
  (nine batches: their guard `want.length < leaveOrder.length` becomes "the fresh bar keeps the
  short name and moves the long one", at a width the implementer measures and states); "keeps an
  open More, and everything in it, when the screen widens out of phone width"; "keeps an open More,
  gaining what is left, when the screen narrows into phone width"; "keeps everything in More when
  an open More that held a redraw closes at phone width, and refits once wider"; "refits when the
  operator's name grows"; "refits when the shell redraws between More closing and its toggle
  event"; `till-shell.menu-help.test.ts` "on the bar an option with help stays a plain button, with
  no row" (no option with help is on a handheld's bar now; it moves to a till's bar, whose Pass is a
  plain button with no row); `till-shell.test.ts` "a handheld's More offers Zones on this device at
  every width, emitting open-device-zones (2560)" (its roomy half now also finds every other entry
  in ☰, D2).
- May fail again in Task 4d: any probe A or B test under "till-shell above phone width", for D2
  (what is on the bar above phone width). Each keeps its point with the name as the moving item, or
  is deleted only if it states an order among several leaving items; list each in the ledger.

**Probe D (ran): probe C plus D13/D14's shell part** (no Order tab on a handheld; `barTables`
buttons) → shell `Tests 82 failed | 277 passed (359)` (`shell-run2.txt`, `f2.txt`). The six not
in probe C are **Task 4c**'s, Reason **D13** (no Order tab on a handheld; the strip's tabs are
Floor alone). Task 4c runs before Task 4d, so these six and the 36 below meet a bar that still
fits the old way; none of them reads the fit (read: each counts or names tabs; not run in that
order):
- `till-shell.device-zones.test.ts` "keeps a single counter a plain tab and hides selling screens
  outside the device selection" (its last step expects `["Floor", "Order"]` for phone-portrait;
  now `["Floor"]`).
- `till-shell.test.ts` "fixed primary screens for phone-portrait work without an authored tab
  list" and "… tablet-landscape …"; "translates fixed primary screens for phone-portrait on a
  language switch" and "… tablet-landscape …" (`["Floor"]`, `["Sala"]`); under "till-shell at
  phone width", "shows every tab in full at 360 px with a counter-zone menu, in Spanish" (its
  handheld row has one tab).
The same probe ran every `src/till-app*.test.ts` and `src/screens/till-counter-cleanup.look.test.ts`
(ran: `pnpm exec vitest run src/till-app src/screens/till-counter-cleanup.look.test.ts` →
`Test Files 2 failed | 38 passed (40)`, `Tests 36 failed | 4313 passed (4349)`, `app-run1.txt`).
All 36 are **Task 4c**'s, Reason **D13**:
- `till-app-boot-and-counter.test.ts` "A182 LOOK primary %s" for `phone-floor`, `phone-order`,
  `tablet-floor`, `tablet-order` × en-GB/es-ES × light/dark × 390/1280 (32, one `it.each` at
  `:6116-6119`): its `.tab` count for a handheld becomes 1 (`:6325`); the buttons are `.bar-table`,
  not `.tab` (D14), so Task 5a does not change it again.
- `till-app-boot-and-counter.test.ts` "navigates the fixed phone-portrait primary screen to order"
  and "… tablet-landscape …" (`:5847-5868`): their rows click the second `.tab`. The two handheld
  rows become "draws only Floor as a tab on a %s": one `.tab`, and `history.pushState` to
  `/tabs/order` plus a `popstate` still mounts the embedded `till-table-order-screen` (the Order
  screen stays a built-in screen, D13). The till row is unchanged.
- `till-app-kitchen-note.test.ts` "keeps a note-only round across phone-portrait Floor, Order and
  Back/Forward while an old read waits" and "… tablet-landscape …" (`:1884-1946`): its table has
  no unsent dishes, so after Floor it has no button (D3). Replace the click on the second `.tab`
  with `history.back()` (to `/tabs/order`), and the later `back()`/`forward()` pair with
  `forward()`/`back()`, so the round still ends on the Order screen with the same draft store,
  note and revision; every `expect` after the round stays as it is.

**Probe E (ran): Tasks 5a, 5b and 5c in the app, on top of probe D** (worktree
`/tmp/a797-3-probe.MtAy/wt3` at probe D's commit, removed afterwards): a simplified `#barTables()`
fed to the shell as a cached array (D3, D4 with the `edit.editorId` takeover test, the held and
released bills), the `open-bar-table` handler (D9), `floorReturnZoneId` and the Floor's
`selectedZoneId` (D12), and in `#releaseDraft` the kept record plus a session-guarded
`#refreshFloor()` after a saved or refused answer on a handheld (D10); and Task 2's
`lateSaveLiveFloor` fixture with `ownerId: one.ownerId`, the one app-level fixture that names the
signed-in person, so its fake floor yields buttons. Then (ran: `pnpm exec vitest run src/till-app
src/screens/till-counter-cleanup.look.test.ts src/widgets/till-shell.test.ts` in `apps/till` →
`Test Files 3 failed | 38 passed (41)`, `Tests 99 failed | 4360 passed (4459)`, `app-runE.txt`,
names in `fE.txt`). The 99 are exactly probe D's 63 `till-shell.test.ts` failures and its 36 app
failures (ran: `comm -23 fE.txt fprev.txt` → nothing new, where `fprev.txt` is `f2.txt` plus
`app-run1.txt`'s names). So **Tasks 5a–5c change none of today's checks**: the handheld suites that
count floor reads (`till-app-parties.test.ts`, `till-app-table-service.test.ts`) and
`till-app-drafts.test.ts`'s tablet cases passed with the extra read in place. The probe's
`#barTables()` was simpler than Task 3's rule (no partyless held table, no `openingTableId`), so
**may fail, and why**: a case in `till-app-drafts.test.ts`, `till-app-parties.test.ts`,
`till-app-table-service.test.ts` or `till-app-open-table.test.ts` that counts `getTablesState`
calls on a handheld while a draft is released and a refusal comes back (the refusal's read was in
the probe; a case driving that on a handheld was not found by it), or that counts the shell's
`[role=tab]` while a free table is being seated. Accept such a change only if the extra read is
D10's or the extra tab is D13's, the count stays exact, and the ledger names it with that reason;
anything else is a STOP. Task 3 is a new module.
A failure in any suite a task names that is not above is a STOP.

### Review focus (inputs the spec implies and today's tests may not pin)

1. **The same person on two phones.** Ana saves dishes at T4 on phone A; phone B, signed in as
   Ana, shows ✎ T4 after its next floor read (owner id, not device); tapping it on B opens T4
   (D3, D9). Task 5a pins it with a floor read naming Ana's id and no local draft.
2. **A takeover.** Sam takes over Ana's bill at T4. On Ana's device, with T4 on screen: the store
   locks and the button loses ✎ at once (D4); with T4 not on screen: the button goes at the next
   floor read (D11). Tasks 3 and 5a.
3. **Two bills, one table, two people.** Ana's Bill 1 and Sam's Bill 2 at T4: Ana's device shows
   one ✎ T4, Sam's one ✎ T4; Ana with two bills of her own still sees one (D3). Task 3.
4. **A party at T4 and T5** (today's join, or a party seated at both): one button "T4+T5",
   opening T4, the first listed (D3). Task 3, with fixture short names that differ from the full
   names so the test tells `tightName` from `label`.
5. **Leaving T4 with new dishes by tapping ✎ T9.** ✎ T4 never leaves the bar, before or after
   T4's save answers, and stays if that save fails (D10). Task 5c, with the save held open.
6. **Finish table.** No button for it; the Floor opens on its zone (D3, D12). Task 5b.
7. **A table in a zone the device hides** keeps its ✎ button; opening it shows ordering blocked
   (D3; slice 4 D3). Task 5a.
8. **Floor after a table whose zone the Floor does not show** (reached through Find a bill or a
   transfer): the Floor opens as before, on the saved "Opens first", the address's zone or the
   first tab (D12). Task 5b.
9. **A reload on `/tabs/order` with nothing to resume**: Floor drawn selected, no button selected
   (D13). Task 4c (shell) and 5a (app).
10. **A person switch or sign-out**: the bar is rebuilt for the new person and `floorReturnZoneId`
    forgotten, also when the same person signs back in (D3, D12). Task 5a, 5b.
11. **A failed save at the open table**: the store locks for recovery, but the bill is still this
    person's, so T4 keeps ✎ on the Order screen and after Floor (D4). Task 3 (case 12), Task 5a
    (case 6b).
12. **A refused save of a released bill** (someone took it meanwhile), and **a sign-out before a
    released save answers**: the kept button goes and the read decides; no read starts after the
    sign-out (D10). Task 5c (cases 6, 7).
13. **App redraws that change no button** (every dish added while ✎ already shows) hand the shell
    the same array, so the bar does not step back and refit (Task 5a case 6d).

---

**Task order and why.** The server read first (Task 1), then the till's type and fixtures
(Task 2), then the pure rule that turns a floor read into buttons (Task 3). The shell in four
parts, each with its probe's list: the language chooser into ☰ and "?" after the name (4a); ☰'s
groups and order (4b); no Order tab, and the table buttons (4c); the fit that only the name leaves
(4d), which uses 4c's buttons to fill the bar. Then the app in three parts: the buttons wired (5a),
Floor on the last table's zone (5b), a left table's kept button (5c). Then docs (Task 6) and the
LOOK (Task 7). Each leaves the tree green and is sized well under 100 tool calls. **Tasks 4a
(39 checks, ten deleted) and 4d (about 20 cases rewritten in one describe) are the heaviest**: an
implementer on either that passes about 150 calls stops at a green (or cleanly red) point, commits
and hands over (global rule), and a fresh implementer continues. The till is a browser package: check free memory first
(`memory_pressure | grep free`) and read each run's `Tests` count.

### Task 1: The floor read says whose each New order is, and when it was last saved

**Files:**
- Modify: `apps/server/src/order-drafts.ts` (`UnsentDraft` `:343-349`; `readUnsentDrafts`
  `:1245-1286`: select `ownerId: orderDrafts.ownerId` and `savedAt: orderDrafts.updatedAt`, group
  by `orderDrafts.id`, push both)
- Test: `apps/server/src/order-drafts.db.test.ts`

**Interfaces:**
- Produces: `UnsentDraft.ownerId: string` (the draft's `owner_id`), `UnsentDraft.savedAt: string`
  (its `updated_at`, as stored).

- [ ] **Step 1: Failing tests**, in "floor bill/editor pairs" (`:425`): (a) "carries each unsent
  order's owner id and the time it was last saved": Alex saves at T4; set that draft's stored
  `updated_at` to `"2026-01-01T00:00:00.000Z"` through `db.update(orderDrafts)` (a value no save
  writes, so the read must come from the column); the floor's entry has `ownerId: ALEX` and
  `savedAt: "2026-01-01T00:00:00.000Z"`; Alex saves again and the entry's `savedAt` equals the
  stored `updated_at` and is not the old value. (b) "names the taker as the owner once a bill is
  taken over": Sam takes Alex's bill (the file's takeover helper, as "gives Sam Alex's Beer…",
  `:1866`, does) and the entry's `ownerId` is `SAM`. Add a helper `savedAtOf(draftId)` reading
  `order_drafts.updated_at`.
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/server exec vitest run src/order-drafts.db.test.ts -t "owner id and the time|names the taker"`.
- [ ] **Step 3: Implement** D1.
- [ ] **Step 4: Update probe 1's twelve server checks**, each `toEqual` gaining `ownerId` (the
  saver's constant, `ALEX`/`SAM`/the random `nobody`) and `savedAt: await savedAtOf(<draft>.id)`.
  Exact values, never `expect.any`. Ledger: each name with Reason D1.
- [ ] **Step 5: Run** `pnpm --filter @waitron/server exec vitest run src/order-drafts.db.test.ts src/party-main-bill.test.ts src/table-signals.test.ts`
  → probe 1's 340 tests plus the two new, all pass. Typecheck server; eslint; format check.
- [ ] **Step 6: Commit** `git commit -s -m "A797-3: the floor read says whose each unsent order is and when it was saved"`

### Task 2: The till's type carries the owner id and saved time (fixtures only)

**Files:**
- Modify: `apps/till/src/api/client.ts` (`UnsentDraft` `:895-901`: `ownerId: string` after
  `billNumber`, `savedAt: string` last; one line saying `savedAt` is the New order's last save)
- Test: probe 1's eight files and `till-app-drafts.test.ts`'s `lateSaveLiveFloor` (Fixture-only)

Nothing reads the fields yet, so no test is written first.
- [ ] **Step 1:** add the fields; `pnpm --filter @waitron/till typecheck 2>&1 | grep -c "error TS"`
  → 44, in probe 1's eight files only (a source file in the list is a STOP).
- [ ] **Step 2: Fixture-only edits** (by a script kept outside the worktree; read its diff): each
  `UnsentDraft` literal gains `ownerId` (a person id the fixture already uses, else `"p-<owner
  name in lower case>"`) and `savedAt: "2026-10-26T12:00:00.000Z"`; `lateSaveLiveFloor` gains
  `ownerId: one.ownerId` and `savedAt: "2026-10-26T12:00:00.000Z"`.
- [ ] **Step 3: Run** `pnpm --filter @waitron/till typecheck` (0 errors), then
  `pnpm --filter @waitron/till exec vitest run src/screens/till-floor-screen.parties.test.ts src/screens/till-floor-screen.precedence.test.ts src/screens/till-floor-screen.a11y.test.ts src/screens/till-floor-screen.zone-tabs.test.ts src/state/floor-look.test.ts src/state/table-precedence.test.ts src/widgets/table-details-sheet.test.ts src/widgets/table-details-sheet.a11y.test.ts src/till-app-drafts.test.ts`:
  all pass, unchanged.
- [ ] **Step 4:** eslint; `pnpm format:check`; ledger (Fixture-only files);
  `git commit -s -m "A797-3: the till's floor type carries each unsent order's owner and saved time"`

### Task 3: Which tables get a button, and what each says

**Files:**
- Create: `apps/till/src/state/bar-tables.ts`, `apps/till/src/state/bar-tables.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface BarTable { tableId: string; name: string; unsent: boolean; current: boolean }
  /** The bill whose draft this device holds or has just released (D4): how many lines its store
   * holds, and whether someone else now edits the bill (`edit.editorId` set and not this person). */
  export interface LocalBill {
    partyId: string | null; tableId: string; billId: string | null; lines: number; takenByOther: boolean;
  }
  export function barTables(
    tables: readonly TableState[],
    personId: string,
    local: { held: (LocalBill & { onScreen: boolean }) | null; released: readonly LocalBill[] },
  ): BarTable[];
  ```
  Rules (D3, D4, D13): one entry per open party with a shown bill of `personId`'s unsent, the held
  party also while `onScreen`; per bill the held answer, else a released one, else the floor's; a
  local bill is unsent when `lines > 0 && !takenByOther` (D4: never the store's lock); a released
  bill whose party the read no longer lists, or lists as not open, gives no entry;
  `name` = the party's tables' `tightName`s (`joinMembersById(tables)`), distinct, joined "+";
  `tableId` = the held table for the held party, else the party's first table in `tables`'
  order; entries in `tables`' order; `current` only on the held party while `onScreen`. A held
  table with `partyId: null` (a free table being seated) is an entry while `onScreen` or `unsent`,
  named by its own `tightName`. An empty `personId` gives no entries (nobody signed in).

- [ ] **Step 1: Failing tests** (fixture short names differ from labels: label "Terrace 4", short
  name "T4"):
  1. "lists a table where this person has unsent dishes, by its short name" — Ana's draft at T4,
     Sam's at T9 → `[{ tableId: "t4", name: "T4", unsent: true, current: false }]` for Ana.
  2. "gives one button for several of this person's bills at one table".
  3. "lists no table whose New orders are someone else's or a closed party's" (Sam's only; a
     `state: "closed"` party with Ana's draft).
  4. "names a party at two tables by both short names, opening the first listed" — today's join
     T4+T5 (`today.joinId`) → `name: "T4+T5"`, `tableId: "t4"`; a party at T4 and T5 with no join
     → also "T4+T5".
  5. "keeps the floor read's order when a table is added" — buttons for T2 and T9, then T4 gains a
     draft → T2, T4, T9.
  6. "draws the table on screen as current, with ✎ only while something of this person's is unsent"
     — held T4, `onScreen`, `unsent: false`, no floor draft → `{ unsent: false, current: true }`;
     `unsent: true` → ✎; held but not on screen and not unsent → no entry.
  7. "trusts the held bill over the floor read, and the read for the party's other bills" — floor
     says Ana's draft on Bill 1 and Bill 2; held Bill 1 `unsent: false` → still unsent (Bill 2);
     floor says only Bill 1, held Bill 1 `unsent: false` → not unsent.
  8. "trusts a released bill over the floor read" — floor has no draft at T4; released T4 Bill 1
     `unsent: true` → ✎ T4; floor has Ana's draft at T9, released T9 `unsent: false` → no T9.
  9. "lists a free table being seated while it is on screen" — held `partyId: null`, table T3.
  10. "lists nothing with nobody signed in" — `personId: ""`.
  11. "lists a table in any zone the read gives" (D3: no zone filter) — a table in a second zone.
  12. "keeps ✎ on a held bill with lines that nobody else has taken, and drops it once someone has"
      — held T4 `lines: 2, takenByOther: false` → ✎ (whatever else locks the store, D4, I1);
      `takenByOther: true` → current without ✎, and no entry once not on screen.
  13. "gives no button for a released bill whose party is gone or closed" — released T4 `lines: 1`
      with T4's party absent from the read, then with `state: "closed"` → no entry.
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/till exec vitest run src/state/bar-tables.test.ts` (module missing).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run; PASS.** Typecheck till; eslint; format check; ledger;
  `git commit -s -m "A797-3: which tables get a button on a handheld's bar"`

### Task 4a: A handheld's language chooser is in ☰, and "?" comes after the name

**Files:**
- Modify: `apps/till/src/widgets/till-shell.ts` (delete `chooserInMore` and its uses, `:468-471`,
  `:489-491`, `:543`, `:665-675`, `:955`; the handheld session row `:1094` becomes `items · name ·
  ? · ☰`, ☰ always drawn on a handheld; the chooser drawn last in ☰ as `#chooser("group")`; the
  observer's chooser watch `:612-617` goes if nothing else needs it)
- Test: probe A's files: `till-shell.test.ts`, `till-shell.help-phone.test.ts`,
  `till-shell.help.test.ts`, `till-shell.a11y.test.ts`

- [ ] **Step 1: Failing tests:** in `till-shell.help-phone.test.ts`, "a handheld keeps the language
  chooser in More at every width, never on the bar" (`it.each` 320, 390, 1024, 2560 × en-GB, es-ES):
  no `wt-language-chooser` in `.session`; one inside ☰, `layout="group"`; picking a language there
  asks for it (the existing "picking a language in More asks for it" stays). In
  `till-shell.help.test.ts`, "a handheld's bar reads name, Help, More at the end" at 1280 (name on
  the bar) and "Help, More" at 390.
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/till exec vitest run src/widgets/till-shell.help-phone.test.ts src/widgets/till-shell.help.test.ts`.
- [ ] **Step 3: Implement** D5 (the chooser last in ☰ for now; Task 4b moves it into the Settings
  group) and D16.
- [ ] **Step 4: Update probe A's 39 checks** as listed (ten deleted, the rest each as its line
  says); ledger, one line each with its reason.
- [ ] **Step 5: Run** the probe's suites:
  `pnpm --filter @waitron/till exec vitest run src/widgets/till-shell src/screens/device-screens.phone-margin.test.ts src/screens/till-counter-screen.layout.test.ts src/widgets/guide-sheet.test.ts`
  → all pass. Typecheck till; eslint; format check.
- [ ] **Step 6: Commit** `git commit -s -m "A797-3: a handheld's language chooser is in More, and Help sits after the name"`

### Task 4b: ☰ on a handheld follows design §3.1's order

**Files:**
- Modify: `apps/till/src/widgets/till-shell.ts` (`#menu` `:930-957`; `#items` `:760-819`, its ☰
  order; `#operatorActions` `:855-928` gains a `theme` flag, false for a handheld's name menu;
  `#operatorAndLogout` `:829` passes `logout: false` on a handheld; CSS for the group rule and the
  heading, `--wt-*` tokens only), `apps/till/src/i18n/strings.ts` only if a word is missing (none
  expected: the heading is `device_zones.settings`)
- Test: probe B's files: `till-shell.test.ts`, `till-shell.menu-help.test.ts`,
  `till-shell.help-phone.test.ts`, `till-shell.help.test.ts`, `till-shell.a11y.test.ts`

- [ ] **Step 1: Failing tests** in `till-shell.test.ts`, a new describe "a handheld's More":
  (a) "holds the name group, the screens, the Settings group and Log out, in that order, at 390"
  with `full` plus the clock: the exact list by item — name, clock actions, My hours, Fix my
  hours; Pass, Kitchen, Find a bill, My schedule, Profile, transfers count and button; the
  Settings heading, Zones on this device, Equipment, the language group, Theme; Log out last;
  (b) "names the Settings group by its heading" — `role="group"`, `aria-labelledby` → a visible
  element reading "Settings", «Ajustes» in es-ES; (c) "keeps Log out and Theme out of the name's
  menu when the name is on the bar" (2560: the name's menu holds the clock actions, My hours and
  Fix my hours only; Log out and Theme are in ☰); (d) "a till's More and name menu are unchanged"
  (the till's lists as today). In `till-shell.a11y.test.ts`, "a handheld's open More, with its
  Settings group, has no violations" in both themes.
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/till exec vitest run src/widgets/till-shell.test.ts src/widgets/till-shell.a11y.test.ts -t "handheld's More|Settings group"`.
- [ ] **Step 3: Implement** D6, D7, D8.
- [ ] **Step 4: Update probe B's 22 checks**, and any probe A test that fails again for D6 (the
  note under probe B), as listed; ledger.
- [ ] **Step 5: Run** Task 4a's Step 5 command → all pass. Typecheck; eslint; format check.
- [ ] **Step 6: Commit** `git commit -s -m "A797-3: a handheld's More follows the design's order, with a Settings group"`

### Task 4c: No Order tab on a handheld; the table buttons

**Files:**
- Modify: `apps/till/src/widgets/till-shell.ts` (`@property({ attribute: false }) barTables:
  readonly BarTable[] = []` (type from Task 3); `render`'s `screens` drops `"order"` on a
  handheld; Floor is `aria-selected` when no button is `current`; the buttons in `#primaryTabs`'
  `nav` after the screens, D14; `.bar-table` shares `.tab`'s rules; add `barTables` to
  `CONTENT_PROPERTIES` `:74-92` so a change refits: every change there owes a step-back and a refit,
  `:554-557`, which is why Task 5a must hand over the same array while the buttons are unchanged),
  `apps/till/src/i18n/strings.ts`
  (`shell.table_unsent` en/es; `tab.order` per D17)
- Test: `till-shell.test.ts`, `till-shell.device-zones.test.ts`, `till-shell.a11y.test.ts`,
  `till-app-boot-and-counter.test.ts`, `till-app-kitchen-note.test.ts`

**Interfaces:**
- Consumes: Task 3's `BarTable`.
- Produces: `till-shell`'s `barTables` property and its `open-bar-table` `{ tableId }` event.

Between this task and Task 5a the branch has no Order tab and no app-fed buttons, so on a handheld
an open table is reached again only from the Floor or by Back; the PR lands whole, never between
tasks (Closing).
- [ ] **Step 1: Failing tests** in `till-shell.test.ts`, describe "a handheld's table buttons":
  1. "draws Floor, then one button per table, in the order given" — `barTables` T4 (unsent), T9
     (unsent): `[role=tab]` texts Floor, T4, T9; each button holds a `wt-icon[name=floor-unsent]`;
     no `.tab` reads Order.
  2. "names a button with unsent dishes 'T4 unsent', and one without by its name" — en and es
     (`«T4 sin enviar»`); the button without ✎ has no icon and no `aria-label`.
  3. "selects the table on screen and not Floor; selects Floor when no table is current" —
     `current: true` on T4 → T4 `aria-selected="true"`, Floor `"false"`; none current with
     `activeScreen: "order"` → Floor `"true"` (D13).
  4. "emits open-bar-table with the table's id" — one event, `bubbles` and `composed`.
  5. "a till draws no table buttons" — `formFactor: "till"` with `barTables` set.
  6. "the strip scrolls sideways when the buttons do not fit at 360, keeping Help and More on
     screen" — ten buttons; `.tabs` `scrollWidth > clientWidth`; "?" and ☰ inside the header.
  In `till-shell.a11y.test.ts`: "the bar with a selected table button and an unsent one has no
  violations", light and dark.
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/till exec vitest run src/widgets/till-shell.test.ts -t "table buttons"`.
- [ ] **Step 3: Implement** the shell's part of D13, D14, D17.
- [ ] **Step 4: Update probe D's 6 shell checks and 36 app checks** as listed; ledger.
- [ ] **Step 5: Run** Task 4a's Step 5 command, then
  `pnpm --filter @waitron/till exec vitest run src/till-app-boot-and-counter.test.ts src/till-app-kitchen-note.test.ts`
  → all pass. Typecheck; eslint; format check; `pnpm --filter @waitron/till exec vitest run src/i18n`.
- [ ] **Step 6: Commit** `git commit -s -m "A797-3: a handheld's bar draws a button per table instead of the Order tab"`

### Task 4d: Above phone width only the name leaves a handheld's bar

**Files:**
- Modify: `apps/till/src/widgets/till-shell.ts` (on a handheld: every present item but `operator`
  always in ☰; the fit's leaving list is `["operator"]`, so `#release`, `#moved` and `#fit`'s
  `most` (`:691`) work over it; the brand mark at step 0 whatever ☰ holds, `:1082`, D15;
  `LEAVE_ORDER` and `#present` cut to what still reads them, or deleted)
- Test: probe C's files: `till-shell.test.ts`, `till-shell.help.test.ts`,
  `till-shell.menu-help.test.ts`

- [ ] **Step 1: Failing tests** under "till-shell above phone width": (a) "keeps only Floor, the
  table buttons, the name, Help and More on a handheld's bar, every other entry in More, at 1280
  and 2560" (en-GB, es-ES, `full`); (b) "hides the brand first, then moves the name into More, as
  table buttons fill the bar, and gives both back as they go" — at 1024, add `barTables` buttons
  one at a time: the brand goes first, then the name joins ☰'s top with its clock actions; remove
  them and both return; (c) "shows the brand mark at step 0 though More holds every entry" (D15).
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/till exec vitest run src/widgets/till-shell.test.ts -t "above phone width"`.
- [ ] **Step 3: Implement** D2 and D15.
- [ ] **Step 4: Update probe C's checks** (delete the eight that state an order among several
  leaving items; retarget the rest to the name, each keeping its behavioural point) and any earlier
  task's test under "above phone width" that fails again for D2; ledger, one line each. A count is
  never loosened; a deleted case is named in the ledger with "deleted with the behaviour: only the
  name leaves".
- [ ] **Step 5: Run** Task 4a's Step 5 command, then `src/till-app-boot-and-counter.test.ts`
  (its tablet LOOK at 1280) → all pass. Typecheck; eslint; format check.
- [ ] **Step 6: Commit** `git commit -s -m "A797-3: above phone width only the name leaves a handheld's bar"`

### Task 5a: The till app draws the buttons and opens their tables

**Files:**
- Modify: `apps/till/src/till-app.ts` (new private `#barTables(): BarTable[]` building Task 3's
  `local.held` from `activeTableId`, `orderParty`, `#tableDraft()`/`#partylessDraft` and
  `#orderScreenShown()`, `takenByOther` from `#draftSync.edit` (D4); new `@state() private
  openingTableId?: string` (D13, cleared under the `offerRequest` check, `:10625`); the shell gets
  `.barTables=${…}` at `:19233`, **the same array object while its contents are unchanged**: the
  app redraws on every draft change (`:11149-11152`) and a new array would make the shell step
  back and refit each time (`till-shell.ts:554-557`), the reason `#affordanceList` is kept stable
  (`:4093-4094`); keep the last answer and replace it only when a JSON of it differs (one shared
  empty array on a till); `@open-bar-table` handler (D9))
- Create: `apps/till/src/till-app-bar-tables.test.ts` (its setup copied from the top of
  `till-app-drafts.test.ts`, `:146-427`: `party`, `table`, `till`, `stubApi`, `mountApp`,
  `signIn`, `openMesa`; with `draftServer`, `apps/till/src/widgets/test-helpers.ts:340`)

**Interfaces:**
- Consumes: Task 3's `barTables`; Task 4c's `barTables` property and `open-bar-table`.
- Produces: `#barTables()`, which Task 5c extends with `released`.

- [ ] **Step 1: Failing tests** (phone-portrait unless named; both form factors where cheap):
  1. "shows ✎ T4 on the Floor when the floor read names this person's unsent order there" — and
     none for Sam's (Review focus 1: the read alone, no local draft).
  2. "selects the open table's button, with ✎ from the first dish added and none once it is
     removed" — open T4 (nothing unsent): one button T4, selected, no icon; add a dish → icon; remove
     it → no icon.
  3. "keeps ✎ T4 after Floor, and its button returns to the same draft without a re-read" — add a
     dish at T4, tap Floor: T4's button unselected with ✎, Floor selected; tap it: the Order screen,
     `draftStore` the same object, `getTablesState` not called again by the tap (D9).
  4. "drops the open table's button on Floor when nothing of this person's is unsent there".
  5. "opens another table's button as a Floor tap does, closing an open overlay" — Find a bill open,
     tap ✎ T9: the overlay closes and T9 opens (`open-table` path: its offers are read).
  6. "loses ✎ at once when another device takes the open bill, keeping the button selected"
     (Review focus 2: the bill's edit state naming another editor, as `till-app-drafts.test.ts`'s
     takeover cases drive it): this is D13's "highlighted without ✎" reached without a send.
  6b. "keeps ✎ T4 after a failed save, on the Order screen and after Floor" (D4, I1): the draft's
     save rejects (`draft-sync` enters recovery and locks the store); T4's button keeps ✎ while
     selected, and after Floor too.
  6c. "removing the last unsent dish leaves the button selected without ✎ and stays on the table"
     (D13): add a dish, remove it: the Order screen still shows, T4 selected, no icon.
  6d. "hands the shell the same array when a redraw changes no button" (I3): with ✎ T4 shown, add
     a second dish; `shell.barTables` is the same object (`toBe`), and a spy on the shell's
     `updated` sees no `barTables` change.
  7. "selects the table being opened while it loads" — tap ✎ T9 from T4 with T9's offers held:
     T9 selected, not T4.
  8. "rebuilds the buttons for the next person" — Ana's ✎ T4; sign in as Sam: no T4 (Review focus
     10).
  9. "keeps a hidden zone's table's ✎ button" — a device zone choice without T4's zone (D3; the
     `getDeviceZones` stub as in `till-app-device-zones.test.ts`).
  10. "a till's bar has no table buttons" (`formFactor: "till"`).
  11. "selects Floor on the Order screen with no table" — a reload on `/tabs/order` (Review focus 9).
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/till exec vitest run src/till-app-bar-tables.test.ts`.
- [ ] **Step 3: Implement** D4 (held part), D9, D13.
- [ ] **Step 4: Run; PASS**, then the app suites:
  `pnpm --filter @waitron/till exec vitest run src/till-app src/state/bar-tables.test.ts src/widgets/till-shell.test.ts`
  → all pass (none of today's checks changes; a failure is a STOP). Typecheck; eslint; format
  check.
- [ ] **Step 5:** ledger; `git commit -s -m "A797-3: a handheld's bar shows this person's tables with unsent dishes"`

### Task 5b: Floor, after a table, opens on its zone

**Files:**
- Modify: `apps/till/src/till-app.ts` (`@state() private floorReturnZoneId?: string`, set in
  `willUpdate` (`:4028`) when `activeTableId` changes to a table on a handheld, cleared in
  `#onLogout` (`:18035`, beside its `till-zone` reset, `:18059`) and at a server switch
  (`:2133-2134`); the Floor's
  `.selectedZoneId` at `:18243-18249`, D12; `till-zone` written with the Floor tab)
- Test: `apps/till/src/till-app-device-zones.test.ts` (its `mountHandheld`, a new describe "Floor
  after a table")

- [ ] **Step 1: Failing tests** (`room` and `garden` table zones; the first tab is `bar`):
  1. "opens the Floor on the zone of the table just left, not the zone viewed before" — on `room`,
     open a `garden` table through its bar button (or Find a bill), tap Floor → the Floor's active
     tab is `garden`, and the address's `till-zone` is `garden`.
  2. "beats a saved Opens first once a table has been opened" — saved start `room`; open a `garden`
     table, Floor → `garden`; before any table, sign-in → `room` (slice 4 D2b unchanged).
  3. "opens a finished table's zone" (Review focus 6) — finish the `garden` table → Floor on
     `garden`.
  4. "opens as before when the Floor does not show that zone" (Review focus 8) — device choice
     `["room"]`, a `garden` table reached through Find a bill, Floor → `room`.
  5. "forgets the zone at sign-out, for the next person and the same one" — on the Floor after a
     `garden` table, sign out; Sam signs in → today's opening zone; sign out, Ana signs back in with
     no table to resume → today's opening zone too.
  6. "a till's Floor does not move when a table opens over it" (`formFactor: "till"`).
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/till exec vitest run src/till-app-device-zones.test.ts -t "Floor after a table"`.
- [ ] **Step 3: Implement** D12.
- [ ] **Step 4: Run; PASS**, then Task 5a's Step 4 command plus
  `src/screens/till-floor-screen.refresh.test.ts src/screens/till-floor-screen.zone-tabs.test.ts`.
- [ ] **Step 5:** typecheck; eslint; format check; ledger;
  `git commit -s -m "A797-3: a handheld's Floor opens on the zone of the table just left"`

### Task 5c: A table left for another keeps its button

**Files:**
- Modify: `apps/till/src/till-app.ts` (`#releaseDraft` `:10536-10556`: record the released bill
  (party, table, bill, its store's line count and `takenByOther` from `sync.edit`); after the
  callback's `#leavingDrafts.delete(sync)` guard and only while `session === this.#operatorSession`:
  `"saved"` marks it with `#tablesRead` and, on a handheld, starts `#refreshFloor()`; `"failed"`
  keeps it while it sits in `#unsavedDrafts`; a refusal drops it and, on a handheld, starts
  `#refreshFloor()` (D10); drop a saved record once `#tablesApplied` passes its mark; clear all
  with `#dropLeavingDrafts` and `#dropOthersDrafts` (`:11197-11215`) and when an unsaved draft is
  reopened (`:11089-11091`); `requestUpdate()` on each change; `#barTables()` passes them as
  `released`)
- Test: `apps/till/src/till-app-bar-tables.test.ts`

- [ ] **Step 1: Failing tests** (T4 and T9 seated; a save held open, as `till-app-drafts.test.ts`'s
  `holdNextSave`, `:1096-1110`):
  1. "keeps ✎ T4 while T4's save is out after ✎ T9 is tapped" — add a dish at T4, tap ✎ T9 (from
     an earlier visit): ✎ T4 present at once and while the save is held.
  2. "keeps ✎ T4 after the save answers, until a floor read started later says so" — release the
     save: one `getTablesState` call follows; until it answers ✎ T4 stays; its answer (naming
     Ana's draft at T4) keeps it.
  3. "drops T4's button when its last dish was removed before leaving, once the later read agrees".
  4. "keeps ✎ T4 while T4's save has failed" — the save rejects; ✎ T4 stays; tapping it reopens T4
     with the kept dish.
  5. "a till starts no extra floor read when a draft is released" (`formFactor: "till"`).
  6. "drops T4's kept button and re-reads the floor when T4's save is refused" (D10, I2) — the
     held save answers `draft.taken_over` with Sam's name: the record goes, one `getTablesState`
     call follows, and its answer (Sam's draft at T4) leaves no T4 button.
  7. "starts no floor read when the person signs out before the save answers" (D10, I2) — release
     T4, sign out, then answer the save (saved, and in a second run refused): `getTablesState` is
     not called after the sign-out.
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/till exec vitest run src/till-app-bar-tables.test.ts -t "keeps ✎ T4|drops T4|floor read"`.
- [ ] **Step 3: Implement** D10.
- [ ] **Step 4: Run; PASS**, then Task 5a's Step 4 command.
- [ ] **Step 5:** typecheck; eslint; format check; ledger;
  `git commit -s -m "A797-3: a table left for another keeps its button until the floor agrees"`

### Task 6: Docs, the user guides and the backlog follow the code

**Files:**
- Modify: `apps/server/src/guide/en/table-service.md`, `apps/server/src/guide/es/table-service.md`
  (a new section before `{#short-names}`, en `:137`, es `:141`; the short-names section's first
  sentence; `{#device-zones}`'s path on a phone, en `:170-171`, es its twin),
  `docs/developers/design-system.md` (the Help switch's place, `:2310-2313`, and its badge list
  `:2320-2322`; the language and Theme paragraphs on a handheld, `:5292-5311`; "A handheld keeps the
  adaptive bar", `:5335-5342`; the fixed-screens table and the sentence after it, `:5377-5382`),
  `docs/backlog.md` (both A797 entries, `:120-129` and `:2774-2786`; the More-height entry
  `:2117-2123`), `docs/backlog/till.md` (A797's entry, `:1046-1066`),
  `docs/backlog/till.md:1779` (the A740 record's slice-4 line: "under ☰ → Zones on this device"
  gains "in ☰'s Settings group since slice 3"), design-system.md `:5329-5330` (a till's ☰,
  unchanged: add "on a till" so it is not read as a handheld's; `:5341`'s handheld sentence goes
  with the paragraph Step 3 rewrites),
  `docs/superpowers/specs/2026-10-18-a797-device-screens-design.md` (§3.1, dated sentences; the
  dated note under worked example 6, `:459-462`, whose "not under Settings" becomes untrue),
  this plan's slice 3 outline (already says "expanded below")
- Test: `apps/server/src/guide-content.test.ts`, `scripts/guide-links.test.ts`

No guide describes a handheld's bar today (ran: `grep -n "^## \|More\b\|☰\|top bar" apps/server/src/guide/en/table-service.md`
→ only the zones section's ☰ path, `:170-171`).
- [ ] **Step 1: Guides.** `## Get back to your tables with unsent dishes {#unsent-tables}` / `##
  Volver a tus mesas con platos sin enviar {#unsent-tables}`, four to six sentences: on a phone or
  tablet the bar shows **Floor**, then a button such as **✎ T4** for each table where you have
  dishes not yet sent, by the table's short name; one button for a table however many of your
  bills there have unsent dishes; the table you are at is highlighted, and its button goes once
  you leave it with nothing of yours unsent; if someone else takes over your bill there, your
  button goes; tapping **Floor** after a table opens that table's zone; everything else is in
  **More** (☰): your name and clock actions, the screens your profile allows, **Settings** (Zones
  on this device, Equipment, Language, Theme) and **Log out**. The short-names section's first
  sentence names "the bar's table buttons and the Ready bar". The zones section's phone path:
  "open **More** (☰) and choose **Zones on this device**, under **Settings**". Spanish twin with
  «Sala», «Más», «Ajustes», «Zonas en este dispositivo», «Equipo», «Idioma», «Tema», «Salir»
  (read each from `apps/till/src/i18n/strings.ts`'s `es` block before writing).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and
  `pnpm exec vitest run scripts/guide-links.test.ts`; PASS.
- [ ] **Step 3: design-system.md.** Rewrite the handheld paragraph: the bar is Floor, a button per
  table with this person's unsent dishes (D3, D14), then the name while it fits (above phone width;
  the brand mark leaves first, then the name), "?" and ☰; every other entry in ☰ at every width,
  in D6's order with a Settings group; the language chooser in that group (D5); Theme and Log out
  in ☰, not the name's menu; Floor after a table opens its zone (D12). The Help switch on a handheld
  sits after the name and before ☰ (D16). The fixed-screens table keeps "Floor, Order" as a
  handheld's screens, and the sentence after it says Order has no tab on a handheld: the open
  table's button stands for it.
- [ ] **Step 4: Backlog.** Both A797 entries and `till.md`'s: slice 3 in review with this plan
  linked; slices 6–7 next (or as the lane orders). The More-height entry gains one sentence: on a
  handheld, since slice 3, Log out is last in ☰ after the Settings group (design §3.1), so with
  every entry offered it needs a scroll at 360×640 (D6). **Open one new entry** in the till area,
  tied to slice 10: "A handheld stays on the table after its last send, so its button shows
  highlighted without ✎" — design §4 example 1 and Q51 (b) describe Ana staying on T9 after
  sending everything; today a send that empties the New order returns to the Floor
  (`till-app.ts:11754-11758`); slice 3 kept that (its D13, the driver's ruling of 2026-10-26)
  because the order screen after a send is slice 10's. Its number from
  `~/waitron-campaign-shared/next-item-number` (read it, use it, write the next back). Add another
  entry only for something the LOOK finds that this slice does not fix, numbered the same way.
- [ ] **Step 5: Design file.** Under §3.1's ☰ list, one dated sentence: "2026-10-26, slice 3:
  Equipment keeps its name and dialog for picture 01's 'Card reader · printer' row, Language and
  Theme keep today's controls, Log out is last and needs a scroll on a short phone, and a table
  button opens its table as the Floor does until slice 11 chooses the bill; see the build plan's
  slice 3, D6–D9." Under §3.1's "The bar once a table is finished" bullet, one dated sentence:
  "2026-10-26, slice 3: a send that empties the New order still returns the handheld to the Floor,
  so the highlighted button without ✎ shows after removing the last unsent dish, after a takeover,
  or on a table opened with nothing unsent, not after a send; staying on the table after a send is
  slice 10's (the build plan's slice 3, D13; backlog A<n>)." Under "On a tablet the bar has room for
  the name as well", one dated sentence: the brand mark stays at step 0 (D15). Under worked example
  6's dated note (`:459-462`): "2026-10-26, slice 3: the entry now sits in ☰'s Settings group,
  under its heading."
- [ ] **Step 6: Check** `pnpm exec prettier --file-info docs/backlog.md` prints `"ignored": true`
  (wrap by hand); `pnpm format:check` for the guide files.
- [ ] **Step 7: Commit** `git commit -s -m "docs: A797-3 — guides, design system and backlog for the handheld's bar"`

### Task 7 (visual): LOOK at the handheld's bar

- [ ] **Step 1: Start the stack** `wa-wt demo waitron-feat-a797-3-handheld-bar`; `wa-wt ls` for
  the URLs. Enrol a browser context as a device on the Handheld profile («Móvil») from the
  dashboard's Devices page (a dev box approves a join at once; the till still asks which device a
  tab is). Sign in as a person with a PIN; note their name.
- [ ] **Step 2: Look** with the workspace's Playwright Chromium (script in
  `/Users/clintongormley/waitron-campaign-c/a797-3-scripts/`, never in the worktree, its process id
  recorded), at **390 px** and **1024 px**, **light and dark**, **English and Spanish**:
  - the Floor with nothing unsent: Floor, "?", ☰ (and the name at 1024);
  - open a Dining room table, add two dishes, tap Floor: the Floor opens on Dining room, the bar
    reads Floor · ✎ T… (the demo's short names, `apps/server/scripts/demo-seed/floor.ts`); switch
    to Terrace, open a Terrace table, add a dish, then tap the Dining room table's button: **two
    buttons, the open one selected**, both with ✎;
  - the Order screen of a table with nothing unsent: its button selected without ✎;
  - ☰ open at 390: the name group, the screens, **Settings** with its heading, Language and Theme,
    Log out last; at 1024 the name's own menu (clock actions only);
  - **at 360×640 in Spanish**, ☰ open: whether Log out needs a scroll (D6), recorded either way;
  - ten tables with unsent dishes at 390 (send dishes through the till first): the strip scrolls
    sideways and "?" and ☰ stay put (D14).
- [ ] **Step 3: Save** the PNGs under `/Users/clintongormley/waitron-campaign-c/a797-3-shots/`
  (`<step>-<width>-<theme>-<lang>.png`), open each, describe them in the ledger and the PR body.
  Expected: the buttons read in full with their ✎; the selected one reads as a selected tab; ☰
  fits 390 px wide without sideways scrolling.
- [ ] **Step 4: Stop** what you started: the script by its recorded process id, then
  `wa-wt down waitron-feat-a797-3-handheld-bar`.

### Closing slice 3

- Focused runs per task as above. CI runs the server's and the till's package suites and coverage.
  Read the `changes` job's outputs and both packages' coverage or merge jobs on the current head
  before calling the PR green.
- **The PR lands whole.** Between Task 4c and Task 5a the branch has no Order tab and no app-fed
  table buttons (a handheld returns to an open table only from the Floor or by Back); every task is
  green, but no task between them is a state to ship.
- `/finish-branch` with this plan named. Review path **FULL**: per-task reviews, the
  plan-against-spec read, and two Codex run-it reviews (the second told to set this plan's checklist
  aside and test what it does not name).
- PR body. **First line: "No venue reset needed."** Then: **What a person sees** (the bar on a
  phone and a tablet; ☰'s order; Floor after a table); **Read change** (`UnsentDraft` gains
  `ownerId` and `savedAt`; no route, no migration); **Decisions** D1–D17 in one line each;
  **Changed test checks** (from the ledger: Task 1's twelve, Task 4a's 39, Task 4b's 22, Task 4c's
  6 + 36, Task 4d's, grouped as the probes are, deleted cases named as deleted); **Fixture-only**
  (Task 2's nine files); **Departures** (from the pictures: D7 Equipment's name, D8 the controls'
  look, D14 the selected look, D15 the brand mark; from Q51 (b) and design §4 example 1: D13, a
  send that empties the New order still returns to the Floor, so the highlighted button without ✎
  is not shown after a send; slice 10, with Task 6's backlog entry); **LOOK**.
- **Owner FYI** (one line each in the PR and the lane's questions file, not questions):
  - D2: on a tablet only the name joins Floor, the table buttons, "?" and ☰; Pass, Kitchen and the
    rest are in ☰ even where they would fit.
  - D3: a table in a zone this device hides still gets its ✎ button.
  - D6: Log out is last in ☰, so on a short phone with every entry it needs a scroll.
  - D7/D8: ☰ shows "Equipment" for the card reader and printers, and today's Language and Theme
    controls, not picture 01's value rows; those controls are already one row each, so value rows
    would not shorten ☰ or spare the scroll to Log out.
  - D13: after Ana sends everything at T9 the handheld still returns to the Floor, so T9's
    highlighted button without ✎ shows only after she removes her last unsent dish, after someone
    takes her bill, or on a table she opens with nothing unsent; staying on T9 after the send is
    slice 10's (backlog entry from Task 6).
  - D11: while a table is open, another device's takeover of one of your other bills shows on your
    bar at your next visit to the Floor.
- After merge: delete the branch local and remote and check the remote one is gone; update the
  ledger; then the next slice.

---

## Slice 6 — Ready warning time, data (one PR, branch `feat/a797-6-ready-warning-data`)

**What it changes.** Each prep station gets a fourth minutes value, its **Ready warning** time,
3 minutes unless someone changes it (Q51 (c) as the owner answered it, design §10): how long that
station's dishes may stand ready at the pass before the handheld's Ready bar warns. The station
editor and Add station show it after the three late-flag minutes. The floor read's `ready` signal,
which already lists each station's ready dishes at a table, gives every station's entry two more
facts: **when its oldest ready dish became ready** and **that station's warning minutes**. Slice 7
draws the warning from those two facts; this slice draws nothing on the till. In the same fields
Q51 (f) 7 replaces "Warm" with the till's word "Waiting" and unifies the Spanish to the till's words
(«Esperando», «Con retraso», «Olvidado»).

**Review path: FULL.** A migration in the core set (CLAUDE.md §3), and a cross-package contract: the
`ready` signal's `ReadyAtStation` (`packages/shared/src/table-signals.ts:38-42`) is built by the
server (`apps/server/src/table-signals.ts:99-125`) and read by the till through
`apps/till/src/api/client.ts:65-70` (`TableState.signals`, `:2241`; a counter bill's `signals`,
`:1344`). Fields are only added; no route starts refusing anything it accepted, except a station
write or an import that carries a bad ready warning (D3).

**Migration: one, core set, no venue reset** — one `ALTER TABLE … ADD` with a constant default, no
table rebuilt (D1 quotes the probe's generated SQL). The PR's first line says "No venue reset
needed": an existing station takes 3 minutes.

How claims are marked in this section: **(ran)** means run on 2026-10-26 against `main` at
`9cebf025a` (this worktree's base); **(read)** means read in the code at that commit. The probes ran
in throwaway worktrees (`git worktree add --detach /tmp/a797-6-probe.NDR4/wt 9cebf025a`, and a
control at `/tmp/a797-6-probe.NDR4/base`, the base itself), both removed afterwards; their logs and
the probe's whole diff stay in `/tmp/a797-6-probe.NDR4/` (`guards.txt`, `db.txt`, `shared.txt`,
`prov.txt`, `prov-base.txt`, `rep.txt`, `fiscal.txt`, `server-run.txt`, `vs-run.txt`,
`till-tsc.txt`, `till-run.txt`, `probe.diff`). None of the probe code is in this branch.

### Every reader and writer this slice touches (ran: grep; each line read)

From `grep -rlnE "forgottenAfter|forgotten_after|overdueAfter|warmAfter|warm_after" packages apps scripts`
(ran, over `*.ts`, `*.json`, `*.sql` and `*.md` outside `drizzle/meta`: 70 files, most of them tests and fixtures), `grep -rn "byStation" apps packages`
(ran) and `grep -rn "readyAt\|ready_at" apps/server/src packages/db/src` (ran), each line read:

| Where | What it does today | In this slice |
| --- | --- | --- |
| `packages/db/src/schema/kitchen-stations.ts:18-21`, CHECK `:53-56` | the three late-flag columns, ordered by `kitchen_stations_thresholds_ordered` | gains `ready_warning_after_minutes`, outside the CHECK (D1) |
| `packages/shared/src/timing.ts:4-15`, re-exported `packages/shared/src/index.ts:132-133` | `StationThresholds` (the three band limits `classifyBand` reads) and `DEFAULT_STATION_THRESHOLDS` | gains `DEFAULT_READY_WARNING_AFTER_MINUTES = 3` and `StationTiming`; `StationThresholds` unchanged (D2) |
| `packages/shared/src/table-signals.ts:12-13`, `:38-42` | `{ kind: "ready"; byStation: ReadyAtStation[] }`, each entry `stationId`, `stationName`, `count` | each entry gains `oldestReadyAt` and `readyWarningAfterMinutes` (D4) |
| `apps/server/src/table-signals.ts:23-33` (`KitchenLine`), `:36-96` (`readKitchenLines`), `:99-125` (`kitchenSignals`) | one query for a set of bills' fired, unserved, not-made-here lines with their station and band limits; `ready` per station, then `long_wait` | selects `ticket_items.ready_at` and the station's warning minutes; the `ready` entry carries the oldest stamp and the minutes (D4) |
| `readBillSignals` (`:128-135`) → the counter's tab list (`apps/server/src/working-order.ts:4908`); `readPartySignals` (`:162-244`) → the floor read (`working-order.ts:8343`) | both build their `ready` through `kitchenSignals` | both carry the two facts with no change of their own |
| `ticket_items.ready_at` (`packages/db/src/schema/ticket-items.ts:59`, nullable) and its writers: `advanceSet` (`apps/server/src/working-order.ts:7202-7218`), used by `advanceTicketItem`/`advanceTicket` and the group bumps (`order-groups.ts:626`, `working-order.ts:2826`); made-here items (`working-order.ts:1894-1895`, `:2176-2177`) | every product write of `state = 'ready'` stamps `ready_at` (read); made-here items are left out of the signal by `readKitchenLines`'s `madeHere = false` (`table-signals.ts:71`) | read only (D4) |
| `order-groups.ts:1946-1961` | the Sent box's "Ready n min": the latest `ready_at` of a line's components, skipping a null stamp | the precedent for D4's null handling; unchanged |
| `packages/provisioning/src/kitchen-timing.ts:5-84` (`parseStationTimingPatch`, `assertStationTiming`, `assertImportedStationTimings`); re-exported for the server at `apps/server/src/kitchen-timing.ts:1-5`; the import calls it at `packages/provisioning/src/configuration-transfer.ts:625` | parse a route's minutes (whole, 1–2147483647, else `management.request_invalid` `{ field }`); refuse an unordered set (`station.thresholds_invalid`); check an import's rows, a missing minute read as its default | parse and bound the fourth; never order it (D3) |
| `apps/server/src/kitchen.ts:28-45` (`Station`), `:80-124` (`createStation`), `:126-150` (`listStations`), `:168-219` (`updateStation`) | the station writes and the stations list (`GET /management-api/stations`) | write and read the fourth (Task 4) |
| `apps/server/src/management-api.ts:1561-1604` (POST), `:1606-1613` (GET), `:1628-1712` (PATCH) | parse the body (minutes through `parseStationTimingPatch`, `:1590`, `:1697`) | the body types name the field; the parse does the work (Task 4) |
| `packages/db/src/configuration-transfer.ts:66-70` | `kitchen_stations` travels with every column it does not omit (it omits none) | the column travels with no change; the import's check is Task 3 |
| `apps/server/scripts/demo-seed/seed-catalogue.ts:59-74`, `packages/provisioning/src/venue-apply.ts:304-310` | insert stations naming no minutes | take the column's default, 3; unchanged (D9) |
| `packages/venue-service/src/dashboard/routing-client.ts:31-46` (`PrepStation`), `:64-70` (`StationInput`), `:125-147` (`updateStation`) | the prep-stations screen's client types | gain the field (Task 7) |
| `packages/venue-service/src/dashboard/station-editor.ts:40-80`, `:131-151` (`timingErrors`), `:178-216` (refusal placement and text), `:245-249`, `:289-297` (`.timing-fields`, three columns), `:631-656` | the editor's three minutes fields under "Late flags (minutes)", labelled from `prep.health.warm`/`overdue`/`forgotten` | the fourth field, the two-column grid (D6), its own message (D5) (Task 7) |
| `packages/venue-service/src/dashboard/prep-stations-screen.ts:160-165`, `:752-766`, `:791-806`, `:824-838`, `:1007-1025`, `:1091` | Add station's draft, checks and fields; the editor's opened station | the fourth field (Task 8); the editor gets the station's value (Task 7) |
| `packages/venue-service/src/dashboard/strings.ts` en `:218-223`, `:248-250`, `:303`, `:322`; es `:1105-1110`, `:1135-1137`, `:1191`, `:1210` | the labels and the order message | Q51 (f) 7's words and the new ones (Task 6, D5) |
| `apps/dashboard/src/api/client.ts:740-745`, `:3363-3388` | the dashboard app's own `Station` type (a subset: no colour, no printing choices) and two write helpers only `client.test.ts` calls (ran: `grep -rn "\.createStation(\|\.updateStation(" apps/dashboard/src`) | unchanged (D8) |
| `packages/reporting/src/overdue-orders.ts:49-51`, `:90-94` | the overdue report classifies by the three band limits | unchanged: it reads no ready time (D11) |
| `apps/till/src/state/table-signals.ts:34` (`readyByStation`), `:62` (`readyTables`), `apps/till/src/state/floor-look.ts`, `apps/till/src/widgets/signal-chips.ts` | read `byStation`'s `stationName` and `count` | unchanged; slice 7 reads the two new facts. 14 till test files build `byStation` entries and gain them (Fixture-only, Task 5) |

### Plan decisions for slice 6

- **D1. The column is `kitchen_stations.ready_warning_after_minutes`**
  (`readyWarningAfterMinutes: count("ready_warning_after_minutes").notNull().default(3)`, after
  `forgottenAfterMinutes`), named like its three siblings (`warm_after_minutes`, …) and the label
  "Ready warning after (min)". It owns no CHECK. **Generated (ran, the probe,
  `pnpm --filter @waitron/db db:generate --name station_ready_warning`):**
  ```sql
  ALTER TABLE `kitchen_stations` ADD `ready_warning_after_minutes` integer DEFAULT 3 NOT NULL;
  ```
  as `packages/db/drizzle/0192_station_ready_warning.sql` (the next free number, ran: `ls
  packages/db/drizzle | tail` → `0191_table_short_names.sql`). `kitchen_stations` is in the core set
  (`packages/db/drizzle`, classified `state` at `packages/db/src/classification.ts:123`), so
  `pnpm --filter @waitron/db db:generate` writes it. **Why no CHECK of its own (ran, a second
  probe):** a `check("kitchen_stations_ready_warning_positive", sql\`… >= 1\`)` beside the new
  column made drizzle-kit 0.31.11 generate a rebuild — `PRAGMA foreign_keys=OFF`, `CREATE TABLE
  \`__new_kitchen_stations\``, an `INSERT … SELECT` that names `ready_warning_after_minutes` from the
  old table (which has no such column: CLAUDE.md §3's "must not also add a column" trap), `DROP
  TABLE \`kitchen_stations\`` — a STOP twice over. So the bound lives in the writers (D3), as the
  schema's comment at `:18` already says of the three. **Why no venue reset:** SQLite fills an
  `ADD … DEFAULT 3 NOT NULL` column on existing rows with the default; the migration-upgrade guard,
  which migrates populated databases, passed with it (ran, below), and its `CANDIDATES` needed
  nothing (a NOT NULL column with a default is not a nullable candidate). No existing migration
  file is edited. **2026-10-26, at finish-branch:** main's #2106 took 0192 first
  (`0192_privacy_contact.sql`), so this migration was regenerated, not hand-edited, as
  `packages/db/drizzle/0193_station_ready_warning.sql`, with the same one `ALTER TABLE … ADD`.
- **D2. `@waitron/shared` gains `DEFAULT_READY_WARNING_AFTER_MINUTES = 3` and
  `type StationTiming = StationThresholds & { readyWarningAfterMinutes: number }`** in `timing.ts`,
  re-exported from `index.ts`. **`StationThresholds` stays the three band limits**: it is what
  `classifyBand` reads, and it types the station read's and the pass read's `thresholds`
  (`apps/till/src/api/client.ts:1671`, `:1899`; `working-order.ts:7405`, `:7842`), whose readers
  never need a ready warning; widening it would add the field to those reads and to every till test
  that builds a `StationThresholds` (seven test files, ran: `grep -rn "StationThresholds" apps packages --include='*.ts'`).
  The station types that do carry the fourth (`Station`, `PrepStation`, `StationInput`,
  `StationEditorStation`, `StationTimingPatch`) use `StationTiming`.
- **D3. The ready warning is a whole number of minutes from 1 to 2147483647, in no order with the
  late flags.** It runs on its own clock (from `ready_at`, design §5) while the late flags run from
  `queued_at`, so "Ready warning 20, Forgotten after 15" is a valid station. Bounded in three
  places, the same three that bound the late flags (`kitchen-timing.ts`):
  - **the routes:** `parseStationTimingPatch` parses it with the three (absent → not in the patch;
    anything else not a whole number in range → `management.request_invalid`
    `{ field: "readyWarningAfterMinutes" }`, as `:14-20` refuses a late flag);
  - **the writers:** `assertStationTiming` refuses a patch whose `readyWarningAfterMinutes` is out
    of range with `station.thresholds_invalid` `{ field: "readyWarningAfterMinutes", stationId?,
    name }`, and never compares it with the late flags, which it still orders exactly as today;
  - **the import:** `assertImportedStationTimings` reads a row's `ready_warning_after_minutes`,
    absent or `undefined` as 3 (as `:79` reads a missing late flag as its default), and refuses one
    out of range with `station.thresholds_invalid` `{ field: "readyWarningAfterMinutes", name }`,
    before anything is written. An explicit `null` is refused (the column is NOT NULL). The order
    of checks within one station is the three's order check first, then the ready warning, so a
    station wrong in both is named by its late flags, as today.
- **D4. Each `ReadyAtStation` gains `oldestReadyAt: string | null` and
  `readyWarningAfterMinutes: number`.** `oldestReadyAt` is the earliest stored `ticket_items.ready_at`
  among exactly the lines that station's `count` counts (fired, unserved, not made here, `state =
  'ready'`, over the party's family or the counter bill), compared with `Date.parse` and sent as
  stored. It is `null` only when none of those lines has a stamp: the column is nullable
  (`ticket-items.ts:59`) though every product write of `ready` stamps it (the table above), so a
  null can come only from rows written outside the product's code; `order-groups.ts:1946-1961`
  skips a null stamp the same way. `readyWarningAfterMinutes` is the station's own column, read in
  the same query (each line joins its own station, `table-signals.ts:64`). **Why a timestamp, not
  the minutes already waited:** the till compares the server's timestamps with its own clock
  elsewhere — the held group's `dueAt` (`apps/till/src/state/floor-look.ts:122-135`) and the Sent
  box's `readyAt` — and slice 7 must count the minutes up between reads (a handheld's Floor reads
  every 15 s, slice 5 D7). **Alternative, for the reviewer:** the server sends the seconds already
  waited, immune to a device whose clock is wrong but stale between reads. **Slice 7 needs no
  further data change:** a station's dishes warn once `now − oldestReadyAt ≥
  readyWarningAfterMinutes` minutes, judged per station (Q51 (c)'s salad and secreto), and the
  table's longest wait is its earliest `oldestReadyAt`.
- **D5. The words (Q51 (f) 7 and (g), design §10).** The station editor's short labels (under the
  unchanged legend "Late flags (minutes)" «Avisos de demora (minutos)») and Add station's longer
  ones:

  | Key (`packages/venue-service/src/dashboard/strings.ts`) | English | Spanish |
  | --- | --- | --- |
  | `prep.health.warm` (editor) | Warm → **Waiting** | En demora → **Esperando** |
  | `prep.health.overdue` (editor) | Overdue | Retrasado → **Con retraso** |
  | `prep.health.forgotten` (editor) | Forgotten | Olvidado |
  | `prep.health.ready_warning` (editor, new) | **Ready warning** | **Listo sin recoger** |
  | `prep.warm` (Add station) | Warm after (min) → **Waiting after (min)** | Aviso a partir de (min) → **Esperando a partir de (min)** |
  | `prep.overdue` (Add station) | Overdue after (min) | Atraso a partir de (min) → **Con retraso a partir de (min)** |
  | `prep.forgotten` (Add station) | Forgotten after (min) | Olvido a partir de (min) → **Olvidado a partir de (min)** |
  | `prep.ready_warning` (Add station, new) | **Ready warning after (min)** | **Listo sin recoger a partir de (min)** |
  | `prep.threshold_invalid` | Use whole minutes with **waiting** < overdue < forgotten. (was warm) | Usa minutos enteros con **esperando < con retraso < olvidado**. |
  | `prep.ready_warning_invalid` (new) | **Use whole minutes, at least 1.** | **Usa minutos enteros, al menos 1.** |

  The till's words are «Esperando», «Con retraso», «Olvidado» (`apps/till/src/i18n/strings.ts:2779-2781`,
  read); "Ready warning after (min)" «Listo sin recoger a partir de (min)» is (g)'s wording. The
  keys keep their names (no reader outside the editor and Add station, ran: `grep -rn 'prep\.health'
  packages apps --include='*.ts'`), so only the values change. The other `prep.health.*` values are
  not touched.
- **D6. The fourth field is last, and the editor draws the four two to a row.** Design §3.6 puts it
  "after 'Warm after', 'Overdue after' and 'Forgotten after'", so the order is Waiting, Overdue,
  Forgotten, Ready warning, in both the editor and Add station (where it comes before Printers).
  **Why two columns (ran, the probe):** with today's three columns the fourth field wraps into a
  third of the row, and the A725 check that every label reads in full at 390 px failed — "Ready
  warning" needed 83 px of 81, «Listo sin recoger» 94 of 81; with
  `grid-template-columns: repeat(2, minmax(0, 1fr))` both languages passed. Add station stacks its
  fields one per line (`prep-stations-screen.ts:1091`), so it needs no layout change.
- **D7. No hint and no placeholder on the new field**, like its three siblings (pinned "with no
  placeholder", `station-editor.test.ts:347`); the guide says what it is (Task 9). **Alternative,
  for the owner:** a one-line hint "How long ready food may wait".
- **D8. The dashboard app's `apps/dashboard/src/api/client.ts` is not changed.** Its `Station` is
  a subset the device screens read for names (`device-profiles-screen.ts:686`, `devices-screen.ts:708`),
  already without colour or the printing choices, and its `createStation`/`updateStation` have no
  caller outside their own tests (ran, the grep in the table). The prep-stations screen talks
  through venue-service's `PrepStationsApi`.
- **D9. Seeds and provisioning are not changed**: they name no minutes, so their stations take 3.
- **D10. The guides name the field and its default; what it does lands with slice 7.** This slice
  changes nothing a till shows, so a guide sentence about the Ready bar's warning would be untrue
  until slice 7, which adds it to `{#ready-bar}`. **Owner FYI:** between the two slices the field
  can be set and has no effect.
- **D11. The overdue report is not changed**: it classifies by the three band limits and reads no
  ready time (read, the table).
- **D12. The till's test builders give every `byStation` entry `oldestReadyAt: null` and
  `readyWarningAfterMinutes: 3`**, so every existing till case stays on what will be slice 7's calm
  path (no stamp, no warning) and slice 7's own cases choose a stamp.

### Changed test checks (from the probes; the implementer confirms each)

**Probe (ran): the column as D1 says, D2's constant, D3's parse and import check, `kitchen.ts`
writing and listing the field, D4's signal, the editor's fourth field and D5's words, Add station's
fourth field.** Then:
- **Root guards:** `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts scripts/migrations-match-schema.test.ts scripts/migration-upgrade.test.ts scripts/id-columns-are-references.test.ts scripts/journal-monotonic.test.ts`
  → `Test Files 9 passed (9)`, `Tests 498 passed (498)` (about 90 s).
- `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts src/write-path.e2e.test.ts`
  → `Test Files 2 passed (2)`, `Tests 20 passed (20)`, unedited.
- `pnpm --filter @waitron/db exec vitest run` → `Test Files 103 passed (103)`, `Tests 1458 passed (1458)`.
- `pnpm --filter @waitron/shared exec vitest run` → `Test Files 47 passed (47)`, `Tests 861 passed (861)`.
- `pnpm --filter @waitron/reporting exec vitest run src/overdue-orders.test.ts` → `Tests 17 passed (17)`.
- `env -u CLAUDECODE -u CLAUDE_CODE_CHILD_SESSION pnpm --filter @waitron/provisioning exec vitest run`
  → every test passes. Run it with those two variables unset: the Stripe 23 library writes a
  `<claude-code-hint …>` line to standard error whenever `CLAUDECODE` or `CLAUDE_CODE_CHILD_SESSION`
  is set (`node_modules/.pnpm/stripe@23.0.0_@types+node@26.6.5/node_modules/stripe/cjs/stripe.core.js:142-144`),
  and seven cases in `src/cli-owned-entry.test.ts`, `src/cli-same-hour-entry.test.ts` and
  `src/first-setup-command-import.test.ts` expect an empty standard error. With both unset those
  three files gave `Tests 17 passed (17)` (ran by the plan review); CI sets neither. Any
  provisioning failure is a STOP.
- `pnpm --filter @waitron/server typecheck`, `@waitron/venue-service`'s after the fixtures below, and
  `@waitron/dashboard`'s → 0 errors.
- **Server:** the 197 `apps/server` suites naming a station, the late flags, the floor read, the
  signals or the configuration file (ran: `grep -rlE "kitchenStations|kitchen_stations|byStation|listStations|createStation|updateStation|management-api/stations|AfterMinutes|tables/state|listTablesWithState|readBillSignals|readPartySignals|kind: \"ready\"|configuration" src --include='*.test.ts'`
  in `apps/server`, then `pnpm exec vitest run <those>`) → `Test Files 6 failed | 191 passed (197)`,
  `Tests 20 failed | 8271 passed (8291)`. The twenty:
  - **Harness, not a check (Fixture-only):** `src/canvas-retirement-upgrade.test.ts`
    "refuses the populated predecessor for reset and retains every row after rollback" (`:384`;
    "table kitchen_stations has no column named ready_warning_after_minutes", from today's
    `applyVenue` writing into a predecessor schema) fails once the column exists (Task 2; the plan
    review ran it with the column alone). `src/station-order-migration.test.ts` "A725 drops only
    station order with populated cascading and restrictive children" fails once `listStations`
    reads the new column, after a cut that stops before it (Task 4; with the column alone it
    passes, ran by the plan review). Each file lists the later
    `kitchen_stations` migrations to apply ahead — `"_table_short_names"` at `:399`, and
    `printing`/`bump`/`changes` at `:40-52` and `:252-254` — and each new one has been appended
    there (`git log -S"_station_changes_after_sending" -- apps/server/src/station-order-migration.test.ts`
    → `251e256a4`). Appending `"_station_ready_warning"` to the first and a `readyWarning` journal
    entry with `when === readyWarning.when` to the second: both passed (ran, `Tests 6 passed (6)`).
  - **`src/kitchen.test.ts`** "defaults isDefault to false and lists active stations by name"
    (`:212`) and "updateStation renames but cannot reactivate a removed station" (`:393`): each
    listed station gains `readyWarningAfterMinutes: 3`, every other value unchanged. Reason: D1, the
    stations list carries the field.
  - **`src/table-signals.test.ts`**, eight cases whose `toEqual` pins a whole `ready` signal: "A725
    ready signals sort opposite dish insertion order by station name" (`:189`), "puts a due step
    first among a table's signals" (`:270`), "shows Mesa 2's ready drinks, its due held group and
    its bill request together; …" (`:309`), "A725 counts ready dishes by station name and serving
    takes them off" (`:346`), "counts a weighed dish as one and puts stations in name order"
    (`:410`), "gives joined tables the party's signals, and reads the bills a merged-in party kept"
    (`:744`), "reads every kind of fact once for the whole floor, not once per table" (`:811`),
    "shows a counter tab without a table, labelled Ana, with its ready and long-wait signals"
    (`:867`). Each `byStation` entry printed `"oldestReadyAt": "<that run's ISO time>"` and
    `"readyWarningAfterMinutes": 3`. Reason: D4.
  - **`src/table-signals.service-lifetime.test.ts`** "counts only $name still in service" (`:174`,
    six rows: live food, partly served food, partly cancelled food, partly served and cancelled
    food, legacy quantity, weighed remaining food) and "counts $name separately routed extras by
    their parent dishes" (`:197`, the "remaining" row): the same two keys, in the bill's and the
    table's signals. Reason: D4.
  - **`src/split-off-extras.groups.test.ts`** "names Fryer as ready and counts plates rather than
    the extra's pieces" (`:197`, its `toContainEqual` at `:211`): the same two keys. Reason: D4.

  In `table-signals.test.ts` and `split-off-extras.groups.test.ts`, `ready_at` is the moment the
  case bumped the dish (`advanceSet`'s `nowIso()`), so each changed entry there pins
  **`oldestReadyAt: expect.any(String)`** and **`readyWarningAfterMinutes: 3`**. In
  `table-signals.service-lifetime.test.ts` no case bumps: its `fixture` writes `readyAt` itself, the
  time `at` (`:104`, written at `:130`), so its seven changed checks pin **`oldestReadyAt: at`**
  exactly — `fixture` hands `at` back and `expectedSignals` takes it — and
  **`readyWarningAfterMinutes: 3`**. Task 5's new cases pin exact times on stamps they write
  themselves. No other server
  case failed: `management-api.test.ts` and `configuration-transfer.test.ts` read stations with
  `toMatchObject` or by column (ran: both in the 191 that passed).
- **venue-service** (browser; free memory 82 % before the run, ran `memory_pressure`):
  `pnpm exec vitest run src/dashboard/{calendar-station-month,prep-stations-screen.a11y,prep-stations-screen,prep-stations-screen.unsaved,routing-client,routing-grid.unsaved,station-action.unsaved,station-editor.a11y,station-editor.save-state,station-editor,station-editor.unsaved}.test.ts`
  in `packages/venue-service` (the eleven names spelled out) → `Test Files 6 failed | 5 passed (11)`,
  `Tests 33 failed | 504 passed (537)`. `pnpm --filter @waitron/venue-service typecheck` had first
  failed on the station fixtures missing the field (ran), which the probe filled with
  `readyWarningAfterMinutes: 3` (**Fixture-only**: Task 7's `PrepStation` and editor fixtures,
  `calendar-station-month.test.ts:33`, `prep-stations-screen.test.ts:64`,
  `prep-stations-screen.unsaved.test.ts:44`, `routing-grid.unsaved.test.ts:46`,
  `station-editor.a11y.test.ts:30`, `station-editor.save-state.test.ts:15`,
  `station-editor.test.ts:19`, `test/station-delete-test-helpers.ts:41`; Task 8's `StationInput`
  fixture, `routing-client.test.ts:136-142`). The 33:
  - **Fixture-only, 2:** `prep-stations-screen.a11y.test.ts` "checks refused-rest" (`:239`, light
    and dark) expected "could not be saved" and got "Correct the highlighted fields": its untyped
    station fixtures (`:128`, `:253`, `:262`, `:470`) had no ready warning, so the editor opened on
    an invalid field. Given `readyWarningAfterMinutes: 3` there (and in
    `station-editor.unsaved.test.ts:28`'s), both passed (ran, `Tests 66 passed (66)` with the
    unsaved suite). Task 7.
  - **Words, 18 (Task 6), reason D5:** in `station-editor.test.ts`, "opens on the station's own
    minutes, each required, with no placeholder and no venue note" (`:347`; labels "Warm" →
    "Waiting"), "a cleared minutes field is marked beside it and at the bottom and sends nothing"
    (`:364`), "marks Warm for %s, explains it at the bottom, sends nothing and focuses it" (`:405`,
    four rows; the title becomes "marks Waiting for %s, …"), "holds the timings in order against
    the station's own minutes" (`:430`), "puts a %s refusal naming %s under that field" (`:450`,
    two rows), "reads the timings in Spanish" (`:475`; «En demora», «Retrasado» → «Esperando»,
    «Con retraso»), "explains timings out of order in Spanish beside the field and at the bottom,
    and sends nothing" (`:490`), "A725 phone labels remain fully readable in %s" (`:874`, en and
    es; its labels); in `station-editor.a11y.test.ts`, "timing refused" and "timing invalid"
    (`:18-19`, light and dark, the message at `:85`, `:96`); in `prep-stations-screen.test.ts`,
    "puts a timing refusal from the editor's save under the field it names and keeps the editor
    open" (`:845`, the message at `:861`). Each changes only the words D5 changes.
  - **The editor's fourth field (Task 7), reason D5/D6:** "opens on the station's own minutes…"
    and "A725 phone labels…" also extend their field list to four (`TIMINGS`, `:345`; the list at
    `:880`), so the new field is checked for its value, label, `required`, `type` and, at 390 px,
    a label that reads in full.
  - **Add station sends the ready warning, 13 (Task 8), reason D3/D6:** each `createStation`
    call pinned whole gains `readyWarningAfterMinutes: 3`, every other value unchanged, in
    `prep-stations-screen.test.ts` "creates a station from the modal with the chosen thresholds"
    (`:621`), "a new station starts on the first colour no station has, and is created with the
    colour chosen" (`:661`), "creates a station with its name and thresholds when Enter is pressed
    in Name" (`:1088`), "Add station sends the printers chosen with the station" (`:4638`), "A725
    Add station uses the shared popup in %s" (`:4974`, en and es), "A725 Add station ignores a
    colour outside the station palette" (`:5030`), "A725 ignores a colour event from a closed Add
    station opening" (`:5060`), "A725 holds the colour popup closed while Add station is saving"
    (`:5101`), "A725 Add station has no manual order field and sends no retired key" (`:5199`);
    `prep-stations-screen.unsaved.test.ts` "Add accepted write commits before a refused refresh"
    (`:214`, its `toEqual` at `:223`); `routing-client.test.ts` "writes station changes to core and
    cells to venue-service" (`:155`, at `:189`) and "creates station and its timing thresholds with
    one POST" (`:289`, at `:305`), whose `StationInput` fixtures now carry the field and whose sent
    bodies are pinned whole.
- **Till:** `pnpm --filter @waitron/till typecheck` → 23 errors in 13 test files, every one a
  `byStation` entry missing `oldestReadyAt` and `readyWarningAfterMinutes` (ran; the list is
  `/tmp/a797-6-probe.NDR4/till-tsc.txt`). No source file failed. With D12's two keys added to
  every `byStation` entry in `apps/till/src` (the 13 files and `src/till-app-device-zones.test.ts:2349`,
  whose literal typechecks without them): `pnpm exec vitest run <those 14 files>` in `apps/till` →
  `Test Files 14 passed (14)`, `Tests 544 passed (544)` (ran). **Fixture-only** (Task 5).

Any other failure, in any suite a task names, is a STOP.

### Review focus (inputs the spec implies and today's tests may not pin)

1. **The oldest, not the first seen**: two ready lines at one station whose stamps are in the
   opposite order to the lines' insertion (Task 5).
2. **Serving the oldest ready dish moves `oldestReadyAt` to the next**; a partly served line keeps
   its stamp while any of it is still to serve (Task 5).
3. **A ready line with no stamp**: alone → `oldestReadyAt: null`; beside a stamped one → the
   stamped one's time (Task 5).
4. **Two stations at one table with different minutes** — design §10 Q51 (c)'s example: Cold at
   6, the grill at 3 — each entry carries its own (Task 5).
5. **A merged-in party's ready dishes** count toward the family's oldest, as they count toward
   `count` today (Task 5's merged case, or the changed `:744` check).
6. **No order with the late flags**: a ready warning of 20 beside Forgotten after 15 is saved by
   POST, PATCH and import (Tasks 3, 4).
7. **The bound at every door**: 0, 1.5, `"3"`, `null`, 2147483648 refused at the routes with
   `management.request_invalid` `{ field: "readyWarningAfterMinutes" }` and nothing written; 0
   from a direct `createStation`/`updateStation` call refused `station.thresholds_invalid`; 0 or
   `null` in a file refused on import and nothing written; a file row with no key imports as 3
   (Tasks 3, 4).
8. **A PATCH of the ready warning alone** leaves the stored late flags untouched and is not
   refused over them; a PATCH of a late flag alone leaves the ready warning (Task 4).
9. **The editor**: "03" typed over a stored 3 sends nothing; a blank or 0 marks the field with
   "Use whole minutes, at least 1.", not the order message; a server refusal naming
   `readyWarningAfterMinutes` lands under that field with that message (Task 7).
10. **Add station**: sends 3 when untouched; a 0 is marked and nothing is sent (Task 8).
11. **Spanish at 390 px**: «Listo sin recoger» and «Con retraso» read in full in the two-column
    grid (Task 7's changed A725 check; Task 10's LOOK).

---

**Task order and why.** The shared constant first (Task 1, pure); the migration (Task 2); the
bound at the routes, the writers and the import (Task 3, the provisioning helpers and the import's
end-to-end cases); the server's station writes and list (Task 4); the signal, with the till's
fixtures in the same commit because the shared type change fails the till's typecheck until they
have the keys (Task 5); the words (Task 6); the editor's fourth field (Task 7); Add station's
(Task 8); docs (Task 9); the LOOK (Task 10). Each leaves the tree green and is sized well under
100 tool calls.

### Task 1: The default ready warning time, in `@waitron/shared`

**Files:**
- Modify: `packages/shared/src/timing.ts` (after `DEFAULT_STATION_THRESHOLDS`, `:11-15`),
  `packages/shared/src/index.ts` (`:132-133`)
- Test: `packages/shared/src/timing.test.ts` (beside "DEFAULT_STATION_THRESHOLDS is 5, 10 and 15",
  `:28`), `packages/shared/src/index.test.ts`

**Interfaces:**
- Produces: `DEFAULT_READY_WARNING_AFTER_MINUTES = 3`;
  `type StationTiming = StationThresholds & { readyWarningAfterMinutes: number }` (D2). Consumed by
  Tasks 2–8.

- [ ] **Step 1: Failing tests.** `timing.test.ts`: "DEFAULT_READY_WARNING_AFTER_MINUTES is 3".
  `index.test.ts`: "re-exports the default ready warning time" — the index's
  `DEFAULT_READY_WARNING_AFTER_MINUTES` is `timing.ts`'s.
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/shared exec vitest run src/timing.test.ts src/index.test.ts`.
- [ ] **Step 3: Implement** the constant and the type; export both.
- [ ] **Step 4: Run; expect PASS** (read the `Tests` count), then CI's mutation job's view of the
  file: `pnpm --filter @waitron/shared exec stryker run --mutate src/timing.ts` — a score of at
  least 90; a surviving mutant is closed by a test that asserts something.
- [ ] **Step 5:** `pnpm --filter @waitron/shared typecheck`;
  `pnpm exec eslint packages/shared/src/timing.ts packages/shared/src/timing.test.ts packages/shared/src/index.ts packages/shared/src/index.test.ts`;
  `pnpm format:check`; ledger; `git commit -s -m "A797-6: the default ready warning time"`

### Task 2: The migration

**Files:**
- Modify: `packages/db/src/schema/kitchen-stations.ts` (the column after `:21`, D1; the comment at
  `:18` becomes: "The CHECK orders the three late flags. The station routes and the import refuse
  a minute below 1 in any of the four, and the ready warning is in no order with the others: a
  CHECK would rebuild this table.")
- Generate: `packages/db/drizzle/0192_station_ready_warning.sql`, `meta/0192_snapshot.json`,
  `meta/_journal.json` (drizzle-kit writes all three)
- Test: `packages/db/src/schema/kitchen-stations.test.ts` (new case),
  `apps/server/src/kitchen.test.ts` (new case beside `:491`),
  `apps/server/src/canvas-retirement-upgrade.test.ts` (harness, Fixture-only)

- [ ] **Step 1: Failing tests.**
  1. `kitchen-stations.test.ts`: "a station row given no ready warning holds 3, and the database
     holds it in no order with the late flags" — a station seeded with no minutes reads
     `readyWarningAfterMinutes` 3; an update to 20 (beside the default Forgotten after 15) and to 0
     are both accepted by the database (it pins D1: the bound is the writers', not a CHECK; Tasks
     3 and 4 pin the writers' refusals).
  2. `kitchen.test.ts`: "a station row given no ready warning takes the schema's default, equal to
     DEFAULT_READY_WARNING_AFTER_MINUTES" — the raw insert of `:491-496`, then the stored
     `readyWarningAfterMinutes` equals the constant.
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/db exec vitest run src/schema/kitchen-stations.test.ts`
  and `pnpm --filter @waitron/server exec vitest run src/kitchen.test.ts -t "ready warning"`.
- [ ] **Step 3: Implement** the column, then **generate, never hand-write**:
  `pnpm --filter @waitron/db db:generate --name station_ready_warning`. **Read the SQL.** It must be
  exactly D1's one statement. A `__new_` table, a `DROP TABLE`, a `PRAGMA`, or any other statement
  is a **STOP**: report it with the file, do not edit it. If `main` has gained a 0192 since this
  plan, regenerate on top (CLAUDE.md §3), never renumber by hand.
- [ ] **Step 4: The upgrade harness** (Fixture-only; the changed-checks list says why):
  `canvas-retirement-upgrade.test.ts` gains `"_station_ready_warning"` after `"_table_short_names"`
  (`:399`). Run it:
  `pnpm --filter @waitron/server exec vitest run src/canvas-retirement-upgrade.test.ts`; PASS (read
  the `Tests` count). `station-order-migration.test.ts` passes unedited here; its harness is Task 4's.
- [ ] **Step 5: Run; expect PASS**, then the guard suites from the root:
  `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts scripts/migrations-match-schema.test.ts scripts/migration-upgrade.test.ts scripts/id-columns-are-references.test.ts scripts/journal-monotonic.test.ts`
  (probe: 9 files, 498 tests passed) and
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts src/write-path.e2e.test.ts`
  (probe: 20 passed; it passes **unedited**, or STOP). Then `pnpm --filter @waitron/db exec vitest run`
  (probe: all 1458 passed).
- [ ] **Step 6:** typecheck db and server; eslint the changed `.ts` files (not the generated SQL or
  JSON); `pnpm format:check`; ledger (the harness file as Fixture-only);
  `git commit -s -m "A797-6: each prep station holds a ready warning time, 3 minutes by default"`

### Task 3: The ready warning's bound at the routes, the writers and the import

**Files:**
- Modify: `packages/provisioning/src/kitchen-timing.ts` (D3: `StationTimingPatch` becomes
  `Partial<StationTiming>`; `parseStationTimingPatch` parses the fourth with the three;
  `assertStationTiming` checks its range only; `assertImportedStationTimings` reads
  `ready_warning_after_minutes`)
- Test: `packages/provisioning/src/kitchen-timing.test.ts`,
  `apps/server/src/configuration-transfer.test.ts` (beside "transfers each station's bump mode",
  `:2433`, and the timing refusals, `:4957-5060`)

- [ ] **Step 1: Failing tests.** In `kitchen-timing.test.ts`:
  1. "parseStationTimingPatch reads a ready warning with the late flags" — `{ readyWarningAfterMinutes: 20 }`
     → `{ readyWarningAfterMinutes: 20 }`; `{}` → `{}`.
  2. `it.each([0, 1.5, "3", null, 2_147_483_648])` "parseStationTimingPatch refuses a ready warning
     of %j, naming it" → `management.request_invalid` `{ field: "readyWarningAfterMinutes" }`.
  3. "assertStationTiming holds the ready warning in range but in no order" — `{ readyWarningAfterMinutes: 20 }`
     against stored 5/10/15 passes; `{ readyWarningAfterMinutes: 0 }` throws
     `station.thresholds_invalid` `{ field: "readyWarningAfterMinutes", stationId, name }`.
  4. "assertImportedStationTimings reads a missing ready warning as 3, and refuses one out of
     range" — a row with no key passes; `ready_warning_after_minutes` 0, 1.5 or `null` throws
     `{ field: "readyWarningAfterMinutes", name }`; 20 beside `forgotten_after_minutes` 15 passes;
     a row out of order in its late flags **and** with a 0 ready warning is named by its late flag.
  In `configuration-transfer.test.ts`:
  5. "transfers each station's ready warning time" — two stations with 6 and 3 (the second by
     default) exported and imported, the bundle's rows `objectContaining({ ready_warning_after_minutes: 6 })`
     and `…: 3`, the imported rows read back by name with 6 and 3 (the shape of `:2433-2475`).
  6. "refuses an imported ready warning of 0 before writing anything" — the shape of `:4957-5006`:
     `station.thresholds_invalid` `{ name, field: "readyWarningAfterMinutes" }`, and the target
     holds no row.
  7. "imports a station row with no ready warning as 3" — delete the key from the bundle's row
     before importing.
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/provisioning exec vitest run src/kitchen-timing.test.ts`
  and `pnpm --filter @waitron/server exec vitest run src/configuration-transfer.test.ts -t "ready warning"`.
  Cases 1–4 and 6 fail; 5 and 7 pass on arrival, because Task 2's column already travels and takes
  its default (they pin that, D1, and stay).
- [ ] **Step 3: Implement** D3. Keep the three's order check exactly as it is (`invalidTimingField`,
  `:46-59`); the ready warning's range check is its own and runs after it.
- [ ] **Step 4: Run; expect PASS**; then
  `env -u CLAUDECODE -u CLAUDE_CODE_CHILD_SESSION pnpm --filter @waitron/provisioning exec vitest run`
  (fully green; the changed-checks list says why the two variables are unset; any failure is a
  STOP) and the whole `configuration-transfer.test.ts` and
  `configuration-import.test.ts` in `apps/server`.
- [ ] **Step 5:** typecheck provisioning and server; eslint the changed files; `pnpm format:check`;
  ledger; `git commit -s -m "A797-6: a station's ready warning is whole minutes from 1, in no order with its late flags"`

### Task 4: The station routes write and list the ready warning

**Files:**
- Modify: `apps/server/src/kitchen.ts` (`Station` gains `readyWarningAfterMinutes`; `createStation`
  writes `thresholds.readyWarningAfterMinutes ?? DEFAULT_READY_WARNING_AFTER_MINUTES`;
  `listStations` selects it; `updateStation` takes it out of the patch beside the three, passes it
  to `assertStationTiming` with them, and writes it), `apps/server/src/management-api.ts` (the
  POST and PATCH body types, `:1565-1574`, `:1633-1647`, and the PATCH `patch` type, `:1653-1666`,
  name the field; the parse already reads it)
- Test: `apps/server/src/kitchen.test.ts` (two changed checks; new cases),
  `apps/server/src/management-api.test.ts` (new cases in `describe("/management-api/stations (KDS-1 config)")`, `:1022`),
  `apps/server/src/station-order-migration.test.ts` (harness, Fixture-only: it fails once
  `listStations` reads the new column)

- [ ] **Step 1: Failing tests.** `kitchen.test.ts`:
  1. "createStation stores a given ready warning, and 3 when none is given; listStations reads it".
  2. "updateStation saves a ready warning of 20 beside Forgotten after 15, and leaves the late
     flags" — stored late flags unchanged; then a PATCH of `warmAfterMinutes` alone leaves the 20.
  3. "updateStation refuses a ready warning of 0, naming it, and writes nothing" —
     `station.thresholds_invalid` `{ field: "readyWarningAfterMinutes", stationId, name }`.
  `management-api.test.ts`:
  4. "POST and PATCH store a station's ready warning and GET lists it" — POST with 6 → 201,
     listed 6; PATCH 20 → 204, listed 20 (beside Forgotten after 15).
  5. `it.each([0, 1.5, "3", null, 2_147_483_648])` "PATCH refuses a ready warning of %j and leaves
     the station as it was" → 400 `management.request_invalid` `{ field: "readyWarningAfterMinutes" }`;
     and the same through POST with no station made.
  Changed checks (probe): "defaults isDefault to false and lists active stations by name" (`:212`)
  and "updateStation renames but cannot reactivate a removed station" (`:393`) gain
  `readyWarningAfterMinutes: 3` on each listed station.
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/server exec vitest run src/kitchen.test.ts src/management-api.test.ts -t "station"`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: The upgrade harness** (Fixture-only; it fails once `listStations` reads the new
  column): `station-order-migration.test.ts` gains a `readyWarning` journal entry found by
  `tag.endsWith("_station_ready_warning")` beside `changes` (`:48-52`, with its "missing" throw)
  and `|| when === readyWarning.when` after `when === changes.when` (`:254`). Run
  `pnpm --filter @waitron/server exec vitest run src/station-order-migration.test.ts src/canvas-retirement-upgrade.test.ts`
  (probe, both edits: `Tests 6 passed (6)`).
- [ ] **Step 5: Run; expect PASS**, then the whole `kitchen.test.ts`, `management-api.test.ts`,
  `kitchen-timing-consumers.test.ts` and `station-delete.test.ts` in `apps/server`.
- [ ] **Step 6:** typecheck server; eslint the changed files; `pnpm format:check`; ledger (both
  changed checks; the harness file as Fixture-only); `git commit -s -m "A797-6: the station routes save and list the ready warning time"`

### Task 5: The ready signal carries each station's oldest ready time and its warning minutes

**Files:**
- Modify: `packages/shared/src/table-signals.ts` (`ReadyAtStation`, `:38-42`, D4, each field with a
  one-line doc: "The earliest stored ready time of the dishes counted; null when none has one." /
  "This station's ready warning time."), `apps/server/src/table-signals.ts` (`KitchenLine` gains
  `readyAt` and `readyWarningAfterMinutes`; `readKitchenLines` selects `ticketItems.readyAt` and
  `kitchenStations.readyWarningAfterMinutes`; `kitchenSignals` keeps the earliest by `Date.parse`
  and maps both into each entry, `:113-119`)
- **Size:** an implementer that passes about 150 tool calls with the task unfinished stops at a
  green (or cleanly red) point, commits, and returns a handover — what is done, what is left, the
  files, and each check's state — and a fresh implementer continues from it.
- Test: `apps/server/src/table-signals.test.ts` (new cases; eight changed checks),
  `apps/server/src/table-signals.service-lifetime.test.ts` (seven), `apps/server/src/split-off-extras.groups.test.ts` (one)
- Fixture-only: every `byStation` entry in `apps/till/src` (D12): `src/till-app-device-zones.test.ts`,
  `src/state/table-signals.test.ts`, `src/state/table-precedence.test.ts`,
  `src/state/floor-look.test.ts`, `src/screens/till-floor-screen.a11y.test.ts`,
  `.refresh.test.ts`, `.signals.test.ts`, `.ready-bar.test.ts`, `.steps.test.ts`,
  `.precedence.test.ts`, `src/widgets/table-details-sheet.test.ts`, `held-orders.a11y.test.ts`,
  `held-orders.test.ts`, `signal-chips.test.ts` (ran: `grep -rn "byStation" apps/till/src`); the
  three suites with a `ready(...)` builder (`state/table-signals.test.ts:69-75`,
  `till-floor-screen.signals.test.ts:76-82`, `till-floor-screen.ready-bar.test.ts:69-75`) change
  the builder, the rest each literal.

- [ ] **Step 1: Failing tests** in `apps/server/src/table-signals.test.ts`, with a helper beside
  `queuedAgo` (`:119-124`): `readyAt(v, billId, name, iso)` sets `ticket_items.ready_at` for the
  bill's ready lines named `name` to a fixed time.
  1. "each station's ready entry carries its oldest ready time and its own warning minutes" —
     Barra with `readyWarningAfterMinutes` 6 (through `createStation`'s thresholds), Cocina at its
     default 3; two caña lines made ready and stamped `…T20:04:00.000Z` on the first line and
     `…T20:01:00.000Z` on the second (the oldest is not the first inserted), a burger
     `…T20:03:00.000Z` → Barra `{ count: 2, oldestReadyAt: "…T20:01:00.000Z", readyWarningAfterMinutes: 6 }`,
     Cocina `{ count: 1, oldestReadyAt: "…T20:03:00.000Z", readyWarningAfterMinutes: 3 }`.
  2. "serving the oldest ready dish moves the oldest ready time to the next" — serve the
     `20:01` line whole → Barra's `oldestReadyAt` is `20:04`; serve one of a two-caña line → its
     stamp stays while one is left.
  3. "a ready dish with no stored ready time gives its station no oldest ready time" — clear the
     stamp of a station's only ready line → `oldestReadyAt: null`; with a stamped line beside it →
     the stamped time.
  4. "the counter tab's ready signal carries the same two facts" — through `readBillSignals`, a
     stamped ready dish → its exact time and 3.
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/server exec vitest run src/table-signals.test.ts -t "oldest ready"`
  (and the other two by name).
- [ ] **Step 3: Implement** D4 in the two files.
- [ ] **Step 4: The changed checks** (probe): in the sixteen cases the changed-checks list names,
  each `byStation` entry gains `readyWarningAfterMinutes: 3` and an `oldestReadyAt`, every other
  value unchanged. In the nine cases that stamp the time through the real bump
  (`table-signals.test.ts`, `split-off-extras.groups.test.ts`) it is `expect.any(String)`; in the
  seven of `table-signals.service-lifetime.test.ts` it is the exact `at` the `fixture` writes as
  `readyAt` (`:104`, `:130`): `fixture` returns it beside the order, and `expectedSignals` takes it
  and sets it on each entry. Run
  `pnpm --filter @waitron/server exec vitest run src/table-signals.test.ts src/table-signals.service-lifetime.test.ts src/split-off-extras.groups.test.ts src/kitchen-allergy.notices.test.ts src/print-api.printer-wiring.test.ts src/station-printers.test.ts`;
  PASS.
- [ ] **Step 5: The till's fixtures** (D12): `pnpm --filter @waitron/till typecheck` lists them
  (probe: 23 errors in 13 files); give each `byStation` entry `oldestReadyAt: null,
  readyWarningAfterMinutes: 3`, and the device-zones literal (`:2349`) too. Then, after checking
  free memory (`memory_pressure | grep free`), run the 14 files in `apps/till`
  (`pnpm exec vitest run <the 14 paths above>`; probe: `Tests 544 passed (544)`). No till check
  changes: a failure here is a STOP.
- [ ] **Step 6:** typecheck shared, server and till; eslint every changed file; `pnpm format:check`;
  ledger (the sixteen changed checks; the till files as Fixture-only);
  `git commit -s -m "A797-6: each station's ready signal carries its oldest ready time and its warning minutes"`

### Task 6: "Waiting after" and the till's Spanish in the station fields

**Files:**
- Modify: `packages/venue-service/src/dashboard/strings.ts` (D5's values for `prep.health.warm`,
  `prep.health.overdue` (es), `prep.warm`, `prep.overdue` (es), `prep.forgotten` (es),
  `prep.threshold_invalid`, en `:221`, `:248`, `:322`; es `:1108-1109`, `:1135-1137`, `:1210`)
- Test: the eighteen changed checks D5 lists (`station-editor.test.ts`,
  `station-editor.a11y.test.ts`, `prep-stations-screen.test.ts`)

- [ ] **Step 1: Failing tests.** Change the eighteen checks to D5's words (the changed-checks
  list names each; "marks Warm for %s" becomes "marks Waiting for %s"). Add one: "Add station
  reads Waiting after, Overdue after and Forgotten after, in English and Spanish" in
  `prep-stations-screen.test.ts` — the three `wt-input` labels in each language (today nothing pins
  them: ran `grep -n "Warm after\|Aviso a partir" packages/venue-service/src` → only `strings.ts`).
- [ ] **Step 2: Run; expect FAIL** (free memory first) in `packages/venue-service`:
  `pnpm exec vitest run src/dashboard/station-editor.test.ts src/dashboard/station-editor.a11y.test.ts src/dashboard/prep-stations-screen.test.ts`.
- [ ] **Step 3: Implement** the string values only.
- [ ] **Step 4: Run; expect PASS** (read the `Tests` count); then `pnpm exec vitest run scripts/english-only.test.ts`.
- [ ] **Step 5:** typecheck venue-service; eslint the changed files; `pnpm format:check`; ledger
  (the eighteen, reason D5); `git commit -s -m "A797-6: the station's minutes say Waiting, in the till's Spanish words"`

### Task 7: The station editor's Ready warning field

**Files:**
- Modify: `packages/venue-service/src/dashboard/routing-client.ts` (`PrepStation` and
  `updateStation`'s input gain the field; `StationInput` is Task 8's, because widening it makes Add
  station send the field), `station-editor.ts`
  (`StationEditorStation` and `StationEditorSave` over `StationTiming`; `TIMING_FIELDS` gains
  `readyWarningAfterMinutes` last and `TIMING_LABELS` `prep.health.ready_warning`; `timingErrors`
  gives it `prep.ready_warning_invalid` and keeps the order check to the three; `refusalText`
  answers `prep.ready_warning_invalid` for a refusal naming it; the empty draft gains it; the grid
  `repeat(2, minmax(0, 1fr))`, D6), `prep-stations-screen.ts` (the editor's opened station gains
  `readyWarningAfterMinutes`, `:752-766`), `strings.ts` (`prep.health.ready_warning`,
  `prep.ready_warning_invalid`, en and es, D5)
- Test: `station-editor.test.ts`, `station-editor.a11y.test.ts` (its loop of fields, `:132`,
  gains the fourth), `station-editor.unsaved.test.ts`
- Fixture-only: the station fixtures the changed-checks list names (venue-service typecheck lists
  them), `prep-stations-screen.a11y.test.ts` (`:128`, `:253`, `:262`, `:470`) and
  `station-editor.unsaved.test.ts:28`

- [ ] **Step 1: Failing tests** in `station-editor.test.ts`:
  1. Changed: "opens on the station's own minutes…" (`:345-361`): `TIMINGS` gains
     `readyWarningAfterMinutes` (GRILL's 3) and the labels list "Ready warning"; "A725 phone
     labels…" (`:874`): four fields, labels with «Listo sin recoger».
  2. "sends a typed ready warning, and nothing for 03 over a stored 3".
  3. `it.each(["", "0", "1.5", "abc", "2147483648"])` "marks Ready warning for %j with its own
     message, sends nothing and focuses it" — the field's error "Use whole minutes, at least 1.",
     no other field marked.
  4. "a ready warning above Forgotten after is saved" — 20 with Forgotten after 15 → sent
     `{ readyWarningAfterMinutes: 20 }`, no error.
  5. "puts a refusal naming readyWarningAfterMinutes under that field with its own message" — for
     `management.request_invalid` and `station.thresholds_invalid`.
  6. "reads Ready warning in Spanish" — «Listo sin recoger», and its message «Usa minutos enteros,
     al menos 1.».
  7. "draws the four minutes two to a row" — the second field's top equals the first's, the third's
     is below them, the fourth's equals the third's.
- [ ] **Step 2: Run; expect FAIL** (free memory first) `pnpm exec vitest run src/dashboard/station-editor.test.ts`
  in `packages/venue-service` (and typecheck, which fails until the fixtures have the field).
- [ ] **Step 3: Implement**; fill the fixtures with `readyWarningAfterMinutes: 3`.
- [ ] **Step 4: Run; expect PASS:** `pnpm exec vitest run src/dashboard/station-editor.test.ts src/dashboard/station-editor.a11y.test.ts src/dashboard/station-editor.save-state.test.ts src/dashboard/station-editor.unsaved.test.ts src/dashboard/prep-stations-screen.a11y.test.ts src/dashboard/prep-stations-screen.test.ts src/dashboard/calendar-station-month.test.ts src/dashboard/routing-grid.unsaved.test.ts src/dashboard/station-action.unsaved.test.ts`
  in `packages/venue-service`. Add station is untouched here, so its create calls still send
  three minutes; any failure is a STOP.
- [ ] **Step 5:** typecheck venue-service; eslint the changed files; `pnpm format:check`; ledger
  (the two extended checks; the fixtures as Fixture-only);
  `git commit -s -m "A797-6: the station editor sets the ready warning time"`

### Task 8: Add station's Ready warning field

**Files:**
- Modify: `packages/venue-service/src/dashboard/routing-client.ts` (`StationInput` gains the
  field), `packages/venue-service/src/dashboard/prep-stations-screen.ts` (the draft's default,
  `:160-165` and `#openStation`, `:799-804`, gain `readyWarningAfterMinutes:
  DEFAULT_READY_WARNING_AFTER_MINUTES`; `#stationErrors`, `:824-838`, marks it
  `prep.ready_warning_invalid` when not a whole number from 1 to 2147483647; the field after
  Forgotten after, `:1091`: `${this.#field("readyWarningAfterMinutes", t("prep.ready_warning"))}`),
  `strings.ts` (`prep.ready_warning`, en and es, D5)
- Test: `prep-stations-screen.test.ts`, `prep-stations-screen.unsaved.test.ts`, `routing-client.test.ts`

- [ ] **Step 1: Failing tests.** The thirteen changed checks (each `createStation` call or sent
  body gains `readyWarningAfterMinutes: 3`; `routing-client.test.ts`'s `StationInput` fixture,
  `:136-142`, gains it too, Fixture-only). New: "Add station offers Ready warning after (min) at 3, after
  Forgotten after and before Printers, and sends a typed 6"; "Add station marks a ready warning of
  0 and creates nothing"; the Task 6 label case gains the fourth label in both languages.
- [ ] **Step 2: Run; expect FAIL** `pnpm exec vitest run src/dashboard/prep-stations-screen.test.ts src/dashboard/prep-stations-screen.unsaved.test.ts src/dashboard/routing-client.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run; expect PASS**, then the eleven venue-service files of the changed-checks list
  (probe: 537 tests).
- [ ] **Step 5:** typecheck venue-service; eslint the changed files; `pnpm format:check`; ledger
  (the thirteen); `git commit -s -m "A797-6: Add station sets the ready warning time"`

### Task 9: Docs, the user guides and the backlog follow the code

**Files:**
- Modify: `apps/server/src/guide/en/kitchen-service.md` (`:106-108`) and
  `apps/server/src/guide/es/kitchen-service.md` (`:122-124`), `docs/developers/design-system.md`
  (`:2931`, `:4534`, `:4693-4694`, `:4700-4702`), `docs/backlog.md` (both A797 entries, `:120-129` and the
  order line in the till area), `docs/backlog/till.md` (A797's entry, `:1036-1046`),
  `docs/superpowers/specs/2026-10-18-a797-device-screens-design.md` (§3.6's row `:375`, §3.8's Warm
  row `:427`, §5's Ready warning point `:529-541`: dated pointers)
- Test: `apps/server/src/guide-content.test.ts`, `scripts/guide-links.test.ts`

- [ ] **Step 1: Guides** (D10). English, the sentence at `:106-108` becomes: "Each prep station sets
  its own late flags, and a **Ready warning** time of 3 minutes unless you change it, when you add
  it with **Add station**, and under **Late flags (minutes)** when you edit it in **Prep
  stations**." Spanish: «Cada estación de preparación fija sus propios avisos de demora, y un tiempo
  de **Listo sin recoger** de 3 minutos si no lo cambias, al crearla con **Añadir estación**, y en
  **Avisos de demora (minutos)** al editarla en **Estaciones de preparación**.» (read «Añadir
  estación» and «Estaciones de preparación» from `strings.ts`'s `es` block before writing). Nothing
  about the Ready bar's warning: slice 7 adds it.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and
  `pnpm exec vitest run scripts/guide-links.test.ts`; PASS.
- [ ] **Step 3: design-system.md.** `:2931` "a station's three late-flag minutes" → "a station's
  three late-flag minutes and its ready warning time"; `:4534` "The Edit window groups its
  late-flag minutes into one row." → "The Edit window sets its four minutes fields two to a row.";
  `:4693-4694` "the three late-flag fields in
  one row under 'Late flags (minutes)'" → "the four minutes fields, two to a row, under 'Late
  flags (minutes)': Waiting, Overdue, Forgotten, then Ready warning"; `:4700-4702`: "… and that
  waiting < overdue < forgotten; the ready warning is in no order with them, and its own message
  says 'Use whole minutes, at least 1.'".
- [ ] **Step 4: Backlog.** Both A797 entries and `till.md`'s: slice 6 in review with this plan
  linked; slice 7 next. Open no new entry unless the LOOK finds something this slice does not fix
  (its number from `~/waitron-campaign-shared/next-item-number`: read it, use it, write the next
  back).
- [ ] **Step 5: Design file** (dated pointers; a design records what was decided when): under §3.6's
  table, "2026-10-26, slice 6: the Ready warning time is set in the station editor and Add station
  as a fourth field after Waiting, Overdue and Forgotten, and is in no order with them; see the
  build plan's slice 6, D3 and D6."; under §3.8's table, "2026-10-26, slice 6: the station fields
  say Waiting, Overdue, Forgotten in English and «Esperando», «Con retraso», «Olvidado» in
  Spanish (D5)."; under §5's Ready warning point, "2026-10-26, slice 6: the column is
  `kitchen_stations.ready_warning_after_minutes`, and each `ready` entry carries `oldestReadyAt`
  and `readyWarningAfterMinutes`; see the build plan's slice 6, D1 and D4."
- [ ] **Step 6: Check** `pnpm exec prettier --file-info docs/backlog.md` prints `"ignored": true`
  (wrap by hand); `pnpm format:check` for the guide files.
- [ ] **Step 7: Commit** `git commit -s -m "docs: A797-6 — guides, design system and backlog for the ready warning time"`

### Task 10 (visual): LOOK at the station editor and Add station

- [ ] **Step 1: Start the stack** `wa-wt demo waitron-feat-a797-6-ready-warning-data`; `wa-wt ls`
  for the URLs. Sign in to the dashboard as the demo's owner and open **Prep stations**
  (`/manage/prep-stations`).
- [ ] **Step 2: Look** with the workspace's Playwright Chromium (script in
  `/Users/clintongormley/waitron-campaign-c/a797-6-scripts/`, never in the worktree, its process id
  recorded), at **390 px** and **1280 px**, **light and dark**, **English and Spanish**:
  - the station editor of the demo's Kitchen: the four minutes two to a row, Waiting · Overdue /
    Forgotten · Ready warning, the fourth at 3; then a 0 typed in Ready warning and Save tried: the
    field marked with its own message and the bottom line;
  - Add station: Waiting after, Overdue after, Forgotten after, Ready warning after (min) at 3,
    then Printers;
  - save a ready warning of 6 on Kitchen and check it stored, opening the database read-only:
    `sqlite3 -readonly <the worktree's venue folder>/venue.db "select name, warm_after_minutes, overdue_after_minutes, forgotten_after_minutes, ready_warning_after_minutes from kitchen_stations"`
    (`wa-wt ls` names the folder); write the rows in the ledger.
- [ ] **Step 3: Save** the PNGs under `/Users/clintongormley/waitron-campaign-c/a797-6-shots/`
  (`<step>-<width>-<theme>-<lang>.png`), open each, describe them in the ledger and the PR body.
  Expected: every label reads in full, «Listo sin recoger» included, at 390 px; nothing scrolls
  sideways.
- [ ] **Step 4: Stop** what you started: the script by its recorded process id, then
  `wa-wt down waitron-feat-a797-6-ready-warning-data`.

### Closing slice 6

- Focused runs per task as above. CI runs the package suites (db, shared, provisioning, server,
  venue-service, till), coverage and the shared and db mutation jobs. Read the `changes` job's
  outputs and those packages' coverage or merge jobs on the current head before calling the PR
  green.
- `/finish-branch` with this plan named. Review path **FULL**: per-task reviews, the
  plan-against-spec read, and two Codex run-it reviews (the second told to set this plan's checklist
  aside and test what it does not name).
- PR body. **First line: "No venue reset needed."** Then: **Migration** (D1's statement, quoted,
  and the measured reason there is no CHECK); **Contract change** (`ReadyAtStation` gains
  `oldestReadyAt` and `readyWarningAfterMinutes`, on the floor read and the counter's tab list; the
  station routes and the stations list carry `readyWarningAfterMinutes`; the configuration file
  carries `ready_warning_after_minutes`); **What a person sees** (the station editor and Add
  station's fourth field and Q51 (f) 7's words; nothing on the till until slice 7); **Decisions**
  D1–D12 in one line each; **Changed test checks** (from the ledger: Task 4's two, Task 5's
  sixteen, Task 6's eighteen, Task 7's two extended, Task 8's thirteen); **Fixture-only** (Task
  2's and Task 4's upgrade harnesses, Task 5's fourteen till files, Task 7's venue-service fixtures); **LOOK**.
- **Owner FYI** (one line each in the PR and the lane's questions file, not questions): D3 (the
  ready warning is in no order with the late flags, so 20 beside Forgotten after 15 is allowed);
  D5 (the Spanish of Waiting, Overdue and Forgotten in Add station now reads «Esperando a partir
  de», «Con retraso a partir de», «Olvidado a partir de»); D7 (no hint on the field); D10 (until
  slice 7 the field has no effect).
- After merge: delete the branch local and remote and check the remote one is gone; update the
  ledger; then slice 7.

---

## Slice 7 — The Ready bar's warning (one PR, branch `feat/a797-7-ready-bar-warning`)

**What it changes.** On a handheld's Floor, once food at a table has stood ready at the pass as long
as its station's **Ready warning** time (slice 6; 3 minutes unless changed), the Ready bar turns
amber and pulses slowly, says how long the food has waited, and puts those tables first: "🍽 Ready
4 min · T5 · 2 · T9 · 1 · Open ›" («Listo 4 min · …», design §3.1, §4 example 2, §10 (g)). Each
station's dishes are judged against that station's own minutes (Q51 (c): a salad from Cold at 6
minutes and a secreto from the grill at 3 are judged apart). Open › opens the first table the bar
lists: the longest-waiting of the warning tables, or of all of them while none warns (it opened the first in the floor read's
order until now, slice 5 D4). The minutes keep counting between floor reads. Under reduced motion
nothing moves and the amber stays. A till's "Ready" summary does not change.

**Review path: LIGHT.** No server read, route, schema or shared type changes: the bar reads the two
facts slice 6 put on each `ready` entry (`oldestReadyAt`, `readyWarningAfterMinutes`,
`packages/shared/src/table-signals.ts:38-46`, read). The changed files are under `apps/till/src/`,
two token comments in `packages/ui-core/src/tokens/`, the guides and the docs. None of the risk
triggers applies. **Migration: none.** No venue reset.

How claims are marked in this section: **(ran)** means run on 2026-10-26 against `main` at
`28ab55247` (this worktree's base); **(read)** means read in the code at that commit. The probe ran
in a throwaway worktree (`git worktree add --detach /tmp/a797-7-probe.Bz8k/wt 28ab55247`), removed
afterwards; its whole diff and logs stay in `/tmp/a797-7-probe.Bz8k/` (`probe.diff`, `run1.txt`,
`run2.txt`, `tsc.txt`). None of the probe code is in this branch.

### Every reader and writer this slice touches (ran: grep; each line read)

From `grep -rn "readyTables\|ReadyTable\b\|oldestReadyAt\|readyWarningAfterMinutes" apps/till/src`
(ran; outside the test builders that set `oldestReadyAt: null, readyWarningAfterMinutes: 3`, the
only readers are below), `grep -n "ready\|pulse\|reduced\|now" apps/till/src/screens/till-floor-screen.ts`
(ran) and `grep -rn "warning-pulse-dim\|pulse-slow" apps packages` (ran), each line read:

| Where | What it does today | In this slice |
| --- | --- | --- |
| `apps/till/src/state/table-signals.ts:51-56` `ReadyTable`, `:58-74` `readyTables` | one entry per party with food ready in a shown zone, in the floor read's order; reads only each station's `count` | each entry also carries the party's longest wait and the moment it first warns (D1) |
| `apps/till/src/state/table-signals.ts:76-99` `groupTables` | groups tables by party and names them | unchanged |
| `apps/till/src/screens/till-floor-screen.ts:2998-3023` `#readyBar`, `:3025-3035` `#readyEntry`, `:3037-3040` `#openReady` | draws "Ready", the entries, Open › (its `aria-label` "Open {table}" names `ready[0]`) and the help badge, on a handheld only (`:3000`) | order, minutes, the warning flags (D2, D3, D7) |
| same file `:816-858` | the bar's styles: sticky, `border: 1px solid var(--wt-color-success)`, `background: var(--wt-color-surface-raised)` | the warning's edge, pulse and amber (D6, D7) |
| same file `:887-889` `now`, `:958-959` `#drawnAt` (set in `willUpdate`, `:1023`), `:1079-1096` `#watchReminders` | one `setTimeout` to the next moment a reminder falls due, a held countdown's minute changes, or a step falls due; none while `now` is injected (`:1083`) | also the next moment the bar changes (D5) |
| same file `:879-886` `reducedMotion`, `:2709-2711` `#prefersReducedMotion` | the injectable reduced-motion answer, else the live media query; read for the zone tabs' pulses (`:2679-2687`) | read for the bar's pulse (D6) |
| same file `:2984-2996` `#stationSummary` | a till's per-station "Ready" list | unchanged (D9) |
| `apps/till/src/till-app.ts:18437-18470` | the one floor mount; passes `.handheld` (`:18463`) and no `now` (ran: `grep -n "<till-floor-screen" -A26 apps/till/src/till-app.ts \| grep now` → nothing) | unchanged: the real app runs on the floor's own clock (Task 5 pins it) |
| `apps/till/src/till-app.ts:1787-1801` | lifts the Sent and Served toasts above the bar by the bar's height cap | unchanged: the warning does not change the bar's height (D6) |
| `apps/till/src/i18n/strings.ts` en `:1018-1021`, es `:2754-2757` | `floor.ready_title` "Ready" «Listo», `floor.ready_bar_table`, `floor.ready_bar_open`, `floor.ready_bar_open_label` | one new key (D8) |
| `apps/till/src/i18n/help-strings.ts:29-30`, `:77-78` | `help.floor.ready_bar`: "…; Open opens the first." «…; Abrir abre la primera.» (no test pins it: ran `grep -rn "help.floor.ready_bar\|Open opens the first" apps --include='*.ts'` → only the badge call and the string) | reworded (D8) |
| `apps/till/src/widgets/till-shell.ts:208-221` | A738's Waiting tab: `border-color: var(--wt-color-warning)`, keyframe `waiting-attention` at 50% `border-color: var(--wt-color-warning-pulse-dim)` over `--wt-duration-pulse-slow`, `animation: none` under `prefers-reduced-motion` | the pattern D6 reuses; unchanged |
| `packages/ui/src/floor-ring.ts:71-84`, `:89-112` | A757's rings: the pulse class only while `moving`, and a CSS `prefers-reduced-motion` rule as well | the two-gate pattern D6 reuses; unchanged |
| `packages/ui-core/src/tokens/colors.css:120-121` (comment), `:26`/`:162` `--wt-color-warning`, `:124`/`:253` `--wt-color-warning-pulse-dim`; `structure.css:50-51` (comment), `--wt-duration-pulse-slow: 2000ms` | the comments name who uses the dim colours and the slow pulse (floor rings, the till bar's Waiting tab) | the comments gain the Ready bar's warning (D10) |
| `apps/till/src/widgets/sent-orders.ts:483-487`, `apps/till/src/widgets/fired-ago.ts:21-24`, `apps/till/src/state/release-reminder.ts:12-29` | the Sent box's "Ready n min", "Fired n min ago" and the held countdown: each compares a box timestamp with the device's `Date.now()` | the precedent for D4; unchanged |

### Plan decisions for slice 7

- **D1. Each Ready bar entry carries its party's wait.** `ReadyTable` gains
  `oldestReadyAt: number | null` — the earliest readable `oldestReadyAt` over the party's `ready`
  entries, in epoch milliseconds — and `warnsAt: number` — the earliest, over the entries that have
  one, of `Date.parse(oldestReadyAt) + readyWarningAfterMinutes × 60 000`; `Number.POSITIVE_INFINITY`
  when no entry has a readable time. So each station is judged by its own stamp and its own
  minutes, and a table warns as soon as any one of its stations does (design §5, Q51 (c)). An
  unreadable time counts as none, as `reminderDueAt` reads one (`release-reminder.ts:7-10`). A
  party carries the same signals on each of its tables (`readyByStation`'s comment,
  `table-signals.ts:30-33`, read), so the first table's are the party's. `readyTables` stays free of
  the clock and in the floor read's order; the clock comes in with D2's `readyBar`. **The table's
  wait is its oldest dish, warning or not:** whether a table warns is judged per station, but once
  it does, its place among the amber tables (D2) and the minutes the bar shows (D3) come from its
  oldest ready dish, which may be a calm one. Example: Table A has a salad ready 10 minutes at a
  15-minute Cold station (calm) and a grill dish ready 3:05 at 3 (amber); Table B has a grill dish
  ready 9 minutes (amber) → A first, "Ready 10 min". The food at A's pass has stood 10 minutes, and
  one number per table keeps the bar simple. **Alternative, for the owner:** order and count amber
  tables by their warning dishes only (B first, "Ready 9 min").
- **D2. The order: tables whose food warns first, then the rest; within each group, the longest
  wait first.** A table with no readable time comes after every timed one in its group; ties keep
  the floor read's order (a stable sort). Open › opens the first entry, as it does today
  (`#openReady(first)`, `:3018`), so it now opens the longest-waiting of the warning tables, or of all of them while
  none warns, which is what design
  §3.1 asked of it and slice 5 D4 deferred. **Why warning first, not plain longest-first:** design
  §3.1 says both "Open › opens the table whose food has waited longest" and, of the warning, "It
  names the table waiting longest first". With every station at the same minutes (the 3-minute
  default) the two orders are the same. They differ only when stations differ, as Q51 (c) allows:
  T1's salad (Cold, 6 min) ready 5 minutes and T2's secreto (grill, 3 min) ready 4½ minutes. Plain
  longest-first would draw an amber bar headed by the calm T1 and send Open › there; the warning is
  about T2. Picture 01 (middle) draws the amber table first. The probe ran exactly this case:
  entries `["T2", "T1", "T3"]` (T3 having no time), heading "Ready 4 min", and with T2 moved to
  1 minute ready, calm, `["T1", "T2"]` (ran, `/tmp/a797-7-probe.Bz8k/probe.diff`'s
  `zz-probe.test.ts`). **Alternative, for the owner:** plain longest-first, amber or not.
- **D3. The minutes show only while the bar warns, and they are the first table's longest wait**,
  whole minutes rounded down: "Ready 4 min" «Listo 4 min». The calm bar reads "Ready", as design §4
  example 2 has it at 20:44 and picture 01 (left) draws it. A table warns from the moment
  `now ≥ warnsAt`: §4 example 2 turns the bar amber when the croquetas "have been ready 3 minutes"
  under the 3-minute default, and slice 6 D4 states the same "≥". A warning needs a readable time,
  and a station's minutes are at least 1 at every door (slice 6 D3), so the shown number is at
  least 1 for any station the product wrote.
- **D4. The device's clock, as the rest of the till uses it.** The bar compares the box's stamp
  with the device's `Date.now()` (through the floor's `#drawnAt`, `:1023`), exactly as the Sent box's
  "Ready n min" (`sent-orders.ts:483-487`), "Fired n min ago" (`fired-ago.ts:21-24`) and the floor's
  held countdown (`release-reminder.ts:12-20`, `till-floor-screen.ts:1079-1096`) already do. Nothing
  in the till's source corrects for a difference between the two clocks (ran:
  `grep -rn -iE "skew|clockOffset|serverNow|serverTime" apps/till/src --include='*.ts' | grep -v test`
  → nothing). A device clock that runs ahead shows more minutes and warns early; one behind, fewer
  and later; a stamp still ahead of the device's clock leaves the table calm until the clock reaches
  `warnsAt`, never a negative count. Slice 6 D4 weighed sending the seconds already waited instead
  and chose the timestamp so the count can run between reads.
- **D5. What redraws the bar: the floor's one existing redraw timer.** `#watchReminders`
  (`:1079-1096`) already keeps one `setTimeout` to the next moment the floor's own drawing changes
  with no new read. On a handheld it also takes `nextReadyBarChange`: the earliest `warnsAt` still
  ahead, and, while the bar warns, the next whole minute of the shown wait. No `TickingClock` and no
  new interval: the floor's comment against one (`:880-884`) is about the server-judged bands and
  stays true. The 15-second re-read (slice 5 D7) still replaces the data. A till schedules nothing
  for the bar. With `now` injected the floor keeps no timer, as today (`:1083`). **Receipts (ran,
  the probe):** under fake `setTimeout`, `clearTimeout` and `Date`, a table ready 2:30 at a 3-minute
  station read "Ready", then after 30 s "Ready 3 min", 60 s "Ready 4 min", 60 s "Ready 5 min", with
  one timer; **control:** the same case with the bar left out of `#watchReminders` read "Ready" all
  four times.
- **D6. The warning's look: A738's edge pulse, on a two-pixel edge that does not change the bar's
  size.** While warning, the bar's `border-color` is `--wt-color-warning` and an inset
  `box-shadow: inset 0 0 0 1px` of the same colour doubles the edge without moving anything; a
  keyframe takes both to `--wt-color-warning-pulse-dim` at 50% over `--wt-duration-pulse-slow`, as
  A738's Waiting tab does with its border (`till-shell.ts:208-221`). The heading ("Ready 4 min" and
  its icon) is drawn in `--wt-color-warning`, as other till text in that colour is
  (`till-table-order-screen.ts:907`, `bill-pay-dialog.ts:422`, read); the bar's background stays
  `--wt-color-surface-raised` (slice 5). **Reduced motion, two gates, as A757's rings
  (`floor-ring.ts:71-84`, `:89-112`):** the pulsing class is drawn only while
  `!#prefersReducedMotion()` (so the floor's injected `reducedMotion` works in tests), and a CSS
  `@media (prefers-reduced-motion: reduce)` rule stops it too; the amber edge and text stay.
  **Receipts (ran, the probe):** the warning bar computed `animation-name: ready-warning`, `2s`,
  `border-top-color: rgb(138, 83, 0)`; with `reducedMotion: true`, and with the browser's reduced
  motion emulated and nothing injected, `animation-name: none` and the same border colour; the
  calm and warning bars were both 50 px tall. Contrast (ran, a WCAG ratio script over the token
  values): `--wt-color-warning` on `--wt-color-surface-raised` 6.33:1 light, 8.12:1 dark; on
  `--wt-color-surface` 6.33:1 light, 9.14:1 dark. **Dark theme:** every colour is a token with a dark
  value (`colors.css:162`, `:253`); Task 3's a11y case runs both themes. **Where this departs from
  picture 01 (middle):** the picture fills the warning bar with an amber tint and draws a thick ring
  outside it (its caption: "the ring drawn here is its brightest moment" of A757's pulse). The plan
  keeps the bar's `--wt-color-surface-raised` fill and a 2-px edge inside it. The spec's text, which
  says the bar "turns amber … its edge dimming to `--wt-color-warning-pulse-dim` as A738's Waiting
  tab does", is what the plan follows where text and picture differ; A738's tab dims its border, not
  an outer ring. The plain fill also keeps the calm bar's look (slice 5) and the measured contrast
  above; an outer ring would need room outside the sticky bar that the scrolling area's foot does
  not leave.
- **D7. A table whose food warns has its entry drawn amber too** (picture 01, middle: "T5 · 2"
  amber, "T9 · 1" calm): `data-warning` on that `wt-button`, its text and border `--wt-color-warning`
  through `::part(button)`, and on hover the border back to `--wt-color-primary-text`, the shared
  cue an outside part rule would otherwise override (`docs/developers/design-system.md:618-621`;
  secondary fill `--wt-color-surface`, `packages/ui-core/src/components/wt-button.ts:70-74`, read).
  **What colour alone carries:** the warning itself is in words ("Ready 4 min") and in order
  (warning tables first, D2), but where several tables warn, which of the later entries warn is
  shown by colour only. **Owner FYI**, with the alternative: amber on the bar alone, entries
  unchanged.
- **D8. Words.** One new key, en / es: `floor.ready_bar_waited` "Ready {n} min" / «Listo {n} min»
  — the owner's wording for "Ready 4 min" (design §10 (g), "already settled"), the same words the
  Sent box uses under its own key (`table.row_ready_ago`, `strings.ts:1062`, `:2798`); the bar gets
  its own key, as slice 5 gave it its own keys. "min" needs no plural in either language. Entries,
  Open › and its label are unchanged; the label already names the table ("Open T5"), never "the
  first". Help, reworded (`help.floor.ready_bar`): "Tables with food ready to take out. Tables in
  amber, whose food has waited as long as its station's Ready
  warning time, go before the rest. Tap one to open it; Open opens the first." / «Mesas con comida
  lista para llevar. Las mesas en ámbar, cuya comida ha esperado tanto
  como el tiempo de Listo sin recoger de su estación, van antes que las demás. Toca una para abrirla;
  Abrir abre la primera.» ("Ready warning" «Listo sin recoger» is the station field's name, slice 6
  D5.) **The words match D3, not the spec's "longer than":** the bar warns at the limit itself
  (§4 example 2 turns it amber at 3 minutes), so every person-facing sentence says the food "has
  waited as long as" the time («ha esperado tanto como»), never "longer than" («más que»).
  **No live region** (slice 5 D5: the bar changes on every read): the section is named by its
  heading (`aria-labelledby`, `:3007`), so a screen reader that moves to it hears "Ready 4 min".
- **D9. Where it shows: the Ready bar only, on a handheld at every width.** Design §3.2 says of a
  tablet handheld "the Ready bar and its warning are as on a phone", and slice 5 D3 already draws
  the bar on every handheld and the summary on every till. A till's summary gets no minutes and no
  amber: the design puts the warning on the bar alone, and the summary is a per-station list
  (`#stationSummary`, `:2984-2996`).
- **D10. The token comments that list who uses the slow pulse and the amber dim colour gain the
  Ready bar's warning** (`colors.css:120-121`, and its repeats beside each copy of
  `--wt-color-warning-pulse-dim`; `structure.css:50`), and so do the design system's sentences
  (`design-system.md:421-422`, `:614-616`, Task 6). A list of users that leaves one out is a claim
  that has gone stale.

### Changed test checks (from the probe; the implementer confirms each)

**Probe (ran):** D1's two fields in `readyTables`, a crude D2–D3 `readyBar` drawn by `#readyBar`,
D5's addition to `#watchReminders`, D6's styles. `pnpm typecheck` in `apps/till` → exit 0
(`tsc.txt`). Then, with free memory at 82 % (ran `memory_pressure`), in `apps/till`:

- `pnpm exec vitest run src/state/table-signals.test.ts src/screens/till-floor-screen src/screens/text-size.layout src/screens/device-screens src/widgets/till-shell.device-zones src/till-app-device-zones.test.ts`
  → `Test Files 1 failed | 33 passed (34)`, `Tests 5 failed | 909 passed (914)` (`run1.txt`).
- `pnpm exec vitest run src/till-app src/screens/till-counter-cleanup.look src/widgets/guide-sheet`
  → `Test Files 44 passed (44)`, `Tests 4433 passed (4433)` (`run2.txt`).

The five, all in `apps/till/src/state/table-signals.test.ts`, each a `toEqual` that pins whole
`readyTables` entries; each expected entry gains `oldestReadyAt: null, warnsAt: Number.POSITIVE_INFINITY`
(the builder at `:69-77` gives every station `oldestReadyAt: null`), every other value unchanged.
Reason: D1.
- "lists each party with food ready once, its count summed over its stations" (`:83`)
- "names a party at one of today's joins by its tables' short names, once" (`:100`)
- "names a party at two separate tables by both short names" (`:126`)
- "names a party at two separate tables by both, and by the shown one only when a zone is hidden" (`:138`)
- "uses the saved short name, not today's name or the party's" (`:167`)

No floor-screen or app check changed: every existing case builds `oldestReadyAt: null` (slice 6
D12), so it stays on the calm path, in the floor read's order. Any other failure, in any suite a
task names, is a STOP.

### Review focus (inputs the spec implies and today's tests may not pin)

1. **Two stations at one table with different minutes** (Q51 (c)): Cold at 6 and the grill at 3,
   both ready 4 minutes → warns (the grill); the salad alone → calm (Tasks 1, 2).
2. **A calm table waiting longer than an amber one** → the amber one first, Open › opens it (D2;
   Task 2).
3. **Exactly at the limit**: ready 3:00 at a 3-minute station → amber; 2:59.999 → calm (D3; Task 1).
4. **No time, or an unreadable one**: such a station never warns; a table with only such stations
   comes after every timed table, and one with a timed station beside it uses that time (D1, D2;
   Task 1).
5. **A stamp ahead of the device's clock**: calm, no negative minutes, and it turns amber at
   `warnsAt` (D4; Tasks 1, 4).
6. **The count runs with no new read**, turns amber at the crossing with no new read, and keeps one
   timer beside a held countdown (D5; Task 4).
7. **The floor leaves the page** (a handheld opens a table on the Order tab) and comes back: the
   minutes read now, not when it left (Task 4).
8. **A re-read in which the oldest dish was served**: the order and minutes follow, and the bar
   goes calm when nothing is past its time (Task 2).
9. **Reduced motion, dark theme, Spanish, 390 and 1024 px**: nothing moves, amber stays, contrast
   holds, «Listo 4 min» (Tasks 3, 7).
10. **The bar's height and the toasts**: the warning does not change the bar's height, so the Sent
    toast still sits above it (D6; Tasks 3, 7).

---

**Task order and why.** The pure order-and-wait logic first (Task 1); the floor draws it, with the
words (Task 2); its look, reduced motion and accessibility (Task 3); the clock between reads
(Task 4); the app's wiring (Task 5); the docs (Task 6); the LOOK (Task 7). Each leaves the tree green
and is sized well under 100 tool calls.

### Task 1: How long each Ready bar table has waited, and the bar's order

**Files:**
- Modify: `apps/till/src/state/table-signals.ts` (`ReadyTable` `:51-56` and `readyTables` `:58-74`,
  D1; new `readyBar` and `nextReadyBarChange` after them)
- Test: `apps/till/src/state/table-signals.test.ts` (five changed checks; new cases)

**Interfaces:**
- Produces:
  ```ts
  export interface ReadyTable {
    partyId: string;
    tableId: string;
    name: string;
    count: number;
    /** The earliest readable ready time over the party's stations, epoch ms; null when none. */
    oldestReadyAt: number | null;
    /** The first moment one of its stations has waited its own ready warning time; never when none is timed. */
    warnsAt: number;
  }
  export interface ReadyBarTable extends ReadyTable { warning: boolean }
  export interface ReadyBar {
    /** Warning tables first, then the rest; each group by `oldestReadyAt`, untimed last, ties in floor order. */
    tables: ReadyBarTable[];
    /** The first table's wait in whole minutes while it warns; null while the bar is calm. */
    waitedMinutes: number | null;
  }
  export function readyBar(entries: readonly ReadyTable[], now: number): ReadyBar;
  /** The next moment after `now` that `readyBar(entries, ·)` answers differently; never when none. */
  export function nextReadyBarChange(entries: readonly ReadyTable[], now: number): number;
  ```
  `warning` is `now >= warnsAt`. `nextReadyBarChange` is the smallest of every `warnsAt > now` and,
  when `readyBar(entries, now).waitedMinutes` is `m`, the first table's `oldestReadyAt + (m + 1) × 60 000`.
  Consumed by Tasks 2 and 4.

- [ ] **Step 1: Failing tests.** Extend the `ready` builder (`:69-77`) to take an optional fourth and
  fifth tuple element, `oldestReadyAt` (default `null`) and `readyWarningAfterMinutes` (default 3),
  so existing calls are unchanged. Change the five checks the changed-checks list names. New cases,
  with `const now = Date.parse("2026-10-26T20:00:00.000Z")` and `ago(ms)` giving `now − ms` as ISO:
  1. "carries the party's longest wait, and the moment its first station warns" — one party,
     Cold `ago(5 min)` at 6 and Grill `ago(4 min)` at 3 → `oldestReadyAt: now − 5 min`,
     `warnsAt: now − 1 min` (the grill's: its stamp + 3 min).
  2. "leaves a station with no time or an unreadable one out of both" — `null` alone →
     `null`/`Infinity`; `"not a time"` beside `ago(2 min)` → that station's time and its `warnsAt`.
  3. "warns from the moment a station has waited its own minutes" — Grill at 3 ready exactly 3:00 →
     `warning: true`, `waitedMinutes: 3`; at 2:59.999 → `false`, `null` (Review focus 3).
  4. "judges each station against its own minutes" — Cold at 6 ready 4 min alone → calm; with Grill
     at 3 ready 4 min beside it → warning, `waitedMinutes: 4` (Review focus 1).
  5. "puts warning tables first, then the rest, each longest-waiting first, untimed last, ties in
     floor order" — in floor order: T3 untimed, T1 Cold 6 ready 5 min, T2 Grill 3 ready 4½ min, T4
     Grill 3 ready 1 min, T5 untimed, T6 Grill 3 ready 1 min → `["t2", "t1", "t4", "t6", "t3", "t5"]`
     and `waitedMinutes: 4` (Review focus 2).
  6. "a stamp ahead of the clock stays calm" — ready at `now + 2 min` → calm, `waitedMinutes: null`;
     `nextReadyBarChange` → `now + 5 min` (Review focus 5).
  7. "an amber table's place and minutes come from its oldest dish, even a calm one" — Table A:
     Cold at 15 ready 10 min and Grill at 3 ready 3:05; Table B: Grill at 3 ready 9 min → both
     amber, `["tA", "tB"]`, `waitedMinutes: 10` (D1's example).
  8. "the next change: the next crossing, and the next minute while warning" — calm T1 at 3 ready
     1:30 → `now + 1:30`; warning T2 ready 3:20 beside it → `now + 40 s` (its 4th minute), the
     earlier of the two; no timed table → `Infinity`; no entries → `readyBar` gives `tables: []`,
     `waitedMinutes: null`.
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/till exec vitest run src/state/table-signals.test.ts`
  (memory first: `memory_pressure | grep free`).
- [ ] **Step 3: Implement** D1 in `readyTables`'s `pick` (the earliest of each station's
  `Date.parse`, skipping `NaN`), then `readyBar` (a stable sort on `[warning ? 0 : 1, oldestReadyAt ?? Infinity]`)
  and `nextReadyBarChange`.
- [ ] **Step 4: Run; expect PASS** (read the `Tests` count).
- [ ] **Step 5:** `pnpm --filter @waitron/till typecheck`; `pnpm exec eslint apps/till/src/state/table-signals.ts apps/till/src/state/table-signals.test.ts`;
  `pnpm format:check`; ledger (the five changed checks, reason D1);
  `git commit -s -m "A797-7: how long each Ready bar table has waited, and the bar's order"`

### Task 2: The Ready bar names the table waiting longest first, with its minutes

**Files:**
- Modify: `apps/till/src/screens/till-floor-screen.ts` (`#readyBar` `:2998-3023`, `#readyEntry`
  `:3025-3035`: a private `#readyEntries()` builds `readyTables(this.tables, new Set(this.zones.map((zone) => zone.id)))`
  for this task and Task 4; `readyBar(…, this.#drawnAt)` orders it; the heading reads
  `floor.ready_bar_waited` while `waitedMinutes !== null`, else `floor.ready_title`; `data-warning`
  on the section while warning and on each warning entry; the doc comment at `:2998` says the order
  and that Open opens the first listed), `apps/till/src/i18n/strings.ts` (`floor.ready_bar_waited`
  beside `:1021` and `:2757`, D8), `apps/till/src/i18n/help-strings.ts` (`:29-30`, `:77-78`, D8)
- Test: `apps/till/src/screens/till-floor-screen.ready-bar.test.ts` (new `describe` "the Ready bar's
  warning"; its `ready` builder `:69-77` gains the same optional fourth and fifth elements as Task
  1's; mount with the file's fixed `now`, `:20`)

**Interfaces:** Consumes Task 1's `readyTables`, `readyBar`. Produces `[data-ready-bar][data-warning]`
and `[data-ready-table][data-warning]`, read by Tasks 3–5.

- [ ] **Step 1: Failing tests:**
  1. "a calm bar reads Ready and lists the longest-waiting table first" — Table 2 ready 1 min,
     Table 8 ready 2 min, both at 3 → heading "Ready", entries Table 8 then Table 2, no
     `data-warning` anywhere; Open › emits `open-table` for `t8`, its label "Open Table 8".
  2. "once food has waited its station's minutes, the bar warns and names that table first with
     its minutes" — Table 2 ready 2 min (calm), Table 8 ready 4 min (at 3) → heading "Ready 4 min",
     the section has `data-warning`, entries Table 8 (with `data-warning`) then Table 2 (without),
     Open › opens `t8`.
  3. "a salad waiting longer stays calm and comes after the warning table" — Table 2 Cold ready
     5 min at 6, Table 8 Grill ready 4½ min at 3 → Table 8 first, "Ready 4 min", only Table 8's
     entry warns (Review focus 2, D2).
  4. "a re-read with the oldest dish served turns the bar calm" — from case 2, set `tables` to Table
     8 with nothing ready and Table 2 at 2 min → "Ready", no `data-warning` (Review focus 8).
  5. "says it in Spanish" — case 2 under `setLocale("es")` → «Listo 4 min», «Abrir ›» labelled
     «Abrir Table 8» (the fixture's names); restore the language (CLAUDE.md §4) as the file's other
     Spanish case does.
  6. "the section is named by its heading, minutes included" — the section's accessible name (as
     the a11y suite reads names, `till-floor-screen.a11y.test.ts:828-832`) is "Ready 4 min"; no
     element in the bar has `aria-live` or `role="status"` (D8).
  7. "a till's summary has no minutes and no warning" — `handheld` unset, case 2's tables → the
     summary's heading "Ready", no `[data-warning]` in the floor (D9).
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/till exec vitest run src/screens/till-floor-screen.ready-bar.test.ts`.
- [ ] **Step 3: Implement** D2, D3, D7's attribute and D8's strings. No styles yet (Task 3).
- [ ] **Step 4: Run; expect PASS**, then the floor suites:
  `pnpm --filter @waitron/till exec vitest run src/screens/till-floor-screen src/screens/text-size.layout src/screens/device-screens src/widgets/till-shell.device-zones`
  (probe: all passed with the bar ordered; a failure is a STOP), and
  `pnpm exec vitest run scripts/english-only.test.ts`.
- [ ] **Step 5:** typecheck till; eslint the changed files; `pnpm format:check`; ledger;
  `git commit -s -m "A797-7: the Ready bar names the table waiting longest first, with its minutes"`

### Task 3: The warning's amber edge pulses slowly, and holds still under reduced motion

**Files:**
- Modify: `apps/till/src/screens/till-floor-screen.ts` (the bar's styles `:816-858`, D6 and D7: the
  section's `pulsing` class only while warning and `!this.#prefersReducedMotion()`; keyframe
  `ready-warning`; the `@media (prefers-reduced-motion: reduce)` rule; the warning entry's part
  rules and hover cue), `packages/ui-core/src/tokens/colors.css` (the comment at `:120-121` and its
  repeat beside each later copy of `--wt-color-warning-pulse-dim`, D10),
  `packages/ui-core/src/tokens/structure.css` (the comment at `:50`, D10)
- Test: `apps/till/src/screens/till-floor-screen.ready-bar.test.ts` (new cases in Task 2's
  `describe`), `apps/till/src/screens/till-floor-screen.a11y.test.ts` (a new case beside "has no
  violations with the Ready bar, on the list", `:792`, inside the light/dark `describe.each`, `:310`)

- [ ] **Step 1: Failing tests** (A738's cases are the model: `till-shell.counter-cleanup.test.ts:124`,
  `:159`, `:171`; `commands.emulateReducedMotion` is the till's own browser command,
  `apps/till/vitest.config.ts:65`, typed as `till-shell.counter-cleanup.test.ts:118-122` does; always
  reset it in `finally`):
  Cases 1, 2 and 4 first call `await commands.emulateReducedMotion(false)`, as
  `till-shell.counter-cleanup.test.ts:159` and `:171` do, so a test browser left in reduced motion
  cannot hide the pulse.
  1. "a warning bar pulses at the slow pulse token, 2 s by default" — `reducedMotion: false`:
     the section's `animationName` is `ready-warning`, `animationDuration` `2s`; with
     `--wt-duration-pulse-slow: 5000ms` set on the floor, `5s`. A calm bar: `animationName` `none`.
  2. "its edge dims to the amber dim colour half-way" — set `--wt-color-warning` and
     `--wt-color-warning-pulse-dim` to distinct `rgb(…)` values on the floor; pause the section's
     animation; at `currentTime` 1000 the border colour and the box-shadow's colour are the dim one,
     at 0 the warning one.
  3. "under reduced motion nothing moves and the amber stays" — `reducedMotion: true`, and
     separately nothing injected with `emulateReducedMotion(true)`: `animationName` `none`, border
     colour `--wt-color-warning`'s, heading colour the same (probe: both `none`, `rgb(138, 83, 0)`).
  4. "the warning entry is amber and keeps a hover cue; the calm entry is unchanged" — the warning
     entry's `::part(button)` (read its native `button`) has `color` and `border-top-color` equal to
     `--wt-color-warning`; hovered (`userEvent.hover`), its border reads `--wt-color-primary-text`;
     the calm entry's colours equal a calm bar's.
  5. "the warning does not change the bar's height" — in the file's layout helpers
     (`inShell`, `:242`), at 390 and 1024 px: the bar's height with one warning table equals its
     height calm (probe: 50 and 50), and stays within `oneLine(area)` (`test-helpers.ts:742`).
  6. a11y, "has no violations with a warning Ready bar, in {en, es} at {390, 1024} px" — case 2's
     tables, stamped against a fixed `now` passed to the floor (the existing bar case, `:792`, mounts
     on the real clock and has no ready times; without a fixed `now` the bar's state would depend
     on when the test runs), `reducedMotion: true` (a still frame for axe), in both themes: no violations, so the
     amber text has the contrast axe requires on its fill (D6's ratios, ran).
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/till exec vitest run src/screens/till-floor-screen.ready-bar.test.ts src/screens/till-floor-screen.a11y.test.ts`
  — cases 1–4 (no styles yet); 5 and 6 may pass on arrival and stay.
- [ ] **Step 3: Implement** D6 and D7 with `--wt-*` tokens only (CLAUDE.md §3; check by eye: no
  hex, `rem` or `em`), and D10's comments.
- [ ] **Step 4: Run; expect PASS**, then the floor suites (Task 2's Step 4 command),
  `pnpm exec vitest run scripts/style-token-names.test.ts scripts/primary-coloured-text.test.ts`,
  and `pnpm --filter @waitron/ui-core exec vitest run src/tokens` (the token files' own suites,
  comments only; a failure is a STOP).
- [ ] **Step 5:** typecheck till; eslint the changed `.ts` files; `pnpm format:check`; ledger;
  `git commit -s -m "A797-7: the Ready bar's warning pulses amber, and holds still under reduced motion"`

### Task 4: The minutes keep counting between floor reads

**Files:**
- Modify: `apps/till/src/screens/till-floor-screen.ts` (`#watchReminders` `:1079-1096`: on a
  handheld, `next = Math.min(next, nextReadyBarChange(this.#readyEntries(), this.#drawnAt))`; its
  comment and the `now` property's comment, `:887-888`, gain "and when the Ready bar's minutes or
  warning change")
- Test: `apps/till/src/screens/till-floor-screen.ready-bar.test.ts` (a `describe` "on the screen's
  own clock", modelled on `till-floor-screen.held.test.ts:216-279`:
  `vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] })` and `vi.setSystemTime`,
  `vi.useRealTimers()` after each; mount with no `now`; advance with
  `await vi.advanceTimersByTimeAsync(…)` then `await el.updateComplete`. Animation frames are not
  faked, so nothing waits on a paused `requestAnimationFrame` (CLAUDE.md §4); the probe ran this
  shape green.)

- [ ] **Step 1: Failing tests:**
  1. "counts the minutes up with no new floor read" — Table 2 ready 2:30 at 3: "Ready"; +30 s
     "Ready 3 min" with `data-warning`; +60 s "Ready 4 min"; +60 s "Ready 5 min"; no `floor-refresh`
     event (probe: exactly this; control without the change: "Ready" four times).
  2. "turns amber at the crossing, judged per station" — Table 2 Cold ready 4 min at 6 (amber at
     +120 s), Table 8 Grill ready 2 min at 3 (amber at +60 s): calm, Table 2 first; +60 s: Table 8
     first and alone amber, "Ready 3 min"; +60 s more: both amber, Table 2 first, "Ready 6 min".
     (Arithmetic, per D1–D3: Table 2 reaches 6:00 at +120 s, Table 8 3:00 at +60 s; among amber
     tables the older dish leads.)
  3. "keeps one timer beside a held countdown, however often the floor redraws" — a held table
     (`till-floor-screen.held.test.ts`'s builder) and a warning one: `vi.getTimerCount()` is 1
     before and after three redraws.
  4. "keeps no timer for ready food with no time, nor on a till" — untimed ready food on a
     handheld, and timed food on a till (`handheld` unset): no timer; advancing 5 min calls no
     `requestUpdate`.
  5. "reads the minutes now on coming back to the page" — a table ready 4:30 at 3: "Ready 4 min";
     remove the floor; advance 3 min; append it; `advanceTimersByTimeAsync(0)` → "Ready 7 min"
     (Review focus 7).
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/till exec vitest run src/screens/till-floor-screen.ready-bar.test.ts -t "own clock"`
  — 1, 2 and 5 (no redraw); 3 and 4 pass on arrival and stay.
- [ ] **Step 3: Implement** D5.
- [ ] **Step 4: Run; expect PASS**, then the floor suites (Task 2's Step 4 command), which include
  `till-floor-screen.held.test.ts` and `.steps.test.ts`, whose timer counts must not change.
- [ ] **Step 5:** typecheck till; eslint; `pnpm format:check`; ledger;
  `git commit -s -m "A797-7: the Ready bar's minutes keep counting between floor reads"`

### Task 5: In the app, a handheld's Ready bar warns on the device's clock

**Files:**
- Test only: `apps/till/src/till-app-device-zones.test.ts` (inside slice 5's Ready bar `describe`,
  beside its `readyIn` builder, `:2349-2364`, which gains an optional ready time and minutes)

The app passes the floor no `now` (the table above), so this pins that the real app's Floor draws
the warning from its own clock; no source change is expected. If either case fails, STOP and report:
it means the app hands the floor something the plan did not read.

- [ ] **Step 1: Tests:**
  1. "a handheld's Ready bar warns once food has waited its station's minutes" — on the real clock
     (the file fakes only `setInterval`, `:221`, `:1887`; faking `Date` across a whole app mount is
     not needed): two `room` tables, one ready at `Date.now() − 4.5 min` and one at
     `Date.now() − 1 min`, both at 3: the bar reads "Ready 4 min", the first entry is the
     4½-minute table and warns; tapping Open › opens it on the Order tab. The half minute keeps the
     reading clear of a minute boundary during the run.
  2. "a till's summary shows no warning" — the file's till `mount`, the same tables: the summary,
     no `[data-warning]`.
- [ ] **Step 2: Run; expect PASS** `pnpm --filter @waitron/till exec vitest run src/till-app-device-zones.test.ts`
  (memory first). Confirm by deletion that case 1 can fail: in a scratch copy, make the floor's
  `#readyBar` ignore `waitedMinutes`, rerun, and record the failing line in the ledger; restore.
- [ ] **Step 3:** eslint; `pnpm format:check`; ledger;
  `git commit -s -m "A797-7: the app's Ready bar warns on the device's clock"`

### Task 6: Docs, the user guides and the backlog follow the code

**Files:**
- Modify: `apps/server/src/guide/en/table-service.md` (`## See which tables have food ready {#ready-bar}`,
  `:164-172`), `apps/server/src/guide/es/table-service.md` (`{#ready-bar}`, `:170-178`),
  `apps/server/src/guide/en/kitchen-service.md` (`:106-108`), `apps/server/src/guide/es/kitchen-service.md`
  (`:122-125`),
  `docs/developers/design-system.md` (`:990-996`, `:421-422`, `:614-616`), `docs/backlog.md` (the
  A797 entry, `:120-133`), `docs/backlog/till.md` (A797's entry, `:1036-1050`),
  `docs/superpowers/specs/2026-10-18-a797-device-screens-design.md` (§3.1's warning bullet,
  `:258-266`: a dated pointer)
- Test: `apps/server/src/guide-content.test.ts`, `scripts/guide-links.test.ts`

- [ ] **Step 1: Guides.** English: replace "Tap a table to open it, or tap **Open ›** to open the
  first table listed." with the order and the warning, in about three sentences: while no food has
  waited too long, the table whose food has waited longest comes first; once a ready dish has waited as long as its station's
  **Ready warning** time (3 minutes unless changed in **Prep stations**; see the kitchen guide's
  sentence, `kitchen-service.md:106-108`), the bar turns amber, pulses slowly and says how long,
  such as **Ready 4 min · T5 · 2**, and tables whose food has waited too long come first, each
  station judged by its own time; on a device set to reduce motion it stays amber without pulsing;
  tap a table to open it, or **Open ›** for the first. Spanish the same, with «Listo 4 min · M5 · 2»,
  «Listo sin recoger» and «Estaciones de preparación» (read both from `strings.ts`'s `es` blocks
  before writing). Spanish only in the Spanish file. **The kitchen guide** (slice 6 D10 left this
  to slice 7): today `kitchen-service.md:106-108` (English) and `:122-125` (Spanish) tell the owner
  to set a **Ready warning** «Listo sin recoger» time without saying what it does. Add one clause
  in each: on a phone or tablet the Ready bar turns amber once a ready dish has waited that long,
  linking to [See which tables have food ready](table-service.md#ready-bar) /
  [Ver qué mesas tienen comida lista](table-service.md#ready-bar). The anchor is on both pages
  (ran: `grep -n "{#ready-bar}" apps/server/src/guide/{en,es}/table-service.md` → en `:164`, es
  `:170`), and the guides link a section of another page in this form (ran: e.g.
  `](box-status.md#clock-behind)`).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and
  `pnpm exec vitest run scripts/guide-links.test.ts`; PASS.
- [ ] **Step 3: design-system.md.** In the Ready bar paragraph (`:990-996`): "While a table's food
  has waited as long as its station's ready warning time (`readyBar`, `apps/till/src/state/table-signals.ts`),
  the bar's edge and heading turn `--wt-color-warning`, the edge pulsing at `--wt-duration-pulse-slow`
  to `--wt-color-warning-pulse-dim` (not moving under reduced motion), the heading gains the minutes,
  warning tables come first and their entries are amber; the floor's one reminder timer redraws it
  each minute." At `:421-422` and `:614-616`: the Ready bar's warning edge also dims to
  `--wt-color-warning-pulse-dim` and reads the slow duration.
- [ ] **Step 4: Backlog.** Both A797 entries: slice 7 (the Ready bar's warning) in review, built from
  the build plan's slice 7; next, slice 8 (kitchen group cards), which takes turns with lane G's
  A773-2 on the station screen (design §7; the build order above). After the merge, a docs-only
  commit on `main` says "landed in #N", as `28ab55247` did for slice 6. Open no new entry unless the
  LOOK finds something this slice does not fix (its number from
  `~/waitron-campaign-shared/next-item-number`: read it, use it, write the next back).
- [ ] **Step 5: Design file** (a dated pointer; a design records what was decided when): after
  §3.1's warning bullet, "_2026-10-26, slice 7: warning tables come first, then the rest, each
  longest-waiting first, so Open › opens the first; the minutes show only while warning; the till
  compares the box's ready time with its own clock; see the build plan's slice 7, D2–D4._"
- [ ] **Step 6: Check** `pnpm exec prettier --file-info docs/backlog.md` prints `"ignored": true`
  (wrap by hand); `pnpm format:check` for the guide files.
- [ ] **Step 7: Commit** `git commit -s -m "docs: A797-7 — guides, design system and backlog for the Ready bar's warning"`

### Task 7 (visual): LOOK at the Ready bar calm and warning

- [ ] **Step 1: Start the stack** `wa-wt demo waitron-feat-a797-7-ready-bar-warning`; `wa-wt ls`
  for the URLs. Enrol a browser context on the Handheld profile («Móvil»), as slice 5's Task 8 did,
  and sign in. In the dashboard's **Prep stations**, set one station's Ready warning to **1** and
  leave another at 3 (so the per-station judgement shows within minutes).
- [ ] **Step 2: Make food ready.** Seat two tables in one zone, send one a dish from the 1-minute
  station and the other a dish from the 3-minute station, and mark both ready on the kitchen screen.
- [ ] **Step 3: Look** with the workspace's Playwright Chromium (the script in
  `/Users/clintongormley/waitron-campaign-c/a797-7-scripts/`, never in the worktree, its process id
  recorded), at **390 px** and **1024 px**, **light and dark**, **English and Spanish**:
  - the calm bar at once: "Ready", the table ready longest first;
  - after a minute, with no reload: amber, "Ready 1 min" «Listo 1 min», the 1-minute station's table
    first and its entry amber, the other calm; the count reaching 2 a minute later on its own;
  - the pulse: two pictures about a second apart (its bright and dim moments), and the computed
    `animation-name` in the ledger;
  - set the 390 px light English warning picture beside picture 01's middle panel
    (`docs/backlog/mockups/a797-device-screens/01-handheld-floor.png`) and describe each difference
    in the ledger and the PR body: D6's plain fill and inner edge are expected; anything else (the
    order, the words, the amber entry, Open ›) that differs is a finding;
  - a context with `reducedMotion: "reduce"`: amber, nothing moving (`animation-name: none`);
  - the Sent toast after a send sits above the warning bar, not over it;
  - help on at 390 px: the badge's text reads as D8 says, and "Ready 4 min" and Open › stay in view;
  - serve the warning table's dish: the bar goes calm or away at the next read.
- [ ] **Step 4: Save** each picture as a PNG under `/Users/clintongormley/waitron-campaign-c/a797-7-shots/`
  (`<step>-<width>-<theme>-<lang>.png`), open each, and describe what was seen in the ledger and the
  PR body. Set the station's Ready warning back to 3 in the demo afterwards.
- [ ] **Step 5: Stop** what you started: the script's process by its recorded id, then
  `wa-wt down waitron-feat-a797-7-ready-bar-warning`.

### Closing slice 7

- Focused runs per task as above; CI runs the till's package suites and coverage (and ui-core's,
  for the comments). Read the `changes` job's outputs and the till's coverage or merge job on the
  current head before calling the PR green.
- `/finish-branch` with this plan named. Review path **LIGHT**: the plan-against-spec read and one
  Codex run-it review.
- PR body. First line: no venue reset. Then: **What a person sees** (the warning, the order, Open ›
  opening the first table listed, the longest-waiting of the warning tables or of all while none warns; a till unchanged); **Decisions** D1–D10 in one line each;
  **Changed test checks** (the five `readyTables` checks, reason D1, from the ledger); **LOOK**.
- **Owner FYI** (one line each in the PR and the lane's questions file, not questions): D2 (amber
  tables first, then longest-first; the alternative is plain longest-first), D4 (the device's clock,
  as the Sent box's "Ready n min"), D7 (which later entries warn is shown by colour alone; the
  alternative is amber on the bar only), D1 (an amber table's place and minutes come from its
  oldest ready dish, even a calm one; the alternative counts its warning dishes only), D6 (the
  warning keeps the bar's plain fill and a 2-px inner edge, not picture 01's amber fill and thick
  outer ring).
- After merge: delete the branch local and remote and check the remote one is gone; the backlog's
  "landed in #N" commit; update the ledger; then slice 8 when lane G's turn allows.

---

## Slice 8 — Kitchen group cards (one PR, branch `feat/a797-8-kitchen-group-cards`)

**What it changes.** On a kitchen screen (a kitchen display, or the till's Station screen), the
three columns stay, but each now holds **cards, one per group** a table sent (Q42 (d)), or one per
counter order, in place of today's one cell per dish. A card sits in the column of its least
advanced dish. **Tap a dish** to move it on one step, as today; **tap the card's heading** to move
the card on one column. The band along the card's top is its age: green, then amber, then red; a
forgotten card's band pulses at A757's fast speed. Above the columns, "5 dishes to make · 1 late"
replaces today's "1 overdue" badge. The first column is called **Waiting** («Esperando»), no longer
New. **The Tickets view goes, with its Board/Tickets switch**: the card is the ticket, so
everything a ticket showed (the kitchen note, a printing problem, the order's dishes at other
stations, Collect and Reprint) is on the card. Merged/Stacked stays (design §3.3). Overview, the
Held column, collapse, the Columns panel, narrow tabs and short names on cards are later slices
(8b, 9, 9b, 9c) or A773-2's (design §7, §8).

**Review path: LIGHT.** No server read, route, schema or shared type changes. The till starts
reading one field the station read already sends, each dish's `queuedAt`
(`apps/server/src/working-order.ts:7367`, set at `:7809`; the device route reads the same
`listStationQueues`, `apps/server/src/device-api.ts:1038`, `:1047`, all read), so what the server
sends is unchanged. The changed files are under `apps/till/src/`, two token comments in
`packages/ui-core/src/tokens/`, the guides and the docs. The heading tap sends today's per-dish
route once per dish, in turn (D8); each call is the same single-row, state-guarded update the
per-dish tap already makes (`advanceTicketItem`, `working-order.ts:7221-7264`, `eq(state, from)`,
read), so it adds no new concurrency path. None of the risk triggers applies. **Migration: none.**
No venue reset.

How claims are marked in this section: **(ran)** means run on 2026-10-26 against `main` at
`52eb61a11` (this worktree's base; the brief named `8e8ef605a`, and `main` gained #2111, the
"Powered by Waitron" mark, in between: ran `git diff --stat 8e8ef605a 52eb61a11`, which touches
`till-shell.ts` and its tests and no station file); **(read)** means read in the code at that commit. The probe ran in a throwaway worktree
(`git worktree add --detach /tmp/a797-8-probe.3AdW/wt 52eb61a11`), removed afterwards; its diff and
logs were copied to `/Users/clintongormley/waitron-campaign-c/a797-8-probe/` (`probe.diff`,
`base1.txt`, `run1.txt`–`run3.txt`, `tsc1.txt`–`tsc3.txt`). None of the probe code is in this branch.

### The turn with lane G's A773-2 (ran)

Design §7 has the two lanes take turns on `station-queue.ts`, `till-station-screen.ts` and
`till-expo-screen.ts`. On 2026-10-26: no open pull request names A773 (`gh pr list --search "A773"
--state open` → `[]`); no branch on `origin` names it (`git ls-remote origin | grep -i a773` →
only old `refs/pull/*` heads); lane G's queue has no A773-2 entry
(`grep -n "A773-2" ~/waitron-campaign-g/queue.md` → nothing; its latest progress lines are about
D316); and `main` holds A773-2's plan and none of its code (`git log --oneline | grep -i a773` →
`9d6157fa3`, the plan; the only code commit is `c9ad7a634`, A773-1, #1897; the rest are
specs and plans). So nobody is editing these files, and slice 8 takes the turn. It
leaves `till-expo-screen.ts` alone. The closing step posts a one-line note in lane C's questions
file that slice 8 holds the two station files until it lands.

What slice 8 leaves for A773-2 to build on, from its plan: the station's Held contents ("held and
requested, distinguishing Waiting for the pass", A773-2 Task 7, plan line 305) go into a column
slice 8 does not draw; the card grouping is one pure function (`kitchenCards`, Task 2) that
A773-2 can extend with its phases; A756's per-station bump mode is kept (A773-2 plan line 311,
"preserving A756 bump mode"). A773-2's Task 2 removes station Fire and Away/Done levers that are
already gone from this widget (`station-queue.ts` has no `data-fire`: ran
`grep -n "data-fire" apps/till/src/widgets/station-queue.ts` → nothing).

### Every reader and writer this slice touches (ran: grep; each line read)

From `grep -rn "till-station-queue\|view_rail\|view_kanban\|data-view-toggle\|advance-ticket\b\|advanceTicket\b" apps/till/src --include='*.ts' | grep -v "\.test\.ts"`
(ran), `grep -rn "station\.state\.\|station.overdue_count\|station.min\b" apps/till/src --include='*.ts'`
(ran) and `grep -rn "pulse-fast\|danger-pulse-dim" apps packages --include='*.ts' --include='*.css'`
(ran), each line read:

| Where | What it does today | In this slice |
| --- | --- | --- |
| `apps/till/src/widgets/station-queue.ts:640` `view`, `:787-794` `#queue` | draws the Board (`#kanban`, `:1018-1031`) or, with `view="rail"`, the Tickets view (`#rail`, `:882-912`) | the board of cards only; `view` deleted (D3, D13) |
| same file `:1018-1031` `#kanban`, `:1041-1052` `#kanbanCell`, `:1070-1076` `#cell` | one cell per dish in its state's column, each with the order's number and label, the kitchen note and the whole-ticket mark | one card per group (D1–D6) |
| same file `:882-912` `#rail`, `:718-749` `#courseSections`, `#groupSections`, `:933-975` `#courseSection`, `#groupSection` | one card per order: head (number, allergy marker, label, minutes), whole-ticket mark, kitchen note, printing problem, course or group sections, other stations' dishes, Collect, Reprint | its parts move onto each group card (D5, D11); a party's group sections become cards |
| same file `:978-987` `#printProblems` | on the Board only, "Printing problem: #12 · T4" above the columns | deleted: each card says it (D11) |
| same file `:756-758` `#band`, `:760-762` `#elapsedMinutes`, `:768-771` `#accentClasses` | ages an order by `group.queuedAt`, the order's oldest line at the station | ages a card by its own oldest fired dish (D4) |
| same file `:401-457` styles | the age accent is a left border: fresh none, warm `--wt-color-primary`, overdue and forgotten `--wt-color-danger`; forgotten flashes it to `transparent` over `--wt-duration-pulse-fast`, off under reduced motion (class and `@media`) | a top band: green, amber, red; forgotten pulses to `--wt-color-danger-pulse-dim` (D7) |
| same file `:773-781` `#overdueCount`, `#header` | "N overdue" badge, counting orders at overdue or worse, ready ones included | "N dishes to make · M late" (D9) |
| same file `:658-678` `#bump` | line mode: `advance-ticket-item` for the dish; ticket mode: `advance-ticket` for the whole order at the station | ticket mode: `advance-dishes` for the card's dishes at the tapped dish's stage (D8) |
| same file `:1054-1057` `#wholeTicket` | "Whole ticket" once on a rail card, and on each bumpable Board cell | once on the card (D8) |
| same file `:1063-1068` `#line`, `:1078-1141` `#renderLine` | a dish's state word beside it on a rail card | the state word only for a dish ahead of its card's column (D12) |
| `apps/till/src/screens/till-station-screen.ts:239` `view`, `:556-558` `#toggleView`, `:1007-1019` the toggle, `:917`, `:1109` `.view=` | Board/Tickets switch | deleted (D13) |
| same file `:41-49` `ADVANCE_FROM`, `:608-638` `#onAdvanceTicket`, `#deviceAdvanceTicket`, `:982` `@advance-ticket` | operator: one `advanceTicket` call; device: one `deviceAdvance` per fired dish of the order at the step's starting state | one handler, `advance-dishes`, one per-dish call per dish, in turn (D8) |
| same file `:592-606` `#onAdvanceTicketItem` | one dish: `advanceTicketItem` or `deviceAdvance` | unchanged |
| same file `:886-921` `#mergedBody` | sorts the merged orders by `queuedAt`, labels each order with its station | unchanged; the widget orders cards itself (D2) |
| `apps/till/src/api/client.ts:1530-1572` `StationQueueItem` | no `queuedAt`, though the read sends one (above) | gains `queuedAt: string` (D4) |
| same file `:1644-1653` `StationQueueGroup.queuedAt`'s comment | "the group's ordering key and the age-colouring anchor" | no longer the anchor: comment narrowed |
| same file `:3338-3354` `advanceTicket` | `POST /api/orders/:id/stations/:sid/advance` | deleted: no caller left (D8) |
| `apps/server/src/till-api.ts:2250-2276` that route | whole order at one station | unchanged; left for a later change (D8) |
| `apps/server/src/attendance-capture.ts:21-45` `captureKitchenActivity` | called by both till advance routes (`till-api.ts:2239-2241`, `:2270-2272`; the device route passes none, `device-api.ts:656`): one staff-activity fact per distinct order per call, each call with a new command key | unchanged; a till heading tap now writes one fact per dish where the whole-order call wrote one per order (D8) |
| `packages/db/src/schema/order-groups.ts:22` `partyId`, `packages/db/src/schema/orders.ts:124` `working_orders_party_idx` | a group belongs to the party, and a party may hold several bills (the index is not unique) | one card per group across its bills (D1) |
| `apps/till/src/till-app.ts:18895` `@advance-ticket-item` | the counter's own handler (the station screen stops its own events, `till-station-screen.ts:593`) | unchanged |
| `apps/till/src/i18n/strings.ts` en `:652-653`, es `:2405-2406` | `station.view_kanban` "Board" «Tablero», `station.view_rail` "Tickets" «Comandas» | deleted (D13) |
| same file en `:677`, es `:2429` `station.state.queued` | "New" «Nuevo»: the column, a rail dish's state, the pass's dish state (`till-expo-screen.ts:922`), "Also on this order" (`station-queue.ts:925`), a department transfer's work (`widgets/department-transfers.ts:524`) | "Waiting" «Esperando» in all five (D10) |
| same file en `:659`, es `:2411` `station.overdue_count` | the station's badge and the pass's (`till-expo-screen.ts:1046`) | kept for the pass; the station stops reading it |
| `packages/ui-core/src/tokens/colors.css:120-121`, `structure.css:50` | comments naming who dims to the pulse colours and reads each pulse speed | gain the forgotten card's band (D7) |
| `apps/till/src/screens/till-expo-screen.ts:188-237` | comments citing the station queue's rail card and `.cell` | comments only: they name a card that changes; reworded to "the kitchen screen's cards" (Task 4), nothing else in the file |

### Plan decisions for slice 8

- **D1. One card per group per station, across the group's bills.** A group belongs to the party,
  not to a bill (`order_groups.party_id`, `packages/db/src/schema/order-groups.ts:22`), a party may
  hold several bills (`working_orders_party_idx` is a plain index, `packages/db/src/schema/orders.ts:124`),
  and the pass's Ready for a group reaches "every fired kitchen item of its lines, on every bill of
  the party" (`apps/server/src/order-groups.ts:602-605`; all read). The station read, though, is one
  entry per bill (`groups.get(row.orderId)`, `working-order.ts:7728`), so a group sent across Bill 1
  and Bill 2 arrives as two entries. So a card is keyed by station and group, **merging the group's
  bills**: one card per group (design §3.3), as A773-2's pass keeps "one group card across bills"
  (its plan lines 97, 238, 307). A dish's group is `item.group` (`QueueGroup`, `client.ts:1520-1527`);
  it is absent "on a bill with no party, and on a line moved in from another bill" (`:1563-1564`,
  read), so dishes with no group are keyed by station and bill: a counter order, or any bill with no
  party, is one card (design §3.3, "or per counter order"), and a party bill's dishes with no group
  (moved in) make one card of their own, as today's rail put them in a "no group" section first
  (`#groupSections`, `:734-749`). In a merged screen each station's part is its own card, as each
  bill is today (`MergedQueueGroup`, `:71`). A card keeps its bills in the read's order. The
  grouping is one pure function, `kitchenCards` in a new `apps/till/src/state/kitchen-cards.ts`,
  beside the floor's pure state files, so slice 9c's Overview and A773-2's Held work read the same
  cards.
- **D2. A card sits in the column of its least advanced dish** (design §3.3), held dishes counting
  as Waiting (a held dish's state is `queued`, `firedAt` null; `client.ts:1567-1569`). **Within a
  column, the oldest card first**: by its age (D4); a card with no fired dish after every timed
  one; ties in the read's order of each card's first bill (oldest first, `working-order.ts:7669`),
  then by group position with the no-group card first, as `#groupSections` sorts today. Today's per-order
  sort by `queuedAt` would put a table's second group, fired forty minutes after its first, above
  a newer table's first group.
- **D3. A held card stays in Waiting until A773-2 adds Held.** A card all of whose dishes are held
  is drawn in Waiting with a dashed outline and today's "Held, not released" («En espera, sin
  marchar», `station.group_held`) in its heading, with no band, no minutes and no heading tap.
  Design §3.3 lists a separate Held column, but its contents are A773-2's: §7 "A773-2 builds: …
  the kitchen screen's Held contents (held and requested, 'Waiting for the pass')" and §8 slice 12
  "Built by A773-2 … the kitchen's Held column" (design `:609-610`, `:696-697`, read); A773-2's plan
  Task 7 has the station "register Overview/Held/Waiting/Preparing/Ready" (its line 101) and puts
  held and requested in Held (line 305). Today held dishes already sit in the first column, dashed
  (`.line.held`, `station-queue.ts:369-373`), so this keeps where a cook finds them. **Owner FYI:**
  design §3.8 gives Waiting one meaning, "released to the station, not started", and a held card
  under that heading stretches it until A773-2 lands. The alternative is an interim Held column in
  slice 8 holding held cards only, which A773-2 would then extend with requested work; the plan
  does not build it, so as not to build part of A773-2's column ahead of it.
- **D4. A card ages from its own oldest fired dish.** Each dish's `queuedAt` is already on the wire
  (above); the till's `StationQueueItem` gains `queuedAt: string`, required, as the server always
  sends it. Firing sets it and a release re-routing a held dish sets it again (design §5, read), so
  a group fired at 21:15 counts from 21:15, not from the table's first group at 20:40, which is
  the order's `queuedAt` the widget ages by today (`#band`, `:756-758`; the read sets the order's
  `queuedAt` from its first row, `working-order.ts:7728-7735`, read). Held dishes do not count.
  Thresholds stay the order's station's (`group.thresholds`). **Receipt (ran, the probe):** the
  type change compiles in the source and fails only test fixtures, 63 item literals in 9 files
  (`tsc2.txt`); each gains `queuedAt` equal to its order's, so every band they check is unchanged
  (Task 1, fixture-only).
- **D5. What a card shows.** Its heading: each of its bills' numbers with any former numbers (as
  today; one number on almost every card, "#12 · #13" when a group spans two bills), the allergy
  marker when a dish on it has an allergy, its bills' labels, each once (today's table or order
  label; the short name is slice 8b), the group's name with its party label (`groupName`,
  `widgets/group-name.ts:14-18`, "Group 2 · Terrace 7"), the course when every dish on the card
  shares one, "Held, not released" when the group is held, and the minutes (D6). Under it, in
  order: the whole-ticket mark (D8), the kitchen note, the printing problem, the dishes, the
  order's dishes at other stations, Collect, Reprint. **Courses:** when the card's dishes are in
  more than one course, today's course sub-heads go inside the card, null course first, then by
  display order (`#courseSections`, `:718-731`), and the heading names none. This changes one
  thing a test pins today: a party's rail card names no course ("no course headers", "not
  contain Principales", `station-queue.test.ts:1937-1954`); design §3.3 puts "the group and its
  course" on the card. The bill's name (A803) is not on `main`, so there is nothing to show yet. **"Counter #12"**
  (design §3.3) is not built here: the read does not say whether a bill is a counter order (a bill
  with no `party` may also be a table's, `client.ts:1658`), so slice 8b, which changes the station
  read for short names, carries it with them; Task 8 adds that to slice 8b's outline. Until then a
  counter card reads as today, "#12" and its label.
- **D6. The timer stays whole minutes, "7 min"**, as today (`station.min`). Picture 03 draws
  "2:10"; a seconds count would redraw every kitchen screen every second against today's 20-second
  clock (`TickingClock`, `packages/ui/src/ticking-clock.ts:10`, read). **Owner FYI**, with the
  alternative: minutes and seconds.
- **D7. The age band: a top border one `--wt-space-1` thick.** Fresh `--wt-color-success`, warm
  `--wt-color-warning`, overdue and forgotten `--wt-color-danger` (design §3.3: "green, then
  amber, then red"); overdue and forgotten also draw the card's 1-px outline in
  `--wt-color-danger`, as picture 03 rings T2. A forgotten card's band and outline pulse to
  `--wt-color-danger-pulse-dim` half-way over `--wt-duration-pulse-fast`, as A757's fast ring
  does (`packages/ui/src/floor-ring.ts:27`, `:75-76`), keeping today's two reduced-motion gates
  (the `flash` class only while `!#prefersReducedMotion()`, and the `@media` rule,
  `station-queue.ts:441-457`). This changes two of today's colours: warm was
  `--wt-color-primary` (blue) and fresh had none. **Not colour alone:** the minutes are on every
  timed card and "N late" in the header line (D9). A held card draws no band (D3). **Contrast (ran):**
  `python3 -I /Users/clintongormley/waitron-campaign-c/a797-8-scripts/band-contrast.py` (the WCAG
  ratio over the token values, `packages/ui-core/src/tokens/colors.css:7`, `:18`, `:25-26`, dark
  `:143`, `:154`, `:161-162`) gives, against the card's `--wt-color-surface` and the page's
  `--wt-color-bg`: light success 4.97 / 4.64, warning 6.33 / 5.91, danger 6.54 / 6.11; dark success
  7.49 / 8.23, warning 9.14 / 10.04, danger 6.94 / 7.62, each above WCAG's 3:1 for a graphic. The
  pulse's dim moment, `--wt-color-danger-pulse-dim`, is 1.68 / 1.57 in light (6.79 / 7.46 dark): the
  band fades for half a beat, as A757's rings do, and is steady red under reduced motion. Task 4's
  axe sweep checks the text on the card, not the band (axe's colour-contrast rule reads text).
- **D8. Taps, and the station's bump mode** (design §9 asked the plan to trace it). The mode is
  each station's, carried on every queue order (`bumpMode`, `client.ts:1673`; #2037, read).
  - **A dish tap, "One item at a time":** that dish one step, through today's `advance-ticket-item`
    (unchanged).
  - **A heading tap, either mode:** every fired dish on the card at the card's least advanced stage
    that is not Ready moves one step, so the card moves one column (picture 03's caption: "tap a
    card's heading to move the whole card on"). A dish already further on does not move: a card
    with the entrecôte Waiting and the secreto Preparing goes to Preparing with both Preparing; the
    secreto is not marked Ready. **Departure, for the owner:** design §3.3 says "move every dish on
    it one step", which would also mark the secreto Ready. Marking a dish Ready that is not tells
    the pass and the handheld's Ready bar it can go out (slice 7), so the plan moves only the dishes
    holding the card back; the two readings agree whenever a card's dishes are at one stage, which
    is every card a heading tap is drawn on in design §4's example 4.
  - **A dish tap, "Whole ticket at once":** every fired dish on the same card at the tapped dish's
    stage moves one step. Today it moves those dishes across the whole order at the station
    (`advanceTicket`, `working-order.ts:7267-7292`; the device's loop, `till-station-screen.ts:624-638`,
    read). Narrowed to the card because "the card is the ticket" (design §3.3) and another group's
    card may sit in another column. The "Whole ticket" mark («Toda la comanda») shows once on such
    a card while something on it can move, as the rail card showed it (#2037).
  - **Route:** both send one new event, `advance-dishes` `{ itemIds, stationId, to }`; the screen
    sends today's per-dish route for each id in turn (`advanceTicketItem` on a till,
    `deviceAdvance` on a kitchen display; `client.ts:3330`, `:3491`), never
    `Promise.all`, then reloads, exactly as the device's whole-ticket loop does today. The first
    refusal stops the loop and the reload shows the truth; a full disk shows its line
    (`#advance`, `:564-575`). On a till this replaces one whole-order call with several per-dish
    calls: a refusal half-way leaves the earlier dishes moved, as on a kitchen display today.
    `advance-ticket`, `#onAdvanceTicket`, `#deviceAdvanceTicket`, `ADVANCE_FROM` and the till's
    `TillApi.advanceTicket` (no other caller: the grep above) are deleted. **Side effect, on a till
    only:** each per-dish call records the person's kitchen activity for its bill with a new
    command key (`captureKitchenActivity`, `attendance-capture.ts:21-45`, through
    `till-api.ts:2239-2241`), so a heading tap over three dishes writes three activity facts where
    the whole-order call wrote one per bill; a kitchen display records none (`device-api.ts:656`
    passes no attendance). Permissions are unchanged: both till routes ask `prepare-orders`
    (`till-api.ts:2216`, `:2252`), the device route the same profile action (`device-api.ts:634`). **The server route
    `POST /api/orders/:id/stations/:sid/advance` stays**: retiring a till route is a FULL change of
    its own; Task 8 records it in A797's backlog detail as an open point.
  - The heading is a `<button>` only while a heading tap would move something (not all Ready, not
    all held); its accessible name is its words plus today's hidden "Advance ticket #12"
    (`station.bump_ticket`, with each of its bills' numbers), as a ticket-mode dish's is. A ticket-mode dish keeps its hidden
    "Advance ticket #12"; a line-mode dish "Advance #12" (`#bumpLabel`, `:1205-1208`).
- **D9. The header line: "5 dishes to make · 1 late"** at the top of each queue, where the "1
  overdue" badge is today (`#header`, `:777-781`), so a stacked screen has one per station and a
  merged one covers every station. **Dishes to make** sums the quantity of every fired dish that is
  Waiting or Preparing; a dish whose unit shows ("0.35 kg × Pulpo") counts as one, the rule
  `dishLine` uses to decide whether a quantity is a count (`widgets/dish-format.ts:15-28`). It is
  summed in thousandths (the wire's three places, `client.ts:1548`) so a fraction stays exact,
  and written as the dish rows write a quantity (`trimQuantity`, `dish-format.ts:11-13`): "1.5",
  in Spanish too, as «1.5× Croqueta» is today.
  **Late** counts cards with something to make whose band is overdue or forgotten; today's badge
  also counts orders whose food is all Ready (`#overdueCount`, `:773-775`). Picture 03 reads "6
  dishes to make · 1 late" with T2's red card holding two dishes, so late counts cards. The line
  shows while either count is above nothing; "· 1 late" only while some card is late. Plain text,
  `--wt-font-size-sm`, bold, in `--wt-color-text-muted`, as the column titles (`:133-139`); the
  danger-filled badge goes. **Where it sits departs from picture 03**, which puts it in one header
  row with the station's name, an "Open today" chip and the corner's Columns: today's station name
  and Open/Closed control (`station-today.ts:222-247`) stay as they are, and that header row is
  left to slice 9b, which adds the corner's Columns (Task 8 notes it on the slice 9b outline).
- **D10. Words.** New, en / es: `station.to_make` "{n} dishes to make" / «{n} platos por hacer»,
  `station.to_make_one` "1 dish to make" / «1 plato por hacer» (through `countText`,
  `i18n/t.ts:33-35`), `station.late` "{n} late" / «{n} con retraso». The English is design §3.3's;
  the Spanish is the plan's, with «con retraso», slice 6's Spanish for Overdue (design §3.8 note),
  and is an **Owner FYI**. `station.state.queued` becomes "Waiting" «Esperando» (§10 (g): "The
  kitchen column Waiting (A773's rename of New, «Nuevo» today) «Esperando»"; §6 retires "New" as
  a column name). Every other reader of that key means the same state, released and not started
  (the table above), so they change with it rather than keep a second word ("same language
  everywhere", design §1). Deleted: `station.view_kanban`, `station.view_rail` (D13).
- **D11. A bill's own facts and actions show on each of its cards**: the kitchen note, the
  printing problem, "Also on this order", Collect (a settled bill, not on a kitchen display) and
  Reprint (not on a kitchen display). These are **whole-bill facts on a group's card**: Reprint
  sends `reprintOrder(orderId)` and reprints the bill's ticket (`till-station-screen.ts:673-683`,
  `client.ts`'s `reprintOrder`), "Also on this order" lists the bill's dishes at other stations
  (`ElsewhereItem` has no group, `client.ts:1582-1592`), and the note is the bill's
  (`kitchenNote`, per bill, `working-order.ts:7732`), all read. They show on every card of the bill
  because a cook may see only one of them, in any column. On a card merging two bills (D1), each
  bill's note, printing problem, "Also on this order", Collect and Reprint are drawn once per bill,
  each naming its bill's number ("#12"), and Reprint's name says which ("Reprint #12"). The Board's
  printing-problem strip above the columns goes. Collect and Reprint now show on the till's
  Station screen without switching to Tickets, which is where they were (`#collectAction`,
  `#reprintAction`, `:991-1016`; tests "kanban: no per-order collect button", "kanban: no per-order
  reprint button" pin their absence from the Board).
- **D12. A dish's own words on a card.** A dish at its card's column shows no state word (the
  column says it); a dish further on shows "Preparing" or "Ready" and keeps today's coloured left
  edge (`.line.state-*`, `:353-363`); a held dish on a card that is not itself held shows "Held,
  not released", so a fired-and-held card does not rest on the dashed look alone. Everything else
  on a dish row is today's (`#renderLine`): Move, the move attribution, the note, extras, cross
  references, allergens, diet, the allergy block, the after-period mark. In a merged screen each
  dish keeps its station's name as today (`data-line-station`); moving it to the heading is left to
  slice 9's look.
- **D13. The Tickets view and its switch go** (design §3.3, §6): the widget's `view`, the screen's
  `view`, `#toggleView`, the toggle and its two strings. The screen's `showViews` option goes with
  it (it only hid the toggle, `:873`, `:1009`). Merged/Stacked stays. Every test that mounted the
  widget with `view: "rail"` and still checks something a card shows keeps its check without
  `view`; each `it.each` over the two views keeps one case (Changed test checks).
- **D14. Room for slices 8b, 9, 9b and 9c.** The board is drawn from one ordered list of columns
  (`COLUMNS`, `:53`) and from `kitchenCards`; slice 9's controller replaces the list with the
  device's order and collapsed set, mapping its column keys (A773-2 plan line 101: `"waiting"`,
  `"preparing"`, `"ready"`) onto these. `data-column` keeps today's state names (`queued`,
  `preparing`, `ready`). Slice 8b changes only the label in the heading. Nothing here stores
  anything on the device.

### Changed test checks (from the probe; the implementer confirms each)

**Probe (ran):** D1–D5, D7, D8, D9, D10 and D13 crudely in the widget and the screen, the item
type's `queuedAt`, and `TillApi.advanceTicket` deleted. Before the change, with free memory at 81 %
(ran `memory_pressure`), in `apps/till`:
`pnpm exec vitest run src/widgets/station-queue src/screens/till-station-screen src/screens/kitchen-allergy src/screens/text-size.layout src/screens/till-expo-screen`
→ `Test Files 15 passed (15)`, `Tests 789 passed (789)` (`base1.txt`). With the probe:

- `pnpm typecheck` in `apps/till`: the source compiled; 178 errors, every one in a test file
  (`tsc3.txt`): 112 for the widget's `view` (`kitchen-allergy.look.test.ts` 1,
  `till-station-screen.test.ts` 3, `station-queue.a11y.test.ts` 18, `station-queue.allergy.test.ts`
  6, `station-queue.kitchen-note.test.ts` 2, `station-queue.test.ts` 82), 63 for an item without
  `queuedAt` (9 files: `client.test.ts` 1, `kitchen-allergy-send.test.ts` 1,
  `text-size.layout.test.ts` 1, `till-station-screen.a11y.test.ts` 4, `till-station-screen.test.ts`
  8, `station-queue.a11y.test.ts` 17, `station-queue.kitchen-note.test.ts` 6,
  `station-queue.test.ts` 23, `test/kitchen-allergy-fixtures.ts` 2), and 5 for
  `advanceTicket` (`client.test.ts:1459`; `till-station-screen.test.ts:304`, `:1243`, `:1391`, `:1398`).
- The same command → `Test Files 5 failed | 10 passed (15)`, `Tests 62 failed | 727 passed (789)`
  (`run1.txt`).
- `pnpm exec vitest run src/till-app` → `Test Files 40 passed (40)`, `Tests 4393 passed (4393)`
  (`run2.txt`). This run began before the probe deleted `TillApi.advanceTicket`; that deletion was
  checked by `tsc3.txt` and by
  `pnpm exec vitest run src/api/client.test.ts src/widgets/department-transfers src/i18n` →
  `Tests 1 failed | 613 passed (614)`, the one `client.test.ts:1455` below (`run3.txt`).
  `department-transfers` and `till-expo-screen` passed with `station.state.queued` reading
  "Waiting": no test pins "New" or «Nuevo» (also ran
  `grep -rn 'Nuevo' apps/till/src --include='*.test.ts'` → only a product renamed "Nuevo nombre"
  in `till-table-order-screen.test.ts:6515`, `:6540`, and `grep -rn '"New"' apps/till/src
  --include='*.test.ts'` → nothing).

**The 62, each a check this spec changes** (file, test name, reason, and the task that changes it):

`apps/till/src/widgets/station-queue.test.ts` (28):
- "kanban is the default view: three state columns, each holding its state's lines" — the columns
  now hold cards, not lines; rewritten as "draws three columns of cards, each in its least advanced
  dish's column" (D1, D2). [3a-i]
- "kanban omits the other-stations section" — the card shows the bill's other dishes (D11). [3a-ii]
- "kanban: no per-order collect button (…)" and "kanban: no per-order reprint button even with
  showReprint (…)" — the board's cards carry them (D11); each becomes its opposite. [3a-ii]
- "kanban: the age accent is also applied to each cell (…)" — no cells; the age accent is the card's (D7). [3a-i]
- "the header shows a legible overdue+forgotten count badge — a non-colour tell, not just borders",
  "the header shows no badge at all when nothing has escalated to overdue", "the header counts BOTH
  overdue and forgotten groups (band rank ≥ overdue)" — the header line replaces the badge (D9). [4]
- "flashes a forgotten ticket at the fast pulse token, 1 s by default (kanban)" — one board, the
  pulse on the card's band (D7); the `(rail)` case of the same `it.each` passed and is the one kept. [3a-i reads the card; 4 the band]
- "ticket mode: tapping a line emits advance-ticket { orderId, stationId, to } (whole-ticket)" —
  `advance-dishes` for the card's dishes at that stage (D8). [5b]
- "a whole-ticket bump carries the group's own station, not the widget's" and "a merged queue bumps
  each order by its own station's mode" — the same, through `advance-dishes` (D8). [5b]
- "rail: the ticket-mode card shows the mark once and the line-mode card none" and "kanban: each
  bumpable cell of the ticket-mode order shows the mark, no other cell" — one mark per card (D8). [the "kanban: …" case 3a-i; the "rail: …" case 3a-ii]
- "the numbers an order's dishes were sent to the kitchen under": "follow the number on the ticket
  head and on each kanban cell" (three cases: en-GB [28], es-ES [28], en-GB [28,30]), "leave a plain
  number on an order that never moved", "leave a kanban cell's dish name uncut at 1024 px wide"
  (two cases) — the number is in the card's heading only, not beside each dish (D5). [3a-i]
- "keeps permanent heading numbers when firing positions change", "rail: sections a party's card by
  group position, the lines with no group first, and no course headers", "rail: a held group says
  it is held, not released, and its lines are greyed and not bump targets" — a party's group
  sections are now its cards (D1), ordered as D2 says, named with their course (D5), a held one
  drawn per D3. [3a-ii; the course in 3b]
- "kanban: names each order whose ticket has not printed above the columns", "kanban: an order
  with no label is named by its number alone" — the strip goes; each card says it (D11). [3a-ii]
- "marks under each of a seated party's sent groups", "board: labels a marked dish's cell, and not
  an unmarked one's", "board: words the mark in Spanish" — the after-period mark now sits within a
  group's card, above the dish, as the rail drew it (D12). [the party case 3a-ii; the two "board:" cases 3a-i]

`apps/till/src/widgets/station-queue.allergy.test.ts` (3): "shows frozen instructions only on the
assigned kanban dish in en", "… in es", "marks only the assigned card in a merged kanban queue" —
they look for the order tag beside each Board dish (D5); the allergy block under its dish is
unchanged and stays checked. [3a-i]

`apps/till/src/screens/till-station-screen.test.ts` (21):
- "kanban is the default view; the toggle flips the widget to rail and back", "suppresses its own
  header + Back when embedded, keeping the view toggle", "with one station still available, offers
  its view toggle and no guidance", "offers the switch with two stations, beside the view toggle,
  and opens stacked", "as the only station, keeps its toggles and its dish until the queue is
  empty, then guides" — no toggle (D13); the merge switch and the rest of each check stay. [6]
- "operator mode shows the per-order Reprint button in the rail (…)", "clicking Reprint calls
  reprintOrder(orderId) and does not escape the screen", "a rejected Reprint surfaces the localised
  banner, never the raw code", "a codeless Reprint rejection (a fetch network throw) falls back to
  the generic banner", "device mode hides the Reprint button (…)", "device mode hides the Collect
  button on a settled order (…)", "device mode hides the kitchen-fire button on a held course (…)"
  — each clicked the toggle first; Reprint and Collect are on the board's cards (D11, D13); every
  other check in them stays. [6]
- "an advance-ticket from the widget calls advanceTicket then reloads the active queue", "a failed
  whole-ticket advance still reloads the queue (reconciling)", "a whole-ticket bump expands to a
  deviceAdvance for each advanceable item at the station", "a whole-ticket bump refused
  device.unauthorized asks at once to switch, naming the station screen", "a whole-ticket bump in a
  section advances that station's lines of an order both stations hold", "a merged device screen
  bumps a whole order at one station and a single dish at another", "a station's changed bump mode
  reaches an open device screen at its next refresh", and the describe "till-station-screen
  device-mode whole-ticket bump selection" ("advances only the fired lines whose next step is the
  target, skipping held and later lines", "advances nothing for an order no longer on the loaded
  queue, and still reloads") — `advance-dishes` names the dishes, so the screen no longer chooses
  them from the order (D8); what each pins about the calls it makes, the reload and the refusals
  moves to the `advance-dishes` handler's cases (Task 5a), and the selection rule to the widget's
  (Tasks 2, 5b). [5b]

`apps/till/src/screens/till-station-screen.a11y.test.ts` (6): "has no violations on the TICKET RAIL
(toggle switches the widget, age-coloured cards)" and "has no violations on the rail with held food
and no station Fire button", each in both themes, and "has no violations on the merged rail with
its station labels and the lines above it" in both themes — each clicked the toggle (D13); the
held-food and merged sweeps are kept on the board. [6]

`apps/till/src/screens/text-size.layout.test.ts` (4): "on a kitchen station's queue at
{1280x800, 1024x768} and {100, 130}%, every dish lies inside its card" — it counted one `.cell` per
dish; now each dish's name must lie inside its card (D1). [3a-i]

**Also changed, though they pass under the probe** (each needs its `view` removed, and keeping
both cases of a pair would test one drawing twice; D13). One case of each pair is deleted, the
other kept without `view`, all in Task 6 except where marked:
- `station-queue.test.ts`: the `it.each` / `for` over the two views at `:736` ("an advanceable
  line's accessible name"), `:1125` (the forgotten flash: keep one), `:2213` (merged station
  labels), `:2357`, `:2400` (the whole-ticket mark), `:2526`, `:2535`, `:2555`, `:2580` (Move),
  `:2666` (move attribution); and the pairs of single cases named "rail: …" and "kanban: …" for
  modifiers (`:483`, `:498`), the note (`:582`, `:593`) and as-served allergens (`:690`, `:700`).
- `station-queue.a11y.test.ts`: "the kanban board (…)" and "the ticket rail (…)" (`:396`, `:405`)
  become one board sweep; the `it.each` at `:414`, `:462`, `:583`, `:612`; "the kanban
  printing-problem strip has no violations" (`:557`) is deleted with the strip (D11) [3a-ii].
- `station-queue.allergy.test.ts` `:20`, `:96`; `station-queue.kitchen-note.test.ts` `:57`, `:85`;
  `till-station-screen.a11y.test.ts` `:568`; `kitchen-allergy.look.test.ts` `:23` (its `rail` and
  `kanban` surfaces become one `board`).
- `api/client.test.ts:1455` "advanceTicket POSTs { to } to the whole-ticket advance route (…)" —
  deleted with the method (D8). [5b]

**Fixture-only (no check changes):** `queuedAt` on every station-queue item literal (the 63 sites
above), equal to its order's `queuedAt` [1]; the probe's typecheck flagged no `till-app*.test.ts`
fixture, so those stay as they are, and Task 1's typecheck is the judge; `view: "rail"` / `view` removed from mounts whose checks hold on
the board (the rest of the 112) [6].

Any other failure, in any suite a task names, is a STOP.

### Review focus (inputs the spec implies and today's tests may not pin)

1. **A party with two groups at one station**, the second fired 40 minutes after the first: two
   cards, each with its own minutes and band; the second is fresh (D1, D4; Tasks 2, 3a-i, 4).
2. **A card with dishes at different stages** (one Waiting, one Preparing): it sits in Waiting; the
   Preparing dish says so; a heading tap moves only the Waiting dish; a whole-ticket dish tap on the
   Preparing dish moves only Preparing dishes on that card (D2, D8, D12; Tasks 2, 3b, 5b).
3. **A held group, and a group with one dish fired by hand** (`fireHeldLine`, A773): the held card
   is dashed, untimed, with no heading tap; the mixed card ages by its fired dish and its held dish
   says "Held, not released" (D3, D12; Tasks 3a-i, 3b).
4. **Ticket mode on a party bill**: a dish tap moves that card only, never the order's other
   group's card (D8; Task 5b).
5. **A refusal half-way through a heading tap** (another screen moved a dish): the loop stops, the
   reload shows the truth, no message unless the disk is full (D8; Task 5a).
6. **A kitchen display**: no Collect, no Reprint, heading taps through `deviceAdvance` (D8, D11;
   Tasks 5a, 6).
7. **Merged screen**: one header line for all stations; each station's part of an order its own
   card, oldest first (D1, D2, D9; Tasks 4, 6).
8. **A weighed dish** ("0.35 kg × Pulpo") counts as one dish to make; "1.5× Croqueta" as 1.5; a
   held or Ready dish none (D9; Task 2).
9. **Reduced motion, dark theme, Spanish, 1280 and 1024 px, and a narrow till (Station screen at
   390 px)**: nothing pulses, the band stays, contrast holds, «Esperando», «platos por hacer»
   (Tasks 4, 9).
10. **The pass and department transfers say Waiting** where they said New (D10; Task 7).
11. **One group sent across two bills of a party** (Bill 1 and Bill 2, A803's several bills): one
    card, both bills' numbers, each bill's note, printing problem and Reprint; a heading tap moves
    both bills' dishes (D1, D11; Tasks 2, 3a-i, 3a-ii, 5b).

---

**Task order and why.** The type and fixtures first (Task 1), so later tasks read each dish's own
time; the pure card model (Task 2); the Board's cells become cards (3a-i), the card takes over the
ticket's parts and the Tickets drawing goes (3a-ii), then the course and each dish's words (3b); the band
and the header line (4); the screen learns `advance-dishes` (5a) before the widget sends it (5b);
the Tickets view goes (6); the word Waiting (7); the docs (8); the LOOK (9). Each leaves the tree
green and is sized well under 100 tool calls.

### Task 1: Each queue dish carries its own queued time (fixtures only)

**Files:**
- Modify: `apps/till/src/api/client.ts` (`StationQueueItem`, after `firedAt` `:1567-1569`:
  `/** When this dish joined the queue: set at fire, and again when a release re-routes it. */
  queuedAt: string;`; and `StationQueueGroup.queuedAt`'s comment `:1644-1646`: "the order's
  oldest line at this station; the merged screen's ordering key" — no longer "the age-colouring
  anchor")
- Modify (fixture-only): the 63 item literals the probe's typecheck named (D4) — each gains
  `queuedAt` equal to its order's `queuedAt` (where a builder spreads a shared item, set it once
  in the builder)

- [ ] **Step 1:** Make the type change, then `pnpm --filter @waitron/till typecheck` and fix each
  error by adding `queuedAt` (never a cast). Expect the 63 sites in 9 files the changed-checks list
  names; a different count is fine if every new site is an item literal, and anything else is a STOP.
- [ ] **Step 2: Run; expect PASS, unchanged counts** (memory first: `memory_pressure | grep free`):
  `pnpm --filter @waitron/till exec vitest run src/widgets/station-queue src/screens/till-station-screen src/screens/kitchen-allergy src/screens/text-size.layout src/screens/till-expo-screen`
  → `Tests 789 passed (789)`, the probe's base for these five paths (`base1.txt`; the expo suite is
  in it because its allergy case reads the edited `test/kitchen-allergy-fixtures.ts`), then
  `pnpm --filter @waitron/till exec vitest run src/api/client.test.ts` (read its `Tests` count before
  and after: unchanged).
- [ ] **Step 3:** eslint the changed files; `pnpm format:check`; ledger (fixture-only list, no
  changed check); `git commit -s -m "A797-8: each kitchen-queue dish carries its own queued time"`

### Task 2: The card model, in one pure module

**Files:**
- Create: `apps/till/src/state/kitchen-cards.ts`
- Test: `apps/till/src/state/kitchen-cards.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface KitchenCard {
    /** `${stationId ?? ""}|g:${groupId}`, or `${stationId ?? ""}|o:${orderId}` for dishes with no group: unique on one screen. */
    key: string;
    /** Its bills, in the read's order: one, or more when a group spans a party's bills (D1). */
    orders: MergedQueueGroup[];
    /** The group the dishes were sent in; null for a counter order, a bill with no party, or dishes moved in. */
    group: QueueGroup | null;
    /** In the read's order. */
    items: StationQueueItem[];
    /** Its least advanced dish's state, held dishes counting as `queued` (D2). */
    column: TicketState;
    /** The earliest `queuedAt` of its fired dishes, epoch ms; null when none is fired (D4). */
    since: number | null;
  }
  /** One card per station and group across its bills, or per station and bill for dishes with no group; oldest first (D1, D2). */
  export function kitchenCards(orders: readonly MergedQueueGroup[]): KitchenCard[];
  /** The state a heading tap moves: its least advanced fired dish not Ready; undefined when none (D8). */
  export function headingStage(card: KitchenCard): TicketState | undefined;
  /** The ids a tap at `stage` moves: the card's fired dishes in that state (D8). */
  export function dishesAt(card: KitchenCard, stage: TicketState): string[];
  /** Fired dishes Waiting or Preparing, in thousandths of a dish; a dish whose unit shows counts 1000 (D9). */
  export function thousandthsToMake(cards: readonly KitchenCard[]): number;
  /** Cards with a fired dish not Ready whose band at `now` is overdue or forgotten (D9). */
  export function lateCards(cards: readonly KitchenCard[], now: number): number;
  ```
  `MergedQueueGroup` moves from `widgets/station-queue.ts:71` into this file and is re-exported
  there, so `till-station-screen.ts:27` keeps its import. Consumed by Tasks 3a-i–5b.

- [ ] **Step 1: Failing tests** (builders as in `station-queue.test.ts`, each item with its own
  `queuedAt`):
  1. "makes one card per sent group, and one for an order with no party" — a party order with
     groups g-2, g-3 and a moved dish with none, and a counter order → keys for `none`, g-2, g-3
     and the counter order; each card's items in the read's order.
  2. "keeps each station's part of an order on its own card" — one order at two stations in a
     merged list → two cards.
  2b. "merges one group's dishes from two bills into one card" — Bill 1 and Bill 2 of one party,
     each with a dish in g-2 → one card, `orders` [Bill 1, Bill 2], both dishes; a no-group dish on
     each bill → one card per bill (Review focus 11).
  3. "puts a card in its least advanced dish's column, held dishes counting as Waiting" — queued +
     preparing → `queued`; preparing + ready → `preparing`; all ready → `ready`; held + ready →
     `queued`.
  4. "ages a card from its own oldest fired dish, never a held one" — fired at 20:40 and 21:15 on
     two groups of one order → `since` 20:40 and 21:15; a held-only card → `null`.
  5. "orders cards oldest first, untimed last, ties by the read then group position" — Review
     focus 1's two groups behind a newer counter order: counter order between them.
  6. "names the stage a heading tap moves, and the dishes it moves" — queued + preparing →
     `queued`, `dishesAt` the queued fired ids only; all ready → `undefined`; held + preparing →
     `preparing`.
  7. "counts dishes to make: quantities, a shown unit as one, nothing held or Ready" — `"2.000"`
     no unit, `"1.500"` sold in each, `"0.350"` kg, a held `"3.000"`, a ready `"1.000"` → 4500.
  8. "counts late cards with something to make" — an overdue card with a queued dish, a forgotten
     card all Ready, a held card → 1.
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/till exec vitest run src/state/kitchen-cards.test.ts`.
- [ ] **Step 3: Implement.** Use `classifyBand` and `BAND_RANK` from `@waitron/shared` as the widget
  does (`station-queue.ts:13`); a stable sort; `Date.parse` of each fired dish's `queuedAt`.
- [ ] **Step 4: Run; expect PASS** (read the `Tests` count).
- [ ] **Step 5:** typecheck till; eslint both files and `station-queue.ts`; `pnpm format:check`;
  ledger; `git commit -s -m "A797-8: one kitchen card per group, in a pure module"`

### Task 3a-i: The Board's dish cells become group cards

The Board (the widget's default view) draws cards; the Tickets view (`view="rail"`) is left drawing
as today until Task 3a-ii, so every rail check stays green here.

**Files:**
- Modify: `apps/till/src/widgets/station-queue.ts` (`#kanban` becomes `#board`: it maps `COLUMNS` to
  sections holding `kitchenCards(this.groups)` by `column`; `#card` draws what the Board drew
  per dish, now once per card: the heading (D5's identity: numbers, allergy marker, labels, group
  name, held note, minutes), the whole-ticket mark once (D8), the kitchen note, then the dishes
  with their after-period marks; the article is keyed `data-card`, with `data-order` (its first
  bill's number) and `data-card-group` (`group?.id ?? "none"`); a held card per D3 (class `held`,
  dashed); the age accent moves from `.cell` to the card; delete `#kanbanCell`, `#cell` and `.cell`
  styles. `#rail`, `#printProblems` and `view` are untouched)
- Test: `apps/till/src/widgets/station-queue.test.ts`, `station-queue.allergy.test.ts`,
  `apps/till/src/screens/text-size.layout.test.ts`

- [ ] **Step 1: Change the checks** tagged `[3a-i]` in the changed-checks list (D1, D2, D3, D5,
  D7's accent move, D8's mark), with these new cases in `station-queue.test.ts`, a `describe` "the
  board's cards":
  1. "draws three columns of cards, each in its least advanced dish's column" (replacing "kanban
     is the default view…").
  2. "gives a party one card per sent group and the dishes with no group their own, oldest first"
     (Review focus 1).
  3. "draws one card for a group sent across two bills, with both bills' numbers" (Review focus 11,
     D1).
  4. "draws a held group's card dashed in Waiting, with no minutes and no heading tap" (D3).
  5. "keeps a long dish name whole inside its card at 1024 px" (replacing the two "uncut" cases).
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/till exec vitest run src/widgets/station-queue src/screens/text-size.layout`.
- [ ] **Step 3: Implement.** A card draws its dishes as the rail did for its kind (course sections
  for a card with no group; a plain list for a group card); course in the heading and the dish's
  state word wait for Task 3b.
- [ ] **Step 4: Run; expect PASS**, then
  `pnpm --filter @waitron/till exec vitest run src/screens/till-station-screen src/screens/kitchen-allergy src/screens/till-expo-screen src/widgets/station-queue.a11y.test.ts`:
  expect PASS (the screen still offers the toggle, and the widget still sends `advance-ticket`
  until Task 5b). A failure is a STOP unless it reads a Board cell (then it is D1 or D5: change it
  here and list it).
- [ ] **Step 5:** typecheck till; eslint; `pnpm format:check`; ledger (each changed check, with its
  D-number); `git commit -s -m "A797-8: the kitchen Board draws one card per group"`

### Task 3a-ii: The card is the ticket: the bill's facts and actions move onto it

**Files:**
- Modify: `apps/till/src/widgets/station-queue.ts` (`#card` gains, per bill, the printing problem,
  "Also on this order", Collect and Reprint (D11; on a merged-bills card each names its bill's
  number); `#queue` draws `#board()` whatever `view` says; delete `#rail`, `#groupSections`,
  `#groupSection`, `#printProblems` and their styles (`.rail`, `.print-problems`); `view` stays,
  unread, until Task 6)
- Test: `apps/till/src/widgets/station-queue.test.ts`, `station-queue.a11y.test.ts`

- [ ] **Step 1: Change the checks** tagged `[3a-ii]` in the changed-checks list (D1, D11: other
  stations' dishes, Collect, Reprint, the strip, a party's sections, the rail's whole-ticket mark,
  the party after-period marks; the a11y strip case deleted), with these new cases in "the board's
  cards":
  1. "shows the bill's note, printing problem, other stations' dishes, Collect and Reprint on each
     of its cards" (D11); with `advanceOnly`, no Collect; without `showReprint`, no Reprint.
  2. "on a group's card spanning two bills, names each bill's note, printing problem and Reprint"
     (D1, D11): two Reprint buttons, named "Reprint #12" and "Reprint #13", each emitting its own
     `orderId`.
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/till exec vitest run src/widgets/station-queue`.
- [ ] **Step 3: Implement** D11 and the deletions.
- [ ] **Step 4: Run; expect PASS**, then the Task 3a-i Step 4 command. The screen cases that click
  the toggle and then look for Reprint or Collect now find them on the board (the widget ignores
  `view`): they pass unchanged here and change only in Task 6. A failure is a STOP unless it reads
  the Tickets view's group sections (then it is D1: change it here and list it).
- [ ] **Step 5:** typecheck till; eslint; `pnpm format:check`; ledger;
  `git commit -s -m "A797-8: a kitchen card carries its bill's note, problems and actions"`

### Task 3b: A card's courses and each dish's words

**Files:**
- Modify: `apps/till/src/widgets/station-queue.ts` (`#card`'s heading names the course when every
  dish shares one, else `#courseSections` inside, D5; `#line` draws the state word only for a dish
  ahead of its card's column, and "Held, not released" for a held dish on a card not itself held,
  D12; after-period marks within the card, `#sectionLines`)
- Test: `apps/till/src/widgets/station-queue.test.ts`

- [ ] **Step 1: Failing tests** (and the changed "marks under each of a seated party's sent
  groups", "board: labels a marked dish's cell…", "board: words the mark in Spanish", D12):
  1. "names the group's course in its heading when its dishes share one" — the heading holds
     "Group 2" and the case's own English course name, "Mains" (course names are the venue's
     content, never a translated string). General code is English only (CLAUDE.md §3): the
     existing fixture's "Principales" (`station-queue.test.ts:1850`) is an old leak this slice
     does not spread — a new case builds its own course name in English, and the old leak is
     noted for A913 in lane C's questions file, not fixed here.
  2. "puts course heads inside a card whose dishes span two courses, null course first".
  3. "a dish ahead of its card's column says its state; one at the column says none" — Review
     focus 2: the Preparing dish reads "Preparing", the Waiting one has no `.line-state`.
  4. "a held dish on a fired card says it is held, and is not a button" — Review focus 3.
  5. "a Ready dish on a Preparing card reads Ready, in Spanish Listo" (restore the language after).
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/till exec vitest run src/widgets/station-queue.test.ts`.
- [ ] **Step 3: Implement** D5's course rule and D12.
- [ ] **Step 4: Run; expect PASS**, then the Task 3a-i Step 4 command.
- [ ] **Step 5:** typecheck till; eslint; `pnpm format:check`; ledger;
  `git commit -s -m "A797-8: a kitchen card names its course, and each dish its own state"`

### Task 4: The age band, the forgotten pulse and the header line

**Files:**
- Modify: `apps/till/src/widgets/station-queue.ts` (styles `:401-457` → D7's top band and outline,
  keyframe to `--wt-color-danger-pulse-dim`; `#header` → D9 through `thousandthsToMake` and
  `lateCards`, class `kitchen-counts`, `data-kitchen-counts`; `.overdue-count` style deleted from
  this widget), `apps/till/src/i18n/strings.ts` (D10's three new keys, en after `:659`, es after
  `:2411`), `packages/ui-core/src/tokens/colors.css` (`:120-121`: "…the till bar's Waiting tab,
  the Ready bar's warning and a forgotten kitchen card's band dim to half-way"),
  `packages/ui-core/src/tokens/structure.css` (`:50`: "fast for Forgotten, on the floor and a
  kitchen card"), `apps/till/src/screens/till-expo-screen.ts` (comments `:188`, `:205`, `:224`
  only: "the kitchen screen's cards" for "till-station-queue's rail card" and its `.cell`)
- Test: `apps/till/src/widgets/station-queue.test.ts`, `station-queue.a11y.test.ts`

- [ ] **Step 1: Failing tests** (and the changed header and age checks, D7, D9). Cases 1–3 first
  call `await commands.emulateReducedMotion(false)` as `till-floor-screen.ready-bar.test.ts` does
  (typed as there; reset in `finally`):
  1. "a card's band is green, then amber, then red as it ages" — fresh, warm, overdue cards: the
     band's `border-top-color` equals `--wt-color-success`, `--wt-color-warning`,
     `--wt-color-danger` (set each to a distinct `rgb(…)` on the widget); overdue's left border
     also danger; a held card's band is the plain border colour.
  2. "a forgotten card's band pulses to the dim red at the fast pulse token" — `animationName`
     `age-forgotten-flash`, `1s`; paused at `currentTime` 500 the band reads
     `--wt-color-danger-pulse-dim`; with `--wt-duration-pulse-fast: 3000ms`, `3s` (the kept case of
     `:1125`).
  3. "under reduced motion a forgotten card holds still and stays red" — `reducedMotion: true`, and
     separately `emulateReducedMotion(true)` with nothing injected: `animationName` `none`, band
     `--wt-color-danger`.
  4. "the header says how many dishes are to make and how many cards are late" — Review focus 8's
     dishes plus one overdue card → "5.5 dishes to make · 1 late" and, under `setLocale("es")`,
     «5.5 platos por hacer · 1 con retraso» (restore the language after); one dish → "1 dish to
     make"; no late card → no "late"; nothing to make and nothing late → no line.
  5. "a merged queue has one header line for every station" — two stations' orders → one
     `[data-kitchen-counts]`, the sum.
  6. a11y, in `station-queue.a11y.test.ts`'s both-theme `describe`: "a board with a fresh, warm,
     overdue, forgotten and held card and the header line has no violations" (`reducedMotion:
     true`, a fixed `now`).
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/till exec vitest run src/widgets/station-queue.test.ts src/widgets/station-queue.a11y.test.ts`.
- [ ] **Step 3: Implement** with `--wt-*` tokens only (CLAUDE.md §3; no hex, `rem` or `em`) and
  D10's strings in both blocks.
- [ ] **Step 4: Run; expect PASS**, then the Task 3a-i Step 4 command,
  `pnpm exec vitest run scripts/style-token-names.test.ts scripts/primary-coloured-text.test.ts scripts/english-only.test.ts`,
  `pnpm --filter @waitron/ui-core exec vitest run src/tokens` and
  `pnpm --filter @waitron/till exec vitest run src/i18n` (the catalogues' own suites).
- [ ] **Step 5:** typecheck till; eslint the changed `.ts` files; `pnpm format:check`; ledger;
  `git commit -s -m "A797-8: a kitchen card's age band, and the dishes-to-make line"`

### Task 5a: The station screen moves the dishes a card names

**Files:**
- Modify: `apps/till/src/screens/till-station-screen.ts` (a new `#onAdvanceDishes` for
  `advance-dishes` `{ itemIds, stationId, to }`, bound beside `:981`: `event.stopPropagation()`,
  then `#advance` with a loop that awaits `deviceMode ? api.deviceAdvance(id, to) :
  api.advanceTicketItem(id, stationId, to)` for each id in turn)
- Test: `apps/till/src/screens/till-station-screen.test.ts` (a `describe` "moving the dishes a card
  names", dispatching `advance-dishes` from the widget element as `:265` dispatches
  `advance-ticket-item`)

The old `advance-ticket` path stays in this task, so the widget, which still sends it, keeps
working; Task 5b removes it.

- [ ] **Step 1: Failing tests:**
  1. "on a till, advances each named dish in turn, then reloads the queue" — three ids: three
     `advanceTicketItem(id, "st-1", "preparing")` calls in order, the second only after the first
     resolves (hold the first's promise), then one `getStationQueue`.
  2. "on a kitchen display, through deviceAdvance, then reloads the display" — never
     `advanceTicketItem`; one `getDeviceStationScreen` after.
  3. "stops at the first refusal and still reloads, with no line" — the second refused
     `ticket.invalid_transition`: no third call, a reload, no `[role=alert]` (Review focus 5).
  4. "a refusal on a full disk says so" — `storage.disk_full`: the full-disk line.
  5. "a kitchen display whose screen was taken asks to switch" — `device.unauthorized`:
     `kitchen-screen-changed` with `{ from: "station" }`, no reload (as the existing
     "a whole-ticket bump refused device.unauthorized…" checks).
  6. "the event stops at the screen" — the app's listener above it never sees `advance-dishes`.
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/till exec vitest run src/screens/till-station-screen.test.ts -t "moving the dishes a card names"`.
- [ ] **Step 3: Implement.** Never `Promise.all` (CLAUDE.md §3 forbids it for one transaction's
  queries; here it keeps the order the cook sees and the first refusal's stop).
- [ ] **Step 4: Run; expect PASS**, then the whole file and `src/screens/till-station-screen.a11y.test.ts`.
- [ ] **Step 5:** typecheck till; eslint; `pnpm format:check`; ledger;
  `git commit -s -m "A797-8: the station screen moves the dishes a card names"`

### Task 5b: The heading moves the card; a whole-ticket tap moves the card's dishes

**Files:**
- Modify: `apps/till/src/widgets/station-queue.ts` (the heading a `<button data-card-head>` while
  `headingStage(card)` is defined, its hidden "Advance ticket #N"; `#bump` in ticket mode sends
  `advance-dishes` with `dishesAt(card, item.state)`; the heading sends `dishesAt(card,
  headingStage(card))`; `#wholeTicket` once per card while something can move; styles for the
  heading button: `min-height: var(--wt-tap-min)`, no fill, the text colour, a focus ring as
  `.line`'s), `apps/till/src/screens/till-station-screen.ts` (delete `ADVANCE_FROM` `:41-49`,
  `#onAdvanceTicket`, `#deviceAdvanceTicket` `:608-638`, `@advance-ticket` `:982`),
  `apps/till/src/api/client.ts` (delete `advanceTicket` `:3338-3354`); the nine
  `advanceTicket: vi.fn()…` stubs in test fakes go with it (`till-app.test.ts:503`,
  `till-station-screen.a11y.test.ts:135`, `till-station-screen.test.ts:135`, `:723`, `:812`, `:1366`,
  `:1475`, `:1794`, `:2836`; ran `grep -rn "advanceTicket:" apps/till/src apps/till/test`), fixture-only
  except `:723`, whose test changes with D8
- Test: `apps/till/src/widgets/station-queue.test.ts`, `station-queue.a11y.test.ts`,
  `apps/till/src/screens/till-station-screen.test.ts`, `till-station-screen.a11y.test.ts`,
  `apps/till/src/api/client.test.ts`

- [ ] **Step 1: Failing tests** (and every changed check the list gives for D8):
  1. "a heading tap sends the card's least advanced dishes on, never one further on" — Review
     focus 2: `advance-dishes` `{ itemIds: ["ti-waiting"], stationId, to: "preparing" }`.
  2. "a whole-ticket dish tap sends that card's dishes at the tapped dish's stage" — tapping the
     Preparing dish → only the Preparing ids, `to: "ready"`.
  3. "a whole-ticket tap on a party's card leaves its other group's card alone" — Review focus 4.
  4. "a heading is a button only while a tap can move something" — all Ready, all held: no
     `button[data-card-head]`.
  5. "a heading's name starts with its words and ends with Advance ticket" — as the existing
     "an advanceable line's accessible name" case reads names.
  6. "a merged heading tap names its own station" — the order's `stationId`, not the widget's.
  7. Screen, "a heading tap on a kitchen display advances each of its dishes through
     deviceAdvance" — the widget's real click → `deviceAdvance` per id, then the reload (replaces
     "a whole-ticket bump expands to a deviceAdvance…").
  8. Screen, "a station's changed bump mode reaches an open device screen at its next refresh"
     (changed): after the refresh a dish tap sends `advance-dishes`, observed as two
     `deviceAdvance` calls.
  9. a11y: the "whole-ticket bump mode has no violations" sweep now includes a heading button.
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/till exec vitest run src/widgets/station-queue.test.ts src/screens/till-station-screen.test.ts`.
- [ ] **Step 3: Implement** D8; delete the old path; `pnpm --filter @waitron/till typecheck` must
  flag only the deleted method's uses in tests, each changed or deleted per the list.
- [ ] **Step 4: Run; expect PASS**: `pnpm --filter @waitron/till exec vitest run src/widgets/station-queue src/screens/till-station-screen src/api/client.test.ts`,
  then `pnpm --filter @waitron/till exec vitest run src/till-app` (memory first; the probe's
  result is under "Changed test checks"; a new failure is a STOP).
- [ ] **Step 5:** typecheck till; eslint; `pnpm format:check`; ledger (the deleted
  `client.test.ts` case and every changed screen case, D8);
  `git commit -s -m "A797-8: a card's heading moves the card on; whole-ticket taps move its dishes"`
- [ ] **Stop and hand over** if the task passes about 150 tool calls unfinished (global rule): stop
  at a green point (the widget's new taps and their tests, with the old screen path still in place,
  is one), or a cleanly red one, commit it with `git commit -s`, and return a handover — done, left,
  files, each check's state — for a fresh implementer.

### Task 6: The Tickets view and its switch go

**Files:**
- Modify: `apps/till/src/widgets/station-queue.ts` (delete `view` `:640` and any comment naming
  the rail or the kanban; the class comment `:82-90` says "one card per group in three state
  columns"), `apps/till/src/screens/till-station-screen.ts` (delete `view` `:239`, `#toggleView`
  `:556-558`, the toggle `:1008-1019`, the `showViews` option `:973` and its use `:873`, the two
  `.view=` bindings; the comments at `:134-135` and `:217` lose "the view toggle"),
  `apps/till/src/i18n/strings.ts` (delete `station.view_kanban`, `station.view_rail`, en
  `:652-653`, es `:2405-2406`, and the comment at `:632` naming "the view toggles")
- Test: every file the changed-checks list names for D13, and the fixture-only `view` removals

- [ ] **Step 1: Change the checks** the list gives for D13 (toggle cases; Reprint and Collect
  cases that clicked the toggle now find the buttons on the board; the view pairs collapse to one
  case each) and remove `view` from every other mount. New case in `till-station-screen.test.ts`:
  "offers no Board or Tickets switch, on a till or a kitchen display" — no `[data-view-toggle]`,
  and the merge switch still there with two stations.
- [ ] **Step 2: Run; expect FAIL** on the new case only:
  `pnpm --filter @waitron/till exec vitest run src/screens/till-station-screen.test.ts -t "no Board or Tickets switch"`.
- [ ] **Step 3: Implement** D13. Then `grep -rn "view_rail\|view_kanban\|\"rail\"\|data-view-toggle" apps/till/src --include='*.ts'`:
  only the floor's own List/Map toggle (`till-floor-screen*`, `test-helpers.ts:709`,
  `till-shell.device-zones.look.test.ts:117`) may remain.
- [ ] **Step 4: Run; expect PASS**: `pnpm --filter @waitron/till exec vitest run src/widgets/station-queue src/screens/till-station-screen src/screens/kitchen-allergy src/screens/text-size.layout`,
  and `pnpm --filter @waitron/till typecheck` (exit 0).
- [ ] **Step 5:** eslint; `pnpm format:check`; ledger (each collapsed pair and deleted case by
  name, D13); `git commit -s -m "A797-8: the kitchen screen's Tickets view and its switch go"`
- [ ] **Stop and hand over** if the task passes about 150 tool calls unfinished: a natural point is
  the source change with `station-queue.test.ts`'s pairs collapsed and the other files still to do
  (their `view` mounts fail typecheck, so either commit once `pnpm --filter @waitron/till
  typecheck` passes, or commit cleanly red and say which files are left); commit with
  `git commit -s` and return a handover — done, left, files, each check's state.

### Task 7: The first column is Waiting

**Files:**
- Modify: `apps/till/src/i18n/strings.ts` (`station.state.queued` "Waiting" `:677`, «Esperando»
  `:2429`, D10)
- Test: `apps/till/src/widgets/station-queue.test.ts` (one case), and the readers' suites

- [ ] **Step 1: Failing test:** "names the first column Waiting, in Spanish Esperando" — the
  `[data-column="queued"]` title reads "Waiting", and «Esperando» under `setLocale("es")`
  (restore the language after, CLAUDE.md §4).
- [ ] **Step 2: Run; expect FAIL**, then change the two values.
- [ ] **Step 3: Run; expect PASS**, then the other readers' suites:
  `pnpm --filter @waitron/till exec vitest run src/screens/till-expo-screen src/widgets/department-transfers src/widgets/station-queue`.
  The probe changed this value and no expo or station test failed on the word (`run1.txt`); a
  failure that pins "New" or «Nuevo» is a check this spec changes (D10): change it and list it.
- [ ] **Step 4:** eslint; `pnpm format:check`; ledger;
  `git commit -s -m "A797-8: the kitchen's first column is Waiting"`

### Task 8: Docs, the user guides and the backlog follow the code

**Files:**
- Modify: `apps/server/src/guide/en/kitchen-service.md` (a new section before
  `## A dish sent after its period ended {#after-period}`: `## Work the kitchen screen
  {#kitchen-screen}`; the whole-ticket sentence `:104-105`; the after-period sentence `:135-136`),
  `apps/server/src/guide/es/kitchen-service.md` (the same section, `{#kitchen-screen}`; `:119-121`;
  `:152-154`), `docs/developers/design-system.md` (`:614-617`; `### The kitchen screen's late-send
  mark` `:5454-5463`; a new `### The kitchen screen's cards` after it), `docs/backlog.md` (the
  A797 entry `:120-140`), `docs/backlog/till.md` (A797's entry from `:1036`),
  this plan's slice 9b outline (one sentence: the one-row header of picture 03 — the station's name,
  its Open/Closed chip and the header line — comes with the corner's Columns, D9), and its slice 8b
  outline (one sentence: the read also says whether a bill is a counter order, so a counter card
  reads "Counter #12", D5),
  `docs/superpowers/specs/2026-10-18-a797-device-screens-design.md` (§3.3 a dated pointer; §9's
  bump-mode point a dated answer)
- Test: `apps/server/src/guide-content.test.ts`, `scripts/guide-links.test.ts`

- [ ] **Step 1: Guides.** English, the new section in about six sentences: each card is a group
  of a table's dishes, or a counter order; it sits in the column of its least advanced dish
  (**Waiting**, **Preparing**, **Ready**); tap a dish to move it on, or the card's heading to move
  the card on (only the dishes holding it back move); the band along its top turns from green to
  amber to red as it waits, and a forgotten card's band pulses (it holds still on a device set to
  reduce motion); the line above the columns says how many dishes are to make and how many cards
  are late; held cards are dashed and wait for the waiter. Replace "an order at a whole-ticket
  station shows **Whole ticket** while a tap can still move it on" with: a card from a
  whole-ticket station shows **Whole ticket**, and a tap on one of its dishes moves the card's
  dishes at the same stage. Replace the after-period sentence's "**Tickets** … **Board** …" with
  "the card shows **After Lunch — agreed** above it". Spanish the same, with «Esperando»,
  «Preparando», «Listo», «Toda la comanda», «platos por hacer», «con retraso» (read each from
  `strings.ts`'s `es` block before writing); Spanish only in the Spanish file.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and
  `pnpm exec vitest run scripts/guide-links.test.ts`; PASS.
- [ ] **Step 3: design-system.md.** `:614-617`: the kitchen screen's forgotten band dims to
  `--wt-color-danger-pulse-dim` over the fast duration (its own keyframe); the pass's flash is
  unchanged. The late-send mark: "On a card it is a row of its own above each run of consecutive
  dishes with the same mark, within one course head" (no Tickets, no Board). New section, "The
  kitchen screen's cards": D1, D2, D5, D7, D8, D9 and D12 in one paragraph each sentence pointing
  at `apps/till/src/state/kitchen-cards.ts` or `apps/till/src/widgets/station-queue.ts`.
- [ ] **Step 4: Backlog.** Both A797 entries: slice 8 (the kitchen screen's group cards) in review,
  built from the build plan's slice 8; next, slice 8b (short names on cards, after slice 1, landed)
  and slice 9. In A797's detail (`docs/backlog/till.md`), one open point: the whole-order advance
  route `POST /api/orders/:id/stations/:sid/advance` has no till caller after slice 8 (D8).
  Retiring it is a separate change of its own, FULL (a till route), not part of A773-2: A773-2's
  Task 2 retains "real station-item/ticket preparation routes for actual-released work" (its plan,
  Task 2's Interfaces). After the merge, a docs-only commit on `main`
  says "landed in #N". Open no new entry unless the LOOK finds something this slice does not fix
  (its number from `~/waitron-campaign-shared/next-item-number`: read it, use it, write the next
  back).
- [ ] **Step 5: Design file** (dated pointers): after §3.3's "Tap a dish" bullet, "_2026-10-26,
  slice 8: a heading tap moves the dishes holding the card back, not a dish already further on; a
  whole-ticket station's dish tap moves that card's dishes at its stage; the card ages from its own
  fired dishes and keeps whole minutes; the header line sits above the columns until slice 9b's
  header row; see the build plan's slice 8, D4, D6, D8, D9._" In §9, after "the venue's bump mode
  once a dish tap and a heading tap both exist": "(2026-10-26, slice 8: traced and settled in the
  build plan's slice 8, D8.)"
- [ ] **Step 6: Check** `pnpm exec prettier --file-info docs/backlog.md` prints `"ignored": true`
  (wrap by hand); `pnpm format:check` for the guide files.
- [ ] **Step 7: Commit** `git commit -s -m "docs: A797-8 — guides, design system and backlog for the kitchen's group cards"`

### Task 9 (visual): LOOK at the kitchen screen's cards

- [ ] **Step 1: Start the stack** `wa-wt demo waitron-feat-a797-8-kitchen-group-cards`; `wa-wt ls`
  for the URLs. Enrol one browser context as a kitchen display showing the Grill (or the demo's
  kitchen) station screen, as slice 7's LOOK did for its kitchen pictures, and one till context
  signed in (dev mode approves joins at once; a tab still picks a device). In **Prep stations**
  set one station to **Whole ticket at once** for Step 3's last bullet, and back afterwards.
- [ ] **Step 2: Make the food.** From the till: a table with two groups (fire the first, hold the
  second, then fire it a minute later), a second table with one group whose two dishes you then
  move to different stages, a counter order with a note, and a party with two bills sending one
  group (Review focus 11). In **Prep stations**, set the station's Waiting, Overdue and Forgotten
  after to **1**, **2** and **3** minutes for the run, so cards reach amber, red and the forgotten
  pulse within minutes; note the values first and put them back afterwards.
- [ ] **Step 3: Look** with the workspace's Playwright Chromium (the script in
  `/Users/clintongormley/waitron-campaign-c/a797-8-scripts/`, never in the worktree, its process id
  recorded), at **1280 px** and **1024 px** on the kitchen display and **390 px** on the till's
  Station screen, **light and dark**, **English and Spanish**:
  - the three columns, **Waiting · Preparing · Ready** «Esperando · Preparando · Listo», one card
    per group, the second group's card on its own with its own minutes;
  - the header line «… platos por hacer · 1 con retraso» and its English;
  - the bands: green, amber, red; a forgotten card's pulse (two pictures about half a second
    apart; the computed `animation-name` in the ledger); with `reducedMotion: "reduce"`, still and
    red;
  - the held card dashed in Waiting with "Held, not released";
  - a card with two stages: the further dish says its state; tap the heading: only the waiting dish
    moves; tap a dish: only it moves; on the whole-ticket station, tap a dish: the card's dishes at
    its stage move, the other group's card does not;
  - on the till, Reprint and Collect on the cards, no Board/Tickets switch; on the display, neither;
  - a merged display with two stations: one header line, each station's cards labelled;
  - the group sent across two bills: one card with both bills' numbers, two Reprint buttons on the
    till;
  - the word Waiting where New was (D10): a dish on the pass (the till's ☰ → Pass) and a department
    transfer's outstanding work, in English and Spanish;
  - set the 1280 px light English picture beside picture 03
    (`docs/backlog/mockups/a797-device-screens/03-kitchen-screen.png`) and describe each difference
    in the ledger and the PR body: Overview, Held, the corner's Columns, the collapsed Ready, short
    names, m:ss timers and the one-row header are expected (later slices, D6, D9); anything else
    (card grouping, order, band colours, the heading, the words) that differs is a finding.
- [ ] **Step 4: Save** each picture as a PNG under `/Users/clintongormley/waitron-campaign-c/a797-8-shots/`
  (`<step>-<width>-<theme>-<lang>.png`), open each, and describe what was seen in the ledger and
  the PR body. Put back every demo setting changed in Steps 1–2.
- [ ] **Step 5: Stop** what you started: the script's process by its recorded id, then
  `wa-wt down waitron-feat-a797-8-kitchen-group-cards`.

### Closing slice 8

- Focused runs per task as above; CI runs the till's package suites and coverage (and ui-core's
  for the comments, and the server's for the guides). Read the `changes` job's outputs and the
  till's coverage or merge job on the current head before calling the PR green. Code this slice
  leaves unreached is deleted, never excluded (Global constraints).
- `/finish-branch` with this plan named. Review path **LIGHT**: the plan-against-spec read and one
  Codex run-it review.
- PR body. First line: no venue reset. Then: **What a cook sees** (cards per group, the heading
  tap, the band, the header line, Waiting, no Tickets switch, Reprint and Collect on the cards);
  **Decisions** D1–D14 in one line each; **Changed test checks** (from the ledger, each with its
  D-number); **LOOK**.
- **Owner FYI** (one line each in the PR and the lane's questions file, not questions): D8 (a
  heading tap moves the dishes holding the card back, not "every dish one step"; a whole-ticket
  station's tap moves that card's dishes, no longer the whole order's), D6 (whole minutes, not
  picture 03's m:ss), D9 (the header line above the columns, not yet in one row with the station's
  name; "late" counts cards), D10 (the Spanish «platos por hacer», «con retraso»; "Waiting" also
  on the pass and department transfers), D11 (Reprint and Collect on every card of a bill), D3
  (held cards sit under Waiting, dashed, until A773-2's Held column; the alternative is an interim
  Held column).
- In lane C's questions file, also one line for lane G: slice 8 holds `station-queue.ts` and
  `till-station-screen.ts` until it lands (design §7's turn).
- After merge: delete the branch local and remote and check the remote one is gone; the backlog's
  "landed in #N" commit; update the ledger; then slice 8b or 9, in turn with lane G.

---

## Slice 8b — Short names on kitchen cards (one PR, branch `feat/a797-8b-kitchen-short-names`)

**What it changes.** A kitchen card names its table by the table's **short name** ("T1", not
"Terrace 1"; design §3.3, §3.7), a joined table by its tables' short names ("T4+T5"), and a counter
order with no table reads **"Counter #12"** («Mostrador #12»; design §3.3). Today a card shows its
bill's own `label` (`apps/till/src/widgets/station-queue.ts:914`, read), which is null on a table's
bill until it is paid (slice 8's LOOK finding (2), `a797-8-look-report.md`), so most table cards
name no table at all. The station read, which both the till's Station screen
(`GET /api/stations/:id/queue`, `apps/server/src/till-api.ts:2185-2191`) and a kitchen display
(`stationScreenSlots`, `apps/server/src/device-api.ts:1030-1050`) read through
`listStationQueues` (`apps/server/src/working-order.ts:7652` at the base), gains each bill's tables' short names.

**Review path: FULL** (what a server read sends the till; this plan's "Review path"). **Migration:
none.** No venue reset. Built **inline** (the inline-coding trial: this session writes the code,
test first; no implementer).

How claims are marked in this section: **(ran)** means run on 2026-10-27 against `main` at
`a711f06b1` (this worktree's base); **(read)** means read in the code at that commit. The probes
ran in this worktree and were reverted (`git checkout --`) before any commit; their logs are in
`/Users/clintongormley/waitron-campaign-c/a797-8b-probe/`.

### The turn with lane G's A773-2 (ran)

No lane's queue holds A773-2's PRs B–D (`grep -n "A773-2" ~/waitron-campaign*/queue.md`: only lane
C's own A797 lines, lane B's copy of them, lane A's placement note and lane F's landed PR A); the
open pull requests are #2124, #2122 and #1986, and none touches a station or kitchen file
(`gh pr diff <n> --name-only | grep -E 'station|kitchen'` → nothing for each). So slice 8b takes the
turn on `station-queue.ts`; it leaves `till-expo-screen.ts` alone (the pass is slice 12b).

### Every reader and writer this slice touches (ran: grep; each line read)

From `grep -rln 'listStationQueues\?\b' apps packages --include='*.ts'` (ran), `grep -rn
'StationQueueGroup\|MergedQueueGroup' apps/till/src --include='*.ts' | grep -v '\.test\.ts'` (ran)
and `grep -n '\.label' apps/till/src/widgets/station-queue.ts` (ran), each line read:

| Where | What it does today | In this slice |
| --- | --- | --- |
| `apps/server/src/working-order.ts:7386-7407` `StationQueueGroup` | one bill's lines at a station; `label` is `working_orders.label` | gains `tableShortNames?: string[]` (D1) |
| same file `:7612-7840` `listStationQueues` | reads `workingOrders.label`, no table | also reads `deliveryTableId`, then each bill's tables' short names in one batch before the row loop (D1) |
| `apps/server/src/till-api.ts:2185-2191`, `apps/server/src/device-api.ts:1038`, `:1047`, `:1076` | the till's and the kitchen display's station reads, through `listStationQueue(s)` | unchanged; both carry the field (D1) |
| `packages/db/src/party-table-labels.ts:193-200` `billPartyTables` | a party bill's tables: its active ones, else the survivor of its merges'; each by id and names, no short name | read, unchanged (D1) |
| `packages/db/src/schema/dining-tables.ts:19` `short_name` | the table's saved short name, nullable | read (D1) |
| `apps/till/src/api/client.ts:1650-1673` `StationQueueGroup` | the till's copy of the type | gains the field (D1) |
| `apps/till/src/state/kitchen-cards.ts` | the card model (`KitchenCard.orders`) | gains `cardPlaces`, `isCounterOrder` (D2, D3) |
| `apps/till/src/widgets/station-queue.ts:914`, `:925-931` `#card` | `labels`: each bill's `label`, distinct; heading `.number` per bill | places replace labels; "Counter" before a counter order's number (D3, D4) |
| `apps/till/src/screens/till-counter-screen.ts:242`, `apps/till/src/till-app.ts:3093` | hold a `StationQueueGroup[]`, read no label (`grep -n '\.label' till-counter-screen.ts` → nothing) | unchanged |
| `apps/till/src/i18n/strings.ts` en `:340`, es `:2108` `tab.counter` | "Counter" «Mostrador», the till's word for the counter | new `station.counter`, same words (D4) |

### Plan decisions for slice 8b

- **D1. The read carries each bill's tables' short names, `tableShortNames?: string[]`.** A party's
  bill: the tables `billPartyTables` gives its party (its active tables in the order they joined,
  or, once it holds none, those of the party at the end of its merges;
  `packages/db/src/party-table-labels.ts:150-200`, read), the same tables the pass names
  (`orderTableLabels`, `:246-283`). A bill of no party: the table it is delivered to
  (`working_orders.delivery_table_id`, `packages/db/src/schema/orders.ts`, "this counter order is
  delivered to that table"), read by id in any location, as `tableNames` does (`:106-115`). Each
  table by its saved short name, else its label, exactly as the floor read's `shortName`
  (`working-order.ts:8372`, `r.short_name ?? r.label`); today's names never (the Ready bar's rule,
  `tightName`, `apps/till/src/state/floor-today.ts:87-97`). **Absent** when the bill is at no table
  (a counter order, a party holding none), the read's `optional(...)` habit; a delivered order whose
  table was let go sends the name kept (D3). Read once per call for every bill before the row loop
  (CLAUDE.md §3: shared data resolved once, not per line). The server sends names, not one joined
  string, so the till joins them by one rule (D3).
- **D2. A counter order is a bill with no party; the read already says so.** `party` is absent on a
  bill of no party (`working-order.ts:7395`), and the schema says "a counter order has none"
  (`packages/db/src/schema/orders.ts`, `partyId`). Of the writes to a bill's party (ran `grep -rn
  '\.set({[^}]*partyId' apps/server/src packages --include='*.ts' | grep -v '\.test\.ts'`), only
  `moveSettledBillToCounter` clears it, moving a paid bill to the counter
  (`apps/server/src/move-bill.ts:333-357`); `move-bill.ts:582` gives a bill a party, and the other
  hits update other tables. Bills are created with no party by a counter sale or park
  (`working-order.ts:1637`, `placement.partyId ?? null`) and by splitting a bill of no party
  (`apps/server/src/bill-actions.ts:183-187`, which passes the source's party). So no new field;
  the two bills of no party that came from a table are D3's. This settles slice 8's D5 worry ("a bill with no `party` may also be a
  table's"): that bill is a counter order delivered to a table, and D1 names its table.
- **D3. The heading names each bill's place once.** A bill's place is its tables' short names
  through `mergeLabel` (number order, joined "+", `packages/ui/src/components/wt-floor-map.ts:144`;
  how `tightName` names a join), else its `label` as today. The card lists each distinct place
  once (two bills of one group at T4 read "T4" once). **Counter:** a bill with no party and no table
  reads "Counter #12" — "Counter" before its number — then its label if it has one ("Counter #12
  Ana"). A counter order delivered to T4 reads "#12 T4" (design §3.3: "the table's short name (or
  "Counter #12")"). **The label is not shown beside a short name:** payment freezes the bill's label
  to its receipt's name (`working-order.ts:6727-6730`, `apps/server/src/bill-payments.ts:771`,
  through `readReceiptOrder`: a party's bill by `partyTableLabels` and `partyReceiptLabel`, so
  "Terrace 1" or "Ana · Terrace 1", `apps/server/src/receipt-order.ts:46-51`; any other by
  `orderTableLabels`, `:53-62`; read), and a split bill carries its table's full name from the
  start (`bill-actions.ts:183`), so it would repeat the table's name beside its short name. A label
  typed by staff, or a named party's name frozen into it, is therefore not on a table's card.
  **Bills of no party that came from a table** (review finding, 2026-10-27):
  - a counter order delivered to a table whose table was let go keeps the table's name
    (`working_orders.delivery_table_label`, set by `releaseDeliveries`,
    `apps/server/src/delivery-release.ts`), and the read sends that kept name as its place, as the
    pass names it (`packages/db/src/party-table-labels.ts:276`): "#12 Garden 4", no "Counter";
  - a split of a delivered counter order gets no delivery table and the table's full name as its
    label (`bill-actions.ts:183-187`), so it reads "Counter #13 Terrace 4";
  - a paid bill moved to the counter when its party finishes (`moveSettledBillToCounter`) is now
    collected at the counter and reads "Counter #12 Terrace 1" by its frozen label.
  Both of the last two read true (a counter order, for that table); copying the delivery table on
  a split is outside this slice. **Owner FYI.**
  **The Ready bar names one party at separate tables differently:** `groupTables`
  (`apps/till/src/state/table-signals.ts:132-150`) lists the tables in floor order and only those
  in the zones on screen ("T5+T4"); the card sorts them by number ("T4+T5"); and with no short
  names saved, `mergeLabel` shortens repeated first words ("Table 4+5") where the bar shows "Table
  4+Table 5". A join made on the till agrees, because seating a join gives the party every member
  table (`seatMergeMembers`, `apps/server/src/floor-today-merges.ts:109-120`).
- **D4. "Counter" is a word of its own,** `<span class="counter">` before the `.number` span, so the
  number stays one element (tests and the hidden "Advance ticket #12" read it). New string
  `station.counter`: "Counter" «Mostrador», the till's existing words for the counter
  (`tab.counter`, `strings.ts:340`, `:2108`), kept as its own key because it names a kind of order,
  not a tab.
- **D5. Left as they are:** a group's `numberPartyLabel` ("Group 2 · Terrace 7", shown only when two
  merged parties' groups share a number, `apps/server/src/order-groups.ts:2310-2333`); the pass
  (slice 12b); the printed kitchen ticket, which prints the full name (design §3.7, §9); Reprint's
  and Collect's names and the hidden "Advance ticket #12".

### Changed test checks (from the probes; the build confirms each)

- **Server: none.** Probe 1 (ran): the read sent `tableShortNames: ["PROBE"]` on every bill with a
  party or a delivery table; the 35 server files that read the station queue
  (`grep -rln 'listStationQueues\?\b' …` plus the route suites) → `Test Files 35 passed (35)`,
  `Tests 1945 passed (1945)` (`probe-run1.txt`). Control (ran): the field on EVERY bill → `1 failed |
  1944 passed`: `till-api.fiscal-sale-paths.test.ts` "Mode T: place files no fiscal doc…" pins the
  whole group with `toEqual` on a counter order with no table (`probe-run2.txt`), which D1 leaves
  without the field. So whole-shape pins exist and none is on a bill D1 names.
- **Till: one.** Probe 2 (ran): "PROBE " inside each party-less bill's `.number` → 6 failed in
  `station-queue.test.ts` (`probe-till1.txt`); five read `.number`'s text, which D4 keeps, and one
  reads the heading's accessible name: **"a heading's name starts with its words and ends with
  Advance ticket"** (`station-queue.test.ts:3413-3428`), whose bill (`ageBill`) has no party, so its
  name now starts "Counter #7 Table 7" (D3). Its regex gains "Counter ".

### Review focus (inputs the spec implies and today's tests may not pin)

1. A table with no saved short name: the card shows its label (D1).
2. A join of two tables, and a party at two separate tables: "T4+T5" in number order (D1, D3).
3. A bill whose party was merged into another and holds no table: the survivor's tables (D1).
4. A counter order with a label, with none, and delivered to a table (D2, D3).
5. One group across two bills of a party: the place once (D3).
6. A kitchen display and the till's Station screen both show it (D1); Spanish «Mostrador #12».
7. A paid table bill (label frozen to "Terrace 1"): the card reads "T1" alone (D3).

---

**Task order and why.** The server read first (Task 1), so the till reads a real field; the till's
type and naming rule (Task 2); the heading (Task 3); docs (Task 4); the LOOK (Task 5). Each ends
green and committed.

### Task 1: The station read carries each bill's tables' short names

**Files:**
- Modify: `apps/server/src/working-order.ts` (`StationQueueGroup`; `listStationQueues`: select
  `deliveryTableId`; one helper reading every bill's tables' short names; the group's field)
- Test: new `apps/server/src/station-queue-short-names.test.ts` (`useVenueDb`, the party venue
  fixture `apps/server/src/testing/party-venue.ts`: `setupPartyVenue`, `seat`, `join`,
  `orderForParty`, `counterOrder`)

- [ ] **Step 1: Failing tests**, one case each, reading `listStationQueue` and asserting the bill's
  `tableShortNames` with `toEqual` (and its absence with `not.toHaveProperty`): a party at a table
  with short name "T1" (label "Terrace 1") → `["T1"]`; a table with no short name → its label; a
  party at two joined tables → both, in the order they joined; a party merged into another holding
  no table → the survivor's tables; a counter order → no field; a counter order delivered to a
  table → that table's short name; and one case through `GET /api/stations/:id/queue` (the till's
  route) seeing the field on the wire. Run `pnpm --filter @waitron/server exec vitest run
  src/station-queue-short-names.test.ts`; expect each to fail on the missing field.
- [ ] **Step 2: Implement** D1. Run the new file (PASS), then the probe's 35 files again (the list
  in `probe-run1.txt`'s header command); expect `Tests` = 1945 plus the new cases, all passing.
- [ ] **Step 3:** `pnpm --filter @waitron/server typecheck`; eslint the changed files; `pnpm
  format:check`; ledger; `git commit -s -m "A797-8b: the station read names each bill's tables by their short names"`

### Task 2: The till's type and the card's places

**Files:**
- Modify: `apps/till/src/api/client.ts` (`StationQueueGroup.tableShortNames?: string[]`, with D1's
  meaning in one line), `apps/till/src/state/kitchen-cards.ts` (`isCounterOrder(order)`: no party
  and no table; `cardPlaces(card)`: each bill's place, D3, distinct, in the card's bill order)
- Test: `apps/till/src/state/kitchen-cards.test.ts`

- [ ] **Step 1: Failing tests:** one table → its short name; two → `mergeLabel` ("T4+T5" from
  `["T5", "T4"]`); none → the label; none and no label → nothing; two bills at one place → once;
  `isCounterOrder` true only with no party and no table. Run `pnpm --filter @waitron/till exec
  vitest run src/state/kitchen-cards` (memory first); fail.
- [ ] **Step 2: Implement**; PASS; `pnpm --filter @waitron/till typecheck`; eslint; format; ledger;
  `git commit -s -m "A797-8b: a kitchen card's places, by its tables' short names"`

### Task 3: The card's heading shows the places and "Counter #12"

**Files:**
- Modify: `apps/till/src/widgets/station-queue.ts` (`#card`: `cardPlaces` for `labels`;
  `<span class="counter">` before a counter order's `.number`), `apps/till/src/i18n/strings.ts`
  (`station.counter` en "Counter", es «Mostrador»)
- Test: `apps/till/src/widgets/station-queue.test.ts`

- [ ] **Step 1: Failing tests** (describe "a card's place"): a party bill with
  `tableShortNames: ["T1"]` and label "Terrace 1" → heading shows "T1", not "Terrace 1"; `["T5",
  "T4"]` → "T4+T5"; a counter order → "Counter #12", and under `setLocale("es")`
  `t("station.counter")` before the number (no Spanish literal; restored in `finally`); a counter
  order delivered (`tableShortNames: ["T4"]`, no party) → "#12 T4", no "Counter"; a card of two
  bills at T4 → "T4" once. Run; fail.
- [ ] **Step 2: Implement**; change the one check the probe named (Changed test checks) and no
  other; run `pnpm --filter @waitron/till exec vitest run src/widgets/station-queue
  src/screens/till-station-screen src/screens/kitchen-allergy src/screens/text-size.layout
  src/state/kitchen-cards src/screens/till-counter-screen` → every test passes, the count read.
- [ ] **Step 3:** `pnpm exec vitest run scripts/english-only.test.ts` from the root; typecheck;
  eslint; format; ledger; `git commit -s -m "A797-8b: a kitchen card names its table by its short name, and a counter order Counter #12"`

### Task 4: Docs, the user guides and the backlog follow the code

**Files:** `apps/server/src/guide/en/kitchen-service.md` and `es/` (the `{#kitchen-screen}`
section: one sentence — a card names its table by its short name, or reads **Counter #12** /
**Mostrador #12** for a counter order); `docs/developers/design-system.md` (`### The kitchen
screen's cards`: one sentence for D3, pointing at `kitchen-cards.ts`); `docs/backlog.md` and
`docs/backlog/till.md` (A797: slice 8b in review; next slice 9); the design's §3.3 a dated pointer
(D3's counter-delivered reading and D2).

- [ ] **Step 1:** write them; `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts`
  and `pnpm exec vitest run scripts/guide-links.test.ts`; PASS; `pnpm exec prettier --file-info
  docs/backlog.md` → `"ignored": true`; `pnpm format:check`.
- [ ] **Step 2:** `git commit -s -m "docs: A797-8b — guides, design system and backlog for short names on kitchen cards"`

### Task 1b (review follow-ups, built after Task 3): a let-go table's name, the kitchen display, and a cheaper work check

From the fresh plan review (2026-10-27). **Files:** `apps/server/src/working-order.ts`,
`apps/server/src/device-api.ts`, `apps/server/src/device-api.test.ts`,
`apps/server/src/station-queue-short-names.test.ts`.

- [x] A counter order whose delivery table was let go names it by `delivery_table_label` (D3):
  test first, seen failing (`expected undefined to deeply equal [ 'Garden 9' ]`).
- [x] The kitchen display's route (`GET /api/device/station-screen`, Review focus 6): a delivered
  counter order reads `[["G4"]]`; deletion control (the group's field removed) → `expected [
  undefined ] to deeply equal [ [ 'G4' ] ]`. The "two joined tables" case is renamed "two tables":
  `join` adds a table to the party, and a join made on the till seats every member (D3).
- [x] `worksStation` (`device-api.ts:1062-1077`) read the whole station queue only to see whether
  it was empty, for a switched-off station on an every-station screen; it now asks
  `stationHasWork`, one row through the same filter (`onStationQueues`, shared with
  `listStationQueues`), so the new short-name reads add nothing there. Guarded by "lists it on an
  every-station screen under an every-station profile only while dishes wait there"
  (`device-api.test.ts`): `stationHasWork` forced true → `expected 204 to be 403`; forced false →
  `expected 403 to be 204`.
- [x] The station-read suites, with the command written at the top of the log
  (`/Users/clintongormley/waitron-campaign-c/a797-8b-probe/a797-8b-task1b-run.txt`): 38 files,
  `Tests 2054 passed (2054)`.

### Task 5 (visual): LOOK at the cards' names

- [ ] **Step 1:** `wa-wt demo waitron-feat-a797-8b-kitchen-short-names`; a kitchen display on the
  kitchen station and a till signed in, as slice 8's LOOK did (its scripts:
  `/Users/clintongormley/waitron-campaign-c/a797-8-scripts/`; this slice's go in
  `a797-8b-scripts/`, never in the worktree; each process id recorded).
- [ ] **Step 2:** from the till: a table with a short name sends a group; two joined tables send
  one; a counter order with a note; the first table's bill paid. At **1280 px** on the display and
  **390 px** on the till's Station screen, light and dark, English and Spanish: each card names
  its table by its short name, the joined one "T4+T5" (or the demo's names), the counter one
  "Counter #N" / «Mostrador #N», the paid one still its short name alone; the heading still wraps
  inside the card at 390 px (slice 8's R2-1).
- [ ] **Step 3:** save each picture under `/Users/clintongormley/waitron-campaign-c/a797-8b-shots/`,
  open each, describe it in the ledger and the PR body; put back anything changed; stop the
  script by its id, then `wa-wt down waitron-feat-a797-8b-kitchen-short-names`.

### Closing slice 8b

- `/finish-branch` with this plan named; review path **FULL**: the plan-against-spec read and two
  Codex run-it reviews (the second told to test what this plan does not name).
- PR body. First line: no venue reset. Then: what a cook sees; D1–D5 one line each; Changed test
  checks; LOOK.
- **Owner FYI** (questions file and PR): D3 — a counter order delivered to a table reads "#12 T4",
  not "Counter #12"; a label staff typed on a table's bill, or a named party's name, is not on the
  card; a split of a delivered counter order and a paid bill moved to the counter read "Counter #N"
  with the table's full name; the card and the Ready bar may order one party's separate tables
  differently.
- After merge: the backlog's "landed in #N" commit; the ledger; then slice 9.

---

## Slice 9 — The Columns controller and collapse (one PR, branch `feat/a797-9-columns-controller`)

**What it changes.** On a kitchen screen (a kitchen display, or the till's Station screen), **tap a
column's heading to collapse it**: the column shrinks to a narrow strip that keeps its heading and
count, "› Ready · 3" written top to bottom, and one tap opens it again (design §3.3, picture 03's
Ready). Each heading now shows its column's count of cards beside its name ("Waiting 2", picture 03).
Which columns are collapsed is **remembered on the device**, per station, and survives a reload or a
restart (design §3.3, §3.6, worked example 4). Underneath, slice 9 builds the **one device-scoped
store** of each screen's column order, shown columns and collapsed columns that design §7 and
A773-2's plan name (`readColumnState`, `saveColumnState`, `moveColumn`, `toggleColumnCollapsed`,
`setColumnVisible`, key `waitron.kitchenColumns.v1.`; A773-2 plan `:101`, `:289-291`), at the path
A773-2's Task 7b looks for, so lane G uses it unchanged. The board draws the stored order (which
nothing in this slice changes yet). The corner's Columns panel with Move up / Move down and Show
(slice 9b), the one-row header (9b), Overview and the narrow tabs (9c), and the Held column
(A773-2) are not built here.

**Review path: LIGHT.** No server read, route, schema or shared type changes: the layout is kept in
the device's browser (design §5, "Columns … are kept in the device's browser … Nothing on the
server"). The changed files are under `apps/till/src/`, the guides and the docs. None of the risk
triggers applies: the key names the device the server proved (`identity.deviceId` from
`getDeviceIdentity`, `apps/till/src/till-app.ts:4280-4285`, read) and grants nothing.
**Migration: none.** No venue reset.

How claims are marked in this section: **(ran)** means run on 2026-10-27 against `main` at
`469e4e966` (this worktree's base); **(read)** means read in the code at that commit. The probe
ran in a throwaway worktree (`git worktree add --detach /tmp/a797-9-probe.fFlN/wt 469e4e966`),
removed afterwards; its diff and logs were copied to
`/Users/clintongormley/waitron-campaign-c/a797-9-probe/` (`probe.diff`, `base1.txt`, `tsc1.txt`,
`run1.txt`, `run2-control.txt`). None of the probe code is in this branch.

### The turn with lane G's A773-2 (ran)

`gh pr list --state open` → two open pull requests, #2127 (A974, English names in till party
tests) and #2128 (A918, starter void and comp reasons); neither touches this slice's files
(`gh pr diff <n> --name-only | grep -E 'station-queue|till-station-screen|till-app\.ts|kitchen-service|kitchen-columns'`
→ nothing, exit 1, for each; ran again at the plan review). `git ls-remote origin | grep -i a773`
→ only old `refs/pull/*` heads, no branch. Lane G's queue has no A773-2 line
(`grep -n "A773-2" ~/waitron-campaign-g/queue.md` → nothing); lane F's queue records A773-2's PR A
landed as #1944 (`509e8d42a` on `main`, `git log --oneline | grep 1944`) and holds no later A773-2
PR. No code on `main` holds a column store (`grep -rln "kitchenColumns\|ColumnState\|ColumnScope"
apps packages --include='*.ts'` → nothing). So slice 9 takes the turn on `station-queue.ts` and
`till-station-screen.ts`, builds the controller (design §7: "the Columns controller **only if A797's
has not landed**" is A773-2's condition for building its own), and leaves `till-expo-screen.ts`
alone. The closing step posts one line for lane G in lane C's questions file.

### Every reader and writer this slice touches (ran: grep; each line read)

From `grep -rn "COLUMNS\|column-title\|data-column\|\.kanban\|\.column\b" apps/till/src/widgets/station-queue.ts`
(ran), `grep -rn "<till-station-queue\|<till-station-screen" apps --include='*.ts' | grep -v '\.test\.ts'`
(ran: two widget mounts in the screen, two screen mounts in the app, nothing else) and
`grep -rn "localStorage" apps/till/src --include='*.ts' | grep -v '\.test\.ts'` (ran), each line
read:

| Where | What it does today | In this slice |
| --- | --- | --- |
| `apps/till/src/widgets/station-queue.ts:63` `COLUMNS` | `["queued", "preparing", "ready"]`: the drawn order, and the kitchen-state order `#stateWord` compares (`:1002`) | stays the state order only; the drawn order comes from the store (D6, D8) |
| same file `:107-126` `.kanban`, `.column`, `.column-title` | a grid, `repeat(auto-fit, minmax(11rem, 1fr))`; the title an `h2`, small bold muted capitals | a wrapping flex row; a collapsed column a `--wt-tap-min` strip; the title inside a heading button (D9, D10) |
| same file `:895-905` `#board` | one `section[data-column]` per `COLUMNS` entry, its title, its cards | one per stored key it can draw, in stored order; a collapsed one draws its heading and count and no cards (D6, D9) |
| same file `:996-1006` `#stateWord` | a dish ahead of its card's column says its state, by `COLUMNS.indexOf` | unchanged: state order, never drawn order (D8) |
| `apps/till/src/screens/till-station-screen.ts:205-206` `deviceId`, `:50` `viewKey`, `:305-323` `#rememberedMerged`, `#toggleMerged` | the device's Merged/Stacked choice in `localStorage`, each access in a `try` | unchanged; the precedent for guarded access |
| same file `:1064-1071` `#queue`'s `<till-station-queue>` (one station `:851`, each stacked section `:933`, `:936`, the till `:1043`) and `:885-891` `#mergedBody`'s `<till-station-queue>` | the two widget tags | each tag gets `.columns` and its own `@toggle-column` handler: `#queue`'s passes `station.id`, the merged one none (D5, D11) |
| `apps/till/src/till-app.ts:18567-18574` (kitchen display), `:18768-18777` (the till's Station drill) | mount the screen with `.deviceId` (`:18574`, `:18777`) | also `.serverOrigin` (D12) |
| same file `:5977-5992` `#floorViewChoices`, `:5995-6001` `#zoneMenuIdentity` | slice 5's per-device memories, each naming the venue by `this.router?.current ?? location.origin` (`:5980`, `:5997`) | that expression moves into one helper, `#serverOrigin()`, which both and the two screen mounts use (D12) |
| `apps/till/src/state/floor-view-memory.ts:14-56` | key `waitron.floorView.${JSON.stringify([origin, deviceId, zoneId])}`; refused storage swallowed | the precedent for the key's shape and failure handling (D2, D4) |
| `apps/till/src/i18n/strings.ts` en `:679-681`, es `:2433-2435` `station.state.*` | the column names | read, unchanged: no new words (D13) |
| `apps/till/src/widgets/station-queue.test.ts:2684`, `:2702`, `:2710` | read `.column-title`'s text as exactly the column's name | unchanged: the name keeps its own span (D9; the probe) |

### Plan decisions for slice 9

- **D1. Slice 9 builds all five of A773-2's functions now, at the path A773-2 names.** A new
  `apps/till/src/state/kitchen-columns.ts` (A773-2 Task 7b: "create till `state/kitchen-columns.ts`
  and `.test.ts`", plan `:288`), exporting exactly A773-2's contract 13 and Task 7b interfaces
  (plan `:101`, `:290`):
  ```ts
  export type ColumnKey = "overview" | "held" | "toFire" | "inProgress" | "ready" | "waiting" | "preparing";
  export interface ColumnScope { venueId: string; deviceId: string; screen: "pass" | "pass_monitor" | "station"; stationId?: string }
  export interface ColumnState { order: ColumnKey[]; hidden: ColumnKey[]; collapsed: ColumnKey[] }
  export function readColumnState(storage: Pick<Storage, "getItem">, scope: ColumnScope, defaults: ColumnState): ColumnState;
  export function saveColumnState(storage: Pick<Storage, "setItem">, scope: ColumnScope, state: ColumnState): void;
  export function moveColumn(state: ColumnState, key: ColumnKey, direction: "up" | "down"): ColumnState;
  export function toggleColumnCollapsed(state: ColumnState, key: ColumnKey): ColumnState;
  export function setColumnVisible(state: ColumnState, key: ColumnKey, visible: boolean): ColumnState;
  /** The station screen's columns in slice 9: Waiting, Preparing, Ready, all shown, none collapsed. */
  export const STATION_COLUMNS: ColumnState;
  ```
  `moveColumn` and `setColumnVisible` have no control in this slice; they are built and tested now
  as pure functions because A773-2's interface names them and design §7 says the controller "meets
  A773-2's interface … whichever lane builds it", so lane G's Task 7b reuses one module rather than
  adding a second. They are reached by their own tests, so coverage holds; slice 9b wires them to
  the corner's Columns. No UI wiring is built for them here.
- **D2. The key and the stored value.** Key `waitron.kitchenColumns.v1.` followed by
  `JSON.stringify([venueId, deviceId, screen, stationId ?? ""])` (A773-2: "an encoded JSON tuple of
  venue/proven-device/screen/station-or-empty"; the JSON array is slice 5's way of keeping an id
  with a dot from running into the next part, `floor-view-memory.ts:21`). Value
  `JSON.stringify({ version: 1, order, hidden, collapsed })`. **No identity, no storage:** a scope
  whose `venueId` or `deviceId` is `""` reads the defaults without calling `getItem` and saves
  nothing (A773-2: "never … allow absent identity to share storage"; CLAUDE.md §3: an empty value is
  a value, so the reader refuses it). No profile in the key, so a profile switch keeps the device's
  layout (A773-2 Task 7b's first test); the station by id, so a renamed station keeps it.
- **D3. Reading a stored value.** The registered keys are `defaults.order`. A value that is not
  JSON, not an object, of another `version`, or whose `order`, `hidden` or `collapsed` is not an
  array of strings, reads as a fresh copy of the defaults. Otherwise: `order` keeps registered keys
  only, first occurrence of each; `hidden` and `collapsed` keep registered keys only, once each.
  **Each registered key missing from the stored order is put back**, taken in default order:
  - **at its default place:** right after the nearest key before it in `defaults.order` that is
    present in the order built so far, including keys already put back, or first when none is;
  - **with its default state:** it is in `hidden` and in `collapsed` exactly when
    `defaults.hidden` and `defaults.collapsed` hold it. A key already in the stored order keeps its
    stored state. So a pass that shipped without Overview, and a later slice that registers it
    hidden by default (the owner's "Overview OFF" on the pass, A773-2 contract 13, plan `:101`),
    does not show Overview on a pass that saved a layout before it existed.
  Handling a missing registered key is A773-2's contract ("append missing registered keys in
  default order"), not new backwards-compatibility code; what is new is the **position** and the
  **default state** above. A773-2 says append, this places it, so when slice 9c registers Overview (first by default, design §3.3) and
  A773-2 registers Held (before Waiting), a device that saved a layout gets Overview first and Held
  before Waiting rather than both after Ready. The result is still deterministic (A773-2 Task 7b's
  test asks that). **Lane G FYI.** A bad value is not removed (the read is given `getItem` only);
  the next save overwrites it.
- **D4. Storage that throws.** `getItem` throwing reads the defaults; `setItem` throwing is
  swallowed (a full or refused store); neither throws to the caller (A773-2: "Storage failure leaves
  a usable in-memory view"; slice 5's handling, `floor-view-memory.ts:29-33`, `:51-55`). The screen
  keeps the state in memory (D11), so a tap still collapses the column for as long as the screen is
  open.
- **D5. What one stored layout covers.** `screen: "station"` for both the kitchen display and the
  till's Station screen; they are different devices, so their keys differ by `deviceId`.
  `venueId` is **the server's origin**, `this.router?.current ?? location.origin`, as slice 5 names
  the venue (its D8: "the till has no venue id of its own", `apps/till/src/api/client.ts` `TillInfo`,
  read); a LIGHT slice adds no read. A failover to another box would change the origin and show
  that box's defaults; today a venue has one node (CLAUDE.md §5). `deviceId` is the device the
  server proved (above). `stationId` is: on the till, the station picked; on a kitchen display with
  one station, that station; stacked, each section's own station; **the merged board, none**
  (stored under `""`), because it is one board across the device's stations, so collapsing Ready
  there does not collapse it on each station's stacked board.
- **D6. The station screen registers Waiting, Preparing and Ready** (`STATION_COLUMNS`: order
  `["waiting", "preparing", "ready"]`, nothing hidden or collapsed). A773-2's station registers
  "Overview/Held/Waiting/Preparing/Ready" (plan `:101`): slice 9c adds `overview` and A773-2 adds
  `held` to these defaults, and D3 places them on a saved layout. The widget maps `waiting` to the
  `queued` state and `preparing`, `ready` to themselves; `data-column` keeps the state names (slice
  8, D14). A key the widget cannot draw yet (`overview`, `held`, `toFire`, `inProgress`) is skipped.
- **D7. `hidden` is kept but not drawn until slice 9b.** The board draws `order` and `collapsed`. No
  control in slice 9 can hide a column, and slice 9b brings the Show switch and the hiding
  together, so there is never a layout that hides a column with no way to bring it back (A773-2:
  "Columns remain reachable"). `toggleColumnCollapsed` keeps `hidden` as it was, so a saved value
  round-trips.
- **D8. The kitchen-state order is not the drawn order.** A card's column and a dish's state word
  (`#stateWord`, `:996-1006`) keep comparing states in `queued → preparing → ready` order through
  `COLUMNS`, so a device that puts Ready first (slice 9b) still has a Preparing dish on a Waiting
  card say "Preparing".
- **D9. The heading.** `<h2 class="column-heading">` holding `<button class="column-toggle"
  data-column-toggle=${key} aria-expanded=…>`, inside it `<span class="column-title">` (the name,
  unchanged text, so the three tests that read it still pass), `<span class="column-count"
  data-column-count>` (the number of cards in the column, held cards included; picture 03 counts
  cards: Preparing "1" over one card of two dishes; design §3.3 "Ready · 3") and a decorative
  `wt-icon` (`aria-hidden`): `column-open`, a down chevron, while open; `column-closed`, a right
  chevron, while collapsed, both registered by the widget as its notice icons are (`:43-54`).
  **Picture 03's arrangement:** open, the name at the start and the count then the chevron at the
  end ("WAITING 2 ▾"); collapsed, the chevron **first**, so with the text running top to bottom
  (`writing-mode: vertical-rl`) it sits at the top of the strip ("› READY · 2"). Between the name
  and the count there is a real space in the template, outside any span, and collapsed the " · " is
  its own `aria-hidden` span between two real spaces, so the button's accessible name is "Ready 1"
  open and collapsed alike. One button template serves both states, only its children changing, so
  Lit keeps the same element and the focus stays on it after a tap redraws the board. Collapsed:
  the column draws its heading and **no cards** (not in the page, so nothing hidden in it is
  focusable), as a strip `--wt-tap-min` wide stretched to its row's height. The count shows at 0
  too. The button is at least `--wt-tap-min` tall, keeps today's muted bold small capitals, and has
  the same focus ring as a dish. **Fill:** picture 03 draws each heading and the strip on a light
  grey band. The grey token, `--wt-color-surface-sunken`, fails here: today's muted heading text
  on it is 4.34 : 1 in light, under AA's 4.5 for this small text, and in dark it is the page's own
  colour, `#101216` (`packages/ui-core/src/tokens/colors.css:10`, `:13`, `:142`, `:146`, `:149`;
  ratio ran with the WCAG formula over those values). So the band is the cards' own fill and
  outline, `--wt-color-surface` with a 1 px `--wt-color-border` and `--wt-radius-md`: muted text on
  it is 6.13 : 1 light, 7.07 : 1 dark (ran, the same formula), and it reads as a band beside the
  page as the cards do. **Not `wt-disclosure`:** that folds a body
  downward under a heading row with a 900 ms height transition and holds its own `open`
  (`docs/developers/design-system.md:826`, `:610`); this column folds sideways into a strip and its
  state belongs to the screen's store. Its button follows the same `<button aria-expanded>`
  pattern. Nothing animates, so reduced motion needs nothing.
- **D10. The board's layout becomes a wrapping flex row**: `.kanban { display: flex; flex-wrap: wrap;
  align-items: stretch }`, an open column `flex: 1 1 11rem`, a collapsed one
  `flex: 0 0 var(--wt-tap-min)`. **`11rem` is today's value moved**, from the grid's `minmax(11rem,
  1fr)` (`:109`) to the flex basis, not a new `rem` (CLAUDE.md §3's token rule); no `--wt-*` token
  names a column's minimum width (ran: `grep -n -- "--wt-[a-z-]*:" packages/ui-core/src/tokens/structure.css`
  lists modal, form, field, cell and stepper widths only), so replacing it is left out of this
  slice. A grid of `auto-fit` columns cannot
  give one column a narrow width. **The probe (ran)** made this change with nothing collapsed and
  every station suite passed (below). Below about 1000 px slice 9c replaces the columns with tabs;
  until then a collapsed column at 390 px is a strip in the wrapped row, and the LOOK records it.
- **D11. The widget stays a pure view; the screen owns the layout.** `till-station-queue` gains
  `columns: ColumnState` (default `STATION_COLUMNS`) and sends `toggle-column` `{ key }`
  (`bubbles: true, composed: true`; an app-owned widget names its own events plainly, CLAUDE.md
  §3) without changing anything itself. `till-station-screen` stops the event, applies
  `toggleColumnCollapsed`, keeps the result, saves it, and redraws. The event carries no station:
  each of the screen's two `<till-station-queue>` tags binds its own handler,
  `@toggle-column=${(event: Event) => this.#onToggleColumn(event, id)}` — `#queue`'s tag
  (`:1064`) with `station.id`, `#mergedBody`'s (`:885`) with none. The screen builds its scope from
  `.deviceId` and `.serverOrigin` (D12), and keeps one `Map` of layouts keyed by D2's storage key
  (or `memory|${stationId ?? ""}` with no scope), filled **once per key, the first time that
  station's board is drawn**, never re-read on a 15-second refresh (A773-2: "Never reset layout on
  polling"). It reaches `localStorage` through one helper, `#deviceStorage(): Storage | null`, with
  the getter inside a `try` as `#rememberedMerged` has it (`:305-313`), so a browser that refuses
  storage altogether keeps layouts in memory.
- **D12. The screen builds its own scope; the app hands it one string.** Both mounts already pass
  `.deviceId` (`till-app.ts:18574`, `:18777`). The screen gains `serverOrigin?: string`; the app
  passes `.serverOrigin=${this.#serverOrigin()}`, a new helper returning `this.router?.current ??
  location.origin`, which `#floorViewChoices` (`:5980`) and `#zoneMenuIdentity` (`:5997`) also call
  in place of their own copies, so the app gains no new branch. The screen's scope is `{ venueId:
  serverOrigin, deviceId, screen: "station", stationId }`, and with no `deviceId` or no
  `serverOrigin` (empty counts as none, CLAUDE.md §3) it keeps layouts in memory only, as
  `#rememberedMerged` keeps nothing without a device (`:306-313`). A screen mounted alone in a test
  passes no origin, so no existing station suite starts writing to the test browser's
  `localStorage`.
- **D13. No new words.** The heading is today's `station.state.*` ("Waiting" «Esperando",
  "Preparing" «Preparando», "Ready" «Listo», `strings.ts:679-681`, `:2433-2435`), a number and a
  " · "; the collapse is said by `aria-expanded`. No string is added or removed, in either language.
- **D14. A collapsed column holding a late card shows no mark in slice 9.** The header line's
  "1 late" (slice 8, D9) still counts it, and design §3.3 asks for heading and count only. Slice 9c
  gives a narrow tab with a late card a red bar (design §3.4); whether a collapsed column should
  carry the same bar is an **owner question** (the closing step asks it), because a cook who
  collapsed Waiting no longer sees a forgotten card pulse.
- **D15. What A773-2 builds on.** It reuses `kitchen-columns.ts` as its Task 7b says ("Reuse lane
  C's released Columns controller"), adds `held` to `STATION_COLUMNS`, builds the pass's and
  monitor's scopes with the `storageScope` its pass reads return, and its Task 7b tests that need
  the corner's Columns (show/hide, up/down, hidden-all) are slice 9b's or its own. Its one
  difference from this module is D3's placement of a missing key; and a missing key takes its
  default `hidden` and `collapsed` (D3), which matters when the pass ships without Overview and
  slice 12b adds it hidden by default. **Venue in the key:** the station screen names the venue by
  the server's origin (D5); A773-2's pass uses the location id its pass read returns. The two
  cannot collide, because the screen kind (`"station"` against `"pass"` or `"pass_monitor"`) is in
  every key.

### Changed test checks (from the probe; the implementer confirms each)

**Probe (ran):** D6, D9 and D10 crudely in the widget (`probe.diff`): the board drawn from a
`columns` property in its order, each heading a button holding `.column-title` and
`.column-count`, a collapsed column drawn without cards, the flex row. Free memory 82 % (ran
`memory_pressure`). In `apps/till`, `pnpm typecheck` → exit 0 (`tsc1.txt`), and
`pnpm exec vitest run src/widgets/station-queue src/screens/till-station-screen src/screens/kitchen-allergy src/screens/text-size.layout`:
before, `Test Files 10 passed (10)`, `Tests 581 passed (581)` (`base1.txt`); with the probe, the
same, `Tests 581 passed (581)` (`run1.txt`). **Control (ran):** the same probe with Ready collapsed
by default → `Test Files 3 failed | 7 passed (10)`, `Tests 20 failed | 561 passed (581)`
(`run2-control.txt`), so these suites do read the columns' contents and a collapse they did not ask
for is seen.

**So no existing check changes.** The probe did not run the till app's suites (`src/till-app`,
40 files at slice 8's count); Task 4's run judges them, and any failure there is a STOP.

**Fixture-only:** none expected.

Any other failure, in any suite a task names, is a STOP.

### Review focus (inputs the spec implies and today's tests may not pin)

1. **A stored layout from a later version or a hand-edited value** (wrong `version`, `order` a
   string, a key repeated, an unknown key, a registered key missing): sanitised as D3 says, never
   a thrown error (Task 1).
2. **Storage that throws** on read and on write: the column still collapses and reopens for as
   long as the screen is open (D4, D11; Tasks 1, 3).
3. **Two stations stacked on one kitchen display, then merged, then stacked again:** each stacked
   station keeps its own collapsed columns and the merged board its own (D5; Task 3).
4. **A 15-second refresh** after a collapse: the column stays collapsed and storage is not read
   again (D11; Task 3).
5. **The till's Station screen, switching station with the picker:** each station's layout
   (D5; Task 3).
6. **A device with no `deviceId`**, a screen with no `serverOrigin` or an empty one, and a browser
   whose `localStorage` getter throws: nothing written to storage, the collapse still works (D2,
   D11, D12; Tasks 1, 3).
7. **Reordered columns** (a stored order with Ready first): the board follows it, and a dish's
   state word still follows kitchen order (D6, D8; Task 2).
8. **Keyboard:** Tab reaches each heading; Enter and Space collapse and reopen; the focus ring
   shows; `aria-expanded` follows (D9; Tasks 2, 6).
9. **Dark theme, Spanish («Listo · 3»), 1280, 1024 and 390 px:** the strip, its top-to-bottom
   heading and its count (D9, D10; Task 6).
10. **A collapsed column holding a forgotten card:** nothing pulses in view; the header line still
    says "1 late" (D14; Task 6).

---

**Task order and why.** The pure store first (Task 1), so the widget and screen read a real
module; the widget draws the stored order and collapse (Task 2); the screen keeps and saves each
station's layout (Task 3); the app hands it the server's origin (Task 4); the docs (Task 5); the
LOOK (Task 6). Each leaves the tree green and is sized well under 100 tool calls.

### Task 1: The columns store, in one pure module

**Files:**
- Create: `apps/till/src/state/kitchen-columns.ts` (D1–D4, D6's `STATION_COLUMNS`)
- Test: `apps/till/src/state/kitchen-columns.test.ts`

- [ ] **Step 1: Failing tests**, in one `describe("A773 columns state: the device's kitchen
  columns")` (A773-2's Task 7b runs `-t 'A773 columns state'`, plan `:292`, so its run finds these),
  each with a `Map`-backed fake storage (`getItem`/`setItem` spies) and a scope
  `{ venueId: "https://box.local", deviceId: "dev-1", screen: "station", stationId: "st-1" }`:
  1. "reads the defaults when nothing is stored" — `STATION_COLUMNS`, equal and not the same
     object.
  2. "keeps a saved layout for its venue, device, screen and station only" — save Ready collapsed,
     read it back equal; the same read with each of `venueId`, `deviceId`, `screen` (`"pass"`) and
     `stationId` (`"st-2"`) changed → defaults; `stationId` absent and `""` read one layout.
  3. "stores under the versioned key, as JSON" — the one `setItem` key is
     `waitron.kitchenColumns.v1.["https://box.local","dev-1","station","st-1"]` and its value parses
     to `{ version: 1, order, hidden, collapsed }`.
  4. "never reads or writes without a venue and a device" — `venueId: ""`, then `deviceId: ""`:
     neither spy called, defaults read.
  5. "reads the defaults for a value it cannot trust" — `it.each` over `"not json"`, `"null"`,
     `"[]"`, `{ version: 2, … }`, `{ version: 1, order: "ready", hidden: [], collapsed: [] }`,
     `{ version: 1, order: [1], hidden: [], collapsed: [] }`, and one missing `collapsed`.
  6. "drops unknown and repeated keys, and puts back a missing one at its default place" — with
     defaults order `["overview", "waiting", "preparing", "ready"]` (a case's own, as 9c will
     register), stored order `["ready", "waiting", "ready", "toFire"]`, hidden
     `["ready", "held", "ready"]`, collapsed `["waiting", "nonsense"]` → order
     `["overview", "ready", "waiting", "preparing"]`, hidden `["ready"]`, collapsed `["waiting"]`
     (D3: Overview has no key before it, so first; Preparing goes after Waiting).
  7. "a store that throws reads the defaults and saves nothing, without throwing" — `getItem` and
     `setItem` each throwing.
  8. "moves a column one place up or down, never past either end" — middle up and down; first up
     and last down return a state equal to the input; an unregistered key changes nothing; the
     input is not changed (check a frozen copy).
  9. "collapses a column and opens it again" — `toggleColumnCollapsed` twice; `hidden` and
     `order` untouched.
  10. "hides a column and shows it again" — `setColumnVisible(…, false)` then `true`; hiding twice
      leaves one entry.
  11. "puts back several missing columns each after the one before it" (D3's placement over the
      order built so far) — defaults order `["overview", "held", "waiting", "preparing", "ready"]`,
      stored order `["ready", "waiting", "preparing"]` → `["overview", "held", "ready", "waiting",
      "preparing"]` (Held goes after the Overview just put back).
  12. "a column put back takes its default hidden and collapsed; a stored one keeps its own" (D3's
      state) — defaults order `["overview", "held", "waiting"]` with `hidden: ["overview"]`, stored
      order `["held", "waiting"]` with `hidden: []` → `hidden` is `["overview"]`; and with
      `defaults.collapsed: ["waiting"]` and stored `collapsed: []`, Waiting (stored) stays open.
- [ ] **Step 2: Run; expect FAIL** (the module does not exist) `pnpm --filter @waitron/till exec vitest run src/state/kitchen-columns.test.ts`
  (memory first: `memory_pressure | grep free`).
- [ ] **Step 3: Implement** D1–D4. Every function returns new arrays; `JSON.parse` inside a `try`.
- [ ] **Step 4: Run; expect PASS** (read the `Tests` count: every case above).
- [ ] **Step 5:** `pnpm --filter @waitron/till typecheck`; `pnpm exec eslint apps/till/src/state/kitchen-columns.ts apps/till/src/state/kitchen-columns.test.ts`;
  `pnpm format:check`; ledger; `git commit -s -m "A797-9: one store for each kitchen screen's columns on the device"`

### Task 2: The board draws the device's column order and collapsed columns

**Files:**
- Modify: `apps/till/src/widgets/station-queue.ts` (`columns: ColumnState` property, default
  `STATION_COLUMNS`; `#board` maps `columns.order` to the states it can draw (D6) and draws each
  heading per D9, a collapsed column without cards; `toggle-column` `{ key }` on a heading tap
  (D11); icons `column-open`, `column-closed` in the widget's `registerIcons` call; styles per D9
  and D10 with `--wt-*` tokens only; `COLUMNS` stays for `#stateWord`, D8)
- Test: `apps/till/src/widgets/station-queue.test.ts` (a `describe("the board's columns")`, its
  builders as the "the board's cards" describe's, `:2639-2677`), `apps/till/src/widgets/station-queue.a11y.test.ts`

- [ ] **Step 1: Failing tests:**
  1. "draws the columns in the order it is given" — `columns.order` `["ready", "waiting",
     "preparing"]` → the `[data-column]` sections read `["ready", "queued", "preparing"]`.
  2. "leaves out the columns it cannot draw yet" — order `["overview", "held", "waiting",
     "preparing", "ready"]` → three sections.
  3. "each heading names its column and counts its cards" — two cards in Waiting (one held, slice
     8's D3), none in Preparing: `[data-column-count]` reads "2" and "0"; `.column-title` still reads
     exactly `t("station.state.queued")`.
  4. "a collapsed column keeps its heading and count and draws no cards" — `collapsed: ["ready"]`
     with one Ready card: no `[data-card]` in `[data-column="ready"]`, its flattened heading reads
     `` `${t("station.state.ready")} · 1` ``, its button `aria-expanded="false"`, the others `"true"`;
     and `page.getByRole("button", { name: "Ready 1" })` finds it (D9: a real space between name
     and count, the " · " hidden), open and collapsed.
  5. "tapping a heading asks for its column to collapse or open, and changes nothing itself" —
     `userEvent.click` on Ready's `[data-column-toggle]` → one `toggle-column` `{ key: "ready" }`,
     the cards still drawn; with Ready collapsed, a click sends the same and it stays collapsed.
  6. "Enter and Space on a focused heading ask the same, and the focus stays on it" — focus Ready's
     button; `userEvent.keyboard("{Enter}")` → one `toggle-column`; the test then sets `columns` to
     the collapsed state as the screen would and awaits `updateComplete`: the widget's
     `shadowRoot.activeElement` is still Ready's `[data-column-toggle]` (D9: one button template);
     then `userEvent.keyboard(" ")` → a second `toggle-column`.
  7. "a collapsed column is a narrow strip with its heading top to bottom" — at 1280 px (the
     layout suite's `page.viewport`), set `--wt-tap-min: 44px` on the widget: Ready's section is
     44 px wide, its button's computed `writing-mode` is `vertical-rl`, and Waiting is wider than
     Ready.
  8. "a dish ahead of its card still says its state when Ready is drawn first" — Review focus 7:
     order `["ready", "waiting", "preparing"]`; the first `[data-column]` is `ready`, and the
     Preparing dish on a Waiting card reads "Preparing". The state-word half is a guard that would
     pass before the change (today's order is fixed); the order half fails before it.
  9. a11y, in `station-queue.a11y.test.ts`'s both-theme `describe`: "a board with a collapsed column
     has no violations" (`reducedMotion: true`, a fixed `now`).
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/till exec vitest run src/widgets/station-queue.test.ts src/widgets/station-queue.a11y.test.ts`.
- [ ] **Step 3: Implement** D6, D8–D10. No `rem` or `em` added (`11rem` is today's value, D10).
- [ ] **Step 4: Run; expect PASS**, then the probe's command
  `pnpm --filter @waitron/till exec vitest run src/widgets/station-queue src/screens/till-station-screen src/screens/kitchen-allergy src/screens/text-size.layout`
  → every test passes, `Tests` = 581 plus this task's new cases, the a11y case counting twice
  (it runs once per theme, `station-queue.a11y.test.ts:402`), so 581 + 8 + 2 (the probe's base,
  `base1.txt`). A
  failure is a STOP (the probe changed no check), then
  `pnpm exec vitest run scripts/style-token-names.test.ts scripts/primary-coloured-text.test.ts` from
  the root.
- [ ] **Step 5:** typecheck till; eslint the changed files; `pnpm format:check`; ledger;
  `git commit -s -m "A797-9: a kitchen column's heading shows its count and collapses it"`

### Task 3: The station screen keeps each station's columns on the device

**Files:**
- Modify: `apps/till/src/screens/till-station-screen.ts` (`serverOrigin?: string` property, D12;
  the scope built from it and `deviceId`; `#deviceStorage()` per D11; the layouts `Map` and
  `#columnsFor(stationId?: string)`; `#onToggleColumn(event, stationId?)`: `stopPropagation`,
  `toggleColumnCollapsed`, keep, `saveColumnState` when there is a scope and a storage,
  `requestUpdate`. On the two `<till-station-queue>` tags only: `#queue`'s (`:1064`) gets
  `.columns=${this.#columnsFor(station.id)}` and `@toggle-column=${(event: Event) =>
  this.#onToggleColumn(event, station.id)}`; `#mergedBody`'s (`:885`) the same with no station.
  The screen's section binding (`#renderQueueSurface`) is not touched)
- Test: `apps/till/src/screens/till-station-screen.test.ts`. Cases 1, 2 and 5–8 in a new
  `describe("the device's kitchen columns")` (its `afterEach` removes every `localStorage` key
  starting `waitron.kitchenColumns.`, as the merged-view describe removes its keys, `:1595-1599`).
  **Case 3 goes inside the merged-view describe** (`:1594`), which owns `twoStations` (`:1605`) and
  `mountFor`, and **case 4 inside the 15-second refresh describe** (`:2548`), which owns the fake
  timers (`:2551-2556`), each with the same `afterEach` clean-up added there; or copy the fixtures
  into the new describe. Either way the `-t` filter below must match them, so each of those two
  case names also starts "the device's kitchen columns:".

- [ ] **Step 1: Failing tests** (`deviceId: "dev-1"` and `serverOrigin: "https://box.local"` unless a
  case says otherwise; collapse by clicking the widget's `[data-column-toggle="ready"]`):
  1. "a collapsed column stays collapsed when the screen opens again" — operator mode: collapse
     Ready, remove the screen, mount another with the same scope → Ready collapsed; the stored key
     is D2's with `"st-1"`.
  2. "each station picked on the till keeps its own columns" — collapse Ready on st-1, pick st-2
     (`[data-station="st-2"]`): Ready open; back to st-1: collapsed.
  3. "a kitchen display keeps each stacked station's columns, and the merged board's apart" —
     device mode, two stations (the merged-view describe's `twoStations`, `:1605-1618`): collapse
     Ready in st-1's section only; merge (`[data-merge-toggle]`): Ready open; collapse Waiting
     there; unmerge: st-1's Ready collapsed, st-2's open, Waiting open in both.
  4. "a refresh keeps the collapse and does not read the store again" — under the 15-second
     refresh describe's fake timers (`:2551-2556`): collapse, advance 15 s, flush: still collapsed;
     a `vi.spyOn(Storage.prototype, "getItem")` counting `waitron.kitchenColumns.` keys sees no
     further read.
  5. "with no origin or no device it collapses for this screen only and stores nothing" — once with
     no `serverOrigin`, once with `serverOrigin: ""`, once with no `deviceId`: collapse works; no
     `waitron.kitchenColumns.` key in `localStorage`.
  6. "a store that refuses still collapses" — `Storage.prototype.setItem` throwing (restored after):
     Ready collapses, no `[role=alert]`.
  7. "a browser that refuses storage altogether still collapses" — the pattern at
     `till-app-boot-and-counter.test.ts:1245-1251`: keep `Object.getOwnPropertyDescriptor(globalThis,
     "localStorage")`, `Object.defineProperty(globalThis, "localStorage", { configurable: true,
     get() { throw new DOMException("blocked", "SecurityError"); } })`, mount and collapse Ready
     (it collapses, nothing thrown), and restore the descriptor in `finally`. This reaches
     `#deviceStorage()`'s `catch` (D11).
  8. "the column tap stops at the screen" — as "the event stops at the screen" does (`:4990`):
     a listener above the screen never sees `toggle-column`.
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/till exec vitest run src/screens/till-station-screen.test.ts -t "the device's kitchen columns"`.
- [ ] **Step 3: Implement** D5, D11.
- [ ] **Step 4: Run; expect PASS**, then the whole file, and
  `pnpm --filter @waitron/till exec vitest run src/screens/till-station-screen.a11y.test.ts src/screens/till-expo-screen.test.ts src/screens/device-screens.phone-margin.test.ts src/widgets/pressed-pickers.a11y.test.ts`
  (the other suites that mount the station screen or its widget), and Task 2's Step 4 command
  (read each `Tests` count; a failure is a STOP).
- [ ] **Step 5:** typecheck till; eslint; `pnpm format:check`; ledger;
  `git commit -s -m "A797-9: a kitchen screen remembers each station's collapsed columns on the device"`

### Task 4: The till app hands both kitchen screens the server's origin

**Files:**
- Modify: `apps/till/src/till-app.ts` (`#serverOrigin(): string`, returning `this.router?.current ??
  location.origin`, beside `#floorViewChoices`; `#floorViewChoices` (`:5980`) and
  `#zoneMenuIdentity` (`:5997`) call it in place of their own copies; `.serverOrigin=${this.#serverOrigin()}`
  on both `<till-station-screen>` mounts, `:18567-18574` and `:18768-18777`, beside their
  `.deviceId`; D12. No other branch is added)
- Test: `apps/till/src/till-app-boot-and-counter.test.ts` (beside the kitchen display boot case
  that finds `till-station-screen`, "keeps an enrolled station screen on its station board",
  `:347-385`), `apps/till/src/till-app.test.ts` (with its `station(el)` helper, `:577-582`)

- [ ] **Step 1: Failing tests** (both names contain "columns scope", which Step 2's filter reads):
  1. "a kitchen display's station screen gets its columns scope: this box and this device" — the
     display boot (`deviceId: "station-device"`): the screen's `serverOrigin` is `location.origin`
     (the test app's router answers the page's own origin; if it answers another, compare with
     `el.router.current`) and its `deviceId` is `"station-device"`.
  2. "the till's Station screen gets the till's own columns scope" — open the Station drill as an
     existing `till-app.test.ts` case does (find it with `grep -n 'station(el)' src/till-app.test.ts`):
     its `serverOrigin` is the same origin and its `deviceId` the till's device id.
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/till exec vitest run src/till-app-boot-and-counter.test.ts src/till-app.test.ts -t "columns scope"`.
- [ ] **Step 3: Implement** D12. The floor's and the zone menu's existing suites cover the helper's
  callers unchanged (Step 4).
- [ ] **Step 4: Run; expect PASS**, then `pnpm --filter @waitron/till exec vitest run src/till-app`
  (memory first; at slice 8's probe `Tests 4393 passed (4393)` over 40 files; a new failure is a
  STOP: the probe did not run these).
- [ ] **Step 5:** typecheck till; eslint; `pnpm format:check`; ledger;
  `git commit -s -m "A797-9: the till app tells a kitchen screen which box its columns belong to"`

### Task 5: Docs, the user guides and the backlog follow the code

**Files:**
- Modify: `apps/server/src/guide/en/kitchen-service.md` (`## Work the kitchen screen
  {#kitchen-screen}`, `:120-135`), `apps/server/src/guide/es/kitchen-service.md` (the same section,
  `:137-156`), `docs/developers/design-system.md` (`### The kitchen screen's cards`, `:5471`: a
  paragraph on the headings and collapse), `docs/backlog.md` (the A797 entry, `:120-140`),
  `docs/backlog/till.md` (A797's entry, `:1032-1062`), this plan's slice 9b outline (one sentence:
  9b wires `moveColumn` and `setColumnVisible` from `kitchen-columns.ts` and draws `hidden`, D7),
  `docs/superpowers/specs/2026-10-18-a797-device-screens-design.md` (§3.3's collapse bullet: a dated
  pointer)
- Test: `apps/server/src/guide-content.test.ts`, `scripts/guide-links.test.ts`

- [ ] **Step 1: Guides.** English, two sentences after the paragraph's column sentence: tap a
  column's heading to collapse it to a narrow strip that keeps its name and how many cards it holds
  ("**Ready · 3**"); tap it again to open it; the screen remembers which columns are collapsed,
  for each station, even after it restarts. Spanish the same, with «Listo · 3» (read the column
  words from `strings.ts`'s `es` block, `:2433-2435`, before writing); Spanish only in the Spanish
  file.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and
  `pnpm exec vitest run scripts/guide-links.test.ts`; PASS.
- [ ] **Step 3: design-system.md**, one paragraph in "The kitchen screen's cards": the columns are
  drawn in the device's stored order (`readColumnState`, `apps/till/src/state/kitchen-columns.ts`,
  key and scope per D2 and D5); each heading is a `<button aria-expanded>` with the name and the
  count of cards; a collapsed column draws no cards and is a `--wt-tap-min` strip with its heading
  top to bottom; the kitchen-state order, not the drawn order, decides a dish's state word.
- [ ] **Step 4: Backlog.** Both A797 entries: slice 9 (the kitchen screen's columns collapse by
  their heading and are remembered on the device; the one Columns store A773-2 reuses) in review;
  next, slices 9b and 9c. After the merge, a docs-only commit on `main` says "landed in #N". Open no
  new entry unless the LOOK finds something this slice does not fix (its number from
  `~/waitron-campaign-shared/next-item-number`: read it, use it, write the next back).
- [ ] **Step 5: Design file**, after §3.3's "Tap a column's heading" bullet: "_2026-10-27, slice 9:
  the heading shows the column's count of cards open and collapsed; collapsed columns are kept per
  station on the device, the merged board apart; a collapsed column holding a late card has no
  mark of its own yet; see the build plan's slice 9, D5, D9, D14._"
- [ ] **Step 6: Check** `pnpm exec prettier --file-info docs/backlog.md` prints `"ignored": true`
  (wrap by hand); `pnpm format:check` for the guide files.
- [ ] **Step 7: Commit** `git commit -s -m "docs: A797-9 — guides, design system and backlog for collapsing kitchen columns"`

### Task 6 (visual): LOOK at collapsed and open columns

Dispatched as one subagent, not an implementer (it changes no code), with `run_in_background:
false`, as slice 8's LOOK was run (its scripts: `/Users/clintongormley/waitron-campaign-c/a797-8-scripts/`).
It writes its report to `/Users/clintongormley/waitron-campaign-c/a797-9-look-report.md`.

- [ ] **Step 1: Start the stack** `wa-wt demo waitron-feat-a797-9-columns-controller`; `wa-wt ls` for
  the URLs. Enrol one browser context as a kitchen display showing the demo's kitchen station
  screen, and one till context signed in, as slice 8's LOOK did. Make food so every column holds a
  card, one of them late (slice 8's LOOK Step 2: lower the station's Waiting, Overdue and
  Forgotten after to 1, 2 and 3 minutes, noting the values first and putting them back after).
- [ ] **Step 2: Look** with the workspace's Playwright Chromium (the script in
  `/Users/clintongormley/waitron-campaign-c/a797-9-scripts/`, never in the worktree, its process id
  recorded), at **1280 px** and **1024 px** on the kitchen display and **390 px** on the till's
  Station screen, **light and dark**, **English and Spanish**:
  - every column open: each heading's name, count and chevron;
  - Ready collapsed: the strip, "› Ready · N" top to bottom («Listo · N»), the other columns wider;
  - Waiting collapsed with a late card in it: the header line still says "1 late" (D14);
  - **reload the page**: what was collapsed is still collapsed; a 15-second refresh changes nothing;
  - keyboard: Tab to a heading, the focus ring, Enter collapses and opens;
  - with reduced motion asked for: nothing moves on collapse;
  - a two-station display stacked, then merged (if the demo allows one), each with its own collapsed
    columns;
  - set the 1280 px light English picture with Ready collapsed beside picture 03
    (`docs/backlog/mockups/a797-device-screens/03-kitchen-screen.png`) and describe each difference
    in the report: Overview, Held, the corner's Columns, the one-row header and m:ss timers are
    expected (later slices; slice 8 D6, D9); anything else about the headings, the counts or the
    strip is a finding.
- [ ] **Step 3: Save** each picture as a PNG under `/Users/clintongormley/waitron-campaign-c/a797-9-shots/`
  (`<step>-<width>-<theme>-<lang>.png`), open each, and describe what was seen in the report, the
  ledger and the PR body. Put back every demo setting changed.
- [ ] **Step 4: Stop** what you started: the script's process by its recorded id, then
  `wa-wt down waitron-feat-a797-9-columns-controller`.

### Closing slice 9

- Focused runs per task as above; CI runs the till's package suites and coverage (and the
  server's for the guides). Read the `changes` job's outputs and the till's coverage or merge job
  on the current head before calling the PR green. Code this slice leaves unreached is deleted,
  never excluded (Global constraints).
- `/finish-branch` with this plan named. Review path **LIGHT**: the plan-against-spec read and one
  Codex run-it review.
- PR body. First line: no venue reset. Then: **What a cook sees** (the count in each heading; tap a
  heading to collapse it to a strip and again to open it; remembered per station on the device);
  **What A773-2 reuses** (`kitchen-columns.ts`, its five functions, D1, D15); **Decisions** D1–D15
  in one line each; **Changed test checks** (none, with the probe's receipt); **LOOK**.
- **Owner question** (lane C's questions file, with a worked example and the strip's picture from
  the LOOK): D14 — should a collapsed column holding a late card carry a red bar, as slice 9c's
  narrow tabs will? Recommended: yes, the same rule as the tabs, built in 9c with them.
- **Owner FYI** (one line each in the PR and the questions file): D5 (layouts kept per station on
  the device, the merged board apart; a failover box starts from the defaults); D7 (nothing can hide
  a column until 9b).
- In lane C's questions file, one line for lane G: slice 9 holds `station-queue.ts` and
  `till-station-screen.ts` until it lands; `apps/till/src/state/kitchen-columns.ts` is the Columns
  controller A773-2's Task 7b reuses, with one difference from its contract text, D3 (a missing
  key goes back to its default place, not to the end, with its default hidden and collapsed); the
  station key names the venue by the server's origin while A773-2's pass uses the location id, and
  the two cannot collide because the screen kind is in every key (D15).
- After merge: delete the branch local and remote and check the remote one is gone; the backlog's
  "landed in #N" commit; update the ledger; then slice 9b or 9c, in turn with lane G.

---

## Slice 9b — The corner Columns panel (one PR, branch `feat/a797-9b-columns-panel`)

**Built inline.** This item runs under the inline-coding trial: the lead session writes every build
task's code itself, test first; no implementer is dispatched, and where Global constraints say "each
implementer runs", the lead runs it.

**What it changes.** On a kitchen screen (a kitchen display, or the till's Station screen) **each
board gets one header row**: the station's name, its Open/Closed-for-today control, the line "6
dishes to make · 1 late", and at the row's end a **Columns** button («Columnas») (which of the
station's parts each board's row holds, and where: D1). Columns opens a
window titled "Columns" with the board's name under it, one row per column in the board's order:
its number, its name, ↑ (named "Move up Ready", «Subir Listo») and ↓ ("Move down Ready", «Bajar
Listo»), and a **Show** switch («Mostrar»). Each tap changes the board behind the window at once
and is kept on the device, in slice 9's store; **Done** closes the window. A column whose Show is
off is not drawn on the board; every column may be hidden, and the header row with its Columns
still shows (design §3.3, §3.6's Device row, picture 07, worked example 4: "The head chef set the column
order once, in corner → Columns"). Overview (9c), Held (A773-2) and the pass's Other stations'
dishes (A773-2) are not built here.

**Review path: LIGHT.** No server read, route, schema or shared type changes: the layout stays in
the device's browser (design §5: "Columns … are kept in the device's browser … Nothing on the
server"). The changed files are under `apps/till/src/`, the guides and the docs. `till-app.ts` is
not touched: both screen mounts already pass `.deviceId` and `.serverOrigin`
(`apps/till/src/till-app.ts:18578-18579`, `:18782-18783`, read). None of the risk triggers
applies. **Migration: none.** No venue reset.

How claims are marked in this section: **(ran)** means run on 2026-10-27 against `main` at
`ea91470e9` (this worktree's base); **(read)** means read in the code at that commit. The probe
ran in a throwaway worktree (`git worktree add --detach /tmp/a797-9b-probe.ahFs/wt ea91470e9`),
removed afterwards; its diff and logs are in `/Users/clintongormley/waitron-campaign-c/a797-9b-probe/`
(`probe.diff`, `control.diff`, `base1.txt`, `tsc1.txt`, `run1.txt`, `run2-control.txt`,
`run3-others.txt`). None of the probe code is in this branch.

### The turn with lane G's A773-2 (ran)

`gh pr list --state open` at 08:27 → two open pull requests, #2131 (A1098, the recovery page) and
#2130 (A918 slice 2, setup's staff language); there were none at 08:13 when this slice was briefed.
`gh pr diff <n> --name-only | grep -E 'station-queue|till-station-screen|till-app\.ts|kitchen-service|kitchen-columns|i18n/strings|design-system|backlog'`
→ #2130: `docs/backlog.md`, `docs/backlog/architecture.md`, `docs/backlog/english-only-audit.md`;
#2131: `docs/backlog.md`, `docs/backlog/setup.md`, `docs/developers/design-system.md`. Neither
touches code; both touch docs Task 4 edits, so whichever lands second may meet a small conflict in
`docs/backlog.md` or `design-system.md`. `grep -n A773-2 ~/waitron-campaign-g/queue.md` →
nothing (exit 1). `git ls-remote origin | grep -i a773` → only old `refs/pull/*` heads, no branch.
`git grep -ln kitchen-columns -- 'apps/*.ts'` outside tests → `station-queue.ts` and
`till-station-screen.ts` only. So slice 9b takes the turn on `station-queue.ts` and
`till-station-screen.ts`, and leaves `till-expo-screen.ts` alone. The closing step posts one line
for lane G. **Check again** (`gh pr list --state open`, and the same `grep`) before the first
commit and before `/finish-branch`.

### Every reader and writer this slice touches (ran: grep; each line read)

From `git grep -n "<till-station-queue\|<till-station-screen\|<till-station-today" -- 'apps/*.ts'`
(ran: two queue tags and two today tags in the screen, two screen mounts in the app, nothing else
outside tests), `git grep -ln kitchen-columns -- 'apps/*.ts'` (ran) and `git grep -rln draftScopeFor
apps/till/src` (ran), each line read:

| Where | What it does today | In this slice |
| --- | --- | --- |
| `apps/till/src/widgets/station-queue.ts:775-777` `render` | notices, then `#queue` | the header row first, then notices, then the queue (D1) |
| same file `:779-785` `#queue` | with no groups, only "No orders" (`.empty`); otherwise `#header` then `#board` | `#header` moves into the header row, which is drawn with no groups too (D1) |
| same file `:762-773` `#header` | "5 dishes to make · 1 late" over every card, on the widget's `TickingClock` | unchanged; drawn inside the header row; still counts every card, hidden and collapsed columns included (D3) |
| same file `:71-75` `DRAWN`, `:956-997` `#board` | draws each key of `columns.order` it can draw | also skips a key in `columns.hidden` (D3); `DRAWN` also feeds a new export, `stationColumnNames()` (D4) |
| same file `:663` `columns`, `:949-954` `#toggleColumn` | the layout the screen hands down; a heading tap only asks (`toggle-column`) | unchanged; the precedent for the new `open-columns` (D8) |
| `apps/till/src/state/kitchen-columns.ts:112-143` `moveColumn`, `setColumnVisible` | built and tested by slice 9, no caller | their first callers (D2, D8) |
| same file `:17-21` `STATION_COLUMNS` | Waiting, Preparing, Ready, nothing hidden or collapsed | read; a new test pins that every key it registers is one the board draws (D4) |
| `apps/till/src/screens/till-station-screen.ts:337-362` `#columnsFor`, `#onToggleColumn` | reads each board's layout once; a heading tap toggles, keeps, saves | the keep-and-save step becomes one helper the toggle, a move and a show share (D8) |
| same file `:898-913` `#renderDevice` | one station: `#today(only)` then `#queue`, **no station name drawn** | the name and today's control go into that board's header row (D1) |
| same file `:984-1000` `#deviceSection` | stacked: `h2.station-name`, today's control, the queue; a station still drawn while unavailable: its notice line, today's control, the queue | the name and today's control go into the board's header row; the unavailable notice stays above it (D1) |
| same file `:916-953` `#mergedBody` | one `section[data-station-controls]` per available station (name and today's control), then one merged queue | unchanged above; the merged board's header row holds the counts and Columns only (D1) |
| same file `:1089-1112` `#body` (the till) | the station picker, today's control, the queue | today's control goes into the board's header row (D1) |
| same file `:1114-1134` `#queue` | draws the station's printer-down lines (`#printersDown`, `:1123`) **before** the `<till-station-queue>` tag, which it mounts with `.columns` and `@toggle-column` | slots the name and today's control into `lead` and the printer-down lines into `status` (D1); gains the board's name and `@open-columns` (D7, D8) |
| same file `:1148-1160` `#pick` | the till's station picker, one button per station, named by the station | read: where the till shows the picked station's name (D1) |
| same file `:533-546` `#adoptDeviceStation`, `:276-282` the `UrlStateController`, `:484-486` the refreshed station list | a device read replaces `deviceStations`; a URL change restores the till's station; a refreshed list that lost the picked station restores another | each can take away the board a Columns window edits (D9) |
| same file `:852-868` `#renderMoveDialog`, `:871-874` `render`, `:307-319` `willUpdate` | the screen draws its own Move dialog, and closes it when `api`, `deviceMode` or `deviceId` changes | the Columns window is drawn the same way and closed in the same `willUpdate` (D9) |
| `apps/till/src/widgets/station-today.ts:222-281` | a status sentence ("Open", "Closed for today → Pass") and a button; needs a manager PIN on a kitchen display | unchanged; slotted into the header row (D1) |
| `apps/till/src/widgets/till-shell.ts:1121-1123`, `:398` `.language-corner` | on a kitchen display, theme and language in a row of their own above the screen | unchanged (D1) |
| `apps/till/src/widgets/equipment-dialog.ts:319-321`, `:539-541` | each equipment choice sent as `equipment-change` when made; one Close; no draft scope (not in the `draftScopeFor` list) | the precedent the window follows (D2) |
| `apps/till/src/widgets/device-zones-dialog.ts` (slice 4) | a staged choice with Cancel and Save, a draft scope and `device-zones-dialog.unsaved.test.ts`, because the server can refuse its save | the precedent the window does not follow, and why (D2) |
| `packages/ui-core/src/components/wt-button.ts:14-17` | `wt-button` delegates `.focus()` on its host to its inner button | read: the window's opener is the Columns `wt-button` itself (D8) |
| `packages/ui/src/components/wt-switch.ts:113-122`, `:143-170` | the switch primitive: `label` drawn after the control, `accessible-name`, `disabled`, `description` read to assistive technology | the Show switch (D5, D10) |
| `apps/dashboard/src/screens/device-profiles-screen.ts:1806-1823` | a profile's printers: a switch per printer, then Move up and Move down named "Move up <printer>", disabled at the ends | the precedent for the arrows' names and ends (D6) |
| `apps/till/src/i18n/strings.ts` en `:679-681`, es `:2433-2435` `station.state.*`; en `:947`, `:1307`, `:1662` / es `:2690`, `:3043`, `:3394` "Done" «Hecho»; en `:799` / es `:2545` "Chosen on this device" | the column names; Done; the equipment note | read; reused words (D5) |
| `docs/superpowers/plans/2026-10-19-a773-2-firing-and-pass.md:101` | A773-2's Columns contract | read: "Order/show/hide belong to corner Columns settings with up/down, no drag; heading tap toggles collapse and retains heading/count; narrow tabs/list use the same order/visibility/collapse. Columns remain reachable even if every content column is hidden." (D3) |

### Plan decisions for slice 9b

- **D1. One header row per board, drawn by the queue widget, with the screen's parts slotted in.**
  `till-station-queue` draws `<div class="board-head" data-board-head>` first: a
  `<slot name="lead">`, then today's counts line (`#header`, unchanged), then a `wt-button`
  **Columns** (`data-columns-open`, secondary) at the row's end (`margin-inline-start: auto`); a
  flex row that wraps (`--wt-space-3` gap), so at 390 px the parts fall onto a second line rather
  than overflow. After the row, and before the notices and the board, a second slot,
  `<slot name="status">`, takes the screen's printer-down lines: `#queue` draws them before the
  queue tag today (`:1123`), so once the name moves into the widget they would otherwise sit above
  the station's name. The row is drawn with no groups too, so an empty
  board still offers Columns; the counts line is absent while both counts are nothing, as today
  (`:766`). The screen slots into `lead`: on a kitchen display, the station's
  `<h2 class="station-name">` and its `till-station-today`, for one station (**the name is new
  there**: today a one-station display draws no name, `:909`; picture 03 names it, "Grill") and for
  each stacked station; for a station drawn while unavailable, its today's control (its notice line
  above the board already names it, `:995-996`); on the till's Station screen, today's control (the
  picked station's name is on its picker button, `#pick`, `:1148-1160`). The screen slots each
  board's printer-down lines into `status`. **The merged board's row** holds the
  counts and Columns only, no station (**owner FYI**); the per-station name-and-control sections
  and the merged view's printer-down lines above it stay as they are (`:925-941`), because one row
  cannot hold several stations' controls. **Why slotted, not moved
  out** (the brief's leaning moved the counts line into a screen-drawn row): the line's late count
  is aged on the widget's own `TickingClock` (`:667`, `:765`), so a screen-drawn line would need a
  second clock re-rendering the whole screen every tick, and the line's existing checks (the
  "dishes-to-make line" describe, `station-queue.test.ts:3242`) would all move suites; slotting
  keeps the line, its clock and its tests where they are and changes only where the screen's
  existing parts sit. **The shell's corner stays where it is** (`till-shell.ts:1121-1123`): picture
  03's one row (name, chip, counts, then "?", theme, language and Columns) cannot be built for a
  stacked display, which has several boards and one corner, without the shell learning about
  stations or each board drawing its own theme and language choosers. So on a kitchen display the
  corner (theme, language) is a row above the boards and Columns sits at each board's own row:
  **owner FYI**. **Today's control is unchanged**: it is today's status sentence and button
  (`station-today.ts:225-237`), not picture 03's green chip; restyling it is not this slice's.
- **D2. Each tap applies and is kept at once; Done only closes; no draft scope.** Picture 07 has one
  button, Done, and no Cancel. The window holds no staged input: a move or a show is applied to the
  board and saved to `localStorage` when tapped, as slice 9's heading tap is (`#onToggleColumn`,
  `:352-362`). That is the house contract for a control that saves as it is used: "Read-only and
  automatically saved forms need no draft scope" (`docs/developers/design-system.md:3123`) and
  "immediately saved controls … remain exempt" (`:3143-3144`); the till's nearest such precedent is
  the equipment dialog, which sends each choice as it is made and has one Close and no draft scope
  (`equipment-dialog.ts:319-321`, `:539-541`; absent from `git grep -rln draftScopeFor
  apps/till/src`, ran); a theme pick likewise "applies at once and never asks about unsaved work"
  (`design-system.md:5344`). The slice 4 precedent, Zones on this device, stages its choice behind
  Save with a draft scope because its save goes to the server and can be refused under a field
  (`device-zones-dialog.ts`, `save-device-zones`); a browser write cannot be refused that way (a
  refused store is swallowed and the layout kept in memory, slice 9 D4). **So the window takes no
  draft scope and has no `*.unsaved.test.ts`**; the slice 9b outline's "a new dialog with staged
  input takes a draft scope" applies only to staged input. **Done**, **Escape** and the browser's
  close each close the window and change nothing, because nothing is waiting; the board already
  shows every change. **No ×** is drawn: `wt-dialog` draws none, and no till `wt-dialog` adds one
  (Done and Escape close it, as the equipment dialog's Close does): **owner FYI** against picture 07.
- **D3. A hidden column is not drawn, and every column may be hidden.** `#board` skips a key in
  `columns.hidden`, and draws no section, heading or card for it. A773-2's contract allows hiding
  them all: "Order/show/hide belong to corner Columns settings with up/down, no drag; heading tap
  toggles collapse and retains heading/count; narrow tabs/list use the same order/visibility/collapse.
  Columns remain reachable even if every content column is hidden." (A773-2 plan `:101`). So every
  Show switch stays enabled, and **a board with every column hidden** draws no column but still
  draws its header row, its counts line and its Columns, so a tap brings a column back. The header
  line still counts a hidden column's cards (it counts every card on the queue, `:763-772`), so a
  late card in a hidden Waiting still reads "· 1 late": **owner FYI**, beside slice 9 D14's open
  question about collapsed columns. A hidden column keeps its collapsed mark; shown again, it comes
  back collapsed.
- **D4. The window lists the columns this board can draw, in the layout's order.** The widget
  exports `stationColumnNames(): Map<ColumnKey, string>`, built from `DRAWN` (`:71-75`) with each
  state's `station.state.*` word, so it holds Waiting, Preparing and Ready today. The screen hands
  the window the board's layout and these names; the window lists `layout.order` filtered to the
  keys the names hold. A later key (9c's `overview`, A773-2's `held`) appears in the window, in its
  stored place, the day its slice adds it to `STATION_COLUMNS` and `DRAWN` with its name, with no
  change to the window. **A move swaps a column with its neighbour in `order`** (`moveColumn`,
  `kitchen-columns.ts:112-124`), so a registered key the board cannot draw would make a move look
  like nothing happened; a new test pins that every key `STATION_COLUMNS` registers is a key
  `stationColumnNames()` names (Task 1), so a slice that registers a key without drawing it fails
  there. **The rule for what is built, stated once for D3 and D4:** Global constraints delete code
  no test reaches; beyond that, this slice adds no screen-side guard against a state no product
  path creates. The window's name filter is kept although on the
  station screen today no product path hands it an unnamed key (D4's test pins that): the window
  is a component taking any layout, A773-2's pass may hand it one (Closing), and its case 1 reaches
  the filter, so it is reached code, not a guard.
- **D5. Words: four settled, two reused, none new.** Settled (design §10 (g)): **Columns**
  «Columnas» (the button and the window's heading), **Move up** «Subir», **Move down** «Bajar»,
  **Show** «Mostrar». Reused, each as a new key holding words the till already shows: **Done**
  «Hecho» (`floor.step_done`, `make_now.dismiss`, `cancel_credit.done_action`, en `:947`, `:1307`,
  `:1662`, es `:2690`, `:3043`, `:3394`; not `find_page.done`'s «Listo», es `:2371`, which on a
  kitchen screen would read as the Ready column), and the note under the list, **Chosen on this
  device** «Elegido en este dispositivo» (`equipment.chosen_here`, en `:799`, es `:2545`), in place
  of picture 07's "Kept on this screen", which is a new phrase for the same fact. **Left out:**
  picture 07's section label "Order and show": the station window
  has one section, so the label names nothing the heading does not (A773-2's pass window, with its
  Other stations' dishes section, may want it); **owner FYI**. The board's name in the window is a
  station name, not a word (D7). Keys, all under `station.`: `columns`, `columns_move_up`,
  `columns_move_down`, `columns_show`, `columns_done`, `columns_kept`, en and es in
  `apps/till/src/i18n/strings.ts` only.
- **D6. The arrows and the switch are named for their column; the focus stays on the moved row.**
  Each ↑ and ↓ is an icon-only `wt-button` (`aria-label` forwarded to its inner button,
  `design-system.md:2226-2233`) with `aria-label` "Move up Ready" / "Move down Ready" («Subir
  Listo», «Bajar Listo»): the action then the column, as the dashboard's printer list names its
  "Move up <printer>" (`device-profiles-screen.ts:1811`) and slice 4's zones dialog its "Show
  <zone>" (`device-zones-dialog.ts`); its arrow is a decorative `wt-icon` (`column-up`,
  `column-down`, registered by the window's module), so no drawn text can fail label-in-name. The
  switch: `label` "Show", `accessible-name` "Show Ready" («Mostrar Listo»), which begins with the
  drawn word. ↑ is disabled on the first row and ↓ on the last (picture 07). **After a move** the
  focus goes to the moved row's same arrow, or, when that arrow is now disabled (the row reached an
  end), to the row's other arrow: the window records the key and direction on the tap and moves
  the focus in `updated()` once the screen hands back the new layout, rather than trusting the
  focus to survive Lit re-ordering the rows (not measured; Task 2's case 5 is the check either
  way). The rows are an
  `<ol>`; the drawn number is `aria-hidden`, the list giving the position.
- **D7. The window names its board.** `wt-dialog`'s `heading` is "Columns" and its `description`
  (drawn under the heading, not beside it as picture 07 has "Columns Grill", and read as the
  dialog's description; **owner FYI**) the board's name: the station's
  name for one station, a stacked station or the till's picked station; for the merged board, the
  drawn stations' names joined by `Intl.ListFormat(currentLocale(), { type: "conjunction" })`
  ("Cocina and Barra", «Cocina y Barra»; **owner FYI**), as the late-send window joins its periods
  (`apps/till/src/widgets/late-send-dialog.ts:55`). On the till's Station screen, Columns sits in
  the picked station's header row and its window names that station (**owner FYI**: picture 07
  shows the kitchen display only).
- **D8. The window is a pure view; the screen applies and keeps.** `till-kitchen-columns-dialog`
  (`apps/till/src/widgets/kitchen-columns-dialog.ts`) takes `layout: ColumnState`,
  `names: ReadonlyMap<ColumnKey, string>`, `boardName: string` and `opener: HTMLElement | null`,
  and has no `open` property: the screen draws it only while it is open (its inner `wt-dialog`
  is `.open=${true}`), and removes it on `close`. It sends `column-move` `{ key, direction }`, `column-show`
  `{ key, visible }` and `close` (each `bubbles: true, composed: true`; an app-owned component
  names its events plainly, CLAUDE.md §3), changing nothing itself; it stops each `wt-switch`'s
  `wt-change` before sending `column-show`. The queue widget's Columns sends `open-columns` with
  `detail: { opener }`, the opener being its own `[data-columns-open]` `wt-button`, which delegates
  `.focus()` to its inner button (`packages/ui-core/src/components/wt-button.ts:14-17`, read); the
  event's first `composedPath()` entry seen at the screen is the widget host, on which focus fails
  (the review measured it in Chromium). The screen binds `@open-columns` on each
  `<till-station-queue>` tag with that board's station id (none for the merged board) and name, as
  it binds `@toggle-column` (slice 9 D11); stops it; records `{ stationId, boardName, opener }`, so
  `wt-dialog` hands the focus back to Columns on close (`design-system.md:841`, `opener`); and draws the window from `render()` beside the Move dialog.
  On `column-move` and `column-show` it stops the event, applies `moveColumn` or
  `setColumnVisible` to `#columnsFor(stationId)`, and keeps and saves the result through the one
  helper slice 9's toggle now also uses; the board and the window redraw from the same layout.
  `.layout` is re-read from `#columnsFor` on every render, so the window and its board can never
  disagree. The window reads the screen's language through `LocaleChangeController`, as the zones
  dialog does.
- **D9. While the window is open.** A 15-second refresh changes neither the window nor the layout
  (the layout is never re-read, slice 9 D11). A change of `api`, `deviceMode` or `deviceId` closes
  it in `willUpdate` (`:307-319`), the first `deviceId` arriving included, because the scope it
  edits is gone; the Move dialog's reset there still waits for a previous value. **It also closes when its board is no longer drawn**, checked each time the screen
  redraws: on a kitchen display, its station gone from or no longer drawing on the device's read
  (`#adoptDeviceStation`, `:533-546`, after a 15-second refresh or any reload), or the merged
  board gone; on the till, the picked station changing by any path (a URL change through the
  `UrlStateController`, `:276-282`, such as Back; a refreshed list that no longer holds it,
  `:484-486`). The window is modal (`wt-dialog` opens with `showModal()`,
  `wt-dialog.ts:287`, read), so the page behind it takes no taps: the merge toggle and the till's
  station picker cannot be pressed while it is open.
- **D10. Departures from picture 07, each an owner FYI:** no × (D2); the board's name under
  "Columns", not beside it (D7); the switch's word "Show" is
  drawn after the switch, where `wt-switch` puts its label (`wt-switch.ts:161`), not before it; no
  "Order and show" label and "Chosen on this device" for "Kept on this screen" (D5). Overview's
  second line ("Counts each dish to make") is slice 9c's.

### Changed test checks (from the probe; the lead confirms each)

**Probe (ran):** D1 and D3 crudely (`probe.diff`): the widget draws the header row (a
`slot name="lead"`, the counts line, a plain `<button data-columns-open>Columns</button>`) before
the notices and draws it with no groups; the board skips a hidden key; the screen slots a one-station
display's and each stacked station's `h2.station-name` and `till-station-today`, and the till's
`till-station-today`, into the lead slot. Free memory 82 % (ran `memory_pressure`). In
`apps/till`, `pnpm typecheck` → exit 0 (`tsc1.txt`). `pnpm exec vitest run src/widgets/station-queue
src/screens/till-station-screen src/screens/kitchen-allergy src/screens/text-size.layout`: before,
`Test Files 10 passed (10)`, `Tests 601 passed (601)` (`base1.txt`); with the probe,
`Test Files 1 failed | 9 passed (10)`, `Tests 4 failed | 597 passed (601)` (`run1.txt`).
**Control (ran):** the probe plus `STATION_COLUMNS.hidden: ["ready"]` (`control.diff`) →
`Tests 37 failed | 564 passed (601)` (`run2-control.txt`), so these suites see a hidden column; with
nothing hidden by default, the skip itself changes no check. **The other suites that mount the
station screen or the app around it (ran, with the probe):** `pnpm exec vitest run
src/screens/till-expo-screen src/screens/device-screens.phone-margin src/widgets/pressed-pickers.a11y
src/screens/till-counter-screen src/till-app-boot-and-counter src/till-app-parties
src/till-app-setup-refresh src/till-app.test.ts` → `Test Files 20 passed (20)`,
`Tests 2497 passed (2497)` (`run3-others.txt`). The probe drew a plain `<button>` where the build
draws a `wt-button`; `git grep -n 'querySelector("wt-button")'` over the station suites (ran) finds
only a query inside a card's row (`station-queue.kitchen-note.test.ts:131`), which the header row
does not reach.

**The four checks that change** (all in `apps/till/src/screens/till-station-screen.test.ts`, all
in Task 3):

1. `:1364` "one station renders as it does today: no section and no station heading" asserts no
   `h2`. D1 names a one-station display's station in its header row (picture 03). New check: no
   `[data-device-station]` section, and exactly one `h2.station-name`, slotted `lead` into the
   queue widget, reading the station's name. Renamed "one station renders without a section, its
   name in its board's header row". This rewritten check is Task 3's first failing test; no
   separate case repeats it.
2. `:4212` "shows the selected station status above its queue" asserts today's control precedes
   the queue widget in document order (`DOCUMENT_POSITION_FOLLOWING`). D1 slots it into the
   widget, so the widget now contains it. New check: the control's parent is the queue widget and
   its `slot` is `"lead"` (the header row is drawn above the board, which Task 1's order case pins).
3. and 4. `:4381-4392` (an `it.each`'s two variants) "renders device status above its queue (cold boot answer: false|true)",
   the same assertion on a kitchen display, the same change.

**Fixture-only:** none expected. Any other failure, in any suite a task names, is a STOP.

### Review focus (inputs the spec implies and today's tests may not pin)

1. **The header row** on a one-station display, two stacked stations, a station drawn while
   unavailable, the merged board, the till's Station screen, and an empty board: who holds a name,
   who holds today's control, and Columns on every one (D1; Tasks 1, 3).
2. **A move and a show apply at once** to that board only, and survive the screen opening again;
   the merged board's layout stays apart from each station's (D2, D8; Task 3).
3. **Every column hidden:** the header row and its Columns stay, and a tap brings a column back
   (D3; Tasks 1, 2).
4. **Focus:** after ↓ on the first row the focus stays on that row's ↓; at the last row, on its ↑;
   after Done or Escape, back on Columns (D6, D8; Tasks 2, 3).
9. **The window's board taken away** by a device read, a merge, Back on the till or a refreshed
   station list: the window closes (D9; Task 3).
10. **A printer-down line** sits under its station's header row, not above its name (D1; Task 3).
5. **A hidden column holding a late card:** the header line still says "1 late" (D3; Tasks 1, 5).
6. **Refresh and reset while open:** a 15-second refresh keeps the window and the layout; a device
   change closes it (D9; Task 3).
7. **Names:** "Move up Ready", "Show Ready", and the Spanish «Subir Listo», «Mostrar Listo»; the
   merged board's window names both stations (D6, D7; Tasks 2, 3).
8. **Dark theme, Spanish, 1280, 1024 and 390 px:** the header row's wrap, the window's rows (Task 5).

---

**Task order and why.** The widget's header row and hidden columns first (Task 1), so the window's
column names exist; the window (Task 2), a pure view tested alone; the screen joins them (Task 3);
the docs (Task 4); the LOOK (Task 5). Each leaves the tree green and is a test-first unit well under
60 tool calls.

### Task 1: Each board has one header row with Columns, and a hidden column is not drawn

**Files:**
- Modify: `apps/till/src/widgets/station-queue.ts` (D1: the header row, drawn first and with no
  groups, its `lead` slot, `#header` inside it, the Columns `wt-button` sending `open-columns`
  `{ opener }` (D8), then the `status` slot; D3:
  `#board` skips `columns.hidden`; D4: export `stationColumnNames()`; styles with `--wt-*` tokens
  only), `apps/till/src/i18n/strings.ts` (`station.columns` "Columns" / «Columnas»)
- Test: `apps/till/src/widgets/station-queue.test.ts` (a new `describe("the board's header row and
  hidden columns")`, with "the board's columns" describe's builders, `:3749-3800`),
  `apps/till/src/widgets/station-queue.a11y.test.ts` (inside the both-theme describe, `:402`)

- [ ] **Step 1: Failing tests** (each name contains "the board's header row", which Step 2's
  filter reads):
  1. "the board's header row comes first: the lead slot, the counts line, then Columns" — with a
     notice and one late card: `[data-board-head]`'s children in order are `slot[name="lead"]`,
     `[data-kitchen-counts]`, `[data-columns-open]`; then, in the shadow root's order,
     `[data-board-head]`, `slot[name="status"]`, `.notices`, `.kanban`.
  2. "the board's header row: an empty board still offers Columns and no counts" — `groups: []`:
     `[data-columns-open]` present, no `[data-kitchen-counts]`, `.empty` reads `t("station.empty")`.
  3. "the board's header row: Columns asks to open the window and changes nothing itself" —
     `userEvent.click` → one `open-columns`, `bubbles` and `composed`, whose `detail.opener` is the
     widget's `[data-columns-open]` element; `columns` unchanged.
  4. "the board's header row: a hidden column is not drawn, and the line still counts its late
     card" — `hidden: ["waiting"]`, a late card in Waiting: no `[data-column="queued"]`, two
     sections, the card's `[data-card]` absent; `[data-kitchen-counts]` ends "· 1 late".
  5. "the board's header row: every column hidden draws no column and keeps Columns" — all three
     hidden: no `[data-column]`, `[data-columns-open]` present.
  6. "the board's header row: the station registers only columns the board draws" —
     `STATION_COLUMNS.order.every((key) => stationColumnNames().has(key))`, and the names read
     `t("station.state.queued")`, `…preparing`, `…ready` for `waiting`, `preparing`, `ready` (D4).
  7. "the board's header row: Columns reads «Columnas» in Spanish" — `setLocale("es-ES")`, restored
     in `finally` (CLAUDE.md §4), as `:163-181` does.
  8. a11y: "the board's header row with a hidden column has no violations" (`reducedMotion: true`,
     a fixed `now`), once per theme.
- [ ] **Step 2: Run; expect FAIL.** First add an empty stub, `export function
  stationColumnNames(): Map<ColumnKey, string> { return new Map(); }`, so the test file still loads
  (an import of a missing export stops the whole file, and every case in it, from running); then
  `pnpm --filter @waitron/till exec vitest run src/widgets/station-queue.test.ts src/widgets/station-queue.a11y.test.ts -t "the board's header row"`
  (memory first: `memory_pressure | grep free`): every new case fails on its assertion.
- [ ] **Step 3: Implement** D1 (the widget's half), D3, D4. No `rem` or `em` added.
- [ ] **Step 4: Run; expect PASS** (8 cases, the a11y one twice: `Tests 9 passed`), then the probe's
  command `pnpm --filter @waitron/till exec vitest run src/widgets/station-queue src/screens/till-station-screen src/screens/kitchen-allergy src/screens/text-size.layout`
  → `Tests 610 passed (610)` (601, `base1.txt`, plus 9). The screen is not changed yet, so the four
  checks above still pass here; a failure is a STOP. Then, from the root,
  `pnpm exec vitest run scripts/style-token-names.test.ts scripts/primary-coloured-text.test.ts`.
- [ ] **Step 5:** `pnpm --filter @waitron/till typecheck`; `pnpm exec eslint` on the changed files;
  `pnpm format:check`; ledger; `git commit -s -m "A797-9b: each kitchen board has one header row with Columns, and a hidden column is not drawn"`

### Task 2: The Columns window

**Files:**
- Create: `apps/till/src/widgets/kitchen-columns-dialog.ts` (D2–D8: a `wt-dialog` carrying
  `trackDialog()` and `.open=${true}` (the window has no `open` property of its own, D8), heading
  "Columns", `description` the board's name; an `<ol>` of rows, each the `aria-hidden` number, the
  name, ↑ and ↓ icon-only `wt-button`s, the `wt-switch`; under the list the muted "Chosen on this device"; in the footer a
  `wt-form-actions` holding one primary Done, which calls `closeAfter("saved")`; `wt-close` sends
  `close`; icons `column-up`, `column-down` registered by the module; `LocaleChangeController`;
  rows laid out with `--wt-*` tokens, the name column `minmax(0, 1fr)` so a long Spanish name wraps)
- Modify: `apps/till/src/i18n/strings.ts` (`station.columns_move_up` "Move up" «Subir»,
  `station.columns_move_down` "Move down" «Bajar», `station.columns_show` "Show" «Mostrar»,
  `station.columns_done` "Done" «Hecho», `station.columns_kept` "Chosen on this device" «Elegido en
  este dispositivo»)
- Test: `apps/till/src/widgets/kitchen-columns-dialog.test.ts`,
  `apps/till/src/widgets/kitchen-columns-dialog.a11y.test.ts` (as `device-zones-dialog.a11y.test.ts`
  is built, with its locale restore)

- [ ] **Step 1: Failing tests** (mounted with `boardName: "Grill"`, the names of
  Waiting, Preparing and Ready, and a layout unless a case says otherwise):
  1. "lists the columns it has names for, in the layout's order, numbered" — layout order
     `["ready", "overview", "waiting", "preparing"]` with no name for `overview` → three rows,
     numbers 1–3, names Ready, Waiting, Preparing.
  2. "is headed Columns, names its board, and says the choice stays on this device" — the
     dialog's accessible name "Columns", its description "Grill"; "Chosen on this device" drawn.
  3. "the first row cannot move up and the last cannot move down" — those two arrows disabled,
     the other four enabled.
  4. "an arrow asks to move its column and changes nothing itself" — ↓ on Ready → one
     `column-move` `{ key: "ready", direction: "down" }`; the rows' order unchanged until a new
     `layout` is set.
  5. "after a move the focus stays on the moved row's arrow, or its other arrow at an end" — focus
     and press Enter on the first row's ↓; set the moved layout and await `updateComplete`: the
     focused element is that column's ↓; press again, set the layout putting it last: the focus is
     on its ↑ (D6).
  6. `it.each` en / es: "each arrow and switch is named for its column (%s)" —
     `toHaveAccessibleName` "Move up Ready", "Move down Ready", "Show Ready"; «Subir Listo»,
     «Bajar Listo», «Mostrar Listo» (two tests).
  7. "a Show switch asks to hide or show its column, and its change stops at the window" —
     clicking Ready's switch → one `column-show` `{ key: "ready", visible: false }`; a listener
     above the window sees no `wt-change`; with `hidden: ["ready"]` the switch is unchecked and a
     click sends `visible: true`.
  8. "the last shown column can be hidden too" — `hidden: ["waiting", "preparing"]`: Ready's
     switch is enabled and a click sends `column-show` `{ key: "ready", visible: false }`; with all
     three hidden every switch is enabled and unchecked (D3).
  9. `it.each` Done / Escape: "%s closes the window and sends close once" (two tests).
  10. "reads «Columnas», «Hecho» and «Elegido en este dispositivo» in Spanish" — `setLocale("es-ES")`,
      restored in `finally`: the heading, Done and the note.
  11. a11y: "the Columns window, with a hidden column and both ends' arrows disabled, has no
      violations", once per theme.
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/till exec vitest run src/widgets/kitchen-columns-dialog`.
- [ ] **Step 3: Implement** D2–D8's window half. The window draws no native form field (CLAUDE.md
  §3): its arrows are `wt-button`s and its switch a `wt-switch`.
- [ ] **Step 4: Run; expect PASS**, `Tests 14 passed (14)` (cases 1–5, 7, 8 and 10 once, 6 and 9
  twice, 11 twice); then `pnpm --filter @waitron/till exec vitest run src/i18n` and, from the root,
  `pnpm exec vitest run scripts/native-form-fields.test.ts scripts/style-token-names.test.ts`.
- [ ] **Step 5:** typecheck till; eslint the changed files; `pnpm format:check`; ledger;
  `git commit -s -m "A797-9b: the Columns window moves a column up or down and shows or hides it, kept as you tap"`

### Task 3: The station screen opens each board's window and keeps its changes

**Files:**
- Modify: `apps/till/src/screens/till-station-screen.ts` (D1's slotting in `#renderDevice` `:909`,
  `#deviceSection` `:992-996` and `#body` `:1094-1102`; `#queue` slots the name and today's control
  into `lead` and its `#printersDown` lines into `status` (D1), and gains the board's name and
  `@open-columns`; `#mergedBody`'s tag gets `@open-columns` with the joined names
  (D7); a `@state()` for the open window, drawn from `render()` beside the Move dialog; the
  `column-move`, `column-show` and `close` handlers; one keep-and-save helper shared with
  `#onToggleColumn`; the `willUpdate` reset closes the window, and so does a redraw in which its board is no longer
  drawn, D9)
- Test: `apps/till/src/screens/till-station-screen.test.ts`. Every new name starts "the Columns
  window:". Where each case goes: **(M)** inside the merged-view describe (`:1624`), with its
  `twoStations` (`:1635-1644`: Cocina with an Epson printer down, Deli gone, Barra), `mountFor`
  (`:1646`) and `merge` (`:1664`); **(S)** inside "a station switched off on its own page"
  (`:1434`), with its `mountDevice` and `switchedOff` station; **(T)** a new describe beside "the
  device's kitchen columns" (`:5105`), with its `mountOperator` (`:5111`; stations Cocina, the
  default, and Barra, `:23-40`), `clearStoredColumns` and `BOX`; **(R)** inside the 15-second
  refresh describe (`:2615`), with its fake timers. Plus the four changed checks above.

- [ ] **Step 1: Failing tests:**
  1. The rewritten changed check 1 (`:1364`, "one station renders without a section, its name in
     its board's header row") is this task's first failing test.
  2. (M) "the Columns window: each stacked board's header row holds its own station; the merged
     board's holds none" — stacked: in each `[data-device-station]` section, its `h2.station-name`
     and `till-station-today` are children of that section's own queue widget with `slot="lead"`;
     merged: the merged queue widget has no `lead` children, and both `[data-station-controls]`
     sections remain.
  3. (S) "the Columns window: a station drawn while unavailable has only today's control in its
     header row" — Deli's queue widget's `lead` children are its `till-station-today` alone, no
     `h2`; its unavailable line still comes before the widget.
  4. (M) "the Columns window: Cocina's printer-down line follows its header row" — stacked:
     Cocina's `[data-printer-down]` is a `slot="status"` child of Cocina's queue widget (so the
     widget draws it after `[data-board-head]`, Task 1's case 1).
  5. (M) `it.each` over one station (`mountFor` with Cocina alone), the second stacked board and the
     merged board: "the Columns window: Columns opens the window named for its board (%s)" → the
     window's description reads "Cocina", "Barra", "Cocina and Barra" (three tests).
  6. (T) "the Columns window: on the till it is named for the picked station" — Columns in the
     operator screen's board → the description reads "Cocina".
  7. (T) "the Columns window: a move reorders that board at once and is kept on the device" — move
     Ready up: the widget's `columns.order` is `["waiting", "ready", "preparing"]` while the window
     is open; the stored value under slice 9's key holds that order; a new screen with the same
     scope draws it.
  8. (M) "the Columns window: hiding a column hides it on that board only, and showing it brings it
     back" — stacked: hide Ready on Cocina's board → its widget's `columns.hidden` is `["ready"]`,
     Barra's empty; merged, the merged board's own layout is untouched; show it again.
  9. (T) "the Columns window: its events stop at the screen" — a listener above the screen sees no
     `open-columns`, `column-move`, `column-show` or `close`.
  10. (T) "the Columns window: with no origin or device it still reorders, for this screen only" —
      no `waitron.kitchenColumns.` key in `localStorage` afterwards.
  11. (T) `it.each` Done / Escape: "the Columns window: %s puts the focus back on Columns" — the deep
      active element afterwards is inside the widget's `[data-columns-open]` (two tests).
  12. (T) "the Columns window: a device change closes it" — set a new `deviceId`: no
      `till-kitchen-columns-dialog` drawn.
  13. (R) "the Columns window: a refresh keeps the window open and the moves made" — move, advance
      15 s, flush: the window open, the order kept.
  14. (R) "the Columns window: a refresh that drops its station closes it" — device mode, two
      stations: open Barra's window; the next device read lists Cocina alone; advance 15 s, flush:
      no `till-kitchen-columns-dialog`.
  15. (T) "the Columns window: Back to another station closes it" — pick Barra, then Cocina (each
      writes the URL), open the window, `history.back()` and wait for the screen to restore Barra:
      no `till-kitchen-columns-dialog`.
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/till exec vitest run src/screens/till-station-screen.test.ts -t "the Columns window"`.
- [ ] **Step 3: Implement** D1's screen half, D7–D9; then edit the four changed checks as listed
  under "Changed test checks", and nothing else.
- [ ] **Step 4: Run; expect PASS** (17 new tests: cases 2–4 and 6–10, 12–15 once, 5 three times,
  11 twice; the rewritten check 1 counts among the four changed ones, not here), then the probe's
  command → `Tests 627 passed (627)` (610 after Task 1, plus 17); then the probe's other suites, `pnpm --filter @waitron/till exec vitest run src/screens/till-expo-screen src/screens/device-screens.phone-margin src/widgets/pressed-pickers.a11y src/screens/till-counter-screen src/till-app-boot-and-counter src/till-app-parties src/till-app-setup-refresh src/till-app.test.ts`
  → `Tests 2497 passed (2497)` (`run3-others.txt`), and `src/widgets/kitchen-columns-dialog` →
  14. Read each `Tests` count; a failure is a STOP.
- [ ] **Step 5:** typecheck till; eslint; `pnpm format:check`; ledger, with the four changed
  checks' names and reasons; `git commit -s -m "A797-9b: a kitchen screen's Columns opens its board's window and keeps each change on the device"`

### Task 4: Docs, the user guides and the backlog follow the code

**Files:**
- Modify: `apps/server/src/guide/en/kitchen-service.md` (`## Work the kitchen screen
  {#kitchen-screen}`, `:120-138`), `apps/server/src/guide/es/kitchen-service.md` (the same section,
  `:137-159`), `docs/developers/design-system.md` (`### The kitchen screen's cards`, `:5471-5517`),
  `docs/backlog.md` (the A797 entry, `:120-145`), `docs/backlog/till.md` (A797's entry,
  `:1034-1068`), `docs/superpowers/specs/2026-10-18-a797-device-screens-design.md` (§3.3, after the
  "Column order is not changed on the live screen" bullet, `:339-340`)
- Test: `apps/server/src/guide-content.test.ts`, `scripts/guide-links.test.ts`

- [ ] **Step 1: Guides.** English: replace "The line above the columns says how many dishes are
  still to make and how many cards are late." with the header row: the station's name, whether it
  is open today, how many dishes are still to make and how many cards are late, and **Columns**;
  then: tap **Columns** to move a column up or down with the arrows or turn its **Show** off; each
  change shows at once and stays on this device, for this station; with every column hidden,
  **Columns** is still there to bring one back. Spanish
  the same («Columnas», «Subir», «Bajar», «Mostrar»; read the `es` block's `station.*` words
  before writing); Spanish only in the Spanish file.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts`
  and `pnpm exec vitest run scripts/guide-links.test.ts`; PASS.
- [ ] **Step 3: design-system.md**, in "The kitchen screen's cards": the "line above the columns"
  sentence becomes the header row (D1: drawn by `till-station-queue` with a `lead` slot the screen
  fills, the counts line, Columns at its end, then a `status` slot for the printer-down lines; the
  merged board's row holds no station); replace
  "A layout's `hidden` list is stored but not yet drawn." with: a hidden column is not drawn and its
  cards still count in the header line; Columns opens `till-kitchen-columns-dialog`
  (`apps/till/src/widgets/kitchen-columns-dialog.ts`): one row per column the board draws, ↑ and ↓
  named "Move up <column>", a Show switch (every column may be hidden; the header row and Columns
  stay); each
  change applied and saved at once (`moveColumn`, `setColumnVisible`), so it takes no draft scope
  and has no `*.unsaved.test.ts`; Done and Escape only close.
- [ ] **Step 4: Backlog.** Both A797 entries: slice 9b (each kitchen board's header row with
  Columns; the Columns window to order and hide columns, kept on the device) in review; next, slice
  9c. After the merge, a docs-only commit on `main` says "landed in #N". Open no new entry unless
  the LOOK finds something this slice does not fix (its number from
  `~/waitron-campaign-shared/next-item-number`: read it, use it, write the next back).
- [ ] **Step 5: Design file**, after §3.3's "Column order is not changed on the live screen"
  bullet: "_2026-10-27, slice 9b: each board has its own header row, with Columns at its end; the
  corner keeps theme and language above the boards; a move or a Show tap applies at once and Done
  only closes; every column may be hidden and Columns stays; see the build plan's slice 9b,
  D1–D3._"
- [ ] **Step 6: Check** `pnpm exec prettier --file-info docs/backlog.md` prints `"ignored": true`
  (wrap by hand); `pnpm format:check` for the guide files.
- [ ] **Step 7: Commit** `git commit -s -m "docs: A797-9b — guides, design system and backlog for the kitchen screen's Columns"`

### Task 5 (visual): LOOK at the header row and the Columns window

Dispatched as one foreground subagent (`run_in_background: false`), not an implementer (it changes
no code), as slice 9's LOOK was run (its scripts: `/Users/clintongormley/waitron-campaign-c/a797-9-scripts/`).
It writes its report to `/Users/clintongormley/waitron-campaign-c/a797-9b-look-report.md`.

- [ ] **Step 1: Start the stack** `wa-wt demo waitron-feat-a797-9b-columns-panel`; `wa-wt ls` for
  the URLs. Enrol one browser context as a kitchen display showing the demo's kitchen station
  screen, and one till context signed in, as slice 9's LOOK did. Make food so every column holds a
  card, one of them late (slice 8's LOOK Step 2: lower the station's Waiting, Overdue and
  Forgotten after to 1, 2 and 3 minutes, noting the values first and putting them back after).
- [ ] **Step 2: Look** with the workspace's Playwright Chromium (the script in
  `/Users/clintongormley/waitron-campaign-c/a797-9b-scripts/`, never in the worktree, its process id
  recorded), at **1280 px** and **1024 px** on the kitchen display and **390 px** on the till's
  Station screen, **light and dark**, **English and Spanish**:
  - the header row: the name, today's control, the counts line and Columns on one row at 1280 and
    1024; how it wraps at 390;
  - the window open: the rows, the disabled ↑ and ↓ at the ends, the switches, the note, Done;
    «Columnas», «Subir», «Bajar», «Mostrar», «Hecho»;
  - Ready moved first: the board behind the window changes at once; **reload the page**: kept;
  - Waiting and Preparing hidden: the board draws Ready only; then Ready hidden too: no column, the
    header row and Columns still there, and Columns brings one back;
  - a printer down (if the demo can make one): its line under the station's header row;
  - Waiting hidden while it holds the late card: the header line still says "1 late" (D3);
  - keyboard: Tab to Columns, Enter opens, Tab through the arrows, Enter moves and the focus stays
    on the moved row (D6), Escape closes and the focus is back on Columns;
  - a two-station display stacked, then merged (if the demo allows one): each board's own row and
    window, the merged window naming both stations;
  - set the 1280 px light English pictures beside picture 03
    (`docs/backlog/mockups/a797-device-screens/03-kitchen-screen.png`) and the window beside picture
    07 (`07-columns-settings.png`), and describe each difference in the report: the corner on its own
    row, today's control not a chip, the merged board's row holding no station, Columns on the
    till's Station screen, no ×, the board's name under "Columns" rather than beside it, the merged
    window titled "Cocina and Barra" (or the demo's station names), "Show" after the switch, no
    "Order and show", "Chosen on this device", no Overview or Held are expected (D1, D2, D5, D7,
    D10; later slices); anything else is a finding.
- [ ] **Step 3: Save** each picture as a PNG under `/Users/clintongormley/waitron-campaign-c/a797-9b-shots/`
  (`<step>-<width>-<theme>-<lang>.png`), open each, and describe what was seen in the report, the
  ledger and the PR body. Put back every demo setting changed, and leave the device's columns as
  the demo had them (Waiting, Preparing, Ready, all shown).
- [ ] **Step 4: Stop** what you started: the script's process by its recorded id, then
  `wa-wt down waitron-feat-a797-9b-columns-panel`.

### Closing slice 9b

- Focused runs per task as above; CI runs the till's package suites and coverage (and the
  server's for the guides). Read the `changes` job's outputs and the till's coverage or merge job
  on the current head before calling the PR green. Code this slice leaves unreached is deleted,
  never excluded (Global constraints).
- `/finish-branch` with this plan named. Review path **LIGHT**: the plan-against-spec read and one
  Codex run-it review.
- PR body. First line: no venue reset. Then: **What a cook sees** (each board's header row with
  Columns; the window's arrows and Show switches, applied at once and kept on the device; every
  column may be hidden and Columns stays); **Decisions** D1–D10 in one line each; **Changed test
  checks** (the four above, with the probe's receipt); **New words** (none); **LOOK**.
- **Owner FYIs** (one line each in the PR and lane C's questions file): D1 (on a kitchen display
  the corner's theme and language stay in a row above the boards, and each board has its own
  header row with Columns, so picture 03's single row is two; a one-station display now shows its
  station's name; the merged board's row holds no station; today's control is still a sentence and
  a button, not a chip); D2 (each tap applies and is kept at once; Done only closes; no ×); D3
  (every column may be hidden, as A773-2's plan asks, and Columns stays; a hidden column's late
  card still counts in "1 late" and has no other mark, beside slice 9 D14's question); D5 (no new
  words; "Chosen on this device" in place of "Kept on this screen"; no "Order and show"); D7 (the
  board's name drawn under "Columns", not beside it; the merged window titled "Cocina and Barra";
  Columns also on the till's Station screen, which picture 07 does not show); D10 ("Show" drawn
  after the switch).
- **Owner questions:** none. D3's late card in a hidden column joins slice 9 D14's open question
  rather than asking a second one.
- In lane C's questions file, one line for lane G: slice 9b holds `station-queue.ts` and
  `till-station-screen.ts` until it lands; `apps/till/src/widgets/kitchen-columns-dialog.ts` takes a
  layout and a map of column names and sends `column-move`, `column-show` and `close`, so A773-2's
  pass can list its own columns in it; Other stations' dishes would be a second section the pass
  adds; every column may be hidden, as A773-2's contract asks (its plan `:101`), with Columns
  still reachable in the header row; a key added to `STATION_COLUMNS` must also be drawn and named
  (D4's test).
- After merge: delete the branch local and remote and check the remote one is gone; the backlog's
  "landed in #N" commit; update the ledger; then slice 9c, in turn with lane G.

---

## Slice 9c — Overview and the narrow tabs (one PR, branch `feat/a797-9c-overview-narrow-tabs`)

**What it changes.** On a kitchen screen (a kitchen display, or the till's Station screen) a new
first column, **Overview** («Resumen»), lists each dish waiting or being made with how many
("Secreto ibérico 1"), and after a + how many more are held ("+2"): what a grill cook reads to know
how many steaks to put on (design §3.3, picture 03). It is shown by default, collapses by its heading
like any column, and is listed in the Columns window, where it can be moved or hidden (slice 9b).
**Where the board is too narrow for its columns**, it shows one column at a time and the columns
become **tabs with counts** ("Waiting · 2"), in the board's chosen order, so Overview is the first
tab; a hidden column has no tab (design §3.4, picture 05). **A tab whose column holds a late card
carries a red bar**, and so, by the owner's answer to slice 9's D14, does a **collapsed column**
holding one. Underneath, slice 9c builds **the one counting function** A773-2's pass reuses for its
own Overview (design §5, §7; A773-2 plan `:96`, `:311`). The pass, its Overview and its narrow list
(slice 12, 12b) are not built here.

**Review path: LIGHT.** No server read, route, schema or shared type changes; the Overview counts
what the station read already sends, and the layout stays in the device's browser (design §5:
"**Overview** counts what the screen holds"; "Columns … Nothing on the server"). The changed files
are under `apps/till/src/`, the guides and the docs. `till-app.ts` and `till-station-screen.ts` are
not changed by product code (only test files around them). None of the risk triggers applies.
**Migration: none.** No venue reset.

How claims are marked in this section: **(ran)** means run on 2026-10-27 against `main` at
`c5b0ae414` (this worktree's base); **(read)** means read in the code at that commit. The probe ran
in a throwaway worktree (`git worktree add --detach /tmp/a797-9c-probe.bgOz/wt c5b0ae414`, `pnpm
install --frozen-lockfile`), removed afterwards with `git worktree remove`; its diffs, logs and the
contrast script are in `/Users/clintongormley/waitron-campaign-c/a797-9c-probe/` (`base1.txt`,
`run1-overview.txt` … `run8-fixture-control.txt`, `measure.txt`, `measure2.txt`, `measure3.txt`,
`probe-tabs.diff`, `probe-fits.diff`, `probe-final.diff`, `tab-bar-contrast.py`). None of the probe
code is in this branch.

### The turn with lane G's A773-2 (ran)

`git fetch origin --prune`, then for each origin branch other than `main`
(`feat/a1098-recovery-keep-or-move`, `feat/a918-3-venue-service-starters`,
`feat/invoice-pdf-email-office-printing`, `fix/a973-operator-script-english`, `printers`):
`git diff --name-only origin/main...origin/<branch> | grep -cE 'station-queue\.ts|till-station-screen\.ts|till-expo-screen\.ts|kitchen-columns\.ts'`
→ `0` for every one. `git ls-remote origin | grep -i a773` → only `refs/pull/{459,831,1546,1721}/head`,
no branch. `gh pr list --state open` → #2137 (A918 slice 3) and #2131 (A1098); `gh pr diff <n>
--name-only` → neither touches code this slice changes, but #2137 touches `docs/backlog.md`,
`docs/backlog/till.md` and `docs/developers/design-system.md`, and #2131 `docs/backlog.md` and
`design-system.md`, all of which Task 9 edits, so whichever lands second may meet a small docs
conflict. No lane queue holds A773-2's PRs B–D: `grep -n '^### .*A773' ~/waitron-campaign*/queue.md`
→ nothing; the files that mention "A773-2" (lanes A, B, C, F) mention it inside other items'
dependency text. The watcher's note in lane C's questions file (2026-10-27 ~07:52 CET): "Lane G
moved to Waitron Cloud on 2026-10-22, and no lane holds A773-2 now: its remaining PRs (B–D) sit in
`docs/backlog.md`'s A773-2 entry". So slice 9c takes the turn on `station-queue.ts`, edits no
`till-expo-screen.ts`, and puts its hand-off for A773-2 in that backlog entry (Task 9), addressed to
nobody. **Check again** (`gh pr list --state open`, the same `git diff` loop) before the first
commit and before `/finish-branch`.

### Every reader and writer this slice touches (ran: grep; each line read)

From `git grep -ln "kitchen-columns\|kitchen-cards" -- 'apps/*.ts'` outside tests (ran:
`till-station-screen.ts`, `kitchen-columns-dialog.ts`, `station-queue.ts`), `git grep -n
"thousandthsToMake\|lateCards\|STATION_COLUMNS\|stationColumnNames" -- 'apps/*.ts'` outside tests
(ran) and the probe's runs, each line read:

| Where | What it does today | In this slice |
| --- | --- | --- |
| `apps/till/src/state/kitchen-columns.ts:17-21` `STATION_COLUMNS` | Waiting, Preparing, Ready; nothing hidden or collapsed | order gains `overview` first (D5; Task 7) |
| same file `:48-78` `sanitise` | puts a registered key missing from a stored layout back at its default place, with its default hidden and collapsed state (slice 9 D3) | read, unchanged: a layout stored before Overview reads with Overview first, shown and open (D5) |
| `apps/till/src/state/kitchen-cards.ts:153-164` `thousandthsToMake` | sums fired Waiting and Preparing dishes in thousandths, a dish whose unit shows counting 1000 | uses the new `dishThousandths` (D1); same answers (Task 2) |
| same file `:166-176` `lateCards` | cards with a fired dish not Ready whose band is overdue or forgotten | read; also counted per column for the red bar (D10) |
| same file `:81-126` `kitchenCards` | the cards, oldest first | read; the Overview's input order (D3) |
| `apps/till/src/widgets/station-queue.ts:69` `COLUMNS`, `:71-75` `DRAWN`, `:80-87` `stationColumnNames` | the state order; the drawable keys; their names for the window | `stationColumnNames` also names `overview` (D5, D6; Task 4) |
| same file `:129-146` `.kanban`, `.column`, `.column.collapsed` | a wrapping flex row; open columns `flex: 1 1 11rem`; collapsed a `--wt-tap-min` strip | Overview `flex-grow: 0` on the same basis (D5) |
| same file `:162-185` `.column-toggle` | the heading button; collapsed, written top to bottom | collapsed with a late card, a red top bar (D10; Task 8) |
| same file `:685` `columns` | the layout the screen hands down | read; drives tabs as well as columns (D9) |
| same file `:785-795` `#header` | "5 dishes to make · 1 late" over every card | unchanged (D13) |
| same file `:797-812` `render` | header row, status slot, notices, then the board or "Nothing in the kitchen" | the board or, when the columns do not fit, the tabs and one column (D7–D9; Tasks 6a, 6b) |
| same file `:989-1027` `#board` | one section per drawable, shown key | also draws Overview (Task 4) |
| `apps/till/src/widgets/kitchen-columns-dialog.ts` | lists `layout.order` filtered to the names it is given | unchanged: lists Overview once `stationColumnNames` names it (slice 9b D4) |
| `apps/till/src/screens/till-station-screen.ts:360-370` `#columnsFor`, `:397` `.names=${stationColumnNames()}` | reads each board's layout once against `STATION_COLUMNS`; hands the window the names | unchanged product code (D12) |
| `apps/till/src/widgets/segmented-control-styles.ts:3-25` `segmentedOptionStyles`; `till-station-screen.ts:1232-1247` `#pick` | the till's pressed-picker look; the station picker, `<button aria-pressed>` with `.option` | the look and pattern the tabs reuse (D9) |
| `apps/till/src/screens/till-floor-screen.ts:450-487` zone tabs | a zone tab with a late table: tint plus an inset bottom bar in `--wt-color-danger` | the precedent for the red bar, drawn outside the fill instead (D10) |
| `apps/till/src/screens/till-table-order-screen.ts:161`, `:1467-1503` | `DRAFT_SIDE_BY_SIDE_MIN_WIDTH`; a `ResizeObserver` measuring a width | the precedent for switching layout on a measured width (D8) |
| `apps/till/src/widgets/test-helpers.ts:108` `DEFAULT_FRAME`, `:117-135` `pageAt`, `resetPage` | every till browser test starts at 414 × 896 | why the station suites take a wide frame (D11; Task 5) |
| `apps/till/src/i18n/strings.ts` en `:658-666`, `:685-687`; es `:2418-2426`, `:2445-2447` | `station.to_make`, `station.late`, `station.columns*`, `station.state.*` | read; new `station.overview`, `station.overview_held` (D6) |
| `docs/superpowers/plans/2026-10-19-a773-2-firing-and-pass.md:96`, `:101`, `:305`, `:311` | `OverviewFact = Pick<PassCardItem,"lineId"\|"stationId"\|"name"\|"qty"\|"phase"\|"informational">` "feed A797's Overview aggregator; do not build a second station totals algorithm"; "narrow tabs/list use the same order/visibility/collapse" | read: the interface D1 serves, and D9's one departure |

### Plan decisions for slice 9c

- **D1. One counting function, in one pure module the pass can call with its own facts.** New
  `apps/till/src/state/kitchen-overview.ts`, importing nothing from the station read:
  ```ts
  /** One dish for the Overview, in whatever read it came from. */
  export interface OverviewDish {
    /** The kitchen name the card shows; rows are one per name. */
    name: string;
    /** How much it counts, in thousandths of a dish: {@link dishThousandths}. */
    thousandths: number;
    /** "making": fired and Waiting or Preparing; "held": held, or fired and waiting for the pass. */
    stage: "making" | "held";
  }
  export interface OverviewRow { name: string; making: number; held: number } // thousandths
  /** A dish whose unit shows ("0.35 kg × Pulpo") counts as one; otherwise its quantity (slice 8, D9). */
  export function dishThousandths(quantity: string, unitName: Record<string, string> | null | undefined, soldInEach: boolean | undefined): number;
  export function overviewRows(dishes: Iterable<OverviewDish>): OverviewRow[];
  /** The rows with something to make: Overview's count (D4). */
  export function rowsToMake(rows: readonly OverviewRow[]): number;
  ```
  The caller decides what counts and leaves Ready and served dishes out. The station's adapter is
  `overviewDishes(cards: readonly KitchenCard[]): OverviewDish[]` in `kitchen-cards.ts` (fired and
  not Ready → `making`; `firedAt` null → `held`; Ready → left out), and `thousandthsToMake` sums
  through `dishThousandths` so the header line and Overview cannot disagree. **What A773-2 does with
  it** (Task 9's hand-off, in the A773-2 backlog entry): map each `OverviewFact` to an
  `OverviewDish` and call `overviewRows`; build no second aggregator (its plan `:96`, `:311`).
  Its `OverviewFact` has no `unitName` or `soldInEach` (plan `:96`, read), so a dish sold by weight
  would count by its weight; the hand-off says to add the two fields from `ExpoItem`
  (`apps/till/src/api/client.ts:1887-1890`, read). And once A773-2 gives station dishes a requested
  phase, `overviewDishes` counts them as `held`, because design §3.3 puts them in Held ("it must not
  start them").
- **D2. What Overview counts** (design §3.3, §3.8: "counts of dishes waiting or being made, held ones
  after a +"). One row per **kitchen name** (`StationQueueItem.name`, "the variant's own on a
  variant line", `client.ts:1546-1548`, read): a dish's options do not split its row, because the
  cook counts steaks, not their sauces. **Making** is every fired dish Waiting or Preparing,
  **held** every dish with `firedAt` null, Ready dishes not at all: picture 03's scene reads
  "Secreto ibérico 1 +2" with one secreto Waiting (T9) and two in a held card (T4), "Chuletón 0 +1"
  for T7's held chuletón, and nothing from the collapsed Ready column. A dish whose unit shows
  counts as one and fractions stay exact, as the header line's "dishes to make" (slice 8, D9). On a
  merged board the rows run across its stations by name, since a merged board is one board (slice 9,
  D5): **owner FYI**.
- **D3. Row order.** Rows with something to make first, then rows that are only held; within each,
  in the order the dish's name first appears in the input, a held dish counting as an appearance
  (A held, B making, A making → A, then B). The station passes the cards oldest first
  (`kitchenCards`' order, held-only cards after every timed one, `kitchen-cards.ts:121-124`, read),
  each card's dishes in the order it draws them. So the row of the dish that has waited longest
  leads, a row keeps its place across refreshes while its card does, and a held-only row comes
  last, as picture 03 draws Chuletón. With picture 03's ages (T2 19:40, the oldest; T5 7:30; T9
  2:10; T4 and T7 held) the rule gives Entrecot, Hamburguesa, Patatas, Secreto, Chuletón, where
  picture 03 draws Secreto, Entrecot, Patatas, Hamburguesa, Chuletón, which follows no rule I could
  find (read); **owner FYI**. `overviewRows` keeps its input's first-appearance order and only
  splits the two groups, so the pass passes its own order.
- **D4. Overview's count is its rows with something to make.** Picture 05 tabs the same scene as
  picture 03 (Held · 2, Waiting · 2, Preparing · 1, Ready · 2, "6 to make · 1 late") and labels it
  "Overview · 4", where picture 03 draws five rows, one of them held only (Chuletón 0 +1). Slice 9's
  heading carries a count for every column (its D9), so Overview's heading shows the same number,
  though picture 03 draws none there: **owner FYI**.
- **D5. Overview is a column like the others, first and shown.** Design §3.3: "Overview (first …)
  Shown by default on a kitchen screen". `STATION_COLUMNS.order` becomes `["overview", "waiting",
  "preparing", "ready"]`, nothing hidden or collapsed. Its heading is slice 9's heading button
  (`data-column-toggle="overview"`), so it collapses like any column ("Overview · 4" on the strip),
  and `stationColumnNames()` names it, so the Columns window lists it with no change to the window
  (slice 9b, D4). **A layout stored before Overview existed** reads with Overview first, shown and
  open: `sanitise` puts a missing registered key at its default place with its default state
  (`kitchen-columns.ts:67-76`, slice 9 D3, read), so no compatibility code is written; Task 7 pins
  it at the screen. **Its width:** picture 03 draws Overview narrower than the card columns, so it
  keeps `.column`'s `11rem` basis (today's one value; no new `rem`, CLAUDE.md §3) and does not grow,
  `flex-grow: 0`; its names wrap (`overflow-wrap: anywhere`) rather than cut, since a card's dish
  names are cut with an ellipsis (`.line-name`, `station-queue.ts:431-436`, read). **The probe
  (ran)** drew Overview growing like the others and at 1024 px a long dish name no longer fitted its
  card ("keeps a long dish name whole inside its card at 1024 px": "expected 201 to be less than or
  equal to 192", `run1-overview.txt`); with `flex-grow: 0` that check passed (`run7-fits.txt`). Its
  body is one bordered box (`--wt-color-surface`, 1 px `--wt-color-border`, `--wt-radius-md`), one
  row per dish: the name, then the making count bold at the end ("1", "1.5"), then, while held,
  "+2" in `--wt-font-size-sm` `--wt-color-text-muted` (muted on surface is 6.13 : 1 light, 7.07 : 1
  dark, slice 9 D9). With no rows the body is empty and the count reads 0.
- **D6. Words: one settled, one built from a settled word.** `station.overview` "Overview" /
  «Resumen» (design §10 (g)). `station.overview_held` "{n} held" / «{n} en espera», visually hidden
  after the drawn "+2" (which is `aria-hidden`), so a screen reader hears "Secreto ibérico 1, 2
  held": "Held" «En espera» is §10's settled word. **Not built:** picture 03's key under the list,
  "After the +: held", and picture 07's second line under Overview in the window, "Counts each dish
  to make" (slice 9b D10 left it to 9c). Design §10 gives neither a wording, and this slice adds
  only §10's words; **owner FYI**, with the plan's proposal if wanted: «Tras el +: en espera» and
  «Cuenta cada plato por hacer», one small follow-up. The tabs and the red bar add no words: a tab
  is the column's name and count, and its late words reuse `station.late` ("{n} late" «{n} con
  retraso»). Keys en and es in `apps/till/src/i18n/strings.ts` only.
- **D7. The switch to tabs: measured, as a rule rather than one width** (design §9's open
  decision). Design §3.4: "Where the columns do not fit (below about 1000 px; the build measures)".
  **The build draws tabs exactly when the board is narrower than its shown columns need**, a pure
  function, `columnsFit`, in a new `apps/till/src/state/kitchen-board-fit.ts`:
  - an open card column needs **16.5 times the board's text size**; an open Overview its `11rem`
    basis; a collapsed column `--wt-tap-min`; plus `--wt-space-3` between each two columns (the
    `.kanban` gap);
  - a column that is hidden, or that the board cannot draw yet (`held`, `toFire`, `inProgress`),
    needs nothing; with nothing shown the board fits (it draws no column and no tab).
  **The measurement (ran, `measure3.txt`):** the narrowest card column holding a dish line whole,
  stepping one card's column width by 1 px: "2× Strawberries and cream" (the text-size suite's
  longest dish) needs 229 px at 14 px text and 272 px at 18 px (the 130% text size); "2× Grilled
  octopus with paprika" 256 and 305. 16.5 text widths is 231 px and 297 px, so a 22-character dish
  line stays whole at both sizes. The rule then gives, for today's four default columns, a board of
  **905 px** at standard text (176 + 3 × 231 + 3 × 12) and **1103 px** at 130% (`measure2.txt`'s
  frame: `pageAt(1024, …)` leaves a 976 px board, `pageAt(1280, …)` 1232 px). **On a kitchen
  display** the board is the viewport less the page's padding (24 px each side,
  `apps/till/index.html:17-18`, read) and the screen's (`--wt-space-4` each side,
  `till-station-screen.ts:121-125`, read), 80 px in all, so the switch comes at a viewport of
  about **985 px** (905 + 80) at standard text, the design's "about 1000 px", and 1183 px at 130%:
  tabs on a 1024 px display at 130% text, where four columns cut the dish names (`run1-overview.txt`: the
  text-size check at 1024 × 768 and 130% failed with Overview drawn; `measure2.txt`: at a 976 px
  board and 130%, three of the probe's four dish lines cut with Overview not growing). **Why a rule and not one width:** the probe's fixed 1000 px switch
  (`run5-wide-fixture.txt`) put a 1024 × 768 screen at 100% text into tabs although its columns fit
  (the text-size check passed there under the rule, `run7-fits.txt`); a rule also lets a cook who
  hides or collapses columns keep columns on a narrower screen, and moves the switch by itself when
  A773-2 adds Held: five columns need 1148 px at standard text (a display's viewport of about
  1228 px), so **a 1024 px kitchen screen draws tabs once Held is shown** unless a column is hidden
  or collapsed (**owner FYI**, and in the hand-off). **What the rule gives up at 1024 px** (**owner
  FYI**): a 1024 px display's board is 944 px, so with Overview each card column gets (944 − 176 −
  36) / 3 ≈ 244 px, and "2× Grilled octopus with paprika", which needs 256 px (`measure3.txt`), is
  cut with an ellipsis where before 9c, with three columns ((944 − 24) / 3 ≈ 307 px), it was whole;
  hiding or collapsing Overview brings it back. A factor that keeps it whole (18.3, its 256 / 14)
  would move the default switch to a viewport of about 1060 px (3 × 256 + 176 + 36 + 80), so a
  1024 px display would open on tabs; the plan keeps 16.5 for the design's "about 1000 px". The
  1024 px long-name check moves to that real frame (changed check 18).
- **D8. Measuring, so the first drawing is already the right one.** The widget measures its own
  host (`display: block`, as wide as its container: every container above it is a column flex box,
  `till-station-screen.ts:121-125`, `:181-185`, read): its width (`getBoundingClientRect`), its
  text size (`getComputedStyle(this).fontSize`, which a dish row inherits, `.line { font: inherit }`,
  `station-queue.ts:298`, read; a dish name measured 14 px, and 18 px at 130%, `measure3.txt`;
  Task 6a's case 4 checks that the host's size gives D7's switch), the root's font size for `rem`, and the
  `--wt-tap-min` and `--wt-space-3` tokens (declared in px, `packages/ui-core/src/tokens/structure.css:4`,
  `:29`, read) read with `getPropertyValue`. It measures **in `willUpdate` on every update** (one
  `getBoundingClientRect` and two `getComputedStyle` reads), as the probe did (`probe-fits.diff`),
  so the first drawing is already the right one (`await el.updateComplete` after a mount sees tabs
  or columns), and a text size changed while the screen is up takes effect at the next drawing,
  which the card clock brings within its tick at most (`TickingClock`, slice 8 D6, read). Measured only
  by the observer, the first drawing is columns and the switch comes a moment later: the probe's
  observer-only version failed 17 station tests where its measure-before-drawing version failed 65
  (`run2-tabs.txt`, `run3-tabs-sync.txt`), because which tests saw tabs depended on whether the
  observer had answered yet. A `ResizeObserver` on the host only asks for an update, and only when
  the **width** changes, so the switch's own change of height never feeds back. Disconnected, it stops observing. The
  precedent is the order screen's measured width (`DRAFT_SIDE_BY_SIDE_MIN_WIDTH`,
  `till-table-order-screen.ts:161`, `:1467-1503`, read).
  _2026-10-27, as built (Task 6a): the observer watches a zero-height `.width-probe` line at the top
  of the widget, not the host, because a watch on the host raised a ResizeObserver loop error when
  the switch changed the host's height._
- **D9. The tabs.** A `<div class="column-tabs" data-column-tabs role="group"
  aria-label=${t("station.columns")}>` row (a group, not a `nav`: a stacked screen draws one row per
  board, and two `nav` landmarks of one name break axe's `landmark-unique` rule, the plan review's
  reading, not run) of
  `<button type="button" class="option column-tab" data-column-tab=${key} aria-pressed>`, with the
  till's pressed-picker look (`segmentedOptionStyles`, the station picker's, picture 05's bordered
  tabs with the chosen one filled), wrapping onto a second line on a phone; each reads "Waiting · 2"
  drawn, its accessible name "Waiting 2" (a real space, the " · " `aria-hidden`, as slice 9's
  heading). **Which tabs:** every column the board can draw that is not hidden, in the layout's
  order (design §3.4), so Overview is first by default; with every column hidden, no tabs, and the
  header row with Columns stays (slice 9b D3). **Which is chosen:** the first tab until a tab is
  tapped; the choice is kept by the widget while it is mounted, so a 15-second refresh and a spell
  on a wider screen keep it, and falls back to the first shown tab when its column is hidden (with
  Overview hidden, Waiting). It is not stored on the device (design §3.6 lists order, shown and
  collapsed only): **owner FYI**. **A heading tap that stops the columns fitting:** on a board
  that fits only because some columns are collapsed (at 1024 × 768 and 130% text, Preparing and
  Ready collapsed need 597 px of a 976 px board), opening one by its heading can make them stop
  fitting, so the board turns to tabs under the cook's finger; the tab then chosen is the column
  just opened, not the first. In tabs nothing collapses a column, so only hiding a column in
  Columns, or a wider screen, brings the columns back (**owner FYI**). **Under the tabs**, one
  `<section class="tab-panel" data-tab-panel=${key} data-column=${state}>` (`data-column` as the
  column's section has it, `"overview"` for Overview, so the existing helpers find a card in it)
  holds that column's cards, or Overview's list; no column heading is drawn. **Collapse:** a
  collapsed column keeps its tab and shows its cards when chosen, and the stored layout is not
  changed, because a tab already folds every other column away and a tab that opens onto nothing
  would be a dead control; back on a wide screen it is collapsed again. A773-2's contract says
  "narrow tabs/list use the same order/visibility/collapse" (plan `:101`): order and visibility are
  kept; collapse is kept for the pass's narrow **list**, where each section folds (design §3.5),
  not for tabs (**owner FYI**, and in the hand-off).
  _2026-10-27, as built (visual check finding O2): in a tab panel Overview's list is no wider than
  a card column, `calc(16.5 * var(--wt-font-size-md))`, so a dish's name stays near its count on a
  tablet; at phone width (`PHONE_WIDTH`) it fills the panel._
  _2026-10-27, as built (finish-branch review): when the board draws tabs and the remembered tab's
  column is hidden, the first shown tab becomes the remembered choice, so showing the column again
  keeps the tab the cook sees (choose Ready, hide Ready, show it again: Overview stays chosen). When
  the heading that opened the column still holds the focus as the board turns to tabs, the focus
  moves to that column's tab (tested with Enter and Space); when the focus is elsewhere (a focused Columns button and a scripted
  tap on the heading, in the test), it stays there._
- **D10. The red bar** (design §3.4: "A tab holding a late card carries a red bar, as A757's zone
  tabs do"; owner, 2026-10-27, slice 9 D14: "A collapsed kitchen column that holds a late card
  carries the same red bar as slice 9c's narrow tabs"). **Late** is `lateCards` over that column's
  cards, the header line's rule (a card with a fired dish not Ready whose band is overdue or
  forgotten), so only Waiting and Preparing can carry it and Overview never. **On a tab:** a
  `--wt-space-1` bar in `--wt-color-danger` drawn **under** the tab, outside its fill
  (`box-shadow: 0 var(--wt-space-1) 0 var(--wt-color-danger)`, the row gap `--wt-space-3` so a
  wrapped line clears it), on the chosen tab too. The floor's zone tab draws it inside, over a
  tint (`till-floor-screen.ts:484-487`, read), but the floor never marks the zone on screen, and a
  kitchen tab may be chosen: inside a chosen tab's blue the red is 1.41 : 1 light and 1.30 : 1 dark,
  against the page 6.11 : 1 and 7.62 : 1 (ran: `python3 -I
  /Users/clintongormley/waitron-campaign-c/a797-9c-scripts/tab-bar-contrast.py`, WCAG's formula over
  `colors.css:6`, `:7`, `:14`, `:18`, dark `:142-143`, `:150`, `:154`). **On a collapsed column's
  strip:** the same bar across the strip's top, inside its border (`box-shadow: inset 0
  var(--wt-space-1) 0 var(--wt-color-danger)`), against `--wt-color-surface` 6.54 : 1 and 6.94 : 1
  (ran, the same script), at the top because the strip can run below the screen's edge. An open
  column draws none (its cards show their own band). Both carry `data-late` and a visually hidden
  ", 1 late" in their accessible name ("Preparing 1, 1 late"), so the bar is not colour alone, and
  neither moves (no pulse, so reduced motion needs nothing). A hidden column's late card marks
  nothing beyond the header line (slice 9b D3). **A departure from the owner's D14 answer**
  ("carries the same red bar"), an **owner FYI**: the colour and thickness are the same, but the
  bar sits under a tab and inside the top of a collapsed strip.
  _2026-10-27, as built (Task 8): while a column is late its drawn count is hidden from screen
  readers and one visually hidden span reads the count and the late words ("1, 1 late"), because
  with a hidden ", 1 late" after the drawn count Chromium put a space before the comma in the
  name._
- **D11. Tests start at a phone's width, so the station suites take a wide frame.** Every till
  browser test starts at 414 × 896 (`DEFAULT_FRAME`, `test-helpers.ts:108`, read); under D7 a board
  there draws tabs, which opens on Overview and draws no card. The probe with tabs at 414 failed
  231 of 668 station tests (`run4-overview-first.txt`). Seven station suites get
  `beforeEach(async () => { await page.viewport(1280, 900); })` and `afterEach(resetPage)` (the
  helper restoring 414 × 896), and the till-app describe whose kitchen display taps a dish the
  same: **fixture-only**, because each case's subject is not the board's width. **Control (ran):**
  that fixture alone, with no product change, → `Tests 668 passed (668)` (`run8-fixture-control.txt`).
  With it and the probe, the failures fell to the first 17 changed checks below (`run7-fits.txt`);
  the 18th comes from the plan review (D7). The
  cases that set 390 px themselves keep their width and select their card's tab first.
- **D12. What is not touched.** `till-station-screen.ts`, `till-app.ts`, `till-expo-screen.ts` and
  `kitchen-columns-dialog.ts` keep their product code: the screen already reads `STATION_COLUMNS`
  and hands the window `stationColumnNames()` (`till-station-screen.ts:366-367`, `:397`, read).
  `kitchen-columns.ts` changes only `STATION_COLUMNS`.
- **D13. The header line is unchanged.** "5 dishes to make · 1 late" still counts every card,
  hidden and collapsed columns included, and in tabs it sits above the tabs in the header row
  (picture 05 draws it there). Overview's making counts add up to it (Task 2 pins that).
- **D14. Task order keeps every task green.** Overview drawn when a layout lists it (Task 4) before
  it is registered (Task 7); the wide frame (Task 5) before the tabs (Tasks 6a, 6b). The text-size check
  at 1024 × 768 and 130% fails if Overview is registered before tabs exist (four columns cut the
  names: `run1-overview.txt`), so registration waits for the tabs.

### Changed test checks (from the probe; the implementer confirms each)

**Probe (ran):** in `apps/till`, `pnpm exec vitest run src/widgets/station-queue
src/screens/till-station-screen src/screens/kitchen-allergy src/screens/text-size.layout
src/state/kitchen-columns src/widgets/kitchen-columns-dialog`: base `Test Files 13 passed (13)`,
`Tests 668 passed (668)` (`base1.txt`); Overview registered and drawn, no tabs → `Tests 12 failed |
656 passed` (`run1-overview.txt`); Overview with `flex-grow: 0`, D7's rule, tabs opening on
Overview, and D11's wide frame → `Tests 17 failed | 651 passed (668)` (`run7-fits.txt`). The other
suites that mount the screen or the app, with tabs at 414 and no wide frame (`src/screens/till-expo-screen
src/screens/device-screens.phone-margin src/widgets/pressed-pickers.a11y src/screens/till-counter-screen
src/till-app`) → `Test Files 1 failed | 55 passed (56)`, `Tests 3 failed | 4797 passed (4800)`
(`run6-others.txt`). Free memory 80 % (ran `memory_pressure`). The probe's tabs were crude (no
chosen tab, no red bar); the build's own new cases are listed per task.

**The checks that change** (each in the task named; "whichever of Tasks 6a, 6b and 7 first sees
it fail" edits it, the same way):

1. `apps/till/src/state/kitchen-columns.test.ts:46` "reads the defaults when nothing is stored" and
2. `:60` "keeps a saved layout for its venue, device, screen and station only": compare with a
   literal default order; it gains `"overview"` first (D5). Task 7.
3. `apps/till/src/widgets/kitchen-columns-dialog.test.ts:42` "lists the columns it has names for, in
   the layout's order, numbered": its unnamed key is `overview`, which `stationColumnNames()` now
   names; the unnamed key becomes `held` (layout `["ready", "held", "waiting", "preparing"]`), so
   it still checks that a key without a name is left out. Task 4.
4. `apps/till/src/widgets/station-queue.test.ts:3818` "leaves out the columns it cannot draw yet":
   Overview is now drawn; expected `["overview", "queued", "preparing", "ready"]` (Held still left
   out). Task 4.
5. same file `:4010` "the board's header row: Columns asks to open the window and changes nothing
   itself": its literal default `columns` gains `"overview"`. Task 7.
6. same file `:4064` "the board's header row: the station registers only columns the board draws":
   the names map gains `["overview", t("station.overview")]` first. Task 4.
7. `apps/till/src/screens/till-station-screen.test.ts:5287` "the device's kitchen columns: a
   collapsed column stays collapsed when the screen opens again": the stored value's order gains
   `"overview"`. Task 7.
8. same file `:5403` "the Columns window: a move reorders that board at once and is kept on the
   device", 9. `:5433` "the Columns window: with no origin or device it still reorders, for this
   screen only" and 10. `:2793` "the Columns window: a refresh keeps the window open and the moves
   made": moving Ready up from the new default gives `["overview", "waiting", "ready",
   "preparing"]`. Task 7.
11. and 12. `apps/till/src/widgets/station-queue.test.ts:359` (an `it.each`) "leave a card's dish
    name uncut at %s px wide (former numbers %j)", its two 390 px variants; 13. and 14. `:3551`
    "a long heading wraps inside its card at 390 px, its minutes on one line (en-GB|es)"; 15. `:3600`
    "a dish row spans its card's content in Waiting and Preparing at 390 px" (its 1280 variant is
    unchanged); 16. `apps/till/src/widgets/station-queue.kitchen-note.test.ts:83` "wraps an
    unbroken instruction at phone width": at 390 px the board draws tabs (D7, D9), so each case
    first taps its card's tab (`[data-column-tab="waiting"]`, then `"preparing"` where it checks
    Preparing) and then checks exactly what it checked. Task 6a, 6b or 7.
17. `apps/till/src/screens/text-size.layout.test.ts:244` (an `it.each`) "on a kitchen station's queue
    at 1024x768 and 130%, every dish lies inside its card": at that size the four columns do not
    fit and the board draws tabs (D7). The case taps the Waiting, Preparing and Ready tabs in turn
    and checks each tab's dishes inside their card; "kitchen cards drawn" becomes the three cards
    seen over the three tabs, and the font-size and page-width checks stay. Its 1280 variants and
    the 1024 × 768 100% variant are unchanged (they still draw columns, `run7-fits.txt`). Task 7.
18. `apps/till/src/widgets/station-queue.test.ts:3073` "keeps a long dish name whole inside its card
    at 1024 px": it mounts at a plain 1024 px viewport, a 1008 px frame, where no kitchen display's
    board is that wide (D7: 944 px), and it passed the probe only for that reason. It moves to the
    real frame, `pageAt(1024, 844)` with the widget inside a container padded `--wt-space-4` each
    side (the screen's padding), and expects, with the default layout (Overview shown), the name
    cut with an ellipsis (`scrollWidth > clientWidth`) yet inside its card, and with `hidden:
    ["overview"]` the name whole as before. Renamed "a long dish name at a 1024 px kitchen display:
    cut beside Overview, whole without it". Task 7.

**Fixture-only** (Task 5; no check changes, control `run8-fixture-control.txt`): the wide frame of
D11 in `src/widgets/station-queue.test.ts`, `station-queue.a11y.test.ts`,
`station-queue.allergy.test.ts`, `station-queue.kitchen-note.test.ts`,
`src/screens/till-station-screen.test.ts`, `till-station-screen.a11y.test.ts`,
`till-station-screen.allergy.test.ts`, and in `src/till-app.test.ts`'s describe "till-app: a box
update while a kitchen display's dish move still waits for the server" (`:22683`; its three cases
failed at 414 once tabs existed, `run6-others.txt`: "expected null not to be null").

Any other failure, in any suite a task names, is a STOP.

### Review focus (inputs the spec implies and today's tests may not pin)

1. **Picture 03's scene through `overviewDishes` and `overviewRows`:** its stated ages give
   Sirloin, Burger, Spicy potatoes 3 +1, Pork shoulder 1 +2, Rib steak 0 +1 last, Ready left out,
   the count 4 (D2–D4; Tasks 1, 2, 4).
2. **Quantities:** a dish sold by weight counts one; "1.5" stays exact; the making counts sum to
   the header line (D2; Tasks 1, 2).
3. **The switch at the rule's edge:** 905 and 904 px of board at standard text, 1103 at 130%, a
   hidden or collapsed column moving it, nothing shown; the 1024 px display's 944 px board (D7;
   Tasks 3, 6a, 7).
4. **The first drawing:** a board mounted at 390 px draws tabs with no extra frame; a resize in
   either direction switches once and does not flicker back (D8; Task 6a).
5. **The chosen tab:** kept on a 15-second refresh, on a new `groups` and through a wider spell;
   falls back when its column is hidden in the Columns window while chosen (D9; Task 6b).
6. **A collapsed column in tabs:** its tab opens it; on a wide screen again it is still collapsed;
   no `toggle-column` sent (D9; Task 6b).
7. **A layout stored before Overview:** Overview first, shown and open; a stored collapsed Ready
   stays collapsed (D5; Task 7).
8. **The red bar:** on a late tab, chosen or not; on a collapsed late strip; not on an open column,
   Overview, a held card's column or a hidden column; the words ", 1 late"; nothing moves (D10;
   Task 8).
9. **Keyboard:** Tab reaches each tab; Enter and Space choose it; the focus ring shows;
   `aria-pressed` follows (D9; Tasks 6b, 10b).
10. **Dark theme, Spanish («Resumen · 4», «Esperando · 2»), 390 px, just under and just over the
    switch, 1024 and 1280 px** (Tasks 10a, 10b).
11. **A heading tap that stops the columns fitting:** the opened column's tab is chosen, not the
    first (D9; Task 6a).

---

**Task order and why.** The counting function first (Task 1), then the station's adapter (Task 2)
and the fit rule (Task 3), all pure; the Overview column drawn when a layout lists it (Task 4); the
wide test frame (Task 5) before the tabs: the switch, the tabs and a tap on one (Task 6a), then
the chosen tab's edges, keyboard, Spanish and accessibility (Task 6b); then Overview registered
first (Task 7), which needs the tabs (D14); the red bar (Task 8); the docs (Task 9); the LOOK in
two parts (Tasks 10a, 10b). Each is one implementer's (the LOOKs one subagent's), test first, well
under 100 tool calls, and ends green and committed.

**Dish names in new fixtures are English** (general code is English only, CLAUDE.md §3): picture
03's scene is written Pork shoulder (its Secreto ibérico), Sirloin (Entrecot), Spicy potatoes
(Patatas bravas), Burger (Hamburguesa) and Rib steak (Chuletón). **Spanish expectations are built
from `t()` after `setLocale("es-ES")`**, each with a check that the word differs from its English,
as `station-queue.test.ts:4074-4087` does, never spelt out in the test.

**Picture 03's scene, as fixtures** (Tasks 2 and 4 use it; ages against the case's fixed `now`):
T2, Preparing, fired 19 min 40 s ago (the oldest), 1 Sirloin and 1 Burger; a Ready card fired
12 min ago, 2 Croquettes; T5, Waiting, fired 7 min 30 s ago, 2 Spicy potatoes; T9, Waiting, fired
2 min 10 s ago, 1 Pork shoulder and 1 Spicy potatoes; T4, held (`firedAt` null), 2 Pork shoulder
and 1 Spicy potatoes; T7, held, 1 Rib steak. Under D3 its rows are, in order: Sirloin 1, Burger 1,
Spicy potatoes 3 +1, Pork shoulder 1 +2, Rib steak 0 +1; no Croquettes; the count 4.

### Task 1: The one counting function, in one pure module

**Files:**
- Create: `apps/till/src/state/kitchen-overview.ts` (D1: `OverviewDish`, `OverviewRow`,
  `dishThousandths`, `overviewRows`, `rowsToMake`; imports `stringToThousandths` from
  `@waitron/shared`, as `kitchen-cards.ts:1` does, and nothing from `api/client.ts`)
- Test: `apps/till/src/state/kitchen-overview.test.ts`

- [ ] **Step 1: Failing tests**, in one `describe("the kitchen Overview's counts")`:
  1. "one row per name, making and held apart" — `[{ name: "Pork shoulder", thousandths: 1000,
     stage: "making" }, { name: "Pork shoulder", thousandths: 2000, stage: "held" }, { name:
     "Sirloin", thousandths: 1000, stage: "making" }]` → `[{ name: "Pork shoulder", making: 1000,
     held: 2000 }, { name: "Sirloin", making: 1000, held: 0 }]`.
  2. "rows with something to make come first, each group in first-appearance order" — input order
     Rib steak (held), Spicy potatoes (making), Pork shoulder (held), Pork shoulder (making),
     Sirloin (making) → names `["Spicy potatoes", "Pork shoulder", "Sirloin", "Rib steak"]`.
  3. "a held dish counts as its name's first appearance" — A (held), B (making), A (making) →
     `["A", "B"]` (D3).
  4. "the same name with different quantities adds up exactly" — 1500 + 1000 → 2500.
  5. "no dishes, no rows" → `[]`; and a dish of 0 thousandths makes no row.
  6. "rowsToMake counts the rows with something to make" — five rows, one of them held only → 4.
  7. `it.each` "dishThousandths: %s" — `("2.000", undefined, undefined)` → 2000; `("1.500", null,
     undefined)` → 1500; `("0.350", { en: "kg" }, undefined)` → 1000 (the unit shows: counts one);
     `("3.000", { en: "each" }, true)` → 3000 (sold in Each: the unit is left out, so it counts by
     quantity), as `thousandthsToMake` decides today (`kitchen-cards.ts:159-160`, read).
  8. "does not change its input" — a frozen array of frozen dishes.
- [ ] **Step 2: Run; expect FAIL** (the module does not exist) `pnpm --filter @waitron/till exec vitest run src/state/kitchen-overview.test.ts`
  (memory first: `memory_pressure | grep free`).
- [ ] **Step 3: Implement** D1–D3. One `Map` keyed by name for the sums, filled in input order so
  its key order is first appearance; then the two groups.
- [ ] **Step 4: Run; expect PASS** (read the `Tests` count: 7 cases plus the `it.each`'s four, 11).
- [ ] **Step 5:** `pnpm --filter @waitron/till typecheck`; `pnpm exec eslint apps/till/src/state/kitchen-overview.ts apps/till/src/state/kitchen-overview.test.ts`;
  `pnpm format:check`; ledger; `git commit -s -m "A797-9c: one function counts the kitchen's dishes for Overview"`

### Task 2: The station's dishes for Overview

**Files:**
- Modify: `apps/till/src/state/kitchen-cards.ts` (`overviewDishes(cards)`, D1: over the cards in
  their order and each card's `items` in turn, `firedAt` null → `held`, fired and not `ready` →
  `making`, `ready` left out, `thousandths` from `dishThousandths(item.quantity, item.unitName,
  item.soldInEach)`; `thousandthsToMake` (`:153-164`) sums the `making` dishes' thousandths through
  the same helper)
- Test: `apps/till/src/state/kitchen-cards.test.ts`

- [ ] **Step 1: Failing tests:**
  1. "the station's dishes for Overview: held, making, and no Ready" — picture 03's scene (above)
     through `overviewRows(overviewDishes(kitchenCards(orders)))` → `[Sirloin 1000/0, Burger
     1000/0, Spicy potatoes 3000/1000, Pork shoulder 1000/2000, Rib steak 0/1000]`, in that order,
     no Croquettes.
  2. "Overview's making counts add up to the dishes to make" — the same scene plus a "0.35 kg ×
     Octopus" dish: the sum of `making` equals `thousandthsToMake`.
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/till exec vitest run src/state/kitchen-cards.test.ts`
  (the export is missing; first add an empty stub returning `[]` so the file loads and the cases
  fail on their assertions).
- [ ] **Step 3: Implement.** `thousandthsToMake`'s own tests must pass unchanged.
- [ ] **Step 4: Run; expect PASS**, then `pnpm --filter @waitron/till exec vitest run src/widgets/station-queue.test.ts -t "dishes-to-make"`
  (the header line's describe, `station-queue.test.ts:3243`) → passes unchanged.
- [ ] **Step 5:** typecheck till; eslint the changed files; `pnpm format:check`; ledger;
  `git commit -s -m "A797-9c: the kitchen cards hand Overview their dishes"`

### Task 3: When a kitchen board's columns fit

**Files:**
- Create: `apps/till/src/state/kitchen-board-fit.ts` (D7):
  ```ts
  export interface BoardMeasure { width: number; textPx: number; remPx: number; tapMinPx: number; gapPx: number }
  /** An open card column holds a 22-character dish line whole, measured at 14 and 18 px text (plan slice 9c D7). */
  export const CARD_COLUMN_TEXT_WIDTHS = 16.5;
  /** `.column`'s flex basis in `station-queue.ts`, which Overview keeps and does not grow past. */
  export const OVERVIEW_COLUMN_REMS = 11;
  /** Whether the shown columns, in order, fit side by side; `collapsed` among them take a strip. */
  export function columnsFit(board: BoardMeasure, shown: readonly ColumnKey[], collapsed: readonly ColumnKey[]): boolean;
  ```
- Test: `apps/till/src/state/kitchen-board-fit.test.ts`

- [ ] **Step 1: Failing tests** (`remPx: 16, tapMinPx: 44, gapPx: 12` unless a case says otherwise):
  1. `it.each` "four columns at %i px text need %i px" — `textPx` 14 → 905 fits and 904 does not;
     `textPx` 18 → 1103 fits and 1102 does not (`shown` `["overview", "waiting", "preparing",
     "ready"]`).
  2. "three card columns need less" — no Overview, 14 px → 717 fits, 716 does not.
  3. "a collapsed column takes a strip" — `collapsed: ["waiting", "preparing"]` → 531 fits, 530
     does not.
  4. "Held as a fifth column" — `["overview", "held", "waiting", "preparing", "ready"]`, 14 px →
     1148 fits, 1147 does not (the hand-off's figure, D7).
  5. "nothing shown always fits" — `shown: []`, width 0 → true.
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/till exec vitest run src/state/kitchen-board-fit.test.ts`.
- [ ] **Step 3: Implement** D7: each shown key adds `collapsed` → `tapMinPx`, `overview` →
  `OVERVIEW_COLUMN_REMS * remPx`, any other → `CARD_COLUMN_TEXT_WIDTHS * textPx`; plus `gapPx *
  (shown.length - 1)`; fits when `width >= need`. The caller passes only keys it can draw.
- [ ] **Step 4: Run; expect PASS** (read the `Tests` count).
- [ ] **Step 5:** typecheck till; eslint; `pnpm format:check`; ledger;
  `git commit -s -m "A797-9c: a rule for when a kitchen board's columns fit"`

### Task 4: The Overview column, drawn when a layout lists it

**Files:**
- Modify: `apps/till/src/widgets/station-queue.ts` (`#board` draws a `section.column.column-overview
  data-column="overview"` for the key `overview` when it is in `columns.order` and not hidden: slice
  9's heading button with `t("station.overview")` and the count `rowsToMake(rows)`, collapsible as
  any column; open, a `<ul class="overview" data-overview>` of `<li data-overview-row>` rows, each
  `<span class="overview-name">`, `<span data-overview-making>` (`trimQuantity(thousandthsToDecimal(row.making))`),
  and while `held > 0` `<span data-overview-held aria-hidden="true">+N</span>` then a
  `.visually-hidden` ", N held"; the rows from `overviewRows(overviewDishes(cards))` over **every**
  card, whichever columns are hidden or collapsed; `stationColumnNames()` names `overview` first;
  styles per D5 with `--wt-*` tokens only: `.column-overview { flex-grow: 0; }`, the list box,
  names `overflow-wrap: anywhere`), `apps/till/src/i18n/strings.ts` (`station.overview`
  "Overview" / «Resumen», `station.overview_held` "{n} held" / «{n} en espera»)
- Test: `apps/till/src/widgets/station-queue.test.ts` (a new `describe("the Overview column")`, with
  "the board's columns" describe's builders, `:3750-3800`), `station-queue.a11y.test.ts` (inside the
  both-theme describe), and changed checks 3, 4 and 6

- [ ] **Step 1: Failing tests** (each mounted with `columns: { order: ["overview", "waiting",
  "preparing", "ready"], hidden: [], collapsed: [] }`, at 1280 × 900 with `page.viewport` restored
  after, until Task 5 gives the file its wide frame):
  1. "Overview lists each dish to make with how many, and the held after a +" — picture 03's scene
     (above): the rows read, flattened, "Sirloin 1", "Burger 1", "Spicy potatoes 3 +1", "Pork
     shoulder 1 +2", "Rib steak 0 +1", in that order; no Croquettes row.
  2. "Overview's heading counts the dishes with something to make" — `[data-column="overview"]
     [data-column-count]` reads "4"; its `.column-title` reads `t("station.overview")`.
  3. "a row tells assistive technology how many are held" — the Pork shoulder row's text content
     includes ", 2 held" in a `.visually-hidden` span and its "+2" is `aria-hidden`.
  4. "Overview collapses by its heading like any column" — click `[data-column-toggle="overview"]`
     → one `toggle-column` `{ key: "overview" }`; with `collapsed: ["overview"]` no
     `[data-overview-row]`, its button named "Overview 4".
  5. "Overview keeps its basis and does not grow, and a long name wraps inside it" — at 1280 px:
     Overview's section is exactly `OVERVIEW_COLUMN_REMS * parseFloat(getComputedStyle(document.documentElement).fontSize)`
     px wide (so the constant and the CSS `11rem` cannot drift apart) and narrower than Waiting's;
     a row named "Grilled octopus with paprika and potatoes" lies inside the list box (`textRects`
     within its row).
  6. "with nothing to make or held, Overview shows 0 and no rows" — only a Ready card.
  7. "a hidden column's dishes still count in Overview" — `hidden: ["waiting"]`: the rows are case
     1's.
  8. "a merged board counts one dish at two stations in one row" — two orders with `stationId`
     `st-1` and `st-2` and `stationNames` set, each with 1 Sirloin Waiting → one row "Sirloin 2".
  9. "quantities: 1.5 stays exact, and a dish whose unit shows counts one" — 1.5 Spicy potatoes →
     "1.5"; a "0.35 kg" Octopus (`unitName: { en: "kg" }`) → "1".
  10. "Overview reads in Spanish" — `setLocale("es-ES")`, restored in `finally`: the title is
      `t("station.overview")` (checked not "Overview") and the held text
      `t("station.overview_held").replace("{n}", "2")`.
  11. a11y: "a board with Overview has no violations" (`reducedMotion: true`, a fixed `now`), once
      per theme.
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/till exec vitest run src/widgets/station-queue.test.ts src/widgets/station-queue.a11y.test.ts -t "Overview"`.
- [ ] **Step 3: Implement**; then edit changed checks 3, 4 and 6 as listed, and nothing else.
- [ ] **Step 4: Run; expect PASS**, then `pnpm --filter @waitron/till exec vitest run src/widgets/station-queue src/screens/till-station-screen src/screens/kitchen-allergy src/screens/text-size.layout src/state/kitchen-columns src/widgets/kitchen-columns-dialog src/state/kitchen-cards src/state/kitchen-overview src/i18n`
  → every test passes (the default layout has no Overview yet, so the screen's checks do not
  change here); a failure other than 3, 4 and 6 is a STOP. Then, from the root,
  `pnpm exec vitest run scripts/style-token-names.test.ts scripts/primary-coloured-text.test.ts`.
- [ ] **Step 5:** typecheck till; eslint the changed files; `pnpm format:check`; ledger, with
  checks 3, 4 and 6 and their reasons; `git commit -s -m "A797-9c: the kitchen board draws an Overview column of dishes to make"`

### Task 5: The station suites take a wide test frame (fixture-only)

**Files:**
- Modify (tests only): `apps/till/src/widgets/station-queue.test.ts`,
  `station-queue.a11y.test.ts`, `station-queue.allergy.test.ts`,
  `station-queue.kitchen-note.test.ts`, `apps/till/src/screens/till-station-screen.test.ts`,
  `till-station-screen.a11y.test.ts`, `till-station-screen.allergy.test.ts` (top level of each:
  `beforeEach(async () => { await page.viewport(1280, 900); })` and `afterEach(resetPage)`, with
  `page` from `vitest/browser` and `resetPage` from `../widgets/test-helpers.js` or
  `./test-helpers.js`), `apps/till/src/till-app.test.ts` (the same two hooks inside the describe at
  `:22683` only). Task 4's own cases drop their per-case `page.viewport` once their file has the
  frame. Nothing else changes (D11).

- [ ] **Step 1: Run** `pnpm --filter @waitron/till exec vitest run src/widgets/station-queue src/screens/till-station-screen src/screens/kitchen-allergy src/screens/text-size.layout src/state/kitchen-columns src/widgets/kitchen-columns-dialog`
  before the change and record its `Tests` count.
- [ ] **Step 2: Add the frame**; run the same command → the same count, all passing (control:
  `run8-fixture-control.txt`); then `pnpm --filter @waitron/till exec vitest run src/till-app.test.ts -t "a box update while a kitchen display"`
  → its three cases pass.
- [ ] **Step 3:** typecheck till; eslint the changed files; `pnpm format:check`; ledger (the files
  under "Fixture-only"); `git commit -s -m "A797-9c: the kitchen board's tests run at a kitchen screen's width"`

### Task 6a: Below the width its columns need, the board shows one column at a time

**Files:**
- Modify: `apps/till/src/widgets/station-queue.ts` (D7–D9: `@state() private board?: BoardMeasure`;
  `#measure()` reading the host per D8, called from `willUpdate` on **every** update while the host
  is connected; a `ResizeObserver` on the host from `connectedCallback`, disconnected in
  `disconnectedCallback`, which only calls `requestUpdate()` when the width changed; `#shown()` =
  `columns.order` keys the board can draw (`overview` and `DRAWN`'s), not hidden; render draws, in
  place of `#board`, `#tabs(cards)` when `!columnsFit(board, shown, columns.collapsed)` and
  something is shown: the `role="group"` row and one panel per D9; `@state() private chosenTab?:
  ColumnKey`, set by a tab tap, and by D9's rule when a heading tap that opens a column makes the
  columns stop fitting (a private `#opening?: ColumnKey` recorded on that tap, used and cleared by
  the next render); the chosen tab falls back to the first shown; `segmentedOptionStyles` added
  to `styles`; tokens only)
- Test: `apps/till/src/widgets/station-queue.test.ts` (a new `describe("the board's narrow tabs")`),
  and whichever of changed checks 11–16 fail here

- [ ] **Step 1: Failing tests** (each name starts "the board's narrow tabs:"; the layout is passed
  explicitly with Overview first, as Task 4's cases; a resize is followed by `vi.waitFor` on the
  expected element, never a fixed sleep):
  1. "at 390 px the board draws a tab per shown column, in order, the first chosen" — `pageAt(390,
     844)`, then right after `mountWidget`'s `updateComplete`, with no extra frame (D8):
     `[data-column-tab]` keys `["overview", "waiting", "preparing", "ready"]`, the first
     `aria-pressed="true"`, the rest `"false"`; the row is `[role="group"]` named
     `t("station.columns")`; one `[data-tab-panel="overview"]` holding the `[data-overview-row]`s;
     no `.kanban`.
  2. "a tab is named by its column and count" — with two cards in Waiting:
     `getByRole("button", { name: "Waiting 2" })`; the drawn text "Waiting · 2".
  3. "tapping a tab shows that column's cards" — click Preparing: it is pressed, its panel
     `data-column="preparing"` holds its cards, Overview's rows are gone.
  4. `it.each` "at %s the board draws %s" (D7's figures, through the real widget):
     `pageAt(1024, 768, 100)` → columns; `pageAt(1024, 768, 130)` → tabs; `pageAt(1280, 800, 130)`
     → columns; `pageAt(1024, 768, 130)` with `collapsed: ["preparing", "ready"]` → columns.
  5. "the board changes to tabs and back as its width crosses the need" — mount at 1280: `.kanban`;
     `page.viewport(800, 900)` → `vi.waitFor` `[data-column-tabs]`; back to 1280 → `.kanban`, the
     same widget element.
  6. "opening a collapsed column that no longer fits shows its tab" (D9) — `pageAt(1024, 768, 130)`
     with `collapsed: ["preparing", "ready"]`: columns; click Ready's heading → one `toggle-column`
     `{ key: "ready" }`; set `columns` with `collapsed: ["preparing"]` as the screen would → still
     columns (176 + 297 + 44 + 297 + 36 = 850 ≤ 976); click Preparing's heading, then set
     `collapsed: []` → tabs, with Preparing's tab chosen, not Overview's.
  7. "with no orders at 390 px there are no tabs, only Nothing in the kitchen" — `groups: []`: no
     `[data-column-tab]`; `.empty` reads `t("station.empty")`.
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/till exec vitest run src/widgets/station-queue.test.ts -t "narrow tabs"`.
- [ ] **Step 3: Implement** D7–D9's switch, drawing, tap and the opening rule. Then run the probe's
  command (Task 5's Step 1); of changed checks 11–16, edit **only** those that fail, as listed (tap
  the card's tab first), and nothing else.
- [ ] **Step 4: Run; expect PASS**, the same command → every test passes; then the other suites
  that mount the queue or the screen,
  `pnpm --filter @waitron/till exec vitest run src/screens/till-expo-screen src/screens/device-screens.phone-margin src/widgets/pressed-pickers.a11y src/screens/till-counter-screen src/till-app`
  (memory first; `run6-others.txt` had 4800 tests; any failure is a STOP), then from the root
  `pnpm exec vitest run scripts/style-token-names.test.ts scripts/primary-coloured-text.test.ts scripts/native-form-fields.test.ts`.
- [ ] **Step 5:** typecheck till; eslint; `pnpm format:check`; ledger, with each changed check
  edited here; `git commit -s -m "A797-9c: a narrow kitchen board shows its columns as tabs"`

### Task 6b: The chosen tab, hidden and collapsed columns, keyboard and Spanish

**Files:**
- Modify: `apps/till/src/widgets/station-queue.ts` (only what these cases show is missing from 6a)
- Test: `apps/till/src/widgets/station-queue.test.ts` (the "the board's narrow tabs" describe),
  `station-queue.a11y.test.ts`, `apps/till/src/screens/till-station-screen.test.ts` (case 9, inside
  the describe "the device's kitchen columns" nested in the 15-second refresh describe, `:2787`,
  with its fake timers)

- [ ] **Step 1: Failing tests** (each name starts "the board's narrow tabs:"; a case that passes
  as soon as it is written is kept as a guard and named in the ledger):
  1. "the chosen tab survives new orders" — at 390 px choose Preparing; set `groups` to a copy with
     one more card → Preparing still chosen.
  2. "the chosen tab survives a wide spell" — at 390 px choose Ready; `page.viewport(1280, 900)` →
     columns; back to 390 → Ready chosen.
  3. "a hidden column has no tab, and a chosen column that is hidden gives way to the first" —
     `hidden: ["waiting"]` → three tabs; choose Ready, then set `hidden: ["waiting", "ready"]` →
     Overview chosen.
  4. "with Overview hidden, Waiting is the first tab and chosen" — `hidden: ["overview"]` while
     Overview was chosen → Waiting pressed.
  5. "with every column hidden there are no tabs, and Columns stays" — no `[data-column-tab]`,
     `[data-columns-open]` present.
  6. "a collapsed column keeps its tab and shows its cards there, and nothing is asked of the
     layout" — `collapsed: ["ready"]`: choose Ready → its cards drawn; no `toggle-column` event.
  7. "Enter and Space choose a tab" — focus the Ready tab, `userEvent.keyboard("{Enter}")` → Ready
     chosen; focus Waiting, `" "` → Waiting chosen.
  8. "the tabs read in Spanish" — picture 03's scene, `setLocale("es-ES")`, restored in `finally`:
     the first tab's text is `` `${t("station.overview")} · 4` `` and Waiting's
     `` `${t("station.state.queued")} · 4` `` (its two held cards sit in Waiting until A773-2's Held,
     slice 8 D3), each word checked to differ from its English.
  9. (screen) "the board's narrow tabs: the chosen tab survives the screen's 15-second refresh" —
     the screen at 390 px with one station: choose Preparing in its widget; advance 15 s and flush
     → Preparing still chosen.
  10. a11y: "the narrow tabs have no violations", once per theme, at 390 px, with two stacked
      boards' widgets on the page (the two `role="group"` rows).
- [ ] **Step 2: Run; expect FAIL** for each case 6a does not already satisfy:
  `pnpm --filter @waitron/till exec vitest run src/widgets/station-queue.test.ts src/widgets/station-queue.a11y.test.ts -t "narrow tabs"`
  and `pnpm --filter @waitron/till exec vitest run src/screens/till-station-screen.test.ts -t "narrow tabs"`.
- [ ] **Step 3: Implement** the rest of D9.
- [ ] **Step 4: Run; expect PASS**, then Task 5's Step 1 command and Task 6a's Step 4 commands →
  every test passes; a failure not listed under changed checks 11–16 is a STOP.
- [ ] **Step 5:** typecheck till; eslint; `pnpm format:check`; ledger;
  `git commit -s -m "A797-9c: a kitchen board's chosen tab holds through refreshes and layout changes"`

### Task 7: Overview is the first column by default

**Files:**
- Modify: `apps/till/src/state/kitchen-columns.ts` (`STATION_COLUMNS.order` `["overview", "waiting",
  "preparing", "ready"]`, D5)
- Test: `apps/till/src/screens/till-station-screen.test.ts` (inside the top-level "the device's
  kitchen columns" describe, `:5269`, with its `mountOperator`, `clearStoredColumns` and `BOX`),
  and changed checks 1, 2, 5, 7–10, 17, 18 and the rest of 11–16

- [ ] **Step 1: Failing tests:**
  1. "the device's kitchen columns: Overview comes first by default" — a fresh screen: the widget's
     `columns.order` is `["overview", "waiting", "preparing", "ready"]` and the first
     `[data-column]` is `overview`.
  2. "the device's kitchen columns: a layout saved before Overview shows Overview first, shown and
     open" — store `{ version: 1, order: ["ready", "waiting", "preparing"], hidden: [], collapsed:
     ["ready"] }` under D2's key for `st-1`, then mount: order `["overview", "ready", "waiting",
     "preparing"]`, Overview not hidden or collapsed, Ready still collapsed (slice 9 D3).
  3. "the device's kitchen columns: the Columns window lists Overview" — open Columns: the first row
     reads `t("station.overview")`.
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/till exec vitest run src/screens/till-station-screen.test.ts -t "the device's kitchen columns"`.
- [ ] **Step 3: Implement** D5 (one line); then edit changed checks 1, 2, 5, 7–10, 17 and 18, and
  those of 11–16 that Tasks 6a and 6b did not, as listed, and nothing else.
- [ ] **Step 4: Run; expect PASS**, Task 5's Step 1 command and Task 6a's Step 4 commands → every
  test passes; a failure not listed is a STOP.
- [ ] **Step 5:** typecheck till; eslint; `pnpm format:check`; ledger, with every changed check
  and its reason; `git commit -s -m "A797-9c: a kitchen screen opens with Overview first"`

### Task 8: A late card puts a red bar on its tab, and on its column when collapsed

**Files:**
- Modify: `apps/till/src/widgets/station-queue.ts` (D10: per column, `lateCards(inColumn, now)`;
  a tab with late cards gets `data-late` and a `.visually-hidden` `, ${t("station.late")}` with the
  number; a collapsed column's `[data-column-toggle]` the same; styles: `.column-tab[data-late] {
  box-shadow: 0 var(--wt-space-1) 0 var(--wt-color-danger); }`, `.collapsed
  .column-toggle[data-late] { box-shadow: inset 0 var(--wt-space-1) 0 var(--wt-color-danger); }`,
  the tab row's `row-gap: var(--wt-space-3)`)
- Test: `apps/till/src/widgets/station-queue.test.ts` (a new `describe("the late bar")`, with the
  file's `ageBill`/`ageDish` builders and `AGE_NOW`, `:3110-3140`), `station-queue.a11y.test.ts`

- [ ] **Step 1: Failing tests** (each name starts "the late bar:"; the danger colour is resolved
  before comparing: append a probe `span` styled `color: var(--wt-color-danger)` inside the
  widget's shadow root, read its computed `color` (an `rgb()` value, as `box-shadow` is computed),
  and remove it):
  1. "a tab whose column holds a late card carries it and says so" — at 390 px, an overdue card in
     Preparing and a fresh one in Waiting: `[data-column-tab="preparing"]` has `data-late` and the
     accessible name "Preparing 1, 1 late"; Waiting's tab has neither; Preparing's computed
     `box-shadow` contains the resolved danger colour.
  2. "the chosen tab keeps its bar" — choose Preparing: still `data-late`.
  3. "Overview's tab and a held card's column never carry it" — a held card only in Waiting: no
     `data-late` anywhere.
  4. "a collapsed column holding a late card carries the bar on its strip" — at 1280 px,
     `collapsed: ["preparing"]`: its `[data-column-toggle]` has `data-late`, the name "Preparing 1,
     1 late", a computed `box-shadow` containing the resolved danger colour and `inset`; open again
     (`collapsed: []`) → no `data-late`.
  5. "a hidden column's late card marks nothing but the header line" — `hidden: ["preparing"]`:
     no `data-late`; `[data-kitchen-counts]` still ends "· 1 late".
  6. "the bar holds still" — the late tab's and strip's `getAnimations()` are empty, with and
     without `reducedMotion`.
  7. "a late tab reads in Spanish" — `setLocale("es-ES")`, restored: the accessible name is
     `` `${t("station.state.preparing")} 1, ${t("station.late").replace("{n}", "1")}` ``, each word
     checked to differ from its English.
  8. a11y: "a late tab and a late strip have no violations", once per theme.
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/till exec vitest run src/widgets/station-queue.test.ts src/widgets/station-queue.a11y.test.ts -t "late bar"`.
- [ ] **Step 3: Implement** D10.
- [ ] **Step 4: Run; expect PASS**, then Task 5's Step 1 command → every test passes; from the root
  `pnpm exec vitest run scripts/style-token-names.test.ts scripts/primary-coloured-text.test.ts`.
- [ ] **Step 5:** typecheck till; eslint; `pnpm format:check`; ledger;
  `git commit -s -m "A797-9c: a late card marks its tab, and its column while collapsed, with a red bar"`

### Task 9: Docs, the user guides and the backlog follow the code

**Files:**
- Modify: `apps/server/src/guide/en/kitchen-service.md` (`## Work the kitchen screen
  {#kitchen-screen}`, `:120-146`), `apps/server/src/guide/es/kitchen-service.md` (the same section,
  `:137-169`), `docs/developers/design-system.md` (`### The kitchen screen's cards`, `:5485-5550`),
  `docs/backlog.md` (the A797 entry in the priority list, `:120-145`; the area entry, `:2704-2718`;
  the A773-2 entry, `:2087-2101`), `docs/backlog/till.md` (A797's entry, `:1034-1070`),
  `docs/superpowers/specs/2026-10-18-a797-device-screens-design.md` (§3.3's Overview bullet, `:310-312`;
  §3.3's slice 9 note, `:336-338`; §3.4, `:345-350`; §9's first bullet, `:723`: dated pointers)
- Test: `apps/server/src/guide-content.test.ts`, `scripts/guide-links.test.ts`

- [ ] **Step 1: Guides.** English, in the section: the first column, **Overview**, lists each dish
  waiting or being made with how many, and after a **+** how many more are held ("Pork shoulder
  1 +2"); its heading counts the dishes with something to make; it can be collapsed, moved or hidden
  like any column. Then: where the screen is too narrow for its columns, it shows one at a time,
  and the columns become tabs in the same order ("**Waiting · 2**"); tap a tab to see that column; a
  hidden column has no tab; to see the columns side by side again on that screen, hide a column in
  **Columns**; a tab whose column holds a late card has a red bar under it, and a collapsed column
  holding a late card has a red bar across its top. Spanish the same, with «Resumen», «Esperando ·
  2» (read the `es` block's `station.*` words before writing); Spanish only in the Spanish file.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and
  `pnpm exec vitest run scripts/guide-links.test.ts`; PASS.
- [ ] **Step 3: design-system.md**, in "The kitchen screen's cards": the first sentence names
  Overview among the columns; a paragraph: Overview's rows come from `overviewRows`
  (`apps/till/src/state/kitchen-overview.ts`) over `overviewDishes` (`kitchen-cards.ts`), one per
  kitchen name, making then "+held", rows with something to make first, its count the rows with
  something to make, the column not growing past `.column`'s basis; the board draws tabs when
  `columnsFit` (`apps/till/src/state/kitchen-board-fit.ts`) says its shown columns do not fit,
  measured on the host on every update; the tabs are the till's pressed pickers
  (`segmentedOptionStyles`) with `aria-pressed` in a `role="group"` row, in layout order, the first
  chosen until a tap, a column opened by its heading chosen when that stops the columns fitting, a
  collapsed column's tab still opening it; a late column's tab carries a `--wt-space-1`
  `--wt-color-danger` bar outside its fill and a collapsed late column an inset bar across its
  top, each with ", N late" in its name.
- [ ] **Step 4: Backlog** (in this PR, before `/finish-branch`; no docs-only push to `main` after
  the merge, per the watcher's note of 2026-10-27 ~06:53). Both A797 entries in `docs/backlog.md`
  and the one in `docs/backlog/till.md`: slice 9c (Overview, the first kitchen column, counting
  each dish to make with the held after a +; below the width its columns need, a kitchen board
  shows them as tabs; a late card's tab, and its collapsed column, carry a red bar) is delivered
  from the build plan's slice 9c, with no PR number (the queue file keeps it); what is left of
  A797: slices 10–11 once A803's slice 3 lands, 12b after A773-2. The **A773-2 entry** gains the
  hand-off, addressed to nobody: Overview on the pass calls `overviewRows` from
  `apps/till/src/state/kitchen-overview.ts` with its own `OverviewDish`es (D1), and builds no
  second aggregator; its `OverviewFact` needs `unitName` and `soldInEach` for a dish sold by weight
  to count one; once station dishes carry a requested phase, `overviewDishes` counts them as held;
  with Held as a fifth column a kitchen board needs 1148 px at standard text (`columnsFit`), a
  kitchen display's viewport about 1228 px, so a 1024 px display draws tabs unless a column is
  hidden or collapsed; the kitchen's tabs keep order and visibility but not collapse, which the
  pass's narrow list keeps (D9). Open no new entry unless the LOOK finds something this slice does
  not fix (its number from `~/waitron-campaign-shared/next-item-number`: read it, use it, write the
  next back).
- [ ] **Step 5: Design file.** After §3.3's Overview bullet: "_2026-10-27, slice 9c: one row per
  dish name, rows with something to make first; the count is the rows with something to make; the
  key "After the +: held" is not drawn; see the build plan's slice 9c, D2–D4, D6._" After §3.3's
  slice 9 note (`:336-338`, "has no mark of its own yet"): "_2026-10-27, slice 9c: it now carries
  the red bar; see the build plan's slice 9c, D10._" After §3.4: "_2026-10-27, slice 9c: the board
  draws tabs when its shown columns do not fit, by a measured rule (on a kitchen display, a viewport
  of about 985 px for the four default columns at standard text, 1183 px at 130%); the first tab is
  chosen until a tap; a collapsed column keeps its tab; a collapsed column holding a late card
  carries the red bar too; see the build plan's slice 9c, D7–D10._" After §9's first bullet:
  "(2026-10-27: the kitchen screen's switch is settled in the build plan's slice 9c, D7; the
  pass's is A773-2's.)"
- [ ] **Step 6: Check** `pnpm exec prettier --file-info docs/backlog.md` prints `"ignored": true`
  (wrap by hand); `pnpm format:check` for the guide files.
- [ ] **Step 7: Commit** `git commit -s -m "docs: A797-9c — guides, design system and backlog for Overview and the narrow tabs"`

### Task 10a (visual): LOOK at the switch, Overview and the tabs

Dispatched as one foreground subagent (`run_in_background: false`), not an implementer (it changes
no code), as slice 9b's LOOK was run (its scripts:
`/Users/clintongormley/waitron-campaign-c/a797-9b-scripts/`). It writes its report to
`/Users/clintongormley/waitron-campaign-c/a797-9c-look-report.md` (section "10a"), pictures under
`/Users/clintongormley/waitron-campaign-c/a797-9c-shots/`.

- [ ] **Step 1: Start the stack** `wa-wt demo waitron-feat-a797-9c-overview-narrow-tabs`; `wa-wt ls`
  for the URLs. Enrol one browser context as a kitchen display showing the demo's kitchen station
  screen, and one till context signed in, as slice 9b's LOOK did. Make food so Waiting, Preparing
  and Ready each hold a card, one dish appears on two cards, and one group is held. Leave the
  stack running for Task 10b.
- [ ] **Step 2: Find the switch.** On the kitchen display with the default columns, step the
  viewport width down from 1100 px by 10 px and record the first width that draws
  `[data-column-tabs]`; report it beside D7's expectation (a viewport of about 985 px, a board of
  905 px).
- [ ] **Step 3: Look** with the workspace's Playwright Chromium (the script in
  `/Users/clintongormley/waitron-campaign-c/a797-9c-scripts/`, never in the worktree, its process id
  recorded), on the kitchen display at **1280 px**, **1024 px**, **10 px over** and **10 px under**
  the switch, and on the till's Station screen at **390 px** (phone width), **light and dark**,
  **English and Spanish**:
  - Overview: its rows, counts and "+N"; held-only rows last; its heading count; collapsed
    («Resumen · N»);
  - the tabs: their order, the chosen one, «Esperando · 2»; tap each; a refresh (wait 15 s) keeps
    the chosen tab; the wrap at 390 px;
  - at 1024 px, a long dish name beside Overview (D7's owner FYI: expected cut with an ellipsis)
    and with Overview hidden (expected whole);
  - set the 1280 px light English picture beside picture 03
    (`docs/backlog/mockups/a797-device-screens/03-kitchen-screen.png`) and the 390 px picture
    beside picture 05's left (`05-narrow.png`), and describe each difference in the report: no
    "After the +: held" key (D6), a count in Overview's heading (D4), the row order (D3), no Held
    column (A773-2), the corner on its own row and the other slice 8–9b departures are expected;
    anything else is a finding.
- [ ] **Step 4: Save** each picture as `10a-<step>-<width>-<theme>-<lang>.png`, open each, and
  describe what was seen in the report and the ledger. Stop the script by its recorded id; leave
  the stack for 10b.

### Task 10b (visual): LOOK at the red bar, Columns, keyboard and reduced motion

The same kind of subagent, after 10a, on the same stack; section "10b" of the same report.

- [ ] **Step 1: A late card.** Lower the station's Waiting, Overdue and Forgotten after to 1, 2 and
  3 minutes (slice 8's LOOK Step 2), noting the values first, until a card is late.
- [ ] **Step 2: Look** (the same widths, themes and languages as 10a):
  - the red bar under the late card's tab, chosen and not, and across its collapsed column's top
    on a wide screen; none on an open column or on Overview;
  - Columns: Overview listed first; hide Overview → its tab goes; move Ready first → the tabs
    follow; collapse Preparing on a wide screen, then narrow the window: its tab still opens it;
    at 1024 px and 130% text (if the demo can set it) with Preparing and Ready collapsed, open both
    by their headings → tabs, with the last opened column's tab chosen (D9);
  - keyboard: Tab to the tabs, the focus ring, Enter and Space choose;
  - reduced motion asked for: nothing moves.
- [ ] **Step 3: Save** each picture as `10b-<step>-<width>-<theme>-<lang>.png`, open each, and
  describe what was seen in the report, the ledger and the PR body. Put back every demo setting
  changed, and leave the device's columns as the demo had them.
- [ ] **Step 4: Stop** what you started: the script's process by its recorded id, then
  `wa-wt down waitron-feat-a797-9c-overview-narrow-tabs`.

### Closing slice 9c

- Focused runs per task as above; CI runs the till's package suites and coverage (and the server's
  for the guides). Read the `changes` job's outputs and the till's coverage or merge job on the
  current head before calling the PR green. Code this slice leaves unreached is deleted, never
  excluded (Global constraints).
- `/finish-branch` with this plan named. Review path **LIGHT**: the plan-against-spec read, one
  Codex run-it review and the convention seat.
- PR body. First line: no venue reset. Then: **What a cook sees** (Overview first; tabs where the
  columns do not fit; the red bar on a late tab and a late collapsed column); **What A773-2
  reuses** (`kitchen-overview.ts`, D1); **Decisions** D1–D14 in one line each; **Changed test
  checks** (the 18 above, each with its reason, and the fixture-only files, with the probe's
  receipts); **New words** (`station.overview`, `station.overview_held`); **LOOK**.
- **Owner FYIs** (one line each in the PR and lane C's questions file): D2 (rows by name; a merged
  board's rows run across its stations); D3 (row order); D4 (Overview's count, and a number in its
  heading); D6 (picture 03's "After the +: held" and picture 07's "Counts each dish to make" are not
  drawn, with the proposed Spanish if wanted); D7 (the switch is a measured rule: a kitchen
  display's viewport of about 985 px for today's columns at standard text, 1183 px at 130% text,
  about 1228 px once A773-2's Held is shown unless a column is hidden or collapsed; and on a 1024 px
  display a dish line of about 30 characters, "2× Grilled octopus with paprika", is now cut beside
  Overview where it fitted before, and whole again with Overview hidden or collapsed); D9 (the first
  tab is chosen until a tap, not kept on the device; a collapsed column keeps its tab; in tabs
  nothing collapses a column, so only hiding a column in Columns, or a wider screen, brings the
  columns back); D10 (a departure from the owner's D14 answer, "the same red bar": same colour and
  thickness, but under a tab and inside the top of a collapsed strip).
- **Owner questions:** none.
- The hand-off for A773-2 is in its `docs/backlog.md` entry (Task 9), not addressed to a lane.
- After merge: delete the branch local and remote and check the remote one is gone; update the
  ledger and the queue file with the PR number (no docs-only push to `main`); A797's next slices
  wait for A803's slice 3 (10–11) and A773-2 (12b).

---

## Review path

**FULL** for slices 1 and 6 (migrations), 3, 4, 8b and 12b (what a server read sends the till, or
the zones a signed-in device works in); **LIGHT** for 2, 5, 7, 8, 9, 9b, 9c, 10 and 11. On every
slice the fresh-context plan-against-spec read and the Codex run-it seat run (global rules);
risk-trigger slices get the second Codex angle.
