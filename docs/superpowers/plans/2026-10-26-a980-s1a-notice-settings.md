# A980 slice S1a: a dashboard setting for the venue's privacy notice page and privacy email

**Status: plan, 2026-10-26. Nothing was built when this was written.** Branch
`feat/a980-s1a-notice-settings`, from `main` at `00abe58e3`. Design:
[A980 data protection, revision 2](../specs/2026-10-22-a980-data-protection-design.md) §4 (the row
"Privacy notices": "a setting for the address of the venue's notice page (O3 (a))"), §4.1 (the
second layer "its address set in the dashboard by S1"), §5.2 item 2 (the link cannot be set on a
box today), §5.3 row S1 and §8 answer O3 (a): "only: the venue's own web page, its address in a
dashboard setting". Overview: [the build plan](2026-10-24-a980-data-protection-build.md), rows S1a
and S1b, the "S1a." and "S1b." notes and build order step 4. Backlog:
`docs/backlog/data-protection.md`, the A980 point **S1**.

**One migration, in the core set.** Two nullable text columns on `tenants`. **FULL review**: a
migration is a risk trigger. Per-task reviews run, then `/finish-branch`, which runs two Codex
reviews, the second told to set this plan aside and test what it does not name. **Not fiscal**:
nothing an invoice prints or files changes, no fiscal table is touched, and the golden huella test
(`packages/fiscal-verifactu/src/write-path.e2e.test.ts`) and
`packages/fiscal-verifactu/src/inmutabilidad.test.ts` must pass **unedited**.

**Lane B's waiting rule is met.** Its runbook's rule H1 bars a migration slice while one of its
parked pull requests is open. Both, #2025 and #2030, answered `MERGED` to `gh pr view <n> --json
state` on 2026-10-26 while this plan was written. The one other open pull request, #1986, touches
no migration, `tenants`, settings or live-query file (`gh pr diff 1986 --name-only`, filtered for
`drizzle|tenants|location-settings|venue-|live-queries|write-path`, printed nothing).

## Words used here

- The **taxpayer row** is the one row of `tenants` (id 1). It holds the venue's country, tax
  number, legal name and fiscal address (`packages/db/src/schema/tenants.ts:38-53`). There is no
  tenant column anywhere; the row is the venue's identity as the business that owns the data.
- The **privacy notice web page** is the page on the venue's own web site that holds its full
  privacy notice (design §4.1, "second layer"). The **privacy email** is the address people write
  to about their data. Together this plan calls them the venue's **privacy contact**.
- **Unset** means the column holds SQL `NULL`. The writer never stores an empty string.
- A **reader** is any code that shows the privacy link today: the account emails, the sign-in
  page, the profile page and the personal-data download's README. Today every reader takes it
  from the environment setting `WAITRON_PRIVACY_NOTICE_URL` (`apps/server/src/config.ts:98-99`,
  `:503-511`, `:548`).
- A **live read** is a dashboard read that refreshes by itself when a table it names changes
  (`apps/dashboard/src/api/live-queries.ts`, `QUERY_DEPENDENCIES`).
- The **help badge** is the "?" a field shows while the dashboard's Help switch is on
  (`<wt-help-tooltip mode="help-mode">`, `docs/developers/design-system.md`, "Help mode").

## What this slice builds, and where the S1a/S1b line falls

S1a builds the setting end to end and stops there:

1. **Storage**: `tenants.privacy_notice_url` and `tenants.privacy_email`, both nullable text, added
   by a drizzle-generated core migration.
2. **One rule** for what each field accepts, in `@waitron/shared`, used by the server and by the
   dashboard's own checks.
3. **A reader and a writer** for the two columns, in a new file of `@waitron/provisioning`, the
   package that already holds the only request-path writer of `tenants`.
4. **Two routes**: `GET /management-api/venue-privacy` under `venue.view` and
   `PUT /management-api/venue-privacy` under `venue.configure`.
5. **A Privacy card** on **Venue settings → Venue details**, with a read view, an Edit form, its
   own checks, a draft scope, live updates and a help badge on the web page field linking to the
   guide's `data-protection#staff-notice`.
6. **Guide text**: a new section, `privacy-settings`, on the Data protection guide page, in English
   and Spanish.
7. **Docs**: the conventions note on who may write `tenants`, the backlog, and the overview.

**Nothing reads the stored setting yet (decision 1).** After S1a alone every reader still takes the
link from `WAITRON_PRIVACY_NOTICE_URL`, exactly as on `main` today, so no email, page or download
changes. A venue can save, see and change its privacy contact; the guide says that, for now,
nothing else shows it. Main stays green and working: the setting is a new, self-contained screen
and route, and no existing response or reader changes shape.

**S1b, unchanged in scope, inherits this list** (each read on this tree, 2026-10-26), which
corrects the overview's in three places (see "What this changes in the overview"):

- `apps/server/src/boot.ts:2012`, into `mountManagementApi`, which passes it to the invitation and
  reset emails (`apps/server/src/management-api.ts:194`) and answers it on
  `GET /management-api/google/config` (`management-api.ts:788-790`), a route that needs no sign-in.
  Both the sign-in page (`apps/dashboard/src/screens/login-screen.ts:324-328`) and the profile page
  (`apps/dashboard/src/screens/profile-screen.ts:345-348`) read the link from that one route.
- `boot.ts:2137`, into the S3 invoice-customer download
  (`apps/server/src/invoice-customer-data-api.ts:29`, `:125`).
- `boot.ts:2177`, into `mountMeApi`, which passes it to the own personal-data download
  (`apps/server/src/me-api.ts:130`, then `personal-data-export-api.ts:28`, `:97` and
  `personal-data-readme.ts:15`, `:50`, `:69`, `:100`, the README) and to the email-address check
  email (`me-api.ts:182`).
- `apps/server/src/invoice-email.ts`: it carries **no** privacy text today (a search for
  `privacy` in it finds nothing), so S1b adds the invoice notice there rather than moving a link.
- The dashboard's live read `getGoogleConfig` depends on `google_config` alone
  (`apps/dashboard/src/api/live-queries.ts`), so S1b adds `tenants` to it once the route answers
  the stored setting.
- `apps/server/README.md:487` documents the environment setting; S1b removes it with the setting.
- The guide: S1b rewrites this slice's "nothing else on the box shows them" sentence in both
  languages, and adds the setting's name to `staff-notice` and `full-notice`.

## What was run while writing this plan

Each probe below states what the failing case would have printed.

1. **Drizzle adds the two columns without rebuilding `tenants`.** In this worktree, the two column
   lines of decision 2 were added to `packages/db/src/schema/tenants.ts` and
   `cd packages/db && pnpm exec drizzle-kit generate --name probe_privacy` was run. A rebuild would
   have printed a `CREATE TABLE \`__new_tenants\`` and a `DROP TABLE`. It wrote
   `drizzle/0192_probe_privacy.sql` holding exactly:

   ```sql
   ALTER TABLE `tenants` ADD `privacy_notice_url` text;--> statement-breakpoint
   ALTER TABLE `tenants` ADD `privacy_email` text;
   ```

   The schema file, the SQL file, `meta/0192_snapshot.json` and `meta/_journal.json` were then
   restored and `git status --short` printed nothing. The precedent agrees:
   `packages/db/drizzle/0103_full_invoice_model.sql:20` added `taxpayer_domicile` the same way.
   No foreign key points at `tenants` (`git grep "references(() => tenants"` over
   `packages/*/src/**` and ``git grep "REFERENCES `tenants`"`` over `*.sql` both print nothing), so
   even a rebuild would have deleted no child rows; decision 2 keeps any `CHECK` off these columns
   so no rebuild happens.

2. **No trigger in the tree names `tenants`, and adding a column beside the change feed's
   trigger is accepted.** Of the 46 tracked `.sql` files containing `create trigger`, none
   contains `tenants`; as a control, 8 of them contain `sales`. Of the 3 non-test source files
   containing `create trigger` (`packages/db/src/change-feed.ts`, `packages/db/src/testing/venue-db.ts`,
   `packages/store/src/append-only.ts`), none contains `tenants`: they build trigger text from a
   table name at run time. `tenants` is a change source (`packages/db/src/classification.ts:90`,
   `:271-277`), so the change feed installs `waitron_change_tenants_update`, whose `when` clause
   names every column the table had when it was installed (`change-feed.ts:115-131`). The feed is
   removed before migrating and installed again at start (`change-feed.ts:136-151`). In case a
   trigger is ever left in place, this was run under `node:sqlite` (SQLite 3.54.0, Node v26.11.1):
   a `tenants (id, legal_name)` table with that trigger shape, then
   `alter table tenants add privacy_notice_url text` printed `add column: ok`, while the control,
   `alter table tenants drop column legal_name`, failed with `error in trigger
   waitron_change_tenants_update after drop column: no such column: new.legal_name`. One
   consequence: a trigger installed before the migration does not compare the new columns, so an
   update of only them sends no live event until the next start reinstalls the feed. Starting the
   server always migrates before it installs the feed, so this does not arise on a box.

3. **Only listed files may write `tenants`, and the guard refuses anything else.**
   `scripts/write-path-tables.json` allows `tenants` writes only in
   `packages/provisioning/src/taxpayer-name.ts` and `packages/provisioning/src/venue-apply.ts`. A
   throwaway `apps/server/src/zz-write-probe.ts` holding `tx.update(tenants).set({ legalName: "x" })`
   made `pnpm exec vitest run scripts/write-path-tables.test.ts` print `Tests  1 failed | 22 passed
   (23)` with `apps/server/src/zz-write-probe.ts writes tenants`; with the file deleted the same
   command printed `Tests  23 passed (23)`. The overview did not know this; decision 3 answers it.

4. **What `URL.parse` makes of candidate addresses** (Node v26.11.1). `barejemplo.es/privacidad`,
   `https://` and `https://bar ejemplo.es` give `null`. `javascript:alert(1)` and
   `mailto:a@b.es` parse with those protocols. `ftp://x.es` parses as `ftp:`. `https:barejemplo.es`
   parses to `https://barejemplo.es/`. `https://user:pw@x.es/p` parses with user name `user`.
   `https://barejemplo.es/priv acidad` parses, with the space turned into `%20`.
   `HTTPS://BAREJEMPLO.ES/Privacidad` parses to `https://barejemplo.es/Privacidad`. So the
   environment rule today (`config.ts:503-511`: parses, and the protocol is `http:` or `https:`)
   accepts a user name and password, a space in the path, and `https:` without `//`. Decision 5
   says what this slice accepts instead.

Read, not run: everything else cited by `file:line` below.

## Decisions this plan makes that the design does not

1. **The S1a/S1b line: S1a stores, checks and shows the setting; nothing reads it yet.** The
   environment setting and every reader stay exactly as on `main`. The alternative was to switch the
   readers here, which is S1b's whole scope (the list above) and would double this slice. The
   window is short (S1b is next in lane B's queue) and no venue is live (home CLAUDE.md §3, "No
   backwards-compatibility … until Waitron is in production"). The guide says so in one sentence,
   which S1b rewrites. Owner decision A below.

2. **Two nullable `label` columns on `tenants`: `privacy_notice_url` and `privacy_email`.** The
   overview's home is still right on this tree: `tenants` holds the venue's identity as controller
   (`tenants.ts:38-53`), and nothing else holds a non-secret venue-wide setting of this kind (the
   overview's S1a row lists and rejects the alternatives; rechecked: `tenant_receipts` still
   refuses keys it does not know, `packages/layouts/src/validate.ts:40`). `tenants` is classified
   `state` (`classification.ts:90`), is not append-only, and has no trigger naming it (probe 2).
   - Declared with `label(...)` from `packages/db/src/schema/columns.ts` (the column vocabulary
     guard, `scripts/column-vocabulary.test.ts`), with no `.notNull()`, no default and **no
     `CHECK`**: adding a `CHECK` to an existing table makes drizzle-kit rebuild it, and the home
     CLAUDE.md forbids a rebuild and a column addition in one generation. The rule lives in the
     writer (decisions 4 to 6).
   - One comment at the columns, because it is an invariant the code cannot show: `NULL` is unset,
     and the writer never stores an empty string. No other comment.
   - Both columns are the venue's, not a person's. A sole trader may use their own email as the
     privacy email, so the value is never logged and never put in an error's params (decision 11).
   - The core migration set gains columns, not a table, so the "stated reason" rule for a new core
     table does not bind; the commit says why anyway: `tenants` is core's taxpayer row.
   - The migration number is assigned by drizzle-kit when Task 2 runs (0192 on `00abe58e3`). On a
     rebase collision, regenerate, never hand-edit (home CLAUDE.md §3; lane B rule H13).

3. **The reader and writer live in a new `packages/provisioning/src/privacy-contact.ts`, added to
   `scripts/write-path-tables.json`.** Probe 3 shows a `tenants` write anywhere else fails the
   guard. The alternative, a second function in `taxpayer-name.ts`, would need no list change but
   would make that file's one stated job ("changes the taxpayer's legal name",
   `scripts/write-path-tables.test.ts:47-48`) untrue. The new file writes the two privacy columns
   alone, `where id = 1`, and throws no code of its own, as `renameTaxpayer` does
   (`taxpayer-name.ts:4-19`). Task 3 updates the guard's header list and
   `docs/developers/conventions-data.md:897-902`, which names every legitimate `tenants` writer.
   `docs/developers/grants-retirement-audit.md:60` is a dated record of 2026-10-19 and is left as
   it is.

4. **One rule, in `@waitron/shared`, for both the server and the dashboard**:
   `packages/shared/src/privacy-contact.ts`, beside `isValidEmail` (`packages/shared/src/email.ts`),
   which the dashboard and the server already share (`apps/dashboard/src/widgets/invoice-email-dialog.ts:13`,
   `apps/server/src/orders-api.ts:5`). `@waitron/shared` is mutation-tested on a pull request whose
   scope contains it (`docs/developers/ci-and-gates.md:414`, break 90,
   `packages/shared/stryker.config.json`), so Task 1 writes its tests to kill every mutant and
   writes no check that another check already implies (decision 5 says which). Interface:

   ```ts
   export const PRIVACY_CONTACT_FIELDS = ["privacyNoticeUrl", "privacyEmail"] as const;
   export type PrivacyContactField = (typeof PRIVACY_CONTACT_FIELDS)[number];
   export type PrivacyContactProblem = "web_address" | "email" | "length";
   export const PRIVACY_CONTACT_MAX_LENGTH: Readonly<Record<PrivacyContactField, number>>;
   /** NFC, trimmed; an empty result is null (unset). */
   export function privacyContactValue(raw: string): string | null;
   /** What is wrong with a value `privacyContactValue` returned, or undefined. Null is fine. */
   export function privacyContactProblem(
     field: PrivacyContactField,
     value: string | null,
   ): PrivacyContactProblem | undefined;
   ```

5. **What the web page field accepts.** After `privacyContactValue`, a value is refused as
   `length` when it has more than **500** code points (counted as `[...value].length`, as
   `apps/server/src/venue-details.ts:193` counts), and otherwise as `web_address` when any of these
   holds: it contains whitespace (`/\s/`); it does not start with `http://` or `https://` in any
   letter case (`/^https?:\/\//i`); `URL.parse(value)` is `null`; or the parsed address has a user
   name or a password. The prefix makes a protocol check redundant and `URL.parse` refuses an
   empty host for these two protocols (probe 4, `https://` → `null`), so neither is written. The
   value is **stored as typed** (trimmed), not as `URL.parse`'s rewrite, which would add a slash
   and change letter case. Against today's environment rule (probe 4) this refuses three things it
   accepts: a user name or password, whitespace, and `https:` without `//`. Owner decision F.
   Worked example: `https://barejemplo.es/privacidad` and `http://barejemplo.es` are saved as
   typed; `barejemplo.es/privacidad` is refused with "Enter the page's full web address, such as
   https://example.com/privacy."

6. **What the email field accepts.** Refused as `length` above **254** code points, otherwise as
   `email` when `isValidEmail` refuses it. Stored trimmed and as typed: not lower-cased, because
   it is shown to people, never compared.

7. **The routes.** In `apps/server/src/venue-privacy.ts` (new) and mounted by
   `mountLocationSettingsApi` (`apps/server/src/location-settings-api.ts:144`), whose error
   boundary already maps every code below (`:29-49`), so `boot.ts` does not change.
   - `GET /management-api/venue-privacy`, under `venue.view` (supervisor and up,
     `packages/identity/src/permissions.ts:48-57`), answers
     `{ "privacyNoticeUrl": string | null, "privacyEmail": string | null }`.
   - `PUT /management-api/venue-privacy`, under `venue.configure` (manager and admin,
     `permissions.ts:58-77`, `:84`), takes an object holding one or both keys, each a **string**;
     an empty or blank string clears the field. It writes only the keys sent and answers the stored
     pair, as `PUT /management-api/venue-defaults` does (`location-settings-api.ts:305-324`). **Last
     save wins**: there is no `expected` check (owner decision E).
   - Authorisation runs first, then the body is checked (the `gated` helper, `:155-166`).
   - Refusals reuse `venue.detail_invalid { field, reason }` (`apps/server/src/errors.ts:60`), 400:
     a body that is not an object → `{ field: "body", reason: "type" }`; an empty object, and so a
     malformed or empty body, which `readJsonBody` reads as `{}`
     (`packages/server-kit/src/read-json-body.ts:9-15`) → `{ field: "body", reason: "required" }`; any other key → `{ field: "body", reason:
     "unknown_field" }`; a value that is not a string → `{ field, reason: "type" }`; a value the
     rule refuses → `{ field, reason }` with decision 5's or 6's reason. Fields are checked in
     `PRIVACY_CONTACT_FIELDS` order and all are checked before anything is written, so a refusal
     writes nothing. **No refusal carries the value.**
   - With no taxpayer row both routes answer `management.request_invalid { field: "locationId" }`,
     400, the answer `readVenueDetails` already gives for that state (`venue-details.ts:91-92`).

8. **The dashboard: a Privacy card of its own, last on the Venue details tab.** A new panel,
   `dashboard-venue-privacy-panel` (`apps/dashboard/src/screens/venue-privacy-panel.ts`), listed in
   `CORE_SETTINGS_PANELS` after `defaults` (`apps/dashboard/src/dashboard-app.ts:314-335`), with
   `requiresPermission: "venue.view"` and `readOnly` unless the session holds `venue.configure`, as
   its two siblings are. It is modelled on `venue-defaults-panel.ts` (a `settingsCard`, Edit in the
   card header, `draftScopeFor`, `saveActionState`, `QueryController` with `dashboardQuery`, the
   `#adopt` rule for a live read during an edit, `venue-settings-hidden`). The alternative, rows on
   the Business card edited through a dialog like the legal name, was set aside: the legal name's
   dialog exists for fiscal checks this setting does not have, and a card of its own keeps the
   pinned Business card unchanged.
   - **Read view**: two rows, **Privacy notice web page** and **Privacy email**, each the stored
     text or "Not set" (`venue_details.unset`). Plain text, not a link.
   - **Edit form**: two `wt-input`s, `name="privacyNoticeUrl"` `type="url"` and
     `name="privacyEmail"` `type="email"` `autocomplete="off"` (it is the venue's address, not the
     person's own), each with its hint as its `placeholder`, neither `required`. Save follows the
     Forms contract (`docs/developers/design-system.md`, "Forms"): quiet and disabled until the
     draft changes, compared after `privacyContactValue`, so adding spaces alone changes nothing;
     no message before the first Save; then each invalid field gets its sentence, the bottom of the
     form says "Correct the highlighted fields to continue." (`form.fix_fields`), focus moves to the
     first invalid field, and Save stays disabled until the form's own checks pass. A server
     refusal whose `field` is one of the two puts its sentence under that field; any other refusal
     goes in the bottom message; neither disables Save. Save sends only the changed fields, as the
     draft holds them.
   - **The help badge**: a `<wt-help-tooltip mode="help-mode" slot="help">` inside the web page
     field (the `help` slot, `packages/ui-core/src/components/wt-input.ts:130`), with
     `guide-href=${guideHref("data-protection.staff-notice")}` and its own `guide-label`, as the
     profile page's badge does (`apps/dashboard/src/screens/profile-screen.ts:899-907`). It is in
     the Edit form only, because only a primitive's slot positions a badge. It links to
     `staff-notice`, as the backlog and the overview's S1a note ask: that section is the short
     notice that uses both values and points to the full one.
   - **Live**: `getVenuePrivacy: ["tenants"]` in `QUERY_DEPENDENCIES`. A save from another browser
     shows in the read view at once; during an edit, an untouched draft follows it and a changed
     one keeps what was typed (the `#adopt` rule, `venue-defaults-panel.ts:184-212`). A save also
     refreshes the other reads that name `tenants` (`getVenueDetails`, `getLocales`), which is
     harmless.

9. **The guide: a new section `privacy-settings` on the Data protection page**, after
   `full-notice`, in `apps/server/src/guide/en/data-protection.md` and its Spanish twin. No guide
   page covers Venue settings as a whole (`ls apps/server/src/guide/en/`), and this page is where
   the notices it serves are. Its sentences are true of S1a alone, including "nothing else on the
   box shows them" (Task 8 gives the text). `apps/server/src/guide-content.test.ts:200-214` pins the
   page's section ids, so that assertion changes on purpose.

10. **The configuration export does not carry the two values.** The export names the taxpayer's
    fields one by one (`packages/provisioning/src/configuration-transfer.ts:74-118`, bundle
    `version: 8`, the import's check at `:508-537`), not through the module transfer seat, so the
    new columns are not exported unless S1a adds them to the bundle, its check, the setup paths that
    apply it (`apps/server/src/setup-api.ts:476-479`, `packages/provisioning/src/venue-apply.ts`)
    and their tests. That is a slice of its own. Owner decision B.

11. **No log line, and no value in an error.** The routes log nothing of their own; refusals carry
    only `field` and `reason`, whose names are not on `PERSONAL_LOG_KEYS`
    (`apps/server/src/log-personal-data.ts:33-46`) and match none of the root guard's person words
    (`scripts/personal-log-params.test.ts:170-171`).

12. **No till change.** The till never reads the privacy contact, so no `setupRevision` entry and
    no till test changes.

## Open decisions for the owner (FYI, built with the default)

- **A. Nothing reads the setting until S1b** (decision 1). Worked example: on a box with this slice
  alone, a manager saves `https://barejemplo.es/privacidad` in the Privacy card. The card shows it,
  but an invitation sent that afternoon carries no privacy link, because the box has no
  `WAITRON_PRIVACY_NOTICE_URL` (design §5.2 item 2). Once S1b lands, the same invitation carries the
  saved address. Alternative: build S1a and S1b as one pull request.
- **B. A configuration export leaves the privacy contact behind** (decision 10). Worked example:
  Bar Ejemplo exports its configuration and sets up a new box from it; the new box's Privacy card
  says "Not set" for both, and a manager types them again. Alternative: carry them in the bundle,
  a later slice.
- **C. A supervisor can see the values** (decision 7, `venue.view`). Worked example: Lucía, a
  supervisor, opens Venue settings and reads the address and email, with no Edit button.
  Alternative: show the card only to `venue.configure`.
- **D. The card sits last on the Venue details tab** (decision 8): Business, Venue, Business day,
  Defaults, Privacy. Alternative: put it straight after Business, the venue's identity.
- **E. Last save wins** (decision 7). Worked example: two managers open Edit at the same time; Ana
  saves `privacidad@barejemplo.es`, then Jordi, whose form still shows the old value, saves a new
  web page address. Jordi's request sends only the web page, so Ana's email stays. Had Jordi also
  changed the email, his would replace hers without a warning. The Defaults card works the same way.
- **F. Stricter than the environment setting** (decision 5). Worked example:
  `https://admin:secreto@barejemplo.es/privacidad` is accepted in `WAITRON_PRIVACY_NOTICE_URL` today
  and would be refused here, so a password typed by mistake never reaches the staff emails S1b sends.
  `http://` addresses stay accepted, as today; the alternative is to require `https://`.

## Global constraints

- **English only** in code, identifiers, comments, fixtures and tests. Spanish only in
  `apps/dashboard/src/i18n/strings.ts`'s Spanish half and `apps/server/src/guide/es/data-protection.md`.
  A test of Spanish text reads its expected words from `strings.ts`. Fixture addresses are
  `https://example.com/privacy` and `privacy@example.com`; the guide's Spanish examples use
  `ejemplo.es`.
- **Every database test uses `useVenueDb`.** Every refused request asserts the domain error code,
  its exact params and the status. Exact shapes use `toEqual` or `toBe`, never `toMatchObject`.
- **Fixtures use values the two sides could treat differently**: a value with surrounding spaces
  (so a writer that forgets to trim fails); an email with a decomposed accent,
  `josé@example.com` (so a writer that skips NFC fails); a web page address in capitals (so a
  case-sensitive prefix fails); limits tested at exactly the limit and one over, once with an
  astral character (`😀`, two UTF-16 units, one code point), so counting `.length` fails.
- **Nothing else in the taxpayer row changes**: every write test compares the whole row with
  `{ ...before, <the changed columns> }`.
- **Existing assertions that change on purpose**, each named in the pull request:
  `apps/dashboard/src/dashboard-app.settings-panels.test.ts:275-295` (the card headings gain
  Privacy last), `apps/dashboard/src/dashboard-app.panel-only.test.ts:131-136` (the panels gain
  `dashboard-venue-privacy-panel` before the module's `p`), `apps/dashboard/src/dashboard-app.test.ts:1814`
  (the panels handed the app's `api` gain the new one) and `:4832-4836` (the tab holds three
  panels, not two), and `apps/server/src/guide-content.test.ts:204-214` (the Data protection page's
  ids gain `privacy-settings` after `full-notice`). Lists that only grow by one entry:
  `packages/shared/src/index.test.ts` (its import list), `apps/dashboard/src/api/live-queries.test.ts:190-210`
  (the dependency table) and `scripts/write-path-tables.json`. No other existing assertion is
  expected to change; if one does, stop and say why in the handover.
- **Coverage**: `@waitron/shared`, `@waitron/provisioning`, `@waitron/server`, `@waitron/db` and
  `@waitron/dashboard` hold 98/98/98/95. No exclude or ignore comment. Mutation: `@waitron/shared`
  only, among the packages this slice touches with code.
- **Greps** use the pathspec `'packages/*/src/**' 'apps/*/src/**'` (add `'scripts/**'` where
  guards matter), and the shell's `grep` is ugrep: call `/usr/bin/grep` where an exit status
  decides anything.
- Commits `git commit -s`; `pnpm format:check` before each commit.
- An implementer that passes about 150 tool calls with its task unfinished stops at a passing or
  cleanly failing point, commits, and hands over: what is done, what is left, the files, each
  check's state.
- Browser suites: check `memory_pressure | grep free` first; run beside another session only well
  above 15% free.

## Review focus

- **The migration** (decision 2): exactly two `ALTER TABLE … ADD` lines, no rebuild, no `CHECK`,
  generated, not hand-written; the migration guards of Task 2 run and pass; the number is
  drizzle-kit's.
- **Who writes `tenants`** (decision 3): only `privacy-contact.ts`, only the two columns, `where id = 1`;
  the JSON list, the guard's header and `conventions-data.md` agree; Task 3's proof by deletion.
- **The rule** (decisions 4 to 6): one function on both sides; the limits at the boundary; every
  refusal case of Task 1; the value stored as typed; Stryker leaves no mutant alive.
- **The routes** (decision 7): authorisation before the body; `venue.configure` for the write and
  `venue.view` for the read; nothing written on any refusal, including a valid first field beside an
  invalid second; empty clears to `NULL`, never `""`; no value in a refusal.
- **The card** (decision 8): the Forms contract case by case (quiet Save, no message before the
  first Save, messages under fields, the bottom sentence, focus, Save disabled only by the form's
  own checks); the draft scope and its `*.unsaved.test.ts`; the live read and `#adopt`; the help
  badge's `mode="help-mode"` and its link; read-only for a supervisor.
- **Every guide sentence against the code** (Task 8's table), in both languages, and especially the
  sentence that nothing else shows the values (decision 1).
- **What S1a leaves for S1b**: no reader changed, the environment setting untouched, S1b's list in
  this plan correct.
- **Codex run-it seat**: two reviews, the second told to set this plan aside.

## Task 0: re-check before dispatching (the driver, not an implementer)

Run on the branch's then-current tip and compare with what this plan says. If any differs, fix
the plan before Task 1.

1. `gh pr list --state open --json number,headRefName` and, for each lane B pull request in it,
   `gh pr diff <n> --name-only | /usr/bin/grep -c drizzle`: expected, no open lane B pull request
   adds a migration (rule H1).
2. `ls packages/db/drizzle/*.sql | tail -1`: note the number; Task 2's file takes the next one.
3. `cat scripts/write-path-tables.json`: expected, `tenants` lists `taxpayer-name.ts` and
   `venue-apply.ts` only.
4. `git grep -n "privacyNotice\|PRIVACY_NOTICE" -- . ':!docs' | /usr/bin/grep -v "\.test\.ts"`:
   expected, the readers this plan lists for S1b and no others.
5. `git grep -n "CORE_SETTINGS_PANELS" -- apps/dashboard/src/dashboard-app.ts` and read the list:
   expected, `venue-details` then `defaults`.

## Task 1: the rule, in `@waitron/shared`

Files: `packages/shared/src/privacy-contact.ts` (new), `packages/shared/src/privacy-contact.test.ts`
(new), `packages/shared/src/index.ts` (export the four names), `packages/shared/src/index.test.ts`
(import them in its existing list).

1. Tests first, two `it.each` tables, which Task 6a copies into the panel's own-check test (a test
   file cannot import another package's test file):
   - **`privacyContactValue`** (raw → value): `"  https://example.com/privacy  "` →
     `"https://example.com/privacy"`; `""` → `null`; `"   "` → `null`; `" "` → `null`;
     `"josé@example.com"` → `"josé@example.com"`.
   - **`privacyContactProblem`** (field, value → problem). Web page, accepted (`undefined`):
     `"https://example.com/privacy"`, `"http://example.com"`, `"HTTPS://EXAMPLE.COM/Privacy"`,
     `"https://example.com/" + "a".repeat(480)` (500 code points),
     `"https://example.com/" + "😀".repeat(480)` (500 code points, 980 UTF-16 units), `null`.
     Web page, `web_address`: `"example.com/privacy"`, `"https:example.com"`, `"ftp://example.com"`,
     `"javascript:alert(1)"`, `"mailto:privacy@example.com"`, `"https://"`,
     `"https://user:pw@example.com/p"`, `"https://user@example.com/p"`,
     `"https://:pw@example.com/p"`, `"https://example.com/priv acy"`, `"https://example.com/a b"`,
     `"https://example.com/a\tb"`. Web page, `length`: `"https://example.com/" + "a".repeat(481)`,
     `"https://example.com/" + "😀".repeat(481)`. Email, accepted: `"privacy@example.com"`,
     `"a@" + "b".repeat(249) + ".es"` (254), `null`. Email, `email`: `"privacy"`,
     `"privacy@example"`, `"a@b@example.com"`, `"pri vacy@example.com"`. Email, `length`:
     `"a@" + "b".repeat(250) + ".es"` (255).
   - One case: `PRIVACY_CONTACT_MAX_LENGTH` is exactly `{ privacyNoticeUrl: 500, privacyEmail: 254 }`
     and `PRIVACY_CONTACT_FIELDS` exactly `["privacyNoticeUrl", "privacyEmail"]`.
   Run `pnpm --filter @waitron/shared exec vitest run src/privacy-contact.test.ts`; watch it fail
   (no module).
2. Write the module (decisions 4 to 6): length first, then shape; no protocol or host check
   (decision 5 says why). Run again: expected `Tests  34 passed (34)`.
3. Omission controls, each run and reverted, the failing rows recorded for the pull request:
   count `.length` instead of code points (fails the two `😀` rows); `>=` for `>` (fails the 500 and
   254 rows); drop the whitespace test (fails the three whitespace rows); drop the password check
   (fails `https://:pw@…`); make the prefix case-sensitive (fails the capitals row); skip NFC (fails
   the accent row).
4. Mutation, this file only:
   `pnpm --filter @waitron/shared exec stryker run --mutate src/privacy-contact.ts`. Expected: no
   surviving mutant. A survivor is answered with a test, or by deleting the code it shows to be
   redundant; never by an ignore comment.
5. `pnpm --filter @waitron/shared typecheck`, and `pnpm --filter @waitron/shared exec vitest run
   src/index.test.ts`.

## Task 2: the columns and the migration

Files: `packages/db/src/schema/tenants.ts`, the generated `packages/db/drizzle/<NNNN>_privacy_contact.sql`,
`packages/db/drizzle/meta/<NNNN>_snapshot.json`, `packages/db/drizzle/meta/_journal.json`.

1. Read `docs/developers/conventions-data.md` (the migration rules) first.
2. Add, after `taxpayerDomicile` (`tenants.ts:46`):

   ```ts
   // NULL is unset: the writer (`@waitron/provisioning`'s privacy-contact.ts) never stores "".
   privacyNoticeUrl: label("privacy_notice_url"),
   privacyEmail: label("privacy_email"),
   ```

3. `cd packages/db && pnpm exec drizzle-kit generate --name privacy_contact`. Expected: one new SQL
   file holding exactly the two lines probe 1 printed, one snapshot, one journal entry. If the SQL
   holds anything else, above all `__new_tenants`, stop: that is a rebuild (decision 2).
4. Run the migration guards, each status read separately:
   `pnpm exec vitest run scripts/migrations-match-schema.test.ts scripts/schema-constraints.test.ts
   scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts
   scripts/journal-monotonic.test.ts scripts/migration-upgrade.test.ts scripts/column-vocabulary.test.ts
   scripts/no-tenant-column.test.ts scripts/id-columns-are-references.test.ts`, then
   `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts`. Expected:
   every file passes, with a `Tests` count printed for each run.
5. `pnpm --filter @waitron/db typecheck` and `pnpm --filter @waitron/db exec vitest run src/schema`.
6. Commit: the message says the migration adds two nullable columns to the core set's `tenants`
   because that row is the venue's identity as the business that owns the data (decision 2).

## Task 3: the reader and the writer, and who may write `tenants`

Files: `packages/provisioning/src/privacy-contact.ts` (new), `packages/provisioning/src/privacy-contact.db.test.ts`
(new, modelled on `taxpayer-name.db.test.ts`), `packages/provisioning/src/index.ts` (export),
`scripts/write-path-tables.json`, `scripts/write-path-tables.test.ts` (its header list only),
`docs/developers/conventions-data.md` (`:897-902`).

Interface:

```ts
export interface PrivacyContact { privacyNoticeUrl: string | null; privacyEmail: string | null }
/** The taxpayer row's privacy contact, or null when there is no taxpayer row. */
export async function readPrivacyContact(tx: Transaction): Promise<PrivacyContact | null>;
/** Writes the given columns alone, on the taxpayer row; returns the stored pair, or null when there
 * is no taxpayer row. Takes checked values: it throws no code of its own. */
export async function savePrivacyContact(
  tx: Transaction,
  changes: Partial<PrivacyContact>,
): Promise<PrivacyContact | null>;
```

1. Tests first (`useVenueDb`, inserting the taxpayer row as `taxpayer-name.db.test.ts:18-26` does):
   a fresh row reads both `null`; saving both stores them and the whole row equals
   `{ ...before, privacyNoticeUrl, privacyEmail }`; saving one leaves the other; saving `null`
   stores SQL `NULL` (read back with `select privacy_email is null as unset from tenants`); with no
   taxpayer row, read and save answer `null` and `select count(*) from tenants` stays 0. Run
   `pnpm --filter @waitron/provisioning exec vitest run src/privacy-contact.db.test.ts`; watch it
   fail; write the file; expected `Tests  5 passed (5)`.
2. Add `"packages/provisioning/src/privacy-contact.ts"` to `tenants` in
   `scripts/write-path-tables.json`, and a line to the guard's header list
   (`write-path-tables.test.ts:40-62`): "changes the taxpayer's privacy notice web page and privacy
   email, from the dashboard's venue-privacy route."
3. Proof by deletion: remove the JSON entry and run `pnpm exec vitest run scripts/write-path-tables.test.ts`;
   expected one failure naming `packages/provisioning/src/privacy-contact.ts writes tenants`. Put it
   back; expected all pass.
4. In `conventions-data.md:897-902`, name the new writer beside the legal-name change: "and the
   dashboard's privacy contact (`PUT /management-api/venue-privacy`, A980 S1a) reaches it through
   `packages/provisioning/src/privacy-contact.ts`, which updates `privacy_notice_url` and
   `privacy_email` alone."
5. `pnpm --filter @waitron/provisioning typecheck`.

## Task 4: the two routes

Files: `apps/server/src/venue-privacy.ts` (new: the request check), `apps/server/src/location-settings-api.ts`
(mount the two routes inside `mountLocationSettingsApi`), `apps/server/src/venue-privacy-api.test.ts`
(new, modelled on `apps/server/src/venue-legal-name-api.test.ts`: `setupVenue`, `managerCookie`,
`staffCookie`, and the supervisor made by `update persons set role = 'supervisor' where role = 'manager'`).

Interface:

```ts
/** Decision 7's body check: the changed fields, each through `privacyContactValue` and
 * `privacyContactProblem`; throws `venue.detail_invalid`. */
export function privacyContactRequest(body: unknown): Partial<PrivacyContact>;
```

`venue-privacy.ts` imports `./errors.js`, as every throwing file does (`apps/server/src/errors.ts:20-21`).

1. Tests first, 20 cases:
   - GET on a fresh venue answers 200 `{ privacyNoticeUrl: null, privacyEmail: null }`.
   - PUT both, with surrounding spaces: 200 with the trimmed pair; the next GET answers the same;
     the whole taxpayer row equals `{ ...before, privacyNoticeUrl, privacyEmail }`.
   - PUT the email alone leaves the stored web page.
   - PUT `""` for one field and `"   "` for the other: both stored as SQL `NULL`, not `""`.
   - PUT `josé@example.com`: stored `josé@example.com`.
   - Twelve refusals, one `it.each`, each asserting 400, the exact body
     `{ error: { code: "venue.detail_invalid", params } }`, and the row unchanged: an array body
     (`{ field: "body", reason: "type" }`); the string `"x"` (same); `{}`
     (`{ field: "body", reason: "required" }`); `{ legalName: "X" }`
     (`{ field: "body", reason: "unknown_field" }`); `{ privacyNoticeUrl: null }`
     (`{ field: "privacyNoticeUrl", reason: "type" }`); `{ privacyEmail: 5 }`
     (`{ field: "privacyEmail", reason: "type" }`); `example.com/privacy` (`web_address`); a
     501-code-point address (`length`); `privacy@example` (`email`); a 255-code-point email
     (`length`); a valid web page with `privacy` as the email (`email`, and the web page **not**
     written); `nope` in both (`{ field: "privacyNoticeUrl", reason: "web_address" }`).
   - Permissions, two cases: with no session both routes answer 401 `management_session.required`; staff
     get 403 `authorization.not_permitted` with `{ permission: "venue.view" }` on GET and
     `{ permission: "venue.configure" }` on PUT; a supervisor gets 200 on GET and that PUT refusal;
     nothing written.
   - With the taxpayer row deleted, GET and PUT answer 400 `management.request_invalid`
     `{ field: "locationId" }`.
   Run `pnpm --filter @waitron/server exec vitest run src/venue-privacy-api.test.ts`; watch it fail.
2. Write the check and mount the routes: GET through `gated(…, "venue.view")` and
   `readPrivacyContact`; PUT through `gated(…)` (which defaults to `venue.configure`), then
   `privacyContactRequest`, then `savePrivacyContact`. Expected `Tests  20 passed (20)`.
3. Omission controls, each run and reverted: skip the trim (the spaces case fails); store `""`
   instead of `null` (the clearing case fails); give PUT `venue.view` (the supervisor case fails);
   check each field just before writing it (the valid-web-page-and-bad-email case fails).
4. `pnpm --filter @waitron/server typecheck`; `pnpm --filter @waitron/server exec vitest run
   src/venue-legal-name-api.test.ts` (the sibling routes on the same mount, unedited, pass).

## Task 5: the dashboard's client and live read

Files: `apps/dashboard/src/api/client.ts` (a `VenuePrivacy` interface beside `VenueDefaults`,
`:617`, and two methods beside `getVenueDefaults`, `:3275-3283`),
`apps/dashboard/src/api/live-queries.ts` (`getVenuePrivacy: ["tenants"]` after `getVenueDefaults`,
`:513`), `apps/dashboard/src/api/client-routes.test.ts`, `apps/dashboard/src/api/live-queries.test.ts`.

```ts
export interface VenuePrivacy { privacyNoticeUrl: string | null; privacyEmail: string | null }
getVenuePrivacy(): Promise<VenuePrivacy>;
putVenuePrivacy(changes: Partial<Record<keyof VenuePrivacy, string>>): Promise<VenuePrivacy>;
```

1. Tests first: in `client-routes.test.ts`, beside the venue-defaults case (`:465-482`), one case
   that reads, then saves `{ privacyEmail: "privacy@example.com" }`, and expects the calls
   `["/management-api/venue-privacy", "GET", undefined]` and
   `["/management-api/venue-privacy", "PUT", { privacyEmail: "privacy@example.com" }]`. In
   `live-queries.test.ts`, the row `["getVenuePrivacy", [], "tenants"]` in the table at `:190-210`,
   and a case beside `:772-778`: "subscribes the venue's privacy contact to the taxpayer row
   alone", expecting `[{ type: "tenants" }]`. Watch them fail.
2. Add the interface, the two methods and the dependency.
3. Run `pnpm --filter @waitron/dashboard exec vitest run src/api/client-routes.test.ts
   src/api/live-queries.test.ts` and, at the root, `pnpm exec vitest run scripts/live-subscriptions.test.ts`.

## Task 6a: the Privacy card

Files: `apps/dashboard/src/screens/venue-privacy-panel.ts` (new),
`apps/dashboard/src/screens/venue-privacy-panel.test.ts` (new), `apps/dashboard/src/i18n/strings.ts`
(English and Spanish), `apps/dashboard/src/help-guide.ts` (one `GUIDE_LINKS` entry).

Words (English / Spanish), new keys:

| Key | English | Spanish |
| --- | --- | --- |
| `venue_settings.card.privacy` | Privacy | Privacidad |
| `venue_privacy.notice_url` | Privacy notice web page | Página web del aviso de privacidad |
| `venue_privacy.notice_url_placeholder` | https://example.com/privacy | https://ejemplo.es/privacidad |
| `venue_privacy.email` | Privacy email | Correo de privacidad |
| `venue_privacy.email_placeholder` | privacy@example.com | privacidad@ejemplo.es |
| `venue_privacy.web_address_invalid` | Enter the page's full web address, such as https://example.com/privacy. | Introduce la dirección web completa de la página, como https://ejemplo.es/privacidad. |
| `venue_privacy.email_invalid` | Enter an email address such as privacy@example.com. | Introduce un correo electrónico como privacidad@ejemplo.es. |
| `venue_privacy.too_long` | Use at most {max} characters. | Usa como máximo {max} caracteres. |
| `venue_privacy.notice_url_help` | The page on your own web site that holds your full privacy notice. The guide has templates for it and for the short notices that point to it. | La página de tu propia web con tu aviso de privacidad completo. La guía tiene plantillas para él y para los avisos breves que remiten a él. |
| `venue_privacy.notice_url_help_label` | What this page is for | Para qué sirve esta página |
| `venue_privacy.notice_url_help_guide` | Privacy notice templates | Plantillas de avisos de privacidad |

`GUIDE_LINKS` gains `"data-protection.staff-notice": { page: "data-protection", section: "staff-notice" }`.

1. Tests first (browser mode; a stub `api` with `liveData`, `getVenuePrivacy` and `putVenuePrivacy`
   that records writes, as `venue-defaults-panel.unsaved.test.ts:40-60` builds one). Cases:
   - the read view shows "Not set" twice for an empty contact, and the two stored values when set;
   - read-only (`readOnly = true`) shows the values and no Edit;
   - Edit draws two `wt-input`s named `privacyNoticeUrl` (`type="url"`) and `privacyEmail`
     (`type="email"`, `autocomplete="off"`), with the placeholders above, neither required, and
     Save quiet and disabled;
   - typing a change enables Save; typing it back, or adding only spaces, makes it quiet again;
   - Save sends only the changed field, closes the form and shows the answered value; emptying a
     field and saving sends `""` and shows "Not set";
   - nothing is said before the first Save; a Save with `example.com/privacy` sends nothing, puts
     `venue_privacy.web_address_invalid` under the field and `form.fix_fields` at the bottom, and
     focuses the field; fixing it clears both and enables Save; breaking it again brings the message
     back and disables Save;
   - the same for `privacy@example`, and the length message filled with `500` and `254`, using the
     two Task 1 rows at each limit;
   - a refusal `venue.detail_invalid { field: "privacyEmail", reason: "email" }` from the server
     goes under the email field with `form.fix_fields` at the bottom, and Save stays enabled;
   - a refusal naming no field (`authorization.not_permitted`) goes in the bottom message only, and
     Save stays enabled;
   - while the save is in flight Save shows its loading state and Save and Cancel are disabled;
   - Enter in a field saves (`submitOnEnter`);
   - with help off no badge is shown; with help on (`setHelpMode(true)`, restored after) the web
     page field holds a `wt-help-tooltip` with `mode="help-mode"`, `guide-href` equal to
     `guideHref("data-protection.staff-notice")` (`/help/en/data-protection#staff-notice`) and
     `guide-label` from `strings.ts`; in Spanish the address is `/help/es/data-protection#staff-notice`;
   - in Spanish (`setLocale("es-ES")`, restored after) the labels, placeholders and messages are the
     Spanish strings, read from `strings.ts`;
   - a live read delivering a new stored pair updates the read view; during an edit an untouched
     draft follows it and a changed draft keeps what was typed.
   Run `pnpm --filter @waitron/dashboard exec vitest run src/screens/venue-privacy-panel.test.ts`;
   watch it fail.
2. Write the panel (decision 8). Expected: every case passes; read the `Tests` count.
3. Omission controls, each run and reverted: compare the draft without `privacyContactValue` (the
   spaces-only case fails); drop `mode="help-mode"` (the help-off case fails, and so does
   `pnpm exec vitest run scripts/help-tooltip-mode.test.ts`); disable Save on a server refusal (the
   two refusal cases fail).
4. `pnpm --filter @waitron/dashboard typecheck`; at the root `pnpm exec vitest run
   scripts/guide-links.test.ts scripts/native-form-fields.test.ts scripts/help-tooltip-mode.test.ts
   scripts/style-token-names.test.ts scripts/primary-coloured-text.test.ts`.

## Task 6b: the card's draft protection and accessibility

Files: `apps/dashboard/src/screens/venue-privacy-panel.unsaved.test.ts` (new, modelled on
`venue-defaults-panel.unsaved.test.ts`), `apps/dashboard/src/screens/venue-privacy-panel.a11y.test.ts`
(new, modelled on `venue-defaults-panel.a11y.test.ts`).

1. Unsaved cases: Keep on leaving with a changed draft keeps it; Discard restores the saved values
   with no write; a reverted draft (and a spaces-only one) leaves without asking; Cancel asks with a
   changed draft, Keep stays and Discard returns to the read view; reconnecting keeps the draft and
   its protection; removing the card releases protection; `venue-settings-hidden` ends an unchanged
   edit and keeps a changed one; turning read-only with a changed draft drops it and its protection.
2. Accessibility: `expectNoA11yViolations` for the states read view, Edit, changed, invalid (after a
   failed Save), saving, and Edit with help on, in light and dark, in English and Spanish.
3. Run both files. A failure here is a defect in the panel: fix the panel, not the test.

## Task 7: the card on the Venue settings page

Files: `apps/dashboard/src/dashboard-app.ts` (import the panel; a `privacy` entry after `defaults`
in `CORE_SETTINGS_PANELS`, `:314-335`), and the app tests below.

1. Every app test whose stub already answers `getVenueDefaults` gains `getVenuePrivacy` answering
   `{ privacyNoticeUrl: null, privacyEmail: null }`:
   `dashboard-app.a11y.test.ts:439`, `dashboard-app.help.test.ts:78`,
   `dashboard-app.panel-only.test.ts:95`, `dashboard-app.settings-panels.test.ts:116`,
   `dashboard-app.test.ts:143`, `dashboard-app.unsaved-changes.test.ts:924`,
   `dashboard-app.venue-settings-unsaved.test.ts:99`, `:893`, `:924`, `:957`, `:978`, `:1003`, and
   `screens/receipt-editor-boundaries.test.ts:66` if it mounts the Venue settings page.
2. The pinned lists listed under "Existing assertions that change on purpose" gain the new card.
3. New app cases: in `dashboard-app.settings-panels.test.ts`, the privacy panel is read-only for a
   supervisor and editable for a manager (extend the `it.each` at `:219-236` to the new tag); in
   `dashboard-app.venue-settings-unsaved.test.ts`, leaving Venue settings with a changed Privacy
   draft asks, and Discard leaves without a write.
4. Run the seven app test files above, then `pnpm --filter @waitron/dashboard typecheck`.

## Task 8: the guide

Files: `apps/server/src/guide/en/data-protection.md`, `apps/server/src/guide/es/data-protection.md`,
`apps/server/src/guide-content.test.ts` (`:204-214`).

Insert after the `full-notice` section, before `record`:

```md
## Your privacy page and email in Waitron {#privacy-settings}

Waitron keeps two details of your privacy notice with the venue's other details: the address of
the web page that holds your full notice, and the email address people write to about their data.
To set them, open **Venue settings**, stay on the **Venue details** tab and find the **Privacy**
card. Choose **Edit**, fill in either or both, and choose **Save**.

- **Privacy notice web page** takes the page's full address, starting with `https://` or
  `http://`, such as `https://example.com/privacy`. Waitron refuses an address without that start,
  with a space in it, or with a user name or password in it.
- **Privacy email** takes one email address, such as `privacy@example.com`.

To remove one, empty its field and choose **Save**. A manager or an admin can change them, and a
supervisor can see them. For now Waitron only keeps them here: nothing else on the box shows them.
```

```md
## Tu página y tu correo de privacidad en Waitron {#privacy-settings}

Waitron guarda dos datos de tu aviso de privacidad junto con los demás datos del local: la
dirección de la página web con tu aviso completo y el correo al que la gente escribe sobre sus
datos. Para indicarlos, abre **Ajustes del local**, quédate en la pestaña **Datos del local** y
busca la tarjeta **Privacidad**. Elige **Editar**, rellena uno o los dos y elige **Guardar**.

- **Página web del aviso de privacidad** lleva la dirección completa de la página, que empieza por
  `https://` o `http://`, como `https://ejemplo.es/privacidad`. Waitron rechaza una dirección que
  no empiece así, que tenga un espacio o que lleve un nombre de usuario o una contraseña.
- **Correo de privacidad** lleva un correo electrónico, como `privacidad@ejemplo.es`.

Para quitar uno, vacía su campo y elige **Guardar**. Un gerente o un administrador puede
cambiarlos, y un supervisor puede verlos. Por ahora Waitron solo los guarda aquí: nada más en la
caja los muestra.
```

Each sentence's source, checked when the text is written and again by the reviewer:

| Sentence | Source |
| --- | --- |
| Venue settings, Venue details tab, Privacy card, Edit, Save | Task 7's `CORE_SETTINGS_PANELS` entry; `strings.ts` `venue_settings.title`, `venue_settings.tab.venue_details`, `venue_settings.card.privacy`, `action.edit`, `action.save` (Spanish: «Ajustes del local», «Datos del local», «Editar», «Guardar») |
| full address starting with https:// or http://; refused without it, with a space, with a user name or password | Task 1's rule and its refusal rows |
| one email address | Task 1's email rows (`isValidEmail`) |
| empty its field and Save removes it | Task 4's clearing case; Task 6a's emptying case |
| a manager or an admin can change them; a supervisor can see them | `permissions.ts:48-84`; Task 4's permission case; Task 7's read-only case |
| nothing else on the box shows them | decision 1: no reader changed (Task 0 step 4 and the S1b list) |

1. Change the ids in `guide-content.test.ts:204-214` to include `privacy-settings` after
   `full-notice`; watch it fail; add both sections; run `pnpm --filter @waitron/server exec vitest
   run src/guide-content.test.ts` and, at the root, `pnpm exec vitest run scripts/guide-links.test.ts`.
2. `pnpm exec prettier --file-info apps/server/src/guide/en/data-protection.md` to see whether the
   file is formatted or ignored, and `pnpm format:check`.

## Task 9 (visual): LOOK

Open the card and LOOK, in light and dark, at 1280 px and 390 px, in English and Spanish: the read
view with both values set (a long web page address wraps inside the card, `overflow-wrap: anywhere`
in `settings-card.ts:41`), the Edit form, a failed Save with both messages, and help on with the
badge open. Start the dev stack with `wa-wt demo <worktree-name>` (never a bare `pnpm dev*`), or
take screenshots from the browser test. Also open `/help/en/data-protection#privacy-settings` and
its Spanish twin. Record what was looked at in the pull request.

## Task 10: backlog, overview and design

Files: `docs/backlog/data-protection.md`, `docs/superpowers/plans/2026-10-24-a980-data-protection-build.md`,
`docs/superpowers/specs/2026-10-22-a980-data-protection-design.md`.

1. Backlog, the A980 point **S1**: S1a is built (one line and this plan's name); what stays is S1b,
   with the reader list of "What this slice builds, and where the S1a/S1b line falls" and the
   guide sentence it rewrites. Each owner decision A to F that the owner has not answered becomes
   a line in the area's `## Decisions and deliberate limits`, with its default.
2. Overview: a dated sentence in the status paragraph (S1a built; the column names; nothing reads
   them yet; the writer added to `write-path-tables.json`), and the S1b row's note gains the three
   corrections of "What this changes in the overview".
3. Design §5.2 item 2: a dated pointer, "2026-10-26: S1a stores the setting; S1b makes the readers
   use it", not a rewrite.

## Root guards to run before `/finish-branch`

`pnpm exec vitest run scripts/write-path-tables.test.ts scripts/migrations-match-schema.test.ts
scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts
scripts/journal-monotonic.test.ts scripts/migration-upgrade.test.ts scripts/column-vocabulary.test.ts
scripts/no-tenant-column.test.ts scripts/live-subscriptions.test.ts scripts/guide-links.test.ts
scripts/help-tooltip-mode.test.ts scripts/native-form-fields.test.ts scripts/personal-log-params.test.ts
scripts/english-only.test.ts scripts/errors-reachable.test.ts scripts/style-token-names.test.ts
scripts/primary-coloured-text.test.ts`, each file's result read from its own lines. Then the
packages' focused runs from each task; CI runs the package suites, coverage and `mutation-shared`
(home CLAUDE.md §2).

## What this changes in the overview

- **`tenants` has a write allow-list.** Only the files `scripts/write-path-tables.json` names may
  write it (probe 3), so the writer is a new listed file in `@waitron/provisioning` (decision 3).
- **The readers moved and grew.** The privacy link is passed at `apps/server/src/boot.ts:2012`,
  `:2137` and `:2177`, not `:1925` and `:2069`, and S3 added a reader the overview did not list,
  `apps/server/src/invoice-customer-data-api.ts:29`, `:125`. The invoice email has no privacy text
  to move: S1b adds it. The sign-in page and the profile page both read the link from one
  route that needs no sign-in (`management-api.ts:788-790`), so S1b reads `tenants` there.
- **The migration was measured, not assumed**: two `ALTER TABLE … ADD` lines, no rebuild (probe 1).
- **The configuration export names the taxpayer's fields one by one**, so the new columns are not
  carried unless a slice adds them (decision 10, owner decision B).
