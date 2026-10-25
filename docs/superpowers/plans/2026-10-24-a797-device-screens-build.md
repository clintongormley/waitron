# A797 — The fixed screens for the handheld, the kitchen screen and the pass: build plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Implementers are dispatched as `subagent_type: "implementer"`.

**Goal:** Build design §8's slices one pull request at a time. This plan outlines every slice and
gives **slice 4 — Zones on this device on a handheld**, **slice 5 — The Ready bar and remembered
List/Map**, **slice 1 — Short names, data** and **slice 2 — Short names, dashboard** in full
tasks; each other slice is expanded into tasks when it starts.

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
    the single short name for one. The proposals are of the automatic names. There is no
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
  by `sameTable` (like `keptSize`). The check refuses "+" only when the trimmed short name differs
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
  the Short name refusal at 390 px, and Task 8 adds what it shows to A1103's entry.

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
  `savedShortName?: string`, set by `draftFromPlan` only from a non-null read, never sent and not
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

## Review path

**FULL** for slices 1 and 6 (migrations), 3, 4, 8b and 12b (what a server read sends the till, or
the zones a signed-in device works in); **LIGHT** for 2, 5, 7, 8, 9, 9b, 9c, 10 and 11. On every
slice the fresh-context plan-against-spec read and the Codex run-it seat run (global rules);
risk-trigger slices get the second Codex angle.
