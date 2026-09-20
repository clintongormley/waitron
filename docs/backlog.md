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

**Specified, implementation deferred (owner, 2026-09-20): menus, reusable categories and home
layouts.** [Design](superpowers/specs/2026-09-20-menus-categories-and-home-layouts-design.md):
ordered categories containing products and other shared categories, optional organisational groups,
menu price overrides, immutable menu publication, and menu-owned home layouts for handhelds and
tills. Shared edits flag affected menus; each live menu changes only when republished, apart from
live availability. **Do not start implementation until the PostgreSQL-to-SQLite work, dependency
upgrades, and variants/extras-as-products changes have all landed.** Then reconcile the integration
questions in the spec with the landed code before planning. Further specifications can be written
during the wait.

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
- ~~**The Products list has the same styling bug, and nobody has fixed it.**~~ **Closed by #387
  (2026-09-16).** #353's QA first saw it on the real page, in code that branch did not touch
  (`apps/dashboard/src/widgets/product-list.ts`): product thumbnails rendered at the picture's own
  size (256×256 in the development data) instead of the 40×40 the screen asked for, and allergen
  badges as unstyled text. #378's run-it verification confirmed it again on 2026-09-16. The rebuilt
  list styles every piece of markup it puts in a cell through `part=` attributes and
  `wt-data-table::part(…)` rules, the way `categories-screen.ts` already did, and two of its tests
  read a painted value back (`getComputedStyle` on the thumbnail frame and on a badge) rather than
  asking whether a class exists.
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

**Category colour and membership layout — LANDED #383 (2026-09-16).** Two presentation fixes on the
categories screen and its form. The colour picker used to lay its twenty-four swatches out as one
wrapping row, which broke a hue's three tones across a line break whenever the dialog was narrow.
The swatches now sit in two blocks of four hues, each hue a column of its three tones: one 8 x 3
matrix when there is room, two 4 x 3 blocks when there is not, and no hue ever split. That layout
reads meaning into the palette's order, so the order is now pinned by a test
(`packages/ui/src/category-color.test.ts`) that lists all twenty-four values; the palette itself was
not changed, only guarded. In the products table, a product's other memberships used to render one
coloured tag each, so a product in many categories produced a row of tags wide enough to crowd out
the rest of the row. Four or more now collapse to a localized count
(`categories.other_categories_count`); three or fewer still show as tags. Searching that column is
unaffected, because its `searchValue` reads every other-category name straight off the product and
never looks at what the cell drew. The count sentence is plural in both languages and cannot hit the
plural-for-one fault recorded in the #340 list above: it is only ever reached above three.

What it left open:

- **Three is a hardcoded number with nothing behind it.**
  `OTHER_CATEGORIES_PREVIEW_LIMIT` in `apps/dashboard/src/screens/categories-screen.ts` was chosen to
  look right at the column's current width, not measured against it, and the same table on a phone
  has far less room than the number assumes. **Next action:** if the column looks crowded or empty on
  a real screen, measure before changing it, and consider deriving the limit from the available width
  rather than pinning another guess.
- **The collapsed count tells you how many, not which.** A manager who wants to see a product's full
  membership list has to open the product's category editor; the table offers no hover, tooltip or
  expansion. That is a deliberate omission rather than an oversight, but nobody has watched anyone use
  it. **Next action:** leave it until someone using the screen asks for the names back.

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

- **Two ways to attach a modifier to a product — CLOSED, 2026-09-19.** Both `optionGroupIds` and
  `modifierIds` are gone from the product POST/PATCH body and from the editor body; a request sending
  either is refused, naming the field. What replaced them is one ordered `modifiers` list of
  `{ kind, id }`, written to `product_modifiers`
  (`docs/superpowers/plans/2026-09-18-modifiers-extras-options.md`, Task 6 Step 4). The old
  `product_option_groups` table and the code reading it survive until Task 13 of that plan, but
  nothing writes them through a route any more.
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

**Modifiers become Extras and Options — IN PROGRESS, thirteen pull requests.** The single "modifier"
idea is being split into two: Extras (reusable lists of products, each pick becoming its own sale
line) and Options (reusable lists of labels, saved as a note on the dish line). A product composes
both through one ordered attachment list. Design:
[one product model](superpowers/specs/2026-09-18-one-product-model-design.md); plan:
[modifiers to extras and options](superpowers/plans/2026-09-18-modifiers-extras-options.md). The
plan's Tasks 1 to 4 have landed — a `sold_alone` flag on products (#412), option lists (#436): the
two tables, the authoring and order-time rules, the reads and writes, and five refusal codes;
serving those lists over the management API under `/management-api/modifiers/options` (#445, the
plan's Task 3); and extras lists (#449, the plan's Task 4): `extra_lists` and `extra_list_items`,
the authoring and order-time rules, the reads and writes, and the price rule — a menu's price, else
the list item's, else the product's own, with VAT always the product's. An extras list names
PRODUCTS, so an item on it owns no price, VAT, allergens, photo or name of its own. The plan's
Task 5 has landed too (#452): the per-menu publication, `menu_item_extra_lists` and
`menu_item_extra_items`, with `setMenuItemExtraLists` writing what one offer carries and the
projection `readMenuExtras` reading it back with every price already resolved. A per-menu item row is
an OVERRIDE and not a publication — an item of the list with no row is still offered at its own
resolved price, and `available: false` is what withdraws it — which is the opposite of
`menu_item_options`, where a row's presence is the publication.

The plan's Task 6 has landed too: `product_modifiers`, the one ordered attachment list a product
carries, holding an extras list or an options list per row; `writeProductModifiers` and
`readProductModifiers` behind it; the product write body's flat `modifierIds` and `optionGroupIds`
replaced by that ordered `modifiers` list, with a body still sending either old field refused by
name; six management routes for extras lists under `/management-api/modifiers/extras`, mounted by
the same `mountListSurface` helper the options block now uses; `readProductExtras`, which reads
what a product itself carries with no menu offer in the question; and `setMenuItemExtraLists`
refusing to publish a list the dish's product does not carry. What is still missing is the SCREEN:
the product editor's attachment section was removed rather than rebuilt, and no dashboard screen
shows either kind of list — that is the plan's Task 11.

The plan's Task 7 has landed too (#462), so the ORDER path is now the new one. An extras pick
becomes its own child order line carrying the PICKED product on `working_order_lines.product_id`,
at the price the offer set for it and at that product's OWN vat class; an options answer is frozen
as names and no ids in a new `working_order_lines.option_snapshots` column; and
`modifier_snapshots` and `option_group_item_id` are gone from that table (core migration 0040).
Five routes take the new `extras` and `options` fields on a line — the walk-up sale, the park, the
held-order edit, the tab round, and the integrated card pay on its walk-up branch — and every
consumer is converted with them: the kitchen ticket, the station and expo screens, the tab line
list, the held-order read, transfers and splits. The legacy ordering path had to go in this task
rather than in Task 13, because the spec gives the wire field name `options` to the new shape and
that field carried the old payload; one field cannot carry both and this repository keeps no
compatibility code. TWO CONSEQUENCES WORTH KNOWING BEFORE ANYONE OPENS A DEV TILL: `apps/till`
still sends the legacy `{optionGroupItemId}` shape, so a line carrying a legacy modifier now
answers 400 rather than being ignored (reaching it takes a product with a legacy option group
attached, and the dashboard can no longer attach one); and the till's read surfaces, which look
for a child line by a NULL product, no longer recognise one. Task 12 wires the till. The next task
after Task 9 is Task 10, which takes doneness out end to end and seeds a "Cooked" options list in
its place.

Task 8 has landed too, as #465. This is what it changed. It took the preserve path's comparison out of
`updateHeldOrder` into two named functions — `sameOptionSelections` and `matchExtraChildren`
(`apps/server/src/modifier-selection.ts`) — and made both sides order-independent. The defect that
paid for it, measured on both halves: a manager who REORDERS a dish's attachment lists leaves every
parked line holding the old order, the comparison read that as a changed answer, and a quantity-only
edit then deleted every line, re-issued it under a new id and re-priced the dish at today's menu
price. The extras comparator answers the pairing of picks to stored child lines rather than a
boolean, because the update moves each child's quantity and the two sides are no longer in step —
the plan called it `sameExtraSelections` and had it answer a boolean, which the caller would have had
to pair up a second time under a rule that could then disagree with it.

Three things the review found, each measured rather than read:

- **A dish that offers one product on two lists can be billed at the wrong list's price.** Two
  halves, found a round apart and with different histories. The run-it seat found the first by
  running: one product offered by two of a dish's lists at two prices, one pick parked off the 1.00
  list and two off the 3.00 one, then the two picks swapped over. Nothing on a stored child says
  which list offered it, so a pairing knowing only the product and the quantity matched each pick to
  the OTHER list's row, the edit was preserved, and the diner went on paying 7.00 where the new
  answer costs 5.00. That half is the branch's OWN regression — the seat ran it against `main` and
  got 5.00, because the index-wise comparison saw the quantities move at each position. The scoped
  re-read then found the sibling: ONE pick moved from the 1.00 list to the 3.00 one, which is not a
  duplicate at all. Measured in a checkout of `main` at `68e36c6aa` with the same fixture, that one
  bills 1.00 there too — pre-existing, and the index-wise comparison never caught it either.
  `matchExtraChildren` now refuses the pairing whenever a PICKED product is offered by more than one
  of the dish's ACTIVE lists. The cost is not confined to the refused line: the replacement path
  rewrites the whole order, so every line loses its id and its price lock — re-priced from today's
  offers, which changes the number only where an offer has moved.
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
- **The mechanism the branch first wrote down was a third of the story, and the correction of it
  was two thirds.** THREE columns hold parts of the offered order, each re-numbered from a save's
  body: `product_modifiers.sort`, `extra_list_items.sort` (the items within one extras list, which
  is the order that list's picks come back in) and `menu_item_extra_lists.display_order`. The first
  round of prose named only the first; the correction named the first and third and asserted the
  third was unreachable, which is true of it and not of the second — `PATCH
  /management-api/modifiers/extras/:id` reaches `writeItems`, as does the `POST` that creates a
  list. What is single-homed, in `docs/developers/modifiers.md`, is the TABLE — each column beside
  what writes it and which routes reach it. Everywhere else states the rule and points there.
- **"A rename replaces the line" is only true of an OPTIONS list.** An extras child is compared by
  the picked product's id, so renaming an extras list or the product itself disturbs nothing.

Task 9 — a dish's frozen answers on the FILED sale line — is the plan's next one and has not
landed yet. This is what it changed. `sale_lines.modifier_snapshots` is replaced by
`sale_lines.option_snapshots` (core migration `packages/db/drizzle/0041_magenta_metal_master.sql`),
and both filing routes now put a dish's frozen answers there: a walk-up off the basket the sale was
priced from, a retrieved order off `working_order_lines.option_snapshots` through `readLockedLines`.
The customer's paper receipt prints one `<list>: <label>` line indented under each dish, built by
`customerOptionSnapshotLabels` (`apps/server/src/option-snapshot-labels.ts`) beside the
kitchen-facing twin the kitchen ticket already used. `apps/server/src/modifier-snapshot-labels.ts`
goes with the field it read.

What that task carried with it:

- **The column it replaced was already write-only and always empty, so the diff is smaller than it
  looks.** Read out of the tree at `a7dd1993a`, not run: production code never SELECTed
  `sale_lines.modifier_snapshots` — `sale_lines` is only ever inserted into (the three writers in
  `packages/core`) and the one production query that reads the table is the top-sellers report,
  which asks for `name` and `variant_name`; the receipt's own answers came off the PRICED lines and
  never off the row. Nor could any PRODUCTION path put anything in it: both places that could have
  filled it defaulted to `[]` (`packages/catalogue/src/pricing.ts`), and nothing set either —
  `priceLockedLines` stopped supplying one when Task 7 dropped the working-order column it copied
  from, and no `apps/server` route ever built a basket item carrying one. The only non-empty values
  the column ever held were written by `@waitron/core`'s own tests, each passing a list through
  `sale-line-rows.ts` and reading it straight back: `record-sale.test.ts`,
  `record-correction.test.ts` and `record-substitution.test.ts` all do this.
- **The fiscal gate passed unedited.** `packages/fiscal-verifactu/src/write-path.e2e.test.ts` gained
  "the extras/options rework leaves the fiscal fingerprint byte-identical": one basket — a dish
  carrying an options answer plus a priced extra as its own child line — files the same huella,
  `ImporteTotal` and `CuotaTotal` as the same basket filed on `main`, where the block records the
  three literals as taken at `2ae3baa98`, before any of this branch's code existed. Each literal was
  written into the file once and never touched again on the branch
  (`git log -p a7dd1993a..HEAD` over that file shows one `+` line per value and no `-`), and the
  suite passes on the branch as it stands:
  `pnpm --filter @waitron/fiscal-verifactu test write-path -- -t "byte-identical"`, 1 passed. The
  block also records its own control, run here: moving the child line's VAT rate from 10% to 21% and
  touching nothing else moved both `CuotaTotal` and the huella, while `ImporteTotal` stayed put —
  it is `sale.total` copied verbatim (`ImporteTotal: sale.total`,
  `packages/fiscal-verifactu/src/backend.ts`), the caller's declared figure rather than anything the
  lines add up to. So the control shows the fixture can see a moved VAT RATE. It does NOT show what
  a moved line AMOUNT would do — the probe left both `lineTotal`s exactly where they were — so
  `ImporteTotal` being independent of the line amounts is read off that one line of `backend.ts`,
  not run. Either way, one of the three literals is pinned against the caller's declared total
  instead of against the basket.
- **A bilingual venue could have had the wrong language printed on a receipt, and the test that
  should have caught it passed either way.** `customerOptionSnapshotLabels` looked its name maps up
  by exact key. A frozen answer is keyed by bare content language ("es", "en") — the catalogue's
  customer map is copied through whole and each staff name is widened under the venue's default
  content language — while the receipt asks with the invoice locale, normally a full tag such as
  "es-ES". With two content languages configured the lookup therefore always missed and printed
  whichever language the stored map happened to list first, so an English receipt could print the
  Spanish answer. Worse, a map kept because it holds text in ONE language can be blank in another,
  and the blank was printed: with `{"en":"","es":"Tamaño"}` and `{"en":"  ","es":"Grande"}`, an
  `es-ES` receipt printed `":   "` and both Spanish names vanished off the paper. Fixed by resolving
  through `resolveSnapshotText` (`packages/shared/src/content-languages.ts`), which is the resolver
  the receipt's own product names already go through, called the same way. The reason the suite was
  green: the receipt fixture keyed every name map with a full tag, so every exact-key lookup hit and
  the tests passed whether the code resolved a locale or not. The fixture is now keyed the way a
  real filed line is keyed, and the negative control was run when the fix landed (`d527cd819`):
  with that fixture and the old exact-key code, the English-receipt case fails with the Spanish
  answer on the paper.

What option lists left open, none of it taken in #436 or #445:

- **`dependants` now fills both of its sides, and both of them through `product_modifiers`.** An
  options list has no per-menu publication row at all, so `optionListDependants`
  (`packages/catalogue/src/options.ts`) reads the products that carry the list, then walks the same
  attachment rows on to `menu_items` for the menus. The two queries repeat the same `option_list_id`
  condition rather than sharing one predicate; nothing can drift from it yet, because
  `options.in_use` is still thrown by nothing. **Next action:** whoever writes a refusal that uses
  the same condition shares it then — the modifier code this replaces already learned that lesson
  (`openOrderUse` in `packages/catalogue/src/modifiers.ts`).
- **`options.in_use` is registered and nothing throws it.** Deleting a list is designed to cascade
  its product attachments rather than be refused, so there may never be a thrower. It stays
  registered because a shipped code is never removed.
- **The option and extras route blocks now share one mount helper; the old modifier block is still a
  third hand-written copy.** A review on #445 asked for the helper (the pattern is `mountCourseVerb`,
  `apps/server/src/till-api.ts`), and Task 6 wrote it. `mountListSurface` in
  `apps/server/src/catalogue-api.ts` is that helper: it mounts all six routes for one kind of list —
  read and create on the collection, read, update and delete on one list, and the delete preview —
  and each of the two call sites hands it only what differs (the path segment, the `shared.invalid_id`
  kind name, the two JSON keys, and the six catalogue functions). What is left is the old
  `/management-api/modifiers` block, which the spec retires and which still spells its own six
  handlers out; the entry below is the one that covers it.
- **Nothing schedules the deletion of the old `/management-api/modifiers` routes.** Spec §11 says the
  options and extras routes replace them, but no task in the plan lists `apps/server/src/catalogue-api.ts`
  as a file it deletes from — Task 13's file list does not name it. Until that is fixed, the old
  routes survive the plan, and so does the ordering requirement #445 had to comment on: BOTH the
  option-list block and the extras-list block must be registered ahead of
  `/management-api/modifiers/:id`, or `:id` swallows the literal word `options` or `extras` and the
  collection read answers 400 instead of 200. `mountListSurface` states the hazard once and each of
  its two call sites carries its own measurement of it, both re-run after the helper was extracted.
  **Next action:** add the route removal to Task 13, or state that the old routes stay.
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
  from a different answer.
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
  Units entry above already warns about. **Next action:** whoever builds Units decides which column
  answers "is this sold one at a time" and makes both paths read it.
- **The till's own wire is now refused, not just ignored.** `apps/till/src/state/order-line.ts`
  still builds `options: [{ optionGroupItemId }]`, and the server's options contract accepts only
  `{ listId, labelId }` keys — so a basket line carrying a legacy modifier is answered
  `options.invalid` naming `optionSelections.optionGroupItemId` rather than being priced. It takes a
  product that still has a legacy option group attached to reach it, and the dashboard can no longer
  attach one (Task 6 removed that section), so a fresh venue cannot; a dev database seeded before
  that change can. **Next action:** Task 12 rebuilds the till's picker and basket over extras and
  options; until then, reset a dev database rather than debugging a 400.
- **A filed sale now carries its options answers, and the receipt prints them** (Task 9, slices C
  and D). A walk-up files them off the priced basket and a retrieved order off
  `working_order_lines.option_snapshots` via `readLockedLines`; the customer receipt prints one
  `<list>: <label>` line under each dish, each side taking its customer text and falling back to the
  staff name (`customerOptionSnapshotLabels`, `apps/server/src/option-snapshot-labels.ts`, beside the
  kitchen-facing twin). `apps/server/src/modifier-snapshot-labels.ts` is deleted. Still not reachable
  from the till, which sends no answers until Task 12.
- **`modifierDependants(...).orders` is always 0, and `deleteModifier` no longer refuses.** An open
  order line has no column that could name a legacy modifier or one of its choices, so the refusal
  and the count that fed the dashboard's delete confirmation had nothing left to find. The whole
  file goes with Task 13.
- **The till's READ surfaces go blank too, not just its send side.** The server renamed the frozen
  options answers from `modifierSnapshots` to `optionSnapshots` on four wires — `TabLine`,
  `StationQueueItem`, `ExpoItem` and `HeldOrder.lines`, all declared in
  `apps/server/src/working-order.ts` — while `apps/till/src/api/client.ts` still declares
  `modifierSnapshots?` on its own copies of those types. Nothing crashes: the till's
  `modifierSnapshotLabels` helper (`apps/till/src/widgets/modifier-snapshot.ts`) defaults its
  argument to `[]`, so an absent field simply renders no answers. `apps/till/src/api/client.ts:652`
  declares the same stale `modifierSnapshots?` on its mirror of the server's `TillSaleLine`, which
  Task 9 slice D renamed to `optionSnapshots`; the till therefore shows no answers on its own settled
  ticket either, while the PAPER receipt prints them. The screens that would have shown
  them are `apps/till/src/widgets/station-queue.ts`, `apps/till/src/screens/till-expo-screen.ts`,
  `apps/till/src/screens/till-ticket-view.ts`,
  `apps/till/src/screens/till-table-order-screen.ts` and `apps/till/src/widgets/basket.ts`; several
  doc comments there still describe a mirror of the server type and answers being rendered.
  A second, larger half of the same break: the till identifies a CHILD line by `productId === null`
  — at `apps/till/src/screens/till-table-order-screen.ts` lines 554, 717 and 889, and described in
  the comments at lines 693, 708 and 885 and at `apps/till/src/api/client.ts:1346`. A child extras
  line now carries the PICKED product, so none of those guards matches it: such a row would be
  named, offered a Send action and a course picker, and swept into the split and pay filters
  instead of being skipped. Unreachable today for the same reason as the rest of this entry — the
  till sends no extras, so no child line exists for it to mis-classify, and the legacy child line
  that used to carry a null product cannot be created at all any more.
  A THIRD thing on the same screen, found while fixing its paper twin and NOT a consequence of the
  rename: `apps/till/src/screens/till-ticket-view.ts` resolves a line's unit abbreviation by exact
  key against the requested locale, while a filed line's `unit_name` is keyed by bare content-language
  codes and nothing re-keys it. Measured on the PAPER receipt, which had the identical line: with the
  map a real sale files (`{ ca: "u", en: "ea", es: "ud", eu: "u", gl: "u" }`, asserted at
  `apps/server/src/till-api.pg.test.ts`), a Spanish receipt printed the CATALAN `u` rather than `ud`.
  The paper side is fixed (`resolveSnapshotText`); the screen still shows the wrong language's unit,
  so paper and screen now disagree until somebody takes it.
  **Next action:** Task 12 owns the till — recorded here so nobody debugs a missing line as a data
  problem, and so the child-line detection is rewritten rather than trusted.
  **A second next action on the same task, raised by the Task 9 review and deliberately NOT taken
  there:** the two label builders the till will need live in `apps/server` and the till cannot
  import them. `apps/server/src/option-snapshot-labels.ts` turns a frozen answer into the
  `<list>: <label>` string each audience reads, and its diner-facing half restates a rule that has
  a home elsewhere — "take the customer map when it holds text in any language, else the staff
  name" is `nonBlankTranslations(customerNames) ?? staffNames` there and
  `nonBlankTranslations(p.customerName) ?? { [defaultLanguage]: p.name }` in
  `customerPresentationText` (`packages/catalogue/src/product-presentation.ts`), which
  `docs/developers/products.md` names as the one place either presentation rule lives. Its
  kitchen-facing half does not restate anything — it calls `kitchenPresentationName` from that same
  file. Task 12 has to show the same two labels on the till's own settled ticket, and a browser
  consumer cannot reach into `apps/server`, so the rule is in line to be written a third time.
  MOVE the pair into `packages/catalogue` when Task 12 needs them rather than copying them; Task 9
  left them where they are because the server's two printers were the only callers.
- **A dead dashboard surface is left behind by `modifierDependants(...).orders` always being 0.**
  Three consumers survive in `apps/dashboard/src/screens/modifiers-screen.ts`: the orders-block
  alert (line 403), the delete button disabled on `dependants.orders > 0` (line 545) and the
  `dependency === "order"` refusal mapping (line 187). With them go two translations that can no
  longer appear (`modifiers.delete_orders_block`, English and Spanish, in
  `apps/dashboard/src/i18n/strings.ts`) and a test asserting a refusal the server can no longer
  send (`apps/dashboard/src/screens/modifiers-screen.test.ts`, `params: { dependency: "order" }`).
  **Next action:** Task 13 removes this surface; widening this branch into the dashboard is what
  this entry avoids.
- **A dead projection on the sale path.** `priceOrderLines` (`apps/server/src/working-order.ts`)
  still maps every offer's `optionGroups` into its `available` projection and carries
  `offer.modifiers` alongside, and nothing reads either: the projection feeds
  `priceBasketWithOptions` (`packages/catalogue/src/pricing.ts`), which touches neither field, and
  the only other mentions of those two fields in the file are `[] as const` placeholders
  (`modifiers` also appears there as the unrelated `QueueModifier` type, which is live). It stays because both fields
  are REQUIRED on the shared `AvailableProduct` contract (`packages/catalogue/src/menu-types.ts`),
  so dropping them from one branch of the ternary alone would either break the type or leave the
  two branches disagreeing. **Next action:** Task 13, with the rest of the old model.
- **The new definition reads take no lock while their writers serialise.** `priceOrderLines` still
  calls `lockModifierDefinitions(tx, "read")`, which covers the OLD `option_groups` tables the
  offer projection reads — but the four new reads take nothing: `readMenuExtras`,
  `readProductExtras`, `readProductModifiers` and `readOptionListsByIds`. Their writers serialise
  deliberately (`lockExtraList`'s `for update` in `packages/catalogue/src/extras.ts`, and
  `writeProductModifiers`'s per-list `for key share` in
  `packages/catalogue/src/product-modifiers.ts`), so a list edit committing mid-read could give one
  order a snapshot mixing pre- and post-edit wording. NOT MEASURED — no probe was run, and nothing
  establishes the window is reachable. **Next action:** decide it deliberately rather than slipping
  a lock in: adding one late is its own deadlock risk, which Task 6 of this plan already paid for
  once (`40P01` from lock ordering, recorded below).

What the product attachment (#456, the plan's Task 6) left behind:

- **A delete-then-insert of rows that REFERENCE another table can deadlock with a delete of the
  referenced row, and `CLAUDE.md` §3's rule about that shape does not yet say so.** The rule names
  two conditions — nothing outside the table holds a key into it, and the writers are serialised —
  and both were met here. The cycle is a third thing: the rewrite deletes its own rows first and
  only then inserts rows whose foreign key needs a lock on the parent, while a delete of that parent
  holds the parent row and waits for those same child rows through its cascade. Measured on both
  kinds of list (`40P01`), fixed by locking the referenced rows before touching the child rows, and
  pinned by `packages/catalogue/src/product-modifiers.pg.test.ts`. **Next action:** add the third
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
- **The product editor has no Modifiers section until Task 11.** #456 removed the old option-group
  attachment section rather than leave one whose edits the save would discard, and the catalogue
  screen's nested modifier form is now unreachable from the interface but left in place, because
  removing it reaches through `ProductChildKind` into that screen's own create-and-edit plumbing.
  **Next action:** Task 11 rebuilds the section over extras and options lists, and decides whether
  the nested form is rewired or removed.

What the per-menu publication (#452, the plan's Task 5) left behind:

- **`readProductExtras` and the product-attachment check both moved to Task 6, and both have
  landed there.** `readProductExtras` (`packages/catalogue/src/extra-projection.ts`) reads the
  extras lists a PRODUCT itself carries, with no menu offer in the question, and
  `setMenuItemExtraLists` (`packages/catalogue/src/extras.ts`) now refuses to publish a list the
  dish's product does not carry — ONE of the two checks its options sibling
  `setMenuItemOptionGroups` makes against `product_option_groups`, the one refusing an unattached
  group. The sibling's other check refuses a body that LEAVES OUT a group the product marks
  required, and there is no extras equivalent: an extras list carries no `required` flag (the spec
  makes "required" `min_picks >= 1`, §3.1) and §3.2 does not say a required list must be published.
  Both read `product_modifiers`, which Task 6 added. The dated note on Task 5 in the plan describes
  the gap as it was, and stays as history. **Next action:** settle whether an offer may publish
  none of a product's required extras lists, when the menu-offer screen is built.
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
- **The two new tables are not dashboard live-query dependencies, and should not be yet.**
  `QUERY_DEPENDENCIES` in `packages/venue-service/src/dashboard/live-queries.ts` names
  `menu_item_option_groups` and `menu_item_options` and has no extras equivalent. Nothing in the
  dashboard reads `menu_item_extra_lists` or `menu_item_extra_items` at all — no screen does — so the
  dependency belongs with the plan's Task 11, which builds those screens.
- **Nobody has decided whether the application role should hold `UPDATE` on the two publication
  tables.** `packages/catalogue/drizzle/0009_menu_extra_publication_grants.sql` grants it, and no
  production path uses it: `setMenuItemExtraLists` replaces rows rather than editing them. So the
  grants walkthrough in
  `packages/catalogue/src/extra-projection.test.ts` exercises `UPDATE` with direct statements, which
  is the only way to establish the role really holds what the migration granted it. **Next action:**
  decide whether to narrow the grant to `SELECT, INSERT, DELETE`, or record that `UPDATE` stays.
  Narrowing it is not a one-file change: `packages/fiscal-verifactu/src/privileges.expected.ts` pins
  `SIUD` for both tables, its own header says a deliberate grant change edits it in the same commit,
  and `packages/fiscal-verifactu/src/privileges.test.ts` compares that table against the live catalog
  with `toEqual`, so the migration and that file move together or the comparison disagrees.

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
- **Nothing checks that a table shared by replication has a primary key — SUPERSEDED 2026-09-19.**
  #350 found `product_units` publishing its rows with only a unique constraint, which makes Postgres
  refuse every UPDATE to it (`55000`), and the in-memory test database does not enforce that, so no
  test noticed. Nothing publishes a table any more: the PostgreSQL logical replication that created
  the publications was deleted on 2026-09-19 with the rest of the failover machinery, the `CLAUDE.md`
  §3 sentence this item cited went with it, and the measurement is kept as a HISTORICAL paragraph in
  [conventions-data.md](developers/conventions-data.md). The guard this item asked for is NOT work
  today — do not build it. The requirement returns only if the replacement failover publishes tables,
  which the topology design says it does not
  ([spec](superpowers/specs/2026-09-16-sqlite-litestream-topology-design.md) §4: a mirror "is a place
  the stream lands", not a database that receives rows). `product_units` keeps the primary key #350
  gave it.

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

**Product catalogue management improved — LANDED #387 (2026-09-16).** The Products page was
rebuilt around the shared table. It has one search box over product names, categories, modifiers and
variant names; a product's row shows its thumbnail and staff-facing name, its reporting category and
its other categories, its price (a range when it has variants), its modifiers, whether it is active,
and an allergen summary. A product's
variants nest underneath it and start folded away, so the page opens as one row per product. Each
row's Actions menu holds Edit and Delete.

Delete does not remove anything. It reads the product back, saves it with `available: false`, and the
row stays in the list wearing an **Inactive** badge — which is what keeps a product that has already
been sold readable in history. The confirmation says so in both languages
(`product.delete_warning`).

The editor was aligned with the patterns the rest of the dashboard already uses: the nutrition
section now uses the shared `dashboard-allergen-dietary-picker` (see the note under the modifiers
entry above for what that gained and lost), and a product with variants keeps its unit dropdown in
the variants table's price heading instead of behind the price field's unit button.

Two shared components changed, so this reaches screens beyond Products:

- `wt-data-table` gained `initiallyCollapsed`. A branch is seeded closed the first time it appears,
  and only then, so a later row refresh does not fold it back up after somebody opened it. Separately,
  when a search keeps a parent row only to reveal a matching child, the table now opens that branch
  and hides its collapse control — the control did nothing in that state — and restores the branch's
  own state when the search is cleared.
- `wt-disclosure` was redrawn. Closed, it is a plain heading with a chevron and no box. Open, one
  rounded border encloses the body with the heading sitting across it like a legend, so a section's
  title and its fields read as one thing. Both appearances are now written down in
  [design-system.md](developers/design-system.md).

What it left open:

- **The catalogue picker was deleted and nothing replaced it.** `catalogue-screen.ts` used to show a
  dropdown when a venue had more than one catalogue. The rebuild dropped it, and
  `selectedCatalogueId` now simply takes the first catalogue in the list — which is also the one every
  new product is created in. With one catalogue, which is every case today, this is invisible. With
  two, the second becomes unreachable from the dashboard, silently. **Next action:** decide whether
  more than one catalogue is a case Waitron actually supports. If it is, the picker comes back; if it
  is not, the list-of-catalogues shape should stop pretending otherwise.
- **Deactivated products cannot be hidden.** They sort to the bottom and carry an Inactive badge, but
  the Active column has no filter dropdown, so a venue that retires a lot of products ends up
  scrolling past all of them. **Next action:** add a filter on that column — the table already
  supports one per column — rather than inventing a separate hide control.
- **There is still no permanent delete.** Nothing in the dashboard removes a product that was never
  sold and was only created by mistake. **Next action:** decide whether that is worth a second,
  differently-worded action, or whether deactivating is simply the answer.
- **The combined journey through the real routes is still not recorded as walked.** This is the same
  gap the #345 list above records, and this branch did not close it: the evidence is focused suites
  and a run-it review, not one pass through the actual page against a real database. **Next action:**
  as above — walk it once on a dev stack.

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
  _Partly done 2026-09-16 (#387):_ the product editor now uses the shared picker. The widget grew a
  `dietaryOptions` property so products keep their full declaration list while modifier choices keep
  the four-item default. Ingredients (`option-group-manager.ts`) still use the old
  `dashboard-allergen-picker`, so that widget is not orphaned. **What is still open** is the question
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
machinery it proved. Some name the deleted file outright as where the proof lives —
`apps/server/src/me-api.test.ts` and `packages/payments/src/reconcile.test.ts` both do; the rest
describe a "sync-origin node id" threaded so that enrolled writes capture a real origin, which no
trigger does any more (`packages/payments-stripe`'s provider and device suites head their fixtures
that way, and `packages/payments/src/testing/fake-reconciler.ts` in passing). The scope is every
comment that still treats a captured origin as something the application records.

Neither obvious grep bounds it on its own: some comments cite the deleted suite obliquely rather than
by filename, so searching for `sync-origin.test.ts` finds only part of them, while searching for the
words "sync origin" also reaches a DIFFERENT and still-live thing — the mirror's own origin node id,
the `origin_node_id` column declared in `packages/db/src/schema/mirror-config.ts`, which is written
when a box is adopted as a mirror and is what that mirror's node-scoped reads resolve against. That
column is outside this item and must not be swept with the capture-origin comments; what its own
comment should say now that nothing replicates belongs with the column, not here.

One instance is already gone, which is how this paragraph got smaller: the 2026-09-19 failover
deletion rewrote `apps/server/src/recipe-api.ts`'s header, which used to name
`packages/sync/drizzle/0000_sync_baseline.sql` (deleted by #280) and now records that `cfg.nodeId` is
read by no route in the file and that no write path takes an origin. The rest were on `main`
unchanged when this was written, so they predate #378; found while reviewing that branch. Same
treatment as above — one pass, not a sweep.

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

**Printer calibration follow-up — LANDED #388 (2026-09-16).** A physical NT-806 byte-grid print
identified Windows-1252 at table 6, CP866 at table 16 and CP737 at table 19, contradicting that
unit's supplied table list. Encoding and `ESC t` table number are now independent printer settings.
The normal test covers common pairs; a sixteen-table batched finder handles other printer firmware.
Calibration uses one measured QR, and the editor can print a clearly simulated sample receipt with
its unsaved settings. Which sample characters get printed now follows the site's language rather
than a fixed Western-European assumption. The Add-printer layout also collapses the known-address
form, places Scan at the trailing edge, orders unsupported results last, and hides a redundant
status filter for an all-active or all-disabled list.
[Physical evidence and updated decisions](superpowers/specs/2026-09-16-printer-setup-refinements.md#owner-follow-up-and-physical-character-table-probe-2026-09-16).

- **NT-806 profile established on paper:** Windows-1252 bytes with `ESC t 6`. The earlier Kanji-mode
  correction did not make the manual's table 16 or 19 assignments true on this firmware.
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
- The kitchen ticket's per-layout formatting dedup (`kitchen-print.ts`) is byte-invisible, so no test
  guards its loss — removing it would enqueue identical bytes with nothing failing. Not a correctness
  risk; a spy on `formatKitchenTicket` would pin it if it is ever worth doing.
- A long single-token manual card reference wraps as "Ref." alone with the token split across the
  following lines, and a 61-character invoice number splits over three lines at 58mm — both stay
  within the column count and are correct, just awkward to read.
- No test covers `updatePrinter` receiving an explicit `undefined` for one of these settings — today
  both Drizzle and `updatePrinter` silently drop it, same as an absent field.
- The invalid-value error code is sampled across the create and update routes rather than exhaustively
  covering every field × route combination, matching this file's convention for `transport` and
  `ticketScope`.
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

- **Service dashboard workflow: design in progress (owner, 2026-09-20).** For table service, after
  unlocking you land on the floor plan or a flat list of tables. Distinguish
  unoccupied tables and show occupied tables' current state, particularly action needed soon,
  such as taking an order, collecting food or drinks ready for delivery, late food, or a requested
  bill. Tapping a table opens its tab details on Ordering, with a second Current orders view
  showing submitted orders and their states. For deli/counter service, the owner proposes a flat
  list of tabs rather than a table layout, including tabs not attached to a table. The exact landing
  view selection, status derivation, timing and detailed interactions
  remain to be designed. This is a future workflow brief, not a claim about current behaviour.
  Implementation waits for the SQLite migration, dependency upgrades and variants/extras-as-products
  changes to land, alongside the
  [menu design](superpowers/specs/2026-09-20-menus-categories-and-home-layouts-design.md).
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
  Pay-as-you-go is 1,49 % on every card including Amex, premium and international; **Tarifa Plana at
  €25/month is 0 % up to €2 500/month of Spanish debit and credit, then 0,79 %**, leaving the other
  classes at 1,49 %; Pagos Plus at €19/month is 0,75 % on Spanish cards. Tarifa Plana overtakes
  pay-as-you-go at roughly €1 680/month of in-person card takings and beats Pagos Plus at any volume a
  single venue reaches, so it is the plan to assume — and SumUp offers negotiated rates above
  €10 000/month, which is a phone call the deli should make rather than a rate to look up. This is
  cheaper than Stripe Terminal's 1,4 % + 0,10 € on a Spanish card and half its 2,9 % + 0,10 € on a
  tourist card, so it **confirms SumUp for the card-present seat**. SumUp's ONLINE rate is 1,95 % on
  every plan — the plans change nothing outside the room, which is why SumUp stays a weak candidate
  for the guest's own phone.
- **Routing by BILL SIZE is allowed but is the smallest lever** (owner idea 2026-09-18, arithmetic in
  the research note). SumUp charges a flat percentage online with no fixed fee and everyone else
  charges a percentage plus 25 cents, so SumUp crosses Stripe at €55.56 and Mollie at €33.33 on a
  Spanish card. **The card mix moves that crossover further than the bill size does** — a venue with
  enough premium and foreign cards never crosses at all, because Stripe's blended rate converges on
  SumUp's while keeping its fixed fee. The deli's own mix is a query against its card takings once it
  trades, not a research question. Two things to know before anyone builds this: the provider is
  chosen when the payment page is minted, so the AMOUNT can be routed on and the CARD CLASS cannot;
  and a refund must return through whichever provider took the payment. Worth roughly 10–20 cents a
  bill against roughly 70 for routing by METHOD onto Bizum, so **method first**. The variant that
  earns its keep is card-present: spend SumUp's Tarifa Plana €2 500 monthly allowance first, which
  routes on cumulative volume and needs no second merchant account.

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

- **The spawn-timeout guard now covers `packages/` and `apps/` — LANDED (2026-09-18).** It read only
  `scripts/` when it arrived in #407, which was recorded at the time as a real gap rather than a
  reasoned exemption: 22 of the 48 main Vitest configs under `packages/` and `apps/` (three more are suffixed) set no `testTimeout`
  at all. Extending it meant teaching it to resolve a bound from a package's config, because a test
  file there almost never sets its own — measured while doing it, ignoring the config would have
  invented failures for 11 files. It found one real defect (`packages/db/src/testing/two-node.test.ts`
  polled for 30s inside a test the package bounded at 30s, so the poll could never report its own
  timeout and a merely-slow run failed), and a hand-read of the same files found a second the guard
  structurally cannot catch: `packages/db/src/change-feed-replication.pg.test.ts` made five waits
  summing to 33s in a case bounded at 30s. Both fixed here.

  **Still open, and the guard cannot close it:** it compares a bound against the LARGEST SINGLE wait,
  never the sum, so a case that waits several times can still outlast a bound that passes this check.
  The sum is what caught the change-feed case, and only by reading. If that shape recurs, the answer
  is probably a runtime check rather than a text reader.

- **Reuse the stub executables in the root guard suites — LANDED (2026-09-18).** The follow-up from
  #407. `scripts/waitron-sh.test.mjs` and `scripts/main-tag-guard.test.mjs` now build their stub bins
  once per FILE and pass what each case varies through environment variables, rather than writing a
  fresh set of executables per test: ~11.5s to ~2.1s and ~3.3s to ~0.55s, taking the whole root Vitest
  project from ~21.7s to ~8.0s. Both suites keep every assertion they had, and each knob was proved
  still to reach its stub by neutralising it one at a time and checking the dependent cases fail.
  `run()` in waitron-sh also reports a killed child now — the command, the signal and the last stub
  calls — instead of leaving a hang to read as `expected null to be +0`. Receipt:
  [testing-guide.md](docs/developers/testing-guide.md).

  **Surveyed and deliberately not changed**, so nobody re-opens this: `scripts/pre-push.test.mjs`
  writes one stub per case but each fixture also runs about eleven real `git` commands, and reusing
  the stub measured 10.59s against 12.61s — inside git's own noise.
  `scripts/reap-testcontainers.test.mjs` writes its stubs in one case out of seventeen, so there is
  nothing to hoist. No suite under `packages/` or `apps/` writes executable stubs at all: nothing
  there is written with the executable bit, by either the `mode:` or the `chmod` form, and nothing is
  put on `PATH`.

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
- **A sixth: a CI shard exits 1 with every one of its tests passing (2026-09-18, PR #414,
  `test-server (3)`, job 105632564989).** The output SIGNATURE was reproduced deliberately — not the
  incident — with a reporter that accepts a passing result and then withholds its completion. The
  shard printed `Test Files 87 passed (87)` and `Tests 1313 passed (1313)`, then one error —
  vitest's worker-to-main reporting call (`onTaskUpdate`) timing out, which fails the shard on its
  own and takes the aggregate `ci` job with it. The timeout is birpc's 60-second default, and in
  vitest 3.2.7 nothing in this repository can raise it: the fork pool supplies no `timeout` and no
  `VITEST_*` variable reaches it (the bracket form was checked as the control). That reproduction ran one passing test file locally on
  vitest 3.2.7's built-in fork pool: one test passed, one error, exit 1 after 60,340ms — the
  60-second default plus the suite's own 340ms. **What is still unexplained is why one worker's
  `onTaskUpdate` went unanswered.** It is NOT that the main process stalled: the job log prints
  completed test files continuously through the whole minute before the error (90 lines, largest gap
  5.2s), and the largest output gap anywhere in the job is 21.9s, during startup. The error surfaces
  only in the end-of-run unhandled-error block, so the log does not even show when the timeout fired.
  The branch that met it touched nothing in `apps/server`, and the re-run on a prose-only change
  passed. Starvation of the main process is therefore a weaker suspect than it looks, and the shard
  is not the heavy one either (means over five green runs: 258s, 215s, 251s for shards 1, 2, 3). Written up in
  [ci-and-gates.md](developers/ci-and-gates.md) rather than fixed (owner decision 2026-09-18); keep
  the job log on the next sighting — nobody knows the cause, and it is the cheapest evidence there
  is.
- **What the grants refuse ONE OPERATION AT A TIME is not guarded (2026-09-19).**
  `scripts/write-path-tables.test.ts` (LANDED #430, 2026-09-19) covers the four tables `app_user` may
  read and never write — `tenants`, `nodes`, `deployment`, `mirror_config` — and nothing else. The
  slice-1 design asks for more than that: "everything else becomes a guard that reads the source …
  not a convention with nothing checking it". After this guard, that holds for four tables out of the hundred and five that
  matrix records. The rest, read from `packages/fiscal-verifactu/src/privileges.expected.ts`, which
  goes when the grants do: fourteen tables allow INSERT and refuse UPDATE and DELETE, and ten of them
  also carry an `ENABLE ALWAYS` immutability trigger refusing those two writes by a second mechanism
  the storage switch has to carry over anyway — so four are left, `drawer_opens`, `media_image_data`,
  and `incidents` and `invoice_series`, whose UPDATE is narrowed to named columns. Forty-three more
  refuse DELETE alone and three refuse UPDATE alone (`join_requests`, `location_catalogues`,
  `station_printers`), and no trigger anywhere refuses the operation the grant refuses on any of
  them. That is fifty tables where the grant is the only thing
  refusing an insert, an update or a delete it does not allow. TRUNCATE is wider still: no table
  grants it, and only ten carry a trigger that blocks it.

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
  correct the comment either way. Five of them name one of the four tables P9's guard is about, and
  P9 ran the probe they call impossible — `packages/db/src/deployment.break-glass.test.ts`,
  `packages/db/src/reserved-identity.test.ts`, `packages/db/src/node-identity.test.ts`,
  `apps/server/src/boot.singleton.test.ts` and `apps/server/src/boot.promote.test.ts` each say PGlite
  cannot show the `42501`, while an
  insert and an update of `tenants`, an insert of `nodes`, an update of `deployment` and a delete
  from `mirror_config` each returned exactly that in PGlite after `asAppUser`. Left standing rather
  than corrected in passing, because moving a suite off its container is the decision above.
- **`replication-arc`'s isolation was reverted** (vitest `projects` are incompatible with `--shard`)
  — CLOSED 2026-09-19: `apps/server/src/replication-arc.e2e.test.ts` was deleted with the PostgreSQL
  failover machinery, so this cannot recur in that file. Kept for the shape: the step (4) flake seen
  on 2026-09-14 was a race, not isolation (forcing that race reproduced the same symptom), fixed in
  #361 by waiting for the subscriber's apply worker to restart after the widen; what is left of that
  receipt is a pointer in [testing-guide.md](developers/testing-guide.md). The deletion changes
  nothing about vitest itself — `projects` and `--shard` are as incompatible as they were.
- **Job-sharding levers:** `--shard` splits by FILE COUNT; bump `shard: [1..N]` and the denominator
  together with N at or below the file count; `mutation-verifactu` is the next critical-path
  candidate; rebalance `LIGHT_A/B_PACKAGES` when one light shard dominates.
- **Dependency loop removed — LANDED #348 (2026-09-13).** `pnpm install` no longer warns about
  cyclic workspace dependencies; `scripts/workspace-cycles.test.ts` fails if a loop returns. Of the
  four things the review raised and that PR did not take, two are now done on
  `chore/test-guards-tidy` (the English-only guard scanned the replication-test package, and the root
  coverage-`include` comment now describes the rule instead of listing files). A third went away on
  2026-09-19: the test-only package that carried a coverage bar it could never fail was deleted with
  the PostgreSQL failover machinery, so nothing needs teaching about test-only packages until a second
  one appears. This one remains:
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

**Left behind by the TypeScript 7 upgrade (#460, 2026-09-20).** Two follow-ups.

- **Collapse the two TypeScript entries back into one, once typescript-eslint supports version 7.**
  Packages run `tsc` at 7.0.2; the repository root resolves the name `typescript` to
  `npm:@typescript/typescript6` so typescript-eslint keeps the version 6 API it still reads, because
  version 7 does not ship the old JavaScript API, and typescript-eslint refuses the version outright
  in any case. typescript-eslint tracks the work in its issue 10940,
  and the message it prints today names version **7.1** as the target. When a typescript-eslint
  release supports it, the root entry goes back to a plain `^7` range and the alias disappears. The
  whole arrangement, with the receipts, is in
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

**Left behind by the Stryker upgrade (#447, 2026-09-19).** Four things the bump surfaced and
deliberately did not settle.

- **`packages/db` is on Stryker 10 with no whole-package score, and nothing gates on it.** The db
  run is sharded ten ways in CI because it takes hours, so the Stryker bump measured it two cheaper
  ways instead: a two-file slice on both versions, and a whole-package mutant count from
  `stryker run --dryRunOnly`. That count went up, 2627 → 2649, and the review classified the new
  ones by running both installed instrumenters over the package's mutate set: every one is the new
  deletion mutant, nothing was removed, and no pre-existing mutant changed. What nobody has measured
  is what they do to the score, and `packages/db/stryker.config.json` sets no `thresholds.break`.
  The db job publishes ten per-shard slice scores and no aggregate, so a dispatch does not yield a
  package total at all — which is the last bullet.
  `packages/ui` used to sit in this bullet. It came out on 2026-09-20: a whole-package Stryker 10
  run turned out to take 10 to 16 minutes locally at `--concurrency 8`, not hours, which is what
  made measuring it cheap. It read 78.62% (1658 of 2109 valid) and was raised to between 96.73% and
  96.83% — four runs, the spread being mutants that time out — and now
  carries `"thresholds": { "high": 95, "low": 90, "break": 90 }`. The 9.6.1 side of the ui
  comparison the bump wanted is still unmeasured and would have to come from an earlier weekly run's
  artifact.
- **`packages/verifactu` and `packages/db` mutate their `src/testing/` tree, against the practice the
  sales-spine plan set.** `docs/superpowers/plans/2026-07-20-sales-spine-data-model.md` records the
  reason under `packages/fiscal`: a surviving mutant in a fake proves only that the fake has
  behaviour nobody asserted, which is a property of fakes, not a defect. That plan writes the
  `"!src/testing/**"` exclusion into the `packages/db` config it specifies, and states the rule again
  for `packages/fiscal-verifactu`; the shipped db config carries no such exclusion. It never
  addresses `packages/verifactu`'s own config, which predates it, so the case for excluding the fake
  there is the plan's stated reason rather than an instruction it gave. The
  cost is not small and not new: in verifactu, `src/testing/fake-aeat.ts` holds **43 of the package's
  60 surviving mutants**, and recomputing that same report without the file's mutants gives 98.76%
  against the 96.18% it scores as configured. That score gates
  merges — `mutation-verifactu` is one of `ci`'s `needs`, and `ci` is the required check — so the
  exclusion is a real decision, which is why the bump left it alone.
- **A Vitest 5 retry has to re-measure mutation — nothing about Stryker 10 settles it.** Vitest 5 was
  abandoned because Stryker 9.6.1 kills almost nothing under it: `packages/fiscal` scored 0.00% and
  `packages/shared` 8.14% (stryker-js#6210; fix PR #6214 was open and unreleased). Stryker 10.0.0's
  release notes mention neither issue, and nothing here was run under Vitest 5, so the question is
  untouched rather than resolved. The dated note at the top of
  `docs/superpowers/plans/2026-09-18-vitest-5-upgrade.md` says the same thing beside the plan it
  qualifies; this is the backlog's pointer to it.
- **`.github/workflows/mutation.yml`'s header comments quote counts that have drifted.** The ui
  half's file count was dropped on 2026-09-20 and replaced by a dated, sourced timing figure; what is
  left is db "bin-packs the 41 source files", which is far off what `stryker run --dryRunOnly`
  reports for `packages/db` today, and it drifted from the package growing rather than from the
  Stryker bump. (Its "~750 database-backed mutants" is a different
  measurement — taken with `ignoreStatic` applied — so nothing here shows that one is stale.) The
  repo's own rule is to describe the property rather than the number, so the repair is to drop the
  figures, not refresh them. Separately, the same file says a single merged db score is "a deliberate
  non-goal for now (see docs/backlog.md)", and no backlog entry answered that pointer — this is the
  entry it points at. Whether to keep it a non-goal or build the cross-shard aggregate, and gate on
  it, is still open, and it is also the only route to the db number the first bullet wants.

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
  - **Rewritten 2026-09-19 after the vite 8 upgrade, which retired the previous wording.** Until
    then this bullet said THREE older copies and named `vite` as a second declarer of `^0.25.0`
    alongside `drizzle-kit`, and predicted that the vite 8 item "will move one of the three". Both
    halves are now wrong, and the prediction was wider than what happened: upgrading vite removed
    vite as a REASON for the old copy without removing the copy. Read out of the two lockfiles, by
    which package declares each esbuild: at base, 0.25.12 was pulled by `drizzle-kit@0.31.10` AND
    `vite@6.4.3`; at tip, by `drizzle-kit@0.31.10` alone, because vite 8 takes esbuild as an
    optional peer (`^0.27.0 || ^0.28.0`) and resolves the workspace's own 0.28.2. **Watch the unit
    when reading a count here:** three distinct esbuild VERSIONS are installed at both base and tip
    (0.18.20, 0.25.12 and our own 0.28.2), and that is unchanged — but only two of them are older
    than ours, and the number of packages pulling 0.25.12 went from two to one. Saying "unchanged at
    three" across those two different units reads as "nothing moved", which is not what happened.
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
  constrains the syntax TypeScript emits, and `--target=node24` in the four esbuild build scripts
  (`apps/server`, `apps/print-agent`, `packages/credentials`, `packages/provisioning`). Nothing is
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
- **Four dependency-optimizer receipts were taken on vite 6 and were not re-measured.**
  `apps/dashboard/vitest.config.ts`, `apps/setup/vitest.config.ts`, `apps/till/vitest.config.ts` and
  `packages/ui/vitest.config.ts` each carry an `optimizeDeps.include` list with a comment recording
  a flake. Three of the four (`apps/dashboard`, `apps/setup`, `apps/till`) name Vite outright and
  quote its warning — "Vite unexpectedly reloaded a test" — as the thing they were measured against;
  `packages/ui`'s records no measurement at all. Vite 8 changes the optimizer underneath all four:
  its migration guide heads a section _"Dependency Optimizer Now Uses Rolldown"_ and says Rolldown
  "is now used for dependency optimization instead of esbuild"
  (`docs/guide/migration.md` on `vitejs/vite@main`, read 2026-09-19). Nobody re-checked that vite 8
  still emits that warning string, or that the `include` lists are still the fix. The suites are
  green either way; the risk is that the lists quietly become cargo and the quoted receipt goes
  stale.

One note for the next 0.x dependency bump, because it cost three review rounds here: esbuild ships
breaking changes in minor releases, which is documented and was read — but the release that actually
changed this repository's output was **0.27.1, a patch**. Reading the majors and the releases marked
breaking is not enough on a 0.x dependency; the whole range has to be read, and a paraphrase of it
does not belong in a commit message when the byte comparison is the real evidence.

*2026-09-19: this is not a 0.x rule.* The `fast-xml-parser` 4 → 5 bump found the same shape on a
stable major: the major itself behaves like 4.5.7 on the changes that did reach us, and each of
those arrived in a minor — **5.5.5 and 5.7.0**. Measured by installing each version in turn rather
than read off the changelog: 5.5.4 accepts an element named `constructor` and 5.5.5 refuses it;
5.6.0 still decodes `&#38;` to an ampersand and 5.7.0 leaves it as its own source text. Read the
whole range whatever the leading digit is.

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
`NUMSERIE_PATTERN` in `packages/verifactu/src/validate.ts` holds the outgoing record to; and
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
  not new — `conformance.test.ts` in `packages/verifactu` pins a SHA-256 against a literal, and
  `xml/serialize.test.ts` pins whole XML documents. But `conformance.test.ts`'s expected values are
  AEAT's own published huella vectors (`packages/verifactu/test/vectors.ts`, "Huella spec v0.1.2"),
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

One note for the next dependency bump, because it is what this one nearly shipped: **a library
default can be computed from the RUNNING runtime, and then the same source behaves differently on two
machines.** Version 14 asks Node's Web Crypto at import time whether it supports ML-DSA-44 and, where
it does, prepends that algorithm to the list BOTH halves of the registration ceremony default to.
Pinning only the half that issues the options left the half that accepts them still runtime-decided,
and a response whose credential public key declared the unoffered algorithm verified anyway. That was
found by running one through the real verifier, not by reading. The general shape: a default you did
not state is not a value you tested.

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
  2026-09-19: the browser moved and the refusal did not, so the version is not the cause. Playwright
  1.63 ships Chromium 153.0.8010.12 (build 1243) where 1.61 shipped 149.0.7827.55 (build 1228) —
  the same major as the installed Chrome this entry contrasts it with. Probed in that new build,
  headless, over `http://localhost` so the page is a secure context:
  `PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()` returns `false`, and a
  `navigator.credentials.get` with an empty `allowCredentials` still throws
  `NotSupportedError: Resident credentials or empty 'allowCredentials' lists are not supported`.
  What the headless browser lacks is a platform authenticator, which no version bump supplies, so
  expect the banner to still be there. The screen itself has not been re-opened on the new build.
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
is a discussion, not an approved spec. **SQLite + Litestream replaces PostgreSQL** — owner decision
2026-09-16, taken on the infrastructure simplification alone, which retired the density measurement
that used to gate it. The feasibility reads are in
[SQLite instead of PostgreSQL](superpowers/specs/2026-09-16-sqlite-instead-of-postgres-discussion.md)
(the regulation names no database privilege; Litestream covers standby and rejoin but not a returned
box's ledger tail) and the architecture in
[SQLite + Litestream topologies](superpowers/specs/2026-09-16-sqlite-litestream-topology-design.md),
whose §11 is the build order and whose §12.2 is the one gate still standing — a throwaway
failover-loop prototype. **That gate moved on 2026-09-16: it now runs before SLICE 2, not before
slice 1**, because all five of the risks it checks live in slice 2 or later and slice 1 has no
streaming, no store and no promotion (§12.2 carries the risk-to-slice table). Slice 1 has its own
[spec](superpowers/specs/2026-09-16-sqlite-slice1-storage-swap-design.md) and
[plan](superpowers/plans/2026-09-16-sqlite-slice1-storage-swap.md) and is the work in progress; the
prototype is no longer parked: since 2026-09-17 it is being built alongside slice 1, one task per
PR. **ALL TEN TASKS ARE IN AND THE GATE IS DONE** — the `bench/sqlite-failover` harness, S6 (what the
store does with a conditional write), S1 (a double promotion fenced by one, #392), S2 (one sale
submitted to the tax agency twice, #395), S5 (a supplier invoice number typed on both machines,
#406), the litestream foundation the last three scenarios stand on (#411), S0, the whole failover
loop end to end (#415), S3, a replica copied between two places in the store (#417), S4, a multi-day
offline write load (#422), and the write-up (#425). **The gate's product is
[the results note](research/2026-09-16-sqlite-failover-prototype.md)** — read that rather than
re-deriving any of this. Its answer: the loop holds everywhere but S2, which is the gate's recorded
negative result, and it carries the pins every result depends on, what the gate does NOT establish,
and the obligations it leaves standing. The topology design's §12.2, where this gate is defined, now
carries a dated note saying it has been run and what it found — including that what FAILS is not the
shape §12.2 names (the retried-in-full ship it asks about is safe; a recomputed hand-over and one
taken mid-filing are what file twice). What the litestream
foundation gave those scenarios: it can find the pinned binary, point it at
the store, upload a database, keep streaming one as it is written, and rebuild it from the store
afterwards. Four things
it measured that those three will otherwise re-derive: restoring refuses a non-empty output file
unless forced, and writes no SQLite sidecar files of its own; a restore works with the source
database absent, which is what makes it evidence about the store; litestream writes its ordinary log
to standard output and its errors to standard error; and no write-ahead-log setting is needed first,
because litestream switches the database itself. The plan's Task 6 carries all of it in a dated note
directly under its heading, including the two places the plan's own interface description was wrong
for this version. Left behind deliberately: the wrapper's streaming daemon is bounded only by the
scenario killing it, and one branch of the module — the sweep that kills a stray daemon if the
runner dies, and the refusal to run against a configuration file it did not write — is driven by no
scenario; the package README names both and says a later task should pin them or delete them. S1's caveat, which the results
note must carry: the rig's fence is a per-term key claimed create-only, where the product's is
`current.json` written only if its version is unchanged, so S1 is evidence that a refusal by the
store stops a double promotion and not a measurement of the product's own conditional write. The
rig's keys now sit under `venues/v1/`, the venue prefix the topology design gives each venue, so the
Litestream tasks (6-8) find their generations where they expect them. Still open, recorded rather
than guessed at: S6 failed once during S1's mutation runs with its message lost, then passed eight
consecutive solo runs — if the full run (Task 10) sees it again, capture the whole table and stderr
rather than re-running to green. **S2 is the gate's first negative result, and reading it against the real
system made it smaller than it first looked.** The rig models one machine handing its unsent sales to
another. A batch re-sent in full is safe so long as nothing it carries has gone out of
date: a sale the receiver has already filed is not pushed back to unfiled by an older copy arriving
over it, and a sale the sender has already filed is taken as filed, provided the sender rebuilt the
batch after filing it. Replay an unchanged earlier batch after the sender has filed, and it is not
safe — the review seat ran that variant and the receiver filed the sale a second time. A batch
recomputed against a refreshed view of what the receiver holds is not: the sender leaves out the
sales the receiver already has, so the news that the sender has since filed one of them never
travels, and the receiver files it itself. A batch taken while the sender is part-way through filing
carries a sale marked as being filed right now, which no filing run on the receiver ever picks up —
in the rig's minimal filing run. The real one is slower rather than stuck: it resets a sale left that
way for more than five minutes and files it again.
What that costs against the real tax agency is one wasted call, not a record filed twice: AEAT
refuses a record it already holds with error 3000, and `resolveEstadoEfectivo` already reads that
answer as filed — checked by reading the code and the documents, not by running anything. Two things
came out of it for the work still to come. The fence-before-ship rule is now written into the
topology design §5.2 — decommission the old primary before promoting the secondary, so the two never
file at once. Beside it that design now requires something that is **not built**: on restart, before
a node files anything, it resets every sale it inherited in the "being filed right now" state, with
no five-minute wait. That covers the copy a promoted node inherited through the stream; a sale that
arrives later, in a batch handed over after that node is already running, is still the five-minute
reset's job, because a reset that runs at startup cannot see one delivered afterwards. Today the only reset of a sale left in that state is
`recoverStaleClaims`'s five-minute one in `packages/fiscal-verifactu/src/drain.ts`, plus the backoff
that returns a sale whose submission threw — read on 2026-09-17, not run. Building that restart reset is work this backlog now owns, and it belongs with
whichever slice turns promotion on. **S0 (Task 7, #415) has now checked its own shape against that
case, and the answer is yes** — a promoted node can hold an out-of-date copy of a sale from the
Litestream stream, and the hand-over, which sends only what the receiver lacks, never corrects it.
S0's Part C drives that with the real litestream binary by one-shot uploads: leave out the upload
that would carry the box's filing state, and the promoted node files four sales a second time,
`box-a:1` to `box-a:4`, each a verbatim same-identity copy (same node, sequence number, hash and
payload), asserted row by row. It is recorded rather than failed, for the reason above — the tax
agency refuses a record it already holds and our drain reads that as filed — and it does not decide
S0's verdict, which is read off Parts A and B. Part A is its control: the same code path with the
upload restored re-files nothing. S2's verdict stays FAIL and the scenario runner exits
1 on it deliberately; no scenario runs in CI, so the evidence for one is its recorded run in the pull
request. The unattended runner that was building these tasks stopped itself on that FAIL (its STOP
file lives outside the repo, in the campaign directory); the owner read the FAIL down and restarted
it on 2026-09-18, so tasks 6-10 are being built again.
Three suggestions from S2's review were deliberately not taken, and they belong to whoever picks the
rig up next: the scenario inlines its node ids where its siblings hoist them to named constants; one
of its reads reaches past the `NodeDb` helper and casts twice because that helper has no `all`; and
its verdict string is English prose where every sibling prints a terse `key=value` list. **That last
one was expected to have a consequence and does not** (#425, 2026-09-19): the `--json` dump carries
each `detail` verbatim as a string and parses NONE of them, so nothing was built from those strings
and S2's prose costs nothing mechanical. It was therefore left as measured, since re-wording the
gate's one negative result would have rewritten its recorded run for no measurement. The suggestion
stands for whoever picks the rig up next, now on readability alone. S5 closed the second of those three: `NodeDb` now has an
`all`, and only S2 still casts twice. Task 6 settled the first and third for its OWN scenario only
(2026-09-18): the litestream foundation check hoists its node ids and prints a terse `key=value`
verdict, and the README quote was re-measured in the same change rather than left to drift. S0 did
the same (#415, 2026-09-18) after review caught it printing prose, and re-measured its own README
quote. **S2 is now the only scenario still printing prose and still inlining its ids**, so the
suggestion stands for it alone. The house shape is `key=value` — S3 (#417) prints one, with every
free-text value quoted after review caught one that was not, and `RUNNER` (#425) does too — but
**Task 10 parses nothing**, so the shape is a readability convention rather than a contract. `smoke`
also still prints prose, which #425 recorded when it counted them.
**S0 is in (#415), verdict PASS, and it is critical.** The box streams, files its own sales, sells
again and dies; the cloud rebuilds from the store, takes a higher term and sells for itself; the box
returns, sees the higher term and hands over its unsent sales. What S0 pins: the cloud ends holding
the box's six records with the contents the box wrote them with, compared field by field; the
cloud's own sale is a separate intact chain; every record sits under the node that wrote it; every
chain's hash links verify with no gap; every record reached the tax-agency stand-in exactly once;
and the pointer in the store names the cloud's term and generation, read back rather than assumed.
Four things it deliberately does NOT establish, each of which a later task or reader would otherwise
assume. **It never starts the streaming daemon** — every upload is a one-shot, so "the box dies
before the next upload" is a scripted step here and not the timing window the product would face.
(The daemon itself is no longer undriven: S3 (#417) sells under it and restores from what it wrote.
S0 still uses one-shots only, so the sentence above stands for S0.) **"Exactly once" is a claim about the filing ledger, not the table**, which is keyed
by node and sequence number and could not hold a row twice whatever the loop did. **Nothing fences
the returning box**: it hands over because the scenario has it hand over, not because anything would
stop it selling, so the decommission-then-promote rule the topology design §5.2 states is still
unmodelled. And **nothing streams the cloud's own generation**, so a node restoring `gen-2-cloud-1`
and following the pointer was left to Task 8 — which did NOT take it: S3 restores box-a's own
generation from a copied prefix and never reads the pointer, so that case is still unowned — S4 did
not take it either, so the write-up must say so rather than assume it was covered. One assertion in the scenario is driven by no scenario run and
only by a mutation — Part C's attribution check, which exists to exclude a duplicate filed under a
different identity — and the package README names it and says so.

**S3 is in (#417), verdict PASS, and it is critical.** The question: if one machine holds a copy of
another machine's replica in the object store, and that copy is pushed into the place a cloud node
would restore from, does the restore give the same database as if the machine had streamed there
directly? It does — **as long as the copy is a mirror**, meaning it also deletes what the source no
longer has. What S3 pins: box-a sells while a real litestream daemon streams it, and keeps selling
until the store has actually dropped a file it was holding, so the deletion case really arises;
box-a's database is then deleted from disk and the replica copied into a destination that already
holds a different machine's replica; with deletions propagated the restore is the same file bytes,
the same ledger rows compared field by field against what box-a wrote, the same chain tips, and
SQLite calling both files intact. The control is the same recipe with deletion propagation off,
driven through that same comparison: it restores the OTHER machine's nine rows, litestream exiting 0
and raising nothing, and what refuses it is SQLite calling the mixed file damaged.
**The control the plan asked for does not bite on this pin, and that is recorded rather than hidden.**
Where the leftovers at the destination are the same database's own older files — ones the source had
since compacted away — the restore comes back identical, because a replica file's name carries the
transaction range it covers, so putting one back under its old name puts the same range back twice.
That is the scenario's Part C, which decides nothing. Both design documents now carry dated notes
saying so, since the prototype spec's own S3 section still asserted the opposite. **What S3 does NOT
establish:** whether litestream ever writes different bytes under a key it has already used — the one
case that would make the same-lineage half unsafe; nothing about an EMPTY destination, since both
copies land on a dirty one; and nothing about the cloud generation or the store pointer (above).
Two things the rig needed on the way, both now in `model.ts` and `litestream.ts` for every later
scenario: litestream only deletes files with four settings it defaults to minutes on (with the
defaults, box-a wrote 131 replica files in two minutes and litestream removed none), and S3 is the
first scenario writing to a database while a litestream daemon reads it, which surfaced a
"database is locked" flake — nodes now set a busy timeout AND begin write transactions immediately,
each measured to be insufficient alone.
**What the review cost, and the one lesson worth carrying.** The run-it seat and the convention
reviewer each found things the other could not, and the re-read of their FIXES found the only
behavioural defect of the whole branch: the new code that recorded "litestream declined to restore"
as a measurement matched any non-zero exit of the restore command, which is also what a corrupt copy
and a dead store produce — so a genuinely broken copy would have been written down as a result with
the scenario still passing. It now matches litestream's own missing-backup words. That is the same
shape the litestream foundation's own control had already paid for once (a control that accepted any
error as a refusal), which is the argument for keeping the third pass: a fix wave is where this
repository's false claims are born.

**S4 is in (#422), verdict MEASURED, and it is non-critical.** The question the topology design
would not let anyone answer from a desk: what does a box that has been offline for days do to its
write-ahead log, and to the wait a cashier sees, while litestream cannot reach the store and nothing
else is allowed to tidy the log up. Three answers, over 7500 sales standing in for thirty modelled
days.

**The cashier is fine and the disk is survivable.** The commit does not slow as the log grows — p95
0.312ms and p99 0.436ms against the 150ms and 400ms bars, with the last modelled day faster than the
first — and the log grows at about 40KiB a sale to 310MB, which is roughly 104 days of offline
trading per gibibyte. So it is bounded by how long the box stays offline rather than by a size. It
holds about eighty times the data a checkpoint then writes, which means the prototype spec's example
ceiling, "a small multiple of the streamed data", is NOT met; the scenario prints that rather than
substituting a bar that passes, and the bar it does use is per sale.

**The result that matters for slice 2: we cannot get that space back while litestream is there.**
Asking our own process to checkpoint took SECONDS (6.8s to 12.4s across runs), reported itself
blocked, moved four frames of about seventy-five thousand, and left the file exactly as big as it
was; with the daemon stopped the same statement took MILLISECONDS and emptied the log. That is
topology risk 9's "could put our own process on the sale path", measured rather than assumed. Two
narrowings recorded with it: no sale was attempted DURING the block (the rig is one process and the
checkpoint is synchronous), and the sale immediately after still committed in well under a
millisecond.

**And the risk is WIDER than it was written.** It was stated as conditional on `wal_autocheckpoint
= 0`. It is not: with an offline litestream attached, turning that setting off changes nothing,
because SQLite's own automatic checkpoint is refused the same way ours is. So a slice-2 design that
hoped to bound the log by changing that setting has nothing to change.

**What S4 does not establish**, so the write-up does not have to re-derive it: anything that turns on
elapsed time (the load is volume — thirty modelled days pass in half a minute); the real ledger's
cost per commit, since this is the rig's own model and not `packages/fiscal-verifactu`'s schema
(#425 corrected a "five-table" count in two places — `model.ts` creates six); that a longer offline stretch stays linear, which needs a comparison across load sizes the
scenario does not drive; and a disk budget, because nothing here records the appliance's partition
size. Also left open: 250 sales a day is an ASSUMPTION — nothing in this repository records the
deli's real ticket count — so every figure is reported per sale for rescaling, and a real figure
would be worth having.

**THE GATE IS DONE (#425, 2026-09-19) AND HERE IS WHAT IT LEFT OPEN.** The results note carries all of
it with its receipts; this is the index, so a fresh session does not have to read the note to know
what it owns.

- **Re-run the store's conditional-write check against the real store** when Waitron Cloud picks one,
  and against any self-host target the product claims to support. Every store result in the note is
  MinIO's. Topology §12.2 explicitly demands this one against the actual store, so the gate is NOT
  discharged on that point, and an older S3-compatible target may lack the conditional write — without
  it the promotion tie-break is unsafe (risk 11).
- **Build the restart reset** — already this backlog's, restated because the gate's S0 confirmed its
  shape: a node must, on restart and before it files anything, reset every sale it inherited in the
  "being filed right now" state, with no five-minute wait. Written into topology §5.2, not built.
- **Bounding the offline write-ahead log is an open design question, and the lever risk 9 names is not
  one.** Measured: while a litestream daemon is attached AND cannot reach its store, the log's space
  cannot be reclaimed at all — our own `PRAGMA wal_checkpoint(TRUNCATE)` blocks for seconds, moves
  almost nothing and shrinks nothing — and dropping `wal_autocheckpoint = 0` changes nothing either,
  because SQLite's own automatic checkpoint is refused the same way. A daemon that CAN reach the store
  checkpoints the log itself. So whatever bounds that log has to stop or detach the daemon, and doing
  that on the sale path is what risk 9 forbids.
- **The cloud's own generation and the store pointer are UNOWNED.** Nothing streams a promoted node's
  generation and no scenario restores by following `current.json`. S0 handed the case to S3; S3 did
  not take it and neither did S4.
- **250 sales a day is still an assumption** nothing in this repository measures, so the days-per-GiB
  figure rescales but does not hold.
- **Three of the rig's scenarios have no mutation receipts** — S1, S6 and `smoke` — so what drives
  their assertions is written down nowhere. And the runner's own `main()` is driven by nothing: which
  files count as scenarios, the argument hand-off, the stderr summary, and the process exit status.
  Two of those four were measured to be silently breakable.
- **Two branches of the litestream wrapper are driven by no scenario** (the stray-daemon sweep, and
  the refusal to run against a config it did not write). A later task should pin them or delete them.

**And the lesson that got worse, not better, on the last task.** #425 is three lines of production
code and a document, and it produced **23 review findings across three passes** — a run-it seat, a
convention reviewer, and a third pass over the fixes those two produced. The third pass found the
fixes' own headline sentences to be false AGAIN, which is now five items running: a corrected mutation
receipt that named an assertion which could not have fired, a hedge that was too narrow twice in a
row, a claim about the fiscal drain checked at the parser instead of down the call chain, and three
different counts of the same thing in one wave. **A prose-heavy fix wave needs the third read, and
the numbers in a correction need re-running rather than re-reading.** It is the same shape #421 paid
for with nine false claims over three lines of code.

**What the review cost, and the lesson that keeps repeating.** Three numbers in this branch's own
CORRECTIONS were falsified by later runs — a duration range, a frame count, and a percentage twice —
each written as if it were a property of the rig when it was one run's figure. Every one is now a
range with its run count. The run-it seat found the control arm could pass while doing no work at
all, and falsified the claim that breaching the log ceiling would prove super-linear growth. The
scoped re-read of the fixes then found that one of those fixes had SHADOWED a mutation: a new
assertion ran ahead of the plateau assertion, so the one recorded experiment that had ever proved the
plateau assertion could no longer reach it. Fourth branch running, the re-read of the fix wave found
the most serious item. Also fixed beyond S4: two sibling scenarios carried the same teardown bug —
a rejecting store shutdown skipped the temporary-directory cleanup.

**S5 is in (#406), verdict PASS, and it is non-critical.** A supplier invoice number typed on both
machines while they are apart cannot be stored by the machine receiving the batch, which already
holds that supplier and number under its own id. The batch now names that row in its result and
leaves it out, and everything else in the batch lands; sending the same batch again reports the same
one clash and changes nothing. What the review cost, and what the next task should know: a refusal
was being classified by the rows already in the table rather than by the error, so any other refusal
was swallowed whenever the receiver happened to hold a row that looked like an explanation — it now
reads SQLite's extended result code first, and a third control holds it to that. The plan's
`SAVEPOINT` was dropped on a measurement rather than an argument (SQLite 3.53.4 rolls back the
failing statement, not the transaction, and the probe has a control that prints a difference), with a
dated note in the plan. One thing S5 does not check, stated so nobody assumes it does: the branch
that absorbs a row whose id the receiver holds under a DIFFERENT supplier and number is driven by no
scenario — the package README says which line and why.
**One flake found while landing S5 — FIXED in #407 (2026-09-18).** `scripts/waitron-sh.test.mjs` →
"builds both images from the git context and records them in .env" failed twice under load and
passed four runs out of four on its own. The guess recorded here at the time was wrong in one way
worth keeping: the case builds no Docker images (`docker` is a stub on `PATH`, and nothing in that
suite reaches Docker). It also said the cause was not a readiness wait — true of THAT failure, and
superseded for the one below, which was the health retry loop after all. The suite handed `spawnSync` a 20s
timeout but set no `testTimeout`, so Vitest's 5s default failed the case for its duration while it
was completing normally. See B9 above, and `docs/developers/testing-guide.md`.
**It came back on 2026-09-18 and #407 was only half the fix.** The same case failed twice again, under
two campaign runners and a MinIO container. The Vitest side was fixed; the SPAWN side was not. The
script under test retries a health probe 36 times five seconds apart — about 175s against the suite's
20s spawn timeout — and two cases did not pin the try count, so one probe returning anything but
`healthy` cost the case five of its twenty seconds, and enough of them in one run killed it — which on the
measured baseline takes four, landing a tenth of a second past the bound. Never observed; it is the
hypothesis this fix is built on. Measured by a review seat, counting probes: 0.692s healthy on the first probe (cold stubs), 5.090s
when one probe answers empty first, 15.119s never-healthy with the tries pinned to four, 2.179s for
the full 36 at the new delay; and six runs under
36 busy-loop processes on an 18-core machine all passed, which is a failure to reproduce at one load
level rather than a cause eliminated. Fixed
by cutting the WAIT rather than the retrying (`WAITRON_SH_HEALTH_DELAY`), with two cases that leave
the try count alone and assert the PROBE COUNT — the first version asserted only the give-up message,
which one try satisfies just as well, and a review seat falsified it by pinning the tries to 1 and
watching it still pass. The change reduces exposure rather than removing it: the same seat slowed each
probe by 0.6s and still reached `ETIMEDOUT`, at 20.003s. **Still not established:** what made a probe miss — that output was not kept and the
miss has not been reproduced.
**Slice 1's first task, P1a, landed in #390**: the column vocabulary in
`packages/db/src/schema/columns.ts`, proven on `drawer_opens`, with no schema change. Two things it
turned up that the rest of slice 1 depends on, both written up under "P1a findings" in the plan.
First, the check the plan told us to accept the work on — `drizzle-kit check` — reads nothing about
the schema and passes with a column type deliberately broken; the real check generates into a copy of
the migration folder and diffs it, and all three of `--dialect`, `--schema` and `--out` have to be
passed or the tool refuses — loudly, with a non-zero exit and an error naming what is missing, so it
is the `diff` taken on its own afterwards that looks like a pass, never the run. Second, the vocabulary cannot
cover everything: the 35 database enum types, the timestamp columns that read back as strings (the
majority, and the schema check is blind to getting one wrong), five column builders that were in use
with nothing to replace them with, and two fiscal amounts held as text that must never take the plain
text helper. **P1b's first step, landed in #393, closes that third gap and opens the vocabulary to the rest of
the workspace**: `packages/db/src/schema/columns.ts` now has `day`, `timeOfDay`, `smallCount`, `bigCount`
and `binary`, each pinned by its own generated-type test, and `packages/db/src/index.ts` re-exports
the vocabulary, which is the only door another package has into it. **P1b's second step, landed in
#394, converts `packages/db` itself**: the 33 table files that still named PostgreSQL's types now
name meanings instead. No schema change, and the probe is the receipt for exactly that much: it generated the
package's migrations into a copy of the migration folder, printed `No schema changes, nothing to
migrate`, exited 0, and the diff of the two folders was silent — with the same probe run before any
edit, which says the folder was not already out of date. That the probe can SEE a real change is
P1a's control, where a column's type was deliberately broken and the probe caught it while
`drizzle-kit check` did not. Behaviour is a separate question the probe cannot answer, because it is
blind to a timestamp's mode and to a caller-facing type: the workspace typecheck and the package's
own 615 tests carried that half. The rest of P1b is the remaining packages, one pull request each,
and then a final one for the guard and the house rule.

One cost the plan now carries, and one correction to how it was first written down. The `binary`
helper hands callers a `Uint8Array` where two of the three hand-rolled binary columns handed them a
`Buffer`, so converting `print_jobs.payload` changed what its readers receive — which is why
that one column was held back out of the 33-file conversion and took a pull request of its own. The
correction: that change was first described as breaking an assertion in `apps/server`, and it does
not. Measured on 2026-09-17, a `Uint8Array` satisfies `toContainEqual(Buffer.from(...))` just as a
`Buffer` does, with a negative control confirming the matcher still rejects different bytes. What it
does break is narrower and sharper: `Buffer.isBuffer(...)` in
`packages/db/src/schema/printing.test.ts` flips from true to false, and `.toString("utf8")` on the
same value stops decoding and starts returning `"72,101,108,108,111"` where it returned `"Hello"` —
a silently wrong answer rather than a failure. The readers themselves are wider than first counted:
thirteen files in all, about twenty of the sites in
`apps/server/src/receipt-print.test.ts` alone.

Two things #394 deliberately left for later. **The payload column is done** — P1b's third pull
request (#396) converted `print_jobs.payload` to the `binary` helper, deleted the `Buffer.from` in the
printing package's enqueue path, rewrote the two assertions named above, and retyped six
hand-written reader signatures from `Buffer` to `Uint8Array`. It left the copy in that package's
agent runtime alone, as planned: that path reads its row with raw SQL and so never passes through a
column mapping at all — re-measured by the reviewer against real PostgreSQL, the probe output being
the line the plan records. **`packages/catalogue` is converted too, in the fourth pull request (#397)** —
its four table files, 52 columns, with no schema change: every column builder those files used
(`uuid`, `text`, `jsonb`, `integer`, `boolean` and the two-decimal `numeric`) has a helper. Two
things it did not absorb, both written up in the plan. One text column keeps its hand-written
`check()` constraint rather than moving to the `enumText`/`enumCheck` pair, because that pair
narrows what a caller may write — measured with the typechecker, and invisible to the schema probe.
(The condition on that reason was established on 2026-09-18, in the sixth pull request below, and
NARROWED later the same day when `enumText` took a `const` type parameter: what decides whether the
pair narrows is where the values come from. Written inline at the call they always narrow; held in
an unannotated variable they never do. The live table, every cell pinned by a compile-time case, is
in `enumText`'s own note in `packages/db/src/schema/columns.ts`.)
And one column is an array, which the vocabulary has no helper for at all; there are five such
columns in the tree — three more in `packages/db` and one in `packages/media` — and the flip has to
convert every one of them whatever the vocabulary does.

**`packages/payments` is converted too, in the fifth pull request (#398)** — its five table files, 41
columns, with no schema change. Its two carve-outs are the two the rollout keeps meeting: the
database enums, which `enumText` cannot stand in for because it emits `text`; and two text columns
that keep their hand-written `check()` constraints — `payments.card_entry_mode` because its values
are written without the spacing `enumCheck` emits, so substituting would change the schema, and
`payment_policy.offline_mode` because the pair narrows what a caller may write (read with the
condition above, as the `const` type parameter of 2026-09-18 left it: a converter here would write
the values inline, and inline always narrows). This package met no
shape the earlier ones had not. It is worth recording that the pull request first claimed otherwise
— that `enumCheck` was structurally unable to express a nullable column's constraint — and that
both reviewers falsified it by composing the thing and running it, one of them against PGlite. The
durable half is now a test rather than a paragraph: `packages/db/src/schema/columns.test.ts` pins
that a null arm composed around `enumCheck` keeps its values inline, and goes red if
`.inlineParams()` is removed.

**`packages/fiscal-verifactu` was converted in the sixth pull request (#399)** and, because it edits
the column declarations of the immutable `registros_facturacion` and of the chain head `cadenas`,
was left for the owner to land rather than merged by an unattended run — landed by the owner
2026-09-18.
**`packages/identity` was therefore taken next**, in the seventh pull request (#400) — eight table files,
nine tables, 67 columns, no schema change. Taking it out of the plan's order costs nothing at the
database, because a vocabulary conversion adds no migration and the two branches touch no schema
file in common; it does cost a three-file prose conflict for whoever rebases #399, priced in the
plan. Identity's two carve-outs are the usual pair, but with an answer the rollout had not had
before: the two database enums stay, and the two text columns with hand-written `check()`
constraints (`google_oidc_states.mode`, `management_account_actions.purpose`) stay as plain
`label()` columns held by SCOPE alone. Neither of the two recorded reasons refuses the substitution
there — making it in full left the generated schema identical, and no caller of either column
breaks, established with a control that fired first. The narrowing the second reason is about still
happens — a converter would write the values inline, and since the `const` type parameter of
2026-09-18 inline narrows whatever the nullability; it simply costs nothing today. So what keeps them is that
rewriting an existing constraint is not what a conversion pull request does.

**`packages/workforce` is converted too, in the eighth pull request (#401)** — nine table files, nine
tables, 86 columns, no schema change. It is the first package in the rollout with no VALUE-SET check
constraint anywhere in it, so the `enumText`/`enumCheck` decision every earlier package had to make
was simply not available here. It does have two text columns whose own value a check
constrains — a hex pattern on `time_entries.entry_hash`, a length on `shift_templates.label` — and
both stay bare, which is what the earlier conversions already do with that shape
(`payments.card_last4` is one). What did change is the sentence in
`packages/db/src/schema/columns.ts` describing which checked text columns stay `label()` and why: it
claimed every one of them is held by one of the two reasons it records, and this package's two are
held by a third, so it was narrowed to say that value-set checks are the group. Its six database-enum
columns stay as they are, for the usual reason. Two things about it are worth knowing outside the
plan. First, it uses BOTH timestamp modes — fifteen string-mode columns and one date-mode
`workforce_chains.updated_at`, written with no mode at all, which is drizzle's default of date — so
the mode had to be read off each line; `packages/db` is mixed the same way, while payments and
identity are uniform. Second, this package holds a hash chain: `time_entries` is append-only and
chained and `workforce_chains` is its head, and that chain is the working-time record, which a cold
restore does NOT reset. It is being landed rather than left open like `fiscal-verifactu` because it is
not the fiscal chain, and because two checkable properties hold: no column here is a number held as
text (the three text columns holding hex digests are text before and after), and the digest in
`packages/workforce/src/chain-hash.ts` is built from typed values, hashing the two instants as epoch
milliseconds rather than as stored bytes. The column-by-column comparison that backs the whole
conversion reports no change to any column's read mapping, and it was proved by mutating the one
column the chain hashes — a mutation which also fails 33 of that package's tests outright, so the
wrong helper on a hashed column is loud rather than silent. The one place it would be silent is
`workforce_chains.updated_at`, which nothing reads or writes from JavaScript; that column now carries
a comment saying so.

**`packages/workforce-es` is the ninth pull request (#402)** — one table file, one table, 20 columns, no
schema change. It is the first package in the rollout with no `text` column at all, so the converted
file calls `label()` nowhere; it is the second in a row with no `enumText`/`enumCheck` decision to
make, for a different reason from `packages/workforce`'s (that one has text columns but no value-set
check over one; this one has no text column for a check to constrain). Its one `check()` is a range
check and its one database enum stays, for the usual reason.

**A question it surfaced was settled by the owner (2026-09-18): `convenio_config.night_premium_pct`
is a PERCENTAGE** — a 25% premium is stored `25.00`, not `0.25`. The tree had said it two ways: the
column NAME and the 2026-07-22 workforce design said percentage, while two comments (the column's own
and its paraphrase on `WorkTimeRuleset.nightPremiumPct`) said fraction. The comments were the wrong
ones and are corrected. No schema change: `rate()` is `numeric(5, 2)`, which holds a half-point
premium (`12.50`) exactly — the representability worry (a fraction in `numeric(5, 2)` cannot express
12.5%, storing `0.13`) only ever arose under the fraction reading, now retired. Nothing computes with
the value yet, which is why it was cheap to settle now and would have been expensive once a venue had
written a row. P6 (rates to basis points) now treats it like the other percentage rate columns.

**`packages/bookings` is the tenth pull request (#403)** — one table file, one table, 13 columns, no schema
change. The package itself met no new shape: its one database enum (`booking_status`) stays for the
usual reason, and there was no `enumText`/`enumCheck` decision to make, because the package has no
value-set check constraint anywhere — its only `check()` is a range over an integer, `party_size > 0`.
That is `packages/workforce`'s reason, met again.

**What it did find is about the acceptance check itself.** This is the first package in the rollout
whose drizzle schema entry point is not `./src/schema/index.ts`, so the plan's warning about the
`--schema` flag was exercised for the first time — and measuring it corrected one clause of it. The
plan said a pasted wrong path makes drizzle-kit write nothing, "so the `diff -r` is silent and looks
like a pass". Nothing is written and the diff is silent, both as predicted; what the run does NOT do
is look like a pass — drizzle-kit exits 1 and prints `No schema files found for path config`. So the
plan's own remedy — read the exit status AND the `No schema changes, nothing to migrate` line, never
the silent diff on its own — is not merely right but enough to catch THIS mistake at its first
clause, which is the part a reader needed to know. It is not enough on its own to accept a
conversion: a real schema change exits 0 and writes a migration, which is what the silent diff is
there for. Measured where no `src/schema/index.ts` exists at all,
which is also the shape of the two odd-path packages that followed, `venue-service` (converted, the
paragraph below) and `media` (still to come). The
plan's step 4 and its P1a twin are corrected in place, and so is the P1a summary earlier in this
entry, which had the same "fails silently" wording.

**`packages/scheduler` is the eleventh pull request (#404)** — one table file, one table, 14 columns, no
schema change. Every shape in it was a shape the rollout had already met, with one exception worth
recording. Its `scheduled_runs.state` column is a checked text column over a value set, and it is the
first in the rollout where every COST `columns.ts` records for moving such a column to the
`enumText`/`enumCheck` pair was measured and none of them lands: substituting is schema-silent, the
narrowing is already in force because the column is declared `.$type<RunState>()` and refuses a plain
string today, and there is no branded type to lose because the union `enumText` derives from
`runState` is the same type as `RunState`. Scope keeps it a plain column — `columns.ts` records scope
too, as a decision rather than a measurement, and rewriting a constraint is not a conversion's job —
and the comment beside it says that rather than borrowing a reason it does not have. Anyone who later
decides to rewrite these constraints should start here; `columns.ts` now names it as that sub-case.

It also paid for a trap in the acceptance method itself, now written into `CLAUDE.md` §4,
`docs/developers/testing-guide.md` and the plan's step 4: a coverage run given its own
`--coverage.reportsDirectory` under a non-dot name INSIDE the package left a directory the next
package run measured as source. That was measured on Vitest 3.2.7, where the only entries in vitest's
default coverage excludes that would have caught it were `coverage/**` and `**/[.]**`; Vitest 4 has no
default excludes at all, so a package's own `coverage.include` is what decides. The HTML reporter's
own assets add 267 statements, and
one leftover directory took this
package from 99.5% to 59.91% against a 90 threshold — a number that looks like a coverage regression
and is not. The fix is to put a second run's directory outside the package, which is what the rule's
own cited receipt had already been doing. Two false claims reached a committed draft of the plan's
report and were removed by the review wave: an increment quoted as uniform across readings that in
fact came from two different trees, and a repeatability claim the run-it reviewer falsified —
statement readings do repeat, branch readings do not, so no branch delta is quoted anywhere.

**`packages/venue-service` is the twelfth pull request (#408)** — one table file, eight tables, 52 columns,
no schema change. It is the second package the plan's `--schema` warning applies to (its drizzle
config points at `./src/schema/service.ts`; there is no `src/schema/index.ts`), and the warning did
its job: the path was read off the config before the first probe run rather than pasted.

Two things it contributes beyond another package converted.

The first is a blind spot in the throwaway line-comparison script most packages in this rollout have
been checked with — not all of them: `packages/db`'s conversion, the largest, was never line-
classified. The script picks out a column declaration by requiring a space after the colon, and a
value long enough to be pushed entirely onto the next line leaves a bare `allergens:` that the script
filed as "not a column". What caught it was a cross-check rather than the script's own report: it
counted 51 column declarations where the migration tool and the parity comparison both counted 52.
Because the script is shared, the eight earlier reports that state an "every changed line is…"
property were re-checked rather than left standing, and they hold — that one column is the only
declaration of its shape anywhere in the tree's schema files, at tip and at each earlier conversion's
parent commit, and it is this package's own.

The second is smaller and is a trap for whoever converts next. `smallCount`'s docstring in
`packages/db/src/schema/columns.ts` offered "a weekday" as its example of a `smallint` column. The
tree holds three `weekday` columns and they are not all `smallint`: `packages/workforce`'s two are,
and this package's `department_hours.weekday` is `integer`. A converter picking the helper by what
the column MEANS rather than by what it stores would have written a migration. The docstring now says
so, with all three named.

Its five checked text columns stay plain `label()` columns beside their untouched constraints, all
five held by the same single reason — none carries the `", "` spacing `enumCheck` emits, measured on
two of them, one NOT NULL and one nullable. The nullable one also put the composition note in
`columns.ts` through drizzle-kit's own generator for the first time, and the emitted migration
carries the values inline as the note says it should.

**`packages/credentials` is the thirteenth pull request (#413)** — one table file, one table, six
columns,
no schema change, and the second conversion in the rollout that changes what a CALLER is handed
rather than only what the schema says. `print_jobs.payload` was the first; over the nine
conversions in between, `git show --name-only` lists exactly one `.ts` file outside a `src/schema/`
path, a line-number pointer inside a SQL comment. This table's `ciphertext`, `iv` and `auth_tag`
were declared through a hand-rolled `bytea` block that typed them as node `Buffer`s in both
directions, and the shared `binary` helper hands a reader a `Uint8Array`. Nothing in the SQL reports
that — `bytea` is the stored type either way. The typechecker did: `pnpm -r typecheck` named three
lines of one `open(...)` call in `store.ts` and nothing else in the workspace, so the whole cost
outside the table file was widening that one function's parameter and adding the wider interface it
takes. `cipher.ts` now carries two interfaces instead of one — `Sealed` stays `Buffer`-typed, and
`open` takes a `SealedRow`. One widened interface instead of two was tried and costs two test edits:
`tsc` refuses `cipher.test.ts`'s two `.equals()` calls, which are `Buffer`'s method on a `seal()`
result.

What it contributes beyond another package converted is a measurement about the TEST, not the code
— and it is a measurement that corrected itself. The obvious failing test was the one
`print_jobs.payload` used: read a row back and assert `Buffer.isBuffer(...)` is false. Written in
this package's PGlite suite against the unconverted tree, it PASSED, because PGlite's own bytea
parser returns a `Uint8Array` already and drizzle hands that straight through when a custom type
declares no `fromDriver`. The first draft of this branch read that as "no runtime assertion in this
package can tell the two declarations apart" and built the whole test around it. That is a
measurement taken where both answers look alike, and two of the three review seats falsified it:
this package ALSO has a real-PostgreSQL suite, `credentials.test.ts`, and moving the same assertion
there turns it red for the right reason. Both tests are kept, because they fail for different
reasons, which was measured by deleting `fromDriver` from the shared helper: the compile-time one
stayed green and the real-PostgreSQL one went red. **The lesson for the next converter: before
concluding that a package cannot observe something at runtime, read its vitest config for the
target split.**

It also carries a warning for the parity comparison this rollout checks conversions with: that
instrument's object-tag half cannot tell a `Buffer` from a `Uint8Array` either, because
`Object.prototype.toString.call(Buffer.from([1, 2, 3]))` is `[object Uint8Array]` too. Only its
`String(...)` half discriminates, a `Buffer` stringifying as its utf-8 decoding and a `Uint8Array`
as a comma-joined list.

**`packages/media` is the fourteenth pull request (#414)** — one table file, two tables, nine columns, no
schema change, and it deletes the LAST hand-rolled `bytea` block in the tree. `grep -rn customType
packages apps --include="*.ts"` now matches no file but `packages/db/src/schema/columns.ts` and
`columns.test.ts`, where the one match is prose. That receipt is deliberately stated at FILE
granularity: the docstring carrying it is itself one of the matches, so a count of matching LINES
can move on a reword — an earlier draft counted five where this
wording gives four. Unlike `packages/credentials`, this one changes nothing a caller
is handed: media's block declared the `Uint8Array`-facing shape the vocabulary took, body for body,
which was proved by writing the two five-line blocks to files and diffing them (exit 0) rather than
by reading them side by side.

The interesting part is what it took to make the CHECK mean anything. The parity comparison this
rollout runs against every conversion reported zero mismatches here — and zero is also what a broken
comparison prints, so the reading needed a control before it was worth anything. Two were run, both
on this package's own columns: `created_at` `ts` → `tsString` moved it to one mismatch while the
drizzle-kit probe stayed silent on the same tree, and swapping the `binary` helper for a local
`customType` with no `fromDriver` moved it to one mismatch on `bytes`, printing
`[object Uint8Array]:1,2,3` against the same object tag with a different `String(...)` value. So the
instrument can see a changed byte mapping on this column, and the zero it reported is a fact rather
than a silence.

Its one carve-out is the array column, `images.labels`, the last of the five the rollout has met. It
becomes `label("labels").array()` — the shape the four sibling array columns already use, where the
builder is vocabulary and `.array()` is a drizzle call reached off it. Nothing in this rollout
absorbs `.array()`, and the flip handles arrays on its own row of the spec's table whatever the
vocabulary does. Coverage of the table file moved from 67.39% at the base commit to 64.28%
converted, with the SAME 15 uncovered lines on both sides — the two constraint callbacks no test
invokes — because the file lost four measured lines when the `bytea` block went. The package itself
reads 94.15% at the base commit and 94.13% converted, and its bars are four separate numbers rather
than one: 94.13 statements and lines against 90, 96.22 functions and 92.48 branches against 85.

**P1b's FIFTEENTH and final pull request was the guard and the house rule, LANDED as #416 on
2026-09-18** — which completes task P1b, and with P1a (#390) completes task P1. They landed together
because
a written rule with standing violations needs a guard rather than another paragraph (root
`CLAUDE.md` §7) — until the last package converted, every unconverted one was such a violation.
`purchasing` and `reporting` are on the plan's step 2 list but
have nothing to convert — no `pgTable(` and no `drizzle-orm/pg-core` import anywhere in their
`src`, checked 2026-09-18 — for the same reason `recipes` and `layouts` were struck off it: their
tables live in `packages/db`. So the conversions are complete, and the rule is now written: the
`CLAUDE.md` §3 entry names `packages/db/src/schema/columns.ts` as the only file that names the
engine's column and table types, its receipt is in `docs/developers/conventions-data.md`, and
`scripts/column-vocabulary.test.ts` enforces it. That also retires a worry recorded here — the pointer was
read as dangling, and reading what it rests on says it was not. Since #393 `packages/db/src/index.ts` has cited "(CLAUDE.md §3)"
beside the vocabulary re-export, for the claim that another package reaches the vocabulary only
through this barrel. §3 carried no rule about the vocabulary at all until now. It now names
`columns.ts` as the only file that names the engine's column and table types; the "only through
this barrel" half is covered by §3's separate rule that `@waitron/db`'s `exports` map is enumerated rather than a
wildcard. #397's review recorded the worry and left it rather than widening that diff.

What #416's review earned, recorded because the shape recurs: a guard's own reader can be talked out
of reporting, and it took two seats to find both ways. The Codex seat planted
`import { /* note */ text } from "drizzle-orm/pg-core"` — the specifier read as comment-plus-name,
matched nothing, and the suite still reported 14 passed with a real offender in the tree; a
single-quoted module name escaped the same way. The scoped re-read then broke the REPAIR with a
closing brace written INSIDE the comment, which ends a `[^{}]*` capture early, and prettier leaves
that shape byte-for-byte alone so `format:check` does not undo it. Both are controls now. The same
re-read measured that the lazy `[\s\S]*?` block-comment form backtracks exponentially (253ms at 24
consecutive comments, 5.3s at 32; the real tree scans in ~75ms either way).

Nothing was left open by #416. One thing deliberately not done, so nobody re-derives it: the guard
does not read `bench/`, `deploy/` or `scripts/`, and does not see a star re-export, a dynamic
`import()`, a subpath import or a namespace import — all stated in its own header rather than fixed,
because closing them needs a TypeScript parser. **That obstacle is gone as of 2026-09-20**: the root
now carries `typescript`, aliased to `@typescript/typescript6` so typescript-eslint keeps an API
under TypeScript 7, and it is the real thing — `node -e 'console.log(typeof
require("typescript").createProgram)'` at the root prints `function` against version 6.0.3. Whether
to spend a parser on this guard is still an open call; the root `vitest.config.ts` header records
what the old answer cost.

Three things about the guard worth knowing before changing it. It lives under `scripts/`, in the
ROOT Vitest project, and NOT in `packages/db/src/schema/columns.test.ts` where the plan put it: CI
expands a changed package to its DEPENDENTS, so `pnpm --filter "...@waitron/bookings" ls --depth -1
--json` lists seven packages without `@waitron/db` among them (measured 2026-09-18) and a check
inside that package's suite would never run on the pull request that adds a table file elsewhere —
the same defect that moved the repo-wide guards out of `packages/db` on 2026-08-01. It derives its
forbidden set from the vocabulary's own `drizzle-orm/pg-core` import block rather than from a list
written into the guard, so adding a helper does not go stale, and `customType` is in that set
deliberately — all three hand-rolled `bytea` blocks the `binary` helper replaced were written with
it. And it is weaker than its name: it reads the import or re-export line as text, so a builder reached
through `import * as pg from "drizzle-orm/pg-core"` is invisible to it, which is pinned as one of its own
controls rather than only claimed. One scoped exception survives, `text` in
`packages/fiscal-verifactu/src/schema/registros.ts`, whose two amount columns store the exact bytes
hashed into the huella; a different builder in that same file is still reported.

**A follow-up to the vocabulary, LANDED as #418 on 2026-09-18** — `enumText` takes a `const` type
parameter, so a column's value set narrows what a caller may write even when the values are written
inline with no `as const`. Before it, that spelling silently lost the narrowing on a NULLABLE column
and the typechecker stopped flagging a bad write; the database's own `in (...)` check still refused
the value, so this restored an early warning rather than the only guard. The owner chose it on
2026-09-18 after the sixth pull request above measured the condition. It is a type-level change and
nothing else: `drizzle-kit generate` prints "No schema changes, nothing to migrate", no migration is
added, and the JavaScript `tsc` emits for `columns.ts` are byte-identical with and without the word
(with a control that made that comparison fail). `pnpm -r typecheck` is at exit 0 across the
workspace.

**What it did NOT close, which is the part worth carrying:** values held in an UNANNOTATED variable
still widen to `string`, because `const VALUES = ["a", "b"]` is `string[]` before `enumText` is ever
called. Two spellings of that declaration are the way out — `as const` on it, or a `("a" | "b")[]`
annotation — and both are pinned. So the condition is no longer "how the values are written crossed
with the column's nullability"; it is where the values come from. Every cell of that table is a
compile-time case in `packages/db/src/schema/columns.test.ts`, enforced by
`pnpm --filter @waitron/db typecheck` rather than by the test run: vitest's typecheck mode is off in
this repository and these do not need it, which is worth knowing before anyone goes looking for the
config that would make them run in the suite.

**The finding of the branch is about METHOD, and it fired twice on one small change.** Both false
claims it produced were inside CORRECTIONS, which is exactly where CLAUDE.md §1 says to expect them.
(1) The run-it seat broke the type-comparison helper the branch had hand-written: both of its
controls put the wider type first, so degrading the helper to plain assignability passed them both —
the pins would have kept passing while pinning nothing. The fix was to delete the helper for
vitest's own `expectTypeOf`, which fails in all three directions including the one the controls
missed. The same seat falsified "a variable never narrows unless `as const`". (2) The scoped re-read
of those fixes then caught a NEW false claim written while correcting a stale count — "every
`enumText` call in the repository passes its values `as const`" — whose counter-example was the
branch's own probe table, four of whose columns deliberately do not. The pins now carry a control of
their own, one deliberately wrong pin under `@ts-expect-error`, closed from both sides and both
directions run.

Four earlier statements of the retired condition were left standing by the branch's first sweep and
found by the convention seat: one inside `columns.ts` itself about twenty-five lines above the edit,
three in this file, and one in the rollout plan's identity report a hundred and forty lines below
where the dated notes had been placed. A sweep that stops at the paragraph you edited is not a sweep.

**Task P2's FIRST pull request, LANDED as #421 on 2026-09-18** — `useVenueDb` in
`packages/db/src/testing/venue-db.ts`, a wrapper over `usePgliteDb` that forwards unchanged, so the
storage switch replaces one function body instead of every call site. Its exports-map entry is
`@waitron/db/testing/venue-db.js`. Three tests, the third of them the one that discriminates: it
asserts the row the second wrote is gone, and with the helper's body changed to
`resetPerTest: false` exactly that case fails and the other two stay green.

**The conversion is under way**, one pull request per package, fewest calling files first;
`packages/fiscal-none` was the first, LANDED as #423 on 2026-09-19. How many files are left is the
grep pair in `docs/developers/testing-guide.md`, never a number written here — a number here went
stale in one pull request, which is the whole reason #423 took it out and this sentence is the
second attempt at the same paragraph. The pair needs the exclusion that drops the four files allowed
to name either helper, and it lists FILES, not packages and not call sites.

One follow-up the rollout found and did not take (#424): the spec
`docs/superpowers/specs/2026-09-16-sqlite-slice1-storage-swap-design.md` carries "211 files" in six
places — lines 81, 83, 450, 484, 487 and 548 — where #423's message said two. The dated pointer at
line 85 covers the document's original reading, which is what the house rule asks of a historical
document, but the other four sit in sections nothing in this rollout otherwise opens. Sweep them
when something else takes that spec on.

#423's own lesson was about prose, not code: three rounds of correction on four sentences, each
round's correction wrong in a new way, and the third round's reader was itself wrong about one of
them (it read 209 where the named commit gives 210, because the fix wave had removed the literal
string from two documents). The rule that came out of it is already in `CLAUDE.md` §1 — a correction
deserves more scrutiny than the text it replaces — and the specific trap worth remembering is that a
document printing a grep pattern matches that pattern, so an instruction telling you which files are
left counts itself among them.

**The part of P2 that is NOT a mechanical rename, found by this branch's review and worth carrying
because the plan's step 5 does not reach it.** `usePgliteDb` is not the only door to a PGlite
database. Counted over `*.test.ts` under `packages/` and `apps/` on 2026-09-18: 11 suites call
`createPgliteDb` themselves with no helper at all (`packages/db/src/index.test.ts` does it inside the
`it`), and 7 more get theirs from `describeEachTarget`'s PGlite half. Replacing `usePgliteDb(` with
`useVenueDb(` reaches none of those 18, and `describeEachTarget`'s half in particular cannot simply
move: `pgliteTarget.create()` hands out a fresh cluster PER TEST where the helper hands out one
database per SUITE with a truncate between tests, which is a different isolation contract and one
`Target`'s own doc comment argues for at length. They belong with F1's 66-test disposition, and the
plan now says so.

**One edge the conversions keep finding and deliberately leave alone.** A fixture that wraps the
helper often adds its own per-test truncate of the tables it cares about, and that truncate is
redundant: `usePgliteDb` defaults `resetPerTest` to true
(`packages/db/src/testing/lifecycle.ts:132`) and its `afterEach` truncates EVERY table in the public
schema with `restart identity cascade` (`lifecycle.ts:76-83`, applied at `:114-125`), so the
fixture's own hook empties tables that are already empty. Seen while converting
`packages/purchasing` (#427), whose `test/fixtures.ts` truncates the two purchase-invoice tables
before each case; `packages/fiscal`'s converted suite (#424) has the same shape. Nothing is wrong —
it costs one statement per test and the suites pass either way — and a conversion pull request is
the wrong place to change what a fixture guarantees, so it is recorded here rather than fixed. If
anyone takes it, the question to answer first is whether any such fixture relies on the truncate
running BEFORE the first test, where the helper's reset has not yet run at all.

Two more things left deliberately open. The house rule naming `useVenueDb`, and the guard that would
enforce it, are NOT added yet — a rule with standing violations needs a guard and a guard cannot
pass while the violations stand, so both land together in their own pull request after the last
conversion, which is the shape the vocabulary rollout ended in (#414 last conversion, #416 the guard
and the rule). And a converted suite that reads its accessor too early still gets the error
`usePgliteDb: database not started`, naming a function its own file does not call; the cheapest fix
is a message that names no function, and it is recorded in the plan's task F1 step 24 because that
step replaces the body anyway.

**Two things the pre-landing documentation sweep still cannot do, both measured on
`packages/catalogue` (#454, 2026-09-19).** The sweep is two greps over the whole tree — the converted
files' paths with no second condition, and `usePgliteDb` on its own — and running each unnarrowed is
what finally works, because neither alone is enough: the path grep misses
`docs/superpowers/plans/2026-09-18-modifiers-extras-options.md`, which names `options.test.ts` bare
and "the `*.test.ts` below", while the name grep misses documents that discuss a converted file
without naming the helper.

What NEITHER reaches is a document that writes a converted file's path **package-relative under a
heading that supplies the package**. `docs/superpowers/plans/2026-09-12-product-categories.md:86` is
a table row headed `catalogue` listing `src/content-languages.test.ts src/integration.test.ts` and
four more, and `grep -c usePgliteDb` on it returns 0. That one needs nothing — it is a historical run
record — but nothing found it, and the gap grows with the package: `apps/server` has 56 files left to
convert and is named package-relative all over the plans. If a third grep is wanted, it is the
converted files' BASENAMES, read with their surrounding heading.

And a count of how many stale claims a document carries has to come from a grep over the WHOLE
document, not from the places an earlier round happened to name. Three review rounds on #454 passed a
"three places" count between them for
`docs/superpowers/plans/2026-08-15-recipes-allergen-inheritance.md` while correcting each other about
which commit each of the three died at; a fifth round ran `grep -n usePgliteDb` over the file and
found four, and the fourth was STILL TRUE at that point — a sketch headed
`packages/db/src/schema/recipes.test.ts`, a package the rollout had not reached. **It went stale
on 2026-09-20**, when `packages/db` was converted; that document now carries a second dated
pointer saying so, and all four of its writings of the old helper have now died — at THREE
moments, two of them at #434. The lesson outlives the example: a document's stale claims and its still-true
ones look identical to every grep, so only reading each one against the tree separates them —
and a clause that reads true today is a clause to re-check, which is why that first pointer was
written to be found again.

**A fourth helper the rollout's own plan did not name, found while converting `packages/media`
(#429).** Task P2 listed the doors to a test database as `usePgliteDb`, `useRealPostgres` and
`describeEachTarget`, and told step 5 to leave the last two alone. `useTemplateDb` was in neither
list, and a converter meets it nearly as often as the helper being replaced: on `61b5016e`, 179
files call it against 202 still calling `usePgliteDb`. It hands back a real PostgreSQL database
cloned from a pre-migrated template, so routing it through the PGlite seam would delete the
real-PostgreSQL coverage it exists for — which is wider than grants and concurrency: of the four
such suites in `packages/media`, one is accent collation and one is full-text stemming and ranking.
Both of the plan's lists now name it (#429 corrected them in place). Nothing to do; it is here so
the next converter meeting a real-PostgreSQL suite does not have to work it out again.

**A third thing for that last pull request, found while converting `packages/bookings` (#428).**
Converting a package does not remove the old helper's name from its PROSE, and the grep pair cannot
see what is left: the still-to-convert command matches `usePgliteDb[(]`, with a parenthesis, so a
comment that writes the bare name is invisible to it. `packages/bookings` is converted and
`grep -rlE "usePgliteDb[(]" --include="*.ts" packages/bookings` exits 1, yet
`packages/bookings/src/migrations.ts:5` still tells a reader that a test's `usePgliteDb` applies the
migration descriptor — true, because `useVenueDb`'s whole body is `return usePgliteDb(options)`, but
a pointer to a caller the package no longer has. Comment mentions of the helper today, run on
`ceeae219`:
`grep -rnE "^[[:space:]]*(//|\*|/\*).*usePgliteDb" --include="*.ts" packages apps` returns 21 lines
— 12 in `packages/db`, which owns the function and is not a dead pointer, and the rest spread over
`bookings`, `fiscal-verifactu`, `identity`, `payments`, `provisioning` and `workforce`. Each
conversion turns that package's share into dead pointers, so the sweep belongs with the house rule
and its guard rather than with any one conversion. Whoever writes the guard should decide
deliberately whether it reads comments at all; if it does not, say so in its header, because a guard
narrower than its name is the thing this repository's §7 asks to be stated.

**One exception to "defer the sweep", set by `packages/provisioning` (#431, 2026-09-19).** That
conversion renamed a comment mention rather than leaving it, and the line it drew is worth keeping:
the mention it renamed was a POINTER at the very call being converted, in the same file — a reader
following "see the suite's `usePgliteDb` options" landed on a function the file no longer called.
A stray mention elsewhere in the package is still the final pull request's to sweep; a pointer at
the converted call belongs to the conversion. Note also that a conversion can ADD a mention: that
same branch's rewritten `packages/provisioning/vitest.config.ts` names `usePgliteDb` in a sentence
about which timeout governs PGlite setup, which is a live reference, not a dead pointer. So the
comment-mention list above is still right that `provisioning` has one, and wrong about which line
and why.

**A claim three readers have now falsified, left standing in one place on purpose.** Three files in
`packages/provisioning` said `instance` "creates databases and roles and reads `pg_roles` attributes,
none of which PGlite's bundled single-superuser server can reproduce". Run against PGlite 0.5.4,
`create role … login createdb createrole` and `create database …` both SUCCEED and `pg_roles` comes
back with the attributes set; three independent readers got that result. #431 removed the claim from
the two files it already had open and left `packages/provisioning/src/testing/postgres.ts:13`, which
is the message thrown when the container will not start. Fixing that one needs the real reason
established rather than guessed, and there is a candidate already written:
`packages/db/src/testing/postgres.ts:218-220` says PGlite's default superuser connection "bypasses
privilege checks and serialises queries" where real PostgreSQL "supplies restricted LOGIN connections
and independent backends". Nobody has checked that it covers everything the three twins claim.

**A dating method that cannot see what would falsify it, from the same branch.** `git log
--diff-filter=A -- <file>` looks like it dates a file's arrival and does not: without `--follow` it
stops at a RENAME and reports the rename's commit as the origin. On #431 that put two container
suites five weeks late, in the pull request that renamed `*.rls.test.ts` to `*.pg.test.ts` rather
than the one that wrote them — and it moved the answer onto the wrong side of the very claim being
checked. Use `--follow` whenever the date is the point.

**The finding of this branch is again about METHOD, and it is the sharpest instance of it so far.**
The code is three lines and never changed after the first commit. Everything after that was prose,
and THREE rounds of review each found false claims inside the previous round's CORRECTIONS — nine in
total, none of them in code. Round one: two over-claims plus a statement about
`describeEachTarget` written from the plan's wording instead of from `harness.ts`. Round two: three
new false claims born in round one's fixes, including an impossibility claim with a counterexample,
plus an edit that ticked the plan's checkboxes on the WRONG TASK because it matched the first
occurrence of each step heading in the file rather than the one inside P2. Round three, asked only
"is any sentence this branch adds false?": four more, among them two counts stated as measured on a
tree they were not measured on, and one universal ("every existing PGlite suite still calls
`usePgliteDb`") that was not merely wrong but HID the 18 files above. Every one is written up in the
branch's commits rather than quietly rewritten. The practical lesson for the conversions to come: a
count is not a receipt unless the command and the tree are beside it, and a correction deserves a
reader who is not its author.

**A FOURTH review round, and what finally forced it, from `packages/recipes` (#434, 2026-09-19).**
The rule above — a correction deserves a reader who is not its author — held for three rounds and
then was not enough. On this branch the code was two renamed calls and never changed; round two
broke five sentences of the commit message, round three broke eight (five of them round two's own
corrections), and round four broke three more, all three written by round three. What kept breaking
by the end was one particular shape: a sentence saying which OTHER files carry the same false claim.
Round two named a package that had never carried it; round three described a `grep -B2` window in a
way that excluded the three files the same paragraph named; round four found two more packages named
as carrying a claim they do not make. **The durable lesson: do not name a file as carrying a claim
unless a literal search for the claim's own words matched it.** A pattern assembled around the claim
— a word, a window, a file-name filter — answers a different question, and the answer reads like the
one you asked for. Where a sweep is being deferred, leave the instruction ("read the configs") rather
than a list or a command that pretends to be the answer.

**The false claim that branch was correcting, and the twins it deliberately left.** A package's
`hookTimeout` does NOT bound the PGlite boot and migrations: `usePgliteDb` hands `beforeAll` its own
60-second default (`packages/db/src/testing/lifecycle.ts:22` and `:146`), and a timeout passed to a
hook overrides the config's. Three configs carried the sentence verbatim when this was written —
found with
`grep -rn "boot a WASM PostgreSQL and apply migrations in beforeAll, so hookTimeout" --include=vitest.config.ts packages apps`,
which returned `packages/purchasing`, `packages/workforce-es` and `packages/catalogue`. **Two of the
three have since been corrected by the conversion of their own package — #438 took
`packages/workforce-es`'s, and the `packages/catalogue` conversion took that one — so the grep now
returns `packages/purchasing` alone. That one has no conversion left to catch it: `packages/purchasing`
was converted early in the rollout, by #427, whose whole diff is two lines in
`packages/purchasing/test/fixtures.ts` and does not touch the config. Somebody has to take it
deliberately.** Another instance sat in the package that owns the helper,
`packages/db/README.md`: "Setup hooks have a separate `hookTimeout: 120_000` budget for booting and
migrating PostgreSQL." It was left open because correcting it meant deciding what the sentence
should say about BOTH halves — false for that package's `usePgliteDb` suites, true for a hook that
passes no timeout. **The `packages/db` conversion took it on 2026-09-20**, by measuring both halves
rather than arguing them: with `hookTimeout: 1`, `src/testing/reset-append-only.test.ts` (PGlite)
dies in `afterEach` and `afterAll` and never in `beforeAll`, while
`src/testing/reset-append-only.pg.test.ts` (`useTemplateDb`, passing no `timeoutMs`) dies in
`beforeAll` on the template clone. So `hookTimeout` reaches every teardown hook in the package, plus
a real-Postgres `beforeAll` that names no timeout of its own, and reaches neither the PGlite
`beforeAll` nor the shared container's boot, which is `globalSetup`'s. **The old sentence's true
half survives and is still named**: `packages/db/src/testing/networked-postgres.test.ts:12` is a
hand-written `beforeAll` that starts a Docker network and a real container and declares no budget,
so `hookTimeout` is the only thing bounding it — which is exactly what that sentence described, for
one suite out of seventy. Dropping the name while correcting the sentence was the first draft's
mistake, caught by the branch's own re-read. `packages/db/vitest.config.ts` now carries all three
cases with the suite that died in each; the README states them and points at the config.

**THAT PHRASE-GREP IS NOT THE SIZE OF THE PROBLEM, and #438's review rounds are what showed it.** It
finds ONE wording. Six more `vitest.config.ts` files stated the same claim in other words when this
was written — `packages/credentials` corrected by #440, `packages/scheduler`, `packages/workforce`
and `packages/reporting` each by their own conversion, `packages/payments` by its own on 2026-09-20,
and `packages/fiscal-verifactu`, **the last of the six, by its own conversion on 2026-09-20**, in
the third bullet below. **None of the six is outstanding — and that is a statement about six CONFIG
files, not about the class.**
Three more instances of the same false claim are still standing
elsewhere in this section — `packages/purchasing`, `packages/fiscal-none` and `packages/fiscal` —
each named in the paragraphs around this one. It read four until #467 took
`packages/db/README.md`, and that pull request's first round of corrections changed this number
without changing the list beside it, which is the same failure one sentence later in a different
dress. The running
tally that used to sit here ("three do now") was left un-decremented by two successive conversions
before anyone noticed, which is the §7 rule about counts happening to this very sentence; naming the
one outstanding package instead is what a later conversion can actually keep true.
**A SECOND identifying phrase-grep, free, found while correcting `packages/payments`:**
`git grep -n "hookTimeout stays generous for the PGlite boot" -- '*/vitest.config.ts'` matched the
payments and fiscal-verifactu configs, which carried that sentence verbatim, and the grep at the top
of this section matched neither. **Both are corrected, so scoped to `*/vitest.config.ts` it now
exits 1**; it is kept here because it is how this class was identified, not because anything is left
for it to find. **The path scope on that command is doing real work**: unscoped it also matches the
sentence you are reading, which is the same self-answering shape this file already records at the
`createPgliteDb` note further down. A receipt-grep written INTO the file it searches has to exclude
itself, or it reports its own text as a finding. The count is not the point — the METHOD is, because two
successive corrections inside #438 got this wrong in opposite directions. Read each config against its own package and ask where the boot
actually sits:

- False for the same reason (every PGlite boot in the package goes through the one helper, so
  `hookTimeout` bounds none of them — `grep -rlE "createPgliteDb|describeEachTarget" --include="*.ts"
  packages/<pkg>` exits 1): `packages/reporting/vitest.config.ts`, **corrected by that package's own
  conversion on 2026-09-20, so this entry is now a record rather than work outstanding**.
  `packages/credentials`'s was one of these; the conversion of that package corrected it, in the
  same way #438 corrected `packages/workforce-es`'s and the `packages/workforce` conversion
  corrected its own. One thing reporting's correction had to get right that the earlier ones did
  not: `hookTimeout` is not idle in that package. Its two real-PostgreSQL suites call
  `useTemplateDb` with no `timeoutMs` of their own, so the template clone at
  `packages/db/src/testing/lifecycle.ts:422` IS bounded by it — saying "it bounds nothing here"
  would have been the over-correction this section already records in the other direction.
- ALSO false, and this is where the first correction went wrong: `packages/payments/vitest.config.ts:14`
  and `packages/scheduler`'s, the latter corrected while converting scheduler. That grep returns a file
  for each of the two, which a draft took as a reason to spare them both — but the one out-of-helper
  boot in each is inside an `it` body (`packages/payments/src/migrations.test.ts:27`,
  `packages/scheduler/src/run.test.ts:205`), and `testTimeout` bounds a test body, not `hookTimeout`.
  **The grep tells you a boot exists; only reading tells you whether it is in a hook.**
  **`packages/payments` was the one of the two still standing, and its own conversion corrected it on
  2026-09-20, so this entry is now a record rather than work outstanding.** The caution was followed:
  the replacement comment does NOT write the word `createPgliteDb`, because that grep is how this
  class is identified and a config that names the driver answers it about itself — the same shape as
  the bare-name trap below. It points at the `it` body instead
  (`packages/payments/src/migrations.test.ts:27`). Two things that correction had to get right which
  the scheduler one did not face. First, the route to "60 seconds, not this setting" differs by
  package: `packages/reporting`'s fourteen call sites each pass `timeoutMs: 60_000` explicitly, while
  none of this package's fourteen passes one at all, so it is the helper's own
  `DEFAULT_SETUP_TIMEOUT_MS` fallback (`packages/db/src/testing/lifecycle.ts:22` and `:146`) that
  supplies the same number — the same conclusion reached down a different path, and writing
  reporting's sentence here would have been a false claim about this package. Second, `hookTimeout`
  is not idle here either: nine real-PostgreSQL suites call `useTemplateDb({ template: "core_payments" })`
  with no `timeoutMs`, so the clone at `lifecycle.ts:422` IS bounded by it.
- False for a DIFFERENT reason: `packages/fiscal-verifactu/vitest.config.ts`, **corrected by
  that package's own conversion on 2026-09-20, so this entry is now a record rather than work
  outstanding.** Three of its suites do boot PGlite in an untimed `beforeEach` that `hookTimeout`
  really does bound (`provisioning.test.ts:25`, `registro-sif.test.ts:22`, `restore.test.ts:63`) —
  but the sentence said every per-suite cost "is paid in a beforeAll", and the package's converted
  files take a `beforeAll` budget of their own instead. So it needed rewording, not sparing; a second
  correction inside #438 spared it and was itself wrong. The measurement, and what the rewrite had to
  get right that none of the earlier ones faced, is in that conversion's own entry below.
- Three more, each matched by the claim's own words (`git grep -n "5s default"`) and then read,
  found while converting `packages/core`. `packages/fiscal-none/vitest.config.ts:8-10` and
  `packages/fiscal/vitest.config.ts:8-10` each name a boot that goes through the helper —
  `packages/fiscal-none/src/migrations.test.ts:10` and
  `packages/fiscal/src/testing/fake-backend.test.ts:35`, both already converted, neither passing a
  `timeoutMs`, and `grep -rlE "createPgliteDb|describeEachTarget" --include="*.ts" packages/<pkg>`
  exits 1 in both packages — so neither comment's boot is bounded by the setting it is written
  above. `packages/fiscal`'s is wrong twice over: the setting it raises is `testTimeout`, which
  bounds a test body and not a hook at all. `packages/fiscal-none` raises both, and neither reaches
  the boot: its `testTimeout: 120_000` bounds test bodies, and its `hookTimeout: 180_000` reaches
  only the hooks the helper leaves untimed — its `afterEach` reset and its `afterAll` close
  (`packages/db/src/testing/lifecycle.ts:148` and `:153`) — which is what this package's
  `hookTimeout` does reach, the boot aside. `packages/payments-stripe/vitest.config.ts` had the same second
  error, calling the 5s `testTimeout` default "a live risk" for a PGlite boot and a template clone
  that both sit in hooks, until its own conversion corrected it on 2026-09-20. `packages/core`'s three were corrected by that conversion, and two of them
  are in TEST files rather than a config — every other entry in this list is a config or a README.

**A claim stated in a markdown file is invisible to every grep this rollout kept, and #438 is where
that cost something.** `docs/superpowers/plans/2026-09-06-module-fiscal-none.md:101` and `:119` told
whoever executed that plan to read `packages/workforce-es/src/migrations.test.ts` for "the exact
`usePgliteDb` … names and call shape" and called it "the source of truth for symbol names" — a
designation, not just a mention. Converting the package falsified it, and only the convention
review's stale-receipts pass found it; #438 added a dated pointer beneath the step rather than
rewriting history. The scope gap is general: the guide's pair and the plan's step-5 command are all
`--include="*.ts"` under `packages` and `apps`. Note the sharper version of the same point — a grep
DID look. #423 ran `git grep -l 'usePgliteDb(' c54dee74` unscoped and got 243 files, 34 of them
markdown, that plan among them; nothing read the markdown half for what a document SAYS about a
converted file. **The remaining conversions should run one unscoped search over `docs/` for the
converted package's test paths before landing** — and must not narrow it by PROXIMITY, which is how
the `packages/core` conversion (#451) missed the strongest designation it owed a pointer. That sweep
intersected "names a converted file" with "names `usePgliteDb`" and read only where the two fell
within four lines of each other; `docs/superpowers/plans/2026-08-03-invoice-first-settlement.md`
names `list-outstanding-sales.test.ts` in a step heading and prints the `usePgliteDb` import and call
in the fenced block below it, fifteen lines away before that conversion put a pointer between them.
A step names its file in a heading and sketches it in a block that can be any length, so the unit is
the document, not a window. The convention review caught it; the sweep did not.

**And the measurement trap inside that correction, which is CLAUDE.md §1's "both answers look
alike" in a new dress.** The obvious probe is to set `hookTimeout: 50` and see the suites still pass.
On `packages/recipes` they sometimes do and sometimes do not: six runs failed 24, 19, 11, 10 and 8
tests and once none at all, because the helper's per-test reset sits right on the 50ms line. The
pass/fail count is therefore not a receipt. What reproduces is WHICH HOOK the timeouts name — always
the `afterEach` reset (`lifecycle.ts:148`) or a suite's own `beforeEach`, never the `beforeAll`,
which takes about a second. State the failing case first: if `hookTimeout` bounded the boot, every
run would die in `beforeAll` before a single test ran.

**`packages/printing` converted, LANDED as #435 on 2026-09-19** (main `e024d14b`) — the eighth
package of the rollout, three test files and three calls. It found a SECOND shape of false
`hookTimeout` claim, unrelated to the one above, and the two must not be confused. The three twins
named above are wrong about which setting bounds the PGlite boot. Printing's config was wrong about
something else: it said `hookTimeout` "stays generous mainly for globalSetup's own image pull on a
cold CI runner", and vitest does not bound `globalSetup` by `hookTimeout` at all. Under
`--hookTimeout=50` most of the package still runs, and a temporary timer inside
`packages/printing/src/testing/global-setup.ts` printed 1368ms for a setup a 50ms ceiling would have
killed. **The three twins are NOT twins of that one** — each of them states printing's fact
correctly on its very next line ("The container boot/image pull runs in globalSetup, outside
hookTimeout."), so the sweep still owed on them is the narrower one described above.

**Three measurement traps from #435, each of which cost a review round.** First, the pass/fail count
under `--hookTimeout=50` is even less of a receipt than the paragraph above says: thirteen runs of
one package on one machine gave failed-file counts from 1 to 5 of 13. Second, a run under that
ceiling ALSO prints failures that are not timeouts — `database "clone_NNNNN_1" already exists`
(SQLSTATE `42P04`), because the killed `beforeAll` created a template clone the killed `afterAll`
never dropped and the clone counter restarts per file. Report what the command prints, or the next
reader thinks they have found an unrelated bug. Third, `docker images` cannot show that an image was
cached BEFORE a run rather than pulled during it — both answers look alike;
`docker image inspect <image> --format '{{.Metadata.LastTagTime}}'` is the one that discriminates.

**The bare-name grep trap recurred on #435**, one conversion after #431 recorded it, and in the same
place: the commit message claimed `grep -rn usePgliteDb <package>` exits 1, while the branch's own
rewritten `vitest.config.ts` comment is a line that grep returns. A round-three reader then caught
the correction quoting a LINE NUMBER for that comment which the branch's later edits had already
moved. The rule that survives both: a conversion states the CALL-form grep
(`grep -rnE "usePgliteDb[(]"`), never the bare name, and does not number a line in a file it is
still editing.

**`packages/credentials` converted, LANDED as #440 on 2026-09-19** (main `e050cbfb`) — the tenth
package of the rollout, four test files and four calls, plus the corrected `vitest.config.ts`
comment, which is why the bullet above no longer names it. Four things to carry, three of them about
method. **First, the docs sweep this section asks for has to be the path grep ALONE.** Narrowing it
by a second condition — the document must also contain the word `usePgliteDb` — took eight matching
documents down to two and threw away the one that carried a designation. That is the same trap
recorded above in a new dress: a pattern assembled around the claim answers a different question and
the answer reads like the one you asked for. **Second, one document can carry the same designation
several times.** `docs/superpowers/plans/2026-09-07-fiscal-cert-distribution.md` points at
`packages/credentials/src/store.test.ts` in three places — a comment inside its test sketch, the
parenthetical under that sketch, and its placeholder scan — so the branch added ONE dated pointer
that names all three rather than three pointers. **Third, the `--hookTimeout=50` probe becomes
evidence when it carries a positive control, and this one discriminated in both directions in a
single run:** a temporary suite with an untimed 200ms `beforeAll` printed `Hook timed out in 50ms`
while all four PGlite suites passed under the same ceiling, and `credentials.test.ts` failed inside
`useTemplateDb`'s `beforeAll` — a hook `hookTimeout` really does bound. Fourth, the run-it seat
MEASURED the half every earlier conversion had only read, by injecting 500ms delays into both
helpers' `afterEach` and `afterAll` under a 300ms limit and watching each one time out; ask it for
that experiment again rather than restating the reading. One sizing error worth naming: a sibling
survey that compared "the four packages converted before this one" was false — nine were, and two of
the five it skipped bore on its own argument. Which package is NEXT is the plan's step-5 command run
on the tree you are converting, never a name written here — the one that used to stand here went
stale the moment the package it named was converted.

**`packages/scheduler` converted, LANDED as #442 on 2026-09-19** (main `6fc919d9`) — the eleventh
package of the rollout, four test files and four calls, plus the corrected `vitest.config.ts` comment
that is why the bullets above no longer name it. FOUR REVIEW ROUNDS again, every finding in prose,
and rounds three and four each broke sentences the round before had written. Five things to carry,
four of them about method.

**First, a package's BRANCH coverage percentage cannot be compared across runs, and this rollout
already knew it.** A draft claimed "the same coverage figures" from one run on each side; the run-it
seat ran both and got 97.02% on the base against 97.05% on the branch. Running the BASE twice is what
settles it — it printed both figures itself, as did the branch. Statements, lines and functions were
identical throughout. `docs/developers/testing-guide.md` had recorded exactly this, measured in this
same package a day earlier ("Compare statements; do not quote a branch delta"), and the pre-landing
docs sweep could not surface it: that grep matches a package's TEST PATHS and `vitest.config`, so a
guide that discusses the package by name is invisible to it. **Widen the sweep, or accept that it
misses prose about the package that never names one of its files.**

**Second, "the file is not there" does not tell you it was never there.** A draft asserted that the
plan's RLS suite "never landed", on `find packages/scheduler -name "*rls*"` returning nothing — a
probe that reads the same whether a file was never written or was written and later deleted. It was
deleted: `packages/scheduler/src/scheduler.rls.test.ts` landed with its plan in `11f16ac6` and went
in `fd6da988` when row-level security was dropped. `git log --all --diff-filter=A` and
`--diff-filter=D` on the path is the probe that discriminates.

**Third, the over-correction went the other way and needed a third pass.** The fix for "never landed"
was "the sentence was TRUE when written" — also false, because the sentence named two suites and one
of them booted PGlite from the day it landed. What finally held was going CLAUSE BY CLAUSE and saying
of each what it described and when that moved. A dated pointer on a finished plan is worth writing
that way: the plan is not wrong, its subject moved.

**Fourth, ask the run-it seat to measure the hooks a ceiling run cannot reach.** `--hookTimeout=50`
with a control establishes the ceiling is in force and that the PGlite suites pass under it, and
nothing more — the remaining hooks are simply fast. The seat injected delays into each one instead
(200ms into the helper's `afterEach`/`afterAll`, 800ms into the seed hooks and the concurrency
suite's `beforeAll`, 200ms into `globalSetup`, 800ms into the direct boot inside an `it`) and watched
each behave as claimed. One hook was then DROPPED from the comment rather than asserted —
`useTemplateDb`'s own `afterEach`, which this package cannot exercise because its one caller passes
`resetPerTest: false`. A list is worth more when every item on it was run.

**Fifth, a config comment that names `createPgliteDb` answers the diagnostic grep about itself.** The
class of false `hookTimeout` claim above is identified by
`grep -rlE "createPgliteDb|describeEachTarget" --include="*.ts" packages/<pkg>`, which matches a
`.ts` config file. Scheduler's replacement comment deliberately writes neither word — the same shape
as the bare-name trap #435 recorded, one layer along.

**`packages/payments-sumup` converted, LANDED as #446 on 2026-09-19** (main `7e9c5f1c`) — the
twelfth package of the rollout, five test files and five calls, plus a corrected
`vitest.config.ts` comment and one dated pointer on a finished plan
(`docs/superpowers/plans/2026-09-10-payments-sumup.md`, whose Task 3 and Task 4 sketches both wrote
the old helper). FIVE review rounds this time, every finding in prose again, and rounds four and
five each broke sentences the round before had written. Four things to carry.

**First, a THIRD shape of false timeout claim, and nothing was tracking it: one about
`testTimeout`.** The two shapes above are about `hookTimeout` (it does not bound the PGlite boot)
and about `globalSetup` (vitest bounds it by neither budget). This one is different: this package's
config said Vitest's five-second default `testTimeout` was "a live risk" for the PGlite start-up and
for the real-PostgreSQL suite's clone of the migrated template — two costs the same sentence places
in a `beforeAll`, which is not a test body. **`packages/payments-stripe/vitest.config.ts` carries it
word for word and is still standing**, found with `grep -rn "live risk"` over the whole tree with no
file-type or directory filter. Correcting it needs that package read against its own suites, which
this branch did not do.

> **2026-09-20 — no longer standing.** The `packages/payments-stripe` conversion read that package
> against its own suites and corrected the comment. The only live config comment `grep -rn "live
> risk"` still returns is `packages/db/vitest.config.ts:11`, which nothing tracks; the grep's other
> hits are this file's own prose — including this sentence — and two historical plans.
>
> That one is NOT the same claim, and a conversion should not correct it by copying stripe's fix.
> Only its first sentence is in question: "every test here boots a WASM PostgreSQL", written above
> `testTimeout: 30_000`. Three boot classes actually live there, and `testTimeout` reaches one of
> them — direct `createPgliteDb()` calls inside an `it` body (`packages/db/src/migrate.test.ts`,
> `client.test.ts` and four other files). The `usePgliteDb` suites boot in a `beforeAll` the helper
> times itself, bounded by neither setting, and the `describeEachTarget` files boot per test in an
> untimed `beforeEach` that `hookTimeout` bounds. So the sentence is too wide rather than false, and
> "nowhere else in the repo" is a second claim nobody has checked. Its `hookTimeout` sentence, by
> contrast, is TRUE and must not be swept up with it: `client.test.ts:101`, `migrate.test.ts:109`
> and `testing/networked-postgres.test.ts:12` each start a Testcontainers PostgreSQL in an untimed
> `beforeAll`. Read, not run — whoever converts `packages/db` owes it the run.

**Second, and this one retires a probe several conversions have leaned on:
`--hookTimeout` on the command line does NOT reach a project that sets its own.** Measured on this
package: `npx vitest run --project node --hookTimeout=1` passes all 114 tests with no hook timeout
at all, while the same 1ms value written into a config kills the reset and close hooks a PGlite
suite gets (`Hook timed out in 1ms` at `packages/db/src/testing/lifecycle.ts:148` and `:153`,
reproduced in a throwaway project and in `packages/fiscal-none`, which defines no projects and so
does take the flag). `--testTimeout` demonstrably does reach such a project, which is what makes the
asymmetry visible at all. So wherever a package's vitest config splits into projects and the project
states a `hookTimeout` of its own, the `--hookTimeout=50` run the entries above describe is INERT,
and passing under it is not a receipt for anything. Check the config before quoting such a run; the
probe that discriminates there is writing the value into the project.

**Third, a sibling survey must count, not gesture.** A draft said the replacement comment says what
each budget bounds "which the earlier conversions' comments do". Of the eleven conversions before
this one, only six touched a `vitest.config.ts` at all (`git show --stat` on each), and of those six
only four name a hook of their own that `hookTimeout` bounds — `printing`, `workforce-es`,
`credentials`, `scheduler`. `provisioning` and `recipes` state only what it does not bound. This is
the same shape as #434's rule about naming files that carry a claim, one step along: do not
characterise a group of siblings you have not enumerated.

**Fourth, the self-referential trap recurred as a COUNT rather than a grep.** The branch's own dated
pointer said the plan document "contains exactly those four mentions" of the old helper — false the
moment the pointer, which writes the name itself, is added; `grep -c` returns five. #435 recorded
this as a grep problem and #431 before it; it is really a problem with any statement a document
makes about its own text. Also worth noting, because it is the reason the branch's grep receipt
survives: the replacement config comment deliberately does not write the old helper's name, so
`grep -rn usePgliteDb packages/payments-sumup` still exits 1. Four of the six sibling comments DO
write it, which is why their packages cannot make the same claim.

**One method note about review dispatch, not about the code.** The convention reviewer and the
Codex run-it seat were pointed at the SAME temporary checkout, and the run-it seat mutates its
checkout to run experiments — so the convention reviewer reported the seat's live probe lines as
branch changes. Give each read-only reader its own checkout, or point it at the branch worktree.

**`packages/venue-service` converted, LANDED as #448 on 2026-09-19** (main `ea26beb2`) — the
thirteenth package of the rollout, five test files and five calls, and the first conversion in seven
with NO config comment to correct: this package's `vitest.config.ts` sets both timeout budgets
inside its node project and explains neither. No document was owed a pointer either. Three things to
carry, and the first of them retires a control.

**First, the `resetPerTest: false` mutation is not a general control, and this is the conversion
that shows it.** #421 proved the helper with it and several conversions since have leaned on it, but
run against this package it fails 12 tests in ONE of the five converted files, `operations.test.ts`,
and the other four pass. A conversion using it as its only control would have proved the wrapper
reaches one file in five. What made that one file sensitive is a unique key rather than an assertion
about a vanished row: every test after the first re-seeds the `units` rows `each` and `kg` against
`units_seed_key_key` (`packages/catalogue/src/schema/units.ts:21`), so the reset being off is a
`23505`. The general control, which discriminated here in both directions, is forwarding
`migrations: []` from the wrapper: exactly the five converted files fail (30 of the node project's
36 tests) while `packages/db/src/testing/lifecycle.test.ts`, which calls the old helper directly,
passes all 29 of its tests under the SAME mutation. Use that pair from now on, and expect a package
whose suites never re-insert a globally unique row to be blind to the reset one entirely.

**Second, the docs sweep must be run over the whole tree, not over `docs/`.** This branch's first
sweep said three documents name both `usePgliteDb` and `venue-service`; the real answer is four, and
the fourth is the root `CLAUDE.md`. Scoping a sweep to `docs/` is the same path-set mistake `CLAUDE.md`
§1 already records for `packages/` and `apps/`, and it is easy to make again because the rollout's own
grep pair is written against `docs/`. Nothing went stale here, but the sentence that said so was wrong
about its own scope until a fourth review round caught it.

**Third, a coverage figure has to be written beside the bar it is measured against.** A v8 text
summary prints statements / branches / functions / lines; this repository's `90/90/85/85` shorthand is
statements / lines / functions / branches (`scripts/coverage-thresholds.test.ts`). Line the two up
positionally, as a first draft of this branch's message did, and a PASSING run reads as a branch
failure — 87.02% branches against what looks like a 90 bar and is really 85. Write each number beside
its own bar.

**`packages/payments-stripe` converted, LANDED as #459 on 2026-09-20** (main `6a445202`) — the
fourteenth package of the rollout, ten test files and ten calls, plus the `vitest.config.ts` comment
the list above had been holding open for this conversion. Six packages left after it:
`identity` (13), `reporting` (13), `payments` (14), `db` (20), `fiscal-verifactu` (25),
`apps/server` (56) — re-measure with the plan's step-5 command rather than trusting those. (2026-09-20:
`identity` came off that list with #461, below. The count is dated to #459 and is not maintained
here; run the command.) Four things to carry.

**First, the sweep must be reported PER SWEEP, and reporting the INTERSECTION is #440's mistake in a
new dress.** This branch ran the two prescribed sweeps and reported the one document in BOTH, which
is exactly one file — and that framing hid `docs/backlog.md`, which the first sweep returned on its
own and which owed two corrections. The convention reviewer found it. Sweep 1 returns ten files here
and sweep 2 returns ten; report each list and what each owed, never the overlap.

**Second, BSD `sed` does not understand `\b`, and a half-done conversion passes every grep you would
think to run.** The first pass substituted `\busePgliteDb(` and matched NOTHING, so the ten import
lines were rewritten and the ten call sites were not. `git diff --stat` showed one changed line per
file rather than two, which is what caught it. A conversion's own check is the pair of counts, not
the absence of the old name: the old name was still there, on every call site.

**Third, the `--hookTimeout=50` ceiling probe is INERT against this package** (its node project
states its own `hookTimeout`), and the hooks that ceiling cannot reach need a delay INJECTED into
them. Measured here in both directions: a 3s delay in a hook under an 800ms project ceiling, against
a control at the same ceiling with no delay that passed all 8 tests. `useTemplateDb`'s reset
(`packages/db/src/testing/lifecycle.ts:433`) and teardown (`:440`), the reset and close every PGlite
suite gets (`:148`, `:153`), and a truncate a test file writes for itself all timed out. That is the
experiment #440 asked for and several conversions have restated from reading instead — it is cheap,
and it is what lets the comment name three kinds of hook rather than two.

**Fourth, and it is about METHOD: a prose fix wave needed a THIRD round again, and that round found
NINE defects, one of which was a correction inventing a false claim.** The wave's new backlog pointer
said `packages/db/vitest.config.ts` lines 18-22 carried the #435 `globalSetup` shape. It does not —
`packages/db/src/client.test.ts:101`, `migrate.test.ts:109` and `testing/networked-postgres.test.ts:12`
each start a Testcontainers PostgreSQL in an untimed `beforeAll`, so that config's `hookTimeout`
sentence is TRUE. The same round caught the self-referential trap once more (the pointer writes
"live risk", so it is its own grep hit), a "byte-identical" sibling that differs in two hunks, a
"three settings" that is two, a "nothing else in the package moves" contradicted four paragraphs
later, and a "neither touched here" about two files the commit converts. Run the third round on every
remaining conversion; the corrections are where the false claims are born.

**`packages/workforce` converted, LANDED as #457 on 2026-09-20** (main `a4567862`) — nine test files, nine calls, plus the
`vitest.config.ts` comment the list above named as carrying this rollout's false `hookTimeout`
claim until this change took it out of that list. Four things to carry.

**First, a package holding BOTH a `useTemplateDb` suite and a `useVenueDb` one gets the
`--hookTimeout=50` positive control for free**, with no scratch suite to write. One run of
`src/immutability.test.ts` and `src/absences.test.ts` under that ceiling killed `useTemplateDb`'s
`beforeAll` (`packages/db/src/testing/lifecycle.ts:422`) — so the ceiling was in force — while all
ten of the absences tests passed; `timeoutMs: 50` on that same absences call then killed its own
`beforeAll` (`lifecycle.ts:139`). Both directions, two real suites, one command.

**Second, a throw control and the `migrations: []` control answer different questions**, and a
conversion owes the second whatever else it runs. Both were run here and both discriminated:
making the seam's body throw, and forwarding `migrations: []` from it, each failed exactly the nine
converted files and left the package's other thirteen passing, while
`packages/db/src/testing/lifecycle.test.ts` — which calls the old helper directly — passed all 29 of
its tests under the empty-migrations mutation. The difference is what each one can claim. A throw
fires before any option is read, so it shows only that these call sites reach the seam; that the
seam passes a caller's OPTIONS through is what the empty list shows, which is why #448 made that
pair the general control. Run the pair; a throw is an extra, not a substitute.

**Third, the two documents this branch owed a pointer were both found by the PATH grep**, and one is
a designation of the #440 shape rather than a mention: `docs/superpowers/plans/2026-08-04-identity.md`
step 15 tells the reader to edit "every workforce test's `usePgliteDb({ migrations: [...] })` list".
The same paragraph extends that instruction to `packages/workforce-es`, converted back at #438 and
never pointered here, so one stale instruction can outlive several conversions — a pointer covers
the paragraph, not the package that happens to be in hand.

**Fourth, a "MUST run on real Postgres" written into a plan was falsified by running it**, and the
falsification came from the review seat, not the branch. `docs/superpowers/plans/2026-08-02-workforce.md`
§7 says the role-revocation floor must use a container "or it is theatre", because PGlite's
superuser can `DISABLE TRIGGER` and bypasses RLS. Pointed at the hermetic helper instead, with
nothing changed but the handle it reads, all seven cases of
`packages/workforce/src/immutability.test.ts` still pass — the refused `UPDATE`/`DELETE` and the
`WT001` trigger refusals included. That agrees with `CLAUDE.md` §4, which already says PGlite
enforces a grant once the session assumes the role; the plan's sentence predates it and nobody had
run it. Nothing moved here — where a real-PostgreSQL suite belongs after the storage switch is task
F1's disposition, not a conversion's — but the next reader of that bullet should know the reason
given for the container is not the reason that holds.

**And that conversion did NOT sweep the same reason out of the package it was converting**, which
is worth knowing before someone assumes it did. Three places in `packages/workforce` still give it,
in two files: `src/immutability.test.ts:10-11`, and `src/testing/global-setup.ts:46-47` and
`:57-58`, the last of them inside the message thrown when the shared container will not start. The
conversion commits no edit to either file. #431 is the precedent for leaving them, and it gives
BOTH halves: "the two places this branch already had open stop making the claim, and the third …
is left as it was", and "rewriting it needs the real reason established, not guessed". Do not
confuse that with the rule about a stray MENTION of the helper's name belonging to the final pull
request (the "One exception to 'defer the sweep'" paragraph above): a different rule about a
different thing — #431 swept its own package's cousin of this claim out of a README and a
`vitest.config.ts`, neither of which carries a converted call.

**What the replacement wording should say is not settled, and the obvious candidate does not
survive a reading of the suite.** `CLAUDE.md` §4 says a PGlite session can step back out with
`reset role`, "so it cannot prove code is confined to a role" — which states a necessity, not a
sufficiency. What would prove confinement is a non-superuser LOGIN connection, which real
PostgreSQL supplies and PGlite does not; this package already creates one for its concurrency
suites (`workforce_clock_probe`, `packages/workforce/src/testing/global-setup.ts:65-68`), and these
seven cases take none of it. They run on the clone's SUPERUSER handle (`suite.admin`) and assume
the role inside the transaction: four through `asAppUser` (`packages/db/src/testing/roles.ts`,
whose body is `set local role app_user`) and three with that statement written inline
(`immutability.test.ts:90`, `:110` and `:137`). That is §4's "who the session made itself", not
"who CONNECTED", on both targets. So whoever fixes these three places has to establish what the
container buys this suite before writing it down, and the answer may be nothing.

The same method has already felled this claim's cousin in `packages/provisioning` — a different
claim (creating roles and databases, not grants), falsified by a different experiment (running
`create role` and `create database` against PGlite directly), standing in three different KINDS of
file, one of the three still standing on purpose (recorded above).

Which package is NEXT is the plan's step-5 command run on the tree you are converting, never a name
written here.

**`packages/identity` converted, LANDED as #461 on 2026-09-20** (main `a771d130`) — thirteen test
files, thirteen calls, plus one comment in `src/passkey.test.ts` that named the old helper. The
package's other fifteen test files are accounted for too: four take a real PostgreSQL database
through `useTemplateDb` and are left alone, and eleven open no database at all. Coverage identical
before and after: 28 files, 237 tests, statements 93.1% against 90, branches 85.04% against 85,
functions 99.17% against 85, lines 95.2% against 90 — branches clear their bar by 0.04 of a point
on both sides. Remaining after it, measured on the merged main with the plan's step-5 command:
`reporting` 13 files, `payments` 14, `db` 20, `fiscal-verifactu` 25, `apps/server` 56. Four things
to carry.

**First, a package holding both kinds of suite gets the `hookTimeout` control for free, and this is
the conversion that spent it** — the free-control note #457 left open. One run of
`--hookTimeout=50` over `src/person-locale.test.ts` (a `useVenueDb` suite) and `src/staff.pg.test.ts`
(a `useTemplateDb` one) carries both directions: the template file failed naming
`packages/db/src/testing/lifecycle.ts:422`, its clone of the migrated template, while the PGlite
file passed both its tests. Report WHICH HOOK the timeout names, not the pass count — at 50ms the
count is not stable and the named hook is. With `--testTimeout=1` (suite boots, only bodies fail)
and `timeoutMs: 50` at the call site (`beforeAll` dies at `lifecycle.ts:139`), that is the whole
picture for a package in three runs, and it is cheaper than the delay-injection recipe #459 needed.

**Second, `packages/identity/vitest.config.ts` carries TWO findings and neither was fixed here.**
Its timeout comment states two true sentences and names no helper, so no conversion falsifies it;
what is wrong is only that its position implies those budgets guard the PGlite boot, which the runs
above show they do not — though `hookTimeout` is not idle in this package, since it bounds the
real-PostgreSQL clone those four `useTemplateDb` suites take. Separately, and older: the same
file's single-fork comment carries a 2026-08-20 receipt saying this package's `test:coverage`
"prints 100/100/100/100", which the two coverage runs above contradict, and the conclusion resting
on it ("single-fork is not demonstrably load-bearing for identity's threshold") no longer follows —
branches now clear by 0.04 of a point, which is the margin a cross-fork under-merge would eat.
Somebody has to take both deliberately.

**Third, the Codex run-it seat wedged twice on this branch and produced no report.** Both
invocations ran for hours against a twelve-command brief, the second while the first was still
alive, and they wrote to the same report paths so neither output was trustworthy. They were killed
and the seat was re-run as an Opus subagent with the same brief, which returned in eight minutes
and reproduced every measurement. If a seat has produced no report file after roughly twenty
minutes, check whether it is still running before dispatching a second one — a second dispatch does
not replace the first, it races it.

**Fourth, the third claim-check round is still earning its place, and it found the corrections'
own defects.** Two review seats found five prose defects in this branch — a false sweep-intersection
count, a false claim that five test-file basenames exist elsewhere in the tree, two pointers
asserting their sketches still matched their files, and a `hookTimeout` conclusion wider than its
runs. The round-three read over those corrections then found four more inside them, including a
sentence that generalised two verified sketches to a third which does not have the feature
described. The code was thirteen import lines and thirteen calls and was right the first time; every
defect on this branch, in both waves, was in prose.

**`packages/reporting` converted, LANDED as #463 on 2026-09-20** (main `933c29a1`) — thirteen
test files and fourteen calls (`src/business-day.test.ts` has two, one per database-backed
`describe`), plus the package's `vitest.config.ts` comment, which this section had been holding open
for exactly this conversion. No comment in the package named the old helper, so
`grep -rn usePgliteDb packages/reporting` exits 1 after it. All twenty of the package's test files
are accounted for: thirteen converted, two taking a real PostgreSQL database through
`useTemplateDb({ template: "core" })` and left alone, five opening no database at all
(`grep -rLE "useVenueDb|useTemplateDb" --include="*.test.ts" src test`). There is no other door
either — `grep -rnE "createPgliteDb|describeEachTarget|useRealPostgres" --include="*.ts" packages/reporting`
exits 1. Coverage identical on both sides, measured on `9e23b5dc` with the thirteen files put back
and then restored: 20 files, 204 tests, statements 100% against a bar of 90, lines 100% against 90,
functions 100% against 85, branches 100% against 85. Remaining after it, same command:
`payments` 14 files, `db` 20, `fiscal-verifactu` 25, `apps/server` 56. Seven things to carry.

**First, the two standard controls both ran, and only the THROW one covers every converted file.**
Making the seam's body `throw` fails exactly the thirteen converted files at collection — 0 tests
each, 13 failed / 7 passed, and every one of the thirteen stacks names
`useVenueDb ../db/src/testing/venue-db.ts:26` above the suite's own line — while
`packages/db/src/testing/lifecycle.test.ts`, which calls the old helper directly, passes all 29 of
its tests under the same mutation. Forwarding `{ ...options, migrations: [] }` instead fails only
twelve of the thirteen, 105 of the 204 tests. The thirteenth is `src/business-day.test.ts`, whose
two converted suites evaluate SQL date expressions and never read a migrated table, so an unmigrated
database answers them correctly. **The MECHANISM is general, not a quirk of this package:** the
migrations control reaches only suites that read a migrated table, so run the throw as well.
**The EXPECTATION that followed it here — "expect the throw to be the one that accounts for every
file" — is not general, and the `packages/payments` entry below is the counterexample**, added on
the conversion that found it: every CONVERTED payments suite reads a migrated table, so both controls caught
all fourteen. Run both; which one is wider is a property of the package.

**Second, a `--hookTimeout=50` receipt on the PGlite half is TIMING-DEPENDENT, and an independent
seat falsified one.** This branch first recorded that a 50ms ceiling over `src/counts.test.ts` and
`src/record-daily-close.pg.test.ts` failed both, the PGlite one naming
`packages/db/src/testing/lifecycle.ts:148` through `venue-db.ts:26`. The run-it reviewer re-ran the
same ceiling and got only the `useTemplateDb` clone at `lifecycle.ts:422`; `counts.test.ts` passed.
Both runs happened; what nobody measured is why they differ, so do not explain it — the checkable
part is that two runs of the same ceiling disagreed. **`--hookTimeout=1` is the deterministic version
and says more**, because it discriminates in both directions in ONE run, and both halves are in the
same output. The positive half: the PGlite `beforeAll` survives, so `src/counts.test.ts`'s three
tests RUN — they fail, but only in hooks that fire after a successful boot: the file's OWN untimed
`beforeEach` (`src/counts.test.ts:12`, a seed) and `lifecycle.ts:148` and `:153`, the helper's reset
and close, each stack naming `venue-db.ts:26`. The negative half, printed by the same run: the
real-PostgreSQL file's `beforeAll` DOES time out, at `lifecycle.ts:422`, its clone, and its four
tests are SKIPPED. **Run-versus-skip is the discriminator; the collected count is NOT** — both files
collect their tests either way, because each calls its helper at module top level, so a receipt
resting on the collected count would read the same whichever answer were true. (It is also why the
throw control prints something different again: it aborts module evaluation, so those files collect
nothing at all.) Use 1, not 50, report the named hooks — a suite's own hooks among them, not the
helper's alone — and say whether the tests ran or were skipped.

**Third, correcting a package's `hookTimeout` comment is not the same job in a package that has both
kinds of suite.** The standing bullet above named `packages/reporting/vitest.config.ts` as false for
the usual reason, and it was: every one of the fourteen call sites passes `timeoutMs: 60_000`, so the
helper's own `beforeAll` timeout applies and the config's 180s never does. But "so `hookTimeout`
bounds nothing here" would have been the over-correction, because this package's two real-PostgreSQL
suites call `useTemplateDb` with no `timeoutMs` of their own, and `lifecycle.ts:422` passes
`options.timeoutMs` straight through — undefined, so Vitest falls back to `hookTimeout`, which is why
the clone is what the 1ms run kills. The corrected comment says which hooks each budget reaches and
carries the one command that shows both.

**Fourth, the sweep reported PER SWEEP, which is the thing #440, #451 and #459 each got wrong.** Run
on the base `9e23b5dc`, over the whole tree, non-TypeScript files only, with no second condition:

- **Sweep 1, the converted files' paths — nine documents**, four of which owe a pointer and got one:
  the daily-close plan, the desglose plan and its spec, and the modelo 303 plan. The other five owe
  nothing. `docs/superpowers/plans/2026-08-07-vat-exact-daily-close.md`,
  `…/2026-08-29-dashboard-sales-takings.md` and `…/2026-08-30-kds-order-timing-alerts.md` name a
  converted file but say nothing about which helper it uses; root `CLAUDE.md` names
  `src/top-sellers.test.ts` for the three-product-names rule, which this change does not touch; and
  `…/2026-08-06-counter-pos-prepare-collect.md` names `src/daily-close.test.ts` only in "Modify"
  instructions, two of them, its one helper sentence being the generic one described below.
- **Sweep 2, `usePgliteDb` alone — fifty-four documents**, which is the rollout-wide set rather than
  this package's. Read for what they say about `packages/reporting`, it adds three to sweep 1, and
  the first two are the reason the pointer count is six rather than four — **neither DESIGN spec is
  in sweep 1 at all**, because neither writes out a converted file's path: the daily-close design
  spec and the modelo 303 design spec, both pointered here, and
  `docs/superpowers/specs/2026-08-06-counter-pos-prepare-collect-design.md`, which owes nothing.
- **Sweep 3, the converted files' basenames — ten documents**, adding exactly one to sweep 1:
  `docs/superpowers/specs/2026-08-29-dashboard-sales-takings-design.md`, which contains no PGlite
  mention at all and owes nothing.

**Fifth, the "generic discipline sentence" class is a GREP, not a count.** The sentence that tells a
reader to let the helpers own the database, rather than describing any particular suite, is spread
across several plans and both house-rule documents. Two carry it in the wording this sweep met —
`docs/superpowers/plans/2026-08-06-counter-pos-prepare-collect.md:82` and its design spec at `:534`;
root `CLAUDE.md:440` and `docs/developers/testing-guide.md:51` say the same thing in different words;
and `git grep -nE "usePgliteDb.?/.?useRealPostgres|useRealPostgres.?/.?usePgliteDb" -- . ':(exclude)*.ts'`
finds four more plans besides. None of them describes a reporting suite, and this section has already
decided the class belongs to the last pull request, the one that writes the house rule and its guard,
so all of them are deliberately left. **Give the grep rather than a number** — the first draft of
this paragraph said "four", which is the same over-narrow shape it was written to warn about.

**Sixth, a twin count, for whoever repairs either of these.** Two clauses this branch raises in one document
each are stated many more times across the six it had open. It names where, inside the pointer that
raises each, rather than scattering the same note through documents that already carry a pointer.
`record-daily-close.rls.test.ts`, a file that no longer exists, is named three times: the desglose
spec's §7 paragraph and its claim/receipt table, and the desglose plan's instruction to "Mirror
`record-daily-close.rls.test.ts:1-45`". The `98/98/98/95` coverage bar is stated twelve times in
three spellings — ten as that literal, one as "statements 98 / lines 98 / functions 98 / branches 95"
and one as a `thresholds:` config sketch — though `packages/reporting`, `packages/identity` and
`apps/server` all declare `{ statements: 90, lines: 90, functions: 85, branches: 85 }`.

**Last, a shell trap that silently edited nothing and read like a missing path.** `zsh` does not
word-split an unquoted parameter, so `perl -pi -e '…' $FILES` with a newline-separated file list
passes ONE argument containing newlines; perl then prints a `Can't open …` line naming each path,
which looks exactly like running from the wrong directory. Nothing was modified, exit status 0, and
the following `grep` correctly reported the work still to do. Pipe the file list into `xargs`
instead. This is the same class as the repository's `pnpm --filter ""` and unquoted-`$PACKAGES`
traps in `CLAUDE.md` §2, in a different shell.

**`packages/payments` converted, LANDED as #464 on 2026-09-20** (main `1d056b00`) — fourteen
test files and fourteen calls, one per file, plus one
doc comment that named the old helper in prose (`src/node-column.test.ts:14`) and the package's
`vitest.config.ts` comment, which the `hookTimeout` section above had been holding open for this
conversion BY NAME. After it, `git grep -n usePgliteDb -- packages/payments` exits 1, comments
included. **Use the `git grep` form and not `grep -rn`**, which the rollout's earlier entries wrote:
a checkout whose `test:coverage` run of that package was INTERRUPTED before it reported keeps
gitignored V8 JSON under `packages/<pkg>/coverage/.tmp/` whose `functionName` fields name
`usePgliteDb` — `venue-db.ts` imports `lifecycle.ts`
(`packages/db/src/testing/venue-db.ts:26` → `packages/db/src/testing/lifecycle.ts:129`), and V8
records every function in a loaded script. **This sentence took three tries, and both wrong versions
are worth the line.** It first said the artefacts hold PRE-branch source text: false, they are a
POST-conversion run's, and the same four files carry `useVenueDb` and `venue-db.ts` too. Correcting
that, it then said a fresh run can never clear them — also false, and false in the direction a later
converter would act on. A run that REACHES its reporting step deletes the directory
(`cleanAfterRun`, `promises.rm(this.coverageFilesDirectory, …)`, called from `reportCoverage` in
`vitest/dist/chunks/coverage.*.js` on a non-watch run). The observable — taken in the branch's own
working tree, a transient state no commit records, so reproduce it by interrupting a coverage run
rather than by looking for it: four converted
packages whose runs completed — `workforce`, `catalogue`, `core`, `identity` — have an HTML report,
no `.tmp`, and `grep -rn usePgliteDb packages/<pkg>` returns NOTHING; `payments` and
`fiscal-verifactu`, whose runs were interrupted, have `.tmp`, no report, and return 4 and 76 hits.
So the reason to prefer `git grep` is not that the hits are durable — it is that `git grep` never
reads a gitignored file at all, so the receipt does not depend on how the last run ended.
All thirty-two of the package's test files are accounted for: fourteen converted, nine taking a real
PostgreSQL database through `useTemplateDb({ template: "core_payments" })` and left alone, nine
opening no database at all (`grep -rLE "useVenueDb|useTemplateDb" --include="*.test.ts" src test`
returns exactly those nine). Coverage identical on both sides, measured on the base `68e36c6a` by
putting the fifteen changed files back, running, and restoring from saved copies: 32 files, 414
tests, statements 99.42% against a bar of 98, lines 99.68% against 98, functions 100% against 98,
branches 97.59% against 95. The branch run prints the same four figures and the same file and test
counts. Remaining after it, on the plan's step-5 command: `db` 20 files, `fiscal-verifactu` 25,
`apps/server` 56. Three things this one adds to what the rollout already carries.

**First, `packages/payments` is the first package in this rollout where the two standard controls
agree exactly, which narrows what the reporting entry above led a reader to expect.** Making the
seam's body `throw` fails exactly the fourteen converted files and no other file in the
package; forwarding `{ ...options, migrations: [] }` fails **the same fourteen**. Reporting's
migrations control was blind to one file (`src/business-day.test.ts` only evaluates SQL date
expressions and never reads a migrated table), and that entry generalised from it to "expect the
throw to be the one that accounts for every file". The MECHANISM behind reporting's result still
holds and is not contradicted — the migrations control reaches only suites that read a migrated
table — but every one of the fourteen CONVERTED suites here reads one, so nothing is blind to it.
Which control is wider
is a property of what a package's suites read. Run both; the agreement is the finding, not the
method. (Reporting's paragraph above is edited to say so, rather than left to mislead the next
converter.)

**Second, this package has ONE door into PGlite that step 5 does not convert, and it is in a file
step 5 DOES convert.** `src/migrations.test.ts` takes its suite database through the seam like the
other thirteen, and separately opens a second, unmigrated database inside an `it` body (`:27`) to
exercise what happens when the payments migrations run before core's. That second one is F1's, with
the rest of the 66-test disposition, and leaving it is what keeps the case honest — a migrated
database cannot show a missing FK target. So
`git grep -nE "createPgliteDb|describeEachTarget|useRealPostgres" -- packages/payments` does NOT
exit 1 here, unlike in reporting, and a converter who expects it to will think the job is
unfinished. It is not: the check that matters is the narrower one the plan states — no test SUITE
asks for its database through the old helper. **That grep returns three lines in TWO files, not
one**, and the second is not a door at all: `src/testing/global-setup.ts:21` mentions
`useRealPostgres` in prose, describing a per-file `probeRole` argument from before the shared
container existed. No payments suite calls that helper — all nine real-PostgreSQL suites take
`useTemplateDb({ template: "core_payments" })`. It is a comment carrying history rather than an
invariant (`CLAUDE.md` §1), so it will go when somebody is editing that file for its own reasons;
it is named here so the next reader of the grep is not surprised by it.

**Third, the `--hookTimeout=1` control discriminates here in one run over two files**, because this
package holds both kinds of suite. `vitest run src/policy.test.ts src/store.pg.test.ts --hookTimeout=1`:
all eight of the PGlite file's tests RUN (6 pass, 2 fail), failing only in hooks that fire after a
successful boot — its own `beforeEach` (`:37`) and the helper's reset and close (`lifecycle.ts:148`
and `:153`), each stack naming `venue-db.ts:26`. In the same output the real-PostgreSQL file's
`beforeAll` times out at `lifecycle.ts:422`, its template clone, and all seven of its tests are
SKIPPED. Run-versus-skip is the discriminator; the collected count is not, because both files
collect either way.

**Fourth, the docs sweep, reported per sweep with its command — because a sweep stated as a NUMBER
is the one thing in this section a reader cannot check.** The convention reviewer on this branch
tried five readings of "17 files" and reproduced none of them, because the sweep's own expression
was not written down; the run-it seat, given the expression, got 17 first time. State the command
or state nothing.

**Writing a sweep's expression into the file the sweep searches makes it match its own text**, which
is the same self-answering shape as the `createPgliteDb` note above. Stated unscoped, the "returns
nothing" below returned four lines of this entry, and sweep three's total went from 10 to 11 the
moment the command was written down. So **sweep three carries an exclusion and its count is for that
excluded scope**; sweeps one and two do NOT exclude this file, and their counts include it — each
says so beside the command, because an exclusion there would hide a real hit rather than a
self-match.

```bash
# one — markdown naming the old helper anywhere: 54 files (this file is one of them)
git grep -l usePgliteDb -- '*.md'
# two — markdown naming one of the fourteen converted files: 17 files (this file is one of them)
git grep -lE "packages/payments/src/(async\.wiring|manual|manual\.wiring|migrations|node-column|offline\.wiring|policy|reconcile|reconcile\.wiring|simulator|store|wiring)\.test\.ts|packages/payments/src/testing/fake-(async-)?provider\.test\.ts" -- '*.md'
# three — markdown ELSEWHERE naming the package's vitest config: 5 files, 9 lines,
# plus this file's own bullet, corrected here, for 6 and 10
git grep -n "packages/payments/vitest.config.ts" -- '*.md' ':(exclude)docs/backlog.md'
```

Sweep one's 54 hold no claim about a `packages/payments` suite:
`git grep -n -C3 usePgliteDb -- '*.md' ':(exclude)docs/backlog.md'`
filtered to lines naming `packages/payments` or `@waitron/payments`, excluding the sumup and stripe
packages, returns nothing. Sweep two's 17 are `docs/backlog.md` (this entry), `scripts/schema-equivalence.md`
(which says `src/migrations.test.ts` asserts a lookup table is gone — still true, nothing to do with
the helper), and 15 historical plans and specs describing how these files were CREATED, none of
which states which helper any of them uses today. Sweep three's 9 lines, across 5 plans, are
about coverage thresholds, the file's original creation, or a `git add` command — none about
`hookTimeout`. **The scope is markdown, which is narrower than the sibling's** (reporting swept
every non-TypeScript file), and the narrowing is safe only because it was checked:
`git grep -l usePgliteDb -- . ':(exclude)*.ts' ':(exclude)*.md'` exits 1, so today markdown is the
whole of it. State the path set — `CLAUDE.md` §1 — rather than letting a reader assume the wider one.

**`packages/db` converted, LANDED as #467 on 2026-09-20** (main `b2a7f3d5`) — twenty test files and
twenty-one calls (`src/node-membership.test.ts` has two), plus the package's `vitest.config.ts`
comments and a paragraph of `packages/db/README.md`. This is the package that OWNS both helpers, so
the four files allowed to name the PGlite one stay untouched: `src/testing/lifecycle.ts` and
`src/testing/venue-db.ts`, which define them, and both their contract tests. After it,
`git grep -nE "usePgliteDb[(]" -- packages/db` returns four lines and all four are allowed: the
definition (`lifecycle.ts:129`), the wrapper's forwarding call (`venue-db.ts:26`) and the old
helper's two contract-test calls (`lifecycle.test.ts:27` and `:68`).
Remaining: `packages/fiscal-verifactu` 25 files, `apps/server` 56. Five things to carry.

**First, the two standard controls agree EXACTLY here**, as they did in `packages/payments` and did
not in `packages/reporting`. Each accounts for the same 21 files — the 20 converted plus
`src/testing/venue-db.test.ts`, the seam's own contract test — and nothing else: the throw gives
`Test Files 21 failed | 49 passed (70)`, and `{ ...options, migrations: [] }` gives the same 21
files and `Tests 117 failed | 487 passed | 24 skipped (628)`, failing `42P01`. The negative control
held: `src/testing/lifecycle.test.ts`, which calls the old helper directly, passed all its tests
under the throw. Three data points now, and they do not agree on which control is wider — take both
every time, and do not predict the result.

**Second, a contract test of the helper is not automatically out of scope, and the argument to leave
it alone is worth answering rather than assuming.** `src/testing/reset-append-only.test.ts` is a
proof ABOUT the per-test reset and lives beside `lifecycle.test.ts` in `src/testing/`, so there was
a real case for treating it as a fifth excluded file. It was converted, because the plan's step-5
command selects it and the established exclusion is exactly four; inventing a fifth with no owner
present is the wider change, not the narrower one. Converting it cost two prose corrections, below,
both in a comment about a fiscal-critical guarantee.

**Third, deleting a helper's name from a comment can widen the claim the comment makes.** That file
opened "Proof that `usePgliteDb`'s per-test reset…", and the first rewrite dropped the qualifier
because the file no longer called it. That word was the only thing scoping the sentence to one
engine — and `src/testing/reset-append-only.pg.test.ts` exists precisely because `ENABLE ALWAYS` is
the one trigger state whose effect differs by engine. It now reads "the PGlite per-test reset",
which is what the file runs. The same paragraph also carried a false clause on BOTH sides of the
diff — "without this file nothing exercises the disable→truncate→restore cycle" — which the Codex
seat falsified by instrumenting `applyReset` and running `venue-db.test.ts` alone. What is unique
there is the ASSERTION, not the cycle, and the narrowing needs its own qualifier: `buildResetPlan`
collects TRUNCATE-level triggers only (`src/testing/lifecycle.ts:93`), so only a suite whose schema
HAS an append-only table runs it at all.

**Fourth, this package's `hookTimeout` item is closed, and it has THREE cases, not two.** The
standing list above had `packages/db/README.md`'s sentence open because correcting it meant deciding
what to say about both halves. Measured with `hookTimeout: 1`: a PGlite suite dies in `afterEach`
(`lifecycle.ts:148`) and `afterAll` (`:153`) and never in `beforeAll`, which carries its own 60s
(`:22` and `:146`); a `useTemplateDb` suite naming no `timeoutMs` dies in `beforeAll` (`:422`,
argument at `:431`), on the template clone. **The third case is the one the first correction missed
and then dismissed the old sentence over**: `src/testing/networked-postgres.test.ts:12` is a
hand-written `beforeAll` that starts a Docker network and a real container and declares no budget,
so `hookTimeout` is the only thing bounding it — image pull included, which is word for word what
the old comment said. Every other container-booting hook in the package declares its own. The old
sentence was true of one suite in seventy. **Correcting a false claim by deleting it deletes its
true half**; the branch's first draft also removed that suite's name from this very section while
"fixing" it.

**Fifth, the branch's own re-read found SEVEN false claims inside its first round of corrections**,
one of them the `hookTimeout` dismissal above. The others: a tally in this file left
un-decremented (the same tally whose own warning sits two sentences below it); a receipt-grep that
answers about itself, because the comment sweep returned one line outside the allowed files at the
merge base and two afterwards, the second being a comment the change itself wrote; "every reset-ON
PGlite suite runs the cycle" (only those with a TRUNCATE-level trigger); "15 files open no database"
(15 call none of the five helpers, SEVEN of those reach a real PostgreSQL another way, EIGHT open
none); "at four different moments" (three, two of them at #434); and "one file still calls
`usePgliteDb` on purpose" (two — `venue-db.ts` IS one of them). That round has now earned its keep on
three consecutive branches of this rollout, and on this one it was the only thing between a Critical
false claim about a fiscal-adjacent budget and `main`.

**The documentation sweep, reported per sweep**, over non-TypeScript files, whole tree. Sweep one,
the converted files' paths with no second condition: 32 documents, 14 of which also name
`usePgliteDb`. Five owed a dated pointer and got one — the recipes-allergen plan, the cloud-mirror
C2b plan, membership slices 2 and 4, and membership promotion R2. This file owed a correction and
got one: it had recorded the recipes clause as STILL TRUE, "a package this rollout has not reached",
and this is the rollout reaching it. The other eight owe nothing; so do the 18 that name a converted
file but never the helper, checked for `lifecycle.js`, "PGlite lifecycle" and `pglite` as well.
Sweep two, `usePgliteDb` alone: 54 documents, adding NOTHING here — of the 40 it holds that sweep one
does not, 13 put a `packages/db/src` path within six lines of the helper, and every one of those
paths is a helper file, a helper's contract test, a schema source or `src/english-only.ts`, never a
file this conversion touched.

**`packages/fiscal-verifactu` converted, LANDED as #468 on 2026-09-20** (main `5f28943f`) — twenty-five test files and twenty-seven calls
(`src/reserved-series.test.ts` and `src/slot.test.ts` have two each), plus three comments inside
those files and the package's `vitest.config.ts`. Every import was a lone
`import { usePgliteDb } from "@waitron/db/testing/lifecycle.js"`, so no import had to be split, and
after it `git grep -nE "usePgliteDb" -- packages/fiscal-verifactu` returns ONE line, in a file this
step does not reach. **`apps/server` (56 files) is the last package**, then the house rule and its
guard. Four things to carry.

**Two findings this pull request deliberately did NOT take, so nobody re-derives them.** The
`simplify` lens wanted `src/registro-sif.test.ts:26` reworded, on the grounds that its contrast now
points at a helper no live call site in the package uses; the convention reviewer argued the opposite
and cited this file's own rule from #431 — a stray mention elsewhere in a package belongs to the
final sweep, a pointer at a converted call belongs to the conversion — so it stays, and the final
pull request of this rollout owns it. Separately, one twin of the retired `hookTimeout` claim is
still standing in plain prose: `docs/superpowers/plans/2026-07-26-tenant-credential-vault.md:139`
sketches `packages/credentials/vitest.config.ts` saying "Both costs are one-off, paid in a beforeAll."
That one belongs to #440, whose sibling sketch in the recurring-work-scheduler plan already got a
dated correction; it is recorded here because the sentence above about "none of the six" is about six
CONFIG files and a reader could take it for a statement about the class.

**First, the two standard controls DISAGREE here, and the disagreement has a reason.** The throw
accounts for exactly the 25 converted files and nothing else — `Test Files 25 failed | 17 passed
(42)`, the 17 being the seven `useTemplateDb` suites, the three that open a database in a hook of
their own and seven that open none. `{ ...options, migrations: [] }` accounts for 24 of the same 25
(`24 failed | 18 passed`, `Tests 186 failed | 183 passed | 34 skipped`, failing `42P01` —
`relation "tenants" does not exist`). The one it misses is `src/migrations.test.ts`, which already
passes `migrations: []` itself and applies the manifest inside its own `setup` (`:20-26`), so the
mutation is a no-op there — it still went through the seam, which the throw proves. Four data points
now across four packages, two agreeing and two not: **run both, and do not predict which is wider.**

**Second, this package's `hookTimeout` entry is closed, and it is the last of the six.** The old
comment said every per-suite cost "is paid in a beforeAll", which is the claim this section records
as false. `npx vitest run src/acks.test.ts src/privileges.test.ts src/provisioning.test.ts
--hookTimeout=1` discriminates all three shapes in one run. **FAILED-versus-SKIPPED is the
discriminator** — a `beforeAll` that times out SKIPS its suite's tests, any later hook FAILS them —
**and "failed" is NOT "ran"**, which is the correction the run-it seat forced and is worth carrying:
it tried to establish body execution by instrumenting `acks.test.ts`'s `it` callbacks, got no markers
in EITHER direction (the passing control included), and reported the claim UNVERIFIED rather than
inferring one. `acks.test.ts` (a `useVenueDb` suite) has all ten of its tests FAILED, in the helper's
`afterEach` and `afterAll` (`lifecycle.ts:148` and `:153`, each frame naming `venue-db.ts:26`) and in
its own untimed `beforeEach` (`:40`) — so its boot survived, but that `beforeEach` means its bodies
did not run. `privileges.test.ts` (`useTemplateDb`, no `timeoutMs`) times out in `beforeAll` at the
template clone (`lifecycle.ts:422`) and all five of its tests are SKIPPED. A second run over
`src/registro-sif.test.ts` and `src/restore.test.ts` times out in each suite's own `beforeEach`
(`:22` and `:63`), which is the third shape. The one test that passes there is `restore.test.ts`'s
`installationFloor` block, which opens no database. **The suite that does establish body execution is
`src/provisioning-secret.test.ts`**, and the reason matters more than the result, because the first
draft of this paragraph got it wrong and the fix-wave re-read caught it by running a probe. The
reason is NOT that its teardown fired: an untimed `afterEach` runs even for a test whose `beforeEach`
failed and whose body never ran — measured in a scratch suite where `AFTER_EACH_FIRED` printed and
`BODY_RAN` did not, which is exactly `acks.test.ts`'s situation here. The reason is that **no hook
precedes a body in that file at all**: it declares none of its own, and `usePgliteDb` registers only
`beforeAll`, `afterEach` and `afterAll` (`lifecycle.ts:146-156`), so with its `beforeAll` surviving on
its own 120s budget nothing could have stopped a body. Pick a suite of THAT shape as the
representative next time — one with no hook ahead of the body — and note that "no hook of its own" is
not enough on its own, because the helper registers hooks too.

**This is the first package in the rollout where the route to "not this setting" differs INSIDE one
package, and the first draft of both the comment and this entry missed it.** The entry above records
reporting's fourteen call sites each passing `timeoutMs: 60_000` and payments' fourteen passing none;
here THREE pass `timeoutMs: 120_000` (`src/aeat-transport.test.ts:34`,
`src/provisioning-secret.test.ts:22`, `src/slot.test.ts:72`) and the other twenty-four take the
helper's 60s default, so "the helper's own 60-second `beforeAll`" — which is what both first drafts
said — is a false claim about three of this package's suites. All three reviewers found it, separately.
**The representative was the reason it survived being measured**: the discriminating run above picked
`src/acks.test.ts`, a default-route call site, so both routes printed the same thing and the run
could not tell them apart (CLAUDE.md §1, a class's representative has to be a value the two sides
could treat differently). The missing half, run afterwards: the same flag over
`src/provisioning-secret.test.ts`, a 120s call site, fails all thirteen of its tests in the helper's
reset and close alone — no `beforeEach` frame, which is what distinguishes it from `acks.test.ts`
rather than what it has in common with it. The invariant survives at both routes; the number was
never a property of the package.

**Third, the CLI `--hookTimeout` is not inert here, and the entry above says why.** This config
declares no `projects`, so the flag reaches it — which the runs above measure rather than assume.
Where a config splits into projects and a project states a `hookTimeout` of its own, the same run
proves nothing.

**The documentation sweep, reported per sweep**, over non-TypeScript files, whole tree — and the
path set is markdown alone: `git grep -l usePgliteDb -- . ':(exclude)*.ts' ':(exclude)*.md'` exits 1.
Sweep one, the converted files' paths with no second condition: 29 documents, 12 of which also name
`usePgliteDb`. **Three owed a dated pointer and got one** — the fiscal-record-validation plan (its
step-1 sketch IS `chain.record-validation.test.ts`, and it designates `write-path.e2e.test.ts` as the
harness to follow), the dashboard-alerts plan (its sketch is headed
`// packages/fiscal-verifactu/src/submission-alerts.test.ts`), and the fiscal-none plan, whose
step 6 sends a reader to `drain.test.ts` "for the real `db`/vault fixtures (`usePgliteDb` …)" — a
designation, the same shape this section already records costing something in #438. The other nine
owe nothing, and two of them are the near miss worth naming: the gated-provisioning and
fiscal-restore-hook plans both sketch a `usePgliteDb` suite, and both sketches are `apps/server`
files, which this rollout has not reached. Sweep two, `usePgliteDb` alone: 54 documents, adding
NOTHING here — five of the 42 it holds that sweep one does not put `fiscal-verifactu` within six
lines of the helper, and all five are either a generic "use the helper, never a raw teardown"
instruction or a sketch for a file in `packages/db`, `packages/provisioning` or `apps/server`.

**Task P7 — nothing joins the two database files any more, LANDED as #426 on 2026-09-19** (main `2741f60c`). The storage switch
puts everything the venue owns in one file and this node's own identity in another, and the two can
only be backed up or restored separately if no row in one points at a row in the other. Six such
pointers existed, every one of them from a node's own table into the venue's: a till shift-login
named its person and its till, a dashboard session and a two-factor enrolment named their person, a
Google sign-in ceremony named its person, and a pending ask-to-join named its venue. All six are gone
from the schema; the columns stay and still hold the same ids, they are simply no longer enforced by
the database. Nothing in the product ever deleted a person, a till or a venue — only tests do — so
what those keys really bought was a refusal to write a row naming something that does not exist.

**Five of the six replace that refusal with the request path, and the sixth does not.** The five
identity ones take their id from a row the request had already read. `join_requests.location_id` does
not: it is the node's configured location, which comes from an environment variable and is checked by
nothing when the row is written. A misconfigured venue is now refused one step later, at accept, where the
accepted row — a device or a print agent — still holds a key to `locations`. Worth knowing before someone reads the five
and assumes the sixth.

A new check in the root test project, `scripts/two-file-foreign-keys.test.ts`, fails if a crossing key
appears. It reads drizzle's generated head snapshot per migration set rather than the TypeScript, so
it carries none of the storage engine's types and the flip does not have to revisit it; the gap that
buys, and the date the two readings were compared, are in the guard's own header. Two review seats
rejected the first version — which read the TypeScript through a helper in `packages/db` — and the
reasons are worth carrying: it would have gone vacuous at the flip (every table a `SQLiteTable`, the
check passing over an empty graph), and its package discovery was a regex over each
`drizzle.config.ts` that a seat defeated by changing one config's quote style, passing the guard with
a real crossing key in the tree.

**What P7 left open, none of it blocking.** Three things, each a decision taken rather than an
oversight. (1) **Nothing asserts that `drizzle-kit generate` is a no-op**, so a foreign key declared in
a table file and never generated is invisible to the new check — searched for on 2026-09-19 and there
is no such job or suite anywhere. A guard that regenerates a set into a copy of its migration folder
and diffs it would close that, and the vocabulary rollout already proved that probe works (it is
P1a's control). (2) **Three root-project readings of the schema now coexist** — this check reads the
snapshots, `classification-complete.test.ts` reads the migration SQL for `CREATE TABLE`, and
`module-graph-honesty.test.ts` reads it for `REFERENCES`. A single scanner in
`packages/sync-enrolment/src/migration-tables.ts` returning tables AND foreign-key edges would serve
all three; it was left alone because doing it properly means handling both declaration forms and
subtracting drops by constraint name, which is a change of its own. (3) **The lowercase table-name to
class map is built twice**, here and in `classification-complete.test.ts`, six lines each; extracting
it would mean reworking that guard's duplicate-classifier loop, which carries more risk than the
duplication.

`packages/recipes` and `packages/layouts` are no longer an open question for the COLUMN-VOCABULARY
rollout (task P1b) — the owner removed them from that task's step-2 list, because the tables they
read belong to `packages/db` and its conversion already covers them. Which rollout is now worth
naming: `packages/recipes` was converted by the test-database-helper rollout (task P2) in #434, and
the two lists are unrelated. **The tag `pre-sqlite-migration` marks the last commit that predates any of this
code** (`c9d80c59`, the parent of the harness merge), so you can still read how something worked while
everything ran on PostgreSQL. The
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
- **No relay.** Replication rides the box↔own-cloud-instance WireGuard link; remote access is the
  instance forwarding the box's name down the link without terminating TLS.
- **Handheld kiosk mode is optional, never required** (owner, 2026-09-08) — the baseline is an
  installed home-screen web app plus the till's staff PIN. **The venue OWNS the handhelds** (owner,
  2026-09-18, reversing "most waiters use their own phones"): a member of staff's broken phone is the
  venue's liability, so lockdown and a certificate install are available again. Buy a cheap Android
  with an autofocus camera, plus a spare; NFC is optional and Android-only. Decisions and receipts:
  [2026-09-18-handheld-and-till-hardware-decisions.md](superpowers/specs/2026-09-18-handheld-and-till-hardware-decisions.md).
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

**Cross-cutting infra:** replication (native Postgres logical replication, #280 — DELETED 2026-09-19;
no node replicates to another until slices 3–5 rebuild failover) · membership, promotion and rejoin
(the arc was completed on PostgreSQL, #197–#272; what the deletion took out of it is under
*Replication, membership & failover — residuals*) · backup and restore (BR-1..BR-4 plus the wizard) · SIF
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
**Bizum** (research 2026-08-30; online prices re-read 2026-09-18, receipts in
[2026-09-18-online-payment-providers-bizum.md](research/2026-09-18-online-payment-providers-bizum.md)).
**A Bizum payment costs a FLAT fee, not a percentage** — MONEI is the only provider publishing the
underlying acquiring cost and states it as €0.17 — so a provider that passes that through and marks it
up thinly (Mollie, Sipay) prices Bizum several times below one charging a percentage on top (Stripe,
MONEI). **Stripe's Bizum rate is 1,5 % + 0,25 €, not the 4,99 % + 0,40 € this entry carried until
2026-09-18**; that figure is Klarna's, taken off the wrong row of Stripe's Spanish pricing page. The
earlier 0,4–0,6 % direct figure is untouched and still unverified. SumUp has none — now read off its
checkout API's payment-method enum rather than from marketing copy, which is what makes it settled.
Mollie prices the two figures that would decide this as pass-through without publishing them, so
**a written quote from Mollie and one from the deli's bank are what close this**, not more reading. In
person a dynamic QR works today and the NFC tap is rolling out through late 2026; the
architecture-picking question, unverified, is whether a SumUp or Stripe Tap-to-Pay phone can accept a
Bizum tap — resolve before designing any in-person Bizum UX.

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
- Later kiosk options, none built: Chromium `--kiosk` in the box image, Fully Kiosk resale for
  dedicated tablets, Android Management API enrolment as a Waitron Cloud feature. The counter till
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
`ledger` / `state` / `local` classification — which after the flip chooses which database FILE a table
lives in. Read the residuals below as requirements for what failover is rebuilt INTO, not as
descriptions of code that exists today.

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
a **per-package call**: (a) the `@vitest/coverage-v8` cross-fork branch-merge bug needs `maxWorkers: 1`
where a package runs under `pnpm -r` oversubscription; (b) a shared container is one cluster on a
100-connection budget, so a package whose suites open many backends caps at `maxWorkers: 4`. `packages/db` is the
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
