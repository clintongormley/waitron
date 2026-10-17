# A768 — the till opens a table fast and stops needing a reload: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opening a table on the till shows its order after one round trip instead of two or three. A
till that stays open picks up a change to the venue's courses (and the other venue settings from its
start read) without a page reload.

**Architecture:** The till keeps the last menu it read for each service zone. When a table opens in a
zone it already holds, the till shows that menu at once and checks it with the cheap
`/api/menu-state` read. It reads the whole menu again only when the check says the menu moved. A new
`liveFields` digest makes that check see a dish's course or reporting category change, which no menu
version records. The draft being left is saved in the background. The order screen appears at once
with a loading state. For settings, `/api/menu-state` also carries `setupRevision`, a digest of what
`GET /api/till` would answer for this device. When the digest moves, the till reads `/api/till` again
and applies its venue-wide values.

**Tech Stack:** TypeScript, Lit (till), Hono (server), drizzle on `node:sqlite`, Vitest 4.1.11
(browser mode in real Chromium for `apps/till`).

**Spec:** `docs/backlog/till.md#a768-the-till-open-a-table-fast-and-stop-needing-a-reload` and the
A768 entry in `docs/backlog.md`. The owner's text is quoted under "The item" below, because Task 9
deletes both entries.

### The item (owner, 2026-10-16), verbatim

> Two halves that share one idea: keep what the till has read, and ask the server cheaply whether it
> changed.
>
> - **Opening a table takes a second or two.** The order screen appears only after, in turn: the
>   draft being left is saved (`#flushDraft`); the zone's whole menu is re-read (`listZoneOffers`,
>   every open, the same zone included); for a seated table with no main bill, its bills; then its
>   lines and bills beside the draft. Time each step on a till first. Then keep each zone's menu and
>   check it with the existing `/api/menu-state` read (`MenuStatePoll` already does this for the
>   counter's zone and the open table's), re-reading only when it moved; switch to the order screen
>   at once with a loading state; and stop waiting on the save of the order left.
> - **Settings read once at page load go stale.** The till takes the venue's courses from its start
>   read (`listCourses`, `apps/server/src/till-api.ts`; `this.courses = till.courses`,
>   `apps/till/src/till-app.ts`) and never again. Seen 2026-10-16: no course headings or course
>   pickers on a table's unsent order until the till page was reloaded. Courses first; then every
>   other value from that read (bump mode, fire control, card provider, tips, receipt languages and
>   the rest) is either refreshed while the till is open or recorded as fixed until reload, with why.

The queue adds: measure before and after (requests, and time to open a table). The review path is
FULL: the work touches live-update sources, a till read path and a cross-package contract
(`packages/module/src/module.ts`). No migration.

---

## Measurements taken while writing this plan (BEFORE)

### 1. A table open in the till, every read delayed by a fixed 100 ms

The probe is a throwaway browser test, reproduced in Appendix A. Run on 2026-10-17 at base
`ed0be7d89`: Node v26.11.1, Vitest 4.1.11, Chromium through `@vitest/browser-playwright`. It mounts the
till over the `till-app-drafts.test.ts` fixtures. Every read on the open path answers after 100 ms;
the other reads answer at once. It counts the requests each open sends and times two moments: when the
order screen element appears ("shown"), and when its draft is ready ("ready").

The prediction written before the run, so that the run could disprove it: if today's code re-reads the
menu on every open, the second open in an already-read zone sends one `listZoneOffers`. The order
screen then appears after about 200 ms (two reads one after the other), or about 300 ms when the draft
being left still has an unsaved edit. A second open printing zero `listZoneOffers` would have meant the
probe was not measuring today's code.

Command (after recreating the file from Appendix A):

```sh
cd apps/till && AI_AGENT= CLAUDECODE= pnpm exec vitest run src/till-app-a768-probe.test.ts | grep A768-PROBE
```

Three runs:

| Open | shown = ready (ms), runs 1 / 2 / 3 | Requests the open sent |
| --- | --- | --- |
| First table in zone z1 | 235 / 248 / 235 | `listZoneOffers` 1, `getTabLines` 1, `listGroups` 1, `listPrintProblems` 1, `readCurrentOrders` 1, `getPartyBills` 1, `listDrafts` 1, `listStations` 1 |
| Second table, same zone, nothing to save | 211 / 232 / 239 | the same eight, `listZoneOffers` included |
| Back from a table with an unsaved edit, then another table | 307 / 311 / 284 | the same eight, plus the floor's `getTablesState` |
| A seated table with no main bill | 330 / 332 / 337 | `listZoneOffers` 1, `getPartyBills` 1, `listDrafts` 1, `listStations` 1 |

Two waits are visible here: the menu read always comes before the reads of the table's order, and
the open waits for the left draft's save (it was sent from Back to floor). With no main bill, the
bills read sits between them as well. In every case "shown" equals "ready": nothing appears until
every read has answered. The probe gives no `menuState` count, because the 15-second poll did not tick
during these opens. `getBillBalance` was not called.

### 2. What each read costs on the server

The probe is a throwaway server test, reproduced in Appendix B. It provisions a signed-in till with one
zone and one published menu of N dishes, then sends 60 requests to each route in process with
`app.request`. There is no network, so these are server times and response sizes only. Same date,
base and Node version:

| Dishes | `GET /api/service-zones/:z/offers` median / p90 ms, bytes | `GET /api/menu-state?zoneId=` median / p90 ms, bytes | `GET /api/till` median / p90 ms, bytes |
| --- | --- | --- | --- |
| 20 | 4.90 / 5.78, 20 431 | 6.32 / 7.32, 601 | 0.47 / 0.62, 529 |
| 80 | 4.60 / 5.33, 78 811 | 5.86 / 6.44, 601 | 0.41 / 0.49, 529 |
| 200 | 5.32 / 6.51, 195 671 | 5.87 / 6.33, 601 | 0.40 / 0.53, 529 |

So on the server `menu-state` costs about as much as the full offers read; it is no cheaper in server
time or in turns of the write lock. What it saves is the answer's size: about 1 KB per dish for the
offers read against a fixed 0.6 KB, and the till's work turning that answer into a grid. This plan
gets its speed from reading in parallel and not waiting. It asks the cheap read in place of the big
one only where the till already holds the menu. The start read costs well under a millisecond, which
is what Task 2 adds to each `menu-state` read.

### 3. On a real till page: Task 0, before any product change

The owner asked for each step to be timed on a till. That is Task 0, and it is mandatory, before and
after (Task 8). It was not taken while writing the plan. The only stack running on this machine on
2026-10-17 was `waitron-local-santet-data`, the owner's real-data venue; signing in to it would have
written a session row there. A stack of this worktree's own can run beside it: `wa-wt` gives a new
start the first slot nothing listens on and leaves a slot another running instance holds alone
(`slot_for_instance` in `~/.local/bin/wa-wt`; `docs/developers/workflow-guide.md`, "The dev stack
from a worktree"). Task 0 runs on this branch before Task 1 lands, while its product code is still
base `ed0be7d89` (the branch holds only this plan).

#### Real till page, BEFORE

Taken 2026-10-17 on this branch at `009c1a8c4` (product code is base `ed0be7d89`), Node v26.11.1,
the workspace's Playwright Chromium (headless, 1280×800). Stack: `wa-wt demo
waitron-feat-a768-till-open-table-fast`, which took slot 0 (till `http://localhost:5190`, server
`localhost:8080`; the owner's `waitron-local-santet-data` held slot 1 and was not touched). Data set:
the demo seed already in slot 0's shared venue, not reset. The till is the Vite dev server
(unbundled modules) and the server is on the same machine, so there is no network delay in these
numbers. Device `Mostrador` (counter till), waiter Lucía Fernández, PIN `5555`, Dining room. Before
the runs, tables 1–4 of the Dining room were seated with two guests each by `seat.mjs`
(`POST /api/tables/:id/seat`), and they were left seated for Task 8. Each run tapped House bread
on table 2, so table 2's unsent draft grew by one line per run.

The script is Appendix C, kept in `/tmp/a768-real-till/`. Commands:

```sh
node /tmp/a768-real-till/seat.mjs        # once, to seat tables 1–4
node /tmp/a768-real-till/measure.mjs 5   # five runs, each in a fresh browser signed in afresh
```

Each run opens table 1 (the first open after sign-in), Back to floor, waits 500 ms, opens table 2,
taps Tapas → House bread, Back to floor at once, then opens table 3. A run's time starts at the
click's `pointerdown` and stops at the first animation frame in which a `[data-draft-pane]` (found
through shadow roots) has a non-zero width. The requests are every `/api/` request from the click
until 1.5 s after that moment. Before the run, a failing probe would have shown no
`GET /api/service-zones/<zone>/offers` for an open; every open of every run listed exactly one.

| Open | shown (ms), runs 1–5 | median | Requests the open sent (each once) |
| --- | --- | --- | --- |
| First seated table in the zone (table 1) | 581 / 542 / 547 / 523 / 561 | 547 | 8: `service-zones/:id/offers`, `parties/:id/groups`, `parties/:id/print-problems`, `parties/:id/current-orders`, `working-orders/:id/lines`, `parties/:id/bills`, `parties/:id/drafts`, `stations` |
| Back, then a second seated table, same zone (table 2) | 542 / 414 / 552 / 521 / 499 | 521 | the same 8, plus `GET /api/node` in all five runs |
| Tap a dish, Back at once, then another party's table (table 3) | 588 / 540 / 445 / 405 / 615 | 540 | the same 8, plus `GET /api/tables/state` |
| A seated table with no main bill | not measured | — | the demo floor has none: seating each of tables 1–4 gave its party a `mainBillId` |

Every request in a window is a `GET`: no draft save fell inside the third case's window. The
script did not record when, or whether, the left draft's save was sent. I did not establish why `GET /api/node` fell inside the
second case's window in every run.

## Measurements taken after the change (AFTER, Task 8)

### 1. The till probe, AFTER

Taken 2026-10-17 16:44 on this branch at `26bb32862`, Node v26.11.1, Vitest 4.1.11, Chromium through
`@vitest/browser-playwright`. Appendix A, recreated with Task 8's two changes: "ready" waits for
`screen?.draftStore && !screen.loading`, and "loadingShown" is the first moment `screen` exists. So
"shown" and "loadingShown" are the same moment by construction. Same command as BEFORE:

```sh
cd apps/till && AI_AGENT= CLAUDECODE= pnpm exec vitest run src/till-app-a768-probe.test.ts | grep A768-PROBE
```

What an unchanged build would print, written before the run: the second open with `listZoneOffers: 1`
and ready at about 200 ms or more. Three runs:

| Open | loading screen shown (ms), runs 1 / 2 / 3 | ready (ms), runs 1 / 2 / 3 | BEFORE shown = ready (ms) | Requests the open sent |
| --- | --- | --- | --- | --- |
| First table in zone z1 | 10 / 6 / 15 | 233 / 223 / 253 | 235 / 248 / 235 | the same eight as BEFORE, `listZoneOffers` included |
| Second table, same zone, nothing to save | 19 / 10 / 5 | 120 / 114 / 113 | 211 / 232 / 239 | `menuState` 1 in place of `listZoneOffers`; the other seven unchanged |
| Back from a table with an unsaved edit, then another table | 7 / 8 / 6 | 113 / 108 / 124 | 307 / 311 / 284 | `menuState` 1 in place of `listZoneOffers`, the other seven, plus the floor's `getTablesState` |
| A seated table with no main bill | 7 / 8 / 7 | 266 / 241 / 250 | 330 / 332 / 337 | `menuState` 1 in place of `listZoneOffers`, `getPartyBills` 1, `listDrafts` 1, `listStations` 1 |

No open sent `listZoneOffers` except the first, so the run disproves the unchanged-build prediction.
The no-main-bill open came out at 241–266 ms, above the 200–240 ms Task 8 expected; every other open
fell inside its expected range. `saveDraft` and `getBillBalance` were not called inside any open.

### 2. Real till page, AFTER

Taken 2026-10-17 16:45 on this branch at `26bb32862`, same machine, Node and Chromium as the BEFORE
table. Stack: `wa-wt demo waitron-feat-a768-till-open-table-fast`, which took slot 0 again (till
`http://localhost:5190`, server `localhost:8080`; `waitron-local-santet-data` held slot 1 and was
not touched). The same venue, not reset: device `Mostrador` kept its id, and tables 1–4 were still
seated from Task 0, so `seat.mjs` was not rerun. The stack was stopped after the run with
`wa-wt down waitron-feat-a768-till-open-table-fast`.

`measure.mjs` now also records the first frame in which a `[data-loading]` line (found through shadow
roots) has a non-zero width; -1 means no frame showed it. "Ready" is the BEFORE table's "shown": the
first frame with a visible `[data-draft-pane]`. Command:

```sh
node /tmp/a768-real-till/measure.mjs 5
```

What an unchanged build would print, written before the run: one
`GET /api/service-zones/<zone>/offers` on every open of every run, and no loading line.

| Open | ready (ms), runs 1–5 | median | BEFORE median | loading line (ms), runs 1–5 | Requests the open sent (each once) |
| --- | --- | --- | --- | --- | --- |
| First seated table in the zone (table 1) | 407 / 405 / 494 / 411 / 507 | 411 | 547 | -1 / -1 / 343 / -1 / -1 | the BEFORE 8, `service-zones/:id/offers` included |
| Back, then a second seated table, same zone (table 2) | 451 / 369 / 429 / 581 / 435 | 435 | 521 | 369 / -1 / -1 / -1 / -1 | 9: `menu-state?zoneId=:id` in place of the offers read, the other 7, plus `GET /api/node` in all five runs |
| Tap a dish, Back at once, then another party's table (table 3) | 487 / 457 / 493 / 537 / 382 | 487 | 540 | -1 / -1 / -1 / -1 / 321 | 9: `menu-state?zoneId=:id` in place of the offers read, the other 7, plus `GET /api/tables/state` |
| A seated table with no main bill | not measured | — | — | — | the demo floor still has none |

No second or third open sent an offers read, so the run disproves the unchanged-build prediction.
The loading line was seen in only 3 of the 15 opens, at 321–369 ms after the click, and never in
the first 300 ms. The probe shows it within 20 ms. I did not establish why the real page draws no
frame with the loading line in most opens, nor when it draws its first frame after the click.
Every request in a window is a `GET`: no draft save fell inside the third case's window.

---

## Global Constraints

- No migration. No backwards-compatibility code (Waitron is pre-production).
- Product text as short as the meaning allows; the loading line is `Loading…` / `Cargando…`.
- Error codes name the domain concept. This plan adds none.
- Comments: only an invariant or a non-obvious why the code cannot show; never history.
- Every commit `git commit -s`. Never `--no-verify`. Run `pnpm format:check` before each commit.
- Focused tests only: `pnpm --filter <pkg> exec vitest run <files>`. Read the `Tests` count in the
  output; a run that prints no count is no evidence. Before a browser run, check
  `memory_pressure | grep free` and run beside another session's browser run only when free memory is
  well above 15%.
- `apps/till` tests run in real headless Chromium. To see a passing test's `console.log`, unset
  `AI_AGENT` and `CLAUDECODE`.
- Coverage holds `98/98/98/95` in every package touched. Never close a gap with an ignore comment.
- Other lanes are editing `apps/till` now. Lane G's `feat/a773-1-unsent-list` touches `till-app.ts`
  around lines 8585–8960 and 9441–10571, plus `client.ts`, `till-table-order-screen.ts`, the draft
  state files and `apps/server/src/till-api.ts`. Lane F's `feat/a652-photo-framing` may touch
  `menu-browser.ts` and `till-ticket-view.ts`. Keep edits on the lines this plan names, and do not
  touch those branches. The lines that will meet on rebase are listed at the end.
- An implementer that passes about 150 tool calls with its task unfinished stops at a passing (or
  cleanly failing) point, commits, and returns a handover: what is done, what is left, the files, and
  the state of each check.

## Review Focus

These are the five inputs the item implies but no single task's happy path exercises. Each line
names the test that pins it and the task that owns that test.

1. **A second table opened while the first is still loading, across two zones** (one held, one
   not). The first open's late answers must never show beside the second table. Pinned by Task 6a's
   "a second open during the first's loading shows only the second table".
2. **Leaving a draft whose save is still out, then signing out, or coming back to its party.** No
   edit may go out under the next person's session, and the save must answer before the session's
   logout is sent. Pinned by Task 4's "signing out closes a draft still saving in the background".
   Coming back (A, then B, then A again) must show A's saved edit, never the draft read before the
   save landed. Pinned by Task 4's "A, B, then A again waits for A's own save".
3. **A menu republished while the zone was off screen.** The held menu shows for one round trip; then
   the check reads the new version, and a dish already in the draft goes through the existing refresh
   dialog (D9). It must not stay silently at the old price. Pinned by Task 3b's "a menu published
   while the zone was off screen is read again when the table opens".
4. **Courses changing under an open draft.** The new headings and pickers arrive; the draft's lines
   and their courses stay as the person left them. Pinned by Task 7's "new courses reach an open
   table without a reload".
5. **An open that fails or is left after the screen switched** (an unheld zone whose menu read
   fails, a free table whose seating is refused, Back while seating). The till goes back to where
   the waiter was and shows the error; it is never stuck on "Loading…"; and lines carried to a
   table being seated are never lost. Pinned by Task 6a's failure cases and Task 6b's "Back during
   seating keeps the carried lines".

---

## Decisions made in this plan (for the reviewer)

- **The cheap check needs a digest of the live fields.** A zone's offers carry three things from the
  current product rows rather than from the published version: each dish's availability, its course
  and its reporting category (`applyLiveFields`, `packages/catalogue/src/menu-document.ts:516`).
  `/api/menu-state` already reports availability (`unavailable`), and already reads those same rows
  to do it (`readUnavailable` → `readLiveRows`). Without a digest of course and category, keeping the
  menu would stop the till noticing a dish moved to another course, which today's re-read on every
  open does notice. Hashing rows the read already holds adds no query.
- **`setupRevision` rides on `/api/menu-state`, not on a read of its own.** Each read takes a turn of
  the venue write lock (the comment at the poll's `zones:` option, `apps/till/src/till-app.ts:2205`).
  A separate settings read every tick would add one turn per tick per device. Inside the existing
  `menu-state` transaction it adds no turn: only the start read's own selects (tenant, location,
  courses, profile, reader, receipt languages), measured above at 0.40–0.47 ms for the whole start
  read, against about 6 ms for `menu-state`. A tick reads `menu-state` once per zone it holds (the
  counter's, and the open table's when that differs), so this is paid once or twice per 15 s. Task 2
  measures the cost again after the change.
- **On the till, `liveFields` and `setupRevision` are optional fields; on the server they are
  required.** About 30 till test files type their fixture menus as `ZoneOfferCatalogue` or
  `MenuState`, and an answer that carries neither field compares equal to one that carries neither.
  This choice saves editing all of those fixtures and colliding with lane G's test files. The server
  always sends both fields.
- **The order screen shows a held menu at once, and does not wait for the check.** Waiting would
  hang every till fixture whose `menuState` never answers. It would also add a round trip whenever
  the menu moved. The window this leaves is the same one the 15-second poll leaves today while a
  table is open: a dish tapped in it is checked by the existing D9 flow.
- **While a table is loading, the till behaves as if the waiter were still on the floor.** Every part
  of the till that asks "is a table's order showing?" (`#tableCatalogueActive()`) says no while the
  open is under way, which is what it said before this change during the same moments. Only the
  render shows the order screen early.
- **An open started from Find a bill keeps today's behaviour: no early switch.** The order screen is
  pushed when the open completes, as before this change. `#onFindBillOpen` abandons the open once
  Find a bill is no longer showing, so switching to the loading order screen at once would end the
  open it started. Task 9's docs say so.

## Decisions for the owner to check (each has a default; nothing waits on them)

1. **A held menu shows at once, and is checked in the background.** If the menu changed since this
   till last opened the zone, the old menu shows for one round trip before the new one replaces it.
   Default: show at once.
2. **The till keeps each zone's menu across sign-outs.** It forgets them when the page reloads or
   the till moves to another server. Default: keep them, since a menu does not depend on who signed
   in.
3. **Opening a table of a party whose draft is still saving waits for that save**, behind the
   loading line, so the draft read for that party cannot answer before its own save. That happens
   on reopening the same party, or coming back to it while its save is out. Default: wait in those
   cases only.
4. **Profile values stay as they are today:** form factor, capabilities, idle logout, starting
   screen, and whether clocking is available. They change the till's layout and which screens it
   offers. Applied mid-session, they could take away the screen the person is on, so they are
   applied only at boot, on a profile switch, and when the device's zone selection changes. At
   those points the till already lays itself out again and waits for requests out
   (`#reconcileSavedDeviceZones`). The server list stays as it is too: the till's router follows the
   primary on its own. Default: as today, recorded in the docs.
5. **A kitchen screen in device mode does not refresh its bump mode or fire control until reload.**
   It runs no menu poll. Default: left as a new backlog entry.
6. **The department name on a table's screen comes from the held menu**, so a rename shows when the
   zone's menu next moves, or after a reload. Default: accepted.
7. **A failed open goes back to the floor with the error**, the outcome today, now after a brief
   loading screen. Default: as described.

---

## File map

| File | Change | Task |
| --- | --- | --- |
| `packages/catalogue/src/menu-document.ts` | `readLiveState` replaces `readUnavailable`; `applyLiveFields` also returns `liveFields` | 1 |
| `packages/catalogue/src/index.ts` | export `readLiveState` in place of `readUnavailable` | 1 |
| `packages/module/src/module.ts` | `liveFields: string` on `ZoneMenuState` and `ZoneOffers` | 1 |
| `packages/venue-service/src/operations.ts` | `menuState` and `listZoneOffers` return `liveFields` | 1 |
| `apps/server/src/till-setup.ts` (new) | `readTillSetup`, `setupRevisionOf` | 2 |
| `apps/server/src/till-api.ts` | `/api/till` uses them; `/api/menu-state` adds `setupRevision` | 2 |
| `apps/till/src/api/client.ts` | optional `liveFields` / `setupRevision` on the client types | 3a, 7 |
| `apps/till/src/till-app.ts` | zone memory, live-field check, detached left draft, early switch, setup refresh | 3a–7 (3a, 3b, 3c, 4, 6a, 6b, 7) |
| `apps/till/src/screens/till-table-order-screen.ts` | `loading` property | 5 |
| `apps/till/src/i18n/strings.ts` | `table.loading` | 5 |
| `apps/till/src/till-app-open-table.test.ts` (new) | open-path regression tests | 3a–6b |
| `/tmp/a768-real-till/measure.mjs` (outside every checkout, never committed) | real-till timings | 0, 8 |
| `apps/till/src/till-app-setup-refresh.test.ts` (new) | settings refresh tests | 7 |
| `docs/backlog.md`, `docs/backlog/till.md`, `docs/developers/conventions-ui.md`, `CLAUDE.md` | docs | 9 |

---

### Task 0: Time table opens on a real till page, BEFORE any product change

Run this task before Task 1 is committed. The branch then holds only this plan, so its product code
is base `ed0be7d89`. If Task 1 has already landed, do it from a throwaway worktree instead:
`git worktree add --detach /tmp/a768-base ed0be7d89`, then `pnpm install` in it, and
`git worktree remove /tmp/a768-base` afterwards. Never swap files in a working checkout. The script
lives outside every checkout (`/tmp/a768-real-till/measure.mjs`), so root lint never scans it.

- [ ] **Step 1: Start your own stack.** Run `wa-wt ls`, then
  `wa-wt demo waitron-feat-a768-till-open-table-fast`, which seeds the demo venue on the first free
  slot. A slot held by another running instance is left alone. Note the till URL it prints (slot 1
  is `http://localhost:5290`). Never `wa-wt down` or `reset` an instance you did not start.
- [ ] **Step 2: Write the script.** Import Chromium from the workspace's own Playwright:
  `import { chromium } from "<worktree>/apps/till/node_modules/playwright/index.mjs"`. The script
  opens the till URL. It picks a till device in the dev chooser (a dev tab remembers its device in
  `localStorage["waitron.devDeviceId"]`, `apps/till/src/api/dev-device.ts`). It signs in a waiter
  with the demo PIN `5555` (`apps/server/scripts/demo-seed/staff.ts:6`) and goes to the floor. Then
  it records every `/api/` request with `page.on("request")` / `page.on("requestfinished")`, and
  times from the click on a seated table until the order screen's `[data-draft-pane]` is visible
  (Playwright's CSS locators pierce shadow roots). Before this change, "screen shown" and "draft
  ready" are the same moment. The script must time the scenarios of the BEFORE table above:
  - the first seated table in a zone;
  - Back, then a second seated table in the same zone;
  - tap a dish, Back at once, then another party's table;
  - if the demo floor has one, a seated table with no main bill.
  Each scenario runs five times; report the median, and the requests the open sent.
- [ ] **Step 3: Say what a failing probe would print, then run.** At base, every open must list one
  `GET /api/service-zones/<zone>/offers`. If none appears, the script is not watching the open.
- [ ] **Step 4: Record.** Add a "Real till page, BEFORE" table under the BEFORE section of this
  plan. Give the date, the command, the slot, and the demo data set; then stop your stack
  (`wa-wt down waitron-feat-a768-till-open-table-fast`). Keep the script for Task 8.
- [ ] **Step 5: If it cannot run, say so plainly.** For example, every slot is held, the demo seed
  fails, or the device chooser cannot be driven. Write in the plan what was tried and what failed,
  report it in the handover, and carry on with Task 1. Never mark this task done without numbers or
  that written reason.
- [ ] **Step 6: Commit the plan change.** For example: `Record A768's table-open timings on a real till page before the change`.

### Task 1: The live-fields digest on both menu reads (server)

**Files:**
- Modify: `packages/catalogue/src/menu-document.ts:415-575` (`LiveRows`, `readLiveRows`, `readUnavailable`, `applyLiveFields`)
- Modify: `packages/catalogue/src/index.ts:88-93`
- Modify: `packages/module/src/module.ts:308-352`
- Modify: `packages/venue-service/src/operations.ts:915-1033`
- Test: `packages/catalogue/src/menu-document.test.ts`, `packages/venue-service/src/operations.test.ts`

**Interfaces:**
- Produces: `readLiveState(tx, documents): Promise<{ unavailable: MenuUnavailable; liveFields: string }>`;
  `applyLiveFields(tx, documents, menuItemIds?): Promise<{ offers: Map<string, LiveOffer[]>; liveFields: string }>`;
  `ZoneMenuState.liveFields: string`, `ZoneOffers.liveFields: string`. Both routes' JSON carries
  `liveFields`, because they spread these results.

The digest is sha256 hex over `canonicalJson` (already used by `menuDocumentHash`) of the product rows
read, **sorted by id**: `[id, courseId, category]` for each row. Availability is left out, because
`unavailable` already carries it. Both functions must digest the same id set for the same documents:
`readLiveState` takes its offers the way `applyLiveFields` does (`documentOffers`), or both collect ids
through one helper. The equality test below pins this. When `applyLiveFields` is given `menuItemIds`,
the digest covers only those items. Say so in its doc comment; no route compares such a digest.

**No documents gives one fixed value everywhere.** Export
`NO_LIVE_FIELDS = liveFieldsDigest(<no rows>)` from catalogue. `applyLiveFields`'s early return for
`documents.length === 0` (`menu-document.ts:522`) answers `{ offers: new Map(), liveFields: NO_LIVE_FIELDS }`;
`readLiveState(tx, [])` answers the same digest; and `menuState`'s no-department early return
(`operations.ts`, the `zone?.departmentId == null` branch) answers `liveFields: NO_LIVE_FIELDS`.
Without this, a zone with no published menu could get two different digests from its two reads, and
the till would re-read it on every tick.

- [ ] **Step 1: Write the failing tests.** In `menu-document.test.ts`, add
  `describe("the live-fields digest")`, using `menusFixture`, `build`, `updateProduct`:
  - `"is the same from both reads of the same documents"`:
    `expect((await app((tx) => applyLiveFields(tx, [lunch]))).liveFields).toBe((await app((tx) => readLiveState(tx, [lunch]))).liveFields)`.
  - `"moves when a dish changes course"`: change `courseId` on `f.lemonade` (as the existing
    `applyLiveFields` case does); assert the `liveFields` value differs.
  - `"moves when a dish changes reporting category"`: `updateProduct(tx, f.soup, { categoryId: f.coldDrinks })`; differs.
  - `"stays when only availability changes"`: `updateProduct(tx, f.lemonade, { available: false })`;
    `liveFields` equal, and `unavailable.products` now contains `f.lemonade`.
  - `"names one fixed digest when there are no documents"`: `applyLiveFields(tx, []).liveFields`,
    `readLiveState(tx, []).liveFields` and `NO_LIVE_FIELDS` are all equal.
  - Update every existing `applyLiveFields(...).get(...)` to `.offers.get(...)`, preserving each
    assertion. They are in `menu-document.test.ts`, `menu-publication.test.ts` (`:855`, `:990`,
    `:1917`) and `operations.test.ts` (`:2139`) in `packages/catalogue`.
  In `packages/venue-service/src/operations.test.ts`, add two cases beside the existing `menuState`
  ones (around line 2688): `"menuState and listZoneOffers name the same live fields, and both move when a dish changes course"`,
  and `"a zone with no published menu names NO_LIVE_FIELDS on both reads"`. Update the unknown-zone
  `toEqual` at about line 2760 to include `liveFields: NO_LIVE_FIELDS`.
- [ ] **Step 2: Run them and see them fail.**
  `pnpm --filter @waitron/catalogue exec vitest run src/menu-document.test.ts src/menu-publication.test.ts src/operations.test.ts`
  and `pnpm --filter @waitron/venue-service exec vitest run src/operations.test.ts`. They should
  fail because `readLiveState` is not exported and `liveFields` is undefined.
- [ ] **Step 3: Implement.** Add `liveFields` to `ZoneMenuState` and `ZoneOffers` in `module.ts`, with
  one doc line: "Digest of the course and reporting category behind every offer; moves when either
  changes on any dish, which no menu version records." In `operations.ts`, `listZoneOffers` takes
  `{ offers, liveFields }` from `applyLiveFields` and returns `liveFields`; `menuState` returns
  `liveFields` from `readLiveState`. Delete `readUnavailable` once nothing calls it.
- [ ] **Step 4: Run the files and every type check.** The same test commands, then
  `pnpm --filter @waitron/catalogue --filter @waitron/module --filter @waitron/venue-service --filter @waitron/server typecheck`.
  Fix any fake `ZoneOffers` or `ZoneMenuState` the type check names (test seats implement the
  contract).
- [ ] **Step 5: Commit.** For example: `Menu reads name a digest of each dish's course and category, so a till can tell they moved (A768)`.

### Task 2: `setupRevision` on the start read and on `/api/menu-state` (server)

**Files:**
- Create: `apps/server/src/till-setup.ts`
- Modify: `apps/server/src/till-api.ts:1386-1506` (`/api/till`), `:1601-1630` (`/api/menu-state`)
- Test: create `apps/server/src/till-api.setup-revision.test.ts`

**Interfaces:**
- Produces: `readTillSetup(tx: Transaction, deps: Pick<TillApiDeps, "cfg" | "venueLocale" | "workforceEnabled" | "onboardingIntent" | "cardProvider">, device: DeviceBinding | null): Promise<TillSetup>`.
  `TillSetup` is the `/api/till` body except `servers`, in the same key order. Also
  `setupRevisionOf(setup: TillSetup): string`, sha256 hex of `JSON.stringify(setup)`. The `/api/till`
  JSON gains `setupRevision`, and so does the `/api/menu-state` JSON.

Move the body of the `/api/till` transaction and the response assembly (every field except `servers`)
into `readTillSetup`, the unreachable-row `throw` included. `/api/till` keeps `tryReadDevice` and
`readNodeMembership` outside the transaction, as now, and answers
`{ ...setup, setupRevision: setupRevisionOf(setup), servers: routableServers(held) }`. `/api/menu-state`
calls `readTillSetup(tx, deps, session.device)` **inside its existing transaction**: no second
`withTransaction`, so no second turn of the lock. Lane G adds `heldUntilFired: course.heldUntilFired`
inside the course map of this handler; on rebase, that line moves into `till-setup.ts`.

- [ ] **Step 1: Write the failing tests.** In the new file, use `provisionSignedInTill` and
  `sendAsTill` (`apps/server/src/testing/signed-in-till.ts`; the seed shape of
  `till-api.service-periods.test.ts:106` is enough with one department and zone). Use `createCourse`
  (`./kitchen.js`).
  - `"the start read and menu-state name the same setup revision for one till"`.
  - `"the revision stays while nothing changes"`: two `/api/menu-state` reads, equal values.
  - `"the revision moves when a course is added, when one is renamed, and when bump mode changes"`:
    take the revision before and after each change. Rename through the kitchen verb if one exists,
    otherwise update `kitchenCourses`; change bump mode with `tx.update(locations).set({ bumpMode: "ticket" })`.
    Assert each is a new value.
- [ ] **Step 2: Run the file and see it fail** (`setupRevision` undefined):
  `pnpm --filter @waitron/server exec vitest run src/till-api.setup-revision.test.ts`.
- [ ] **Step 3: Implement** as described above.
- [ ] **Step 4: Run the new file and the suites that pin `/api/till`:**
  `pnpm --filter @waitron/server exec vitest run src/till-api.setup-revision.test.ts src/till-api.test.ts src/till-api.courses.test.ts src/receipt-language.test.ts src/simplified-limit.test.ts src/till-api.service-periods.test.ts src/boot.till-clock.test.ts src/till-api.fiscal-sale-paths.test.ts`.
  The last one pins `body.activeReaders` from `/api/till`.
  Then `pnpm --filter @waitron/server typecheck`.
- [ ] **Step 5: Measure the added cost.** Recreate Appendix B at
  `apps/server/src/a768-route-cost.probe.test.ts`, run it with `A768_DISHES=80`, and compare the
  `menuState` median with the BEFORE table (5.86 ms). Put both numbers and the command in the commit
  body. Delete the probe file.
- [ ] **Step 6: Commit.** For example: `The till's start read and its menu check name a setup revision, so an open till can tell its settings moved (A768)`.

### Task 3a: The till re-reads a menu whose live fields moved

**Files:**
- Modify: `apps/till/src/api/client.ts:425-450` (`ZoneOfferCatalogue`, `MenuStateAnswer`)
- Modify: `apps/till/src/till-app.ts:1089-1124` (`ZoneOfferIndex`), `:4543-4590` (`#onMenuState`)
- Test: create `apps/till/src/till-app-open-table.test.ts`

**Interfaces:**
- Consumes: Task 1's `liveFields` in both answers.
- Produces: `ZoneOfferCatalogue.liveFields?: string`; `MenuStateAnswer = MenuState & { defaultMenuId?: string | null; liveFields?: string }`;
  `ZoneOfferIndex.liveFields: string | undefined`, set by `load()` from `catalogue.liveFields`.
- The test harness: copy the header of `till-app-drafts.test.ts` (imports, fixtures, `stubApi`,
  `mountApp`, `flush`, `emit`, the selectors, `signIn`, `openMesa`, `back`; everything before its
  first `describe`). Then make these changes:
  - `catalogue(version, prices = {}, liveFields = "lf-1")` sets `liveFields`.
  - Add `state(version: string, liveFields = "lf-1", setupRevision?: string): MenuStateAnswer`, with
    the `lunch` menu on `version`, an empty `unavailable` and `defaultMenuId: "lunch"`.
  - `menuState: vi.fn(async () => state("v1"))`.
  - `listDefaultZoneOffers` answers `catalogue("v1")` with `context.zoneId: "zc"`, so the counter's
    zone is not the tables' zone `z1`.
  - Add `table("t9", "9", party({ id: "v9", mainBillId: "wo-9", tableIds: ["t9"] }))` with
    `zoneId: "z2"` to `getTablesState`.

In `#onMenuState`, a moved digest counts as a moved menu: the table branch takes
`state.liveFields !== this.#tableOffers.liveFields` into the condition that calls
`#reloadTableOffers`, and the counter branch does the same with `this.#counterOffers.liveFields` beside
`menusMoved(this.menus, state.menus)` (both places it appears).

- [ ] **Step 1: Write the failing tests** under `describe("A768 a moved course or category is read again")`.
  The poll is faked with `vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })` before
  mounting, ticked with `vi.advanceTimersByTime(15_000)` then `flush`, as in
  `till-app-menu-refresh.test.ts:289`:
  - `"an open table reads its offers again when a poll names new live fields"`: open t4, then set
    `listZoneOffers` to a catalogue where Beer has `courseId: "mains"` and `liveFields: "lf-2"`, and
    `menuState` to `state("v1", "lf-2")`. Poll. Expect `listZoneOffers` called with `"z1"` once
    more, and `tableOrder(el)!.products.find((p) => p.name === "Beer")!.courseId` to be `"mains"`.
  - `"an open table reads nothing more when a poll names the same live fields"`: poll with
    `state("v1", "lf-1")`; the `listZoneOffers` call count is unchanged.
- [ ] **Step 2: Run and see the first fail:** `pnpm --filter @waitron/till exec vitest run src/till-app-open-table.test.ts`.
- [ ] **Step 3: Implement** the types, `ZoneOfferIndex.liveFields`, and the two `#onMenuState` conditions.
- [ ] **Step 4: Run** the new file and `src/till-app-menu-refresh.test.ts`; then `pnpm --filter @waitron/till typecheck`.
- [ ] **Step 5: Commit.** For example: `The till reads a zone's menu again when a dish's course or category moved (A768)`.

### Task 3b: Keep each zone's menu, and check it on open instead of re-reading it

**Files:**
- Modify: `apps/till/src/till-app.ts`: new fields beside `#tableOffers` (`:2054`); the five
  `listZoneOffers` / `listDefaultZoneOffers` call sites (`:3914-3915`, `:4323`, `:4723`, `:4753`,
  `:8471`); `#openTable` `:8467-8523`
- Test: `apps/till/src/till-app-open-table.test.ts`

**Interfaces:**
- Produces: `#zoneCatalogues: Map<string, { read: number; catalogue: ZoneOfferCatalogue }>`;
  `#zoneOfferReads = 0`;
  `#readZoneOffers(zoneId: string, options?: ReadOptions, api?: TillApi): Promise<ZoneOfferCatalogue>`.
  The last one numbers the read before sending, calls `api.listZoneOffers`, and keeps the answer under
  `zoneId` only when `api === this.api` and no read sent later has already been kept. Add
  `#rememberZoneCatalogue(read, catalogue)` for the default-zone read, keyed by `catalogue.context.zoneId`.

All five sites go through `#readZoneOffers` or `#rememberZoneCatalogue`; `#refreshBasket` passes its
captured `api`. Clearing the map on a server switch is Task 3c.

In `#openTable`, when the table has a zone and `this.#zoneCatalogues.has(zoneId) && this.#menuPoll.running`:
`#loadTableOffers(zoneId, held)` and `tableSelectedCatalogueId = #resolveZoneMenu(...)` run
synchronously, exactly as the success branch does today. Then `void this.#menuPoll.readNow(zoneId)`,
whose answer reaches `#onMenuState` through the poll's own ordering guard, and the open carries on
without awaiting it. Otherwise, the existing awaited read through `#readZoneOffers` runs. The `catch`
branch and every guard after it are unchanged.

Guards: `offerRequest`, `#openClaimed`, `#operatorSession` and `left()` are checked at the same points
as now. The held branch has no await, so the check after it is not needed there; keep it only on the
awaited branch. `#onMenuState` applies an answer only to `#tableZoneId`, and `#reloadTableOffers`
drops an answer once a later table open has started (`action !== this.#tableOfferRequest`).

- [ ] **Step 1: Write the failing tests** under `describe("A768 a held zone's menu")`:
  - `"a second open of a table in a zone already read sends no offers read and one menu-state read"`:
    open t4, `back`, clear the mocks' calls, open t7. `expect(api.listZoneOffers).not.toHaveBeenCalled()`,
    `expect(api.menuState).toHaveBeenCalledTimes(1)`, `expect(api.menuState.mock.calls[0]![0]).toBe("z1")`;
    the draft is ready and Beer is on the grid.
  - `"a menu published while the zone was off screen is read again when the table opens"`
    (Review Focus 3): after the first open and `back`, set `listZoneOffers` →
    `catalogue("v2", { Beer: "6.00" })` and `menuState` → `state("v2")`. Open t7.
    `listZoneOffers` is called once, and Beer's `unitPrice` on the grid is `"6.00"`.
  - `"a table in a zone not yet read reads its offers"`: open t9 (z2); `listZoneOffers` is called with `"z2"`.
- [ ] **Step 2: Run and see the first two fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the table-opening suites.** Tests that change `listZoneOffers` and then reopen a
  table in the same zone, expecting the new menu, must now also make `menuState` name the new
  version. Change the mocks, never the assertions:
  ```sh
  pnpm --filter @waitron/till exec vitest run src/till-app-open-table.test.ts src/till-app-drafts.test.ts \
    src/till-app-table-service.test.ts src/till-app-menu-refresh.test.ts src/till-app-parties.test.ts \
    src/till-app-bill-payments.test.ts src/till-app-adjustments.test.ts src/till-app-kitchen-note.test.ts \
    src/till-app-device-zones.test.ts src/till-app-menu-timetable.test.ts src/till-app.test.ts \
    src/till-app.unsaved-changes.test.ts
  ```
  Then `pnpm --filter @waitron/till typecheck`.
- [ ] **Step 5: Commit.** For example: `The till keeps each zone's menu and only checks it when a table opens (A768)`.

### Task 3c: A server switch or a new boot forgets every held menu

**Files:** `apps/till/src/till-app.ts`: the top of `#boot` (`:2893`), and `willUpdate`'s
`changed.has("api")` block (`:2820`). Test: `apps/till/src/till-app-open-table.test.ts`.

Clear `#zoneCatalogues` in both places. A menu read from one server is never shown as the check's
baseline on another, and an answer from the old `api` is already refused by `#readZoneOffers`.

- [ ] **Step 1: Write the failing test** `"a server switch forgets every held menu"`. Open t4 and
  `back`. Switch servers the way the server-switch cases in `till-app.test.ts` do (the router's
  server-changed event, which re-runs `#boot`). Sign in again and open t7: `listZoneOffers` is
  called with `"z1"`.
- [ ] **Step 2: Run it and see it fail.** Implement. Run the new file and `src/till-app.test.ts`.
- [ ] **Step 3: Commit.** For example: `A till that moves to another server reads each zone's menu afresh (A768)`.

### Task 4: Stop waiting for the left draft's save

**Files:**
- Modify: `apps/till/src/till-app.ts`: `#openTableFromEvent` `:8440-8442`; `#openTable`'s seated
  branch just before its `Promise.all` (`:8542`); two new methods placed just above
  `#openTableFromEvent` (lane G edits `#flushDraft` and below); `#onLogout` `:12230-12238`;
  `#onServerChanged` `:1641`
- Test: `apps/till/src/till-app-open-table.test.ts`

**Interfaces:**
- Produces: `#leavingDrafts = new Map<DraftSync, Promise<void>>()`, each value settling once that
  sync's background save has answered and the sync is dropped; `#releaseDraft(sync: DraftSync): void`;
  `#savesOutFor(partyId: string | undefined): Promise<void>`, which awaits every entry whose
  `sync.partyId === partyId` and resolves at once when there is none.

`#releaseDraft` takes the sync off the screen (`#draftSync = undefined`, `#draftReady = false`,
`requestUpdate()`) without dropping it. It stores `sync.flush().then(...)` in `#leavingDrafts`.
That continuation removes the entry, calls `sync.drop()`, and, when the session is unchanged, says
the outcome: `"failed"` → `errorKey = "table.draft_save_failed"`; a refusal other than
`session.required` → `errorKey = draftRefusalError(refusal)`. `session.required` is skipped, as
`#onDraftRefused` skips it (`:8916`). The sync's own `onRefused` is ignored once it is no longer
`#draftSync`, which is why `#releaseDraft` says the outcome itself. `"saved"` says nothing.

In `#openTableFromEvent`, replace `await this.#flushDraft()` with: if `#draftSync` is set and its
`partyId` differs from the party of the table being opened (`this.tables.find(t => t.id === tableId)?.party?.id`;
a free table has none, so it always differs), call `#releaseDraft(this.#draftSync)` and carry on at
once. Otherwise keep `await this.#flushDraft()` (owner decision 3). The `left()` / session check
after it stays.

**Coming back to a party whose save is still out.** Opening A, then B, then A again releases A's
sync while its save is out, then B's. Reopening A compares only against `#draftSync`, which is now
B's, so without more it would not wait. A's `listDrafts` could answer before A's save lands; the next
edit would be refused `draft.out_of_date`, and `#refused` reloads and `#show` replaces the store
(`apps/till/src/state/draft-sync.ts:396-406`). So `#openTable`'s seated branch does
`await this.#savesOutFor(this.orderParty?.id)` just before its `Promise.all` of lines and
`#openDraft`, then repeats the guard the branch already uses after an await:
`if (left() || session !== this.#operatorSession || this.#openClaimed > offerRequest) return;`.
A seat makes a new party, so that branch has nothing to wait for.

`#onLogout` closes every sync in `#leavingDrafts` beside the shown one, before `api.logout()`:
`await this.#holdingReload(() => Promise.all([sync?.close(), ...[...this.#leavingDrafts.keys()].map((s) => s.close())]))`.
`close()` waits for a save that is out and starts none afterwards (`apps/till/src/state/draft-sync.ts:251-266`).
`#onServerChanged` drops them, as it drops the shown one.

After the rebase on lane G: lane G's `#dropDraft` also closes an open adjustment that came from the
draft (`if (this.adjusting?.source !== undefined) this.#closeAdjust();`). `#releaseDraft` does the
same when it takes the sync off the screen.

Guards: `offerRequest` is taken before the release, as now. With no await, nothing can start a newer
open between the release and `#openTable`. The new await in the seated branch is followed by the same
three-part check as the bills read before it. A sync that answers after it was released can neither
show its draft nor change the screen: `onReplaced`, `onRefused` and the store subscription each
compare against `#draftSync` already (`till-app.ts:8846`, `8916`, `8860`).

- [ ] **Step 1: Write the failing tests** under `describe("A768 the left draft saves in the background")`.
  Hold the save with a deferred `saveDraft` wrapper over `server.saveDraft` (see `holdNextSave` in
  `till-app-drafts.test.ts:942`):
  - `"another party's table shows its order before the left draft's save answers"`: open t4, tap Beer,
    `back`, hold the save, open t7. `tableOrder(el)!.draftStore` is non-null and `orderParty.id` is
    `"v7"` while the save is still held. Release it, and `savedLines()` includes the beer.
  - `"a background save that fails is said on the next table"`: the held save rejects
    `{ code: "connection.failed" }`; the banner shows `t("table.draft_save_failed")` while t7 is open.
  - `"signing out closes a draft still saving in the background"` (Review Focus 2): hold the save,
    open t7, log out. `api.logout` is not called until the save is released. After sign-in as
    `"p2"`, no `saveDraft` call carries `"p2"`'s session (the stub records `server.personId` at call
    time).
  - `"the same party's table still waits for its own save"`: open t4, tap, `back`, hold the save,
    reopen t4. The draft is not shown until the save is released, then shows the beer.
  - `"A, B, then A again waits for A's own save"` (Review Focus 2): open t4, tap Beer, `back`, hold
    the save, open t7, `back`, open t4. While the save is held, t4's draft is not shown and
    `listDrafts` has not been called for `"v1"` since the hold. Release it: the draft shows the beer.
    Then tap Steak and let it save: no `draft.out_of_date` refusal, and the beer is still there.
- [ ] **Step 2: Run and see the first, third and fifth fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the new file and `src/till-app-drafts.test.ts`, `src/till-app.unsaved-changes.test.ts`,
  `src/till-app-parties.test.ts`; then `pnpm --filter @waitron/till typecheck`.
- [ ] **Step 5: Commit.** For example: `Opening another party's table no longer waits for the save of the order left (A768)`.

### Task 5: The order screen's loading state

**Files:**
- Modify: `apps/till/src/screens/till-table-order-screen.ts:1207` (properties), `:2648-2716` (`render`)
- Modify: `apps/till/src/i18n/strings.ts`: add after `"table.back"` at `:918` (en) and `:2449` (es)
- Test: create `apps/till/src/screens/till-table-order-screen.loading.test.ts` and
  `till-table-order-screen.loading.a11y.test.ts`. They are new files, because lane G edits the
  screen's existing test files.

**Interfaces:**
- Produces: `@property({ type: Boolean }) loading = false` on `TillTableOrderScreen`; string
  `"table.loading": "Loading…"` / `"Cargando…"`.

While `loading` is set, `render()` keeps the `<section class="screen">`, the non-embedded header and
the Back button, and replaces everything else with `<p role="status" data-loading>${t("table.loading")}</p>`.
Everything else means the status chip, the drawer handle, the print problem, the kitchen note, the
layout and the dialogs. The section gets `aria-busy="true"`.

- [ ] **Step 1: Write the failing tests.** Mount the screen with the helpers in
  `till-table-order-screen.test-helpers.ts`.
  - `"while loading it shows only Back and the loading line"`: `[data-loading]` reads `Loading…`; no
    `[data-draft-pane]`, no `[data-open-drawer]`, no `till-order-kitchen-note`; `[data-back]` present.
  - `"Back while loading still asks to go back to the floor"`: clicking `[data-back]` dispatches `back-to-floor`.
  - `"the order replaces the loading line once loading ends"`.
  - a11y file: `expectNoA11yViolations` on the loading state, light and dark.
- [ ] **Step 2: Run and see them fail:**
  `pnpm --filter @waitron/till exec vitest run src/screens/till-table-order-screen.loading.test.ts src/screens/till-table-order-screen.loading.a11y.test.ts`.
- [ ] **Step 3: Implement.** Also run `src/i18n/strings.test.ts`, which checks that every key has its Spanish.
- [ ] **Step 4: Run** the two files and `src/i18n/strings.test.ts`.
- [ ] **Step 5: Commit.** For example: `The table screen can say it is loading (A768)`.

### Task 6a: Switch to the order screen at once, and undo the switch on failure

**Files:**
- Modify: `apps/till/src/till-app.ts`: `#tableCatalogueActive` `:4282`; `#openTableFromEvent`
  `:8430-8455`; the landing path's resume `:3992-3999`; `#openTable`'s two failure `catch` branches
  (`:8481-8503`, `:8590-8594`) and its end `:8598-8606`; both render sites of
  `<till-table-order-screen>` (`#embeddedOrderBody` `:12400`, `#drillBody` `:12525`); `errorText` in
  `render()` `:12735`; `#onLogout` `:12186-12203`
- Test: `apps/till/src/till-app-open-table.test.ts`

**Interfaces:**
- Consumes: Task 5's `loading`.
- Produces:
  - `@state() private tableOpening = false`.
  - `#openedFrom?: string`.
  - `#orderScreenShown(): boolean`, which is today's body of `#tableCatalogueActive`;
    `#tableCatalogueActive()` becomes `!this.tableOpening && this.#orderScreenShown()`.
  - `#showOrderScreen(): void`. It records `#openedFrom = this.activeTabKey`. On a drill mount it
    calls `#pushDrill({ kind: "table-order" })`, which writes no URL for this kind. On a card mount
    it sets `this.activeTabKey = this.#resolveScreen("order")` **without writing the URL**. Then it
    sets `this.tableOpening = true`.
  - `#leaveFailedOpen(): void`.

Changes:
- `#openTableFromEvent` calls `#showOrderScreen()` (inside `if (this.#inShell())`) right after
  `this.#tableOpensPending++` and `const session = …`. That is before the left draft is handled, so
  a same-party open that still awaits `#flushDraft()` (Task 4) waits behind the loading line, not on
  the floor. The landing path calls it just before its `#openTable(...)` (`:3993`), after its
  `++this.#tableOfferRequest`. `#openTable` itself no longer switches.
- At the old switch site (`:8599-8605`), after `if (left()) return`, only when `#orderScreenShown()`
  is still true: set `#shownOnVisit = this.#orderVisit`. On a card mount, also write the URL now as
  `#setActiveTab` would: `this.#writeUrl({ "till-tab": "order", "till-view": null, "till-station": null })`.
  The check is needed because a destination drill pushed meanwhile may have replaced the loading
  screen without moving `#orderVisit`. So a successful open adds one history entry, as today, and a
  failed or abandoned one adds none. `void this.#loadStations()` stays.
- `tableOpening` goes false at every exit of an open that is still the latest. That is `#openTable`'s
  `finally`, and `#openTableFromEvent`'s `finally`, which covers an open that returns before reaching
  `#openTable`, for example signed out during the awaited same-party flush. Each one runs
  `if (offerRequest === this.#tableOfferRequest) this.tableOpening = false;`. `#onLogout` sets it
  false unconditionally.
- The two failure branches call `#leaveFailedOpen()` before setting the error they set today. One is
  the awaited menu read's `catch` (an unheld zone); the other is the seating `catch`.
  `#leaveFailedOpen` acts only when
  `!left() && session === this.#operatorSession && this.#orderScreenShown()`. (After Task 6b no
  `offerRequest` check is needed: both callers' `left()` reads `#orderVisit`, which every newer open
  moves.)
  It does `this.#orderVisit++`, then `#popDrill()` on a drill mount, or
  `this.activeTabKey = this.#openedFrom` on a card mount (no URL was written, so there is no history
  entry to undo). Pass it what it needs as parameters.
- Both renders pass `.loading=${this.tableOpening}`. `errorText` (`:12735`) picks `tableMenus` by
  `#orderScreenShown()`: it only chooses which menus name the error, for the screen showing.
- `#onLogout`'s `#tableToResume` reads `#tableCatalogueActive()`, so during loading it records
  nothing. Keep that reading, and add the test below.

Guards, one by one:
- **`offerRequest`**: unchanged. The switch moves no counter.
- **`#openClaimed`**: unchanged. The table is claimed at the same point, after the menu step.
- **`#operatorSession`**: unchanged checks. Logout during loading clears the drill and `tableOpening`.
- **`left()`**: unchanged in this task (6b changes it). The switch bumps no visit.
- **`#tableOpensPending`**: unchanged.
- **`#orderVisit` / `#shownOnVisit`**: `#shownOnVisit` is still set only when the open completes, and
  now only if the order screen is still the one showing. So `#leftSince` answers as before during the
  whole open, including on the landing path, which holds no pending count.
- **Every other reader of `#tableCatalogueActive()`** (`:1566`, `:1600`, `:2210`, `:4273`,
  `:9050-9055`, `:12201`, `:13291`) sees false while loading, as it did while the waiter was on the
  floor during an open. One case is worth stating. A department transfer accepted during loading for
  the bill in `activeTabId` (`:1566`) forgets the party but does not return to the floor. The open
  then completes and shows what it read, which is today's outcome at the same moment.

- [ ] **Step 1: Write the failing tests** under `describe("A768 the order screen shows at once")`.
  Hold `getTabLines` and `listDrafts` with deferreds.
  - `"the order screen shows with its loading line before the table's reads answer"`: after open t4
    and one `flush`, `tableOrder(el)!.loading` is true and `[data-loading]` shows. Release both
    reads; `loading` is false and the draft is ready.
  - `"a second open during the first's loading shows only the second table"` (Review Focus 1): hold
    t4's reads (z1 held), open t9 (z2, `listZoneOffers` held), release in the order t9 then t4. The
    screen shows party `"v9"` and the z2 offers.
  - `"a table whose menu cannot be read goes back to the floor with the error"` (Review Focus 5): a
    zone not held, `listZoneOffers` rejects; the floor screen is shown, the banner reads
    `t("table.error")`, and `[data-loading]` is gone.
  - `"a free table whose seating is refused goes back to the floor with the error"` (Review Focus 5).
  - `"a same-party open shows its loading line while the left save is out"`: tap on t4, `back`, hold
    the save, reopen t4. `[data-loading]` shows while the save is held.
  - `"an open abandoned during its flush leaves no loading line"`: as above, then log out while the
    save is held, release it, and sign in. The next table open starts from `tableOpening` false; no
    `[data-loading]` is left over.
  - `"signing out while a table loads does not resume it at the next sign-in"`.
  - On the card mount (`orderTabFormFactor`): `"the order tab shows at once and is written to history once it has loaded"`.
    Spy on `history.pushState` and `replaceState`, never `history.length`
    (`docs/developers/testing-guide.md`, "A browser test sees a push through `pushState`"). There is
    no push while loading and one push on success. Also `"a failed open on the card mount returns to the floor tab with no history entry"`.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same set of suites as Task 3b Step 4, plus `src/till-app.a11y.test.ts`;
  then `pnpm --filter @waitron/till typecheck`.
- [ ] **Step 5: Commit.** For example: `The till shows a table's screen as soon as it is tapped, saying it is loading (A768)`.

### Task 6b: Leaving the loading screen abandons the open, except a seat already sent

**Files:**
- Modify: `apps/till/src/till-app.ts`: `#openTableFromEvent` `:8443-8450`; `#onTabSelect`
  `:8295-8302`; `#openTable`'s seating branch `:8549-8597`
- Test: `apps/till/src/till-app-open-table.test.ts`

Today the floor's `left` is always false (`@open-table` at `:12837` passes none, so the default
`() => false` applies), so an open finishes and pushes the order over wherever the waiter went. With
the screen shown at once, Back must abandon the open:

- `#openTableFromEvent` passes `() => left() || this.#orderVisit !== visit` to `#openTable`, where
  `visit` is the `#orderVisit` after its own `++`. This is the landing path's shape (`:3998`).
- `#onTabSelect`: when `this.tableOpening` and the change leaves the order screen
  (`#orderScreenShown()` before and not after), bump `#orderVisit`.
- **Once `seatTable` / `seatAtTables` has answered, the seating branch ignores `left()`.** A
  successful seat has made the party on the server. The lines carried from the unassigned draft
  exist only in memory, and the next open of that (now seated) table runs `#resetPartylessDraft()`.
  So after a successful seat the branch checks only `session !== this.#operatorSession || this.#openClaimed > offerRequest`.
  It then claims the table, opens the draft, puts the carried lines in (`loadFrom` today; lane G's
  `appendLines(this.#placeFirstOrder(...))` after the rebase), calls `#showDraft`, and runs
  `#reloadOrder()`. Only the completion bookkeeping (Task 6a's `#shownOnVisit` and the card-mount URL)
  is skipped when `left()` is true. The edits then save like any draft; a later open of another
  party releases them through Task 4's background save.

Guards: `left()` now also turns true once `#orderVisit` moves on from the open's own visit: Back, a
tab leaving the loading screen, logout, find-bill. Nothing on the open path bumps `#orderVisit`
itself. The seating branch is the one place where `left()` is not checked after an await, for the
reason above. The session and `#openClaimed` checks there stay.

- [ ] **Step 1: Write the failing tests:**
  - `"Back while loading returns to the floor and the late answers do not bring the order back"`.
  - On the card mount: `"leaving the loading order tab for another tab abandons the open"`. The
    open's later answers do not switch the tab back, and `tableOpening` is false.
  - `"Back during seating keeps the carried lines"` (Review Focus 5): put Beer on a free table's
    unassigned draft, open it with a guest count, and hold `seatTable`. Press Back, release the
    seat, and reopen the table. Its draft holds the beer.
- [ ] **Step 2: Run and see the first and third fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same suites as Task 6a Step 4; then `pnpm --filter @waitron/till typecheck`.
- [ ] **Step 5: Commit.** For example: `Going back from a loading table abandons the open, and keeps lines already carried to a new seat (A768)`.

### Task 7: The till refreshes its venue settings when the setup revision moves

**Files:**
- Modify: `apps/till/src/api/client.ts:138-197` (`TillInfo`), `:450` (`MenuStateAnswer`)
- Modify: `apps/till/src/till-app.ts`: `#boot` `:2934-2951`; a new `#applyVenueSetup` beside
  `#applyProfileSetup` (`:7948`); the start of `#onMenuState` (`:4543`)
- Test: create `apps/till/src/till-app-setup-refresh.test.ts` (harness as in Task 3a)

**Interfaces:**
- Consumes: Task 2's `setupRevision`.
- Produces: `TillInfo.setupRevision: string`; `MenuStateAnswer.setupRevision?: string`;
  `#setupRevision?: string`; `#setupRead?: Promise<void>`; `#applyVenueSetup(till: TillInfo): void`;
  `#noteSetupRevision(revision: string | undefined): void`.

`#applyVenueSetup` assigns exactly these fields, then sets `#setupRevision = till.setupRevision`:
`invoiceLocale`, `receiptLanguages`, `onboardingIntent`, `issuer`, `bumpMode`, `fireControl`,
`courses`, `cardProvider`, `tipsEnabled`, `#simplifiedInvoiceLimit` (and `#store.simplifiedInvoiceLimit`),
`fullInvoices`, `activeReaders`, `defaultReaderId`. `#boot` calls it in place of those lines. The
two places that already re-read `getTill()` mid-session call it beside `#applyProfileSetup`, so their
answer moves the revision too: `#enterSwitchedProfile` (`:7961`), and `#reconcileSavedDeviceZones`
where it applies `#pendingDeviceZoneSetup` (`:7699`).
`orderFlow`, `receiptPrintMode`, the locale lines and `#applyProfileSetup` stay where they are.

`#noteSetupRevision` (first line of `#onMenuState`) does nothing when the revision is undefined,
equals `#setupRevision`, or a read is already out. Otherwise it reads `getTill()` once. It applies the
answer only when the boot generation is unchanged. A failed read keeps every value, and the next
answer that names another revision asks again. Every `getTill()` (the boot's, the poll's, the profile
switch's and the zone change's) is numbered when it is sent, and `#applyVenueSetup` skips an answer
when a read sent after it has already applied its own, so an older answer never undoes a newer one.

- [ ] **Step 1: Write the failing tests:**
  - `"new courses reach an open table without a reload"` (the 2026-10-16 report; Review Focus 4):
    `getTill` first answers `courses: []` and `setupRevision: "s1"`; open t4 and tap Beer. Then
    `getTill` answers `courses` (Drinks/Mains/Desserts) with `"s2"`, and `menuState` answers
    `state("v1", "lf-1", "s2")`. Poll. `tableOrder(el)!.courses` lists the three, the draft still
    holds the beer, and `getTill` was called once more.
  - `"the same revision reads nothing"`: poll with `"s1"`; the `getTill` call count is unchanged.
  - `"a failed settings read keeps the old values and asks again on the next poll"`.
  - `"bump mode and fire control reach the station screen"`: open the station drill, move the
    revision with `bumpMode: "ticket"`; the `till-station-screen`'s `bumpMode` is `"ticket"`.
  - `"a settings read that answers after a server switch applies nothing"`.
  - `"a profile switch takes the venue's new courses too"`: `#enterSwitchedProfile`'s `getTill`
    answers new courses with `"s2"`. After the switch, `courses` holds them, and the next poll
    naming `"s2"` reads nothing more.
- [ ] **Step 2: Run and see them fail:** `pnpm --filter @waitron/till exec vitest run src/till-app-setup-refresh.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the new file with `src/till-app.test.ts`, `src/till-app-boot-and-counter.test.ts`
  and `src/till-app-device-zones.test.ts`; then `pnpm --filter @waitron/till typecheck`.
- [ ] **Step 5: Commit.** For example: `An open till picks up the venue's courses and other settings when they change (A768)`.

### Task 8: Measure after

- [ ] **Step 1:** Recreate Appendix A. Change its readiness test to
  `screen?.draftStore && !screen.loading` and add a second time, `"loadingShown"`, the first moment
  `screen` exists. Run it three times with the command in the BEFORE section.
- [ ] **Step 2:** What a failing (unchanged) build would print, so that this run can disprove the
  work: the second open with `listZoneOffers: 1` and ready at about 200 ms or more. Expected after:
  - the second open: no `listZoneOffers`, one `menuState`, the loading screen at about 0–20 ms, and
    ready at about 100–140 ms;
  - the left-unsaved open: ready at about 100–140 ms;
  - the first open: shown at once and ready at about 200–250 ms (its zone was not held);
  - the no-main-bill open: ready at about 200–240 ms. Its bills read stays ahead of its lines read
    (see Task 9).
- [ ] **Step 3: Real till page, AFTER (mandatory).** Restart your own stack from this branch's tip
  (`wa-wt demo waitron-feat-a768-till-open-table-fast`). Rerun Task 0's script, which now also times
  the loading line's first appearance, over the same scenarios, five runs each. Before running it,
  say what an unchanged build would print: an offers request on every open. Stop your stack after.
  If Task 0 recorded that it could not run, try again here and record the outcome either way. A
  missing real-till measurement is reported plainly in the handover and the PR, never skipped
  silently.
- [ ] **Step 4:** Delete the in-repo probe. Write both AFTER tables (probe and real till page) under
  the BEFORE ones in this plan, with commands and date, and commit the plan change. For example:
  `Record A768's table-open timings after the change`.

### Task 9: Docs

**Files:** `docs/backlog.md`, `docs/backlog/till.md`, `docs/developers/conventions-ui.md`, `CLAUDE.md`

- [ ] **Step 1:** Delete the A768 entry from `docs/backlog.md` (`:1949`) and its section in
  `docs/backlog/till.md` (`## A768…`, `:2072-2089`).
- [ ] **Step 2:** Add these as new short entries in the same till area. Take each number from
  `~/waitron-campaign-shared/next-item-number` (read it, use it, write the next number back):
  - **A kitchen screen in device mode keeps its start read until reload.** Its bump mode and fire
    control never refresh, because it runs no menu poll. Its station queue read could carry
    `setupRevision`.
  - **A seated table with no main bill still reads its bills before its lines**, because the lines
    read needs to know which bill opens (`billToOpen`). Opening one takes two round trips (Task 8's
    number).
  - **Profile values on an open till** refresh only on a profile switch or a change of zone
    selection (owner decision 4).
- [ ] **Step 3:** In `docs/developers/conventions-ui.md`, add `## What an open till keeps current`.
  It covers two things. First, each zone's menu: held, checked by `/api/menu-state` (versions,
  service, `unavailable`, `liveFields`), and re-read only when one of them moved. Second, the start
  read: what `setupRevision` covers (the whole `/api/till` body except `servers`), the fields
  `#applyVenueSetup` applies, and the ones fixed until reload, each with its why:
  - `locale`: the server's start-up value; it only picks the language before sign-in, and a
    signed-in person's own choice wins.
  - Refreshed, but changing only when the server restarts: `tipsEnabled` comes from
    `WAITRON_TILL_TIPS` (`apps/server/src/till-config.ts:46-47`), and the simplified-invoice limit
    from the fiscal backend at boot (`apps/server/src/boot.ts:1520`). The revision covers them, so an
    open till takes the new values after a restart without its own reload.
  - `servers` and `nodeId`: the router follows the primary among the servers it was given at boot
    (`ServerRouter.setServers`).
  - The profile values (form factor, capabilities, idle logout, starting screen, clocking
    available): applied by `#applyProfileSetup` at boot, on a profile switch and when the zone
    selection changes, and at no other time. They change the layout and which screens the till
    offers, and applied mid-session they could remove the screen the person is on; at those three
    points the till already lays itself out again (owner decision 4).
  - A kitchen screen in device mode: nothing refreshes.
  Say that a table opened from Find a bill does not show the loading screen at once: the order
  screen appears when the open completes, because leaving Find a bill abandons the open it started.
  Record two known limits of a held menu: its sold-out marks are as of its last full read until
  the check sent at the open answers, or, if that check fails, a later one (every 15 s); its department name is not checked,
  and changes only at the next full read.
  Cite the tests that pin each refreshed value. Say what nothing guards: a new `/api/till` field
  moves the revision but reaches an open till only once someone adds it to `#applyVenueSetup`.
- [ ] **Step 4:** In `CLAUDE.md` §3, under the screens heading, add one line:
  **A value the till takes from its start read either refreshes through `setupRevision` or is listed
  as fixed until reload**, with why, in [conventions-ui.md](docs/developers/conventions-ui.md). Cost:
  courses stayed missing from an open table until a reload (A768). Nothing guards it.
- [ ] **Step 5:** `pnpm format:check` (the root `CLAUDE.md` is format-checked; `docs/` is ignored),
  then commit. For example: `Docs: what an open till keeps current, and A768's open points (A768)`.

---

## Where this branch meets lane G's `feat/a773-1-unsent-list` on rebase

Checked with `git diff ed0be7d89...feat/a773-1-unsent-list` on 2026-10-17:

- **`apps/till/src/till-app.ts`, the end of `#openTable`.** Task 6a replaces the switch at `:8599-8605`, and Task 6b changes the seating branch's checks at `:8562-8596`.
  Lane G's hunks `@@ -8585` (the seating branch: `loadFrom` → `appendLines(this.#placeFirstOrder(...))`)
  and `@@ -8606` (`#placeFirstOrder`, added right after `#openTable`'s closing brace) sit on both
  sides of it, so expect a textual conflict. Keep both of lane G's changes and this plan's removal.
- **`apps/server/src/till-api.ts`, the `/api/till` course map (`@@ -1403`).** Lane G adds
  `heldUntilFired: course.heldUntilFired`; Task 2 moves that map into `till-setup.ts`. Carry the line over.
- **Meeting in behaviour, not in text.** Lane G makes `#flushDraft` return `Promise<boolean>`, keys
  each draft by bill (`billId`), and starts `#loadTabLines` with `await this.#followPartyDraft()`.
  Task 4's same-party test stays a superset: same party covers same bill. After Task 4, the shown
  sync is already released when `#loadTabLines` runs during an open, so lane G's `#followPartyDraft`
  finds nothing to follow there. Re-run Task 4's tests after the rebase.
- **`apps/till/src/api/client.ts`.** Task 7 adds `setupRevision` at the end of `TillInfo` (about
  `:196`), close to lane G's `TillCourse` hunk at `:210`; it may need a manual merge.
- **`docs/backlog.md` and `docs/backlog/till.md`.** Lane G edits both; docs-only conflicts.
- **Lane G's other hunks, checked, with no text in common:**
  - `packages/module/src/module.ts` `@@ -1256` adds `moveBillAllergies` to
    `VenueServiceContribution`; Task 1 edits `:308-352`.
  - `till-app.ts` `@@ -11366` makes `#onTakePayment` await `#flushDraft()` and re-check the bill.
    It acts on the bill on screen, not on a released draft, so Task 4 does not change it.
  - `till-app.ts` `@@ -12842` adds two event bindings beside `@open-table` (`:12837`); Task 6a
    edits the order screen's two render sites (`:12400`, `:12525`), not that list.
- **Lane G's `#dropDraft` adds `#closeAdjust()`**: carry it into `#releaseDraft` (Task 4).
- **No meeting:** `till-table-order-screen.ts` `render()` (lane G's hunks are at `:2037-2292` and
  `:3003+`), `i18n/strings.ts` (lane G removes `table.bill_main`, far from `table.back`),
  `#onMenuState`, `ZoneOfferIndex`, `#boot`, `#onLogout`'s draft close. Lane F's branch touches no
  file this plan edits.

---

## Appendix A — the till probe (`apps/till/src/till-app-a768-probe.test.ts`, never committed)

Build it from the header of `till-app-drafts.test.ts` (everything before its first `describe`), then
append the code below:

```sh
cd apps/till && python3 - <<'EOF'
src = open("src/till-app-drafts.test.ts").read()
head = src[:src.index('describe("W69 unassigned table draft"')]
open("src/till-app-a768-probe.test.ts", "w").write(head + open("/tmp/a768-probe-tail.ts").read())
EOF
```

`/tmp/a768-probe-tail.ts`:

```ts
const D = 100;
const OPEN_READS = ["listZoneOffers", "menuState", "getTabLines", "listGroups", "listPrintProblems",
  "readCurrentOrders", "getPartyBills", "listDrafts", "saveDraft", "getBillBalance", "listStations"];
let log: { name: string; at: number }[] = [];

function recorded(base: Record<string, ReturnType<typeof vi.fn>>) {
  for (const name of Object.keys(base)) {
    const inner = base[name]!;
    base[name] = vi.fn((...args: unknown[]) => {
      log.push({ name, at: performance.now() });
      const out = inner(...args);
      if (!OPEN_READS.includes(name)) return out;
      return new Promise((resolve, reject) =>
        setTimeout(() => Promise.resolve(out).then(resolve, reject), D));
    });
  }
}

async function timedOpen(el: TillApp, tableId: string) {
  log = [];
  const start = performance.now();
  emit(floor(el)!, "open-table", { tableId, seated: true });
  let shown: number | undefined;
  let ready: number | undefined;
  while (ready === undefined && performance.now() - start < 3000) {
    await new Promise((r) => setTimeout(r, 2));
    const screen = tableOrder(el);
    if (screen !== null && shown === undefined) shown = performance.now() - start;
    if (screen?.draftStore) ready = performance.now() - start; // Task 8: && !screen.loading
  }
  await new Promise((r) => setTimeout(r, 3 * D));
  const counts: Record<string, number> = {};
  for (const { name } of log) counts[name] = (counts[name] ?? 0) + 1;
  return { shown: Math.round(shown ?? -1), ready: Math.round(ready ?? -1), counts };
}

describe("A768 probe", () => {
  beforeEach(() => { server = draftServer(); setLocale("en"); });
  afterEach(() => cleanupWidgets());

  it("times table opens", async () => {
    const { el } = await mountApp({
      menuState: vi.fn(async () => ({
        service: catalogue("v1").service,
        menus: [{ menuId: "lunch", versionId: "v1", orderable: true, sendable: true }],
        unavailable: { products: [], optionLabels: [] },
        defaultMenuId: "lunch",
      })),
      readCurrentOrders: vi.fn(async () => ({ hasGroups: false, groups: [] })),
      listStations: vi.fn(async () => []),
      getTablesState: vi.fn().mockResolvedValue([mesa4, mesa7,
        table("t9", "9", party({ id: "v9", mainBillId: null, tableIds: ["t9"] }))]),
    });
    recorded(api);
    await flush(el);
    await signIn(el);
    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el, 10);
    const first = await timedOpen(el, "t4");
    await back(el);
    await new Promise((r) => setTimeout(r, 3 * D));
    const second = await timedOpen(el, "t7");
    await tap(el, "Beer");
    await back(el);
    const leftUnsaved = await timedOpen(el, "t4");
    await back(el);
    await new Promise((r) => setTimeout(r, 3 * D));
    const noMainBill = await timedOpen(el, "t9");
    console.log("A768-PROBE " + JSON.stringify({ D, first, second, leftUnsaved, noMainBill }));
  });
});
```

## Appendix B — the server route probe (`apps/server/src/a768-route-cost.probe.test.ts`, never committed)

```ts
import { offerMenuThroughZone } from "@waitron/venue-service/testing/zone-menus.js";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { addProductToMenu, createCatalogue, createProduct } from "@waitron/catalogue";
import { createServiceZone } from "@waitron/venue-service";
import { nifWithControlLetter } from "@waitron/fiscal-verifactu/src/testing/seed.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
import { createBareDepartment, provisionSignedInTill } from "./testing/signed-in-till.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null), timeoutMs: 120_000 });

describe("A768 route cost probe", () => {
  it("times offers, menu-state and the start read", async () => {
    const N = Number(process.env.A768_DISHES ?? "80");
    const v = await provisionSignedInTill(suite.db, {
      taxId: nifWithControlLetter("12345678"),
      dayCutover: "05:00",
      seed: async (tx, cfg) => {
        const dept = await createBareDepartment(tx, cfg, "Restaurant", new Date());
        const zone = (await createServiceZone(tx, cfg, { name: "Sala", departmentId: dept })).id;
        const menu = (await createCatalogue(tx, { name: "Carta" })).id;
        for (let i = 0; i < N; i++) {
          const p = await createProduct(tx, { catalogueId: menu, categoryId: null, name: `Dish ${i}`,
            pricingUnit: "each", unitPrice: "5.00", vatClass: "general" });
          await addProductToMenu(tx, { menuId: menu, productId: p.id });
        }
        await publishWorkingMenu(tx, menu);
        await offerMenuThroughZone(tx, cfg, zone, menu, { makeDefault: true });
        return { departmentId: dept, startingZoneId: zone, zone };
      },
    });
    const time = async (path: string) => {
      const ms: number[] = [];
      let bytes = 0;
      for (let i = 0; i < 60; i++) {
        const t0 = performance.now();
        const r = await v.app.request(path, { headers: { cookie: v.cookie } });
        const text = await r.text();
        ms.push(performance.now() - t0);
        expect(r.status).toBe(200);
        bytes = text.length;
      }
      ms.sort((a, b) => a - b);
      return { medianMs: Number(ms[30]!.toFixed(2)), p90Ms: Number(ms[54]!.toFixed(2)), bytes };
    };
    const offers = await time(`/api/service-zones/${v.zone}/offers`);
    const state = await time(`/api/menu-state?zoneId=${v.zone}`);
    const till = await time(`/api/till`);
    console.log("A768-ROUTES " + JSON.stringify({ dishes: N, offers, menuState: state, till }));
  });
});
```

Command: `cd apps/server && for n in 20 80 200; do A768_DISHES=$n AI_AGENT= CLAUDECODE= pnpm exec vitest run src/a768-route-cost.probe.test.ts | grep A768-ROUTES; done`.

## Appendix C — the real till page script (`/tmp/a768-real-till/`, never committed)

The device id is the demo seed's `Mostrador` in slot 0's venue on 2026-10-17; a reset venue gives it a new
id (`GET /api/dev/devices` lists them). The dev chooser keeps the choice in `sessionStorage`, not
`localStorage`.

`common.mjs`:

```js
import { chromium } from "/Users/clintongormley/workspace/worktrees/waitron-feat-a768-till-open-table-fast/apps/till/node_modules/playwright/index.mjs";
export const TILL = process.env.TILL_URL ?? "http://localhost:5190";
export const DEVICE = "18ce33bc-4ff8-4015-a8b7-afb2061d0e98"; // Mostrador, counter till
export async function signedIn() {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  await p.goto(TILL + "/");
  await p.evaluate((d) => sessionStorage.setItem("waitron.devDeviceId", d), DEVICE);
  await p.reload();
  await p.getByRole("button", { name: "Lucía Fernández" }).click();
  for (const d of "5555") await p.getByRole("button", { name: d, exact: true }).first().click();
  await p.getByRole("button", { name: "Log in" }).click();
  const ci = p.getByRole("button", { name: "Clock in" });
  await Promise.race([ci.waitFor({ timeout: 5000 }).then(() => ci.click()).catch(() => {}),
    p.getByRole("button", { name: "Floor", exact: true }).waitFor()]);
  await p.getByRole("button", { name: "Floor", exact: true }).click();
  await p.getByText("Dining room", { exact: true }).waitFor();
  return { b, p };
}
export const api = (p, path, method = "GET", body) => p.evaluate(async ([path, method, body, d]) => {
  const r = await fetch(path, { method, headers: { "content-type": "application/json", "x-waitron-dev-device": d }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}, [path, method, body, DEVICE]);
```

`seat.mjs`:

```js
import { signedIn, api } from "./common.mjs";
const { b, p } = await signedIn();
const tables = (await api(p, "/api/tables/state")).body.filter((t) => t.zoneId === "329feb7d-de67-4f30-83f6-319de0aa5a42");
for (const t of tables.filter((t) => ["1", "2", "3", "4"].includes(t.label) && t.party === null)) {
  const r = await api(p, `/api/tables/${t.id}/seat`, "POST", { guestCount: 2 });
  console.log("seat", t.label, r.status, JSON.stringify(r.body));
}
for (const t of (await api(p, "/api/tables/state")).body.filter((t) => t.party)) console.log(t.label, JSON.stringify(t.party));
await b.close();
```

`measure.mjs`:

```js
// A768 Task 0/8: time table opens on a real till page. Usage: node measure.mjs [runs]
import { signedIn } from "./common.mjs";
const RUNS = Number(process.argv[2] ?? 5);
const SETTLE_MS = 1500;

const installTimer = (p) => p.evaluate(() => {
  const deep = (root) => {
    const hit = root.querySelector("[data-draft-pane]");
    if (hit) return hit;
    for (const el of root.querySelectorAll("*")) if (el.shadowRoot) { const h = deep(el.shadowRoot); if (h) return h; }
    return null;
  };
  window.__a768 = { deep };
  window.addEventListener("pointerdown", () => {
    if (window.__a768.armed !== true) return;
    window.__a768.armed = false;
    const t0 = performance.now();
    window.__a768.result = new Promise((resolve) => {
      const tick = () => {
        const el = deep(document);
        if (el && el.getBoundingClientRect().width > 0) resolve(performance.now() - t0);
        else if (performance.now() - t0 > 10000) resolve(-1);
        else requestAnimationFrame(tick);
      };
      tick();
    });
  }, { capture: true });
});

async function timedOpen(p, log, label) {
  await p.getByRole("button", { name: `${label}, Seated` }).waitFor();
  const present = await p.evaluate(() => window.__a768.deep(document) !== null);
  if (present) throw new Error("draft pane already on screen before the click");
  await p.evaluate(() => { window.__a768.armed = true; });
  log.length = 0;
  log.on = true;
  await p.getByRole("button", { name: `${label}, Seated` }).click();
  const ms = await p.evaluate(() => window.__a768.result);
  await p.waitForTimeout(SETTLE_MS);
  log.on = false;
  return { ms: Math.round(ms), requests: [...log] };
}

const back = async (p) => { await p.getByRole("button", { name: "Back to floor" }).click(); };

const results = { first: [], second: [], leftUnsaved: [] };
for (let run = 0; run < RUNS; run++) {
  const { b, p } = await signedIn();
  const log = [];
  p.on("request", (r) => {
    const u = new URL(r.url());
    if (log.on && u.pathname.startsWith("/api/")) log.push(`${r.method()} ${u.pathname}${u.search}`);
  });
  await installTimer(p);
  results.first.push(await timedOpen(p, log, "1"));
  await back(p);
  await p.waitForTimeout(500);
  results.second.push(await timedOpen(p, log, "2"));
  await p.getByText("Tapas", { exact: true }).click();
  await p.locator("till-menu-browser").getByText("House bread", { exact: true }).click();
  await back(p);
  results.leftUnsaved.push(await timedOpen(p, log, "3"));
  await back(p);
  await b.close();
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const tally = (reqs) => { const c = {}; for (const r0 of reqs) { const r = r0.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ":id"); c[r] = (c[r] ?? 0) + 1; } return c; };
for (const [name, rs] of Object.entries(results)) {
  console.log(`A768-REAL ${name}: ms ${rs.map((r) => r.ms).join(" / ")}, median ${median(rs.map((r) => r.ms))}`);
  rs.forEach((r, i) => console.log(`  run ${i + 1} requests (${r.requests.length}): ${JSON.stringify(tally(r.requests))}`));
}
```
