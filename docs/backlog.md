# Backlog — what to work on next, and why

This file answers **"what should I work on?"** It is state, not history: what is built (one line each),
what is open, and the order to take it in. The git log, the PR threads, and the committed
specs/plans in `docs/superpowers/` hold the detail — do not paste receipts back in here.

> **Restructured 2026-09-12 (evening).** The goal is a **standalone working primary on prem**. The
> on-prem mirror and the cloud primary stay on the list, but they come afterwards. Three build tracks
> replace the six push steps and the four file-ownership tracks: **A — UI and application**,
> **B — infrastructure**, **C — smaller items**. Landed work is one line with its PR number as a
> locator; what a review seat caught and how something was proven stay in the PR thread.

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
- **A node is two containers, app + Postgres**, with named volumes for state, logs and backups. The
  cloud scales by many containers per server, never by multi-tenancy.
- **Product images live in Postgres and are served from it** (2026-09-08). Replication, backup,
  restore and a cloud move are then one mechanism. The URL is content-addressed and served
  `immutable`, so each device fetches each image once until its bytes change.
- **Backups leave the primary.** Destinations, in build order now that the mirror comes afterwards
  (revised 2026-09-12; the 2026-09-08 order had the mirror first): an S3-compatible bucket, Google
  Drive, then the mirror once it exists. All three hang off the existing `StorageBackend` seat.

**Cloud-compatibility rules** — a change that breaks one is a design question, never a default:

1. Peers are reached by URL + credentials only. No LAN discovery, no shared-subnet assumption.
2. Adopt, promote, rejoin and backup are ONE code path wherever the node sits.
3. Every two-node test runs twice: over the plain LAN and over the WireGuard fixture
   (`@waitron/db/testing/two-node-wireguard.ts`, #275).
4. Everything a node keeps outside Postgres is a named volume, and every secret can come from the
   environment as well as a file.
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
`cloud-replacement.json` (#808), unless that file cannot be read (see Open). Observations are synthetic
until service adapters exist. Cloud owns the two-server WireGuard/HAProxy proof, bot gate, DNS
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
  the stop and the next check sends `renew`, so a stop Cloud had not yet heard is lost (reproduced
  by the review of lane C's C29, #808, 2026-09-28). Owner to choose: refuse Stop access while the
  replacement file is unreadable, or record the stop somewhere that survives the repair.

The Litestream stream's sealed-state restore and activation still need integration with Cloud
storage and owner recovery. Connected does
not mean those services are configured. Cloud service ownership stays in the Cloud
backlog; this repository owns its adapter, screen and node-side behavior. Public
hosting, ingress controls and Cloud audit/retention remain deployment work.

## What to work on next

Ranked 2026-09-27, after the specs still in `docs/superpowers/specs/` were checked against the code
(each spec's state is under *Reference → Specs still in the tree*). Each item is its own brainstorm →
spec → plan → PR; fiscal-adjacent ones take owner sign-off at land.

1. **Finish table service and paying a bill in parts** (A4, lane B). Sixteen of the service
   plan's eighteen tasks are done: 0–14 have landed (Task 9, marking dishes served, as
   #814; Task 10, the attention signals, as #908; Task 11, comps and discounts, as #916; Task 12,
   the adjustment reports, as #923; Task 13, standalone ordering, as #903), the till's Cancel
   taking a reason is done by lane B item B11a, and Task 15, several payments on the till, has
   landed as lane B item B15 (#956; the server side landed as #721). Left:
   counter handover (16) and a table that leaves without paying (17).
   **Send asesor Q27–Q29 now:** Task 17 waits on Q28, how Task 11's discount appears on the
   invoice on Q29, and printing the invoice before payment on Q27.

2. **Staff cannot clock in or out** (A10). The working-time record is a legal duty from the first day
   the deli employs anyone, and only its library is built: nothing in `apps/` calls `clockIn` or
   `clockOut`.

3. **What a standalone box still lacks before a real venue runs it:**
   - an off-box home for the backup archive (B2) — the bucket stream of `venue.db` is built, but
     archives can only be saved on the box itself (`LocalFsBackend`);
   - installing or renewing the AEAT certificate after setup (A9) — today only the setup wizard can
     set it, and nothing watches when it expires;
   - upgrade testing with rows the product itself writes and a real older database (B4) — owner-marked blocking
     before go-live;
   - the bootable USB installer (B3), the last piece of "install without a terminal";
   - the degraded-but-trading recovery spec (B5).

4. **The till does not load its menu until a manual refresh** (A4). Seen on the blank-box-to-selling
   run; the box and sale path worked.

5. **The displays and the printers walked at the real box** (A4, A3) — till, handheld and KDS through
   [ui-review.md](ui-review.md), and the first physical print since #327: slips, duplicates, the
   drawer pulse, the feed-before-cut. #689 printed calibration samples and a sample receipt on the
   owner's NT-806 and fired its drawer from the calibration test; a real sale's slip, the duplicates,
   the cash-settlement drawer job and the feed-before-cut are still unwalked.

6. **Smaller, independent pieces**, in no fixed order: a dashboard screen for the modelo 303 download
   (*Detail → Reporting*); refusing requests from a device that is not enrolled (A4); the pairing
   alert, "devices tried to join" (A5); Logging Slice 2, the one-touch bug report (A9); the
   first real Bluetooth pairing at the box through the dashboard (A3; the print agent's side, P2b,
   and the dashboard's, P2c, are built);
   paying at the table from a handheld (A6, Slice 2).

Then the on-prem mirror and failover — slices 3 to 5 of the storage design — then the cloud primary,
under *Afterwards*. Everything else ranks beneath these.

---

## Track A — UI and application

What staff and the operator touch: `apps/till`, `apps/dashboard`, `apps/setup`, `packages/ui`,
`packages/layouts`, `packages/identity`, the dashboard-, till- and setup-facing routes in
`apps/server`, `packages/printing`'s dashboard side, `packages/payments*`. The numbers name areas;
the current ranking is *What to work on next*. The small items at the end of each area live in
Track C.

**Product folders, menus that include menus, and prep station routing — designed, not built
(owner, 2026-09-30).** The
[design](superpowers/specs/2026-09-30-catalogue-menus-routing-design.md) is built in three
slices, each with its own plan and pull request:

1. **Products and categories.** The products screen becomes a file browser of products and
   folders. Categories lose their translations, image and colour. The Categories screen and labels
   are removed.
2. **Menus.** Sections belong to one menu, and a menu can include another. Price and on/off follow
   one rule, and a clash blocks publishing. A home-layout tile whose target has gone becomes an
   empty slot. The Sections screen and library sections are removed.
3. **Routing.** A new Prep Stations screen: stations claim folders, ordered exceptions match on
   delivery area, stations have opening hours and fallbacks, watchers get copies, and extras can
   split off to another station.

Slice 3 needs slice 1. Slice 2 is independent of both. Several entries below are overtaken by this
design, and each carries a dated note. **Slice 1 is implemented** in [#968](https://github.com/clintongormley/waitron/pull/968),
following the [approved plan](superpowers/plans/2026-09-30-product-folders-slice-1.md).
Products and folders can be browsed, selected, moved, deleted and dragged together; labels,
category presentation fields and the Categories screen are retired. Eleven task reviews and
whole-branch review are complete. Every development venue needs `wa-wt reset demo <name>`.
The owner confirmed on 2026-10-01 that deleting only empty folders remains immediate, including
any routing rules attached to them. Confirmation is shown when selected folders contain products
or subfolders; the approved empty-folder shortcut is retained consciously.
Slice 2's [plan](superpowers/plans/2026-09-30-menus-include-menus-slice-2.md), which also drops
per-menu extras, is approved and queued for campaign lane E (PF2b) (owner, 2026-10-01). Slice 3 is
four plans (owner, 2026-10-01): 3a, the rules and the Prep Stations screen
([plan](superpowers/plans/2026-10-01-prep-station-rules-slice-3a.md), approved, lane D's PF3 after
PF1); 3b, opening hours, by-hand open and close, fallbacks, and down-printer and dark-screen alerts
([plan](superpowers/plans/2026-10-01-station-hours-fallbacks-slice-3b.md), written and reviewed
four times); 3c, split-off extras, what a ticket shows, and sending one dish to another station
from the till (any waiter, closed stations included, when sending or after) plus re-routing a held
dish whose station closed before it was released (owner, 2026-10-01); 3d, watchers. **Next action:** the owner
approves the 3b plan; then it is queued after 3a, and the 3c plan is written.

**Planned for one campaign lane (owner, 2026-09-25): sales classification, then menus, reusable
sections and home layouts.** Two specs and two plans, revised twice the same day after outside
reviews: the [menus design](superpowers/specs/2026-09-20-menus-categories-and-home-layouts-design.md)
(§11 wins over §10, which wins over §1–§9; "category" in §1–§7 means SECTION) with its
[plan](superpowers/plans/2026-09-25-menus-categories-home-layouts.md) (Revision 3, Tasks 1–9 with
7a, 7b and 7c before 7), and the
[sales classification design](superpowers/specs/2026-09-25-sales-classification-and-category-reports-design.md)
with its [plan](superpowers/plans/2026-09-25-sales-classification.md) (Revision 2, Tasks 1–3).
**Order, one lane:** classification Tasks 1–2 first (so sale-line history starts building), then
menus Tasks 1–6, 7a, 7b, 7c, 7, 8, 9, then classification Task 3 — fifteen pull requests, one per
task. Lane C runs it (`~/waitron-campaign-c`). **Classification Task 1 — LANDED #645
(2026-09-25):** one main reporting category per product in a strict tree, flat labels
(`labels`, `product_labels`, a Labels tab on the Categories screen), `product_categories` dropped,
and a category delete that says where its products and subcategories go. Left open for the owner:
confirm the deletion defaults (spec §2.1: products and subcategories go to the parent; for a
top-level category, products become Uncategorised and subcategories top-level); whether label names
should ignore capitals (today "Alcoholic" and "alcoholic" can both exist — a small migration if so);
`Product.categoryId` and `primaryCategoryId` now always hold the same value; and the per-product
label routes and `?descendants=1` on a category's products have no dashboard caller yet.
_2026-09-30: labels are to be removed, and so are category names' translations (the
[folders, menus and routing design](superpowers/specs/2026-09-30-catalogue-menus-routing-design.md),
§2.1 and §3). The question about capitals in label names and the per-product label routes go with
them. The deletion defaults are replaced by the design's §2.3: the screen asks whether to delete
the contents or move them up._
**Classification Task 2 landed as #648 (2026-09-25):**
every till filing path records each sale line's product, a variant's parent, its menu, its gross
and its reporting chain and labels when the record is issued. Since menus Task 7,
`sale_lines.menu_version_id` is the menu version the line was added from
(`working_line_contexts.menu_version_id`); a line added before Task 7 recorded none and files null.
Two follow-ups it leaves: the till shows "try again" when `sale_classification.invalid` refuses a sale (it happens only on corrupt category data, and retrying cannot succeed), so the code wants its own till message on the permanent-refusal list; and a card recovery refused that way leaves a captured payment unlinked until the catalogue is fixed, as recovery's existing below-locked-total refusal already does. The demo seed (`apps/server/scripts/demo-seed/seed-sales.ts`), the other scripts that call `recordSale` directly (`record-one-sale.ts`, `settle-invoice-first.ts`, `daily-close-demo.ts`, `daily-close-z-demo.ts`, `modelo-303-demo.ts`) and `apps/server/src/fiscal-readiness-runner.ts` file sales without the issuance pass, so seeded demo lines carry no product id, classification or gross, and the category report on the Sales screen shows every seeded line under Not recorded, in both modes, until the seed records them.
_2026-09-27, menus M7v: the reporting chain and labels are now recorded on each line when it is
added (`working_order_lines.classification`) and issuance copies them, so `sale_classification.invalid`
refuses adding a line rather than filing a sale, and a card recovery can no longer be refused that
way. Whether the till's message for that refusal on the add paths is right is not checked._
**Classification Task 3, landed as #738 (2026-09-27), completes the sales classification
plan:** a category sales report on the dashboard Sales screen, for THIS node only, in two modes — at
time of sale (the reporting chain and labels recorded on each sale line) and current (today's
catalogue) — with an option to count an extra under its dish, totals by category and label, a Not
recorded row, and a note when some lines recorded no gross. `GET /management-api/reports/categories`
serves it; "Print category sales" sends it as a document print job, through
`POST /management-api/reports/categories/print`, to a printer picked from
`GET /management-api/reports/printers` (this location's active printers). All three need
`report.view`, which supervisors hold as well as managers. Current mode answers
`sale_classification.invalid` when today's category data is inconsistent. Left open:
- The at-time-of-sale report is fetched again whenever the catalogue is edited. The dashboard declares
  what a live query depends on per query NAME (`apps/dashboard/src/api/live-queries.ts`), and
  `getCategorySales` serves both modes, so the at-time-of-sale mode, which reads no catalogue table,
  refetches on every product, category, label or content-language edit. Fix: one query name per mode,
  each with its own dependency list.
- `wt-button` disables only its inner `<button>`, so a scripted click on the host element still
  reaches a click handler. The Sales screen's print handler checks for itself; other screens that rely
  on `?disabled` alone have not been checked.
- The spec (§6) wanted the category analysis printable alongside the daily close, but no daily-close
  print exists; "Print category sales" is its own action for now.

**Menus Task 1 (sections), landed as #651 (2026-09-25):**
reusable, ordered, nestable sections (`sections`, `section_members`), with section and member
routes under `/management-api/sections` (add, add several products, move, remove, replace in
place, duplicate — optionally replacing in the same request — and usages), and four media triggers
guarding a section's image. A follow-up that is not Task 2's: each table that can hold a photo is
named by hand in several places in `packages/media` (the triggers, `listImageUsages`,
`countUsages`, the live-query dependencies, the `before` lists in `module.ts`, the `ImageUsage`
unions), and only a comment keeps `countUsages` and `listImageUsages` in step; one list of
photo-holding tables that those derive from, checked against the triggers, would make the next
such table one edit. Two notes for Task 3 (menu structure): `sections_owner_menu_fk` has no
delete rule, so deleting a menu that owns a section will be refused until Task 3 chooses one; and
media's triggers name `sections`, so a later drizzle rebuild of that table meets the same trap
`docs/developers/conventions-data.md` records for rebuilds. **Menus Task 2 (the sections library
screen), landed as #654 (2026-09-25):** **Products and recipes**,
**Sections** lists every library section with where it is used (one batch read,
`GET /management-api/sections/usages`), shows each place a section is nested, and edits, duplicates
and deletes sections and their members.
_2026-09-30: the Sections screen and library sections are to be removed; each section will belong
to one menu, and menus share by including another menu
([design](superpowers/specs/2026-09-30-catalogue-menus-routing-design.md) §4). The items #654
left below go with the screen._
Left by #654, none blocking: opening a nested section from the editor drops unsaved edits to the
open one without a warning; the "Used in" filter's two choices (Used in a menu, Not used) leave a
section held only by sections that are on no menu findable only under Any; the screen
(`apps/dashboard/src/screens/sections-screen.ts`, about 1,140 lines) could move its editor form into
a widget as the categories screen does; the editor and delete dialog still read one section's
usages although the batch read already holds them; and `wt-data-table` searches a column's sort
value when it has no search value, so a number column matches typed digits unless it opts out as
the Items column now does — changing that default needs a check of every table that searches
prices or counts.
**Menus Task 3 (menus are built from sections), landed as #659 (2026-09-25):** every menu owns one
top-level list (a menu-owned `sections` row, pointed at by `menu_details`); `menu_sections` is
dropped and `menu_items` rebuilt to hang off the menu; an offer carries every section path that
reaches it (`placements`); the menu's own price, switch, variant prices and extras for a product
reset when the menu stops reaching it. Left by #659, none blocking: the image library
links a menu-owned section's photo to the sections screen, though nothing puts a photo on one yet;
and `sections_owner_menu_fk` still has no delete rule (Task 1's note stands) — nothing deletes a menu
today, so it bites only when something does. A product reached through a section offers no extras
list; that was already so before #659 (checked at `002b79f69`). DONE (lane C's C9): the three
management routes nothing called — `DELETE …/catalogues/:id/items/:itemId`,
`GET …/catalogues/:id/offers` and `POST …/catalogues/:id/items` — are removed, with
`deactivateMenuItem` and `listMenuOffersWithTopLevel`; `addProductToMenu` stays, because the demo
seed calls it. No route now raises `menu_item.variant_not_allowed`: `addProductToMenu` is its only
thrower, and the demo seed that function's only caller outside tests. The code and its 400 in
`apps/server/src/catalogue-api.ts` are left in place for whoever next prunes unraised codes.
**Menus Task 4 (the Menus screen), landed as #664 (2026-09-26):** **Products and recipes → Menus**
(`/manage/menus`) lists, creates and renames menus; a menu's Structure tab shows and edits its whole
tree; and creating a product on the Products screen ends with an optional "Add to menus" step.
Left, none blocking (the blank-name create is DONE, lane C's C9: refused as the rename is, with
`management.request_invalid` naming `name`): "New section here" asks only for the internal name, so
a section's customer names, image and colour are still edited on the Sections screen; which
section is being edited is not in the address, only the menu and the tab; and opening "Add to
menus" sends one `getMenuStructure` request
per menu, each of which reads the whole section graph on the server (`readMenuStructure`,
`packages/catalogue/src/menu-structure.ts`) — one server read returning every menu's structure, as
`librarySectionUsages` does for usages, would make it one. Also left by #664: a refused
change's message sits under the menu's heading, above the tabs, so it shows while the menu loads —
on a phone the tree sits between it and the list it names; if someone else exactly undoes a move
while it is still saving, the move's answer is shown over their change until the menu is next read
(stated in a comment at the site); and no accessibility test covers that message while it shows.
**Menus Task 5 (menu prices, and the old Menus tab goes), landed as #670 (2026-09-26):** a menu's
Prices tab (`/manage/menus/menu/<id>/view/prices`) lists each product the menu reaches once and
sets or clears this menu's price, switches the product on or off for this menu, and sets each
variant's price and whether it is offered here; Venue operations loses its Menus tab.
Left, none blocking:
removing a product's last placement on the Structure tab clears its menu price and variant settings
with no warning, where the old tab asked first (the owner decided 2026-09-26 that none is needed);
the main-category filter offers every category, not only those on the menu; and the product
editor's help lines, and the price window's variant help sentence (`menu_prices.variants_help`), are
still paragraphs beside their inputs rather than `wt-input`'s `hint`, so they are not linked to their
inputs. _(2026-10-01, C104: a `hint` now shows as the field's placeholder, and only to screen readers
when the field sets its own placeholder; moving these lines into it would hide them from sight
whenever the field holds a value, and always where the field sets its own placeholder.)_
**The Prices tab shows variants, price ranges and a choice of columns, landed as #680 (2026-09-26,
the owner's answers to #670's FYI):** each product's Active variants are rows under it, a product
sold only as its variants shows price ranges, #541's struck-out "Price on this menu" column is kept
but hidden by default, and `wt-data-table` gains a column chooser remembered per browser in
`localStorage` under `<viewKey>:columns`. Left, none blocking: a variant row is announced by its
name alone ("Glass"), not with its product's, relying on the tree's level; and, from reading only, a
Columns panel wider than a very narrow screen would not shrink to fit, and is not re-placed if the
window is resized while it is open.
**Menus Task 6 (publishing), landed as #677 (2026-09-26):** a menu can be published: publishing
freezes the menu's working state as a numbered version in `menu_versions`, which can never be
changed or deleted, and points `menu_publications` at it; the Menus list shows each menu's status and
a Preview tab words each change and publishes the one menu. Tills sell from the published version
since menus Task 7. **M6c** (#705, 2026-09-26): an extras item's photo
is in the frozen copy, so changing it flags every menu offering it; deleting a product flags its
menus, and Preview names an extra-only deleted product on its own line while retaining the affected
dish's extras-change line; and the Preview tab shows the whole proposed menu below the changes. A
version published before M6c has no photo on its extras items, so each menu with extras shows
unpublished changes until it is published again. Left, none blocking: after a
publish the editor's heading shows the browser's clock until the next read, because the publish
answer carries no time; a re-enabled product's "added" change can name its section as the
source; the status and preview reads build every menu's frozen copy inside `withTransaction`, the
venue's write lock — measured about 21 ms median for 4 menus and 300 dishes on a dev laptop, not on
the box; at phone width the list keeps a fixed room for the row menu, and a status sort falls back to
a name sort. **For menus Task 7:** the configuration import (`apps/server/src/configuration-transfer.ts`,
run only inside provisioning's `beforeCommit`) deletes every `catalogues` row, so if Task 7 makes
provisioning or the demo seed publish a menu BEFORE the import runs, the import's commit fails on the
`menu_versions` → `catalogues` key, which cannot be deleted because the table is append-only.
Also seen once while landing it: `apps/dashboard/src/widgets/variant-form.test.ts` (a file #677 did not
touch) failed in one local dashboard coverage run and passed three times alone — an intermittent
failure that needs its cause found and fixed, not a re-run.
**Menus Task 7a (VAT is resolved when the invoice record is issued), landed as #683 (2026-09-26):**
every filing path for a stored order now files each line at the rate of its product's CURRENT VAT
class (a variant with no class of its own reads its parent's; an extras line reads its own
product's); the customer pays the same gross. The resolved rate and net unit price
are written back onto `working_order_lines` only while the order is OPEN: a placed order (a
ticket-then-pay collect, or a card payment of a placed order) keeps its stored rate on the line,
because `working_order_lines_require_open_parent_update` refuses an update of a line whose order
is not open. Nothing prints or files that stored rate — receipt lines are gross only and a reprint's
VAT breakdown comes from the filed record — so this is an owner FYI, not a defect: allowing the
write would mean loosening that trigger in a core migration. Still open: asesor Q26 (the adviser confirming the rule); the new test
file `apps/server/src/vat-at-issuance.test.ts` copies about 150 lines of setup from
`issuance-pass.test.ts`, which a shared helper could absorb.
_2026-09-27: menus M7v replaced this rule (see its note below): issuance no longer resolves a
rate, and the write-back is gone, so the placed-order FYI above no longer applies. Asesor Q26 is
still open, reworded. The test file is now `apps/server/src/vat-class-at-line-add.test.ts` and still
copies its setup from `issuance-pass.test.ts`._
**Menus Task 7b landed (#696, 2026-09-26): editing a saved order — the server rules.** An edit keeps
each line's locked price and prices only what it adds; every change to work the kitchen has is a
recall or a void recorded as a kitchen notice; an order carries a revision, so an edit made from an
older copy is refused; and a second device cannot change an order while a card payment of it runs
(D22). Owner decisions applied:
a partial split takes its own copy of the kitchen ticket and a started line may be split (D10 and
Review Focus 6 overturned); moving sent work to another table prints a MOVED slip and records a
`moved` notice; held kitchen work cannot be split onto a check (`tab.split_held_line`) — decided by the owner 2026-09-26 as the safe behaviour until the service plan's Tasks 14 and 15 (lane B's B14/B15) let a guest pay for one held item against the table's bill. _(2026-09-30, B15: a guest can now pay for one held item — the till's Pay items takes it, and the server case "sends a held dish one guest paid for to the kitchen when it is fired, and charges it to nobody else" (`apps/server/src/bill-payments-api.test.ts`) holds it. B15 left `tab.split_held_line` unchanged, so splitting a held item onto a check is still refused. **Owner decision:** whether that refusal stays now that its stated reason is gone.)_ _(2026-10-01, B20, #964: **DECIDED (owner, 2026-09-30): "lift it"** — a dish in a held group may now be split onto a check of the same party, keeping its group, and fires with it; a dish held outside a held group (a recalled one, or a held round with no group) is still refused `tab.split_held_line`.)_ _(2026-10-01, B20: a dish held in a group whose bill is paid before the group fires reaches the kitchen once — one fired kitchen entry, one printed ticket — but its line is never stamped sent. `stampSent` (`apps/server/src/working-order.ts`) stamps only an open bill; its own comment says the `working_order_lines_require_open_parent_update` trigger refuses the stamp on any other, which was not run here. Measured with B20's two server changes (`apps/server/src/bill-actions.ts`, `apps/server/src/working-order.ts`) reverted to main (56327e750): a whole table bill holding a Flan held in a group, paid in full and then fired, printed one FLAN ticket, its group became fired, and the line's `sent_at` stayed null. B20's split adds a second way in, measured 2026-10-01 on this branch with a throwaway assertion on the check line's `sent_at` added to the "paid before it is fired" case in `apps/server/src/party-bill-actions.test.ts`: a Flan held in a group, split onto a check, the check paid, then the group fired — one FLAN ticket printed, and the check line's `sent_at` stayed null. What reads `sent_at` for such a line is not traced. Left open; queued as lane B's B21 (owner, 2026-10-01).)_ _(2026-10-01, B21, #969: **DONE** — firing a group now stamps each line it sends as sent on a presented or paid bill too, and so does a course fire on such a bill, and `sendToPrep` on a paid counter order, because they share `stampSent`. Core migration `0053_line_sent_after_close` lets a presented or paid bill's line take a first `sent_at` with every other column unchanged (`scripts/behavioural-triggers.test.ts`, "sent-stamp exception"), and `stampSent` skips only an abandoned bill. Held by three cases in `apps/server/src/party-bill-actions.test.ts` (a check paid before its group fires; a whole table bill paid before, "is stamped sent when its group fires, and a dish in a group that never fires stays unsent"; a presented bill) and one in `apps/server/src/working-order.pay-and-dispatch.test.ts` (`sendToPrep` on a settled order now stamps its lines too). The stamp is the only column the new exception lets change: `scripts/behavioural-triggers.test.ts` tries every other column of the line beside it and each is refused. The run-it review of the finish-branch run compared the sale, invoice, payment, tender and settlement rows before and after a fire on a paid bill and found them unchanged (a throwaway probe, 2026-10-01, not committed).)_ The core
migrations add five columns and replace the `working_orders_enforce_transition` trigger, and
venue-service adds `kitchen_notices` and `service_settings`; the upgrade succeeds, but
rows written before it misbehave (a dish sent before the upgrade counts as unsent, an extra saved
before it blocks a one-line edit) — the PR has the measured table; settle open orders or reset
before upgrading. Still open: the `changed`
notice kind is declared but nothing writes it (the kitchen screen renders it since Task 7c).
(2026-09-27, service plan Task 6: `enqueueHoldCorrections` now writes it, with a direction, for a HOLD CHANGED
correction slip.)
**Menus Task 7c landed (#710, 2026-09-26): changing a sent line from the till, and kitchen-screen notices.** The table
screen offers Change on a sent line the kitchen has not started, a recalled line and a line with no
kitchen route; it opens the existing option, extras and note editor prefilled from the line and saves
through the one-line edit route with the order's revision. A started line keeps Cancel only; Cancel
is now offered on a queued line too, and a line of several whole units asks "Cancel 1" or "Cancel
all". _(2026-09-30, B11a: Cancel now asks for a reason in the adjustment dialog, which on a line of
several whole units offers "1" or "All N" under "How many".)_ With the venue's "allow changes to items already sent" setting off, Change and Recall are
hidden on sent kitchen work. The tab-lines answer (`GET /api/working-orders/:id/lines`) now carries
that setting, and each line when it was released, its note, its offer and its parent product. A
change or recall the server refuses because the kitchen has started the item, or because the venue
does not allow changes to sent items, says so in its own words (a change also names an unavailable
product or an order changed elsewhere); most other refusals, such as a tab that is no longer open,
show the generic error. A change answered after the waiter has moved to another table names the dish and the table instead of acting on the wrong order. The kitchen screen
shows the station's notices above its queue (kind as a word and an icon, "started", the new note, the
table a line moved to), each with an acknowledge button, and re-reads its queue every 15 seconds; a
refresh read that has not answered after 25 seconds is cancelled. No migration. Left open: the counter's prep-queue card shows no notices and
does not refresh; the till's API client has no general request timeout (only the kitchen refresh
and menu-state reads are bounded, at 25 seconds, and a table's round sends and offer reloads, at 150
seconds); a refusal that lands after the tab is paid, or after a server switch, shows the
ordinary unnamed message; the till's screen-to-app events use plain names, while
[conventions-ui.md](developers/conventions-ui.md) says every custom event is `wt-*` — the rule or
the till needs to change. **Done since (2026-09-27, lane A's A71, #725):** a notice now carries its
line's unit, copied when it is recorded (venue-service migration `0004`, a nullable
`kitchen_notices.unit_name`), and the kitchen screen writes it the way the queue row above it does:
"0.5 kg× Pulpo". A dish sold by the piece carries the Each unit, so its notice reads "2 ud× Croqueta"
in Spanish, as its queue row already did; only a line with no unit at all reads "2×". Hiding
Each on both is the owner's call, not done. **Done since (2026-09-28, A78):** the kitchen screen
leaves the Each unit out of a queue row and a notice alike, "2× Croqueta", while a weighed or
measured line keeps its unit ("0.5 kg× Pulpo") and so does any other unit counted in whole numbers
("200 g× Almendras"). Each is decided by the unit's identity, never its abbreviation: the unit a
product with no stored unit reads as, or a stored unit seeded as `each` (`isEachUnit`,
`@waitron/catalogue`; provisioning has not seeded one since #375, so only test fixtures hold one).
The queue payload and each notice carry `soldInEach`; a notice copies it when recorded (venue-service
migration `0009`, `kitchen_notices.sold_in_each`, a flag so it still answers once the line is voided
or the unit deleted). One known gap: while a line is still open, deleting the stored unit seeded
as `each` it was sold in makes its queue row, and any notice recorded after, read as not Each,
because `readLinesSoldInEach` looks the seed key up on the live unit row (reproduced by the
finish-branch run-it review, 2026-09-28); the unit a product with no stored unit reads as cannot be
deleted, so only such a stored unit is affected. **Done since (2026-09-28, lane A's A109, owner's
request):** the printed kitchen ticket, and everything that shares its item builder
(`buildTicketItems`, `apps/server/src/kitchen-print.ts`: HOLD tickets, correction slips, reprints),
prints a dish sold in Each as "2.000 x Croqueta", while a weighed or other unit keeps its unit
("0.500 kg x Pulpo", "200.000 g x Almendras"); and the expo board reads "2× Croqueta" through the
same `dishLine` (`apps/till/src/widgets/dish-format.ts`) the station queue uses, from a `soldInEach`
flag on each expo item. Both decide Each by the unit's identity through `readLinesSoldInEach`, so
the known gap above applies to them too, and a line with no recorded context but a unit recorded on
it prints or shows that unit (`grep -rn "insert(workingOrderLines)" apps packages` finds four
non-test sites, all in
`apps/server/src/working-order.ts`: `createOpenOrder`, `insertTabRound` and `applyLineEdits` each
follow the insert with `recordLineContexts` (in `createOpenOrder` under a known zone, which its call
to `priceOrderLines` requires for any line), and `carveOffLines` with `copyLineContext`; run
2026-09-28). **Done since (2026-09-28, lane C's A114, #811):** the merge-or-split check goes by
the unit's identity too: a ticket entry is merged or split only when its unit does not print (sold
in Each, or no unit recorded on the line), so a venue's own unit spelled like Each prints its
entries as sold, never merged or split, and a renamed stored Each unit's are merged or split. The
known gap above applies to merging and splitting as well, and so does a line with no recorded
context but a unit recorded on it: it prints that unit, so its entries print as sold. **Done
since (2026-09-28, lane C's C33, #819, branch `fix/kitchen-ticket-printed-as-sold`, on the owner's "tidy
it"):** the ticket entry's flag for this is named `printedAsSold` (it was `measured`), and no input
in the formatter's own tests (`apps/server/src/kitchen-ticket.test.ts`) shows a unit without that
flag. **Kept as they are, by the owner's choice (2026-09-28):** the printed receipt
(`apps/server/src/receipt-ticket.ts`) and the till's ticket view
(`apps/till/src/screens/till-ticket-view.ts`), which still show the Each unit: the receipt's case
"prints the unit abbreviation of the invoice language…" in `apps/server/src/receipt-ticket.test.ts`
expects "2 ud" on a line frozen with Each's abbreviations; the till's ticket view from reading the
code only. **Done since (2026-09-27, lane A's A72, #727):** while the kitchen screen's queue reads
fail (including a read cancelled at 25 seconds), a banner above the list said "Not up to date since
10:20" ("Sin actualizar desde las 10:20"; reworded by A79, below), giving the time of the last read
it showed, or, if none has succeeded, the time the screen opened, or the time the operator switched
to this station; the list stays on screen
beneath it and the next good read clears it. A late failure of an older read after a newer answer is on screen raises nothing, and
neither does an enrolled display's 15-second refresh answered `device.unauthorized`, which
re-boots the app. A 401 answering the reload after a bump does show the banner, and re-boots
nothing until the next refresh, as before. **Done since (2026-09-28, lane A's A79):** the banner
reads "No updates since 10:20, 5 minutes ago" ("Sin actualizaciones desde las 10:20, hace 5
minutos"), with "less than a minute ago" and "1 minute ago" for the short cases, and the count
moves on each minute while the banner shows (`apps/till/src/widgets/stale-since.ts`); and when the
operator screen's list of stations cannot be read on open, the banner shows beside "No stations",
dated from when the screen opened. Still open: the list of stations is read only when the screen
opens, so after that failure the banner stays, counting, until the screen is opened again; long
outages are counted in minutes, never hours.
**Menus M7b3 landed (#713, 2026-09-26): an unpaid split bill goes back on its tab.** When the
waiter leaves a separate bill made with "Split by item" without paying it, the till that made it
merges it back into the table's tab (`mergeTabs`; the kitchen is told nothing). Every other case
leaves it in the counter's Held orders, where it can be paid — run end to end in real Chromium
before building, as the PR records. No migration. Left open: if the waiter leaves before the split
itself answers, the bill arrives after they have gone and is not merged back (it stays in Held
orders); and the counter's Held orders list shows every open order, a table's own tab included
(seen in the same run, not investigated). _(2026-09-29, table actions Task 12: confirmed —
`listHeldOrders` filters on status alone. Each row now carries `partyId`, and Move to table is
offered only on a row with none; Retrieve on a party's bill is unchanged.)_
_(2026-09-29, table actions Task 10: retired. The till no longer merges a split-off bill back; it
stays listed among the party's bills until it is paid or merged by hand (spec decision 8).)_
**Menus Task 7 (tills sell from the published version), landed as #719 (2026-09-27):** a till
is offered, and every new line is charged, what each menu's published version says: the dish, its
variant, its extras and its options. What is still read from the current rows: whether each product
and variant is Active and Available, whether each option label is Available, and whether an offer
has switched an extras item off (a sold-out dish is served in its place marked unavailable, and a
line for it is refused `product.unavailable`; an extras item sold out or switched off on the offer is
refused as a pick the list does not offer), while whether a menu has switched a variant off is read
from the published version; the VAT class, kitchen course and reporting category the served offer carries,
and each extras item's VAT class (`applyLiveFields`, `packages/catalogue/src/menu-document.ts`), so
a VAT change still reaches a new line and a new extra without a publish, which menus M7v changes next (_2026-09-27: it has; the VAT class and rate are now read from the published version, see M7v's note_); and whether a picked extra has since gained
an Active variant, which refuses the pick `product.variant_required`. (_2026-09-28: whether the
menu itself is active is now read from the current row too, so a menu deactivated after publishing
is no longer offered or sold from; #719 had dropped that check. Branch `fix/retro-review-719`, from
the retroactive Codex review of #719._) (_2026-09-28: a zone left with no active, published menu
is reported on the readiness list as needing "an active, published menu" / "una carta activa y
publicada", no longer "a published menu"; a zone whose active, published menus were all last
published before M7v reads the same wording, and needs them published again (M7v's **Upgrading**
note); the code stays `zone.menu_unpublished`. Branch `fix/readiness-active-menu-wording`, #810._)
Each unsaved line a till sends may name the version it was priced against (`menuVersionId`); a
request naming one that is no longer live is refused `menu.version_changed` (409), listing each
affected menu's live version, before anything is priced or written. A held or tab line records the
version it was added from, and its filed sale line carries that version. `GET /api/menu-state?zoneId=`
answers each live version and what is sold out now. **Upgrading:** a box or dev venue seeded before
this branch, and a venue imported from a configuration file, arrives with every menu unpublished,
and a zone sells nothing until a menu it offers is published (an unpublished menu is left out, and
the zone sells its published ones); the dashboard's readiness list reports a zone with none
(`zone.menu_unpublished`). Left open: every
`/api/menu-state` poll waits its turn in the write queue, because the route and `requireSession`
(`apps/server/src/till-session.ts`) read inside `withTransaction`; reading outside a transaction
would skip the queue but give `menuState`'s queries no single consistent view, and there is no
read-only transaction (`packages/db/src/tenancy.ts`); and a till learns of a change only by polling, because the dashboard's
live-update route accepts the management cookie only — a till-session branch on that route would let
the server tell tills instead (plan D11), a later refinement. The till polls it every 15 seconds while
signed in, greys what is sold out in place, and runs the basket refresh flow (D9) for the counter's
basket and for a table's round refused `menu.version_changed` (the table screen keeps the round
until the server has added it) _(Task 8, 2026-09-28: the round is now each person's draft,
held by the app's `DraftSync`, `apps/till/src/state/draft-sync.ts`, and saved on the server)_.
Follow-up: the comparison does not notice a publish that adds a
required options list to a dish in the basket, or lowers a list's picks limit, so the till takes the
new version silently and the server then refuses the request `options.label_required` (or
`extras.limit_exceeded`, per `validateExtraSelections`); nothing wrong is filed, but staff see a refusal where the dialog should have asked.
The comparison also looks only at each line's total, so dish and extra price changes that cancel out
are adopted without asking — see the campaign item A113 entry further down. _(#812, campaign item
A113, branch `fix/retro-review-719-till`, 2026-09-28: no longer so — when a line's total is
unchanged, `refreshBasket` lists the dish or variant and each extra whose price changed, each on its
own row of the dialog. Campaign item C32 (#817), branch `fix/basket-refresh-unit-price-label`, 2026-09-28:
those rows now read as unit prices, "€9.00 each → €8.00 each" / "9,00 € c/u → 8,00 € c/u", or, for a
dish not counted in whole units, per the dish's unit as the menu grid shows it, "€20.00/kg"; a
line-total row is unmarked. Campaign item C49 (#831),
2026-09-29: a dish or variant now sold by another unit gets a row even when no price changed, and
when the unit and a price change together, the dish or variant's row, plus a row for each extra
whose price changed, is shown instead of the line's total.)_
A table's round is also not marked by the poll's sold-out list, only when a send is refused.
_(Task 8, 2026-09-28: no longer so — when the poll's sold-out list for the open table's zone
changes, `#onMenuState` in `apps/till/src/till-app.ts` marks the draft again, `#markDraft(true)`.)_
Follow-up: a round the waiter has built but not yet sent belongs to the order it was built on, so
when a split moves the table screen to the split-off check, the round is not shown on the check
(before this branch the screen's one round went with it); when a split answers, move the unsent
round to the check. Likewise a round built on a tab that is then merged into another tab stays
under the merged-away tab's order id and can no longer be reached. _(Task 8, 2026-09-28: the draft
now belongs to the party, not to an order: while a check split off the party's bill is on screen
no draft shows, and the party's draft shows on the party's own tab — `#tableDraft`,
`apps/till/src/till-app.ts`.)_ _(2026-09-29, Task 10: the draft now shows on a split-off bill
too.)_
Follow-up: every remembered round (one refused sold out or after a menu change) is marked again
against the open table's menu, so opening a table in another service zone can mark another table's
round wrongly or clear its mark. Remember each round's zone and re-mark only that zone's rounds, or
keep rounds on the app, one per order. _(Task 8, 2026-09-28, read, not run: `#markedRounds` in
`apps/till/src/till-app.ts` still holds every store refused sold out or after a menu change,
drafts included, and drops one only at sign-out or when a re-mark after the offers are read
again leaves it unmarked; `#markRounds` marks each against the open table's offers. Whether a
store from an earlier table is ever shown again was not checked.)_
Follow-up: a round kept after a refused send survives leaving the table only on a canvas that shows
the floor and the order side by side, because the table screen holds it; on the till's drill view
and a handheld's separate order tab, leaving destroys the screen and the round. Keeping rounds on
the app, one per order, would keep them on every layout. _(Task 8, 2026-09-28: done that way —
each person's draft is saved on the server and read back by `DraftSync` when the table is opened
again, so it no longer depends on the table screen.)_
**Menus M7v landed (#720, 2026-09-27): a line keeps the VAT rate its published menu froze.** the owner's
decision of 2026-09-26 replaces menus Task 7a's rule. Each published menu version now freezes the
VAT class and rate of each dish, variant and extras item, and a till is served those. A line
records that rate when its price is fixed — when it is added to a saved order, or at payment for an
unsaved basket — and issuance files the stored rate on every path and writes nothing back. Raising
an unsent line's quantity in place keeps its price and rate; a line an edit adds takes the rate live
then. After a change to a product's VAT class, every menu including it shows Unpublished changes,
and its Preview names a VAT change (a variant's own reads "VAT, variants"). A line also records its
reporting classification when it is added, from the product's current classification
(`working_order_lines.classification`, core migration `0021`), and issuance copies it; a category
change still flags no menu. A change to a class's RATE has no product surface: the rates are in code
(`RATES`, `packages/catalogue/src/pricing.ts`), and a release changing them now reaches tills only
when each menu is published again; a menu published once that release is installed freezes the new
rate at once, even before the date it takes effect, so the release and the publish have to be timed
together (a publish cannot be scheduled). **Upgrading** (measured: a database with a published menu, a
held order and an open tab, written before this change and migrated through `applyMigrations`): the
migration adds one column and applies cleanly; every menu published before M7v shows Unpublished
changes and sells nothing until it is published again — its zone is offered none of its dishes,
the dashboard's readiness list reports `zone.menu_unpublished` for a zone left with no menu, and a
round added to the open tab from that menu is refused `service_zone.offer_not_allowed`. Open lines
keep their stored rate and can still be paid, and each line added before the upgrade files a null
classification. So publish every menu once after upgrading; dev venues need `wa-wt reset demo
<name>` after menus Task 7 anyway (below). **Left open:** nothing in the product can issue a
corrective invoice (R5, *factura rectificativa*) for a VAT error on an issued simplified invoice.
`recordCorrection` exists (`packages/core/src/record-correction.ts`; the Verifactu backend corrects
only an F2, as an R5), but no route calls it: its only callers under `apps/` are three scripts in
`apps/server/scripts/` that each correct a sale they filed themselves (`daily-close-demo.ts`,
`modelo-303-demo.ts`, `settle-invoice-first.ts`) and tests. The till computes a basket VAT split
(`vatBreakdown` in `apps/till/src/state/working-order.ts`) that no screen shows; it uses the rate
the menu froze for a dish and a variant (`vatRate`, filled in `apps/till/src/api/client.ts`),
prices a retrieved held line by its class, and leaves out extras picks. Asesor Q26 is still open.
**The owner's points for when this is designed (2026-09-29):** (1) the amount staff enter for a
correction is what the customer gets back, VAT included — a €2.00 correction at 10% is €1.82 base
plus €0.18 VAT, not €2.00 base; (2) the owner asks whether a correction should instead cancel the
original and issue a new invoice (a corrective invoice by substitution, `TipoRectificativa` "S",
where today's correction path files one by differences, "I", in
`packages/fiscal-verifactu/src/backend.ts`) — an open question for the asesor, not decided; asked
as asesor Q31 (2026-09-30).
_2026-09-27, A68 (landed as #726, main `27b54f877`) narrows M7v on the owner's instruction: the
published version freezes the VAT CLASS only; `working_order_lines.vat_class` replaces `vat_rate`
(and the net `unit_price` goes); each class's percentage is a dated table in code (`VAT_RATE_TABLE`,
`packages/catalogue/src/vat-rates.ts`), looked up for the local date of the invoice's issue instant,
so an order open across a legal change pays the new rate and a release can ship a future-dated rate
that changes nothing before its date. The "rate has no product surface" and "a publish freezes the
new rate early" sentences above no longer hold, and the till preview and the product editor show the
rate in force today. **Upgrading** (measured through `applyMigrations` on databases built by the base
commit): a venue with no order lines migrates cleanly; a venue with ANY order line — a settled
walk-up is enough — fails `migrations.apply_failed`, caused by `NOT NULL constraint failed:
__new_working_order_lines.vat_class`, and rolls back whole, so it needs `wa-wt reset` (a real box, a
reset). A menu published before A68 keeps selling (its extra `vatRate` keys are ignored) and shows
Unpublished changes until it is published again. Owner rulings at landing (2026-09-27):
invoice-first issues at placing, so it takes the placing day's rate; a box holding order lines is
reset rather than given data-migration code; and every invoice path reads its one clock after the
order's lines, so a request crossing midnight files the new day's date and rates together. Asesor
Q26 reworded to the rate on the day of issue._
**Menus Task 8 (home layouts), landed as #722 (2026-09-27): the Home page tab and a layout per device
profile.** A menu's Home page tab (`/manage/menus/menu/<id>/view/home`) lists its home layouts with the
default marked, and adds, duplicates, renames and deletes them and makes one the default; its tiles are
edited with the sections editor, offer only products and sections the menu's structure reaches, show
product and section tiles differently in words and shape, mark a tile whose target has left the
structure "Not on this menu", and are previewed at handheld (3 columns) and till (6 columns) width.
Device profiles gain a Home layouts section: one picker per menu that has more than one layout (or a
saved choice), where "Default" follows the menu's default and a choice whose layout was deleted shows
as removed with "Use the default". Choices are stored in the catalogue's new
`device_profile_home_layouts` table (class `state`, carried by configuration export and import);
`layout_id` has no key on purpose (plan D14). A tile is accepted when the menu's structure reaches
its target, whether or not the product is switched on, active, or the menu active; publishing still
leaves such a tile out and Preview warns (D13). _2026-09-30: publishing is to keep an empty slot
in the tile's place instead, so later tiles do not move
([design](superpowers/specs/2026-09-30-catalogue-menus-routing-design.md) §4.5)._ **Upgrading** (measured: the new catalogue migration
applied over a database at main's migration state with rows in place): it adds one table and the rows
survive. **Left open, none blocking:** nothing on a till reads the
layouts or the device's choice yet — that is Task 9, which also resolves a deleted layout against the
live menu (D14) (_2026-09-27: menus Task 9 does both; see its entry below_); a profile's layout
choice saves as soon as it is picked, outside the profile's own
Save and Cancel (the section says so); which layout is being edited is not in the page address; the
tile picker offers active products only, as the Structure tab's does, so an inactive product's tile
shows no marker and cannot be added again until the product is switched back on; and no accessibility
scan covers the delete window's error state. Open for the owner (#722's description): the picker never
offers the current default layout by name, so a profile cannot be pinned to today's default so that it
stays there after the default changes; the server would accept such a choice.
**Menus Task 9 (the till's home page) landed as #729 (main `1cfd2551b`), 2026-09-27. With it, every
task of the menus plan is built.** The till's `product-grid`
card, and the table screen's round grid, now show `till-menu-browser`
(`apps/till/src/widgets/menu-browser.ts`): a search over the whole published menu that lists each
product once, then the device's home layout's shortcuts, then the menu's structure, where a section
opens in place behind a breadcrumb and a section's button carries a folder icon and the word
"Section". A product the menu switched off is left out; an unavailable one keeps its place, greyed
and marked "Sold out"; a section shows its customer name in the till's language, then the venue's
default language, then its internal name. The grids use up to a card's own column count when it sets
one, else up to 3 on a handheld and 6 on a till, and fewer when the window is narrow, and a tile's
name wraps between words, breaking inside one only when that word is wider than the tile. Both
offers routes now also carry each menu's structure and layouts from its live version, and they and
`GET /api/menu-state` carry the layout the device's profile chose, resolved against that version
(`resolveDeviceHomeLayouts`, `packages/catalogue/src/home-layouts.ts`): a published layout deleted
since the last publish keeps showing until the menu is published again, and then the till warns and
shows the default; a chosen layout deleted before it was ever published is warned about at once. The
till warns once for each removed layout of a menu while its page stays loaded (a removal it cannot
name, only if nothing has been said about that menu yet). When a newly loaded version drops the
section the till has open, it says "Not found" and shows home. `product-grid.ts` is gone; the tap
logic is in `apps/till/src/widgets/product-pick.ts`. A device's token is now checked outside the
venue's write lock (`tryReadDevice`, `apps/server/src/device-session.ts`, with `verifySecretAsync`).
No migration. Left open, none blocking: search matches the staff name only, not a customer name or a
section's name; every `/api/menu-state` read from an enrolled device now reads the device, and the
till reads once per zone it holds at each poll (before this branch a read naming a zone, which the
till's always does, skipped the device read) — the token's scrypt check (21.1 ms, measured once on a
Mac) runs off the lock, once per device until its token changes, the server restarts or the device
falls out of the 256 the server remembers; and no test switches one menu
between two layouts and compares the structure, search and prices (the browser builds those from the
offers alone, and a layout switch reloads none). What needs the owner, and what the closing sweep of
the spec found, are the entries after this block.
**M7b2 landed (#702, 2026-09-26): a manager can clear a card payment a crash left running.** The
Payments screen lists open orders locked by a card payment nothing is finishing any more, and "Check
with the card provider" files the sale once if the card was charged, marks the payment failed and
unlocks the order if it was not (unless another payment of the order could still be captured or
waits to be filed, or a newer attempt has replaced the lock), and refuses if the provider is
unreachable or unclear; each resolution is recorded in the append-only `payment_resolutions`
table. What it leaves open is under "What M7b2 left open" in the payments section.
Classification Task 3 has landed and menus Task 9 landed as #729, so both the menus plan and the
sales classification plan are complete. The
owner lifted the wait: the dependency upgrades are
finished, and the work does not wait for SQLite slice 2. The menus plan's decisions D1–D23 settle
the spec's open integration points; D6, D9, D10, D11, D12, D13 and D22 are the ones flagged for the
owner. Menus Task 3 wipes existing venues (it rebuilds `menu_items`); every other migrating task
adds tables or columns only and measures its own upgrade. Every dev venue then needs
`wa-wt reset demo <name>`, and the owner's box should be wiped once now that menus Task 7 has landed (#719).
A note Task 2 leaves for Task 3: the image library links every `section` use of a photo to
`/manage/sections?section=<id>`, but that use can also be a list a menu owns, which the sections
screen does not list and so does nothing for. So when Task 3 lets a menu's list carry a photo, link it to the menu editor or
narrow the link to library sections.

**Copying some of a section's products into another section is not built** (found by the menus
plan's closing sweep, 2026-09-27). The menus spec §2 ("Copy membership when you want independent
collections") asks to select all, almost all or some of a section's products and add them to another
section, creating that section in the same flow if needed, with the selection telling the section's
own members apart from products reached through a section nested in it. What landed is duplicating a
section with some members unticked (`POST /management-api/sections/:id/duplicate`) and §10.2's Add
products flow, which picks from the whole product list filtered by reporting category
(`apps/dashboard/src/widgets/section-add-products.ts`). The plan's Task 2 cites §2's copy, but its
steps build neither the copy nor creating the destination in the flow. **Next action:** the owner
decides whether §10.2's flow replaces §2's copy; if not, it is an addition to the Sections screen.

**The till says "Not found" (menus spec §9) only when a newly read version drops the section it has
open.** §9 asks that a tap on a home tile whose target is no longer in the version the device should
be showing say the item was not found and reload the home screen. As built, the menu browser draws
only what it can find in the version it holds, and the till puts a newly read version on screen as
soon as it has read it (pinned by "a device behind the live version (§9)" in
`apps/till/src/till-app-menu-refresh.test.ts`). Before the till has read a newer version — up to one
15-second poll, longer on the counter while a sale, hold or place is in flight or the review dialog
is open, and longer again when a reload fails — a tap acts on the version it holds: a product's line
names that version, and the basket refresh (D9), run on the counter when the till reads the new
version, and on the counter or a table when the server refuses the line `menu.version_changed`,
lists the product as "no longer on this menu". A shortcut whose target a newly read version lacks
simply disappears, with no notice. **Next action:** the owner confirms this meets §9, or asks for a
notice when a shortcut disappears.

**Some secret checks still hold the venue's write lock while scrypt runs.** Every check against a
stored hash from `packages/identity/src/secret-hash.ts` now derives the key with
`verifySecretAsync` on Node's thread pool, so the event loop keeps turning while it runs.
**Done (2026-09-30, lane A's A125, #912):** the print agent's token (`authenticateAgent`,
`packages/printing/src/agent.ts`, called by `requireAgent` in
`apps/server/src/print-agent-session.ts`) reads the stored hash, derives the key and re-reads the
row with no transaction open, refusing the token if the agent was revoked or re-keyed meanwhile, and
takes the write lock only for its once-a-minute sighting write, which checks the row again inside
that transaction; the two join-status readers (`readJoinStatus` and `readAgentJoinStatus`,
`apps/server/src/join-requests.ts`) derive the key after the transaction holding their sweep and
reads has closed, and their routes in `apps/server/src/device-api.ts` and
`apps/server/src/print-api.ts` open none; the setup reset proof (`matchesResetProof`,
`apps/server/src/setup-api.ts`) awaits `verifySecretAsync`. New tests in
`packages/printing/src/agent.test.ts` and `apps/server/src/join-requests.test.ts` show another
writer committing while the key is derived (each failed before the change); the agent's tests also
have a case authenticating while another caller holds the write lock, when no sighting is due.
Earlier, the device token (menus Task 9, `tryReadDevice`, `apps/server/src/device-session.ts`) moved
to `verifySecretAsync` and off the write lock; in #900 (A126), `verifyPin` and `verifyPassword` and
every caller (`credential.ts`, `manager-login.ts`, `profile.ts`, `apps/server/src/break-glass.ts`)
moved to `verifySecretAsync` only. The PIN, manager-login and profile checks still await the key
while their caller's `withTransaction` (which is the write lock, `packages/db/src/tenancy.ts`) is
open, so other writes wait while the key is derived, though the event loop now keeps turning. A
search of the non-test callers of `verifyPersonCredential`,
`authorize` with an override, `loginManager`, `loginManagerById` and the `profile.ts` functions
(2026-09-30) found every server route among them inside `withTransaction`: PIN login
(`loginWithPin` in `mountTillApi`, `apps/server/src/till-api.ts`), the drawer override
(`POST /api/drawer/open`, same file), the payments PIN re-check (`verifyManagerPin` under `gated`,
`apps/server/src/payments-api.ts`), the refund's override and PIN confirmation
(`refundBillPayment`'s first transaction, `apps/server/src/bill-refunds.ts`), manager login
(`apps/server/src/management-api.ts`, and `loginManagerById` in `promote-api.ts` and
`mirror-bundle-api.ts`), and profile changes (`updateProfile` in `apps/server/src/me-api.ts`, and
`withCredentialChange` in `apps/server/src/management-api.ts` around passkey registration and
Google linking). **Next action:** move the PIN, manager-login and profile checks out of
`withTransaction` wherever they sit inside one, as A125 did for the print agent. Still blocking the
event loop, not covered by this entry's work: `hashSecret` derives with `scryptSync`
(`secret-hash.ts`), so minting a token or setting a PIN or password stops the loop while it runs;
and `deriveKey` (`apps/server/src/scrypt-kdf.ts`) runs `scryptSync` too, which the server reaches
when it encrypts or decrypts a configuration bundle, decrypts a restore archive or a sealed node
state, or encrypts a recovery bundle.
Left open by #912's review, not changed there: (1) the two join-status readers answer from a hash
read just before the key is derived, so a request denied or revoked in that window can get one
stale `pending` or `approved`; both routes return only `{ status }` and issue no credential, and
the joiner's next request goes through `tryReadDevice` or `authenticateAgent`, which re-read the
row (the till and print-agent clients were not traced). (2) With the blocking twin gone,
`verifySecretAsync` could be renamed `verifySecret` across the tree (optional). (3) **Done
(2026-09-30, A146, #941):** `tryReadDevice`'s last-seen write did not re-check the device, so a device
revoked or given a new token while its request waited for the write lock was still served. It now
re-reads the row inside that transaction, refuses one no longer active or no longer holding the
checked token (as the print agent does), and returns the device's details as read there. Of the
three cases in `apps/server/src/device-session.test.ts` whose titles end "while it waits for the
lock to record a sighting", the two refusals (revoked, re-keyed) returned the device before the
change and `null` after; the third returned the old profile before the change and now the one the
device was moved to.

**The till's removed-layout warning outlives a sign-out.** When the home layout a device's profile
chose is removed, the till warns (naming the layout if it had shown it, otherwise the menu) until
someone presses Dismiss. Signing out does not clear it (`#onLogout` leaves `removedLayouts` as it
is, `apps/till/src/till-app.ts`), so the next operator to sign in on that device sees it. Each
removed layout of a menu is warned about once while the page stays loaded (a removal it cannot name,
only if nothing has been said about that menu yet). **Next action:** clear it in `#onLogout`, if the
owner agrees the warning belongs to the operator who was signed in.

**A section with nothing to order in it disappears from the till, and the tiles after it move.** The
menu browser leaves a section out, from the structure and as a shortcut, when no product beneath it
is among the offers it is given (`indexMenu`, `apps/till/src/widgets/menu-browser.ts`). That happens
when every product in it is switched off on the menu (Task 9's choice, pinned by the D5 case in
`apps/till/src/widgets/menu-browser.test.ts`), and while a diet filter is on and every product in it
fails the filter, because the card grid hands the browser only the products the filter keeps
(`apps/till/src/widgets/card-grid.ts`; pinned for the structure only by "hides a product the diet
lens rejects, and a section it leaves with nothing" in `apps/till/src/widgets/card-grid.test.ts`) — as a dish the
filter rejects already disappears. It also happens when every product in it is published as not
sold separately, because `indexMenu` leaves such products out of the offers it indexes (pinned by "leaves a product not sold separately out of the tiles, the structure, its section and the search, and a section left empty goes too" in `apps/till/src/widgets/menu-browser.test.ts`). A section whose products are all sold out keeps its place, and its tile is not greyed;
the products inside it are. Spec §5 wants buttons in predictable positions during service. **Next
action:** the owner decides whether either kind of empty section should keep its place, for example
greyed.

**A joined tab of no party can have kitchen slips naming a table its ticket did not print.**
Correction and MOVED slips name such a tab's lowest-id table (`orderTableLabels`,
`apps/server/src/kitchen-print.ts`), so after a join a MOVED slip's "from" can name the other
table; recording each ticket's printed table would fix it. _(2026-09-30, C86: `orderTableLabels`
now lives in `packages/db/src/party-table-labels.ts`.)_ A party's bill names all its tables
instead (the table-actions "Task 4 DONE" entry below). Outside tests, `openTab`'s one caller is
`seatTable` (`apps/server/src/parties.ts`), which opens the tab on a new party. Whether a tab of no
party can reach a join in production is not established: `moveTab` of an open parked order onto a
table is an unchecked path to one. _(2026-09-29, table actions Task 11: the till no longer calls `moveTab` or `joinTable`; the routes stay until Task 13.)_ _(2026-09-29, table actions Task 13: the routes and `moveTab`, `joinTable`, `mergeTabs`, `transferLines` and `unjoinTable` are deleted, and `dining_tables.tab_id` is dropped, so a bill reaches a table only through its party or, for a counter order, `delivery_table_id`.)_

**The owner decided a split check gets no Void; the server now allows one.** Since
table-actions Task 2 (#825, 2026-09-28), `voidTabLine`
(`apps/server/src/working-order.ts`) calls `assertPartyBillOpen`. It lets through an open bill
that belongs to a party whether or not a table points at it, and a split check carries its party
("can have a line voided", `apps/server/src/party-main-bill.test.ts`). _(2026-09-30, B11a:
`voidTabLine` is deleted; `applyAdjustment` (`apps/server/src/adjustments-apply.ts`) makes the same
`assertPartyBillOpen` check, and that case now cancels by calling it directly, through the
`cancelLine` test helper in `apps/server/src/testing/cancel-line.ts`, not through the route.)_
An open order of no party
that no table points at is still refused `tab.not_open`. Before Task 2 the server refused a void
on a check no table pointed at (`assertAnchoredTabOpen`). Since menus Task 7b (owner decision
2026-09-26), a part of a line the kitchen has started can be split onto a check. A check can be
merged back into its tab (`mergeTabs`, "tells the kitchen nothing when a check merges back into
the tab it was split from" in `apps/server/src/split-bill.test.ts`). _(2026-09-30, Task 13:
`mergeTabs` is deleted; that test now merges the check back with `mergeBills`
(`apps/server/src/bill-actions.ts`).)_
**Decided (owner, 2026-09-26):** a check gets no Void. The till pays a check straight after
"Create bill", so a dish being cancelled is voided on the TAB first; a change of mind in between is
covered by merging the check back. Since menus M7b3 the originating till does that merge itself when
the waiter leaves the check unpaid (Back to floor, another screen tab, or another table). After a
reload, on another device, after logging out, after a server switch, while the check is being
paid, or when the server refuses the merge, the check stays in the counter's Held orders, where it
can be paid; when the merge gets no answer the till says it cannot tell which of the two places the
check is in.
_(2026-09-29, table actions Task 10: the till no longer merges the check back on its own. A change
of mind is now undone by Merge bills on the party's table screen, by hand. Whether that still
covers the no-Void decision is for the owner.)_
The durable link between a check and its table is lane B's party record, landed as #715: a split
check carries its party, the till's table screen lists it among the party's bills, and Finish
table is refused while it is unpaid.

**Ongoing — the dashboard UI overhaul, screen by screen.** Every screen is being brought onto one
shared look, and the rules for it live in [design-system.md](developers/design-system.md). That
document is the contract, and it grows as we go: each screen tends to raise a question the rules do
not answer yet, and the answer is written down there in the same change rather than left in the
screen. It is screenshot-driven iteration with the owner looking at each step, not a
write-a-plan-and-dispatch job.

**Open, and it bites this work first: two documents now state the component rules and they have
already drifted** (found by the #337 review, not fixed there). `design-system.md` binds the token
rule to "any component or view" and its forbidden-colour list omits `color()`;
[conventions-ui.md](developers/conventions-ui.md) records what the guard mechanically enforces, which
is narrower — `packages/ui/src/no-hardcoded-chrome.test.ts` globs `packages/ui/src/components/*.ts`
only — and its list does include `color()`. #337 recorded which is authoritative for what
(the guard decides what CI does, `design-system.md` decides what a reviewer asks for) rather than
silently editing either. **Next action:** decide whether the token rule binds views as well as
components, then make the guard and both documents agree — one of them is currently telling a reader
something CI will not enforce. Whoever picks up the next screen should settle this first, because
every screen after it inherits the answer.

**Fixed (C69, #865): every `var(--wt-…)` read in source text is now checked against the names declared.**
The Cloud services screen's two reads of undeclared names (its labels' weight and its card's width)
now read declared tokens. The guard, `scripts/style-token-names.test.ts`, is weaker than its name
in the ways its header states, and excuses the five till reads under A4 in its `FALLBACK_READS`; an
entry that is no longer needed fails the guard, and nothing stops one being added, so keeping the
list from growing is a job for review. **Settled (owner, 2026-09-29: "B"; fixed in C75, #867):** the Cloud
services screen now follows design-system.md's "Typography roles" table, as
`content-languages-screen.ts` does: each field label small, normal weight and muted, each value
bold. A computed-style case in `cloud-services-screen.test.ts` checks every label and value on a
screen showing a completed replacement.

**Fixed (C76, #879): the Cloud services and Backups screens, and the Backups screen's bucket-copy
panel, write their dates in the dashboard's language, not the browser's.** Found by C75: with
Spanish chosen in the dashboard, a browser set to US English showed "9/29/2026, 1:43:33 PM". Each
date now passes `currentLocale()` to `toLocaleString`, as `formatAlertTime`
(`apps/dashboard/src/widgets/alert-format.ts`) already passed it to `Intl.DateTimeFormat`. Each date
still shows the day, month, year and the time with seconds. One case each for the Backups screen
and the bucket-copy panel, and two for Cloud services (one per state that shows a date), set the
dashboard to Spanish in the English-language test browser and check the Spanish form. **Also fixed
(C85, #896):** the Profile screen's passkey creation date (`apps/dashboard/src/screens/profile-screen.ts`),
left out of C76, now passes `currentLocale()` to `toLocaleDateString`; one case in
`profile-screen.test.ts` checks the Spanish form the same way.

**Also open, and product-wide: the primary blue fails the accessibility contrast bar as text on the
page background, in the light theme.** Measured against the shipped values in
`packages/ui/src/tokens/colors.css`: light `--wt-color-primary` (`#1f6feb`) on `--wt-color-bg`
(`#f7f7f8`) is 4.33 to 1, under the 4.5 to 1 WCAG AA minimum for normal text. The dark theme is
fine (`#4c8dff` on `#101216`, 5.86 to 1), and so is the same blue on a card or modal surface (4.63
to 1 on white) — which is why it goes unnoticed: only primary-coloured text sitting directly on the
light theme's page background falls short, and the token is used as text in a number of places
across the dashboard and the shared components. Recorded rather than fixed there (owner scope,
2026-09-13), because changing a shared colour token mid-branch touches every app.

**What is missing is a check on the tokens themselves.** The `*.a11y.test.ts` suites do run axe's
full default ruleset, colour contrast included — a bare `axe.run` with no rule filtering, in
`apps/setup/src/widgets/test-helpers.ts` for the wizard and `packages/ui/src/a11y-helpers.ts` for
the shared components, each painting the themed background so the check means what it means in the
app. But axe only ever sees a pairing some mounted component happens to paint, so a pairing no
component paints is unchecked however many a11y suites run. Nothing enumerates the tokens against
each other, and `packages/ui/src/no-hardcoded-chrome.test.ts` scans for hardcoded colours, not for
contrast. **Next action:** an owner colour call — darken the light theme's primary until it clears
4.5 to 1 as text, or rule that the token is never text on the page background and add a check that
says so.

Done so far: the dashboard shell itself — the sidebar, the banner and the account menu — plus
**Account settings** (Your profile) and the **user administration** section (#333; what changed is
under A7).

Still to do, roughly in the order a venue meets them. As each one lands, add the rule it taught to
`design-system.md`:

1. **Overview and Sales** — `dashboard-overview-screen.ts`, `dashboard-sales-screen.ts`.
2. **Catalogue and product depth** — `catalogue-screen.ts` and `purchases-screen.ts`. The owner-requested
   Products overhaul has landed in all four of its builds: Categories (#340,
   [integration notes](developers/product-categories.md)), Modifiers (#341,
   [integration contract](developers/modifiers.md)), Units (#342) and Products (#345,
   [operator guidance](products.md)). One question is left hanging over it: the existing zero-rate class
   is shown as **No tax (0%)**, and asesor Q20 asks whether any intended case legally needs N1 or N2
   instead — to be answered before the first live filing, not before more building.
3. **Printing** — `printers-screen.ts` with its agent tabs, and `printing-rules-screen.ts`. #319,
   #327 and #380 reworked these recently, so read them against the rules before changing anything.
4. **Payments** — `payments-screen.ts` and the provider panels in `packages/payments-stripe` and
   `packages/payments-sumup`. #333 changed only their row menus.
5. **Devices and displays** — `devices-screen.ts`, `device-profiles-screen.ts`, `floor-screen.ts`,
   `kitchen-screen.ts`, `service-status-screen.ts`.
6. **The two editors** — `canvas-editor-screen.ts`, `receipt-screen.ts`.
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

**Content languages and the image library — LANDED #339 (2026-09-12).** The operator picks which
languages product and menu text is written in and which one is the fallback; photos live in a shared
library (the mandatory `packages/media` module) with translated names, alt text, search and reuse,
and a picture cannot be deleted while a product uses it.
[Operator guide](content-and-images.md).

What it left open:

- **A new picture consumer has to add a real database reference, not just store a filename.** Products
  point at the image table through a foreign key on the picture's filename
  (`products_media_image_fk`, `ON DELETE RESTRICT`), which is what makes "you cannot delete a picture
  something is using" true. Any future screen that shows a library
  picture has to add the same kind of reference and a sentence naming the use, or that check will not
  see it. Next action: whoever adds the second consumer writes the reference and the usage text in
  the same change.
- **The online language selector has nothing to select for yet.** The setting and the rule for
  choosing a language are built and tested; the customer-facing online ordering surface they were
  built for does not exist. This is a prerequisite that landed early, not a half-finished feature.

**Follow-up — the image library was unusable as shipped, fixed in #344 (2026-09-13).** The screen
no longer returns a 500 on its first load, alt text is optional, and the upload and edit dialog
shows a preview of the chosen picture.

What that leaves open:

- **Nothing tells you which pictures have no alt text.** Making it optional was right — being unable
  to save a photograph because you had not written a description was worse — but there is now no
  prompt, no warning and no report anywhere. A venue can end up with a library where most pictures
  have no alt text and nothing ever surfaces it, which is the accessibility cost of the fix.
  **Next action:** decide whether the library should mark pictures with missing alt text, the way the
  translation-gap check marks missing names. Cheap to add; it just has not been decided.
- **A whole screen shipped broken through the full ceremony, and the reason is worth keeping.** #339
  went through `finish-branch`, an independent review, and green CI, and the first person to open the
  screen got a 500. Every layer read code or ran tests; none opened the page. The test-shape lesson —
  a matrix that varies two things separately and never crosses them proves less than it looks — is the
  reusable half. **Half of it is now a rule**, in `CLAUDE.md` §4 — written on the
  certificate-pages branch, which hit the same wall from the other side — a corrupted colour value that every string assertion accepted — and
  added the §4 rule covering it: a page asserted as a string, or reached only through its API, has
  nothing checking that it renders, so open it in the browser packages' real Chromium. **Next action:**
  the TEST-SHAPE half is still unwritten — a matrix that varies two things separately and never
  crosses them proves less than it looks. That is a different rule and wants its own line.

**Photos are shrunk on upload (slice 2, Task 0) — LANDED #543 (2026-09-24).** Every upload is
resized to at most 1600 pixels on its longer side, turned upright, stripped of its metadata (GPS
position included) and stored as WebP at quality 80 by `prepareImage`
(`packages/media/src/prepare.ts`).

What it leaves open:

- **The upload limit is 20 MB (owner decision 2026-09-23, up from 5 MB).** It limits what may be
  uploaded, not what is stored: it bounds how large an upload the server will buffer. The decode is
  bounded by the pixel limit, `MAX_INPUT_PIXELS` (100 million), because a small file can declare
  that many pixels; a 100-megapixel picture raised memory by about 29 MiB when decoded (the plan
  drafter's measurement). What current phones produce has not been measured.
- **The library grid loads the full 1600-pixel copy for each tile.** The screen asks for 24 photos a
  page (`packages/media/src/dashboard/image-library.ts`), about 4 MB at the average size, fetched as
  the tiles scroll into view and cached afterwards. A small thumbnail copy would help over slow
  Wi-Fi. Next action: decide whether the grid needs one.
- **Dev venues seeded before this keep full-size tiles** until `wa-wt reset demo <name>`.
- **libvips is LGPL-3.0-or-later** and now ships in the box image, with its licence texts, its
  notices and a written source offer in `/app/third-party/` (`deploy/third-party/`). The legal
  advisor is asked to confirm it (`docs/compliance/action-plan.md`, 2026-09-23).

**Product categories — LANDED #340 (2026-09-13).** Categories get their own page at
`/manage/categories` with translation, a picture, a parent, and a delete that previews what will
change and then proceeds rather than refusing; labels on past orders stay readable.
[API and integration guide](developers/product-categories.md). _2026-09-25: the several-categories
membership is gone. Sales classification Task 1 gives each product one main reporting category in a
strict tree, plus any number of flat labels, and drops `product_categories`; the guide above is
rewritten for it._

What it left open:

- **Category authoring serialises across the whole database, and nobody has measured what that
  costs.** Hierarchy edits, main-category changes and category deletion take no lock of their own
  since the storage switch: `withTransaction` admits one write transaction per venue file, which is
  what makes the races safe (`packages/catalogue/src/categories.ts`, above `listCategories`). The review confirmed the specific
  races are handled but reported no throughput measurement, so there is no evidence either way about
  how this behaves with several managers editing the catalogue at once. **Next action:** measure it
  before anyone widens category authoring to more concurrent editors, rather than assuming it is fine.
- **Routing to several destinations is still not designed** — that item sits under A9 below. The
  memberships it was first written about are gone (2026-09-25); labels are to be the conditions for
  kitchen routing rules instead (menus spec §10.5). _2026-09-30: now designed, without labels:
  one maker station per item, any number of watchers
  ([design](superpowers/specs/2026-09-30-catalogue-menus-routing-design.md) §5)._
- **A category's colour is stored but shown nowhere outside the categories screen.** Nothing on the
  till, in menus or in reports reads it yet. The colour is data a future consumer can follow; nobody
  has decided whether or how one should. _2026-09-30: decided — categories lose their colour and
  image ([design](superpowers/specs/2026-09-30-catalogue-menus-routing-design.md) §2.1). Closed
  2026-09-30: both columns are dropped from `category_details` (product-folders slice 1, Task 5), so
  there is no colour left to show._
- **No "category dependants" seat exists on the module contract.** The delete-preview route
  (`GET .../:id/dependants`) is core-catalogue-specific; a module that wants its own kind of
  dependant (beyond products, child categories and preparation routes) has nowhere to plug in one.
  _2026-10-01: this route is retired by product-folders slice 1; folder deletion uses the bulk
  selection summary and delete operations described in [Product categories](developers/product-categories.md)._
- **Nothing stops the next screen making the same mistake.** A check that compares the class names a
  screen's own stylesheet styles against the class names it puts inside `wt-data-table` cell callbacks
  looks feasible and would catch this whole kind of bug; nobody has tried to write it.

**Categories screen rebuilt — LANDED #353 (2026-09-14).** `/manage/categories` became a table
switchable between a tree and a flat list with a name filter, a per-category colour swatch and a
per-category products window with bulk add; what it left open is recorded in the #340 list above.
_2026-10-01: product-folders slice 1 retires this screen; folders are managed on Products._

**Category management reworked — LANDED #362 (2026-09-14).** The category screens share one layout
with searchable `wt-combobox` pickers, and the shared `wt-data-table` gained opt-in search,
per-column filters, a starting sort, filtered-tree parent rows and a remembered per-tab view. What it
left open is recorded in the #340 and A7 lists.

**Category colour and membership layout — LANDED #383 (2026-09-16).** The colour picker lays its
twenty-four swatches out as hue columns so no hue splits across a line break.

**Product modifiers — LANDED #341 (2026-09-13); replaced by Extras and Options below.** What the
customer chose is stored on the order line as a fact, so a held order, a fiscal invoice, the kitchen
ticket and the receipt all show the same answers even after the modifier is later edited.
[integration contract](developers/modifiers.md).

What it left open:

- **The Units build has to keep its own quantity and precision checks.** Modifier validation runs
  independently of the product's selling unit, and extras multiply by the parent quantity even when
  that quantity is fractional. **Next action:** whoever builds Units adds its validator alongside this
  one and does not gate either on `pricingUnit === "each"` — that shortcut would silently skip
  modifier validation for anything not sold by the each.

**Modifiers become Extras and Options — DONE, all thirteen pull requests landed (2026-09-21).** The
single modifier idea was split into Extras (reusable product lists, each pick becoming its own sale
line) and Options (reusable label lists, saved as a note on the dish line), composed through one
ordered attachment list per product. Landed across #412, #436, #445, #449, #452, #456, #462, #465,
#469, #471, #476, #478 and #480.

**What branch 1 deliberately did NOT build:**

- **An options list is always required.** It asks for exactly one pick, with the default
  preselected, which is what today's behaviour was. An OPTIONAL options list —
  one a diner may leave unanswered — is a possible future change, not built. Today an unanswered ACTIVE list refuses the order with `options.label_required`.
- **A variant offers its parent's lists and cannot override them.** The attachment list is the one
  thing a variant does not override; a per-variant attachment row is a possible later
  addition. Everything else about a variant — price, names, photo, VAT, category,
  unit, kitchen station, allergens, dietary declarations — IS editable per variant. A product-level
  preparation route cannot name a variant: `createPreparationRoute`
  (`packages/venue-service/src/operations.ts`) refuses one with `route.subject_not_found`, and a
  variant line takes its parent's routes.

**Two gaps Task 13 did not create but did leave standing in the open, both worth a decision:**

- **The demo venue no longer demonstrates extras at all.** The old seed's three legacy modifiers
  went with the legacy tables, and nothing replaced them: `apps/server/scripts/demo-seed/` creates
  an options list (`seed-option-lists.ts`, the sirloin's `Punto`) and no extras list — checked by
  grepping the whole seed directory for `createExtraList`, which matches nothing. So a demo box
  shows the Options half of the feature and not the Extras half, and `docs/products.md` now says so
  rather than describing extra prices that are not seeded. **Next action:** seed one extras list on
  a demo dish, with a menu-offer price that differs from the product's own, which is what the
  removed text used to illustrate.
- **A menu item created today offers its product's options lists and none of its extras lists, and
  the function that would publish one has NO non-test caller.** Options need no publication, so they
  always travel; an extras list reaches an offer only through `setMenuItemExtraLists`
  (`packages/catalogue/src/extras.ts`), and there is no management route to it. `createMenuItem`
  (`packages/catalogue/src/operations.ts`) used to auto-seed a new offer with the product's active
  option groups, and Task 13 removed that with the old model; the new model has no twin, and did not
  have one before either. Pinned by "omits an extras list the
  offer does not publish, and keeps the options list"
  (`packages/catalogue/src/offered-modifiers.test.ts`). **Next action:** decide whether a new menu
  item should inherit its product's extras lists by default, or whether publication stays explicit
  and a route is built for it.
- **Are per-menu extras worth keeping at all? (owner, 2026-09-26: "I'm not sure it is worth the
  effort.")** A menu can carry its own version of a product's extras lists, with its own prices and
  availability (`menu_item_extra_lists`, `menu_item_extra_items`); the menus plan keeps them (its
  D5), and the Modifiers screen's "Used by" popup shows them as menu rows. Options lists have no such
  per-menu version. Dropping per-menu extras would remove two tables, `setMenuItemExtraLists`, the
  menu rows in `extraListDependants`, and whatever the menus publish copies from them (not traced);
  it would also settle the item above. **Next action:** the owner decides keep or drop; if drop, it is a menus-plan
  change, coordinated with lane C.

**Extras and Options editors — owner review fixes (2026-09-26), campaign lane A items A64–A67 —
LANDED (A67 last, #718).** The owner's review of the Modifiers screen: Active/Inactive in place of "In use", a Used
by column, an options popup that lists products only, collapsed name sections, steppers for choices
and quantities, baseline-aligned rows, a bin icon, the product's unit beside each price, a wider
standard modal everywhere, visible drag feedback, option rows as text with their own editor, and an
options list that always has a default.

- **A64 (shared pieces) — LANDED, #714.** The `wt-number-stepper` control, the dashboard's `minus` and `bin` icons,
  a standard modal widened from 768px to 1024px (dialogs and help tooltips keep 768px), and a lifted
  look for a row being dragged, with its own colour token, `--wt-color-surface-lifted`. Left for
  A66: at the stepper's 64px width (`--wt-stepper-field-width`) the box has 48px for text, and
  "No limit" needs 52px and "Sin límite" 62px at the body font size, so a "No limit" placeholder is
  cut off unless that stepper is given more width (A66 gave it a wider box). Seen while looking at every modal at 1024px, not
  changed: the printers screen's list of discovered printers keeps its details column capped
  (`min(28vw, 24dvh)`), so the details wrap while half the row stands empty; and the till's option
  picker, 1024px wide on a 1280px screen, puts each price at the far end of a 1024px row, well
  away from its name (which adds to the "prices are not a column" item in the till layout pass,
  under A4). The stepper's button names were text with a `{label}` slot; A66 made them functions.
- **A65 (the list tables and the Used by popup) — LANDED, #716.** Both tabs'
  Status column and its filter read Active / Inactive; each editor's on/off switch shares the
  "Active" string, so its label now reads "Active" where it read "In use". A new Used by column
  counts what carries each list ("2 products · 1 menu item", "Not used" at zero), sorts by the
  total, and its count is the link that opens the popup, titled "Used by {name}" ("Dónde se usa
  {name}"); the name is plain text. Each count button's accessible name adds its list's name, so two
  lists with the same counts do not sound alike. The menu figure counts menu ENTRIES, so it says
  "menu items" ("elementos del menú"), not "menus": one menu offering the list on two dishes counts
  twice. An extras list's popup and delete preview name each menu row "{dish} — {menu}"; an options
  list's popup lists products only, with no Type column, and its delete warning never mentions menu
  items. The list reads now refresh when `product_modifiers` (both) or `menu_item_extra_lists`
  (extras) change, which also refreshes the catalogue screen's copies of the two lists. Where the
  screen is 30rem wide or less (480px at the default text size; a phone), the two counts, and a
  popup row's menu, each take a line of their own. Measured at 390px, the tables still scroll
  sideways inside their own box, further than before by the new column: Extras 511px of content in
  388px (439px before) in English, 610px (463px) in Spanish; Options 457px (402px) and 479px
  (405px). The page itself does not scroll sideways.
- **A66 (the Extras editor) — LANDED, #717.** The customer-facing and kitchen names fold into a
  "Customer and kitchen names" section, closed until opened, whose heading counts the names filled
  in ("1 of 3 filled in") and which opens by itself when the server refuses one of them. Minimum and
  maximum choices are − / + steppers side by side (one above the other where the form is 30rem wide
  or less), with short labels and the old parenthetical explanations moved to a line underneath;
  both boxes use a new, wider width token, so the two match and "No limit" and "Sin límite" fit. In each
  product row, the maximum quantity is a stepper, the price box is a fixed width (a new token) with
  the product's unit shown after it as plain text (Each when the product has no unit), and Remove
  is a bin icon with the same spoken name; the Maximum quantity heading carries the required mark; the Price heading runs over the bin column. A row lines up its text: the product name, the
  quantity, the Preselected label and the price all sit on one line. Shared changes it needed: the
  stepper's button names are now functions (the A64 open point), the price field can hide its label
  and show its unit as text, and a switch now takes its label's text as its line. On a phone the
  Preselected text beside each switch is hidden (the column heading names them) and each unit moves
  under its price, breaking inside a word where it must. Measured in Chromium 153.0.8010.12,
  2026-09-27, at a 390px viewport (the page's own width read back as 390) with two 9999.99 prices:
  163px of sideways scroll in English and 206px in Spanish, and a 104px price column, for each of
  "g", "ración", "kilogramos", "Unidadesdeembalaje" and a unit with no abbreviation named "Large
  half portion" / "Media ración grande". An earlier measurement, not repeated, read 234px (English)
  and 271px (Spanish) before the A66 rework. Open point for the owner: clearing the Minimum
  choices box saves 0, as it did before A66 (the save format's own default); the plan's Review Focus
  item 3 reads as if a cleared minimum should be refused instead.
- **A67 (the Options editor, and always a default) — LANDED, #718.** The server now keeps a default whenever an options list has an available
  option: `parseOptionListInput` gives every option without an id one of its own and, where the
  body names no default or names one that is switched off, returns the first available option as
  the default, which the write stores (a list with nothing available, possible only while it is
  inactive, has none). A row
  copied in by configuration transfer is not re-parsed, so, as the spec's D8 records, a stored
  empty default is still possible. In the dashboard's Options list editor the list's
  customer-facing and kitchen names fold into a closed section, as in the Extras editor; each
  option is a row of text (its name, an "Unavailable" tag when it is switched off, the Default dot,
  and a menu with Edit and Delete); Edit and "Add option" (was "Add label") open the option in its
  own window stacked over the list, and saving it changes the draft only. "Clear default" is gone:
  the form shows the default the server will store, moving it to the first available option when
  the default is deleted or switched off, and doing the same when a list is opened with no default.
  A refusal naming one option's field shows under its row, in the summary, and beside the field
  when that option is opened; Escape closes only the option window and focus returns to the row's
  menu. The editor's wording now says "option" rather than "label" in both languages. Two
  follow-ups are tracked as open items below this list. Looked at in
  both themes, English and Spanish, at 1280px and 390px (read back from the page as 1280 and 390):
  no sideways scroll at 390px, of the page or the options table. The option window is the standard
  modal at the same size as the list's, so it covers the list entirely; only the darker backdrop
  shows that it is stacked.

**One small follow-up A67 left open:**

- **The Options list's rows centre their contents rather than lining up by text baseline (D6).**
  A row is one line of text beside the Default dot and a menu button, so centring reads the same;
  but when a server refusal adds an error line under an option's name, the dot and menu centre on
  the name and the error together. Expected from the CSS in `option-list-form.ts`, not yet looked at
  on screen. **Next action:** screenshot a row carrying an error and decide whether to align by baseline.

**Branch 2, variants as products — LANDED.** A variant is now a `products` row
behind a `parent_id`; the separate `product_variants` and `menu_item_variants` tables are gone. Its
nine pull requests: Task 1 #511, Task 2 #517, Task 3 #528, Task 4 #532, Task 5 #537, Task 6 #539,
Task 7 #545, Task 8 #551, and Task 9 #556. How the model works now is in
[products.md](developers/products.md), under _Variants_. The open items each task left are in its
paragraph below. **Two of its tasks (1 and 4) cannot upgrade a venue that holds data**, so every dev
venue needs `wa-wt reset demo <name>` after each, and a provisioned box should be wiped once, after
Task 4, the owner's home box included.

**Task 1 LANDED as #511: every dev venue now needs `wa-wt reset demo <name>`, and no
provisioned box takes the image without a wipe — the owner's home box included.** Deliberately
left: the counts of `products`'
columns, keys and checks in the comment of the shipped `packages/media/drizzle/0001_image_references.sql`
are stale, because editing a shipped migration changes the hash `packages/migrations/src/journal-hashes.ts`
compares. The same file's paragraph saying `product_variants.image` is deliberately not guarded is
stale too: since Task 3 a variant's photo is `products.image`, which that file's triggers guard. It
stays unedited for the same reason.

**Task 2 LANDED as #517: a product's one on/off switch is now two — Active (it exists)
and Available (sold out for now).** What it left open:
- **Reopening a held order on the till drops a sold-out item** — an extra the menu no longer lists,
  and every extra of a dish that has sold out — with a "no longer available" message. The same
  already happened to an Inactive product. `docs/superpowers/specs/2026-09-20-service-ordering-and-billing-design.md`
  §10 says marking a product unavailable must not cancel existing work. **The owner chose option A
  on 2026-09-23** (lane B question Q1): keep a sold-out line in held work, flag it on the till, and
  refuse only a quantity increase (the server already refuses the increase). A follow-up item, not
  part of the variants plan's nine tasks. **Next action:** build it. (2026-09-24: the till now keeps
  an extra no list offers on a reopened order, marked "Not offered now" and counted in the total,
  and a line whose dish it no longer offers, rebuilt from the line's stored snapshot, carries the
  same mark; a line with no stored snapshot whose product the till no longer offers is still
  dropped with `held.product_gone`. See the DONE entry
  under Task 9 below. Still open against option A: the first edit of the order removes such an
  extra, where option A refuses only a quantity increase.)
- **Raising a held line's quantity does not check the line's variant, or whether its menu, or the
  menu's own switch for the product (`menu_items.active`), has been switched off** — only its
  parent product and extras. Neither Task 3 nor Task 5 (#537) took it, so it remains open. **Next
  action:** on a quantity raise, check the line's own product (the variant, since #537) for Active
  and Available, its menu, and the menu's switch for the product.
- **DONE (lane C's C5): the units screen's in-use list heads its column "Status".**
  `productsUsingUnit` (`packages/catalogue/src/units.ts`) now returns the product's Active flag as
  `active`, in the `unit.in_use` error's details, in `GET /management-api/units/:id/products` and
  in `POST /management-api/units/:id/products/reassign`.

**Task 3 LANDED as #528: variants are stored as products and follow their product onto
every menu.** What it left open:
- **A removed variant can be reached again, and its photo cleared (resolved by Task 7, #545).**
- **A variant's id is refused by the management routes that read or write a product by id**, each
  answering as it does for an id naming no product (the recipe route answers `product.not_found`) —
  except the product editor's two routes, which since Task 6 are a variant's own page. The
  "is this a top-level product" check now lives in one function, `productWithId`
  (`packages/catalogue/src/variant-fallback.ts`), used by the catalogue's by-id reads and writes,
  `apps/server/src/catalogue-api.ts`, `apps/server/src/kitchen.ts` and
  `packages/venue-service/src/operations.ts`; every route's answer is unchanged.
  `addProductToMenu` (its own `menu_item.variant_not_allowed`) and `setProductRecipe`
  (`packages/recipes/src/recipes.ts`, which asks the opposite question) still write their own. Of
  the four writers that had no check: `applyRecipeDerivation` and `applyDietDerivation` now refuse
  a variant (`product.not_found`), because a variant has no recipe of its own, and when a parent's
  derivation changes they republish each of its variants that sets its own value for that column.
  `assignProductUnit` and `deactivateProduct` are left without one: a variant's own page gives it
  its own unit through the first, and the second (which nothing outside the tests calls) makes a row
  Inactive, which a variant may be (V6).
- **DONE (menus Task 5, #670): a menu price is checked by the server's rule** (`isProductPrice`).
- **A variant's price may be left blank on its own page and in its product's variants list, and a
  blank variant is charged its product's price** (on a menu, a price that menu sets for the variant
  or its product comes first).
  Since Task 6 the product editor accepts a blank price both on a variant's own page and in its
  product's variants list, so a product whose variant has no price of its own can be saved back
  unchanged. The dashboard's variant form shows such a price as an empty field and saves it back
  blank (`apps/dashboard/src/widgets/variant-form.ts`); the price field is no longer marked
  required. Since Task 7 an empty variant price shows the price it falls back to: the variant form's
  price field and the variant's own page carry the product's price as the field's hint, and the
  variants list reads "Same as" that price. A new variant's form starts blank, not at `0.00`.
- **The units screen lists variants too, and offers them a target labelled as Each.**
  `productsUsingUnit` (`packages/catalogue/src/units.ts`) does not limit itself to top-level
  products, so a variant with its own unit appears in the screen's list of products using a unit.
  The screen's reassign target for "no unit" (`REASSIGN_EACH`,
  `apps/dashboard/src/screens/units-screen.ts`) is labelled "Each (no unit)"
  (`units.change_unit_each`, `apps/dashboard/src/i18n/strings.ts`). For a variant, choosing it
  means "follow the parent's unit and pricing unit", which may be kg rather than Each.
  **Next action:** decide whether the units screen should list variants, and how to label that
  target for them.

**Task 4 LANDED as #532: a blank menu price follows the product's own price.** It cannot upgrade a
venue that holds data (see above). What it left open, both put to the owner in #532 — now both closed:
- **Creating a menu offer with no price field at all is still refused** (`management.request_invalid`);
  only an explicit `null` means "blank, charge the product's own price". **DECIDED 2026-09-23 by the
  owner: keep refusing** — _"we don't want to confuse 0.00 with `""`"_, so a missing field is never read
  as blank or as zero. Pinned by a test in `apps/server/src/catalogue-api.test.ts`.
- **DONE (#541, lane C's A11b): the menu's offers list marks a blank price.** That list went with
  menus Task 5; since #680 the Prices tab can show the struck-out display as a "Price on this menu"
  column.
  Two follow-ups #541's review raised, not taken, neither blocking: (1) the dashboard's product list
  shows a variant's blank price as its parent's with no marking
  (`apps/dashboard/src/widgets/product-list.ts`, the `price` column's cell) — whether it should grey
  it the way the offers list now does is the owner's call; (2) the rule that hides screen-reader
  text is copied into each widget that needs it (`grep -rln "clip: rect(0, 0, 0, 0)"` over
  `apps/*/src` and `packages/*/src` lists them); a shared one in `packages/ui-core/src/base-styles.ts` would be an optional tidy-up.

**Task 5 LANDED as #537: a variant is sold as the product it is.** The order line's
product is now the variant itself. What it left open:
- **A held order brought back to the till shows a variant line with its PARENT's VAT class,
  category and allergens.** The till reads them from the offer snapshot saved in
  `working_line_contexts`, which is the parent's. Filing is unaffected — the price and rate billed
  come from the line's own stored values. Since Task 6 a variant's own page can give it its own VAT
  class, category and allergens, so a retrieved line can now show values that differ from what was
  billed. **Next action (a follow-up, not one of the plan's tasks):** save or read the chosen
  variant's values for a retrieved line.
- **DONE (menus plan Task 7b, #696):** a tab split or transfer refuses a quantity finer than the
  line's `unit_precision` (`tab.transfer_quantity_invalid`).
- **DONE (Task 9): on a venue with no service zones a parent with Active variants is refused**
  (#556); since B4 the refusal happens on a zone's menu offer, and covers an extras pick and a
  raised held-line quantity too. The owner's rule (lane B's question Q3): _"a parent product should never be for sale as
  itself — you should always have to pick a variant. This doesn't depend on zones."_ `GET /api/products`
  (`listAvailableProducts`) still lists such a parent; nothing in `apps/till` outside its tests
  calls it (the till builds its buttons from zone offers).
- **DONE (B4, #571): a venue with no service zone sells nothing.** See "A sale needs a zone" below
  Task 9.
- **`@waitron/fiscal-verifactu`'s tests now depend on `@waitron/catalogue`** (its VAT-per-variant
  test runs the real `selectMenuVariant`), so a catalogue change also runs fiscal-verifactu's test
  shard in CI. Kept deliberately; worth revisiting only if that shard's time becomes a problem.

**Task 6 LANDED as #539: a variant has its own product page on the server.**
`GET`/`PUT /management-api/products/:id/editor` now accept a variant's id. What it left open:
- **Reassigning a unit's products to another real unit (not Each) does not update their stored
  pricing unit** — for top-level products as well as variants. Found by the review; I believe it
  predates Task 6, not checked with `git blame`. **Next action:** check whether anything still reads
  `products.pricing_unit` for a product with a unit row, and either update it on reassignment or
  say why it does not matter. No sale reads it since B4: see the B4 update on "Two different
  signals say whether a dish is sold by weight" below.
- **Review suggestions not taken:** split the editor's types into a product shape and a variant
  shape (removing the non-null workarounds in `saveProductEditor` and the dashboard), derive
  `InheritedValues` from the product type, and write a parent's variant republishes in one
  statement. Task 7 consumed the contract as it stands and did not take them. **Next action:**
  reconsider on their own; nothing waits on them. Task 9's cleanup removes the old variant table
  and its shapes, not the editor's types, so it does not cover them.

**Task 7 LANDED as #545: a variant has its own page in the dashboard.** What Task 7 leaves open:
- **The product list shows "—" for a variant's allergens**, because the list's data carries none for
  a variant (`ListedVariant`, `packages/catalogue/src/product-types.ts`). **Next action:** decide
  whether the list should read a variant's effective allergens, and add them to that read if so.
- **Not yet looked at on a phone (390px wide):** a variant's name may sit a few pixels low in its
  product-list row. **Next action:** open it at that width, in both themes, and look. (The variants
  table's unit select, once cut to "Unid" in Spanish at that width, is no longer shown there: a
  table 30rem wide or less hides its price column, heading select included, and puts each price
  under the variant's name, so on a phone the price field's unit button is the way to the unit. A
  wider table still shows the select.)
- **The product list's variant read repeats a grouping.** `listedVariantsOfProducts`
  (`packages/catalogue/src/operations.ts`) groups variants by parent the same way
  `variantsOfProducts` (`packages/catalogue/src/variants.ts`) does. **Next action:** share one
  grouping helper.
- **A variant image usage's `productId` has no reader in the dashboard any more**
  (`packages/media/src/dashboard/client.ts`): the image library now links a variant's use to the
  variant's own page by its `id`. **Next action:** drop the field, or say what it is kept for.
- **The product list's events are not named `wt-*`:** `edit-product`, `delete-product` and the new
  `restore-product` (`apps/dashboard/src/widgets/product-list.ts`), against CLAUDE.md §3's event
  rule. **Next action:** rename the three together, with the catalogue screen that listens to them
  (`apps/dashboard/src/screens/catalogue-screen.ts`). `wt-edit-product` is already taken: the units
  screen sends it to `apps/dashboard/src/dashboard-app.ts`, so pick names that cannot reach that
  handler by mistake.

**Task 8 LANDED as #551: top sellers now roll variants up under
their parent.** What Task 8 leaves open:
- **The overview's top-sellers table can reach into its card's padding at desktop width** when a
  variant has a long one-word name and the figures run to five digits. Measured 2026-09-24 at
  1280px: with "Café con leche pequeño descafeinado" at 1000.000 / 10000.00 the table ended 12px
  inside the card's 17px padding (it stays inside the card's border); with three-digit figures, or
  with no variant rows, it ended at the padding's edge. **Next action:** decide whether a long name
  in that table may wrap mid-word.

**Task 9 LANDED as #556: the old variant table is gone.** The catalogue
migration `packages/catalogue/drizzle/0004_drop_product_variants.sql` drops `product_variants`, and
needs no reset of its own. What Task 9 leaves open:
- **DONE (#575): paying a held order bills its lines as parked, and the till shows what it bills.**
  Only a raised quantity is refused; since #696 paying refuses an unsent extra that can no longer be
  sold.
- **Retrieving a held order reads the counter's CURRENT zone offer, not the zone the order was
  parked in.** `#onRetrieveOrder` (`apps/till/src/till-app.ts`) matches each line against the
  till's `products`, which hold the offers of the zone the counter is showing (loaded by
  `listDefaultZoneOffers` or `listZoneOffers`), and the retrieved order (`HeldOrder`,
  `apps/till/src/api/client.ts`) carries no zone. An order parked in one zone and retrieved while
  the counter shows another can therefore mark its lines and extras "Not offered now" when its own
  zone still offers them. Found by the branch that added the "Not offered now" mark; traced through
  the code, not run. **Next action:** send the order's zone with the retrieved order and read that
  zone's offer on retrieve.
- **A label typed when re-holding an unedited retrieved order is never saved.** Measured 2026-09-24
  by the run-it review of the branch that added the "Not offered now" mark, in real headless
  Chromium: a throwaway `till-app` test retrieved an order, made no edit, and re-held it with the
  label "New label"; neither `updateWorkingOrder` nor `parkOrder` was called (the test printed
  `REVIEW label calls [] []`). Re-holding a retrieved order saves only through `#syncIfDirty`
  (`apps/till/src/till-app.ts`), which does nothing unless the order has been saved before AND a
  line was edited, and a label change deliberately does not count as a line edit (the `#dirty`
  comment in `apps/till/src/state/working-order.ts`). **Next action:** give the till a way to save a label
  without re-sending the lines, so the stored extras and locked prices are kept.
- **DONE (#578): an extras list can no longer offer a product with Active variants**
  (`extras.product_has_variants`, `product.offered_as_extra`). A variant itself may still be an
  extra.
- **The extras form cannot pick a variant.** The catalogue accepts a variant as an extras item
  (owner decision 2026-09-24), but the extras form's product picker lists top-level products only
  (`listProducts`, `packages/catalogue/src/operations.ts`), so a manager cannot choose one from the
  dashboard. **Next action:** decide whether the picker should list variants.
- **A configuration transfer copies `extra_list_items` as a table, not through the extras list
  save**, so it does not ask #578's `extras.product_has_variants` question
  (`CATALOGUE_CONFIGURATION_TRANSFER`, `packages/catalogue/src/configuration-transfer.ts`). A source
  venue saved under the rule carries no such item; one holding data written before #578 would carry
  it across. Read, not run. **Next action:** none unless transfers from older venues matter.
- **The two `till-sale.test.ts` cases named "…gained an Active variant" pass with the variant left
  Inactive** (reported by #578's implementer, who removed the activation and saw both still pass),
  so their billing assertions do not depend on the variant being Active. #578 added a check that the
  setup really makes it Active; the cases themselves were not redesigned. **Next action:** give each
  an assertion that fails when the variant is Inactive, or rename them to what they prove.
- **The header of the shipped `packages/media/drizzle/0001_image_references.sql` still describes
  `product_variants.image`,** now a dropped table. It stays unedited, for the reason given under
  Task 1.
- **`packages/fiscal-verifactu/src/privileges.expected.ts` still lists `product_variants` and
  `menu_item_variants`.** It is a frozen record of the grants before the storage switch, when both
  tables existed, and its one reader (`scripts/write-path-tables.test.ts`) reads only its
  read-but-never-written rows, which these two are not. Left as it is.

**A sale needs a zone — DONE (B4, #571; lane B's queue item B4, not Track B's B4 below).**
Every sale line is now priced from the menu offers of its order's service zone, and the path that
priced a line by bare `productId` is gone; a sale sent with no `zoneId` takes the venue's
counter-default zone, and a venue with none is refused `service_zone.default_missing`.
What B4 leaves open:
- **The old station chain in `fireLines` routes nothing the till can sell now.** For an order with
  no zone, `fireLines` (`apps/server/src/working-order.ts`) takes each line's kitchen station from
  the product, then its category, then the venue's default station, and refuses
  `station.no_default` when none is set. On an order in a zone, a line that names a product routes
  by the zone's preparation routes, and `resolvePreparationRoutes`
  (`packages/venue-service/src/operations.ts`) refuses `route.missing` rather than fall back to the
  chain. Every path that prices new lines now refuses
  an order with no zone, so the chain is reached by orders parked with lines before B4, and by the
  tests that build such an order directly (`createOpenOrder` with no lines, a line inserted by
  hand, then `fireLines`), which keep it covered. A transfer from a zoned tab onto an empty tab on
  a table in no zone is refused `service_zone.mode_incompatible` for part of a line as for a whole
  one (`transferLines`, pinned by "refuses a transfer onto an empty tab on a table in no zone" in
  `apps/server/src/transfer-lines.test.ts`). _(2026-09-30, Task 13: `transferLines` is deleted; the
  refusal is now `transferItems`'s (`apps/server/src/bill-actions.ts`), pinned by "refuses a
  transfer onto an empty bill of the party with no service zone" in the same test file.)_ So
  three dashboard settings no longer route anything sold today: the product editor's station
  (saved through `setProductStation`, `apps/server/src/catalogue-api.ts`), a category's station
  (`PUT /management-api/categories/:id/station`, `apps/server/src/management-api.ts`; the
  dashboard's API client has `setCategoryStation`, and no screen calls it) and the Kitchen
  screen's default station (`apps/dashboard/src/screens/kitchen-screen.ts`). **Next action:** owner
  to decide whether to delete the chain and those settings, or keep them.
- **`GET /api/products` has no caller in the till app, and `listAvailableProducts` is off the sale
  path.** The till builds its buttons from zone offers (`GET /api/default-service-zone/offers` and
  `GET /api/service-zones/:zoneId/offers`). `TillApi.listProducts` (`apps/till/src/api/client.ts`)
  is kept because the till's tests stub it and derive their zone offers from it. Outside tests,
  `listAvailableProducts` is called by that route (`apps/server/src/till-api.ts`) and two dev
  scripts (`apps/server/scripts/demo-seed/seed.ts`, `apps/server/scripts/allergens-demo.ts`).
  **Next action:** decide whether to retire the route and move the till's tests onto zone-offer
  fixtures, or keep both.
- **A location's menu list is read by no sale.** A sale takes its menus from the zone
  (`zone_menus`, read by `listZoneOffers` in `packages/venue-service/src/operations.ts`). The
  location's list (`locations.catalogue_id` plus `location_catalogues`) is still read and written
  elsewhere — among them `GET /api/products`, the management API's location routes
  (`apps/server/src/catalogue-api.ts`; no dashboard screen calls them since #297), configuration
  transfer, both provisioning seeds, two dev scripts and the server's `offerProducts` test helper.
  `git grep -n "locationCatalogues\|location_catalogues\|resolveAccessibleCatalogueIds\|listAvailableProducts\|listAccessibleCatalogues" -- apps packages ':!*.test.ts'`
  finds the table's and its helpers' users; a read of `catalogue_id` alone, as the venue-service
  seed and configuration transfer make, needs a separate grep for `catalogue_id`/`catalogueId`.
  **Next action:** owner to decide whether to retire `location_catalogues` and those routes with
  `GET /api/products`, or keep them.
- **A table in no zone still opens a tab, and nothing can be added to it.** The till seats a
  party through `seatTable` (`#onOpenTable`, `apps/till/src/till-app.ts`), which opens a party and
  a tab with no lines, and a booking seated at a table does the same through `core.seatTable`
  (`seatBooking`, `packages/bookings/src/bookings.ts`); on a table
  in no zone that tab opens, and every round on it is refused `order.service_context_missing`. The
  till shows no products there: `#onOpenTable` loads offers only for a table with a zone and leaves
  the grid empty otherwise. Pinned by "openTab with no lines on a table in no zone opens an empty
  tab" and "addTabRound on that empty tab refuses order.service_context_missing"
  (`apps/server/src/till-api.zone-required.test.ts`). **Next action:** owner to decide whether to
  refuse opening a tab on a table in no zone, or to require every table to have a zone.
- **Moving that empty tab onto a zoned table does not give it a zone.** `moveTab` and `joinTable`
  (`apps/server/src/working-order.ts`) only re-point a zone record the tab already has
  (`findOrderContext`, then `retargetOrderContext` or the `service_zone.join_mismatch` check), and
  a tab opened on a table in no zone has none. So after either one, a round naming an offer the
  new table's zone lists is refused `order.service_context_missing` (409), and the tab can never
  take a round. **Next action:**
  the same owner decision as the entry above; if tabs on tables in no zone stay allowed, `moveTab`
  and `joinTable` must create the zone record rather than only re-point one.
  _(2026-09-29, table actions Task 11: the till no longer calls `moveTab` or `joinTable`; the routes stay until Task 13.)_ _(2026-09-29, table actions Task 13: the routes and `moveTab`, `joinTable`, `mergeTabs`, `transferLines` and `unjoinTable` are deleted, and `dining_tables.tab_id` is dropped, so a bill reaches a table only through its party or, for a counter order, `delivery_table_id`.)_
- **Two branches still read a held line that names no menu offer, and only an order parked before
  B4 should have one.** `getHeldOrder` (`apps/server/src/working-order.ts`, its
  `context === undefined || line.productId === null` arm) returns such a line by its product alone,
  and the till's retrieve (`#onRetrieveOrder`, `apps/till/src/till-app.ts`, the `liveByProduct`
  lookup) finds it among today's offers by product id or drops it with `held.product_gone`. Every
  line priced since B4 records its offer (`lineContexts`, `priceOrderLines`), and a partial transfer
  copies it to the new line (`copyLineContext`, `transferLines`). _(2026-09-30, Task 13:
  `transferLines` is deleted; the copy is in `carveOffLines`, which `splitBill` and
  `transferItems` (`apps/server/src/bill-actions.ts`) call.)_
  **Next action:** delete both branches, since no backwards-compatibility code is owed before
  production (CLAUDE.md §3), or say what keeps them.
- **`sale.unknown_product` was retired by A77.** A line naming an item the zone does not offer is
  refused `service_zone.offer_not_allowed` instead.

Task 10 has landed as **#471**: the built-in `doneness` field was removed end to end, and the demo
steak now carries a `Punto` cooking options list instead. The per-line free-text note stays.

Whether a `+ <list>: <label>` sub-line is prominent enough on a kitchen ticket to replace the old
`** MEDIUM RARE **` framing is still an open question nobody has put to a real cook.

Task 8 has landed as **#465**: the held-order preserve-path comparison became order-independent,
fixing a reorder bug where a quantity-only edit deleted and re-priced every line.

- **Superseded by menus plan Task 7b (#696):** a stored extras child now records its list and pairs
  with a pick on list, product and quantity, and the till no longer guesses the list.

Task 9 has landed as **#469**: the filed sale line carries a dish's frozen answers in
`sale_lines.option_snapshots`, and the customer receipt prints one `<list>: <label>` line under each
dish.

Task 11 has landed as **#476**, the dashboard side: `/manage/modifiers` is one screen with **Extras**
and **Options** tabs, and the product editor gained an always-visible **Modifiers** section.

What Task 11 left open:

- **`--wt-cell-name-max-width` is now used in three different directions, and the token is named
  for only one of them.** Some consumers CAP a name cell with it; others use it as a `min-width`
  FLOOR so a cell holding one input does not shrink to the tap-target minimum and cut its value off
  mid-word; and one uses it as a FLEX BASIS on a combobox, which is not a table cell at all. The
  floor's tables then carry their own horizontal scroller, which is the thing the cap exists to
  avoid. Both descriptions say so (`packages/ui/src/tokens/structure.css`,
  `docs/developers/design-system.md`); neither lists the consumers, because that list went stale
  twice inside Task 11's own review — grep for the token instead. **Next action (design decision):**
  decide whether a second token for the floor is right, or whether one shared sizing value used
  three ways is the honest design.

- **DONE (#741, lane C's C4): a refused nested unit or category create shows its refusal inside
  the form.**
- **DONE (#741, lane C's C4): a late second cancel can no longer close another nested catalogue
  form.**
- **DONE (lane C's C5): the standalone Units screen says why a unit save was refused inside its
  form.** `#save` in `apps/dashboard/src/screens/units-screen.ts` places every refusal with
  `unitRefusalErrors`, beside its field or in the form's summary, and no longer in the banner behind
  the modal.
- **DONE (lane C's C23): the Categories screen places a refused save through
  `categoryRefusalErrors`.**
  _2026-10-01: product-folders slice 1 retires the screen; the folder form retains
  `categoryRefusalErrors`._
- **DONE (lane C's C24): with no colour chosen, the colour field's Custom square reads as
  empty.**
- **DONE (lane C's C25): with a custom colour chosen, the colour field's Custom square is ringed
  as selected and the colour fills it up to the ring, with no grey rim.** The grey rim was the
  input's own background (rgb(239, 239, 239) in light theme, rgb(107, 107, 107) in dark, measured
  in HeadlessChrome 153) showing through the padding around the inner square, plus that square's
  own grey border. The selection is shown by the painted ring only; the input carries no radio
  role. C24's empty look now also holds in Firefox, and the new ring and fill cases pass there too
  (Firefox 151, the Custom-square cases run locally; CI runs Chromium only).
- **Two things about the colour field's Custom square stay OPEN (2026-09-27, left by lane C's
  C25).** In `apps/dashboard/src/widgets/color-field.ts`: (1) Safari was not tried, so what it
  draws with no colour chosen, and whether the ring and the rim-free fill hold there, is unknown;
  (2) the guess that choosing black in the browser's picker from the no-colour state may not
  register was not run, because no way was found to drive the browser's own picker from the test
  tools (a test that sets the value directly is not evidence either way). Also seen and not
  changed: with a palette colour chosen, the Custom square shows that colour too, beside the ringed
  swatch; the "fills the Custom square right up to its border while a palette colour is chosen"
  case in `apps/dashboard/src/widgets/category-form.test.ts` pins this, so a decision to change it
  changes that case. **Next action:** try (1) in Safari or Playwright's WebKit, and (2) by hand in
  Chromium.
- **DONE (2026-09-30, lane A's A150, #937): `wt-tabs` sends its own `wt-tab-change`, and the seven screens'
  `event.target !== event.currentTarget` checks are gone.**
- **Two things on the Venue operations screen that #546's review raised and left for the owner**
  (`packages/venue-service/src/dashboard/venue-operations-screen.ts`; found 2026-09-24, not fixed
  because #546 changed tests only). (1) A zone-menu row whose menu is not in the loaded list shows
  an empty Menu cell, while its row actions are labelled with the stored menu id; whether a
  foreign key makes that row unreachable in practice was not checked. (2) When the row that opened
  an editor is gone by the time the editor closes, focus goes to `wt-tabs` as a whole, and Chromium
  puts it on the tab STRIP rather than the selected tab — seen at the test browser's 414-pixel
  width, where the strip scrolls; a wider screen was not tried. A keyboard or screen-reader user
  then starts from the strip. **Next action:** decide whether (1) should show the id or a
  "missing menu" label, and whether (2) should focus the selected tab.
- **Two things in the image library that #547's review raised and left for the owner**
  (`packages/media/src/dashboard/image-library.ts` and `image-picker.ts`; found 2026-09-24, not
  fixed because #547 changed tests only). (1) When the image
  picker is handed a new live-data source, the library keeps listening to the first one until its
  next load: the review removed the search that the picker test runs after the swap, and an
  invalidation on the new source then triggered no reload (`expected 2 to be greater than 2`).
  (2) The delete confirmation's Close button has no in-flight check of its own and relies on being
  drawn disabled. Measured: a real pointer click on Close straight after confirming leaves the
  dialog open (by reading, because the redraw that disables it lands first); two clicks dispatched
  by script in one task, confirm then Close, do close it while the delete runs. **Next action:**
  decide whether (1) should re-subscribe as soon as the source is replaced, and whether (2) is
  worth a `busy` check in the Close button's click handler, like the one in the modal's `wt-close`
  listener (`image-library.ts`, the delete confirmation).
- **The two list forms still share about a hundred lines of chrome.** Task 11 lifted what moved
  cleanly — `translations()`, the placeholder-carrying translated-name fields, the visually-hidden
  rule and the table chrome all live in `form-fields.ts` and `reorder-table.ts` now. What is still
  written twice is the per-form plumbing: `#primaryLanguage`, `#mapFieldErrors`, `#edit`, `#emit`,
  `#cancel`, the `willUpdate` reseed guard, the Escape-while-busy handler and the footer, each
  identical modulo the `t()` key prefix. **Next action:** decide whether a shared base or a
  controller is the right vehicle before a third list form is written; the row editors genuinely
  differ and should NOT be merged.

What option lists left open, none of it taken in #436 or #445:

- **`dependants` reads products only.** An options list has no per-menu publication row at all, so
  since A65 (owner decision D3, 2026-09-26) `optionListDependants`
  (`packages/catalogue/src/options.ts`) returns the products that carry the list and no menu side.
  The carrying `product_modifiers` rows are now selected twice in that file, each with its own
  condition on `option_list_id`: there for one list, and in `listOptionLists`' usage count for every
  list.
  **Next action:** whoever writes a refusal that uses the same condition shares it then — the
  modifier code this replaced had already learned that lesson in an `openOrderUse` helper, and that
  file went with the old model in Task 13.
- **A trap that fooled three readers on #445, not yet written into `CLAUDE.md`.**
  `pnpm --filter <pkg> test <file> -t "name"` SILENTLY DROPS the `-t` and runs the whole file; only a
  bare `--` before it passes it through. Measured both ways: without `--` the echoed command is
  `vitest run "catalogue-api.test"` and 165 tests run, with `-- -t "option lists"` it is
  `vitest run "catalogue-api.test" "-t" "option lists"` and 8 run with 157 skipped. Two review agents
  and the session driver all reported "2 of the 8 failed" from runs that were really the whole file —
  the numbers look plausible either way, which is §1's "a measurement taken where both answers look
  alike". **Next action:** add it to `CLAUDE.md` §2's trap list, which is a root-file change and so
  takes the normal pull request flow rather than the documentation shortcut.
- **A list switched on with no pickable label is refused only by the parser.** The rule lives in
  `parseOptionListInput`, which is the only door today, but nothing in the database enforces it: a
  path that writes `option_labels.available` directly, or flips `option_lists.active` with a plain
  update, could still leave a list nobody can answer.
What extras lists left open, and what #449 found on the way:

- **The seven string-parsing helpers are copied between the two contracts.**
  `packages/catalogue/src/extra-contract.ts` and `option-contract.ts` carry byte-identical copies of
  `invalid`, `record`, `keys`, `staffName`, `translations`, `kitchenName` and `id`, differing only in
  the error-code prefix. A review asked for them to be shared and it is right. The stated reason for
  waiting has since EXPIRED: it was that the plan's Task 6 would add a third contract wanting the
  same helpers, so extracting across two now would mean pulling it apart again — and Task 6 landed
  without one. Its new screening went into `packages/catalogue/src/product-editor-input.ts`, which
  already carried its own near-copies of the same helpers. So the two-way extraction is unblocked.
  Task 6 deliberately did not do it: it is a refactor of two files that branch does not otherwise
  touch, on a branch that was already large. **Next action:** extract across the two contracts, and
  decide at the same time whether `product-editor-input.ts`'s near-copies join them.
- **An untargeted `.onConflictDoNothing()` absorbs EVERY unique conflict, not only the primary key's.**
  Written into `CLAUDE.md` §3 with its receipt in `developers/conventions-data.md`. Seven untargeted
  calls remain in the tree and nothing guards this. The two that read an empty result as a specific
  cause — `packages/catalogue/src/options.ts` and `modifiers.ts` — were checked and are safe today,
  because neither table carries a unique constraint beyond its primary key. **Next action:** that is a
  property of those tables, not of the code, so adding a unique index to either one reopens it.
- **A defect found in the options sibling and fixed out of scope.** `updateOptionList` refused a save
  whose list id arrived upper-cased; #449 fixed it and added the regression test.
- **`packages/catalogue/src/options.ts` still says `findContentTranslationGap` returns rather than
  throwing.** It does throw `content.translation_invalid` for a non-text value. The extras twin of
  that sentence was narrowed in #449; this one was left, being pre-existing and out of scope.
- **The design's stated reason for `min_picks`/`max_picks` is false.** The spelling stands, and a
  dated pointer on the design document says only the reason was wrong.
- **An extras list's `dependants` fills its two sides from two different tables.** The plan's
  Task 5 added the per-menu publication row, which options lists do not have, so
  `extraListDependants` (`packages/catalogue/src/extras.ts`) reads the menus a delete would touch
  straight out of `menu_item_extra_lists` rather than reaching them through the products, and the
  products out of `product_modifiers`. Its options twin has only the one table to read.

- **A save reaches the database once per submitted label.** The read that finds which list each
  submitted label belongs to, and the delete that drops the labels a body omits, are each one
  statement — but writing the labels is a loop, because a multi-row insert cannot say WHICH label's
  id collided, and that is what the refusal names. Not worth changing for a list of a dozen labels;
  worth knowing if extras lists turn out to be much longer.

Task 12 has landed as **#478**, the till side: the picker walks a dish's `offeredModifiers`, drawing
an extras list's products and an options list's labels, and the basket nests each pick as a child
row with its own allergens and price.

What Task 12 deliberately did NOT do, so Task 13 is not surprised by it:

- **The legacy `optionGroups` and `modifiers` fields stayed on both sell-side payloads, and the
  legacy demo seed stayed.** Task 13 took all of it.
- **The per-line kitchen NOTE was not touched**, despite living in a file called
  `line-extras-editor.ts`. It was never part of this feature; the file name is now misleading and
  nobody has renamed it.
- **A retrieved line's options answers are re-sent by matching their WORDING**
  (`deriveOptionSelections`, `apps/till/src/state/held-options.ts`); a staff-name rename or a
  withdrawn label matches nothing, and the till surfaces `held.options_changed`. Since menus plan
  Task 7b (#696) the server no longer re-prices an edited line; a re-sent answer is frozen onto the
  same row at its stored price (plan D10).
- **A child extras row still renders FLAT in the tab drawer**, as its own row beside the dishes, with
  its own name, quantity and price — where the basket and the settled ticket both nest a child under
  its dish. It is now correctly skipped by the per-line action, the course picker and the split and
  transfer pickers (`apps/till/src/screens/till-table-order-screen.ts`), so nothing offers it an
  action it cannot take; whether the drawer should also INDENT it is a display question nobody has
  decided. Deliberately left as it is.
- **A published-but-DETACHED extras list is offered by nothing and demanded by the validator, and
  nothing cleans the publication up.** The two sides read different sets on ONE of the three reads
  that build those maps — the MENU-OFFER extras read, which is the read this scenario uses. The
  picker's source (`readOfferedModifiers`) keeps only the lists the product's `product_modifiers`
  attachments name, while `readMenuExtras` (`packages/catalogue/src/extra-projection.ts:131`)
  reads `menu_item_extra_lists` and nothing else, and the order path
  (`priceOrderLines` and `updateHeldOrder` in `apps/server/src/working-order.ts`) consumed `extrasByHolder`/`optionsByProduct`
  straight — so the detached list reached it. (Since menus Task 7 the order path reads the menu's
  published version instead, which `readOfferedModifiers` builds from the attachments; whether that
  closes this entry has been read, not run.) **Not true of the other two reads, checked rather
  than generalised:** `optionsByProduct` is BUILT from the attachments
  (`packages/catalogue/src/offered-modifiers.ts:109`), and the PRODUCT-side extras read is handed
  them and keeps only what they carry (`readProductExtras`,
  `packages/catalogue/src/extra-projection.ts:229`), so a detached options list — or a detached
  extras list on a plain product line — disappears from the order path too, and nothing then
  demands it: both validators walk only the lists they are handed (`validateOptionSelections`,
  `packages/catalogue/src/option-contract.ts:168`; `validateExtraSelections`,
  `packages/catalogue/src/extra-contract.ts:241`). Publishing is guarded at write time —
  `assertProductCarries` (`packages/catalogue/src/extras.ts:475`) refuses to publish a list the
  product does not carry — but DETACHING is not: `writeProductModifiers`
  (`packages/catalogue/src/product-modifiers.ts:242`) deletes and re-inserts the product's
  attachment rows and never touches `menu_item_extra_lists`. So publish a list on a menu offer,
  then detach it from the product, and the publication survives. If that list has `minPicks >= 1`,
  the picker never asks for it and `validateExtraSelections`
  (`packages/catalogue/src/extra-contract.ts:290`) refuses the order with `extras.limit_exceeded`
  — the dish cannot be rung up at all. **This was established by READING the call chain, not by
  running it**, and the reachability of the authoring sequence was not tested either. The
  experiment that would settle it: publish a list on a menu item, detach it from the product, then
  ring the dish up on the till.
- **Reopening the picker on a line whose dish has VARIANTS *and* at least one offered list loses
  the variant, and says it saved.** Both halves of that precondition are needed: the basket draws
  its Edit button only when the line's product carries an offered list
  (`apps/till/src/widgets/basket.ts`), pinned by "offers no Edit on a line whose only question was
  its variant" (`apps/till/src/widgets/basket.test.ts`), so a variant-ONLY dish cannot reach this
  at all. A dish with both passes that gate. Found while fixing something else on this task and
  MEASURED with a throwaway browser test rather than reasoned about: reopen the picker on such a
  line and no variant radio is selected, because `willUpdate` seeds the picks and the answers from
  `initialSelections` and never seeds `variantId`. Save is shut until the operator picks one — and
  when they do, `setLineModifiers` (`apps/till/src/state/working-order.ts`) discards it, because
  it reapplies `extras`, `options` and `optionSnapshots` and never touches `line.product`. Left
  unfixed on purpose — it needs a decision first about whether a basket edit
  may change a variant AT ALL. If the answer is no, the cheaper fix is to stop offering the
  variant control on a reopened line; if yes, `setLineModifiers` has to carry the product.
- **Both of the modifier picker's LIST inputs still carry a generated id as their `name`.** An
  extras checkbox group is named `extras-${list.id}` and an options radio group `options-${list.id}`
  (`apps/till/src/widgets/modifier-picker.ts`), and a list id is a uuid — so a kind in front of one
  is still the generated widget id `docs/developers/conventions-ui.md` refuses, and CLAUDE.md §3
  with it. NOT every input: the variant radios are `name="product-variant"` already, so they are not
  part of this.
  Left because the offered-list wire carries no stable per-list IDENTIFIER to use instead: an
  offered list arrives with its uuid `id`, its `kind`, its three display names and its items or its
  labels (`OfferedExtrasList`/`OfferedOptionsList`, `packages/catalogue/src/menu-types.ts`), and a
  display name is renameable and not unique, so closing this means adding something to that wire.

What the order path (the plan's Task 7) left behind:

- **A quantity-only edit made after an OPTIONS list is RENAMED re-prices the line** — superseded by
  menus plan Task 7b (#696): an edit no longer re-prices or re-issues a line; a renamed answer is
  frozen onto the same row at its stored price.
- **Two different signals say whether a dish is sold by weight, and they disagree — MEASURED.** Since
  B4 (#571) the order path reads only the unit (`priceOrderLines`, `selection.unit.hardwareUnit ===
  null ? "each" : "weight"`), so fractional billing can no longer happen on a sale; `assignProductUnit`
  (`packages/catalogue/src/units.ts`) writes `product_units` without touching `products.pricing_unit`.
  B4 did not
  touch `products.pricing_unit` or what writes it, so the two can still disagree in storage (the
  Task 6 bullet on reassigning a unit's products is the same shape). **Next action:** whoever builds
  Units decides whether `products.pricing_unit` is kept in step with the unit or dropped, now that
  no sale reads it.
- **The definition reads on the sale path take NO lock at all, while their writers serialise.** The
  four reads take
  nothing: `readMenuExtras` and `readProductExtras` (`packages/catalogue/src/extra-projection.ts`),
  `readOptionListsByIds` (`packages/catalogue/src/options.ts`) and `readProductModifiers`
  (`packages/catalogue/src/product-modifiers.ts`), all four reached from one body,
  `walkAttachedModifiers` in `packages/catalogue/src/offered-modifiers.ts`. Since menus Task 7 the
  sale path no longer reaches them: it prices from each menu's published version, read through
  `listZoneOffers` (`packages/venue-service/src/operations.ts`), except that an edit of a saved line
  whose dish the live version no longer offers reads the dish's own options lists
  (`productOptionLists`, `apps/server/src/working-order.ts`). Their writers
  serialise, but no longer by taking a lock, and the two functions this entry used to name are both
  gone: `lockExtraList`'s `for update` is now `assertExtraListForWrite`, a plain existence read
  (`packages/catalogue/src/extras.ts`), and `writeProductModifiers`'s per-list `for key share` is
  now `listExists` (`packages/catalogue/src/product-modifiers.ts`). What serialises writers is the
  venue file's write queue — one write transaction on the file at a time
  (`packages/store/src/write-queue.ts`). The concern this entry records is that a list edit
  committing mid-read could give one order a snapshot mixing pre- and post-edit wording. NOT
  MEASURED — no probe was run, and nothing establishes the window is reachable. **Whether the
  storage switch closed it is also unestablished**, and it is the first thing to check: the sale
  path's reads reach the engine through `withTransaction`, which IS the write lock
  (`packages/db/src/tenancy.ts`), so a reader that goes through it cannot overlap a writer at all —
  but nobody has traced the sale path's reads to establish they all do.
  **Next action:** trace those reads first — if every one of them goes through `withTransaction`,
  the entry closes on that alone. If any does not, the original decision stands and is simpler now
  that no lock is involved: decide it deliberately rather than slipping one in, because adding a
  lock late is its own deadlock risk, which Task 6 of this plan already paid for once (`40P01` from
  lock ordering, recorded below — a PostgreSQL code, and this engine has no row locks to order).

What the product attachment (#456, the plan's Task 6) left behind:

- **A delete-then-insert of rows that REFERENCE another table can deadlock with a delete of the
  referenced row, and `CLAUDE.md` §3's rule about that shape does not yet say so.** The rule names
  two conditions — nothing outside the table holds a key into it, and the writers are serialised —
  and both were met here. The cycle is a third thing: the rewrite deletes its own rows first and
  only then inserts rows whose foreign key needs a lock on the parent, while a delete of that parent
  holds the parent row and waits for those same child rows through its cascade. Measured on both
  kinds of list (`40P01`), fixed by locking the referenced rows before touching the child rows.
  Nothing pins it now: one write transaction runs on the venue file at a time, so the three-way
  choreography cannot be staged and the deadlock is not a shape this engine can produce — the
  successor suite `packages/catalogue/src/product-modifiers.concurrency.test.ts` says so in its
  header and asserts the outcome only. **Next action:** add the third
  condition to `CLAUDE.md` §3 with its receipt in
  [conventions-data.md](developers/conventions-data.md) — a root `CLAUDE.md` edit takes the normal
  branch-and-pull-request flow.
- **A two-transaction concurrency test that starts both sides in sequence is racing itself.** Nothing
  guards the shape; it is worth looking for in any new racing test.
- **`scripts/spawn-timeout-budget.test.ts` was failing healthy runs of itself** — fixed in #456; the
  scan it describes has since been retired, and the guard reads `scripts/` alone again.

What the per-menu publication (#452, the plan's Task 5) left behind:

- **`readProductExtras` and the product-attachment check both moved to Task 6, and both have
  landed there.** `setMenuItemExtraLists` (`packages/catalogue/src/extras.ts`) refuses to publish a
  list the dish's product does not carry. What it does NOT refuse is a body that LEAVES OUT a list
  the product carries, and the function's own doc comment says so: "Nothing refuses an offer that
  publishes none of the product's lists". There is also no
  "required list" to refuse against: an extras list carries no `required` flag (the spec makes
  "required" `min_picks >= 1`, §3.1) and §3.2 does not say a required list must be published.
  **Next action:** settle whether an offer may publish none of a product's required extras lists,
  when the menu-offer screen is built.
- **Two review findings deliberately not taken, both of them structural.** Splitting the publication
  write path out of `packages/catalogue/src/extras.ts` into a module of its own, and moving
  `resolveExtraPrice` from there into `extra-contract.ts` beside the price parsing it belongs with.
  Both were declined as churn on a branch about to land. **Next action:**
  still open — settle whether the publication write path and `resolveExtraPrice` move.
- **`setMenuItemExtraLists` keeps its membership check as its own query rather than a `LEFT JOIN`.**
  A review asked for the join. Not taken: `assertProductsOffered` reads `extra_list_items` for only
  the lists the body actually overrides, and a join hung off the publication rows would read the
  items of every list the offer publishes — the larger set.
- **The two publication tables are still not dashboard live-query dependencies, and Task 11
  SETTLED that they should not be.** Task 11 built the screens and added four new entries to
  `QUERY_DEPENDENCIES` in `apps/dashboard/src/api/live-queries.ts` — `listOptionLists` and
  `getOptionList` on `option_lists` + `option_labels`, `listExtraLists` and `getExtraList` on
  `extra_lists` + `extra_list_items` — and deliberately named nothing else. The reason is recorded
  at that entry: each of the four reads is two SELECTs and nothing more, the list table and then its
  children, and none of them joins `products`, `product_modifiers` or either `menu_item_extra_*`
  table. So `menu_item_extra_lists` and `menu_item_extra_items` stay unnamed in both dependency maps
  — the dashboard's and `packages/venue-service/src/dashboard/live-queries.ts`'s `operations` entry,
  which names neither of them. **Next action:** revisit
  when a screen that actually publishes an extras list on a menu offer is built; nothing in the
  dashboard reads either table today.
- **CLOSED by the storage switch, 2026-09-23 — there is no grant to decide about.** No production
  path updates a row in either extras-publication table — `setMenuItemExtraLists` replaces rows
  rather than editing them. What refuses a stray write today is nothing at all.

**Product selling units — LANDED #342.** A product is sold by the each, or by weight or volume, with
0 to 3 decimal places on its quantity and a price per that unit; units have their own dashboard page,
and a unit's name and precision are frozen onto sold lines.

**Update — unit abbreviations and screen rebuild.** Every unit has a short translatable
abbreviation (`kg`, `ml`), which is what prints on sold lines, receipts, kitchen tickets and the till;
the frozen `unit_name` column is presentation only and does not enter the fiscal hash. (2026-09-28:
a dish sold in Each shows no unit on the kitchen ticket, the kitchen screen and the expo board; see
the kitchen entry above.)

**Update — a product's unit is optional, and a unit lists its products — LANDED #375.** A product no
longer needs a unit (Each stores nothing), and the units screen can bulk-reassign a unit's products to
Each so the unit can be emptied and deleted.
Left open (small,
unowned): `createProduct` and `updateProduct` still duplicate the legacy-`pricingUnit` fallback, so a
shared helper would keep the two from drifting; and the synthetic `EACH_UNIT` id lives as a literal in
both `packages/catalogue/src/units.ts` and the till's `product-name.ts` with nothing pinning them equal.

**Update — clicking a unit row is now a delete, and precision is a dropdown — LANDED #382.** The row
and dialog read Delete unit and list the products that must be moved first; Precision is a 0-to-3
dropdown.

What it left open:

- **The old `pricing_unit` column survives on products as a compatibility field, and it is derived,
  not chosen.** Nothing in production code branches on it any more — the till now decides whether to
  ask for a quantity from the unit's own precision and scale mapping — but the column and its
  `each`/`weight` wire field are still written, and are filled in from whether the unit has a scale
  mapping. That derivation is lossy: litres and millilitres have no scale mapping, so a product sold
  by the litre records `each` in the legacy column even though its quantities are fractional. Anything
  that later reads that column as "can this be a fraction?" would be wrong. **Next action:** its
  removal is already listed under the #297 departments-and-menus row in A9; whoever does that should
  also clean up the demo scripts and tests that still use `pricingUnit` to pick a product out of a
  list.
- **Only kilograms, grams and milligrams can ever come from a scale.** The unit table's scale mapping
  is a fixed list of those three enforced by a database check, deliberately kept separate from the
  editable translated name so that renaming "kg" to something else cannot change how hardware is read.
  The consequence is that a unit you invent yourself, and the volume units, can never be filled in by
  weighing — the quantity is typed. That is the intended design, not an oversight, but it is the kind
  of boundary somebody will otherwise rediscover by trying it.
- **Deleting a unit no longer asks first, and a blocked delete offers a way out** — a searchable modal
  moves products onto another unit so the unit can be emptied and deleted. LANDED #350.

**The integrated product editor — LANDED #345, and the four-part Products overhaul (Units,
Categories, Modifiers, Products) is complete.** One Products list and one editor save a product's
names, image, tax choice, unit, categories, modifiers, allergen and dietary declarations and variants
in one transaction; recipe authoring was withdrawn from the dashboard. [Operator guide](products.md). (Later reworked — see #377 and #379
below.)

What it left open:

- **"No tax (0%)" is an open fiscal question, and it must be answered before the first live filing.**
  The selector shows the catalogue's existing zero-rate class under that name. Pricing puts the whole
  gross amount in the base with zero VAT, and Veri\*Factu files it as `S1` — taxable, not exempt — at a
  0.00 rate. That is a real treatment, not a placeholder, and the real backend was run against it. But
  AEAT separately requires a *non-subject* operation to record its cause, distinguishing `N1`
  (Articles 7, 14 and others) from `N2` (place-of-supply rules), and nothing established that any of
  this venue's products is legally non-subject. Asesor question Q20 asks which of the venue's intended
  cases genuinely belong in the zero-rate `S1` treatment and which need `N1` or `N2` instead, and
  whether the label should read "IVA 0%" rather than "Sin impuestos" so staff do not read a zero-rated
  sale as a non-subject one. **Non-blocking while pre-production; blocking before going live.** If the
  answer moves a case to `N1`/`N2`, that is an explicit classification threaded through sale facts,
  reporting and every Veri\*Factu sale, correction and substitution path — never a quiet redefinition
  of what `zero` means.
- **Recipe authoring is gone from the dashboard, and nothing replaces it as a surface.** The route and
  screen are withdrawn; product allergens and dietary suitability are now maintained by hand in
  Products. Purchasing data and recorded historical recipe facts are untouched and still readable, and
  the 2026-08-16 recipe-authoring design carries a dated note saying it was superseded. What nobody has
  decided is whether recipe authoring returns later as its own surface — the parked recipe depth work
  (nested sub-recipes, plate costing, stock depletion) assumes an authoring surface that no longer
  exists. **Next action:** whoever reopens recipe depth decides that first, rather than discovering it.
- **The combined end-to-end journey is not recorded as having been walked.** The checkpoint lists
  substantial focused evidence — 188 catalogue tests, 183 API and boot tests, 82 real-Chromium
  dashboard tests including both-theme accessibility, the fiscal privilege and immutability suites, and
  the real Veri\*Factu backend accepting a controlled zero-rate sale. What it does not record is the
  plan's own step 8: the single journey through the actual routes against a real database, creating a
  unit, a category and three modifier types from inside a dirty product draft and taking the result
  through the till. That is the shape of check that #344 showed matters — the image library passed
  review and CI and still returned a 500 to the first person who opened it. **Next action:** walk it
  once on a dev stack before treating the overhaul as finished.

**Product catalogue management improved — LANDED #387.** The Products page was rebuilt on the shared
table, its Delete deactivates rather than removes, and the editor adopted the shared allergen and
dietary picker; `wt-data-table` gained `initiallyCollapsed` and `wt-disclosure` was redrawn
([design-system.md](developers/design-system.md)).

What it left open:

- **The catalogue picker was deleted and nothing replaced it.** `catalogue-screen.ts` used to show a
  dropdown when a venue had more than one catalogue. The rebuild dropped it, and
  `selectedCatalogueId` now simply takes the first catalogue in the list — which is also the one every
  new product is created in. With one catalogue, which is every case today, this is invisible. With
  two, the second becomes unreachable from the dashboard, silently. **Next action:** decide whether
  more than one catalogue is a case Waitron actually supports. If it is, the picker comes back; if it
  is not, the list-of-catalogues shape should stop pretending otherwise.
- **There is still no permanent delete.** Nothing in the dashboard removes a product that was never
  sold and was only created by mistake. **Next action:** decide whether that is worth a second,
  differently-worded action, or whether deactivating is simply the answer.
- **The combined journey through the real routes is still not recorded as walked.** This is the same
  gap the #345 list above records, and this branch did not close it: the evidence is focused suites
  and a run-it review, not one pass through the actual page against a real database. **Next action:**
  as above — walk it once on a dev stack.

**Modifier editing, reworked — LANDED #352.** Editing a modifier's choices became a table with drag
and arrow-key reordering, each choice's detail opening in its own window.

**Modifier nutrition redesign (pass 1) — LANDED #377.** Each modifier choice carries its own
nutrition information and the app no longer combines a dish with its extras; the yes/no type was
dropped and dietary suitability became a positive `suitableFor` list.
[developer guide](developers/modifiers.md).

What it left open:

- **Pass 2 — icons — is not started.** Pass 1 renders allergens and diets as text pills; the design's
  pass 2 replaces them with Material Design icons across the dashboard, waiter basket and kitchen/expo
  screens. It needs its own spec. **Next action:** write the pass-2 spec when the icon work is picked up.
- **The basket's "not fully reviewed" allergen warning now depends on whether an extra was picked.**
  In `apps/till/src/widgets/basket.ts` `#allergenRow`, after the dish+extras fold was removed, a dish
  whose own allergens are unreviewed shows the "not fully reviewed" note only when it also has an
  option — a leftover of the old fold, since options no longer contribute allergens. The branch's own
  test asserts the current behaviour, so it was left as-is. **Next action (owner decision):** decide
  whether an unreviewed dish should show that food-allergen warning always, or never on the basis of
  options, then make `#allergenRow` depend on the review state alone and update the test.

**Modifiers screen rebuilt — LANDED #370.** `/manage/modifiers` was rebuilt on the Categories-screen
shape and choice allergens and diets moved to the shared `allergen-dietary-picker` widget. (Later
superseded: Task 11 replaced the whole page with Extras and Options tabs.)

What it left open:

- **Removing "contains / may contain" and the "reviewed" toggle stopped at modifier choices.** This
  branch built the shared `allergen-dietary-picker` widget and adopted it for choices only. Products,
  ingredients and the till still carry the old contains/may-contain distinction and the reviewed
  toggle. **Next action:** a separate change adopts the same widget there and decides what the removed
  distinction means for a product's own claims and for what the till withholds — it is not a
  mechanical copy, because a product declaring "may contain" is a real statement in a way a modifier
  choice's was not.
  _Partly done 2026-09-16 (#387):_ the product editor now uses the shared picker. The widget grew a
  `dietaryOptions` property so products keep their full declaration list while modifier choices keep
  the four-item default. The conclusion that the old `dashboard-allergen-picker` is not orphaned
  still holds, on different evidence: `option-group-manager.ts` went with the rest of the old model
  in Task 13, and the widget's one remaining non-test consumer is the ingredient form
  (`apps/dashboard/src/widgets/ingredient-form.ts`). **What is still open** is the question
  the item above says is not mechanical: a product's stored allergens still carry a `presence` field
  that can read `may_contain`, and the compact picker cannot show or set it. An allergen a manager
  adds is written as `contains`; one that already read `may_contain` keeps that value untouched. So
  the distinction survives in the data and in whatever reads it, with no way left in the dashboard to
  see or change it. **Next action:** decide whether "may contain" stays a real product claim — if it
  does, the picker needs a control for it; if it does not, the field and its readers go. Also
  decide about a smaller loss in the same change: the old editor showed the dietary labels that
  follow automatically from the ones you picked (vegan implies vegetarian) as greyed "inferred"
  badges, and the compact picker does not. The derivation itself still runs
  (`expandDietaryDeclarations` in `packages/catalogue/src/dietary-declarations.ts`, used by
  `apps/server/src/working-order.ts` and the till), so behaviour is unchanged — only the manager's
  view of it is gone.

**Modifier tables and nutrition editing refined — LANDED #385.** Clicking a modifier's row opens one
combined Products and Menu-items table, the modifiers list's Choices column shows the choice names,
and the choice editor's nutrition section is summary-first, edited through `wt-combobox`.

What it left open:

- **The two summary-first shapes are now NESTED in one screen.** The item was written when
  `dashboard-allergen-dietary-picker`'s only consumer was `choice-form.ts`, which summarised each
  field on its own with an Edit button beside it, and the product editor reached the same goal
  differently — the older `dashboard-allergen-picker` inside a `wt-disclosure` whose heading carried
  a joined summary of every nutrition value. Task 13 deleted `choice-form.ts`, and the product editor
  has since adopted the shared picker, so the two shapes no longer sit in two screens: they sit one
  inside the other. `renderNutrition` (`apps/dashboard/src/widgets/product-editor.ts`) renders a
  `wt-disclosure` whose `summary` is the allergen and dietary names joined, and puts
  `<dashboard-allergen-dietary-picker>` inside it, which summarises those same two fields again, each
  behind its own Edit button — the same values summarised twice, at two levels, in one section. That
  sharpens the original complaint rather than answering it. The contrast with another screen survives
  too: `apps/dashboard/src/widgets/ingredient-form.ts` still renders the older
  `dashboard-allergen-picker` expanded, with no summary and no disclosure. Each of the two widgets
  now has exactly one non-test consumer, and it is one of those two screens.
  **Next action:** as before in substance — whoever takes the already-open item above, adopting the
  shared picker for ingredients and the till, picks ONE shape; and decide in the same change whether
  the product editor keeps both its section summary and its field summaries.
- **The picker collapses on `focusout` alone.** `#finishEditing` returns the field to its summary
  whenever focus leaves the combobox, with no other way to close it and nothing distinguishing focus
  moving inside the component's own popup from focus leaving it altogether. The branch's Chromium
  tests pass, so if this is wrong it is wrong only on a path they do not walk — a touch interaction,
  or a popup implementation that moves focus. **Next action:** if a reviewer or a real user reports
  the editor snapping shut mid-selection, make the collapse depend on `relatedTarget` rather than on
  the event alone.

**The product editor reworked — LANDED #379.** A product has a plain staff-facing Name, an optional
translated customer-facing name and a plain kitchen name (resolved in
`packages/catalogue/src/product-presentation.ts`); the editor is a short form with collapsible
sections, a product has no variants or at least two, and it added the shared `wt-disclosure` and
`wt-price-input`. [Developer guide](developers/products.md).

What it left open:

- **A variant's image has no foreign key, unlike a product's — CLOSED by variants plan Task 3.** A
  variant is now a `products` row, so its photo is guarded by the same triggers as a product's.

- **A product's name can be stored blank.** `products.name` is `NOT NULL` with no non-empty check,
  and only the editor's own parser refuses a blank; `createProduct` writes what it is given. Its
  siblings share the pattern: `option_lists.name`, `option_labels.name` and `extra_lists.name` are
  each declared `` `name` text NOT NULL `` in `packages/catalogue/drizzle/0000_baseline.sql`, and
  none of that file's check constraints touches a name column. (A variant's name is
  `products.name` now.) **Next action:** decide whether the columns want a check
  constraint and the write paths a domain refusal.

- **DONE (B4): the legacy product-id order path lost the configured kitchen name.** B4 removed that
  path: every line is now priced from a menu offer, whose selection carries the product's and the
  variant's kitchen names.

- **A refused customer name cannot say which value it refused.** `content.translation_required`
  carries only the language, so the editor resolves the offending field by reading the body it just
  submitted — exact for one missing value, the first of several otherwise, so two bad variants take
  two saves to clear. Adding an optional field to that error would fix it but changes a shipped
  error's contract for consumers that do not need it. **Next action:** an owner call if it ever
  bites.

- **Saving a product reads the same tenant configuration once per variant.** `setProductVariants`
  calls `validateContentTranslations` inside its loop and `saveProductEditor` calls it again for the
  product. **Done since (2026-09-30, A149, #943):** `saveProductEditor` reads the content-language
  setting once and checks the product's customer name and every Active variant's against it
  (`writeProductVariants`, `packages/catalogue/src/variants.ts`); `setProductVariants` called on its
  own reads it once for all its variants.

- **Smaller things this work surfaced and did not take.** The kitchen screens show a kitchen-resolved
  dish name above modifier text resolved in the device's own locale, because a modifier has only one
  name in the data model. A joined customer-facing line can mix languages when a locale exists on one
  half only. `wt-price-input` was built from scratch rather than on `wt-input`'s existing end slot,
  which is why it had to be given `disabled` separately. `modifier-limits.ts` now holds a product
  rule as well as modifier ones and is named for half its contents. And five pre-existing interface
  faults were seen while walking the app: the products list heads its Name column "Description", the
  wordmark is near-invisible in the dark theme, "Top sellers" is rendered twice on the overview, the
  login screen shows an error before anything is submitted, and the recipe screen is not routed from
  anywhere so it cannot be opened at all.

### A1. Checking a fiscal record before it is written — LANDED #331 (2026-09-12)

A record AEAT could not accept is now refused at the chain seam before anything is written, and the
same rules reach the setup boundary and the `waitron-provision venue` command.

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

Each was judged and deliberately left; none blocks the merge.

- **The audited AEAT package's own shared record fixture (`@waitron/verifactu`'s `ALTA_INPUT`) is
  still a full invoice naming no recipient** — the shape A1 corrected everywhere else. Not free to
  fix: it reproduces AEAT's vector-1 hash and the exact-XML expectations in `xml/serialize.test.ts`
  would all move.
- **`packages/fiscal-verifactu`'s `venue-fields.ts` restates three rules the validator owns** (the
  series-code set, the description cap and the control-character range), kept honest by a drift guard.
  A reviewer proposed exporting the patterns from the library instead; DEFERRED on purpose (owner,
  2026-09-12) — it widens an audited fiscal library's public surface at the end of a branch and the
  drift guard already closes the risk. Revisit when something else needs those patterns.
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

The setup wizard landed in #334 (2026-09-12); corrections from walking it on a real machine, plus a
first-sign-in passkey offer, landed in #347 (2026-09-13). Two calls the PR left with the owner; the
first is still open:

- *Setup always stores a language on the account.* If the browser sends no language, or one Waitron
  does not ship, the account gets the venue's language saved as though chosen — so the stored value
  cannot tell "chose Spanish" from "said nothing", and it does not follow a later change to the venue
  default. Keep this, or store a language only when the browser asked for one? Since C42 a
  language picked in the wizard is sent as the provision's `Accept-Language`, so a choice made there
  is stored like any other browser answer.
- *The modal is always full height* — gone with the modal (C39, #828, owner decision 2026-09-28). Every
  setup screen now sits in a column centred on the page, at most 704px wide, with the Waitron logo
  at the top. The logo is the brand lockup drawn inline, so its word follows the theme; the
  dashboard banner still loads it as an image and stays unreadable in the dark theme (the entry
  under "The Waitron wordmark is invisible on the dashboard banner"). The column borrows the
  pop-up's side spacing (`--wt-modal-inline-margin` and `--wt-modal-inline-padding`, in
  `apps/setup/src/setup-app.ts`), so a later change to the pop-up's spacing moves the wizard too.
  **DECIDED (owner, 2026-09-29): leave it** — the wizard gets no spacing values of its own.

**Still open after #334**, each one something the branch consciously did not take:

- *The wizard has no translated text and no language chooser* — DONE (C42, #837, 2026-09-29). Every screen
  reads in Spanish or English from the wizard's own catalogue (`apps/setup/src/i18n/`, the till's
  pattern rather than `@waitron/dashboard-kit`'s), opens in the browser's language when it is one
  Waitron ships and in English otherwise, and offers the language chooser at the bottom right of
  every screen (since C93, 2026-09-30, in a footer below each screen instead). A choice lasts for the page's life only. When the operator chose, the provision
  request carries that language as its `Accept-Language`, so the admin account gets it; when they
  did not, the browser's own header decides as before. Left open by it:
  - *The configuration preview names what it will copy by database table* (`products`,
    `menu_item_variant_overrides`, `print_agents`…) in both languages, as it did before C42
    (`apps/setup/src/screens/configuration-preview-screen.ts`). The names come from each module's
    `configuration-transfer.ts` list; about fifty can arrive. Give them operator words, grouped, or
    keep the table names.
  - *The Review screen scrolls sideways at 390px* when a value is long (a 56-character email made
    it 530px wide in English, 537px in Spanish): its `auto 1fr` columns (on main since 512999e30)
    never narrow below the longest value.
  - *The Cloud restore screen shows capture and expiry times as the server's raw ISO text* in both
    languages, and the Review screen shows invoice languages as codes (`es-ES, en-GB`).
  - *The file pickers' "Choose File / No file chosen" follow the browser's language*, not the
    chooser; the browser draws them.
  - *The Spanish certificate export steps name Chrome, macOS and Firefox menus from memory*
    ("Gestionar certificados importados de Windows", "Acceso a Llaveros", "Sus certificados"…), and
    the FNMT links still open FNMT's English pages. Check them on real Spanish systems with the item
    below.
  - `OLD_BOX_PROBLEM` (`apps/setup/src/screens/old-box-question.ts`) is kept, English only, because
    `cloud-restore-screen.test.ts` imports it; the screens call `oldBoxProblem()`. Point the test at
    the function and delete the constant.
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
- *The setup app's catch-all redirect was not proven by deleting it.* Unknown setup addresses now go
  to `/` while real files and API routes keep their own responses. The reviews checked this by
  running the route tests and the full server suites, not by removing each exclusion one at a time
  and watching a test fail, and no separate probe confirmed the trading app is untouched by the
  redirect. That is weaker evidence than this repository normally accepts for a guard.

**Found while bringing `apps/setup` to the coverage bar (2026-09-23), left unfixed** — each was
seen in a throwaway test, since deleted, and none has a test pinning it:

- *A draft carrying a country with no venue-setup pack* (a configuration import can bring one) shows
  Spain in the country select while the screen holds the other value, so "Check the country." sits
  beside what looks like a valid choice.
- *A fiscal test or a provision that answers after the wizard has been removed from the page leaves
  it stuck when it is put back*: the Run button stays on "Running test…", or the screen stays on
  "Provisioning…", with no retry. The connection check releases itself in the same case. The app
  mounts the wizard once and never removes it, so this may be unreachable in use.

**Demo gaps on the setup wizard's venue screen, as they stand after C47s (#840, 2026-09-29), left
unfixed** — the first two date from 2026-09-23 and were rewritten for the new behaviour; each
says whether it was seen in a run or only read in the code:

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
  Seen in a throwaway test on 2026-09-29, since deleted; nothing pins it.
- *In Demo, a local check that fails only on a field Demo hides* — for example a draft whose series
  code equals its refund-invoice series code — shows its message above Next once Next has been
  pressed, while Next stays enabled (it is disabled only by errors on fields the screen shows).
  In that example both hidden fields carry the same message, and the message above Next is built
  from every hidden field's error (the `bottom` list in `render`,
  `apps/setup/src/screens/venue-screen.ts`), so "Use different codes for ordinary and correction
  invoices." would appear twice. Every press only runs the focus-the-first-invalid-field step and
  returns, so the draft is never sent. All of this was read in the code, not run; whether a real
  draft can reach that state has not been tested.

**Restoring a backup and importing a configuration failed in a real browser — FIXED #584.** `restore`
and `stageConfiguration` in `apps/setup/src/api/client.ts` now copy `fetch` into a local first, as
`#request` does, so the browser no longer refuses them with `Illegal invocation`.

**The dashboard's configuration export has the same fault, masked — FIXED (C7, #842, 2026-09-29).**
`exportConfiguration` in `apps/dashboard/src/api/client.ts` copies `fetch` into a local first, as
the setup client does. It had worked only because `apps/dashboard/src/main.ts` hands the client
`createInstrumentedFetch`'s wrapper (`packages/diagnostics/src/instrument-fetch.ts`), which calls
`fetch` as a plain function. With `exportConfiguration` calling `this.#fetch(...)` again, the
browser refused the request with `Failed to execute 'fetch' on 'Window': Illegal invocation` (seen
by the first version of the new case in `apps/dashboard/src/api/client.test.ts`); the case as it
now stands, which asserts that a response body was read, failed under
`pnpm --filter @waitron/dashboard exec vitest run src/api/client.test.ts` with
`expected [] to not have a length of +0`.

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

**A country pack's `name` is gone — DONE (C72, #871, 2026-09-29).** C41 (#835) left `CountryPack.name`
read only by `packages/country-packs/src/registry.test.ts`, because the wizard names countries
through the browser in its own language. The field is deleted from the type and from both packs;
the registry test now looks packs up by `countryCode` and checks that no installed pack carries a
`name`; the three test packs (`packages/country/src/country.test.ts`,
`apps/server/src/setup-api.country-pack.test.ts`, `apps/setup/src/screens/venue-screen.test.ts`)
no longer set one.

**A refused dropdown now gets the red outline — DONE (lane A's A151, #944, 2026-09-30).** The shared
dropdown style (`selectStyles`, `packages/ui/src/base-styles.ts`) draws a `select` marked
`aria-invalid="true"` with the `--wt-color-danger` border, and the two restore screens
(`apps/setup/src/screens/restore-screen.ts`, `restore-bucket-screen.ts`) now use that style; the
venue screen already used it, so its country and province dropdowns gain the outline too (the
province one is the case tested). Two dashboard screens also use that style, mark their dropdowns
`aria-invalid` and have no invalid-dropdown rule of their own, so they gain the outline too: the
product editor (`apps/dashboard/src/widgets/product-editor.ts`, its routing, VAT and unit
dropdowns) and the venue operations screen
(`packages/venue-service/src/dashboard/venue-operations-screen.ts`). Looked at after the review
(#944's comment): the product editor's kitchen station and course dropdowns refused, and the venue
operations screen's "Identical dishes on a kitchen ticket" dropdown after a refused save, in light
and dark at 1280 and 390 wide — the outline shows and nothing else moved. The product editor's VAT
and unit dropdowns were not looked at, and no test of either screen asserts the outline. On both restore screens (backup restore and bucket
restore) the environment dropdown now spans the column and takes the shared padding and border,
where before it kept the browser's own size. Seen in both themes, English and Spanish, at 1280 and
390 wide. Cases: the invalid-select case in `packages/ui/src/base-styles.test.ts`, and the
danger-colour cases in the two restore screens' and the venue screen's tests.

**Still OPEN, seen while doing A151 (2026-09-30), not changed:** on the backup restore screen the
refused backup-file and recovery-key inputs, and on the bucket restore screen the refused recovery
kit text box, get no red outline — both screens' own styles have no rule for an invalid input or
text box (seen in screenshots of the refused state; only the dropdown was in A151's scope). Four
stylesheets that already include `selectStyles` still carry their own identical
`select[aria-invalid="true"]` rule — `reasons-screen.ts` (adjustments), `sumup-connect-form.ts`
(payments-sumup), `member-list-editor.ts` and `unit-form.ts` (dashboard) — and a fifth,
`apps/dashboard/src/screens/device-profiles-screen.ts` (dashboard), carries the same declaration
limited to `.home-menu select[aria-invalid="true"]`. They were left because none of their own test
files asserts a border colour, so removing them would go unchecked.

The original walkthrough is retained under *Detail → Setup wizard*.

### A3. Printers from the dashboard

**Printer paper width, resolution and character set — LANDED #367.** The printer editor stores
paper width, resolution and character set per printer, and all documents format to them.

**Setup refinements — LANDED #380.** Add opens a prefilled naming dialog and printed instructions
follow the user's language; development servers no longer advertise `waitron.local`.

**Printer calibration follow-up — LANDED #388.** Encoding and the `ESC t` table number are
independent printer settings, and the editor prints a clearly simulated sample receipt with unsaved
settings.

**Calibration wizard, drawer auditing and receipt layout — LANDED #689:** a calibration wizard
replaces the combined calibration editor, starts with tables 0–15, offers further ranges and
remembers printed ranges; drawer attachment belongs to the printer and has a separate audited test;
receipt QRs use the largest whole-dot size up to 40mm that fits the paper with its blank border, and
the receipt body, QR and VERI*FACTU legend are centred; the Printers screen gained a remembered
status filter, one-click disable, links to each print agent's setup page and the agent that last saw
each printer, and the print-agent list its own remembered Active/Revoked/All filter (#704). On the
owner's NT-806 the finder matched at W-11 and 8-14, and PC858/table 14 printed Spanish text and euro
amounts correctly. Why these table numbers differ from the supplied manual remains unknown; do not
use them as defaults for other printers.

**Calibration and status follow-up — LANDED #699:** four calibration steps separate the
cash-drawer question from the receipt test, finder codes use `nn-W`/`nn-8`, and clicking a printer
opens its status and connection details. Bluetooth scans show progress and report failures, but real
Bluetooth discovery and delivery remain hardware-unverified; the per-device Bluetooth delivery
connection was built later by A140 (below).

- **The setup-page link is unproven on the box.** The print agent now builds it from
  `WAITRON_SETUP_URL` (set on the box as `WAITRON_PRINT_AGENT_SETUP_URL`, which `deploy/compose.yml`
  passes through), or from the first of `WAITRON_BOX_ADDRESSES` (`apps/print-agent/src/config.ts`); unit tests cover the parsing, but no review seat ran the deployed
  compose and nobody has yet followed the link from a dashboard on the real box.
- **A calibration drawer opening records who asked and when, not that the drawer opened.** There is
  no drawer sensor; the audit row is the request.

- **Every printer saved before this change must be recalibrated** through the printer editor's test
  flow. Rows still carrying the old `pc858` setting were deliberately not converted: this repository
  forbids data-migration code until Waitron is in production, so a stale row prints the wrong accented
  characters until someone runs the test page against that printer and saves the answers.
- **Adding a language to the venue also means adding its printer calibration entry.** The character
  set list is derived from the database enum, and the calibration samples, finder candidates and
  setting labels are exhaustive over the locale list, so a new locale fails to compile until its entry
  exists. English and Spanish deliberately share one profile today; a language needing Cyrillic (the
  worked example was Ukrainian) has to add and test its own encoding path rather than inherit one.
- **On-paper verification is still owed on the TM-T88III** (spec "Verification on paper" steps 1-6):
  whether the printer's built-in QR command prints anything at all, and whether the mandated 30-40mm
  QR size is meant to count the code's blank border or only its dark squares.
- **Repeat the 58mm physical receipt after the print-area fix.** The owner's wider printer clipped
  the right edge of a 58mm receipt whose payload centred without an explicit print area; whether the
  printer's own width setting also contributed was not tested. The formatter now sets a zero left
  margin and a 360-dot print area before centring. Byte-level tests pin those commands; the preview
  test establishes only that its parser continues past them, not that the selected width fits the
  paper. The corrected paper output has not yet been printed.
- **Follow-up (ruling C): the preview no longer shows the QR link as text** for a raster receipt —
  only the earlier, now-unused native-QR path did that. A possible fix is to carry the link alongside
  the print job so the preview can still show it as text.
- **Deferred (ruling H): the receipt logs no warning when no legal QR dot size exists.** No logger is
  reachable from `receipt-print.ts`, and in practice the fallback is unreachable today for any link
  `validate.ts` accepts (`apps/server/src/qr-link-range.test.ts`).
- **Building the QR raster now runs inside the sale-recording transaction** (via `formatReceipt` in
  `enqueueSaleReceipt`), where the old native-QR path only concatenated bytes. The JavaScript QR encoder
  can throw on an oversized link, which would roll the sale back — but every link `validate.ts` accepts
  is within QR capacity (`qr-link-range.test.ts` proves it), so this is unreachable for a real sale. The
  Codex run-it review at #367 flagged it. If we ever want belt-and-braces against §5, wrap the raster in
  a `try/catch` that falls back to the printer's built-in QR command — at the cost of a QR whose size we
  no longer control. Left as an owner decision, not applied.
- **The Edit-printer dialog follows the dashboard's own language, not the venue's** (ruling I) — a
  recorded departure from the spec, which asked for the venue language.

**Office printers greyed out in the scan — LANDED #359.** A network printer whose read-only IPP
query on port 631 reports A4 or US letter is greyed out in the Add dialog with no Add button; no
answer, a late answer or an unreadable reply leaves it addable as before.

- **Proven on one office printer only.** The owner's HP Color LaserJet MFP M181fw's real reply is a
  test fixture, and the live query marked it from a Mac on the owner's network; the Epson (port 631
  closed) stayed unmarked. It has not run from the box's container, and no receipt printer that
  answers IPP has been captured, so "A4 or letter means office printer" is a heuristic with one
  data point.
- **A printer reported by its `.local` name may stay addable.** From a Mac, resolving the HP's
  `.local` name took 5 seconds, past the 1.5-second limit, so it was left unmarked. Not tried from
  the box's container, where the lookup may fail outright; either way the printer stays addable.
- **A typed address now receives one HTTP request on port 631** after its connection check succeeds.
  The 2026-09-12 address-check design allowed any unicast address (public, loopback, link-local)
  because the check sent nothing; that reasoning no longer covers the follow-up query.
- **One failed query can flip a marked printer back to addable** until the next query 30 seconds
  later, because the server keeps only each agent's latest report — unless another agent reporting
  the same address has marked it. Accepted as the fail-open cost.

**Check a known address — LANDED #335.** The Add-printer dialog takes an IP and port and asks the
approved print agents to try it, so a printer the two discovery passes cannot see can still be added.

- **Nobody has yet typed a real printer's address into it.** Everything proven so far is loopback
  sockets and browser tests. The owner's home is the case that motivated it: the box sits on
  192.168.10.x and the HP LaserJet on 192.168.20.x, which the port-9100 sweep cannot reach. On
  2026-09-14 the Epson TM-T88III was found at 192.168.10.81, the box's own subnet. The first things
  to try on the box: add the Epson at `192.168.10.81:9100` (the sweep should also list it) and print
  to it; then type the HP's `192.168.20.56:9100`, which should come back as an office printer.
- **No promise about how long a check takes end to end.** The dialog polls and reports a fresh
  result, but nothing bounds the round trip from pressing the button to an answer; the agent only
  picks the request up on its next job pull.
- **Two review suggestions were deliberately not taken** and would be relitigated otherwise:
  renaming the new error code `printer.probe_busy` (kept under the domain-naming rule, per #335's
  commit message), and deduplicating targets in the agent host (the issuing server already
  normalises and deduplicates its bounded list of eight).
- **Nothing physical has been verified since #327:** discovery, paper output, whether a device knock
  reaches the box while the Add agent dialog is open, the five-line feed before the cut, Bluetooth
  discovery, and the receipt preview against printed paper. #324's slips, duplicates and drawer pulse
  have never produced paper either.
- **Print-agent setup lockdown — BUILT 2026-09-27.** A joined agent not known to be out of touch
  serves its `:9110` page and status only to a loopback socket peer; forwarding headers do not open
  it to the LAN. An out-of-touch agent exposes a five-minute, cancellable reset on the LAN, calls it
  off after a successful venue pull, and can join again without a process restart. A process restart
  cancels that countdown and starts fail-closed until the first venue probe. Join state records the
  pending verification number before the token, and learned venue nodes survive an agent restart.
  The old Bluetooth card and routes are gone. The owner-approved
  [design](superpowers/specs/2026-09-27-print-agent-setup-lockdown-design.md) and
  [implementation plan](superpowers/plans/2026-09-27-print-agent-setup-lockdown.md) split the
  work into three branches; the first is the lockdown above (#732).
- **The print agent's Bluetooth side (P2b, the plan's second branch) — BUILT (#877).** What the
  agent now does. The unit tests of `apps/print-agent` and
  `packages/print-agent` pass on this branch (run 2026-09-29, against a fake host, not a radio);
  the real-hardware evidence is the paragraph after this list:
  - It asks `bluetoothctl info` about up to eight of the devices a Bluetooth scan finds, all at the
    same time, and marks one as looking like a printer when it shows a printer icon, a device class
    of "imaging" with the printer bit set, or the Serial Port profile (the standard way a Bluetooth
    printer offers a plain data channel). Since A137 (below) the next scan asks about the devices
    this one did not reach, and a mark is kept while the device stays listed.
  - Each job pull (the agent's regular request to the server for print work) now reports the
    devices the box is paired with, separately from the devices that can take print jobs. A paired
    printer still takes no jobs (the Bluetooth case in `apps/server/src/print-agent-e2e.test.ts`,
    where a job for a printer the pull reports paired never reaches the fake radio); since A139, a
    pull that also says `bluetoothPrinting: false` ends, failed, the due jobs of each enabled
    Bluetooth printer it reports paired that no other agent has lately reported it can print to
    (A139, below).
  - It carries out Pair and Forget commands the server sends back on a job pull. Pair runs
    `bluetoothctl` interactively, so its own pairing agent is running (the part of `bluetoothctl`
    that BlueZ, the Linux Bluetooth service, asks for a PIN), and answers the printer's PIN
    request with the PIN the operator gave. Forget runs `bluetoothctl remove`. Commands run one at
    a time on a background worker, so a pull and its print jobs never wait for a Pair; each outcome
    goes back on the next pull. The agent remembers the ids of the last eight commands it took, so one
    of those sent again does not run again; an older id sent again would, and a setup reset
    forgets them all.
  - An error that contains the PIN is replaced whole, before it is logged or sent back, by
    "pairing failed; the detail was withheld because it contained the PIN".
  - P2b added no server route that sends a command, and the server of that time ignored the two
    new lists in a pull (a temporary server case sending them got a 200, recorded in #877's
    commit message). P2c, the next entry, sends commands and reads both lists.

  The real-box receipt this rests on (the owner, 2026-09-29, BlueZ 5.82): after a host reboot and
  a printer power cycle the bond alone reconnected, so Pair never runs `trust`; `remove` of a
  device already gone exits 1 with "Device <MAC> not available", which Forget counts as success;
  and bluetoothd's `autopair` plugin (a part of the Bluetooth service that answers a PIN request
  with 0000 by itself) answered first, BlueZ's retry went over Bluetooth Low Energy, which that
  printer refuses, and it never paired, while with the plugin off it paired. So
  `waitron.sh install` now switches the plugin off with a systemd drop-in (a small file that
  changes how the Bluetooth service is started) where it can (`deploy/README.md` says when it
  leaves Bluetooth alone), and, where it does, the operator types the PIN, 0000 for a 0000
  printer. That drop-in was tried on a GitHub runner, where systemd showed the flag in the
  service's start command but the Bluetooth service itself never ran; it has not run on the
  owner's box. Pair and Forget under the shipped AppArmor profile (the Linux rules limiting what
  the agent's container may do) were measured against a stand-in BlueZ on a CI runner (probe runs
  36585218089 and 36586467212), and image-smoke pairs and forgets the stand-in's PIN printer
  under the profile through `scripts/bluetoothctl-pair.mjs` and `bluetoothctl remove`, not
  through the agent's own code. None of this has run on the real box.
- **The dashboard's Bluetooth pairing (P2c, the plan's third branch) — BUILT (#884).** What a manager can now do from the Printers screen.
  All of it has run against fake print agents and fake server replies only, never a Bluetooth radio:
  - Add a printer lists the Bluetooth devices the agent's scan found beside network and USB
    printers, showing only those the agent marked as looking like a printer, and any device with a
    Pair or Forget status on screen, until **Show all devices** is pressed; opening Add a printer
    again hides the others again. A note in the dialog said printing to a Bluetooth printer was not
    available yet, even once it was paired, until A140.
  - **Pair** opens a dialog asking for the printer's PIN, checked against the agent's own rule (1 to
    16 printable characters with no spaces; `isBluetoothPin` in
    `packages/print-agent/src/client.ts`) in the screen and again by the server, which refuses a bad
    one as `management.request_invalid` naming the `pin` field. Pairing adds no printer: once the
    agent reports the device paired, its row offers Add. A Pair whose device drops out of the list
    keeps a row in the dialog showing its status, and Dismiss once it has an outcome, until it is
    dismissed or the device comes back, marked "No longer found by the scan" while the scan does
    not report the device. _2026-09-30 (C103): no Dismiss; a success fades after about four
    seconds, a failure stays until the next Pair or Unpair on that device, or until Add a printer
    closes._
  - **Forget pairing** sits in the row menu of a switched-off Bluetooth printer whose agent reports
    it paired now, and asks for a second, confirming click. _2026-09-30 (A141): switched on or
    off._ _2026-09-30 (C103): named Unpair, and it acts on one press._ Switching a printer off does not forget its pairing (read, not run: the screen's Disable
    calls only `deactivatePrinter`, in `apps/dashboard/src/screens/printers-screen.ts`).
    _2026-09-30 (C109): an Unpair that succeeds also switches the printer off, unless another box
    reported within 15 seconds that it can print to it, and only if the outcome reaches the server
    within 120 seconds of the command; a Bluetooth printer an agent reports paired offers Unpair in
    place of Disable._
  - Both need the existing `printer.manage` permission. The server takes a Pair only for a device
    the same agent's scan reported within the last 15 seconds, and a Forget only for a device the
    same agent reported paired within that time (`reportedFresh` and `DISCOVERED_TTL_MS` in
    `apps/server/src/print-api.ts`; _2026-09-30, C102: 45 seconds while a discovery window is
    open_); otherwise it answers `printer.bluetooth_not_discovered` or
    `printer.bluetooth_not_paired`. For a well-formed request naming an agent id no row names,
    both answer `agent.not_found` (404); a malformed id, address or PIN is refused before that. A
    Bluetooth printer created or edited with a lower-case address is stored with it in upper case
    (`storedLocalKey` in `apps/server/src/print-api.ts`).
  - The server keeps commands in memory only (`apps/server/src/printer-bluetooth-commands.ts`). It
    sends a waiting command again on every job pull until the agent's outcome arrives, then stops;
    it drops a waiting command 120 seconds after queueing it, and ignores an outcome that arrives
    after that; it keeps a finished result for 60 seconds. A waiting command's status carries
    `expiresInMs`, the time left before the server drops it. An agent may have eight devices with a
    waiting command; a ninth is refused with `printer.bluetooth_command_busy`. The store keeps the
    PIN only in the waiting command, and its tests check that no status it hands out, waiting or
    finished, contains it. A failure reason from the agent that contains the waiting command's PIN
    is replaced by a fixed message (`withholdPin`, the agent's own rule, in
    `packages/print-agent/src/client.ts`) before it is cut to 500 characters.
  - The screen shows "Pairing…" or "Forgetting the pairing…", then "Paired", "Pairing forgotten",
    the agent's own reason for a failure, or, once the `expiresInMs` the server sent with the
    accepted command has passed, "No answer from the print agent — try again". It asks the server
    in the background and stops at the outcome, at that cut-off, or when the screen closes.
    _2026-09-30 (C103): "Unpairing…" and "Unpaired"._

  What was run, on 2026-09-29: the focused suites Task 12 of the plan
  (`docs/superpowers/plans/2026-09-27-print-agent-setup-lockdown.md`) lists — the four server files
  (`printer-bluetooth-commands`, `print-api`, `print-api.printer-wiring`, `errors`: 166 tests),
  `printers-screen` and its accessibility suite (289), and `scripts/alert-codes.test.ts` with
  `scripts/errors-reachable.test.ts` (32) — all passing. Those counts predate the review fixes
  this entry also describes (`expiresInMs`, `storedLocalKey`, `agent.not_found`, `withholdPin`, the
  row a lost device's Pair keeps). After those fixes, on 2026-09-29,
  `pnpm exec vitest run src/printer-bluetooth-commands.test.ts src/print-api.test.ts src/print-api.printer-wiring.test.ts src/errors.test.ts`
  in `apps/server` passed 180 tests,
  `pnpm exec vitest run src/screens/printers-screen.test.ts src/screens/printers-screen.a11y.test.ts`
  in `apps/dashboard` passed 303, and
  `pnpm vitest run scripts/alert-codes.test.ts scripts/errors-reachable.test.ts` at the root passed
  32. After the first run, every state above was photographed through the dashboard's browser test
  harness with those fakes, in English and Spanish, light and dark, 1280 and 390 pixels wide; that
  found an agent's long failure reason widening the whole device list at phone width and pushing
  Dismiss out of view, fixed test-first (the "wraps a long failure reason" case in
  `apps/dashboard/src/screens/printers-screen.test.ts`). The row a Pair
  keeps once its device leaves the list was added after that pass and was not photographed with
  it; it is checked by a layout test at 390 pixels wide in `printers-screen.test.ts` and by the axe
  accessibility check in both themes. The real Printers screen, opened on the demo stack, drew with
  no console errors, but that stack has no Bluetooth hardware, so no command was sent through it.
  **Nobody has yet paired or forgotten a real printer through the dashboard.**
  _2026-09-30: A138 changed this — the button is Pair and add, a succeeded pairing opens the form
  to add the printer and shows Add at once, the screen keeps reading after a success until the
  device is reported paired, that pairing's deadline passes, or Add a printer closes, and a paired
  device with no printer row also offers Forget pairing;
  see the A138 entry below._ _2026-09-30 (C103): named Unpair._
- **Follow-ups from P2c** (read, not run, unless a line says otherwise):
  - A command queued behind a slow pair can run out of time. The 120 seconds count from queueing
    (`enqueue` in `apps/server/src/printer-bluetooth-commands.ts`), the agent runs commands one at a
    time (the background worker in `packages/print-agent/src/agent.ts`), and one pair can take the
    agent up to about 90 seconds (`REGISTER_TIMEOUT_MS`, `PAIR_TIMEOUT_MS` and `EXIT_GRACE_MS`,
    10, 75 and 5 seconds, in `apps/print-agent/src/bluetooth-command.ts`). A second command
    waiting behind that pair can therefore expire on the server before it runs; its outcome is
    then ignored and the screen says "No answer from the print agent — try again" whatever
    actually happened.
  - A Printers screen element taken out of the page and put back does not restart its background
    status checks: `disconnectedCallback` stops them and `connectedCallback` only reloads the lists
    (`apps/dashboard/src/screens/printers-screen.ts`). Today nothing puts the same element back: in
    a throwaway browser test, going Printers → Printing rules → Printers gave a new element and left
    the first one detached, and a language switch rebuilds the screen through
    `keyed(currentLocale(), …)` in `apps/dashboard/src/dashboard-app.ts` (read, not run). It matters
    only if the app starts keeping screen elements.
  - A failed Pair or Forget shows the agent's reason as the agent wrote it, in English on both
    languages' screens (read, not run: a wrong PIN would read "No se pudo emparejar: wrong PIN").
    Most of what the agent reports for a pair is a fixed phrase
    (`apps/print-agent/src/bluetooth-command.ts`), among them "wrong PIN" (BlueZ's
    `org.bluez.Error.AuthenticationFailed` after the PIN was sent), "the printer stopped waiting for
    the PIN", "printer is off or out of range", "printer not found — scan first", "this printer
    needs a PIN", "pairing timed out", "bluetooth unavailable", and "pairing failed: <D-Bus error
    name>" for an error name it does not recognise. A follow-up could translate the known phrases into
    dashboard wording in both languages and keep the raw text as a detail. The photographed failure
    used a made-up reason ("Failed to pair: org.bluez.Error.AuthenticationFailed"), not one the
    agent sends; nothing here says what a given BlueZ error always means on a real printer.
  - Seen while photographing, and older than P2c: the printers table's empty message is the English
    "No matches" on a Spanish dashboard, because the screen sets no `noMatchesMessage` and
    `wt-data-table` falls back to English (checked on `main`); and at phone width a Bluetooth
    address breaks mid-group ("00:11:22:33:44:5" then "5"), from the device-details width limit
    added on 2026-09-11.
- **Open, needs the box:** a first real pairing, and a Forget, through the dashboard and the agent,
  under the shipped profile with `autopair` off; whether a real Bluetooth service sends
  `Agent1.Release` (its "your pairing agent is no longer needed" message), which the profile does
  not allow and the stand-in never sends; and printing over RFCOMM (Bluetooth's serial-cable
  channel) from INSIDE the print-agent container — the owner printed from the host only. The last
  is now A140's box check (below).
- **The owner's Bluetooth printer was listed only under Show all devices (A137, owner 2026-09-29)
  — FIXED where the tests reach (#894); the cause on the box is not confirmed.** The agent's scan asked
  `bluetoothctl info` about the first eight devices listed and no others, and each scan's answer
  replaced the last, so a printer listed ninth or later was never marked, and one whose `info` failed
  once lost its mark until the next scan. Now each scan asks first about the devices it has never
  asked about, named ones before unnamed ones, then about the ones asked longest ago; a device once
  marked stays marked while it stays listed; and a failed `info` is logged as
  `bluetooth info failed` with the device's address, the command's error message (which holds what
  bluetoothctl printed to standard error), what it printed to standard output (`printed`, when that
  was not blank), its exit code (`exitCode`, when it exited with
  one) and `killed` when the agent killed the run. The same failure for the same device is logged
  once, until an `info` about it succeeds or it drops out of the listing. The shipped AppArmor
  profile was ruled out on the CI stand-in only: probe run 36629179144 asked `info` of its four
  printers at once under the profile and each printed its class and icon, and image-smoke now asks
  it of one. How many devices the owner's box lists, and where the printer falls among them, was not
  recorded, so which of these hid it there is not known. Box check still owed, and it needs the
  fixed image on the box first: run
  `docker compose exec print-agent bluetoothctl --timeout 6 scan on`, then
  `docker compose exec print-agent bluetoothctl devices`, and record how many devices are listed
  and where the printer falls among them; then open Add a printer repeatedly, record on which scan
  the printer is first marked, and look for `bluetooth info failed` lines in
  `docker compose logs print-agent`.
- **Pairing a Bluetooth printer and adding it are one step (A138, owner 2026-09-29) — DONE (#899).** In
  Add a printer, an unpaired Bluetooth device offers Pair and add (2026-09-30: except one whose
  printer is added and switched on and that no agent reports paired, which offers Pair, A141): it
  asks for the PIN, pairs, and when the agent reports the pairing succeeded it opens the same form Add opens, prefilled, with no
  second press on the row. A failed or unanswered pairing opens no form, and its reason stays in the
  row. If another add form or PIN dialog is open when a pairing succeeds, the row offers Add instead.
  Cancelling the form leaves the device paired: its row offers Add, and Forget pairing beside it
  once the agent reports it paired — only for a device with no printer row; an added printer's own
  Forget pairing is in its row menu (A141). While pairing, the row shows a spinner and says it can
  take up to two minutes, the server's command lifetime (`COMMAND_TTL_MS`,
  `apps/server/src/printer-bluetooth-commands.ts`) after which the dashboard reports no answer.
  _2026-09-30 (C103): Forget pairing is named Unpair, and the spinner's message is only "Pairing…"._
  **The waits in the flow, read from the code and not timed:** the agent asks the server for work
  every 2 s when idle (`POLL_INTERVAL_MS`, `packages/print-agent/src/agent.ts`); while Add a
  printer's discovery window is open (`DISCOVERY_WINDOW_MS`, 3 minutes, `apps/server/src/print-api.ts`)
  each ask first runs the whole discovery scan — USB, the network (`liveNetworkScan`,
  `apps/print-agent/src/linux-devices.ts`), then a 6-second Bluetooth scan plus `info` calls about
  up to eight devices (`apps/print-agent/src/bluetooth.ts`), plus any owner-started address checks
  and the office-printer check — so a Pair can take at least that long to reach the agent; the
  pairing itself allows 10 s to start bluetoothctl's agent, 75 s to pair and 5 s to exit
  (`apps/print-agent/src/bluetooth-command.ts`); a finished pairing wakes the agent's loop at once,
  but one that finishes during a scan goes out when that scan ends, with a paired listing started
  before the pairing finished, so the server can learn the device is paired one ask after it learns
  the pairing succeeded — which is why the dashboard counts a succeeded pairing as paired and keeps
  reading after a success until the device is reported paired, that pairing's deadline passes, or
  Add a printer closes; the dashboard reads every 2 s (`SCAN_POLL_MS`,
  `apps/dashboard/src/screens/printers-screen.ts`). No wait was
  shortened. **Open:** whether scanning while pairing slows a real pairing is not measured; the agent
  keeps scanning through a pairing because skipping the scan would drop every unpaired device from
  the list after the server's 15 s `DISCOVERED_TTL_MS`. Box check owed: time a pairing through the
  dashboard. _(2026-09-30, C102: the window is renewed while Add a printer is open, and while it is
  open the list keeps a device for 45 s; next entry.)_ _(2026-09-30, C117: an ask no longer waits
  for the scan, so a Pair reaches the agent on its next ask — every 2 s when idle. An ask still
  waits first for the paired listing, the USB read (`host.visibleDevices()`, which has no overall
  limit), any typed-address checks and the office-printer check, and a Pair in a reply is taken
  only after that reply's jobs have been printed (`acceptBluetoothCommands` runs after the job
  loop). A finished pairing wakes the loop and goes out on the next ask to reach the server, rather
  than when a scan ends. Read, not timed.)_
- **Scan for printers keeps going while Add a printer is open (C102, owner 2026-09-30) — DONE
  (2026-09-30, #953).** The owner: _"there is a button with a spinner that says 'Scanning', and underneath
  it on the left it says 'Scanning' too. we can remove the second one. The scanning spinner stops
  after a while, and no printers are found. Later the printers appear. I think keep it spinning for
  longer, eg 30 seconds. Also, after a while, the BT printer disappears, and so did a network
  printer. Maybe we need to keep scanning all the time?"_ In Add a printer
  (`apps/dashboard/src/screens/printers-screen.ts`):
  - The Scan for printers button is the one sign of a scan. While it spins, the empty list of found
    printers shows no text; "No printers found yet…" appears when it stops.
  - It spins for 30 seconds (`SCAN_LISTEN_MS`) counted from when the first read of the found list
    returns, stopping at the first re-read (every 2 seconds, `SCAN_POLL_MS`) after that; nothing an
    agent reports ends it sooner, because nothing tells the dashboard that an agent has finished a
    scan. A printer reported later still appears, because the list keeps refreshing while the dialog
    is open. Add a print agent's scan keeps its 10 seconds.
  - Once a Scan has opened the discovery window, the dashboard renews it every minute while the
    dialog stays open (`POST /management-api/printer-discovery/renew`,
    `apps/server/src/print-api.ts`), so agents keep scanning. It stops when the dialog closes or the
    screen goes away, and the window's own three minutes then end the scanning — after a closed tab
    too. A renewal is not activity on the dashboard session: the route checks the session without
    moving its idle clock (`withPassiveManagementRead`), and the dashboard sends it through its
    background client, which reports no activity. The server refuses a renewal once the session has been idle for 30 minutes
    (`IDLE_TIMEOUT_MS`, `packages/identity/src/management-session.ts`), so a dialog left open stops
    keeping the window open then. Once renewals stop, the window ends within three minutes and the
    agent starts no further pass, judged by its own clock (see the open entry on that); a pass
    already running finishes. That is on purpose: each pass runs a Bluetooth inquiry and a sweep of
    the local network.
  - While a discovery window is open, the list keeps a device for 45 seconds after its last report,
    not 15, and Pair and Forget are accepted on the same terms, because an agent that is scanning
    reports once per scan pass rather than every 2 seconds. With no window open it stays 15 seconds.
    Measured on a Mac on 2026-09-30: the agent's port sweep (`sweepPort` with `connectTcp`,
    `apps/print-agent/src/sweep.ts`) took 2.0 s over 253 addresses that never answer and 8.0 s over
    1021. Read, not timed: the rest of a pass — a 6-second Bluetooth inquiry, `info` calls each
    killed after 15 seconds, the office-printer check (each query up to 1.5 s, eight at a time), up to 3 s for the paired
    listing — plus the 2-second wait between pulls, so a pass whose `info` call is killed is longer
    than 15 seconds. Added up in the order a pass runs them (`tick`,
    `packages/print-agent/src/agent.ts`; `scan`, `apps/print-agent/src/linux-devices.ts`), read and
    not timed, a pass whose 6-second Bluetooth inquiry and `devices` listing answer promptly comes to
    about 36 seconds between two reports, inside 45: up to 3 s for the paired listing, 8.0 s for the
    sweep of 1021 addresses (the 1.5-second mDNS listen runs beside it), 6 s for the inquiry, up to
    15 s for the `info` calls (asked all at once), 1.5 s for the office-printer check of up to eight
    network devices, and the 2-second wait. 45 seconds does not cover every pass, and a device not
    reported within 45 seconds drops off the list until its next report. _(2026-09-30, C117: the
    pass now runs beside the agent's poll, which keeps its 2-second rhythm; the pass's devices still
    arrive once per pass, on the poll after it ends, which a pass that found devices wakes at once —
    so the 2-second wait in the sum above is replaced by whatever is left of a poll already running
    when the pass ends. The paired listing and the USB read still come before the send, and the
    office-printer check still runs on the sending poll, which classifies the pass's devices before
    the pull. Read, not timed.)_
  - Why the printers disappeared (read, not reproduced: there is no bluetoothctl on macOS, and the
    box was not used): the window closed three minutes after the last Scan, and 15 seconds later the
    list dropped every device known only from a scan — network printers and unpaired Bluetooth
    ones. A paired Bluetooth printer is reported on every pull and stays; whether the owner's printer
    was paired at the time is not known.
  - Left open: print jobs now wait behind scan passes while the dialog is open and for about three
    minutes after (B6, "While Add a printer is open, print jobs wait behind each scan pass").
    _(2026-09-30: done in C117, #955 — the scan now runs beside the job pull.)_
- **Bluetooth printer rows: details at the top, buttons side by side, Unpair on one press, messages
  that fade, and "Pairing…" beside the buttons (C103, owner 2026-09-30) — DONE (2026-09-30, #957).** The
  owner: _"The printer name and details should be vertically aligned to the top. the action buttons
  can be side by side. Forget pairing -> Unpair. We don't need a confirm button when unpairing, it
  is easy to re-pair. We don't need the dismiss button - show the notification for a few seconds
  then let it fade away."_ and _"the line 'Pairing, this could take up to 2 minutes. The form to add
  the printer...' Can just be replaced with 'Pairing...', and this could be to the right of the
  buttons, not underneath"_.
  - Every `wt-data-table` cell now lines up by its first line of text (`vertical-align: baseline`),
    not the cell's middle, so a many-line cell starts level with the buttons beside it. The product
    list's and categories' name cells and the print queue's status dot were changed to sit on that
    line.
  - "Forget pairing" is Unpair (ES "Desvincular"), in the Add a printer list and the printer's row
    menu, with no confirming second press. A print agent's Disable and Enable, and a join request's
    Deny, keep theirs.
  - A new shared `wt-notice` (`packages/ui`) shows a message and fades it after four seconds (at once,
    with no fade, under reduced motion). A command's success message on the Printers screen uses it,
    with no Dismiss. A failure stays until the next Pair or Unpair on that device; closing Add a
    printer also clears it, unless the device's printer row in the table shows it.
  - While pairing the row says only "Pairing…" ("Emparejando…", matching the Emparejar button), to
    the right of the buttons; at phone width it wraps below them.

- **Unpairing a Bluetooth printer switches it off, and adding it again runs calibration (C109, owner
  2026-09-30) — DONE (#960, main `d98010314`, 2026-10-01).** The owner: _"If i unpair it, it tells me it is unpaired, then
  shows the printer as Active again, but it won't print. An unpaired printer should be disabled.
  After unpairing i went to add printer, repaired it, then it doesn't show me calibration (because
  the printer is still active)."_ Unpair only asked the box's agent to unpair the address; the
  printer's registration stayed switched on.
  - When an agent reports that an Unpair it ran succeeded, the server switches off the registered
    Bluetooth printer at that address, in the same transaction as that pull's job claim and before
    it, so the pull hands out none of its jobs (`apps/server/src/print-api.ts`, the agent job pull).
    It does so whichever screen sent the Unpair, and the printers table shows the change through its
    live query. A failed Unpair changes nothing. A printer that another box reported, within the
    last 15 seconds, that it can print to stays switched on, the same test the pull already applies
    before ending a Bluetooth printer's jobs. Printers belong to no agent, and one address has at
    most one registration per location (`printers_local_key_key`), so this is how "a printer on
    another agent is untouched" was read.
  - Jobs already queued for it wait, unclaimed, as for any switched-off printer (run: the new case
    in `apps/server/src/print-api.test.ts` finds the job still `queued` with no attempts after the
    pull). They print if the printer is switched on again (read, not run: `claimPrintJobs`,
    `packages/printing/src/runtime.ts`, claims only a switched-on printer's jobs and has no age
    limit on a queued one). _(2026-10-01: changed by A163 — the same pull now ends the jobs that
    were waiting for it, and A163 changed that case, which now finds the job ended, `failed` with
    `printer.unpaired`; see A163's entry below.)_
  - A Bluetooth printer an agent reports paired offers one row-menu action, Unpair, in place of
    Disable (owner's "ok" to the recommendation, 2026-09-30 ~19:00). One no agent reports paired
    keeps Disable, since there is nothing to unpair; network and USB printers keep Disable.
  - Add again (Add a printer, on a switched-off registration) still switches the printer on before
    it opens calibration, because a switched-off printer refuses test prints (`enqueuePrintJob`,
    `packages/printing/src/outbox.ts`) and calibration prints; calibration opens for the same
    record with its saved paper width, resolution, character table and drawer. Closing the wizard
    without saving now switches it off again. Leaving the Printers screen mid-wizard asks the server
    to switch it off (`disconnectedCallback`); if that request fails nothing reports it and the
    printer stays on. Closing the browser tab mid-wizard does not switch it off. Saving leaves it on. This
    holds for any printer's Add again, not only a Bluetooth one. While it is on during calibration,
    jobs already queued for it can be handed out, whether or not calibration is then saved.
    **Next action (owner, 2026-10-01: "(c)"):** lane A's A163 ends a printer's waiting jobs when
    its Unpair succeeds, so nothing stale can print during a later Add again. _(2026-10-01: done in
    A163 — a later Add again no longer prints the jobs a succeeded Unpair ended; jobs kept in the
    cases A163's entry lists, and a printer switched off with Disable, can still print after Add again.)_
  - A row shows Disable whenever Unpair would not appear, such as after a succeeded Unpair while
    the agent's paired report is still listed (`#printerActions`,
    `apps/dashboard/src/screens/printers-screen.ts`).
  - Left open: the edit dialog's Active switch can still switch a paired Bluetooth printer off
    without unpairing it.
  - Left open: leaving the Printers screen while a Save is in flight and that save then fails, or
    in the moment between Add again switching the printer on and the wizard opening, leaves the
    printer on.
  - Left open: an Unpair outcome that reaches the server after it has dropped the command (120
    seconds, `COMMAND_TTL_MS` in `apps/server/src/printer-bluetooth-commands.ts`) leaves the printer
    on; the owner can switch it off with Disable, which the row then shows. _(2026-10-01: A163
    — the printer's waiting jobs are kept in that case too, and Disable keeps them.)_
  - Left open: keeping the printer off until calibration is saved would need a calibration-only
    print path for a switched-off printer, since `enqueuePrintJob` refuses one and `claimPrintJobs`
    claims only switched-on printers' jobs.
- **A succeeded Unpair ends the printer's waiting print jobs (A163, owner 2026-10-01) — DONE
  (#962, 2026-10-01).** The owner chose to drop, at unpair time, the jobs C109 left waiting, so that a
  later Add again, which switches the printer on for calibration, does not print them.
  - When the agent job pull switches a Bluetooth printer off after a succeeded Unpair, it ends, in
    the same transaction and for the same addresses, the waiting jobs of the Bluetooth printers at
    those addresses (`endUnpairedPrinterJobs`, `packages/printing/src/runtime.ts`, called from
    `apps/server/src/print-api.ts`). Waiting means what a pull would claim (queued, failed with
    attempts left, or printing with a lapsed or missing claim), plus jobs this agent itself holds
    as printing. Each ends `failed` with no attempts left and the reason `printer.unpaired`, which
    the Printers screen words as "The printer was unpaired, so this job will not be retried."
    with "—" for attempts. Rows are kept, not deleted. A job this agent holds as printing may
    already have printed, if the agent sent it and its report was lost.
  - Left alone: another box's live claim, printed jobs, jobs already given up (they keep their
    reason), other printers' jobs, and every job when the Unpair failed or another box reported
    within 15 seconds that it can print to the printer. Also left alone, and still waiting: every
    job of a printer whose Unpair outcome reaches the server after it dropped the command (120
    seconds, `COMMAND_TTL_MS`), or after the server restarted (the command store is held in
    memory, `apps/server/src/printer-bluetooth-commands.ts`), and of a printer unpaired outside
    Waitron.
  - Drawer kicks end too: one left waiting would open the cash drawer during Add again, and
    `drawer_opens` holds no job id, so its audit row is unchanged (read, not run:
    `packages/db/src/schema/drawer-opens.ts`).
  - Jobs ended this way do not raise the printer's `printer.jobs_waiting` alert after Add again,
    but a kitchen ticket ended this way still shows as the table's printing problem, as a ticket
    given up after its attempts does.
  - Run: `packages/printing/src/runtime.unpaired.test.ts`; the unpair cases in
    `apps/server/src/print-api.test.ts`, one of which switches the printer back on the way Add
    again does and sends a calibration test page, and the next pull hands out only that page;
    `apps/server/src/print-api.unpair-kitchen.test.ts`; and the worded reason in
    `apps/dashboard/src/screens/printers-screen.test.ts`.
  - **Left open, not checked:** a document job that runs out of attempts for any OTHER reason
    keeps the printer's `printer.jobs_waiting` alert up after it is reprinted, because the reprint
    makes a new job and the given-up one keeps matching (`apps/server/src/alert-sources.ts`). Found
    while reading A163's review, not run; believed to predate A163, history not checked. Queued
    as A165 (owner, 2026-10-01: "queue it"), which reproduces it on `main` first. _(2026-10-01,
    A165: fixed for the Printers screen's Reprint only; the till's kitchen Reprint and a receipt
    reprint still leave the printer's alert up — see A165's entry.)_
- **A printed resend clears the printer's "stuck" alert for the job it copies (A165, owner
  2026-10-01: "queue it") — done (#972, 2026-10-01).** Reproduced on `main` first: a job that ran out of
  attempts, then a resend of it that printed, left the printer's `printer.jobs_waiting` alert up,
  dated from the failed job. Nothing linked a resend to the job it copies: the Printers screen's
  Reprint button (`resendPrintJob`, `packages/printing/src/outbox.ts`) enqueued the same bytes as a
  new job. Below, "resend" means that button, not the till's kitchen Reprint.
  - A new nullable `print_jobs.resend_of` column (core migration `0052_print_job_resend_of`, with
    an index) names the FIRST job of a resend chain, so a resend of a resend names the same job.
  - A job stops counting as in trouble once a resend in its chain queued AFTER it (by `rowid`) has
    printed (`printJobInTrouble`, `apps/server/src/print-job-trouble.ts`). Both readers of that
    test follow: the printer's alert and the table's printing problem. A job with no printed
    later copy still counts, so does a copy that ran out of attempts after an earlier copy printed.
  - Not changed: the till's kitchen Reprint and a receipt's reprint make new jobs through
    `enqueuePrintJob`, which names no `resend_of`, so they clear no failed job in
    `printJobInTrouble`; the table's printing problem keeps its own rule for the kitchen Reprint
    (`readPrintProblems`, `apps/server/src/kitchen-print.ts`). So a kitchen ticket or receipt that
    ran out of attempts and was then reprinted from the till still keeps the printer's
    `printer.jobs_waiting` alert up. Left open, not queued yet. Read, not run.
  - Chosen by this branch (not an owner decision): a resend that runs out of attempts after an
    earlier copy printed counts on the printer's alert but is not a table printing problem — a
    resend is a byte-for-byte copy, so the kitchen already has every dish on it, while the alert is
    about the printer's queue. Pinned by the "stays clear when a resend of the printed copy then
    runs out of attempts" case in `apps/server/src/print-problems.test.ts`.
  - Run: the resend cases in `apps/server/src/alert-sources.test.ts` and
    `apps/server/src/print-problems.test.ts`, and the chain case in
    `packages/printing/src/outbox.test.ts`; each part of the fix was deleted in turn and a case
    failed. The new foreign key is listed in `scripts/schema-constraints.test.ts`.
- **The owner cannot find how to unpair a Bluetooth printer (A141, owner 2026-09-29) — done (#902, 2026-09-30).** The
  owner: _"i also don't see how to unpair the printer"_. The cause: an added Bluetooth printer's row
  offered Forget pairing only while the printer was switched off (`#pairedReport`,
  `apps/dashboard/src/screens/printers-screen.ts`), and a printer you have just added is switched
  on. Now the row offers it whether the printer is switched on or off, as long as an agent reports
  the printer paired. It is in the printer's row on the Printers tab, behind the three-dot button
  (⋮) in the Actions column, below Edit and Disable; a second click confirms it.
  _2026-09-30 (C103): named Unpair, and it acts on one press._ _2026-09-30 (C109): for a printer an
  agent reports paired, Unpair stands in for Disable, except where C109's entry says the row shows
  Disable._ A printer
  forgotten while switched on stays switched on and registered. _2026-09-30 (C109): no longer — an
  Unpair that succeeds switches it off, unless another box reported within 15 seconds that it can
  print to it, and only if the outcome reaches the server within 120 seconds of the command; it
  stays registered, and Add a printer offers it as Add again. The rest of this paragraph — jobs
  staying waiting, the agent ending them failed with A139's reason, and the plain Pair — now holds
  only for a printer that is still switched on._ While no agent reports it paired,
  anything sent to it stays waiting and the jobs list gives no reason; this is the case A139's
  **Not covered** names. Once an agent reports it paired again, the box's agent ends those jobs
  failed with A139's reason, because Bluetooth printing is not built yet (read, not run: when an
  agent asks for work, the server passes `failUnprintableBluetoothJobs` only the addresses that
  agent reports paired, `apps/server/src/print-api.ts`). While no agent reports it paired,
  Add a printer lists it once an agent's scan finds it, without Show all devices even if the scan
  does not call it a printer, and offers a plain **Pair** (Spanish "Emparejar"; `#canPairOnly`): it pairs the printer again,
  opens no add form and changes nothing about the printer's registration. The row keeps Pair,
  disabled while the pairing is pending, so a pairing the agent never confirms can be retried; once
  an agent reports it paired, the row loses its Pair button and keeps only its Paired status until
  that is dismissed or Add a printer closes, and Forget pairing is back in the printer's row menu.
  _2026-09-30 (C103): no Dismiss; the Paired status fades after about four seconds._
  On a phone-width screen the Actions column starts off the right-hand edge, so the table has to be scrolled sideways to reach the three dots (observed 2026-09-30 in screenshots taken
  during the A141 work, not kept; the A141 finish-branch run-it review (Codex) reported the same at
  390 px). _(2026-09-30: A145, below, pins the Actions column so the menu stays on screen.)_ In
  Spanish the action is now "Desvincular" ("¿Desvincular?" to confirm,
  _2026-09-30 (C103): no longer asked_; `printers.bluetooth_forget` and its
  siblings in `apps/dashboard/src/i18n/strings.ts`). The suspect that was ruled out: the agent's
  paired listing does not drop paired devices. `pairedBluetooth()` in
  `apps/print-agent/src/linux-devices.ts` never asks for a device path, and the test "lists every
  paired device, without asking for a device path, which would throw" in
  `apps/print-agent/src/linux-devices.test.ts` passes; when `pairedBluetooth()` was made to ask for
  a device path, that test failed with `liveBtDevicePath`'s "resolution not implemented" error.
  That test and the A139 end-to-end case both use a stand-in for the Bluetooth adapter, so what the
  box's real adapter reports as paired is still unchecked. The server's forget route takes an agent and an address, never a printer, so it had no
  switched-on check to change (read, not run: `apps/server/src/print-api.ts`). _(2026-09-30, A140,
  below: `liveBtDevicePath` now returns the printer's address instead of throwing, and an agent
  built with A140 reports that it can print over Bluetooth, so once it reports the printer paired
  again it takes those jobs; only an agent built with A139 but not A140, which sends `false`, still
  ends them with A139's reason.
  The suspect's receipt above was taken while `liveBtDevicePath` threw.)_
- **A print job for a Bluetooth printer waited with no reason (A139, owner 2026-09-29: _"i tried
  to print the character set block, but nothing printed, the jobs just get stuck"_) — FIXED where
  the tests reach (#904); the printing itself is A140.** The cause,
  run on 2026-09-30 through the real agent loop, the print agent's own device layer with a fake
  radio, and the real server routes (the Bluetooth case in
  `apps/server/src/print-agent-e2e.test.ts`, red before the fix): the character-table print stayed
  `queued`, with no attempt and no error. It was never retried and never failed, because no agent
  was ever handed it: the server hands a USB or Bluetooth printer's job only to an agent that lists
  the printer among the devices it can print to (`claimPrintJobs`,
  `packages/printing/src/runtime.ts`), and the agent's device layer leaves every paired Bluetooth
  device out of the devices it can print to while `liveBtDevicePath` refuses to name a device path
  (the catch in `visibleDevices`, `apps/print-agent/src/linux-devices.ts`). Now each job pull also says whether
  the agent can print over Bluetooth (a new optional `bluetoothPrinting` field; the box's agent sent
  `false` until A140 (below), and an agent that predates the field sends nothing and
  changes nothing), and when it says it cannot, the server ends the waiting jobs of every Bluetooth
  printer that agent reports paired, unless the printer is disabled or another agent has lately
  reported it can print to it (below): failed, with no attempts left,
  so they are not retried, at most `PULL_BATCH_LIMIT` of them per pull
  (`failUnprintableBluetoothJobs`, `packages/printing/src/runtime.ts`),
  recording `printer.bluetooth_printing_unavailable`, which the dashboard showed as "Printing to a
  Bluetooth printer is not available yet." / "Aún no se puede imprimir en una impresora Bluetooth."
  until A140 reworded it
  A document job ended this way counts as in trouble, being failed with no attempts left
  (`printJobInTrouble`, `apps/server/src/print-job-trouble.ts`), so the printer's alert fires for
  it, and that alert says the printer's jobs are "stuck" (`printer.jobs_waiting`,
  `apps/dashboard/src/i18n/alert-messages.ts`).
  A paired report alone still changes no job, as P2c's "never claims its jobs" case in
  `apps/server/src/print-api.test.ts` holds. On the Printers screen the edit and calibration dialog
  shows the last print it sent that failed, as "Not printed: <reason>" / "No se ha impreso:
  <reason>" (an agent's own text for any other failure); that dialog and a Bluetooth printer's row in
  the printers list said Bluetooth printing is not available yet until A140; and the jobs list shows "—", not
  the stored attempt count, for such a job, whose Reprint makes a new job that ends the same way
  (read, not run). **Not covered:** a Bluetooth printer no agent reports paired still waits with no
  reason on the job, as a USB printer no agent sees does. With two agents, one that cannot print
  over Bluetooth leaves a paired printer's jobs alone while another agent has reported, within the
  last 15 seconds (`DISCOVERED_TTL_MS`, `apps/server/src/print-api.ts`), that it can print to that
  printer; that report is held only in the server's memory, so after a server restart, until the
  other agent's first pull, the first agent still ends the job (a throwaway route test on
  2026-09-30 mounted the print routes a second time over the same database, standing in for a
  restart, and the job ended; the same pull against the first mount left it waiting). The same
  protection also lapses for a pull made more than 15 seconds after the other agent's latest report
  that it can print to the printer (`DISCOVERED_TTL_MS`), as happens when that agent goes longer
  than that between pulls. _(2026-09-30, C102: an agent that is scanning pulls once per scan pass,
  and the discovery window now stays open while Add a printer is open and for up to three minutes
  after; this check kept its
  15 seconds. C117, the same day: the agent pulls every 2 seconds again while scanning, and reports
  each pass's devices once, on the pull after the pass ends.)_ A140 must
  have the agent send `true`, or stop sending the field, once it can print; must close that restart
  gap if it matters then; and must remove, or key on something other than
  the transport or the stored code, each place the dashboard says Bluetooth printing is not
  available yet: the note on a Bluetooth printer's row and the hint in its edit dialog (both
  `codeMessage(BLUETOOTH_PRINTING_UNAVAILABLE)`, shown for every Bluetooth printer,
  `apps/dashboard/src/screens/printers-screen.ts`), the sentence of
  `printers.bluetooth_pair_note` saying Bluetooth printing is not available yet even once paired (`apps/dashboard/src/i18n/strings.ts`), and the jobs list's "—" in
  place of the attempt count. _(2026-09-30: A140, below, answers this list.)_ The stored code also becomes that sentence as a job's reason, through
  `jobReason` in the jobs list and in the calibration dialog's "Not printed: <reason>"
  (`apps/dashboard/src/screens/printers-screen.ts`); A140 decides whether jobs ended before it keep
  that reason text. Not run on the box.
- **DONE (2026-09-30, A145, #935): on a phone, a printer's row menu on the Printers tab stays on
  screen.** The Printers tab's Actions column is pinned to the right-hand edge of the table's box
  with `wt-data-table`'s new opt-in `pinned: "end"` column option, so the three-dot button (⋮)
  holding Edit, Disable and Forget pairing (_2026-09-30 (C103): named Unpair_; _2026-09-30 (C109): a
  Bluetooth printer an agent reports paired shows Unpair in place of Disable, except where C109's
  entry says the row shows Disable_) is in view without
  scrolling; the other columns still
  scroll sideways under it. Measured 2026-09-30 in headless Chromium, with a long printer name and
  a long agent name: before the change the table was 1175 px (English) to 1402 px (Spanish in
  Verdana) wide in a 388 px box at 390 px (a review re-run the same day measured 1192 to 1443 px),
  and with every cell emptied its column headings alone
  still needed 579 to 821 px. The headings are inside the table's shadow root with no `part=`, and
  the table is at least as wide as its unwrapped content, so a screen's own styles cannot narrow
  them short of shrinking the text. Guards: the phone-width cases in
  `apps/dashboard/src/screens/printers-screen.test.ts` (390, 360 and 320 px, English and Spanish,
  normal and larger text, the default font and Verdana), which check that the table is wider than
  its box, that each row's ⋮ ends inside the box and the window with the table unscrolled, and that
  nothing is painted over it; the pinned cases in
  `packages/ui/src/components/wt-data-table.test.ts` and `wt-data-table.a11y.test.ts`.
- **DONE (2026-09-30, A155, #950): every `wt-data-table` whose row menu sits in its last column pins
  that column** (owner's answer "a" to A145's question). `pinned: "end"` stays a per-column option,
  now set on every row-menu column keyed `actions` (the adjustment reasons screen's menu, keyed
  `manage` and not its last column, was left unpinned — moved last and pinned by A162, below): the Printers screen's Agents
  tab, the categories screen
  and its products-in-category table, the units screen and its in-use products table, the menus,
  sections, servers, payments, alerts, modifiers (Extras and Options) and labels screens, the
  product and staff lists, venue operations' five tables and the `packages/ui` demo's table (`packages/ui/demo/main.ts`). In a table with `rowClick` (the units
  screen), a click on a pinned cell's empty space now opens the row; a click on anything inside the
  cell does not. Measured 2026-09-30 in headless Chromium with a long unbroken name, before the
  change: at 390 px the right edge of each table's first-row ⋮ (or, in the alerts and in-use
  products tables, its buttons) was between 474 and 1495 px from the window's left, in a box
  ending at 390 px or less (373 px in the two tables inside a dialog); the servers table (which wraps its addresses) did so only at 320 px with
  larger text, and the menus list (whose narrow layout starts at 480 px) only between 500 and 700
  px. At 1280 px pinning changes no column's width (849/262/169 px pinned and unpinned, same rows).
  Guards: a phone-width case per dashboard table in each screen's own suite (English and Spanish;
  most use `expectRowMenusOnScreen`, `packages/ui/src/test-helpers.ts`, and the alerts and in-use
  products tables, whose column holds a button, check it by hand; the demo has none), the pinned-click
  cases in `packages/ui/src/components/wt-data-table.test.ts`, and
  `scripts/pinned-actions-column.test.ts`, weaker than its name — it knows a row-menu column only by
  a literal `key: "actions"` and reads only non-test `.ts` files under `apps/` and `packages/`; its
  header lists the rest.
- **DONE (2026-09-30, A162, #954): the adjustment reasons table's row controls are its last column,
  keyed `actions` and pinned** (the owner chose to move it last and pin it, answering A155's question). Before, the column holding move
  up, move down and ⋮ was second, keyed `manage`, and at 390 px with a reason named "Queja del
  cliente por el tiempo de espera en la terraza" the ⋮'s right edge was 643 px (English) and 584 px
  (Spanish) from the window's left. The data column that lists what a reason allows is re-keyed
  `allows`, so `scripts/pinned-actions-column.test.ts` sees the controls column and its data-column
  excuse (`NOT_A_ROW_MENU`) is gone; a saved column choice under the old `actions` key no longer
  hides anything, because the controls column is not in the column chooser. The column chooser
  case in `packages/adjustments/src/dashboard/reasons-screen.test.ts` now expects `allows` and the
  new heading order (owner-approved). Guards: that suite's "at phone width" cases (the controls
  column is last and pinned; at 390 px, English and Spanish, with a name as long, every ⋮ and move
  button is inside the table's box and the window and uncovered), and the guard above.
- **Row menus in plain `<table>`s are unchecked at phone width.** `variant-table.ts` and
  `option-list-form.ts` (`apps/dashboard/src/widgets/`) put a `wt-row-actions` in a plain table,
  not `wt-data-table`, so `pinned` does not reach them; `member-list-editor.ts` and
  `product-editor.ts` also contain both a `<table>` and a row menu (found by grep, not read). None
  has a phone-width case and none was measured.
- **Printing to a paired Bluetooth printer over its serial channel (A140, owner 2026-09-29: the
  calibration print _"nothing printed"_) — BUILT where the tests and CI reach (#909, 2026-09-30); no real
  printer has printed through it yet.** The box's agent sends a Bluetooth job's bytes over RFCOMM
  (Bluetooth's serial-cable channel) to the printer's own address (`RfcommTransport`,
  `apps/print-agent/src/rfcomm.ts`), so two paired printers never share a path. Node has no
  Bluetooth sockets, so each job runs `apps/print-agent/src/rfcomm-send.py` under `python3-minimal`,
  which the print-agent image now installs, with the bytes on its input. It always uses channel 1,
  the channel the owner's printer printed on in the owner's own run from the box's host on
  2026-09-29, after a reboot that left the printer `Paired: yes`, `Bonded: yes`, `Trusted: no`
  (the campaign's lane-A `questions.md`, outside this repository, "Question 1 — reconnect after
  reboot"): _"a host-side Python RFCOMM write (`AF_BLUETOOTH`/`BTPROTO_RFCOMM`, channel **1**,
  `ESC @` + text) printed a slip, no PIN asked. Not measured: that write from INSIDE the
  print-agent container, or under the shipped profile."_ Nothing looks up a printer's channel, so a
  printer whose serial port is on another channel fails each job with the connection error. The
  helper gets 20 seconds to connect and 20 more to send (Python's socket timeout applies to each
  operation), and the agent kills it 5 seconds after both, 45 seconds in all
  (`2 * timeoutMs + graceMs`, `apps/print-agent/src/rfcomm.ts`); none of these times was measured
  on the box. The agent's
  device layer now names a paired printer's address where it named no path
  (`liveBtDevicePath`, `apps/print-agent/src/linux-devices.ts`) and reports
  `bluetoothPrinting: true`. An agent that predates this still reports `false`, and the server still
  ends its Bluetooth jobs as A139 describes (above), with the reason now worded "This printer's print
  agent cannot print to Bluetooth printers." / "El agente de impresión de esta impresora no puede
  imprimir en impresoras Bluetooth." — jobs ended before this change show the new wording too. The
  Printers screen no longer says Bluetooth printing is not available yet (the row note, the edit and
  calibration dialog's hint and the pairing note). The jobs list still shows "—" in place of the
  attempt count for a job ended with that code (`apps/dashboard/src/screens/printers-screen.ts`),
  because the code now means the job's agent is an older build that cannot print to Bluetooth, and
  no attempt was made. A139's restart gap is left as it is: it needs two
  agents, one of them older than this. The AppArmor profile needed no new rule, because the
  template's `network,` rule covers the socket: probe run 36656859928, on a runner whose kernel has
  no Bluetooth, got errno 97 (no Bluetooth in the kernel) under the shipped profile and errno 13 (the
  profile refusing) under the same profile plus `deny network bluetooth`; image-smoke now runs the
  sender under the shipped profile and fails on errno 13. **Not run, owed to the box:** a real
  RFCOMM connection and print from inside the container under the shipped profile — CI's runners
  cannot load Bluetooth at all (`modprobe bluetooth` found no module on 6.17.0-1022-azure) — and
  whether the printer gets every byte before the connection closes. **What CI does not show:**
  image-smoke runs the helper directly with its own arguments, not through `RfcommTransport`, and
  only as far as creating the socket, since the runner's kernel has no Bluetooth; and
  `scripts/deploy-image-env.test.ts` reads the Dockerfile and `package.json` as text, so it does not
  prove the bundle's default helper path resolves inside the image. On macOS, 2026-09-30, a probe
  bundled into `dist/` beside the built `rfcomm-send.py` sent `1b 40 41` on channel 1 through the
  real helper with a fake socket, and with `dist/rfcomm-send.py` moved away it failed
  `can't open file '…/dist/rfcomm-send.py': [Errno 2]`; that was the package's `dist/`, not the image.
  **Follow-ups the review raised, not done here (owner's call):**
  - `BluetoothTransport` (`packages/print-agent/src/transport.ts`, with its export and tests) is
    now unused in production and still models a device-file path.
  - `liveBtDevicePath`, the `btDevicePath` option and the try/catch in `visibleDevices`
    (`apps/print-agent/src/linux-devices.ts`) can go; the `/dev/rfcomm…` fixtures in
    `apps/print-agent/src/linux-devices.test.ts` model a shape production no longer has, and
    changing them changes existing tests.
  - A139's chain for an agent that cannot print to Bluetooth (`failUnprintableBluetoothJobs`, the
    `bluetoothPrinting` wire field, the error code) has no shipped agent reporting `false` now: keep
    it for an older agent, or delete it before go-live.
  - The 10-second paired-listing reuse in `resolve()` (`PAIRED_REUSE_MS`,
    `apps/print-agent/src/linux-devices.ts`) is a chosen window, not a measured one, and a printer
    unpaired outside the agent resolves as attached for up to 10 seconds.
- **The virtual PDF printer**, and a `print_jobs` retention sweep — nothing deletes a job today.
  Deleting a print job also deletes its `kitchen_print_jobs` link rows (the key is
  `ON DELETE CASCADE`). Deleting a failed job's links clears its printing problem, and deleting a
  printed reprint's links brings back the failures it cleared, so a sweep must remove a bill's
  kitchen print jobs all together or not at all. It must also keep or remove a resend chain
  together: deleting a printed resend brings back the "in trouble" state of the job it copied, and
  deleting a chain's first job while a resend still names it is refused by the `resend_of` key
  (read, not run).
- **Printing A4 invoices on an office printer** (owner, 2026-09-14): a separate design, not started.
  It reverses the 2026-09-09 provisioning design's "raw ESC/POS only" decision and needs an A4
  invoice layout, a way to send a PDF to the printer over IPP (the standard office printing protocol,
  port 631; the owner's HP accepts PDF directly) and rules for which documents go to which printer.
  It would share the PDF rendering with the virtual PDF printer above.
- Read-back gaps: the per-till printer picker is not location-filtered; the print-mode and
  `drawer_open_policy` toggles are set-only (the latter gates cash access); the Impresoras editor
  leaves agent and transport re-binding read-only though the API accepts it.

### A4. Till, displays and devices

- **Service, ordering and billing: planned and queued on lane B (2026-09-26).**
  [Design](superpowers/specs/2026-09-20-service-ordering-and-billing-design.md), Revision 2,
  approved by the owner and merged as #693 (§14 lists every change from Revision 1);
  [plan](superpowers/plans/2026-09-26-service-ordering-and-billing.md), Revision 2, eighteen tasks,
  reviewed three times before the merge. _(2026-09-28: table actions Task 1 renamed "visit" to
  "party" — the tables and columns by core migration `0036`, and the routes and error codes in
  code — and the entries below use the new names; the four `visits_*_ck` CHECK names and the
  stored scope value `'visit'` stay until Task 13; table actions Task 13 (2026-09-29) made them
  `parties_*_ck` and `'party'`, core migration `0044`.)_ What stays open:
  - **Task 0's [bill payments design](superpowers/specs/2026-09-26-bill-payments-design.md) is
    approved** (owner, 2026-09-26, PR #698), with the owner's answers to its open points (its §11):
    the cash-up counts money on the day it moves, in Task 14 (§9a), and a card refund is a durable
    attempt that survives an interrupted call (§6b). Task 14 has landed (#721, below).
  - **The card refund path records only after the provider call, with a fresh key each time**
    (found by the owner reviewing Task 0, 2026-09-26). `reverseViaStripe`
    (`packages/payments-stripe/src/reverse.ts`) sends a fresh `randomUUID()` idempotency key on
    every call and writes `payment_refunds` only after the call returns, so a crash between the two
    leaves no record, and a repeat would send a new key. SumUp's refund sends no key at all. No
    product route refunds a card AFTER its invoice; the only product caller of that path is the
    reconciler's reversal of an abandoned order's capture
    (`packages/payments-stripe/src/reconciler.ts`). Task 14 adds a route that refunds a card
    payment of a bill BEFORE its invoice, through a separate, durable path (design §6b). **Next action:** give the
    reconciler's reversal, and any post-invoice refund route when one is built, the same
    durable-attempt rule.
  - **Task 1 landed as #706** (2026-09-26): the new module `packages/adjustments`, holding
    adjustment reasons (table `adjustment_reasons`), the policy check `evaluateAdjustment` and a
    managers' dashboard screen (permission `adjustment.manage`).
    Task 11 applies the reasons to orders (see its entry below). `evaluateAdjustment` counts a
    cancel's reduction against the reason's euro limit, and it throws a `RangeError` on a malformed
    request (a negative amount, or a percentage discount without a percentage from 1 to 10000)
    rather than returning a verdict; Task 11's apply path checks the request before calling it. Left from the review:
    the reasons screen keeps its own copy of the role list and role names (C51 now sorts its
    dropdowns by displayed name, with a separate seniority order for validation) and of the
    placeholder-filling helper in `apps/dashboard/src/widgets/menu-preview.ts`; sharing them means moving both into
    `@waitron/dashboard-kit`. **Next action:** do that move if a third module screen needs them.
  - **Task 2 landed as #715** (2026-09-27): a record per seated party. Core tables `parties`,
    `party_tables` (one active membership per table) and `service_commands`, and
    `working_orders.party_id` (core migrations `0018`–`0020`, where they were named after visits;
    `0036` renamed them, table actions Task 1); the venue setting
    `clearing_workflow` (off by default, and no dashboard control sets it yet). Paying a bill no
    longer frees the table: the party keeps it, with every related bill listed on the till's table
    screen, until Finish table, which is refused `party.bill_outstanding` while any bill of the
    party, or of a party merged into it, is unpaid. `runServiceCommand` (retried commands answered
    once) and `service_commands` have no product caller yet; Tasks 3 onwards use them. Upgrade:
    before the rebase renumbered them, the implementer applied the new migrations to a seeded venue
    migrated on `main` and reported no row lost and no table rebuilt; the regenerated `0018` is
    byte-identical to what was measured. Left open: `service_commands` rows are never pruned; the
    four items directly below.
  - **Task 3 landed as #733** (lane B item B3, 2026-09-27, main `9ede66892`): order groups replace
    course firing for a seated party. Core migration `0028_order_groups` (tables `order_groups` and
    `order_group_events`, the second append-only; `working_order_lines.group_id` and
    `credited_to`); `apps/server/src/order-groups.ts` and the routes under
    `POST /api/parties/:id/groups` (submit, fire, reorder, move lines), each checking the party's
    revision (`party.out_of_date`) and refusing while a card payment is under way; the round route
    `POST /api/working-orders/:id/round` is deleted. Splits, transfers, merges, voids and line edits
    respect groups (`group.held_leaves_party`; a void or edit that empties a held group removes it
    and moves the party's revision). The till's table screen looks the same and maps Send round,
    Fire course and Send all onto groups _(Task 4, 2026-09-27: replaced by the draft's actions and
    the Tab drawer's held-groups list)_. Counter orders and bills with no party still fire by
    course, and the station and pass Fire route stays until Task 5 _(Task 5, 2026-09-27: the
    kitchen screen and the pass now fire a party's held groups by group; the course routes stay
    for counter orders and bills with no party)_. Upgrade: a venue built and
    seeded on `main` took the new migration with no row lost and no table rebuilt, with a control
    showing the checks detect a rebuild (the PR has both). Left open, from the PR's "Parked points"
    and review notes: a cross-party merge can leave a settled check's lines naming a group now on
    the target party; `moveTabLines` (test-only caller) ignores groups _(2026-09-30, Task 13: `moveTabLines` is
    deleted; whether this still holds for the paths that move lines now is not checked here)_; the till's Fire course and
    Send all fire one group per request, so a failure part-way leaves some fired (Task 4 rebuilds
    the screen) _(Task 4, 2026-09-27: done — the till's table screen has no Fire course and no
    Tab-drawer Send all now; the waiter fires one held group at a time, one request each, from the
    list of the party's groups in the Tab drawer, whose Fire button appears only when the venue's
    `fire_control` is `waiter`)_; the till, not the server, refuses a round aimed at a split-off
    check, because the route names the party, not the bill _(table-actions Task 2, 2026-09-28:
    the groups and draft-submit routes now take an optional `billId`, and a round naming a split
    check of the party goes onto it; the till sends none yet)_ _(2026-09-29, Task 10: the till no
    longer refuses such a round; it sends `billId` from the preview's Send to choice)_; a whole-order save replacing a held dish with another
    variant moves it to a new held group at the end; the counter's whole-order save does not answer
    the party's revision; a held no-route dish outside any group gets no Send all button (whether
    one can occur on a party's tab is not established) _(Task 4, 2026-09-27: the till has no
    Tab-drawer Send all now, and the table screen offers its per-line Send only on a dish with a
    kitchen ticket item (`sendsAlone`, `apps/till/src/state/held-groups.ts`), so it offers such a
    dish no Send either; whether one can occur is still not established)_.
  - **Task 4 landed as #748** (lane B item B4, 2026-09-27, main `a9a26cc98`): the till's table
    screen works with order groups. The draft is shown in sections by course; its bar offers Send
    all and Fire all now, or Send selected and Fire selected now when lines are ticked, each behind
    a preview dialog; a draft started after the party already has a group picks Fire now, Add to
    held group… or Add as new group; after a complete submission the till returns to the floor with
    a "Fired: N groups. Held: N groups." notice. The Tab drawer lists every group of the party:
    held ones can be reordered, have a dish moved or split one row per unit, have a dish changed
    or cancelled, and be fired after a confirmation. Fire course and the tab-level Send all are
    gone. Server change: the tab-lines read returns each line's `id`; no migration. Left open, from
    the PR: **Fire all now / Fire selected now are offered under every `fire_control` setting**
    (the plan's test text wanted them hidden under `kitchen`/`expo`; kept because sending straight
    to the kitchen was never gated and the kitchen can only fire a held group that has a course
    _(Task 5, 2026-09-27: no longer so — under `kitchen` the kitchen screen offers Fire on every
    held group of a party)_ — one-line gate in `#draftBar` if the owner wants it); whether a draft
    is a later addition is decided when its first line is rung, so a line rung before the groups
    are read makes a first order _(Task 8, 2026-09-28: the draft, and the menu that rings into it,
    now show only once this party's groups have been read, on opening a table and after a merge or
    move — `#tableDraft`, `apps/till/src/till-app.ts`)_; group summaries come from the server, so
    a weighed quantity shows a dot decimal in Spanish; the draft shows its lines both in the course
    sections and in the basket (the draft rebuild is Task 7/8) _(Task 7, 2026-09-27: the server now
    keeps each person's draft; the till does not use it yet, so this stays until Task 8)_ _(Task 8,
    2026-09-28: each line now shows once, inside its course section)_; the held-groups
    list shows each group's summary and then its lines _(Task 9, 2026-09-28: the list is now
    Current orders — every group of the party with each dish from every bill of the party, paid
    ones included and abandoned ones left out, an "Added later" mark on a group started as a later
    addition, and the serving controls; a group's summary shows only when Current orders cannot be
    read)_ _(A119, #845, 2026-09-29: the mark is gone; a fired group's header shows when it was fired and
    who fired it, a held group's when it was held and who held it, and the name is left out when
    there is no person record; owner 2026-09-28: "show when and who")_; group numbers are the
    server's positions,
    so the list can read "Group 1, Group 3"; the preview gives counts, not contents; the screen's
    older small buttons are 32 px tall, under the 44 px tap target (this branch's new ones are
    44 px); per-line Send, Change and Cancel have no guard against a second press while the first is
    running (the group commands do) _(2026-09-30, B11a: Cancel now opens the adjustment dialog,
    which ignores a second press while it is opening or open)_; whether the floating language button covers the new draft bar
    at 390 px has not been re-checked _(Task 8, 2026-09-28, looked at in screenshots at 390 px: it
    does not cover the new last-added bar; on the new Review view it covers the corner of Fire all
    now until the page is scrolled, which the page's bottom padding allows)_.
  - **Splitting a held line's quantity on the till takes one request per unit** (found on the
    Task 4 branch, 2026-09-27). Splitting a quantity of N sends N−1 move requests, each at the
    revision the one before it answered with (`#onSplitGroupLine`, `apps/till/src/till-app.ts`),
    because the move route refuses a request naming the same line twice (the distinct-lines check
    in `moveLinesToGroup`, `apps/server/src/order-groups.ts`). A refusal part-way leaves the units
    already split. **Next action:** a server command that splits a line into single units in one
    transaction, so the till sends one request and there is no part-way state.
  - **The Tab drawer's transfer picker marks a picked line with `aria-pressed` on a `wt-button`**
    (`#transferLineRow`, `apps/till/src/screens/till-table-order-screen.ts`, since 2026-08-30).
    `wt-button` does not pass `aria-pressed` to its inner button
    (`packages/ui-core/src/components/wt-button.ts`), so a screen reader does not hear whether a
    line is picked. The draft's line toggle was changed to a plain button on the Task 4 branch; the
    transfer picker was not, and neither was the split picker (`#splitLineRow`), which has the same
    shape.
  - **Task 5 landed as #750** (lane B item B5, 2026-09-27, main `4a4ca65c9`): the kitchen,
    the pass and the table screen work by a seated party's groups, and a kitchen ticket that has
    not printed shows on the table. **Kitchen screen:** a party's card is split into "Group n"
    sections; a held group reads "Held, not released" and, when the venue's who-fires setting
    (`fire_control`) is `kitchen`, has a Fire button (never on an enrolled kitchen display).
    **Pass:** each group has Fire (under `expo` only), "Group ready" or Away, through the new
    `POST /api/parties/:id/groups/:gid/ready` and `.../away`, which answer a resent press from its
    record without acting twice and refuse a screen read before the table changed
    (`party.out_of_date`); the kitchen screen and the pass then read again and say the table
    changed. A counter order, or a bill with no party, keeps its course sections and course
    buttons, and the course routes stay, because a counter order's held course has no other
    release. **Table screen:** a fired group in the Tab drawer
    reads "Ready" only once someone marked it ready, "En route" once the pass sent it, otherwise
    "Fired N min ago"; the server never infers ready. _(Task 9, 2026-09-28: a fired group now reads
    "Served" once every one of its dishes is marked served. Each dish row in Current orders reads
    "Served" once fully served, "Held" while not released, otherwise its own kitchen item's
    recorded state — "Preparing", "Ready", "En route" or "Fired N min ago" — and nothing when it has
    no fired kitchen item.)_ **Kitchen tickets:** a reprint opens with
    `*** REPRINT ***`, a party's ticket names `GROUP n`, and a new venue setting chooses whether
    identical dishes print as one entry (`3 x Burger`, the default) or one entry each; a dish sold
    by weight or volume is never added together or split. The setting is
    `service_settings.kitchen_ticket_grouping`, chosen on the dashboard's Preparation routing tab
    and saved through its own route,
    `PUT /management-api/venue-service/settings/kitchen-ticket-grouping`, so the existing settings
    route is unchanged. Venue-service `0005` adds the column and `0006` rebuilds the table to add
    a check allowing only the two values: two drizzle generations, because a single one copied the
    new column out of the old table and failed. The rebuild is
    safe because nothing points at `service_settings` (no key to it in any migration set, and no
    other set's SQL names it) and its only triggers, the change feed's three, are removed before
    migrating and reinstalled at boot. **Printing problems:** core `0029` adds `kitchen_print_jobs`,
    one row per kitchen print job, bill and station — in core because all three of its keys point
    at core tables (`print_jobs`, `working_orders`, `kitchen_stations`). A ticket that failed
    every delivery attempt, or is still waiting after two minutes (the rule the printer alert
    already used), shows "Printing problem" with Reprint on the table screen, and on the station's
    card (Reprint there only on a till, not on a kitchen display). Ordering is never blocked. It
    clears only when a later reprint of that bill prints on the same printer, so the notice stays
    until the reprint has printed and the screen reads again. _(B6a, 2026-09-28: it also clears
    once a Reprint of that bill would print nothing on that printer for that station.)_ Left open,
    from the branch's ledger:
    - A party finished while its food is still on the pass keeps its cards there with no group
      button that works (each is refused `party.not_open`); a question for the owner.
    - "Ready" and "Fired N min ago" on the table screen are the plan's default, not an owner
      decision.
    - A fired group with nothing for the kitchen (bottled water, say) never reads Ready.
    - `*** REPRINT ***` and `GROUP n` print in English. _(Task 6, 2026-09-27: so do `*** HOLD ***`,
      `*** FIRE ***`, `*** HOLD CHANGED ***` and `*** HOLD CANCELLED ***`.)_ _(B11g, 2026-10-01:
      the extra-cancel slip is the one kind whose header word and cancel line follow the server's
      locale (`WAITRON_TILL_LOCALE`, `es-ES` when unset), so by default a held slip reads
      `*** HOLD CAMBIADO ***`, `GROUP n` and `QUITAR:`, mixed on one slip; every other slip stays
      English.)_
    - A resend from the dashboard's Printers screen does not clear a table's printing problem, and
      there is no way to dismiss one: a detached or replaced printer leaves it showing. _(B6a,
      2026-09-28: a printer detached from the station now drops the problem, tested. A printer
      switched off keeps it showing until the printer is switched on and a Reprint prints there.
      A resend still clears nothing.)_ _(2026-10-01, A165: a printed resend from the Printers screen
      now clears it — `printJobInTrouble`, `apps/server/src/print-job-trouble.ts`.)_
    - A failed ticket on a pass printer (one ticket for the whole order) shows on the card of every
      station it covered, even where that station's own printer printed. _(B6a, 2026-09-28: it
      stops showing at a station once a Reprint of the bill would not link that pass printer to
      that station, for instance when nothing is left at the pass printer's own stations.)_
    - _Fixed by lane B item B6a (2026-09-28, landed as #795, main `4c340ace1`):_
      transfer, unjoin and split left a printing problem on the bill the ticket named, and the
      moved dishes' bill showed none. Transferring lines, splitting off a check, unjoining a table
      and moving whole lines now copy the source bill's unprinted tickets that no printed reprint
      has covered onto the destination bill for the stations whose dishes moved
      (`copyKitchenPrintLinks`, `apps/server/src/kitchen-print.ts`), so the destination shows the
      problem and its Reprint clears it; the source keeps its own until its Reprint would print
      nothing there. Still open: Finish table drops the problem of a bill that transfers emptied
      (read, not run; not re-checked by B6a). _(C31, 2026-09-28: a move now copies only a ticket
      that carried a moved dish, at that dish's station.)_
    - After a merge, a reprint of the absorbed bill that was still waiting at the merge clears
      nothing when it prints, so its warning stays until the merged bill is reprinted once more:
      one queue order cannot let it clear the absorbed bill's older failures without also
      clearing the surviving bill's (`moveKitchenPrintLinks`, `apps/server/src/kitchen-print.ts`).
      _(B6a, 2026-09-28: the same holds when dishes move by transfer, split, unjoin or a line
      move: a copied ticket never counts as a reprint, so a source-bill reprint still waiting at
      the move clears nothing on the destination when it prints. Also, not tested as a rule: move
      a dish from bill A to bill B, reprint B so it prints, move the dish back, and A shows its
      old failure again.)_
    - _Fixed by lane C item C31 (2026-09-28, #815):_ a move copied every unprinted ticket at a moved
      dish's station, so a ticket that carried only dishes that stayed behind showed on the new
      bill too (Mesa 4's burger printed on Cocina, a later fish ticket there failed, the burger
      moved to Mesa 5, and Mesa 5 showed a Cocina problem). Each kitchen ticket now records the
      order lines it carried (core migration `0035_kitchen_print_job_lines.sql`), a line's
      split-off part inherits its line's records, and a move copies only a ticket that carried a
      moved line, at that line's station. A ticket queued before the migration recorded no lines,
      so on an upgraded venue a move carries none of those tickets' failures to the new bill:
      measured by deleting a failed ticket's line records and moving its only dish whole, after
      which neither bill showed the problem (the old bill's Reprint would print nothing there).
      Cases: `apps/server/src/print-problems.test.ts`.
    - Only dishes whose unit does not print on the ticket — sold in Each by the unit's identity
      (`readLinesSoldInEach`), or with no unit recorded on the line — are added together or split;
      a venue-made unit that counts pieces (a "portion"), even one spelled like Each, prints line by
      line, because nothing records a unit's kind (a unit field would need a migration).
    - The setting sits under "Changes after sending" on the Preparation routing tab; it may deserve
      a heading of its own. _(Task 6, 2026-09-27: so does "Print held groups in advance", which is
      not about sent work at all.)_
    - `fireHeldGroupsOfCourse` (`apps/server/src/order-groups.ts`), through which a course Fire
      still fires a party's held groups, is to be removed in a follow-up.
    - The setting's upgrade was measured with a throwaway script over the real migration folders
      and a database holding one settings row, not on a seeded venue.
    - Every pass press moves the party's revision, so a waiter's open Tab drawer meets
      `party.out_of_date` after it and reads again.
    - Setting up a venue from an imported configuration deletes every kitchen station, and the new
      table's station key has no delete rule; whether that venue can already hold link rows at that
      point was not tested (read, not run).
    - The pass's Ready and Away record no `order_group_events` row, so who pressed them is recorded
      nowhere readable; the command row keeps only a hash of its arguments. A new kind changes that
      append-only table's check, which is a core migration. The course Ready and Away buttons
      recorded none either.
    - Questions for the owner:
      - A party's dishes in no group (moved in from another party's bill or from a
        bill with no party) show at the pass in a section of their own with no Ready or Away
        button, as dishes with no course did before. _(2026-09-29: since Task 9 a whole bill moved
        in by Move a bill or Split a table gets groups; the tab transfer (`transferLines`) and
        `unjoinTable` still leave dishes in no group until Task 13.)_ _(2026-09-29, Task 13: both are
        deleted.)_
      - The kitchen and pass screens offer Fire on every held group, as the Tab drawer and the
        course-era screens did, where the plan's text said "the first held group".
      - The table screen reads its printing problems in a second request beside the groups read on
        every table load. Folding them into the groups response would change the exact-body
        assertion in `apps/server/src/till-api.groups.test.ts`'s "answers the party's revision and
        its groups in sequence", so it was left.
  - **Task 6 landed as #761** (lane B item B6, 2026-09-27, main `75ab7c10e`): with the venue's "Print held groups in advance" setting on, a held group prints a
    kitchen ticket marked HOLD; later changes to it print HOLD CHANGED or HOLD CANCELLED slips, each
    also a notice on the station screen; firing it prints its ticket marked FIRE. Core `0030` adds
    `order_groups.hold_printed_at`; venue-service `0007` adds `service_settings.print_held_work` and
    `kitchen_notices.direction`, and `0008` rebuilds `kitchen_notices` to add checks on `direction`:
    a value other than `added` or `removed` is refused, and so is a direction on a notice that is not
    `changed`. The rebuild is safe because no foreign key points at `kitchen_notices` and its only
    triggers, the change feed's, are removed before migrating and reinstalled at boot. The upgrade
    was measured with a throwaway probe on a venue migrated to main's head and seeded with groups, a
    settings row and notices of every kind: after migrating, every row read back equal, the new
    columns read null or 0, `pragma foreign_key_check` returned nothing, the change feed's triggers
    came back after `installChangeFeed` and logged updates, and setting `direction = 'added'` on a
    `void` notice was refused with `CHECK constraint failed: kitchen_notices_direction_kind_ck`.
    A failed HOLD ticket shows "Printing problem" on the table and the station as a fire ticket
    does, and Reprint prints the held dishes of each still-held group whose HOLD ticket was queued
    again, marked REPRINT and HOLD, beside the fired work: one job per printer and station, or per
    pass printer, carries both.
    Left open:
    - A failed HOLD correction slip (HOLD CHANGED or HOLD CANCELLED) raises no "Printing problem",
      like every correction slip: none is recorded in `kitchen_print_jobs`, which is all the
      printing problems read.
    - A printed HOLD ticket goes stale when held groups are reordered or a party is merged into
      another, since both renumber `GROUP n` and later slips print the new number; and when the
      party's table moves or is joined, since no MOVED slip goes out for held work (MOVED slips
      cover fired work only, `readSentWork` in `apps/server/src/kitchen-print.ts`). Only a FIRE
      ticket or a Reprint, each of which prints the group as it stands, can be relied on.
    - The route that removes a line, `DELETE /api/working-orders/:id/lines/:lineNo`, takes no
      revision and no retry id, so a retried removal of part of a held dish removes another part
      and prints a second HOLD CANCELLED slip. The route predates Task 6. _(2026-09-30, B11a: the
      route and `voidTabLine` are deleted; a cancel goes through the adjustment route, which takes
      the bill's revision and a retry id.)_
    - Whether a group's HOLD ticket was queued is recorded per group, not per station, so a
      correction can print at a station whose printer never printed that group's HOLD ticket — a
      dish from another station joined to the group, say, or a printer switched back on after the
      HOLD ticket went out. Reprint reads the same per-group marker, so it too can print a REPRINT
      and HOLD section at such a station.
    - _Fixed by lane B item B6a (2026-09-28, landed as #795, main `4c340ace1`):_ a failed
      kitchen ticket, fire or HOLD, whose dishes at that station were then all cancelled stayed a
      "Printing problem" that Reprint could not clear, and so did a pass printer's failed ticket at
      a station the pass printer is not attached to once the station that brought it in was
      emptied. `readPrintProblems` (`apps/server/src/kitchen-print.ts`) now drops a failed ticket
      when a Reprint of its bill would print nothing on that printer for that station, calling
      the code Reprint uses (`readReprintParts`, `routeKitchenTickets`), so the two share their
      choice of dishes and printers. Of the six cases the first commit added
      to `apps/server/src/print-problems.test.ts`, the three that clear or drop a problem were red
      before the change; the three that keep a problem are controls that pass either way. That
      read treats a switched-off printer as if it were on, so a switched-off printer's failed
      ticket still shows, and clears once the printer is switched on and a Reprint prints there;
      a printer detached from the station drops the problem. The venue's printer alert
      (`apps/server/src/alert-sources.ts`) is unchanged and reads switched-on printers only.
      Dishes moved to another bill now carry their station's unprinted tickets to it
      (`copyKitchenPrintLinks`) _(C31, 2026-09-28: only the tickets that carried them, at their
      station)_. The later cases for moves and for switched-off and detached
      printers each failed with their fix deleted.
  - **Task 7 landed as #789** (lane B item B7, 2026-09-28, main `3e4a75e2b`): the server keeps each
    person's unsent order on a seated party, a "draft", so two waiters at one table each have their
    own. Core migration `0031_order_drafts` adds `order_drafts` (one open draft per person and
    party, by the partial unique index `order_drafts_open_owner_uq`), `order_draft_lines` and
    `order_draft_events` (append-only: created, taken over, submitted, discarded). They are in core
    beside `parties` and `order_groups`, the tables they belong with. The work is in
    `apps/server/src/order-drafts.ts`, reached through `GET` and `PUT /api/parties/:id/drafts` and
    `POST /api/parties/:id/drafts/:did/take-over` and `.../submit`; the person is always the one
    signed in, never a name in the body. A save replaces the draft's lines and adds identical lines
    together (same dish, variant, menu version, course, options, extras and note), except a line
    marked not to merge or one whose quantity is not a whole number; it does not move the party's
    revision. A line whose dish, variant, extras pick or chosen option is no longer offered reads
    `unavailable`, worked out on each read and never stored. Submitting sends some or all of the
    draft's lines as groups through the code the groups route uses (`placeGroups`, split out of
    `submitGroups`), credits them to the draft's owner, and answers a retried submission from its
    record. Merging parties carries each open draft's lines to the surviving party, into its owner's
    draft there when there is one, and Finish table discards the party's open drafts, each with an
    event. The table list gives each seated party its `unsentDrafts` (owner's name and line count).
    New codes `draft.taken_over`, `draft.already_submitted`, `draft.out_of_date` (409) and
    `draft.not_found` (404) have English and Spanish till text. Upgrade: a venue built on the merge
    base `853c94f0a` with dev-setup's own `devSetup` (421 back-dated sales), plus two seated parties
    each with a fired group, was migrated with the branch's migrations. Every existing table kept
    its rows (a hash of each table's rows was unchanged, except the core migration log, which gained
    its one row) and its `CREATE` text; the three tables, four indexes and the append-only trigger
    pair on `order_draft_events` were added. On a copy, an update and a delete of an event row were
    refused (errcode 1811) while an update of a draft went through. On another copy, a control that
    deleted one row and rebuilt one table was caught: the row counts and hashes showed the lost row,
    the `CREATE` text the rebuild.
    Left open:
    - A draft that moves to the other party in a merge, because its owner had none there, records
      no history event: the event kinds have no "moved", so only its party and revision change.
    - An options list a line leaves unanswered (one added to the dish after the draft was saved,
      say) is refused at submission with `options.label_required`, but the draft does not flag the
      line unavailable. Nor does it flag a fractional quantity of a dish sold whole, refused at
      submission with `quantity.invalid`. _(Task 8, 2026-09-28: the till now marks such a line
      `unit_changed` once the table's offers are read — `lineBlock`,
      `apps/till/src/state/menu-refresh.ts`; the server's own flag, `unavailable` in
      `apps/server/src/order-drafts.ts`, still checks neither case.)_
    - A line whose course is switched off after it was saved is kept by later saves and refused at
      submission with `course.not_found`; the draft does not flag it unavailable.
    - A line saved against a menu version that is no longer live (the menu was republished) is
      refused at submission with `menu.version_changed`, and the draft does not flag it unavailable
      either. Whether the till re-saves such lines against the new version is Task 8's. _(Task 8,
      2026-09-28: the till moves such a line to the live version and saves it — without asking
      when a publish arrives and nothing on the line changed, otherwise once the person confirms
      the new price; a line read back from the server under an older version (after a reload, say)
      is always asked about, showing the new price alone, since the till never held the old one.)_
    - A retried submission of a draft a merge moved or discarded is answered as the tests in
      `apps/server/src/order-drafts.db.test.ts` pin: a draft discarded into its owner's draft on
      the other party, and a moved draft asked on the party it was sent from (the party a request
      prepared before the merge names), replay the first answer and write nothing; a moved draft
      asked on the party it moved to is refused `draft.out_of_date`. The branch's first ruling
      expected a refusal in every case; a replay was accepted because it writes nothing.
    - Only the draft routes fold the ids in the path to lower case, the party id
      (`requireDraftPartyParam`, `apps/server/src/till-api.ts`) and the draft id; a draft
      submission also folds its `joinGroupId` (`submitDraft`, `apps/server/src/order-drafts.ts`).
      The other party routes only check that the party or group id in the path is an id, and the
      group submission passes `joinGroupId` on as sent.
    - The till does not read or save drafts yet: nothing in `apps/till` calls these routes, and its
      `TableParty` type does not declare `unsentDrafts`. Task 8. _(Task 8, 2026-09-28: the till
      reads, saves, takes over and sends drafts through these routes, and the floor shows
      `unsentDrafts`.)_
    - After a takeover into the taker's existing draft, or a merge that discards a draft, the
      previous owner's next save of the old draft is answered `draft.not_found`, not
      `draft.taken_over`.
    - A save must carry `draftId` (null for a new draft) and `revision` even for a new draft, whose
      revision is ignored; a detail for Task 8's client. A chosen option whose label id is not a
      UUID is refused `options.invalid` at save, where pricing answers `options.label_required`.
      An options or extras refusal at save names only the field, as pricing does (`labelId`,
      `quantity`), not the line (`lines.<n>.…`) as the save's other line refusals do, so with
      several lines the till cannot tell which line was refused. _(Task 8, 2026-09-28, read, not
      run: the till reads only a save refusal's code (`asRefusal`,
      `apps/till/src/state/draft-sync.ts`), keeps the edits unsaved to send again, and shows one
      message for the whole draft, so it still names no line. A Send refused
      `product.unavailable` reads the table's offers again and marks the draft's lines against
      them (`#markSoldOut`, `apps/till/src/till-app.ts`).)_ _(2026-09-30, B13: now `#markUnsellable`,
      which also handles `product.not_sold_separately`.)_
    - A merge that names no operator records the draft's owner as the one who discarded it; the one
      product caller, the merge route, always names one.
    - Three rulings made on the branch for the owner to confirm:
      - a line whose quantity is not a whole number (a weighed portion) never adds into another
        line, so two portions of fish stay two rows the kitchen can cook separately;
      - Finish table discards the party's open drafts, keeping their lines, instead of refusing
        while one is open;
      - taking over someone's draft when you already have one on the party adds their lines to
        yours (identical lines add together) and discards theirs, instead of refusing.
  - **Task 8 landed as #806** (lane B item B8, 2026-09-28, main `1356ff14a`): the till now works from
    each person's unsent order kept on the server (Task 7's "draft"), so an order being rung up is
    still there after leaving the table or reloading the till. What a person at the till sees:
    - A tap adds the dish to their draft, and identical taps add together ("Beer ×3"), by one rule
      the till and the server share (`packages/shared/src/draft-merge.ts`; the server's
      `apps/server/src/order-drafts.ts` imports its `normaliseDraftLines` from `@waitron/shared`).
      A bar at the foot of the menu shows the dish last added, with −1 and +1; −1 at one takes the
      line out. Each draft line shows once, in its course section, and a line of several whole
      units can be split into rows of one that later taps do not join back together. A weighed dish takes its weight through the counter's weight entry.
    - Edits are saved about 0.4 s after the last one (`DRAFT_SAVE_DELAY_MS`,
      `apps/till/src/state/draft-sync.ts`), and at once on going back to the floor, leaving the
      Order tab, opening another table or signing out. Leaving sends nothing to the kitchen. A save
      refused because the same person changed the draft on another device shows the server's
      draft and says so. After a sign-out, the next person finds the table still open with the menu
      and their own draft on it.
    - Where the table screen is narrower than 720 px (its own measured width, not the kind of
      device), the menu fills it and "Review (N)" opens the draft on a view of its own; Back
      returns to the same place in the menu. Wider, the two sit side by side.
    - The floor marks a table whose party has an unsent order: on the list, one line per person
      ("Alex has an unsent order: 2 items"); on the map, an "Unsent" tag on the table, with the
      names only in what a screen reader announces (`wt-table-token` in `packages/ui`).
    - Other people's drafts on the table show read-only under "Alex has an unsent order", with
      Take over draft behind a confirmation. The person it was taken from sees "Taken over by
      Sam", still read-only, with Take over and no Send.
    - A menu published while the draft is open moves the draft's lines to the new version without
      asking when nothing on them changed, and otherwise opens the counter's "The menu has changed"
      dialog.
    - A line that cannot be sold now (sold out, off the menu, an extra or choice changed, a
      quantity its unit no longer takes, or the server says so) shows its reason and offers Remove
      and Keep. Every kind of send leaves such lines out, and the check before sending says which
      ("1 line stays in the order, not sent because it is not available now: Beer ×2"). The
      server's own refusal of a sold-out dish (`product.unavailable`) stays behind it.
    - A send whose reply never arrives is sent again under the same submission id, up to twice
      more, inside the 150-second limit the till already had; if none answers, the till re-reads
      the draft and says to check the tab. Nothing is taken out of the draft on the till's side.
    No migration. The one server change is read-only: every draft now carries `takenOverFrom`, the
    person its latest take-over was from, read for all the drafts of an answer in one query of
    `order_draft_events` (`apps/server/src/order-drafts.ts`). Six tests on `main` that pinned the
    old behaviour (the table screen's draft kept per bill, and "no reply takes the dishes out")
    were deleted; the tests that checked the old submission call now check the new one, keeping
    their expected values except one call count; and the tests that measured the draft at phone
    width now open Review first. The PR names each.
    Left open:
    - Saving and sending:
      - An edit can be lost at sign-out without a message: one made after the session had
        already ended (an inactivity sign-out), and one made while an earlier save was still
        waiting for its answer when sign-out began.
      - If someone else signs in while a sign-out is still waiting for its save, the till skips
        signing the first person out on the server, so that session lasts until it expires.
      - A send cut off by the 150-second limit is not sent again, and after a reply that never
        came the draft can stay locked for up to two limits: the send, then the re-read.
      - When a send is refused because the menu changed, the re-read of the table's menu runs
        outside that limit (the reviewer recorded this as predating the branch).
      - After a draft refusal whose re-read also fails, the till keeps the draft's old revision, so
        the next Send is refused as out of date and re-reads first: a wasted round trip, nothing
        lost.
      - While the till follows a party onto its next bill, the screen can show no draft for a
        moment; and when a merge or move coincides with a refused save, the save's message can
        replace "another device changed this table".
      - Drafts are not pushed to other tills: Sam's till sees Alex's latest draft only at its next
        read. Taking over an older copy is refused and the table read again.
    - Other people's drafts:
      - When the take-over added Alex's lines into Sam's own draft, Alex sees "Sam has an unsent
        order", not "Taken over by Sam": the take-over is recorded on the draft that was folded
        away, so `takenOverFrom` on Sam's draft is empty.
      - At phone width nothing on the menu view says other people have drafts on the table; the
        button reads "Review (0)". The floor's mark does say so.
      - Nothing counts the queries behind `takenOverFrom`; "one query" holds by how the code is
        written.
      - Three automatic changes to the draft (`adoptLines`, `removeLines` and `clear` on the
        till's store) are not blocked while a take-over is out; none is a person's edit and the
        take-over's answer replaces the draft. Read in the code, not run.
      - The Spanish "has taken over this order" wording has no test.
    - The floor:
      - The map tag says "Unsent" but not whose; the names did not fit a table on the map.
      - At 390 px the map already overlaps and clips crowded tables (a screenshot with no marks
        showed the same), so a table's tag can hide under a neighbour.
      - Related to the entry above but a different problem: that one is tables overlapping each
        other; this one is a single token near the plan's top edge being cut off by that edge. Seen
        during campaign item A117 and left open there. Screenshots of one floor at
        390 px showed table 2's party name cut off with no reminder anywhere, and with the "Time to
        fire" chip adding a row, table 1's label cut off too. Measured 2026-09-29 by the
        finish-branch run-it review (Codex), on a 390 px Spanish floor in both themes, with a token
        placed fully inside the map: making its party's reminder due grew the token from 115 px to
        157 px tall, and because each token is centred on its position (`translate(-50%, -50%)`,
        `packages/ui/src/components/wt-floor-canvas.ts`) its top moved up 21 px; its label's top
        went to 190.5 px, above the map's clipping edge at 196 px. So the chip itself cuts off a
        label that fitted before it appeared. With the chip's line removed from `wt-table-token`
        the same probe passed. The same run measured the Spanish chip's right edge at 143.94 px
        against the token's right edge at 118.98 px, so the chip runs past the token's edge. Seen
        in screenshots during A117 but not measured: a round token's "Reservada 22:30" chip does
        the same. The owner chose on 2026-09-29 to land #891 with the chip inside the token and
        fix this later. **Next action:** decide whether the map keeps a token inside the plan, or
        the chip hangs off the token's edge like "Unsent". _(2026-09-30, service plan Task 10: the
        token now also carries the table's signal chips (ready per station, take order, a wait,
        an unavailable held dish, bill requested), one row each, drawn like "Time to fire": they
        wrap only between words and run past the token's edge. Seen in screenshots, not measured:
        at 390 px a floor of six tables with two or three chips each overlapped so much that
        tokens covered each other's chips; at 1280 px they did not overlap.)_
      - The map gives its "forgotten table" corner marker no spoken name. This predates the
        branch: at `700ec7f70` `wt-floor-canvas` passes its tables no such label.
    - The table screen:
      - Seating a table whose answer arrives while a newer table is still opening shows the seated
        table briefly before the newer one replaces it; a stricter check would have changed an
        existing test ("does not put a tablet back on the tab when a table it was opening arrived
        during the merge").
      - A refused seat leaves the till pointing at the refused table. At `700ec7f70` the same code
        sets the table before seating and does not undo it (read, not run).
      - If the screen widens while Back on the Review view has focus, focus goes to the page.
      - A dish no longer on the menu shows an empty name on its tick button in the person's own
        draft, and in the spoken names of its course picker and Split quantity button, with "Not
        offered now" beside it (read in the code, not run).
      - The last-added bar is empty for a draft read back from the server until the next tap, and
        does not follow a weighed line when the server's answer replaces the lines.
      - While a weight is being entered, the weight entry covers the bottom of the menu and the
        bar.
      - "Review (N)" counts items (Beer ×2 counts 2), while the floor's mark counts lines and
        calls them "items", so the two can differ for one draft.
      - Keep lasts only until the server's answer rebuilds the lines; a kept line then asks Remove
        or Keep again.
      - A dish no longer on the menu, saved at a whole quantity, counts by that quantity on
        Review; its unit is unknown, so a weighed one saved at exactly 2 kg counts 2.
      - The counter's basket now also tracks its last-added line, which it does not use.
    - Menu changes:
      - The server's "cannot be sold" mark is dropped once the till's newer menu read passes the
        line. That the two checks agree was read, not run; if they differ, one Send is refused
        `product.unavailable` and the line is marked again, which a test covers.
      - Every line priced under an older menu version is asked about whenever the server's draft
        replaces the till's lines (a reload, a re-read, a take-over of such a draft), so the
        question comes more often than it would for a person who watched the menu change.
      - A line naming a version the till does not hold costs one more read of the table's menu,
        and opening a table always compares the draft with the menu, finding nothing to ask when
        every line is current.
      - The "The menu has changed" dialog shows a focus ring round the whole dialog box, not
        checked against `700ec7f70`.
    - Tests: the accessibility test "has no violations with the round grid, the per-line course
      picker and the open tab drawer" no longer scans the menu grid, which Review now hides (a new
      phone test scans it); its name was kept. The new shared helper file
      `apps/till/src/screens/till-table-order-screen.test-helpers.ts` counts towards the till's
      coverage, unlike `apps/till/src/widgets/test-helpers.ts`. `repriceRebuilt`'s
      `menuItemId ?? ""` fallback (`apps/till/src/state/menu-refresh.ts`) is not covered. Whether
      a real till's browser ever paints the narrow layout for one frame before going side by side
      was not measured; in the tests' headless Chromium the first painted frame was side by side
      in each of 14 runs.
    - Rulings made on the branch for the owner to confirm:
      - after a reload the old price of a line is not known, so the till asks about every line on
        an older menu version, showing the new price alone, instead of storing prices on the
        server;
      - the two layouts are chosen by the screen's width against 720 px, not by the kind of
        device, so a tablet held upright shows the menu and the draft side by side;
      - −1 on the last-added bar at one takes the line out;
      - anyone may take a draft over, including the person it was taken from;
      - while a check split off the party's bill is on screen, no draft shows (the party's draft
        shows on the party's own tab); _(2026-09-29, Task 10: reversed — the draft now shows on a
        split-off bill too.)_
      - a line counts as unsellable when the till's check or the server's says so, and the
        server's mark gives way to a newer menu read on the till;
      - Cancel on the menu-change question holds until the next publish, re-read or Send, not
        the next poll.
  - **Task 9 (served by quantity, release reminders, Current orders) LANDED as #814** (main
    `e0f863014`, lane B item B9, 2026-09-28). What it does:
    - Staff mark dishes served by quantity ("2 of 4 served"), row by row or a whole fired group at
      once, and can take a mark back. The marks are commands on the party (`markServed`,
      `unmarkServed`, `markGroupServed`, `apps/server/src/working-order.ts`), replacing the old
      whole-line mark, and they work on a bill already paid without touching its filed sale. Only
      released work can be marked: a line in a held group, or whose kitchen ticket has not fired,
      is refused `group.line_held`.
      Since campaign item A118 (#824, main `b4e74fa5a`; owner, 2026-09-28: "a payment could happen while food is still
      being served, so yes you should be able to mark it served"), a served mark no longer moves
      any bill's revision, so it is taken while a card payment runs on the bill; the party's
      revision still counts it. Since campaign item A121 (#851, main `7c409d488`; owner, 2026-09-29, on A118's question:
      "do it"), a pending card refund of an open bill no longer refuses a served mark either; every
      other write `bill.refund_in_progress` refused still refuses.
    - The server works out when the party's next held group should be fired: once every dish of
      the fired groups ahead of it is served, a set number of minutes after the last of them.
      Staff can put it off by five minutes. Since campaign item A116 (#821; owner, 2026-09-28:
      "refuse with a code"), only the group waiting, the party's first held group, can be put off:
      a snooze on any later held group is refused `group.not_waiting` (409) and the till says so
      in English and Spanish. Clearing a later group's snooze gets the same refusal and the same
      snooze-worded sentence. A manager sets the minutes, or turns the reminder off, on the
      dashboard's operations screen (Off, or 5 to 30 minutes; the route takes any whole number
      from 1 to 120).
    - The table screen's tab drawer is now Current orders: every group of the party in order, with
      each dish's recorded kitchen state, from every bill of the party that was not abandoned, a
      paid one included.
    - Migrations, none of which rebuilds a table: core `0032_line_served_quantity` and
      `0034_order_group_added_later` each add one column; core `0033_line_served_exception`
      re-creates `working_order_lines_require_open_parent_update` so a paid bill's line may still
      change its two served columns and nothing else, and so a line can no longer be moved off an
      order that is not open, which `0027` allowed whenever the destination was open; venue-service
      `0010_release_reminder_minutes` adds one column. Upgrade measured 2026-09-28: a scratch venue
      migrated to main `582fd221b`, seeded with two parties, five groups (fired, held, removed),
      three bills (one paid) and seven lines, then migrated to the branch in one go (on the current
      `0033`), and on a second venue in two steps (`0033` as it stood at `c1a1c667f`, then `0034`).
      Every row was kept; tables (148), triggers (72) and indexes (291) were the same before and
      after, with only that trigger's text changed; `pragma foreign_key_check` found nothing.
      Groups existing at that upgrade read `added_later` false and existing lines `served_quantity`
      0, so a line marked served before the upgrade keeps `served_at` with a served count of 0 (no
      backfill, by the pre-live rule). `0034`'s column is dropped again by core
      `0040_drop_order_group_added_later` (campaign item A119, #845), a plain `DROP COLUMN` that rebuilds
      no table. Measured 2026-09-29: a scratch venue migrated at main `8235f63e7` (core `0039` there
      is `0039_table_needs_cleaning`), holding one party
      with four groups (two fired, one of them marked added later, one held, one removed), six
      group events and four lines, then migrated with the branch's sets: the groups and group
      events read the same but for the dropped column, every line kept its group, tables (149),
      triggers (419, with the change feed installed) and indexes (294) were the same by name, and
      `pragma foreign_key_check` found nothing.
    - Left open:
      - Once a venue's invoice languages change, marking a line served on a paid bill is refused.
        The two locale triggers on order lines (`working_order_lines_check_locales_update` and
        `working_order_lines_check_variant_locales_update`, core migration `0027`) check a line's
        descriptions against the venue's current languages on every update, a served mark included.
        A Part 1 test pins the refusal ("refuses a served mark on a settled line once its venue's
        invoice locales changed", `scripts/behavioural-triggers.test.ts`). No product route changes
        a venue's invoice languages after setup today: a grep finds them written only by setup and
        the configuration import setup runs. **Next action:** limit both triggers to updates of
        `descriptions` (and `variant_descriptions`) and `working_order_id`.
      - A line outside any group that needs no kitchen, held, and first released after its bill was
        paid cannot be marked served: `sent_at` is its only record of release, and `stampSent`
        writes it only on an open bill, so the mark is refused `group.line_held`. Reproduced
        2026-09-28 by the finish-branch run-it review: a no-kitchen item (water) held, the bill
        paid, its course fired, then marked served — refused `group.line_held`. **Next action:** decide whether a paid bill's line may take `sent_at`, which would
        widen `0033`'s exception. _(2026-10-01, B21, #969: core migration `0053` lets a presented or paid bill's line take a
        first `sent_at`, and `stampSent` now writes on any bill but an abandoned one. Whether this
        case is now served was not measured.)_
      - The server's floor read (`GET /api/tables/state`, `readSeatedParties` in
        `apps/server/src/working-order.ts`) carries each party's `reminder` (the held group waiting
        and when it is due); since campaign item A117 the till's floor uses it only to mark a table
        once that reminder is due, without showing the time or the group. The table screen's
        Current orders shows it on the waiting group once it has a time: the time it falls due,
        then Snooze and, where waiters fire held groups, Fire; while it is snoozed, also Clear
        snooze (A120). **DONE (#891, campaign item A117):** once a party's reminder falls due, the floor
        shows a "Time to fire" chip (`floor.fire_due`) on the table's list card and on its map and
        tray token, and nothing before then; the floor redraws itself at the moment the next
        reminder falls due, without waiting for a new floor read. The chip itself can push a label
        near the plan's top edge out of view on a 390 px map (measured by the run-it review); that
        is left open under "The floor:".
      - **Decided (owner, 2026-09-29):** merging one party into another does not clear a moved
        group's snooze (owner: "not automatically"); staff are to be able to clear it by hand
        (owner: "They should be able to clear it by hand"). `moveGroupsToParty`
        (`apps/server/src/order-groups.ts`, reached from `mergeTabs`; _2026-09-30, Task 13: now from
        `combineParties`, `apps/server/src/table-actions.ts`_) moves each absorbed group
        without touching its `remind_at`, so a snoozed waiting group of the absorbed party lands
        behind the other party's held groups with its snooze intact. Measured 2026-09-29 with a
        throwaway test on the A116 branch, reminder at 10 minutes: once the group ahead was fired
        and served at 20:30, the moved group became the waiting one due at its leftover 20:20, not
        the 20:40 it would have without the snooze. It predates A116. **DONE (#850, campaign item
        A120):** staff clear a snooze with Clear snooze on Current orders
        (`POST /api/parties/:id/groups/:gid/unsnooze`, `unsnoozeReminder` in
        `apps/server/src/order-groups.ts`). Like a snooze, it applies only to the group the reminder
        is waiting on, so a moved group is cleared once it becomes the waiting one; the reminder then
        falls due as if it had never been snoozed. Clearing a group with no snooze is accepted and
        changes nothing but the party's revision. **Spanish wording DONE (#910, campaign item A124):** the
        button reads "Cancelar posponer", not "Quitar aplazamiento" (owner, 2026-09-29: "Just use
        Cancelar or Cancelar Posponer, apparently nobody uses posposición"); a bare "Cancelar" would
        not say what the reminder row's button cancels. It was the till's only Spanish string
        saying aplazar; a case in `apps/till/src/i18n/strings.test.ts` holds both.
  - **Task 13 (standalone ordering) landed as #903** (lane B item B13, main `ba07ac061`,
    2026-09-30). A product's
    `ordering` is Public, Staff only or Not sold separately (`products.ordering`, core migrations
    `0046`–`0048`; `products.sold_alone` is dropped). The published menu carries it, the server
    refuses a standalone line for a dish the live version publishes as Not sold separately
    (`product.not_sold_separately`, 409), and being offered as an extra ignores it. The till's home
    page and search leave such a dish out, and mark a draft line or an unsaved counter line holding
    one; the product editor has the three-way choice and the products list a three-way column and
    filter. Staff only
    behaves exactly as Public until guest ordering exists. **Upgrading a venue sets every product to
    Public** (no data is carried across before production), so a venue must set again any product it
    had as not sold on its own. **After the upgrade every published menu shows as changed**, listing
    each product's "how it is sold", until it is published again: documents published before the
    change carry no setting (measured on a seeded scratch venue, 2026-09-30). A standalone line
    already stored on a held order or tab still sends and pays after a publish makes its dish Not
    sold separately, because it was already ordered (`apps/server/src/till-api.sell-published.test.ts`:
    "pays and sends a held order's standalone line after a publish makes it not sold separately",
    and "fires and pays a table's held standalone line after a publish makes it not sold
    separately"); the same line in a draft is refused when the draft is sent or saved, and the till
    marks it for removal.
  - **Task 10 (the service dashboard's attention signals)** DONE (#908, 2026-09-30, main
    `c6eb459df`; lane B item B10). The floor read and the
    counter's held-orders list carry a list of signals per table or order, the till shows them as
    chips with a per-station summary of dishes ready, and a party can be marked as having asked
    for the bill. Defaults the branch chose, sent to the owner as an FYI (not the owner's rulings):
    - A bill request is cleared only when a PAYMENT leaves the party's family with nothing to pay.
      Other ways of leaving nothing owed — moving the last owing bill away, voiding its last line,
      or asking for the bill when nothing is owed — keep the request until staff press Cancel or
      Finish table closes the party.
    - Merging a party that asked for the bill into another drops its request.
    - The long-wait chip counts only dishes sent to the kitchen, not held ones.
    - The floor's to-serve, ready and long-wait figures now include paid bills and the bills of
      parties merged in, which reverses the figure table-actions Task 13 stated: a venue that never
      records serving sees a paid table's dishes as waiting until Finish table.
    - Asking for the bill and cancelling the request share one route,
      `POST /api/parties/:id/bill-request`, with a `requested` true or false.
    - Left open, for the owner:
      - The floor's older waiting band (`timingBand`, which colours the card and shows "Forgotten")
        still counts HELD dishes, from #185 (`a272c0daa`), before this branch, while the new
        long-wait chip counts only dishes sent to the kitchen. So a table whose only work is a held
        course queued long ago shows "Forgotten" with no wait chip. **Next action:** decide whether
        `timingBand` should also count only dishes sent to the kitchen.
      - The "Take order" chip has the same primary border on a neutral fill as the "Reserved"
        badge, and the "Bill requested" chip is filled primary like the "N en camino" badge, so each
        pair looks alike. **Next action:** decide whether the chips get tones of their own.
      - At 390 px the map's tokens now carry chips and overlap more: see the dated note on the map
        entry under Task 8's "The floor:" above.
      - The till drops the bill request's late answer, a refusal included, once the waiter has
        signed out or left the party (`#onRequestBill`, `apps/till/src/till-app.ts`). That is
        stricter than most of C81's table actions, whose late refusals are still said on the banner
        (Finish's refusal for a bill still unpaid and the name's own refusal are dropped there too).
        **Next action:** decide whether a late refusal of the bill request should be said too.
  - **Task 11 (cancellations, comps and discounts)** DONE (#916, main `488b63b28`, lane B
    item B11, 2026-09-30). A comp, a line discount (percentage or amount) and a whole-bill discount
    are applied under a reason (`POST /api/working-orders/:id/adjustments`, with a read-only
    `…/adjustments/preview` the till shows before confirming; `applyAdjustment` in
    `apps/server/src/adjustments-apply.ts`), recorded in the append-only `adjustments` table of
    `packages/adjustments` with the reason and its policy as they were, checked against the reason's
    cumulative limits, and, when the operator's role is below the reason's `apply_role`, approved on
    the waiter's till by the PIN of someone at or above its `approver_role`. Separately, when the
    operator is below a manager and a discount takes the bill past the venue's limit, or a cancel
    leaves it past the limit with a larger share than before (B11b, below), whoever approves is at
    least a manager — or the reason's approver role, when the operator is also below the reason's
    `apply_role` and that role is higher. A comp or discount lowers the line's price in whole cents per unit (plan D4, D15) and keeps
    its first price in `working_order_lines.list_unit_price_gross` (core migrations `0049`, `0050`;
    the second re-creates the line trigger with the column in both unchanged-column lists). The
    printed receipt, the till's open bill and its on-screen receipt show that first price before the
    new one (`12,00 € -> 0,00 €` on paper: none of the printer character sets has `→`, pinned in
    `apps/server/src/receipt-ticket.test.ts`). _(2026-09-30, C90, #932: the printed receipt and the
    till's on-screen receipt no longer do. Every row shows its first price, and after each dish and
    its extras comes one line for each comp or discount made on them (`Invitación -12,00 €`,
    `Descuento 20% -2,40 €`, `Descuento -1,00 €`); a discount on the whole bill is its own line
    after the goods, before the VAT breakdown. The till's open bill still shows the first price
    struck through. When the bill's adjustment records no longer add up to what its rows show (part
    of a discounted line cancelled afterwards, for one) or one names a row that is not on the
    receipt, each dish instead gets one line for what its rows lost, and a discount on the whole
    bill is not shown on its own: `receiptLines`, `apps/server/src/receipt-adjustments.ts`. The
    cases in `receipt-ticket.test.ts` that pinned the `->` were removed or rewritten with it.)_
    Raising the quantity of an adjusted line adds the new units as their own line at today's price;
    while the adjusted line is held they wait in its group and fire with it. **The upgrade was
    measured**
    (2026-09-30; taken before the `adjustments` table's `split_line_ids` column became `splits`; the
    upgrade creates that table empty): a venue seeded with main at `1e21f89fb` (core migrations ending at `0048`) through
    `devSetup`, plus one open party bill with fired lines, one with a held group and one paid, was
    migrated with the branch's `applyMigrations`; every pre-existing table kept its row count, and
    `pragma foreign_key_check` printed nothing. The golden huella test and `inmutabilidad` pass
    unedited. Left open:
    - _Done by lane B item B11a (2026-09-30, #927):_ the till's Cancel asks for a reason, and an
      approver's PIN when the reason needs one, and records the cancel as an adjustment through
      `POST /api/working-orders/:id/adjustments` (`action: "cancel"`). The reasonless
      `DELETE /api/working-orders/:id/lines/:lineNo`, `voidTabLine` and the code
      `tab.void_quantity_invalid` are gone. Part of a dish with extras can be cancelled, its extras
      following the dish. An extras row cannot be cancelled on its own
      (`adjustment.line_not_adjustable`); the old route took the whole of one, but the till offers
      no Cancel on an extras row. _(2026-09-30, B11d, #946: the server now cancels, comps and discounts
      an extras row on its own, whole only, and that code is retired; the till offers all three on
      an extras row, at a table and in the counter's basket, and Cancel where its dish offers it.)_
      Left open:
      - _Done by lane B item B11e (2026-09-30, #949):_ a newly set-up venue has one cancel reason,
        "Entry error" / "Error al marcar": cancel only, staff apply it alone, no limit, no note.
        Both names are stored; the stored name is the Spanish one when the venue's first invoice
        language is Spanish and the English one otherwise, and the till shows the reason in the
        operator's language, or the venue's display language for an operator with none set. The
        adjustments module's provisioning seed creates it
        (`packages/adjustments/src/provisioning.ts`), so both the setup wizard and
        `waitron-provision venue` give it, and only to a venue with no reason at all, switched off
        or not. A configuration imported at setup replaces it with the imported venue's reasons,
        so importing from a venue with no reasons leaves the new venue with none, and the till's
        dialog then says so (`adjust.no_reasons`); whether setup should add the default after such
        an import is left for the owner to decide. Registering a till
        (`apps/server/scripts/register-till.ts`, through `provisionNode`) runs the same seed with
        the same rule, so it would add the default to such a venue. The demo seed's own "Entry
        error" is the same reason, so a demo venue lists it once. It is an ordinary reason a
        manager can edit or switch off. A venue whose reasons are all switched off still cannot
        cancel, and the till's dialog still says so (`adjust.no_reasons`).
    - _Done by lane B item B11b (2026-09-30, #931, main `e511aa831`):_ a venue can set a limit on a bill's TOTAL discount
      (`adjustment_settings.max_bill_discount`, adjustments migration `0002`, set on the dashboard's
      Adjustment reasons screen). The share is measured from the bill's current rows — each row's
      price before adjustments less its price now, leaving out the rows this bill's own comps
      priced at zero — against the price before adjustments of what is still on the bill. When the
      operator is below a manager, a discount that takes the bill past it, or a cancel that leaves
      it past the limit and raises the share (a rise under a cent from rounding alone does not
      count), needs the PIN of someone at or above a manager
      (`apps/server/src/adjustments-apply.ts`, `shareOf`). A comped row moved to another bill
      counts as discount there. Splits, transfers and merges are not checked; the discount moves
      with the rows. Left open:
      - **The adjustment history records who approved, but not whether the bill's discount limit,
        rather than the reason, is why.** Recording it would need a column. **Next action:** decide
        whether to record it.
      - **The till still lists two approver refusals it can no longer receive:**
        `APPROVER_REFUSALS` in `apps/till/src/till-app.ts` names `person.not_found` and
        `person.suspended`, which an approver's PIN check stopped returning when every login
        failure became `pin.invalid` (C95, #930). **Next action:** drop the two entries.
    - _Done by lane B item B11c (2026-09-30, #938, main `a9f58e0a5`):_ comps, discounts and Cancel work on a stored open
      counter order — a bill moved from a table, a split or edit of one, and an order parked at the
      counter — with the same reasons, limits and approvals as a table's bill (owner, 2026-09-30).
      The server takes an adjustment on any open order (`planAdjustment`,
      `apps/server/src/adjustments-apply.ts`). On the till, a stored order in the counter's basket
      that matches what the server holds offers Give away and Discount on each dish, Discount the
      bill, and Cancel on a dish the kitchen has, which then has no remove button and no `−`
      (`apps/till/src/widgets/basket.ts`). _(2026-09-30, B11d, #946: an extra's row offers them too,
      whole; see the B11d note under B11a, above.)_ The basket reads each line's sent state and price before
      an adjustment from `GET /api/working-orders/:id/lines` when it loads the order. It loads the
      order again after an adjustment is made, refused as out of date, or left unanswered while
      its dialog is open (`#reloadCounterOrder`, `apps/till/src/till-app.ts`), taking no edit
      until that load answers, the basket moves on (cleared, or loaded again), the operator signs
      out, or the till's request limit (150 s) passes. An answer the basket has moved past, a load
      of the same order again included, is dropped. An unsaved or changed basket offers none of
      them, nor does one being loaded again or whose pay, place or hold is out; a changed one
      offers them again once it is held and retrieved. The counter checks this again once the
      reasons are read, and does not open the dialog if the basket changed meanwhile; and again
      before the adjustment is sent, when a changed basket means nothing is sent, the dialog closes
      and the till says `adjust.basket_changed`. Left open:
      - **A placed pay-later counter order (`ticket_then_pay` or `invoice_first`) still cannot be
        adjusted:** the placed-order trigger freezes its prices, and an `invoice_first` order has
        already filed its invoice. B16, the counter handover task, was kept clear of. **Next
        action:** decide with B16 whether a placed order can be adjusted before it is collected.
      - **The server's held-order edit (`PUT /api/working-orders/:id`) still voids a sent dish's
        dropped quantity without a reason** when a client sends it that way, the venue allows
        changes to sent items and the kitchen has not started the dish (otherwise it refuses
        `ticket.already_fired` or `ticket.already_started`; `applyLineEdits`,
        `apps/server/src/working-order.ts`). The till's counter hides × and `−` on a sent dish only
        while it has read the order's lines; when they cannot be read, it shows both on every
        line. **Next action:** decide whether the edit should refuse dropping a sent line, as the
        table's Cancel requires a reason.
      - **Two basket changes the app makes by itself do not check the lock:** the menu poll's
        price-version update of the basket's lines (`adoptLines`) and the order's label
        (`WorkingOrderStore`, `apps/till/src/state/working-order.ts`). Neither checked `sending`
        before this change. A version update made while the order is being read again is replaced
        by the order as read. The till sends no prices when it saves (`#currentSaleLines`), so
        what is lost is the basket's own copy of the new prices. **Next action:** decide whether
        the two should wait for the lock.
      - **Nothing on screen shows the lock.** A tap on `+` or on the menu does nothing until the
        order and its lines have been read, and the basket shows no sign why. The lock ends at once
        on Hold, New sale, a retrieve or a sign-out, and at the latest after the till's request
        limit (150 s). How long it lasts on a real network is not measured. **Next action:** dim
        the basket, or show a one-line note, while `editsLocked` is set.
    - _Done by lane C item C89 (2026-09-30, #951):_ approver PINs are limited. A run-it review had sent
      twelve wrong approver PINs in a row and got twelve 401s and no 429 (2026-09-30). Now a
      manager's or supervisor's PIN typed on the till to approve an adjustment, to open the cash
      drawer for someone, or to approve a refund (the PIN that confirms a hand-keyed card refund
      included) counts its wrong tries: three are free, then each wrong one makes the till wait 2,
      4, 8… up to 60 seconds before that person's PIN is tried again, answered 429 `pin.throttled`,
      even for the right PIN. There is one count per till and person, shared by the three kinds of
      request and separate from the sign-in count; the till is the one the requesting session was
      opened on. A right PIN starts the count again. A PIN the server never checks, because the
      operator may do the thing themselves, neither counts nor starts it again. The till's drawer
      and adjustment PIN prompts stay open and say "Too many wrong PINs. Wait a moment, then try
      again" (the till has no refund screen). The counts are kept in the server's memory, so a
      restart clears them, and they are capped per till, as sign-in's are per device
      (`PIN_THROTTLE_MAX_KEYS_PER_SLOT`): a till holding that many answers each new person with a
      60-second wait. Guards: the "limit on wrong" cases in
      `apps/server/src/till-api.receipt.test.ts`, `apps/server/src/adjustments-api.test.ts` and
      `apps/server/src/bill-payments-api.test.ts`, the "authorize with a limit on wrong override
      PINs" block in `packages/identity/src/authorize.test.ts`,
      `packages/identity/src/credential.test.ts`, and the till's cases in
      `apps/till/src/till-app.test.ts`, `apps/till/src/till-app-adjustments.test.ts` and
      `apps/till/src/widgets/supervisor-override-dialog.test.ts`. They are weaker than the sentences
      above: no case checks that a refund's wrong PINs share the drawer's and adjustments' count
      (only the drawer's sharing with an adjustment is tested, in `adjustments-api.test.ts`); no
      case checks that the sign-in and override counts are separate in either direction (the drawer
      suite checks only that signing in again does not start the count again); and no case uses a
      second till, so nothing checks that the count is per till.
      Left open by #951's review, for the owner: the two PIN prompts say "wait a moment" rather
      than counting down the seconds the server sends, as the sign-in screen does, and the
      approver prompt hides the message as soon as someone types; the limit is an optional
      argument, so a future route that takes an approver's PIN could leave it off and neither the
      compiler nor a test would notice — making it required whenever a PIN is sent would; and the
      dashboard's `verifyManagerPin` (`apps/server/src/payments-api.ts`) and the till's sign-in
      route each still repeat the check, count and reset steps that `verifyThrottledCredential`
      (`packages/identity/src/credential.ts`) now packages. **Next action:** the owner decides
      whether to add the countdown and make the limit required.
    - **A reason's percentage limit can be exceeded** by combining a bill discount with a line
      discount, or two bill discounts under one reason, because a bill discount counts as 0% on
      each line (a run-it review, 2026-09-30, applied two successive 30% whole-bill discounts under a
      50% cap and both succeeded). A row split off by splitting the bill, by a transfer, or by moving
      part of a line to another group starts with no percentage history (lines record no source line); a row a comp or discount carves keeps
      its source line's history. **Next action:**
      decide whether the per-line cap should see bill discounts.
      _(2026-09-30: B11b's venue limit on a bill's total discount, above, can ask for a manager's
      PIN when the combined discount passes it; this per-reason cap is unchanged.)_
    - **Not offered (part of a dish with extras is offered since B11d, below):** a comp or a
      discount of part of a dish with extras (`adjustment.partial_with_extras`; a cancel of part of one is allowed since B11a, its extras
      following the dish), part of a weighed line (`adjustment.quantity_invalid`, a controller ruling
      during the build: its two rounded parts need not add up to the line). _(2026-09-30: counter
      orders are offered since B11c, above.)_ A run-it review found that exactly representable weighed cases
      are refused too (0.500 kg of a 1.000 kg ham line at €24/kg). _Settled by the owner,
      2026-09-30:_ part of a weighed line stays refused for a give-away or a discount, exactly
      representable or not, and staff are told to discount the whole line instead.
      _(2026-09-30, B11d, #946: the server now comps or discounts part of a dish with extras, splitting
      its extras in proportion, and `adjustment.partial_with_extras` is retired; part of a weighed
      line is refused `adjustment.weighed_partial`, which tells staff to discount the whole line.
      The till offers one of several of a dish with extras, and never offers part of a weighed
      line: its give-away and discount dialog says the same sentence beside the action _(2026-10-01:
      above it since C97, #961 — `apps/till/src/widgets/adjustment-dialog.ts`)_. A
      give-away or a discount that would take nothing off — the line already free, or a discount
      too small to move any price — is now refused `adjustment.no_reduction`; before, every such
      case tried, on main before B11d as well, was recorded as an adjustment of €0.00. A cancel is
      still recorded when it takes nothing off.)_ Left open after B11d (#946, main `c9f0b7317`):
      - _Fixed by lane B item B11f (2026-10-01, PR #959, main `ab73dd7b1`):_ a discount on an extra could escape the bill's
        discount limit when the extra was added after its dish was given away whole. A whole
        give-away now records the extras rows it priced at zero (the adjustments column
        `comped_extras`, migration `packages/adjustments/drizzle/0003_comped_extras.sql`), and the
        limit (`shareOf`, `apps/server/src/adjustments-apply.ts`) leaves out only the rows the
        bill's records name, so an extra added afterwards at full price counts. The measured case
        (limit 20%, a held Pizza and Bread ×4, the Pizza given away, Olives added, 100% off the
        Olives or off the whole Pizza, then 30% off the Bread) now asks for a manager. A give-away
        recorded before the migration reads an empty list, so its dish's extras count as discount
        and the limit errs toward asking a manager; there is no data migration (pre-production).
        Left open by #959: both Codex reviews suggested a permanent test that upgrades a database
        already HOLDING adjustment rows; `scripts/migration-upgrade.test.ts` runs every step on
        empty tables only, and #959 measured the row-carrying upgrade once, in a throwaway test.
        **Next action:** decide whether the upgrade guard should carry rows (it would serve every
        set, not only adjustments). _(2026-10-01: answered by A164 — it does, synthetic rows read
        from each step's schema; see B4 → **Rows.**)_
      - _Done by lane B item B11g (#963, merged 2026-10-01):_ cancelling an extra
        of a fired dish, or of a held dish whose HOLD ticket was queued for printing, now records
        a `changed` kitchen notice naming the extra and prints a CHANGED (or HOLD CHANGED) slip of
        the dish as it now stands with a `CANCEL:` line; with the server's `locale` Spanish those
        read CAMBIADO, HOLD CAMBIADO and `QUITAR:` (`apps/server/src/kitchen-ticket.ts`,
        `tellKitchenOfCancelledExtra`,
        `apps/server/src/working-order.ts`). Venue-service `0011` adds
        `kitchen_notices.cancelled_extra` and `0012` rebuilds the table to add
        `kitchen_notices_cancelled_extra_kind_ck`, which refuses a cancelled extra on a notice that
        is not `changed`: two drizzle generations, because one copied the new column out of the
        old table and failed `scripts/migration-upgrade.test.ts` with `no such column`. No foreign
        key in any migration set points at `kitchen_notices`, and its only triggers are the change
        feed's, removed before migrating and reinstalled at boot. A throwaway probe upgraded a
        venue at `0010` holding a notice of each kind: every row read back equal,
        `pragma foreign_key_check` returned nothing, the change feed's three triggers came back and
        logged an update, and a cancelled extra on a `void` notice was refused by the new check.
        Left open: for an extra of a held dish whose HOLD
        ticket was queued, the kitchen is told but the till's cancel dialog still says only that it
        comes off the bill, because the till cannot see whether the HOLD ticket was queued.
        **Next action:** decide whether the till should be told that.
      - **An extra now counts its dish's percentage under a reason's per-line cap, and a dish the
        largest of its extras'.** So an extra added after its dish was discounted 30%, under a 50%
        cap, is refused a 30% discount of its own. This errs toward refusing; a review found no way
        to get past the cap through it. **Next action:** none unless staff find it gets in the way.
      - **Only give-aways and discounts split a dish's extras with it.** Splitting a bill,
        transferring items and moving part of a dish to another group still refuse part of a dish
        with extras (`tab.transfer_modifier_line`). A give-away or discount of part of a dish
        whose extra is not a whole count for each dish, which no product path is known to store,
        is refused `adjustment.quantity_invalid`, in the preview as well as when it is applied.
        **Next action:** decide whether those moves should split extras too.
    - **Two dashboard tests share the Escape flake fixed here** (a check made before the browser's
      close report arrives with the next animation frame): "saves on Enter and cancels on Escape from
      a focused field" in `apps/dashboard/src/widgets/variant-form.test.ts`, and `pressEscape`'s fixed
      50 ms wait in `packages/ui/src/components/wt-dialog.test.ts`. **Next action:** wait for the
      close event there too.
    - The till's "Amount off (€)" writes the euro sign into the label rather than taking the venue's
      currency. How a comp or discount appears on the invoice is still asesor Q29.
  - **Eight till tests wait a fixed real time for a round's retries** (found 2026-09-30, B13). Each
    sleeps `2 * SUBMIT_RETRY_PAUSE_MS + 50` ms while the retries pause on real time; one more test of
    that shape, "takes the party's revision from the floor read after a round that got no answer"
    (`apps/till/src/till-app-parties.test.ts`), failed once during a till coverage run beside the
    dashboard's and now waits for the "round unconfirmed" message instead (B13 branch). The eight,
    not changed: in `apps/till/src/till-app-drafts.test.ts` "sends the same request again when no
    answer comes, and takes the answer it then gets", "gives up after two more tries, reads the draft
    again and says to check the tab", "shows the draft as the server holds it after a reply that
    never came", "does not send again as the next person a Send whose reply was lost after sign-out"
    and "says nothing to the next person when the read after a lost reply answers after sign-out"; in
    `apps/till/src/till-app-menu-refresh.test.ts` "reads the table's party again and shows the tab the
    table now points at" and "does not follow the table onto a new party's tab"; in
    `apps/till/src/till-app-parties.test.ts` "shows the chosen bill when a send to it got no answer".
    None of the eight failed in this branch's runs. **Next action:** wait for what each asserts on instead
    of a fixed time. _(2026-09-30, B11a: two more of that shape wait on an adjustment's resends,
    sleeping `SUBMIT_RETRY_PAUSE_MS + 100` and `3 * SUBMIT_RETRY_PAUSE_MS + 200` ms, both from #916,
    in `apps/till/src/till-app-adjustments.test.ts`: "sends a request that got no answer again under
    the same submission id, and a new confirmation under a new one" and "reads the bill again and
    says the change may have been made when no answer ever comes".)_
  - **A till request's `frozenExtras` and `frozenOptions` are taken as already settled, prices
    included** (found 2026-09-30 in #903's review; I believe it predates that branch — `git log -S
    frozenExtras` puts it in #696 and #719). `priceOrderLines` (`apps/server/src/working-order.ts`)
    trusts them as sent. Run: a unit-level `parkOrder` call given a line whose `frozenExtras` priced
    an extra `"0.00"` at quantity 7 stored it at price 0, over its list's limit of 2. Read, not run:
    the park and held-order edit routes in `apps/server/src/till-api.ts` appear to pass `body.lines`
    through unchanged; no request was sent through a route. **Next action:** send such a line through
    `POST` park and the held-order edit route; if it is stored, re-price or refuse client-sent frozen
    selections at the route boundary.
  - **Task 12 (adjustment reports)** DONE (#923, main `434b74668`, lane B item B12, 2026-09-30). A Reports screen in the
    adjustments module (`packages/adjustments/src/dashboard/adjustment-report-screen.ts`, under
    `report.view`) shows, for a range of business days, the cancellations, comps and discounts
    overall, per person and for guests: counts and amounts by action, by reason (grouped by reason,
    named as recorded) and by how far the dish had got (before firing, after firing, after serving,
    whole-bill), who approved each person's requests, the list value of cancelled items apart from
    what they took off, and each person's rate — what they took off ÷ the sales credited to them at
    their prices before any adjustment (plan D21). A person, the guests or everyone opens the list of
    single adjustments. Computed by `computeAdjustmentReport` and `listAdjustmentEntries`
    (`packages/adjustments/src/reports.ts`) behind `GET /management-api/adjustments/report` and
    `…/report/entries`; with no range asked for they answer the venue's current business day. A
    bill counts on the business day it was OPENED, for both its credited sales and its adjustments;
    lines on an abandoned bill are not sales. `requireRange` moved to `@waitron/server-kit` for
    both this route and `apps/server/src/report-api.ts`. A dashboard module can now contribute
    further screens beside its first (`moreScreens`, `packages/dashboard-kit/src/contract.ts`).
    Core migration `0051_opened_at_index` indexes `working_orders.opened_at`. **The upgrade was
    measured** on 2026-09-30 on `node:sqlite`, Node v26.7.0, with a throwaway Vitest file under
    `scripts/` (not committed): it migrated a scratch venue through core `0050`, inserted 20,000
    bills straight through `node:sqlite`, then ran `applyMigrations` again. That added
    `working_orders_opened_at_idx` and kept all 20,000 bills, in 16 ms on that run (a second run by
    the review, on a venue that also had its triggers installed, took 51 ms). **The report's three
    queries were measured** on 2026-09-30 on `node:sqlite`, Node v26.7.0, with a throwaway Vitest
    file (not committed) that seeded a scratch venue through `useVenueDb` with 8,000 bills, 24,000
    lines and 20,000 adjustments over September 2026 and ran each read seven times. `explain query
    plan` showed each of the three — the totals (`readReportRows`), the credited sales
    (`readCreditedSales`) and the list (`readEntryRows`: a first and a later page, for everyone and
    for one person) — reading the bills through `SEARCH working_orders USING INDEX
    working_orders_opened_at_idx`, and both adjustment reads sorting in a `USE TEMP B-TREE FOR
    ORDER BY`. The timings were taken on the development Mac (Apple M5 Pro, 64 GiB of memory).
    Over the whole month the medians were 125 ms for a `computeAdjustmentReport` call (the route
    around it was not timed), 32 ms for the list's first page and 29 ms for its 21st, and 20 ms for
    one person's page; over one day, 5 ms for `computeAdjustmentReport` and under 2 ms for any
    page. No index was added for the list. One on `adjustments (created_at, id)`, in that run,
    with no `ANALYZE` statistics, was not chosen by the planner: every plan stayed the same and
    every median within 2 ms. The same measuring run reported that with `ANALYZE` run in the
    scratch database the planner did use it, and the list's month pages took 1.46 ms and
    1.36 ms. Nothing in the product runs `ANALYZE`: `git grep -niw analyze` over `packages/`,
    `apps/`, `scripts/` and `deploy/` found nothing on 2026-09-30. One on `adjustments
    (requested_by, created_at, id)` was used for one person's page, and on a year of data (96,000
    bills, 240,000 adjustments) took that page from about 25 ms to 0.8 ms over the newest month,
    but from about 1 ms to about 39 ms over a single day. Added by the review fixes: the list of
    single adjustments comes one page at a time (200 by default, with a "Show more"
    button under the list; the route takes `limit` and `after` and answers `{ entries, next }`),
    and its person is chosen with `?personId=`. The open list is read again every 60 seconds and
    whenever any adjustment, bill, person or location in the venue changes. That read starts at
    the top and stops at the first page holding a row already on screen, reading at most 500 rows
    (the largest page): the new rows go on top, the rows it read again are shown as they now read,
    and the rows below them and the "Show more" position stay as they were, so rows loaded with
    "Show more" stay and a "Show more" on its way still adds its page. If 500 new rows come before
    any row on screen, or the list ends before reaching one, the list starts again from what it
    read and a "Show more" on its way is dropped. The cost: rows below those read again are not
    read again, so they keep an old name, or an old range after a change to the location's day
    cutover or time zone, until the list is opened again. A row that now sorts below the rows on
    screen (the server clock stepping back, two adjustments saved in the same millisecond, or a
    changed cutover or time zone) shows up through "Show more", or at once when there is no
    further page and the read reached the last row on screen; a list longer than one page with no
    further page shows it only when opened again. A new range or person starts from
    the first page. Choosing a person or the guests shows that person's own totals by action, by
    stage and by reason; otherwise the totals are everyone's.
    `@waitron/reporting` gained `validatedRangeWindow` (one call that checks a range's time zone,
    cutover and days and builds its window, used by top sellers, category sales, the VAT summary
    and this report) and `readLocationClock` (used by this report and the kitchen notices list).
    `formatIsoMinute` now lives in `@waitron/dashboard-kit`; `apps/dashboard/src/date-utils.ts`
    re-exports it for the app's screens and for main's `date-utils.test.ts`. A module screen may
    not reuse any screen id, built-in ones included (`CORE_SCREENS`,
    `apps/dashboard/src/dashboard-app.ts`). Left open:
    - A weighed item cancelled in part can differ by a cent between the cancel's list value and
      what stays on the line, so a rate can be a cent's share off. **Next action:** none unless
      someone sees it matter.
    - With no day picked, a screen left open past the day's cutover moves to the new, empty day;
      the date inputs show it, nothing announces it. **Next action:** decide whether it should
      keep the day it opened on.
  - **Task 14 landed as #721** (lane B item B14, landed by the owner 2026-09-27, main
    `ca5aa51dd`). The server lets a bill take several payments
    before its invoice (an amount, chosen items or an equal share; cash, a hand-keyed card or a card
    on a reader), issues the invoice in the same transaction that leaves the bill fully paid, gives
    money back before the invoice (a card refund keeps its record through an interrupted call), and
    the cash-up counts each payment and refund on the day and at the till where the money moved.
    No till screen calls these routes yet; Task 15 builds them. _(2026-09-30: lane B item B15 builds
    them; see the B15 entry below.)_ The questions it raised, and how
    each was ruled, are in lane B's questions log. With M7v landed (#720), the invoice issued at a
    bill's last payment files each line at the VAT rate recorded on it, however long the payments
    took. _(2026-09-27, A68: the line records its class, and that invoice takes the rate in force on
    the day it is issued.)_ The owner's rulings at landing (2026-09-27): a SumUp payment stuck mid-charge keeps its
    bill locked until SumUp answers (no "failed" after a time limit); a card arriving after cash
    paid the rest is refused `working_order.not_open`, and the resolve routes sit beside M7b2's,
    both accepted and recorded as dated corrections in the design by lane D item A76. Two follow-ups,
    both assigned to lane D before Task 15:
    - **A hand-keyed card payment can be refunded before the invoice** (lane D item B14a,
      owner's choice). Staff first give the money back on the separate terminal, then explicitly
      confirm the completed refund with a manager's PIN. The server records it on the bill and the
      manual payment in one transaction. Task 15 must put the terminal-refund instruction beside
      the manager-PIN confirmation on the till; the till has no bill-refund action yet.
      _(2026-09-30, B15: done — the till's refund of a hand-keyed card tells staff to give it back
      on the terminal first, then confirm with one supervisor's or manager's PIN.)_
    - **A bill receipt's payments keep the order they were taken in — DONE (A123, #886, 2026-09-29).**
      `bill-refunds.card.test.ts`'s invoice case ("design §8 test 23") printed the cash tender
      before the earlier card tender now and then (on B14a, and again on lane B's T5, #852).
      `readBillTenderLines` broke a tie on the millisecond timestamp with a random id, so two
      payments taken in the same millisecond, or two refunds completed in one, printed in a random
      order. It now breaks the tie by the order the rows were written (`rowid`). Guard: the two cases
      under "the receipt's payments, taken within one millisecond" in
      `apps/server/src/bill-payments.test.ts`, whose ids are
      made to sort against the taking order; each failed on every run with its half of the old
      tie-break restored (3 of 3 runs for refunds, 5 of 5 for payments).
      **The same random tie-break in four other places — DONE (A136, #919, 2026-09-30).** The review had
      found four more reads that broke a same-millisecond tie with a random UUID id (`newId` in
      `packages/db/src/schema/columns.ts`); each now breaks it by `rowid` too. Each guard below
      writes its rows with one timestamp and ids made to sort against the writing order. All four
      failed on 6 of 6 runs before the fix, and each failed alone, on each of 3 runs, with its own
      site's old tie-break put back:
      - `readPaymentRows` in `apps/server/src/bill-payments.ts` (a bill's payments). Guard: "shows
        the bill's payments in the order they were taken" in `apps/server/src/bill-payments.test.ts`.
      - `readPaymentsAndRefunds` in the same file (a payment's refunds). Guard: "shows a payment's
        refunds in the order they were asked for", same file.
      - `apps/server/src/payment-slip-print.ts` (the order card slips print). Guard: "prints the
        card slips in the order the cards were taken", same file.
      - `readTenderBlock` in `apps/server/src/till-sale.ts` (the one tender the till's on-screen
        ticket shows). Guard: "shows the tender taken first when two were taken in the same
        millisecond" in `apps/server/src/till-sale-tender-block.test.ts`.
      **OPEN:** A136's search found no other payment or refund read breaking a tie with an id, but
      several order by a timestamp with no tie-break at all, so which of two rows from one
      millisecond comes first is whatever order SQLite reads them in. A136's run-it review showed
      that order depends on the indexes: in a scratch copy of a migrated database, `payments` rows
      sharing one `created_at`, read with an unfiltered `order by created_at`, came back in the
      writing order, and in a different order once an index on `(created_at, id)` was added (an
      index the schema does not have). Whether any of
      these reads returns the wrong order today is not checked. They are `apps/server/src/payments-api.ts`
      (the stuck card payments: those still `attempting` on an open order marked in flight, before
      the route drops any a live attempt is still driving; and the pending bill payments and
      refunds), `apps/server/src/bill-payments-loop.ts` (pending bill payments and refunds), and
      `packages/payments/src/store.ts`: its lists of payments and refunds, and
      `selectCapturedForWorkingOrder`, which keeps the most recently settled of two captured or
      accepted-offline payments for one order, where the comment on
      `findCapturedPaymentForWorkingOrder` says "At most one captured payment per working order
      holds by construction, not by a constraint".
      **Next action:** write two rows with one timestamp through each read named here, with ids
      made to sort against the writing order, and add the `rowid` tie-break wherever the order can
      come back different.
    - **Dashboard recovery for a bill's unsettled card payment or refund is done** (lane D item
      B14b): the Payments screen (`apps/dashboard/src/screens/payments-screen.ts`) lists both kinds,
      can ask the provider to resolve one, and lets a manager record a provider-confirmed outcome
      with a note and their PIN. The screen has English and Spanish text and browser accessibility
      cases. Task 15 can build the till flow that creates bill payments. _(2026-09-30: lane B item
      B15 builds it.)_
  - **Task 15, several payments on the till, is built by lane B item B15** (2026-09-30, landed as
    #956, main `a426b948b`). A table's bill, or a retrieved counter order's, can be paid in parts:
    by items, an amount or an equal share, in cash (change or tip) or by card (keyed on a separate
    terminal, or on a card reader). The bill payment dialog lists the bill's payments and gives one
    back: given back by someone who may give refunds, or approved with a supervisor's or manager's
    PIN; a card keyed on a separate terminal always takes one PIN. A partly paid table bill shows
    what it still owes, "Paid so far" and a button opening the dialog; the counter shows "{amount}
    to pay" and "Take the rest" above the pay card. The ticket lists every payment. Server: `GET
    /api/refund-authorizers` and `BillPaymentView.entry`. Open:
    - **DONE — the till no longer tells staff to give the money back before a merge** (lane B
      item B19, 2026-09-30, landed as #958, main `1ff3c9bfb`; the owner's "Ok" to the
      recommendation). A merge, or a transfer
      between two existing bills, stays refused while either bill holds a pending or received
      payment, one given back in full included; splitting unpaid items onto a new bill is still
      allowed while what stays still covers what the bill has received
      (`bill.received_exceeds_total`). The message now says so, keeps "take the rest from the bill's payments", and keeps
      "give it back" only for finishing a table whose emptied bill still holds money. Of the three
      till actions that show this message (merge, transfer, finish table), that is the only one
      giving the money back unblocks. (2026-10-01, B22: Finish table now shows its own message,
      `table.finish_bill_holds_money`, and the shared text, shown only for merge and transfer, no
      longer has the finish-table sentence.) Guards: the merge and transfer cases for a bill whose
      only payment was given back in full, in `apps/server/src/party-bill-actions.test.ts`, and "will
      not abandon an emptied bill that still holds a tip, and finishes once it is given back" in
      `apps/server/src/parties.test.ts`.
    - **DONE — finishing a table whose bill owes nothing but still holds money gets its own till
      message** (lane B item B22, 2026-10-01, landed as #971, main `07ee8dd42`; the owner's "queue it" on B19's FYI). The till now
      picks the words by the action it sent, not by the code alone: a Finish table refused
      `bill.payments_received` says "A bill on this table owes nothing but still holds money. Give
      it back before finishing the table" (`table.finish_bill_holds_money` in
      `apps/till/src/i18n/strings.ts`), and a refused merge or transfer says B19's text without its
      finish-table sentence, ending "Take the rest from the bill's payments". The server and its
      error code are unchanged. The party's bills are read again after that refusal, and a refusal
      arriving after the waiter has opened another party says nothing. Guards: "says a bill owing
      nothing still holds money when Finish is refused for it, in its own words" and "a refusal of
      Finish for a bill still holding money, arriving late, says nothing on the other party" in
      `apps/till/src/till-app-parties.test.ts`; the merge and
      transfer cases for a bill holding money in `apps/till/src/till-app-bill-payments.test.ts`; the
      two wordings pinned in `apps/till/src/i18n/codes.test.ts` and
      `apps/till/src/i18n/strings.test.ts`.
    - **OPEN — the generic "received more than the bill" text also answers a comp or discount.**
      The till's `bill.received_exceeds_total` text (`apps/till/src/i18n/codes.ts`, "Move fewer
      items, or refund the difference first") is on `main`, and the adjustment dialog shows it
      when a comp or discount is refused for that code
      (`apps/till/src/widgets/adjustment-dialog.test.ts`, "shows %s in its own words"), where
      nothing is being moved. B15 gave a move and a line change their own texts
      (`bill.received_exceeds_total_excess`, `bill.received_exceeds_total_line_excess`) and left
      this one. No assertion on `main` pins its wording: at `3f013dd40` a `git grep` for its
      English and Spanish sentences finds them only in `codes.ts`, and the two till suites that name
      the code (`codes.test.ts`, `adjustment-dialog.test.ts`) check only that it differs from the
      generic server text, that it names no identifier, and that the dialog shows what
      `codeMessage` gives. **Next action:** word it so it
      also fits a comp or discount.
    - **OPEN, owner call on wording:** the table's button is labelled with the whole sentence "Part
      of this bill is already paid: take the rest as a bill payment", while the counter's says
      "Take the rest". Left as it is.
    - Giving money back after the invoice stays out of scope for `BillPaymentView` (bill payments
      design §6).
  - **A keydown guard that cancels Escape while a save runs did not keep one dialog open.** Measured
    on Task 1's reasons screen (`packages/adjustments/src/dashboard/reasons-screen.ts`): a real
    Escape pressed with Vitest's `userEvent` during a save closed the editor, although the screen's
    keydown handler called `preventDefault()` and `stopPropagation()` on Escape while busy. The name
    field was focused before the save and is disabled during it, so where focus was when the key
    arrived was not recorded. That screen's `wt-close` handler closed the editor without checking
    whether a save was running. It now sets `wt-modal`'s `dismissible` to false while busy instead.
    _(Task 8, 2026-09-28: `dismissible` held for one Escape only until `wt-dialog` set
    `closedby="none"` while `dismissible` is off (drafts-on-the-till branch, 2026-09-28). Measured
    on a plain `<dialog>` in Playwright's Chromium 153 and WebKit (Safari 26.6): a second Escape's
    `cancel` arrived uncancelable and closed it. Deduced from that measurement, not run on this
    screen: the reasons editor's guard held for one press, and because `wt-modal` extends
    `wt-dialog` it now holds through repeated presses. Whether the same browser behaviour — a later
    Escape's `cancel` arriving uncancelable — explains the close recorded above, a single Escape
    pressed under the keydown guard before the screen used `dismissible`, has not been tested.)_
    The same keydown guard is on other dashboard forms. The tests of six of them press a real Escape
    during a save and pass with the dialog still open: "keeps the editor open when Escape is pressed
    during a save" (`apps/dashboard/src/widgets/category-form.test.ts`), "saves once and stays open
    against Escape while a save is in flight" (`apps/dashboard/src/screens/labels-panel.test.ts`,
    deleted with product labels on 2026-09-30),
    the three "keeps the … open against Escape" cases in
    `apps/dashboard/src/screens/categories-screen.test.ts` (retired by product-folders slice 1
    on 2026-10-01), "holds the draft open and unchanged
    while a save is in flight" (`apps/dashboard/src/widgets/content-languages.test.ts`), "ignores
    Escape while a save is in flight and honours it once the save has settled"
    (`packages/media/src/dashboard/image-library.test.ts`) and "stays open on Escape while a save is
    still pending" (`packages/venue-service/src/dashboard/venue-operations-screen.test.ts`). The
    first five forms' `wt-close` handlers also ignore a close while busy, so their tests do not show
    the keydown guard holding on its own. The venue operations screen's `wt-close` handler has no
    such check and the screen does not set `dismissible`; its test focuses the dialog's body, not a
    field, before the key. The rest were tried only with a hand-built `KeyboardEvent` dispatched on
    the dialog (`sections-screen`, `modifiers-screen`, `add-to-menus`, `extra-list-form`,
    `option-list-form`, `option-label-form`, `variant-form` and `menu-prices-table`, under
    `apps/dashboard/src`) or not
    at all (`#guardEscape` in `apps/dashboard/src/screens/menus-screen.ts`). Why the reasons screen
    behaved differently has not been established. **Next action:** repeat the reasons-screen case
    recording which element has focus just before the Escape; then press a real Escape during a save
    on each form tried only with a hand-built event or not at all, and move the ones that close to
    `dismissible`.
  - **Tasks left: 16 and 17** (2026-09-30; 10 to 14 have landed, and Task 15, the till side of
    Task 14, is built by lane B item B15). The menus tasks that change the same order and till code
    have all landed (M9, the last, as #729 on 2026-09-27), so nothing on lane C blocks them now. The
    plan's order among them: 16 after 10.
  - **Task 17** (unpaid departure) also waits for asesor Q28.
  - **Asesor questions to send:**
    [Q27](compliance/asesor-questions.md#q27-money-taken-against-a-bill-before-its-invoice-exists-then-a-split-added-2026-09-26)
    (money before the invoice, then a split; printing the invoice first),
    [Q28](compliance/asesor-questions.md#q28-a-table-leaves-without-paying--is-the-invoice-still-owed-added-2026-09-26)
    (unpaid departure) and
    [Q29](compliance/asesor-questions.md#q29-how-a-discount-or-comp-appears-on-a-simplified-invoice-added-2026-09-26)
    (how a discount or comp appears on the invoice). Q19 stays open.

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
  [plan](superpowers/plans/2026-09-28-table-actions.md); Task 13 landed as #897, so the service
  plan's B10 onward may start.
  - **Task 1 DONE (#816, 2026-09-28):** "visit" renamed "party" in the
    code, the tables (`parties`, `party_tables`, the `party_id` columns, core migration `0036`), the
    routes (`/api/parties/...`) and the error codes (`party.*`, `tab.party_mismatch`,
    `tab.party_has_other_open_bill`, `group.held_leaves_party`), with no behaviour change. The four
    `visits_*_ck` CHECK names and the stored scope value `'visit'` stay until Task 13 (done there:
    `parties_*_ck`, `'party'`). Left as it
    is (no backwards-compatibility code before a venue is live, CLAUDE.md §3): a till command
    recorded before `0036` and retried after it with the same submission id is refused
    `submission.id_reused`, because the stored fingerprint was taken over argument names that
    included `visitId` (found by #816's Codex review). Only a dev venue, on a retry that straddles
    the upgrade, can meet it.
  - **Task 2 landed as #825 (2026-09-28, main `6be030578`): a party names its main bill, and new
    orders go to it.** What changes for a person using the till:
    - A party's next order after its main bill is paid, presented or abandoned starts a new main
      bill. Before, after payment or abandonment. No till screen presents a party's bill until
      Task 7, so the difference cannot be met from the till today.
    - A round can be sent to another open bill of the same party, such as a split check: the
      groups route and the draft-submit route take an optional `billId`. The till sends none yet;
      Task 10 offers it. _(2026-09-29, Task 10: done — the till sends `billId` from the preview's
      Send to choice.)_ With `billId` a held round can now be sent straight to a party's split
      check (the groups route accepts `release: "hold"` naming one,
      `apps/server/src/till-api.groups.test.ts`), which the owner's 2026-09-26 ruling
      (`tab.split_held_line`) covered only for splitting. **DECIDED (owner, 2026-09-29):** a held
      round sent to a split check is allowed, as landed.
    - The server now accepts line changes on a party's split bill. The seven call sites of
      `assertAnchoredTabOpen` in `apps/server/src/working-order.ts` (send, recall, a round, void, a
      line's course, moving lines between bills, and splitting) call `assertPartyBillOpen` instead.
      The moving site serves both `transferLines` and un-joining a table with items. _(2026-09-30,
      Task 13: the moving and splitting sites are deleted with `transferLines`, `unjoinTable` and
      `splitOffCheck`; `assertPartyBillOpen` is now called in `sendLines`, `recallLines`,
      `priceTabRound`, `voidTabLine` and `setLineCourse`.)_ _(2026-09-30, B11a: `voidTabLine` is
      deleted; a cancel's check is now in `applyAdjustment`.)_ The round
      site serves `addTabRound`; `placeGroups` skips it, because the bill it chose has already
      been checked open and the party's. `assertPartyBillOpen` lets through an open
      bill that belongs to a party, whether or not a table points at it. An open order of no
      party that no table points at is still refused `tab.not_open`. Tests cover a void and a
      round on a split bill.
    - A party can be given a name (`PUT /api/parties/:id/name`). The floor read carries `name`,
      `mainBillId` and `displayName` for each party; `displayName` is the name, or else the
      party's tables' labels. No till screen uses them yet.

    New codes, each 409 and named in English and Spanish on the till: `bill.presented`,
    `bill.paid` and `bill.other_party`, for an order naming a presented bill, a paid bill or
    another party's bill. Migrations: core `0037_party_main_bill` adds the two `parties` columns
    `name` and `main_bill_id`, and `0038_main_bill_release` adds two triggers on
    `working_orders`. They clear a party's main bill when that bill stops being open, or when it
    leaves the party (to another party or, since Task 7, to the counter). Nothing is rebuilt.

    Upgrade measured 2026-09-28. A scratch venue in `/tmp` was migrated and seeded on main
    `e15dcb6d0` with its own code: a party with an open tab holding a dish, a party whose tab was
    paid, a party with a split check, and two joined tables. It was then migrated to the branch
    in one go through `applyMigrations`. Every row was kept, and the only row change was two more
    rows in `__drizzle_migrations_db`. Counted from `sqlite_master` without SQLite's own
    `sqlite_` entries, tables stayed at 149 and indexes at 155, and triggers went from 72 to 74.
    The only schema changes were the two triggers and the two columns.
    `pragma foreign_key_check` found nothing. Every party's `main_bill_id` read null (no data
    migration, CLAUDE.md §3). The branch's `placeGroups` was then called for each party:
    - The party whose tab was paid got a new main bill, and its table now pointed at that bill,
      as before the change.
    - A party whose tab was still open did NOT order onto that tab. Its dish went onto a new,
      second open bill, which became the main bill. Its table still pointed at the old tab, and
      the floor read still showed the old tab with its one dish, with `billCount` 2. The party's
      bills listed both as open and unpaid. A second order went onto the same new bill.
    - The same happened to the party with a split check (three open bills) and to the joined
      tables, both of which still showed the old tab. An order naming the split check went onto
      the check.

    So a party seated before the upgrade and ordering after it has two bills to pay. After Send,
    the till moves to the bill the order went on (`#followDraft`, `apps/till/src/till-app.ts`).
    Opening the table again from the floor shows the old tab, and the new order is listed only
    among the party's bills. That part was read from the till's code, not run. Only a dev venue
    can meet it; `wa-wt reset demo <name>` gives a clean one. The server was not booted on the
    upgraded venue.

    Tests moved or changed, and the decision behind each:
    - The "pay, then order dessert" block moved from `apps/server/src/parties.test.ts` to
      `apps/server/src/party-main-bill.test.ts`. Its rounds go through `placeGroups`, because
      `addTabRound` no longer opens a next bill (plan Task 2 Step 4). In that block, naming a
      paid bill now answers `bill.paid` where it answered `tab.not_open` (P5, and P3's order).
      "refuses a round sent to the settled tab of a finished party" became "refuses a round for
      a finished party", answering `party.not_open` (P4).
    - Four other `parties.test.ts` cases send their next round through `placeGroups` instead of
      `addTabRound` on the paid tab, with their assertions unchanged (plan Task 2 Step 4). They
      are "keeps both tables seated after payment, and a dessert round lands on the same party for
      both", "joins Mesa 5, and the next round opens the party's next tab on both tables",
      "refuses moving or joining with a settled tab the party has moved on from", and "points only
      Mesa 4 at the next tab when a round follows the paid tab". _(2026-09-30, Task 13: the last
      two are deleted.)_
    - `apps/server/src/order-groups.test.ts` "refuses a submission when the party's tables point
      at no tab" is retired. "puts a submission on the party's main bill even when its tables
      point at no tab" replaces it (spec decision 15, P4). _(2026-09-30, Task 13: deleted, with the
      table's pointer to its bill.)_
    - The cases the plan expected to retire as pinning a split bill as second-class (spec §3, P5)
      still pass and are unchanged, one of them renamed. "refuses a DETACHED CHECK as the split
      origin", now "refuses a check of no party as the split origin (tab.not_open)", uses a check
      that belongs to no party, and "refuses a round sent to the check, and opens no next tab"
      uses a check that is paid. _(2026-09-30, Task 13: both are deleted.)_
  - **Task 6 DONE (#818, 2026-09-28):** collecting a presented bill
    settles the sale already recorded for it, and issues one only when there is none; it no longer
    reads the zone's service mode (`collectOrder`, `apps/server/src/till-sale.ts`). A bill placed in
    an invoice-first zone and moved to a pay-first zone is settled with its one invoice, and the
    reverse issues one; before the change the first was refused by `sales_working_order_id_key` and
    the second threw "has no sale" (`apps/server/src/collect-by-invoice.test.ts`).
    Two points #818's review raised, not changed there:
    - **DONE (C50, #847, 2026-09-29):** collecting a bill whose invoice carries a corrective invoice now
      settles at what the customer owes, the invoice total plus its corrections. New cases in
      `apps/server/src/collect-by-invoice.test.ts` issue an invoice-first bill for 18.00, correct it
      by -2.42 through `recordCorrection`, then collect it in cash and by manual card. On the old
      code both were refused with `sale.tender_shortfall` (due 15.58, charged 18.00). `collectOrder`
      now reads the amount due through `readOutstandingSaleForOrder`, as the card-reader path does,
      and the manual card's `payments` row records that amount too.
      Left OPEN by C50. No product route records a corrective invoice today (R5, above), and none of
      the three scripts that call `recordCorrection` collects through `collectOrder` or pays
      through `payWorkingOrderIntegrated`, so today only the new cases in
      `apps/server/src/collect-by-invoice.test.ts`, and on the card-reader path new cases in
      `apps/server/src/till-sale-integrated.db.test.ts`, collect a corrected bill.
      - **The ticket still shows the original invoice total.** `collectOrder` queues no receipt on
        this path, only the cash drawer job (read, not run: the receipt is queued at placing by
        `placeOrder`, `apps/server/src/working-order.ts`), and for a bill that owes nothing it
        queues neither (C59). The ticket `collectOrder` returns to the
        till's screen, the original receipt that screen offers when the till's own order flow is not
        invoice-first (`#showTicket`, `apps/till/src/till-app.ts`), and any reprint are all built by
        `readSettledTicket` (`apps/server/src/till-sale.ts`) and show the invoice's original total.
        Since C67 (below) this covers the card-reader payment too: on a bill that owes nothing,
        `payWorkingOrderIntegrated` returns a `readSettledTicket` ticket carrying the invoice's
        original total, which the till shows (the till's handling read, not run: the `captured`
        branch in `apps/till/src/till-app.ts`).
        The printed receipt and the screen both give the cash line as total plus change
        (`apps/server/src/receipt-ticket.ts:270`, `apps/till/src/screens/till-ticket-view.ts:105`;
        the screen's line read, not run), so it overstates what was handed over. The review's Codex
        probe of 2026-09-29, run on the earlier fixture (15.80 due, 20.00 handed over), had
        `formatReceipt` print `TOTAL 18,00`, `Efectivo 22,20` and `Cambio 4,20`. **PARKED (owner,
        2026-09-29)** until the product can issue a corrective invoice; the owner's points for that
        design are on the corrective-invoice entry (R5, above).
      - **DONE (C59, #849, 2026-09-29): a bill corrected to zero is collected in cash or by manual card,
        and closes.** The owner's
        answer (2026-09-29): "yes just close the bill". When corrections bring the amount due to
        zero, `collectOrder` (`apps/server/src/till-sale.ts`) settles the sale with no tender row,
        and writes no manual card `payments` row and no cash drawer opening, since no money changes
        hands. The bill becomes `settled` with its `collected_at` stamped, as an ordinary
        collection does, and no second fiscal record is filed. The ticket it returns has the tender
        `{ method: "unpaid" }`, which the till's ticket screen shows as no payment line
        (`apps/till/src/screens/till-ticket-view.ts:100`; pinned by the case "renders no tender
        extras for an invoice issued before payment" in
        `apps/till/src/screens/till-ticket-view.test.ts`, run 2026-09-29, passed). New cases in
        `apps/server/src/collect-by-invoice.test.ts` correct the 18.00 bill by -18.00 and collect
        it in cash and by manual card; both failed with `CHECK constraint failed:
        tenders_amount_ck` before the change. A control case shows an ordinary cash collection of
        a corrected bill does open the drawer.
        **DONE (C66, #922, 2026-09-30): a negative correction that would take an invoice below zero is
        refused when it is recorded.** The owner's answer (2026-09-30): refuse it, in place of
        paying the difference back at collection. `recordCorrection`
        (`packages/core/src/record-correction.ts`) adds the invoice's total, the corrections
        already recorded against it and this correction, and refuses a NEGATIVE correction that
        would take the sum below zero with `sale.correction_exceeds_total` (params: the invoice,
        what is left on it, and the correction as the rounded amount the row would store). The
        sum is taken at the cent amount the row stores: `stringToCents` rounds a third decimal
        place half away from zero, so -14.414 against 14.41 records and -14.415 is refused. A
        correction to exactly zero records. Any positive correction passes this check, including
        one of a credit note that is already below zero; whether it records is the fiscal
        backend's call, and only the `none` backend records a correction of a credit note
        (Veri\*Factu refuses one with `fiscal.correction_unsupported`,
        `packages/fiscal-verifactu/src/backend.ts`). The check runs after the permission check, so
        a person who may not correct is not told the invoice's amounts, and before an invoice
        number is allocated. The -20.00-on-18.00 case in
        `apps/server/src/collect-by-invoice.test.ts` is now that refusal, and the bill then
        collects its full 18.00. Probes, each applied alone to the new check, against the cases in
        `packages/core/src/record-correction.test.ts` and that server case: deleting the check
        failed the one-cent-over, over-after-an-earlier-correction, rounds-to-one-cent-more,
        negative-correction-of-a-credit-note and refused-before-numbering cases and the server
        case; moving it before the permission check failed the unauthorised-session case;
        widening `< 0` to `<= 0` failed the exactly-zero and rounds-to-exactly cases, and every
        case whose setup fully reverses an invoice (the raise-from-zero and both credit-note cases
        among them); comparing the raw input instead of the cent amount, with the reported
        correction left as the cent amount, failed only the rounds-to-exactly case, refused with
        `sale.correction_exceeds_total`; dropping the "is negative" condition failed the
        positive-correction-of-a-credit-note case; and allocating the number before the check
        failed the refused-before-numbering case. No probe made the check refuse a raise itself,
        so the raise-from-zero case is the control that the check does not refuse too much.
        `settleSale`'s refusal when the tenders do not match the amount due
        (`sale.tender_shortfall`, `packages/core/src/settle-sale.ts`), which `collectOrder`
        reaches with no tender on a bill below zero, stays; the case "refuses to close a bill
        already corrected below zero, with the domain code, and leaves it open" in
        `apps/server/src/collect-by-invoice.test.ts` inserts a -20.00 corrective row straight into
        `sales`, and failed with that check deleted.
        **DONE (C67, #925, 2026-09-30): the card-reader path closes a bill that owes nothing without
        asking the reader.** `payWorkingOrderIntegrated` (`apps/server/src/till-sale.ts`) now
        settles a bill with a sale whose corrections leave nothing owed the way `collectOrder` does,
        through one shared step (`settleOwingNothing`): no tender, no `payments` row, the bill
        `settled` with `collected_at` stamped, and the ticket's tender `{ method: "unpaid" }`. A
        well-formed tip sent with the request is not charged, since the reader is never asked; a
        malformed one is still refused with `shared.invalid_decimal` when tips are on, as before
        the change. A malformed cash amount on such a bill is still refused by `collectOrder` with
        `shared.invalid_decimal`, as before the change (case in
        `apps/server/src/collect-by-invoice.test.ts`). A bill below zero is refused with
        `sale.tender_shortfall`, as `collectOrder` refuses it, and stays placed. New cases in
        `apps/server/src/till-sale-integrated.db.test.ts` drive the Stripe provider over its fake
        HTTP client; the bill-request one sits in the describe "a party's bill request goes when a
        card or collect settles its last owing bill". Before the change the zero case asked the
        reader to charge 0.30 (the tip alone on a 0.00 bill), and the below-zero case failed with
        `CHECK constraint failed` on the provider's `payments` row for -0.50. For a bill corrected
        to exactly zero, the review's Codex probe of 2026-09-30 (not a committed test) showed a
        captured card payment with no sale still takes the recovery branch first, settling at the
        captured amount with all of it recorded as tip; the below-zero case with a capture was not
        run. The branch for an order with no sale yet was not run with a zero total.
        **DONE (A144, #929, 2026-09-30): a correction is filed at the cent amounts its rows store.**
        Measured first, with a new suite that drives core's `recordCorrection` through the real
        Veri\*Factu backend (`packages/fiscal-verifactu/src/correction-amount.huella.test.ts`). On
        the code before the change, the TOTAL was not the problem there: a -1.005 correction was
        stored as -101 cents and filed as "-1.01", because the Veri\*Factu library rounds every
        amount it files to two places, half away from zero, by itself (`formatAmountExact`,
        `@waitron/verifactu` 0.1.0). Core's fake backend did store the "-1.005" it was handed. The
        real gap was the VAT breakdown, built from the lines as typed: a -0.045 line at 10% was
        stored as -5 cents, but `sales.vat_breakdown` held base "-0.045" and tax "0.00", and the
        record was filed with base "-0.05", tax "0.00" and a hashed `cuota_total` of "0.00", where
        10% of the stored -0.05 is -0.005, which rounds to -0.01. Two -0.005 lines at 21% were
        stored as -1 cent each but filed with a base of "-0.01", the typed sum -0.010 rounded,
        where the rows hold -0.02 (the base is not hashed). The choice was to round rather than
        refuse: C66's case "records a correction whose total rounds to exactly what is left on the
        invoice" requires a -14.414 correction to record as -14.41, and an ordinary sale's row
        stores its total rounded to the cent too. Now `recordCorrection` works out the total's
        cents once and uses that one amount for the "more than is left" check, the row and the
        backend, and builds the breakdown from each line's stored cent amount. So the -0.045 line
        is filed as base -0.05, tax -0.01 and `cuota_total` -0.01 (its huella changes with it), and
        the two -0.005 lines as base -0.02. A two-decimal correction (-1.00, one -0.83 line at 21%)
        files the same huella as before; that literal was captured on the old code. A whole-cent
        amount not written with exactly two decimal places (such as "-10" or "-1.000") keeps its
        value but changes its text: as a line total it now reaches `sales.vat_breakdown` and the
        backend's breakdown as a two-place base ("-10.00"), and as a total it reaches the backend
        as "-10.00", because `centsToDecimal` always renders two places, where `decimal()` and
        `addDecimal` kept the typed scale. Its rate and tax are unchanged, and so is the filed
        record, because `@waitron/verifactu` formats every amount it files to two places. Tests:
        the four cases in the new suite, and "hands the backend the cent amounts the rows store,
        not the amounts as typed" in `packages/core/src/record-correction.test.ts`. Deletion
        probes: handing the backend the typed total again failed only that core case (the
        Veri\*Factu suite stayed green, since the library rounds the total itself); building the
        breakdown from the typed lines again failed that core case and the new suite's two cases
        about a derived tax and a summed base. `write-path.e2e.test.ts`, `inmutabilidad`,
        `correction-path.e2e.test.ts` and the rest of `record-correction.test.ts` passed unedited.
        **Checked (A148, 2026-09-30): no product path hands an ordinary sale or a substitution a
        third decimal place, so nothing was changed.** `recordSale`
        (`packages/core/src/record-sale.ts`) and `recordSubstitution`
        (`packages/core/src/record-substitution.ts`) still store the total rounded to the cent and
        hand the backend the total as given. A grep for `recordSubstitution` outside test files
        finds no caller beyond the fiscal backends and core's own export. A grep for `recordSale(`
        outside test files finds five product calls in `apps/server/src` (three in `till-sale.ts`,
        one each in `bill-payments.ts` and `working-order.ts`), each passing the `total`, `lines`
        and `vatBreakdown` that `issueMoment` gets from `rateLines`
        (`packages/catalogue/src/pricing.ts`), plus `fiscal-readiness-runner.ts`, which passes
        two-place literals. Every gross line `rateLines` is given in `apps/server/src` comes from
        `grossBasketWithOptions` or `grossLockedLines`, both built by `grossRows`, which rounds
        each line's gross to the cent; each base is divided out at two places and each
        tax is gross less base. Two probes, not committed: (1) every weighed quantity from 0.001 to
        3.000 kg at seven prices and three VAT classes, priced alone, beside a second weighed line,
        and with a three-times option: 189,000 baskets, none with an amount past two places, an
        amount that changed on a round trip through cents, or a breakdown not summing to the
        total. The control, a hand-built gross line of 8.2917 fed to `rateLines`, was reported.
        (2) A 0.333 kg sale at 24.90/kg (8.2917 before rounding) plus one 1.50 item through
        `POST /api/sales` with the Veri\*Factu backend, in the harness of
        `apps/server/src/till-api.fiscal-sale-paths.test.ts`: the backend was handed a total of
        9.79 with bases 7.54 and 1.24, the row stored 979 cents with line totals of 754 and 124,
        and the record filed `importe_total` 9.79 and `cuota_total` 1.01. The shape would matter
        only for a new caller that builds its amounts some other way, and nothing guards against
        one. The demo scripts under `apps/server/scripts` were not checked.
    - In the till's table screen, the check that treats an unreadable reminder time as "never due"
      (`#reminderDueAt`, `apps/till/src/screens/till-table-order-screen.ts`) has no test of its own:
      the review removed it and no test failed. **Next action:** a case with a malformed `dueAt`.
  - **Task 4 DONE (#832, 2026-09-29): kitchen slips, the pass, receipts and the overdue
    report name all of a party's tables.** What changes for a person:
    - A joined party's kitchen slips, pass cards and overdue-report rows read "Mesa 4, 5" (the
      tables in the order they joined, `partyTablesName`), where they read the table with the
      lowest id. A bill split off the tab names the party's tables too, not the label it was split
      with. When a bill is split off, the new bill's own label is set to the party's tables
      (`orderTableLabel`), not to the receipt label with the party's name; paying a bill later
      replaces its label (see the open point below). Once a party holds no table, its bills fall
      back to their own label.
    - A party's receipt and payment slip read "Ana · Mesa 4, 5" for a named party and "Mesa 4, 5"
      for an unnamed one (`partyReceiptLabel`). A receipt already issued keeps the label frozen at
      issuance. A counter order still names its delivery table.
    - Joining, unjoining and moving a table, and merging tabs, send a MOVED notice and slip for
      the sent dishes on every open, placed or settled bill of the parties involved whose tables
      changed (`readPartiesSentWork`, `enqueueMovedSlipsFor` in
      `apps/server/src/kitchen-print.ts`). Before, a join sent none, and a move, unjoin or merge
      compared only the bill acted on.
      Moving lines between bills and transferring lines keep their one-bill comparison.
    - A table's bill that belongs to no party keeps the old rule: the lowest-id table seated at
      it, and no notice on a join. Outside tests, `openTab`'s one caller is `seatTable`, which
      opens the tab on a new party. Whether a tab of no party can reach a join in production is
      not established: `moveTab` of an open parked order onto a table is an unchecked path to one.
      _(2026-09-29, table actions Task 11: the till no longer calls `moveTab` or `joinTable`; the routes stay until Task 13.)_ _(2026-09-29, table actions Task 13: the routes and `moveTab`, `joinTable`, `mergeTabs`, `transferLines` and `unjoinTable` are deleted, and `dining_tables.tab_id` is dropped, so a bill reaches a table only through its party or, for a counter order, `delivery_table_id`.)_
    Tests changed by spec decision 9: `apps/server/src/print-problems.test.ts` "follows the held
    dishes when their bill is merged into another table's, and clears by that bill's reprint"
    matched one table in the reprint header and now matches the party's two.
    `apps/server/src/order-groups.test.ts` "takes a fired-group line to the table's own new bill
    on an unjoin with no group, and prints the MOVED slip" expected one new print job; it now
    expects two, the taken dish's MOVED slip and one for the beer left on the tab, whose tables
    went from two to one (spec §8).
    Left open:
    - At 390 px a pass card whose label wraps also wraps its "2 min" onto two lines (seen with a
      seven-table label, `apps/till/src/screens/till-expo-screen.ts`); nothing overflows.
    - Paying a named party's bill freezes its receipt label, "Ana · Mesa 4, 5", into
      `working_orders.label` in the same update that sets the bill `settled` (`readReceiptOrder`
      at issuance, in `apps/server/src/till-sale.ts` and `apps/server/src/bill-payments.ts`), so
      reprints match. Kept on purpose (spec §8: receipts show the name). `placeOrder`
      (`apps/server/src/working-order.ts`) writes the receipt label too when it places an order
      whose service mode is `invoice_first`. By reading, not tested: a party seated at a table
      with no zone, in a venue whose order flow is `invoice_first`, appears to have its bill
      placed invoice-first and its label written at placing — `openTab` checks the service mode
      only for a table in a zone, and `placeOrder` then falls back to the location's order flow.
      Its one caller outside tests, the till's `/api/working-orders/:id/place` route
      (`apps/server/src/till-api.ts`), adds no party check. In the review's probe (a party at Mesa 4
      joins Mesa 5, is named Ana, orders and pays cash) the bill went from `["open", null]` to
      `["settled", "Ana · Mesa 4, 5"]`. Of the readers of that column checked, these can meet a
      paid bill and then show the party's name with its tables: the station queue card (`listStationQueue`,
      `apps/server/src/working-order.ts`), which shows no table name before payment and
      "Ana · Mesa 4, 5" after it; the order label on kitchen notices recorded afterwards
      ("#N · label", `recordKitchenNotices`, `packages/venue-service/src/kitchen-notices.ts`);
      the till's list of a party's bills (`readBillsOfParties`, `apps/server/src/parties.ts`);
      `orderTableLabel`'s fallback once the party holds no table (slips and the pass); and the
      overdue report's own fallback to the order's label (`computeOverdueOrders`,
      `packages/reporting/src/overdue-orders.ts`). _(2026-09-30, C86: the overdue report no longer
      has its own; it calls `orderTableLabels`, the same fallback as the slips and the pass.)_ Not
      yet checked: the payment API's
      `/management-api/payments/stuck`, `/management-api/payments/bill-payments` and
      `/management-api/payments/bill-refunds` queries (`apps/server/src/payments-api.ts`), which
      read the same column. **DECIDED (owner, 2026-09-29): leave it** — after payment the
      station queue card, later kitchen notices and the till's list of a party's bills keep
      showing the receipt label with the party's name, rather than reading the tables alone.
  - **Task 3 DONE (#844, 2026-09-29, main `6736159a2`): a table needs clearing, not its
    party.** What changes for a person using the till:
    - Finish closes the party at once. Where the venue's clearing setting is on, each of its tables
      then reads "Needs clearing" on the floor with no party on it, and Mark cleared frees that one
      table (`POST /api/tables/:id/cleared`, which answers 204 even for a table that needs nothing,
      and `table.not_found` for an unknown one). With the setting off, Finish frees the tables at
      once, as before. The per-party `POST /api/parties/:id/cleared` is gone.
    - Seating, moving to or joining a table that needs clearing is refused `table.needs_clearing`
      (409, including the bookings seat route; named `table.needs_cleaning` until C60), where
      seating one was refused `tab.already_open`.
      The till's Move and Join table picker no longer offers such a table, and the floor map no
      longer paints it with the free colour.
    - Core migration `0039_table_needs_cleaning` adds `dining_tables.needs_cleaning_since`, which
      core `0041_table_needs_clearing` renames `needs_clearing_since` (C60); the configuration
      export leaves it out, like `tab_id`. The party state `needs_clearing` is no longer written;
      Task 13 drops it from the schema, and the table condition of the same name stays. _(Task 13:
      done; `parties_state_ck` now allows `open` and `closed` only.)_
    - Upgrade, measured on a scratch venue seeded by the previous `main`: every row kept, only
      `dining_tables` and its change-feed trigger changed, `foreign_key_check` empty. **A dev venue
      holding a party already in `needs_clearing` keeps that party's tables held, and nothing on
      this branch frees them** (Finish answers `party.not_open`, seating `tab.already_open`, Mark
      cleared changes nothing). `wa-wt reset demo <name>` gives a clean venue; no data migration
      (CLAUDE.md §3).
    Raised by #844's review and not changed there:
    - A stale Mark cleared can free a table a LATER party has left: party A finishes and its table
      is cleared, party B sits and finishes, and a second clear from a floor screen that had not
      refreshed removes B's mark (reproduced by the Codex review). Clearing takes no revision by the
      plan's P9. **DECIDED (owner, 2026-09-29): (a), keep the plan's P9** — a stale Mark cleared
      is accepted, and nothing changes.
    - **DONE (C60, #855, 2026-09-29): the new names say "clearing", like the older ones**
      (`clearing_workflow`, "Mark cleared", the till's "Needs clearing"), by the owner's choice.
      `table.needs_cleaning` is now `table.needs_clearing`, `dining_tables.needs_cleaning_since` is
      `needs_clearing_since` (core migration `0041_table_needs_clearing`, one
      `ALTER TABLE … RENAME COLUMN`), the table condition the till reads is `needs_clearing`, and
      `leaveForCleaning` is `leaveForClearing`. What staff read did not change: the English and
      Spanish sentences already said "needs clearing" / "por recoger". Upgrade, measured with the
      product's `applyMigrations` on a scratch venue migrated to core `0040`, holding one table
      with `needs_cleaning_since` set, then migrated to `0041`: the column read
      `needs_clearing_since` and kept the value. Tasks 7–13 of the plan use the new names.
  - **Task 5 DONE (#852, 2026-09-29): split, merge and transfer between a party's bills,
    on the server.** Nothing changes on the till yet: it keeps using the old tab routes until
    Task 10. Three new routes land beside them (`apps/server/src/bill-actions.ts`,
    `apps/server/src/till-api.ts`):
    - `POST /api/bills/:id/split` puts chosen items on a new bill of the same party, from any open
      bill, including one no table points at and a counter order (whose new bill has no party). A
      presented bill is refused `bill.presented`, a paid one `bill.paid`; items already paid for
      stay (`bill.line_paid`); held work stays (`tab.split_held_line`; _2026-10-01, B20: a dish in a
      held group may now be split, keeping its group — see the B20 notes beside "held kitchen work
      cannot be split onto a check" above_). A split that leaves the source fully paid issues its
      invoice, as the tab split does.
    - `POST /api/bills/:id/merge` (the path is the bill merged into) and
      `POST /api/bills/:id/transfer` (the path is the bill the items leave) work only between two
      untouched bills of one party: neither presented, partly paid, paid, nor holding a payment
      given back in full (`bill.presented`, `bill.payments_received`, `bill.paid`). Bills of two
      parties, or a party's bill and a counter order, are `bill.other_party`. Merging the main bill
      away makes the surviving bill the main bill; no table joins or leaves the party.
    - For a bill of a party, each checks and moves on the party's revision before looking at the
      bills' own state, so the second of two tills acting from the same read is told
      `party.out_of_date`, not a code describing what the first till did. Checked before the
      revision: whether the path bill exists, a merge or transfer onto the same bill, and for split
      an empty or repeated batch of items. Transfer checks for repeated items after the bills and,
      like the old tab transfer, does not refuse an empty batch. _(2026-09-29, Task 10: it now
      does, with `sale.empty_basket`, before the revision.)_ A counter order has no party and so
      no revision. A till may also
      send `partyId`, the party it read the bill under; a bill that has since left that party is
      `party.out_of_date`.
    - Merging bills, or transferring items between them, sends the kitchen no MOVED slip while
      the party holds a table: every bill of such a party names the same tables
      (`orderTableLabels`), and `enqueueMovedSlips` sends a slip only when the tables named change
      (unless its caller forces one, as the bill move does to or from the counter; Task 7).
      The party-wide notices in the Task 4 entry above are for merging tabs.
    Tests: `apps/server/src/party-bill-actions.test.ts` (each refusal reads back that the party,
    its tables, and each bill's row, lines and payments are unchanged; the two-tills cases run in
    both orders, except the two `partyId` cases, which run once each) and
    `apps/server/src/till-api.bill-actions.test.ts` (the HTTP surface). No new error code, no
    migration.
    Found while building it, and handled:
    - A dish in a held group that the kitchen has no ticket for (a product with no preparation,
      such as bottled water) passes the OLD tab split's held check, which looks only at unfired
      tickets. The new split also refuses a line whose group is held. _(2026-10-01, B20: no
      longer — a dish in a held group is split keeping its group; see the B20 notes beside "held
      kitchen work cannot be split onto a check" above.)_ The old tab split is left as it is; the
      plan's Task 13 deletes it. _(Task 13: deleted.)_
    - Two bills of one party can carry different service modes today: the old tab move retargets
      only the bill it moves. _(2026-09-30, Task 13: `moveTab` is deleted.)_ A throwaway test while building it, and the review's reproduction,
      each put a party's main bill at a counter-zone table with `moveTab`: that bill's mode read
      `prepay` and the party's other bill's `table_tab`. The merge and the transfer refuse two bills whose service modes differ, with
      `service_zone.mode_incompatible`, before changing either bill, as the old tab transfer does.
      Why: in the same reproduction, merging or transferring already-fired items onto the `prepay`
      bill succeeded, but paying that bill then failed with `ticket.already_fired`, because paying
      a `prepay` bill fires its items again. (2026-09-29, Task 7's review fix: paying a `prepay`
      bill now sends only the dishes not yet sent, so that failure is gone. The refusal stays:
      merged or transferred into a table bill, a `prepay` bill's unsent dishes would never reach the
      kitchen, because a table bill sends nothing when it is paid.)
    - A table of the party still pointing at the merged-away bill is pointed at the surviving one,
      so the old till screens do not show an abandoned bill; its membership is unchanged.
      _(2026-09-30, Task 13: a table no longer points at a bill (`dining_tables.tab_id` is dropped),
      so this no longer applies.)_
  - **Task 7 DONE (#864, 2026-09-29): move a whole bill to
    another party, to a free table, to the counter, or from the counter into a party.** This is the
    server half of campaign items A81 (a counter order seated at a table) and A82 (a table's bill
    taken to the counter); the till half is Task 12. _(2026-09-29: Task 12 built the till half;
    see "Task 12 DONE" below.)_ One new route, `POST /api/bills/:id/move`
    (`apps/server/src/move-bill.ts`, `apps/server/src/till-api.ts`):
    - The body names where the bill goes, `{ tableId }` or `{ counter: { zoneId } }` (the zone may
      be null), and `bills: "merge" | "separate"`, merge by default. A bill of a party sends its
      party's revision, and a move to a table another party holds sends that party's revision too
      (`expectedOtherPartyRevision`). Both are checked before the bill's or the table's own state,
      so of two tills acting from one read the second is told `party.out_of_date`. _(2026-09-29,
      Task 8 finish: the other party is named by id as well as revision, `otherPartyId`. The table
      must still be held by the party the till read there, or the move is `party.out_of_date`
      naming that party, because a party seated there since can carry the same revision number and
      the move would otherwise land with strangers. A revision sent without the id is
      `management.request_invalid` `{ field: "otherPartyId" }`.)_ _(2026-09-29, Task 11:
      `otherPartyId: null` now says the till read the table free; a party other than the bill's
      own seated there since is `party.out_of_date` naming that party, where it was 400.)_
    - `partyId` is the party the till read the bill under, and `partyId: null` means it read the
      bill with no party. A bill that has a party by then is refused `party.out_of_date`, naming
      that party, before any revision is asked for; a `partyId` naming a party the bill has since
      left is refused the same way, and one naming no party at all is refused `party.not_open`. A
      request with no `partyId` and no revision for a party's bill stays `management.request_invalid`
      `{ field: "expectedPartyRevision" }`. **Task 12's till
      must send `partyId: null` when it moves a counter order**, or a second till moving the same
      order is told its request is malformed rather than out of date. _(2026-09-29, Task 12: it
      does, with `otherPartyId: null` for a table it read free.)_
    - A bill holding a payment, a card at the reader or an invoice is never merged, so it keeps
      its id, and its payments, a card payment still at the reader and its retry, its refunds and
      its invoice all stay with it. Nothing is repriced. A paid bill is refused `bill.paid`; a
      merged-away one `tab.not_open`.
    - Into a party: merged into that party's main bill only when both bills are untouched (open,
      holding no payment, one being given back included, and not being paid in full at a reader)
      AND in the same service mode once the moved bill has taken the party's zone; otherwise it stays a
      separate bill and the answer says `merged: false`. A move is never refused because the two
      bills' modes differ (plan P15); merged into a table bill, a pay-first or invoice-first bill's unsent
      dishes would never reach the kitchen, because a table bill sends nothing when it is paid. To a free table: a new unnamed party opens there with the bill as its main bill. To
      the counter: the bill leaves its party and, while it is open, is labelled with the party's
      display name. A counter order already at the counter is refused `management.request_invalid`
      `{ field: "to" }`.
    - An open bill takes the receiving side's zone for what is ordered next (a party's earliest
      table's zone, or the zone the till sends for the counter); a presented bill keeps its own.
    - A move between service modes sends no dish twice. A dish one mode left unsent is given to the
      kitchen by the next: at a move into table service from another mode, as a round is (a later
      course's dish held for its course), or when the pay-first bill is paid or the invoice-first one
      placed. Paying a pay-first bill and placing an invoice-first one send only the dishes not yet sent, so a table bill
      whose dishes were sent can be moved to such a counter and still be paid (by cash, or by a
      card already at the reader when it moved) or placed, getting its one invoice. Before this
      fix the payment was refused `ticket.already_fired` after the card had been charged. An open
      bill that enters table service from another mode has its unsent dishes sent at the move, as
      a round is sent, because table service sends nothing when the bill is paid. Before this fix
      a pay-first counter order moved to a table-service table and then paid had no dish sent to
      the kitchen.
      Such a move is refused `product.unavailable`, changing nothing, when one of those unsent
      dishes cannot be sold now, as placing an order refuses it. A bill already in table service
      has no dish newly sent when it moves, so a
      no-preparation dish waiting for a later course keeps waiting.
      _(2026-09-30, lane A's A132: "when the pay-first bill is paid" above held only for the
      card-reader route and a bill payment. A pay-first order parked at the till and then paid in
      cash or by manual card through `POST /api/sales` sent no dish to the kitchen at all, because
      `payWorkingOrder` (`apps/server/src/till-sale.ts`) sent dishes only for a walk-up it had just
      created, and the till never calls the separate send-to-kitchen route. Found by Task 7's
      review, checked and FIXED (#914): `POST /api/sales` now gives the kitchen the dishes it has not
      been given, a later course's dish held for its course, through `firePrepayOrder`, as the
      card-reader route does. New cases in `apps/server/src/till-api.fiscal-sale-paths.test.ts`
      park a pay-first order, pay it in cash and by manual card, and find its dish sent once, and
      still once after a repeated payment; both found nothing sent before the fix. New cases in
      `apps/server/src/till-api.move-bill.test.ts` move a table bill whose dish was sent to a
      pay-first counter and pay it the same way: one invoice and no second send. Made to send
      every dish rather than the unsent ones, those two failed and the parked ones still passed.)_
      _(2026-09-30, lane A's A143 (#928), owner's decision: since #914 that payment was refused
      `route.station_inactive` or `route.missing` when a dish had no kitchen station to go to.
      Now a route whose station is switched off falls back to the next matching route whose
      station is on (never to a no-preparation route), for every caller
      (`resolvePreparationRouteOutcomes`, `packages/venue-service/src/operations.ts`). When no
      usable route is left, paying a pay-first order takes the payment and files it, sends nothing
      for that dish, and records one `route.dish_not_sent` alert for the sale naming the dishes'
      staff names and the zone (`raiseDishesNotSent`, `apps/server/src/dish-not-sent-alert.ts`;
      the `route.` claim, area "Kitchen", needs `venue_service.manage`,
      `packages/venue-service/src/alerts.ts`). An alert the database refuses is logged under the
      same code instead and the sale still commits; any other error is rethrown and fails the
      payment, and a `raise(rollback)` trigger, which ends the transaction, failed it too. Run: a
      cash payment over `POST /api/sales` of a parked order and of a walk-up, a card-reader
      payment and its recovery through `payWorkingOrderIntegrated`, and a cash bill payment that
      pays the order off; and,
      under "when the alert cannot be written", a cash payment, a card-reader capture with its
      log line, a recovery and a bill payment whose alert a `raise(abort)` trigger refuses, and a
      cash payment whose alert trigger uses `raise(rollback)` and one whose trigger names a
      missing table. A table round still refuses; invoice-first placing uses the same unchanged
      refusing send, not run here. Cases in `apps/server/src/till-api.unroutable-dish.test.ts`
      and in the `resolvePreparationRoutes` block of
      `packages/venue-service/src/operations.test.ts`; every new case in those two files but the
      table round and the "when the alert cannot be written" ones failed on the code before this
      change. Of those, the four `raise(abort)` cases failed with the alert's catch removed, the
      missing-table case failed with a catch that swallowed every error, and the `raise(rollback)`
      case passed both ways. Left open: invoice-first placing still refuses a dish with no usable
      route; nobody has decided whether it should take the order and raise the alert instead.)_
    - The party's main bill moves only as its last unpaid bill (`party.main_bill_stays`
      otherwise), and the party's next order then starts a new one. A table the bill's own party
      holds is `table.already_in_party`. A table needing clearing, taken out of use or unknown is
      refused as seating refuses it, and so is a free table in a zone that seats no one
      (`service_zone.mode_incompatible`). A table no party holds that still shows an open order is
      `table.occupied`, as a tab move refuses it: the old tab move can put a counter order there.
      At the route a malformed table id is `table.not_found` and a malformed counter zone id
      `shared.invalid_id`, as the seat, tab and sale routes answer them. _(2026-09-30, Task 13: the
      tab routes and the tab move are deleted, and `dining_tables.tab_id` with them, so this
      `table.occupied` check and the code are gone.)_
    - Held dishes cannot leave a party (`group.held_leaves_party`); sent dishes leave their kitchen
      group and keep their ticket and served state. The kitchen gets a MOVED notice for each sent
      dish whose table changes, and always for a move to or from the counter, even when the label
      reads the same on both sides (plan P17, which flags for the owner that such a slip can name
      the same table as where the dish came from and where it went; the slip's text was not
      checked here).
    - A table of the party the bill leaves that still pointed at it is pointed at the party's main
      bill, or at none.

    New codes, each 409 with English and Spanish wording on the till: `party.main_bill_stays` and
    `table.already_in_party`; the till also gained wording for `table.inactive`. Migration: core
    `0042_placed_bill_moves` re-creates `working_orders_enforce_transition` and
    `working_order_lines_require_open_parent_update` from the text a migrated database stores,
    each with one exception for a presented bill (plan P14): its row may change its party, its
    delivery table and its revision, and its lines may change kitchen group, with every other
    column unchanged. `scripts/behavioural-triggers.test.ts` tries each other column of both
    tables against the exception.

    Upgrade measured 2026-09-29 on a scratch venue in `/tmp`: migrated to main `59dafa994`'s
    migrations (the branch's journal set back to main's, and `0042` moved aside), seeded through
    the party harness with a party's split bill placed by hand and a counter order placed in a
    pay-first zone. There, moving the placed split bill to another party was refused by the
    engine with `lines may only be written while the order is open`. The branch's migrations were
    then applied to the same folder through `applyMigrations`: both placed bills read back with
    the same rows, and both then moved into another party, still `placed`, the split bill's line
    now outside its group. The server was not booted on it.

    Open points: the move moves the bill's revision on, open or presented, without
    `bumpRevision`'s refusal of money in flight, since a move changes no amount (plan P19). Dishes
    arriving in a party join no group until Task 9 _(2026-09-29: Task 9 gives them one; see its entry below)_.
  - **Task 8 DONE (#869, 2026-09-29): move guests, join tables and split a
    table, on the server.** Three new routes, `POST /api/parties/:id/move` (`{ toTableId }`),
    `POST /api/parties/:id/join` (`{ tableId }`) and `POST /api/parties/:id/split-table`
    (`{ tableId, billId }`, the bill null for none), in `apps/server/src/table-actions.ts`. The till
    keeps the old tab routes until Task 11. _(2026-09-29: Task 11's till uses these routes.)_
    - Move guests takes the party off all its tables. To a free table, the table joins the party
      and any manual status it had goes; the tables left behind need clearing when the venue's
      clearing setting is on, and are free at once when it is off. Moved to a free table in another
      zone, the party's open bills take that zone for what is ordered next. Moving to one of the
      party's own tables is allowed while it holds another (that one leaves); its only table is
      `table.already_in_party`.
    - Join tables adds a table; both stay and neither's status changes. A table in another service
      zone is `service_zone.join_mismatch`, one the party holds `table.already_in_party`.
    - Moving guests to, or joining, a table another party holds combines the two parties
      (`combineParties`): the absorbed party's kitchen groups and drafts move, its open and
      presented bills move across whole, and it closes, recorded as merged. Its paid bills stay on
      it and are listed through the family. When moving, its tables need clearing when the venue's
      clearing setting is on; when joining, they join the other party in the order they joined the
      absorbed one and keep their status, because their memberships end before the
      absorbed party closes. The bill choice is `bills: "merge" | "separate"`, merge by default:
      the incoming main bill merges into the receiving one only when both are untouched and in one
      service mode; otherwise both stay (`merged: false`). The receiving main bill stays main; with
      none, the incoming one becomes main if it is open; with neither, the next order makes one.
    - Split a table starts a new unnamed party on that table, taking the chosen bill (open or
      presented, not the main bill) as its main bill when it is open, or a new empty main bill when
      none is chosen. A presented bill goes with its lines unchanged except their kitchen group,
      and the new party has no main bill until it orders. Refusals: `table.not_joined` and
      `table.not_shared` (now with `{ tableId, partyId }`), `bill.other_party`, `bill.paid`,
      `tab.not_open`, `party.main_bill_stays` and `group.held_leaves_party`. A remaining table
      that showed the chosen bill shows the party's main bill instead, or no bill when the party
      has none.
    - Every action checks the path party's revision, then the revision of the party holding the
      target table, before any table or bill, so of two tills acting from one read the second is
      `party.out_of_date`. A party already combined into another is `party.not_open`.
    - The party the till read at the target table is named by id (`otherPartyId`) as well as by
      revision, as a bill move names it. The table must still be held by that party, or the action
      is `party.out_of_date` naming it: a party seated there since can carry the same revision
      number, and without the id a stale move would combine the guests with strangers, or a stale
      join land on a table now free. A revision sent without the id is
      `management.request_invalid` `{ field: "otherPartyId" }`. The plan's Tasks 11 and 12 have the till send both.
      _(2026-09-29, Task 11: the till sends both, and `otherPartyId: null` for a table it read
      free, which the server now refuses as `party.out_of_date` once another party is seated
      there; see Task 11's entry.)_
    - The kitchen gets a MOVED notice for each sent dish whose tables change, including a dish on
      a main bill merged away when parties combine (it is told once, on the bill it merged into).
    - The till gained wording for `table.not_joined`, and `table.not_shared`'s now reads right for
      Split a table too.
    - A paid bill left on the absorbed party names, in the kitchen, the tables of the party its
      guests went to: `orderTableLabels` follows the chain of merges (`billPartyTableLabels` and
      `partySurvivors`, since C77 in `packages/db/src/party-table-labels.ts`) to its last party
      and reads that party's tables, and the sent work read before a table action includes the
      bills of every party merged into the acting one (`partyFamilies`). The bill's party, label,
      lines and payments do not change.
      Run in `apps/server/src/party-table-actions.test.ts`: the paid bill's sent dish gets a MOVED
      notice naming the new tables after its guests move to a held table, after its table is joined
      to another party, after the old merge (`mergeTabs`) combines its party _(2026-09-30, Task 13:
      that case is deleted with `mergeTabs`)_, and after the party
      that took the guests later moves, joins a table and splits it off, including through two
      merges; the notice names the new tables when the bill was paid under another table's name; and
      after a move to a held table the pass names the new table. A one-off probe (not kept as a
      test) marked such a dish away and served, and it still got a notice: `kitchen-print.ts` reads
      neither `away_at` nor `served_at`. Receipts do not call `orderTableLabels`, and not every
      other view follows the merge (read, not run). _(2026-09-30, C86: a receipt of a bill of no
      party now calls `orderTableLabels`; a party's receipt still does not.)_
    Tests: `apps/server/src/party-table-actions.test.ts` and
    `apps/server/src/till-api.table-actions.test.ts`. No migration.
    Open points: **Fixed (C77):** the manager overview's slow-orders list (`computeOverdueOrders`,
    `packages/reporting/src/overdue-orders.ts`) kept its own copy of the pass's table naming and did
    not follow the merge chain. The pass and the list now call one function,
    `billPartyTableLabels` (`packages/db/src/party-table-labels.ts`, with `partyTableLabels` and
    `partySurvivors` moved there from `apps/server/src/parties.ts`). Run in
    `packages/reporting/src/overdue-orders.test.ts`: a late dish on a paid bill whose party was
    merged twice is named after the last party's tables ("Mesa 7, 8"), where before it was named
    by the bill's own label ("Ana"). (#880, main `d4324632e`.) A party with no table whose chain of
    merges never ends (an unknown id, or two parties recorded as merged into each other, which the
    database accepts) is named by the bill's own label, as before; whether any till action can make
    such a loop was not checked. Left by C77's review: the rule for a bill of NO party was written
    three times — `orderTableLabels` (`apps/server/src/kitchen-print.ts`), the `tableLabel`
    subquery in `computeOverdueOrders`, and `apps/server/src/receipt-order.ts`. **Done (C86,
    2026-09-30):** `orderTableLabels` moved into `packages/db/src/party-table-labels.ts` and is
    exported from `@waitron/db`; the kitchen papers, the pass (`listExpoQueue`), the slow-orders
    list (whose subquery and hand-written party branch are gone) and the no-party branch of
    `readReceiptOrder` all call it. A receipt's party branch stays its own on purpose (the party's
    name and active tables, no merge chain). The rule as written here before, "its seated table,
    else its delivery table, else its label", was out of date: the seated-table branch went with
    `dining_tables.tab_id` in Task 13 (#897, `c05388158`), so a bill of no party is named by the
    table it is delivered to, else its own label, and null for an unlabelled walk-up. The moved
    function keeps its filter on the table's location; the slow-orders list now passes its node's
    location (`nodes.location_id`) and receipts the till's, where before neither filtered. That
    shows nothing different on a real venue: outside tests, `createOpenOrder`
    (`apps/server/src/working-order.ts`) is the one writer of a non-null `delivery_table_id` and it
    refuses a table of another location (`table.not_found`), `apps/server/src/move-bill.ts` only
    clears the column, and provisioning refuses a second venue (`provisioning.second_venue`,
    `packages/provisioning/src/venue-apply.ts`); the grep was
    `grep -rn "deliveryTableId\|delivery_table_id" apps packages --include='*.ts'` and
    `grep -rln "insert(locations)\|insert into locations" apps packages --include='*.ts'`, whose
    other hits are test seeds and fixtures and the demo scripts under `apps/server/scripts`. Run: six
    deletion probes on the moved function, each failing a case in
    `packages/db/src/party-table-labels.test.ts`; then a probe making the no-party branch return
    the order's own label failed the slow-orders suites (`packages/reporting` and
    `apps/server/src/report-api.overdue-orders.test.ts`), the kitchen-slip suite and the receipt
    suites, but no case reading the pass, so one pass case was added to
    `apps/server/src/working-order.test.ts` (red under that probe). No existing assertion changed. (#906, main `4e8136b01`.)
    Left open by #906's review: `computeOverdueOrders` is the one report function that reads its
    own node's location rather than being handed one (adding `locationId` to `OverdueOrdersInput`
    and passing `cfg.locationId` from `apps/server/src/report-api.ts` was suggested, not done); no
    case pins what a MOVED slip's "from" line or a correction slip prints for a counter order
    delivered to a table (only the shared function's own cases would fail if the rule changed); and
    Codex found that a database built on purpose with a delivery table in another location now
    names the order by its own label where the slow-orders list and receipts named the table —
    no product path creates that state, and whether every existing venue database is free of it
    was not checked.
    **Still open:** `partyFamilies`, the reverse lookup of
    `partySurvivors`, stayed in `apps/server/src/parties.ts`, so the two merge-chain queries now
    live in different packages. And `party.main_bill_stays`'s till wording says
    "the table has other unpaid bills", which Split a table choosing the main bill need not
    satisfy. The old merge (`mergeTabs`) still writes a merged party's tables in one statement, so
    they share a joining time and their order in its name is not fixed; it goes with Task 13.
    _(Task 13: `mergeTabs` is deleted.)_
  - **Task 9 DONE (#874, 2026-09-29, main `002d54684`): dishes arriving in a party get a kitchen group, so the pass can
    mark them.** A bill that arrives in a party by Move a bill (to a held table or a free one) or
    by Split a table has each dish with no group put in a new group of the receiving party, after
    its last group (`groupArrivingDishes`, `apps/server/src/order-groups.ts`): dishes already
    released to the kitchen in ONE new fired group, and dishes not yet released in one new held
    group PER COURSE, because firing a course releases whole every held group holding one of its
    dishes on that bill; the waiter releases them as any held group. The new groups go fired first, then held
    by course (a dish with no course: see C80 below). "Released" is what Current orders and serving already use
    (`isReleased`, `apps/server/src/working-order.ts`): a kitchen item decides, fired or not; with no kitchen item, the line's `sent_at`. Nothing is sent or held by it, an extras line
    takes its dish's group, and each group made records a `lines_moved` event with
    `{ workingOrderId, arrived: true }`. A presented bill's lines change group only (migration
    `0042` allows it). A bill merged into the main bill on a move is grouped before the merge, so
    its dishes carry their group onto the main bill and the main bill's own lines keep theirs, a
    dish with no group included. A bill leaving for the counter gets no group. Retires A96 as the
    plan re-scoped it (Move a bill and Split a table); the tab transfer (`transferLines`) and
    `unjoinTable` still leave arriving dishes in no group until Task 13 deletes them. _(Task 13:
    deleted.)_
    - **A plan default the owner may overturn (P16):** spec §15's "leaves with them outside any
      group" is read as the side the bill leaves; the receiving party groups the dishes.
    - **DONE (C78, 2026-09-29): the new fired group takes its earliest-fired dish's fire time and
      firer, not the move's** — the time is that dish's kitchen item's `fired_at`, else its
      `sent_at` when it has no kitchen item; "fired by" is whoever fired that dish's group in the
      party the bill left (`leaveParty`, `apps/server/src/move-bill.ts`, reads it before the link
      is cleared), else the person who moved the bill, when that dish was in no group of a party
      it left. It reaches the table screen's "Fired N min ago", read through `listOrderGroups` and
      `readGroups`, which read the time but not the firer; and the "Sent {time} by {name}" label, read through
      `readCurrentOrders`, which for a fired group shows its fire time and firer. It does not
      reach release reminders (`remind_at` and served times), the pass (`listExpoQueue`: the
      group's id, position, state and creation time) or the slow-orders list
      (`ticket_items.queued_at`). Tests: `apps/server/src/party-arriving-dishes.test.ts`. No
      migration. (#882, main `5d2a93b24`.) Left by its review, not done: the earliest time is
      picked by comparing the stored times as text, which is right only while every writer stores
      the same `toISOString()` form (every writer found uses `nowIso()`; not proven for all); and a
      dish recalled and fired again carries its new fire time but its old group's firer.
    - **DONE (C79, 2026-09-29): an arriving held group prints its HOLD ticket in advance and a
      FIRE slip when fired**, where "Print held groups in advance" is on, as every other way of
      making a held group does. Move a bill (`moveBill`, `apps/server/src/move-bill.ts`) and Split
      a table (`splitTable`, `apps/server/src/table-actions.ts`) hand the held groups
      `groupArrivingDishes` made to the same `printHoldTickets`; Move a bill prints after any
      merge, so the ticket names the main bill the dishes are now on. Firing is unchanged: a group
      whose HOLD ticket was queued already fires with a FIRE slip. With the setting off, the
      dishes in those held groups print nothing at the move: no HOLD ticket. Tests:
      `apps/server/src/party-arriving-dishes.test.ts`. No migration. (#883, main `ff66222fc`.)
    - **DONE (C80, 2026-09-29): a waiting dish with no course joins the earliest ACTIVE course's
      held group**, as the till's order screen files a dish with no course under the earliest
      course among the draft's lines that the till lists (it lists active courses only;
      `draftSections`, `apps/till/src/state/draft-groups.ts`), so firing that course sends it and
      firing a later one does not. An earlier inactive course among the waiting dishes is passed
      over. When none of the waiting dishes' courses is active, a dish with no course joins the
      earliest of them; only when no waiting dish on the bill has a course do the ones with none
      keep a held group of their own. "Earliest" is the course order `groupArrivingDishes` already
      reads: display order, then name. Tests: `apps/server/src/party-arriving-dishes.test.ts`,
      including a case with an earlier inactive course and a later active one, where firing the
      active course sends the dish with no course, and a case where the only waiting course is
      inactive; one Task 9 case there expected the old separate group and now expects the one
      group (the owner's decision, 2026-09-29). No migration. Still different, read from
      `draftSections` and `groupArrivingDishes` and not compared with a running till: the till
      also files a dish whose course it does not list (an inactive course) under the earliest
      course it lists among the draft's lines, while here such a dish keeps its own held group;
      and when the till lists none of the draft's courses it makes one section with no course,
      while here each inactive course keeps its own held group and a dish with no course joins the
      earliest of them. (#885, main `573253221`.) Left by its review, not queued (owner,
      2026-09-29): when a round is SENT, `working-order.ts` picks its earliest course without
      checking whether the course is active, so with a switched-off course the send path and this
      move path can file a dish with no course under different courses.
    - **Which dishes arrive unsent changed with Task 7.** An open counter order moved into table
      service has its dishes sent at the move (Task 7), so it arrives in a FIRED group, not the
      held group the plan's Task 9 expected; a later course's dish, held for its course, arrives
      in its course's held group. Task 7's send at the move is kept (its FYI left the choice to this task).
    - The party's revision is not moved on again: every caller has already moved it on, or has
      just made the party, in the same transaction.
    Tests: `apps/server/src/party-arriving-dishes.test.ts`. Seven cases in
    `party-move-bill.test.ts` and `party-table-actions.test.ts` that pinned an arriving bill's
    lines outside any group now expect the new group, every other value unchanged. No migration.
  - **Task 10 DONE (#875, 2026-09-29, main `caacaed6e`): the till lists a party's bills
    by name and splits, merges and transfers between them through Task 5's routes.** What changes
    for a person using the till:
    - The table screen names each bill after the party: "Ana · Bill 1", or "Mesa 4, 5 · Bill 2"
      for an unnamed party, numbered in the order listed, and marks the bill new orders go to
      ("New orders"). A bill's stored label is no longer shown: a split-off bill carries its
      table's label, which read as "Mesa 4" beside "Bill 1".
    - Merge bills and Transfer items offer the party's other bills that are open, recorded on
      this party, and have nothing paid off them (outstanding equal to total), not other tables'
      tabs. A bill whose payment was refunded in full passes that test and is still offered; the
      server then refuses it with `bill.payments_received`. The merge picker is
      headed with the bill merged into, and the transfer picker with the bill the items come
      from; the transfer's items step says "Choose items to transfer from" one bill "to" the
      other. Each of these headings falls back to the plain table-actions title when a bill it
      names is no longer among the bills the screen lists. Split works on any bill of the party, one split off
      before included.
    - The draft now shows on a split-off bill too. The preview before sending has a Send to
      choice (native radios, `name="billId"`) whenever it has more than one entry. The entries
      are the party's open bills; first "A new bill" when the party has no open main bill; and a
      bill picked in this preview that has since stopped being an open bill of the party
      (presented, paid or merged away, for example), marked "(no longer open)". Nothing picked, it shows the
      party's open main bill as chosen, or "A new bill" when there is none.
    - A bill picked by changing the Send to choice, the main one included, is sent by its
      `billId`; tapping the already-checked default is not a pick. The server refuses one
      that is no longer open (`bill.presented`, `bill.paid`, or `tab.not_open` for one merged
      away); the till shows each in its own words. With nothing picked, or "A new bill" picked,
      no `billId` is sent, and the server puts the order on the party's main bill as it stands
      when the server takes it, making a new one when there is none. When a send to a
      picked bill gets no answer, the screen shows that bill only while the waiter is still on the
      table the order was sent from and that table still holds the same party.
    - Leaving a split-off bill unpaid no longer merges it back (M7b3 is gone, spec decision 8).
    - Refusals `bill.presented`, `bill.paid`, `bill.other_party`, `bill.payments_received` and
      `bill.line_paid` show in their own words, and so does `tab.not_open` on a send that named a
      bill (every other path shows it as it did before); `tab.merge_leaves_no_table` is no
      longer shown.
    - Move and Join still use the old tab routes until Task 11. _(2026-09-29: Task 11 moved them
      to `POST /api/parties/:id/move` and `/join`.)_
    - The server refuses a transfer carrying no items with `sale.empty_basket` (400), as a split
      with none already was, and the till never sends one.
    Tests: `apps/till/src/till-app-parties.test.ts`, `till-app-table-service.test.ts`,
    `screens/till-table-order-screen.test.ts`, `.parties.test.ts`, `.a11y.test.ts` (merge picker,
    transfer picker and its items step, and Send to, both themes), `api/client.test.ts`; server `party-bill-actions.test.ts` and
    `till-api.bill-actions.test.ts`. No migration.
    Open points: `tab.party_mismatch` and `tab.party_has_other_open_bill` stay in the till's
    table refusals although only the old tab merge raises them, which the till no longer calls;
    `tab.merge_leaves_no_table` is out of those refusals (`TABLE_REFUSALS`,
    `apps/till/src/till-app.ts`), so the till shows its generic table error for it, while its
    message stays in `apps/till/src/i18n/codes.ts`, read by nothing else under `apps/till/src`
    but its test. All three go with Task 13 _(Task 13: gone from the server, the till's refusals and
    its wording)_. Unchecked Send to radios are Chromium's own dark-theme control, dim grey
    on the dark dialog (seen in the 390 px Spanish dark screenshot).
  - **Task 11 DONE (#881, 2026-09-29, main `bc5f5cae7`): the till moves guests, joins
    tables, splits a table and names the party, through Task 8's routes and Task 2's
    `PUT /api/parties/:id/name`.** What changes for a person using the till:
    - The table screen's actions offer Move guests, Join a table, Split a table (only while the
      party holds two or more tables) and Name the party, beside Merge bills, Transfer items and
      Split by item.
    - Move guests and Join a table list every table but the party's own, each with its state:
      free, "Seated: Luis" (that party's display name), or needing clearing, shown disabled with
      `table.needs_clearing`'s sentence under it. Move guests also lists the party's own tables,
      as "These guests", while it holds more than one. The heading states the scope: "Move Ana
      (Mesa 4, 5) to:".
    - A table another party holds first asks what happens to the bills: "Merge the bills" (the
      default, focused) or "Keep separate bills", under a heading saying who joins whom ("Ana
      (Mesa 4, 5) joins Luis (Mesa 7)"; for Join a table the other party joins this one). Cancel
      or Escape sends nothing. A free table, or one of the party's own, acts at once.
    - After a move into another party the till follows the guests to the table they moved to,
      opening the party's main bill, or with none its first unpaid bill, else its latest. When
      Merge was chosen and the answer says `merged: false`, the till says "The bills were kept
      separate: they are merged only when both parties have a main bill, neither has been
      presented, is being paid or has a payment on it, and both are served the same way".
    - Split a table picks one of the party's tables, then the bill that goes with it: the party's
      open or presented bills other than its main one, or "No bill, start an empty one". The till
      stays with the party, at another of its tables when the open one left, and on its main bill
      when the bill on screen left with the table.
    - Name the party is a form with one optional field (`name="partyName"`, `maxlength` 40 on the
      native input): trimmed, and empty clears the name. A value over 40 characters is refused
      beside the field without a request; the server's own refusal (`management.request_invalid`
      `{ field: "name" }`) reopens the dialog with the name sent and the refusal under the field.
      A refusal of the name that arrives after the waiter has left that party's order, or opened a
      table since, is dropped. _(2026-09-30, C81: a late answer to other table actions is checked
      too, by a different rule from the name's refusal: the answer is dropped once the order's
      party is another, a table open has begun since it was sent and one is under way, or the
      operator has logged out or the till has switched server (`#hasLeftParty`,
      `apps/till/src/till-app.ts`); a visit to the floor alone still applies it.
      Then Join a table and Split by item change nothing after their answer; Move guests still
      re-reads the floor, then changes nothing more; Split a table, when the bill on screen left
      with the table and the party has no main bill, stops once the party's bills read after the
      answer come back, without picking one; and Finish's refusal for a bill still unpaid is
      dropped. Move guests and Join a table never say that bills were kept apart, then or later,
      once the waiter has left the order and either has not come back to it or a table open is
      under way. Finish's success is dropped only when the order's party has changed, the
      operator has logged out or the till has switched server; an open under way does not stop
      it. When the waiter has gone to the floor or another tab and either has not come back or a
      table open is under way, Finish clears the party and reads the floor again without moving
      the screen. Before, a late Move put the moved party on the screen of the table opened
      since. Any other late refusal is still said on the banner. Merge bills, Transfer items and a
      named party are unchanged: after a successful answer each re-reads the floor and the bill
      on screen. #905.)_ Open (found by #905's review, by reading, not reproduced): on a handheld,
      a waiter who taps a free table to seat it, goes back to the order tab while the seating is
      still under way and starts Move guests can have the move set the wrong table on the new
      party. The review's suggested fix is to count only table opens started in the current
      operator session; not queued.
    - The floor's card and map token show the party's display name when it says more than the
      table's label: a name staff gave, or a joined party's tables ("Mesa 4, 5").
    - Opening a seated table opens its party's main bill, else its first unpaid bill, else its
      latest. `tabId` is gone from the till's `TableState` type, so the till reads it nowhere and
      Task 13 can drop it; `moveTab` and `joinTable` are gone from `apps/till/src/api/client.ts`.
      _(Task 13: `dining_tables.tab_id` is dropped.)_
    - The till sends `otherPartyId` with `expectedOtherPartyRevision` for a table another party
      holds, and `otherPartyId: null` for a table it read free. The server now takes null as "read
      free" (`readTargetTable`, `apps/server/src/move-bill.ts`, shared by move, join and move a
      bill): a party seated there since is `party.out_of_date` naming that party, with nothing
      written, where it was 400 `management.request_invalid` (an open point in #869's
      description). The till reloads and says the table changed. Null naming the moving party's
      own table gets the ordinary own-table rules instead (a join is `table.already_in_party`).
      Null sent together with `expectedOtherPartyRevision` is 400 `management.request_invalid`
      `{ field: "otherPartyId" }`.
    - `table.already_in_party`, `table.not_joined`, `table.inactive`, `party.main_bill_stays`,
      `service_zone.join_mismatch` and `service_zone.mode_incompatible` show in their own words;
      the last two gained English and Spanish wording. A merge of bills or a transfer of items
      refused with `service_zone.mode_incompatible` shows `table.bills_served_differently`
      instead ("These bills are served in different ways, so items cannot move between them").
    - Shared UI: `wt-input` (`packages/ui-core`) gained `maxlength`; `FloorTable` and
      `wt-table-token` (`packages/ui`) gained `partyName`.
    Tests: `apps/till/src/till-app-parties.test.ts`, `till-app.test.ts`,
    `till-app-table-service.test.ts`, `till-app-drafts.test.ts`, `till-app-menu-refresh.test.ts`,
    `till-app.a11y.test.ts`, `screens/till-table-order-screen.test.ts` and `.a11y.test.ts`,
    `screens/till-floor-screen*.test.ts`, `widgets/bill-choice-dialog.test.ts` and `.a11y.test.ts`,
    `widgets/party-name-dialog.test.ts` and `.a11y.test.ts`, `api/client.test.ts`,
    `i18n/codes.test.ts`; server `till-api.table-actions.test.ts`, `till-api.move-bill.test.ts`,
    `party-move-bill.test.ts` and `party-table-actions.test.ts`;
    `packages/ui-core/src/components/wt-input.test.ts`, `packages/ui/src/floor.test.ts`,
    `wt-table-token.test.ts` and `wt-table-token.a11y.test.ts`. No migration.
    Open points: the till also sends `otherPartyId: null` when its floor does not list the target
    table at all (a failed floor read empties the list); a table another party holds is then
    refused as out of date, never combined, and the party's own table gets the ordinary own-table
    rules. `tab.not_table_tab` stays in the till's table refusals (`TABLE_REFUSALS`) although only
    the old tab join and merge raise it, which the till no longer calls; it goes with Task 13
    _(Task 13: gone)_. A table the server lists with no party opens no bill any more. On a
    390 px phone the bill choice's buttons wrap ("Keep separate bills" on three lines). _(Campaign
    item C82, #911: on the floor map the party's name now stays on one line and ends in an ellipsis
    instead of breaking inside a word; the list card's wrapping is unchanged (it breaks inside a
    word only when the word is wider than the card).)_ Open (seen by C82 at 390 and 1280 px, not
    measured further): a token for four seats or fewer, or with no seat count set (the map's two
    smallest sizes; `sizeForCapacity` picks the size from the seat count and gives a table with
    none the second-smallest), is so narrow that the name shows only its first few letters ("T…"
    at two seats, "Ter…" at four), and the table's own label, its covers and its "to serve" chip
    spill past the token's edge. The map's token sizes (`wt-floor-canvas`) decide that; not
    queued.
  - **Task 12 DONE (2026-09-29, #888, main `ba1458c45`): the till moves a bill to
    another table or the counter, and a counter order to a table, through Task 7's
    `POST /api/bills/:id/move`; and it pays a moved bill the way the server takes it.** This is
    the till half of campaign items A81 and A82. What changes for a person using the till:
    - The table screen's actions offer Move this bill, except on a paid or abandoned bill. It
      lists The counter first, then every other table with its state as Move guests does (a table
      needing clearing shown disabled with its reason), under "Move Ana · Bill 2 to:", the bill
      named as the bills list names it. The counter and a free table act at once; a table another
      party holds first asks whether to merge the bill into that party's main bill (the default)
      or keep it separate, headed "Ana · Bill 2 to Luis (Mesa 7)".
    - The till sends the party's id and revision, the party the picker showed seated at the target
      table (`otherPartyId` with `expectedOtherPartyRevision`, or `otherPartyId: null` for a table
      shown free), not one read from a later floor, and for the counter the zone the counter's own
      orders are made in (the one `api.setServiceZone` was given), or null when the counter's
      offers could not be read.
    - Afterwards the screen stays with the party, on its main bill or its first unpaid one, and
      goes back to the floor when the party has no bill left. The floor is read again after the
      move, and a failed read keeps the last floor. An answer arriving after the waiter has left
      the bill opens no other bill, does not go back to the floor and says nothing about bills kept
      apart; the floor, and after a move to the counter the held list, are still read again. After
      a move to the counter the counter's held orders are read again, so the bill is listed there
      under the label the server gave it;
      a failed read says "The bill was moved, but the list of held orders could not refresh." `party.main_bill_stays`, `bill.paid`, `group.held_leaves_party`,
      `table.needs_clearing` and the other table refusals show in their own words;
      `party.out_of_date` reloads and says what changed.
    - Each held counter order has Move to table ("Pasar a mesa"). It reads the floor again, lists
      the tables the same way, asks the bill question at a seated table ("#12 Ana to Luis
      (Mesa 7)"), and sends `partyId: null` with the party it showed seated there. The counter stays on screen and says "Moved to
      Mesa 9"; a basket holding that order is emptied. A party's own bill, which the held list
      also shows, gets no Move to table.
    - Paying picks the path by the bill's state. A presented bill is collected through
      `/collect`, from the bill list's Take payment or the one beside a refused Finish (which now
      offers it), and Finish then succeeds; the original receipt is offered afterwards unless a
      sale had already been filed for the bill (`receiptAvailable`). An open bill holding a
      payment, received or still pending at the reader (the server's `hasPayments`, on the
      table's bills and the held list alike), is not sent to the single payment: the till says what it still owes and "Part of
      this bill is already paid: take the rest as a bill payment", and the counter's pay buttons
      are disabled for it. A single payment refused `bill.payments_received` says the same. Any
      other bill pays as before. There is still no bill-payment screen (the service plan's Task
      15, lane B's B15); once it lands, that sentence should open it. _(2026-09-30, B15: on a
      table, that sentence is now a button opening the bill payment dialog, with "Paid so far"
      above it and Pay items, Contribute and Split equally below it. On the counter the pay card
      stays held, and "{amount} to pay" with a "Take the rest" button sits above it.)_
    - The held list shows what an order holding a payment, a pending one included,
      still owes.
    - Merge and transfer offer only the party's other open bills with no payment on them (the
      bill's `hasPayments`). Before, they offered a bill whose outstanding amount equalled its
      total, which let through a bill holding a pending payment that the server then refuses;
      that check came from Task 10 (#875), on `main` before this branch.
    - Server: `GET /api/working-orders` (`listHeldOrders`) answers `outstanding`, `hasPayments`
      and `partyId` for each open order, and a party's bills (`PartyBill`) carry `hasPayments`
      too. Both read the payments through `readPaymentsByBill` (`apps/server/src/bill-payments.ts`).
    Tests: `apps/till/src/till-app-parties.test.ts`, `till-app.test.ts`,
    `screens/till-table-order-screen.test.ts`, `.parties.test.ts`, `.a11y.test.ts` (Move this
    bill's list, its bill choice, and the partly paid sentence, both themes),
    `screens/till-counter-screen.test.ts`, `widgets/held-orders.test.ts` and `.a11y.test.ts` (the
    picker and its bill choice, both themes), `widgets/bill-choice-dialog.test.ts` and
    `.a11y.test.ts`, `widgets/card-grid.test.ts`, `api/client.test.ts`; server
    `till-api.move-bill.test.ts`, `working-order.test.ts`, `parties.test.ts` and
    `bill-payments.test.ts`. No migration.
    Open points: `party.main_bill_stays` still reads "Move one of those instead" (Task 7's
    wording, pinned in `apps/till/src/i18n/codes.test.ts`); the plan asked for "move the other
    bills first or merge them". The plan's `table.move_to_counter` ("Move to counter") string was
    not added: the counter is a target in Move this bill's list, named `table.to_counter`, so
    nothing would read it.
  - **Task 13 DONE (#897, 2026-09-29, main `c05388158`): the old tab routes and the table's pointer to its bill are
    gone. RESET NOTICE: every dev venue needs `wa-wt reset demo <worktree-name>`, and the owner's
    box is wiped once.** Every venue that ever seated a party, took a booking for a table,
    delivered a counter order to a table, or recorded a party command stops at boot with
    `migrations.apply_failed` until it is reset. There is no data-migration code before a venue
    is live (`CLAUDE.md` §3).
    - Deleted: `POST /api/tabs/:id/move|join|merge|transfer|split|unjoin` (each now answers 404),
      the functions behind them (`moveTab`, `joinTable`, `mergeTabs`, `transferLines`,
      `splitOffCheck`, `unjoinTable` and their helpers), the four codes only they raised
      (`tab.merge_leaves_no_table`, `tab.party_has_other_open_bill`, `tab.not_table_tab`,
      `tab.party_mismatch`), and `table.occupied`, which `refuseUnseatable`
      (`apps/server/src/move-bill.ts`) also raised for Move a bill, Move guests and Join tables by
      reading the table's pointer to its bill, and which went with that pointer. The floor works out a table's open bill, its line
      count, its total and its dishes still to serve from the bills of the party holding it.
      _(2026-09-30, service Task 10: the dishes still to serve now also count paid bills and the
      bills of parties merged into it.)_
    - Schema, core migrations `0043`–`0045`: `0043` drops the three triggers that name or sit on a
      rebuilt table (`parties_clear_table_status`, `working_orders_release_main_bill` and
      `working_orders_release_main_bill_on_move`); `0044`, generated, rebuilds `dining_tables`
      without `tab_id`, `parties` with its CHECKs named `parties_*_ck` and its state limited to
      `open` and `closed`, and `service_commands` with the scope `'party'` in place of `'visit'`;
      `0045` re-creates the three triggers with the text they had. The table condition
      `needs_clearing` (`dining_tables.needs_clearing_since`) is unchanged.
    - Why the reset: the rebuild's `DROP TABLE` runs with foreign keys on inside the migrator's
      transaction, and every key into `dining_tables` and `parties` is `no action`
      (`docs/developers/conventions-data.md`, the rebuild paragraphs). Measured on scratch venues
      provisioned by the previous `main` (`b3ed0d288`) with its own `dev-setup`, then booted by this
      branch's server: one seated-and-finished party, one booking for a table, and one open counter
      order delivered to a table each failed at the rebuild's `DROP TABLE` of `dining_tables` with
      `FOREIGN KEY constraint failed`; one stored command of scope `'visit'` failed at the copy into
      the new `service_commands` with `CHECK constraint failed: service_commands_scope_kind_ck`.
      Each left core's journal at 43 rows and `tab_id` in place. A venue from the same seed with none
      of those rows, and a fresh venue, migrated and answered `/health` with 200.
    - On a dev venue the boot also logs `migrations.dev_constraint_violation`, naming
      `wa-wt reset demo <worktree-name>`. On a box it counts as a failed start, and after three
      failed starts the next one serves the recovery page, which shows `migrations.apply_failed`'s
      wording ("The box's database could not be updated…") with the failure's cause in its log
      tail (read in `apps/server/src/recovery-surface.ts`, `node-entry.ts` and
      `recovery-state.ts`, not run on a box).
  - **DONE (C84, 2026-09-30): a sent order with no answer could put back an older copy of the
    party.** When a sent order gets no answer, the till calls `#retakePartyFromFloor()`, whose floor
    read can fail and keep the last floor, and then, when the order landed on a different bill from
    the one it was sent from, `#followDraft` → `#rememberOrderParty()`, which copied the party from
    that floor without comparing revisions (`apps/till/src/till-app.ts`). Found by reading during
    Task 12's review (2026-09-29); the same calls are on `main` before that branch (a6de0cde3).
    Task 12 fixed the same shape in `#onMoveBill` (7f82c958a) by taking the party only when the
    floor read worked. _(Campaign item C84, #913, 2026-09-30:
    reproduced by "keeps the party on screen, not the older copy on the kept floor, when a send from
    another bill got no answer and the floor cannot be read" in
    `apps/till/src/till-app-parties.test.ts` — on the old code the screen went back from revision 4
    to the floor's 3 and the next Move guests sent 3. `#rememberOrderParty()` now keeps the party on
    screen when the floor lists the same party at a lower revision; a different party, no party, or
    the same one at an equal or higher revision is still taken. The answered-but-landed-elsewhere
    path was tried too and did not reproduce: its `#reloadTables()` empties the floor on a failed
    read, so the party was kept.)_
    **Open:** when a void or line change gets no answer, `#rereadAmounts()` can put on screen what
    the party still owes, taken from its bills after its own floor read failed, while the revision
    on screen stays where it was. A later floor read that also fails keeps a floor listing the same
    party at that EQUAL revision, which `#retakePartyFromFloor()` takes, and `#followDraft` →
    `#rememberOrderParty()` after a send with no answer takes too, putting the floor's older amount
    back. A change that is answered moves the revision on (`partyAfterEdit` in
    `apps/server/src/working-order.ts`), so its kept floor is lower and refused. Found by reading
    during C84's review; the path was traced in the code, not reproduced.
- **A paid party's bill cannot be merged with another or have items moved onto it (plan Task 2,
  2026-09-26).** Once a party has paid, it can still be moved to another table or have a table
  joined to it, but merging another table's bill into its paid bill, or moving items to or from
  that paid bill, is refused with `tab.not_open` until the party's next order (sent through
`placeGroups` naming no bill) starts a new main bill. A round sent with `addTabRound` to the paid
bill is refused.
  Decide whether a paid party should be mergeable before the till offers it.
  _(2026-09-29, plan Task 5: the new bill routes refuse a paid bill with `bill.paid`; the old tab
  routes keep `tab.not_open` until they are retired. Spec decision 5 settles it: "A paid bill is
  done: it neither merges nor moves.")_
- **An invoiced but unpaid bill on a party cannot be charged from the table screen (plan Task 2,
  2026-09-26).** In a venue that issues the invoice first, a party merged into another can bring a
  bill whose invoice is issued but not yet paid. The table screen lists it with what it owes, but
  offers Take payment only on bills that are still open, so there is no button to charge it. Finish
  table is then refused because that bill is unpaid; once no open bill is left, the refusal tells
  the person to take payment but offers no button that does it. Charging it belongs to plan Task 14 (bill payments).
  _(2026-09-29, table actions Task 12: retired. The table screen now offers Take payment on a
  presented bill, beside a refused Finish too, and collects it through `/collect`.)_
- **The floor and the table screen write amounts differently (plan Task 2, 2026-09-26).** The floor
  shows `44.00 €` while the table screen shows `44,00 €` in Spanish. The floor's format predates
  the parties work; Task 2 now also uses it for what a party still owes. Make the floor follow the
  locale, as the table screen does.
- **Join and merge keep a table, its bill and its party consistent — done (A73, #794).**
  `joinTable` and `mergeTabs` refuse with `tab.not_table_tab`, `tab.party_mismatch` and
  `tab.party_has_other_open_bill` (and `mergeTabs`, since A111, with `tab.merge_leaves_no_table`).
  _(2026-09-29, table actions Task 13: both functions, their routes and the four codes are deleted.)_
- **A table's bill with no party can still be made (A73 review, 2026-09-28) — retired by table
  actions Task 13, which deleted the routes below.** Two things were left
  open:
  - `moveTab` (route `POST /api/tabs/:id/move`) can point a free table at a parked counter order,
    which makes a table's bill with no party. A review reproduced it with `parkOrder` then
    `moveTab`. From there `joinTable`, and a merge where neither bill has a party, both pass A73's
    checks. Moving a counter order to a table as an explicit operation is queued separately.
  - Joining a table to a split check with no party is refused as `tab.not_table_tab`, because
    nothing stored tells such a check from a counter order. The review confirmed the refusal by
    running it; no test covers that call.

  **Next action:** owner decision on whether `moveTab` should refuse a counter order, and whether a
  table joined to the party's own bill should stay in the party when that bill is merged into a
  check at another table (today it is freed and leaves, A111).
  _(2026-09-29, table actions Task 11: the till no longer calls `moveTab` or `joinTable`; the routes stay until Task 13.)_ _(2026-09-29, table actions Task 13: the routes and `moveTab`, `joinTable`, `mergeTabs`, `transferLines` and `unjoinTable` are deleted, and `dining_tables.tab_id` is dropped, so a bill reaches a table only through its party or, for a counter order, `delivery_table_id`.)_
- **A merge within one party with `freeSourceTable: true` frees the source bill's tables AND takes
  them out of the party — done (A111).** The owner's rule of 2026-09-28: a split-off bill has its
  own table because those guests moved there, so merging it back with `freeSourceTable: true` (what
  the till's "Merge a bill" sent until table actions Task 10, whose Merge bills uses
  `POST /api/bills/:id/merge` and frees no table) frees that table and ends its membership, as the whole-party
  merge already did. A merge that would free every table the party holds is refused with
  `tab.merge_leaves_no_table`. Merging a split check at no table back into the party's own bill
  frees no table, so a table joined to that bill with `joinTable` stays in the party (a case in
  `apps/server/src/parties.test.ts`). Merging the party's own bill INTO a check at another table,
  with `freeSourceTable: true`, frees every table on that bill, a joined one included, and takes
  them out of the party, unless that would leave the party with none. A table joined to a split
  CHECK rather than to the party's tab is freed with that check, like a check moved to its own
  table. _(2026-09-29, table actions Task 13: `mergeTabs`, `freeSourceTable` and
  `tab.merge_leaves_no_table` are deleted; `POST /api/bills/:id/merge` frees no table.)_
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
  text.** Found beside the layout pass above, on the same branch, and older than it. The token is
  `--wt-color-warning-text`, and `grep -rn -- "--wt-color-warning-text:" packages/ui/src apps`
  returns NOTHING, so it has no definition in any theme. What DOES exist in
  `packages/ui/src/tokens/colors.css` is `--wt-color-warning` (with `--wt-color-on-warning`), which
  `wt-count-badge` uses. Every one of the four call sites writes the fallback form
  `color: var(--wt-color-warning-text, var(--wt-color-text))` — `apps/till/src/widgets/basket.ts`,
  `station-queue.ts`, `diet-badges.ts` and `apps/till/src/screens/till-expo-screen.ts` — so nothing
  is broken and nothing looks wrong; the emphasis those four rows were written to carry simply never
  appears, and a green suite cannot tell the two apart. That is why it took a colour MEASURED in the
  shadow root to find it, and why the same shape can hide anywhere a fallback is written.
  **Next action:** whoever takes the till layout pass above decides whether these four want
  `--wt-color-warning`, a new `--wt-color-warning-text` defined in both themes, or the
  `--wt-color-danger` the dish picker's refusals now use. `diet-badges.ts` also reads
  `--wt-color-success-text`, declared nowhere, the same way. Since C69 every other `var(--wt-…)`
  read of an undeclared name in source text is refused by `scripts/style-token-names.test.ts`
  (its header lists what it cannot see); these five reads are its listed exceptions, and fixing
  them means deleting their entries from its `FALLBACK_READS`.
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
  before anyone writes a test claiming to cover them, and one half of it is NOT what the looking
  pass first wrote down. An options label marked unavailable never reaches the picker at all: the
  published version keeps every label, the served offer and the till's menu-state poll replace a
  default that is missing or names an unavailable label with the first available label in the
  published version's order, or with null when none is available (`effectiveDefaultLabelId`,
  `packages/catalogue/src/option-default.ts`, applied by `applyLiveFields`,
  `packages/catalogue/src/menu-document.ts`, and `withUnavailable`,
  `apps/till/src/state/menu-refresh.ts`), and the till filters unavailable labels out before the
  picker is given them (`sellableModifiers`,
  `apps/till/src/api/client.ts`) — traced through the code, not run. An over-cap count is different. Stepping
  cannot produce one, because `#step` clamps against both the item's own cap and what is left of the
  list's allowance; but a REOPENED line is seeded straight from `initialSelections` with no clamp at
  all, so `#allSatisfied`'s `total <= entry.maxPicks` arm is reachable after all. Run in the till's
  browser harness on 2026-09-21: a picker seeded with 5 of one product on a list whose `maxPicks` is
  2 renders a count of 5 and a disabled Add, and that arm is the only one of the five that a fixture
  with `minPicks: 0` and `maxQuantity: 9` can be failing. The real-world shape is a parked line
  whose list had its cap reduced under it, the same family as the "list lost the product between the
  park and the edit" escape recorded under Task 8.
- **DONE (#809 for A110; #813 for campaign item A115, from the run-it review of #809, branch
  `fix/till-bill-figures-refresh`): after a line is cancelled or changed, the table's bill figures
  update straight away.** A cancel (A110) and a saved line Change, or one that got no answer while
  the waiter is still on the order (A115), read the floor's party, the order's lines and the
  party's bills again (`#rereadAmounts`, `apps/till/src/till-app.ts`); a refused one reads the
  lines only. When the re-read's own floor or bills read fails, the till says so
  (`table.reread_failed`) unless another message is already shown, the waiter has left the order,
  or a later re-read has started; it says so even when another read has refreshed the order since,
  because the message is still true of this re-read. "Still to pay" comes from the floor when the
  floor read works and lists the party at a revision no older than the one shown; when the floor
  read fails, from the re-read's own bills for the same party while that bills read is still the
  latest, the waiter is still on the order and no later re-read has started — the floor's figure is
  the sum of the same bills (`readBillsOfParties`, `apps/server/src/parties.ts`) — and otherwise it
  is left alone.
  The priced-extra case was shown in the till's browser tests with a fixture adding a 1.50 extra;
  the demo menu offers no priced extra, so it was not run on the dev till.
- **DONE (#812, campaign item A113, from the A108r retro review of #719, branch
  `fix/retro-review-719-till`): the till's option default returns to the published one once it is
  back in stock, and when a line's total is unchanged the basket refresh names each dish, variant
  or extra whose price changed.** The served options list carries the published default as
  `publishedDefaultLabelId` (`applyLiveFields`, `packages/catalogue/src/menu-document.ts`), which
  `withUnavailable` (`apps/till/src/state/menu-refresh.ts`) reads. Of the review's other two
  findings, the deactivated menu still offered and sold from was fixed by `fix/retro-review-719`;
  the other is the "Unchecked since the service plan's Task 8" entry below. The part rows read as
  unit prices ("€9.00 each", "9,00 € c/u", or "€20.00/kg" for a weighed dish) since campaign item
  C32 (#817, branch `fix/basket-refresh-unit-price-label`, 2026-09-28), on the owner's "label
  them". Since campaign item C49 (#831, 2026-09-29), a dish or
  variant now sold by another unit is named too, even when no price changed, and when the unit and
  a price change together, the dish or variant's row, plus a row for each extra whose price
  changed, is shown instead of the line's total.
- **DONE (campaign item C49, #831, 2026-09-29, on the owner's
  go-ahead): the till's price-change dialog names a dish or variant now sold by another unit, even
  at the same price, and C32 (#817)'s two review leftovers are closed.** (2) When a publish sells a
  dish by another unit (say each to kg), the till's price-change dialog now gives the dish a row at
  its unit price on each side, "Hake €20.00 each → €20.00/kg", even when every price stayed the
  same. Before, the till took the new menu without opening the dialog at all: the new case in
  `apps/till/src/till-app-menu-refresh.test.ts` found no dialog when run against the old
  `refreshBasket`.
  When the unit and the dish's price both change, the dish still gets one row, "Burger €9.00 each
  → €8.00/kg", shown instead of the line's total, which cannot show a unit; an extra gets a row of
  its own only if its price changed. (1) The dialog test "lists each re-priced part of one line on
  a row of its own" now feeds part rows with the `units` `refreshBasket` gives them, and expects
  the "each" labels.
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
  registering the non-existent `/sw-probe.js` as "certificate not trusted". That signal is still a
  belief, never checked on a device that clicked past the browser's warning. Since #364
  (2026-09-14) it runs only on pages served over HTTPS: on the plain-HTTP dev server Chromium also
  throws a `SecurityError` for the HTML answer, so every dev till load showed that page. Two gaps
  remain. The signal is trustworthy only while the server answers the probe with 404, which the
  box's `mountSpa` does. And no test covers the HTTPS default: a default of `"http:"` would pass
  every test, because a browser test page cannot be served over HTTPS. **Next action:** during the
  on-device trust rows above, click past the certificate warning on one device and confirm the page
  appears.
- **Location-consistency guard** — nothing enforces that a sale-capable device's register lives in
  the box's configured location, so a mis-provisioned device could stamp a fiscal record with a
  different site. Guard at enrol or first sale.
- **Refuse a request from a device that is not enrolled** (owner design of 2026-08-30, deferred
  until after the demo: [design](superpowers/specs/2026-08-30-device-auth-enrolment-fail-closed-design.md)).
  Tills now enrol, selling needs an enrolled device, and a device profile's capabilities gate some
  actions (`assertDeviceCapability`). But a request that carries NO device still passes both
  `assertDeviceCapability` and `assertNotHandheld` (`apps/server/src/device-session.ts`), and the
  handheld block is still a blocklist. Left: refuse a request with no device, one table of which
  device kinds may do what with a guard that walks the routes, and printer identity (the design's
  sub-project C). It sits on the sale and cash path, so it takes the full review.
- Register/device follow-ups: `WAITRON_TILL_TILL_ID` still seeds a "Caja 1" register while a till
  enrol auto-creates its own; the device-management routes build their `devices ⨝ device_profiles`
  read inline where a `listDevices` store verb belongs.
- **Seven screen faults seen during menus Task 9's look on 2026-09-27.** Seen on the dev stack
  while checking the till's home page, not investigated, and not checked against `main`, so any of
  them may predate that branch:
  - on the till at 390 px wide, the header makes the page wider than the screen;
  - on the till's floor map at 390 px wide, tables overlap one another;
  - in Spanish, the till's tab names "Counter", "Floor" and "Order" stay in English;
  - on the till at 390 px wide, the floating language button covers "Send round" _(2026-09-27:
    Send round was replaced by the draft's action bar; whether the button covers the new bar has
    not been checked)_;
  - on the dashboard, the dialog for a new home page layout is nearly full-screen for a single
    name field;
  - on the dashboard, the publish preview says "Home page layout X changed" both for a layout that
    was added and for one that was deleted;
  - the till's browser console shows Lit's "scheduled an update … after an update completed"
    warning.

  **Next action:** check each against `main`, then fix or file it on its own.

### A5. Incidents and notifications

**Dashboard alerts — LANDED #363/#368/#371.** One bell, panel and Alerts screen for recorded
incidents and live checks (backups, fiscal submission, printing, reader battery). The printing checks
shipped as `agent.silent` and `printer.jobs_waiting`, worked out live on each dashboard read and never
saved, so they can still be renamed cleanly until a venue is live or anything starts saving them.

**Incidents reader and dashboard notification surface — LANDED #368/#371.** A pop-up toast, a
venue-shared handled state, live incident push and the ongoing-check consumers. Still not built: the
pairing consumer, and a standby that has fallen behind.

### A6. Payments

- **A pending card refund does not refuse joining or unjoining tables, though the bill payments
  design says it does.** The design's §5.2 list ("each payment, refund, void, quantity change,
  adjustment, split, transfer, join and unjoin … are refused with `bill.refund_in_progress`",
  [bill payments design](superpowers/specs/2026-09-26-bill-payments-design.md)) names join and
  unjoin. Codex's run-it review of #851 (campaign item A121, 2026-09-29) reported that joining a free
  table to the party and unjoining a table without moving any dishes both succeeded while a card
  refund of the bill was pending, on the branch and on `main` before it; its probes were temporary
  and are not in the tree. Nobody has yet checked whether either can change what the bill charges.
  **Next action:** the owner decides whether the code should refuse them or the design should drop
  them from the list; then a test that tries each during a pending refund.
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
  same moment (an accepted race); Stripe's reader list is one page; low battery now alerts on the dashboard (A5, #371); status
  never refreshes by itself, and polling must go through the passive-session controller.
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
- **What M7b2 left open (a manager clearing a stuck card payment, 2026-09-26).**
  - Stripe Terminal's automatic `resolvePending` sweep is still a no-op, on purpose. During a LIVE
    collect the row is `attempting` and its PaymentIntent waits for a card, so a sweep that cancels
    would cancel a payment a customer is about to tap. Only the manager action, which first checks
    that no attempt is running in this process, asks Stripe, and cancels the PaymentIntent if Stripe
    still allows it.
  - SumUp has no permanent lock: its sweep resolves every `attempting` row against SumUp, and fails
    one SumUp has never heard of after 15 minutes, with an incident. It leaves a row only while SumUp
    keeps answering PENDING. The manager action refuses a SumUp payment
    (`payment.resolve_unsupported`).
  - A Stripe Terminal row written before M7b2 carries no PaymentIntent id, and the resolver treats
    "no id" as "never reached the reader". That holds only for rows the new `collect` wrote; there is
    no backwards-compatibility code (pre-production).
  - On `main` since 2026-07-23 (`39800efd5`): when the reader poll times out or errors, `collect`
    cancels the reader action best-effort and fails the row. If that cancel fails and the customer
    then taps, the money is captured while the local row says `failed`; only reconciliation sees it.
    Now that a resolver exists, leaving such a row `attempting` would hand it to the manager action
    instead. That would also lock the order until a manager acts, so it is the owner's call.
  - Flaky: `packages/payments-sumup/src/dashboard/sumup-add-reader.test.ts`, "calls onClose when
    the dialog is dismissed with Escape", failed once in a run beside two coverage runs and passed
    three times alone (M7b2, 2026-09-26). Not investigated yet; the owner's rule is to fix it at the
    root.
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

**The dashboard shell restyle landed (#333).** Collapsible sidebar groups, a Settings group and a
single person-icon account menu; the rules went into [design-system.md](developers/design-system.md)
and CLAUDE.md §3.

Left open by that branch: the restyle
was only ever checked in screenshots on a desktop browser. Nobody has walked it on the real box or a
phone, so the narrow-viewport banner and drawer are unverified on hardware; that walk belongs with
the display walkthrough in [ui-review.md](ui-review.md). The rest of the dashboard's screens are the
ongoing overhaul listed at the top of Track A.

- **Restaurant menus use “carta” throughout the Spanish dashboard, module, setup and till wording —
  DONE (C55 #858, C56 #901, owner decision 2026-09-29).** The group renamed by C34 (#820) now reads “Productos
  y cartas”, and the menus page reads “Cartas”. Menu prices, previews, shared-list usage, setup
  guidance and the image library use the same noun and feminine agreement. Account and row-action
  menus retain “menú”. The till followed (C56): its menu switcher's name reads “Carta”, the service
  area's refresh button “Actualizar cartas”, and its load failure “No se pudieron cargar las cartas
  de esta zona”; `apps/till/src/i18n/strings.test.ts` fails if any Spanish string in the till's
  catalogue (`apps/till/src/i18n/strings.ts`) says “menú”; the till's error-code messages and
  allergen names (`apps/till/src/i18n/codes.ts`, `apps/till/src/i18n/allergen-names.ts`) are not
  scanned.

- **The sidebar's sections now open folded shut (C35, #822, owner decision 2026-09-28).** Two
  leftovers from its review, not fixed:
  (1) Outside a search, the header of the section holding the current page stays
  clickable (during a nav search the headers are plain labels, C46), but a click changes nothing on
  screen until you open a page outside that section (the section shows open because it holds the
  current page; the click only records a collapse for later). The old code had the same no-op.
  `wt-disclosure` and `wt-data-table` instead hide or disable a collapse control that would do
  nothing. **DECIDED (owner, 2026-09-29): the header is not changed.** Instead each section gets an
  info page, which its header would open — the next entry.
  (2) **A test that guards nothing:** "keeps the clicked group header at the same on-screen position…"
  in `apps/dashboard/src/dashboard-app.test.ts` still passes with the scroll correction in
  `#toggleGroup` deleted — on `main` at 55504ee1b too, before C35. Making it catch a missing correction
  needs a layout where the browser pulls the list back on its own, which may not be reachable; next
  action is to find out whether it is, then either fix the test or drop the correction and its test.

- **Every dashboard sidebar section gets an info page — OPEN (owner, 2026-09-29).** A page saying
  what the section is for and what is in it, opened by the section's header. It replaces the
  question C35 left about the header of the section you are on. **Next action:** brainstorm what
  each section's page says; it needs a spec.

- **A generated display name is the first given name and first surname (C38, #827, owner decision
  2026-09-28).** `deriveDisplayName` (`packages/shared/src/derive-display-name.ts`) takes the first
  word of each field, so "María José" + "García López" gives "María García". Shorter names collide
  more often, so the add-person, edit-person and profile forms now show `person.display_name_taken`
  beside the display-name field. Since C54 (#853) the add-person and edit-person forms
  (`apps/dashboard/src/widgets/person-form.ts`, `person-edit.ts`) also put `person.email_taken`,
  `person.email_invalid` and `person.telephone_invalid` under their field, with the action still
  working. Left as they were, from #827's review: unlike the two staff forms, the profile screen keeps a
  taken-name message beside the display name when a first- or last-name change regenerates that
  name (`apps/dashboard/src/screens/profile-screen.ts` drops only the changed field's refusal); and the
  two staff forms turn the refusal into a field message inside the form, where other dashboard forms
  receive field messages from their parent screen.

- **Money in the dashboard shows its currency sign, on the side the language writes it (C43, #830,
  owner request 2026-09-28).** Every amount the dashboard shows goes through `formatMoney`
  (`packages/shared/src/money-format.ts`): catalogue and menu prices, the overview's takings, the
  sales screen's tables, top sellers, purchases, and the payment alerts, whose wording marks a money
  slot `{amount:money}` (the wording is in `apps/dashboard/src/i18n/alert-messages.ts`, and
  `packages/dashboard-kit/src/alert-messages.ts` formats the slot). Every money field is a
  `wt-price-input` given `locale`, which draws the sign inside the field, before the amount in
  English and after it in Spanish, and, where nothing stretches the box, widens it by the sign so an
  amount that fitted before still fits. EUR is the only currency; there is no currency setting. The
  payments screen, the menu preview and the adjustments reasons screen's limit summary already
  wrote their amounts with `formatMoney`, and the image library, bookings, venue-service, Stripe
  and SumUp dashboard screens show no money. Left open, not fixed: (1) the catalogue, menu and purchase price fields accept and show a dot decimal only,
  so a Spanish field shows `9.00` with the sign after it while the same amount displayed beside it
  reads `9,00 €` (the adjustments limit field shows its saved value with a comma); (2) the alert
  check that every money slot is marked looks only at slots named `amount`, `captured` and
  `expected`, so a new money slot under another name is seen by nothing; (3) the purchase form's
  VAT line still lets its other fields shrink to `min-width: 5rem`
  (`apps/dashboard/src/widgets/purchase-form.ts`), a `rem` the design-token rule forbids; it
  predates this change.

- **Every dashboard list shown with `wt-data-table` lets each person choose its columns (C45, #834, owner
  request 2026-09-28).** The main list on the products, staff, categories, labels, units, modifiers,
  sections, menus, printers (agents, printers and print queue), card readers, alerts (open and
  handled), adjustment reasons and venue operations (departments, hours, zones, zone menus, routes)
  screens offers a Columns chooser, as the menu Prices tab already did. The column naming the row
  and the column holding the row's buttons are never offered; every other column starts shown, so
  each screen looks as it did until someone hides a column. Each table has its own `viewKey`; the
  ones that had none (alerts, print queue, card readers, staff, reasons, venue operations) now also
  remember their sort and filter in the tab. `docs/developers/design-system.md` states the rule.
  Left open, not done: (1) tables inside a dialog or picker (a unit's products, a category's members
  and its add picker, the delete dialogs, a modifier list's usage, discovered printers) offer no
  chooser, by choice; (2) the servers list (`apps/dashboard/src/screens/servers-screen.ts`) offers
  no chooser: its one column beside the buttons holds the address, the machine id, the role and, on
  its own row, "this server" together, so there is nothing to offer unless that cell is split into
  separate columns — **DECIDED (owner, 2026-09-29): leave it**, unsplit and with no chooser; (3)
  the unused category-manager widget and its tests are removed by the product-folders slice; (4) nothing checks that a NEW dashboard table offers the
  chooser; (5) where a screen keeps its search and filters outside the table (staff, card readers)
  or the table has none (alerts, venue operations), the Columns button sits alone on a row above the
  table rather than beside those controls — seen in real Chromium at 1280 px; moving a screen's own
  controls into the table's toolbar would fix it; (6) the read-only tables a few screens draw as
  plain HTML tables rather than `wt-data-table`s have no chooser: planned against actual
  (`apps/dashboard/src/screens/planned-actual-screen.ts`), the roster
  (`apps/dashboard/src/screens/roster-screen.ts`), the four report tables on the sales screen
  (`apps/dashboard/src/screens/dashboard-sales-screen.ts`), the overdue table on the overview
  (`apps/dashboard/src/screens/dashboard-overview-screen.ts`) and the top-sellers table both of
  those screens show (`apps/dashboard/src/widgets/top-sellers-table.ts`). The plain tables inside
  editing forms (`variant-table.ts`, `member-list-editor.ts`, `option-list-form.ts`,
  `extra-list-form.ts`, `product-editor.ts`) are not counted here; (7) the printers screen's view
  keys (`printers:agents`, `printers:table`, and `printers:jobs`, which this change added to match
  them) are the only dashboard view keys that use a colon and lack the `waitron.` prefix — cheap to
  rename until a venue is live.

- **A search box at the top of the dashboard sidebar finds a page by its name or its group's name
  (C46, #836, owner request 2026-09-28).** It lists only the pages the person may open (the same checks
  the sidebar already applies), ignores case and accents, opens a group with a match without
  changing which groups are folded, says "No pages match." when nothing does, and opens the first
  match on Enter; opening a page empties the box. `docs/developers/design-system.md` → "Dashboard
  sidebar navigation" describes it. Left open, not fixed: the new accessibility case checks the
  search box and its message only, because at desktop width (1280 px) the light theme's sidebar
  headers and current page already fail the colour-contrast rule — the primary-blue entry under "Also
  open, and product-wide" above, which computes the pair as 4.33:1 from the token values; axe reports
  the same pair as 4.32:1 because axe truncates to two places (axe-core computes
  `Math.floor(contrast * 100) / 100`) while the older entry rounds. Measured 2026-09-29 by running
  axe at 1280 px over the dashboard with this branch's production changes reverted to a5474be6e: six
  colour-contrast failures at 4.32:1 in the light theme, none in the dark; the narrow-drawer cases
  pass. Two choices the branch made are **DECIDED (owner, 2026-09-29): keep both** — "ñ" is matched
  as "n", so "espana" finds "España"; and the box is not pinned, so it scrolls away with a long
  sidebar.

- **A form's message about a failed submission sits at the bottom of the form, on its own line above
  the buttons (C97, owner 2026-09-30) — DONE (2026-10-01, #961).** The one message a form shows about a
  failed submission is no longer beside the buttons: it runs full width from the form's left edge,
  aligned to the start, on its own line just above the button row, at every width. In a dialog it
  is the last thing in the dialog's scrolling body, below the last field, and is scrolled into view;
  the pinned footer holds only the buttons. `wt-form-actions` (`packages/ui-core`) draws it above
  its buttons, and `wt-dialog` and `wt-modal` (`packages/ui`) take the message of a
  `wt-form-actions` placed directly in their footer and show it in the body. Where a button row
  shares a line with something else, the screen places the message itself: the dashboard's sign-in
  steps show it above the list of other ways to sign in and the buttons (`formMessage`, now exported
  from `@waitron/ui`), and the Add printer dialog's address check lets its button row take the
  panel's full width while it has a message. _(2026-10-01, C105: in a `wt-modal` the form's message,
  and the Printers screen's rows of fields including the Add printer address check, now stop at
  `--wt-form-max-width`; see the C105 entry.)_ A dialog with more than one action row in its footer
  shows every row's message, joined; a dialog opened with a footer row's message already present
  scrolls it into view as it opens; and a row placed in a dialog's body, which keeps its own message, has that
  message scrolled into view when it appears. None of these scrolls happens when the message changes
  from an `input` event inside the dialog until a zero-delay timer the dialog then sets has run
  (typing, a native list, a tick box; a `wt-combobox` choice, a
  `wt-number-stepper` −/+ button and `wt-price-input`'s unit button fire no `input`, so a re-check
  they cause is still scrolled to): a form that re-checks its fields on every keystroke clears and re-shows its message as the
  person types, and a measured case scrolled a long dialog 1,773 px away from the focused field. A
  refusal that comes back after that timer has run is scrolled to, even while focus is still in a field.
  These dialogs drew their own message instead and now pass it to their footer `wt-form-actions`:
  the categories screen's delete dialog (`#dialogMessage`, removed) and products window, which drew
  a refused add at the top of its body; the staff screen's row action confirmation; the delete
  dialogs on the modifiers, catalogue, sections and labels screens; the servers screen's remove and
  clear confirmations; the menus screen's layout delete; and the image library's image delete.
  Open follow-ups: three dialogs still draw their own refusal because none has a `wt-form-actions`
  row in its footer to hand it to: the menus screen's add-products window has its row inside the
  `section-add-products` component, and `packages/bookings/src/dashboard/booking-form.ts` and
  `apps/till/src/widgets/supervisor-override-dialog.ts` put bare `wt-button`s in the footer slot.
  Browser tests hold the placement on location settings, the setup wizard's connect form, the
  profile screen's Add passkey dialog, the sign-in passkey step and the address check, at 1280 and
  390 pixels wide where the width matters. A `wt-form-actions` wrapped in another element inside a
  dialog's footer would keep its message in the footer; none does today.
  Not looked at on screen after the review fixes: the screenshots (56, light and dark, 1280 and 390,
  EN and ES for the sign-in steps and the passkey dialog) were taken before them, on 05974c855.

- **A form in a modal stops at one standard width instead of running edge to edge (C105, owner
  2026-09-30) — DONE (2026-10-01, #965).** On a wide window the printer calibration wizard's selects and
  its "Print block" button ran the whole width of the modal. The owner chose one standard form width
  inside the one standard modal, rather than a narrow and a wide modal. `--wt-form-max-width`
  (36rem, 576px at the default text size) is that width: `wt-modal` hands it to its body, and every
  shared field (`wt-input`, `wt-combobox`, `wt-price-input`, `wt-number-stepper`, `wt-switch`, a
  native select styled by `selectStyles` together with a label that wraps it) and the form's message
  line stop at it, as do the fields the profile, venue operations and content-languages screens style
  themselves, the adjustments reasons screen's role fields, whose label sits outside the select, and
  the section member list's add row and its error. Tables, previews and other wide content keep the
  modal's full width, the footer buttons do not move, and at 390px wide nothing changes. The
  Printers screen's row of fields takes the same width, so "Print block" stays beside its select.
  Fields on pages and in a `wt-dialog` outside a modal are unchanged.
  `docs/developers/design-system.md` → "Structure" records the standard. Left open: a
  `wt-disclosure`'s heading row (the calibration wizard's "Advanced text settings") and a screen's
  own paragraphs still run the modal's full width; the product editor's description `<textarea>`,
  which the screen styles itself, is not capped; the content-languages editor's rows of enabled
  languages still put each Remove button at the modal's far edge (left for C111, which rewrites that
  screen); a native select labelled by a separate `<label for>` keeps that label, and an error
  outside it, at the modal's full width unless its screen caps the element wrapping them (the
  adjustments reasons screen does; no other one was found in a modal); an inline label around a
  select is not capped, so its select would sit beside the label text (none was found in a modal);
  and forms built in `wt-dialog` rather than `wt-modal` (the ingredient form, the till's party name
  dialog, among others) are held only by the dialog's own 768px limit — whether they should follow
  the modal's form width is the owner's call.

- **A field's hint shows inside the empty field as its placeholder, not as a line under it (C104,
  owner 2026-09-30) — DONE (2026-10-01, #966).** _(2026-10-01, C119: the bill discount limit's
  explanation now sits in a paragraph above the field; see the entry below.)_ The owner, on the Pair
  a Bluetooth device dialog's PIN field: "put the hint line in the field, not under it", and "that
  should be a standard". The three shared fields that take a `hint` (`wt-input`, `wt-price-input`,
  `wt-number-stepper`; no other shared field has one) now use it as the placeholder when the screen
  sets none, so every hinted field follows without its screen changing. A placeholder the screen
  sets wins, and the hint is then the field's screen-reader description only. The hint stays in the
  field, hidden from sight, as that description in every case. A hint too long for the field is cut
  with "…", but only while the field is not focused: Chromium clips a focused field's placeholder at
  its edge with no "…" (seen in Chromium screenshots of three 250px fields, one focused).
  `docs/developers/design-system.md` → Forms records the standard. Looked at in light and dark,
  English and Spanish, 1280 and 390 px wide: the PIN field, the extras form's two steppers, a menu
  price, the adjustments limit and a reason's two limits, and the till's party name and seat
  dialogs. Left open, the owner's call: the adjustments screen's bill discount limit carries a hint
  of several sentences in a narrow percentage box, so only its first few letters show ("Discoun…",
  "Los des…"); a menu price's "Leave it empty to use the product price" and the extras form's "Blank
  means no limit" are no longer seen by anyone sighted, because those fields set a placeholder of
  their own; and the extras form's minimum starts at 0, so its "0 makes the list optional" shows
  only once the box is cleared. Help written as a paragraph beside a field, not as its `hint` (the
  sections screen's internal name help, the product editor's help lines), still sits under its
  field.

- **The bill discount limit's explanation sits in the text above the field, not cut off inside it
  (C119, owner 2026-10-01) — DONE (2026-10-01, #967).** The owner, on C104's note that only "Discoun…" /
  "Los des…" of it showed: "Move discount text". On the adjustments reasons screen, the "Limit on a
  bill's discounts" section now explains the limit in a paragraph under its heading, in the same
  muted style as the page's own introduction, with the wording unchanged in English and Spanish; the
  percentage field has no hint, so the empty box shows nothing. The field no longer carries the
  explanation as its screen-reader description; the paragraph is the text after the section's
  heading, inside the section that heading names. Looked at in light and dark, English and Spanish,
  at 390 and 1280 px wide, with no limit set and with 15%. The owner chose to leave as they are the
  other hints cut off in their fields, and the fields whose own placeholder shows instead of their
  hint.

- **A form says what went wrong under each field and once beside its action button, never in a
  box at the top (C47 part 1, #838, owner rule 2026-09-28).** _(2026-10-01, C97: the message now
  sits on its own line at the bottom of the form, above the buttons, not beside them; see the entry
  above.)_ `wt-form-actions` gained an `error`
  message shown beside the buttons and announced to screen readers, and `focusFirstInvalid`
  (`packages/ui-core/src/interactive.ts`) moves focus to the first marked field after a failed
  submission. The forms in `apps/dashboard` follow it, and so, since C47m (#839), does the image library's
  upload and edit dialog (`packages/media/src/dashboard/image-library.ts`): after the first failed
  press each bad field
  shows its message, the bottom message asks to fix the marked fields and the action stays disabled
  until they are fixed; a refusal that names no field on the form (a failed save, a conflict) is the
  bottom message instead and leaves the action working, so the person can try again. In the image
  library that bottom message reads "The image could not be saved." followed by the refusal's own
  sentence (`image.save_error`), where the design guide asks for the refusal's sentence alone;
  **DECIDED (owner, 2026-09-29): leave it.**
  `docs/developers/design-system.md` → Forms states the rule. **The owner restated the rule on
  2026-09-29:** the button works until the first press; a form validation error (a field the form
  itself finds wrong) keeps it disabled until fixed; an error that comes back from a request (the
  server refused, or it could not be reached) leaves it enabled. **Done by C54 (#853):** in the forms it surveyed — the
  dashboard, the setup wizard, and the adjustments, venue-service and media module screens — a
  request's refusal no longer disables the action by itself (when handling it empties or reveals a
  required field, that field's own check holds the action until the field is filled), a refusal
  that names a shown field is said under that field, and `docs/developers/design-system.md` → Forms and CLAUDE.md §3 state it. Deliberate exceptions in
  `apps/dashboard`: the add-to-menus dialog (`apps/dashboard/src/widgets/add-to-menus.ts`) keeps its
  list of places that failed, and its menu-load error, at the top of the dialog; the backups panel's
  refusal paragraph (`apps/dashboard/src/screens/stream-settings-panel.ts`) stays directly under the
  form's buttons, because it also reports a refused Turn off, when no form is open; the cloud
  services screen (`apps/dashboard/src/screens/cloud-services-screen.ts`) has no form, only buttons,
  and shows a refusal as a plain alert; the delete confirmations in
  `apps/dashboard/src/screens/labels-panel.ts` (deleted with product labels on 2026-09-30) and
  `apps/dashboard/src/screens/sections-screen.ts`
  keep their refusal in the dialog's body; and the sections editor's member-list edit and reload
  errors (`apps/dashboard/src/screens/sections-screen.ts`) stay as paragraphs above the member list,
  because each member change is saved at once, not on a submit. Outside `apps/dashboard`, the image
  library's delete confirmation also keeps its refusal in the dialog's body. _(2026-10-01, C97:
  these three delete confirmations now pass their refusal to the dialog's footer row; see the C97
  entry above.)_ Since C47s (#840) the setup
  wizard's forms follow the rule too: the admin, connect, reset, venue, certificate, restore,
  bucket-restore, Cloud-restore and live-source screens. The wizard's screens with no fields —
  review, fiscal test, connection and provisioning — keep their refusal paragraph, as the cloud
  services screen does, and in Demo the venue screen's "Demo invoice settings have not loaded yet."
  alert (`data-test=defaults-error`, with its retry button) stays above the form, as a load failure
  rather than a refusal. Since C47 part 2 (#841) the dashboard module screens follow the rule too: the
  adjustment reasons editor, the Stripe and SumUp connect forms and add-reader dialogs, and the venue
  operations editors. A refused card-provider key (`payment.provider_credential_rejected`) is said
  beside Connect and leaves it working, because the code carries only the provider's id: each
  package's `card-provider.ts` `connect()` raises it for an empty key, for any failure of its one
  lookup call to the provider and, in SumUp's, when that lookup finds no merchant. **DECIDED (owner,
  2026-09-29): leave Connect working** after that refusal. A refused SumUp
  pairing request is said beside Pair, with the form kept. On the venue operations screen a failed
  load, and with no editor open a refused list action or setting that saves at once, is a plain
  alert where the summary was; an open editor keeps its own refusal beside Save, apart from a failed
  list refresh, and puts a server refusal that names a field under that field. Left open, not done:
  (1) the setup wizard's Demo gaps, listed under *Demo gaps on the setup wizard's venue screen*
  earlier in this file; (2) **done by C48 (#892):** three of the till's forms follow the rule — the seat
  dialog, the device join screen and the bill split step (the split step's top summary, from Task
  10's #875, included). The join screen's refusals, which named no field, moved from a banner at the top
  to the message beside Ask to join, where each now stays until the next press rather than going
  on a retype. The split step's Split button is still disabled before any press until a dish is
  picked, kept on purpose because it counts a selection rather than checking a field; the transfer
  step's confirm button does the same, disabled until a bill and a dish are picked; (3) `wt-form-error-summary` is deleted once
  nothing uses it — besides its own files and exports in `packages/ui-core` and `packages/ui`, the
  `packages/ui` workbench demo (`packages/ui/demo/main.ts`) and the consumer test page
  `packages/ui-core/test/consumer/main.ts`, which `packages/ui-core/test/package-consumer.test.mjs`
  loads, still use it; of the other test files that name it,
  `packages/ui/src/core-compatibility.test.ts` reads it, and the rest only check that it is absent;
  (4) the profile screen, opened with required details missing, marks those fields at once, before
  any press (two existing tests pin it), unlike every other form; (5) the form plumbing is
  hand-written per form:
  assembling the bottom message (a refusal's sentences, then `form.fix_fields`, joined), waiting for
  the render and then calling `focusFirstInvalid`, and the state that remembers the first press and
  which refusals the person has since changed — an `attempted` flag beside one of five shapes: a
  `dismissed` set or a `refused` map in `apps/dashboard`; in the image library, a single `refusal`
  holding one field and its error code; in the four Stripe and SumUp connect and add-reader forms, a
  plain `refusal` string; and in the adjustment reasons and venue operations screens, a
  `refusedFields` map beside an `editorError` string. In `apps/till` the party name dialog, seat
  dialog, device join screen and bill split step each build their own bottom message from
  `form.fix_fields` and a flag set on the first press (`attempted`, and `splitAttempted` on the
  split step); the party name dialog also keeps a `refusal` string, the server's refusal of the
  name, cleared when the name changes; the join screen puts a refusal's sentence before it. Each of these pieces appears in
  many forms
  (`grep -rl form.fix_fields apps/dashboard/src` lists the dashboard's; the image library, `packages/media/src/dashboard/image-library.ts`, uses its
  own key `image.fix_fields` and is not in that list; the four module packages each use their own
  sentence — `adjustments.fix_fields`, `payments.stripe.fix_fields`, `payments.sumup.fix_fields`
  and `venue.fix_fields`), and `placeErrors` is written twice, in
  `menus-screen.ts` and `sections-screen.ts`; a follow-up could move the first two into one helper
  in `apps/dashboard/src/widgets/form-fields.ts` and the state into a controller in
  `apps/dashboard/src/state/`, but that covers the dashboard only: `packages/media` cannot import
  from `apps/dashboard` (the dashboard depends on `@waitron/dashboard-modules`, which depends on
  `@waitron/media`, so it would be a dependency loop), so a helper meant to cover the module screens
  and the image library too would have to live in a package they can all reach, such as
  `@waitron/ui`, which all four module packages already depend on; (6) the image picker's error message is not read to a screen reader:
  `apps/dashboard/src/widgets/category-form.ts` and `apps/dashboard/src/screens/sections-screen.ts`
  put `aria-describedby="category-image-error"` / `"section-image-error"` on the
  `dashboard-image-upload` host, and an id outside a shadow root describes nothing inside it
  (`docs/developers/design-system.md` → Forms); now that the Choose image button inside it carries
  `aria-invalid` and takes focus, a screen reader hears "invalid" with no reason. The
  `aria-describedby` on the host predates C47 part 1 (both files carry it at 4fcac1646); (7) the
  till's schedule screen (`apps/till/src/screens/till-schedule-screen.ts`) does not follow the rule
  yet: its cover request keeps its button disabled until a shift and a colleague are chosen, and its
  absence request until both dates are filled, before any press; neither shows a message beside its
  fields; and a refusal shows as a `role="alert"` notice at the top of the card. Other till
  surfaces were not checked against the rule either, and whether a number pad or a choice picker
  counts as a form under it is open: the payment and weighing steps
  (`apps/till/src/widgets/tender-pay.ts`) keep Confirm payment disabled while the cash entered is
  below the total and Add disabled while the weight is invalid, before any press, with no message;
  the dish options picker (`apps/till/src/widgets/modifier-picker.ts`) keeps Add or Save disabled
  until its required choices are made, and shows changed or unavailable choices as `role="alert"`
  paragraphs rather than beside a field; and the supervisor override dialog
  (`apps/till/src/widgets/supervisor-override-dialog.ts`) keeps Authorize disabled while the PIN is
  empty and shows a refusal as a `role="alert"` paragraph.
  **DONE (C53, 2026-09-29): SumUp Cancel checks pairing once more before cleanup** (owner's
  ruling on C47 part 2, option B: keep a reader known to be paired). The add-reader dialog closes
  immediately; a final status reply of `paired` calls `onAdded` and skips unpairing, including when
  the pair POST returns `processing` after Cancel. A processing, missing or failed status still
  takes the cleanup path. Browser regressions cover a reader pairing between the last poll and
  Cancel, a reader still processing, delayed POST completion, and a failed final read. Direct
  removal without Cancel, expiry and polling failure retain their existing cleanup behavior.
  The C53 review's slow-poll browser probe observed two status reads in flight on Cancel, one
  `onAdded`, one `onClose` and no unpair: the final read does not share the pending poll. Physical
  SumUp timing and the parent readers screen's refresh after the closed dialog's `onAdded` were
  not exercised by that review or the dialog harness.
  Found during part 2 and not fixed: (a) a bad Stripe reader id reaches the add-reader dialog as
  `server.internal`, so it cannot be told from a server fault — the Stripe seat's `readers.add`
  (`packages/payments-stripe/src/card-provider.ts`) lets the Stripe library's own error through,
  and the error boundary (`packages/server-kit/src/error-boundary.ts`) answers anything that is not
  an `AppError` with `server.internal`; (b) the Stripe add-reader dialog
  (`packages/payments-stripe/src/dashboard/stripe-add-reader.ts`) shows "Reader ID" twice, a
  separate label carrying the help icon and then the input's own label, where `wt-input`'s `help`
  slot would do; (c) a refused save of a venue operations setting that saves at once shows twice,
  beside the control and in the screen's alert (`#pageAlert`,
  `packages/venue-service/src/dashboard/venue-operations-screen.ts`), as it did before part 2, and
  existing tests pin both; (d) `wt-switch` cannot be marked invalid, so a server refusal of an
  adjustment reason's note-required switch would show its message but move focus nowhere — though the server refuses `noteRequired` only when it is not a true/false value
  (`requireFlag`, `packages/adjustments/src/routes.ts`) and the screen always sends one from its
  switch, so the refusal is not expected from this screen; (e) in a screenshot of a `wt-modal`
  editor after a refusal that names no field, a blue line runs along the top of the footer, which
  looks like the modal's scrolling body showing a focus ring — not traced, and not checked against
  `main`; (f) `closes on Escape without saving` in
  `packages/adjustments/src/dashboard/reasons-screen.test.ts` failed twice in about five runs while
  other browser suites ran beside it, then passed 27 times in a row; the failure text was not kept
  and the cause is not established. (e) and (f) are observations from the implementer's session.
  _(2026-09-30, service plan Task 11 (#916): (f)'s cause was found — Chromium
  reports the dialog's close with the next animation frame, so the test checked too early; that
  test now waits for the close.)_

- **Request refusals that still land in the bottom message, or under a field in generic words —
  OPEN (left by C54, #853).** In the forms C54 surveyed (the dashboard, the setup wizard, and the
  adjustments, venue-service and media module screens) it kept the action working after a request's
  refusal and put a refusal naming a shown field under that field. What it left, each
  for the reason given with it: (1) forms that put a refused field's message under it in generic
  words, in two halves. **Dashboard half, OPEN:** the product editor and the venue operations
  editors put a refused field's message under it in their generic words (`editor.field_rejected` in
  `apps/dashboard/src/screens/catalogue-screen.ts` `#rejectedField`; `venue.field_refused` in
  `packages/venue-service/src/dashboard/venue-operations-screen.ts`), not the refusal's own
  sentence. **Setup half, DONE (C62, #895, 2026-09-29):** the setup screens now agree on what goes under a
  refused field — a sentence about that field alone. Connect and reset already showed the field's
  own "Check the …" sentence (venue shows one that says what is wrong with the field — `SERVER_FIELDS` in `apps/setup/src/server-fields.ts`), and the
  restore screen now does too ("Check the backup file.", "Check the recovery key.", "Check the
  backup environment.", and for `restore.environment_mismatch` "The backup comes from the other
  environment. Choose the environment it came from.") instead of the whole-form "The backup could
  not be staged. Check the file, key and environment. ({code})"; the bucket-restore screen does the
  same for `setup.request_invalid` ("Check the recovery kit.", "Check the environment.") and keeps
  its own sentences for `backup.stream_kit_invalid` and `restore.environment_mismatch`, which
  already speak about that one field and say which way it is wrong (`RESTORE_FIELD_CHECKS` and
  `BUCKET_FIELD_CHECKS` in `apps/setup/src/setup-app.ts`; tests in
  `apps/setup/src/setup-app.test.ts`). design-system.md → Forms gained a sentence stating the setup
  wizard's rule ("In the setup wizard the sentence under the field speaks about that field alone").
  **DONE (A152, #947, 2026-09-30):** on the bucket-restore screen a `setup.request_invalid` naming
  `oldBoxGone` or `venueConfirmed` (the two tick boxes) no longer shows "Check the kit and the
  environment": `BUCKET_FIELD_PATHS` places both, and the sentence speaks about that tick box alone
  — "Check your answer about the old server." / "Revisa tu respuesta sobre el servidor anterior."
  and "Check the confirmation that this is your business." / "Revisa la confirmación de que este es
  tu negocio." It shows under the tick box, which is marked, when the tick box is on the screen; the
  two appear only once the server has asked, so when the server has not asked, the same sentence
  shows beside Restore and no field is marked. Changing the tick box drops the refusal, and so does
  replacing the recovery kit, which also hides both tick boxes. A `setup.request_invalid` naming no
  field now says "The server rejected the details. Check your entries, then try again."
  (`shell.bucket.request_invalid`) rather than naming the kit and the environment. Tests in
  `apps/setup/src/setup-app.test.ts` check the English sentences, where each shows, that changing
  the tick box drops the refusal, and the no-field sentence;
  `apps/setup/src/screens/restore-bucket-screen.test.ts` checks that replacing the kit drops it,
  whether it showed under the tick box or beside Restore, and that one already dropped by changing
  the tick box does not reappear beside Restore; none checks the Spanish wording. _(2026-10-01,
  C97: that sentence now sits above Restore.)_ The server
  refuses those two only when they are the wrong type
  (`apps/server/src/setup-api.ts`), which the wizard's own request never sends: the wizard types
  them `boolean` and `string | null` (`BucketRestoreRequestDetail`, `apps/setup/src/events.ts`),
  and the client leaves out a null `venueConfirmed` (`restoreFromBucket`,
  `apps/setup/src/api/client.ts`). So only a client bug or a request built outside the wizard
  reaches it.
  Still OPEN: (2) controls with no place for an error keep their refusal in the
  bottom message — `wt-switch` (`active` on the ingredient, extras, options and menu-price forms;
  `available` on the product editor), the allergen and dietary-origin pickers on the ingredient
  form, and the purchase form's VAT regime select; (3) refusals naming two fields or a row the refusal does not number stay
  at the bottom: `purchase.duplicate` (supplier tax id and invoice number), a purchase line's rate,
  base, tax or type, a variant price on the menu price window, `hours.N` on venue operations,
  `provisioning.duplicate_series_code` and `territory_country_mismatch` on the setup venue screen;
  (4) **DONE (C63, #860, 2026-09-29):** the backup screen's retention boxes are checked by the form on
  Apply and on Save. A box is valid when `Number()` reads its text as a whole number of at least 1
  and no larger than JavaScript's safe-integer limit, so `7.0` and `1e2` are accepted and sent as 7
  and 100. A blank, zero, negative or fractional box sends nothing and says "Enter a whole number of
  at least 1." under itself; focus moves to the first such box, and the action is held until every
  box is fixed. A box above the safe-integer limit, which the server would accept, gets the same
  sentence. A
  `backup.request_invalid` naming `retention` from the server puts that same sentence under both
  boxes, moves focus to the first box, and leaves the action working. Tests:
  `apps/dashboard/src/screens/backup-screen.test.ts`. A blank is read as invalid, not "keep the
  current value", because the server's `readRetention` (`apps/server/src/backup-api.ts`) takes no
  absent value. Still open there: a refusal naming `destinationDir` or `schedule` still shows in the
  page banner rather than under the folder field or above the button (both seen by running, in the
  Codex run-it review of C63), and so, read and not run, does every other refusal; the backup folder is required but not
  marked, and Turn on backups stays disabled before the first press until the folder is filled and
  the key is saved — the same shape as (7) (both seen by running, in the Codex run-it review); and,
  read and not run: the settings editor's Save changes is also disabled before any press while the
  folder is blank (`#saveSettingsDisabled` in `apps/dashboard/src/screens/backup-screen.ts`); apart
  from the two retention boxes and the configuration-export passphrases, the form's inputs (the
  destination folder, the pasted key, the saved-it tick, and the day and time choices) carry no
  `name`; and the screen does not submit on Enter (`submitOnEnter`, which design-system.md → "Submit
  ordinary forms with Enter" asks for and `stream-settings-panel.ts` uses); the two retention boxes
  are hand-built `<input type="number">`s rather than the shared `wt-input` that Forms prefers, left
  so because switching changes how an older test fills them in; and no test covers only the second
  box being invalid, or where focus lands after a failed check on the Save form (#860's review);
  (5) **DONE (C64, #893, 2026-09-29):** the setup connect screen no
  longer comes back empty after a refusal that routes back to it. The shell keeps the body it sent,
  in this tab's memory only, and hands it back to the rebuilt form (`connectRequest` in
  `apps/setup/src/setup-app.ts`, the screen's `request`), as the restore screens already did; leaving
  the screen or a successful Connect drops it. Tests: "what the operator typed on the connect form"
  in `apps/setup/src/setup-app.test.ts`, and the connect screen's own `request` case.
  **DONE (C87, #918, owner decision 2026-09-30):** the refilled form leaves the one-time code empty
  and keeps every other field; a refusal naming the code (`credential.totp`) puts its sentence
  under the empty field and focuses it (the screen's `request` in
  `apps/setup/src/screens/connect-screen.ts`; tests:
  "leaves the one-time code blank when the request the shell hands back carries one" in its suite,
  and "shows a refusal of the one-time code under that field, empty and focused" in
  `apps/setup/src/setup-app.test.ts`). A refused code is not such a refusal: the primary refuses it
  as `totp.invalid`, and this box's fetch turned any refused answer into
  `mirror.bundle_fetch_failed`, which names no field (`apps/server/src/mirror-bundle-fetch.ts`), so
  it showed beside Connect with the code field empty and unmarked (owner 2026-09-30: pass
  `totp.invalid` through so it sits under the code field; queued as lane C's C92). **DONE (C92, #924,
  2026-09-30):** the box's fetch passes two of the primary's refusals through under their own
  codes, rebuilt on the box so nothing else the primary sent travels on: `totp.invalid` (the box
  answers it 401) and `person.not_found` (404, naming the person id the box sent) — the only two of
  the primary's refusals that the operator can fix by retyping one field of the connect form
  (`STATUS` in `apps/server/src/mirror-bundle-api.ts`; `person.suspended` names the person id too,
  but the id is right, so it stays `mirror.bundle_fetch_failed`; `password.invalid` also answers a
  malformed person id there, so it names no one field and stays `mirror.bundle_fetch_failed`, as
  does everything else). `person.not_found` passes through only when the typed id is UUID-shaped,
  the only shape the primary answers it for, so the box never repeats an arbitrary typed string
  back. The wizard puts the first under the code field, empty and focused, and the second under
  the person-ID field (`refusalFrom` in `apps/server/src/mirror-bundle-fetch.ts`, `ADOPT_STATUS`
  in `apps/server/src/setup-api.ts`, `ADOPT_FIELD_CODES` in `apps/setup/src/setup-app.ts`; tests:
  "passes the primary's refusal of the one-time code through…", "does not pass person.not_found
  through for a person id that is not UUID-shaped" and the cases beside them in
  `apps/server/src/mirror-bundle-fetch.test.ts`, "answers the primary's refusal %s from adopt…" in
  `apps/server/src/setup-api.test.ts`, and "shows the primary's refusal of the one-time code under
  that field…" and "shows the primary's person.not_found…" in `apps/setup/src/setup-app.test.ts`).
  **REVERSED (C95, owner decision 2026-09-30):** a login's refusal must not say whether the
  account exists, so both pass-throughs are gone. The primary now refuses every credential cause
  (unknown id, suspended, wrong password, wrong or missing code) as `password.invalid`; the box
  relays that one code (401, rebuilt with no params) and the wizard shows one "the login failed"
  sentence beside Connect, marking no field (`shell.adopt.login_failed`). _(2026-10-01, C97: that
  sentence now sits above Connect.)_ The same decision answers
  #924's review question of whether a suspended admin should get its own sentence under the
  person-ID field: it does not. See "Every login failure is one answer" below.
  A CORRECT code
  was refused the same way until C91: the primary's mirror-bundle route called `loginManagerById`
  without the key ring that decrypts a stored authenticator secret, so an admin with an
  authenticator set up could not connect a standby at all. **DONE (C91, #921, 2026-09-30):** the route
  passes the ring the server builds in `apps/server/src/boot.ts` (`credentialKeyRing` in
  `apps/server/src/mirror-bundle-api.ts`). Test: "signs in an admin with an authenticator who sends
  a correct current code" in `apps/server/src/mirror-bundle-api.test.ts` enrols an authenticator
  through the profile's own two enrolment calls and joins with a current code; before the fix it
  drew 401 `totp.invalid`, after it 200, and deleting the ring from the route turns it red again. A
  wrong code is still refused (the case beside it; `password.invalid` since C95). The peer membership read
  (`GET /management-api/membership`, `apps/server/src/management-api.ts`) had the same gap and now
  passes the ring too, with the same two cases in
  `apps/server/src/management-api.membership.test.ts`. The promote route
  (`apps/server/src/promote-api.ts`) called `loginManagerById` without the ring as well, so an
  admin with an authenticator sending a correct current code drew 401 `totp.invalid` and the
  promotion never ran. **DONE (C94, #926, 2026-09-30):** `PromoteApiDeps` takes a `credentialKeyRing`,
  which `boot.ts` fills with the same ring. Test: "signs in with a correct current code and
  promotes" in `apps/server/src/promote-api.authenticator.test.ts` (real database, the promote
  itself stubbed) drew 401 `totp.invalid` before the fix and 200 after, and a wrong code is still
  refused (the case beside it; `password.invalid` since C95); with the ring deleted from the route, both cases answer 500.
  The ring is now a required argument everywhere the sign-in takes it, so a caller that leaves it
  out no longer compiles (with the route's line deleted, `tsc` reports TS2741 at `promote-api.ts`):
  `loginManager` and `loginManagerById` (`packages/identity/src/manager-login.ts`),
  `decryptTotpSecret` (`mfa.ts`), the own-credential checks in `profile.ts`, `beginGoogleLink`
  (`google-oidc.ts`), and `credentialKeyRing` in the management, profile and promote route
  dependencies — the management and profile routes had silently fallen back to an authenticator
  key of their own when none was given, and that fallback is gone, with the management routes'
  `accountActionCodeKey`, which fed nothing else.
  Seen while looking at C87 at 390 by 900 px: the wizard's floating language button sat
  over the bottom of the connect form, covering part of the refusal message beside Connect and, in
  the English dark-theme screenshot, part of the Connect button (owner 2026-09-30: move the
  language choice into one shared footer) — **DONE for the setup wizard and the dashboard (C93,
  #933, 2026-09-30):** both now end the page with one shared
  footer, `wt-language-footer` (`packages/ui/src/components/wt-language-footer.ts`), which sits in
  the page's flow below the content, so the closed chooser no longer floats over the page (its open
  menu still opens upwards over the content above it). The till still has its own
  floating copy, which moves onto the footer in lane B's B18. Seen while looking at C93 and not
  fixed there: on the dashboard at 390 px a sliver of the closed side-menu drawer's search box
  shows at the left edge, in the page's 24 px margin; C93 does not change the drawer's rules, so I
  believe it predates it (not checked on `main`). Raised in C93's review and left as they are:
  the event could be renamed `wt-locale-change`, closer to other shared components' names (kept as
  `wt-locale-selected`, the till's name, to ease B18); the dashboard's `loadLocales` fetch returns
  the same built-in list the component already holds (kept, as the dashboard loads from its API on
  purpose). Still open: (6) the setup
  live-source screen's refusals go through a catch-all in `#onConfigurationRequested` that drops the
  code, so a wrong passphrase cannot be placed under its field; (7) the profile screen opens with
  Save disabled when required details are missing — the form's own check, before any press (also
  point (4) of the entry above); (8) on the add-person and edit-person forms `profile.invalid` reads
  "Check your profile details", which is about someone else's details there; (9) after a refusal
  under a field the bottom message still reads "Correct the highlighted fields to continue" while
  the action works — kept as it was; (10) the bookings form was not in C54's survey (read, not run):
  a save refusal becomes the screen's `errorKey` (`packages/bookings/src/dashboard/bookings-screen.ts`
  `#onCreate`/`#onUpdate`) and shows as a paragraph on the screen outside the dialog, never under a
  field — including those naming one, `management.request_invalid` with a `field`, `booking.invalid`
  with `partySize`, and `table.not_found` with `tableId` for an inactive table (`table.inactive`
  comes only from seating); the form's Save is disabled only while a save is in flight (`busy`), so
  no refusal disables it, and its own check shows one paragraph in the dialog rather than a message
  under the field, and the payment-provider forms were not in C54's survey either (read, not
  run): the connect and add-reader forms in `packages/payments-stripe` and `packages/payments-sumup`
  (`stripe-connect-form.ts`, `stripe-add-reader.ts`, `sumup-connect-form.ts`, `sumup-add-reader.ts`)
  put a refused request's message in the bottom message, except that SumUp's connect form answers
  a key spanning several merchants by showing a merchant picker, and none of them disables its
  action on a refusal; (11) the backup screen's configuration export drops the refusal's code in a
  catch-all (`apps/dashboard/src/screens/backup-screen.ts` `#exportConfiguration`), so a
  `management.request_invalid` naming `passphrase` would read only "The configuration export could not be created." at the bottom — read,
  not run, as unreachable from this form, because the client refuses a passphrase shorter than 12
  (`MIN_KEY_LENGTH`) before sending and the server's check is the same `length < 12`
  (`apps/server/src/configuration-export-api.ts`); (12) **DONE (C61, #859, 2026-09-29):** the profile screen's two refusals
  placed under a field now read as that field's — `account_action.invalid` under the emailed code
  says the code is incorrect or no longer valid and how to get a new one (`profile.email_code_refused`, used only in the
  screen's email mode; the code's own link sentence stays for the login screen's links), and
  `locale.unsupported` has its own sentence in `apps/dashboard/src/i18n/codes.ts`;
  (13) **DONE (C65, #861, 2026-09-29):** the categories screen's change-main-category dialog now says its
  message beside Save, through `wt-form-actions`' `error`, instead of above the picker: a refusal
  naming no field shows its own sentence there, and one placed under the picker shows "Correct the
  highlighted fields to continue." there. _(2026-10-01, C97: the dialog now shows that message at
  the end of its body.)_ Tests: `apps/dashboard/src/screens/categories-screen.test.ts`
  and `apps/dashboard/src/screens/categories-screen.a11y.test.ts`. Still open there, read and not
  run: the same screen's delete dialog draws its message in the dialog's body, below the preview,
  rather than beside Delete (`#dialogMessage` in `apps/dashboard/src/screens/categories-screen.ts`)
  _(2026-10-01, C97: done — `#dialogMessage` is gone and the delete dialog passes its message to its
  footer `wt-form-actions`)_;
  _(2026-10-01, product-folders slice 1: the Categories screen and these tests are retired.
  Bulk folder deletion's warning and refusal checks live in
  `apps/dashboard/src/widgets/catalogue-browser.test.ts`.)_
  (14) on the Cloud restore screen a `setup.request_invalid` naming `oldBoxGone` or `pointId` (the
  server raises both, through the Cloud restore route's `invalidRequest` calls in
  `apps/server/src/setup-api.ts`) shows "Cloud recovery is unavailable. Check the connection or
  request expiry, then try again." (`shell.cloud.unavailable`), because `#onCloudRestoreAction` in
  `apps/setup/src/setup-app.ts` places no field and `CLOUD_ERROR_MESSAGES` has no
  `setup.request_invalid` entry. It predates A152; found in A152's review, read and not run.
  **Next action:** the other open points still wait for the owner to say which are worth doing.

- **Every login failure is one answer — DONE (C95, #930, owner decision 2026-09-30).** The owner's rule:
  "reasons for login shouldn't expose the existence or non existence of a user. so any failure should
  just report that the login failed." A password login (`loginManager` and `loginManagerById`,
  `packages/identity/src/manager-login.ts`: the dashboard, standby connect, membership and promote)
  refuses an unknown account, a suspended or pending one, one with no password, a wrong password, a
  wrong or missing authenticator code and a wrong recovery code as 401 `password.invalid` with no
  params, each after one password-hash check. A PIN login (`verifyPersonCredential`,
  `packages/identity/src/credential.ts`: the till's sign-in, the drawer, refund and adjustment
  overrides, payment attest) refuses every cause as 401 `pin.invalid`, each after one PIN-hash
  check; a malformed person id is `pin.invalid` too. On the till every refused sign-in with a
  well-formed person id now counts toward the wrong-PIN back-off, so an unknown id reaches
  `pin.throttled` as a known one does, and
  each device's sign-in share of the back-off table is capped (`PIN_THROTTLE_MAX_KEYS_PER_SLOT`,
  `packages/identity/src/pin-throttle.ts`): a device holding its limit answers each new person
  with a 60-second wait, and room returns only as that device's entries fall idle, fifteen minutes
  after each was last used; every other till keeps working.
  The real cause reaches the server log only: an `AppError` can carry a `reason` that is not
  enumerable, and the route error boundary logs it as `logReason`
  (`packages/server-kit/src/error-boundary.ts`). The dashboard login and the setup wizard's Connect
  show one "the login failed" sentence beside the action and mark no field _(2026-10-01, C97: it
  now sits on its own line above the buttons)_; the till keeps "Wrong
  PIN, try again", the PIN being the only thing typed. Guards: the one-answer cases in
  `packages/identity/src/manager-login.test.ts`, `login.test.ts` and the route suites
  (`till-api.test.ts`, `till-api.receipt.test.ts`, `mirror-bundle-api.test.ts`,
  `promote-api.authenticator.test.ts`, `management-api.test.ts`); the membership route, the
  adjustment approver, the refund override and the manual-refund confirmer have no such case of
  their own. Kept on
  purpose, each reachable only after a credential was proved: `totp.required` (the dashboard's code
  step, after a right password), `google.second_factor_required` (after a valid Google sign-in) and
  `authorization.not_permitted` (right credentials, a role without the permission — a sign-in
  route, or a PIN override after a right PIN: the drawer and refund overrides and the manual-refund
  confirmer), and the adjustment approver's `adjustment.approval_required` for a right PIN whose
  role is too low; a signed-in
  person's re-check of their OWN password or code (`profile.ts`) still names the field. A
  password-reset request for a known address wrote a token row before answering and one for an
  unknown address did not; measured in-process through the route (`app.request` on a Mac, no
  network) 200 times each, known answered at a median 0.307 ms against 0.091 ms. It now answers 202
  first and does the lookup, the write and the email afterwards, logging a failure as
  `account_action.request_failed` (A147, #942): re-measured the same way, 0.025 ms against 0.026 ms.
  Still open: that later work still shows in the answer time of a second password-reset request for
  the same address sent as soon as the first answered (other routes, and requests sent later, were
  not measured); the owner chose on 2026-09-30 to close it by giving an unknown address equivalent
  background database work, queued as A159. Measured 2026-09-30
  on a Mac: a separate Node process sent pairs of password-reset requests over loopback HTTP to the
  management routes served by `@hono/node-server`, both requests of a pair for the SAME address, the
  first to a newly mounted copy of the routes (fresh rate-limit and repeat-request state) and the
  second, sent as soon as the first answered, to that same copy; every answer was 202. After 40
  warm-up pairs, 200 pairs of each kind, interleaved: the first request answered at a median
  0.864 ms for a known address against 0.862 ms for an unknown one, and the second at 1.065 ms
  against 0.326 ms. In the control the route did no later work at all (no lookup, write or email):
  the second request answered at 0.251 ms against 0.258 ms. Refusals thrown in `apps/server`
  itself (a malformed id or PIN) carry no `reason`; the till's `APPROVER_REFUSALS`
  (`apps/till/src/till-app.ts`) still lists `person.not_found` and `person.suspended`, which the
  approval routes no longer send for an approver; and the dashboard's
  password throttle (`apps/server/src/password-throttle.ts`, unchanged by C95) answers any email it
  is not already tracking with `password.throttled` (retry in 60 seconds) while it tracks 1000, so
  a flood of made-up addresses delays the sign-in of anyone it is not already tracking.
  **Done since (2026-09-30, lane A's A153, #952):** the setup wizard's `shell.adopt.bundle_fetch_failed` sentence
  (`apps/setup/src/i18n/strings/shell.ts`, English and Spanish) no longer names a refused login among
  its causes, a refused login now arriving as `password.invalid` and showing
  `shell.adopt.login_failed`; and the setup wizard's Reset form no longer marks its person-ID and
  password fields on `password.invalid` (`apps/setup/src/screens/reset-screen.ts`) — it marks no
  field and moves the cursor to the password. Still open, left as it is by A153: after a refused
  login the setup wizard's Connect form leaves the cursor where it was (an existing test pins that),
  while Reset and the dashboard sign-in move it to the password; the owner's rule covers marking
  fields, not the cursor, so whether Connect should match is the owner's call.
- **The profile's "Current password" fills the signed-in person's saved password — DONE (C98, #934, owner
  2026-09-30: "the current password field doesn't autocomplete").** Every profile step that asks for
  the current password now carries a hidden, read-only `autocomplete="username"` field holding the
  signed-in email (`autofillUsername`, `apps/dashboard/src/widgets/autofill-username.ts`); a person
  with no email gets none. Measured in Chromium 153 (Playwright 1.63, logins saved through its own
  password manager, against the dev stack): with ONE saved login the field was already filled before
  the change, so the owner's empty field was not reproduced; with TWO saved logins, the other one
  saved first and a sign-in the password manager did not see, the Add passkey and Change password
  steps were filled with the OTHER login's password and the nav's page search with its email, and
  after the change both filled the signed-in owner's password and the search stayed empty. Still
  open, two things. First, the sign-in page keeps its three inline copies of the field
  (`apps/dashboard/src/screens/login-screen.ts`). Moving them onto the helper needs at least: a
  `name` parameter (the sign-in page's tests pin `email`; the profile's field is named `username`,
  and its details step also shows an editable `email` field), the `data-autofill-username` hook
  those tests find the field by, and a decision about an empty email, for which the helper renders
  nothing while the sign-in copies always render. Second, which browser and address the owner saw
  the empty field in. The payments screen's manager-PIN prompt
  (`apps/dashboard/src/screens/payments-screen.ts`), which this entry left marked
  `autocomplete="current-password"`, now says `autocomplete="off"`, the owner's choice on
  2026-09-30 (C110, #940) to match the profile screen's PIN fields; nobody checked in a real browser
  whether it then stops offering the dashboard password there.
- **A sign-in step's links are one bulleted list, with its buttons on the first item's row — DONE
  (C96, #936, owner 2026-09-30: "Move 'Login with passkey' under 'i've forgotten my password' … the same
  for any other similar links. Also the login button should be at the same level as the 'I've
  forgotten my password' on the right"; then "list the links with bullets").** On the dashboard's
  password step, "I've forgotten my password" is now the first item of the bulleted list, above
  "Log in with passkey" and "Continue with Google", and Log in sits on that first row at the right.
  The passkey, Google and authenticator-code steps take the same shape (their links unchanged in
  order; the code step's Back and Log in share its one link's row). The email, account-link,
  passkey-offer and check-your-email steps show no sign-in links and are unchanged (the
  privacy-notice link under every step stays where it was). At 390 px the password step keeps Log
  in on the first row in English and Spanish, and the code step keeps Back and Log in there in
  English; the code step in Spanish and the passkey and Google steps wrap their buttons below the
  list, right-aligned. On a form at its full width (30rem), only the first link has to fit beside
  the buttons: a longer later link breaks onto a second line inside the list instead, so a wider
  system font (Linux's, which CI uses) does not push them below. A refusal's message
  sits beside the action, so a message too long to share the row takes the buttons below the list
  with it; C97, queued next, is to move it to the bottom of the form. _(2026-10-01, C97: done —
  the message now sits on its own line above the list of links and the buttons.)_ Layout only,
  `apps/dashboard/src/screens/login-screen.ts`.
- **A new passkey is listed under the person's email, with their name as its display name — DONE
  (C99, #939, owner 2026-09-30, on Google Password Manager showing a waitron.local passkey with
  Username "Clinton Gormley" and Display name "No display name").** `beginPasskeyRegistration`
  (`packages/identity/src/passkey.ts`) now sends the person's email as the passkey's `user.name` and
  their display name as `user.displayName`; before, it sent the display name as `user.name` and no
  display name, so the library sent an empty one. A person with no email gets their display name
  for both. The name a person gives the passkey ("Laptop") still
  lives only in Waitron's own list. What was checked: the two cases in
  `packages/identity/src/passkey.test.ts` check the options the server sends; the result has not
  yet been seen in a password manager. Still open: WebAuthn Level 3 (a W3C Recommendation since
  25 August 2026, §5.1.10.4) defines `PublicKeyCredential.signalCurrentUserDetails`, which asks the
  password manager to update a passkey's name and display name, but "Clients provide this
  functionality opportunistically" and "signal methods do not indicate whether the operation
  succeeded". Since C101 (next entry but one) the dashboard calls it, where the browser has it,
  after every sign-in and after a passkey is added or removed, but not after the email or display
  name is changed on the Profile screen; nobody has yet seen whether a real password manager then
  shows the new names.
- **The passkey list says when each passkey was last used and which password manager holds it — DONE
  (C100, #945, owner 2026-09-30: "if i add a passkey then delete it in google password manager, then add
  another one, i have two passkeys listed in waitron but only one in google, and i'm not sure which
  one it is").** Each passkey on the Profile screen's Security tab now has a second line: the
  password manager that holds it ("Google Password Manager", "1Password", …) and "Last used
  <date and time>", or "Never used" (Spanish: "Último uso: <date and time>", "Nunca usada"), in
  the dashboard's chosen language; the time of day is shown so two passkeys used on the same day
  can be told apart, while the created date beside the name stays a date only. A passkey deleted
  in the password manager is expected to stop signing in, so its "Last used" time stops moving
  (not tried with a real password manager). Signing in with a passkey records the time on that
  passkey in the same statement that keeps its counter from going backwards
  (`finishPasskeyAuthentication`, `packages/identity/src/passkey.ts`) — also for a passkey whose
  authenticator keeps no signature counter, which reports 0 every time. Every passkey sign-in now
  writes the passkey's row, so it refreshes any open screen that reads people — Your profile,
  Users, Shifts, Approvals, My schedule and others; before, a sign-in whose counter did not move
  wrote nothing. Registration now keeps
  the authenticator's identifier (its AAGUID) in a new `aaguid` column, and a passkey given no
  name is named after its password manager; one whose password manager is not known keeps the old
  "Passkey 1" fallback. The server turns the identifier into a name (`passkeyProviderName`,
  `packages/identity/src/passkey-providers.ts`), so the dashboard never sees the raw identifier;
  an all-zero or unknown one shows no name. The password-manager naming was not tried with a real
  browser either: the tests stand in for the WebAuthn library. The WebAuthn spec's Level 3 change
  list (github.com/w3c/webauthn, `index.bs` on main at commit
  `9d88b7681b10926a41fd18b78e206a01804ed855`, fetched 2026-09-30) says the AAGUID "is no longer
  zeroed when attestation preference is none" — so a browser following the older Level 2 rules
  zeroes it under `@simplewebauthn/server`'s default "none" attestation preference, which Waitron
  does not override, and the passkey then shows no password manager. The names are a copy of the
  community list at github.com/passkeydeveloper/passkey-authenticator-aaguids
  (commit `3ff200d`, fetched 2026-09-30), names only; that repository states no licence, which is
  recorded at the top of the file. Two things an owner will see: a passkey added before this
  change shows no password manager (its identifier was never kept) and says "Never used" until it
  next signs someone in; and security keys such as a YubiKey show no name, because only the
  community list was copied, not the FIDO Alliance's metadata it is combined with upstream. The
  list is a snapshot: nothing refreshes it, so a password manager added upstream later shows no
  name until someone copies the list again. Migration `packages/identity/drizzle/0004_passkey_provider_last_used.sql`
  only adds the two columns.
- **The browser's password manager is told which passkeys Waitron still accepts, and a passkey
  Waitron no longer holds says so — DONE (C101, #948, owner 2026-09-30, "yes all three", and ~16:10 on the
  unknown-passkey answer: "i think this is a valid error message").** After every dashboard sign-in
  (password, code, passkey, Google, account set-up) and after a passkey is added or removed on the
  Profile screen, the dashboard reads `GET /management-api/passkey/signals` (signed-in only:
  the relying party, the person's user handle, the ids of every passkey they hold, their email and
  display name, `readPasskeySignals` in `packages/identity/src/passkey.ts`) and hands them to the
  browser's `PublicKeyCredential.signalAllAcceptedCredentials` and `signalCurrentUserDetails`,
  each only where the browser has it (`apps/dashboard/src/passkey-signals.ts`). Opening a page on
  a session that already existed sends nothing. A passkey sign-in presenting a credential Waitron
  has no row for now answers `passkey.not_registered` (it was the generic
  `passkey.verification_failed` since #305); the login screen then calls
  `signalUnknownCredential` with that credential's id and says "This passkey is no longer
  registered with Waitron, so this browser has been asked to remove it. Use another way to log in.",
  or, where the browser has no such method or refused the call, only "This passkey is no longer
  registered with Waitron. Use another way to log in." (Spanish in `strings.ts`). This is the
  owner-approved exception to C95's one answer, written beside the rule in
  `docs/developers/conventions-ui.md` and CLAUDE.md §3: a suspended person's passkey still gets
  the generic answer, because suspension keeps it; a manager's login reset or a reactivation
  deletes the person's passkeys, so an old one then answers "no longer registered" like one the
  person removed. The browser's own methods are called directly rather than through
  `@simplewebauthn/browser`'s `sendSignal()`, which adds only renamed errors and throws where a
  method is missing. **Not observed in a real password manager:** the tests replace the browser's
  methods, and Chrome's feature entry says it acts "Initially ... only for Google Password Manager
  (GPM) credentials", which a test browser does not hold. What the sources say (fetched raw 2026-09-30): WebAuthn Level 3 (W3C Recommendation,
  2026-08-25, §5.1.10) — a credential missing from the accepted list is "removed or hidden,
  potentially irreversibly", and "signal methods do not indicate whether the operation succeeded";
  MDN's compatibility data (`@mdn/browser-compat-data` 8.1.3) lists all three methods in Chrome and
  Edge 132 and Safari 26, and not in Firefox; Chrome's feature entry (chromestatus 5101778518147072)
  gives Android as 144, where MDN copies desktop's 132 — which is right was not established;
  Chrome's article (developer.chrome.com/docs/identity/webauthn-signal-api) says Google Password
  Manager hides rather than deletes a passkey missing from the list, restores it if it is listed
  again, and keeps a username the person edited there over one the site sends. Left open from
  the review, both predating C101 (#948's review read `packages/identity/src/passkey.ts` on main
  before the branch): a suspended or pending person's passkey is refused before the signature check
  and an active person's bad signature after it, so the two do different work — whether that can
  be timed from outside was not measured; and an expired sign-in challenge answers its own
  `passkey.challenge_expired`. Not taken: after a passkey is added or removed, the Profile screen
  makes one request more than it needs (the signals read beside the profile reload); folding the
  signal data into the profile response would remove it. Nothing waits on that request.
- **Review every permission: fewer, coarser, and consistently named** (owner, 2026-09-26). The list in
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
- **Roles are something an admin can add and edit; the four built-ins are only defaults** (owner
  decision 2026-09-12, design not written). Detail under *Detail → Roles*: the ladder question decides
  the schema. The owner restated it on 2026-09-28 ("especially because I want roles to be definable
  by the customer"), when asking for roles to be listed alphabetically. Since lane C's C36 (#823) the
  dashboard's three role lists — the add-person and edit-person forms and the Staff screen's role
  filter — sort by the displayed name in the current language (`rolesByName`,
  `apps/dashboard/src/i18n/domain.ts`), so a custom role's name would take its place among them. The
  adjustments module's reasons screen now sorts both role dropdowns by the displayed name in the
  current language too (C51, 2026-09-29). Its client-side seniority check keeps a separate ordering;
  the roles design still needs to decide where custom roles belong in that check. The sorting uses
  the same `Intl.Collator` options locally: the dashboard's `rolesByName` lives inside
  `apps/dashboard`, outside the module's shared dependencies.
- **`wt-select` in `packages/ui`** (owner decision 2026-09-12): every screen writes its own raw
  `<select>`, so a rule alone could not be guarded. Sorts by the label the person reads with
  `Intl.Collator`; lists in a lifecycle order say so; then migrate the screens, including the filter
  dropdowns `wt-data-table` draws in its toolbar, which are raw `<select>`s too. Fix
  `wt-data-table`'s locale-less `localeCompare` at the same time.
- **The till's schedule screen still has the My Schedule defects the dashboard fixed.** Its three
  dropdowns bind `.value` alone over options from a list (found 2026-09-14 by a text scan;
  re-checked 2026-09-27): `apps/till/src/screens/till-schedule-screen.ts:356`, `:370`, `:423`. Each
  binds `.value` on a `<select>` whose options come from a `.map(…)` and marks no option
  `selected` — the shape that showed "Downstairs bar" on the till while it sold from Deli counter,
  fixed by #365 (CLAUDE.md §3).
  The dashboard's My Schedule screen had the same three, fixed by lane C's C16 (2026-09-27, branch
  `fix/my-schedule-loading-and-selects`): there, run red first, a chosen shift or colleague showed
  ANOTHER entry once its list refreshed in a different order, and the absence-type dropdown opened
  on its first type when the screen's chosen type was another — a state the test reaches by setting
  that choice before the first render; we know of no product path that opens it on another type
  today (`absKind` defaults to `"holiday"`, the first of the fixed `ABSENCE_KINDS`). The till's
  markup is the same, but it loads its lists in one `Promise.all` in `#reload` with no live refresh:
  a list changes only after an action (`#act` reloads, e.g. accepting a swap) or when
  `apps/till/src/till-app.ts` hands in a new `staff` array. We believe (by reading, not run) that a
  reorder, or an entry inserted above the chosen one, on one of those shows the wrong choice: Lit
  reuses options by position, and accepting a swap adds a shift. Units' list was fixed by #382. The
  same screen also still carries the other defects the dashboard's branch fixed, found 2026-09-27 by
  reading `apps/till/src/screens/till-schedule-screen.ts`, not run: its failed-load catch
  (`:193`-`:198`) fills the lists with `[]`, so the sections say "none" (`:303`, `:324`, `:397`)
  beside the load-failed alert (`:289`); its loading line (`:284`) has no `role="status"`; and a
  chosen shift or colleague that a reload removes stays chosen (`coverShiftId` and
  `coverColleagueId` are cleared only after a cover request is sent, `:228`-`:229`). **Next
  action:** mark each till option `.selected` and drop the `<select>`'s `.value` binding, the way
  `apps/dashboard/src/screens/my-schedule-screen.ts` and
  `apps/till/src/screens/till-counter-screen.ts` do, with tests that reorder a list AND insert an
  entry above the chosen one through the till's own triggers (not the dashboard's
  `LiveData.invalidate`) and read `select.selectedOptions[0]`; and fix the three defects above the
  way the dashboard screen now does.
- **The counter till may start in a zone its service zone dropdown does not list** (found
  2026-09-14; read, not run). The till's zone list drops `table_tab` zones (`listDefaultZoneOffers`
  in `apps/server/src/till-api.ts`), but its starting zone comes from `resolveNewOrderZone`
  (`packages/venue-service/src/operations.ts`): the device's default, else the zone marked
  `is_counter_default`, neither filtered by service mode. In real Chromium, a chosen zone missing
  from the list makes the dropdown show the first zone (checked while reviewing #365). **Next
  action:** find whether a `table_tab` zone can be the counter default or a device default; if it
  can, decide whether that is refused where it is set or handled by the till.
  A device's default is set only through `PUT
  /management-api/venue-service/devices/:deviceId/default-zone` (`packages/venue-service/src/routes.ts`),
  and nothing in the tree calls that route — grepped across `apps/` and `packages/` on 2026-09-24,
  which found only the route and its tests — so no screen sets one today.
- **The built-in doneness picker is gone; doneness is a modifier the venue adds itself — DONE as Task
  10**: the demo seed's steak carries a cooking options list, the till offers it (Task 12), and an
  options answer prints on the kitchen ticket as an indented
  `+ <list kitchen name>: <label kitchen name>` line. **Open, and worth a cook's eye before a
  real service:** whether a `+` sub-line is enough for something a cook must not miss, or whether an
  options answer deserves its own prominent form on the ticket. Nobody has watched a real kitchen read
  one, nor opened and tapped a real demo box to settle it outside the code.
- **"the fiscal record is built from `total` + `vat_breakdown`" is a false-narrow enumeration, and it
  reproduces itself** (found by the review wave on the doneness removal, 2026-09-20; corrected on that
  branch). Two compliance-track documents
  carry the same shape about tips (`docs/compliance/asesor-questions.md:465`,
  `docs/compliance/verifactu-findings.md:678`); their tip claim is TRUE and the legal track is kept
  separate. **Next action:** whoever next works the compliance track widens those two sentences.
- **Every test file under `apps/server/scripts/demo-seed/` carries its own copy of the demo seed's
  venue-provisioning fixture** (found reviewing the doneness removal, 2026-09-20, NOT fixed there —
  it is one file of churn per copy, on a branch about something else). Stated as a property rather
  than a count, because the count moves whenever a sub-seed is added or removed: every `*.test.ts`
  in that directory declares its own `provisionVenue` and `nextNif`, and the `nextNif` bodies are
  identical apart from the eight-digit base each one counts up from. Task 13 took one copy away with
  `seed-options.test.ts`, and left the property standing.
  The repo has already paid for this extraction once elsewhere and said so
  (`apps/server/src/testing/venue-fixtures.ts`), and it is free here because
  `apps/server/vitest.config.ts` excludes `scripts/**` from coverage. **Next action:** extract
  `apps/server/scripts/demo-seed/testing/provision-venue.ts` taking the NIF base as an argument —
  each file genuinely needs its own range — and convert the siblings as they are next touched.
- **`wt-combobox`** (#351): a searchable dropdown in `packages/ui` — pick one option or several
  (`multiple`), and optionally offer to add what was typed when nothing matches. The category form's
  parent picker (#362) and the product's main-category picker
  (`apps/dashboard/src/widgets/classification-fields.ts`) use it. Left out on purpose, per its
  design: searching on the server, disabling
  single options, taking part in a native `<form>`, and showing chosen options as chips (it shows a
  count instead). **Undecided:** how it relates to the `wt-select` row above. The combobox does not
  sort its options, and neither its design nor that row mentions the other, so decide whether
  `wt-select` becomes a non-searchable mode of the combobox or stays a separate element before
  building either. **Next action:** the owner
  answers the `wt-select` question.
- **Shared database-backed table paging, search and sorting** (owner decision 2026-09-12; users
  first). 50 per page with a server-enforced maximum; search and sort over the whole dataset; debounce,
  reset on filter change, ignore superseded responses, keep passive live refreshes. Deliberately kept
  out of #328. `wt-data-table`'s toolbar search box and filter dropdowns (#362)
  filter the rows already in the browser and emit no `wt-*` event of their own when the search text
  or a filter changes (only sorting and row selection do), so server-backed paging cannot reuse them
  as they stand.
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
- **Typed values are only partly checked — a generic phone-format screen landed, a country-specific
  one has not.** Done: a shared format check, `isValidTelephone` in `@waitron/shared`, runs on both
  the browser forms and the server write paths (a failing number is refused with
  `person.telephone_invalid`), and a number is kept exactly as typed, not normalised.
  Still open: the country-pack seat (`CountryPack.telephone`, filled by `validateSpanishPhone`) is
  still not called, so no country-specific rule runs yet — a Spanish mobile that fails the national
  rule but passes the generic one is still accepted; other typed fields (email aside) are still
  unchecked; the tax identifier stays fiscal. Confirm with owner: an existing malformed number now
  blocks an otherwise-unrelated edit, because both forms re-validate the telephone field on every
  submit — this was the open "does an old bad number block an unrelated edit?" question, and the
  answer is currently yes.
- Still open from #298/#305/#317, device checks before deployment: passkey reauthentication for a
  passwordless account; an operator screen for Google provider credentials; native passkey prompts on
  real hardware; a physical authenticator ceremony; live SMTP through `startServer`; whether an
  intermediary cache honours `Vary: Accept-Language`. #328's overlapping-dialog state was reached
  from code only; nobody has shown a real pointer can get there.

### A8. Receipts

- **One original per invoice, structurally.** `POST /api/sales/:id/receipt` has no limit and no
  idempotency; two calls produced three unmarked originals, and art. 14.1 says exactly one. Cheapest
  containment: idempotent per sale, invoice number on the slip.
- **A payment slip per card: done by bill payments.** Printing the payment slip of a bill paid by
  several cards prints one slip per card payment (`apps/server/src/payment-slip-print.ts`). The
  one-payment routes (`payWorkingOrder`) take a single tender.
- **Bilingual receipts** — `invoice_locales` is configured and snapshotted but rendered by neither
  document.
- **Tip-collection UI** — the only surface that COLLECTS a tip is the integrated-Stripe idle screen;
  cash, manual card and the handheld have none. A design decision per tender type. And `#onPayTab`
  flattens every server code but the two permanent fiscal refusals to one `sale.error` key, hiding
  `sale.empty_basket`.

### A9. Product depth — after the primary works

- **Product languages are hard-coded at setup** (owner, 2026-09-13). A Spanish venue is seeded with
  Spanish plus Catalan and English whatever its province — right for the deli, wrong for a Spanish
  venue outside Catalonia. The proper fix drives the list from the venue's region and the languages it
  chose, which probably means setup asking; do it when there is a second region or country to be wrong
  about. The hard-code is in `packages/catalogue/src/provisioning.ts` and names this entry. Receipt
  languages are a separate setting and already follow the province.
- **Folder-driven routing to multiple printers/destinations** (owner, 2026-09-30): the
  [approved routing design](superpowers/specs/2026-09-30-catalogue-menus-routing-design.md)
  replaces the former label-driven proposal. Prep stations claim folders, with ordered exceptions
  and fallbacks; slice 3 remains unbuilt. Slice 1 retains the current direct-category routing until
  that slice lands. Reporting attribution stays separate so one sale is counted once.
- **Departments and menus** (#297) remaining: remove the legacy price and fixed-station compatibility
  fields; per-menu modifier authoring; department hours and calendar exceptions; workforce
  assignments; immutable department attribution and reporting; batched readiness and offer queries;
  a replication smoke test. Same legal seller is the working assumption, to confirm before go-live.
- **Counter/walk-up kitchen fire** — the #193 follow-up, the next piece of menu work.
- **Menu draft/published state** and time-of-day / seasonal scheduling.
- **Pricing adjustments** (owner, 2026-09-03), both gated on the discount permission: reduce or zero
  an order line; a whole-order discount spread across lines and VAT rates. A *descuento* agreed at or
  before issuance is outside the VAT base (Q15), so it must reach the line BEFORE `computeHuella` —
  specced with the owner, never landed unattended. _(2026-09-30: comps, line discounts and
  whole-bill discounts are built by service plan Task 11 — see its entry under the service plan;
  they are gated by each reason's roles, not a discount permission, per plan decision D6 in
  `docs/superpowers/plans/2026-09-26-service-ordering-and-billing.md`.)_
- **KDS corrections deferred from #191** (owner, 2026-09-01): a moved dish must keep its kitchen
  status (`moveTabLines` deletes and reinserts the line, so its `ticket_items` row cascade-drops; the
  ticket must travel with the line, not re-fire — no test covers it today) _(2026-09-30, Task 13:
  `moveTabLines` is deleted; whether this still holds for the paths that move lines now is not
  checked here)_; hold-on-send
  without courses plus a venue disable setting; FP-1's empty-named child-modifier row; device-scoped
  fire/collect routes. Then the low-priority KDS list under *Detail → KDS*.
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
- **Configurable per-device face-set editor** — persist a face-set per device profile with the
  `HANDHELD_FACES` constant as fallback; the heavier half makes the table-order screen canvas-driven.
- **Layout designer follow-ons**: the aggregated device-profile bundle (till, station, hardware, area,
  order routing, printer target on the profile); truly-real card renders in the editor (needs a
  neutral shared card package); the visual theme editor; community canvas sharing.
- **Language resolution follow-ons**
  ([original design](superpowers/specs/2026-08-30-localization-fallback-negotiation-design.md)):
  configurable content languages and their shared fallback landed in #339, separately from interface
  and receipt languages. Still open, and unchanged by it: the write-side drift, where a sale's
  `sales.locale` is stamped from the boot-time `cfg` rather than from `locations.invoice_locales`
  (fiscal-adjacent). There is still no single shared rule: the receipt's `lineName`
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
reworked #346).
Proven end to end 2026-09-09: blank box → phone setup → provision → trading over HTTPS → enrolled
till → a recorded preproduction sale.

### B1. Onboarding must surface the CA-trust step — LANDED #330 (2026-09-12)

Certificate-trust guidance before the setup details, connection retry/help and a per-OS,
per-browser certificate walkthrough (#330; reworked #346 to open the visitor's own device's steps),
walked on real devices by the owner; `deploy/README.md` keeps the advice for whoever installs the box.

One guard here is narrower than its name. `scripts/trust-page-logo.test.ts` checks that the logo
pasted into the server's source still matches the brand lockup — the two drawings agree, and nothing
else. It does not check that the page renders, that either theme is readable, or that the logo is
visible at all. That distinction is exactly what the new `CLAUDE.md` §4 rule is about, but the guard
itself is not named there. **Next action:** name it and its hedge on that rule's line, whenever
`CLAUDE.md` is next opened for a PR.

**The mode screen's certificate note** (C40, #833, 2026-09-29): it now shows only when the wizard
skipped the connection question, because the server offered no certificate authority to download,
and reads "If your browser shows a certificate warning, open certificate help". The Codex review's
alternative, asking the connection question anyway on that skipped path instead of showing the
note, changes #330's design and was not taken. **DECIDED (owner, 2026-09-29): keep it as built** —
the note shows on that skipped path and the question is not asked there.

### B2. Backups that leave the box

- **Guided Cloud snapshot recovery for test venues is built.** Cloud approval alone does not
  authorize trading or stop another server.
- **S3-compatible bucket, then Google Drive.** The bucket stream of `venue.db` is built (slice 2);
  the archive's S3 backend is not — only `LocalFsBackend` exists for archives. The abort-aware
  per-destination timeout lands with the first network backend.
- **Whole-state-volume capture** (its own §5-reviewed slice): capture the whole state directory EXCEPT
  an explicit exclusion set, with a completeness guard that fails when a new top-level entry is
  neither captured nor excluded — the curated list went stale on `modules.json` already.
- **The "backups off or stale" reminder** — LANDED as dashboard alerts (#371), which also flag a
  destination whose last attempt failed. Still open: when a nightly report job exists, the backup slot
  should fire after it.
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

- **Upgrade testing — blocking before go-live (owner, 2026-09-26).** On 2026-09-26 the box could not
  start after an upgrade: core `0013` dropped a column the change feed's trigger named, which no test
  could see because every suite migrated a fresh database. #692 removes the change feed before
  migrating, and its `scripts/migration-upgrade.test.ts`
  walks one database through every shipped migration in date order, with the change feed installed
  between steps.
  - **A164: the upgrade guard carries rows — DONE (#970, 2026-10-01, owner: "queue it").** After each
    step `scripts/migration-upgrade.test.ts` tops every table up to two rows (one where `ONE_ROW`
    or a singleton CHECK says so), the second repeating the first, where its constraints allow, except in its key and in each unique index over plain columns, and fails a step that refuses them or
    leaves a table that still exists holding fewer. Shown by three planted migrations (a `not null` column with no
    default, a cascading rebuild, a unique index), each passing the guard before and failing it after; the
    receipt is in [ci-and-gates.md](developers/ci-and-gates.md) → *The upgrade test carries rows
    through every step*. It found seven shipped steps that cannot carry these rows, listed in the
    test's `RESETS`, where the walk restarts from an empty database. One is a real loss rather
    than a refusal: core `0012_printer_calibration` rebuilds `drawer_opens` without copying its
    rows (read from the migration; the guard's two rows were gone after it), so a box holding
    drawer-open records when it took that migration would have lost them — inferred, not run on a
    box. Whether the owner's box held any then was not checked. Runtime: about 8.1 seconds
    before, 9.9 after (three runs each, locally).

  What it still does not cover, each needed before a real venue is live:
  - **Rows.** _(2026-10-01: synthetic rows DONE by A164, above.)_ The guard now carries two
    rows per table (one where `ONE_ROW` or a singleton CHECK says so), read from each step's own
    schema, so a new `not null` column with no default,
    a rebuild whose `DROP TABLE` cascades and a unique index over a column the two rows share
    each fail it.
    Still open: rows the product itself writes. The synthetic rows hold a few generic values, so a
    migration that fails only on values the product writes and they lack passes — a unique index
    two real rows break where these two differ, a required column real rows leave empty while
    these hold a value. Seed a realistic venue (the demo seed at least) at each step for that;
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

- **Core release points 1 to 6 could not upgrade — CLOSED 2026-09-23.** The storage switch (#489)
  regenerated every migration set, so the journal with that shape and the `db:generate` hazard are
  gone.
- **Every migrating path but boot and the bucket rebuild runs with no ahead-of-image check.** No
  count belongs here: `conventions-data.md` holds the list, re-grepped 2026-09-25, and it is longer
  than what CLAUDE.md §3 names — it adds a readiness runner and the dev, demo and Cloud fixture
  scripts under `apps/server/scripts`, two of the Cloud fixture scripts migrating through
  `restore.ts` rather than calling `applyMigrations` themselves, which a grep for that name alone
  does not find.
- **Provisioning's migrate path still runs the linear full `manifestSets()`** — route it through the
  resolver once it gains per-module enablement.
- **`modules.json` has no flow-down channel** from a primary to its standby (matters under
  *Afterwards*, designed now that bookings is genuinely toggleable), and a toggleable module that is
  load-bearing (identity, payments) fails boot loudly if disabled until the wiring inversion.

- **`waitron.sh install` keeps the box's own copy of the script current — DONE (C83, 2026-09-29).**
  Twice on 2026-09-29 the owner's box ran an old `waitron.sh`, because `install` fetched
  `compose.yml` and `.env.example` for the ref but never the script, so a fix to install's own steps
  (the autopair drop-in, #877) did not run until the owner downloaded it again by hand. `install
  <ref>` now fetches that ref's `deploy/waitron.sh` first (`refresh_self`); if it differs from the
  copy being run, it moves it into place over that copy (a new file renamed in, never the running
  file written over, keeping the old copy's mode and, run as root, its owner and group) and runs
  `install` again from it with the same arguments, once — `WAITRON_SH_REFRESHED` stops the re-run
  fetching again. A symlinked copy has the file it points at replaced. A copy with a `.git` in its
  folder or a folder above it is used as it is, with no fetch. If something stops it fetching,
  comparing or replacing the script, it says so and carries on with the running copy. Tests: the
  cases under "keeps the box's own copy of waitron.sh current" in `scripts/waitron-sh.test.mjs`,
  which now runs each case from its own copy of the script. No case covers a script not run from a
  file, a link `readlink -f` cannot follow, a folder the script cannot enter, or a box with neither
  curl nor wget; the owner and group kept under root were checked by hand in a Debian 13 container
  (2026-09-29), because the suite does not run as root. Left open: installing a ref whose script
  predates this step puts back a copy that does not update itself (`deploy/README.md` says to
  download it again); a copy another user owns in `/tmp` is not updated under `sudo`, because systemd's `fs.protected_regular` setting stops root
  writing the fetched script into the temp file beside it, which `cp -p` has given that user
  (install reports a failed fetch; the README says to download to the home folder instead);
  nothing checks a fetched script before running it beyond what the fetch of `compose.yml` already
  trusts — the same GitHub URL over HTTPS. (#890, main `869fc0776`.)

### B5. The recovery page and degraded mode

- **The failed start's reason on the recovery page — LANDED #695 (2026-09-26).** What it left:
  a failed migration's report names the SET (`migrations.apply_failed`, `{ set }`), not the
  migration file, though the refused statement shows in the detail; the start-up's own log writer
  ignores `WAITRON_LOG_MAX_BYTES`/`WAITRON_LOG_MAX_FILES` (it only appends, so they do not apply);
  the two restore errors' text quotes the "Why the last start failed" heading with nothing tying
  the quote to the heading; and no staged restore has been run through the real migrator to see it
  end in `migrations.apply_failed`.
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

- **The print agent runs under its own AppArmor profile, and says when it cannot reach BlueZ — BUILT
  (A129, #862).** On the owner's box (2026-09-29) Docker's default profile refused the agent's system-bus
  `Hello`, so `bluetoothctl` aborted and the agent silently listed no Bluetooth printers.
  `deploy/apparmor/waitron-print-agent` is Moby's `docker-default` template (moby/profiles at
  `f0494f1fbb1bbaf2e1b02ee20aab206f32456a63`) plus the bus rules `bluetoothctl
  list`, `devices` and `scan` were measured to need against a stand-in BlueZ on a CI runner;
  `waitron.sh install` loads it where AppArmor is on and only then names it in `.env`
  (`WAITRON_PRINT_AGENT_APPARMOR`), because Docker refuses to start a container naming a profile the
  host has not loaded; image-smoke runs the agent under it, with `docker-default` as the refused
  control. The agent now reports the Bluetooth side's availability in its log and `/status.json`,
  once per change, with a reason (`dbus_unreachable`, `bluez_not_answering`, `no_controller`,
  `failed`), and asks an unavailable one again every 30 seconds rather than every poll. It checks
  from the moment it starts, before it has joined a box, so the setup page's `/status.json` carries
  the report while the owner is still setting the agent up. Left open:
  - **Pairing and `remove` are in the profile (P2b); `trust` is still refused.** P2b added the
    messages interactive `bluetoothctl` pairing with a PIN and `remove` were measured to need
    against the stand-in BlueZ on a CI runner (probe run 36585218089; the receipts are in the
    profile's header), and image-smoke now pairs the stand-in's PIN printer and forgets it under the
    profile. A property write (`trust`) and `Disconnect` were measured still refused there; BlueZ's
    `Agent1.Release` is not allowed either; the stand-in never sends it, and whether a real BlueZ does
    is still open.
    `waitron.sh install` also switches off bluetoothd's `autopair` plugin with a systemd drop-in
    where it can (`deploy/README.md` says when it leaves Bluetooth alone), because on the owner's box it answered a PIN-1234 printer with `0000` before any agent was
    asked (`deploy/README.md`). On the owner's box (2026-09-29), under the new profile, a real PIN
    pairing from `docker compose exec -it print-agent bluetoothctl` succeeded and `remove` printed
    `Device has been removed`.
  - **`scan off` and a device's `Disconnected` signals are in the profile — BUILT (A134, #887).** That
    pairing on the owner's box logged four refusals: `Adapter1.StopDiscovery` (twice, from the
    interactive session) and the `Disconnected` signal on the device's `Device1` and
    `Bearer.BREDR1`. The profile now allows those three messages, and
    image-smoke runs an interactive `scan off` and a pairing the stand-in BlueZ follows with both
    signals, failing on any refusal but its `trust` control. Probe run 36617097865 reproduced the
    three refusals without the new rules and 36617716323 refused none with them. The agent's own
    scan (`bluetoothctl --timeout 6 scan on`) sends no `StopDiscovery`, measured on both runs:
    three scans each, no call reached the stand-in and none was refused. **Box check owed:** after
    `sudo bash waitron.sh install`, switch off the kernel's rate limit on its log first
    (`sudo sysctl -w kernel.printk_ratelimit=0`), which can drop refusal lines — image-smoke
    switches it off for that reason. Then `scan on` / `scan off` and a pairing from
    `docker compose exec -it print-agent bluetoothctl`, then
    `sudo journalctl -k --since '-5 min' | grep 'apparmor="DENIED"'` should print nothing for
    `waitron-print-agent`.
  - **The owner's box, in this order — done 2026-09-29.** The owner took the real-box pairing
    measurement with the profile `unconfined`, then ran `waitron.sh install`; afterwards `.env`
    named the profile and `docker compose exec print-agent bluetoothctl list` showed the controller.
  - **The setup page's HTML says nothing about it** — only `/status.json` and the log do. The page
    is English-only, with no language switch to carry a Spanish line.
  - **A bus policy that refused BlueZ's own calls would read as `no_controller`**: measured
    2026-09-29 on a GitHub ubuntu-latest runner (Ubuntu 24.04.5, bluetoothctl 5.82, run
    36559399185) against the stand-in BlueZ, with a profile that allowed the bus daemon's own
    messages but no message to BlueZ: `bluetoothctl --timeout 3 devices Paired` printed "No default
    controller available" and exited 0. The latest runs against the shipped rules are 36562032152
    and 36562581079 (the first printed Docker 28.0.4 and AppArmor parser 4.0.1).
  - **Reloading at boot — tried 2026-09-29 on the owner's box, and it works:** after a restart
    `.env` still named the profile and `docker compose exec print-agent bluetoothctl list` showed
    the controller, so the boot-time `apparmor.service` reloaded `/etc/apparmor.d/waitron-print-agent`.
  - **DONE (A131, #915): a failed Bluetooth scan keeps the USB and network printers found in the
    same scan.** `createLinuxDevices`'s `scan()` (`apps/print-agent/src/linux-devices.ts`) now
    catches the Bluetooth part, keeps the USB and network results, and logs
    `bluetooth scan failed` with the error; the two `scan()` cases in `linux-devices.test.ts`
    whose Bluetooth fake fails both fail with the catch deleted. A scan failure still does not
    change the agent's Bluetooth availability report, which comes from the paired listing alone.
    The failure's text stays in the agent's log and never reaches the server; a failed pass reports
    no Bluetooth sightings, so while Bluetooth scans keep failing, an unpaired Bluetooth printer
    drops off the dashboard's list 15 seconds after the last pass that saw it, as if it were out
    of range. _(2026-09-30, C102: 45 seconds while a discovery window is open.)_
    Left open: `bluetooth scan failed` is logged on every pass, where the agent's other Bluetooth
    failure lines are logged once while the same failure repeats, so a box with no adapter logs
    one line per pass while a discovery window is open (the old `scan failed` line did the same).
  - **On the LAN the Bluetooth report is visible only before joining or while out of touch.** Once
    the agent has joined and is not out of touch, `/status.json` answers only loopback callers
    (`networkRefused`, `apps/print-agent/src/setup-page.ts`).

- **DONE (C117, #955): while Add a printer is open, print jobs no longer wait behind each scan pass.**
  The agent's poll (`tick`, `packages/print-agent/src/agent.ts`) starts a scan pass without waiting
  for it and asks for jobs at once; at most one pass runs at a time, a poll that finds one running
  starts no other. A finished pass's devices go out on the next poll, which the pass wakes so they
  are not held for the 2-second pause, and again on each later poll until one succeeds, unless a
  newer pass's devices replace them first or a setup reset drops them. A setup reset also drops
  what a running pass finds. Timed
  on 2026-09-30 with a throwaway script driving the real loop with real timers, a 2-second pause and
  a fake server queueing a job every 1.3 s: with a 10-second fake scan, the time from a job being
  queued to the poll that took it was 0.09 / 7.50 / 11.80 s (min / median / max, 12 jobs) on the
  old loop and 0.10 / 1.30 / 2.00 s on the new one. The run-it review repeated it independently the
  same day, on the branch before the pending-list change (real loop, real timers, a 2-second pause,
  a 10-second fake scan, 12 jobs queued every 1.3 s): 0.10 / 0.85 / 1.70 s on the branch, 0.30 /
  6.60 / 10.70 s on the old loop. The agent puts no limit of its own on a pass: a
  pass that never ends only stops later passes starting, never the job pulls. What ends a real
  pass is the host's own timers: each `bluetoothctl` call is killed after 15 s
  (`apps/print-agent/src/bluetooth-command.ts`), mDNS closes after 1.5 s (`liveMdnsScan`,
  `apps/print-agent/src/linux-devices.ts`) and each sweep connection gives up after 500 ms
  (`DEFAULT_TIMEOUT_MS`, applied by `sweepPort` in `apps/print-agent/src/sweep.ts`, enforced by
  `connectTcp` in `apps/print-agent/src/tcp-probe.ts`). The run-it review timed those three on
  2026-09-30 with fakes in scratch tests: a hung fake `bluetoothctl` was killed with SIGKILL at
  15.0 s, a live mDNS listen ended at 1.50 s, and a silent sweep socket was destroyed at 0.50 s.
  Read, not run: the whole sweep across several networks and the USB reads have no overall limit.
  Tests: the cases under "a discovery pass runs beside the job pull" in
  `packages/print-agent/src/agent.test.ts`. Deletion proofs, re-run on 2026-09-30 against the code
  after the pending-list change, each with
  `pnpm --filter @waitron/print-agent exec vitest run src/agent.test.ts`: awaiting the pass inside
  the poll again turned 8 cases red, "pulls and delivers a job queued while a scan is still running" among them; dropping the one-pass-at-a-time
  check, the reset's generation check, the wake or the reset's clearing, clearing the devices
  before the pull again, or clearing them after every successful pull without checking they are
  still the list that was sent each turned its own case red ("a tick that finds a pass still
  running pulls and starts no second one"; "a setup reset drops a running pass's devices, and a new
  window scans once that pass ends"; "a finished pass wakes a sleeping loop so its devices go out at
  once"; "a setup reset drops a finished pass's devices that no pull has carried yet"; "keeps a
  finished pass's devices through a failed pull and sends them on the next pull that succeeds";
  "keeps the devices of a pass that finishes while a successful pull is carrying an older pass's").
  Removing the logger's `try`/`catch` made no case fail its assertions; the run fails on the
  unhandled rejection Vitest reports. Left open: the office-printer
  check and the check of addresses typed into the dashboard still run inside the poll, so the job
  pull still waits for them (see "A sweep in flight keeps connecting" below).
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
- **DONE (C70, #866): a sent print job is no longer recorded as failed when its `done` report is
  refused.** `runAgentOnce` (`packages/printing/src/runtime.ts`) now holds only `transport.send`
  inside its `try`, so a refused `done` report no longer uses up an attempt or stores the
  database's refusal text as a printer error; the refusal now reaches the caller. The refused job
  still prints again either way. If the caller's transaction rolls back, it goes back to `queued`
  with the rest of its batch. If the caller commits, it stays `printing`: an immediate re-run
  claimed nothing (measured 2026-09-29), and from the claim query, not run, `claimPrintJobs`
  re-claims it once its `claimed_at` is older than `PRINT_JOB_LEASE_MS`. Jobs after it in the
  same batch were claimed but not sent, and share its fate. Case: "does not record a sent job as
  failed when its done report is refused; the refusal propagates" in
  `packages/printing/src/runtime.test.ts`. Still no caller in the tree outside this package's
  tests. Measured 2026-09-29 with a scratch probe, not committed (two jobs, one `withTransaction`
  around `runAgentOnce`, the second job's `done` refused by a trigger): the refusal rolled BOTH
  jobs back to `queued` after both had printed, so both print again. A process that holds the
  venue database and runs the agent itself, and wants to confine a refused report, should call
  `claimPrintJobs` and then `reportPrintJob` per job, each report in its own transaction, as
  `apps/server/src/print-api.ts` already does, rather than one `runAgentOnce` in one transaction.

### B7. Provisioning and build debt

- **DONE (#752): the email and machine-key credential readers check the fields they use**,
  through `credentialField` in `apps/server/src/credentials.ts`.
- **The bucket-stream reader still passes a missing field on unchecked.** `readStreamSettings`
  (`apps/server/src/stream-host.ts`) hands each `backup.stream` field on as read, so a row sealed
  before a field was added yields `undefined` in the bucket settings; a missing `endpoint` reads as
  Amazon's, pointing the stream at the wrong host. Routing each field through `credentialField` is
  one line, but from reading the code on 2026-09-27 (nothing run), three callers would then refuse
  where the owner needs a way forward: the Backups screen's `GET /api/backup/stream` (`view()` in
  `apps/server/src/stream-api.ts`) would fail, and the dashboard panel then shows none of the form,
  Change or Turn off, the only ways to repair it; the first start after a restore
  (`readBucketPointerTerm`, `apps/server/src/rebuild-first-start.ts`) would fail on every start; and
  the archive restore (`apps/server/src/restore-stream.ts`) reads the settings outside its mapping to
  `restore.stream_source_unchecked`, so the command line would print a bare "restore failed". The
  recovery-kit download and the stream host's start can refuse without harm. Reachable only once
  the `backup.stream` field list changes. **Next action:** add the check together with those three
  callers' handling, each with a failing test first.
- **Reading a credential does not re-check it against `PURPOSES` — owner decision 2026-09-15.**
  `getCredential`/`tryGetCredential` (`packages/credentials/src/store.ts`) return what was sealed,
  rather than refuse the read, which would stop every venue holding that kind of secret the moment
  a field is added; each reader is to check the fields it uses instead (the bucket-stream reader,
  above, does not yet). `rotate` re-checks a secret against the current list only when it re-seals
  one: it skips a secret already on the current key (`rotateCredentials`,
  `packages/credentials/src/store.ts`), so an out-of-date one stops a key rotation only when it is
  on an older key, until it is re-entered (measured by #577's review).
- **`CardProviderBuildDeps.nodeId` is dead weight — nothing reads it** (2026-09-16, traced through
  both adapters). `packages/payments-sumup/src/provider.ts` declares the field and never touches it,
  and `reverseViaStripe` (`packages/payments-stripe/src/reverse.ts`) requires it on its options
  object but destructures only `resolveProcessorRef`. **Next action:** delete the field and the
  values every caller passes, or, if a record path is meant to use it, wire it up and say where.
- **A box that mints its certificate before NTP sync persists a wrong validity window**, with no
  renewal path yet. Ties to a time-health check and certificate renewal.
- **Fixed (C71, #870): server shutdown closes the database even when stopping background work fails**
  (`apps/server/src/boot.ts`). One consequence: if stopping Litestream itself fails, the store is
  now closed while Litestream may still be running, where before it was left open; nothing tests
  that case.
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
- **A venue plan giving `dayCutover` as `HH:MM` would make an idempotent re-provision fail**
  (found 2026-09-16 during #378's run-it verification; it predates that branch,
  which touches neither line). `packages/provisioning/src/venue-plan.ts` documents the field as
  `"HH:MM" or "HH:MM:SS"`, but on a re-run `packages/provisioning/src/venue-apply.ts` compares the
  stored value — read back from a `time` column, so always `HH:MM:SS` — against the plan's string
  with `===`. A plan carrying `"06:00"` would therefore look like a different venue and be refused
  with `provisioning.second_venue`. Latent, not live: every fixture and every caller uses the long
  form, and the short form is not reachable through `dev:setup`, so nothing covers it either.
  **Next action:** either normalise the value where the plan is built, or narrow the documented type
  to `HH:MM:SS` — and add the failing case first.
- **An ahead database is refused before the server starts — DONE (#489).**
  `apps/server/src/node-entry.test.ts` asserts `startServer` was never called when the ahead check
  raises `provisioning.database_ahead`. Verified 2026-09-27: moving `assertNotAhead` after
  `startServer` made the focused test fail because `startServer` was called once; restoring the
  call order made it pass.

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

- **`scripts/migration-upgrade.test.ts` makes its scratch directory under `/dev/shm` when it exists
  — DONE (lane A's A122, **PR #856**, 2026-09-29).** It ran 2.5 to 6 times slower on CI's disk than
  in memory; the disk as the cause of its timeouts is inferred:
  [ci-and-gates.md](developers/ci-and-gates.md#the-upgrade-test-keeps-its-database-in-memory-on-linux).
  Left open by #856: `scratchParent()` does not fall back to the disk when `/dev/shm` is nearly full
  (in a Linux container the test peaked at about 14 MiB and failed with 8 MiB free), and on CI's
  Linux runner `scripts/scratch-dir.mjs` measures 83% of branches, because the line for a missing
  `/dev/shm` runs only on macOS; the root project's thresholds still pass. Neither is queued.
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
- **Dependabot, switched on by #760 (2026-09-27) — DONE: the 15 security alerts fixed by lane A's
  A107 (**PR #796**, 2026-09-28).** Config:
  `.github/dependabot.yml`; how to land one of its PRs: `docs/developers/workflow-guide.md` →
  Dependabot pull requests. Its first two PRs landed as #764 (mailpit) and #765 (ten npm
  minor/patch bumps). #766, a lone major bump of `@vitest/browser-playwright` to 5.0.1 beside
  `vitest` 4.1.11 that failed CI, was closed on 2026-09-27 with
  `@dependabot ignore this major version`, and a `vitest` group now moves `vitest` and `@vitest/*`
  together, majors included. That close stored an ignore of `@vitest/browser-playwright` 5.x;
  whether the group's Vitest 5 PR obeys it is untested and GitHub's docs do not say (how to check
  and clear it: workflow-guide → Dependabot pull requests); such a PR also has to re-measure
  mutation first (Track C, *Left behind by the Stryker upgrade (#447, 2026-09-19)*). **The security
  alerts.** On 2026-09-28 `gh api repos/clintongormley/waitron/dependabot/alerts?state=open` listed
  15 open alerts, every one a package another package pulls in, and every one in a development
  tool: none of the six packages is among Waitron's own dependencies in the box image, whose
  application JavaScript is the built bundles and whose only application `node_modules` is sharp's
  own folder (`deploy/Dockerfile`) — npm's own copy of `brace-expansion` in the Node base image,
  5.0.9, is outside every alert range — and the three front-ends, the print agent and the server
  built byte-identical before and after the change (189 files compared). Where each came from, from
  the lockfile: `fast-uri` 3.1.3 through `ajv` in `@stryker-mutator/core`; `qs` 6.15.1 through
  `typed-rest-client` 2.3.1, which pins exactly that version, in `@stryker-mutator/core`;
  `browserslist` 4.28.6 and `baseline-browser-mapping` 2.10.43 through Babel 8 in Stryker's
  instrumenter; `brace-expansion` 2.1.2 through `testcontainers` in the two `bench/` rigs; `esbuild`
  0.18.20 through `drizzle-kit` → `@esbuild-kit/esm-loader` → `@esbuild-kit/core-utils`, which is
  what declares `~0.18.20`. The fix: four were moved inside the ranges their parents already
  declare (`fast-uri` 3.1.8, `browserslist` 4.29.1, `baseline-browser-mapping` 2.11.26,
  `brace-expansion` 2.1.7), and two are forced by root `pnpm.overrides` entries —
  `typed-rest-client>qs` to `^6.16.0` (6.16.0), and `@esbuild-kit/core-utils>esbuild` to `^0.25.0`
  (the 0.25.12 already in the tree). The same install also moved `brace-expansion` 5.0.7, not an
  alerted version, onto the 5.0.12 already in the tree, and moved the four other packages
  `browserslist` 4.29.1 depends on (`caniuse-lite`, `electron-to-chromium`, `node-releases`,
  `update-browserslist-db`). What was run for the two overrides: `typed-rest-client`'s query-string
  builder over eight parameter shapes gave the same URLs under `qs` 6.15.1 and 6.16.0 except one,
  where 6.15.1 threw a `TypeError` and 6.16.0 does not (the `arrayFormat: 'comma'` null-entry fix
  in `qs` 6.15.2's changelog); a search of Stryker's installed `dist` found `typed-rest-client`
  imported in two of its JavaScript files, `initializer/npm-registry.js` and
  `reporters/dashboard-reporter/index.js` (its type files name it only in the same two areas), and
  no `stryker.config.json` here names the dashboard reporter.
  `drizzle-kit` 0.31.11's shipped code never names `@esbuild-kit` (only its `package.json` does):
  with both `@esbuild-kit` folders renamed away, `drizzle-kit generate` in all fourteen migration
  sets printed the same as before; each set generated from nothing gave the same SQL and snapshots
  before and after the override (ids and timestamps aside); and the loader itself still runs a
  TypeScript file on esbuild 0.25.12. A full Stryker run over `packages/shared` gave the same 990
  mutants with the same results on the old and new lockfile. After the merge, `gh api
  repos/clintongormley/waitron/dependabot/alerts?state=open` returned none, and all 15 alerts read
  `fixed`, stamped 2026-09-28 00:33 UTC. The `versioning-strategy`
  question is recorded under #432's loose ends in Track C.
- **CodeQL's three smaller findings — DONE (lane A's A106, run by lane C, **PR #792**,
  2026-09-28).** `js/biased-cryptographic-random` (alert 34): the demo company tax id in
  `packages/country-es/src/spain.ts` now draws again when a 32-bit draw lands at or above
  4,290,000,000 (429 × ten million) instead of reducing it, so every seven-digit number is equally
  likely; demo data only, never filed. The two sanitization findings in test files (alerts 32, 33)
  are dismissed as "used in tests" with the reason on each: one strips `<style>` blocks from two
  SVGs read from the repository, the other removes the required-field asterisk from a heading the
  test itself rendered; neither sees outside input and neither result is rendered or served.
- **Code scanning (CodeQL default setup) switched on 2026-09-27 — DONE: the six ReDoS alerts by
  lane C's A105 (**PR #793**, 2026-09-28), the other 28 by A104 and A106.** Enabled with
  `gh api -X PATCH repos/clintongormley/waitron/code-scanning/default-setup
  -f state=configured -f query_suite=default`; it analyses `actions`, `javascript-typescript` and
  `python`, weekly and on each PR, as a check the ruleset does not require. Its first run
  (36345264936) left 34 open alerts: 25 `actions/missing-workflow-permissions` (24 jobs in
  `.github/workflows/ci.yml`, one in `stripe-sandbox.yml`), 6 `js/polynomial-redos`
  (`packages/dashboard-kit/src/i18n.ts` twice, `packages/identity/src/email.ts`,
  `packages/printing/src/layout.ts`, `packages/stream/src/names.ts`,
  `packages/sync-enrolment/src/migration-tables.ts`), 1 `js/biased-cryptographic-random`
  (`packages/country-es/src/spain.ts`), and 2 sanitization findings in test files
  (`scripts/trust-page-logo.test.ts`, `apps/dashboard/src/widgets/extra-list-form.test.ts`). The
  last three are A106's, in the bullet above. List the open
  ones with `gh api "repos/clintongormley/waitron/code-scanning/alerts?state=open"` — on
  2026-09-28, after #792 merged, it listed the six ReDoS alerts and alert 34, which closes only when
  CodeQL analyses `main` with #792 in it; `state=fixed` listed 25.
  **The 25 permission findings are fixed by lane A's A104 (PR #791):** `ci.yml` and
  `stripe-sandbox.yml` now set `permissions: contents: read` at the top, `publish` keeps its own
  `packages: write`, and `scripts/ci-workflow.test.mjs` fails any workflow job left on the
  repository's default token permissions — weaker than its name, it reads each file as TEXT by
  indent: a job is any two-space key after the `jobs:` line and only a `permissions:` key at
  four-space indent covers it, so a job written in flow style on one line is reported even when it
  names permissions, and any top-level value, `write-all` included, counts as covering every job.
  The repository's default read read-only the day after CodeQL raised the 25 alerts
  (`gh api repos/clintongormley/waitron/actions/permissions/workflow` printed
  `"default_workflow_permissions":"read"` on 2026-09-28); the change narrows every scope but
  `contents` to none (GitHub always grants `metadata` read access) and puts the setting in the
  files. All 25 read `fixed` after `main`'s CodeQL analysis of `6e5fc6a52` (2026-09-28). `main`'s
  CI run for that commit skipped `publish`, because a root-only push sets `code=false`; the first
  code push to `main` after it is the first `publish` run under the new file, though that job
  names its own block.
  **The six ReDoS findings, fixed by lane C's A105 (PR #793):** each flagged pattern was timed on
  Node v26.7.0 on the owner's Mac, on the shape CodeQL's alert names plus an ending that makes the
  match fail (a trailing `@` or line break, a final letter), at 10,000, 50,000 and 100,000 repeats.
  Every one but `/^\/+/` grew with the square of the input: 29–92 ms, then 0.69–2.30 s, then
  2.76–9.11 s, the email pattern slowest. Without the failing ending, the email and locale patterns
  answered in under a millisecond. Each is replaced by plain string code (`indexOf`, `slice`, a
  loop trimming one character), with a case that a crafted input finishes within one second (red on
  the old pattern, 9.5–26.5 s) and cases pinning what the old pattern returned. Reachability, per
  site:
  `isValidEmail` (`packages/identity/src/email.ts`) is reached from the unauthenticated
  `POST /management-api/password-reset`; `normalisePrefix` (`packages/stream/src/names.ts`) reads
  the bucket prefix a person types; the region strip in `packages/dashboard-kit/src/i18n.ts` runs in
  the browser on the saved or browser locale; `wrapText`'s trailing-space trim
  (`packages/printing/src/layout.ts`) sees a line no longer than the printer's column count; and
  `tablesCreatedBy` (`packages/sync-enrolment/src/migration-tables.ts`) is called, outside its own
  suite, only by three test suites (`git grep -n -w tablesCreatedBy`, 2026-09-28:
  `packages/db/src/classification.test.ts`, `packages/identity/src/classification.test.ts`,
  `scripts/classification-complete.test.ts`), over the repository's own migration SQL. On 800,000
  random strings (4,888 of them accepted) the old pattern and the new code gave the same answer. One
  behaviour moved, in `packages/dashboard-kit` only: a locale with a line break after its dash now
  loses everything from its first dash, like any other; the old pattern removed only a dash no line
  break followed, and everything after it (`"es-\nES"` was left whole, `"es-\n-ES"` became
  `"es-\n"`), so it fell back to English. The six alerts close when CodeQL analyses `main` with
  #793 in it.
  **Dependabot malware alerts** were switched on by the owner on 2026-09-27 from the repository's
  Settings → Advanced Security page, by the owner's report, unconfirmed: GitHub's docs
  (`content/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/configure-malware-alerts.md`)
  give only that page's **Enable** button, so the setting was not read back.
- **`stripSql`'s line-comment pattern `/--.*$/` also grew with the square of its input — DONE (C27,
  2026-09-28).** Found by A105 in `packages/sync-enrolment/src/migration-tables.ts`; CodeQL did not
  flag it. It is now `dropLineComments` (`indexOf("--")` and `slice`). Measured on Node v26.7.0: a line
  of 200,000 `-` followed by a carriage return took 12.8 s through `tablesCreatedBy` with the old
  pattern, and a case now holds it under one second. One behaviour changed: JavaScript's `.` stops
  at a carriage return, U+2028 and U+2029, so when one of those followed a `--` comment on its line
  the old pattern left the comment in place, and a commented-out `CREATE TABLE` ending in any of the
  three was counted; the new code drops it, and three cases pin that. On lines holding none of those
  three characters the two agree: one case compares them over a hand list and 20,000 random strings,
  another line by line over every migration file the package's helpers list (72 on 2026-09-28, none
  holding any of the three), and both go red when `indexOf` is swapped for `lastIndexOf`. The order
  of blanking is unchanged, so the bullet "The two SQL scanners named `stripSql`…" is neither better
  nor worse.
- **Copies of the patterns A105 and C27 replaced — OPEN.** The twins A105 and C27 left standing,
  each OPEN: the same two SQL patterns (the block-comment one A105 replaced, and `/--.*$/`, the one
  C27 replaced) are copied in `scripts/module-graph-honesty.test.ts` (lines 67 and 69), a guard
  reading the repository's own SQL; `apps/till/src/i18n/t.ts` still strips the region with `/-.*$/`
  on the till's locale (CodeQL did not flag it); and `/\/+$/` (written `/\/+$/u` in
  `mailpit-client.ts`) is still used in `apps/server/src/boot.ts` (a peer relay URL from
  `mirror_config`, owner-written config), `apps/server/src/mailpit-client.ts` (the loopback Mailpit
  base URL) and `apps/server/src/mirror-bundle-fetch.ts` (a URL already parsed by
  `assertSafePrimaryUrl`) — none of the three timed; and the email pattern itself is still copied
  six times in `apps/dashboard` (`login-preference.ts` twice, `screens/login-screen.ts`,
  `screens/profile-screen.ts`, `widgets/person-edit.ts`, `widgets/person-form.ts`), run in the
  browser on an address the person typed or the browser saved (CodeQL did not flag them either). See
  also the OPEN bullet "The two SQL scanners named `stripSql`…": a fix to one touches the other's
  code.
- **`apps/server/src/stream-host.test.ts` passes only in file order — DONE (lane A's A88, **PR
  #775**).** Found by #752's review: under Vitest's shuffled order (`--sequence.shuffle`) cases
  expecting no bucket credential, or no membership document, failed when a nested `describe`'s
  `beforeAll` had already stored one — the suite had opted out of `useVenueDb`'s per-test reset. It
  now takes the reset, and the three blocks that stored rows write them in `beforeEach`; no
  assertion changed. Measured 2026-09-27 on this machine: before, 10 of 14 seeds failed 3 cases
  (seeds 1–12, 577, 578); after, seeds 1–20, 577 and 578 and file order all pass 23 of 23. Controls:
  turning the reset back off fails the same 3 cases at seed 578; writing the membership document in
  `beforeAll` again fails 11 in file order. Nothing runs this suite shuffled in CI, so a failure
  that shows only in another order would go unseen there.
- **A main server shard lost the landing listener's chosen port — DONE (lane A's A80, **PR #740**).**
  Exact-merge CI run 36317643554 at `30d9836028e44180feca9578b87d389ab8cdd786` logged
  `server.listening` on port 40141 and, 2 ms later in the same boot, `landing.listen_failed` with
  `EADDRINUSE` on 40141: the test had drawn its HTTP port and its landing port one after the other,
  releasing the first before drawing the second, and got the same number twice. The plain-HTTP fetch
  then reached the HTTPS server, which closed the socket (`UND_ERR_SOCKET`). Measured 2026-09-27 in
  `node:24-slim` (Node v24.21.0, kernel 6.12): drawing two ports that way returned the same port 9
  times in 50,000 pairs, and 0 times with both probes held until both were drawn; on macOS (Node
  v26.7.0) the old way repeated 0 times in 20,000 pairs, which is why local runs never showed it.
  `apps/server/src/testing/free-ports.ts` now replaces the twelve per-file copies and the
  `s3-test-server.ts` one; `freePorts(n)` holds every probe until the last port is drawn, and the
  places that drew two ports before binding either (the landing case, the failed-start landing
  cases, the two-server failover test, two "unreachable peer" ports drawn beside the server's own,
  and the unreachable primary in `boot.test.ts`'s "refuses to adopt from a primary it cannot reach")
  now draw them in one call. **Still open:** a port is still released before the server binds
  it, so another test worker drawing or connecting in that gap can take it; nothing has measured how
  often. Removing that would need the server to accept port 0 and report the port it bound
  (`WAITRON_HTTP_PORT` refuses `"0"` today). `bench/sqlite-failover/src/unreachable-store.ts`'s
  `reservePort` and the inline copy in `apps/server/scripts/cloud-integration-fixture.ts` have the
  same release-then-use shape and were not changed. (2026-09-30: C88, #920, reproduced this gap as one way
  the pause test's single CI failure could happen; that run's log does not show whether it did.
  `startS3TestServer` now recovers from it; see C88, "the pause test's bucket control failed once
  on `main`". C88 also measured one drawing pattern: two processes each drawing 20,000 ports back
  to back in `node:24-slim` drew the other's latest port 0 times. The Waitron servers' own ports
  still have the gap.)

- **`scripts/waitron-sh.test.mjs` failed at random when its temporary folder's name held a word it
  matched — DONE (lane A's A31b, **PR #661**).** The docker stub now drops `compose` and one leading
  `-f <file>` and takes the subcommand by position, and every check on a compose subcommand reads
  the calls through `composeCalls`.

- **A pull request that changes only `scripts/bundle-node.mjs` builds no bundle — DONE (the
  owner's answer (a) to lane B's campaign queue item B8 about #580 — not §B8 above; **PR #593**).**
  `scripts/changed-scope.mjs`'s `ROOT_SCOPE_CONSUMERS` maps a root script to the members that use
  it, so a change to it selects them and `bundle-smoke` runs; guard
  `scripts/root-scope-consumers.test.mjs`, which reads text: a path assembled from parts is
  invisible to it.
  **Still open:** `bundle-smoke` builds only the credentials and server bundles, so a change to the
  shared script selects print-agent and provisioning for typecheck and tests but builds neither of
  their bundles in CI. `bundle-smoke` built the same two before #580
  (`git show 7b1ad8889^:.github/workflows/ci.yml`).
- **Every package to the high coverage bar, `98/98/98/95` — DONE (owner decision 2026-09-23; the
  floor retired 2026-09-24 by **PR #549**).** Every package and the root project hold the bar,
  pinned by `scripts/coverage-thresholds.test.ts`, a new package included from its first commit.
  First promotion **PR #498** (21 packages); then one pull request each: `printing` (#500),
  `bookings` (#503), `tunnel` (#506), `print-agent-app` (#508), `provisioning` (#510),
  `payments-sumup` (#512), `payments-stripe` (#514), `server-kit` (#515), `sync-enrolment` (#518),
  `dashboard-kit` (#521), `fiscal-none` (#522), `setup` (#523), `print-agent` (#525), `identity`
  (#526), `catalogue` (#530), `apps/server` (#534), `apps/till` (#536), `apps/dashboard` (#538),
  `venue-service` (#546) and `media` (#547).
  - From #536: the table-service, boot-and-counter and three `tender-pay-*` suites are separate
    files that can be folded back into `till-app.test.ts` and `tender-pay.test.ts` once
    `feat/variants-sale-line` lands.
- **Prune the comments, one package per pull request — IN PROGRESS (owner decision 2026-09-23).**
  Keep a comment only for an invariant, or a non-obvious why, that the code cannot show (CLAUDE.md
  §1). The rule change and the checker every pruning pull request passes,
  `scripts/comments-only.mjs <base>`, came first; its header states what it refuses and misses.
  What a pruner meets: it reads commits only, never an uncommitted edit; any changed file that is
  not TypeScript, JavaScript or a `.md` file fails it, while a `.md` file is listed as not compared
  and never read (#679); it checks every other file and names every refused file; and it refuses a
  trailing comma added or dropped after a spread, where Prettier writes one, so a pruning edit that
  lets such a call, array or object fold onto one line is refused. The packages follow, the fiscal
  ones under the same gates as any other fiscal change: the golden huella test and the
  `inmutabilidad` suite pass unedited. Not reached by any package's pull request: `bench/` (about
  2,300 comment lines) and the root `vitest.config.ts` and `eslint.config.js`. Landed so far:
  `workforce` (#555), `payments` (#558), `identity` (#559), `provisioning` (#561),
  `fiscal-verifactu` (#562), `apps/setup` (#567), `packages/store` (#568),
  `packages/payments-stripe` (#570), `packages/printing` (#572), `packages/bookings` (#574),
  `packages/credentials` (#577), `packages/shared` (#579), `packages/scheduler` (#581),
  `packages/db/src/schema` (#585), the rest of `packages/db` (#589), `packages/fiscal` (#592),
  `packages/payments-sumup` with `packages/migrations` (#597), `packages/core` (#598), the small
  packages as one pull request (#600: `apps/print-agent`, `print-agent`, `server-kit`, `tunnel`,
  `membership`, `sync-enrolment`, `workforce-es`, `purchasing`, `recipes`, `fiscal-none`,
  `composition`, `diagnostics`, `dashboard-modules`, the `country*` packages, `ui-core` and
  `dashboard-kit`), `packages/reporting` (#601; the generated `src/dr303-layout.ts` untouched),
  `scripts/` (#602, every `.ts` and `.mjs` file; the `.sh` files and `write-path-tables.json` are
  outside the checker and were left), `packages/catalogue` (#603), `packages/ui` (#604),
  `packages/module` (#606), `packages/media` (#609), `packages/venue-service` (#611),
  `apps/dashboard` (#607 screens, #610 api and widgets, #612 the rest), `apps/till` (#614 screens,
  #616 widgets, #618 api, state and i18n, #621 the rest) and `apps/server` in parts (a #613, b #623,
  c1 #624, c2 #653, d #615, e1 #625, e2 #656, f1 #617, f2 #657, g #622, h1 #620, h2 #658, x #629).
  A pruning pull request
  cannot carry this file (the checker refuses it), so each one's line lands here as a docs-only
  push after the merge. Found by #555, #558, #559, #561, #562, #567, #568, #570, #572, #574, #577,
  #579, #581, #585, #589, #592, #597, #598, #600, #601, #602, #603, #604, #606, #607, #609, #610, #611, #612, #613, #614, #615, #616, #617, #618, #620, #621, #622, #623, #624, #625, #629, #653, #656 and #657 and left for the package that owns each, all
  still OPEN:
  - Found by the retroactive Codex reviews of #621–#626 and #629 (C3.18.12r, 2026-09-25; fixes
    landed as #632, #633, #635, #637 and #639; #626 and #629 came back clean), outside the files
    those fixes could change or not changeable in a comments-only PR:
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
    comments-only change. **Done (lane A's A41, #673):** `unpackBundleToDir`
    (`apps/server/src/state-secrets.ts`) now makes the destination and every folder between it and
    an entry 0700 whether or not they existed. `resolveSafeEntryPath` itself is unchanged, and
    nothing chmods the staging folder that
    the archive restore's two entries outside `secrets/` (`manifest.json` and `db.dump`) are
    checked against; it receives nothing and keeps an existing folder's mode.
    Still open, not fixed: the walk and the file write go by path, so a folder inside the destination
    swapped for a symlink during the unpack is followed. The A41 run-it review reproduced an outside
    folder being set to 0700 and receiving the secret that way; the same swap between the guard and
    the write already put the secret outside before this change. It needs someone able to write
    inside the destination.
    **Done (lane A's A47, #681):** `waitron-recovery unpack` refuses a destination that is a
    symbolic link, that another user owns, or that is not a folder, and the setup-mode start makes a
    real `tls/` folder 0700 as a restore does. **Done (lane A's A52, #687):** a trading start makes
    a real `tls/` folder 0700 too, through `tightenTlsDir` (`box-secrets.ts`); a linked `tls/` and
    the folder it points to are left as found, by the owner's choice, and a link swapped in for the
    state folder or a folder above it is followed; a folder its owner cannot read is changed by
    path after an `lstat`, and a link swapped in between the two would be followed; a failure to
    tighten logs `tls.tighten_failed`
    and the box serves, while a setup-mode start still stops on such a failure. **Done (lane A's
    A58, #700):** a start that serves the recovery page runs the same `tightenTlsDir` in
    `serveRecovery` (`node-entry.ts`), with the trading start's rules. The restore itself
    (`restoreSecrets`) keeps none of the
    command's destination refusals (a symbolic link, another user's folder, not a folder) on the
    state folder it is given. A41's swap race above stays open, by the owner's
    choice.
    The lock-file measurement kept in `db-wipe.ts` names no engine version or platform.
  - Found by #657 (`apps/server` part f2: the node, identity and setup files), outside its files
    or not fixable in a comments-only change. **Done (2026-09-26, lane A's A42, #674):** when
    recording the setup operation failed before `execute` started, the in-memory setup lock stayed
    set until a restart; provision and adopt now release the lock whenever the request does not
    end in a success answer. A
    completed provision or adopt operation replayed on a later request still answers 200 without
    restarting and keeps the lock set, as before (measured on the old and new code; the Cloud
    restore's replay does restart).
    **Done (2026-09-26, lane A's A43, #675):** a refused adopt no longer keeps its recorded
    operation, so a corrected adopt (or another setup) no longer meets `409 setup.operation_conflict`;
    the record is kept once adopt is past its own checks (`adoptFromPrimary` awaits a
    `beforeFirstWrite` step just before `stampDeployment`, where the route moves it to
    "venue_committed"), adopt refuses `deployment.already_stamped` before that step, and the wizard
    maps `setup.operation_conflict` to provision's saved-setup message.
    **Done (2026-09-26, lane A's A50, #685):** adopt now answers `deployment.already_stamped` with
    409, as provision does, and the wizard says a previous attempt left the server partly set up.
    **Done (2026-09-26, lane A's A50, #685):** the owner chose to refuse. The same adopt body resent
    after a failure past the first write now answers 409 `setup.adopt_incomplete` without calling
    adopt again (before, the retry generated a second standby identity). Still not measured: what
    the first identity leaves behind on the primary and on this node.
    **Found after A50 (#685); (a) done box-side by A56 below, (b) done by A55 below:** (a) nothing
    told support how to reset a box whose adopt stopped partway; (b) with an authenticator, a resent
    adopt carries a new one-time code, so it met `setup.operation_conflict` rather than
    `setup.adopt_incomplete`.
    **Done (2026-09-26, lane A's A55, #691), for (b) and the first-failure sentence; (a) stays open:**
    after a failed adopt, the wizard (`#mapAdoptError`, `apps/setup/src/setup-app.ts`) reads
    `/setup-api/status` and shows the stopped-partway message with a plain "Reload" and no retry
    when an adopt is saved past "started" and short of "complete". Not run: the wizard against a
    real server.
    **Done (2026-09-26, lane A's A56, #694), for (a), box side only:** where the wizard shows the
    stopped-partway message it now offers "Reset this server": the operator types the admin person
    ID and password the join used, `POST /setup-api/reset-incomplete-adopt` checks them against a
    proof adopt saves in `setup-operation.json`, and the next start (`runStagedReset`,
    `apps/server/src/reset-request.ts`) removes the venue databases, `pending-adoption.json`,
    `modules.json` and the record. Left open: (1) **the primary still lists the abandoned
    standby** — the installation number the primary reserved for that standby is burned by design
    (`reserveInstallationNumber`, `packages/fiscal-verifactu/src/registro-sif.ts`: "a
    never-promoted standby simply burns it — gaps are permitted").
    **Done for (1) (2026-09-26, lane A's A61, #708):** the dashboard's Servers screen lets an admin
    (`mirror.create`) on the serving primary remove a standby that never finished joining
    (`POST /management-api/servers/:nodeId/remove`), marking it `evicted`. **Done (2026-09-27,
    lane A's A70, #724):** the standby's reset page now points to Remove and then Clear from list on
    that screen, and says to do it before joining again (`apps/setup/src/screens/reset-screen.ts`);
    `deploy/README.md` carries the same pointer. Left for the owner from A70's review: the reset
    page does not show this server's machine id, so an operator cannot tell which row on the
    primary is this server's (the page's wording only, not a screen change, was in scope). Still
    open: "never finished joining" is read as
    `serving-secondary` with no `nodes` row in the primary's database, and a remote standby writes
    that row in its own database, so the check cannot see a remote standby that finished — none can
    today (`finish-adoption.ts`).
    **Done (2026-09-26, lane A's A63, #712) for A61's two other open notes** (a removed entry still took a
    `MAX_NODES` place; a removed node still held the primary's endorsement of its key): an admin
    (`mirror.create`) on the serving primary can clear a removed machine from the Servers screen
    (`POST /management-api/servers/:nodeId/clear`, routed in
    `apps/server/src/membership-removal-api.ts`, decided in `apps/server/src/membership-removal.ts`),
    which moves its id into the chart's new signed `revoked` list (outside `MAX_NODES`, capped by
    `MAX_REVOKED`) and writes an append-only `membership_clearances` row. The primary refuses a join
    to a full chart (`mirror.membership_full`), minting refuses a chart over either cap
    (`membership.chart_too_large` for its machines, `membership.cleared_list_full` for its cleared
    machines), and a receiver refuses a chart signed by a machine its own held
    chart lists removed or cleared (`signer_removed`, `verifyMembershipDocument`).
    **Done (2026-09-27, lane D's A74, #730):** clearing a machine when the cleared list is full now
    raises `membership.cleared_list_full`, with its own English and Spanish wording, instead of the
    same `membership.chart_too_large` code as an over-size machine list.
    **Still open after A63:** (i) a removed trust anchor (a machine whose key sits in the receiver's
    own `nodes` table) can still make up a key for a machine in good standing that is not an anchor,
    vouch for it, and sign as that machine — unless that machine signed the receiver's held chart and
    the chart carries the endorsement its signature verifies under, so a standby is not covered, nor
    a primary the receiver holds no chart signed by (after the former primary's own retirement
    chart, for one) (stated at `resolveSignerKey`); (ii) boot
    reconciliation's peer fetch sends no credential (`boot.ts` gives `fetchPeerMembershipDocument`
    only the URL) and `GET /management-api/membership` refuses a request without one, so in
    production that path accepts no chart today and the receiver checks above never run there (read,
    not run); (iii) a cleared machine is refused its own promotion only if its own held chart
    contains the clearing, and a standby that never finished joining never receives it; (iv) so, of
    these guards, only those that run where a chart is made or a join is served work in production
    today: the primary's join refusals (`mirror.standby_removed` for a removed or cleared id,
    `mirror.membership_full` for a full chart) and the mint's size refusals; (v) a receiver whose held chart predates a removal accepts the removed machine's charts
    until it learns of the removal; (vi) a joining standby sees `mirror.bundle_fetch_failed` rather
    than the primary's reason, because `apps/server/src/mirror-bundle-fetch.ts` turns every non-2xx
    answer into that code except a refused login, which it relays as `password.invalid` (C95) —
    this predates A63, and
    `mirror.standby_removed` has the same gap; (vii)
    if A61's removal ever mis-classifies a live standby that an operator later promotes, the old
    primary refuses the new primary's charts (`signer_removed`) and keeps selling; the refusal is
    logged at warn and raises no alert. No adopt can finish today (`finish-adoption.ts`), so no such
    standby exists yet.
    A56's open items, continued:
    (2) An adopt saved before this
    change carries no proof, so the reset refuses it (`password.invalid`). (3) The proof shows the
    login the primary accepted at join time, not that the admin is still active there, and the
    one-time code is not asked again. (4) A join that failed after writing `trading.env` boots the
    trading branch, where no setup route is mounted, so this reset cannot reach it.
    Also open from A42's review, read and not run: if `operation.complete()` throws after `execute`
    has scheduled the restart, the lock is now released while that restart is pending (before A42
    that throw was outside the release and the lock stayed set).
    Stale wording outside f2: "a device with no profile" in `apps/server/src/till-api.test.ts` (near
    lines 1377–1395) and `apps/till/src/till-app.test.ts` (near line 5765), though a device's
    profile column is NOT NULL; the "four ids" test title in `apps/server/src/provision.test.ts`,
    which asserts five; `config.ts`'s "minted once and reused" for the box certificate, which a
    restore re-issues; and `errors.ts` describing `setup.already_provisioning` as a persistent-lease
    refusal, when it mostly comes from the in-memory lock. Test titles carrying history, left
    because titles are code: "(real Postgres)" describes and "(SP-A.2 §16, device-profile §5)" in
    `device-session.test.ts`, "never a raw devices_pkey 23505" in `join-requests.test.ts`, and
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
    caller sets `skipSecrets` any more, so whether the option should go is open. `keyFingerprint`
    (`backup-supervisor.ts`) is the first 8 hex characters of the recovery key's SHA-256, shown in
    the backup status, so anyone who can read the status can test a guessed key against it (Codex's
    probe matched one of three candidates); #656 deleted the comment calling it revealing nothing,
    and the owner decided on 2026-09-25 to leave it as it is. **Done (2026-09-26, lane A's A40,
    #672):** the backup status no longer reports an archive the old sweep stored under the OLD key
    as under the current key: the old sweep's `onStored` now does nothing once it is aborted.
  - Found by #653 (`apps/server` part c2: `boot.ts`, `boot.test.ts`, `config.ts`), outside its
    files or not fixable in a comments-only change. `apps/server/README.md` (near line 230, the
    `WAITRON_SKIP_RETRY_MS` row) says the sleep clamp can round a value "past" a bound, which it
    cannot (`sleepMsFor` in `loop.ts` is `Math.min(max, Math.max(min, wait))`, and config refuses
    `minTickMs > maxTickMs`; #653 corrected the same claim in `config.ts`); `config.test.ts`'s
    test title (near line 572) says "round back down past the floor" where it means "to the
    floor". **Done (2026-09-26, lane A's A38, #669):**
    `packages/db/src/node-membership.ts`'s header no longer says the caller of `readNodeMembership`
    re-runs `verifyMembershipDocument` / `acceptMembershipDocument`; readers trust the row. The
    restore question it raised is open under Task 9a (the archive and bucket first start now checks
    the row, #678; the rest stays open there). Two notes #653's prune deleted and
    nothing else recorded: nobody knows why the 5-second busy timeout did not absorb a
    `database is locked` in the pending-payment sweep; and nothing proves `startServer` itself
    survives a backup duty that cannot start — only `backup-supervisor.test.ts` covers that, at the
    supervisor. **Done (2026-09-26, lane A's A39, #671):** a start that failed after boot's
    long-lived open no longer leaves the venue store open: when its body throws, `startServer`
    undoes what boot had reached, newest first, then closes the store; the landing listener,
    started last, is not undone (`apps/server/src/boot.failed-start.test.ts`, weaker than it
    reads). Receipt: `docs/developers/conventions-data.md`, "A failed start undoes what
    it started". Left open by #671: each stop is written twice, once in the unwind list and once
    in the mode's `stopWork`; sharing one list was declined because it would change the normal
    shutdown order, which no test pins either.
    Test titles #653 could not touch in `boot.test.ts` carry the history tags
    "(SP-1a)", "(SP-1b)", "(SP-1b spec §3)", "(SP-1c)", "(slice 3)" and "SP-C dev override".
  - Found by #625 (`apps/server` part e1), outside its files or not fixable in a comments-only
    change. Docs: `docs/developers/conventions-ui.md`'s recovery page section was fixed by
    #695; `docs/developers/conventions-data.md`'s
    `busy_timeout` receipt, which `recovery-lock.ts` now points at, should carry the date and Node
    version the deleted comment had (2026-09-24, Node v26.7.0). Tests and code, read not run unless
    stated: three `adopt.test.ts` titles say "before any mutation", but by then the primary has
    reserved an identity for the standby and added it to its membership list (the tests assert only
    on the mirror's own database); `adoptFromPrimary` (`adopt.ts`) spreads one adoption across
    several transactions with file writes between and no commented decision (CLAUDE.md §3), so a
    failure partway could leave a stamped mirror with no break-glass verifier; the membership list's
    eight-node cap (`MAX_NODES`, `packages/membership/src/verify.ts`) was enforced only by the
    verifier — #625's review measured a nine-node list minted without complaint (since A63, 2026-09-26,
    the mint refuses it with `membership.chart_too_large` and a join to a full chart is refused
    `mirror.membership_full`); the restore guard's repeated-destination check compares
    resolved path text, so two names reaching one file through a symlink may pass;
    `mirror-session.ts`'s keepalive keeps an `isNull(lastSeenAt)` arm on a `not null` column (dead,
    kept on purpose); `MirrorBundle.wireguardPublicKey` is set by no production caller and read by
    nothing outside tests; `recovery-race.test.ts`'s header has no "weaker than its name" hedge
    though CLAUDE.md describes the guard that way. Test titles #625 could not touch:
    "…even when the retired variable is set" (`backup-config.test.ts`, still sets a `postgres://`
    URL), "…without copying the obsolete media directory" (`backup-sweep.test.ts`), "(C2b Task 9)"
    (`mirror-bundle-fetch.test.ts`), "(swap S2)" (`mirror-bundle.test.ts`) and "as a file from before
    the field existed" (`recovery-state.test.ts`).
  - Found by #624 (`apps/server` part c1), outside its files or not fixable in a comments-only
    change. (Its two `node-entry.ts` comment findings — the outer catch's "has already gone to
    stdout" and "the one place the caught error's own words may appear" — were fixed by
    #695.) `docs/developers/workflow-guide.md`'s dev migration hint section still describes the PostgreSQL
    version (PostgreSQL 18, `23P01` on the list, `classifyBootFailure` dropping `22P02`, "the two
    share no SQLSTATE table", remedies that are opposites); the two lists are now SQLite result
    codes, `boot-failure.ts`'s codes lead to "retry or restart", and `dev-migration-hint.ts` still
    names that section as its receipt. Tests, not comments: `boot-failure.test.ts`'s "names every
    pinned result code as an unreachable database" cannot fail when a code is added, because it
    loops over the list itself (the review added 26 and the suite passed) —
    **Done (2026-09-27, lane A's A97, #782):** two new cases pin the list to `[14]` and read a junk
    `venue.db` (result code 26) as `unknown`; with 26 added to `UNREACHABLE_RESULT_CODES` both go
    red while the loop case stays green. Also still open, beside the workflow-guide finding above: two
    `health.test.ts` cases, "stays 200 when reconcile has failed runs but nothing parked" and "does
    not flip health for a failed-only run (parked stays 0)", feed a clean pass, so they check less
    than their titles say. Test titles #624 could not touch: "(T12b)" in
    `boot-pending-sweep.test.ts`, "(prove-by-deletion)" in `boot.reconcile.test.ts`, "(C2)",
    "(pre-merge review)", "(I1)" and "skipped a tenant" in `health.test.ts`, "the new guard" in
    `config.test.ts`.
  - Found by #623 (`apps/server` part b: working-order, tabs, tables), not fixable in a
    comments-only change. **Editing a held order that has already sent lines to the kitchen deletes
    their ticket items and never re-sends the new lines** — fixed by menus plan Task 7b, #696: an
    edit that changes or removes a sent line recalls or voids it with a kitchen notice and slip, and
    the changed line is sent again. Split-off checks may reach the same path (read, not run). Also: the
    walk-up concurrent double-pay case in `working-order.pay-and-dispatch.test.ts` replays through
    the settled branch and never reaches `payWorkingOrder`'s duplicate-key catch; nothing tests two
    `openTab` calls racing on one table or concurrent rounds landing on consecutive line numbers
    (the sequential versions are in `tabs.test.ts`); nothing checks that a location or status
    foreign-key refusal in `tables.ts` is not reported as a zone fault; `setTablePlacement`'s raw
    read is typed `boolean | null` where the engine returns 1/0/null (it only tests truthiness).
    The SQL `--` comments inside `listTablesWithState`'s template text still carry "measured
    2026-09-22", PostgreSQL's "LATERAL form" and aggregate-pair history and a "KDS-1 §3d" pointer.
    "A line with no course fires earliest", which #623 cut from `working-order.ts` because a line
    sent with `hold: true` is held whatever its course, is still in `apps/server/src/kitchen.ts:264`
    and four `packages/db/src/schema` files (`catalogue.ts`, `kitchen-courses.ts`,
    `ticket-items.ts`, `orders.ts`). Stale test titles: "lists the node's open orders" and "…not a
    raw 23505" in `working-order.test.ts`; "the 23505 backstop" (twice) and "(Task B1, …)" in
    `working-order.pay-and-dispatch.test.ts`; "an UNLOCKED read" in `tabs.test.ts`; "recordSale
    UNCHANGED" in `tabs.filing.test.ts`; many "(KDS-…)" and "(A1)"-style
    plan tags.
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
    `working-order.ts`'s `splitOffCheck`
    points at "line ~221". _(2026-09-30, Task 13: `splitOffCheck` is deleted, which closes this
    one.)_ Read only, not run: `WebhookDeps.nodeId` looks unread by `settleWebhook`;
    `receipt-order.ts` takes a `cfg` it never uses _(2026-09-30, C86: it now reads
    `cfg.locationId`, which closes this one)_; `me-api.ts`'s profile save logs
    `account_email.send_failed` with the caught error's message. The lock-ordering and deadlock
    cases for transfers, merges and split bills went with PostgreSQL and nothing replaced them (one
    write transaction per venue file is what serialises those writers now). Test titles #622 could
    not touch: "never a 22P02 → 500" and "never a 23503 → 500" in `print-api.printer-wiring.test.ts`
    (and 22P02 titles in `till-api.receipt.test.ts`, `till-api.tables.test.ts`, `till-api.test.ts`),
    "regardless of database date display settings" in `print-api.test.ts`, "(the R-D dedupe)" in
    `kitchen-print.test.ts`, "(SP-B4 rehome)" in `receipt-print.test.ts`, "(SP-A.2 §16.4)" and
    "SP-C:" in `sale-till-source.receipt.test.ts`, "old per-taxpayer path" and "path tenant" in
    `webhook.test.ts`, "never a 23514 500" in `me-api.test.ts`, "(FIX 2 cascade / FIX 4 split)" in
    `transfer-lines.test.ts`, "(the TS-4 shape)" in `move-merge.test.ts`, "TS-4's move guards" and
    "TS-2 status" in `split-bill.test.ts`.
  - Found by #621 (the rest of `apps/till`), not fixable in a comments-only change.
    **`apps/till/src/till-app.test.ts:7143` is an empty test**, `it("sends a walk-up line's options
    answer without any local price preview", () => {})`, which passes whatever the code does
    (`git blame`: 9fbdc8ba7, 2026-09-21). The review reported that "resets any leftover drill/active
    tab on login" still passes with login's own clearing line deleted, because logout clears the
    same state first (run in review, not re-run here). A question the prune moved here from a
    deleted `menu-filter.ts` comment: should the `no-meat`/`no-fish` lenses also hide a dish whose
    diet is still pending review, as `vegan`/`vegetarian` do? Today they hide only dishes known to
    contain the tag. Comments inside `till-app.ts`'s template text still carry design-doc pointers
    (`cash-drawer-authorization §5`, `device-enrolment §3.1`), and many `till-app.test.ts` titles carry plan and review labels
    ("(Finding 2)", "(P6)", "(FP-1)", "(KDS-1)", "Task 8", "(SP-B2.1)"), as do three
    `session-activity.test.ts` titles ("(C3)").
  - Found by #620 (`apps/server` part h1), not fixable in a comments-only change.
    **The demo seed does not refuse a production stamp** — DONE (#644): `demoSeedEnvironment` in
    `scripts/demo-seed/seed-sales.ts` refuses `production` with `deployment.demo_data_refused`
    before anything is written, and `devSetup` (`scripts/dev-setup.ts`) calls it first.
    `redact-secrets.ts` was written against the PostgreSQL connection-string parser, and `pg` is now
    installed only for `bench/pglite-throughput`; whether a credential-bearing URL can still reach
    the log is unchecked. `apps/server/vitest.config.ts`'s `coverage.exclude` lists `scripts/**`,
    which its `src/**/*.ts` include already leaves out (read only). The adoption-pending entry below
    still gives PostgreSQL's SQLSTATE 23503 on `nodes_location_id_locations_id_fk` as evidence; this
    engine reports `FOREIGN KEY constraint failed` and names no constraint. Test titles #620 could not touch: "never a 23514 500" in
    `schedule-api.test.ts`, "masks the password in a postgres URL" in `redact-secrets.test.ts`,
    "(design §3b(2))" in `set-table-status.test.ts`, "(owner decision 2026-08-02)" in
    `workforce-api.test.ts`, "(guard by deletion)" in `seed-sales.test.ts`.
  - Found by #618 (`apps/till` `src/api` + `src/state` + `src/i18n`), not fixable in a
    comments-only change. Test titles repeat claims the branch corrected:
    `apps/till/src/state/working-order.test.ts` "previews the total via priceBasket" (the preview
    sums line totals) and `apps/till/src/api/client.test.ts` "getExpoQueue GETs this node's
    cross-station pass queue" (the queue is venue-wide and includes placed orders); #623 fixed
    the server's own "open" comments.
  - Found by #617 (`apps/server` part f1), not fixable in a comments-only change.
    **`fetchPeerMembershipDocument` throws on a 200 whose body is JSON `null`** — DONE (#753): it
    now answers `null`, as it already did for a body that does not parse, so boot carries on
    (`apps/server/src/membership-reconcile.ts`; the case is in `membership-reconcile.test.ts`).
    **`fetchMirrorBundle` refuses a 200 JSON `null`** — DONE (A89):
    `apps/server/src/mirror-bundle-fetch.test.ts` sends that response through the real HTTP
    fetcher and checks for `mirror.bundle_fetch_failed`; the ordinary bundle case still passes.
    **`fetchMirrorBundle` checks the bundle's shape** — DONE (A94): real HTTP cases for a number,
    string, array, missing required field and wrong nested types failed before validation and pass
    with `mirror.bundle_fetch_failed` after it; the ordinary bundle case remains in the same suite.
    **The setup screen's advice for `mirror.bundle_fetch_failed` covers an unusable reply** — DONE
    (A103): it said only that the primary could not be reached or refused the login; it now also
    names a reply that could not be used (`ADOPT_ERROR_MESSAGES` in `apps/setup/src/setup-app.ts`).
    The pinning row in `apps/setup/src/setup-app.test.ts` failed on the old wording and passes on
    the new. The code, its 502 and the server's refusal are unchanged, so a primary that refuses
    for another reason (a full membership, for one) still shows this advice rather than its own
    reason — item (vi) of **Still open after A63** in the #657 item above.
    **Still open** (read, not run): the boot-time fetch is given only the URL (item (ii) of **Still
    open after A63** in the #657 item above), and boot never reads the `superseded` that
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
    Test titles #617 could not touch: "(real Postgres)" five times and "(SP-A.2 §16, device-profile
    §5)" in `device-session.test.ts`; "since Task 7" and "this tenant's devices" in
    `device-api.test.ts`; "never a raw devices_pkey 23505" in `join-requests.test.ts`; "(R1
    behaviour preserved)" in `membership-mint.test.ts`.
  - Found by #616 (`apps/till/src/widgets`), not fixable in a comments-only change. Test titles
    repeat claims the branch corrected: `apps/till/src/screens/till-allergen-screen.test.ts`
    "(escape/backdrop)" — `wt-dialog` closes on Escape and, measured in Playwright's Chromium 153,
    not on a backdrop click — and `apps/server/src/working-order.test.ts` "lists the node's open
    orders" (the list is venue-wide); `station-queue.test.ts` "(nothing to release)" is false for a
    held line with no course, and several `station-queue`, `tender-pay` and `modifier-picker` test
    titles carry task numbers. `css` comments in `apps/till/src/widgets/station-queue.ts` and
    `screens/till-expo-screen.ts` still call the courseless group "auto-fired" (#623 fixed the server's copy). `apps/till/README.md` says the held list is
    shared across the registers "on a node". Read, not run: a courseless section the server held
    shows its lines greyed with no fire button (`#fireAction` in `station-queue.ts`, from #131);
    `GET /api/till` never sends `stripe_on_device`, so the offline-consent toggle cannot appear;
    `ReaderOption.online` is never set outside tests; `card-grid.ts` passes a
    `.canExitToCounter=${false}` that `embedded` already makes irrelevant; the tab shell and the
    supervisor dialog emit events not named `wt-*` (CLAUDE.md §3; not checked whether the rule
    reaches till widgets).
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
    and `till-app.test.ts` (#625 deleted the matching comment in `promote-endpoint-e2e.test.ts`;
    #622 fixed `kitchen.ts` and `kitchen.test.ts`). The screens' `css` templates still carry
    task and spec numbers ("Task 7", "KDS-4 §3d"). Unchecked and kept: the allergen screen's legal
    citation (RD 126/2015 Art. 6.5.a.2°). Not restored because nothing confirms it: the table-order
    screen's `#lineGross` "same arithmetic the server files with" (the server does not call
    `grossOf`).
  - Found by #613 (`apps/server` `till-*`), outside its files or not fixable in a comments-only
    change. (The present-tense "a malformed id becomes a 500" copies are gone: #615, #622 and
    #623 removed them.) Two `v8 ignore start` comments in `till-sale.ts` (`finalizeCapture`,
    `finalizeSettle`) cite `provider.ts:66-83`; the checker compares tool comments character for
    character, so repointing them to `PaymentResult` in `packages/payments/src/provider.ts` is not
    a comments-only change. Test titles #613 could not touch: "lost-T2" in
    `till-sale-integrated.db.test.ts` (a captured card payment whose sale was never filed),
    "Tasks 5 & 6", "7b", "FP-1, Task 6", "FP-2, Task 4", "SP-A.2 cutover", "Task 12 cutover",
    "KDS-2/3", "(Copilot)" and "int4" in the `till-api*` and `till-config` suites, and 29 titles
    saying "opaque 500", five of them naming `22P02`.
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
    checked on the server (not traced). Like #607 and #610, #612 did not carry its 19 deleted
    proof-by-deletion notes into its commit message.
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
    the NUL; closing it needs a migration. Read only, not run: configuration import refuses an
    image whose default-language alt text is blank (`src/configuration-transfer.ts`, pinned by the
    `"alt"` case in its test), while an upload leaves alt text optional, so a venue holding such a
    photo may export a bundle it cannot import.
  - Found by #610 (`apps/dashboard/src/api` + `src/widgets`), not fixable in a comments-only
    change. `reorder.test.ts`'s test names say an out-of-range move "clamps"; `reorder()` ignores
    it. #616 fixed the till's copies of "a `wt-button` forwards only `disabled`/`aria-label`",
    and #618 the till's "a runtime shape error a view test catches".
    `fix/wt-button-aria-forwarding` (2026-09-27) fixed `language-chooser.ts`'s `aria-haspopup`
    and `aria-expanded`, which now reach the inner button, in `wt-button` itself.
  - Found by #607 (`apps/dashboard/src/screens`), outside the screens folder; #610 fixed the
    dashboard's copies and #614 the till's "never send a personId". Still open, read only, not run: the recipe screen's `#loadRecipe` guard
    compares product ids, so choosing A, then B, then A again lets the first A answer apply and turn
    Save back on while the second A load is still running.
  - Found by #604 (`packages/ui`), not fixable in a comments-only change. **A table with no shape
    is drawn as a rectangle and saved as round on its first edit**: `wt-table-token.ts` draws
    `shape-${t.shape ?? "rect"}`, while `wt-floor-canvas.ts` marks Round as pressed and sends
    `shape: t.shape ?? "round"` from `#placementOf`, so dragging, nudging or rotating a shapeless
    table changes it (read from the code, not run). `packages/ui/brand/README.md` still lists four
    generated icon files and says the generator "reproduced all four derived files"; it also writes
    `icon-192.png` and `icon-512.png` (#604 fixed the same list in `build-icons.mjs`).
    `packages/ui/vitest.config.ts` and `stryker.config.json` still exclude
    `src/tokens/token-test-helpers.ts`, which moved to `packages/ui-core` in #519 (the entry
    "`packages/ui/src/vitest-park-pointer.ts` is mutated and has no tests" below still names it
    there too). A reviewer believes the `demo/**` coverage exclusion matches nothing and that
    `**/ui-core/**` is there because `packages/ui-core` starts with `packages/ui` (CLAUDE.md §4's
    unanchored-include trap); neither was tested.
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
    `packages/media/drizzle/0001_image_references.sql` (about lines 22-24) says `workspace-cycles`
    refuses an "import"; that guard reads `package.json` files (a shipped migration, likely left).
    Two reasons #602 deleted and did not restore, for the owner to confirm: the hook bullet at the
    top of `scripts/check-signoff.test.mjs` no longer gives a reason (the shell-instead-of-`.mjs`
    decision `licence.yml` points at is still stated), and `scripts/english-only.test.ts`'s
    provisioning-test exemption lost its end condition ("until that test runs against fiscal-none",
    spec §6 step 5).
  - Found by #601 (`packages/reporting`). **Re-deriving a closed day does not reproduce its
    snapshot once a later void touches that day's sales** — DONE in #605 (owner decision
    2026-09-24: a void counts on the day it is made, not the day of the sale): the daily close's
    VAT, the period VAT summary and top sellers count a sale on its issue day and subtract it on
    the void's business day. The quarterly
    *modelo 303* keeps its old behaviour, pinned by a test in `vat-return.test.ts`, until the
    asesor answers `docs/compliance/asesor-questions.md` Q25 (which VAT period a later annulment
    lands in). No till screen or server route calls `recordVoid` yet. `stableStringify`
    (`src/daily-close-hash.ts`) throws on a `null`, and a key holding `undefined` hashes
    differently from the row the database stores (the column drops the key); its comment now
    states the precondition, and nothing enforces it for callers. Not fixable in a comments-only
    change: test titles still say "jsonb"
    (`verify-daily-close-chain.test.ts:70`), "tenant" (`top-sellers.test.ts:501`,
    `overdue-orders.test.ts:252`, `vat-summary.test.ts:233`, `vat-summary-period.test.ts:128`),
    "design §3" (`overdue-orders.test.ts:194`), "spec §12" (`top-sellers.test.ts:307`) and
    "DrizzleQueryError-style" (`record-daily-close.test.ts:342`, not checked). `toDr303Record`
    (`src/dr303.ts`) does not cross-check a monthly total against a quarterly period code such as
    "4T"; a test pins that and the one route that builds the file takes both from the same code,
    so it looks deliberate — worth the owner's eye because it is a tax file. The top-sellers
    fixtures give most lines no kitchen name, where CLAUDE.md §3 asks all three names to differ
    (top-sellers never reads that name). `record-daily-close.concurrency.test.ts:60` says "nothing
    but the write queue keeps the second out"; a reviewer, reading only, thinks the one-close-per-day
    unique constraint refuses it — not checked. `packages/core/src/errors.ts` names
    `scripts/errors-reachable.test.ts` without the hedge #601 gave reporting's (the guard matches
    text).
  - Found by #600 (the small packages), not fixable in a comments-only change. `apps/server` test
    titles still say an unscreened malformed id raises PostgreSQL's 22P02 or becomes an opaque 500,
    although ids are text columns now (#613 removed the comments in the `till-*` suites; the titles
    stay, e.g. `till-api.test.ts`'s two "never an opaque 22P02 500" cases; #615 removed
    `catalogue-api.test.ts`'s comment). Also found by reading only, not run: nothing the
    review could find copies `node_membership` from the primary to a standby, so a promoting
    standby may take `nextStandings`' fallback that appends it with an empty `contactUrl`
    (`packages/membership`), which `routableServers` then drops.
  - Found by #598 (`packages/core`), not fixable in a comments-only change. Test titles still
    carry claims the comments no longer make: `incidents.test.ts:463` says orphan raises de-dup
    "via NULLS NOT DISTINCT" (PostgreSQL wording); `record-void.test.ts:340` and
    `record-correction.test.ts:443` say an ordering "never leaks an authz error", which #598's
    review did not bear out (Codex ran both orders: with the lookup first, an unauthorised caller
    tells a missing sale from an existing one by the error); and `record-sale.test.ts:888`, `:964`
    and `:1029` carry history ("legacy path unchanged", "additive, no behaviour change").
    `record-sale.test.ts:282` ("groups two lines at the same VAT rate into one breakdown entry")
    asserts only the record's total, which is the input passed through, so it passes with no
    grouping; the fake backend stores the breakdown, so it could assert the merged entry —
    **Done (2026-09-27, lane A's A98, #784):** it now reads the sale's stored breakdown and expects the one
    entry (21%, base 8.00, tax 1.68), and a new case, two lines of 1.07 at 21%, expects tax 0.45 from
    the summed base where taxing each line gives 0.44; with `buildVatBreakdown` emitting one entry
    per line both go red, and with it summing each line's rounded tax only the new case does. Still
    open: no test reaches `settleSale`'s catch that turns a `sale_settlements` unique-key refusal
    into `sale.already_settled` (`packages/core/src/settle-sale.ts`); #598 measured the earlier check
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
    still carries "tenant" in its name, and `collect.sandbox.test.ts:32` still calls its database
    `pg`. Two `apps/server` test titles still quote PostgreSQL's 23514 as the failure a range check
    prevents ("400s an INVERTED date range (absence.invalid), never a 23514 500", in
    `me-api.test.ts` and `schedule-api.test.ts`; #620 deleted the comments that repeated it). The fake SumUp client leaves its one-shot switches for a lookup or
    a refund armed when a checkout before them is refused; no test combines the two.
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
    passed in at `card-provider.ts:188`). #570 and #597 made both packages' comments say so.
    Dropping the option is a code change.
  - Two concurrent passes over `listAttempting` (`packages/payments/src/store.ts`; its one caller is
    the SumUp provider's `resolvePending`) do not both succeed: #558's review measured
    `["fulfilled","payment.not_found"]`, so the second pass throws partway instead of skipping the
    rows the first resolved. The comment at `listAttempting` now says so.
  - The v8-ignore reason "never run by `vitest run`" on schema files' extra-config functions was
    measured false in identity (2026-09-24: `sessions.ts`'s function of the same kind, with no
    ignore, read 1 of 1 covered) and again by #562's review (making the foreign-key callback in
    `packages/fiscal-verifactu/src/schema/acks.ts` throw failed `schema-conformance.test.ts`;
    making a table's extra-config callback throw failed the file as it loaded). #585 took the
    reason out of `packages/db/src/schema` (`grep -rln "vitest run" packages/db/src/schema` prints
    nothing); the ignore pairs there stay. Four
    identity schema files and six in `packages/fiscal-verifactu/src/schema` keep the ignore pairs
    with no reason; removing a pair is a code change, for whoever next changes that package's code.
  - The `schema-conformance.test.ts` headers of `payments`, `workforce`, `media`
    and `workforce-es` (#611 fixed `venue-service`'s) say an unnamed unique constraint reaches the
    factory's refusal; drizzle-orm 0.45.2 names an unnamed `unique()` itself, so nothing reaches it
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
    on `resolveVenueDir`, "an empty directory is the RELATIVE `venue.db`"). #577 deleted it from
    `packages/credentials`, whose `bin.ts` opens through `openVenueDatabase` too, after measuring
    the same `ENOENT` there; the test title in `packages/credentials/src/bin.test.ts` that states
    the empty-folder behaviour still does (a title is code, so a pruning PR cannot rename it).
  - `packages/provisioning/README.md` also says only `ES-common` is implemented (a `GB-vat` run
    exits 0 in `cli.test.ts`), and repeats two reasons #561 deleted from the code's comments: that
    `provisioning.venue_conflict` means a concurrent run committed between plan and apply (the apply
    reads and writes inside one `withTransaction`, `venue-apply.ts`, and whether a second PROCESS can
    interleave was not measured) and that the entry point can only be checked through the built bundle (its prompt function
    runs straight from source). `docs/developers/conventions-data.md` cites
    `packages/provisioning/src/errors.ts` as spelling engine errors by `errcode`; it no longer
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
  - `apps/setup` code, found by #567. **Done (2026-09-28, lane A's A99, #786):** `#onGoto` in
    `setup-app.ts` now clears `fiscalTestError` and `cloudRecoveryError`, so neither of
    `fiscalTestError`'s two messages nor the cloud-recovery banner survives navigating away and back
    (the fiscal-test and cloud-recovery re-navigation cases in `setup-app.test.ts`). Still open:
    `#onGoto` keeps `fiscalTestStatus`, so a rejected or uncertain fiscal-test banner, and an
    accepted result, survive leaving that screen and coming back, even after the certificate changes
    (found by reading, not run; whether that is wanted is undecided); a cloud restore opens the
    provisioning screen (`#onCloudRestoreAction`) without `#clearProvisionOutcome()`, which the
    four other ways onto that screen call first, so an earlier attempt's message could show there
    (found by reading, not run); `AdoptOutcome`'s `breakGlassSecret` is typed as required, but a
    replayed adopt answers without it
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
    `packages/fiscal-verifactu/src/venue-fields.ts` (#602 removed it from
    `scripts/setup-wizard-fiscal-fields.test.ts`, and `scripts/module-seams.test.ts`'s header now
    states the two roots it checks).
    Prune with those.
  - `packages/store`, found by #568 and not changed: `isLocked` in `venue-lock.ts` reads `.errcode`
    without a null check, so a thrown `null` would raise a `TypeError` (the driver throws real
    errors). `CLAUDE.md` §3's read-routing rule says a read-only connection does not refuse an
    `ATTACH`; #568's probe (Node v26.7.0) found one naming a file that does not exist IS refused
    there (errcode 14, no file created), while an existing file and `:memory:` attach — narrow that
    sentence in a pull request, since a root `CLAUDE.md` change takes the normal flow.
    `packages/db/drizzle/0001_behavioural_triggers.sql` still points at `packages/store/src/index.ts`
    by line number, which the prune moved; it is a migration file, so it was left.
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
    run. `printers.test.ts` test names still carry the PostgreSQL codes "(CHECK 23514)" and
    "(UNIQUE 23505)", and the case named "a driver error that is NEITHER the UNIQUE NOR the CHECK
    propagates UNCHANGED" uses a value SQLite refuses by the `printers_transport_ck` CHECK.
    `escpos.ts`'s `qr()` is not what the receipt uses (it is built with `qrRaster`); the legal
    reason for error-correction level M is stated in `apps/server/src/qr-matrix.ts`.
  - Found by #585's review in files outside `packages/db/src/schema`, not changed there:
    comments and test names in about ten suites (layouts, printing, catalogue, core, `apps/server`;
    `git grep -l 23505 -- packages apps`) still cite the PostgreSQL code 23505. The shipped migration
    `packages/db/drizzle/0001_behavioural_triggers.sql:348` says `requireDevice` touches
    `last_seen_at` "on every authenticated request", which the review found too wide (the migration
    cannot be edited; #602 removed the same claim from `scripts/behavioural-triggers.test.ts`). Stale line pointer: the shipped
    migration's line 378 points at history deleted from `device-profiles.trigger.test.ts`.
    `packages/db/src/schema/columns.test.ts` still imports `../index.js` and `./drawer-opens.js`
    dynamically; the comment #585 deleted was the only note that this was meant to be temporary, so
    making them static imports is a small code follow-up.
  - Found by #589 (`packages/db` outside `src/schema`), not changed. The line pointers from other
    packages into `packages/db/src/schema` that #585 made wrong are all now removed (#653, #625,
    #602, #611, #613, #617, #622). In
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
  - The same false comments outside credentials, found by #577, are gone from code (#620, #658,
    #657, #601); two
    2026-07-26 specs still call the FNMT seal certificate's export unverified, which
    `docs/compliance/getting-to-production.md` §4 closed that day.
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
    commit message; `docs/developers/testing-guide.md` has no paragraph holding it (#597 and #611 cut
    `payments-sumup`'s and `venue-service`'s config copies to a pointer at CLAUDE.md §4).
  - Found by #588 (`packages/layouts`), not fixable in a comments-only change. Two test titles in
    `packages/layouts/src/canvas-store.db.test.ts` (lines 144 and 249) still quote PostgreSQL's
    error numbers 23001 and 23505; the stores match SQLite's. `packages/printing/src/errors.test.ts:5` says the
    error construction typechecks "ONLY because" of one import — #588's review measured the same
    claim false for printing and layouts. The shipped `packages/media/drizzle/0001_image_references.sql` says `canvas-store.ts`
    tells 787 from 1811; it reads only 1811 (`device-profile-store.ts` reads both). Both layouts database
    suites create a manager session in `beforeAll`, while `useVenueDb` empties every data table after
    each test by default (`resetPerTest`, `packages/db/src/testing/venue-db.ts`), so only a
    suite's first test can use that session; they pass today because only the first does.
  - Found by #581 (`packages/scheduler`). The nested `tx.transaction(...)` in `enqueueSuccessor`
    wraps one insert, which SQLite backs out by itself when refused, so it changes nothing today —
    #581's review replaced it with a bare insert and reported `store.test.ts` and
    `store.concurrency.test.ts` passing (24 tests); a re-run on 2026-09-24 needed two stubs that
    offered `insert` only inside `transaction` to offer it outside too before all 24 passed (22
    without). `insertClose` in `packages/reporting/src/record-daily-close.ts` is the same case,
    run 2026-09-24 (`docs/developers/conventions-data.md` has the probe); CLAUDE.md §3 and both
    sites now say so (#587). Whether to remove these two nested calls, or say why they stay, is open
    (a code change, not made). #587's review also found older comments still describing PostgreSQL's
    behaviour, left alone there: `packages/store/src/node-sqlite-adapter.test.ts:90` calls keeping
    the outer transaction usable "the whole point of the savepoint"; a test name in
    `packages/fiscal-verifactu/src/chain.test.ts:225` says a collision would "poison the whole
    transaction" (a test title, which a comments-only change cannot touch).
    The reason "v8 reports phantom uncovered branches" given for excluding
    barrel `index.ts` files from coverage did not hold in scheduler: with the exclusion removed,
    both barrels reported 0 branches at 100% and the totals did not move. So scheduler's two barrel
    excludes in `vitest.config.ts` can go (a config change, not made), and the same reason is still
    given in the configs of workforce, credentials, bookings, workforce-es, server-kit,
    dashboard-kit and fiscal-none (not re-measured there); `payments-sumup` keeps its
    `src/dashboard/index.ts` exclude with the reason deleted by #597, also not measured. `claimGap` uses an untargeted
    `.onConflictDoNothing()` on a table with two unique constraints (the `id` primary key and
    `scheduled_runs_key`); CLAUDE.md §3 asks for a named target there, though `id` is freshly
    generated (read, not run).
  - Found by #579 (`packages/shared`). **DONE 2026-09-24 (PR #583)** for the way
    in — see the P6 entry's DONE items: `decimalToCents` now rounds to cents first and then refuses
    an amount that, once rounded to cents, has more than twelve integer digits, so 99999999999999 cents, the bound
    `docs/developers/conventions-data.md` gives, is now the bound enforced. Still open: `centsToDecimal` itself has no digit
    bound, so a count past 99999999999999 cents that reaches it by another route is still turned
    into an amount without refusal. `docs/developers/conventions-data.md` (the "no column width left
    to measure" paragraph) has only the PostgreSQL raw-read table, not the
    SQLite one #579's commit message now carries. Comments saying drizzle wraps a failed query
    remain elsewhere — `git grep -l -i -E "drizzle wraps|wraps every failed" -- ':!docs'` listed
    files in `apps/server`, `packages/catalogue` (none left after #603), `db`, `identity`, `media`,
    `migrations`, `printing` and `store` on 2026-09-24, not each checked (see the `DrizzleQueryError` entry below).

- **The english-only guard blames the wrong lines when a comment contains a glob path — DONE
  (2026-09-27, lane A's A86; found 2026-09-21, task P6).** `packages/db/src/english-only.ts` now
  steps over strings, template literals (with their `${…}` parts) and regular expressions, so a
  comment opener inside any of them, or inside a `//` comment, opens nothing unless a `/` before it
  was misjudged. There is no parser (a package's TypeScript 7 has no `createSourceFile`), so whether
  a `/` opens a regular expression is still a guess from the code before it, and a wrong guess in
  either direction can hide a word in code on a later line. The wrong guesses that remain include,
  each run: a regular expression read as division after the `)` of `for await (…)` and after a word
  not on the scanner's keyword list, such as `export default /x/` — both hid a Spanish word in a
  template on the next line; and a division read as a regular expression after a variable spelled
  like a listed keyword (one called `of`) and after a `!` separated from its value by a space.
  (2026-09-27: the `for await (…)` and `export default` cases are handled since A95; see the entry
  below.) Experiment: the version before the branch and the branch's final version, compared over all 2577
  `.ts` files under `packages/` and `apps/` (excluding `node_modules` and `dist`) with the guard's
  own assembled word list (135 words, the base list plus every module's declared words, built as
  `scripts/english-only.test.ts` builds it), differ in one file only,
  `apps/server/src/boot.test.ts`: newly reported, all in code, `envios` at lines 2621, 2676 and
  2815, `registro` twice at 2684, and `estado` and `incidencia` at 2704 and 2707; no longer
  reported, all backtick-cited words in `//` comments, `envios` at 2615, 2620, 2665 and 2857, and
  `envios` and `entorno` at 2845. `apps/` is outside the guard's scope, so nothing newly fails.
  Twenty-two deletions of one scanner branch each, taken one at a time, each failed a case in
  `scripts/english-only.test.ts`, and that suite covers the module at 100% of statements, branches,
  functions and lines. The `CLAUDE.md` §3 warning is removed.

- **Six other TypeScript-scanning guards strip comments with the same slash-star pattern — DONE
  (2026-09-27, lane A's A95, **PR #781**; found 2026-09-27 reading for A86).** The comment reader A86 wrote now
  lives in `packages/shared/src/source-comments.ts`: `mapComments` hands each comment to a
  callback, and `blankComments` turns every character of each comment except its newlines into a
  space. `packages/db/src/english-only.ts` calls `mapComments`. The six guards —
  `packages/fiscal/src/no-regime-vocabulary.test.ts`,
  `packages/payments/src/no-provider-vocabulary.test.ts`,
  `packages/payments-stripe/src/tenant-scoping.test.ts`, `packages/shared/src/conventions.test.ts`,
  `scripts/dashboard-browser-purity.test.ts` and `scripts/guarded-teardowns.test.ts` — now use it:
  five blank comments, and the dashboard guard's type-only check removes them, as it did before.
  Each inherits the reader's weakness: whether a `/` opens a regular expression is still a guess,
  and the known wrong guesses are listed on `mapComments` and pinned in its suite. What was run:
  each guard gained a case with `/*` inside a `//` comment and inside a string, followed by code
  the guard must see; each case failed against the old strip, passed after the switch, and failed
  again when the old strip was put back. Over the exact files each guard scans (7 in
  `packages/fiscal`, 25 in `packages/payments`, 30 in `packages/payments-stripe`, `money-format.ts`,
  the five catalogue type files, and 1290 test files under `packages/` and `apps/`), the old and new
  strips give every file the same result. The unstripped source changes the result for the fiscal,
  payments, payments-stripe and `money-format.ts` checks, so the comparison there could see a
  difference; for the dashboard type files and the teardown scan it does not, so those two could
  not have shown one. Ignoring whitespace, the stripped text differs in 29 of the teardown scan's
  files, over 849 lines. On none of those lines does the new strip blank more than the old one; the
  first differing line of each file, and the one line the new strip keeps that starts like a
  comment, were each read and are inside a string, a regular expression or a template the old strip
  had taken for a comment. The two `scripts/` guards use the shared reader rather than the root's
  version 6 compiler API (`ts.createSourceFile`, which `scripts/comments-only.mjs` uses) so that all
  six guards read comments the same way. Review then found two misses, both fixed on the branch: a
  regular expression after `export default` or after `for await (…)` was read as a division, so a
  `/*` inside it hid the rest of the file (`default` is now a listed word, and `for await (` is
  treated like `for (`); and the teardown scan's brace matching ended a hook's block at a `}` inside
  a string, template or regular expression, which it now avoids by matching braces on
  `blankCommentsAndLiterals` text, where those contents are blanked too. Before those fixes, a
  from-scratch Stryker run scored the new module 95.87 and `packages/shared` 94.70 (break 90), and
  its 14 surviving mutants were read, not run, as unable to change the output. After them, an
  incremental run (reusing earlier results) scored the module 94.81 and the package 94.34, and the
  module's suite covers it at 100% of statements, branches, functions and lines. The root project's branch
  coverage fell from 98.16% to 97.59% (bar 95) because the reader's covered branches left its
  table; `english-only.ts` stays at 100%. Under Stryker, `packages/shared` now leaves
  `conventions.test.ts` out; why is in `docs/developers/ci-and-gates.md`.

- **The two SQL scanners named `stripSql` blank block comments before `--` comments — OPEN (split
  from A95).** `scripts/module-graph-honesty.test.ts` and
  `packages/sync-enrolment/src/migration-tables.ts` (product code, not a guard) blank `/*…*/` before
  `--` comments and `'…'` strings, the same ordering the six TypeScript guards had. Read, not run;
  whether any file they scan has a `/*` inside a `--` comment or a string is not measured. The
  TypeScript reader in `packages/shared/src/source-comments.ts` knows nothing of `--` comments, so
  it is not a drop-in fix. See also the OPEN bullet "Copies of the patterns A105 and C27
  replaced…", which holds the copy of `/--.*$/` in `scripts/module-graph-honesty.test.ts`: a fix to
  one touches the other's code.

- **Two root guards use the shared comment reader — DONE (A128, 2026-09-29); two
  comment-blind guards remain OPEN.** `scripts/spawn-timeout-budget.test.ts` and
  `scripts/write-path-tables.test.ts` now use `blankComments` from
  `packages/shared/src/source-comments.ts`. Five new cases failed before the switch and passed
  after it: a commented-out timeout bound after a returned regular expression; a block comment
  opening after code and continuing onto another line; writes after strings containing `/*` or
  `//`; and a write after a template line beginning with `/*`. Existing assertions are unchanged.
  Both guards still read text, with the scope and detection limits their headers describe; the
  shared reader still guesses whether a slash starts a regular expression.

  `scripts/errors-reachable.test.ts` and `scripts/module-seams.test.ts` remain out of A128's scope:
  they deliberately strip no comments, so an import written inside one counts. The next action is
  to add a failing commented-import case for each, then adopt the shared reader and update their
  stated limits and `docs/developers/testing-guide.md`. `scripts/column-vocabulary.test.ts` also
  has a `withoutComments`, left out on purpose: it runs only on the text between an import's
  braces, which its header says holds no string or template literal.

- **No guard holds a MODULE migration set to its declared schema — LANDED for four of them
  (**PR #491**).** `packages/db/src/testing/schema-conformance.ts` is a reusable suite factory that
  builds a database from a set's migrations and checks every table, column, key, index and check
  constraint against the drizzle declarations; the first call sites were core, `catalogue`,
  `payments`, `workforce` and `workforce-es`, and no drift was found in any of the four modules.
- **Every migration set that builds a table now has a call site — LANDED, one set per
  pull request:** `credentials` (**PR #497**), `scheduler` (**PR #499**), `identity` (**PR #501**),
  `bookings` (**PR #502**), `venue-service` (**PR #504**), `media` (**PR #505**) and
  `fiscal-verifactu` (**PR #507**); none found drift. `fiscal-none` needs none — its set builds
  nothing.
- **Comments and a test name in several packages give a `tenants` foreign key their sets no
  longer build — DONE (PR #516).** No set's SQL references `tenants`, so each site now says what an
  experiment showed about migration order; `packages/migrations/src/apply.ts`'s loop comment says
  sets apply in the order the caller passes, which boot derives from each module's declared
  `requires` (`orderedMigrationSets`), and gives media's triggers on core's `products` as the
  reason core must come first.

- **Nobody has timed `packages/db/src/testing/schema-conformance.ts` under a mutation run — OPEN
  (2026-09-23).** A mutation run changes one line of a source file at a time and reruns the tests,
  and `packages/db`'s run is split across ten parallel CI jobs by `scripts/mutation-shard.mjs`,
  which packs whole files into jobs by file size in bytes. That file is now the largest file the run
  mutates, about half as long again as `packages/db/src/schema/sales.ts` — recompute with
  `find packages/db/src -name '*.ts' ! -name '*.test.ts' -exec wc -lc {} + | sort -k2 -nr | head`
  rather than trusting a figure written here. `sales.ts` is the single entry in that script's
  `HEAVY_FILES`, the mechanism for splitting one file across several jobs, and the reason recorded
  beside it is that it "alone ran 186min while every other N=10 shard finished <=90min". **The new
  file's runtime was not measured and no `HEAVY_FILES` entry was added**, so whether it drags a job
  out the way `sales.ts` did is simply unknown — and size alone does not settle it, since what
  dominated `sales.ts` was that nearly the whole suite covers its mutants. Nothing on a pull request
  will say either: `packages/db`'s mutation score and its job durations belong to the weekly
  `mutation.yml` run (`CLAUDE.md` §2). **Next action:** read the job durations from the next weekly
  run, and add a `HEAVY_FILES` entry if that file's job is the long one.

- **The spawn-timeout guard reads `scripts/` alone — SUPERSEDED.** Its `packages/` and `apps/`
  half went with the real-PostgreSQL harness, which owned every long wait those two roots declared.
  **The rule holds under both roots and nothing checks it there**, which is
  stated in `CLAUDE.md` §4 and carried with its measurement in
  [testing-guide.md](developers/testing-guide.md). No work here: re-extending the scan is worth
  doing only if suites under those roots start declaring long waits again.

  **Still open over the half that remains, and the guard cannot close it:** it compares a bound
  against the LARGEST SINGLE wait, never the sum, so a case that waits several times can still
  outlast a bound that passes this check. Only reading catches that shape; if it recurs, the answer
  is probably a runtime check rather than a text reader.

- **Reuse the stub executables in the root guard suites — LANDED.** The follow-up from #407:
  `scripts/waitron-sh.test.mjs` and `scripts/main-tag-guard.test.mjs` build their stub bins once per
  file and vary each case through environment variables.

- **Fast local pre-push checks — LANDED #338.** The hook runs no package tests; CI owns the package
  suites and their coverage thresholds. **The consequence to watch:** CI's `changes` job is
  now the only thing that runs a package's tests, so a package a branch touched that CI did not select
  has been tested by nothing — read that job's `code`, `scope` and `packages` outputs before calling a
  branch green.

- **A merge could get no CI run at all, and nothing was red — LANDED #384.** Each push now runs in
  a concurrency group of its own, and the publish job asks `scripts/main-tag-guard.sh` before moving
  `:main`. **What is still open:**
  - **The publish path has now executed this code, once, and worked** (#385's merge, for the `move`
    answer). **What no run has exercised yet is `hold`** — an older run publishing after a newer
    one — which needs two merges close enough together to overlap and is not worth forcing.
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
  Playwright's "Frame was detached" during a whole-workspace run, and then passed both on its own
  (15 tests) and in a full dashboard coverage run (1,682 tests) with no code change. The original log
  and screenshot were kept; the cause is unexplained, so retain them again on the next sighting
  rather than re-running to green.
- **A seventh incident, with a cause rather than a hypothesis — FIXED on #469.**
  `packages/catalogue/src/extras.concurrency.test.ts`'s `until` helper polled with a 5s bound inside
  a 30s test timeout; raised to 15s to match its sibling
  `packages/catalogue/src/product-modifiers.concurrency.test.ts`.
- **A sixth, seen once (2026-09-20) on #469, a branch that touches no browser package at all.**
  `test-dashboard` failed `apps/dashboard/src/widgets/variant-form.test.ts` → "saves on Enter and
  cancels on Escape from a focused field", at `expect(cancel).toHaveBeenCalledTimes(1)`; the Enter half
  of the same test passed. **Established, by running:** the branch cannot be the cause and it did not
  reproduce locally at all. **NOT established:** the cause — two hypotheses were traced through the code
  but neither was run, so neither is a receipt (the likelier is a re-render provoked by the submit
  taking focus off the field between the back-to-back `{Enter}` and `{Escape}`). **Next action:** on
  the next sighting keep the job log and the screenshot, and fix it at the root — the first hypothesis
  is cheap to close by awaiting the component's `updateComplete` between the two key presses and
  checking focus is still in the field.
- **A fifth: `test-dashboard`'s browser a11y suite failed on a stray `:hover` state left over from a
  prior test in the same shared browser page — CONFIRMED and FIXED the same day in #350.**
  `test-helpers.ts` now parks the cursor off-page before every test via a `parkPointer` command (guard
  `apps/dashboard/src/widgets/pointer-reset.test.ts`). **Two pieces are still open.** The
  `dashboard-app.a11y.test.ts` heading-order sighting is a different rule with no colour evidence, so
  nothing here explains it — treat it as still unexplained. And `packages/ui` and `apps/till` have the
  same harness with no reset, with `packages/ui/src/components/wt-button.test.ts` ending a test
  hovering a button, so the same flake is waiting there.
- **A sixth: a CI shard exits 1 with every one of its tests passing (PR #414,
  `test-server (3)`, job 105632564989) — the exit-1 path CLOSED by the Vitest 4.1.11 upgrade
  (#437) and the trap deleted from `CLAUDE.md` §2 by #626; why the call went unanswered still open.** The shard printed
  `Tests 1313 passed (1313)` and one unhandled error: vitest's worker-to-main reporting call
  (`onTaskUpdate`) had timed out on birpc's 60-second default under vitest 3.2.7, failing the shard
  on its own. On Vitest 4.1.11 that timeout is gone. **What is still unexplained is why one worker's `onTaskUpdate` went
  unanswered:** the main process never went more than 22 seconds without printing (its longest gap,
  during startup) and the shard is not the heavy one, so starvation is a weaker suspect than it
  looks. On 4.1.11 an answer that never came would leave the shard waiting until the job's
  15-minute `timeout-minutes` cancelled it, rather than failing it when the run ends. Written up in [ci-and-gates.md](developers/ci-and-gates.md) rather than fixed
  (owner decision 2026-09-18); keep the job log on the next sighting — it is the cheapest evidence
  there is.
- **What the grants refuse ONE OPERATION AT A TIME is not guarded (2026-09-19).**
  `scripts/write-path-tables.test.ts` (LANDED #430, 2026-09-19) covers the tables request code may
  read and never write — those `scripts/write-path-tables.json` lists, `tenants`, `nodes`,
  `deployment`, `mirror_config` and `node_roles` — and nothing else. The
  slice-1 design asks for more: everything else should become a guard that reads the source, not a
  convention with nothing checking it. Many tables refuse an insert, an update or a delete only through
  the grant, with no trigger backing it, and TRUNCATE is wider still — no table grants it and only ten
  carry a trigger blocking it. The per-table matrix is read from
  `packages/fiscal-verifactu/src/privileges.expected.ts`, which goes when the grants do.

  **What #430's review left behind, none of it taken there.** The allowance list is a JSON file
  rather than the annotated TypeScript constant every sibling guard uses, because the plan named a
  file that outlives the grants; the justification for each entry is a doc comment beside the
  `JSON.parse` instead, which no test reads. A128 (2026-09-29) replaced the guard's comment
  reader with shared `blankComments`; its three known failures now have regression cases (see
  "Two root guards use the shared comment reader" above). The detector still only reads a builder
  call whose receiver looks like a database handle, so a write through a handle named something
  else is invisible; that was the price
  of not reporting `cache.delete(nodes)` on an ordinary `Set`.

  **Next action:** decide before the flip between three shapes. Grow the guard an operation column,
  which means encoding a privilege matrix as regexes. Give the tables that lack one a `reject_mutation`
  trigger, as the core baseline already does for eight tables in a single migration. Or brand the owner handle as its own type
  so `tsc` refuses the write instead of a text scan reporting it. Today the distinction is carried by
  a NAME and nothing else: `apps/server` declares `ownerDb: Database` at half a dozen call sites and
  hands it to write helpers in `packages/db` that take a plain `Database`, which is the same gap
  `CLAUDE.md` §3 names for the neighbouring `Database`/`Transaction` case. The third also closes
  the two weaknesses the new guard states about itself: it reads text, and it judges a file rather
  than a call chain.

- **Comments across the tree explained themselves in terms of PGlite, a container tier and choosing
  between targets — CLOSED by T2, with one class deliberately left.** The sweep dropped the
  target-choice framing wherever it presented a decision no code makes, and kept every sentence of the
  shape "under PGlite this was X, here it is Y", every dated measurement, and every comment where
  PGlite was the reference ORACLE that proved a SQLite expression equivalent.

- **Comments naming a PostgreSQL SQLSTATE as today's behaviour — OPEN (split out of the sweep above
  by T2, 2026-09-23).** `grep -rn "22P02\|22003\|23505\|23503\|42703\|42P01" apps/server/src`
  returns lines across many files, some already converted and many not, and the unconverted ones read
  in the present tense — a route comment saying a malformed id "`22P02`s → 500" when the column is
  plain `text` and a malformed id now matches no row. **Why T2 left it:** correcting one honestly
  means establishing, per ROUTE, what the unscreened path does now — often the same domain error the
  screen produces, which turns "prevents an opaque 500" into "belt and braces" — and that is a
  behavioural question, not a comment question. Several of them also sit in TEST TITLES, so the change
  is not comment-only. **Next action:** its own pass, route by route, with the un-screened path
  actually exercised rather than reasoned about.

- **Small renames and dead exports the sweep found and could not make — OPEN (T2, 2026-09-23; narrowed by A92).**
  A92 removed the unused `assertIdentifier` export and its own tests, and changed the seven
  old-engine test titles in `apps/server/src/device-session.test.ts` and
  `apps/server/src/management-api-passkey.test.ts`. Still open: the `.sqlite.` infix in
  `packages/db/src/constraint-target.sqlite.test.ts` and `migrate.sqlite.test.ts`;
  the `packages/media` title that says `bytea` (the importer still checks that format);
  and `pg.db` fixture handles across suites. Rename the fixture handles only after checking
  current users with `rg -l 'const pg = useVenueDb|pg\.db' packages apps -g '*.test.ts'`.
  `generatePassword` has a caller in `apps/server/src/break-glass.ts` and remains exported.
  The `provisioning.invalid_identifier` error registry entry remains; the A92 tree search
  (`rg -n provisioning.invalid_identifier packages apps`) found no product throw site. Retire it
  with the broader dead-code sweep, checking stored-code consumers first.

- **Two fiscal-package comments that need a probe, not a reword — DONE by #562.**
  #562 deleted the stale "out of scope" and shared-database prose from `chain.test.ts` and
  `drain.test.ts` and the `VerifactuBackend.drain` description; a grep of
  `write-path.e2e.test.ts` for the reseed wording finds none.

- **`bench/pglite-throughput` starts a container `pnpm reap` cannot see — OPEN (T2, 2026-09-23).**
  `bench/pglite-throughput/src/bench.ts` starts a real `postgres:18-alpine` through Testcontainers and
  stamps NO label, so an interrupted run of that rig leaks a container the reaper's label filter will
  never match; `bench/sqlite-failover` is the only rig that stamps `com.waitron.reapable`.
  `CLAUDE.md` said "only `bench/sqlite-failover` starts a container now", which was false. T2
  corrected it, and the rule there now states the asymmetry as a property and points at
  [ci-and-gates.md](developers/ci-and-gates.md), which carries the receipt naming each rig.
  Either stamp the label in that rig or accept
  cleaning it by hand — but the rig's schema is three storage decisions out of date anyway (its own
  entry above), so the two decisions belong together.

- **`replication-arc`'s isolation was reverted** (vitest `projects` are incompatible with `--shard`)
  — CLOSED: `apps/server/src/replication-arc.e2e.test.ts` was deleted with the PostgreSQL failover
  machinery; `projects` and `--shard` are as incompatible as they were.
- **Job-sharding levers:** `--shard` splits by FILE COUNT; bump `shard: [1..N]` and the denominator
  together with N at or below the file count; rebalance `LIGHT_A/B_PACKAGES` when one light shard
  dominates.
- **Dependency loop removed — LANDED #348.** `scripts/workspace-cycles.test.ts` fails if a loop
  returns. Its one review point is DONE (#790, 2026-09-28): a failure now prints one path round each loop,
  with the manifest field or fields behind every link, above the groups.
  - **DONE (C26, 2026-09-28):** a package that lists ITSELF as a dependency now fails the guard, and
    the failure prints it as `@waitron/x → @waitron/x (<field>)`. `pnpm install` does not refuse it:
    measured 2026-09-28 on pnpm 9.15.0 in a scratch workspace, a self-listing package installed with
    exit 0 and no warning, while the control (two packages listing each other) printed "There are
    cyclic workspace dependencies". Found by #790's review.
- **A throwaway script found six comments that described code that was no longer there, and it is
  not a guard yet** (written 2026-09-14 during the tenant-column removal). It flags a comment whose
  subject has gone from the lines beneath it; on that branch it found six real ones that a green
  suite and two review passes had all read past. It is not usable as it stands: 13 of its 19 hits
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
- **Detect cross-module edges inside trigger bodies — DONE (A90).**
  `scripts/module-graph-honesty.test.ts` now checks `FROM`, `JOIN`, `INSERT INTO`, `UPDATE` and
  `DELETE FROM` inside trigger bodies. The engine does not catch a missing target
  either: on `node:sqlite` (Node v26.7.0) a trigger whose body names a table that does not exist is
  created without complaint and fails only when it first fires. The guard pins media's
  `menu_publications` body edge and has a negative control for each statement shape. It remains a
  text scanner, not a SQL parser; its syntax limits are stated in `CLAUDE.md`.
- **Detect plain top-level migration writes across modules — DONE (A127).**
  `scripts/module-graph-honesty.test.ts` combines the existing foreign-key/trigger detector with
  a top-level write detector for plain `INSERT INTO`, `UPDATE` and `DELETE FROM`. The original
  detector's assertions stay intact; the combined scan has cross-module write fixtures and
  controls for comments, literals, trigger headers/bodies, reads and same-module writes.
  The text scanner still misses WITH-prefixed writes, REPLACE and INSERT/UPDATE OR variants,
  bracket-quoted identifiers and the SQL-stripping cases already listed above. No migration
  or descriptor changes accompany this guard change.
- **The topic files still carry PostgreSQL history — OPEN, owner's call (2026-09-23, from #496).**
  #496 took it out of `CLAUDE.md` and fixed every topic-file passage that contradicted the new
  `CLAUDE.md`, but did not sweep `docs/developers/conventions-data.md` or `testing-guide.md`, which
  held about 55 and 50 mentions of PostgreSQL or PGlite before it. Most are dated receipts, which is
  where history belongs. **Next action, if wanted:** read both files for any passage that states a
  PostgreSQL-era mechanism as CURRENT — a rule, a guard's behaviour, a command — and date or retire
  it; leave dated receipts alone.

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
at once, no queued jobs, for 250 ms: on `main` at `c15b1c9ce` it counted 195 pulls where it allows
at most 2; the loop from before #955 made one. How quickly a real scan returns on a box, for example
one with only a USB printer, has not been measured, so how often a real box repeats is not known.
**Next action:** test-first, keep the prompt delivery of a finished pass's devices but stop the
wake from launching the next pass early (for example, start a pass only when the pause since the
last one has passed), with the 250 ms fast-scan case as the regression test.

**Comments and test titles still cite sections of specs that were deleted — OPEN (2026-09-26).**
The docs prune that day deleted every spec and plan for built work (#711 and the direct docs commits
before it). Every pointer that named a deleted file was re-pointed at the pull request that built the
work, but a pointer that names only a SECTION ("spec §3.2", "design §3", "(till-reroute §3.6)") was
fixed only for the last 28 documents. Find the rest with
`git grep -nE "(spec|design|plan)[^)]{0,40}§[0-9]" -- apps packages scripts bench`. Some hits point
into specs that were kept (menus, service and billing, sales classification, the SQLite topology),
so check which document each one names before cutting it. Two were left on purpose:
`packages/db/drizzle/0004_variant_one_level.sql` ("spec §1.2, §15.7"), because a shipped migration
is not edited, and `packages/fiscal-verifactu/src/write-path.e2e.test.ts` ("(spec §2)"), which could
not be traced to a deleted document. **Next action:** fold into the comment-pruning sweeps: re-point
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

**The content-languages dialog keeps the languages it opened with — OPEN (found 2026-09-29,
reviewing C44's content-languages page, #829).** `apps/dashboard/src/widgets/content-languages.ts` copies
the settings it is given when the dialog opens and does not take a newer copy while it is open. A
throwaway browser test opened Edit with Spanish and English enabled, then delivered a live update
adding French (as a change saved from another tab would), then saved without touching anything: the
dialog submitted Spanish and English only, so the save removed French. The same test failed the
same way with the Products page's code from before C44 restored, so this is older than the move to
the Settings page; C44 left the dialog unchanged on purpose. **Next action:** decide what the open
dialog does when the saved languages change under it (take the new list if nothing was edited, or
warn and let the person reload), and fix it test-first in the widget.

**The till reports a failed list refresh after a SUCCESSFUL write as a failed write — DONE
(PR #641; comment fixes from the #621 review landed as #632).** The park, cash-sale, card-sale and
place handlers in `apps/till/src/till-app.ts` hand the refresh behind a successful write to
`#refreshAfterWrite`, which shows what succeeded, that the list could not refresh, and retries; only
the newest refresh of a list may show its rows or change its retry.

**Five till handlers still leave a failed list refresh unhandled, and one a11y file may not render
its screen — OPEN (found 2026-09-25, review of PR #641).**
- `#onLoggedIn` awaits `#refreshHeldOrders()` and then `#refreshStationQueue()` outside any `try`,
  and the `logged-in` listener in `render` calls it with `void`, so a failed held-list read at login
  is an unhandled promise rejection that also skips the queue, roster and floor loads (`git blame`:
  0131bb0b7, 2026-08-30, before this branch).
- `#onRetrieveOrder` and `#onDiscardOrder` await `#refreshHeldOrders()`, and `#onAdvanceTicketItem`
  and `#onMarkCollected` await `#refreshStationQueue()`, in `apps/till/src/till-app.ts`, each after
  its `try`/`catch` and outside it (`git blame`: 3fe6b9509, 2026-08-06, for the two held-list
  awaits; d76706ebb, 2026-08-22, for the two queue awaits; both before this branch). A failed
  refresh there is an unhandled promise rejection and the operator sees nothing: the test "a plain
  list refresh that fails starts no retry, leaves a countdown alone, and takes over a retry in
  flight" in `till-app.test.ts` suppresses the rejection the discard handler leaves uncaught.
  All four refresh on both paths, after a success and after a failure. Retrieve differs in that it
  writes nothing, so an "X succeeded, but…" message does not fit it.
- The two older cases in `apps/till/src/till-app.a11y.test.ts` titled "…on the composed counter
  screen…" (about lines 128 and 142) do not render the screen their titles name. Their `getTill`
  returns no `canvas`, and the till enters its shell only when it has one (`#inShell`,
  `apps/till/src/till-app.ts`), so in both themes they scan the lock screen: menus Task 9 (branch
  `feat/menus-till-home`) found it with a temporary assertion that the counter screen was present,
  which failed in both themes; not re-run on `main`. `git blame` dates the canvas-less stubs to
  2026-08-07 and the shell's canvas check to 2026-09-04. That branch added the missing
  `getContentLanguages` to the shared fake API.

**Next action:** decide whether discard, advance and mark-collected go through `#refreshAfterWrite`
with their own "X succeeded, but…" strings, and what login and retrieve show when their refresh
fails. Give both a11y cases' `getTill` a canvas and assert `till-counter-screen` exists before each
scan.

**The units screen puts a missing abbreviation's refusal beside the name — DONE (lane C's C5):
a unit save now answers `unit.translation_required` naming the `field` and the language, the
screen places it beside that language's input (or in the form's summary when the form does not
show that language), and the form's own check counts a missing key for its first language as
empty. The original
finding (found 2026-09-23, dashboard coverage, PR #538):** `apps/dashboard/src/screens/units-screen.ts` (about
line 190) shows every `content.translation_required` refusal beside the unit's NAME field. The server
checks the name and the abbreviation separately (`packages/catalogue/src/units.ts`) and raises the same
code, which carries only a language (`packages/catalogue/src/content-languages.ts`), so a refused
abbreviation is reported beside the name — the shape CLAUDE.md §3 describes for the product editor.
The server checks only the venue's default content language, read when the save arrives. Its
refusal reaches the screen when that default changes while the form is open, or before the live
refresh reaches the screen (the screen's language list is a live query, `watch("getContentLanguages")`
in `units-screen.ts`, about line 129): `apps/dashboard/src/widgets/unit-form.ts` rebuilds its draft
on a language change only when it has no names yet (about lines 59-62), and its check
`this.abbreviations[defaultLocale]?.trim() === ""` (about line 107) lets a missing abbreviation key
through. Found by reading.

**Dashboard leftovers from the coverage branch — OPEN (found 2026-09-23, PR #538).** Each from
reading unless marked run:
- Two dashboard client methods nothing called, `connectPaymentProvider` and `addReader` — DONE
  (C7, #842, 2026-09-29): removed, with the `AddReaderInput` type only `addReader` used. Run before
  removing: `grep -rn --include='*.ts' -E '\b(connectPaymentProvider|addReader)\b' apps packages`
  found no call to either dashboard method; the remaining `addReader` hits are a local helper in
  `apps/server/src/payments-api.test.ts` and the payment providers' own client methods and panel
  calls.
- `wt-dialog` re-sends the native dialog's `close` event as `wt-close`
  (`packages/ui/src/components/wt-dialog.ts`), and the native event arrives a task after the dialog
  closes — the same mechanism the catalogue screen's nested forms guard against (#741). So a dialog
  reopened within that task is shut again:
  `wt-dialog`'s own close handler (`onClose`, about lines 83-86) sets its `open` to false, which
  closes the native dialog, and then the screen's handler clears its state. `staff-screen.ts` and
  `purchases-screen.ts` have no guard; their tests wait out the late close rather than guard it
  (`staff-screen.test.ts`, `purchases-screen.test.ts`). `profile-screen.ts`'s flag
  (`#closingModal`) protects the screen's mode but, we believe (by reading, not tested), not the
  dialog itself. `apps/dashboard/src/widgets/allergen-picker.ts` avoids the problem by mounting a
  fresh dialog for each open (`keyed`, about lines 215-222). Seen once under coverage load in a test
  (run); we believe a person cannot reopen it that fast; not tested.
- The product editor's variant form (`apps/dashboard/src/widgets/variant-form.ts`) and the
  category form (`apps/dashboard/src/widgets/category-form.ts`, its `wt-close` handler at about
  lines 241-243, which checks only `busy` and `pickerOpen`) turn the dialog's late `wt-close` into
  a Cancel without first checking that the form is still open. So after a Cancel, once the screen
  has closed the form, the late close report probably sends `wt-cancel` a second time. For the
  variant form the product editor would act on it again. For the category form, on today's two
  callers it only re-sets a closed state: `categories-screen.ts` (about lines 968-971) sets
  `editorOpen = false` again, and `catalogue-screen.ts`'s `#cancelChild` ignores it because no
  form of that kind is open. Variant form found 2026-09-27 in review, category form 2026-09-29 in
  review; both by reading, not run. The variant form was left out of C68 because lane B's
  standalone-ordering task (B13, Task 13 of
  `docs/superpowers/plans/2026-09-26-service-ordering-and-billing.md`) changes the product editor.
  **DONE (C68, #863, 2026-09-29):** the Units, Options and Extras forms (`unit-form.ts`,
  `option-list-form.ts`, `extra-list-form.ts`) carry the same `!this.open` check
  `option-label-form.ts` does; a test in each cancels, closes the form, waits for the dialog's
  close report and counts one `wt-cancel`. A review run with the three checks removed counted two
  in each (2026-09-29).
  **DONE (C74, #878, 2026-09-29):** the category form's `wt-close` handler checks `this.open` too; its
  new test in `category-form.test.ts` counted two cancels without the check and one with it. The
  variant form stays OPEN, for lane B's B13 reason above. _(2026-09-30: B13 is done on
  `feat/service-standalone-ordering` and did not touch the variant form, so its fix no longer waits
  on B13.)_
  _2026-10-01: product-folders slice 1 retires the Categories-screen caller. The folder form is
  now mounted by `apps/dashboard/src/widgets/catalogue-browser.ts`; C74's close guard remains._
- Pressing Escape in the Unit form opened from the product editor on the Catalogue screen
  (`apps/dashboard/src/screens/catalogue-screen.ts` mounts it at about line 711) also closes the
  product editor behind it; in the same test the Unit form sent exactly one cancel. Measured
  2026-09-29 by a review seat with a browser test that opened a product, opened its Unit form,
  pressed Escape (`userEvent.keyboard("{Escape}")`) and found the product editor's `open` false
  (`expected false to be true`). The same test failed the same way with C68's changes reverted, so
  it predates C68. The same test did not fail for the Extras and Options forms. **DIAGNOSED (C74, #878,
  2026-09-29): reproduced when both dialogs were opened by synthetic events and the case ran first
  in its file; with the Unit form opened by a real click (`userEvent.click`) it did not reproduce,
  run first or in its place in the full file. The product editor was opened synthetically in every
  run. Not tried by hand.** The failure follows the ORDER of the cases, not the form: in the failing
  run one Escape fired `cancel` on BOTH dialogs, the form's and the product editor's; in a passing
  run only on the form's. With Extras, Options and Unit all opened synthetically in that order, only
  Extras, run first, closed both dialogs; the Unit case, run third, passed. With the Unit form
  opened by a synthetic `.click()` instead of a real click, the case fails run first (HeadlessChrome
  153, Vitest browser mode). A review seat re-ran both experiments on 2026-09-29 and they held. We
  believe Chromium grouped the two dialogs so one Escape closed both; why the order of the cases
  changes that was not established, and opening the form by a key press was not tried. Pinned by
  "closes only the unit form when Escape is pressed in it" in `catalogue-screen.test.ts`, which
  opens the form by a real click. No product code changed for this item (C74's product change is the
  category form's, in the entry above). Closed unless it is seen by hand.
- `login-screen.ts` checks an account link's purpose with `=== null`, so a reply with no purpose at
  all would pass; the server always sends one.
- My Schedule's load-failed banner (`loadFailed` in
  `apps/dashboard/src/screens/my-schedule-screen.ts`) is cleared only after a first load that fully
  succeeds (`#load`, the one `loadFailed = false`), and the screen offers no retry. So a list whose
  first read failed but arrives on a later live refresh shows its rows under a banner that never
  clears. Clearing the flag in each list's callback would bring back a stuck "Loading…" for a list
  that did fail; the fix is failure state per list, plus a retry as `menus-screen.ts` offers. Found
  2026-09-27 in review; by reading, not run. **DONE (C73, #876, 2026-09-29):** each read (the roster and
  the three lists) has its own query controller, because a controller's error callback does not say
  which read failed; a failure, including a later live refresh's, is recorded against its own read,
  and that read's next delivery clears it. Each list says under its own heading when it failed; the
  page's notice stays while any read is failed and now carries a Try again button that re-reads the
  roster and the lists. Run: the new cases in `my-schedule-screen.test.ts` failed before the change
  (no per-list notice, no retry). Unchanged by decision: while any read is failed, a list still
  being read says neither "loading" nor "none" (the existing sibling-failure cases pin that). When
  the roster's first read fails, the lists are read once the roster arrives, by a retry or a later
  live refresh (run red first: "reads the lists once the roster arrives on a later refresh after its
  first read failed").
- Guards no test can reach, left uncovered rather than deleted: the canvas editor's "no draft" and
  "no selected card" guards, several `?? []` and `?? null` fallbacks in the printers, payments,
  kitchen, backup, devices, printing-rules, profile, extra-list and option-list files, and a
  handful in `dashboard-app.ts` and `login-screen.ts`. **Next action:** delete them with a
  receipt each, or leave them as defensive code by decision.

**What the till shows the NEXT operator when the previous one's request answers late — CLOSED, no
change (owner decision 2026-09-23; PR #536).** The ticket belongs to the TILL, not to the operator
who started it, so a late result shown on that device after a change of operator is right; the
payment belongs to the table, so no payment is lost. The fix in #536 (a logged-out till stays
locked) stands.

**Till code that no test can reach, and small till defects — OPEN (found 2026-09-23, till
coverage, PR #536).** Left uncovered rather than deleted, each by reading its callers (none was
run without the code):

- `till-app.ts`: the handlers for `show-station`, `show-expo`, `show-schedule`, `open-allergens`,
  `close-allergens`, `new-sale`, `back-to-counter` and `back-to-floor` each keep an arm for when
  the shell is not active, which after a successful boot only the lock screen is, and nothing on the
  lock screen emits them; `#goToScreen` is reached only through one of those arms.
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
  floor tab rather than fire `show-floor`, so their titles overstate them. (#621 cut the handheld
  face-set block's comments that credited the app's face-set gate.)

**Next action:** delete the unreachable arms, and `#onShowFloor` with its `show-floor` listener (or
give it the lock check), with a receipt each; key the label lookup on own properties; rename or
rewrite that wake-lock test; and rename those two show-floor test titles.

**`quoteLiteral` quotes the way SQLite does — DONE (2026-09-27, #734; found 2026-09-23, identity's
coverage review, PR #526).** `packages/shared/src/sql-literal.ts` used to double the backslashes in
a value holding one and wrap it in PostgreSQL's `E'…'` form, which this engine refuses. It now
doubles the single quote only, and a backslash stays as itself. Left as it was, from #734's review:
`docs/developers/conventions-data.md`'s SQL-building section points at
`packages/provisioning/src/identifiers.ts` for `quoteLiteral`, which only re-exports it; the function
lives in `packages/shared/src/sql-literal.ts`.

**Finishing an account action refuses a person who has lost their login email — DONE (2026-09-27,
#773).**

**The dashboard calls a mistyped email-change code an invalid link — DONE (C61, #859, 2026-09-29).**
In the Profile screen's email mode, a refused code now reads `profile.email_code_refused` under the
code field. `apps/dashboard/src/i18n/codes.ts` keeps its link sentence for `account_action.invalid`,
because the login screen shows it for emailed links. The refused code was opened and screenshotted
in the screen's email mode at 390 and 1280 px wide, light and dark, in English and Spanish.

**The email-change form calls an empty code field an "authentication code" — OPEN (found by C61's
review, #859, 2026-09-29; read, not run).** In the Profile screen's email mode, leaving the email
confirmation code blank shows `profile.code_required` ("Enter your authentication code"), the
wording for the authenticator-app code (`apps/dashboard/src/screens/profile-screen.ts`, the
`setupCode` check in the form's own validation). `git blame` puts it at `a10e1cd28` (2026-09-10).
**Next action:** give email mode its own "Enter the code from your email" sentence in `en` and `es`,
test first, and LOOK at it in both themes and languages at 390 and 1280 px.

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

**On SQLite a read taken while a write transaction is open could see uncommitted rows — CLOSED
(task F1; fixed by PR #493).** `packages/store` now opens two connections per file, the single
writer and a `readOnly: true` reader; a statement goes to the reader only while one of the store's
own transaction bodies is running and the caller is outside it, so such a read sees committed rows
only. The rule is in `packages/store/src/connections.ts`.

**Three shapes the read connection does not cover — OPEN (stated 2026-09-23, task N3, PR #493).** A
transaction opened by RUNNING `begin` as an ordinary statement is not one the store is told about —
Drizzle's own migrator opens one that way — so a read concurrent with it still lands on the writer.
A write issued from outside a running body while one is open is re-run on the writer, where it joins
that transaction if it is still open and commits or rolls back with it, which is what one connection
did; in the moment after the queue's `commit` and before the body has ended, none is open and the
write commits by itself. Nothing refuses it. And `readOnly: true` refuses a write to the database FILE, not every write: measured
2026-09-23 on Node v26.7.0, `create temp table` SUCCEEDS on such a connection, so a temporary table
written from outside a running body would land on the reader and stay there — and the same holds
for an `ATTACH` of a file that exists (one of a missing file is refused, errcode 14 — measured by
#568) and for any connection-scoped pragma, because all three change a CONNECTION rather
than the file, so nothing refuses them and nothing routes them back. A temporary table and an
`ATTACH` have no site in this tree: searched 2026-09-23, a `create temp table`/`create temporary
table` grep over `packages`, `apps` and `scripts` matched nothing, and the same search for `ATTACH`
was recorded in `packages/store/src/index.ts` until #568 pruned it. A connection-scoped pragma is a different matter — those are
issued through routed handles already. The one that runs on a request path,
`pragma defer_foreign_keys = on` in `apps/server/src/configuration-transfer.ts`'s import, is issued
INSIDE the provisioning transaction's body, which is exactly where the routing sends a statement to
the writer; the others are test setup issued outside any body, where the reader would serve them if
a body happened to be running, and none of those suites runs one. **Next action:** none needed while
that holds; a temporary table, an attachment or a connection pragma issued from OUTSIDE a running
body has to be put on the writer deliberately, and a guard for that does not exist.

Two more things #493's review left behind rather than fixed. The routing cases are a weaker set than
their name suggests: with the routing replaced by a plain return of the write connection, some of
them pass whichever connection serves the read, and each of those says so at its own site — which is
why CLAUDE.md's rule carries the hedge instead of the phrase "each proven by deletion" it first
carried. And the case pinning the adapter half of the window fix lives in
`packages/store/src/index.test.ts`, not beside the file it reverts
(`packages/store/src/node-sqlite-adapter.ts`), so a reader looking for it in the adapter's own suite
will not find it.

**The media library still reads every matching image for search and name sorting, inside the venue
write lock — OPEN (found 2026-09-23, task F1's review wave).** The unsearched date sort now counts,
filters by label, orders and pages in SQL. With no label filter, it reads only the page's metadata.
Search still scores and pages in JavaScript, and name sorting still uses `Intl.Collator` for accented
names. A label filter resolves its canonical spelling by reading the labels column across images
before SQL filters the page, preserving Unicode case matching; `listImageLabels` and
`listImageTranslationGaps` still read all rows of their selected columns. The route
(`GET /management-api/images`) uses `withTransaction`, the venue's exclusive write lock, so these
remaining scans can delay a sale. **Next action:** decide how far to push search ranking into SQL;
measure a way to bound name sorting and label-spelling lookup without changing their results.

**`sale_voids` has no index on `voided_at` — DONE (lane A's A33, #663; found by #605).** Core
migration `0011_sale_voids_voided_at_idx` adds `sale_voids_voided_at_idx`, declared in
`packages/db/src/schema/sale-voids.ts`; the void count's plan is pinned by
`packages/reporting/src/counts.test.ts`.

**Cash handed back for a voided cash sale is recorded nowhere — OPEN (found 2026-09-24 by #605).**
A void writes no payment or refund row, so if staff give a customer cash back, the void's day shows
a drawer shortfall at cash-up. No till screen or server route calls `recordVoid` yet, so nothing
can do this today. **Owner decision 2026-09-25:** keep it here and decide it when the till's void
screen is designed.

**Every read route now takes the venue's exclusive write lock and issues a DELETE — OPEN (found
2026-09-23, task F1's review wave).** `withTransaction` (`packages/db/src/tenancy.ts`) runs its body
inside `withWriteLock` and then drains `change_log` unconditionally, which is a `delete … returning`.
There are 274 non-test call sites, plain GETs among them — box status, the unauthenticated
content-languages route, and two management reads. The drain-on-every-transaction predates the
storage switch; what is new is that it now runs under `begin immediate`. The single writer is the
engine's and is not removable. The unconditional DELETE on a read-only body is: `node:sqlite` exposes
a change counter. But it interacts with a documented behaviour — the drain deliberately collects the
rows an orphaned writer left — so this is a design decision, not a cleanup. **Next action:** decide
whether a read-only body should take the lock at all.

**Six hand-rolled "does this table exist?" probes, three copies of one SQL identifier validator, and
two cause-chain walkers — OPEN (found 2026-09-23, task F1's review wave).** All created by the flip,
each replacing a PostgreSQL one-liner. The table probe is spelled out in `packages/db`'s
`deployment.ts`, `node-membership.ts` and `mirror-config.ts`, in `packages/migrations`'
`schema-version.ts` and `journal-hashes.ts`, and generically (but privately) in
`packages/catalogue/src/categories.ts` as `tablePresent`. The identifier validator is in
`packages/db/src/testing/identifiers.ts`, `packages/db/src/change-feed.ts` and
`packages/store/src/append-only.ts` — the first two are in the SAME package. The cause-chain walk is
in `packages/shared/src/engine-failure.ts` and again in `packages/db/src/constraint-target.ts`, and
that one is a regression: `unique-violation.ts` used to import the shared walker and now uses the
local copy, leaving `firstCodeInCauseChain` with no product caller at all. **Next action:** export
one `tableExists` from `@waitron/db` and one validator from `@waitron/shared`; `packages/store`
depends on nothing today, and `@waitron/shared` depends on nothing either, so that edge closes no
loop. Task T2's business.

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

**The store's file layout is re-declared in two app files — DONE (2026-09-27, #757; found
2026-09-23, task F1's review wave).** `@waitron/store` exports `VENUE_FILE`, `NODE_FILE`,
`DATABASE_FILES`, `WAL_SUFFIX` and `SIDE_FILE_SUFFIXES`, which `apps/server/src/db-wipe.ts`,
`restore.ts`, `reset-request.ts`, `stream-host.ts` and `restore-stream.ts` read, and
`VENUE_HOLDER_FILE`, which `apps/server/src/db-wipe.test.ts` reads. The case "exports the name of
every file an open store with rows in both databases has created"
(`packages/store/src/index.test.ts`) opens a store, writes a row in each file and fails if the
folder holds a file the exported names and the lock's own files (`venue.lock`, its `-journal` while
held, `venue.holder.json`) do not account for; the new case in `apps/server/src/db-wipe.test.ts`
fails if a wipe leaves anything but those lock files. Dropping `NODE_FILE` from `DATABASE_FILES`, or
`-shm` from `SIDE_FILE_SUFFIXES`, turns the store's case red. Neither setup migrates, streams or
restores, so `migrations.lock` (`packages/migrations/src/apply.ts`), Litestream's
`.venue.db-litestream/` folder, and the restore's `venue.db.incoming` file and
`.venue.db-replaced-*` folder are outside what they check. Outside test files and `bench/`, these
still spell the names themselves: `apps/server/src/cloud-snapshot-archive.ts` (a staging file
outside the venue folder), `packages/stream/src/litestream.ts` and `packages/stream/src/restore.ts`
(`@waitron/stream` does not depend on the store), `deploy/waitron.sh` (a `node -e` snippet run in
the app image, whose `/app/node_modules` holds only sharp), the fixture scripts
`apps/server/scripts/cloud-backup-fixture.ts` and
`apps/server/scripts/cloud-recovery-client-fixture.ts`, and the store's own
`packages/store/src/connections.ts`, which builds the `-wal` path itself; `WAL_SUFFIX` lives in
`index.ts`, which imports `connections.ts`, so using it there means moving the names into a module
of their own.

**`RESTRICT_VIOLATION` and `TRIGGER_ABORT` are the same number — DONE (2026-09-27, #731; found in
task F1's review wave).** SQLite gives a foreign key's `ON DELETE RESTRICT` and every hand-written
`RAISE(ABORT)` the same result code, 1811. `restrictRefused` (`packages/db/src/constraint-target.ts`)
now matches the restrict direction by the engine's words, as `triggerRaised` does for a trigger, and
`packages/layouts/src/canvas-store.ts` and `device-profile-store.ts` use it; the device-profile store
matches `device_profile_form_factor_locked` by its own words. Left as they were, from #731's review:
`isRefusal` with `RESTRICT_VIOLATION` or `TRIGGER_ABORT` still reads the number alone and both stay
exported (the `CLAUDE.md` §3 rule, unguarded, is what stands against a new caller); and the four
near-identical word-matching checks in `constraint-target.ts` could share one private helper.

**`VenueMigrationOptions.appendOnlyTables` is optional while `MigrationSet.appendOnlyTables` is
required — DONE (2026-09-27, #737, lane C's C14; found 2026-09-23, task F1's review wave).**
`applyMigrations` reads the field as `?? []`, so a caller passing a plain options array gets a
migrated database with no append-only triggers and no error. The field stayed optional; instead
`scripts/apply-migrations-callers.test.ts` now holds that every non-test `applyMigrations` call
under `packages/` and `apps/` passes a `migrationOptionsFor(...)` result, directly or through a
`const` declared once in the file. There were twelve product callers at landing, all through
`migrationOptionsFor`. Left open, among others the guard's header lists: the guard never reads the
sets handed to `migrationOptionsFor`, so a subset, or hand-built sets with `appendOnlyTables: []`,
passes; and a path that migrates through `runMigrations` directly, without `applyMigrations`, is
unseen by it.

**A person row written from outside `packages/identity` still folds its key ASCII-only — OPEN
(found 2026-09-23, task F1's review wave).** SQLite's `lower()` folds ASCII and nothing else, so the
three unique indexes on `persons` stopped refusing two staff whose names differ only in the case of
an accented letter — José García beside JOSÉ GARCÍA, on a Spanish product. Measured with the ASCII
pair as the control, which WAS still refused. The repair stores a folded key in its own column
(`packages/identity/src/fold.ts`: trim, NFC, lower, NFC) and each index reads
`case when <folded> is null then lower(<raw>) else <folded> end`.

**The `case` is why this entry exists.** A bare index on the folded column alone would put every row
that did not carry one OUTSIDE the uniqueness check, which is worse than the defect, and most of
the writers outside `packages/identity` are test fixtures and demo seeds
(`grep -rln "insert(persons)\|update(persons)" --include='*.ts' apps packages | grep -v
"^packages/identity/"` finds 78 files, of which 9 are not `*.test.ts`, and 4 of those 9 are demo
scripts). **The two real paths that create a person are routed** —
`packages/provisioning/src/venue-apply.ts`'s admin insert and `apps/server/src/mirror-session.ts`
both call the exported `foldForUniqueness` now; `break-glass-command.ts` writes none of the three
columns. **What is left open:** every remaining writer is a fixture or a seed, each still folding
ASCII-only, and the column is still nullable, so nothing at the compiler stops a new writer
forgetting it. **Next action:** decide whether the column becomes mandatory — which breaks every
fixture at the compiler rather than silently — or whether a guard over the write sites is enough.

**The shard layout was measured against an engine that is gone — OPEN (found 2026-09-23, task F1's
review wave; the other two thirds of this entry closed with T2, #492).** The shard counts and their
sizing arguments were all measured against PGlite and none has been re-measured —
`mutation.yml`'s ten-shard matrix for `packages/db` most of all, whose comment says so explicitly.
Read the next weekly run's shard durations before treating any of them as current. **This is the part
T2 could not do**: no local command produces the numbers, so re-cutting the matrix has to wait for a
real weekly run.

Closed by T2: the two dead switches (`REQUIRE_DOCKER` and `TESTCONTAINERS_RYUK_DISABLED`) are out of
both workflows, and the dead dependency declarations are out of every manifest that did not import
them — the only two that did, and still do, are the bench rigs.

**An append-only trigger can be dropped, or quietly replaced, from the application's own database
handle — OPEN (found 2026-09-22, task F1).** PostgreSQL protected an append-only table with two
layers: the `reject_mutation()` trigger, and table ownership, which meant the connection a request
was served on could not drop that trigger. SQLite has no roles, so only the trigger is left — every
connection is the owner-equivalent, and a `DROP TRIGGER` on the application's own handle succeeds
(measured and recorded in `packages/db/src/immutability.test.ts`'s header). Data mutations are still
refused while the triggers are in place, so this is defence in depth rather than a live hole.

**The defence to build:** at boot, and then on a repeating check while the box runs, read
`sqlite_master` and refuse to trade if any append-only trigger that should be there is missing, or
its stored text is not the text `installAppendOnlyTriggers` writes
(`packages/store/src/append-only.ts`). The set to compare against is already known — the tables a
module declared with `appendOnly()`, carried set by set as `MigrationSet.appendOnlyTables`.

**Why re-installing the triggers is not that check**, measured on node v26.7.0 against
`node:sqlite`, 2026-09-22, with a control in each direction. The installer writes
`create trigger if not exists`, so a trigger that was simply DROPPED is put back by the next
migrating path — the control: after the re-run the update is refused again, `sales is
append-only`. A trigger dropped and re-created under the SAME NAME with a permissive body is not:
re-running the installer leaves the permissive text in `sqlite_master`, the update succeeds, and
the row reads back `tampered`. One detail for whoever writes the comparison — SQLite stores a
trigger with `IF NOT EXISTS` removed and `CREATE TRIGGER` upper-cased, so the stored text is not
byte-identical to the string the installer sent.

**The verifactu extraction's compliance-doc references — DONE.** The compliance provenance doc
now reads `@waitron/verifactu`; the library's own follow-ups live in the verifactu repo's own
backlog (`docs/backlog.md` there), not here.

**Waitron carries two QR encoders; consolidate on `qrcode-generator` — Small.** `apps/server` imports
`qrcode` (in `qr-matrix.ts`, `print-job-preview.ts`, `discovery-api.ts`) while `apps/till` uses
`qrcode-generator` (`qr.ts`). The server's three call sites use only `.create()` (the module matrix)
and `.toString({ type: "svg" })` — no PNG — so `qrcode`'s `pngjs` is never exercised and its `yargs`
(a full CLI-arg framework, pulled only because `qrcode` ships a CLI bin) is pure dead weight in the
dependency tree. `qrcode-generator` is isomorphic, **zero-dependency**, and covers both the matrix
(`getModuleCount()`/`isDark()`) and the SVG case (the till already renders SVG at level M with it).
Switch the three server sites over and drop `qrcode`. **The gate before landing:**
`print-job-preview.ts` reconstructs a QR from stored raw `latin1` bytes through `qrcode`'s byte-mode
segment API; `qrcode-generator` has a `'Byte'` mode, but this path must produce a byte-identical,
still-scannable QR — these are fiscal receipt QRs AEAT's own app must verify — so it needs a
render→decode check and a real scan, not just a green typecheck.

**A blank amount posted at the purchase-invoice routes was stored as a zero — FIXED #485.** Every
amount on both the POST and the PATCH now goes through `decimal()`, and `shared.invalid_decimal`
is a 400.

**A negative gross total is accepted and stored on the purchase-invoice routes — NOT A DEFECT, the
behaviour is intended (owner ruling 2026-09-21; task N1).** A negative gross total is a supplier
credit note, so accepting and storing one is correct and there is no `negative_total` refusal to
add. Whether a credit note should eventually be its own document type rather than a negative-total
purchase invoice is a separate design question and is not queued.
The dashboard form's `inRange(this.total, 0, Infinity)`
(`apps/dashboard/src/widgets/purchase-form.ts`) is the only thing refusing one, so a direct POST
walks past it. **One consequence the ruling creates, unqueued:** that form check refuses the very
document the ruling calls legitimate, so an operator cannot enter a supplier credit note through the
dashboard at all. Nobody has decided whether the form should be relaxed or the credit note should
become its own document type; this records the gap, it does not resolve it.

**A negative catalogue price was stored by the product writes and answered as a server fault by
the menu-item writes — FIXED #487 (2026-09-21, task N4).** A negative catalogue price is never
valid (owner ruling 2026-09-21); `apps/server/src/catalogue-api.ts` now screens the sign at the
request boundary on the four catalogue writes, refusing one as `management.request_invalid` naming
the field, so the product writes store nothing and the menu-item writes answer a 400 rather than a
500. Still open: `createProduct` and `updateProduct` (`packages/catalogue/src/operations.ts`)
still accept and store a negative when called directly — a seed, a script or a future caller — and
`products.unit_price` still carries no `>= 0` check. The SQLite flip has landed (#489), so this
is now actionable: decide whether the screen belongs in the ops or as a `products.unit_price >= 0`
check beside the sibling price checks the other catalogue tables carry. **One thing the flip
changes about the choice:** a check constraint is now the only thing that would refuse it at the
database — the column is an integer count of cents and takes silently what `numeric` used to
refuse — so the ops screen and the constraint are no longer two layers over the same refusal.

**Two price rules disagree about a value that is not negative — OPEN (found 2026-09-21, task N4).**
`isProductPrice` (`packages/catalogue/src/modifier-limits.ts:12`) allows at most two decimal places
and ten whole digits; `stringToCents` (the `decimal()` + `decimalToCents` pair) that the four
screened catalogue writes use allows any number of decimals and twelve whole digits, and ROUNDS the excess. Measured 2026-09-21
through the repository's own converters:

```text
1.999            decimal=1.999            cents=200              isProductPrice=false
12345678901.00   decimal=12345678901.00   cents=1234567890100    isProductPrice=false
-0.00            decimal=0.00             cents=0                isProductPrice=false
```

So `POST /management-api/products` with `unitPrice: "1.999"` stores `2.00` without saying so, while
the product-editor route refuses the same value with `product.invalid`; an eleven-digit price splits
the same way, and `-0.00` is accepted by one and refused by the other. N4 deliberately did not close
this: widening the four routes to `isProductPrice` would start refusing values that save today, which
is the regression shape #485 met (it tightened its own dashboard form in the same change so the two
matched). **Next action:** decide whether one rule
should govern every catalogue price, and if so which — and check each dashboard form against it
before changing the server, since a server stricter than its own form is the failure #485 met.

**The PGlite throughput bench no longer matches the shape it says it matches — OPEN (found
2026-09-21, task P6).** `bench/pglite-throughput/src/bench.ts:18` calls itself "a faithful SHAPE
match" of the write path, and its `create table` statements are three landed storage decisions
behind: `quantity numeric(12, 3)` and `total`/`unit_price`/`line_total numeric(12, 2)` where the
real columns are now whole-number counts (#475 and task P6), and a `tenant_id` column the real
schema no longer has (2026-09-14). Writing a `numeric` is not the same cost as writing a `bigint`,
so the numbers it produces are about a schema nothing runs. Nobody swept it because it is neither
`packages/` nor `apps/` — which is the path-set hedge `CLAUDE.md` §1 already carries, hit again.
Either bring the three decisions across and re-baseline, or change the sentence to say what it is.

**Left behind by the TypeScript 7 upgrade (#460, 2026-09-20).** Two follow-ups.

- **Collapse the two TypeScript entries back into one, once typescript-eslint supports version 7.**
  Packages run `tsc` at 7.0.2; the repository root resolves the name `typescript` to
  `npm:@typescript/typescript6` so typescript-eslint keeps the version 6 API it still reads, because
  version 7 does not ship the old JavaScript API, and typescript-eslint refuses the version outright
  in any case. typescript-eslint tracks the work in its issue 10940,
  and the message it prints today names version **7.1** as the target. When a typescript-eslint
  release supports it, the root entry goes back to a plain `^7` range and the alias disappears.
  `scripts/comments-only.mjs`, `scripts/apply-migrations-callers.test.ts` and
  `scripts/pinned-actions-column.test.ts` parse with the version 6 API (`ts.createSourceFile`), so they have to be ported, or the alias kept for them, before that
  move. The whole arrangement, with the receipts, is in
  [ci-and-gates.md](developers/ci-and-gates.md) → *Two TypeScript compilers are installed, and that
  is deliberate*.
- **`apps/server` → `apps/print-agent` is the first app-to-app workspace edge in the tree, and the
  review wanted it removed rather than declared.** TypeScript 7 rejected
  `apps/server/src/print-agent-e2e.test.ts` reaching into the print agent app's source by relative
  path (`TS6059`); #460 repaired it by declaring `@waitron/print-agent-app` as a test-only dependency
  and exporting `./tcp-probe.js`. The reviewer's alternative was to move `tcp-probe.ts` into
  `packages/print-agent`, where `NetworkTcpTransport` already lives and where nothing new would be
  declared. **That was consciously not taken**, for a reason worth re-reading before anyone revisits
  it: `tcp-probe.ts` belongs to a cohort of six device-discovery modules in the app
  (`ipp-probe.ts`, `bluetooth.ts`, `usb.ts`, `linux-devices.ts`, `network.ts`, `sweep.ts`), and
  moving one of the six would split the cohort and leave its siblings importing back across the
  boundary. Moving the WHOLE cohort is the change that would actually settle it, and that is a print
  agent layering decision, not a compiler bump. Until then no guard stops a second app-to-app edge:
  `scripts/workspace-cycles.test.ts` looks only for loops, and `eslint.config.js`'s
  `no-restricted-paths` zones name `packages/*` as targets, never `apps/*`.

**Left behind by gating `packages/db`'s mutation score (#472, 2026-09-20).** Two things the branch
measured and did not settle.

- **The gate never runs on a pull request, so thinning a `packages/db` test merges green.**
  `.github/workflows/mutation.yml` fires on a weekly schedule and on `workflow_dispatch`, and on
  nothing else; `mutation-db-aggregate` lives in it. A change that removes an assertion the score
  depended on therefore passes every required check and reddens the following Monday, days from the
  change that caused it. This is the shape `packages/ui` already had — #472 puts a second package in
  it rather than creating it. What would settle it is a decision about cost: the ten db shards took
  about 50 minutes of wall clock on run 35528428168, which is why nobody has put them on the merge
  path. Either accept the weekly lag and say so where a reader meets the gate, or find a cheaper
  per-pull-request signal.
- **DONE (lane C's A102, PR #787): the db mutation aggregate lists a file with no counted mutants
  as `not measured` with the statuses its mutants ended in, instead of `0.00%  0/0`.** On run
  35528428168 the three such files (`change-feed.ts`, `classification.ts`, `testing/venue-db.ts`)
  were all `Ignored` as static mutants (`ignoreStatic: true` in `packages/db/stryker.config.json`).

**Left behind by raising the `packages/ui` mutation score (#466, 2026-09-20).** Two edges the
branch found, checked, and consciously did not take.

- **DONE (lane C's A100): the two "disabling an open panel" tests in
  `packages/ui/src/components/wt-combobox.test.ts` dispatch their keys at the hidden search box,
  so each went red in all six runs with its `disabled` guard deleted, and check that the search
  box's key handler cancelled each key, so keys that stop reaching the component fail them.** The
  old entry's claim that once the panel is hidden "its keystrokes never reach the component at all"
  was wrong: a real keystroke pressed just after the panel closes reached the search box in 10 of
  12 tries (none after two animation frames), so the old tests failed only some runs without a
  guard.
- **`packages/ui/src/vitest-park-pointer.ts` is mutated and has no tests.** Four mutants, none
  covered. It is test-only plumbing the Vitest config loads — the same class as `src/test-helpers.ts`,
  `src/a11y-helpers.ts` and `src/tokens/token-test-helpers.ts`, which `packages/ui/stryker.config.json`
  already lists under `mutate` as exclusions. Adding a fourth exclusion is the consistent move and
  also shrinks the denominator the new `break: 90` is measured against, which is why #466 left it in
  and said so rather than quietly dropping it. Owner's call.

**Left behind by the Stryker upgrade (#447, 2026-09-19).** One open follow-up remains.

- **A Vitest 5 retry has to re-measure mutation — nothing about Stryker 10 settles it.** Vitest 5 was
  abandoned because Stryker 9.6.1 kills almost nothing under it: `packages/fiscal` scored 0.00% and
  `packages/shared` 8.14% (stryker-js#6210; fix PR #6214 was open and unreleased). Stryker 10.0.0's
  release notes mention neither issue, and nothing here was run under Vitest 5, so the question is
  untouched rather than resolved. A retry must also check whether #766's stored Dependabot ignore of
  `@vitest/browser-playwright` 5.x holds that package back, and clear it if so
  (`docs/developers/workflow-guide.md` → Dependabot pull requests).

**Left behind by the dependency refresh (#432, 2026-09-19).** Nineteen dependencies moved to their
latest minor or patch release; one loose end came with it.

- **Five manifests had their declared floor raised, and nobody has said whether that is the house
  style.** `hono` was declared `^4.6.0` and `^4.7.0`, `pg` `^8.13.0`, `playwright` `^1.49.0`,
  `@types/pg` `^8.11.0` and `@aws-sdk/client-s3` `^3.700.0`, in each case well below what was
  installed, while their siblings in the same files were declared at the installed version. #432
  raised them so that every package declares one identical range, which was the shape of all
  nineteen on 2026-09-19. No commit or doc explains why those floors were low, so this was a
  judgement, not a rule being followed. If low floors were deliberate, the revert is one line per
  manifest. Dependabot's npm updates (on `main` since #760, 2026-09-27) set no
  `versioning-strategy`, so its default applies — GitHub's options reference says that default
  raises the minimum version for apps and widens the range for libraries. Its first npm PR, #765
  (2026-09-27), widened no range: each of the 64 caret ranges it changed had its floor raised to
  the new version (`apps/dashboard`'s `vite` went from `^8.0.0` to `^8.3.1`), and the two exact
  pins it changed moved to the new exact version (`@aws-sdk/client-s3` in `apps/server`,
  `drizzle-orm` in `packages/store`). On that PR each manifest kept its own form — a caret range
  stayed a caret range, an exact pin stayed exact — so it did not restore #432's
  one-range-per-dependency shape where that had already lapsed: `@aws-sdk/client-s3` has been
  exact in `apps/server` since #582 (2026-09-24) and is a caret range in `packages/stream` and
  `bench/sqlite-failover`. Whether the floor should follow every bump is still undecided, and the
  answer goes in `versioning-strategy` in `.github/dependabot.yml`.

**Left behind by the esbuild upgrade (#439, 2026-09-19).** The four packages that build bundles
moved from esbuild 0.25.12 to 0.28.2. Two things it could not take with it:

- **One esbuild copy older than ours stays in the tree: `drizzle-kit`'s own range holds it.**
  `drizzle-kit` declares `^0.25.4` and resolves 0.25.12. It also pulls the deprecated
  `@esbuild-kit/esm-loader`, whose `@esbuild-kit/core-utils` declared esbuild `~0.18.20`, which
  resolved to **0.18.20**; since A107 (2026-09-28) a root `pnpm.overrides` entry moves that copy
  onto the same 0.25.12 (the receipts are in B9's Dependabot entry). An install that re-resolves
  the lockfile still warns that the `@esbuild-kit` packages are deprecated; a `--frozen-lockfile`
  install printed no such warning.
- **The bundles are checked by comparison, and the comparison is a thing you have to remember to
  do.** What established this upgrade was safe was building all twelve bundles on both versions and
  diffing the bytes — not the test suites, which run against TypeScript source and cannot see a
  bundler change. CI's `bundle-smoke` job runs five assertions over two of the twelve bundles, so it
  would catch a bundle that no longer boots, but not a bundle whose contents quietly changed shape.
  If a future bundler bump wants the same receipt, the method is: build, stash the twelve outputs,
  bump, rebuild, `cmp` each pair, and account for every difference class before accepting it.
  **That method does not survive a bundler REPLACEMENT**, which the vite 8 upgrade was: Rolldown and
  Rollup do not agree byte for byte on anything, so every pair differs and there is no difference
  class to account for. What replaced it there is below.

**Left behind by the Node types upgrade (#441, 2026-09-19).** Thirty-eight manifests moved from
`@types/node` `^24.0.0` to `^26.0.0`, matching the Node 26 the `.nvmrc` pins. Two things it leaves
open:

- **`apps/dashboard` now type-checks against two `@types/node` majors at once.** `@types/qrcode` is
  a declared devDependency there and in `apps/server`; its `index.d.ts` opens with a reference to
  the Node types, its own range is `"*"`, and the lockfile leaves it on **24.13.3** while everything
  else moved to 26.6.2. Nothing complains because `skipLibCheck` is on (`tsconfig.base.json:15`);
  with `--skipLibCheck false` that program reports a duplicate `NonSharedBuffer` identifier.
  `pnpm update --recursive --depth Infinity "@types/node"` does not collapse it — tried and
  reverted, it rewrote our own declarations to `"^26.6.2"` and left the transitive copy alone. The
  fix is a pnpm resolution override, which is a policy decision rather than a version bump, so it
  was left for the owner. (`@types/ssh2@1.15.5` also holds 18.19.130, but that one asks for
  `"^18.11.18"` and no 26 release satisfies it.)
- **The root `package.json` still says `"engines": { "node": ">=24" }` while `.nvmrc` says 26.** The
  two have disagreed since the commit that created both, so this is not new, but the types are now
  26's and the manifest still advertises 24 as a supported runtime. One line either way; it needs an
  owner call on whether Node 24 is still supported.

**Left behind by the Hono Node adapter upgrade (#444, 2026-09-19).** `apps/server` and
`apps/print-agent` moved from `@hono/node-server` 1.19.15 to 2.1.1. Three things it leaves open:

- **Only the request side of that adapter was compared between the two versions.** Three probes
  (mine and each reviewer's) wrote raw request lines to a socket against a real server on both
  versions and compared the path, the URL, one query value and the status line. Version 2 also
  changed response code — `Response` fast paths, null-body handling, a close handler for
  `Blob`/`ReadableStream` responses, and `Response.json()`/`Response.redirect()` — and nothing
  compared a response BODY or its headers across the two. The suites pass, so nothing is known to
  be broken; what is missing is the comparison. Re-running it now needs a scratch install of
  1.19.15, because the lockfile no longer carries it.
- **`apps/server/src/tls.ts`'s type guarantee is still untested.** It derives its options type from
  the installed package (`Parameters<typeof serve>[0]`) so that an incompatible reshape fails
  `tsc`. This upgrade did not exercise that: the type gained one optional key (`websocket`) and was
  otherwise identical across the two versions. The comment now says so rather than implying the
  promise has been tried.

**Left behind by the vite 8 upgrade (#450, 2026-09-19).** `apps/dashboard`, `apps/setup`, `apps/till` and
`packages/ui` moved from vite `^6.0.0` to `^8.0.0` (installed 8.3.0). Vite 8 swaps the bundler and
the transformer: Rolldown and Oxc in place of Rollup and esbuild. What replaced the byte-comparison
method above, since a bundler replacement makes it meaningless: build both, then run the SHIPPED
bundles and compare what they produce. Five things it leaves open:

- **A pull request that changes only front-end code gets no SPA bundle built anywhere in CI.**
  `bundle-smoke` builds `@waitron/credentials` and `@waitron/server`, which are esbuild bundles. The
  only thing that runs `vite build` is `deploy/Dockerfile`, which the `image` job runs — and on a
  pull request `image` is gated on an image input having changed — `deploy/`, or a file only
  image-smoke runs (`.github/workflows/ci.yml`, the `image` job's `if`). So `image` DOES build the
  SPAs on a pull request that touches `deploy/`, and on every
  main push; what it never does is OPEN one, so a bundle that builds and renders nothing passes
  there too. The plan behind #146 (its item R6) recorded
  this gap when `apps/setup` was written and called a cross-front-end build-smoke "a separate later
  cleanup". It then survived a whole bundler replacement, which is what earns it a line in
  `CLAUDE.md` §2 and a receipt in `docs/developers/ci-and-gates.md`.
- **The default browser floor rose, and a `browserslist` will not hold it.** Nothing sets a
  `build.target` and there is no `browserslist` anywhere, so the SPAs take vite's default. Resolved
  with `resolveConfig` in `apps/till` on each installed version: 6.4.3 gives
  `["es2020","edge88","firefox78","chrome87","safari14"]`, 8.3.0 gives
  `["chrome111","edge111","firefox114","safari16.4","ios16.4"]`. **A `browserslist` field would not
  fix this** — measured both ways against vite 8.3.0 with a scratch root: `browserslist:
  ["chrome 120"]` in `package.json` leaves the resolved target at the 8.3.0 default, while
  `build: { target: "chrome120" }` sets it. Those two are what was measured; no other way of pinning
  it was tried. **No BROWSER floor is stated anywhere in the repo.** The compile floors that do
  exist are for Node and are a different knob: `tsconfig.base.json`'s `"target": "ES2022"`, which
  constrains the syntax TypeScript emits, and `--target=node24` in `scripts/bundle-node.mjs`, which
  builds the Node bundles of `apps/server`, `apps/print-agent`, `packages/credentials` and
  `packages/provisioning`. Nothing is
  known to break, and the devices are bought new — but note that the hardware track's own stated
  floors do NOT establish that, and one of them cuts the other way: Screen Wake Lock's iOS Safari
  16.4 (`docs/superpowers/specs/2026-09-08-handheld-app-store-and-kiosk-findings.md` line 83) sits
  exactly ON the new floor rather than above it, and Web NFC's Chrome for Android 89
  (`docs/superpowers/specs/2026-09-18-handheld-and-till-hardware-decisions.md` line 79, citing
  `browser-compat-data` for `NDEFReader`) is twenty-two majors BELOW the new chrome111. A device
  that can do the NFC tap path is not thereby a device this bundle runs on. What is missing is
  anywhere that states a browser floor, so the next bump moves it again silently.
- **The manifests that declare vite declare `^8.0.0` while the lockfile installs 8.3.0**, which is the same
  low-floor shape they carried at `^6.0.0`. Whether low floors are house style is the open question
  the dependency refresh left above (#432 raised five of them to the installed version); this bump
  deliberately did not answer it, because changing the shape is the owner's call and not a version
  bump's. Decide it once, for all of them.
- **The browser-mode packages that declare no vite follow the others' by deduplication, not by a
  declaration.** `packages/adjustments`, `packages/bookings`, `packages/media`,
  `packages/payments-stripe`, `packages/payments-sumup` and `packages/venue-service` run tests in a
  browser but never invoke the `vite` binary, so they correctly declare no vite. They resolve 8.3.0
  because vitest declares vite as a REQUIRED peer spanning three majors
  (`^6.0.0 || ^7.0.0 || ^8.0.0`, and absent from `peerDependenciesMeta`), the manifests that do
  declare vite are the only thing choosing one in the tree, and pnpm deduped onto it. Nothing pins
  the packages without a declaration. If a future change ever puts a second vite in the tree, they
  could land on a different one silently.
- **A dependency-optimizer receipt taken on vite 6 was not re-measured.**
  `apps/dashboard/vitest.config.ts`, `apps/setup/vitest.config.ts`, `apps/till/vitest.config.ts` and
  `packages/ui/vitest.config.ts` each carry an `optimizeDeps.include` list. Only `apps/setup`'s
  comment still quotes Vite's warning — "Vite unexpectedly reloaded a test" — as the flake it
  fixes; the comment pruning cut the dashboard's and the till's to one line with no measured
  outcome (#612, #621), and `packages/ui`'s never recorded one. Vite 8 changes the optimizer underneath all four:
  its migration guide heads a section _"Dependency Optimizer Now Uses Rolldown"_ and says Rolldown
  "is now used for dependency optimization instead of esbuild"
  (`docs/guide/migration.md` on `vitejs/vite@main`, read 2026-09-19). Nobody re-checked that vite 8
  still emits that warning string, or that the `include` lists are still the fix. The suites are
  green either way; the risk is that the lists quietly become cargo and the quoted receipt goes
  stale.

**Left behind by the AEAT XML parser upgrade (fast-xml-parser 4 -> 5, 2026-09-20).** Version 5 no
longer decodes numeric character references: `&#38;` and the references for the other four
XML-reserved characters arrive as their own source text where 4.5.7 gave back the single character,
and a reference to a character XML 1.0 forbids (code points 0-8, 11, 12, 14-31, and the surrogate
range) is removed entirely where 4.5.7 left it as source text. Both arrived in 5.7.0. Named forms
(`&amp;` and the rest) still decode on both, and `escape.ts` writes nothing but named forms, so a
value we sent and AEAT echoed is unaffected.

The upgrade shipped WITHOUT compensating for it. Every parsed AEAT value that gets matched against
one of ours is a value WE minted and AEAT echoed: `RefExterna`, which is our
`registros_facturacion.id`, a UUID (`drain.ts` in `persistResponse`, and `reconcile.ts` building its
authority map); `NumSerieFactura`, which we only ever emit from the `A-Za-z0-9/_.-` charset
`NUMSERIE_PATTERN` in `@waitron/verifactu` holds the outgoing record to; and
`Huella`, which is hex. No character in any of those sets is ever entity-encoded. Everything else
parsed is either compared against a constant (the status and error-code enums) or stored and
displayed and compared against nothing, such as `DescripcionErrorRegistro` → `envios.mensaje_error`.

**State the limit of that receipt honestly: nothing validates a value on the way back IN.**
`NUMSERIE_PATTERN` runs in `validate()`, on the record `chain.ts` has just built, before submission
— never on a parsed response. So the argument is that AEAT echoes what we sent and we send nothing
encodable, which is an assumption about AEAT's serialiser, not an invariant this code enforces. If
that assumption is ever in doubt, validating the parsed values on arrival is the cheap fix, not a
parser option.

`htmlEntities: true` was tried as the fix and reverted. It is wider than XML: it decodes 35 named
entities XML does not define, and it turns `&nbsp;` and `&#160;` into U+00A0 where 4.5.7 gave
U+0020 — a difference invisible in any report. If exact XML semantics are ever wanted here, version
5 has an `entityDecoder` hook, which is bespoke code on a fiscal path and a decision rather than a
bump.

**Left behind by the till QR library upgrade (qrcode-generator 1 -> 2, 2026-09-20).** `apps/till`
moved from `^1.4.4` (installed 1.5.2) to `^2.0.4`. The drawing code did not change; what version 2
adds is an `exports` map and an ESM build of the same code. Two things it leaves open:

- **The pin protects the screen path; the printed path has a stronger check of its own.** `qrSvg`
  has one product call site, `apps/till/src/screens/till-ticket-view.ts`, the ticket the till shows
  on screen. The PRINTED receipt's QR comes from a different library (`qrcode`, via
  `apps/server/src/qr-matrix.ts`), and its test reads the error-correction level back out of the
  module matrix's format-information bits (`formatInfoLevel` in `apps/server/src/qr-matrix.test.ts`,
  ISO/IEC 18004 section 7.9) with negative controls for L, Q and H — so it asserts what art. 21.1
  actually mandates, where the till's new digest asserts only that nothing moved. Giving the till
  the same reader is more than moving the helper somewhere both apps can reach, which is already a
  module-boundary decision and not a dependency bump: `formatInfoLevel` takes a boolean matrix and
  `qrSvg` returns a string, never exposing the library's `qr` object, so the till would need a
  matrix accessor as well. It would make a failure name what changed instead of only that something
  did.
- **Read it as a self-baselined pin, which is weaker than the pins already here.** Pinned output is
  not new — `conformance.test.ts` in `@waitron/verifactu` pins a SHA-256 against a literal, and
  `xml/serialize.test.ts` pins whole XML documents. But `conformance.test.ts`'s expected values are
  AEAT's own published huella vectors (`@waitron/verifactu`'s huella test vectors, "Huella spec v0.1.2"),
  so that pin compares the code against an authority. This one compares the code against itself on
  the day it was written. (What `serialize.test.ts` compares against was not checked here.) There is also no
  `toMatchSnapshot`/`toMatchFileSnapshot`/`__snapshots__` anywhere in the repository, so a byte pin
  had no house form to follow and a SHA-256 was chosen over a 27,495-character literal. A file
  snapshot would fail with a readable diff instead of two hex strings; whether this repo wants
  snapshot files at all is an owner decision that this one test should not settle on its own.

The existing item below — two QR libraries coexisting, `qrcode` in `apps/server` and
`qrcode-generator` in `apps/till` — is unchanged by this, except that the till's side is now on a
version that ships ESM and an exports map.

**Left behind by the passkey library upgrade (#453, 2026-09-19).** `packages/identity`, `apps/server`
and `apps/dashboard` moved from `@simplewebauthn/server` 13.3.2 / `@simplewebauthn/browser` 13.3.0 to
14.0.2 / 14.0.0. Four things it leaves open:

- **Whether the vulnerability the upgrade fixes is reachable in this product is open, and nobody
  established it either way.** Version 14.0.2's release note says it fixes "a CVSS v3 Moderate (5.4) security
  vulnerability" and describes it as "Revamped certificate revocation logic to only cryptographically
  verify and process CRLs from certificates that chained back to an RP-chosen trust anchor"
  (GHSA-2g3p-m8c9-hhwh). That advisory is repository-level, not in GitHub's global database — the
  global API answers 404 for the id, with the control that it resolves other ids fine — so the release
  note is the only source. The fixed path is certificate-revocation processing inside attestation
  verification. We ask for `attestation: "none"` (measured by running `generateRegistrationOptions`
  with the repo's own arguments) and never call `MetadataService` (nothing under
  `packages/identity/src` or `apps/server/src` names it) — but neither of those closes the question,
  because the attestation FORMAT is chosen by the RESPONSE, not by the options: the verifier
  dispatches on the `fmt` inside the client-supplied attestation object, and the `apple` and
  `android-key` formats carry the library's own built-in trust anchors, which is what makes
  `validateCertificatePath` — the only caller of `isCertRevoked` — do work. So reachability is OPEN,
  and the cheap evidence leans towards reachable rather than away. Nobody has established it either
  way. The algorithm-policy fix below was worth having on its own.
- **Three more manifests declare `^14.0.0`.** Two of them (`packages/identity`, `apps/server`) sit two
  patch releases below the installed 14.0.2; `apps/dashboard`'s floor is exactly the installed 14.0.0.
  That is the same open question #432 raised and #450 restated: whether low floors are house style. It
  is one decision for every manifest, not one per bump.
- **The version-14 browser helpers are unused.** `sendSignal()`, `browserSupportsPasskeys()` and
  `getBrowserCapabilities()` are new in 14.0.0 and nothing in the tree calls them. `sendSignal()`
  wraps the three signal methods, which the dashboard calls directly since C101 (its entry says
  why). `browserSupportsPasskeys()` is adjacent to something the dashboard already does: the
  login screen gates on `browserSupportsWebAuthnAutofill()`, and whether `browserSupportsPasskeys()`
  would improve that gate has not been assessed.
- **`verifyAuthenticationResponse` has no algorithm list to pin.** The registration ceremony now
  states its accepted algorithms on both halves. The assertion ceremony verifies against the stored
  public key and takes no such parameter (its argument list, `verifyAuthenticationResponse.js:28`),
  so there is nothing equivalent to pin there. Recorded because the asymmetry looks like an
  oversight and is not.

**Correctness:**

1. **Four order paths read `working_orders` by id alone, with nothing narrowing them to the caller's
   location.** The TENANT half of this item is retired — there is no tenant column, so a by-id read
   has no tenant clause to be missing (`CLAUDE.md` §3) — but the location half is untouched and is
   NOT covered by item 3, which names a different set of verbs. All four are in
   `apps/server/src/working-order.ts` and were read on 2026-09-16 rather than inferred:
   `markCollected` takes a `TillConfig` and discards it (`void cfg;`), then selects and updates on
   `eq(workingOrders.id, id)`; `cancelPlacedOrder` selects and updates the same way and uses `cfg`
   only to stamp the amendment's till and node; `readLockedLines` takes no `cfg` at all, nor does
   `priceStoredOrder`, which calls it to rebuild a filed ticket, nor `priceStoredOrderForIssuance`,
   which the filing sites in `till-sale.ts` and `working-order.ts` call. Named by function rather than by line, because the line numbers
   this item used to carry went stale when the file moved.
2. **A concurrent-corrective race in `settleSale` is untranslated** — a raw `P0001` from the coverage
   trigger with no `sale.*` code. Give the trigger a SQLSTATE and translate it when reachable.
3. **Location-scope the by-id verb family together** (`getHeldOrder`/`updateHeldOrder`/
   `abandonHeldOrder`, `updateTable`/`deactivateTable`/`openTab`) when multi-location lands —
   together with the four paths in item 1, which are the same problem in the same file.
4. **Nothing stops two queries being started at once on one transaction.** The rule and its receipt
   are in `docs/developers/conventions-data.md` under "Multi-table writes share ONE transaction"; no
   test or lint rule enforces it. A guard could fail a test whenever a query is issued on a
   transaction while another is still running. A search of non-test `apps/server/src` and
   `packages/*/src` on 2026-09-14, after `computeDailyClose` was made sequential, found no remaining
   `Promise.all` over one transaction: the rest read or delete files, call HTTP or storage
   services, close pools, or query through a pool.

**Names left behind by the tenant-column removal (LANDED #378, 2026-09-16):**

- **Thirteen index and key names still read `tenant`, and the columns they name are gone.** Read
  off a database built by applying every migration set in manifest order (2026-09-16), with each
  name's real columns beside it: `canvases_tenant_name_key` `(name)`,
  `device_profiles_tenant_name_key` `(name)`, `print_agents_tenant_node_key` `(node_id)`,
  `purchase_invoices_tenant_received_idx` `(received_on)`, `sales_tenant_issued_idx` `(issued_at)`,
  `table_service_statuses_tenant_label_key` `(label)`, `tills_tenant_location_name_key`
  `(location_id, name)`, `working_orders_tenant_status_idx` `(status)`,
  `registros_tenant_node_secuencia_uq` `(node_id, secuencia)`, and four in identity:
  `persons_tenant_email_uq`, `persons_tenant_live_display_name_uq` and
  `persons_tenant_pending_email_uq` (all three over expressions) and
  `persons_tenant_google_subject_uq` `(google_subject)`. (The `tenants*`, `tenant_themes*`,
  `tenant_receipts*` and `tenant_credentials*` names are correct — those tables really are about the
  taxpayer — and stay.) This is its own slice, not a tidy-up: THREE of the four `persons_*` names
  are matched BY NAME in production error translation — `persons_tenant_email_uq`
  (`packages/identity/src/staff.ts` and `account-action.ts`), `persons_tenant_live_display_name_uq`
  and `persons_tenant_pending_email_uq` (`staff.ts`) — so renaming them changes behaviour and wants
  its own failing tests first. Only `persons_tenant_google_subject_uq` is declared and never matched.
- **Three shipped error codes were deleted rather than deprecated — SETTLED 2026-09-26.**
  `stripe.tenant_mismatch`, `sumup.tenant_mismatch` and `payment.webhook_tenant_mismatch` went when
  the condition they described — two taxpayers disagreeing — stopped being reachable. The owner ruled
  that before a venue is live a code may be renamed or deleted freely (CLAUDE.md §3), so the deletion
  stands. Nothing to do.
- **Unused error codes retired by A77.** The 2026-09-27 source search found 25 codes with no
  literal production raise site outside their registry and status entries. Their registry entries,
  status mappings, English and Spanish wording, and code-specific tests were removed together.
  `media.unsupported_type` stayed: `packages/catalogue/src/media.ts` still raises it.
  `sale.number_reused` also stays pending the decision below.
- **Decide whether to implement `sale.number_reused`.** It was added in `10b16fd57` for a
  translation of the invoice-number unique-index violation that was never written. Decide whether
  that translation is still wanted before deleting the code.
- **`server.credential_unusable` names an unusable credential, although `server.*` is reserved for
  facts about the process itself.** It is thrown for AEAT's certificate
  (`packages/fiscal-verifactu/src/aeat-transport.ts`), for Stripe's secret key and webhook secret
  (`apps/server/src/stripe-account.ts`, `apps/server/src/webhook.ts`), and for the email and
  machine-key credentials (`credentialField`, `apps/server/src/credentials.ts`); both
  `packages/fiscal-verifactu/src/errors.ts` and `apps/server/src/errors.ts` declare it. Before a
  venue is live a code may be renamed freely; once one is live a rename is a migration (CLAUDE.md
  §3). **Next action:** choose a prefix
  (`credentials.missing` is the nearest sibling) and rename it in one change, checking the prefix
  matchers `docs/developers/conventions-data.md` lists.
- **The Stripe webhook endpoint still has to be repointed by hand, at Stripe.** #378 shortened the
  address from `/webhooks/stripe/<an id>` to `/webhooks/stripe`, because the id in that path was
  supplied by the caller and no longer labelled anything real. Nothing in this repository points at
  the old address and a test pins that it now answers "not found" — but the endpoint registered in
  the Stripe dashboard is outside this repository and will keep sending to the old one until somebody
  changes it there. **Next action:** change it in the Stripe dashboard before any card payment is
  taken through a Stripe webhook.
- **`DrainResult.tenantsWithWork` is named for a count that can now only be 0 or 1.** One database
  files for one taxpayer, and the field reaches `apps/server`'s
  awaiting-certificate flag (`apps/server/src/pass.ts`, which keys off `> 0`) and `fiscal-none`. A
  rename would want to keep that "did this pass attempt work?" meaning rather than flatten it to a
  boolean, since the flag deliberately distinguishes a no-work pass from a pass that exercised the
  certificate and skipped.

**The development stack:**

- **A stale dev database is only reported AFTER the boot dies, never before it** (#343). The hint
  fires from inside the failed migration run, so the sequence is still: start the stack, watch it
  die, read one line, reset, start again. A pre-flight check was offered and deliberately not built
  (owner chose the message and the documentation instead, 2026-09-13): compare each set's applied
  rows against its journal entry count — `packages/migrations/migrations.manifest.json` gives the
  set-to-table mapping, and the whole probe is one query per set — and warn before launching that
  the branch carries migrations this database has not taken. Worth doing only if the after-the-fact
  line turns out not to be enough.
- **The hint's cover stops at the migration run, and provisioning runs after it** (#343). A module's
  provisioning seat (`packages/catalogue/src/provisioning.ts` seeds units per tenant) executes once
  migrations succeed, outside `withDevMigrationHint`. A seeding failure there on a stale database
  gets no curated line. Nobody has hit this; it is recorded so the next reader does not assume the
  wrapper covers the whole boot.
- **The hint cannot fire for the other "database too old" failure** (#343). An ahead-of-image
  database throws `provisioning.database_ahead`, an `AppError` carrying no SQLSTATE, and its
  operator text deliberately never suggests wiping — the remedy there is restore or reinstall (owner
  decision 2026-09-10). Intended, not a gap, but it means "boot names the remedy" is true of one
  version-mismatch failure and not the other.

**Dashboard, till and setup:**

- **One word for "switched off, kept for the record" across the dashboard — Small** (owner,
  2026-09-23). The same idea has several labels today, found by grepping the English strings
  (`apps/dashboard/src/i18n/strings.ts`, `packages/venue-service/src/dashboard/strings.ts`):
  products, venues, extras lists and options lists say **Active / Inactive**
  (`product.inactive_badge`, `venue.inactive`, and since A65 `extras.inactive` and
  `options.inactive`); printers, card readers and staff say **Disabled** with a **Disable** action
  (`printers.status_inactive`, `printers.status_revoked`, `payments.reader_disabled`,
  `person.mark_inactive`); a menu entry on the menu prices table says **Switched off**
  (`menu_prices.switched_off`); and a generic `action.deactivate` ("Deactivate") exists beside
  `action.disable`. Branch 2 of the one-product model settles products on **Active / Inactive**,
  kept separate from **Available** (sold out for now). **Next action:** pick the one
  pair, and the one action verb, for every screen whose record is switched off rather than deleted —
  deciding first whether a revoked printer or a disabled login is really the same state as an
  inactive product — then change the English and Spanish strings together and record the rule in
  `docs/developers/design-system.md`. String keys are not renamed on the way (only their text), so no
  test or code that names a key moves. A65 did rename two: it replaced `extras.not_in_use` and
  `options.not_in_use` with `extras.inactive` and `options.inactive`.

- **The Waitron wordmark is invisible on the dashboard banner in the dark theme** (seen 2026-09-14
  on the dashboard alerts branch; confirmed 2026-09-16 during #378's run-it
  verification, which also settled that it predates both branches — `packages/ui/brand/waitron-lockup.svg`
  last changed in #284, on `main`, and neither branch touches it). One file is served to both
  themes, as an `<img>`, so it cannot follow the theme: the wordmark's letters are painted
  `#16181d`, and the dark theme's page background is `#101216` — a contrast ratio of 1.06 to 1,
  where 4.5 is the readable minimum. **Next action:** give the lockup a light and a dark variant, or
  paint the wordmark with a token by inlining the SVG instead of loading it as an image. The setup
  wizard now inlines the lockup and paints the wordmark with `--wt-color-text`
  (`apps/setup/src/setup-app.ts`, C39), which is the second option already working in one app.
- **Sales and takings business-day range — DONE (C15).** The screen starts its reports with the
  UTC date, then adopts the venue's business day from the Overview endpoint when it answers. If
  Overview refuses or has not answered, the initial reports remain available. An operator's edited
  range stays in place if Overview answers later. Browser regressions supply a different business
  day at 01:00 and noon UTC, plus a noon same-day control, and cover a refusal, a pending read and a
  late answer.
- **An imported configuration no longer carries "already offered a passkey"**: a configuration
  transfer strips `passkey_offered_at` on export and refuses a bundle that still carries it.
- **A browser refusing the login screen's automatic passkey attempt no longer shows "Something went
  wrong, try again" on load — DONE (C8, #843, 2026-09-29).** Any rejection from the browser's passkey
  prompt (`startAuthentication`) ends the automatic attempt silently; a failure of the options or
  verify request still shows its banner, except the options answers C58 (below) quiets. The passkey
  button shows "Could not verify the passkey, try again" for a browser refusal instead of the
  generic sentence. Measured in real Chromium with `navigator.credentials.get` stubbed to reject: a
  `NotSupportedError`, a `SecurityError` and an `UnknownError` each showed the generic sentence on
  the button before the change.
  `@simplewebauthn/browser` 14.0.0 (`helpers/identifyAuthenticationError.js`) passes a
  `NotSupportedError` through with the `DOMException`'s numeric `code` 9, and rewraps an
  `UnknownError`, and a `SecurityError` whose host or `rpId` is wrong, under its own string codes
  (`ERROR_AUTHENTICATOR_GENERAL_ERROR`, `ERROR_INVALID_RP_ID`), none of which has a sentence. `codeOf`
  (`packages/dashboard-kit/src/codes.ts`) now returns only a string code and takes the fallback for
  anything else, including a `null` or `undefined` rejection, which used to throw. Its callers on
  2026-09-29: 229 calls in non-test files of `apps/dashboard` and six packages (`adjustments`,
  `bookings`, `media`, `payments-stripe`, `payments-sumup`, `venue-service`). A grep of the non-test
  files in those trees and `packages/dashboard-kit` for a thrown or rejected object literal
  (`throw {`, `reject({`) found two, both carrying a string `code`; the grep does not see an object
  thrown through a variable or a conditional. The login page was opened on 2026-09-29, before the
  review fixes, in light and dark, English and Spanish, 1280 and 390 wide: no banner on first load.
  - **DONE (C58, #857, 2026-09-29):** the automatic attempt on page load stays quiet when the passkey
    options request gets a successful (2xx) answer that is not the expected data. Reproduced first
    in real Chromium through the real `DashboardApi`: an HTML body and a JSON `null` body each
    showed "Could not verify the passkey" on first load before the change. The login screen now ends
    the automatic attempt quietly when parsing the options answer throws a `SyntaxError`, or the
    answer is `null` or empty (`createRequest` returns an empty body as `undefined`). Review found
    that the empty 200 and 204 answers still showed the message, and that catching every `Error`
    also silenced a body that broke off while being read. A server refusal of the options request,
    an unreachable server and a body that fails while being read still show their message on load:
    the refusal and unreachable-server tests went red when the catch swallowed every failure, and
    the read-failure test when it swallowed every `Error`. The shared request helper is unchanged
    (the owner declined that option); a press of the passkey button still shows the message.
  - **DONE (C57, #854, 2026-09-29):** the passkey button's sign-in sorts a failed attempt
    through `classifyPasskeySignInError` (`apps/dashboard/src/passkey-errors.ts`), beside the
    registration helper, instead of inline in the login screen. C57 left the automatic attempt on
    page load unchanged; C58, above, later changed it. No visible change: the login and profile
    screen suites pass unedited.
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
- **Failed HTTP responses with non-JSON or `null` bodies — DONE (#355).**
  `packages/dashboard-kit/src/request.ts` and `apps/till/src/api/client.ts` catch JSON parse
  failures, check that the parsed error is an object, and retain the HTTP status on refusal.
- Two QR libraries coexist (`qrcode` in `apps/server`, `qrcode-generator` in `apps/till`) — unify into
  `packages/shared`; hoist the receipt's hand-ported money/date/label formatters there too (the paper
  receipt already drifts from the screen by an NBSP normalisation).
- Recorded, not blocking: a handheld's Order tab is tappable with no active table; the
  boot-into-floor prefetch is unreached by any shipped canvas; the station screen's device-mode enrol
  sub-view is unreachable; the default counter canvas has no prep-queue rail.
- The dashboard's `es-ES` module default still needs the flip the till got in #170; check the
  dashboard money formatter for the same "doesn't follow the UI locale" bug.

**House rules and their guards:**

- **Keep an eye on `CLAUDE.md`'s size over time — it is no longer gated** (owner, 2026-09-14). The
  hard byte-ceiling in `scripts/claude-md-pointers.test.ts` was removed: it once made a session stop
  mid-work to ask what to do when an addition crossed the limit, which was the costlier mistake. So
  add rules to `CLAUDE.md` freely. The file was ~45.5 KB when the gate came off; if it drifts well
  past that, do the prune the gate used to force — move the receipts (mechanism, measurement,
  incident) into the matching `docs/developers/` topic file and leave the rule plus its one-line
  pointer behind, per `CLAUDE.md` §7. This is a periodic housekeeping check, not a blocker.
- **The pointers guard is deliberately narrower than "every pointer"** (#337).
  `scripts/claude-md-pointers.test.ts` checks every markdown link in `CLAUDE.md` and the topic files,
  and backticked paths under `apps/`, `packages/`, `docs/`, `scripts/`, `deploy/`, `bench/`,
  `.github/` and `.husky/`. It does NOT check a root-level filename such as `eslint.config.js` — a
  pointer `CLAUDE.md` really does give a reader — nor a bare directory. `CLAUDE.md` §7 says so; widen
  the guard if that gap ever costs something.
- **Eight historical plans and specs carry a dated pointer to the deleted
  `.github/instructions/waitron.instructions.md`** (#337 deleted it after moving its rules into the
  `docs/developers/` files; it read nowhere after Copilot's review was switched off on 2026-09-06).
  Nothing guards that class, so a future rename needs the sweep done by hand:
  `grep -rn --include="*.md" waitron.instructions .` is the whole list.

**Reads the database does not need:**

- **Checking one product's translations re-reads the language configuration once per value**
  (`packages/catalogue/src/content-languages.ts`). `validateContentTranslations` reads the one-row
  configuration on every call (the advisory lock it also took went with the storage switch), and
  `packages/catalogue/src/variants.ts` calls it once per variant, inside the normalisation loop.
  The extras and options contracts, and a unit save, ask `findContentTranslationGap` ONCE with every
  map, which is the shape this entry is asking for. That is the shape `CLAUDE.md` §3's "resolve
  shared catalogue data once before a basket's line loop" rule exists to prevent. **Done since
  (2026-09-30, A149, #943):** a product save reads it once; see "Saving a product reads the same tenant
  configuration once per variant".

**Payments:**

- Bound the HTTP body read as well as the header wait in `sumup-client.ts` (move `clearTimeout` after
  `res.text()`); lift `reverseViaStripe` and `reverseViaSumUp` into one neutral reversal primitive.
- Pre-existing `forward` retry backoff.

**Fiscal (each behind its own review, owner sign-off at land):**

- **The three alta builders are triplicated** — `recordSale`/`recordCorrection`/`recordSubstitution`
  in `packages/fiscal-verifactu/src/backend.ts`. Safe
  seam: a helper taking the assembled `Omit<AltaInput,"Encadenamiento">` plus a `buildDesglose`; needs
  a huella-invariance re-run across all three.
- `mirror-bundle.ts`'s `r.series ?? []` branch is un-exercised; export `ID_SISTEMA_MAX_LENGTH`
  when either package is next touched; `insertNodeSeriesTx`'s held-code check is SELECT-then-INSERT;
  the SP-3d restore overlapping
  a live SIF registration deadlocks (`40P01`) — revisit locking before the hook runs live.

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
  result — leave it, or build the replay?** Checked against the tree on 2026-09-17, not assumed: in
  `invoice_first` the place path files a deferred invoice through `recordSale`, so replaying would
  mean reading back the immutable `registros_facturacion` row and rebuilding the invoice number,
  date and QR. That is fiscal core, and not work to do unattended. Leaving it is a real option — the
  409 is a defensible state conflict and the till already degrades gracefully, keeping the basket and
  showing `place.error`. The gain if built is that a re-tap after a lost response returns the invoice
  already issued instead of an error. Two claims an earlier campaign note made are FALSE and must not
  be reused: that placing files nothing fiscally, and that the current answer is an opaque 500. The
  place-path comment in `apps/till/src/till-app.ts` already calls an idempotent `placeOrder` "a
  recorded backlog follow-up"; until this entry there was no such record, so that claim was false —
  this is it.

---

## Afterwards — the on-prem mirror, then the cloud primary

Not in any track until the standalone primary is done. Kept here so the decisions and residuals do
not get lost.

### The on-prem mirror

**2026-09-19: the PostgreSQL logical-replication mechanism described below was DELETED (slice 1, task
P8).** Read this section as a list of requirements the replacement must meet, not as work outstanding
on code that exists. The membership, promotion and rejoin arc (#197–#272) and the two-node WireGuard
fixture (#275) are still in the tree. What remains, largest first:

- **Status, alarms and the operator surface for replication.** The REQUIREMENT stands: an operator
  needs to see whether the standby is keeping up, and to be alarmed when it is not.
- **Fiscal-certificate distribution — landed #279, reverted #281; rebuild on the asynchronous adopt.**
  Open design question: how the dormant certificate is protected when the seal must happen after the
  initial COPY ([design](superpowers/specs/2026-09-07-fiscal-cert-distribution-design.md),
  [plan](superpowers/plans/2026-09-07-fiscal-cert-distribution.md)). Beside it, **the vault-ring
  question**: `tenant_credentials` is `local` and a blob sealed under one node's ring cannot be opened
  under another's, so `fiscal.aeat` and `payments.stripe` do not travel to a standby at all.
- **Node-role collapse** — derive ONE `NodeRole` at boot from the membership document and pick one
  rule: every role change is a restart, or the worker-lifecycle manager — not both.
- **The mirror as a backup destination**, and the mirror's print agent (gated on B6's cross-box TLS).
- **The two-node end-to-end proof over LAN and over WireGuard**, including the same-site cookie
  browser receipt still owed from the till reroute, #257 (needs interactive Chrome + mkcert +
  `/etc/hosts`).
- **Richer daily close** — one close run by the primary across all tills.
- The residuals under *Detail → Replication*: re-admission, the membership chart filling up, chart
  hygiene, the resume-at-restore marker, power-loss durability and the selling gate, restore-onto-cloud
  re-encrypt, mirror fidelity, split-brain on the promoted side, the till UX for a timed-out card.

**A stale worktree:** `feat/h2-fiscal-record-sync` (spec and plan dated 2026-09-04, uncommitted
changes in `packages/sync`) was designed on the application outbox that #280 deleted, and the
replication it was rewritten against went too (2026-09-19); the `ledger` classification of the fiscal
tables survives both. Superseded twice over — remove it once the owner confirms nothing in its
uncommitted diff is wanted.

### Cloud integration and SQLite work

**Shared account controls:** `@waitron/ui-core` owns the seven account controls, tokens and common
helpers inside this repository, and existing `@waitron/ui` imports re-export them (see the
extraction design). Cloud has
published private `@waitron-io/ui-core@0.1.0` (see the [release receipt and setup](https://github.com/waitron-io/waitron-cloud/blob/main/docs/shared-ui-release.md))
and owns the release workflow and account screens.
Read the first weekly mutation results for both UI packages after the split; this
branch preserves the 90% gates but does not measure their new full mutation scores.

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

**SQLite + Litestream replaces PostgreSQL** — owner decision
2026-09-16, taken on the infrastructure simplification alone, which retired the density measurement
that used to gate it. The feasibility reads are in
_SQLite instead of PostgreSQL_
(the regulation names no database privilege; Litestream covers standby and rejoin but not a returned
box's ledger tail) and the architecture in
[SQLite + Litestream topologies](superpowers/specs/2026-09-16-sqlite-litestream-topology-design.md),
whose §11 is the build order and whose §12.2 is the one gate still standing — a throwaway
failover-loop prototype.

**That prototype gate is DONE — all ten tasks landed (#392, #395, #406, #411, #415, #417, #422,
#425), and slice 1, the storage swap, is COMPLETE as of 2026-09-23**. Read
[the results note](research/2026-09-16-sqlite-failover-prototype.md) rather than re-deriving any of
it: the failover loop holds everywhere except **S2**, the recorded negative result — a handed-over
batch can re-file a sale the receiver already filed, which costs one wasted AEAT call (error 3000,
already read as filed) rather than a record filed twice. The fence-before-ship rule that produced is
now in topology design §5.2. The tag `pre-sqlite-migration` (`c9d80c59`) marks the last commit before
any of this code, so you can still read how something worked under PostgreSQL.

**Slice 2, stream and cold restore, is COMPLETE as of 2026-09-25** (PRs, in the order the
tasks landed: #513, #540, #543, #548, #554, #557, #560, #566, #569, #590, #619, #627, #628, #630,
#642, #646 and #652, with follow-ups #573, #576, #594, #599, #608, #643, #647, #649 and #650).
A venue streams `venue.db` continuously to an S3-compatible bucket the owner supplies, a dead box is
rebuilt from that bucket with one recovery kit and carries on under a fresh fiscal chain, and staff
see how current the copy is. What each task built, and what it left open, is in the slice-2 entry
below. **Next: slice 3, seats and promotion. Its first task is already decided: credentials move to
a venue key** stored in `venue.db` only in locked form — do not reopen it.

**What the gate left open (index; the receipts are in the results note):**

- **Validate every supported object store.** Cloud owns its production-provider checks in the
  [Cloud backlog](https://github.com/waitron-io/waitron-cloud/blob/main/docs/backlog.md);
  Waitron retains the engine's required semantics and checks for claimed self-host targets.
  Every store result in the prototype note is MinIO's. Topology §12.2's real-store gate remains
  open; the conditional-write promotion tie-break must be demonstrated on each target (risk 11).
  **Since slice 2 (2026-09-25),** each owner's bucket is checked by the Backups screen's Test and
  Save (`probeBucket`, `packages/stream/src/probe.ts`), which refuse a bucket that does not refuse
  a stale conditional write. The same check is the first assertion of
  `apps/server/src/stream-loop.e2e.test.ts`, run against versitygw 1.8.0 whenever CI runs
  `apps/server`'s tests. Waitron Cloud's production store still needs its own run.
- **The restart reset is built, and so is its precondition (#566).** `resetInFlightClaims` returns
  every `enviando` row to `pendiente` before a boot's first filing pass, on the singleton primary;
  it assumes ONE server process per venue folder, which #566 enforces.
- **`apps/server/src/restore-fiscal-e2e.test.ts`'s header gives a reason that no longer holds — DONE**
  (#589 deleted the claim and its line pointers).
- **A suite header in `apps/server` says its suite is RED, and it passes — DONE** (#629 for
  `awaiting-fiscal-cert.test.ts`, #624 for `boot.promote.test.ts`).
- **Bounding the offline write-ahead log — ANSWERED in slice 2 (#590).** The box alerts after fifteen
  minutes (`backup.stream_behind`); at a 256 MiB limit it stops Litestream, folds the side file back
  and raises `backup.stream_paused`.
- **The store pointer and a new generation are exercised for a rebuild, not for a promotion.**
  Slice 2's loop test (`apps/server/src/stream-loop.e2e.test.ts`) streams one box, rebuilds another
  from the pointer `current.json` names, and has it open its own generation and move the pointer. A
  promoted node's generation, and Cloud's recovery orchestration (tracked in the
  [Cloud backlog](https://github.com/waitron-io/waitron-cloud/blob/main/docs/backlog.md)), remain;
  settle the Waitron ↔ Waitron Cloud contract before assigning them.
- **250 sales a day is still an assumption** nothing in this repository measures, so the days-per-GiB
  figure rescales but does not hold.
- **Three scenarios have no mutation receipts (S1, S6, `smoke`), two branches of the litestream
  wrapper are driven by no scenario, and the runner's own `main()` is undriven** — a later task should
  pin them or delete them.

**SQLite slice 2 — COMPLETE (2026-09-25)**: the venue streams
its database to a bucket the owner supplies, and a dead box is rebuilt from it. Every task below has
landed, the last one (Task 10) in #652. The items each paragraph calls open, left open, still
open or an open question are still open after slice 2 unless a later line marks them done. Landed:
Task 3b, the restart reset (#513); Task 4, the five measurements Litestream's behaviour decides
(#540) — the values later tasks read are under "What later
tasks read" in [the results note](research/2026-09-16-sqlite-failover-prototype.md#slice-2-measurements).
Task 0, shrink every uploaded photo, landed as #543; what it does and what it leaves
open are under the image library in Track A.

Task 1a, each machine's own rows keyed by its node id (`node_roles`, and `node_id` on `mirror_config`
and `join_requests`), landed as #548; identity's comments that still placed its tables in different
files were rewritten by #554 and #559. Left by #548: deny's delete is the one join-request node filter
no test fails without (the `requirePending` read before it already refuses another node's row, as
its doc comment says); and the run-it review did not reach three claims within its
budget — holders torn by a concurrent promotion, credential sealing, and scheduler takeover.

Task 1b, session cookies stored only as hashes (`sessions` and `management_sessions` keep only the
token's SHA-256 in `token_hash`), landed as #554, which also gave the mirror viewer's ambient
`admin` session (`apps/server/src/mirror-session.ts`) a random-token cookie stored only as a hash.
Left by #554's review, not fixed there (items 1 and 2): (1) with the cookie now hashed, nothing
fails when the UUID shape screens in `requireSession` and the till logout route are deleted —
measured 2026-09-24, the three malformed-cookie cases in `apps/server/src/till-api.test.ts` still
pass, because a non-UUID value hashes to no row; the screens now only save a lookup. (2) Test
titles still promising "not a 500" from PostgreSQL's `22P02` remain in
`till-api.courses.test.ts`, `till-api.receipt.test.ts` and `till-api.reprint.test.ts` (#613
removed the comments).
Also left open: now that both ends are `state`, the keys #426 dropped could be declared again —
`sessions` to `persons` and `tills`, and `management_sessions`, `totp_enrollments` and
`google_oidc_states` to `persons` (`sessions` and `management_sessions` are rebuilt by
`packages/identity/drizzle/0003_session_token_hash_required.sql` anyway). Doing so would change
what deleting a person does.

Task 2a, a recovery key that does not need an archive destination (`apply` reuses a key the box
already holds, refusing a different one with `backup.recovery_key_exists`; every status answer
carries `recoveryKeySet`), landed as #557. Until Task 8b the Backups screen's setup form
(`apps/dashboard/src/screens/backup-screen.ts`, shown on a writable box whose backups are not
enabled) sent a freshly made key unless the operator pasted one, so on a box that holds a key while
backups are off — for instance one whose venue failed to open, which clears the running config while
`backup.env` keeps the key — the apply was refused with that code. Task 8b made the form read
`recoveryKeySet` and make and send no key when the screen's last status read says the box holds one. That does not rescue the
failed-venue box: an apply there that reuses the held key takes the path a pasted held key took
before — it writes, reloads, the venue fails to open again, and the route answers
`backup.effective_mismatch` (read from the route, not run, for Task 8b). A held key shorter than the
12-character minimum is replaced from the dashboard, for a box whose backup settings its environment
does not own (`recoveryKeyTooShort`, #649); the bucket copy panel's refusal for a too-short key
names the "Turn on backups" button, or the environment when it owns the settings (lane A's A35,
#666). The refusal code is unchanged and the message does
not link or scroll to the button. The screen asks for a key from its status watcher on any status
read, at most once and only while the screen has made none (lane A's A49, #684); starting Apply,
Rotate or Save settings clears a failed status read's alert, while Show old key, Edit and Cancel
edit leave it (lane A's A54, #690, and A59, #701, the owner's choices).
Left open: the panel picks its message from `managedByEnvironment` alone, so with
a key hand-edited too short in `backup.env` it can name a button that does not help: with archives
on it names a button that is not shown (the status reads the running settings' still-long key, and
the form shows only with archives off); with archives off, until the next status read reports the
key too short, the button sends no new key (it reuses the held one) — after that read the screen
makes one. The watcher does not retry its own failed mint (the mint is a POST, which is never
passive session activity), so the screen then offers no key until it is reopened, as it did before.
The edit-settings form can also meet
`backup.recovery_key_exists`, when a rotate (from another tab or admin) lands after it fetched the
key. Left open: the
"key rotated" date `rotate` writes is dropped by a later `apply`, because `readApplyBody` always
passes `keyRotatedAt: undefined` — this predates Task 2a (a settings re-apply already dropped it),
and the value is what the Backups screen shows as the date the key was rotated.
Also left by #557's review, the owner's call: `rotate` with a destination loaded still rebuilds
`backup.env` from the running settings rather than keeping the file's other lines, so a
destination added to the file by hand and not yet loaded is dropped; keeping the file's lines
instead would change that behaviour.

Task 2b, the box's own state files locked with the recovery key in the venue database (core table
`node_sealed_state`, one row per node, `local`), landed as #560; a failed refresh raises
`backup.sealed_state_failed` as a dashboard alert (Task 7). Every node writes its own row at every
start, standby and mirror nodes included, while the backup job runs only on the primary — kept by
design (owner, 2026-09-24). Nothing outside the backup routes
or the bucket-copy settings' Save (which writes a recovery key into `backup.env` when the box holds none)
rewrites a sealed file while the server keeps running; Task 8a calls the one
`sealedState.refresh()` boot builds, and Task 9a calls none: boot's own refresh seals its new leaf.

Task 3a, one process per venue folder (`venue.lock`; a second process is refused
`provisioning.database_in_use`), landed as #566; #573 stopped a refused start counting toward the
recovery page and made the container's entrypoint refuse any argument
(`server.entry_arguments_refused`); #608 sends a folder held by a stuck process to the recovery page
(`provisioning.database_holder_stalled`, with a watchdog that kills a holder stalled for 120 s) and
puts every change to `recovery.json` under `recovery.lock`
([conventions-data.md](developers/conventions-data.md), "One process per venue folder").
Still open from #608's `recovery.lock` change: the level is read before that lock, so the pre-boot count
another start writes can still push a server restarting at that moment onto the page (older than
#573). Still open from #573's review, the owner's call: (3) only an unwrapped `provisioning.database_in_use` is
recognised — a wrapped one, or the store's raw `VenueInUseError`, would still count (no path wraps
them today). Left by #608, no behaviour change decided: the watchdog appends its line to
`waitron.log` without creating the log folder, so on a machine with no such folder that line is
lost (the JSON report and stderr still carry it; a box's `logs` volume always exists); only a
store's `close()` waits for the watchdog thread to end, not a bare `release()`. The recovery page is
in English and Spanish, chosen from the browser's `Accept-Language` (#650); its Spanish has not been
read by a native speaker. Also
left by #566's review, no behaviour change: the migrator's lock and
the venue lock use one technique in two copies, and the test helper that holds the lock from another
process is copied into several test files.

Task 5, the new package `@waitron/stream` (the S3 bucket client, the signed pointer
`current.json` naming the live generation, generation claiming and pruning, and `probeBucket`, the
check behind the settings screen's Test button), landed as #569; pruning sends S3's multi-object
delete, falling back to one request per file only on a 501 (#594), and a listed file outside the
folder asked for is `backup.stream_name_invalid` with `field: "listedKey"` (#576). Which real providers lack the multi-object delete, and what
each answers, is not established; a provider that refuses it with any other status fails the day's
prune, which is logged as `stream.prune_failed`. `probeBucket` (`packages/stream/src/probe.ts`),
which the supervisor runs before opening a generation, again while streaming (at most every ten
minutes after a failed bucket read or while a bucket problem is flagged, otherwise once a day), and
which the bucket-copy panel's Test and Save both run, deletes one object at a time, so neither can reveal such a provider. Open: having the bucket check
delete its test object through `deleteMany` would reveal one. Also left: `@waitron/store` is missing from the
English-only guard's `GENERIC_PACKAGES` (`packages/db/src/english-only.ts`), so it is never scanned
— I believe this predates #569 (the package dates from #489); and nothing in the package has been
run against a real provider's bucket — the unit tests drive the real S3 client over a scripted
network, and since Task 10 (#652) the loop test drives it against versitygw 1.8.0, a real
S3-compatible server run on the test machine.
`apps/server/src/rejoin-command.test.ts`'s sidecar assertions do not test the wipe: its fixture
closes the handles first, which removes the sidecars, so with `db-wipe.ts`'s former `SIDECARS`
list cut to `[""]` it still passed 18 of 18 (the assertions predate #548: aabdde6a8, #489). The wipe's
sidecar removal is pinned by `apps/server/src/db-wipe.test.ts`; what is missing is only a
rejoin-level case with sidecars on disk.
Every synchronous `deriveKey` caller still blocks the event loop while it derives, among them:
`encodeConfigurationBundle` (`apps/server/src/configuration-transfer.ts`, through
`encryptArtifact`); everything reaching `decryptArtifact` (`apps/server/src/artifact-cipher.ts`) —
`decodeConfigurationBundle` (`apps/server/src/configuration-transfer.ts`, on the request path,
decoding an uploaded bundle), `validateArtifact` (`apps/server/src/restore.ts`) and `unsealNodeState`
(`apps/server/src/sealed-state.ts:32`); and the recovery bundle's `encryptBundle` and
`decryptBundle` (`apps/server/src/recovery-bundle.ts`). Task 2b moved the backup
sweep's encryption and `sealNodeState` to `encryptArtifactAsync`.

Task 6, the Litestream supervisor (`@waitron/stream`'s `StreamSupervisor`, the server's
`StreamHost` started at boot on the primary, the store's `checkpointTruncate`, Litestream 0.5.17
pinned in the box image and in `pnpm setup:litestream`), LANDED as #590; the same generation
continues after a pause (owner, 2026-09-24), and the bundled libraries' notices ship in
`/app/third-party/litestream/NOTICES.txt` (#599). Left open by #590's review, the owner's call (the PR description has the
detail): (1) no S3 call has a request timeout, so a pointer write that never gets an answer holds up the
supervisor's retry until the server stops or reloads — Litestream stays stopped meanwhile, so the side
file is not at risk (closed by A44 for a bucket that takes the connection and never replies: the
entry "the stream's other bucket calls are bounded", below); (2) a supervisor retries its pointer
write when the refusal was caused by one of this process's own earlier pointers (closed on Task 8a's
branch). Still open: a pointer write from a process that has since died, landing after the restart,
can still make the box refuse itself, because a restarted process starts with an empty record, and
so does a `current.json` deleted after the supervisor read it, on a bucket that answers a conditional
write to a missing object with 412 (SeaweedFS; the in-memory test store); in both cases the owner's alert
(`backup.stream_refused` in `apps/dashboard/src/i18n/alert-messages.ts`) still says another box is writing. On a bucket that answers that write with 404 instead (AWS, as it
documents; versitygw, as measured), the deleted pointer surfaces as
`backup.stream_request_failed` and `#movePointer` (`packages/stream/src/supervisor.ts`) logs
`stream.pointer_write_failed` and retries every `OPEN_RETRY_MS` until the supervisor stops, never
reaching `refused`;
(3) `StreamHost` streams on any node whose role is primary, while the Cloud snapshot worker also
requires that the node has not been cut off from acting as primary (`cloudPrimary`) — should a
cut-off primary stream?; (4) the server's 8-second shutdown stops the stream last, after the Cloud
snapshot loop, so on a large database Litestream may not finish its last upload (it is still told to
stop and does not outlive the server).
Also left: `pnpm setup:litestream` skips the download when the installed
binary already reports the pinned version, so the checksum protects fresh downloads only; and the
bench rig keeps its own Litestream download script (its version is pinned beside the root one by
`scripts/litestream-pin.test.ts`).

Task 7, how current the bucket copy is and the alerts about it, landed as #619: `/health`, the box
status and the backup status show the bucket copy, and `/health` never fails because of it; the
dashboard alerts on a copy that is behind, paused, stopped or refused, or whose settings are
unusable (`backup.stream_stopped` and `backup.stream_settings_unusable` are new). Left open:
- A bucket read given up after five minutes is not cancelled, because the bucket client's list
  takes no way to stop it. Since A44 the store gives a request up when it has had no reply 30
  seconds after it started, so what the deadline can still leave running is a listing whose answer
  keeps arriving, or one whose answer stalls after headers that arrived within the first three
  seconds (the entry "the stream's other bucket calls are bounded", below).
- A commit that changes no row but writes to the side file, such as a schema change or a pragma
  such as `user_version`, is not reported, so the lag can read low.
- An update that writes the same value, straight after a schema-only commit, is still reported,
  although it adds nothing for the bucket (a test pins it).
- The check that the side file changed was measured on the Mac's filesystem only, not the box's
  Linux one; a commit landing in the same file-time tick after a side-file restart is missed.
- A sale whose write transaction began before the supervisor first subscribed after boot (no
  listener registered when it began) is not counted, so the lag reads low for it.
- Whether Litestream uploads anything while the side file is unchanged is not measured; Task 10's
  loop test (#652) does not measure it either.
- Of the four places boot hands the copy's state to, three are held by the compiler, which refuses
  a boot call that leaves the key out, and `/health` by a boot test. A boot test also pins the
  sealed-state alert's registration.

Task 8a, the server side of the bucket-copy settings, landed as #627: routes under
`/api/backup/stream`, behind the manager login, read the settings, test a bucket, save and switch
the copy on, switch it off, and hand out the recovery kit (`packages/stream/src/kit.ts`).
That startup hands both route groups the one queue is held by a boot test (`apps/server/src/boot.test.ts`,
"gives the archive routes and the bucket-copy routes one queue"; lane A's A36,
#667), weaker than the rule: it holds one rotation in its turn and sees a
kit read wait behind it, so it fails if either group is given a queue of its own or if the rotation
or the kit read stops taking its turn, but it does not check the other routes.
Left open: the pointer write left open under
Task 6, item (2), one from a process that has since died, landing after the restart.

Task 8b, the Backups screen's bucket-copy panel (`apps/dashboard/src/screens/stream-settings-panel.ts`)
and the archive setup reusing a held recovery key, landed as #628; it also added the
`--wt-font-family-mono` token. Left open: the Backups screen's own card width is still a `34rem` literal, which the
no-hardcoded-chrome rule forbids in a view and no guard reads; and a change of the secret access key
alone, made in another tab, still leaves the old kit showing, because a settings read does not carry
the secret.

Task 9a, the first start after a restore (#630). Every restore that takes on the archive's
identity (`skipSecrets` unset) leaves `rebuild-first-start.json` in the state folder. At the next
trading start the box signs a new certificate for this machine's addresses with the authority it
brought back, then the membership document one term above both the restored document and the term
the bucket's pointer names (read for at most 15 seconds, only when the marker is there); the marker
goes last (`apps/server/src/rebuild-first-start.ts`). A box with bucket
settings whose pointer it cannot read in that time fails the first start rather than sign a term the
pointer may be above. A first start that fails lets the box sell but holds the bucket copy, a reload after a
settings save included, and raises `restore.first_start_failed`. It runs after the returned-box
reconciliation with the cloud peer, which covers only a peer that answers during the same start (see
below). A mirror or a fenced node re-issues and signs nothing; the marker stays and the copy is held. An adoption-pending box
returns from boot before the first start, so it neither runs nor defers it: it keeps serving the old
certificate and the marker stays. The new certificate and key are written under working names and
renamed into place only when both are written; a
crash between the two renames leaves a mismatched pair, which the next start replaces before the
listener reads it, because the marker is still there — unless that start defers the first start
(fenced, mirror or adoption-pending), when the listener refuses the pair. Every membership signer
carries the signing node's stored endorsement, because `mintNextMembershipDocument`
(`apps/server/src/membership-mint.ts`) reads it itself (#643, #655); a node row holding no
endorsement still signs `endorsements: []`, and no first-start case asserts it. Left open:
- Two comments claim more than the code keeps: `retireSelf`'s header (`apps/server/src/retire.ts`)
  says a signing failure "leaves the node exactly as it was", and `promoteMirrorToPrimary`'s
  (`apps/server/src/promote.ts`) says a failure before the commit "leaves the mirror as it was". #655's
  Codex seat measured that signing empties pending `change_log` rows (on #655's base too), so they
  are not strictly untouched; ordinary writes delete their own rows, so no case losing a real one is
  known. Neither file is in a queued pruning part; narrow both the next time either file is edited.
- A restored box whose cloud peer does not answer during its first start signs the next term and
  removes the marker; a fencing document the peer serves later at that same term reads as not
  newer, so the box is never fenced. This task's review reproduced it with a temporary two-boot case in
  `apps/server/src/boot.reconcile.test.ts` (peer down on the first boot, a fencing document at
  term 2 on the second: the box still accepted sales; without the marker it was fenced). I believe
  it cannot happen today — the only writer of `mirror_config`, which the peer check needs, is
  `apps/server/src/adopt.ts`, for a standby that never finishes adoption — from reading, not a run.
  Recorded, not redesigned.
- When the key rename and the put-back both fail, the new certificate is left beside the old key
  (the listener refuses the pair) and `server.crt.previous` holds the old certificate until the
  next reissue overwrites it. The next start repairs it as in the crash case, because the marker
  stays — unless that start defers the first start. Publishing the pair through one atomic switch
  (for example a directory swapped by a single rename) would remove this case.
- The pointer read gives up after 15 seconds but does not cancel the request: the bucket interface
  takes no way to stop one.
- The pointer's term is taken without checking its signature, as the supervisor already does, so
  whoever can write the bucket can push a restored box's term up (never down).
- A marker left on a fenced box survives `waitron-rejoin`, which wipes the database and removes
  only `trading.env` from the state folder (`apps/server/src/rejoin-command.ts`), so the first
  start runs whenever that box next starts trading unfenced and not as a mirror. Whether a rejoin
  should clear it is the owner's call.
- A sell-only local secondary that is not fenced runs the first start and signs the next term.
- A restored membership row is now checked before the start that finishes the restore signs over
  it (#678, closing part of what A38, #669, left open): `completeRebuild` runs
  `assertRestoredMembershipValid` (`apps/server/src/rebuild-first-start.ts`). Left open:
  - The check trusts the keys the restored copy holds. A copy whose `nodes.public_key` for this
    node was rewritten, with its document re-signed by the matching key, passes, and the next term
    is signed over the added node: the case "passes a document re-signed with a key the copy's own
    node row was changed to name" pins that.
  - Only the start that finishes a restore checks the row's signature. A mirror or fenced start
    checks only that it can be read and is shaped as a document (A53); a start still finishing an
    adoption checks neither. No other code that signs over the held row checks its signature first (promotion, `retireSelf` and the standby chart append among them:
    `apps/server/src/promote.ts`, `apps/server/src/retire.ts`,
    `apps/server/src/mirror-bundle-api.ts`). Gating promotion on the same check was measured and not
    done, because it would refuse a genuine document: on 2026-09-26 a scratch case built the way
    `promote.test.ts` builds a mirror found, after `setDeploymentMode(…, "mirror")` alone (what
    `adoptFromPrimary` leaves), no document and an empty trust set; after
    `establishReservedStandbyIdentity`, a trust set naming the standby alone; and a document the
    primary signed with its real key, written there, verified as `untrusted_signer`. Nothing writes
    a document on a mirror today, so its held document is null (from reading the writers, not a
    run). The owner's decision on this, 2026-09-26, is under the failover residuals ("a standby
    checks a promotion against the primary's key"; it covers promotion, `retireSelf` and the
    standby chart append, and a restored mirror's own start is not covered by it).
  - **Closed for a restore by A53 (#688), on the owner's A45 answer ("move the check earlier").**
    When a restore's marker is present, boot runs `assertRestoredMembershipReadable` before its
    first read of the held row, and a malformed document throws
    `restore.membership_invalid { reason: "malformed" }`. No test drives a real refused start all
    the way to the rendered page. Still open: on a start with NO restore marker,
    text that is not JSON or a machine list that is not a list fails the same way with the generic
    text; a stored JSON null reads as no document, and a document breaking only a shape limit is
    read and used unchecked. From reading its writers, nothing this program writes produces one.
    The start still
    fails and nothing is signed, but once starts have failed repeatedly the recovery page shows the
    generic text (code `unknown`), not `restore.membership_invalid`. Whether to give it a curated
    code is open.
- A mirror that deferred its first start and is then promoted without a restart
  (`promoteMirrorToPrimary`, `apps/server/src/promote.ts`) keeps the bucket copy held, reading off
  with the reason `first_start_pending` and raising no alert, until the box next starts; that start
  runs the first start, because the marker is still there. From reading, not a run.

Task 9b, restore from the bucket (#642): `waitron-restore restore --from-bucket <kit-file>
--confirm-venue <tax id> [--confirm-old-box-gone]` rebuilds a box from the bucket the recovery kit
names (`apps/server/src/restore-stream.ts`). Left open:
- A copy over 2 GiB cannot be restored: `restoreFromStream` reads the downloaded file whole, and
  Node refuses a file that size (`ERR_FS_FILE_TOO_LARGE`, measured on Node v26.7.0 during this
  task's review). Archive creation has the same limit (`apps/server/src/backup-sweep.ts`). The
  root is that placement (`restoreDatabase`) takes bytes, not a file. Letting it take a source path
  and rename it into place on the same filesystem would remove the read into memory on the bucket
  path, and also the archive form's extra full copy: `refuseIfArchiveSourceLive` writes the whole
  database to a scratch folder only to read the bucket settings from it.
- `pragma integrity_check` is one blocking statement, and the venue watchdog kills a process after
  120 seconds without a timer turn. The review measured 6.0 s on a 1.36 GB database on NVMe; box
  storage has not been measured.
- A staged request whose marker is invalid, or whose payload cannot be read, throws before the
  request is cleared, so every start fails the same way. I believe this predates the branch: the
  archive request's reads sat outside the `try` before it (from the diff, not a run).
- A copy with no `tenants` row reads an empty tax id, which neither the command line nor the setup
  wizard ever accepts as confirmed, so it cannot be restored. Each prints its own message for it,
  but no dedicated error code names that case.
- An interrupted bucket rebuild or archive check leaves its scratch folder, a full copy of the
  venue database, under the state folder; the next run makes a new one and does not remove it.
- Fixed in #647: the placement step no longer loses both databases. Still open:
  - A setup-wizard restore whose placement fails is not retried and is not reported on the setup
    screen, nor normally on the recovery page. The restore is placed on the next start by
    `runStagedRestore` (`apps/server/src/restore-request.ts`), which deletes the staged request on
    `restore.placement_failed` and fails that start; the start after it boots what the venue folder
    holds, so the box comes back in setup mode, and the code and which database was kept are only in
    the server's own output and in `waitron.log` (`failureDetail`, `apps/server/src/node-entry.ts`). That holds when
    nothing was moved or everything was put back (a raw error, or `kept: "previous"`); when the old
    database was left in a set-aside folder (`kept: "set_aside"`) no `venue.db` remains, so since
    A31 every following start is refused with `restore.database_set_aside` and the box ends on the
    recovery page. One option is to keep
    the staged request on `restore.placement_failed`, so repeated failed starts end on the recovery
    page. **Owner decision 2026-09-25: leave it as it is.**
  - Fixed by A31 (#660): a `.venue.db-replaced-` folder left in the venue folder is removed by the
    box's next start (`clearReplacedDatabases`, `apps/server/src/restore.ts`). Only the container's
    entry clears them: a server started any other way (the dev stack) does not.
- The bucket client's own time limit is on idle time only (A44, 2026-09-26): `createS3ObjectStore`
  (`packages/stream`) gives a request up when it has had no reply 30 seconds after it started
  (`BUCKET_IDLE_MS`), three attempts in all, and bounds no call's total time; it does not reach the
  rest of an answer whose headers arrived within three seconds (measured; the entry "the
  stream's other bucket calls are bounded", below). The command line and the setup restores also
  wrap it for every object-store call they make (`boundObjectStore`, which abandons a call but never
  cancels it), the first start's pointer read has its own 15-second race (`readBucketPointerTerm`,
  `apps/server/src/rebuild-first-start.ts`, reported as `restore.pointer_unreadable`), and the
  replication supervisor's freshness read and the pause's bucket question are each abandoned after
  `READ_DEADLINE_MS` (`packages/stream/src/supervisor.ts`) but never cancelled. Every other caller
  has the store's limit alone: the supervisor's other calls, and the bucket check the backup
  settings screen's Test and Save buttons run (`probeBucket`, opened in `apps/server/src/boot.ts`,
  called from `apps/server/src/stream-api.ts`). Read, not run: that check now throws
  `backup.stream_request_failed` with no status once the store gives up, which the route answers
  with 502 (`stream-api.ts`; its route test "Test reports a bucket that gives no answer at all as
  unreachable, not as refused" covers that answer with a thrown error, not with a real bucket).
- Open question: the first start's pointer read and the bucket rebuild's calls (the command line's
  `--from-bucket` and the wizard's `/setup-api/restore-bucket`) use different limits (15 seconds
  and 60 seconds) and report different codes (`restore.pointer_unreadable` and
  `backup.stream_request_failed`). The code does not say why they differ. On the
  bucket rebuild, only a timed-out pointer read or newest-upload listing reaches the caller as
  `backup.stream_request_failed`. On every restore, a timed-out call in the clock check
  (`measureBucketSkew`, `apps/server/src/restore-stream.ts`) is reported as
  `restore.stream_source_unchecked` with reason `clock`. The backup-file restores (command line and
  wizard) and the Cloud restore make their other calls to the venue's own bucket inside
  `refuseIfArchiveSourceLive` (same file), which reports a timed-out one with reason `bucket`. The
  Cloud restore's download of its snapshot from Waitron Cloud's storage is not one of these calls:
  it has its own limit (`downloadArchive`, `apps/server/src/cloud-recovery.ts`).

Task 9c, "Restore from my bucket" in the setup wizard (#646): a third card on the wizard's "Join or
recover an existing restaurant" screen takes the recovery kit and stages the rebuild through
`POST /setup-api/restore-bucket`; the archive and Cloud recovery restores ask the same old-server
question. Left open:
- The bucket route answers a wrong key (`recovery.passphrase_invalid`) and a damaged copy
  (`backup.artifact_invalid`, `backup.archive_invalid`) with different codes; the wizard shows one
  sentence for all three, as the command line does. Whoever holds the kit already holds the key.
- The first, unconfirmed attempt downloads the whole copy only to show whose it is, and the
  confirmed attempt downloads it again; the HTTP request stays open for the whole download.
- Walked in the browser test harness against a stubbed server (both themes, desktop and phone
  width), not yet on a running box.
- After an archive restore or a Cloud restore the final screen does not show the device steps the
  bucket rebuild's shows (`rebuilt` is set only on the bucket path, `apps/setup/src/setup-app.ts`),
  although the first start re-issues the certificate for this machine's addresses after an archive
  restore too.
- After a refused Cloud restore the owner has to tick the Cloud screen's "old server and surviving
  peers are stopped" confirmation again: the shell shows the progress screen while the request runs
  and then draws a new Cloud screen, which starts unticked.

Task 10, the loop test against a real S3-compatible server and the documentation sweep
(#652): `apps/server/src/stream-loop.e2e.test.ts` runs the whole slice with the real pinned
Litestream against versitygw. Since lane A's A48 (#682), CI runs it and the pause test in `test-server-stream`,
the only job that installs both binaries, and `scripts/ci-workflow.test.mjs` checks that, reading
`ci.yml` as text, so a comment naming the commands, or a step an `if:` switches off, also satisfies
it. Left open:
- Locally the test is skipped without its binaries, and Vitest's default reporter shows that only as
  `1 skipped`; the reason shows under `--reporter=verbose`
  ([testing-guide.md](developers/testing-guide.md), "The stream loop test skips locally without its
  two binaries, and a skip reads as a pass").
- **DONE (lane A's A34, #665): a change to `scripts/setup-litestream.mjs` or
  `scripts/setup-s3-test-server.mjs` alone now selects `@waitron/server` and so its `test-server`
  shards.** Left open, found by A34:
  `scripts/changed-packages.mjs runnable` runs before the tests in the jobs of nine packages
  (dashboard, setup, till, bookings, fiscal-verifactu, media, payments-stripe, payments-sumup,
  venue-service), in the two-filter ui/ui-core job, and in `test-light-a` and `test-light-b`, fed
  from a pipe, so the guard does not count it and it is not listed; a change to it alone runs none
  of those jobs. Listing it against every member those jobs test would send every change to it
  through all of them — the owner's call.
- Linux is covered by one CI run only: #652's first (2026-09-25, run 36173603563), where each
  `test-server` shard's install step took about two seconds by GitHub's whole-second step
  timestamps, and the loop test passed in 15,989 ms with no test skipped in the merged report.
- **DONE (lane A's A37, #668): the pause runs end to end** in
  `apps/server/src/stream-pause.e2e.test.ts` ([testing-guide.md](developers/testing-guide.md), "The
  stream pause test"). Left open: whether a
  sale's write waited behind the fold-back, rather than landing before it, is not observed, and the
  fold-back of a 256 MiB file is still timed only by the bench rig (results note, 1b), not through
  the supervisor.
- **DONE (lane A's A130, #868): the pause test's one failure on `main` (run 36559470238, a frozen sale at
  1,228 ms against 1,000) was the CI runner's disk, not the bucket.** A probe reproduced it with one
  commit taking 1,017 ms while the disk stalled. The stream tests' CI step now sets
  `TMPDIR=/dev/shm` ([testing-guide.md](developers/testing-guide.md), "In CI their temporary files
  are in memory"). Found by the probe (only the last item, trace logging, is still open):
  - **MEASURED (lane A's A133, 2026-09-29): a sale waits behind Litestream's own checkpoint. The
    owner chose to narrow CLAUDE.md §5 now (DONE, A133, #889) and to measure switching off its
    timed checkpoint and moving its page-count one out of reach next (A135, below).**
    Litestream 0.5.17 holds the database's write lock for a PASSIVE checkpoint: it opens a
    transaction writing `_litestream_lock` around the checkpoint (`checkpointWithExecutor`, `db.go`
    lines 2492–2512 at tag v0.5.17). The probe (a throwaway branch, since deleted; workflow run
    36615242523, 12 GitHub-hosted runners, kernel 6.17.0-1022-azure) booted the real server on a
    provisioned venue and sold through `POST /api/sales` with one seller, one sale at a time, for
    150 s. Litestream ran with the product's own configuration, the bucket answering, and its log
    at DEBUG written to a file rather than a pipe, so the log could not stall it as trace level did
    in A130. Each write's wait for `begin immediate` was timed in the write queue. The slow disk
    was a device-mapper `delay` target: 10 ms per write, 100 ms per flush (50 synced 4 KiB
    writes took 6.9–9.4 s on it). Decided before running: if the stream cannot hold up a sale,
    writes wait under 20 ms to begin with streaming on, as with it off. Results:
    - Slow disk, streaming on: 14 writes waited 829–831 ms to begin (4, 5 and 5 in three runs), and
      each wait contained one of Litestream's `checkpoint mode=PASSIVE` log lines. Slowest sale 1.06
      to 1.32 s.
    - Slow disk, streaming off: no write waited more than 1 ms to begin; slowest sale 0.40–0.54 s.
    - The runner's normal disk, streaming on: 84, 104 and 100 writes waited 20 ms or more, each
      containing a checkpoint line; 248 of those 288 lasted 33–105 ms, and the longest 430 and
      629 ms.
      Streaming off: none above 1 ms.
    - No run met a 5-second `database is locked`, and every sale was answered 200.
    So what CLAUDE.md §5 said until A133, "the bucket stream … never blocks a sale", did not hold
    for the stream's local work: a sale waited for as long as Litestream's checkpoint held the write
    lock. Not measured: several sellers at once, where the write queue puts later sales behind the
    held one, and the box's own disk. CLAUDE.md §5 now says a sale can wait behind the checkpoint;
    no Litestream setting has changed. Since A142 (#898) the full figures sit in
    [testing-guide.md](developers/testing-guide.md), "A sale can wait behind Litestream's own
    checkpoint", and §5 keeps the rule, the longest wait on each disk and a link there; since A135
    (#907) it also says in one clause what A135 found, and since A135's close-out (#917) the
    owner's decision to leave the checkpoints alone.
  - **MEASURED (lane C's A135, #907, 2026-09-30, run 36657175716, probe commit `bc3b94671` on the
    throwaway branch `probe/a135-litestream-checkpoints`, deleted at A135's close-out, #917):
    switching off Litestream's timed checkpoint and setting its page-count one to a billion pages
    removed the wait on the delayed disk, but not on the runner's normal disk at about 80 sales a
    second. The owner chose to leave both alone (below), so no setting has changed.** The variant
    wrote `checkpoint-interval: 0s` and `min-checkpoint-page-count: 1000000000` into the database's
    Litestream entry (the page-count checkpoint cannot be switched off, as A133's review found:
    `db.go` line 788 at tag v0.5.17 refuses 0, and the pinned binary given 0 exited with
    `cannot open store: minimum checkpoint page count required`). A local pre-check with the pinned
    binary, in 20 s of writes, logged one Litestream checkpoint with the variant — an emergency
    PASSIVE one, run when the side file passed its 499,999,112-byte threshold — and no timed or
    page-count one, against 19 with the product's settings. Judged by A133's criterion, reused
    unchanged — writes wait under 20 ms to begin with streaming on — the variant met it on the
    delayed disk and failed it on the normal disk. In CI, three 300 s runs of each
    on each disk: on the delayed disk the variant removed the waits (none over 1 ms, against 12–13
    per run at 829–831 ms) and the slowest sale fell from about 1.08 s to 0.57–0.65 s, while the
    server paused the stream there and its own fold-back held the write queue for 278–294 ms per
    run; on the runner's normal disk the side file grew by 226–228 KiB a sale up to 256 MiB
    (1,138–1,155 sales; the testing guide gives how it was measured) and reached Litestream's
    emergency threshold (about 477 MiB) before the server's once-a-minute size measurement; 10
    writes per run waited 20 ms or more, the longest 430–729 ms per run, against 129–179 ms with the
    product's settings. Each of those 30 waits contained one of Litestream's emergency checkpoints:
    the 20 behind a PASSIVE one lasted 33–179 ms; every wait of 229–729 ms began 21–205 ms after
    Litestream logged `forcing truncate checkpoint` and lasted through that checkpoint and the
    snapshot Litestream takes right after it. The server
    paused the stream one to three times per run under the variant. The stream loop and stream
    pause tests passed three times each with it. Full figures:
    [testing-guide.md](developers/testing-guide.md), "A sale can wait behind Litestream's own
    checkpoint". Not measured: a venue's own sale rate, several sellers, the box's own disk.
    **DECIDED (owner, 2026-09-30): leave Litestream's checkpoints as they are; neither setting
    ships.** The owner was offered shipping the two settings, leaving the checkpoints alone, or
    first running A133's probe on the box's own disk, and chose to leave them alone (lane C's
    questions.md, A135).
  - Litestream at trace logging deadlocked sales for five seconds. The probe first ran it at trace
    level by mistake, and 13 of 24 runs failed with a 500. Each one looked at was `begin immediate`
    failing `database is locked` after 5,006 to 5,008 ms (runs 36571860113, 36572745451). The inferred
    mechanism: Litestream held the write lock while blocked writing its log to a pipe that only the
    server's main thread reads, and the main thread was waiting for that lock. At the normal level
    Litestream writes too little to fill the pipe; that is inferred, not measured. **Next:** check
    whether any setting lets an operator raise Litestream's log level, and read the pipe on a thread
    that does not wait on the database if so.
- **DONE (A37, #668): the pause's bucket question is bounded.** Each question (`#bucketAnswers`,
  `packages/stream/src/supervisor.ts`) now gives up after `READ_DEADLINE_MS` and the pause asks again.
- **DONE (lane A's A44, #676): the stream's other bucket calls are bounded for a bucket that
  takes the connection and never replies.** `createS3ObjectStore` sets the handler's
  `socketTimeout` to `BUCKET_IDLE_MS`, 30 seconds (`packages/stream/src/s3-store.ts`). Left open: an answer whose headers arrive within three
  seconds and whose body then stalls is not bounded (measured above); the deadline on the pause and
  the freshness read still cannot cancel a listing whose answer keeps arriving; the idle limit is
  per request, not per call, so a listing of many pages, or a bucket answering each request just
  inside the limit, can take longer; a bucket that takes more than 30 seconds to answer a request
  whose body is already sent, such as a delete of 1,000 keys, is cut off, and how long real
  providers take for one was not measured; and the tests run the handler's below-6,000 ms path,
  while its production path was measured by hand, not by a test.
- **DONE (lane C's C88, #920, 2026-09-30): the pause test's bucket control failed once on `main`.** CI
  run 36619928071 (head `573253221`, #885, which changed only `apps/server/src/order-groups.ts`, its
  test, the backlog and a plan) failed `test-server-stream`: at step 6 of
  `apps/server/src/stream-pause.e2e.test.ts` (line 540), the control `store.list("")` sent just
  after the test SIGSTOPs the bucket came back `answered` within the bound instead of
  `unanswered`. The next `main` run that ran the job, 36624117576 (head `7f0ad17f7`, which contains
  #885), passed it. Not re-run to green. **The mechanism, reproduced:** `startS3TestServer`
  (`apps/server/src/testing/s3-test-server.ts`) drew a port with `freePort()`, which releases it
  before versitygw binds it, and called the server ready once the port accepted a connection; every
  server it started had the same credentials and bucket name. The loop and pause tests run side by
  side in that job, each with a server of its own. Forcing a second `startS3TestServer` onto the
  first one's port (a mocked `freePort()`, real versitygw 1.8.0, macOS, 2026-09-30): the second
  start resolved with the first one's endpoint, its own versitygw had printed `bind: address
  already in use` and exited, a listing through its endpoint after its `pause()` was `answered`,
  and after the FIRST server's `pause()` the same listing was `unanswered`. Two versitygw processes
  on one port in `node:24-slim` (kernel 6.12): the second exited 1 with the same line. versitygw
  prints its "listening on" banner before it binds, so its output cannot mark readiness. **The
  failed run itself** does not show versitygw's output, so it is not proven to be this; but an
  `answered` listing needs a live server that accepts the pause test's credentials on its port
  while its own process is frozen, and the only other one in that job was the loop test's. How
  often a port collides: two processes each drawing 20,000 ports back to back in `node:24-slim`
  drew the other's latest port 0 times, so it is rare per draw. **The fix, in the harness only:**
  each server gets random credentials and is ready only once a listing signed with them is
  answered; one that exits with `address already in use` is started again on a fresh port, up to
  five, within the one `READY_TIMEOUT_MS`, each readiness probe cut to the time left in it; and
  `pause()`/`resume()` throw, with the server's log, once its process has exited, where they did
  nothing. **Tests:** `apps/server/src/testing/s3-test-server.test.ts`, which runs in
  `test-server-stream` and is excluded from the server shards (`scripts/ci-workflow.test.mjs`
  pins both). Its first three cases start versitygw; the other four run without it, three of them
  on a stub program. Before the fix three of the first four failed (the second server's endpoint
  equal to the first's; a start whose every port is taken resolving; `pause()` on an exited server
  not throwing). With the fix, each failed again with its own part taken out: the same credentials
  for every server (the first two cases), no retry on a lost port (the first two, the second by its
  draw count), and `pause()` silent on an exited server (the third). The fourth, a server that
  exits for another reason, is not retried; it passed before and after. The three stub cases each
  fail with one part taken out: the deadline reset per port, `exit` observed in place of `close`
  (so a bind error written after the exit is missed), or a probe allowed to run past the deadline.
  **Left:** the Waitron
  servers' own ports in the loop and pause tests are drawn the same way, and a lost one fails the
  boot loudly (`server.listen_failed`) rather than silently; not changed.
- **Open, left by #668 (A37): two things about the pause test and its deadline.** (1) The test's
  fill of the side file to 16 MiB took 82 s and 895 sales on CI (run for head `464d9eca7`) against
  its 180 s allowance, about 13 KB a sale, where a local run wrote about 79 KB a sale; why the
  growth per sale differs so much was not tested (Litestream's own checkpoints reusing the file is
  the guess), so if the test turns unreliable on CI that margin is where to look. **DONE for the
  shard time by lane A's A48 (#682):** the loop and pause tests run in `test-server-stream`, a job
  of their own ([ci-and-gates.md](developers/ci-and-gates.md), "The stream loop and pause tests run
  in a job of their own"). The growth-per-sale
  question stays open, with one more reading: on its own runner the fill took 283 sales and 16.9 s
  for 11,766,720 bytes, about 41.6 KB a sale, where the shard before the change took 745 sales and
  78.1 s (one run each). (2026-09-29: CI's stream step now keeps these files in memory, A130;
  fills measured after that were taken in memory, the readings above on disk.) (2) DONE by A44 for
  the deadline: a question given up at it logs
  `stream.pause_check_failed` with `errorCode: "timeout"`. **DONE by lane A's A51 (#686):** a
  refused question is logged once per pause with the refusal's code. **DONE by lane A's A57
  (#697):** that line, and the supervisor's other lines for a bucket request that failed, also
  carry the bucket's HTTP `status` when the bucket answered. A 2xx `status` means the bucket answered the
  request and the failure was found inside the answer — a file a batch delete refused (the
  `requestFailed` call in `packages/stream/src/s3-store.ts` that passes the answer's own status), an
  answer the store turned down as unusable (its `answerRefused` calls), or an answer the SDK could
  not read (an error-branch `requestFailed` call passing the thrown error's 200, whose `name` is
  `Error` — a listing cut off mid-XML at 200, sent through `s3-store.test.ts`'s scripted bucket in a
  probe not kept, was rejected with status 200 and `name` `Error`; not pinned by a test. Its line
  carried `errorName` `other` until A62 (2026-09-26) put `Error` on the list, and by reading
  `loggableErrorName` it carries `Error` since).
  **DONE by lane A's A60 (#703):** the line also carries `errorName`, the bucket's error name when
  it is on the fixed list in `packages/stream/src/bucket-error-names.ts` and `other` when it is
  not. **DONE by lane B's A62 (#707):** `backup.stream_request_failed`'s `name` from the S3 store
  is a listed name or `other`. No start
  was found that fails with that code, by reading: the boot-time bucket calls (`runFirstStart`,
  `StreamHost.start`) catch it and log the code alone, and a staged stream restore writes bytes
  downloaded before staging. One case was run: `boot.test.ts`'s "keeps selling when a restore's
  first start fails" boots against a bucket failing with that code and stays up. The recovery
  page's `server.boot_failed` detail was not tested with it. **DONE by lane A's A69 (#723):**
  `backup.stream_name_invalid`'s `value` for `field: "listedKey"` is the fixed word `other`, never
  the key the bucket listed, at both places it is built (the `list` in
  `packages/stream/src/s3-store.ts`, and `pruneGenerations` in
  `packages/stream/src/generations.ts`). The leak was run before the fix: `boot.test.ts`'s "keeps a
  key the bucket lists outside the folder asked for out of the answer and the log" sends the
  wizard's bucket restore to a local HTTP bucket whose listing names a key outside the folder, and
  with the key put back the answer and the log file's warning line both carried it (#723).
  **Open after #723:** the wizard route answers this refusal 400, where other bucket failures
  answer 502 — the status table in `apps/server/src/setup-api.ts` maps the code as one, and the
  same code also covers a bad value in the recovery kit, where 400 is right; and a batch delete's
  `backup.stream_request_failed` still carries the file's name as the bucket listed it in `key`
  (the `deleteMany` refusal in `packages/stream/src/s3-store.ts`). #723's review seat reported that
  the prune logger drops `key` and that it found no path from there to an answer or the recovery
  page's log; that is the seat's reading and one run, not a guard. Left by #686 and A57: that a real bucket's 403 to this LISTING reads
  that code, and the status on each line, were shown by reading `packages/stream/src/s3-store.ts`,
  by the store's scripted HTTP answers and by the supervisor's injected errors, not against a real
  bucket, and A60's `errorName` was shown the same way — its list was checked against Amazon's
  reference only, not against the names versitygw, the S3-compatible test server, gives its errors;
  and the case "refused while the run is stopping" catches a removed stop check only through
  the order two pending steps finish in, so re-run that removal if `#bucketAnswers` is restructured.

**Open: the images ship no notice file for the npm packages bundled into their JavaScript.** The
owner's rule (2026-09-24) is that a change adding third-party code to the image carries its licence
notices; the server bundles (`scripts/bundle-node.mjs`, esbuild), the three SPAs (`vite build`,
copied to `/app/web/`) and the print-agent bundle (`apps/print-agent`'s `build`, the same
`bundle-node.mjs`, copied to `/app/print-agent.js` in `deploy/Dockerfile`'s `print-agent` stage)
carry npm packages whose `LICENSE` files are left behind by bundling. The app image's
`/app/third-party/` holds notices for libvips and Litestream only, and the print-agent image's
`/app/third-party/` holds only `python3-minimal/`: the Debian copyright files of python3-minimal
and the packages its install added, and a `PACKAGES.txt` listing them (since A140; bluez's are not
copied). Measured 2026-09-24 in the
`chore/litestream-notices` worktree: `apps/server/src/bin.ts` bundled with `bundle-node.mjs`'s
options (esbuild 0.28.2, default `legalComments`, which keeps legal comments at the end of the file)
took in 81 npm packages, 76 of which have a `LICENSE` file, and the output kept one block of legal
comments covering 9 source files from 8 of those packages; `apps/till` built with `vite build`
(Vite 8.3.0) contains Lit, whose source opens with a `@license` comment, and its output holds no
`@license` or `/*!` comment at all. The other server bundles, the print-agent bundle and the dashboard and
setup SPAs were not built. Needed: a generated notice file for each bundle — the server's and the
SPAs' beside the Litestream one, and the print-agent's in the print-agent image.

**The SQLite slice-1 preparation tasks are all landed.** Column vocabulary (P1 — #390, #393, #394,
#396–#404, #408, #413, #414, #416); the `useVenueDb` test-helper conversion (P2 — every package
#421–#470, plus the rule and guard #473); the change log replacing `LISTEN`/`NOTIFY` (P3 — #477);
the one-statement job-claim helpers (P4a — #481; P4b — #483); money to whole cents (P5 — #475);
quantity and rate scales (P6 — #479); constraint-target refusals (P10 — #482); and the two-file
foreign-key split (P7 — #426).

**Task F1, the flip itself, LANDED as #489**: a venue is a directory of two SQLite files opened
through `node:sqlite`; there is no database server, no roles, no grants, no connection string and
no container.

**Task T1, the role-assumption sweep, LANDED as #490**: `asAppUser` and its call sites are gone.
**Task T2, dropping PostgreSQL from the dependencies and the dev stack, LANDED as #492**: the
cluster is out of the box and the dev stack. **Task T3, revisiting the coverage bars, LANDED as
#494** — the last task in the slice-1 plan, and with it slice 1 is done.

**What T3 measured, and why no bar moved.** The storage switch did not shrink the workspace, so a
bar that was meaningful in September still is; the numbers are in
[ci-and-gates.md](developers/ci-and-gates.md) → *What the storage switch did to the bars*.

**The two coverage questions T3 left open are ANSWERED (owner, 2026-09-23): every package goes to
the high bar, `98/98/98/95`**, which retires the 2026-09-05 split by consequence. The rest of the
work is tracked in **B9. CI and test infra** → *Every package to the high coverage bar*.

**What T2's review wave found, and it is the reason the run-it seat keeps its seat — OPEN as a
lesson, nothing left to fix.** `is_production` in `deploy/waitron.sh` **failed OPEN**, and the
caller wiped a production box with no `--force-production`; the fix's tests now extract the
one-liner from the shipped script and run it under a real `sh`.

Two things from T2 worth reading before T3 or anything near the box:

- **The box's throwaway state-volume containers no longer name an image.** They go through
  `docker compose run --rm --no-deps -T --entrypoint sh app`, so the helper is by construction the
  image the box runs — **and it therefore runs as an ordinary user where the old helper image ran as
  root, which is what made the fail-open below reachable.** The `--entrypoint` is not cosmetic:
  measured against the real app image, the old
  call shape appends its arguments to the image's ENTRYPOINT and BOOTS A SERVER, exiting non-zero,
  which `is_production` reads as "cannot establish" and then refuses every reset as production
  (since 2026-09-24 the entrypoint refuses the arguments instead of booting; still non-zero). The
  guard suite could not see it — its docker stub matched `*trading.env*` anywhere in the argument
  string — so the stub now models the entrypoint and a missing override fails behaviourally.
- **`docker compose up -d` does not remove a service deleted from the file**, and `waitron.sh`
  overwrites the installed compose file from the ref on every install. Without `--remove-orphans` a box
  upgrading past T2 keeps `waitron-db-1` running for ever on one warning line. The flag is on the
  install `up` and the reset's `down` and `up`; the retired `waitron_db` VOLUME is left on disk
  deliberately, and `deploy/README.md` says so and how to remove it.

**What #490 found and deliberately did not fix**, so T2 and whoever follows do not rediscover it:

- **Stale PGlite prose — DONE by T2** (#492).
- **The four helpers named after PostgreSQL — DONE (PR #524).**
- **Comments still describe a `DrizzleQueryError` wrapper that this engine does not produce**
  (found 2026-09-23 in PR #524's review). Several say drizzle wraps every failed query in
  a `DrizzleQueryError` whose own `.code` is undefined. On `node:sqlite` only `db.run` wraps (as
  `DrizzleError`, message `Failed to run the query '<sql>'`), while `db.all`, `db.get`,
  `db.execute` and an awaited query builder reject with the engine's own error
  (`packages/db/src/testing/errors.ts` records both shapes). Each site needs checking against the
  path it actually takes, then rewording. The candidates are what
  `git grep -n -i -E "DrizzleQueryError|drizzle wraps|Failed query" -- ':!docs'` prints, which
  also includes test fixtures that build a wrapped error by hand.
  #598 took it out of `packages/core/src/record-sale.test.ts` (a query builder there, which
  rejects with the engine's own error); #579 took the sentence out of `packages/shared/src/cause-chain.ts` and `engine-failure.ts`, and
  #585 out of `packages/db/src/schema/series.test.ts`; #589 reworded `packages/db`'s own copies
  (`deployment.test.ts`, `unique-violation.test.ts`, `testing/errors.test.ts`, `tenancy.test.ts`)
  after running both paths: through `db.run` a refused insert rejects with a `DrizzleError` whose
  `.cause` is the engine's error, through `db.execute` with the engine's error itself.
  (`packages/credentials/src/bin.ts`'s claim that the message carries the bind parameters went
  with #577, which measured a refused credential write: a plain engine error reading
  `CHECK constraint failed: …`, with no SQL and no parameter.) The thrown text
  in `packages/db/src/testing/errors.ts`'s `engineErrorMessage` names the old wrapper on purpose
  and is pinned verbatim by its test.
- **The discarded `cfg` parameters — DONE (PR #516).** Other `void cfg` lines remain in
  `apps/server/src` (`git grep -n 'void cfg;' apps/server/src`), unchanged. Some are `asApp` test
  helpers of the same shape as the one fixed; the rest are other test helpers and production
  functions (`apps/server/src/working-order.ts` holds several) that take `cfg` and discard it.
- **Three dangling pointers — DONE (PR #516), with one left on purpose.** LEFT:
  `packages/db/drizzle/0001_behavioural_triggers.sql` still points at
  `origin/main` for the originals, because editing a shipped migration, even a comment, changes its
  hash (measured with drizzle's `readMigrationFiles`: `fba827e45a74…` became `518ac94a3346…`), and
  the boot path's ahead check reports a database hash the image does not ship
  (`packages/provisioning/src/schema-ahead.ts`), so an already-migrated box would read as ahead —
  traced, not run. Also left: the
  pointers in shipped `drizzle/` SQL, such as `packages/media/drizzle/0001_image_references.sql`
  and `packages/db/drizzle/0001_behavioural_triggers.sql`, for the hash reason above.
- **`packages/scheduler/src/migrations.ts` and `packages/identity/src/migrations.ts`'s core-first
  claim — DONE (PR #516).**
- **The grep receipt in `apps/server/src/promote-endpoint-e2e.test.ts` — DONE (PR #516).** The
  block is now only the gap it
  leaves — nothing shows a refused promote write fails closed, and no test asserts
  `promotion.failed` — so the same grep prints nothing and exits 1.

What the preparation tasks left, with F1's own answers where it found them:

- **How the drain crosses the two database files, given `change_log`'s `local` classification —
  SETTLED by slice 2 (#548): every table stays in `venue.db`.** SQLite refuses a trigger body that
  writes another attached database, so if a later slice moves `local` tables into `node.db` (slice
  2's design reserved it for slice 5), that slice decides this again — either `change_log` is reclassified
  to the file its writers live on, or the triggers stop writing it directly and something above
  them does (P3).
- **The three claim helpers were stripped, and two of them had become identity functions — CLOSED by
  T2.**
- **`packages/printing` reported an out-of-range `character_table` as a `transport_fields` problem —
  FIXED by #489 (the SQLite switch); nothing left to build.**
- **No guard holds a MODULE migration set to its declared schema — LANDED as PR #491** for
  `catalogue`, `payments`, `workforce` and `workforce-es`; see **B9. CI and test infra** above.
- **Two coverage gaps under a 5-second default bound — CLOSED (#482 and #509).**
- **The working-time chain's retry has the same untested middle — CLOSED (#564).**
- **Stale `vitest.config.ts` comments — DONE (branch `chore/vitest-config-comments`).**
  - Follow-up: every other `maxWorkers: 1` config whose comment gives the coverage reason, apart
    from `payments`, which carries its own measurement, still says the pin is needed without having
    measured it; the same one-worker-against-several coverage comparison would settle each.
- **Dead code and doc sweeps owed to the rollout's final sweep** — **DONE** (PR #516 and dated notes).
- **Deferred cleanups, each with its reason in its PR**
  - P7's three (#426) — **DONE** (PR #533): `scripts/migrations-match-schema.test.ts` fails when a
    schema edit was never generated. Left, found while doing it: `no-tenant-column`'s SQL check still
    passed with one set's SQL dropped, because it checks for an absence and the remaining files
    clear its floor of eight. `module-graph-honesty`, `schema-constraints` and
    `packages/db/src/classification.test.ts` still read a set's SQL their own way — the top of the
    `drizzle` folder only, and `module-graph-honesty` unsorted — rather than through
    `migrationSqlFiles`, which walks subfolders; no set has SQL in a subfolder today
    (`find packages apps -path '*/drizzle/*/*.sql' -not -path '*/node_modules/*'` printed nothing,
    2026-09-23), and drizzle's migrator applies only `<folder>/<tag>.sql` for each journal entry.
    `journal-monotonic` parses `_journal.json` itself rather than sharing `headSnapshot`'s reader.
  - P5's three (#475) — **one DONE, one moot, one still declined, for a restated reason**
    (PR #531). **Done:** the two-call write conversion is now one helper per scale
    (`stringToCents`, `stringToThousandths`, `stringToBasisPoints`), the fiscal record builders
    included (PR #535). **Moot:** no `.pg.` file is left in the tree. **Still declined, reason
    restated:** writing `moneyNum` in `packages/workforce-es/src/convenio.ts` as `cents / 100`. The
    value is the same. What it would change is where the money scale lives: the conversion
    from a count of cents belongs to `packages/shared/src/cents.ts` (CLAUDE.md §3's money rule),
    and a `/ 100` puts a second copy of the scale outside the files
    `packages/shared/src/conventions.test.ts` checks. **Found in #531's review — DONE (PR #583):**
    `decimalToCents` checks the bound on the amount rounded to cents, so `"999999999999.995"` is
    refused with `shared.decimal_overflow`.
  - P6's three (#479) — **two DONE, one declined with its reason re-measured** (PR #529).
    **Declined:** one constant for the `10000` literals. Four sit in check constraints, and only
    `sql.raw(String(n))` renders the number there; a constant that works only through `sql.raw` is
    a trap for the next tidy-up, so the literals stay. **DONE (PR #583, owner decision):**
    `rawThousandthsToDecimal` reads a total past nine integer digits; one quantity is still bounded
    at nine. **DONE (lane A's A32, PR #662):** `assertMoney` is deleted; the money bound is
    `decimalToCents`'s.
  - P4a's hand-written holder/waiter contention scaffold and its slow lock-clause negative control —
    **no longer applicable**: #489 deleted the PostgreSQL suite both lived in.
  - The P10 shared refusal helper — **DONE** (PR #527): `refusalError` in
    `packages/db/src/testing/refusals.ts`. A few other suites still build
    engine-shaped refusals by hand, among them `packages/provisioning/src/cli.test.ts` and
    `packages/scheduler/src/store.concurrency.test.ts`; converting them was not part of P10.

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
**A demo database created before #329 (or #307) must be reset with `wa-wt reset demo`** — the card-reader migration was
edited in place and #307 changed `0014`'s drizzle hash, so an older schema fails the ahead-of-image
check.

---

## Standing decisions

From the 2026-09-05 whole-project design review and since. They supersede older spec text where they
conflict.

- **One tenant per database everywhere, the cloud included, and the schema carries no tenant
  column** (2026-09-14; the column removal LANDED #378, 2026-09-16). A tenant is one taxpayer
  (`country` + `tax_id`), held as the single row of
  `tenants` with its `id` pinned to 1, owning all of its locations. Nothing filters a query by a
  tenant; a query that wants "this tenant's rows" reads the table. Guard:
  `scripts/no-tenant-column.test.ts` (text-matching, and blind to test files and to the historical
  core migrations it exempts). The cloud is a dedicated instance per tenant, hosted in Spain. Density comes from many
  isolated instances per host. The only multi-tenant pieces are a small control plane and the
  preproduction trial demo. **What an instance contains changes with the storage switch** (2026-09-16):
  a server process and a SQLite file streamed to object storage, not a PostgreSQL server — the
  per-tenant isolation this decision is about is unchanged.
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
  WireGuard link without terminating TLS. (The PostgreSQL replication that used to ride this link was
  deleted 2026-09-19. Since slice 2 (2026-09-25) Litestream streams the venue database to the
  owner's bucket, not over this link; a promoted node following that stream is future work — see
  *Afterwards*.)
- **Handheld kiosk mode is optional, never required** (owner, 2026-09-08) — the baseline is an
  installed home-screen web app plus the till's staff PIN. **The venue OWNS the handhelds** (owner,
  2026-09-18, reversing "most waiters use their own phones"): a member of staff's broken phone is the
  venue's liability, so lockdown and a certificate install are available again. Buy a cheap Android
  with an autofocus camera, plus a spare; NFC is optional and Android-only. Decisions and receipts:
  [2026-09-18-handheld-and-till-hardware-decisions.md](superpowers/specs/2026-09-18-handheld-and-till-hardware-decisions.md).
- **Comments carry invariants, not history, and deliberate pruning sweeps are wanted** (owner,
  2026-09-23; CLAUDE.md §1) — see B9 → *Prune the comments*.
- **The coverage bar is negotiable only where the rest of a package's gap could be closed solely by
  tests that assert nothing useful** (owner, 2026-09-23, narrowing the 2026-09-05 "negotiable with a
  reason"): "we never want to add junk tests just to meet a coverage bar. the tests added must
  actually test something useful."
- **Every package and the root project hold the high coverage bar, `98/98/98/95`** (owner,
  2026-09-23, superseding the 2026-09-05 split that reserved it for the fiscal core and the data
  layer); the lower floor was retired 2026-09-24 — see B9 → *Every package to the high coverage
  bar*.

---

## What's built (state per sub-project)

Architecture §2's twenty sub-projects, plus the cross-cutting infra. "Remaining" is the unstarted or
partial scope; the detail for a live thread is in its track.

| # | Sub-project | State | Remaining |
| --- | --- | --- | --- |
| 1 | Design system | `@waitron/ui` token layer + primitives (`--wt-*`); brand assets (#284); the till web-app manifest and its icons; the dashboard shell restyle — collapsible nav, account menu, profile modal (#333) | `wt-select` (A7) |
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
| 18 | Menu/recipes/allergens | EU-14 allergens, recipe/BOM allergen inheritance, recipe-authoring UI (**withdrawn from the dashboard by #345**; declarations are now direct on the product), product images, location↔menu membership, extras and options lists end to end (the legacy option groups are gone — Task 13 dropped their tables), per-option and dish-line quantity, dietary classification, order-line customisation; departments and menus (#297) | counter/walk-up kitchen fire; menu draft/publish + schedule; customer-facing menu surface parked; nested sub-recipes / plate costing / stock depletion parked |
| 19 | Opening hours & channel sync | — | not started (Google Business Profile / Maps) |
| 20 | Procurement & inventory | received purchase invoices (`@waitron/purchasing`, feeds modelo 303) | suppliers/POs/goods-in/stock/3-way reconcile/reorder (parked); AI forecast deferred |

**Cross-cutting infra:** replication (native Postgres logical replication, #280 — DELETED 2026-09-19;
no node replicates to another until slices 3–5 rebuild failover) · membership, promotion and rejoin
(the arc was completed on PostgreSQL, #197–#272; what the deletion took out of it is under
*Replication, membership & failover — residuals*) · backup and restore (BR-1..BR-4 plus the wizard
and guided Cloud snapshot restore for test venues) · SIF
topology (`#33`, `node_id` re-key) · the module system (#212–#262; country packs #292) · the printing
subsystem (`@waitron/printing` plus the db-free `@waitron/print-agent`, #282–#335) · the layout
designer and device profiles (#194–#234, #246, #269) · CI and test infra (scoped CI, pre-push hook,
shared-container tests, job-sharding, root scope) · localisation (per-user `persons.locale`, live
language switch, venue-default derivation) · logging and diagnostics (Slice 1, #192).

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

The 2026-09-12 owner walkthrough's five findings all closed with #334 (the reasoning is in that PR
thread); live A2 work is under *A2* in Track A. What is worth carrying forward, because it constrains
the next change to the wizard:

- **Detection must PROMOTE the match, not pre-open it in a full list.** The matched guide is now
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
  contribution and is editable after setup on the dashboard's **Location invoices** screen, applying to
  records filed from then on and leaving already-filed records alone.

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
  creation (a stored token in `@waitron/credentials`).
- **Hardening carried out of Slice 1, for Slice 2:** a key-name allowlist on the client trail's
  redaction (it filters by value TYPE only, so a secret string under any key passes) and scrub
  `message`/`stack` from rejected Errors; `maskPath` masks UUID and all-numeric segments only — mask
  slugs and emails too; route the dashboard's boot-probe-fail, post-login and logout transitions
  through the nav trail; roll the trail and report button out to `apps/setup`.
- **Owner decisions 2026-09-24 — crash and freeze reports, and where reports go.** These extend
  Slices 2 and 3 and replace one part of Slice 3; design them together before building:
  - **Reports go to Waitron Cloud, which files the GitHub issue.** Slice 3's "stored token in
    `@waitron/credentials`" is replaced: the box holds no GitHub credential. The box sends through its
    signed-in Cloud client (`apps/server/src/cloud-client.ts`, #582); Cloud (the separate
    `waitron-cloud` repository, being built) files the issue and groups reports with the same stack
    into one issue with a count. Open: what a venue not connected to Cloud is offered.
  - **The repository is public**, so the public issue carries only the stack, the Waitron version and
    the error code. The venue's identity and anything a person typed stay private in Cloud, linked
    from the issue.
  - **Automatic reports as well as the manual button.** A crash that reaches the recovery page, an
    unexpected server error, and a frozen process stopped by its watchdog (lane A's A18d writes one
    JSON report file per event on a persistent volume, outside the venue database) each become a
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

The restore hook is SP-3d (#248); the wizard is #295. Landed: the storage
abstraction, fan-out and AES-256-GCM artifact encryption; the single encrypted archive and the module
`backup` contribution; the restore consumer; a filing node's restore minting a fresh chain and disjoint
series; the dashboard wizard. The image ships with backups OFF, deliberately.

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

**2026-09-19 — the PostgreSQL replication code (#280) is no longer in the tree (slice 1, task
P8).** `packages/sync` and the request
paths built on publications, subscriptions and the fence-LSN watermark were deleted, because slices 3
and 4 rebuild failover on a different mechanism
([the topology design](superpowers/specs/2026-09-16-sqlite-litestream-topology-design.md)) and none of
that machinery survives the change; keeping it compiling in the meantime would mean carrying code that
does nothing for several slices. **From here until slice 3 a venue has ONE node and no failover at
all.** The "MVP for go-live" requirement of two boxes plus cloud failover is met by slices 3–5, not
before, and it is accepted for exactly as long as Waitron is pre-production. What stayed, because none
of it depends on how PostgreSQL replicates: `packages/membership` whole (documents, signing,
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
  an irreversible step, that every row this node originated had reached the carrier — the fence-LSN
  watermark against the carrier's replication slot. `node.retire_carrier_changed`,
  `node.retire_carrier_attached`, `node.retire_not_drained`, `rejoin.carrier_attached` and
  `rejoin.not_drained` were deleted with it. What survives is membership-only: `retire_not_fenced`,
  `retire_no_carrier` (now a direct `servingPrimaryNodeId` check), `retire_superseded`,
  `rejoin.not_fenced` and `rejoin.no_carrier`. So a fenced node can now self-evict, and a returned box
  can now be wiped, without any proof its tail was carried forward.
- **`rejoin --accept-loss` waives nothing today.** The flag and its `rejoin.accept_loss` warning are
  kept so the operator's acknowledgement survives the switch, but the drain confirmation it used to
  waive is gone.
- **Adopt copies no data, and an adopted mirror can no longer leave adoption-pending.** Adopt stamps
  the mirror's identity and config and writes the finish-adoption latch; the initial COPY that used to
  bring the venue's rows went with the subscription. `runFinishAdoption` now tries to establish the
  reserved identity on every boot instead of polling for a copy to finish — and that attempt cannot
  succeed, because the standby's own `nodes` row references a `locations` row the mirror does not have
  and nothing supplies. **Operator-visible consequence:** a box
  that adopts stays in adoption-pending boot for good — `/api/box/status` keeps answering
  `adoption: pending`, no mirror session or node-scoped read path is ever mounted, and each boot logs
  `adoption.establish_failed`. The full account is in
  `apps/server/src/finish-adoption.ts`'s `PendingAdoption` header; whatever replaces the initial copy
  in slice 3 has to close this.

- **OWNER DECISION, open since #443: should the setup wizard still OFFER "Add a mirror node"?** The
  wizard's copy was made honest rather than the option removed — `apps/setup`'s role, connect and done
  screens now say plainly that joining does not work in this version and that the box ends up holding
  none of the restaurant's data, with no till and no dashboard, and the done screen no longer offers a
  reload button that would have landed on a bare 404. But the option is still there and the flow still
  runs, so an operator can still spend a box on it. Removing or disabling it until slice 3 lands the
  replacement is a product call, not a wording one, so #443 left it alone. Whoever takes it should
  decide for `apps/setup/src/screens/mode-screen.ts`'s mirror card and the `role-screen` card together.

- **Re-admission `sell-only → serving-secondary`** — the primary-minted un-fence that makes a rejoined
  box sell again. Must retire the node's previous chart entry and delete its live `fiscal.aeat` row.
- **The membership chart fills up, and not every entry can be cleared.** It APPENDS, every
  wipe-and-re-adopt mints a fresh nodeId, and `MAX_NODES = 8` (`packages/membership/src/verify.ts`)
  caps it. Since A63 (2026-09-26) a full chart no longer produces a document no node accepts: the
  mint refuses it (`membership.chart_too_large`) and the primary refuses the join
  (`mirror.membership_full`). An admin can clear a REMOVED (`evicted`) machine to free its place,
  from the Servers screen. What stays open: only an `evicted` entry can be cleared, and A61's
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
  point-of-no-return is a durable pg commit, so a power cut between the env write and the commit could
  reboot a box `mode=primary` still carrying the primary's series. Fsync the env write or resolve the
  series at boot — and selling must gate on REBOOT COMPLETION.
- **Getting the AEAT certificate onto a promoted standby needs a new design.** The
  [2026-09-07 design](superpowers/specs/2026-09-07-fiscal-cert-distribution-design.md) landed as #279
  and was reverted by #281 when Postgres replication changed how a standby is adopted, and that
  replication was itself removed on 2026-09-19 — so the design and its plan describe a mechanism that
  no longer exists. Redesign it with slice 3. Installing or renewing the certificate on the primary
  does not wait for this (A9).
- **Still owed after the cert-distribution rebuild:** the restore-onto-cloud re-encrypt; a dashboard
  promote UI; an a11y test for the break-glass panel.
- **Mirror fidelity** — `adoptVenue` nulled `locations.catalogue_id` and `tills.receipt_printer_id`
  under the outbox adopt; re-check what the native initial COPY leaves.
- **Carry-ins, accepted or to be stated in a threat model:** the primary burns an installation number
  per bundle fetch; provision and adopt are assumed mutually exclusive per box; `establishNodeIdentity`
  must run once per node before any document is signed; the membership private key is decryptable by
  the `app_user` pool, as `fiscal.aeat` is; on the first boot after returning, a node runs as its
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
| Q27–Q29 (paying a bill in parts, a table that leaves without paying, how a comp or discount shows) | parts: server built (#721), the till does not use it yet; comps and discounts built (#916); leaving without paying waits | **send now** — service plan Task 17 waits on Q28 |
| Q31 (correct an issued ticket by differences or by substitution) | `recordCorrection` files by differences (`"I"`); no route calls it | needs advisor before the correction screen is designed |

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
the reason that is left is the
`@vitest/coverage-v8` cross-fork branch-merge artifact, which needs `maxWorkers: 1` where a small
package runs under `pnpm -r` oversubscription — the worked reasoning, once in `packages/payments`'
config, is in #558's first commit message (2026-09-24).
`packages/db` keeps `maxWorkers: 4`, which CI's `test-heavy` shards inherit because they pass no
worker count of their own.
Either way a new package that copies one of those configs must hold `98/98/98/95` (CLAUDE.md §2) —
anything else and `scripts/coverage-thresholds.test.ts` fails it in the ungated `lint` job.

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
| [Menus, sections and home layouts](superpowers/specs/2026-09-20-menus-categories-and-home-layouts-design.md) and its plan | built (#729 last); owner decisions still open | Track A (menus entries) |
| [Service, ordering and billing](superpowers/specs/2026-09-20-service-ordering-and-billing-design.md) and its plan | 11 of 18 tasks landed; Task 13 done on a branch | A4 |
| [Sales classification](superpowers/specs/2026-09-25-sales-classification-and-category-reports-design.md) and its plan | built (#738 last); a code comment points at it | Track A (classification entries) |
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
