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

7. **Smaller, independent pieces**, in no fixed order: a dashboard screen for the modelo 303 download
   (*Detail → Reporting*); refusing requests from a device that is not enrolled (A4); the pairing
   alert, "devices tried to join" (A5); Logging Slice 2, the one-touch bug report (A9); the
   first real Bluetooth pairing at the box through the dashboard (A3; the print agent's side, P2b,
   and the dashboard's, P2c, are built); paying at the table from a handheld (A6, Slice 2).

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
- Sales classification, Tasks 1–3 (#645, #648, #738). The menus plan, Tasks 1–9 (#651, #654,
  #659, #664, #670, #680, #677, #683, #696, #710, #719, #722, #729), with M6c (#705), M7b2 (#702),
  M7b3 (#713, since retired) and M7v (#720); a line keeps its frozen VAT class and the rate is
  looked up by the day of issue, A68 (#726).
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
- Secret checks derive the key off the event loop (A126 #900, A125 #912, A146 #941); a product
  save reads the language setting once (A149, #943); `wt-tabs` sends `wt-tab-change` (A150, #937);
  undeclared token reads and the Cloud services typography and dates (C69 #865, C75 #867, C76 #879,
  C85 #896).

**Product folders, menus that include menus, and prep station routing: partly built
(design approved 2026-09-30).** The
[design](superpowers/specs/2026-09-30-catalogue-menus-routing-design.md) is built in slices. Slices
1, 2, 3a, 3b and 3c-1 have landed (above). Slice 3b ([#1024](https://github.com/clintongormley/waitron/pull/1024)) adds station opening hours, by-hand open and close, fallbacks, the till's dead-end question before sending or payment, and down-printer and dark-screen alerts; a station with no replacement asks the waiter where to make its dishes or to remove them. It follows the [approved plan](superpowers/plans/2026-10-01-station-hours-fallbacks-slice-3b.md) and needs no venue reset. **Owner decision (2026-10-01):** deleting only empty folders
stays immediate, including any routing rules attached to them; a confirmation is shown when the
selected folders contain products or subfolders. Each dev venue needs `wa-wt reset demo
<worktree-name>` after slices 1 and 2, and after slice 2 the owner's box needs a reset too: library
sections and their placements disappear and per-menu extras are retired. Reload tills running the
older build before using the new published document. What is left:

- **3c-2**, extras made at their own station, with the dish's and the extra's tickets naming each
  other ([plan](superpowers/plans/2026-10-01-split-off-extras-slice-3c2.md), starts once 3b has
  landed) — lane D's PF6.
- **3c-3**, "Make at" on any dish before sending, moving a dish that has not been started to
  another station (a slip at the old station whenever it was sent there), and re-routing a held
  dish whose station closed before it was released, which, with no replacement, goes to its old
  station with an alert ([plan](superpowers/plans/2026-10-01-moving-dishes-slice-3c3.md), starts
  once 3c-2 has landed; amended after approval so a dish made at the till is never moved or
  re-routed) — lane D's PF7.
- **3d**, watchers ([plan](superpowers/plans/2026-10-01-watchers-slice-3d.md)): named watchers on
  Prep Stations that screens and printers attach to, each with its own Done, Away unchanged, and
  the "one ticket per order" printer setting retired (owner, 2026-10-01); approved and queued as
  lane E's PF8, after 3c-3 lands.
- After approval the owner ruled that a dish made at the till is never held and the till lists
  what to make ("Make now"); 3c-2, 3c-3 and 3d were amended to match.
- **Three follow-ups 3c-1 left:** the kitchen screen's column view has no per-order card, so it
  does not show the rest of the order (a station that needs that context uses the card view);
  units added to a discounted pay-first dish held in a group get a held kitchen record of their own
  while the dish has none — observed on `main`, its history not checked, and whether it is wanted
  remains open; and a device's made-here stations do not travel in configuration export, because
  devices are not exported (`packages/db/src/configuration-transfer.ts:1-37`), so a venue set up
  from an export sets them again on the Devices screen.
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
- **The category sales report (#738).** The at-time-of-sale report is fetched again whenever the
  catalogue is edited: the dashboard declares a live query's dependencies per query NAME
  (`apps/dashboard/src/api/live-queries.ts`) and `getCategorySales` serves both modes. Fix: one
  query name per mode. `wt-button` disables only its inner `<button>`, so a scripted click on the
  host still reaches a click handler; the Sales screen's print handler checks for itself, other
  screens relying on `?disabled` alone have not been checked. The spec (§6) wanted the category
  analysis printable with the daily close, but no daily-close print exists.
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
- **The Prices tab (#670, #680).** The owner decided 2026-09-26 that removing a product's last
  placement needs no warning before it clears the menu price and variant settings. Open: the
  main-category filter offers every category, not only those on the menu; the product editor's help
  lines and the price window's `menu_prices.variants_help` are paragraphs beside their inputs, not
  linked to them (a `hint` shows only as the placeholder since C104, so moving them there would
  hide them whenever the field holds a value); a variant row is announced by its name alone; and,
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
  in a local dashboard coverage run and passed three times alone: an intermittent failure whose
  cause needs finding.
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
  whole invoice only; no route issues a correction for part of one.)_ **The owner's points for
  when this is designed (2026-09-29):** (1) the amount staff enter is what the customer gets back,
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

**Some secret checks still hold the venue's write lock while scrypt runs.** Every check against a
stored hash from `packages/identity/src/secret-hash.ts` derives the key with `verifySecretAsync` on
Node's thread pool. The print agent's token and the two join-status readers derive it with no
transaction open (A125, #912), and so does the device token (`tryReadDevice`,
`apps/server/src/device-session.ts`, menus Task 9). The PIN, manager-login and profile
checks still await the key while their caller's `withTransaction` (the write lock,
`packages/db/src/tenancy.ts`) is open, so other writes wait while the key is derived. A search on
2026-09-30 found every server route among them inside `withTransaction`: PIN login (`loginWithPin`
in `mountTillApi`, `apps/server/src/till-api.ts`), the drawer override (`POST /api/drawer/open`,
same file), the payments PIN re-check (`verifyManagerPin` under `gated`,
`apps/server/src/payments-api.ts`), the refund's override and PIN confirmation
(`refundBillPayment`'s first transaction, `apps/server/src/bill-refunds.ts`), manager login
(`apps/server/src/management-api.ts`, and `loginManagerById` in `promote-api.ts` and
`mirror-bundle-api.ts`), and profile changes (`updateProfile` in `apps/server/src/me-api.ts`, and
`withCredentialChange` in `apps/server/src/management-api.ts`). **Next action:** move them out of
`withTransaction`, as A125 did for the print agent. Still blocking the event loop: `hashSecret`
derives with `scryptSync` (`secret-hash.ts`), so minting a token or setting a PIN or password stops
the loop; and `deriveKey` (`apps/server/src/scrypt-kdf.ts`) runs `scryptSync` too, reached when the
server encrypts or decrypts a configuration bundle, decrypts a restore archive or a sealed node
state, or encrypts a recovery bundle. Left by #912's review: the two join-status readers answer from
a hash read just before the key is derived, so a request denied or revoked in that window can get
one stale `pending` or `approved` (both routes return only `{ status }` and issue no credential; the
till and print-agent clients were not traced); and `verifySecretAsync` could be renamed
`verifySecret` (optional).

**The till's removed-layout warning outlives a sign-out.** When the home layout a device's profile
chose is removed, the till warns until someone presses Dismiss. Signing out does not clear it
(`#onLogout` leaves `removedLayouts` as it is, `apps/till/src/till-app.ts`), so the next operator to
sign in on that device sees it. **Next action:** clear it in `#onLogout`, if the owner agrees the
warning belongs to the operator who was signed in.

**A section with nothing to order in it disappears from the till, and the tiles after it move.** The
menu browser leaves a section out, from the structure and as a shortcut, when no product beneath it
is among the offers it is given (`indexMenu`, `apps/till/src/widgets/menu-browser.ts`): when every
product in it is switched off on the menu, while a diet filter is on and every product in it fails
the filter (`apps/till/src/widgets/card-grid.ts`), and when every product in it is published as not
sold separately. A section whose products are all sold out keeps its place, and its tile is not
greyed; the products inside it are. Spec §5 wants buttons in predictable positions during service.
**Next action:** the owner decides whether either kind of empty section should keep its place, for
example greyed.

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
  layout pass, under A4).
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
  colour too, beside the ringed swatch (pinned in `category-form.test.ts`). **Next action:** try
  the first in Safari or Playwright's WebKit, and the second by hand in Chromium.

**The folding section jumps about when it opens (A169, owner 2026-10-01) — DONE (#1026).** `wt-disclosure`
(`packages/ui/src/components/wt-disclosure.ts`) now draws no border in either state, keeps its
heading and chevron in place when it opens (chevron at the row's end), and shows its summary under
the heading only while closed. The Options and Extras editors' "Customer and kitchen
names" line lists the names themselves (`ES … · EN … · Kitchen …`) instead of a count. The rule in
`docs/developers/design-system.md` is rewritten to match.

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
(everywhere)") — OPEN.** Two editors put the kitchen name inside one "Customer and kitchen
names" section with the customer-facing name in each language: an options list
(`apps/dashboard/src/widgets/option-list-form.ts`) and an extras list (`extra-list-form.ts`). The
window for one option (`option-label-form.ts`) was done with A170: Kitchen name sits directly under
Name there, and the window has no folding section. The product editor already keeps them apart — the kitchen name
is in its "Kitchen" section with course, the customer-facing names under
"Descriptors" (`product-editor.ts`) — and the variant form (`variant-form.ts`) has no section but
shows the kitchen name as its own field directly above the customer-facing names. **Decided
(owner, 2026-10-01, mockup B):** in the two list editors the kitchen name is a plain field, always
shown, directly under Name; only the customer-facing names stay in the folding section, now headed
"Customer-facing names". The product editor and the variant form already keep the two apart and are
left as they are. A170 added `options.customer_names` ("Customer-facing names", "Nombres para el
cliente") for the option window's heading. The section heading strings
(`options.names_section`, `extras.names_section` in `apps/dashboard/src/i18n/strings.ts`, English
and Spanish) change with it, and so does the closed section's summary: A169 (#1026) landed first
and its summary lists the kitchen name with the customer-facing names (`namesLine`,
`apps/dashboard/src/widgets/form-fields.ts`).

**A name field's hint shows what a blank field will actually use (A172, owner 2026-10-01) — OPEN.**
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
  `customerOptionSnapshotLabels`, `packages/catalogue/src/option-snapshot-labels.ts`). A hint
  must not show text the customer will never see, so this part needs the fallback itself to
  change to blank → main language's customer-facing name → Name, for every surface that
  reads these names (receipt, till, menus), plus `docs/developers/products.md`. The translation
  gap report (`listContentTranslationGaps`, `packages/catalogue/src/content-languages.ts`) counts
  "Spanish filled, English blank" as a gap today because English would show the staff name;
  whether it is still a gap once English falls back to the Spanish name is a decision to make
  with the owner before building. "Main language" here means the venue's default content
  language.
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

Today the options list, option and extras list editors (`option-list-form.ts`,
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
lists, Menus, Printers and print agents, Staff, Products, Adjustment reasons, and Venue operations'
departments, hours and a zone's menus), except the two left open below; a table with no Add action
keeps just the sentence. The till and setup draw no `wt-data-table`, so
nothing changed there. The empty case still shows the toolbar when the table has one, as before.
Left open: the Payments screen's readers table gets no button, because "Add reader" sits beside
each connected provider (none, one or several), so there is no single Add to put there, and the
list is pre-filtered by status; and the menu prices table on a menu's Prices tab gets none either,
because its rows come from "Add several products" on the Structure tab, shown for whichever menu or
section is open. Found while building it, and fixed in the same change: on the
Venue operations screen, adding a department, hours or a zone's menu from the top Add button left
keyboard focus on the page, because the screen tried to focus the button while it was still
greyed out (saving); it now waits until the list has reloaded.

**One fixed "nothing matches" sentence; a specific "nothing yet" sentence per screen (A177, owner
2026-10-01) — DONE (#1037).** Every `wt-data-table` on the dashboard and in the modules' screens now
passes `tableNoMatches()` from `@waitron/dashboard-kit` as its no-matches sentence ("Nothing
matches your search or filters." / "Nada coincide con tu búsqueda ni con tus filtros."), which is
also the table's own English default; the tables' per-screen `*.no_matches` strings and
`orders.empty` are gone. A filter alone, with nothing searched, does show that sentence (a test pins it). The empty
sentences now read "No <things> yet." in both languages, and the Venue operations screen's five
tables each name their own thing instead of sharing "No entries yet.", except its Tills table,
which leaves out revoked devices and kitchen screens and so says "No active tills." / "No hay cajas
activas." (owner's choice on #1037). Kept as they were, because
they answer a question rather than say nothing was made: the Alerts screen's two, the adjustment
report's, a printer scan's, the Servers screen's and a list's "No products use this list.".
Screens that filter before the table (Orders, the catalogue browser while searching, Users and
Payments while their filters hide what exists, and the Units delete dialog's products) show the
no-matches sentence themselves. Not covered: empty sentences outside a `wt-data-table` (floor,
kitchen, devices and others) still use "Aún no hay" and other shapes.

**An empty field's label is the same size as a typed value (A184, owner 2026-10-02) — DONE (#1035).** The
owner, on a screenshot of a form with Password and PIN empty: _"the fieldname inside the field is
font size 16px when a filled value is 14px"_. The `--wt-field-label-rest-size` token (16px) is gone:
a resting label now inherits the field box's font size, which is what the value inherits too
(`packages/ui-core/src/field-styles.ts`), and `wt-number-stepper`'s hidden copy of the label, which
widens its box, does the same. A test in each field primitive (`wt-input` as text and password,
`wt-textarea`, `wt-combobox`, `wt-price-input`, `wt-number-stepper`) compares the resting label's
size with the value's, then changes `--wt-font-size-md` and checks both follow. The phone-zoom
question below is about a field's TEXT, not its label, so this does not touch it.

**The setup wizard's review page is grouped, explained and readable (A185, owner 2026-10-02) —
OPEN.** The owner, on a screenshot of "Review and provision": _"This layout looks really messy"_.
Today `apps/setup/src/screens/review-screen.ts` is one flat list of sixteen label/value rows, shows
the receipt language as a code (`ca-ES`), says demo twice (a Mode row and a paragraph), and keeps
the old `.actions` button row, so Provision sits beside Back rather than at the trailing edge as
Next does on the earlier steps (`wt-form-actions`). **Decided (owner, 2026-10-02, choosing layout A
of three mockups):**

- the rows sit in boxed groups named as the steps that collect them — Business (legal name, tax
  ID, country), Location (name, address, receipt language, when the day ends), Invoicing (till,
  series, corrections series, invoice description, and the AEAT certificate outside demo), Your
  account (name, email; the display name only when it differs from the name) — each box with an
  Edit link back to the step that collects it;
- the mode is a badge at the top (Demo, Prepare or Live) with demo's one-line explanation beside
  it, replacing the Mode row and the demo paragraph;
- a language shows by its name ("Català"), never its code; "Rectificative series" reads
  "Corrections series" (Spanish wording to match);
- help: each box has a `wt-help-tooltip` saying in general what the group is, and each row that
  needs explaining has its own saying what that value does (e.g. the series: "Every invoice number
  starts with this: FS-000001, FS-000002…"). The owner: the tooltips float over the text and close
  when focus moves, and use the existing primitive, not a dark box. `wt-help-tooltip` is a popover,
  so it floats and closes on an outside click or Escape; whether it closes when focus TABS away was
  not checked — check, and add it to the primitive if not;
- Back and Provision move into `wt-form-actions`.

**The setup wizard's provisioning page is a page of its own with a spinner (A186, owner
2026-10-02) — OPEN.** Today `apps/setup/src/screens/provisioning-screen.ts` shows a status line and
a disabled primary button reading "Provisioning…". **Decided (owner, 2026-10-02, option P1):** a
centred spinner, the heading "Setting up <legal name>", the mode badge (Demo, Prepare or Live, as
the done page shows it), and "Keep this page open"; no button. Provisioning is one request that
reports no progress (`provision` in `apps/setup/src/api/client.ts`), so the page shows no steps.
The failed state is unchanged.

**The language chooser moves to the top bar, in every app (A187, owner 2026-10-02) — OPEN.** The
owner: _"instead of having the language chooser at the bottom, let's move it to the header on all
pages (not just in the setup)"_. This reverses the footer chosen on 2026-09-30 (C93, #933; the
till's B18, #1007). **Decided (owner, 2026-10-02):** the chooser sits at the trailing end of the
top bar — the setup wizard's card header beside the logo, the dashboard's banner before the alerts
bell and account menu (signed out too), the till's bar before the person's name — and on a
screen with no top bar, at the top right on its own. Which screens those are was not checked:
every screen that places `wt-language-footer` today (the till's lock, enrolment and counter
screens and the dashboard's sign-in screen among them) needs one or the other. It shows the full language name on wide screens and the short
code ("EN") at phone width (the owner: "the short name on handhelds", read as phone-width screens);
the open list names every language in full. `wt-language-footer` goes, and every page that places
it (`grep -rln wt-language-footer apps packages`) moves to the new chooser.

**In a demo, the dashboard's top bar links to the email inbox (A188, owner 2026-10-02) — OPEN.**
The setup wizard's done page already links to the demo's email inbox; the dashboard does not, so a
demo user cannot find the emails the dashboard sends. **Wanted:** an "Email inbox" link in the
dashboard banner, beside the language chooser (A187), shown only in a demo, to the same address the
done page uses.

**The sign-in screen's chosen email is drawn as a read-only field (A189, owner 2026-10-02) — OPEN.**
The owner, on the "Login with password" screen: _"the login screen doesn't use the new form field
layout. also, the Email/clintongormley@gmail.com isn't aligned with the text in the password field
which makes it look messy"_. The email above the password is plain text with a pencil button
(`#renderLoginContext`, `apps/dashboard/src/screens/login-screen.ts`), starting at the field box's
outer edge while a field's text is inset inside its box. **Decided (owner, 2026-10-02):** draw it as
a filled field that cannot be typed in — the same box, "Email" as its label inside, the address as
its value, the pencil ("Use another account") at the box's trailing end — so it lines up with the
password field by being the same shape. `#renderLoginContext` is also used by the reset and
account-setup page (`changeable = false`, no pencil), which takes the same look. `wt-input` has no
read-only mode today; add one to the primitive (it must still be announced as the email, and must
not look like an empty or disabled field), or a read-only variant of the field look, rather than
drawing a field in the screen (CLAUDE.md §3).

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
owner 2026-10-02) — OPEN.** The owner, on the passkey page: _"this page also looks a bit messy"_.
**Decided (owner, 2026-10-02, layout A of three mockups, then "i love it" to the version with more
providers):** this replaces C96's arrangement (one bulleted list, Log in on its first row).

- every step of `apps/dashboard/src/screens/login-screen.ts` sits in a white card with the Waitron
  logo above the heading, as the setup wizard's steps do;
- the method the page is for is the one primary button, full width;
- under an "or" divider, every other way in is a full-width outlined button with its own icon or
  logo ("Use your password", "Log in with passkey", "Continue with Google");
- "I've forgotten my password" is a small link under the password field on the password page,
  and appears nowhere else among the methods — not on the passkey page (owner: "we probably don't
  need it on the passkey page");
- the chosen email is the read-only field of A189;
- if the list of other ways in passes three or four, the outside providers (Google and later
  others) may become a row of logo-only buttons.

**Also wanted, if it holds:** "Continue with Google" on the first page, under the email field's
Continue, since it does not need the email. Today Google is offered only after the email step,
when the venue has it set up (`googleConfigured`). Check whether the Google sign-in needs the email
first; if it does, leave it where it is and say so in the PR. The login rules in CLAUDE.md §3 stand:
the first page shows the same choices to everyone. Sign in with Apple does not exist; the mockup
only showed where it would go.

**A focused table search box turns its own border blue, with no second ring (A192, owner
2026-10-02) — OPEN.** The owner, on two screenshots of the Modifiers screen's "Search extras
lists": _"Focusing on the search box adds a second thicker blue border. instead it should turn the
existing border blue."_ The box is `wt-data-table`'s `.table-search`
(`packages/ui/src/components/wt-data-table.ts`), which has a grey 1px border and no focus rule of
its own; no global focus rule was found in the dashboard or the tokens, so the ring is presumably
the browser's own focus outline — check in a real Chromium. **Wanted:** on focus the existing
border turns the primary blue and nothing is drawn outside it, as `wt-combobox`'s search box already
does (its `.search:focus-visible` rule: "Its own primary border is the focus marking"). Every table
with a search box gets it, since they all share this one. The focus must stay visible enough to
pass the primitive's axe test in both themes, and LOOK at it in both.

**A table filter's "Any …" choice is drawn as a chosen value, not a hint (A193, owner
2026-10-02) — OPEN.** The owner, on a screenshot of the Modifiers screen's status filter: _"The Any
Status shouldn't be a hint, it is a value that appears in the dropdown"_. `wt-data-table` gives
each column filter's `wt-combobox` a first option `{ value: "", label: allLabel }` and also passes
`allLabel` as its `placeholder`; the combobox reads an empty value as nothing chosen and draws the
placeholder in the grey italic prompt look (`.value.placeholder`,
`packages/ui/src/components/wt-combobox.ts`). **Wanted:** "Any status", and every table filter's
"Any …" choice, is drawn like any other chosen value. This is the shape A178h fixed for the
product's "Each" with a stand-in value (`__each__`); the "Uncategorised" and "No course" choices
noted under A178 below have it too. Pick one fix for all of them, in the combobox or the table,
rather than a stand-in per screen — and the filter's "nothing chosen" must still mean "no filter"
to the table's saved view (`#persistView`) and to `wt-filter-change` listeners.

**A table filter's dropdown keeps one width whatever is chosen (A194, owner 2026-10-02) — OPEN.**
The owner, on a screenshot of the Modifiers screen's status filter showing "Active" after "Any
status": _"the dropdown shouldn't resize based on the current value - it should be a fixed size"_.
`wt-data-table` sets no width on its `.table-filter` comboboxes, so each trigger is as wide as the
text it shows, and choosing a value moves every control after it on the toolbar. **Wanted:** each
filter keeps one width while its value changes. Read here, not confirmed with the owner: that width
fits the filter's longest choice, so no choice is cut; if one fixed width for every filter was
meant, ask. Measuring the longest choice is the combobox's job if it is to hold for every
dropdown, the table's if only for filters — decide which, and LOOK at phone width, where the
filters wrap below the search box.

**A table's pinned Actions column keeps one narrow width (A195, owner 2026-10-02) — OPEN.** The
owner, on a screenshot of a one-row table whose Actions column is wide, with the menu button in
empty space: _"The pinned Actions column should be a fixed size, not resizing and so adding extra
whitespace"_. `wt-data-table`'s `table` is `width: 100%`, so the browser shares the width the
columns do not need among all of them, the pinned `actions` column (CLAUDE.md §3, A155) included.
**Wanted:** the actions column is always as narrow as its content — the menu button and its
heading — and the spare width goes to the other columns. Its heading sets that width too, and
"Acciones" is longer than "Actions": LOOK in both languages, and at phone width, where the column
stays pinned at the screen's edge.

**A collapsible section's chevron sits just after its heading (A196, owner 2026-10-02) — OPEN.**
The owner, on the "Edit options list" form: _"the chevron (currently far right) should be just to
the right of the header, at the moment you don't see it"_. `wt-disclosure`
(`packages/ui/src/components/wt-disclosure.ts`) lays its header out as a grid of `1fr auto`, so on a
wide form the chevron sits at the far edge, away from the "Customer and kitchen names" heading it
belongs to. **Wanted:** the chevron directly after the heading text. It is the shared primitive, so
every collapsible section moves with it — the extras list form, the product editor and the content
languages screen as well (`grep -rln wt-disclosure apps`); LOOK at each, and at phone width.

**Clicking an option's row on the options list form opens that option (A197, owner 2026-10-02) —
OPEN.** The owner: _"clicking on the options rows should open the edit page, like the previous
screen"_ — the Modifiers screen's table, where a click anywhere on a row opens it (`wt-data-table`'s
row activation). The options list form (`apps/dashboard/src/widgets/option-list-form.ts`) draws its
own `<table>`. Since A170 a click on an option's name, which is a button, opens it as its row menu's
Edit does; the rest of the row does not. **Wanted:** a click elsewhere on the row, or Enter on the
row, opens the option's edit form too, while the drag handle, the Default radio and the row menu keep
doing their own thing. The extras list form (`extra-list-form.ts`) draws the same kind of table;
check it and give it the same if its rows open an editor.

**Clicking a product's row on the Products screen opens it (A205, owner 2026-10-02) — FOLDED INTO A208** (the category tree spec builds it; kept here for the owner's words). The
owner: _"clicking on a product row should open the edit screen"_. The Products table
(`apps/dashboard/src/widgets/product-list.ts`) gives `wt-data-table` no `rowClick`, so a product
opens only from Edit in its row menu; the Modifiers, Units and Orders screens already open a row on
a click (`wt-data-table`'s row activation). **Wanted:** a click on a product's row, or Enter on it,
does what Edit in that row's menu does — a variant's row opens that variant, as its own Edit does.
The drag grip, the dragging of a row onto a folder, the selection checkbox and the row menu keep
doing their own thing, and a drag that ends where it started opens nothing. Read as: a click on a
folder's row opens the folder, as its name does today — ask if folder rows were meant to stay as
they are. LOOK at 1280 and 390, light and dark.

**The dashboard recovers by itself when the server comes back after a restart (A206, owner
2026-10-02) — OPEN, not reproduced.** The owner: _"when i restart waitron the dashboard says
"couldn't connect to waitron", but then it doesn't keep trying. i had to refresh the page"_. The
message is `connection.failed`, raised by the shared request helper when a request gets no answer
at all (`packages/dashboard-kit/src/request.ts`). The live connection already retries on its own,
backing off up to 30 seconds (`packages/dashboard-kit/src/live-connection.ts`); read, not run: what
looks to stay stuck is the request that loaded the screen, which nothing tries again. **Wanted:**
while the server cannot be reached the dashboard keeps trying, and once it answers again the message
goes away and the open screen reloads its data, with no page refresh. An unsaved edit in an open
form is kept. **First** reproduce it: the dashboard open on a few screens (a table screen, a form,
the Backups screen), restart the server, and note which ones stay stuck, and whether the live
connection's return reaches them.

**The Products screen as a category tree (A208, owner 2026-10-02) — OPEN, spec approved in
conversation, written.** The owner, on two screenshots: _"this layout is messy, needs tidying"_,
with folders that open in place, a clearer drag, adds from each category's ⋮ menu and prices that
show their unit. Spec:
[2026-10-02-products-category-tree-design.md](superpowers/specs/2026-10-02-products-category-tree-design.md).
It builds A205 (a product row's click opens it) and replaces A207 (a blue Add product button in the
header), which the owner cancelled: the header loses that button.

**The options list form's drag-handle column stays narrow (A198, owner 2026-10-02) — OPEN.** The
owner, on two screenshots of the same three options, the Name column starting far to the right
until one name is long enough to push it left: _"the drag handle column shouldn't auto-expand, so
the Name column would start just to the left of it"_ (read as: just to the right of the handle).
The form's table sets no column widths, so the browser shares the spare width among the handle,
Default and menu columns. **Wanted:** the handle, Default and menu columns as narrow as their
controls, and Name taking the rest. Same check on the extras list form's table. A195 asks the same
of `wt-data-table`'s Actions column; one approach for both is welcome.

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
OPEN.** The owner: _"when rendering the names block "EN Medium, pink in the middle · ES Al punto,
rosado por dentro · Kitchen AL PUNTO", add a colon after each field: "EN: Medium, pink in the middle
· ES: Al punto, rosado por dentro · Kitchen: AL PUNTO", and maybe make the field names bold"_. The
line is built by `namesLine` (`apps/dashboard/src/widgets/form-fields.ts`), used by the options
list and extras list forms (the option form stopped folding its names with A170). **Decided (owner, 2026-10-02, choosing B of three mockups,
"although C is good too"):** "EN:", "ES:" and "Kitchen:" (Spanish "Cocina:") in bold, the values
in the summary's usual muted text. (C, the field names in full-strength text rather than bold, was
the runner-up.) Bold needs markup, and `wt-disclosure` takes its `summary` as a plain string; give
the primitive a way to take the parts (a slot, or name/value pairs) rather than building markup in
each screen.

**The product editor's folded sections follow the same pattern, with real values (owner,
2026-10-02):** _"regarding products, i think we should include the field values not just the fact
that they're filled in, and we should show a thumbnail of the image too"_. Today
`product-editor.ts` writes the Kitchen section as "SOLOMILLO · Mains" and the Descriptors section as
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
  picker should move out of the descriptions box i think"_). Today `dashboard-image-upload` is
  drawn inside that section, with its error under it, and `SECTION_FIELDS.descriptors` lists
  `image`, so an image error forces the section open; both move with the picker, and an image
  error then shows beside the photo. The picker is drawn only when the editor has an `api`; the
  photo's slot needs a state for that too. With no photo, the slot shows a placeholder that still
  opens the picker (the list's `thumb-placeholder` look). A variant with no photo of its own shows
  its parent's (`inheritedImage`), and it must be clear that it is inherited. It is a button: a tap
  target, a focus ring, and a name a screen reader reads ("Change photo" / "Add photo").

LOOK at it at phone width, where a long English description leaves little room for the Spanish.

**Choosing a product in an extras list adds it at once (A201, owner 2026-10-02) — OPEN.** The
owner, on a screenshot of the extras list form's "Choose a product" dropdown beside an "Add
product" button: _"make the hint text say "Add a product", remove the button. if you select a
product in the dropdown it gets added automatically. if you close the chooser without selecting
then nothing happens"_. Today (`apps/dashboard/src/widgets/extra-list-form.ts`) a choice is held in
`pick` and only the button's `#addItem` adds the row. **Wanted:** the dropdown's prompt reads "Add
a product" (Spanish to match; `extras.choose_product`), choosing a product adds its row straight
away and the dropdown goes back to its prompt, and closing it without a choice adds nothing; the
button and `extras.add_item` go. Focus stays on the dropdown after an add, so a keyboard user can
add the next product, and the new row is announced (the form's live region). The menu screen's
members editor (`member-list-editor.ts`) has the same choose-then-Add pattern; ask whether it
should change too.

**The number field's − and + move inside the field, as pale blue buttons (A202, owner 2026-10-02)
— OPEN.** The owner, on a screenshot of the extras form's Minimum and Maximum choices: _"the +-
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
(`grep -rln wt-number-stepper apps`), in both themes and at phone width.

**An extra is a fixed portion: a product sold by weight is offered as, say, 50 g a pick (A203,
owner 2026-10-02) — OPEN.** The owner: _"today you can add an extra sold eg per kg, but there is
nowhere to put a quantity in there. i think extras should always be a fixed amount, so eg if i add
Jamon @ 100€/kg, we should enter the base amount of (eg) 50g, and when you add it multiple times you
get 50->100->150 etc"_. **Today, read from the code (not reproduced):** an extras list item holds
only `productId`, `maxQuantity`, `preselected` and `price` (`packages/catalogue/src/schema/extras.ts`);
the till offers a whole count; nothing on the extras path reads the extra product's unit
(`readExtraProducts`, `packages/catalogue/src/offered-modifiers.ts`; `buildLineExtras`,
`apps/server/src/modifier-selection.ts`); and `grossBasketWithOptions`
(`packages/catalogue/src/pricing.ts`) charges the item's price, or else the product's unit price, ×
the count × the dish count. So a per-kg product offered with no price of its own is charged its
whole per-kg price per pick, as if each pick were a kilo. The extras list editor shows the unit
beside the price and checks nothing about it.

**Decided (owner, 2026-10-02):**

- an extras list item for a product whose unit is weighed (`hardwareUnit` set) or fractional
  (`precision > 0`) has a required **portion**, e.g. 50 g, held to the unit's precision; an "each"
  product's portion is one and the form asks for none;
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
  their own inherit — shows the extras lists that offer it, because the stored portion is a number
  in the old unit (50 in g becomes 50 kg). The units screen already lists the products using a
  unit (`ProductUsingUnit`, `packages/catalogue/src/unit-types.ts`); the same applies when a unit's
  own precision changes under portions held to it. The save is
  neither blocked nor are those portions cleared: it warns and saves (owner, 2026-10-02: _"it
  should just warn and save"_).

**For the builder:** the portion is a new column on `extra_list_items` (quantity scale) and a
field in `parseExtraListInput` and the editor; the till's picker and the server must compute one
per-pick price the same way, rounded to the cent once, before it is multiplied, so they agree.
The stored child line's quantity (`working_order_lines.quantity`, already thousandths) becomes
picks × portion × dish count with the product's unit on it, so `editLineExtras` must divide by the
portion as well as the dish quantity, and the receipt's `perDishOptionQuantity` (whole numbers)
and the kitchen ticket's `extraLabel` must print an amount, with the unit's abbreviation. The
amounts reach a sale record, so this takes the full review path (risk trigger: fiscal invariants).

**A menu's hours per location, and a publish date for a new version (A204, owner 2026-10-02) —
OPEN, not designed.** The owner: _"we should be able to specify what times of of which days each
menu is live in each location, and a publish date for a new version of a menu"_, and _"that can be
a backlog item for now"_. Today publishing is immediate: `menu_publications` holds each menu's one
live version (`packages/catalogue/src/schema/publication.ts`), and the SP18 row of the roadmap
table below lists "menu schedule" as not done. **Wanted:**

- per location, the days of the week and the times of day each menu is live (e.g. the lunch menu
  Monday to Friday 13:00–16:00 at one location only);
- a new version of a menu can be published with a future date and time, going live then rather
  than at once, while the current version stays live until it does.

Station opening hours (slice 3b, #1024) already store per-weekday intervals
(`station_hours`, `packages/venue-service/src/schema/station-times.ts`); reuse that shape rather
than invent a second one. Not looked into: how a till chooses its menus today, what a till shows
for a menu outside its hours (an order already open on it, a held dish), the business day that
ends after midnight (`when the day ends` in setup), and what a scheduled version does if a newer
one is published before it goes live. Needs a brainstorm and spec before building.

**The product editor, tidied: eleven changes from one walk-through (A209 to A219, owner
2026-10-02) — OPEN.** The owner, on six screenshots of "Edit product" for "Cured beef cecina (per
kg)". All eleven are in `apps/dashboard/src/widgets/product-editor.ts` unless another file is
named. All eleven were settled from mockups on 2026-10-02 (A216 on the reading below); the
decisions follow each entry. A214, A217 and A219 all reshape the Pricing section: build them
together.
LOOK at each on a product AND on a variant's page (the editor shows a variant with "Same as …"
choices), at 1280 and 390, light and dark.

**No Add category button, and the category shown as a path (A209) — DECIDED, ready to build.**
The owner: _"we no longer need the add category button. i'm questioning whether we need the
category dropdown at all now that we can drag products from category to category (although we
should show the path to the product eg Drinks > Alcoholic drinks > Cocktails) on that page"_. A
product has one category (`products.categoryId`). **Decided:** the Add category button goes, with
`editor.add_category`. **Wanted:** the product's full path, "Drinks › Alcoholic drinks ›
Cocktails", shown on the editor. **Open, ask before building:** whether the "Main category"
dropdown goes too. Two things it does that dragging may not: a variant's empty category means its
parent's, and the dropdown is where a variant is given a category of its own — check whether
A208's tree can drag a variant on its own before dropping it; and a product made from "All
products" has no category until it is dragged. **Clash with A208:** its spec keeps the category
form (`apps/dashboard/src/widgets/category-form.ts`) for one reason, this button, so if this
lands after A208 the form has no caller left; if it lands before, A208's spec and plan change
too.
**Decided (owner, 2026-10-02, from mockups, choosing B of three):** the "Main category" field
goes. Under the window's title the product's path reads "Drinks › Alcoholic drinks › Cocktails"
with a small "Change" link after it; Change opens the category list as an indented tree, anchored
at the path text (the owner: _"the dropdown should start from the category text"_), not below the
Name field. **A variant always has its product's category** (owner: _"i'm not sure that's a good
idea. maybe we shouldn't allow editing that"_): a variant's page shows its product's path as plain
text, with no Change. That retires the variant's own category everywhere — the server's
resolution of a variant's reported category (`variant.effective`, which the Products list and
reporting read) becomes "always the product's", and variants holding a category of their own are
cleared (allowed before go-live, §3). Trace every consumer of a variant's `categoryId` first.

**Standalone ordering becomes one dropdown (A210) — OPEN.** The owner: _"Standalone ordering can
be reduced to a single dropdown"_. Today `renderOrdering` draws three radio buttons, Public, Staff
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

**A folded section says what is missing, not only what is filled in (A211) — OPEN.** The owner:
_"we should show the missing values under kitchen and descriptors and nutritional info when
collapsed"_. Today each folded section's line lists only the filled values
(`renderKitchen`, `renderNutrition` and the Descriptors section), so a product with no kitchen
name, course, allergens or dietary preferences shows a heading and a blank line. **Wanted:**
every field is named on the line whether or not it has a value, e.g. "**Kitchen name:** none ·
**Course:** none", "**Allergens:** none specified · **Dietary preferences:** none specified". Build
it with A200's product-editor decision above (each value after its bold field name, the
Descriptors line one row per field), which this extends to the empty case. Choose the wording for
"nothing set" once, in both languages; on a variant's page an empty value means "same as the
parent" and must say so, as the fields themselves do.

**An Add course button beside the course dropdown (A212) — DECIDED, ready to build.** The owner:
_"perhaps we should add an "Add course" button under Courses, which would open a modal to edit
and order the course list. Currently this lives on the kitchen page, not as a modal. need to
figure that out"_. The course list is edited, added to and reordered on the Kitchen screen
(`apps/dashboard/src/screens/kitchen-screen.ts`, its "Kitchen courses" section). **To decide:**
whether the dialog reuses that screen's editor (moved into a widget both use) or the course list
moves into the dialog alone and the Kitchen screen opens it too; and what the dropdown does when
the dialog closes — select a course just added, keep the choice if it still exists. Unsaved edits
to the product must survive the dialog, as they do around Add unit today (`related()`).
**Decided (owner, 2026-10-02, choosing B of three):** the course dropdown ends with "Edit
courses…", drawn like A218's make-new choices, which opens a window holding the whole course list:
drag to reorder, click a name to rename it, ⋮ to remove one (today's deactivate), and Add course
at the bottom. The Kitchen screen shows the same list, replacing its one-card-per-course layout
with its own Save buttons and typed-in order numbers — so the list is one widget both use.
Closing the window selects a course just added, and the product's unsaved edits survive it.

**Allergens and dietary preferences are edited in place (A213) — OPEN.** The owner: _"for
nutritional info, we can show: Allergens: Nuts, Seeds / Dietary preferences: None specified. And
when you click on one it converts into a multi-value combobox (ie no need for the Edit button)"_,
and _"each one doesn't need a box around it, like we've removed them for descriptors etc"_.
Today `dashboard-allergen-dietary-picker` (`allergen-dietary-picker.ts`) draws a bordered card
for each with "None selected" and an Edit button. **Wanted:** two plain lines, "Allergens: Nuts,
Seeds" and "Dietary preferences: None specified", with no card and no Edit button; clicking or
pressing Enter on a line turns it into a `wt-combobox` with `multiple` set, and leaving it turns it
back into the line. Each line is a button for a keyboard and a screen reader ("Allergens: Nuts,
Seeds, edit"). The product picker offers no "may contain" today (only the ingredient form's
`allergen-picker.ts` does), and the draft keeps each allergen's stored presence when the list
changes; keep that. A variant's "Same as …" hints (`nutritionHints`) stay meaningful.

**No box around Pricing (A214) — OPEN.** The owner: _"Pricing also doesn't need the box around
it"_. `renderPrice` draws a `fieldset class="bordered-group"` with a "Pricing" legend. **Wanted:**
no border; the section keeps its heading, drawn like the editor's other section headings. Check
that nothing else uses `.bordered-group` before deleting its styles, and that the comment about a
fieldset's minimum width (the variants table) still applies to whatever replaces it.

**Clicking a variant's row opens its edit window (A215) — OPEN.** The owner: _"variants when
clicked should open the edit modal"_. In `variant-table.ts` a row's click does nothing today; its
menu holds Open (the variant's own page), Edit (the edit window, `wt-edit`) and Remove or Restore.
**Wanted:** a click on the row, or Enter on it, does what Edit does. The drag handle, the
Available switch and the row menu keep doing their own thing, as A197 asks for the options list.

**The price's unit button says "Each" or "per kg", never "per Each" (A216) — OPEN.** The owner:
_"I don't like "per Each", it should either be "Each" or "per Unit""_. The button text is
`editor.per_unit` ("per {unit}") filled with the unit's short label, which is "Each" when the
product has no unit. **Read as, not confirmed:** with no unit the button says "Each" (Spanish
"Unidad"), with a unit "per kg" ("por kg"); ask if "per unit" was meant for the no-unit case
instead. The field's label has the same shape — "Price per Each", "Base price per Each"
(`editor.base_price_unit`, `priceLabel`) — and is read as wanted the same way: "Price" with no
unit, "Price per kg" with one.

**The variants' status filter becomes a "Show inactive" link (A217) — DECIDED, ready to build.** The owner:
_"the Variant status filter looks a bit messy where it is placed"_. The "Show variants" dropdown
(`variant-status`, `variant-table.ts`) stands alone between the base price and the table. Offer
mockups: for example in the table's header row, beside the Add variant button, or shown only once
some variant is inactive. Keep its rule that a reported problem or a variant just added never sits
on a hidden row.
**Decided (owner, 2026-10-02):** the "Show variants" dropdown goes. A "Show 1 inactive" link sits
beside Add variant, there only while some variant is Inactive (Remove in a row's menu makes a
saved variant Inactive; Restore brings it back, and this link is the only way to reach it). The
wording is "inactive", to match the rest of the dashboard (owner).

**"New extras list…" and "New options list…" leave the modifier dropdown's list (A218) — DECIDED,
ready to build.** The owner: _"i don't like the new extras list and new options list in the
modifiers dropdown. how else could we organise those? at the very least they should be at the end
of the list, separated from the others with a line. could we make it a single "add new
modifier"? although then we'd need a second click to choose which, or to open a modal with two
tabs or something"_. Today the two actions (`editor.create_extra_list`,
`editor.create_option_list`) are the first two choices in "Add extras or options", above the
lists themselves. **The minimum:** they move to the end, after a dividing line, which
`wt-combobox` cannot draw today (it has group headings, no divider). Mock up the alternatives for
the owner: that minimum; one "New modifier…" choice opening a window with Extras and Options
tabs; and a "New modifier" button beside the dropdown instead of inside it.
**Decided (owner, 2026-10-02, choosing A of three):** the lists sit under "Extras" and "Options"
group headings (`wt-combobox`'s existing `group`), and each group ends with its own make-new
choice, "+ New extras list…" and "+ New options list…", drawn in the primary blue so it does not
read as a list. No divider is needed.

**With variants, Pricing folds and Variants becomes its own section (A219) — DECIDED, ready to build.**
The owner: _"when we have variants the vat and base price and status filter are overwhelming.
they overshadow the variants, which are the interesting bits. perhaps they should be collapsed?"_.
Once a product has an active variant, the base price is the price each variant falls back to
(the label switches to `editor.base_price_unit`), and VAT and the base price fill the top of the
Pricing section above the table. **Wanted:** with variants, VAT and the base price fold into one
line above the table, in A211's pattern (e.g. "**VAT:** Reduced (10%) · **Base price:** €38.00
each"), opened by a click; the variants table and Add variant are what the section shows. Without
variants nothing changes: VAT and the price stay open, since they ARE the product's price. The
status filter is A217's question; mock up both together. A VAT or base-price error must open the
fold, as an error in a folded section does today (`SECTION_FIELDS`), and a new product with
variants but no VAT yet starts with the fold open.
**Decided (owner, 2026-10-02, choosing A of a second round):** the price comes before VAT,
everywhere. Once a product has a variant, the whole Pricing section folds like Kitchen or
Descriptors — heading and arrow, then a muted line "**Base price:** €38.00 per kg · **VAT:**
Reduced (10%)" — not as a grey box, which reads as a field (the owner). The variants move to
their own section, "Variants", below it and always open, ending with Add variant and A217's link.
Without variants, Pricing stays open as today and Variants is just the Add variant button.

**The kitchen and customer name fields show the staff name as their hint (A220, owner 2026-10-02)
— OPEN.** The owner: _"the Kitchen name, and customer facing names aren't showing the internal
name as the default value, at least when I add a variant and fill in the internal name the first
time"_. A blank kitchen name or customer name falls back to the staff name
(`kitchenPresentationName` and `customerPresentationText`,
`packages/catalogue/src/product-presentation.ts`), but no field says so: the product editor's
header comment states "The names are never hinted", and the variant window
(`apps/dashboard/src/widgets/variant-form.ts`) sets no hint on them either. **Wanted:** while a
kitchen or customer name is blank, its field shows what will be used instead, as a placeholder
that follows the staff name as it is typed — on a product, on a variant's page and in the variant
window. The placeholder must say what `product-presentation.ts` would print, not a second rule: a
variant falls back to its OWN name, never its parent's kitchen or customer name; and the customer
name falls back only in the venue's default language, so decide with the owner what the other
languages' fields show (blank, or the default-language name the reader falls back to). Read, not
reproduced: "the first time" may mean the hint is missing only on a new variant; check an
existing one too.
**Decided (owner, 2026-10-02):** a customer-name field in another language shows the
default-language name as its hint, _"which is what we'd show on the menu anyway if it is missing"_
(the owner's account of the menu; check it against the reader before relying on it). The kitchen
name shows its hint too (read as: the staff name, which is what `kitchenPresentationName` prints;
ask if the default-language customer name was meant). **And descriptions:** a description field
in a secondary language shows the default-language description as its hint (owner). Today the
description fields hint only on a variant's page, with the PARENT's text
(`descriptionHints`, `renderDescriptors`); decide which hint wins on a variant whose parent has a
description and whose own default-language one is filled in, and check what the menu shows for a
missing description before claiming the hint matches it.

**Variants in the Products list look like part of their product (A221, owner 2026-10-02) — OPEN,
designed.** The owner, on a screenshot of an opened "Cured pork loin" with its variant "More
pork": _"it is there, but it doesn't look very good"_. `product-list.ts` gives each variant a row
nested under its product, folded shut at first (`initiallyCollapsed`); today the toggle is a heavy
black triangle far to the left, the variant's name starts left of its product's in the same bold,
and its row repeats "Made at" and fills the rest with "—". **Decided (owner, choosing B of two
mockups):** a small arrow next to the photo; a product with variants says "2 variants" in muted
text under its name; the opened variants sit on a faint tinted band under their product, each
name lined up under the product's name in normal weight; a variant's row shows only its price,
status and row menu — no Made at, no dashes. A208 rebuilds this table: build this with it or
after it, not against today's version. **Also check:** in the same screenshot "Cured beef cecina"
had no arrow, though the owner's editor had shown a variant "Some difference" on it — either it
was not saved yet or the list misses it; reproduce before assuming either.

**A variant always has its product's unit (A222, owner 2026-10-02) — OPEN.** The owner:
_"currently variants can have different units from their parents. i think that's a bad idea"_.
A variant's page offers its own unit today (`renderUnit` in `product-editor.ts`, whose blank
choice is "Same as …"). **Wanted:** a variant takes its product's unit and cannot set one; the
field goes from the variant's page and the variant window, the server refuses or ignores a
variant's unit, and variants holding a unit of their own are cleared (allowed before go-live,
§3). The unit decides how a line's quantity and price are worked out, which reaches a sale
record, so this takes the full review path (risk trigger: fiscal invariants); trace every reader
of a variant's `unitId` first. A203 (extras as a fixed portion) allows for a variant's own unit
("or a parent's, which its variants without their own inherit") and gets simpler. The owner also
noted the Products list shows no unit in its price column; A208's spec already has it ("€19.00
each", "€48.00 / kg").

**A product with variants is not offered in an extras list's product dropdown (A223, owner
2026-10-02) — OPEN.** Today the dropdown (`extra-list-form.ts`, `#itemsSection`) offers every
top-level product, but saving a list that names one with an Active variant is refused with
`extras.product_has_variants` (`assertNoParentsWithVariants`, `packages/catalogue/src/extras.ts`),
because the till never offers such a product as an extra (`readExtraProducts`,
`packages/catalogue/src/offered-modifiers.ts`). Read, not run. The owner declined offering the
variants themselves as choices. **Wanted:** such a product is left out of the dropdown, or shown
greyed and unpickable — the owner asked which; recommended: greyed, with A210's second line
saying why ("Has variants, so it can't be an extra"), so a search for it does not just come up
empty. That needs `wt-combobox` to draw a disabled option, which it cannot today. **Also:** a
product already on a list that later gains its first Active variant is silently dropped by the
till; the list form should mark that row.

**Form fields after A178 (#1010 to #1019).** Done: A178g (#1021), a stepper's box widens to fit its
label, and in a row too narrow for it narrows again, never below `--wt-stepper-field-width`, and
cuts the label. Done: A178h (#1023), "Each" on a product and in the variants table's unit heading is drawn as
a chosen value rather than the grey prompt (the dropdown gives it the stand-in value `__each__`, and
a save still stores no unit); a variant's "Same as …" keeps the grey look. **Seen while building,
not changed:**

- on a product of its own, the main category's "Uncategorised" and the course's "No course"
  choices still have the empty value, so the shared dropdown draws them as the grey prompt when
  chosen, as Each was; the owner's answer on A178c (2026-10-02) asked for the stand-in for Each
  alone;
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
- **for the owner:** the venue operations kitchen tab's two dropdown explanations ("Applies to new
  kitchen tickets and to reprints." and the release reminder's) are now each dropdown's `hint`,
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
`--wt-font-size-xl`. Left alone on purpose, sized in `rem`: the till's enrolment number, setup's
cloud-recovery code, and the done screen's break-glass heading and code. **Phone check, the
owner's to do (2026-10-01: "i'll test phones later on"):** Safari on iPhone is widely reported to
zoom the page in when a field whose text is under 16px is focused — not yet tried here. If it does,
the usual remedy is to keep field text at 16px on small screens only.

**Build order for the owner's 2026-10-01 items (owner: "yes, all good"):** A178, A175 (#1029),
A169 (#1026), A176 (#1033), A177 (#1037) and A170 (#1040) are done; next A171 and A172, built in
the new style rather than restyled twice.

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
- **Raising a held line's quantity does not check the line's variant, or whether its menu, or the
  menu's own switch for the product (`menu_items.active`), has been switched off** — only its
  parent product and extras. **Next action:** on a quantity raise, check the line's own product for
  Active and Available, its menu, and the menu's switch for the product.
- **The units screen lists variants too, and offers them a target labelled as Each.**
  `productsUsingUnit` (`packages/catalogue/src/units.ts`) does not limit itself to top-level
  products; for a variant, the "Each (no unit)" target (`REASSIGN_EACH`,
  `apps/dashboard/src/screens/units-screen.ts`) means "follow the parent's unit", which may be kg.
  **Next action:** decide whether the units screen should list variants, and how to label that
  target for them.
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
- **The product list.** It shows "—" for a variant's allergens (`ListedVariant`,
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
  synthetic `EACH_UNIT` id is a literal in both `packages/catalogue/src/units.ts` and the till's
  `product-name.ts` with nothing pinning them equal.
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
  the wordmark is near-invisible in the dark theme, "Top sellers" is rendered twice on the overview,
  the login screen shows an error before anything is submitted, and the recipe screen is not routed
  from anywhere.

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
- **`packages/fiscal-verifactu`'s `venue-fields.ts` restates three rules the validator owns** (the
  series-code set, the description cap and the control-character range), kept honest by a drift guard.
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
- `OLD_BOX_PROBLEM` (`apps/setup/src/screens/old-box-question.ts`) is kept, English only, because
  `cloud-restore-screen.test.ts` imports it; the screens call `oldBoxProblem()`. Point the test at
  the function and delete the constant.

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
the column, `locations.time_zone`, is plain text, and configuration import checks only that the
value is a string (`apps/server/src/configuration-transfer.ts:297-309`), so an imported file can set
a zone no pack offers; provisioning copies whatever it is given (`packages/provisioning/src/venue-apply.ts`).
Readers then disagree about a bad zone: reporting throws, bookings falls back to Madrid, account
emails to UTC. **Wanted:** each country pack lists the zones it allows (Spain: Madrid and Canary),
and every writer of a venue's time zone — setup, configuration import, provisioning — refuses one
not on its country's list. A dropdown is needed only if a venue could ever need a zone other than
its province's; for Spain the province decides. (Aside: a Canary venue cannot be set up yet — the
pack marks the Canary tax territory unsupported.) Slice 3b's station opening hours ignore hours
when the zone cannot be read, as a last defence
([plan](superpowers/plans/2026-10-01-station-hours-fallbacks-slice-3b.md), S8).

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
    short at any width. A deep category sales page printed about 1,000 lines in a test.
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
- **The Edit-printer dialog follows the dashboard's own language, not the venue's** (ruling I) — a
  recorded departure from the spec, which asked for the venue language.
- **Still counted by the printer's `printer.jobs_waiting` alert after A167 (#975)**, measured with
  throwaway cases and not pinned: (1) when every dish a failed ticket carried for a station moves to
  another bill, that bill's printed Reprint clears the table's problem, but the ticket's link to the
  bill it was fired on is never covered, so the printer's alert keeps counting it. The table also
  drops a problem once a Reprint would print nothing there (`readReprintTargets`), which the alert
  does not. (2) A Printers-screen resend of a kitchen ticket carries no kitchen links, so when that
  resend runs out of attempts, a later printed till Reprint does not clear it from the printer's
  alert (the table clears).
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
- **Left open by C109 (#960):** the edit dialog's Active switch can still switch a paired Bluetooth
  printer off without unpairing it. Leaving the Printers screen mid-calibration asks the server to
  switch the printer off; if that request fails nothing reports it and the printer stays on, and
  closing the browser tab mid-wizard does not switch it off. Leaving the screen while a Save is in
  flight and that save then fails, or in the moment between Add again switching the printer on and
  the wizard opening, also leaves it on. While it is on during calibration, jobs already queued for
  it can be handed out (since A163, jobs a succeeded Unpair ended no longer print; jobs kept in the
  cases the next item lists, and a printer switched off with Disable, can still print after Add
  again). Keeping the printer off until calibration is saved would need a calibration-only
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
- Read-back gaps: the per-till printer picker is not location-filtered; the print-mode and
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
  - **The Tab drawer's transfer picker marks a picked line with `aria-pressed` on a `wt-button`**
    (`#transferLineRow`, `apps/till/src/screens/till-table-order-screen.ts`), and so does the split
    picker (`#splitLineRow`). `wt-button` does not pass `aria-pressed` to its inner button
    (`packages/ui-core/src/components/wt-button.ts`), so a screen reader does not hear whether a
    line is picked. The draft's line toggle was changed to a plain button; these two were not.
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
    - The kitchen-ticket grouping setting sits on Venue operations' **Changes after sending** tab,
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
    - **The till still lists two approver refusals it can no longer receive:**
      `APPROVER_REFUSALS` in `apps/till/src/till-app.ts` names `person.not_found` and
      `person.suspended`, which an approver's PIN check stopped returning when every login failure
      became `pin.invalid` (C95, #930). **Next action:** drop the two entries.
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
      are separate, or that the count is per till. **Next action:** the owner decides whether to
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
    - **Only give-aways and discounts split a dish's extras with it.** Splitting a bill,
      transferring items and moving part of a dish to another group still refuse part of a dish
      with extras (`tab.transfer_modifier_line`). **Next action:** decide whether those moves
      should split extras too.
    - **Two dashboard tests have the Escape flake fixed in Task 11** (a check made before the
      browser's close report arrives with the next animation frame): "saves on Enter and cancels on
      Escape from a focused field" in `apps/dashboard/src/widgets/variant-form.test.ts`, and
      `pressEscape`'s fixed 50 ms wait in `packages/ui/src/components/wt-dialog.test.ts`. **Next
      action:** wait for the close event there too.
    - The till's "Amount off (€)" writes the euro sign into the label rather than taking the
      venue's currency. How a comp or discount appears on the invoice is still asesor Q29.
  - **Eight till tests wait a fixed real time for a round's retries** (found 2026-09-30, B13). They
    slept `2 * SUBMIT_RETRY_PAUSE_MS + 50` ms while the retries pause on real time, in
    `apps/till/src/till-app-drafts.test.ts`, `till-app-menu-refresh.test.ts` and
    `till-app-parties.test.ts`; two more in `apps/till/src/till-app-adjustments.test.ts` sleep on an
    adjustment's resends. On 2026-10-02 `git grep 'setTimeout(resolve, 2 \* SUBMIT_RETRY_PAUSE_MS'`
    over `apps/till/src` finds two such sleeps, both in `till-app-drafts.test.ts`, so recount first.
    **Next action:** wait for what each asserts on instead of a fixed time.
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
    landing are recorded in the design. **OPEN — reads ordered by a timestamp with no
    tie-break:** several payment and refund reads order by a timestamp alone, so which of two rows
    from one millisecond comes first is whatever order SQLite reads them in, and that order depends
    on the indexes. Whether any of these reads returns the wrong order today is not checked. They
    are `apps/server/src/payments-api.ts` (the stuck card payments, and the pending bill payments
    and refunds), `apps/server/src/bill-payments-loop.ts` (pending bill payments and refunds), and
    `packages/payments/src/store.ts`: its lists of payments and refunds, and
    `selectCapturedForWorkingOrder`, which keeps the most recently settled of two captured or
    accepted-offline payments for one order. **Next action:** write two rows with one timestamp
    through each, with ids made to sort against the writing order, and add the `rowid` tie-break
    wherever the order can come back different (as A123 and A136 did elsewhere).
  - **Task 15 (#956, several payments on the till).** Open:
    - **The generic "received more than the bill" text also answers a comp or discount.** The
      till's `bill.received_exceeds_total` text (`apps/till/src/i18n/codes.ts`, "Move fewer items,
      or refund the difference first") is what the adjustment dialog shows when a comp or discount
      is refused for that code, where nothing is being moved. No assertion pins its wording.
      **Next action:** word it so it also fits a comp or discount.
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
      held-orders or prep-queue card, loads the counter's lists at login as a till does, and a
      handheld is offered the card reader, on any pay card and on a bill, only when its device
      profile has integrated card payment (`#showsCounterLists` and `#cardReader`,
      `apps/till/src/till-app.ts`). A till follows its profile the same way (C129, #1025); one with no
      device reads no capabilities at boot, so it is not offered the reader
      either, and the built-in till profile has the capability. When the server still refuses a
      reader payment with `device.forbidden_action` (a profile that lost the capability after the
      till started), the counter and the bill say "This device is not set up to use the card
      reader" (`card_reader.not_set_up`). At login each counter list shows its own failure with a
      retry notice, so one list that fails no longer stops the others loading (they are still read
      one after another, so a read that hangs still delays the rest); this changed for tills too.
      Left as they were: a handheld gets no Station, Expo or Schedule button (an existing test pins
      it), and never opens the drawer.
    - **Done (C128, #1031) — who may take a payment.** Every till or handheld payment route now also needs
      `sale.take_payment`, which every role holds; detail in `docs/developers/conventions-ui.md`.
    - **Done (C131, #1032) — the counter's pay card goes back to its choices after a reader payment.**
      Once a reader payment ends with no card outcome to show — refused, failed, or captured — the
      pay card leaves "Tap or insert card…" for its Cash and Card buttons, with any refusal in the
      banner; a retry, and the kitchen-station question that can come before one, belong to the
      attempt, and the spinner comes down once no card attempt is still running (`cardAttemptsOver`,
      `apps/till/src/widgets/tender-pay.ts`). A bill's pay dialog already dropped the text when its
      request settled.
    - **Done (C133, #1045) — the till's tabs fit one screen, with or without a notice above them.**
      The page gives the till the screen less its padding (`apps/till/index.html`), and the error
      banner and the other notices above the tabs take their height from the tab shell, so the
      language button stays on screen. The lock and join screens fill at least the height left; a
      staff list longer than the screen still makes the page scroll to reach the language button,
      as it did before. Before, the page was taller than the screen even with no banner, by the
      body's padding and the demo strip.
      Left from C133's review, not changed there: the table-order screen's bottom bar still keeps
      a tap target and two gaps clear at its end (`padding-inline-end` on `.bottom-bar`,
      `apps/till/src/screens/till-table-order-screen.ts`) for a floating language button the till
      no longer has — the language button now sits in the tab shell's own footer. Removing the
      space changes the screen's layout, so it is its own change.
    - The Devices screen's per-device "Receipt printer" is read by nothing that prints.
    - The dashboard's "Test open drawer" calibration
      (`POST /management-api/printers/:id/test-drawer`) opens any active printer's drawer for a
      manager holding both `printer.manage` and `cash.drawer`, with no per-till check — left as it
      is (owner, 2026-10-02).
    - **For the owner:** a card taken on a connected machine that also prints a paper merchant
      slip opens no drawer; B30 covers only the machine Waitron does not talk to.
    - From B29's review, not fixed there: a cash sale with automatic receipts reads the till's
      receipt printer twice in one transaction (`enqueueSaleReceipt` and `enqueueSaleDrawer` each
      call `resolveReceiptPrinter`) — resolve it once; every change on the dashboard's Printing
      rules screen reloads all its data through `#mutate` → `#load()`
      (`apps/dashboard/src/screens/printing-rules-screen.ts`), even `#setPrintMode` and
      `#setDrawerPolicy`, which update their own state in place; and a test title in
      `apps/server/src/made-here.routes.test.ts` still names `deviceSaleCfgOf`, a helper #1011
      removed — rename it.
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
      amount, so staff confirm a debt the server does not record.** The dialog lists each bill at
      what `GET /api/parties/:id/bills` says it owes, which reads no credit note (`#departingBills`
      in `apps/till/src/till-app.ts`): measured 2026-10-01, a presented bill credited to nothing
      read 18.00, and the button read "Record 18.00 unpaid", while the server records no departure
      row for it and settles it. The fix is for the dialog to show each invoice's amount due, its
      total plus its credit notes.
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
  - **Two gaps against the service plan's acceptance checks (spec §12)**, from a sweep on
    2026-10-01:
    - **The merged-party check of §12 item 9 uses a bill whose state is written by hand.** In
      `apps/server/src/parties.test.ts` ("merged parties keep their bills") the unpaid €15.00 bill
      is set to `placed` with no invoice filed and later set to `settled` directly
      (`apps/server/src/testing/party-venue.ts`), so no test files that bill's invoice, merges its
      party and collects it through `POST /api/working-orders/:id/collect`.
      `apps/server/src/unpaid-departure.test.ts` builds a really invoiced bill on a party, which
      such a test could reuse.
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
    `wt-close` handler, except the venue operations screen
    (`packages/venue-service/src/dashboard/venue-operations-screen.ts`), whose handler has no such
    check and which does not set `dismissible`. The rest were tried only with a hand-built
    `KeyboardEvent` (`sections-screen`, `modifiers-screen`, `add-to-menus`, `extra-list-form`,
    `option-list-form`, `option-label-form`, `variant-form` and `menu-prices-table`, under
    `apps/dashboard/src`) or not at all (`#guardEscape` in
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
    at the reader in this process. No till screen calls the route. The owner dropped the dashboard
    Orders screen's "Invoice not credited" mark (2026-10-02 ~12:05): such a bill is to show as Cancelled
    with its credit note. B27a landed first (#1027) with the mark — `invoiceNotCredited` in
    `apps/server/src/orders-list.ts` and its cases in `apps/server/src/orders-list.test.ts`; C126,
    landing second, removes them and updates those cases (owner-approved), and checks an
    abandoned bill before Paid in `BILL_STATUS`, since the cancel settles the invoice. Open:
    - **Done (B33, #1041, landed 2026-10-02): the PIN of
      someone holding `sale.rectify` (a supervisor, manager or admin) lets someone without it cancel and
      credit an invoiced order.** The cancel's
      body may carry `override: { personId, pin }`, checked as an unpaid departure, a bill refund
      and opening the drawer check theirs: a wrong PIN is `pin.invalid` and is counted, per till
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
      supervisor's PIN". No till screen sends the PIN yet: that is B32's.
    - **For the owner, from B33's review: the cancel checks the permission after its payment
      refusals.** A bill holding a payment, or with a card payment in flight, is refused for that
      before `sale.rectify` or an override is looked at — the order C126 built, which B33 kept. So
      someone without the permission is told about the payment rather than "not permitted", and a
      PIN sent with that request is neither checked nor counted. The drawer, refund and
      unpaid-departure routes check the permission first. Moving it earlier changes who gets which
      refusal; not decided.
    - **No till screen offers the cancel yet.** A "Cancel and credit" action on an invoiced, unpaid
      bill, offered to anyone signed in — someone without `sale.rectify` is asked for the PIN of
      someone who holds it — is queued as lane B's B32 (owner, 2026-10-02 ~12:05). The PIN
      prompt's list of who may approve it is
      `GET /api/cancel-credit-authorizers` (B33, owner 2026-10-02 ~16:50): the active holders of
      `sale.rectify`, by id and name, for any signed-in operator, like the drawer's, refund's and
      unpaid departure's lists. Every role holding `sale.rectify` today also holds `sale.refund`,
      `sale.void` and `cash.drawer`, so its cases cannot tell which of those it reads.
    - **A credit note's lines do not record which invoice line each one reverses** — no column
      holds that link, so a credit note cannot be traced back line by line. Storing it on every
      corrective line `recordCorrection` writes is queued as lane C's C132 (owner, 2026-10-02).
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
  - In the till's table screen, the check that treats an unreadable reminder time as "never due"
    (`reminderDueAt`, `apps/till/src/state/release-reminder.ts`) has no test of its own: the
    review removed it and no test failed. **Next action:** a case with a malformed `dueAt`.
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
    decide that; not queued.
  - **Task 12 (#888).** `party.main_bill_stays` still reads "Move one of those instead" (pinned in
    `apps/till/src/i18n/codes.test.ts`); the plan asked for "move the other bills first or merge
    them".
  - **Open, from C84's review (#913):** when a void or line change gets no answer,
    `#rereadAmounts()` can put on screen what the party still owes, taken from its bills after its
    own floor read failed, while the revision on screen stays where it was. A later floor read that
    also fails keeps a floor listing the same party at that EQUAL revision, which
    `#retakePartyFromFloor()` takes, and `#followDraft` → `#rememberOrderParty()` after a send with
    no answer takes too, putting the floor's older amount back (`apps/till/src/till-app.ts`). Traced
    in the code, not reproduced.
- **The floor and the table screen write amounts differently (plan Task 2, 2026-09-26).** The floor
  shows `44.00 €` while the table screen shows `44,00 €` in Spanish. The floor's format predates
  the parties work; Task 2 now also uses it for what a party still owes. Make the floor follow the
  locale, as the table screen does.
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
    row from its name: take 1280 into the pass too.
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
- **Location-consistency guard** — nothing enforces that a sale-capable device's register lives in
  the box's configured location, so a mis-provisioned device could stamp a fiscal record with a
  different site. Guard at enrol or first sale.
- **Refuse a request from a device that is not enrolled** (owner design of 2026-08-30, deferred
  until after the demo: [design](superpowers/specs/2026-08-30-device-auth-enrolment-fail-closed-design.md)).
  Tills enrol, selling needs an enrolled device, and a device profile's capabilities gate some
  actions (`assertDeviceCapability`). But a request that carries NO device still passes both
  `assertDeviceCapability` and `assertNotHandheld` (`apps/server/src/device-session.ts`), and the
  handheld block is still a blocklist. Left: refuse a request with no device, one table of which
  device kinds may do what with a guard that walks the routes, and printer identity (the design's
  sub-project C). It sits on the sale and cash path, so it takes the full review. Since B29 (#1011)
  a handheld places, collects and cancels like a till; of the refusals for being a handheld, only
  the Open drawer button's remains, and integrated card payment and printing still need the device
  profile's capability. The design's table is out of date on those rows.
- Register/device follow-ups: `WAITRON_TILL_TILL_ID` still seeds a "Caja 1" register while a till
  enrol auto-creates its own; the device-management routes build their `devices ⨝ device_profiles`
  read inline where a `listDevices` store verb belongs.
- **Screen faults seen during menus Task 9's look on 2026-09-27.** Seen on the dev stack while
  checking the till's home page, not investigated, and not checked against `main`, so any of them
  may predate that branch:
  - on the till at 390 px wide, the header makes the page wider than the screen;
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

**Dashboard alerts and the incidents surface — LANDED #363/#368/#371.** Still not built: the pairing
consumer, and a standby that has fallen behind.

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
    three times alone (2026-09-26). Not investigated yet; the owner's rule is to fix it at the root.
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

- **Every dashboard sidebar section gets an info page — OPEN (owner, 2026-09-29).** A page saying
  what the section is for and what is in it, opened by the section's header. It was the answer to
  C35's question about the header of the section you are on; A161 (#979) has since answered that
  question another way — that header now collapses its section, as every other header does — so
  whether this page is still wanted, and what would open it, is the owner's call. If wanted, it
  needs a spec: brainstorm what each section's page says.

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
  (alerts, venue operations), the Columns button sits alone on a row above the table rather than
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

- **Content languages are managed on the page itself (C111, #987) — left open:** the Add language
  dialog is the one standard modal size, so it is a tall, mostly empty sheet with one field; whether
  a one-field form should use something smaller is the owner's call. At 390px the Spanish "Hacer
  predeterminado" and "Quitar" fit side by side with the dashboard's own padding (16px a side), and
  stack when the page is padded 24px a side, so on a phone narrower than 390px they can stack.

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
  the image library, the Stripe and SumUp forms, the adjustment reasons and venue operations
  screens, and the till's forms. A dashboard-only helper could live in
  `apps/dashboard/src/widgets/form-fields.ts`, but `packages/media` cannot import from
  `apps/dashboard` (it would be a dependency loop), so a helper meant to cover the module screens
  and the image library too would have to live in a package they can all reach, such as
  `@waitron/ui`;
  (5) the image picker's error message is not read to a screen reader:
  `apps/dashboard/src/widgets/section-details-form.ts` puts `aria-describedby="section-image-error"`
  on the `dashboard-image-upload` host, and an id outside a shadow root describes nothing inside it
  (`docs/developers/design-system.md` → Forms); the Choose image button inside it carries
  `aria-invalid` and takes focus, so a screen reader hears "invalid" with no reason;
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
  slot would do; (c) a refused save of a venue operations setting that saves at once shows twice,
  beside the control and in the screen's alert (`#pageAlert`,
  `packages/venue-service/src/dashboard/venue-operations-screen.ts`), and existing tests pin both;
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
  (`active` on the ingredient, extras, options and menu-price forms; `available` on the product
  editor), the allergen and dietary-origin pickers on the ingredient form, and the purchase form's
  VAT regime select;
  (3) refusals naming two fields or a row the refusal does not number stay at the bottom:
  `purchase.duplicate` (supplier tax id and invoice number), a purchase line's rate, base, tax or
  type, a variant price on the menu price window, `hours.N` on venue operations,
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
  - The till's `APPROVER_REFUSALS` (`apps/till/src/till-app.ts`) still lists `person.not_found` and
    `person.suspended`, which the approval routes no longer send for an approver.
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
- **The till's schedule screen still has three defects the dashboard's My Schedule fixed** (C16,
  #751; found 2026-09-27 by reading `apps/till/src/screens/till-schedule-screen.ts`, not run): its
  failed-load catch (`:187`-`:193`) fills the lists with `[]`, so the sections say "none" beside the
  load-failed alert; its loading line (`:278`) has no `role="status"`; and a chosen shift or
  colleague that a reload removes stays chosen (`coverShiftId` and `coverColleagueId` are cleared
  only after a cover request is sent, `:222`-`:223`). **Next action:** fix those three defects the
  way the dashboard screen now does.
- **The counter till may start in a zone its service zone dropdown does not list** (found
  2026-09-14; read, not run). The till's zone list drops `table_tab` zones (`listDefaultZoneOffers`
  in `apps/server/src/till-api.ts`), but its starting zone comes from `resolveNewOrderZone`
  (`packages/venue-service/src/operations.ts`): the device's default, else the zone marked
  `is_counter_default`, neither filtered by service mode. Since A178d the box is a `wt-combobox`,
  which shows an empty box for a value with no matching option (read, not run). Since #1004 the
  dashboard's venue operations screen sets a device's default zone, through `PUT
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
- **Every test file under `apps/server/scripts/demo-seed/` carries its own copy of the demo seed's
  venue-provisioning fixture**: every `*.test.ts` in that directory declares its own
  `provisionVenue` and `nextNif`, and the `nextNif` bodies are identical apart from the eight-digit
  base each one counts up from. The repo has already paid for this extraction once elsewhere
  (`apps/server/src/testing/venue-fixtures.ts`), and it is free here because
  `apps/server/vitest.config.ts` excludes `scripts/**` from coverage. **Next action:** extract
  `apps/server/scripts/demo-seed/testing/provision-venue.ts` taking the NIF base as an argument —
  each file genuinely needs its own range — and convert the siblings as they are next touched.
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
    `tenant_receipts`, the control, sent one).
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
  (`packages/country-es/src/receipt-labels.ts`). It is set on the **Receipts** page and on setup's
  venue screen; **in Catalonia it is fixed to Catalan**
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
    setup and the Receipts page says a copy can be printed in another language. The dashboard
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
    - The refusal's count of blocking orders is not shown on the Receipts page: `codeMessage` fills
      in no values.
    - **The payment slip was left alone.** Its words («JUSTIFICANTE DE PAGO», «Importe»,
      «Cobrado») stay Spanish (`apps/server/src/payment-slip.ts`), and its date and amounts still
      follow `WAITRON_TILL_LOCALE` (`apps/server/src/payment-slip-print.ts`). It is not the
      invoice, but art. 128-1.2.a also covers «els altres documents que hi facin referència o que
      en derivin», so a Catalan venue's slip is arguably covered.
    - **The translations need a native or official check before go-live.** Apart from the Catalan
      «Factura» and «Propina», which the Consumer Code and the agency's pages use, no word in the
      table was checked against a terminology source. The owner landed it as is on 2026-10-02
      ("land, review words later"); the follow-up (lane E's C125s) was then parked by the owner on
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
      English dish names; the Receipts page shows it as the saved language although it is not
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
  fields; per-menu modifier authoring; department hours and calendar exceptions; workforce
  assignments; immutable department attribution and reporting; batched readiness and offer queries;
  a replication smoke test. Same legal seller is the working assumption, to confirm before go-live.
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

- **Resetting a box without a terminal** (owner, 2026-10-02). An operator who set the box up in
  Demo and now wants to Prepare has to wipe Demo away first, and the only wipe is
  `waitron.sh reset` (`cmd_reset`, `deploy/waitron.sh`), run with `sudo` at the box's terminal —
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

- **The bucket-stream reader still passes a missing field on unchecked.** `readStreamSettings`
  (`apps/server/src/stream-host.ts`) hands each `backup.stream` field on as read, so a row sealed
  before a field was added yields `undefined` in the bucket settings; a missing `endpoint` reads as
  Amazon's, pointing the stream at the wrong host. Routing each field through `credentialField`
  (`apps/server/src/credentials.ts`) is one line, but from reading the code on 2026-09-27 (nothing
  run), three callers would then refuse where the owner needs a way forward: the Backups screen's
  `GET /api/backup/stream` (`view()` in `apps/server/src/stream-api.ts`) would fail, and the dashboard
  panel then shows none of the form, Change or Turn off, the only ways to repair it; the first start
  after a restore (`readBucketPointerTerm`, `apps/server/src/rebuild-first-start.ts`) would fail on
  every start; and the archive restore (`apps/server/src/restore-stream.ts`) reads the settings
  outside its mapping to `restore.stream_source_unchecked`, so the command line would print a bare
  "restore failed". The recovery-kit download and the stream host's start can refuse without harm.
  Reachable only once the `backup.stream` field list changes. **Next action:** add the check
  together with those three callers' handling, each with a failing test first.
- **Reading a credential does not re-check it against `PURPOSES` — owner decision 2026-09-15.**
  `getCredential`/`tryGetCredential` (`packages/credentials/src/store.ts`) return what was sealed,
  rather than refuse the read, which would stop every venue holding that kind of secret the moment
  a field is added; each reader is to check the fields it uses instead (the bucket-stream reader,
  above, does not yet). `rotate` re-checks a secret against the current list only when it re-seals
  one: it skips a secret already on the current key (`rotateCredentials`,
  `packages/credentials/src/store.ts`), so an out-of-date one stops a key rotation only when it is
  on an older key, until it is re-entered.
- **`CardProviderBuildDeps.nodeId` is dead weight — nothing reads it** (2026-09-16, traced through
  both adapters). `packages/payments-sumup/src/provider.ts` declares the field and never touches it,
  and `reverseViaStripe` (`packages/payments-stripe/src/reverse.ts`) requires it on its options
  object but destructures only `resolveProcessorRef`. **Next action:** delete the field and the
  values every caller passes, or, if a record path is meant to use it, wire it up and say where.
- **A box that mints its certificate before NTP sync persists a wrong validity window**, with no
  renewal path yet. Ties to a time-health check and certificate renewal.
- **Shutdown closes the database even when stopping background work fails (C71, #870)**
  (`apps/server/src/boot.ts`). One consequence: if stopping Litestream itself fails, the store is
  now closed while Litestream may still be running; nothing tests that case.
  - **OPEN, left by #870's review (read, not run): a failed START still has the shape C71 removed
    from shutdown.** Two of `bootServer`'s `undoOnFailure` entries run several stops as one step:
    the cloud entry awaits `cloudWorker` then `cloudSnapshots`, so if the worker's promise rejects
    the snapshot loop is not waited for before the store closes; and the change-feed entry calls
    `unsubscribeFromChanges()` then `liveEvents.close()`, so a throwing unsubscribe skips the close.
    **Next action:** split each into one undo per stop (or run them through `closeAll`,
    `apps/server/src/close-all.ts`, as `close()` now does), with a case in
    `apps/server/src/boot.failed-start.test.ts` that fails first.
- **Two concurrent first provisions can still race past the venue guard** (2026-09-14). Both can
  pass the empty-`locations` check and carry on down the venue path; `apps/server/src/provision.ts`
  says in as many words that callers must serialise provisioning, and nothing enforces it — the
  setup route's latch is process-local. #378 closed only the taxpayer row's part of
  it (the second insert now loses to the singleton primary key), and its test claims only that
  neither plan dies on a `tenants_*` key. **Next action:** decide where the lock belongs — a
  database advisory lock around guard→stamp→apply is the obvious home — and prove it with two
  concurrent provisions against a real database, not with the row-level check alone.
- **A venue plan giving `dayCutover` as `HH:MM` would make an idempotent re-provision fail.**
  `packages/provisioning/src/venue-plan.ts` documents the field as `"HH:MM" or "HH:MM:SS"`, but on a
  re-run `packages/provisioning/src/venue-apply.ts` compares the stored value — read back from a
  `time` column, so always `HH:MM:SS` — against the plan's string with `===`. A plan carrying
  `"06:00"` would therefore look like a different venue and be refused with
  `provisioning.second_venue`. Latent, not live: every fixture and every caller uses the long form,
  and the short form is not reachable through `dev:setup`, so nothing covers it either. **Next
  action:** either normalise the value where the plan is built, or narrow the documented type to
  `HH:MM:SS` — and add the failing case first.

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
  those pull requests and left for the package that owns each, all still OPEN:
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
    profile column is NOT NULL; the "four ids" test title in `apps/server/src/provision.test.ts`,
    which asserts five; `config.ts`'s "minted once and reused" for the box certificate, which a
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
    **`apps/till/src/till-app.test.ts` has an empty test**, `it("sends a walk-up line's options
    answer without any local price preview", () => {})`, which passes whatever the code does
    (`git blame`: 9fbdc8ba7, 2026-09-21). The review reported that "resets any leftover drill/active
    tab on login" still passes with login's own clearing line deleted, because logout clears the
    same state first (run in review, not re-run here). A question the prune moved here from a
    deleted `menu-filter.ts` comment: should the `no-meat`/`no-fish` lenses also hide a dish whose
    diet is still pending review, as `vegan`/`vegetarian` do? Today they hide only dishes known to
    contain the tag. Comments inside `till-app.ts`'s template text still carry design-doc pointers
    (`cash-drawer-authorization §5`, `device-enrolment §3.1`), and many `till-app.test.ts` titles
    carry plan and review labels ("(Finding 2)", "(P6)", "(FP-1)", "(KDS-1)", "Task 8",
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
    `packages/db/drizzle/0000_baseline.sql` still names an index `tills_tenant_location_name_key`.
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
    so a device cookie revoked mid-session raises nothing until the next connect. Test NAMES still
    say `till.configure` where the permission is `venue.configure`, in `apps/till/src/api/client.test.ts`
    and `till-app.test.ts`. The screens' `css` templates still carry task and spec numbers ("Task
    7", "KDS-4 §3d"). Unchecked and kept: the allergen screen's legal citation (RD 126/2015 Art.
    6.5.a.2°). Not restored because nothing confirms it: the table-order screen's `#lineGross` "same
    arithmetic the server files with" (the server does not call `grossOf`).
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
    table changes it (read from the code, not run). `packages/ui/brand/README.md` still lists four
    generated icon files and says the generator "reproduced all four derived files"; it also writes
    `icon-192.png` and `icon-512.png`. `packages/ui/vitest.config.ts` and `stryker.config.json`
    still exclude `src/tokens/token-test-helpers.ts`, which moved to `packages/ui-core` in #519 (the
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
    `.husky/pre-push` beside the same loop; it is not there. `CLAUDE.md` §3 says
    `scripts/no-tenant-column.test.ts` exempts the core migration files that historically carried
    the column, whole; its `HISTORICAL_TENANT_SQL` list is empty.
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
  - `addShift` and the shift update in `packages/workforce/src/clocking.ts` store the caller's
    spelling of `starts_at`/`ends_at`, and `shifts_interval_ck` compares that text, so two valid
    times spelled with different offsets, or with fractional seconds on one side only, can be
    refused as a raw CHECK error instead of `shift.invalid`, and `order by starts_at` can sort
    them wrongly. Normalising the spelling on write, as `appendToChain` does for `event_at`, is
    the unmade fix; the gap is stated at `assertShiftInterval`.
  - A `nodeId` option nothing reads: `ReconcileDeps.nodeId` in `packages/payments/src/reconcile.ts`
    is declared and never read, `packages/payments-stripe/src/reconciler.ts` passes one in, and the
    SumUp provider's options declare one it never reads (`payments-sumup/src/provider.ts:47`,
    passed in at `card-provider.ts:188`). Dropping the option is a code change.
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
  - `packages/fiscal-verifactu` code, found by #562 and not changed:
    - `drain.ts`'s Route B lookup (`client.consultar`) runs inside the transaction that saves AEAT's
      reply, so it holds the venue's single writer across an AEAT round trip (#562's review held a
      second writer blocked while the lookup was paused), and a failed lookup rolls back the other
      CSVs saved from that reply, which AEAT does not send again. The comment at the call now says
      so. Moving the lookup out of the transaction is the fix, and a fiscal-adjacent change.
    - The inner try/catch around the log call in `aeat-transport.ts`'s `closeAll` is dead: with it
      removed, the "LOGGER fails" case still passed, because `Promise.allSettled` absorbs the
      rejection.
    - Removing `appendToChain`'s nested `tx.transaction` makes no test fail (`chain.test.ts`'s
      header says so); the protection it gives a losing attempt has no test holding it.
    - `chain.ts` raises `fiscal.record_totals_disagree` for every warning the validator returns.
      `@waitron/verifactu@0.1.0` emits two, both totals checks, so it is right today; nothing
      fails if the library adds a warning of another kind.
    - The frozen `write-path.e2e.test.ts` points at `test/fixtures.ts:249-256` and
      `test/write-path-fixtures.ts:37-44`, which have moved; the receipt they cite is back in
      `test/fixtures.ts`. Correct them only in a change allowed to touch that file.
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
    styles use hex fallbacks and `rem`, and a CSS comment inside its style string is history; and
    `connection-screen.ts`'s `connection-continue` event is not named `wt-*` and carries no
    `detail`.
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

- **`scripts/errors-reachable.test.ts` and `scripts/module-seams.test.ts` read comments as code —
  OPEN.** They deliberately strip no comments, so an import written inside one counts. The next
  action is to add a failing commented-import case for each, then adopt the shared reader
  (`blankComments`, `packages/shared/src/source-comments.ts`, which A128 gave
  `scripts/spawn-timeout-budget.test.ts` and `scripts/write-path-tables.test.ts`) and update their
  stated limits and `docs/developers/testing-guide.md`. `scripts/column-vocabulary.test.ts` also
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
- **A sixth, seen once (2026-09-20) on #469, a branch that touches no browser package at all.**
  `test-dashboard` failed `apps/dashboard/src/widgets/variant-form.test.ts` → "saves on Enter and
  cancels on Escape from a focused field", at `expect(cancel).toHaveBeenCalledTimes(1)`; the Enter half
  of the same test passed. It did not reproduce locally. The cause is NOT established — two
  hypotheses were traced through the code but neither was run (the likelier is a re-render provoked
  by the submit taking focus off the field between the back-to-back `{Enter}` and `{Escape}`).
  **Next action:** on the next sighting keep the job log and the screenshot, and fix it at the root
  — the first hypothesis is cheap to close by awaiting the component's `updateComplete` between the
  two key presses and checking focus is still in the field.
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
  because the approved slice 3d plan (`docs/superpowers/plans/2026-10-01-watchers-slice-3d.md`,
  lane E's PF8, not started) runs it by that name; rename it once PF8 has landed. The `pg` handle
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

**While Add a printer is open, a scan that finds devices starts the next one with no pause — OPEN
(found 2026-09-30 by a trial Codex review of C117's branch; on `main` since #955).** In
`packages/print-agent/src/agent.ts`, a scan pass that finishes with devices wakes the loop
(`discover`), the woken loop polls at once instead of waiting out the 2-second pause (`start`), and
that poll starts the next pass because none is running and the discovery window is still open
(`tick`). So passes run back to back for as long as the window is open, each followed by an extra
job pull. The review's test drove the real loop with a fake host whose scan returns one USB device
at once, no queued jobs, for 250 ms: it counted 195 pulls where it allows at most 2; the loop from
before #955 made one. How quickly a real scan returns on a box, for example one with only a USB
printer, has not been measured, so how often a real box repeats is not known. **Next action:**
test-first, keep the prompt delivery of a finished pass's devices but stop the wake from launching
the next pass early (for example, start a pass only when the pause since the last one has passed),
with the 250 ms fast-scan case as the regression test.

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
- The product editor's variant form (`apps/dashboard/src/widgets/variant-form.ts`) turns the
  dialog's late `wt-close` into a Cancel without first checking that the form is still open, so
  after a Cancel, once the screen has closed the form, the late close report probably sends
  `wt-cancel` a second time and the product editor would act on it again (found 2026-09-27 in
  review, by reading, not run). The Units, Options, Extras and category forms carry the
  `!this.open` check `option-label-form.ts` does (C68, #863; C74, #878); the variant form was left
  out of C68 only because B13 changed the product editor, and B13 did not touch it, so its fix no
  longer waits.
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

**Till code that no test can reach, and small till defects — OPEN (found 2026-09-23, till
coverage, PR #536).** Left uncovered rather than deleted, each by reading its callers (none was
run without the code):

- `till-app.ts`: the handlers for `show-station`, `show-expo`, `show-schedule`, `open-allergens`,
  `close-allergens`, `new-sale`, `back-to-counter` and `back-to-floor` each keep an arm for when
  the shell is not active, which after a successful boot only the lock screen is, and nothing on the
  lock screen emits them. `back-to-counter`'s arm checks for the lock screen first (B31).
- `#onShowFloor` in `till-app.ts` has no shell split at all: the one control that emits
  `show-floor`, the counter screen's floor button (`screens/till-counter-screen.ts`), is drawn only
  when the counter is not `embedded`, and the app mounts it only as its `embedded` counter tab. It
  waits for the floor read and then sets the screen with no lock check, so a synthetic `show-floor`
  followed by a logout left the till unlocked when the read answered (run in review, 2026-09-23).
- `till-app.ts`: the `#setScreen` calls in `#showTicket`'s and `#onOpenTable`'s no-shell arms
  (after a successful boot only a till locked mid-request reaches that arm, and the lock check then
  skips the call), and the `?? []` on the shell's `.tabs` binding.
- `trust-check.ts:83` (`timer` is always set by then), `widgets/station-queue.ts:501` (the bump
  button renders only when a next step exists), `session-activity.ts:67` and `:125`,
  `screens/till-station-screen.ts:227` and four `?? []` fallbacks in
  `screens/till-schedule-screen.ts`.
- `api/server-router.ts` writes a tracked server's `nodeId` at `:184`, `:208` and `:214`, and
  nothing reads it.
- `deviceKindLabel` (`apps/till/src/i18n/device-label.ts`) looks a kind up in a plain object, so
  `deviceKindLabel("constructor")` returns `undefined` rather than the kind (run). The server sends
  only `till`, `handheld` and `kds_station` today.
- In `apps/till/src/session-activity.test.ts`, "is a clean no-op when the Wake Lock API is absent"
  passes `wakeLock: undefined`, which falls back to the real `navigator.wakeLock` — present in the
  test browser — so it does not test an absent API. The branch added a test that does.
- The two "show-floor …" cases in `apps/till/src/till-app.test.ts`'s live-floor block select the
  floor tab rather than fire `show-floor`, so their titles overstate them.

**Next action:** delete the unreachable arms, and `#onShowFloor` with its `show-floor` listener (or
give it the lock check), with a receipt each; key the label lookup on own properties; rename or
rewrite that wake-lock test; and rename those two show-floor test titles.

**The email-change form calls an empty code field an "authentication code" — OPEN (found by C61's
review, #859, 2026-09-29; read, not run).** In the Profile screen's email mode, leaving the email
confirmation code blank shows `profile.code_required` ("Enter your authentication code"), the
wording for the authenticator-app code (`apps/dashboard/src/screens/profile-screen.ts`, the
`setupCode` check in the form's own validation). **Next action:** give email mode its own "Enter
the code from your email" sentence in `en` and `es`, test first, and LOOK at it in both themes and
languages at 390 and 1280 px.

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

**Six hand-rolled "does this table exist?" probes, three copies of one SQL identifier validator, and
two cause-chain walkers — OPEN (found 2026-09-23, task F1's review wave).** The table probe is
spelled out in `packages/db`'s `deployment.ts`, `node-membership.ts` and `mirror-config.ts`, in
`packages/migrations`' `schema-version.ts` and `journal-hashes.ts`, and generically (but privately)
in `packages/catalogue/src/categories.ts` as `tablePresent`. The identifier validator is in
`packages/db/src/testing/identifiers.ts`, `packages/db/src/change-feed.ts` and
`packages/store/src/append-only.ts` — the first two are in the SAME package. The cause-chain walk is
in `packages/shared/src/engine-failure.ts` and again in `packages/db/src/constraint-target.ts`, and
that one is a regression: `unique-violation.ts` used to import the shared walker and now uses the
local copy, leaving `firstCodeInCauseChain` with no product caller at all. **Next action:** export
one `tableExists` from `@waitron/db` and one validator from `@waitron/shared`; `packages/store`
depends on nothing today, and `@waitron/shared` depends on nothing either, so that edge closes no
loop.

**`resolveEnvironment` and `deploymentEnvironment` are two hand-maintained copies of one four-branch
table — OPEN (found 2026-09-23, task F1's review wave).** `packages/provisioning/src/environment.ts`
and `apps/server/src/config.ts`. They agree today, checked line for line. The stated reason — a
package cannot import an app — is true and skips the third option: `@waitron/db` already owns the
`DeploymentEnvironment` type and both sides depend on it. Nothing in the tree runs both over one
input. This decides whether a box files against the real AEAT or the test one (`CLAUDE.md` §5), so
two copies held together by hand is the wrong shape for it.

**`packages/migrations` opens its own raw `node:sqlite` connection — OPEN (found 2026-09-23, task
F1's review wave).** `apply.ts` imports `DatabaseSync` directly and re-does `openConnection`'s
"busy_timeout first" discipline by hand. It is the only non-test file outside `packages/store` that
names the engine, which is the thing `packages/store` exists to prevent — the same argument
`columns.ts` makes for column types. The lock file does need a connection the store does not offer
today, so the fix is a small `openLock(path)` export, not a restructure. Nothing guards this.

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
   filters by `cfg.locationId`, falling back to `cfg.orderFlow` when that finds none;
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

- **Thirteen index and key names still read `tenant`, and the columns they name are gone:**
  `canvases_tenant_name_key`, `device_profiles_tenant_name_key`, `print_agents_tenant_node_key`,
  `purchase_invoices_tenant_received_idx`, `sales_tenant_issued_idx`,
  `table_service_statuses_tenant_label_key`, `tills_tenant_location_name_key`,
  `working_orders_tenant_status_idx`, `registros_tenant_node_secuencia_uq`, and four in identity:
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

- **One word for "switched off, kept for the record" across the dashboard — Small** (owner,
  2026-09-23). The same idea has several labels today (`apps/dashboard/src/i18n/strings.ts`,
  `packages/venue-service/src/dashboard/strings.ts`): products, venues, extras lists and options
  lists say **Active / Inactive** (`product.inactive_badge`, `venue.inactive`, `extras.inactive`,
  `options.inactive`); printers, card readers and staff say **Disabled** with a **Disable** action
  (`printers.status_inactive`, `printers.status_revoked`, `payments.reader_disabled`,
  `person.mark_inactive`); a menu entry on the menu prices table says **Switched off**
  (`menu_prices.switched_off`); and a generic `action.deactivate` ("Deactivate") exists beside
  `action.disable`. Products settle on **Active / Inactive**, kept separate from **Available** (sold
  out for now). **Next action:** pick the one pair, and the one action verb, for every screen whose
  record is switched off rather than deleted — deciding first whether a revoked printer or a disabled
  login is really the same state as an inactive product — then change the English and Spanish
  strings together and record the rule in `docs/developers/design-system.md`. String keys are not
  renamed on the way (only their text).
- **The Waitron wordmark is invisible on the dashboard banner in the dark theme.** One file
  (`packages/ui/brand/waitron-lockup.svg`) is served to both themes as an `<img>`, so it cannot
  follow the theme: the wordmark's letters are painted `#16181d` on the dark theme's `#101216` — a
  contrast ratio of 1.06 to 1, where 4.5 is the readable minimum. **Next action:** give the lockup a
  light and a dark variant, or paint the wordmark with a token by inlining the SVG, as the setup
  wizard already does with `--wt-color-text` (`apps/setup/src/setup-app.ts`, C39).
- The dev `?dev` chooser shows `label · kind` rather than `name · profile · register`; the Spanish
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

- **The three alta builders are triplicated** — `recordSale`/`recordCorrection`/`recordSubstitution`
  in `packages/fiscal-verifactu/src/backend.ts`. Safe seam: a helper taking the assembled
  `Omit<AltaInput,"Encadenamiento">` plus a `buildDesglose`; needs a huella-invariance re-run across
  all three.
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
keys #426 dropped could be declared again — `sessions` to `persons` and `tills`, and
`management_sessions`, `totp_enrollments` and `google_oidc_states` to `persons`. Doing so would
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
- The "key rotated" date `rotate` writes is dropped by a later `apply`, because `readApplyBody`
  always passes `keyRotatedAt: undefined`; the value is what the Backups screen shows as the date the
  key was rotated.
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
- `@waitron/store` is missing from the English-only guard's `GENERIC_PACKAGES`
  (`packages/db/src/english-only.ts`), so it is never scanned.
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
#889, A135 #907 and #917).** The pause test's one failure on `main` (run 36559470238) was the CI
runner's disk, not the bucket, and the stream tests' CI step now sets `TMPDIR=/dev/shm`. The figures
are in [testing-guide.md](developers/testing-guide.md), "A sale can wait behind Litestream's own
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

**Open: the images ship no notice file for the npm packages bundled into their JavaScript.** The
owner's rule (2026-09-24) is that a change adding third-party code to the image carries its licence
notices; the server bundles (`scripts/bundle-node.mjs`, esbuild), the three SPAs (`vite build`,
copied to `/app/web/`) and the print-agent bundle (copied to `/app/print-agent.js` in
`deploy/Dockerfile`'s `print-agent` stage) carry npm packages whose `LICENSE` files are left behind
by bundling. The app image's `/app/third-party/` holds notices for libvips, Litestream, the Iosevka
font, the Moby template the print agent's AppArmor profile is copied from, and the Material Symbols
icons; the print-agent image's holds only `python3-minimal/` (since A140; bluez's copyright files are
not copied). Measured 2026-09-24: `apps/server/src/bin.ts` bundled with `bundle-node.mjs`'s options
took in 81 npm packages, 76 of which have a `LICENSE` file, and the output kept one block of legal
comments covering 9 source files from 8 of those packages; `apps/till` built with `vite build`
contains Lit, whose source opens with a `@license` comment, and its output holds no `@license` or
`/*!` comment at all. The other server bundles, the print-agent bundle and the dashboard and setup
SPAs were not built. Needed: a generated notice file for each bundle — the server's
and the SPAs' beside the Litestream one, and the print-agent's in the print-agent image.

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

**Run path (local; no hardware, cloud, or AEAT cert):** `wa-wt demo <worktree-name>` → till
<http://localhost:5190>, dashboard <http://localhost:5191>, setup <http://localhost:5192>, server
:8080. The till enrols itself on first load in dev mode. Till PIN **5555**; dashboard
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
  `scripts/no-tenant-column.test.ts` (text-matching, and blind to test files and to the historical
  core migrations it exempts). The cloud is a dedicated instance per tenant, hosted in Spain — a
  server process and a SQLite file streamed to object storage. Density comes from many isolated
  instances per host. The only multi-tenant pieces are a small control plane and the preproduction
  trial demo.
- **Warm standby plus human promotion; active-active is shelved.** Nothing was deleted for it: branch
  **`shelved/active-active`** (= `main` at `c65d3cbe`, 2026-09-05) is the snapshot to return to.
- **Modules are core to the product** (opt-in domains, third-party modules later); fiscal is swappable
  by jurisdiction (Veri\*Factu / TicketBAI / none). New domains land as modules, and no new core table
  without a stated reason (CLAUDE.md §3).
- **Register and device are both kept.** A register (`tills`; UI "register"/"caja") is the drawer
  counted at close; a device is the screen. Several devices ring into one register.
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
| 5 | Identity | persons/sessions, PIN (+ wrong-PIN back-off: per device at sign-in, per till for override PINs), `authorize()`, roles/permissions, passkeys, email-first dashboard login, emailed invitations and password resets, encrypted TOTP and recovery codes, user admin (#298, #328); a one-time passkey offer on first password sign-in (#347); identity state replicates to a standby | admin-editable roles; security-change emails; mid-shift-suspension enforce; discount gate; till-refund enforce |
| 6 | Locations | provision-a-sellable-venue (`waitron-provision venue`); departments, zones and menus (#297) | multiple locations, edit/deactivate; then location-scope the by-id verb family |
| 7 | Counter POS | walk-up cash, park/retrieve, manual + integrated card, prepare & collect, canvas/receipt editors, receipt/drawer printing, cash-drawer authorization — operable end to end | — |
| 8 | Reporting | daily close, frozen *cierre Z*, VAT summary, modelo 303 output+input VAT + DR303 file and its download route (no dashboard screen yet), purchase-invoice UI; dashboard sales screen (with a category sales report, at time of sale or current, printable) + business-overview home | the modelo 303 screen; fiscal filing remainder parked (*Detail → Reporting*) |
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
- **The demo tax ID is generated and must never reach Prepare or Live.** It is a company checksum shape
  (`packages/country-es/src/spain.ts`), safe only because a demo box files nothing.
- **"Till name" is the till row, not the filing identity.** The node/SIF is created and named after the
  location automatically; a `till`-form device always creates its own register (`createRegister`,
  `apps/server/src/device.ts`), so the wizard's register is left over unless a handheld claims it.
- **Default both series codes to values that survive a cold restore.** A cold restore appends
  `-<installation number>` and `stripOwnSuffixes` would then re-number a trailing `-<digits>`, so
  default to **FS** (factura simplificada — every till sale is `TipoFactura` F2) and **FR**
  (rectificativa). Nothing in the dashboard can change or add a series today.
- **`operation_description` is a Veri\*Factu field, not a country fact.** It defaults from the fiscal
  contribution and is editable after setup on the dashboard's **Receipts** page (its location
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
  `apps/setup/src/screens/mode-screen.ts`'s mirror card and the `role-screen` card together.

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
quarterly and annual periods (#98). **No dashboard screen calls that route**, so today the file can
only be fetched from the API. Two pre-filing caveats a human must clear before the first LIVE 303
filing: validate the DR303 file once against the real
AEAT "por fichero" uploader (we omit página 2, régimen simplificado); and an asesor must confirm the
**prorrata** treatment (`computeInputVat` scales only the cuota by `deductible_proportion`). Deferred
build slices: rectificativas de facturas recibidas (casilla 40/41, needs a
`corrects_purchase_invoice_id` self-FK); bienes-de-inversión regularización (43); the prorrata rule
(44, asesor-driven); intra-community and import boxes (32–39); a libro-registro / Pre303 export.

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

**Dev stack from a worktree.** `wa-wt demo|onboarding <worktree-name>` and
`wa-wt reset demo|onboarding [worktree-name]` — the rule is in CLAUDE.md §6; detail in
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
