# A797 — The fixed screens for the handheld, the kitchen screen and the pass: build plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Implementers are dispatched as `subagent_type: "implementer"`.

**Goal:** Build design §8's slices one pull request at a time. This plan outlines every slice and
gives **slice 4 — Zones on this device on a handheld** and **slice 5 — The Ready bar and remembered
List/Map** in full tasks; each other slice is expanded into tasks when it starts.

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
   slice 4 in #2041, so slices 1–3 are no longer barred; slice 5 is being built first, then 1
   (see "Build order now" in the slice 5 section)._
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
(design §9 proposes "T4+T5").

### Slice 2 — Short names, dashboard (LIGHT)

**Goal:** the Short name field (Q51 (g): «Nombre corto») in the floor-plan editor's table panel
(`apps/dashboard/src/screens/floor-plan-table-panel.ts`), Add tables' preview
(`floor-plan-add-tables.ts`) and Add joined table (`floor-plan-add-joined-table.ts`), proposed from
slice 1's function; the refusal under the field ("Terrace 1 already uses T1", «Terraza 1 ya usa
T1»). **Risks:** the proposal must be the same function the server uses (one home, shared
package). Forms rules (design-system.md → Forms): marked, explained beside the field, Save quiet
until the draft changes, a `*.unsaved.test.ts`. **Dependencies:** slice 1. **Migration:** no.

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
**Dependencies:** slice 1 (short names), and slice 4's ☰ entry. **Migration:** no.

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
(`packages/db/src/schema/kitchen-stations.ts:46-49`, warm < overdue < forgotten): changing a table's
CHECK makes drizzle rebuild the table (CLAUDE.md §3); check the ready-warning bound in the writer.
**Dependencies:** #2037 landed; slice 1's migration landed or not open. **Open decisions:** the
column name; whether the station editor's existing three fields keep their order with the fourth last.

### Slice 7 — The Ready bar's warning (LIGHT)

**Goal:** amber (`--wt-color-warning`), slow pulse (`--wt-duration-pulse-slow`), edge dimming to
`--wt-color-warning-pulse-dim`, the longest-waiting table first with its minutes ("🍽 Ready 4 min ·
…", «Listo 4 min»), judged per station against that station's own minutes; nothing moves under
reduced motion. **Dependencies:** slices 5 and 6. **Migration:** no. **Risks:** the clock is
`ready_at`, not the waiting clock's `queued_at` (design §5); a fake-timer browser test must advance
the awaited animation frame (CLAUDE.md §4).

### Slice 8 — Kitchen group cards (LIGHT)

**Goal:** design §3.3: one card per group in today's columns; tap a dish, or the heading (today's
per-dish route for each dish); the age band; the header line ("5 dishes to make · 1 late"); the
Tickets view and its switch go. **File set:** `apps/till/src/widgets/station-queue.ts` (card label
`:871`, `:946`, `:1021`), `apps/till/src/screens/till-station-screen.ts`, strings. **Risks:** lane G
edits the same files (take turns, design §7); #2037 changes `station-queue.ts` and the station
screen's bump mode (ran: `gh pr diff 2037 --name-only`), so the heading tap meets the per-station
bump mode it adds (design §9 asks the plan to trace it). **Dependencies:** #2037 landed, turn agreed
with lane G. **Migration:** no.

### Slice 8b — Short names on kitchen cards (FULL; a station read changes)

**Goal:** the station read carries each table's short name; the card shows it. **Dependencies:**
slices 1 and 8. **Migration:** no.

### Slice 9 — The Columns controller and collapse (LIGHT)

**Goal:** one device-scoped store of each screen's order, shown and collapsed columns, meeting
A773-2's interface (`readColumnState`, `saveColumnState`, `moveColumn`, `toggleColumnCollapsed`,
`setColumnVisible`, key `waitron.kitchenColumns.v1.`; A773-2 plan lines 101, 289–291); heading-tap
collapse ("Ready · 3"). **Risks:** whichever lane builds it first, the other uses it (design §7).
**Dependencies:** slice 8. **Migration:** no.

### Slice 9b — The corner Columns panel (LIGHT)

**Goal:** corner → Columns («Columnas»): Move up / Move down («Subir», «Bajar») and a Show switch
(«Mostrar») per column. A new dialog with staged input takes a draft scope and a
`*.unsaved.test.ts` (CLAUDE.md §3). **Dependencies:** slice 9. **Migration:** no.

### Slice 9c — Overview and the narrow tabs (LIGHT)

**Goal:** the Overview column («Resumen») with "Secreto ibérico 2 +2", built on the one counting
function A773-2's pass reuses; below about 1000 px the columns become tabs in the chosen order, a
late card's tab carrying a red bar. **Dependencies:** slice 9. **Migration:** no. **Open
decision:** the measured switch width (design §9).

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
| `till-app.ts:2444`, `:4206-4209` `handheldMode` | true for `phone-portrait` and `tablet-landscape` (`kindOfFormFactor`, `apps/till/src/layout.ts:25-38`) |
| `till-app.ts:5869-5890` `#menuMemory`, `#zoneMenuIdentity` | the sibling per-zone memory: `localStorage` behind a `try`, identity `{ origin: this.router?.current ?? location.origin, deviceId, profileId, zoneId }` |
| `apps/till/src/state/zone-menu-memory.ts:10-89` `ZoneMenuMemory` | the key `waitron.zoneMenu.${JSON.stringify([origin, deviceId, profileId, zoneId])}` (`:52`); an in-memory copy so a refused store still remembers for this app instance; a bad stored value is removed |
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
- **D3. The bar is drawn on a handheld at every width; a till keeps the summary at every width.**
  The floor gains `@property({ type: Boolean }) handheld = false`, which `TillApp` sets from
  `handheldMode`. **Why the form factor, not `PHONE_WIDTH`:** §3.1 says the bar "replaces at phone
  width today's summary" and "Above phone width the summary stays", but §3.2 says of a handheld on a
  tablet, whose screen is wider than 40rem: "The bar's
  table buttons, the Ready bar and its warning are as on a phone." Read together, phone width in §3.1
  is the phone's own section, and the split is handheld against till. A till at phone width is not a
  case the design draws. A width rule would also move the bar onto every test that mounts the floor
  at Vitest's default 414 × 896 frame (`apps/till/src/widgets/test-helpers.ts:108`), which is inside
  `PHONE_WIDTH`: the probe that drew the bar by width failed exactly the seven summary cases (below).
  On a handheld the summary's Open {station} buttons go with it; Kitchen stays in ☰ where the
  profile allows it (`till-app.ts:18224` `#allowsDestination("station")`, slice 4 D6's list).
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
  `floor.ready_bar_table` "{table} · {n}" / same; `floor.ready_bar_table_label` "{table}: {n}
  ready" / «{table}: {n} listos» (the screen-reader name of an entry; the card badge already counts
  with «listos», `strings.ts:921`, `:2659`); `floor.ready_bar_open` "Open ›" / «Abrir ›»;
  `floor.ready_bar_open_label` "Open {table}" / «Abrir {table}». Help (`help-strings.ts`, both
  languages): `help.floor.ready_bar` "Tables with food ready to take out. Tap one to open it; Open
  opens the first." / «Mesas con comida lista para llevar. Toca una para abrirla; Abrir abre la
  primera.» (slice 7 rewords "the first" when it reorders). No live region: the bar changes on every
  15-second read, and announcing each would talk over the waiter.
- **D6. Where the bar sits.** `position: fixed` at the bottom of the viewport, full width, above
  the safe area (`env(safe-area-inset-bottom)`), and no taller than the toasts' offset,
  `var(--wt-tap-min) + 2 * var(--wt-space-3)` (`till-app.ts:1756`), so the Sent and Served toasts
  that show on the Floor after a send sit above it rather than over it. While the bar shows, the
  floor's `.screen` gets the same `padding-block-end`, so the last row of tables can be scrolled
  clear of it. One line: "Ready" at the start and Open › at the end stay put, and the entries
  between scroll sideways when they do not fit. Colours, spacing and type from `--wt-*` tokens only
  (CLAUDE.md §3); the calm bar takes the floor's ready chip's colours. The LOOK (Task 7) checks it
  at 390 and 1024 px.
- **D7. A handheld's Floor re-reads every 15 s in list view too.** Today it re-reads only while the
  map shows (`#watchFloor`, `:994-1004`), and nothing else in `TillApp` re-reads the tables on a
  timer (read: `grep -n setInterval apps/till/src/till-app.ts` finds only the pending-payment re-read
  at `:17219`). A zone with no placed tables opens in list view (`:2261`), so without this the bar on
  such a zone would show what was ready when the person last opened the Floor. The rule becomes:
  re-read while the map shows **or the floor is a handheld's**. A till keeps today's rule, so the
  pinned case "does not ask while the list shows" (`till-floor-screen.refresh.test.ts:159`, which
  mounts no `handheld`) is unchanged. Cost: one `GET /api/tables/state` per handheld per 15 s,
  which a handheld on a map zone already makes. **Alternative, for the owner:** keep list view
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
  - **Per zone, also within the session:** `viewOverride` becomes a `ReadonlyMap<string, "map" |
    "list">` of this screen's taps by zone id, so a tap on Terrace no longer changes Inside. A floor
    with no zone on screen (the zone-menu suite's "a floor with no zones") keeps its tap for the
    session only, under no key.
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
broke no app suite. No `till-app*` fixture carries a `ready` signal (ran: `grep -ln 'kind: "ready"\|ready(\['`
over the till's tests → only four floor-screen files: `.a11y`, `.precedence`, `.signals`, `.steps`).
D7 (polling) and D8's storage were not probed; Task 5's and Task 3's commands name the suites to
run. Any other failure is a STOP.

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
6. **A handheld on a list-view zone when food becomes ready.** The bar appears within 15 s (D7).
   Task 5 pins it with fake timers.

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
- [ ] **Step 3: Implement** D8's per-zone override: `viewOverride: ReadonlyMap<string, FloorView>`;
  `#toggleView` writes a new map under `this.#zone.activeKey` and, when that key is defined, calls
  `viewMemory?.remember`; `view = viewOverride.get(key) ?? viewMemory?.read(key) ?? derived`; add
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
  (text `floor.ready_bar_table`, `aria-label` `floor.ready_bar_table_label`) and
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
  6. "says it in Spanish" — `setLocale("es")`: the word «Listo», "Mesa 2 · 3", «Abrir ›», label
     «Abrir Mesa 2», an entry's label «Mesa 2: 3 listos».
  In `till-floor-screen.signals.test.ts` "says it in Spanish" (`:336-338`): expect «Listo» (the
  section's one changed check, Q51 (f) 8; ledger).
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/till exec vitest run src/screens/till-floor-screen.ready-bar.test.ts src/screens/till-floor-screen.signals.test.ts`.
- [ ] **Step 3: Implement** D3–D5: the property, the bar's markup and plain styles (layout and
  fixing it in place are Task 4b), the strings, the help badge, and `#stationSummary` returning
  `nothing` on a handheld. The summary's comment (`:2908`) gains "A handheld draws the Ready bar
  instead."
- [ ] **Step 4: Run; expect PASS**, then the floor suites (Task 3's Step 4 command). Expected: all
  pass; the seven summary cases the probe failed pass because they mount no `handheld`.
- [ ] **Step 5:** typecheck till; eslint; format check; `pnpm exec vitest run scripts/english-only.test.ts`;
  ledger (the changed Spanish check); `git commit -s -m "A797-5: a handheld's Floor shows the Ready bar"`

### Task 4b: The Ready bar stays at the foot of the screen, readable in both themes

**Files:**
- Modify: `apps/till/src/screens/till-floor-screen.ts` (the bar's styles; `.screen`'s
  `padding-block-end` while the bar shows)
- Test: `apps/till/src/screens/till-floor-screen.ready-bar.test.ts` (layout cases),
  `apps/till/src/screens/till-floor-screen.a11y.test.ts` (new case, run by its existing light and
  dark `describe`s)

- [ ] **Step 1: Failing tests.**
  1. Layout, with `pageAt(390, 844)` then `pageAt(1024, 768)` (`test-helpers.ts:117`, undone by
     `resetPage`): the bar's bottom edge equals the viewport's; its height is at most
     `tap-min + 2 × space-3` read from the computed tokens (D6); with eight entries the word and
     Open › are both fully inside the viewport and the entries' strip scrolls sideways
     (`scrollWidth > clientWidth`) instead of wrapping; with enough tables to scroll, scrolling to
     the end leaves the last card's bottom above the bar's top.
  2. a11y: "has no violations with the Ready bar, on the list" — `handheld: true`, two ready
     tables, at 390 and 1024 px, in English and Spanish, axe as the file's other cases do; the bar's
     text has the contrast axe requires in both themes.
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/till exec vitest run src/screens/till-floor-screen.ready-bar.test.ts src/screens/till-floor-screen.a11y.test.ts`
  — the layout case (the bar is still in the flow).
- [ ] **Step 3: Implement** D6 with `--wt-*` tokens only (guards: `packages/ui/src/no-hardcoded-chrome.test.ts`
  reads `packages/ui` alone, so check by eye that no hex, `rem` or `em` is added;
  `scripts/style-token-names.test.ts` checks the names). Text in the brand colour, if Open › is
  drawn so, reads `--wt-color-primary-text` (CLAUDE.md §3).
- [ ] **Step 4: Run; expect PASS**, then the floor suites (Task 3's Step 4 command) and
  `pnpm exec vitest run scripts/style-token-names.test.ts scripts/primary-coloured-text.test.ts`.
- [ ] **Step 5:** typecheck till; eslint; format check; ledger; `git commit -s -m "A797-5: the Ready bar stays at the foot of a handheld's Floor"`

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
  3. "stops when the screen leaves" for a handheld in list view, as the existing case
     (`:180`) does for the map.
  The till's case "does not ask while the list shows" runs unchanged and must still pass.
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/till exec vitest run src/screens/till-floor-screen.refresh.test.ts`.
- [ ] **Step 3: Implement** D7.
- [ ] **Step 4: Run; expect PASS**, then the floor suites (Task 3's Step 4 command).
- [ ] **Step 5:** typecheck till; eslint; format check; ledger; `git commit -s -m "A797-5: a handheld's Floor keeps its Ready bar current in list view"`

### Task 6: The till app hands the Floor its form factor and the device's memory

**Files:**
- Modify: `apps/till/src/till-app.ts` (the floor mount `:18205-18227`: `.handheld=${this.handheldMode}`
  and `.viewMemory=${this.#floorViewChoices()}`; new `#floorViewChoices()` beside `#menuMemory`
  `:5869`, cached by `origin` and `deviceId`, `undefined` without a `deviceId`, storage obtained as
  `:5871-5876` does)
- Test: `apps/till/src/till-app-device-zones.test.ts` (a new `describe` inside "a handheld's zones",
  `:1140`, reusing `mountHandheld` `:1177` and `tableIn` `:1146`); clear `waitron.floorView.` keys
  in its `afterEach`, as `till-app-parties.test.ts:11279` clears its own prefix

- [ ] **Step 1: Failing tests** (both handheld form factors where cheap):
  1. "a handheld's Floor draws the Ready bar for its chosen zones only" — choice `["room"]`, a
     ready party at a `room` table and one at a `garden` table: the bar lists only the `room` table;
     a till (the file's `mount`) with the same tables draws the summary and no bar.
  2. "List or Map survives a reload on this device, per zone" — toggle the Floor's view on `room`;
     unmount and mount again with the same device id: `room` opens in the tapped view and `garden`
     in its default; `localStorage` holds exactly one `waitron.floorView.` key, naming `device` and
     `room`.
  3. "another device id in the same browser starts from the default" — mount with device id
     `other`: `room` opens in its default view.
  4. "a refused store still keeps the choice for this session" — `vi.spyOn(Storage.prototype, "setItem")`
     throwing: the toggle works, and selecting another zone and coming back keeps it.
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/till exec vitest run src/till-app-device-zones.test.ts`
  — case 1 (no `handheld` is passed, so the summary shows), case 2 (nothing is stored).
- [ ] **Step 3: Implement** the two bindings and `#floorViewChoices()`.
- [ ] **Step 4: Run; expect PASS**, then the app suites the probe ran:
  `pnpm --filter @waitron/till exec vitest run src/till-app src/screens/till-counter-cleanup.look src/widgets/guide-sheet`
  (the probe: 43 files, 4361 tests, all passed; read the count). A failure is a STOP.
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
  linked; slices 1–3 next (#2037 landed). If the owner should weigh D1, D3 or D7's alternative, one
  line each in the PR's Owner FYI, not the backlog.
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
  checks** (one: `till-floor-screen.signals.test.ts` "says it in Spanish", «Listo para servir» →
  «Listo», Q51 (f) 8); **Decisions** D1–D8 in one line each; **Till behaviour changes**: the
  summary's title, and List/Map now per zone and remembered on a till too; **Handheld behaviour
  changes**: the bar replaces the summary and its Open {station} buttons, and the Floor re-reads in
  list view (D7); **LOOK** (what the screenshots showed). First line: no venue reset.
- **Owner FYI** (one line each in the PR and the lane's questions file, not questions): D1 (the bar
  follows the zone choice; the till's summary does not), D4 (Open › opens the first table until
  slice 7 can order by waiting time), D7 (list view now re-reads on a handheld).
- After merge: delete the branch local and remote and check the remote one is gone; update the
  ledger; then slice 1.

---

## Review path

**FULL** for slices 1 and 6 (migrations), 3, 4, 8b and 12b (what a server read sends the till, or
the zones a signed-in device works in); **LIGHT** for 2, 5, 7, 8, 9, 9b, 9c, 10 and 11. On every
slice the fresh-context plan-against-spec read and the Codex run-it seat run (global rules);
risk-trigger slices get the second Codex angle.
