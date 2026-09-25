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

The Settings → Cloud services screen and local manager adapter now implement the
[connection journey](developers/cloud-connection.md). Two real Waitron SQLite servers
pass the Cloud repository's browser integration proof, including restart, a lost
completion reply and swapped installation proof refusal. Cloud and local approvals
remain separate; the local server checks live manager permission and serving-primary
status before final signing. Installation keys stay in node-local state.

Installation credentials now use key-bound one-hour leases, with a background refresh
worker, cached status and explicit owner/manager revocation. Pending operations survive
lost replies and restarts; the real two-server runner proves renewal and revocation
recovery without changing fiscal authority. Both languages show service configuration
and observed health separately. Observations are synthetic until service adapters exist.

The local remote-access integration now covers venue-owned staff certificate keys,
CSR/install commands, live TLS reload and the minimal public availability endpoint.
Cloud owns the two-server WireGuard/HAProxy proof, bot gate, DNS override, gateway
replacement and revocation. Customer remote setup UI and production deployment remain
open. Disposable backup fixtures now capture real SQLite archives and restore them
through Waitron validation, migration and module hooks for Cloud's local two-venue
proof. The backup fixture supplies normal on-disk identity/TLS state, proves source
Cloud credentials and staff TLS keys are excluded, and drops old backup destination
settings on the test replacement. The signed capture client now reserves upload authority,
uploads directly with scoped credentials, and publishes exact snapshot metadata through Cloud.
It renews the current control lease, rejects unbound replies and keeps upload secrets out
of connection state. The serving-primary test installation now schedules daily snapshots,
keeps one encrypted archive for exact retries across restart and assigns monthly retention
to the first successful capture in each venue-local calendar month. The file uploader
streams with a 14-minute/credential-expiry deadline and bounded retry backoff; shutdown
cancellation does not record an outage. The Cloud local proof crashes after upload and
restores the resumed archive without recapture. Production deployment remains open. Confirmed
uploads retry publication without retransferring; an acknowledged
object lost by storage waits until the 24-hour expiry before recapture. Capture requests
waiting on the Cloud client can be cancelled. Shutdown waits for an in-progress local
database copy or encryption step. Next: measure that shutdown latency, real venue uplink
budgets and spool disk use, and stream
archive assembly beyond its current in-memory 512 MiB format limit. Cloud documentation:
`docs/authenticated-captures.md` in waitron-cloud.
The setup wizard now guides a fresh replacement through Cloud owner approval of one verified
snapshot for a test venue. The replacement keeps its request key private, downloads only the
approved encrypted object with temporary read authority, rechecks approval, then stages it through
the existing cold restore. Its completion report follows actual local restore. The managed path
excludes old backup destination credentials; local-file restore remains available. The Cloud
integration proof exercises owner approval, restart, lost replies and the real target restore.

The restored test-server Cloud replacement path has landed (#638). You use the reported guided
recovery request and its original approval link and code. The replacement stores fresh installation
and WireGuard keys before contacting Cloud, then imports registration only after the original owner
confirms it. The two-repository local proof covers replacement, a new capture, archive restore and
refusal of the old installation's grant. Installing the new tunnel and TLS certificate remains an
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

2. **Somewhere for things that went wrong to show up** (A5) — designed 2026-09-14; the `till.configure`
   split it depended on has LANDED (#363). Branch 1, the alerts framework and recorded incidents, has
   LANDED (#368): it shows recorded incidents such as a rejected filing or a payment drift in the
   dashboard's bell and Alerts screen. Branch 2, the ongoing checks, has LANDED (#371): a silent print
   agent, a fiscal outbox that has stopped or fallen behind, a missing tax certificate, print jobs
   stuck at a printer, a low reader battery, and backups that are off, failing or stale now surface
   too. What A5 still lacks is the pairing alert ("devices tried to join") and a standby that has
   fallen behind; see A5.

3. **Backups that leave the box** (B2) — S3 first, then Drive. With the mirror deferred, a bucket is a
   standalone primary's only off-box copy. Only `LocalFsBackend` exists.

4. **The displays and the printers walked at the real box** (A4, A3) — till, handheld and KDS through
   [ui-review.md](ui-review.md), and the first physical print since #327: slips, duplicates, the
   drawer pulse, the feed-before-cut.

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
and a category delete that says where its products and subcategories go. A seeded venue built by the
previous `main` upgraded cleanly (measured), so no reset is needed for it. Left open for the owner:
confirm the deletion defaults (spec §2.1: products and subcategories go to the parent; for a
top-level category, products become Uncategorised and subcategories top-level); whether label names
should ignore capitals (today "Alcoholic" and "alcoholic" can both exist — a small migration if so);
`Product.categoryId` and `primaryCategoryId` now always hold the same value; and the per-product
label routes and `?descendants=1` on a category's products have no dashboard caller yet. The owner lifted the
wait: the dependency upgrades are finished, and the work does not wait for SQLite slice 2. The
menus plan's decisions D1–D23 settle the spec's open integration points; D6, D9, D10, D11, D12,
D13 and D22 are the ones flagged for the owner. Menus Task 3 wipes existing venues (it rebuilds
`menu_items`); every other migrating task adds tables or columns only and measures its own upgrade.
Every dev venue then needs `wa-wt reset demo <name>`, and the owner's box should be wiped once
after menus Task 7 lands.

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
   Products overhaul is specified as four parallel builds: Units, Modifiers, Categories and Products.
   Categories has landed (#340, see below), with [integration notes](developers/product-categories.md),
   and Modifiers has landed (#341, see below), with its
   [integration contract](developers/modifiers.md). Units has landed too (#342, see below), and
   Products has now landed as well (#345, see below), which completes the overhaul: all four builds
   are in. Products integrated the three supporting sections into one replacement editor, withdrew
   recipe authoring from the dashboard, carried variants through menus and saved sales, and added
   [operator guidance](products.md). One question is left hanging over it: the existing zero-rate class
   is shown as **No tax (0%)**, and asesor Q20 asks whether any intended case legally needs N1 or N2
   instead — to be answered before the first live filing, not before more building. See the
   [checkpoint](superpowers/plans/2026-09-13-product-editor-checkpoint.md),
   [spec and plan](superpowers/specs/2026-09-12-product-editor-design.md) and
   [shared design](superpowers/specs/2026-09-12-products-overhaul-design.md).
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
languages product and menu text is written in and which one is the fallback (receipt languages stay a
separate setting); photos live in a shared library with translated names, alt text, search and reuse,
and a picture cannot be deleted while a product uses it. Image bytes and metadata moved into a new
mandatory `packages/media` module, so backup, restore, replication and configuration transfer carry
them like any other module's tables.
[Image-library design](superpowers/specs/2026-09-12-image-library-design.md),
[content-language design](superpowers/specs/2026-09-12-content-languages-design.md),
[operator guide](content-and-images.md).

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

**Follow-up — the image library was unusable as shipped, fixed in #344 (2026-09-13).** Three faults in
`packages/media` were fixed: the screen returned a 500 on its first (empty-search) load; alt text was
wrongly required both to save a picture and to switch the default content language; and the upload and
edit dialog now shows a preview of the chosen picture.

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

**Photos are shrunk on upload (slice 2, Task 0) — LANDED #543 (2026-09-24).** Every upload is resized to at most 1600 pixels on its longer side, turned upright,
stripped of its metadata (GPS position included) and stored as WebP at quality 80 by `prepareImage`
(`packages/media/src/prepare.ts`), which the upload route calls before it opens the write
transaction (`packages/media/src/routes.ts`). Measured on ten real food photos by the slice-2 plan's
Task 0 drafter, a stored photo averages 171 KiB, so 5,000 take about 0.87 GB instead of about 18 GB.
sharp does the work; every server bundle leaves it out (`--external:sharp`) and the box image
carries it in `/app/node_modules`.

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

**Product categories — LANDED #340 (2026-09-13).** A product can belong to several categories without
its sales being double-counted; at most one membership is primary and names the order line and the
kitchen route. Categories get their own page at `/manage/categories` with translation, a picture, a
parent, and a delete that previews what will change and then proceeds rather than refusing. Labels on
past orders stay readable. [Design](superpowers/specs/2026-09-12-product-categories-design.md),
[API and integration guide](developers/product-categories.md). _2026-09-25: the several-categories
membership is gone. Sales classification Task 1 gives each product one main reporting category in a
strict tree, plus any number of flat labels, and drops `product_categories`; the guide above is
rewritten for it._

What it left open:

- **A populated database cannot be migrated onto this — it has to be reset.** Core migration
  `0020_category_names` drops the old text `categories.name` column and recreates it as required JSON,
  with no translation and no backfill. A disposable probe ran the real SQL against a category that had
  a text name and it failed with `23502` (a required column left empty), which is the expected and
  documented outcome. So any preproduction or development database with categories in it goes through
  the normal reset workflow (`wa-wt reset demo` or `wa-wt reset onboarding`), not a plain migrate.
  **This happened, on 2026-09-13** — the next person to start the dev stack got a dead server, a raw
  driver stack trace, and a dashboard that answered a sign-in attempt with nothing more than its
  generic "Something went wrong, try again". Boot now names the reset as a conditional remedy
  instead of leaving the stack trace to decode
  (`apps/server/src/dev-migration-hint.ts`, `WAITRON_ENV=dev` only); the mechanism and the limits of
  what that line can claim are in [the workflow guide](developers/workflow-guide.md). The underlying
  trap is unchanged: **a populated development database still has to be reset by hand.**
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
switchable between a tree and a flat list with a name filter, a per-category colour shown as a swatch
and lozenge, and a per-category products window with bulk add. Reporting category became optional and
delete previews then proceeds; what it left open is recorded in the #340 list above.
[Design](superpowers/specs/2026-09-13-categories-screen-design.md),
[plan](superpowers/plans/2026-09-13-categories-screen.md).

**Category management reworked — LANDED #362 (2026-09-14).** The categories screen, its form, the
product-categories editor and the products dialog share one layout with searchable `wt-combobox`
pickers and reader-language names, and the shared `wt-data-table` gained opt-in search, per-column
filters, a starting sort, filtered-tree parent rows and a remembered per-tab view. What it left open is
recorded in the #340 and A7 lists. [Design](superpowers/specs/2026-09-14-category-overhaul-design.md),
[plan](superpowers/plans/2026-09-14-category-overhaul.md).

**Category colour and membership layout — LANDED #383 (2026-09-16).** Two presentation fixes on the
categories screen: the colour picker now lays its twenty-four swatches out as hue columns so no hue
splits across a line break (the palette order is now pinned by a test), and a product's other-category
tags collapse to a localized count once there are four or more.

What it left open was a fixed preview limit of three other-category tags, and a collapsed count that
said how many categories a product had but not which. _2026-09-25: both are gone with the
several-categories membership (sales classification Task 1)._

**Product modifiers — LANDED #341 (2026-09-13).** Modifiers (free text, extras, options and a plain
yes/no) are written once and attached to many products, and the till asks for them when the dish is
ordered. What the customer chose is stored on the order line as a fact, so a held order, a fiscal
invoice, the kitchen ticket and the receipt all show the same answers even after the modifier is later
edited. [Design](superpowers/specs/2026-09-12-product-modifiers-design.md),
[integration contract](developers/modifiers.md).

What it left open:

- **Catalogue rows created before this migration keep their old caps, and nothing upgrades them.**
  The old per-group `max_select` limit does not become the new `maxTotalQuantity` cap. Following the
  repo's no-backfill rule, the fix is to recreate disposable pre-production catalogue data under the
  new schema rather than to write a data migration. Unlike Categories' migration this one does not
  force a database reset by itself — it is the old rows that will look wrong, not the schema.
- **The Units build has to keep its own quantity and precision checks.** Modifier validation runs
  independently of the product's selling unit, and extras multiply by the parent quantity even when
  that quantity is fractional. **Next action:** whoever builds Units adds its validator alongside this
  one and does not gate either on `pricingUnit === "each"` — that shortcut would silently skip
  modifier validation for anything not sold by the each.
- **The independent review did not cover the browser and rendering paths.** Claude's run-it reviewer
  worked to a bounded brief and said so; what it did run found a real repricing bug — reordering
  unchanged selections on a held order repriced an extra from 1.00 to 9.00 — which was fixed by
  comparing saved answers by value rather than by their order in the payload. The browser, receipt and
  kitchen-rendering evidence comes from the build's own focused tests plus CI's package suites, not
  from a second pair of eyes. Worth knowing before anyone treats those paths as double-checked.

**Modifiers become Extras and Options — DONE, all thirteen pull requests landed (2026-09-21).** The
single modifier idea was split into Extras (reusable product lists, each pick becoming its own sale
line) and Options (reusable label lists, saved as a note on the dish line), composed through one
ordered attachment list per product. Landed across #412, #436, #445, #449, #452, #456, #462, #465,
#469, #471, #476, #478 and #480; Task 13 (#480) deleted the legacy option-group tables, routes,
widgets and fields, leaving the shipped error codes registered and unthrown. Design:
[one product model](superpowers/specs/2026-09-18-one-product-model-design.md); plan:
[modifiers to extras and options](superpowers/plans/2026-09-18-modifiers-extras-options.md).

**THE PART OF IT THE PLAN DID NOT ANTICIPATE, and the shape worth carrying: dropping a CORE table
that a MODULE baseline references cannot be done by appending a migration to each set.**
`packages/migrations/src/apply.ts` applies sets in manifest order, core first, so a core migration
dropping `option_groups` runs BEFORE the catalogue baseline creates
`menu_item_option_groups` with a foreign key into it. Measured rather than reasoned about: with a
drop appended to each set, the virgin migrate fails inside the migrator with
`relation "public.option_groups" does not exist`, SQLSTATE `42P01`. What works is a drop appended to
the CORE set and the CATALOGUE set REGENERATED, so its baseline never names the core tables at all —
the same move `#378` made for this same set. Every module set is migrated from a virgin database
only, so a regeneration is safe there in a way it would not be for core.

Two consequences of that regeneration, both stated so nobody meets them cold. A module set's schema
version is its journal entry count (`packages/migrations/src/schema-version.ts`), so the catalogue
set goes from thirteen entries to two — a dev database migrated before this reads as AHEAD of the
image until `wa-wt reset demo <name>` rebuilds it, and nothing live is affected because Waitron is
pre-production. And about fifteen comments across `packages/catalogue/src` and its tests cited a
catalogue migration by number and line; the numbers no longer exist and the pointers were rewritten
with the change. The alternative — hand-editing the baseline instead — was weighed and is worse: it
reaches four SQL files and thirteen snapshots, and a hand-edited snapshot fails silently.

**What branch 1 deliberately did NOT build, both recorded in the design rather than forgotten:**

- **An options list is always required.** It asks for exactly one pick, with the default
  preselected, which is what today's behaviour was
  (`docs/superpowers/specs/2026-09-18-one-product-model-design.md` §2.2). An OPTIONAL options list —
  one a diner may leave unanswered — is a possible future change, called out in that spec's §11 and
  not built. Today an unanswered ACTIVE list refuses the order with `options.label_required`.
- **A variant offers its parent's lists and cannot override them.** The attachment list is the one
  thing a variant does not override (§4.4); a per-variant attachment row is a possible later
  addition, recorded in §14. Everything else about a variant — price, names, photo, VAT, category,
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
  (`packages/catalogue/src/extras.ts`), and there is no management route to it. The receipt, run on
  this branch:
  `grep -rn setMenuItemExtraLists packages apps --exclude-dir=coverage | grep -v "\.test\.ts"`
  returns the function's own definition and the comments that name it, and no call at all — every
  call is in a test suite, in `packages/catalogue` and in `apps/server` alike. The
  `--exclude-dir=coverage` is not decoration: on a checkout where a coverage run has left its report
  behind, the same command without it also returns the gitignored HTML under
  `packages/catalogue/coverage/`, which is neither source nor a caller. `createMenuItem`
  (`packages/catalogue/src/operations.ts`) used to auto-seed a new offer with the product's active
  option groups, and Task 13 removed that with the old model; the new model has no twin, and did not
  have one before either. So the publication half of the extras feature is reachable only from
  tests, while both its tables carry full CRUD for the application role —
  `GRANT SELECT, INSERT, UPDATE, DELETE ON "menu_item_extra_lists", "menu_item_extra_items" TO app_user`
  in `packages/catalogue/drizzle/0001_catalogue_baseline_sql.sql` — which is the wider version of
  the open `UPDATE` question recorded further down this file. Pinned by "omits an extras list the
  offer does not publish, and keeps the options list"
  (`packages/catalogue/src/offered-modifiers.test.ts`). **Next action:** decide whether a new menu
  item should inherit its product's extras lists by default, or whether publication stays explicit
  and a route is built for it — and settle the grants in the same decision rather than separately.

**Branch 2, variants as products — LANDED** (spec
`docs/superpowers/specs/2026-09-18-one-product-model-design.md` §4, §15;
[the plan](superpowers/plans/2026-09-23-variants-as-products.md)). A variant is now a `products` row
behind a `parent_id`; the separate `product_variants` and `menu_item_variants` tables are gone. Its
nine pull requests: Task 1 #511, Task 2 #517, Task 3 #528, Task 4 #532, Task 5 #537, Task 6 #539,
Task 7 #545, Task 8 #551, and Task 9 #556. How the model works now is in
[products.md](developers/products.md), under _Variants_. The open items each task left are in its
paragraph below. **Two of its tasks cannot upgrade a venue that holds data**
(measured): Task 1's migration aborts outright, and Task 4's either reports success while emptying
the menus' extras publications, their per-item extras prices and the variant price overrides, or,
once any order has been rung up from a menu offer (paid orders keep their lines), fails and the box
does not boot. So every dev venue needs
`wa-wt reset demo <name>` after each, and a provisioned box should be wiped once, after Task 4.
Task 3's migration drops the per-menu variant table, `menu_item_variants`
(`packages/catalogue/drizzle/0001_drop_menu_item_variants.sql`), and from Task 3 on nothing but
the configuration transfer read the old `product_variants` table, so variants a venue stored there
no longer appear: a dev venue needs `wa-wt reset demo <name>` to see variants again. Task 9 drops
that table.

**Task 1 LANDED as #511 (2026-09-23): every dev venue now needs `wa-wt reset demo <name>`, and no
provisioned box takes the image without a wipe — the owner's home box included.** Migrating a
venue `main` had already migrated aborts at the rebuild of `products` with
`error in trigger products_media_image_fk_parent_delete: no such table: main.products` and rolls
back, so the box does not boot until it is wiped (re-run 2026-09-23 through `applyMigrations`).
What it left open, each already written into the plan's later tasks: the kitchen station routing,
preparation routes and the kitchen screen's allergens and dietary labels still read a variant
line's raw columns (Task 5, dish and extras — done by #537); and republishing a variant's allergens and diet must
not write values that hide its parent's (Task 6 — done: `republishOverlays`,
`packages/catalogue/src/operations.ts`, stores a variant's column blank when it has no overlay of
its own for it, so the variant reads its parent's). Deliberately left: the counts of `products`'
columns, keys and checks in the comment of the shipped `packages/media/drizzle/0001_image_references.sql`
are stale, because editing a shipped migration changes the hash `packages/migrations/src/journal-hashes.ts`
compares. The same file's paragraph saying `product_variants.image` is deliberately not guarded is
stale too: since Task 3 a variant's photo is `products.image`, which that file's triggers guard. It
stays unedited for the same reason.

**Task 2 LANDED as #517 (2026-09-23): a product's one on/off switch is now two — Active (it exists)
and Available (sold out for now).** Delete makes a product Inactive, the products list gained a
Status filter that starts on Active, and the till offers a product or an extra only when it is
both. Its migration adds a column and needs no reset of its own. What it left open:
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
- **Raising a held line's quantity does not check the line's variant, or whether its menu or menu
  section has been switched off** — only its parent product and extras. Neither Task 3 nor Task 5
  (#537) took it, so it remains open. **Next action:** on a quantity raise, check the line's own
  product (the variant, since #537) for Active and Available, and its menu and menu section.
- **The units screen's "Availability" column shows the Active flag.** `productsUsingUnit`
  (`packages/catalogue/src/units.ts`) returns `products.active` under the name `available`, and
  that name travels in the `unit.in_use` error's details, so renaming it changes an error's shape.
  **Next action:** rename the field to `active` and head the column "Status", in one change.

**Task 3 LANDED as #528 (2026-09-23): variants are stored as products and follow their product onto
every menu.** A menu now stores something for a variant only to override its price or switch it off
there (`menu_item_variant_overrides`), and the price charged is the most specific one set: the
variant's price on that menu, then its own, then its product's price on that menu. Every dev venue
needs `wa-wt reset demo <name>` (see above). What it left open:
- **A removed variant can be reached again, and its photo cleared (resolved by Task 7).**
  Removing a variant makes it Inactive and keeps its row, photo included. Since Task 7 a removed
  variant is shown behind the status filter in the products list and in its product's variants
  section, and its own page opens from either; that page's Remove image clears the variant's photo,
  after which the image library no longer counts it for that variant (`countUsages`,
  `packages/media/src/images.ts`, counts a variant's photo only through the variant's own
  `products` row). The translation-gap report skips
  Inactive variants (`packages/catalogue/src/content-languages.ts`). A variant's customer name is
  checked against the venue's default content language only when the variant is saved Active —
  through its product's save (`setProductVariants`, `packages/catalogue/src/variants.ts`) and
  through its own page (`saveProductEditor`, `packages/catalogue/src/product-editor.ts`) alike — so
  removing a variant is never refused because its own customer name lacks that language, and
  restoring one is checked.
- **A variant's id is refused by the management routes that read or write a product by id**, each
  answering as it does for an id naming no product (the recipe route answers `product.not_found`) —
  except the product editor's two routes, which since Task 6 are a variant's own page. The
  "is this a top-level product" check now lives in one function, `productWithId`
  (`packages/catalogue/src/variant-fallback.ts`), used by the catalogue's by-id reads and writes,
  `apps/server/src/catalogue-api.ts`, `apps/server/src/kitchen.ts` and
  `packages/venue-service/src/operations.ts`; every route's answer is unchanged.
  `createMenuItem` (its own `menu_item.variant_not_allowed`) and `setProductRecipe`
  (`packages/recipes/src/recipes.ts`, which asks the opposite question) still write their own. Of
  the four writers that had no check: `applyRecipeDerivation` and `applyDietDerivation` now refuse
  a variant (`product.not_found`), because a variant has no recipe of its own, and when a parent's
  derivation changes they republish each of its variants that sets its own value for that column.
  `assignProductUnit` and `deactivateProduct` are left without one: a variant's own page gives it
  its own unit through the first, and the second (which nothing outside the tests calls) makes a row
  Inactive, which a variant may be (V6).
- **The menu offer editor accepts a price such as `007.5` that the server then refuses** — its
  pattern (`packages/venue-service/src/dashboard/venue-operations-screen.ts`, `PRICE`) is looser
  than `isProductPrice` (`packages/catalogue/src/modifier-limits.ts`). **Next action:** use one rule
  for both, checking first that the catalogue helper is safe to load in the browser.
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

**Task 4 LANDED as #532 (2026-09-23): a blank menu price follows the product's own price.** A menu row's price
(`menu_items.gross_price`) may be left empty, meaning the product's own price — the last step of the
price chain, for every product on a menu, with variants or without. The menu screen shows the
product's price as the empty field's hint and saves an emptied field as blank. **It cannot upgrade a
venue that holds data, and part of the damage is silent.** Making the column nullable rebuilds
`menu_items` (`packages/catalogue/drizzle/0003_menu_price_nullable.sql`), and inside the migrator's
transaction foreign keys stay on, so dropping the old table acts on every row pointing at it.
Measured 2026-09-23 through `applyMigrations` on Node v26.7.0, on a venue migrated with `main`'s
catalogue set and holding one menu offer with an extras publication, one per-item extras override
and one variant price override, then migrated with this branch's sets: with no order line naming the
offer the upgrade reports success and empties `menu_item_extra_lists`, `menu_item_extra_items` and
`menu_item_variant_overrides` (1 → 0 each, no error); with one `working_line_contexts` row naming
the offer it fails at `DROP TABLE menu_items` with `FOREIGN KEY constraint failed` and rolls back,
so the box does not boot. The control — the same row naming a menu item that does not exist — let
the upgrade through. A paid order keeps that row (measured 2026-09-23: after a completed walk-up
cash sale from a menu offer, its `working_line_contexts` row was still there on a `settled` order),
so any venue that has sold from a menu fails to boot, not only one with an order still open. A
fresh database migrates cleanly. So **every dev venue needs
`wa-wt reset demo <name>`, and any provisioned box must be wiped**, the owner's home box included,
now that it has landed. What it left open, both put to the owner in #532 — now both closed:
- **Creating a menu offer with no price field at all is still refused** (`management.request_invalid`);
  only an explicit `null` means "blank, charge the product's own price". **DECIDED 2026-09-23 by the
  owner: keep refusing** — _"we don't want to confuse 0.00 with `""`"_, so a missing field is never read
  as blank or as zero. Pinned by a test in `apps/server/src/catalogue-api.test.ts`.
- **DONE (2026-09-24, #541, lane C's A11b): the menu's offers list marks a blank price.** The owner's
  answer: show the product's own price struck out beside a menu price that differs from it, and grey
  out a price that is blank and following the product. A menu price equal to the product's own shows
  plainly. The struck and greyed prices carry hidden text for a screen reader ("Was", "(product's own
  price)"), and the column still sorts by the price charged
  (`packages/venue-service/src/dashboard/venue-operations-screen.ts`, `#offerPrice`). The cell reads
  the product's own price from the product list the screen already loads, not from the offers
  response: an offer is always a top-level product, which owns its price. Where that list lacks the
  product, a price the menu sets shows plainly, as before; a blank price is still greyed, since the
  offer itself records that its price is blank. The edit form is unchanged.
  Two follow-ups #541's review raised, not taken, neither blocking: (1) the dashboard's product list
  shows a variant's blank price as its parent's with no marking
  (`apps/dashboard/src/widgets/product-list.ts`, the `price` column's cell) — whether it should grey
  it the way the offers list now does is the owner's call; (2) the rule that hides screen-reader
  text now has four copies (`venue-operations-screen.ts`, `apps/till/src/widgets/numeric-pad.ts`,
  `apps/dashboard/src/widgets/variant-table.ts`, `apps/dashboard/src/widgets/reorder-table.ts`);
  a shared one in `packages/ui-core/src/base-styles.ts` would be an optional tidy-up.
The till's "+€" label on a variant, priced from the parent's resolved price, was Task 5's work and
landed with #537.

**Task 5 LANDED as #537 (2026-09-23): a variant is sold as the product it is.** The order line's
product is now the variant itself, priced and taxed at the variant's own values (a value it leaves
blank is its parent's), and printed under the variant's own names on the receipt, kitchen ticket,
basket, tab and expo queue — a blank customer or kitchen name falls back to the variant's own staff
name, never the parent's. The sale line still keeps the parent's names beside the variant's, so
a report can group by parent (Task 8). A product with an Active variant rung up from a menu without one is
refused (`product.variant_required`). On the till, every Active, Available product on a menu gets a
button whether or not it is sold alone; tapping one with variants opens a picker that lists only
the variants, with the first available one preselected and a "+€1.50"-style label on a variant
priced differently from its parent. A variant line takes its parent's preparation routes, and its
parent's kitchen station, course, allergens and dietary labels unless the variant sets its own. The two `variant_id` columns (`working_order_lines`, `sale_lines`) are dropped with
`ALTER TABLE … DROP COLUMN` (`packages/db/drizzle/0006_drop_line_variant_id.sql`), which keeps the
rows: **this task needs no venue reset of its own.** What it left open:
- **A held order brought back to the till shows a variant line with its PARENT's VAT class,
  category and allergens.** The till reads them from the offer snapshot saved in
  `working_line_contexts`, which is the parent's. Filing is unaffected — the price and rate billed
  come from the line's own stored values. Since Task 6 a variant's own page can give it its own VAT
  class, category and allergens, so a retrieved line can now show values that differ from what was
  billed. **Next action (a follow-up, not one of the plan's tasks):** save or read the chosen
  variant's values for a retrieved line.
- **The server lets a tab split take a fraction of a whole-unit line.** `carveOffLines`
  (`apps/server/src/working-order.ts`) checks only that the quantity is above zero and no more than
  the line's. I believe this predates the branch: #537 leaves that check untouched. The till now
  offers only whole numbers for such a line, using the line's frozen unit precision. **Next
  action:** refuse a quantity finer than the line's `unit_precision` on the server too.
- **DONE (Task 9): on a venue with no service zones a parent with Active variants is refused.**
  The owner's answer to lane B's question Q3, as the supervising watcher relayed it: _"a parent
  product should never be for sale as itself — you should always have to pick a variant. This
  doesn't depend on zones."_ And: _"a zone is required."_ At the time the
  till's three line-carrying routes priced by bare `productId` on such a venue, a path that cannot
  name a variant, so #556 made `priceOrderLines` (`apps/server/src/working-order.ts`) refuse the
  parent there with `product.variant_required`, Available variants or not. That path is gone since
  B4 (the next bullet), so the refusal now happens only on a zone's menu offer. A product whose
  variants are all Inactive still sells as itself. The same refusal covers an extras pick of such a
  product (a pick of a variant still sells), and a raised quantity on a held line whose product, or
  one of whose extras, has gained an Active variant since it was parked (`updateHeldOrder`).
  The till's extras lists no
  longer offer such a product (`readExtraProducts`, `packages/catalogue/src/offered-modifiers.ts`).
  Pinned by the "a parent with Active variants is never sold as itself, as an extra or on a raise"
  cases and "refuses a parent with Active variants rung up alone, and sells one whose variants are
  all Inactive as itself" in `apps/server/src/working-order.test.ts`, "sells an extras pick of a
  product whose only variant is Inactive" in `apps/server/src/till-api.zone-required.test.ts`, and
  "an extra that is a parent with Active variants" in
  `packages/catalogue/src/offered-modifiers.test.ts`. `GET /api/products`
  (`listAvailableProducts`) still lists such a parent; nothing in `apps/till` outside its tests
  calls it (the till builds its buttons from zone offers).
- **DONE (B4, 2026-09-24): a venue with no service zone sells nothing.** The path that priced a
  line by bare `productId` is gone. See "A sale needs a zone" below Task 9 for what now happens and
  what it left open.
- **`@waitron/fiscal-verifactu`'s tests now depend on `@waitron/catalogue`** (its VAT-per-variant
  test runs the real `selectMenuVariant`), so a catalogue change also runs fiscal-verifactu's test
  shard in CI. Kept deliberately; worth revisiting only if that shard's time becomes a problem.

**Task 6 LANDED as #539 (2026-09-24): a variant has its own product page on the server.**
`GET`/`PUT /management-api/products/:id/editor` now accept a variant's id. The editor value carries
`parentId` and `inherited` (the parent's effective values, allergens as published); a variant's own
fields come back as stored, so a blank reads blank and a cleared field goes back to following its
parent. A variant may not change its parent, carry variants of its own, or carry extras or options
lists. Its published allergens and diet stay blank unless it overrides them, so it reads its
parent's; a parent's recipe or diet change republishes the variants that do override. The "is this
a product in its own right" check that was written out at each product-by-id route is now one
shared function, and every route other than the editor still refuses a variant's id as before. No
migration: **no venue reset needed.** The dashboard screen for a variant's page is Task 7 (#545). What it
left open, besides the bullets above that it updated:
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

**Task 7 LANDED as #545 (2026-09-24): a variant has its own page in the dashboard.** The products
list shows each variant under its product with its own name, and the price and categories it is
sold and reported under, plus a note of its VAT where that differs from its product's (the list
still has no VAT column, as #387 decided). A removed variant is kept Inactive, shown behind the
list's Status filter and the product editor's "Show variants" filter, and can be restored from
either; the editor's save body now carries each variant's `active`, so a save never brings one back
by accident. A variant's own page shows its product's values as hints in every field it leaves
blank (never in its three names), and has no Modifiers or Variants section; adding the first
variant adds one row, with no "Regular". A variant can be opened from its product's variants table
(held while the product has unsaved changes) and from the image library. On a narrow table the
variants' prices move under their names and the price column is hidden. Shared primitives changed
with it: `wt-price-input` gained a `placeholder`, `wt-input`'s and `wt-price-input`'s hints use the
muted text colour, `wt-switch` gained `hide-label`, and `wt-dialog` no longer lets a late close
report shut a dialog that has been reopened. No migration: **no venue reset needed.** Task 8
(#551) follows the list below. What Task 7 leaves open:
- **The product list shows "—" for a variant's allergens**, because the list's data carries none for
  a variant (`ListedVariant`, `packages/catalogue/src/product-types.ts`). **Next action:** decide
  whether the list should read a variant's effective allergens, and add them to that read if so.
- **Each variants-table row's Available switch is named only "Available"** to a screen reader, not
  with the variant's name (`apps/dashboard/src/widgets/variant-table.ts`). `main` at `5add727d7`
  already labelled it the same way. **Next action:** name the switch after its variant.
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

**Task 8 LANDED as #551 (2026-09-24): top sellers now roll variants up under
their parent.** The top-sellers list on the dashboard's overview and sales screens groups lines under
the parent's name and ranks them by quantity sold — "Wine by the glass", 5 sold, 24.50 — and shows each variant sold under it on its
own indented row beneath, under the variant's own name ("Wine 175", then "Wine 125", biggest seller
first). A product's own figures count every line sold under its name, including any sold as the
product itself with no variant, and the list's length counts products, not variants.
Previously each variant was ranked as a separate seller and there was no product total. Each variant
row's heading cell also holds the product's name as visually hidden text, so its text reads "Wine by
the glass, Wine 175". The filed sale is unchanged: the
report reads the two names every sale line already records. No migration: **no venue reset
needed.** What Task 8 leaves open:
- **The overview's top-sellers table can reach into its card's padding at desktop width** when a
  variant has a long one-word name and the figures run to five digits. Measured 2026-09-24 at
  1280px: with "Café con leche pequeño descafeinado" at 1000.000 / 10000.00 the table ended 12px
  inside the card's 17px padding (it stays inside the card's border); with three-digit figures, or
  with no variant rows, it ended at the padding's edge. **Next action:** decide whether a long name
  in that table may wrap mid-word.

**Task 9 LANDED as #556 (2026-09-24): the old variant table is gone.** The catalogue
migration `packages/catalogue/drizzle/0004_drop_product_variants.sql` drops `product_variants`, which
since Task 3 only the configuration transfer still copied; that copy and `resolveMenuVariant`, a
reader no product path called, went with it.
A dev venue's old rows in that table go with the drop; the migration needs no reset of its own —
measured 2026-09-24 through `applyMigrations` on Node v26.7.0: a venue migrated through catalogue
`0003` and holding one product with one `product_variants` row took the new migration with no
error, the table was gone and the product row kept. A
product with Active variants is now refused on the till's plain product path, as an extras pick on
either path, and on a raised held line (the Task 5 bullet above). (2026-09-24: B4 has since removed
the plain product path; see "A sale needs a zone" below.) What Task 9 leaves open:
- **DONE (#575, owner decision 2026-09-24): paying a held order bills its lines as parked, and the till
  shows what it bills.** A line, or an extras pick, whose product gained an Active variant after
  the order was parked is billed as parked: the cash and card pays price a retrieved order from its
  stored lines (`priceStoredOrder`, `apps/server/src/working-order.ts`), following the 2026-09-20
  service spec §10 (existing work is not cancelled); only a raised quantity is refused. On the till,
  retrieving the order keeps an extra that no list offers any
  more in the basket, marked "Not offered now" and counted in the total, and the banner says it is
  still charged (`held.extra_not_offered`); a retrieved line whose offer the till no longer lists
  carries the same mark. The first edit takes the extra off the basket, because the till cannot
  send it and the server re-prices an edited order without it — pinned by "bills a parked extra
  that gained an Active variant until an edit omits it" (`apps/server/src/till-sale.test.ts`).
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
  comment in `apps/till/src/state/working-order.ts`). It predates that branch: the dirty check came
  in c64b96fb7 (2026-08-07, #63), where it guarded only paying and placing an order, and re-holding
  a retrieved order was routed through `#syncIfDirty` in 29b7234ae (2026-08-18, #101). **Next action:** give the till a way to save a label
  without re-sending the lines, so the stored extras and locked prices are kept.
- **DONE (owner decision 2026-09-24, #578, main 6a6e2c614): an extras list can no longer offer a product
  with Active variants.** Saving an extras list that names such a product is refused
  `extras.product_has_variants` (409), naming the item; a save that would give a product an extras
  list offers an Active variant, from the parent's editor or the variant's own page, is refused
  `product.offered_as_extra` (409), naming every list that offers it. A variant itself may still be
  an extra, and a product whose variants are all Inactive may still be offered. The order-path
  refusals stay.
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

**A sale needs a zone — DONE (B4, #571, main 342d69fd4, 2026-09-24; lane B's queue item B4, not Track B's B4 below).**
The owner said _"a zone is required"_ (the Task 5 bullets above), so every sale line is now priced
from the menu offers of its order's service zone, and the path that priced a line by bare
`productId` is gone:
- `POST /api/sales`, `POST /api/pay` and `POST /api/working-orders`, sent with lines and no
  `zoneId`, take the venue's counter-default zone. A venue with none, including one with no zones
  at all, is refused `service_zone.default_missing` (409) (`resolveHttpOrderZone`,
  `apps/server/src/till-api.ts`, and `resolveNewOrderZone`,
  `packages/venue-service/src/operations.ts`).
- `priceOrderLines` (`apps/server/src/working-order.ts`) refuses a line on an order with no zone
  with `order.service_context_missing` (409), and a line that names a product instead of a menu
  offer with `management.request_invalid`, field `lines` (400). An order with no lines still opens
  without a zone.
- Pricing reads the invoice languages through `readInvoiceLocales`
  (`packages/catalogue/src/operations.ts`), one row of `locations`, no longer through
  `listAvailableProducts`.
- The till always sends a line's `menuItemId`; `toWireProductIdentity`
  (`apps/till/src/state/order-line.ts`) throws for a product that has none.
- `CoreServices.openTab` (`packages/module/src/module.ts`) takes only `{ tableId }`.
- A server test gives its venue a zone whose menu offers its products with `offerProducts`
  (`apps/server/src/testing/zone-offers.ts`).

The refusals are pinned by `apps/server/src/till-api.zone-required.test.ts`. No migration: the
branch adds no file under any `drizzle/` directory. What B4 leaves open:
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
  take a round. Measured 2026-09-24 by the B4 review with a scratch HTTP test. Before B4 the till's
  round, which names menu offers, also failed there, with `sale.unknown_product`. **Next action:**
  the same owner decision as the entry above; if tabs on tables in no zone stay allowed, `moveTab`
  and `joinTable` must create the zone record rather than only re-point one.
- **Two branches still read a held line that names no menu offer, and only an order parked before
  B4 should have one.** `getHeldOrder` (`apps/server/src/working-order.ts`, its
  `context === undefined || line.productId === null` arm) returns such a line by its product alone,
  and the till's retrieve (`#onRetrieveOrder`, `apps/till/src/till-app.ts`, the `liveByProduct`
  lookup) finds it among today's offers by product id or drops it with `held.product_gone`. Every
  line priced since B4 records its offer (`lineContexts`, `priceOrderLines`), and a partial transfer
  copies it to the new line (`copyLineContext`, `transferLines`). Measured 2026-09-24: with a
  `throw` planted at the top of that server arm, seven suites all passed: `till-api.test.ts`,
  `till-api.courses.test.ts`, `till-api.reprint.test.ts`, `till-api.fiscal-sale-paths.test.ts`,
  `working-order.test.ts` and `working-order.pay-and-dispatch.test.ts` under `apps/server/src`, and
  `apps/server/scripts/demo-seed/seed.integration.test.ts`. They include every `apps/server` suite
  whose text calls `getHeldOrder` or builds a `/api/working-orders/${…}` URL, so none of those
  reaches it.
  **Next action:** delete both branches, since no backwards-compatibility code is owed before
  production (CLAUDE.md §3), or say what keeps them.
- **`sale.unknown_product` is no longer raised.** A line naming an item the zone does not offer is
  refused `service_zone.offer_not_allowed` instead. The code stays registered, with its note in
  `apps/server/src/errors.ts` saying nothing raises it, and keeps its 400 in the till surface's
  status map (`apps/server/src/till-api.ts`), because a shipped code is never renamed or removed.
  **Next action:** none unless a retired code should also leave the status map; recorded so a
  reader who meets it knows it is retired.

Task 10 has landed as **#471**: the built-in `doneness` field was removed end to end (the enum, its
order-line and fired-ticket columns, the prominent kitchen-ticket line and the till's meat-gated
dropdown), and the demo steak now carries a `Punto` cooking options list instead. The per-line
free-text note stays.

Whether a `+ <list>: <label>` sub-line is prominent enough on a kitchen ticket to replace the old
`** MEDIUM RARE **` framing is still an open question nobody has put to a real cook.

Task 8 has landed as **#465**: the held-order preserve-path comparison moved into two
order-independent functions, `sameOptionSelections` and `matchExtraChildren`
(`apps/server/src/modifier-selection.ts`), fixing a reorder bug where a quantity-only edit deleted and
re-priced every line. The review also found a dish offering one product on two lists could be billed at
the wrong list's price; `matchExtraChildren` now refuses to pair a stored extras child whenever the
picked product is offered by more than one of the dish's active lists.

- **That refusal is not a complete guard, and the residue is worth knowing before anyone relies on
  it.** It counts the offers as they are NOW, while the ambiguity is a property of the offers the
  stored child was written against. The escape is one specific edit: the list the STORED CHILD came
  off is deactivated, or loses the product (`PATCH /management-api/modifiers/extras/:id`), between
  the park and the edit, so the count comes back to one, the re-sent pick names the surviving list,
  and the line is preserved at the old row's price. Traced through the code, not run. The other
  direction is closed by something else: a pick naming a list that no longer offers the product is
  refused outright by `validateExtraSelections`, and the line takes the replacement path. There are
  two ways to close the escape and neither is free — pair on the child's frozen price as well as its
  product and quantity, which gives up the deliberate price lock that "keeps extras rows and
  customisation on a quantity-only edit" pins; or let the child line carry the list it came off,
  which is what spec §3.5 rules out when it says an open order's child points at the product and not
  the list. Keeping the price lock AND closing the escape needs the second. **Also not examined:**
  the refusal sits on the held-order edit path, which is where the wrong price was measured being
  written; whether any other path can pair a stored child with the wrong list's price was not looked
  at. **Next action:** an owner decision on whether an OPEN-ORDER extras child may carry its list
  id. It is not Task 9's — that one writes the FILED sale line, where decision 11 already bans a
  catalogue reference.

Task 9 has landed as **#469**: the filed sale line carries a dish's frozen answers in
`sale_lines.option_snapshots` (core migration 0041), written by both filing routes, and the customer
receipt prints one `<list>: <label>` line under each dish. Fiscal fingerprints are unchanged, pinned
byte-identical by `write-path.e2e.test.ts`; a bilingual-receipt language bug found on the way was fixed
by resolving names through `resolveSnapshotText`.

Task 11 has landed as **#476**, the dashboard side: `/manage/modifiers` is now one screen with
**Extras** and **Options** tabs, each a Categories-pattern table with its own authoring form; the
product editor gained an always-visible **Modifiers** section over one ordered mixed list, and the
products list a sold-alone column and filter. Neither delete is blocked nor previews an order count.
The token layer also learnt to set `color-scheme` so native controls follow the theme.

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
  `apps/dashboard/src/screens/catalogue-screen.ts` passes it to neither. It was three forms until
  Task 13 deleted the third, `modifier-form.ts`. Verified pre-existing rather than assumed —
  `git diff 2b354d5638ebb81f87e8421a25db83f14556440e -- apps/dashboard/src/screens/catalogue-screen.ts`
  has no added or removed line mentioning any of them. **Next action:** wire the same
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
  have it stop the inner event, and retire the guard in all five. Raised when the copy count reached
  five, which is what makes it worth the root fix.
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
- **Three plans still assert error codes by matching the error's message with a regular expression**,
  the shape #436 corrected in its own plan — a regex over the message cannot tell an `AppError` from
  a plain `Error` whose text happens to contain those words, and checks nothing about the error's
  params. They are `2026-08-31-modifier-allergen-association.md` (three places) with weaker twins in
  `2026-07-26-server-host.md`, `2026-08-28-sync-cloud-mirror-c2a-mirror-server.md` and
  `2026-09-14-dashboard-alerts-events.md`. Left for whoever works those files. Note that both styles
  are in the tree, so a grep does not hand anyone the convention:
  `packages/catalogue/src/dietary.test.ts` asserts `/diet.invalid_origin/` by regex.
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
- **An `ON DELETE RESTRICT` key raises `23001 restrict_violation`, not `23503 foreign_key_violation`.**
  The plan implies `23503`. Cost: one wrong expected literal in a test whose behaviour held on the
  first run.
- **A defect found in the options sibling and fixed out of scope.** `updateOptionList` compared a
  stored, lower-cased `list_id` against the caller's id in JavaScript, so a save whose list id
  arrived upper-cased had every one of its own labels read as another list's and was refused with
  `options.invalid`. The route is real (`PATCH /management-api/modifiers/options/:id`, whose
  `requireUuidParam` checks shape and does not normalise). #449 fixed it and added the regression
  test, because the identical bug was already proven and fixed on the extras side.
- **`packages/catalogue/src/options.ts` still says `findContentTranslationGap` returns rather than
  throwing.** It does throw `content.translation_invalid` for a non-text value. The extras twin of
  that sentence was narrowed in #449; this one was left, being pre-existing and out of scope.
- **The design's stated reason for `min_picks`/`max_picks` is false.** It says bare `min`/`max`
  "collide with SQL function names". Measured on PostgreSQL 18.3: a table with columns named `min`
  and `max` takes a check constraint over them, selects them unqualified and aggregates `min(min)` /
  `max(max)`. The spelling stands — it reads better — and a dated pointer now sits on the design
  document saying only the reason was wrong.
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

Task 12 has landed as **#478**, the till side: the picker walks a dish's `offeredModifiers`, drawing an
extras list's products (a checkbox or a stepper within the list's allowance) and an options list's
labels (radios, default preselected), and the basket nests each pick as a child row with its own
allergens and price. A child extras row is told from a dish by `TabLine.parentLineNo`, and the legacy
modifier and option-group till types and the free-text `text` modifier are gone.

- **A generated `DROP TABLE … CASCADE` is a decision, not a default.** Drizzle emitted the three
  drops in an order that needs `CASCADE`; both sibling drop migrations in the same directory carry
  the opposite instruction verbatim, because `CASCADE` turns a dependency the drop did not expect
  into a silent success. Reordering the statements removes the need entirely. Measured with a
  control: put the parent back second without `CASCADE` and the virgin migrate fails `2BP01`
  naming the constraint. **Worth looking for in any generated drop.**

What Task 12 deliberately did NOT do, so Task 13 is not surprised by it:

- **The legacy `optionGroups` and `modifiers` fields stayed on both sell-side payloads, and the
  legacy demo seed stayed.** The till read neither, so there was nothing to gain by removing them
  early and the removal belonged with the tables. Task 13 took all of it.
- **The per-line kitchen NOTE was not touched**, despite living in a file called
  `line-extras-editor.ts`. It was never part of this feature; the file name is now misleading and
  nobody has renamed it.
- **A retrieved line's options answers are re-sent by matching their WORDING**, because a frozen
  answer carries six names and no ids (spec §2.3). `deriveOptionSelections`
  (`apps/till/src/state/held-options.ts`) matches each answer's staff names against the dish's live
  offer — the STAFF name of each side only, so a moved customer or kitchen name still re-sends and
  the server re-prices. A staff-name rename or a withdrawn label matches nothing, and the till
  surfaces `held.options_changed` rather than substituting the list's default. Landed inside Task 12
  after the first cut of the picker refused every such edit with `options.label_required`.
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
  ring the dish up on the till. It was left here rather than fixed because the defect is in the
  AUTHORING path (Task 6's code, and the order path's non-intersection is Task 7's), not in the
  till surfaces this task owns — widening a till branch into the catalogue's write path is the
  blast radius the campaign's rules forbid. What Task 12 changed is only that the divergence is
  now VISIBLE: before it, the till drew the legacy attachments and could not answer one of these
  lists at all.
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
  it reapplies `extras`, `options` and `optionSnapshots` and never touches `line.product`. The
  probe returned `{ checkedVariant: 0, saveDisabled: true, variantIdAfterSave: "v-large",
  unitPriceAfterSave: "1.50" }` after "Pequeño" was chosen and saved, with the dialog closing as
  though it had worked. **PRE-EXISTING, checked rather than assumed:** `git show
  ef1f6b91:apps/till/src/widgets/modifier-picker.ts` and the same for `basket.ts` show the shape
  on `main` too. Left unfixed on purpose — it needs a decision first about whether a basket edit
  may change a variant AT ALL. If the answer is no, the cheaper fix is to stop offering the
  variant control on a reopened line; if yes, `setLineModifiers` has to carry the product. Task 12
  did close the neighbouring gap, and in ONE place only: the tender-pay quantity path now asks for
  a variant, where it used to ring straight up at the base product's price. The grid already asked
  before this task (`git show main:apps/till/src/widgets/product-grid.ts`); what changed there is
  only that both now ask through one `needsModifierPicker`
  (`apps/till/src/state/order-line.ts`).
- **Both of the modifier picker's LIST inputs still carry a generated id as their `name`.** An
  extras checkbox group is named `extras-${list.id}` and an options radio group `options-${list.id}`
  (`apps/till/src/widgets/modifier-picker.ts`), and a list id is a uuid — so a kind in front of one
  is still the generated widget id `docs/developers/conventions-ui.md` refuses, and CLAUDE.md §3
  with it. NOT every input: the variant radios are `name="product-variant"` already, so they are not
  part of this. What Task 12 changed is only that the two LIST kinds now spell it the SAME way; the
  extras checkbox carried a bare list id before, where its options sibling was already prefixed.
  Left because the offered-list wire carries no stable per-list IDENTIFIER to use instead: an
  offered list arrives with its uuid `id`, its `kind`, its three display names and its items or its
  labels (`OfferedExtrasList`/`OfferedOptionsList`, `packages/catalogue/src/menu-types.ts`), and a
  display name is renameable and not unique, so closing this means adding something to that wire.

What the order path (the plan's Task 7) left behind:

- **A quantity-only edit made after an OPTIONS list is RENAMED re-prices the line.** `updateHeldOrder`'s
  preserve path asks whether the request's answers, resolved against the lists as they are NOW,
  equal what the line froze. An options answer freezes NAMES and no ids (spec §2.3), so after a
  rename the two sides differ, the line takes the replacement path, and it is re-priced at today's
  price and re-frozen with the new wording. The LINE IDENTITY goes with it: the replacement path
  deletes every line of the order and inserts fresh rows, so the parent and its children all come
  back under new ids. The run-it review seat measured a parent reading
  `quantity 1.000, price 2.50, listName "Cook list staff"` before the edit and
  `quantity 2.000, price 19.00, listName "Renamed"` after it, under a new id. So a rename between
  two sends can change what a saved order says the diner chose, what it costs, and which rows it is
  made of. The old model compared by id and survived a rename. Whether today's till can reach it is
  UNVERIFIED — it sends no `extras`/`options` until Task 12. **SETTLED by Task 8:** a rename drops
  the line onto the replacement path, and that is now pinned by a test rather than left as a
  consequence ("re-prices a held line when the options list it answered was renamed between the two
  sends", `apps/server/src/working-order.test.ts`). The other option on the table — carrying ids the
  comparison could use — would mean putting a list or label id on the line, which is exactly what
  spec §2.3 rules out and what makes editing or deleting a list unable to change a saved order. With
  no id on either side there is nothing but the wording to compare, so a rename is indistinguishable
  from a different answer. **The reachability line above is out of date as of 2026-09-21:** the till
  does send `extras`/`options` now, so this IS reachable from a real basket. The till re-derives a
  retrieved line's answers from their WORDING (`deriveOptionSelections`,
  `apps/till/src/state/held-options.ts`), which is the same evidence the server's own comparison
  uses. A STAFF-name rename between the two sends therefore does not match: the till asks the
  operator to choose again, and the re-answered line takes the replacement path described here. A
  customer- or kitchen-name rename still re-sends and still lands on that path, at the server's own
  by-value comparison.
- **Two different signals say whether a dish is sold by weight, and they disagree — MEASURED.** The
  order path refuses an extras pick on a dish that is not priced `each`
  (`extras.unsupported_product`; the legacy payload's `options.`-prefixed twin is retired in
  `apps/server/src/errors.ts` rather than deleted), because a child is priced
  `dishQuantity × pickQuantity` and a fraction of a dish would bill a fraction of an extra. But the
  two order paths read that fact from different places: the MENU-OFFER path derives it from the unit
  the offer carries (`priceOrderLines`, `offer.unit.hardwareUnit === null ? "each" : "weight"`),
  while the plain PRODUCT path reads `products.pricing_unit` — and `assignProductUnit`
  (`packages/catalogue/src/units.ts`) writes `product_units` without touching that column. So one
  product, moved onto the kg unit that way, is refused through its menu offer and billed
  fractionally through its product id. Measured on this branch: the same fixture was refused on the
  offer path — under the code's earlier name, `options.unsupported_product` — and went through on
  the product path. Only the
  refusing half is pinned by a test ("refuses an extras pick on a menu offer whose dish is sold by
  weight", `apps/server/src/working-order.test.ts`). This is a second instance of the shape the
  Units entry above already warns about. **Update (B4, 2026-09-24):** the product path is gone, so
  the order path now reads only the unit (`priceOrderLines`, `selection.unit.hardwareUnit === null ?
  "each" : "weight"`) and the fractional billing above can no longer happen on a sale. B4 did not
  touch `products.pricing_unit` or what writes it, so the two can still disagree in storage (the
  Task 6 bullet on reassigning a unit's products is the same shape). **Next action:** whoever builds
  Units decides whether `products.pricing_unit` is kept in step with the unit or dropped, now that
  no sale reads it.
- **The definition reads on the sale path take NO lock at all, while their writers serialise.** The
  entry used to set the four new reads against an OLD lock, `lockModifierDefinitions(tx, "read")`,
  that `priceOrderLines` still took over the `option_groups` tables. That lock is gone with them —
  `packages/catalogue/src/modifier-lock.ts` existed on `main` at `47aee357`, does not exist here, and
  `grep -rn lockModifierDefinitions apps packages` matches nothing — so there is no lock left
  anywhere on the read side, which makes the shape plainer rather than safer. The four reads take
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
- **A two-transaction concurrency test that starts both sides in sequence is racing itself.** The
  first version of the test above started the transaction that holds a row and the save that should
  wait for it one after the other, without waiting for the first to actually hold anything. It
  passed locally and failed on CI with "timed out waiting for the save to reach the row the blocker
  holds", having proved nothing rather than having found a bug. The blocker now signals once its
  lock is held. Nothing guards the shape; it is worth looking for in any new racing test.
- **`scripts/spawn-timeout-budget.test.ts` was failing healthy runs of itself**, which is the rule
  it exists to enforce. Its scan of every package and app suite read each file twice and declared no
  bound, so the non-vacuity case timed out at Vitest's 5000ms default inside a loaded full root run
  while the whole file measures 1.4s alone. Fixed in #456: one read per file, and a declared bound
  on each scanning case. **Next action:** none — noted because the same shape is latent in any root
  guard that walks the whole tree without declaring a bound.
  _2026-09-22: the scan this describes no longer exists. The guard reads `scripts/` alone again —
  the packages-and-apps half was retired with the real-PostgreSQL harness — so the rule holds under
  those two roots with nothing enforcing it, as `CLAUDE.md` §4 and
  [testing-guide.md](developers/testing-guide.md) both say._

What the per-menu publication (#452, the plan's Task 5) left behind:

- **`readProductExtras` and the product-attachment check both moved to Task 6, and both have
  landed there.** `readProductExtras` (`packages/catalogue/src/extra-projection.ts`) reads the
  extras lists a PRODUCT itself carries, with no menu offer in the question, and
  `setMenuItemExtraLists` (`packages/catalogue/src/extras.ts`) refuses to publish a list the dish's
  product does not carry — `assertProductCarries` in that file, which reads `product_modifiers`, the
  table Task 6 added. What it does NOT refuse is a body that LEAVES OUT a list the product carries,
  and the function's own doc comment says so: "Nothing refuses an offer that publishes none of the
  product's lists". When this entry was written the second check had a model to copy from, the
  options half of the old feature, which made it against `product_option_groups`; Task 13 deleted
  that half, so there is no sibling left to copy and the decision stands on its own. There is also no
  "required list" to refuse against: an extras list carries no `required` flag (the spec makes
  "required" `min_picks >= 1`, §3.1) and §3.2 does not say a required list must be published. The
  dated note on Task 5 in the plan describes the gap as it was, and stays as history.
  **Next action:** settle whether an offer may publish none of a product's required extras lists,
  when the menu-offer screen is built.
- **Two review findings deliberately not taken, both of them structural.** Splitting the publication
  write path out of `packages/catalogue/src/extras.ts` into a module of its own, and moving
  `resolveExtraPrice` from there into `extra-contract.ts` beside the price parsing it belongs with.
  Both were declined as churn on a branch about to land. Task 6 has since added the attachment check
  to that file, and the extras ROUTES went where the option ones live
  (`apps/server/src/catalogue-api.ts`), so the file was not reshaped after all. **Next action:**
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
  which names neither of them. That entry no longer names the two option-group equivalents either:
  it carried `menu_item_option_groups` and `menu_item_options` on `main` at `47aee357`, and Task 13
  took both out with their tables, leaving a list that ends at `menu_items`. **Next action:** revisit
  when a screen that actually publishes an extras list on a menu offer is built; nothing in the
  dashboard reads either table today.
- **CLOSED by the storage switch, 2026-09-23 — there is no grant to decide about.** This entry
  asked whether the application role should hold `UPDATE` on the two extras-publication tables, on
  the strength of a `GRANT` in the catalogue migration set. Every premise it rested on has been
  deleted: there is no application role and no `GRANT` statement anywhere in the migrations
  (`grep -rln GRANT packages/*/drizzle/*.sql` matches no file), the migration that carried the
  grant is gone — the thirteen PostgreSQL chains became one baseline per set, and
  `packages/catalogue/drizzle/` holds `0000_baseline.sql` alone — the grants walkthrough in
  `packages/catalogue/src/extra-projection.test.ts` was removed with the grants and that file says
  so at its own header, and `packages/fiscal-verifactu/src/privileges.test.ts` no longer exists.
  `privileges.expected.ts` does survive, but its header now calls itself a frozen record of what
  was granted BEFORE the switch, with nothing checking those letters against anything. The
  underlying design fact is unchanged and still worth knowing: no production path updates a row in
  either table — `setMenuItemExtraLists` replaces rows rather than editing them. What refuses a
  stray write today is nothing at all.

**Product selling units — LANDED #342 (2026-09-13).** You say what you sell a product by — the each
(the default), or by weight or volume — and how many decimal places (0 to 3) its quantity may have; a
price is always a price per that unit. Units get their own dashboard page, a new venue is seeded with
five weight and volume units, and a unit's name and precision are frozen onto sold lines. Deleting a
unit is refused while any product uses it. [Design](superpowers/specs/2026-09-12-product-units-design.md),
[plan](superpowers/plans/2026-09-12-product-units.md).

**Update (2026-09-15) — unit abbreviations and screen rebuild.** Every unit gained a short
translatable **abbreviation** (`kg`, `ml`), which is now what prints on sold lines, receipts, kitchen
tickets and the till; the full name shows only in the dashboard. The frozen `unit_name` column is
presentation only and does not enter the fiscal hash. The units page was rebuilt on the shared table
conventions, and the seeded `each` unit was dropped so a product's unit is optional.
[Design](superpowers/specs/2026-09-14-units-screen-and-abbreviation-design.md),
[plan](superpowers/plans/2026-09-14-units-screen-and-abbreviation.md).

**Update (2026-09-15) — a product's unit is optional, and a unit lists its products — LANDED #375.** A
product no longer needs a unit (Each stores nothing); the units screen lists a unit's products and can
bulk-reassign them to Each so a unit can be emptied and deleted, and reassigning a weight product to
Each flips its stored `pricing_unit`. [Design](superpowers/specs/2026-09-15-optional-product-unit-design.md),
[plan](superpowers/plans/2026-09-15-optional-product-unit.md). Left open (small,
unowned): `createProduct` and `updateProduct` still duplicate the legacy-`pricingUnit` fallback, so a
shared helper would keep the two from drifting; and the synthetic `EACH_UNIT` id lives as a literal in
both `packages/catalogue/src/units.ts` and the till's `product-name.ts` with nothing pinning them equal.

**Update (2026-09-16) — clicking a unit row is now a delete, and precision is a dropdown — LANDED
#382.** The row's accessible label and the dialog heading now read Delete unit and list the products
that must be moved first; the in-use sentence is painted in the danger colour, and Precision became a
0-to-3 dropdown that reopens on the unit's own value. #382 touched only `apps/dashboard`, so the small
`packages/catalogue` items above stay open.

What it left open:

- **Units still has no written contract, but the reason to write one has passed.** Categories and
  Modifiers each left a `docs/developers/` document for the Products build to compose against; Units
  left none, and `docs/superpowers/plans/2026-09-12-product-units.md` is still the plan as written
  rather than as carried out — it was last edited by the Categories merge. Products has since
  integrated Units anyway (#345), so the consumer this document existed to serve no longer needs it.
  Operators get what they need from [the products guide](products.md). **What is actually left:** no
  dedicated page describes units the way `modifiers.md` describes modifiers. Worth writing if a second
  consumer appears or an operator asks; not worth writing on a schedule. The shapes, if somebody does,
  are in `packages/catalogue/src/units.ts` and `unit-validation.ts`.
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
  moves products onto another unit so the unit can be emptied and deleted, and the fix gave
  `product_units` a primary key. LANDED #350 (2026-09-13).

**The integrated product editor — LANDED #345 (2026-09-13), and the four-part Products overhaul (Units,
Categories, Modifiers, Products) is complete.** One Products list and one editor replace the old
combined catalogue screen, saving a product's names, image, tax choice, unit, categories (at most one
reporting), reusable modifiers, direct allergen and dietary declarations, and variants in one
transaction; menus publish and price variants, and sold facts are frozen onto order lines. Recipe
authoring was withdrawn from the dashboard. [Operator guide](products.md),
[design](superpowers/specs/2026-09-12-product-editor-design.md). (Later reworked — see #377 and #379
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

**Product catalogue management improved — LANDED #387 (2026-09-16).** The Products page was rebuilt on
the shared table (one search box, variants nested and folded under their product, and a Delete that
deactivates rather than removes so a sold product stays readable in history), and the editor adopted
the shared allergen and dietary picker. Two shared components changed beyond Products: `wt-data-table`
gained `initiallyCollapsed`, and `wt-disclosure` was redrawn — both now written down in
[design-system.md](developers/design-system.md).

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

**Modifier editing, reworked — LANDED #352 (2026-09-13).** Editing a modifier's choices became a table
with drag and arrow-key reordering, each choice's detail opening in its own window. (Its yes/no model
change was later removed by the modifier nutrition redesign, and its one open item — a keyboard reorder
that announced nothing to a screen reader — was closed by the product-editor rework's shared
`ReorderController`.)

**Modifier nutrition redesign (pass 1) — LANDED #377 (2026-09-15).** Each modifier choice now carries
its own nutrition information and the app no longer combines a dish with its extras; the yes/no type
was dropped, a choice's allergens became one contains list, and dietary suitability became a positive
`suitableFor` list over vegan, vegetarian, halal and kosher. Fiscal records are unaffected.
[Design](superpowers/specs/2026-09-15-modifier-nutrition-redesign-design.md),
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

**Modifiers screen rebuilt — LANDED #370 (2026-09-15).** `/manage/modifiers` was rebuilt on the
Categories-screen shape (search, a Type filter, a remembered per-tab sort, a read-only details panel,
and a delete flow that detaches then deletes), and choice allergens and diets moved to the shared
`allergen-dietary-picker` widget. (Later superseded: the nutrition redesign dropped the yes/no type,
and Task 11 replaced the whole page with Extras and Options tabs.)

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

**Modifier tables and nutrition editing refined — LANDED #385 (2026-09-16).** Clicking a modifier's row
now opens one combined Products and Menu-items table with a sortable, filterable Type column, and the
modifiers list's Choices column shows the searchable choice names instead of a count. In the choice
editor, the Nutritional information section opens expanded and is summary-first, with allergens and
dietary preferences both edited through `wt-combobox`.

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

**The product editor reworked — LANDED #379 (2026-09-16).** A product's Name is now plain staff-facing
text, with an optional translated customer-facing name and a plain kitchen name beside it (all name
resolution lives in `packages/catalogue/src/product-presentation.ts`); the editor became a short form
with collapsible sections, a product's kitchen station and course now save inside its one transaction,
and a product has no variants or at least two. Two shared primitives came out of it, `wt-disclosure`
and `wt-price-input`. [Developer guide](developers/products.md),
[design](superpowers/specs/2026-09-15-product-editor-rework-design.md).

What it left open:

- **A variant's image has no foreign key, unlike a product's — CLOSED by variants plan Task 3.** A
  variant is now a `products` row, so its photo is `products.image` and the database guards it with
  the same triggers as a product's photo; the measurement is under *Variants* in the
  [developer guide](developers/products.md).

- **A product's name can be stored blank.** `products.name` is `NOT NULL` with no non-empty check,
  and only the editor's own parser refuses a blank; `createProduct` writes what it is given. Its
  siblings share the pattern: `option_lists.name`, `option_labels.name` and `extra_lists.name` are
  each declared `` `name` text NOT NULL `` in `packages/catalogue/drizzle/0000_baseline.sql`, and
  none of that file's check constraints touches a name column. (A variant's name is
  `products.name` now.) **Next action:** decide whether the columns want a check
  constraint and the write paths a domain refusal.

- **DONE (B4, 2026-09-24): the legacy product-id order path lost the configured kitchen name.**
  `AvailableProduct` carries no kitchen name, so a line added by product id froze `kitchen_name` as
  null. B4 removed that path: every line is now priced from a menu offer, whose selection carries the
  product's and the variant's kitchen names (`selectMenuVariant`, frozen by `priceOrderLines` in
  `apps/server/src/working-order.ts`), and the developer guide says so
  ([products.md](developers/products.md)).

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
same rules reach the setup boundary and the `waitron-provision venue` command through a seat on the
regime-neutral fiscal contract; each refusal is proven by deletion rather than a text-walking guard.

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

**Restoring a backup and importing a configuration failed in a real browser — FIXED #584 (found by
#567, 2026-09-24).** `restore` and `stageConfiguration` in `apps/setup/src/api/client.ts` called
`this.#fetchImpl(...)` as a method, which the browser's own `fetch` refuses with `Illegal
invocation`. Both now copy it into a local first, as `#request` does; `client.test.ts` runs
`getStatus` (for the shared `#request` path), `restore` and `stageConfiguration` against a stub that
refuses a wrong receiver, and against Chromium's real `fetch`.

**The dashboard's configuration export has the same fault, masked — OPEN (found 2026-09-24, fixing
the setup client; lane B's package).** `apps/dashboard/src/api/client.ts`'s configuration export
calls `this.#fetch(...)` as a method. It works today only because `main.ts` hands the client
`createInstrumentedFetch`'s arrow wrapper (`packages/diagnostics/src/instrument-fetch.ts`), which
calls the real `fetch` as a plain function. A `DashboardApi` built with its default `fetch` would be
refused on the configuration export with `Illegal invocation`.

The original walkthrough is retained under *Detail → Setup wizard*.

### A3. Printers from the dashboard

**Printer paper width, resolution and character set — LANDED #367 (2026-09-14).** The printer editor
now stores paper width, resolution and character set per printer, all documents format to them, and
the fiscal QR prints as a raster sized to land as close as possible to the legal 30-40mm.

**Setup refinements — LANDED #380 (2026-09-16).** Add opens a prefilled naming dialog, identifiers
are read-only, test answers use radio buttons, feedback separates addition from refresh failures,
printed instructions follow the user's language, and text init cancels Kanji mode before single-byte
text. Development servers no longer advertise `waitron.local`.

**Printer calibration follow-up — LANDED #388 (2026-09-16).** A physical NT-806 byte-grid print made
encoding and the `ESC t` table number independent printer settings, the editor prints a clearly
simulated sample receipt with unsaved settings, sample characters follow the site's language, and the
Add-printer layout was tidied.

The later calibration chooser starts with tables 0–15, prints a broader two-line glyph sample, and
lets you choose one compact code that sets both the printer table and Waitron encoding. Later ranges
remain selectable. Each candidate line first selects table 0, so a printer that accepts table 0 but
ignores an invalid number does not inherit the previous candidate's table. **Still open:** check
this two-line finder on another printer, including how it responds to an unassigned table number.
The byte sequence and dashboard flow have been tested, but no printer was available on the
development network. [Chooser design and limitation](superpowers/specs/2026-09-16-printer-setup-refinements.md#calibration-chooser-follow-up-2026-09-21).

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
- **58mm layout is checkable only through the preview** until a 58mm printer is available to print on
  for real.
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

**Office printers greyed out in the scan — LANDED #359 (2026-09-14).** Once per job pull the agent
now asks each network printer for its paper sizes over a read-only IPP query on port 631; one
reporting A4 or US letter is greyed out in the Add dialog with no Add button, unless it matches a
disabled registration. No answer, a late answer or an unreadable reply leaves it addable as before.

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

**Check a known address — LANDED #335 (2026-09-12).** The Add-printer dialog takes an IP and port and
asks the approved print agents to try it (opening a TCP connection, sending no bytes), so a printer
the two discovery passes cannot see can still be added, including reactivating a disabled one; an
address that answers is then asked for its paper sizes on port 631.

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

### A4. Till, displays and devices

- **Service, ordering and billing: specified; implementation deferred (owner, 2026-09-20).**
  [Design](superpowers/specs/2026-09-20-service-ordering-and-billing-design.md) covers floor/table/tab
  dashboards and station collection signals, separate staff drafts with takeover, selectable firing
  groups, editable held work, paper/KDS status limits, guest access, shared bills and contributions,
  tips, adjustments and approval/reporting. Named courses only organise the initial draft; later
  additions default to Fire now or explicitly join a held group. Also records public/staff-only/not
  sold separately ordering, future inventory rules, and the direction away from a general canvas
  editor toward source-coded screens. Fiscal Q19 remains open. This specifies intended behaviour,
  not verified features. Wait for SQLite, dependency upgrades and variants/extras-as-products to
  land (the variants/extras-as-products part has, with branch 2's Task 9, #556;
  the other two are not recorded here as done), alongside the [menu design](superpowers/specs/2026-09-20-menus-categories-and-home-layouts-design.md),
  then resolve the listed integration questions before planning.
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
  extras-and-options work.** Found by looking at the real screens on branch
  `feat/modifiers-till-surfaces` (B1 Task 12), then each checked against `main` rather than assumed
  older: extracted rule by rule, `.line`, `.option`, `.option-total` and `.remove` in the basket and
  `.option`, `.option-name` and `.group-name` in the picker are character-for-character what `main`
  has, product-grid's single `css` block is identical, and the picker's legend — in a file this
  branch rewrote whole — still appends its required marker after a plain space exactly as `main`
  does. So none of them arrived with that branch. Three siblings from the same pass WERE fixed on
  it — the tab screen's child extras row painted exactly like a dish, the picker's Add button below the fold at phone width, and the
  picker's counter and refusals rendering as ordinary body copy. **Next action:** take these six as
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

**Dashboard alerts — designed 2026-09-14, LANDED #363/#368/#371 (2026-09-14/15).** One bell, panel
and Alerts screen for recorded incidents and live checks (backups, fiscal submission, printing, reader
battery); `till.configure` was split into permissions named for what they guard. The printing checks
shipped as `agent.silent` and `printer.jobs_waiting`, worked out live on each dashboard read and never
saved, so they can still be renamed cleanly until a venue is live or anything starts saving them.

**Incidents reader and dashboard notification surface — LANDED #368/#371** (owner decision
2026-09-12). #368 added `listOpenIncidents`/`listHandledIncidents`; #371 added the pop-up toast, a
venue-shared handled state in the `incidents` table, incident-change push plus a one-minute refresh,
and the ongoing-check consumers (silent agent, stalled fiscal outbox, missing certificate, jobs stuck
at a printer, low reader battery, backups off/failing/stale). Still not built: the pairing consumer,
and a standby that has fallen behind.

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

**The dashboard shell restyle landed (#333, 2026-09-12).** Collapsible sidebar groups with the
current item highlighted, a Settings group, a single person-icon account menu with the profile moved
into a modal, and `wt-row-actions`/`wt-button` gaining `icon`/`iconSize`/`align` options instead of
being copied. Two bugs found while checking it were fixed test-first. The rules went into
[design-system.md](developers/design-system.md) and CLAUDE.md §3.

Left open by that branch: no review finding was deferred — they were all applied — but the restyle
was only ever checked in screenshots on a desktop browser. Nobody has walked it on the real box or a
phone, so the narrow-viewport banner and drawer are unverified on hardware; that walk belongs with
the display walkthrough in [ui-review.md](ui-review.md). The rest of the dashboard's screens are the
ongoing overhaul listed at the top of Track A.

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
  10** (owner decision 2026-09-14). The `doneness` enum, its two columns, the
  `working_order.invalid_doneness` code, the kitchen-ticket line and the till picker are all deleted
  (core migration 0042), the demo seed grows a cooking options list on the steak, and Task 12
  (2026-09-21) has the till OFFER it. An options answer already prints on the kitchen ticket as an
  indented `+ <list kitchen name>: <label kitchen name>` line, taking the venue's upper-case shorthand
  for emphasis rather than the old `** MEDIUM RARE **` framing. **Open, and worth a cook's eye before a
  real service:** whether a `+` sub-line is enough for something a cook must not miss, or whether an
  options answer deserves its own prominent form on the ticket. Nobody has watched a real kitchen read
  one, nor opened and tapped a real demo box to settle it outside the code.
- **"the fiscal record is built from `total` + `vat_breakdown`" is a false-narrow enumeration, and it
  reproduces itself** (found by the review wave on the doneness removal, 2026-09-20; corrected on that
  branch). Left standing deliberately are two dated plan/spec records, but
  `docs/superpowers/plans/2026-08-30-ordering-modifiers.md:155` is the plan line that AUTHORED the
  `sales.ts` comment, so following it again would reproduce the defect. Two compliance-track documents
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
- **`wt-combobox`** (#351, 2026-09-13). It is a searchable dropdown in `packages/ui`: pick one option
  or several (`multiple`), and optionally offer to add what was typed when nothing matches. It landed
  with nothing using it; #362 (2026-09-14) is the first adopter, for the
  category form's parent picker (`apps/dashboard/src/widgets/category-form.ts`) and the
  product-categories editor's category and reporting-category dropdowns
  (`apps/dashboard/src/widgets/category-membership-picker.ts`). _2026-09-25: the product-categories
  editor is gone; the product's main-category and labels pickers
  (`apps/dashboard/src/widgets/classification-fields.ts`) use it now._ Left out on purpose, per its
  [design](superpowers/specs/2026-09-13-wt-combobox-design.md): searching on the server, disabling
  single options, taking part in a native `<form>`, and showing chosen options as chips (it shows a
  count instead). **Undecided:** how it relates to the `wt-select` row above. The combobox does not
  sort its options, and neither its design nor that row mentions the other, so decide whether
  `wt-select` becomes a non-searchable mode of the combobox or stays a separate element before
  building either. #362 adopted the combobox for the pickers above without
  answering the `wt-select` question, which is still open for the owner. **Next action:** the owner
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
  one has not.** Done 2026-09-13: a shared format check, `isValidTelephone` in `@waitron/shared`
  (optional leading `+`, then digits separated by spaces, dots, hyphens or parentheses, 6–15 digits in
  total), runs on both the browser forms and the server write paths. Identity throws
  `person.telephone_invalid` when a non-empty number fails it (`packages/identity/src/profile.ts`,
  `staff.ts`), and both routes map that to 400 (`apps/server/src/me-api.ts`,
  `management-api.ts`). Resolved along the way: a number is kept exactly as typed, not normalised.
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
  the [Products overhaul](superpowers/specs/2026-09-12-products-overhaul-design.md). Decide how a
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
  the coarse `requiresManager` gate.
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

The branch added certificate-trust guidance before collecting setup details, connection retry/help,
matching download/help paths over HTTP and HTTPS, and an installer QR pointing at the guide, covering
macOS, Windows, Linux, ChromeOS, Android and iPhone/iPad with browser-specific instructions. #346
(2026-09-13) reworked both pages after an owner review — the guide opens the visitor's own device's
steps and shows roughly half the on-screen text it did, and the wizard's connection step shrank to one
question.

One guard here is narrower than its name. `scripts/trust-page-logo.test.ts` checks that the logo
pasted into the server's source still matches the brand lockup — the two drawings agree, and nothing
else. It does not check that the page renders, that either theme is readable, or that the logo is
visible at all. That distinction is exactly what the new `CLAUDE.md` §4 rule is about, but the guard
itself is not named there. **Next action:** name it and its hedge on that rule's line, whenever
`CLAUDE.md` is next opened for a PR.

Walked on real devices — the owner reported the certificate installation, reopening without a
warning, and replacement after a re-image done on 2026-09-14. Which OS and browser versions were
walked was not recorded here. `deploy/README.md` keeps the advice for whoever installs the box.

### B2. Backups that leave the box

- **Guided Cloud snapshot recovery for test venues is built.** Cloud approval alone does not
  authorize trading or stop another server.
- **S3-compatible bucket, then Google Drive.** Only `LocalFsBackend` exists. The abort-aware
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
  alternative. (Reworded 2026-09-21: this line named `pg_dump`, which the storage switch removed.)
- Carry-forwards under *Detail → Backup*.

### B3. The bootable USB installer

Runs `waitron.sh install` unattended. Open questions it owns: whether the stick carries the images so
install needs no internet; unattended updates for a box we did not sell; AP-mode WiFi onboarding. Box
image constraints under *Detail → Box image*.

### B4. Upgrades and migrations

- **Core release points 1 to 6 could not upgrade — CLOSED 2026-09-23.** The storage switch (#489)
  regenerated every migration set, so the journal that had that shape no longer exists
  ([conventions-data.md](developers/conventions-data.md) → the core journal's contradictory shape),
  and the `db:generate` hazard went with it: run on 2026-09-23 in a throwaway checkout whose schema
  and migration files are `main`'s at `9cd2fda58`, `pnpm --filter @waitron/db db:generate` printed `No schema changes, nothing to migrate` and
  wrote no file.
- **Every migrating path but boot and the bucket rebuild runs with no ahead-of-image check.** No
  count belongs here: `conventions-data.md` holds the list, re-grepped 2026-09-25, and it is longer
  than what CLAUDE.md §3 names — it adds a readiness runner and the dev, demo and Cloud fixture
  scripts under `apps/server/scripts`, two of the Cloud fixture scripts migrating through
  `restore.ts` rather than calling `applyMigrations` themselves, which a grep for that name alone
  does not find.
  `instance-apply.ts` is no longer among them: it went with `waitron-provision instance` when a venue
  became a directory of SQLite files, and with it the question of gating a migrate that could lock a
  trading shop's tables.
- **Provisioning's migrate path still runs the linear full `manifestSets()`** — route it through the
  resolver once it gains per-module enablement.
- **`modules.json` has no flow-down channel** from a primary to its standby (matters under
  *Afterwards*, designed now that bookings is genuinely toggleable), and a toggleable module that is
  load-bearing (identity, payments) fails boot loudly if disabled until the wiring inversion.

### B5. The recovery page and degraded mode

- **The recovery spec** — a degraded-but-trading mode and the module-contract field it needs.
- **The recovery page's secret bound is a convention, not a guard.** #310 masks URL credentials on
  every log line — the connection-string shape and nothing else. A secret in any other shape still
  reaches the unauthenticated page through the log tail, bounded only by the convention that an
  `AppError`'s params carry none.
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
  savepoint** (`packages/printing/src/runtime.ts`; found reviewing `feat/sqlite-slice1-change-log`,
  2026-09-21, and NARROWED by the storage switch — the code and its comment were corrected on
  `feat/sqlite-slice1-flip`). The batch-down failure this used to describe is gone with PostgreSQL:
  it rested on an aborted transaction making the `catch`'s own `reportPrintJob` fail `25P02`, and on
  this engine a refused statement backs ITSELF out and leaves the transaction usable
  (`CLAUDE.md` §3; measurement in `bench/sqlite-failover/README.md` → "What S5 measures, and the
  savepoint it does not need"). What is still wrong, and is the whole of the item now: when the
  refusal is the `done` `reportPrintJob` inside the `try` rather than `transport.send`, the `catch`
  records `failed` for a job whose bytes were already sent, so a later batch prints it again.
  #572's probe (Node v26.7.0) found the refused report itself leaves nothing behind: inside one
  transaction an `UPDATE` refused by a `raise(abort)` trigger left the row unchanged and undid
  another trigger's insert, and a later `UPDATE` in the same transaction committed; #572's review
  reproduced the reprint. No caller in the tree reaches it —
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
  `apps/server/src/stripe-account.ts` does, each with a failing test first. #378 (2026-09-14) removed
  the tenant parameter that had blocked this. `rotate` re-checks a secret against the current list
  only when it re-seals one: it skips a secret already on the current key (`rotateCredentials`,
  `packages/credentials/src/store.ts`), so an out-of-date one stops a key rotation only when it is
  on an older key, until it is re-entered (measured by #577's review).
- **`CardProviderBuildDeps.nodeId` is dead weight — nothing reads it** (2026-09-16, traced through
  both adapters). `packages/payments-sumup/src/provider.ts` declares the field and never touches it,
  and `reverseViaStripe` (`packages/payments-stripe/src/reverse.ts`) requires it on its options
  object but destructures only `resolveProcessorRef`. Removing it is a code change, deliberately
  left out of the claims-only fix wave that found it. **Next action:** delete the field and the
  values every caller passes, or, if a record path is meant to use it, wire it up and say where.
- **The same hand-built SQL array appears in several packages** — `sql.join` of each value inside
  `array[...]::text[]`, in `packages/catalogue/src/provisioning.ts`,
  `packages/provisioning/src/venue-apply.ts` and `apps/server/src/configuration-transfer.ts` (find
  others with `grep -rn "::text\[\]"`). It is rebuilt by hand because interpolating a JavaScript
  array as one value makes Drizzle emit a list of values rather than an array, which PostgreSQL
  refuses. One shared helper would stop a wrong copy being written; its home has to be added to
  `@waitron/db`'s enumerated `exports` map, which is why it is not a five-minute change.
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
- **Hardening from onboarding 2b:** a DB-level advisory lock spanning guard→stamp→`applyVenue`
  (see the next item); a wizard-only box runs its trading life on the owner role rather than
  `app_user` until the role-split retrofit.
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
  `provisioning.database_ahead` but does not assert that `startServer` was never called (#617's review
  found the stale pointer; the missing assertion was read on 2026-09-25). **Next action:** add that assertion, prove it by moving the call after
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

- **A pull request that changes only `scripts/bundle-node.mjs` builds no bundle — DONE (the
  owner's answer (a), 2026-09-24, to the note lane B's campaign queue item B8 raised about #580 —
  not §B8 above; **PR #593**, main `97467c013`; checked on real CI with the throwaway draft #595, whose one-line change to `scripts/bundle-node.mjs` selected the four members and ran `bundle-smoke`, run 36045110201).** `scripts/changed-scope.mjs` now carries
  `ROOT_SCOPE_CONSUMERS`, which maps `scripts/bundle-node.mjs` to the four members whose `build`
  runs it (server, print-agent, credentials, provisioning) and `scripts/dev-server-proxy.ts` to the
  three front-ends whose `vite.config.ts` imports it; `scopeForPaths` selects those members, so a
  change to either is `code=true` and `bundle-smoke` runs. The list is hand-written, and
  `scripts/root-scope-consumers.test.mjs` fails in both directions — a member file naming a root
  `scripts/` file by relative path that is not listed, or a listed pair no file makes. That guard
  reads text: a path assembled from parts is invisible to it. **Still open:** `bundle-smoke` builds
  only the credentials and server bundles, so a change to the shared script selects print-agent and
  provisioning for typecheck and tests but builds neither of their bundles in CI. `bundle-smoke`
  built the same two before #580 (`git show 7b1ad8889^:.github/workflows/ci.yml`).
- **Every package to the high coverage bar, `98/98/98/95` — DONE (owner decision 2026-09-23; the
  floor retired 2026-09-24 by **PR #549**).** Every package and the root project now hold
  the bar, and `scripts/coverage-thresholds.test.ts` pins one bar for all of them, a new package
  included from its first commit; the `90/90/85/85` floor is removed from the guard and retired as
  policy (live prose mentions it only as retired; dated history still records it). The first
  promotion LANDED as **PR #498** (2026-09-23, main `0988e9af`): every
  package that already cleared all four metrics on 2026-09-23 was promoted in one change, 21 of
  them; the starting figures are in [ci-and-gates.md](developers/ci-and-gates.md) → *The first
  promotion — measured 2026-09-23*, and the per-package figures at the end are in
  **PR #549**'s description.
  Promoted since, one pull request each: `printing` (**PR #500**, 2026-09-23 —
  tests for the calibration locale fallback, the encoding name and a mid-payload switch to plain;
  100/100/100/100); `bookings` (**PR #503**, 2026-09-23 — tests for the seat refusal when a booking leaves
  `booked` inside `openTab`, a location with no row, the passive refresh copy, and the dashboard's
  single-flight guards; 99.76/100/100/98.38); `tunnel` (**PR #506**, 2026-09-23 — tests for a
  repeated `ack`, a frame the client ignores before `go`, and the test relays surviving a peer's
  connection reset; 100/100/100/100); `print-agent-app` (**PR #508**, 2026-09-23 — tests for
  malformed mDNS packets, out-of-range subnet addresses, non-printer usbmisc entries, a late socket
  event, an IPP reply cut off mid-body, and the setup page's fallbacks and non-text form fields;
  99.23/99.65/98.4/97.83); `provisioning` (**PR #510**, 2026-09-23 — tests for the tenant and
  venue readers the one-taxpayer and one-venue guards consume, and for a same-taxpayer re-run
  refused when the database already holds two venues or its till, node or series differs from the
  plan; 100/100/100/99.03); `payments-sumup` (**PR #512**, 2026-09-23 — tests for the default
  one-second poll, a reversal with no row or no SumUp key, a removed reader's status, a declined
  duplicate incident, and the dashboard dialogs' single-flight, detach and dismiss paths;
  99.24/99.71/98.03/98.93); `payments-stripe` (**PR #514**, 2026-09-23 — tests for a negative
  minor-unit amount, a reader cancel refused after a timeout or a network error, a restricted key
  of unknown environment, the default SDK factory, an on-device forward pass the device resolved
  none of and one with two declines sharing an incident, and the dashboard forms' single-flight,
  dismiss, default-callback and error-copy paths; 100/100/100/100); `server-kit` (**PR #515**,
  2026-09-23 — tests for the mTLS test server recording the first of two CNs, serving a client
  certificate with no CN, and refusing a second close; 100/100/100/98); `sync-enrolment` (**PR
  #518**, 2026-09-23 — tests for a drop and re-create inside one migration file and for table names
  read without regard to case; 100/100/100/100); `dashboard-kit` (**PR #521**, 2026-09-23 — tests
  for the live event stream's default credentialed open, a stream it has replaced, a reset, an
  error the stream retries itself, malformed change and session-invalid messages, a stop before the
  first open, and the query controller's reads without a live-data session and a throwing apply;
  one unreachable guard in `live-data.ts` deleted; 100/100/100/100); `fiscal-none` (**PR #522**,
  2026-09-23 — tests for the slot binding no authority endpoint into activation evidence, even for
  a certificate secret the verifactu slot turns into one; for the void and substitution refs and
  the node registration checked field by field, where an empty void or substitution record id
  had passed; and for a correction or substitution returning the new sale's id rather than the
  replaced sale's; no source file changed; 100/100/100/100); `setup` (**PR #523**, 2026-09-23 —
  tests across the wizard shell, its API client and nine screens, among them answers arriving
  after the wizard is removed, a newer connection check winning over a late boot read, a country
  pack with no provinces, and a draft country with no pack; one bug fixed, going back to "Select
  province" now clears the province where it had kept the old one and submitted it;
  99.78/100/100/98.68); `print-agent` (**PR #525**, 2026-09-23 — tests for a join refused for a
  reason other than closed pairing, an unreadable join status, a denial dropping the saved
  verification number, the environment named when no primary accepts, the agent's own client
  built on the host's fetch, non-Error failures from a send, a scan, an address probe, an
  office-printer check and a whole tick, a stop during a tick, an enrol that times out, malformed
  join, enrol and job-list replies, and the test fake host's defaults and recording behaviour; its
  two unused setters (`setToken`, `setConfig` in `src/testing/fake-host.ts`) deleted;
  100/100/100/100); `identity` (**PR #526**, 2026-09-23 — tests for the refusals in issuing,
  inspecting and completing an account action and in confirming an email change by code, a
  Google subject linked to a person who is not active, an MFA secret that does not authenticate,
  a profile read for a person row that no longer exists, and the refusals and side effects of
  editing, deactivating, resetting, clearing the PIN of and re-inviting staff; a collision that
  reaches the write past its availability check is planted by a test-only trigger, since one
  writer at a time leaves no race to win; no source file changed; 100/100/100/100); `catalogue`
  (**PR #530**, 2026-09-23 — tests for listing and renaming a menu's sections, the
  unit reads and writes refused for an id that names nothing, a variant refused as
  Unavailable or not offered on a menu, a product with no variant sold as itself, a delete
  preview's menus in offer-id order, a product extras read handed a wider attachment map or one
  naming a deleted list, and non-text names and ids in the extras and options contracts; no
  source file changed; 98.82/99.53/100/97.37); `apps/server` (**PR #534**, 2026-09-23 — tests
  for the boot's wiring (account email through the saved SMTP gateway, read on each send; a
  language change refused while a library image has no name in it; a failing tunnel client or log
  directory; the plain-HTTP landing page; and, in setup mode, a provision resumed after its venue
  committed, a restore refused before staging, an adoption refused for an unreachable primary, and
  a staged configuration import), the setup routes' refusals, locks and restart resumption, the
  management and profile API's Google sign-in, password back-off, invitations, staff status, PIN
  and authenticator paths, the till's reader, kitchen-display and PIN back-off refusals, payment
  and backup refusals, print-agent screening and payment slips with nothing to print, and the
  recovery commands failing part-way; no source file changed; 99.18/99.21/99.29/97.33);
  `apps/till` (**PR #536**, 2026-09-23 — tests for the till app's table service, boot and
  counter paths, the server router's start and error statuses, the session's wake lock and idle
  timer, tender entry by the Enter key, idle choices and weighed dishes, and nine screens; one bug
  fixed, a sale or a new table answering after the operator had logged out took the till off the
  lock screen with nobody signed in, and now leaves it locked; no test added to the files the
  variants branch `feat/variants-sale-line` (not yet pushed on 2026-09-23) changes, which is why
  the table-service, boot-and-counter and three `tender-pay-*` suites are separate files that can
  be folded back into `till-app.test.ts` and `tender-pay.test.ts` once it lands;
  98.82/99.08/98.97/96.93); `apps/dashboard` (**PR #538**, 2026-09-23 — tests for the login
  screen's Google, passkey, two-step, emailed-link and reset paths, the app shell's session signals,
  module navigation and screens opened from their address, the printers, backup, payments,
  kitchen, devices and email screens (a disabled printer offered again keeps its id), the canvas
  editor and grid preview, categories, units and their forms, the modifiers screen and the extra
  and option list forms, the API client's routes and refusals, and the staff, profile, roster,
  schedule and purchases screens; no source file changed; none added to the files lane B's variants
  work is changing; 99.2/99.58/99.42/97.73 statements/lines/functions/branches, 97.71 branches on a
  second run); `venue-service` (**PR #546**, 2026-09-24 — tests for the opening-hours,
  zone-menu display-order and product-route bodies the management routes refuse, a device's own
  default zone winning over the counter default, moving an order to another zone's department and
  service mode with its line snapshots kept, an empty round, one menu-item read per round,
  copying from an order or line with no snapshot, route refusals and a route widened to the whole
  venue, and the operations screen's sorting, fallbacks, form refusals, keyboard paths and focus
  return; no source file changed; seven guards in `operations.ts` and four branches in the
  operations screen left uncovered because no current caller reaches them — by reading, except the
  missing-department refusal in `recordWorkingLineContexts`, which a foreign key was measured to
  block; each is listed with its reason in the pull request; 99.4/99.34/100/97.61); `media`
  (**PR #547**, 2026-09-24 — tests for the configuration-transfer refusals of a
  label spelled in two cases and a bundle with no usable default language, search's leading or
  doubled OR, a term scored at its best field and an image at its best OR group, name and date
  ties broken by id, an edit to an unknown id reported as not found first, the upload fallback
  language when the venue sets none, the module descriptor's permission, transfer check and
  translation-gap entry, and the image library's cancel, Enter-to-save, Escape and Close paths,
  retry after a failed load, the previous page, single-flight delete and late usage lookups, plus
  the image picker waiting for a request and following a replaced live-data source once the
  library loads again; one redundant check deleted — `updateImage`'s "no row updated" refusal,
  because the function ends by calling `readImage` again, which throws the same `image.not_found`
  for a row that is gone, so no caller can see a difference (by reading; the review restored the
  check with an error of its own and the package's node images suite, 38 tests, passed without it
  firing); six branches left uncovered, by reading, because no operator action or database state
  reaches them — except the image picker's first draw with neither a request nor a live-data source,
  which does reach one but draws nothing whichever way it goes, so no test could tell the two apart;
  each is listed with its reason in the pull request; 99.82/100/100/98.46). With `media`, no
  package was left at the floor.

- **Prune the comments, one package per pull request — IN PROGRESS (owner decision 2026-09-23).**
  Keep a comment only for an invariant, or a non-obvious why, that the code cannot show (CLAUDE.md
  §1). The rule change and the checker every pruning pull request passes,
  `scripts/comments-only.mjs <base>`, came first; its header states what it refuses and misses.
  What a pruner meets: it reads commits only, never an uncommitted edit; any changed file that is
  not TypeScript or JavaScript fails it; and it refuses a trailing comma added or dropped after a
  spread, where Prettier writes one, so a pruning edit that lets such a call, array or object
  fold onto one line is refused. The packages follow, the fiscal ones under the
  same gates as any other fiscal change: the golden huella test and the `inmutabilidad` suite pass
  unedited. Not reached by any package's pull request: `bench/` (about 2,300 comment lines) and the
  root `vitest.config.ts` and `eslint.config.js`. Landed so far: `workforce` (#555, about 2,700
  comment lines to about 750), `payments` (#558, about 2,000 to about 750), `identity` (#559, about
  2,000 to about 640), `provisioning` (#561, about 1,740 to about 400), `fiscal-verifactu` (#562,
  about 3,250 to about 1,550), `apps/setup` (#567, about 1,390 to about 310), `packages/store`
  (#568, about 1,120 to about 555, tests included), `packages/payments-stripe` (#570, about 1,080
  to about 270, tests included), `packages/printing` (#572, about 1,040 to about 350, tests
  included), `packages/bookings` (#574, about 1,020 to about 270, tests included),
  `packages/credentials` (#577, about 990 to about 410, tests included), `packages/shared` (#579,
  about 945 to about 330, tests included) and `packages/scheduler` (#581, about 820 to about 350,
  tests included) and `packages/db/src/schema` (#585, about 2,430 to about 1,110, tests included)
  and the rest of `packages/db` (#589, about 3,000 to about 1,950, tests included) and
  `packages/fiscal` (#592, about 690 to about 245, tests included) and `packages/payments-sumup`
  with `packages/migrations` (#597, about 1,090 to about 800, tests included) and `packages/core`
  (#598, about 1,870 to about 660, tests included) and the small packages as one pull request
  (#600, about 2,980 to about 1,720, tests included: `apps/print-agent`, `print-agent`,
  `server-kit`, `tunnel`, `membership`, `sync-enrolment`, `workforce-es`, `purchasing`, `recipes`,
  `fiscal-none`, `composition`, `diagnostics`, `dashboard-modules`, the `country*` packages,
  `ui-core` and `dashboard-kit`) and `packages/reporting` (#601, about 1,885 to about 1,265, tests
  included; the generated `src/dr303-layout.ts`, 185 of those lines, is untouched) and `scripts/`
  (#602, every `.ts` and `.mjs` file, about 4,870 to about 2,770 counted with the same `grep -cE`;
  the `.sh` files and `write-path-tables.json` are outside the checker and were left) and
  `packages/catalogue` (#603, about 3,560 to about 2,200 counted with a parse-tree walk over every
  `.ts` file, tests included) and `packages/ui` (#604, about 1,144 to about 503 with the `grep -cE`
  count, tests included; comments inside `css` and `html` template literals are strings and were
  left) and `packages/module` (#606, about 363 to about 200 counted with the parse-tree walk, tests
  included) and `apps/dashboard/src/screens` (#607, about 3,170 to about 1,110 counted with the
  parse-tree walk, tests included) and `apps/dashboard/src/api` + `src/widgets` (#610, about 2,830
  to about 980, parse-tree walk, tests included) and the rest of `apps/dashboard` — the files
  directly in `src/`, `src/i18n`, `src/state` and the two configs (#612, about 1,375 to about 377,
  parse-tree walk, tests included; comments inside `css` template text are strings and were left) and `packages/media` (#609, about 505 to about 310, parse-tree walk, tests included; the shipped
  `drizzle/` SQL untouched) and `packages/venue-service` (#611, about 478 to about 220, parse-tree
  walk, tests included) and `apps/server`'s `till-*` files, part a of eight (#613, about 4,330 to
  about 1,915, parse-tree walk, tests included) and `apps/till/src/screens`, part a of four (#614,
  about 2,233 to about 800, parse-tree walk, tests included, plus stale twins of its corrected claims
  in `till-app.ts`, `api/client.ts` and `widgets/card-grid.ts`; text inside `css` templates left)
  and `apps/server`'s errors, management, catalogue, configuration, purchasing and recipe files,
  part d of eight (#615, about 4,110 to about 1,340, parse-tree walk, tests included; five other
  server files' pointers into the pruned text repointed) and `apps/till/src/widgets`, part b of
  four (#616, about 1,870 to about 725, parse-tree walk, tests included, plus stale twins of its
  corrected claims in `till-app.ts`, `api/client.ts` and three screens; text inside `css` templates
  left) and `apps/server`'s join, node, membership, enrol, trust, setup, box, provision and device
  files, part f1 (#617, about 2,360 to about 1,110, parse-tree walk, tests included; the 13 part-f
  files the SQLite slice-2 plan will change are held back as f2) and `apps/till`'s `src/api`,
  `src/state` and `src/i18n`, part c of four (#618, about 2,420 to about 1,130, parse-tree walk,
  tests included) and `apps/server`'s remaining files, part h1 (#620, about 4,010 to about 1,970,
  parse-tree walk, tests included; the 17 part-h files lane A's slice-2 branch or plan Tasks 7–10
  name are held back as h2) and the rest of `apps/till` — the files directly in `src/` and the
  two configs, part d of four (#621, about 2,660 to about 1,250, parse-tree walk, tests included;
  `till-app.ts` alone 1,286 to 349) and `apps/server`'s kitchen, print, receipt, station, report,
  payments, webhook, pass, me, transfer, served, sale, split, move and modifier files, part g (#622,
  about 4,120 to about 1,750, parse-tree walk, tests included) and `apps/server`'s working-order,
  tabs and tables files, part b (#623, about 4,040 to about 1,920, parse-tree walk, tests included;
  `working-order.ts` alone 1,854 to 471) and `apps/server`'s boot, health, SPA and dev-hint
  files, part c1 (#624, about 1,455 to about 400, parse-tree walk, tests included; `boot.ts`,
  `boot.test.ts` and `config.ts` are held back as c2 because the SQLite slice-2 plan's Tasks 8–10
  change them) and `apps/server`'s adopt, backup, break-glass, mirror, primary-url, promote,
  recovery, rejoin, restore-entry-guard, restore-gate and retire files, part e1 (#625, about 3,090 to
  about 760 over the 64 files, parse-tree walk, tests included; the 14 part-e files the SQLite
  slice-2 plan's Tasks 8a–10 name are held back as e2). #625 also deleted the false "the verb is the
  whole guard" note from `tables.ts`, `management-api.ts` (five copies) and `till-api.ts`. Then
  `apps/server`'s `box-status.ts` and `awaiting-fiscal-cert.test.ts`, two held-back files the
  SQLite slice-2 plan's remaining tasks no longer name, part x (#629, 91 to 16 comment lines).
  A pruning pull request
  cannot carry this file (the checker refuses it), so each one's line lands here as a docs-only
  push after the merge. Found by #555, #558, #559, #561, #562, #567, #568, #570, #572, #574, #577,
  #579, #581, #585, #589, #592, #597, #598, #600, #601, #602, #603, #604, #606, #607, #609, #610, #611, #612, #613, #614, #615, #616, #617, #618, #620, #621, #622, #623, #624, #625 and #629 and left for the package that owns each, all
  still OPEN:
  - Found by the retroactive Codex reviews of #621–#626 and #629 (C3.18.12r, 2026-09-25; fixes
    landed as #632, #633, #635, #637 and #639; #626 and #629 came back clean), outside the files
    those fixes could change or not changeable in a comments-only PR:
    `apps/server/README.md` (near line 496) still says an `error` line and a 503 are "the same
    condition by construction", the claim #637 removed from `health.ts` (a duty can go stale between
    passes: Codex got a 503 with no log line), and #637's review read its list of 503 causes (near
    line 404) as naming one that answers 200 — read, not run. The degraded-pass spec and plan
    (`docs/superpowers/specs/2026-07-27-degraded-pass-design.md`,
    `docs/superpowers/plans/2026-07-27-degraded-pass.md`) and
    `docs/superpowers/specs/2026-07-26-server-host-design.md` repeat that claim and want a dated
    pointer. Test titles: `apps/server/src/spa-api.test.ts`'s two cache cases say hashed versus
    non-hashed where the rule is the `/assets/` prefix, and `boot.mirror.test.ts`'s opt-in case
    says "binds 0.0.0.0" while connecting only over loopback. `apps/server/src/rebuild-first-start.ts`
    (near line 121, lane A's file) says "The log carries the error's code only", the overclaim #637
    corrected in `health.ts` (`codeOf` logs `unknown` for a plain error carrying `code: "EIO"`).
    `apps/server/src/backup-api.ts` (near line 335, from #557) says the rotate route rewrites "the
    key alone"; it also writes the rotation time. "Empties every table" in
    `packages/bookings/src/schema/bookings.test.ts` (near line 60) and
    `packages/catalogue/src/migrations.test.ts` (near line 304) is wider than the reset, which
    leaves the migration journals (`packages/db/src/testing/venue-db.ts`).
  - Found by #629 (`apps/server` part x), for `boot.ts`'s own prune (c2, held back while the SQLite
    slice-2 plan changes it): the comment near line 1491 says a promoted primary has no
    `fiscal.aeat` cert "until the cert-distribution slice lands", which is plan history; the one
    near lines 2188–2190 carries a "(B3)" history tag and refers to "the N/A placeholder
    box-status" reports — a term only the `BoxStatus` comment #629 deleted defined.
  - Found by #625 (`apps/server` part e1), outside its files or not fixable in a comments-only
    change. Comments in files the SQLite slice-2 plan still changes (fix them in e2, c2 or h2):
    `db-wipe.ts` (near its top) says the empty node-file fact is recorded where
    `rejoin-command.ts` and `break-glass-command.ts` open their handles, and #625 deleted it from
    both; `boot.test.ts` (held back as c2) lists `promote-endpoint-e2e.test.ts` among suites whose
    header records the drain half, and that header is gone; `restore.ts` and `errors.ts` call
    backup "the cold-recovery path CLAUDE.md §5 says has to work", which §5 does not say, and
    `backup-supervisor.ts`'s "must never brick the till (§5)" stretches §5's "nothing EXTERNAL may
    block a sale". Docs: `docs/developers/conventions-ui.md` (the recovery page section) says a
    caught error's own text goes to the container's stdout only, but the page's log tail can carry
    it (the file sink masks only credentials in a URL); `docs/developers/conventions-data.md`'s
    `busy_timeout` receipt, which `recovery-lock.ts` now points at, should carry the date and Node
    version the deleted comment had (2026-09-24, Node v26.7.0). Tests and code, read not run unless
    stated: three `adopt.test.ts` titles say "before any mutation", but by then the primary has
    reserved an identity for the standby and added it to its membership list (the tests assert only
    on the mirror's own database); `adoptFromPrimary` (`adopt.ts`) spreads one adoption across
    several transactions with file writes between and no commented decision (CLAUDE.md §3), so a
    failure partway could leave a stamped mirror with no break-glass verifier; the membership list's
    eight-node cap (`MAX_NODES`, `packages/membership/src/verify.ts`) is enforced only by the
    verifier — #625's review measured a nine-node list minted without complaint — so whether the
    mint should refuse is an open question; the restore guard's repeated-destination check compares
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
    change. `apps/server/src/node-entry.ts` (the comment after the boot-failure report is written)
    says the scrubbed text "has already gone to stdout from runEntry's catch"; that is false for a
    failure reading the recovery state or writing the boot counter, which run before the `try`
    (receipt in #624's commit message, which moved it out of `boot-failure.ts`). Two other comments
    in the same file, on the installer's stdout channel, call it "the one place the caught error's
    own words may appear", which the recovery page's log tail contradicts (`recovery-surface.ts` and its "caught error's own words on the
    page" test). `docs/developers/workflow-guide.md`'s dev migration hint section still describes the PostgreSQL
    version (PostgreSQL 18, `23P01` on the list, `classifyBootFailure` dropping `22P02`, "the two
    share no SQLSTATE table", remedies that are opposites); the two lists are now SQLite result
    codes, `boot-failure.ts`'s codes lead to "retry or restart", and `dev-migration-hint.ts` still
    names that section as its receipt. `boot.test.ts` (held back) implies a
    `mockClear`/`mockReset` contrast that is false on Vitest 4 (both keep the implementation; #624's
    review ran it). Tests, not comments: `boot-failure.test.ts`'s "names every pinned result code
    as an unreachable database" cannot fail when a code is added (the review added 26 and the suite
    passed), and two `health.test.ts` cases, "stays 200 when reconcile has failed runs but nothing
    parked" and "does not flip health for a failed-only run (parked stays 0)", feed a clean pass, so
    they check less than their titles say. Test titles #624 could not touch: "(T12b)" in
    `boot-pending-sweep.test.ts`, "(prove-by-deletion)" in `boot.reconcile.test.ts`, "(C2)",
    "(pre-merge review)", "(I1)" and "skipped a tenant" in `health.test.ts`, "the new guard" in
    `config.test.ts`.
  - Found by #623 (`apps/server` part b: working-order, tabs, tables), not fixable in a
    comments-only change. **Editing a held order that has already sent lines to the kitchen deletes
    their ticket items and never re-sends the new lines.** `PUT /api/working-orders/:id` checks only
    that the order is open; any edit that is not a pure quantity change takes `updateHeldOrder`'s
    replacement path (`apps/server/src/working-order.ts`), which deletes every line and inserts new
    ones, and deleting a line cascades to its ticket item. Run in the review on a real database: a
    tab whose one line had been fired was edited to a different dish, its ticket-item count went from
    1 to 0, and the new line was never fired. Whether a correction slip prints was not established
    (no printer in the setup); read, not run: `updateHeldOrder` never calls
    `enqueueCorrectionSlips`. Split-off checks may reach the same path (read, not run). Also: the
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
    UNCHANGED" in `tabs.filing.test.ts`; many "(till-reroute §3.6)", "(KDS-…)" and "(A1)"-style
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
    Stale line pointers into moved schema files remain in `backup-api.route.test.ts`, and `working-order.ts`'s `splitOffCheck`
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
    (`till-reroute §4.4` in a `css` rule and in `render()`, `cash-drawer-authorization §5`,
    `device-enrolment §3.1`), and many `till-app.test.ts` titles carry plan and review labels
    ("(Finding 2)", "(P6)", "(FP-1)", "(KDS-1)", "Task 8", "(SP-B2.1)"), as do three
    `session-activity.test.ts` titles ("(C3)").
  - Found by #620 (`apps/server` part h1), not fixable in a comments-only change.
    **The demo seed does not refuse a production stamp** — DONE (#644, owner instruction 2026-09-25):
    `demoSeedEnvironment` in `scripts/demo-seed/seed-sales.ts` refuses `production` with
    `deployment.demo_data_refused` before `seedDemoRestaurant` or `seedSales` writes anything, and
    `devSetup` (`scripts/dev-setup.ts`) calls it before it reads the `.env` or migrates the venue —
    the run-it review measured the earlier shape committing the taxpayer and one staff row
    (`{ tenants: 1, staff: 1, sales: 0 }`) before the seed refused, and a retry under `dev` on that
    directory refused it as already holding a venue. Each call site's test was run red before its
    guard existed, then green: the two seed tests resolved instead of rejecting, and the `devSetup`
    test rejected through the seed's guard but found `venue.db` already on disk.
    `redact-secrets.ts` was written against the PostgreSQL connection-string parser, and `pg` is now
    installed only for `bench/pglite-throughput`; whether a credential-bearing URL can still reach
    the log is unchecked. `apps/server/vitest.config.ts`'s `coverage.exclude` lists `scripts/**`,
    which its `src/**/*.ts` include already leaves out (read only). The adoption-pending entry below
    still gives PostgreSQL's SQLSTATE 23503 on `nodes_location_id_locations_id_fk` as evidence; this
    engine reports `FOREIGN KEY constraint failed` and names no constraint. Held back in h2,
    `apps/server/scripts/record-one-sale.ts` still says leaking its two SQLite files keeps the
    process alive (false per #577 below), that the repository has no till application, and "see
    this task's own report". Test titles #620 could not touch: "never a 23514 500" in
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
    matches. (The advisory-lock sentence in `packages/catalogue/src/options.ts` went with #603, and
    the "Checking one product's translations" entry below no longer says a lock is taken.)
    `packages/media/drizzle/0001_image_references.sql` (about lines 22-24) says `workspace-cycles`
    refuses an "import"; that guard reads `package.json` files (a shipped migration, likely left).
    Two reasons #602 deleted and did not restore, for the owner to confirm: the hook bullet at the
    top of `scripts/check-signoff.test.mjs` no longer gives a reason (the shell-instead-of-`.mjs`
    decision `licence.yml` points at is still stated), and `scripts/english-only.test.ts`'s
    provisioning-test exemption lost its end condition ("until that test runs against fiscal-none",
    spec §6 step 5).
  - Found by #601 (`packages/reporting`). **Re-deriving a closed day does not reproduce its
    snapshot once a later void touches that day's sales**: #601's Codex seat recorded a void on 5
    August for a 4 August sale, and 4 August's recomputed VAT went from 21.00 to 0.00. So
    `docs/superpowers/specs/2026-08-07-frozen-daily-close-z-design.md`'s "Determinism" claim that
    re-deriving a closed day and comparing it to its snapshot is a valid audit does not hold as
    written (a dated pointer there says so). **Owner decision 2026-09-24: a void counts on the day it is
    made, not the day of the sale**, so a later void no longer changes a closed day's re-derived
    figures — DONE in #605: the daily close's VAT, the period VAT
    summary and top sellers count a sale on its issue day and subtract it on the void's business
    day; the close counts keep the sale in `sales` on its issue day and count the void under
    `voids` on its own day; the cash-up is unchanged (a void writes no tender). The quarterly
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
    (`packages/membership`), which `routableServers` then drops. The slice-2 plan
    (`docs/superpowers/plans/2026-09-23-sqlite-slice2-stream-and-cold-restore.md`) and the
    2026-09-03 reserved-standby spec cite line numbers in `membership`, `apps/print-agent/src/config.ts`
    and `sync-enrolment/src/classification.ts` that #600 moved; they are historical and were left.
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
    Outside core (`till-sale.ts`'s copies went with #613),
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
  - The same false comments #562 removed from `fiscal-verifactu` survive elsewhere (#598 removed
    `packages/core`'s, #613 `till-sale.ts`'s chain-head lock):
    `boot.ts` named as the owner of the AEAT certificate resolver in `apps/server/src/boot.test.ts`
    (`packages/fiscal-verifactu/src/slot.ts` builds and closes it). Prune with those packages.
  - `apps/setup` code, found by #567 and not changed: `#onGoto` in `setup-app.ts` does not clear
    `fiscalTestError`, so the routed-back fiscal-test banner survives navigating away and back;
    `deployment.already_stamped` is labelled "Reload to open the till" on the provision path and
    plain "Reload" on the adopt path, and a reload of a box still in setup mode reopens the wizard;
    `AdoptOutcome`'s `breakGlassSecret` is typed as required, but a replayed adopt answers without
    it (`apps/server/src/setup-api.ts`); the done screen treats any failed status read as "the box
    is trading", so a passing 503 could offer the reload early; the mode screen's own text says a
    live server files real invoices, which a live run on a development box does not;
    `setup-app.test.ts` has two test titles naming a `SyntaxError` from a non-JSON error body that
    `apiError` turns into `server.internal`, and one saying a re-POST is "unrecoverable" where the
    server answers 409; `events.test.ts` has no case for the restore and fiscal-test dispatchers;
    the `*.css?inline` declaration in `vite-env.d.ts` is redundant (vite/client declares it);
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
  - Found by #589 (`packages/db` outside `src/schema`), not changed. Line pointers from other
    packages into `packages/db/src/schema`, most of them made wrong by #585 and some pointing past
    the end of their file: `apps/server/src/boot.test.ts:2761` (#625 removed `retire.test.ts`'s)
    (the `scripts/catalogue-engine-neutral.test.ts` pointers were removed by #602,
    `packages/venue-service/src/operations.ts`'s by #611, the `till-*` ones by #613, `join-requests.test.ts`'s by #617, and `kitchen-print.test.ts`'s and
    `sale-till-source.receipt.test.ts`'s by #622)
    — name the file and the column instead, with each package's pruning. In
    `packages/db/src/change-log.test.ts` the case under "THIS CASE NO LONGER SEPARATES ANYTHING"
    repeats the first case under another name (a test change, not a comment one). The same
    "as the table owner" wording #589 deleted from `packages/db/src/change-feed.ts` and
    `configuration-transfer.ts` (this engine has no table owners) was also in
    `docs/developers/dashboard-live-updates.md`, removed by the docs push after the land.
  - `packages/credentials`, found by #577 and not changed. Nothing now checks at run time that a
    read returns something other than a Node `Buffer` (the runtime case went with the PostgreSQL
    suite; a 2026-09-22 measurement read `Uint8Array`, `Buffer.isBuffer` false). Nothing checks
    that a caller other than the application cannot read or list the vault; only the encryption
    protects it. Test titles ending "— C1" and "(M7)" are old review labels, and
    `credentials.test.ts`'s fixtures `sk_test_rls`/`whsec_rls` carry a PostgreSQL-era name. The
    `beforeEach` deletes in the store, cli and rotate suites may be redundant beside `useVenueDb`'s
    per-test reset (not tried).
  - The same false comments outside credentials, found by #577: "open database files keep the
    process alive" in `apps/server/scripts/record-one-sale.ts`, `register-till.ts` and
    `settle-invoice-first.ts` (#577 measured an unclosed `openVenueDatabase` exiting at once with
    status 0); `apps/server/src/node-identity.ts` still says "ONE
    tenant transaction" and omits `credentials.key_version_unknown` among another node's read
    failures (the pointers to a missing `errors.reachability.test.ts` are gone:
    `git grep errors.reachability -- apps packages` prints nothing after #601); and two
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
    error numbers 23001 and 23505; the stores match SQLite's. The false "Inert: nothing here reads
    it" comment #588 removed from layouts (it was written about the deleted `tenantId` field and
    left on the next field down) went from `packages/db` with #589 and from `packages/core` with
    #598, both fields being read. (#612 removed the dashboard's comments quoting the PostgreSQL
    numbers for these two stores, #615 `apps/server`'s.) `packages/printing/src/errors.test.ts:5` says the
    error construction typechecks "ONLY because" of one import — #588's review measured the same
    claim false for printing and layouts (#615 removed `apps/server/src/errors.test.ts`'s copy). The shipped `packages/media/drizzle/0001_image_references.sql` says `canvas-store.ts`
    tells 787 from 1811; it reads only 1811 (`device-profile-store.ts` reads both). #609 removed
    the same claim from `packages/media/src/image-references.test.ts`. Both layouts database
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
    `packages/reporting/src/record-daily-close.ts`'s PostgreSQL-era comments went with #601;
    `packages/store` was pruned by #568 before this was found. The reason "v8 reports phantom uncovered branches" given for excluding
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
    `docs/developers/conventions-data.md` gives, is now the bound enforced. The receipt: `assertMoney`
    checked the integer digits before rounding, so `decimalToCents` turned `999999999999.999` into
    100000000000000 cents, and `centsToDecimal` turned that back into `1000000000000.00` without
    refusing it (measured 2026-09-24 with a throwaway vitest case in `packages/shared`; control:
    `999999999999.99` round-trips unchanged). Still open: `centsToDecimal` itself has no digit
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
  (**PR #491**, 2026-09-23, main `8428395a`).** The comparison the core set had — build a database
  from the migrations, then check every table, column, key, index and check constraint against what
  the drizzle declarations say — is now a reusable suite factory,
  `packages/db/src/testing/schema-conformance.ts`, published from `@waitron/db`'s enumerated
  `exports` map as `@waitron/db/testing/schema-conformance.js`. Each set that calls it does so from
  its own `packages/<pkg>/src/schema/schema-conformance.test.ts`; the first five were core,
  `catalogue`, `payments`, `workforce` and `workforce-es`. **No drift was found in any of the four
  modules** — the guard went in over a clean tree, which is worth writing down so the next reader
  does not assume it has already caught something here. What it replaced: P6 got away with a one-off
  probe of `workforce-es` (its only scaled column had no default and appeared in none of its table's
  constraints), and #475 found its instances by hand.
- **Every migration set that builds a table now has a call site — LANDED (2026-09-23), one set per
  pull request:** `credentials` (**PR #497**), `scheduler` (**PR #499**), `identity` (**PR #501**),
  `bookings` (**PR #502**), `venue-service` (**PR #504**), `media` (**PR #505**) and
  `fiscal-verifactu` (**PR #507**); none found drift. `fiscal-none` needs none — its `drizzle/`
  holds an empty journal and no `.sql` file, so its set builds nothing. Each call site states the
  factory's blind spots that reach its own set.
- **Comments and a test name in several packages give a `tenants` foreign key their sets no
  longer build — DONE (2026-09-23, PR #516).** No set's SQL references
  `tenants` (`` grep -ln 'REFERENCES `tenants`' packages/*/drizzle/*.sql `` matches no file), so each
  site now says what an experiment showed. Two experiments, both undone afterwards. First,
  `useVenueDb` was made to apply its sets in REVERSE, then with core REMOVED, and the whole suite of
  `scheduler`, `identity`, `credentials` and `workforce-es` run each way: reversed, all four stayed
  green (90, 278, 138 and 33 tests, a log confirming each set ran before core); without core they
  failed `no such table: tenants` from `seedTenant` (all four), `no such table: locations` from
  identity's `seedTill`, and `no such table: change_log` from the drain every `withTransaction`
  runs (`packages/db/src/tenancy.ts`) — while scheduler's and credentials' own
  `migrations.test.ts` stayed green without core. Second, `applyMigrations` over the real manifest
  with core moved: every set migrated cleanly with core AFTER it except `media`, refused `no such
  table: main.products`, because `media/drizzle/0001_image_references.sql` creates triggers ON
  core's `products`. So (2026-09-24: #581 moved scheduler's to one line in
  `packages/scheduler/src/schema/schema-conformance.test.ts`, "No prerequisites"): `scheduler` and
  `identity`'s `migrations.ts` say the set migrates before
  core; `credentials`' says the same, plus that the code needs core present (`credentialProvisioned`
  reads `tenants`, the drain reads `change_log`); the two `migrations.test.ts` suites no longer
  list core; the manifest test is now "puts core first; media, which creates triggers on core's
  `products`, will not migrate without it"; the two `workforce-es` suites name the setup's seeds and
  `convenio_config`'s `locations` key; and the two demo scripts say only that the filter keeps
  manifest order. No production order changed. The same reason, or "ordering is the runtime's job
  and nothing enforces it" beside a list, was then corrected in more places, rechecked the same
  day: `applyMigrations` applied `workforce` ahead of identity and core, and `workforce-es`,
  `payments` and `fiscal-verifactu` ahead of core, all cleanly, while `media` in the same run was
  refused. So those four `migrations.ts` now say their set migrates before or after core (2026-09-24:
  workforce's no longer does; #555 pruned that sentence), with
  `payments` and `fiscal-verifactu` naming the core table their code reads; `workforce`'s
  `migrations.test.ts` names the seeds its cases need core for (without core it fails `no such
  table: tenants`, then `locations`), and `fiscal-none`'s says its case passes without core; the
  `schema-conformance.test.ts` comments of `workforce`, `payments`, `catalogue` and `bookings` say
  their prerequisites are the database the set's keys resolve in, not something the migration
  needs (each suite passes with an empty list — except, by #603's review, `catalogue`'s, which
  fails `no such table: main.products` without core; not re-run here); the worked example in
  `docs/developers/testing-guide.md` now points at workforce's conformance call site; and
  `packages/migrations/src/apply.ts`'s loop comment says sets apply in the order the caller passes,
  which boot derives from each module's declared `requires` (`orderedMigrationSets`), and gives
  media's triggers on core's `products` as the reason core must come first.

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

- **The spawn-timeout guard reads `scripts/` alone — SUPERSEDED 2026-09-22.** It was extended to
  `packages/` and `apps/` on 2026-09-18, and that half is gone again: it went with the
  real-PostgreSQL harness, which owned every long wait those two roots declared. Checked here
  before writing this — `grep -rnE "timeout: *[0-9_]+" packages apps --include="*.test.ts"` answers
  nowhere at all, where the same pattern under `scripts/` still finds waits — so the half had
  nothing left to judge. **The rule holds under both roots and nothing checks it there**, which is
  stated in `CLAUDE.md` §4 and carried with its measurement in
  [testing-guide.md](developers/testing-guide.md). No work here: re-extending the scan is worth
  doing only if suites under those roots start declaring long waits again.

  **Still open over the half that remains, and the guard cannot close it:** it compares a bound
  against the LARGEST SINGLE wait, never the sum, so a case that waits several times can still
  outlast a bound that passes this check. Only reading catches that shape; if it recurs, the answer
  is probably a runtime check rather than a text reader.

- **Reuse the stub executables in the root guard suites — LANDED (2026-09-18).** The follow-up from
  #407: `scripts/waitron-sh.test.mjs` and `scripts/main-tag-guard.test.mjs` now build their stub bins
  once per file and vary each case through environment variables, keeping every assertion, and `run()`
  in waitron-sh reports a killed child.

- **Fast local pre-push checks — LANDED #338 (2026-09-12).** The hook keeps sign-offs, the locked
  install, formatting, lint, the root guards and scoped typechecks, and runs no package tests; CI owns
  the package suites and their coverage thresholds. **The consequence to watch:** CI's `changes` job is
  now the only thing that runs a package's tests, so a package a branch touched that CI did not select
  has been tested by nothing — read that job's `code`, `scope` and `packages` outputs before calling a
  branch green.

- **A merge could get no CI run at all, and nothing was red — LANDED #384 (2026-09-16).** Every run
  for a ref shared one concurrency group and GitHub keeps only ONE run pending per group, so the
  `docs(backlog)` commit that follows every merge could evict the merge's own run. Each push now runs
  in a group of its own, and — since two `main` runs can now overlap and a registry tag is
  last-write-wins — the publish job asks `scripts/main-tag-guard.sh` before moving `:main`. **What is
  still open:**
  - **The publish path has now executed this code, once, and worked** (2026-09-16). #385's merge
    (`6e4c3af3`) was the first code merge after #384 landed: run 35109454675's publish job took the
    registry read and the comparison in 1.3s, answered `move`, published
    `ghcr.io/clintongormley/waitron:sha-6e4c3af,…:main`, and the live `:main` reads back
    `WAITRON_BUILD_ID=6e4c3af3…`. So the wiring is proven for the `move` answer. **What no run has
    exercised yet is `hold`** — an older run publishing after a newer one — which needs two merges
    close enough together to overlap and is not worth forcing; the script's own `hold` path was run
    against the live registry before landing (PR #384's comment has the output).
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
- **A seventh incident, with a cause rather than a hypothesis — FIXED on #469 (2026-09-20).**
  `test-light-b` timed out in `packages/catalogue/src/extras.concurrency.test.ts` (named
  `extras.pg.test.ts` at the time) because the suite's `until` helper polled with a 5s bound inside
  a 30s test timeout; the sibling
  `packages/catalogue/src/product-modifiers.concurrency.test.ts` had already raised the same bound to 15s and
  this twin was left behind. Raised to match; it reproduced on no local run, so the fix rests on the
  identified mechanism and the sibling's receipt, not on a reproduction.
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
  prior test in the same shared browser page — CONFIRMED and FIXED the same day in #350 (2026-09-13).**
  axe captured a `wt-button` mid-hover (foreground `#fefefe`, background `#3f83ed`) because the cursor
  belonged to the shared PAGE and outlived the test that moved it; `test-helpers.ts` now parks the
  cursor off-page before every test via a `parkPointer` command (guard
  `apps/dashboard/src/widgets/pointer-reset.test.ts`). **Two pieces are still open.** The
  `dashboard-app.a11y.test.ts` heading-order sighting is a different rule with no colour evidence, so
  nothing here explains it — treat it as still unexplained. And `packages/ui` and `apps/till` have the
  same harness with no reset, with `packages/ui/src/components/wt-button.test.ts` ending a test
  hovering a button, so the same flake is waiting there.
- **A sixth: a CI shard exits 1 with every one of its tests passing (2026-09-18, PR #414,
  `test-server (3)`, job 105632564989) — the exit-1 path CLOSED by the Vitest 4.1.11 upgrade
  (#437), measured 2026-09-25 and the trap deleted from `CLAUDE.md` §2 by #626; why the call went unanswered still open.** The shard printed
  `Tests 1313 passed (1313)` and one unhandled error: vitest's worker-to-main reporting call
  (`onTaskUpdate`) had timed out on birpc's 60-second default under vitest 3.2.7, failing the shard
  on its own and taking the aggregate `ci` job with it. **On Vitest 4.1.11 that timeout is gone,
  measured 2026-09-25**: a reporter withholding its answer for 75 seconds left the run waiting and
  passing, while the same probe failed at 60 seconds on 3.2.7 and on a 4.1.11 copy edited back to a
  60-second timeout. **What is still unexplained is why one worker's `onTaskUpdate` went
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
  The `ENABLE ALWAYS` immutability trigger ten of those tables carried is gone with
  PostgreSQL; the refusal is installed at runtime from the `ledger` classification instead
  (`packages/store/src/append-only.ts`), so a newly classified ledger table is protected
  without a migration remembering to do it.

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

  **Two things about it are worth carrying.** First, this entry's own description of the job was stale
  in both directions when T2 picked it up: the GRANT and grant-matrix clauses it told the next reader
  to fix had already been deleted by #490, so a literal reading found nothing; and it sized the job at
  "around a dozen suites" when the sweep ran to roughly a hundred files across `apps/server` and every
  package. Second, the sweep's value was not the framing — it was the five or six comments that
  turned out to be false claims in the present tense, each found only because someone was reading the
  line anyway. The best of them: a comment asserting that a `useVenueDb` database carries no
  append-only trigger unless the suite installs one (it installs them itself, and the suite's own
  statements are `create trigger if not exists`, so both answers look alike until you no-op the loop
  AND empty the declared list); and two comments claiming PostgreSQL folds a UUID's spelling on cast,
  where the folding is application code.

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

- **Two fiscal-package comments that need a probe, not a reword — DONE by #562 (2026-09-24).**
  #562 deleted the stale "out of scope" and shared-database prose from `chain.test.ts` and
  `drain.test.ts` (`useVenueDb`'s `resetPerTest` defaults to true,
  `packages/db/src/testing/venue-db.ts`) and the `VerifactuBackend.drain` description; a grep of
  `write-path.e2e.test.ts` for the reseed wording finds none. The original entry follows.
  `packages/fiscal-verifactu/src/chain.test.ts`'s header says a previous test's committed rows are
  simply out of scope rather than something to clean up, and that nothing there could truncate
  `registros_facturacion` anyway because the append-only trigger blocks it. Both look stale against
  `packages/db/src/testing/venue-db.ts`, where `resetPerTest` DEFAULTS to true and the reset drops
  every trigger, deletes every migrated table and recreates the triggers — but discriminating the two
  readings needs a run, which T2 did not do. (T2's own summary called its fiscal diff comments-only.
  That was wrong, and the run-it review seat caught it: the package also changes executable code, in
  `drain.ts` and in its manifest. Do not trust a list of the pieces — take it from the diff, with
  `git diff <base> -- packages/fiscal-verifactu/ | grep -E "^[+-]" | grep -vE "^[+-]\s*(\*|//|/\*)"`.
  What T2 did in `drain.ts` was take out a call to a row-locking helper in `@waitron/db` and put a
  plain `select` in its place; the helper had already been reduced to exactly that select, so the
  statement the drainer sends is unchanged. Nothing there touches what `RUNNER.md` H2 protects, and
  that was checked rather than assumed — listing every write statement in the file with
  `grep -nEo "(insert into|update|delete from) +[a-z_]+" packages/fiscal-verifactu/src/drain.ts`,
  none of them names `registros_facturacion`, which appears only in joins, one subquery and prose,
  so the drainer computes no huella, allocates no invoice number and writes no chain.) The same
  reseed prose survives in `drain.test.ts` and `write-path.e2e.test.ts`. Separately,
  `drain.test.ts` describes a `VerifactuBackend.drain` method; the class has no such method, and the
  drain pass reaches it through the fiscal slot. **Next action:** one probe for the reset question,
  then correct all three headers together.

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
  — CLOSED 2026-09-19: `apps/server/src/replication-arc.e2e.test.ts` was deleted with the PostgreSQL
  failover machinery, so this cannot recur in that file. The deletion changes nothing about vitest
  itself — `projects` and `--shard` are as incompatible as they were.
- **Job-sharding levers:** `--shard` splits by FILE COUNT; bump `shard: [1..N]` and the denominator
  together with N at or below the file count; rebalance `LIGHT_A/B_PACKAGES` when one light shard
  dominates. (`mutation-verifactu` used to be named here as the next critical-path candidate; that
  job was removed when `@waitron/verifactu` was extracted to its own repository.)
- **Dependency loop removed — LANDED #348 (2026-09-13).** `pnpm install` no longer warns about cyclic
  workspace dependencies; `scripts/workspace-cycles.test.ts` fails if a loop returns. One review point
  remains:
  - The loop guard reports the whole group of packages in a loop, not a path through it, so a failure
    does not say which link to cut. Optional: print one cycle path alongside the group.
- **A hung real-PG suite leaks its cluster containers** and `pnpm reap` only removes labelled ones
  older than two hours — inspect creation times and ownership, remove only your own.
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
(2026-09-25, PR #641; found by the retroactive Codex review of #621, whose
comment fixes landed as #632).** The park, cash-sale, card-sale and place handlers in
`apps/till/src/till-app.ts` now hand the list refresh behind a successful write to
`#refreshAfterWrite`, so its failure never reaches the write's own error (`held.park_error`,
`sale.unconfirmed`, `place.error`). It shows what succeeded, that the list could not refresh, a
countdown and a Try now button, and retries after 5 s, 10 s, then every 30 s until the newest
refresh of that list succeeds, the operator signs out, or the till re-boots. The owner's request of
2026-09-25 also said "or leaves the screen"; the retry deliberately keeps running when the operator
moves between tabs, because the held list and the kitchen queue are shown on the counter the
operator comes back to. Every refresh of the held list and the kitchen queue now carries a request
number, and only the newest answer for a list may show its rows or start, change or clear its
retry, so a refresh answering after a sign-out, a re-boot or a newer refresh neither shows its rows
nor touches the retry. That holds for the older callers too (login, retrieve, discard, station
advance and collect, and a zone change; a switch to a prepay zone now empties the queue the same
way), which before installed whatever answer arrived last.
The card-sale path (`#onCollectCard`) had the same shape and is included. Tests: the "a failed list
refresh after a successful write" block in `apps/till/src/till-app.test.ts`, and its a11y case
in `till-app.a11y.test.ts`. The listStaff test title that #632 recorded as too wide now says "on
the first login".

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
  #610 removed the stale comments on the two methods. Left in place because lane B's variants plan
  (`docs/superpowers/plans/2026-09-23-variants-as-products.md`) will change that file.
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
change (owner decision 2026-09-23; found 2026-09-23, till coverage, PR #536).** The till coverage branch
fixed the case where a late answer reopened a logged-out till (it now stays on the lock screen).
The same late answer can also arrive after a DIFFERENT operator has logged in: `#showTicket` and `#onOpenTable` in
`apps/till/src/till-app.ts` then push the previous operator's ticket or table over the new session.
Reproduced 2026-09-23 in the till coverage branch's review on a till, with the sale and the
table-open answers held back across a logout and a second operator's login: both appeared over the
new session. The owner's answer: the ticket belongs to the TILL, not to the operator who started
it, so a late result shown on that device after a change of operator is right — on a handheld passed
from one waiter to another too. The case is unlikely, because whoever takes a payment is usually
standing there waiting for it. What matters is that no payment is lost, and none is: the payment
belongs to the table, so the next operator opens the table and sees what is paid and what remains.
The fix in #536 (a logged-out till stays locked) stands.

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
(found 2026-09-21, task F1; fixed 2026-09-23 by PR #493).** The flip opened ONE connection per database file,
following its own plan rather than the slice-1 spec's §3.3 "small set of connections for reading",
so a read issued while the write lock held a transaction open ran on the writer's own connection and
returned that transaction's rows — including a row a rollback then removed. A second connection to
the same file, which is what node-postgres's pool used to hand a reader, returned committed rows
only, so this was a behaviour change rather than something SQLite forces.

`packages/store` now opens two connections per file: the single writer, and a reader opened
`readOnly: true` beside it. A statement goes to the reader only while one of the store's own
transaction bodies is running and the caller's asynchronous context is outside it; everywhere else
the writer is used, so migrations, archives and writes outside a transaction are unchanged. The rule
is in `packages/store/src/connections.ts`, its measurements in `docs/developers/conventions-data.md`
(since #568 pruned them from the source), and the cases in
`packages/store/src/index.test.ts` pin it — though not every one of them does: with the routing
replaced by `return write;` the case `serves a read routed to the reader on a file with no tables in
it` still passes, so it is a smoke test rather than a control, and it says so at its own site.

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

Two things the review wave found by RUNNING, both fixed on the same branch rather than recorded: the
window used to close when a transaction's BODY settled rather than when the transaction finished, so
a handler registered on the body's own promise read the writer's still-uncommitted rows; and the
asynchronous context used to carry a plain "inside a body" mark, which never expires, so a callback
detached inside one transaction and settling during a LATER one was read as being inside that later
one and saw its uncommitted rows.

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

**`sale_voids` has no index on `voided_at` — OPEN (found 2026-09-24 by #605).**
Besides its primary key's, its only index is the unique one on `sale_id`
(`packages/db/src/schema/sale-voids.ts`). Four reads select voids by `voided_at` range: the void
count in `packages/reporting/src/counts.ts` and, since #605, the reversal half of the daily
VAT summary, the period VAT summary and top sellers.
An `EXPLAIN QUERY PLAN` of the count's shape on node v26.7.0, over empty stand-in `sales` and
`sale_voids` tables carrying only these keys, printed `SCAN s` then a `sale_id` lookup per sale;
with an index on `voided_at` added it printed a range search on that index. The real schema and
real row counts were not measured. Adding the index needs a migration, which #605 was
specified without. **Next action:** add the index and re-read the plan on the real schema.

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

**The verifactu extraction's compliance-doc references — DONE (2026-09-21).** The compliance
provenance doc now reads `@waitron/verifactu` and notes the extraction. The library's own
follow-ups now live in the verifactu repo's own backlog (`docs/backlog.md` there), not here — the
differential-test spike against `inoguerols/verifactu`, a convenience facade, a documented
QR-image recipe, and porting NIF/NIE/CIF check-digit validation into `validate()`. They were
deferred by the extraction spec §2.8–2.11
(`docs/superpowers/specs/2026-09-21-verifactu-extraction-design.md`).

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

**A blank amount posted at the purchase-invoice routes was stored as a zero — FIXED #485
(2026-09-21).** Every amount on both the POST and the PATCH — the header's `total` and
`deductibleProportion`, and each line's `rate`/`base`/`tax` — now goes through `decimal()`, and
`shared.invalid_decimal` is a 400 in the route's `STATUS` map. The same pass confirmed the
catalogue write routes never had this hole: their boundary screens are typeof-only too, but the
ops behind them refuse a malformed literal.

**A negative gross total is accepted and stored on the purchase-invoice routes — NOT A DEFECT, the
behaviour is intended (owner ruling 2026-09-21; found 2026-09-21, task N1).** A negative gross total
is a supplier credit note — a corrective adjustment for a return, a cancellation, an overpayment, a
retroactive rebate or goods that arrived damaged or never arrived — so accepting and storing one is
correct and there is no `negative_total` refusal to add. Whether a credit note should eventually be
its own document type rather than a negative-total purchase invoice is a separate design question
and is not queued. The measurement that raised it is kept below, because it is the receipt for what
the routes do today. Measured through the real route in `apps/server`'s PGlite harness: a POST to
`/management-api/purchase-invoices` carrying `total: "-121.00"` answered **201**, and the list
route read the row back with `total` `-121.00`. `validateProportion` and `validateLines` in
`packages/purchasing/src/operations.ts` check the deductible proportion 0–100 and, per line, base ≥
0, tax ≥ 0 and rate 0–100 — neither looks at the header `total` — and
`packages/db/src/schema/purchase-invoices.ts` carries check constraints for `deductible_proportion`
and the line `rate` and none for `total`. The dashboard form's `inRange(this.total, 0, Infinity)`
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

**Left behind by raising the `packages/ui` mutation score (#466, 2026-09-20).** Three edges the
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
- **`packages/media` and `packages/venue-service` register `parkPointerCommands` and never call
  `commands.parkPointer()`.** So the pointer reset that `apps/dashboard`, `apps/till` and
  `packages/ui`'s a11y suites use is available in both and wired to nothing — the latent
  hover-leaks-into-the-next-test failure `docs/developers/testing-guide.md` documents applies to them
  untouched. Either add the `beforeEach` to each package's shared test helper or drop the
  registration.

**Left behind by the Stryker upgrade (#447, 2026-09-19).** One open follow-up remains.

- **A Vitest 5 retry has to re-measure mutation — nothing about Stryker 10 settles it.** Vitest 5 was
  abandoned because Stryker 9.6.1 kills almost nothing under it: `packages/fiscal` scored 0.00% and
  `packages/shared` 8.14% (stryker-js#6210; fix PR #6214 was open and unreleased). Stryker 10.0.0's
  release notes mention neither issue, and nothing here was run under Vitest 5, so the question is
  untouched rather than resolved. The dated note at the top of
  `docs/superpowers/plans/2026-09-18-vitest-5-upgrade.md` says the same thing beside the plan it
  qualifies; this is the backlog's pointer to it.

**Left behind by the dependency refresh (#432, 2026-09-19).** Nineteen dependencies moved to their
latest minor or patch release; two loose ends came with it.

- **Five manifests had their declared floor raised, and nobody has said whether that is the house
  style.** `hono` was declared `^4.6.0` and `^4.7.0`, `pg` `^8.13.0`, `playwright` `^1.49.0`,
  `@types/pg` `^8.11.0` and `@aws-sdk/client-s3` `^3.700.0`, in each case well below what was
  installed, while their siblings in the same files were declared at the installed version. #432
  raised them so that every package declares one identical range, which is now the shape of all
  nineteen. No commit or doc explains why those floors were low, so this was a judgement, not a
  rule being followed. If low floors were deliberate, the revert is one line per manifest.
- **Half of one `pg` receipt was not re-established at 8.23.0.** Four comments — in
  `packages/provisioning` (`README.md`, `src/cli.ts`, `src/errors.ts`, `src/cli.test.ts`) — record a
  measurement taken inside a `postgres:18-alpine` container, where a connection string of
  `/var/run/postgresql` connected over the cluster's Unix socket. The parsing half was re-run on
  8.23.0 and is unchanged; the container was not started, so those four still name `pg@8.22.0` and
  say only that it is the version the measurement was taken on. Re-running it needs the container,
  because the socket cannot be bind-mounted out of Docker Desktop's VM on macOS (`CLAUDE.md` §4).

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
`@types/node` `^24.0.0` to `^26.0.0`, matching the Node 26 the `.nvmrc` pins, and
`packages/tunnel` — which imports `node:net` in six files and declared no Node types at all — got a
declaration of its own. Two things it leaves open:

- **`apps/dashboard` now type-checks against two `@types/node` majors at once.** `@types/qrcode` is
  a declared devDependency there and in `apps/server`; its `index.d.ts` opens with a reference to
  the Node types, its own range is `"*"`, and the lockfile leaves it on **24.13.3** while everything
  else moved to 26.6.2. Measured with `tsc --noEmit --explainFiles` in `apps/dashboard`: 141 file
  mentions of 24.13.3 beside 384 of 26.6.2, where the same command on the pre-merge `main` showed
  350 of 24.13.3 alone. Nothing complains because `skipLibCheck` is on (`tsconfig.base.json:15`);
  with `--skipLibCheck false` that program reports a duplicate `NonSharedBuffer` identifier. **Both
  numbers were taken on TypeScript 5.9.3 and both were re-run on 7.0.2 on 2026-09-20**, which is the
  compiler `apps/dashboard` uses now: the counts moved to 146 and 542, and `--skipLibCheck false`
  still names `NonSharedBuffer` at `buffer.buffer.d.ts(459,14)` in both copies. The problem is
  unchanged; only the file counts are.
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
- **A sentence attributed to `CLAUDE.md` §3 that is not in it survives in one historical doc.**
  `spa-api.ts` quoted "the defence is explicit, never implicit" as a rule from §3; it is not there
  (`grep -c` in `CLAUDE.md` returns 0) and the branch removed the quotation. The same phrase is in
  `docs/superpowers/specs/2026-08-08-catalogue-management-ui-design.md`, which records what was
  believed when it was written and is left alone. Worth knowing for the next sweep: it is wrapped
  across two lines there, so a one-line `git grep` misses it.

**Left behind by the vite 8 upgrade (#450, 2026-09-19).** `apps/dashboard`, `apps/setup`, `apps/till` and
`packages/ui` moved from vite `^6.0.0` to `^8.0.0` (installed 8.3.0). Vite 8 swaps the bundler and
the transformer: Rolldown and Oxc in place of Rollup and esbuild. What replaced the byte-comparison
method above, since a bundler replacement makes it meaningless: build both, then run the SHIPPED
bundles and compare what they produce. Concretely — `till-ticket-view` was instantiated out of each
production bundle in real Chromium with the fixture from
`apps/till/src/screens/till-ticket-view.test.ts`, and the Veri*Factu QR SVG came out identical at
28231 bytes with the receipt text matching character for character; and `manifest.webmanifest`,
emitted by the only custom Rollup-hook surface in the repo (`webManifest()` in
`apps/till/vite.config.ts`, `generateBundle` + `this.emitFile`), came out identical at 434 bytes.
(2026-09-20: that QR byte count was measured on qrcode-generator 1.5.2. The till has since moved to
2.0.4, which draws identical bytes — see the entry below — so the number still holds.)
Five things it leaves open:

- **A pull request that changes only front-end code gets no SPA bundle built anywhere in CI.**
  `bundle-smoke` builds `@waitron/credentials` and `@waitron/server`, which are esbuild bundles. The
  only thing that runs `vite build` is `deploy/Dockerfile`, which the `image` job runs — and on a
  pull request `image` is gated on `deploy/` having changed (`.github/workflows/ci.yml`, the `image`
  job's `if`). So `image` DOES build the SPAs on a pull request that touches `deploy/`, and on every
  main push; what it never does is OPEN one, so a bundle that builds and renders nothing passes
  there too. `docs/superpowers/plans/2026-08-27-onboarding-slice2c-setup-wizard.md` (R6) recorded
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
- **The four manifests declare `^8.0.0` while the lockfile installs 8.3.0**, which is the same
  low-floor shape they carried at `^6.0.0`. Whether low floors are house style is the open question
  the dependency refresh left above (#432 raised five of them to the installed version); this bump
  deliberately did not answer it, because changing the shape is the owner's call and not a version
  bump's. Decide it once, for all of them.
- **Only four packages declare vite; the other five browser-mode packages follow by deduplication,
  not by a declaration.** `packages/bookings`, `packages/media`, `packages/payments-stripe`,
  `packages/payments-sumup` and `packages/venue-service` run tests in a browser but never invoke the
  `vite` binary, so they correctly declare no vite. They moved to 8.3.0 because vitest declares vite
  as a REQUIRED peer spanning three majors (`^6.0.0 || ^7.0.0 || ^8.0.0`, and absent from
  `peerDependenciesMeta`), the four bumped manifests are the only thing choosing a vite in the tree,
  and pnpm deduped onto it. Nothing pins the five. If a future change ever puts a second vite in the
  tree, they could land on a different one silently.
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
moved from `^1.4.4` (installed 1.5.2) to `^2.0.4`. Two majors of version number, but the drawing
code did not change: diffing the two published CommonJS builds gives one hunk, a canvas `fillRect`
in `renderTo2dContext` whose row and column arguments were the wrong way round, and
`apps/till/src/qr.ts` calls `createSvgTag` and never reaches it. What version 2 adds is an
`exports` map and an ESM build of the same code. Nine payload classes rendered through all three
builds — version 1, version 2's CommonJS, version 2's ESM — gave byte-identical SVG for every one,
with two controls (error-correction level M against L, cell size 4 against 5) confirming the
comparison could see a difference. Three things it leaves open:

- **The byte-count receipt in the vite 8 entry above crosses this major.** That entry records the
  Veri*Factu QR SVG coming out of both production bundles "identical at 28231 bytes", measured on
  qrcode-generator 1.5.2. The number still holds only because the drawn bytes did not move, which
  this upgrade establishes and that entry has no way to state. Read the two together.
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
   only to stamp the amendment's till and node; `readLockedLines` takes no `cfg` at all, and neither
   does its one caller `priceStoredOrder`, which is reached from five sites in `till-sale.ts` and one
   inside `working-order.ts` itself. Named by function rather than by line, because the line numbers
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
  `action.disable`. Branch 2 of the one-product model settles products on **Active / Inactive**
  (spec §15.6), kept separate from **Available** (sold out for now). **Next action:** pick the one
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
- **An imported configuration no longer carries "already offered a passkey"** (fixed 2026-09-14). A
  configuration transfer strips `passkey_offered_at` on export and refuses a bundle that still
  carries it, alongside the other person columns the transfer already leaves behind.
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

- **Status, alarms and the operator surface for replication.** The PostgreSQL version of this — numbers
  and alarms off `pg_stat_subscription` / `pg_replication_slots.wal_status`, the SKIP runbook, the
  post-drain disable route, orphaned-slot reclamation — went with the machinery. The REQUIREMENT
  stands: an operator needs to see whether the standby is keeping up, and to be alarmed when it is not.
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
  browser receipt still owed from till-reroute Task 10 (needs interactive Chrome + mkcert +
  `/etc/hosts`).
- **Richer daily close** — one close run by the primary across all tills.
- The residuals under *Detail → Replication*: re-admission, the unbounded membership chart, chart
  hygiene, the resume-at-restore marker, power-loss durability and the selling gate, restore-onto-cloud
  re-encrypt, mirror fidelity, split-brain on the promoted side, the till UX for a timed-out card.

**A stale worktree:** `feat/h2-fiscal-record-sync` (spec and plan dated 2026-09-04, uncommitted
changes in `packages/sync`) was designed on the application outbox that #280 deleted, and the
replication it was rewritten against went too (2026-09-19); the `ledger` classification of the fiscal
tables survives both. Superseded twice over — remove it once the owner confirms nothing in its
uncommitted diff is wanted.

### Cloud integration and SQLite work

**Shared account controls (2026-09-23):** `@waitron/ui-core` now owns the seven account
controls, tokens and common helpers inside this repository. Existing `@waitron/ui`
imports re-export the same implementations. The standalone tarball fixture checks
browser behaviour, accessibility and declarations without workspace source aliases;
CI covers both packages and the weekly mutation matrix retains both. See the
[extraction design](superpowers/specs/2026-09-23-shared-ui-extraction-design.md).
Cloud has published private `@waitron-io/ui-core@0.1.0` from Waitron commit
`0a93f4d3557b669661ac8f589aad866e2cd9653f`; its installed-package Chromium and
declaration checks pass locally. See the [release receipt and setup](https://github.com/waitron-io/waitron-cloud/blob/main/docs/shared-ui-release.md).
Cloud owns the release workflow and account screens. Its English/Spanish account portal
is implemented, and the connection screens now use its real account and pairing APIs
(see Cloud connection integration above).
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
[SQLite instead of PostgreSQL](superpowers/specs/2026-09-16-sqlite-instead-of-postgres-discussion.md)
(the regulation names no database privilege; Litestream covers standby and rejoin but not a returned
box's ledger tail) and the architecture in
[SQLite + Litestream topologies](superpowers/specs/2026-09-16-sqlite-litestream-topology-design.md),
whose §11 is the build order and whose §12.2 is the one gate still standing — a throwaway
failover-loop prototype.

**That prototype gate is DONE — all ten tasks landed (#392, #395, #406, #411, #415, #417, #422,
#425), and slice 1, the storage swap, is COMPLETE as of 2026-09-23**
([spec](superpowers/specs/2026-09-16-sqlite-slice1-storage-swap-design.md),
[plan](superpowers/plans/2026-09-16-sqlite-slice1-storage-swap.md)). Read the gate's own product,
[the results note](research/2026-09-16-sqlite-failover-prototype.md), rather than re-deriving any of
it: the failover loop holds everywhere except **S2**, the recorded negative result — a handed-over
batch can re-file a sale the receiver already filed, which costs one wasted AEAT call (error 3000,
already read as filed) rather than a record filed twice. The fence-before-ship rule that produced is
now in topology design §5.2. The tag `pre-sqlite-migration` (`c9d80c59`) marks the last commit before
any of this code, so you can still read how something worked under PostgreSQL.

**What the gate left open (index; the receipts are in the results note):**

- **Validate every supported object store.** Cloud owns its production-provider checks in the
  [Cloud backlog](https://github.com/waitron-io/waitron-cloud/blob/main/docs/backlog.md);
  Waitron retains the engine's required semantics and checks for claimed self-host targets.
  Every store result in the prototype note is MinIO's. Topology §12.2's real-store gate remains
  open; the conditional-write promotion tie-break must be demonstrated on each target (risk 11).
- **The restart reset is built (2026-09-23), and so is its precondition (#566).** `resetInFlightClaims`
  (`packages/fiscal-verifactu/src/drain.ts`) returns every `enviando` row to `pendiente`, raising
  `incidencia`, and `resetBeforeFirstDrain` (`apps/server/src/restart-reset.ts`) runs it before a
  boot's first filing pass, and again only if that attempt failed — so a node that restarts files
  an inherited "being filed right now" sale on its first pass once the reset succeeds, with no
  five-minute wait; a failed reset is retried no later than `WAITRON_SKIP_RETRY_MS` after it failed.
  It runs only where the drain does: on the singleton primary, with submission
  switched on. It assumes ONE server process per venue folder — a second process filing from the
  same database would have its claims undone — and slice 2's Task 3a (#566) now refuses a second
  process `provisioning.database_in_use`; see the slice-2 entry below.
- **`apps/server/src/restore-fiscal-e2e.test.ts`'s header gives a reason that no longer holds — DONE
  (2026-09-24, #589 deleted the claim and its line pointers; found by review of PR #520).** It says `useVenueDb` is not used because it "never
  reaches the trigger installer". Traced, not run: `useVenueDb` applies each set through
  `applyMigrationSet` (`packages/db/src/testing/venue-db.ts:227`), which calls
  `installAppendOnlyTriggers` (`:117`). The header also cites `venue-db.ts:169` and
  `migrate.ts:37-40`. Whether the suite still has another reason to migrate through the product's own
  `applyMigrations` is the open question; restate that reason, or delete the claim.
- **A suite header in `apps/server` says its suite is RED, and it passes — DONE (2026-09-25, #629
  deleted the paragraph).** `apps/server/src/awaiting-fiscal-cert.test.ts` ("This suite is RED") —
  run 2026-09-23, 1 of 1 passed. (#624 deleted `boot.promote.test.ts`'s matching "One case below is
  RED".)
- **Bounding the offline write-ahead log is an open design question, and the lever risk 9 names is not
  one.** Measured: while a litestream daemon is attached AND cannot reach its store, the log's space
  cannot be reclaimed at all — `PRAGMA wal_checkpoint(TRUNCATE)` blocks for seconds and shrinks
  nothing, and dropping `wal_autocheckpoint = 0` changes nothing either. So whatever bounds that log
  has to stop or detach the daemon, and doing that on the sale path is what risk 9 forbids.
  2026-09-23: slice 2 measured that a restarted Litestream uploads the sales made while it was
  stopped, and drove an offline side file past Litestream's documented emergency-checkpoint threshold
  for a few seconds (it did not shrink; what the checkpoint does over longer was not measured) —
  [results note, Slice 2 measurements](research/2026-09-16-sqlite-failover-prototype.md#slice-2-measurements).
- **The promoted generation and store pointer remain unproven.** The prototype does not stream a
  promoted node's generation or restore by following `current.json`. The guided Cloud snapshot path
  does not close continuous recovery. Its orchestration is tracked in the
  [Cloud backlog](https://github.com/waitron-io/waitron-cloud/blob/main/docs/backlog.md); Waitron retains
  the engine behaviour and integration proof.
- **250 sales a day is still an assumption** nothing in this repository measures, so the days-per-GiB
  figure rescales but does not hold.
- **Three scenarios have no mutation receipts (S1, S6, `smoke`), two branches of the litestream
  wrapper are driven by no scenario, and the runner's own `main()` is undriven** — a later task should
  pin them or delete them.

**SQLite slice 2 — in progress** ([spec](superpowers/specs/2026-09-23-sqlite-slice2-stream-and-cold-restore-design.md),
[plan](superpowers/plans/2026-09-23-sqlite-slice2-stream-and-cold-restore.md)): the venue streams
its database to a bucket the owner supplies, and a dead box is rebuilt from it. Landed so far:
Task 3b, the restart reset (#513); Task 4, the five measurements Litestream's behaviour decides
(#540) — the values later tasks read are under "What later
tasks read" in [the results note](research/2026-09-16-sqlite-failover-prototype.md#slice-2-measurements).
Task 0, shrink every uploaded photo, landed as #543; what it does and what it leaves
open are under the image library in Track A.
Task 1a, each machine's own rows keyed by its node id (a new `node_roles` table takes a node's mode,
singleton role and break-glass verifier off `deployment`; `mirror_config` and `join_requests` gain
`node_id`), landed as #548. A dev venue
holding `mirror_config` or `join_requests` rows fails its migration; `wa-wt reset demo <name>`
rebuilds it. Left by #548: deny's delete is the one join-request node filter no test fails
without (the `requirePending` read before it already refuses another node's row, as its doc
comment says); identity's comments that still place its tables in different files are Task 1b's
to rewrite (done by #554, bar one in `authorize.test.ts` that #559 removed); and the run-it review did not reach three claims within its
budget — holders torn by a concurrent promotion, credential sealing, and scheduler takeover.
Task 1b, session cookies stored only as hashes (the till's and the dashboard's cookie carry a
random token, and `sessions` and `management_sessions` keep only its SHA-256 in a new `token_hash`
column; identity's logins and sign-in ceremonies are reclassified `state`), landed as #554. Every seeded dev venue holds a session row
(provisioning's `seed-device-profiles` step opens a management session and never ends it,
`packages/provisioning/src/venue-apply.ts`), so each fails its migration until
`wa-wt reset demo <name>` rebuilds it, and every existing login signs in again.
Left by #554's review, not fixed there (items 1 and 2): (1) with the cookie now hashed, nothing
fails when the UUID shape screens in `requireSession` and the till logout route are deleted —
measured 2026-09-24, the three malformed-cookie cases in `apps/server/src/till-api.test.ts` still
pass, because a non-UUID value hashes to no row; the screens now only save a lookup. (2) Test
titles still promising "not a 500" from PostgreSQL's `22P02` remain in
`till-api.courses.test.ts`, `till-api.receipt.test.ts` and `till-api.reprint.test.ts` (#613
removed the comments). (3) Fixed
by #554: the mirror viewer's ambient `admin` session (`apps/server/src/mirror-session.ts`)
used its fixed, public row id as its cookie, so a copy of the database, or a node served without
the mirror's middleware, accepted that public value as an admin login. Its cookie is now a random
token, minted afresh each time the viewer is seeded and stored only as a hash, and every trading
boot whose mode is not `mirror` ends the viewer's session (`endMirrorViewer`), so a browser that
kept the cookie is refused after a promoted mirror restarts or a mirror's database is booted as a
primary; a later mirror boot revives it. `apps/server/src/mirror-session.test.ts` has a gated route
without the middleware refusing the row id, and `apps/server/src/boot.mirror.test.ts` a primary boot
refusing a kept cookie.
Also left open: now that both ends are `state`, the keys #426 dropped could be declared again —
`sessions` to `persons` and `tills`, and `management_sessions`, `totp_enrollments` and
`google_oidc_states` to `persons` (`sessions` and `management_sessions` are rebuilt by
`packages/identity/drizzle/0003_session_token_hash_required.sql` anyway). Doing so would change
what deleting a person does.
Task 2a, a recovery key that does not need an archive destination (`loadRecoveryKey` reads the
key alone, `writeRecoveryKey` sets it in `backup.env` keeping the other settings, `rotate` changes
the key of a box that holds a key and has no destination loaded, and `apply` reuses a key the box already holds,
refusing a different one with `backup.recovery_key_exists`; every status answer carries
`recoveryKeySet`; apply and rotate take turns, so a concurrent pair cannot put the old key
back), landed as #557. Until Task 8b the Backups screen's setup form
(`apps/dashboard/src/screens/backup-screen.ts`, shown on a writable box whose backups are not
enabled) sent a freshly made key unless the operator pasted one, so on a box that holds a key while
backups are off — for instance one whose venue failed to open, which clears the running config while
`backup.env` keeps the key — the apply was refused with that code. Task 8b made the form read
`recoveryKeySet` and make and send no key when the screen's last status read says the box holds one. That does not rescue the
failed-venue box: an apply there that reuses the held key takes the path a pasted held key took
before — it writes, reloads, the venue fails to open again, and the route answers
`backup.effective_mismatch` (read from the route, not run, for Task 8b). The edit-settings form can also meet
`backup.recovery_key_exists`, when a rotate (from another tab or admin) lands after it fetched the
key. Left open: the
"key rotated" date `rotate` writes is dropped by a later `apply`, because `readApplyBody` always
passes `keyRotatedAt: undefined` — this predates Task 2a (a settings re-apply already dropped it),
and the value is what the Backups screen shows as the date the key was rotated.
Also left by #557's review, the owner's call: `rotate` with a destination loaded still rebuilds
`backup.env` from the running settings rather than keeping the file's other lines, so a
destination added to the file by hand and not yet loaded is dropped; keeping the file's lines
instead would change that behaviour.
Task 2b, the box's own state files locked with the recovery key in the venue database (a new
core table `node_sealed_state`, one row per node, `local`, kept off the dashboard's change feed;
`apps/server/src/sealed-state.ts` packs everything the archive carries except the database copy
and encrypts it exactly as the archive is; the backup sweep and the row build their entries through
`apps/server/src/archive-entries.ts`), landed as #560. The row is rewritten at every start, after
`backupSupervisor.reload()`, and straight after every `backup.env` write the backup routes make,
refused requests included. Left open by #560, both since decided by the owner: (1) a failed refresh
was only logged (`backup.sealed_state_failed`); Task 7 now raises it as a dashboard alert too;
(2) every node writes its own row at every start, standby and mirror nodes included, while the
backup job runs only on the primary — kept by design (owner, 2026-09-24). Nothing outside the backup routes
or the bucket-copy settings' Save (which writes a recovery key into `backup.env` when the box holds none)
rewrites a sealed file while the server keeps running (#560's per-task review traced each writer:
promotion rewrites `trading.env` and then restarts; `modules.json`, `secrets.env` and the TLS files
are written in setup or by the command line, before a restart, and Task 9a's first start rewrites
the TLS leaf during a start, before that start's refresh); Task 8a calls the one
`sealedState.refresh()` boot builds, and Task 9a calls none: boot's own refresh seals its new leaf.
Task 3a, one process per venue folder (opening a venue folder holds `venue.lock`, a SQLite
`begin immediate` the operating system releases when the process dies; a second process is refused
`provisioning.database_in_use`, while opens inside one process share it; restore and
`waitron-rejoin` take it before changing any file; break-glass, `waitron-credentials`, two dev
scripts and the Cloud backup fixture's capture open without it), landed as #566. The question it
left open was decided by the owner on 2026-09-24 and done in #573: a start the lock refused stopped
counting toward the recovery page (`apps/server/src/node-entry.ts` put the count back), and
the container's entrypoint now refuses any argument (`server.entry_arguments_refused`) instead of
booting a second server when `docker compose run app <command>` is given no `--entrypoint`. #573's
review left three findings, each reproduced by its Codex seat with a real second process. The owner
decided the first two on 2026-09-24, and #608 did them:
(1) a venue folder held by a STUCK process restart-looped the box and never reached the recovery
page. Every holder now keeps `venue.holder.json` beside `venue.lock` with a heartbeat. A refused
start counts, as `provisioning.database_holder_stalled`, when that heartbeat is 30 s old or more
or the file is missing, and the recovery page names the holder's kind. A holder whose main thread has not run
for 120 s is killed by its own watchdog thread, which first records the main thread's stack when it can read it (in a test it could not, while that thread
was inside one long synchronous database statement) ([conventions-data.md](developers/conventions-data.md), "One process per venue folder").
(2) `recovery.json` had no lock of its own, so a refused start could put back a count the running
server had cleared, or erase a failure another start recorded. Every change to it now holds
`recovery.lock`, and a clear count in the file stops a refused start's undo taking off a failure
another start counted after a clear. Still open from (2): the level is read before that lock, so the pre-boot count
another start writes can still push a server restarting at that moment onto the page (older than
#573). Still open, the owner's call: (3) only an unwrapped `provisioning.database_in_use` is
recognised — a wrapped one, or the store's raw `VenueInUseError`, would still count (no path wraps
them today). Left by #608, no behaviour change decided: the watchdog appends its line to
`waitron.log` without creating the log folder, so on a machine with no such folder that line is
lost (the JSON report and stderr still carry it; a box's `logs` volume always exists); the
recovery page has Spanish wording for the stalled-holder row only, every other row is English;
only a store's `close()` waits for the watchdog thread to end, not a bare `release()`. Also
left by #566's review, no behaviour change: the migrator's lock and
the venue lock use one technique in two copies, and the test helper that holds the lock from another
process is copied into several test files.
Task 5, the new package `@waitron/stream` (the S3 bucket client, the signed pointer
`current.json` naming the live generation, generation claiming and pruning, and `probeBucket`, the
check behind the settings screen's Test button), landed as #569. Task 6 makes the server call it at boot, through
`StreamHost`; Tasks 8a, 9b and 10 add the other callers. Where it departs from the plan's code is recorded in a dated note in the plan's
Task 5. #569's review left pruning sending one delete request per file; on the owner's call
(2026-09-24, landed as #594) the bucket interface now has a batch delete, and the S3
store sends S3's multi-object delete, 1000 keys a request, falling back to one request per file only
when the store answers the batch 501. Which real providers lack the multi-object delete, and what
each answers, is not established; a provider that refuses it with any other status fails the day's
prune, which is logged as `stream.prune_failed`. `probeBucket` (`packages/stream/src/probe.ts`),
which the supervisor runs before opening a generation, again while streaming (at most every ten
minutes after a failed bucket read or while a bucket problem is flagged, otherwise once a day), and
which the bucket-copy panel's Test and Save both run, deletes one object at a time, so neither can reveal such a provider. Open: having the bucket check
delete its test object through `deleteMany` would reveal one. The other
choice #569 left, one code for a listed file outside the folder asked for, is taken: the S3 store
now reports it as `backup.stream_name_invalid` with `field: "listedKey"`, the code and field
pruning's own check uses (owner, 2026-09-24; landed as #576). Its value is the key as the bucket
named it, so it is the first `backup.stream_*` parameter a bucket supplies: the screens that word
these codes (Tasks 7 and 8b) must not put it in front of anyone as trusted text. Also left: `@waitron/store` is missing from the
English-only guard's `GENERIC_PACKAGES` (`packages/db/src/english-only.ts`), so it is never scanned
— I believe this predates #569 (the package dates from #489); and nothing in the package has been
run against a real bucket — the unit tests drive the real S3 client over a scripted network, and
Task 10's loop test is the first run against a real S3-compatible server.
`apps/server/src/rejoin-command.test.ts`'s sidecar assertions do not test the wipe: its fixture
closes the handles first, which removes the sidecars, so with `db-wipe.ts`'s `SIDECARS` cut to
`[""]` it still passes 18 of 18 (the assertions predate #548: aabdde6a8, #489). The wipe's
sidecar removal is pinned by `apps/server/src/db-wipe.test.ts`; what is missing is only a
rejoin-level case with sidecars on disk.
Every synchronous `deriveKey` caller still blocks the event loop while it derives, among them:
`encodeConfigurationBundle` (`apps/server/src/configuration-transfer.ts`, through
`encryptArtifact`); everything reaching `decryptArtifact` (`apps/server/src/artifact-cipher.ts`) —
`decodeConfigurationBundle` (`apps/server/src/configuration-transfer.ts`, on the request path,
decoding an uploaded bundle), `apps/server/src/restore.ts:153` and `unsealNodeState`
(`apps/server/src/sealed-state.ts:33`); and the recovery bundle's `encryptBundle` and
`decryptBundle` (`apps/server/src/recovery-bundle.ts`). Task 2b moved the backup
sweep's encryption and `sealNodeState` to `encryptArtifactAsync`.
Task 6, the Litestream supervisor (`@waitron/stream`'s `StreamSupervisor`, the server's
`StreamHost` started at boot on the primary, the store's `checkpointTruncate`, Litestream 0.5.17
pinned in the box image and in `pnpm setup:litestream`), LANDED as #590 on 2026-09-24. The owner decided on 2026-09-24 that the same generation
continues after a pause, after measurement 1 was repeated at the 256 MiB side-file limit (results
note §1b: the restore after the restart held every sale, and Litestream uploaded a full copy of the
database at level 0). Left for later tasks: `/health` must treat the supervisor's
`supervisor_failed` stop as a problem, not as streaming switched off (done by Task 7); the settings route
must reload the stream only after its save commits, and refuse a bucket name holding capitals or
`_` (both done by Task 8a; the screen's wording by Task 8b). Left open by #590's review, the owner's call (the PR description has the
detail): (1) no S3 call has a request timeout, so a pointer write that never gets an answer holds up the
supervisor's retry until the server stops or reloads — Litestream stays stopped meanwhile, so the side
file is not at risk; (2) `StreamHost.reload()` can leave the old supervisor's pointer write in flight,
landing after the new supervisor read the pointer, so the box takes its own write for another box's
and refuses itself — closed on Task 8a's branch: a supervisor retries its pointer write when the
refusal was caused by one of this process's own earlier pointers, matched byte for byte, the last 16
kept. Still open: a pointer write from a process that has since died, landing after the restart,
can still make the box refuse itself, because a restarted process starts with an empty record, and
so does a `current.json` deleted after the supervisor read it, on a bucket that answers a conditional
write to a missing object with 412 (SeaweedFS; the in-memory test store); in both cases the owner's alert
(`backup.stream_refused` in `apps/dashboard/src/i18n/alert-messages.ts`) still says another box is writing. On a bucket that answers that write with 404 instead (AWS, as it
documents; versitygw, as measured — the plan's Task 10 notes), the deleted pointer surfaces as
`backup.stream_request_failed` and `#movePointer` (`packages/stream/src/supervisor.ts`) logs
`stream.pointer_write_failed` and retries every `OPEN_RETRY_MS` until the supervisor stops, never
reaching `refused`;
(3) `StreamHost` streams on any node whose role is primary, while the Cloud snapshot worker also
requires that the node has not been cut off from acting as primary (`cloudPrimary`) — should a
cut-off primary stream?; (4) the server's 8-second shutdown stops the stream last, after the Cloud
snapshot loop, so on a large database Litestream may not finish its last upload (it is still told to
stop and does not outlive the server). Item (5), the notices of the libraries the binary bundles, is
DONE by #599: they ship in `/app/third-party/litestream/NOTICES.txt`, generated by
`scripts/litestream-notices.mjs` (owner, 2026-09-24: notices land in the same change as the code).
Also left: `pnpm setup:litestream` skips the download when the installed
binary already reports the pinned version, so the checksum protects fresh downloads only; and the
bench rig keeps its own Litestream download script (its version is pinned beside the root one by
`scripts/litestream-pin.test.ts`). `scripts/setup-litestream.mjs` is measured by the root project's coverage
table through `scripts/setup-litestream.test.mjs`, which injects the download and the platform; the
full box image was not built locally, only its `litestream` stage.
Task 7, how current the bucket copy is and the alerts about it, landed as #619 (2026-09-25).
It added two alert codes, `backup.stream_stopped` and `backup.stream_settings_unusable`. The store reports each commit that changed rows
and the side file; the supervisor reads the newest file in the bucket about once a minute and
reports how long the oldest change not yet there has waited. `/health`, the box status and the
backup status show the bucket copy, and `/health` never fails because of it. The dashboard gains
alerts for a copy that is behind by fifteen minutes, paused, stopped by another box, refused by its
bucket, unable to use its settings, or stopped by itself, and for a failed refresh of the sealed
state row; the `backup.disabled` alert now fires only when there is neither a scheduled backup nor a
bucket copy that is on and current. Left open:
- A bucket read given up after five minutes is not cancelled, because the bucket client's list
  takes no way to stop it; the same root as #590's item (1), no request timeout on bucket calls.
- A commit that changes no row but writes to the side file, such as a schema change or a pragma
  such as `user_version`, is not reported, so the lag can read low.
- An update that writes the same value, straight after a schema-only commit, is still reported,
  although it adds nothing for the bucket (a test pins it).
- The check that the side file changed was measured on the Mac's filesystem only, not the box's
  Linux one; a commit landing in the same file-time tick after a side-file restart is missed.
- A sale whose write transaction began before the supervisor first subscribed after boot (no
  listener registered when it began) is not counted, so the lag reads low for it.
- Whether Litestream uploads anything while the side file is unchanged is not measured; Task 10's
  loop test is the natural place.
- The alerts send the owner to the Backups page for the bucket's settings, which Task 8b added; the
  status gained a third shape, a copy set up but not started, which Task 8b's panel shows as "Not
  running".
- Of the four places boot hands the copy's state to, three are held by the compiler, which refuses
  a boot call that leaves the key out, and `/health` by a boot test. A boot test also pins the
  sealed-state alert's registration.
Task 8a, the server side of the bucket-copy settings, landed as #627. Routes under
`/api/backup/stream`, behind the manager login, read the settings, test a bucket, save and switch
the copy on, switch it off, and hand out the recovery kit: one string holding the bucket's details,
the venue id, the recovery key and the public key that signs the pointer
(`packages/stream/src/kit.ts`). Save sets a recovery key when the box holds none (refused with
`backup.managed_by_environment` when a `WAITRON_BACKUP_*` variable is set, as `apply` and `rotate`
are), refreshes the sealed-state row, stores the settings, and reloads the copy only after that commits; Saves and
switch-offs take turns with each other and with the backup routes' `apply` and `rotate`, which also
set the recovery key. Before contacting the bucket, Test and Save run the check Litestream's
configuration runs, refusing with `backup.stream_config_unsafe` naming the field (for the bucket
name, the fix is lowercase letters, digits, dots and hyphens only), and refuse a prefix of a single
`-`, which the vault would store as no prefix. The routes and the kit's decoder read the bucket settings through
one reader (`packages/stream/src/bucket-config.ts`), and the kit is sent with `Cache-Control: no-store`.
The kit is read in its turn too, since a retroactive Codex review of #627 found that a Save and a
rotation landing between the kit's reads could pair the old bucket with the new key.
Left open: the pointer write left open under
Task 6, item (2), one from a process that has since died, landing after the restart.
Task 8b, the Backups screen's bucket-copy panel and the archive setup reusing a held recovery key
(#628). The panel (`apps/dashboard/src/screens/stream-settings-panel.ts`) takes the bucket's
settings with Test and Save, turns the copy off after a second, confirming tap, shows the copy's
state, how many minutes of changes wait and the last confirmed copy, and the recovery kit with a copy
button and a download; when a settings read of a set-up copy shows a different recovery key, it
fetches the kit again and tells the owner to keep the old one for seven days. A refusal
naming a bucket setting is shown beside that field; a failed Test names the failed check in words,
and a check with no sentence of its own falls back to the refusal's own wording rather than the
reason's text. The archive setup form no longer makes or sends a key when the box already holds one.
The design system gained a `--wt-font-family-mono` token, which the Backups screen's key display,
the panel's kit, the diagnostics screen's log lines and the setup app's break-glass secret read;
`apps/dashboard/src/screens/printers-screen.ts` already asked for it with a `monospace` fallback,
and now gets it. A retroactive Codex review of #628 found faults in the panel, fixed since: an
earlier kit fetch could answer after a later one and put the old kit back; a failed kit fetch after
a successful Save left the previous bucket's kit on screen with no way to ask again; Test could say
it passed for settings edited while it ran; and a bucket changed in another tab under the same key
left the old kit showing. For that last one the panel now takes the kit away when any bucket field a
settings read carries (endpoint, region, bucket, prefix, access key id) changes. Review of those
fixes found one more, also fixed, that was in the panel before them: when the recovery key changed
again, or changed back, while the automatic kit fetch for the first change was still running, that
fetch's kit went on screen under the "download the new kit" banner, and a second change's own fetch
was skipped. Left open: the Backups screen's own card width is still a `34rem` literal, which the
no-hardcoded-chrome rule forbids in a view and no guard reads; and a change of the secret access key
alone, made in another tab, still leaves the old kit showing, because a settings read does not carry
the secret.
Task 9a, the first start after a restore (#630). Every restore that takes on the archive's
identity (`skipSecrets` unset) leaves `rebuild-first-start.json` in the state folder, written under the
venue lock before anything is placed and removed if the restore throws. At the next trading start
the box signs a new certificate for this machine's addresses with the authority it brought back,
then the membership document one term above both the restored document and the term the bucket's
pointer names (read for at most 15 seconds, only when the marker is there), naming this machine's
advertised origin; the marker goes last (`apps/server/src/rebuild-first-start.ts`). A box with bucket
settings whose pointer it cannot read in that time fails the first start rather than sign a term the
pointer may be above; no settings, or a bucket holding no pointer, signs one above the restored
document. A first start that fails lets the box sell but holds the bucket copy, a reload after a
settings save included, and raises `restore.first_start_failed`. It runs after the returned-box reconciliation with the
cloud peer, not straight after the key ring as the plan placed it: with the call moved there, the
fenced-restore case in `apps/server/src/boot.reconcile.test.ts` failed with the box accepting sales,
because the moved term made the peer's fencing document read as not newer. That ordering covers
only a peer that answers during the same start (see the first item below). A mirror or a fenced
node re-issues and signs nothing; the marker stays and the copy is held. An adoption-pending box
returns from boot before the first start, so it neither runs nor defers it: it keeps serving the old
certificate and the marker stays. The new certificate and key are written under working names and
renamed into place only when both are written, so a failed write keeps the old matching pair and
a failed rename of the key puts the old certificate back unless that rename fails too; a
crash between the two renames leaves a mismatched pair, which the next start replaces before the
listener reads it, because the marker is still there — unless that start defers the first start
(fenced, mirror or adoption-pending), when the listener refuses the pair. The next membership
document carries this node's stored endorsement, so a peer that trusts only the endorser (the
primary that adopted this node) accepts it when the stored endorsement is valid for this node's
key. Every signer except the term-0 seed (#643)
(`apps/server/src/membership-seed.ts`) reads the signing node's stored endorsement through
`readSignerEndorsements` (`apps/server/src/membership-mint.ts`): this first start, both promotions
(`apps/server/src/promote.ts`), `retireSelf` (`apps/server/src/retire.ts`) and the chart append in
`apps/server/src/mirror-bundle-api.ts`, which reads the row of the node it signs as,
`designated.nodeId`. The cases "carries this node's stored endorsement, so a peer trusting only the
endorser accepts the eviction" (`apps/server/src/retire.test.ts`), "… accepts the new term"
(`apps/server/src/promote.test.ts`, local secondary) and "carries the primary's stored endorsement,
so a peer trusting only the endorser accepts the appended chart"
(`apps/server/src/mirror-bundle-api.test.ts`) each check that the stored document carries the
endorsement and verifies both against the endorser's key alone and against the signer's own key
held directly. A node row holding no endorsement still signs `endorsements: []`; one case each for
retire, both promotions and the chart append asserts it, and no first-start case does. The chart
append reads the endorsement again on each retry round: "signs a retried chart write with the
endorsement stored when that round reads, not the first round's"
(`apps/server/src/mirror-bundle-api.test.ts`). Left open:
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
- A mirror that deferred its first start and is then promoted without a restart
  (`promoteMirrorToPrimary`, `apps/server/src/promote.ts`) keeps the bucket copy held, reading off
  with the reason `first_start_pending` and raising no alert, until the box next starts; that start
  runs the first start, because the marker is still there. From reading, not a run.

Task 9b, restore from the bucket (#642). `waitron-restore restore --from-bucket <kit-file>
--confirm-venue <tax id> [--confirm-old-box-gone]` reads the bucket the recovery kit names, checks
the pointer against the kit's signing key and venue, refuses when the live generation changed in the
last ten minutes on the bucket's own clock (or when that clock cannot be measured) unless the old
box is confirmed gone, downloads the generation with `litestream restore` into a scratch folder made
fresh for each run, `<stateDir>/stream-restore-XXXXXX/` (abandoned after 2 minutes without progress,
6 hours at most), runs SQLite's `integrity_check`, the newer-software check and the locked secrets
row's unlock, and then asks for the copy's tax id before placing it through the archive path's own
`writeValidated`, which leaves the first-start marker (`apps/server/src/restore-stream.ts`). Every
bucket call the command makes through the object store gives up after 60 seconds
(`apps/server/src/bounded-store.ts`), without cancelling the request. A command-line archive restore
whose database holds bucket settings runs the same old-box check first, reading those settings from
a scratch copy in its own `<stateDir>/archive-source-check-XXXXXX/`; since Task 9c the setup
wizard's archive restore and the Cloud recovery restore run it too. The staged restore request
now carries either an archive or a bucket copy (`apps/server/src/restore-request.ts`); the command
line places the copy itself, and the setup wizard's rebuild stages a bucket request (Task 9c). The
wipe and the archive placement also remove Litestream's own `.venue.db-litestream/` folder. Left
open:
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
- The placement step can lose the old database. `restoreDatabase` (`apps/server/src/restore.ts`)
  removes `venue.db` before its sidecars, and if a sidecar cannot be removed the cleanup also
  deletes the incoming copy, leaving neither. The run-it review reproduced it with a directory at
  `venue.db-wal` (`{ error: 'ERR_FS_EISDIR', old: 'ENOENT' }`), and reproduced the same result with
  the base commit's placement order, so I believe it predates this branch; both restore forms go
  through it.
- The bucket client sets no time limit of its own: `createS3ObjectStore` (`packages/stream`) has
  none. The command line and the setup restores wrap it for every object-store call they make
  (`boundObjectStore`, which abandons a call but never cancels it),
  the first start's pointer read has its own 15-second race (`readBucketPointerTerm`,
  `apps/server/src/rebuild-first-start.ts`, reported as `restore.pointer_unreadable`), and every
  other caller's calls have no bound at all: the replication supervisor's, and the bucket check the
  backup settings screen's Test and Save buttons run (`probeBucket`, opened in
  `apps/server/src/boot.ts`, called from `apps/server/src/stream-api.ts`). A per-call abort signal or request timeout
  inside `createS3ObjectStore` would bound and cancel every caller's calls.
- Open question: the first start's pointer read and the bucket rebuild's calls (the command line's
  `--from-bucket` and the wizard's `/setup-api/restore-bucket`) use different limits (15 seconds
  and 60 seconds) and report different codes (`restore.pointer_unreadable` and
  `backup.stream_request_failed`). Neither the code nor the plan says why they differ. On the
  bucket rebuild, only a timed-out pointer read or newest-upload listing reaches the caller as
  `backup.stream_request_failed`. On every restore, a timed-out call in the clock check
  (`measureBucketSkew`, `apps/server/src/restore-stream.ts`) is reported as
  `restore.stream_source_unchecked` with reason `clock`. The backup-file restores (command line and
  wizard) and the Cloud restore make their other calls to the venue's own bucket inside
  `refuseIfArchiveSourceLive` (same file), which reports a timed-out one with reason `bucket`. The
  Cloud restore's download of its snapshot from Waitron Cloud's storage is not one of these calls:
  it has its own limit (`downloadArchive`, `apps/server/src/cloud-recovery.ts`).

Task 9c, "Restore from my bucket" in the setup wizard. A third card on the wizard's "Join or
recover an existing restaurant" screen takes the recovery kit (pasted or read from a file) and the
environment, and posts them to `POST /setup-api/restore-bucket`, which checks the bucket and
stages the rebuild through `stageStreamRestore` (`apps/server/src/restore-request.ts`) for the
entrypoint to place after the restart. The old-server question ("the old server is switched off for good") and "This is my
business" (the copy's legal name, tax id and location) are asked on the screen and sent back with
the same kit; an answer given for one kit, backup file or Cloud snapshot is dropped when the owner changes it. The
archive restore asks the same old-server question (header `x-waitron-old-box-gone: 1`) when its
database holds bucket settings, and so does the Cloud recovery restore (`oldBoxGone` in its request
body). A copy with an empty tax id is never confirmed, on the wizard or the
command line (`confirmsVenue`, `apps/server/src/restore-stream.ts`). Every object-store call the
setup restores make gives up after 60 seconds (`boundObjectStore`); the Litestream download has
its own stall and ceiling limits. The archive and Cloud recovery routes
now release the setup lock when their staging is refused; before, a refused restore held it until
the process restarted. Left open:
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
  restore too (spec §5.1 step 7, plan owner decision O4).
- After a refused Cloud restore the owner has to tick the Cloud screen's "old server and surviving
  peers are stopped" confirmation again: the shell shows the progress screen while the request runs
  and then draws a new Cloud screen, which starts unticked.

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
foreign-key split (P7 — #426). The mechanism, the measurements and the review lessons for each live in
the PR threads and in `CLAUDE.md`, [conventions-data.md](developers/conventions-data.md) and
[testing-guide.md](developers/testing-guide.md).

**Task F1, the flip itself, LANDED as #489 on 2026-09-23** (main `aabdde6a`). A venue is a directory
of two SQLite files opened through `node:sqlite`; there is no database server, no roles, no grants,
no connection string and no container. What the flip cost, what it could not carry and what it
deliberately deferred are in that pull request and in its commits.

**Task T1, the role-assumption sweep, LANDED as #490 on 2026-09-23** (main `fcc2d432`). `asAppUser`
and its 796 call sites are gone, and so is the prose that described them. **Task T2, dropping
PostgreSQL from the dependencies and the dev stack, LANDED as #492 on 2026-09-23** (main
`fc8753a6`). It takes the cluster out of the box and out of the dev stack,
the client packages out of every manifest that did not import them, the two unread Docker switches out
of both workflows, the PostgreSQL schema differ off disk, the two identity-function claim helpers out
of `@waitron/db`, and the target-choice framing out of the comments. **Task T3, revisiting the coverage bars, LANDED as #494 on
2026-09-23** (main `5093bbfe`) — the last task in the slice-1 plan, and with it slice 1 is done.

**What T3 measured, and why no bar moved.** The whole workspace was run — 46 members green at their
current bars, 1,065 test files and 13,784 tests, plus the root project's 54 files and 3,255 tests —
and the answer is that **the storage switch did not shrink the workspace**: non-test source under
`packages/*/src` and `apps/*/src` went 8,323 KB at `320f1dc08`, the commit before the flip, to
8,359 KB on the tree this change merges into, so a bar that was meaningful in September still is. Four packages shrank by more than a tenth, and
`packages/provisioning` is the large one — by a third, when `waitron-provision instance` went with
the per-tenant PostgreSQL cluster. It cleared the floor then by 7.7 points on statements (it
has since been promoted to the high bar), and the other three (`recipes`, `purchasing`,
`workforce-es`) were at 100% on all four metrics. The numbers, the two traps that were checked rather than assumed, and
the one source file that turns out to be measured by no coverage table at all are in
[ci-and-gates.md](developers/ci-and-gates.md) → *What the storage switch did to the bars*.

**The two coverage questions T3 left open are ANSWERED (owner, 2026-09-23): every package goes to
the high bar, `98/98/98/95`.** T3 had asked whether to promote the packages that already cleared it,
and whether to raise the floor's functions minimum of 85, which no package came within six points
of. The owner chose the whole bar over raising only the functions minimum to 95 or to 90, which
retires the 2026-09-05 split by consequence. The first promotion is done, and the rest of the work
is tracked in **B9. CI and test infra** → *Every package to the high coverage bar*.

**What T2's review wave found, and it is the reason the run-it seat keeps its seat — OPEN as a
lesson, nothing left to fix.** `is_production` in `deploy/waitron.sh` **failed OPEN**. It read the
box's settings as `[ -e f ] && cat f || echo __ABSENT__`, so a `cat` that FAILED fell into the `||`,
printed the sentinel meaning "no such file" and exited 0 — and the caller wiped a production box with
no `--force-production`. The shape predates T2; T2 made it REACHABLE by moving the read out of a root
container into one running as an ordinary user. Reproduced against real Docker in both directions.
Two shapes worth carrying: **(1) the guard suite could not have caught it at all**, because its docker
stub answers a `trading.env` command from a variable and never executes the shell text — the defect
lived in a string no test ran, and the fix's tests now extract the one-liner from the shipped script
and run it under a real `sh`; **(2) the FIRST fix was itself incomplete** — it closed the file case
and left the same hole one level up, because `[ -e "$d/trading.env" ]` cannot tell a missing file from
a directory it may not look inside. The scoped re-read caught that, which is `CLAUDE.md` §1's
"the correction is a new claim" paying for itself twice on one branch.

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

The reusable lesson, because it cost four passes: **the selection key kept turning out to be wider
than the problem.** Sweeping by the IDENTIFIER `asAppUser` found 140 files. A further 44 cited the
deleted FILE without ever naming the function — invisible to the first key. A further 152 described
the mechanism in plain English ("runs as the app role", "`app_user` holds SELECT on `nodes`") and
named neither — invisible to both, and found independently by two reviewers in the same wave. Then
the re-read of that third sweep found ten more, three of them shapes worth carrying: a sweep can
falsify a document in the same commit that rewraps it; shortening a file breaks every pointer INTO
it; and a correction must not decrement a count where it should drop it.

**What #490 found and deliberately did not fix**, so T2 and whoever follows do not rediscover it:

- **Stale PGlite prose — DONE by T2**, and it was roughly a hundred files rather than the dozen this
  line guessed at. `scripts/schema-equivalence.{sh,md}` went with it: deleted, not swept, because the
  script's whole subject was dumping and diffing a PostgreSQL schema.
- **The four helpers named after PostgreSQL — DONE (2026-09-23, PR #524).**
  Renamed, with no behaviour change: `isPgError` is `isRefusal`, `pgErrorCode` is
  `driverErrorCode`, `pgErrorMessage` is `engineErrorMessage`, and `storeF3AsAppUser` in
  `packages/fiscal-verifactu/src/canje-path.e2e.test.ts` is `storeF3`. Historical plans and specs
  under `docs/superpowers/` keep the old names, as written.
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
- **The discarded `cfg` parameters — DONE (2026-09-23, PR #516).**
  `asApp` in `apps/server/src/join-requests.test.ts` and `withVenueAuth` in
  `apps/server/src/management-api.ts` no longer take one. Every route still calls
  `requireVenueCfg`, because each verb it runs takes `cfg` itself. Other `void cfg` lines remain in
  `apps/server/src` (`git grep -n 'void cfg;' apps/server/src`), unchanged. Some are `asApp` test
  helpers of the same shape as the one fixed; the rest are other test helpers and production
  functions (`apps/server/src/working-order.ts` holds several) that take `cfg` and discard it.
- **Three dangling pointers — DONE (2026-09-23, PR #516), with one
  left on purpose.** `apps/server/src/testing/global-setup.ts` was no longer cited anywhere under
  `apps`, `packages` or `scripts`; the four `git show origin/main:…/testing/global-setup.ts`
  pointers of the same kind (in `packages/core`, `packages/scheduler`, `packages/credentials`), and
  credentials' pointer to its deleted `0001_credentials_baseline_sql.sql`, now read
  `git show aabdde6a8^:…`, and each resolves. `nodes.ts` now cites `apps/server/src/node-identity.ts`.
  `0001_db_baseline_sql.sql` was cited in five TypeScript files and one migration: the three `packages/db/src/schema` files
  that told the story of the barrel lost that paragraph, `nodes.ts` points at the `deployment`
  schema instead, and `apps/server/src/till-sale.ts` lost the sentence with it, which was also
  false — `working_orders_enforce_transition` ACCEPTS a later stamp-only update on a settled order
  (`scripts/behavioural-triggers.test.ts`, "accepts the kitchen-handover stamp on a settled
  order"). LEFT: `packages/db/drizzle/0001_behavioural_triggers.sql` still points at
  `origin/main` for the originals, because editing a shipped migration, even a comment, changes its
  hash (measured with drizzle's `readMigrationFiles`: `fba827e45a74…` became `518ac94a3346…`), and
  the boot path's ahead check reports a database hash the image does not ship
  (`packages/provisioning/src/schema-ahead.ts`), so an already-migrated box would read as ahead —
  traced, not run.
  Every other `git show origin/main:<path>` pointer under `apps`, `packages`, `scripts` and
  `docs/developers` (outside `drizzle/`) whose path no longer exists on `origin/main` now reads
  `aabdde6a8^:<path>`, the parent of the commit that deleted it, and each resolves. The pointers in
  `packages/bookings/src/bookings-cas.test.ts` and `packages/media/src/images.test.ts` name files
  that still exist but no longer hold the deleted cases, so they were repointed to `aabdde6a8^:` as
  well (2026-09-24: #574 moved bookings' pointer into its commit message, and #609 deleted
  media's). Also left: the
  pointers in shipped `drizzle/` SQL, such as `packages/media/drizzle/0001_image_references.sql`
  and `packages/db/drizzle/0001_behavioural_triggers.sql`, for the hash reason above.
- **`packages/scheduler/src/migrations.ts` and `packages/identity/src/migrations.ts`'s core-first
  claim — DONE (2026-09-23, PR #516).** Neither set needs core to have
  run first; both now say so, with the experiment in the `tenants` foreign key entry above
  (2026-09-24: scheduler's now says it in its `schema-conformance.test.ts`, #581).
- **The grep receipt in `apps/server/src/promote-endpoint-e2e.test.ts` — DONE (2026-09-23, PR
  #516).** #492 had already reworded "no matches" to "only these three
  comment lines", and that held when run: `grep -rn WAITRON_ADMIN_DATABASE_URL apps packages
  scripts deploy .github` printed the block's own three lines. The block is now only the gap it
  leaves — nothing shows a refused promote write fails closed, and no test asserts
  `promotion.failed` — so the same grep prints nothing and exits 1. The history around it, and the
  "Step 1 was red" story below it, went too.

What the preparation tasks left, with F1's own answers where it found them:

- **How the drain crosses the two database files, given `change_log`'s `local` classification —
  SETTLED by slice-2 spec §2: every table stays in `venue.db`.** The triggers writing it sit on `venue.db` tables,
  and the thing to check first was checked: SQLite REFUSES a trigger
  body that writes another attached database, both ways round. Measured on Node v26.7.0 against
  `node:sqlite`, 2026-09-22, with `node.db` attached to the venue connection: a qualified
  `insert into node.change_log …` inside a trigger is refused at CREATE with `qualified table names
  are not allowed on INSERT, UPDATE, and DELETE statements within triggers`, and the same statement
  written unqualified is refused with `no such table: main.change_log`, because an unqualified name
  inside a trigger resolves to the trigger's OWN database. Nothing is broken today, also measured:
  `applyMigrations` puts every set on the venue handle, so after a real migrate `venue.db` holds 121
  tables including `change_log` and `node.db` holds none. If a later slice moves `local` tables into
  `node.db` (spec §2 reserves it for slice 5), that slice decides this again — either `change_log`
  is reclassified to the file its writers live on, or the triggers stop writing it directly and
  something above them does (P3). Settled by the slice-2
  spec §2: every table stays in `venue.db`, so `change_log` and the triggers writing it share a
  file.
- **The three claim helpers were stripped, and two of them had become identity functions — CLOSED by
  T2.** `claimLock` and `claimLockedRows` are deleted and each is inlined into its one caller;
  `claimRows` stays, because it builds a real `update … returning`. What the deletion turned up is the
  part worth carrying: payments' suite did NOT catch the claim stamping a column no state guard reads
  (mutate `settled_at` and all 413 tests passed), so T2 added the missing case — and the draft comment
  claiming the write queue serialises two forward passes was false, because that caller opens a bare
  `db.transaction`, which is drizzle's own `begin` and never enters the queue.
- **`packages/printing` reported an out-of-range `character_table` as a `transport_fields` problem —
  FIXED by #489 (the SQLite switch); nothing left to build.** `translatePrinterWriteError`
  (`packages/printing/src/printers.ts`) now translates only the refusal that names
  `printers_transport_fields_ck`, through `checkFailed`, so a `printers_character_table_ck` refusal
  propagates unchanged. An operator never reaches it: the only product caller of `createPrinter` and
  `updatePrinter`, `apps/server/src/print-api.ts`, screens the value first with `optionalByte`,
  which refuses anything outside 0..255 as `management.request_invalid` with `field:
  "characterTable"`. Both halves measured 2026-09-23 by deletion, each restored: matching every
  CHECK refusal by its message instead failed two cases in `packages/printing/src/printers.test.ts`
  with `printer.invalid_config`; dropping `optionalByte`'s upper bound turned the `characterTable:
  256` PATCH case in `apps/server/src/print-api.test.ts` from 400 into 500.
- **No guard holds a MODULE migration set to its declared schema — LANDED as PR #491, 2026-09-23,
  for the four named here.** `catalogue`, `payments`, `workforce` and `workforce-es` each have a
  `src/schema/schema-conformance.test.ts` now, calling the shared suite factory
  `@waitron/db/testing/schema-conformance.js`, and the core set calls the same factory. None of the
  four turned out to have any drift. Every other set that builds a table has had one since; see
  **B9. CI and test infra** above.
- **Two coverage gaps under a 5-second default bound — CLOSED (#482 and #509).**
  `scripts/changed-packages.test.mjs` runs under the root project's 30-second default since #482,
  which reaches that file (what thirty seconds does not buy is stated beside it in
  `vitest.config.ts`); the fiscal chain's refused-then-successful retry has a case in
  `packages/fiscal-verifactu/src/chain.test.ts`.
- **The working-time chain's retry has the same untested middle — CLOSED (#564).**
  `packages/workforce/src/chain.test.ts` has the refused-then-successful case.
- **Stale `vitest.config.ts` comments — DONE (2026-09-23, branch `chore/vitest-config-comments`).**
  The entry asked for each package to be checked "read not run"; it was the other way round — run,
  not read — and this supersedes it. Most of the named claims had gone before this branch: "every
  test here boots a WASM PostgreSQL" in #467, "nowhere else in the repo" and the 2026-08-20
  single-fork receipt in #489, and `fiscal` and `fiscal-none` mentioned PGlite only as history,
  which is now cut. What was left was corrected against runs. Each of the five packages' timeout
  comments now says the value is margin, because each package passed `vitest run --testTimeout=2000
  --hookTimeout=2000` with `useVenueDb`'s default setup budget temporarily cut to 2s, on an
  18-core Mac with one package running at a time. No value changed. The review also dropped the
  `venue-db.ts` line pointers from sibling configs and test files, several of which were stale, and
  a "(CLAUDE.md §4)" pointer that named no rule about worker pins.
  - `purchasing`: 19 tests, slowest 6ms, database setup 14ms.
  - `fiscal-none`: 13 tests, slowest 2ms, setup 14ms; coverage at one and three workers wrote
    identical summaries, so its one-worker pin is recorded as a precaution, not a need.
  - `fiscal`: 186 tests, slowest 2ms, setup 5ms in the one file that opens a database.
  - `db`: 577 tests, slowest 74ms, slowest setup 83ms; 20.3s at one worker, 6.4s at four, 5.9s at
    eight; coverage covered and total counts the same per file at one and at four workers; the
    48-line history of the `english-only.ts` exclusion is cut to a pointer at f8d6097d0.
    (2026-09-24: #589 deleted that pointer too.)
  - `identity`: 278 tests, slowest 185ms, slowest setup 49ms; `test:coverage` gave the same covered
    and total counts per file at one worker (22.3s) and with `--maxWorkers=6` (6.2s), so its
    one-worker pin is recorded as a precaution, not a need. Its comment's `venue-db.ts:176`, `:183`
    and `:174` line pointers were stale (the hooks are now at 221–241) and are gone.
  - Follow-up: every other `maxWorkers: 1` config whose comment gives the coverage reason, apart
    from `payments`, which carries its own measurement, still says the pin is needed without having
    measured it; the same one-worker-against-several coverage comparison would settle each. The
    claim that the pre-push hook runs a whole-workspace `pnpm -r test:coverage` is gone from every
    config (`packages/diagnostics/vitest.config.ts`'s last, by #600); the hook has run no package
    tests since #338.
- **Dead code and doc sweeps owed to the rollout's final sweep** — **DONE** (2026-09-23). The unused
  `seedTenantWithSumUpKey` was deleted by PR #516; the file's real-SumUp case seals no credential and
  passes, because the seat reads its credential only on first use, and that case's name and the file
  header had said otherwise and now do not. The twelve plans with a `usePgliteDb` sketch already carried a dated `useVenueDb`
  pointer, added by #473. The rest got dated notes: the credential-vault plan's `hookTimeout`
  claim, the slice-1 spec's four unannotated "211" mentions, and what became of
  `membership-adopt.test.ts` in the membership slice-3 plan (#202 created it, #280 deleted it).
- **Deferred cleanups, each with its reason in its PR**
  - P7's three (#426) — **DONE** (2026-09-23, PR #533). A new root
    guard, `scripts/migrations-match-schema.test.ts`, regenerates every migration set into a copy
    with `drizzle-kit generate` and fails if anything changes, so a schema edit that was never
    generated is now caught; it compares the TypeScript with the snapshot only, so a key added by
    hand-written SQL is still seen by nothing. The migration-set readers two root guards each
    carried a copy of now live once in `packages/sync-enrolment/src/testing/migration-sets.ts`,
    in the same package as `tablesCreatedBy` but outside what its `index.ts` exports, and
    `classification-complete` reads its SQL through them. `two-file-foreign-keys` builds its
    table-to-class map once. Left, found while doing it: `no-tenant-column`'s SQL check still
    passed with one set's SQL dropped, because it checks for an absence and the remaining files
    clear its floor of eight. `module-graph-honesty`, `schema-constraints` and
    `packages/db/src/classification.test.ts` still read a set's SQL their own way — the top of the
    `drizzle` folder only, and `module-graph-honesty` unsorted — rather than through
    `migrationSqlFiles`, which walks subfolders; no set has SQL in a subfolder today
    (`find packages apps -path '*/drizzle/*/*.sql' -not -path '*/node_modules/*'` printed nothing,
    2026-09-23), and drizzle's migrator applies only `<folder>/<tag>.sql` for each journal entry.
    `journal-monotonic` parses `_journal.json` itself rather than sharing `headSnapshot`'s reader.
  - P5's three (#475) — **one DONE, one moot, one still declined, for a restated reason**
    (2026-09-23, PR #531). **Done:** the two-call write conversion
    `decimalToCents(decimal(x))` is now one helper, `stringToCents`, and the same shape for the
    other two scales, `stringToThousandths` and `stringToBasisPoints` (the pattern had spread to
    them since #475), at 50 sites outside `packages/shared`. Only the converters' own tests keep
    the two calls, because they test the converter. The seven sites in the fiscal record builders
    — `record-sale.ts`, `record-correction.ts`, `record-substitution.ts` and `sale-line-rows.ts`,
    which only those three use — were held back from #531 for the owner's review and are **DONE**
    (2026-09-23, PR #535, on the owner's "Just do the swap without
    me"): each helper is `decimalToX(decimal(value))` and nothing more, and the golden huella test
    in `packages/fiscal-verifactu/src/write-path.e2e.test.ts` and `inmutabilidad` passed unedited.
    #475 declined it because a helper taking a plain string "would hide that
    validation and invite passing something unchecked"; that does not hold — a helper calling
    `decimal()` inside refused all six malformed strings tried (`abc`, `1e3`, `+1.00`, `01.00`,
    the empty string and a leading space) with `shared.invalid_decimal`, the same as the two
    calls. **Moot:** renaming the new container test to drop its `.pg.` marker — that file,
    `packages/core/src/list-outstanding-sales.pg.test.ts`, became
    `list-outstanding-sales.wide-amount.test.ts` in #489, and no `.pg.` file is left in the tree
    (`git ls-files | grep -c '\.pg\.'` prints 0). **Still declined, reason restated:** writing
    `moneyNum` in `packages/workforce-es/src/convenio.ts` as `cents / 100`. The value is the same —
    measured over 6,000,007 counts (every one from −2,000,000 to 2,000,000, two million random
    ones across the whole twelve-digit range, and the extremes), `cents / 100` equalled
    `Number(centsToDecimal(cents))` every time, while a control, `cents * 0.01`, differed on 129
    of the counts 0 to 999. What it would change is where the money scale lives: the conversion
    from a count of cents belongs to `packages/shared/src/cents.ts` (CLAUDE.md §3's money rule),
    and a `/ 100` puts a second copy of the scale outside the files
    `packages/shared/src/conventions.test.ts` checks.
    **Found in #531's review — DONE 2026-09-24 (PR #583):** `decimalToCents` now
    checks the bound on the amount rounded to cents, so `"999999999999.995"` is refused with
    `shared.decimal_overflow`. The receipt that found it: `decimalToCents` checked the twelve-digit
    bound BEFORE it rounded to two places (`toScale(assertMoney(value), …)`), so a twelve-digit
    amount with a third decimal place could round past the bound and was accepted:
    `stringToCents("999999999999.995")` returned 100000000000000 (thirteen integer digits) where
    `"1000000000000"` is refused with `shared.decimal_overflow`, measured 2026-09-23. The quantity
    and rate converters check after rounding (`stringToThousandths("999999999.9995")` is refused).
    Held back from #531 because `decimalToCents` also serves the fiscal record builders; the owner
    decided it on 2026-09-24.
  - P6's three (#479) — **two DONE, one declined with its reason re-measured** (2026-09-23,
    PR #529). `cents.ts` now uses `scales.ts`'s literal renderer and raw-text
    pattern instead of copies; its raw reader keeps the number type's bound rather than the money
    digit bound, because most raw reads are totals, which can be wider than one amount — pinned in
    `cents.test.ts` and shown failing when the digit bound is put in. `updatePurchaseInvoice` now
    writes an absent field the way create does, as `undefined`, which drizzle's `set` leaves out
    (`mapUpdateSet` in drizzle-orm 0.45.2 filters `undefined`); a case pins that an omitted total
    and proportion stay as stored, shown failing when the total is written as null. **Declined:**
    one constant for the `10000` literals. Four sit in check constraints, and measured with
    drizzle-orm's `SQLiteSyncDialect`, a JavaScript number interpolated into a check renders as
    `"rate" <= ?`, its value held apart as a parameter; drizzle-kit 0.31.10 builds a check's text
    from `sqlToQuery(check.value).sql` alone (read in its bundled source, not run), so the
    migration would say `?`. Only `sql.raw(String(n))` renders the number, and a constant that
    works only through `sql.raw` is a trap for the next tidy-up, so the literals stay.
    **DONE 2026-09-24 (PR #583, owner decision):** `rawThousandthsToDecimal` now
    reads a total past nine integer digits: its only width limit is what a JavaScript number holds
    exactly, refused with `shared.invalid_thousandths` (like `rawCentsToDecimal`); one quantity is
    still bounded at nine. Found 2026-09-23 in #529's review: the quantity raw reader refused any
    value past nine integer digits, although `packages/reporting/src/top-sellers.ts` passes it a `sum(...)` of
    quantities. That is the
    opposite choice to money's raw reader, which deliberately admits a total wider than any one
    amount.
    **DONE 2026-09-24 (PR #583)** — the same edge as the #531 entry above, fixed
    there. The receipt (same review): `decimalToCents` checked the money bound BEFORE rounding to
    cents, so `decimalToCents("999999999999.995")` returned `100000000000000`, an amount with thirteen integer
    digits that `assertMoney` refuses (measured 2026-09-23 on #529's branch). `main` then checked in
    the same order (`toScale(assertMoney(value), MONEY_SCALE)`), so it predated #529.
    **OPEN** (left by PR #583, owner's call): `assertMoney` (`packages/shared/src/money.ts`) now has
    no product caller — only its export and its own tests. It checks the digits BEFORE rounding, the
    order #583 removed from `decimalToCents`, so a caller reaching for it as "the money bound" would
    bring the edge back. Codex's review recommended deleting it in its own change. Default: delete it.
  - P4a's hand-written holder/waiter contention scaffold and its slow lock-clause negative control —
    **no longer applicable**: both lived in `packages/db/src/job-claim.pg.test.ts`, a real-PostgreSQL
    contention suite, and the file that was to share the scaffold, `packages/db/src/testing/lifecycle.ts`,
    went with it; #489 deleted both, so there is nothing left to share or bound (receipt:
    `git show aabdde6a8 --summary` prints `delete mode` for both).
  - The P10 shared refusal helper — **DONE** (2026-09-23, PR #527): `refusalError` in
    `packages/db/src/testing/refusals.ts`, whose suite provokes each refusal for real and holds the
    crafted one equal to it. Eight test files build their engine-shaped refusals with it; the fakes
    the engine could never produce stay hand-written on purpose. A few other suites still build
    engine-shaped refusals by hand, among them `packages/provisioning/src/cli.test.ts` and
    `packages/scheduler/src/store.concurrency.test.ts`; converting them was not part of P10.

---

## Coordination between tracks

Each track is its own worktree so sessions do not edit the same files. Rules, each already paid for:

- **Concurrency follows measured headroom, never a count** (CLAUDE.md §2). Before a heavy run check
  free memory and the heaviest processes, then scale to what is free. Real-PG suites racing on Docker
  ports show as `EADDRINUSE` and pass on retry — a flake, not a reason to serialise.
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
  tenant; a query that wants "this tenant's rows" reads the table. Spec:
  [drop-tenant-id](superpowers/specs/2026-09-14-drop-tenant-id-design.md); guard
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
  deleted 2026-09-19; its SQLite + Litestream replacement is future work — see *Afterwards*.)
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

- **Detection must PROMOTE the match, not pre-open it in a full list.** #334 first detected the
  operator's system but kept all three certificate-export guides in one list with the match merely
  pre-opened, which read on a Mac as "a list of every combo". The matched guide is now lifted out with
  the rest behind one closed disclosure.
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

A person's role is one of four values (`personRole` in `packages/identity/src/schema/persons.ts`;
written as a PostgreSQL enum at `:21` when this section was drafted).
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

[Design](superpowers/specs/2026-08-31-logging-diagnostics-foundation-design.md),
[plan](superpowers/plans/2026-08-31-logging-diagnostics-foundation.md). Eventual vendor destination
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
  - **Where the freeze reports are (#608).** One JSON file per
    process the watchdog kills, named `holder-frozen-<killedAt>-<pid>.json` (the time with `:` and `.`
    turned into `-`), in `<logDir>/crash-reports/`. On a box that is `/var/lib/waitron/logs/crash-reports/`
    on the persistent `logs` volume (`deploy/compose.yml`), outside the venue database, so a restore
    does not drop it. The keys, and nothing else:
    - `code`: always `provisioning.database_holder_frozen`;
    - `stack`: the main thread's frames as `{ function, file, line, column }`, or `null` when they
      could not be read within 2 s, as happened with a synchronous SQLite statement;
    - `kind`, `pid`, `host`, which is the container id under Docker;
    - `lockedAt`, `lastTickAt`, `killedAt`;
    - `version`: the build's own version, which on a box is `WAITRON_BUILD_ID`.

    The server, restore and rejoin write them, and the provisioning command does when
    `WAITRON_LOG_DIR` or `WAITRON_STATE_DIR` is set. The development scripts set
    no folder, so they write none. Nothing reads or deletes them yet.

### KDS operations — low priority (A9)

Order routing is built (item→station, station→printer, receipt→printer). Gaps: a routing read-back /
audit view (the station selects are set-only — the most useful to close); no station `type`/`kind`;
single-target only (no fan-out, no per-modifier or per-time rules). Table and service statuses have
full CRUD; kitchen statuses are partial — `bump_mode` and `fire_control` are configurable fixed
enums, but a user-definable kitchen-status list does not exist.

### Backup & restore — carry-forwards (B2)

[Design](superpowers/specs/2026-09-04-backup-restore-regime-design.md); the restore hook is
[SP-3d](superpowers/specs/2026-09-06-module-sp3d-fiscal-restore-hook-design.md); the wizard is
[#295](superpowers/specs/2026-09-09-backup-recovery-key-wizard-design.md). Landed: the storage
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
- **The box image carries the WireGuard link.** It also still carries the PostgreSQL replication
  cluster settings (`wal_level=logical`, `track_commit_timestamp=on`, `max_slot_wal_keep_size`) in
  `deploy/compose.yml`; nothing reads them since 2026-09-19 and they are removed with the storage
  switch rather than on their own. The `waitron_repl` bootstrap and its `pg_hba` entry went with the
  machinery. **Dropping the three is not the free tidy-up it looks like.** A cluster that still holds
  a logical replication slot REFUSES to start once `wal_level` falls below logical:
  `FATAL: logical replication slot "leftover" exists, but "wal_level" < "logical"`, measured on
  2026-09-19 on a throwaway `postgres:18-alpine` volume — slot created, container recreated on the
  same volume without the flags, exit code 1. The control in the other direction, on the same volume:
  drop the slot, restart without the flags, and it comes up clean, reports `replica` / `off`, and its
  publication is still there. A box that ever had a standby adopted against it holds such a slot — the
  deleted `CREATE SUBSCRIPTION` passed no `create_slot` option
  (`git show dbe5dff4:packages/sync/src/subscriptions.ts`, line 47), and replaying that statement
  shape on PostgreSQL 18 the same day left a `pgoutput` slot on the publisher's database — and
  `deploy/waitron.sh` rewrites the installed `compose.yml` from the ref on every install
  (`deploy/waitron.sh`, "wrote compose.yml from ${ref}"), so the change would reach that box as an
  unbootable database. The development cluster was checked the same day and holds no slots at all, so
  a dev restart is safe. Whoever removes these decides first whether any real box has been through an
  adopt cycle, and if so drops the leftover slot (`pg_drop_replication_slot`) before the upgrade.
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

**Mechanism as built on PostgreSQL (since #280, DELETED 2026-09-19 — see the note below):** every
module classifies its tables `ledger` / `state` / `local`; the table owner creates the
`_ledger`/`_state` publications; a standby subscribes over the box↔cloud link; promotion and return
run on `pg_replication_slots` with the fence-LSN drain watermark; settings are primary-wins by
construction. A standby holds its full dormant identity from JOIN and promotion never mints a chain.

**2026-09-19 — that code is no longer in the tree (slice 1, task P8).** `packages/sync` and the request
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
is in `venue.db` (slice-2 spec §2). Read the residuals below as requirements for what failover is
rebuilt INTO, not as descriptions of code that exists today.

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
  and nothing supplies. Measured on a migrated but empty database: SQLSTATE 23503 on
  `nodes_location_id_locations_id_fk`, rolled back, latch kept. **Operator-visible consequence:** a box
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
- **The membership chart grows without bound.** It APPENDS while `MAX_NODES = 8` (`packages/membership/src/verify.ts`) makes every verifier
  refuse a longer document, and every wipe-and-re-adopt mints a fresh nodeId — roughly eight
  disaster-recovery re-adopts leave a document no node accepts. Re-admission must retire, not add.
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
needs; it makes its own temporary venue directory. There is no shared container, no template
database and no clone-per-test seam any more — the storage switch deleted that whole harness
(`ProbeRole`, `cloneTemplate`, `useTemplateDb`, `harness.ts`, `two-node.ts`; the rollout plan
`docs/superpowers/plans/2026-08-19-shared-test-container.md` is history, not a recipe). What survives
it: a worker limit is still a per-package call, and the reason that is left is the
`@vitest/coverage-v8` cross-fork branch-merge artifact, which needs `maxWorkers: 1` where a small
package runs under `pnpm -r` oversubscription — the worked reasoning, once in `packages/payments`'
config, is in #558's first commit message (2026-09-24).
`packages/db` keeps `maxWorkers: 4`, which CI's `test-heavy` shards inherit because they pass no
worker count of their own; at one and at four workers its coverage counts were the same (2026-09-23).
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
