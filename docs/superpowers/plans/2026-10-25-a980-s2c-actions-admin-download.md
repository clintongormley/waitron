# A980 slice S2c: the actions file, and an admin's download of another person's data

**Status: plan, 2026-10-25. Nothing was built when this was written.** Design:
[A980 data protection, revision 2](../specs/2026-10-22-a980-data-protection-design.md) §4.2 (the
download, its two worked examples and "`actions.csv` lists sale numbers and amounts, never another
person's data"), §2.1 row s12 ("Who did what"), §5.3 row S2 (its tests), §8 owner answer O5
("staff should be able to download their own data, otherwise admins … If so, provide an admin
permission"). Overview: [the build plan](2026-10-24-a980-data-protection-build.md), row S2c and
"Notes for each slice → S2c". It builds on [S2a1](2026-10-24-a980-s2a1-own-download.md) (the seat,
the gatherer, `sendPersonalData` and its `authorize` step; its decisions 5 and 7 say what S2c
adds), [S2a2](2026-10-25-a980-s2a2-own-download-ui.md) (the README, the Profile button, the guide
section) and [S2b](2026-10-25-a980-s2b-own-download-workforce.md) (the work files, server parts,
the README's language on the subject). Branch `feat/a980-s2c-actions-admin-download`, from `main`
at `c87b4a0e0`. **No migration** (decision 4 says why none is needed, and Task 3 re-measures it
with a stop rule). **FULL review**: a new permission, a by-id read of another person's data, and
personal data, all risk triggers. Per-task reviews run, then `/finish-branch`.

## Words used here

- A **part** is one contributor's share of the download: the file names it may add and the code
  that reads and builds them (`packages/module/src/personal-data.ts:26-41`). A **server part** is
  one the server adds itself, passed as `serverParts` (`apps/server/src/personal-data-export-api.ts:25-26`).
- The **subject** is what every part is told about the request: whose data, the README's language,
  the moment, the venue's time zone and this node's location (`personal-data.ts:6-16`).
- The **snapshot turn** is the first of the route's two write-lock turns, in which every part reads;
  the **re-check** is the second, after the files are built, in which the caller's `authorize` runs
  again (`personal-data-export-api.ts:67-85`).
- An **actor column** is a column that records which person did something to a row (who voided a
  sale, who authorised a refund), as distinct from whom the row is about.
- A **void** here is the annulment of an issued sale: a row in `sale_voids`
  (`packages/db/src/schema/sale-voids.ts:5-22`). It is not a line cancelled or comped on an open
  bill, which the adjustments module records (decision 3).
- A **tender refund** is money given back on a payment of an issued sale (`tender_refunds`,
  `packages/db/src/schema/tender-refunds.ts:26-61`); a **bill-payment refund** is money given back
  on a payment taken against a bill before its invoice existed (`bill_payment_refunds`,
  `packages/db/src/schema/bill-payments.ts:130-171`).
- A **drawer opening** is one row of the cash-drawer audit log (`drawer_opens`,
  `packages/db/src/schema/drawer-opens.ts:10-55`).
- A **sale number** is the series code and the invoice number joined by `/`, as receipts print it
  (`formatInvoiceNumber`, `packages/core/src/record-sale.ts:101-107`).
- The **admin route** is the new `GET /management-api/staff/:id/personal-data/export`; the **own
  route** is the existing `GET /management-api/me/personal-data/export`.

## What this slice builds, and what it leaves

1. **`actions.json`**, a server part, in both routes' ZIPs whenever the person has at least one
   void, refund or drawer opening recorded against them: counts per kind, then one entry per
   action with the sale number, the amount where there is one, when, and the person's part in it.
2. **`personal_data.export`**, a new permission only admins hold.
3. **The admin route**, gated by that permission, giving the same ZIP for any person, a disabled
   one included (the design's worked example: Marta has left, emails, an admin downloads).
4. **The dashboard**: a **Download their data** item in each row menu on **Users** for whoever
   holds the permission, English and Spanish, with a refusal that offers an administrator's
   sign-in.
5. **Words**: the README's lines for `actions.json`, the own-data guide section and Profile help
   text widened, and a new Users guide section for an admin's download, English and Spanish.
6. **A guard** that lists every actor column in the core schema and says, for each, whether the
   download carries it or why not yet.

Left for later, on purpose (each becomes a backlog point in Task 12):

- **The rest of "who did what"** (design §2.1 row s12): sales a person rang (`sales.operator_id`),
  corrective invoices they authorised (`sales.authorized_by`), unpaid departures, receipt
  reprints, invoice PDF downloads, order changes (`order_amendments`, `line_service_cancellations`,
  `ticket_item_moves`, `order_draft_events`, `order_group_events`, `order_groups`), parties
  opened and closed, daily closes, incident acknowledgements, membership changes, bill payments
  asked for, pass marks, and other modules' actor columns: cancellations, comps and discounts
  (`adjustments`), bookings, menu publication, fiscal operations, payment holds and resolutions,
  department transfers, allergy answers, service steps. Decisions 2 and 3.
- **A manager's own copy of what they decided about others** stays its own backlog point (S2b
  decision 11); it is not in this slice either.
- **Moving the download's mount into `boot.ts`** stays its own backlog point; the admin route is
  mounted beside the own route (decision 9).
- **An in-place administrator sign-in** that keeps the current session: none exists in the
  dashboard (decision 12), so the refusal offers sign-out and sign-in instead.

## Decisions this plan makes that the design does not

1. **`actions.json` is a server part in `apps/server`, not a module's seat value.** Its tables are
   core tables (`packages/db/src/schema/`), and the core entry in `ALL_MODULES` takes its seat
   values from `@waitron/db` (`packages/composition/src/modules.ts:144-154`). `@waitron/db` cannot
   import the seat's types: `@waitron/module` depends on `@waitron/db`
   (`packages/module/package.json`, `dependencies`), not the reverse. A plain object of the right
   shape in `@waitron/db` would work, but `@waitron/db` is mutation-tested over all of `src`
   (`packages/db/stryker.config.json:7`), and it cannot import `formatInvoiceNumber` from
   `@waitron/core`, which depends on it (`packages/core/package.json`). The server already reads
   these tables and formats sale numbers (`apps/server/src/orders-list.ts:4`, `:458`), already
   adds a server part the same way (`apps/server/src/personal-data-time-record.ts:19-60`), and core
   is always migrated (`tier: "mandatory"`, `modules.ts:147`), so the part needs no enabled-module
   check. Default: `apps/server/src/personal-data-actions.ts` exports
   `ACTIONS_FILES = ["actions.json"] as const` and `actionsPersonalData(): PersonalDataPart[]`
   (owner `"server"`), passed in `serverParts` beside `timeRecordPersonalData(modules)`. Shared
   code names no module (the composition rule, home CLAUDE.md §3): the part reads only core tables.

2. **What "voids, refunds, drawer openings" covers, column by column.** Printed on 2026-10-25 by a
   throwaway test in `packages/db` (deleted after; `git status --short` showed nothing) that walked
   every drizzle table exported by `packages/db/src/schema/index.ts` and kept columns whose name
   matches `/(^|_)(person_id|person|by|operator_id|actor_id)$/`: 36 columns. (Control: the same
   walk printed the three `tender_refunds` actor columns, so it can find what it looks for.) The
   part reads nine of them:

   | Table | Columns that select the person | The person's part (`yourPart`) |
   | --- | --- | --- |
   | `sale_voids` | `voided_by` ("The person who authorised the void", `sale-voids.ts:19-21`; written from the authorisation at `packages/core/src/record-void.ts:86-90`) | none: a void records only who authorised it |
   | `tender_refunds` | `requested_by`, `authorized_by`, `attested_by` (`tender-refunds.ts:38-40`) | `requested`, `authorized`, `attested` |
   | `bill_payment_refunds` | `requested_by`, `authorized_by`, `attested_by` (`bill-payments.ts:153-154`, `:166`) | `requested`, `authorized`, `attested` |
   | `drawer_opens` | `person_id` (the operator: `apps/server/src/receipt-print.ts:407-420`, `:555-570`, `:645-680`; the admin on a calibration, `apps/server/src/print-api.ts:1238-1243`) and `authorized_by` (who authorised a manual or override open, `drawer-opens.ts:50-54`) | `opened`, `authorized` |

   `yourPart` lists every column of the row that names the person, in the order above; a refund the
   person asked for and authorised themselves reads `["requested", "authorized"]`.

   The other 27 are listed in the Task 4 guard as "not yet" (each with the backlog point of Task
   12) or "not a person": `print_jobs.claimed_by` names a print agent
   (`packages/db/src/schema/print-jobs.ts:46`, `.references(() => printAgents.id)`), and
   `invoice_deliveries.claimed_by` holds the sender's claim, written from the delivery's `holder`
   (`apps/server/src/invoice-delivery.ts:221`), which is also written as the print agent id
   (`:222`).

   **`payment_refunds` is not read** (payments module). It is the card provider's record of the
   same refund: it is written from the tender-refund and bill-refund paths
   (`apps/server/src/tender-refund-sends.ts:183`, `tender-refunds.ts:97`, `bill-refunds.ts:311`,
   `:739`), so counting it would count one refund twice.

3. **"Voids" means sale annulments; line cancellations and comps wait.** The overview asks for
   "sale numbers" (build plan row S2c), and only an issued sale has one. The till's line
   cancellations, comps and discounts on an open bill are the adjustments module's
   (`packages/adjustments/src/schema/adjustments.ts`, actions `cancel`, `comp`, `discount_percent`
   at `packages/adjustments/src/policy.ts:6-9`), carry `requested_by` and `approved_by`, and would
   fill that module's own seat in its own package with its own words and guard. Default: deferred
   to the "rest of who did what" backlog point. **Review focus**: in a restaurant "void" often means
   a cancelled line; if the owner or reviewers want those in, they are one more task (a module part
   in `@waitron/adjustments`, its README words and its column guard), not a change to this design.

4. **No index, and the locked read is timed with a stop rule.** None of the nine columns has an
   index: `sale_voids` has a unique key on `sale_id` and an index on `voided_at`
   (`sale-voids.ts:27-33`); `drawer_opens` declares none (`drawer-opens.ts:56-72`); the refund
   tables' indexes and unique keys name the sale, tender, submission, payment, provider and state,
   never a person (`tender-refunds.ts:88-98`; `bill-payments.ts:178`). So each read scans its
   table inside the write lock. `drawer_opens` is the large one: a cash sale writes one row
   (`receipt-print.ts:677`, `reason: method === "cash" ? "cash_sale" : "card_slip"`).
   Experiment, 2026-10-25, a throwaway `node:sqlite` script (in
   `/Users/clintongormley/waitron-campaign-b/a980-s2c-plan-probe/probe.mjs`, outside the worktree)
   with `drawer_opens`' eleven columns, a `sales` table and a series table, 30 people, the query
   `… where person_id = ? or authorized_by = ? order by opened_at, id` joined to the sale and
   series by key: 400,000 rows in memory took 36 ms (three runs, 35.7 to 36.3 ms); 1,000,000 rows
   in a file database took 156 to 166 ms (three runs), returning 33,677 rows; the voids read over
   20,000 voids took 21 to 23 ms. The plan's assumed volume, about 300 sales a day for six years
   (about 660,000 sales), is a guess, not a measurement. This is a Mac, not a box. Default: no
   index, so no migration. Task 3 times the real part on the real schema at 1,000,000 drawer
   openings; **if it is over 250 ms (S2b's bar, S2b decision 6) the implementer stops and reports**:
   an index is a migration, which this slice does not carry, and becomes its own slice. Either way
   the box measurement joins the existing "Measure … on a box" backlog point.

5. **The file is JSON, `actions.json`, not the design's `actions.csv`.** S2b chose JSON for the
   module files (S2b decision 2), and this file holds three kinds of entry with different fields
   and a counts block, which one CSV table cannot without empty columns. It is built with
   `jsonFile` (`packages/module/src/personal-data.ts:22-25`). The README's existing ".json files
   are a machine-readable copy" line applies to it as to the others.

6. **What each entry holds, and what it leaves out.** Shape (keys in this order):

   ```text
   actions.json { counts: { voids, refunds, drawerOpenings },
                  voids:          [{ sale, amount, at }],
                  refunds:        [{ kind, sale, amount, tip, method, state, at, yourPart }],
                  drawerOpenings: [{ reason, sale, at, viaOverride, yourPart }] }
   ```

   - `counts` are the three lists' lengths. The design says "counts per kind …, rows on request"
     (§4.2); the route takes no query (S2a1 decision 7), so there is no "on request" form. Default:
     the rows are always included, because the copy is the person's right and the sale numbers the
     overview asks for are the rows. A long-serving cashier's file can hold tens of thousands of
     drawer rows (decision 4's 33,677 at 1,000,000 openings).
   - `sale` is the sale number, or null where none exists. A void's and a tender refund's sale is
     the row's `sale_id` (both `.notNull()`). A drawer opening's is its `sale_id` when set (a
     `tender_refund` opening always carries one, `drawer-opens.ts:67-69`), else, for a
     `bill_payment` or `bill_refund` opening, the sale filed from the bill payment's order
     (`bill_payments.working_order_id`, `bill-payments.ts:42`, matched to
     `sales.working_order_id`, unique at `sales.ts:141`), else null (a `calibration` or
     `manual` opening with no sale). A bill-payment refund's sale is found the same way, and is
     null while the bill has no invoice.
   - `amount`: a void's is the voided sale's `total`; a refund's is `applied_amount` and its `tip`
     is `tip_amount`; a drawer opening has none. Each is read as integer cents through drizzle's
     query builder and written with `centsToDecimal` (the money rule, home CLAUDE.md §3; S2b
     decision 7 did the same for pay rates), so `1234` becomes `"12.34"`.
   - `kind` is `sale` (a tender refund) or `bill_payment`; `method` is the tender refund's `method`
     or the bill payment's (`bill-payments.ts:47`), both `cash` or `card`; `state` is the stored
     `pending`, `completed` or `failed`; `reason` is the drawer opening's stored reason
     (`drawer-opens.ts:32-40`); `viaOverride` is the stored flag.
   - `at` is written as stored (ISO 8601 UTC, as S2a1 decision 10): `voided_at`, the refund's
     `created_at`, `opened_at`.
   - **Left out**: every free-text reason and attestation note (`sale_voids.reason`,
     `tender_refunds.reason`, `attestation_note`, the bill refund's): typed by staff about a sale,
     they can name a customer or a colleague, and the design says this file holds "never another
     person's data" (§4.2). **Review focus**: the person typed some of them, so a reviewer may want
     them in. Also left out: the device and printer of a drawer opening (a device's label can name
     somebody, design §2.3 row d1), every other person's id or name (who else asked for or
     authorised the same refund, who rang the voided sale), provider references, row ids, and the
     columns that run a refund's sending. Task 4's guard holds each of the four tables' columns to
     the lists in Task 2.
   - **Order**, so the output is the same on every run: each list by `at`, then row id.
   - **No row, no file** (S2b decision 3): with no void, refund or drawer opening the part builds
     nothing, and the README lists only built files (S2a2 decision 2). This also leaves every
     existing whole-ZIP assertion unchanged unless its fixture already holds an action row.

7. **The permission.** `personal_data.export` goes in `PERMISSIONS` straight after `person.admin`
   (`packages/identity/src/permissions.ts:15-16`) with a one-line comment that it is admin only,
   and in no role's set: admins get it because their set is every permission
   (`permissions.ts:76`, `:82`). The name is the design's and A1002's
   (`docs/superpowers/specs/2026-10-22-a1002-custom-roles-design.md:101`), and A1002 has not
   landed (`docs/backlog.md:4013`, "Awaiting owner approval"; `permissions.ts` last changed by
   #1906), so no stored role data needs writing. The permission reaches the dashboard through the
   session read's `permissions: permissionsForRole(role)` (`apps/server/src/me-api.ts:350`).

8. **The admin route's checks, in this order**, inside its `authorize` (S2a1 decision 7 runs it in
   the snapshot turn and again in the re-check):
   1. `authorizeManager(tx, { managementSessionId, permission: "personal_data.export", touch: false })`
      (`packages/identity/src/manager-login.ts:162-175`): no cookie 401
      `management_session.required` (`requireManagementSession`, before the turn), ended 401, idle
      401 `management_session.expired`, a disabled caller 403 `person.suspended`, no permission 403
      `authorization.not_permitted` `{ permission: "personal_data.export" }`. `touch: false`
      writes nothing, as the own route (S2a1 decision 7).
   2. Any query string: 400 `management.request_invalid` `{ field: "query" }`, as the own route.
   3. The path id: not a UUID, or no `persons` row, 404 `person.not_found` `{ personId }`, the code
      and status the staff routes already give an unknown person (`requirePersonId`,
      `apps/server/src/management-api.ts:301-304`; `"person.not_found": 404` at `:245`), and the
      house status rule: "the thing the request's path points at is missing → 404"
      (`docs/developers/conventions-data.md:37-40`).

   **The permission is checked before the id**, so a caller without it gets the same 403 for any
   id, real, unknown or malformed, and cannot learn which people exist. A target's status does not
   matter: active, pending and disabled people are all downloadable (the worked example's Marta is
   disabled). An admin may name themselves; they get their own data. A staff member or supervisor
   is refused 403 whoever they name, themselves included: their own copy is the own route's.
   `withPersonalDataErrors` (`personal-data-export-api.ts:35-43`) gains
   `"authorization.not_permitted": 403` and `"person.not_found": 404`, as S2a1 decision 5
   foresaw; the own route throws neither in practice, and both entries are shared because the map
   is one. **No new error code**, so no registry, `scripts/errors-reachable.test.ts` or
   `scripts/alert-codes.test.ts` change is due; both codes are declared in identity's registry
   (`packages/identity/src/errors.ts:42`, `:71`). No product code deletes a person
   (`git grep -n -E '\.delete\(persons\)|delete from "?persons' -- 'packages/*/src' 'apps/*/src' ':!*.test.ts' ':!**/testing/**'`
   printed nothing on 2026-10-25; the same pattern over test files found `boot.test.ts` and
   `certificate-reminder-worker.test.ts`), so from the dashboard `person.not_found` follows only a
   stale list or a fault.

   **The re-check repeats the permission**: an admin demoted to manager while the files are built
   is refused 403 in the re-check and sent nothing. A role change alone ends no session
   (`packages/identity/src/staff.ts:275-276` revokes access only when the email or status changes),
   so this case is reachable.

9. **Mounted by `mountPersonalDataExportApi`, beside the own route.** The function
   (`personal-data-export-api.ts:105-128`) already holds every dependency the ZIP needs (modules,
   server parts, venue language, privacy-notice address, clock), and it is called from
   `mountMeApi` (`apps/server/src/me-api.ts:119-131`). `mountManagementApi`'s dependencies hold no
   module list (`apps/server/src/management-api.ts:138-170`), so mounting there would mean passing
   the modules and server parts through `boot.ts` as well. Default: the function mounts both
   routes; `mountMeApi`'s comment, which says its routes are role-blind and never call
   `authorizeManager` (`me-api.ts:104-109`), gains one sentence that the personal-data mount it
   calls also carries the admin route, which does. Moving the mount into `boot.ts` stays its own
   backlog point (`docs/backlog/data-protection.md`, "Mount the own download from `boot.ts`").
   **Review focus**: a reviewer may prefer the mount moved now; `boot.ts` is in no open pull
   request (`gh pr list --state open` on 2026-10-25 listed only #1986, whose files are
   `docs/backlog.md` and `packages/core/src/record-substitution.ts`).

10. **The README for someone else's download is in that person's language.** The own route uses
    the requester's saved language, else their browser's, else the venue's (S2a2 decision 1); for
    the admin route the browser is the admin's, so it is not used. Default:
    `resolveActiveLocale(target.locale, deps.venueLocale)` (`packages/shared/src/locales.ts:37-44`),
    then `es-…` → Spanish, anything else → English, the same mapping as the own route
    (`personal-data-export-api.ts:119-123`). The working-time files follow it (S2b decision 5).
    The README stays addressed to the person ("Your data held by …", "Prepared for {name}"), because
    the admin hands it to them. The file name is the target's display name and the venue's date
    (S2a1 decision 8).

11. **The row menu item.** `dashboard-staff-list` gains `canExportPersonalData` (default false)
    and `downloadingPersonId` (`string | null`), both in its columns' memo inputs
    (`apps/dashboard/src/widgets/staff-list.ts:38-41`; A1000 added `canAdminister` there for the
    same reason, a cell reads it). With `canExportPersonalData`, every row's menu ends with a ghost
    `wt-button` `data-test="download-data-<id>"` reading **Download their data** / «Descargar sus
    datos», after the existing items (`staff-list.ts:96-113`), so the existing menus' order is
    unchanged. It dispatches `download-person-data` `{ personId }` (an app component's event, so a
    plain name, home CLAUDE.md §3), not `person-action`, whose handler opens a confirm dialog and
    returns unless `canAdminister` (`apps/dashboard/src/screens/staff-screen.ts:103-118`). The
    screen gains `canExportPersonalData`, set by the app from
    `this.#sessionPermissions.includes("personal_data.export")` beside `canAdminister`
    (`apps/dashboard/src/dashboard-app.ts:2553-2557`). Today only admins hold it, so the item
    appears exactly where `canAdminister` is true; it reads its own permission so custom roles
    (A1002) can separate them. A disabled person is shown with the **Status** filter on **Disabled**
    or **All statuses** (`staff-screen.ts:157-171`, `:392-400`).
    - **States** (design-system.md → Forms): a download is a read, not a save, so no confirm
      dialog. While one is out, every row's item is `disabled` and the handler returns early
      (`disabled` stops a person, not a test); design-system.md excludes "a button disabled only
      while a request is being sent" from the quiet-button rule (`docs/developers/design-system.md:2773`).
      The menu closes on the press (`wt-row-actions` keeps itself open only for `data-keep-open`,
      design-system.md:848), so progress is shown under the table: a `role="status"` line with a
      decorative `wt-spinner`, "Preparing a copy of {name}'s data…" / «Preparando una copia de los
      datos de {name}…» (the third form at design-system.md:1188-1190).
    - **Success** saves the blob under the server's file name, else `personal-data.zip`, and
      releases its address, exactly as the Profile page does
      (`apps/dashboard/src/screens/profile-screen.ts:760-779`).
    - **Failure** is held in its own field, not the screen's `errorKey`, whose read-versus-action
      bookkeeping feeds the edit and create dialogs' feet (`staff-screen.ts:86-91`, `:424`, `:503`),
      so a download failure never appears in a later dialog; it is shown under the table with
      `role="alert"` until the next press. A refusal never disables the item. Session refusals
      also return to sign-in through the existing signal (`apps/dashboard/src/session-signals.ts:6-21`).
      Decision 12 gives the permission refusal.
    - **Leaving** while a download is out drops its answer (a counter, as the Profile page's
      `#download`).
    - Every `{name}` is filled with a function replacement, so a name holding `$&` prints as typed
      (S2a2 decision 5); the dashboard's usual `.replace("{count}", String(n))`
      (`apps/dashboard/src/dashboard-app.ts:1689`) would mangle one.
    - The API client gains `downloadPersonalData(personId)`: `GET
      /management-api/staff/${encodeURIComponent(personId)}/personal-data/export` with
      `{ as: "file" }`, as `downloadOwnPersonalData` (`apps/dashboard/src/api/client.ts:2360-2367`).
      Not passive: a person pressed it.

12. **The permission refusal offers an administrator's sign-in, here.** The house rule: a refusal
    explains what happened and what each choice does and offers any needed administrator sign-in
    there; it never sends the person to somebody else (home CLAUDE.md §3;
    `docs/developers/conventions-ui.md:8-20`). The shared `authorization.not_permitted` sentence,
    "You don't have permission to do that" (`apps/dashboard/src/i18n/codes.ts:406-409`), names no
    choice, and no in-place step-up sign-in exists in the dashboard (searched
    `apps/dashboard/src`, tests excluded, for "admin sign-in", `signInAsAdmin` and similar on
    2026-10-25: nothing). Default, for this action only: the alert reads "Only an administrator can
    download another person's data, and this account can no longer do it. Sign in as an
    administrator to download {name}'s data: this signs you out here first." / «Solo un
    administrador puede descargar los datos de otra persona, y esta cuenta ya no puede hacerlo.
    Inicia sesión como administrador para descargar los datos de {name}: antes se cierra tu sesión
    aquí.», followed by a `wt-button` **Sign in as an administrator** / «Iniciar sesión como
    administrador» that dispatches `admin-sign-in` (bubbling, composed). The app answers it with its
    existing logout (`#onLogout`, `dashboard-app.ts:1517-1530`), which asks about unsaved drafts
    through the leave coordinator before signing out, so that is the safe Stop. The other choice is
    to do nothing: the line stays until the next press. Every other failure shows
    `codeMessage(code)` as the Profile page does. The in-place sign-in that would keep the session
    becomes a backlog point (Task 12), listed in the pull request.

13. **The guide.** A new section after "Download your data", **Download another person's data**
    `{#person-data}`, with the Spanish twin «Descargar los datos de otra persona» `{#person-data}`;
    the own-data section and `profile.data_copy_help` name `actions.json`. The new row item has no
    help badge: a row menu option takes one only through `wt-menu-row`
    (design-system.md:845), and no other item in this menu has one. Task 10 gives the text.

## Global constraints

- **English only** in code, identifiers, comments, fixtures and tests. Spanish only in
  `apps/server/src/i18n/personal-data-readme.ts`, `apps/server/src/guide/es/staff.md` and the
  Spanish half of `apps/dashboard/src/i18n/strings.ts`. A test of Spanish text reads its expected
  words from the words file or `t()`.
- **One snapshot turn.** The actions part reads in the snapshot turn, opens no transaction, awaits
  its queries in turn (never `Promise.all`), and its build function does not touch the database.
- **Every database test uses `useVenueDb`.** Every refused request asserts the domain error code.
- **Exact shapes** use `toEqual` or `toBe`, never `toMatchObject`.
- **Fixtures use values the two sides could treat differently**: amounts whose cents matter
  (`1234`, not `1200`); a colleague with different distinct sale numbers and amounts in every one
  of the four tables, so "only hers" fails if a person condition is dropped; a refund Marta
  requested and a colleague authorised, so a read that returned the authoriser's id would show; a
  manager, who holds every permission but the admin-only ones, as the refused caller, so a check
  against any manager-held permission passes it.
- **No secret in the download**: the existing no-secrets cases stay unedited; Task 8 adds the
  admin-route case with a positive control.
- **Existing assertions that change on purpose**, each allowed because it pins a whole shape and
  every existing value stays as it is, named in the pull request:
  `packages/identity/src/permissions.test.ts:34-38` (the manager's admin-only set gains
  `personal_data.export`); `apps/server/src/guide-content.test.ts:156-162` (the Users page's
  section ids gain `person-data`); `apps/server/src/personal-data-readme.test.ts:275-276` (the
  server files whose words are checked gain the actions part's); and, if Task 8 gives its fixture
  action rows, the entry list in `apps/server/src/personal-data-export-api.workforce.test.ts`
  (gains `actions.json`). No other existing assertion changes. These do not change and need not:
  `apps/dashboard/src/widgets/staff-list.test.ts:45-59` and
  `apps/dashboard/src/screens/staff-authority.test.ts:117-129` (the new property defaults to
  false, so their menus are unchanged); no root guard names a permission
  (`git grep -l 'person.admin\|PERMISSIONS' -- scripts` printed nothing on 2026-10-25).
- **Coverage**: `@waitron/identity`, `@waitron/server`, `@waitron/dashboard` hold 98/98/98/95. No
  exclude or ignore comment. None of them is mutation-tested.
- **Fixture code stays in test files**, never `src/testing/` (home CLAUDE.md §2).
- **Same files as open pull requests**: #1986 changes `docs/backlog.md`; whichever lands later
  rebases.
- Commits `git commit -s`; `pnpm format:check` before each commit.
- An implementer that passes about 150 tool calls with its task unfinished stops at a passing or
  cleanly failing point, commits, and hands over: what is done, what is left, the files, each
  check's state.
- Browser suites: check `memory_pressure | grep free` first.

## Review focus

- **Whose data, in the actions file**: each read selects by the subject's person id in that
  table's actor columns only (decision 2); the file names no other person, by id or name
  (decision 6); Task 2's "only hers" and "no other person" cases, and Task 8's end to end.
- **The permission and the by-id read** (decisions 7 and 8): admin only; checked before the id;
  repeated in the re-check; a manager, a supervisor and a staff member refused whoever they name;
  the proof by deletion in Task 7.
- **What "voids" means** (decision 3): sale annulments only; line cancellations and comps wait.
- **Free text left out** (decision 6): reasons and notes, though the person typed some.
- **Rows always included** (decision 6) rather than counts alone.
- **The locked read** (decision 4): the probe's numbers, Task 3's number on the real schema, and
  its stop rule; no index, no migration.
- **The README language for someone else** (decision 10): the person's saved language, else the
  venue's; never the admin's browser.
- **The mount** (decision 9): beside the own route, inside `mountMeApi`'s call, with its comment
  narrowed; `boot.ts` untouched.
- **The refusal's sign-in** (decision 12): it signs the current account out; an in-place sign-in is
  a backlog point.
- **Every README and guide sentence against its source** (Task 5's and Task 10's tables).
- **Codex run-it seat**: a permission, a by-id read and personal data are risk triggers, so
  `/finish-branch` runs two Codex reviews, the second told to set this plan aside and test what it
  does not name.

## Task 1 — the permission

Files: `packages/identity/src/permissions.ts`, `packages/identity/src/permissions.test.ts`.

1. Tests first:
   - A new case: `personal_data.export` is in `PERMISSIONS`; `roleHasPermission` is true for
     `admin` and false for `manager`, `supervisor` and `staff`; `permissionsForRole("admin")`
     contains it and `permissionsForRole("manager")` does not.
   - The manager case's `ADMIN_ONLY` set (`permissions.test.ts:34-38`) gains
     `"personal_data.export"`; the three existing entries stay.
   Run `pnpm --filter @waitron/identity exec vitest run src/permissions.test.ts`; watch the new case
   fail.
2. Add the id after `person.admin` with the comment of decision 7.
3. Omission control, run and reverted: add the id to `MANAGER`'s set as well → the new case and the
   manager case both fail.
4. Run `pnpm --filter @waitron/identity typecheck`. Read the test count.

## Task 2 — the actions part

Files: `apps/server/src/personal-data-actions.ts` (new), `apps/server/src/personal-data-actions.test.ts`
(new).

Interface (decision 1): `export const ACTIONS_FILES = ["actions.json"] as const;`
`export function actionsPersonalData(): PersonalDataPart[]` returning one part, owner `"server"`.
`prepare(tx, subject)` runs four queries, each awaited before the next: the voids, the tender
refunds, the bill-payment refunds, the drawer openings, each with the joins of decision 6 to the
sale and its series (and, for bill payments, to the order's sale). It keeps the rows; the build
function shapes them into decision 6's file, or returns `[]` when all four lists are empty.

Columns, so Task 4's guard can hold them (in: read and shaped; out: never read into the file):

| Table | In (as) | Out |
| --- | --- | --- |
| `sale_voids` | `sale_id` (as `sale`, and the sale's `total` as `amount`), `voided_at` (as `at`), `voided_by` (selects) | `id`, `reason` |
| `tender_refunds` | `sale_id` (as `sale`), `applied_amount` (as `amount`), `tip_amount` (as `tip`), `method`, `state`, `created_at` (as `at`), `requested_by`, `authorized_by`, `attested_by` (select; as `yourPart`) | `id`, `tender_id`, `submission_id`, `fingerprint`, `reason`, `attestation_note`, `source`, `device_id`, `node_id`, `location_id`, `manual`, `provider`, `provider_payment_ref`, `completed_at`, `failed_at`, `sent_at`, `send_count`, `refs_before_send`, `provider_refund_ref`, `provider_status`, `last_lookup_at`, `next_retry_at` |
| `bill_payment_refunds` | `bill_payment_id` (as `sale`, through the payment's order, and the payment's `method`), `applied_amount`, `tip_amount`, `state`, `created_at`, `requested_by`, `authorized_by`, `attested_by` | `id`, `submission_id`, `fingerprint`, `reason`, `source`, `device_id`, `sent_at`, `send_count`, `provider_refund_ref`, `refs_before_send`, `attestation_note`, `completed_at`, `failed_at` |
| `drawer_opens` | `reason`, `opened_at` (as `at`), `sale_id`, `bill_payment_id`, `tender_refund_id` (as `sale`), `via_override` (as `viaOverride`), `person_id`, `authorized_by` (select; as `yourPart`) | `id`, `device_id`, `printer_id` |

Before writing the tests, print each table's columns with `getTableConfig` in a throwaway case
(deleted after) and check them against this table; a column the table lacks is classified in the
pull request and the plan's review, not silently.

1. Tests first (`useVenueDb` with the core migrations; fixture helpers in the test file; read
   `apps/server/src/working-order.test.ts` or the tender-refund suites for how a sale, a series, a
   tender, a bill payment and a device are seeded):
   - **Fixture.** Marta and a colleague, Luis. Distinct sales, numbers and amounts for each. Marta:
     one void she authorised; a tender refund she requested and Luis authorised (cash, completed);
     one she both requested and authorised (card, pending); one bill-payment refund she attested,
     on a bill that has been invoiced, and one she requested on a bill not yet invoiced; drawer
     openings she made for a cash sale, for a bill payment, for a tender refund, one manual she
     authorised for Luis with `via_override` true, and one calibration. Luis: one void, one refund
     and one drawer opening of his own, none naming Marta. Every row with a distinct, explicit time.
   - **Exact file.** Prepare, build, parse: `toEqual` the whole expected object of decision 6,
     every key, every list in order, every amount as a two-place string, each `sale` as
     `formatInvoiceNumber(code, number)`, the not-yet-invoiced refund's and the calibration's
     `sale` null, `yourPart` as decision 2 says (`["requested"]` on the refund Luis authorised,
     `["requested", "authorized"]` on the one she did both, `["attested"]`, `["authorized"]` on the
     manual opening, `["opened", "authorized"]` on the calibration).
   - **Only hers.** None of Luis's sale numbers or amounts appears in the text.
   - **No other person.** Luis's person id appears nowhere in the text, though he authorised one of
     her refunds and she authorised his drawer opening; Marta's own id appears nowhere either (the
     file needs neither). Positive control in the same helper: one of her sale numbers is found.
   - **No row, no file.** A person with no action gets `[]`.
   - **No reason text.** Every row's reason and note is a distinct string; none appears.
   Run `pnpm --filter @waitron/server exec vitest run src/personal-data-actions.test.ts`; watch it
   fail.
2. Write the part.
3. Omission controls, each run and reverted, the failing line recorded for the pull request: drop
   the `person_id` condition from the drawer read → "only hers" fails; select `authorized_by`'s
   value into the refund entry → "no other person" fails; drop the order-to-sale join → the exact
   file fails on the invoiced bill-payment refund; sort by row id only → the exact file fails.
4. Run `pnpm --filter @waitron/server typecheck`. Read each count.

## Task 3 — time the locked read on the real schema

Files: none committed. A throwaway test in `apps/server`, deleted at the end (`git status --short`
shows nothing of it).

1. With the core migrations, write 1,000,000 drawer openings across 30 people, one sale each, and
   20,000 voids, in a file database, not `:memory:` (raw multi-row inserts; foreign keys may be
   switched off for the load with `pragma foreign_keys = off` outside any transaction, then back
   on). Then time `actionsPersonalData()[0].part.prepare` for one person three times, and its build
   once.
2. Before running, write down what a failing case prints: a median over 250 ms. Record the median,
   the row count returned, and the build's time and the file's size for the pull request and the
   Review focus.
3. **Stop rule.** Over 250 ms: stop, commit nothing, and report to the coordinator with the
   numbers; the plan then gains an index slice (a migration) and this slice does not carry it.
   Otherwise go on.

## Task 4 — the actor-column guard

Files: `apps/server/src/personal-data-actions.coverage.test.ts` (new).

1. Tests first:
   - **Every actor column is classified.** Walk every drizzle table exported by
     `@waitron/db`'s schema index (`is(value, SQLiteTable)`, as `packages/identity/src/personal-data.coverage.test.ts`
     does), keep columns whose name matches decision 2's pattern, and require the set to equal
     `READ ∪ NOT_YET ∪ NOT_A_PERSON` with no column in two of them. `READ` is decision 2's nine;
     `NOT_A_PERSON` is `print_jobs.claimed_by` and `invoice_deliveries.claimed_by`; `NOT_YET` is
     the other 25, each with the reason "not in the download yet: backlog, who did what"
     (`bill_payments.attested_by`, `bill_payments.requested_by`, `daily_closes.closed_by`,
     `incidents.acknowledged_by`, `invoice_deliveries.person_id`, `invoice_pdf_downloads.person_id`,
     `line_service_cancellations.actor_id`, `membership_clearances.person_id`,
     `membership_removals.person_id`, `order_amendments.actor_id`, `order_draft_events.actor_id`,
     `order_draft_events.from_person`, `order_draft_events.to_person`, `order_group_events.actor_id`,
     `order_groups.fired_by`, `order_groups.submitted_by`, `parties.closed_by`, `parties.opened_by`,
     `pass_item_marks.done_by_person_id`, `receipt_reprints.person_id`, `sales.authorized_by`,
     `sales.operator_id`, `ticket_item_moves.moved_by_person_id`, `unpaid_departures.authorized_by`,
     `unpaid_departures.recorded_by`).
   - **The four tables' columns.** For each table of Task 2's column table, its full column set
     equals that row's in plus out, with no column in both.
   - A comment at the top says what it is weaker than: it knows an actor column only by its name,
     it reads `@waitron/db`'s schema alone (other modules' actor columns are in the backlog point,
     not here), and it proves a column was classified, not that the part honours it (Task 2 does).
   Run `pnpm --filter @waitron/server exec vitest run src/personal-data-actions.coverage.test.ts`.
   It should pass at once; its proof is step 2.
2. Omission controls: remove `sales.operator_id` from `NOT_YET` → the first case fails; move
   `drawer_opens.device_id` out of both lists → the second fails; put `drawer_opens.person_id` in
   both `READ` and `NOT_YET` → the first fails.

## Task 5 — the README's words for `actions.json`

Files: `apps/server/src/i18n/personal-data-readme.ts`, `apps/server/src/personal-data-readme.test.ts`.

Words (shape `holds`, `use`, optional `sentTo`, `kept`, `i18n/personal-data-readme.ts:1-8`):

| Key | English | Spanish |
| --- | --- | --- |
| `holds` | `the sale voids you authorised, the refunds you asked for, authorised or recorded the outcome of, and the cash-drawer openings you made or authorised: how many of each and, for each one, the sale number where there is one, the amount where there is one, when it happened and your part in it.` | `las anulaciones de ventas que autorizaste, las devoluciones que pediste, autorizaste o cuyo resultado registraste, y las aperturas del cajón de efectivo que hiciste o autorizaste: cuántas hay de cada una y, de cada una, el número de venta si lo tiene, el importe si lo tiene, cuándo ocurrió y qué parte tuviste tú.` |
| `use` | `Kept to account for the money the venue takes and gives back.` | `Se guarda para dar cuenta del dinero que el local cobra y devuelve.` |
| `kept[0]` | `Nothing in the box deletes a void, a refund or a cash-drawer opening.` | `Nada en el servidor Waitron del local borra una anulación, una devolución ni una apertura del cajón de efectivo.` |

No `sentTo` of its own, so the README's shared backup line is the only recipient line it adds to.

**What backs each sentence.** The implementer re-checks each row on the branch and fixes the
sentence, not the row, where they disagree; a sentence with no row is not shipped.

| Sentence | Source |
| --- | --- |
| holds | decision 6's shape and decision 2's `yourPart` (`voided_by` is the authoriser, `sale-voids.ts:19-21`; `attested_by` is the manager who recorded a refund's outcome, `bill-payments.ts:60-62` on the bill payment's column of the same name) |
| use | design §2.1 row s12, purpose "accountability, fraud" |
| kept | `git grep -n -E '\.delete\((drawerOpens\|tenderRefunds\|billPaymentRefunds\|saleVoids)\)\|delete from "?(drawer_opens\|tender_refunds\|bill_payment_refunds\|sale_voids)' -- 'packages/*/src' 'apps/*/src' ':!*.test.ts' ':!**/testing/**'` printed nothing on 2026-10-25; re-run it with a control that finds something (the same shape over `persons` in test files did); `sale_voids` is also append-only (`packages/db/src/classification.ts:21`) and bill-payment refunds carry a no-delete trigger (`bill-payments.ts:134-138`) |
| no `sentTo` | none of the four tables is in the configuration export's list (`packages/db/src/configuration-transfer.ts:40-…`, read the whole list); and check that the filing records a void sends to the tax agency carry no person: read what `packages/core/src/record-void.ts` hands the fiscal seat and grep `packages/fiscal-verifactu/src` for `voidedBy`, `authorizedBy` and `operatorId` (on 2026-10-25 the grep found `operatorId` only in `allocated-standby.ts` and `allocation-envelope.ts`, which this plan did not read). If a person is sent, add a `sentTo` sentence in both languages saying where, and say so in the pull request |

1. Tests first, in `personal-data-readme.test.ts`:
   - The server-files case (`:275-276`) reads
     `[...timeRecordPersonalData(ALL_MODULES), ...actionsPersonalData()].flatMap((p) => p.part.files)`;
     both languages must have words for each.
   - A new case: `files: ["profile.json", "sign-in.json", "actions.json"]` in English, `toBe` the
     whole expected text written out in the test; the same in Spanish built from
     `PERSONAL_DATA_README_WORDS.es`.
   Run `pnpm --filter @waitron/server exec vitest run src/personal-data-readme.test.ts`; watch both
   fail.
2. Add the words.
3. Omission control: delete the Spanish entry → the server-files case fails.
4. Run `pnpm --filter @waitron/server typecheck`.

## Task 6 — put the actions part in the own route

Files: `apps/server/src/me-api.ts` (`serverParts` at `:126` becomes
`[...timeRecordPersonalData(modules), ...actionsPersonalData()]`),
`apps/server/src/me-api.personal-data-export.test.ts`, `apps/server/src/start-full-disk.e2e.test.ts`
(its mount's `serverParts`, `:352-361`, gains the actions part).

1. Tests first: in `me-api.personal-data-export.test.ts`, one new case: mounted with
   `["core", "identity"]`, a person with one void they authorised gets `actions.json` in the ZIP,
   listed in the README; the existing cases pass unedited (their people have no action rows, so no
   file, decision 6). Run
   `pnpm --filter @waitron/server exec vitest run src/me-api.personal-data-export.test.ts`; watch it
   fail.
2. Add the part to both mounts.
3. Omission control: drop it from the `mountMeApi` mount → the new case fails.
4. Run unedited: `pnpm --filter @waitron/server exec vitest run src/personal-data-export-api.test.ts src/personal-data-export-api.readme.test.ts src/personal-data-export-api.workforce.test.ts src/boot.personal-data-export.test.ts`
   and `pnpm --filter @waitron/server exec vitest run src/start-full-disk.e2e.test.ts -t "personal-data"`
   (on macOS it makes its own small disk with `hdiutil`). Read each count. If one fails only
   because its fixture holds an action row, its whole-list assertion gains `actions.json`, named in
   the pull request (Global constraints).

## Task 7 — the admin route

Files: `apps/server/src/personal-data-export-api.ts`, `apps/server/src/personal-data-export-api.staff.test.ts`
(new), `apps/server/src/me-api.ts` (the comment of decision 9, `:104-109`).

Interface: `mountPersonalDataExportApi` also mounts `GET /management-api/staff/:id/personal-data/export`,
wrapped in `withPersonalDataErrors`, calling `sendPersonalData(c, deps, authorize)` with decision
8's `authorize`, which returns `{ personId: target.id, label: target.displayName, language }`
(decision 10). The target is read from `persons` (`@waitron/identity` exports the table,
`packages/identity/src/index.ts:55`), selecting only `id`, `display_name` and `locale`. The map
gains the two entries of decision 8. The id check uses `isUuid` (`packages/shared/src/ids.ts:28`).

1. Tests first (`useVenueDb` with core and identity migrations; the existing route test's setup,
   `personal-data-export-api.test.ts:1-148`, read and copied, with a stub server part that records
   its subject; seed an admin, a manager, a supervisor, a staff member, and Marta, disabled by SQL,
   with a saved locale of `es-ES`):
   - **An admin downloads a disabled person.** 200; the four headers of S2a1 decision 7; the name
     `marta-…-<date>.zip`; the stub's subject has Marta's id and `language: "es"` though the admin's
     saved locale is `en-GB` and the request sends `Accept-Language: en-GB`; the README's first line
     is the Spanish title; `profile.json` holds Marta's email.
   - **The venue's language when the person has none**: a target with no saved locale and a venue
     locale of `es-ES` gives `language: "es"`; with `en-GB`, `"en"`.
   - **A manager is refused another person's download**: 403 `authorization.not_permitted`
     `{ permission: "personal_data.export" }`, no ZIP. The same for a supervisor and for a staff
     member.
   - **A staff member gets only their own**: the same staff member naming their own id on the admin
     route is refused 403; on the own route they get a ZIP whose `profile.json` is theirs and holds
     none of Marta's values.
   - **Permission before the id**: a manager naming an unknown UUID and a malformed id both get 403,
     not 404.
   - **Unknown and malformed ids for an admin**: 404 `person.not_found` with `{ personId }` for
     each.
   - **A query** from an admin: 400 `management.request_invalid` `{ field: "query" }`.
   - **Session refusals**: no cookie 401 `management_session.required`; an ended admin session 401;
     a disabled admin's live session 403 `person.suspended`.
   - **The re-check repeats the permission**: the stub part's build function sets the admin's role
     to `manager` through `withTransaction` → 403 `authorization.not_permitted` and no ZIP.
   - **Nothing written**: the admin session's `last_seen_at`, set five minutes back, is unchanged.
   - **No secret**: Marta's PIN hash (seeded before disabling her, then set by SQL so the row still
     carries one) and the admin session's token hash are in no unzipped file; Marta's email is (the
     positive control).
   Run `pnpm --filter @waitron/server exec vitest run src/personal-data-export-api.staff.test.ts`;
   watch it fail.
2. Write the route and the comment.
3. **Proof by deletion**, each run and reverted, the failing case recorded for the pull request:
   replace `authorizeManager` with `resolveManagementSession` (no permission) → the manager,
   supervisor and staff cases fail; change the permission to `person.manage` → the manager case
   fails (the manager holds it), so the test can tell the right permission from a wrong one; check
   the id before the permission → "permission before the id" fails; use the requester's language →
   the first case fails; drop the role re-check by caching the first `authorize` result → the
   re-check case fails.
4. Run unedited `pnpm --filter @waitron/server exec vitest run src/personal-data-export-api.test.ts src/me-api.test.ts src/me-api.cross-person.test.ts`
   and `pnpm --filter @waitron/server typecheck`.

## Task 8 — the admin's download end to end

Files: `apps/server/src/personal-data-export-api.workforce.test.ts`,
`apps/server/src/start-full-disk.e2e.test.ts`.

1. Tests first:
   - In `personal-data-export-api.workforce.test.ts` (S2b's whole-ZIP file, every module mounted
     through `mountMeApi`): Marta's fixture gains a void, a refund and a drawer opening, and the
     colleague's one of each, all with distinct sale numbers; the entry list gains `actions.json`
     after `staff-roles.json`, before `time-record.pdf` (the server parts' order). A new case: an
     admin downloads Marta after she is disabled (by SQL, after her rows are written): the entries
     are the same list; each of her distinct values, the actions included, is found in some file;
     none of the colleague's is, except the colleague's display name as `rota.json`'s
     `otherPerson` (S2b decision 8); her PIN hash and the admin session's token hash are in no file
     and her email is. This is the design's S2 test for the admin route: "a fixture with a distinct
     value in every table that names the person, each asserted present" (§5.3), met with the
     package suites as S2b Task 9b says.
   - In `start-full-disk.e2e.test.ts`: `beforeAll` seeds an admin beside Marta and Sergio
     (`seedPerson("admin", "Ana")`, `:257-258`); a new case beside the own route's (`:438-456`): on
     the full disk with a change waiting, the admin route for Marta answers 200 with a ZIP, the
     admin session's `last_seen_at` is unchanged, and the waiting change is still there.
   Run `pnpm --filter @waitron/server exec vitest run src/personal-data-export-api.workforce.test.ts`
   and `pnpm --filter @waitron/server exec vitest run src/start-full-disk.e2e.test.ts -t "personal-data"`.
   Both should pass at once (Tasks 6 and 7 built what they read); the proof is step 2.
2. Omission controls, each run and reverted: drop the actions part from the `mountMeApi` mount →
   the entry list fails; give the colleague's void Marta's person id → the colleague check fails.
3. Run `pnpm --filter @waitron/server typecheck`. Name the changed entry list in the pull request.

## Task 9a — the API client and the row item

Files: `apps/dashboard/src/api/client.ts`, `apps/dashboard/src/api/client-routes.test.ts`,
`apps/dashboard/src/widgets/staff-list.ts`, `apps/dashboard/src/widgets/staff-list.personal-data.test.ts`
(new), `apps/dashboard/src/i18n/strings.ts` (`person.download_data`: "Download their data" /
«Descargar sus datos»).

1. Tests first:
   - In `client-routes.test.ts`, beside the own download's case (`:1697-1718`):
     `downloadPersonalData("p 1")` requests `/management-api/staff/p%201/personal-data/export`,
     `GET`, credentials included, not passive, and returns the header's file name.
   - In the new staff-list file (browser): with `canExportPersonalData` the menu's buttons end with
     `download-data-p1`, after the existing ones, whose order is unchanged; without it there is no
     such button, with `canAdminister` true or false; a press dispatches one `download-person-data`
     `{ personId: "p1" }`, `bubbles` and `composed`, and no `person-action`; with
     `downloadingPersonId` set, every row's item is `disabled`; changing either property after the
     first render redraws the menu (the memo inputs); the item's text is `t("person.download_data")`
     in English and Spanish.
   Run `pnpm --filter @waitron/dashboard exec vitest run src/api/client-routes.test.ts src/widgets/staff-list.personal-data.test.ts`;
   watch them fail.
2. Write the method, the two properties, the item and the strings.
3. Omission control: leave `canExportPersonalData` out of the memo inputs → the redraw case fails.
4. Run unedited `pnpm --filter @waitron/dashboard exec vitest run src/widgets/staff-list.test.ts src/widgets/staff-list.a11y.test.ts src/screens/staff-authority.test.ts`
   and `pnpm --filter @waitron/dashboard typecheck`.

## Task 9b — the screen's handler, its status and its refusals

Files: `apps/dashboard/src/screens/staff-screen.ts`, `apps/dashboard/src/screens/staff-screen.personal-data.test.ts`
(new), `apps/dashboard/src/i18n/strings.ts`.

Strings (English / Spanish):

| Key | English | Spanish |
| --- | --- | --- |
| `staff.data_copy_busy` | Preparing a copy of {name}'s data… | Preparando una copia de los datos de {name}… |
| `staff.data_copy_not_permitted` | decision 12's English sentence | decision 12's Spanish sentence |
| `staff.sign_in_as_admin` | Sign in as an administrator | Iniciar sesión como administrador |

1. Tests first (browser; the new file's own API stub, built like the existing staff-screen suites'
   with `listStaff` plus `downloadPersonalData`; each case restores the language it changed):
   - **A press saves the file**: one call with the person's id; spied `URL.createObjectURL`,
     `revokeObjectURL` and the anchor's `click`, as `profile-screen.personal-data.test.ts` does; the
     anchor's `download` is the server's name, or `personal-data.zip` when it is null.
   - **While it is sent** (the API's promise held): the status line reads the busy text with the
     person's name, `role="status"`; `list.downloadingPersonId` is the id; a second event makes no
     second call; axe finds nothing; once resolved the line is gone and the id null.
   - **A name with `$&`** prints as typed in the busy line.
   - **A permission refusal**: the API rejects `{ code: "authorization.not_permitted" }`: the alert
     reads decision 12's sentence with the name, and holds the sign-in button; pressing it dispatches
     one `admin-sign-in`, bubbling and composed. Other codes show `codeMessage(code)` and no button.
     Neither disables the item; the next press clears the line.
   - **The dialogs' feet stay clear**: after a failed download, opening the edit dialog shows no
     message at its foot.
   - **Leaving while it is sent** drops the answer: no anchor click, no message.
   - **Spanish**, and **light and dark** with axe, for the status line and the alert.
   Run `pnpm --filter @waitron/dashboard exec vitest run src/screens/staff-screen.personal-data.test.ts`;
   watch it fail.
2. Write the property, the handler, the two lines and the strings.
3. Omission controls: drop the early return → the second-event case fails; put the failure in
   `errorKey` → the dialog-foot case fails; use `String.replace` with the name as a string → the
   `$&` case fails.
4. Run unedited `pnpm --filter @waitron/dashboard exec vitest run src/screens/staff-screen.test.ts src/screens/staff-screen.a11y.test.ts src/screens/staff-edit.unsaved.test.ts src/screens/staff-create.unsaved.test.ts src/screens/staff-filters.test.ts`
   and `pnpm --filter @waitron/dashboard typecheck`.

## Task 9c — the app passes the permission and answers the sign-in

Files: `apps/dashboard/src/dashboard-app.ts` (`:2553-2557`), `apps/dashboard/src/dashboard-app.test.ts`.

1. Tests first, beside "passes admin authority to the staff screen" (`dashboard-app.test.ts:8685-8697`):
   - `it.each([false, true])`: with `personal_data.export` in the session's permissions or not, the
     staff screen's `canExportPersonalData` matches. The `true` row's permissions carry
     `personal_data.export` without `person.admin`, and the `false` row's carry `person.admin`
     without it, so a binding to the wrong permission fails both rows.
   - An `admin-sign-in` event from the staff screen calls `api.logout` once and returns to the
     sign-in screen (read how the existing logout cases check it; the leave coordinator's prompt
     with an unsaved draft is the existing logout's and is not retested here).
   Run `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.test.ts -t "staff screen"`;
   watch them fail.
2. Bind the property and the event to `#onLogout`.
3. Omission controls: bind the property to `person.admin` instead → both rows of the first case
   fail; drop the event binding → the sign-in case fails.
4. Run `pnpm --filter @waitron/dashboard typecheck`.

## Task 10 — the guide and the help text

Files: `apps/server/src/guide/en/staff.md`, `apps/server/src/guide/es/staff.md`,
`apps/server/src/guide-content.test.ts` (`:156-162`), `apps/dashboard/src/i18n/strings.ts`
(`profile.data_copy_help`, both languages).

The own-data section (`en/staff.md:30-38`, `es/staff.md:33-43`) gains, after the working-time
sentence: "It also holds `actions.json`, with the sale voids, refunds and cash-drawer openings you
took part in, when there are any." / «También contiene `actions.json`, con las anulaciones de
ventas, las devoluciones y las aperturas del cajón de efectivo en las que participaste, si las hay.»

The new section, after it:

> ## Download another person's data {#person-data}
>
> As an admin, you can download what the box holds about another person, for example when someone
> who has left asks for their data. On **Users**, set **Status** to **All statuses** if the person
> is disabled, open their row menu and choose **Download their data**. You get the same ZIP file the
> person gets from **Copy of your data**, with its `README.txt` in the language the person chose, or
> the venue's language if they have not chosen one. Managers do not see this action. Waitron keeps
> no list of these requests, so note the request and your answer in the venue's own records.

> ## Descargar los datos de otra persona {#person-data}
>
> Como administrador, puedes descargar lo que el servidor Waitron del local guarda sobre otra
> persona, por ejemplo cuando alguien que ya no trabaja en el local pide sus datos. En
> **Usuarios**, elige **Todos los estados** en **Estado** si la persona está deshabilitada, abre el
> menú de su fila y elige **Descargar sus datos**. Recibes el mismo archivo ZIP que la persona
> obtiene con **Copia de tus datos**, con su `README.txt` en el idioma que eligió la persona o, si
> no eligió ninguno, en el idioma del local. Los gerentes no ven esta acción. Waitron no guarda una
> lista de estas solicitudes, así que anota la solicitud y tu respuesta en los registros del local.

`profile.data_copy_help`: English `Your profile and sign-in details, your work records if the venue
keeps them in Waitron, the voids, refunds and cash-drawer openings you took part in, and a
README.txt that explains them and your rights.`; Spanish `Tus datos de perfil y de acceso, tus datos
de trabajo si el local los guarda en Waitron, las anulaciones, devoluciones y aperturas del cajón de
efectivo en las que participaste, y un README.txt que los explica junto con tus derechos.`

| Sentence | Source |
| --- | --- |
| Users, Status, All statuses, Download their data | `strings.ts` (`nav.staff`, `staff.filter_status`, `staff.filter_all_statuses`, Task 9a's key), both languages; a disabled person is hidden by the default filter (`staff-screen.ts:163`) |
| the same ZIP | the two routes call one `sendPersonalData` with the same parts (decision 9) |
| the README's language | decision 10 |
| Managers do not see this action | decision 7 and decision 11; Task 9a and 9c's cases |
| no list of these requests | design §8 O7 (no requests list); the route writes nothing (Task 7's "nothing written" case) |
| actions.json "when there are any" | decision 6, no row no file |

1. Tests first: the section list in `guide-content.test.ts` (`:156-162`) gains `"person-data"`
   after `"own-data"` (both languages, one `it.each`). Run
   `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts`; watch it fail.
2. Write the sections and the strings; check each bold label against `strings.ts`.
3. Omission control: give the Spanish section another id → the test fails.
4. Run `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts src/guide-pages.test.ts`,
   `pnpm --filter @waitron/dashboard exec vitest run src/screens/profile-screen.personal-data.test.ts`
   (browser), and from the root `pnpm exec vitest run scripts/guide-links.test.ts scripts/english-only.test.ts`.

## Task 11 (visual) — a reduced LOOK

Scripts and shots outside the worktree: `/Users/clintongormley/waitron-campaign-b/a980-s2c-scripts/`
and `/Users/clintongormley/waitron-campaign-b/a980-s2c-shots/`, named
`<what>-<lang>-<theme>-<width>.png`. Nothing committed. A fix this leads to is committed with a
test that would have caught it where one can.

Docker Desktop's socket has been missing on this Mac since 2026-10-23, so `wa-wt` dev stacks cannot
start; restarting Docker is shared state this lane does not own. Run `docker info` once first: if it
answers, also do step 4; if not, record step 4 under "not looked at", as S2a2's pull request #2049
did.

1. **The Users screen in the test runner**: a throwaway
   `apps/dashboard/src/zz-staff-data-copy.look.test.ts`, built like
   `profile-screen.a11y.test.ts:85-88`'s look screenshots, with Task 9b's stub: English and Spanish
   × light and dark × 1280 and 390 px, (a) an admin's row menu open with **Download their data**
   last, (b) the busy status line, (c) the permission refusal with its button, (d) a generic
   failure line. Copy the PNGs to the shots folder, delete the file (`git status --short` shows
   nothing of it).
2. **The guide sections**: write `/help/en/staff` and `/help/es/staff` as the server renders them
   (read how `guide-pages.test.ts` calls the renderer) to HTML files in the scripts folder and
   screenshot `#own-data` and `#person-data` with the workspace's Playwright Chromium in light and
   dark (`localStorage["waitron-theme"]`, `apps/server/src/guide-pages.ts:52`) at 1280 and 390 px.
   Record the Chromium process id and stop only it.
3. **The files**: a throwaway copy of Task 8's admin case that writes the Spanish and an English ZIP
   to the shots folder, run once and deleted; `unzip -l` each; read both READMEs whole and both
   `actions.json`. Look for: `actions.json` named once in the README with its words; counts equal
   to the lists' lengths; no colleague's sale number; amounts with two places; null sales where
   decision 6 says.
4. Only if `docker info` answered: S2a2 Task 6b's real download, as the demo's admin, of a person
   disabled first, with the shots of the menu and the saved file's name.
5. Open every PNG and file, and write one line per picture or file for the pull request's **LOOK**
   section, and a "not looked at" line for whatever was skipped and why.

## Task 12 — backlog, overview, design notes and the conventions paragraph

Files: `docs/backlog/data-protection.md` (the A980 S2 point and its S2c sub-point),
`docs/backlog.md` (the A980 entry, only if stale), `docs/superpowers/plans/2026-10-24-a980-data-protection-build.md`,
`docs/superpowers/specs/2026-10-22-a980-data-protection-design.md` (§4.2), `docs/developers/conventions-data.md`
(`:2597-2602`).

1. Grep the siblings first: `grep -rn "S2c\|actions.csv\|personal_data.export\|personal-data" docs/backlog.md docs/backlog/data-protection.md docs/developers/ docs/superpowers/plans/2026-10-2*-a980-*.md docs/superpowers/specs/2026-10-22-a980-*.md`.
2. In `data-protection.md`, the S2 point says an admin can download another person's data under
   `personal_data.export` and that the download holds `actions.json` when there is an action;
   **delete the S2c sub-point** (S2 is then finished except what the new points carry). Add as
   their own short points:
   - **The rest of "who did what"**: the 25 core columns of Task 4's `NOT_YET` list by table, and
     other modules' actor columns (the list in "Left for later"), with adjustments' cancellations
     and comps named first (decision 3).
   - **An in-place administrator sign-in** for permission refusals, which keeps the current
     session (decision 12).
   - The existing "Measure the working-time part on a box" point gains the actions read: Task 3's
     number at 1,000,000 drawer openings on the Mac.
   The "Mount the own download from `boot.ts`" point gains: the admin route is mounted by the same
   function.
3. In the overview's status paragraph, after the S2b sentence: "2026-10-25: S2c is built
   ([its plan](2026-10-25-a980-s2c-actions-admin-download.md)): the download holds `actions.json`
   (counts and the sale numbers of the person's sale voids, refunds and cash-drawer openings), and an
   admin downloads another person's data under `personal_data.export`, with the README in that
   person's language, else the venue's. Line cancellations, comps and the rest of who did what wait
   (S2c decisions 2 and 3)."
4. In the design's §4.2, after the S2b note: a dated note "2026-10-25: S2c writes `actions.json`,
   not `actions.csv`; the admin's action is **Download their data** in the person's row menu on
   **Users** (the S2c plan's decisions 5 and 11)." The worked example above it is left as written.
5. In `conventions-data.md`, the personal-data paragraph names both routes:
   "the staff personal-data downloads (`GET /management-api/me/personal-data/export` and, for an
   admin, `GET /management-api/staff/:id/personal-data/export`, …)" and "the caller checked again in
   the second", and its case list adds Task 8's admin case.
6. `pnpm exec prettier --file-info <file>` on each changed doc: `docs/` is ignored, so each prints
   `"ignored": true`.

## Root guards to run before `/finish-branch`

From the repository root, once all tasks are in:
`pnpm exec vitest run scripts/english-only.test.ts scripts/guide-links.test.ts scripts/help-tooltip-mode.test.ts scripts/native-form-fields.test.ts scripts/pinned-actions-column.test.ts scripts/style-token-names.test.ts scripts/module-seams.test.ts scripts/workspace-cycles.test.ts scripts/errors-reachable.test.ts`.
Read each count. No new package and no new dependency is added, so the shard lists and the
dependency guards should not move.
