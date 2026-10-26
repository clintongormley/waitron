# A980: data protection, build overview

**Status: plan, 2026-10-24. Nothing was built when this was written.** 2026-10-24: S4 is built
([its plan](2026-10-24-a980-s4-deactivation-wipe.md)); `suspendPerson` and `reactivatePerson` were
deleted, so S11 has only the two routes that already exist to set its date. 2026-10-24: S2a1 is
built ([its plan](2026-10-24-a980-s2a1-own-download.md)): the server route for a person's own
download, with no dashboard button yet; it declares `fflate` in `@waitron/server` for the ZIP.
2026-10-25: S2a2 is built ([its plan](2026-10-25-a980-s2a2-own-download-ui.md)): the README inside
the ZIP, the Profile page's button and the Users guide section. The README is in the person's own
language, not the venue's as design §4.2 says (S2a2 decision 1); S2c and S3 choose the language for
a download made for someone else. The README shows the privacy-notice address, so S1b also moves the
README to the stored setting. 2026-10-25: S2b is built
([its plan](2026-10-25-a980-s2b-own-download-workforce.md)): the own download also holds the
employment, rota, absences, attendance and staff-role files and the working-time record, in
the README's language. The module files are JSON, not the design's `rota.csv` and
`absences.csv` (S2b decision 2); the person's own absences, swaps and attendance answers name
who decided them (S2b decision 11), and a swap's shift times wait for the owner (S2b
decision 8). S2b also adds workforce migration 0010: three indexes for the download's
by-person reads, with no table rebuilt. 2026-10-25: S2c is built
([its plan](2026-10-25-a980-s2c-actions-admin-download.md)): the download holds `actions.json`
(counts, and the invoice numbers of the whole sales already recorded whose void the person
authorised, of the refunds they asked for, authorised or recorded the outcome of, and of the
cash-drawer openings they made or authorised), read in short turns of its own after the first
turn, and an admin downloads another person's data under `personal_data.export`, with the README
in that person's language, else the venue's. No product path records a whole-sale void yet, so the
voids list is empty on every box until one does. Line voids, comps and discounts are S2d, next; the
rest of who did what waits (S2c decisions 2 and 3). 2026-10-26: S2d is built
([its plan](2026-10-25-a980-s2d-line-voids.md)): the download holds `adjustments.json` (the voids,
comps and discounts the person made giving a reason, or approved, from the adjustments module's own
part), read in the snapshot turn through two new indexes, adjustments migration 0009
(`0009_personal_data_person_indexes`), with no table rebuilt. Core's
`line_service_cancellations.actor_id` is not read: every value of it is also an adjustment's
requester (S2d decision 3). 2026-10-26: S3 is built
([its plan](2026-10-26-a980-s3-invoice-customer-download.md)): an admin finds an invoice customer
by tax number on **Orders**, ignoring an ES prefix, letter case, spaces, dots and hyphens, and
downloads a ZIP of their full invoices as PDF copies, with an `invoices.json` giving the name, tax
number and address on each, every attempt to email each one (to which address, when, and whether
it went), and whether the box keeps a tax record of it, read in write-lock turns with no index and
no migration. Design:
[A980 data protection, revision 2](../specs/2026-10-22-a980-data-protection-design.md), whose §5.3
lists the slices and §8 records the owner's ten answers. This is an overview: it says what each
slice does, whether it changes the database, how heavily it is reviewed, what it waits for and in
what order to build. Each slice's own task list is written when it is picked up.

**Words used here.** A **migration** is a change to the database's tables, shipped as a numbered
file every box runs at start. **FULL review** is the heavy review path the home rules keep for
risky changes (personal data, sign-in, permissions, migrations, reading a record by its id);
**LIGHT** skips the per-task reviewer. Both end with `/finish-branch`. A **seat** is a slot on a
module's description that the module fills with its own code, so shared code can call every module
without naming any of them.

**Two waiting rules.** Lane B's own runbook (`~/waitron-campaign-b/RUNNER.md`, rule H1) bars it
from starting a slice that adds a migration while one of its parked pull requests is open; that is
lane B's rule, not a house rule, and binds these slices only while lane B builds them. Its parked
pull requests are #2025 and #2030 (both open when checked with `gh pr view` on 2026-10-24, and
neither adds a migration: `gh pr diff <n> --name-only` lists no `drizzle` or migration file). S9 and
S11 also wait for the labour and privacy specialists (A664's gates G2 and G3).

## The slices

S2 is split in five (S2a1, S2a2, S2b, S2c, S2d) and S1 in two (S1a, S1b) so that each fits one implementer
well under about 100 tool calls. Slice numbers are the design's; S5, S7 and S8 were dropped by the
owner's answers.

| Slice | Scope, in one sentence | Migration (what was read) | Review | Waits for | Buildable now? |
| --- | --- | --- | --- | --- | --- |
| **S4** | Deactivating a person, by either route, deletes their PIN, password, two-factor secret and enrolments, Google link, passkeys, recovery codes and pending passkey challenges. | **No.** It deletes rows from existing tables and empties existing columns, with statements that already exist in _reset login_ (`packages/identity/src/staff.ts:334-348`); read `persons.ts:40-43`, `:64`, `webauthn.ts`, `recovery-codes.ts`. | FULL (sign-in) | nothing | **Yes. Build first.** |
| **S2a1** | The server side of a staff member's own download: the export seat on the module description, the identity part (profile, sign-in summary, sessions), the own-download route and the ZIP (adding a library or writing a small writer). | **No.** Reads only. | FULL (personal data) | nothing | Yes |
| **S2a2** | The dashboard side: the Profile page's download button, the README inside the ZIP in English and Spanish, and the guide pages in English and Spanish. | **No.** | FULL (personal data) | S2a1 | Yes, after S2a1 |
| **S2b** | The workforce and staffing parts of the same download: employment and pay rate, rota, availability and swaps, absences, and the existing working-time export. | **No.** Reads only. | FULL (personal data) | S2a1 | Yes, after S2a1 |
| **S2c** | The actions part (counts of voids, refunds, drawer openings, with sale numbers) and an admin's download of another person's data under the new `personal_data.export` permission. | **No.** Permissions are a list in code (`packages/identity/src/permissions.ts:5-37`); the database stores only a person's role (`persons.ts:65`). The roles design (A1002) proposes roles stored with an explicit set of permission ids; if it lands first, adding the permission may need data written as well. | FULL (permission, by-id read) | S2a1 | Yes, after S2a1 |
| **S2d** | Line voids, comps and discounts in the download: the adjustments module's own part (its actor columns) and core's `line_service_cancellations.actor_id`, with README words and a column guard. | Not yet read: S2d's plan reads the tables' indexes. | FULL (personal data) | S2c | Yes, after S2c |
| **S3** | An admin finds an invoice customer by tax number (NIF), ignoring an "ES" prefix, letter case and spaces, and downloads what the box holds about them. | **No.** `sales` has no index on `counterparty_tax_id` (its indexes and unique keys, `packages/db/src/schema/sales.ts:118-153`, cover the invoice number, issue time, filing state, corrected sale and order), and a match that ignores case and spaces could not use a plain column index anyway, so the search reads the sales that name a recipient. Measure it on a large fixture; if it is too slow, an index is its own later slice, and that one is a migration. | FULL (personal data, permission) | S2a1 and S2a2 (ZIP and README), S2c (the permission) | Yes, after S2c |
| **S6** | English and Spanish help-guide pages: the privacy-notice templates, a record of processing, and a breach checklist. | **No.** Markdown under `apps/server/src/guide/en/` and `es/` plus the guide's page list (`apps/server/src/guide-catalogue.ts`). | LIGHT | nothing | Yes |
| **S10** | Find out whether any logged error carries a person's name or email (an email-server refusal; the `person.email_taken` and `person.display_name_taken` parameters, `staff.ts:53-66`), and mask it if so. | **No.** Logs are files, not tables. | FULL (personal data on the recovery page, which needs no sign-in) | nothing | Yes |
| **S1a** | A dashboard setting for the address of the venue's privacy-notice page and its privacy email, stored in the database and saved under `venue.configure`, with its guide text. | **Yes.** Nothing holds a non-secret venue setting of this kind: `tenants` holds country, tax id, legal name and domicile (`packages/db/src/schema/tenants.ts:43-52`); `tenant_receipts` holds the receipt's own text (`packages/db/src/schema/tenant-receipts.ts:18-26`); `tenant_credentials` holds sealed secrets (`packages/credentials/src/schema/tenant-credentials.ts:11-40`); `service_settings` belongs to the venue-service module (`packages/venue-service/src/schema/settings.ts:10-28`). Proposed: two empty-by-default columns on `tenants`, which adds columns without rebuilding the table. A migration-free option exists, two new keys in the receipt's JSON column `tenant_receipts.receipt`, and is rejected: that document is the printed receipt's trim, saved whole by the receipt editor under `layout.configure` (`packages/layouts/src/receipt-store.ts:165-188`) and refusing keys it does not know (`packages/layouts/src/validate.ts:40`), while the venue's identity as controller already lives as columns on `tenants`. | FULL (migration) | lane B's parked pull requests closed, while lane B builds it | **No**, while lane B builds it |
| **S1b** | Every place that shows the link reads the stored setting (invitation and reset emails, login, profile, the personal-data download's README, and now the invoice email), and the `WAITRON_PRIVACY_NOTICE_URL` environment setting goes. | **No.** | LIGHT | S1a | No, after S1a |
| **S9** | On request, erase a booking guest's details as the design's §4.3(c) says. | **No.** Append-only triggers are installed at start from `appendOnly()` declarations, not written in migration SQL. Every S9 table is declared with `classify()` (`packages/bookings/src/classification.ts:10`; `packages/venue-service/src/classification.ts:41-45`), and no trigger SQL in the tree, `packages/db/drizzle` included, names `bookings`, `party_allergy`, `ticket_item_allergies` or `kitchen_notices` (the 46 tracked `.sql` files holding `create trigger` and every non-test source file holding it, searched for those names, 2026-10-24; control: 8 of those `.sql` files name `sales`). The required booking name takes a fixed "(erased)" text. | FULL (personal data, health) | the privacy specialist (G3) | **No** |
| **S11** | Store the date a person is deactivated, and clear a former employee's email a year later, keeping the name. | **Yes.** `persons` has no deactivation date (`packages/identity/src/schema/persons.ts:31-67`). | FULL (migration, personal data) | the labour and privacy specialists (G2, G3), and lane B's parked pull requests closed while lane B builds it | **No** |

## Is S4's defect still there?

Yes. On current `main` both routes set the person to suspended and end their sessions, and neither
deletes a sign-in secret:

- _Deactivate_, `POST /management-api/staff/:id/deactivate` (`apps/server/src/management-api.ts:1189-1198`),
  calls `deactivatePerson` (`packages/identity/src/staff.ts:263-291`), which suspends at `:289` and
  calls `revokePersonAccess` at `:290`. That function (`staff.ts:157-167`) only ends sessions and
  marks open invitation and reset links used.
- The edit route, `PUT /management-api/staff/:id` with `status: "suspended"`
  (`management-api.ts:1137-1174`), calls `updatePersonDetails` (`staff.ts:175-261`), which writes the
  status at `:238-253` and calls `revokePersonAccess` at `:257-258`.

**Experiment, 2026-10-24.** A throwaway Vitest file in `packages/identity` (deleted after the run)
gave three staff members a PIN, password, two-factor secret, Google link, a recovery code, a passkey
and a passkey challenge. After `deactivatePerson` on the first and `updatePersonDetails` with
`status: "suspended"` on the second, every one of those was still present. The control,
`resetPersonLogin` on the third, left none. Two-factor enrolments (`totp_enrollments`) were not
seeded in that run; a reviewer's later run seeded one and it survived. The code agrees: neither route
deletes from that table, which has no key to `persons` (`schema/totp-enrollments.ts:9-12`), while
_reset login_ does (`staff.ts:347`).

Two more paths write `suspended`: `suspendPerson` (`staff.ts:567-577`), which no route calls and the
package index does not export, and a configuration import, which already blanks every secret of an
imported person (`packages/provisioning/src/configuration-transfer.ts:735-743`). S4 deletes
`suspendPerson` or makes it wipe too.

Since A1000 (#1961) both deactivation routes need the admin permission, `person.admin`
(`staff.ts:233-235`, `:287`); S4 changes no permission.

## Notes for each slice

**S4.** Put the wipe in one function that _reset login_, re-inviting (`staff.ts:374-391`) and both
deactivation routes call, so the four lists cannot drift apart. Status stays suspended. Tests: every
secret gone after each route, checked by reading the rows; the person's time entries untouched;
re-inviting still works; sign-in refused. The wipe covers two-factor enrolments
(`totp_enrollments`) as well as the S4 row's list, since they too survive deactivation.
Put the omission control in the brief: remove the wipe from one route and watch its test fail.
`deactivatePerson` returns early for a person already suspended (`staff.ts:288`), so anyone
deactivated before S4 ships is never wiped by it. No clean-up code is needed: no venue is live,
and until one is, the home CLAUDE.md §3 rules out backwards-compatibility and data-migration code.

**S2a1.** The download is gathered through a new seat on the module description, the way
`configurationTransfer` already gathers every module's part of the configuration export
(`packages/composition/src/modules.ts:113`, `:148`), so the shared code never names workforce or
staffing. The own-download route follows `/management-api/me/attendance/export`, which asks for
nothing beyond a signed-in session (`apps/server/src/attendance-export-api.ts:45-55`, `:77-80`). No
package declares a ZIP library (a search of every tracked `package.json`); `fflate` and `archiver`
are installed only as other packages' dependencies (`pnpm-lock.yaml`), so neither may be imported
as it stands. Choose between declaring one and writing a small uncompressed ZIP writer, and say
which in the pull request.

**S2a2.** The Profile button calls S2a1's route. The README's text lives in a file under
`apps/server/src/i18n/`, English and Spanish.

**S2b.** Reuse the existing working-time export rather than a second copy of the record.

**S2c.** Add `personal_data.export` to the permission list beside `person.admin` and to no other
role's set; admins hold every permission (`permissions.ts:76`, `:82`). The roles design (A1002)
names the same permission; if it lands first, follow its list. A manager is refused another
person's download; a staff member gets only their own.

**S3.** The export holds the invoice PDFs through the existing route, the name, NIF and address on
each, the addresses each was emailed to and when, and one line saying each was sent to the Tax
Agency.

**S6.** The pages are text a venue's adviser fills in; none gives a verdict on whether to notify a
breach. Spanish text is allowed here: the guide's `es/` folder is a translation file.

**S10.** Write the failing probe first: make the logger receive each error and check the masked
log line. If nothing leaks, the slice is the probe as a test.

**S1a.** Read `docs/developers/conventions-data.md` before generating the migration. Adding
nullable columns to `tenants` should come out as a plain column addition; if drizzle instead
rebuilds the table, stop and read the rebuild rules in the home CLAUDE.md.

**S1b.** The invoice email is composed in `apps/server/src/invoice-email.ts`. Today the link is
read from the environment (`apps/server/src/config.ts:503-511`, `:548`) and passed in at
`apps/server/src/boot.ts:1925` and `:2069`.

## Build order

1. **S4** now: it closes a live defect and is small.
2. **S2a1**, then **S2a2**, **S2b** and **S2c** (any order), then **S2d** and **S3**, in either order, both after S2c.
3. **S6** and **S10** at any time. S6 adds pages to `GUIDE_PAGES` in
   `apps/server/src/guide-catalogue.ts`, as S1a and S2a2 may; the later of any two rebases onto
   the earlier. S10 may mask the error parameters in `packages/identity/src/staff.ts` (`:53-66`), a
   file S4 also changes.
4. **S1a**, then **S1b**; while lane B builds them, once its parked pull requests are closed.
5. **S9** and **S11** when the specialists have agreed; S11, while lane B builds it, also after
   its parked pull requests.

Same-files check before each: A1002 (custom roles) changes `packages/identity/src/permissions.ts`,
which S2c also changes.
