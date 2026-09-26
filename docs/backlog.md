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
test-server Cloud replacement path has landed (#638). Observations are synthetic until service
adapters exist. Cloud owns the two-server WireGuard/HAProxy proof, bot gate, DNS override, gateway
replacement and revocation.

Open:

- Customer remote setup UI and production deployment remain open.
- Shutdown waits for an in-progress local database copy or encryption step. Next: measure that
  shutdown latency, real venue uplink budgets and spool disk use, and stream archive assembly beyond
  its current in-memory 512 MiB format limit. Cloud documentation: `docs/authenticated-captures.md`
  in waitron-cloud.
- After a Cloud replacement (#638), installing the new tunnel and TLS certificate remains an
  operator step. Continuous complete-server recovery, planned final-write handover and production
  recovery remain open. Cloud owns route placement and fencing in its backlog.

The Litestream stream's sealed-state restore and activation still need integration with Cloud
storage and owner recovery. Connected does
not mean those services are configured. Cloud service ownership stays in the Cloud
backlog; this repository owns its adapter, screen and node-side behavior. Public
hosting, ingress controls and Cloud audit/retention remain deployment work.

## What to work on next

Ranked 2026-09-12, with the reason for each place and the track it belongs to. Each item is its own
brainstorm → spec → plan → PR; fiscal-adjacent ones take owner sign-off at land.

1. **The till does not load its menu until a manual refresh** (A4). Seen on the blank-box-to-selling
   run; the box and sale path worked.

2. **Somewhere for things that went wrong to show up** (A5) — the alerts framework and recorded
   incidents LANDED (#363, #368), and the ongoing checks (#371). What A5 still lacks is the pairing alert ("devices tried to join") and a standby that has
   fallen behind; see A5.

3. **Backups that leave the box** (B2) — S3 first, then Drive. With the mirror deferred, a bucket is a
   standalone primary's only off-box copy. The bucket stream of `venue.db` is built (slice 2); the
   archive's S3 backend is not — only `LocalFsBackend` exists for archives.

4. **The displays and the printers walked at the real box** (A4, A3) — till, handheld and KDS through
   [ui-review.md](ui-review.md), and the first physical print since #327: slips, duplicates, the
   drawer pulse, the feed-before-cut. #689 printed calibration samples and a sample receipt on the
   owner's NT-806 and fired its drawer from the calibration test; a real sale's slip, the duplicates,
   the cash-settlement drawer job and the feed-before-cut are still unwalked.

5. **The bootable USB installer** (B3) — the last piece of "install without a terminal".

Then the on-prem mirror, then the cloud primary — under *Afterwards*. Everything else ranks beneath
these.

---

## Track A — UI and application

What staff and the operator touch: `apps/till`, `apps/dashboard`, `apps/setup`, `packages/ui`,
`packages/layouts`, `packages/identity`, the dashboard-, till- and setup-facing routes in
`apps/server`, `packages/printing`'s dashboard side, `packages/payments*`. Numbered in priority
order; the small items at the end of each area live in Track C.

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
**Classification Task 2 landed as #648 (2026-09-25):**
every till filing path records each sale line's product, a variant's parent, its menu, its gross
and its reporting chain and labels when the record is issued. `sale_lines.menu_version_id` stays
null on every line until the menus plan's Task 7 (sell from the published version) fills it; that
task wires it, because it lands second.
Two follow-ups it leaves: the till shows "try again" when `sale_classification.invalid` refuses a sale (it happens only on corrupt category data, and retrying cannot succeed), so the code wants its own till message on the permanent-refusal list; and a card recovery refused that way leaves a captured payment unlinked until the catalogue is fixed, as recovery's existing below-locked-total refusal already does. The demo seed (`apps/server/scripts/demo-seed/seed-sales.ts`), the other scripts that call `recordSale` directly (`record-one-sale.ts`, `settle-invoice-first.ts`, `daily-close-demo.ts`, `daily-close-z-demo.ts`, `modelo-303-demo.ts`) and `apps/server/src/fiscal-readiness-runner.ts` file sales without the issuance pass, so seeded demo lines carry no product id, classification or gross, and the spec's category reports would show every one as Not recorded — classification Task 3 cannot measure its reports on seeded sales until the seed records them.
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
`DELETE /management-api/catalogues/:id/items/:itemId` (`deactivateMenuItem`) still switches a
product off but the dashboard no longer calls it, since `PATCH` now carries `active` (and since menus
Task 5 nothing calls `GET …/catalogues/:id/offers` or `POST …/catalogues/:id/items` either: all
three routes and their tests stay until someone removes them); and
`sections_owner_menu_fk` still has no delete rule (Task 1's note stands) — nothing deletes a menu
today, so it bites only when something does. A product reached through a section offers no extras
list; that was already so before #659 (checked at `002b79f69`).
**Menus Task 4 (the Menus screen), landed as #664 (2026-09-26):** **Products and recipes → Menus**
(`/manage/menus`) lists, creates and renames menus; a menu's Structure tab shows and edits its whole
tree; and creating a product on the Products screen ends with an optional "Add to menus" step.
Left, none blocking: `POST /management-api/catalogues` accepts a blank
name (read, not run; the rename route refuses one), so the screen's own check is the only guard on
create; "New section here" asks only for the internal name, so a section's customer names, image
and colour are still edited on the Sections screen; which section is being edited is not in the
address, only the menu and the tab; and opening "Add to menus" sends one `getMenuStructure` request
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
inputs.
**The Prices tab shows variants, price ranges and a choice of columns, landed as #680 (2026-09-26,
the owner's answers to #670's FYI):** each product's Active variants are rows under it, a product
sold only as its variants shows price ranges, #541's struck-out "Price on this menu" column is kept
but hidden by default, and `wt-data-table` gains a column chooser remembered per browser in
`localStorage` under `<viewKey>:columns`. Left,
none blocking: the stored key uses a colon (`waitron.menus.prices:columns`) where every other stored
key uses dots or dashes — cheap to change until a venue is live; a variant row is announced by its
name alone ("Glass"), not with its product's, relying on the tree's level; and, from reading only, a
Columns panel wider than a very narrow screen would not shrink to fit, and is not re-placed if the
window is resized while it is open.
**Menus Task 6 (publishing), landed as #677 (2026-09-26):** a menu can be published: publishing
freezes the menu's working state as a numbered version in `menu_versions`, which can never be
changed or deleted, and points `menu_publications` at it; the Menus list shows each menu's status and
a Preview tab words each change and publishes the one menu. **Tills still
sell from the working state until menus Task 7.** **M6c** (#705, 2026-09-26): an extras item's photo
is in the frozen copy, so changing it flags every menu offering it; deleting a product flags its
menus; and the Preview tab shows the whole proposed menu below the changes. A version published before M6c has no photo on its extras items, so each
menu with extras shows unpublished changes until it is published again. Left, none blocking: after a
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
**Menus Task 7b landed (#696, 2026-09-26): editing a saved order — the server rules.** An edit keeps
each line's locked price and prices only what it adds; every change to work the kitchen has is a
recall or a void recorded as a kitchen notice; an order carries a revision, so an edit made from an
older copy is refused; and a second device cannot change an order while a card payment of it runs
(D22). Owner decisions applied:
a partial split takes its own copy of the kitchen ticket and a started line may be split (D10 and
Review Focus 6 overturned); moving sent work to another table prints a MOVED slip and records a
`moved` notice; held kitchen work cannot be split onto a check (`tab.split_held_line`) — decided by the owner 2026-09-26 as the safe behaviour until the service plan's Tasks 14 and 15 (lane B's B14/B15) let a guest pay for one held item against the table's bill. The core
migrations add five columns and replace the `working_orders_enforce_transition` trigger, and
venue-service adds `kitchen_notices` and `service_settings`; the upgrade succeeds, but
rows written before it misbehave (a dish sent before the upgrade counts as unsent, an extra saved
before it blocks a one-line edit) — the PR has the measured table; settle open orders or reset
before upgrading. Still open: the `changed`
notice kind is declared but nothing writes it (the kitchen screen renders it since Task 7c).
**Menus Task 7c landed (#710, 2026-09-26): changing a sent line from the till, and kitchen-screen notices.** The table
screen offers Change on a sent line the kitchen has not started, a recalled line and a line with no
kitchen route; it opens the existing option, extras and note editor prefilled from the line and saves
through the one-line edit route with the order's revision. A started line keeps Cancel only; Cancel
is now offered on a queued line too, and a line of several whole units asks "Cancel 1" or "Cancel
all". With the venue's "allow changes to items already sent" setting off, Change and Recall are
hidden on sent kitchen work. The tab-lines answer (`GET /api/working-orders/:id/lines`) now carries
that setting, and each line when it was released, its note, its offer and its parent product. A
change or recall the server refuses because the kitchen has started the item, or because the venue
does not allow changes to sent items, says so in its own words (a change also names an unavailable
product or an order changed elsewhere); most other refusals, such as a tab that is no longer open,
show the generic error. A change answered after the waiter has moved to another table names the dish and the table instead of acting on the wrong order. The kitchen screen
shows the station's notices above its queue (kind as a word and an icon, "started", the new note, the
table a line moved to), each with an acknowledge button, and re-reads its queue every 15 seconds; a
refresh read that has not answered after 25 seconds is cancelled. No migration. Left open: a notice carries no unit, so a
weighed line's notice reads "0.5×" without "kg"; the counter's prep-queue card shows no notices and
does not refresh; a failed kitchen refresh is silent, so a display that loses the server goes stale
without a warning; the till's API client has no general request timeout (only the kitchen refresh
reads are bounded); a refusal that lands after the tab is paid, or after a server switch, shows the
ordinary unnamed message; the till's screen-to-app events use plain names, while
[conventions-ui.md](developers/conventions-ui.md) says every custom event is `wt-*` — the rule or
the till needs to change.
**Menus M7b3 landed (#713, 2026-09-26): an unpaid split bill goes back on its tab.** When the
waiter leaves a separate bill made with "Split by item" without paying it, the till that made it
merges it back into the table's tab (`mergeTabs`; the kitchen is told nothing). Every other case
leaves it in the counter's Held orders, where it can be paid — run end to end in real Chromium
before building, as the PR records. No migration. Left open: if the waiter leaves before the split
itself answers, the bill arrives after they have gone and is not merged back (it stays in Held
orders); and the counter's Held orders list shows every open order, a table's own tab included
(seen in the same run, not investigated).
**M7b2 landed (#702, 2026-09-26): a manager can clear a card payment a crash left running.** The
Payments screen lists open orders locked by a card payment nothing is finishing any more, and "Check
with the card provider" files the sale once if the card was charged, marks the payment failed and
unlocks the order if it was not, and refuses if the provider is unreachable or unclear; each
resolution is recorded in the append-only `payment_resolutions` table. What it leaves open is under
"What M7b2 left open" in the payments section.
Next in the lane: 7 (M6c landed as #705), then M7v. The owner lifted the wait: the dependency upgrades are
finished, and the work does not wait for SQLite slice 2. The menus plan's decisions D1–D23 settle
the spec's open integration points; D6, D9, D10, D11, D12, D13 and D22 are the ones flagged for the
owner. Menus Task 3 wipes existing venues (it rebuilds `menu_items`); every other migrating task
adds tables or columns only and measures its own upgrade. Every dev venue then needs
`wa-wt reset demo <name>`, and the owner's box should be wiped once after menus Task 7 lands.
Do not upgrade the owner's box mid-plan.
A note Task 2 leaves for Task 3: the image library links every `section` use of a photo to
`/manage/sections?section=<id>`, but that use can also be a list a menu owns, which the sections
screen does not list and so does nothing for. So when Task 3 lets a menu's list carry a photo, link it to the menu editor or
narrow the link to library sections.

**A joined tab's kitchen slips can name a table its ticket did not print.** Correction and MOVED
slips name a joined tab's lowest-id table (`readOrderHeader`, `apps/server/src/kitchen-print.ts`),
so after a join a MOVED slip's "from" can name the other table; recording each ticket's printed
table would fix it.

**A line moved onto a split CHECK cannot be voided from the check.** `voidTabLine`
(`apps/server/src/working-order.ts`) calls `assertAnchoredTabOpen`, which refuses `tab.not_open`
for an open order no table points at, and a check is exactly that; `voidTabLine` did the same on
`main` before menus Task 7b. What Task 7b adds (owner decision 2026-09-26): a part of a line the
kitchen has started can now be split onto a check, so the kitchen's made-but-cancelled part cannot
be voided there. A check can be merged back into its tab (`mergeTabs`, "tells the kitchen nothing
when a check merges back into the tab it was split from" in `apps/server/src/split-bill.test.ts`).
**Decided (owner, 2026-09-26):** a check gets no Void. The till pays a check straight after
"Create bill", so a dish being cancelled is voided on the TAB first; a change of mind in between is
covered by merging the check back. Since menus M7b3 the originating till does that merge itself when
the waiter leaves the check unpaid (Back to floor, another screen tab, or another table). After a
reload, on another device, after logging out, after a server switch, while the check is being
paid, or when the server refuses the merge, the check stays in the counter's Held orders, where it
can be paid; when the merge gets no answer the till says it cannot tell which of the two places the
check is in.
The durable link between a check and its table is lane B's visits (service plan,
`docs/superpowers/plans/2026-09-26-service-ordering-and-billing.md`), not a new column.

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
  kitchen routing rules instead (menus spec §10.5).
- **A category's colour is stored but shown nowhere outside the categories screen.** Nothing on the
  till, in menus or in reports reads it yet. The colour is data a future consumer can follow; nobody
  has decided whether or how one should.
- **No "category dependants" seat exists on the module contract.** The delete-preview route
  (`GET .../:id/dependants`) is core-catalogue-specific; a module that wants its own kind of
  dependant (beyond products, child categories and preparation routes) has nowhere to plug in one.
- **The add-products button uses a plural even for one.** The count is dropped into a fixed plural
  sentence (`categories.add_selected` in `apps/dashboard/src/i18n/strings.ts`), so picking one
  product reads "Añadir 1 productos", and the English "Add 1 products" is just as wrong. **Next
  action:** give it a one-item form, as the delete warnings have, or use a plural-aware formatter if
  the dashboard adopts one.
- **Nothing stops the next screen making the same mistake.** A check that compares the class names a
  screen's own stylesheet styles against the class names it puts inside `wt-data-table` cell callbacks
  looks feasible and would catch this whole kind of bug; nobody has tried to write it.

**Categories screen rebuilt — LANDED #353 (2026-09-14).** `/manage/categories` became a table
switchable between a tree and a flat list with a name filter, a per-category colour swatch and a
per-category products window with bulk add; what it left open is recorded in the #340 list above.

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

**Extras and Options editors — owner review fixes (2026-09-26), queued as campaign lane A items
A64–A67.** The owner's review of the Modifiers screen: Active/Inactive in place of "In use", a Used
by column, an options popup that lists products only, collapsed name sections, steppers for choices
and quantities, baseline-aligned rows, a bin icon, the product's unit beside each price, a wider
standard modal everywhere, visible drag feedback, option rows as text with their own editor, and an
options list that always has a default. Spec:
[modifier editors polish](superpowers/specs/2026-09-26-modifier-editors-polish-design.md); plan:
[modifier editors polish](superpowers/plans/2026-09-26-modifier-editors-polish.md). Each item marks
its part done here when it lands.

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
- **The units screen's "Availability" column shows the Active flag.** `productsUsingUnit`
  (`packages/catalogue/src/units.ts`) returns `products.active` under the name `available`, and
  that name travels in the `unit.in_use` error's details, so renaming it changes an error's shape.
  **Next action:** rename the field to `active` and head the column "Status", in one change.

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
- **Each variants-table row's Available switch is named only "Available"** to a screen reader, not
  with the variant's name (`apps/dashboard/src/widgets/variant-table.ts`). **Next action:** name the
  switch after its variant.
- **Not yet looked at on a phone (390px wide):** a variant's name may sit a few pixels low in its
  product-list row. **Next action:** open it at that width, in both themes, and look. (The variants
  table's unit select, once cut to "Unid" in Spanish at that width, is no longer shown there: a
  table 30rem wide or less hides its price column, heading select included, and puts each price
  under the variant's name, so on a phone the price field's unit button is the way to the unit. A
  wider table still shows the select.)
- **The image library's upload form is wider than a 320px-wide phone.** Looked at 2026-09-24 in a
  browser test frame at 320px, light theme (`packages/media/src/dashboard/image-library.ts`, the
  Upload photo dialog): each language's fieldset and its Name and Alt text fields run past the
  dialog's right edge, both with `wt-modal`'s old 24px side margins and padding and with the phone
  spacing that replaced them. At 360px, dark theme, it fits with the phone spacing; with the old
  spacing it ran past the dialog's right edge there too. The cause was not investigated. **Next
  action:** find what sets the form's minimum width, and add a 320px case to the library's tests.
- **Three dashboard tests believe they run at phone width and do not.** The `setViewportSize`
  browser command (`apps/dashboard/vitest.config.ts`; since #612 its comment says what follows)
  resizes the outer Playwright page, not the frame a test renders in: measured
  2026-09-24, `window.innerWidth` read 414 before and after `setViewportSize(390, 800)`, and 390
  after `page.viewport(390, 800)` from `vitest/browser`. Its callers are two drawer cases in
  `apps/dashboard/src/dashboard-app.test.ts` (one asking for 400px, one described as a 390px case)
  and one in `apps/dashboard/src/dashboard-app.a11y.test.ts`, so each runs at 414px. It predates
  the variants branch: `git log -S setViewportSize` over those files names #172 and #333, and the
  branch changes none of the three. **Next action:** switch them to
  `page.viewport`, assert `window.innerWidth` after resizing, and delete the command if nothing else
  uses it. #612's probe also found the 414px frame already below the drawer's 48rem breakpoint
  (`matchMedia` matched), so every dashboard browser test runs in the phone layout: the drawer cases
  called "desktop" are not, restoring 1280 in `finally` does nothing, and the fixed-width drawer
  test compares the drawer against a "desktop" width measured in that same phone layout, so its
  equality check proves nothing.
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
  `apps/server/src/transfer-lines.test.ts`). So
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
- **A table in no zone still opens a tab, and nothing can be added to it.** The till opens a tab
  with no lines (`#onOpenTable`, `apps/till/src/till-app.ts`), and a booking seated at a table does
  the same through `core.openTab` (`seatBooking`, `packages/bookings/src/bookings.ts`); on a table
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
- **Two branches still read a held line that names no menu offer, and only an order parked before
  B4 should have one.** `getHeldOrder` (`apps/server/src/working-order.ts`, its
  `context === undefined || line.productId === null` arm) returns such a line by its product alone,
  and the till's retrieve (`#onRetrieveOrder`, `apps/till/src/till-app.ts`, the `liveByProduct`
  lookup) finds it among today's offers by product id or drops it with `held.product_gone`. Every
  line priced since B4 records its offer (`lineContexts`, `priceOrderLines`), and a partial transfer
  copies it to the new line (`copyLineContext`, `transferLines`).
  **Next action:** delete both branches, since no backwards-compatibility code is owed before
  production (CLAUDE.md §3), or say what keeps them.
- **`sale.unknown_product` is no longer raised.** A line naming an item the zone does not offer is
  refused `service_zone.offer_not_allowed` instead. The code stays registered, with its note in
  `apps/server/src/errors.ts` saying nothing raises it, and keeps its 400 in the till surface's
  status map (`apps/server/src/till-api.ts`), because a shipped code is never renamed or removed.
  **Next action:** none unless a retired code should also leave the status map; recorded so a
  reader who meets it knows it is retired.

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

- **A refused nested create is silent on three of the catalogue screen's five child forms.** Task 11
  wired `fieldErrors` from the create controller into the two list forms, after a review seat
  reproduced a refused nested create sitting in an open modal that said nothing. The same gap is
  still open on `unit-form.ts` and `category-form.ts`: each declares a `fieldErrors` property and
  `apps/dashboard/src/screens/catalogue-screen.ts` passes it to neither. **Next action:** wire the same
  `#childFieldErrors()` into both, one line each, and check each form's own field mapping rather
  than assuming the paths match.
- **Dismissing a nested form fires TWO cancels, and only two of five forms guard it.** The form
  emits its own `wt-cancel`, then the native `<dialog>`'s `close` arrives a task later,
  `wt-dialog.ts` turns it into `wt-close` and the form cancels again. If a second form has opened in
  between, the late cancel closes THAT one — measured on Task 11's branch as a test that failed
  about two runs in eight, traced rather than re-run to green. Task 11 guarded the extras and
  options forms with a kind check; the unit, category and modifier handlers still call
  `#child.cancel()` unguarded. **Next action:** the same guard on the other three.
- **`wt-tabs` shares the `wt-change` event name with every control a panel slots in, and five
  screens now carry the same `event.target !== event.currentTarget` guard against it**
  (`alerts-screen.ts`, `printers-screen.ts`, `profile-screen.ts`, `venue-operations-screen.ts`, and
  the Modifiers screen Task 11 rebuilt). CLAUDE.md §3 says a custom event stops the triggering event
  before re-emitting; `wt-tabs` does not. **Next action:** give the strip its own event name, or
  have it stop the inner event, and retire the guard in all five.
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
  `#cancel`, the `willUpdate` reseed guard, the Escape-while-busy handler, the error summary and the
  footer, each identical modulo the `t()` key prefix. **Next action:** decide whether a shared base
  or a controller is the right vehicle before a third list form is written; the row editors
  genuinely differ and should NOT be merged.

What option lists left open, none of it taken in #436 or #445:

- **`dependants` now fills both of its sides, and both of them through `product_modifiers`.** An
  options list has no per-menu publication row at all, so `optionListDependants`
  (`packages/catalogue/src/options.ts`) reads the products that carry the list, then walks the same
  attachment rows on to `menu_items` for the menus. The two queries repeat the same `option_list_id`
  condition rather than sharing one predicate; nothing can drift from it yet, because
  `options.in_use` is still thrown by nothing. **Next action:** whoever writes a refusal that uses
  the same condition shares it then — the modifier code this replaced had already learned that
  lesson in an `openOrderUse` helper, and that file went with the old model in Task 13.
- **`options.in_use` is registered and nothing throws it.** Deleting a list is designed to cascade
  its product attachments rather than be refused, so there may never be a thrower. It stays
  registered because a shipped code is never removed.
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
- **`extras.in_use` is registered and nothing throws it**, the same posture as `options.in_use`.

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
- **The `products` row behind an extra is read by TWO bodies, and that is deliberate.**
  `readExtraProducts` (`packages/catalogue/src/offered-modifiers.ts`) and `resolveBasketModifiers`
  (`apps/server/src/working-order.ts`) each issue their own `select … from products where id in (…)`
  for the products an extras list offers. The review asked for them to be merged; they were left
  separate because neither result can be derived from the other. The order path resolves customer
  text under the order's `defaultLanguage`, which no sell-side caller has; the sell-side read expands
  dietary declarations through `validateDietaryDeclarations`, which THROWS `diet.declaration_invalid`
  (`packages/catalogue/src/dietary-declarations.ts`), and putting that on the order path would add a
  refusal it does not have today. Sharing only the `select` would make the order path fetch
  `allergens` and `dietary_declarations` it discards. The branch's own docblock was narrowed to say
  this — the LIST maps come from one body, the product facts do not — and the two shapes no longer
  share the name `ExtraProductFacts`. Revisit if a third caller appears, or if the order path ever
  needs an extra's allergens.
- **A published-but-DETACHED extras list is offered by nothing and demanded by the validator, and
  nothing cleans the publication up.** The two sides read different sets on ONE of the three reads
  that build those maps — the MENU-OFFER extras read, which is the read this scenario uses. The
  picker's source (`readOfferedModifiers`) keeps only the lists the product's `product_modifiers`
  attachments name, while `readMenuExtras` (`packages/catalogue/src/extra-projection.ts:131`)
  reads `menu_item_extra_lists` and nothing else, and the order path
  (`priceOrderLines` and `updateHeldOrder` in `apps/server/src/working-order.ts`) consumes `extrasByHolder`/`optionsByProduct`
  straight — so the detached list reaches it. **Not true of the other two reads, checked rather
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
  `resolveAttachedModifiers` in `packages/catalogue/src/offered-modifiers.ts`, which the sale path
  enters through `resolveBasketModifiers` (`apps/server/src/working-order.ts`). Their writers
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
the frozen `unit_name` column is presentation only and does not enter the fiscal hash.

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
  product, each doing two round trips for a value that changes once per transaction. Pre-existing —
  only the field name changed here. **Next action:** hoist one read to the top of the save and thread
  the resolved config down.

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

### A2. The setup wizard

The restore choice now includes guided Cloud recovery of a verified test-venue snapshot. The
replacement shows the pairing code and approved capture time, then requires an explicit local
restore. Live production recovery and continuous complete-server recovery remain open.

The setup wizard landed in #334 (2026-09-12); corrections from walking it on a real machine, plus a
first-sign-in passkey offer, landed in #347 (2026-09-13). Two calls the PR left with the owner, still
open:

- *Setup always stores a language on the account.* If the browser sends no language, or one Waitron
  does not ship, the account gets the venue's language saved as though chosen — so the stored value
  cannot tell "chose Spanish" from "said nothing", and it does not follow a later change to the venue
  default. Keep this, or store a language only when the browser asked for one?
- *The modal is always full height.* A short screen, such as the join-or-recover choice, sits in a
  tall box with space below. That follows from choosing a real modal; the PR did not check how it
  looks on a phone. Worth a look in the running wizard before deciding.

**Still open after #334**, each one something the branch consciously did not take:

- *The wizard has no translated text and no language chooser.* It is English only, on a box whose
  venue may well not be. The account it creates now gets the operator's browser language, so the
  dashboard opens in the right language, but the wizard itself does not. Translating it means every
  visible string across its screens plus the per-operating-system certificate instructions, into
  English and Spanish, using the same catalogue the dashboard registers through
  `@waitron/dashboard-kit`, and a chooser seeded from the browser's preference. Deferred from the
  2026-09-13 corrections by owner decision, as much bigger than everything else in that branch put
  together.
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

- *In Demo, a server refusal of a field Demo hides gives the operator no signal.* The shell routes a
  refused `seriesCode` or `operationDescription` back to the venue screen whatever the mode
  (`apps/setup/src/setup-app.ts`, the venue case of the refusal routing), but Demo does not draw
  those fields: nothing is marked, no alert shows and focus does not move. Whether the server ever
  refuses Demo's fixed series codes is not established.
- *In Demo with a draft country that has no venue-setup pack*, the error summary asks for the tax ID
  and the invoice languages, neither of which Demo shows.
- *A draft carrying a country with no venue-setup pack* (a configuration import can bring one) shows
  España in the country select while the screen holds the other value, so "Check the country." sits
  beside what looks like a valid choice.
- *A fiscal test or a provision that answers after the wizard has been removed from the page leaves
  it stuck when it is put back*: the Run button stays on "Running test…", or the screen stays on
  "Provisioning…", with no retry. The connection check releases itself in the same case. The app
  mounts the wizard once and never removes it, so this may be unreachable in use.

**Restoring a backup and importing a configuration failed in a real browser — FIXED #584.** `restore`
and `stageConfiguration` in `apps/setup/src/api/client.ts` now copy `fetch` into a local first, as
`#request` does, so the browser no longer refuses them with `Illegal invocation`.

**The dashboard's configuration export has the same fault, masked — OPEN (found 2026-09-24, fixing
the setup client; lane B's package).** `apps/dashboard/src/api/client.ts`'s configuration export
calls `this.#fetch(...)` as a method. It works today only because `main.ts` hands the client
`createInstrumentedFetch`'s arrow wrapper (`packages/diagnostics/src/instrument-fetch.ts`), which
calls the real `fetch` as a plain function. A `DashboardApi` built with its default `fetch` would be
refused on the configuration export with `Illegal invocation`.

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
connection is still unimplemented in `liveBtDevicePath`.

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
  renaming the new error code (codes name the domain concept and are never renamed once shipped),
  and deduplicating targets in the agent host (the issuing server already normalises and
  deduplicates its bounded list of eight).
- **Nothing physical has been verified since #327:** discovery, paper output, whether a device knock
  reaches the box while the Add agent dialog is open, the five-line feed before the cut, Bluetooth
  discovery, and the receipt preview against printed paper. #324's slips, duplicates and drawer pulse
  have never produced paper either.
- **Printer discovery and the Bluetooth model** (owner, 2026-09-11, own spec): move Bluetooth
  scan-and-pair off the agent's `:9110` page into the dashboard, and surface the host's already-bonded
  printers through the existing `paired()` seam. Prereq: the box's Bluetooth radio path is
  hardware-unconfirmed.
- **The virtual PDF printer**, and a `print_jobs` retention sweep — nothing deletes a job today.
- **Printing A4 invoices on an office printer** (owner, 2026-09-14): a separate design, not started.
  It reverses the 2026-09-09 provisioning design's "raw ESC/POS only" decision and needs an A4
  invoice layout, a way to send a PDF to the printer over IPP (the standard office printing protocol,
  port 631; the owner's HP accepts PDF directly) and rules for which documents go to which printer.
  It would share the PDF rendering with the virtual PDF printer above.
- Read-back gaps: the per-till printer picker is not location-filtered; the print-mode and
  `drawer_open_policy` toggles are set-only (the latter gates cash access); the Impresoras editor
  leaves agent and transport re-binding read-only though the API accepts it.
- **A missing font token on the Printers screen** (found 2026-09-26, A61):
  `apps/dashboard/src/screens/printers-screen.ts` uses `--wt-font-size-xs`, a token that does not
  exist (the Servers screen copied it; fixed there only).

### A4. Till, displays and devices

- **Service, ordering and billing: planned and queued on lane B (2026-09-26).**
  [Design](superpowers/specs/2026-09-20-service-ordering-and-billing-design.md), Revision 2,
  approved by the owner and merged as #693 (§14 lists every change from Revision 1);
  [plan](superpowers/plans/2026-09-26-service-ordering-and-billing.md), Revision 2, eighteen tasks,
  reviewed three times before the merge. What stays open:
  - **Task 0's [bill payments design](superpowers/specs/2026-09-26-bill-payments-design.md) is
    approved** (owner, 2026-09-26, PR #698), with the owner's answers to its open points (its §11):
    the cash-up counts money on the day it moves, in Task 14 (§9a), and a card refund is a durable
    attempt that survives an interrupted call (§6b). Task 14 waits only for its dependencies (Task 2;
    lane C's M7b2 landed as #702), and its Step 0 checks the providers' documentation and the SumUp endpoint
    before any implementation.
  - **The card refund path records only after the provider call, with a fresh key each time**
    (found by the owner reviewing Task 0, 2026-09-26). `reverseViaStripe`
    (`packages/payments-stripe/src/reverse.ts`) sends a fresh `randomUUID()` idempotency key on
    every call and writes `payment_refunds` only after the call returns, so a crash between the two
    leaves no record, and a repeat would send a new key. SumUp's refund sends no key at all. No
    product route refunds a card today; the only product caller is the reconciler's reversal of an
    abandoned order's capture (`packages/payments-stripe/src/reconciler.ts`). Task 14 uses a
    separate, durable path for refunds before the invoice (design §6b). **Next action:** give the
    reconciler's reversal, and any post-invoice refund route when one is built, the same
    durable-attempt rule.
  - **Task 1 landed as #706** (2026-09-26): the new module `packages/adjustments`, holding
    adjustment reasons (table `adjustment_reasons`), the policy check `evaluateAdjustment` and a
    managers' dashboard screen (permission `adjustment.manage`).
    Nothing applies a reason to an order yet — Task 11 does. Two points Task 11 inherits:
    `evaluateAdjustment` counts a cancel's reduction against the reason's euro limit, and it
    throws a `RangeError` on a malformed request (a negative amount, or a percentage discount
    without a percentage from 1 to 10000) rather than returning a verdict. Left from the review:
    the reasons screen repeats the role list in `apps/dashboard/src/widgets/person-edit.ts` and the
    placeholder-filling helper in `apps/dashboard/src/widgets/menu-preview.ts`; sharing them means moving both into `@waitron/dashboard-kit`. **Next
    action:** do that move if a third module screen needs them.
  - **A keydown guard that cancels Escape while a save runs did not keep one dialog open.** Measured
    on Task 1's reasons screen (`packages/adjustments/src/dashboard/reasons-screen.ts`): a real
    Escape pressed with Vitest's `userEvent` during a save closed the editor, although the screen's
    keydown handler called `preventDefault()` and `stopPropagation()` on Escape while busy. The name
    field was focused before the save and is disabled during it, so where focus was when the key
    arrived was not recorded. That screen's `wt-close` handler closed the editor without checking
    whether a save was running. It now sets `wt-modal`'s `dismissible` to false while busy instead.
    The same keydown guard is on other dashboard forms. The tests of six of them press a real Escape
    during a save and pass with the dialog still open: "keeps the editor open when Escape is pressed
    during a save" (`apps/dashboard/src/widgets/category-form.test.ts`), "saves once and stays open
    against Escape while a save is in flight" (`apps/dashboard/src/screens/labels-panel.test.ts`),
    the three "keeps the … open against Escape" cases in
    `apps/dashboard/src/screens/categories-screen.test.ts`, "holds the draft open and unchanged
    while a save is in flight" (`apps/dashboard/src/widgets/content-languages.test.ts`), "ignores
    Escape while a save is in flight and honours it once the save has settled"
    (`packages/media/src/dashboard/image-library.test.ts`) and "stays open on Escape while a save is
    still pending" (`packages/venue-service/src/dashboard/venue-operations-screen.test.ts`). The
    first five forms' `wt-close` handlers also ignore a close while busy, so their tests do not show
    the keydown guard holding on its own. The venue operations screen's `wt-close` handler has no
    such check and the screen does not set `dismissible`; its test focuses the dialog's body, not a
    field, before the key. The rest were tried only with a hand-built `KeyboardEvent` dispatched on
    the dialog (`sections-screen`, `modifiers-screen`, `add-to-menus`, `extra-list-form`,
    `option-list-form`, `variant-form` and `menu-prices-table`, under `apps/dashboard/src`) or not
    at all (`#guardEscape` in `apps/dashboard/src/screens/menus-screen.ts`). Why the reasons screen
    behaved differently has not been established. **Next action:** repeat the reasons-screen case
    recording which element has focus just before the Escape; then press a real Escape during a save
    on each form tried only with a hand-built event or not at all, and move the ones that close to
    `dismissible`.
  - **Every other task waits for lane C's menus tasks that change the same order and till code**
    (M7v, M9; M7b landed as #696, M7b2 as #702, M7c as #710). Building beside them would collide on
    `apps/server/src/working-order.ts`, the till and the core migrations.
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
  - a visit record ties a party's orders and bills (joined tables and merged parties included) and
    keeps the table occupied until Finish table;
  - a bill's invoice is issued when it is fully paid, several payments may come before it, and lines
    can still be split off after a contribution;
  - discounts reduce the line, comps show at €0.00 with the original price, and weighed items take
    discounts to the nearest cent;
  - an item is credited to whoever owns the draft when it is submitted, and adjustment rates are
    measured against those credits.

  Out of scope for this plan: guest access, inventory, seat and staff assignment, changing the floor
  layout during service, screen plugins and Bizum.
- **A paid party's bill cannot be merged with another or have items moved onto it (plan Task 2,
  2026-09-26).** Once a party has paid, it can still be moved to another table or have a table
  joined to it, but merging another table's bill into its paid bill, or moving items to or from
  that paid bill, is refused with `tab.not_open` until a new round opens the party's next bill.
  Decide whether a paid party should be mergeable before the till offers it.
- **An invoiced but unpaid bill on a party cannot be charged from the table screen (plan Task 2,
  2026-09-26).** In a venue that issues the invoice first, a party merged into another can bring a
  bill whose invoice is issued but not yet paid. The table screen lists it with what it owes, but
  offers Take payment only on bills that are still open, so there is no button to charge it. Finish
  table is then refused because that bill is unpaid; once no open bill is left, the refusal tells
  the person to take payment but offers no button that does it. Charging it belongs to plan Task 14 (bill payments).
- **The floor and the table screen write amounts differently (plan Task 2, 2026-09-26).** The floor
  shows `44.00 €` while the table screen shows `44,00 €` in Spanish. The floor's format predates
  the visits work; Task 2 now also uses it for what a party still owes. Make the floor follow the
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
  `--wt-color-danger` the dish picker's refusals now use — and then check every OTHER `var(--wt-*, …)`
  fallback in the tree the same way, because this one was found by accident.
- **Five measured till layout defects and one seen in a screenshot, all of them older than the
  extras-and-options work.** Found while looking at the real screens for B1 Task 12. **Next action:**
  take these six as
  one till layout pass over `apps/till`, at 390 and at 1024, measuring rectangles rather than
  reading rules — and set the width with `page.viewport(w, h)`, never `commands.setViewportSize`,
  which resizes the outer page and leaves the components' own iframe alone
  ([testing-guide.md](developers/testing-guide.md)).
  - **Within one extras list, prices are not a column and names are not a column**
    (`apps/till/src/widgets/modifier-picker.ts`) — a checkbox row and a stepper row misalign both the
    price edges and the name edges, at 1024 and at 390.
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
    card's right border.** Seen in a screenshot, not measured;
    `git diff main...HEAD -- apps/till/src/widgets/product-grid.ts` changes no CSS.
- **Two modifier-picker states, and how far each is actually out of reach** — a fact worth having
  before anyone writes a test claiming to cover them, and one half of it is NOT what the looking
  pass first wrote down. An options label marked unavailable never reaches the picker at all: the
  sell-side read filters withdrawn labels out and nulls a `defaultLabelId` that names one
  (`packages/catalogue/src/offered-modifiers.ts`, the `labels` filter and the `defaultLabelId`
  ternary beside it) — traced through the code, not run. An over-cap count is different. Stepping
  cannot produce one, because `#step` clamps against both the item's own cap and what is left of the
  list's allowance; but a REOPENED line is seeded straight from `initialSelections` with no clamp at
  all, so `#allSatisfied`'s `total <= entry.maxPicks` arm is reachable after all. Run in the till's
  browser harness on 2026-09-21: a picker seeded with 5 of one product on a list whose `maxPicks` is
  2 renders a count of 5 and a disabled Add, and that arm is the only one of the five that a fixture
  with `minPicks: 0` and `maxQuantity: 9` can be failing. The real-world shape is a parked line
  whose list had its cap reduced under it, the same family as the "list lost the product between the
  park and the edit" escape recorded under Task 8.
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
- Register/device follow-ups: `WAITRON_TILL_TILL_ID` still seeds a "Caja 1" register while a till
  enrol auto-creates its own; the device-management routes build their `devices ⨝ device_profiles`
  read inline where a `listDevices` store verb belongs.

### A5. Incidents and notifications

**Dashboard alerts — LANDED #363/#368/#371.** One bell, panel and Alerts screen for recorded
incidents and live checks (backups, fiscal submission, printing, reader battery). The printing checks
shipped as `agent.silent` and `printer.jobs_waiting`, worked out live on each dashboard read and never
saved, so they can still be renamed cleanly until a venue is live or anything starts saving them.

**Incidents reader and dashboard notification surface — LANDED #368/#371.** A pop-up toast, a
venue-shared handled state, live incident push and the ongoing-check consumers. Still not built: the
pairing consumer, and a standby that has fallen behind.

### A6. Payments

- **The SumUp Solo experiments** ([runbook](research/2026-09-10-sumup-solo-experiments.md)). Question
  4 — does the reader still work standalone once paired to SumUp's cloud — governs whether the deli's
  card-outage path holds; if it fails, the deli-hardware outage design must be rewritten. The other
  three: whether we may supply the idempotency key, whether reader webhooks are signed, and whether
  `void` maps onto the refund endpoint.
- **The printer-cradle experiment** (hardware not yet owned). SumUp's OpenAPI has no `print` and no
  receipt option on a reader checkout, so we can neither request nor suppress a cradle slip. State the
  failing case first (the cradle stays silent), with a standalone payment as the control. Also unread:
  `GET /v1.1/receipts/{transaction_id}`, richer than the four fields the adapter keeps.
- **What #329 left open:** adding or adopting a reader does not shut out a provider disconnect at the
  same moment (an accepted race); Stripe's reader list is one page; low battery now alerts on the dashboard (A5, #371); status
  never refreshes by itself, and polling must go through the passive-session controller.
- **The SumUp reconciler** — settlement-report audit and orphan self-heal. `resolvePending` is the
  interim backstop; without an affiliate key a create whose response is lost resolves `failed` and
  raises `payment.pending_outcome_unactionable` for a human. Note: a SumUp refund is a separate
  `type: REFUND` transaction linked by `transaction_code`; the original's `status` never flips.
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
  by running it, then drop or narrow that header sentence. Ties in with the next item: editable roles
  are built from this list.
- **Roles are something an admin can add and edit; the four built-ins are only defaults** (owner
  decision 2026-09-12, design not written). Detail under *Detail → Roles*: the ladder question decides
  the schema.
- **`wt-select` in `packages/ui`** (owner decision 2026-09-12): every screen writes its own raw
  `<select>`, so a rule alone could not be guarded. Sorts by the label the person reads with
  `Intl.Collator`; lists in a lifecycle order say so; then migrate the screens, including the filter
  dropdowns `wt-data-table` draws in its toolbar, which are raw `<select>`s too. Fix
  `wt-data-table`'s locale-less `localeCompare` at the same time.
- **Seven dropdowns still bind `.value` alone over options from a list, but none is known to show
  the wrong choice today** (2026-09-14; read, not run). Each binds `.value` on a `<select>` whose
  options come from a `.map(…)` and marks no option `selected` — the shape that showed "Downstairs
  bar" on the till while it sold from Deli counter, fixed by #365 (CLAUDE.md §3). Found by a text scan, checked by
  hand: `apps/dashboard/src/screens/my-schedule-screen.ts:351`, `:365`, `:417`,
  `apps/dashboard/src/screens/units-screen.ts:486`, and
  `apps/till/src/screens/till-schedule-screen.ts:353`, `:367`, `:420`. By reading, every one opens
  on its first option — an empty placeholder or the first absence type — which is what that shape
  shows anyway, so the fault stays hidden until one opens with another value. **Next action:** when
  one of them is next touched, mark its options `.selected` the way
  `apps/till/src/screens/till-counter-screen.ts` now does, with a test that opens it on a non-first
  choice and reads `select.selectedOptions[0]`.
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
  parent picker (#362) and the product's main-category and labels pickers
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
- **A per-tender payment slip** when one sale is settled by several cards — needs a multi-tender pay
  path (`settleSale` takes `tenders[]`; `payWorkingOrder` and `readTenderBlock` assume one). Art. 11.1
  bounds how long an invoice may sit open.
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
- **Category-driven routing to multiple printers/destinations** (owner, 2026-09-12): deferred from
  the Products overhaul. Decide how a
  product's labels (menus spec §10.5; category memberships are gone since 2026-09-25) select one or
  more preparation/printing destinations, how matching rules combine and how duplicate output is
  prevented. Keep reporting attribution separate so one
  sale is counted once. The overhaul retains the current routing path; its reporting-category
  choice does not settle this later routing design.
- **Departments and menus** (#297) remaining: remove the legacy price and fixed-station compatibility
  fields; per-menu modifier authoring; department hours and calendar exceptions; workforce
  assignments; immutable department attribution and reporting; batched readiness and offer queries;
  a replication smoke test. Same legal seller is the working assumption, to confirm before go-live.
- **Counter/walk-up kitchen fire** — the #193 follow-up, the next piece of menu work.
- **Menu draft/published state** and time-of-day / seasonal scheduling.
- **Pricing adjustments** (owner, 2026-09-03), both gated on the discount permission: reduce or zero
  an order line; a whole-order discount spread across lines and VAT rates. A *descuento* agreed at or
  before issuance is outside the VAT base (Q15), so it must reach the line BEFORE `computeHuella` —
  specced with the owner, never landed unattended.
- **KDS corrections deferred from #191** (owner, 2026-09-01): a moved dish must keep its kitchen
  status (`moveTabLines` deletes and reinserts the line, so its `ticket_items` row cascade-drops; the
  ticket must travel with the line, not re-fire — no test covers it today); hold-on-send
  without courses plus a venue disable setting; FP-1's empty-named child-modifier row; device-scoped
  fire/collect routes. Then the low-priority KDS list under *Detail → KDS*.
- **Order-timing and modifier follow-ons**: delivery-order floor flash, idle-floor escalation,
  station-kind threshold defaults, an unbumped-since-fire metric; on-screen modifier `×N`, the shared
  `#allergens` render, the KDS-versus-till unreviewed-dish call, post-fire note edit
  (needs a re-fire endpoint), the TS-4 partial-transfer modifier-split guard.
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
  `sales.locale` is stamped from the boot-time `cfg` rather than from `locations.invoice_locales`.
  Adding content translations does not translate Waitron's interface.
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
- **AEAT certificate management UI** — first-run only today; `cert-expiry.ts` monitors but there is
  no view/rotate/renew surface.

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
image constraints under *Detail → Box image*.

### B4. Upgrades and migrations

- **Upgrade testing — blocking before go-live (owner, 2026-09-26).** On 2026-09-26 the box could not
  start after an upgrade: core `0013` dropped a column the change feed's trigger named, which no test
  could see because every suite migrated a fresh database. #692 removes the change feed before
  migrating, and its `scripts/migration-upgrade.test.ts`
  walks one database through every shipped migration in date order, with the change feed installed
  between steps. What it still does not cover, each needed before a real venue is live:
  - **Rows.** Its tables are empty, so a migration that fails only on data passes — a new
    `not null` column, a rebuild whose `DROP TABLE` cascades (CLAUDE.md §3), a unique index the
    existing rows break. Seed a realistic venue (the demo seed at least) at each step.
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
- **`runAgentOnce` catches a database refusal and then writes again on the same transaction, with no
  savepoint** (`packages/printing/src/runtime.ts`). What is still wrong, and is the whole of the item
  now: when the
  refusal is the `done` `reportPrintJob` inside the `try` rather than `transport.send`, the `catch`
  records `failed` for a job whose bytes were already sent, so a later batch prints it again.
  No caller in the tree reaches it —
  `apps/server/src/print-api.ts` uses the split `claimPrintJobs`/`reportPrintJob`, and
  `runAgentOnce`'s only callers are this package's own `runtime.test.ts`, `runtime.race.test.ts` and
  `runtime.reclaim.test.ts` — but it is exported from the package's `index.ts`, so that is a fact
  about today's tree rather than a property of the API. It becomes real the moment a local-mode
  agent host is wired up (the item above). **Next action:** move the `done` report out of the
  `try`, so a refused report is not recorded as a failed send; a savepoint around it would not
  help, since the refused statement already confines itself.

### B7. Provisioning and build debt

- **Every credential reader checks the fields it uses — decided 2026-09-15, now unblocked by #378.**
  Reading a credential (`getCredential`/`tryGetCredential`, `packages/credentials/src/store.ts`) does
  not re-check it against `PURPOSES`, and the owner chose to keep it that way rather than refuse the
  read (which would stop every venue holding that kind of secret the moment a field is added). Two
  readers still pass a missing field on unchecked and are the work: `apps/server/src/email-delivery.ts`
  (`url`/`from` with `!`) and `apps/server/src/node-identity.ts`'s `readNodeIdentityKey` (`privateKey`
  cast `as string`); both should raise `server.credential_unusable` naming the field, as
  `apps/server/src/stripe-account.ts` does, each with a failing test first. `rotate` re-checks a
  secret against the current list
  only when it re-seals one: it skips a secret already on the current key (`rotateCredentials`,
  `packages/credentials/src/store.ts`), so an out-of-date one stops a key rotation only when it is
  on an older key, until it is re-entered (measured by #577's review).
- **`CardProviderBuildDeps.nodeId` is dead weight — nothing reads it** (2026-09-16, traced through
  both adapters). `packages/payments-sumup/src/provider.ts` declares the field and never touches it,
  and `reverseViaStripe` (`packages/payments-stripe/src/reverse.ts`) requires it on its options
  object but destructures only `resolveProcessorRef`. **Next action:** delete the field and the
  values every caller passes, or, if a record path is meant to use it, wire it up and say where.
- **A box that mints its certificate before NTP sync persists a wrong validity window**, with no
  renewal path yet. Ties to a time-health check and certificate renewal.
- **Server shutdown can skip closing its database pools.** In `makeStartedServer`
  (`apps/server/src/boot.ts`), the step that stops background work (`stopWork`) runs outside the
  try/finally that closes the pools, so if it ever rejected, `closePools` would be skipped and the
  pools left open. Trading mode's version awaits the main loop and the backup supervisor's `stop()`
  without catching a failure; the tunnel worker's settle is the one that is caught. The live change
  feed is no longer among them: it runs in process, so shutdown unsubscribes it with a synchronous
  call and there is no connection to close. From reading the code these are believed not to reject
  today; that has not been tested.
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
- **A database ahead of the box's image gets a raw driver error, not the classified one**
  (2026-09-14) — **probably closed by #489, read, not run.** `ensureInstance` is gone, and
  `runEntry` (`apps/server/src/node-entry.ts`) now calls `assertNotAhead`
  (`provisioning.database_ahead`) before `startServer`, which is what migrates. The
  `node-entry.test.ts` case "counts a boot that fails BEFORE the server" rejects with
  `provisioning.database_ahead` but does not assert that `startServer` was never called.
  **Next action:** add that assertion, prove it by moving the call after
  `startServer`, then delete this entry.

### B8. Module framework follow-ons

- **Country-pack follow-ons:** the authenticated address relay and its first provider adapter; phone
  normalisation in bookings; a supplier country/identifier scheme before validating purchasing tax
  IDs; the pack's module preset; the refused foral, Canary, Ceuta and Melilla jurisdictions; a
  territory picker in the setup wizard (it offers `ES-common` only).
- **`fiscal-none` left-behinds:** remove the inert `resolveClient`/`skipRetryMs`; regime-agnostic
  provisioning tests.
- **Test-helper debt:** `provisionTestVenue(db, overrides)` for `apps/server`'s sixty-odd suites; the
  duplicated `boot.*.test.ts` helpers into `apps/server/src/testing/`; a shared
  `useFiscalMirrorPair()` for the two-clone fiscal suites.
- **The tax-model system** — the `tax` slot is an inert label today; the intended shape puts the tax
  MODEL in core with the fiscal module supplying rates and labels. A prerequisite for any non-ES
  venue, so parked.

### B9. CI and test infra

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
    (`POST /management-api/servers/:nodeId/remove`), marking it `evicted`. Still open:
    "never finished joining" is read as `serving-secondary` with no `nodes` row in the primary's
    database, and a remote standby writes that row in its own database, so the check cannot see a
    remote standby that finished — none can today (`finish-adoption.ts`).
    **Done (2026-09-26, lane A's A63, #712) for A61's two other open notes** (a removed entry still took a
    `MAX_NODES` place; a removed node still held the primary's endorsement of its key): an admin
    (`mirror.create`) on the serving primary can clear a removed machine from the Servers screen
    (`POST /management-api/servers/:nodeId/clear`, routed in
    `apps/server/src/membership-removal-api.ts`, decided in `apps/server/src/membership-removal.ts`),
    which moves its id into the chart's new signed `revoked` list (outside `MAX_NODES`, capped by
    `MAX_REVOKED`) and writes an append-only `membership_clearances` row. The primary refuses a join
    to a full chart (`mirror.membership_full`), minting refuses a chart over either cap
    (`membership.chart_too_large`), and a receiver refuses a chart signed by a machine its own held
    chart lists removed or cleared (`signer_removed`, `verifyMembershipDocument`).
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
    `mirror.membership_full` for a full chart) and the mint's `membership.chart_too_large`; (v) a receiver whose held chart predates a removal accepts the removed machine's charts
    until it learns of the removal; (vi) a joining standby sees `mirror.bundle_fetch_failed` rather
    than the primary's reason, because `apps/server/src/mirror-bundle-fetch.ts` turns every non-2xx
    answer into that code — this predates A63, and `mirror.standby_removed` has the same gap; (vii)
    if A61's removal ever mis-classifies a live standby that an operator later promotes, the old
    primary refuses the new primary's charts (`signer_removed`) and keeps selling; the refusal is
    logged at warn and raises no alert. No adopt can finish today (`finish-adoption.ts`), so no such
    standby exists yet.
    **A test gap found by A63, measured:** A61's three cases in
    `apps/dashboard/src/screens/servers-screen.a11y.test.ts` that open the Remove dialog (the
    confirmation, a refused removal, and a machine with no address) never check that it opened. With
    the screen changed so no dialog could open (`.open=${false}`), all three still passed in both
    themes, so they would not catch a problem inside that dialog. The fix is the open-dialog
    assertion A63's `openClear` helper in the same file makes before its axe scan.
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
    names that section as its receipt. Tests, not comments: `boot-failure.test.ts`'s "names every pinned result code
    as an unreachable database" cannot fail when a code is added (the review added 26 and the suite
    passed), and two `health.test.ts` cases, "stays 200 when reconcile has failed runs but nothing
    parked" and "does not flip health for a failed-only run (parked stays 0)", feed a clean pass, so
    they check less than their titles say. Test titles #624 could not touch: "(T12b)" in
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
    points at "line ~221". Read only, not run: `WebhookDeps.nodeId` looks unread by `settleWebhook`;
    `receipt-order.ts` takes a `cfg` it never uses; `me-api.ts`'s profile save logs
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
    **`fetchPeerMembershipDocument` throws on a 200 whose body is JSON `null`**
    (`apps/server/src/membership-reconcile.ts`, the final `body.document ?? null` reads a property
    of `null`; the review reproduced it in a script), and boot re-throws what reconciliation throws,
    so boot fails where it meant to carry on. Read, not run: the boot comment above that call says
    the peer credential rides in a header, but the fetch is given only the URL, and the returned
    `superseded` is never read; `shouldFenceRestart` (`membership-fence.ts`) has no caller outside
    its test (`git grep`); `device-api.ts`'s ticket-item advance route does not enforce the
    `act-as-kds` capability, and the obstacle its comment gave (null profile ids) no longer exists;
    `enrol-rate-limit.ts` keeps one global limit whose stated reason (snitun) is gone;
    `provision-till.test.ts` inserts its tenant with `onConflictDoNothing`, so a second call's new
    NIF is silently kept out; `provision.ts` stamps the deployment in its own transaction before
    `applyVenue`, a split with no commented decision (believed to predate #617, not checked); and
    `setup-operation.ts` (around lines 128–133) may treat a lock written by a different store as a
    previous boot's, so a live process's lock could be taken over (a belief, not verified).
    `node-entry.test.ts` fixtures are still PostgreSQL-shaped (a `Failed query` wrapper, code
    `42703`). `packages/db/drizzle/0000_baseline.sql` still names an index
    `tills_tenant_location_name_key`. Test titles #617 could not touch: "(real Postgres)" five
    times and "(SP-A.2 §16, device-profile §5)" in `device-session.test.ts`; "since Task 7" and
    "this tenant's devices" in `device-api.test.ts`; "never a raw devices_pkey 23505" in
    `join-requests.test.ts`; "(R1 behaviour preserved)" in `membership-mint.test.ts`.
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
    change. `apps/dashboard/src/widgets/language-chooser.ts` puts `aria-haspopup` and
    `aria-expanded` on the `wt-button` host, and `wt-button` does not pass them to its inner
    button, so a screen reader probably never hears them (read, not run). `reorder.test.ts`'s test
    names say an out-of-range move "clamps"; `reorder()` ignores it. #616 fixed the till's copies of
    "a `wt-button` forwards only `disabled`/`aria-label`", and #618 the till's "a runtime shape
    error a view test catches".
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
    `.husky/pre-push` beside the same loop; it is not there. `CLAUDE.md` §2 and the entry "The
    guard sees ci.yml alone" below say `scripts/ci-workflow.test.mjs` reads only `ci.yml`; one of
    its cases also reads `mutation.yml`. `CLAUDE.md` §3 says `scripts/no-tenant-column.test.ts`
    exempts the core migration files that historically carried the column, whole; its
    `HISTORICAL_TENANT_SQL` list is empty. `docs/developers/modifiers.md` (about lines 469-472)
    calls the `catalogue-engine-neutral` header paragraph "the receipt" for not checking `pgEnum`
    in the order and sale files; #602 deleted that paragraph because those columns are now
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
    change: the SQL comment inside `src/cash-up.ts`'s `sql` string (~36) still explains the
    ordering by a `::text` cast on "a PostgreSQL ENUM"; test titles still say "jsonb"
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
    tells a missing sale from an existing one by the error); and `record-sale.test.ts:854`, `:930`
    and `:995` carry history ("legacy path unchanged", "additive, no behaviour change").
    `record-sale.test.ts:280` ("groups two lines at the same VAT rate into one breakdown entry")
    asserts only the record's total, which is the input passed through, so it passes with no
    grouping; the fake backend stores the breakdown, so it could assert the merged entry. No test
    reaches `settleSale`'s catch that turns a `sale_settlements` unique-key refusal into
    `sale.already_settled` (`packages/core/src/settle-sale.ts`); #598 measured the earlier check
    stopping both concurrent-settlement tests first. `sale.number_reused` is registered in
    `packages/core/src/errors.ts` and `git grep number_reused -- apps packages` finds no thrower.
    Outside core,
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
  - Identity code, found by #559 and not changed: `setEmail` in `packages/identity/src/staff.ts`,
    unlike `updatePersonDetails`, never checks the new email against other people's pending
    emails; `totp.key_unavailable` is declared in `errors.ts` and thrown nowhere; and
    `manager-login.ts` reports an authenticator secret it cannot decrypt as `totp.invalid`.
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
  - `packages/provisioning` code, found by #561 and not changed: `provisioning.database_not_owned`
    is declared and neither thrown nor read anywhere in `packages/` or `apps/`;
    `provisioning.adopt_incomplete`'s `missing` type still lists `"tenant"`; `quoteIdent` has no
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
  - `apps/setup` code, found by #567 and not changed: `#onGoto` in `setup-app.ts` does not clear
    `fiscalTestError`, so the routed-back fiscal-test banner survives navigating away and back;
    `AdoptOutcome`'s `breakGlassSecret` is typed as required, but a replayed adopt answers without
    it (`apps/server/src/setup-api.ts`); the done screen treats any failed status read as "the box
    is trading", so a passing 503 could offer the reload early; the mode screen's own text says a
    live server files real invoices, which a live run on a development box does not;
    `setup-app.test.ts` has two test titles naming a `SyntaxError` from a non-JSON error body that
    `apiError` turns into `server.internal`; `events.test.ts` has no case for the restore and
    fiscal-test dispatchers; the `*.css?inline` declaration in `vite-env.d.ts` is redundant
    (vite/client declares it); `vitest.config.ts` excludes `.stryker-tmp` in a package with no
    Stryker config; `paintCanvas` in `widgets/test-helpers.ts` has no accessibility suite that
    fails without it; `done-screen.ts`'s styles use hex fallbacks and `rem`, and a CSS comment
    inside its style string is history; and `connection-screen.ts`'s `connection-continue` event is
    not named `wt-*` and carries no `detail`.
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

- **The english-only guard blames the wrong lines when a comment contains a glob path — OPEN
  (found 2026-09-21, task P6).** `scripts/english-only.test.ts` strips block comments with a
  pattern that looks for a slash-star opener anywhere in the raw text, so a glob path written
  inside an ordinary LINE comment opens one as far as the scrubber is concerned. It then blanks
  everything up to the next real block-comment terminator — measured at about 390 lines in
  `packages/db/src/schema/sales.test.ts` — and pairs backtick-citation blanking across that whole
  span, which made it report three pre-existing, untouched Spanish words as fresh violations. The
  reported lines are not the offender, which is the expensive part: the author looks where the
  guard points. Worked around on that branch by rewording the path. Fixing it properly needs a
  scanner that knows a comment opener inside a string or a line comment is not a comment opener,
  which is the same care `scripts/column-vocabulary.test.ts` already documents for its own
  comment handling. Until then the hedge is in `CLAUDE.md` §3.

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
  - **The guard sees ci.yml alone.** `scripts/ci-workflow.test.mjs` reads that one file as text, so a
    future push-triggered workflow that groups by ref is seen by nothing.

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
  `JSON.parse` instead, which no test reads. The guard's comment reader still has a hole of the shape
  it was rewritten to close — a line inside a template literal whose first characters open a block
  comment swallows the code below it — narrowed to line-leading openers rather than closed, because
  closing it needs a parser. And the detector only reads a builder call whose receiver looks like a
  database handle, so a write through a handle named something else is invisible; that was the price
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

- **Small renames and dead exports the sweep found and could not make — OPEN (T2, 2026-09-23).**
  `packages/db/src/constraint-target.sqlite.test.ts` and `migrate.sqlite.test.ts` carry a
  `.sqlite.` infix that distinguished them from a twin that no longer exists; a `packages/media`
  test title still says `bytea`; and `assertIdentifier` in `packages/provisioning` has no product caller at all
  (only its own suite and the barrel re-export), while `generatePassword`'s single caller is
  `apps/server/src/break-glass.ts`. Each is a rename or a deletion rather than a comment fix.
  Two more the sweep left, both found by the review wave rather than by the sweep's own keys, and
  both invisible to a grep over comments because they live in STRINGS and in IDENTIFIERS:
  `apps/server/src/device-session.test.ts` and `apps/server/src/management-api-passkey.test.ts`
  still name the engine in test TITLES (`(real Postgres)`, `before it reaches Postgres`) — those
  strings are what CI prints, so somebody may be grepping them; and the handle a suite binds
  `useVenueDb` to is still called `pg` (`pg.db`) across a large share of the suites that use it,
  which is the widest surviving spelling of the old engine among IDENTIFIERS — prose mentions are
  far more numerous and are not rename candidates. Both are
  mechanical renames with no behaviour attached. Run
  `grep -rln 'const pg = useVenueDb\|pg\.db' --include='*.test.ts' packages apps` for the current
  set rather than trusting a number written here.

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
  returns. One review point remains:
  - The loop guard reports the whole group of packages in a loop, not a path through it, so a failure
    does not say which link to cut. Optional: print one cycle path alongside the group.
- **Nothing notices if the outstanding-sales query stops linking its settlement check to the sale**
  (found 2026-09-14 while removing the tenant filters; the gap predates that branch). A sale is
  excluded by `not exists (select 1 from sale_settlements ss where ss.sale_id = s.id)`
  (`packages/core/src/list-outstanding-sales.ts`). Deleting the `ss.sale_id = s.id` link — which
  would hide every outstanding sale as soon as any other sale was settled — left
  `packages/core/src/list-outstanding-sales.test.ts` green when that mutation was run. The query is
  correct; the test is what cannot tell. **Next action:** add a case holding one settled sale beside
  one unsettled one, and confirm it goes red with the link removed.
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
- **A table named inside a trigger's BODY is a cross-module edge no guard sees — OPEN (2026-09-23,
  from #496).** `scripts/module-graph-honesty.test.ts` reads each `CREATE TRIGGER … ON <table>` but
  never the statements between `BEGIN` and `END`, and the engine does not catch a missing target
  either: on `node:sqlite` (Node v26.7.0) a trigger whose body names a table that does not exist is
  created without complaint and fails only when it first fires. Today's only instance is declared
  (media's triggers on `media_images` read core's `products` and catalogue's `category_details`, and
  media's `requires` names both), so nothing is broken. **Next action:** extend the guard to collect
  table names from trigger bodies (`FROM`, `JOIN`, `INSERT INTO`, `UPDATE`, `DELETE FROM`), with a
  negative control per statement shape, and prove it by deleting `catalogue` from media's `requires`.
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
  screen…" (about lines 100 and 114) may not render the screen their titles name. The shared fake
  API there has no `getContentLanguages`, which boot has called since #339, and its `getTill`
  returns no `canvas`, so the till would show `boot.error` or the lock screen. Found by reading; not
  run.

**Next action:** decide whether discard, advance and mark-collected go through `#refreshAfterWrite`
with their own "X succeeded, but…" strings, and what login and retrieve show when their refresh
fails. Run the two a11y cases with an assertion that `till-counter-screen` exists; if it is
absent, move the canvas and `getContentLanguages` into the shared fake.

**The units screen puts a missing abbreviation's refusal beside the name — OPEN (found
2026-09-23, dashboard coverage, PR #538).** `apps/dashboard/src/screens/units-screen.ts` (about
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
through. Found by reading; no test pins it. **Next action:** have the
refusal name the field (or check each field separately), then place it test-first.

**Dashboard leftovers from the coverage branch — OPEN (found 2026-09-23, PR #538).** Each from
reading unless marked run:
- Two dashboard client methods nothing calls: `connectPaymentProvider` and `addReader` in
  `apps/dashboard/src/api/client.ts`. Run:
  `grep -rn --include='*.ts' -E '\b(connectPaymentProvider|addReader)\b' apps packages` finds no
  call to either method in `apps/` or `packages/`, tests included; the other `addReader` hits are a
  local helper of that name in `apps/server/src/payments-api.test.ts`, the providers' own client
  methods and the provider panels' calls to them. The provider panels
  (`packages/payments-stripe/src/dashboard/stripe-connect-form.ts`,
  `packages/payments-stripe/src/dashboard/stripe-add-reader.ts`,
  `packages/payments-sumup/src/dashboard/sumup-connect-form.ts`,
  `packages/payments-sumup/src/dashboard/sumup-add-reader.ts`) call their own packages' clients.
  #610 removed the stale comments on the two methods. Left in place because lane B's variants work
  (#511 to #556) was then due to change that file.
- `wt-dialog` re-sends the native dialog's `close` event as `wt-close`
  (`packages/ui/src/components/wt-dialog.ts`), and the native event arrives a task after the dialog
  closes — the same mechanism the Task 11 entry "Dismissing a nested form fires TWO cancels, and
  only two of five forms guard it" measured. So a dialog reopened within that task is shut again:
  `wt-dialog`'s own close handler (`onClose`, about lines 83-86) sets its `open` to false, which
  closes the native dialog, and then the screen's handler clears its state. `staff-screen.ts` and
  `purchases-screen.ts` have no guard; their tests wait out the late close rather than guard it
  (`staff-screen.test.ts`, `purchases-screen.test.ts`). `profile-screen.ts`'s flag
  (`#closingModal`) protects the screen's mode but, we believe (by reading, not tested), not the
  dialog itself. `apps/dashboard/src/widgets/allergen-picker.ts` avoids the problem by mounting a
  fresh dialog for each open (`keyed`, about lines 215-222). Seen once under coverage load in a test
  (run); we believe a person cannot reopen it that fast; not tested.
- `my-schedule-screen.ts` shows "no swaps" / "no absences" while those lists are still loading.
- `content-languages.ts` sends `languages-closed` twice on Cancel (counted in a test run), and its
  Enter-to-save cannot fire because the dialog holds no text box.
- `login-screen.ts` checks an account link's purpose with `=== null`, so a reply with no purpose at
  all would pass; the server always sends one.
- Guards no test can reach, left uncovered rather than deleted: the canvas editor's "no draft" and
  "no selected card" guards, several `?? []` and `?? null` fallbacks in the printers, payments,
  kitchen, backup, devices, printing-rules, my-schedule, profile, extra-list and option-list files,
  and a handful in `dashboard-app.ts` and `login-screen.ts`. **Next action:** delete them with a
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

**`quoteLiteral` still quotes for PostgreSQL, and SQLite refuses its backslash form — OPEN (found
2026-09-23, identity's coverage review, PR #526).** `packages/shared/src/sql-literal.ts` doubles every
backslash and wraps the value in `E'…'` when it contains one, and its header argued from
PostgreSQL's `standard_conforming_strings` (since #579 the header only says the `E'…'` form is
PostgreSQL's and SQLite refuses it). Measured 2026-09-23 on `node:sqlite` (Node v26.7.0):
`select E'a\\b' as v` fails with `near "as": syntax error`, and in a plain literal SQLite keeps a
backslash as itself, so doubling it would also change the value. Its one product caller,
`packages/db/src/change-feed.ts`, quotes fixed relation type names with no backslash, so nothing
fails today. **Next action:** make it SQLite's rule (double the single quote only), test-first with a
backslash case, and drop the header's note.

**Two identity error descriptions say less than the code raises — OPEN (found 2026-09-23, identity's
coverage review, PR #526).** In `packages/identity/src/errors.ts`, `account_action.invalid` reads
"unknown, expired, or already used", but it is also raised for a live proof whose person has since
been suspended, activated or lost their login email; `management_session.required` reads "unknown or
already ended", but `profile.ts` also raises it for a live session whose person row is gone. The
tests for each case are in `account-action.test.ts` and `profile.test.ts`. **Next action:** widen
the two descriptions to the cases the tests pin.

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

**The media library reads the whole `media_images` table on every page load, inside the venue write
lock — OPEN (found 2026-09-23, task F1's review wave).** `packages/media/src/images.ts` selects
every row and every column, then filters by label, scores the search, sorts and pages in JavaScript.
On PostgreSQL this was a GIN-indexed `tsvector` query with SQL `order by`, `limit` and `offset`. The
route (`GET /management-api/images`) runs through `withTransaction`, which on this engine is the
venue's exclusive write lock — so the scan blocks every writer on the file, a sale included. `limit`
is capped at 100 but the READ is unbounded. `listImageLabels` and `listImageTranslationGaps` have
the same shape. **What can and cannot go back to SQL:** the relevance ranking was argued not to, in a
comment #609 deleted as partly false, so that is untested; the label filter, the date and name sorts and the paging can —
`labels` is a JSON text column and this SQLite has `json_each`, and a page with no search term needs
no scan at all. **Next action:** move the non-search path back into SQL; how far to push the search
path is a separate decision.

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

**The store's file layout is re-declared in two app files — OPEN (found 2026-09-23, task F1's review
wave).** `packages/store/src/index.ts` declares `VENUE_FILE`, `NODE_FILE` and the sidecar suffixes
privately; `apps/server/src/db-wipe.ts` and `apps/server/src/restore.ts` each name them again. Which
files a venue directory holds is the store's property. Add a file or a sidecar and the wipe and the
restore silently miss it — and the restore is the cold-recovery path (`CLAUDE.md` §5). **Next
action:** export the names from `@waitron/store` and read them.

**`RESTRICT_VIOLATION` and `TRIGGER_ABORT` are the same number, and only one has a message-aware
predicate — OPEN (found 2026-09-23, task F1's review wave).** Both are `[1811]`, because SQLite
gives a foreign key's `ON DELETE RESTRICT` and every hand-written `RAISE(ABORT)` the same result
code. `triggerRaised` exists for the trigger direction and matches the exact words. The restrict
direction has no equivalent, so `isRefusal(err, RESTRICT_VIOLATION)` is true for EVERY trigger
refusal as well — including the append-only ones. Two callers take it:
`packages/layouts/src/canvas-store.ts` and `packages/layouts/src/device-profile-store.ts`. Both give
the right answer TODAY, and only because exactly one trigger sits on each path — the device-profile
one is `device_profile_form_factor_locked`, whose meaning happens to match `device_profile.in_use`.
A second refusing trigger on either path would be translated as the first. **Next action:** match by
the words, using the constants `packages/db/src/trigger-refusals.ts` already declares for exactly
this reason.

**`VenueMigrationOptions.appendOnlyTables` is optional while `MigrationSet.appendOnlyTables` is
required — OPEN (found 2026-09-23, task F1's review wave).** `applyMigrations` reads it as `?? []`,
so a caller passing a plain `MigrationOptions[]` gets a migrated database with NO append-only
triggers, silently. It is a stated hedge rather than an accident — `applyMigrations`' own comment says a caller
that "hands over no `appendOnlyTables` gets a migrated database with no triggers on it" — and there are
no standing violations: all ten product callers go through `migrationOptionsFor`, which always
carries the set's tables (checked at this head). Given `CLAUDE.md` §5, the property deserves a guard
rather than a paragraph. **Next action:** a root guard that every non-test `applyMigrations` call
passes a `migrationOptionsFor(...)` result.

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
  `scripts/comments-only.mjs` parses with the version 6 API (`ts.createSourceFile`), so it has to be
  ported, or the alias kept for it, before that move. The whole arrangement, with the receipts, is in
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
- **Three `packages/db` files contribute nothing to the gated score, and the table prints that as
  `0.00%`.** Run 35528428168's aggregate lists `src/change-feed.ts`, `src/classification.ts` and
  `src/testing/venue-db.ts` as `0.00%  0/0`. Nothing was killed because nothing was counted: the
  score's denominator takes only `Killed`, `Timeout`, `Survived` and `NoCoverage`
  (`scripts/mutation-aggregate.mjs:16-17`), so every mutant in those three files ended in some other
  status — `Ignored`, a compile error or a run error. Which of the three it is has not been checked,
  and it matters, because a compile error is a broken measurement while `Ignored` is a deliberate
  one. Meanwhile `ratio()` returns 0 when the denominator is 0 (`scripts/mutation-aggregate.mjs:89`),
  so a file nobody measured is displayed exactly like a file whose every mutant survived — the worst
  reading in the table given to the case that carries no reading at all.

**Left behind by raising the `packages/ui` mutation score (#466, 2026-09-20).** Two edges the
branch found, checked, and consciously did not take.

- **A vacuous test in `packages/ui/src/components/wt-combobox.test.ts`.** "disabling an open panel
  closes it, so nothing further can be selected" passes whatever the component does: once the panel
  is hidden its keystrokes never reach the component at all, so the assertions that follow are about
  a combobox nothing typed into. Measured while writing the neighbouring tests, not inferred. The
  repair is to drive the refusal the test names through a path that actually reaches the component,
  or to delete the test and say what replaced it.
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
  untouched rather than resolved.

**Left behind by the dependency refresh (#432, 2026-09-19).** Nineteen dependencies moved to their
latest minor or patch release; one loose end came with it.

- **Five manifests had their declared floor raised, and nobody has said whether that is the house
  style.** `hono` was declared `^4.6.0` and `^4.7.0`, `pg` `^8.13.0`, `playwright` `^1.49.0`,
  `@types/pg` `^8.11.0` and `@aws-sdk/client-s3` `^3.700.0`, in each case well below what was
  installed, while their siblings in the same files were declared at the installed version. #432
  raised them so that every package declares one identical range, which is now the shape of all
  nineteen. No commit or doc explains why those floors were low, so this was a judgement, not a
  rule being followed. If low floors were deliberate, the revert is one line per manifest.

**Left behind by the esbuild upgrade (#439, 2026-09-19).** The four packages that build bundles
moved from esbuild 0.25.12 to 0.28.2. Two things it could not take with it:

- **Two esbuild copies older than ours stay in the tree, and they are not ours to move.**
  `drizzle-kit` declares `^0.25.4` and resolves 0.25.12, and it also pulls the deprecated
  `@esbuild-kit/esm-loader`, which carries esbuild **0.18.20**. Those ranges belong to those
  packages: the only way to move either copy is to upgrade `drizzle-kit`. Nothing currently planned
  does, and `pnpm install` warns about the package that brings the 0.18.20 one on every run.
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
  pull request `image` is gated on `deploy/` having changed (`.github/workflows/ci.yml`, the `image`
  job's `if`). So `image` DOES build the SPAs on a pull request that touches `deploy/`, and on every
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
  `getBrowserCapabilities()` are new in 14.0.0 and nothing in the tree calls them. One of them is
  adjacent to something the dashboard already does: the login screen gates on
  `browserSupportsWebAuthnAutofill()`, and whether `browserSupportsPasskeys()` would improve that gate
  has not been assessed.
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
5. **`packages/identity/src/totp.test.ts`'s "rejects a wrong token" case can fail by chance.** It
   sends `000000` against a freshly generated secret and expects a refusal (a comment in
   `verifyTotp`'s catch called `000000` "well-formed-but-wrong" until #559 pruned it).
   It is not always wrong: while PR #534 was in review, Codex fixed a secret and a clock at which
   `000000` IS the valid code, and `apps/server/src/me-api.test.ts`'s authenticator test answered
   200 where it expected 401. That test now picks a code that is invalid for the enrolment's secret
   at the current time; the identity case still carries the old assumption. Fix
   the same way: derive a code the secret does not accept, rather than a constant.

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
- **Three shipped error codes were deleted rather than deprecated, and the owner has not ruled on
  it.** `stripe.tenant_mismatch`, `sumup.tenant_mismatch` and `payment.webhook_tenant_mismatch` went
  when the condition they described — two taxpayers disagreeing — stopped being reachable. `CLAUDE.md`
  §3 says a shipped code is never renamed and that you deprecate and add a sibling; this backlog says
  removing one is the owner's call; and the nearest precedent, in a file #378 edited, keeps a retired
  code registered with a note saying codes are never deleted once shipped. The case for deleting them
  is that Waitron is pre-production with no deployed consumer reading them. **Next action:** the owner
  decides. Re-registering all three as deprecated siblings is a small change either way round.
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
  2026-09-23). The same idea has four labels today, found by grepping the English strings
  (`apps/dashboard/src/i18n/strings.ts`, `packages/venue-service/src/dashboard/strings.ts`):
  products and venues say **Active / Inactive** (`product.inactive_badge`, `venue.inactive`);
  printers, card readers and staff say **Disabled** with a **Disable** action
  (`printers.status_inactive`, `printers.status_revoked`, `payments.reader_disabled`,
  `person.mark_inactive`); extras and options say **In use / Not in use** (`extras.not_in_use`,
  `options.not_in_use`); and a generic `action.deactivate` ("Deactivate") exists beside
  `action.disable`. Branch 2 of the one-product model settles products on **Active / Inactive**,
  kept separate from **Available** (sold out for now). **Next action:** pick the one
  pair, and the one action verb, for every screen whose record is switched off rather than deleted —
  deciding first whether a revoked printer or a disabled login is really the same state as an
  inactive product — then change the English and Spanish strings together and record the rule in
  `docs/developers/design-system.md`. String keys are not renamed on the way (only their text), so no
  test or code that names a key moves.

- **The Waitron wordmark is invisible on the dashboard banner in the dark theme** (seen 2026-09-14
  on the dashboard alerts branch; confirmed 2026-09-16 during #378's run-it
  verification, which also settled that it predates both branches — `packages/ui/brand/waitron-lockup.svg`
  last changed in #284, on `main`, and neither branch touches it). One file is served to both
  themes, as an `<img>`, so it cannot follow the theme: the wordmark's letters are painted
  `#16181d`, and the dark theme's page background is `#101216` — a contrast ratio of 1.06 to 1,
  where 4.5 is the readable minimum. **Next action:** give the lockup a light and a dark variant, or
  paint the wordmark with a token by inlining the SVG instead of loading it as an image.
- **The Sales and takings screen reads zero between midnight and the venue's business-day cutover,
  while Overview shows the day's sales** (found 2026-09-16 during #378's run-it
  verification; it predates that branch, which does not touch either screen). The screen seeds its
  date range from `today()` (`apps/dashboard/src/date-utils.ts`), which is the UTC calendar day, and
  hands that date straight to the daily close's `businessDay` parameter. But a sale rung at 01:00
  still belongs to the PREVIOUS business day until the venue's cutover, and Overview asks the server
  for the business day it computes itself (`currentBusinessDay`, `apps/server/src/report-api.ts`).
  So the two screens disagree for those few hours every night. `today()`'s own comment flags the UTC choice. **Next action:** seed the range from the venue's business day, the same value
  Overview renders, rather than from a UTC date.
- **An imported configuration no longer carries "already offered a passkey"**: a configuration
  transfer strips `passkey_offered_at` on export and refuses a bundle that still carries it.
- **The login screen's automatic passkey attempt can show "Something went wrong, try again" on load**
  (seen 2026-09-14 while taking screenshots for the dashboard alerts branch; the same happens on
  `main`, so it is not that branch's bug). Playwright's headless Chromium 149 refuses the attempt
  with a `NotSupportedError`; installed Chrome 153 left it pending with no error. Whether a real
  person's browser ever hits it is untested. Mechanism: the attempt's `catch`
  (`apps/dashboard/src/screens/login-screen.ts:680-687`, from #305) stays quiet only for
  `NotAllowedError` and `AbortError`, and `codeOf` (`packages/dashboard-kit/src/codes.ts:36-38`)
  returns any `code` it finds, so a browser error's old numeric `code` (9 for `NotSupportedError`)
  wins over the fallback and, matching no registered message, shows the generic sentence. The
  passkey button's `catch` (`:643-645`) has the same flaw. **Fix direction:** the automatic attempt stays silent on every browser-side failure, and
  `codeOf` accepts only a string code (check its other callers first). Seen again on 2026-09-16
  while running #378 for real: the red banner is there on a clean first load of the
  login page, before anyone types anything. It predates that branch — the swallow list it comes from
  is on `main`.
  2026-09-19: the browser moved and the refusal did not, so the version is not the cause. Playwright
  1.63 ships Chromium 153.0.8010.12 (build 1243) where 1.61 shipped 149.0.7827.55 (build 1228) —
  the same major as the installed Chrome this entry contrasts it with. Probed in that new build,
  headless, over `http://localhost` so the page is a secure context:
  `PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()` returns `false`, and a
  `navigator.credentials.get` with an empty `allowCredentials` still throws
  `NotSupportedError: Resident credentials or empty 'allowCredentials' lists are not supported`.
  What the headless browser lacks is a platform authenticator, which no version bump supplies, so
  expect the banner to still be there. The screen itself has not been re-opened on the new build.
- The till renders `person.suspended` as "Account suspended" — align with the dashboard's Disabled
  terminology.
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
- **A failed HTTP response is assumed to carry our JSON error envelope, in two more clients.**
  `apps/setup` was fixed on 2026-09-13 after a real failure: a provisioned box answers an unmounted
  setup route with `404 Not Found` as `text/plain`, so `await res.json()` threw and the throw escaped
  looking like a network outage — the operator was told to check the power of a machine that was
  working. `packages/dashboard-kit/src/request.ts` and `apps/till/src/api/client.ts` still do the same
  unguarded parse, and NEITHER has a `.catch`, so any non-JSON error body throws in both. What caught
  us in `apps/setup` was a `text/plain` 404; the `null` body is a second way in, found by review
  rather than in the field, and it defeats a bare `.catch` too because `null` is valid JSON. **Next action:** guard both parses and keep the HTTP status
  on the rejection, as `apps/setup/src/api/client.ts` now does. Note `null` is valid JSON, so a
  `.catch` alone is not enough — the parsed value needs checking too.
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

- **`readImage` asks the database for the same row twice** (`readImage`, `packages/media/src/images.ts`). It
  selects the image row, then calls `listImageUsages` only to take the `.length` of what comes back,
  and that function opens by re-reading the same row by id just to get its filename. Handing it the
  filename `readImage` already holds would turn five queries into four.
- **Checking one product's translations re-reads the language configuration once per value**
  (`packages/catalogue/src/content-languages.ts`). `validateContentTranslations` reads the one-row
  configuration on every call (the advisory lock it also took went with the storage switch), and
  callers call it inside loops: once per variant (`packages/catalogue/src/variants.ts`, inside the
  normalisation loop) and twice for a single unit create (`packages/catalogue/src/units.ts`). There
  used to be a third, once per modifier choice, and it went with the old model in Task 13 — the
  extras and options contracts ask `findContentTranslationGap` ONCE with every map, which is the
  shape this entry is asking for. That is the shape `CLAUDE.md` §3's "resolve shared
  catalogue data once before a basket's line loop" rule exists to prevent.

**Payments:**

- Bound the HTTP body read as well as the header wait in `sumup-client.ts` (move `clearTimeout` after
  `res.text()`); lift `reverseViaStripe` and `reverseViaSumUp` into one neutral reversal primitive.
- Pre-existing `forward` retry backoff.

**Fiscal (each behind its own review, owner sign-off at land):**

- **The three alta builders are triplicated** — `recordSale`/`recordCorrection`/`recordSubstitution`
  in `packages/fiscal-verifactu/src/backend.ts`. Safe
  seam: a helper taking the assembled `Omit<AltaInput,"Encadenamiento">` plus a `buildDesglose`; needs
  a huella-invariance re-run across all three.
- `tenant.not_found` has no production thrower — keep or remove is an owner call; `mirror-bundle.ts`'s
  `r.series ?? []` branch is un-exercised; export `ID_SISTEMA_MAX_LENGTH` when either package is next
  touched; `insertNodeSeriesTx`'s held-code check is SELECT-then-INSERT; the SP-3d restore overlapping
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
delete its test object through `deleteMany` would reveal one. The `listedKey` value is the key as
the bucket named it, so it is the first `backup.stream_*` parameter a bucket supplies: the screens that word
these codes (Tasks 7 and 8b) must not put it in front of anyone as trusted text. Also left: `@waitron/store` is missing from the
English-only guard's `GENERIC_PACKAGES` (`packages/db/src/english-only.ts`), so it is never scanned
— I believe this predates #569 (the package dates from #489); and nothing in the package has been
run against a real provider's bucket — the unit tests drive the real S3 client over a scripted
network, and since Task 10 (#652) the loop test drives it against versitygw 1.8.0, a real
S3-compatible server run on the test machine.
`apps/server/src/rejoin-command.test.ts`'s sidecar assertions do not test the wipe: its fixture
closes the handles first, which removes the sidecars, so with `db-wipe.ts`'s `SIDECARS` cut to
`[""]` it still passes 18 of 18 (the assertions predate #548: aabdde6a8, #489). The wipe's
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
  78.1 s (one run each). (2) DONE by A44 for the deadline: a question given up at it logs
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
  page's `server.boot_failed` detail was not tested with it. **Open, not fixed:**
  `backup.stream_name_invalid`'s `value` for `field: "listedKey"` (the `list` in
  `packages/stream/src/s3-store.ts`, and `packages/stream/src/generations.ts`) is a key as the
  bucket's listing named it, so it is bucket text in params too. Whether it reaches a log line or
  an answer was only read, not run: the wizard's bucket restore lists the bucket
  (`packages/stream/src/bucket-times.ts`) and its error boundary logs and answers params as they
  are, which suggests it can. Left by #686 and A57: that a real bucket's 403 to this LISTING reads
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
`/app/third-party/` holds notices for libvips and Litestream only, and the print-agent image has no
`/app/third-party/` at all. Measured 2026-09-24 in the
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
| 3 | Fiscal layer | Verifactu lib + `FiscalBackend`; settlement, R5 rectificativas, F3 canje, invoice-first; fiscal is a module (`fiscal-verifactu`, `fiscal-none`) | F3 asesor/XSD confirmations; cert distribution to a promoted node; a foreign business customer's identifier type (A1a) |
| 4 | Payment layer | `PaymentProvider` + Stripe Terminal, manual card, integrated Stripe, Mode-3 webhook, SumUp Cloud API (#309); dashboard provider/reader configuration and adoption (#323, #329) | webhook `recordSale` hand-off; reconcile remediation UI; the handheld NFC/QR link (A6) |
| 5 | Identity | persons/sessions, PIN (+ per-device throttle), `authorize()`, roles/permissions, passkeys, email-first dashboard login, emailed invitations and password resets, encrypted TOTP and recovery codes, user admin (#298, #328); a one-time passkey offer on first password sign-in (#347); identity state replicates to a standby | admin-editable roles; security-change emails; mid-shift-suspension enforce; discount gate; till-refund enforce |
| 6 | Locations | provision-a-sellable-venue (`waitron-provision venue`); departments, zones and menus (#297) | multiple locations, edit/deactivate; then location-scope the by-id verb family |
| 7 | Counter POS | walk-up cash, park/retrieve, manual + integrated card, prepare & collect, canvas/receipt editors, receipt/drawer printing, cash-drawer authorization — operable end to end | — |
| 8 | Reporting | daily close, frozen *cierre Z*, VAT summary, modelo 303 output+input VAT + DR303 file/download, purchase-invoice UI; dashboard sales screen + business-overview home | fiscal filing remainder parked (*Detail → Reporting*) |
| 9 | Deployment | the box as two containers with `waitron.sh` install/reset (#285, #314); guided node onboarding (#296); boot diagnosability (#310); CA-trust onboarding + per-OS certificate walkthrough (#330); till reroute S1–S6; promotion endpoint (#272) | USB installer (B3); cloud standby live link + the Waitron Cloud boundary |
| 10 | Tabs / table service | TS-1 tables+tabs, TS-2 statuses, TS-3 move/join/merge, TS-4 transfer, till action-flow wiring, TS-5 split-bill (#324) | core COMPLETE; owner-added extensions parked |
| 11 | Floor plan | FP-1 live floor + FP-2 spatial canvas/editor | — |
| 12 | KDS / devices | KDS-1 stations/routing/tickets, KDS-2 courses/fire, KDS-3 expo, KDS-4 kitchen printing, order-timing alerts; device identity + profiles (#199, #231, #269) | routing audit view; expo device kind; device-scoped fire/collect routes |
| 13 | Tips | attribution stored (`tenders.tip_amount`) — UI collection ONLY on the integrated-card idle screen | tip-collection UI for cash / manual card / handheld (A8); payroll export (integrate-not-build) |
| 14 | Bookings | Bookings-1, now the `@waitron/bookings` module (#270, #273) | public/online/QR, availability, reminders, CRM, recurring, calendar grid, deposits |
| 15 | Online ordering | — | not started (later phase) |
| 16 | Workforce | *registro de jornada* (chain per node since #268), D2 scheduling, roster authoring + approvals, staff request path + portal | **wage-computation engine** (convenio-gated); D3 payroll export (integrate-not-build) |
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
`roleName`, `apps/dashboard/src/i18n/domain.ts:180`, custom ones will not be).

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
- Later kiosk options, none built: Chromium `--kiosk` in the box image and Fully Kiosk resale for
  dedicated tablets. Cloud-managed device enrolment is tracked in the
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

[Spec](superpowers/specs/2026-08-08-reporting-desglose-and-modelo303-spec.md). Two pre-filing caveats
a human must clear before the first LIVE 303 filing: validate the DR303 file once against the real
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
| **Q14 (precuenta → amendment log)** | a printed pre-bill may oblige an amendment log | **Open** — the interpretive hinge |
| Q21 (pre-bill, or the invoice when a table asks for the bill) | the table screen prints no pre-bill; when one is built, printing it never fires held food and never marks a line sent (menus plan D10) | needs advisor |
| F3 canje (`IDOtro`, a separate F3 series, `Destinatarios` XSD) | foreign recipient refused; F3 reuses `standard` | needs advisor / XSD before the first real filing |

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
