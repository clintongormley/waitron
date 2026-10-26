# A980 slices S1b and S1b2: every place that shows the privacy notice reads the venue's saved setting

**Status: plan, 2026-10-27, the fresh plan review folded in (1 Critical, 5 Important, 14 Minor,
`~/waitron-campaign-b/a980-s1b-plan-review.md`) under the driver's two rulings of the same day.
Nothing was built when this was written.** The rulings:

1. **Split.** The invoice email's privacy notice is its own pull request, **S1b2**, built after S1b
   lands, because the owner rules whether a change to an invoice email's body lands without them
   (lanes do not land invoice work themselves). This document holds both: **Part 1 — S1b** and
   **Part 2 — S1b2, its own pull request**. Part 1 stands alone: it leaves `main` green and working,
   and no text it changes says the invoice email shows a notice.
2. **Review path: FULL** for S1b (decision 13). S1b2's path is set in Part 2's header.

Part 1's branch is `feat/a980-s1b-privacy-link-readers`, from `main` at `4960efd7b` (S1a2 landed
there as #2114; S1a as #2106 at `27ae35c09`). Part 2 is built on its own branch from `main` after
S1b lands, with this document as its plan (it reaches `main` with S1b).

Design: [A980 data protection, revision 2](../specs/2026-10-22-a980-data-protection-design.md) §4.1
(the invoice customers' notice, `:332-342`), §5.2 item 2 (`:672-680`) and §5.3 row S1 (`:715`).
Overview: [the build plan](2026-10-24-a980-data-protection-build.md), row **S1b** (`:108`), its
"S1b." note (`:193-202`) and build order step 4 (`:212`). Previous slices: the
[S1a plan](2026-10-26-a980-s1a-notice-settings.md) (the setting, its reader and writer) and the
[S1a2 plan](2026-10-26-a980-s1a2-export-privacy-contact.md), whose shape this plan copies. Backlog:
`docs/backlog/data-protection.md`, the **S1b** point (`:205-229`).

**No migration** in either part. The two columns exist (`packages/db/src/schema/tenants.ts:47-48`).
Task 0 step 5 checks that S1b's diff touches no `packages/` file.

**Not fiscal.** S1b touches no invoice, receipt, filed record or fiscal table. S1b2 adds words to the
invoice email's BODY; the invoice is the attached PDF and the filed record, and neither changes
(design §5.3 row S1, `:715`: "no: the email body is not the invoice"). In both parts the golden
huella test (`packages/fiscal-verifactu/src/write-path.e2e.test.ts`) and
`packages/fiscal-verifactu/src/inmutabilidad.test.ts` must pass **unedited**.

## Words used here

- The **taxpayer row** is the one row of `tenants` (id 1). The **privacy contact** is its two
  columns `privacy_notice_url` (the **privacy page**, the address of the venue's full notice) and
  `privacy_email`. **Unset** is SQL `NULL`. The **Privacy card** is the card on **Venue settings →
  Venue details** that saves them (S1a).
- `readPrivacyContact(tx)` is S1a's reader (`packages/provisioning/src/privacy-contact.ts:26-32`,
  exported at `packages/provisioning/src/index.ts:15-20`): the pair, or `null` when there is no
  taxpayer row.
- The **environment setting** is `WAITRON_PRIVACY_NOTICE_URL`, which every reader uses today: read
  once when the server starts (`apps/server/src/config.ts:503-511`, kept at `:548`, typed at
  `:98-99`) and handed to the mounts at `apps/server/src/boot.ts:2019`, `:2144` and `:2184`.
- A **reader** is code that shows the privacy page or email to someone. The **account emails** are
  the invitation, the password reset and the email-address check (`apps/server/src/account-email.ts`).
- **Account settings** is the dashboard page whose title is "Your profile": the account menu names
  it **Account settings** (`apps/dashboard/src/i18n/strings.ts:853`, title at `:1042`), and the
  guides call it **Account settings** (`apps/server/src/guide/en/staff.md:28`) and **Configuración
  de la cuenta** (`es/staff.md:31`). This plan uses those names in user-facing text.
- The **invoice email** is the email that sends a full invoice as a PDF
  (`apps/server/src/invoice-email.ts`), sent by the **invoice email worker**
  (`apps/server/src/invoice-email-worker.ts`). Its **projection transaction** is the one in which
  the worker reads the invoice before sending (`invoice-email-worker.ts:93`).
- A **tax record** is a filed record of the sale that the box sends to the tax authority; whether a
  sale has one is `backend.filedReceiptFor(tx, saleId) !== undefined`, the test S3 uses for its
  README (`apps/server/src/invoice-customer-data.ts:158-162`, S3 decision 11).
- A **write-lock turn** is `db.withWriteLock(...)` holding reads, with no closing change-log drain;
  `withTransaction` ends with a drain, which a full disk refuses when a change is waiting
  (`docs/developers/conventions-data.md:2630-2700`, the drain at `:2695-2700`).

## What each part builds

**Part 1 — S1b:**

1. **The account emails** read the privacy page each time one is sent, beside the venue's time
   zone (decision 2). The two identical send wrappers in `boot.ts` become one.
2. **The sign-in page and Account settings**: `GET /management-api/google/config` reads the
   privacy page on each request (decision 3), and the dashboard's live read of it refreshes when
   `tenants` changes (decision 10).
3. **The two downloads' README** (a person's own data, an invoice customer's) reads the privacy
   page in the turn that already reads the venue's name (decision 4).
4. **The environment setting goes**: config, its tests, the server README (decision 11).
5. **Docs**: the guide's Data protection page in English and Spanish (three sections; the invoice
   notice section is untouched), the conventions note on full-disk reads, the backlog (the S1b
   point becomes a short S1b2 entry), the overview (an S1b2 row and build-order step), a dated
   pointer in the design.

After Part 1 the privacy email is shown nowhere on the box (decision 5); the invoice email is as on
`main`.

**Part 2 — S1b2:**

6. **The invoice email** gains a short privacy notice in its body, from the help guide's template,
   with the privacy email and page (decisions 7, 8, 9, 14 and 15).
7. **Docs**: the guide's invoice-notice and privacy-settings sentences, the server README, the
   backlog's S1b2 entry deleted, the overview's S1b2 row, the design's §4.1 dated line.

Nothing else changes in either part: no screen's code, no setup step, no stored value, no
permission.

## The readers, on this tree

`git grep -n 'privacyNoticeUrl\|PRIVACY_NOTICE' -- apps packages scripts deploy` (run 2026-10-27),
leaving out S1a's and S1a2's own files (the Privacy card, its route, the export), finds these, and
`git grep -n privacy -- apps/server/src/invoice-email.ts apps/server/src/invoice-email-worker.ts`
finds nothing. The review's wider grep (also `privacy_notice`, `privacyEmail`, `privacy_email`,
review E1) found the same readers and no others.

| Reader | Where the link enters | Where it is shown | Part, task |
| --- | --- | --- | --- |
| Invitation, password reset (management API) | `boot.ts:2019` → `ManagementApiDeps.privacyNoticeUrl` (`management-api.ts:156`) → `deliverAccountAction` (`:194`) | `account-email.ts:132` (text), `:140-142` (HTML) | 1, Task 1 |
| Email-address check (own profile) | `boot.ts:2184` → `MeApiDeps.privacyNoticeUrl` (`me-api.ts:72`) → `:182` | the same | 1, Task 1 |
| Sign-in page, account setup | `management-api.ts:788-790`, no sign-in | `apps/dashboard/src/screens/login-screen.ts:322-331`, `:1142-1150` (at `:1309`, `:1591`) | 1, Task 2 |
| Account settings | the same route, as the live read `getGoogleConfig` | `apps/dashboard/src/screens/profile-screen.ts:346-349`, `:1071-1083` | 1, Task 2 |
| Own data download's README | `me-api.ts:130` → `PersonalDataExportDeps.privacyNoticeUrl` (`personal-data-export-api.ts:28`, `:97`) | `apps/server/src/personal-data-readme.ts:50`, `:54-59` | 1, Task 3 |
| Invoice customer download's README | `boot.ts:2144` → `invoice-customer-data-api.ts:29`, `:125` | `personal-data-readme.ts:100` | 1, Task 3 |
| Invoice email | nothing today | `invoice-email.ts:55` (the text body) | 2, Tasks 7 and 8 |

The tests and docs that set or name the environment setting: `apps/server/src/config.test.ts:258-266`,
`:296-310`, `:312-319`; `apps/server/README.md:492-495`; `docs/backlog/data-protection.md:209`,
`:318`, `:327`; and dated plan and design records under `docs/superpowers/`. No deploy file,
compose file or `.env.example` names it (`git grep -n PRIVACY -- deploy apps/server/.env.example`
printed nothing; the review also found nothing in `~/workspace/tools`, E1). No guard pins a list of
documented `WAITRON_*` variables: `scripts/deploy-image-env.test.ts:166-173` derives its list from
`config.ts`'s `requiredInProduction(…)` calls, which this variable never used; read by me and by
the review.

## What was run while writing this plan

- **By the plan's author:** reading and `git grep` only, the greps named above and in the decisions.
  No test was run and no code was changed.
- **By the plan review** (`a980-s1b-plan-review.md`, "Experiments run"):
  - **E1**, the readers grep above: 30 lines in 8 files for Task 0 step 1's grep, 0 for step 2's.
  - **E2**, how nodemailer sends a Spanish text body with a PDF attached: it said beforehand that a
    failing case would print the plain words found in the raw message; the run printed
    `contains plain 'Protección de datos': false`, the part being `quoted-printable` with `=C3=B3`
    and `=` soft breaks. That is why Part 2's tests decode the text part (Task 7 step 1).
  - **E3**, decision 2's ordering and Task 1 step 4's first control, in a throwaway clone: with the
    new read inside the `Promise.all`, `boot.setup-routes.test.ts -t "answered password reset"`
    printed `Tests 1 passed | 25 skipped (26)`; with the read in its own `await` after it,
    `Tests 1 failed | 25 skipped (26)`, `expected [] to have a length of 1 but got +0` at
    `boot.setup-routes.test.ts:349`.

Every other claim below that a test proves is a prediction for the task that runs it, and says what
the failing case would print.

## Decisions this plan makes that the spec does not

Each states the default and an example. The example venue is **Bar Ejemplo S.L.**, whose Privacy
card holds `https://barejemplo.es/privacidad` and `privacidad@barejemplo.es`. Decisions 1 to 6 and
10 to 13 are Part 1's (decision 5's last sentence and decision 6's invoice-email clause are Part
2's); 7 to 9, 14 and 15 are Part 2's.

1. **Every reader reads `tenants` when it composes its answer, never at start.** Today the link is
   read once from the environment, so a reader that captured a stored value at start would show the
   old link after a manager saves the card. Where each one reads:

   | Reader | When | Through |
   | --- | --- | --- |
   | Account emails | each email, as the send begins | its own `withTransaction(db, readPrivacyContact)`, queued with the time zone's read (decision 2) |
   | `GET /management-api/google/config` | each request | `withTransaction(deps.db, readPrivacyContact)`, as the public `GET /management-api/locales` reads the venue's name (`me-api.ts:311-324`) (decision 3) |
   | Own data README | each download | the first write-lock turn, beside `readTenant` (`personal-data-export-api.ts:73-83`) |
   | Invoice customer README | each download | the first write-lock turn, beside `readTenant` (`invoice-customer-data-api.ts:96-102`) |
   | Invoice email (Part 2) | each email | the worker's projection transaction, after the invoice is read (decision 8) |

   Every read is outside any open write: `deliverAccountAction` is called after its transaction
   ends at each call site (`management-api.ts:954`, `:1143`, `:1165`, `:1249`, `:1270`), and the
   profile route sends after `updateProfile` returns (`me-api.ts:169-178`). So none of them is a
   read inside another caller's open transaction (conventions-data.md:2183-2190).
   Example: at 18:00 a manager saves `https://barejemplo.es/privacidad`; an invitation sent at 18:01
   and a download made at 18:02 carry it, with no restart.

2. **The account emails take the privacy page the way they take the time zone: in the sender's
   settings, read for each email.** `createAccountEmailSender`'s first argument
   (`account-email.ts:75-76`) gains `privacyNoticeUrl?: string`, and `AccountEmail` (`:5-15`) loses
   its `privacyNoticeUrl`, so no caller can hand in a stale one. In `boot.ts` the two identical
   wrappers (`:2023-2032` and `:2185-2193`) become one `sendAccountEmail`, defined once after
   `resolveAccountEmail` (`:1985`), which reads all three values in ONE `Promise.all`:

   ```ts
   const [delivery, timeZone, privacy] = await Promise.all([
     resolveAccountEmail(),
     readVenueTimeZone(db, { locationId: till.locationId }),
     withTransaction(db, readPrivacyContact),
   ]);
   ```

   One `Promise.all`, not a read after it, because the password-reset route answers 202 before the
   email is built (`management-api.ts:947-958`), and shutdown waits only for reads already queued:
   "Queue both reads before an answered reset can reach shutdown's drain" (`boot.ts:2024`) and
   `settleManagementRequests` (`:2036-2040`). The case that pins it is
   `apps/server/src/boot.setup-routes.test.ts:307`; the review ran it and the control both ways
   (E3). The two comments that count the reads, `:2024` ("both reads") and `:2038` ("An answered
   reset's mail-settings read"), are reworded to name every read queued, or deleted if the
   merged wrapper makes them restate the code. Merging the wrappers also closes one point of S10's
   tidy-up list (`docs/backlog/data-protection.md:267-268`).
   Example: Ana, a new waiter, gets her invitation; below the "If you did not expect this email"
   line it reads "Privacy notice" and `https://barejemplo.es/privacidad`, as it does today when the
   environment setting is set.

3. **The sign-in route reads the stored page per request, answers only the page, and needs no
   sign-in, as today.** `GET /management-api/google/config` (`management-api.ts:788-790`) moves into
   the API's error boundary (`run`, `:295`) and reads `withTransaction(deps.db, readPrivacyContact)`.
   It answers `{ configured, privacyNoticeUrl }` with the key left out when the page is unset, the
   shape it has today (`management-api.accounts-and-receipt-config.test.ts:1641-1652`). It never
   answers the privacy email. The page is the address the venue publishes in every short notice.
   The route now opens a database transaction for every caller without a session; the public
   `GET /management-api/locales` already does the same on the same sign-in page (`me-api.ts:311-324`,
   its comment "No session is required: this exposes only public identity and languages"), so this
   adds no new kind of unauthenticated database read.
   - **No taxpayer row**: `readPrivacyContact` answers `null` and the route answers
     `{ configured }` with no link, 200. The setup-mode server mounts no management API (its
     branch, `boot.ts:1097-1457`, returns at `:1445`; `mountManagementApi` is called at `:2007`, in
     trading mode). I believe a trading box always has its taxpayer row, because the venue plan's
     first action is `ensure-tenant` (`packages/provisioning/src/venue-plan.ts:155-162`); that
     trading mode starts only after that plan ran is unchecked. The test pins the no-row answer
     either way.
   - **A failed read** answers what `run` answers for an unlisted failure, 500, and logs
     `management.failed`. The sign-in page swallows a failed read of this route
     (`login-screen.ts:331`), so it shows neither the Google button nor the link. **Account
     settings** waits for this read in the same `Promise.all` as its profile and language reads
     (`profile-screen.ts:340-353`), and any one failure shows the page's read error
     (`:369-371`), so a failure of this read alone now blocks the page, where today the route
     cannot fail (it reads no database).
   - **On a full disk with a change waiting**, `withTransaction`'s closing drain is refused
     (conventions-data.md:2695-2700), so the route answers 507 where today it answers, and the
     sign-in page loses its Google button as well as the link. The default keeps `withTransaction`
     anyway, because the same pages' other reads and sign-in itself already go through it there:
     the public locales read (`me-api.ts:314`), the profile read (`me-api.ts:152`, through
     `asStaff`, `:116-119`) and password sign-in (`management-api.ts:906`). Read, not run. Task 5
     records this in conventions-data.md's full-disk section (review M2). The alternative is a
     write-lock turn and a case in `apps/server/src/start-full-disk.e2e.test.ts`, whose full-disk
     app mounts no management API today (it mounts box health, alerts and the two downloads, from
     `:318`).
   Example: Bar Ejemplo clears its privacy page on the card; the next visitor to the sign-in page
   sees no "Privacy notice" link, and a visitor before the change saw it.

4. **The downloads read the page in the turn that already reads the venue's name.** Both READMEs
   are built from a snapshot taken in a first write-lock turn that calls `readTenant`
   (`personal-data-export-api.ts:73-83`, `invoice-customer-data-api.ts:96-102`). `readPrivacyContact(tx)`
   joins that turn, so the downloads keep answering on a full disk with a change waiting
   (conventions-data.md's S2a1 and S3 paragraphs, `:2656-2680`), and the README's builder keeps its
   `privacyNoticeUrl?: string` input (`personal-data-readme.ts:15`, `:69`), now given the stored
   value or nothing.
   Example: Jordi downloads his data; the README ends "Contact Bar Ejemplo S.L. to ask. Its privacy
   notice: https://barejemplo.es/privacidad" (`apps/server/src/i18n/personal-data-readme.ts:149-150`).

5. **After S1b the privacy email is shown nowhere; S1b2 puts it in the invoice email.** The design's
   invoice customers' notice names both values (design `:334-336`). For the account emails, the
   sign-in page, Account settings and the READMEs the design says "the link" (`:294`, `:715`) and
   nothing about the email, so they show the page alone, as today. So between S1b and S1b2 the
   Privacy card saves an email that nothing on the box shows, and the guide says so (Task 5). The
   way to show it sooner is the README's last line naming it: "Contact Bar Ejemplo S.L. at
   privacidad@barejemplo.es to ask." (owner decision A). Part 2: the invoice email shows both.
   Example: after S1b, Ana's invitation and Jordi's download show the page and not the email.

6. **Unset shows nothing, as today.** With the page unset, the account emails carry no "Privacy
   notice" line or link (`account-email.ts:132`, `:140-142`), the route leaves the key out, the two
   pages show no link (`login-screen.ts:1143`, `profile-screen.ts:1072`), and each README ends at
   "Contact … to ask." (`personal-data-readme.ts:56-58`). Every reader gets a case for unset; most
   exist today for the environment setting and are moved to the stored value. Part 2: the invoice
   email shows no notice when both values are unset (design §5.3 row S1's test column: "an empty
   setting shows nothing", `:715`), and names only the one that is set otherwise.
   Example: a box whose card says "Not set" for both sends an invitation with no privacy line, as
   on `main`.

7. **(Part 2) The invoice email's notice is the help guide's own template, filled in.** The design's
   draft (`:332-338`) was revised in S6's finish review (design `:314-315`); the guide's
   `invoice-notice` section holds the current words (`apps/server/src/guide/en/data-protection.md:79-82`,
   `es/data-protection.md:85-88`), so the email uses them and the guide and the email agree. The
   venue's name is the issuer printed on the invoice (`document.result.issuer ?? document.issuer`,
   as `receipt-document.ts:134` chooses it). The contacts are the email, then the page, joined by
   ", ", with no full stop after them, so a mail program that makes the address a link does not
   take the stop into it. It goes in the text body after the caption line and a blank line; the
   subject and the PDF do not change.
   - **The Tax Agency clause appears only when the sale has a tax record** (decision 8). A box
     without Veri\*Factu files nothing, so "including sending the Tax Agency a record of it" would be
     false there.
   Example, a Veri\*Factu sale in Spanish (subject `Factura F1/23`):

   ```text
   Factura F1/23

   Protección de datos. Bar Ejemplo S.L. trata su nombre, NIF y dirección para emitir esta factura y cumplir sus obligaciones fiscales, incluida la remisión a la Agencia Tributaria de un registro de la factura con su nombre y su NIF.
   Derechos y más información: privacidad@barejemplo.es, https://barejemplo.es/privacidad
   ```

   With only the page set and no tax record, the two lines read "Protección de datos. Bar Ejemplo
   S.L. trata su nombre, NIF y dirección para emitir esta factura y cumplir sus obligaciones
   fiscales." and "Derechos y más información: https://barejemplo.es/privacidad". Owner decision C.

8. **(Part 2) The worker reads the notice's facts in its projection transaction, through an
   optional reader.** `InvoiceEmailPassDeps` (`invoice-email-worker.ts:15-21`) gains
   `readPrivacy?: (tx, delivery) => Promise<InvoiceEmailPrivacy>`, awaited after `readDocument` in
   the same `withTransaction` (`:93`), never beside it (home CLAUDE.md §3, queries on one
   transaction in turn). `boot.ts:1911` passes
   `readPrivacy: (tx, delivery) => readInvoiceEmailPrivacy(tillBackend, tx, delivery.saleId)`.
   It is optional because about twenty worker cases in `apps/server/src/invoice-delivery.test.ts`
   (from `:1888`) and the stubs in `alert-sources.invoice-delivery.test.ts:643` and
   `till-api.deliveries.test.ts:1596` never send a real email; a pass without it sends no notice,
   and Task 8's boot case is what shows the server passes it.

   ```ts
   export interface InvoiceEmailPrivacy {
     privacyNoticeUrl: string | null;
     privacyEmail: string | null;
     /** The sale has a filed tax record, which the box sends to the tax authority. */
     taxRecord: boolean;
   }
   export type InvoiceEmailSender = (message: {
     recipient: string;
     document: ReceiptDocumentInput;
     privacy?: InvoiceEmailPrivacy;
   }) => Promise<InvoiceDeliveryOutcome>;
   export function readInvoiceEmailPrivacy(
     backend: FiscalBackend, tx: Transaction, saleId: string,
   ): Promise<InvoiceEmailPrivacy>;
   ```

   `readInvoiceEmailPrivacy` reads `readPrivacyContact(tx)` (both `null` with no taxpayer row) and
   `backend.filedReceiptFor(tx, brandSaleId(saleId)) !== undefined`, which `readInvoiceDocument`
   also calls in the same transaction (`invoice-document.ts:85`).

9. **(Part 2) The notice is in English when the invoice is in English, and in Spanish otherwise.**
   The email's other words come from the receipt labels of the invoice's language
   (`invoice-email.ts:37`), and Spain's receipt languages are `es-ES`, `ca-ES`, `gl-ES` and `eu-ES`
   (`packages/country-es/src/spain.ts:293`). The guide has the notice in English and Spanish only,
   and Spanish is official everywhere in Spain, so a Catalan, Galician or Basque invoice gets the
   Spanish notice under its own subject. This departs from the home CLAUDE.md's "Spain receipts use
   the venue's receipt language"; the email body is not a receipt, and owner decision D asks. One
   mismatch stays: an `en-GB` invoice already has a Spanish caption, because no pack has English
   receipt words (`docs/backlog/english-only-audit.md:80`; pinned by `invoice-email.test.ts:228`), so
   its email reads "Factura FF/1" above an English notice.
   Example: a Barcelona venue whose receipts are in Catalan sends subject `Factura F1/23` and the
   Spanish notice above.

10. **An open Account settings page follows a save; the sign-in page shows it on its next load.**
    Account settings watches `getGoogleConfig` (`profile-screen.ts:346-349`), whose live
    dependencies are `["google_config"]` (`apps/dashboard/src/api/live-queries.ts:520`), and
    `google_config` is not a table (`apps/server/src/live-resources.ts:3-8`, `:21`). The list gains
    `"tenants"`, a declared change source (`packages/db/src/classification.ts:90`;
    `live-queries.ts:505`, `:514`, `:519` already name it), so a save of the card refreshes it, as
    it refreshes the card's own read. The sign-in page reads the route once when it opens
    (`login-screen.ts:322-331`), and the live stream needs a session
    (`apps/server/src/live-api.ts:95-97`), so it shows a new link the next time it is opened.
    Example: Ana has Account settings open while the manager saves the card; the link appears
    without a reload. A visitor already on the sign-in page sees it after reloading.

11. **The environment setting goes, with no copy and no warning.** `config.ts` loses the field, the
    check and the return line; `boot.ts` loses its three `privacyNoticeUrl: config.privacyNoticeUrl`
    lines; the README paragraph goes. Nothing copies a set environment value into the setting:
    owner decision A of the S1a plan made the card the source, and no venue is live (home
    CLAUDE.md §3, "No backwards-compatibility … until Waitron is in production"). A server that
    still has the variable starts and ignores it, with no warning: `loadConfig` names no variable
    it does not read (a grep of `apps/server/src/*.ts` for a check of unknown `WAITRON_` names
    finds none), and a value the old check refused, such as `restaurant.example/privacy`, no longer
    stops the start. Task 4 pins that with a case. On a box, compose passes only the variables it
    lists (`deploy/compose.yml:21-41`), and nothing setup writes holds this one; a hand-edited
    `trading.env` could, because `loadBoxEnv` merges every key of `secrets.env`, `trading.env` and
    `backup.env` (`apps/server/src/box-env.ts:7`, `:10-33`), and is ignored the same way.
    Example: a developer's shell still exports `WAITRON_PRIVACY_NOTICE_URL=https://old.example/p`;
    the server starts, and every reader shows Bar Ejemplo's saved page.

12. **The guide says where Waitron shows the two values.** Part 1 changes three sections, in English
    and Spanish (Task 5):
    - `privacy-settings` loses "Nothing else on the box shows them yet." and says where the page
      shows and that the email is not shown anywhere yet;
    - `staff-notice` says Waitron shows the page from the Privacy card in staff emails, on the
      sign-in page and in Account settings, and its placeholder "_the address of your staff privacy
      page_" (`en/data-protection.md:65-66`; «_dirección de la página de privacidad del
      personal_», `es/:70-71`) becomes "_the address of your privacy page_" («_dirección de la
      página de privacidad_»), because Waitron holds one page for everyone;
    - `full-notice` says to enter this page's address on the Privacy card.
    `invoice-notice`'s "Waitron does not show this notice anywhere yet." (`en/:84-85`; `es/:90-91`)
    stays in Part 1; Part 2 (Task 9) replaces it.

13. **Review path for S1b: FULL** (driver ruling 2). Against the home CLAUDE.md's risk triggers:
    **concurrency**, because decision 2 changes what an answered password reset queues before
    shutdown drains the store, an ordering the code states (`boot.ts:2024`, `:2036-2040`) and one
    case pins (E3); **a sign-in-free route** starts reading the taxpayer row (decision 3).
    **Auth and permissions**: no permission or session rule changes. **Cross-package contract**:
    the dashboard's live dependency list and the route's answer, whose shape does not change.

14. **(Part 2) The notice's words live in the server's translation folder, Tax Agency clause
    included.** Design §5.3 says "Spain-only legal wording goes in `packages/country-es` with English
    beside it" (design `:702-703`). The default puts all of it in a new
    `apps/server/src/i18n/invoice-email-notice.ts`, keyed `en` and `es`, because the same design
    sentence puts "server-written text such as the export's README" in `apps/server/src/i18n/`, and
    S3's README already names the Agencia Tributaria there
    (`apps/server/src/i18n/personal-data-readme.ts:306-307`, `:323-324`). The alternative is the
    clause's words in `packages/country-es`, with the generic sentence in the server.

15. **(Part 2) A failed read of the notice's facts stops that email, as a failed read of the invoice
    does.** The worker's one `catch` (`invoice-email-worker.ts:101-103`) records the attempt as
    `unknown` with `transport_failed`, and the invoice is not sent, because of a read the PDF does
    not need. The alternative is sending the email without a notice when that read fails. Owner
    decision F.

## Open decisions for the owner (FYI, built with the default)

**Part 1 — S1b:**

- **A. After S1b the privacy email is shown nowhere** (decision 5). Worked example: Bar Ejemplo saves
  `privacidad@barejemplo.es`; Ana's invitation, the sign-in page, Account settings and Jordi's
  download show `https://barejemplo.es/privacidad` and not the email, and the guide says the email
  is not shown yet. S1b2 puts it in the invoice email. Alternative, to show it sooner: the README's
  last line names it, "Contact Bar Ejemplo S.L. at privacidad@barejemplo.es to ask."
- **B. A server that still has `WAITRON_PRIVACY_NOTICE_URL` set ignores it silently** (decision 11).
  Worked example: the variable holds `https://old.example/p`; nothing warns, and the readers show
  the card's value, or nothing while the card is empty. Alternative: a start-up warning naming the
  retired variable.

**Part 2 — S1b2:**

- **C. The invoice email's Tax Agency clause appears only for an invoice with a tax record**
  (decision 7). Worked example: Bar Ejemplo runs Veri\*Factu, so its invoice emails say "incluida la
  remisión a la Agencia Tributaria de un registro de la factura con su nombre y su NIF"; a box
  without Veri\*Factu, whose sales file nothing, says only "para emitir esta factura y cumplir sus
  obligaciones fiscales." Alternative: the clause always, as the guide's template has it.
- **D. The notice is in Spanish for a Catalan, Galician or Basque invoice** (decision 9). Worked
  example: a Girona venue's invoice email has the subject `Factura F1/23` and the Spanish notice.
  Alternative: the notice in each of Spain's receipt languages; the Catalan, Galician and Basque
  words would need a native speaker's check before they ship.
- **E. The notice shows on duplicates too.** Worked example: staff resend Jordi's invoice; the email
  says "Factura F1/23 — DUPLICADO" and carries the same notice. Alternative: the original only.
- **F. If the notice's facts cannot be read, the invoice email is not sent** (decision 15). Worked
  example: the read of the Privacy card's values fails for Jordi's invoice; the attempt is recorded
  as "may not have arrived", as when the invoice itself cannot be read, and staff can send it again
  from **Orders**. Alternative: send the invoice without the notice.
- **And the landing question itself** (driver ruling 1): whether S1b2, a change to an invoice
  email's body, lands without the owner.

## Global constraints

- **TDD.** Each task writes its failing test first, runs it and watches it fail for the reason
  named, then writes the code. Where a case pins behaviour that already holds, the task says so and
  names the control that makes it fail.
- **English only** in code, identifiers, comments, fixtures and tests. Spanish only in
  `apps/server/src/guide/es/data-protection.md` and, in Part 2,
  `apps/server/src/i18n/invoice-email-notice.ts`'s `es` half. A test of Spanish text reads its
  expected words from the translation file, as `me-api.personal-data-export.test.ts:212` reads
  `PERSONAL_DATA_README_WORDS`. Fixture values: `https://example.com/privacy` and
  `privacy@example.com`; a value is stored with `savePrivacyContact` inside `withTransaction`,
  never written to `tenants` from a test's own SQL.
- **Fixtures use values the two sides could treat differently**: a page saved, then changed, then
  cleared in the same running server or mount, so a reader that kept the first value fails; and an
  email and a page that differ, so a notice that prints one twice or in the wrong order fails.
- **Every database test uses `useVenueDb`.** In a file with `resetPerTest: false`, a case that stores
  a value clears it in `onTestFinished`, so a failing run leaves nothing for the next case. Exact
  shapes use `toEqual` or `toBe`; `toMatchObject` only where the file's own siblings use it for the
  same assertion.
- **Error codes** are unchanged: no new code, and no refusal carries a privacy value. No new log
  line.
- **Coverage**: `@waitron/server` and `@waitron/dashboard` hold 98/98/98/95. No exclude or ignore
  comment. Neither is mutation-tested on a pull request (home CLAUDE.md §2 lists `ui`, `ui-core`,
  `shared`, `fiscal` and `db`). No package under `packages/` changes.
- **The pre-production rule** (home CLAUDE.md §3): no code reads, copies or warns about the retired
  environment variable.
- **New server test files**: none. New cases go into the files named. (A new file would be packed at
  the duration table's mean, `docs/developers/ci-and-gates.md:1493`; none is needed.)
- **Greps** use the pathspec `'packages/*/src/**' 'apps/*/src/**'` (add `'scripts/**'` where guards
  matter); the shell's `grep` is ugrep, so call `/usr/bin/grep` where an exit status decides.
- Commits `git commit -s`; `pnpm format:check` before each commit.
- An implementer that passes about 150 tool calls with its task unfinished stops at a passing or
  cleanly failing point, commits, and hands over: what is done, what is left, the files, each
  check's state.
- Browser suites (`@waitron/dashboard`): check `memory_pressure | grep free` first; run beside
  another session only well above 15% free.
- Under an AI agent Vitest hides a passing test's console output; read each run's `Tests` line.

## Changed test checks

Every change to an existing test, by kind. The implementer names each in its commit and the pull
request lists them all. Anything not listed here that has to change is a STOP: say why in the
handover. Part 2 changes no existing check.

**Part 1, checks that move from the environment setting or a dependency to the stored value** (the
assertion stays; only where the value comes from changes):

| Where | Now | Becomes | Task |
| --- | --- | --- | --- |
| `apps/server/src/account-email.test.ts:45-53` | `privacyNoticeUrl` in the message | in the sender's settings; the `href` assertion at `:65` unchanged | 1 |
| `apps/server/src/management-api.accounts-and-receipt-config.test.ts:1641-1652` | the link from `mountWith({ privacyNoticeUrl })` | stored with `savePrivacyContact` after `setupTenant()`; both `toEqual` answers unchanged | 2 |
| `apps/server/src/me-api.personal-data-export.test.ts:38-41`, `:58-61` | `patch` typed with `privacyNoticeUrl` | the key leaves the type | 3 |
| `apps/server/src/me-api.personal-data-export.test.ts:205-214` | `download(…, { privacyNoticeUrl: url })` | the value stored in `download`'s `beforeRequest` hook (`:58-61`, after its `seedTenant`); the two `expect`s unchanged | 3 |
| `apps/server/src/personal-data-export-api.readme.test.ts:123-128` | `mounted({ privacyNoticeUrl: PRIVACY })` | the value stored, then cleared, between the two reads; both `expect`s unchanged | 3 |

**Part 1, checks deleted with the environment setting** (Task 4), replaced by one case:

| Where | Case |
| --- | --- |
| `apps/server/src/config.test.ts:258-266` | "accepts an absolute privacy notice URL for account surfaces" |
| `apps/server/src/config.test.ts:296-310` | "refuses the privacy notice address %j, which is not an http(s) URL" (3 rows) |
| `apps/server/src/config.test.ts:312-319` | "accepts a plain http privacy notice URL" |

**Part 1, rows added to existing tables** (no existing row changes):

| Where | Row | Task |
| --- | --- | --- |
| `apps/dashboard/src/api/live-queries.test.ts:206` (after `["getVenuePrivacy", [], "tenants"]`) | `["getGoogleConfig", [], "tenants"]` | 2 |

## Review focus

**Part 1:**

- **Per-send reads** (decisions 1 and 2): one `Promise.all` holding all three reads; the shutdown
  case at `boot.setup-routes.test.ts:307` green, and its control red (E3); no stale value: each boot
  case saves, changes and clears the page in one running server.
- **The sign-in route** (decision 3): answers only `configured` and the page; no email key; no
  taxpayer row answers 200 with no link; no session needed, as before.
- **The environment setting is gone**: Task 4 step 5's and Task 5 step 8's greps print exactly the
  hits they name.
- **Nothing says the invoice email carries a notice**: Task 5 step 7.
- **Docs**: every guide sentence against the code (Task 5's table), both languages.
- **Codex run-it seat**: two reviews, the second told to set this plan aside.

**Part 2:**

- **The invoice email** (decisions 7 to 9, 14, 15): the words equal the guide's sentences (Task 9's
  table); the clause only with a tax record; nothing in the subject or PDF changes (the existing
  assertions in `invoice-email.test.ts:211-300` pass unedited); the read happens in the projection
  transaction, in turn; tests read the decoded text part, never the raw message.

---

# Part 1 — S1b

## Task 0: re-check before dispatching (the driver, not an implementer)

Run on the branch's then-current tip and compare with this plan. If anything differs, fix the plan
before Task 1.

1. `git grep -n "privacyNoticeUrl\|PRIVACY_NOTICE" -- 'apps/server/src/**' ':!*.test.ts'`: expected,
   30 lines in 8 files on `4960efd7b`: `account-email.ts`, `boot.ts`, `config.ts`,
   `invoice-customer-data-api.ts`, `management-api.ts`, `me-api.ts`, `personal-data-export-api.ts`
   and `personal-data-readme.ts` (the README builder's own input, which keeps its name), each at
   the lines this plan cites (the review counted the same, E1).
2. `git grep -n privacy -- apps/server/src/invoice-email.ts apps/server/src/invoice-email-worker.ts`:
   expected, nothing.
3. `git grep -n "getGoogleConfig" -- apps/dashboard/src/api/live-queries.ts`: expected,
   `:520` with `["google_config"]`.
4. `sed -n 2020,2035p apps/server/src/boot.ts` and `sed -n 2180,2195p apps/server/src/boot.ts`:
   expected, the two wrappers of decision 2, identical but for the comment at `:2024`.
5. At the end of the branch, before `/finish-branch`:
   `git diff --stat main...HEAD -- packages apps/server/src/invoice-email.ts apps/server/src/invoice-email-worker.ts apps/server/src/invoice-pdf.ts apps/server/src/receipt-document.ts apps/server/src/invoice-document.ts`
   prints nothing.

## Task 1: the account emails read the privacy page for each email

Files: `apps/server/src/account-email.ts` (`AccountEmail`, the sender's settings),
`apps/server/src/boot.ts` (one `sendAccountEmail`, used by both mounts; the comments at `:2024` and
`:2038`), `apps/server/src/management-api.ts` (`:194` goes), `apps/server/src/me-api.ts` (`:182`
goes), `apps/server/src/account-email.test.ts`, `apps/server/src/boot.venue-details.test.ts` (one
new `describe`).

1. Tests first.
   - `account-email.test.ts`: move `privacyNoticeUrl` into the settings of the case at `:35-66`
     ("Changed test checks"), and add a case: the same invitation sent with no `privacyNoticeUrl`
     in the settings has no `Privacy notice` in its text and no `<a href` other than the action
     link in its HTML. This case passes before the change (no link is set either way); its control
     is in step 4.
   - `boot.venue-details.test.ts`: a new `describe("a running venue's account email privacy page")`
     with `it.each(["invitation", "password_reset", "profile"] as const)`, built from the clock
     case at `:112-273` (its `smtpReceiver`, `prepareBox`, `send`). Each path sends **four**
     emails, so build **four** invitees (`[0, 1, 2, 3]`, where the clock case builds three at
     `:134-149`): the cooldown is 60 seconds per person and per address
     (`apps/server/src/account-rate-limit.ts:14-28`, used at `management-api.ts:769-770`), the case
     freezes `Date` (`:116-117`), and a fourth reset to an address with no person, or to one
     already used, answers 202 and sends nothing (`management-api.ts:942-944`). The profile path
     changes to four different addresses (`profile-${index}`). In one running server: send with
     the card empty (no `Privacy notice`); `PUT /management-api/venue-privacy` with
     `{ privacyNoticeUrl: "https://example.com/privacy" }` (200), send (the text holds
     `Privacy notice` and the address); `PUT` `https://example.com/other`, send (the new address,
     not the first); `PUT` `""`, send (no `Privacy notice`). Strip soft line breaks as `:192` does.
   Run `pnpm --filter @waitron/server exec vitest run src/account-email.test.ts src/boot.venue-details.test.ts`;
   watch the type error or the failing cases (the settings key does not exist; the boot cases show
   no link after the save, because the link still comes from the unset environment setting).
2. Write it (decision 2). `deliverAccountAction` and the profile route stop passing a link. Reword
   or delete the comments at `boot.ts:2024` and `:2038` (decision 2).
3. Run both files again: the previous counts plus 1 and plus 3, nothing failed. Then, unedited,
   `pnpm --filter @waitron/server exec vitest run src/boot.setup-routes.test.ts -t "answered password reset"`
   (expected `Tests 1 passed`, as in E3) and
   `src/management-api.accounts-and-receipt-config.test.ts src/me-api.test.ts`.
4. Controls, each run and reverted:
   - Read the privacy page in a separate `await` after the `Promise.all`. Expected, as E3
     measured: the `boot.setup-routes.test.ts:307` case fails, `expected [] to have a length of 1`.
   - Read the page once when `bootServer` builds the wrapper instead of per send. Expected: the new
     boot cases fail at the second send.
   - In `account-email.ts`, render the "Privacy notice" line whatever the settings hold (with an
     unset value printing nothing after it). Expected: the new unset case fails.
5. `pnpm --filter @waitron/server typecheck`; at the root
   `pnpm exec vitest run scripts/personal-log-params.test.ts scripts/errors-reachable.test.ts`.

## Task 2: the sign-in route reads the stored page; Account settings follows a save

Files: `apps/server/src/management-api.ts` (`ManagementApiDeps.privacyNoticeUrl` at `:156` goes;
the route at `:788-790`), `apps/server/src/boot.ts` (`:2019` goes),
`apps/server/src/management-api.accounts-and-receipt-config.test.ts`,
`apps/dashboard/src/api/live-queries.ts` (`:520`), `apps/dashboard/src/api/live-queries.test.ts`.

1. Tests first, in `management-api.accounts-and-receipt-config.test.ts` beside `:1641`:
   - the existing case, changed as "Changed test checks" says;
   - one new case, named with "privacy page", on one mount (`mountWith({ googleOidc: GOOGLE_OIDC })`):
     with no taxpayer row the route answers 200 `{ configured: true }`; after `setupTenant()` the
     same; after `savePrivacyContact` stores both values,
     `{ configured: true, privacyNoticeUrl: "https://example.com/privacy" }` exactly (`toEqual`, so
     a `privacyEmail` key fails it); after storing `https://example.com/other`, that; after storing
     `null`, `{ configured: true }`. No cookie on any request.
   - `live-queries.test.ts`: the row in "Changed test checks".
   Run `pnpm --filter @waitron/server exec vitest run src/management-api.accounts-and-receipt-config.test.ts -t "Google sign-in is configured|privacy page"`
   and `pnpm --filter @waitron/dashboard exec vitest run src/api/live-queries.test.ts -t "getGoogleConfig"`;
   watch them fail (the dependency still answers; the dashboard row never refetches).
2. Write it (decision 3; decision 10's one line).
3. Run both files whole: the server file's previous count plus 1, the dashboard file's plus 1,
   nothing failed. At the root `pnpm exec vitest run scripts/live-subscriptions.test.ts`.
4. Controls, each run and reverted: answer the whole `readPrivacyContact` result spread into the
   body (the exact-shape assertion fails on `privacyEmail`); read the page once when the API is
   mounted (the "other" step fails).
5. `pnpm --filter @waitron/server typecheck` and `pnpm --filter @waitron/dashboard typecheck`.

## Task 3: both downloads' README read the stored page

Files: `apps/server/src/personal-data-export-api.ts` (`PersonalDataExportDeps.privacyNoticeUrl`
at `:28` goes; the first turn at `:73-83`, `readTenant` at `:76`; `:97`),
`apps/server/src/invoice-customer-data-api.ts` (`:29` goes; the first turn at `:96-102`,
`readTenant` at `:100`; `:125`), `apps/server/src/me-api.ts` (`MeApiDeps.privacyNoticeUrl` at
`:72` and `:130` go), `apps/server/src/boot.ts` (`:2144`, `:2184` go),
`apps/server/src/me-api.personal-data-export.test.ts`,
`apps/server/src/personal-data-export-api.readme.test.ts`,
`apps/server/src/invoice-customer-data-api.export.test.ts` (one new case).

1. Tests first: the two changed cases ("Changed test checks"); in
   `invoice-customer-data-api.export.test.ts`, one case using the file's `ask` (`:145`): with the
   page stored, the README's last line ends with it; with it cleared, no README line holds
   `https://`. That file shares one database across its cases (`resetPerTest: false`, `:25-26`), so
   the case clears the page in `onTestFinished`, which also runs when the case fails. Run
   `pnpm --filter @waitron/server exec vitest run src/me-api.personal-data-export.test.ts src/personal-data-export-api.readme.test.ts src/invoice-customer-data-api.export.test.ts`;
   watch the three cases fail on the missing address.
2. Write it (decision 4): `readPrivacyContact(tx)` in each first turn, carried in the snapshot, and
   the README given `privacyNoticeUrl` only when the stored value is not `null`.
3. Run the three files: previous counts plus 1 for the export file, nothing failed. Then the
   full-disk cases, unedited:
   `pnpm --filter @waitron/server exec vitest run src/start-full-disk.e2e.test.ts -t "personal-data download|invoice-customer"`
   (macOS makes its small disk with `hdiutil`; read the `Tests` line, since a missing disk skips).
4. Controls, each run and reverted: keep passing the old dependency instead of the stored value
   (the three cases fail); read the page through its own `withTransaction` before the first turn
   of the own download. Expected: the full-disk own-download case answers 507 instead of 200,
   because the drain is refused; if it still answers 200, stop and report, since decision 4's
   reason would then rest on a case that cannot tell the two apart.
5. `pnpm --filter @waitron/server typecheck`.

## Task 4: the environment setting goes

Files: `apps/server/src/config.ts` (`:98-99`, `:503-511`, `:548`), `apps/server/src/config.test.ts`,
`apps/server/README.md` (`:492-495`).

1. Test first, in `config.test.ts` where the deleted cases were: "ignores a leftover
   WAITRON_PRIVACY_NOTICE_URL, even one the old check refused": `loadConfig` with
   `WAITRON_PRIVACY_NOTICE_URL: "restaurant.example/privacy"` returns, and the config has no
   `privacyNoticeUrl` property. Run
   `pnpm --filter @waitron/server exec vitest run src/config.test.ts -t "leftover"`; watch it fail
   with `server.config_invalid`.
2. Delete the five cases of "Changed test checks" and the config's field, check and return line.
   After Tasks 1 to 3 nothing reads the field; `git grep -n "config.privacyNoticeUrl" -- apps`
   prints nothing.
3. `apps/server/README.md:492-495`: replace the paragraph with: "Waitron shows the restaurant's
   privacy notice page in the emails it sends staff to set up an account, reset a password or
   confirm a new email address, on the sign-in page, in **Account settings** and in the
   `README.txt` of a data download. It is set on the **Privacy** card in **Venue settings → Venue
   details**; there is no environment setting for it." Check each clause against Tasks 1 to 3
   before committing.
4. Run `src/config.test.ts`: its previous count minus 5 plus 1, nothing failed. At the root
   `pnpm exec vitest run scripts/deploy-image-env.test.ts`.
5. `pnpm --filter @waitron/server typecheck`; then
   `git grep -n PRIVACY_NOTICE -- apps deploy scripts packages`: expected, exactly one line, the new
   case's in `apps/server/src/config.test.ts`.

## Task 5: the guide, the conventions, the backlog, the overview and the design

Files: `apps/server/src/guide/en/data-protection.md`, `apps/server/src/guide/es/data-protection.md`,
`docs/developers/conventions-data.md`, `docs/backlog/data-protection.md`, `docs/backlog.md`,
`docs/superpowers/plans/2026-10-24-a980-data-protection-build.md`,
`docs/superpowers/specs/2026-10-22-a980-data-protection-design.md` (a dated pointer only).

1. The guide, in English (Spanish in the same places, `es/data-protection.md`, same meaning, the
   pages' own terms: **Ajustes del local**, **Datos del local**, **Privacidad**, **Configuración de
   la cuenta**):
   - `staff-notice`: the placeholder change of decision 12 (`en/:65-66`, `es/:70-71`); then, after
     its last paragraph (`en/:68-69`): "Waitron shows your privacy page, the one you set on the
     **Privacy** card (see [Your privacy page and email in Waitron](data-protection.md#privacy-settings)),
     in the emails it sends staff to set up an account, reset a password or confirm a new email
     address, on the sign-in page, in **Account settings** and in the `README.txt` of a data
     download. Waitron holds one page, so use the page of your full notice, which covers staff and
     customers alike."
   - `full-notice`, after "use that page's address in the short notices" (`en/:118-119`): "Enter the
     same address on the **Privacy** card, so that Waitron links to it (see
     [Your privacy page and email in Waitron](data-protection.md#privacy-settings))."
   - `privacy-settings`, replace "Nothing else on the box shows them yet." (`en/:166`; Spanish
     «Nada más en el equipo los muestra todavía.», `es/:173-174`) with: "Waitron shows the page in
     the emails it sends staff, on the sign-in page, in **Account settings** and in the
     `README.txt` of a data download. A change shows in the next email or download; a page already
     open shows it once reloaded, except **Account settings**, which follows it at once. Waitron
     does not show the privacy email anywhere yet."
   - `invoice-notice` does not change: "Waitron does not show this notice anywhere yet." stays, in
     both languages, until S1b2.
   Each sentence's source, checked when written and again by the reviewer:

   | Sentence | Source |
   | --- | --- |
   | staff emails carry the page | Task 1's boot cases, three paths |
   | the sign-in page and Account settings | Task 2's route case; `login-screen.ts:1142-1150`; `profile-screen.ts:1071-1083` |
   | the README of a data download | Task 3's cases, both downloads |
   | next email or download; open pages after reload; Account settings at once | decision 1; decision 10; Task 2's live row |
   | the privacy email is shown nowhere yet | decision 5; Task 0 step 2 and step 5 (the invoice email untouched) |
   | Waitron holds one page | `packages/db/src/schema/tenants.ts:47` |

   Then `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` (its `<em>` check
   on `staff-notice`, `:226-228`, still holds: the placeholder stays in italics), at the root
   `pnpm exec vitest run scripts/guide-links.test.ts`, and `pnpm format:check`.
2. `docs/developers/conventions-data.md`, in "A read on a full disk must not fail on its own
   housekeeping write" (`:2630`):
   - in the S2a1 paragraph (`:2656-2668`) "and the venue's name for the README" becomes "and the
     venue's name and privacy page for the README (the page since A980 S1b)"; in the S3 paragraph
     (`:2670-2680`) the first turn's reads gain the same;
   - a new paragraph after them (review M2): "Since A980 S1b, `GET /management-api/google/config`
     reads the venue's privacy page through `withTransaction`, so on a full disk with a change
     waiting it answers 507 and the sign-in page shows neither the Google button nor the link. This
     is accepted: the page's locales read and password sign-in already go through `withTransaction`
     there (the S1b plan's decision 3)."
3. `docs/backlog/data-protection.md`:
   - replace the **S1b** point (`:205-229`; `:230` starts the next entry and stays) with a short
     **S1b2** entry: "**S1b2** — the invoice email carries the invoice customers' privacy notice,
     with the privacy email and page from the Privacy card. Planned as Part 2 of the
     [S1b plan](../superpowers/plans/2026-10-27-a980-s1b-privacy-link-readers.md); waits for the
     owner's ruling on whether a change to an invoice email's body lands without them. Until it
     lands, nothing on the box shows the privacy email.";
   - in the S10 follow-ups (`:267-268`), delete "merge `boot.ts`'s two identical `sendAccountEmail`
     wrappers (older than S10)" (Task 1 merged them);
   - in `## Decisions and deliberate limits` (`:273`), an "A980 S1b" entry with Part 1's owner
     decisions A and B and their defaults, one line each, as the S1a2 entry (`:329-342`) has them.
4. `docs/backlog.md:6180-6183`: the list of built slices gains "S1b (the staff emails, the sign-in
   page, Account settings and both downloads read the saved privacy page, and the environment
   setting is gone)", and S1a's clause "which nothing else shows yet" goes.
5. The overview:
   - the S1b row (`:108`) gains "2026-10-27: built ([plan](2026-10-27-a980-s1b-privacy-link-readers.md),
     Part 1); no migration; FULL review (decision 13). The invoice email moved to S1b2.";
   - a new row after it, **S1b2**: "The invoice email carries the invoice customers' privacy notice
     with the saved email and page ([plan](2026-10-27-a980-s1b-privacy-link-readers.md), Part 2) |
     **No.** | set in Part 2 | S1b, and the owner's ruling on landing invoice-email changes | No,
     after S1b";
   - build order step 4 (`:212`) gains ", then **S1b2** once the owner has ruled";
   - the header paragraph (`:3-73`) gains a dated S1b line in the same form as S1a2's.
6. The design: §5.2 item 2's dated line (`:679-680`) gains "; S1b built 2026-10-27, the invoice
   email follows in S1b2". §4.1's invoice customers' text gets no line until S1b2.
7. `git grep -n -i "nothing else on the box shows\|nada más en el equipo los muestra"` over `apps`
   and `docs`: expected, only dated records under `docs/superpowers`. And
   `git grep -n -i "does not show this notice anywhere\|no muestra este aviso en ningún"`: expected,
   `apps/server/src/guide/en/data-protection.md:84` and `es/data-protection.md:90` (still there),
   plus records under `docs/superpowers`. And
   `git diff main...HEAD -- apps/server/README.md apps/server/src/guide docs/backlog.md docs/backlog | /usr/bin/grep -i '^+.*invoice e\?mail'`:
   expected, only the new S1b2 entry's lines in `docs/backlog/data-protection.md` (a plain `git grep` would also print the guide's existing "An invoice emailed to the
   wrong address" paragraph, `en/data-protection.md:505`, which is why this reads the diff).
8. `git grep -n PRIVACY_NOTICE -- . ':!docs/superpowers'`: expected, exactly the new
   `config.test.ts` case, the backlog's A980 S1a entry's A and F (`docs/backlog/data-protection.md`,
   at `:318` and `:327` before this task's edits), and the new A980 S1b entry's B.

## Task 6: LOOK (the driver)

The screens' code does not change, but what they show now comes from the card, so look once.
In this worktree, `wa-wt demo <worktree-name>` (never a bare `pnpm dev*`).

1. Save `https://example.com/privacy` and `privacy@example.com` on the Privacy card.
2. Sign out. Open the sign-in page in the light and dark themes and at phone width (390 px) with the
   workspace's playwright Chromium, and save a screenshot of each; the **Privacy notice** link is
   there and opens the page. Sign in; open **Account settings** the same three ways.
3. Clear the page on the card with **Account settings** open in a second tab; the link goes without
   a reload. Reload the sign-in page; the link is gone.
4. Invite a person; open the captured invitation in the dev box's email inbox and save its text to a
   file outside the worktree. Read it: no privacy line (the page is cleared). Save the page again,
   invite another person: the line and the address are there.
5. Record what was seen, with the screenshot paths, in the pull request.

## Root guards to run before `/finish-branch` (Part 1)

`pnpm exec vitest run scripts/live-subscriptions.test.ts scripts/write-path-tables.test.ts
scripts/errors-reachable.test.ts scripts/personal-log-params.test.ts scripts/english-only.test.ts
scripts/guide-links.test.ts scripts/module-seams.test.ts scripts/workspace-cycles.test.ts
scripts/deploy-image-env.test.ts`, each file's result read from its own lines. Then each task's
focused runs, and, unedited,
`pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`.
CI runs the package suites and coverage (home CLAUDE.md §2); read its `changes` job's `packages`
output for `server` and `dashboard` before calling the branch green.

---

# Part 2 — S1b2, its own pull request

Built on its own branch from `main` after S1b lands. **It does not land without the owner's ruling**
on whether a change to an invoice email's body lands without them (driver ruling 1). Review path:
FULL, set by the driver for S1b2 when it is picked up; this plan recommends FULL, because the words
go to customers with their invoice and the pull request waits for the owner anyway. Before Task 7,
the driver re-finds every `file:line` this part cites on the then-current `main` (S1b moved
`boot.ts` and `invoice-email.ts` is unchanged by it, so expect `boot.ts` lines to have moved), and
runs Part 1's Task 0 step 2 again (expected, nothing).

## Task 7: the invoice email's notice, its words and its text

Files: `apps/server/src/i18n/invoice-email-notice.ts` (new: `en` and `es`),
`apps/server/src/invoice-email.ts` (`InvoiceEmailPrivacy`, the message's optional `privacy`, the
notice in the text at `:55`), `apps/server/src/invoice-email.test.ts`.

Words (each one the guide's sentence, `en/data-protection.md:79-82`, `es/:85-88`, its placeholders
filled):

| Key | English | Spanish |
| --- | --- | --- |
| `purpose` | Data protection. {venue} uses your name, tax number and address to issue this invoice and meet its tax duties. | Protección de datos. {venue} trata su nombre, NIF y dirección para emitir esta factura y cumplir sus obligaciones fiscales. |
| `purposeWithRecord` | Data protection. {venue} uses your name, tax number and address to issue this invoice and meet its tax duties, including sending the Tax Agency a record of it with your name and tax number. | Protección de datos. {venue} trata su nombre, NIF y dirección para emitir esta factura y cumplir sus obligaciones fiscales, incluida la remisión a la Agencia Tributaria de un registro de la factura con su nombre y su NIF. |
| `contact` | Your rights and more information: {contacts} | Derechos y más información: {contacts} |

`{contacts}` is the email, then the page, those that are set, joined by ", ". `{venue}` is replaced
by a function, as `personal-data-readme.ts:21-23` does, so a `$&` in a name prints as typed.

1. Tests first, in `invoice-email.test.ts`, through `createInvoiceEmailSender(rig.config)` and the
   SMTP rig (`:41-125`). **Read the decoded text part, never the raw message**: nodemailer sends the
   body quoted-printable, accents as `=C3=B3` and long lines broken with `=` soft breaks (review
   E2). Add a local `textPart(message)` beside `attachmentText` (`:124-140`): split the message at
   its MIME boundary, take the part whose headers name `text/plain`, then decode it as
   `apps/server/src/attendance-email.test.ts:85-95` does (base64, or quoted-printable with soft
   breaks and `=XX` runs). Cases:
   - one `it.each`, 6 rows (invoice locale × privacy → the two notice lines, or none):
     `es-ES`, both set, `taxRecord: true` → `purposeWithRecord` and the contact line with
     `privacy@example.com, https://example.com/privacy`; `es-ES`, page only, `taxRecord: false` →
     `purpose` and the page alone; `eu-ES`, email only → the Spanish lines, email alone; `ca-ES`,
     both → Spanish; `en-GB`, both, `taxRecord: false` → the English lines; `es-ES`, both `null` →
     the text is the caption alone, as today. The venue in each is the fixture's filed issuer,
     `Charcutería La Buena SL` (`apps/server/src/testing/full-invoice-fixture.ts:15-16`), not its
     current one (`:57-58`).
   - one case: with no `privacy` in the message the text is the caption alone (the harness path).
   - one case: a duplicate (`duplicate: true`) carries the caption with ` — DUPLICADO`, a blank
     line, then the notice (owner decision E).
   - one case for `textPart` itself: a known accented, over-76-character line round-trips, so a
     decoder that leaves `=C3=B3` fails it.
   Expected words are read from the new translation file, never retyped. Run
   `pnpm --filter @waitron/server exec vitest run src/invoice-email.test.ts`; watch the notice cases
   fail.
2. Write the words, the notice and the text. The subject and the attachment do not change.
3. Run the file: its previous count plus 9, nothing failed; the existing cases at `:211-300` pass
   unedited, which is the check that the subject and the PDF did not change.
4. Controls, each run and reverted: take the venue from `document.issuer` (the filed-issuer rows
   fail); print the page before the email (every row with both fails); key the language on the
   receipt labels instead of `en` (the `en-GB` row fails); search the raw message instead of
   `textPart` (the Spanish rows fail, as E2 measured).
5. `pnpm --filter @waitron/server typecheck`; at the root
   `pnpm exec vitest run scripts/english-only.test.ts` (it skips apps; run it for the record).

## Task 8: the worker reads the notice's facts, and the server wires it

Files: `apps/server/src/invoice-email.ts` (`readInvoiceEmailPrivacy`),
`apps/server/src/invoice-email-worker.ts` (`readPrivacy` in `InvoiceEmailPassDeps`, read at
`:93`), `apps/server/src/boot.ts` (the worker's `readDocument`, `:1911` on `4960efd7b`),
`apps/server/src/invoice-email.test.ts`, `apps/server/src/invoice-delivery.test.ts` (one case),
`apps/server/src/boot.invoice-delivery.test.ts` (one case).

1. Tests first.
   - `invoice-email.test.ts`, `readInvoiceEmailPrivacy` against `suite.db` (`seedTenant`, then
     `savePrivacyContact`) with a backend whose `filedReceiptFor` answers a record or `undefined`,
     wrapped as `invoice-customer-data.files.test.ts:66-76` wraps one: 3 rows (stored values with a
     record → both values and `taxRecord: true`; without → `false`; no taxpayer row → both `null`).
   - `invoice-delivery.test.ts`, in "invoice email worker pass" (`:1888`): one queued email, a
     `readPrivacy` that records the transaction it was given and answers fixed values, and a `send`
     that records its message. Assert the message's `privacy` equals the answer, and that
     `readPrivacy` ran after `readDocument`, with the same `tx`.
   - `boot.invoice-delivery.test.ts`, in "invoice email worker at trading boot" (`:443`), beside
     `:444`: before `startServer`, store both values. That fixture's sale is Spanish
     (`locale: "es-ES"`, `invoiceLocales: ["es-ES"]`, `:120-121`; its location `:86`) and its node
     files nothing (`filingModule: "none"`, `:91`), so the decoded text part (Task 7's `textPart`,
     copied) holds the **Spanish** `purpose` line, without the clause, for the fixture's issuer,
     and the Spanish contact line, both read from the translation file; the PDF text assertions of
     `:464-476`, copied, still hold.
   Run `pnpm --filter @waitron/server exec vitest run src/invoice-email.test.ts src/invoice-delivery.test.ts src/boot.invoice-delivery.test.ts -t "privacy|notice"`;
   watch them fail.
2. Write it (decision 8).
3. Run the three files whole: previous counts plus 3, plus 1 and plus 1, nothing failed. Then,
   unedited, `src/alert-sources.invoice-delivery.test.ts` and `src/till-api.deliveries.test.ts`.
4. Controls, each run and reverted: drop `readPrivacy` from `boot.ts` (the boot case fails); read
   it in a second `withTransaction` after the projection (the worker case fails on the `tx`).
5. `pnpm --filter @waitron/server typecheck`; then
   `git diff --stat main...HEAD -- packages apps/server/src/invoice-pdf.ts apps/server/src/receipt-document.ts apps/server/src/invoice-document.ts`
   prints nothing.

## Task 9: S1b2's docs

Files: `apps/server/src/guide/en/data-protection.md`, `apps/server/src/guide/es/data-protection.md`,
`apps/server/README.md`, `docs/backlog/data-protection.md`, `docs/backlog.md`,
`docs/superpowers/plans/2026-10-24-a980-data-protection-build.md`,
`docs/superpowers/specs/2026-10-22-a980-data-protection-design.md` (a dated pointer only).

1. The guide, English and Spanish:
   - `invoice-notice`: replace "Waitron does not show this notice anywhere yet. Show it where staff
     take the customer's details, for example on a sign beside the till." (`en/:84-85`; `es/:90-91`)
     with: "When Waitron emails a full invoice, the email carries this notice, with your venue's
     legal name and the privacy email and page from the **Privacy** card; the part about the Tax
     Agency only for an invoice the box sends a record of, and in Spanish unless the invoice is in
     English. With neither set, the email carries no notice. The email reaches the customer after
     staff have taken the details, so show the notice where they take them too, for example on a
     sign beside the till."
   - `privacy-settings`: "Waitron does not show the privacy email anywhere yet." (Part 1) becomes
     "Waitron shows both in the email that sends a full invoice."
   Sources:

   | Sentence | Source |
   | --- | --- |
   | the invoice email carries the notice, name, email and page | Task 7's rows; Task 8's boot case |
   | the Tax Agency part only with a record | Task 7's `taxRecord` rows; Task 8's reader rows |
   | Spanish unless English | Task 7's `eu-ES`, `ca-ES` and `en-GB` rows |
   | neither set, no notice | Task 7's both-`null` row |
   | both shown in the invoice email | Task 7's both-set rows |

   Then `src/guide-content.test.ts`, `scripts/guide-links.test.ts` and `pnpm format:check`.
2. `apps/server/README.md`: the paragraph Part 1 wrote gains "Its privacy email and page also appear
   in the email that sends a full invoice."
3. `docs/backlog/data-protection.md`: delete the **S1b2** entry; in `## Decisions and deliberate
   limits`, an "A980 S1b2" entry with owner decisions C to F and their defaults, and the owner's
   landing ruling.
4. `docs/backlog.md`: the A980 paragraph's built list gains "S1b2 (the invoice email carries the
   invoice customers' privacy notice)".
5. The overview: the S1b2 row gains "built ([plan](2026-10-27-a980-s1b-privacy-link-readers.md),
   Part 2)", and a dated line in the header.
6. The design, under §4.1's invoice customers' text (after `:342`): "_<date>: S1b2 sends the help
   guide's wording in the invoice email body, the Tax Agency part only for an invoice with a tax
   record, in Spanish unless the invoice is in English
   ([the S1b plan](../plans/2026-10-27-a980-s1b-privacy-link-readers.md), Part 2)._"
7. `git grep -n -i "does not show this notice anywhere\|no muestra este aviso en ningún\|privacy email anywhere yet"`
   over `apps` and `docs`: expected, only dated records under `docs/superpowers`.

## Task 10: LOOK for S1b2 (the driver)

In a worktree on S1b2's branch, `wa-wt demo <worktree-name>`.

1. With both values saved on the Privacy card, email a full invoice; open it in the dev box's email
   inbox and save its text to a file outside the worktree. Read it: the caption, a blank line, the
   two notice lines with the venue's legal name, the email then the page.
2. Clear the email on the card and send another: the contact line holds the page alone. Clear both:
   no notice.
3. Open the attached PDF once and compare it with one from `main` for the same sale: no change.
4. Record what was seen in the pull request.

## Root guards to run before `/finish-branch` (Part 2)

The same list as Part 1, plus the two fiscal suites unedited.

---

## What this changes in the overview

- **S1b is split**: S1b (Part 1) is the staff emails, the sign-in page, Account settings, both
  downloads and the environment setting's removal; **S1b2** (Part 2) is the invoice email's notice,
  waiting for the owner's ruling on landing (driver ruling 1).
- **S1b's review is FULL, not LIGHT** (decision 13).
- **The boot's two account-email wrappers become one** (decision 2), closing one S10 tidy-up point.
- **After S1b alone, nothing shows the privacy email** (decision 5).
- **No migration** in either part.

## Review rulings

Task numbers changed with the split: the old Tasks 5, 6 and 7 are now 4, 5 and 6; the old 4a and 4b
are Part 2's Tasks 7 and 8; Tasks 9 and 10 are new. Every finding of
`a980-s1b-plan-review.md` was taken; none is ruled against. How each was folded:

- **C1** (S1b's docs said the invoice email carries a notice): Part 1's README, guide, backlog,
  overview and design texts name no invoice email; `invoice-notice` keeps its sentence (decision
  12, Task 5 step 1); the S1b point becomes a short S1b2 entry; the overview gains an S1b2 row and
  build-order step; the §4.1 dated line moves to Task 9; Task 5 step 7 expects the invoice sentence
  to stay and greps the README and guide for "invoice email"; the LOOK checks the invitation only.
- **I1** (four sends, three invitees): four invitees, with the cooldown and frozen-clock receipts
  (Task 1 step 1).
- **I2** (quoted-printable body): Part 2's tests read the decoded `text/plain` part through a local
  `textPart`, modelled on `attendance-email.test.ts:85-95`, with its own round-trip case and a
  control (Task 7 steps 1 and 4; Task 8's boot case copies it).
- **I3** (that boot fixture is Spanish): Task 8 expects the Spanish lines, citing
  `boot.invoice-delivery.test.ts:86`, `:91`, `:120-121`.
- **I4** ("prints nothing" greps that could not pass): Task 4 step 5 and Task 5 step 8 now name
  their exact expected hits.
- **I5** (after S1b the email shows nowhere): decision 5, owner decision A and the
  `privacy-settings` sentence say so; Task 9 changes that sentence when S1b2 lands.
- **M1** (Account settings now fails with this read): stated in decision 3.
- **M2** (full-disk sign-in page): a paragraph in conventions-data.md's full-disk section (Task 5
  step 2), and decision 3 names the lost Google button.
- **M3** ("a box cannot hold it"): decision 11 narrowed to "nothing setup writes holds it", citing
  `box-env.ts:7`, `:10-33`.
- **M4** (taxpayer row before trading): cited `venue-plan.ts:155-162` and labelled the rest
  unchecked (decision 3).
- **M5** (line numbers): `receipt-document.ts:134`; `invoice-delivery.test.ts:1888`; the backlog's
  S1b point `:205-229`.
- **M6** (shared database): clear in `onTestFinished` (Task 3 step 1; a global constraint).
- **M7** (the unset case passes before the change): said so, with a control (Task 1 steps 1 and 4).
- **M8** (names): the README names the three staff emails and **Account settings**, as the guide
  does (Task 4 step 3; "Words used here").
- **M9** (staff page placeholder): changed in both languages (decision 12, Task 5 step 1).
- **M10** (stale boot comments): Task 1 rewords or deletes `:2024` and `:2038`.
- **M11** (where Spain-only wording lives): decision 14, with the S3 precedent and the alternative.
- **M12** (a transaction per unauthenticated request): stated in decision 3, with the locales
  route as the precedent.
- **M13** (a failed read stops the invoice email): decision 15 and owner decision F.
- **M14** (decisions entry lists A to E): Part 1's entry holds A and B; S1b2's holds C to F
  (Task 5 step 3, Task 9 step 3).
