# Backlog — what to work on next, and why

This file answers **"what should I work on?"** It is state, not history: what is built (one line each),
what is open, and the order to take it in. The git log, the PR threads, and the committed
specs/plans in `docs/superpowers/` hold the detail — do not paste receipts back in here.

> **The goal is a standalone working primary on prem** (2026-09-12). The on-prem mirror and the
> cloud primary stay on the list, but they come afterwards. Three build tracks:
> **A — UI and application**, **B — infrastructure**, **C — smaller items**. Landed work is one line
> with its PR number as a locator; what a review seat caught and how something was proven stay in
> the PR thread.

**Companion documents, not duplicated here:**

- **[Cloud documentation ownership](cloud-ownership.md)** and the
  **[Waitron Cloud backlog](https://github.com/waitron-io/waitron-cloud/blob/main/docs/backlog.md)**
  own cloud services and infrastructure. This backlog retains the node application's
  integration work and shared technical prerequisites.
- **[ui-review.md](ui-review.md)** — the live tracker for the UI/UX walkthrough (Track A): which areas
  are examined, which remain, and the corrections logged against each.
- **[compliance/action-plan.md](compliance/action-plan.md)** — the legal/administrative track
  (certificates, company formation, the declaración responsable).
- **[compliance/asesor-questions.md](compliance/asesor-questions.md)** and
  **[compliance/asesor-laboral-questions.md](compliance/asesor-laboral-questions.md)** — the fiscal
  and labour advisor question lists (see *The advisor gap*, at the end).
- **[superpowers/specs/2026-07-18-pos-architecture-design.md](superpowers/specs/2026-07-18-pos-architecture-design.md)
  §2** — the twenty numbered sub-projects (the strategy; changes rarely).

---

## How the order is decided

- **The north star (revised 2026-09-12): a standalone on-prem primary a real operator can install
  and run.** A blank box to selling, printing, paying and closing, with its backups leaving the box
  and the things that go wrong visible on a screen. **Afterwards, in this order:** the on-prem mirror
  it can fail over to, then a cloud primary. Waitron Cloud product planning and service work are
  tracked in its [own backlog](https://github.com/waitron-io/waitron-cloud/blob/main/docs/backlog.md).
  Every node decision must keep the application usable in the cloud (the rules below).
- **Soundness, not the calendar** (2026-08-02). Waitron will be finished before the deli must trade,
  so 1-Jan-2027 ranks nothing above anything. Order by dependency, correctness, and de-risking the
  most-reused or most-uncertain foundations first.
- **Never autonomously land anything touching the unrepairable fiscal core** — hash-chained records,
  never-reused invoice numbers. Fiscal-adjacent work in any track takes owner sign-off at land.
- **Docs land direct to `main`** (2026-08-02): the `main protection` ruleset grants Repository-admin a
  bypass, so a docs-only change is branched, `commit -s`, fast-forwarded and pushed — no PR, no CI
  wait. Feature and code changes still go through a PR.
- **Residency:** the Spanish rollout retains Spain as its hosting target (owner, 2026-09-05).
  Country placement for the wider Cloud product is now discussed in
  [Waitron Cloud](https://github.com/waitron-io/waitron-cloud/blob/main/docs/product-and-platform.md).

**The shape we build for:**

- **One venue and one taxpayer per operational node group** (2026-09-09). One active primary, one or
  more warm mirrors, human promotion. Restaurant/bar and deli can be departments within the same
  venue and share preparation. A taxpayer with independent venues has separate node groups; shared
  cloud management sits above them.
- **A mirror is on prem or in the cloud and is reached the same way** — URL + credentials over the
  same replication link. A cloud mirror is reached over WireGuard, so two containers on one machine
  joined by WireGuard IS the cloud test.
- **Product images live in the venue database (`venue.db`) and are served from it** (2026-09-08).
  Replication, backup, restore and a cloud move are then one mechanism. The URL is
  content-addressed and served `immutable`, so each device fetches each image once until its bytes
  change.
- **Backups leave the primary.** Destinations, in build order now that the mirror comes afterwards
  (2026-09-12): an S3-compatible bucket, Google
  Drive, then the mirror once it exists. All three hang off the existing `StorageBackend` seat.

**Cloud-compatibility rules** — a change that breaks one is a design question, never a default:

1. Peers are reached by URL + credentials only. No LAN discovery, no shared-subnet assumption.
2. Adopt, promote, rejoin and backup are ONE code path wherever the node sits.
3. Every two-node test runs twice: over the plain LAN and over a WireGuard fixture. The one built in
   #275 (`two-node-wireguard.ts`) was deleted with PostgreSQL in #489; none exists today.
4. Everything a node keeps on disk, `venue.db` included, is in a named volume, and every secret can
   come from the environment as well as a file.
5. The print agent is its own process on the venue's LAN, dialling OUT to the primary by URL. It is
   the one piece that must stay on prem when the primary is in the cloud.

---

## Cloud connection integration — 2026-09-24

Built: the Settings → Cloud services screen and local manager adapter implement the
[connection journey](developers/cloud-connection.md); installation credentials use key-bound
one-hour leases with a background refresh worker and owner/manager revocation; the local
remote-access integration covers venue-owned staff certificate keys, CSR/install commands, live TLS
reload and the minimal public availability endpoint; the serving-primary test installation schedules
signed, encrypted daily snapshots and uploads them to Cloud; the setup wizard guides a fresh
replacement through Cloud owner approval of one verified snapshot for a test venue; and the restored
test-server Cloud replacement path has landed (#638). A stopped replacement stays stopped when
`cloud-connection.json` is lost, because Stop access also records the stop in
`cloud-replacement.json` (#808), unless that file cannot be read (see Open). Observations are
synthetic until service adapters exist. Cloud owns the two-server WireGuard/HAProxy proof, bot gate, DNS
override, gateway replacement and revocation.

Open:

- Customer remote setup UI and production deployment remain open.
- Shutdown waits for an in-progress local database copy or encryption step. Next: measure that
  shutdown latency, real venue uplink budgets and spool disk use, and stream archive assembly beyond
  its current in-memory 512 MiB format limit. Cloud documentation: `docs/authenticated-captures.md`
  in waitron-cloud.
- After a Cloud replacement (#638), installing the new tunnel and TLS certificate remains an
  operator step. Continuous complete-server recovery, planned final-write handover and production
  recovery remain open. Cloud owns route placement and fencing in its backlog.
- A stop made while `cloud-replacement.json` is unreadable is not recorded in it. If that file is
  later repaired and `cloud-connection.json` lost, the next start restores the connection without
  the stop and the next check sends `renew`, so a stop Cloud had not yet heard is lost (left open
  by C29, #808). Owner to choose: refuse Stop access while the replacement file is unreadable, or
  record the stop somewhere that survives the repair.

The Litestream stream's sealed-state restore and activation still need integration with Cloud
storage and owner recovery. Connected does not mean those services are configured. Cloud service
ownership stays in the Cloud backlog; this repository owns its adapter, screen and node-side
behavior. Public hosting, ingress controls and Cloud audit/retention remain deployment work.

## What to work on next

Ranked 2026-09-27, after the specs still in `docs/superpowers/specs/` were checked against the code
(each spec's state is under *Reference → Specs still in the tree*). Each item is its own brainstorm →
spec → plan → PR; fiscal-adjacent ones take owner sign-off at land.

1. **Finish table service and paying a bill in parts** (A4, lane B). All eighteen of the service
   plan's tasks are done, the last being Task 17, a table that leaves without paying (#991).
   What Task 16 (counter handover, #981) and Task 17 left open is in their Task 16 and Task 17
   entries under A4.
   **Send asesor Q27–Q29 now:** the owner decided Q28 without the asesor on 2026-10-01 and Task 17
   is built on it, so Q28 is asked to confirm; how Task 11's discount appears on the invoice is
   Q29, and printing the invoice before payment is Q27.

2. **Build good screens for each kind of device, and retire canvases** (A4's A182, owner
   2026-10-01). The till, handheld, kitchen screen and pass are still built from stored canvases of
   tabs and cards, against the owner's 2026-09-20 decision for well-designed built-in screens.
   Design the screens first, then remove canvases; until then, no new feature is built as a canvas
   card.

3. **Staff cannot clock in or out** (A10). The working-time record is a legal duty from the first day
   the deli employs anyone, and only its library is built: nothing in `apps/` calls `clockIn` or
   `clockOut`.

4. **What a standalone box still lacks before a real venue runs it:**
   - an off-box home for the backup archive (B2) — the bucket stream of `venue.db` is built, but
     archives can only be saved on the box itself (`LocalFsBackend`);
   - installing or renewing the AEAT certificate after setup (A9) — today only the setup wizard can
     set it, and nothing watches when it expires;
   - upgrade testing with rows the product itself writes and a real older database (B4) —
     owner-marked blocking before go-live;
   - the bootable USB installer (B3), the last piece of "install without a terminal";
   - the degraded-but-trading recovery spec (B5).

5. **The till does not load its menu until a manual refresh** (A4). Seen on the blank-box-to-selling
   run; the box and sale path worked.

6. **The displays and the printers walked at the real box** (A4, A3) — till, handheld and KDS through
   [ui-review.md](ui-review.md), and the first physical print since #327: slips, duplicates, the
   drawer pulse, the feed-before-cut. #689 printed calibration samples and a sample receipt on the
   owner's NT-806 and fired its drawer from the calibration test. Since C107 (#974) every printout
   is drawn as pictures, and none of them (the ruler page, the sample receipt, a receipt, a kitchen
   ticket) has been photographed or recorded as printed; the owner's box will not start on this version
   until its venue is reset, read from the code and not run on a box (A3, "Upgrading a
   venue that has used its printers refuses to start"). A real sale's slip, the duplicates, the
   cash-settlement drawer job and the feed-before-cut are still unwalked.

7. **Smaller, independent pieces**, in no fixed order: refusing requests from a device that is not
   enrolled (A4); Logging Slice 2, the one-touch
   bug report (A9); the first real Bluetooth pairing at the box through the dashboard (A3; the print
   agent's side, P2b, and the dashboard's, P2c, are built); paying at the table from a handheld (A6,
   Slice 2).

Then the on-prem mirror and failover — slices 3 to 5 of the storage design — then the cloud primary,
under *Afterwards*. Everything else ranks beneath these.

---

## Track A — UI and application

What staff and the operator touch: `apps/till`, `apps/dashboard`, `apps/setup`, `packages/ui`,
`packages/layouts`, `packages/identity`, the dashboard-, till- and setup-facing routes in
`apps/server`, `packages/printing`'s dashboard side, `packages/payments*`. The numbers name areas;
the current ranking is *What to work on next*. The small items at the end of each area live in
Track C.

**Built in the catalogue, menus and dashboard areas below** (one line each; the PR holds the detail):

- Product folders, slice 1 (#968); menus that include menus, slice 2 (#993); prep-station rules
  and the Prep Stations screen, slice 3a (#1004); folders with no routing rule flagged on Products,
  PF3b (#1009); a station's ticket shows the rest of the order, and dishes made at the till, slice
  3c-1 (#1013).
- Sales classification, Tasks 1–3 (#645, #648, #738); the category report at time of sale
  ignores catalogue edits (lane A's W10, #1110). The menus plan, Tasks 1–9 (#651, #654, #659,
  #664, #670, #680, #677, #683, #696, #710, #719, #722, #729), with M6c (#705), M7b2 (#702), M7b3
  (#713, since retired) and M7v (#720); a line keeps its frozen VAT class and the rate is looked up
  by the day of issue, A68 (#726).
- Extras and Options replaced modifiers (#412, #436, #445, #449, #452, #456, #462, #465, #469,
  #471, #476, #478, #480); variants as products (#511, #517, #528, #532, #537, #539, #545, #551,
  #556); a sale needs a zone (lane B's B4, #571).
- The Products overhaul: categories (#340, #353, #362, #383), units (#342, #350, #375, #382), the
  product editor (#345, #379, #387), the modifier screens (#352, #370, #377, #385).
- Content languages and the image library (#339, #344); photos shrunk on upload (#543); a photo
  has a name and nothing else, A157 (#980); the photo search matches a word as it is typed, A156
  (#983).
- The kitchen screen and ticket: a notice carries its line's unit (A71, #725); Each is left out of
  queue rows, notices, tickets and the expo board (A78 #797, A109 #805, A114 #811, C33 #819); the
  out-of-date banner (A72 #727, A79 #798).
- The owner's dashboard fixes of 2026-10-01: Options rows open their editor (A168, #995); Add
  actions sit on the tab row (A174, #1001); body text 14px in the system font (A179, #988); a
  dragged row follows the pointer (A180, #994 and #1003); pickers leave out products already held
  (A181 #990, A183 #997); form fields in the filled style, drawn by the shared field components
  (A178: #1010, #1012, #1015, #1016, #1017, #1019). The Extras and Options editor fixes, A64–A67
  (#714, #716, #717, #718).
- Secret checks derive the key off the event loop (A126 #900, A125 #912, A146 #941); the PIN,
  manager-login and profile checks derive their key before the write lock is taken (W1, #1117); a product save reads the language setting once (A149, #943); `wt-tabs` sends
  `wt-tab-change` (A150, #937); undeclared token reads and the Cloud services typography and dates (C69 #865, C75 #867, C76 #879,
  C85 #896).

**Product folders, menus that include menus, and prep station routing: partly built
(design approved 2026-09-30).** The
[design](superpowers/specs/2026-09-30-catalogue-menus-routing-design.md) is built in slices. Slices
1, 2, 3a, 3b, 3c-1, 3c-2 and 3c-3 have landed (above). Slice 3c-2 makes extras at their own station and
names the dish and extra on each other's tickets (PF6,
[plan](superpowers/plans/2026-10-01-split-off-extras-slice-3c2.md), [#1046](https://github.com/clintongormley/waitron/pull/1046)). Slice 3b
([#1024](https://github.com/clintongormley/waitron/pull/1024)) adds station opening hours, by-hand
open and close, fallbacks, the till's dead-end question before sending or payment, and down-printer
and dark-screen alerts; a station with no replacement asks the waiter where to make its dishes or
to remove them. It follows the
[approved plan](superpowers/plans/2026-10-01-station-hours-fallbacks-slice-3b.md) and needs no venue
reset. **Owner decision (2026-10-01):** deleting only empty folders
stays immediate, including any routing rules attached to them; a confirmation is shown when the
selected folders contain products or subfolders. Each dev venue needs `wa-wt reset demo
<worktree-name>` after slices 1 and 2, and after slice 2 the owner's box needs a reset too: library
sections and their placements disappear and per-menu extras are retired. Reload tills running the
older build before using the new published document. **Slice 3c-3 landed as [#1068](https://github.com/clintongormley/waitron/pull/1068) (PF7)**: "Make at" on
any dish before sending, moving a dish the kitchen has not started (with a slip at the old station
when its ticket printed there), and checking a held dish whose station closed or switched off before
release against the current rules. A station chosen by hand stays while switched on, even if closed,
without an alert. Otherwise, with no replacement, the dish stays at its old station and raises an
alert. A dish made at the till is never moved or re-routed
([plan](superpowers/plans/2026-10-01-moving-dishes-slice-3c3.md)). Status and remaining work:
- **3d watchers — LANDED (#1088, 2026-10-03)** ([plan](superpowers/plans/2026-10-01-watchers-slice-3d.md)): the pass and runners
  follow stations and service zones on screen and paper. Each watcher has its own Done, while Away
  stays shared. Watcher printers replace whole-order printing; an existing printer set to
  "one ticket per order" keeps printing its attached stations' tickets until you attach it to a
  watcher (owner, 2026-10-01).
- **Show how many dishes are being made on the table plan — OPEN (3d, W16).** The plan has no such
  count; adding one needs another value from `listTablesWithState`.
- **Refresh the floor without a staff action — OPEN (3d, W16).** `till-floor-screen.ts` reads on
  events handled by `till-app.ts`'s `floor-refresh`, not on a timer. Polling would read
  `listTablesWithState` every few seconds on every till; choose the interval and cost first.
- **Drop `printers.ticket_scope` at the next reset — OPEN (3d, W20).** Printing no longer reads the
  column. Dropping it rebuilds `printers`, so leave it until the venue reset that permits the rebuild.
- **Clear a failed watcher copy without printing or resending — OPEN (3d, P9).** A Reprint does not
  clear its failed job because watcher copies have no station or bill link.
- **Avoid repeat watcher configuration reads during a table move — OPEN (3d).**
  `readSentWork`, `enqueueMovedSlips`, and `printCorrectionSlips` each read watcher printers in the
  move flow. Measure the query count on a moved order with a watcher printer, then pass one read
  through the transaction if it repeats unchanged configuration.
- **Show one watcher in a canvas card — OPEN (3d, P15).** The ordinary embedded pass card still
  shows All stations; a watcher-bound device opens its own board.
- **Alert when a watcher's screens go dark — OPEN (3d, P17).** The existing dark-screen alert is
  station scoped, while a watcher can follow several stations.
- **Move an enrolled kitchen screen between stations and watchers without joining again — OPEN
  (3d, P18).** Its binding is selected at joining; changing that binding needs a separate action.
- **Keep watcher Done marks through a `ticket_items` rebuild — OPEN (3d).**
  `watcher_item_marks` cascades from `ticket_items`, so a rebuild empties those marks.
- **Keep the two watcher filtering rules together — OPEN (3d).** The server's `watcherSees` and
  Prep Stations' `watchersSeeing` each have a hand-copied test table. Neither test detects a change
  to the other rule.
- After approval the owner ruled that a dish made at the till is never held and the till lists
  what to make ("Make now"); 3c-2, 3c-3 and 3d were amended to match.
- **Three follow-ups 3c-1 left:** the kitchen screen's column view has no per-order card, so it
  does not show the rest of the order (a station that needs that context uses the card view);
  units added to a discounted pay-first dish held in a group get a held kitchen record of their own
  while the dish has none — observed on `main`, its history not checked, and whether it is wanted
  remains open; and a device's made-here stations do not travel in configuration export, because
  devices are not exported (`packages/db/src/configuration-transfer.ts:1-37`), so a venue set up
  from an export sets them again on the Devices screen.
- **Current orders hides kitchen progress for an extra made at another station** (P6). The till's
  Current orders read attaches extras under each dish but reads kitchen state only from the dish's
  record (`readCurrentOrders`, `apps/server/src/order-groups.ts`). Show the extra's own progress.
- **Move to station on a paid counter order.** The move route accepts an order that is paid but not
  yet handed over (`apps/server/src/station-move.ts`). Add the button to B16's "Paid, not handed
  over" list ([Task 16](superpowers/plans/2026-09-26-service-ordering-and-billing.md)).
- **The Alerts table makes long station warnings hard to read on a phone.** A 390 px mounted
  dashboard fixture for `route.released_at_closed_station` showed only the start of its warning at
  first; its 340 px table viewport had 906 px of scrollable content, and a 566 px horizontal pan
  reached the remaining text. Give the alert text more room at phone width while keeping its
  handling action reachable.
- **A till-session station view can bump a dish another station now has.** The till-session
  `POST /api/ticket-items/:id/advance` route does not check the item's station
  (`apps/server/src/till-api.ts`); the device route does (`apps/server/src/device-api.ts`) and refuses
  `device.forbidden_station`. Until its next 15-second poll, a till's station view can still show a
  moved dish and advance it at its new station. The route predates PF7; moves make this more likely.
- **A following extra has different names on paper and on screen.** Its `+` line prints the frozen
  staff name (`buildTicketItems`, `apps/server/src/kitchen-print.ts`), while the kitchen screen and
  pass read its frozen customer `descriptions` (`readQueueSubItems`,
  `apps/server/src/working-order.ts`). A split-off extra's cross-reference reads kitchen names on
  both surfaces. Decide which name the following extra should show, then make the surfaces agree.
- **Done (lane C's W27, #1140) — the till navigation fits a 390 px screen** (PF6 Task 9's wide
  screenshot). The header bar wraps onto more rows at phone width; the entry under C130's review
  below has the measurements.
- **The dark-screen alert can be wrong** (S2b, owner, 2026-10-01). A kitchen working from paper
  may never mark dishes ready on its screen. With that screen switched off, each send can raise
  the dark-screen alert for up to an hour while those dishes remain waiting. A kitchen screen
  opened through the dev stack's device chooser never records a check-in: the override returns
  before the cookie path updates `lastSeenAt` (`apps/server/src/device-session.ts:176-186`).
  Improve how the alert distinguishes a kitchen using paper and how the dev chooser records check-ins.
- **Opening or closing a station from the till** (S11, owner, 2026-10-01). Add a core till route
  calling a new `VENUE_SERVICE` seat method, so staff can open or close the station from the till.
  Take a manager's PIN as the cash drawer route does (`POST /api/drawer/open`,
  `apps/server/src/till-api.ts`).
- **Deleting or moving a folder does not show which products change station** (slice 3a, approved
  R6). The delete dialog counts claims and exceptions removed but lists no products whose
  destination changes, and **Move to…** changes folder ancestry without a routing preview. Add that
  preview before extending these operations during service.
- **A future rebuild of `categories` can empty its routing rules.** `station_claims_category_fk`
  and `route_exceptions_category_fk` both use `ON DELETE CASCADE`
  (`packages/venue-service/src/schema/routing.ts`); follow CLAUDE.md §3's rebuild rule and add a
  populated-upgrade check before another categories rebuild.
- **The Spanish menu preview's selected Preview tab showed clipped at 390 px** after programmatic
  selection, in a render on 2026-10-01; clicking it scrolled it into view. A base-build render was
  not run, so when it began is not established (geometry and screenshot:
  `~/waitron-campaign-e/receipts/finish-render-20261001/render-report.md`). Check restored selection
  visibility before changing the shared tab component.

**Sales classification and the menus plan — what they left open.** Both plans are complete (the
[menus design](superpowers/specs/2026-09-20-menus-categories-and-home-layouts-design.md) (§11 wins
over §10, which wins over §1–§9; "category" in §1–§7 means SECTION) and
[plan](superpowers/plans/2026-09-25-menus-categories-home-layouts.md); the
[classification design](superpowers/specs/2026-09-25-sales-classification-and-category-reports-design.md)
and [plan](superpowers/plans/2026-09-25-sales-classification.md)). Several entries are overtaken by
the 2026-09-30 folders design; what remains:

- **Classification.** `Product.categoryId` and `primaryCategoryId` always hold the same value, and
  `?descendants=1` on a category's products has no dashboard caller. A line's classification is
  recorded when it is added (M7v), so `sale_classification.invalid` refuses adding a line; whether
  the till's message for that refusal on the add paths is right is not checked. The demo seed
  (`apps/server/scripts/demo-seed/seed-sales.ts`), the other scripts that call `recordSale`
  directly (`record-one-sale.ts`, `settle-invoice-first.ts`, `daily-close-demo.ts`,
  `daily-close-z-demo.ts`, `modelo-303-demo.ts`) and `apps/server/src/fiscal-readiness-runner.ts`
  file sales without the issuance pass, so seeded demo lines carry no product id, classification or
  gross, and the Sales screen's category report shows every seeded line under Not recorded.
- **The category sales report (#738).** `wt-button` disables only its inner `<button>`, so a
  scripted click on the host still reaches a click handler; the Sales screen's print handler checks
  for itself, other screens relying on `?disabled` alone have not been checked. The spec (§6)
  wanted the category analysis printable with the daily close, but no daily-close print exists.
- **Photo-holding tables are named by hand in several places in `packages/media`** (the triggers,
  `listImageUsages`, `countUsages`, the live-query dependencies, the `before` lists in
  `module.ts`, the `ImageUsage` unions), and only a comment keeps `countUsages` and
  `listImageUsages` in step; one list those derive from, checked against the triggers, would make
  the next such table one edit.
- **`sections_owner_menu_fk` has no delete rule**, so deleting a menu that owns a section will be
  refused until one is chosen; nothing deletes a menu today. Media's triggers name `sections`, so a
  later rebuild of that table meets the trap `docs/developers/conventions-data.md` records.
- **A product reached through a section offers no extras list** (noted at #659, and already so
  before it, checked at `002b79f69`).
- **`wt-data-table` searches a column's sort value when it has no search value**, so a number
  column matches typed digits unless it opts out; changing that default needs a check of every
  table that searches prices or counts.
- **No route raises `menu_item.variant_not_allowed`**: `addProductToMenu` is its only thrower and
  the demo seed its only caller outside tests. The code and its 400 in
  `apps/server/src/catalogue-api.ts` are left for whoever next prunes unraised codes.
- **The Menus screen (#664).** Which section is being edited is not in the address, only the menu
  and the tab. Opening "Add to menus" sends one `getMenuStructure` request per menu, each reading
  the whole section graph (`readMenuStructure`, `packages/catalogue/src/menu-structure.ts`); one
  server read returning every menu's structure would make it one. A refused change's message sits
  under the menu's heading, above the tabs, so on a phone the tree sits between it and the list it
  names; if someone else exactly undoes a move while it is saving, the move's answer is shown over
  their change until the menu is next read; and no accessibility test covers that message.
- **The Price overrides tab (named Prices until W89; #670, #680).** The owner decided 2026-09-26
  that removing a product's last placement needs no warning before it clears the menu price and
  variant settings. Open: the main-category filter offers every category, not only those on the
  menu; the product editor's help lines are paragraphs beside their inputs, not linked to them (a
  `hint` shows only as the placeholder since C104, so moving them there would hide them whenever
  the field holds a value); a variant row is announced by its name alone; and,
  from reading only, a Columns panel wider than a very narrow screen would not shrink to fit, and is
  not re-placed on resize.
- **Publishing (#677).** After a publish the editor's heading shows the browser's clock until the
  next read; a re-enabled product's "added" change can name its section as the source; the status
  and preview reads build every menu's frozen copy inside `withTransaction`, the venue's write lock
  — about 21 ms median for 4 menus and 300 dishes on a dev laptop, not measured on the box; at
  phone width the list keeps a fixed room for the row menu, and a status sort falls back to a name
  sort. The configuration import (`apps/server/src/configuration-transfer.ts`, inside
  provisioning's `beforeCommit`) deletes every `catalogues` row, so a provisioning or demo-seed
  path that publishes a menu BEFORE the import runs fails the import's commit on the append-only
  `menu_versions` → `catalogues` key. `apps/dashboard/src/widgets/variant-form.test.ts` failed once
  in a local dashboard coverage run; which of its tests failed was not recorded. The one
  intermittent failure in that file whose cause is known, the Escape test, is fixed (A220f, #1075; see the
  flaky-test entry); whether it was this one is not known.
- **Changing sent lines and the kitchen screen (Task 7c, #710, and the kitchen fixes after it).**
  The counter's prep-queue card shows no notices and does not refresh. The till's API client has no
  general request timeout (only the kitchen refresh and menu-state reads are bounded, at 25 seconds,
  and a table's round sends and offer reloads, at 150 seconds). A refusal that lands after the tab
  is paid, or after a server switch, shows the ordinary unnamed message. The kitchen screen's list
  of stations is read only when the screen opens, so after that read fails the out-of-date banner
  stays, counting, until the screen is opened again; long outages are counted in minutes, never
  hours.
- **Each is decided by the unit's identity, with one known gap.** While a line is still open,
  deleting the stored unit seeded as `each` it was sold in makes its queue row, any notice recorded
  after, its printed ticket, the expo board and the ticket's merge-or-split check read it as not
  Each, because `readLinesSoldInEach` looks the seed key up on the live unit row; the unit a product
  with no stored unit reads as cannot be deleted, so only such a stored unit is affected. A line with
  no recorded context but a unit recorded on it prints that unit, so its entries print as sold.
  **Kept as they are, by the owner's choice (2026-09-28):** the printed receipt
  (`apps/server/src/receipt-ticket.ts`) and the till's ticket view
  (`apps/till/src/screens/till-ticket-view.ts`) still show the Each unit.
- **VAT at line add (M7v, A68).** Asesor Q26 (the rate on the day of issue) is open. Owner rulings
  at landing (2026-09-27): invoice-first issues at placing, so it takes the placing day's rate; a
  box holding order lines is reset rather than given data-migration code; and every invoice path
  reads its one clock after the order's lines. `apps/server/src/vat-class-at-line-add.test.ts`
  copies its setup from `issuance-pass.test.ts`; a shared helper could absorb it. The till computes
  a basket VAT split (`vatBreakdown`, `apps/till/src/state/working-order.ts`) that no screen shows.
- **Nothing in the product can issue a corrective invoice (R5, *factura rectificativa*) for a VAT
  error on an issued simplified invoice.** `recordCorrection` exists
  (`packages/core/src/record-correction.ts`; the Verifactu backend corrects only an F2, as an R5),
  but no route calls it: its only callers under `apps/` are three scripts in
  `apps/server/scripts/` (`daily-close-demo.ts`, `modelo-303-demo.ts`, `settle-invoice-first.ts`)
  and tests. _(2026-10-02, C126: the whole-order cancel route now calls it, for a credit of the
  whole invoice only; no route issues a correction for part of one.)_ The owner also needs a way to
  correct an issued invoice when a customer spots an error after payment, regardless of the future
  Tabs · Bill choice (2026-10-04, A261 step 2 decision). **The owner's points for when this is
  designed (2026-09-29):** (1) the amount staff enter is what the customer gets back,
  VAT included — a €2.00 correction at 10% is €1.82 base plus €0.18 VAT; (2) whether a correction
  should instead cancel the original and issue a new invoice (`TipoRectificativa` "S", where
  today's path files by differences, "I", in `packages/fiscal-verifactu/src/backend.ts`) — asked as
  asesor Q31 (2026-09-30), not decided.
- **The till's menu reads (Task 7, #719).** Every `/api/menu-state` poll waits its turn in the
  write queue, because the route and `requireSession` (`apps/server/src/till-session.ts`) read
  inside `withTransaction`; reading outside a transaction would skip the queue but give
  `menuState`'s queries no single consistent view, and there is no read-only transaction
  (`packages/db/src/tenancy.ts`). A
  till learns of a change only by polling, because the dashboard's live-update route accepts the
  management cookie only; a till-session branch there would let the server tell tills (plan D11), a
  later refinement. The basket comparison does not notice a publish that adds a required options
  list to a dish in the basket, or lowers a list's picks limit, so the till takes the new version
  silently and the server then refuses `options.label_required` (or `extras.limit_exceeded`): staff
  see a refusal where the dialog should have asked.
- **Every remembered round is marked again against the open table's menu**, so opening a table in
  another service zone can mark another table's round wrongly or clear its mark. Read, not run:
  `#markedRounds` in `apps/till/src/till-app.ts` holds every store refused sold out or after a menu
  change, drafts included, and `#markRounds` marks each against the open table's offers; whether a
  store from an earlier table is ever shown again was not checked. Remember each round's zone, or
  keep rounds on the app, one per order.
- **Home layouts (Task 8, #722).** A profile's layout choice saves as soon as it is picked, outside
  the profile's own Save and Cancel (the section says so); which layout is being edited is not in
  the page address; the tile picker offers active products only, so an inactive product's tile
  shows no marker and cannot be added again until the product is switched back on; and no
  accessibility scan covers the delete window's error state. **For the owner:** the picker never
  offers the current default layout by name, so a profile cannot be pinned to today's default; the
  server would accept such a choice.
- **The till's home page (Task 9, #729).** Search matches the staff name only, not a customer name
  or a section's name. Every `/api/menu-state` read from an enrolled device reads the device, once
  per zone the till holds at each poll; the token's scrypt check (21.1 ms, measured once on a Mac)
  runs off the lock, once per device until its token changes, the server restarts or the device
  falls out of the 256 the server remembers. No test switches one menu between two layouts and
  compares the structure, search and prices.

**Copying some of a section's products into another section is not built** (found by the menus
plan's closing sweep, 2026-09-27). The menus spec §2 asks to select all, almost all or some of a
section's products and add them to another section, creating it in the same flow if needed, with
the selection telling the section's own members apart from products reached through a nested
section. What landed is duplicating a section and §10.2's Add products flow. Since slice 2 any such
follow-up belongs in the owning menu editor. **Next action:** the owner decides whether §10.2's
flow replaces §2's copy.

**The till says "Not found" (menus spec §9) only when a newly read version drops the section it has
open.** §9 asks that a tap on a home tile whose target is no longer in the version the device should
be showing say the item was not found and reload the home screen. As built, the till puts a newly
read version on screen as soon as it has read it (pinned by "a device behind the live version (§9)"
in `apps/till/src/till-app-menu-refresh.test.ts`). Before then — up to one 15-second poll, longer on
the counter while a sale, hold or place is in flight or the review dialog is open, and longer again
when a reload fails — a tap acts on the version it holds, and the basket refresh lists the product
as "no longer on this menu". A shortcut whose target a newly read version lacks simply disappears,
with no notice. **Next action:** the owner confirms this meets §9, or asks for a notice when a
shortcut disappears.

**Secret checks and the write lock: the PIN, manager-login and profile checks moved — DONE (W1, #1117);
two blocking derivations and one stale-answer window remain OPEN.** Every check against a stored
hash from `packages/identity/src/secret-hash.ts` derives the key with `verifySecretAsync` on Node's
thread pool. The print agent's token and the two join-status readers derive it with no transaction
open (A125, #912), and so does the device token (`tryReadDevice`, `apps/server/src/device-session.ts`).
W1 moved the rest: PIN sign-in, the drawer override, the cancel of an invoiced order, the unpaid
departure, the adjustment approver, the two payment attestations, the bill refund's override and
confirmer, the four manager password sign-ins (email, membership, promote, mirror bundle) and the ten
own-password profile and credential changes now derive the key before the transaction opens, and the
check inside it reuses that result only while the person, the secret and the stored hash it was
derived against are the same (`docs/developers/conventions-data.md`). Attempts sent at once through
`withPinCheckAhead` or `ownPasswordChanges` take turns per throttle key. Nothing makes a NEW route
do the same. **Still open:**
`hashSecret` derives with `scryptSync` (`secret-hash.ts`), so minting a token or setting a PIN or
password stops the event loop; and `deriveKey` (`apps/server/src/scrypt-kdf.ts`) runs `scryptSync`
too, reached when the server encrypts or decrypts a configuration bundle, decrypts a restore archive
or a sealed node state, or encrypts a recovery bundle. Left by #912's review: the two join-status
readers answer from a hash read just before the key is derived, so a request denied or revoked in
that window can get one stale `pending` or `approved` (both routes return only `{ status }` and issue
no credential; the till and print-agent clients were not traced); and `verifySecretAsync` could be
renamed `verifySecret` (optional).

**A till sign-in whose PIN is not text answers 500, not `pin.invalid` — OPEN (found 2026-10-03 by W1).**
`POST /api/session` (`mountTillApi`, `apps/server/src/till-api.ts`) with a PIN that is a number,
`null`, missing or an object answers 500 `server.internal`; measured the same before and after W1.
**Next action:** refuse a non-text PIN as `pin.invalid`, with a failing case first. (The payments
attestation refuses one after its throttle check and counts it as a wrong PIN,
`apps/server/src/payments-api.ts`.)

**A burst of till PIN sign-ins derives a key for every attempt — OPEN (found 2026-10-03 by W1).**
`POST /api/session` (`apps/server/src/till-api.ts`) checks its throttle before any failure is
recorded, so attempts sent at once all pass it. Measured 2026-10-03: 8 wrong attempts at once gave 8
derivations and eight 401s, on main and on W1's branch alike; manager password sign-in gave 1
derivation (one 401, seven 429), because `passwordThrottle.begin` refuses a second attempt in
flight. **Next action:** give the till sign-in the same turn-taking (`inTurn`,
`apps/server/src/attempt-turns.ts`) or an in-flight refusal.

**The till's removed-layout warning outlives a sign-out.** When the home layout a device's profile
chose is removed, the till warns until someone presses Dismiss. Signing out does not clear it
(`#onLogout` leaves `removedLayouts` as it is, `apps/till/src/till-app.ts`), so the next operator to
sign in on that device sees it. **Next action:** clear it in `#onLogout`, if the owner agrees the
warning belongs to the operator who was signed in.

**A section with nothing to order in it disappears from the till, and the tiles after it move.** The
menu browser leaves a section out, from the structure and as a shortcut, when no product beneath it
is among the offers it is given (`indexMenu`, `apps/till/src/widgets/menu-browser.ts`): when every
product in it was Inactive when the menu was published, while a diet filter is on and every product
in it fails the filter (`apps/till/src/widgets/card-grid.ts`), and when every product in it is
published as not sold separately. A section whose products are all sold out keeps its place, and its
tile is not greyed; the products inside it are. Spec §5 wants buttons in predictable positions
during service. **Next action:** the owner decides whether either kind of empty section should keep
its place, for example greyed.

**A joined tab of no party can have kitchen slips naming a table its ticket did not print.**
Correction and MOVED slips name such a tab's lowest-id table (`orderTableLabels`,
`packages/db/src/party-table-labels.ts`), so after a join a MOVED slip's "from" can name the other
table; recording each ticket's printed table would fix it. A party's bill names all its tables
instead. Since table actions Task 13 the join and move-tab routes are deleted and
`dining_tables.tab_id` is dropped, so a bill reaches a table only through its party or, for a
counter order, `delivery_table_id`; whether a tab of no party can still reach a join is not
established.

**The owner decided a split check gets no Void; the server now allows one.** Since table-actions
Task 2 (#825) the cancel path checks `assertPartyBillOpen` (today in `applyAdjustment`,
`apps/server/src/adjustments-apply.ts`, which replaced `voidTabLine` in B11a), which lets through
an open bill that belongs to a party whether or not a table points at it, and a split check carries
its party. **Decided (owner, 2026-09-26):** a check
gets no Void; a change of mind between "Create bill" and paying was covered by the till merging the
check back. Since table actions Task 10 the till no longer merges it back on its own; a change of
mind is undone by Merge bills on the party's table screen, by hand. **Next action:** the owner
decides whether that still covers the no-Void decision.

**Ongoing — the dashboard UI overhaul, screen by screen.** Every screen is being brought onto one
shared look, and the rules for it live in [design-system.md](developers/design-system.md). That
document is the contract, and it grows as we go: each screen tends to raise a question the rules do
not answer yet, and the answer is written down there in the same change rather than left in the
screen. It is screenshot-driven iteration with the owner looking at each step, not a
write-a-plan-and-dispatch job.

**Open, and it bites this work first: two documents state the component rules and they have
drifted** (found by the #337 review). `design-system.md` binds the token rule to "any component or
view" and its forbidden-colour list omits `color()`; [conventions-ui.md](developers/conventions-ui.md)
records what the guard mechanically enforces, which is narrower —
`packages/ui/src/no-hardcoded-chrome.test.ts` globs `packages/ui/src/components/*.ts` only — and
its list does include `color()`. **Next action:** decide whether the token rule binds views as well
as components, then make the guard and both documents agree. Whoever picks up the next screen should
settle this first, because every screen after it inherits the answer.

**Also open, and product-wide: the primary blue fails the accessibility contrast bar as text on the
page background, in the light theme.** Light `--wt-color-primary` (`#1f6feb`) on `--wt-color-bg`
(`#f7f7f8`) is 4.33 to 1, under the 4.5 to 1 WCAG AA minimum for normal text
(`packages/ui/src/tokens/colors.css`). The dark theme is fine (`#4c8dff` on `#101216`, 5.86 to 1),
and so is the same blue on a card or modal surface (4.63 to 1 on white). The `*.a11y.test.ts`
suites run axe's full default ruleset, but axe only sees a pairing some mounted component paints;
nothing enumerates the tokens against each other. **Next action:** an owner colour call — darken
the light theme's primary until it clears 4.5 to 1 as text, or rule that the token is never text on
the page background and add a check that says so.

Done so far: the dashboard shell itself — the sidebar, the banner and the account menu — plus
**Account settings** (Your profile) and the **user administration** section (#333; what changed is
under A7).

Still to do, roughly in the order a venue meets them. As each one lands, add the rule it taught to
`design-system.md`:

1. **Overview and Sales** — `dashboard-overview-screen.ts`, `dashboard-sales-screen.ts`.
2. **Catalogue and product depth** — `catalogue-screen.ts` and `purchases-screen.ts`. The
   owner-requested Products overhaul has landed ([operator guidance](products.md)). One question
   hangs over it: the existing zero-rate class is shown as **No tax (0%)**, and asesor Q20 asks
   whether any intended case legally needs N1 or N2 instead — to be answered before the first live
   filing (the #345 entry below).
3. **Printing** — `printers-screen.ts` with its agent tabs, and `printing-rules-screen.ts`. #319,
   #327 and #380 reworked these, so read them against the rules before changing anything.
4. **Payments** — `payments-screen.ts` and the provider panels in `packages/payments-stripe` and
   `packages/payments-sumup`. #333 changed only their row menus.
5. **Devices and displays** — `devices-screen.ts`, `device-profiles-screen.ts`, `floor-screen.ts`,
   `kitchen-screen.ts`, `service-status-screen.ts`.
6. **The two editors** — `canvas-editor-screen.ts`. The receipt one is done: C116 (2026-10-01)
   rebuilt it under the current forms rules as the Receipts page, `receipts-screen.ts`.
7. **Workforce** — `roster-screen.ts`, `my-schedule-screen.ts`, `planned-actual-screen.ts`,
   `approvals-screen.ts`.
8. **Venue operations and bookings** — `packages/venue-service/src/dashboard/` and
   `packages/bookings/src/dashboard/`. #333 touched only the venue-operations row menu.
9. **Operator utilities** — `backup-screen.ts`, `diagnostics-screen.ts`, `email-screen.ts`.
10. **Login** — `login-screen.ts`, which already carries the owner's own review from 2026-09-09
    (CLAUDE.md §3, the `ui-login` findings). Fold those corrections in rather than restyle it twice.
    A191 (#1074, 2026-10-03) put every sign-in step in a card; the email, password, passkey and Google
    steps put their own way in outside the action row (design-system.md, login section). Since A228
    the Google step's is Google's own button, not a primary one.

The till (`apps/till`) and the setup wizard (`apps/setup`) are separate apps drawing on the same
shared components. Whether they follow in this pass or later is open — decide it before the
component rules harden around the dashboard alone.

**Content languages and the image library (#339, #344) — what is left open.**
[Operator guide](content-and-images.md).

- **A new picture consumer has to add a real database reference, not just store a filename.**
  Products point at the image table through a foreign key on the picture's filename
  (`products_media_image_fk`, `ON DELETE RESTRICT`), which is what makes "you cannot delete a
  picture something is using" true. Any future screen that shows a
  library picture has to add the same kind of reference and a sentence naming the use, or that
  check will not see it.
- **The online language selector has nothing to select for yet.** The setting and the rule for
  choosing a language are built and tested; the customer-facing online ordering surface they were
  built for does not exist.
- **The test-shape half of #339's lesson is unwritten.** #339 passed review and CI and the first
  person to open the screen got a 500; the "open it and look" half is CLAUDE.md §4's rule. The
  other half — a matrix that varies two things separately and never crosses them proves less than
  it looks — wants its own line.
- **Left by A157's review:** the upgrade test `packages/media/src/schema/name-only-upgrade.test.ts`
  makes its scratch folder with `tmpdir()` rather than `scratchParent()` (`scripts/scratch-dir.mjs`),
  unmeasured either way; the list of hand-written migrations in
  `docs/developers/conventions-data.md` leaves out core `0036` and `0047`, catalogue `0013` and
  media `0004`, and A157's media `0005`; and the photo search's "a phrase cannot straddle two
  translations of a name" is untested. **Next action:** fill the list when next touching that
  file; the other two need a decision whether they are worth a change at all.

**Photos are shrunk on upload — LANDED #543.** Every upload is resized to at most 1600 pixels on
its longer side, turned upright, stripped of its metadata and stored as WebP at quality 80
(`prepareImage`, `packages/media/src/prepare.ts`). What it leaves open:

- **The upload limit is 20 MB (owner decision 2026-09-23).** It bounds how large an upload the
  server will buffer; the decode is bounded by `MAX_INPUT_PIXELS` (100 million). What current
  phones produce has not been measured.
- **The library grid loads the full 1600-pixel copy for each tile**, 24 photos a page
  (`packages/media/src/dashboard/image-library.ts`), about 4 MB at the average size. **Next
  action:** decide whether the grid needs a thumbnail copy for slow Wi-Fi.
- **libvips is LGPL-3.0-or-later** and ships in the box image with its notices and a written
  source offer in `/app/third-party/` (`deploy/third-party/`). The legal advisor is asked to
  confirm it (`docs/compliance/action-plan.md`, 2026-09-23).

**Product categories (#340) — what is left open.**
[API and integration guide](developers/product-categories.md).

- **Category authoring serialises across the whole database, and nobody has measured what that
  costs.** `withTransaction` admits one write transaction per venue file
  (`packages/catalogue/src/categories.ts`, above `listCategories`). **Next action:** measure it
  before anyone widens category authoring to more concurrent editors.
- **Nothing stops the next screen styling `wt-data-table` cell markup with a class.** A check that
  compares the class names a screen's own stylesheet styles against the class names it puts inside
  `wt-data-table` cell callbacks looks feasible; nobody has tried to write it.

**Extras and Options — deliberate limits, and what is left open.**
[integration contract](developers/modifiers.md).

- **An options list is always required.** It asks for exactly one pick, with the default
  preselected; an unanswered ACTIVE list refuses the order with `options.label_required`. An
  optional options list is a possible future change, not built.
- **A variant offers its parent's lists and cannot override them**; a per-variant attachment row
  is a possible later addition.
- **The demo venue does not demonstrate extras.** `apps/server/scripts/demo-seed/` creates an
  options list (`seed-option-lists.ts`, the sirloin's `Punto`) and no extras list, and
  `docs/products.md` says so. **Next action:** seed one extras list on a demo dish, with a
  list-item price that differs from the extra product's own price.
- **Whether a `+ <list>: <label>` sub-line is prominent enough on a kitchen ticket** to replace the
  old `** MEDIUM RARE **` framing has not been put to a real cook.
- **Clearing the Extras editor's Minimum choices box saves 0** (the save format's own default); the
  A66 plan's Review Focus item 3 reads as if a cleared minimum should be refused. Open for the
  owner.
- **The Options list's rows centre their contents rather than lining up by text baseline (D6).**
  When a server refusal adds an error line under an option's name, the dot and menu centre on the
  name and the error together. Expected from the CSS in `option-list-form.ts`, not looked at on
  screen. **Next action:** screenshot a row carrying an error and decide.
- **A stored empty options default is still possible** through configuration transfer, which
  copies rows without re-parsing them (the spec's D8).
- **Seen while looking at every modal at 1024px, not changed:** the printers screen's list of
  discovered printers keeps its details column capped (`min(28vw, 24dvh)`), so the details wrap
  while half the row stands empty; and the till's option picker, 1024px wide on a 1280px screen,
  puts each price far from its name (which adds to the "prices are not a column" item in the till
  layout pass, under A4). _2026-10-05 (W70): the picker is now the standard size, 672px wide at
  1280._
- **`--wt-cell-name-max-width` is used in three different directions, and is named for one.** Some
  consumers CAP a name cell with it, others use it as a `min-width` FLOOR, and one uses it as a FLEX
  BASIS on a combobox. **Next action (design decision):** a second token for the floor, or one
  shared sizing value used three ways.
- **The two list forms still share about a hundred lines of per-form plumbing**
  (`#primaryLanguage`, `#mapFieldErrors`, `#edit`, `#emit`, `#cancel`, the `willUpdate` reseed
  guard, the Escape-while-busy handler and the footer). **Next action:** decide whether a shared
  base or a controller is the right vehicle before a third list form is written; the row editors
  genuinely differ and should NOT be merged.
- **The seven string-parsing helpers are copied between the two contracts.**
  `packages/catalogue/src/extra-contract.ts` and `option-contract.ts` carry byte-identical copies of
  `invalid`, `record`, `keys`, `staffName`, `translations`, `kitchenName` and `id`, differing only in
  the error-code prefix. **Next action:** extract them, and decide at the same time whether
  `product-editor-input.ts`'s near-copies join them. A review also suggested moving
  `resolveExtraPrice` from `extras.ts` into `extra-contract.ts`, beside the price parsing.
- **`optionListDependants` and `listOptionLists`' usage count each select the carrying
  `product_modifiers` rows with their own condition on `option_list_id`.** Whoever writes a refusal
  that uses the same condition shares it then.
- **A list switched on with no pickable label is refused only by the parser.**
  `parseOptionListInput` is the only door today; a path that writes `option_labels.available`
  directly, or flips `option_lists.active` with a plain update, could leave a list nobody can answer.
- **`packages/catalogue/src/options.ts` still says `findContentTranslationGap` returns rather than
  throwing.** It throws `content.translation_invalid` for a non-text value.
- **`line-extras-editor.ts` holds the per-line kitchen note**, which was never part of this
  feature; the file name is misleading.
- **A retrieved line's options answers are re-sent by matching their WORDING**
  (`deriveOptionSelections`, `apps/till/src/state/held-options.ts`); a staff-name rename or a
  withdrawn label matches nothing, and the till surfaces `held.options_changed`.
- **A child extras row renders FLAT in the tab drawer**, beside the dishes, where the basket and
  the settled ticket nest it under its dish; whether the drawer should indent it is undecided.
- **Reopening the picker on a line whose dish has VARIANTS *and* at least one offered list loses
  the variant, and says it saved.** Measured with a throwaway browser test: no variant radio is
  selected, because `willUpdate` never seeds `variantId`, and when the operator picks one,
  `setLineModifiers` (`apps/till/src/state/working-order.ts`) discards it. Needs a decision first
  about whether a basket edit may change a variant AT ALL: if no, stop offering the variant control
  on a reopened line; if yes, `setLineModifiers` has to carry the product.
- **Both of the modifier picker's LIST inputs carry a generated id as their `name`**
  (`extras-${list.id}`, `options-${list.id}`, `apps/till/src/widgets/modifier-picker.ts`), against
  `docs/developers/conventions-ui.md` and CLAUDE.md §3. The offered-list wire carries no stable
  per-list identifier to use instead, so closing this means adding one to that wire.
- **The definition reads behind a dish's offered lists take no lock, and whether the storage
  switch closed the gap is unestablished.** `readMenuExtras`, `readProductExtras`,
  `readOptionListsByIds` and `readProductModifiers`, reached from `walkAttachedModifiers`
  (`packages/catalogue/src/offered-modifiers.ts`), are off the sale path since menus Task 7 except
  for an edit of a saved line whose dish the live version no longer offers (`productOptionLists`,
  `apps/server/src/working-order.ts`). The concern is a list edit committing mid-read, giving one
  order a snapshot mixing pre- and post-edit wording; not measured. **Next action:** trace those
  reads — if every one goes through `withTransaction` (the write lock), the entry closes on that
  alone; if any does not, decide deliberately.
- **A two-transaction concurrency test that starts both sides in sequence is racing itself.**
  Nothing guards the shape; look for it in any new racing test.
- **A trap not yet in `CLAUDE.md`: `pnpm --filter <pkg> test <file> -t "name"` silently drops the
  `-t` and runs the whole file**; only a bare `--` before it passes it through. **Next action:** add
  it to `CLAUDE.md` §2's trap list, through the normal pull request flow.

**Review points left for the owner: venue operations, the image library, the colour field.**

- **Venue operations (#546's review,
  `packages/venue-service/src/dashboard/venue-operations-screen.ts`).** (1) A zone-menu row whose
  menu is not in the loaded list shows an empty Menu cell while its row actions carry the stored
  menu id; whether a foreign key makes that row unreachable was not checked. (2) When the row that
  opened an editor is gone by the time the editor closes, focus goes to `wt-tabs` as a whole, and
  Chromium puts it on the tab strip rather than the selected tab (seen at 414 pixels). **Next
  action:** decide whether (1) shows the id or a "missing menu" label, and whether (2) focuses the
  selected tab.
- **Image library (#547's review, `packages/media/src/dashboard/image-library.ts` and
  `image-picker.ts`).** (1) When the picker is handed a new live-data source, the library keeps
  listening to the first one until its next load. (2) The delete confirmation's Close button has no
  in-flight check of its own and relies on being drawn disabled; two clicks dispatched by script in
  one task, confirm then Close, close it while the delete runs. **Next action:** decide whether (1)
  re-subscribes as soon as the source is replaced, and whether (2) gets a `busy` check like the
  modal's `wt-close` listener.
- **The colour field's Custom square (`apps/dashboard/src/widgets/color-field.ts`, left by C25).**
  Safari was not tried, so what it draws with no colour chosen, and whether the ring and the
  rim-free fill hold there, is unknown; and whether choosing black in the browser's picker from the
  no-colour state registers was not run. With a palette colour chosen, the Custom square shows that
  colour too, beside the ringed swatch (pinned in `apps/dashboard/src/widgets/color-field.test.ts`,
  "fills the Custom square right up to its border while a palette colour is chosen"). **Next action:** try
  the first in Safari or Playwright's WebKit, and the second by hand in Chromium.

**Image library: Delete left, Edit right, and a preview showing where an image is used — DONE (W78, #1215,
owner 2026-10-04).** On each card (`packages/media/src/dashboard/image-library.ts`) Delete now sits at
the left of the action row and Edit at the right, with "Use image" still on its own line above them
in the picker. The photo is a button marked "Preview" that opens a larger copy beside a list of every
product, variant, menu section and published menu using it, each a link there; on a phone the photo
sits above the list. The preview closes with Close, Escape or a click outside it, and focus goes back
to the thumbnail. `wt-dialog` has no option to close on a backdrop click (it sets `closedby` only to
`closerequest` or `none`) and was left unchanged, so
the library closes the preview itself when a click reaches the dialog element at a point outside the
dialog's box.
Left OPEN by #1215's review: (1) a portrait photo on a laptop-width screen reached the preview's
height limit and was drawn centred with plain bands either side — fixed (W78a, #1280): the
photo's column is now never wider than the photo drawn at that height, and the list of uses takes
the rest of the row. The landscape checks at 1280px and 390px and the 390px portrait check pass
unchanged; where the photo sits above the list on a screen wider than the photo, it now sits at the
start of the row rather than filling it. The dialog width at which the photo and the list move
from side by side to one above the other is unchanged: checked for a landscape, a portrait and a
very tall photo at window heights of 800px and 500px, and a very tall photo still sits above the
list on a 390px phone; (2) a test title in
`apps/till/src/screens/till-allergen-screen.test.ts` says its
dialog closes on "escape/backdrop", but the shared dialog does not close on a click outside it — the
title, not the behaviour, looks wrong (unchecked beyond the reviewer's reading); (3)
`docs/developers/design-system.md` said a dialog returns focus to its trigger on close — settled
for that line: W71g (#1208) replaced it with the dialog's own rule; the preview keeps its own
hand-back.

**The folding section jumps about when it opens (A169, owner 2026-10-01) — DONE (#1026).** `wt-disclosure`
(`packages/ui/src/components/wt-disclosure.ts`) now draws no border in either state, keeps its
heading and chevron in place when it opens (chevron at the row's end), and shows its summary under
the heading only while closed. The Options and Extras editors' "Customer and kitchen
names" line lists the names themselves (`ES … · EN … · Kitchen …`) instead of a count. The rule in
`docs/developers/design-system.md` is rewritten to match. (A171 later took the kitchen name out of
that section and its line.)

**The option window inside an Options list: two owner fixes (A170, owner 2026-10-01) — DONE (#1040).**
In the editor for one options list (`apps/dashboard/src/widgets/option-list-form.ts`), an option's
name in its row is now a button, drawn as the name's text, that opens its "Edit option" window; the
Default radio button and the row menu keep their own clicks, and closing a window the name opened
puts focus back on the name. The window (`apps/dashboard/src/widgets/option-label-form.ts`) has no folding section:
Name, then Kitchen name (A171's decision for this window), then the customer-facing names under a
"Customer-facing names" heading drawn as a small bold capitals group label, then Available, the
same on Add and Edit (owner, 2026-10-01, mockup D2 of
[the mockups](https://claude.ai/artifact/8apJ5oRb77Q5KmEfvUZHeZ)). The menu section form
(`apps/dashboard/src/widgets/section-details-form.ts`) now heads its names the same way and with
the same words (owner, 2026-10-02): "Customer-facing names" / "Nombres para el cliente", no
"(optional)", and each field labelled "Customer-facing name (en)" and so on.

**The kitchen name gets its own place, apart from the customer-facing names, everywhere (A171,
owner 2026-10-01: "i think we should separate kitchen name from customer facing names
(everywhere)") — DONE (#1044).** In the options list and extras list editors
(`apps/dashboard/src/widgets/option-list-form.ts`, `extra-list-form.ts`) the Kitchen name is a
plain field, always shown, directly under Name (owner, 2026-10-01, mockup B). Only the
customer-facing names fold, in a section headed "Customer-facing names" ("Nombres para el
cliente"). Its closed line (`namesLine`, `apps/dashboard/src/widgets/form-fields.ts`; _2026-10-04:
now `effectiveNamesLine`, W77_) lists those names alone, and a refusal naming the kitchen name
shows under the kitchen field without opening the section. The option window
(`option-label-form.ts`, A170), the product editor (`product-editor.ts`) and the variant form
(`variant-form.ts`) already kept the two apart and are unchanged.

**A name field's hint shows what a blank field will actually use (A172, owner 2026-10-01) — DONE (#1053).**
Built in all five editors as the three bullets below ask, each hint following the field it copies
as it is typed (`optionalTextFields`, `apps/dashboard/src/widgets/form-fields.ts`). Products and
variants already fell back requested language → default language → Name (`resolveContentText`,
`packages/shared/src/content-languages.ts`, through `toInvoiceLineDescriptions`), so the text frozen
for their receipt and the translation gap report are unchanged; one variant reader,
`joinCustomerPresentationText` (`packages/catalogue/src/product-presentation.ts`), does not follow
that order (whether any surface shows the difference is not known; the OPEN entry
"`joinCustomerPresentationText` passes the requested language where the default belongs", under
A9). An options list's and an option's names did not (an extras list's own name reaches no
receipt): with default Spanish and an option named
`{ es: "Grande", ca: "Gran" }`, a direct call to `customerOptionSnapshotLabels` for English returned
"Gran", because it skipped the default and took the first stored language alphabetically. It now
tries the default language, read from the frozen staff name's key, before any other (cases in
`packages/catalogue/src/option-snapshot-labels.test.ts`); the receipt and the till's settled ticket
both read through it.
On the owner's answer on #1053 (2026-10-02: _"I don't think we want 'same as', we just want to show
the value. The same everywhere."_), a variant's values taken from its parent drop "Same as" too:
the product editor's category, VAT, unit and course dropdowns and the allergen and dietary lines
show the parent's value itself, and the variant table shows the product's price, all in grey
italic; where the parent names nothing they show what will be used ("Uncategorised", the course's
"— none —", "Each" for the unit, "None", or "Not yet reviewed" for allergens the parent has not had reviewed). The
photo now shows without a "Same as" caption too (A172b — DONE, owner 2026-10-02); its alt text still
names the main product's photo. (Since A200, 2026-10-03, the product editor draws that photo with
empty alt text and its photo button carries those words as a description that is not shown; a
variant's small window still uses them as the photo's alt text.)
The owner: _"the kitchen name hint should be the name field, unless it has its own value. The main
language name hint should be the name field, and the secondary languages should be the main
language name"_. A field's hint is its placeholder (CLAUDE.md §3, Forms), so it shows only while
the field is blank. Wanted, in every editor holding these names — products, variants, options
lists, options and extras lists:

- **Kitchen name:** the hint is the current Name. This matches what is used today: a blank kitchen
  name falls back to Name (`docs/developers/products.md`, "Each name falls back on its own").
- **Customer-facing name, main language:** the hint is the current Name. Also matches today's
  fallback.

- **Customer-facing name, every other language:** the hint is the main language's customer-facing
  name (and Name, if that is blank too). **This does NOT match what happens today**, where a
  blank name in any language falls back straight to Name, never to the main language's name
  (`customerPresentationText`, `packages/catalogue/src/product-presentation.ts`; for options,
  `customerOptionSnapshotLabels`, `packages/catalogue/src/option-snapshot-labels.ts`).
  _(Wrong when written: see the C122 correction below; A172 has since changed the options
  reader.)_ A hint must not show text the customer will never see, so this part needs the fallback
  itself to change to blank → main language's customer-facing name → Name, for every surface that
  reads these names (receipt, till, menus), plus `docs/developers/products.md`. The translation
  gap report (`listContentTranslationGaps`, `packages/catalogue/src/content-languages.ts`) counts
  "Spanish filled, English blank" as a gap today because English would show the staff name;
  whether it is still a gap once English falls back to the Spanish name is a decision to make
  with the owner before building (A172 left the report unchanged; see above). "Main language"
  here means the venue's default content language.
  _(Correction 2026-10-01, C122: measured, the receipt already falls back to the main language's
  customer-facing name, so "a blank name in any language falls back straight to Name" and "English
  would show the staff name" above are wrong for it. Default
  Spanish, a product whose customer-facing name is `{es}` only: a Catalan and an English receipt
  both printed its Spanish name, and an option's receipt text did the same (a direct call to
  `customerOptionSnapshotLabels`); only a thing with no customer-facing name at all printed Name.
  So this hint already matches the receipt while the main language's customer-facing name has
  text. When it has none but another language does, the hint would show Name and the receipt prints a
  blank goods line (the OPEN entry "A customer-facing name with no text in the default language
  prints a blank goods line", under A9). The till's buttons and basket show Name in every case.
  Receipts: the C122 entry under A9.)_

Before A172, the options list, option and extras list editors (`option-list-form.ts`,
`option-label-form.ts`, `extra-list-form.ts`) already hint Name in the kitchen name AND in every
language's customer-facing name; the product editor (`product-editor.ts`) and the variant form
(`variant-form.ts`) hint neither. So the first two bullets are new work only in those two, and the
third changes all five.

Each hint follows the field it copies as the owner types: change Name and the blank fields' hints
change with it.

**An empty table shows a proper empty box, with the screen's Add button (A176, owner 2026-10-01)
— DONE (#1033).** `wt-data-table` draws a table with no rows as a padded box with the
table's own border, corners and background, the sentence centred and, under it, whatever the
screen puts in the new `empty-action` slot; the "nothing matches" case keeps the toolbar and gets
the same box without the slot. Every dashboard table whose screen has an Add action for its own
rows renders that Add button into the slot while its list is empty (Units, the Extras and Options
lists, Menus, Printers and print agents, Staff, Products, adjustment reasons in Venue settings,
and the departments, hours and zone menus in Departments and zones), except the two left open
below; a table with no Add action
keeps just the sentence. The till and setup draw no `wt-data-table`, so
nothing changed there. The empty case still shows the toolbar when the table has one, as before.
Left open: the Payments screen's readers table gets no button, because "Add reader" sits beside
each connected provider (none, one or several), so there is no single Add to put there, and the
list is pre-filtered by status; and the menu prices table on a menu's Price overrides tab gets none either,
because its rows come from "Add products" on the Structure tab, shown for whichever menu or
section is open (since W88, 2026-10-05, Add products is in the ⋮ of the menu's own row and of each
section it owns). Found while building it, and fixed in the same change: on the
Departments and zones screen, adding a department, hours or a zone's menu from the top Add button left
keyboard focus on the page, because the screen tried to focus the button while it was still
greyed out (saving); it now waits until the list has reloaded.

**One fixed "nothing matches" sentence; a specific "nothing yet" sentence per screen (A177, owner
2026-10-01) — DONE (#1037).** Every `wt-data-table` on the dashboard and in the modules' screens now
passes `tableNoMatches()` from `@waitron/dashboard-kit` as its no-matches sentence ("Nothing
matches your search or filters." / "Nada coincide con tu búsqueda ni con tus filtros."), which is
also the table's own English default; the tables' per-screen `*.no_matches` strings and
`orders.empty` are gone. A filter alone, with nothing searched, does show that sentence (a test pins it). The empty
sentences now read "No <things> yet." in both languages, and the Departments and zones screen's five
tables each name their own thing instead of sharing "No entries yet.", except its Tills table,
which leaves out revoked devices and kitchen screens and so says "No active tills." / "No hay cajas
activas." (owner's choice on #1037). Kept as they were, because
they answer a question rather than say nothing was made: the Alerts screen's two, the adjustment
report's, a printer scan's, the Servers screen's and a list's "No products use this list.".
Screens that filter before the table (Orders, the catalogue browser while searching, Users and
Payments while their filters hide what exists, and the Units delete dialog's products) show the
no-matches sentence themselves. Not covered: empty sentences outside a `wt-data-table` (floor,
kitchen, devices and others) still use "Aún no hay" and other shapes. (2026-10-02: since A208 the Products tree searches inside the table, so the catalogue browser no longer chooses its own empty sentence.)

**An empty field's label is the same size as a typed value (A184, owner 2026-10-02) — DONE (#1035).** The
owner, on a screenshot of a form with Password and PIN empty: _"the fieldname inside the field is
font size 16px when a filled value is 14px"_. The `--wt-field-label-rest-size` token (16px) is gone:
a resting label now inherits the field box's font size, which is what the value inherits too
(`packages/ui-core/src/field-styles.ts`), and `wt-number-stepper`'s hidden copy of the label, which
widens its box, does the same. A test in each field primitive (`wt-input` as text and password,
`wt-textarea`, `wt-combobox`, `wt-price-input`, `wt-number-stepper`) compares the resting label's
size with the value's, then changes `--wt-font-size-md` and checks both follow. The phone-zoom
question below is about a field's TEXT, not its label, so this does not touch it. (Since A263,
2026-10-03, below, `wt-number-stepper`'s label no longer rests: it always floats on the top line,
and its test checks that the label and its hidden copy follow `--wt-font-size-sm` instead.)

**The setup wizard's review page is grouped, explained and readable (A185, owner 2026-10-02) —
DONE.** The owner, on a screenshot of "Review and provision": _"This layout looks really messy"_.
The former `apps/setup/src/screens/review-screen.ts` was one flat list of sixteen label/value rows,
showed the receipt language as a code (`ca-ES`), said demo twice (a Mode row and a paragraph), and
kept the old `.actions` button row, so Provision sat beside Back rather than at the trailing edge
as Next does on the earlier steps (`wt-form-actions`). **Decided (owner, 2026-10-02, choosing layout A
of three mockups):**

- the rows sit in boxed groups named as the steps that collect them — Business (legal name, tax
  ID, country), Location (name, address, receipt language, when the day ends), Invoicing (till,
  series, corrections series, invoice description, and the AEAT certificate outside demo), Your
  account (name, email; the display name only when it differs from the name) — each box with an
  Edit link back to the step that collects it;
- the mode is a badge at the top (Demo, Prepare or Live) with demo's one-line explanation beside
  it, replacing the Mode row and the demo paragraph (2026-10-03, A244: the badge is now the mode
  pill the provisioning and done screens share, and reads Preparation);
- a language shows by its name ("Català"), never its code; "Rectificative series" reads
  "Corrections series" (Spanish wording to match);
- help (replaced 2026-10-03 by A243: the review screen has no "?" buttons, and each box's
  explanation is a muted line under its heading): each box has a `wt-help-tooltip` saying in general
  what the group is, and each row that needs explaining has its own saying what that value does
  (e.g. the series: "Every invoice number starts with this: FS-000001, FS-000002…"). The owner: the
  tooltips float over the text and close when focus moves, and use the existing primitive, not a
  dark box. `wt-help-tooltip` is a popover, so it floats and closes on an outside click or Escape;
  the primitive now also closes it when focus moves away;
- Back and Provision move into `wt-form-actions`.

**The setup wizard's provisioning page is a page of its own with a spinner (A186, owner
2026-10-02) — DONE.** While the request is pending, the page centres a spinner beneath "Setting up
<legal name>" and a Demo, Preparation or Live badge, with "Keep this page open" and no button. The
failed state keeps its retry, reset and reload actions. `provision` in
`apps/setup/src/api/client.ts` reports no intermediate steps.

**The language chooser moves to the top bar, in every app (A187, owner 2026-10-02) — DONE (#1062).**
`wt-language-chooser` sits at the trailing end of each app's top bar: the setup wizard's card
header beside the logo, the dashboard's banner before the alerts bell and account menu (signed out
too), and the till's bar before the operator's name. The till's sign-in and join screens and the
kitchen display, which have no bar, hold it at the top right on their own. At 40rem wide or less it
shows the short code ("EN") and keeps the full name for screen readers; its menu opens downwards
and names every language in full. `wt-language-footer` is gone.

**In a demo, the dashboard's top bar links to the email inbox (A188, owner 2026-10-02) — DONE (#1067).**
In a demo, the dashboard's banner shows an "Email inbox" link ("Bandeja de correo" in Spanish) just
before the language chooser, to `/manage/email`, the address the setup wizard's done page uses:
signed out always, and signed in only to a session that may open the Test inbox screen (a manager
or an admin). Outside a demo there is no link. At 48rem wide or less it moves to the banner's second
row, after the mode pill, because on the first row it squeezed the Waitron lockup to nothing at
360px wide.
(2026-10-03: A227, below, shows the link in a venue preparing to go live too, and removes the
sidebar's Test inbox entry.)

**The sidebar no longer lists the email inbox; the top-bar link is the way in (A227, owner
2026-10-03) — DONE (#1094).** The sidebar's "Test inbox" entry is gone, and with it the `nav.email`
string. The top bar's "Email inbox" link now shows in a demo AND in a venue preparing to go live:
the server's practice mode covers both (`apps/server/src/boot.ts`), and in practice mode with no
SMTP set up, account email is captured on the box (`apps/server/src/email-delivery.ts`). The
screen keeps its rule — a manager or an admin — in the dashboard's list of screens with no sidebar
entry, so its address still opens for them and no one else. A live venue shows no link, and there
the screen only says how email is sent; a development server (`WAITRON_ENV=dev`) captures email in
every mode, so in a live dev venue the address is the only way in.

**A venue preparing to go live sends real email through SMTP (owner 2026-10-03) — OPEN.** "Later
prepare should use a real SMTP server": a prepare venue would send invitations and password resets
through SMTP instead of capturing them on the box, and the top bar's inbox link (A227) would become
demo-only again. Not built.
(2026-10-03: the owner keeps this item open. A231d's design, below, sends a prepare venue's invoice
email through its mail server when one is set, and adds no way to set one there.)

**The sign-in screen's chosen email is drawn as a read-only field (A189, owner 2026-10-02) — DONE
(#1048).** On every sign-in step after the email, on the passkey offer after sign-in, and on the
reset and account-setup page, the chosen email is a read-only `wt-input` labelled "Email" with the
address as its value: the same filled box as the other fields, so its text lines up with the
password field's and the new password's. "Use another account" sits in its `end` slot at the box's trailing end, except on
the passkey offer and the reset and account-setup page, which have no such button. `wt-input`
gained `readonly`, which keeps the editable field's look (design-system.md → Forms → "The field
box"). Where a step keeps the hidden username input for password managers, it is still the only
field named `email`; the read-only field is `chosen-email`.

**A field the browser fills in keeps the field's own look (A190, owner 2026-10-02) — DONE.** On the
sign-in screen and the setup wizard, a field the browser autofilled is drawn pale blue with no
bottom line, unlike every other field. **Decided (owner, 2026-10-02):** an autofilled field looks
like a typed one — the field fill and the bottom line — in every field primitive and both themes.
The label already floats for an autofilled field (`:has(:autofill)` in
`packages/ui-core/src/field-styles.ts` and `wt-price-input`); the colour and line were not looked
into. A Chromium browser test forces the autofill pseudo-class, checks the visible fill, bottom line
and value colour in both themes, and reproduces the browser's light-theme pale blue and dark-theme
translucent slate fill before the CSS fix. An isolated Chromium
profile accepted a saved test password through `navigator.credentials.store`, but did not autofill
it after a reload or restart under automation; that saved-password visual check remains unverified.

**The dashboard's sign-in pages: a card, one blue button, every other way in under "or" (A191,
owner 2026-10-02) — DONE (#1074).** (Google page and its "G" changed by A228, 2026-10-03, below;
the card's logo removed by W103, 2026-10-04, below.) The owner, on the passkey page: _"this page also looks a bit messy"_;
layout A of three mockups was approved ("i love it"), replacing C96's single bulleted list. Every
step of `apps/dashboard/src/screens/login-screen.ts` now sits in a card drawn like the setup
wizard's, with the Waitron logo first (decorative there: the banner above already names Waitron, so
the page shows the logo twice). On the email, password, passkey and Google pages the page's own way
in is one full-width blue button, with the form's message on its own line directly above it; every
other way in follows under an "or" line as a full-width outlined button with an icon — a key for
"Use your password", a person with a key for "Log in with passkey", and Google's four-colour "G" (replaced by A228) for
"Continue with Google". "I've forgotten my password" is a small link at the right under the password
field, on the password page only. On the code step the code switch is the same kind of link under
its field, the heading comes before the email, and Back and Log in are the ordinary action row. The
chosen email is still A189's read-only field. No page has more than two other ways in, so the
"row of logo-only buttons" fallback was not needed. **"Continue with Google" is also on the first
page**, when the venue has Google set up: that holds because starting a Google sign-in takes no
email (`POST /management-api/google/login` reads no body, `apps/server/src/management-api.ts:525`),
and whether it shows depends only on the venue's settings, so the first page still shows everyone
the same choices. The Google "G" (`apps/dashboard/src/assets/google-g.svg`) is the commonly
reproduced four-colour mark; neither the drawing nor Google's branding terms were checked against
Google's own sources (2026-10-03: checked and replaced by A228, below). Sign in with Apple does not exist; the mockup only showed where it would go. **Left open by #1074 (owner to decide):** the new key and passkey icons draw lines at width 2 while the change-account icon beside them uses 1; the card copies the setup wizard's card styles rather than sharing `wt-card`, and nothing keeps the two in step; the Google "G" is not listed in `deploy/third-party/README.md` (done by A228, below). Two races it reasoned about but did not reproduce were reproduced and fixed by A229 (below).

**Pressing Google stops a passkey autofill that is still starting, and an autofill failure before a
passkey is picked keeps Google's message (A229, owner 2026-10-03) — DONE (#1080).** The two sign-in
timing cases A191 left unreproduced were both real, and both are fixed in
`apps/dashboard/src/screens/login-screen.ts`. What was run, in
`apps/dashboard/src/screens/login-screen.test.ts` (describe "Google on the first page"), with the
browser's `PublicKeyCredential.isConditionalMediationAvailable` and `navigator.credentials.get`
stubbed and the WebAuthn library kept real:

1. The browser's "can autofill offer passkeys?" answer is held back, Continue with Google is
   pressed and its start is held back too, then the answer is released. Before the fix the email
   page's autofill went on to ask the server for passkey options and armed the browser's autofill
   prompt (`navigator.credentials.get` called once, with `mediation: "conditional"`) while Google
   was still starting; with the stubbed browser handing back a passkey at once, the screen
   announced a passkey sign-in before Google's start had answered. Google's cancel only stopped a
   ceremony that had already begun. Now an autofill still starting when the ceremony is cancelled
   does not start. If Google then fails, the autofill is offered again: a further case holds back
   the browser's answer, presses Google and has it refused, then releases the answer, and the
   autofill asks the server for passkey options once and arms the browser's autofill prompt once
   (`mediation: "conditional"`), from the restart (the held-back original stops at the new check).
2. Google's start is refused (`google.invalid`) and the autofill it restarts is then refused too
   (`connection.failed`). Before the fix the page showed the autofill's message in place of
   Google's. Now a failure of the autofill before the person picks a passkey (its passkey-options
   request failing) leaves a message already shown in place, and shows its own when none is
   shown. Once the person picks a passkey from the autofill list, that is their own action: the
   old message is cleared and the result of their choice shows, so a refused picked passkey shows
   its refusal (`passkey.verification_failed`, or `passkey.not_registered`) in place of Google's
   message, the same as every other sign-in action.

What deleting each fix did: deleting the check of whether anything cancelled the autofill meanwhile
failed case 1, and failed the held-back-then-refused case, where the held-back original autofill
also sent its own options request, so options were asked for twice (it never reached the browser's
prompt); turning the keep-the-message rule back into a plain assignment failed case 2, which showed
the connection message instead of Google's; and deleting the line that clears the old message when
a passkey is picked failed the picked-passkey refusal case, which showed Google's message instead
of the passkey refusal.

**The "Continue with Google" button follows Google's branding rules (A228, 2026-10-03) — DONE
(#1078).** Google's sign-in branding guidelines
(<https://developers.google.com/identity/branding-guidelines>) require a custom Google button to
carry the standard gradient "G" (the download bundle's), and give its light and dark fill, line and
text colours and its font, Google Sans Medium. The flat four-colour "G" was the kind the guidelines call
outdated, and the Google page's own button was blue with no "G". Now the button, on every page it
appears, carries the bundle's gradient "G" at 20px, reads `--wt-color-google-button-fill`, `-line`
and `-text` and `--wt-font-family-google`, and the dashboard bundles Google Sans Medium (latin,
weight 500), registered on `document.fonts`. The Google page's own button is that same button, so
that page has no blue button. `deploy/third-party/README.md` carries the font's SIL Open Font
License notice (`google-sans/OFL.txt`) and Google's trademark line for the "G". It changed two
existing assertions in `apps/dashboard/src/screens/login-screen.test.ts`, both approved by the owner on 2026-10-03: the
Google page now has 0 primary buttons, not 1, and the Google icon among the other ways in is
`--wt-google-mark-size` wide, not `--wt-font-size-lg`. Kept from the house rather than Google's
drawing: the 44px tap height (Google's drawing is 40px; its text allows scaling), the full card
width and `wt-button`'s corner radius. Checked in Chromium only (the vitest browser suites and
screenshots); Firefox and Safari not looked at.

**The login card drops its logo, and a session-expired notice is drawn as an error (W103, owner
2026-10-04) — DONE (#1190).** The owner, on a login screenshot: _"Remove the waitron logo from the login
box, and make the 'your session has expired' more prominent eg in red."_ No step of
`apps/dashboard/src/screens/login-screen.ts`, nor the account set-up and password-reset page, draws
the Waitron logo any more; the banner above the card still shows it beside the business name. The
"session expired" and "account suspended" notices are now bold `--wt-color-danger` text in a box
with a 1px `--wt-color-danger` border, `--wt-radius-md` corners and `--wt-space-2`/`--wt-space-3`
padding, first in the card above the heading. They are named in an explicit list, so another notice
stays plain unless it is added: the notice after a completed password reset ("Your password has
been changed…") keeps the text colour and no border.
With the owner's approval it removed the logo assertions of the card test and the logo colour test
in `apps/dashboard/src/screens/login-screen.test.ts`. Checked in Chromium only. Left open for
the owner: the error-styled notice keeps `role="status"` (read out politely, as the item asked),
where the dashboard's other error text uses `role="alert"` (read out at once); switching it is a
one-line change if wanted.

**A focused table search box turns its own border blue, with no second ring (A192, owner
2026-10-02) — DONE (A192).** The owner, on two screenshots of the Modifiers screen's "Search extras
lists": _"Focusing on the search box adds a second thicker blue border. instead it should turn the
existing border blue."_ The box is `wt-data-table`'s `.table-search`
(`packages/ui/src/components/wt-data-table.ts`). At rest it has a grey 1px border. On focus the existing
border turns the primary blue and nothing is drawn outside it, as `wt-combobox`'s search box already
does (its `.search:focus-visible` rule: "Its own primary border is the focus marking"). Every table
with a search box gets it, since they all share this one. The border and outline are checked in
Chromium; its visible focus state was inspected in light and dark at phone width. The axe check runs
in both themes but does not assess the focus indicator's visibility.

**A table filter's "Any …" choice is drawn as a chosen value, not a hint (A193, owner
2026-10-02) — DONE.** The owner, on a screenshot of the Modifiers screen's status filter: _"The Any
Status shouldn't be a hint, it is a value that appears in the dropdown"_. `wt-data-table` gives
each column filter's `wt-combobox` a first option `{ value: "", label: allLabel }` and also passes
`allLabel` as its `placeholder`. The table now asks the combobox to display its offered empty-string
option as a selected value. "Any status" and the other table-filter "Any …" choices use the ordinary
value style. The Orders screen's staff filter uses it too, so its "Anyone" choice appears as a value.
The standalone product editor uses the same combobox setting for "Uncategorised" and "No course";
a variant's inherited values still read as hints. Picking a table filter's "Any …" choice removes
that filter from the saved view and from the `wt-filter-change` detail map. Other non-table dropdowns
offering an empty "Any …" or "No …" row were outside A193; their appearance needs a separate review.

**A table filter's dropdown keeps one width whatever is chosen (A194, owner 2026-10-02) — DONE.**
Each table filter reserves room for its longest offered label, so choosing "Active" after "Any
status" does not move the next toolbar control. The shared combobox applies this sizing only when
the table requests it. The Chromium table test measures the width before and after choosing both a
shorter and a longer value; the table and combobox suites passed. The rendered table was inspected
at 390px and 1280px in light and dark themes. The owner has not confirmed whether one common width
was intended for every filter; this uses one stable width per filter. A filter whose longest choice
exceeds the available phone width fills its row, and that choice is cut short in the closed control.

**A dropdown with no search box keeps its blue focus line while its list is open (A256, owner
2026-10-03) — DONE (#1137).** The owner, on a screenshot of the "Service style" dropdown open:
_"when a combobox doesn't show a search bar, then leave the blue underline of the field active"_.
`wt-combobox` now marks its field `data-search` when the list has a search box. While a list
without one is open, the combobox's own styles keep the field's blue line and blue label; a list
with a search box still drops them, since the search box's border marks focus. An invalid field
keeps its red line and a disabled one draws neither. The light theme was inspected by the
implementer; the dark theme and phone width only by the Codex review seat's screenshots.

**Move the dropdown's open-list field styling out of the shared field styles (A257, owner
2026-10-03) — DONE.** The shared focus rule is plain `:focus-within`; `wt-combobox` owns both
open-list focus treatments. The combobox's searchable, searchless, invalid and disabled open-list
checks remain unchanged.

**A table's pinned Actions column keeps one narrow width (A195, owner 2026-10-02) — DONE.**
`wt-data-table` gives its `actions` column only the space its heading or cell content needs; other
columns take the spare width. The one-row Chromium test measures the column with both “Actions” and
“Acciones”, and the table and accessibility suites passed. Rendered one-row tables were inspected
at 1280px and 390px, in English and Spanish labels and both themes. A198's options list form uses
its own table (`apps/dashboard/src/widgets/option-list-form.ts:580`), so it cannot reuse the shared
component's column rule.

**Every pinned last column keeps a content width (A235, owner 2026-10-03) — DONE.**
The Content languages screen's `open` column uses `pinned: "end"`
(`apps/dashboard/src/screens/content-languages-screen.ts:457`). The shared table now sizes it by its
heading or link, as it does for `actions`. The Chromium table test measures an English Open link
at 1000px and a Spanish Abrir link at 390px. The shared table and the Content languages screen
were visually inspected at desktop and phone widths in both themes; the screen showed a translation gap.

**A collapsible section's chevron sits just after its heading (A196, owner 2026-10-02) — DONE.**
The owner, on the "Edit options list" form: _"the chevron (currently far right) should be just to
the right of the header, at the moment you don't see it"_. The shared `wt-disclosure` now puts it
directly after the heading text, including in the extras list form, product editor and content
languages screen. The focused Chromium test covers the position at desktop and phone widths.

**Chevron sizing across the interface (W60) — DONE.** The shared dropdown icon has a wider drawing;
disclosures, dropdown fields, dashboard groups, table trees and menu trees give their chevrons more
room without enlarging other icons or changing touch targets.

**Clicking an option's row on the options list form opens that option (A197, owner 2026-10-02) —
DONE.** The owner: _"clicking on the options rows should open the edit page, like the previous
screen"_ — the Modifiers screen's table, where a click anywhere on a row opens it (`wt-data-table`'s
row activation). The options list form (`apps/dashboard/src/widgets/option-list-form.ts`) draws its
own `<table>`. Since A170 a click on an option's name, which is a button, opens it as its row menu's
Edit does. A click elsewhere on the row, or Enter on the row, opens the option's edit form too,
while the drag handle, the Default radio and the row menu keep doing their own thing. The extras
list form (`extra-list-form.ts`) draws the same kind of table, but its rows have no editor.

**Clicking an Extras or Options list's row opens its editor, in the product editor and on the
Modifiers page (W71, owner 2026-10-04) — DONE (#1192; W71f #1198; W71g #1208; W71h #1211).** In the product editor's Modifiers table
(`apps/dashboard/src/widgets/product-editor.ts`) a click on a list's name or the empty part of its
row, or Enter or Space on it, does what Edit in the row's menu does (`wt-edit-related`), through a
row-sized button named "Edit: <list> · <kind>", built as the variants table's is; the drag handle,
the row menu and Remove keep their own clicks, and a typed name and price, and the attached lists,
stay through an Options list editor's Cancel and save (`catalogue-screen.test.ts`), after which focus goes back to the row's
button, or to its menu when the menu's Edit opened the list. On the Modifiers page an Extras row
now opens like an Options row, with Used by opening only its popup. Left as it was: the focus ring
of a row's button shows only along the row's top edge, in both tables, as on the shared table.
Its review's open question, the product editor's unit form and Courses window, was settled by W71f:
`catalogue-screen.test.ts` now checks that focus goes back to Add unit after the unit form's Cancel
and Escape, to the price's unit button after its save, and to the course box after the Courses
window's Done and Escape, each with focus first put somewhere else so only the screen's hand-back
can reach the target; the unit form's Cancel and Escape cases also check that the chooser is still
open and Add unit is still there, so lost focus cannot pass as a match between two empty results.
The unit form's Cancel and Escape cases failed — Add unit was still drawn disabled when the
hand-back ran, and after Escape focus was lost even when Add unit was opened with a real click — so
`#returnChildFocus` now waits for the unit form as it does for the list forms. The Courses window
passed unchanged; with its hand-back removed only the new cases failed, as opening it from the
course box puts focus on the box first. From W71f's review: (1)
`docs/developers/design-system.md` (the `wt-modal` paragraph) said the native dialog "returns focus
to its trigger on close", while the W71f test comments and `product-editor.ts` rely on it going back
to whatever had focus when the dialog opened; the line dated from #319 (2026-09-11, `git blame`).
Settled by W71g (owner 2026-10-05: keep the browser's rule, add an optional opener and a fallback;
#1208): browser tests in `packages/ui/src/components/wt-dialog.test.ts` show that in Chromium focus
goes back to whatever had it when the dialog opened. When the browser would leave focus on the page
body or inside the closed dialog, `wt-dialog` (and `wt-modal`) now moves it to its new `opener`
property if set and able to take focus, otherwise to the first element with tabindex 0 or above that
is not disabled inside the closest enclosing element that holds one, or that enclosing element
itself, then further out; when none takes focus, focus stays where the browser left it. It does so
before sending `wt-close`, so a screen that hands focus back itself still has the last word.
design-system.md says this. The Printers screen sets `opener` on its Add agent dialog to the tab's
Add button and drops its own `#refocusAdd`; its edit-printer dialog (the calibration wizard since
#1227) gets that button as `opener` only where it is on the page, when the wizard follows an add
from the list, and opened from a printer's details page has none, so the fallback search applies. No
other screen changed; screens that hand focus back themselves are listed in #1208. Settled by W71h,
from the same review: (2) W71f's unit-form wait in `#returnChildFocus` worked only because the
product editor happened to finish redrawing Add unit as enabled in the meantime (seen in Codex's
timing log). The editor's `returnRelatedFocus` focuses the Add control, or an attached list's row
button or menu, at once; when it is still drawn disabled, it waits for the editor's next update and
focuses it then, unless focus has moved meanwhile (`focusOnceEnabled`,
`apps/dashboard/src/widgets/product-editor.ts`). In `catalogue-screen.test.ts`, with the editor's
update held back, the unit form's Cancel and Escape and an options list's Cancel and Escape opened
from an attached row; in `product-editor.test.ts`, with the hand-back called before the editor's
pending update has run, the Modifiers control, an attached row's button, and focus moved to another
field during the wait — each failed with its part of the fix removed. The course box is still
focused once with no wait, because the editor never draws it disabled.

**A click on a switch's knob, track, gap or label flips it once (W76, owner 2026-10-04) — DONE (#1218).** The
owner, on the Extras editor: _"make the toggle field work when you click anywhere on it, not just on
one side or the other"_. In the shared `packages/ui/src/components/wt-switch.ts` a click on the round
knob, in the gap between the switch and its label, or just above the label did nothing before:
the knob is drawn over the hidden checkbox, and the gap belonged to no part. The switch and its label
now sit in one inner area that hands such a click to the checkbox, so it flips once, sends one
`wt-change`, and a listener above the switch in the bubbling phase sees one click. A switch stretched
wider than its label by its container (the Extras editor's Active is 576 px wide at desktop, its
label ends about 100 px in) does not flip from the empty space past the label. Space, the focus ring
and the accessible name are unchanged. A disabled switch still does not flip, and a click on it
still reaches the page; it now shows the not-allowed cursor over its knob, gap and label, where its
label showed a pointer before. Tests: real Chromium clicks in
`packages/ui/src/components/wt-switch.test.ts`; the Extras editor's Active and Preselected were
clicked the same way at 1280 and 390 px wide in both themes by a probe that was not kept.

**The Extras editor shows Portion beside Price, and a fixed 1 for a product sold by the unit
(W75, owner 2026-10-04) — DONE (#1194).** In `apps/dashboard/src/widgets/extra-list-form.ts` Portion is a
column of its own between Preselected and Price, there even when every item is sold by the unit,
and its heading carries the required star while any row asks for a portion. A product sold by the
unit is told apart by its unit's id, `EACH_UNIT_ID` (moved to the browser-safe
`packages/catalogue/src/unit-validation.ts`), not by its decimals: its cell shows a plain 1, the form
sends no portion for it, so the server stores one, and its inherited price is the unit price
whatever portion an earlier unit left saved. Every other unit — kg, g, ml, a venue's own — shows an
editable, required Portion as soon as the product is added, before any save, which ended the owner's
"Portion appears only after reopening". A row switches between the two when its product's unit
changes. The drag handle now sits on the first line of the product's name rather than the middle of
a tall row. Open: the Price heading reads "Price per portion" also over a row sold by the unit.
Left OPEN from its review, for the owner to decide: (1) the Products list decided "Each" by whether
the product's unit is in the venue's saved unit list, the Extras editor by the unit's id, so the two
could disagree (for example before the unit list had loaded) — DONE by W75a (#1205): the Products list now
uses `EACH_UNIT_ID` too, so a measured product shows its "/ kg" label even before the unit list
loads. Still open from it: the list's `units` property is no longer read, though the Catalogue
screen still passes it down through `apps/dashboard/src/widgets/catalogue-browser.ts` and existing
tests set and assert it, so removing it changes existing tests. And neither screen counts a stored
unit seeded as `each` as Each, which `isEachUnit` (`packages/catalogue/src/units.ts`) does; no code
outside tests seeds one. (2) the handle-on-the-first-line alignment applied to the Extras list only — DONE by W75b, below; (3) the editor refuses a blank Portion for every unit
but Each while the server accepts none for a whole unit with no scale link (ml) and stores 1 — DONE
by W75c, below.

**Every reorderable table puts its drag handle on the first line of a tall row (W75b, owner
2026-10-04) — DONE (#1201).** The shared reorder table styles (`packages/ui/src/reorder-table.ts`) now line
body cells up by the baseline, so the handle sits on the first line of the plain text beside it,
such as a long, wrapping name, instead of the row's middle; the Extras editor's own rule for this went. The
Product editor's Modifiers table, the variant table, the Courses list and the option list form start
their cells at the top and push the text down to the middle of a tap-target-tall first line, so on a
one-line row the text and the controls still share one centre line (tested for the Product editor
and the option list form only). The option list form moved off the baseline because its existing
one-line test failed on CI's Linux Chromium, measuring the radio 1.5 px from the name where the test
allows 1 px. The Product editor, variant table, Courses list, option list form, section member list,
Extras editor and Prep stations screen each have a test with a wrapping name. The option list form
and the section member list had their own centring rules: the section member list's is removed, and
the option list form's is replaced by the top alignment. See `docs/developers/design-system.md`,
tables.

**The server refuses a new Extras item with no Portion for every unit but Each (W75c, owner
2026-10-04) — DONE (#1204).** `assertPortionPrecision` (`packages/catalogue/src/extras.ts`) used to refuse a
missing portion only for an item sent with no id whose unit had decimals or a scale link. So an item
sent with an id, whatever its unit, and an item sent with no id for ml or a venue's own whole unit,
were saved with no portion and stored as 1. It now refuses a new item with no portion as
`extras.invalid` naming `items.<n>.portion`, unless the product is Each: it has no stored unit, or
its stored unit was seeded as `each`. An item is new when it is sent with no id, with an id the list
does not hold (the dashboard's Extras editor gives every row it adds an id of its own), or with an id
the list holds for a different product. An Each item still takes none and stores 1. An id that
belongs to another list is refused on `items.<n>.id` before the portion check runs, so it keeps that
refusal. Tests in `packages/catalogue/src/extras.test.ts` cover the seeded ml unit, a venue's own
whole unit, both kinds of Each, items sent with an id the list does not hold, on create and on
update, and an id the list holds sent with a different product. An item sent with an id the list
holds for the same product and no portion is still accepted; a test holds that it is accepted, not
what portion it then has. An item sent with a portion is checked as before. Two catalogue test files
whose lists offered products on a venue's own whole unit now send a portion of 1.
Left OPEN, found while building it and not in its scope: an item the list already holds that is sent
again under its id, for the same product and WITHOUT a portion, loses its saved one. Tried with a
throwaway test: a kg item saved at `0.050`, then `updateExtraList` with `{ id, productId }` and no
portion, read back `1.000`, because `assertPortionPrecision` does not refuse such an item and
`writeItems` re-inserts every item with `item.portion ?? "1"`; tried again on 2026-10-05 after the
different-product change, with an ml item saved at `30`, read back `1.000`. The dashboard's Extras
editor was not checked for whether it always resends the saved portion. Next step, if the owner
wants it: refuse such an item when its product is not Each, or keep the portion saved under that id,
which is for the same product. _2026-10-05: the owner chose to keep it; done by W75d, below._

**A held Extras item sent without a portion keeps its saved portion (W75d, owner 2026-10-05) — DONE
(#1221).** The owner chose "Keep saved portion" for W75c's open point. `itemPortions`
(`packages/catalogue/src/extras.ts`, which replaces `assertPortionPrecision`) now decides the portion
each item stores: an item sent without one stores one when its product is Each, keeps the portion
saved under its id when the list holds that id for the same product, and is refused as before when
it is new. Each is checked first, so an item saved at `0.050` whose product has since become Each
stores one, as the Extras editor intends when it sends no portion for an Each product. A portion sent
explicitly still replaces the saved one, and an explicit `null` is still refused on
`items.<n>.portion` (by `parseExtraListInput`), leaving the saved portion in place. Tests in
`packages/catalogue/src/extras.test.ts`: a held kg item at `0.050` and a held ml item at `30`, the
second also moved to another position, keep theirs; an explicit portion replaces; an explicit null
is refused; a held Each item stays at one; and the item whose product became Each. The dashboard's
Extras editor already sent the saved portion back: a throwaway case in its browser suite resaved a
list with only its name changed and it sent `30.000` for a saved ml item and `0.050` for a saved kg
item, and no portion for an Each item. So the lost portion was reachable through the API, not
through the editor.
Left OPEN, not in its scope: a held item whose product has since become Each, sent back WITH its old
portion, is still accepted and keeps it, because a portion equal to the saved one is let through
before the Each check in `itemPortions` — as it was before #1221. Tried 2026-10-05 on main 884600660
with a throwaway test: a kg item saved at `0.050`, its product's unit cleared, then
`updateExtraList` with `{ id, productId, portion: "0.050" }` was not refused and read back `0.050`.
The Extras editor sends no portion for an Each product, so this is reachable through the API only.
_2026-10-05: SETTLED by W75e (#1226; owner chose to refuse it)._ `itemPortions` now judges an Each product
before the equal-to-saved shortcut, deciding Each with `isEachUnit` (`packages/catalogue/src/units.ts`):
such an item sent with any portion but one is refused on `items.<n>.portion` with `extras.invalid`
and nothing is saved, while the same item sent without a portion, or with `1.000`, stores one. Tests
in `packages/catalogue/src/extras.test.ts`.

**A folded Customer-facing names section shows every language's name, inherited ones in italic
(W77, owner 2026-10-04) — DONE (#1197).** The owner, on an Extras list: _"missing the summary of the values
(even though they're inherited, not filled in currently)"_. The closed line of the Extras and
Options list forms' names sections now names every content language in order: its own name, or
else, in italic, what the open field hints while empty — the default language's name, then the
list's staff name (`effectiveNamesLine`, `apps/dashboard/src/widgets/form-fields.ts`). A language
with nothing to fall back to (a new list with no name yet) is left out. Display only: blank fields
stay blank and what is saved is unchanged.
Audited: the only other folded section holding customer-facing names is the Product editor's
Descriptors section, whose Name row says "None specified" for a blank language by A211's decision;
left as it is (asked of the owner, 2026-10-04).
A name stored under a regional code such as `en-GB`, which the server's API accepts, is read by
the forms as the customer-facing resolver reads a request for that language's plain code (W77a,
#1206, owner 2026-10-04 choosing the form reading it): the plain code first, then its regional ones
(`languageText`, `apps/dashboard/src/widgets/form-fields.ts`). A till or receipt asking for `en-GB`
reads `en-GB` before `en`, so a map holding both can show one name in the form and serve the
other. Tested on the Extras and Options lists and the Product editor's Descriptors (fields,
summary, description boxes); an option's label, a variant and a menu section reach the same helper
through `optionalTextFields` but have no case of their own. Saving keeps an untouched language's
non-blank regional keys; an edited language is saved under its plain code alone and its regional
keys are dropped (`withLanguageText`), so after a non-empty edit every regional request for that
language reads the text typed into the field. The Product editor's choice of which field a
"translation required" refusal points at (`productEditorTranslationField`) reads regional keys
too, as the server's check does. Still reading the plain code only: the unit form's names, the
adjustment reasons' names (`packages/adjustments/src/dashboard/reasons-screen.ts`) and the image
library's names (`packages/media/src/dashboard/image-library.ts`). Left from #1206's review, optional
tidying: the Product editor keeps a private `text()` helper doing what `languageText` does, and
`product-list.ts` and `extra-list-form.ts` make the same `resolveContentText` call inline for unit
names; folding them into the one helper was not part of W77a.

**Clicking a product's row on the Products screen opens it (A205) — DONE in A208.**

**The dashboard recovers by itself when the server comes back after a restart (A206, owner
2026-10-02) — DONE (#1052).** Reproduced with the server serving the built dashboard itself, as the box does
(the dev stack's page server answers `502` instead, so it never shows `connection.failed`): of 34
screens open across a restart, 20 kept "This browser could not connect…" or "could not be loaded"
after their data had come back. The live connection already re-reads every watched query when its
stream returns; what was missing was telling the screen. `QueryController`
(`packages/dashboard-kit/src/query-controller.ts`) now takes an optional fourth argument, called
once every failed read it still watches has applied a value with no new failure reported meanwhile.
Each screen that keeps a read error clears it there, or already did in its apply callback: a stored
message only if it is still the one the failed read set, a yes/no flag always (Menus' flag is also
set by the read in `#openMenuForm`, which a recovery clears too). Profile, Recipe, the two order
dialogs and the catalogue's placement step, not among the 20, take the same callback. Screens whose
first load stopped before starting its later reads (Products, Printers, Modifiers, Content
languages, Approvals, Sales' business day) start them on recovery (Sales' business day: since lane
A's W18, 2026-10-03, it also stays watched until it answers). Measured on the merged head
(`41f138d45`) with a 20 s outage: all 34 screens recover, and 32 of 34 opened during the outage;
measured only before the review's fixes: a 90 s outage recovers and an unsaved form edit is kept.
Not covered — below, A224.

**Dashboard reads have no time limit, and a save's lost-connection message can vanish when reads
recover (A224, from A206's review, 2026-10-02) — DONE (lane A's W18, #1125; W18a, #1135; W18b, #1142).** Done: Payments'
providers and readers, Cloud services' status and Profile's language list now load through the
shared queries, so a screen opened while the server is down fills in once it is back. Payments asks
for each reader's status again only when the set of active readers changes, after a change the
operator made, or from its refresh button, because a status can ask the card provider. On Payments
and Cloud services, a failed action's message stays when the reads recover, and Cloud services
ignores a status read that started before a successful action's answer was shown and answered after
it. Sales keeps watching the business-day read until it has answered, so it loads when only that
read failed. Roster and Planned vs actual show the error, not their "no locations" prompt, when the
locations read fails before it has ever answered. Since lane A's W18a, every dashboard `GET` made
through `createRequest`, except a file download, gives up after 30 seconds (the owner's value,
2026-10-03): `createRequest` (`packages/dashboard-kit/src/request.ts`) aborts it and it fails as
`connection.failed`, so a read the server never finishes stops loading (since lane A's W18c,
2026-10-03, such a read fails as `connection.timed_out`, "Waitron is taking too long to answer…",
and a fetch that fails on its own still as `connection.failed`; and a reader's status and a
provider's available readers wait up to 250 seconds, SumUp's pairing status read up to 50 seconds;
see A255). A read the live data store keeps (`packages/dashboard-kit/src/live-data.ts`) is then
read again like any other failed one: at once if something asked for it while it waited (the live
connection, the query's timed refresh, or a save on the same screen), otherwise the next time one
of those asks. A one-off read, such as opening the product editor, shows the error and is read
again only when the person tries again.
Writes have no limit. Since lane A's W18b, a save's or other action's failure is no longer lost
when the reads recover on the screens that show a read's and an action's failure in one place: each
remembers whether its message came from a read (the owner's choice, 2026-10-03); the reads' recovery
clears only a read's message, and a read failing again during the outage no longer replaces an
action's, except on Devices, where the queue reload after a wrong-number refusal still replaces that
refusal; the replacing message is marked as a read's, so the reads' recovery clears it if a watched
read also failed meanwhile, and otherwise it stays until the next action or until the screen is
reopened (2026-10-05, W104: Devices no longer reloads the queue after a wrong number). An action that
saves and then re-reads counts a failure after the save as the re-read's. The reload after a
successful action no longer clears another action's failure on Floor, Service status, Canvases,
Staff and Payments, and a read an action takes before its write, such as Products' restore, counts
as a read's.
Screens: Floor, Roster, Kitchen, Printing rules, Device profiles, Recipes, Purchases, Canvases,
Approvals, Devices, Service status, Staff, Products, the courses list, Profile, the reprint dialog,
Diagnostics, Units, Bookings and Prep stations; Payments and Cloud services already kept it, and the
placement step keeps a save's failures in a list of their own. Prep stations used to clear any
message on every successful read; an action's message there now stays until the person acts or
edits again.
Left as it was (#1142's run-it review, which found the same on `main`): on Device profiles, a
failed one-off reload's message can stay after fresh data arrives.

**A dashboard read that waits on an outside service can be cut off at 30 seconds and reported as a
broken connection (A255, from lane A's W18a, #1135, 2026-10-03) — DONE (#1145, lane A's W18c).** Two
dashboard reads wait on a card provider, and each now passes its own limit to `createRequest`
(`packages/dashboard-kit/src/request.ts`, the `timeLimitMs` option). A reader's status
(`GET /management-api/payments/readers/:id/status`) and the provider's available readers
(`GET /management-api/payments/providers/:id/available-readers`) wait up to 250 seconds
(`apps/dashboard/src/api/client.ts`). Stripe gives up on an attempt after 80 seconds of silence
once connected and tries three times (stated in `defaultMakeStripe`,
`packages/payments-stripe/src/card-provider.ts`). Its timer is `req.setTimeout` (stripe 22.6.2,
`esm/net/NodeHttpClient.js`, line 44), and Node starts a socket's timeout only once it has
connected (measured on Node v26.7.0: a request to an address that never answered, with a 100 ms
timeout, had not timed out after 1.5 seconds; the control, connected to a silent server, timed out
at 104 ms). Stripe's pauses between retries add at most about 1.5 seconds (`_getSleepTimeInMS`,
`esm/RequestSender.js`, lines 218 to 230: half a second, then one second, each randomised to
between half and all of that, never under half a second), so three attempts that go silent once
connected take at most about 241.5 seconds. A provider that keeps sending data slowly, or a
connection that is slow to open, can take longer, since Stripe's limit is on silence, not on the
whole answer (measured by the run-it review with stripe 22.6.2: with an 80 ms timeout, a body
trickled in over 327 ms arrived complete). The SumUp pairing dialog's status read waits up to 50
seconds (`packages/payments-sumup/src/dashboard/client.ts`), above SumUp's two 20-second calls
(`packages/payments-sumup/src/sumup-client.ts`, line 85). Every other read keeps 30 seconds. A
read that runs out of time now fails as `connection.timed_out` ("Waitron is taking too long to
answer. Try again in a moment."; the reader-status surfaces show it since W46, A259), and a fetch that fails on its own still as `connection.failed`; a timed-out read the live
data store keeps is read again as before. The other reads this entry named do not wait on an outside
service, read in the code and not run: the Cloud status and backup status reads and the bucket
settings read look only at local files and the database, and the Cloud network calls belong to
actions, which have no limit. The test-email reads (`GET /management-api/email` and
`GET /management-api/email/message/:id`, `apps/server/src/email-inbox-api.ts`, lines 41 and 52) ask
Mailpit over HTTP with no limit of their own (`apps/server/src/mailpit-client.ts`), but Mailpit is a
container on the box itself (`deploy/compose.yml`, the `mailpit` service), not an outside service,
so they keep 30 seconds. The alerts list now asks the card provider outside its transaction
(A258). The Payments screen asks at most two readers for their status across
same-origin tabs when Web Locks grants requests, and at most two per tab when it does not (A260).

**A low SumUp reader battery now reaches the alerts list (A258 — DONE).**
`GET /management-api/alerts` reads the session, incidents and database-only sources in its
transaction, then calls the battery source after that transaction closes. The SumUp provider can
read its sealed key in its own transaction before asking the provider. The route test
`apps/server/src/alerts-api.test.ts` seeds a real sealed SumUp credential and a reader, then checks
that a 5% provider response produces `reader.battery_low`. Its red run returned
`alert.source_unavailable`; its green run returned the low-battery alert. The battery source still
uses its five-minute cache, covered by `apps/server/src/alert-sources.test.ts`.

**The alerts list's battery check has its own deadline (A258 follow-up — DONE, W58).**
The server gives the battery source 45 seconds: SumUp's status path makes two HTTP requests in
turn, each with a 20-second limit (`packages/payments-sumup/src/card-provider.ts` and
`packages/payments-sumup/src/sumup-client.ts`), while Stripe's retries can run much longer
(`packages/payments-stripe/src/card-provider.ts`). A stalled source produces one
`alert.source_unavailable` for card readers while the other alerts still arrive. The browser
allows 55 seconds for `listAlerts`, leaving time for the server's bounded check and the rest of
the response. The held-provider route case in `apps/server/src/alerts-api.test.ts` checks the
response; the browser cases in
`apps/dashboard/src/api/client.test.ts` check both sides of its limit. A provider call that
ignores cancellation may continue after the server has answered; the source's five-minute cache
shares that in-flight call with reads during its lifetime.

**A slow reader no longer hides another reader's battery warning (W91 — DONE).**
Each reader has its own result under the source's 45-second deadline. A failed or timed-out check
names that reader in `reader.status_unavailable`; a prompt low-battery result remains visible beside
it. When every reader check is unavailable, the card-reader area also retains its existing
`alert.source_unavailable` alert. The route and source tests cover a held reader beside a 5% reader,
a throwing reader beside a 5% reader, and the unchanged all-prompt result.

**A timed-out card-reader status read now says so without ending pairing (A259, found by W18c's
run-it review, 2026-10-03) — DONE (W46).** The SumUp pairing dialog keeps its created reader and
polls again after `connection.timed_out`, showing the shared timeout wording; a different status
refusal still ends pairing and unpairs it. The Payments reader row and details show the timeout
wording while other failures keep their existing unknown-status and no-details text. The red-first
browser cases in `packages/payments-sumup/src/dashboard/sumup-add-reader.test.ts` and
`apps/dashboard/src/screens/payments-screen.test.ts` separate those paths. Repeated timeouts keep
polling even after the pairing code's five-minute window because the reader may already have paired;
the countdown disappears at zero, and only a known paired or processing status can finish or expire
the attempt. A cancelled dialog still follows its existing orphan-cleanup path.

**Several card readers' status reads at once can use up the browser's connections to the box
(A260, found by W18c's review, 2026-10-03) — DONE (W18c #1145 and W48).** The readers table
holds at most two status reads across same-origin documents when Web Locks grants requests, with the
original per-tab two-place limit when the API is unavailable or refuses a request (`takeStatusSlot`,
`apps/dashboard/src/screens/payments-screen.ts`). In real Chromium, the W48 test held reads in two
same-origin documents: four started before W48 and two after; removing a document while its reads
were pending freed both places for the other document. When one document holds both places on a
silent provider, another document cannot start a reader status request until one finishes or its
250-second client limit expires (`CARD_PROVIDER_READ_LIMIT_MS`, `apps/dashboard/src/api/client.ts`).
The W48 test does not measure a real silent provider or the box's HTTP/1.1 connection limit. A
load a refresh has replaced, and a closed screen's reads still waiting for a slot, give up through
the status version number
(`disconnectedCallback` bumps it); a new load on a closed screen (an action that finishes after it
closed) is stopped by the `isConnected` check in `#loadStatuses`. Before W48 each tab had its own two,
and W18c's review measured three tabs of the real screen in headless Chromium against held HTTP/1.1
responses: six status requests reached the server, and an unrelated read was still unanswered after
3000 ms until one status request was released. The SumUp pairing dialog's status reads (`#pollTick`
and `#unpairOrphan`, `packages/payments-sumup/src/dashboard/sumup-add-reader.ts`) are outside the
limit, other screens' reads are not limited, and it was not measured in a real browser against a
real silent provider. Guard: the "readers' status reads" cases in
`apps/dashboard/src/screens/payments-screen.test.ts`; at least one of them failed under each of five
changes tried one at a time: the limit raised to 99, the replaced-load check removed, the
closed-screen version bump removed, the slot never given back, and the `isConnected` check removed.
All five were re-run on the final code on 2026-10-03
(`pnpm --filter @waitron/dashboard exec vitest run src/screens/payments-screen.test.ts -t "status reads"`;
unchanged, 6 passed). What it was: with five or more active card
readers and a stalled provider, the Payments screen's status reads (one per active reader, all at
once, `#loadStatuses` in `apps/dashboard/src/screens/payments-screen.ts`) can hold every connection
the browser allows to the box for up to 250 seconds, so other dashboard requests wait behind them.
Measured 2026-10-03 in headless Chromium against a local HTTP/1.1 server: with five requests
hanging a sixth answered in 3 ms; with six hanging it had not answered after 3 seconds. The box
serves HTTPS through `node:https` (`apps/server/src/tls.ts`), which is HTTP/1.1, and the
dashboard's live connection (an EventSource) already holds one connection. Raised in W18c's pull
request (`fix/slow-read-limit`).

**Payments reader-status tests counted calls before the Web Lock grant (W59, 2026-10-04) — DONE.**
The dashboard shard failed twice with one call where a test expected two: PR #1165 CI
`37186851640` at `payments-screen.test.ts:2008`, then main CI `37188446283` attempt 1 at
the reordered-readers case. `takeStatusSlot` awaits `navigator.locks.request` before calling
`readerStatus` (`apps/dashboard/src/screens/payments-screen.ts`), while the test's `mount` helper
waits a fixed 10 ms. The tests now wait for the expected call count before checking that later
refreshes add no calls; the exact count and call-order assertions remain. The failure did not
recur locally: on this machine the parent of #1166 and main each passed 12 focused Chromium runs,
and main passed eight full Payments-file runs before W59; the changed file passed one full run and
12 focused runs. Those passes do not measure the CI race's frequency.

**Empty-state text shows beside a failed read on Payments and Cloud services (A252, seen 2026-10-03
while checking lane A's W18) — OPEN.** While its read is failing, Payments still says "No card
readers yet." under an empty table, and Cloud services says "Checking Cloud connection…" under the
failure message; the same on `main` before W18. It is the kind of empty-state text W18 removed from
Roster and Planned vs actual.

**The WAITRON wordmark is nearly invisible in the dashboard's banner in dark mode (A225, seen
2026-10-02 while checking A206) — DONE (#1128).** The dark lettering of the lockup sat on the dark banner.
The owner chose to keep the banner's `<img>` and let the browser swap in a dark-theme file by the
computer's dark-mode setting: the banner is now a `<picture>` whose dark source is
`packages/ui/brand/waitron-lockup-dark.svg`, written by `build-icons.mjs`. The login card and setup
wizard were already readable; they paint their inline logo with the tokens. _2026-10-04 (W103): the
login card no longer draws a logo._

**The dark logo's colours are copies of the dark theme's (A253, 2026-10-03, from A225) — OPEN.**
`waitron-lockup-dark.svg` is shown through an `<img>`, which cannot read CSS variables, so it carries
`#4c8dff` (`--wt-color-primary`, dark) and `#eceef2` (`--wt-color-text`, dark) literally, from
`build-icons.mjs`. Until this is done, change either token and change the generator, then re-run it.
`scripts/brand-icons.test.ts` fails when they drift, weaker than its name: it reads `colors.css` as
text and takes the dark values from the `@media (prefers-color-scheme: dark)` block only.
**Next action:** have `build-icons.mjs` read the two dark values from `colors.css` when it runs, so
there is no copy to keep in step.

**The Products screen as a category tree (A208) — DONE.** Spec
[2026-10-02-products-category-tree-design.md](superpowers/specs/2026-10-02-products-category-tree-design.md);
plan [2026-10-02-products-category-tree.md](superpowers/plans/2026-10-02-products-category-tree.md).
The tree's folder icons use the larger shared icon size on the root, category, new-category and drag-preview rows (W61).

**Deleting a category warns about exactly what will go (W74, owner 2026-10-04) — DONE (#1196).** The owner
deleted an empty "Mains", one of three top-level categories with that name, and was warned about
another Mains's product. A reproduction on a running stack found the server always counted and
deleted the right category; the dashboard was at fault. Fixed:
- Choosing Delete in a category's row menu now closes the menu, as Rename and Move already did.
  It stayed open, and once the empty category was deleted and the list redrawn, the open menu
  belonged to the next category, so a second click deleted or summarised that one.
- `wt-data-table` keeps each row's page elements with that row's data when rows are added, removed
  or reordered, in the plain table and the tree, so an open menu stays with its row — where each
  row's `rowKey` is unique to it. Rows that share a key are still all drawn, and are told apart by
  which occurrence of the key they are (`repeatKeys`), so a row added ahead with the same key takes
  over the elements of the row it displaces. A table that sets no `rowKey` keys rows by their
  position.
- The "Delete it too" choice counts only active products (a new `activeProducts` in each
  category's summary); a deactivated product is already out of the list, unless the Status filter
  is set to show inactive products, and only moves up.
  Whether a category is deleted at once without the dialog is unchanged, so one holding only
  deactivated products still asks.
- The dialog lists each category it will delete by its full path, with "(2 of 3)" where several
  share a path, in the order the list draws them.
- Pressing Delete in the dialog reads the categories' contents again; if the numbers of
  subcategories, active products or routing rules differ from those shown (`#unchanged` in
  `apps/dashboard/src/widgets/catalogue-browser.ts`), nothing is deleted and the dialog shows the
  new counts with a message saying so.
- The server now makes the same comparison inside the delete's own transaction, before anything is
  written (W74a, #1217). The dashboard sends the counts it read before deleting (the ones its dialog
  showed, when it asked) with every delete that names a category, and when they no longer match the
  server deletes nothing and refuses with `category.contents_changed` (409); the dashboard then
  reads the contents again and shows the new counts with the refusal's own message. Before this, a
  change between the dashboard's second read and the delete was not seen.
- Choosing Edit or Delete in a product's row menu, or Edit, Remove or Restore in a variant's, now
  closes the menu too (W74b, #1219). Those items stopped the click as the category Delete had, so
  the menu stayed open after each of them. Tested in the list itself, which sends exactly one
  request per choice; not tested through the whole Products screen that handles the requests.
- The routing-rules warning counts only the rules the chosen option removes (W74c, #1220). Reproduced
  first in `apps/server/src/catalogue-api.full-manifest.test.ts`: with one rule on a category and
  two on its subcategory, the summary reported 3 and moving the contents up removed 1, the
  subcategory keeping both of its own. Each category's summary now also reports `ownRoutes`, the
  rules naming the category itself (`summariseFolders`, `packages/catalogue/src/catalogue-items.ts`).
  Under "Move it up to the parent category" the dialog warns of the selected categories' own rules,
  summed over every selected one; under "Delete it too", of every rule in the deleted subtrees, as
  before. The delete sends `ownRoutes` with the other counts it showed, and the dashboard's second
  read at Delete and the server both treat a change to it like a change to the others.
- The Printers screen's discovered-device rows no longer share a key (W74d, #1242). Reproduced in a
  browser test: with two agents reporting one network printer, both rows carried one key, and when
  a later scan read dropped the first agent's report, the table handed that agent's drawn row to
  the second agent and removed the second agent's own row. The discovered table's row key now
  names the reporting agent too. The rows stay one per agent, and Add still registers a network
  printer once by its address: "registers a network printer two agents see once, and offers Add on
  neither agent's row afterwards", beside "keeps one agent's row for a printer two agents see when
  the other agent's report drops" in `apps/dashboard/src/screens/printers-screen.test.ts`. Left as
  it was: the `data-test` names inside each row (`discovered-row-`, `register-`, `pair-`,
  `forget-device-` and the rest) use the device alone, so a lookup by name finds the first row
  drawn for that device.
- Under "Delete it too" the routing-rules warning says the rules name "these categories or ones
  inside them" (Spanish: "estas categorías o las que hay dentro de ellas"), since its count
  includes rules on subcategories the dialog does not list (W74e, #1224). Under "Move it up to the parent
  category" it keeps "name these categories", which is what that count is.

Still open from W74:
- **An empty category's no-dialog delete does not see an inactive product added meanwhile**
  (raised in #1217's review, not reproduced in a test): an empty category is deleted without the
  dialog, and the server compares active products only, so one that gains only an inactive product
  between the read and the delete is still deleted, the product moving up.
- **A category holding only routing rules is deleted without the dialog** (raised in #1217's
  review): the no-dialog path checks subcategories and products only, so its rules go unannounced.
  The check dates from commit `5ffa5c633c` (2026-10-01).
- **The delete dialog stretches to nearly the full screen height**, with empty space below its
  text, at 1280 and 390 wide (seen on the demo stack while checking #1220; not caused by it, and
  not traced further). _2026-10-05: W70a (#1265) changes compact height only; this standard
  dialog retains its height._

**The options list form's drag-handle column stays narrow (A198, owner 2026-10-02) — DONE.** The
owner, on two screenshots of the same three options, the Name column starting far to the right
until one name is long enough to push it left: _"the drag handle column shouldn't auto-expand, so
the Name column would start just to the left of it"_ (read as: just to the right of the handle).
The form's table had no column widths, so the browser shared the spare width among the handle,
Default and menu columns. **Wanted:** the handle, Default and menu columns as narrow as their
controls, and Name taking the rest. The options list now gives spare width to Name; the extras list
keeps its grip, Preselected and remove columns at their content widths. Chromium checks cover both
languages at phone and desktop widths. A195 asked the same of `wt-data-table`'s Actions column; it is
done too (above).

**Empty extras and options tables keep their Preselected and Default headings readable (A262, owner
2026-10-03) — DONE (W49).** The headings stay on one line with no rows in English and Spanish.
The extras heading extends into the preceding column's spare space while its switch column stays
narrow; the options heading does the same with Name while the Default radio column stays narrow.
Chromium cases cover empty tables
at 1280px and 390px in both languages.

**The number field with − and + is still too wide (A263, owner 2026-10-03) — DONE (#1151). (The owner chose
option C: 24px plain − and + either side of a centred number, and clearable Minimum and Maximum
choices that show the placeholder "None" while empty; a maximum of 0 is refused by the form and the
request check, and the database CHECK is unchanged.)**
The owner, on a screenshot of the extras list editor after A202: _"i'm not sure about the
number fields with the +- buttons, they're very wide"_. Each button was `--wt-tap-min` (44px) wide,
so 88px of every box was buttons; the box was at least `--wt-stepper-field-width` (152px), or
`--wt-stepper-field-width-wide` (184px) when its blank value showed words such as "No limit", and a
longer label such as "Minimum choices" widened it further
(`packages/ui-core/src/tokens/structure.css`, `packages/ui/src/components/wt-number-stepper.ts`).
The next step, the owner's choice, was a brainstorm drawing narrower versions side by side for the
owner to pick from, as A202 did. A202's constraint stood: stacked up/down arrows had been turned down because each came
to 28px tall, below `--wt-tap-min`. Options raised but not chosen: narrower buttons on the
dashboard only, an ordinary number box on the dashboard with the steppers kept for touch screens,
and shorter labels.
**The owner's direction (2026-10-03):** first _"maybe something simpler like amazon's number
fields"_, with a screenshot of Amazon's basket quantity (one outline, the number centred between a
bin or − and a +, plain icons with no filled button squares); then _"it doesn't need to be rounded -
but the + and - can just be part of the field without needing so much space"_. **On size, the
owner (2026-10-03):** _"if the buttons are removed from
each other they don't have to be so big - there's less risk of hitting the wrong thing"_. That is
the web accessibility standard's own exception. WCAG 2.2's level AA rule, 2.5.8 Target Size
(Minimum), reads: _"The size of the target for pointer inputs is at least 24 by 24 CSS pixels,
except when: Spacing Undersized targets (those less than 24 by 24 CSS pixels) are positioned so
that if a 24 CSS pixel diameter circle is centered on the bounding box of each, the circles do not
intersect another target or the circle for another undersized target"_. The 44px figure is the
stricter level AAA rule, 2.5.5 Target Size (Enhanced), which has no spacing exception (both read
from https://www.w3.org/TR/WCAG22/, 2026-10-03). Waitron's `--wt-tap-min` (44px on both axes) is
the house rule, written for POS screens staff touch under time pressure
([design-system.md](developers/design-system.md), "`--wt-tap-min`"), and `wt-number-stepper` was
used only on dashboard screens when this was decided (`grep -rln wt-number-stepper apps packages`:
the backup screen, the extras list editor and the venue operations screen).
**Decided (owner, 2026-10-03), option C from the mockups:**

- − and + are plain icons inside the ordinary field box (not a rounded pill), − at its start and + at its end,
  with the number centred between them; each is `--wt-stepper-button-width` (24px) wide, kept
  apart by the number;
- the label always sits on the box's top line, even while the box is empty;
- the narrowest box, `--wt-stepper-field-width`, is 88px; `--wt-stepper-field-width-wide` is gone;
- the stepper has a new `clearable` setting: − at its lowest number or below empties the box
  instead of being disabled there;
- in the extras list editor, Minimum and Maximum choices sit under a "Number of choices" heading.
  Both are clearable from 1, so − goes 3 → 2 → 1 → blank, and an empty box shows "None"
  ("Ninguna") as its placeholder. A blank minimum is saved as 0, and a saved 0 shows as the empty
  box; a typed 0 is kept as typed. A blank maximum means no limit. A maximum of 0 is refused by the form
  (`extras.max_picks_zero`) and by `parseExtraListInput`
  (`packages/catalogue/src/extra-contract.ts`, `extras.invalid` naming `maxPicks`); the database
  CHECK in `packages/catalogue/src/schema/extras.ts` is unchanged, because changing it rebuilds the
  table.

The stepper's row and the tap-target paragraph in design-system.md, and the primitive's axe and
token-painting tests, changed with it.

**What #1151 left open (2026-10-03):**
- **The database still accepts a maximum of 0.** The CHECK on `extra_lists` allows `max_picks = 0`
  when `min_picks` is 0, and configuration transfer copies stored lists without the request check,
  so a stored 0 can still arrive; the form then shows the 0 and refuses to save until it is
  changed. Refusing it in the database is a table rebuild (CLAUDE.md §3's rebuild rule). OPEN,
  unqueued: the owner has not asked for it.
- **A very long number is cut off in the narrower box.** The request check accepts up to
  2147483647, which needs about 82px against the 66px between the buttons (measured by #1151's
  review); three digits need about 26px. Left alone because widening the box would undo the size
  the owner approved. OPEN, unqueued.
- At 390px the extras table's Price column runs past its scroll area's right edge until scrolled;
  #1151's review measured it on main before the change (452px against a 373px area) and smaller
  after it (388px). OPEN, unqueued; W49 changed the table's column sizing, but horizontal scrolling
  remains for the Price column at phone width. (2026-10-04: W75 added a Portion column and widened
  the table; not re-measured.)

**The extras list editor's columns stay in place as products are added (A264, owner 2026-10-03)
— DONE (W49).** Fixed table sizing leaves spare width with Product, and long names wrap inside it.
Chromium cases add a longer product at 1280px and 390px in English and Spanish and check each
following column's position.

**Each extras row's Preselected switch repeats its column heading beside it (A265, owner
2026-10-03) — DONE (W49).** The row switch hides the repeated text and keeps its accessible name.

**An extra's maximum quantity can be left blank for no limit (A266, owner 2026-10-03) — DONE
(W54).** The editor sends null for a blank item maximum; an absent maximum still defaults to one.
The server and till enforce the list's Maximum choices independently of the item's limit. The menu
changes list names a change to or from no limit. Catalogue migration 0023 makes the column nullable.

**Update the root null-exception rule after W54 — OPEN (owner rule-file maintenance).**
`CLAUDE.md` §3 still names only `maxPicks` and `guestCount` as fields where explicit null is a value.
An item's `maxQuantity` is now another; `packages/catalogue/src/extra-contract.test.ts` pins both
its absent default and explicit null. Lane D RUNNER §7 bars this campaign from editing the rule file.

**The option form opens with its names section expanded (A199, owner 2026-10-02) — DONE by A170
(#1040):** the option window no longer folds its names at all, so they show on open on Add and Edit;
"can still be collapsed" no longer applies, because nothing folds. The
owner, on screenshots of "Add option": _"on the edit/add options page start with the names block
expanded as there is very little else on this page"_. The single option's form
(`apps/dashboard/src/widgets/option-label-form.ts`) held only Name, the "Customer and kitchen names"
section and Available, and its `wt-disclosure` started closed. **Wanted:** the section opens
expanded, on both Add and Edit, and can still be collapsed. Read as the single option's form, which
the screenshots show; the options LIST form's section is left as it is — ask if both were meant.

**A folded names section's line puts a colon after each field's name (A200, owner 2026-10-02) —
DONE (#1076).** The owner: _"when rendering the names block "EN Medium, pink in the middle · ES Al punto,
rosado por dentro · Kitchen AL PUNTO", add a colon after each field: "EN: Medium, pink in the middle
· ES: Al punto, rosado por dentro · Kitchen: AL PUNTO", and maybe make the field names bold"_. The
line is built by `namesLine` (`apps/dashboard/src/widgets/form-fields.ts`), used by the options
list and extras list forms (the option form stopped folding its names with A170).
_(2026-10-04: now `effectiveNamesLine`, W77.)_ **Decided (owner, 2026-10-02, choosing B of three mockups,
"although C is good too"):** "EN:", "ES:" and "Kitchen:" (Spanish "Cocina:") in bold, the values
in the summary's usual muted text. (C, the field names in full-strength text rather than bold, was
the runner-up.) Bold needs markup, and `wt-disclosure` takes its `summary` as a plain string; give
the primitive a way to take the parts (a slot, or name/value pairs) rather than building markup in
each screen. Since A171 the line holds only the customer-facing names, so it has no "Kitchen:" part.
(2026-10-02: `summaryFields`, built for A219, is that way; `namesLine` and the product editor's
Kitchen line now use it, and the Descriptors line uses `summaryRows`, built for this item.)

**The product editor's folded sections follow the same pattern, with real values (owner,
2026-10-02):** _"regarding products, i think we should include the field values not just the fact
that they're filled in, and we should show a thumbnail of the image too"_. Before A200,
`product-editor.ts` wrote the Kitchen section as "SOLOMILLO · Mains" and the Descriptors section as
"customer name (EN, ES) · description (EN) · image". **Decided (owner, 2026-10-02, from mockups):**

- the Kitchen line gives each value after its bold field name: "**Kitchen name:** SOLOMILLO ·
  **Course:** Mains";
- the Descriptors line is one row per field, its languages side by side: "**Name:** EN: Beef
  tenderloin · ES: Solomillo de ternera", then "**Description:** EN: … · ES: …". The Name row is cut
  to one line, the Description row may wrap to two before it is cut, each with an ellipsis, so it
  stays two rows however many languages the venue has;
- the image is not in that line at all: the product's photo sits beside the Name field at the top
  of the editor, as the product list (`product-list.ts`) shows it beside each product's name (the
  owner's suggestion). **Clicking it opens the image picker, and the picker moves out of the
  Descriptors section** (owner, 2026-10-02: _"it should open the image picker, in fact the image
  picker should move out of the descriptions box i think"_). Before A200, `dashboard-image-upload` was
  drawn inside that section, with its error under it, and `SECTION_FIELDS.descriptors` listed
  `image`, so an image error forced the section open; both move with the picker, and an image
  error then shows beside the photo. The picker is drawn only when the editor has an `api`; the
  photo's slot needs a state for that too. With no photo, the slot shows a placeholder that still
  opens the picker (the list's `thumb-placeholder` look). A variant with no photo of its own shows
  its parent's (`inheritedImage`), and it must be clear that it is inherited. It is a button: a tap
  target, a focus ring, and a name a screen reader reads ("Change photo" / "Add photo").

LOOK at it at phone width, where a long English description leaves little room for the Spanish.

**Built:** `wt-disclosure` gained `summaryRows` (one row per field, each cut with an ellipsis after
its own number of lines). `namesLine` returns name and value pairs, so the extras and options lists'
line reads "**EN:** Make it yours · **ES:** Añádele algo" _(2026-10-04: now `effectiveNamesLine`,
W77)_. The Kitchen line's labels are the field's
own "Kitchen name" ("Nombre de cocina") and a new short "Course" ("Curso"). In the Descriptors rows
only "Name:" and "Description:" are bold; the language codes are plain text, as the decision above
writes them. The photo is the thumbnail form of `dashboard-image-upload` (`thumbnail`), beside Name
and stopping where the other fields stop; it is named "Add photo" or "Change photo"; an inherited
photo has a dashed border and no visible caption: "The main product's photo" describes the photo
button to a screen reader only (owner, 2026-10-03, choosing that over a visible caption). In the editor,
Remove moved into the image library window's footer, shown when the product has a photo of its own;
the variant form and the section details form keep today's photo control. With no
`api` there is no photo and Name takes the whole row. A refused photo shows its reason under the
photo and leaves Descriptors closed. Looked at, 2026-10-03, at 1280 and 390 wide in both themes and
both languages: at 390 a long English description fills both of its lines, so the Spanish one does
not show at all on the closed line.

**Choosing a product in an extras list adds it at once (A201, owner 2026-10-02) — DONE.** The
owner, on a screenshot of the extras list form's "Choose a product" dropdown beside an "Add
product" button: _"make the hint text say "Add a product", remove the button. if you select a
product in the dropdown it gets added automatically. if you close the chooser without selecting
then nothing happens"_. The dropdown's prompt now reads "Add a product" (Spanish to match;
`extras.choose_product`); choosing a product adds its row straight away and resets the prompt,
and closing without a choice adds nothing. The button and `extras.add_item` are gone. Focus stays
on the dropdown after an add, so a keyboard user can
add the next product, and the new row is announced (the form's live region). The owner extended the
same behavior to the menu screen's members editor (`member-list-editor.ts`): choosing a product or
section adds it immediately and announces it; replacing an existing member still requires explicit
confirmation. (Since W88, 2026-10-05, the Menus screen no longer draws that editor or its product
picker: a menu's Structure tab adds products through Add products in a row's ⋮, and the editor is
drawn only for a menu's Home page tiles.) The remaining single-choice add pickers are covered by
A201b below.

**Choosing one thing to add acts at selection (A201b, owner 2026-10-03) — DONE.** In the
dashboard, choosing a content language or a menu to include saves it immediately and closes
the dialog on success; closing without a choice saves nothing. A refused save leaves the
dialog open so you can choose again. Section products and Add to menus let you choose several
items before saving. Allergen editing was changed separately in A213. The till's station move
and the dashboard's unit reassignment each ask for confirmation. Setup forms with other required
fields still wait for those fields before saving.

**Open test gap from A201b:** removing `#closeLostList()` from `#includeMenu` in a disposable
checkout left `pnpm --filter @waitron/dashboard exec vitest run src/screens/menus-screen.test.ts`
green (207/207, 2026-10-03). The suite does not establish whether that guard catches a list
disappearing between the last read and selection. Check that race with a focused test, or remove
the guard if the path cannot occur; its reachability remains unverified.

**The number field's − and + move inside the field, as pale blue buttons (A202, owner 2026-10-02)
— DONE.** The owner, on a screenshot of the extras form's Minimum and Maximum choices: _"the +-
fields are very bulky and become difficult to read"_. Their first idea, up and down arrows stacked
inside the field, made each arrow 28px tall, below `--wt-tap-min`; from mockups (today, A, B, C,
D1, D2, E1–E3) the owner chose **E3**. **Decided:** in `wt-number-stepper`
(`packages/ui/src/components/wt-number-stepper.ts`):

- − then + sit INSIDE the filled field box, at its trailing end, instead of bordered squares
  outside it; each is `--wt-tap-min` wide and the box's full height, so the tap size holds;
- each button has a pale blue fill with its symbol in the primary blue, and a 1px line before it
  in the surface colour, separating it from the value and from the other button; the + button
  takes the box's top-trailing corner radius; a hover darkens the fill a step;
- a disabled button keeps its fill and only its symbol fades — this replaces the design-system
  rule that a disabled stepper button dims as a whole through `--wt-opacity-disabled`;
- the value and its label sit at the box's start like any other field (the mockup's choice; today
  the number is centred), and "No limit" stays the grey italic prompt.

The pale blue and its hover step are new colour tokens with dark-theme values, as `--wt-*` tokens
(`packages/ui-core/src/tokens/colors.css` has only `--wt-color-primary` and `--wt-color-on-primary`
today); their contrast with the symbol must pass the axe test in both themes. What changes with
the layout: the box widths (`--wt-stepper-field-width`, `-wide`) now include the buttons, the
compact `hide-label` box, the width-matching between two steppers side by side, the
`wt-number-stepper` row and the tap-target paragraph in
[design-system.md](developers/design-system.md), and the primitive's token-painting and axe tests.
Name every test changed in the PR. LOOK at every screen that uses it
(`grep -rln wt-number-stepper apps`), in both themes and at phone width. (The look described here was changed by
A263, 2026-10-03, above.)

**An extra is a fixed portion: a product sold by weight is offered as, say, 50 g a pick (A203,
owner 2026-10-02) — DONE.** The owner: _"today you can add an extra sold eg per kg, but there is
nowhere to put a quantity in there. i think extras should always be a fixed amount, so eg if i add
Jamon @ 100€/kg, we should enter the base amount of (eg) 50g, and when you add it multiple times you
get 50->100->150 etc"_. The list item now stores a portion and the offer freezes its unit and
price per portion. The saved child line records its physical amount and price basis; receipt and
kitchen labels use the saved amount. The menu's published offer stays in use until republishing.

**An extra sold by the piece prints as `x3` on receipts, kitchen tickets and the till's filed-ticket
view (W53, owner 2026-10-03) — DONE.** The working line context saves whether its unit is Each when
the line is added. Each shows its pick count per dish, while weight and volume retain the total
physical amount and saved abbreviation.
This amends the display decision in the [A203 design](superpowers/specs/2026-10-03-extra-fixed-portion-design.md);
the filed sale amount and fiscal record are unchanged. The new context column defaults to false on
existing rows, including open orders. Reset pre-production venues before using W53 with orders
recorded before this migration; otherwise their live tickets and settled reprints can show the old
unit wording.
The live till basket still uses `×N` for modifier counts (`apps/till/src/widgets/basket.ts`);
W53 changes the filed display surfaces.

**Decided (owner, 2026-10-02):**

- an extras list item for a product whose unit is weighed (`hardwareUnit` set) or fractional
  (`precision > 0`) has a required **portion**, e.g. 50 g, held to the unit's precision; an "each"
  product's portion is one and the form asks for none; _2026-10-04 (W75): the list editor now asks
  for a portion for EVERY unit but Each, so whole grams, millilitres and a venue's own units too;
  the server still accepts a new item of a whole unit with no hardware link (ml, say) without one,
  and stores 1._ _2026-10-05 (W75c): the server now refuses that too. (W75d): an item the list
  already holds under its id for the same product, sent again without a portion, keeps its saved
  one unless its product is Each. (W75e): an item whose product is Each is refused with any
  portion but one, even when that portion equals the one saved before the product became Each._
- each pick adds one portion: three picks of 50 g are 150 g, and a dish × 2 doubles that, as the
  count does today;
- the item's **Price is per portion**: blank, it is the portion × the product's unit price (50 g ×
  100 €/kg = 5 € a pick), shown as the price field's hint; filled in, it is that amount per pick;
- the receipt and the kitchen ticket print the **total amount** — "+ Jamón 150 g" — not
  "50 g ×3";
- **no conversion between units** (owner, choosing the simpler of two readings of _"the
  restaurant can choose the appropriate unit, eg g instead of kg"_): the portion is entered,
  stored and printed in the product's own unit. A restaurant that wants "50 g" sets the product up
  in grams (0.10 €/g); one priced per kg enters "0.050" and prints "0.150 kg". The owner accepted
  that a per-gram price cannot hold a fraction of a cent (13.50 €/kg has no exact per-gram price);
- **a unit change says where the product is offered** (owner: _"we need some sort of notification
  of where it is used"_): changing a product's unit — or a parent's, which its variants without
  their own inherit (2026-10-03 (A222): a variant now always has its product's unit) — shows
  the extras lists that offer it, because the stored portion is a number
  in the old unit (50 in g becomes 50 kg). The units screen already lists the products using a
  unit (`ProductUsingUnit`, `packages/catalogue/src/unit-types.ts`); the same applies when a unit's
  own precision changes under portions held to it. Name both the affected extras lists and the
  menus that offer them; warn and save without clearing portions. Each affected menu's pre-publish
  changes list names the extra's unit change. The till sells that menu's published copy until you
  republish it. No unit conversion (owner clarification, 2026-10-03).

If precision falls from 3 to 2, a saved `0.055` portion remains 55 thousandths. Preview warns and
publishing keeps `0.055` with the new unit and allows sales; amount labels show the exact value,
without rounding it to `0.06`. A new or changed portion must meet current precision, while an
unchanged saved value remains visible and may pass through an unrelated extras-list edit so you can
correct it later. This is the warning-only publication behavior in the [A203 design](superpowers/specs/2026-10-03-extra-fixed-portion-design.md).

**Implementation:** `extra_list_items.portion` stores thousandths, and the list editor checks a
new or changed portion against the product's unit. The catalogue resolves one rounded price per
pick for both the till and server. A child line saves its physical quantity and `price_quantity`;
held edits, sale lines, adjustments and printed amounts use that frozen basis. The amount reaches
a sale record, so the branch takes the full review path (risk trigger: fiscal invariants).

The [A203 design](superpowers/specs/2026-10-03-extra-fixed-portion-design.md) and
[implementation plan](superpowers/plans/2026-10-03-extra-fixed-portion.md) were approved on
2026-10-03. The implementation follows those decisions.

**A portion-only edit now names the extras list, product, and old and new amounts in the
pre-publish changes list (W51) — DONE.** The core `working_order_lines.price_quantity` and
`sale_lines.price_quantity` columns now require a positive count of thousandths (W52) — DONE.
Reset retained pre-live venues before installing core `0092`, which rebuilds both tables. The
one-step upgrade test records a foreign-key refusal on a self-referencing working-order line;
self-referencing sale lines can refuse the later drop too. Other linked tables use cascading
deletes, so a rebuild can also remove their rows. Core `0093` restores the seven working-order
line triggers dropped by the rebuild. `sale_lines` is append-only, and this migration copies its
rows through a new table before its append-only triggers are reinstalled.

**Department menu timetables and queued publication (A204, owner 2026-10-02; refined
2026-10-04) — SPEC APPROVED; implementation plans queued in lane B; not implemented.**
Departments own the available-menu list and the only timetable; zones override defaults within its shared periods.
An all-day default covers gaps; normal weeks and special dates share A261's calendar. Staff may
still order from breakfast after it stops being the default. Several future menu editions can be
queued, always moving forwards; an immediate publication that overtakes queued editions requires
explicit cancellation or replacement.
[Spec](superpowers/specs/2026-10-04-devices-menus-and-service-zones-design.md), §§2–3 and the approved details in §9;
[department-menu plan](superpowers/plans/2026-10-04-department-menus-and-timetable.md);
[publication plan](superpowers/plans/2026-10-04-forward-only-menu-publication.md).

**The product editor, tidied: eleven changes from one walk-through (A209 to A219, owner
2026-10-02) — OPEN.** The owner, on six screenshots of "Edit product" for "Cured beef cecina (per
kg)". All eleven are in `apps/dashboard/src/widgets/product-editor.ts` unless another file is
named. All eleven were settled from mockups on 2026-10-02 (A216 on the reading its entry
records); the decisions follow each entry. A214, A217 and A219 reshaped the Pricing section
together, in one branch.
LOOK at each on a product AND on a variant's page (the editor shows a variant with its parent's
values as the blank choices), at 1280 and 390, light and dark.

**No Add category button, and the category shown as a path (A209) — DONE (#1090).**
The owner: _"we no longer need the add category button. i'm questioning whether we need the
category dropdown at all now that we can drag products from category to category (although we
should show the path to the product eg Drinks > Alcoholic drinks > Cocktails) on that page"_. A
product has one category (`products.categoryId`). **Decided:** the Add category button goes, with
`editor.add_category`. **Wanted:** the product's full path, "Drinks › Alcoholic drinks ›
Cocktails", shown on the editor. **Open, ask before building:** whether the "Main category"
dropdown goes too. Two things it does that dragging may not: a variant's empty category means its
parent's, and the dropdown is where a variant is given a category of its own — A208's tree
cannot drag a variant on its own, because a press on a variant row starts no drag; and a product made from "All
products" has no category until it is dragged. **Clash with A208:** its spec keeps the category
form (`apps/dashboard/src/widgets/category-form.ts`) for one reason, this button, so once this
lands the form has no caller left.
**Decided (owner, 2026-10-02, from mockups, choosing B of three):** the "Main category" field
goes. Under the window's title the product's path reads "Drinks › Alcoholic drinks › Cocktails"
with a small "Change" link after it; Change opens the category list as an indented tree, anchored
at the path text (the owner: _"the dropdown should start from the category text"_), not below the
Name field. **A variant always has its product's category** (owner: _"i'm not sure that's a good
idea. maybe we shouldn't allow editing that"_): a variant's page shows its product's path as plain
text, with no Change. That retires the variant's own category everywhere — the server's
resolution of a variant's reported category (`variant.effective`, which the Products list and
reporting read) becomes "always the product's", and variants holding a category of their own are
cleared (allowed before go-live, §3). (2026-10-03: the owner decided against clearing them; see
"Left open" below.) Trace every consumer of a variant's `categoryId` first,
among them the Products list's main-category cell on a variant (A221, `apps/dashboard/src/widgets/product-list.ts`), which
compares the variant's effective main category with its product's and should then always stay
empty.
Built: the editor's first line is the product's path, names joined with " › ", or "Uncategorised";
on a product it is a link-style `wt-combobox` (`appearance="link"`, with the new option fields
`depth` and `valueLabel`) whose "Change" opens "Uncategorised" and then every category as an
indented tree. A variant's page shows its product's path as plain text. On the server a variant's
effective category is always its product's, a variant's editor save naming a category is refused
with `product.invalid` and otherwise clears what the row stores, and deleting a category clears it
from any variant still holding it. The Add category button, `editor.add_category`, the catalogue
screen's nested category create and the `dashboard-category-form` element went; the Products list
leaves a variant's category cell empty without comparing. _2026-10-04 (W84): the Main category
column is gone._
**Left open:**
- No migration clears the categories variants already store, and none will be written (owner
  decision, 2026-10-03: no data-migration code before go-live, CLAUDE.md §3, and the dev venue is
  reset before then). The effective category (`effectiveProductColumns.categoryId`) and the
  editor's read ignore a stored one, and the next save of the variant's own page, or that
  category's deletion, clears it.
- Prep Stations marks a product exception that can never apply when an earlier category exception
  already catches the product and every one of its variants (`family.every(...)` in `routingModel`,
  `packages/venue-service/src/routing-store.ts`). A variant's category is now its product's, so the
  variant half of that check always agrees with the product's and could be dropped.
- Past sales of a variant that had a category of its own now show under its product's category in
  the category sales report's "Current categories" mode (`current`,
  `packages/reporting/src/category-sales.ts`), which classifies each line by the catalogue as it is
  today; "Categories at time of sale" still reads what each line recorded.
- A configuration import copies `products` rows as they are (`select *` in
  `apps/server/src/configuration-transfer.ts`, from `CORE_CONFIGURATION_TRANSFER` in
  `packages/db/src/configuration-transfer.ts`), so an imported variant can arrive with a stored
  category that the effective category and the editor's read then ignore.
- Corrected in passing: the colour field entry above pointed at `category-form.test.ts` for the
  Custom square showing a chosen palette colour. #968 moved that test to `color-field.test.ts`
  before this branch, so the pointer was already wrong on `main`; it now names the new file.

**Standalone ordering becomes one dropdown (A210) — DONE (#1070).** The owner: _"Standalone ordering can
be reduced to a single dropdown"_. Before this, `renderOrdering` drew three radio buttons, Public, Staff
only and Not sold separately, each with an explanation under it. **Wanted:** one `wt-combobox`
with the three choices. The explanations need a new place: the design system's Forms rule makes a
field's hint its placeholder, which a dropdown that always holds a value never shows. The
combobox's option `group` heading is no help; decide between a line under the field for the
chosen value and a second, muted line inside each option, and ask if neither fits. A variant's
page shows no ordering choice and keeps showing none.
**Decided (owner, 2026-10-02, choosing B of three):** closed, it is a plain field showing the
chosen value, with no explanation under it; opened, each choice carries its explanation as a
second, muted line. `wt-combobox` learns an optional description per option, drawn as that second
line and read by a screen reader with the option.
Built: `renderOrdering` draws one `wt-combobox` named `ordering`, and `ComboboxOption` gained
`description`, drawn under the label in `--wt-color-text-muted` at `--wt-font-size-sm`. A described
row is named by its label (`aria-labelledby`) and the description is its `aria-describedby`; a
long description wraps inside the list rather than widening it. A refusal of `ordering` shows
under the field as the other dropdowns' do, and the field is disabled while the product saves or
another of the editor's windows is open, as the radio buttons were.
**W65 — DONE (2026-10-04):** The Staff only choice now says only “Only staff can order it on its own.”
The Spanish choice has the equivalent single sentence.
**Raised while reviewing #1070, settled by A226 (below):** `expectNoA11yViolations` failed only on
axe's `violations` list, so text set to exactly its background colour, which axe files under
`incomplete`, passed every a11y test.

**The accessibility checks fail when axe cannot confirm a colour contrast because of the colours
themselves (A226, owner 2026-10-03) — DONE (#1092).** All five copies
of `expectNoA11yViolations` (`packages/ui/src/a11y-helpers.ts`, `packages/ui-core/src/a11y-helpers.ts`,
and `src/widgets/test-helpers.ts` in `apps/dashboard`, `apps/setup` and `apps/till`) now also fail on a
`color-contrast` result axe 4.13.0 left undecided with the reason `equalRatio`, `fgAlpha` or
`colorParse` — the three of its reasons that are about the colours themselves (4.13.0 never sets
`fgAlpha`; it is only in axe's message table). Measured on main
e0911d714 before deciding: failing on EVERY undecided contrast result would have turned 658 passing
tests in 84 files red, with 2,555 undecided readings (`bgOverlap` 1,804, `nonBmp` 314,
`shortTextContent` 198, `elmPartiallyObscured` 128, `elmPartiallyObscuring` 111) and none of the three
colour reasons; the owner chose to fail on the colour reasons only. Each helper's tests (new files
`test-helpers.a11y.test.ts` in the three apps) show: text the same colour as its background is
undecided (`equalRatio`, no violation) and now fails, in both themes; readable text passes; an
empty `wt-input`, which axe leaves undecided with `bgOverlap`, still passes; and `fgAlpha` and
`colorParse`, fed through a stubbed `axe.run`, fail — stubbed because axe 4.13.0 never sets
`fgAlpha`, and none of the colour syntax tried in Chromium produced `colorParse`. Every test file
calling the helper passed with this helper code (2026-10-03, run per file in each package that
calls it).
**Still not checked:** contrast that axe leaves undecided for any other reason — among them an
overlapping element (such as an empty `wt-input`), a background image or gradient, content too
short or not text — passes, so contrast in those places is checked by nobody.

**A folded section says what is missing, not only what is filled in (A211) — DONE (#1096).** The owner:
_"we should show the missing values under kitchen and descriptors and nutritional info when
collapsed"_. Before A211, each folded section's line listed only the filled
values (`renderKitchen`, `renderNutrition` and the Descriptors section), so a product with no
kitchen name, course, allergens or dietary preferences showed only its heading. **Wanted:**
every field is named on the line whether or not it has a value, e.g. "**Kitchen name:** none ·
**Course:** none", "**Allergens:** none specified · **Dietary preferences:** none specified". Build
it with A200's product-editor decision above (each value after its bold field name, the
Descriptors line one row per field), which this extends to the empty case. Choose the wording for
"nothing set" once, in both languages; on a variant's page an empty value shows the parent's
value, as the fields themselves do (A172).
**Built:** the product editor's Kitchen, Descriptors and Nutritional info folds name every field
they hold: Kitchen (kitchen name, course), Descriptors (customer-facing name, description, one row
each) and Nutritional info (allergens, dietary preferences, now named fields rather than a bare
list). Nothing set reads "None specified" ("Sin especificar"), the existing
`modifiers.none_specified` the open allergen and dietary lines already use. In a Descriptors row a
blank language reads "None specified" in its place ("EN: Steak · ES: None specified"), and a row
with every language blank reads "None specified" alone. On a product's own page, allergens never
reviewed and allergens reviewed as none both read "None specified", folded as on the open line. On
a variant's page the course, description, allergens and dietary preferences left blank show the
parent's value in italic (a new `placeholder` mark on `wt-disclosure`'s `summaryFields` and
`summaryRows`), or "None specified", or "Not yet reviewed" for allergens the parent has not had
reviewed; a variant's kitchen and customer-facing names do not come from its parent, so blank
they read "None specified" as on a product. A product's course the course list does not hold reads
"Unavailable selection". Looked at, 2026-10-03, at 1280 and 390 wide in both
themes and both languages.
**Left open:** the same "nothing" still reads two ways in one window: the course dropdown says
"— none —", and on a variant's page the hints under the open Nutritional info say "None"
(`editor.allergens_none`, `editor.diet_none`) where the closed line says "None specified". At 390
wide a two-field line can wrap inside a value ("Dietary preferences: None" / "specified"). The
options list and extras list forms' names sections still leave a blank name out (`namesLine`).
_(2026-10-04: no longer — W77 shows the name each blank one falls back to.)_
Whether the Pricing fold should also name an empty base price or VAT is a question for the owner.

**An Add course button beside the course dropdown (A212) — DONE (#1087).** The owner:
_"perhaps we should add an "Add course" button under Courses, which would open a modal to edit
and order the course list. Currently this lives on the kitchen page, not as a modal. need to
figure that out"_. The course list is edited, added to and reordered on Venue settings' Kitchen tab
(`apps/dashboard/src/screens/kitchen-screen.ts`, its "Kitchen courses" section). **To decide:**
whether the dialog reuses that screen's editor (moved into a widget both use) or the course list
moves into the dialog alone and the Kitchen tab opens it too; and what the dropdown does when
the dialog closes — select a course just added, keep the choice if it still exists. Unsaved edits
to the product must survive the dialog, as they do around Add unit today (`related()`).
**Decided (owner, 2026-10-02, choosing B of three):** the course dropdown ends with "Edit
courses…", drawn like A218's make-new choices, which opens a window holding the whole course list:
drag to reorder, click a name to rename it, ⋮ to remove one (today's deactivate), and Add course
at the bottom. Venue settings' Kitchen tab shows the same list, replacing its one-card-per-course layout
with its own Save buttons and typed-in order numbers — so the list is one widget both use.
Closing the window selects a course just added, and the product's unsaved edits survive it.
Built: one widget, `dashboard-course-list` (`apps/dashboard/src/widgets/course-list.ts`), on
Venue settings' Kitchen tab and in the window the product editor's "Edit courses…" opens (from
`catalogue-screen.ts`). Each change saves as it is made, so the window has one button, Done, where
the mockup drew Cancel and Done; Done waits for saves still being answered and for an open Delete confirmation to be answered,
including changes made while it waits (a second Done during the wait does nothing), and stays open with the reason under
the field when a typed name is refused. A drag is saved in one request,
`PUT /management-api/courses/:id/position` (`moveCourse`, `apps/server/src/kitchen.ts`), which
renumbers the active courses. A new course is created after the last one shown, where the old form
created it at order 0. Closing the window selects the last course added in it if it is still there;
otherwise a chosen course removed in the window is cleared (on a variant: the parent's course);
otherwise the choice stays.
**Left open:** a disabled course keeps its name, because `kitchen_courses_name_key` covers disabled
rows too, so adding a course with a disabled course's name is refused as taken (measured
2026-10-03 with a throwaway case in `apps/server/src/kitchen.test.ts`: create "Mains", deactivate
it, create "Mains" again → `course.name_taken`); a deleted course frees its name (read, not run). Raised in #1087's review and not changed there:
`wt-combobox`'s `stable-width` attribute (`packages/ui/src/components/wt-combobox.ts`) is not in
`docs/developers/design-system.md`; and the catalogue-screen test "ignores the closed window's late
close…" catches its guard's removal only through an unhandled error, because the late close throws
before it changes anything a state assertion could see. #1087 also fixed two cases in
`apps/server/src/station-move.test.ts` that failed on every run after 05:00 Madrid on 2026-10-03
(they wrote notices under a clock pinned to 2 October and listed them under the real one).

**Allergens and dietary preferences are edited in place (A213) — DONE (#1079).** The owner:
_"for nutritional info, we can show: Allergens: Nuts, Seeds / Dietary preferences: None specified.
And when you click on one it converts into a multi-value combobox (ie no need for the Edit
button)"_, and _"each one doesn't need a box around it, like we've removed them for descriptors
etc"_. Built: `dashboard-allergen-dietary-picker` draws each field as one borderless line, its
name in bold and then its values or "None specified" (`modifiers.none_specified`, which replaced
`modifiers.none_selected`). The line is a button named "Allergens: Milk, Eggs, edit"
(`modifiers.edit_named`); a click or Enter swaps it for a labelled multiple `wt-combobox` with
focus in it, Escape swaps it back with focus on the line (the second Escape, when the first closed
the open list) without closing the product's window, and focus leaving the combobox swaps it back.
The product picker still offers no "may contain", a stored allergen keeps its presence when another
is added, and a variant's hints of its parent's values are unchanged.
**Left open by #1079 (raised in its review, not changed there):** on a variant's page an empty
line reads "None specified" while the grey hint under it gives the parent's values, which reads as
a contradiction — A211's "an empty value shows the parent's value" is the natural place to settle
it. And on a product's own page a reviewed-empty allergen list and one nobody has reviewed yet
(`allergens: null`) both read "None specified"; before #1079 both read "None selected", so this
predates it (checked against the old code in #1079's review). The variant hint already tells the
two apart ("Not yet reviewed", `editor.allergens_unreviewed`); the product line does not.
(2026-10-03, A211: a variant's closed Nutritional info line now shows the parent's values in
italic, but the open line still reads "None specified" above the hint, so the first point stands;
on a product's own page the closed line reads both cases as "None specified" too, as the open line
does, so the second stands.)

**No box around Pricing (A214) — DONE (#1065).** The owner: _"Pricing also doesn't need the box around it"_.
Built: `renderPrice` draws a borderless `fieldset class="group"` whose legend is the same upper-case
muted group label as Classification and Modifiers, or, once A219 folds it, a `wt-disclosure` headed
like Kitchen. `.bordered-group` had no other user and is gone, with its comment about the variants
table widening the fieldset: the table now sits in its own section.

**Clicking a variant's row opens its edit window (A215) — DONE (#1049).** The owner: _"variants when
clicked should open the edit modal"_. In `variant-table.ts` a click anywhere on a row, or Enter on
it, does what Edit in the row's menu does (`wt-edit`): a transparent button the size of the row
lies over its name, price and badges, named "Edit: <variant>" and disabled while the product saves
or another of the editor's windows is open. The drag handle, the Available switch and the row menu
are lifted above it and keep their own clicks. Left open from its review: a click exactly on the
Available switch's round knob does not flip it — the run-it reviewer reported the same on `main`
before the branch, so it is in the shared `wt-switch`, not the row; DONE by W76 (#1218; the knob now flips
the switch; tested on the switch itself, not in this table).

**The price's unit button says "Each" or "per kg", never "per Each" (A216) — DONE (#1057).** The owner:
_"I don't like "per Each", it should either be "Each" or "per Unit""_. **Decided (owner,
2026-10-02):** "Each" with no unit, "per <unit>" with one. Built: with no unit the price
field's button says "Each" ("Unidad") and its label "Price" ("Precio"), or "Base price" ("Precio
base", the new `editor.base_price`) while a variant is Active; with a unit, "per kg" and "Price
per kg" or "Base price per kg" as before. The same holds on a variant's own page; the variant
window, which has no unit button, labels it "Price" (`unitShortLabel` and `renderPrice` in
`apps/dashboard/src/widgets/product-editor.ts`, `editor.price` in
`apps/dashboard/src/i18n/strings.ts`). _2026-10-03 (A222): on a variant's own page that text is
fixed, not a button._

**The variants' status filter becomes a "Show inactive" link (A217) — DONE (#1065).** The owner:
_"the Variant status filter looks a bit messy where it is placed"_. The "Show variants" dropdown
(`variant-status`, `variant-table.ts`) stood alone between the base price and the table. Offer
mockups: for example in the table's header row, beside the Add variant button, or shown only once
some variant is inactive. Keep its rule that a reported problem or a variant just added never sits
on a hidden row.
**Decided (owner, 2026-10-02):** the "Show variants" dropdown goes. A "Show 1 inactive" link sits
beside Add variant, there only while some variant is Inactive (Remove in a row's menu makes a
saved variant Inactive; Restore brings it back, and this link is the only way to reach it). The
wording is "inactive", to match the rest of the dashboard (owner).
Built: "Show 1 inactive" / "Show 2 inactive" ("Mostrar 1 inactiva" / "Mostrar 2 inactivas"), a
link-styled button after Add variant; once chosen it reads "Hide inactive" ("Ocultar inactivas")
and hides them again. Each product opens with them hidden. The table still shows them itself when a
reported problem or a just-added unsaved variant would sit on a hidden row, and the link then reads
"Hide inactive". A Remove that leaves no row on screen puts focus on the link.

**"New extras list…" and "New options list…" leave the modifier dropdown's list (A218) — DONE
(#1082).** The owner: _"i don't like the new extras list and new options list in the
modifiers dropdown. how else could we organise those? at the very least they should be at the end
of the list, separated from the others with a line. could we make it a single "add new
modifier"? although then we'd need a second click to choose which, or to open a modal with two
tabs or something"_. Before A218 the two actions (`editor.create_extra_list`,
`editor.create_option_list`) were the first two choices in "Add extras or options", above the
lists themselves. **The minimum:** they move to the end, after a dividing line, which
`wt-combobox` cannot draw today (it has group headings, no divider). Mock up the alternatives for
the owner: that minimum; one "New modifier…" choice opening a window with Extras and Options
tabs; and a "New modifier" button beside the dropdown instead of inside it.
**Decided (owner, 2026-10-02, choosing A of three):** the lists sit under "Extras" and "Options"
group headings (`wt-combobox`'s existing `group`), and each group ends with its own make-new
choice, "+ New extras list…" and "+ New options list…", drawn in the primary blue so it does not
read as a list. No divider is needed.
Built: "Add extras or options" lists the extras lists under an "Extras" heading and the options
lists under "Options", each group ending with its make-new choice, drawn with a plus icon in the
primary blue. A group whose lists are all attached, or that has none, still shows its heading and
its make-new choice. The blue comes from a new opt-in on `wt-combobox` options, `primary`, which
paints the row in a new token, `--wt-color-primary-text`: the primary colour itself was too faint
on a hovered row in the light theme for axe (4.32:1). **Open:** each list still reads "Extra bread
· Extras", and under its heading the " · Extras" is now said twice; with three lists the dropdown
already scrolls, so "+ New options list…" sits at or just below its bottom edge when it opens; and
`--wt-color-primary-text` has fixed light and dark values that do not follow `--wt-color-primary`,
and a tenant theme cannot set it (`THEMEABLE_TOKENS`, `packages/layouts/src/theme.ts`) — no screen applies a stored
tenant theme yet. _2026-10-04 (W66): the price heading now holds a button that opens the Pricing
unit dialog, where Add unit is a button._

**With variants, Pricing folds and Variants becomes its own section (A219) — DONE (#1065).**
The owner: _"when we have variants the vat and base price and status filter are overwhelming.
they overshadow the variants, which are the interesting bits. perhaps they should be collapsed?"_.
Once a product has an active variant, the base price is the price each variant falls back to
(the label switches to `editor.base_price`, or `editor.base_price_unit` with a unit), and VAT and
the base price filled the top of the Pricing section above the table. **Wanted:** with variants, VAT
and the base price fold into one line above the table, in A211's pattern (e.g. "**VAT:** Reduced
(10%) · **Base price:** €38.00 each"), opened by a click; the variants table and Add variant are
what the section shows. Without variants nothing changes: VAT and the price stay open, since they
ARE the product's price. The status filter is A217's question; mock up both together. A VAT or
base-price error must open the fold, as an error in a folded section does today
(`SECTION_FIELDS`), and a new product with variants but no VAT yet starts with the fold open.
**Decided (owner, 2026-10-02, choosing A of a second round):** the price comes before VAT,
everywhere. Once a product has a variant, the whole Pricing section folds like Kitchen or
Descriptors — heading and arrow, then a muted line "**Base price:** €38.00 per kg · **VAT:**
Reduced (10%)" — not as a grey box, which reads as a field (the owner). The variants move to
their own section, "Variants", below it and always open, ending with Add variant and A217's link.
Without variants, Pricing stays open as today and Variants is just the Add variant button.
**Built as decided (#1065)**, with these readings: Pricing folds only while some variant is
Active (the same rule that switches the label to "Base price"); the link toggles back as "Hide
inactive" / "Ocultar inactivas"; the fold starts open only on a product never saved. **Open:** in
Spanish the folded line reads "**IVA:** Reduced (10%)". The VAT class name is the stored label,
which `taxLabel` shows untranslated, and on `main` before #1065 the VAT dropdown already read it
the same way. Where those labels come from, and whether they should be translated, is not checked.
Built: the fold follows the base-price label, so it needs an ACTIVE variant; with only Inactive
ones the price is the product's own and Pricing stays open. The bold names come from a new
`summaryFields` property on `wt-disclosure` (A200 asked for a way to pass name and value pairs). A
blank base price is left off the line; with no unit the price reads "€38.00 each" ("38,00 € la
unidad"). "No VAT yet" was read as a product never saved, and its fold starts open: a product's
save refuses a missing VAT class (`vatClass` in `packages/catalogue/src/product-editor-input.ts`),
and a new product's draft starts on General. A VAT, unit or price error opens the fold
(`SECTION_FIELDS`).

**Product editor section spacing (W67) — DONE.** Consecutive closed detail sections sit closer
together, while Modifiers has more room below Add variant. The open sections and other forms keep
their spacing.

**Disclosure opening and closing motion (W68) — DONE.** Shared disclosure sections move their body
and following content over about a second. Reduced-motion preferences and validation errors reveal
fields immediately; repeated clicks reverse the motion from its current height.

**The pricing unit is chosen in a dialog (W66, owner 2026-10-04) — DONE (#1188).** The owner, on Product
editor screenshots: _"the unit selector should open in a modal, it's not obvious that the field gets
added after clicking the 'per g' button, also there is no way to dismiss it like you would have in a
modal"_. The price field's unit button, and on a product with variants the unit button in the
variants table's Price heading, open one Pricing unit dialog holding the unit dropdown and Add unit.
Close and Escape shut it without changing the unit, choosing a unit shuts it, and focus goes back to
the button that opened it. A refused unit opens it once, and the refusal stays on the price field
once it is shut. Detail: design-system.md, the `wt-price-input` note under the product editor.
Left open by #1188's review, none started: (1) one kind of unit refusal reads "The server rejected
this value…", and on the price field after a price message "this value" reads as the price — a
unit-specific sentence needs the owner's wording; (2) the price field's own unit button does not
announce that it opens a dialog (`aria-haspopup`), while the heading's button does — needs an option on
the shared `wt-price-input`; (3) `EACH_CHOICE` is still exported from `variant-table.ts` though only
the product editor uses it; (4) the test title "…when the table's heading dropdown is hidden" still
says dropdown for what is now a button; (5) the product editor's VAT dropdown is not disabled while
saving (same on `main` before W66, not checked further).

**Modals come in three sizes chosen for their content (W70, owner 2026-10-04) — DONE (#1222).**
The owner, on the Product editor: _"the modal is too wide for these forms. we need modals of different
sizes for different display purposes"_. `wt-modal` takes `size="compact"` (28rem, 448px: a
confirmation, or one or two short fields), `"standard"` (42rem, 672px: an ordinary editor, the Product
editor among them) or `"wide"` (64rem, 1024px: a table wider than a form, an image grid, a photo
beside its uses). On a phone every size fills the screen less its side margins, as before. Every
modal on the dashboard, the till's modifier picker and the two demo modals now name a size; a modal
that serves jobs of clearly different sizes picks one per job (the profile's details and
authenticator setup are standard, its other steps compact). Leaving the size off still gives the wide
modal, as before. W66's Pricing unit
chooser stays a small dialog (`wt-dialog`), held to the compact width. Detail: design-system.md,
the `wt-modal` entry. W70a — DONE (#1265; owner, 2026-10-05,
"compact only") — makes compact modals fit their content up to the screen's height, with the body
scrolling beyond it and footer actions held in view. Standard and wide modals retain their full
height. The category delete dialog is standard and retains its empty space; W74's height finding
therefore remains open. Left open: in the wide Extras editor at 1280px wide, the items table scrolls
sideways by 4px (978px of content in a 974px box), with or without the size attribute.

W70a's visual probe copied `catalogue-screen.a11y.test.ts`'s fixture and found that its product
confirmation stayed closed: the fixture supplies no `listMadeAt`, which `#reloadProducts` awaits
before loading products. Adding that method to the temporary probe and waiting for the product
read opens the confirmation. Follow-up: complete that accessibility fixture and assert the native
dialog is open before its scan. The existing suite was not changed by W70a.

**Warn before discarding unsaved changes (W69, owner 2026-10-04) — IN PROGRESS.**
The [design](superpowers/specs/2026-10-05-unsaved-changes-warning-design.md),
[owner audit](superpowers/plans/2026-10-05-unsaved-changes-audit.md) and
[implementation plan](superpowers/plans/2026-10-05-unsaved-changes-warning.md) cover editable
modals and pages across the dashboard, till, setup and contributed screens. Build the shared
mechanism and modal rollout, then page/navigation coverage; neither rollout is implemented yet.
Keep automatic saves and forced session exits on their existing paths.

**The kitchen and customer name fields show the staff name as their hint (A220, owner 2026-10-02)
— DONE (#1069, and #1073 for a variant's own description, A220b).** The owner: _"the Kitchen name, and
customer facing names aren't showing the internal name as the default value, at least when I add a variant and fill in
the internal name the first time"_. A172 built the name hints (kitchen and customer-facing names, in
all five editors, on a new variant and an existing one). This item added the description hints: in
the product editor, a blank description in a language other than the venue's default shows the
default-language description as its grey hint, following it as it is typed; on a variant's page
still blank in every language, a language the parent left blank shows the parent's default-language
description (`defaultLanguageHint`, `apps/dashboard/src/widgets/form-fields.ts`). The variant window
(`variant-form.ts`) has no description fields.
**What a description reader shows — checked by running, 2026-10-02.** A throwaway catalogue test
built a product described only in Spanish (the default), a variant with its own Spanish description
and a variant with none, then read them through `listProducts`'s effective read, the product
editor's read, the published menu (`buildMenuDocument`) and the live offers the till receives
(`applyLiveFields`). Nothing fills a missing language anywhere: (a) the product carries `{ es: … }`
only; (b) the described variant's effective description is its own `{ es: … }`, not the parent's;
(c) the bare variant's effective description is the parent's map. The published menu and the till's
offers carry only the dish's own description and NO variant description at all, and nothing outside
the product editor shows a product description today — no till screen, receipt, ticket or menu.
This command printed nothing:
`grep -rn "\.description\b\|description:" apps/till/src apps/server/src --include='*.ts' | grep -v '\.test\.ts'`
(a control over `apps/dashboard/src` printed 30 lines). The wider `grep -rln description` hits in
those folders, read one by one, include no product description (they are names of lines, options,
sections, products and units, a location's operation description, and comments); under
`packages/*/src` the first command's only product-description hits are in `packages/catalogue` and
the column's declaration in `packages/db`. So the hint and the reader disagree in one way: the hint
shows the default-language description in another language, while every reader carries nothing
there — there is no printed menu text to match yet.
Precedence on a variant with both: its own description wins, as (b) showed, and wins as one value
across every language (the coalesce of the whole column in `effectiveProductColumns.description`,
`packages/catalogue/src/variant-fallback.ts`, read, not run with a parent in a second language).
**Decided (owner, 2026-10-02):** a customer-name field in another language shows the
default-language name as its hint, _"which is what we'd show on the menu anyway if it is missing"_
(the owner's account of the menu; check it against the reader before relying on it). The kitchen
name shows its hint too: the staff name, which is what `kitchenPresentationName` prints. A
description field in a secondary language shows the default-language description as its hint.
**Decided (owner, 2026-10-03, A220b):** on a variant's page whose own description has text, a
blank language other than the default shows the variant's own default-language description as its
hint, where there is one, as a product's does; the parent's description is a hint only while the
variant describes itself in no language.

**Variants in the Products list look like part of their product (A221, owner 2026-10-02) — DONE (#1081).**
The owner, on a screenshot of an opened "Cured pork loin" with its variant "More pork": _"it is
there, but it doesn't look very good"_ — a heavy black triangle far to the left, the variant's name
starting left of its product's in the same bold, and its row repeating "Made at" and filling the
rest with "—". **Built (mockup B):** a small, muted arrow; "2 variants" in muted text under a
product's name; opened variants on a `--wt-color-bg` band, lined up under the product's name, showing
price, status, row menu and a main category only where it differs from the product's. `wt-data-table`
gained `rowJoinsParent` and a `tree-toggle` part. _2026-10-03 (A209): a variant's category is now
always its product's, so a variant's row leaves that cell empty._ _2026-10-04 (W84): the Main
category column is gone._
**Also check:** tried in the list widget on a test variant, not the owner's data: the arrow showed
under a search, an ordering filter, for an Unavailable variant and for one with its own main
category; it was missing only for a variant saved Inactive and for a product with no variant.
`listProducts` lists Inactive and other-category variants
(`packages/catalogue/src/variant-fallback.test.ts`, run). Read, not run: Cancel closes the product
editor with no prompt, so a variant added and not saved is lost silently — the likeliest cause; ask
the owner if it recurs.

**A variant always has its product's unit (A222, owner 2026-10-02) — DONE (#1101).**
The owner: _"currently variants can have different units from their parents. i think that's a bad idea"_.
A variant's page offers its own unit today (`renderUnit` in `product-editor.ts`, whose blank
choice is the parent's unit). **Wanted:** a variant takes its product's unit and cannot set one; the
field goes from the variant's page and the variant window, the server refuses or ignores a
variant's unit, and variants holding a unit of their own are cleared (allowed before go-live,
§3). (2026-10-03: not cleared — the owner chose no clearing migration; see "Left open" below.) The unit decides
how a line's quantity and price are worked out, which reaches a sale
record, so this takes the full review path (risk trigger: fiscal invariants); trace every reader
of a variant's `unitId` first. A203 (extras as a fixed portion) allows for a variant's own unit
("or a parent's, which its variants without their own inherit") and gets simpler. The owner also
noted the Products list shows no unit in its price column; A208 builds it ("€19.00 each",
"€48.00 / kg").
Built: the server reads a variant's unit as its product's (`unitOwnerJoin` and
`effectiveProductColumns.pricingUnit`, `packages/catalogue/src/variant-fallback.ts`), so a menu's
next publish, and the sales made from it, use the product's unit. A variant's editor save naming a
unit is refused with `product.invalid` (field `unitId`) and otherwise deletes one the variant
stores; the editor's read gives a variant no unit; and the variant's page shows the product's unit
beside the price as fixed text, with no unit button or dropdown. Unit management ignores a unit row
a variant still stores, and deleting a unit deletes such rows. The variant window already offered
no unit.
**Left open:**
- No migration clears the unit rows variants already store: the owner chose this on 2026-10-03,
  as for A209's categories (no data-migration code before go-live, CLAUDE.md §3). The product, menu and unit
  reads ignore such a row, and the next save of the variant's own page, or its unit's deletion,
  removes it.
- A menu published before this keeps a variant's own unit, frozen in its published copy, until the
  menu is next published (`applyLiveFields`, `packages/catalogue/src/menu-document.ts`, serves that
  copy; read, not run).
- A configuration import still copies `product_units` rows as they are
  (`packages/catalogue/src/configuration-transfer.ts`), so an imported variant can arrive with a
  unit row, which those reads then ignore.

**An extras list's product dropdown greys a product with variants and says why (A223, owner
2026-10-02) — DONE (#1098).** Before this, the dropdown (`extra-list-form.ts`, `#itemsSection`) offered every
top-level product, but saving a list that names one with an Active variant is refused with
`extras.product_has_variants` (`assertNoParentsWithVariants`, `packages/catalogue/src/extras.ts`),
because the till never offers such a product as an extra (`readExtraProducts`,
`packages/catalogue/src/offered-modifiers.ts`). Read, not run. The owner declined offering the
variants themselves as choices. **Wanted:** such a product is left out of the dropdown, or shown
greyed and unpickable. **Decided (owner, 2026-10-02):** greyed, with A210's second line saying
why ("Has variants, so it can't be an extra"; Spanish to match), so a search for it does not just
come up empty. That needs `wt-combobox` to draw a disabled option, which it could not before A223. **Also:** a
product already on a list that later gains its first Active variant is silently dropped by the
till; the list form should mark that row.
**Run before building:** the existing cases pin both refusals and the till's omission, and pass:
"an extras list and products with variants" in `packages/catalogue/src/extras.test.ts` (an Active
variant counts whether Available or not; a product whose only variant is Inactive is accepted),
"an extra that is a parent with Active variants" in `offered-modifiers.test.ts`, and the two
"mountCatalogueApi — extras lists and products with variants" cases in
`apps/server/src/catalogue-api.test.ts`. The "Also" state is refused too: giving a listed product
an Active variant, from the parent's editor or by making a variant Active, answers
`product.offered_as_extra` (#578; "a product an extras list offers" in
`packages/catalogue/src/product-editor.test.ts` and the second of those server cases). Reading
every write of `products` outside tests found no other path that sets a parent or makes a row
Active, so the row mark is for rows written some other way (as the tests above write them).
Built: `ComboboxOption` gained `disabled`: marked `aria-disabled="true"`, label and icon in
`--wt-color-text-muted` (a primary row too), no hover background, still matched by the search and
reached by the arrows (the WAI-ARIA practice for a listbox's disabled options), but never chosen by
a click, Enter or Space, nor by type-ahead on the closed trigger. The extras picker offers a product with an Active
variant that way, with "Has variants, so it can't be an extra" ("Tiene variantes, así que no puede
ser un extra") as its second line. A listed row whose product has an Active variant says the same
under its name, plus "Remove it from this list." ("Quítalo de esta lista."), from the moment the
form opens; a save is refused in the form, beside that row and in the bottom message, with Save
disabled until the row is removed. Axe scores no contrast inside an `aria-disabled` row (measured:
a disabled row painted in the panel's own colour passed every axe case), so the combobox's a11y
cases measure the greyed label and second line against the panel themselves, 4.5:1 in both themes.
Seen, not changed: at 390px the items table is wider than its scrolling box with or without the
mark (scroll width 496 in a 356 box), and the mark wraps in the narrow product column, so a marked
row is about twice as tall as its neighbours.

**Form fields after A178 (#1010 to #1019).** Done: A178g (#1021), a stepper's box widens to fit its
label, and in a row too narrow for it narrows again, never below `--wt-stepper-field-width`, and
cuts the label. Done: A178h (#1023), "Each" on a product and in the variants table's unit heading is drawn as
a chosen value rather than the grey prompt (the dropdown gives it the stand-in value `__each__`, and
a save still stores no unit); a variant's "Same as …" keeps the grey look (since A172, #1053, 2026-10-02: the parent's
value itself, still grey). **Seen while building,
not changed:**

- on a product of its own, the main category's "Uncategorised" and the course's "No course"
  choices still have the empty value, so the shared dropdown draws them as the grey prompt when
  chosen, as Each was; the owner's answer on A178c (2026-10-02) asked for the stand-in for Each
  alone. A193 (2026-10-03) later gave those choices the selected-value look while retaining their
  empty values;
- a blank "Time of day" on the backup screen sends `{ hour: 0, minute: NaN }` — the same parsing is
  on `main` before A178b (`#buildSchedule`'s `split(":")`); what the server does with it was not
  checked;
- once other fields in a purchase line show errors, its VAT-kind dropdown sits lower than its
  neighbours (`.line { align-items: flex-end }` in `purchase-form.ts`);
- setup's recovery kit lost `autocomplete="off"`, which `wt-textarea` does not offer;
- the till's fallback unit for a product with no `unit` (`productUnit`,
  `apps/till/src/widgets/product-name.ts`) names itself in English only, so a Spanish till drawing
  such a product shows the unit's id — seen only with test products; whether the server ever sends
  a product without a unit was not checked;
- **for the owner:** the two dropdown explanations on venue service's Kitchen panel in Venue
  settings ("Applies to new kitchen tickets and to reprints." and the release reminder's) are now each dropdown's `hint`,
  which a field that always holds a value never shows, so only screen readers read them while the
  two switches beside them keep visible lines.

Seen in A178g's LOOK, not changed and not checked against `main` before it (screenshots kept
outside the repository): at 390px the extras list form's item table runs past the dialog's edge,
its headings cut ("Preselecc…"); and the venue operations "Make available" dialog draws its
"Default" checkbox as a large plain square.

**Text size after A179 (#988).** The scale is 12 / 14 / 18 / 22px (sm / md / lg / xl) in the
system font, for the dashboard, setup and the till (owner: _"yes for now, then we can revisit
later"_). Open: page headings follow the Typography roles table in
`docs/developers/design-system.md` (a page title at `--wt-font-size-xl`) only in part — setup's and
some dashboard screens' headings (the content languages screen's, for one) take the browser's own
`<h1>` size, 28px; approvals and email set theirs to `--wt-font-size-lg`; menus and modifiers to
`--wt-font-size-xl`. Left alone on purpose, sized in `rem`: the till's enrolment number and setup's
cloud-recovery code (the done screen's break-glass heading and code moved to `--wt-font-size-lg` in
W34, A244). **Phone check, the
owner's to do (2026-10-01: "i'll test phones later on"):** Safari on iPhone is widely reported to
zoom the page in when a field whose text is under 16px is focused — not yet tried here. If it does,
the usual remedy is to keep field text at 16px on small screens only.

**Build order for the owner's 2026-10-01 items (owner: "yes, all good"):** A178, A175 (#1029),
A169 (#1026), A176 (#1033), A177 (#1037), A170 (#1040), A171 (#1044) and A172 (#1053) are done,
A172 built in the new style rather than restyled twice.

**Dragging a row (A180, #994 and #1003) — two things seen, left as they were.** A lifted row in a
reorder list (`ReorderController`, `apps/dashboard/src/widgets/reorder-table.ts`) shows a faint line
at each cell boundary, most visible in the dark theme, and a row lifted at the bottom of its list
has its shadow cut off where the table ends. Whether A180's lifting (`position: relative`,
`z-index: 1`) contributes is not known; the likely cause, not checked, is the sideways-scroll
wrapper each list puts round its table (`.table-wrap`, or `.wrap` in the variant table;
`overflow-x: auto`). The canvas editor's tile drag stays as it is (owner choice, 2026-10-01); A182
plans to retire the editor.

**Variants as products (#511–#556) — what is left open.** How the model works is in
[products.md](developers/products.md), under _Variants_.

- **Reopening a held order still removes a sold-out extra on the first edit.** The owner chose
  option A on 2026-09-23 (lane B question Q1): keep a sold-out line in held work, flag it on the
  till, and refuse only a quantity increase. The till now keeps such a line marked "Not offered
  now"; a line with no stored snapshot whose product the till no longer offers is still dropped with
  `held.product_gone`, and the first edit of the order removes such an extra.
- **Raising a held line's quantity checks the line's variant and its menu — DONE (#696).** Found
  stale on 2026-10-05 by W90: since #696 a raise is priced again with the line's menu item and
  variant (`applyLineEdits`, `apps/server/src/working-order.ts`), and a throwaway test (not kept)
  saw a raise refused `product.variant_unavailable` once the variant was sold out, and
  `service_zone.offer_not_allowed` once its menu was made inactive. Since W90 a menu has no switch
  of its own to check. No kept test pins the refusal of a raise for an Unavailable size or an
  inactive menu.
- **A menu offer created with no price field at all is refused** (`management.request_invalid`);
  only an explicit `null` means "blank, charge the product's own price" — **decided 2026-09-23 by
  the owner:** _"we don't want to confuse 0.00 with `""`"_.
- **From #541's review, neither blocking:** the product list shows a variant's blank price as its
  parent's with no marking (`apps/dashboard/src/widgets/product-list.ts`) — whether to grey it is
  the owner's call; and the rule that hides screen-reader text is copied into each widget that
  needs it (`grep -rln "clip: rect(0, 0, 0, 0)"`), where a shared one in
  `packages/ui-core/src/base-styles.ts` would be an optional tidy-up.
- **A held order brought back to the till shows a variant line with its PARENT's VAT class,
  category and allergens**, read from the offer snapshot in `working_line_contexts`. Filing is
  unaffected. **Next action:** save or read the chosen variant's values for a retrieved line.
- **Review suggestions on the product editor not taken (Task 6):** split the editor's types into a
  product shape and a variant shape, derive `InheritedValues` from the product type, and write a
  parent's variant republishes in one statement. Nothing waits on them.
- **The product list.** It leaves a variant's allergen cell empty (`ListedVariant`,
  `packages/catalogue/src/product-types.ts`) — decide whether it should read a variant's effective
  allergens; a variant's name may sit a few pixels low in its row at 390px, not yet looked at;
  `listedVariantsOfProducts` (`packages/catalogue/src/operations.ts`) repeats the grouping
  `variantsOfProducts` (`packages/catalogue/src/variants.ts`) does — share one helper.
- **A variant image usage's `productId` has no reader in the dashboard**
  (`packages/media/src/dashboard/client.ts`). **Next action:** drop the field, or say what it is
  kept for.
- **The overview's top-sellers table can reach into its card's padding at desktop width** when a
  variant has a long one-word name and the figures run to five digits (12px into the 17px padding,
  measured 2026-09-24 at 1280px). **Next action:** decide whether a long name there may wrap
  mid-word.
- **Retrieving a held order reads the counter's CURRENT zone offer, not the zone the order was
  parked in** (`#onRetrieveOrder`, `apps/till/src/till-app.ts`; `HeldOrder` carries no zone), so it
  can mark lines "Not offered now" when their own zone still offers them. Traced, not run. **Next
  action:** send the order's zone with the retrieved order and read that zone's offer.
- **A label typed when re-holding an unedited retrieved order is never saved**, because re-holding
  saves only through `#syncIfDirty` (`apps/till/src/till-app.ts`), and a label change does not count
  as a line edit. **Next action:** a way to save a label without re-sending the lines.
- **The extras form cannot pick a variant**, though the catalogue accepts one as an extras item
  (owner decision 2026-09-24): its picker lists top-level products only (`listProducts`). **Next
  action:** decide whether the picker should list variants.
- **A configuration transfer copies `extra_list_items` as a table**, so it does not ask
  `extras.product_has_variants`; a venue holding data written before #578 would carry such an item
  across. Read, not run; nothing unless transfers from older venues matter.
- **The two `till-sale.test.ts` cases named "…gained an Active variant" pass with the variant left
  Inactive.** **Next action:** give each an assertion that fails when the variant is Inactive, or
  rename them to what they prove.

**A sale needs a zone (lane B's B4, #571) — what is left open.** Every sale line is priced from the
menu offers of its order's service zone; a sale with no `zoneId` takes the venue's counter-default
zone, and a venue with none is refused `service_zone.default_missing`.

- **`GET /api/products` has no caller in the till app, and `listAvailableProducts` is off the sale
  path.** `TillApi.listProducts` (`apps/till/src/api/client.ts`) is kept because the till's tests
  stub it; outside tests `listAvailableProducts` is called by that route and two dev scripts. **Next
  action:** decide whether to retire the route and move the till's tests onto zone-offer fixtures.
- **A location's menu list is read by no sale.** The location's list (`locations.catalogue_id`
  plus `location_catalogues`) is still read and written by `GET /api/products`, the management API's
  location routes (`apps/server/src/catalogue-api.ts`; no dashboard screen calls them since #297),
  configuration transfer, both provisioning seeds, two dev scripts and the `offerProducts` test
  helper. **Next action:** owner to decide whether to retire `location_catalogues` and those routes
  with `GET /api/products`.
- **A table in no zone still opens a tab, and nothing can be added to it** (`seatTable`, and
  `seatBooking` in `packages/bookings/src/bookings.ts`); every round is refused
  `order.service_context_missing` (pinned in `apps/server/src/till-api.zone-required.test.ts`).
  **Next action:** owner to decide whether to refuse opening a tab on a table in no zone, or to
  require every table to have a zone.
- **Two branches still read a held line that names no menu offer**, which only an order parked
  before B4 should have: `getHeldOrder` (`apps/server/src/working-order.ts`) and the till's retrieve
  (`liveByProduct` in `#onRetrieveOrder`). **Next action:** delete both, since no
  backwards-compatibility code is owed before production (CLAUDE.md §3), or say what keeps them.

**Units and the old `pricing_unit` (#342, #375, #382) — what is left open.**

- **Two signals say whether a dish is sold by weight, and they can disagree in storage.** Since B4
  the order path reads only the unit (`priceOrderLines`), so no sale reads `products.pricing_unit`;
  `assignProductUnit` writes `product_units` without touching it, and reassigning a unit's products
  to another real unit does not update it either. The column is still written, derived from whether
  the unit has a scale mapping, which is lossy: a product sold by the litre records `each`. **Next
  action:** keep it in step with the unit or drop it; its removal is listed under the #297
  departments-and-menus row in A9, and whoever does it also cleans up the demo scripts and tests
  that use `pricingUnit` to pick a product.
- **`createProduct` and `updateProduct` duplicate the legacy-`pricingUnit` fallback**, and the
  synthetic `EACH_UNIT` id is a literal in both `packages/catalogue/src/unit-validation.ts` and the
  till's `product-name.ts` with nothing pinning them equal. Since W75 (2026-10-04) `EACH_UNIT_ID`
  lives in that module, which the till already imports (`apps/till/src/state/working-order.ts`), so
  the till could import it instead of keeping its own literal.
- **Only kilograms, grams and milligrams can ever come from a scale** — a fixed list enforced by a
  database check, separate from the editable name. A unit you invent, and the volume units, are
  typed, never weighed. Intended, not an oversight.

**The product editor and catalogue (#345, #379, #387) — what is left open.**
[Operator guide](products.md); [developer guide](developers/products.md).

- **"No tax (0%)" is an open fiscal question, and it must be answered before the first live
  filing.** The selector shows the catalogue's zero-rate class under that name; pricing puts the
  whole gross in the base with zero VAT, and Veri\*Factu files it as `S1` — taxable, not exempt — at
  a 0.00 rate. AEAT separately requires a *non-subject* operation to record its cause (`N1`,
  Articles 7, 14 and others; `N2`, place-of-supply rules), and nothing established that any of this
  venue's products is legally non-subject. Asesor question Q20 asks which intended cases belong in
  `S1` and which need `N1` or `N2`, and whether the label should read "IVA 0%" rather than "Sin
  impuestos". **Non-blocking while pre-production; blocking before going live.** If the answer moves
  a case to `N1`/`N2`, that is an explicit classification threaded through sale facts, reporting and
  every Veri\*Factu sale, correction and substitution path — never a quiet redefinition of `zero`.
- **Recipe authoring is gone from the dashboard, and nothing replaces it as a surface.** The parked
  recipe depth work (nested sub-recipes, plate costing, stock depletion) assumes an authoring
  surface that no longer exists. **Next action:** whoever reopens recipe depth decides first whether
  recipe authoring returns as its own surface.
- **The combined end-to-end journey has not been walked**: creating a unit, a category and the
  extras and options a product carries from inside a dirty product draft, through the actual routes
  against a real database, and taking the result through the till. **Next action:** walk it once on
  a dev stack.
- **The catalogue picker was deleted and nothing replaced it.** `selectedCatalogueId`
  (`catalogue-screen.ts`) takes the first catalogue in the list, which is also the one every new
  product is created in; with two, the second becomes unreachable from the dashboard. **Next
  action:** decide whether more than one catalogue is a case Waitron supports.
- **There is no permanent delete** for a product that was never sold and was created by mistake.
  **Next action:** decide whether that is worth a second, differently-worded action.
- **A product's name can be stored blank.** `products.name` is `NOT NULL` with no non-empty check,
  and only the editor's parser refuses a blank; `option_lists.name`, `option_labels.name` and
  `extra_lists.name` share the pattern (`packages/catalogue/drizzle/0000_baseline.sql`). **Next
  action:** decide whether the columns want a check constraint and the write paths a domain refusal.
- **A refused customer name cannot say which value it refused.** `content.translation_required`
  carries only the language, so the editor resolves the field from the body it submitted — exact for
  one missing value, the first of several otherwise. An owner call if it ever bites.
- **Smaller things #379 surfaced and did not take.** The kitchen screens show a kitchen-resolved
  dish name above modifier text resolved in the device's own locale. A joined customer-facing line
  can mix languages when a locale exists on one half only. `wt-price-input` was built from scratch
  rather than on `wt-input`'s end slot. `modifier-limits.ts` holds a product rule as well as modifier
  ones. And five interface faults seen then: the products list heads its Name column "Description",
  the wordmark is near-invisible in the dark theme (fixed since, A225), "Top sellers" is rendered
  twice on the overview, the login screen shows an error before anything is submitted, and the
  recipe screen is not routed from anywhere.

**Allergens and nutrition (#370, #377, #385) — what is left open.**

- **Pass 2 — icons — is not started.** Pass 1 renders allergens and diets as text pills; pass 2
  replaces them with Material Design icons across the dashboard, waiter basket and kitchen/expo
  screens. **Next action:** write the pass-2 spec when the icon work is picked up.
- **The basket's "not fully reviewed" allergen warning depends on whether an option was picked**
  (`#allergenRow`, `apps/till/src/widgets/basket.ts`), a leftover of the old dish-and-extras fold.
  **Next action (owner decision):** whether an unreviewed dish shows that warning always, then make
  `#allergenRow` depend on the review state alone and update the test.
- **"May contain" survives in the data with no way to see or set it.** A product's stored
  allergens carry a `presence` field that can read `may_contain`, and the compact picker cannot
  show or set it; an allergen a manager adds is written as `contains`. Ingredients and the till
  still carry the old contains/may-contain distinction and the reviewed toggle; the old
  `dashboard-allergen-picker`'s one non-test consumer is the ingredient form
  (`apps/dashboard/src/widgets/ingredient-form.ts`). **Next action:** decide whether "may contain"
  stays a real product claim — if it does, the picker needs a control for it; if not, the field and
  its readers go. Decide in the same change whether to show again the dietary labels that follow
  from the ones picked (vegan implies vegetarian), which the old editor showed as "inferred" badges;
  the derivation still runs (`expandDietaryDeclarations`,
  `packages/catalogue/src/dietary-declarations.ts`).
- **The product editor summarises the same values twice.** `renderNutrition`
  (`apps/dashboard/src/widgets/product-editor.ts`) renders a `wt-disclosure` whose `summary` joins
  the allergen and dietary names, and puts `<dashboard-allergen-dietary-picker>` inside it, which
  summarises the same two fields again; the ingredient form renders the older picker expanded.
  **Next action:** whoever adopts the shared picker for ingredients and the till picks ONE shape,
  and decides whether the product editor keeps both summaries.
- **The picker collapses on `focusout` alone** (`#finishEditing`). If the editor is reported
  snapping shut mid-selection, make the collapse depend on `relatedTarget`.

### A1. Checking a fiscal record before it is written — LANDED #331 (2026-09-12)

A record AEAT could not accept is refused at the chain seam before anything is written, and the same
rules reach the setup boundary and the `waitron-provision venue` command.

### A1c. Dead pointers to deleted test suites

Comments across many packages still cite deleted guard suites, from two deletions. The per-package
`errors.reachability.test.ts` suites went on 2026-08-11 (the real guard is
`scripts/errors-reachable.test.ts`); the outbox removal (#280) deleted
`apps/server/src/sync-origin.test.ts` and left comments across the tree describing capture-origin
machinery that no trigger does any more. Fix whenever a file is open anyway; the comment-pruning
sweep (B9 → *Prune the comments*) reaches every package and takes these as it goes. Two grep
hazards: searching `sync-origin.test.ts` finds only the comments that name the file and misses those
that cite it obliquely; and searching "sync origin" also reaches a still-live thing — the mirror's
own `origin_node_id` column (`packages/db/src/schema/mirror-config.ts`), which is outside this item
and must not be swept with it.

### A1a. A foreign business customer needs an identifier-type decision

`recordSale` now names a Spanish recipient on a full invoice. A non-Spanish one is refused by name
(`fiscal.foreign_recipient_unsupported`), deliberately: AEAT's `IDOtro` needs an `IDType` — NIF-IVA,
passport, residence certificate and so on, enumerated in
`@waitron/verifactu`'s AEAT XSD (`SuministroInformacion.xsd`) — and choosing wrongly files a record
into an append-only table that can never be unfiled. Whoever wires up business-customer sales makes
that call. No HTTP route supplies a counterparty today — core's `recordSale` hardcodes `null` and
nothing calls `recordSubstitution` from a route — but `packages/core`'s substitution path types it as
required, so the refusal is one route away, not one feature away.

### A1d. Things the A1 review wave raised and did not fix

- **The audited AEAT package's own shared record fixture (`@waitron/verifactu`'s `ALTA_INPUT`) is
  still a full invoice naming no recipient** — the shape A1 corrected everywhere else. Not free to
  fix: it reproduces AEAT's vector-1 hash and the exact-XML expectations in `xml/serialize.test.ts`
  would all move.
- **`packages/fiscal-verifactu` restates rules the validator owns** — `venue-fields.ts` its venue-field
  patterns and caps, `backend.ts` its simplified-invoice limit — kept honest by drift guards
  (`record-limits.test.ts` compares the limit and the recipient name cap with the validator's verdict).
  Exporting the patterns from the library instead was DEFERRED on purpose (owner, 2026-09-12) — it
  widens an audited fiscal library's public surface and the drift guard already closes the risk.
  Revisit when something else needs those patterns.
- **`apps/till/src/till-app.ts` decides permanent-refusal / known-code / unknown at five call sites;
  a helper would collapse it.** Cosmetic, and cheapest alongside the tip-collection work that touches
  `#onPayTab`.

### A1e. Simplified and full invoices need separate series — OPEN (found 2026-09-29)

RD 1619/2012 art. 7.1.a), last paragraph, requires separate series for simplified and full invoices
issued in the same calendar year (quoted in
[verifactu-findings.md §10.1](compliance/verifactu-findings.md), correction of 2026-09-29).
Waitron's series have two purposes, `standard` and `rectificative`
(`packages/db/src/schema/series.ts`), and both `recordSale` and `recordSubstitution` accept only
`standard`, so an F1 or an F3 would share the F2 tickets' series. It has not happened yet: every
sale files as a simplified invoice (`counterparty: null` in `packages/core/src/record-sale.ts`) and
no route calls `recordSubstitution`. **Next action:** before any route issues an F1 or an F3, add a
series for full invoices (a new purpose, provisioned by the setup wizard beside the ticket and
rectificativa series) and make each path pick its series by invoice type. Fiscal core: owner
sign-off at land. Asesor Q5(d) confirms where the F3 and the R5 go.

### A231. Full invoices at the till — DESIGN FOR OWNER REVIEW (2026-10-03)

A231 proposes an F1 path for bills above €3,000 VAT included and for smaller bills on request,
chosen before invoice issue. The legal basis and dated primary-source excerpts are in the
[design](superpowers/specs/2026-10-03-full-invoices-at-till-design.md). It and the
[implementation plan](superpowers/plans/2026-10-03-full-invoices-at-till.md) cover Spanish recipient
details, A230's tax-ID check-letter validation, a separate full-invoice series (A1e), every issuance
path, receipt-printer delivery, VAT reporting and mixed/split payments. F3 conversion of an already
issued F2, F1's R1–R4 correction path and foreign-recipient `IDOtro`/`IDType` remain separate decisions.
**Next action:** owner reviews the design's B2B delivery, F1 credit/refund limitation
and manual remedy, and asesor questions; approves the scope and medium before a build; and separately
signs off fiscal issuance changes before landing.

### A231d. Full invoices by email as a PDF, and on an office printer — THIRD VERSION FOR OWNER REVIEW (2026-10-03)

The owner asked, approving A231's design, that an F1 can also be emailed to the customer as a PDF and
printed on an ordinary office printer. The [design](superpowers/specs/2026-10-03-invoice-pdf-email-and-office-printing-design.md)
and [plan](superpowers/plans/2026-10-03-invoice-pdf-email-and-office-printing.md) cover the PDF (made
on the server, QR first), email with the customer's express consent from a queue that never makes a
sale wait, office printers kept apart from receipt printers, and resending from the till and the
dashboard. The customer chooses one way to receive the original; anything after it is a «duplicado».

The owner approved the first version's decisions 1–5 (2026-10-03, about 08:45) and changed the
sixth; the amended version builds email and A4 printing together. Any network office printer is
added as an invoice printer through the Printers screen's existing add-printer dialog, and is sent
PDF when it lists PDF, otherwise PWG Raster, otherwise Apple Raster, drawn on the server from the
same layout. No printing standard requires PDF: IPP Everywhere 1.1 requires PWG Raster and only
recommends PDF, and AirPrint and Mopria publish no public list. A live venue sets up its mail server in the
setup wizard's live path, with a test message, and can change it from the dashboard. A venue
preparing to go live sends invoice email through its mail server when one is set, otherwise to the
box's captured inbox; a demo always captures it. Measured 2026-10-03: the owner's HP M181fw takes
PDF and Apple Raster, not PWG Raster.

The owner asked (about 08:55) to weigh Debian's printing system (CUPS) against drawing pages
ourselves, and answered decisions 7–9 (about 10:05). Measured in Debian 13 containers on the owner's
Mac: CUPS, its converters, `ipp-usb` and `cups-browsed` add 52.7 MB (about 50% more) to the print
agent's download and bring Ghostscript (GNU Affero GPL). CUPS converted a PDF for an Apple Raster
printer. Its own driverless setup refused a printer taking only PWG Raster (apparently a mistake in
CUPS 2.4.10 that later versions fix; Debian testing's 2.4.18 accepted it), and that printer did
print through a route CUPS calls deprecated. CUPS held a job while the printer was away and printed
it by itself later; its source code waits 7 days before counting such a job failed. The third version recommends drawing pages ourselves (decision 10). It builds after A231's build. **Next action:** owner decides 10, and the asesor answers the
five questions. This settles A3's open "Printing A4 invoices on an office printer" design when
built.

### W41s. Fiscal prevention and offline recovery — DESIGN AND REVISED PLAN APPROVED (2026-10-04)

**Update, 2026-10-04:** the owner requires prevention before conflict recovery, including an
old-backup restore on new hardware with no internet. The
[revised design](superpowers/specs/2026-10-04-fiscal-prevention-and-offline-recovery-design.md)
records manual recovery, a paper allocation register in the recovery pack, an optional cloud
registry reachable by phone, emergency random series and an explicit later switch to a fresh
short series. Device evidence is optional. Matching invoice date and amounts no longer excuse
a fingerprint mismatch. Q5(f) and Q33–Q40 in the adviser document are revised, and Q41 covers
issued invoices missing from the backup. The owner approved this design ("lgtm") and selected
queue execution. The [revised implementation plan](superpowers/plans/2026-10-04-fiscal-prevention-and-offline-recovery.md)
separates development from production-enablement gates: prevention and evidence work can
proceed while adviser answers are pending; disputed remedies retain explicit gates. It includes
an allocation-contract checkpoint, live AEAT probes, offline recovery, corrective workflows and
a separately owned Cloud registry workstream. The owner approved the revised plan on 2026-10-04;
it replaces the 2026-10-03 task list while W41s remains the backlog item. The owner approved
the allocation and recovery contract in §9 and granted W41s-4 a narrow H2 scope exception on
2026-10-05. Task 2's ordered filing and duplicate-evidence changes landed as [#1213](https://github.com/clintongormley/waitron/pull/1213)
on 2026-10-05. W41s-1 completed eight synthetic preproduction probes;
[the dated protocol receipt](superpowers/specs/2026-10-04-fiscal-prevention-and-offline-recovery-design.md#71-protocol-receipt-2026-10-05-w41s-1)
records each outcome and its limits. The owner approved and landed
[the library probe PR #132](https://github.com/waitron-io/verifactu/pull/132) on 2026-10-05
(squash `8c680b699942c460ecb1c03f6cb8750130fc6648`); no release tag was created.
**Update, 2026-10-05 (W41s-1d):** [the asesor questions](compliance/asesor-questions.md)
Q33–Q41 and [the findings, §16](compliance/verifactu-findings.md#16-aeat-test-service-observations-for-conflict-recovery-added-2026-10-05-w41s-1)
now carry the test-system receipts and their limits. The legal questions remain open.
**Next action:** follow the lane queue; resume A231 after A261-2's landing.
Task 3 can use the published receipts; D2 retains its remaining plan gates, and D5 still needs
old-chain evidence and its adviser answer. Independent queue items may proceed under the plan. The following paragraph records the 2026-10-03 state;
its old next action and allocation assumptions are superseded by this update.

The owner asked (2026-10-03, on W21's review) how a chain AEAT disagrees with can happen, how to
prevent it, how to recover, and how to put things right with AEAT; today `drain.ts` stops such a
chain for good and the alert says "Contact support". The
[design](superpowers/specs/2026-10-03-fiscal-chain-divergence-design.md) ranks thirteen causes with
their receipts. The top one is our own: a failed send backs off each record separately, so after a
two-minute outage a void can be filed before its sale, and the chain stops for good (reproduced
against the fake AEAT; dates from #15). Second, a duplicate answer AEAT reports as `Correcta` is
taken as ours without comparing fingerprints, so an older database copy or a second venue under the
same tax id collides silently. A review seat also found that a cancellation sent for a colliding
invoice cancels the other copy's record (measured on the fake AEAT; AEAT keys a cancellation by
invoice alone); the design never sends one. It proposes seven preventions, five kinds of answer from AEAT, an automatic new
chain started in its own transaction right after AEAT's reply is saved, with the series read per
sale (no restart), what the
dashboard says, AEAT's procedures quoted from primary sources, and eight asesor questions
(Q33–Q40 in `docs/compliance/asesor-questions.md`, rewritten with their background on 2026-10-03). The
[plan](superpowers/plans/2026-10-03-fiscal-chain-divergence.md) has seventeen tasks (0–16), starting
with five probes at AEAT's pre-production service. The owner decided D1–D9 on 2026-10-03 (spec §11):
automatic new chains, short incrementing series checked against AEAT, nothing waiting for the
replication work. **Next action:** the owner approves the spec and plan as decided, and sends the asesor
questions (Q33–Q40 and Q5 f); the build is queued only after approval. Tasks 1, 2, 3, 6, 7, 9, 10 and
13–16 end `needs-owner-review`.

### A2. The setup wizard

The restore choice now includes guided Cloud recovery of a verified test-venue snapshot. The
replacement shows the pairing code and approved capture time, then requires an explicit local
restore. Live production recovery and continuous complete-server recovery remain open.

**Built:** the wizard (#334) and its corrections plus a first-sign-in passkey offer (#347); restore
and configuration import working in a real browser (#584); a centred page with the logo, not a
pop-up (C39, #828); Spanish and English with a language chooser (C42, #837); the form-error rule
(C47s, #840); a refused dropdown's red outline (A151, #944).

- **Open owner call — setup always stores a language on the account.** If the browser sends no
  language, or one Waitron does not ship, the account gets the venue's language saved as though
  chosen — so the stored value cannot tell "chose Spanish" from "said nothing", and it does not
  follow a later change to the venue default. Keep this, or store a language only when the browser
  asked for one? Since C42 a language picked in the wizard is sent as the provision's
  `Accept-Language`, so a choice made there is stored like any other browser answer.
- **The wizard has no spacing values of its own — DECIDED (owner, 2026-09-29): leave it.** It
  borrows the pop-up's side spacing (`--wt-modal-inline-margin` and `--wt-modal-inline-padding`, in
  `apps/setup/src/setup-app.ts`), so a later change to the pop-up's spacing moves the wizard too.

**Left open by C42 (#837):**

- *The configuration preview names what it will copy by database table* (`products`,
  `menu_item_variant_overrides`, `print_agents`…) in both languages
  (`apps/setup/src/screens/configuration-preview-screen.ts`). The names come from each module's
  `configuration-transfer.ts` list; about fifty can arrive. Give them operator words, grouped, or
  keep the table names.
- *The Review screen scrolls sideways at 390px* when a value is long (a 56-character email made
  it 530px wide in English, 537px in Spanish): its `auto 1fr` columns never narrow below the
  longest value.
- *The Cloud restore screen shows capture and expiry times as the server's raw ISO text* in both
  languages, and the Review screen shows invoice languages as codes. _(C113, #1014: one code now.)_
- *The file pickers' "Choose File / No file chosen" follow the browser's language*, not the
  chooser; the browser draws them.
- *The Spanish certificate export steps name Chrome, macOS and Firefox menus from memory*
  ("Gestionar certificados importados de Windows", "Acceso a Llaveros", "Sus certificados"…), and
  the FNMT links still open FNMT's English pages. Check them on real Spanish systems with the item
  below.

**Still open after #334:**

- *The certificate export help has never been followed on a real machine.* Nobody exported a
  certificate through Windows', macOS' or Firefox's own certificate store while reading the new
  guidance, so the instructions are unverified against the thing they describe. Fold this into the
  device walkthrough (item 1 of *What to work on next*) and tick it off per operating system in
  [ui-review.md](ui-review.md).
- *Switching setup mode does not clean up what the server already holds.* #334 clears the browser's
  own record that a certificate import was requested, and nothing more. If someone fills in Demo,
  Prepare or Live far enough that the server has stored part of that answer and then switches mode,
  what the server kept is untested — write a test that stages configuration in one mode, switches,
  and asserts what survives.
- *The setup app's catch-all redirect was not proven by deleting it.* Unknown setup addresses go
  to `/` while real files and API routes keep their own responses. The reviews checked this by
  running the route tests and the full server suites, not by removing each exclusion one at a time
  and watching a test fail, and no separate probe confirmed the trading app is untouched by the
  redirect.

**Found while bringing `apps/setup` to the coverage bar (2026-09-23), left unfixed** — each was
seen in a throwaway test, since deleted, and none has a test pinning it:

- *A draft carrying a country with no venue-setup pack* (a configuration import can bring one) shows
  Spain in the country select while the screen holds the other value, so "Check the country." sits
  beside what looks like a valid choice.
- *A fiscal test or a provision that answers after the wizard has been removed from the page leaves
  it stuck when it is put back*: the Run button stays on "Running test…", or the screen stays on
  "Provisioning…", with no retry. The connection check releases itself in the same case. The app
  mounts the wizard once and never removes it, so this may be unreachable in use.

**Demo gaps on the setup wizard's venue screen, as they stand after C47s (#840), left unfixed** —
each says whether it was seen in a run or only read in the code:

- *In Demo, a server refusal of a field Demo hides can only be retried unchanged.* The shell routes
  a refused `seriesCode`, `rectificativeSeriesCode` or `operationDescription` back to the venue
  screen whatever the mode (`apps/setup/src/setup-app.ts`, the venue case of the refusal routing).
  The refusal's sentence shows above Next and pressing Next moves on to the review screen, which
  sends the same series codes and description again, so the operator has nothing to change if the
  server refused them. The venue screen's half is pinned by the `shows a Demo refusal of the hidden
  %s above Next, and pressing Next tries again` cases in `apps/setup/src/screens/venue-screen.test.ts`;
  the move to the review screen (`#onAdvance` in `setup-app.ts`) was read, not run. Whether the
  server ever refuses Demo's fixed series codes is not established.
- *In Demo with a draft country that has no venue-setup pack*, the screen says from the start that
  Demo's invoice settings have not loaded, even when they have (the unknown country names no filing
  module to take a description from), and Next only moves focus to that sentence. When the draft
  carries an operation description but no tax ID, a press puts "Enter the tax ID. Choose one or two
  invoice languages." above Next, ahead of the generic sentence — two fields Demo does not show.
  _(C113, #1014: the language sentence now reads "Choose the receipt language."; this case was
  not run again.)_ Seen in a throwaway test on 2026-09-29, since deleted; nothing pins it.
- *In Demo, a local check that fails only on a field Demo hides* — for example a draft whose series
  code equals its refund-invoice series code — shows its message above Next once Next has been
  pressed, while Next stays enabled (it is disabled only by errors on fields the screen shows).
  In that example both hidden fields carry the same message, and the message above Next is built
  from every hidden field's error (the `bottom` list in `render`,
  `apps/setup/src/screens/venue-screen.ts`), so "Use different codes for ordinary and correction
  invoices." would appear twice. Every press only runs the focus-the-first-invalid-field step and
  returns, so the draft is never sent. All of this was read in the code, not run; whether a real
  draft can reach that state has not been tested.

**A refused backup-file input on the backup restore screen gets no red outline — OPEN.** The
screen's own styles have no rule for an invalid input (seen in screenshots of the refused state
during A151). The recovery key and recovery kit moved to `wt-input` and `wt-textarea` in A178d,
which draw their own invalid state (read, not run), so the backup-file input is what is left.

**A venue's time zone must come from its country pack's list (A166, owner 2026-10-01) — OPEN.** The
owner: _"in fact this should be chosen from a dropdown, and the options specified in the country
package, eg Spain has two time zones, one for mainland and one for las canarias"_. Today setup does
not let anyone choose it: it takes the zone from the province of the venue's address (Spain's pack,
`packages/country-es/src/spain.ts:180`, gives Las Palmas and Santa Cruz de Tenerife
`Atlantic/Canary` and every other province `Europe/Madrid`; the UK pack gives `Europe/London`). But
the column, `locations.time_zone`, is plain text, and provisioning copies whatever it is given
(`packages/provisioning/src/venue-apply.ts`).
Readers then disagree about a bad zone: reporting throws, bookings falls back to Madrid, account
emails to UTC. **Wanted:** each country pack lists the zones it allows (Spain: Madrid and Canary),
and creation/provisioning writers refuse a zone not on its country's list. A dropdown is needed
only if a venue could ever need a zone other than
its province's; for Spain the province decides. (Aside: a Canary venue cannot be set up yet — the
pack marks the Canary tax territory unsupported.) Slice 3b's station opening hours ignore hours
when the zone cannot be read, as a last defence
([plan](superpowers/plans/2026-10-01-station-hours-fallbacks-slice-3b.md), S8).
A261 step 7's approved plan separately permits a named-zone override before dated history;
its editor validates named zones and refuses numeric offsets. Importing configuration into an
existing venue retains its saved zone (`applyPreparedLocation`,
`apps/server/src/configuration-transfer.ts`); importing venue details is a creation concern,
not an edit through that applicator.

**A configuration import does not check a table status's colour (A273, review of W92, 2026-10-05) —
DONE (#1257).** A save and an import now share one rule, `isStatusColor`
(`packages/db/src/status-color.ts`), which still allows a short named colour such as `amber`. The
core module's import check (`validateCoreConfiguration`, `packages/db/src/configuration-transfer.ts`)
refuses a `table_service_statuses` row whose colour fails it with `setup.request_invalid`
`{ field: "table_service_statuses.color" }`. The bundle is refused whole when setup opens the
export, before the staged file is written, and again when it is imported, where provisioning's
transaction rolls back every venue row. A save's refusal is unchanged
(`management.request_invalid`). Reproduced first: on `main` a bundle carrying `red;position:fixed`
imported. Left open: the save's existing refusal test asserts the code but not
`{ field: "color" }` (Codex run-it review of #1257); tightening it was out of the item's scope.

**Remaining "?" buttons that should be hints (A237, owner 2026-10-03) — OPEN.** The rule — a short
explanation is the field's hint, and the "?" button is only for one too long for a hint or a field
that starts filled in — was applied to the setup wizard's first four screens only, and nothing
enforces it. Candidates still showing a "?" for a short explanation: every field on
`apps/setup/src/screens/connect-screen.ts` (strings `connect.*.help` in
`apps/setup/src/i18n/strings/start.ts`), and the backup file and the recovery key on the backup
restore screen (`restore.backup_file_help` and `restore.recovery_key_help` in
`apps/setup/src/i18n/strings/restore.ts`). The connect screen fills its fields in again from the
earlier request when the operator comes back to it, which is the rule's "starts filled in"
exception, so each of its fields needs a judgement rather than a straight swap. Other screens' "?"
buttons were not reviewed against the rule. A243 removed every "?" button from the setup review
screen. Separately, the role screen
(`apps/setup/src/screens/role-screen.ts`), reached from Join or recover, still shows its choices as
cards with buttons rather than `wt-choice-row` rows. The certificate help page the setup wizard opens
(`/setup/trust`, drawn by `apps/server/src/trust-page.ts`) still writes the browser's warning as
“not secure” in quotes, where the wizard's first screen (#1107) now writes Not secure without them.

**The setup review screen's "?" buttons (A243, owner 2026-10-03) — DONE (W33, #1143, 2026-10-03).**
`apps/setup/src/screens/review-screen.ts` no longer shows a "?" button anywhere, so at 1280 px
wide every row whose label and value each fit on one line is the same height, except the
certificate row, whose value carries its own Edit button; and each section's explanation is now one
muted line under its heading
(`review.help.*` in `apps/setup/src/i18n/strings/venue.ts`, where the seven row explanations and the
button's label were deleted). The owner had called the "?" buttons messy: a row carrying one was
taller than its neighbours, and the many bold circles pulled the eye away from the values.
Left open: no test covers the value cell's own centring (`align-self: center` on the value in
`review-screen.ts`) — removing it alone leaves all 31 review-screen tests green, because it changes
nothing until a label is taller than its value (a label wrapping onto two lines). The test that
used to cover it was deleted on the owner's answer to the W33 question; the certificate-row test
covers only the label's centring.

**The "Setup complete" screen lacks the earlier screens' polish (A244, owner 2026-10-03) — DONE
(W34, #1144).** `apps/setup/src/screens/done-screen.ts`: "not terrible but it doesn't
have the polish of the previous pages" (owner). What reading it showed: a plain bulleted list of
underlined links; two near-duplicate sentences ("restarting into trading mode" and "once the server
is trading"); its own mode-pill style, separate from the review screen's; and `rem` sizes and hex
fallbacks in its styles, against the token rule. The owner also wanted the Print agent link
(`done.link.print_agent`) gone from the page: "i don't think we need the print agent anymore".
Now the Till, Dashboard and Email inbox links are `wt-choice-row` rows (which gained an `href`),
introduced by one muted sentence; the Print agent link is gone; the device steps and the backup
nudge sit in cards; the review, provisioning and done screens share one mode pill
(`apps/setup/src/mode-pill.ts`); and the screen's styles hold no `rem` or `em` sizes, hex colours
or fallback values.

**The till follows the browser's languages before anyone signs in (A245, owner 2026-10-03) — DONE
in W35.** The public till locales response now uses the dashboard's `resolveLoginLocale` match of
`Accept-Language`, with the venue's language as fallback. The till applies that match on the enrol
and lock screens and after logout; a person's choice or saved language wins over a late response.
An enrolled kitchen display stays in the venue language. The receipt language still comes from the
location. In the Demo stack's fresh browser, the direct
enrol screen's language chooser was visible at 1280 and 390 pixels in both themes, and the same was
true inside Demo's device setup dialog. Screenshots: `~/waitron-campaign/w35-shots/`. The owner's
earlier missing chooser was not reproduced; no separate chooser change was made.

**A Demo bar on the till and dashboard (A246, owner 2026-10-03) — DONE in W36.** In Demo and
Preparation, the shared bar links to the dashboard, device page and Email inbox. The dashboard's
Email inbox link lives there, and the till's device setup and approval screens link directly to
Settings → Devices so a manager can approve the device. Live keeps its existing mode label.
W37 added the pretend printer link beside Email inbox.

**The demo venue's names and tax ID come from the country pack (owner 2026-10-05) — DONE in
W108 (#1276, main 99e986957).** Every demo venue, from the wizard's Demo and from `wa-wt reset demo`, is now the same made-up
business: legal name Waitron Demo S.L., tax ID `B00000000`, location Casa Delgado, and two
departments trading as Bar Casa Delgado and Deli Delgado, in English and Spanish alike. The values
live in the country pack (`CountryDemoIdentity`, `packages/country/src/country.ts`, filled in by
`packages/country-es`); the random tax ID draw is gone. In Demo the wizard's location name starts
as Casa Delgado and can be changed, and is explained by a "?" rather than a hint that would not
show in the filled-in field (Prepare and Live keep the hint); the legal name is no longer copied
from it, and a refusal of the legal name shows above Next. The summary's Demo note says the legal
name and tax ID are Waitron's fixed demo values. The departments' internal names still follow the
seed language.
Screenshots: `~/waitron-campaign-c/w108-shots/`.
Left open:
- *A Demo for a country whose pack has no demo values is not refused at the setup route.* The demo
  seed refuses it (`seedInstalledDemo`, `apps/server/src/demo-seed.ts`), but only after the venue
  has been provisioned. Only Spain is offered at setup today, and Spain has the values. Refusing it
  in `parseProvisionPayload` (`apps/server/src/setup-api.ts`) turned the case "keeps the typed tax
  id, postcode and province when the country has no rules for them" in
  `apps/server/src/setup-api.country-pack.test.ts` red, because it sends a Demo for a United
  Kingdom pack with no demo values; that test was left unchanged for the owner to decide.

**Cross-app links in the split Vite dev stack — OPEN, unqueued.** The deployed server serves both
apps on one origin, but the dev stack runs the till on port 5190 and the dashboard on 5191. A
request for `/manage/devices` on 5190 returned the till HTML, while the same path on 5191 returned
the dashboard HTML (measured 2026-10-03 with `curl`). Make cross-app links reach the other dev
server without changing their deployed same-origin paths; this also affects setup's existing links.

**Table filters move into a Filters panel, and vanish on an empty table (A248, owner 2026-10-03) —
DONE in W39.** `wt-data-table` (`packages/ui/src/components/wt-data-table.ts`)
drew every column filter as a dropdown above the table even when the table had no rows at all — the
empty Printers screen showed an "Active" filter over "No printers yet". Agreed with the owner, after
comparing Home Assistant's entity table: on a table with no rows, no filters, search or Columns
button; otherwise one Filters button with a count of active filters, opening a panel (beside the
table when wide, full screen on a phone) with one collapsible section per filter, each with its count
and a clear button, plus clear-all; a funnel mark in a filtered column's heading. Filters were not
put in the column headings because a phone scrolls columns out of sight and a hidden column still
filters. The units table's always-on checkboxes become a Select mode, as the product list already
has.

**Filters panel initial focus — DONE (W39f, owner 2026-10-03).** Opening the panel focuses its first
filter section, so a second Enter collapses that section without clearing the filters.

**Filters panel sections — DONE (W62, owner 2026-10-04).** Each filter now has a plain heading and
an always available choice control. The section no longer collapses or shows a value count or its
own Clear button. Choose "Any …" for one filter, or Clear all for every filter. Opening the panel
focuses the first choice control. This supersedes W39's section layout and W39f's focus behavior.

**The table's Columns button becomes a Customise dialog (A249, owner 2026-10-03) — DONE.**
`wt-data-table` has an icon button opening a dialog that lists every column with a show/hide eye.
The fixed first and pinned end columns are listed but cannot move or hide. Drag and keyboard controls
reorder the others; Restore defaults resets order and visibility. The table remembers choices when it
has a `viewKey`. Clicking a column heading still sorts it.

**Column drag feedback in Customise — DONE (W63, owner 2026-10-04).** During a pointer drag, a
floating copy of the column name follows the pointer and the destination row is highlighted. Both
clear when the drag ends or the dialog closes; keyboard reordering and saved order still work.

**Menus list heading, rows and Customise rows — DONE (W79, owner 2026-10-04).** Add menu sits in
the Menus heading's row at its trailing edge, moving under the heading on a phone when it does not
fit; the empty list still offers it under its sentence, and focus returns to the heading's button
after a menu is made from the empty list. A click anywhere on a menu's row opens it once, and the
row's own button is named "Open: <menu>". Every `wt-data-table` row that opens something now
takes the lifted surface colour while hovered, or while anything in it has focus, pinned Actions
cell included, because the raised colour it used was the same white as a resting row in the light
theme. A table shows its Customise columns button only when it has two movable columns, so the Menus
list, whose Status is its only one, shows none. (Since W87, 2026-10-04, a wide Menus list has a
second movable column, Changes, and shows the button; see below.) In the Customise dialog a column
that can never be hidden says "Always shown" instead of drawing a greyed-out eye, fixed rows keep
the drag handle's space so names line up, and the last shown column's greyed-out eye carries a
visible "Keep at least one shown".
Left open by W79 (#1186): `docs/developers/design-system.md` still says a list's Create action
goes in a menu beside the table heading, while Menus, Staff and Units put a text Add button at the
heading row's trailing edge; the doc only names the exceptions, and whether the rule itself changes
is the owner's call. And the row-highlight tests focus only the row's own button, so nothing tests
that a row highlights while another control in it, such as its Actions menu, has focus.
W79 deleted the two checks that clicking a fixed column's eye left the sort alone, since fixed
columns no longer have one; W79f puts a check back, on a flat table, in `wt-data-table.test.ts`:
hiding and showing columns through the Customise dialog keeps the sort column and direction, and
hiding the sorted column itself (allowed only while another movable column stays shown) stops the
rows being sorted by it until it is shown again, when the same sort returns.

**Menus list Changes column and top-aligned rows — DONE (W87, owner 2026-10-04).** The Menus list
has a Changes column when the list is wide enough. A menu with changes since its live version keeps
"Published", the live version and its time in Status, and shows an "Unpublished changes" link under
Changes, named for its menu, that opens the menu's Preview tab straight away without opening the
row; a click with a modifier key is left to the browser. A menu never published, one with no
changes, and every menu while the states are read or after their read fails show nothing there.
Clashes stay in Status and the status sort is unchanged. The list's cells now start at their top (a
new `topAligned` option on `wt-data-table`, set by this list alone); where Changes is a column, the
name, state, link and row menu start on one line. The list takes one of three layouts by its own
width. From 50rem it has four columns and the name wraps so that they fit without sideways
scrolling, even for a long name. Between 30rem and 50rem it has Name, Status and Actions, with the
link on its own line under the state, so the link stays in view beside a long name. At 30rem or less
the state and then the link stack under the name. With a second movable column the wide list now
offers Customise columns, which W79 had left off; the list keeps its column choices under a new key,
so a choice saved while Status was its only movable column is not read. Left open by W87: the editor
heading still reads "Unpublished changes · Live: version <n>", which W88 redesigns (done in W88,
2026-10-05: the heading reads "Menus › <menu>", and "Unpublished changes" is a link to the Preview
tab). Between 30rem
and 50rem a long menu name can still make the table wider than its box (measured in Chromium,
2026-10-04: by 20 px in English and 29 px in Spanish, at a 600 px window with hyphenated, spaced and
unbroken names and at 700 px with spaced and unbroken ones, where a hyphenated one did not
overflow), so the end of the live version's time scrolls under the pinned Actions column; the link
and the row menu stay in view. The existing 600 px case "keeps every menu row's menu on screen and
uncovered while the other columns scroll sideways" in
`apps/dashboard/src/screens/menus-screen.test.ts` requires that overflow. In that middle layout the
Status column, and on a phone the Name column, hold the Unpublished changes link but do not set
`activatesRow: false`, so a click beside the link opens the menu; the design system records this as
a deviation from its `activatesRow` rule, and whether it stays is the owner's call. In the dark
theme the Unpublished changes link's blue on a highlighted (hovered or focused) row measured 3.57:1
with axe, below the 4.5:1 minimum for text. Moving the link to `--wt-color-primary-text` did not
change that, because in the dark theme that token is the same colour (`#4c8dff`) as
`--wt-color-primary`; in the light theme it now passes at 4.88:1. The product list's maker link
(`apps/dashboard/src/widgets/product-list.ts`, part `maker-link`) paints `--wt-color-primary`, which
on a highlighted row is the same colour pair measured at 3.87:1 in light and 3.57:1 in dark, though
not measured on the product list itself. Its "Made at" column also does not set `activatesRow:
false`, so, judging by the code (not run), a click beside a short station name opens the product
editor, which the `activatesRow` rule in `docs/developers/design-system.md` forbids. Both predate
this branch (5b725d672, ca89633f1) and are left for an item of their own.
Fixed in W88 (2026-10-05, its commit "Menus list: choose the phone or wide layout before the table is
first drawn"): W87's list was first drawn in its wide layout and switched to the phone layout a
frame later, which made two `menus-screen.test.ts` cases fail now and then ("offers Customise
columns only where Status and Changes are columns (390 px)" and "opens the Preview tab from Enter on
the focused link"). The list now measures its width before its table is first drawn.

**Add products picker selects all listed — DONE (W81, owner 2026-10-04).** The Structure tab's
"Add several products" button now reads "Add products" ("Añadir productos"). The picker's list has
a header row whose checkbox lines up with the products' own, labelled "Select all listed" and named
for screen readers "Select all listed products". It chooses or clears only the products the
category and search filters list, shows checked, unchecked or mixed from those alone, and leaves
chosen products a filter hides chosen; Add still adds every chosen product. It is greyed out while
the picker is busy or nothing matches the filters, and not drawn when there are no products or the
section already holds them all.

**A menu's Structure tab is one tree — DONE (W88, #1209, main `21b57d280`, 2026-10-05; owner 2026-10-04).** The Structure tab draws the
menu as one full-width tree table, like the Products tree. Its first row, "Menu: <name>", holds
New section here, Include a menu and Add products in its ⋮; each section the menu owns holds the
same three adds, then Edit and Delete, and an add acts on that section from whichever place it was
chosen. The outline, the right-hand list panel with its own heading, note and bottom "Add a product"
picker, the path above that panel, and the three buttons beside the tabs are gone; Add products in a
row's ⋮ replaces the bottom picker, and there is no single-product add in the tree. Members keep
menu order, and a member moves within its own list by ArrowUp or ArrowDown on its grip, or by
dragging the grip, with Products' ghost and gap. Names line up at every level, as in the Products
tree. An included menu opens for browsing; nothing inside
it has a grip or a ⋮, and its own row reads "Read-only here" with a link to that menu's own editor
and "Remove from this menu". Opening a section, or choosing an add from its ⋮, makes it the current
row (bold and underlined); a refusal about another list still names it. After a window closes,
focus goes back to the ⋮ it was opened from. The editor's heading now reads "Menus › <menu>", with
Menus an underlined link to the list, and "Unpublished changes" under it is a link to the Preview
tab (plain words on the Preview tab itself). Products' drag code moved into
`apps/dashboard/src/widgets/tree-drag.ts`, shared by both trees. The owner approved the existing
test edits on 2026-10-04 (the list is in the PR). Not checked: a drag with a touch pointer or on a
real touch screen; a drag does not scroll the page near its edge (nor does Products'); in Spanish at
390 px the Type column scrolls partly under the pinned Actions column, which is the table's own
sideways scroll; the heading's height with "Checking…" or "Could not be checked" was not measured
against the other states.

**The Menus Structure tree: a folder's name starts left of a product's at the same level — DONE
(W88, found 2026-10-05 by W88's look).** Every row of the tree, the menu's own row included, now
draws the Products tree's three slots before its name _(2026-10-06: at phone width the Products tree's product
rows draw no photo slot; this tree's keep theirs, W85e)_: the table's arrow, a grip or a blank space
of the same width, and a folder icon in a photo-wide frame or the product's photo, or an empty
frame of the same size when it has none. Names at one level start at one place, and the Name heading
sits over the menu's name through the table's `tree-heading` part. W88 was branched before W84
(#1199) gave the Products tree's All products row its grip space.

**A menu no longer switches a product or size off on its own — DONE (W90, #1216, 2026-10-05;
owner 2026-10-04).** Whether a product is on a menu is now decided only by the structure of an
active menu (its own sections and the active menus it includes) and the product's Active state, and
whether it can be sold now by Available. A size (variant) is sold wherever its product is placed, while it is Active and
Available. The Prices tab lost its "On this menu" column, the Sold / Switched off choices in its
edit window and the Sell it / Switch it off clash buttons, and a menu can no longer avoid a price
clash between the menus it includes by switching the item off. The item PATCH refuses a body carrying
`offered`, and the size-prices PUT a size entry carrying it (`management.request_invalid`). Catalogue migration
`0024_drop_menu_offered.sql` removes `menu_items.offered` and rebuilds
`menu_item_variant_overrides` without its `offered` column, so a row there always holds a price.
The rule is in [products.md](developers/products.md), _Active and Available_ under _Variants_. The
test checks this change rewrote or deleted are listed in the PR and in the plan's _Changed test
checks_ table (`docs/superpowers/plans/2026-10-05-w90-remove-menu-offered-switch.md`).
**Upgrading:** a venue whose database holds a size row with an on/off choice and no menu price
cannot migrate: migrating it fails on
`CHECK constraint failed: menu_item_variant_overrides_overrides_ck`. Reset a dev venue with
`wa-wt reset demo <name>`; reset any other venue, or clear those choices before upgrading. After
upgrading, a size switched off on a menu is sold, published again or not (read, not run:
`applyLiveFields` sets a size's `available` from its Active and Available state alone); make it
Unavailable or Inactive if it must not sell. Publish every menu again: a menu with products on it,
or one that includes another menu, reads as changed until it is (seen 2026-10-05 by the pre-merge
review for a populated menu, which read as changed, and an empty menu that includes nothing, which
stayed current; the included-menu case is read, not run). A configuration bundle exported before
W90 must be exported again after upgrading: one exported just before W90 is refused
`setup.request_invalid` with `field: "module:catalogue"`, because its catalogue migration count is
one short (seen 2026-10-05 in a throwaway test, not kept); an older one is refused at the first
module, in the order they are checked, whose count differs.

**A menu's prices are one editable Price overrides field per row — DONE (W89, #1239,
2026-10-05; owner 2026-10-04).** The menu editor's Prices tab is now "Price overrides" ("Precios
propios"); its address keeps `view/prices`. Each product and each size has one price field in its
row: blank, it shows the price it inherits as its placeholder — one amount, the range across a
product's Active sizes, or "Set a price" beside a red Clash when its sources disagree (a product
whose only clash is in one of its sizes shows "—" and says that a variant's sources disagree and
that variant's price should be set); with an override, it shows that price. Enter or leaving the
field saves it, Escape puts the stored price back, and emptying it gives the inheritance back. A
refusal about the price also goes under its field and takes focus there; a status line that stays in
view says each refusal while its row is shown and, once the prices are read again after the last
save made, what that save stored, with Undo — unless the status line is then showing a refusal. The
window behind the product name, and the Before this menu, Menu price, Effective price, Price on this
menu and From columns, are gone.
Main category starts shown and keeps its filter; the table keeps its column choices under a new key
(`waitron.menus.price-overrides.table`), so a choice saved for the old columns is not read (as W87
did for the Menus list). A Status column says Active or Inactive and links to the product's page;
the tab now lists Inactive products and sizes (the management prices read includes them, each with
`active`), while a menu's offers, and what it publishes, still leave them out. A new route,
`PATCH /management-api/catalogues/:id/items/:itemId/variants/:variantId`, sets one size's price
alone ([product-categories.md](developers/product-categories.md)); the dashboard no longer calls
the whole-list `PUT …/variants`, which stays on the server. The pattern is written down in
[design-system.md](developers/design-system.md), Forms → "A value saved from its own table row".
No migration. The test checks this change rewrote or deleted are in the PR's "Changed test checks"
and in the plan (`docs/superpowers/plans/2026-10-05-w89-menu-price-overrides.md`). Not checked:
the tab on the running dev stack — the product page opening from a Status link, a real save and
the re-read after it, and Undo against the real server (the look in Chromium used mounted widgets
only).
Left open, raised in #1239's review and not taken: the Preview tab still labels a clash "Menu
price", the name of a column W89 removed (owner's wording choice); the Resolve menu still shows on
a clashing row while a price is typed but not yet saved; and a size with its own price decides
whether its clash comes from its product by matching the two clashes, which can be misread in a
rare setup where they match exactly — telling them apart needs the prices read to say which level
a clash came from.

**A product has one colour everywhere, taken from its category unless it has its own — DONE (W92,
#1250, 2026-10-05).** A category can have a colour, set in the Products tree from a colour square
after its name and count, or from the square inside the box that names a new category or renames
one (a category is still named inline, the owner's choice of 2026-10-05). A square opens a small
chooser with the shared swatches, No colour and Custom; choosing is the answer. From a row the
colour saves at once, alone; from the box it saves with the name on Enter. The box's square is no
Tab stop, so Tab still leaves the box and saves it as before; from the keyboard a category's colour
is set from its row's square. A product can have a colour of its own, set from the product
editor's chooser after Name, whose "Use category colour" choice shows the colour it would take
instead, or from the product's swatch in a menu's Structure tree, whose dialog says the change
applies on every menu using the product. A product's colour is its own, else its main category's,
else the nearest coloured category above that, else none. A variant always takes its parent's: the
editor clears a variant's colour, and the server refuses a variant body carrying one. A section's
swatch in the Structure tree opens the section's existing form, and a section's colour still
paints only its own tile. Each published offer records its product's colour, so a colour edit is a
change to publish: the menu reads as changed, its Preview tab names the change "colour", and the
tills show it once the menu is published. On the till, a coloured product or section tile fills
with its colour and its labels turn black or white, whichever reads better; a sold-out painted tile
keeps the usual fade (replaced by W92a, 2026-10-05: see below). The swatches sit after the name, not before it, so names at one depth stay
lined up (W84). The Home page tab's tile preview stays uncoloured
([W92 spec](superpowers/specs/2026-10-05-w92-product-colours-design.md), Question 3 and
Decision 8). How it works: [products.md](developers/products.md), _Colour_, and
[product-categories.md](developers/product-categories.md).
**Upgrading:** two migrations, core `0101_product_color.sql` and catalogue
`0025_category_color.sql`, each add one nullable column (`products.color`,
`category_details.color`) with no table rebuild, so a venue migrates in place with no reset.
Republish every menu after upgrading: a version published before W92 carries no product colours,
so its product tiles stay plain, and a menu with products on it reads as changed until it is
published again (the document format number is unchanged, so such a version is still sold from).
A section's colour was already in such a version, and the till now paints it on the section's
tile. Export a configuration bundle again
after upgrading: one exported before W92 records older schema versions for core and catalogue,
which the import refuses (`validateConfigurationBundle`,
`apps/server/src/configuration-transfer.ts`; read, not run). The test checks this change rewrote
are listed in the PR's "Changed test checks" and in the plan
(`docs/superpowers/plans/2026-10-05-w92-product-colours.md`).
Left open:
- In the Structure tree, closing the section form opened from a section's swatch puts focus on the
  row's ⋮ menu, while the product colour dialog puts it back on the swatch. Neither is pinned by a
  test, and the two should agree.
- At 390 px the Structure tree clips a long name under the pinned Actions column, so a long name's
  swatch needs a sideways scroll to reach. The names clip with the swatches removed too (measured
  on the W92 branch, not on `main`) _(2026-10-06: W85e gives it 12 px more; it still clips)_.
- A case in `apps/dashboard/src/screens/catalogue-screen.test.ts` (near line 2135, added by #1087
  before W92) prints "[Unhandled rejection] Error: marker" in passing runs; the noise should go.
- Some dashboard pixel and drag cases W92 did not change failed once when run in parallel locally
  during the branch's work; the cause was not found. They passed in the PR's dashboard CI shard on
  its final head.
- **Done (W92a, #1259, 2026-10-05) — a sold-out painted till tile stays readable.** It kept the usual 50%
  disabled fade, so its labels read at about 2.2:1 to 3.5:1 contrast (measured by the first of the
  final Codex reviews). Every sold-out till tile, painted or not, is now a grey tile at full
  strength with its labels at 4.5:1 or more in both themes, and a painted one keeps its colour as a
  stripe ([products.md](developers/products.md), _Colour_).
- W92a's look is the owner's to judge (#1259's "Looks for the owner to judge"; screenshots in lane
  B's `w92a-shots/`): a pale colour's stripe is faint on the light grey (about 1.35:1 for
  `#edabab`) and a dark one's on the dark grey (about 2.11:1 for `#256bb1`); the dark theme's grey
  reads slightly lifted from the page; the text sits about 4px off-centre on a striped tile; and the
  stripe is 8px where the apps' other colour stripes are 4px.
- The category colour chooser (`category-color-form.ts`) and the product colour dialog
  (`product-color-form.ts`) share most of their code; a review suggested one component. Kept as two
  in W92 because the plan modelled one on the other.
- The product colour dialog opened from Menu Structure does not pick up another manager's change to
  that product's own colour while it is open. I believe this predates the last review round; not
  checked against earlier commits.

**A Products drag does not notice when a refresh removes what it is dragging or where it is going —
DONE (W88a, #1228, 2026-10-05).** Found by W88's pre-merge review. The Products tree
(`apps/dashboard/src/widgets/product-list.ts`) now checks a drag against the rows the list holds
after a refresh. A drag whose pressed row a refresh removed before the pointer moved far enough does
not start (no drag picture, no grabbing cursor, no `drag-items` naming the row). A target category
that a refresh removed sends no `drop-items` on release; once a refresh has removed any dragged row,
whether the only one or one of several selected, no category is offered and letting go sends
nothing. After every update of the table during a drag, the target already chosen is judged again
and the marks and gap redrawn, so a refresh no longer leaves a mark on a category that is no longer
a drop target, or the gap on the wrong row; the category is chosen again from the row under the
pointer only when the pointer moves. Checked by the "a refresh during a drag" cases in
`apps/dashboard/src/widgets/product-list.test.ts`, all but the All products case seen failing
without the code that makes it pass. A drag no longer sends a move once a refresh has removed the
category; one deleted elsewhere before this screen refreshed is still sent, and what the server
answers to it is not checked.

**Unused editing code in the two widgets the Menus screen no longer edits with — OPEN (W88, owner
default 2026-10-04: leave and record).** `dashboard-member-list-editor`
(`apps/dashboard/src/widgets/member-list-editor.ts`) is now drawn only by the Home page tab's layout
editor, which sets `openable` off, so its section Open, Edit and Delete actions and its included-menu
link and removal are reached by its own tests alone. `dashboard-menu-structure-tree`
(`apps/dashboard/src/widgets/menu-structure-tree.ts`) is drawn only by the Preview tab, `readonly`,
so its `current` path and its edit buttons are reached by its own tests alone. Pruning either
deletes assertions in `member-list-editor.test.ts` or `menu-structure-tree.test.ts`, so it needs
the owner's word.

**Two copies of the tree pointer drag — OPEN (W88).** W88 moved what Products and the Menus tree
draw during a drag into `apps/dashboard/src/widgets/tree-drag.ts` (the ghost, the row and gap marks,
the click blocked after a release), but each widget still has its own copy of the drag itself: the
press, the 5 px start, the target under the pointer, Escape, the release and the clean-up
(`#pointerDown` to `#gap` in `apps/dashboard/src/widgets/product-list.ts`, `#gripDown` to `#gap` in
`apps/dashboard/src/widgets/menu-structure-table.ts`). A shared helper, told how to map a row to a
target, would serve both.

**The Menus Structure tree notices Collapse all only by watching its table redraw — OPEN (W88).**
`wt-data-table` sends no event when Expand all or Collapse all opens or closes branches (only
`wt-expand-change` for one branch a person toggles), so `menu-structure-table.ts` adds a Lit
controller to the table and checks after every table update whether the current row is still
shown. An event from the table for "these branches changed" would be cleaner; it means a change in
`packages/ui`.

**"Edit <menu>" in an included menu's ⋮ can be followed while the tree is busy — OPEN (W88).** The
other items in the tree's row menus are greyed out while a change is out; the link to the included
menu's own editor is a link, which has no greyed-out state, so it stays live.

**A menu's Preview tab is wider than a phone for a one-word menu name — OPEN (found by W88).** At
390 px, with a menu named as one word longer than the screen, the page scrolls sideways on the
Preview tab: the page measured 658 px wide on 2026-10-05 (a throwaway test with the heading suite's
fixtures), while the Structure and Prices (since W89, Price overrides) tabs measured 390 px. The editor's heading holds the word;
the overflow is inside `dashboard-menu-preview` (`apps/dashboard/src/widgets/menu-preview.ts`).

**Filtered table headings stay put — DONE (W64, owner 2026-10-04).** The conditional funnel button
used to increase a header's height and width when its filter became active. A filtered heading now
uses an inset coloured line and an accessible filtered label; the Filters toolbar button opens the
panel. The table keeps its measured column widths when a filter narrows rows and when it clears,
then sizes them anew when the table's container, rows or column choices change. This supersedes
W39's funnel mark.

**Products table toolbar and headings stay in view — DONE (W80, #1187, owner 2026-10-04).** On the
Products screen the table fills the main column, and its rows scroll inside the table's own box
under its column headings; the page title, the search, Filters, Expand all, Select and Customise
stay above it. `wt-data-table` gained an opt-in `stickyHeader` for this, set only by the Products
screen. At every width the table's box is at least three tap targets tall. The dashboard shell
test, with a stub catalogue of 40 uncategorised products, no category open and no message above the
list, finds only the rows scrolling at 390×844 and 375×667, with about 27px to spare at 375×667
before W83 (a temporary test, not kept, measured 83px after it on 2026-10-04;
`docs/developers/design-system.md`, `stickyHeader`), so longer toolbar labels, a wrapped banner or a
message can still make the content column scroll. Not covered: in Select mode the toolbar wraps
taller and the content column overflows at 375×667 (figures below).
Other long tables (Orders, Staff, Payments and
the rest) keep scrolling with the content column until someone decides they should opt in too; each
would need its screen to give the table a bounded height, as the Products screen does.
Still open: at 375×667 the box gave few rows, short of the item's "enough rows to remain usable",
and a larger minimum does not fit that screen without the toolbar scrolling away. W83 (below)
shortened the toolbar. Measured on 2026-10-04 with a temporary test in the shell test's 375×667
setup (not kept), reading the rows' box below its headings: before W83, 117.5px of row area, which
held the All products row and no whole product row (rows are 69px); after it, 173.5px, which holds
the All products row and one whole product row. At 390×844 the whole rows, the All products row included, went from four to five.
In Select mode at 375×667 the content column overflows: by 129px before W83 and 25px after, in the
same temporary test; no kept test covers Select mode there. Whether
that is enough rows is the owner's call.

**Products: Filters and Select at the start of the table's toolbar — DONE (W83, #1193, owner
2026-10-04).** On Products, Filters (a funnel with its count) and Select (a checklist mark) are icon
buttons at the toolbar's leading edge, before the search. Each is named for screen readers, shows
its name in a tooltip that Escape hides, on keyboard focus and, where the pointer can hover, on
hover, and reads as pressed while
its panel or Select mode is on. While the table is at least 768px wide, Filters opens a panel
beside the rows at their left; it stays in view while the rows scroll, a press outside leaves it
open, and closing it gives the rows their width back. Narrower, it opens full screen. Pressing
Select again leaves Select mode as Cancel does; the count, Move to…, Delete and Cancel stay at the
toolbar's end and wrap one by one on a phone. On a phone the search takes its own line under the
buttons _(2026-10-05, W85d: wherever the list is 40rem wide or less, not only in a narrow window)_. `wt-data-table` gained an opt-in `leadingFilters` for this, set only by Products, and the
icon button and tooltip styles are shared from `@waitron/ui` (`iconButtonStyles`). One existing
test assertion changed, for the owner to review: the catalogue browser's toolbar-order test pinned
the old order (search, Filters, Expand all, Select, Customise) and now pins the new one (Filters,
Select, search, Expand all, Customise). Left open: on a phone the search is drawn under Expand all
and Customise while Tab reaches it before them (two reviewers judged this not a WCAG 1.3.2 or 2.4.3
failure, by stepping through with the keyboard and reading Chromium's accessibility tree; what a
screen reader says was not checked) _(2026-10-05, W85d: this now happens wherever the list is 40rem
wide or less, desktop windows with the sidebar showing included; those two reviewers judged it when
the layout existed only at phone width, #1193)_; and a desktop window narrow enough to leave the table under
768px gets the full-screen panel — at which window width that happens with the sidebar shown was
not measured. Also left open by W83's review, none started: (1) the table's Customise columns
button is icon-only beside these two but has neither their look nor a tooltip; (2) the icon button
and its tooltip are a stylesheet and a handler each caller wires by hand, not a `wt-icon-button`
component — Select is a native `<button>` because `wt-button` does not pass `aria-pressed` through;
(3) the 768px side-panel threshold is tied by hand to token sizes (768 − 7×44 − 12 = 448, just
above the table's 440px narrow-tree width); (4) the catalogue browser's phone layout switches on
the window's width (`@media (max-width: 30rem)`), where the menus and modifiers screens use
`@container (max-width: 30rem)` _(2026-10-05: fixed in W85d, #1249, below — it now switches on
the list's own width, at 40rem)_.

**Products at phone width: the toolbar takes two lines, not three — DONE (W85d, #1249, owner
2026-10-05).** The owner saw three toolbar lines on Products: Filters and Select, then the search,
then Expand all and Customise. The catalogue browser moved its search under the buttons only in a
window up to 30rem (480px) wide, so a narrow list in a wider window — the sidebar showing, for
example — missed the rule. Measured in real Chromium in a 1280px window: a list 320 to 430px wide
drew three lines, and 480 to 600px drew the search beside Filters and Select with Expand all and
Customise on a second line; all five shared one line at 640px.
The rule is now a container query on the catalogue browser's own width
(`@container (max-width: 40rem)`, `apps/dashboard/src/widgets/catalogue-browser.ts`): at that width
or less, Filters, Select, Expand all and Customise share the first line and the search fills the
line under them; wider, all five stay on one line as before. Products is the only table with these
controls (the menu structure table has Expand all and no search; the units, modifiers, content
languages and menu prices tables use the table's own search and have no Expand all or Select), so
no other screen changed. The search is given the whole line (`flex-basis: 100%`) as well as moved
after the buttons: with `order` alone, English lists 620 and 640px wide and a Spanish list 640px
wide drew all five on one line with the search last. Pinned by the "in a wide window" cases (English lists 320, 430, 620 and
640px wide; Spanish lists 430, 600 and 640px wide) and the "Spanish list 660px wide" case in
`apps/dashboard/src/widgets/catalogue-browser.test.ts`; the 390px phone case and the 1280px
one-line case are unchanged. Looked at on the demo stack at 390, 800, 900 and 1280px, light and
dark, English and Spanish (local screenshots in `~/waitron-campaign/w85d-shots/`). Not covered:
Select mode's extra controls at the middle widths.

**Products: the tree's Name column lines up, and the Main category column goes — DONE (W84, #1199, owner
2026-10-04).** The All products row, category rows, a category being added and product rows of the
Products tree draw the same slots before the name — the arrow, a drag grip (a blank one on All
products and on a category being added) and a folder icon, or a product's photo or its empty
placeholder frame, one tap target each _(2026-10-06: at phone width a product row draws no photo
slot, W85e)_ — so on those rows names step in by the table's indent per
level whether the row is a category or a product, and the Name heading sits over the All products
name (`wt-data-table` gained a `tree-heading` part for this). A variant's row draws no grip and no
photo slot; its name is indented to start under its product's name. Before, at one level a
category's name started 22px left of a product's (measured 2026-10-04 in a temporary test, not
kept). The Main category column is removed from the table and its Customise list; its search text
moved into the Name column's, so a category's name or path still finds its products and an empty
category is found by its parent's path; a saved column choice or order that names the old column
still applies to the other columns, and the old key is ignored. Seven existing test assertions that pinned the column changed, for the owner to
review (listed in the PR). Now, a product whose category the dashboard's category list does not hold
lists under All products with no "missing" marker; the database refuses a stored product naming a
category that does not exist (`packages/db/src/schema/catalogue.ts:51`, a foreign key; not tried),
so this is expected only while the dashboard's category list is behind.

**Products: a product's variants are listed by name — DONE (W85, #1200, owner 2026-10-04).** In the
Products tree a product's variants are listed under it by name, in the dashboard's numeric-aware
label order (`byLabel`, so "Ración 2" comes before "Ración 10"), whichever column sorts the table,
in either direction, and under a sort restored from an earlier visit. Before, they sorted with the
table like any other row, so a Name sort backwards or a price sort reordered them. `wt-data-table`
gained `rowKeepsChildOrder`, which the Products list turns on for a product's own row; categories
and products still sort as before. The order the product editor keeps (drag-reorderable, used by
menus and ordering) is unchanged: the list sorts a copy. No existing test assertion changed.
Left open, for the owner to decide whether it needs an item: the order reads each run of digits
as a whole number, so a decimal weight sorts wrongly — "0,5 kg" before "0,25 kg" (tried in Node
with the same comparison, not in the dashboard). The rest of the dashboard sorts names the same
way. _2026-10-05 (W85a): a product's variants now keep the product's own order, below; the
decimal-weight point no longer applies to them._

**Products: a product's variants are listed in the product's own order — DONE (W85a, #1207, owner
2026-10-05: "that would be ideal").** This replaces W85's name order, so W85's decimal-weight
point no longer applies to a product's variants; the number-aware name sort elsewhere still puts
"0,5 kg" before "0,25 kg". The Products list no longer sorts a product's variants: it draws them in the
order the API sends, which is the stored variant order the product editor shows and saves
(`listedVariantsOfProducts`, `packages/catalogue/src/operations.ts`, orders by `variantOrder`), and
`rowKeepsChildOrder` still keeps that order under every column's sort. Pinned in
`packages/catalogue/src/variants.test.ts` (two reorders through `setProductVariants`, each read
back by `listProducts`) and `apps/dashboard/src/widgets/product-list.test.ts`. Three existing
tests' order checks (W85's name-order group, the status-filter case and the variant-alignment case)
now check the product's order; listed in the PR.

**Products at phone width: a long name runs under the pinned Actions column, cut with no ellipsis —
DONE (W85b, #1243; W85c, #1245, owner 2026-10-05).** Found 2026-10-05 during W85a's check, and queued
by the owner the same day as two items:

- Fixed in W85b (#1243, 2026-10-05): at 390 px in the demo venue, with Croquetas' variants open,
  "Ración 10" showed as "Ración 1(" and the product's "4 variantes" as "4 variante", cut off by the
  pinned Actions column (`~/waitron-campaign/w85a-shots/shot-dark-390.png`, a local screenshot).
  The table is as wide as its widest row, so a long name widened the Name column and its end sat
  under the pinned column while the table was unscrolled. Every name in the Products tree's Name
  column — a category's name with its count and its asterisk for no active station, All products
  and its count, a product's name with its variant count, and a variant's name — now takes only the
  room between its own start and the row's pinned cell, measured as if the table were unscrolled,
  and wraps inside it, a single long word included. The room is measured a frame after the table
  resizes or redraws, by the same pass that already fitted the category name box (`#fitNames`,
  `apps/dashboard/src/widgets/product-list.ts`). A name that fits stays on one line. Pinned by the
  390 px, 430-to-390 px and 1280 px cases in `apps/dashboard/src/widgets/product-list.test.ts`; the
  redraws tested are a branch opened (also with the table scrolled sideways), a search and
  selection turned on. Not covered: while a category is being renamed, its count and
  asterisk follow the name box and are not capped _(2026-10-05: since W72g only at desktop width;
  at phone width they sit on the line above the box and wrap in what the grip and folder icon leave
  of the room before the pinned column)_. Wrapping was chosen over an ellipsis because a phone
  cannot show a cut name's full text. The open point (a name got about 46 px at 390 px, so most
  words broke part-way) was answered "maybe (b) and (c)" by the owner (b: drop the product photo at phone
  width; c: narrow the tree's leading slots), and **W85e** (#1275, 2026-10-06) did (b) and narrowed
  the arrow slot of (c): at phone width (the table's `narrow`) a product row draws no photo, and every tree's
  arrow slot is one cell padding (12 px) narrower, a toggle button keeping its 44 px tap target by
  reaching back over the 12 px before it, which on every row is inside its own cell. Measured in the demo venue at 390 px: a product's
  name room went from 55 to 123 px (English) and 46 to 114 px (Spanish), a category's up 12 px;
  laptop width unchanged. Categories keep their folder icon, so at phone width a product's name
  starts one folder slot before a sibling category's. The grip and the 8 px indent step were
  left as they were: the grip is a tap target, and a narrower step barely tells levels apart.
  At phone width a product's name also fills the room its photo gave up (the list re-fits names
  whenever the table's `narrow` changes), and a narrow toggle's focus ring is drawn inside the button so the
  scrolling box does not clip a top-level one. The Structure tree gains the same 12 px; its long
  names still clip at 390 px (W92's open point above).
  Left for the owner (the owner's answer was a "maybe"): keep, or undo, either half; hide the
  folder icon too at phone width so product and category names line up again; narrow the indent
  step. Before/after screenshots: `~/waitron-campaign/w85e-shots/pair-*.png` (local).
- Fixed in W85c (#1245, 2026-10-05): in the product editor's variant table the Unit button sat 4 px
  (`--wt-space-1`) after the word Price, which read as no gap. The two now have a `--wt-space-2`
  (8 px) gap between them (`.price-heading`, `apps/dashboard/src/widgets/variant-table.ts`),
  measured in real Chromium at desktop width, on one line, by the heading-gap case in
  `apps/dashboard/src/widgets/variant-table.test.ts`. A table 30rem wide or less hides that column
  and its button, so phone width is unchanged.

**Catalogue: no two categories with one parent, and no two Active products, share a name — DONE
(W72, #1214, owner 2026-10-05).** A category's name is now refused when another category with the same
parent (or another top-level category) already has it, on create, rename, move, the bulk move and
a delete that moves the contents up. An Active product's staff name is refused when another Active
product or Active variant anywhere in the venue has it, whatever its menu or category, on create,
rename, reactivation (a product coming back brings its Active variants' names with it), variant
save and the product editor's save. "Active" means the row's own switch is on and, for a variant,
its parent's too; a menu's own Active switch is not read. Names are compared ignoring case
(non-ASCII letters included) and surrounding spaces, in JavaScript, because this engine's
`lower()` folds ASCII only (`foldName`, `packages/catalogue/src/name-uniqueness.ts`). The checks run
inside the write's own transaction, which runs alone in the venue's write queue; there is no unique
index. Each product row stores its folded staff name in `products.name_key` (core migration
`0098_product_name_key.sql`: an added nullable column and a non-unique index). Every catalogue
write that sets the name writes the key beside it. A configuration import sets it from each
imported product's name; a bundle that carries it is refused. The product check looks other rows
up by that key instead of reading and folding every Active name in the venue, which made each save
cost more as the catalogue grew and seeding grow quadratically (a review finding). There is no
backfill: a row whose name has not been written since the column was added keeps a null key, and the
check does not see it until its name is next written (every product editor save writes it) or the
venue is reset. Refusals are `category.name_taken` and `product.name_taken`, both 409 with
`{ field, name }`, shown beside the Name field (or the variant row) in English and Spanish, the
draft kept. Only a clash the write creates is refused, so rows that already shared a name do not
block an unrelated save; a category that changes parent counts as new where it lands, so moving (or
moving up) two categories that already share a name into one parent together is refused. The product
editor checks its whole save at once, so variants may swap names. The demo seed's lunch "Mains"
reporting category is now "Lunch mains"; both menus still call their section "Mains", and a seed
test checks both rules on a fresh demo. Stored data is not renamed: a venue that already holds
duplicates keeps them until someone renames one.
A configuration import now holds a bundle to the same two rules (W72a, #1230, 2026-10-05): a bundle with
two categories in one place, or two Active products or variants, sharing a name is refused whole,
nothing written, when setup opens the export and again when it is imported
(`validateCatalogueConfiguration`, `packages/catalogue/src/configuration-transfer.ts`, run by
`validateConfigurationBundle`); both setup routes that reach it answer the two codes 409, as the
management API does (`PROVISION_STATUS`, `apps/server/src/setup-api.ts`). It judges what the import
will store: a product row with no `active` value counts as Active, the column's default, and a row
whose product `active` is not 0 or 1, or whose category or product name is not text, is refused with
`setup.request_invalid` naming the column. Setup's live-source screen then names the duplicate and
asks for it to be renamed in the prepared restaurant and exported again, in English and Spanish.
Also found in W72's review, and fixed in W72a: a configuration import used to replace ANY text
value equal to one of the bundle's ids with the new id, in every column (since `fabdb224d1`,
2026-09-10), so a product or category named exactly like an id in the bundle arrived renamed to a
random id. It now replaces ids only in a table's `id` column, its foreign-key columns, and the
columns a module lists as `references` for a reference the schema gives no foreign key
(`option_lists.default_label_id`, `device_profile_home_layouts.layout_id`). Those two were the only
such columns a probe found, run over every import in the transfer tests and an import of the demo
seed; a reference column added later that is no foreign key, `references`, `locationColumns` or
`omit` entry keeps the old id. Since W72d (#1238, 2026-10-05) a guard fails on one: `scripts/id-columns-are-references.test.ts`
migrates a real database and refuses any column of a transferred table whose name ends `_id` or
`_ids` that is not the row's `id`, a foreign key, a `references` entry, a location column or left out
of the export. It found one such column, `printers.poll_id`, which is free text the operator types
for a cloud-poll printer, and lists it as not a reference. It knows an id column only by its name,
so a reference named otherwise is still unseen.
Since W72b (#1236, 2026-10-05) both setup routes answer an export that cannot be opened as the restore
routes answer a copy that cannot be opened: `backup.artifact_invalid`, `backup.archive_invalid` and
`recovery.passphrase_invalid` get 422, where since `fabdb224d1` (2026-09-10) they fell to the
boundary's default 400. `image.invalid_metadata` and `content.language_invalid` are now listed at
the 400 they already got, which is what the media routes give them (`packages/media/src/routes.ts`).
Setup's live-source screen keys its sentence on the code, not the status, so it still shows the
could-not-open sentence for each.
Since W72c (#1237, 2026-10-05) an export leaves out each print agent's `node_id`, as it already left out
its token, host and last-seen time (`CORE_CONFIGURATION_TRANSFER`,
`packages/db/src/configuration-transfer.ts`). Before, an imported agent kept the exporting venue's
node id (a run of an export and import read the source venue's node id on the imported row), and the
Printers screen labels any agent with a node "On this box" (`apps/dashboard/src/screens/printers-screen.ts`,
read, not run). It now arrives with no node, like an agent a person enrolled; the importing box's
own agent still enrols as a new row beside it, as it did before (read, not run), because a new venue
gets a new node id. Giving the imported row the importing box's node was ruled out by a run:
self-enrolment found that row inactive and refused it with `device.join_revoked`. An export made
before this change that lists a print agent carries `node_id`, so setup refuses it with
`setup.request_invalid` naming `print_agents.node_id`; export it again.
Since W72f (#1252, 2026-10-05) an export also leaves out each print agent's `setup_url` and `setup_port`.
Before, a run of an export and import read the exporting agent's setup page address and port on the
imported row, and the Printers screen links an agent's host cell to that address
(`apps/dashboard/src/screens/printers-screen.ts`), so an imported agent would have linked to the
exporting machine's setup page. Both now arrive empty. The agents list builds an address from the
port only for an agent whose node is this box's (`apps/server/src/print-api.ts`, read, not run), and
an imported agent has no node, and no host either, since the export leaves that out too, so its host
cell reads "Not reported yet", with no link (`apps/dashboard/src/screens/printers-screen.ts`, read,
not run), until the agent is reconnected and reports its host, setup address and port again with
each job pull (`packages/print-agent/src/agent.ts`, read, not run). An export made between W72c
and this change listed both columns, empty ones included, so one that lists a print agent is
refused at setup with `setup.request_invalid` naming `print_agents.setup_url` (an older one names
`print_agents.node_id`, as above); export it again.
Fixed in W72e (#1241, 2026-10-05): at 390 px the Products tree's category name box used to cut its
duplicate-name refusal, and `category.invalid`'s, off against the pinned Actions column. The table
is as wide as its widest row, and the refusal's one long line widened the Name column past the
screen. The box now takes only the room before the pinned column, measured when it opens and again
after the table resizes or redraws, and its refusal wraps inside it; a box the table is scrolled
past is scrolled back to its start (`#fitNameBox`, since W85b `#fitNames`,
`apps/dashboard/src/widgets/product-list.ts`). The new box for a category being added is the same
box. Pinned by the 390 px cases in `apps/dashboard/src/widgets/product-list.test.ts`. The fix
changes only the name box, so the long product names in the phone-width entry above are not
affected (W85b) _(2026-10-05: since fixed, in the entry above)_. In the demo
venue at 390 px the tree's leading slots left the box about 55 px, so the refusal wrapped about one
word a line (local screenshots in `~/waitron-campaign/w72e-shots/`) _(2026-10-05: since W72g the
box has a line of its own at phone width, below)_.
Fixed in W72g (#1246, 2026-10-05, the owner's choice): at phone width, while the table carries `narrow`,
the category name box and its refusal sit on a line of their own under the grip, taking the room
before the pinned column from the grip's start. The grip, the folder icon and a renamed category's
count and asterisk stay on the line above, and the count and asterisk wrap in what the grip and icon
leave of that room. Measured in real Chromium at 390 px with the duplicate-name refusal shown, on
the test fixture's categories (Food and Drinks at the top level, Beer under Drinks): the box was 243
px for a top-level category and 235 px for Beer in English, 234 px and 226 px in Spanish; before the
change most of the same cases measured 118 to 135 px beside the icon. In the demo venue at 390 px,
after the change, renaming a top-level category and one a level down that were added for the check,
with a search typed and the duplicate-name refusal shown, the box measured 146 to 163 px on its own
line under the grip (local screenshots in `~/waitron-campaign/w72g-shots/`). Pinned by the "on
their own line" cases, the 1280-to-390 px case and the 1280 px "beside the grip and folder icon"
cases in `apps/dashboard/src/widgets/product-list.test.ts`; desktop width is unchanged. W72g left
Chromium logging "ResizeObserver loop completed with undelivered notifications" when the table
crossed 440 px while a name box was open. Fixed in W72h (#1247, 2026-10-05, the owner's choice):
`wt-data-table` now sets `narrow` a frame after its resize observer reports the new width
(`packages/ui/src/components/wt-data-table.ts`). `env -u AI_AGENT -u CLAUDECODE pnpm --filter
@waitron/dashboard exec vitest run src/widgets/product-list.test.ts` printed that error 31 times in
one run and 29 in another on main f92dc84e6, and none on the W72h branch after its last change.
Pinned by the "crossing the phone width into rows its layout makes taller" case in
`packages/ui/src/components/wt-data-table.test.ts`, which failed with the error before the change.

On 2026-10-05 A261-3 also observed this message while running
`pnpm --filter @waitron/dashboard exec vitest run src/widgets/folder-made-at.test.ts
src/widgets/catalogue-browser.test.ts`: both the transition candidate and the previous
`c41ed54910fece4add9f1475bf18034992545e99` commit in a frozen-installed disposable checkout
reported 164 passing tests and logged the message. Its cause on that path has not been established.

**Products: the Move dialog lists destination categories by full path in name order — DONE (W82, #1210,
owner 2026-10-04; since 2026-10-05 a tree, W82a, see the last paragraph).** The bulk Move
dialog's Destination list showed categories in the order the server lists them, by creation time and then id (`listCategories`,
`packages/catalogue/src/categories.ts`).
It now sorts them by the full path it shows ("Dinner / Mains"), with `byLabel`
(`apps/dashboard/src/widgets/category-form.ts`, the comparison the tables sort text with), so
"Menu 2" comes before "Menu 10" and case is ignored. "All products (top level)" stays first, the
moved categories and everything under them are still left out, and each entry keeps its category
id. Pinned in `apps/dashboard/src/widgets/catalogue-browser.test.ts`. No existing test assertion
changed. Left open: two sibling categories with the same name still show as two identical entries.
W72 (above) refuses new duplicates and changes the demo seed, but renames no stored category, so
duplicates already in a venue would still look the same. The same file's Delete dialog already tells such paths apart with
"(2 of 3)" (`#namedPaths` in `apps/dashboard/src/widgets/catalogue-browser.ts`); the Move list does
not use it. The order is by the whole path text, so a top-level name with a character that sorts
before "/" lands between "Menu" and "Menu / Zeta": "Menu (old)" did, measured in review with the
same `localeCompare` options as `byLabel`. The product editor's category picker instead lists
categories as a tree, each category's children under it (`categoryTree`,
`apps/dashboard/src/widgets/classification-fields.ts`). The dialog's `wt-combobox` sets neither
`searchPlaceholder` nor `noResultsLabel`, and `wt-combobox` defaults them to "Search" and "No
results" (`packages/ui/src/components/wt-combobox.ts`). So in Spanish the search box reads "Search"
(seen in the review's Spanish-session run), and an empty search would say "No results" (judged from
the code, not run). Other screens pass `t("categories.combobox_search")` and
`t("categories.combobox_no_results")`. This was on `main` before W82 (the dialog's combobox dates
from 2026-10-01, `5ffa5c633`).

Settled by the owner 2026-10-05 and built in W82a (#1229): the Move list is now the product editor's
category tree (`categoryTree`, `apps/dashboard/src/widgets/classification-fields.ts`), each
category's children indented under it and each level in label order, so "Menu (old)" follows
"Menu" and its children; a chosen destination and a search show the full path, joined with " › "
as the product editor does. The search box takes the translated "Search" and "No results"
(checked in English and Spanish in `apps/dashboard/src/widgets/catalogue-browser.test.ts`; the
English text is also `wt-combobox`'s own default, so the Spanish case is the one that proves
it). Two sibling categories with the same name are left as they are (owner: "leave it"): they still show
as two identical entries, in the tree and in a search. The path separator W82a's review asked
about is settled (owner 2026-10-05: every Products-screen path uses " › "; built in W82b, #1232): the
Delete dialog's list of categories (`#namedPaths`, `apps/dashboard/src/widgets/catalogue-browser.ts`)
joins a path with " › ", as the Move dialog does. The Products table shows no path since W84 (#1199)
removed its Main category column. Settled by the owner 2026-10-05 and built in W82c (#1262): the Menus
screen joins a path with " › " too — the menu prices table's Main category column and its filter
list (`menu-prices-table.ts`) and the add-products dialog's category picker
(`section-add-products.ts`) — because " › " (`PATH_SEPARATOR`) is now `categoryPath`'s default
(`apps/dashboard/src/widgets/category-form.ts`). The text the Products search box matches
(`apps/dashboard/src/widgets/product-list.ts`) holds each category path spelled with " › ", " / "
and " > ", so "Food / Meat / Grill", "Food › Meat › Grill" and "Food > Meat > Grill" all find a
product in Grill (the path-search cases in `apps/dashboard/src/widgets/product-list.test.ts`). The
menu prices table's search box matches a product's main category the same three ways
(`categoryPathSearchText`, used by both). Each spelling sits on its own line of that text, so a
search running from the end of one spelling into the start of the next does not find the
product: "Grill Food / Meat" does not find a product in Grill on the Products screen, and "Cerveza
Bebidas" does not find one in Bebidas › Cerveza in the prices table (a case in each suite). The search inside the Menus screen's two category pickers — the prices
table's category filter and the add-products dialog's category list — matches only the text the
list shows, so a path finds its category there only when typed with " › "; one category's name
alone still finds it. Those pickers are the shared `wt-combobox`, whose search matches the text
each option shows (its `valueLabel` where it has one, else its `label`); neither Menus picker sets
a `valueLabel`, and the combobox was left unchanged.

**Sales: the category report names each category by its full path — DONE (W73, #1212, owner 2026-10-04: "we should
report on category paths, not just the final name").** The Sales screen's category report showed a
nested category by its own name alone, indented, with its parents' names read only to a screen
reader; the printed page printed the name alone. So "Food › Mains" and "Lunch › Mains" both read
"Mains". Each category row now shows its parents' names before its own, in muted text on the
screen (`apps/dashboard/src/screens/dashboard-sales-screen.ts`), and the printed page prints the
whole path as the label (`apps/server/src/category-sales-page.ts`); a Directly-in row says
"Directly in Food › Mains" on both. The indent stays, so the tree's totals still read as before.
The path is built from the report's own tree, so "at time of sale" shows the recorded names and
"current" today's; no total changed. Uncategorised, Not recorded and the free-text names under Not
recorded get no path (a screen reader still hears "Not recorded ›" before the No category recorded
row and each free-text name, as before). On paper a no-break space joins each "›" to the name before
it, and the printer layout's `wrapText` (`packages/printing/src/layout.ts`) no longer splits a
too-long word just before or after a no-break space, so a "›" stays on a line with the end of the
name before it — except where a split falls on a line with under three columns of room (rows
nested about 13 deep on 58mm paper, about 19 on 80mm), or where a name's own no-break spaces leave
no other place to split. The `wrapText` change reaches every printed document: a word with a
no-break space inside it (a Spanish amount such as "123,50 €" written with one) that is wider than
its line is now split earlier inside the word rather than at the no-break space; this only happens
when one word is wider than a whole line. Because every row now carries its whole path, a very deep
tree prints far more lines than before: the page of the test "never prints a line wider than the
paper, however long the names or deep the tree" in `apps/server/src/category-sales-page.test.ts`,
printed at 58mm and 203dpi and counted in drawn lines, went from about 1,000 lines to about 14,500
(and to about 5,500 on 80mm), measured 2026-10-05, and its print preview is cut short; the owner chose to leave it as it is rather than shorten deep
paths on paper (2026-10-05). No other output names report categories: the reports API
answers with the tree, and no other screen or printed page reads it. One existing test check
changed, because this item changes what it checks: the screen's indent test asserted the parents'
names were hidden and now asserts they are shown; and five existing checks now expect the full
path where they expected the bare name (one on the screen, four on the printed page), listed in
the PR.

**Products: a category's Made at shows where its dishes are made — DONE (W86, #1203, owner 2026-10-04).**
In the Products tree each category row's Made at cell now shows the category's baseline route, in
the product rows' words (a station's name, No preparation, No replacement, Nowhere), linked to the
prep stations screen (`/manage/prep-stations`), where claims and exceptions are managed, never to
the single-product route tester. Under it, in smaller muted text, it says where the route comes
from — set on this category, from a named parent category, the default station, or an exception
that covers the category for every dish in every zone — and adds "some items made elsewhere" when
the route is not a promise for everything inside: a product or zone exception sends a contained
dish elsewhere, a subcategory routes somewhere else, or the station has opening hours or was
closed by hand today (the default station is always open, so it never gets this note).
The route is worked out in the browser with the shared `chooseMaker`
(`apps/dashboard/src/widgets/folder-made-at.ts`), as the server works out a product row's
(`describeMakers`): no service zone, the time of day not applied, a switched-off station's fallback
followed, inactive products left out. While routing has not loaded the cell stays blank; when the
routing read fails it reads "Kitchen routing unavailable" (the catalogue screen now tells the two apart).
All products stays blank. Product rows are unchanged, and no existing test assertion changed; the
catalogue screen suite's routing stub gained the `stationTimes`, `todayEnds` and `clockReadable`
fields the real answer carries. Left open: (1) a PRODUCT row reads "Nowhere" whenever the
made-at read holds no entry for it (`apps/dashboard/src/widgets/product-list.ts`, the `made-at`
cell, where `maker === undefined` falls to `product.nowhere`) — the same blank-read-as-no-route
problem this item fixed for categories, not fixed here. Judged from the code, not run: the first
load waits for `listMadeAt` before it lists products, and a failed first read fails the whole
load, so the gap is a product listed after the last good made-at read — a refresh still on its way
or one that failed, which keeps the old answer — and every inactive product, which the made-at read
never lists, so its row always reads Nowhere when the Status filter shows it; (2) a category's link is the same
`maker-link` as a product's, so the contrast concern and the missing `activatesRow: false` recorded
under W87 apply to category rows too (there a click beside the link opens or closes the category;
judged from the code, not run); (3) a person who may not read routing sees "Kitchen routing
unavailable" on every category, because a refused read counts as a failed one; (4) judged from the
code, not run: the category tree's red asterisk ("No kitchen routing rule covers this category",
`#unroutedFolderIds` in `apps/dashboard/src/widgets/catalogue-browser.ts`) works the route out with
no station timing, so it does not follow a switched-off station's fallback, while Made at does; a
category claiming a switched-off station that has a fallback can show the asterisk and a station in
Made at in the same row. _2026-10-05: settled by W86a (#1223; owner: "follow fallbacks"): the asterisk
now reads the same route as Made at (`coveredByRule`, in
`apps/dashboard/src/widgets/folder-made-at.ts`), so a category whose claimed station is switched
off and whose fallback chain reaches a station that is switched on shows that station in Made at
and no asterisk, while one whose chain reaches none keeps the asterisk and reads No replacement._
_2026-10-05: the asterisk's tooltip and accessible name now read "No active station assigned"
("Ninguna estación activa asignada"; W86b, #1231, owner's wording), key `folders.no_active_station`. The
old "No kitchen routing rule covers this category" read as if any matching rule cleared the mark._
_2026-10-05: changed by W86c (#1234; the owner's choice on the open point raised in #1231: the asterisk
clears whenever the dishes go to a switched-on station, the default station included, or to No
preparation): it reads the maker Made at shows (`isRouted`, which replaced `coveredByRule`), so a
category no rule covers shows no asterisk while the venue's default station is switched on, and
reads Nowhere and keeps the asterisk when that station is switched off or none is set. Like Made at,
it judges the category's baseline route and leaves out exceptions limited to one service zone or one
product._
(5) the "some items made elsewhere" note does not look at whether the categories involved hold any
products, so it can claim items that do not exist yet: a subcategory with no products whose own
claim routes elsewhere marks its parent (judged from the code, not run), and an empty category
covered by a zone exception, or routed to a station that keeps hours or was closed by hand today,
carries the note itself (the zone and timing cases in
`apps/dashboard/src/widgets/folder-made-at.test.ts` expect it on categories holding no products);
whether the words should change is the owner's call. _2026-10-05: the owner chose to keep these
words._

**A guided tutorial for Demo and Preparation (A250, owner 2026-10-03) — OPEN, partly designed, not
to be built yet (owner: "we just mustn't forget it"); needs a spec before queueing.** A walk-through
that teaches a new user what to set up and in what order — devices, printers, device profiles, and
the other settings a venue needs before it trades — shown in Demo and Preparation
(`onboardingIntent` `demo` and `prepare`). The user can leave the tutorial at any point and come back
later to carry on where they stopped.

Owner decisions from the 2026-10-03 brainstorm:

- **It teaches the real setup, never the pretend devices.** A lesson shows how to set up a real
  printer or card reader, or at least where to find the screen, even in Demo; it does not route the
  user through the pretend printer (A241) or the pretend card reader (A247), so it does not depend
  on them.
- **Two kinds of lesson.** A *tour* ("here is where you do this") is ticked off by the person. A
  *required* lesson ("you need to do this before going on") ticks itself when the server sees the
  work done, and the tutorial does not move past it until then. A person can also mark any lesson
  done or skip it by hand.
- **Everything the tutorial stores is per person**: each person's marks, skips and whether the
  tutorial is open. A required lesson still reads the venue's state, so it is ticked for everyone
  once anyone has done the work.

The owner's starting point for the lessons, in order (owner: "a good starting point"). The order
follows what depends on what: a newly approved device takes its printers from its profile's lists
(A238), so printers come before profiles and profiles before devices.

| #   | Lesson                                                          | Kind     | Ticks itself when                       |
| --- | --------------------------------------------------------------- | -------- | --------------------------------------- |
| 1   | Products: what you sell, prices, VAT                            | Required | at least one product exists             |
| 2   | Extras and options                                              | Tour     | —                                       |
| 3   | Menus: put products on a menu and publish it                    | Required | a menu is published                     |
| 4   | Kitchen: preparation stations and where tickets go              | Tour     | —                                       |
| 5   | Floor plan, for table service                                   | Tour     | —                                       |
| 6   | Printers: receipt and kitchen printers                          | Tour     | a printer exists (ticks, never blocks)  |
| 7   | Device profiles: what each kind of device may do, its printers  | Tour     | —                                       |
| 8   | Devices: open the till on the device, approve it in the dashboard | Required | a device is approved                  |
| 9   | Card payments: connect a card reader                            | Tour     | a reader exists (ticks, never blocks)   |
| 10  | Staff: the team and their PINs                                  | Tour     | a second person exists (ticks, never blocks) |
| 11  | Receipts: what the receipt says                                 | Tour     | —                                       |
| 12  | A first sale on the till                                        | Required | a sale from a device (sample sales do not count) |
| 13  | Backups: a copy off the box                                     | Tour     | backups are set up (ticks, never blocks) |
| 14  | Going Live: export the setup, start the Live box (Prepare only) | Tour     | —                                       |

In Demo, lessons 1 and 3 tick themselves at once (the sample restaurant has products and a published
menu) and stay open as tours; lesson 14 is not shown, because Demo reaches Prepare by a wipe, not a
copy. The owner account made at setup already has a till PIN, which is why staff is not required.

Facts found while designing: going Live never happens on the same database — Prepare to Live is a
fresh database plus the configuration copy (`apps/server/src/configuration-export-api.ts`,
`apps/server/src/configuration-import.ts`) and Demo to Prepare is a wipe — so progress stored in the
venue database ends at Live unless the configuration copy is made to carry it. The sample restaurant
is seeded in Demo only (`seedDemo`, called for `mode === "demo"` in `apps/server/src/setup-api.ts`);
both modes get the three default device profiles (`DEFAULT_DEVICE_PROFILES`,
`packages/layouts/src/device-profile.ts`).

Still open for the spec: whether a required lesson blocks every lesson after it or only those that
depend on it; whether any of content languages, the canvas editor, rosters and working time,
purchasing or Cloud services gets a lesson; whether a printer or staff should be required; how the
tutorial is reopened (the Demo bar, A246, W36, is the obvious place); whether it spans the till as
well as the dashboard; and how each required lesson's check is read without slowing the dashboard.
It comes after the Demo bar (A246, W36) and A238, whose device and profile model it teaches.

The original walkthrough is retained under *Detail → Setup wizard*.

### A3. Printers from the dashboard

**Built:**

- Paper width and resolution per printer, with every document formatted to them — #367.
- Add opens a prefilled naming dialog, printed instructions follow the user's language, and
  development servers no longer advertise `waitron.local` — #380.
- The calibration wizard, drawer attachment with its own audited test, receipt QR sizing and
  centring, the Printers screen's status filter, one-click disable, setup-page links and the
  print-agent list's filter — #689, #699, #704.
- Office printers greyed out in the scan (a read-only IPP query on port 631 reporting A4 or US
  letter) — #359.
- Check a known address: the Add-printer dialog takes an IP and port and asks the approved agents
  to try it — #335.
- Print-agent setup lockdown — #732
  ([design](superpowers/specs/2026-09-27-print-agent-setup-lockdown-design.md),
  [plan](superpowers/plans/2026-09-27-print-agent-setup-lockdown.md)).
- Bluetooth: the agent's detection, Pair and Forget (P2b, #877); Pair and Forget from the dashboard
  (P2c, #884); later scans ask about devices an earlier one did not reach (A137, #894); Pair and add
  in one step (A138, #899); Unpair reachable on a switched-on printer (A141, #902); a job the agent
  cannot send fails with a reason (A139, #904); printing over RFCOMM channel 1 (A140, #909); Scan
  for printers keeps going while Add a printer is open (C102, #953); the scan pass runs beside the
  job pull (C117, #955); row layout, Unpair on one press and fading notices (C103, #957); a
  succeeded Unpair switches the printer off (C109, #960) and ends its waiting jobs as
  `printer.unpaired` (A163, #962).
- A printed resend or reprint clears the printer's `printer.jobs_waiting` alert for the job it
  copies — Printers-screen resend (A165, #972), the till's Reprint and receipt reprint (A167, #975).
- Every printout's text is printed as pictures in Iosevka Term Bold; the character-set settings and
  calibration step are gone; the wizard is width ruler, sample receipt, cash drawer (C107, #974).
- Print test page in each printer's row menu (C108, #976).
- The row menu column pinned to the table's edge on a phone: the Printers tab (A145, #935), every
  `wt-data-table` (A155, #950), the adjustment reasons table (A162, #954).
- Printer details use a breadcrumb and one bounded column of Status, Connection and Calibration.
  Name, network connection and Active edit there; the calibration wizard opens at paper settings
  (W96).

**Owed at the box — nothing here has run on real hardware:**

- **Upgrading a venue that has used its printers refuses to start.** C107's generated migration
  (`packages/db/drizzle/0055_drop_printer_character_set.sql`) rebuilds the `printers` table; with
  one row in any of `print_jobs`, `station_printers`, `tills`, `devices` or `drawer_opens` pointing
  at a printer, `applyMigrations` throws `migrations.apply_failed` at ``DROP TABLE `printers` ``
  with "FOREIGN KEY constraint failed" and the whole core step rolls back. A box applies migrations
  as it starts (`apps/server/src/boot.ts`), so a box whose venue has printed anything will not start
  on this version until its venue is reset (read from the code, not run on a box). Pre-live, there
  is no data migration (CLAUDE.md §3); the owner's box has printers. C107 landed before the box test
  by the owner's decision (2026-10-01: "land now, test after"); anything the box timings or
  photographs show wrong becomes a new item.
- **Photographs and timings of pictures on paper.** The owner's photographs of a receipt, a kitchen
  ticket, the ruler page, a sample receipt and the test page (C108) on both printers are owed, and
  so are the box's timings (what to time: `docs/developers/testing-guide.md`, "How long a job of
  pictures takes to print on the box is not measured").
- **Nothing physical has been verified since #327:** discovery, paper output, whether a device knock
  reaches the box while the Add agent dialog is open, the five-line feed before the cut, Bluetooth
  discovery, and the receipt preview against printed paper. #324's slips, duplicates and drawer pulse
  have never produced paper either.
- **On-paper verification is still owed on the TM-T88III** (spec "Verification on paper" steps 1-6):
  whether the printer's built-in QR command prints anything at all, and whether the mandated 30-40mm
  QR size is meant to count the code's blank border or only its dark squares.
- **Repeat the 58mm physical receipt after the print-area fix.** The owner's wider printer clipped
  the right edge of a 58mm receipt whose payload centred without an explicit print area; whether the
  printer's own width setting also contributed was not tested. The corrected paper output has not
  yet been printed. Since C107 the print area is the image's width — 360 or 384 dots on 58 mm paper,
  512 or 576 on 80 mm.
- **Nobody has yet typed a real printer's address into Check a known address.** The owner's home is
  the case that motivated it: the box sits on 192.168.10.x and the HP LaserJet on 192.168.20.x,
  which the port-9100 sweep cannot reach. The first things to try on the box: add the Epson at
  `192.168.10.81:9100` (the sweep should also list it) and print to it; then type the HP's
  `192.168.20.56:9100`, which should come back as an office printer.
- **The setup-page link is unproven on the box.** The print agent builds it from
  `WAITRON_SETUP_URL` (set on the box as `WAITRON_PRINT_AGENT_SETUP_URL`, which `deploy/compose.yml`
  passes through), or from the first of `WAITRON_BOX_ADDRESSES` (`apps/print-agent/src/config.ts`);
  no review seat ran the deployed compose and nobody has yet followed the link from a dashboard on
  the real box.
- **Bluetooth at the box.** A first real pairing, and an Unpair, through the dashboard and the
  agent, under the shipped AppArmor profile with bluetoothd's `autopair` plugin off — nobody has
  yet paired or unpaired a real printer through the dashboard. `waitron.sh install` switches
  `autopair` off with a systemd drop-in where it can (`deploy/README.md` says when it leaves
  Bluetooth alone), and the operator then types the PIN, 0000 for a 0000 printer; that drop-in was
  tried on a GitHub runner, where the Bluetooth service itself never ran, and has not run on the
  owner's box. Also owed: whether a real Bluetooth service sends `Agent1.Release`, which the
  profile does not allow and the CI stand-in never sends; what the box's real adapter reports as
  paired; time a pairing through the dashboard (whether scanning while pairing slows a real pairing
  is not measured — the agent keeps scanning through a pairing because skipping the scan would drop
  every unpaired device from the list).
- **Printing over RFCOMM from INSIDE the print-agent container (A140).** A real RFCOMM connection
  and print from inside the container under the shipped profile — CI's runners cannot load
  Bluetooth at all — and whether the printer gets every byte before the connection closes. The
  owner printed on channel 1 from the host only. image-smoke runs the helper directly with its own
  arguments, not through `RfcommTransport`, and only as far as creating the socket; and
  `scripts/deploy-image-env.test.ts` reads the Dockerfile and `package.json` as text, so it does not
  prove the bundle's default helper path resolves inside the image. The helper's 20 + 20 second
  connect and send timeouts and the agent's 5-second grace (`apps/print-agent/src/rfcomm.ts`) were
  not measured on the box.
- **The owner's Bluetooth printer was listed only under Show all devices (A137) — the cause on the
  box is not confirmed.** It needs the fixed image on the box first: run
  `docker compose exec print-agent bluetoothctl --timeout 6 scan on`, then
  `docker compose exec print-agent bluetoothctl devices`, and record how many devices are listed
  and where the printer falls among them; then open Add a printer repeatedly, record on which scan
  the printer is first marked, and look for `bluetooth info failed` lines in
  `docker compose logs print-agent`.

**Open — printing:**

- **Adding a language to the venue also means adding its printer captions, and a language written
  outside the Latin letters means widening the font table.** The width ruler's captions are
  exhaustive over the locale list (`CAPTIONS` in `apps/server/src/test-page.ts`), so a new locale
  fails to compile until its captions exist. Printed letters come from a table holding
  U+0020–U+007E, U+00A0–U+017F and the rest of Windows-1252's letters and signs
  (`packages/printing/scripts/build-glyph-table.mjs`); anything else prints as `?` unless dropping
  its accent leaves a letter the table holds (`prepareText`, `packages/printing/src/text.ts`). A
  language needing Cyrillic or Greek needs the table regenerated with a wider range, if the font has
  those letters (not checked).
- **Left open by C107 (#974):**
  - Whether a job of pictures still needs the print area (`GS L`/`GS W`) that receipts, category
    pages and the test page send is not measured. The calibration ruler page sends a print area of
    576 dots whatever the printer.
  - At 203 dpi a line could hold 32 columns on 58 mm paper (384 ÷ 12) and 48 on 80 mm (576 ÷ 12);
    it keeps 30 and 42.
  - The 28-dot line cuts letters: by the generator's own report, 67 of its characters lose at
    least one dot that was half inside the letter, most of them accented capitals losing the top
    of the accent. Measured 2026-10-01 with a copy of the generator: a 30-dot line with the
    baseline 24 dots down leaves 3 (ď, ĥ, ŉ), and 31 or 32 dots still leave those 3.
  - The preview reads at most 4 MiB of a job and shows at most 2,048 blocks (one per printed
    line, feed, cut or QR code, among others), so a job of more than about 2,040 lines is cut
    short at any width. The deep-tree case in `apps/server/src/category-sales-page.test.ts`
    printed about 14,500 lines on 58mm paper once rows carried their whole path (W73).
  - What a printer narrower than 576 dots does with the part of the ruler beyond its head is not
    measured. The preview shrinks a picture wider than the job's line instead of cutting it, so on
    the ruler page, whose captions are 360 dots wide, the 576-dot ruler is shrunk on every
    printer.
- **Follow-up (ruling C): the preview no longer shows the QR link as text** for a raster receipt.
  A possible fix is to carry the link alongside the print job so the preview can still show it as
  text.
- **Deferred (ruling H): the receipt logs no warning when no legal QR dot size exists.** No logger is
  reachable from `receipt-print.ts`, and in practice the fallback is unreachable today for any link
  `validate.ts` accepts (`apps/server/src/qr-link-range.test.ts`).
- **Building the QR raster runs inside the sale-recording transaction** (via `formatReceipt` in
  `enqueueSaleReceipt`). The JavaScript QR encoder can throw on an oversized link, which would roll
  the sale back — but every link `validate.ts` accepts is within QR capacity
  (`qr-link-range.test.ts`), so this is unreachable for a real sale. If we ever want belt-and-braces
  against §5, wrap the raster in a `try/catch` that falls back to the printer's built-in QR command
  — at the cost of a QR whose size we no longer control. Left as an owner decision, not applied.
- **A calibration drawer opening records who asked and when, not that the drawer opened.** There is
  no drawer sensor; the audit row is the request.
- **Printer details follow the dashboard's own language, not the venue's** (ruling I) — a
  recorded departure from the spec, which asked for the venue language.
- **Still counted by the printer's `printer.jobs_waiting` alert after A167 (#975)**, measured with
  throwaway cases and not pinned: (1) when every dish a failed ticket carried for a station moves to
  another bill, that bill's printed Reprint clears the table's problem, but the ticket's link to the
  bill it was fired on is never covered, so the printer's alert keeps counting it. The table also
  drops a problem once a Reprint would print nothing there (`readReprintTargets`), which the alert
  does not. (2) A Printers-screen resend of a kitchen ticket carries no kitchen links, so when that
  resend runs out of attempts, a later printed till Reprint does not clear it from the printer's
  alert (the table clears).
- _2026-10-01 (3c-3): a dish moved to another station leaves its ticket at the old station's
  printer counted by that printer's stuck alert in the same way, because nothing reprints there._
- **The virtual PDF printer**, and a `print_jobs` retention sweep — nothing deletes a job today.
  Deleting a print job also deletes its `kitchen_print_jobs` link rows (the key is
  `ON DELETE CASCADE`). Deleting a failed job's links clears its printing problem, and deleting a
  printed reprint's links brings back the failures it cleared, so a sweep must remove a bill's
  kitchen print jobs all together or not at all. It must also keep or remove a resend chain
  together: deleting a printed resend brings back the "in trouble" state of the job it copied (for
  a resend of a till Reprint, also the original kitchen ticket's alert and the table's problem that
  it cleared), and deleting a chain's first job while a resend still names it is refused by the
  `resend_of` key (read, not run). A receipt copy now adds an append-only `receipt_reprints` row
  with a required `print_job_id` key using `ON DELETE RESTRICT`
  (`packages/db/src/schema/receipt-reprints.ts`); include that audit link when designing retention.
  Whether a future replication drain can carry the audit row to a node without its print job is
  unverified and needs a test when that drain is built.
- **Printing A4 invoices on an office printer** (owner, 2026-09-14): a separate design, not started.
  It reverses the 2026-09-09 provisioning design's "raw ESC/POS only" decision and needs an A4
  invoice layout, a way to send a PDF to the printer over IPP (the standard office printing protocol,
  port 631; the owner's HP accepts PDF directly) and rules for which documents go to which printer.
  It would share the PDF rendering with the virtual PDF printer above.
  _2026-10-03: designed as A231d (above), for full invoices; not built._

**Open — finding and adding printers:**

- **Office-printer greying is proven on one office printer only.** The owner's HP Color LaserJet
  MFP M181fw's real reply is a test fixture, and the live query marked it from a Mac on the owner's
  network. It has not run from the box's container, and no receipt printer that answers IPP has
  been captured, so "A4 or letter means office printer" is a heuristic with one data point.
- **A printer reported by its `.local` name may stay addable.** From a Mac, resolving the HP's
  `.local` name took 5 seconds, past the 1.5-second limit, so it was left unmarked. Not tried from
  the box's container, where the lookup may fail outright; either way the printer stays addable.
- **A typed address receives one HTTP request on port 631** after its connection check succeeds.
  The 2026-09-12 address-check design allowed any unicast address (public, loopback, link-local)
  because the check sent nothing; that reasoning no longer covers the follow-up query.
- **One failed office-printer query can flip a marked printer back to addable** until the next query
  30 seconds later, because the server keeps only each agent's latest report — unless another agent
  reporting the same address has marked it. Accepted as the fail-open cost.
- **No promise about how long a known-address check takes end to end.** The dialog polls and
  reports a fresh result, but nothing bounds the round trip from pressing the button to an answer.
- **Two review suggestions on #335 were deliberately not taken** and would be relitigated otherwise:
  renaming the error code `printer.probe_busy` (kept under the domain-naming rule, per #335's
  commit message), and deduplicating targets in the agent host (the issuing server already
  normalises and deduplicates its bounded list of eight).
- **While a discovery window is open, a device not reported within 45 seconds drops off the list**
  until its next report; 45 seconds does not cover every scan pass (C102, #953).

**Open — Bluetooth (read, not run, unless a line says otherwise):**

- **A command queued behind a slow pair can run out of time.** The 120 seconds count from queueing
  (`enqueue` in `apps/server/src/printer-bluetooth-commands.ts`), the agent runs commands one at a
  time (the background worker in `packages/print-agent/src/agent.ts`), and one pair can take the
  agent up to about 90 seconds (`REGISTER_TIMEOUT_MS`, `PAIR_TIMEOUT_MS` and `EXIT_GRACE_MS`,
  10, 75 and 5 seconds, in `apps/print-agent/src/bluetooth-command.ts`). A second command
  waiting behind that pair can therefore expire on the server before it runs; its outcome is
  then ignored and the screen says "No answer from the print agent — try again" whatever
  actually happened.
- **A Printers screen element taken out of the page and put back does not restart its background
  status checks:** `disconnectedCallback` stops them and `connectedCallback` only reloads the lists
  (`apps/dashboard/src/screens/printers-screen.ts`). Today nothing puts the same element back; it
  matters only if the app starts keeping screen elements.
- **A failed Pair or Unpair shows the agent's reason as the agent wrote it, in English on both
  languages' screens** (a wrong PIN would read "No se pudo emparejar: wrong PIN"). Most of what the
  agent reports for a pair is a fixed phrase (`apps/print-agent/src/bluetooth-command.ts`). A
  follow-up could translate the known phrases into dashboard wording in both languages and keep the
  raw text as a detail; nothing here says what a given BlueZ error always means on a real printer.
- **At phone width a Bluetooth address breaks mid-group** ("00:11:22:33:44:5" then "5"), because
  of the width limit on the device details added on 2026-09-11.
- **Left open by C109 (#960):** the printer details' Active switch can still switch a paired Bluetooth
  printer off without unpairing it. Leaving the Printers screen mid-calibration asks the server to
  switch the printer off; if that request fails nothing reports it and the printer stays on, and
  closing the browser tab mid-wizard does not switch it off. Leaving the screen while a Save is in
  flight and that save then fails, or in the moment between Enable switching the printer on and
  the wizard opening, also leaves it on. While it is on during calibration, jobs already queued for
  it can be handed out (since A163, jobs a succeeded Unpair ended no longer print; jobs kept in the
  cases the next item lists, and a printer switched off with Disable, can still print after
  Enable). Keeping the printer off until calibration is saved would need a calibration-only
  print path for a switched-off printer, since `enqueuePrintJob` refuses one and `claimPrintJobs`
  claims only switched-on printers' jobs.
- **An Unpair outcome that reaches the server after it dropped the command leaves the printer on**
  (120 seconds, `COMMAND_TTL_MS` in `apps/server/src/printer-bluetooth-commands.ts`); the owner can
  switch it off with Disable, which the row then shows. The printer's waiting jobs are kept in that
  case, after a server restart (the command store is held in memory), and for a printer unpaired
  outside Waitron; Disable keeps them too.
- **A Bluetooth printer no agent reports paired still waits with no reason on the job (A139's "not
  covered")**, as a USB printer no agent sees does. With two agents, one that cannot print over
  Bluetooth leaves a paired printer's jobs alone while another agent has reported, within the last
  15 seconds (`DISCOVERED_TTL_MS`, `apps/server/src/print-api.ts`), that it can print to that
  printer; that report is held only in the server's memory, so after a server restart, until the
  other agent's first pull, the first agent still ends the job. A140 left this as it is: it needs
  two agents, one of them older than A140.
- **RFCOMM always uses channel 1.** Nothing looks up a printer's channel, so a printer whose serial
  port is on another channel fails each job with the connection error.
- **Follow-ups A140's review raised, not done (owner's call):**
  - `BluetoothTransport` (`packages/print-agent/src/transport.ts`, with its export and tests) is
    unused in production and still models a device-file path.
  - `liveBtDevicePath`, the `btDevicePath` option and the try/catch in `visibleDevices`
    (`apps/print-agent/src/linux-devices.ts`) can go; the `/dev/rfcomm…` fixtures in
    `apps/print-agent/src/linux-devices.test.ts` model a shape production no longer has, and
    changing them changes existing tests.
  - A139's chain for an agent that cannot print to Bluetooth (`failUnprintableBluetoothJobs`, the
    `bluetoothPrinting` wire field, the error code) has no shipped agent reporting `false` now: keep
    it for an older agent, or delete it before go-live. The jobs list shows "—" in place of the
    attempt count for a job ended with that code.
  - The 10-second paired-listing reuse in `resolve()` (`PAIRED_REUSE_MS`,
    `apps/print-agent/src/linux-devices.ts`) is a chosen window, not a measured one, and a printer
    unpaired outside the agent resolves as attached for up to 10 seconds.

**Open — screens:**

- **Row menus in plain `<table>`s are unchecked at phone width.** `variant-table.ts` and
  `option-list-form.ts` (`apps/dashboard/src/widgets/`) put a `wt-row-actions` in a plain table,
  not `wt-data-table`, so `pinned` does not reach them; `member-list-editor.ts` and
  `product-editor.ts` also contain both a `<table>` and a row menu (found by grep, not read). None
  has a phone-width case and none was measured.
- Read-back gaps: the print-mode and
  `drawer_open_policy` toggles are set-only (the latter gates cash access); the Impresoras editor
  leaves agent and transport re-binding read-only though the API accepts it.

### A4. Till, displays and devices

- **Service, ordering and billing: planned and queued on lane B (2026-09-26).**
  [Design](superpowers/specs/2026-09-20-service-ordering-and-billing-design.md), Revision 2,
  approved by the owner and merged as #693;
  [plan](superpowers/plans/2026-09-26-service-ordering-and-billing.md), Revision 2, eighteen tasks.
  Task 0's [bill payments design](superpowers/specs/2026-09-26-bill-payments-design.md) is approved
  (#698). Every task has landed: Task 1 #706, 2 #715, 3 #733, 4 #748, 5 #750, 6 #761, 7 #789,
  8 #806, 9 #814, 10 #908, 11 #916 (with lane B's B11a–B11g), 12 #923, 13 #903, 14 #721, 15 #956,
  16 #981, 17 #991. "Visit" is "party" everywhere since the table actions plan (below). What stays
  open, by task:
  - **The card refund path records only after the provider call, with a fresh key each time.**
    `reverseViaStripe` (`packages/payments-stripe/src/reverse.ts`) sends a fresh `randomUUID()`
    idempotency key on every call and writes `payment_refunds` only after the call returns, so a
    crash between the two leaves no record, and a repeat would send a new key. SumUp's refund sends
    no key at all. Its only product caller is the reconciler's reversal of an abandoned order's
    capture (`packages/payments-stripe/src/reconciler.ts`); refunding a bill's card payment before
    its invoice goes through the separate durable path of Task 14 (design §6b). **Next action:**
    give the reconciler's reversal, and any post-invoice refund route when one is built, the same
    durable-attempt rule.
  - **Task 1 (#706, adjustment reasons).** The reasons screen keeps its own copy of the role list
    and role names (C51 sorts its dropdowns by displayed name, with a separate seniority order for
    validation) and of the placeholder-filling helper in
    `apps/dashboard/src/widgets/menu-preview.ts`. **Next action:** move both into
    `@waitron/dashboard-kit` if a third module screen needs them.
  - **Task 2 (#715, a record per seated party).** `service_commands` rows are never pruned. The
    venue setting `clearing_workflow` is off by default and no dashboard control sets it yet.
  - **Task 3 (#733, order groups).** Left open from the PR: a cross-party merge can leave a settled
    check's lines naming a group now on the target party; the deleted `moveTabLines` ignored groups,
    and whether the paths that move lines now do the same is not checked; a whole-order save
    replacing a held dish with another variant moves it to a new held group at the end; the
    counter's whole-order save does not answer the party's revision; and the table screen offers no
    Send on a held no-route dish outside any group (its per-line Send needs a kitchen ticket item,
    `sendsAlone`, `apps/till/src/state/held-groups.ts`) — whether one can occur on a party's tab is
    not established.
  - **Task 4 (#748, the table screen works with order groups).** Left open:
    - **Fire all now / Fire selected now are offered under every `fire_control` setting** (the
      plan's test text wanted them hidden under `kitchen`/`expo`); a one-line gate in `#draftBar` if
      the owner wants it.
    - Group summaries come from the server, so a weighed quantity shows a dot decimal in Spanish
      (a summary shows only when Current orders cannot be read).
    - Group numbers are the server's positions, so the list can read "Group 1, Group 3"; the
      preview gives counts, not contents.
    - The screen's older small buttons are 32 px tall, under the 44 px tap target.
    - Per-line Send and Change have no guard against a second press while the first is running
      (Cancel has one since B11a; the group commands have one).
  - **Splitting a held line's quantity on the till takes one request per unit.** Splitting a
    quantity of N sends N−1 move requests in turn (`#onSplitGroupLine`,
    `apps/till/src/till-app.ts`), because the move route refuses a request naming the same line
    twice (`moveLinesToGroup`, `apps/server/src/order-groups.ts`). A refusal part-way leaves the
    units already split. **Next action:** a server command that splits a line into single units in
    one transaction.
  - **Task 5 (#750, kitchen, pass and table screen by group; printing problems).** Left open:
    - A party finished while its food is still on the pass keeps its cards there with no group
      button that works (each is refused `party.not_open`); a question for the owner.
    - "Ready" and "Fired N min ago" on the table screen are the plan's default, not an owner
      decision.
    - A fired group with nothing for the kitchen (bottled water, say) never reads Ready.
    - `*** REPRINT ***`, `GROUP n`, `*** HOLD ***`, `*** FIRE ***`, `*** HOLD CHANGED ***` and
      `*** HOLD CANCELLED ***` print in English. Since B11g the extra-cancel slip is the one kind
      whose header word and cancel line follow the server's locale (`WAITRON_TILL_LOCALE`, `es-ES`
      when unset), so by default a held slip reads `*** HOLD CAMBIADO ***`, `GROUP n` and
      `QUITAR:`, mixed on one slip.
    - A switched-off printer's printing problem keeps showing until the printer is switched on
      and a Reprint prints there; there is no way to dismiss one.
    - A failed ticket on a pass printer (one ticket for the whole order) shows on the card of
      every station it covered, even where that station's own printer printed; it stops showing at
      a station once a Reprint of the bill would not link that pass printer to that station.
      _2026-10-01 (slice 3d): the whole-order printer is gone; a watcher's copy is linked to no
      station and shows no printing problem (W23)._
    - Finish table drops the problem of a bill that transfers emptied (read, not run; not
      re-checked by B6a).
    - After a merge, a reprint of the absorbed bill that was still waiting at the merge clears
      nothing when it prints, so its warning stays until the merged bill is reprinted once more
      (`moveKitchenPrintLinks`, `apps/server/src/kitchen-print.ts`). The same holds when dishes move
      by transfer, split or a line move: a copied ticket never counts as a reprint. Not tested as a
      rule: move a dish from bill A to bill B, reprint B so it prints, move the dish back, and A
      shows its old failure again.
    - Only dishes whose unit does not print on the ticket — sold in Each by the unit's identity
      (`readLinesSoldInEach`), or with no unit recorded on the line — are added together or split;
      a venue-made unit that counts pieces (a "portion"), even one spelled like Each, prints line
      by line, because nothing records a unit's kind (a unit field would need a migration).
    - The kitchen-ticket grouping setting sits on Venue settings' **Kitchen** tab,
      and so does "Print held groups in advance", which is not about sent work at all.
    - `fireHeldGroupsOfCourse` (`apps/server/src/order-groups.ts`), through which a course Fire
      still fires a party's held groups, is to be removed in a follow-up.
    - Every pass press moves the party's revision, so a waiter's open Tab drawer meets
      `party.out_of_date` after it and reads again.
    - Setting up a venue from an imported configuration deletes every kitchen station, and the
      `kitchen_print_jobs` station key has no delete rule; whether that venue can already hold
      link rows at that point was not tested (read, not run).
    - The pass's Ready and Away record no `order_group_events` row, so who pressed them is
      recorded nowhere readable; a new kind changes that append-only table's check, which is a
      core migration.
    - Questions for the owner: the kitchen and pass screens offer Fire on every held group, where
      the plan's text said "the first held group"; and the table screen reads its printing
      problems in a second request beside the groups read on every table load (folding them in
      would change the exact-body assertion in `apps/server/src/till-api.groups.test.ts`).
  - **Task 6 (#761, HOLD tickets in advance).** Left open:
    - A failed HOLD correction slip (HOLD CHANGED or HOLD CANCELLED) raises no "Printing problem",
      like every correction slip: none is recorded in `kitchen_print_jobs`.
    - A printed HOLD ticket goes stale when held groups are reordered or a party is merged into
      another (both renumber `GROUP n`), and when the party's table moves or is joined, since no
      MOVED slip goes out for held work (`readSentWork`, `apps/server/src/kitchen-print.ts`). Only a
      FIRE ticket or a Reprint can be relied on.
    - Whether a group's HOLD ticket was queued is recorded per group, not per station, so a
      correction, and a Reprint's REPRINT and HOLD section, can print at a station whose printer
      never printed that group's HOLD ticket.
  - **Task 7 (#789, each person's draft kept on the server).** Left open:
    - A draft that moves to the other party in a merge, because its owner had none there, records
      no history event: the event kinds have no "moved".
    - The server's own `unavailable` flag (`apps/server/src/order-drafts.ts`) does not flag a line
      whose options list is unanswered (refused at submission `options.label_required`), a
      fractional quantity of a dish sold whole (`quantity.invalid`), a course switched off since
      the save (`course.not_found`), or a menu version no longer live (`menu.version_changed`).
      For the first two, since Task 8 the till marks such a line `unit_changed` once the table's
      offers are read (`lineBlock`, `apps/till/src/state/menu-refresh.ts`); it moves a line saved
      against an older version to the live one.
    - Only the draft routes fold the ids in the path to lower case (`requireDraftPartyParam`,
      `apps/server/src/till-api.ts`, and `submitDraft`'s `joinGroupId`); the other party routes
      only check that the id is an id, and the group submission passes `joinGroupId` on as sent.
    - After a takeover into the taker's existing draft, or a merge that discards a draft, the
      previous owner's next save of the old draft is answered `draft.not_found`, not
      `draft.taken_over`.
    - A save must carry `draftId` and `revision` even for a new draft. A chosen option whose label
      id is not a UUID is refused `options.invalid` at save, where pricing answers
      `options.label_required`. An options or extras refusal at save names only the field, not the
      line, and the till shows one message for the whole draft (`asRefusal`,
      `apps/till/src/state/draft-sync.ts`), so it names no line.
    - Three rulings made on the branch for the owner to confirm: a line whose quantity is not a
      whole number never adds into another line; Finish table discards the party's open drafts,
      keeping their lines, instead of refusing while one is open; taking over someone's draft when
      you already have one adds their lines to yours and discards theirs, instead of refusing.
  - **Task 8 (#806, the till works from the server's drafts).** Left open:
    - Saving and sending:
      - An edit can be lost at sign-out without a message: one made after the session had
        already ended (an inactivity sign-out), and one made while an earlier save was still
        waiting for its answer when sign-out began.
      - If someone else signs in while a sign-out is still waiting for its save, the till skips
        signing the first person out on the server, so that session lasts until it expires.
      - A send cut off by the 150-second limit is not sent again, and after a reply that never
        came the draft can stay locked for up to two limits: the send, then the re-read.
      - When a send is refused because the menu changed, the re-read of the table's menu runs
        outside that limit.
      - After a draft refusal whose re-read also fails, the till keeps the draft's old revision,
        so the next Send is refused as out of date and re-reads first: a wasted round trip.
      - While the till follows a party onto its next bill, the screen can show no draft for a
        moment; and when a merge or move coincides with a refused save, the save's message can
        replace "another device changed this table".
      - Drafts are not pushed to other tills: Sam's till sees Alex's latest draft only at its next
        read. Taking over an older copy is refused and the table read again.
    - Other people's drafts:
      - When the take-over added Alex's lines into Sam's own draft, Alex sees "Sam has an unsent
        order", not "Taken over by Sam": `takenOverFrom` on Sam's draft is empty.
      - At phone width nothing on the menu view says other people have drafts on the table; the
        button reads "Review (0)". The floor's mark does say so.
      - Three automatic changes to the draft (`adoptLines`, `removeLines` and `clear` on the
        till's store) are not blocked while a take-over is out. Read in the code, not run.
      - The Spanish "has taken over this order" wording has no test.
    - The floor:
      - The map tag says "Unsent" but not whose.
      - At 390 px the map overlaps and clips crowded tables, so a table's tag can hide under a
        neighbour.
      - A token near the plan's top edge is cut off by that edge: each token is centred on its
        position (`translate(-50%, -50%)`, `packages/ui/src/components/wt-floor-canvas.ts`), so a
        chip that grows it ("Time to fire", A117) pushes its label above the map's clipping edge
        on a 390 px map; the Spanish chip also runs past the token's right edge, and a round
        token's "Reservada 22:30" chip was seen doing the same. The owner chose on 2026-09-29 to
        land #891 with the chip inside the token and fix this later. Since service Task 10 the
        token also carries the table's signal chips, one row each; seen in screenshots, not
        measured: at 390 px a floor of six tables with two or three chips each overlapped so much
        that tokens covered each other's chips, and at 1280 px they did not. **Next action:**
        decide whether the map keeps a token inside the plan, or the chip hangs off the token's
        edge like "Unsent".
      - The map gives its "forgotten table" corner marker no spoken name.
    - The table screen:
      - Seating a table whose answer arrives while a newer table is still opening shows the seated
        table briefly before the newer one replaces it.
      - A refused seat leaves the till pointing at the refused table.
      - If the screen widens while Back on the Review view has focus, focus goes to the page.
      - A dish no longer on the menu shows an empty name on its tick button in the person's own
        draft, and in the spoken names of its course picker and Split quantity button (read in
        the code, not run).
      - The last-added bar is empty for a draft read back from the server until the next tap, and
        does not follow a weighed line when the server's answer replaces the lines.
      - While a weight is being entered, the weight entry covers the bottom of the menu and the
        bar.
      - "Review (N)" counts items (Beer ×2 counts 2), while the floor's mark counts lines and
        calls them "items", so the two can differ for one draft.
      - Keep lasts only until the server's answer rebuilds the lines; a kept line then asks
        Remove or Keep again.
      - A dish no longer on the menu, saved at a whole quantity, counts by that quantity on
        Review; its unit is unknown, so a weighed one saved at exactly 2 kg counts 2.
      - The counter's basket also tracks its last-added line, which it does not use.
    - Menu changes:
      - The server's "cannot be sold" mark is dropped once the till's newer menu read passes the
        line. That the two checks agree was read, not run; if they differ, one Send is refused
        `product.unavailable` and the line is marked again, which a test covers.
      - Every line priced under an older menu version is asked about whenever the server's draft
        replaces the till's lines (a reload, a re-read, a take-over), so the question comes more
        often than it would for a person who watched the menu change.
      - A line naming a version the till does not hold costs one more read of the table's menu.
      - The "The menu has changed" dialog shows a focus ring round the whole dialog box.
    - Tests: the accessibility test "has no violations with the round grid, the per-line course
      picker and the open tab drawer" no longer scans the menu grid (a phone test does), but kept
      its name. `repriceRebuilt`'s `menuItemId ?? ""` fallback
      (`apps/till/src/state/menu-refresh.ts`) is not covered. Whether a real till's browser ever
      paints the narrow layout for one frame before going side by side was not measured.
    - Rulings made on the branch for the owner to confirm:
      - after a reload the old price of a line is not known, so the till asks about every line on
        an older menu version, showing the new price alone, instead of storing prices on the
        server;
      - the two layouts are chosen by the screen's width against 720 px, not by the kind of
        device, so a tablet held upright shows the menu and the draft side by side;
      - −1 on the last-added bar at one takes the line out;
      - anyone may take a draft over, including the person it was taken from;
      - a line counts as unsellable when the till's check or the server's says so, and the
        server's mark gives way to a newer menu read on the till;
      - Cancel on the menu-change question holds until the next publish, re-read or Send, not
        the next poll.
  - **Task 9 (#814, served by quantity, release reminders, Current orders).** Left open:
    - A line outside any group that needs no kitchen, held, and first released after its bill was
      paid could not be marked served (`group.line_held`), because `stampSent` wrote `sent_at`
      only on an open bill. Since B21 (#969, core `0053`) `stampSent` writes on any bill but an
      abandoned one; whether this case is now served was not measured.
  - **Task 10 (#908, the service dashboard's attention signals).** Defaults the branch chose, sent
    to the owner as an FYI (not the owner's rulings):
    - A bill request is cleared only when a PAYMENT leaves the party's family with nothing to pay;
      other ways of leaving nothing owed keep the request until staff press Cancel or Finish table
      closes the party.
    - Merging a party that asked for the bill into another drops its request.
    - The long-wait chip counts only dishes sent to the kitchen, not held ones.
    - The floor's to-serve, ready and long-wait figures include paid bills and the bills of
      parties merged in, so a venue that never records serving sees a paid table's dishes as
      waiting until Finish table.

    Left open, for the owner:
    - The floor's older waiting band (`timingBand`, which colours the card and shows "Forgotten")
      still counts HELD dishes, while the long-wait chip counts only dishes sent to the kitchen. So
      a table whose only work is a held course queued long ago shows "Forgotten" with no wait chip.
      **Next action:** decide whether `timingBand` should also count only dishes sent.
    - The "Take order" chip has the same primary border on a neutral fill as the "Reserved"
      badge, and the "Bill requested" chip is filled primary like the "N en camino" badge, so each
      pair looks alike. **Next action:** decide whether the chips get tones of their own.
    - At 390 px the map's tokens carry chips and overlap more: see Task 8's "The floor:" above.
    - The till drops the bill request's late answer, a refusal included, once the waiter has
      signed out or left the party (`#onRequestBill`, `apps/till/src/till-app.ts`), stricter than
      most of C81's table actions. **Next action:** decide whether a late refusal should be said.
  - **Task 11 (#916, cancellations, comps and discounts; B11a–B11g).** Left open:
    - A configuration imported at setup replaces the default "Entry error" cancel reason with the
      imported venue's reasons, so importing from a venue with none leaves the new venue with none,
      and the till's dialog then says so (`adjust.no_reasons`); whether setup should add the default
      after such an import is the owner's to decide. Registering a till
      (`apps/server/scripts/register-till.ts`) runs the same seed, so it would add the default to
      such a venue.
    - **The adjustment history records who approved, but not whether the bill's discount limit,
      rather than the reason, is why.** Recording it would need a column. **Next action:** decide
      whether to record it.
    - **A placed pay-later counter order (`ticket_then_pay` or `invoice_first`) cannot be
      adjusted:** the placed-order trigger freezes its prices, and an `invoice_first` order has
      already filed its invoice. B16 lets such an order be handed over before it is paid but did
      not decide this. **Next action:** decide whether a placed order can be adjusted before it is
      collected.
    - **The server's held-order edit (`PUT /api/working-orders/:id`) still voids a sent dish's
      dropped quantity without a reason** when a client sends it that way, the venue allows changes
      to sent items and the kitchen has not started the dish (`applyLineEdits`,
      `apps/server/src/working-order.ts`). The till's counter hides × and `−` on a sent dish only
      while it has read the order's lines; when they cannot be read, it shows both on every line.
      **Next action:** decide whether the edit should refuse dropping a sent line.
    - **Two basket changes the app makes by itself do not check the edit lock:** the menu poll's
      price-version update of the basket's lines (`adoptLines`) and the order's label
      (`WorkingOrderStore`, `apps/till/src/state/working-order.ts`). What is lost is the basket's
      own copy of the new prices. **Next action:** decide whether the two should wait for the lock.
    - **Nothing on screen shows the lock.** A tap on `+` or on the menu does nothing until the
      order and its lines have been read. How long it lasts on a real network is not measured.
      **Next action:** dim the basket, or show a one-line note, while `editsLocked` is set.
    - **Override PIN limits (C89, #951), for the owner:** the two PIN prompts say "wait a moment"
      rather than counting down the seconds the server sends, as the sign-in screen does, and the
      approver prompt hides the message as soon as someone types; the limit is an optional
      argument, so a future route taking an approver's PIN could leave it off unnoticed; and the
      dashboard's `verifyManagerPin` (`apps/server/src/payments-api.ts`) and the till's sign-in
      route each still repeat the steps `verifyThrottledCredential`
      (`packages/identity/src/credential.ts`) packages. The tests do not check that a refund's
      wrong PINs share the drawer's and adjustments' count, that the sign-in and override counts
      are separate, or that the count is per device. **Next action:** the owner decides whether to
      add the countdown and make the limit required.
    - **A reason's percentage limit can be exceeded** by combining a bill discount with a line
      discount, or two bill discounts under one reason, because a bill discount counts as 0% on
      each line. A row split off by splitting the bill, by a transfer, or by moving part of a line
      to another group starts with no percentage history. B11b's venue limit on a bill's total
      discount can ask for a manager's PIN; this per-reason cap is unchanged. **Next action:**
      decide whether the per-line cap should see bill discounts.
    - **Settled (owner, 2026-09-30):** part of a weighed line stays refused for a give-away or a
      discount (`adjustment.weighed_partial`); staff discount the whole line instead.
    - For an extra of a held dish whose HOLD ticket was queued, cancelling it tells the kitchen
      (B11g) but the till's cancel dialog still says only that it comes off the bill, because the
      till cannot see whether the HOLD ticket was queued. **Next action:** decide whether the till
      should be told that.
    - An extra counts its dish's percentage under a reason's per-line cap, and a dish the largest
      of its extras', which errs toward refusing. **Next action:** none unless staff find it gets
      in the way.
    - **Only give-aways and discounts split part of a dish with its extras.** Splitting a bill,
      transferring items and moving part of a dish to another group still refuse a partial move
      of a dish with extras (`tab.transfer_modifier_line`). A whole dish moves with its extras.
      **Next action:** decide whether those partial moves should split extras too.
    - **`pressEscape` in `packages/ui/src/components/wt-dialog.test.ts` waits a fixed 50 ms after
      each Escape.** That is deliberate, as its comment says: with `closeReportsDelivered` between
      presses, Chromium 153 let every Escape be refused, and a dialog without `closedby` passed the
      repeated-Escape tests. The variant form's "saves on Enter and cancels on Escape from a focused field",
      once listed here with it, is fixed (A220f, #1075; see the flaky-test entry). **Next action:** decide
      whether "closes on a real Escape press" should wait for its `wt-close` instead, keeping the
      timer for the stays-open tests.
    - The till's "Amount off (€)" writes the euro sign into the label rather than taking the
      venue's currency. How a comp or discount appears on the invoice is still asesor Q29.
  - **Two till tests wait a fixed real time for a resend to give up** (found 2026-09-30, B13). In
    `apps/till/src/till-app-bill-payments.test.ts`, the cases that send the next operator's same
    payment, and same refund, under the id of one that got no answer after its operator logged
    out each sleep `SUBMIT_RETRY_PAUSE_MS` after failing the lost send: the one retry pause, after
    which the send sees the session has ended and gives up, before the next operator signs in.
    Neither case reads anything that marks the giving up.
    **Next action:** run that pause on fake timers, as the lost-reply case in
    `till-app-drafts.test.ts`'s "a Send the session outlives" does.
  - **A till request's `frozenExtras` and `frozenOptions` are taken as already settled, prices
    included** (found in #903's review; I believe it predates that branch). `priceOrderLines`
    (`apps/server/src/working-order.ts`) trusts them as sent: a unit-level `parkOrder` call given
    an extra priced `"0.00"` at quantity 7 stored it at price 0, over its list's limit of 2. Read,
    not run: the park and held-order edit routes in `apps/server/src/till-api.ts` appear to pass
    `body.lines` through unchanged. **Next action:** send such a line through `POST` park and the
    held-order edit route; if it is stored, re-price or refuse client-sent frozen selections at the
    route boundary.
  - **Task 12 (#923, adjustment reports).** Left open:
    - A weighed item cancelled in part can differ by a cent between the cancel's list value and
      what stays on the line, so a rate can be a cent's share off. **Next action:** none unless
      someone sees it matter.
    - With no day picked, a screen left open past the day's cutover moves to the new, empty day;
      the date inputs show it, nothing announces it. **Next action:** decide whether it should
      keep the day it opened on.
  - **Task 13 (#903, standalone ordering).** A product's `ordering` is Public, Staff only or Not
    sold separately; Staff only behaves exactly as Public until guest ordering exists.
  - **Task 14 (#721, several payments against one bill, the server).** The owner's rulings at
    landing are recorded in the design. **Its payment and refund reads ordered by a timestamp alone
    now break a same-millisecond tie with `rowid` — DONE (W2, #1121, 2026-10-03).**
    - **Open:** `apps/server/src/orders-list.ts` (#1027) sorts bill payments and their refunds by
      `created_at, id` and tenders by `id` alone; ids are `randomUUID()`, so a tie, and the tenders'
      whole order, comes out random. The plan asked for `created_at, rowid` in `readBillPayments`.
      **Next action:** a `rowid` tie-break, with a test whose ids sort against the writing order.
  - **Task 15 (#956, several payments on the till).** Open:
    - **Owner call on wording:** the table's button is labelled with the whole sentence "Part of
      this bill is already paid: take the rest as a bill payment", while the counter's says "Take
      the rest". Left as it is.
    - Giving money back after the invoice stays out of scope for `BillPaymentView` (bill payments
      design §6).
  - **Task 16 (#981, counter handover; with B25, B26, B29, B30).** Open:
    - **The kitchen queue's Collect sends no submission id**, on the station screen and on the
      counter's prep-queue card, so a Collect resent after a lost reply is refused
      `working_order.already_collected`. The waiting list's Hand over sends one. Assertions pin
      the no-id call in `apps/till/src/till-app.test.ts`,
      `apps/till/src/screens/till-station-screen.test.ts` and `apps/till/src/api/client.test.ts`.
    - **A collect straight after Place order does not re-read the kitchen queue.** The till
      re-reads it after a collect only when the collect was opened from the waiting list, so the
      prep-queue card can keep showing the order without Collect until the queue is next read
      (read in `#onCollectOrder`, `apps/till/src/till-app.ts`, and `#collectAction`,
      `apps/till/src/widgets/station-queue.ts`; not run). Re-reading after every collect would stop
      the case "a switch to a prepay zone ends a kitchen-queue retry, and that retry's late failure
      does not bring the notice back" (`apps/till/src/till-app.test.ts`) proving what its title
      says, so B16 left it.
    - **Completed orders can now be looked up on the dashboard, and an unpaid bill can be found on the till.** B27a adds the server's list, detail,
      staff, printer choice and audited receipt-copy routes; B27b adds the dashboard screen and its
      receipt-copy action. B27c adds Find a bill on the till. Spec:
      `docs/superpowers/specs/2026-10-01-dashboard-orders-design.md`.
    - **The waiting list is drawn only inside the held-orders card**, so a canvas without that
      card shows no waiting list.
    - **Not measured — Pay on a sent `invoice_first` order whose invoice was credited may show the
      wrong total in the basket.** The waiting row shows what collecting charges (the invoice net
      of its credit notes, `readIssuedSales` in `apps/server/src/sale-due.ts`), but Pay loads the
      basket from `GET /api/working-orders/:id/placed`, which carries the order's lines. Reported
      by B16's review fixer from reading; no test shows it.
    - Lane B item B31 (owner, 2026-10-02): a handheld whose layout has a Counter tab, or a
      held-orders or prep-queue card, loads the counter's lists at login (since C130 a till
      likewise loads them only when its layout shows one), and a handheld is offered the card
      reader, on any pay card and on a bill, only when its device
      profile has integrated card payment (`#showsCounterLists` and `#cardReader`,
      `apps/till/src/till-app.ts`). A till follows its profile the same way (C129, #1025); one with no
      device reads no capabilities at boot, so it is not offered the reader
      either, and the built-in till profile has the capability. When the server still refuses a
      reader payment with `device.forbidden_action` (a profile that lost the capability after the
      till started), the counter and the bill say "This device is not set up to use the card
      reader" (`card_reader.not_set_up`). At login each counter list shows its own failure with a
      retry notice, so one list that fails no longer stops the others loading (they are still read
      one after another, so a read that hangs still delays the rest); this changed for tills too.
      Left as it was: a handheld never opens the drawer (2026-10-04: changed by A238 — a device
      whose profile allows the drawer opens it, handhelds included). (Its Station, Pass and Schedule buttons
      now follow its profile — C130 below.)
    - **Done (C128, #1031) — who may take a payment.** Every till or handheld payment route now also needs
      `sale.take_payment`, which every role holds; detail in `docs/developers/conventions-ui.md`.
    - **Done (C131, #1032) — the counter's pay card goes back to its choices after a reader payment.**
      Once a reader payment ends with no card outcome to show — refused, failed, or captured — the
      pay card leaves "Tap or insert card…" for its Cash and Card buttons, with any refusal in the
      banner; a retry, and the kitchen-station question that can come before one, belong to the
      attempt, and the spinner comes down once no card attempt is still running (`cardAttemptsOver`,
      `apps/till/src/widgets/tender-pay.ts`). A bill's pay dialog already dropped the text when its
      request settled.
    - **Done (C130, #1056) — a device shows the screens its profile assigns, and the person's permissions
      decide the rest.** A device profile has three switches, "Kitchen button", "Pass button"
      and "My schedule button" (`show-station`, `show-expo`, `show-schedule` in
      `CAPABILITY_FLAGS`, `packages/layouts/src/canvas.ts`), on for the built-in till profile and off
      for the handheld one; the till offers each header button only when its profile has the switch
      and its layout has no tab of that name, on any device. The lists loaded at sign-in and the
      first screen come from the layout on every device. The till's sign-in answer carries the
      person's permission list instead of one yes/no, and the till locks only the cards whose
      permission the person lacks (today the table-plan editor); the server still checks every
      permission itself. The till's unused routes to add, rename and remove a table
      (`POST`/`PATCH`/`DELETE /api/tables`), which checked no permission, are gone. A sign-in that
      something newer replaced while it was still loading — a second person signing in, the idle
      lock, or the till moving to another server — now stops at its next step and installs nothing
      further (`#onLoggedIn`, `apps/till/src/till-app.ts`); what it had already installed before
      that step is cleared or overwritten by the event that replaced it (a logout or a server
      switch clears the name and permissions, a newer sign-in overwrites them). Before, it could
      put the earlier person's name and permission list back on the till, or open the till with
      nobody signed in; this predated C130 (the same steps on main installed the person and the
      table-plan yes/no the same way).
      Left open: a till profile saved before C130, and one newly created on the Device profiles
      screen, has the three switches off until a manager turns them on; a till with no device reads
      no capabilities, so it shows none of the three buttons. A change to a device profile reaches
      a till only when the till starts again — a page load, a move to another server or a
      re-enrolment, or in dev mode the lock screen's switch-device button (the profile is read in
      `#boot`, `apps/till/src/till-app.ts`, as the layout and the hardware switches already are),
      so signing out and in again does not pick it up. Seen in a visual check on 2026-10-02: at
      390 wide a handheld's till header ran past the right edge (the page measured 736 wide;
      Kitchen, Allergens, the operator's name and Log out sat off-screen; fixed by lane C's W27,
      below), and turning the switches on adds buttons to it. A review measured the header on
      2026-10-02 in real Chromium at 390 px, with the real `till-tab-shell` mounted with two phone
      tabs and an operator signed in: with only Find a bill offered — what main offers every
      handheld; `apps/till/src/widgets/tab-shell.ts` is unchanged by C130 — the page measured
      560 px wide in English and 602 px in Spanish, so the overflow predates C130 (the overflow
      PF6 Task 9 recorded; that entry, near the top of this file, is done under lane C's W27); with
      the three switches on it measured 843 and 867 px, and the Pass and My schedule buttons sat
      wholly off-screen (fixed by lane C's W27, below). On the handheld, the station screen's back
      button says "Back to counter" though a handheld on the built-in phone layout lands on the
      floor plan; and clicking the knob (`span.thumb`) of a
      `wt-switch` that is on does not turn it off (clicking the label or its left edge, or Space,
      does), seen on the Device profiles screen, on the existing "Integrated card payment" switch
      too — the same knob already left open under A215 (clicking a variant's row); `packages/ui`
      is untouched by C130. The knob is DONE by W76 (#1218).
    - **Done (C133, #1045) — the till's tabs fit one screen, with or without a notice above them.**
      The page gives the till the screen less its padding (`apps/till/index.html`), and the error
      banner and the other notices above the tabs take their height from the tab shell, so the
      language button stays on screen. The lock and join screens fill at least the height left; a
      staff list longer than the screen still makes the page scroll to reach the language button,
      as it did before. Before, the page was taller than the screen even with no banner, by the
      body's padding and the demo strip. (Since A187, 2026-10-02, the language chooser is at the
      top right of the lock screen.)
      Left from C133's review, not changed there: the table-order screen's bottom bar still keeps
      a tap target and two gaps clear at its end (`padding-inline-end` on `.bottom-bar`,
      `apps/till/src/screens/till-table-order-screen.ts`) for a floating language button the till
      no longer has — the language button now sits in the tab shell's top bar (A187). Removing the
      space changes the screen's layout, so it is its own change. Likewise the till's
      `.submitted-toast` (`apps/till/src/till-app.ts`) still sits one tap target and two gaps
      above the bottom edge, the room the old bottom-right language button (later the footer)
      took; decide whether it should drop to the bottom edge. On the dashboard, the language
      chooser's menu is now a native popover in the top layer (A187), so it paints over the alert
      pop-up (`.alert-toast` in `apps/dashboard/src/dashboard-app.ts`, which hangs below the
      banner at its trailing edge with `z-index: 40`, a stacking order the top layer ignores): where
      the two overlap, an alert arriving while the menu is open is hidden under it, and its
      countdown keeps running,
      since `wt-toast` (`packages/ui/src/components/wt-toast.ts`) pauses it only while the pointer
      or keyboard focus is on the pop-up. Decide whether an arriving alert should close the menu.
    - **Done (lane C's W27, #1140) — the counter header fits at phone width.** The header, its tab row
      and its button group wrap onto further rows (`apps/till/src/widgets/tab-shell.ts`). Measured
      in real Chromium at 390 px: with Find a bill, Kitchen, Pass, My schedule, Allergens, the
      language chooser, the operator and Log out all shown, every one sits on screen in English
      and Spanish, and with six tabs in English (`apps/till/src/widgets/tab-shell.test.ts`). The
      whole till app, signed in on a handheld profile in the setup of the "a round at phone width"
      case (`apps/till/src/till-app-menu-refresh.test.ts`), measured 390 px wide where it measured
      601 px before — a probe added for the measurement and removed, not a kept assertion. The
      cost was measured on 2026-10-03 in real Chromium with the tab-shell test's fixture (every
      optional button on, operator "Ana Fernández"); after the fix every figure here was the same in
      English and Spanish. At 390 px with two tabs the header takes four rows and is 237 px tall, on
      an 844 px-tall phone screen. At 1280 px with two tabs it keeps one row, 69 px tall, as before
      the fix. At 1280 px with six tabs it wraps onto a second row, 125 px tall; before the fix it
      kept one row, 94 px tall in English and 77 px in Spanish, and the page ran past the right
      edge, 1349 px wide in English and 1378 px in Spanish. Lane C's W27 takes this cost rather than
      adding a breakpoint: the wrap is sized by the controls, as the data table's toolbar is
      (`docs/developers/design-system.md`).
    - The dashboard's "Test open drawer" calibration
      (`POST /management-api/printers/:id/test-drawer`) opens any active printer's drawer for a
      manager holding both `printer.manage` and `cash.drawer`, with no per-till check — left as it
      is (owner, 2026-10-02).
    - **For the owner:** a card taken on a connected machine that also prints a paper merchant
      slip opens no drawer; B30 covers only the machine Waitron does not talk to.
    - From B29's review, not fixed there: a cash sale with automatic receipts reads the device's
      receipt printer twice in one transaction (`enqueueSaleReceipt` and `enqueueSaleDrawer` each
      call `resolveReceiptPrinter`) — resolve it once; every change on the dashboard's Printing
      rules screen reloads all its data through `#mutate` → `#load()`
      (`apps/dashboard/src/screens/printing-rules-screen.ts`), even `#setPrintMode` and
      `#setDrawerPolicy`, which update their own state in place.
  - **Task 17 (#991, a table that leaves without paying).** Asesor Q28 was decided by the owner
    without the asesor (2026-10-01): the full simplified invoice is issued when the table leaves.
    Open:
    - **Known limit, kept by the owner's decision of 2026-10-01 — a bill holding a payment cannot
      be left unpaid** (`unpaid_departure.bill_holds_payment`, even one given back in full): its
      invoice would have to be settled in part, and `settleSale`
      (`packages/core/src/settle-sale.ts`) refuses a settlement whose payments do not add up to
      the amount due. Such a table can only be finished by taking the rest as payment.
    - **Collecting PART of the debt later is not built**, for the same reason. Collecting it in
      full uses `POST /api/working-orders/:id/collect`.
    - **A dish never sent, on hold or recalled blocks the departure**
      (`unpaid_departure.unfired_dishes`); staff cancel it first.
    - **Find a bill replaces the counter's list.** A till or handheld can search unpaid bills by
      invoice number, order number, table or party name, then collect one. The dashboard Orders
      screen's Unpaid filter shows the same debts. The till-cancel question was C126, now built:
      see its entry below.
    - **The till's departure dialog lists a presented bill credited to nothing as owing its full
      amount — DONE (W26, #1136, 2026-10-03).** `GET /api/parties/:id/bills` now gives each bill with a
      filed sale an `amountDue`, its invoice's total plus its credit notes, read through
      `readIssuedSales` as the departure reads it, and the dialog lists each bill at that, so a
      bill credited to nothing drops out of the list and the button's total.
    - **The table screen still reads a credited presented bill at its full amount.** Its per-bill
      "to pay" line (`apps/till/src/screens/till-table-order-screen.ts`, `bill.outstanding`) and
      the party's total (`apps/till/src/till-app.ts`, summing each bill's `outstanding`) read no
      credit note either, so a presented bill whose invoice a credit note has reduced, in part or
      to nothing, without the bill being cancelled, still shows its full total there (read, not
      run). The partly paid bill's "to pay" line and its pay-the-rest button
      (`apps/till/src/screens/till-table-order-screen.ts`, `partlyPaid.outstanding`) read
      `outstanding` too, but that section is drawn only for an open bill holding a payment
      (`paidInPart`, `apps/till/src/state/bill-state.ts`), and an open bill has no invoice, so no
      credit note reaches it today (read, not run). **Next action:** decide whether those read
      `amountDue` too, which W26 left out because other screens and the floor read `outstanding`.
    - **A 0.00 simplified invoice:** B17's departure, and since B28 (#1005) Pay on a bill whose
      total is zero, file one; whether AEAT accepts it was not tested.
    - **Left by B28's review (#1005), neither acted on.** (1) The reader pay's `tipOf`
      (`apps/server/src/till-sale.ts`) treats a `null` tip as no tip, against CLAUDE.md §3's rule
      that a default applies only when the field is absent; it predates B28, and paying a non-zero
      bill on the reader is believed to accept it the same way (read, not run). Next: a route case
      sending `tip: null` to `POST /api/pay`, then decide refuse or accept. (2) After a free sale
      settles on the reader, a stale card-attempt mark on the order is left in place; manual Pay is
      believed to leave it the same way (read, not run).
    - **A bill presented without an invoice keeps the label it was placed with when the departure
      invoices it.** Every other path that invoices such a bill saves the receipt label in the
      update that settles it; the departure leaves the bill placed, and the placed-to-placed clause
      of `working_orders_enforce_transition` (latest in
      `packages/db/drizzle/0056_placed_order_handover.sql`) requires the label to stay as it is
      (measured 2026-10-01: saving it made the departure answer 500). Not measured: what its
      invoice's reprint and the debt list then show. Fixing it needs that trigger to allow the
      label to change. A bill the departure settles because it owes nothing goes through
      `settleIssuedOwingNothing` (`apps/server/src/till-sale.ts`), which sets no label, although
      the trigger allows one there.
  - **Gaps against the service plan's acceptance checks (spec §12)**, from a sweep on
    2026-10-01:
    - **The merged-party check of §12 item 9 used only a bill whose state is written by hand —
      DONE (W4, #1124, 2026-10-03):** `apps/server/src/parties.test.ts`, "is owed on the surviving party
      and blocks Finish until the till collects it under the invoice filed at placing".
    - **No permanent test lays the service screens out at phone and till widths in both themes
      (§12 item 14).** The axe scans run in both themes, mostly at the browser's default size with
      one block at 390 px (`apps/till/src/screens/till-table-order-screen.a11y.test.ts`).
  - **A keydown guard that cancels Escape while a save runs did not keep one dialog open.** On
    Task 1's reasons screen (`packages/adjustments/src/dashboard/reasons-screen.ts`) a real Escape
    during a save closed the editor although its keydown handler called `preventDefault()` and
    `stopPropagation()`; the screen now sets `wt-modal`'s `dismissible` to false while busy, and
    `wt-dialog` sets `closedby="none"` while `dismissible` is off. Why that screen behaved
    differently has not been established. The same keydown guard is on other dashboard forms:
    those whose tests press a real Escape during a save also ignore a close while busy in their
    `wt-close` handler, except the Departments and zones screen
    (`packages/venue-service/src/dashboard/venue-operations-screen.ts`), whose handler has no such
    check and which does not set `dismissible`. The rest were tried only with a hand-built
    `KeyboardEvent` (`sections-screen`, `modifiers-screen`, `add-to-menus`, `extra-list-form`,
    `option-list-form`, `option-label-form` and `variant-form`, under `apps/dashboard/src`; the
    menu prices window that was also on this list went in W89) or not at all (`#guardEscape` in
    `apps/dashboard/src/screens/menus-screen.ts`). **Next action:** repeat the reasons-screen case
    recording which element has focus just before the Escape; then press a real Escape during a
    save on each form tried only with a hand-built event or not at all, and move the ones that close
    to `dismissible`.
  - **C126 (cancelling an order whose invoice was issued credits it; owner, 2026-10-02, option b,
    decided without the asesor) — landed as #1030.** `POST /api/working-orders/:id/cancel` (`cancelPlacedOrder`,
    `apps/server/src/working-order.ts`; the credit in `apps/server/src/cancel-credit.ts`) now issues
    an R5 corrective invoice, by differences, for the whole invoice in the same transaction, settles
    the original at nothing owed and abandons the order; an order with no invoice is abandoned with
    nothing filed.
    It needs `sale.rectify` from the signed-in person, or from someone holding it who enters their PIN
    (B33, below), and an enrolled device, whose till the credit
    note is filed on, and refuses a bill holding a payment or with one in flight. Any placed order,
    invoiced or not, is now refused `order.payment_in_flight` while a card payment of it is running
    at the reader in this process. The till's table screen (B32, below) and the counter's waiting
    list (B34, below) call it. The owner
    dropped the dashboard Orders screen's "Invoice not credited" mark (2026-10-02 ~12:05): such a bill is to show as Cancelled
    with its credit note. B27a landed first (#1027) with the mark — `invoiceNotCredited` in
    `apps/server/src/orders-list.ts` and its cases in `apps/server/src/orders-list.test.ts`; C126,
    landing second, removes them and updates those cases (owner-approved), and checks an
    abandoned bill before Paid in `BILL_STATUS`, since the cancel settles the invoice. Open:
    - **Done (B33, #1041, landed 2026-10-02): the PIN of
      someone holding `sale.rectify` (a supervisor, manager or admin) lets someone without it cancel and
      credit an invoiced order.** The cancel's
      body may carry `override: { personId, pin }`, checked as an unpaid departure, a bill refund
      and opening the drawer check theirs: a wrong PIN is `pin.invalid` and is counted, per device
      and per person, in the count those routes share (`overridePinAttempts`,
      `apps/server/src/till-api.ts`), so wrong tries on any of them add up to one lock-out (the
      case shows four wrong tries on the cancel locking out the drawer too); the PIN of someone
      without the permission (staff, in the case) is
      `authorization.not_permitted`. The credit note's `sales.authorized_by` names the person whose
      PIN was entered, or the operator when the operator holds `sale.rectify` (the override is then
      not checked), and
      the cancel's amendment names the person who cancelled. `recordCorrection` checks the
      permission again and counts nothing, so the cancel checks the PIN first, with counting, and
      then hands the same override on; the PIN is therefore checked twice on success. On an order
      with no invoice the override's PIN is neither checked nor counted, though a malformed
      override is still refused. Cases:
      `apps/server/src/cancel-invoiced-order.test.ts`, "cancelling an invoiced order on a
      supervisor's PIN". The till sends the PIN since B32 (below).
    - **For the owner, from B33's review: the cancel checks the permission after its payment
      refusals.** A bill holding a payment, or with a card payment in flight, is refused for that
      before `sale.rectify` or an override is looked at — the order C126 built, which B33 kept. So
      someone without the permission is told about the payment rather than "not permitted", and a
      PIN sent with that request is neither checked nor counted. The drawer, refund and
      unpaid-departure routes check the permission first. Moving it earlier changes who gets which
      refusal; not decided.
    - **B32 (the till offers "Cancel and credit"; owner, 2026-10-02 ~12:05) — landed as #1055
      (main `0f48b8bd5`, 2026-10-02).** On the table screen, a party
      bill that is placed, has its sale filed and holds no payment shows "Cancel and credit" to
      anyone signed in (`#billRow`, `apps/till/src/screens/till-table-order-screen.ts`). Its dialog
      (`apps/till/src/widgets/cancel-credit-dialog.ts`) names the invoice and the amount, takes a
      required reason and sends the cancel in the operator's name; a 403 `authorization.not_permitted`
      opens the PIN prompt of the people `GET /api/cancel-credit-authorizers` lists, as the unpaid
      departure's does. The result names the credit note, read from `GET /api/parties/:id/bills`,
      whose bills now carry `invoiceNumber` and `creditNotes` once a sale is filed
      (`readPartyBills`, `apps/server/src/parties.ts`), because the cancel's own answer is an
      empty 200. When a cancel gets no answer the till does not send it again by itself:
      it reads the bills again, and a bill now cancelled shows the result. Otherwise the operator
      may press "Cancel and credit" again; if the first cancel was made after all, the server
      refuses the second with `working_order.not_placed` ("refuses a second cancel, leaving exactly
      one credit note", `apps/server/src/cancel-invoiced-order.test.ts`), and the till reads the
      bills again; when that read shows the bill cancelled, it shows it cancelled, naming the credit
      note. The dialog's dismiss button reads "Keep the bill" ("Mantener la cuenta"), not the
      shared "Cancel" beside "Cancel and credit" (owner, 2026-10-02). The owner also kept the
      cancel's answer empty, so the till goes on reading the credit note's number from the bills.
      Open:
      - **Done by B34 (below): counter orders are offered it too.** A counter order placed and
        invoiced but unpaid (the `invoice_first` mode) now shows "Cancel and credit" on the
        counter's waiting list.
      - **The approver list is fetched with no time limit.** After a refusal for lack of
        permission the till asks `GET /api/cancel-credit-authorizers` who can approve, and until
        the answer arrives the dialog stays busy with its buttons disabled (`apps/till/src/till-app.ts`,
        the approvers fetch). The unpaid-departure and refund dialogs fetch theirs the same way and
        predate B32; a time limit belongs on all three together. Raised by B32's review by reading
        only; nobody reproduced a stalled answer.
      - **Done by A233: the table's cancel dialog shows its result before the bills read.** A
        successful cancel first shows the unnumbered result, then adds the credit-note number when
        the bills answer. A refusal first releases the busy dialog, then a bills read can resolve an
        uncertain refusal as a completed cancel. The two Chromium cases in
        `apps/till/src/till-app-parties.test.ts` hold the bills read unanswered to check both
        immediate results; the existing completed-read cases check the credit-note number.
    - **Done by B34 (#1077, 2026-10-03; owner, 2026-10-02): a counter order invoiced when it was placed and still
      unpaid can be cancelled with a credit note at the till.** It is the same action as B32's on a
      table's bill. On the counter's waiting list (`apps/till/src/widgets/counter-waiting.ts`), an
      order that is placed and whose invoice was issued shows "Cancel and credit" after Pay and
      Hand over; an order not yet invoiced, and a paid one, do not. The waiting list "is drawn only
      inside the held-orders card" (above), so a till layout without that card offers no Cancel and
      credit for counter orders either. The waiting list (`GET /api/orders/counter-waiting`,
      `listCounterWaiting` in `apps/server/src/working-order.ts`) now carries `invoiceNumber` on a
      placed order whose invoice is issued, and on no other. The button opens B32's dialog, with
      the same dismiss "Keep the bill", and sends the same cancel
      (`POST /api/working-orders/:id/cancel`) with the same PIN path: without `sale.rectify` the
      till asks for the PIN of someone who has it, as B33 built. The cancel itself needed no
      change: `cancelPlacedOrder` reads the order's status, never its party, and C126's own cases
      already cancel counter orders. After the cancel the dialog shows the result, then the till
      reads the kitchen queue and, unless the operator has signed out meanwhile, the waiting list
      again, and the order leaves the list when that read answers. The dialog does not wait for
      those reads, so an operator can close it and press Cancel and credit on the same row again
      before the list is read; that second cancel is refused with `working_order.not_placed`, the
      refusal is shown and the list is read again. A press of the button does nothing while a
      payment, a park or a place is in flight (`#counterOrderInFlight` in
      `apps/till/src/till-app.ts`), as a press of the waiting list's Pay does. Cases:
      `apps/server/src/counter-handover.test.ts`, `apps/server/src/cancel-invoiced-order.test.ts`
      ("cancelling an invoiced counter order from the counter's waiting list") and
      `apps/till/src/till-app-counter-cancel-credit.test.ts`. How it differs from the table's
      path, and what is left open:
      - **The result does not name the credit note.** The table's dialog reads the credit note's
        number from the party's bills; the waiting list drops a cancelled order, and the cancel's
        answer is empty, so the dialog says "A credit note was issued and the bill is cancelled"
        without a number. Naming it would need the number from somewhere new; not decided.
      - **A cancel that gets no answer is never shown as done.** On the table, the till reads the
        bills again and shows a bill now cancelled as done. On the counter, an order missing from
        the list may have been cancelled, or may have left it another way (paid and handed over,
        say), so the dialog says the cancel may have been made and to check the waiting orders (a
        new sentence, `cancel_credit.unconfirmed_counter`). The dialog shows this first, and then the
        till reads the waiting list again.
      - **Done by A232: cancelling a counter order clears its open basket.** After a successful
        cancel, the till empties the basket when it holds that order, returns its pay controls to
        the order stage, and drops a Pay read already loading that order. A basket or pending Pay
        read for another order stays intact. The Chromium cases in
        `apps/till/src/till-app-counter-cancel-credit.test.ts` cover those outcomes, including a
        kitchen-queue read held open after the cancel.
      - **Done by A234: the named counter actions check their starting operator session before a later list read.**
        The sale, card, place, collect, found-bill, ticket-advance, collection, hand-over, park,
        retrieve, discard, adjusted-order reread, zone-choice and move-to-table paths check before
        their later reads. The Chromium cases in
        `apps/till/src/till-app-boot-and-counter.test.ts`,
        `apps/till/src/till-app-counter-adjustments.test.ts` and `apps/till/src/till-app.test.ts`
        hold write answers, list reads and refusals across sign-out; each asserts the corresponding
        later read or retry does not start. B34 had already checked the cancel-and-credit path in
        #1077.
      - **The busy-state defect in these counter paths remains open.** `#onConfirmPayment`,
        `#collectCard`, `#onPlaceOrder`, `#onCollectOrder` and `#onFindBillPay` wait for their list
        reads before clearing the flag that marks the basket busy (`submitting` or `placing`), and
        the reads have no time limit, so a read that never answers would leave the basket blocked:
        no next sale, no Pay, no Cancel and credit. The B34 cancel path was changed in #1077
        to show its result before reading the lists.
      Unlike the table's button, the counter's does not check for a payment on the order. Two ways
      of giving a placed counter order a bill payment were tried while building B34 and both were
      refused: taking the payment on the placed order (`working_order.not_open`), and placing an
      order already holding one (`bill.payments_received`). Other ways were not looked for. If an
      order does hold one, the cancel refuses it with `bill.payments_received` and the dialog says
      so.
    - **`GET /api/cancel-credit-authorizers` (B33) lists the active holders of `sale.rectify`.**
      Every role holding `sale.rectify` today also holds `sale.refund`, `sale.void` and
      `cash.drawer`, so its cases cannot tell which of those it reads.
    - **Done by C132 (landed as #1060, 2026-10-03): a credit note's line names the invoice line it reverses.**
      `sale_lines.corrects_line_id` (core migration `0070_sale_line_corrects`, a foreign key to
      `sale_lines.id`) holds, on a corrective invoice's line, the original line it reverses or
      adjusts; it is null on an ordinary sale's line, on a substitution's, and on a partial
      correction's line that names none. The whole-order cancel fills it on every reversing line,
      extras picks included (`reversedLines`, `apps/server/src/cancel-credit.ts`).
      `recordCorrection` refuses a line naming a line that is not on the invoice it corrects with
      `sale.correction_line_not_on_invoice`, before a number is allocated. **Decided by the owner
      at C132's review (2026-10-02 ~23:10), and built: a credit of the whole invoice must reverse
      it line for line.**
      Each of its lines names a different invoice line and is that line with the same product,
      minus its quantity and minus its line total; every invoice line is named. Anything else is
      refused with `sale.correction_line_not_reversed`, before a number is allocated. A partial
      correction keeps the looser rule: its lines may name a line or not. No report reads the link
      yet. Open, for partial corrections only, which no product code makes yet (only tests and demo
      scripts do): whether a line a correction ADDS (a new charge, not a change to an invoice line)
      stays unlinked, and whether two adjustments may name the same invoice line. When a report
      starts reading the link it will want an index on the column, as `sales_corrects_idx` serves
      `sales.corrects_sale_id`.
    - **A fully credited bill's original invoice can still be reprinted**, from the till and from
      the dashboard; the server allows it. Whether a reprint should say the invoice was credited is
      not decided.
    - **Left in the dashboard Orders plan and spec after #1034 landed beside C126:** their banners
      still say C126 "is to" credit the bill (it is built); the plan's owner-answers row 7 still says
      "Task 2, as written" for the dropped mark; its Task 1 voided-bill case still lists
      `invoiceNotCredited: false` with no pointer to the drop; and #1034 did not write its planned
      test that a cancelled bill with an invoice shows its credit note.
    - **Decided (owner, 2026-10-02): a whole-invoice credit copies the invoice's own VAT split,
      negated** (`recordCorrection`'s `wholeInvoice`, `packages/core/src/record-correction.ts`).
      Worked out from the lines, as a partial correction still is, a 0.55 dish at 21% invoiced
      0.45 + 0.10 reverses to -0.45 - 0.09 (measured 2026-10-02); copied, it is -0.45 - 0.10.
    - **An invoice that already has a correction cannot be cancelled.** One that lowered it leaves
      less than the whole credit takes back, so the cancel is refused
      `sale.correction_exceeds_total`; one that raised it is refused `sale.correction_not_whole`,
      because a whole credit must be the invoice's first correction. Both are cases in
      `apps/server/src/cancel-invoiced-order.test.ts`. No route issues a credit note other than this
      one.
    - **The credit note is not printed** for the customer (asesor Q32 (b)).
    - **A placed order with no invoice is not checked against stored card payments.** Its cancel
      sees a card running at the reader in this process, but not a stored payment its provider has
      not resolved, nor one captured and not yet filed; the cancel had no payment check at all
      before C126.
  - **Asesor questions to send:**
    [Q27](compliance/asesor-questions.md#q27-money-taken-against-a-bill-before-its-invoice-exists-then-a-split-added-2026-09-26)
    (money before the invoice, then a split; printing the invoice first),
    [Q28](compliance/asesor-questions.md#q28-a-table-leaves-without-paying--is-the-invoice-still-owed-added-2026-09-26)
    (unpaid departure; built on the owner's decision, asked to confirm) and
    [Q29](compliance/asesor-questions.md#q29-how-a-discount-or-comp-appears-on-a-simplified-invoice-added-2026-09-26)
    (how a discount or comp appears on the invoice), and
    [Q32](compliance/asesor-questions.md#q32-cancelling-an-order-whose-ticket-was-already-issued--a-corrective-invoice-or-an-annulment-added-2026-10-02)
    (a cancelled, already-issued ticket: credit or annul; built on the owner's decision). Q19 stays
    open.

  Owner decisions (2026-09-26), each in the spec where it applies:
  - groups replace named courses, and who may release a held group stays a venue setting;
  - a party record ties a party's orders and bills (joined tables and merged parties included) and
    keeps the table occupied until Finish table;
  - a bill's invoice is issued when it is fully paid, several payments may come before it, and lines
    can still be split off after a contribution;
  - discounts reduce the line, comps show at €0.00 with the original price, and weighed items take
    discounts to the nearest cent; _(2026-09-30, C90, #932: the receipt now prints the dish at its full
    price with the comp or discount on a line of its own beneath it.)_
  - an item is credited to whoever owns the draft when it is submitted, and adjustment rates are
    measured against those credits.

  Out of scope for this plan: guest access, inventory, seat and staff assignment, changing the floor
  layout during service, screen plugins and Bizum.
- **Tables, parties and bills — the till's table actions: DONE (2026-09-29, all thirteen tasks).**
  [plan](superpowers/plans/2026-09-28-table-actions.md); Task 1 #816, 2 #825, 3 #844, 4 #832,
  5 #852, 6 #818, 7 #864, 8 #869, 9 #874, 10 #875, 11 #881, 12 #888, 13 #897 (which removed the old
  tab routes and the table's pointer to its bill, and needed every dev venue reset). What stays
  open:
  - **Task 6 (#818) and C50 (#847): the ticket of a bill collected after a correction still shows
    the original invoice total.** `collectOrder` queues no receipt on this path; the ticket it
    returns, the original receipt the till offers, and any reprint are all built by
    `readSettledTicket` (`apps/server/src/till-sale.ts`) and show the invoice's original total, and
    since C67 the card-reader payment of a bill that owes nothing returns the same. The printed
    receipt and the screen both give the cash line as total plus change
    (`apps/server/src/receipt-ticket.ts`, `apps/till/src/screens/till-ticket-view.ts`), so it
    overstates what was handed over. **PARKED (owner, 2026-09-29)** until the product can issue a
    corrective invoice; the owner's points for that design are on the corrective-invoice entry (R5,
    above). Also from C67's review (a probe, not a committed test): for a bill corrected to exactly
    zero, a captured card payment with no sale still takes the recovery branch first, settling at
    the captured amount with all of it recorded as tip; the below-zero case with a capture was not
    run.
  - **Task 4 (#832, every paper names all of a party's tables).** At 390 px a pass card whose
    label wraps also wraps its "2 min" onto two lines (`apps/till/src/screens/till-expo-screen.ts`);
    nothing overflows. **DECIDED (owner, 2026-09-29): leave it** — after payment, the station queue
    card, later kitchen notices and the till's list of a party's bills keep showing the frozen
    receipt label with the party's name ("Ana · Mesa 4, 5"). Not yet checked: the payment API's
    `/management-api/payments/stuck`, `/management-api/payments/bill-payments` and
    `/management-api/payments/bill-refunds` queries (`apps/server/src/payments-api.ts`), which read
    the same column.
  - **Task 3 (#844, a table needs clearing, not its party). DECIDED (owner, 2026-09-29): keep the
    plan's P9** — a stale Mark cleared from a floor screen that had not refreshed is accepted, even
    when it frees a table a LATER party has left.
  - **Task 7 (#864, move a whole bill).** Open: the move moves the bill's revision on, open or
    presented, without `bumpRevision`'s refusal of money in flight, since a move changes no amount
    (plan P19); plan P17 flags for the owner that a MOVED slip can name the same table as where the
    dish came from and where it went (the slip's text was not checked); and since A143 (#928)
    paying a pay-first order with a dish no station can take files the sale and raises
    `route.dish_not_sent`, but invoice-first placing still refuses such a dish — nobody has decided
    whether it should take the order and raise the alert instead.
  - **Task 8 (#869, move guests, join and split tables) and C77/C86.** Open: a party with no table
    whose chain of merges never ends (an unknown id, or two parties recorded as merged into each
    other, which the database accepts) is named by the bill's own label; whether any till action
    can make such a loop was not checked. `partyFamilies`, the reverse lookup of `partySurvivors`,
    stayed in `apps/server/src/parties.ts`, while `partySurvivors` is in
    `packages/db/src/party-table-labels.ts`. `party.main_bill_stays`'s till wording says "the table
    has other unpaid bills", which Split a table choosing the main bill need not satisfy. Left by
    #906's review: `computeOverdueOrders` is the one report function that reads its own node's
    location rather than being handed one (adding `locationId` to `OverdueOrdersInput` was
    suggested, not done); no case pins what a MOVED slip's "from" line or a correction slip prints
    for a counter order delivered to a table; and a database built on purpose with a delivery table
    in another location now names the order by its own label — no product path creates that state,
    and whether every existing venue database is free of it was not checked.
  - **Task 9 (#874, dishes arriving in a party get a kitchen group).** **A plan default the owner
    may overturn (P16):** spec §15's "leaves with them outside any group" is read as the side the
    bill leaves; the receiving party groups the dishes. Left by C78's review: the earliest fire
    time is picked by comparing the stored times as text, right only while every writer stores the
    same `toISOString()` form (every writer found uses `nowIso()`; not proven for all); and a dish
    recalled and fired again carries its new fire time but its old group's firer. Left by C80
    (read from `draftSections` and `groupArrivingDishes`, not compared with a running till): the
    till files a dish whose course it does not list (an inactive course) under the earliest course
    it lists, while a move keeps it in its own held group; and when a round is SENT,
    `working-order.ts` picks its earliest course without checking whether it is active, so with a
    switched-off course the send path and the move path can file a dish with no course under
    different courses (owner, 2026-09-29: not queued).
  - **Task 10 (#875).** Unchecked Send to radios are Chromium's own dark-theme control, dim grey on
    the dark dialog (seen in the 390 px Spanish dark screenshot).
  - **Task 11 (#881).** Open (found by #905's review, by reading, not reproduced): on a handheld, a
    waiter who taps a free table to seat it, goes back to the order tab while the seating is still
    under way and starts Move guests can have the move set the wrong table on the new party; the
    suggested fix is to count only table opens started in the current operator session; not
    queued. The till sends `otherPartyId: null` when its floor does not list the target table at
    all (a failed floor read empties the list); a table another party holds is then refused as out
    of date, never combined. On a 390 px phone the bill choice's buttons wrap ("Keep separate
    bills" on three lines). Seen by C82 at 390 and 1280 px, not measured further: a token for four
    seats or fewer, or with no seat count set, is so narrow that the party name shows only its
    first few letters ("T…" at two seats), and the table's label, its covers and its "to serve"
    chip spill past the token's edge; the map's token sizes (`sizeForCapacity`, `wt-floor-canvas`)
    decide that (owner, 2026-09-30, on C82's question: "wait on this"; not queued). A tab total
    does not fit either: see the entry below on a four-digit total.
  - **Open, from C84's review (#913):** when a void or line change gets no answer,
    `#rereadAmounts()` can put on screen what the party still owes, taken from its bills after its
    own floor read failed, while the revision on screen stays where it was. A later floor read that
    also fails keeps a floor listing the same party at that EQUAL revision, which
    `#retakePartyFromFloor()` takes, and `#followDraft` → `#rememberOrderParty()` after a send with
    no answer takes too, putting the floor's older amount back (`apps/till/src/till-app.ts`). Traced
    in the code, not reproduced.
- **A four-digit total does not fit a small round table on the till's floor map** (found
  2026-10-03 by looking at the map while making its amounts follow the locale, lane C's W15). On a
  four-seat round table at 1280 wide, dark theme, `1234,50 €` (the locale form, kept on one line by
  the formatter's no-break space before `€`) runs past the token's right edge; with the form before
  that change, `1234.50 €`, the amount still ran past the edge and `€` wrapped onto a second line.
  Measured with throwaway screenshot tests; screenshots in `~/waitron-campaign-c/w15-shots/`
  (`map-*` and `old-form-map-dark-1280.png`, not in the repository). W15 did not measure other
  shapes and capacities, or amounts of five digits. The cause is the one C82 recorded in the
  Task 11 note above, which the owner put on hold: the token is
  `packages/ui/src/components/wt-table-token.ts`, its size comes from `sizeForCapacity` in
  `packages/ui/src/floor.ts`, and the size rules are in
  `packages/ui/src/components/wt-floor-canvas.ts`. **Next action:** the owner decides whether this
  changes "wait on this"; a fix that lets a small token hold what it shows would cover both.
- **Later: optional seat/guest item assignment (owner, 2026-09-20).** Include shared items when
  this is designed. For now, orders remain at table/tab level and staff select items manually
  when splitting bills; seat assignment is not a prerequisite for the service workflow.
- **Later: staff-to-table assignments (owner, 2026-09-20).** Design assigning responsibility for
  tables to staff, including handover and how assignments appear on the floor dashboard. The
  current workflow discussion assumes no assignments; they are not a prerequisite for the dashboard.
- **Later: change the working floor layout during service (owner, 2026-09-20).** From the floor
  plan, join or split tables, increase or decrease chair counts, move a whole tab or selected items
  to another table, and add or remove tables. Each service day starts from a saved default layout;
  changes during service affect that day's working layout. Define the service-day boundary and
  handling of still-open tabs before implementing the reset. These are future requirements: audit
  the existing floor editor and transfer operations before deciding what needs changing, and retain
  order and kitchen progress when moving items (see A9's KDS correction). This operational floor
  editor is distinct from the general screen-layout canvas editor under reconsideration.
- **Four till surfaces ask for a caution colour that is defined nowhere, so all four render as plain
  text.** The token is `--wt-color-warning-text`, declared in no theme; what exists in
  `packages/ui-core/src/tokens/colors.css` is `--wt-color-warning` (with `--wt-color-on-warning`),
  which `wt-count-badge` uses. Each of the four call sites writes the fallback form
  `color: var(--wt-color-warning-text, var(--wt-color-text))` — `apps/till/src/widgets/basket.ts`,
  `station-queue.ts`, `diet-badges.ts` and `apps/till/src/screens/till-expo-screen.ts` — so the
  emphasis those rows were written to carry never appears. `diet-badges.ts` also reads
  `--wt-color-success-text`, declared nowhere, the same way. **Next action:** whoever takes the till
  layout pass below decides whether these four want `--wt-color-warning`, a new
  `--wt-color-warning-text` defined in both themes, or the `--wt-color-danger` the dish picker's
  refusals now use. These five reads are the listed exceptions in
  `scripts/style-token-names.test.ts`; fixing them means deleting their entries from its
  `FALLBACK_READS`.
- **Five measured till layout defects and one seen in a screenshot, all of them older than the
  extras-and-options work.** Found while looking at the real screens for B1 Task 12. **Next action:**
  take these six as
  one till layout pass over `apps/till`, at 390 and at 1024, measuring rectangles rather than
  reading rules — and set the width with `page.viewport(w, h)`, never `commands.setViewportSize`,
  which resizes the outer page and leaves the components' own iframe alone
  ([testing-guide.md](developers/testing-guide.md)).
  - **Within one extras list, prices are not a column and names are not a column**
    (`apps/till/src/widgets/modifier-picker.ts`) — a checkbox row and a stepper row misalign both the
    price edges and the name edges, at 1024 and at 390. Since A64 widened the standard modal, on a
    screen wider than 1072px the picker is 1024px wide and each price sits at the far end of the
    row from its name: take 1280 into the pass too. _2026-10-05 (W70): the picker is now the
    standard size, 672px wide (A64's "standard modal" was the 64rem size W70 calls wide)._
  - **The picker's fieldset legend wraps at phone width and its second line crosses the fieldset's own
    top border**, so the required marker (appended as a plain space) can break onto a line of its own
    sitting on the border rule.
  - **Nothing says WHY Add is disabled when a list's minimum is unmet.** The only cues are a `*` on the
    legend and a dimmed Add — and that `*` is also the only thing telling `minPicks: 1` from
    `minPicks: 2`. Wants a sentence beside the list stating the minimum in words.
  - **A long dish name pushes that line's remove control outside the basket at phone width**
    (`apps/till/src/widgets/basket.ts`): the `1fr` grid column bottoms out at the longest word.
  - **A pick's money column sits right of the dish total it belongs under**, further right than the
    dish row's own remove button, because `.line` and `.option` use different column templates.
  - **Product-grid tiles: a long name starts left of its own card border, and a unit price crosses the
    card's right border.** Seen in a screenshot, not measured. That widget was retired on 2026-09-27
    for `till-menu-browser` (`apps/till/src/widgets/menu-browser.ts`), whose tiles wrap their text
    inside the card; in the menus Task 9 screenshots opened at 390 and 1280 px no name or price
    crossed a border. Looked at, not measured: close once someone measures it.
- **Two modifier-picker states, and how far each is actually out of reach** — a fact worth having
  before anyone writes a test claiming to cover them. An options label marked unavailable never
  reaches the picker at all: the served offer and the till's menu-state poll replace a default that
  is missing or names an unavailable label with the first available label in the published
  version's order, or with null (`effectiveDefaultLabelId`,
  `packages/catalogue/src/option-default.ts`; `withUnavailable`,
  `apps/till/src/state/menu-refresh.ts`), and the till filters unavailable labels out before the
  picker is given them (`sellableModifiers`, `apps/till/src/api/client.ts`) — traced through the
  code, not run. An over-cap count is different: stepping cannot produce one, because `#step`
  clamps, but a REOPENED line is seeded straight from `initialSelections` with no clamp, so
  `#allSatisfied`'s `total <= entry.maxPicks` arm is reachable (run in the till's browser harness on
  2026-09-21: a picker seeded with 5 of one product on a list whose `maxPicks` is 2 renders a count
  of 5 and a disabled Add). The real-world shape is a parked line whose list had its cap reduced
  under it.
- **Unchecked since the service plan's Task 8 (#806): whether a round entered while the floor was
  being re-read is still hidden when the till follows the party onto its next tab** (the second
  finding of the retroactive Codex review of #719). The review's probe tested code since rewritten
  — the draft now lives on the party, on the server and in `DraftSync`, so nothing is carried
  between tabs — and was not re-run against the new code.
- **The till does not load its menu until a manual refresh**, and a dashboard menu change does not
  appear live on it. A till-app fix.
- **The three displays walked end to end** — [ui-review.md](ui-review.md)'s areas, at the real box.
- **Android/iOS on-device install and trust rows** — real phones on the shop WiFi, the owner's to
  run. The name-constrained CA does NOT protect a personal Android phone (measured 2026-09-08); BYOD
  Android either accepts broad trust in the box CA or uses the public-certificate path — an owner
  call before go-live.
- **The till's "This device hasn't trusted the till yet" page has never been seen on a real
  device.** `isTrustBroken` (`apps/till/src/trust-check.ts`) reads a `SecurityError` from
  registering the non-existent `/sw-probe.js` as "certificate not trusted"; that signal is still a
  belief, never checked on a device that clicked past the browser's warning. It runs only on pages
  served over HTTPS. Two gaps remain: the signal is trustworthy only while the server answers the
  probe with 404, which the box's `mountSpa` does; and no test covers the HTTPS default, because a
  browser test page cannot be served over HTTPS. **Next action:** during the on-device trust rows
  above, click past the certificate warning on one device and confirm the page appears.
- **Location-consistency guard** — nothing enforces that a sale-capable device's own location
  (`devices.location_id`) is the box's configured location. Guard at enrol or first sale.
- **Refuse a request from a device that is not enrolled** (owner design of 2026-08-30, deferred
  until after the demo: [design](superpowers/specs/2026-08-30-device-auth-enrolment-fail-closed-design.md)).
  Tills enrol, selling needs an enrolled device, and a device profile's capabilities gate some
  actions (`assertDeviceCapability`). But a request that carries NO device still passes
  `assertDeviceCapability` (`apps/server/src/device-session.ts`). Left: refuse a request with no device, one table of which
  device kinds may do what with a guard that walks the routes, and printer identity (the design's
  sub-project C). It sits on the sale and cash path, so it takes the full review. Since B29 (#1011)
  a handheld places, collects and cancels like a till, and since A238 no refusal is for being a
  handheld: taking cash, the drawer, integrated card payment and printing each follow the device
  profile's capability. The design's table is out of date on those rows.
- The device-management routes build their `devices ⨝ device_profiles` read inline
  (`apps/server/src/device-api.ts`) where a `listDevices` store verb belongs.
- **Screen faults seen during menus Task 9's look on 2026-09-27.** Seen on the dev stack while
  checking the till's home page, not investigated, and not checked against `main`, so any of them
  may predate that branch:
  - on the till at 390 px wide, the header makes the page wider than the screen (measured in
    C130's entry above: 560 px in English and 602 px in Spanish with only Find a bill offered);
  - on the till's floor map at 390 px wide, tables overlap one another;
  - in Spanish, the till's tab names "Counter", "Floor" and "Order" stay in English (traced to
    canvases, see A182 below);
  - on the dashboard, the dialog for a new home page layout is nearly full-screen for a single
    name field;
  - on the dashboard, the publish preview says "Home page layout X changed" both for a layout that
    was added and for one that was deleted;
  - the till's browser console shows Lit's "scheduled an update … after an update completed"
    warning.

  **Next action:** check each against `main`, then fix or file it on its own.
- **Build good screens for each kind of device, and retire canvases (A182, owner 2026-10-01).**
  The owner decided on 2026-09-20 to ship well-designed built-in screens instead of a screen
  designer that venues drag and resize; customisation beyond that, if it is ever needed, means
  screens written in code that plug in
  ([service design §11](superpowers/specs/2026-09-20-service-ordering-and-billing-design.md)).
  Nothing has carried that out. Every device's screen is still built from a CANVAS: a stored list
  of tabs, each tab a grid of cards, chosen per device profile. Ranked second under *What to work on next* (owner,
  2026-10-01). What exists today:
  - A default canvas per form factor, in code (`packages/layouts/src/default-canvases.ts`): the
    till gets a Counter tab (product grid, basket, total, pay, held orders) and a Floor tab; a phone
    or tablet handheld gets Floor and Order; a kitchen screen gets one Kitchen tab. The card types
    are `CARD_TYPES` (`packages/layouts/src/canvas.ts`).
  - Stored canvases in the `canvases` table (`packages/db/src/schema/canvases.ts`); a device
    profile may name one (`device_profiles.canvas_id`), and otherwise gets its form factor's
    default. The till's start-up answer carries the chosen canvas (`apps/server/src/till-api.ts`),
    the till shows its tabs only once it has one (`apps/till/src/till-app.ts`), and it draws each
    tab's cards in `apps/till/src/widgets/card-grid.ts`.
  - The dashboard's canvas editor (`apps/dashboard/src/screens/canvas-editor-screen.ts` and
    `canvas-editor/`), the canvas picker on the device profiles screen, the
    `/management-api/canvases` routes, the `listCanvases` and `getCanvas` live queries, and the
    `canvas.*` error codes (`packages/layouts/src/errors.ts`).
  - A canvas may carry a theme override (`CanvasDef.theme`); a grep of `apps/` for `.theme` finds
    nothing that reads it.

  One fault already traced to canvases: the till draws each tab's name straight from the canvas's
  stored `title` (`apps/till/src/widgets/tab-shell.ts`), and the defaults store English titles,
  which is why "Counter", "Floor" and "Order" stay in English in Spanish (one of the screen faults
  in the entry above).

  The work, each part its own brainstorm, spec and plan:
  1. **Design the screens for each kind of device** — the till at the counter, the handheld (phone
     and tablet), the kitchen screen and the pass — starting from the till screens that already
     exist (`apps/till/src/screens/`) and [ui-review.md](ui-review.md)'s walk of the three displays.
     Decide what each one shows, how it fits narrow and wide screens (a responsive grid inside a
     screen is fine, §11), and what a venue may still choose per device, such as its home layout
     or kitchen station — set on the device profile, not drawn in an editor.
  2. **Retire canvases** once those screens replace them: the till's canvas tabs and card grid, the
     `canvases` table and `device_profiles.canvas_id`, the canvas code in `packages/layouts`, the
     dashboard's editor, its navigation entry and the profile screen's picker, the routes, the live
     queries, the error codes and their translations. No data is carried over (§3's pre-live rule).
     Trace every consumer before deleting; the tests that build a canvas for the till go too.

  **Separate, and staying** (§11): a menu's home layouts (how its shortcuts are arranged), receipt
  configuration, and the floor-plan editor.

  **Until this lands, build no new feature as a canvas card or card setting** — put it in the
  screen itself. Slice 3d already kept its kitchen-group choice off the `expo` card (its P15).

### A5. Incidents and notifications

**Dashboard alerts and the incidents surface — LANDED #363/#368/#371.** Still not built: a standby
that has fallen behind. The pairing consumer is retired by A268 (2026-10-04), which removes the
count of devices that tried to join while the window was shut.

### A6. Payments

- **A pending card refund does not refuse joining or unjoining tables, though the bill payments
  design says it does.** The design's §5.2 list ("each payment, refund, void, quantity change,
  adjustment, split, transfer, join and unjoin … are refused with `bill.refund_in_progress`",
  [bill payments design](superpowers/specs/2026-09-26-bill-payments-design.md)) names join and
  unjoin. The run-it review of #851 (2026-09-29) reported that joining a free table to the party
  and unjoining a table without moving any dishes both succeeded while a card refund of the bill
  was pending; its probes were temporary and are not in the tree. Nobody has yet checked whether
  either can change what the bill charges. **Next action:** the owner decides whether the code
  should refuse them or the design should drop them from the list; then a test that tries each
  during a pending refund.
- **The SumUp Solo experiments** ([runbook](research/2026-09-10-sumup-solo-experiments.md)). Question
  4 was answered on 2026-09-11: a Solo paired to SumUp's cloud cannot also take a payment on its own,
  so the owner chose a separate standalone card machine for the internet-down case
  ([deli hardware](superpowers/specs/2026-07-30-deli-hardware-design.md) §5). Still open: whether we
  may supply the idempotency key, whether reader webhooks are signed, and whether `void` maps onto
  the refund endpoint.
- **The deli's outage card machine** (the deli hardware design §5). Buy the standalone machine, and
  decide how a payment keyed on it and recorded in the till as a manual card tender is matched to the
  record SumUp keeps with no sale of ours attached — the reconciler's sweep, and whether it can see a
  manual tender at all, decide it. Replace the design's estimated prices with real quotes. A barcode
  scanner only if the deli sells barcoded goods — nothing in the till reads one today.
- **The printer-cradle experiment** (hardware not yet owned). SumUp's OpenAPI has no `print` and no
  receipt option on a reader checkout, so we can neither request nor suppress a cradle slip. State the
  failing case first (the cradle stays silent), with a standalone payment as the control. Also unread:
  `GET /v1.1/receipts/{transaction_id}`, richer than the four fields the adapter keeps.
- **What #329 left open:** adding or adopting a reader does not shut out a provider disconnect at the
  same moment (an accepted race); Stripe's reader list is one page; status never refreshes by
  itself, and polling must go through the passive-session controller.
- **The SumUp reconciler** — settlement-report audit and orphan self-heal. `resolvePending` is the
  interim backstop; without an affiliate key a create whose response is lost resolves `failed` and
  raises `payment.pending_outcome_unactionable` for a human. Note: a SumUp refund appears both as a
  `REFUND` event inside the original transaction (`events` and `transaction_events`, which the
  refund lookup reads) and as its own item of `type: REFUND` in the transaction history listing;
  the original's `status` stays `SUCCESSFUL` (read on 2026-09-27 from three refunded transactions).
- **A SumUp API drift-detection suite** on a Virtual Solo in a sandbox merchant account — would have
  caught the #312 refund-unit bug. Needs a sandbox account and a CI secret.
- **Stripe does not fill `CardDetails`**, so a Stripe card sale prints `Tarjeta` with no scheme/PAN/
  auth. Gated on the deli having a Stripe account, which it does not.
- **What M7b2 left open (a manager clearing a stuck card payment, #702).**
  - Stripe Terminal's automatic `resolvePending` sweep is still a no-op, on purpose. During a LIVE
    collect the row is `attempting` and its PaymentIntent waits for a card, so a sweep that cancels
    would cancel a payment a customer is about to tap. Only the manager action, which first checks
    that no attempt is running in this process, asks Stripe, and cancels the PaymentIntent if Stripe
    still allows it.
  - SumUp has no permanent lock: its sweep resolves every `attempting` row against SumUp, and fails
    one SumUp has never heard of after 15 minutes, with an incident. It leaves a row only while SumUp
    keeps answering PENDING. The manager action refuses a SumUp payment
    (`payment.resolve_unsupported`).
  - When the reader poll times out or errors, `collect` cancels the reader action best-effort and
    fails the row. If that cancel fails and the customer then taps, the money is captured while the
    local row says `failed`; only reconciliation sees it. Now that a resolver exists, leaving such a
    row `attempting` would hand it to the manager action instead. That would also lock the order
    until a manager acts, so it is the owner's call.
  - Flaky: `packages/payments-sumup/src/dashboard/sumup-add-reader.test.ts`, "calls onClose when
    the dialog is dismissed with Escape", failed once in a run beside two coverage runs and passed
    three times alone (2026-09-26); its Stripe twin, `stripe-add-reader.test.ts`, was logged failing
    about one whole-package run in three (2026-09-27). #721 (2026-09-27) made both wait for the native
    dialog's `close` event before counting `onClose` — the late close report #1075 measured in the
    variant window. Neither has been re-measured since; on a recurrence, keep the log.
- **Slice 2 — the handheld NFC/QR link.** Owner decisions 2026-09-18
  ([2026-09-18-handheld-and-till-hardware-decisions.md](superpowers/specs/2026-09-18-handheld-and-till-hardware-decisions.md)
  §2–§3): the waiter carries the reader to the table and settles there; pairing is an NFC sticker, a
  printed QR sticker, or **a dropdown, which is the fallback that always exists and should be built
  first**. Readers are SHARED between waiters, so the tap and the scan are for confirming which
  reader is in your hand, not for speed — a remembered reader is offered, never auto-selected. Web
  NFC is Chrome-for-Android only; the browser's own QR decoder is not dependable, so decode in JS or
  WASM. Also here: restoring `stripe_on_device` (Tap-to-Pay). Redsys and
  bank terminals are parked; Bizum research is under *Later and parked*.
- **The webhook `recordSale` hand-off** (Mode 3) and the reconcile remediation UI. The hand-off sits
  BEHIND the `AsyncPaymentProvider` seam and is therefore provider-neutral — building it against the
  Stripe Checkout adapter that already exists forecloses no cheaper provider later.
- **A guest paying from their own phone** (owner idea 2026-09-18, parked — the surface it needs does
  not exist). The waiter hands a greeted table a QR code standing for its newly opened tab; the diner
  scans it, reads the menu, orders, watches what has been served and what is still coming, and settles
  at the end. Two owner decisions were taken while pricing it: **the diner's phone reaches us over the
  PUBLIC INTERNET** through the venue's cloud instance, not the restaurant's wifi — which is what lets
  a provider call back to say the money arrived; and **Waitron runs SEVERAL payment providers at
  once**, routing each payment method and channel to whichever is cheapest for that cell, so this is
  never a single-vendor choice. The owner's worked example: Mollie for Bizum, SumUp for card-present,
  the online card case still open. Costs of doing that, to weigh rather than wish away: one merchant
  account and one settlement reconciliation per provider, and one adapter each to write and keep
  working. Prices and receipts:
  [2026-09-18-online-payment-providers-bizum.md](research/2026-09-18-online-payment-providers-bizum.md).
  The ordering surface itself is parked under *online ordering (SP15)* and the customer-facing menu.
- **SumUp's card-present price is a plan choice, not a rate** (owner supplied the table, 2026-09-18).
  Tarifa Plana (€25/month, 0 % up to €2 500/month of Spanish debit/credit, then 0,79 %) is the plan to
  assume and beats Stripe Terminal on a Spanish card, so SumUp is **confirmed for the card-present
  seat**. SumUp's online rate (1,95 % on every plan) keeps it a weak candidate for the guest's own
  phone.
- **Routing by BILL SIZE is allowed but is the smallest lever** (owner idea 2026-09-18, arithmetic in
  the research note). The card mix moves the crossover further than the bill size does, and the deli's
  own mix is a query once it trades, not a research question. Two things to know before building it:
  the provider is chosen when the payment page is minted, so the AMOUNT can be routed on and the CARD
  CLASS cannot; and a refund must return through whichever provider took the payment. So **method
  first**; the variant that earns its keep is card-present, spending SumUp's Tarifa Plana €2 500
  monthly allowance first, which needs no second merchant account.
- **Some card payments ask the cardholder to sign instead of enter a PIN — open question, nothing
  built.** When a card or its issuer picks signature as the way it proves the person is who they say
  (the card-scheme term is the Cardholder Verification Method), the payment is only complete once a
  signature is captured, and the merchant is usually expected to keep it in case the payment is later
  disputed. Three things to settle before this is a task, none of them verified yet: (1) whether our
  readers — the SumUp Solo, and Stripe Terminal if it ever comes back — handle the signature entirely
  on the reader and hand us a finished payment, or whether they hand the signature step back to us to
  run on the waiter's screen; (2) if it lands on us, WHERE the signature is captured and kept (an
  on-screen signature pad, or a printed receipt with a signature line the waiter files) and how that
  record is stored and retrieved for a dispute; and (3) whether the fiscal receipt has to show
  anything about it — this is a card-scheme rule, separate from the Veri\*Factu invoice record, so
  confirm the two do not touch before assuming they are independent. Start by reading what the SumUp
  Solo actually does on a signature-required card (it belongs with the SumUp Solo experiments above),
  because if the reader owns the whole step there may be nothing for us to build.

### A7. Users, roles and the dashboard shell

**The dashboard shell restyle (#333) has not been checked on hardware.** It was only ever checked in
screenshots on a desktop browser; nobody has walked it on the real box or a phone, so the
narrow-viewport banner and drawer are unverified. That walk belongs with the display walkthrough in
[ui-review.md](ui-review.md).

- **Restaurant menus are “carta” in the Spanish dashboard, module, setup and till wording** (owner
  decision 2026-09-29; C55 #858, C56 #901). Account and row-action menus keep “menú”.
  `apps/till/src/i18n/strings.test.ts` fails if a Spanish string in the till's catalogue says
  “menú”; the till's error-code messages and allergen names (`apps/till/src/i18n/codes.ts`,
  `apps/till/src/i18n/allergen-names.ts`) are not scanned.

- **A sidebar test that guards nothing (left by C35, #822).** "keeps the clicked group header at the
  same on-screen position…" in `apps/dashboard/src/dashboard-app.test.ts` still passes with the
  scroll correction in `#toggleGroup` deleted — on `main` at 55504ee1b too, before C35. Making it
  catch a missing correction needs a layout where the browser pulls the list back on its own, which
  may not be reachable; next action is to find out whether it is, then either fix the test or drop
  the correction and its test.

- **The configuration export does not tell the shell about an expired session (A236) — DONE (W19, #1116;
  found 2026-10-03).** `exportConfiguration` in `apps/dashboard/src/api/client.ts` now goes through
  the request helper with its `as: "blob"` option, as the VAT return download does: an expired
  session reaches the expiry hook, a successful export counts as activity, and a refusal keeps its
  `params`. It came in with #296 (`fabdb224d`).

- **Add a device, like adding a printer (A268, owner 2026-10-04) — W104 DONE (#1225, main b1e1ecd3a); W105 DONE (#1235, main b27c17f5c); W106 DONE (#1240, main 812195b7c); W105b DONE (#1248, main ccbe2b41e); W105c DONE (#1251, main 58c65558b); W105f DONE (#1253, main 44ff56380); W105g DONE (#1254, main 969c96972); W105h DONE (#1258, main efa4ecb1b); W105e DONE (#1266, main 5ce168812); W106a DONE (#1272, main 700fdb00e); W105i DONE (#1260, main 998695dc5); W105d DONE (#1263, main 946643aa5). W104–W106, W105b, W105c and W105f DONE; the open points each left are listed below.**
  Devices may ask to join only while an Add a device dialog is open; the manager presses Pair, taps
  the device's number, then sets its name, profile and, for a kitchen screen, what it shows. Every
  device gains an Edit dialog (name, profile, Shows, printers, made here, card reader), the Devices
  list becomes a table, and it shows each device's battery. Retires the "tried to join" count and
  A5's pairing alert.
  [Spec](superpowers/specs/2026-10-04-add-a-device-design.md);
  [plan](superpowers/plans/2026-10-04-add-a-device.md), three pull requests: W104 the window holds
  and the Add a device dialog, W105 the device table and Edit dialog, W106 battery.
  **W104 (done):** the fifteen-minute join window and the "tried to join" count are gone. An open
  Add a device dialog (Devices page) or Add a print agent dialog (Printers page) takes a hold on the
  window and renews it while it stays open (`apps/dashboard/src/api/pairing-hold.ts`); outside dev
  mode a device may ask to join only while some hold is live, and once none is left the waiting
  device requests are discarded. Tapping the right number claims the request for that login, so
  another login's check or deny is refused `join_request.claimed` and its approval
  `join_request.unclaimed`; the claiming login then names the device and picks its profile
  (`apps/server/src/join-api.ts`). A till refused with `device.pairing_closed` now tells the
  operator to ask a manager to open Add a device.
  **W105 (done):** one request, `PATCH /management-api/devices/:id`, saves a device's
  name, profile, Shows, printers and made-here stations in one transaction (since W105e, 2026-10-05, a
  kitchen screen's save leaves made-here out), replacing the reassign
  and made-here routes (`apps/server/src/device-api.ts`). The Devices list is a table with an Edit
  dialog and a two-press Disable in each active row's menu; a disabled device's row does not open
  (`rowClickable`, new on `wt-data-table`). The card reader is read when the dialog opens (since W105e, only when the session holds
  `payments.manage`) and saved second, through its own route; without `payments.manage` the field is not shown.
  **W105b (done, #1248):** a disabled device can come back as itself. If its browser asks to join while an Add a
  device dialog is open, the server checks the browser's old device cookie and marks the request
  "returning" with the device's own id, name, profile and station or watcher
  (`apps/server/src/join-requests.ts`). The dialog lists it under its old name with "Disabled
  device. Enabling it restores its settings." (since W105g, 2026-10-05, the hint reads "Disabled
  device. Its profile was deleted: choose one to enable it." instead when the device's profile was
  retired; see (8) under "Left OPEN by W105" below) and an Enable (Habilitar) button in place of Pair;
  after the usual number check the step is titled "Enable <name>" and starts filled in
  (`apps/dashboard/src/screens/devices-screen.ts`). A station or watcher that is gone or switched
  off starts empty, to choose again; so does a profile missing from the dashboard's list of
  profiles, which since W105c is what a profile deleted while only disabled devices held it looks
  like; since W105g (2026-10-05) Profile also starts empty whenever the server reports the profile
  retired, even while that list has not yet been re-read. If the device asks again while its Enable dialog is open, the
  new ask replaces the old one under the same id; the dialog closes without sending a discard,
  which the server would answer as naming an ask already gone, and says the device asked again
  with new numbers. Cancel and the number check name the ask by its
  `createdAt` as well as its id, and an ask that has been replaced is answered
  `join_request.not_found`, unless a number check's pairing hold has lapsed, which is answered
  `device.pairing_hold_lapsed` first. Enable turns the same device row back on; it keeps
  its made-here stations, card reader and history, and its printers if its profile is unchanged.
  The disabled row in the Devices table gets no Enable action: the device has to ask again to
  prove itself, so a row button could only open Add a device.
  Open points: (1) the slow hash check runs only when the cookie names a disabled device, so the
  response time hints that an id is a disabled device; asks are rate-limited and, outside dev mode,
  accepted only while Add a device is open. (2) Someone holding a copy of a disabled device's
  current cookie can ask first and so replace that cookie; outside dev mode they still cannot get in
  without a manager tapping the number. (3) If an ask's response is lost after the server saved it,
  the browser's next ask joins as a new device and the old row stays disabled. (4) A long name in
  the waiting list overflows a phone's width. (5) An ask that replaces a waiting one always gets a
  later `createdAt`, but an ask made when no ask is waiting under its id, whatever ended the
  previous one (accepting it included, once the device is later disabled), is not forced later.
  It must first prove the token the previous ask issued, a scrypt check, so sharing a millisecond is
  unlikely, but nothing in the code rules it out.
  **W105f (done, #1253):** Disable ends every shift session open on the device in the same transaction
  (`POST /management-api/devices/:id/revoke`, the only path that disables a device), so a signed-in
  person's next request is refused `session.required` straight away; other devices' sessions are
  untouched. The till's sign-in checks the PIN outside any transaction, so inside the transaction
  that opens the session it checks the device again (`assertDeviceStillProven`,
  `apps/server/src/device-session.ts`): still active, and still holding the token hash the cookie
  was verified against, or it is refused `device.unauthorized` and no session opens. A Disable, or a
  Disable and then an Enable, landing while the PIN is checked leaves no session open
  (`apps/server/src/join-e2e.test.ts`; with that check removed both cases fail). The refusal of a
  session on a disabled device (`device.unauthorized`) stays, and Enable still ends the device's
  sessions, as a second line for a device turned off outside the Disable route (with that call
  removed, the join e2e case turning a device off directly fails).
  **W105i (done, #1260):** the same in-transaction check now hands back the device as it stands at that
  moment, and the sign-in refuses it `device.forbidden_action` (`action: "sign_in"`) if its profile
  is now a kitchen screen's, so a till moved onto a kitchen-screen profile while the PIN is checked
  opens no session; a move onto another till profile still signs in. The refusal before the PIN
  check stays, so a kitchen screen is turned away before any PIN work. `POST /api/session` is the
  only route that opens a session tied to a device: `loginWithPin` (`packages/identity/src/login.ts`)
  is otherwise called only by test code (the fixtures under `apps/server/src/testing/` and
  `packages/identity/test/` among it) and three demo scripts under `apps/server/scripts/`, and
  dashboard and mirror sessions name no device. Cases in `apps/server/src/join-e2e.test.ts` and
  `apps/server/src/device-session.test.ts`; with either check removed, its case fails. Still open:
  a shift session already open when its device is moved onto a kitchen-screen profile stays
  open — a review signed in on a till, moved it onto a kitchen-screen profile through the management
  route, and found one session still open; whether such a move should end the device's sessions is
  not decided.
  **W106 (done, #1240):** `devices` gains three empty-by-default columns: the battery level,
  whether it is charging and when that was reported (core `0099`). A paired device sends both to
  `PUT /api/device/battery`, which refuses a level outside 0 to 100 and stores at most one report a
  minute unless the charging state changed (`apps/server/src/device-api.ts`). The till sends a
  report when it starts as a paired device and whenever the level or charging state changes, and
  re-sends its current reading every five minutes, one send at a time, so a steady battery is not
  greyed as stale; it does so only where the browser has `navigator.getBattery`
  (`apps/till/src/api/battery-report.ts`). The
  Devices table's Battery column, between Shows and Status, shows "82%" with a lightning mark while
  charging, "Not reported" for a device that never sent one, and greys a report more than ten
  minutes old, adding when it was taken (since W106a, "updated 11 minutes ago"). A report that passes ten minutes while the
  page is open is greyed then, without the list being read again
  (`apps/dashboard/src/screens/devices-screen.ts`). No low-battery alert: that is A272, still open.
  Left OPEN by W106: (a) done by W106a (#1272; owner 2026-10-05: "relative time '5 minutes ago' with
  hover/click to show the actual timestamp"): the greyed battery report says "updated 11 minutes
  ago" / "actualizado hace 11 minutos", the Add a device dialog "Accepting devices: closes in 4
  minutes" / "Se aceptan dispositivos: se cierra dentro de 4 minutos", and the Add print agent
  dialog "Open: closes in 4 minutes" / "Abierto: se cierra dentro de 4 minutos" (a window already
  past reads "closes now"). The words come from the new shared primitive `wt-relative-time`
  (`packages/ui/src/components/wt-relative-time.ts`, through `apps/dashboard/src/widgets/relative-time.ts`),
  which redraws itself when its words would change; hovering or tapping them shows the full date
  and time ("5 de octubre de 2026 a las 11:49"), which is also their screen-reader description. The
  exact time is in the BROWSER's time zone: the relative-time widget receives no venue time zone. Other dashboard
  places still showing a bare `YYYY-MM-DD HH:MM` (`formatIsoMinute`), not changed: the Devices "Last
  seen" column; on Printers, a print agent's join request, an agent's Last seen (its table and Edit), a
  printer's Last print and Last seen (its status view) and Last print (the printers table), "Seen on {agent} · {time}" (`printers.seen_at`), and the print
  queue's Created and Delivered columns; the menu status and preview's "published {time}"
  (`apps/dashboard/src/widgets/menu-preview.ts`); and the adjustments report's time column
  (`packages/adjustments/src/dashboard/adjustment-report-screen.ts`). Whether any of them should
  use `wt-relative-time` is the owner's call. (b) the greying, and the relative words with it,
  compare the dashboard browser's clock with the server's stamp, so a browser clock far behind
  shows an old report as current. (c) a report exactly 60 s after the last stored one is not stored
  (`sightingDue` is strictly more than a minute); the spec says "at least a minute". (d) the till
  starts reporting from its first draw only, so an app removed from the page and put back does not
  report until it restarts. (e) test gaps: no battery case for a disabled device; no failing test
  for the `isConnected` check in the Battery column's update step; "Not reported" sorting last is
  held only by `wt-data-table`'s own tests. (f) `wt-relative-time`'s words are an inline button
  smaller than `--wt-tap-min`, under WCAG 2.2 criterion 2.5.8's exception for a target in a
  sentence (`docs/developers/design-system.md`); whether they should take a 44px hit area instead
  is the owner's call.
  Left OPEN by W105, not acted on: (5) done by W105d (#1263; owner's choice (a), 2026-10-05): a kitchen
  screen's Edit dialog keeps the station or watcher it holds after it was switched off, offered in
  its group and marked "(Disabled)" / "(Deshabilitada)" for a station and "(Disabled)" /
  "(Deshabilitado)" for a watcher (`devices.watcher_disabled_mark`; W105d shipped "(Removed)", W110b
  (#1278) changed it), so a rename saves it unchanged; only switched-on ones are offered as
  new choices. The save route accepts the device's own station or watcher unchanged
  (`resolveDeviceBinding`'s `kept`, `apps/server/src/device.ts`) and still refuses a switch to a
  switched-off one; Enable does not pass `kept`, so a returning device must choose a switched-on one.
  `GET /management-api/devices` reports each row's `binding` (name and whether it is switched on).
  Still open: the Devices table's Shows column reads "— no station —" for a screen on a switched-off
  station, because it looks the name up in the switched-on list; `binding.name` could fill it. (6) done by W105a (#1244): printers and devices both say Disable/Deshabilitar,
  status Disabled, and printers' Add again is now Enable; card readers followed in W110 (#1255): Disable/Deshabilitar,
  Enable/Habilitar, Disabled/Deshabilitado, and their Add again/Volver a añadir is now Enable/Habilitar. (7) done by W105e (#1266, 2026-10-05): a
  kitchen screen's Edit dialog hides Made here and its save leaves `madeHereStationIds` out, and the
  device edit route leaves a device's made-here stations as they are when the field is absent; an
  explicit null or a non-list is still refused `management.request_invalid`
  (`apps/server/src/device-api.ts`). A made-here station switched off while the dialog is open no
  longer refuses a kitchen screen's save. (8) done by W105c (#1251): deleting a profile ignores disabled devices (owner
  decision 2026-10-05). A profile only disabled devices hold is RETIRED, not deleted, because
  `devices.device_profile_id` is NOT NULL, and the rebuild that changing it needs fails once a row
  in a table keying into `devices` with RESTRICT names a device (fiscal records among them;
  CLAUDE.md §3's rebuild rule): `device_profiles.retired_at` is set, the name is free again, and its canvas and printer
  lists are let go (`deleteDeviceProfile`, `packages/layouts/src/device-profile-store.ts`). A
  profile an active device holds is still refused `device_profile.in_use`. A returning device whose
  profile was retired opens Enable with Profile empty; Enable with the old profile is refused
  `device_profile.not_found`. Done by W105h (#1258): the Devices table reads "Profile deleted" / "Perfil
  eliminado", muted, for a device on a retired profile, from `profileRetired` on each row of
  `GET /management-api/devices`; and a configuration export leaves a retired profile behind
  (`leaveBehindWhenSet: "retired_at"`, `packages/db/src/configuration-transfer.ts`) together with
  every bundled row whose foreign key names it, which is its `device_profile_home_layouts` rows. Those
  rows still stay in the exporting venue's own table. The Enable hint's wording, done by W105g (#1254, owner decision
  2026-10-05): when the returning device's profile was retired, the waiting list's hint reads
  "Disabled device. Its profile was deleted: choose one to enable it." / "Dispositivo deshabilitado.
  Su perfil se eliminó: elige uno para habilitarlo." (`devices.enable_hint_profile_deleted`), and
  every other returning device keeps "Enabling it restores its settings."; the server says which, as
  `returning.profileRetired` in the device join list (`returningDevicesOf`,
  `apps/server/src/join-requests.ts`). The device join list's live updates now name
  `device_profiles` too (`joinRequests`, `apps/dashboard/src/api/live-queries.ts`, pinned in its
  test), so a profile deleted while a returning device's request is showing re-reads the list. (9) done by W105e (#1266, 2026-10-05): while the profile is unchanged, a printer the device
  holds that its profile no longer lists is offered and chosen, marked "Name (not on this profile)"
  / "Nombre (no está en este perfil)" (`devices.printer_not_on_profile_mark`; a switched-off one
  also reads "(Disabled)"), and Save keeps it; a changed profile no longer offers it
  (`#printerOptions`, `apps/dashboard/src/screens/devices-screen.ts`). When the held printer is not in the
  dashboard's printer list, nothing extra is
  offered and Save still keeps the held printer. (10) done by W105e (#1266, 2026-10-05): the dashboard tells the
  Devices screen whether the session holds `payments.manage` (`canManageReaders`, from the "who am I"
  read in `apps/dashboard/src/dashboard-app.ts`); without it Edit never draws the card reader field
  nor asks about readers. With it the reader is read as before; a read refused with `authorization.not_permitted` hides the
  field, and any other failure of that read is shown at the bottom of Edit. If the session loses
  `payments.manage` while Edit is open (the dashboard re-reads permissions when the tab comes back
  into view), the field goes and a Save pressed after that sends no reader. Review suggestions #1235 did not take, listed in its description: the edit
  route checks permission before the device id where revoke checks the id first; its body is the
  whole device rather than only the fields named (since W105e, made-here may be left out); it can write the device row up to three times;
  `rowClickable` and `rowActivation` could be one option; a save fetches the list twice; Edit and
  Pair repeat some request-body building; seven unread `devices.*` strings.
  Left OPEN by W104, not acted on: (1) a Pair save that never answers locks both dialogs, because a
  save carries no time limit (`packages/dashboard-kit/src/request.ts` limits GETs only); (2) leaving
  the Devices page with Back while a Pair save is in flight still sends a deny for that request
  (`#closePair`, `apps/dashboard/src/screens/devices-screen.ts`), and what then happens to the
  device is untested; (3) the Add a device and Pair dialogs were looked at only through the browser
  test harness with a stubbed server, never on a box, so a real QR code drawn from a real box
  address has not been looked at. (4) a device's knock is refused if the window shut while its body was
  arriving, but open periods are told apart only by their start time, to the millisecond
  (`apps/server/src/device-api.ts`), so a shut and reopen within one millisecond would pass.
- **A print agent cannot be discarded when the join window shuts (A269, owner 2026-10-04) — OPEN.**
  A268 discards a waiting device's request when the last Add dialog closes. An agent told
  `not_approved` stops and needs resetting on its own setup page (`packages/print-agent/src/agent.ts`,
  the `not_approved` branch), so its request outlives a shut window instead. **Next action:** find a
  path, for example an agent that asks again on its own after a refusal, so agents follow the
  device rule. Spec: [A268 §4](superpowers/specs/2026-10-04-add-a-device-design.md#4-pairing-on-the-server).
- **Does "made here" belong to the device or to its profile? (A270, owner 2026-10-04) — OPEN.** It
  is a per-device setting by the 2026-10-01 decision
  ([routing design §5.11](superpowers/specs/2026-09-30-catalogue-menus-routing-design.md)); under
  the 2026-10-04 profile model a "Bar till" profile could carry it instead. A268 keeps it on the
  device. Needs an owner decision.
- **Each browser tab as its own device, in Demo too (A271, owner 2026-10-04) — OPEN, after A268.**
  Only dev mode lets a tab act as a separate device, and it names the device by id alone
  (`x-waitron-dev-device`, `apps/server/src/device-session.ts`); the sign-in cookie is shared by the
  whole browser. Since #269 and #287 pairing also overwrites the browser-wide device cookie, so a
  tab that misses the dev chooser (the chooser's failure is swallowed, `apps/till/src/till-app.ts`)
  lands on the most recently paired device's login. **Next action:** a short spec for per-tab device
  secrets and per-tab sign-ins usable in Demo, and reproduce the owner's report first.
- **A dev tab that remembers a device a reset deleted goes back to the device picker (W107) — DONE:
  landed as #1270 (main `44c6c8bbc`, 2026-10-06).** The tab used to boot to the join screen, and joining from it could not recover
  it: run on the demo stack 2026-10-06, a join sent with a stale `x-waitron-dev-device` header
  created and approved a new device, but `GET /api/device/me` kept answering `device.unauthorized`
  because in dev mode the server reads the header instead of the device cookie
  (`apps/server/src/device-session.ts`). Now a dev tab whose remembered device is refused
  `device.unauthorized` forgets it and shows the picker. If the picker's device list then fails to
  load, the tab shows the join screen instead, and a join from it no longer sends the forgotten id.
  Outside dev mode the browser still gets the join screen, and any other failure keeps the
  remembered device (`#boot`, `apps/till/src/till-app.ts`).
- **A low-battery alert (A272, idea, 2026-10-04) — OPEN.** A268 shows each device's battery on the
  Devices list; nothing alerts when a handheld runs low.

- **A till is a device (A238) — DONE: landed as #1164 (main `065354d26`, 2026-10-04); every
  venue needs a reset.** Follow-ups queued 2026-10-04: W56 (the Sales screen's section title reads
  "Tender by device") is done; W57 is done in this change: the two hand-run operator scripts now
  record sales and corrections as "Operator script" / "Script del operador". Its source CHECK
  migrations also require the accepted pre-live venue reset: rebuilding `working_orders` may delete
  open order rows through cascading foreign keys, while other populated tables refuse the rebuild.
  Deferred in the PR: three refactors of sign-in-adjacent code, and renaming the `seedTill` test
  fixtures. The `tills` table is gone; every record names its source (usually the device; otherwise
  the dashboard or a named background job)
  and, for a device, the device; a device's profile decides whether it takes cash (`take-cash`) and
  opens the drawer (`open-cash-drawer`), and lists the receipt and payment slip printers its devices
  may switch between mid-service; setup creates no till, and the server reads no
  `WAITRON_TILL_TILL_ID`; the receipt, payment-slip, reprint and drawer routes use the requesting
  device's current printers. Ships with a venue reset: every venue, the owner's box included, is
  wiped and set up again. Spec: `docs/superpowers/specs/2026-10-03-till-is-a-device-design.md`;
  plan: `docs/superpowers/plans/2026-10-03-till-is-a-device.md`. Pieces 2 and 3 follow it (A239,
  A240).

- **Recorded cash in and out of a till's drawer (A239) — OPEN, needs a spec before queueing (owner,
  2026-10-03).** Piece 2 of A238. Each top-up or removal of cash from a till device's drawer is a
  recorded entry: who, how much, why, when (topping up change, paying a supplier, a waiter handing
  in float cash). The entries replace the two typed totals the daily close takes today (opening float
  and payouts, `packages/reporting/src/record-daily-close.ts`). Needs A238 (landed as #1164).
  No screen collects cash
  counts yet; this is where one belongs.

- **Waiter cash floats (A240) — OPEN, needs a spec before queueing (owner, 2026-10-03).** Piece 3 of
  A238. Its screen belongs with clocking in and out, under Team (owner, 2026-10-03, A261 §10). Owner decisions so far: a float belongs to the WAITER, not the handheld; a waiter with an
  open float may take cash on any handheld, and it adds to their float; the waiter settles the float
  at a till before leaving, entering what they hold, the difference is recorded against them and the
  cash goes into that till's drawer as an A239 entry; the daily close lists any float still open.
  Cash taken on a handheld whose profile allows cash, with no float, is counted against the
  handheld until then (A238). Open: where a float's opening cash comes from (a till's drawer, or brought in). Needs
  A238 (landed as #1164) and A239.

- **A pretend printer in Demo mode (A241) — DONE in W37.** Demo and Preparation provide a printer
  for receipts, kitchen tickets and separate drawer openings. A manager can open its page from the
  Demo bar beside Email inbox and see the printed jobs newest first. Live deactivates the pretend
  printer and does not serve the page.

- **A pretend connected card reader in Demo mode (A247) — DONE in W38.** Demo and Preparation
  offer a pretend reader beside the instant simulator. The till waits for its decision, while a
  manager opens Card reader from the Demo bar to approve or decline the amount. Cancel on the till
  clears the pending payment. Live offers neither the reader nor its page. If demos use multiple
  tills at once, add a till label to each pending amount so the manager can choose the right one;
  the current page shows amounts alone.

- **The rest of the Printing rules screen (A242) — SETTLED by A261 (owner, 2026-10-03).** The page
  is deleted: kitchen ticket printers move to Prep stations, the receipt print mode to Departments
  and zones, and the cash drawer policy is deleted (opening the drawer by hand always needs
  `cash.drawer`). Build step 8 of A261, after A238 lands.

- **Every dashboard sidebar section gets an info page — OPEN (owner, 2026-09-29).** A page saying
  what the section is for and what is in it, opened by the section's header. It was the answer to
  C35's question about the header of the section you are on; A161 (#979) has since answered that
  question another way — that header now collapses its section, as every other header does — so
  whether this page is still wanted, and what would open it, is the owner's call. If wanted, it
  needs a spec: brainstorm what each section's page says.

- **The report screens get their own sidebar section, Reporting (A251, owner 2026-10-03) — DONE
  (#1146, lane A's W41).** Sales & takings, the VAT return, the adjustments module's Adjustment report and
  Orders, in that order, sit in a collapsible section headed Reporting ("Informes"); Overview stays
  on top in a group of its own with no heading, and a staff session's short list (My schedule,
  Orders) sits in that headless group, unchanged. The section keeps the id `reports`, so the module
  is untouched; a group's `itemsAfterModules` (`NAV_GROUPS`, `apps/dashboard/src/dashboard-app.ts`)
  are listed after its module screens, which is how Orders comes last.

- **A generated display name is the first given name and first surname (C38, #827, owner decision
  2026-09-28).** Left as they were, from #827's review: unlike the two staff forms, the profile
  screen keeps a taken-name message beside the display name when a first- or last-name change
  regenerates that name (`apps/dashboard/src/screens/profile-screen.ts` drops only the changed
  field's refusal); and the two staff forms turn the refusal into a field message inside the form,
  where other dashboard forms receive field messages from their parent screen.

- **Money in the dashboard shows its currency sign (C43, #830) — left open:** (1) the catalogue,
  menu and purchase price fields accept and show a dot decimal only, so a Spanish field shows `9.00`
  with the sign after it while the same amount displayed beside it reads `9,00 €` (the adjustments
  limit field shows its saved value with a comma); (2) the alert check that every money slot is
  marked looks only at slots named `amount`, `captured` and `expected`, so a new money slot under
  another name is seen by nothing; (3) the purchase form's VAT line still lets its other fields
  shrink to `min-width: 5rem` (`apps/dashboard/src/widgets/purchase-form.ts`), a `rem` the
  design-token rule forbids.

- **Every `wt-data-table` list lets each person choose its columns (C45, #834) — left open:**
  (1) tables inside a dialog or picker offer no chooser, by choice; (2) the servers list
  (`apps/dashboard/src/screens/servers-screen.ts`) offers no chooser, its one column beside the
  buttons holding several facts together — **DECIDED (owner, 2026-09-29): leave it**, unsplit and
  with no chooser; (3) nothing checks that a NEW dashboard table offers the chooser; (4) where a
  screen keeps its search and filters outside the table (staff, card readers) or the table has none
  (alerts, venue operations), the Customise icon button sits alone on a row above the table rather than
  beside those controls — moving a screen's own controls into the table's toolbar would fix it;
  (5) the read-only tables a few screens draw as plain HTML tables rather than `wt-data-table`s have
  no chooser: planned against actual (`apps/dashboard/src/screens/planned-actual-screen.ts`), the
  roster (`apps/dashboard/src/screens/roster-screen.ts`), the four report tables on the sales screen
  (`apps/dashboard/src/screens/dashboard-sales-screen.ts`), the overdue table on the overview
  (`apps/dashboard/src/screens/dashboard-overview-screen.ts`) and the top-sellers table both of
  those screens show (`apps/dashboard/src/widgets/top-sellers-table.ts`); (6) the printers screen's
  view keys (`printers:agents`, `printers:table`, `printers:jobs`) are the only dashboard view keys
  that use a colon and lack the `waitron.` prefix — cheap to rename until a venue is live.

- **The sidebar's page search (C46, #836) — left open:** its accessibility case checks the search
  box and its message only, because at desktop width (1280 px) the light theme's sidebar headers and
  current page already fail the colour-contrast rule (the primary-blue entry under "Also open, and
  product-wide"). Two choices are **DECIDED (owner, 2026-09-29): keep both** — "ñ" is matched as
  "n", so "espana" finds "España"; and the box is not pinned, so it scrolls away with a long
  sidebar.

- **A form's refusal message sits at the bottom of the form, above the buttons (C97, #961) — left
  open:** three dialogs still draw their own refusal because none has a `wt-form-actions` row in its
  footer to hand it to: the menus screen's add-products window has its row inside the
  `section-add-products` component, and `packages/bookings/src/dashboard/booking-form.ts` and
  `apps/till/src/widgets/supervisor-override-dialog.ts` put bare `wt-button`s in the footer slot. A
  `wt-form-actions` wrapped in another element inside a dialog's footer would keep its message in
  the footer; none does today. Not looked at on screen after #961's review fixes.

- **A form in a modal stops at `--wt-form-max-width` (C105, #965) — left open:** a
  `wt-disclosure`'s heading row (the product editor's Kitchen, Descriptors and Nutrition sections,
  among others) and a screen's own paragraphs still run the modal's full width; and forms built in
  `wt-dialog` rather than `wt-modal` (the ingredient form, the till's party name dialog, among
  others) are held only by the dialog's own 768px limit — whether they should follow the modal's
  form width is the owner's call.

- **Content languages are managed on the page itself (C111, #987):** Add language uses the compact
  width (W70, #1222) and fits its content (W70a), settling the one-field dialog's size and empty
  space. Left open: at 390px the Spanish "Hacer predeterminado" and "Quitar" fit side by side with
  the dashboard's own padding (16px a side), and stack when the page is padded 24px a side, so on
  a phone narrower than 390px they can stack.

- **Hints shown as placeholders (C104, #966; C119, #967):** the owner chose on 2026-10-01 to leave as
  they are the hints cut off in their fields and the fields whose own placeholder shows instead of
  their hint.

- **Forms explain a failed submission under each field and once at the bottom (C47, #838/#839/#840/
  #841; C48, #892; C54, #853; owner rule 2026-09-28, restated 2026-09-29).**
  `docs/developers/design-system.md` → Forms states the rule. Decided and kept:
  - **DECIDED (owner, 2026-09-29): leave** the image library's bottom message as "The image could
    not be saved." followed by the refusal's own sentence (`image.save_error`), where the design
    guide asks for the refusal's sentence alone.
  - **DECIDED (owner, 2026-09-29): leave Connect working** after a refused card-provider key
    (`payment.provider_credential_rejected`), because the code carries only the provider's id.
  - Deliberate exceptions in `apps/dashboard`: the add-to-menus dialog
    (`apps/dashboard/src/widgets/add-to-menus.ts`) keeps its list of places that failed, and its
    menu-load error, at the top of the dialog; the backups panel's refusal paragraph
    (`apps/dashboard/src/screens/stream-settings-panel.ts`) stays directly under the form's
    buttons, because it also reports a refused Turn off, when no form is open; the cloud services
    screen (`apps/dashboard/src/screens/cloud-services-screen.ts`) has no form, only buttons, and
    shows a refusal as a plain alert. The setup wizard's screens with no fields — review, fiscal
    test, connection and provisioning — keep their refusal paragraph, and in Demo the venue screen's
    "Demo invoice settings have not loaded yet." alert stays above the form, as a load failure
    rather than a refusal.
  - The till's split step keeps its Split button disabled before any press until a dish is picked,
    on purpose, because it counts a selection rather than checking a field; the transfer step's
    confirm button does the same.

  Left open, not done:
  (1) the setup wizard's Demo gaps, listed under *Demo gaps on the setup wizard's venue screen*
  earlier in this file;
  (2) `wt-form-error-summary` is deleted once nothing uses it — besides its own files and exports in
  `packages/ui-core` and `packages/ui`, the `packages/ui` workbench demo (`packages/ui/demo/main.ts`)
  and the consumer test page `packages/ui-core/test/consumer/main.ts`, which
  `packages/ui-core/test/package-consumer.test.mjs` loads, still use it;
  (3) the profile screen, opened with required details missing, marks those fields at once, before
  any press (two existing tests pin it), unlike every other form;
  (4) the form plumbing is hand-written per form: assembling the bottom message, waiting for the
  render and then calling `focusFirstInvalid`, and the state that remembers the first press and
  which refusals the person has since changed, in several different shapes across `apps/dashboard`,
  the image library, the Stripe and SumUp forms, adjustment reasons in Venue settings,
  Departments and zones, and the till's forms. A dashboard-only helper could live in
  `apps/dashboard/src/widgets/form-fields.ts`, but `packages/media` cannot import from
  `apps/dashboard` (it would be a dependency loop), so a helper meant to cover the module screens
  and the image library too would have to live in a package they can all reach, such as
  `@waitron/ui`;
  (5) the image picker's error message is not read to a screen reader:
  `apps/dashboard/src/widgets/section-details-form.ts` puts `aria-describedby="section-image-error"`
  on the `dashboard-image-upload` host, and an id outside a shadow root describes nothing inside it
  (`docs/developers/design-system.md` → Forms); the Choose image button inside it carries
  `aria-invalid` and takes focus, so a screen reader hears "invalid" with no reason. Since A200 the
  product editor's photo button (`apps/dashboard/src/widgets/product-editor.ts`) has the same
  defect: it carries `aria-invalid` and takes focus, while the reason is a `data-test="image-error"`
  line in the editor's own shadow root that nothing points to;
  (6) the till's schedule screen (`apps/till/src/screens/till-schedule-screen.ts`) does not follow
  the rule yet: its cover request keeps its button disabled until a shift and a colleague are
  chosen, and its absence request until both dates are filled, before any press; neither shows a
  message beside its fields; and a refusal shows as a `role="alert"` notice at the top of the card.
  Other till surfaces were not checked against the rule either, and whether a number pad or a
  choice picker counts as a form under it is open: the payment and weighing steps
  (`apps/till/src/widgets/tender-pay.ts`) keep Confirm payment disabled while the cash entered is
  below the total and Add disabled while the weight is invalid, before any press, with no message;
  the dish options picker (`apps/till/src/widgets/modifier-picker.ts`) keeps Add or Save disabled
  until its required choices are made, and shows changed or unavailable choices as `role="alert"`
  paragraphs rather than beside a field; and the supervisor override dialog
  (`apps/till/src/widgets/supervisor-override-dialog.ts`) keeps Authorize disabled while the PIN is
  empty and shows a refusal as a `role="alert"` paragraph.

  Found during C47 part 2 and not fixed: (a) a bad Stripe reader id reaches the add-reader dialog as
  `server.internal`, so it cannot be told from a server fault — the Stripe seat's `readers.add`
  (`packages/payments-stripe/src/card-provider.ts`) lets the Stripe library's own error through,
  and the error boundary (`packages/server-kit/src/error-boundary.ts`) answers anything that is not
  an `AppError` with `server.internal`; (b) the Stripe add-reader dialog
  (`packages/payments-stripe/src/dashboard/stripe-add-reader.ts`) shows "Reader ID" twice, a
  separate label carrying the help icon and then the input's own label, where `wt-input`'s `help`
  slot would do; (c) a refused save of a venue service setting that saves at once shows twice,
  beside the control and at the top of the panel (`render`,
  `packages/venue-service/src/dashboard/service-settings-panel.ts`), and the cases in
  `packages/venue-service/src/dashboard/service-settings-panel.test.ts` pin both;
  (d) `wt-switch` cannot be marked invalid, so a server refusal of an adjustment reason's
  note-required switch would show its message but move focus nowhere — though the server refuses
  `noteRequired` only when it is not a true/false value (`requireFlag`,
  `packages/adjustments/src/routes.ts`) and the screen always sends one from its switch, so the
  refusal is not expected from this screen; (e) in a screenshot of a `wt-modal` editor after a
  refusal that names no field, a blue line runs along the top of the footer, which looks like the
  modal's scrolling body showing a focus ring — not traced, and not checked against `main`; an
  observation from the implementer's session.

- **Request refusals that still land in the bottom message, or under a field in generic words —
  OPEN (left by C54, #853).** In the forms C54 surveyed (the dashboard, the setup wizard, and the
  adjustments, venue-service and media module screens) it kept the action working after a request's
  refusal and put a refusal naming a shown field under that field. What it left:
  (1) the product editor and the venue operations editors put a refused field's message under it in
  their generic words (`editor.field_rejected` in `apps/dashboard/src/screens/catalogue-screen.ts`
  `#rejectedField`; `venue.field_refused` in
  `packages/venue-service/src/dashboard/venue-operations-screen.ts`), not the refusal's own
  sentence (the setup half was done by C62, #895);
  (2) controls with no place for an error keep their refusal in the bottom message — `wt-switch`
  (`active` on the ingredient, extras and options forms; `available` on the product
  editor), the allergen and dietary-origin pickers on the ingredient form, and the purchase form's
  VAT regime select;
  (3) refusals naming two fields or a row the refusal does not number stay at the bottom:
  `purchase.duplicate` (supplier tax id and invoice number), a purchase line's rate, base, tax or
  type, `hours.N` on venue operations,
  `provisioning.duplicate_series_code` and `territory_country_mismatch` on the setup venue screen;
  (4) on the backup screen (its retention boxes done by C63, #860): a refusal naming
  `destinationDir` or `schedule` still shows in the page banner rather than under the folder field
  or above the button (both seen by running, in the Codex run-it review of C63), and so, read and
  not run, does every other refusal; the backup folder is required but not marked, and Turn on
  backups stays disabled before the first press until the folder is filled and the key is saved —
  the same shape as (7) (both seen by running, in the Codex run-it review); and, read and not run:
  the settings editor's Save changes is also disabled before any press while the folder is blank
  (`#saveSettingsDisabled` in `apps/dashboard/src/screens/backup-screen.ts`); the destination
  folder, the saved-it tick and the weekday ticks carry no `name`; the screen does not submit on
  Enter (`submitOnEnter`, which design-system.md → "Submit ordinary forms with Enter" asks for and
  `stream-settings-panel.ts` uses); and no test covers only the second box being invalid, or where
  focus lands after a failed check on the Save form;
  (5) on the dashboard at 390 px a sliver of the closed side-menu drawer's search box shows at the
  left edge, in the page's 24 px margin (seen while looking at C93, #933; I believe it predates C93,
  not checked on `main`);
  (6) the setup live-source screen's refusals go through a catch-all in
  `#onConfigurationRequested` that drops the code, so a wrong passphrase cannot be placed under its
  field;
  (7) the profile screen opens with Save disabled when required details are missing — the form's
  own check, before any press (also point (3) of the entry above);
  (8) on the add-person and edit-person forms `profile.invalid` reads "Check your profile details",
  which is about someone else's details there;
  (9) after a refusal under a field the bottom message still reads "Correct the highlighted fields to
  continue" while the action works — kept as it was;
  (10) the bookings form was not in C54's survey (read, not run): a save refusal becomes the
  screen's `errorKey` (`packages/bookings/src/dashboard/bookings-screen.ts` `#onCreate`/`#onUpdate`)
  and shows as a paragraph on the screen outside the dialog, never under a field — including those
  naming one, `management.request_invalid` with a `field`, `booking.invalid` with `partySize`, and
  `table.not_found` with `tableId` for an inactive table (`table.inactive` comes only from
  seating); the form's Save is disabled only while a save is in flight (`busy`), so no refusal
  disables it, and its own check shows one paragraph in the dialog rather than a message under the
  field; and the payment-provider forms were not in C54's survey either (read, not run): the
  connect and add-reader forms in `packages/payments-stripe` and `packages/payments-sumup`
  (`stripe-connect-form.ts`, `stripe-add-reader.ts`, `sumup-connect-form.ts`, `sumup-add-reader.ts`)
  put a refused request's message in the bottom message, except that SumUp's connect form answers a
  key spanning several merchants by showing a merchant picker, and none of them disables its action
  on a refusal;
  (11) the backup screen's configuration export drops the refusal's code in a catch-all
  (`apps/dashboard/src/screens/backup-screen.ts` `#exportConfiguration`), so a
  `management.request_invalid` naming `passphrase` would read only "The configuration export could
  not be created." at the bottom — read, not run, as unreachable from this form, because the client
  refuses a passphrase shorter than 12 (`MIN_KEY_LENGTH`) before sending and the server's check is
  the same `length < 12` (`apps/server/src/configuration-export-api.ts`).
  **Next action:** the owner says which of these are worth doing.

- **Every login failure is one answer (C95, #930, owner decision 2026-09-30)** — the rule is in
  CLAUDE.md §3 and `docs/developers/conventions-ui.md`. Kept on purpose, each reachable only after a
  credential was proved: `totp.required` (the dashboard's code step, after a right password),
  `google.second_factor_required` (after a valid Google sign-in), `authorization.not_permitted`
  (right credentials, a role without the permission) and the adjustment approver's
  `adjustment.approval_required` for a right PIN whose role is too low; a signed-in person's
  re-check of their OWN password or code (`profile.ts`) still names the field. Still open:
  - The membership route, the adjustment approver, the refund override and the manual-refund
    confirmer have no one-answer test case of their own.
  - Refusals thrown in `apps/server` itself (a malformed id or PIN) carry no `reason`.
  - After a refused login the setup wizard's Connect form leaves the cursor where it was (an
    existing test pins that), while Reset and the dashboard sign-in move it to the password; the
    owner's rule covers marking fields, not the cursor, so whether Connect should match is the
    owner's call (left by A153, #952).
  - The password throttle (A154, #977): a real address with 4 wrong tries, once forgotten, comes
    back with a fresh count if a made-up address with 5 wrong tries lands on its counter (measured
    by simulation; the figures are in #977's description). The PIN back-off
    (`packages/identity/src/pin-throttle.ts`) still refuses every new person for 60 seconds while
    one of its slots is full, fed by paired tills and signed-in routes rather than strangers.
  - Password-reset timing (A147, #942; A159, #986): the real mail-server conversation, which only a
    known address starts, was not measured, and no way to match it was tried. Nothing pins that the
    unknown-address decoy (`writeAndRemoveDecoyAction`, `packages/identity/src/account-action.ts`)
    runs the same statements as a known address: its read, its dead-link delete and its retire
    change no row, so deleting any one of them left the suites green; only a timing script (not in
    the tree) shows them. A copy of the database is not unchanged by a decoy: with `secure_delete`
    at 0 a reviewer found the decoy's random person id and token hash still in the file's bytes
    after commit and checkpoint. It follows, though it was not separately measured, that a copy can
    show that, and when, an unknown-address request happened — not for which address, since the
    row's values are taken from no part of the address (read from the code, not measured).

- **The profile's "Current password" fills the signed-in person's saved password (C98, #934) —
  still open:** the sign-in page keeps its three inline copies of the hidden username field
  (`apps/dashboard/src/screens/login-screen.ts`); moving them onto the `autofillUsername` helper
  (`apps/dashboard/src/widgets/autofill-username.ts`) needs at least a `name` parameter (the
  sign-in page's tests pin `email`; the profile's field is named `username`), the
  `data-autofill-username` hook those tests find the field by, and a decision about an empty email,
  for which the helper renders nothing while the sign-in copies always render. Also unknown: which
  browser and address the owner saw the empty field in. The payments screen's manager-PIN prompt
  now says `autocomplete="off"` (owner, 2026-09-30, C110 #940); nobody checked in a real browser
  whether it then stops offering the dashboard password there.

- **A new passkey is listed under the person's email, with their name as its display name (C99,
  #939) — still open:** the result has not yet been seen in a password manager. The dashboard calls
  `PublicKeyCredential.signalCurrentUserDetails`, where the browser has it, after every sign-in and
  after a passkey is added or removed (C101), but not after the email or display name is changed on
  the Profile screen; nobody has yet seen whether a real password manager then shows the new names.

- **The passkey list says when each passkey was last used and which password manager holds it
  (C100, #945) — known limits:** neither the "Last used" behaviour after a passkey is deleted in the
  password manager nor the password-manager naming was tried with a real browser (the tests stand in
  for the WebAuthn library). A browser following the older WebAuthn Level 2 rules zeroes the
  authenticator identifier under `@simplewebauthn/server`'s default "none" attestation preference,
  which Waitron does not override, and the passkey then shows no password manager. The names are a
  snapshot of the community list at github.com/passkeydeveloper/passkey-authenticator-aaguids
  (commit `3ff200d`, fetched 2026-09-30), names only; that repository states no licence, which is
  recorded at the top of `packages/identity/src/passkey-providers.ts`. Nothing refreshes it, and
  security keys such as a YubiKey show no name, because the FIDO Alliance's metadata was not copied.

- **The browser's password manager is told which passkeys Waitron still accepts (C101, #948) —
  still open:** not observed in a real password manager — the tests replace the browser's methods,
  and Chrome's feature entry says it acts "Initially ... only for Google Password Manager (GPM)
  credentials", which a test browser does not hold. The browser's own methods are called directly
  rather than through `@simplewebauthn/browser`'s `sendSignal()`, which adds only renamed errors and
  throws where a method is missing. Left open from the review, both predating C101: a suspended or
  pending person's passkey is refused before the signature check and an active person's bad
  signature after it, so the two do different work — whether that can be timed from outside was not
  measured; and an expired sign-in challenge answers its own `passkey.challenge_expired`. Not taken:
  after a passkey is added or removed, the Profile screen makes one request more than it needs (the
  signals read beside the profile reload); folding the signal data into the profile response would
  remove it.

- **Review every permission: fewer, coarser, and consistently named** (owner, 2026-09-26). Input
  since C128 (#1031): `sale.take_payment` gates every till payment route and is held by every role,
  staff included, chosen so nobody lost the ability to take payment; the review decides who keeps
  it, and whether to rename it — it is the only permission whose action is two words (a reviewer
  suggested e.g. `payment.take`). The list in
  `packages/identity/src/permissions.ts` has grown one permission per action, and the owner finds it
  too fine-grained: one permission such as `node.manage` might cover what `mirror.create` and
  `node.promote` split today (adding a machine, promoting a standby and, since #708, removing a
  standby that never finished joining all use one or the other). Machine permissions are to be named
  `node.*`, not `mirror.*` — the owner's preference. The review should propose the whole list: which
  permissions to merge, the names, and which role holds each, and then rename the call sites in one
  change. **Renaming is allowed now:** the file's header says permission ids are "never renamed once
  shipped", but a search (2026-09-26, reading, not running) found them stored nowhere — the database
  stores a person's ROLE (`packages/identity/src/schema/persons.ts`), and the names appear only in
  code the box itself serves — and the pre-production rule (CLAUDE.md §3, no
  backwards-compatibility code until a venue is live) covers the rest. The review should confirm that
  by running it, then drop or narrow that header sentence. **Do it before the editable-roles item
  below** (owner, 2026-09-26): once an admin can make roles and give them permissions, the stored
  roles would name their permissions (the roles design is not written yet), so a rename after that
  has to rewrite those rows as well.
  **Restated by the owner 2026-10-02: "review all permissions and the roles they're assigned to"** —
  the review covers BOTH halves: every permission, and which of the built-in roles holds each. Two
  role questions from that morning's dashboard Orders screen answers (B27s, lane C questions.md
  2026-10-02 ~09:40 and ~09:50) belong in it: the staff role holds no `report.view`, so the Orders
  screen gave staff a narrower view of their own (unfinished bills plus today's finished ones) rather
  than the permission deciding; and `print.resend`, held only by managers and admins, was the name
  that first came up for the dashboard's DUPLICADO copy until it was settled that the copy uses the
  till copy's own permission — two permissions for one kind of print is a merge candidate.
- **Roles are something an admin can add and edit; the four built-ins are only defaults** (owner
  decision 2026-09-12, restated 2026-09-28: "especially because I want roles to be definable by the
  customer"; design not written). Detail under *Detail → Roles*: the ladder question decides the
  schema. The dashboard's role lists (the add-person and edit-person forms and the Staff screen's
  role filter) sort by the displayed name in the current language (`rolesByName`,
  `apps/dashboard/src/i18n/domain.ts`), so a custom role's name would take its place among them; the
  adjustments module's reasons screen sorts its two role dropdowns the same way with its own copy of
  the `Intl.Collator` options. Its client-side seniority check keeps a separate ordering; the roles
  design still needs to decide where custom roles belong in that check.
- **Dropdowns sort by the label the person reads, with `Intl.Collator`; a list in a lifecycle order
  says so** (owner decision 2026-09-12). **`wt-select` is retired** (owner, 2026-10-02): `wt-combobox`
  is the one dropdown, and after A178b–e every native select in product code is one;
  `scripts/native-form-fields.test.ts` fails on a new native one written in a screen's `.ts` source
  (A178f). Still open:
  `wt-combobox` does not sort its options, and `wt-data-table`'s `localeCompare` takes no locale.
- **The till's schedule screen tells the person to try again and gives them no way to** (found
  2026-10-03 by review of lane C's W14; read, not run). A failed load shows
  `schedule.load_failed`, "Could not load your schedule, try again" (Spanish: "No se pudo cargar tu
  horario, inténtalo de nuevo"; `apps/till/src/i18n/strings.ts`), but
  `apps/till/src/screens/till-schedule-screen.ts` has no retry control. After a failed FIRST load
  the shifts, swaps and time-off lists show only their headings, and the cover form's shift picker
  offers only "—", so no cover request can be sent. `#reload` runs only when the screen is attached
  and after a successful action, and the only action still possible then is a time-off request — so
  one the server accepts, or leaving the screen and coming back, is the only way to load again. The
  dashboard's My Schedule screen has a "Try again" button (`#retry`,
  `apps/dashboard/src/screens/my-schedule-screen.ts`, added in 4bfbf03ea, #876) and also puts a
  failure line under each failed list's own heading. **Next action:** add a retry button the
  way the dashboard does, and decide whether each failed list gets its own line.
- **Two till controls put `aria-pressed` on a `wt-button`, which does not pass it to its inner
  button** (found 2026-10-03 in review of lane C's W23; read, not run). `wt-button`
  (`packages/ui-core/src/components/wt-button.ts`) forwards `aria-label`, `aria-haspopup`,
  `aria-expanded` and `aria-invalid` to its inner `<button>`, not `aria-pressed`. The two are the
  station picker (`#pick`, `apps/till/src/screens/till-station-screen.ts`) and the card-simulation
  result buttons (`apps/till/src/widgets/tender-pay.ts`). **Next action:** make them native buttons
  with `aria-pressed`, as the Tab drawer's transfer and split pickers and the draft line toggle are.
- **Three till loading lines may not be announced** (found 2026-10-03 in review of lane C's W23).
  The schedule screen (`apps/till/src/screens/till-schedule-screen.ts`, #1103), the lock screen and
  the device chooser each insert a `role="status"` element already holding the loading text and
  remove it when loading ends. W3C's technique ARIA22
  (https://www.w3.org/WAI/WCAG21/Techniques/aria/ARIA22) tests: _"Check that the container destined
  to hold the status message has a role attribute with a value of status before the status message
  occurs."_ The review's run-it seat watched the lock screen's and device chooser's DOM in Chromium:
  each status element was inserted already holding its text and removed when loading ended. The
  schedule screen's was read, not run, and no real screen reader was tried. **Next action:** decide
  whether to keep an empty status region on the page and fill it later, and test that sequence.
- **The counter till may start in a zone its service zone dropdown does not list** (found
  2026-09-14; read, not run). The till's zone list drops `table_tab` zones (`listDefaultZoneOffers`
  in `apps/server/src/till-api.ts`), but its starting zone comes from `resolveNewOrderZone`
  (`packages/venue-service/src/operations.ts`): the device's default, else the zone marked
  `is_counter_default`, neither filtered by service mode. Since A178d the box is a `wt-combobox`,
  which shows an empty box for a value with no matching option (read, not run). Since #1004 the
  dashboard's Departments and zones screen sets a device's default zone, through `PUT
  /management-api/venue-service/devices/:deviceId/default-zone`. **Next action:** find whether a
  `table_tab` zone can be the counter default or a device default; if it can, decide whether that
  is refused where it is set or handled by the till.
- **Is a `+` sub-line enough for a doneness answer on the kitchen ticket?** Doneness is a modifier
  the venue adds itself (Task 10); an options answer prints on the kitchen ticket as an indented
  `+ <list kitchen name>: <label kitchen name>` line. **Open, and worth a cook's eye before a real
  service:** whether that is enough for something a cook must not miss, or whether an options answer
  deserves its own prominent form on the ticket. Nobody has watched a real kitchen read one.
- **"the fiscal record is built from `total` + `vat_breakdown`" is a false-narrow enumeration, and it
  reproduces itself.** Two compliance-track documents carry the same shape about tips
  (`docs/compliance/asesor-questions.md:465`, `docs/compliance/verifactu-findings.md:678`); their tip
  claim is TRUE and the legal track is kept separate. **Next action:** whoever next works the
  compliance track widens those two sentences.
- **Repeated demo-seed venue fixtures — DONE (W8).** The eight suites with a repeated
  `provisionVenue`/`nextNif` pair now use
  `apps/server/scripts/demo-seed/testing/provision-venue.ts`. Their original NIF ranges, check
  letter styles, invoice locales, PINs and admin emails are passed explicitly. The dated-sales
  suite has its own one-off venue setup and was outside this repeated group.
- **`wt-combobox`** (#351): a searchable dropdown in `packages/ui` — pick one option or several
  (`multiple`), and optionally offer to add what was typed when nothing matches. Left out on
  purpose, per its design: searching on the server, disabling single options, taking part in a
  native `<form>`, and showing chosen options as chips (it shows a count instead).
- **Shared database-backed table paging, search and sorting** (owner decision 2026-09-12; users
  first). 50 per page with a server-enforced maximum; search and sort over the whole dataset; debounce,
  reset on filter change, ignore superseded responses, keep passive live refreshes.
  `wt-data-table`'s toolbar search box and filter dropdowns (#362) filter the rows already in the
  browser and emit no `wt-*` event of their own when the search text or a filter changes (only
  sorting and row selection do), so server-backed paging cannot reuse them as they stand.
- **Tell people by email when their account's security changes** (owner, 2026-09-12): password changed,
  passkey or authenticator added or removed, recovery codes regenerated, email changed, Google login
  connected or disconnected. No link, one line on what to do if it was not them. Open: notify the OLD
  address on an email change; wording when an admin made the change; grouping a burst.
- **Permission-based dashboard navigation** (owner, 2026-09-09; `NAV_GROUPS` in
  `apps/dashboard/src/dashboard-app.ts` mostly uses role checks): map every built-in destination to
  its server permission, hide unavailable items and empty groups, same rule for direct URLs and the
  landing screen.
- **Dashboard-wide location context** — one persistent location dropdown in the banner; classify
  every screen and API as venue-wide (the whole database) or location-scoped first.
- **The admin's Edit user form has no Language** chooser; a person's `locale` can only be set on Your
  profile.
- **Typed values are only partly checked — a generic phone-format check landed, a country-specific
  one has not.** `isValidTelephone` in `@waitron/shared` runs on both the browser forms and the
  server write paths (`person.telephone_invalid`), and a number is kept exactly as typed. Still open:
  the country-pack seat (`CountryPack.telephone`, filled by `validateSpanishPhone`) is still not
  called, so a Spanish mobile that fails the national rule but passes the generic one is still
  accepted; other typed fields (email aside) are still unchecked; the tax identifier stays fiscal.
  Confirm with owner: an existing malformed number now blocks an otherwise-unrelated edit, because
  both forms re-validate the telephone field on every submit.
- Still open from #298/#305/#317, device checks before deployment: passkey reauthentication for a
  passwordless account; an operator screen for Google provider credentials; native passkey prompts on
  real hardware; a physical authenticator ceremony; live SMTP through `startServer`; whether an
  intermediary cache honours `Vary: Accept-Language`. #328's overlapping-dialog state was reached
  from code only; nobody has shown a real pointer can get there.

### A8. Receipts

- **One "Receipts" settings page, with a live preview (C116, #989; C120, #1000; C121, #996) — still
  open:**
  - No test pins what the two removed addresses, `/manage/receipt` and `/manage/location-settings`,
    open now; a reading of the router says the overview page, which nobody has run — #993 added
    that test for `/manage/sections`.
  - The paper-width dropdown names widths only, not printers, so two printers of one width at
    different resolutions cannot be told apart (owner's call).
  - The list of widths comes from the last preview, which the page asks for again only when the
    receipt text changes or a width is chosen: a printer or till changed elsewhere does not update
    it while the page is open (probed 2026-10-01 with a temporary browser test: invalidating
    `printers` and `tills` sent no new preview and no new read, while invalidating
    `tenant_receipts`, the control, sent one; 2026-10-04: `tills` is gone, A238). _(2026-10-05,
    W111: it also asks again when the location's address changes, read through `locations`; not
    re-probed for printers.)_
- **The receipt's top block is centred and carries the venue's address, a phone, an email, a slogan
  and a logo — DONE (W111, #1261, owner 2026-10-05).** The owner asked: "For receipts, we need
  to include phone number, address, email address (maybe). Possibly room for a slogan, and allow
  uploading an image for a logo. Also this text should be centred on the receipt". After the QR
  block, which still opens the receipt (C123, below), the printed receipt now prints centred, in this
  order: the logo, the trading name, the legal name, the slogan, the address lines, `Tel. <phone>`,
  the email, the duplicate label and `NIF: …`; the footer message is centred too. Item lines and
  totals keep their columns and the practice warning keeps its place and alignment
  (`formatReceipt`, `apps/server/src/receipt-ticket.ts`). The Receipts screen's preview prints the
  same, and the till's on-screen ticket shows the same lines, with the library image itself as the
  logo rather than the printed dots. None of it enters the filed record or its hash.
  - **Settings live in the existing `tenant_receipts.receipt` JSON, so there is no migration.**
    `ReceiptConfig` (`packages/layouts/src/types.ts`) gains `phone`, `email`, `printAddress` and
    `logo` beside `headerSubtitle` and `footerMessage`. `headerSubtitle` keeps its key; the Receipts
    screen calls it Slogan / Eslogan. A phone is at most 30 characters and passes the shared
    `isValidTelephone` (`packages/shared/src/telephone.ts`: 6 to 15 digits, a "+" only at the
    start); an email is at most 254 characters, with no space around it, and passes identity's
    `isValidEmail`; an empty one means not set. The Receipts screen checks both before saving. A bad value is refused `receipt.invalid` with a
    `reason` (`invalid_phone`, `invalid_email`, `invalid_logo`, `image_not_found`, `not_boolean`),
    shown under its field (`validateReceiptConfig`, `packages/layouts/src/validate.ts`).
  - **The address is the venue location's own**, never typed again: street line 1, line 2,
    "postal code city", and the province unless it names the city (`addressLines`,
    `apps/server/src/venue-address.ts`). A switch on the Receipts screen leaves it off
    (`printAddress: false`); the screen shows the address it will print, or says the location has
    none saved.
  - **The logo is turned into printable black-and-white dots once, when the settings are saved, not
    when a receipt prints.** Decoding an image uses sharp, which must not run inside a transaction
    because the decode would hold the venue's one write lock (`prepareImage`,
    `packages/media/src/prepare.ts`), and a receipt is built inside the sale's transaction. The
    save stores one picture per paper width in the same JSON (`logoRasters`, drawn by `drawLogoRasters`,
    `apps/server/src/receipt-logo.ts`); `getReceipt` leaves them out, so neither the dashboard's read
    nor the till's boot carries them. Printing reads the settings and that paper's picture in one
    read through `getPrintedReceipt` (`packages/layouts/src/receipt-store.ts`), which answers no logo, rather than failing the sale,
    for a stored picture of the wrong shape — a configuration import copies the JSON unchecked. The
    image is picked and uploaded through the media library, whose upload refuses an over-large,
    non-image or unreadable file with its own codes; an image the receipt uses cannot be deleted
    from the library (a `receipt` usage, `packages/media/src/images.ts`). If it vanishes anyway, the
    stored pictures still print.
  - **The logo's bound:** scaled, keeping its proportions and enlarged if small, to fit the width the
    QR may take (`safeWidthDots`: 360 dots on 58 mm, 504 on 80 mm) and at most 160 dots high
    (`LOGO_MAX_HEIGHT_DOTS`, `packages/printing/src/dither.ts`) — 20 mm at 203 dpi, 22.6 mm at
    180 dpi. So a square or tall image takes at most about 2 cm of roll, while a wordmark up to
    about three times as wide as it is tall still uses the QR's full width on 80 mm paper, 504
    dots (about 63 mm at 203 dpi).
  - **A reprint shows the current trim:** the address, phone, email, slogan and logo are read when a
    copy prints (`buildReceiptBytes`, `apps/server/src/receipt-print.ts`), not kept with the sale, so
    a copy of an earlier sale shows today's.
  - **Overlap with lane E's A231 (full invoices at the till), for whoever rebases second:** on an F1
    that prints the taxpayer's domicile, the location address is not printed as well.
  - **Overlap with A231d (invoices by email):** its approved design adds a contact email and
    optional phone to the location's settings; the venue-wide `phone` and `email` above already
    exist, so whoever builds A231d decides whether to reuse them rather than add a second contact
    email.
  - **The Receipts preview redraws the whole receipt once per highlighted part.** It finds each
    part it highlights (a "mark") by drawing the receipt again without that part and comparing the
    two (`apps/server/src/receipt-preview-api.ts`). W111 took the marks
    from 2 to 6, so one preview can draw the receipt up to 7 times, and the screen asks for a
    preview after each pause in typing. Cheaper: have `formatReceipt`
    (`apps/server/src/receipt-ticket.ts`) record the byte range each part emits, so one draw yields
    every mark. Not measured.
  - **Left open by #1261's review, not acted on (2026-10-05):** (1) no database trigger protects
    the logo image (the approved design adds no migration; the app-level `receipt` usage refuses a
    library delete); (2) a configuration import does not validate the `tenant_receipts` JSON (the
    print path reads it defensively instead); (3) the phone and email length limits (30 and 254)
    are copied into the dashboard's Receipts screen and nothing keeps the copies in step with
    `packages/layouts/src/validate.ts`; (4) a reviewer, reading only, believed that a
    `tenant_receipts.receipt` value that is not valid JSON would make every sale fail when its
    receipt is built — untested, and I believe it predates W111.
  - Not yet checked on paper: the logo, and the centred block, on the owner's box (FYI in the
    campaign's questions file). Local screenshots in `~/waitron-campaign/w111-shots/`.
- **«QR tributario:» above the QR (C115, owner 2026-09-30) — done (2026-10-01, #999).** Both the
  printed receipt (`apps/server/src/receipt-ticket.ts`) and the till's on-screen ticket
  (`apps/till/src/screens/till-ticket-view.ts`) print the caption, in Spanish whatever the receipt
  language, on its own line directly above the QR. Follow-ups:
  - **The caption, the QR and the VERI\*FACTU line open the invoice — done (2026-10-02, C123,
    #1038; owner, 2026-10-01).** AEAT's «Detalle de las especificaciones técnicas del código «QR»
    de la factura…», version 0.5.0 of 10/12/2025, section 3, says «El código «QR» se situará al
    principio de la factura, antes de que empiece el contenido de ésta generado por el sistema
    informático de facturación, a menos que se justifique la existencia de algún obstáculo para
    ello, en cuyo caso, deberá quedar siempre bien visible y estar claramente separado y
    diferenciado –de forma que destaque– del resto de contenidos y otros posibles «QR», ocupando un
    lugar preeminente.» The printed receipt and the till's on-screen ticket now start with the
    caption, the QR and the VERI\*FACTU line, then a blank line (on screen, a dividing line), then
    the venue's name and the rest in the order they had. A practice (Demo or Prepare) ticket still
    starts with its practice warning, above the QR, because that warning says the whole ticket is
    not a real invoice. The caption and the VERI\*FACTU line are no longer written into the
    receipt code: the fiscal backend supplies them (`receiptQrText` on `FiscalBackend`,
    `packages/fiscal/src/backend.ts`), the Veri\*Factu backend with those two Spanish texts and the
    no-regime backend with none (owner, 2026-10-02). A receipt with no QR — the no-regime backend
    never makes one — prints neither the caption nor the VERI\*FACTU line (owner, 2026-10-02); a
    receipt printed with the QR but no words from the backend would print the QR alone. The
    printer's sample receipt and the Receipts preview take the words from the venue's backend too,
    and show no QR when it has none.
  - Left as it is (owner, 2026-10-01: "leave it"): the same section asks for the caption and the
    VERI\*FACTU line in a readable typeface and size, equal to or larger than the rest of the
    invoice's data. On the till's screen (read from its styles, not measured) both take the ticket's
    ordinary size while the venue name and the TOTAL row are drawn larger; on the printed receipt
    every line of text is drawn at one size (read, not checked on paper).
- **One receipt language per location (C113, owner 2026-09-30) — landed 2026-10-02 as #1014,
  owner-approved.** A receipt prints in ONE language, never two, with no choice when the original
  prints, and dish names print as they were saved. The language is the first entry of the location's saved list
  (`locations.invoice_locales`), read in the transaction that files the sale (`readReceiptLanguage`,
  `packages/catalogue/src/operations.ts`); a reprint asked for without a language prints in the
  language the sale was filed in (`sales.locale`). The fixed words come from Spain's country pack
  (`packages/country-es/src/receipt-labels.ts`). You set it on Venue settings' **Receipts** tab or
  setup's venue screen; **in Catalonia it is fixed to Catalan**
  ([regional-language-rules.md](compliance/regional-language-rules.md), Catalonia). Server: `GET`
  and `PUT /management-api/receipt-language` (`apps/server/src/location-settings-api.ts`).
  - **A copy can be printed in another receipt language (C114, landed 2026-10-02 as #1022).** Where the till reprints an issued receipt (the finished
    sale's Reprint and a paid bill's Receipt), a venue whose country offers more than one receipt
    language asks which, starting on the first of these it offers: the language the sale was filed
    in, the location's, the first offered; a country with one reprints at once. Only the
    fixed words, money, date and percentages follow the choice; dish names, unit names and option
    answers print as the sale was filed. The copy is marked as one, files nothing and opens no
    drawer. `POST /api/sales/:id/reprint` takes an optional `language`, refused with
    `management.request_invalid` (`field: "language"`) unless it is one of the country pack's
    receipt languages, which `GET /api/till` lists as `receiptLanguages`. A copy is offered in every
    receipt language the pack has, even in Catalonia: a product choice, which includes Spanish, the
    customer's right there on request (Spain's Constitutional Court, ruling 88/2017;
    [regional-language-rules.md](compliance/regional-language-rules.md), Catalonia). The till learns
    the filed language from the sale it just recorded, and for a paid bill from `receiptLanguage` in
    the party's bill list (`readPartyBills`, `apps/server/src/parties.ts`). Catalonia's reason on
    setup and the Receipts tab of Venue settings say a copy can be printed in another language. The dashboard
    Printers screen's Resend still sends a job's stored bytes again (owner, 2026-10-02), and the
    Orders screen's copy (`reprintOrderReceipt`, `apps/server/src/orders-reprint.ts`) prints in the
    language the sale was filed in. Two tidy-ups #1022's review raised and left, because each changes
    files outside it: the till's four choice dialogs (`apps/till/src/widgets/`) each carry their own
    radio-option styles, which could be one shared set; and three older dashboard screens name
    languages with their own code rather than `languageDisplayName` (`packages/shared`).
  - **Open, for the owner:**
    - **A change is refused while an open order at the location holds a line**
      (`receipt.language_orders_open`; narrowed by C124, #1020, 2026-10-02, with core
      `0064_line_locale_triggers_text_only`). The order-line language triggers now check a line's
      names only when an update changes them or moves the line, so the till can still split such a
      line, which copies its old-language names into a new line, or move it to another bill, and the
      database refuses both once the language differs. Measured by the till's own routes
      (`apps/server/src/location-settings-api.orders-open.test.ts`): placed orders, paid bills whose
      party is still seated, a paid order with a dish no station took, and an open bill with no line
      no longer block. After the change, the tests serve a seated party's paid dish, take back a
      serve on one, send a paid sale's unsent dish and collect a placed order. If a language is
      changed underneath an open bill by another road (the configuration import writes
      `invoice_locales` directly), the bill's next split answers an unmapped 500
      `server.internal`; the same test file pins it, changing the language by direct SQL.
    - After a change, a paid counter sale with one dish a station took and one it did not is not
      blocked, and its send-to-prep route (`/prep`) then answers 409 `ticket.already_fired`, as it
      did before the change, and leaves the order's lines unchanged. No till screen calls that
      route.
    - A placed order collected after a language change is filed in the new language
      (`sales.locale`) with its dish names as saved when its lines were added; when the new language
      is not among the languages those names were saved in, its receipt prints the new language's
      fixed words with a dish name in an old language (`lineName`'s fallback,
      `apps/server/src/receipt-ticket.ts`; read in the code: the test checks what is filed, not a
      printed receipt). An invoice-first order is filed at placing and keeps
      the language it was filed in (the case "accepts a change while an invoice-first order is
      placed, and collecting it keeps the language it was filed in" in the same test file).
    - The refusal's count of blocking orders is not shown on the Receipts tab of Venue settings: `codeMessage` fills
      in no values.
    - **The payment slip was left alone.** Its words («JUSTIFICANTE DE PAGO», «Importe»,
      «Cobrado») stay Spanish (`apps/server/src/payment-slip.ts`), and its date and amounts still
      follow `WAITRON_TILL_LOCALE` (`apps/server/src/payment-slip-print.ts`). It is not the
      invoice, but art. 128-1.2.a also covers «els altres documents que hi facin referència o que
      en derivin», so a Catalan venue's slip is arguably covered.
    - **The translations need a native or official check before go-live.** Apart from the Catalan
      «Factura» and «Propina», which the Consumer Code and the agency's pages use, no word in the
      table was checked against a terminology source. The owner landed it as is on 2026-10-02
      ("land, review words later"); the follow-up (C125, below) was then parked by the owner on
      2026-10-02 ("save the full translations for much later").
    - The provisioning command (`waitron-provision`) and the configuration import can still store
      two languages, or one no pack offers; the first entry is what prints. Neither holds Catalonia
      to Catalan: only the Receipts route and setup do.
    - `cfg.invoiceLocales` (`apps/server/src/till-config.ts`) is no longer read outside tests (by
      grep) and can be retired.
    - The till reads its fallback receipt language and the allergen sheet's language only when it
      starts (again after a server switch or an enrolment), so a change reaches those after a
      reload. The on-screen ticket follows each sale's own language.
    - The dev and demo seed's English mode stores `en-GB`, which prints the Spanish words beside
      English dish names; the Receipts tab of Venue settings shows it as the saved language although it is not
      offered.
    - The till's on-screen ticket writes a Galician or Basque sale's amounts and date the Spanish
      way (`20,00 €`, `5 ago 2026`), while its words are Galician or Basque. Measured 2026-10-02:
      Playwright's Chromium 153 resolved `gl-ES` and `eu-ES` number and date formats to `en-US`,
      and Google Chrome 154 on macOS to `en-GB`, so the screen falls back to the registry's
      `FALLBACK_RECEIPT_LOCALE` for any language the browser cannot format. The printed receipt is
      formatted on the server and keeps the language's own pattern.
    - The printed Basque date is the formatter's own pattern, «2026(e)ko urt. 15(a)», and drops to
      its own line on 58 mm paper.
    - The sample receipt the preview draws keeps its Spanish content («Mesa 6», «MUESTRA/1»,
      «Café y tostada») in every language; only its fixed words change.
- **One original per invoice, structurally.** `POST /api/sales/:id/receipt` has no limit and no
  idempotency; two calls produced three unmarked originals, and art. 14.1 says exactly one. Cheapest
  containment: idempotent per sale, invoice number on the slip.
- **Tip-collection UI** — the only surface that COLLECTS a tip is the integrated-Stripe idle screen;
  cash, manual card and the handheld have none. A design decision per tender type. And `#onPayTab`
  flattens every server code but the two permanent fiscal refusals to one `sale.error` key, hiding
  `sale.empty_basket`.
- **Catalan, Valencian, Galician and Basque — the receipt's words checked, and the whole app in all
  four (C125, owner 2026-10-02) — PARKED by the owner (2026-10-02: "save the full translations for
  much later"); taken out of the campaign queues the same day.** Asked for on C113's question
  ("Land, review words later, and add full translations for catalán, valenciano, and gallego";
  "Receipt + whole app"; Basque: "Treat it like the others"). Nothing was written: the
  `docs/regional-languages` branch holds no commit and no draft. When it is picked up, the first
  step is a spec and plan, ending with the owner's choices:
  - **Receipt:** every fixed word C113 added in Catalan, Galician and Basque checked against an
    official or authoritative source (for example Termcat, the Acadèmia Valenciana de la Llengua,
    the Real Academia Galega or Xunta terminology, Euskaltzaindia or Euskalterm), each with a
    provenance row quoting the source; and Valencian as its own receipt language — which locations
    may or must use it (provinces 03, 12 and 46), what the law requires there, with sources, and
    which printed words differ from Catalan.
  - **Whole app:** the dashboard, the till and setup offered in all four beside English and
    Spanish — how strings are held today and every place that pins the list of interface
    languages (language choosers, `Accept-Language` matching, tests); how translations are
    produced and checked, and what shows when one is missing; whether Valencian is its own
    interface language or a variant; and an order of work that keeps `main` green.

### A9. Product depth — after the primary works

- **Product languages are hard-coded at setup** (owner, 2026-09-13). The hard-code is in
  `packages/catalogue/src/provisioning.ts` and names this entry. Since C112 (#992) Spain's country
  pack names, per region, the content languages Waitron keeps enabled for the region
  ([regional-language-rules.md](compliance/regional-language-rules.md)), and the server refuses a
  save that leaves one out (`content.language_required`). Still open: the Spain-wide starting list
  `["es", "ca", "en"]` is unchanged, so a venue in Galicia also gets Catalan; and two writers skip
  the check — the Prepare-to-Live configuration copy
  (`packages/catalogue/src/configuration-transfer.ts`), which copies the saved row as it is, and the
  demo seed (`apps/server/scripts/demo-seed/seed-catalogue.ts`). The proper fix drives the list from
  the venue's region and the languages it chose, which probably means setup asking; do it when there
  is a second region or country to be wrong about.
- **A visible list of missing translations (C122, owner 2026-10-01) — done (2026-10-01, #1006).** The
  Content languages page's **Missing translations** section lists, per enabled language, what has
  no customer-facing name in it.
  - What a diner sees when a name is missing (measured 2026-10-01): with default Spanish and a
    receipt in Catalan or English, a customer name holding only Spanish printed its Spanish text,
    and a product with no customer name printed its staff name; an option's receipt text (a direct
    call to `customerOptionSnapshotLabels`, not through a sale) did the same. With default Catalan and a customer name holding only Spanish, the receipt's goods line
    printed no name at all (next entry). The till's buttons and basket always show the staff name.
    The kitchen name has no language, so nothing is missing from the kitchen.
  - Left out: image names. They come from the media module through the `contentTranslations` seat,
    which carries only a kind and an id; naming or linking them from the generic screen would break
    the module boundary (`scripts/module-seams.test.ts`), so widening the seat is its own change.
  - Open, for the owner: something with no customer-facing name at all is listed under each
    non-default language as "No customer-facing name", so a venue that never filled customer names
    sees most of its menu under each extra language. Under the default it is not listed, because the
    staff name stands as that language's text — so in a new Barcelona venue (default Catalan) a
    Spanish staff name with no customer name is not flagged under Catalan.
  - Open: a section's own form has no address, so a section links to its menu's Structure tab.
- **A customer-facing name with no text in the default language prints a blank goods line — OPEN
  (found 2026-10-01 by C122).** Under default Catalan, a customer name holding only Spanish printed
  `1 u` and the price with no name on the receipt, and stored `{"ca-ES":""}` on the sale line
  (`toInvoiceLineDescriptions`, `packages/catalogue/src/invoice-descriptions.ts`, then `lineName` in
  `apps/server/src/receipt-ticket.ts`). No save path writes such a row today (product and variant
  saves refuse it), only a direct write. It shows under the default language in the Missing
  translations list.
- **`joinCustomerPresentationText` passes the requested language where the default belongs — OPEN
  (found 2026-10-02 by A172, not measured).** It calls `resolveSnapshotText(variant, locale,
  locale)` (`packages/catalogue/src/product-presentation.ts`), the shape A172 fixed in
  `customerOptionSnapshotLabels`, so a locale blank in a variant's map takes the first stored
  language alphabetically rather than the default. The receipt fills the variant's text per
  receipt language before it gets there (`apps/server/src/working-order.ts`), so whether any
  surface shows the difference is unknown; reproduce before fixing.
- **The menu section form's customer-name hints skip the default language — DONE (W11, #1112; found
  2026-10-02 during A172).** Each blank customer-facing name in
  `apps/dashboard/src/widgets/section-details-form.ts` now hints the default language's name, then
  the internal name, because the form passes its default language to `optionalTextFields` as the
  product, variant, options list, option and extras list editors do. The same form is the menu's
  Create and Rename form (`#renderMenuForm`, `apps/dashboard/src/screens/menus-screen.ts`), so a
  menu's own names are hinted the same way.
- **The default-change check counts deleted and switched-off things — OPEN (noted 2026-10-01 by
  C122; I believe this predates the branch).** `listContentTranslationGaps`
  (`packages/catalogue/src/content-languages.ts`) has no `active` filter on top-level products,
  options lists, extras lists or a menu's sections, and keeps a variant whose product is deleted, so
  a deleted product's partly translated name blocks a change of default while the Missing
  translations list leaves it out. The case "a deleted product, which the default-change check
  still counts" in `packages/catalogue/src/content-translation-report.test.ts` pins today's answer.
- **Folder-driven routing to multiple printers/destinations** (owner, 2026-09-30): the
  [approved routing design](superpowers/specs/2026-09-30-catalogue-menus-routing-design.md)
  replaces the former label-driven proposal. Prep stations claim folders, with ordered exceptions
  and fallbacks. Slice 3a builds folder claims and ordered exceptions; opening hours and fallbacks
  are slice 3b, and watcher copies are slice 3d. Reporting attribution stays separate so one sale is
  counted once.
- **Departments and menus** (#297) remaining: remove the legacy price and fixed-station compatibility
  fields; per-menu modifier authoring; workforce assignments; immutable department attribution and
  reporting; batched readiness and offer queries; a replication smoke test. Same legal seller is the
  working assumption, to confirm before go-live. Hours moved to A254.
- **Departments, service styles and opening hours (A254, owner 2026-10-03) — DRAFT SPEC, partly
  implemented through A261.** The first department is named after the venue; the
  four-value service style splits into separate settings, and a tab no longer needs a table; hours
  come from venue-wide day types plus a calendar; a per-department switch prints the trading name.
  [Spec](superpowers/specs/2026-10-03-departments-service-styles-hours-design.md); §6 lists what is
  open, including advisor questions Q21, Q14, Q27 and Q22.
  Its §4 day types and §5 placement are revised by A261. A261 step 2 names the sole department on
  Departments and zones; other screens still await their own one-department survey. Tab billing and
  the shared calendar remain open.
- **Venue operations: how the venue is organised and configured (A261, owner 2026-10-03) — SPEC
  APPROVED; steps 1–3 implemented, later steps open** ([step 1 plan](superpowers/plans/2026-10-03-venue-settings-and-navigation.md)).
  The sidebar's Venue operations group; Venue settings with one tab per group
  (Receipts moves there); Departments and zones as one table edited in place; Prep stations as one
  tab per subject, with a live Stations tab and routing as a categories × zones grid; Hours with
  special dates, a calendar and public holidays; Printing rules and the cash drawer policy deleted.
  Eight build steps, each its own queue item.
  Step 7 (venue details) is in progress on `feat/venue-details-editing`. Its shared server
  reader/writer now has focused checks for normalization, field-specific stale drafts, no-op
  retries and province/clock refusals after a sale, order history or daily close. The new
  venue-details GET/PATCH routes use venue-view/configuration permissions and return field
  refusals. Additional controls exercise retained sale rows, full-row retention, rollback,
  no-op change-feed silence, and both real-sale/clock-save queue orders. Configuration export
  includes corrected details; import keeps its separately created target address and clock.
  Both boot account-email callbacks now read the venue clock on each send; real SMTP checks
  cover invitations, resets and profile email changes, with the shutdown reset check retained.
  Additional consumer checks exercise saved clocks in current station/booking reads,
  retained backup/cloud deadlines followed by new-clock scheduling, printer calibration,
  operational report windows and frozen closes, receipt reprints, and workforce summary/roster
  reads with midnight offsets. Sent kitchen assignments stay equal through allowed corrections.
  W111's current address printing is retained separately from filed identity and trading snapshots.
  The dashboard client and passive live-query dependencies now cover venue details and their
  history restrictions; its patch/validation helper keeps untouched legacy-null fields out.
  Direct CLI creation controls retain the deployed venue and series on changed details.
  Numeric-offset clock edits are refused consistently with the reporting validator; named
  zones such as `Etc/GMT+2` remain accepted. The Venue details panel is the initial tab,
  with live draft/error separation, changed-field confirmation, clock-change boundaries and
  each worker's retained backup deadline. The current server report route and the rendered
  roster's stored wall times have before/after receipts. EN/ES, light/dark and phone/desktop
  states have accessibility scans and retained screenshots. Whole-branch review and
  current-head CI remain before landing.
  This build changes no schema.
  [Step 3 plan](superpowers/plans/2026-10-05-prep-stations-tabs.md) was approved on 2026-10-05;
  its build landed as [PR #1269](https://github.com/clintongormley/waitron/pull/1269) on
  2026-10-06 at `924a94b745275627003db2912156dfbb266aa3ae`. Current-head package checks
  and coverage passed in CI `37385456975`; the 603-second Claude review findings were resolved.
  Existing installations require the approved venue reset to provision timing defaults; no
  old-value conversion or backfill is included. The exact-merge CI run is `37386339024`.
  CI exposed missing timing-default rows in direct server fixtures and incomplete provisioning
  cleanup; the fixtures now include the required rows, and cleanup removes timing children first.
  The Spanish reminder check now uses the approved Deshabilitado wording.
  Additional browser checks cover retained printer IDs, tied station/watcher ordering, extra
  routing explanations, retryable watcher refusals and dialog cancellation/invalid rename recovery.
  A refused unassigned-folder claim keeps its field message beside that folder; unavailable watcher
  metadata keeps the retained watcher ID visible on its printer choice.
  The schema foundation adds venue defaults and separate nullable station
  timing storage. Provisioning now creates 5/10/15 defaults, with a supervisor-readable defaults
  API whose writes refuse an invalid effective station order. Station creation and edits now write
  independent nullable overrides. The management list, kitchen queue, pass, floor bands/signals and
  overdue report resolve inherited values, and configuration transfer carries defaults and overrides.
  The station-health API now returns dish-row counts, per-band lateness and oldest-first kitchen
  drilldowns with remaining quantities, using one captured time. Supervisors can read it; staff
  cannot. The screen now observes the health read and refreshes elapsed values every fifteen
  seconds. A shared table renders live counts, per-band and state drilldowns, remaining quantities,
  Default/Disabled labels and separate printer/screen problems. Health refreshes retain open drafts;
  read recovery waits for the failing read and preserves action refusals. The five subject tabs now
  have stable deep links, Back restoration and creation actions beside the strip; old tester links
  open Routing, where category claims, exceptions and the tester remain mounted. Interim station
  hours sit below the panels.
  Category wording and Disable/Enable actions apply in both languages. Tickets now lists printer
  selections, current kitchen screens and following watchers, with links to Devices and Watchers.
  Its multi-select saves a complete printer set in one request; a refused set retains its draft and
  previous mappings. Disabled printers can be removed from retained assignments but not added.
  Printing rules now links to Tickets and Watchers instead of editing either printer assignment;
  its drawer controls remain for step 8. Watchers retains a printer conflict until Tickets releases
  every station mapping for the selected printers, without clearing an unrelated save error.
  Tickets localises its empty state.
  Watcher printer selections now have a whole-set API using the existing printer-management
  permission and assignment checks in one transaction. A refused new mapping rolls back earlier
  moves; an already selected disabled printer can be retained or cleared. The Prep client exposes
  that write. The Watchers printer editor now submits a whole selection beside its shown output,
  explains station and disabled-printer conflicts, permits transfer from another watcher, and keeps
  refused drafts retryable through live reads. Cancel/Escape sends no write; a successful save closes
  before refreshing. Watchers now uses a table with the printer picker in its Printers cell.
  Follows and service-zone cells choose every member or an explicit list; Runs the pass uses its
  own choice editor. Rename and Disable sit in the row menu. Screens includes retained inactive
  bindings and links to Devices. Cell drafts and save refusals survive live reads; Rename writes
  saved values for every other field, leaving unsaved drafts out of its request. The watcher-printer
  handover is implemented. Stations now
  offers confirmed Open/Close for today and Back to the schedule actions, with retry after a write refusal. Default and unscheduled stations
  say Always open without an action; disabled stations and an unreadable clock offer no hours
  action. Today now shows the next scheduled opening or closing, distinguishing tomorrow and later
  weekdays; overlapping or adjoining intervals keep the station open until the actual closure.
  Its passive minute refresh changes the displayed state without a database event. Stations now
  has Rename, Make default and confirmed Disable/Enable row actions, plus pointer and keyboard
  ordering saved as one validated active-station set. Rename submits only the name and closes before
  refresh; refusal retains an editable draft. The Prep page explicitly reads retained station
  metadata so disabled health rows can show their state and Enable action; ordinary station lists
  remain active-only. Settings now has independent choice editors for Show the rest of the order
  and When closed, work goes to; the default station reads Never closes without a fallback control.
  A fallback save confirms its destination inside the cell; changing that draft requires a new
  confirmation. Refusals retain a retryable draft, local validation focuses the choice, Cancel and
  Escape discard, and live reads preserve typed choices and save errors. English/Spanish,
  light/dark, phone/desktop saved, picker, refusal and confirmation captures were inspected.
  Settings now shows the three effective late flags, distinguishing inherited minutes from an
  explicit override even when it equals the venue default. Each numeric cell saves its own field;
  clearing it inherits the default. Local checks enforce whole positive minutes and effective order,
  focus the invalid cell and disable Save after an invalid submission. Server refusals keep the
  draft retryable. Live defaults refresh inherited values while retaining drafts and action errors.
  Supervisors can now open the live Stations overview and its read-only drilldowns. The page
  loads only station metadata and current status, without printer, device or catalogue management
  reads; configuration tabs and actions are absent. Saved configuration links return to Stations.
  Routing cards no longer repeat printer/screen/watcher relationships, late-flag summaries or
  the rest-of-order switch; those appear in Tickets and Settings. The standalone fallback editor
  now lives
  in the Settings cell, retaining destination confirmation, disabled choices, empty-to-null
  saves and field refusals. Disabled stations remain editable at the bottom of Settings, labelled
  Disabled; changing their fallback does not enable them. Confirming an unchanged fallback sends
  no write, including a retained disabled destination. Routing no longer repeats Today, Make default,
  Disable or Enable actions; they use the Stations table, with the same confirmation and refusal
  paths. Whole-record editing and duplicate station status/output warnings have also left Routing.
  Rename, ordering and Settings cells retain their separate write paths; station creation retains
  its form. Rename refuses a draft whose station disappeared during a live refresh. Stations gets
  its output problems from the health snapshot, with warning text wrapped within the shared name
  width so it does not stretch the table into a single long line. The 2026-10-05 Claude run-it review
  reproduced missing-default kitchen reads returning empty results; the readers now refuse
  `station.timing_missing` instead. Seven consumer regression cases and the defaults-readiness
  guard cover this refusal; no migration backfill or old-value conversion was added. The old
  numeric columns carry a retirement note. Review notes retained for future cleanup: the overview
  API object still exposes write methods (server routes remain the permission boundary), and
  station reordering repeats an active filter after an active-only read. No write-permission
  defect was reported. Push-hook validation and current-head CI passed before landing.
  Venue settings › Kitchen now reads and
  replaces the venue-wide late flags. Its required whole-minute fields validate every invalid
  value and their order, naming a station when the server refuses the effective result. A refusal
  retains a retryable draft; live reads update saved values without replacing it. Supervisors see
  the saved defaults without edit controls. Enter saves, Cancel/Escape discards, and a successful
  write closes the form before a separate refresh. The saved, invalid and station-refusal states
  have English/Spanish, light/dark, phone/desktop browser checks and inspected captures.
  The generated station-parent rebuild failed the populated upgrade with a foreign-key refusal;
  the landed build uses the plan’s storage-redesign option. Approved decisions
  cover what live counts include, ready-but-unserved work, interim station hours, inactive display
  bindings and the core station-table rebuild/reset risk.
  [Step 5 Hours plan](superpowers/plans/2026-10-05-hours.md) was approved on 2026-10-05;
  its standard week, special-date list/calendar and shared menu/wages date interface are not
  implemented. Its Prep stations dependency is landed; follow the lane queue for the build.
  Approved decisions cover unset versus Closed/all-day hours,
  overnight and clock-change rules, manual override expiry, whole-venue closure and palette,
  single-department display, read permissions and the proposed pre-live schedule reset.
  [Step 6 Public holidays plan](superpowers/plans/2026-10-05-public-holidays.md) is approved with
  the owner's 2026-10-05 13:25 amendments; national/regional data, owner-entered city holidays and
  holiday-aware special-date naming are not implemented. Build waits for Hours landing, including
  its Prep stations dependency, which is now landed. Hours remains unbuilt.
  Local holidays follow the venue address city directly, with no confirmation or reselection.
  Geography changes retain but hide old entries with `These local holidays were for <old city>`;
  matching the address again restores them automatically. Two additive venue-service tables hold
  geography/area identity and local entries, without a settings/selection pointer. The country
  holiday capability supplies the allowance (Spain 2 from the plan's BOE receipt; no capability
  permits no local entries, including import), and the UI reads it from the response. Approved
  incomplete-year notices, full label/naming rules, permissions and all other behavior remain.
  The consolidated 2027 BOE list was not located by the plan's dated search; recheck it before the
  build rather than extrapolating dates or treating a regional publication as nationwide coverage.
  [Step 4 Routing grid plan](superpowers/plans/2026-10-05-routing-grid.md) was approved on
  2026-10-05; the grid and row-first cell storage are not implemented. Its Prep stations dependency
  is landed; follow the lane queue for the build. Approved decisions cover the No category group,
  nested collapsed counts, configured
  versus fallback cell presentation,
  read-only default-cell permissions, retained disabled targets, zone cleanup and pre-live routing
  reset. It replaces claims/ordered exceptions without conversion, with five stored coordinate
  classes and populated-upgrade/configuration-transfer checks.
  [Step 7 Venue details plan](superpowers/plans/2026-10-05-venue-details.md) was approved by the owner on
  2026-10-05. Its build is in progress: the shared server writer,
  authenticated API, live consumer controls, and core dashboard editor are implemented on the
  feature branch. The editor validates changed fields, retains drafts across passive updates,
  requires warning acknowledgement, and offers read-only supervisor access. Clock previews,
  the final acceptance audit, branch review and CI remain open; the feature is not landed.
  The approved policy allows current display-name/street/city
  corrections and same-province postcode edits, preserves recorded names and facts, keeps taxpayer
  identity read-only, and locks province/clock after sales. Clock edits also stop after order history
  or a daily close. Pre-sale province edits need equal fiscal/language/clock context and the same
  sourced holiday region; absent that holiday capability only real province edits stay locked.
  The approval also covers no-op and stale-draft behavior, legacy-null field validation, warning
  acknowledgement, the default tab and clock-change previews using the existing reporting resolver.
  No schema migration or reset is proposed; changes needing another fiscal/geographic context or
  history removal use a separately approved setup/reset instead. Step 2 is already landed; later
  Hours/holidays/menu builds retain their own compatibility tests.
  [Step 8 Printing rules and drawer policy retirement plan](superpowers/plans/2026-10-05-printing-rules-and-drawer-policy-retirement.md)
  was approved by the owner on 2026-10-05; its build remains open.
  It removes the redundant
  page and legacy location receipt/drawer settings, makes manual drawer authorization unconditional,
  and preserves device/profile/printer gates, automatic drawer jobs and receipt/replay safeguards.
  The owner approved the plan on 2026-10-05 at 15:55; its step 3 dependency is now landed,
  alongside A238 and step 2. Follow the lane queue for the build. Recommendations cover
  old bookmarks, incompatible export refusal and explicit reset approval if the populated locations
  upgrade cannot preserve cross-set rows and triggers. Existing guards remain unchanged; useful
  screen checks move to surviving surfaces before retirement, with any deletion lacking an equally strict replacement requiring approval.
  [Step 1, PR #1166](https://github.com/clintongormley/waitron/pull/1166) gathers Receipts,
  Tables and Kitchen settings into tabs; supervisors can read Tables and Kitchen, while writes
  remain manager-only (owner amendment, 2026-10-04).
  [Step 2](superpowers/plans/2026-10-04-departments-and-zones.md) puts departments and zones in one
  editable tree, resolves quick-sale and receipt choices by department with optional zone overrides,
  and keeps today's zone-menu and device-default-zone controls temporarily in that screen. Its
  follow-up A261-2c removes the retired `locations.order_flow` column after a separate rebuild audit.
  Owner decision, 2026-10-05: retire the legacy `invoice_first` collection-ticket path
  in A261-2c alongside the column, with a venue reset accepted. That implementation has not
  landed; the item is parked pending the populated-upgrade test's reset decision.
  The Numbered collection choice applies to `prepay` and `ticket_then_pay` quick sales.
  A261-2f explains the quick-sale-only scope in English and Spanish on the department and
  zone Order number cells and editors. Filled choices use the shared help button; table-tab
  orders are not numbered. Browser checks open both controls in both themes at phone and desktop widths.
  A261-2d identifies the `floor_zones` name key in `createServiceZone` and the
  server's `createZone`/`updateZone`; primary-key clashes remain database errors. Focused
  real-database tests force all three clashes and retain duplicate-name and rollback checks.
  A rename refusal without a supplied name remains a database error, rather than returning an
  undefined name.
  The sibling audit found no such translation in department create/rename. Outside this zone
  item, `apps/server/src/tables.ts` still translates every unique refusal in `createTable`,
  `updateTable`, `createStatus` and `updateStatus` to a label collision; a separate
  follow-up should identify each label key and force another-key clash.
  [A261-2e, PR #1277](https://github.com/clintongormley/waitron/pull/1277) is landed. It runs an encrypted export captured from `c47122f55^` through the current setup import
  route. It answers `setup.request_invalid` (`module:core`); every database table's rows match
  their before-state and the staging directory remains empty. Setup now tells you in English and
  Spanish to export again from a box running the current version for a module-version or
  module-set mismatch. A committed fixture retains the original export bytes; this adds
  no compatibility converter or migration.
  A261-2e's review also found that `declarations` in
  `apps/server/src/configuration-transfer.ts` uses `module:<name>` when a local module lacks
  its transfer declaration. Reachability with the installed module list is unverified;
  distinguish that local build defect from an incompatible artifact if it can reach setup.
  The database-row comparison observes the request's outcome; the staging-files assertion
  is the check that failed when validation was bypassed in the disposable review copy.
  [Spec](superpowers/specs/2026-10-03-venue-operations-design.md).
- **Devices, profiles and departmental transfers (owner, 2026-10-04) — SPEC APPROVED;
  profile access and transfers queued in lane D, equipment queued in lane E; not implemented.**
  Profiles bind departmental access, permitted zones, staff eligibility, actions, screens and
  equipment choices. Devices switch among approved profiles and select equipment and
  station/watcher bindings; drawers are independent of receipt
  printers. Portable equipment supports scan takeover and confirmed dropdown takeover, with busy
  payment terminals protected. Tab transfers require acceptance at a shared departmental receiving
  profile; existing preparation and pickup instructions stay unchanged. Menu work is A204 above.
  [Spec](superpowers/specs/2026-10-04-devices-menus-and-service-zones-design.md);
  [profile access and switching plan](superpowers/plans/2026-10-04-device-profile-access-and-switching.md);
  [equipment plan](superpowers/plans/2026-10-04-device-equipment-and-independent-drawers.md);
  [departmental transfer plan](superpowers/plans/2026-10-04-departmental-tab-transfers.md).
  §10 names the A238/A254/A261 decisions the approved design revises. A261 step 2 keeps its
  existing zone-menu and device-default-zone controls as an interim path; the newer work replaces them.
- **Table states and signals (A267) — OPEN, needs a design session (owner, 2026-10-03).** Which
  states and signals a table has that Waitron sets itself (today Free, Occupied, Reserved from a
  booking, Needs clearing, Bill requested and the kitchen signals), which a venue can switch off,
  which customers can trigger (asking for the bill or calling a waiter from a QR code), whether
  marking a table reserved by hand becomes a built-in action, and whether the hand-set labels on
  Venue settings › Tables are still needed after that — the owner expects they may not be, and if
  they stay, they sit beside a table's state as labels rather than being states. From A261 §10.
- **Counter/walk-up kitchen fire** — the #193 follow-up, the next piece of menu work.
- **Menu draft/published state** and time-of-day / seasonal scheduling.
- **KDS corrections deferred from #191** (owner, 2026-09-01): a moved dish must keep its kitchen
  status — the ticket must travel with the line, not re-fire (`moveTabLines`, which dropped it, was
  deleted by service plan Task 13; whether this still holds for the paths that move lines now is not
  checked); hold-on-send without courses plus a venue disable setting; FP-1's empty-named
  child-modifier row; device-scoped fire/collect routes. Then the low-priority KDS list under
  *Detail → KDS*.
- **Order-timing and modifier follow-ons**: delivery-order floor flash, idle-floor escalation,
  station-kind threshold defaults, an unbumped-since-fire metric; on-screen modifier `×N`, the shared
  `#allergens` render, the KDS-versus-till unreviewed-dish call, post-fire note edit
  (needs a re-fire endpoint), the TS-4 partial-transfer modifier-split guard.
- **Mark a new dish as urgent** (owner, 2026-09-27). A waiter can already send a new dish straight
  to the kitchen ("cook this now, don't hold it") under every release setting; the owner would like
  a way to add urgency to it too, so the kitchen sees it flagged. Nothing like it exists today. Not
  designed: what the flag looks like on the kitchen screen, the pass and a printed ticket, and who
  may set it. Releasing an ALREADY-held group stays with whoever the venue's `fire_control` setting
  names — the waiter asks the kitchen or pass when that is not the waiter.
- **Handheld live updates** — the app is pull-only, so two waiters on one table see stale data until
  a refetch. A sizable new subsystem; spec it when it matters.
- **Device profile follow-ons**: the aggregated device-profile bundle (till, station, hardware, area,
  order routing, printer target on the profile); the visual theme editor. The canvas-editor
  follow-ons that stood here, and a canvas-driven table-order screen, gave way to A4's A182.
- **Language resolution follow-ons**
  ([original design](superpowers/specs/2026-08-30-localization-fallback-negotiation-design.md)):
  there is still no single shared rule: the receipt's `lineName`
  (`apps/server/src/receipt-ticket.ts`) and the kitchen ticket's `ticketName`
  (`apps/server/src/kitchen-print.ts`) try the exact language and then take the first stored one.
  Read in the code and not run: `resolveContentText` moves to another region of the same language
  (es-ES to es-MX), which the design rules out. Adding content translations does not translate
  Waitron's interface.
- **Bookings**, each greenfield: public/online/QR booking, availability, reminders, a CRM entity,
  recurring, a calendar grid, deposits.
- **Wages / labour cost (SP16)** — a per-person pay-rule set (hourly or fixed salary for N contracted
  hours, rate overrides by condition of the hour, paid non-worked states) turning recorded and
  scheduled hours into accrued-versus-pending money. Rates are editable data, never hardcoded convenio
  numbers; needs a public-holidays calendar. Gated on the labour advisor; not fiscal.
- **Logging Slice 2 — one-touch bug report**, then Slice 3 triage and forwarding, with the Slice 1
  hardening (client-trail key allowlist, `maskPath` PII, the setup app). Detail under *Detail →
  Logging*.
- **SP-4 — the module UI surface on the TILL** (card-registry inversion, self-sourcing cards); the
  dashboard half is done. Migrate the remaining core dashboard screens onto the module UI seat and off
  the coarse `requiresManager` gate. A core nav item can now also name a `requiresPermission`
  (`apps/dashboard/src/dashboard-app.ts`); Servers (`mirror.create`) is the first to use it.
- **Installing or renewing the AEAT certificate after setup.** Only the setup wizard can set it
  (`apps/server/src/setup-api.ts`), and nothing watches when it expires: `cert-expiry.ts` reads the
  box's own HTTPS certificate, not the AEAT one. Needs a view, renew and replace surface and an
  expiry alert. Separate from getting the certificate onto a promoted standby (*Afterwards*). Fiscal:
  the owner lands it.

### A10. Clocking in and out — the working-time record

**Staff cannot clock in or out today.** The *registro de jornada* is a legal duty from the first day
the deli employs anyone ([design](superpowers/specs/2026-07-22-workforce-and-time-record-design.md)).
Built: the append-only, hash-chained time entries (per node since #268), contracts, the daily
projection of worked time, correction requests and approvals, the Spanish export
(`packages/workforce-es`), and the rota, absences, swaps, planned-versus-actual view and staff portal.
But `clockIn`, `clockOut`, the break events and the correction functions in
`packages/workforce/src/clocking.ts` have no caller outside the package:
`apps/server/src/workforce-api.ts` serves the rota and says it is "plumbed ahead of a clock-in
route". So the planned-versus-actual view has no actual hours to compare.

Left, as the legal minimum:
- a till clock-in and clock-out screen and its routes;
- correction requests and their approval, as routes and screens;
- read access for the worker, their representatives and the labour inspectorate, with four years'
  retention, and a route that produces the export.

Then: shift templates and availability (the tables exist and the configuration export copies them,
but no feature uses them); wages (A9); the payroll export, which waits on the gestoría's import
format. **Before building, ask the labour
advisor** whether the digital-registro decree is in force and which fields it requires
([asesor-laboral-questions.md](compliance/asesor-laboral-questions.md)). The time record cannot be
edited once written, so its chain and correction paths take the owner's sign-off at land.

---

## Track B — infrastructure

The box, the image, the data layer and the machinery: `deploy/`, the Dockerfiles and compose,
`packages/provisioning`, `packages/migrations`, `packages/db`, `packages/credentials`, the
print-agent process (`packages/print-agent`, `apps/print-agent`), `apps/server`'s boot, config,
TLS and backup code, `packages/media`, the module framework, CI and test infra. `packages/sync` and
`packages/membership` belong here too but their open work is under *Afterwards*.

**Built:** the two containers + `deploy/compose.yml` + named volumes (#285); `waitron.sh install` and
`reset` (#314); the recovery supervisor and the box serving its own leaf over HTTPS in every mode;
the CI `image` job (#288); boot-failure diagnosability — a recovery page of curated operator text keyed
by error code, and an ahead-of-image database check (#310); the enum-upgrade repair and its two root
guards (#307); real hardware bringup (#302); `linux/amd64`-only images (#325, published — the manifest
carries amd64 alone); the backup + recovery-key wizard (#295); guided node onboarding, all four modes
(#296); the print-agent process, its box wiring and on-node auto-enrolment (#282, #289, #308, #311); the
CA-trust onboarding guidance, connection retry/help and the per-OS certificate walkthrough (#330,
reworked #346); the print agent's own AppArmor profile and its Bluetooth availability report (A129,
#862; `scan off` and `Disconnected` added by A134, #887); `waitron.sh install` refreshing the box's
own copy of the script (C83, #890).
Proven end to end 2026-09-09: blank box → phone setup → provision → trading over HTTPS → enrolled
till → a recorded preproduction sale.

### B1. Onboarding must surface the CA-trust step — LANDED #330 (2026-09-12)

One guard here is narrower than its name. `scripts/trust-page-logo.test.ts` checks that the logo
pasted into the server's source still matches the brand lockup — the two drawings agree, and nothing
else. It does not check that the page renders, that either theme is readable, or that the logo is
visible at all. **Next action:** name it and its hedge on the `CLAUDE.md` §4 line about pages
asserted as a string, whenever `CLAUDE.md` is next opened for a PR.

**DECIDED (owner, 2026-09-29): the mode screen's certificate note stays as built** (C40, #833) — it
shows only on the path where the wizard skipped the connection question, and the question is not
asked there.

### B2. Backups that leave the box

- **Guided Cloud snapshot recovery for test venues is built.** Cloud approval alone does not
  authorize trading or stop another server.
- **S3-compatible bucket, then Google Drive.** The bucket stream of `venue.db` is built (slice 2);
  the archive's S3 backend is not — only `LocalFsBackend` exists for archives. The abort-aware
  per-destination timeout lands with the first network backend.
- **Whole-state-volume capture** (its own §5-reviewed slice): capture the whole state directory EXCEPT
  an explicit exclusion set, with a completeness guard that fails when a new top-level entry is
  neither captured nor excluded — the curated list went stale on `modules.json` already.
- **The "backups off or stale" reminder** is built as dashboard alerts (#371). Still open: when a
  nightly report job exists, the backup slot should fire after it.
- **The remaining cold-restore operator surface** (promote Slice 4): connection rebinding, advertised
  origin and an authenticated entry.
- **Reconsider the backup container against off-the-shelf tools** (a brainstorm): `WBA1` plus
  `artifact-cipher.ts` holds the whole database copy in memory and is restorable only by Waitron
  code, where piping the engine's own copy through a standard encrypter into a tar is the obvious
  alternative.
- Carry-forwards under *Detail → Backup*.

### B3. The bootable USB installer

Runs `waitron.sh install` unattended. Open questions it owns: whether the stick carries the images so
install needs no internet; unattended updates for a box we did not sell; AP-mode WiFi onboarding. Box
image constraints under *Detail → Box image*. Not started.

**The box the customer buys probably doubles as a till, so the image ships a screen and a browser**
(owner, 2026-09-29: "we probably want the server the customer buys to also serve as a till, which
means that we need to ship Debian with a UI and chromium"). A lean, not yet a decision. The hardware
decisions already put the deli's box under the counter driving the counter touchscreen (O5,
[handheld and till hardware §5](superpowers/specs/2026-09-18-handheld-and-till-hardware-decisions.md)),
but as a machine built by hand; this makes it how every box ships. What it asks of the image B3 lays
down, none of it built:

- **Debian with a graphical session and Chromium**, not a server-only install. Spec §5's lean is the
  smallest one: automatic login on the console, then one full-screen Chromium under `cage` (a Wayland
  compositor that runs a single application), restarted as a service, with no desktop environment.
  Whether "a UI" means only that or a fuller desktop is not yet settled.
- **The four traps spec §5 lists, each established on the first real build:** the "restore pages?"
  bubble after a power cut, Chromium's own certificate store (the box's root certificate is installed
  there separately), screen blanking and sleep, and the BIOS set to power on when mains returns.
- **The box is specified for both jobs** — server, database and browser — which spec §5 and §6 already
  say; spec §6's memory figure for a page-only machine is reasoning, not a measurement.
- **Open:** whether the box's own screen enrols as a till like any other device or is treated
  differently because it is local, and what address it opens the till at.
- **Related:** the print-agent's AppArmor policy (A129, #862) was chosen on the owner's "we'll be
  shipping with our own OS"; the licence notices for what an OS image adds (Debian packages, Chromium,
  `cage`) need an answer too, beside the container image's `/app/third-party/`.

Belongs with it: **a local maintenance account on each box**, its password printed on a sealed card
and set when the box is imaged, with procedures for a lost card, a change of owner and a reinstall
([box maintenance and remote support](superpowers/specs/2026-09-11-box-maintenance-and-remote-support.md),
a discussion record, not an approved spec). Its remote-support half is tracked in Cloud and not
approved.

### B4. Upgrades and migrations

- **Upgrade testing — blocking before go-live (owner, 2026-09-26).**
  `scripts/migration-upgrade.test.ts` walks one database through every shipped migration in date
  order, with the change feed installed between steps, and since A164 (#970) carries two synthetic
  rows per table through every step. The steps that cannot carry those rows are listed in the test's
  `RESETS`, where the walk restarts from an empty database. One is a real loss rather than a refusal:
  core `0012_printer_calibration` rebuilds `drawer_opens` without copying its rows (read from the
  migration; the guard's two rows were gone after it), so a box holding drawer-open records when it
  took that migration would have lost them — inferred, not run on a box. Whether the owner's box held
  any then was not checked.

  What it still does not cover, each needed before a real venue is live:
  - **Rows.** Still open: rows the product itself writes. The synthetic rows hold a few generic
    values, so a migration that fails only on values the product writes and they lack passes — a
    unique index two real rows break where these two differ, a required column real rows leave empty
    while these hold a value. Seed a realistic venue (the demo seed at least) at each step for that;
    the product's writers name today's columns; whether they can write an older step's schema was
    not tried.
  - **A rebuild of a table another set's trigger BODY reads is still refused** on a box that has
    the trigger — core `0003` on `products`, recorded in
    [conventions-data.md](developers/conventions-data.md) → *A migration set depends on another
    through a foreign key, a trigger on its table, or a trigger body naming its table*, and in Track
    A, the paragraph opening **Task 1 LANDED as #511**. The guard steps over it by applying
    everything up to `0003` in one go, so the next such rebuild fails the guard. Decide the fix.
  - **A real old database.** Every step here is built by this image's own migrator from today's
    change-feed and append-only lists; a snapshot of a box at an earlier release, upgraded by the
    new image, is the test that matches what a box does.

- **Automatic upgrades that can be undone until the first order** (owner, 2026-10-02). Today an
  upgrade is `waitron.sh install`, run by hand at the box's terminal: it pulls the new images,
  restarts, and waits about three minutes for the app to report healthy (`wait_healthy`,
  `deploy/waitron.sh`). It takes no backup first, and once the new image has migrated the database
  there is no way back — an older image then refuses to start with `provisioning.database_ahead`
  (`deploy/README.md`, "It can migrate the box's database one way"). Wanted: the box upgrades
  itself, in this order:
  1. stop the app and take a snapshot of the box's state;
  2. start the new image and let it migrate, with sales refused;
  3. check that it started properly;
  4. only then take orders. If the check fails, put back the snapshot and the old image, and
     report the failure.

  **Rolling back is not a fix** (owner, 2026-10-02): it keeps the venue trading on the version that
  worked while the failed upgrade is reported and fixed. The point of no return is the first order
  taken on the new version, not the restart: rolling back after that would lose the order.

  **The snapshot is a filesystem snapshot where the disk allows it** (owner, 2026-10-02). Debian's
  default filesystem, ext4, has none; btrfs (in Debian's own kernel) and LVM thin volumes do. ZFS
  does too but is built outside Debian's kernel because of its licence. The B3 installer lays the
  disk out, so it can put the folder holding Docker's volumes on btrfs. What it should buy, none of
  it measured yet: taking and restoring a snapshot costs about the same whatever the size of
  `venue.db`, which holds the product photos, where a file copy grows with it; and it takes every
  volume at once, so nobody keeps a list of the files a restore needs (the hand-kept list already
  went stale once — B2's whole-state-volume bullet). What it does not cover:
  - the old image, which is kept by its tag, not in the snapshot;
  - a box whose disk the installer did not lay out (ext4), which needs a fallback copy;
  - the failed attempt's own logs, which a rollback of the logs volume would erase — keep them out
    of the rollback, or send the report before rolling back.

  Questions to settle in the brainstorm:
  - **Where the failure is reported.** To the owner, as a dashboard alert once the old version is
    back; to Waitron as well, which needs the one-touch bug report (A9, Logging Slice 2) or
    something like it.
  - **What counts as "started properly".** `/health` returning 200 says the duty loop runs; that
    may be too little — every module opened, the fiscal chain read back and checked, the till able
    to load its menu.
  - **Nothing fiscal before the check passes.** The new version must not file a record with AEAT
    or use an invoice number before step 4, or a rollback would leave AEAT holding a record the
    restored database does not, or a gap in the series.
  - **The bucket stream.** The new version streams `venue.db` while it starts; a rollback must not
    put back a copy that the bucket's newer data then overrides, or the reverse.
  - **When it runs and who starts it.** A quiet hour outside trading, and something outside the app
    container, since it replaces that container (a timer on the host running `waitron.sh`, or a
    small updater with access to Docker). Where the box learns a release exists is B3's open
    question, "unattended updates for a box we did not sell".
  - **Upgrade testing above still comes first**: a rollback keeps the venue trading through a
    failed migration; it does not prevent one.

- **Every migrating path but boot and the bucket rebuild runs with no ahead-of-image check.**
  `conventions-data.md` holds the list, and it is longer than what CLAUDE.md §3 names — it adds a
  readiness runner and the dev, demo and Cloud fixture scripts under `apps/server/scripts`, two of
  the Cloud fixture scripts migrating through `restore.ts` rather than calling `applyMigrations`
  themselves, which a grep for that name alone does not find.
- **Provisioning's migrate path still runs the linear full `manifestSets()`** — route it through the
  resolver once it gains per-module enablement.
- **`modules.json` has no flow-down channel** from a primary to its standby (matters under
  *Afterwards*, designed now that bookings is genuinely toggleable), and a toggleable module that is
  load-bearing (identity, payments) fails boot loudly if disabled until the wiring inversion.
- **What `waitron.sh install`'s self-refresh (C83, #890) left open:** installing a ref whose script
  predates the refresh puts back a copy that does not update itself (`deploy/README.md` says to
  download it again); a copy another user owns in `/tmp` is not updated under `sudo`, because
  systemd's `fs.protected_regular` setting stops root writing the fetched script into the temp file
  beside it (install reports a failed fetch; the README says to download to the home folder
  instead); nothing checks a fetched script before running it beyond what the fetch of `compose.yml`
  already trusts — the same GitHub URL over HTTPS. No case in `scripts/waitron-sh.test.mjs` covers a
  script not run from a file, a link `readlink -f` cannot follow, a folder the script cannot enter,
  or a box with neither curl nor wget.
- **What `waitron.sh --reset install` (#1122) left open:** a build or pull that fails still leaves
  the box's files changed, as a plain `install` always has. `fetch_box_files` replaces `compose.yml`
  before any image work, and an install of `main` removes the image lines from `.env` before its
  pull, so after a failure the box's files name the new ref while its running containers are the
  old ones. Nothing has been taken down or wiped at that point, and the error asks for a re-run;
  making it leave the files untouched means fetching into a temporary folder and moving the files
  into place only once the images are in. Raised by the run-it review and not taken because it
  restructures `install`. Also open: the simplify review suggested `waitron.sh reset … --install
  [ref]` instead of `--reset … install [ref]`, reusing reset's own option reading; the form shipped
  is the one the owner asked for, so that is the owner's call.

### B5. The recovery page and degraded mode

- **What showing the failed start's reason (#695) left:** a failed migration's report names the SET
  (`migrations.apply_failed`, `{ set }`), not the migration file, though the refused statement shows
  in the detail; the start-up's own log writer ignores `WAITRON_LOG_MAX_BYTES`/`WAITRON_LOG_MAX_FILES`
  (it only appends, so they do not apply); the two restore errors' text quotes the "Why the last start
  failed" heading with nothing tying the quote to the heading; and no staged restore has been run
  through the real migrator to see it end in `migrations.apply_failed`.
- **The recovery spec** — a degraded-but-trading mode and the module-contract field it needs.
- **The recovery page's secret bound is a convention, not a guard.** #310 masks URL credentials on
  every log line — the connection-string shape and nothing else. A secret in any other shape still
  reaches the unauthenticated page two ways — through the log tail, and through the failed start's
  full detail under "Why the last start failed" (stacks with file paths, the message of each cause
  down to five levels, an `AppError`'s params) — bounded only by the convention that an `AppError`'s params
  carry none.
- A `sealAeat`/`persistTrading` I/O failure AFTER `provisionVenue` succeeds wedges the box (tenant
  minted, no `trading.env`) and needs a recovery path or a loud wedge; a provision failure after
  `provision()` mints the tenant and chain needs a re-image today.

### B6. The print-agent process

- **What the AppArmor profile (A129, #862; A134, #887) left open:**
  - **`trust` is still refused.** A property write (`trust`) and `Disconnect` were measured still
    refused against the stand-in BlueZ; BlueZ's `Agent1.Release` is not allowed either; the stand-in
    never sends it, and whether a real BlueZ does is still open.
  - **Box check owed:** after `sudo bash waitron.sh install`, switch off the kernel's rate limit on
    its log first (`sudo sysctl -w kernel.printk_ratelimit=0`), which can drop refusal lines —
    image-smoke switches it off for that reason. Then `scan on` / `scan off` and a pairing from
    `docker compose exec -it print-agent bluetoothctl`, then
    `sudo journalctl -k --since '-5 min' | grep 'apparmor="DENIED"'` should print nothing for
    `waitron-print-agent`.
  - **The setup page's HTML says nothing about Bluetooth availability** — only `/status.json` and the
    log do. The page is English-only, with no language switch to carry a Spanish line.
  - **A bus policy that refused BlueZ's own calls would read as `no_controller`**: measured
    2026-09-29 on a CI runner against the stand-in BlueZ, with a profile that allowed the bus
    daemon's own messages but no message to BlueZ: `bluetoothctl --timeout 3 devices Paired` printed
    "No default controller available" and exited 0.
  - **`bluetooth scan failed` is logged on every pass** (left by A131, #915), where the agent's other
    Bluetooth failure lines are logged once while the same failure repeats, so a box with no adapter
    logs one line per pass while a discovery window is open.
  - **On the LAN the Bluetooth report is visible only before joining or while out of touch.** Once
    the agent has joined and is not out of touch, `/status.json` answers only loopback callers
    (`networkRefused`, `apps/print-agent/src/setup-page.ts`).
- **While Add a printer is open, print jobs no longer wait behind each scan pass — DONE (C117,
  #955).** Left open: the office-printer check and the check of addresses typed into the dashboard
  still run inside the poll, so the job pull still waits for them (see "A sweep in flight keeps
  connecting" below). The agent puts no limit of its own on a scan pass; read, not run: the whole
  sweep across several networks and the USB reads have no overall limit.
- **Unpair can come back for a short while after a successful unpairing** (found in C103's review,
  read, not run). The server calls a Bluetooth device paired while the agent's last "paired" report
  is fresh (`isListed(pairedAt)`, `apps/server/src/print-api.ts`: 45 seconds while a discovery
  window is open, 15 otherwise), and a later report that the device is no longer paired keeps the
  old `pairedAt`. So for up to that long after an Unpair a device can read as paired again. Clearing
  `pairedAt` when the agent reports a successful unpair, or reports the device unpaired, would end
  it; the owner was asked (questions.md, C103).
- **An agent compares the server's discovery deadline with its own clock** (found in C102, read, not
  run). `discoveryUntil` is a time on the server's clock, and the agent checks it against
  `host.now()` (`packages/print-agent/src/agent.ts`), where a network probe's deadline is sent as a
  duration because the two clocks can differ. An agent on another machine whose clock is out by
  minutes scans for the wrong span; one on the box shares its clock.
- **A sweep in flight keeps connecting after the discovery window closes** (189 of 253 connects on
  #313 started after expiry). Pass the deadline through `Host.scan`. The office-printer paper-size
  queries that follow the scan have no deadline either: at most eight at a time, each up to
  1.5 seconds, and the job pull waits for them, so printing is delayed while they run.
- Retry spacing is the agent's batch interval rather than a per-job backoff, so a flapping printer
  burns `MAX_DELIVERY_ATTEMPTS` at loop speed — needs a next-attempt column.
- **Cross-box print-agent TLS** — an agent trusts only its local box CA, so a mirror's agent cannot
  reach the primary; gates the mirror's print agent (*Afterwards*). The vouch slots into the same
  route later.
- **Cloud-poll transports** (Star CloudPRNT, Epson Server Direct Print) — a NAT'd printer with no
  agent. Low priority.
- **On-device agent** — a till hosting a print agent, the single-box venue's box-death printing path.
  Needs a native app; parked behind the go-native decision.
- **`runAgentOnce` (`packages/printing/src/runtime.ts`) has no caller in the tree outside its own
  package's tests** (a refused `done` report no longer marks a sent job failed since C70, #866). A
  refused report still rolls back every job of its batch when the caller's transaction rolls back,
  so all of them print again (measured 2026-09-29 with a scratch probe). A process that holds the
  venue database and runs the agent itself, and wants to confine a refused report, should call
  `claimPrintJobs` and then `reportPrintJob` per job, each report in its own transaction, as
  `apps/server/src/print-api.ts` already does, rather than one `runAgentOnce` in one transaction.

### B7. Provisioning and build debt

**`@waitron/verifactu` 0.2.1 (A230, owner 2026-10-03) — landed as #1099.** Waitron moved from
0.1.0 to `^0.2.1` (0.2.1 is A230a: the library now accepts a zero VAT amount when the base times the
rate rounds to 0.00). The fingerprint, built record and XML are unchanged for the same input (both
published packages fed the same records; controls showed a difference is reported). Done with it:
`ClaveRegimen: "01"` on every VAT line; the lookup states `Correcto`/`AceptadoConErrores`/`Anulado`
(0.1.0's names would not have matched a real AEAT answer); a missing `TiempoEsperaEnvio`; a reply
line with no readable status gets its own branch (`fiscal.estado_desconocido`); `validate` is given
the record's own generation time as `now`; validation warnings are split by code (totals →
`fiscal.record_totals_disagree`, the rest filed and flagged `fiscal.record_flagged`); a voided sale's
lookup is read through its cancellation; test tax IDs carry a correct check letter and the golden
test's pinned one was corrected with its fingerprint re-pinned (owner-approved). Caught at entry: a
sale over €3,010.00 (`sale.total_exceeds_simplified_limit`, limit from the fiscal seat), a customer's
tax ID or legal name in `recordSubstitution` (`counterparty.invalid`), a venue legal name over 120
characters. Left open:
  - **A resent cancellation AEAT already holds now counts as accepted when AEAT's stored fingerprint
    matches the cancellation's** (`drain.ts`'s `handleDuplicate`; a mismatch still halts with
    `fiscal.duplicado_anulado`). Shown against the library's fake only; what real AEAT answers to a
    resent cancellation is not established. The owner may want to confirm this choice.
  - **`HUELLA_MISMATCH` is filed and flagged, not refused.** It is not expected to occur, since
    Waitron's own builder computes the fingerprint; nothing tests that it cannot. Refusing it may be
    preferred since a wrong fingerprint is permanent.
  - **No sale over €3,010 can be made at all**: Waitron issues only simplified invoices and no screen
    accepts a customer's tax ID, so a full invoice is not offered. Spain's legal ceiling for a
    simplified invoice in hospitality is €3,000 (RD 1619/2012 art. 4.2, quoted in
    [verifactu-findings.md](compliance/verifactu-findings.md) and the
    [full-invoices design](superpowers/specs/2026-10-03-full-invoices-at-till-design.md)); the
    branch refuses over €3,010, the limit `@waitron/verifactu`'s validator applies (3,000 plus its
    10.00 tolerance), as the owner asked.
  - **A voided sale whose lookup AEAT answers under the sale's own reference** is not handled; not
    shown to happen either way.
  - **An unusable `TiempoEsperaEnvio` is not recorded** anywhere (the raw value is dropped).
  - **The till's find-bill pay shows the generic sale error for an over-limit refusal**: the
    find-bill dialog (`apps/till/src/widgets/find-bill-dialog.ts`) takes its error as a plain
    string key, so it cannot carry the amount the collect and table-bill paths now show.
  - **A dev venue built before A230 keeps the tax ID `50000000K`**, whose sales 0.2.1 refuses;
    `wa-wt reset demo <name>` rebuilds it as the demo business, tax ID `B00000000` (W108).

- **Resetting a box without a terminal** (owner, 2026-10-02). An operator who set the box up in
  Demo and now wants to Prepare has to wipe Demo away first, and the only wipe is
  `waitron.sh reset` or `waitron.sh --reset install` (`wipe_box`, `deploy/waitron.sh`), run with `sudo` at the box's terminal —
  which a box operator does not have. Going from Prepare to Live needs a fresh database too (one
  database per environment, CLAUDE.md §5): the Backups screen can export the venue's configuration
  and setup can import it (`apps/server/src/configuration-export-api.ts`,
  `apps/server/src/configuration-import.ts`), but the wipe between them is again only the script.
  Wanted: a reset offered on the dashboard, and probably on the recovery page as well, because a
  box that will not start is the one an operator most wants to reset. It keeps the script's rules:
  refused on a production box, confirmed by typing a word, and keeping the box's certificate so
  devices need not trust it again. Open: who may press it (the owner only?), and whether a reset
  started from inside the app container can remove the Docker volumes the script removes, or has
  to empty them instead.

- **DONE 2026-10-03 (W29): the bucket-stream reader checks missing fields.** A test fixture sealed
  a `backup.stream` row with each of its seven fields omitted in turn; all seven reader cases first
  returned a value and now refuse `server.credential_unusable` naming the field. A route test first
  got an error for the omitted endpoint; `GET /api/backup/stream` now reports a stored but unusable
  bucket with `bucket: null`. A Chromium panel case in English and Spanish checked that Change and
  Turn off remain available, the recovery-kit action is hidden, and the missing settings are
  explained. The first-start case keeps its restore marker and holds streaming until the settings
  are repaired; the test then writes complete settings and the next start clears the marker. An
  archive-restore case first received the raw credential error; it now receives
  `restore.stream_source_unchecked` with reason `bucket`. The four
  focused server suites passed 172 tests with
  `pnpm --filter @waitron/server exec vitest run src/stream-host.test.ts src/stream-api.route.test.ts src/rebuild-first-start.test.ts src/restore-stream.test.ts --reporter=dot`.
- **Reading a credential does not re-check it against `PURPOSES` — owner decision 2026-09-15.**
  `getCredential`/`tryGetCredential` (`packages/credentials/src/store.ts`) return what was sealed,
  rather than refuse the read, which would stop every venue holding that kind of secret the moment
  a field is added; each reader must check the fields it uses instead. `rotate` re-checks a secret
  against the current list only when it re-seals one: it skips a secret already on the current key
  (`rotateCredentials`, `packages/credentials/src/store.ts`), so an out-of-date one stops a key
  rotation only when it is on an older key, until it is re-entered.
- **Unused payment adapter `nodeId` arguments — DONE (W8).** The card-provider build path,
  the SumUp adapter, and Stripe's terminal, device, reversal and reconciliation paths no longer
  carry the value they did not read.
- **A box that mints its certificate before NTP sync persists a wrong validity window**, with no
  renewal path yet. Ties to a time-health check and certificate renewal.
- **Shutdown closes the database even when stopping background work fails (C71, #870)**
  (`apps/server/src/boot.ts`). One consequence: if stopping Litestream itself fails, the store is
  now closed while Litestream may still be running; nothing tests that case.
  - **DONE (W3):** a failed start aborts the cloud duties, waits for each separately, and closes
    live events even if change-feed unsubscribe throws. Both cases failed before the change and pass
    in `apps/server/src/boot.failed-start.test.ts`; the failed start still releases the venue folder.
- **Two concurrent first provisions can still race past the venue guard** (2026-09-14). Both can
  pass the empty-`locations` check and carry on down the venue path; `apps/server/src/provision.ts`
  says in as many words that callers must serialise provisioning, and nothing enforces it — the
  setup route's latch is process-local. #378 closed only the taxpayer row's part of
  it (the second insert now loses to the singleton primary key), and its test claims only that
  neither plan dies on a `tenants_*` key. **Next action:** decide where the lock belongs — a
  database advisory lock around guard→stamp→apply is the obvious home — and prove it with two
  concurrent provisions against a real database, not with the row-level check alone.
- **DONE — a short `dayCutover` and its long form now identify the same venue (W6).**
  `planVenue` turns `"06:00"` into `"06:00:00"` before creating the location action, and
  `applyVenue` normalizes both values when comparing a stored location with the plan. Real-database
  retry tests saw `provisioning.second_venue` before each fix and success afterwards in both
  directions: long stored then short planned, and short stored then long planned. The old note's
  claim that the database always reads a time value back in the long form was wrong: `timeOfDay` is
  a text column (`packages/db/src/schema/columns.ts`), and a repeated short-form plan succeeded
  before this change. The venue-plan test also checks the normalized action directly.
- **Creation/provisioning `dayCutover` still needs input validation.** The W6 review passed `"24:00"` and `"99:99"`
  through `planVenue`; both emerged with seconds appended. **Next action:** choose the validation
  boundary and a domain refusal, then test invalid values before they reach storage.

### B8. Module framework follow-ons

- **Country-pack follow-ons:** the authenticated address relay and its first provider adapter; phone
  normalisation in bookings; a supplier country/identifier scheme before validating purchasing tax
  IDs; the pack's module preset; the refused foral, Canary, Ceuta and Melilla jurisdictions; a
  territory picker in the setup wizard (it offers `ES-common` only).
- **`fiscal-none` left-behinds:** remove the inert `resolveClient`/`skipRetryMs`; regime-agnostic
  provisioning tests.
- **Test-helper debt:** `provisionTestVenue(db, overrides)` for `apps/server`'s sixty-odd suites; the
  duplicated `boot.*.test.ts` helpers into `apps/server/src/testing/` (`freePort` has moved there,
  A80; the rest remain); a shared `useFiscalMirrorPair()` for the two-clone fiscal suites.
- **The tax-model system** — the `tax` slot is an inert label today; the intended shape puts the tax
  MODEL in core with the fiscal module supplying rates and labels. A prerequisite for any non-ES
  venue, so parked.

### B9. CI and test infra

- **A Payments screen test failed once in a local dashboard coverage run (seen 2026-10-05 on W111's
  branch, `feat/receipt-top-block`) — OPEN, not investigated.**
  `apps/dashboard/src/screens/payments-screen.test.ts`, "isolates a status request failure to its
  row", failed once while the till's coverage run ran beside the dashboard's; it passed three runs
  of its own, and the whole dashboard suite passed when re-run alone. W111's branch changes no
  Payments screen file. Standing rule: a flaky test is fixed at the
  root; on a recurrence, keep the log.
- **The stream pause test's frozen-bucket control failed once in CI (PR #1101, run 37108993254
  attempt 1, job 111163230954, 2026-10-03; passed on re-run).** In
  `apps/server/src/stream-pause.e2e.test.ts` step 6, the call to the bucket made just after
  `s3.pause()` answered before the bound, so the assertion at line 540 read
  `expected 'answered' to be 'unanswered'`. W30 makes `pause()` await the stopped state before its
  caller starts that control. The original one-off race has not been reproduced locally; the
  changed real-binary stream pause and loop suites passed together on 2026-10-03. If the control
  fails again, retain that run's log and inspect the child state before naming another cause.
- **The stream pause test's last restore failed once in CI, about 31 s after the stream resumed
  (PR #1055, run 37042034082, job 110955048468, 2026-10-02; not fixed).** In
  `apps/server/src/stream-pause.e2e.test.ts` step 10, the probe that restores the generation to
  find the sale made while the bucket was frozen threw `backup.stream_restore_failed` from
  `restoreGeneration` (`packages/stream/src/restore.ts`) instead of returning, so the wait ended
  at once. The six green runs of the same job read that day went from the resume to the end of the
  test in about 2.5 s. Since 31 s is just past the probe's 30 s `RESTORE_MS` ceiling, the likeliest
  reading is a `litestream restore` against versitygw that never finished and was stopped there.
  That is inferred: the error's `exitCode` was not in the log, and the run was not repeated before
  this was written down. The PR's own change is not on that path; the test's sales go through
  `POST /api/sales`, which does not reach `readPartyBills`. W30 adds failure diagnostics with the
  child exit code when available, whether the restore was abandoned, and whatever Litestream
  output was captured; output may be empty on abandonment. The cause of the one-off failure remains
  open. Next action: inspect those details from any new failing run before choosing a repair.
- **What moving the upgrade test's scratch directory to `/dev/shm` (A122, #856) left open:**
  `scratchParent()` does not fall back to the disk when `/dev/shm` is nearly full (in a Linux
  container the test peaked at about 14 MiB and failed with 8 MiB free), and on CI's Linux runner
  `scripts/scratch-dir.mjs` measures 83% of branches, because the line for a missing `/dev/shm` runs
  only on macOS; the root project's thresholds still pass. Neither is queued. Receipt:
  [ci-and-gates.md](developers/ci-and-gates.md#the-upgrade-test-keeps-its-database-in-memory-on-linux).
- **Would the package suites' databases gain from memory too?** `useVenueDb`
  (`packages/db/src/testing/venue-db.ts`) makes each suite's venue folder under the system temporary
  directory, and the root suites `scripts/append-only-triggers.test.ts` and
  `scripts/behavioural-triggers.test.ts` make theirs there too, so they all commit to the runner's
  disk. Not measured for them. Next action: time one database-heavy package's `test:coverage` in CI
  with its folders on the disk and under `/dev/shm` (`scratchParent()` in `scripts/scratch-dir.mjs`
  is the choice the upgrade test makes), and adopt it in `useVenueDb` only if the shard times move
  and a suite's databases fit in `/dev/shm` (Docker's default is 64 MiB). One data point from
  A130: on a CI runner a stream test's commit took 1,017 ms while Linux's pressure counters showed
  every process stalled on the disk ([testing-guide.md](developers/testing-guide.md), "In CI their
  temporary files are in memory").
- **Dependabot, switched on by #760 (2026-09-27); its 15 security alerts fixed by A107 (PR #796,
  2026-09-28).** Config: `.github/dependabot.yml`; how to land one of its PRs:
  `docs/developers/workflow-guide.md` → Dependabot pull requests. A `vitest` group moves `vitest` and
  `@vitest/*` together, majors included; closing #766 stored an ignore of
  `@vitest/browser-playwright` 5.x, and whether the group's Vitest 5 PR obeys it is untested (how to
  check and clear it: workflow-guide → Dependabot pull requests); such a PR also has to re-measure
  mutation first (Track C, *Left behind by the Stryker upgrade (#447, 2026-09-19)*). The
  `versioning-strategy` question is recorded under #432's loose ends in Track C.
  **The receipt for the two overrides** (workflow-guide points here): four alerted packages were
  moved inside the ranges their parents already declare, and two are forced by root
  `pnpm.overrides` entries — `typed-rest-client>qs` to `^6.16.0` (6.16.0), and
  `@esbuild-kit/core-utils>esbuild` to `^0.25.0` (the 0.25.12 already in the tree). What was run for
  the two overrides: `typed-rest-client`'s query-string builder over eight parameter shapes gave the
  same URLs under `qs` 6.15.1 and 6.16.0 except one, where 6.15.1 threw a `TypeError` and 6.16.0
  does not (the `arrayFormat: 'comma'` null-entry fix in `qs` 6.15.2's changelog); a search of
  Stryker's installed `dist` found `typed-rest-client` imported in two of its JavaScript files,
  `initializer/npm-registry.js` and `reporters/dashboard-reporter/index.js`, and no
  `stryker.config.json` here names the dashboard reporter. `drizzle-kit` 0.31.11's shipped code never
  names `@esbuild-kit` (only its `package.json` does): with both `@esbuild-kit` folders renamed away,
  `drizzle-kit generate` in all fourteen migration sets printed the same as before; each set
  generated from nothing gave the same SQL and snapshots before and after the override (ids and
  timestamps aside); and the loader itself still runs a TypeScript file on esbuild 0.25.12. A full
  Stryker run over `packages/shared` gave the same 990 mutants with the same results on the old and
  new lockfile.
- **Copies of the patterns A105 and C27 replaced — OPEN.** The same two SQL patterns (the
  block-comment one A105 replaced, and `/--.*$/`, the one C27 replaced) are copied in
  `scripts/module-graph-honesty.test.ts`, a guard reading the repository's own SQL;
  `apps/till/src/i18n/t.ts` still strips the region with `/-.*$/` on the till's locale (CodeQL did
  not flag it); and `/\/+$/` (written `/\/+$/u` in `mailpit-client.ts`) is still used in
  `apps/server/src/boot.ts` (a peer relay URL from `mirror_config`, owner-written config),
  `apps/server/src/mailpit-client.ts` (the loopback Mailpit base URL) and
  `apps/server/src/mirror-bundle-fetch.ts` (a URL already parsed by `assertSafePrimaryUrl`) — none of
  the three timed; and the email pattern itself is still copied six times in `apps/dashboard`
  (`login-preference.ts` twice, `screens/login-screen.ts`, `screens/profile-screen.ts`,
  `widgets/person-edit.ts`, `widgets/person-form.ts`), run in the browser on an address the person
  typed or the browser saved (CodeQL did not flag them either). See also the OPEN bullet "The two
  SQL scanners named `stripSql`…": a fix to one touches the other's code.
- **What the landing-port fix (A80, PR #740) left open:** `freePorts(n)`
  (`apps/server/src/testing/free-ports.ts`) holds every probe until the last port is drawn, but a
  port is still released before the server binds it, so another test worker drawing or connecting
  in that gap can take it; nothing has measured how often. Removing that would need the server to
  accept port 0 and report the port it bound (`WAITRON_HTTP_PORT` refuses `"0"` today).
  `bench/sqlite-failover/src/unreachable-store.ts`'s `reservePort` and the inline copy in
  `apps/server/scripts/cloud-integration-fixture.ts` have the same release-then-use shape and were
  not changed. C88 (#920) reproduced this gap as one way the pause test's single CI failure could
  happen, and `startS3TestServer` now recovers from it; the Waitron servers' own ports still have the
  gap.
- **`bundle-smoke` builds only the credentials and server bundles**, so a change to
  `scripts/bundle-node.mjs` selects print-agent and provisioning for typecheck and tests (#593,
  through `ROOT_SCOPE_CONSUMERS` in `scripts/changed-scope.mjs`) but builds neither of their bundles
  in CI.
- **Every package to the high coverage bar, `98/98/98/95` — DONE (owner decision 2026-09-23; the
  floor retired 2026-09-24 by PR #549).** First promotion PR #498 (21 packages); then one pull
  request each: `printing` (#500), `bookings` (#503), `tunnel` (#506), `print-agent-app` (#508),
  `provisioning` (#510), `payments-sumup` (#512), `payments-stripe` (#514), `server-kit` (#515),
  `sync-enrolment` (#518), `dashboard-kit` (#521), `fiscal-none` (#522), `setup` (#523),
  `print-agent` (#525), `identity` (#526), `catalogue` (#530), `apps/server` (#534), `apps/till`
  (#536), `apps/dashboard` (#538), `venue-service` (#546) and `media` (#547).
  - From #536: the table-service, boot-and-counter and three `tender-pay-*` suites are separate
    files that can be folded back into `till-app.test.ts` and `tender-pay.test.ts` once
    `feat/variants-sale-line` lands.
- **Prune the comments, one package per pull request — IN PROGRESS (owner decision 2026-09-23).**
  Keep a comment only for an invariant, or a non-obvious why, that the code cannot show (CLAUDE.md
  §1). Every pruning pull request passes `scripts/comments-only.mjs <base>`; its header states what
  it refuses and misses. The fiscal packages go under the same gates as any other fiscal change: the
  golden huella test and the `inmutabilidad` suite pass unedited. Not reached by any package's pull
  request: `bench/` (about 2,300 comment lines) and the root `vitest.config.ts` and
  `eslint.config.js`; in `scripts/`, the `.sh` files and `write-path-tables.json` are outside the
  checker and were left. Landed so far: `workforce` (#555), `payments` (#558), `identity` (#559),
  `provisioning` (#561), `fiscal-verifactu` (#562), `apps/setup` (#567), `packages/store` (#568),
  `packages/payments-stripe` (#570), `packages/printing` (#572), `packages/bookings` (#574),
  `packages/credentials` (#577), `packages/shared` (#579), `packages/scheduler` (#581),
  `packages/db/src/schema` (#585), the rest of `packages/db` (#589), `packages/fiscal` (#592),
  `packages/payments-sumup` with `packages/migrations` (#597), `packages/core` (#598), the small
  packages as one pull request (#600: `apps/print-agent`, `print-agent`, `server-kit`, `tunnel`,
  `membership`, `sync-enrolment`, `workforce-es`, `purchasing`, `recipes`, `fiscal-none`,
  `composition`, `diagnostics`, `dashboard-modules`, the `country*` packages, `ui-core` and
  `dashboard-kit`), `packages/reporting` (#601; the generated `src/dr303-layout.ts` untouched),
  `scripts/` (#602), `packages/catalogue` (#603), `packages/ui` (#604), `packages/module` (#606),
  `packages/media` (#609), `packages/venue-service` (#611), `apps/dashboard` (#607, #610, #612),
  `apps/till` (#614, #616, #618, #621) and `apps/server` in parts (#613, #615, #617, #620, #622,
  #623, #624, #625, #629, #653, #656, #657, #658). A pruning pull request cannot carry this file (the
  checker refuses it), so each one's line lands here as a docs-only push after the merge. Found by
  those pull requests and left for the package that owns each, all still OPEN unless marked DONE:
  - Found by the retroactive Codex reviews of #621–#626 and #629 (C3.18.12r, 2026-09-25), outside
    the files their fixes could change or not changeable in a comments-only PR:
    `apps/server/README.md` (near line 496) still says an `error` line and a 503 are "the same
    condition by construction", the claim #637 removed from `health.ts` (a duty can go stale between
    passes: Codex got a 503 with no log line), and #637's review read its list of 503 causes (near
    line 404) as naming one that answers 200 — read, not run. Test titles:
    `apps/server/src/spa-api.test.ts`'s two cache cases say hashed versus non-hashed where the rule
    is the `/assets/` prefix, and `boot.mirror.test.ts`'s opt-in case
    says "binds 0.0.0.0" while connecting only over loopback. `apps/server/src/rebuild-first-start.ts`
    (near line 121, lane A's file) says "The log carries the error's code only", the overclaim #637
    corrected in `health.ts` (`codeOf` logs `unknown` for a plain error carrying `code: "EIO"`).
    "Empties every table" in
    `packages/bookings/src/schema/bookings.test.ts` (near line 60) and
    `packages/catalogue/src/migrations.test.ts` (near line 304) is wider than the reset, which
    leaves the migration journals (`packages/db/src/testing/venue-db.ts`).
  - Found by #658 (`apps/server` part h2: the remaining held-back files), not fixable in a
    comments-only change. `resolveSafeEntryPath` (`apps/server/src/state-secrets.ts`) is unchanged,
    and nothing chmods the staging folder that the archive restore's two entries outside `secrets/`
    (`manifest.json` and `db.dump`) are checked against; it receives nothing and keeps an existing
    folder's mode. Still open, not fixed, by the owner's choice: `unpackBundleToDir`'s walk and file
    write go by path, so a folder inside the destination swapped for a symlink during the unpack is
    followed. The A41 run-it review reproduced an outside folder being set to 0700 and receiving the
    secret that way. It needs someone able to write inside the destination. `tightenTlsDir`
    (`box-secrets.ts`, A52) leaves a linked `tls/` and the folder it points to as found, by the
    owner's choice, and a link swapped in for the state folder or a folder above it is followed; a
    folder its owner cannot read is changed by path after an `lstat`, and a link swapped in between
    the two would be followed. The restore itself (`restoreSecrets`) keeps none of `waitron-recovery
    unpack`'s destination refusals (a symbolic link, another user's folder, not a folder) on the
    state folder it is given. The lock-file measurement kept in `db-wipe.ts` names no engine version
    or platform.
  - Found by #657 (`apps/server` part f2: the node, identity and setup files), outside its files
    or not fixable in a comments-only change. A completed provision or adopt operation replayed on
    a later request still answers 200 without restarting and keeps the setup lock set (the Cloud
    restore's replay does restart). After a refused resend of a half-finished adopt (A50, #685),
    what the first identity leaves behind on the primary and on this node is still not measured.
    The standby's reset page does not show this server's machine id, so an operator cannot tell
    which row on the primary's Servers screen is this server's (left for the owner from A70's
    review). Removing a standby that "never finished joining" (A61, #708) reads that as
    `serving-secondary` with no `nodes` row in the primary's database, and a remote standby writes
    that row in its own database, so the check cannot see a remote standby that finished — none can
    today (`finish-adoption.ts`).
    **Still open after A63 (#712):** (i) a removed trust anchor (a machine whose key sits in the
    receiver's own `nodes` table) can still make up a key for a machine in good standing that is not
    an anchor, vouch for it, and sign as that machine — unless that machine signed the receiver's
    held chart and the chart carries the endorsement its signature verifies under, so a standby is
    not covered, nor a primary the receiver holds no chart signed by (after the former primary's own
    retirement chart, for one) (stated at `resolveSignerKey`); (ii) boot reconciliation's peer fetch
    sends no credential (`boot.ts` gives `fetchPeerMembershipDocument` only the URL) and
    `GET /management-api/membership` refuses a request without one, so in production that path
    accepts no chart today and the receiver checks above never run there (read, not run); (iii) a
    cleared machine is refused its own promotion only if its own held chart contains the clearing,
    and a standby that never finished joining never receives it; (iv) so, of these guards, only
    those that run where a chart is made or a join is served work in production today: the
    primary's join refusals (`mirror.standby_removed` for a removed or cleared id,
    `mirror.membership_full` for a full chart) and the mint's size refusals; (v) a receiver whose
    held chart predates a removal accepts the removed machine's charts until it learns of the
    removal; (vi) a joining standby sees `mirror.bundle_fetch_failed` rather than the primary's
    reason, because `apps/server/src/mirror-bundle-fetch.ts` turns every non-2xx answer into that
    code except a refused login, which it relays as `password.invalid` (C95) — this predates A63,
    and `mirror.standby_removed` has the same gap; (vii) if A61's removal ever mis-classifies a live
    standby that an operator later promotes, the old primary refuses the new primary's charts
    (`signer_removed`) and keeps selling; the refusal is logged at warn and raises no alert. No adopt
    can finish today (`finish-adoption.ts`), so no such standby exists yet.
    A56's open items (the "Reset this server" path for a half-finished adopt, #694): (2) An adopt
    saved before that change carries no proof, so the reset refuses it (`password.invalid`). (3) The
    proof shows the login the primary accepted at join time, not that the admin is still active
    there, and the one-time code is not asked again. (4) A join that failed after writing
    `trading.env` boots the trading branch, where no setup route is mounted, so this reset cannot
    reach it.
    Also open from A42's review (#674), read and not run: if `operation.complete()` throws after
    `execute` has scheduled the restart, the lock is now released while that restart is pending.
    Stale wording outside f2: "a device with no profile" in `apps/server/src/till-api.test.ts` (near
    lines 1377–1395) and `apps/till/src/till-app.test.ts` (near line 5765), though a device's
    profile column is NOT NULL; `config.ts`'s "minted once and reused" for the box certificate, which a
    restore re-issues; and `errors.ts` describing `setup.already_provisioning` as a persistent-lease
    refusal, when it mostly comes from the in-memory lock. Test titles carrying history, left
    because titles are code: "(SP-A.2 §16, device-profile §5)" in `device-session.test.ts`, and
    "(SP-1b fiscal gate)" and "(unchanged)" in `setup-api.test.ts`. Read, not run: `cookieDomainFor`
    (`device-session.ts`) lowercases the request's host but not the configured tenant domain
    (whether configuration normalises it is unchecked), and `DeviceBinding`'s `deviceProfileId` is
    typed `string | null` for a column that cannot be null.
  - Found by #656 (`apps/server` part e2: the backup and restore files), outside its files or not
    fixable in a comments-only change. `apps/server/src/errors.ts` still cites CLAUDE.md §5 for
    things §5 does not say, on `backup.recovery_key_unstorable` ("unrecoverable (CLAUDE.md §5)") and
    `restore.unexpected_entry` ("the cold-recovery path (CLAUDE.md §5)"). Test titles that still say
    "R3" or "rejoin", though rejoin no longer calls `restore.ts` (`rejoin-command.ts` does not import
    it): `restore.test.ts`'s `validateArtifact / writeValidated (R3 validate-before-wipe split)` and
    `restore steps (R3 composition)` describes and its three `skipSecrets` "rejoin" cases, and
    `restore-fiscal-e2e.test.ts`'s "skipSecrets:true (the rejoin shape)" control. No production
    caller sets `skipSecrets` any more, so whether the option should go is open. **Decided (owner,
    2026-09-25): leave `keyFingerprint` as it is** — the first 8 hex characters of the recovery
    key's SHA-256 (`backup-supervisor.ts`), shown in the backup status, so anyone who can read the
    status can test a guessed key against it.
  - Found by #653 (`apps/server` part c2: `boot.ts`, `boot.test.ts`, `config.ts`), outside its
    files or not fixable in a comments-only change. `apps/server/README.md` (near line 230, the
    `WAITRON_SKIP_RETRY_MS` row) says the sleep clamp can round a value "past" a bound, which it
    cannot (`sleepMsFor` in `loop.ts` is `Math.min(max, Math.max(min, wait))`, and config refuses
    `minTickMs > maxTickMs`); `config.test.ts`'s test title (near line 572) says "round back down
    past the floor" where it means "to the floor". The restore question A38 (#669) raised about
    `readNodeMembership`'s callers trusting the row is open under Task 9a. Two notes #653's prune
    deleted and nothing else recorded: nobody knows why the 5-second busy timeout did not absorb a
    `database is locked` in the pending-payment sweep; and nothing proves `startServer` itself
    survives a backup duty that cannot start — only `backup-supervisor.test.ts` covers that, at the
    supervisor. Left open by A39 (#671): each stop is written twice, once in the failed-start unwind
    list and once in the mode's `stopWork`; sharing one list was declined because it would change
    the normal shutdown order, which no test pins either.
    Test titles #653 could not touch in `boot.test.ts` carry the history tags
    "(SP-1a)", "(SP-1b)", "(SP-1b spec §3)", "(SP-1c)", "(slice 3)" and "SP-C dev override".
  - Found by #625 (`apps/server` part e1), outside its files or not fixable in a comments-only
    change. Docs: `docs/developers/conventions-data.md`'s `busy_timeout` receipt, which
    `recovery-lock.ts` now points at, should carry the date and Node version the deleted comment had
    (2026-09-24, Node v26.7.0). Tests and code, read not run unless stated: three `adopt.test.ts`
    titles say "before any mutation", but by then the primary has reserved an identity for the
    standby and added it to its membership list (the tests assert only on the mirror's own
    database); `adoptFromPrimary` (`adopt.ts`) spreads one adoption across several transactions with
    file writes between and no commented decision (CLAUDE.md §3), so a failure partway could leave a
    stamped mirror with no break-glass verifier; the restore guard's repeated-destination check
    compares resolved path text, so two names reaching one file through a symlink may pass;
    `mirror-session.ts`'s keepalive keeps an `isNull(lastSeenAt)` arm on a `not null` column (dead,
    kept on purpose); `MirrorBundle.wireguardPublicKey` is set by no production caller and read by
    nothing outside tests; `recovery-race.test.ts`'s header has no "weaker than its name" hedge
    though CLAUDE.md describes the guard that way. Test titles #625 could not touch:
    "…even when the retired variable is set" (`backup-config.test.ts`, still sets a `postgres://`
    URL), "…without copying the obsolete media directory" (`backup-sweep.test.ts`), "(C2b Task 9)"
    (`mirror-bundle-fetch.test.ts`), "(swap S2)" (`mirror-bundle.test.ts`) and "as a file from before
    the field existed" (`recovery-state.test.ts`).
  - Found by #624 (`apps/server` part c1), outside its files or not fixable in a comments-only
    change. Two `health.test.ts` cases, "stays 200 when reconcile has failed runs but nothing
    parked" and "does not flip health for a failed-only run (parked stays 0)", feed a clean pass,
    so they check less than their titles say. Test titles #624 could
    not touch: "(T12b)" in `boot-pending-sweep.test.ts`, "(prove-by-deletion)" in
    `boot.reconcile.test.ts`, "(C2)", "(pre-merge review)", "(I1)" and "skipped a tenant" in
    `health.test.ts`, "the new guard" in `config.test.ts`.
  - Found by #623 (`apps/server` part b: working-order, tabs, tables), not fixable in a
    comments-only change. Split-off checks may reach the same path as a held-order edit that
    changes sent lines (read, not run). The walk-up concurrent double-pay case in
    `working-order.pay-and-dispatch.test.ts` replays through the settled branch and never reaches
    `payWorkingOrder`'s duplicate-key catch; nothing tests two `openTab` calls racing on one table
    or concurrent rounds landing on consecutive line numbers (the sequential versions are in
    `tabs.test.ts`); nothing checks that a location or status foreign-key refusal in `tables.ts` is
    not reported as a zone fault; `setTablePlacement`'s raw read is typed `boolean | null` where the
    engine returns 1/0/null (it only tests truthiness). The SQL `--` comments inside
    `listTablesWithState`'s template text still carry "measured 2026-09-22", PostgreSQL's "LATERAL
    form" and aggregate-pair history and a "KDS-1 §3d" pointer. "A line with no course fires
    earliest", which #623 cut from `working-order.ts` because a line sent with `hold: true` is held
    whatever its course, is still in `apps/server/src/kitchen.ts:264` and four
    `packages/db/src/schema` files (`catalogue.ts`, `kitchen-courses.ts`, `ticket-items.ts`,
    `orders.ts`). Stale test titles: "lists the node's open orders" in `working-order.test.ts`;
    "(Task B1, …)" in `working-order.pay-and-dispatch.test.ts`; "an UNLOCKED read" in
    `tabs.test.ts`; "recordSale UNCHANGED" in `tabs.filing.test.ts`; many "(KDS-…)" and
    "(A1)"-style plan tags.
  - Found by #622 (`apps/server` part g), outside its files or not fixable in a comments-only
    change. `working-order.ts` (near `requireLiveCourse`) says the fire verbs use the same
    live-course definition; `fireCourse` calls `requireCourse`. `packages/provisioning/src/venue-apply.ts`
    names a `till.configure` gate for `createDeviceProfile`; the gate is `layout.configure`
    (`packages/layouts/src/device-profile-store.ts`). `docs/developers/conventions-data.md` names a
    `print-api.printer-wiring.test.ts` case "refuses another tenant's manager…" that #378 removed.
    `docs/developers/testing-guide.md` says the concurrent Enable/unpair payments test "locks the
    reader before deciding"; there are no row locks, the enable waits behind the unpair's write
    transaction. `apps/server/README.md` sends readers to "the `drain.complete` log line, the
    `incidents` table" for rejected fiscal records, a path only someone with a terminal can take.
    Read only, not run: `WebhookDeps.nodeId` looks unread by `settleWebhook`; `me-api.ts`'s profile
    save logs `account_email.send_failed` with the caught error's message. The lock-ordering and
    deadlock cases for transfers, merges and split bills went with PostgreSQL and nothing replaced
    them (one write transaction per venue file is what serialises those writers now). Test titles
    #622 could not touch: "regardless of database date display settings" in `print-api.test.ts`,
    "(the R-D dedupe)" in `kitchen-print.test.ts`, "(SP-B4 rehome)" in `receipt-print.test.ts`,
    "(SP-A.2 §16.4)" and "SP-C:" in `sale-till-source.receipt.test.ts`, "old per-taxpayer path"
    and "path tenant" in `webhook.test.ts`, "(FIX 2 cascade / FIX 4 split)" in
    `transfer-lines.test.ts`, "(the TS-4 shape)" in `move-merge.test.ts`, "TS-4's move guards" and
    "TS-2 status" in `split-bill.test.ts`.
  - Found by #621 (the rest of `apps/till`), not fixable in a comments-only change.
    **The empty walk-up options test in `apps/till/src/till-app.test.ts` is now a real case — DONE
    (W25, #1131, 2026-10-03):** it fails when the paid line drops its options answer, and when it carries
    the names the picker copied onto the line for display. The review reported that "resets any
    leftover drill/active tab on login" still passes with login's own clearing line deleted, because
    logout clears the same state first (run in review, not re-run here). A question the prune moved
    here from a deleted `menu-filter.ts` comment: should the `no-meat`/`no-fish` lenses also hide a
    dish whose diet is still pending review, as `vegan`/`vegetarian` do? Today they hide only dishes
    known to contain the tag. Comments inside `till-app.ts`'s template text still carry design-doc
    pointers (`cash-drawer-authorization §5`, `device-enrolment §3.1`), and many `till-app.test.ts`
    titles carry plan and review labels ("(Finding 2)", "(P6)", "(FP-1)", "(KDS-1)", "Task 8",
    "(SP-B2.1)"), as do three `session-activity.test.ts` titles ("(C3)").
  - Found by #620 (`apps/server` part h1), not fixable in a comments-only change.
    `redact-secrets.ts` was written against the PostgreSQL connection-string parser, and `pg` is now
    installed only for `bench/pglite-throughput`; whether a credential-bearing URL can still reach
    the log is unchecked. `apps/server/vitest.config.ts`'s `coverage.exclude` lists `scripts/**`,
    which its `src/**/*.ts` include already leaves out (read only). The adoption-pending entry below
    still gives PostgreSQL's SQLSTATE 23503 on `nodes_location_id_locations_id_fk` as evidence; this
    engine reports `FOREIGN KEY constraint failed` and names no constraint. Test titles #620 could
    not touch: "(design §3b(2))" in `set-table-status.test.ts`, "(owner decision 2026-08-02)" in
    `workforce-api.test.ts`, "(guard by deletion)" in `seed-sales.test.ts`.
  - Found by #618 (`apps/till` `src/api` + `src/state` + `src/i18n`), not fixable in a
    comments-only change. Test titles repeat claims the branch corrected:
    `apps/till/src/state/working-order.test.ts` "previews the total via priceBasket" (the preview
    sums line totals) and `apps/till/src/api/client.test.ts` "getExpoQueue GETs this node's
    cross-station pass queue" (the queue is venue-wide and includes placed orders).
  - Found by #617 (`apps/server` part f1), not fixable in a comments-only change. **Still open**
    (read, not run): the boot-time fetch is given only the URL (item (ii) of **Still open after A63**
    in the #657 item above), and boot never reads the `superseded` that
    `reconcileMembershipOnBoot` returns (`apps/server/src/boot.ts`, where it is called);
    `shouldFenceRestart` (`membership-fence.ts`) has no caller outside its test (`git grep`);
    `device-api.ts`'s ticket-item advance route does not enforce the `act-as-kds` capability, and
    the obstacle its comment gave (null profile ids) no longer exists; `enrol-rate-limit.ts` keeps
    one global limit whose stated reason (snitun) is gone; `provision-till.test.ts` inserts its
    tenant with `onConflictDoNothing`, so a second call's new NIF is silently kept out;
    `provision.ts` stamps the deployment in its own transaction before `applyVenue`, a split with no
    commented decision (believed to predate #617, not checked); and `setup-operation.ts` (around
    lines 128–133) may treat a lock written by a different store as a previous boot's, so a live
    process's lock could be taken over (a belief, not verified). `node-entry.test.ts` fixtures are
    still PostgreSQL-shaped (a `Failed query` wrapper, code `42703`).
    Test titles #617 could not touch: "(SP-A.2 §16, device-profile §5)" in `device-session.test.ts`;
    "since Task 7" and "this tenant's devices" in `device-api.test.ts`; "(R1 behaviour preserved)"
    in `membership-mint.test.ts`.
  - Found by #616 (`apps/till/src/widgets`), not fixable in a comments-only change. Test titles
    repeat claims the branch corrected: `apps/till/src/screens/till-allergen-screen.test.ts`
    "(escape/backdrop)" — `wt-dialog` closes on Escape and, measured in Playwright's Chromium 153,
    not on a backdrop click — and `apps/server/src/working-order.test.ts` "lists the node's open
    orders" (the list is venue-wide); `station-queue.test.ts` "(nothing to release)" is false for a
    held line with no course, and several `station-queue`, `tender-pay` and `modifier-picker` test
    titles carry task numbers. `css` comments in `apps/till/src/widgets/station-queue.ts` and
    `screens/till-expo-screen.ts` still call the courseless group "auto-fired". `apps/till/README.md`
    says the held list is shared across the registers "on a node". Read, not run: a courseless
    section the server held shows its lines greyed with no fire button (`#fireAction` in
    `station-queue.ts`, from #131); `GET /api/till` never sends `stripe_on_device`, so the
    offline-consent toggle cannot appear; `ReaderOption.online` is never set outside tests;
    `card-grid.ts` passes a `.canExitToCounter=${false}` that `embedded` already makes irrelevant;
    the tab shell and the supervisor dialog emit events not named `wt-*` (CLAUDE.md §3; not checked
    whether the rule reaches till widgets).
  - Found by #615 (`apps/server` part d), outside its files or not fixable in a comments-only
    change. **The recipe routes and the recipe screen are unreached**: #345 (`f5c8e7b5f`) removed
    `mountRecipeApi` from `apps/server/src/boot.ts`, nothing outside tests mounts
    `/management-api/ingredients` or `/management-api/products/:id/recipe`, and
    `apps/dashboard/src/screens/recipe-screen.ts` is imported by nothing (`git grep`), while its
    client methods in `apps/dashboard/src/api/client.ts` still call those routes (read, not run).
    Next action: the owner decides whether to delete `recipe-api.ts`, the screen and the client
    methods, or to remount the routes and route the screen. Read, not run: `alert.not_found` was
    documented as never revealing which case applied, but `apps/server/src/alerts-api.ts` answers
    `authorization.not_permitted` for an incident the session cannot see and `alert.not_found` for
    a missing id, so a caller can tell a real incident exists (#615 narrowed the comment; the route
    is unchanged). `mirror.bundle_fetch_failed` was documented as logging its cause; nothing logs
    it (`mirror-bundle-fetch.ts` discards the caught error) — whether it should is open.
    `packages/server-kit/src/request-screens.ts` says its screens are the only refusal and an
    unparseable value is stored; a foreign-key column refuses it (read, not run; #615 narrowed the
    `till-api.ts` twin). `docs/developers/conventions-ui.md` says the no-secret-in-params rule is
    stated per code in `apps/server/src/errors.ts`; it is now stated once, in that file's header.
    Test titles #615 could not touch: "before it reaches Postgres" (two, in
    `management-api-passkey.test.ts`), "not an opaque 500" and "non-uuid" titles in
    `management-api-passkey.test.ts`, `catalogue-api.test.ts` and `recipe-api.test.ts`,
    "option groups, gates, by-id FKs" in `catalogue-api.full-manifest.test.ts` (option groups no
    longer exist), "(Task 11)" twice in `management-api.canvases.test.ts`, "(Task 7)" in
    `management-api.accounts-and-receipt-config.test.ts`, "(Task 4)" in
    `management-api.device-profiles.test.ts`, and "KDS-1", "KDS-2", "FP-2" and "KDS-3" in
    `management-api.test.ts`.
  - Found by #614 (`apps/till/src/screens`), not fixable in a comments-only change. Read, not run:
    the till always mounts the counter screen `embedded` (`apps/till/src/till-app.ts`, the
    `<till-counter-screen>` in its render), so the screen's own header — its Allergens, Floor,
    Station, Expo, Schedule and Log out buttons and its allergen toggle — is reached only by the
    screen's own tests; the floor screen's only mount (`widgets/card-grid.ts`) passes `embedded` and
    `canExitToCounter=false`, so its standalone header, Back button and that property are likewise
    test-only; and in device mode the station screen's `#reload` swallows a `device.unauthorized`,
    so a device cookie revoked mid-session raises nothing until the next connect. The screens' `css`
    templates still carry task and spec numbers ("Task 7", "KDS-4 §3d"). Unchecked and kept: the
    allergen screen's legal citation (RD 126/2015 Art. 6.5.a.2°). Not restored because nothing
    confirms it: the table-order screen's `#lineGross` "same arithmetic the server files with" (the
    server does not call `grossOf`).
  - Found by #613 (`apps/server` `till-*`), outside its files or not fixable in a comments-only
    change. Two `v8 ignore start` comments in `till-sale.ts` (`finalizeCapture`,
    `finalizeSettle`) cite `provider.ts:66-83`; the checker compares tool comments character for
    character, so repointing them to `PaymentResult` in `packages/payments/src/provider.ts` is not
    a comments-only change. Test titles #613 could not touch: "lost-T2" in
    `till-sale-integrated.db.test.ts` (a captured card payment whose sale was never filed),
    "Tasks 5 & 6", "7b", "FP-1, Task 6", "FP-2, Task 4", "SP-A.2 cutover", "Task 12 cutover",
    "KDS-2/3" and "(Copilot)" in the `till-api*` and `till-config` suites, and 29 titles
    saying "opaque 500".
  - Found by #612 (the rest of `apps/dashboard`), not fixable in a comments-only change.
    `apps/dashboard/src/dashboard-app.ts` (a comment inside its `css` template, around line 435)
    points at `till-counter-screen.ts:111` for the 48rem breakpoint; that file no longer contains
    48rem. `date-utils.test.ts` has a test titled as guarding "against a vacuous pass", but #612's
    review removed the timezone pin and ran the file under `TZ=UTC`, and all four cases failed on
    their own. `catalogues` in `apps/dashboard/src/i18n/strings.ts` is read by nothing but
    `i18n/t.test.ts` (`t.ts` registers `{ en, es }` with the kit), so that test's "registers en-GB"
    case tests nothing that runs. The browser project in `apps/dashboard/vitest.config.ts` still
    excludes `.stryker-tmp`, though the app has no Stryker config. Not restored, by the review's
    choice: a note that `#sessionPermissions` only guides the screen and every module route is still
    checked on the server (not traced).
  - Found by #611 (`packages/venue-service`), outside its package or not fixable in a comments-only
    change. `apps/server/scripts/demo-seed/seed-floor.ts`
    writes `department_hours` times as `HH:MM`, bypassing `storedTime`'s `HH:MM:SS` (from #489; the
    dashboard slices both forms to five characters). The venue-service `migrations.test.ts` case
    titled "… or at commit" asserts no refusal at commit, which is now testable because
    `packages/store/src/node-sqlite-adapter.ts` rolls back a refused commit (since #489); a
    commit-time case, and the title, are a test change. `operations.test.ts`'s placeholder unit id
    no longer shows an empty string refused: `unit_id` is plain text.
  - Found by #609 (`packages/media`), not fixable in a comments-only change. **The
    `media_images` filename CHECK accepts a name with an embedded NUL**: the review stored 64 hex
    characters, `.png`, a NUL and `evil` (73 bytes) on `node:sqlite`, because `substr` stops at
    the NUL; closing it needs a migration.
  - Found by #610 (`apps/dashboard/src/api` + `src/widgets`), not fixable in a comments-only
    change. `reorder.test.ts`'s test names say an out-of-range move "clamps"; `reorder()` ignores
    it.
  - Found by #607 (`apps/dashboard/src/screens`), read only, not run: the recipe screen's
    `#loadRecipe` guard compares product ids, so choosing A, then B, then A again lets the first A
    answer apply and turn Save back on while the second A load is still running.
  - Found by #604 (`packages/ui`), not fixable in a comments-only change. **A table with no shape
    is drawn as a rectangle and saved as round on its first edit**: `wt-table-token.ts` draws
    `shape-${t.shape ?? "rect"}`, while `wt-floor-canvas.ts` marks Round as pressed and sends
    `shape: t.shape ?? "round"` from `#placementOf`, so dragging, nudging or rotating a shapeless
    table changes it (read from the code, not run). `packages/ui/brand/README.md`'s table omits
    `public/icon-192.png` and `public/icon-512.png`, which the generator writes.
    `packages/ui/vitest.config.ts` and `stryker.config.json` still exclude
    `src/tokens/token-test-helpers.ts`, which moved to `packages/ui-core` in #519 (the
    entry "`packages/ui/src/vitest-park-pointer.ts` is mutated and has no tests" in Track C still
    names it there too). A reviewer believes the `demo/**` coverage exclusion matches nothing and
    that `**/ui-core/**` is there because `packages/ui-core` starts with `packages/ui` (CLAUDE.md
    §4's unanchored-include trap); neither was tested.
  - Found by #603 (`packages/catalogue`). **`mergeAllergenMaps` (`src/derivation.ts`) can list a
    source twice and order sources differently from run to run**: `recomputeProductDerivations`
    (`packages/recipes/src/recipes.ts`) feeds it ingredient rows in no fixed order, and #603's
    review measured, with three or more sources, barley/rye/wheat folded in two orders giving
    "barley, rye, wheat" and "barley, wheat, rye", and barley/rye/barley giving "barley, barley,
    rye". The comment now says so; the code is unchanged. Read only, not run: `writeItems`
    (`src/extras.ts`) and `writeLabels` (`src/options.ts`) each keep a refusal after their insert
    that looks unreachable now (duplicate and foreign ids are refused earlier and one write runs at
    a time). `MAX_MODIFIER_INTEGER` (`src/modifier-limits.ts`, 2147483647) and the extras
    contract's `whole` bound were PostgreSQL's integer maximum and have no stated reason on this
    engine; the test names "refuses a pick bound above what the column can hold" and "refuses a
    maxQuantity above what the column can hold" (`src/extra-contract.test.ts`) assume a column
    limit. `assertRefsExist` (`src/product-modifiers.ts`) still reads lists in sorted key order,
    which served PostgreSQL's lock ordering only. Four configuration-transfer cases (in
    `options.test.ts`, `product-modifiers.test.ts`, `extras.test.ts` and
    `extra-projection.test.ts`) pin an insert order that the importer's
    `pragma defer_foreign_keys` makes unnecessary for foreign keys — whether to keep pinning it is
    the owner's call. Test titles a comments-only change cannot touch: `describe("validateContainsTag
    (Task 4)")` and `describe("validateDietOverride (Task 4)")` (`src/dietary.test.ts`), "settles
    a product id sent in upper case in the database" (`src/product-modifiers.test.ts`, the code
    settles it now), "rebuilds every lookup index without the tenant" (`src/migrations.test.ts`).
  - Found by #602 (`scripts/`), each in a file a comments-only change cannot carry.
    `.github/workflows/ci.yml` (about line 283) says the three-shell receipt sits in
    `.husky/pre-push` beside the same loop; it is not there.
    `docs/developers/modifiers.md` (about lines 469-472) calls the `catalogue-engine-neutral`
    header paragraph "the receipt" for not checking `pgEnum` in the order and sale files;
    #602 deleted that paragraph because those columns are now
    `enumType` (text plus a check). `docs/developers/testing-guide.md` (about line 294) says
    `scripts/ci-workflow.test.mjs` "had the mechanism right first"; #602's review corrected that
    file's comment to what testing-guide itself measured (the per-test timer does not fire during
    a blocking `spawnSync`; the test is failed afterwards for its length), so the credit no longer
    matches.
    Two reasons #602 deleted and did not restore, for the owner to confirm: the hook bullet at the
    top of `scripts/check-signoff.test.mjs` no longer gives a reason (the shell-instead-of-`.mjs`
    decision `licence.yml` points at is still stated), and `scripts/english-only.test.ts`'s
    provisioning-test exemption lost its end condition ("until that test runs against fiscal-none",
    spec §6 step 5).
  - Found by #601 (`packages/reporting`). **Owner decision 2026-09-24: a void counts on the day it
    is made, not the day of the sale** (built in #605 for the daily close's VAT, the period VAT
    summary and top sellers). The quarterly *modelo 303* keeps its old behaviour, pinned by a test in
    `vat-return.test.ts`, until the asesor answers `docs/compliance/asesor-questions.md` Q25 (which
    VAT period a later annulment lands in). No till screen or server route calls `recordVoid` yet.
    `stableStringify` (`src/daily-close-hash.ts`) throws on a `null`, and a key holding `undefined`
    hashes differently from the row the database stores (the column drops the key); its comment now
    states the precondition, and nothing enforces it for callers. Not fixable in a comments-only
    change: test titles still say "jsonb" (`verify-daily-close-chain.test.ts:70`), "tenant"
    (`top-sellers.test.ts:501`, `overdue-orders.test.ts:252`, `vat-summary.test.ts:233`,
    `vat-summary-period.test.ts:128`), "design §3" (`overdue-orders.test.ts:194`), "spec §12"
    (`top-sellers.test.ts:307`) and "DrizzleQueryError-style" (`record-daily-close.test.ts:342`, not
    checked). `toDr303Record` (`src/dr303.ts`) does not cross-check a monthly total against a
    quarterly period code such as "4T"; a test pins that and the one route that builds the file
    takes both from the same code, so it looks deliberate — worth the owner's eye because it is a
    tax file. The top-sellers fixtures give most lines no kitchen name, where CLAUDE.md §3 asks all
    three names to differ (top-sellers never reads that name).
    `record-daily-close.concurrency.test.ts:60` says "nothing but the write queue keeps the second
    out"; a reviewer, reading only, thinks the one-close-per-day unique constraint refuses it — not
    checked. `packages/core/src/errors.ts` names `scripts/errors-reachable.test.ts` without the hedge
    #601 gave reporting's (the guard matches text).
  - Found by #600 (the small packages), not fixable in a comments-only change. `apps/server` test
    titles still say an unscreened malformed id becomes an opaque 500, although ids are text columns
    now. Also found by reading only, not run: nothing the review could find copies
    `node_membership` from the primary to a standby, so a promoting standby may take
    `nextStandings`' fallback that appends it with an empty `contactUrl` (`packages/membership`),
    which `routableServers` then drops.
  - Found by #598 (`packages/core`), not fixable in a comments-only change. Test titles still
    carry claims the comments no longer make: `incidents.test.ts:463` says orphan raises de-dup
    "via NULLS NOT DISTINCT" (PostgreSQL wording); `record-void.test.ts:340` and
    `record-correction.test.ts:443` say an ordering "never leaks an authz error", which #598's
    review did not bear out (Codex ran both orders: with the lookup first, an unauthorised caller
    tells a missing sale from an existing one by the error); and `record-sale.test.ts:888`, `:964`
    and `:1029` carry history ("legacy path unchanged", "additive, no behaviour change"). No test
    reaches `settleSale`'s catch that turns a `sale_settlements` unique-key refusal into
    `sale.already_settled` (`packages/core/src/settle-sale.ts`); #598 measured the earlier check
    stopping both concurrent-settlement tests first. `sale.number_reused` is registered in
    `packages/core/src/errors.ts` and `git grep number_reused -- apps packages` finds no thrower
    (see *Decide whether to implement `sale.number_reused`*). Outside core,
    `docs/developers/conventions-data.md` says the stored breakdown holds "the literals a fiscal
    record hashes" (#598 found the hash covers the totals, not the breakdown).
  - Found by #597 (`packages/payments-sumup`, `packages/migrations`), not fixable in a
    comments-only change. Pointers outside `docs/` that #597 made stale: `apps/server/README.md:82`
    says `packages/migrations/src/apply.ts` carries the lock races, which now live only in #489;
    `packages/db/src/immutability.sql.md:18` cites `apply.ts:105` for the trigger install, which is
    now the `installAppendOnlyTriggers` call at line 74; and `.github/workflows/ci.yml:401` says
    esbuild collapses "all five" migration descriptors, while
    `grep -rhoE "export const [A-Z_]+_MIGRATIONS\b" packages --include='*.ts' | sort -u` lists 15
    names on `ca01a7fbd`. `sumupClientForTenant` (`packages/payments-sumup/src/card-provider.ts:50`)
    still carries "tenant" in its name. The fake SumUp client leaves its one-shot switches for a
    lookup or a refund armed when a checkout before them is refused; no test combines the two.
  - Found by #592 (`packages/fiscal`), not fixable in a comments-only change or outside the
    package. Two SQL comments inside a `sql` string in `packages/fiscal/src/testing/fake-backend.ts`
    are code, not comments: one points at `packages/fiscal/src/backend.ts:72` for `total: Decimal`
    (it is at line 50) and names "Task 14", and one says the breakdown column is NULL only for a
    void, while the fake's corrections and substitutions leave it NULL too.
    `FiscalBackend.pendingCount` has no caller outside the backends and their tests, yet
    `packages/db/src/schema/sales.ts:29` says it is how the count is read.
    `packages/fiscal-verifactu/src/slot.ts:51`
    says `validate` runs BEFORE `provisionVenue`, which #592 narrowed in `contribution.ts` to an
    instruction to the caller, because `apps/server/scripts/cloud-integration-fixture.ts` calls
    `provisionVenue` without it. `packages/fiscal-verifactu/src/no-regime-scope.test.ts:7` says
    `packages/fiscal`'s guard forbids ENGLISH regime terms; its list is half Spanish.
    `no-hardcoded-margin.test.ts` scans only the files directly in `packages/fiscal/src`, not
    `src/testing/`, and does not say so.
  - **Shift times are stored in one spelling — DONE (W22, 2026-10-03):** `addShift` and
    `updateShift` write both shift ends as the UTC whole second (`shiftInterval`,
    `packages/workforce/src/clocking.ts`).
    Open, found by #1134's review and not taken there: the dashboard's shift dialog
    (`apps/dashboard/src/widgets/shift-dialog.ts`) builds the end time on the START's day, so a
    shift that runs past midnight (22:00–02:00) is refused as `shift.invalid` — as it was before
    #1134. And an edit keeps the shift's stored offsets, so moving a shift across a summer-time
    change keeps the old offset. Next action: let the dialog put the end on the next day when it
    is not after the start, and derive each offset from the venue's time zone for the date.
  - The unused payment reconciliation and SumUp provider `nodeId` options were removed in W8.
  - Two concurrent passes over `listAttempting` (`packages/payments/src/store.ts`; its one caller is
    the SumUp provider's `resolvePending`) do not both succeed: #558's review measured
    `["fulfilled","payment.not_found"]`, so the second pass throws partway instead of skipping the
    rows the first resolved. The comment at `listAttempting` now says so.
  - The v8-ignore reason "never run by `vitest run`" on schema files' extra-config functions was
    measured false (identity, 2026-09-24, and #562's review). #585 took the reason out of
    `packages/db/src/schema`; the ignore pairs there stay. Four identity schema files and six in
    `packages/fiscal-verifactu/src/schema` keep the ignore pairs with no reason; removing a pair is a
    code change, for whoever next changes that package's code.
  - The `schema-conformance.test.ts` headers of `payments`, `workforce`, `media`
    and `workforce-es` say an unnamed unique constraint reaches the factory's refusal; drizzle-orm
    0.45.2 names an unnamed `unique()` itself, so nothing reaches it
    (`packages/db/src/testing/schema-conformance.ts`).
  - Identity code, found by #559: `setEmail` in `packages/identity/src/staff.ts`,
    unlike `updatePersonDetails`, never checks the new email against other people's pending
    emails; `manager-login.ts` reports an authenticator secret it cannot decrypt as a failed login
    (`password.invalid`, logged with the reason `unreadable_secret` since C95), like a wrong code.
    Identity's coverage reads 99.85 statements / 99.75 branches, not 100: the
    `management_session.required` throw in `profile.ts`'s `ownSession`, as it stands since #554,
    is reached by no test.
  - The empty-venue-directory reason #561 deleted from `packages/provisioning` ("an empty value would
    stand a venue up in the working directory") is false there: measured 2026-09-24 on Node v26.7.0,
    `openVenueDatabase("")` fails `ENOENT: no such file or directory, mkdir ''`, and a real path as
    the control created `venue.db` and `node.db`. The same reason still stands in
    `packages/provisioning/README.md` and in `docs/developers/conventions-data.md` (the paragraph
    on `resolveVenueDir`, "an empty directory is the RELATIVE `venue.db`"). The test title in
    `packages/credentials/src/bin.test.ts` that states the empty-folder behaviour still does (a
    title is code, so a pruning PR cannot rename it).
  - `packages/provisioning/README.md` also says only `ES-common` is implemented (a `GB-vat` run
    exits 0 in `cli.test.ts`), and repeats two reasons #561 deleted from the code's comments: that
    `provisioning.venue_conflict` means a concurrent run committed between plan and apply (the apply
    reads and writes inside one `withTransaction`, `venue-apply.ts`, and whether a second PROCESS can
    interleave was not measured) and that the entry point can only be checked through the built
    bundle (its prompt function runs straight from source). `docs/developers/conventions-data.md`
    cites `packages/provisioning/src/errors.ts` as spelling engine errors by `errcode`; it no longer
    does.
  - `packages/provisioning` code, found by #561 and not changed: `quoteIdent` has no
    caller outside its own suite, and the `quoteLiteral` re-export in `identifiers.ts` is used only
    by that suite; the `action.email === undefined` branch in `venue-apply.ts`'s seed-admin cannot
    run, because the action's `email` is a required string; the coverage config leaves `src/bin.ts`
    out with no reason stated any more, which may hide code a test could reach; and `cli.test.ts`
    test titles still say "before connecting" and "before opening a connection", and one title
    ("rather than opening the working directory") rests on the false reason above.
  - `packages/fiscal-verifactu` code, found by #562; not changed unless marked:
    - **`drain.ts`'s Route B lookup (`client.consultar`) no longer holds the venue's single writer
      across an AEAT round trip: it runs before the transaction that saves AEAT's reply — PARTLY
      DONE (W21, 2026-10-03).**
      - **Open:** a failed lookup, when the save reaches its line, still backs the whole batch off,
        discarding every line's outcome and the reply's receipt code (the CSV, one per
        submission), which AEAT does not send again.
    - The inner try/catch around the log call in `aeat-transport.ts`'s `closeAll` is dead: with it
      removed, the "LOGGER fails" case still passed, because `Promise.allSettled` absorbs the
      rejection.
    - Removing `appendToChain`'s nested `tx.transaction` makes no test fail (`chain.test.ts`'s
      header says so); the protection it gives a losing attempt has no test holding it.
    - `write-path.e2e.test.ts` (lines 414 and 418) points at `test/fixtures.ts:249-256` for a
      receipt of one basket hashing differently filed 16th and filed standalone, and at
      `test/write-path-fixtures.ts:37-44` for `steadyClock`. The receipt is now at
      `test/fixtures.ts:285-289` and `steadyClock` at `test/write-path-fixtures.ts:27-39`. Correct
      them only in a change allowed to touch that file.
  - `apps/setup` code, found by #567. `#onGoto` in `setup-app.ts` keeps `fiscalTestStatus`, so a
    rejected or uncertain fiscal-test banner, and an accepted result, survive leaving that screen and
    coming back, even after the certificate changes (found by reading, not run; whether that is
    wanted is undecided); a cloud restore opens the provisioning screen (`#onCloudRestoreAction`)
    without `#clearProvisionOutcome()`, which the four other ways onto that screen call first, so an
    earlier attempt's message could show there (found by reading, not run); `AdoptOutcome`'s
    `breakGlassSecret` is typed as required, but a replayed adopt answers without it
    (`apps/server/src/setup-api.ts`); the done screen treats any failed status read as "the box is
    trading", so a passing 503 could offer the reload early; the mode screen's own text says a live
    server files real invoices, which a live run on a development box does not; `setup-app.test.ts`
    has two test titles naming a `SyntaxError` from a non-JSON error body that `apiError` turns into
    `server.internal`; `events.test.ts` has no case for the restore and fiscal-test dispatchers; the
    `*.css?inline` declaration in `vite-env.d.ts` is redundant (vite/client declares it);
    `vitest.config.ts` excludes `.stryker-tmp` in a package with no Stryker config; `paintCanvas` in
    `widgets/test-helpers.ts` has no accessibility suite that fails without it; `done-screen.ts`'s
    styles used hex fallbacks and `rem`, and a CSS comment inside its style string was history —
    DONE (W34, A244); and `connection-screen.ts`'s `connection-continue` event is not named `wt-*`
    and carries no `detail`.
  - "Nothing under `apps/` may import a regime package (`scripts/module-seams.test.ts`)", which #567
    deleted from `apps/setup/src/server-fields.ts`, is too wide: with
    `import "@waitron/fiscal-verifactu";` added there, that guard still passed, since its regime
    checks read `packages/provisioning` and `apps/server/src` only. The same claim stands in
    `packages/fiscal-verifactu/src/venue-fields.ts`. Prune with those.
  - `packages/store`, found by #568 and not changed: `isLocked` in `venue-lock.ts` reads `.errcode`
    without a null check, so a thrown `null` would raise a `TypeError` (the driver throws real
    errors). `CLAUDE.md` §3's read-routing rule says a read-only connection does not refuse an
    `ATTACH`; #568's probe (Node v26.7.0) found one naming a file that does not exist IS refused
    there (errcode 14, no file created), while an existing file and `:memory:` attach — narrow that
    sentence in a pull request, since a root `CLAUDE.md` change takes the normal flow.
  - `packages/payments-stripe`, found by #570 and not changed (each a code or config change, not a
    comment): the two `provider.test.ts` cases named "throws payment.not_found" assert only
    `rejects.toThrow()`, not the code (CLAUDE.md §4); `tenant-scoping.test.ts` is named for tenant
    scoping but now guards that no source file opens a bare `.transaction(`; and `vitest.config.ts`
    leaves `src/stripe-client.ts` out of coverage although #570's review made that wrapper throw and
    two tests in the normal suite failed, so the normal run does reach it — CLAUDE.md §2 says a gap
    is never closed by an exclude over code a test could reach. Reversal retry-safety (one persisted
    id per reversal) is still deferred: #570's review showed two identical `reverseViaStripe` calls
    get different idempotency keys, so a retried reversal sends a second real refund; the comment
    at `reverse.ts` says so.
  - `packages/printing`, found by #572 and not changed (code, not comments): an aged batch can
    print twice. When a large batch to a slow printer outlives the one-minute lease, another agent
    in the venue can re-claim the jobs not yet sent while the first agent still sends every job it
    pulled; the lease comment in `runtime.ts` now says so. Read from the agent's send loop, not
    run. In `printers.test.ts`, the case named "a driver error that is NEITHER the UNIQUE NOR the
    CHECK propagates UNCHANGED" uses a value SQLite refuses by the `printers_transport_ck` CHECK.
    `escpos.ts`'s `qr()` is not what the receipt uses (it is built with `qrRaster`); the legal
    reason for error-correction level M is stated in `apps/server/src/qr-matrix.ts`.
  - Found by #585's review in files outside `packages/db/src/schema`, not changed there:
    `packages/db/src/schema/columns.test.ts` still imports `../index.js` and `./drawer-opens.js`
    dynamically; the comment #585 deleted was the only note that this was meant to be temporary, so
    making them static imports is a small code follow-up.
  - Found by #589 (`packages/db` outside `src/schema`), not changed. In
    `packages/db/src/change-log.test.ts` the case under "THIS CASE NO LONGER SEPARATES ANYTHING"
    repeats the first case under another name (a test change, not a comment one).
  - `packages/credentials`, found by #577 and not changed. Nothing now checks at run time that a
    read returns something other than a Node `Buffer` (the runtime case went with the PostgreSQL
    suite; a 2026-09-22 measurement read `Uint8Array`, `Buffer.isBuffer` false). Nothing checks
    that a caller other than the application cannot read or list the vault; only the encryption
    protects it. Test titles ending "— C1" and "(M7)" are old review labels, and
    `credentials.test.ts`'s fixtures `sk_test_rls`/`whsec_rls` carry a PostgreSQL-era name. The
    `beforeEach` deletes in the store, cli and rotate suites may be redundant beside `useVenueDb`'s
    per-test reset (not tried).
  - Two 2026-07-26 specs still call the FNMT seal certificate's export unverified, which
    `docs/compliance/getting-to-production.md` §4 closed that day (found by #577).
  - `packages/bookings`, found by #574 and not changed (code, not comments). Seating a booking at a
    table in a zone that is not a table-tab zone has no bookings test: the real `openTab` refuses
    it with `service_zone.mode_incompatible`, the fake core in `src/testing/fake-core.ts` does not,
    and `routes.ts`'s `STATUS` map has no entry for that code, so it answers 400 by default.
    Editing a booking that is already seated answers `booking.not_found`, which the dashboard shows
    as "could not be found". The server accepts an empty contact name; only the dashboard form
    refuses one. `seatBooking`'s `status = 'booked'` condition on its final update cannot fire
    while every caller goes through `withTransaction` (read, not run). Test titles in
    `bookings.test.ts` and `migrations.test.ts` still say "tenant", and `floor.test.ts` inserts
    `booking_time` as `HH:MM` while the write path stores `HH:MM:SS`. #574 moved the Vitest 3
    `groupOrder` measurement on bookings (CLAUDE.md §4) out of its `vitest.config.ts` into its
    commit message; `docs/developers/testing-guide.md` has no paragraph holding it.
  - Found by #588 (`packages/layouts`), not fixable in a comments-only change. One test title in
    `packages/layouts/src/canvas-store.db.test.ts` (line 144) still quotes PostgreSQL's error number
    23001; the stores match SQLite's. `packages/printing/src/errors.test.ts:5`
    says the error construction typechecks "ONLY because" of one import — #588's review measured the
    same claim false for printing and layouts. Both layouts database suites create a
    manager session in `beforeAll`, while `useVenueDb` empties every data table after each test by
    default (`resetPerTest`, `packages/db/src/testing/venue-db.ts`), so only a suite's first test can
    use that session; they pass today because only the first does.
  - Found by #581 (`packages/scheduler`). The nested `tx.transaction(...)` in `enqueueSuccessor`
    wraps one insert, which SQLite backs out by itself when refused, so it changes nothing today;
    `insertClose` in `packages/reporting/src/record-daily-close.ts` is the same case
    (`docs/developers/conventions-data.md` has the probe). Whether to remove these two nested calls,
    or say why they stay, is open (a code change, not made). #587's review also found older comments
    still describing PostgreSQL's behaviour, left alone there:
    `packages/store/src/node-sqlite-adapter.test.ts:90` calls keeping the outer transaction usable
    "the whole point of the savepoint"; a test name in
    `packages/fiscal-verifactu/src/chain.test.ts:225` says a collision would "poison the whole
    transaction" (a test title, which a comments-only change cannot touch).
    The reason "v8 reports phantom uncovered branches" given for excluding
    barrel `index.ts` files from coverage did not hold in scheduler: with the exclusion removed,
    both barrels reported 0 branches at 100% and the totals did not move. So scheduler's two barrel
    excludes in `vitest.config.ts` can go (a config change, not made), and the same reason is still
    given in the configs of workforce, credentials, bookings, workforce-es, server-kit,
    dashboard-kit and fiscal-none (not re-measured there); `payments-sumup` keeps its
    `src/dashboard/index.ts` exclude with the reason deleted by #597, also not measured. `claimGap`
    uses an untargeted `.onConflictDoNothing()` on a table with two unique constraints (the `id`
    primary key and `scheduled_runs_key`); CLAUDE.md §3 asks for a named target there, though `id`
    is freshly generated (read, not run).
  - Found by #579 (`packages/shared`). `decimalToCents` refuses an amount over the bound
    (#583), but `centsToDecimal` itself has no digit bound, so a count past 99999999999999 cents
    that reaches it by another route is still turned into an amount without refusal.
    `docs/developers/conventions-data.md` (the "no column width left to measure" paragraph) has only
    the PostgreSQL raw-read table, not the SQLite one #579's commit message now carries. Comments
    saying drizzle wraps a failed query remain elsewhere — `git grep -l -i -E "drizzle wraps|wraps
    every failed" -- ':!docs'` listed files in `apps/server`, `db`, `identity`, `media`,
    `migrations`, `printing` and `store` on 2026-09-24, not each checked (see the
    `DrizzleQueryError` entry under *Afterwards*).

- **The two SQL scanners named `stripSql` blank block comments before `--` comments — OPEN (split
  from A95).** `scripts/module-graph-honesty.test.ts` and
  `packages/sync-enrolment/src/migration-tables.ts` (product code, not a guard) blank `/*…*/` before
  `--` comments and `'…'` strings, the same ordering the six TypeScript guards had. Read, not run;
  whether any file they scan has a `/*` inside a `--` comment or a string is not measured. The
  TypeScript reader in `packages/shared/src/source-comments.ts` knows nothing of `--` comments, so
  it is not a drop-in fix. See also the OPEN bullet "Copies of the patterns A105 and C27
  replaced…", which holds the copy of `/--.*$/` in `scripts/module-graph-honesty.test.ts`: a fix to
  one touches the other's code.

- **DONE — `scripts/errors-reachable.test.ts` and `scripts/module-seams.test.ts` ignore imports
  inside comments (W7).** Each guard now scans text after `blankComments`, with a commented-import
  regression case. The shared reader still guesses whether `/` opens a regular expression, and
  imports written inside strings can still match. `scripts/column-vocabulary.test.ts` also
  has a `withoutComments`, left out on purpose: it runs only on the text between an import's
  braces, which its header says holds no string or template literal.

- **Nobody has timed `packages/db/src/testing/schema-conformance.ts` under a mutation run — OPEN
  (2026-09-23).** `packages/db`'s mutation run is split across ten parallel CI jobs by
  `scripts/mutation-shard.mjs`, which packs whole files into jobs by file size in bytes. That file is
  now the largest file the run mutates — recompute with
  `find packages/db/src -name '*.ts' ! -name '*.test.ts' -exec wc -lc {} + | sort -k2 -nr | head`
  rather than trusting a figure written here. `sales.ts` is the single entry in that script's
  `HEAVY_FILES`, the mechanism for splitting one file across several jobs. **The new file's runtime
  was not measured and no `HEAVY_FILES` entry was added**, so whether it drags a job out the way
  `sales.ts` did is unknown — and size alone does not settle it, since what dominated `sales.ts` was
  that nearly the whole suite covers its mutants. Nothing on a pull request will say either:
  `packages/db`'s mutation score and its job durations belong to the weekly `mutation.yml` run
  (`CLAUDE.md` §2). **Next action:** read the job durations from the next weekly run, and add a
  `HEAVY_FILES` entry if that file's job is the long one.

- **The spawn-timeout guard compares a bound against the LARGEST SINGLE wait, never the sum — OPEN,
  and the guard cannot close it.** A case that waits several times can still outlast a bound that
  passes this check. Only reading catches that shape; if it recurs, the answer is probably a runtime
  check rather than a text reader. (Its `packages/` and `apps/` half went with the real-PostgreSQL
  harness; re-extending the scan is worth doing only if suites under those roots start declaring
  long waits again — `CLAUDE.md` §4.)

- **What the per-push CI concurrency groups (#384) left open:**
  - **No run has exercised the `hold` answer** — an older run publishing after a newer one — which
    needs two merges close enough together to overlap and is not worth forcing.
  - **Two states stop publishing until a person intervenes:** a `:main` carrying no
    `WAITRON_BUILD_ID`, and one built from a commit this repository's history does not contain (an
    image built outside CI, or a rewritten history). Both wedge every later publish identically; the
    `sha-` tags keep coming. The repair is to delete or retag `:main` by hand. Nothing alerts on it.
  - **The first publish into a brand-new package will stop**, because GHCR answers `403 Forbidden`
    for a package that does not exist rather than `not found`, and treating a 403 as "no tag yet" is
    exactly the broadening that would publish a backwards tag. It matters only to a fork.
  - **The guard's concurrency cases see ci.yml alone.** `scripts/ci-workflow.test.mjs` reads that
    one file as text for them, so a future push-triggered workflow that groups by ref is seen by
    nothing.

- **Three unexplained incidents, each seen once or twice; on recurrence retain the log before
  retrying** (standing rule: a flaky test is fixed at the root): eleven UI suites failing to load with
  "Vitest failed to find the current suite/runner" after a rebase (2026-09-11); a test PostgreSQL
  container with no published port (2026-09-12 — capture `docker inspect` and check the Docker
  Desktop VM's ephemeral ports); bookings' browser freeze, never reproduced locally after #291. A
  fourth, from #334's validation run (2026-09-12): the service-status browser suite failed with
  Playwright's "Frame was detached" during a whole-workspace run, and then passed on its own with no
  code change. The original log and screenshot were kept; the cause is unexplained, so retain them
  again on the next sighting rather than re-running to green.
- **A sixth: `apps/dashboard/src/widgets/variant-form.test.ts` → "saves on Enter and cancels on
  Escape from a focused field" — FIXED (A220f, #1075).** Seen in CI 2026-09-20 on #469, failing at
  `expect(cancel).toHaveBeenCalledTimes(1)`. Cause, measured 2026-10-03 with a throwaway probe that
  repeated the test's own Enter-then-Escape sequence 150 times: when `userEvent.keyboard("{Escape}")`
  resolved, the native dialog was already shut every time, but in 13 of 150 its `close` event — which
  `wt-dialog` re-sends as `wt-close`, and the variant window as `wt-cancel` — had not yet been
  delivered; it arrived within 50 ms each time. Focus stayed on the field after Enter in all 150, so
  the older idea that the save moves focus did not happen in those runs. The test now awaits `closeReportsDelivered()`
  before counting the cancel, the helper its sibling tests use for the same wait. Measured on that
  one test, run alone 40 times without the new line and 40 times with it, from `apps/dashboard`:
  `pass=0; fail=0; for i in $(seq 1 40); do if gtimeout 120 pnpm exec vitest run src/widgets/variant-form.test.ts -t "saves on Enter and cancels on Escape" > /tmp/a220f/before-$i.log 2>&1; then pass=$((pass+1)); else fail=$((fail+1)); fi; done; echo "before: pass=$pass fail=$fail"`
  (the second loop wrote `after-$i.log`): 10 of 40 failed before, 0 of 40 after; the probe with the same wait, 400 repeats: 41 late cancels,
  all delivered once the wait returned, none missing. Control: with the window's `@wt-close` handler
  deleted, the fixed test fails at the same assertion. An independent review re-measured on 2026-10-03:
  5 of 40 failed without the wait and 0 of 40 with it; its 400-repeat probe saw 23 late cancels,
  every one delivered once the wait returned.
- **A fifth: a stray `:hover` state in `test-dashboard`'s browser a11y suite — FIXED in #350; two
  pieces still open.** The `dashboard-app.a11y.test.ts` heading-order sighting is a different rule
  with no colour evidence, so nothing here explains it — treat it as still unexplained. And
  `packages/ui` and `apps/till` have the same harness with no pointer reset (the dashboard's is
  `parkPointer`, guarded by `apps/dashboard/src/widgets/pointer-reset.test.ts`), with
  `packages/ui/src/components/wt-button.test.ts` ending a test hovering a button, so the same flake
  is waiting there.
- **A sixth: a CI shard exited 1 with every test passing (PR #414) — the exit-1 path closed by the
  Vitest 4.1.11 upgrade (#437); why the call went unanswered is still open.** Under vitest 3.2.7 one
  worker's `onTaskUpdate` reporting call timed out on birpc's 60-second default. On 4.1.11 an answer
  that never came would leave the shard waiting until the job's 15-minute `timeout-minutes`
  cancelled it, rather than failing it when the run ends. Written up in
  [ci-and-gates.md](developers/ci-and-gates.md) rather than fixed (owner decision 2026-09-18); keep
  the job log on the next sighting — it is the cheapest evidence there is.
- **What the grants refuse ONE OPERATION AT A TIME is not guarded (2026-09-19).**
  `scripts/write-path-tables.test.ts` (#430) covers the tables request code may read and never
  write — those `scripts/write-path-tables.json` lists, `tenants`, `nodes`, `deployment`,
  `mirror_config` and `node_roles` — and nothing else. The slice-1 design asks for more: everything
  else should become a guard that reads the source, not a convention with nothing checking it. Many
  tables refuse an insert, an update or a delete only through the grant, with no trigger backing it,
  and TRUNCATE is wider still — no table grants it and only ten carry a trigger blocking it. The
  per-table matrix is read from `packages/fiscal-verifactu/src/privileges.expected.ts`, which goes
  when the grants do.

  **What #430's review left behind, none of it taken there.** The allowance list is a JSON file
  rather than the annotated TypeScript constant every sibling guard uses, because the plan named a
  file that outlives the grants; the justification for each entry is a doc comment beside the
  `JSON.parse` instead, which no test reads. The detector only reads a builder call whose receiver
  looks like a database handle, so a write through a handle named something else is invisible; that
  was the price of not reporting `cache.delete(nodes)` on an ordinary `Set`.

  **Next action:** decide before the flip between three shapes. Grow the guard an operation column,
  which means encoding a privilege matrix as regexes. Give the tables that lack one a `reject_mutation`
  trigger, as the core baseline already does for eight tables in a single migration. Or brand the owner handle as its own type
  so `tsc` refuses the write instead of a text scan reporting it. Today the distinction is carried by
  a NAME and nothing else: `apps/server` declares `ownerDb: Database` at half a dozen call sites and
  hands it to write helpers in `packages/db` that take a plain `Database`, which is the same gap
  `CLAUDE.md` §3 names for the neighbouring `Database`/`Transaction` case. The third also closes
  the two weaknesses the new guard states about itself: it reads text, and it judges a file rather
  than a call chain.

- **No comment or test title names a PostgreSQL SQLSTATE as today's behaviour — DONE (C127, #1036; the two shipped migrations' comments followed in #1042).**
  **#1042 needs every venue migrated before it reset** — the owner's box included (dev venues: `wa-wt reset demo <name>`): it changed the hashes of `packages/db/drizzle/0001_behavioural_triggers.sql` and `packages/media/drizzle/0001_image_references.sql`, so boot refuses such a venue with `provisioning.database_ahead`.
  Still unprobed: the remaining "not a 500" titles across the `apps/server` route suites, which name
  no engine.

- **Small renames and dead exports the sweep found and could not make — OPEN (T2, 2026-09-23; narrowed by A92 and by C127's second pull request (#1039), which renamed the `pg` handles to `suite`, dropped five `.sqlite.` infixes and retitled the `bytea` test).**
  Still open: `apps/server/src/working-order-reads.sqlite.test.ts` keeps its `.sqlite.` infix
  because the approved slice 3d plan (`docs/superpowers/plans/2026-10-01-watchers-slice-3d.md`)
  ran it by that name. PF8 landed as #1088; rename the file and its references in the next T2
  sweep. The `pg` handle
  stays in `packages/fiscal-verifactu/src/write-path.e2e.test.ts` and `inmutabilidad.test.ts`,
  the fiscal gates no runner edits.
  `generatePassword` has a caller in `apps/server/src/break-glass.ts` and remains exported.
  The `provisioning.invalid_identifier` error registry entry remains; the A92 tree search
  (`rg -n provisioning.invalid_identifier packages apps`) found no product throw site. Retire it
  with the broader dead-code sweep, checking stored-code consumers first.

- **`bench/pglite-throughput` starts a container `pnpm reap` cannot see — OPEN (T2, 2026-09-23).**
  `bench/pglite-throughput/src/bench.ts` starts a real `postgres:18-alpine` through Testcontainers and
  stamps NO label, so an interrupted run of that rig leaks a container the reaper's label filter will
  never match; `bench/sqlite-failover` is the only rig that stamps `com.waitron.reapable`
  ([ci-and-gates.md](developers/ci-and-gates.md) carries the receipt naming each rig). Either stamp
  the label in that rig or accept cleaning it by hand — but the rig's schema is three storage
  decisions out of date anyway (its own entry in Track C), so the two decisions belong together.

- **Job-sharding levers:** `--shard` splits by FILE COUNT; bump `shard: [1..N]` and the denominator
  together with N at or below the file count; rebalance `LIGHT_A/B_PACKAGES` when one light shard
  dominates.
- **A throwaway script found six comments that described code that was no longer there, and it is
  not a guard yet** (written 2026-09-14 during the tenant-column removal). It flags a comment whose
  subject has gone from the lines beneath it. It is not usable as it stands: 13 of its 19 hits
  were the legitimate shape where a block comment heads a group of members rather than describing
  the one line below it. **Next action:** rewrite it as a real root guard with an allowlist for that
  header-then-member shape, and its own tests, rather than re-running a scratch script.
- **`apps/server/src/boot.mirror.test.ts`'s adoption-pending case no longer has a negative control.**
  The case boots a mirror on an empty database and checks it serves a status surface. Its receipt
  used to be a foreign key from `persons` to `tenants` — remove the guard and the boot would die on
  it — and #378 removed every foreign key to that table, so nothing now says what
  would break if the guard went. The test's own comment says this plainly and claims nothing more.
  **Next action:** find a failure the empty database still causes without the guard, and name it;
  if there is none, say so in the comment and stop calling the case a guard test.
- *Small:* `test-light` reports success without naming what it ran; `packages/ui` can hang the `test-ui` shard, cause unconfirmed; the classifier's `root=`
  output line is read by no consumer.
- **The topic files no longer describe PostgreSQL as current — DONE (C127, #1036).**

---

## Track C — smaller items

Each fits one sitting, and none needs a spec. Correctness first, then by area. A *Small* item that
turns out to need a design moves to its track.

**While Add a printer is open, a scan that finds devices starts the next one with no pause — DONE (W5)
(found 2026-09-30 by a trial Codex review of C117's branch; on `main` since #955).** In
`packages/print-agent/src/agent.ts`, a scan pass that finishes with devices wakes the loop
(`discover`), the woken loop polls at once instead of waiting out the 2-second pause (`start`), and
that poll starts the next pass because none is running and the discovery window is still open
(`tick`). So passes run back to back for as long as the window is open, each followed by an extra
job pull. The review's test drove the real loop with a fake host whose scan returns one USB device
at once, no queued jobs, for 250 ms: it counted 195 pulls where it allows at most 2; the loop from
before #955 made one. How quickly a real scan returns on a box, for example one with only a USB
printer, has not been measured, so how often a real box repeats is not known. The running loop
starts passes at least one polling interval apart, while sending a finished pass's devices on the
next pull. A 250 ms fast-scan case checks delivery without repeat passes; a controlled-clock case
checks that an empty scan starts again at the next interval.

**Comments and docs still name drizzle-orm 0.45.2; 0.45.3 is installed — OPEN (found 2026-10-03 by
#1139's review).** #1139 updated `scripts/journal-monotonic.test.ts` and one citation in
`docs/developers/conventions-data.md`, and checked their line numbers against 0.45.3. Still naming
0.45.2: `apps/server/src/restore-fiscal-e2e.test.ts:310` and
`packages/store/src/node-sqlite-adapter.ts:34`, where the review found only the number stale; and
`packages/db/src/testing/schema-conformance.ts:226`, `docs/developers/conventions-data.md:280` and
this file (the 0.45.2 unnamed-`unique()` note in Track C), none of them re-checked against 0.45.3.
**Next action:** read each claim against the installed 0.45.3, then update the number or the claim.

**`--no-verify`: the docs say "Claude never", the hook says "agents never" — OWNER'S CALL (found
2026-10-03 by #1139's review).** `CLAUDE.md` §2 and `docs/developers/ci-and-gates.md` say "Claude
never pushes with `--no-verify`"; the hook's hint (`.husky/pre-push`) says "agents never". Codex
sometimes drives and reads `CLAUDE.md`, so the docs may need "no agent". **Next action:** the owner
decides whether the rule covers every agent, then the two docs follow.

**Comments and test titles still cite sections of specs that were deleted — OPEN (2026-09-26).**
The docs prune that day deleted every spec and plan for built work (#711 and the direct docs commits
before it). A pointer that names only a SECTION ("spec §3.2", "design §3", "(till-reroute §3.6)")
was fixed only for the last 28 documents. Find the rest with
`git grep -nE "(spec|design|plan)[^)]{0,40}§[0-9]" -- apps packages scripts bench`. Some hits point
into specs that were kept (menus, service and billing, sales classification, the SQLite topology),
so check which document each one names before cutting it. Two were left on purpose:
`packages/db/drizzle/0004_variant_one_level.sql` ("spec §1.2, §15.7"), because a shipped migration
is not edited without a venue reset (`CLAUDE.md` §3), and
`packages/fiscal-verifactu/src/write-path.e2e.test.ts` ("(spec §2)"), which could not be traced to a
deleted document. **Next action:** fold into the comment-pruning sweeps: re-point
each to the pull request that built the work, or drop the tag. A test title is not a comment, so
changing one does not pass `scripts/comments-only.mjs` as a comments-only change.

**The bookings seat picker keeps a table it no longer offers — OPEN (found 2026-09-23, writing
bookings' coverage tests, PR #503).** `packages/bookings/src/dashboard/bookings-screen.ts` stores the
picker's choice when a Seat click arms it. A throwaway browser test armed the picker on `t-1`, then
let a live refresh empty the table list: the dropdown showed no options and the value `""`, and
confirming still called `seatBooking("bk-1", { tableId: "t-1" })`. The same test found no way to
reach the `seatTableId === ""` side of `#onSeatConfirm` from the screen; that branch, and the
`?? ""` in `#onSeatClick` (after its own early return for an empty table list), are two of the
three branches bookings' coverage still leaves uncovered. **Next action:** decide what the picker
does when its tables change under it (re-pick the first, or close) and fix it test-first; the fix
may make one or both of those branches reachable, or show they can go.

**Five till handlers still leave a failed list refresh unhandled, and one a11y file may not render
its screen — OPEN (found 2026-09-25, review of PR #641).**
- `#onLoggedIn` awaits `#refreshHeldOrders()` and then `#refreshStationQueue()` outside any `try`,
  and the `logged-in` listener in `render` calls it with `void`, so a failed held-list read at login
  is an unhandled promise rejection that also skips the queue, roster and floor loads.
- `#onRetrieveOrder` and `#onDiscardOrder` await `#refreshHeldOrders()`, and `#onAdvanceTicketItem`
  and `#onMarkCollected` await `#refreshStationQueue()`, in `apps/till/src/till-app.ts`, each after
  its `try`/`catch` and outside it. A failed refresh there is an unhandled promise rejection and the
  operator sees nothing: the test "a plain list refresh that fails starts no retry, leaves a
  countdown alone, and takes over a retry in flight" in `till-app.test.ts` suppresses the rejection
  the discard handler leaves uncaught. All four refresh on both paths, after a success and after a
  failure. Retrieve differs in that it writes nothing, so an "X succeeded, but…" message does not
  fit it.
- The two older cases in `apps/till/src/till-app.a11y.test.ts` titled "…on the composed counter
  screen…" (about lines 128 and 142) do not render the screen their titles name. Their `getTill`
  returns no `canvas`, and the till enters its shell only when it has one (`#inShell`,
  `apps/till/src/till-app.ts`), so in both themes they scan the lock screen (found with a temporary
  assertion on menus Task 9's branch; not re-run on `main`).

**Next action:** decide whether discard, advance and mark-collected go through `#refreshAfterWrite`
with their own "X succeeded, but…" strings, and what login and retrieve show when their refresh
fails. Give both a11y cases' `getTill` a canvas and assert `till-counter-screen` exists before each
scan.

**Dashboard leftovers from the coverage branch — OPEN (found 2026-09-23, PR #538).** Each from
reading unless marked run:
- `wt-dialog` re-sends the native dialog's `close` event as `wt-close`
  (`packages/ui/src/components/wt-dialog.ts`), and the native event arrives a task after the dialog
  closes — the same mechanism the catalogue screen's nested forms guard against (#741). So a dialog
  reopened within that task is shut again: `wt-dialog`'s own close handler (`onClose`) sets its
  `open` to false, which closes the native dialog, and then the screen's handler clears its state.
  `staff-screen.ts` and `purchases-screen.ts` have no guard; their tests wait out the late close
  rather than guard it (`staff-screen.test.ts`, `purchases-screen.test.ts`). `profile-screen.ts`'s
  flag (`#closingModal`) protects the screen's mode but, we believe (by reading, not tested), not
  the dialog itself. `apps/dashboard/src/widgets/allergen-picker.ts` avoids the problem by mounting
  a fresh dialog for each open (`keyed`). Seen once under coverage load in a test (run); we believe
  a person cannot reopen it that fast; not tested.
- DONE (lane A's W20, #1118): the product editor's variant form
  (`apps/dashboard/src/widgets/variant-form.ts`) no longer turns the dialog's late `wt-close` into a
  Cancel once the editor has closed it; it carries the `!this.open` check the Units, Options and
  Extras forms do (C68, #863; C74, #878).
- `login-screen.ts` checks an account link's purpose with `=== null`, so a reply with no purpose at
  all would pass; the server always sends one.
- Guards no test can reach, left uncovered rather than deleted: the canvas editor's "no draft" and
  "no selected card" guards, several `?? []` and `?? null` fallbacks in the printers, payments,
  kitchen, backup, devices, printing-rules, profile, extra-list and option-list files, and a
  handful in `dashboard-app.ts` and `login-screen.ts`. **Next action:** delete them with a
  receipt each, or leave them as defensive code by decision.

**What the till shows the NEXT operator when the previous one's request answers late — CLOSED, no
change (owner decision 2026-09-23; PR #536).** The ticket belongs to the TILL, not to the operator
who started it, so a late result shown on that device after a change of operator is right; the
payment belongs to the table, so no payment is lost.

**Till code that no test can reach, and small till defects — DONE (W24, #1127; found 2026-09-23, till
coverage, PR #536).**

- `till-app.ts`: the branches that switched the screen when the shell was not showing are gone,
  with `#onShowFloor` and the app's `show-floor` listener. Every sender of those events is drawn
  only inside the tab shell; the receipt is in the commit. Sent from the lock screen, six of the
  events unlocked the till before the change; each event is now checked on a till and on a
  handheld: it stays locked, reads neither the stations nor the floor, and leaves no destination
  in the address. The counter screen keeps its own floor button, which the app never draws (it
  mounts the counter only `embedded`).
- Four more gaps, found by the branch's review and reproduced on the code before the branch, now
  closed: tab-select does nothing on a locked till; floor-refresh and move-held-order-open (now one
  handler) do nothing on it; open-table does nothing on it; new-sale no longer empties the basket
  logout keeps. A new case sends a tab-select in the same call stack as logout, before the shell is
  redrawn, and it is ignored; by reading, nothing sends one there today.
- Back-to-floor's lock check moved to its top. No test tells the two positions apart: moving it
  back failed nothing.
- Show-station, show-expo, show-schedule, open-allergens and back-to-counter no longer clear the
  lock screen's message (found by a re-read; a new case per event, on a till and on a handheld,
  failed on these five before the fix).
- `#showTicket` now always opens the ticket overlay (a tab payment answered after logout reaches
  it; the next sign-in clears it, pinned by a new case). Opening a table now checks for the shell
  first; before that, sent from the lock screen it seated a free table and read the stations (run
  in review). Its inner shell check stays; by reading, no path reaches its other side now (not
  run). The shell's `.tabs` reads a narrowed local instead of `?? []`.
- Removed as unreachable: the check that the timeout handle is set before `clearTimeout` in
  `trust-check.ts`, the "active" check in `session-activity.ts`'s `#shouldHoldWakeLock`, the
  kitchen-display return in the station screen's `#selectStation`, and the no-next-step return in
  the station queue's `#bump`. Left by decision: `session-activity.ts`'s default `onIdle`, a
  placeholder the type needs that is never called (the default configuration is logged out, and
  the idle timer runs only when logged in).
- `api/server-router.ts` no longer copies a server's `nodeId` into its private list.
- `deviceKindLabel` looks kinds up in a `Map`, so `constructor`, `toString` and `__proto__` come
  back as themselves.
- Two wake-lock tests are renamed to what they test. In `apps/till/src/session-activity.test.ts`,
  "starts and stops cleanly on the browser's own Wake Lock API when none is injected"; the truly
  absent case is that file's existing "no navigator" test. In `apps/till/src/till-app.test.ts`,
  "session activity: with no injected controller, a logout still reaches the lock screen". The two
  live-floor titles now say they select the floor tab.

**Two more till lookups read inherited object properties — OPEN (found by W24's review,
2026-10-03, by reading, not run).** Both look a string key up in a plain object, so a key such as
`constructor` finds an inherited property — the defect `deviceKindLabel` had.

- `allergenName` (`apps/till/src/i18n/allergen-names.ts:30`) finds `Object` for `constructor`, so
  it returns `undefined` instead of the code itself.
- The station dialog's refusal (`apps/till/src/widgets/station-choice-dialog.ts:74`) finds
  `Object` in `moveRefusals` for a `constructor` code, so it passes that to `t` and shows an empty
  alert instead of the code's own message (by reading).

**Next action:** look both keys up on own properties only (`Object.hasOwn`, as
`apps/till/src/i18n/codes.ts` does), with a test each.

**The till's idle-timer check may be unreachable — OPEN (found by W24's review, 2026-10-03, by
reading, not run).** `session-activity.ts`'s `#shouldRunIdleTimer` keeps the `this.#active &&` check
that `#shouldHoldWakeLock` lost, and its callers look the same. **Next action:** remove the check
with a receipt, as W24 did for `#shouldHoldWakeLock`, or keep it by decision.

**The email-change form calls an empty code field an "authentication code" — DONE (W12, #1114; found by
C61's review, #859, 2026-09-29).** In the Profile screen's email mode a blank confirmation code now
shows `profile.email_code_required` ("Enter the code from your email" / "Introduce el código de tu
correo"); the authenticator-app setup keeps `profile.code_required`
(`apps/dashboard/src/screens/profile-screen.ts`, the form's own validation).

**The tunnel's stand-in relay pairs with sockets that have already gone — OPEN (found 2026-09-23,
writing tunnel's coverage tests, PR #506).** `packages/tunnel/src/testing/relay.ts` is test-only:
nothing outside `packages/tunnel`'s own suites imports it, and Waitron ships no relay. When a parked
box closes, it stays in `idle` until a client takes it, so the next client is paired with the dead
box and its bytes go nowhere (both reviewers of that branch ran this). When a waiting client closes,
it stays in `waiters` until its wait window (`waitForBoxMs`) runs out, so a box registering inside
that window is sent `go` and paired with the dead client. Three tests in `relay.test.ts` pass anyway
because they check only the next `ack`: the two reset cases say so, and the older "drops an idle box
that sends garbage after registering, and keeps serving" claims more than it checks. **Next
action:** only if `@waitron/tunnel` outlives its planned retirement (see *Waitron retains* below) —
drop the entry on close, test-first (a live client after the reset is paired with a live box), and
narrow or extend that older test.

**Three shapes the read connection does not cover — OPEN (stated 2026-09-23, task N3, PR #493).** A
transaction opened by RUNNING `begin` as an ordinary statement is not one the store is told about —
Drizzle's own migrator opens one that way — so a read concurrent with it still lands on the writer.
A write issued from outside a running body while one is open is re-run on the writer, where it joins
that transaction if it is still open and commits or rolls back with it, which is what one connection
did; in the moment after the queue's `commit` and before the body has ended, none is open and the
write commits by itself. Nothing refuses it. And `readOnly: true` refuses a write to the database
FILE, not every write: measured 2026-09-23 on Node v26.7.0, `create temp table` SUCCEEDS on such a
connection, so a temporary table written from outside a running body would land on the reader and
stay there — and the same holds for an `ATTACH` of a file that exists (one of a missing file is
refused, errcode 14 — measured by #568) and for any connection-scoped pragma, because all three
change a CONNECTION rather than the file, so nothing refuses them and nothing routes them back. A
temporary table and an `ATTACH` have no site in this tree (searched 2026-09-23). The two
connection-scoped pragmas that run on a request path, both `pragma defer_foreign_keys = on`, are
each issued INSIDE a running transaction body, which is exactly where the routing sends a statement
to the writer: `apps/server/src/configuration-transfer.ts`'s import issues it inside the
provisioning transaction's body, and `writeAndRemoveDecoyAction`
(`packages/identity/src/account-action.ts`) inside `issueRecovery`'s `withTransaction` body
(`apps/server/src/management-api.ts`); the others are test setup issued outside any body, where the
reader would serve them if a body happened to be running, and none of those suites runs one.
**Next action:** none needed while that holds; a temporary table, an attachment or a connection
pragma issued from OUTSIDE a running body has to be put on the writer deliberately, and a guard for
that does not exist. Also left by #493's review: the case pinning the adapter half of the window fix
lives in `packages/store/src/index.test.ts`, not beside the file it reverts
(`packages/store/src/node-sqlite-adapter.ts`).

**The media library still reads every matching image for search and name sorting, inside the venue
write lock — OPEN (found 2026-09-23, task F1's review wave).** The unsearched date sort counts,
orders and pages in SQL, reading only the page's metadata. Search still scores and pages in
JavaScript, and name sorting still uses `Intl.Collator` for accented names.
`listImageTranslationGaps` still reads all rows of its selected columns. The route
(`GET /management-api/images`) uses `withTransaction`, the venue's exclusive write lock, so these
remaining scans can delay a sale. **Next action:** decide how far to push search ranking into SQL;
measure a way to bound name sorting without changing its results.

**Cash handed back for a voided cash sale is recorded nowhere — OPEN (found 2026-09-24 by #605).**
A void writes no payment or refund row, so if staff give a customer cash back, the void's day shows
a drawer shortfall at cash-up. No till screen or server route calls `recordVoid` yet, so nothing
can do this today. **Owner decision 2026-09-25:** keep it here and decide it when the till's void
screen is designed.

**Every read route now takes the venue's exclusive write lock and issues a DELETE — OPEN (found
2026-09-23, task F1's review wave).** `withTransaction` (`packages/db/src/tenancy.ts`) runs its body
inside `withWriteLock` and then drains `change_log` unconditionally, which is a `delete … returning`.
Plain GETs are among its callers — box status, the unauthenticated content-languages route, and two
management reads. The single writer is the engine's and is not removable. The unconditional DELETE
on a read-only body is: `node:sqlite` exposes a change counter. But it interacts with a documented
behaviour — the drain deliberately collects the rows an orphaned writer left — so this is a design
decision, not a cleanup. **Next action:** decide whether a read-only body should take the lock at
all.

**Three copies of one SQL identifier validator and two cause-chain walkers — OPEN (found
2026-09-23, task F1's review wave).** W8 replaced the probes in
`packages/db/src/deployment.ts`, `packages/db/src/node-membership.ts`,
`packages/db/src/mirror-config.ts`, `packages/migrations/src/schema-version.ts`,
`packages/migrations/src/journal-hashes.ts` and `packages/catalogue/src/categories.ts` with
`@waitron/db`'s `tableExists`. `apps/server/src/restore-stream.ts` still has a one-table probe;
`apps/server/scripts/dev-setup.ts` checks two table names in one query. The identifier validator is in
`packages/db/src/testing/identifiers.ts`, `packages/db/src/change-feed.ts` and
`packages/store/src/append-only.ts` — the first two are in the SAME package. The cause-chain walk is
in `packages/shared/src/engine-failure.ts` and again in `packages/db/src/constraint-target.ts`, and
that one is a regression: `unique-violation.ts` used to import the shared walker and now uses the
local copy, leaving `firstCodeInCauseChain` with no product caller at all. **Next action:** export
one validator from `@waitron/shared`; `packages/store` depends on nothing today, and
`@waitron/shared` depends on nothing either, so that edge closes no loop.

**`resolveEnvironment` and `deploymentEnvironment` are two hand-maintained copies of one four-branch
table — OPEN (found 2026-09-23, task F1's review wave).** `packages/provisioning/src/environment.ts`
and `apps/server/src/config.ts`. They agree today, checked line for line. The stated reason — a
package cannot import an app — is true and skips the third option: `@waitron/db` already owns the
`DeploymentEnvironment` type and both sides depend on it. Nothing in the tree runs both over one
input. This decides whether a box files against the real AEAT or the test one (`CLAUDE.md` §5), so
two copies held together by hand is the wrong shape for it.

**`packages/migrations` opened its own raw `node:sqlite` connection — DONE (W45).** `apply.ts`
now takes its `migrations.lock` through `@waitron/store`'s `openLock(path, waitMs)`, which sets the
busy timeout before trying the lock. `apply.concurrency.test.ts` checks the two-process migration
order and `packages/store/src/migration-lock.test.ts` checks refusal and release. The earlier claim
that this was the only non-test raw engine import outside `packages/store` was too broad: a 2026-10-03
search of non-test files under `apps/` and `packages/` also found `apps/server/src/recovery-lock.ts` and
`apps/server/scripts/cloud-backup-fixture.ts`. Their uses are outside W45's scope. **Next action:**
review each remaining raw connection separately before deciding whether a shared store API fits.

**Files that still spell the store's file names themselves (left by #757, which exported them
from `@waitron/store`).** Outside test files and `bench/`: `apps/server/src/cloud-snapshot-archive.ts`
(a staging file outside the venue folder), `packages/stream/src/litestream.ts` and
`packages/stream/src/restore.ts` (`@waitron/stream` does not depend on the store),
`deploy/waitron.sh` (a `node -e` snippet run in the app image, whose `/app/node_modules` holds only
sharp), the fixture scripts `apps/server/scripts/cloud-backup-fixture.ts` and
`apps/server/scripts/cloud-recovery-client-fixture.ts`, and the store's own
`packages/store/src/connections.ts`, which builds the `-wal` path itself; `WAL_SUFFIX` lives in
`index.ts`, which imports `connections.ts`, so using it there means moving the names into a module
of their own. #757's checks do not cover `migrations.lock`, Litestream's `.venue.db-litestream/`
folder, or the restore's `venue.db.incoming` file and `.venue.db-replaced-*` folder.

**Two leftovers of the restrict/trigger refusal split (#731).** `isRefusal` with
`RESTRICT_VIOLATION` or `TRIGGER_ABORT` still reads the number alone and both stay exported (the
`CLAUDE.md` §3 rule, unguarded, is what stands against a new caller); and the four near-identical
word-matching checks in `packages/db/src/constraint-target.ts` could share one private helper.

**A person row written from outside `packages/identity` still folds its key ASCII-only — OPEN
(found 2026-09-23, task F1's review wave).** SQLite's `lower()` folds ASCII and nothing else, so the
three unique indexes on `persons` stopped refusing two staff whose names differ only in the case of
an accented letter — José García beside JOSÉ GARCÍA, on a Spanish product. The repair stores a
folded key in its own column (`packages/identity/src/fold.ts`: trim, NFC, lower, NFC) and each
index reads `case when <folded> is null then lower(<raw>) else <folded> end`. **The `case` is why
this entry exists:** a bare index on the folded column alone would put every row that did not carry
one OUTSIDE the uniqueness check, which is worse than the defect. The two real paths that create a
person are routed — `packages/provisioning/src/venue-apply.ts`'s admin insert and
`apps/server/src/mirror-session.ts` both call the exported `foldForUniqueness`. **What is left
open:** every remaining writer outside `packages/identity` is a fixture or a seed, each still
folding ASCII-only, and the column is still nullable, so nothing at the compiler stops a new writer
forgetting it. **Next action:** decide whether the column becomes mandatory — which breaks every
fixture at the compiler rather than silently — or whether a guard over the write sites is enough.

**The shard layout was measured against an engine that is gone — OPEN (found 2026-09-23, task F1's
review wave).** The shard counts and their sizing arguments were all measured against PGlite and
none has been re-measured — `mutation.yml`'s ten-shard matrix for `packages/db` most of all, whose
comment says so explicitly. Read the next weekly run's shard durations before treating any of them
as current. No local command produces the numbers, so re-cutting the matrix has to wait for a real
weekly run.

**An append-only trigger can be dropped, or quietly replaced, from the application's own database
handle — OPEN (found 2026-09-22, task F1).** SQLite has no roles, so only the trigger protects an
append-only table — every connection is the owner-equivalent, and a `DROP TRIGGER` on the
application's own handle succeeds (recorded in `packages/db/src/immutability.test.ts`'s header).
Data mutations are still refused while the triggers are in place, so this is defence in depth rather
than a live hole.

**The defence to build:** at boot, and then on a repeating check while the box runs, read
`sqlite_master` and refuse to trade if any append-only trigger that should be there is missing, or
its stored text is not the text `installAppendOnlyTriggers` writes
(`packages/store/src/append-only.ts`). The set to compare against is already known — the tables a
module declared with `appendOnly()`, carried set by set as `MigrationSet.appendOnlyTables`.
**Re-installing the triggers is not that check** (measured 2026-09-22 on `node:sqlite`): the
installer writes `create trigger if not exists`, so a trigger that was simply DROPPED is put back by
the next migrating path, but one dropped and re-created under the SAME NAME with a permissive body is
not. For whoever writes the comparison: SQLite stores a trigger with `IF NOT EXISTS` removed and
`CREATE TRIGGER` upper-cased, so the stored text is not byte-identical to the string the installer
sent.

**Waitron carries two QR encoders; consolidate on `qrcode-generator` — Small.** `apps/server` imports
`qrcode` (in `qr-matrix.ts`, `print-job-preview.ts`, `discovery-api.ts`) while `apps/till` uses
`qrcode-generator` (`qr.ts`). The server's three call sites use only `.create()` (the module matrix)
and `.toString({ type: "svg" })` — no PNG — so `qrcode`'s `pngjs` is never exercised and its `yargs`
(pulled only because `qrcode` ships a CLI bin) is dead weight. `qrcode-generator` is isomorphic,
**zero-dependency**, and covers both the matrix (`getModuleCount()`/`isDark()`) and the SVG case.
Switch the three server sites over and drop `qrcode`; hoist the receipt's hand-ported
money/date/label formatters into `packages/shared` too (the paper receipt already drifts from the
screen by an NBSP normalisation). **The gate before landing:** `print-job-preview.ts` reconstructs a
QR from stored raw `latin1` bytes through `qrcode`'s byte-mode segment API; `qrcode-generator` has a
`'Byte'` mode, but this path must produce a byte-identical, still-scannable QR — these are fiscal
receipt QRs AEAT's own app must verify — so it needs a render→decode check and a real scan, not
just a green typecheck.

**A supplier credit note cannot be entered through the dashboard — OPEN, unqueued.** A negative
gross total on the purchase-invoice routes is a supplier credit note and is accepted and stored by
design (owner ruling 2026-09-21; task N1). The dashboard form's `inRange(this.total, 0, Infinity)`
(`apps/dashboard/src/widgets/purchase-form.ts`) refuses one, so the form refuses the very document
the ruling calls legitimate. Nobody has decided whether the form should be relaxed or the credit
note should become its own document type.

**A negative catalogue price can still be stored by a direct call — OPEN (left by #487).** A
negative catalogue price is never valid (owner ruling 2026-09-21); the four catalogue writes in
`apps/server/src/catalogue-api.ts` refuse one at the request boundary. `createProduct` and
`updateProduct` (`packages/catalogue/src/operations.ts`) still accept and store a negative when
called directly — a seed, a script or a future caller — and `products.unit_price` carries no
`>= 0` check. Decide whether the screen belongs in the ops or as a `products.unit_price >= 0` check
beside the sibling price checks the other catalogue tables carry; the column is an integer count of
cents, so a check constraint is now the only thing that would refuse it at the database.

**Two price rules disagree about a value that is not negative — OPEN (found 2026-09-21, task N4).**
`isProductPrice` (`packages/catalogue/src/modifier-limits.ts:12`) allows at most two decimal places
and ten whole digits; `stringToCents` (the `decimal()` + `decimalToCents` pair) that the four
screened catalogue writes use allows any number of decimals and twelve whole digits, and ROUNDS the
excess. So `POST /management-api/products` with `unitPrice: "1.999"` stores `2.00` without saying
so, while the product-editor route refuses the same value with `product.invalid`; an eleven-digit
price splits the same way, and `-0.00` is accepted by one and refused by the other. Widening the
four routes to `isProductPrice` would start refusing values that save today. **Next action:** decide
whether one rule should govern every catalogue price, and if so which — and check each dashboard
form against it before changing the server, since a server stricter than its own form is the
failure #485 met.

**The PGlite throughput bench no longer matches the shape it says it matches — OPEN (found
2026-09-21, task P6).** `bench/pglite-throughput/src/bench.ts:18` calls itself "a faithful SHAPE
match" of the write path, and its `create table` statements are three landed storage decisions
behind: `numeric` money and quantity columns where the real columns are now whole-number counts
(#475 and task P6), and a `tenant_id` column the real schema no longer has. Either bring the three
decisions across and re-baseline, or change the sentence to say what it is.

**Left behind by the TypeScript 7 upgrade (#460, 2026-09-20).**

- **Collapse the two TypeScript entries back into one, once typescript-eslint supports version 7.**
  Packages run `tsc` at 7; the repository root resolves the name `typescript` to
  `npm:@typescript/typescript6` so typescript-eslint keeps the version 6 API it still reads.
  typescript-eslint tracks the work in its issue 10940, and the message it prints today names
  version **7.1** as the target. When a release supports it, the root entry goes back to a plain
  `^7` range and the alias disappears. `scripts/comments-only.mjs`,
  `scripts/apply-migrations-callers.test.ts`, `scripts/pinned-actions-column.test.ts` and
  `scripts/native-form-fields.test.ts` parse with
  the version 6 API (`ts.createSourceFile`), so they have to be ported, or the alias kept for them,
  before that move. The arrangement is in [ci-and-gates.md](developers/ci-and-gates.md) → *Two
  TypeScript compilers are installed, and that is deliberate*.
- **`apps/server` → `apps/print-agent` is the first app-to-app workspace edge in the tree.** #460
  declared `@waitron/print-agent-app` as a test-only dependency of `apps/server` (for
  `apps/server/src/print-agent-e2e.test.ts`) and exported `./tcp-probe.js`. Moving `tcp-probe.ts`
  alone into `packages/print-agent` was consciously not taken: it belongs to a cohort of six
  device-discovery modules in the app (`ipp-probe.ts`, `bluetooth.ts`, `usb.ts`,
  `linux-devices.ts`, `network.ts`, `sweep.ts`), and moving one would leave its siblings importing
  back across the boundary. Moving the WHOLE cohort would settle it, and that is a print agent
  layering decision. Until then no guard stops a second app-to-app edge:
  `scripts/workspace-cycles.test.ts` looks only for loops, and `eslint.config.js`'s
  `no-restricted-paths` zones name `packages/*` as targets, never `apps/*`.

**Left behind by gating `packages/db`'s mutation score (#472, 2026-09-20).** **The gate never runs
on a pull request, so thinning a `packages/db` test merges green.** `.github/workflows/mutation.yml`
fires on a weekly schedule and on `workflow_dispatch` only, and `mutation-db-aggregate` lives in it,
so a change that removes an assertion the score depended on reddens the following Monday. The ten db
shards took about 50 minutes of wall clock, which is why nobody has put them on the merge path.
Either accept the weekly lag and say so where a reader meets the gate, or find a cheaper
per-pull-request signal.

**Left behind by raising the `packages/ui` mutation score (#466, 2026-09-20).**
**`packages/ui/src/vitest-park-pointer.ts` is mutated and has no tests.** It is test-only plumbing
the Vitest config loads — the same class as `src/test-helpers.ts`, `src/a11y-helpers.ts` and
`src/tokens/token-test-helpers.ts`, which `packages/ui/stryker.config.json` already excludes from
`mutate`. Adding a fourth exclusion is the consistent move and also shrinks the denominator the
`break: 90` is measured against. Owner's call.

**Left behind by the Stryker upgrade (#447, 2026-09-19).**

- **A Vitest 5 retry has to re-measure mutation — nothing about Stryker 10 settles it.** Vitest 5 was
  abandoned because Stryker 9.6.1 kills almost nothing under it: `packages/fiscal` scored 0.00% and
  `packages/shared` 8.14% (stryker-js#6210). Stryker 10.0.0's release notes mention neither issue,
  and nothing here was run under Vitest 5, so the question is untouched rather than resolved. A
  retry must also check whether #766's stored Dependabot ignore of `@vitest/browser-playwright` 5.x
  holds that package back, and clear it if so (`docs/developers/workflow-guide.md` → Dependabot pull
  requests).

**Left behind by the dependency refresh (#432, 2026-09-19).**

- **Whether a declared floor follows the installed version is undecided — one decision for every
  manifest.** #432 raised five low floors (`hono`, `pg`, `playwright`, `@types/pg`,
  `@aws-sdk/client-s3`) so that every package declared one identical range; no commit or doc
  explains why those floors were low, so this was a judgement, not a rule being followed. The vite 8
  and passkey upgrades below left the same shape (`^8.0.0` against 8.3.0 installed; `^14.0.0` below
  14.0.2 in two manifests). Dependabot's npm updates set no `versioning-strategy`; its first npm PR,
  #765, raised the floor of each caret range it changed to the new version and kept each manifest's own form (an
  exact pin stayed exact), so it did not restore #432's one-range shape where that had lapsed:
  `@aws-sdk/client-s3` is exact in `apps/server` and a caret range in `packages/stream` and
  `bench/sqlite-failover`. The answer goes in `versioning-strategy` in `.github/dependabot.yml`.

**Left behind by the esbuild upgrade (#439, 2026-09-19).**

- **One esbuild copy older than ours stays in the tree: `drizzle-kit`'s own range holds it** at
  0.25.12; since A107 a root `pnpm.overrides` entry moves `@esbuild-kit/core-utils`' copy onto the
  same 0.25.12. An install that re-resolves the lockfile still warns that the `@esbuild-kit`
  packages are deprecated.
- **A bundler bump is checked by comparing the built bundles, by hand.** The test suites run against
  TypeScript source and cannot see a bundler change, and CI's `bundle-smoke` job would catch a
  bundle that no longer boots, not one whose contents quietly changed shape. The method: build,
  stash the outputs, bump, rebuild, `cmp` each pair, and account for every difference class. It does
  not survive a bundler REPLACEMENT; what replaced it for vite 8 is below.

**Left behind by the Node types upgrade (#441, 2026-09-19).**

- **`apps/dashboard` type-checks against two `@types/node` majors at once.** `@types/qrcode`
  (declared in `apps/dashboard` and `apps/server`) references the Node types with its own range
  `"*"`, and the lockfile leaves it on 24.x while everything else is on 26. Nothing complains
  because `skipLibCheck` is on (`tsconfig.base.json`); with `--skipLibCheck false` that program
  reports a duplicate `NonSharedBuffer` identifier. The fix is a pnpm resolution override, which is
  a policy decision, so it was left for the owner. (`@types/ssh2` also holds 18.x, but it asks for
  `"^18.11.18"` and no 26 release satisfies it.)
- **The root `package.json` says `"engines": { "node": ">=24" }` while `.nvmrc` says 26.** One line
  either way; it needs an owner call on whether Node 24 is still supported.

**Left behind by the Hono Node adapter upgrade (#444, 2026-09-19).** `apps/server` and
`apps/print-agent` moved from `@hono/node-server` 1.19.15 to 2.1.1. Two things it leaves open:

- **Only the request side of that adapter was compared between the two versions.** Version 2 also
  changed response code — `Response` fast paths, null-body handling, a close handler for
  `Blob`/`ReadableStream` responses, and `Response.json()`/`Response.redirect()` — and nothing
  compared a response BODY or its headers across the two. The suites pass, so nothing is known to
  be broken. Re-running the comparison needs a scratch install of 1.19.15.
- **`apps/server/src/tls.ts`'s type guarantee is still untested.** It derives its options type from
  the installed package (`Parameters<typeof serve>[0]`) so that an incompatible reshape fails
  `tsc`; this upgrade did not exercise that, because the type was otherwise identical across the two
  versions.

**Left behind by the vite 8 upgrade (#450, 2026-09-19).** `apps/dashboard`, `apps/setup`,
`apps/till` and `packages/ui` moved to vite 8, which swaps the bundler and the transformer (Rolldown
and Oxc for Rollup and esbuild). What replaced the byte comparison: build both, then run the
SHIPPED bundles and compare what they produce.

- **A pull request that changes only front-end code gets no SPA bundle built anywhere in CI.**
  `bundle-smoke` builds esbuild bundles only. The only thing that runs `vite build` is
  `deploy/Dockerfile`, which the `image` job runs — on a pull request only when an image input has
  changed (`.github/workflows/ci.yml`, the `image` job's `if`), and on every main push; it never
  OPENS one, so a bundle that builds and renders nothing passes there too. This is the work item
  `CLAUDE.md` §2 and `docs/developers/ci-and-gates.md` point at.
- **The default browser floor rose, and no BROWSER floor is stated anywhere in the repo.** Nothing
  sets a `build.target` and there is no `browserslist`, so the SPAs take vite's default: on 8.3.0
  `["chrome111","edge111","firefox114","safari16.4","ios16.4"]`, where 6.4.3 gave
  `["es2020","edge88","firefox78","chrome87","safari14"]`. A `browserslist` field would not fix this
  (measured against vite 8.3.0: it leaves the resolved target at the default, while
  `build: { target: … }` sets it). Nothing is known to break, and the devices are bought new — but
  the hardware track's own stated floors do NOT establish that, and one of them cuts the other way:
  Screen Wake Lock's iOS Safari 16.4
  (`docs/superpowers/specs/2026-09-08-handheld-app-store-and-kiosk-findings.md`) sits exactly ON
  the new floor, and Web NFC's Chrome for Android 89
  (`docs/superpowers/specs/2026-09-18-handheld-and-till-hardware-decisions.md`) is twenty-two majors
  BELOW the new chrome111. What is missing is anywhere that states a browser floor, so the next
  bump moves it again silently.
- **The browser-mode packages that declare no vite follow the others' by deduplication, not by a
  declaration.** `packages/adjustments`, `bookings`, `media`, `payments-stripe`, `payments-sumup`
  and `venue-service` resolve vite because vitest declares it as a required peer spanning three
  majors and pnpm deduped onto the one the declaring manifests choose. If a future change puts a
  second vite in the tree, they could land on a different one silently.
- **A dependency-optimizer receipt taken on vite 6 was not re-measured.** The `vitest.config.ts` of
  `apps/dashboard`, `apps/setup`, `apps/till` and `packages/ui` each carry an
  `optimizeDeps.include` list; only `apps/setup`'s comment still quotes Vite's warning — "Vite
  unexpectedly reloaded a test" — as the flake it fixes. Vite 8's migration guide says Rolldown "is
  now used for dependency optimization instead of esbuild". Nobody re-checked that vite 8 still emits
  that warning, or that the `include` lists are still the fix.

**Left behind by the AEAT XML parser upgrade (fast-xml-parser 4 -> 5, 2026-09-20).** Version 5 no
longer decodes numeric character references: `&#38;` and the references for the other four
XML-reserved characters arrive as their own source text, and a reference to a character XML 1.0
forbids is removed entirely. Named forms (`&amp;` and the rest) still decode, and `escape.ts` writes
nothing but named forms. The upgrade shipped WITHOUT compensating for it, on this argument: every
parsed AEAT value that is matched against one of ours is a value WE minted and AEAT echoed —
`RefExterna` (a UUID), `NumSerieFactura` (emitted only from `NUMSERIE_PATTERN`'s charset) and
`Huella` (hex) — and none of those characters is ever entity-encoded. **The limit of that receipt:
nothing validates a value on the way back IN** — `NUMSERIE_PATTERN` runs only on the outgoing
record — so it is an assumption about AEAT's serialiser, not an invariant this code enforces. If it
is ever in doubt, validating the parsed values on arrival is the cheap fix. `htmlEntities: true` was
tried and reverted: it decodes 35 named entities XML does not define and turns `&nbsp;` and `&#160;`
into U+00A0 where 4.5.7 gave U+0020. Exact XML semantics would need version 5's `entityDecoder`
hook, which is bespoke code on a fiscal path and a decision rather than a bump.

**Left behind by the till QR library upgrade (qrcode-generator 1 -> 2, 2026-09-20).**

- **The till's QR pin compares the code against itself, not an authority.** `qrSvg`'s one product
  call site is the on-screen ticket (`apps/till/src/screens/till-ticket-view.ts`); the PRINTED QR's
  test reads the error-correction level back out of the format-information bits (`formatInfoLevel`
  in `apps/server/src/qr-matrix.test.ts`) with negative controls, which asserts what art. 21.1
  mandates. Giving the till the same reader needs a matrix accessor as well (`qrSvg` returns a
  string, never the library's `qr` object) and a module-boundary decision about where the helper
  lives.
- **There is no snapshot file anywhere in the repository**, so the till's byte pin is a SHA-256 of
  the output. A file snapshot would fail with a readable diff; whether this repo wants snapshot
  files at all is an owner decision.

**`node-forge` has a high-severity security alert with no fixed version — OPEN (Dependabot alert
#20, 2026-10-01).** Every version up to 1.4.0, the one in the lockfile, accepts some RSA signatures
it should reject when checking them. It is a direct dependency of `packages/server-kit`,
`apps/server` and `apps/print-agent`. From reading the code on 2026-10-02 (nothing run), product
code only creates and signs certificates and certificate requests with it
(`packages/server-kit/src/certificate.ts`, `apps/server/src/self-signed-cert.ts`,
`apps/server/src/cloud-remote.ts`); it checks signatures with it only in tests. **Next action:**
bump it when a fixed version is published, and run the certificate suites in those three packages.
The two `@grpc/grpc-js` alerts raised the same day were closed by #1028.

**Left behind by the passkey library upgrade (#453, 2026-09-19).** `@simplewebauthn/server` and
`@simplewebauthn/browser` moved to 14.

- **Whether the vulnerability the upgrade fixes is reachable in this product is open.** 14.0.2's
  release note describes it as "Revamped certificate revocation logic to only cryptographically
  verify and process CRLs from certificates that chained back to an RP-chosen trust anchor"
  (GHSA-2g3p-m8c9-hhwh; the release note is the only source). We ask for `attestation: "none"` and
  never call `MetadataService`, but the attestation FORMAT is chosen by the RESPONSE: the verifier
  dispatches on the `fmt` inside the client-supplied attestation object, and the `apple` and
  `android-key` formats carry the library's own built-in trust anchors, which is what makes
  `validateCertificatePath` — the only caller of `isCertRevoked` — do work. The cheap evidence leans
  towards reachable rather than away.
- **The version-14 browser helpers are unused.** Whether `browserSupportsPasskeys()` would improve
  the login screen's `browserSupportsWebAuthnAutofill()` gate has not been assessed.
- **`verifyAuthenticationResponse` has no algorithm list to pin** (it verifies against the stored
  public key and takes no such parameter); the asymmetry with the registration ceremony looks like
  an oversight and is not.

**Correctness:**

1. **Four order paths read `working_orders` by id alone, with nothing narrowing them to the caller's
   location.** The TENANT half is retired — there is no tenant column (`CLAUDE.md` §3) — but the
   location half is open and is NOT covered by item 2, which names a different set of verbs. All
   four are in `apps/server/src/working-order.ts`: `handOver`, which `POST /api/orders/:id/collect`
   reaches through `handOverOrder`, selects and updates on `eq(workingOrders.id, id)`, using its
   `TillConfig` only to read a placed order's service mode, through `findOrderServiceContext`, which
   filters by `cfg.locationId`; without a stored context, the handover check uses the unscoped
   `prepay` default;
   `cancelPlacedOrder` selects and updates the same way and uses `cfg` only to stamp the amendment's
   till and node and, for an order whose invoice was issued, to give the credit note its node and
   series (its till is the requesting device's); `readLockedLines` takes no `cfg` at all, nor does `priceStoredOrder`, which calls
   it to rebuild a filed ticket, nor `priceStoredOrderForIssuance`, which the filing sites in
   `till-sale.ts` and `working-order.ts` call.
2. **Location-scope the by-id verb family together** (`getHeldOrder`/`getPlacedCounterOrder`/
   `updateHeldOrder`/`abandonHeldOrder`, `updateTable`/`deactivateTable`/`openTab`) when multi-location lands —
   together with the four paths in item 1, which are the same problem in the same file.
3. **Nothing stops two queries being started at once on one transaction.** The rule and its receipt
   are in `docs/developers/conventions-data.md` under "Multi-table writes share ONE transaction"; no
   test or lint rule enforces it. A guard could fail a test whenever a query is issued on a
   transaction while another is still running.

**Names left behind by the tenant-column removal (#378, 2026-09-16):**

- **These index and key names still read `tenant`, and the columns they name are gone:**
  `canvases_tenant_name_key`, `print_agents_tenant_node_key`,
  `purchase_invoices_tenant_received_idx`, `sales_tenant_issued_idx`,
  `table_service_statuses_tenant_label_key`, `working_orders_tenant_status_idx`, `registros_tenant_node_secuencia_uq`, and four in identity:
  `persons_tenant_email_uq`, `persons_tenant_live_display_name_uq`,
  `persons_tenant_pending_email_uq` and `persons_tenant_google_subject_uq`. (The `tenants*`,
  `tenant_themes*`, `tenant_receipts*` and `tenant_credentials*` names are correct and stay.) This is
  its own slice, not a tidy-up: THREE of the four `persons_*` names are matched BY NAME in production
  error translation — `persons_tenant_email_uq` (`packages/identity/src/staff.ts` and
  `account-action.ts`), `persons_tenant_live_display_name_uq` and `persons_tenant_pending_email_uq`
  (`staff.ts`) — so renaming them changes behaviour and wants its own failing tests first.
- **Decide whether to implement `sale.number_reused`.** It was added in `10b16fd57` for a
  translation of the invoice-number unique-index violation that was never written. Decide whether
  that translation is still wanted before deleting the code (A77 kept it pending this).
- **`server.credential_unusable` names an unusable credential, although `server.*` is reserved for
  facts about the process itself.** It is thrown for AEAT's certificate
  (`packages/fiscal-verifactu/src/aeat-transport.ts`), for Stripe's secret key and webhook secret
  (`apps/server/src/stripe-account.ts`, `apps/server/src/webhook.ts`), and for the email and
  machine-key credentials (`credentialField`, `apps/server/src/credentials.ts`); both
  `packages/fiscal-verifactu/src/errors.ts` and `apps/server/src/errors.ts` declare it. **Next
  action:** choose a prefix (`credentials.missing` is the nearest sibling) and rename it in one
  change, checking the prefix matchers `docs/developers/conventions-data.md` lists.
- **The Stripe webhook endpoint still has to be repointed by hand, at Stripe.** #378 shortened the
  address from `/webhooks/stripe/<an id>` to `/webhooks/stripe`; the endpoint registered in the
  Stripe dashboard is outside this repository and will keep sending to the old one until somebody
  changes it there. **Next action:** change it in the Stripe dashboard before any card payment is
  taken through a Stripe webhook.
- **`DrainResult.tenantsWithWork` is named for a count that can now only be 0 or 1.** The field
  reaches `apps/server`'s awaiting-certificate flag (`apps/server/src/pass.ts`, which keys off
  `> 0`) and `fiscal-none`. A rename would want to keep that "did this pass attempt work?" meaning
  rather than flatten it to a boolean, since the flag deliberately distinguishes a no-work pass from
  a pass that exercised the certificate and skipped.

**The development stack:**

- **A stale dev database is only reported AFTER the boot dies, never before it** (#343). A pre-flight
  check was offered and deliberately not built (owner chose the message and the documentation
  instead, 2026-09-13): compare each set's applied rows against its journal entry count
  (`packages/migrations/migrations.manifest.json` gives the set-to-table mapping) and warn before
  launching. Worth doing only if the after-the-fact line turns out not to be enough.
- **The hint's cover stops at the migration run, and provisioning runs after it** (#343). A module's
  provisioning seat (`packages/catalogue/src/provisioning.ts` seeds units) executes once migrations
  succeed, outside `withDevMigrationHint`, so a seeding failure there on a stale database gets no
  curated line. Nobody has hit this.
- **The hint cannot fire for an ahead-of-image database** (`provisioning.database_ahead`), by
  design: its operator text never suggests wiping — the remedy there is restore or reinstall (owner
  decision 2026-09-10).

**Dashboard, till and setup:**

- **One word for "switched off, kept for the record" across the dashboard — done by W110
  (#1255); what each point leaves open is said under it.** The owner's rule (2026-10-05): a record switched off but kept
  says **Disable / Deshabilitar**, comes back with **Enable / Habilitar**, and reads **Active** or
  **Disabled** (Deshabilitado or Deshabilitada, agreeing with the noun); **Delete / Eliminar** only
  for a real delete. W110 moved products, variants, options and extras lists, departments, zones,
  stations, floor tables, table statuses, adjustment reasons, users and card readers onto it (W105a,
  #1244, and W105b had done printers, print agents and devices), renaming the string keys that no
  longer said what they show; the rule is in `docs/developers/design-system.md`, "Switching off
  versus deleting". (a) is done by W110a (#1268): a printer's Active status reads "Activa", agreeing with
  "Deshabilitada" as lists and variants already did, and print agents read "Activo" from a key of their own
  (`printers.agent_status_active`). (c) is done by W110c (#1271): a disabled product's own row on the
  products list offers Enable, not Disable, through the editor's own save; a bulk selection of
  products that are all disabled already offers no Disable (no bulk Enable exists). Two owner
  questions from W110c, in its PR: whether a bulk Enable is wanted, and whether that all-disabled
  selection's Disable should be greyed out like the toolbar's other buttons rather than hidden.
  W110c's review read #1269 as having added a test for (e); not re-checked, so (e) below may be
  stale. (b) is done by W110b (#1278): a watcher's and a kitchen course's row offers **Delete** when nothing refers to it and **Disable** when something does, and on a Delete the server applies the same rule in the one transaction (a watcher is referred to by a device or a watcher's Done mark; a course by a product, a draft line, an order line or a kitchen item — the `WATCHER_REFERENCES` and `COURSE_REFERENCES` lists, held to the database's foreign keys by `apps/server/src/in-use-references.test.ts`, which sees declared keys only). A real delete asks first. The Disable action sends `?disable=true` on the DELETE route, and the server then only switches the row off, never deletes it. Disabled ones are listed after the active ones, on the Prep stations page's Watchers tab and in the course list, with **Enable** (a new `POST /management-api/watchers/:id/reactivate`, refused `watcher.name_taken` when an active watcher has the name; a course through `PATCH /management-api/courses/:id`). A re-enabled watcher keeps its follows but not its printers, which Disable drops. The kitchen screen and the Devices screen say a watcher was disabled, not removed, and the Devices Edit dialog marks a held disabled watcher "(Disabled)"/"(Deshabilitado)" (`devices.watcher_disabled_mark`, which W105d had as "(Removed)"). Left open from (b): `GET /management-api/watchers` needs `venue.configure` where the stations and courses lists need only `venue.view` (it did before W110b; the owner's call); and a Delete label can be stale, because the watcher list does not re-read on a watcher's Done marks nor the course list on draft lines, order lines or kitchen items, in which case a confirmed Delete switches the row off instead. The course in-use read searches `order_draft_lines`, `working_order_lines` and `ticket_items`, which have no index on `course_id`; adding one is a migration, left out of W110b. Found along the way: `apps/dashboard/src/screens/kitchen-screen.timing.a11y.test.ts` (from #1269) writes `look/venue-defaults-*.png` screenshots into `apps/dashboard/src/screens/` on every run, which git shows as untracked. (d) Zones and adjustment reasons now offer Enable (W110d,
  #1273): a disabled zone's row in the venue screen's policy tree, and a
  disabled reason's row menu on the reasons screen (through a new
  `POST /management-api/adjustments/reasons/:reasonId/reactivate`). Departments and floor tables
  still cannot be enabled: a department needs an `active` field on
  `PATCH /management-api/venue-service/departments/:departmentId`
  (`packages/venue-service/src/routes.ts`), and floor tables need a list that includes disabled
  tables plus `active` on `PATCH /management-api/tables/:id` (`apps/server/src/management-api.ts`,
  `apps/dashboard/src/api/client.ts`). They were left out because, when W110d started, lane D's
  A261-3 (#1269) changed those files; it has since landed, but lane B's paused W93 worktree
  (`feat/device-home-page`) has uncommitted changes in `apps/server/src/management-api.ts`,
  `apps/dashboard/src/api/client.ts`, `apps/dashboard/src/api/live-queries.ts` and
  `packages/venue-service/src/operations.ts`, so they are a follow-up to take once W93 lands. Found along the way, each left as it is: enabling a zone leaves its tables
  disabled, and its routing exceptions, watcher zones and till starting zones gone, because
  disabling deleted or switched those off and Enable does not restore them;
  `PATCH /management-api/zones/:id` sets `active: true` on a zone whose department is disabled,
  with no refusal (read in `updateZone`, `apps/server/src/tables.ts`, not run), though the screen
  does not offer Enable there; a department's row in the policy tree still offers Disable when the
  department is already disabled (zones had the same fault and W110d fixed it); creating a
  department with a name another department has answers 500 `server.internal`, because there is
  no `department.name_taken` code (run on W110d's branch: a second
  `POST /management-api/venue-service/departments` with the same name); and a disabled zone's
  name and its "Disabled" word are drawn with no space between them ("Dining roomDisabled", seen
  in W110d's screenshots of the policy tree). (e) a test gap, reported by W110's review and not
  re-checked: `#fallbackReason` (`packages/venue-service/src/dashboard/prep-stations-screen.ts`)
  turns the server's `switched_off` reason into `prep.test_disabled` for both of its callers, and
  the review found no test for the caller that explains an extra falling back to another station.
- The dev `?dev` chooser shows `label · kind` rather than `name · profile`; the Spanish
  form-factor label differs between two pickers ("TPV" vs "Caja registradora") — an owner copy call.
- An `int4InRange` helper collapsing four int4-bounds parsers; an options object for the positional
  `create/updateDeviceProfile` verbs; a shared `SeedDeviceProfileInput`; a `BRAND_PRIMARY_HEX`
  constant (the theme colour is literal in three places).
- Choose one reset-on-dismiss policy for armed destructive row actions across printers and agents;
  migrate `?disabled=${busy}` buttons to `loading`; the seen-status is as of the last read, not a live
  presence light.
- KDS-4 follow-ups: device-mode reprint behind `requireDevice`; the mirrored station-side read (a
  `DashboardApi.listStationPrinters` and a UI line); the reprint timestamp.
- Recorded, not blocking: a handheld's Order tab is tappable with no active table; the
  boot-into-floor prefetch is unreached by any shipped canvas; the station screen's device-mode enrol
  sub-view is unreachable; the default counter canvas has no prep-queue rail.
- The dashboard's `es-ES` module default still needs the flip the till got in #170; check the
  dashboard money formatter for the same "doesn't follow the UI locale" bug.

**House rules and their guards:**

- **Keep an eye on `CLAUDE.md`'s size over time — it is not gated** (owner, 2026-09-14). Add rules
  freely; if it drifts well past ~45.5 KB, move the receipts into the matching `docs/developers/`
  topic file and leave the rule plus its one-line pointer behind, per `CLAUDE.md` §7. A periodic
  housekeeping check, not a blocker.
- **The pointers guard is deliberately narrower than "every pointer"** (#337): it does not check a
  root-level filename such as `eslint.config.js`, nor a bare directory. `CLAUDE.md` §7 says so;
  widen the guard if that gap ever costs something.

**Payments:**

- Bound the HTTP body read as well as the header wait in `sumup-client.ts` (move `clearTimeout` after
  `res.text()`); lift `reverseViaStripe` and `reverseViaSumUp` into one neutral reversal primitive.
- Pre-existing `forward` retry backoff.

**Fiscal (each behind its own review, owner sign-off at land):**

- **The three alta builders repeat their record assembly** — `recordSale`/`recordCorrection`/
  `recordSubstitution` in `packages/fiscal-verifactu/src/backend.ts`; the VAT lines already share
  `toDetalleDesglose`. Safe seam: a helper taking the assembled `Omit<AltaInput,"Encadenamiento">`;
  needs a huella-invariance re-run across all three.
- `mirror-bundle.ts`'s `r.series ?? []` branch is un-exercised; export `ID_SISTEMA_MAX_LENGTH`
  when either package is next touched; `insertNodeSeriesTx`'s held-code check is SELECT-then-INSERT.

**Product decisions to take before production:**

- The orphan drift gate holds a customer's money pending a human, unbounded — nothing re-sweeps a
  closed period.
- The €0 comped sale settles at the settlement instant, not backdated to `issued_at` — is a comp
  ever finalised long after the invoice printed?
- A human account always keeps an email (no remove-email action; `setEmail` rejects clearing) — the
  rule now, rather than a missing UI path.
- The duplicate purchase-invoice key `(supplier_tax_id, supplier_invoice_number)` is unique
  forever — per-year versus forever is the asesor's.
- **A re-sent "place" on an already-placed order answers 409 rather than replaying the original
  result — leave it, or build the replay?** In `invoice_first` the place path files a deferred
  invoice through `recordSale`, so replaying would mean reading back the immutable
  `registros_facturacion` row and rebuilding the invoice number, date and QR. That is fiscal core,
  and not work to do unattended. Leaving it is a real option — the 409 is a defensible state
  conflict and the till keeps the basket and shows `place.error`. The gain if built is that a re-tap
  after a lost response returns the invoice already issued instead of an error. Two claims an earlier
  campaign note made are FALSE and must not be reused: that placing files nothing fiscally, and that
  the current answer is an opaque 500. The place-path comment in
  `apps/till/src/till-app.ts` calling an idempotent `placeOrder` "a recorded backlog follow-up"
  refers to this entry.

---

## Afterwards — the on-prem mirror, then the cloud primary

Not in any track until the standalone primary is done. Kept here so the decisions and residuals do
not get lost.

### The on-prem mirror

Read this section as requirements slices 3–5 must meet, not as work outstanding on code that exists.
The membership, promotion and rejoin arc (#197–#272) is still in the tree. What remains, largest first:

- **Status, alarms and the operator surface for replication.** An operator needs to see whether the
  standby is keeping up, and to be alarmed when it is not.
- **Fiscal-certificate distribution** — rebuild on the asynchronous adopt (see the residuals). Open
  design question: how the dormant certificate is protected when the seal must happen after the
  initial copy ([design](superpowers/specs/2026-09-07-fiscal-cert-distribution-design.md),
  [plan](superpowers/plans/2026-09-07-fiscal-cert-distribution.md)). Beside it, **the vault-ring
  question**: `tenant_credentials` is `local` and a blob sealed under one node's ring cannot be opened
  under another's, so `fiscal.aeat` and `payments.stripe` do not travel to a standby at all.
- **Node-role collapse** — derive ONE `NodeRole` at boot from the membership document and pick one
  rule: every role change is a restart, or the worker-lifecycle manager — not both.
- **The mirror as a backup destination**, and the mirror's print agent (gated on B6's cross-box TLS).
- **Adding a mirror while the internet is down** (owner, 2026-10-02). Today the only way a second
  machine gets a copy of `venue.db` is from the owner's bucket — the rebuild
  (`waitron-restore restore --from-bucket`, or the setup wizard's "Restore from my bucket").
  Adoption (`apps/server/src/adopt.ts`) fetches its identity bundle from the primary by URL but
  carries no data, and nothing in the tree follows a stream yet. So with the internet down there is
  no way to add a mirror, which is the very case an on-prem mirror exists for. Wanted: a new mirror
  takes its first copy straight from the primary over the LAN. The topology design's §4.4 already
  has the primary stream to the mirror box over the LAN once that box is enrolled, and a stream to a
  new place should begin with a full copy of the database (to be checked on the pinned Litestream),
  so the design may cover it — but it never says so, and it does not list what else enrolling needs
  from the internet. Slice 5 should name this as the way a mirror is added and prove it with the
  internet unplugged. A cloud mirror needs the internet anyway and is outside this item.
- **The two-node end-to-end proof over LAN and over WireGuard**, including the same-site cookie
  browser receipt still owed from the till reroute, #257 (needs interactive Chrome + mkcert +
  `/etc/hosts`).
- **Richer daily close** — one close run by the primary across all tills.
- The residuals under *Detail → Replication*: re-admission, the membership chart filling up, chart
  hygiene, the resume-at-restore marker, power-loss durability and the selling gate, restore-onto-cloud
  re-encrypt, mirror fidelity, split-brain on the promoted side, the till UX for a timed-out card.

**A stale worktree:** `feat/h2-fiscal-record-sync` (spec and plan dated 2026-09-04, uncommitted
changes in `packages/sync`) was designed on the application outbox that #280 deleted, and the
replication it was rewritten against went too; the `ledger` classification of the fiscal tables
survives both. Remove it once the owner confirms nothing in its uncommitted diff is wanted.

### Cloud integration and SQLite work

**Shared account controls:** `@waitron/ui-core` owns the seven account controls, tokens and common
helpers inside this repository, and existing `@waitron/ui` imports re-export them. Cloud has
published private `@waitron-io/ui-core@0.1.0` (see the [release receipt and setup](https://github.com/waitron-io/waitron-cloud/blob/main/docs/shared-ui-release.md))
and owns the release workflow and account screens. Read the first weekly mutation results for both
UI packages after the split; the split preserved the 90% gates but did not measure their new full
mutation scores.

Cloud product and infrastructure work moved to the
[Waitron Cloud backlog](https://github.com/waitron-io/waitron-cloud/blob/main/docs/backlog.md)
on 2026-09-22: provisioning, cloud-only redundancy, trials, remote access, provider integration
and cloud operations. See [documentation ownership](cloud-ownership.md).

**Waitron retains:** the implemented Cloud connection screen and manager adapter; box-side networking
and `@waitron/tunnel`'s retirement; first-contact trust bootstrap; and the cloud-standby end-to-end
proof. **Do not restart the cloud-standby work until the Waitron↔Waitron-Cloud boundary contract is
settled.** The proof to run then: on-prem primary → adopt → mirror → human promotion → tills reroute
to the promoted cloud → the venue sells and files. Local maintenance requirements remain in
[Box maintenance and remote support](superpowers/specs/2026-09-11-box-maintenance-and-remote-support.md);
its cloud support-service proposal is tracked in Cloud and is not approved by this move.

**SQLite + Litestream replaces PostgreSQL** (owner decision 2026-09-16). The architecture is
[SQLite + Litestream topologies](superpowers/specs/2026-09-16-sqlite-litestream-topology-design.md),
whose §11 is the build order. The failover-loop prototype gate is done (#392, #395, #406, #411, #415,
#417, #422, #425; [the results note](research/2026-09-16-sqlite-failover-prototype.md)); its one
negative result, **S2** — a handed-over batch can re-file a sale the receiver already filed, which
costs one wasted AEAT call (error 3000, already read as filed) — produced the fence-before-ship rule
in topology design §5.2. The tag `pre-sqlite-migration` (`c9d80c59`) marks the last commit before
any of this code. **Slice 1, the storage swap, is complete (2026-09-23; F1 #489, T1 #490, T2 #492,
T3 #494, and its preparation tasks).** **Slice 2, stream and cold restore, is complete
(2026-09-25;** #513, #540, #543, #548, #554, #557, #560, #566, #569, #590, #619, #627, #628, #630,
#642, #646 and #652, with follow-ups #573, #576, #594, #599, #608, #643, #647, #649 and #650): a
venue streams `venue.db` continuously to an S3-compatible bucket the owner supplies, a dead box is
rebuilt from that bucket with one recovery kit and carries on under a fresh fiscal chain, and staff
see how current the copy is. **Next: slice 3, seats and promotion. Its first task is already
decided: credentials move to a venue key** stored in `venue.db` only in locked form — do not reopen
it.

**What the prototype gate left open (the receipts are in the results note):**

- **Validate every supported object store.** Cloud owns its production-provider checks in the
  [Cloud backlog](https://github.com/waitron-io/waitron-cloud/blob/main/docs/backlog.md);
  Waitron retains the engine's required semantics and checks for claimed self-host targets.
  Topology §12.2's real-store gate remains open; the conditional-write promotion tie-break must be
  demonstrated on each target (risk 11). Each owner's bucket is checked by the Backups screen's Test
  and Save (`probeBucket`, `packages/stream/src/probe.ts`), which refuse a bucket that does not
  refuse a stale conditional write, and the loop test runs that check against versitygw. Waitron
  Cloud's production store still needs its own run.
- **The store pointer and a new generation are exercised for a rebuild, not for a promotion.** A
  promoted node's generation, and Cloud's recovery orchestration (tracked in the
  [Cloud backlog](https://github.com/waitron-io/waitron-cloud/blob/main/docs/backlog.md)), remain;
  settle the Waitron ↔ Waitron Cloud contract before assigning them.
- **250 sales a day is still an assumption** nothing in this repository measures, so the days-per-GiB
  figure rescales but does not hold.
- **Three scenarios have no mutation receipts (S1, S6, `smoke`), two branches of the litestream
  wrapper are driven by no scenario, and the runner's own `main()` is undriven** — a later task should
  pin them or delete them.

**SQLite slice 2 — what each task left open.** Task 4's measured values are under "What later tasks
read" in [the results note](research/2026-09-16-sqlite-failover-prototype.md#slice-2-measurements);
what Task 0 (#543, photo shrinking) left is under *Photos are shrunk on upload* in Track A.

**Task 1a** (#548, each machine's own rows keyed by its node id). Deny's delete is the one
join-request node filter no test fails without (the `requirePending` read before it already refuses
another node's row); and the run-it review did not reach three claims within its budget — holders
torn by a concurrent promotion, credential sealing, and scheduler takeover.

**Task 1b** (#554, session cookies stored only as hashes). Nothing fails when the UUID shape
screens in `requireSession` and the till logout route are deleted — a non-UUID value hashes to no
row, so the screens now only save a lookup. Also open: now that both ends are `state`, the
keys #426 dropped could be declared again — `sessions` to `persons`, and
`management_sessions`, `totp_enrollments` and `google_oidc_states` to `persons` (`sessions`' key to
`tills` went with that table in A238, and `sessions.device_id` holds one to `devices`). Doing so would
change what deleting a person does.

**Task 2a** (#557, a recovery key that does not need an archive destination). Open:
- On a box that holds a key while backups are off because its venue failed to open, an apply that
  reuses the held key writes, reloads, the venue fails to open again, and the route answers
  `backup.effective_mismatch` (read from the route, not run).
- The bucket copy panel's refusal for a too-short key names the "Turn on backups" button but does
  not link or scroll to it. The panel picks its message from `managedByEnvironment` alone, so with a
  key hand-edited too short in `backup.env` it can name a button that does not help: with archives
  on it names a button that is not shown; with archives off, until the next status read reports the
  key too short, the button sends no new key (it reuses the held one) — after that read the screen
  makes one.
- The status watcher does not retry its own failed mint (the mint is a POST, never passive session
  activity), so the screen then offers no key until it is reopened.
- The edit-settings form can meet `backup.recovery_key_exists` when a rotate (from another tab or
  admin) lands after it fetched the key.
- DONE: A later `apply` keeps the "key rotated" date that `rotate` wrote to `backup.env`, including
  when the key was rotated before an archive destination was configured.
- The owner's call: `rotate` with a destination loaded rebuilds `backup.env` from the running
  settings rather than keeping the file's other lines, so a destination added to the file by hand
  and not yet loaded is dropped.

**Task 2b** (#560, the box's own state files locked with the recovery key in `node_sealed_state`).
Every node writes its own row at every start, standby and mirror nodes included, while the backup
job runs only on the primary — kept by design (owner, 2026-09-24).

**Task 3a** (#566, one process per venue folder; #573; #608). Open:
- From #608: the recovery level is read before `recovery.lock`, so the pre-boot count another start
  writes can still push a server restarting at that moment onto the recovery page.
- From #573's review, the owner's call: only an unwrapped `provisioning.database_in_use` is
  recognised — a wrapped one, or the store's raw `VenueInUseError`, would still count (no path wraps
  them today).
- From #608, no behaviour change decided: the watchdog appends its line to `waitron.log` without
  creating the log folder, so on a machine with no such folder that line is lost; only a store's
  `close()` waits for the watchdog thread to end, not a bare `release()`.
- The recovery page's Spanish (#650) has not been read by a native speaker.
- From #566's review: the migrator's lock and the venue lock use one technique in two copies, and
  the test helper that holds the lock from another process is copied into several test files.

**Task 5** (#569, `@waitron/stream`). Open:
- Which real providers lack S3's multi-object delete, and what each answers, is not established; a
  provider that refuses it with a status other than 501 fails the day's prune
  (`stream.prune_failed`). `probeBucket` deletes one object at a time, so it cannot reveal such a
  provider; having it delete its test object through `deleteMany` would.
- Done by W31: the English-only guard scans `@waitron/store`, including its tests.
- Nothing in the package has been run against a real provider's bucket: the unit tests drive the
  real S3 client over a scripted network, and the loop test drives it against versitygw.
- `apps/server/src/rejoin-command.test.ts`'s sidecar assertions do not test the wipe (its fixture
  closes the handles first, which removes the sidecars). The wipe's sidecar removal is pinned by
  `apps/server/src/db-wipe.test.ts`; what is missing is a rejoin-level case with sidecars on disk.
- Every synchronous `deriveKey` caller still blocks the event loop while it derives:
  `encodeConfigurationBundle` (through `encryptArtifact`); everything reaching `decryptArtifact`
  (`apps/server/src/artifact-cipher.ts`) — `decodeConfigurationBundle` (on the request path),
  `validateArtifact` (`apps/server/src/restore.ts`) and `unsealNodeState`
  (`apps/server/src/sealed-state.ts`); and the recovery bundle's `encryptBundle` and
  `decryptBundle` (`apps/server/src/recovery-bundle.ts`).

**Task 6** (#590, the Litestream supervisor). Open:
- A pointer write from a process that has since died, landing after the restart, can still make the
  box refuse itself, because a restarted process starts with an empty record; so does a
  `current.json` deleted after the supervisor read it, on a bucket that answers a conditional write
  to a missing object with 412 (SeaweedFS; the in-memory test store). In both cases the owner's alert
  (`backup.stream_refused`) still says another box is writing. On a bucket that answers that write
  with 404 instead (AWS, as it documents; versitygw, as measured), the deleted pointer surfaces as
  `backup.stream_request_failed` and `#movePointer` (`packages/stream/src/supervisor.ts`) logs
  `stream.pointer_write_failed` and retries every `OPEN_RETRY_MS` until the supervisor stops, never
  reaching `refused`.
- Whether a cut-off primary should stream is decided: see *Replication, membership & failover —
  residuals* (owner, 2026-09-24).
- The server's 8-second shutdown stops the stream last, after the Cloud snapshot loop, so on a large
  database Litestream may not finish its last upload (it is still told to stop and does not outlive
  the server).
- `pnpm setup:litestream` skips the download when the installed binary already reports the pinned
  version, so the checksum protects fresh downloads only.

**Task 7** (#619, how current the bucket copy is). Open:
- A bucket read given up after five minutes is not cancelled, because the bucket client's list
  takes no way to stop it; what the deadline can still leave running is a listing whose answer
  keeps arriving, or one whose answer stalls after headers that arrived within the first three
  seconds.
- A commit that changes no row but writes to the side file, such as a schema change or a pragma
  such as `user_version`, is not reported, so the lag can read low.
- An update that writes the same value, straight after a schema-only commit, is still reported,
  although it adds nothing for the bucket (a test pins it).
- The check that the side file changed was measured on the Mac's filesystem only, not the box's
  Linux one; a commit landing in the same file-time tick after a side-file restart is missed.
- A sale whose write transaction began before the supervisor first subscribed after boot is not
  counted, so the lag reads low for it.
- Whether Litestream uploads anything while the side file is unchanged is not measured.

**Task 8a** (#627, the server side of the bucket-copy settings): the dead-process pointer write
under Task 6 applies here too.

**Task 8b** (#628, the Backups screen's bucket-copy panel). Open: the Backups screen's own card width
is still a `34rem` literal, which the no-hardcoded-chrome rule forbids in a view and no guard reads;
and a change of the secret access key alone, made in another tab, still leaves the old kit showing,
because a settings read does not carry the secret.

**Task 9a** (#630, the first start after a restore — `apps/server/src/rebuild-first-start.ts`). A
node row holding no endorsement still signs `endorsements: []`, and no first-start case asserts it.
Open:
- Two comments claim more than the code keeps: `retireSelf`'s header (`apps/server/src/retire.ts`)
  says a signing failure "leaves the node exactly as it was", and `promoteMirrorToPrimary`'s
  (`apps/server/src/promote.ts`) says a failure before the commit "leaves the mirror as it was".
  Signing empties pending `change_log` rows (measured by #655's Codex seat), so they are not strictly
  untouched; no case losing a real one is known. Narrow both the next time either file is edited.
- A restored box whose cloud peer does not answer during its first start signs the next term and
  removes the marker; a fencing document the peer serves later at that same term reads as not
  newer, so the box is never fenced (reproduced with a temporary two-boot case in
  `apps/server/src/boot.reconcile.test.ts`). I believe it cannot happen today — the only writer of
  `mirror_config`, which the peer check needs, is `apps/server/src/adopt.ts`, for a standby that
  never finishes adoption — from reading, not a run. Recorded, not redesigned.
- When the key rename and the put-back both fail, the new certificate is left beside the old key
  (the listener refuses the pair) and `server.crt.previous` holds the old certificate until the
  next reissue. The next start repairs it, because the marker stays — unless that start defers the
  first start. Publishing the pair through one atomic switch (for example a directory swapped by a
  single rename) would remove this case.
- The pointer read gives up after 15 seconds but does not cancel the request: the bucket interface
  takes no way to stop one.
- The pointer's term is taken without checking its signature, as the supervisor already does, so
  whoever can write the bucket can push a restored box's term up (never down).
- A marker left on a fenced box survives `waitron-rejoin`, which wipes the database and removes
  only `trading.env` from the state folder (`apps/server/src/rejoin-command.ts`), so the first
  start runs whenever that box next starts trading unfenced and not as a mirror. Whether a rejoin
  should clear it is the owner's call.
- A sell-only local secondary that is not fenced runs the first start and signs the next term.
- The restored membership row's check (`assertRestoredMembershipValid`, #678) trusts the keys the
  restored copy holds: a copy whose `nodes.public_key` for this node was rewritten, with its
  document re-signed by the matching key, passes, and the next term is signed over the added node
  (the case "passes a document re-signed with a key the copy's own node row was changed to name"
  pins that).
- Only the start that finishes a restore checks the row's signature. A mirror or fenced start
  checks only that it can be read and is shaped as a document (A53); a start still finishing an
  adoption checks neither. Promotion, `retireSelf` and the standby chart append
  (`apps/server/src/promote.ts`, `apps/server/src/retire.ts`, `apps/server/src/mirror-bundle-api.ts`)
  sign over the held row without checking it. Gating promotion on the same check was measured and
  not done, because it would refuse a genuine document: on 2026-09-26 a scratch case built the way
  `promote.test.ts` builds a mirror found, after `setDeploymentMode(…, "mirror")` alone (what
  `adoptFromPrimary` leaves), no document and an empty trust set; after
  `establishReservedStandbyIdentity`, a trust set naming the standby alone; and a document the
  primary signed with its real key, written there, verified as `untrusted_signer`. The owner's
  decision (2026-09-26) is under the failover residuals ("a standby checks a promotion against the
  primary's key"); a restored mirror's own start is not covered by it.
- On a start with NO restore marker, text that is not JSON or a machine list that is not a list
  fails with the generic text; a stored JSON null reads as no document, and a document breaking only
  a shape limit is read and used unchecked. From reading its writers, nothing this program writes
  produces one. Once starts have failed repeatedly the recovery page shows the generic text (code
  `unknown`), not `restore.membership_invalid`. Whether to give it a curated code is open.
- A mirror that deferred its first start and is then promoted without a restart
  (`promoteMirrorToPrimary`) keeps the bucket copy held, reading off with the reason
  `first_start_pending` and raising no alert, until the box next starts. From reading, not a run.

**Task 9b** (#642, `waitron-restore restore --from-bucket`, `apps/server/src/restore-stream.ts`).
Open:
- A copy over 2 GiB cannot be restored: `restoreFromStream` reads the downloaded file whole, and
  Node refuses a file that size (`ERR_FS_FILE_TOO_LARGE`). Archive creation has the same limit
  (`apps/server/src/backup-sweep.ts`). The root is that placement (`restoreDatabase`) takes bytes,
  not a file. Letting it take a source path and rename it into place on the same filesystem would
  remove the read into memory on the bucket path, and also the archive form's extra full copy:
  `refuseIfArchiveSourceLive` writes the whole database to a scratch folder only to read the bucket
  settings from it.
- `pragma integrity_check` is one blocking statement, and the venue watchdog kills a process after
  120 seconds without a timer turn. The review measured 6.0 s on a 1.36 GB database on NVMe; box
  storage has not been measured.
- A staged request whose marker is invalid, or whose payload cannot be read, throws before the
  request is cleared, so every start fails the same way. I believe this predates the branch.
- A copy with no `tenants` row reads an empty tax id, which neither the command line nor the setup
  wizard ever accepts as confirmed, so it cannot be restored; no dedicated error code names that
  case.
- An interrupted bucket rebuild or archive check leaves its scratch folder, a full copy of the
  venue database, under the state folder; the next run makes a new one and does not remove it.
- A setup-wizard restore whose placement fails is not retried and is not reported on the setup
  screen, nor normally on the recovery page; the code and which database was kept are only in the
  server's own output and in `waitron.log`. **Owner decision 2026-09-25: leave it as it is.**
- A `.venue.db-replaced-` folder left in the venue folder is removed by the box's next start
  (`clearReplacedDatabases`, A31) only from the container's entry: a server started any other way
  (the dev stack) does not.
- Open question: the first start's pointer read and the bucket rebuild's calls (the command line's
  `--from-bucket` and the wizard's `/setup-api/restore-bucket`) use different limits (15 seconds
  and 60 seconds) and report different codes (`restore.pointer_unreadable` and
  `backup.stream_request_failed`). The code does not say why they differ.

**Task 9c** (#646, "Restore from my bucket" in the setup wizard). Open:
- The bucket route answers a wrong key (`recovery.passphrase_invalid`) and a damaged copy
  (`backup.artifact_invalid`, `backup.archive_invalid`) with different codes; the wizard shows one
  sentence for all three, as the command line does.
- The first, unconfirmed attempt downloads the whole copy only to show whose it is, and the
  confirmed attempt downloads it again; the HTTP request stays open for the whole download.
- Walked in the browser test harness against a stubbed server, not yet on a running box.
- After an archive restore or a Cloud restore the final screen does not show the device steps the
  bucket rebuild's shows (`rebuilt` is set only on the bucket path, `apps/setup/src/setup-app.ts`),
  although the first start re-issues the certificate for this machine's addresses after an archive
  restore too.
- After a refused Cloud restore the owner has to tick the Cloud screen's "old server and surviving
  peers are stopped" confirmation again.

**Task 10** (#652, the loop test against a real S3-compatible server). Open:
- `scripts/changed-packages.mjs runnable` runs before the tests in many packages' jobs, fed from a
  pipe, so the selection guard does not count it and a change to it alone runs none of those jobs.
  Listing it against every member those jobs test would send every change to it through all of them
  — the owner's call.
- Whether a sale's write waited behind the server's fold-back, rather than landing before it, is not
  observed, and the fold-back of a 256 MiB file is still timed only by the bench rig (results note,
  1b), not through the supervisor.

**A130, A133 and A135 — a sale can wait behind Litestream's own checkpoint (DONE: A130 #868, A133
#889, A135 #907 and #917).** A probe that reproduced the pause test's one failure on `main` (run
36559470238) on one runner in 20 found the CI runner's disk stalling, not the bucket, and the stream
tests' CI step now sets `TMPDIR=/dev/shm`. The figures are in
[testing-guide.md](developers/testing-guide.md), "A sale can wait behind Litestream's own
checkpoint".
- **How A133's probe ran** (a throwaway branch, since deleted; workflow run 36615242523, 12
  GitHub-hosted runners): it booted the real server on a provisioned venue and sold through
  `POST /api/sales` with one seller, one sale at a time, for 150 s. Litestream ran with the
  product's own configuration, the bucket answering, and its log at DEBUG written to a file rather
  than a pipe. Each write's wait for `begin immediate` was timed in the write queue. The slow disk
  was a device-mapper `delay` target: 10 ms per write, 100 ms per flush. Decided before running: if
  the stream cannot hold up a sale, writes wait under 20 ms to begin with streaming on, as with it
  off. Litestream 0.5.17 holds the database's write lock for a PASSIVE checkpoint
  (`checkpointWithExecutor`, `db.go` at tag v0.5.17).
- **DECIDED (owner, 2026-09-30, after A135): leave Litestream's checkpoints as they are; neither
  setting ships.** A135 measured switching off the timed checkpoint and moving the page-count one out
  of reach: it removed the wait on the delayed disk but not on the runner's normal disk at about 80
  sales a second. The owner was offered shipping the two settings, leaving the checkpoints alone, or
  first running A133's probe on the box's own disk, and chose to leave them alone.
- **Open: Litestream at trace logging deadlocked sales for five seconds.** The probe first ran it at
  trace level by mistake, and 13 of 24 runs failed with a 500, each one looked at being
  `begin immediate` failing `database is locked` after 5,006 to 5,008 ms. The inferred mechanism:
  Litestream held the write lock while blocked writing its log to a pipe that only the server's main
  thread reads, and the main thread was waiting for that lock. At the normal level Litestream writes
  too little to fill the pipe; that is inferred, not measured. **Next:** check whether any setting
  lets an operator raise Litestream's log level, and read the pipe on a thread that does not wait on
  the database if so.

**The bucket client's limits (A44, #676) — what is still open.** `createS3ObjectStore` gives a
request up when it has had no reply 30 seconds after it started (`BUCKET_IDLE_MS`,
`packages/stream/src/s3-store.ts`). An answer whose headers arrive within three seconds and whose
body then stalls is not bounded; the deadline on the pause and the freshness read cannot cancel a
listing whose answer keeps arriving; the idle limit is per request, not per call, so a listing of
many pages, or a bucket answering each request just inside the limit, can take longer; a bucket that
takes more than 30 seconds to answer a request whose body is already sent, such as a delete of 1,000
keys, is cut off, and how long real providers take for one was not measured; and the tests run the
handler's below-6,000 ms path, while its production path was measured by hand, not by a test.

**The S3 test server's ports (C88, #920).** Fixed in the harness; the mechanism is in
[testing-guide.md](developers/testing-guide.md), "The S3 test server knows its own server". Left:
the Waitron servers' own ports in the loop and pause tests are drawn the same way, and a lost one
fails the boot loudly (`server.listen_failed`) rather than silently; not changed.

**The pause test and the bucket's error reports — what is still open (left by #668, #686, A57, A60
and #723).**
- **Why the side file's growth per sale differs so much between runs is not tested.** The pause
  test's fill to 16 MiB took about 13 KB a sale on one CI run, about 41.6 KB a sale on its own
  runner, and about 79 KB a sale locally, one run each and all on disk, before CI's stream step
  moved these files into memory (A130). Litestream's own checkpoints reusing the file is the
  guess. If the test turns unreliable on CI, that margin is where to look.
- The wizard route answers `backup.stream_name_invalid` 400, where other bucket failures answer 502
  — the status table in `apps/server/src/setup-api.ts` maps the code as one, and the same code also
  covers a bad value in the recovery kit, where 400 is right.
- A batch delete's `backup.stream_request_failed` still carries the file's name as the bucket
  listed it in `key` (the `deleteMany` refusal in `packages/stream/src/s3-store.ts`); that the prune
  logger drops it is a review seat's reading and one run, not a guard.
- That a real bucket's 403 to the pause's listing reads that code, and the status and `errorName` on
  each line, were shown by reading, by the store's scripted HTTP answers and by the supervisor's
  injected errors, not against a real bucket; A60's `errorName` list
  (`packages/stream/src/bucket-error-names.ts`) was checked against Amazon's reference only, not
  against the names versitygw gives its errors.
- The case "refused while the run is stopping" catches a removed stop check only through the order
  two pending steps finish in, so re-run that removal if `#bucketAnswers` is restructured.

**Done (#W32): the images ship notice files for npm packages bundled into their JavaScript.** The
owner's rule (2026-09-24) is that a change adding third-party code to the image carries its licence
notices; the server bundles (`scripts/bundle-node.mjs`, esbuild), the three SPAs (`vite build`,
copied to `/app/web/`) and the print-agent bundle (copied to `/app/print-agent.js` in
`deploy/Dockerfile`'s `print-agent` stage) carry npm packages whose `LICENSE` files are left behind
by bundling. The app image's `/app/third-party/` holds notices for libvips, Litestream, the Iosevka
font, the Moby template the print agent's AppArmor profile is copied from, the Material Symbols
icons, the Google Sans font, and Google's "G" mark (its trademark line in the notice); the print-agent image's holds only `python3-minimal/` (since A140; bluez's copyright files are
not copied). Measured 2026-09-24: `apps/server/src/bin.ts` bundled with `bundle-node.mjs`'s options
took in 81 npm packages, 76 of which have a `LICENSE` file, and the output kept one block of legal
comments covering 9 source files from 8 of those packages; `apps/till` built with `vite build`
contains Lit, whose source opens with a `@license` comment, and its output holds no `@license` or
`/*!` comment at all. The other server bundles, the print-agent bundle and the dashboard and setup
SPAs were not built. The build now generates a notice per server JavaScript bundle and one per
web app from the bundlers' input lists, including a pinned fallback when a published tarball has
no licence file. The app image copies the server and web notices into `/app/third-party/npm/`;
the print-agent image copies its own. The image-smoke job checks the built copies.

**Box script constraints found by T2 (#492), for anyone working near the box.** `is_production` in
`deploy/waitron.sh` once failed OPEN and a caller wiped a production box with no
`--force-production`; its tests now extract the one-liner from the shipped script and run it under a
real `sh`.

- **The box's throwaway state-volume containers no longer name an image.** They go through
  `docker compose run --rm --no-deps -T --entrypoint sh app`, so the helper is the image the box runs
  — **and it therefore runs as an ordinary user, not root.** The `--entrypoint` is not cosmetic:
  without it the arguments go to the image's ENTRYPOINT, which (since 2026-09-24) refuses them and
  exits non-zero, which `is_production` reads as "cannot establish" and then refuses every reset as
  production.
- **`docker compose up -d` does not remove a service deleted from the file**, and `waitron.sh`
  overwrites the installed compose file from the ref on every install, so `--remove-orphans` is on
  the install `up` and the reset's `down` and `up`; the retired `waitron_db` VOLUME is left on disk
  deliberately, and `deploy/README.md` says so and how to remove it.

**What slice 1 left (#490 and the preparation tasks):**

- **Comments still describe a `DrizzleQueryError` wrapper that this engine does not produce.** On
  `node:sqlite` only `db.run` wraps (as `DrizzleError`, message `Failed to run the query '<sql>'`),
  while `db.all`, `db.get`, `db.execute` and an awaited query builder reject with the engine's own
  error (`packages/db/src/testing/errors.ts` records both shapes). Each site needs checking against
  the path it actually takes, then rewording. The candidates are what
  `git grep -n -i -E "DrizzleQueryError|drizzle wraps|Failed query" -- ':!docs'` prints, which
  also includes test fixtures that build a wrapped error by hand. `engineErrorMessage` in
  `packages/db/src/testing/errors.ts` names the old wrapper on purpose and is pinned verbatim by its
  test.
- **`void cfg` lines remain in `apps/server/src`** (`git grep -n 'void cfg;' apps/server/src`): test
  helpers, and production functions (`apps/server/src/working-order.ts` holds several) that take
  `cfg` and discard it.
- **If a later slice moves `local` tables into `node.db`** (slice 2's design reserved it for slice
  5), that slice decides again how the drain crosses the two files: SQLite refuses a trigger body
  that writes another attached database, so either `change_log` is reclassified to the file its
  writers live on, or the triggers stop writing it directly and something above them does (P3).
- **Every `maxWorkers: 1` config whose comment gives the coverage reason**, apart from `payments`,
  which carries its own measurement, still says the pin is needed without having measured it; the
  same one-worker-against-several coverage comparison would settle each.
- **P7's leftovers (#533):** `no-tenant-column`'s SQL check still passed with one set's SQL dropped,
  because it checks for an absence and the remaining files clear its floor of eight.
  `module-graph-honesty`, `schema-constraints` and `packages/db/src/classification.test.ts` still
  read a set's SQL their own way — the top of the `drizzle` folder only, and `module-graph-honesty`
  unsorted — rather than through `migrationSqlFiles`, which walks subfolders (no set has SQL in a
  subfolder today). `journal-monotonic` parses `_journal.json` itself rather than sharing
  `headSnapshot`'s reader.
- **Declined, with reasons:** writing `moneyNum` in `packages/workforce-es/src/convenio.ts` as
  `cents / 100` — it would put a second copy of the money scale outside `packages/shared/src/cents.ts`
  and the files `packages/shared/src/conventions.test.ts` checks (P5, #531); and one constant for the
  `10000` literals — four sit in check constraints, where only `sql.raw(String(n))` renders the
  number, and a constant that works only through `sql.raw` is a trap for the next tidy-up (P6,
  #529).
- **A few suites still build engine-shaped refusals by hand** rather than through `refusalError`
  (`packages/db/src/testing/refusals.ts`, P10, #527), among them
  `packages/provisioning/src/cli.test.ts` and `packages/scheduler/src/store.concurrency.test.ts`.

---

## Coordination between tracks

Each track is its own worktree so sessions do not edit the same files. Rules, each already paid for:

- **Concurrency follows measured headroom, never a count** (CLAUDE.md §2). Before a heavy run check
  free memory and the heaviest processes, then scale to what is free.
- **Whoever lands second rebases — only on a code-file overlap or a GitHub conflict.** A PR that is
  merely `BEHIND` lands as is with `gh pr merge --squash --admin` (CLAUDE.md §6). Module-owned
  migrations are regenerated on rebase per CLAUDE.md §3's recipe.
- **Shared files:** `apps/server/src/boot.ts`, `CLAUDE.md`, `packages/db`'s core schema and
  migrations, the dashboard printers screen, and this file (each track edits its own items).
- **Comments are cut on touch, and pruned deliberately one package per pull request** (CLAUDE.md
  §1) — see B9 → *Prune the comments*.
- **Update this file as items land**, in the same PR.

**Run path (local; no hardware, cloud, or AEAT cert):** `wa-wt demo <worktree-name>` → default
till <http://localhost:5190>, dashboard <http://localhost:5191>, setup <http://localhost:5192>,
server :8080. `wa-wt ls` shows the shifted ports if a second stack runs. The till enrols itself on
first load in dev mode. Till PIN **5555**; dashboard
**owner@demo.waitron.local / dashPass123**. `dev:setup` seeds three menus (~44 products with images),
a floor plan (5 zones / ~16 tables), staff on PIN 5555, and ~28 days of back-dated preproduction sales
— English by default, Spanish via `WAITRON_SEED_LOCALE=es-ES`. `wa-wt onboarding <worktree-name>` for
a fresh shipping-style wizard; `wa-wt reset demo|onboarding [worktree-name]` wipes and rebuilds.

---

## Standing decisions

From the 2026-09-05 whole-project design review and since. They supersede older spec text where they
conflict.

- **One tenant per database everywhere, the cloud included, and the schema carries no tenant
  column** (2026-09-14; #378). A tenant is one taxpayer (`country` + `tax_id`), held as the single
  row of `tenants` with its `id` pinned to 1, owning all of its locations. Nothing filters a query
  by a tenant; a query that wants "this tenant's rows" reads the table. Guard:
  `scripts/no-tenant-column.test.ts` (text-matching, and blind to test files). The cloud is a
  dedicated instance per tenant, hosted in Spain — a server process and a SQLite file streamed to
  object storage. Density comes from many isolated instances per host. The only multi-tenant pieces are a small control plane and the preproduction
  trial demo.
- **Warm standby plus human promotion; active-active is shelved.** Nothing was deleted for it: branch
  **`shelved/active-active`** (= `main` at `c65d3cbe`, 2026-09-05) is the snapshot to return to.
- **Modules are core to the product** (opt-in domains, third-party modules later); fiscal is swappable
  by jurisdiction (Veri\*Factu / TicketBAI / none). New domains land as modules, and no new core table
  without a stated reason (CLAUDE.md §3).
- **Register and device are both kept.** A register (`tills`; UI "register"/"caja") is the drawer
  counted at close; a device is the screen. Several devices ring into one register. _2026-10-03:
  superseded by A238 — a till is a device and the `tills` table goes,
  `docs/superpowers/specs/2026-10-03-till-is-a-device-design.md`._
- **Rerouting lives in the till web app** for every device kind; the device credential stays an
  httpOnly cookie. A native agent is built for hardware only, printing first.
- **No relay.** Remote access is the cloud instance forwarding the box's name down the box↔instance
  WireGuard link without terminating TLS. Litestream streams the venue database to the owner's
  bucket, not over this link; a promoted node following that stream is future work — see
  *Afterwards*.
- **Handheld kiosk mode is optional, never required** (owner, 2026-09-08) — the baseline is an
  installed home-screen web app plus the till's staff PIN. **The venue OWNS the handhelds** (owner,
  2026-09-18): a member of staff's broken phone is the venue's liability, so lockdown and a
  certificate install are available. Buy a cheap Android with an autofocus camera, plus a spare; NFC
  is optional and Android-only. Decisions and receipts:
  [2026-09-18-handheld-and-till-hardware-decisions.md](superpowers/specs/2026-09-18-handheld-and-till-hardware-decisions.md).
- **Comments carry invariants, not history, and deliberate pruning sweeps are wanted** (owner,
  2026-09-23; CLAUDE.md §1) — see B9 → *Prune the comments*.
- **The coverage bar is negotiable only where the rest of a package's gap could be closed solely by
  tests that assert nothing useful** (owner, 2026-09-23): "we never want to add junk tests just to
  meet a coverage bar. the tests added must actually test something useful."
- **Every package and the root project hold the high coverage bar, `98/98/98/95`** (owner,
  2026-09-23) — see B9 → *Every package to the high coverage bar*.

---

## What's built (state per sub-project)

Architecture §2's twenty sub-projects, plus the cross-cutting infra. "Remaining" is the unstarted or
partial scope; the detail for a live thread is in its track.

| # | Sub-project | State | Remaining |
| --- | --- | --- | --- |
| 1 | Design system | `@waitron/ui` token layer + primitives (`--wt-*`); brand assets (#284); the till web-app manifest and its icons; the dashboard shell restyle — collapsible nav, account menu, profile modal (#333) | sorting `wt-combobox` options (A7) |
| 2 | Sales spine | Immutable hash-chained sales, per-node series, catalogue, the one-taxpayer model | — |
| 3 | Fiscal layer | Verifactu lib + `FiscalBackend`; settlement, R5 rectificativas, F3 canje, invoice-first; fiscal is a module (`fiscal-verifactu`, `fiscal-none`) | F3 asesor/XSD confirmations; AEAT certificate install and renewal after setup (A9); cert distribution to a promoted node; a foreign business customer's identifier type (A1a) |
| 4 | Payment layer | `PaymentProvider` + Stripe Terminal, manual card, integrated Stripe, Mode-3 webhook, SumUp Cloud API (#309); dashboard provider/reader configuration and adoption (#323, #329) | webhook `recordSale` hand-off; reconcile remediation UI; the handheld NFC/QR link (A6) |
| 5 | Identity | persons/sessions, PIN (+ wrong-PIN back-off: per device at sign-in and for override PINs), `authorize()`, roles/permissions, passkeys, email-first dashboard login, emailed invitations and password resets, encrypted TOTP and recovery codes, user admin (#298, #328); a one-time passkey offer on first password sign-in (#347); identity state replicates to a standby | admin-editable roles; security-change emails; mid-shift-suspension enforce; discount gate; till-refund enforce |
| 6 | Locations | provision-a-sellable-venue (`waitron-provision venue`); departments, zones and menus (#297) | multiple-location creation/editing/deactivation; then location-scope the by-id verb family |
| 7 | Counter POS | walk-up cash, park/retrieve, manual + integrated card, prepare & collect, canvas/receipt editors, receipt/drawer printing, cash-drawer authorization — operable end to end | — |
| 8 | Reporting | daily close, frozen *cierre Z*, VAT summary, modelo 303 output+input VAT + DR303 file and its download route and its dashboard screen, purchase-invoice UI; dashboard sales screen (with a category sales report, at time of sale or current, printable) + business-overview home | fiscal filing remainder parked (*Detail → Reporting*) |
| 9 | Deployment | the box as two containers with `waitron.sh` install/reset (#285, #314); guided node onboarding (#296); boot diagnosability (#310); CA-trust onboarding + per-OS certificate walkthrough (#330); till reroute S1–S6; promotion endpoint (#272) | USB installer (B3); cloud standby live link + the Waitron Cloud boundary |
| 10 | Tabs / table service | TS-1 tables+tabs, TS-2 statuses, TS-3 move/join/merge, TS-4 transfer, till action-flow wiring, TS-5 split-bill (#324) | core COMPLETE; owner-added extensions parked |
| 11 | Floor plan | FP-1 live floor + FP-2 spatial canvas/editor | — |
| 12 | KDS / devices | KDS-1 stations/routing/tickets, KDS-2 courses/fire, KDS-3 expo, KDS-4 kitchen printing, order-timing alerts; device identity + profiles (#199, #231, #269) | routing audit view; expo device kind; device-scoped fire/collect routes |
| 13 | Tips | attribution stored (`tenders.tip_amount`) — UI collection ONLY on the integrated-card idle screen | tip-collection UI for cash / manual card / handheld (A8); payroll export (integrate-not-build) |
| 14 | Bookings | Bookings-1, now the `@waitron/bookings` module (#270, #273) | public/online/QR, availability, reminders, CRM, recurring, calendar grid, deposits |
| 15 | Online ordering | — | not started (later phase) |
| 16 | Workforce | *registro de jornada* library (chain per node since #268), D2 scheduling, roster authoring + approvals, staff request path + portal | **clocking in and out — no route or screen (A10)**; wage-computation engine (convenio-gated); D3 payroll export (integrate-not-build) |
| 17 | Accounting export | — | not started (core subset; extends Reporting) |
| 18 | Menu/recipes/allergens | EU-14 allergens, recipe/BOM allergen inheritance, recipe-authoring UI (**withdrawn from the dashboard by #345**; declarations are now direct on the product), product images, location↔menu membership, extras and options lists end to end (the legacy option groups are gone — Task 13 dropped their tables), per-option and dish-line quantity, dietary classification, order-line customisation; departments and menus (#297) | counter/walk-up kitchen fire; menu schedule (publishing landed, #677); customer-facing menu surface parked; nested sub-recipes / plate costing / stock depletion parked |
| 19 | Opening hours & channel sync | — | not started (Google Business Profile / Maps) |
| 20 | Procurement & inventory | received purchase invoices (`@waitron/purchasing`, feeds modelo 303) | suppliers/POs/goods-in/stock/3-way reconcile/reorder (parked); AI forecast deferred |

**Cross-cutting infra:** replication (none: no node replicates to another until slices 3–5 rebuild failover) ·
membership, promotion and rejoin (#197–#272; what is left is under
*Replication, membership & failover — residuals*) · backup and restore (BR-1..BR-4 plus the wizard
and guided Cloud snapshot restore for test venues) · the bucket stream and cold restore (SQLite
slice 2) · SIF topology (`#33`, `node_id` re-key) · the module system (#212–#262; country packs
#292) · the printing subsystem (`@waitron/printing` plus the db-free `@waitron/print-agent`,
#282–#335) · the layout designer and device profiles (#194–#234, #246, #269) · CI and test infra
(scoped CI, pre-push hook, shared-container tests, job-sharding, root scope) · localisation
(per-user `persons.locale`, live language switch, venue-default derivation) · logging and
diagnostics (Slice 1, #192).

**Later and parked** (no owner decision pending; reopen when a track reaches them): Square and
generic CSV menu import · accounting export (SP17) · opening hours and channel sync (SP19) · tip
payroll (SP13) · online ordering (SP15) · per-seat ordering and multiple tabs per table (each reopens a
settled decision — specced with the owner, never landed unattended) · KDS ops polish (routing
read-back and audit view, station kind, definable kitchen statuses) · recipes depth (nested
sub-recipes, plate costing, stock depletion, variants, customer-facing browse) · inventory and
procurement (SP20; the AI forecast waits for the deterministic system) · the expo device kind ·
**Bizum** (research in
[2026-09-18-online-payment-providers-bizum.md](research/2026-09-18-online-payment-providers-bizum.md)).
A Bizum payment costs a FLAT per-payment fee, not a percentage, so a provider that passes the
acquiring cost through and marks it up thinly (Mollie, Sipay) beats one charging a percentage on top
(Stripe at 1,5 % + 0,25 €, MONEI); SumUp offers Bizum on none of its plans. **To close:** a written
quote from Mollie and one from the deli's bank (the pass-through figures that would decide it are
unpublished); and, for in-person Bizum, confirm whether a SumUp or Stripe Tap-to-Pay phone can accept
a Bizum tap before designing any UX.

---

## Detail

The long form for tracked items, so the tracks above stay readable.

### Setup wizard — the constraints A2's rework left behind (A2)

Live A2 work is under *A2* in Track A. What constrains the next change to the wizard:

- **Detection must PROMOTE the match, not pre-open it in a full list.** The matched guide is
  lifted out with the rest behind one closed disclosure.
- **The demo tax ID is fixed and must never reach Prepare or Live.** Since W108 it is the country
  pack's demo value (`CountryPack.demo`; Spain's, `B00000000`, in `packages/country-es/src/spain.ts`),
  which passes Spain's own check as a company's: it is safe only because a demo box files nothing.
  Prepare and Live start with an empty tax ID and legal name, and leaving Demo for either clears both
  from the draft (`#onPatch`, `apps/setup/src/setup-app.ts`). The location name is not on that list,
  so a Demo's "Casa Delgado" stays in the draft when the operator switches to Prepare or Live. There
  the location-name field starts filled in but takes its hint, which the filled value hides, and no
  "?", because `#field` (`apps/setup/src/screens/venue-screen.ts`) chooses the "?" by Demo mode alone.
- **Default both series codes to values that survive a cold restore.** A cold restore appends
  `-<installation number>` and `stripOwnSuffixes` would then re-number a trailing `-<digits>`, so
  default to **FS** (factura simplificada — every till sale is `TipoFactura` F2) and **FR**
  (rectificativa). Nothing in the dashboard can change or add a series today.
- **`operation_description` is a Veri\*Factu field, not a country fact.** It defaults from the fiscal
  contribution and is editable after setup on the dashboard's Venue settings **Receipts** tab (its location
  section), applying to records filed from then on and leaving already-filed records alone.

### Roles the admin can edit (A7)

A person's role is one of four values (`personRole` in `packages/identity/src/schema/persons.ts`).
The seam is already right: no call site gates on a role string — every one asks for a PERMISSION and
one map turns a role into its set (`packages/identity/src/permissions.ts`) — and a session reads the
role from the database on each request, so an edited role takes effect at once. Roles and their
permissions become rows the admin owns, per tenant, with the four seeded as defaults; no compatibility
code.

The design turns on the **ladder**: a module contributes a permission by naming only the lowest role
that should hold it (`grantedFrom`, on `ModulePermission` in `packages/module/src/module.ts`) and identity spreads it
upward. A custom role has no position, so either every custom role declares where it sits, or the
module contract names a permission group instead. Pick one before writing schema;
`packages/composition/src/role-parity.ts` proves at compile time that the contract's roles and
identity's are one list, and whatever replaces the union keeps an equivalent tie. Then: who may edit
a role (`person.admin` plus nobody mints or widens beyond what they hold, and a venue is never left
with nobody who can administer roles); a role in use (deleting or narrowing one changes live
sessions on their next request); storage (a table in identity's own migration set with a
classification entry — never an enum, CLAUDE.md §2); names (built-ins are translated from
`roleName`, `apps/dashboard/src/i18n/domain.ts:135`, custom ones will not be).

### Incidents — the producers, and why the surface is separate from A1 (A5)

The `incidents` table is written by several producers: the fiscal drain when AEAT rejects a record,
the payments reconciler on drift, the Stripe device provider, the card provider pool, and — since A1 —
the chain-append seam when a record's totals disagree with its own VAT lines. #368 added the reader
(`listOpenIncidents`, `packages/core/src/incidents.ts`) and the dashboard bell and Alerts surface that
displays them. It is one surface serving every producer, which is why it was not folded into A1: a
screen shaped around that branch's two arithmetic warnings would be the wrong shape for the ones
already waiting.

### Logging, diagnostics & one-touch bug report (A9; Slice 1 landed #192)

[Design](superpowers/specs/2026-08-31-logging-diagnostics-foundation-design.md). Eventual vendor destination
is GitHub issues; for now a bundle only needs to be copy-pastable.

- **Slice 2 — one-touch bug report.** A `bug_reports` table (`local`, grants in its
  module's set), a capture endpoint that FREEZES a self-contained bundle (client trail `snapshot()` +
  `LogReader.byRequestIds()` + environment), a `wt-report-dialog` and "Report a problem" trigger in
  the till and dashboard chrome, and a GitHub-ready markdown serialiser.
- **Slice 3 — triage and forwarding.** A dashboard *Problem reports* screen and automated GitHub-issue
  creation (through Waitron Cloud — see below).
- **Hardening carried out of Slice 1, for Slice 2:** a key-name allowlist on the client trail's
  redaction (it filters by value TYPE only, so a secret string under any key passes) and scrub
  `message`/`stack` from rejected Errors; `maskPath` masks UUID and all-numeric segments only — mask
  slugs and emails too; route the dashboard's boot-probe-fail, post-login and logout transitions
  through the nav trail; roll the trail and report button out to `apps/setup`.
- **Owner decisions 2026-09-24 — crash and freeze reports, and where reports go.** These extend
  Slices 2 and 3 and replace one part of Slice 3; design them together before building:
  - **Reports go to Waitron Cloud, which files the GitHub issue.** The box holds no GitHub
    credential (this replaces Slice 3's stored token in `@waitron/credentials`). The box sends
    through its signed-in Cloud client (`apps/server/src/cloud-client.ts`, #582); Cloud (the
    separate `waitron-cloud` repository, being built) files the issue and groups reports with the
    same stack into one issue with a count. Open: what a venue not connected to Cloud is offered.
  - **The repository is public**, so the public issue carries only the stack, the Waitron version and
    the error code. The venue's identity and anything a person typed stay private in Cloud, linked
    from the issue.
  - **Automatic reports as well as the manual button.** A crash that reaches the recovery page, an
    unexpected server error, and a frozen process stopped by its watchdog (A18d writes one JSON
    report file per event on a persistent volume, outside the venue database) each become a
    pending report. After the box is back up, a signed-in manager is offered it on the dashboard —
    never on the unauthenticated recovery page — with an optional description of what they were
    doing, and a setting to send them automatically. The owner's aim: the more bugs reported, the
    better.
  - **Where the freeze reports are (#608).** One JSON file per process the watchdog kills, in
    `<logDir>/crash-reports/` — on a box `/var/lib/waitron/logs/crash-reports/` on the persistent
    `logs` volume, outside the venue database. Nothing reads or deletes them yet.

### KDS operations — low priority (A9)

Order routing is built (item→station, station→printer, receipt→printer). Gaps: a routing read-back /
audit view (the station selects are set-only — the most useful to close); no station `type`/`kind`;
single-target only (no fan-out, no per-modifier or per-time rules). Table and service statuses have
full CRUD; kitchen statuses are partial — `bump_mode` and `fire_control` are configurable fixed
enums, but a user-definable kitchen-status list does not exist.

### Backup & restore — carry-forwards (B2)

The restore hook is SP-3d (#248); the wizard is #295. Built: the storage abstraction, fan-out and
AES-256-GCM artifact encryption; the single encrypted archive and the module `backup` contribution;
the restore consumer; a filing node's restore minting a fresh chain and disjoint series; the
dashboard wizard. The image ships with backups OFF, deliberately.

Whole-state-volume capture today: the fatal `RECOVERY_FILES` plus the optional `backup.env` and
`modules.json`; the replacement's private `cloud-recovery.json`, `cloud-replacement.json` and
`cloud-connection.json` stay outside that named capture set and the captured ciphertext archive.
The exclusion set for the deeper change is `backup-staging/`, `restore-staging/`,
`logs/`, the per-hardware `instance.env`, `recovery.json`, and its lock file `recovery.lock` with the `recovery.lock-journal` SQLite keeps beside it while held. Touches BR-2, BR-3 and the recovery
bundle. Named carry-forwards: a stale-`.tmp` sweep; confirm the `StorageBackend` key path-traversal
guard landed with BR-3's manifest-driven `get(key)`; a working-backup boot success-path integration
test; scope the flat `resolvers` map by module when a second `nonDbState` module lands; a
`packArchive` pack-time entries bound; a manifest-shape coded refusal (it fails safe under GCM auth
today); generalise archive entry routing off declared source ids when a second non-DB source lands.

### Box image constraints (B3)

- **A setup box's `/health` returns 503 by design** (no duty loop); a liveness probe must gate on
  `/setup-api/status` (200), or it restart-loops an unprovisioned box.
- **The name-constrained-CA model does NOT protect a personal Android phone** (spike 2026-09-08): a
  user-installed root is trusted for every name on Android, while desktop Chrome and iOS/Safari honour
  the constraint. The service-worker/PWA/WebAuthn-blocked-until-trusted behaviour and an iOS device
  are still to measure.
- **The box image carries the WireGuard link.**
- **Identity on a standby:** `persons` and `webauthn_credentials` are `state`, so a standby can
  authenticate the venue's people on failover; re-establishment is PIN-re-prompt v1.
- Kiosk options, none built: Chromium in the box image, now the owner's lean for every box (B3,
  2026-09-29), and, later, Fully Kiosk resale for dedicated tablets. Cloud-managed device enrolment is tracked in the
  [Cloud backlog](https://github.com/waitron-io/waitron-cloud/blob/main/docs/backlog.md). The counter till
  boots into the app with no operating-system login — automatic console login, one full-screen
  browser, and the till's own PIN as the boundary. Four traps to establish when the image is built
  (the crash-restore dialog, Chromium's separate certificate store, screen blanking, BIOS power-loss
  behaviour) in
  [2026-09-18-handheld-and-till-hardware-decisions.md](superpowers/specs/2026-09-18-handheld-and-till-hardware-decisions.md)
  §5.

### Replication, membership & failover — residuals (Afterwards)

**Slices 3 and 4 rebuild failover**
([the topology design](superpowers/specs/2026-09-16-sqlite-litestream-topology-design.md)). **Until
slice 3 a venue has ONE node and no failover at all.** The "MVP for go-live" requirement of two boxes
plus cloud failover is met by slices 3–5, not before, and it is accepted for exactly as long as
Waitron is pre-production. What stayed: `packages/membership` whole (documents, signing,
canonicalisation, verification, trust), node enrolment and its rate limiting
(`apps/server/src/node-enrol-api.ts`, `enrol-rate-limit.ts`), node retirement, and the
`ledger` / `state` / `local` classification — which no longer chooses a database file: every table
is in `venue.db` (#548). Read the residuals below as requirements for what failover is
rebuilt INTO, not as descriptions of code that exists today. A standby holds its full dormant
identity from JOIN and promotion never mints a chain.

**Owner decision 2026-09-24 — a cut-off primary keeps streaming, into its own copy.** Raised by #590
(slice 2 Task 6), whose `StreamHost` streams on any node whose role is primary, while the Cloud
snapshot worker also requires the node not be fenced (`cloudPrimary`, `apps/server/src/boot.ts`).
Invoices a primary has recorded and chained but not yet sent to AEAT exist only in its database, and
Litestream copies the whole file page by page — it cannot pick out the fiscal tables — so the way to
carry them across is to keep streaming everything and extract the fiscal records afterwards, from a
restore of that node's copy, on the promoted side. So when slice 3 builds fencing and promotion: a
fenced primary does NOT stop streaming; it streams into its OWN generation and never writes over the
live one, and the tail shipper files what that copy holds that the promoted side lacks. Watch for the
rule #590's review described — a node refuses itself once the bucket's pointer names another
generation — which, if it stops a fenced node's stream the moment the promoted node claims the
pointer, would cut off exactly the tail this decision is meant to keep. Invoices already sent to AEAT
stay recoverable from AEAT either way.

**Owner decision 2026-09-26 (A45's first point) — a standby checks a promotion against the
primary's key, built in slice 3.** A restored membership document's signature is checked only at
the start that finishes a restore (#678); A53 added a check that it can be read and is shaped as a
document on every restored start not finishing an adoption. Promotion, `retireSelf` and the standby chart append
(`apps/server/src/promote.ts`, `apps/server/src/retire.ts`, `apps/server/src/mirror-bundle-api.ts`)
sign over the held document without checking it, because a mirror's stored keys name only itself,
so a document its primary genuinely signed fails the check there (measured, see Task 9a's #678
entry). The owner chose to leave those paths unchecked now and, as part of the failover work: a
standby stores the primary's key when it joins, and promotion, `retireSelf` and the standby chart
append check the held document against it. Not built; until then those paths stay unchecked.

Two of those keepers came through CHANGED, not untouched, and the change is a real loss of safety
that slice 3 has to restore:

- **`retireSelf` and `rejoinAsSecondary` lost their drain confirmations.** Both used to prove, before
  an irreversible step, that every row this node originated had reached the carrier.
  `node.retire_carrier_changed`, `node.retire_carrier_attached`, `node.retire_not_drained`,
  `rejoin.carrier_attached` and `rejoin.not_drained` were deleted with it. What survives is
  membership-only: `retire_not_fenced`, `retire_no_carrier` (now a direct `servingPrimaryNodeId`
  check), `retire_superseded`, `rejoin.not_fenced` and `rejoin.no_carrier`. So a fenced node can now
  self-evict, and a returned box can now be wiped, without any proof its tail was carried forward.
- **`rejoin --accept-loss` waives nothing today.** The flag and its `rejoin.accept_loss` warning are
  kept so the operator's acknowledgement survives the switch, but the drain confirmation it used to
  waive is gone.
- **Adopt copies no data, and an adopted mirror can no longer leave adoption-pending.** Adopt stamps
  the mirror's identity and config and writes the finish-adoption latch; the initial copy that used
  to bring the venue's rows went with the subscription. `runFinishAdoption` tries to establish the
  reserved identity on every boot, and that attempt cannot succeed, because the standby's own `nodes`
  row references a `locations` row the mirror does not have and nothing supplies. **Operator-visible
  consequence:** a box that adopts stays in adoption-pending boot for good — `/api/box/status` keeps
  answering `adoption: pending`, no mirror session or node-scoped read path is ever mounted, and each
  boot logs `adoption.establish_failed`. The full account is in
  `apps/server/src/finish-adoption.ts`'s `PendingAdoption` header; whatever replaces the initial copy
  in slice 3 has to close this.

- **OWNER DECISION, open since #443: should the setup wizard still OFFER "Add a mirror node"?** The
  wizard's copy was made honest rather than the option removed — `apps/setup`'s role, connect and done
  screens say plainly that joining does not work in this version and that the box ends up holding
  none of the restaurant's data, with no till and no dashboard. But the option is still there and the
  flow still runs, so an operator can still spend a box on it. Removing or disabling it until slice 3
  lands the replacement is a product call, not a wording one. Whoever takes it should decide for
  `apps/setup/src/screens/mode-screen.ts`'s Join or recover row and the `role-screen` card together.

- **Re-admission `sell-only → serving-secondary`** — the primary-minted un-fence that makes a rejoined
  box sell again. Must retire the node's previous chart entry and delete its live `fiscal.aeat` row.
- **The membership chart fills up, and not every entry can be cleared.** It APPENDS, every
  wipe-and-re-adopt mints a fresh nodeId, and `MAX_NODES = 8` (`packages/membership/src/verify.ts`)
  caps it. A full chart is refused at the mint (`membership.chart_too_large`) and at the join
  (`mirror.membership_full`), and an admin can clear a REMOVED (`evicted`) machine to free its place,
  from the Servers screen (A63). What stays open: only an `evicted` entry can be cleared, and A61's
  Remove refuses a standby only when the primary's own database holds a `nodes` row for it
  (`judgeRemoval`, `apps/server/src/membership-removal.ts`). The only writers of a `nodes` row
  found are provisioning (`packages/provisioning/src/venue-apply.ts`, the row of the box being set
  up) and `insertReservedNodeTx`, which a standby runs on its OWN database
  (`apps/server/src/reserved-identity.ts`). So today a remote standby's old entry (a
  wiped-and-re-adopted box's previous id, for one) reads as never-joined even if it finished, and
  can be removed and then cleared. Once adoption can finish (`finish-adoption.ts`) and that check
  can see a finished standby, nothing will free such an entry. A `sell-only` former primary keeps
  its place until that box retires itself (`apps/server/src/retire.ts` marks it `evicted`).
  Re-admission must retire, not add.
- **Chart hygiene:** a post-setup change to `WAITRON_ADVERTISED_ORIGIN` is never re-published, and a
  node that promotes while absent from the chart appends itself address-less, which `routableServers`
  drops.
- **Resume-at-restore marker** — a persisted wiped-state marker to tell a wiped-mid-restore box from
  a never-provisioned one.
- **Worker-lifecycle manager** (promote Slice 3) — in-process promotion without the restart; the
  node-role collapse decides.
- **Power-loss durability and the selling gate.** `writeFileAtomic` does NOT fsync while the
  point-of-no-return is a database commit, so a power cut between the env write and the commit could
  reboot a box `mode=primary` still carrying the primary's series. Fsync the env write or resolve the
  series at boot — and selling must gate on REBOOT COMPLETION.
- **Getting the AEAT certificate onto a promoted standby needs a new design.** The
  [2026-09-07 design](superpowers/specs/2026-09-07-fiscal-cert-distribution-design.md) landed as #279
  and was reverted by #281, and the replication it was rebuilt against was itself removed on
  2026-09-19 — so the design and its plan describe a mechanism that no longer exists. Redesign it with
  slice 3. Installing or renewing the certificate on the primary does not wait for this (A9).
- **Still owed after the cert-distribution rebuild:** the restore-onto-cloud re-encrypt; a dashboard
  promote UI; an a11y test for the break-glass panel.
- **Carry-ins, accepted or to be stated in a threat model:** the primary burns an installation number
  per bundle fetch; provision and adopt are assumed mutually exclusive per box; `establishNodeIdentity`
  must run once per node before any document is signed; on the first boot after returning, a node runs as its
  stale-held-doc primary until the reconciliation restarts it; restart-based fencing leaves a one-tick
  window for one more fiscal pass on the superseded chain.
- **Split-brain** — the promoted node's side while partitioned spans selling, the fiscal chain,
  payments (`resolvePending`) and printing — **examine in detail, not scoped to printing** (owner,
  2026-08-26).
- **Till UX for the timed-out card case** — retry, alternative tender, or wait.

### Reporting — the fiscal remainder (parked)

Built: the VAT summary and the sales side of modelo 303 (#76), the purchases side, the form's boxes
and the DR303 file (#91), and its download route, `GET /management-api/reports/modelo-303`, with
monthly and quarterly periods (#98). An annual period is refused: `requireLiquidationPeriod` in
`apps/server/src/report-api.ts` accepts only `01`..`12` and `1T`..`4T` (trimmed and upper-cased
first), and its comment gives the reason — the annual summary is modelo 390, not a 303. The
dashboard's VAT return screen (in the sidebar right after Sales, shown to a session holding `report.export`)
downloads the file — DONE (#1106). Two pre-filing caveats a human must clear before the first
LIVE 303 filing: validate the DR303 file once against the real AEAT "por fichero" uploader (we
omit página 2, régimen simplificado); and an asesor must confirm the **prorrata** treatment
(`computeInputVat` scales only the cuota by `deductible_proportion`). Deferred build slices:
rectificativas de facturas recibidas (casilla 40/41, needs a `corrects_purchase_invoice_id`
self-FK); bienes-de-inversión regularización (43); the prorrata rule (44, asesor-driven);
intra-community and import boxes (32–39); a libro-registro / Pre303 export.

---

## The advisor gap — not a build track

**No fiscal advisor is engaged**, and [compliance/who-to-ask.md](compliance/who-to-ask.md) says every
candidate turned out to be a marketing page — so engaging is itself a task with a lead time, in
parallel, blocking nothing. Before paying for answers, re-read every question in
[asesor-questions.md](compliance/asesor-questions.md) against the current Waitron architecture.
Cloud archive and hosting questions, including the historical cloud-storage document's §8a,
are now tracked in the [Cloud backlog](https://github.com/waitron-io/waitron-cloud/blob/main/docs/backlog.md).
Keep core fiscal questions here and coordinate shared assumptions with that review.
Q16 (operating from abroad) remains outside the Spanish rollout's question set under its
Spain-hosting assumption; wider country policy belongs to Cloud.

| Q | Assumption in the tree | Status |
| --- | --- | --- |
| Q13 (tips outside VAT base) | tip lives on `tenders.tip_amount`, never handed to the fiscal backend | **Closed** on primary source |
| Q15 (short payment = descuento) | a *descuento* agreed at/before issuance is outside the base (LIVA 78.Tres.2º) | **Closed** on primary source |
| Q5(a) (one series per till) | a series belongs to the server-SIF; two concurrent SIFs need **disjoint** series | needs advisor |
| Q5(c)/(d) (tickets and full invoices in one series) | F1 and F3 would draw from the tickets' `standard` series | (c) **answered** on primary source (art. 7.1.a): separate series; (d) confirms where F3 and R5 go; build item A1e |
| **Q14 (precuenta → amendment log)** | a printed pre-bill may oblige an amendment log | **Open** — the interpretive hinge |
| Q21 (pre-bill, or the invoice when a table asks for the bill) | the table screen prints no pre-bill; when one is built, printing it never fires held food and never marks a line sent (menus plan D10) | needs advisor |
| F3 canje (`IDOtro`, a separate F3 series, `Destinatarios` XSD) | foreign recipient refused; F3 reuses `standard` | needs advisor / XSD before the first real filing |
| Q27–Q29 (paying a bill in parts, a table that leaves without paying, how a comp or discount shows) | parts: server built (#721), the till does not use it yet; comps and discounts built (#916); leaving without paying built on the owner's decision (B17) | **send now** — Q28 to confirm the owner's 2026-10-01 decision |
| Q31 (correct an issued ticket by differences or by substitution) | `recordCorrection` files by differences (`"I"`); no route calls it _(2026-10-02, C126: the whole-order cancel route now calls it for a whole-invoice credit)_ | needs advisor before the correction screen is designed |
| Q32 (how a cancelled order's already-issued simplified invoice is undone) | the whole-order cancel credits the invoice in full with an R5 corrective invoice, not an annulment (C126) | built on the owner's 2026-10-02 decision; needs advisor to confirm |

**The laboral advisor** (a *graduado social / gestoría*) has its own list in
[asesor-laboral-questions.md](compliance/asesor-laboral-questions.md). Nothing there blocks the build;
two items want confirming before go-live (the digital-registro RD's status; the provincial convenio
and figures), plus whether a location's exported working-time record may show per-node chains. The
gestoría's payroll import layout is the one build dependency (it fixes the D3 export format). A tip
collected through the card terminal is business income — an accounting/payroll matter, not the
factura.

**Data protection (RGPD) is a third track, never scoped end-to-end.** Scope it before engaging a
DPO: a data map (what personal data, where, how long); the controller-versus-processor split and
whether a DPA is needed; the venue-facing duties (privacy notice, lawful basis, access/erasure/
portability, breach notification, retention) and which Waitron must *build* versus the venue must
*operate*. Blocks nothing today; the retention/erasure/export mechanics become build work once
scoped.

---

## Reference

**Adding a database test to a new package.** Give the suite `useVenueDb` and the migration sets it
needs; it makes its own temporary venue directory. A worker limit is still a per-package call, and
the reason that is left is the `@vitest/coverage-v8` cross-fork branch-merge artifact, which needs
`maxWorkers: 1` where a small package runs under `pnpm -r` oversubscription — the worked reasoning
is in #558's first commit message (2026-09-24). `packages/db` keeps `maxWorkers: 4`, which CI's
`test-heavy` shards inherit because they pass no worker count of their own. Either way a new package
that copies one of those configs must hold `98/98/98/95` (CLAUDE.md §2) — anything else and
`scripts/coverage-thresholds.test.ts` fails it in the ungated `lint` job.

**Specs still in the tree** (checked against the code 2026-09-27). A spec whose work is built is
deleted once nothing points at it; one stays while a developer doc or code comment points at it, or
while it holds decisions still open.

| Spec | State | Open work lives in |
| --- | --- | --- |
| [POS architecture](superpowers/specs/2026-07-18-pos-architecture-design.md) | the strategy; §2's sub-projects | *What's built* |
| [Workforce and time record](superpowers/specs/2026-07-22-workforce-and-time-record-design.md) | partly built; no clocking in | A10, A9 (wages) |
| [Deli hardware](superpowers/specs/2026-07-30-deli-hardware-design.md) | partly built; the outage path changed 2026-09-11 | A6 |
| [Nested sub-recipes](superpowers/specs/2026-08-16-nested-sub-recipes-design.md) and its plan | not started; parked; the plan predates SQLite and Vitest 4 | *Later and parked* (recipes depth) |
| [Expo device kind](superpowers/specs/2026-08-17-expo-device-kind-design.md) | not started; parked; written before device profiles | *Later and parked* |
| [Star CloudPRNT](superpowers/specs/2026-08-17-printing-cloud-poll-transport-design.md) and [Epson Server Direct Print](superpowers/specs/2026-08-17-printing-epson-server-direct-print-design.md) | not started beyond the `cloud_poll` columns; low priority | B6 |
| [Failover printing](superpowers/specs/2026-08-26-failover-printing-design.md) | partly built (the job lease, network printers any agent may claim, unprinted kitchen tickets shown on the till, #750) | B6, *Afterwards* |
| [Every device enrolled, fail closed](superpowers/specs/2026-08-30-device-auth-enrolment-fail-closed-design.md) | partly built; deferred | A4 |
| [Language fallback](superpowers/specs/2026-08-30-localization-fallback-negotiation-design.md) | partly built | A9 |
| [Native app capabilities](superpowers/specs/2026-08-30-native-app-capabilities.md) | reference; nothing committed | the go-native decision |
| [Logging and diagnostics](superpowers/specs/2026-08-31-logging-diagnostics-foundation-design.md) | Slice 1 built (#192) | A9, *Detail → Logging* |
| [Fiscal certificate distribution](superpowers/specs/2026-09-07-fiscal-cert-distribution-design.md) and its plan | reverted (#281); describes a removed mechanism | *Afterwards* |
| [Handheld app store and kiosk](superpowers/specs/2026-09-08-handheld-app-store-and-kiosk-findings.md) | reference; its own-phones decision reversed 2026-09-18 | — |
| [Box maintenance and remote support](superpowers/specs/2026-09-11-box-maintenance-and-remote-support.md) | discussion record; not started | B3 |
| [Failover prototype](superpowers/specs/2026-09-16-sqlite-failover-prototype-design.md) and its plan | done (#425); `bench/sqlite-failover` points at it | *Afterwards* |
| [SQLite + Litestream topologies](superpowers/specs/2026-09-16-sqlite-litestream-topology-design.md) | slices 1 and 2 built; 3 to 5 not started | *Afterwards* |
| [Handheld and till hardware decisions](superpowers/specs/2026-09-18-handheld-and-till-hardware-decisions.md) | decisions; the reader dropdown exists | A6 (Slice 2) |
| [Menus, sections and home layouts](superpowers/specs/2026-09-20-menus-categories-and-home-layouts-design.md) and its plan | built (#729 last); owner decisions still open | Track A (*Sales classification and the menus plan — what they left open*) |
| [Service, ordering and billing](superpowers/specs/2026-09-20-service-ordering-and-billing-design.md) and its plan | all 18 tasks landed (Task 17 last, #991); what they left open is under A4 | A4 |
| [Sales classification](superpowers/specs/2026-09-25-sales-classification-and-category-reports-design.md) and its plan | built (#738 last); a code comment points at it | Track A (*Sales classification and the menus plan — what they left open*) |
| [Bill payments](superpowers/specs/2026-09-26-bill-payments-design.md) | server built (#721); the till side built by lane B item B15 (#956) | A4 |
| [Print agent setup lockdown](superpowers/specs/2026-09-27-print-agent-setup-lockdown-design.md) and its plan | all three branches built (#732, P2b in #877, and P2c in #884); a real pairing at the box to go | A3 |

**Dev stack from a worktree.** `wa-wt demo|onboarding <worktree-name>` starts up to two isolated
stacks. `wa-wt ls` shows their ports; `wa-wt reset demo|onboarding <worktree-name>` rebuilds only
the named venue. The rule is in CLAUDE.md §6; detail in
[ui-review.md](ui-review.md) → *Running the stack from a worktree*.

## How to keep this file honest

Update it in the change that makes it stale (CLAUDE.md §7). In particular:

- When a piece lands, move it out of *What to work on next*, its track, and the *What's built*
  "Remaining" column — do not add a receipt paragraph. **This is state, not history; the git log is
  the history.**
- The moment it goes stale most reliably is a **merge**: `/land-branch` carries a step to update this
  file. A merge deletes the branch the in-flight rows named, so refresh them then.
- When a question is closed on primary source, say so and stop calling it blocked.
- Delete finished items. If an entry is growing proof-of-work (test counts, grep receipts, "proven by
  deletion", what a review seat caught), that belongs in the PR thread, not here.
