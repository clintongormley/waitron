# A797 — The fixed screens for the handheld, the kitchen screen and the pass: build plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Implementers are dispatched as `subagent_type: "implementer"`.

**Goal:** Build design §8's slices one pull request at a time. This plan outlines every slice and
gives **slice 4 — Zones on this device on a handheld** in full tasks; each other slice is expanded
into tasks when it starts.

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
   `kitchen_stations`, which #2037 also changes).
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
so the zone question above is real). **Migration:** no.

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
and opens on the chosen first zone, and a table in a zone the device does not show cannot take new
dishes on this device. Worked example 6 (design §4): Luis unticks Inside and Bar; his Floor shows no
zone tabs, while a manager's phone with the same profile still shows all three.

**Review path: FULL.** Which zones a signed-in device works in. No server route changes (D5), so
no till route stops refusing or starts serving; the FULL path is for the device-scope change.

**Migration: none.** The choice is already stored per device and profile with no form-factor
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

- **D1. A handheld reads, edits and follows its zone choice exactly where a till does**, through one
  predicate in `TillApp`: `#choosesZones(): boolean` — true for `till`, `phone-portrait` and
  `tablet-landscape`, false for `kds` and an unknown form factor. It replaces the till-only gates at
  `till-app.ts:5001` (the sign-in read), `:9099` (`#openDeviceZones`), `:9150` (`#deviceZoneAllows`)
  and `:9156` (`#readLiveDeviceZones`). **Why:** the owner's standing rule "any device does
  everything except the cash drawer" (design §1) gives a handheld the till's feature without a
  question; these four gates are the whole of what keeps it off a handheld (the reader table above).
- **D2. A handheld's Floor is handed the zones its choice keeps, of every kind its Floor shows
  today.** `deviceZoneNavigation`'s handheld branch changes from "table zones only" to "every chosen
  zone", still with no Counter (`counterZoneIds: []`, home `"floor"`), and `till-app.ts:17754` filters
  by `floorZoneIds` whenever a choice is held, on a till or a handheld. **Why:** today a handheld's
  Floor is handed every zone of the profile, counter zones included (`till-app.ts:17754-17756`), and
  A740 kept it so on purpose: "the screen's existing non-seating refusals and occupied-table recovery
  remain available to the other form factors" (`docs/superpowers/plans/2026-10-16-a740-zones-on-device.md:24-25`).
  A till can drop counter zones from its Floor because it has a Counter; a handheld has none
  (`built-in-screens.ts:7-8`). So the choice narrows; it does not also change which kinds a
  handheld's Floor shows. With no stored choice every profile zone is chosen
  (`device-zone-selection.ts:76-78`), so a handheld nobody has set up shows what it shows today —
  provided every floor zone `/api/zones` returns for the profile is also one of the profile's
  service zones the choice lists (`listServiceZones`, read, not run; Task 4's case 1 pins it). The
  table-only branch in `device-zones.ts:17` was never reached on a handheld (D1's gates), so no
  screen loses it. **Alternative, for the owner if wanted:** table zones only on a handheld too, as
  the till's Floor ("Floor contains only selected table zones", `docs/developers/design-system.md:5338`);
  it would take a counter zone's tables off every handheld, chosen or not.
- **D3. A table in a zone the handheld does not show cannot take new dishes on that handheld**, as on
  a till: `#deviceZoneAllows` (D1) feeds `orderingAllowed` (`till-app.ts:17783`, `:17917`), which
  the order screen reads where it adds dishes — the menu browser is made inert at
  `till-table-order-screen.ts:2188`, and `:1368`, `:1589`, `:2179` (read). Such a table is still
  reachable (Find a bill, a transfer, a resumed table); what else its screen allows there is not
  changed by this slice. **Why:** the till's
  choice already means "the zones this device works in" — it refuses to hide a zone with an open
  order (`#hidesOrderZone`, `:9139-9147`) — so the handheld gets the same meaning, not a weaker one.
- **D4. `profileServiceZones` on a handheld keeps coming from the offers route**, not from the
  choice: `till-app.ts:5005` and `:9224` set it from the choice only on a till; `:5033` stays. **Why:**
  it is the department-transfer accept list (`till-app.ts:18791`; `apps/till/src/widgets/department-transfers.ts:246-251`,
  `:604`), which this slice does not change. (Observed, not changed: on a handheld that list holds
  only the profile's counter zones, because the route's `zones` are counters only, `till-api.ts:1537-1541`,
  `:1566-1568`; on a till it holds every profile zone. Recorded for the backlog in Task 5, not fixed here.)
- **D5. No server route changes.** `GET`/`PUT /api/device/zones` have no form-factor gate
  (`device-api.ts:362-394`, read), and a handheld already saves through them: the case
  "phone-portrait keeps its profile start instead of a stored Till display preference" PUTs a
  handheld's choice and expects 200 (`apps/server/src/till-api.profile-zones.test.ts:1919-1946`;
  ran: `pnpm --filter @waitron/server exec vitest run src/till-api.profile-zones.test.ts -t "keeps its profile" --reporter=verbose`
  → `Tests 4 passed`, both handheld form factors, both cases). A refusal there would have answered
  4xx and failed that `toBe(200)`. **`GET /api/default-service-zone/offers` keeps its handheld
  branch** (context = the profile's start, every profile counter listed). **Why:** on a handheld
  that route's context is not where the Floor opens (the Floor opens on the choice's first zone,
  `till-app.ts:17758-17763`); it sets the counter basket's zone, the menu poll's extra zone
  (`till-app.ts:2696-2700`) and the receipt print mode used after a payment (`:5036`, `:17500`).
  Following the choice there would change a handheld's receipt step in a venue whose zones print
  receipts differently — not something the spec asks. The two existing handheld cases (`:1899`,
  `:1919`) keep pinning it unchanged. So no row is added to the route maps atop
  `till-api.profile-actions.test.ts` (its `/api/device/zones` row, `:48`, already says "no selling
  action for display preferences") or `till-api.profile-zones.test.ts` (`:101-102`).
- **D6. ☰ on a handheld gains "Zones on this device" at every width**, after Profile and before
  Equipment, emitting the `open-device-zones` event `TillApp` already handles (`till-app.ts:18339`).
  It is a new `BarItem` `"zones"` that, like Find a bill, is always in ☰ and never on the bar
  (`till-shell.ts:493-506` adds `find-bill` to the moved set the same way). Its help badge is a new
  key `help.more.zones`. Two consequences in the shell: ☰ is now drawn on every handheld bar
  (`:1008` draws it only when the moved set is not empty), and the brand's test at `:996`, which
  shows "Waitron" only when nothing but Find a bill is in ☰, must ignore `zones` too, or the brand
  never shows on a handheld (read, while making the probe's edit). **Why:** design §3.1 puts Settings — Zones on this device first — in ☰ on a
  handheld at every width ("Everything else is in ☰"), and §3.6's settings table names "☰ → Settings".
  It is its own entry rather than a handheld copy of the till's Settings dialog because slice 3
  builds §3.1's "Settings:" group in ☰ with Zones on this device and the card reader and printer as
  separate entries; a dialog here would be built only to be taken out. Equipment keeps its place and
  behaviour. **After this slice a handheld's ☰ shows**, at phone width: Find a bill (when the person
  may), Pass, Kitchen, My schedule, Profile (two or more profiles), **Zones on this device**,
  Equipment, Transfers (when offered), the person's name with clock actions, My hours, Fix my hours,
  Log out and the theme choice, then the language chooser when the bar cannot hold it
  (`#items`, `till-shell.ts:674-733`; `#menu`, `:844-871`; `#operatorActions`, `:769-842`). Above phone width the bar keeps what fits as today and
  Zones on this device stays in ☰.
- **D7. Copy.** The ☰ entry is the dialog's own title, "Zones on this device" / «Zonas en este
  dispositivo» (`device_zones.title`, `apps/till/src/i18n/strings.ts:65`, `:1818`). The dialog's
  explanation already says "this device" (`:66-67`, `:1819-1820`) and needs no change. New help text
  (both in `apps/till/src/i18n/help-strings.ts`): `help.more.zones` = "Chooses which of this
  profile's zones this device shows, and which opens first." / «Elige qué zonas de este perfil
  muestra este dispositivo y cuál se abre primero.» `help.more.settings` keeps "on this till": it
  is the till's Settings and true there.
- **D8. Hiding a zone that holds a table's unsent dishes says so in a table's words.** Today one
  message covers both the counter basket and a table's New order: "Park, send or cancel this order
  before hiding its zone." (`device_zones.order_in_zone`, `strings.ts:82`; shown at
  `till-app.ts:9249`, `:18378`). A table's screen offers no Park (ran: `grep -nE 't\("[a-z_.]*(park|hold)[a-z_]*"\)' apps/till/src/screens/till-table-order-screen.ts`
  → nothing), and a handheld has only tables, so on a handheld the message names an action it
  cannot take. The string predates this branch (ran: `git blame -L 82,82 apps/till/src/i18n/strings.ts`
  → `d99a9f403`, 2026-10-20). New key `device_zones.table_order_in_zone`: "Send or remove the unsent
  dishes before hiding their zone." / «Envía o quita los platos sin enviar antes de ocultar su
  zona.», after `bill_pay.unsent`'s wording (`strings.ts:1466`, `:3181`); shown when the hidden
  order is a table's, on a till too. The counter basket keeps its message, so the cases that pin it
  (`till-app-device-zones.test.ts:262`, `:949`) do not change.

### Changed test checks (from the probe; the implementer confirms each)

The probe (D1–D4 in the till app, D2 in `device-zones.ts`) ran these 14 files: `src/state/device-zones.test.ts`,
`till-app-allergy`, `till-app-bill-payments`, `till-app-handheld-pay`, `till-app.nfc`,
`till-app.notices`, `till-app-drafts`, `till-app-kitchen-note`, `till-app-parties`,
`till-app-table-service`, `till-app-open-table`, `till-app-menu-refresh`, `till-app-device-zones`,
`till-app-boot-and-counter` (ran: `pnpm exec vitest run <those files>` in `apps/till` of the probe
worktree → `Test Files 1 failed | 13 passed (14)`, `Tests 2 failed | 2377 passed (2379)`). The two
failures were exactly:

- `src/state/device-zones.test.ts` "phone-portrait retains its Floor home and never gains a Counter"
  and "tablet-landscape retains …" — expected `floorZoneIds: ["room"]`, `startingZoneId: "room"`;
  after D2 they are `["bar", "room"]` and `"bar"` (the chosen first zone, a counter zone, now shown on
  a handheld's Floor). Reason: D2. The name still holds (Floor home, never a Counter).

The same probe then ran the other 25 `till-app*` suites and the 13 other files that mount
`TillApp` (ran: `pnpm exec vitest run` on `src/till-app-adjustments`, `-allergy.editor-recovery`,
`-allergy.move`, `-allergy.recovery`, `-counter-adjustments`, `-counter-cancel-credit`,
`-counter-move-station`, `-fingerprint-refusal`, `-floor-layout`, `-menu-timetable`,
`-service-steps`, `-setup-refresh`, `till-app.a11y`, `.attendance.a11y`, `.attendance`,
`.attendance.unsaved`, `.clock.a11y`, `.clock`, `.help-mode`, `.hours`, `.hours.unsaved`,
`.nfc.a11y`, `till-app.test.ts`, `.theme`, `.unsaved-changes`, seven `src/screens/till-table-order-screen.*`
suites, `till-counter-cleanup.look`, `adjustment-dialog.combined(.a11y|.unsaved)`, `guide-sheet`,
`sent-orders.reorder.a11y`, `till-shell.device-zones.look` → `Test Files 38 passed (38)`,
`Tests 1936 passed (1936)`). So D1–D4 break no app test beyond Task 2's two.

**Probe 2 (D6, the shell).** The probe then added D6 to `till-shell.ts` (with the brand fix; its
help badge borrowed `help.more.settings`, where the build uses the new `help.more.zones`) and ran
every `src/widgets/till-shell*.test.ts`, `src/screens/device-screens.phone-margin.test.ts`,
`src/screens/till-counter-screen.layout.test.ts`, every `src/till-app*.test.ts`,
`src/widgets/guide-sheet.test.ts`, `src/screens/till-counter-cleanup.look.test.ts` and
`src/state/device-zones.test.ts` (ran: `pnpm exec vitest run <those>` → `Test Files 3 failed |
50 passed (53)`, `Tests 31 failed | 4486 passed (4517)`). The 31 are Task 2's two and these 29 in
two shell files, every one a count or list of ☰'s contents that now holds one more entry; none
failed on a layout overflow or a wrong event. Each changes for one reason, **D6: ☰ on a handheld
now always holds Zones on this device beside Find a bill.**

- *☰ "holds only Find a bill" (`:scope > *` length 1 becomes 2)*, in `till-shell.test.ts`: "draws
  the wide handheld header with Find a bill in More and every other button in priority order";
  "switches layout as the screen narrows and widens, keeping the one language chooser"; under
  "till-shell above phone width": "moves the transfers, and what ranks below Pass and Kitchen, into
  More before them, then Kitchen first, with full in en-GB", the same "with full in es-ES", "with a
  compact handheld in en-GB" and "in es-ES"; "names the bar's transfers button with the short name
  in en-GB, keeping the dialog's full title" and "in es-ES"; "labels Log out en-GB's short word, in
  the name menu and inside More, keeping the counter header's full name" and "es-ES's"; "keeps Pass
  and Kitchen on a compact handheld's Spanish bar at 800 wide when its measured width fits there";
  "puts every item back on the bar, and the name, once the screen is wide enough"; "keeps the
  visible count as the status while the transfers are on the bar"; "waits for an open More to close
  before giving items back to a wider bar"; "keeps every item in an open More when an item earlier
  in the leaving order appears"; "leaves kiosk mode cleanly while a fit begun in kiosk mode is still
  under way"; "keeps fitting after it is taken off the page and put back".
- *☰ absent when nothing has left the bar (now present)*: "refits when actions are added, and gives
  them back when they go".
- *A list or count of controls gains the entry*: "fits the header, every button on screen, at
  phone width in en-GB with phone-portrait", the same "with tablet-landscape", "in es-ES with
  phone-portrait", "in es-ES with tablet-landscape" (11 controls become 12); "puts every action
  button, the operator's name and the transfer count in one menu, by touch"; "reaches every action
  by keyboard" (the tab order gains the entry after Profile); "keeps More in the bar's order,
  showing only the items that left" (`find-bill`, then `zones`); "offers Profile before Equipment
  only when the device can switch profile, emitting open-profile" (Zones on this device now sits
  between them; the check becomes Profile, Zones on this device, Equipment).
- *Help badges*, in `till-shell.menu-help.test.ts` under "till-shell's menu badges": "with help on,
  More shows a badge beside exactly the options that have help: handheld"; "turning help on from
  the bar while More is open shows the badges at once" (both: the list of badged options gains
  Zones on this device); "on the bar an option with help stays a plain button, with no row" (its
  query found Zones on this device's row in ☰; narrow it to the bar).

The rest — the till's `till-shell` cases, `till-shell.help*`, `.a11y`, `.device-zones`,
`.counter-cleanup`, `.pass`, the phone-margin and counter-layout suites and all 38 `till-app*`
suites — passed with D1–D4 and D6 together.

### Review focus (inputs the spec implies and today's tests may not pin)

1. **A handheld with a stored choice under one profile switches to another profile.** The choice is
   per device and profile (`schema/device-zone-selection.ts:12`), and a switch re-runs the sign-in
   read (`till-app.ts:5001` sits in `#enterSignedIn`, which a switch calls). Expected: the Floor shows
   the new profile's own choice (or all its zones if none is stored), never the old one's. Task 4
   pins it.
2. **A stored choice naming a zone the profile no longer allows.** The read drops it and marks
   `adjusted` (`device-zone-selection.ts:76-83`); the 15-second live read (D1) brings the change.
   Expected on a handheld: that zone's tab goes from the Floor; if the handheld has an unsent order at
   a table there, the narrowing waits with a message in a table's words (D8; `#hidesOrderZone`),
   and applies once the dishes are sent. Task 4 pins both.
3. **Two devices with the same profile choose differently.** Each keeps its own (the key is the
   device, `schema/device-zone-selection.ts:12`). A till and a handheld cannot share a profile: the
   form factor is the profile's column (`deviceProfiles.formFactor`, read at `device-api.ts:691`),
   and the trigger `device_profile_form_factor_locked` refuses changing it while an active device
   uses the profile (`packages/db/src/trigger-refusals.ts:41`, read). So the case is two handhelds,
   as in worked example 6 (Luis's phone and a manager's phone). Task 1 pins it on the server; Task 4
   pins the client side.
4. **`GET /api/default-service-zone/offers` on a handheld whose profile's start zone is a zone its
   choice hides.** Expected (D5): the route still answers the profile's start; the Floor still opens
   on the choice's first zone; a table in a chosen zone takes dishes (`orderingAllowed` true) and no
   error shows. Task 4 pins it.
5. **The zone choice cannot be read at a handheld's sign-in** (a transient failure). On a till this
   path shows the zones error (`till-app.ts:5040-5064`). Expected on a handheld: the Floor shows the
   profile's zones unnarrowed (no choice held, `#deviceNavigation()` null), the error line shows, and
   the next poll tick applies the choice. Task 4 pins it — a handheld never took this path before.

---

**Task order and why.** The server pin first (Task 1, no product change); the navigation function
(Task 2); the ☰ entry (Task 3, shell only); the app (Task 4, which uses the shell's real click);
the docs, guide and backlog (Task 5); the LOOK (Task 6). Each task leaves the tree green.

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

### Task 2: `deviceZoneNavigation` keeps every chosen zone on a handheld's Floor

**Files:**
- Modify: `apps/till/src/state/device-zones.ts:13-23`
- Test: `apps/till/src/state/device-zones.test.ts` (`:91-106` changes; one new case)

**Interfaces:**
- Produces (unchanged signature): `deviceZoneNavigation(formFactor: FormFactor, selection: DeviceZoneSelection): { counterZoneIds: readonly string[]; floorZoneIds: readonly string[]; startingZoneId: string | null; home: "counter" | "floor" | null }`.
  For `phone-portrait`/`tablet-landscape`: `counterZoneIds` `[]`; `floorZoneIds` every chosen zone
  the profile still offers, in `selection.zones` order, any kind; `startingZoneId` the chosen first
  zone if among them, else the first of them, else `null`; `home` `"floor"` unless `startingZoneId`
  is `null`. `till` and `kds` unchanged.

- [ ] **Step 1: Change the two cases' expectations and add one.** "%s retains its Floor home and
  never gains a Counter" now expects `{ counterZoneIds: [], floorZoneIds: ["bar", "room"],
  startingZoneId: "bar", home: "floor" }` (Changed test checks, D2). New case "%s shows only the
  chosen zones and drops one the profile no longer offers": `selectedZoneIds: ["garden", "foreign"]`,
  `startingZoneId: "foreign"` → `{ counterZoneIds: [], floorZoneIds: ["garden"], startingZoneId:
  "garden", home: "floor" }`.
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/till exec vitest run src/state/device-zones.test.ts`
  — the changed cases print `floorZoneIds` `["room"]` against `["bar","room"]` (this is what the
  probe printed).
- [ ] **Step 3: Implement** the handheld branch per the Interfaces block.
- [ ] **Step 4: Run; expect PASS** (read the `Tests` count: 7 at `c4d7ffa3f` (ran, the probe printed `7 tests | 2 failed`) plus 2 new, the new case being an `it.each` over both handheld form factors).
- [ ] **Step 5:** typecheck till; eslint; format check; ledger (the changed case names); commit
  `git commit -s -m "A797-4: a handheld's Floor keeps every zone its choice shows"`

### Task 3: A handheld's ☰ offers Zones on this device

**Files:**
- Modify: `apps/till/src/widgets/till-shell.ts` (`BarItem` `:42-50`, `#moved` `:493-506`, `#items`
  `:674-733`), `apps/till/src/i18n/help-strings.ts` (`help.more.zones`, en `:35` area, es `:79` area)
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
  `open-device-zones`. (b) "a till offers no Zones entry outside Settings": `formFactor: "till"` → no
  `.zones` anywhere. In `till-shell.menu-help.test.ts`, add `help.more.zones` to the table of
  options with help (beside `:325`'s Settings row).
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/till exec vitest run src/widgets/till-shell.test.ts src/widgets/till-shell.menu-help.test.ts`
  — (a) finds no `.zones`.
- [ ] **Step 3: Implement** D6 and D7's help text: `"zones"` in `BarItem`; `zones: false` in
  `#present`'s table (it never leaves the bar because it is never on it); `moved.add("zones")` in
  `#moved` beside `find-bill`; the button in `#items` directly before Equipment's; the brand test
  at `:996` ignores `zones` as it ignores `find-bill`. Add a case to (a): above phone width with
  room to spare the brand still shows.
- [ ] **Step 4: Update the 29 checks Probe 2 lists**, each only as its group says (a count one
  higher, a list with the entry in its place, a query narrowed to the bar). Each changes because
  the spec puts Zones on this device in ☰ at every width (D6); list each in the ledger with that
  reason. A failing shell case not in Probe 2's list is a STOP.
- [ ] **Step 5: Run** the shell suites `pnpm --filter @waitron/till exec vitest run src/widgets/till-shell.test.ts src/widgets/till-shell.menu-help.test.ts src/widgets/till-shell.help.test.ts src/widgets/till-shell.help-phone.test.ts src/widgets/till-shell.help.a11y.test.ts src/widgets/till-shell.a11y.test.ts src/widgets/till-shell.device-zones.test.ts src/widgets/till-shell.counter-cleanup.test.ts src/widgets/till-shell.pass.test.ts`;
  PASS with nonzero counts. Typecheck till; eslint; format check.
- [ ] **Step 6: Ledger and commit** `git commit -s -m "A797-4: a handheld's More offers Zones on this device"`

### Task 4: The till app reads, edits and follows a handheld's zone choice

**Files:**
- Modify: `apps/till/src/till-app.ts` (`:5001-5006`, `:9098-9108`, `:9149-9156`, `:9222-9224`,
  `:17752-17757`; new private `#choosesZones()` beside `#deviceZoneAllows`)
- Test: `apps/till/src/till-app-device-zones.test.ts` (new `describe("a handheld's zones")`)

**Interfaces:**
- Consumes: Task 2's `deviceZoneNavigation`; Task 3's `open-device-zones` from the ☰ entry.
- Produces: `#choosesZones(): boolean` (D1).

- [ ] **Step 1: Failing tests.** Add a `mountHandheld(chosen, formFactor = "phone-portrait", over = {})`
  helper that calls the file's `mount` with `getTill` and `getDeviceIdentity` answering that form
  factor, and `listZones` answering three table zones Inside, Terrace, Bar plus the file's counter
  zone `bar` renamed to avoid a clash (fixture choice is the implementer's; the three names come from
  worked example 6). Cases, each `it.each(["phone-portrait", "tablet-landscape"])` where cheap:
  1. "reads the device's zones at sign-in and narrows Floor to them" — `api.getDeviceZones` called
     once; the floor's `.zones` ids equal the chosen ones; `.selectedZoneId` the chosen first zone;
     and with every zone chosen (no stored choice) the floor's `.zones` equal what `listZones`
     answered (D2's proviso).
  2. "with one zone chosen the Floor shows no zone tabs (worked example 6)" — choice Terrace only:
     the floor's `nav.tabs` is absent; with all three chosen it is present with three tabs.
  3. "keeps a chosen counter zone on the handheld's Floor" — choice includes a `prepay` zone: it is
     among the floor's `.zones` (D2).
  4. "the More entry opens the zones dialog and a save narrows the Floor" — real click on ☰ →
     `.zones` (Task 3); `till-device-zones-dialog` opens; saving Terrace only calls `setDeviceZones`
     once and the floor's `.zones` become Terrace.
  5. "a profile switch shows the new profile's own zones" (Review focus 1) — `getDeviceZones`
     answers profile A's choice, then after a switch profile B's; the floor follows B.
  6. "a live narrowing waits for an unsent order in the hidden zone" (Review focus 2) — the
     handheld has an unsent draft at a Bar table; the poll tick answers a choice without Bar:
     `[data-device-zones-pending]` reads "Send or remove the unsent dishes before hiding their
     zone." (D8) and the Floor keeps Bar until the draft is sent, then drops it. The same text in
     the zones dialog when a save would hide it.
  7. "a hidden zone's table takes no new dishes; a shown one does, whatever the profile's start"
     (Review focus 4, D3) — `listDefaultZoneOffers` context is Inside, choice Terrace only: the
     table order screen's `orderingAllowed` is `false` at an Inside table and `true` at a Terrace
     table, and no `[role=alert]` error shows.
  8. "a failed zones read at sign-in leaves the Floor unnarrowed and the next tick applies the
     choice" (Review focus 5).
  9. "the transfer accept list stays the offers route's zones" (D4) — `till-department-transfers`'s
     `.serviceZones` equals the route's `zones`, not the choice's.
  10. "a kitchen display reads no zones" — `formFactor: "kds"`: `getDeviceZones` never called.
- [ ] **Step 2: Run; expect FAIL** `pnpm --filter @waitron/till exec vitest run src/till-app-device-zones.test.ts`
  — cases 1–8 fail (no `getDeviceZones` call on a handheld; Floor unnarrowed; `#openDeviceZones`
  returns at `:9099`); 9 and 10 already pass (they pin what must not change).
- [ ] **Step 3: Implement** D1–D4: add `#choosesZones()`; use it at `:5001`, `:9099`, `:9150`, `:9156`;
  set `profileServiceZones` from the choice only when `this.formFactor === "till"` (`:5005`,
  `:9224`); hand the Floor `floorZoneIds`' zones whenever `#deviceNavigation()` is not `null`
  (`:17754`). Leave `:5008` (a till with no counter) and `:5033` as they are. D8: let
  `#hidesOrderZone` (`:9139-9147`) say which order hides the zone (the counter basket or a table's),
  and pick `device_zones.order_in_zone` or `device_zones.table_order_in_zone` at `:9249` and
  `:18378`; add the new key in English and Spanish (`apps/till/src/i18n/strings.ts`).
- [ ] **Step 4: Run; expect PASS**, then the app suites that drive a handheld or the zone choice
  (the probe's list): `pnpm --filter @waitron/till exec vitest run src/state/device-zones.test.ts src/till-app-allergy.test.ts src/till-app-bill-payments.test.ts src/till-app-handheld-pay.test.ts src/till-app.nfc.test.ts src/till-app.notices.test.ts src/till-app-drafts.test.ts src/till-app-kitchen-note.test.ts src/till-app-parties.test.ts src/till-app-table-service.test.ts src/till-app-open-table.test.ts src/till-app-menu-refresh.test.ts src/till-app-device-zones.test.ts src/till-app-boot-and-counter.test.ts`
  and the other app suites Probe 2 ran (`src/till-app*.test.ts`, `src/widgets/guide-sheet.test.ts`,
  `src/screens/device-screens.phone-margin.test.ts`). Expected: all pass (the probes: no app suite
  failed). A handheld fixture whose `getDeviceZones` omits a zone its test uses is a
  fixture fix ("Fixture-only" list), not a changed check; anything else is a STOP.
- [ ] **Step 5:** typecheck till; eslint; format check; ledger; commit
  `git commit -s -m "A797-4: a handheld follows its Zones on this device"`

### Task 5: Docs, the user guides and the backlog follow the code

**Files:**
- Modify: `apps/server/src/guide/en/table-service.md`, `apps/server/src/guide/es/table-service.md`
  (a new section in each), `docs/developers/design-system.md:5279-5289`, `:5338-5344`,
  `docs/backlog.md:120-126`, `:2689-2700`, `docs/backlog/till.md:1012-1027` and the A740 decision
  record `:1720-1733`, `docs/superpowers/specs/2026-10-18-a797-device-screens-design.md` (status
  line, §10)
- Test: `apps/server/src/guide-content.test.ts`, `scripts/guide-links.test.ts`

No user guide mentions Zones on this device today (ran: `grep -rniE "zones on this device|zonas en este dispositivo" apps/server/src/guide`
→ nothing), so there is nothing till-only to correct; the till's feature and the handheld's get one
section together.

- [ ] **Step 1: Guides** — add, after "Clear a service step", `## Choose the zones this device shows {#device-zones}`
  (English) and `## Elige las zonas que muestra este dispositivo {#device-zones}` (Spanish), each
  three to five sentences: where it is (☰ → Settings → Zones on this device on a till; ☰ → Zones on
  this device on a phone or tablet), what it does (shows a subset of the profile's zones and which
  opens first; with one zone shown the Floor has no zone tabs), that it is kept per device and
  profile, that it grants nothing the profile does not allow, and that a table in a hidden zone takes
  no new dishes on this device. No Spanish word outside the Spanish file.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and
  `pnpm exec vitest run scripts/guide-links.test.ts`; PASS.
- [ ] **Step 3: design-system.md** — `:5338` "On a till, Settings → Zones on this device…" becomes
  the rule for both: a till's under ☰ → Settings, a handheld's under ☰ → Zones on this device; a
  till's Floor shows only chosen table zones, a handheld's every chosen zone (D2). In the handheld
  paragraph (`:5285-5289`) add "Zones on this device stays in More, like Find a bill."
- [ ] **Step 4: Backlog** — the two A797 entries and `till.md`'s A182 entry: Q51 answered
  2026-10-24 (all recommended; the Ready warning time in each prep station's editor), so nothing
  waits for Q51; slice 4 in review with this plan linked; the build order (slice 4, then 5, then 1–3
  after #2037). Add a dated line to the A740 decision record (`till.md:1720`): a handheld has the
  same choice in ☰ → Zones on this device; it narrows its Floor (every kind of zone it shows) and
  new dishes at a hidden zone's tables; its new-order start stays the profile's (D5). Add one short
  backlog entry in the till area for D4's observation (a handheld's transfer accept list holds only
  counter zones), worded as observed (read), not as a bug confirmed by a run.
- [ ] **Step 5: Design** — status line: "Q51 answered 2026-10-24: all recommended; (c)'s Ready
  warning time in each prep station's editor; build plan `docs/superpowers/plans/2026-10-24-a797-device-screens-build.md`".
  Under §10 add the answer in one paragraph. Under §5's last bullet add one dated sentence: "The plan
  (D5) keeps `/api/default-service-zone/offers` unchanged on a handheld."
- [ ] **Step 6: Check** `pnpm exec prettier --file-info docs/backlog.md` prints `"ignored": true`
  (docs are not formatted; wrap by hand). `pnpm format:check` for the guide files.
- [ ] **Step 7: Commit** `git commit -s -m "docs: A797-4 — guides, design system and backlog for Zones on this device on a handheld"`

### Task 6 (visual): LOOK at a handheld's zones

- [ ] **Step 1: Start the stack** from the worktree: `wa-wt demo waitron-feat-a797-4-handheld-zones`;
  `wa-wt ls` gives the till and dashboard URLs. The demo floor has three zones, Dining room,
  Terrace and Downstairs bar (`apps/server/scripts/demo-seed/floor.ts:61-63`).
- [ ] **Step 2: Make two handhelds.** Enrol two browser contexts as devices on the Handheld profile
  («Móvil», `packages/layouts/src/device-profile.ts:148-150`) from the dashboard's Devices page (a
  dev box approves a join at once, but the till still asks which device a tab is), and give that
  profile all three zones in the dashboard if it lacks them.
- [ ] **Step 3: Look** with the workspace's Playwright Chromium (a short script kept in
  `/Users/clintongormley/waitron-campaign-c/a797-4-scripts/`, never in the worktree), signed in, at
  **390 px** (phone) and **1024 px** (tablet), in **light and dark**, English and Spanish: ☰ → Zones
  on this device → the dialog (its four columns at 390 px: does anything overflow or wrap
  badly?) → untick Dining room and Downstairs bar → Save → the Floor shows Terrace with **no zone
  tabs**; tick two → two tabs; set Opens first and sign out and in → the Floor opens there.
- [ ] **Step 4: Compare** — on the second handheld (same profile, no choice saved) all three zone
  tabs still show (worked example 6).
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
  slot; slice 5 next); **Changed test checks** (one line per test, from the ledger: Task 2's two
  `device-zones.test.ts` cases, Task 3's 29 ☰ checks, grouped as in Probe 2); **Fixture-only** (if any); **Decisions**
  D1–D8 in one line each; **No server route change** with D5's receipt; **LOOK** (what the
  screenshots showed). First line: no venue reset.
- After merge: delete the branch local and remote and check the remote one is gone; update the
  ledger; then slice 5.

---

## Review path

**FULL** for slices 1 and 6 (migrations), 3, 4, 8b and 12b (what a server read sends the till, or
the zones a signed-in device works in); **LIGHT** for 2, 5, 7, 8, 9, 9b, 9c, 10 and 11. On every
slice the fresh-context plan-against-spec read and the Codex run-it seat run (global rules);
risk-trigger slices get the second Codex angle.
