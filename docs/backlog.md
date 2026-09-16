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

Three faults were found on the way and fixed here, none of them part of the rework. A working order's
lines could be read and priced without checking which tenant they belonged to, on the path that files
a sale — a two-tenant probe had another tenant receive a priced basket for an order it did not own,
and it had been that way since August. A photo used only by a variant was counted as unused by the
image library, so the list and the detail view disagreed about whether it could be deleted. And *Add
product to menu* on the venue screen published another product's variants, or none: the offer was
created for the product read from the page at save time while the variants came from state seeded off
an unfiltered list against a filtered dropdown. The server refused the mismatched write, so nothing
corrupt was ever stored — but the offer was created empty, the refusal reached only the browser
console, and the product could not then be sold.

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
  trap is unchanged: **a populated development database still has to be reset by hand.**
- **Category authoring serialises across the whole database, and nobody has measured what that
  costs.** Hierarchy edits, membership replacement and category deletion all take the same single
  advisory lock, keyed on the constant `"categories"` (`packages/catalogue/src/categories.ts`), which is
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
  dropped into fixed plural sentences (`categories.delete_warning_products`,
  `categories.delete_warning_children_under`, `categories.delete_warning_children_top`,
  `categories.add_selected` in `apps/dashboard/src/i18n/strings.ts`), so one product or child reads
  "Al eliminarla se quitará de 1 productos", "Sus 1 categorías hijas se moverán …" or "Añadir 1
  productos", and the English is just as wrong. The plural sentences predate #362; the three
  `delete_warning_*` keys are the delete-confirmation strings after #366
  consolidated the old `delete_products`/`delete_children_*` lines into one warning (the plural bug
  came along unchanged). **Next action:** give each a one-item form, or use a plural-aware formatter
  if the dashboard adopts one.
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
  thumbnails render at their full natural size and allergen badges as unstyled text. Confirmed on
  the real page again on 2026-09-16, during #378's run-it verification — the
  thumbnails came out at the picture's own size (256×256 in the development data) instead of the
  40×40 the screen's own `.thumb` rule asks for. It predates that branch, which does not touch the
  file. The fixed sibling `apps/dashboard/src/screens/categories-screen.ts` shows the shape to copy
  (`part=` attributes), and `CLAUDE.md` §3 already names this exact defect. **Next action:** move
  those cell styles onto `part=` attributes the way the categories screen now does, with a test that
  reads a painted size or colour back rather than asking whether a class exists.
- **Nothing stops the next screen making the same mistake.** A check that compares the class names a
  screen's own stylesheet styles against the class names it puts inside `wt-data-table` cell callbacks
  looks feasible and would catch this whole kind of bug; nobody has tried to write it.

**Categories screen rebuilt — LANDED #353 (2026-09-14).** The `/manage/categories` page is now a
table you can switch between a tree (children nested under their parent, collapsible) and a flat
list, with a name filter that keeps a match's parents visible. A category can have a colour, picked
from a palette or chosen freely, shown as a square beside its name and as a coloured tag
(`wt-lozenge`) on up to three of a product's other categories; a larger set is shown as a count but
remains searchable by every category name. Each category opens a window listing its products, and
you can add many products at once from a checkbox list. Two behaviour changes came with it: a
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
  _Superseded 2026-09-16 (#370):_ `choice-form.ts` renders no allergen list of its own any more — it
  delegates to the shared `dashboard-allergen-dietary-picker` widget, so the duplication is gone.
- **The independent review did not cover the browser and rendering paths.** Claude's run-it reviewer
  worked to a bounded brief and said so; what it did run found a real repricing bug — reordering
  unchanged selections on a held order repriced an extra from 1.00 to 9.00 — which was fixed by
  comparing saved answers by value rather than by their order in the payload. The browser, receipt and
  kitchen-rendering evidence comes from the build's own focused tests plus CI's package suites, not
  from a second pair of eyes. Worth knowing before anyone treats those paths as double-checked.

**Product selling units — LANDED #342 (2026-09-13).** You now say what you actually sell a product
by — by the each (the default when you choose nothing), or by weight or volume: grams, milligrams,
kilograms, millilitres, litres, or a unit you invent yourself — and how many decimal
places its quantity may have (0 to 3, where 0 means whole numbers only). A price is always a price per
that unit: choosing grams after pricing per kilo does not convert anything, it just means the number
now reads as a price per gram. Units get their own dashboard page, and a new venue is seeded with the
five weight-and-volume units above (grams, milligrams, kilograms, millilitres, litres); Each is the
implicit default for a product with no unit, not a seeded unit, so a product may have no unit at all —
it simply shows as Each and is never stored. Editing or deleting a seeded unit survives provisioning
running again, because a durable marker records that seeding already happened. Deleting a unit is refused while any product
uses it, including products that are switched off, and the refusal names the products. Renaming a unit
or changing its precision is allowed while it is in use: new quantities follow the new rule and
quantities already recorded keep the unit name and precision they were sold under, frozen onto the
order line and carried through park and resume, the kitchen screen, the receipt and any reprint.
[Design](superpowers/specs/2026-09-12-product-units-design.md),
[plan](superpowers/plans/2026-09-12-product-units.md).

**Update (2026-09-15) — units abbreviation and screen rebuild.** Every unit now carries a second
translatable text, its **abbreviation** (a short form such as `kg` or `ml`), alongside its full
name. The abbreviation is what prints wherever a quantity is shown — so the label frozen onto a
sold line and printed on the receipt, the kitchen ticket and the till is now the **abbreviation**,
not the full name the paragraph above describes; the full name shows only in the dashboard and in
the product-editor dropdown (as `Name (abbr)`). The frozen `unit_name` column is presentation only
and does not enter the fiscal hash (proven by the huella tests). The units page was rebuilt onto the
shared table conventions — the Add button sits at the header, the table has its own search and a
precision filter, row actions are left-aligned, and the last sort and filter are remembered per tab;
its old "Decimal places" field is now labelled **Precision** and shows the value as the locale's
decimal marker followed by that many zeroes (`,000` in Spanish, `.000` in English). The seeded
minority-language unit names are drafts pending owner confirmation. (The seeded `each` unit has since
been dropped: a product's unit is now optional and a product with no unit simply shows as Each,
never stored.)
[Design](superpowers/specs/2026-09-14-units-screen-and-abbreviation-design.md),
[plan](superpowers/plans/2026-09-14-units-screen-and-abbreviation.md).

**Update (2026-09-15) — a product's unit is optional, and a unit lists its products — LANDED #375.**
A product no longer needs a unit: leaving the editor's unit on **Each** stores no unit at all, and
the seeded `each` unit was dropped, so a venue seeds only the five weight/volume units and Each is
the implicit default. On the units screen, clicking a unit's row opens the products that use it, and
the bulk-reassign target now includes **Each (no unit)**, which empties a unit so it can be deleted.
Reassigning a weight product to Each also flips its stored `pricing_unit` to `each` — the two were
out of step, a bug the run-it review caught against a real database.
[Design](superpowers/specs/2026-09-15-optional-product-unit-design.md),
[plan](superpowers/plans/2026-09-15-optional-product-unit.md). The Spanish reassign-to-Each label was
reworded from "Unidad (sin unidad)" to "Por unidad" (owner, 2026-09-15); the product editor's own Each
option stays "Unidad", which parallels its noun neighbours (Kilogramo/Mililitro). Left open (small,
unowned): `createProduct` and `updateProduct` still duplicate the legacy-`pricingUnit` fallback, so a
shared helper would keep the two from drifting; and the synthetic `EACH_UNIT` id lives as a literal in
both `packages/catalogue/src/units.ts` and the till's `product-name.ts` with nothing pinning them equal.

**Update (2026-09-16) — clicking a unit row is now a delete, and precision is a dropdown — LANDED
#382.** Clicking a unit's row on the units screen still does the same thing it did before — it lists
the products that have to be moved onto another unit before this one can go — but it now says so:
the row's accessible label and the dialog heading both read Delete unit, instead of inviting the
reader to view products. The `units.view_products` wording was removed in both languages. The
sentence saying a unit is still in use is now painted in the danger colour, and the list of units to
move those products onto is sorted by name in the reader's own language, with Each (no unit) above
it. In the unit editor, Precision stopped being a number you type and became a dropdown offering 0
to 3; reopening an existing unit now shows that unit's own precision, because every `<option>` marks
itself with `.selected` — a `.value` binding on the `<select>` alone runs before the options exist,
which is the trap `CLAUDE.md` §3 records. The two small items above stay open: #382 touched only
`apps/dashboard`, so nothing in `packages/catalogue` changed.

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
  table with `55000` — the fix gave it a primary key, now created by
  `packages/catalogue/drizzle/0000_catalogue_baseline.sql`. The design doc's older deletion paragraph is marked superseded rather than rewritten.
  LANDED #350 (2026-09-13).
- **Nothing checks that a table shared by replication has a primary key.** #350 found
  `product_units` publishing its rows with only a unique constraint, which makes Postgres refuse every
  UPDATE to it (`55000`), and the in-memory test database does not enforce that, so no test noticed.
  `CLAUDE.md` §3 now states the rule and says outright that no guard enforces it. Nobody has checked
  whether any other published table has the same shape. **Next action:** a root guard beside
  `scripts/classification-complete.test.ts` that migrates every set and fails on any published table
  without a primary key — proven by removing `product_units`' primary key from
  `packages/catalogue/drizzle/0000_catalogue_baseline.sql` and watching it fail.

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
_Superseded 2026-09-15 (#377):_ the modifier "invalidate a claim" model above is gone — a modifier
choice no longer stops the till and kitchen calling a dish vegan. Each product and each choice now
states its own positive `suitableFor` list, shown independently; the app no longer combines a dish
with its extras. Product-level direct allergen/dietary declarations are unchanged.

_Superseded 2026-09-15 (the product editor rework, below):_ "a translated name and optional
description" no longer describes a product. A product's Name is plain staff-facing text; the
translated name became a separate, optional customer-facing name, and a kitchen name sits beside
both. The long stack of cards described above is now a short form with collapsible sections, and the
station and course that used to save on their own now save with the product. The rest of the entry —
menus, variant pricing, the till, the frozen sale facts, nested creation — still stands.

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
_Superseded 2026-09-15:_ the modifier nutrition redesign removed the Yes/no modifier type entirely —
the server now rejects it — so the Yes/no wording behaviour described above no longer exists. The
three types are Text, Extras and Options. See
[the redesign](superpowers/specs/2026-09-15-modifier-nutrition-redesign-design.md).

What it left open:

- ~~A keyboard-driven reorder says nothing to a screen reader.~~ **Closed by the product editor
  rework** (the entry below; the same branch). The drag, the arrow-key move and the announcement were
  extracted out of `modifier-form.ts` into a shared `ReorderController`
  (`apps/dashboard/src/widgets/reorder-table.ts`), which renders a polite live region and names the
  moved row and its new position after a key press. Both the choices table and the new variants table
  use it, so the choices table gained the announcement it was missing.

**Modifier nutrition redesign (pass 1) — LANDED #377 (2026-09-15).** Each modifier choice now carries
its own simple nutrition information, and the app no longer combines a dish with its chosen extras. The
redundant Yes/no modifier type is gone (the three types are Text, Extras and Options, enforced by a
`option_groups_type_ck` check). A choice's allergens are one "contains" list — the separate "removes"
list and the two unused origin lists were dropped from `option_group_items` (everywhere, including the
`operations.ts` menu resolver). The negative "no longer suitable for" dietary control became a positive
`suitableFor` list over vegan, vegetarian, halal and kosher, stored in a new `dietary_suitability`
column. The waiter basket and the kitchen/expo screens now show each item's own allergens and diet as
text instead of a combined "as-served" figure. The dashboard editor shows one Allergens list and a
four-item Dietary preferences checklist under a renamed "Nutritional information" section, and a
modifiers-list row now opens a "products that use this modifier" modal (like Categories). Fiscal records
are unaffected — the allergen/diet values never enter the invoice hash. Migrations `0027_drop_yes_no_type`,
`0028_drop_option_item_allergen_overrides`, `0029_dietary_suitability`.
[Design](superpowers/specs/2026-09-15-modifier-nutrition-redesign-design.md),
[plan](superpowers/plans/2026-09-15-modifier-nutrition-redesign.md),
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

**Modifiers screen rebuilt — LANDED #370 (2026-09-15).** The `/manage/modifiers` page now uses the
same shape as the rebuilt Categories screen: one full-width search box with a **Type** filter, a
table that remembers your last sort and filter for the browser tab and first sorts by name A–Z, and
an **Add modifier** button in the header instead of a round plus. Clicking a modifier's name opens a
read-only details panel with **Edit** and **Close**, showing allergen and dietary information only
for the choices that actually set it. The whole-modifier **Available** switch is gone for Text,
Extras and Options — those are turned on or off per choice, or by detaching the modifier from the
product — and only **Yes/no** keeps a modifier-wide switch; to match that, availability is now read
consistently so a stored, disabled Extras/Options modifier can no longer block a sale. Deleting a
modifier now shows the products and menu items it affects, then detaches it from them and deletes it,
refusing only while an open order still uses it — the Categories delete flow. Migration `0012` makes
that possible by flipping two menu foreign keys (`menu_item_option_groups.group_fk` and
`menu_item_options.option_fk`) to cascade; a real-Postgres test proves both flips were needed because
Postgres checks the second immediately. In the choice editor, allergens and dietary preferences are
now picked with the shared dashboard multi-select (the new `allergen-dietary-picker` widget), and the
"contains" vs "may contain" selector and the "reviewed" toggle are removed **for modifier choices**: a
choice that adds an allergen records it as *contains*, and a choice with no dietary labels chosen
simply has no dietary effect. Nothing on the till or in the product editor changes beyond what the
shared shape requires.
[Design](superpowers/specs/2026-09-14-modifiers-overhaul-design.md),
[plan](superpowers/plans/2026-09-14-modifiers-overhaul.md).
_Superseded 2026-09-15:_ the modifier nutrition redesign dropped the Yes/no type, so no modifier
keeps a modifier-wide switch — every modifier is now offered as a whole and availability is per
choice. It also replaced the negative "no longer suitable for" dietary control with a positive
"suitable for" list over vegan/vegetarian/halal/kosher, and stopped the till and kitchen screens
combining a dish with its extras. See
[the redesign](superpowers/specs/2026-09-15-modifier-nutrition-redesign-design.md).

What it left open:

- **The read-only details panel is built inline in the screen (~130 lines).** Every other modal in
  this area is its own widget, so this is the odd one out. **Next action:** extract it into a
  `dashboard-modifier-details` widget, the way choice editing became `dashboard-choice-form`.
  _Superseded 2026-09-15 (#377):_ the read-only details panel was removed — a modifier row now opens a
  "products that use this modifier" modal instead — so there is nothing left to extract.
- **Removing "contains / may contain" and the "reviewed" toggle stopped at modifier choices.** This
  branch built the shared `allergen-dietary-picker` widget and adopted it for choices only. Products,
  ingredients and the till still carry the old contains/may-contain distinction and the reviewed
  toggle. **Next action:** a separate change adopts the same widget there and decides what the removed
  distinction means for a product's own claims and for what the till withholds — it is not a
  mechanical copy, because a product declaring "may contain" is a real statement in a way a modifier
  choice's was not.

**Modifier tables and nutrition editing refined — LANDED #385 (2026-09-16).** Clicking a modifier's
row used to open a Products table with a second Menu items table stacked under it when there were
any. It is now one table listing both, with a **Type** column you can sort and filter (Product /
Menu item), one search box over the lot, and a name sort A–Z by default; a row's key is
`type:id`, so a product and a menu item that share an id are still two rows. The delete
confirmation keeps its two separate tables, and keeps its own search wording for each
(`modifiers.search_products` / `modifiers.search_menus`) rather than calling both "Search products",
which is what the shared helper used to do. In the modifiers list, the **Choices** column stopped
being a number and became the choice names themselves, in the reader's own language, and it is
searchable — so you can find a modifier by a choice inside it. That column's header in Spanish
changed from "Nº de opciones" to "Opciones" to match. The row menu's header reads **Actions**
instead of **Edit**, because it holds more than editing.

In the choice editor, the Nutritional information section now opens expanded instead of collapsed,
and its two lists are summary-first: Allergens and Dietary preferences each show what is chosen as
plain text ("None selected" when nothing is), with an **Edit** button that swaps the summary for a
multi-select combobox and moves focus into it. Leaving the combobox closes it back to the summary.
Dietary preferences stopped being a row of native checkboxes and became the same combobox the
allergens use, which is what gives both a consistent keyboard and screen-reader path. The closed
combobox names the single choice when one is picked and a count when more are — "3 seleccionados"
for allergens and "3 seleccionadas" for dietary preferences, which agree in gender with the Spanish
nouns they count. `wt-combobox` only reaches that count label above one selection, so neither string
can produce the "1 seleccionados" fault recorded further up this file.

What it left open:

- **Two different summary-first shapes now sit in the same dashboard.**
  `dashboard-allergen-dietary-picker` has exactly one consumer,
  `apps/dashboard/src/widgets/choice-form.ts`, and after this branch it summarises each field on its
  own with an Edit button beside it. The product editor reaches the same goal a different way: a
  separate widget, `dashboard-allergen-picker`, sits inside a `wt-disclosure` whose heading carries a
  joined summary of every nutrition value, so the whole section collapses rather than each field.
  Neither is wrong, but a manager moving between the two editors meets two interaction patterns for
  what reads as the same task. **Next action:** whoever takes the already-open item above — adopting
  the shared picker for products, ingredients and the till — picks one of the two shapes for both
  rather than leaving the choice to whichever widget a screen happens to import.
- **The picker collapses on `focusout` alone.** `#finishEditing` returns the field to its summary
  whenever focus leaves the combobox, with no other way to close it and nothing distinguishing focus
  moving inside the component's own popup from focus leaving it altogether. The branch's Chromium
  tests pass, so if this is wrong it is wrong only on a path they do not walk — a touch interaction,
  or a popup implementation that moves focus. **Next action:** if a reviewer or a real user reports
  the editor snapping shut mid-selection, make the collapse depend on `relatedTarget` rather than on
  the event alone.

**The product editor reworked — LANDED #379 (2026-09-16).**

A product's **Name** is no longer translated. It is plain staff-facing text, and it is what the
dashboard, the till's buttons and basket, an open table's line list and the sales reports show. Two
optional names sit beside it: a **customer-facing name**, translated, which the printed receipt uses
— what goes to AEAT is the venue's single configured operation description, never a line's name —
and a **kitchen name**, plain text, which the kitchen ticket and the kitchen screens use. Each falls
back to Name on its own when left blank. A variant now carries the same three names plus its own
image, and a variant's name is appended to the product's with a middot — `Coffee · Large` — with
each half falling back independently. All of that resolution lives
in one file, `packages/catalogue/src/product-presentation.ts`. The developer guide's table of which
surface reads which name is the place to check before adding a new one.

The editor itself is now a short form: the fields you change often are always visible and the rest
fold away behind a section header showing a summary of what is inside it (Kitchen, Descriptors,
Nutritional info). A section holding an error opens itself and cannot be closed until the error is
fixed. Variants are a real table with drag and arrow-key reordering, a per-row Available switch and a
row menu, and each variant is edited in its own small window. Categories now open the same picker the
Categories screen uses, in a modal, instead of the editor's own controls.

Two behaviour changes came with it. **A product's kitchen station and course now save with the
product**, inside its one transaction, instead of being written the moment you picked them — so
Cancel really cancels, a rejected station rolls the whole product back, and you can route a product
as you create it. And **a product has no variants or at least two**: the first *Add variant* turns the
plain price into a variant named "Regular" and opens the window for the second, removing down to one
folds the price back, and the server refuses exactly one outright with
`product.variant_count_invalid` so
an API caller cannot reach a state the editor will not allow. Two new shared primitives came out of
it, `wt-disclosure` and `wt-price-input`. Pre-production, so the columns were dropped and recreated
rather than migrated (CLAUDE.md §3): `packages/db` migrations `0030`–`0031`; the catalogue side was
folded into the catalogue set's regenerated baseline when #378 rebased onto this work. [Developer guide](developers/products.md), [operator guide](products.md),
[design](superpowers/specs/2026-09-15-product-editor-rework-design.md),
[plan](superpowers/plans/2026-09-15-product-editor-rework.md).

What it left open:

- **A variant's image has no foreign key, unlike a product's.** `products.image` carries a real
  `ON DELETE RESTRICT` reference to `media_images` (declared in the media set's baseline,
  `packages/media/drizzle/0001_media_baseline_sql.sql`); `product_variants.image` is a plain text
  column (`packages/catalogue/drizzle/0000_catalogue_baseline.sql`). The image library still
  refuses to delete a photo a variant uses, because `listImageUsages` and `deleteImage` both scan
  that column — but that is application-level protection only, and any delete path that skips
  `deleteImage` is not stopped by the database. **Next action:** decide whether the variant column
  should get the same foreign key the product column has.

- ~~**This branch added tenant predicates that #378 deletes.**~~ ~~**A manager can
  still clear another tenant's category routing.**~~ **Both settled on #378, which
  rebased onto this work.** The tenant predicates this work added to `readLockedLines` and
  `readTabLines` (`apps/server/src/working-order.ts`) and to `setProductStation`/`setProductCourse`
  (`apps/server/src/kitchen.ts`) went with the column itself, and so did the probes written against
  them. There is no second tenant left to clear anything of: `tenants`
  holds one row, pinned to id 1 by its primary key and by `tenants_singleton_ck`
  (`packages/db/src/schema/tenants.singleton.pg.test.ts` refuses a second row on real PostgreSQL).

- **A product's name can be stored blank.** `products.name` is `NOT NULL` with no non-empty check,
  and only the editor's own parser refuses a blank; `createProduct` writes what it is given.
  `option_groups.name` and `option_group_items.name` share the pattern. **Next action:** decide
  whether the columns want a check constraint and the write paths a domain refusal.

- **The legacy product-id order path loses the configured kitchen name.** `AvailableProduct` carries
  no kitchen name, so a line added by product id freezes `kitchen_name` as null; `resolveHttpOrderZone`
  sends all three line-carrying routes down that branch when a venue has no service zones. The
  supported menu-offer path is unaffected, and the developer guide now says so rather than claiming
  the name appears everywhere. Pre-existing. **Next action:** either carry the field on that path or
  leave the narrowed claim standing.

- **A refused customer name cannot say which value it refused.** `content.translation_required`
  carries only the language, so the editor resolves the offending field by reading the body it just
  submitted — exact for one missing value, the first of several otherwise, so two bad variants take
  two saves to clear. Adding an optional field to that error would fix it but changes a shipped
  error's contract for consumers that do not need it. **Next action:** an owner call if it ever
  bites.

- **Server response shapes are no longer mirrored by hand where it mattered** (dashboard product
  shapes and till sell-side shapes both done). The dashboard imports the product wire shapes from
  `packages/catalogue/src/product-types.ts`; the till now imports the SELL-SIDE shapes from a second
  browser-safe leaf, `packages/catalogue/src/menu-types.ts` — `MenuOffer` and its parts,
  `AvailableProduct`, the resolved-option shapes and `AccessibleCatalogue` are the one authoritative
  copy. The till's `TillMenuOffer` and `TillMenu` are now type ALIASES of catalogue's `MenuOffer` and
  `AccessibleCatalogue` (imported type-only, zero runtime), so the till's DECLARED offer shape can no
  longer diverge from catalogue's `MenuOffer`: removing or retyping a field the till reads is now a
  compile break, not a silent runtime shape error (an added field the till ignores is not — the shared
  type checks the declared shape, not the server's exact serialized keys). That ended real drift — the
  old hand mirror had dropped a per-option `suitableFor`, marked required fields optional, and read a
  `pricingUnit` that `MenuOffer` does not model. (The server does still send `pricingUnit` on the offer
  body, but the till does not need it — an offer-derived product always carries a full `unit`, which is
  what it weighs from — so `menuOfferToTillProduct` no longer copies it.) Both leaves are guarded as
  type-only by `scripts/dashboard-browser-purity.test.ts`. `TillProduct` and its
  `TillOptionGroup`/`TillOptionItem` sub-shapes deliberately stay till-LOCAL: `TillProduct` is built
  from an offer and from a retrieved order line (not received as one wire shape), and the option
  sub-shapes could be aliased to catalogue's resolved-option types the same way — a follow-up this
  change did not take.
  What is still a hand-written local mirror, by the bundle-decoupling rule and a separate, lower-risk
  concern from the drift-prone product shapes: the sale-result and till-info response shapes
  (`TillSaleResult`, `TillInfo`, …) in `apps/till/src/api/client.ts`.

- ~~`operations.ts` throws an error code whose registry it does not import.~~ **Done.**
  `createProduct`/`updateProduct` in `packages/catalogue/src/operations.ts` now throw the
  catalogue-owned `product.invalid` (registered in the package's own `errors.ts`, which the file
  already imports) for a malformed `unitId`/`pricingUnit`, instead of `@waitron/server-kit`'s
  `management.request_invalid` — the same code the sibling product-editor path
  (`product-editor-input.ts`) already threw for those fields. This closes the CLAUDE.md §3 breach
  (the catalogue no longer throws a code whose registry it cannot import) and makes the two
  product-write paths consistent.

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

The same shape, from a different deletion: the outbox removal (#280) deleted
`apps/server/src/sync-origin.test.ts`, and comments across the tree still describe the capture-origin
machinery it proved. Some name the deleted file outright as where the proof lives (`recipe-api.ts`
also cites `packages/sync/drizzle/0000_sync_baseline.sql`, which the same PR deleted); the rest
describe a "sync-origin node id" threaded so that enrolled writes capture a real origin, which no
trigger does any more. The scope is every comment that still treats a captured origin as something
the application records. Neither obvious grep bounds it on its own: some comments cite the deleted
suite obliquely rather than by filename, so searching for `sync-origin.test.ts` finds only part of
them, while searching for "sync origin" also returns the MIRROR's sync origin — the primary's node id
a replica pulls from — which is a live concept and must not be swept. All of them are on `main`
today, so they predate #378; found while reviewing that branch. Same treatment as
above — one pass, not a sweep.

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

**Printer paper width, resolution and character set — LANDED #367 (2026-09-14).**
The Edit-printer dialog now asks for a printer's paper width (58mm or 80mm), print resolution
(180dpi or 203dpi) and character set (WPC1252, PC858 or plain ASCII), each stored as a column on
`printers` and defaulted to match the owner's TM-T88III. The receipt, payment slip, kitchen ticket
and correction slip all format to the column count and dot pitch those settings imply, instead of
the old fixed 42-column, 203dpi assumption. The fiscal QR on the receipt is now a raster image whose
dot size is chosen per receipt to land as close as possible to the legal 30-40mm printed size,
rather than the printer's own built-in QR command. Print test page in the printer editor sends a
page exercising all three settings and opens a dialog for its answers. [Design](superpowers/specs/2026-09-14-printer-paper-resolution-and-character-set-design.md) ·
[Plan](superpowers/plans/2026-09-14-printer-paper-resolution-and-character-set.md).

**Setup refinements — LANDED #380 (2026-09-16).** Add opens a prefilled naming dialog;
identifiers are read-only; test answers use radio buttons with QR measuring instructions. Successful
addition and refresh failures have separate feedback. Printed test instructions use the user's
language. Development servers no longer advertise `waitron.local`; a laptop/box name collision was
confirmed during investigation. Configured text initialization now cancels
Kanji mode before sending single-byte text, as documented by the NT-806 manual.
[Design and incident evidence](superpowers/specs/2026-09-16-printer-setup-refinements.md).

- **The NT-806 needs another physical test page**, and nobody has printed one since the change.
  Until someone does, we cannot say the Kanji-mode cancel is what fixed the garbled accents that
  printer produced earlier — the change matches what its manual documents, which is not the same as
  having watched it work. Next action: print a test page from the printer editor to the NT-806 and
  read the accented characters on the paper.
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
- The kitchen ticket's per-layout formatting dedup (`kitchen-print.ts`) is byte-invisible, so no test
  guards its loss — removing it would enqueue identical bytes with nothing failing. Not a correctness
  risk; a spy on `formatKitchenTicket` would pin it if it is ever worth doing.
- A long single-token manual card reference wraps as "Ref." alone with the token split across the
  following lines, and a 61-character invoice number splits over three lines at 58mm — both stay
  within the column count and are correct, just awkward to read.
- No committed test proves `app_user` can WRITE the three new `printers` columns — the schema test
  only inserts with their defaults. A real-PostgreSQL upgrade probe run during review did confirm the
  write works; a committed grant-write assertion is still owed.
- No test covers `updatePrinter` receiving an explicit `undefined` for one of these settings — today
  both Drizzle and `updatePrinter` silently drop it, same as an absent field.
- The invalid-value error code is tested for 3 of the 6 field × route combinations these settings
  offer, matching this file's existing convention for `transport`/`ticketScope`.
- The QR preview decoder's format-information reader reads an inverted level-Q QR as level M — not a
  false pass with any data seen so far, but worth tightening.
- `PC858_HIGH` (the character set's upper half) is pinned at 18 of its 128 positions in the committed
  tests; a reviewer verified the full table against Python's `cp858` codec, but that check itself was
  never committed.
- Cleanup follow-up (simplify review at #367): a "wrap this text and push each line to the builder"
  closure is hand-written six times across `receipt-ticket.ts`, `payment-slip.ts`, `kitchen-ticket.ts`
  and `test-page.ts`, plus a label/amount-row variant twice. Factoring one helper into
  `@waitron/printing` would let all four drop their local closures. Not done at land time to avoid a
  cross-cutting refactor of fiscal receipt code.

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

**Designed 2026-09-14:** [dashboard alerts](superpowers/specs/2026-09-14-dashboard-alerts-design.md) —
one bell, panel and Alerts screen for recorded incidents and live checks (backups, fiscal submission,
printing, reader battery). Build order: (0) split `till.configure` into permissions named for what
they guard — **LANDED #363** (2026-09-14), adds `layout.configure` / `venue.configure` /
`system.manage` with no access change, and the alerts work uses `system.manage` for backup alerts; (1)
the alerts framework and recorded incidents — **LANDED #368**
(2026-09-15): the bell, its panel, the Alerts screen with Open and Handled tabs, the
pop-up for new alerts, and wording for every recorded incident code; (2) the ongoing checks — **LANDED
#371** (2026-09-15): backups, fiscal submission and the awaiting-certificate pause, print agents and
printers, and reader battery. The printing codes shipped as `agent.silent` and `printer.jobs_waiting`,
not the spec's provisional `printing.*` names, to match the printing package's existing code families.
They can still be renamed cleanly (one commit, no deprecated alias). The never-rename rule protects a
code already saved where it can't be edited, and these two are worked out live on each dashboard read:
only the check (`apps/server/src/alert-sources.ts`), its wording and the printing code list name them,
and nothing writes them to `incidents` or browser storage (by reading, 2026-09-15). That stops holding
once a venue is live or anything starts saving them. Precedent: `series.not_found`, renamed twice
(`packages/db/src/errors.ts`).
The questions below are answered there; the notes stay as the origin of the item.

What branch 1 surfaced, each checked by a whole-repo grep on 2026-09-14:

- **Every ongoing alert code is now worded in both languages** (branch 2) in
  `apps/dashboard/src/i18n/alert-messages.ts`. The guard `scripts/ongoing-alert-codes.test.ts` fails if
  a code an ongoing source raises has no English and Spanish sentence, so a real ongoing alert can no
  longer fall back to the generic sentence with the raw code beneath it.
- **The fiscal reconcile sweep has no production caller.** Only `acks.test.ts` and
  `reconcile.test.ts` import `packages/fiscal-verifactu/src/reconcile.ts`, and the package's
  `index.ts` does not export it. Its `fiscal.reconcile_*` incidents are worded, but nothing in
  production raises them.
- **A payment incident marked handled without being fixed does not come back.** The daily payments
  check (`apps/server/src/reconcile-duty.ts`) covers each day once, and asks for a day to be checked
  again (`resweepAfter`) only when it found a payment that was both an orphan and a drift. The alert
  wording says so rather than promising a later check.
- **Nothing in production raises `clock.degraded` or `clock.jump_detected`.** `createTrustedClock`
  (`packages/fiscal/src/clock.ts`) has only test callers. `record-sale.ts` records a warning when a clock
  reading carries one, but no clock that production passes to it is built by `createTrustedClock`.

Two halves, one branch each (owner decision 2026-09-12).

- **A reader for `incidents`.** (Branch 1, LANDED #368, added one: `listOpenIncidents` and
  `listHandledIncidents`, read by `apps/server/src/alerts.ts`. What follows describes `main` before
  it.)
  `openIncidents` is the only read and nothing calls it, while the
  fiscal drain (AEAT rejections), the payments reconciler (drift), the Stripe device provider and the
  card provider pool all write. Design questions: its own screen or part of diagnostics; who may see
  it (fiscal versus money); acknowledge or only observe. Detail under *Detail → Incidents*.
- **A notification surface for the dashboard** (owner-raised 2026-09-08). First consumer: "2 devices
  tried to join in the last 10 minutes" when pairing mode is shut. Then: a stalled fiscal outbox, a
  print agent that stopped pulling, a stuck job past its lease, a failed or stale backup, a low reader
  battery, later a standby that has fallen behind. Decide scope first: toast versus a persisted
  per-person inbox, `state` versus `local`, push versus poll. (Branch 1 settles these: a pop-up
  toast; handled state shared by the whole venue in the `incidents` table; incident changes pushed to
  the dashboard through the `incidents` change source, plus a one-minute refresh for the ongoing
  checks. The ongoing-check consumers — a silent agent, a stopped or lagging fiscal outbox, a missing
  certificate, print jobs stuck at a printer, a low reader battery, and backups off, failing or stale
  — LANDED #371. Still not built: the pairing consumer, and a standby that has fallen behind.)

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
- **Seven dropdowns still bind `.value` alone over options from a list, but none is known to show
  the wrong choice today** (2026-09-14; read, not run). Each binds `.value` on a `<select>` whose
  options come from a `.map(…)` and marks no option `selected` — the shape that showed "Downstairs
  bar" on the till while it sold from Deli counter, fixed by #365 (CLAUDE.md §3). Found by a text scan, checked by
  hand: `apps/dashboard/src/screens/my-schedule-screen.ts:393`, `:407`, `:459`,
  `apps/dashboard/src/screens/units-screen.ts:456`, and
  `apps/till/src/screens/till-schedule-screen.ts:390`, `:404`, `:457` (plus the doneness picker in
  `apps/till/src/widgets/line-extras-editor.ts`, due for removal below). By reading, every one opens
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
- **Remove the built-in doneness picker; doneness becomes a modifier the venue adds itself** (owner
  decision 2026-09-14). The built-in picker is unreachable today: the till shows it only when
  `products.diet.contains` includes `meat` (`isMeatProduct` in
  `apps/till/src/widgets/line-extras-editor.ts`), and since #345 nothing in the dashboard writes that
  field — the old product form that could is no longer mounted, and recipe editing left the
  dashboard. On the dev database on 2026-09-14 all 45 products had an empty `contains` list. Venues
  already have the tool: an options modifier (#341) whose choices are rare … well done, attached to
  the products that need it. **Next action:** remove doneness end to end — the `doneness` enum and
  its column on `working_order_lines` and `ticket_items` (`packages/db/src/schema/orders.ts`,
  `ticket-items.ts`; schema change, no data migration), `working_order.invalid_doneness` and its
  validation in `apps/server/src/working-order.ts`, the doneness line on kitchen tickets
  (`kitchen-ticket.ts`, `kitchen-print.ts`), the till's picker, label and store field, and the
  note/doneness test in `packages/fiscal-verifactu/src/write-path.e2e.test.ts` (which proves those
  fields stay out of the invoice hash; keep the note half). The line note stays. Check first that an
  options modifier prints prominently enough on a kitchen ticket to replace the upper-cased doneness
  line.
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
- **The "backups off or stale" reminder** — LANDED as dashboard alerts (#371), which also flag a
  destination whose last attempt failed. Still open: when a nightly report job exists, the backup slot
  should fire after it.
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

- ~~**The `tenant` command is unplanned.**~~ **Closed 2026-09-14.** There is no `tenant`
  command — `waitron-provision` offers `keyring`, `instance`, `status` and `venue`
  (`packages/provisioning/src/cli.ts`) — and the guard the item asked for exists as
  `assertNoForeignTenant` (`packages/provisioning/src/tenant-guard.ts`), shared by all three
  taxpayer-creating paths.
- **Every credential reader checks the fields it uses — decided 2026-09-15, code waits for
  #378.** Reading a credential (`getCredential`/`tryGetCredential`,
  `packages/credentials/src/store.ts`) does not re-check it against `PURPOSES`, and stays that way:
  a secret saved under an older field list comes back with the new field missing. The owner chose
  this over refusing the read, because refusing would stop every venue holding that kind of secret
  (card payments, for a Stripe field) the moment a field is added, even where the reader does not
  need it, and would turn SumUp's deliberately optional affiliate fields into required ones. The
  tax-certificate, Stripe and SumUp readers already refuse a missing field they need. Two do not,
  and are the work: `apps/server/src/email-delivery.ts` passes `url`/`from` on with `!`, and
  `apps/server/src/node-identity.ts`'s `readNodeIdentityKey` casts a missing `privateKey`
  `as string`. Both should raise `server.credential_unusable` naming the field, as
  `apps/server/src/stripe-account.ts` does, each with a failing test first. The rewrite it was
  waiting for is done: #378 took the tenant parameter out of both functions
  (2026-09-14), so this is unblocked. Unchanged by this decision: `rotate` re-checks every secret against the current list, so an out-of-date one
  still stops a key rotation until it is re-entered (commented above `rotateCredentials`).
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
  pools left open. Trading mode's version awaits the live change listener's startup and its close
  without catching a failure. From reading the code these are believed not to reject today; that has
  not been tested.
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
  (2026-09-14). `assertNotAhead` (`provisioning.database_ahead`) runs AFTER `ensureInstance`
  migrates (`apps/server/src/node-entry.ts:483-505`), so an ahead database meets the migration first
  and surfaces something like a `42710` from the driver. #378 regenerated eleven
  module baselines, so more existing databases are now ahead of an older image than before. A box
  operator has no terminal — the recovery page is their only window — so a raw driver error leaves
  them nothing to act on. **Next action:** run the ahead check before `ensureInstance` migrates, or
  classify what the migration throws when the journal is ahead.

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

- **Fast local pre-push checks — LANDED #338 (2026-09-12).** The hook keeps sign-offs, the locked
  install, formatting, lint, the root guards and scoped typechecks, and runs no package tests at all;
  CI owns the package suites and their coverage thresholds, and `scripts/pre-push.test.mjs` is the
  fifteen-case fixture suite that now guards the hook's shell. **The consequence to watch:** CI's
  `changes` job is now the only thing that runs a package's tests, so a package a branch touched that
  CI did not select has been tested by nothing — read that job's `code`, `scope` and `packages`
  outputs before calling a branch green. On #338 itself every package job skipped on `code=false`,
  which was correct: it changed no file under `packages/` or `apps/`.

- **A merge could get no CI run at all, and nothing was red — LANDED #384 (2026-09-16).** Every run
  for a ref shared one concurrency group, and GitHub keeps only ONE run pending per group: a newer
  push cancels the one already waiting. The `docs(backlog)` commit that follows every merge was
  therefore evicting the merge's own run whenever the previous merge's run was still going, so that
  merge got no unfiltered suite and no image. #380 is the one that surfaced it, because it happened
  to be the newest code merge; its image was republished by re-running the cancelled run. Each push
  now runs in a group of its own, and — since two `main` runs can now overlap and a registry tag is
  last-write-wins — the publish job asks `scripts/main-tag-guard.sh` whether a newer commit already
  holds `:main` before moving it. **What is still open:**
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

---

## Track C — smaller items

Each fits one sitting, and none needs a spec. Correctness first, then by area. A *Small* item that
turns out to need a design moves to its track.

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
  files for one taxpayer (`packages/fiscal/src/backend.ts`), and the field reaches `apps/server`'s
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
  So the two screens disagree for those few hours every night. `today()`'s own comment already flags the UTC choice and
  defers the fix. **Next action:** seed the range from the venue's business day, the same value
  Overview renders, rather than from a UTC date.
- **An imported configuration no longer carries "already offered a passkey"** (fixed 2026-09-14).
  A configuration transfer no longer lets `passkey_offered_at` travel: it is stripped on export and
  the import refuses a bundle that still carries it, alongside the other person columns the transfer
  already leaves behind. Before the fix a person offered a passkey on the source box arrived on the new one holding no
  passkey but already stamped, so `shouldOfferPasskey` never offered again after they were reactivated
  and first signed in.
- **The login screen's automatic passkey attempt can show "Something went wrong, try again" on load**
  (seen 2026-09-14 while taking screenshots for the dashboard alerts branch; the same happens on
  `main`, so it is not that branch's bug). Playwright's headless Chromium 149 refuses the attempt
  with a `NotSupportedError`; installed Chrome 153 left it pending with no error. Whether a real
  person's browser ever hits it is untested. Mechanism: the attempt's `catch`
  (`apps/dashboard/src/screens/login-screen.ts:709-716`, from #305) stays quiet only for
  `NotAllowedError` and `AbortError`, and `codeOf` (`packages/dashboard-kit/src/codes.ts:38-40`)
  returns any `code` it finds, so a browser error's old numeric `code` (9 for `NotSupportedError`)
  wins over the fallback and, matching no registered message, shows the generic sentence. The
  passkey button's `catch` (`:672-674`) has the same flaw. **Fix direction:** the automatic attempt stays silent on every browser-side failure, and
  `codeOf` accepts only a string code (check its other callers first). Seen again on 2026-09-16
  while running #378 for real: the red banner is there on a clean first load of the
  login page, before anyone types anything. It predates that branch — the swallow list it comes from
  is on `main`.
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

**Reads the database does not need:**

- **`readImage` asks the database for the same row twice** (`packages/media/src/images.ts:199`). It
  selects the image row, then calls `listImageUsages` only to take the `.length` of what comes back,
  and that function opens by re-reading the same row by id just to get its filename. Handing it the
  filename `readImage` already holds would turn five queries into four. Pre-existing: the same call
  is on `main` with a tenant argument (`git show origin/main:packages/media/src/images.ts`, line
  227). Found while reviewing #378.
- **Checking one product's translations takes a lock and re-reads the language configuration once
  per value** (`packages/catalogue/src/content-languages.ts:13-27`). `validateContentTranslations`
  takes the `content-languages` advisory lock and reads the one-row configuration on every call, and
  callers call it inside loops: once per modifier choice
  (`packages/catalogue/src/modifiers.ts:106-109`), once per variant
  (`packages/catalogue/src/variants.ts:115`), and twice for a single unit create
  (`packages/catalogue/src/units.ts:85-86`). That is the shape `CLAUDE.md` §3's "resolve shared
  catalogue data once before a basket's line loop" rule exists to prevent. Pre-existing: the same
  lock-then-read is in `main`'s copy of the file, with a tenant argument
  (`git show origin/main:packages/catalogue/src/content-languages.ts`, lines 13-19); this branch only
  dropped that argument. Found while reviewing #378.

**Payments:**

- Bound the HTTP body read as well as the header wait in `sumup-client.ts` (move `clearTimeout` after
  `res.text()`); lift `reverseViaStripe` and `reverseViaSumUp` into one neutral reversal primitive.
- Pre-existing `forward` retry backoff.

**Fiscal (each behind its own review, owner sign-off at land):**

- **The three alta builders are triplicated** — `recordSale`/`recordCorrection`/`recordSubstitution`
  in `packages/fiscal-verifactu/src/backend.ts`. Safe
  seam: a helper taking the assembled `Omit<AltaInput,"Encadenamiento">` plus a `buildDesglose`; needs
  a huella-invariance re-run across all three.
- ~~Left behind by the RLS drop: `sales_assert_tenders_cover`'s "even though the definer sees every
  row" clause is false.~~ **Closed 2026-09-14.** `packages/db/drizzle/0034_drop_tenant_id_after_sql.sql`
  replaces the function with `CREATE OR REPLACE`, and the body a database built today actually runs
  carries neither that clause nor the "tenant-consistent FK" one (read back from `pg_proc.prosrc` on
  2026-09-16). The two sentences survive only in `0001_db_baseline_sql.sql`, which is an applied
  migration and is never edited. Still open from the same row:
  `scripts/schema-equivalence-fold.test.py` is run by no gate.
- `tenant.not_found` has no production thrower — keep or remove is an owner call; `mirror-bundle.ts`'s
  `r.series ?? []` branch is un-exercised; export `ID_SISTEMA_MAX_LENGTH` when either package is next
  touched; `insertNodeSeriesTx`'s held-code check is SELECT-then-INSERT; the SP-3d restore overlapping
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
- The duplicate purchase-invoice key `(supplier_tax_id, supplier_invoice_number)` is unique
  forever — per-year versus forever is the asesor's.

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

- **One tenant per database everywhere, the cloud included, and the schema carries no tenant
  column** (2026-09-14; the column removal LANDED #378, 2026-09-16). A tenant is one taxpayer
  (`country` + `tax_id`), held as the single row of
  `tenants` with its `id` pinned to 1, owning all of its locations. Nothing filters a query by a
  tenant; a query that wants "this tenant's rows" reads the table. Spec:
  [drop-tenant-id](superpowers/specs/2026-09-14-drop-tenant-id-design.md); guard
  `scripts/no-tenant-column.test.ts` (text-matching, and blind to test files and to the historical
  core migrations it exempts). The cloud is a dedicated instance per tenant, hosted in Spain. Density comes from many
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
sessions on their next request); storage (a table in identity's own migration set with a
classification entry — never an enum, CLAUDE.md §2); names (built-ins are translated from
`roleName`, `apps/dashboard/src/i18n/domain.ts:180`, custom ones will not be).

### Incidents are written by several things and displayed by nothing (A5)

_2026-09-15: branch 1 of the dashboard alerts LANDED (#368) and added the reader this paragraph asks
for; the paragraph describes `main` before it._

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
