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
  it can fail over to, then a cloud primary. Nothing is built for Waitron Cloud now, but every decision
  must keep a node usable in the cloud unchanged (the rules below).
- **Soundness, not the calendar** (2026-08-02). Waitron will be finished before the deli must trade,
  so 1-Jan-2027 ranks nothing above anything. Order by dependency, correctness, and de-risking the
  most-reused or most-uncertain foundations first.
- **Never autonomously land anything touching the unrepairable fiscal core** — hash-chained records,
  never-reused invoice numbers. Fiscal-adjacent work in any track takes owner sign-off at land.
- **Docs land direct to `main`** (2026-08-02): the `main protection` ruleset grants Repository-admin a
  bypass, so a docs-only change is branched, `commit -s`, fast-forwarded and pushed — no PR, no CI
  wait. Feature and code changes still go through a PR.
- **Residency:** cloud instances will be hosted in Spain (owner, 2026-09-05), so asesor Q16 does not
  arise.

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

## What to work on next

Ranked 2026-09-12, with the reason for each place and the track it belongs to. Each item is its own
brainstorm → spec → plan → PR; fiscal-adjacent ones take owner sign-off at land.

1. **The till does not load its menu until a manual refresh** (A4). Seen on the blank-box-to-selling
   run; the box and sale path worked.

2. **Somewhere for things that went wrong to show up** (A5) — designed 2026-09-14, first step is the
   `till.configure` split. The `incidents` table has several
   producers and no reader, and the dashboard has no notification surface. A rejected filing, a payment drift, a
   stalled print agent and a failed or stale backup are all invisible; several other items end "…waits
   for the notification surface".

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

**Ongoing — the dashboard UI overhaul, screen by screen.** Every screen is being brought onto one
shared look, and the rules for it live in [design-system.md](developers/design-system.md). That
document is the contract, and it grows as we go: each screen tends to raise a question the rules do
not answer yet, and the answer is written down there in the same change rather than left in the
screen. Owner decision 2026-09-12: **this work runs on Sonnet.** It is screenshot-driven iteration
with the owner looking at each step, not a write-a-plan-and-dispatch job.

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

**No test renders the failing pairing, and none did before the 2026-09-13 corrections either.** On
`main` every setup screen carrying primary-coloured text wrapped itself in a `wt-card`, which paints
`--wt-color-surface` — `#ffffff` in the light theme, so what those screens actually tested was the
4.63-to-1 pairing that passes. The corrections dropped the card and painted the test host
`--wt-color-surface-raised`, also `#ffffff`, so the pairing under test did not change. The branch
neither created a gap nor closed one.

**The contrast check itself is live, and would catch the pairing if anything painted it.** Receipt,
run at the branch tip: forcing the host in `apps/setup/src/widgets/test-helpers.ts` back to the
pre-correction `--wt-color-bg` turns the three light-theme tests in
`apps/setup/src/screens/done-screen.a11y.test.ts` red (the three dark-theme ones stay green), with
axe reporting `insufficient color contrast of 4.32 (foreground color: #1f6feb, background color:
#f7f7f8, font size: 11.3pt (15px), font weight: normal). Expected contrast ratio of 4.5:1`.

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
3. **Printing** — `printers-screen.ts` with its agent tabs, and `printing-rules-screen.ts`. #319 and
   #327 reworked these recently, so read them against the rules before changing anything.
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

**Content languages and the image library — LANDED #339 (2026-09-12).** The operator now picks which
languages product and menu text is written in, and which one of them everything falls back to when a
translation is missing; receipt languages stay a separate setting. Photos live in a shared library
with translated names and alt text, labels, search across languages, reuse from the product editor,
and deletion refused while a product still uses the picture. Image bytes and their metadata moved out
of `apps/server` into a new mandatory module, `packages/media`, so backup, restore, replication and
configuration transfer carry them the same way they carry any other module's tables.
[Image-library design](superpowers/specs/2026-09-12-image-library-design.md),
[content-language design](superpowers/specs/2026-09-12-content-languages-design.md),
[plan and review evidence](superpowers/plans/2026-09-12-image-library.md),
[operator guide](content-and-images.md).

What it left open:

- **A new picture consumer has to add a real database reference, not just store a filename.** Products
  point at the image table through a foreign key that also checks the tenant matches, which is what
  makes "you cannot delete a picture something is using" true. Any future screen that shows a library
  picture has to add the same kind of reference and a sentence naming the use, or that check will not
  see it. Next action: whoever adds the second consumer writes the reference and the usage text in
  the same change.
- **The online language selector has nothing to select for yet.** The setting and the rule for
  choosing a language are built and tested; the customer-facing online ordering surface they were
  built for does not exist. This is a prerequisite that landed early, not a half-finished feature.

**Follow-up — the image library was unusable as shipped, fixed in #344 (2026-09-13).** Three things
were wrong, all in `packages/media`. **It would not load at all**: opening the screen returned a 500
every time, because the library's first request asks for "sort by best match" with nothing typed in
the search box, and with nothing to match the ranking is all zeroes — PostgreSQL refuses to sort by a
bare constant. No test caught it because every search test that used relevance ordering also supplied
a search term, and an empty search fell through to date ordering, so the two conditions never met in
one test. It now treats "best match with nothing to match" as "newest first", and a real-PostgreSQL
test pins that. **Alt text is no longer required** — saving a picture needs only the picture and a
name in the default language. The same requirement had also been sitting inside the check that
decides whether a venue may switch its default content language, so a picture with a name but no alt
text used to block that switch, and no longer does. **The upload and edit dialog now shows a
preview** of the picture you chose before it is uploaded, or the existing one when editing.

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

**Product categories — LANDED #340 (2026-09-13).** A product can now belong to several categories
without its sales being counted twice. At most one membership is primary: when one is set, its name
is the label written onto new order lines, and its existing preparation route is the one the kitchen
sees. The other memberships and any parent categories add no destinations and no routes. Categories get their
own dashboard page at `/manage/categories`, where you can translate a category's name, give it a
picture from the shared library, put it under a parent (not itself and not one of its own
descendants), and see the products assigned directly to it — a child's products do not count towards
its parent. Deleting a category is confirmed and then goes ahead rather than refused: the confirmation
first shows what will change — the products losing that membership (and any that lose their
reporting category with it) and the child categories moving up to the deleted category's own parent.
The delete also drops the category's kitchen preparation routes; since #362
(2026-09-14) the confirmation no longer lists those. Labels already written onto past orders stay
readable and never block a deletion. Under the hood the single stored category name became translated
JSON in the existing core row, and the new hierarchy, picture and membership tables belong to the
catalogue module. [Design](superpowers/specs/2026-09-12-product-categories-design.md),
[plan and review evidence](superpowers/plans/2026-09-12-product-categories.md),
[API and integration guide](developers/product-categories.md).

What it left open:

- ~~The old combined catalogue screen is still the product editor, and its category picker is
  add-only.~~ **Closed by #345.** The replacement product editor assigns and removes category
  memberships and carries an explicit Reporting Category selector, which clears itself when you remove
  the category it points at. Verified in `apps/dashboard/src/widgets/product-editor.ts`.
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
  trap is unchanged: **a populated development database still has to be reset by hand.** It has
  already recurred — #342's `packages/venue-service/drizzle/0005_unit_snapshots.sql` and `0006`
  add three `NOT NULL` columns to `working_line_contexts`, so any dev database holding an open
  order line fails the same way. That table was empty when this was written, which is the only
  reason it did not bite immediately.
- **Category authoring serialises per tenant, and nobody has measured what that costs.** Hierarchy
  edits, membership replacement and category deletion all take the same one lock per tenant, which is
  the design's deliberate choice and is what makes the races safe. The review confirmed the specific
  races are handled but reported no throughput measurement, so there is no evidence either way about
  how this behaves with several managers editing the catalogue at once. **Next action:** measure it
  before anyone widens category authoring to more concurrent editors, rather than assuming it is fine.
- **Routing from category memberships is still not designed** — that item is unchanged and sits under
  A9 below. This merge kept the existing single-route behaviour on purpose; choosing the primary
  category as the reporting label does not decide anything about the later routing design.
- **A category's colour is stored but shown nowhere outside the categories screen.** Nothing on the
  till, in menus or in reports reads it yet. The colour is data a future consumer can follow; nobody
  has decided whether or how one should.
- **One legacy write path still ties the reporting category to membership.** Sending
  `categoryId: null` in a product patch (`updateProduct` in `packages/catalogue/src/operations.ts`)
  refuses with `category.primary_required` when the product has more than one membership, and
  otherwise clears every membership along with the reporting category — the coupling
  `replaceProductCategories` dropped. Left alone on purpose: nothing first-party sends `categoryId` in
  a product patch any more. **Next action:** remove the coupling if and when a real client needs the
  relaxed behaviour on that route, rather than pre-emptively changing a legacy contract.
- **No "category dependants" seat exists on the module contract.** The delete-preview route
  (`GET .../:id/dependants`) is core-catalogue-specific; a module that wants its own kind of
  dependant (beyond products, child categories and preparation routes) has nowhere to plug in one.
- **The delete confirmation and the add-products button use a plural even for one.** The counts are
  dropped into fixed plural sentences (`categories.delete_products`,
  `categories.delete_children_under`, `categories.delete_children_top`, `categories.add_selected` in
  `apps/dashboard/src/i18n/strings.ts`), so one product or child reads "Quitarlo de 1 productos",
  "Mover 1 categorías hijas …" or "Añadir 1 productos", and the English is just as wrong. The same
  strings are on `origin/main`, so this predates #362. **Next action:** give
  each a one-item form, or use a plural-aware formatter if the dashboard adopts one.
- **A shadow-root styling bug affects `wt-data-table` cells throughout the dashboard.** During QA, a
  real rendering issue was found and fixed in `apps/dashboard/src/screens/categories-screen.ts`: custom
  markup (a colour swatch, a thumbnail, a muted-row style) inside a `cell:` callback was styled by CSS
  rules in the consuming screen's own stylesheet, but Lit mounts that markup one shadow-root layer
  deeper, inside `wt-data-table`'s own shadow root, where those styles could never reach it. Elements
  rendered with no size, colour, or dimming despite passing all automated tests (which only checked DOM
  attribute/class presence, never computed style or layout). The fix used an existing correct pattern
  already deployed in `printers-screen.ts`: `part=` attributes plus `wt-data-table::part(...)` selectors.
  That first sweep missed one instance in the same file — the products modal's "no other categories"
  dash — because the test covering it asked only whether a `.muted` node existed, which was true in the
  wrong shadow root too; the final review found it, and the test now reads the painted colour back.
- **The Products list has the same styling bug, and nobody has fixed it.** #353's QA saw it on the
  real page, in code that branch did not touch (`apps/dashboard/src/widgets/product-list.ts`): product
  thumbnails render at their full natural size and allergen badges as unstyled text. It was reported,
  not re-checked, when this row was written. **Next action:** open the Products list in both themes,
  confirm it, and move those cell styles onto `part=` attributes the way the categories screen now
  does, with a test that reads a painted size or colour back rather than asking whether a class exists.
- **Nothing stops the next screen making the same mistake.** A check that compares the class names a
  screen's own stylesheet styles against the class names it puts inside `wt-data-table` cell callbacks
  looks feasible and would catch this whole kind of bug; nobody has tried to write it.

**Categories screen rebuilt — LANDED #353 (2026-09-14).** The `/manage/categories` page is now a
table you can switch between a tree (children nested under their parent, collapsible) and a flat
list, with a name filter that keeps a match's parents visible. A category can have a colour, picked
from a palette or chosen freely, shown as a square beside its name and as a coloured tag
(`wt-lozenge`) on a product's other categories. Each category opens a window listing its products,
and you can add many products at once from a checkbox list. Two behaviour changes came with it: a
product's reporting category is now optional, and deleting a category shows what it will change and
then goes ahead instead of refusing (both described in the #340 row above, which was updated in the
same change). What it left open is recorded in the #340 list above — the colour shown nowhere else,
the legacy product-patch path, the missing module seat for delete dependants, and the table styling
bug. [Design](superpowers/specs/2026-09-13-categories-screen-design.md),
[plan](superpowers/plans/2026-09-13-categories-screen.md).

**Category management reworked — LANDED #362 (2026-09-14).** The categories screen, its form, the
product-categories editor and the products dialog now share one layout. Parent and category pickers
are searchable dropdowns (`wt-combobox`, its first dashboard use), and category names show in the
reader's own language instead of the venue's default, which was a bug. The shared table
(`wt-data-table`) gained opt-in behaviour any screen can use: a search box, a filter dropdown per
column, a starting sort, parent rows kept visible when a tree is filtered, and a sort-and-filter view
remembered for the browser tab. The delete confirmation no longer lists kitchen routes, though
deleting still removes them. What it left open is recorded where it belongs: the plural-for-one
wording (in the #340 list above), two till dropdowns that may show the wrong choice and the
`wt-select` question (under A7 below), and why server-backed paging (also A7) cannot
reuse the table's search and filters as they stand.
[Design](superpowers/specs/2026-09-14-category-overhaul-design.md),
[plan](superpowers/plans/2026-09-14-category-overhaul.md).

**Product modifiers — LANDED #341 (2026-09-13).** Modifiers are now written once and attached to as
many products as you like, instead of being retyped per product. There are four kinds: free text (a
note the kitchen sees), extras (priced additions), options (pick from a list) and a plain yes/no.
They get their own dashboard page, and the till asks for them when the dish is ordered. What the
customer chose is stored on the order line as a fact rather than recalculated later, so a held order,
a fiscal invoice, the kitchen ticket and the printed receipt all show the same answers even after
somebody edits the modifier afterwards. Extras are priced in decimals and multiply by the parent
quantity, fractional quantities included. Menus keep their existing publication boundary: only
modifiers published for that menu offer can be chosen from it, and a menu's own price overrides and
choice availability still win.
[Design](superpowers/specs/2026-09-12-product-modifiers-design.md),
[plan and review evidence](superpowers/plans/2026-09-12-product-modifiers.md),
[integration contract](developers/modifiers.md).

What it left open:

- **Two ways to attach a modifier to a product still exist side by side — half closed by #345.**
  The combined catalogue editor that was the reason for keeping the old door is gone. The door itself
  is not: `apps/server/src/catalogue-api.ts` still accepts `optionGroupIds` as an alternative to the
  canonical ordered `modifierIds`, still rejects a request that sends both, and still writes the same
  underlying tables either way. Nothing in the dashboard sends the old field any more. **Next action:**
  delete the `optionGroupIds` branch from the product POST/PATCH handler and its parser, confirm no
  other caller sends it, and drop the mutual-exclusion check with it.
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
- **The modifier editor's own allergen list survives — the origins half of this went away.** #345
  removed ingredient origins from the modifier model altogether and replaced them with a direct
  dietary effect, so half of this duplication no longer exists. What remains is that
  `dashboard-choice-form` (`apps/dashboard/src/widgets/choice-form.ts`, where the markup moved when
  choice editing became its own modal) still renders its allergen list with its own private method
  rather than the shared allergen picker, which gained a compact mode in #345 for exactly this shape
  of use.
  Cosmetic, but it is the sort of duplication that
  hardens if nobody names it.
- **The independent review did not cover the browser and rendering paths.** Claude's run-it reviewer
  worked to a bounded brief and said so; what it did run found a real repricing bug — reordering
  unchanged selections on a held order repriced an extra from 1.00 to 9.00 — which was fixed by
  comparing saved answers by value rather than by their order in the payload. The browser, receipt and
  kitchen-rendering evidence comes from the build's own focused tests plus CI's package suites, not
  from a second pair of eyes. Worth knowing before anyone treats those paths as double-checked.

**Product selling units — LANDED #342 (2026-09-13).** You now say what you actually sell a product
by — each, grams, kilograms, millilitres, litres, or a unit you invent yourself — and how many decimal
places its quantity may have (0 to 3, where 0 means whole numbers only). A price is always a price per
that unit: choosing grams after pricing per kilo does not convert anything, it just means the number
now reads as a price per gram. Units get their own dashboard page, and a new venue is seeded with the
six above; editing or deleting a seeded unit survives provisioning running again, because a durable
per-tenant marker records that seeding already happened. Deleting a unit is refused while any product
uses it, including products that are switched off, and the refusal names the products. Renaming a unit
or changing its precision is allowed while it is in use: new quantities follow the new rule and
quantities already recorded keep the unit name and precision they were sold under, frozen onto the
order line and carried through park and resume, the kitchen screen, the receipt and any reprint.
[Design](superpowers/specs/2026-09-12-product-units-design.md),
[plan](superpowers/plans/2026-09-12-product-units.md).

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
- **Deleting a unit no longer asks first, and a blocked delete now offers a way out.** Delete attempts
  the delete straight away; when products still use the unit, a searchable modal lists them, lets them
  be ticked and moved onto another unit in one go, and deletes the unit once none are left
  (`apps/dashboard/src/screens/units-screen.ts`). That work also found the table recording a product's
  unit had only a unique constraint, so Postgres refused the reassignment's UPDATE on a published
  table with `55000` — `packages/catalogue/drizzle/0010_product_units_primary_key.sql` gives it a
  primary key. The design doc's older deletion paragraph is marked superseded rather than rewritten.
  LANDED #350 (2026-09-13).
- **Nothing checks that a table shared by replication has a primary key.** #350 found
  `product_units` publishing its rows with only a unique constraint, which makes Postgres refuse every
  UPDATE to it (`55000`), and the in-memory test database does not enforce that, so no test noticed.
  `CLAUDE.md` §3 now states the rule and says outright that no guard enforces it. Nobody has checked
  whether any other published table has the same shape. **Next action:** a root guard beside
  `scripts/classification-complete.test.ts` that migrates every set and fails on any published table
  without a primary key — proven by deleting `0010_product_units_primary_key.sql` and watching it fail.
- **Its migrations cannot run over a populated development database, and nothing here said so.**
  `packages/venue-service/drizzle/0005_unit_snapshots.sql` and `0006_unit_snapshot_identity.sql` add
  three `NOT NULL` columns to `working_line_contexts` with no default — the same shape as
  `0020_category_names`, which killed a dev boot on 2026-09-13 (#340's row above). Any development or
  preproduction database holding an open order line fails the same way, with `23502`. It has not bitten
  yet only because that table was empty when #343 checked it (`select count(*)` → 0); the first open
  order on the till changes that. **Next action:** none beyond knowing it — the remedy is the ordinary
  `wa-wt reset demo`, and since #343 the boot names that remedy itself instead of leaving a driver
  stack trace to decode.

**The integrated product editor — LANDED #345 (2026-09-13), and the overhaul is complete.** The
dashboard now has one Products list and one editor, replacing the old combined catalogue screen. A
product carries a translated name and optional description, a separate kitchen name, an image, a tax
choice, its selling unit, its categories with at most one marked as the Reporting Category, its ordered
reusable modifiers, direct allergen and dietary declarations, and ordered variants — Small and Large,
each with its own price. One transaction saves the whole thing. You can create a unit, a category or a
modifier without leaving the product you are editing: the draft survives cancelling the nested form, a
rejected save, a failed refresh and a late response. Menus publish variants explicitly and can override
each variant's price and availability, and the till picks a variant with the server resolving which
price actually wins. Held orders, kitchen tickets, receipts and reprints keep the product and variant
names, kitchen name and prices they were sold under, so later catalogue edits do not rewrite history.
Allergens and dietary suitability are now declared directly on the product rather than derived from a
recipe, and a modifier choice can invalidate a claim — adding bacon stops the till and kitchen calling
the dish vegan. [Operator guide](products.md),
[checkpoint and receipts](superpowers/plans/2026-09-13-product-editor-checkpoint.md),
[design](superpowers/specs/2026-09-12-product-editor-design.md).

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
  unit, a category and all four modifier types from inside a dirty product draft and taking the result
  through the till. That is the shape of check that #344 showed matters — the image library passed
  review and CI and still returned a 500 to the first person who opened it. **Next action:** walk it
  once on a dev stack before treating the overhaul as finished.

**Modifier editing, reworked — LANDED #352 (2026-09-13).** Editing a modifier's choices is
now a table rather than a stack of expanding panels. Each row shows the choice's name and price and
carries the two things you change most — whether it is available, and whether it starts already
chosen — while everything else about that choice (its translations, price, maximum quantity, tax
class and allergen or dietary effects) opens in its own small window. You reorder the choices by
dragging the handle at the start of a row or, with the handle focused, by pressing the up and down
arrow keys. Two model changes came with it: a **Yes/no** modifier no longer has its own wording for
Yes and No, because it is now one on/off switch labelled with the modifier's own name — a "yes" answer
prints that name and a "no" answer, though still recorded, prints nothing on the receipt, the kitchen
ticket or the till basket (owner decision 2026-09-13); and an extra's
choice is either preselected or not, replacing the old starting quantity, so what the total maximum
limits is how many choices you may preselect. Create on the Modifiers list became a round plus
button beside the heading.
[Design](superpowers/specs/2026-09-13-modifiers-editing-rework-design.md),
[plan](superpowers/plans/2026-09-13-modifiers-editing-rework.md).

What it left open:

- **A keyboard-driven reorder says nothing to a screen reader.** Moving a choice with the arrow keys
  changes the table and returns focus to the handle, but no live region announces the new position,
  so somebody who cannot see the table gets no confirmation that the move happened. The accessibility
  tests cannot catch this — axe checks static markup, and a missing announcement is not a markup
  defect. **Next action:** add a polite live region to the choices table naming the moved choice and
  its new position, and cover it with a test that reads the region's text after a key press.

### A1. Checking a fiscal record before it is written — LANDED #331 (2026-09-12)

`packages/verifactu/src/validate.ts` holds AEAT's rules and no production file called it, confirmed by
experiment (a series code of `Serie A` reached `registros_facturacion` as `Serie A/1`, which AEAT
would reject). What landed: a record AEAT could not accept is refused at the chain seam, before
anything is written; one whose totals disagree with its own VAT lines is written, filed and flagged as
an incident, because AEAT accepts those under a ±10 euro tolerance; the same rules reach the setup
boundary and the `waitron-provision venue` command through a seat on the regime-neutral fiscal
contract, so no host code imports a regime package; and the wizard now returns the operator to the
refused field with a sentence saying what is wrong.

**No root guard keeps the validator wired** — the design left that open and the answer was no. The
guard is behavioural: the refusal at each seam is proven by deletion, and a root test pins the
wizard's field list against the constant the regime itself loops over. A text-walking guard was
rejected with a receipt: only two of the four field paths appear as string literals, so a scrape
would find two, pass, and claim four.

Three things the work uncovered, none of which anyone was looking for. The shared alta test fixture
had drifted into describing a record AEAT would reject, so 42 tests went red-to-green across eight
files when it was corrected. `recordSale` promoted a record to a full invoice whenever a sale carried
a business customer but never named the recipient — a real latent defect, fixed here for a Spanish
customer. And the new permanent refusal reached the till as "try again", which is the one instruction
that cannot work; five handlers now say to stop and who to call.

### A1c. Dead pointers to deleted test suites

The per-package `errors.reachability.test.ts` suites were deleted on 2026-08-11, but roughly 37
comments across 15 or more packages still cite them as the guard for error-code reachability. The
real guard is `scripts/errors-reachable.test.ts`. Found while reviewing A1, and deliberately NOT
swept there — fixing one of 37 makes the rot look addressed, and CLAUDE.md §1 says thin on touch
rather than sweep. One pass, whenever somebody has the file open anyway.

### A1a. A foreign business customer needs an identifier-type decision

`recordSale` now names a Spanish recipient on a full invoice. A non-Spanish one is refused by name
(`fiscal.foreign_recipient_unsupported`), deliberately: AEAT's `IDOtro` needs an `IDType` — NIF-IVA,
passport, residence certificate and so on, enumerated at
`packages/verifactu/schemas/SuministroInformacion.xsd:894-927` — and choosing wrongly files a record
into an append-only table that can never be unfiled. Whoever wires up business-customer sales makes
that call. No HTTP route supplies a counterparty today — core's `recordSale` hardcodes `null` and
nothing calls `recordSubstitution` from a route — but `packages/core`'s substitution path types it as
required, so the refusal is one route away, not one feature away.

### A1b. The validator never checks the recipient's own identity — DONE in A1

`validate` scanned the issuer's name and the operation description for characters XML forbids but
did neither for `Destinatarios.IDDestinatario[].NombreRazon`, and applied no length rule to the
recipient's NIF. The gap predates A1 (`git log -S`, #51) and was already reachable through core's
`recordSubstitution`, whose recipient has always been required; A1 widened it to any F1 `recordSale`
builds. Neither is reachable from an HTTP route yet, so the run-it review reproduced it by calling
the backend directly: a customer named `Cliente<U+0007>SL` went through the new full-invoice path
against real PostgreSQL, the sale COMMITTED, and the bell character was stored in the append-only
record. Fixed on the same branch: every recipient's
name is scanned and the issue names which one, and the recipient's NIF gets the same exactly-nine
rule the issuer's does (`sf:NIFType` is the identical XSD type). Regression at the chain seam.

### A1d. Four things the A1 review wave raised and did not fix

Each was judged and deliberately left; none blocks the merge.

- **The audited AEAT package's own shared record fixture is still a full invoice naming no
  recipient.** `packages/verifactu/test/fixtures.ts`'s `ALTA_INPUT` is the exact shape A1 corrected
  everywhere else. Not free to fix: it reproduces AEAT's own vector-1 hash, and the exact-XML
  expectations in `xml/serialize.test.ts` would all move. Whoever touches it does so with those two
  facts in hand.
- **The venue-field check restates three rules the validator owns.** `packages/fiscal-verifactu`'s
  `venue-fields.ts` copies the series-code character set, the description cap and the control-character
  range out of `@waitron/verifactu`'s `validate.ts`, and a whole test file exists to keep the copy
  honest. A reviewer proposed exporting `NUMSERIE_PATTERN`, `CONTROL_CHAR_PATTERN` and a named
  description cap from the library's barrel instead, deleting both the copy and the guard. DEFERRED
  on purpose (owner, 2026-09-12): it widens an audited fiscal library's public surface at the end of
  a branch, and the drift guard already closes the risk — 34 tests, proven against fourteen
  mutations. Revisit when something else needs those patterns.
- **The till writes the same three-way error classification at five call sites.**
  `apps/till/src/till-app.ts` decides permanent-refusal / known-code / unknown in five places; a
  helper would collapse it. Cosmetic, and cheapest to do alongside the tip-collection work that
  touches `#onPayTab` anyway.

### A2. The setup wizard

Landed in #334 (2026-09-12). [Design](superpowers/specs/2026-09-12-setup-wizard-a2-design.md) ·
[Plan](superpowers/plans/2026-09-12-setup-wizard-a2.md).

**Corrections from walking it on a real machine landed in #347 (2026-09-13)**, with a passkey offer
on first sign-in. [Design](superpowers/specs/2026-09-13-onboarding-flow-corrections-design.md) ·
[Plan](superpowers/plans/2026-09-13-onboarding-flow-corrections.md). The wizard now sits in the
dashboard's centred modal, help tooltips stay inside the window, the province question precedes the
fiscal territory it decides, "First operator" became "Your account" with first and last name fields,
and the account created gets the browser's language. Two calls the PR left with the owner, still
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

The original walkthrough is retained under *Detail → Setup wizard*.

### A3. Printers from the dashboard

**Office printers greyed out in the scan — LANDED #359 (2026-09-14).**
Office laser printers also accept raw print jobs on port 9100, so the scan and the address check
listed them like receipt printers. Once per job pull, the agent now asks every network printer it
reports for its paper sizes, using a read-only IPP Get-Printer-Attributes query on port 631
(remembered per printer for 30 seconds). A reply listing A4 or US letter marks it an office printer:
the Add printer dialog greys it out with an explanation and no Add button, unless it matches a
disabled registration, which keeps Add again. No answer, a late answer or an unreadable reply leaves
the printer addable as before.

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

**Check a known address — LANDED #335 (2026-09-12).** The Add printer dialog now takes an IP
address and port and asks the approved print agents to try it, so a printer the two discovery passes
cannot see (they do not cross a subnet) can still be added, including reactivating a disabled one.
The check opens a TCP connection and sends no bytes; an address that answers is then asked for its
paper sizes on port 631 (see _Office printers greyed out_ above). The server keeps at most eight
targets for 30 seconds and each agent works out the remaining time against its own clock.
[Design](superpowers/specs/2026-09-12-printer-address-probe-design.md) ·
[Validation](superpowers/plans/2026-09-12-printer-address-probe.md).

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

- **The till does not load its menu until a manual refresh**, and a dashboard menu change does not
  appear live on it. A till-app fix.
- **The three displays walked end to end** — [ui-review.md](ui-review.md)'s areas, at the real box.
- **Android/iOS on-device install and trust rows** — real phones on the shop WiFi, the owner's to
  run. The name-constrained CA does NOT protect a personal Android phone (measured 2026-09-08); BYOD
  Android either accepts broad trust in the box CA or uses the public-certificate path — an owner
  call before go-live.
- **Location-consistency guard** — nothing enforces that a sale-capable device's register lives in
  the box's configured location, so a mis-provisioned device could stamp a fiscal record with a
  different site. Guard at enrol or first sale.
- Register/device follow-ups: `WAITRON_TILL_TILL_ID` still seeds a "Caja 1" register while a till
  enrol auto-creates its own; the device-management routes build their `devices ⨝ device_profiles`
  read inline where a `listDevices` store verb belongs.

### A5. Incidents and notifications

**Designed 2026-09-14:** [dashboard alerts](superpowers/specs/2026-09-14-dashboard-alerts-design.md) —
one bell, panel and Alerts screen for recorded incidents and live checks (backups, fiscal submission,
printing, reader battery). Build order: (0) split `till.configure` into permissions named for what
they guard, its own branch, no access change; (1) the alerts framework and recorded incidents; (2) the
live checks. The questions below are answered there; the notes stay as the origin of the item.

Two halves, one branch each (owner decision 2026-09-12).

- **A reader for `incidents`.** `openIncidents` is the only read and nothing calls it, while the
  fiscal drain (AEAT rejections), the payments reconciler (drift), the Stripe device provider and the
  card provider pool all write. Design questions: its own screen or part of diagnostics; who may see
  it (fiscal versus money); acknowledge or only observe. Detail under *Detail → Incidents*.
- **A notification surface for the dashboard** (owner-raised 2026-09-08). First consumer: "2 devices
  tried to join in the last 10 minutes" when pairing mode is shut. Then: a stalled fiscal outbox, a
  print agent that stopped pulling, a stuck job past its lease, a failed or stale backup, a low reader
  battery, later a standby that has fallen behind. Decide scope first: toast versus a persisted
  per-person inbox, `state` versus `local`, push versus poll.

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
  same moment (an accepted race); Stripe's reader list is one page; low battery waits on A5; status
  never refreshes by itself, and polling must go through the passive-session controller.
- **The SumUp reconciler** — settlement-report audit and orphan self-heal. `resolvePending` is the
  interim backstop; without an affiliate key a create whose response is lost resolves `failed` and
  raises `payment.pending_outcome_unactionable` for a human. Note: a SumUp refund is a separate
  `type: REFUND` transaction linked by `transaction_code`; the original's `status` never flips.
- **A SumUp API drift-detection suite** on a Virtual Solo in a sandbox merchant account — would have
  caught the #312 refund-unit bug. Needs a sandbox account and a CI secret.
- **Stripe does not fill `CardDetails`**, so a Stripe card sale prints `Tarjeta` with no scheme/PAN/
  auth. Gated on the deli having a Stripe account, which it does not.
- **Slice 2 — the handheld NFC/QR link** and restoring `stripe_on_device` (Tap-to-Pay). Redsys and
  bank terminals are parked; Bizum research is under *Later and parked*.
- **The webhook `recordSale` hand-off** (Mode 3) and the reconcile remediation UI.

### A7. Users, roles and the dashboard shell

**The dashboard shell restyle landed (#333, 2026-09-12).** The sidebar's groups now collapse and the
current item is highlighted, there is a Settings group, and the app registered the kebab and hamburger
icons it had never had. The banner's separate "Your profile" and "Log out" buttons became a single
person-icon menu, and the profile moved off its own page into a modal opened from that banner, with
"Your details" and "Security" tabs. Two shared pieces gained options instead of being copied:
`wt-row-actions` takes an `icon` and `iconSize` (it was a fixed kebab) and `wt-button` takes an
`align`, so menu entries read left-aligned like a real dropdown — the staff, payments-reader and
venue-operations menus use them too. The Users edit form lost its Reset access/PIN and
Deactivate/Reactivate buttons, which already sit on the row's own menu behind a confirmation; Resend
invitation stayed. Two bugs were found while checking the work and fixed test-first: saving your
profile re-probed the session and silently reset the screen behind the modal to Overview, so closing
the modal dropped you there instead of where you had been; and Edit was clickable before the profile
data had loaded. The rules went into [design-system.md](developers/design-system.md) and CLAUDE.md §3.

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
- **Two till dropdowns may show the wrong choice when they first appear** (found 2026-09-14; read,
  not run). `apps/till/src/screens/till-counter-screen.ts:321` (service zone) and
  `apps/till/src/widgets/line-extras-editor.ts:95` (doneness) bind only `.value` on a `<select>`
  whose options come from a `${…}` list, and mark no option selected. The CLAUDE.md §3 `<select>`
  rule says such a dropdown shows its first option when its first value is another one: a chosen
  service zone that is not the first zone, or a doneness already set when the picker first renders.
  **Next action:** reproduce each in a browser test, then mark the chosen option with `.selected`.
- **`wt-combobox`** (#351, 2026-09-13). It is a searchable dropdown in `packages/ui`: pick one option
  or several (`multiple`), and optionally offer to add what was typed when nothing matches. It landed
  with nothing using it; #362 (2026-09-14) is the first adopter, for the
  category form's parent picker (`apps/dashboard/src/widgets/category-form.ts`) and the
  product-categories editor's category and reporting-category dropdowns
  (`apps/dashboard/src/widgets/category-membership-picker.ts`). Left out on purpose, per its
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
  every screen and API as tenant-wide or location-scoped first.
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
  Spanish as its default product language and Catalan and English alongside, whatever its province —
  right for the deli, wrong for a Spanish venue outside Catalonia. It replaced a derivation that gave
  a Barcelona venue Catalan alone, which was worse. The proper fix drives the list from the venue's
  region and the languages it actually chose, which probably means setup asking. Do it when there is
  a second region or a second country to be wrong about. The hard-code is in
  `packages/catalogue/src/provisioning.ts` and names this entry; every other country still derives
  its language from geography. Receipt languages are a separate setting and already follow the
  province.
- **Category-driven routing to multiple printers/destinations** (owner, 2026-09-12): deferred from
  the [Products overhaul](superpowers/specs/2026-09-12-products-overhaul-design.md). Decide how a
  product's category memberships select one or more preparation/printing destinations, how matching
  rules combine and how duplicate output is prevented. Keep reporting attribution separate so one
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
  `#allergens` render, the KDS-versus-till unreviewed-dish call, post-fire note and doneness edit
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

The branch added certificate guidance before collecting setup details, connection retry/help,
matching download/help paths over HTTP and HTTPS, and an installer QR pointing at the guide. It
covers macOS, Windows, Linux, ChromeOS, Android and iPhone/iPad, with browser-specific instructions.
[Design](superpowers/specs/2026-09-12-box-trust-onboarding-design.md),
[plan and validation](superpowers/plans/2026-09-12-box-trust-onboarding.md).

Reworked in #346 (2026-09-13) after an owner review of both pages: the guide opens the visitor's own
device's steps, guessed from the request headers with the full list as the fallback, carries the logo,
and shows roughly half the on-screen text it did; the wizard's connection step shrank to one question.
Per-device coverage is unchanged. See the *Rework, 2026-09-13* section of the design.

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

- **S3-compatible bucket, then Google Drive.** Only `LocalFsBackend` exists. The abort-aware
  per-destination timeout lands with the first network backend.
- **Whole-state-volume capture** (its own §5-reviewed slice): capture the whole state directory EXCEPT
  an explicit exclusion set, with a completeness guard that fails when a new top-level entry is
  neither captured nor excluded — the curated list went stale on `modules.json` already.
- **The "backups off or stale" reminder** belongs in A5's notification surface; when a nightly report
  job exists, the backup slot should fire after it.
- **The cold-restore operator surface** (promote Slice 4): connection rebinding, advertised origin,
  an authenticated entry.
- **Reconsider the backup container against off-the-shelf tools** (a brainstorm): `WBA1` plus
  `artifact-cipher.ts` holds the whole dump in memory and is restorable only by Waitron code, where
  `pg_dump | age` into a tar is the obvious alternative.
- Carry-forwards under *Detail → Backup*.

### B3. The bootable USB installer

Runs `waitron.sh install` unattended. Open questions it owns: whether the stick carries the images so
install needs no internet; unattended updates for a box we did not sell; AP-mode WiFi onboarding. Box
image constraints under *Detail → Box image*.

### B4. Upgrades and migrations

- **Core release points 1 to 6 cannot upgrade at all.** Entries 2 to 6 carry `when` values below
  entry 1's and drizzle picks what to apply from `max(created_at)`; no journal edit repairs it. The
  only real repair is a squashed baseline — **an owner decision nobody has taken**. Until it is, the
  hazard stands: **do not run `pnpm --filter @waitron/db db:generate`** (it proposes dropping the
  bookings table, which left core's barrel but stayed in core's snapshot chain).
- **Four paths migrate a live database with no ahead-of-image check** (`instance-apply.ts`,
  `restore.ts`, `rejoin-command.ts`, `dev-setup.ts`); only the boot path has one.
- **`waitron-provision instance` migrates on every run**, which against a trading shop can lock
  tables — gate it (a flag, a refusal, a louder confirmation)? A product decision before production.
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

### B7. Provisioning and build debt

- **The `tenant` command is unplanned**; its idempotency check should attempt the insert and catch
  the unique violation, and with one tenant per database the guard is really `assertNoForeignTenant`.
- **The credential READ path does not `validatePayload`** (`getCredential`/`tryGetCredential`,
  `packages/credentials/src/store.ts`), so a
  row sealed under an older `PURPOSES` list returns a missing field as `undefined` — fail-loudly
  versus keep-serving, to settle before the first consumer relies on it.
- **Two near-identical node-forge certificate builders** (`self-signed-cert.ts`, `testing/tls.ts`,
  plus the fiscal module's byte-copy). Extract one; its own PR, it touches the mTLS fixture.
- **The same hand-built SQL array appears in several packages** — `sql.join` of each value inside
  `array[...]::text[]`, in `packages/catalogue/src/provisioning.ts`,
  `packages/provisioning/src/venue-apply.ts` and `apps/server/src/configuration-transfer.ts` (find
  others with `grep -rn "::text\[\]"`). It is rebuilt by hand because interpolating a JavaScript
  array as one value makes Drizzle emit a list of values rather than an array, which PostgreSQL
  refuses. One shared helper would stop a wrong copy being written; its home has to be added to
  `@waitron/db`'s enumerated `exports` map, which is why it is not a five-minute change.
- **A box that mints its certificate before NTP sync persists a wrong validity window**, with no
  renewal path yet. Ties to a time-health check and certificate renewal.
- **Hardening from onboarding 2b:** a DB-level advisory lock on `tenantId` spanning
  guard→stamp→`applyVenue`; one `closeAll(pools)` so a throw from the first close cannot skip the
  rest; a wizard-only box runs its trading life on the owner role rather than `app_user` until the
  role-split retrofit.
- The shutdown REJECT path gates its failure-log flush before exit, so a `close()` rejection plus a
  stalled stdout pipe is an uncovered hang; `waitron.sh` pulls with `--ignore-pull-failures`, so a
  box with no manifest entry for its architecture fails silently at pull and breaks later at `up`.

### B8. Module framework follow-ons

- **Country-pack follow-ons:** the authenticated address relay and its first provider adapter; phone
  normalisation in bookings; a supplier country/identifier scheme before validating purchasing tax
  IDs; the pack's module preset; the refused foral, Canary, Ceuta and Melilla jurisdictions; a
  territory picker in the setup wizard (it offers `ES-common` only).
- **`fiscal-none` left-behinds:** de-dup the `tls.ts` mTLS fixture; remove the inert
  `resolveClient`/`skipRetryMs`; regime-agnostic provisioning tests.
- **Test-helper debt:** `provisionTestVenue(db, overrides)` for `apps/server`'s sixty-odd suites; the
  duplicated `boot.*.test.ts` helpers into `apps/server/src/testing/`; a shared
  `useFiscalMirrorPair()` for the two-clone fiscal suites.
- **The tax-model system** — the `tax` slot is an inert label today; the intended shape puts the tax
  MODEL in core with the fiscal module supplying rates and labels. A prerequisite for any non-ES
  venue, so parked.

### B9. CI and test infra

- **Fast local pre-push checks — LANDED #338 (2026-09-12).** The hook keeps sign-offs, the locked
  install, formatting, lint, the root guards and scoped typechecks, and runs no package tests at all;
  CI owns the package suites and their coverage thresholds, and `scripts/pre-push.test.mjs` is the
  fifteen-case fixture suite that now guards the hook's shell. **The consequence to watch:** CI's
  `changes` job is now the only thing that runs a package's tests, so a package a branch touched that
  CI did not select has been tested by nothing — read that job's `code`, `scope` and `packages`
  outputs before calling a branch green. On #338 itself every package job skipped on `code=false`,
  which was correct: it changed no file under `packages/` or `apps/`.

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
- **A fifth, with a real hypothesis this time: `test-dashboard`'s browser a11y suite fails on a stray
  `:hover` state left over from a prior test in the same shared browser page.** Seen three times the
  same day (2026-09-13), on two unrelated PRs, in code neither branch touched: `products-editor`'s CI
  run failed `dashboard-app.a11y.test.ts`'s recipe-screen heading-order case (job 103718734296); PR
  #350 failed `floor-screen.a11y.test.ts`'s "renders accessibly with empty lists" on a
  color-contrast check TWICE in a row across two separate pushes (jobs 103778327703 and
  103778897882), always the same element (`wt-button[data-add-zone=""]`), always the same colors
  (foreground `#fefefe`, background `#3f83ed`, ratio 3.66 against a 4.5 minimum) — and passed cleanly,
  8/8, run locally against the identical commit both times. `#3f83ed` is not a real design token
  (`--wt-color-primary` is `#1f6feb`); blending `#1f6feb` toward white at `--wt-opacity-hover: 0.85`
  (`packages/ui/src/components/wt-button.ts`'s `:hover` rule) lands almost exactly on `#3f83ed`. That
  matches axe capturing the button mid-hover rather than at rest — most likely a leftover pointer
  position from an earlier test in the same file, in a browser-mode suite that reuses one page across
  tests in a file. **Confirmed and fixed the same day, in #350 (landed 2026-09-13).** The colour is exact, not
  approximate: `#1f6feb` at opacity `0.85` over the light `--wt-color-bg` `#f7f7f8` is `#3f83ed` on
  every channel, and `#ffffff` composited the same way is `#fefefe`. The failure was reproduced
  locally by running a file that hovers a `wt-button` immediately before the untouched
  `floor-screen.a11y.test.ts` in one worker — the same one test of the eight failed, with the same
  element and the same two colours. The cursor turned out to belong to the shared PAGE, so it outlives
  the file that moved it, not just the test. `apps/dashboard/src/widgets/test-helpers.ts` now parks the
  cursor off-page before every test, via a `parkPointer` browser command in
  `apps/dashboard/vitest.config.ts`; guard `apps/dashboard/src/widgets/pointer-reset.test.ts`, receipt
  in [testing-guide.md](developers/testing-guide.md). **Two pieces are still open.** The
  `dashboard-app.a11y.test.ts` heading-order sighting is a different rule with no colour evidence, so
  nothing here explains it — treat it as still unexplained. And `packages/ui` and `apps/till` have the
  same harness with no reset, with `packages/ui/src/components/wt-button.test.ts` ending a test
  hovering a button, so the same flake is waiting there.
- **Comments across the tree still say PGlite cannot check a database permission** — the belief
  CLAUDE.md §4 corrected on 2026-09-13. PGlite's default connection holds every permission, but a
  session that switches to `app_user` (`asAppUser(tx)`) is refused anything that role lacks, column
  permissions included (receipt in `docs/developers/testing-guide.md`). Many test comments give the
  old belief as their reason for using a real PostgreSQL container, often citing "CLAUDE.md §4" by
  number, which now points at text saying the opposite. The ones in source files the onboarding
  corrections touched were fixed; that branch's dated plan still quotes the old belief in a code
  snippet and is left as written. Find the rest with `grep -rn "PGlite" apps packages scripts`. A
  sweep, not a one-liner: for each suite, check whether anything else still needs the container
  (concurrency, triggers running as the deployment role, or who connected) before moving it, and
  correct the comment either way.
- **`replication-arc`'s isolation was reverted** (vitest `projects` are incompatible with `--shard`);
  if it flakes on `test-server` it needs a `--shard`-compatible isolation. The step (4) flake seen on
  2026-09-14 matches a race instead (forcing that race reproduced the same symptom), fixed in #361 by
  waiting for the subscriber's apply worker to restart after the widen (receipt in
  [testing-guide.md](developers/testing-guide.md)). Isolation remains a guess for any other flake in
  that file.
- **Job-sharding levers:** `--shard` splits by FILE COUNT; bump `shard: [1..N]` and the denominator
  together with N at or below the file count; `mutation-verifactu` is the next critical-path
  candidate; rebalance `LIGHT_A/B_PACKAGES` when one light shard dominates.
- **Dependency loop removed — LANDED #348 (2026-09-13).** `pnpm install` no longer warns about
  cyclic workspace dependencies; `scripts/workspace-cycles.test.ts` fails if a loop returns. Of the
  four things the review raised and that PR did not take, two are now done on
  `chore/test-guards-tidy` (the English-only guard scans `packages/replication-tests`, and the root
  coverage-`include` comment now describes the rule instead of listing files); these two remain:
  - `packages/replication-tests` carries a coverage bar that cannot fail: it holds only test files, so
    coverage measures nothing and reads 0% while exiting 0. The literal exists because
    `scripts/coverage-thresholds.test.ts` requires one of every tested package. Fix if a second
    test-only package appears: teach that guard (and CI's `runnable` check) about test-only packages.
  - The loop guard reports the whole group of packages in a loop, not a path through it, so a failure
    does not say which link to cut. Optional: print one cycle path alongside the group.
- **A hung real-PG suite leaks its cluster containers** and `pnpm reap` only removes labelled ones
  older than two hours — inspect creation times and ownership, remove only your own.
- *Small:* `test-light` reports success without naming what it ran; `packages/ui` can hang the `test-ui` shard, cause unconfirmed; the classifier's `root=`
  output line is read by no consumer.

---

## Track C — smaller items

Each fits one sitting, and none needs a spec. Correctness first, then by area. A *Small* item that
turns out to need a design moves to its track.

**Correctness:**

1. **Two order verbs still read `working_orders` by id alone** (found 2026-09-14 while scoping
   `placeOrder`/`sendToPrep`, which now check the tenant). `cancelPlacedOrder` locks and updates by id
   (`apps/server/src/working-order.ts` `:3514`, `:3523`); `markCollected` reads and updates by id
   (`:3600`, `:3624`) and reads `ticket_items` by order id (`:3614`). `readLockedLines` (`:682`) takes
   no `cfg`; its one caller, `priceStoredOrder` (`:729`), is called from `till-sale.ts`, and those
   calls were not checked. Same class as the by-id rule in `CLAUDE.md`
   §3: write the two-tenant probe first, record what it does, then scope.
2. **A concurrent-corrective race in `settleSale` is untranslated** — a raw `P0001` from the coverage
   trigger with no `sale.*` code. Give the trigger a SQLSTATE and translate it when reachable.
3. **Location-scope the by-id verb family together** (`getHeldOrder`/`updateHeldOrder`/
   `abandonHeldOrder`, `updateTable`/`deactivateTable`/`openTab`) when multi-location lands.
4. **Nothing stops two queries being started at once on one transaction.** The rule and its receipt
   are in `docs/developers/conventions-data.md` under "Multi-table writes share ONE transaction"; no
   test or lint rule enforces it. A guard could fail a test whenever a query is issued on a
   transaction while another is still running. A search of non-test `apps/server/src` and
   `packages/*/src` on 2026-09-14, after `computeDailyClose` was made sequential, found no remaining
   `Promise.all` over one transaction: the rest read or delete files, call HTTP or storage
   services, close pools, or query through a pool.

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

- **An imported configuration no longer carries "already offered a passkey"** (fixed 2026-09-14).
  A configuration transfer no longer lets `passkey_offered_at` travel: it is stripped on export and
  the import refuses a bundle that still carries it, alongside the other person columns the transfer
  already leaves behind. Before the fix a person offered a passkey on the source box arrived on the new one holding no
  passkey but already stamped, so `shouldOfferPasskey` never offered again after they were reactivated
  and first signed in.
- **Timestamps across the printers and devices screens show UTC** — `formatIsoMinute`
  (`apps/dashboard/src/date-utils.ts:27`) slices the ISO string. One shared formatter, not a per-call-site patch.
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

**Payments:**

- Bound the HTTP body read as well as the header wait in `sumup-client.ts` (move `clearTimeout` after
  `res.text()`); lift `reverseViaStripe` and `reverseViaSumUp` into one neutral reversal primitive.
- Pre-existing `forward` retry backoff.

**Fiscal (each behind its own review, owner sign-off at land):**

- **The three alta builders are triplicated** — `recordSale`/`recordCorrection`/`recordSubstitution`
  in `packages/fiscal-verifactu/src/backend.ts`. Safe
  seam: a helper taking the assembled `Omit<AltaInput,"Encadenamiento">` plus a `buildDesglose`; needs
  a huella-invariance re-run across all three.
- Left behind by the RLS drop: `sales_assert_tenders_cover`'s "even though the definer sees every
  row" clause is false — thin on first change; `scripts/schema-equivalence-fold.test.py` is run by no
  gate.
- `tenant.not_found` has no production thrower — keep or remove is an owner call; `mirror-bundle.ts`'s
  `r.series ?? []` branch is un-exercised; export `ID_SISTEMA_MAX_LENGTH` when either package is next
  touched; `insertNodeSeriesTx`'s held-code check is SELECT-then-INSERT; `readStandardSeriesIdTx`
  filters by tenant while `readNodeEndorsement` documents the opposite; the SP-3d restore overlapping
  a live SIF registration deadlocks (`40P01`) — revisit locking before the hook runs live.
- Two stale lock-order claims in `apps/server/src/working-order.ts` (`unjoinTable`'s "MATCHES"
  docstring; `mergeTabs`'s "seq-scans" claim, which `EXPLAIN` contradicts). Thin on next touch.

**Product decisions to take before production:**

- The orphan drift gate holds a customer's money pending a human, unbounded — nothing re-sweeps a
  closed period.
- The €0 comped sale settles at the settlement instant, not backdated to `issued_at` — is a comp
  ever finalised long after the invoice printed?
- A human account always keeps an email (no remove-email action; `setEmail` rejects clearing) — the
  rule now, rather than a missing UI path.
- The duplicate purchase-invoice key `(tenant_id, supplier_tax_id, supplier_invoice_number)` is
  unique forever — per-year versus forever is the asesor's.

---

## Afterwards — the on-prem mirror, then the cloud primary

Not in any track until the standalone primary is done. Kept here so the decisions and residuals do
not get lost.

### The on-prem mirror

The mechanism is native Postgres logical replication (#280); the membership, promotion and rejoin arc
is complete (#197–#272); the two-node WireGuard fixture exists (#275). What remains, largest first:

- **Status, alarms and the operator surface for native replication** — numbers and alarms off
  `pg_stat_subscription` / `pg_stat_subscription_stats` / `pg_replication_slots.wal_status`; the SKIP
  runbook for a stalled subscription; a management route for the post-drain disable of a narrowed
  subscription; the standby-first migration check; **orphaned-slot reclamation** (`dropReplicationSlot`
  is tested and has no caller).
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
changes in `packages/sync`) was designed on the application outbox that #280 deleted; the fiscal
ledger now replicates as `ledger`-classified tables. Superseded — remove it once the owner confirms
nothing in its uncommitted diff is wanted.

### The cloud primary — back burner, docs only

Waitron Cloud itself; the control plane; cloud-only redundancy (a managed/HA Postgres host versus a
second cloud node); the cloud trial on-ramp; WireGuard on the box image and `@waitron/tunnel`'s
retirement; the cloud-standby end-to-end proof; first-contact trust bootstrap for an untrusted-network
primary. **Per-tenant cloud provisioning is not this repository:** Waitron Cloud — a separate
closed-source service, not started — spawns the instance, sets up WireGuard and hands back a URL and
credentials; this repo only ever *talks to* a provisioned instance. **Do not restart the cloud-standby
work until the Waitron↔Waitron-Cloud boundary contract is settled.** The proof to run then: on-prem
primary → adopt → mirror → human promotion → tills reroute to the promoted cloud → the venue sells
and files. [Box maintenance and remote support](superpowers/specs/2026-09-11-box-maintenance-and-remote-support.md)
is a discussion, not an approved spec; the
[cloud-services inventory](superpowers/specs/2026-08-29-cloud-services-inventory.md) catalogues the
paid offering. Remote-access bot protection (Cloudflare Turnstile on internet-facing login and
recovery, never in the local-only product) belongs to that offering.

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
- **Comment thinning on touch only** (CLAUDE.md §1); no sweep in any track.
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

- **One tenant per database everywhere, the cloud included.** A tenant is one taxpayer
  (`country` + `tax_id`; `packages/provisioning/src/tenant-id.ts` derives its id) holding all of its
  locations. The cloud is a dedicated instance per tenant, hosted in Spain. Density comes from many
  isolated instances per host. The only multi-tenant pieces are a small control plane and the
  preproduction trial demo.
- **Warm standby plus human promotion; active-active is shelved.** Nothing was deleted for it: branch
  **`shelved/active-active`** (= `main` at `c65d3cbe`, 2026-09-05) is the snapshot to return to.
- **Modules are core to the product** (opt-in domains, third-party modules later); fiscal is swappable
  by jurisdiction (Veri\*Factu / TicketBAI / none). New domains land as modules, and no new core table
  without a stated reason (CLAUDE.md §3).
- **Register and device are both kept.** A register (`tills`; UI "register"/"caja") is the drawer
  counted at close; a device is the screen. Several devices ring into one register.
- **Rerouting lives in the till web app** for every device kind; the device credential stays an
  httpOnly cookie. A native agent is built for hardware only, printing first.
- **No relay.** Replication rides the box↔own-cloud-instance WireGuard link; remote access is the
  instance forwarding the box's name down the link without terminating TLS.
- **Handheld kiosk mode is optional, never required** (owner, 2026-09-08) — most waiters use their own
  phones, so the baseline is an installed home-screen web app plus the till's staff PIN.
- **Comments carry invariants, not history** (CLAUDE.md §1). The coverage bar is negotiable with a
  reason.

---

## What's built (state per sub-project)

Architecture §2's twenty sub-projects, plus the cross-cutting infra. "Remaining" is the unstarted or
partial scope; the detail for a live thread is in its track.

| # | Sub-project | State | Remaining |
| --- | --- | --- | --- |
| 1 | Design system | `@waitron/ui` token layer + primitives (`--wt-*`); brand assets (#284); the till web-app manifest and its icons; the dashboard shell restyle — collapsible nav, account menu, profile modal (#333) | `wt-select` (A7) |
| 2 | Sales spine | Immutable hash-chained sales, per-tenant series, catalogue, tenant model | — |
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
| 18 | Menu/recipes/allergens | EU-14 allergens, recipe/BOM allergen inheritance, recipe-authoring UI (**withdrawn from the dashboard by #345**; declarations are now direct on the product), product images, location↔menu membership, modifiers and option groups, per-option and dish-line quantity, dietary classification, order-line customisation; departments and menus (#297) | counter/walk-up kitchen fire; menu draft/publish + schedule; customer-facing menu surface parked; nested sub-recipes / plate costing / stock depletion parked |
| 19 | Opening hours & channel sync | — | not started (Google Business Profile / Maps) |
| 20 | Procurement & inventory | received purchase invoices (`@waitron/purchasing`, feeds modelo 303) | suppliers/POs/goods-in/stock/3-way reconcile/reorder (parked); AI forecast deferred |

**Cross-cutting infra:** replication (native Postgres logical replication since #280) · membership,
promotion and rejoin (the arc is complete) · backup and restore (BR-1..BR-4 plus the wizard) · SIF
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
**Bizum** (research 2026-08-30: account-to-account through Redsys or a PSP, roughly 0.4–0.6% direct
versus Stripe's 4.99% + €0.40; SumUp has none; in person a dynamic QR works today and the NFC tap is
rolling out through late 2026; the architecture-picking question, unverified, is whether a SumUp or
Stripe Tap-to-Pay phone can accept a Bizum tap — resolve before designing any in-person Bizum UX).

---

## Detail

The long form for tracked items, so the tracks above stay readable.

### Setup wizard — what the walkthrough found (A2)

Owner walkthrough 2026-09-12. **All five findings below closed with #334**; they are kept only
because the reasoning behind each choice is worth having when the wizard next changes. What is still
open is under *A2* in Track A, not here.

1. *The certificate page tells a Spanish operator nothing about getting the file.* It says only
   "Upload the certificate file and enter its passphrase" and accepts `.pfx` / `.p12`
   (`apps/setup/src/screens/cert-screen.ts`). Getting to that file means exporting it from the Windows
   certificate store, the macOS Keychain, or Firefox's own store — each a different sequence of
   dialogs. Detect which system the browser is running on and show the steps for that one, the others
   behind a link. Screenshots only if somebody owns keeping them current.
   **Reopened and closed again 2026-09-13:** #334 detected the system but kept all three guides in
   one list with the match merely pre-opened, and the owner read that on a Mac as "a list of all
   available combos" — the first heading they met was Windows, above the open one. The match is now
   promoted out of the list, with the rest behind one closed disclosure, matching the certificate
   page. Pre-opening an entry inside a list of every entry does not read as detection.

2. *A mistyped address during setup gives a blank page.* The setup box serves the wizard at the
   origin root with no history fallback, so `/manage` (the dashboard's address once trading) answers a
   bare 404 (`mountSpa` in `apps/server/src/spa-api.ts`, mounted with no `navigationPath`). Redirect to
   `/` — not a catch-all serving `index.html`, which would hide a missing asset. Leave the API routes
   and `/assets/` as they are.

3. *The first operator's Password and PIN boxes have no way to see what was typed*
   (`apps/setup/src/screens/admin-screen.ts`), while the certificate passphrase already carries a
   reveal control and the dashboard carries the icon version with an action-specific accessible label.
   Use the dashboard's on all three so the wizard does not show two different reveal buttons.

4. *Every form mistake on the shop page produces the same sentence.* The banner lists every possible
   problem at once (`apps/setup/src/screens/venue-screen.ts`) and bad fields carry an `invalid` flag
   and nothing else. Say per field what failed — a tax ID not valid for the country, a postal code
   outside the chosen province, too few or too many invoice languages, two identical series codes —
   and leave the summary as a summary (the shared form contract, CLAUDE.md §3).

5. *The demo path demands real business details nobody will use.* The tax ID has to pass the
   country's validity check and the postal code has to match the province (`REQUIRED_TEXT_FIELDS` and
   `#next` in `venue-screen.ts`). For demo only: ask for the operator's own details plus the location's
   name and address, fill everything else with sensible made-up values they can change later. **The
   tax ID is generated, and it is a company one** (owner, 2026-09-12): both shapes are a checksum over
   the digits (`packages/country-es/src/spain.ts`), and the owner's example `B-4943574-6` comes back
   valid, `entity`, normalised to `B49435746` — the shape a restaurant holds. A generated number is
   safe only because a demo box files nothing, so the generator must never be reachable from Prepare or
   Live.

**Till name and the two series codes** (owner asked what they are and what may be typed, 2026-09-12):

- *"Till name" really is the till, not the filing identity.* It inserts a row in `tills`
  (`create-till`, `packages/provisioning/src/venue-plan.ts`). The node — the SIF that files to AEAT —
  is created alongside and named after the location; nobody is asked to name it. A `till`-form-factor
  device ALWAYS creates its own register named after the device (`createRegister`,
  `apps/server/src/device.ts`), so the wizard's register is left over unless a handheld claims it, and
  no dashboard screen creates a register. Prefill it ("Caja 1", which every seed uses) or drop the
  question and let the dashboard create registers. `applyVenue`'s completeness guard and the handheld
  binding (`requireLiveRegister`) both move with it.
- *The two series codes should be defaulted, not optional* — the plan always emits both
  `create-series` actions. Do not ask on the demo path.
- *What a code may contain.* The database takes any non-empty text, unique per node. On the wire it
  is joined as `<code>/<number>` (`formatInvoiceNumber`, `packages/core/src/record-sale.ts`) and the
  whole string must be 1–60 characters from `A-Z a-z 0-9 / _ . -` — our own deliberately narrow charset
  (`packages/verifactu/src/validate.ts`). The practical ceiling on the code alone is 38
  (`MAX_BASE_CODE_LENGTH`, `packages/fiscal-verifactu/src/reserved-series.ts`), because a cold restore
  appends `-<installation number>`.
- *What to default them to.* Avoid a trailing `-<digits>`: `stripOwnSuffixes` removes a trailing
  `-<number>` when that number is a registered installation number, so `Fa-1` comes back from a
  restore as `Fa-2`. Zero-padding misleads because the counter follows a slash. **`FS`** (factura
  simplificada — every till sale is `TipoFactura` F2) and **`FR`** (rectificativa) survive both.
- *Who changes a code.* In practice the system does (`deriveReservedSeriesCodes` on restore or
  standby activation). Nothing in the dashboard can change or add a series today.

**"What this location does" is the wrong question for a required tax-agency field** (owner, 2026-09-12).
Stored as `locations.operation_description` (`NOT NULL`, `packages/db/src/schema/tenants.ts`) and
copied onto every filed record as AEAT's `DescripcionOperacion` (at most 500 characters, no control
characters). The wording invites a description of the business ("Deli and coffee shop") where AEAT
wants the transaction — our fixture has the right shape, "Venta en establecimiento"
(`apps/server/src/testing/venue-fixtures.ts`). It is a constant filed on every sale, so it should be
Spanish regardless of invoice languages — a setting with a default. Both halves of that were settled
by #334: the default comes from the fiscal contribution rather than from the country, because
`DescripcionOperacion` is a Veri\*Factu field and not a country fact; and a manager can now change it
after setup on the dashboard's **Location invoices** screen, which applies to records filed from then
on and leaves records already filed alone. So the wizard's "You can change these later" is no longer
false for this field.

### Roles the admin can edit (A7)

A person's role is a PostgreSQL enum with four values (`packages/identity/src/schema/persons.ts:21`).
The seam is already right: no call site gates on a role string — every one asks for a PERMISSION and
one map turns a role into its set (`packages/identity/src/permissions.ts`) — and a session reads the
role from the database on each request, so an edited role takes effect at once. Roles and their
permissions become rows the admin owns, per tenant, with the four seeded as defaults; no compatibility
code.

The design turns on the **ladder**: a module contributes a permission by naming only the lowest role
that should hold it (`grantedFrom`, `packages/module/src/module.ts:64`) and identity spreads it
upward. A custom role has no position, so either every custom role declares where it sits, or the
module contract names a permission group instead. Pick one before writing schema;
`packages/composition/src/role-parity.ts` proves at compile time that the contract's roles and
identity's are one list, and whatever replaces the union keeps an equivalent tie. Then: who may edit
a role (`person.admin` plus nobody mints or widens beyond what they hold, and a venue is never left
with nobody who can administer roles); a role in use (deleting or narrowing one changes live
sessions on their next request); storage (a table in identity's own migration set with `tenant_id`
and a classification entry — never an enum, CLAUDE.md §2); names (built-ins are translated from
`roleName`, `apps/dashboard/src/i18n/domain.ts:180`, custom ones will not be).

### Incidents are written by several things and displayed by nothing (A5)

`openIncidents` (`packages/core/src/incidents.ts`) is the only function that reads the `incidents`
table, and nothing calls it — a whole-repo search outside tests finds only its definition and the
barrel that exports it. The diagnostics screen is a live log tail, a different thing. The producers
that write: the fiscal drain when AEAT rejects a record, the payments reconciler on drift, the Stripe
device provider, the card provider pool, and — since A1 — the chain-append seam when a record's
totals disagree with its own VAT lines. `apps/server/src/pass.ts` names its intended audience as
"an operator grepping `drain.complete` (or the `incidents` table directly)" — and a real venue's
operator has no terminal. One surface serving every producer, which is why it is not folded into A1: a
screen shaped around that branch's two arithmetic warnings would be the wrong shape for the ones
already waiting.

### Logging, diagnostics & one-touch bug report (A9; Slice 1 landed #192)

[Design](superpowers/specs/2026-08-31-logging-diagnostics-foundation-design.md),
[plan](superpowers/plans/2026-08-31-logging-diagnostics-foundation.md). Eventual vendor destination
is GitHub issues; for now a bundle only needs to be copy-pastable.

- **Slice 2 — one-touch bug report.** A `bug_reports` table (tenant-scoped, `local`, grants in its
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
`modules.json`; the exclusion set for the deeper change is `backup-staging/`, `restore-staging/`,
`logs/`, the per-hardware `instance.env` and `recovery.json`. Touches BR-2, BR-3 and the recovery
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
- **The box image carries the replication cluster settings and the WireGuard link:** `wal_level=logical`,
  `track_commit_timestamp=on`, `max_slot_wal_keep_size`, the `waitron_repl` bootstrap, and `pg_hba`
  admitting it only from the peer's WireGuard address.
- **Identity on a standby:** `persons` and `webauthn_credentials` are `state`, so a standby can
  authenticate the venue's people on failover; re-establishment is PIN-re-prompt v1.
- Later kiosk options, none built: Chromium `--kiosk` in the box image, Fully Kiosk resale for
  dedicated tablets, Android Management API enrolment as a Waitron Cloud feature.

### Replication, membership & failover — residuals (Afterwards)

**Mechanism (since #280):** every module classifies its tables `ledger` / `state` / `local`; the
table owner creates the `_ledger`/`_state` publications; a standby subscribes over the box↔cloud link;
promotion and return run on `pg_replication_slots` with the fence-LSN drain watermark; settings are
primary-wins by construction. A standby holds its full dormant identity from JOIN and promotion never
mints a chain.

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
[asesor-questions.md](compliance/asesor-questions.md) against the cloud-as-sync-root and server-as-SIF
designs (several assumed Waitron hosts the client's fiscal system) and add the three ROF hosting
questions from [cloud-storage-model §8a](superpowers/specs/2026-07-31-cloud-storage-model-design.md).
Q16 (operating from abroad) is closed by the Spain-residency decision; do not send it.

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

**Adding a new real-PG test package** (the shared-container rollout pattern, so it isn't reinvented):
`ProbeRole.inRole` takes `string | readonly string[]` (a multi-membership role is a plain `roles` entry,
no `setup` hook); `cloneTemplate` is exported from `lifecycle.ts` and validates its own identifiers, so a
package needing a fresh DB per test (a `describeEachTarget`-style seam) reuses it — `packages/db`'s
`harness.ts` `postgresTarget` is the reference (clone per test, track, drop all in `teardown()`);
`nextCloneName()` mints the shared clone-name; `useTemplateDb` covers one-clone-per-file. Template-key
naming is **`core_<schema>`** (self-describing about what it migrates, not the package name). Fork mode is
a **per-package call**: (a) the `@vitest/coverage-v8` cross-fork branch-merge bug needs `singleFork` where
a package runs under `pnpm -r` oversubscription; (b) a shared container is one cluster on a 100-connection
budget, so a package whose suites open many backends caps at `maxForks: 4`. `packages/db` is the
reason-(b) reference, `packages/payments` the reason-(a) one — but both carry the HIGH coverage bar, so
a new package that copies either config must set the `90/90/85/85` floor (CLAUDE.md §2), or
`scripts/coverage-thresholds.test.ts` fails it in the ungated `lint` job. Plan:
`docs/superpowers/plans/2026-08-19-shared-test-container.md`. A two-node replication suite uses
`packages/db/src/testing/two-node.ts`, or `two-node-wireguard.ts` when the link itself is under test.

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
