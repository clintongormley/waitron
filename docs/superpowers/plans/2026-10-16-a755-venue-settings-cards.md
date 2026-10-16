# A755: Venue settings as four cards — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (or
> superpowers:executing-plans when running inline). Dispatch each task as
> `subagent_type: "implementer"`. Steps use checkbox (`- [ ]`) syntax. The owner approved the
> mock-ups as drawn; no approval pause is needed between tasks.

**Goal.** The Venue details tab of Venue settings becomes four cards — Business, Venue, Business
day and Defaults — each with its own action, each editing on its own while the others stay in view
mode. The business-day start shows once. The Venue card's edit form is narrower, puts postcode and
city side by side, has no "?" buttons and says its lock reason and the receipt-address note once at
its foot. The receipt language becomes "Default receipt language" without its legal paragraph, and
in Catalonia editing offers a dropdown holding only Catalan. The "VAT class for new products"
setting moves from the Products and menus → Defaults page into the Defaults card, and that page and
its sidebar entry go. Both settings on the Defaults card are saved under the `venue.configure`
permission, so the VAT default no longer needs `catalogue.manage`.

**Spec.** `docs/backlog.md:1546-1550`; `docs/backlog/service-periods.md:326-357` (read both in
full); mock-ups `docs/backlog/mockups/a755-venue-settings/01-venue-details-view.png`,
`02-editing-the-venue-card.png`, `03-editing-the-defaults-card.png`. The mock-ups still draw the
Tables, Adjustment reasons and Kitchen tabs: **those tabs stay**. A756, A757 and A758 remove them
later; do not touch `apps/dashboard/src/screens/venue-settings-screen.ts`.

**Review path: FULL.** The branch changes a permission on a server route (the VAT default moves
from `catalogue.manage` to `venue.configure`) and a cross-package contract (new
`/management-api/venue-defaults` routes; two old write routes retired). Per-task reviews run on
T1 and T10; `/finish-branch` runs its full wave with two Codex run-it reviews.

**Migration: none.** No table or column changes. The VAT default stays in `catalogue_settings`
(`packages/catalogue/src/settings.ts:12-45`) and the receipt language in `locations.invoice_locales`
(`apps/server/src/location-settings-api.ts:286-289`). No venue reset is needed.

**The PR description must say:**

1. The permission change in one sentence: the "VAT class for new products" default is now read and
   saved under `venue.configure`, not `catalogue.manage`, through `GET`/`PUT
   /management-api/venue-defaults`; `PUT /management-api/catalogue-settings` and `PUT
   /management-api/receipt-language` are gone. `GET /management-api/catalogue-settings` stays
   under `catalogue.manage` (the Products and Menus screens read it) and `GET
   /management-api/receipt-language` stays under `venue.configure` (the Content languages screen
   reads it).
2. No migration, no venue reset.
3. The Products and menus → Defaults page and its sidebar entry are gone; `/manage/catalogue-defaults`
   now opens the session's default page.
4. `fixedReceiptLocale.reason` is kept because the setup wizard still shows it
   (`apps/setup/src/screens/venue-screen.ts:725-727`); only the dashboard stops showing it.
5. A "Changed test checks" section copied from the list at the end of this plan, with each entry's
   before and after.
6. **Stated exception to A331 (Save quiet until something changes):** a Catalan venue whose stored
   receipt language is not Catalan opens the Defaults card's Edit with Catalan already chosen, so
   the draft is changed before the person touches anything. This state comes only from data saved
   before the Catalan rule, and before production any venue may be reset instead of carried forward
   (`CLAUDE.md` §3, last bullet), so the simplest behaviour is kept and pinned by a test (T5b).
7. **No placeholders were added to the Venue card's fields, deliberately.** The "?" texts were
   consequence warnings (`venue-details-panel.ts:47-56`), and the same sentences already appear in
   the review box once a field changes (`:258-268`), so nothing short enough to be a hint was lost.
8. **One sentence dropped from the address note:** "The recorded issuer and trading name stay as
   issued." (`apps/dashboard/src/i18n/strings.ts:830`). The note now reads as the mock-up draws it.
9. **Owner FYI questions** (non-blocking, also in the coordinator's `questions.md`) — the two listed
   under "Owner FYI questions" at the end of this plan.

**Ledger.** The session that runs this plan keeps `docs/handoffs/2026-10-16-a755-venue-settings-cards.md`
(gitignored), updated after every task.

## Global constraints

- Work only in `/Users/clintongormley/workspace/worktrees/waitron-feat-a755-venue-settings-cards`
  on branch `feat/a755-venue-settings-cards`.
- Read before starting: the worktree's `CLAUDE.md`; `docs/developers/design-system.md` → Forms
  (from `:1967`), "Group related fields into cards" (`:3194`), "One action per row or card"
  (`:3216`), "Card action buttons" (`:3297`); `docs/developers/conventions-ui.md:1-60`;
  `docs/developers/testing-guide.md` (browser tests).
- TDD: write the test, run it, see it fail **for the reason stated**, write the least code, run it
  green, commit with `git commit -s`. A missing import or a broken fixture is not a valid red.
- Product text as short as the meaning allows. English and Spanish only: the dashboard's
  `catalogues` table holds `en`, `en-GB`, `es`, `es-ES` (`apps/dashboard/src/i18n/strings.ts:6033-6038`),
  and `es` is typed `Record<StringKey, string>` (`:2999`), so a missing Spanish string fails the
  typecheck.
- Every colour, spacing, radius and font reads a `--wt-*` token. Field width uses
  `--wt-form-max-width` (36rem, `packages/ui-core/src/tokens/structure.css:59`) — the mock-up's
  560 px is drawn, the token is the house width; do not add a new number.
- No new `wt-*` primitive and no change to `wt-card`. The card frame is an app-owned helper (T2):
  `wt-card` has only a `raised` property and a `header` slot (`packages/ui-core/src/components/wt-card.ts`),
  so it cannot draw the editing border or the header action on the right, and changing a shared
  primitive for one screen would bring the token-painting and both-theme accessibility tests a new
  primitive state needs.
- **Each card edits independently** (the spec's "each editing on its own"): opening one card's
  form does not close or block another's, and each has its own draft scope.
- **Every task leaves green every test file it touches** — and each task names the files it must
  run. A task that changes what another file's assertions read (a registration, a stub's shape)
  runs that file too.
- Spanish for "business day": the business-day editor already says "día de trabajo"
  (`business_day.title` "Inicio del día de trabajo", `strings.ts:3799`; `business_day.date`,
  `:3805`), while `venue_details.dayCutover` says "día de actividad" (`:3833`). The new card follows
  the editor: "Día de trabajo".
- Focused runs only: `pnpm --filter @waitron/dashboard exec vitest run <file>` (dashboard tests run
  in real headless Chromium; check `memory_pressure | grep free` first) and
  `pnpm --filter @waitron/server exec vitest run <file>`. Before each commit also run
  `pnpm --filter <pkg> typecheck` and `pnpm format:check`. Read the `Tests` count; a run with no
  count is not evidence.
- An implementer that passes about 150 tool calls with the task unfinished stops at a passing (or
  cleanly red) point, commits, and returns a handover: done, left, files, each check's state.

## Current code (receipts at `13bb9ec1a`)

### The Venue details tab

- `apps/dashboard/src/dashboard-app.ts:301-318` — `CORE_SETTINGS_PANELS`: `venue-details`
  (`requiresPermission: "venue.view"`, rendered read-only without `venue.configure`, `:1852-1858`)
  and `receipt-language` (`requiresPermission: "venue.configure"`). No module puts a panel on the
  `venue-details` tab (grep `tab: "venue-details"` finds only these two).
- `apps/dashboard/src/screens/venue-details-panel.ts` (676 lines):
  - `:535` renders an `h2` "Venue details" (the tab already says it).
  - `:541-559` the issuer as one line `legalName · taxId · country` (`data-test=issuer`) with
    "Change legal name" beside it; `country` is the code (`ES`), not a name.
  - `:566-575` mounts `dashboard-business-day-start-editor`, which shows the current start.
  - `:646-655` view mode `dl`: Venue name, Address (one block, `#address` `:473-482`), Time zone
    and **"Business day starts at" (`:653-654`) — the second showing of the start**.
  - `:659-665` Edit button **below** the list.
  - `:483-527` `#field`: each field in a `div.field` followed by a `wt-help-tooltip` ("?") whose text
    comes from `HELP` (`:47-56`); a locked field with no change is drawn as
    `<strong>label</strong><p>value</p>` with `data-test=locked-<field>` (`:492-496`), and
    `dayCutover` is always drawn that way inside the form.
  - `:461-472` `#lockedNotes` — one sentence per distinct lock reason, `data-test=locked-notes`.
    `REASONS` (`:64-69`) has no sentence for `business_day_history`, which the server sends
    (`apps/server/src/venue-details.ts:102-114`).
  - `:589-596` the address note shows only once an address field changed (`data-test=address-notice`).
  - `:597-618` the review box (`data-test=warnings`): `#warnings` (`:258-268`) repeats the
    name/postcode/city/clock sentences that the "?" buttons also hold, plus the clock preview and
    the acknowledge button. **This stays.**
  - Save already follows A331: `draftScopeFor` (`:206-225`), `saveActionState` (`:534`,
    `:631-638`), early return (`:405`). The `venue-settings-hidden` listener (`:161-164`) ends an
    unchanged edit when the tab is left.
- `apps/dashboard/src/screens/venue-details-form.ts:3-12` — `VENUE_DETAIL_FIELDS` includes
  `dayCutover`; the patch and problem functions stay as they are.
- Server policy: province is refused always (`apps/server/src/venue-details.ts:149`), time zone is
  refused once there are sales, orders, closes or business-day history (`:102-114`). The mock-up
  draws Province as an editable field; A755 does **not** change the server (province edits are a
  separate open decision, `docs/backlog/service-periods.md:64-70`). Province stays a locked row
  (Owner FYI questions, 2).
- `apps/dashboard/src/screens/business-day-start-editor.ts` (553 lines): `:382-418` renders an
  `h3` "Business-day start", a `dl` with "Current start" as `05:00 (Europe/Madrid)`, the pending
  change and its lock time, the locked note, and the Change start / Replace change / Cancel
  scheduled change buttons; `:420-545` the `wt-dialog` editor (unchanged by A755).
- `apps/dashboard/src/screens/legal-name-dialog.ts` — the Change legal name dialog (unchanged).

### The receipt language panel

- `apps/dashboard/src/screens/receipt-language-panel.ts` (300 lines): a group label `h2` above a
  `wt-card` (`:216-218`); an always-open form with its own Save (`:272-287`). With a fixed territory
  language it shows a read-only value, the legal paragraph
  `resolveContentText(fixed.reason, …)` (`:236-242`), and, when the stored language differs, a
  warning and a "Use {fixed}" button (`:243-257`). The content-language warning comes from
  `receiptLanguageWarning` (`apps/dashboard/src/widgets/receipt-language.ts`).
- Client: `getReceiptLanguage`/`putReceiptLanguage` (`apps/dashboard/src/api/client.ts:3011-3017`);
  type `ReceiptLanguage` (`:577-583`); live dependency `getReceiptLanguage: ["locations"]`
  (`apps/dashboard/src/api/live-queries.ts:517`).
- Other reader: `apps/dashboard/src/screens/content-languages-screen.ts:149` watches
  `getReceiptLanguage` — so `GET /management-api/receipt-language` **stays**.
- App-level assertions on the panel registration: `apps/dashboard/src/dashboard-app.test.ts:4624-4627`
  expects the venue-details tab to hold exactly `dashboard-venue-details-panel` and
  `dashboard-receipt-language-panel`; `dashboard-app.venue-settings-unsaved.test.ts:847-860` finds
  `dashboard-receipt-language-panel`. API stubs that the Defaults card will need extended with
  `getVenueDefaults`: `dashboard-app.test.ts:147`, `dashboard-app.settings-panels.test.ts:100`,
  `dashboard-app.venue-settings-unsaved.test.ts:66`, `dashboard-app.unsaved-changes.test.ts:916`.
- Server: `apps/server/src/location-settings-api.ts:248-259` (GET) and `:261-293` (PUT), both
  gated `venue.configure` (`gated` defaults to it, `:109-119`). The PUT refuses a language outside
  the pack's choices, a non-fixed language where one is fixed (`receipt.language_fixed`), and a
  change while an open order holds a line (`receipt.language_orders_open`, `:283-285`).

### `fixedReceiptLocale.reason` — every reader

- Defined: `packages/country/src/country.ts:34-42`; data: `packages/country-es/src/spain.ts:197-203`;
  passed through: `packages/country/src/country.ts:262-276` and
  `apps/server/src/location-settings-api.ts:256`.
- Shown: the dashboard panel (`receipt-language-panel.ts:241`, goes in T7) **and the setup wizard**
  (`apps/setup/src/screens/venue-screen.ts:725-727`, tested at
  `apps/setup/src/screens/venue-screen.test.ts:1430-1462`).
- Asserted: `packages/country-es/src/spain.test.ts:230-250`,
  `packages/country-packs/src/registry.test.ts:216-217`, `packages/country/src/country.test.ts:176`,
  `apps/server/src/location-settings-api.test.ts:392,468`, `apps/server/src/venue-locale.test.ts:121-127`.
- **Decision: keep `reason`.** The setup wizard reads it. A755 only stops the dashboard showing it
  (see Owner FYI questions, 1).

### The VAT default

- Dashboard page: `apps/dashboard/src/screens/catalogue-defaults-screen.ts` (an `h1` plus
  `dashboard-catalogue-settings-panel`); panel `apps/dashboard/src/screens/catalogue-settings-panel.ts`
  (combobox label `catalogue_settings.default_vat`, options `VAT_CLASSES` labelled
  `` `${vatClassName(v)} (${rate}%)` `` at `:198`).
- Registration: `CORE_SCREENS` entry `"catalogue-defaults"` (`dashboard-app.ts:123`); sidebar item
  in the `menu` group with `requiresPermission: "catalogue.manage"` (`:233-237`); render case
  (`:2470-2473`); import (`:71`). `apps/dashboard/src/navigation.ts` does not name it.
- Server: `apps/server/src/catalogue-api.ts:805-831` — `GET` and `PUT /management-api/catalogue-settings`
  and `PUT …/default-color`, all through `gated` (`:793-804`), which calls `authorizeManager` with
  `CATALOGUE_WRITE_PERMISSION = "catalogue.manage"` (`:142`) and sets the menu-revision header on
  every non-GET.
- Readers of the value: `apps/dashboard/src/screens/catalogue-screen.ts:223` (prefills a new
  product) and `apps/dashboard/src/screens/menus-screen.ts:991` (reads `defaultColor` only); both
  keep using `GET /catalogue-settings`. The server never reads `defaultProductVatClass` to create a
  product (grep finds it only in `settings.ts`, `provisioning.ts:65-71` and
  `configuration-transfer.ts:76-83`). **The till does not read it** (grep of `apps/till` finds
  nothing).
- Roles (`packages/identity/src/permissions.ts:45-83`): `supervisor` holds `venue.view` but neither
  `venue.configure` nor `catalogue.manage`; `manager` holds both; `admin` holds all. **No built-in
  role holds `venue.configure` without `catalogue.manage`**, so the "allowed" test withholds
  `catalogue.manage` through a wrapped `authorizeManager`, the pattern in
  `apps/server/src/catalogue-manage-permission.test.ts:15-29`.
- Event stream: `apps/server/src/live-api.ts` checks no permission per resource type (grep for
  `permission|authorize` finds nothing), so a `venue.configure` session may subscribe to
  `catalogue_settings`. `scripts/live-subscriptions.test.ts` only checks that names exist.
- Menu revision: a successful non-GET response without the `x-waitron-menu-revision` header resets
  the client's menu revision (`apps/dashboard/src/api/client.ts:2083-2103`), as every
  non-catalogue write already does; moving the VAT write off the catalogue route therefore resets
  it instead of advancing it. The VAT default is not part of a menu's read model
  (`menus-screen.ts:991` reads only `defaultColor`), so nothing the menus screen shows depends on
  it.

### Strings (`apps/dashboard/src/i18n/strings.ts`, `en` from `:1`, `es` from `:2999`)

`receipts.language*` `:513-528`/`:3520-3536`; `catalogue_defaults.title`, `catalogue_settings.*`
`:718-724`/`:3729-3735`; `venue_details.address_notice` `:829`/`:3797`; `business_day.*`
`:831-855`/`:3799-3824`; `venue_details.*` `:856-916`/`:3825-3886`; `nav.catalogue_defaults`
`:935`/`:3947`.

### Existing tests touched

- Venue details: `venue-details-panel.test.ts`, `.save-state.test.ts`, `.unsaved.test.ts`,
  `.a11y.test.ts`; `venue-details-business-day.test.ts`; `venue-details-form.test.ts` (unchanged);
  `legal-name-dialog.test.ts:40,79,193` (find the panel by `data-test=issuer`).
- Business day: `business-day-start-editor.test.ts`, `.unsaved.test.ts`.
- Receipt language: `receipt-language-panel.test.ts`, `.retained.test.ts`, `.unsaved.test.ts`,
  `.a11y.test.ts`; `receipt-editor-boundaries.test.ts`; fixture
  `apps/dashboard/src/testing/receipt-language-fixture.ts`.
- VAT default: `catalogue-defaults-screen.test.ts`, `.a11y.test.ts`; `catalogue-settings-panel.test.ts`,
  `.save-state.test.ts`, `.unsaved.test.ts`, `.a11y.test.ts`.
- App level: `dashboard-app.test.ts:2985-3045` (three Defaults-page cases) and `:4624-4627`;
  `dashboard-app.settings-panels.test.ts:202-239`; `dashboard-app.venue-settings-unsaved.test.ts:308-400,
  441-486, 872-1000`.
- Client: `apps/dashboard/src/api/client-routes.test.ts:450-466, 1418-1430`;
  `apps/dashboard/src/api/live-queries.test.ts:129, 689-697`.
- Server: `apps/server/src/catalogue-api.test.ts:6463-6510`; `catalogue-manage-permission.test.ts:56-60`;
  `location-settings-api.test.ts:352-545`; `location-settings-api.orders-open.test.ts:63`.
- Guards under `scripts/`: none names `catalogue-defaults`, the panels or the sidebar list (grep of
  `scripts/` for `catalogue-defaults|venue-details-panel|receipt-language-panel|catalogue-settings-panel`
  finds nothing). `scripts/live-subscriptions.test.ts` reads `QUERY_DEPENDENCIES` and must stay
  green after T5a adds a query.

## Tasks

Order: T1 → T2 → T3 → T4 → T5a → T5b → T6 → T7 → T8 → T9 → T10 → T11. T5a needs T1's route shape
and T2's card helper. The Defaults card is built and tested on its own (T5a, T5b) and registered on
the page only in T6, so no task leaves the app-level suites red.

---

### T1. Server: `GET`/`PUT /management-api/venue-defaults` under `venue.configure`

**Files:** `apps/server/src/location-settings-api.ts`; `apps/server/src/venue-detail-types.ts`;
new `apps/server/src/venue-defaults-permission.test.ts`; `apps/server/src/location-settings-api.test.ts`
(new `describe("venue defaults")`).

Shape (declare it in `apps/server/src/venue-detail-types.ts` beside `VenueDetailWrite`; the dashboard
declares its own copy in `client.ts`, as it does for `VenueDetailsModel` at `client.ts:74-86`):

```ts
interface VenueDefaults {
  receiptLanguage: string;                // as stored, even outside the choices
  receiptLanguageChoices: string[];       // the pack's choices
  fixedReceiptLanguage: string | null;    // the one language the law gives the venue here
  defaultProductVatClass: VatClass;
}
// PUT body: { receiptLanguage?: string; defaultProductVatClass?: string } — at least one key,
// no other key. Answers 200 with the VenueDefaults after the write.
```

Both routes use `gated(sessionId, fn)` (`location-settings-api.ts:109-119`, default
`venue.configure`), one `withTransaction` per request. The PUT applies the receipt language first,
with the same checks as today's PUT (extract `:265-290` into `writeReceiptLanguage(tx, locationId,
language)` and call it from both routes until T10), then the VAT class with `saveCatalogueSettings`
from `@waitron/catalogue` (`packages/catalogue/src/settings.ts:37-45`); the GET reads
`readVenueReceiptLanguageRules`, `storedLanguages` and `readCatalogueSettings`. Add
`"product.invalid": 400` to the route's error map (`:29-47`). A body that is not an object, is
empty or has another key answers `management.request_invalid` with `field: "body"`.

- [ ] **Permission tests first** (`venue-defaults-permission.test.ts`, copying the wrapped
  `authorizeManager` from `catalogue-manage-permission.test.ts:15-29`; seed the tenant, a manager
  session, a supervisor session and the one location the read needs — `province 'Madrid'`,
  `invoice_locales ['es-ES']`; if the read needs more, use `setupVenue` as
  `location-settings-api.test.ts:41` does):
  - withholding `venue.configure`: `GET` and `PUT {defaultProductVatClass: "reduced"}` answer 403
    `{ code: "authorization.not_permitted", params: { permission: "venue.configure" } }`, and the
    stored VAT class is unchanged;
  - a **real supervisor session**, no wrapper in play (`gate.withheld = null`): `GET` and the same
    `PUT` answer 403 `authorization.not_permitted` and the VAT class is unchanged;
  - withholding `catalogue.manage`: `GET` answers 200 and the same `PUT` answers 200 with
    `defaultProductVatClass: "reduced"`, and a fresh read shows it.
  - Run: `pnpm --filter @waitron/server exec vitest run src/venue-defaults-permission.test.ts`.
    Expected red: 404 from both routes (they do not exist).
- [ ] **Behaviour tests** in `location-settings-api.test.ts`, reusing the receipt-language describe's
  `at(province, locales, fn)` helper (`:369-383`):
  - Barcelona answers `fixedReceiptLanguage: "ca-ES"`; Madrid answers `null`; a stored language
    outside the choices is answered as stored.
  - `PUT {receiptLanguage: "gl-ES"}` in Madrid stores `["gl-ES"]` and leaves the VAT class alone;
    `PUT {defaultProductVatClass: "zero"}` stores it and leaves the language alone.
  - **One transaction, both directions.** (a) In Barcelona, `PUT {receiptLanguage: "es-ES",
    defaultProductVatClass: "zero"}` answers 400 `receipt.language_fixed` and the VAT class is
    unchanged. (b) **The mirror, which is the case that bites:** in Madrid, `PUT {receiptLanguage:
    "gl-ES", defaultProductVatClass: "bogus"}` answers 400 `product.invalid`
    (`field: "defaultProductVatClass"`) and the stored language is still `["es-ES"]`. Because the
    language is written first, only a shared transaction takes it back.
  - **Deletion control for (b):** temporarily split the PUT into two `withTransaction` calls (the
    language in one, the VAT class in the next), run the file, and see (b) fail with the stored
    language reading `["gl-ES"]`; restore. Record the command and the failure in the commit message.
  - `receiptLanguage` of `null`, `[]`, `10` answers 400 `management.request_invalid`
    `field: "receiptLanguage"`; `defaultProductVatClass` of `null`, `[]`, `10`, `"unknown"` answers
    400 `product.invalid` `field: "defaultProductVatClass"`; `{}` and `{other: 1}` answer 400
    `management.request_invalid` `field: "body"`. Each leaves both stored values unchanged.
  - Anonymous answers 401 and the staff cookie 403 for both methods.
  - Each request opens exactly one write lock — copy the counting `Proxy` from `:485-521`.
  - Run: `pnpm --filter @waitron/server exec vitest run src/location-settings-api.test.ts`.
- [ ] Implement. **Must run green:** `src/venue-defaults-permission.test.ts`,
  `src/location-settings-api.test.ts`, `src/location-settings-api.orders-open.test.ts`,
  `src/catalogue-manage-permission.test.ts`; `pnpm --filter @waitron/server typecheck`;
  `pnpm format:check`. Commit
  `Venue defaults: one route reads and saves the receipt language and the VAT class for new products under venue.configure (A755)`.

**Existing assertions changed:** none in T1 (old routes stay until T10).

---

### T2. Card frame, Business card, the Venue card's view mode, and the cards' order

**Files:** new `apps/dashboard/src/widgets/settings-card.ts`;
`apps/dashboard/src/screens/venue-details-panel.ts`; `apps/dashboard/src/i18n/strings.ts`;
`venue-details-panel.test.ts`, `legal-name-dialog.test.ts`, `venue-details-panel.a11y.test.ts`.

`settings-card.ts` exports `settingsCardStyles` (a `css` block) and two template helpers used
inside a panel's own shadow root (why not `wt-card`: see Global constraints):

- `settingsCard({ id, heading, action, editing, body })` → `<section class="settings-card"
  aria-labelledby=${id} ?data-editing=${editing}>` with a header row (`<h2 id>` at the left,
  `action` at the right) and the body. Border `--wt-color-border`, radius `--wt-radius-lg`,
  surface `--wt-color-surface`, padding from `--wt-space-*`; `data-editing` paints the border
  `--wt-color-primary` (mock-ups 02/03). The header action is a `secondary` `wt-button` (design-system
  "Card action buttons", `:3297`).
- `settingsRows(rows)` → a `dl`: label column muted (`--wt-color-text-muted`), value column
  `--wt-color-text`, two columns at desktop width and label-above-value at phone width (follow how
  `apps/dashboard/src/dashboard-app.ts:152` repeats its `(max-width: 48rem)` breakpoint literally).
  Each value carries `data-test` given by the caller.

In `venue-details-panel.ts`:

- Drop the panel's `h2` (`:535`); delete `venue_details.title` only if grep finds no other reader.
- **Order:** Business card, Venue card, then the business-day editor. Today the editor is mounted
  at `:566-575`, above the Venue list (`:646`); move it after the Venue card so the panel reads
  Business, Venue, Business day (the Defaults card follows as its own panel, T6).
- **Business card**: heading "Business"; rows Legal name (`data-test=saved-legalName`), Tax ID
  (`saved-taxId`), Country (`saved-country`, the country's name in the screen's language:
  `new Intl.DisplayNames([currentLocale()], { type: "region" }).of(code)!`). No `?? code` fallback:
  measured 2026-10-16 on Node v26.11.1, `of("XQ")` answers `"XQ"` (an unknown well-formed code
  comes back as itself) and a malformed code throws `RangeError`, so `undefined` never arrives and a
  fallback would be an uncoverable branch. Add a test that an unknown code `XQ` shows `XQ` in
  Chromium, so the claim is checked in the browser the dashboard runs in. Action "Change legal
  name" (`data-test=change-legal-name`, only when not read-only), still opening
  `dashboard-legal-name-dialog`. Put `data-test=issuer` on the Business card's `section`, so
  `legal-name-dialog.test.ts:40` and `:193` keep finding the legal name inside it.
- **Venue card (view)**: heading "Venue"; rows Venue name (`saved-name`), Address (`address`, the
  existing `#address` block), Time zone (`saved-timeZone`); action Edit (`data-test=edit`, only
  when not read-only). **No "Business day starts at" row** (delete `:653-654`).
- New strings (en / es): `venue_settings.card.business` "Business" / "Empresa";
  `venue_settings.card.venue` "Venue" / "Local"; `venue_details.tax_id` "Tax ID" / "NIF";
  `venue_details.country` "Country" / "País". Reuse `venue_details.legal_name`.

Steps:

- [ ] Tests first (`venue-details-panel.test.ts`): (a) view mode shows a Business card whose rows
  read `Legal name: Issuer SL`, `Tax ID: B12345678`, `Country: Spain` (and `España` under `es`);
  (b) a Venue card whose labels are exactly Venue name, Address, Time zone; (c) the card headings
  are `h2`s "Business" and "Venue"; (d) Change legal name and Edit sit inside their cards' headers;
  (e) read-only shows both cards with no action; (f) in document order the Business card, the
  Venue card and `dashboard-business-day-start-editor` follow one another; (g) `XQ` shows as `XQ`.
  Run `pnpm --filter @waitron/dashboard exec vitest run src/screens/venue-details-panel.test.ts`;
  expected red: no Business card, labels include "Business day starts at", the editor comes first.
- [ ] Update the changed assertions (list below) and implement. **Must run green:**
  `src/screens/venue-details-panel.test.ts`, `.save-state.test.ts`, `.unsaved.test.ts`,
  `.a11y.test.ts`, `src/screens/legal-name-dialog.test.ts`,
  `src/screens/venue-details-business-day.test.ts`, `src/dashboard-app.venue-settings-unsaved.test.ts`,
  `src/dashboard-app.test.ts`; typecheck, format. Commit
  `Venue settings: Business and Venue cards with their own actions (A755)`.

**Existing assertions changed (deliberate, owner-approved mock-up 01):**

- `venue-details-panel.test.ts:95-104` — issuer read from `data-test=issuer` as one string →
  read from the Business card's rows.
- `venue-details-panel.test.ts:550-560` "shows the legal name, tax ID and country as one line" —
  before: one line `Issuer SL · B12345678 · ES`, and the words "Legal name" and "Tax ID" absent;
  after: three labelled rows with the country's name. Rename the case.
- `venue-details-panel.test.ts:562-575` "shows the saved address as one unlabelled block" — before:
  labels include "Business day starts at"; after: they do not (the start shows once, in the
  Business day card).
- `legal-name-dialog.test.ts:79` "beside the identity line" — after: in the Business card's header.

---

### T3. The Venue card's edit form

**Files:** `apps/dashboard/src/screens/venue-details-panel.ts`; strings; `venue-details-panel.test.ts`,
`.save-state.test.ts`, `.unsaved.test.ts`, `.a11y.test.ts`.

- Edit draws the form **inside the Venue card** (`settingsCard({ editing: true })`, no header action
  while editing). The other cards stay in view mode.
- Fields stop at `--wt-form-max-width`. Order: Venue name; Street address; Address line 2;
  Postcode and City **side by side** (`minmax(0, 1fr) minmax(0, 2fr)`, stacked at phone width);
  Province; Time zone.
- A locked field is a row `label   value · locked` (`data-test=locked-<field>`; new string
  `venue_details.locked` "locked" / "bloqueado") instead of `<strong>`/`<p>`. Province is locked by
  the server today, so it shows this way.
- `dayCutover` is not drawn in the form at all (it was a locked row, `:492`).
- Remove every `wt-help-tooltip` from the form, the `HELP` map (`:47-56`), the
  `wt-help-tooltip` import (`:15`) and the `venue_details.help` string. **Add no placeholders**,
  deliberately: the "?" texts are consequence warnings that already appear in the review box once
  the field changes (`#warnings`, `:258-268`); state this in the PR (header, point 7).
- **Foot note, once, at the card's foot above the buttons:** the lock sentences
  (`#lockedNotes`, one per distinct reason) followed by the address note, shown **whenever the
  form is open** (mock-up 02 shows it on an unchanged form). New address-note wording, from the
  mock-up: en "Receipts printed from now on, including copies of earlier sales, use the new
  address." / es "Los recibos que se impriman a partir de ahora, incluidas las copias de ventas
  anteriores, usan la nueva dirección." (replaces `venue_details.address_notice` `:829-830`/`:3797`;
  the dropped sentence is named in the PR, header point 8).
- The review box, clock preview, acknowledgement and Save gating stay exactly as they are; Save
  stays quiet and disabled until something changes (already A331, `:405`, `:534`, `:631-638`).
- `wt-form-actions`: Cancel left, Save right, as today.

Steps:

- [ ] Tests first (`venue-details-panel.test.ts`): (a) no `wt-help-tooltip` anywhere in the open
  form; (b) postcode and city sit on one row at 1280 px (same `top` from `getBoundingClientRect`)
  and stack at 390 px; (c) every field's width is at most the form width token's computed value;
  (d) with a sales lock on the time zone, the foot holds the lock sentence once and the address
  note once, before any change, and the time-zone row reads `Europe/Madrid · locked`; (e) no
  `[data-test=locked-dayCutover]`; (f) the Business card stays in view mode while the Venue card is
  open. Run the file; expected red: tooltips present, address note absent before a change.
- [ ] Update the changed assertions and implement. **Must run green:** the four
  `src/screens/venue-details-panel*.test.ts` files, `src/screens/venue-details-business-day.test.ts`,
  `src/dashboard-app.venue-settings-unsaved.test.ts`; typecheck, format. Commit
  `Venue settings: the Venue card edits in place, narrower, with no "?" buttons (A755)`.

**Existing assertions changed (deliberate, spec point 3):**

- `venue-details-panel.test.ts:112-123` — before: `expect(q(el, "wt-help-tooltip")).not.toBeNull()`;
  after: `toBeNull()`.
- `venue-details-panel.test.ts:412-420` "explains current-address printing for a street
  correction" — before: the address note appears after a street change; after: it is at the foot
  from the moment the form opens (assert both before and after the change), with the new wording
  (the `copies of earlier sales` stem still matches).
- `venue-details-panel.test.ts:422-430` "explains the consequences beside the filled name and clock
  fields" — before: read from the "?" beside each field; after: change the name and the time zone
  and read the same sentences from `[data-test=warnings]`.
- `venue-details-panel.test.ts:432-446` "names opening hours and special dates in the clock warning
  (%s)" — before: read from the time-zone "?"; after: from the review box after a time-zone change.
- `venue-details-panel.test.ts:577-603` "says the sales lock once for the form, tooltips included" —
  drop the tooltip assertion (`:597-601`); the once-only sentence assertion stays. Rename to
  "says the sales lock once, at the card's foot".
- Any case asserting `locked-province`/`locked-postalCode` text keeps its `data-test`; only the
  markup inside changes.

---

### T4. The Business day card: the start shown once

**Files:** `apps/dashboard/src/screens/business-day-start-editor.ts`; strings;
`business-day-start-editor.test.ts`, `venue-details-business-day.test.ts`,
`venue-details-panel.test.ts`.

- The editor renders its own card through `settingsCard`: heading "Business day"
  (`venue_settings.card.business_day`, "Business day" / "Día de trabajo"); rows **Starts at**
  (`business_day.starts_at` "Starts at" / "Empieza a las", value `HH:MM` **without** the time zone,
  which the Venue card shows) and **Scheduled change** (`business_day.scheduled` "Scheduled change"
  / "Cambio programado"; value `date · HH:MM`, or `business_day.none` "None" / "Ninguno"); while a
  change is pending, the existing "Editable until" row (`business_day.locks`) stays.
- Header action: "Change start" (`data-test=change`); with a pending editable change, "Replace
  change" (`replace`) and "Cancel scheduled change" (`cancel-pending`) as today (Open points, 1).
  The locked note (`data-test=locked`) stays below the rows. Read-only shows no action.
- Drop the `h3` (`:382`) and the old "Current start"/"Scheduled start" labels if nothing else uses
  them (grep `business_day.current`, `business_day.pending`). The dialog (`:420-545`) is unchanged.

Steps:

- [ ] Tests first: (a) `business-day-start-editor.test.ts` — rows read `Starts at 05:00` and
  `Scheduled change None`, no `(Europe/Madrid)` in the card, `h2` "Business day"; with a pending
  change, `Scheduled change 2026-11-04 · 03:00`; (b) `venue-details-panel.test.ts` — across the whole
  panel the start time `05:00` appears exactly once, no label "Business day starts at" exists, and
  the panel's `h2`s read, in order, Business, Venue, Business day. Run both; expected red:
  `(Europe/Madrid)` present and the start shown under "Current start".
- [ ] Implement. **Must run green:** `src/screens/business-day-start-editor.test.ts`,
  `.unsaved.test.ts`, `src/screens/venue-details-business-day.test.ts`,
  `src/screens/venue-details-panel.test.ts`, `.a11y.test.ts`; typecheck, format. Commit
  `Venue settings: the business-day start shows once, in its own card (A755)`.

**Existing assertions changed:** none expected — the existing cases assert `05:00`, `data-test`
hooks and the dialog, which stay. If one asserts the old labels, list it in the PR as changed by
spec point 2.

---

### T5a. The Defaults card: client calls, live query and view mode (not yet on the page)

**Files:** `apps/dashboard/src/api/client.ts` (`VenueDefaults` type, `getVenueDefaults()`,
`putVenueDefaults(changes)`); `apps/dashboard/src/api/live-queries.ts`
(`getVenueDefaults: ["locations", "catalogue_settings"]`); `client-routes.test.ts`,
`live-queries.test.ts`; new `apps/dashboard/src/screens/venue-defaults-panel.ts` (element
`dashboard-venue-defaults-panel`) and `venue-defaults-panel.test.ts`; strings. **Do not touch
`CORE_SETTINGS_PANELS`** — registration is T6.

View mode:

- Card "Defaults" (`venue_settings.card.defaults`, "Defaults" / "Valores predeterminados") with
  Edit (`data-test=edit`); rows **Default receipt language** (`data-test=saved-receiptLanguage`;
  change the value of `receipts.language` to "Default receipt language" / "Idioma predeterminado
  del recibo"; its only readers are the panel this replaces) showing `receiptLanguageName(stored)`,
  and **VAT class for new products** (`saved-defaultProductVatClass`, label
  `catalogue_settings.default_vat`) showing `Reduced (10%)` — the label maker from
  `catalogue-settings-panel.ts:198`, moved into a function this file exports.
- The content-language warning (`receiptLanguageWarning`, reading `getContentLanguages`) shows under
  the rows when it applies. No legal paragraph.
- When the stored language differs from `fixedReceiptLanguage`, the existing `receipts.language_stored`
  sentence shows under the rows.
- Reads through the query controller (`DashboardQueries`, as `venue-details-panel.ts:148-157`); a
  read failure shows the message with a Retry (`location_settings.retry`), as
  `receipt-language-panel.ts:220-227`.

Steps:

- [ ] Client tests first: `client-routes.test.ts` — `getVenueDefaults` sends `GET
  /management-api/venue-defaults`; `putVenueDefaults({ defaultProductVatClass: "zero" })` sends
  `PUT` with exactly that body; `live-queries.test.ts` — `getVenueDefaults` depends on `locations`
  and `catalogue_settings`. Expected red: method missing.
- [ ] Card tests first (`venue-defaults-panel.test.ts`): view rows and values in en and es; the
  heading is an `h2` "Defaults"; no element holds `CATALONIA.fixedReceiptLocale!.reason.en`; the
  content warning shows for a receipt language outside the content languages and follows a live
  change; the stored-differs sentence shows for a Barcelona venue stored in Spanish; a read
  failure shows Retry and Retry recovers. Expected red: element missing.
- [ ] Implement. **Must run green:** `src/api/client-routes.test.ts`, `src/api/live-queries.test.ts`,
  `src/screens/venue-defaults-panel.test.ts`; from the worktree root
  `pnpm exec vitest run scripts/live-subscriptions.test.ts`; typecheck, format. Commit
  `Venue settings: the Defaults card's view (A755)`.

**Existing assertions changed:** none.

---

### T5b. The Defaults card: edit, save, refusals, unsaved changes and accessibility

**Files:** `venue-defaults-panel.ts`; `venue-defaults-panel.test.ts`; new
`venue-defaults-panel.unsaved.test.ts` and `venue-defaults-panel.a11y.test.ts`; strings.

- **Edit:** the card draws `data-editing`; two `wt-combobox`es, `name="receiptLanguage"` and
  `name="defaultProductVatClass"`, both required, `search="never"`. Receipt options:
  `[fixedReceiptLanguage]` when one is fixed (Catalonia offers only Catalan), otherwise the choices
  plus the stored language. VAT options: `VAT_CLASSES`. Fields at `--wt-form-max-width`; Cancel
  left, Save right.
- **Save follows changes (A331):** a draft scope from `draftScopeFor` over
  `{ receiptLanguage, defaultProductVatClass }`; Save bound through `saveActionState`; the save
  handler returns early while unchanged. Save sends **only the changed keys** in one
  `putVenueDefaults` call, then returns to view mode with the answer.
- **Stated exception (header point 6):** when the stored language differs from the fixed one, Edit
  opens with the fixed language chosen, so the draft is changed and Save is live before anything is
  touched. Delete `receipts.language_use` (the old "Use {fixed}" button's text).
- Refusals: `receipt.language_orders_open`, `receipt.language_fixed` and
  `management.request_invalid` with `field: "receiptLanguage"` go beside the language field;
  `product.invalid` with `field: "defaultProductVatClass"` beside the VAT field (reuse
  `catalogue_settings.invalid`); the one bottom message is `form.fix_fields`; any other code shows
  at the bottom only. A refusal never disables Save by itself.
- Live reads keep a dirty draft and adopt a clean one (the receipt panel's rule,
  `receipt-language-panel.ts:139-152`). The `venue-settings-hidden` event ends an unchanged edit
  (as `venue-details-panel.ts:161-164`). Cancel goes through the leave coordinator (as
  `catalogue-settings-panel.ts:135-143`).

Steps:

- [ ] Tests first (`venue-defaults-panel.test.ts`): Edit opens both fields with Save quiet and
  disabled; changing only the VAT class sends exactly `{ defaultProductVatClass: "zero" }`, and
  changing it back quiets Save; changing both sends both in one call; after a save the card is in
  view mode showing the answer; Barcelona offers exactly one option, `Catalan`; each refusal lands
  beside its field with `form.fix_fields` at the bottom, and Save stays enabled; a clean draft
  adopts a live change, a dirty one keeps its value.
- [ ] `venue-defaults-panel.unsaved.test.ts` (with a leave coordinator, as
  `receipt-language-panel.unsaved.test.ts` mounts one): Keep and Discard on leaving with a changed
  draft; a reverted draft leaves without asking; reconnect keeps the draft; removing the card
  releases protection; being hidden ends an unchanged edit and keeps a changed one; **the stated
  exception:** a Barcelona venue stored in Spanish, Edit opened and left untouched — leaving asks
  (the draft is changed), Discard returns to view mode without a write, and Save sends
  `{ receiptLanguage: "ca-ES" }`.
- [ ] `venue-defaults-panel.a11y.test.ts`: view, edit, edit with a field error, Barcelona edit with
  the list open — light and dark, en and es (`expectNoA11yViolations`).
- [ ] Implement. **Must run green:** the three `src/screens/venue-defaults-panel*.test.ts` files;
  typecheck, format. Commit
  `Venue settings: the Defaults card edits and saves both settings in one request (A755)`.

**Existing assertions changed:** none.

---

### T6. Put the Defaults card on the page in place of the receipt language panel

**Files:** `apps/dashboard/src/dashboard-app.ts` (`CORE_SETTINGS_PANELS` `:312-318`: replace the
`receipt-language` entry with `{ key: "defaults", tab: "venue-details", requiresPermission:
"venue.configure", render: (api) => html`<dashboard-venue-defaults-panel .api=${api}>…` }`; import
the new element); `dashboard-app.test.ts`; `dashboard-app.settings-panels.test.ts`;
`dashboard-app.venue-settings-unsaved.test.ts`; `dashboard-app.unsaved-changes.test.ts`. Keep the
`import "./screens/receipt-language-panel.js"` line until T7 (its own tests still run).

- [ ] Add `getVenueDefaults` (and, where a case saves, `putVenueDefaults`) to the stubs at
  `dashboard-app.test.ts:147`, `dashboard-app.settings-panels.test.ts:100`,
  `dashboard-app.venue-settings-unsaved.test.ts:66` and `dashboard-app.unsaved-changes.test.ts:916`
  (grep each file for `getReceiptLanguage` to find every stub that also needs one).
- [ ] Tests first:
  - `dashboard-app.test.ts:4624-4627` — the venue-details tab holds exactly
    `dashboard-venue-details-panel` and `dashboard-venue-defaults-panel`.
  - `dashboard-app.settings-panels.test.ts` — replace `:230-239` "shows no product defaults on
    Venue settings to %s": a session holding `venue.view` and `venue.configure` **but not
    `catalogue.manage`** sees the Defaults card with the VAT class; a supervisor (`venue.view`
    only) sees no Defaults card. Add: the tab's `h2`s read, in order, Business, Venue, Business
    day, Defaults.
  - `dashboard-app.venue-settings-unsaved.test.ts:847-1000` — port the hosted receipt-language
    helpers and cases to the Defaults card: open with Edit, pick, Save; `putVenueDefaults`
    replaces `putReceiptLanguage`; the `venue.view`/`layout.configure`/`venue.configure` gate case
    (`:894-902`) keeps its meaning; the look case at `:965-1000` keeps its a11y and overflow
    assertions but writes its screenshots as `a755-defaults-…` instead of `a493-host-language-…`.
  - Expected red: the old panel still registered.
- [ ] Implement. **Must run green:** `src/dashboard-app.test.ts`,
  `src/dashboard-app.settings-panels.test.ts`, `src/dashboard-app.venue-settings-unsaved.test.ts`,
  `src/dashboard-app.unsaved-changes.test.ts`, `src/dashboard-app.a11y.test.ts`; typecheck, format.
  Commit `Venue settings: the Defaults card replaces the receipt language panel (A755)`.

**Existing assertions changed (deliberate):** `dashboard-app.test.ts:4624-4627` (panel names);
`dashboard-app.settings-panels.test.ts:230-239`; `dashboard-app.venue-settings-unsaved.test.ts:872`,
`:894`, `:904`, `:945`, `:968` (see the table).

---

### T7. Retire the receipt language panel

**Files:** delete `apps/dashboard/src/screens/receipt-language-panel.ts` and its four test files;
adapt or delete `apps/dashboard/src/testing/receipt-language-fixture.ts`; port
`receipt-editor-boundaries.test.ts` to the Defaults card; remove
`import "./screens/receipt-language-panel.js"` (`dashboard-app.ts:70`).

- [ ] Before deleting, list every case in the four `receipt-language-panel*.test.ts` files and
  decide for each: already covered by a T5a/T5b case (name it), ported now, or retired by the spec
  (name the spec point). Port the behaviour cases T5a/T5b did not cover — check at least
  `.retained.test.ts:24` (label), `:44` (read failure hides the form), `:66` and `:84` (content
  warning follows the staged language and recovers), `:134` (stored language outside the choices
  shown unchanged), `:146` (rejected value worded beside the field); `.test.ts:120`, `:144`, `:161`,
  `:179` (live reads, in-flight saves, stale loads).
- [ ] Port `receipt-editor-boundaries.test.ts` (the Defaults card beside the department receipt
  dialog: each draft protected separately; a language save does not clean a receipt draft and the
  reverse).
- [ ] Delete the panel, its tests and the fixture (if nothing else imports it). **Must run green:**
  `src/screens/receipt-editor-boundaries.test.ts`, the three `src/screens/venue-defaults-panel*.test.ts`
  files, `src/dashboard-app.test.ts`; typecheck, format. Commit
  `Venue settings: the old receipt language panel goes; its checks now run against the Defaults card (A755)`.

**Existing assertions changed (deliberate, spec point 4):**

- `receipt-language-panel.test.ts:208` "shows a fixed territory rule and updates its old stored
  language only on explicit action" — before: a read-only value, the legal paragraph and a "Use
  Catalan" button; after: Edit offers a dropdown holding only Catalan, no paragraph, no button.
- `receipt-language-panel.retained.test.ts:106` "a fixed-language correction refuses below its
  action…" — the action is now the card's Save.
- `receipt-language-panel.retained.test.ts:159` "words the missing-content warning and fixed
  regional reason and action in Spanish" — the reason and the action are gone; the Spanish warning
  check stays.
- `receipt-language-panel.test.ts:27` "starts quiet, saves only a changed language…" — the card now
  opens in view mode; Edit first.

---

### T8. Remove the Defaults page, its sidebar entry, the old VAT panel and the old client calls

**Files:** `apps/dashboard/src/dashboard-app.ts` (`:71`, `:123`, `:233-237`, `:2470-2473`); delete
`catalogue-defaults-screen.ts`, `catalogue-settings-panel.ts` and their six test files; strings
(`catalogue_defaults.title`, `nav.catalogue_defaults`, and `catalogue_settings.hint`,
`.saved`, `.loading` once grep shows no reader); `dashboard-app.test.ts`; `client.ts`;
`client-routes.test.ts`.

- [ ] Tests first (`dashboard-app.test.ts`, replacing `:2985-3045`): no session, with or without
  `catalogue.manage`, has a `nav-catalogue-defaults` item; the Products and menus group ends with
  `nav-units`; `/manage/catalogue-defaults` opens the session's default page (assert the face and
  the path the app settles on, as the old unpermitted case did for `/manage/overview`). Expected
  red: the item exists.
- [ ] Before deleting `catalogue-settings-panel*.test.ts`, name for each case the T5a/T5b case that
  now covers it (quiet Save, invalid refusal, reconnect, live update) or port it.
- [ ] Remove the client's `saveCatalogueSettings` (`client.ts:2367-2371`) and `putReceiptLanguage`
  (`:3015-3017`) and every stub of them in tests (grep both names under `apps/dashboard/src`); the
  typecheck finds the rest. Update `client-routes.test.ts:450-466` and `:1418-1430` (the GET halves
  stay).
- [ ] **Must run green:** `src/dashboard-app.test.ts`, `src/dashboard-app.a11y.test.ts`,
  `src/dashboard-app.unsaved-changes.test.ts`, `src/api/client-routes.test.ts`, and every file the
  stub grep touched; typecheck, format. Commit
  `Products and menus: the Defaults page goes; its setting is on Venue settings (A755)`.

**Existing assertions changed (deliberate, spec point 5):**

- `dashboard-app.test.ts:2985` "offers Defaults last in Products and menus, to a session holding
  catalogue.manage, and opens its page" — before: the item exists and opens the page; after: no
  such item for anyone.
- `dashboard-app.test.ts:3006` "does not offer Defaults to a %s session without catalogue.manage" —
  folded into the case above.
- `dashboard-app.test.ts:3024` "opens /manage/catalogue-defaults … only when it holds
  catalogue.manage" — before: a `catalogue.manage` session opens the page; after: every session
  lands on its default page.
- `client-routes.test.ts:1418` "reads and saves the new-product default through the catalogue
  settings route" and `:450` (receipt language) — the save/put halves go.

---

### T9. Docs and backlog

**Files:** `docs/developers/design-system.md`, `docs/developers/conventions-ui.md`,
`docs/content-and-images.md`, `docs/backlog.md`, `docs/backlog/service-periods.md`,
`docs/backlog/dashboard.md`, `docs/backlog/setup.md`. Each change is a new claim: check it against
the code T2–T8 wrote.

- [ ] `docs/developers/design-system.md`:
  - `:2246` (the A331 list): replace "the 'VAT class for new products' default (now on Products and
    menus → Defaults)" with the Venue settings Defaults card, and add the Venue and Defaults cards'
    in-place forms; nothing in the list may still name the deleted panels.
  - `:2643-2648` (the "?" rule says a field that starts filled in takes a `wt-help-tooltip`): add the
    exception — Venue settings' Venue card starts filled in and carries no "?" (owner, 2026-10-16,
    A755); its consequence warnings show in the review box once a field changes.
  - `:3194-3240`: add the Venue settings exception — headings inside the card, the action in the
    card's header, and the Venue and Defaults cards editing in place rather than in a modal, each
    independently (owner, 2026-10-16, A755); name `apps/dashboard/src/widgets/settings-card.ts`.
  - `:3372` (the typography example names `receipt-language-panel.ts`): point at the settings card
    heading instead.
  - `:4271-4276`: Venue details holds four cards; Defaults needs `venue.configure`; the receipt
    language and the VAT default sit there.
- [ ] `docs/developers/conventions-ui.md:40-46`: the same "?" exception, one line, pointing at
  design-system.md.
- [ ] `docs/content-and-images.md:78-89`: "chosen in the **Defaults** card of **Venue settings**";
  "the Defaults card in Venue settings shows a note saying so".
- [ ] Backlog, per `docs/backlog.md` → _How to keep this file honest_ (`:6776-6793`): delete the A755
  entry (`docs/backlog.md:1546-1550`) and its detail section
  (`docs/backlog/service-periods.md:326-357`); rewrite `docs/backlog.md:4419-4423` and
  `docs/backlog/dashboard.md:396-398` as present fact ("the 'VAT class for new products' default is
  under `venue.configure`"); drop the Venue details sentence from A237
  (`docs/backlog/setup.md:189-190`); drop "the 'VAT class for new products' default" from the
  re-check list at `docs/backlog.md:1419-1423` **and** from its duplicate at
  `docs/backlog/dashboard.md:657`, since T5b's `.unsaved.test.ts` has a reconnect case (name it in
  the commit); add one short entry per open point the owner has not answered, naming A755 and the
  PR.
- [ ] `pnpm format:check`, and `pnpm exec prettier --file-info <file>` for any doc under `docs/`
  (prettier ignores that folder, so `--check` cannot tell); commit `Docs: Venue settings' four
  cards (A755)` with `-s`.

---

### T10. Server: retire the two old write routes

**Files:** `apps/server/src/catalogue-api.ts` (`:811-821`); `apps/server/src/location-settings-api.ts`
(`:261-293`, keeping `writeReceiptLanguage` for the new route); `catalogue-api.test.ts`,
`catalogue-manage-permission.test.ts`, `location-settings-api.test.ts`,
`location-settings-api.orders-open.test.ts`.

- [ ] First grep the whole tree for `/management-api/catalogue-settings"` with `PUT`,
  `/management-api/receipt-language` and `saveCatalogueSettings(`: after T8 the only callers left
  must be server tests (and the dashboard's GET of `/receipt-language`). If any production write
  caller remains, stop and report.
- [ ] Tests first: `PUT /management-api/catalogue-settings` and `PUT
  /management-api/receipt-language` now answer 404 (the router has no such route); `PUT
  …/catalogue-settings/default-color` and both GETs still answer as before. Expected red: 200/204.
- [ ] Move the old PUT cases to the new route rather than deleting them:
  `location-settings-api.test.ts:405-478` and the PUT halves of `:485-534` → `PUT
  /management-api/venue-defaults` with `{ receiptLanguage }`; `location-settings-api.orders-open.test.ts:63`
  helper → the new path and body (every case in that file then runs against the new route
  unchanged); `catalogue-api.test.ts:6463-6510` save and invalid-value cases → T1's venue-defaults
  describe already holds them; keep the GET halves. Remove the `"the new-product VAT class"` row
  from `catalogue-manage-permission.test.ts:56-60` (T1's file now holds the VAT default's
  permission cases).
- [ ] Remove the two routes. **Must run green:** `src/catalogue-api.test.ts`,
  `src/catalogue-manage-permission.test.ts`, `src/location-settings-api.test.ts`,
  `src/location-settings-api.orders-open.test.ts`, `src/venue-defaults-permission.test.ts`;
  typecheck, format. Commit
  `Server: the old receipt-language and VAT-default write routes go; the venue-defaults route replaces them (A755)`.

**Existing assertions changed (deliberate, spec point 5 — the permission change):**

- `catalogue-manage-permission.test.ts:56-60` — before: the VAT default's PUT was refused without
  `catalogue.manage` and served with it alone; after: that row is gone and
  `venue-defaults-permission.test.ts` refuses without `venue.configure` and serves with
  `venue.configure` but without `catalogue.manage`.
- `catalogue-api.test.ts:6463` "saves and reloads the venue's new-product VAT class", `:6478`
  "refuses unauthenticated and staff %s" (PUT half), `:6497` "refuses an invalid default %j" —
  before: on `PUT /catalogue-settings`; after: on `PUT /venue-defaults`.
- `location-settings-api.test.ts:405-534` PUT cases and `location-settings-api.orders-open.test.ts`
  (whole file through its helper) — same assertions, new route and body.

---

### T11. Look

CLAUDE.md §4: a page asserted only through strings has nothing checking that it renders. The look
is a **throwaway**, never committed and never run by CI.

- [ ] Write `apps/dashboard/src/screens/a755-look.tmp.test.ts` (it ends in `.test.ts`, so the
  dashboard's Vitest picks it up when named). It mounts `dashboard-app` at
  `/manage/venue-settings/view/venue-details` the way `dashboard-app.venue-settings-unsaved.test.ts:438-486`
  does, and writes screenshots to
  `/Users/clintongormley/waitron-campaign-c/a755-shots/<state>-<locale>-<theme>-<width>.png` for:
  all four cards in view; the Venue card editing with a sales lock; the Defaults card editing in
  Barcelona with the list open; the Business day card with a pending change; the supervisor's
  read-only view — in `en-GB` and `es-ES`, light and dark, at 390 and 1280 px. Run it once with
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/a755-look.tmp.test.ts`, then delete
  the file and confirm `git status` does not list it.
- [ ] Open every PNG with the Read tool and compare with the three mock-ups: four cards in the
  mock-up's order, header actions top right, rows label-left/value-right at 1280, postcode and
  city side by side, one foot note, quiet Save, a blue border only on the card being edited, no
  "?" anywhere. Fix what differs in a normal TDD commit, or list it in the PR as a known
  difference.
- [ ] Optionally confirm in the real app: `wa-wt demo waitron-feat-a755-venue-settings-cards`,
  dashboard as `owner@demo.waitron.local / dashPass123`, Venue settings.

## Changed test checks (expected)

| Test | Before | After | Why |
| --- | --- | --- | --- |
| `venue-details-panel.test.ts:95` | issuer as one `data-test=issuer` string | Business card rows | spec 1 |
| `venue-details-panel.test.ts:550` | one line `Issuer SL · B12345678 · ES`, no "Legal name"/"Tax ID" | three labelled rows, country named | spec 1, mock-up 01 |
| `venue-details-panel.test.ts:562` | labels include "Business day starts at" | they do not | spec 2 |
| `legal-name-dialog.test.ts:79` | button beside the identity line | button in the Business card header | spec 1 |
| `venue-details-panel.test.ts:112` | a `wt-help-tooltip` exists | none | spec 3 |
| `venue-details-panel.test.ts:412` | address note after an address change | at the foot whenever editing, new wording | spec 3, mock-up 02 |
| `venue-details-panel.test.ts:422`, `:432` | warnings read from "?" buttons | read from the review box after a change | spec 3 |
| `venue-details-panel.test.ts:577` | lock sentence once, tooltip also checked | lock sentence once at the foot, no tooltip | spec 3 |
| `dashboard-app.test.ts:4624-4627` | tab holds venue-details and receipt-language panels | venue-details and venue-defaults panels | spec 1, 5 |
| `dashboard-app.settings-panels.test.ts:230` | no VAT default on Venue settings | a `venue.configure` session without `catalogue.manage` sees it in Defaults; supervisor sees no Defaults card | spec 5 |
| `dashboard-app.venue-settings-unsaved.test.ts:872`, `:894`, `:904`, `:945`, `:968` | hosted receipt-language panel | Defaults card via Edit | spec 1, 4 |
| `receipt-language-panel.test.ts:208` | read-only value, legal paragraph, "Use Catalan" | dropdown holding only Catalan, no paragraph | spec 4 |
| `receipt-language-panel.retained.test.ts:106`, `:159` | fixed-language action and regional reason | card Save; reason gone | spec 4 |
| `receipt-language-panel.test.ts:27` | always-open form | view mode, Edit first | spec 1 |
| `dashboard-app.test.ts:2985`, `:3006`, `:3024` | Defaults page in the sidebar for `catalogue.manage` | no page; the address opens the default page | spec 5 |
| `client-routes.test.ts:450`, `:1418` | put/save calls | GET halves only | spec 5 |
| `catalogue-manage-permission.test.ts:56` | VAT default PUT gated by `catalogue.manage` | row gone; `venue-defaults-permission.test.ts` gates on `venue.configure` | spec 5 (permission) |
| `catalogue-api.test.ts:6463`, `:6478`, `:6497` | on `PUT /catalogue-settings` | on `PUT /venue-defaults` | spec 5 |
| `location-settings-api.test.ts:405-534` (PUT), `location-settings-api.orders-open.test.ts` | on `PUT /receipt-language` `{language}` | on `PUT /venue-defaults` `{receiptLanguage}` | one Save, one transaction |
| deleted: `catalogue-defaults-screen*.test.ts`, `catalogue-settings-panel*.test.ts`, `receipt-language-panel*.test.ts` | — | each case named as covered, ported or retired in T7/T8 | spec 4, 5 |

## Risks

- **Permission is the review's focus.** T1's permission file is the only proof that a
  `venue.configure`-only session is served; no built-in role is such a session, so that proof
  depends on the wrapped `authorizeManager`. The real supervisor case checks the refusal without
  the wrapper. Run the deletion control: change the route's gate to `catalogue.manage` and watch
  the "withholding catalogue.manage" case fail, then restore.
- **One Save, one transaction.** T1's mirror case (language written, then the VAT class refused)
  is the one that fails if the two writes are split; its deletion control is recorded in T1's
  commit.
- **Menu revision.** The VAT write no longer advances the client's menu revision; it resets it like
  any other non-catalogue write (`client.ts:2083-2103`). Nothing reads the VAT default from a menu.
- **Design-system drift.** The approved mock-ups depart from "Group related fields into cards"
  (heading above the card, Edit in a footer, edits in a modal) and from the "?" rule for filled
  fields. T9 records both exceptions; a reviewer reading only the doc would otherwise flag the
  screen.
- **`--wt-form-max-width` is 36rem, the mock-up draws 560 px.** The token wins; T11's look checks
  the result reads right.
- **Unsaved coverage.** The Defaults card is a new place holding staged input, so it needs its own
  `*.unsaved.test.ts` (CLAUDE.md §3); nothing guards that across screens.

## Open points (each has a default the plan follows; the owner may overrule)

1. **The Business day card with a scheduled change.** The mock-up draws only "Change start".
   **Default: with a pending change the header shows "Replace change" and "Cancel scheduled
   change", as today; with a locked one, no action and the locked note.**
2. **Lock-reason wording.** The mock-up's foot reads "The time zone is locked because the venue has
   recorded sales." The code says one sentence per reason, not per field ("Locked: the venue has
   recorded sales."), and several fields can be locked for different reasons (province by
   `geography_context`, time zone by `sales`). **Default: keep today's per-reason sentences; the
   "· locked" marker names the field.** Separately, a time zone locked by `business_day_history`
   has no sentence at all (`REASONS`, `venue-details-panel.ts:64-69`) — noted, not fixed here.
3. **Who sees the Defaults card.** Its routes need `venue.configure`. **Default: only sessions
   holding `venue.configure`** (as the receipt-language panel today); a supervisor sees the other
   three cards read-only.
4. **One combined route instead of two separate saves.** The plan adds `PUT
   /management-api/venue-defaults` so the card's one Save is one transaction (CLAUDE.md §3:
   "Splitting one logical change across transactions is a commented decision, never a default").
   The smaller alternative — keep both old routes, move the catalogue route's gate, and send two
   requests — was rejected for that reason.

Settled by the coordinator's review (2026-10-16), recorded so nobody reopens them: a Catalan venue
stored in another language opens Edit with Catalan chosen (header point 6, pinned in T5b); each card
edits independently (Global constraints); the card frame is app-owned rather than a `wt-card`
change (Global constraints).

## Owner FYI questions (non-blocking; in the PR and the coordinator's `questions.md`)

1. **The legal paragraph in the setup wizard.** A755 removes it from Venue settings, but the setup
   wizard shows the same text beside its fixed receipt-language choice
   (`apps/setup/src/screens/venue-screen.ts:726-727`). The branch keeps it there, and keeps
   `fixedReceiptLocale.reason` because of it. Should it go from setup too?
2. **Province.** The mock-up draws Province as an editable field; the server refuses every
   province change (`apps/server/src/venue-details.ts:149`), and allowing one is a separate open
   decision (`docs/backlog/service-periods.md:64-70`). The branch shows Province as a locked row
   with "· locked". Is that right until that decision is made?
