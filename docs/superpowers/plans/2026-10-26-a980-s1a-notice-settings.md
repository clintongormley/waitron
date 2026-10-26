# A980 slice S1a: a dashboard setting for the venue's privacy notice page and privacy email

**Status: plan, 2026-10-26, the fresh plan review folded in (0 Critical, 5 Important, 10 Minor,
`~/waitron-campaign-b/a980-s1a-plan-review.md`), then its round-3 claim check (0 Critical, 3
Important, 9 Minor, `~/waitron-campaign-b/a980-s1a-plan-round3.md`). Nothing was built when this was written.** Branch
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

- `apps/server/src/boot.ts:2019`, into `mountManagementApi`, which passes it to the invitation and
  reset emails (`apps/server/src/management-api.ts:194`) and answers it on
  `GET /management-api/google/config` (`management-api.ts:788-790`), a route that needs no sign-in.
  Both the sign-in page (`apps/dashboard/src/screens/login-screen.ts:324-328`) and the profile page
  (`apps/dashboard/src/screens/profile-screen.ts:345-348`) read the link from that one route.
- `boot.ts:2144`, into the S3 invoice-customer download
  (`apps/server/src/invoice-customer-data-api.ts:29`, `:125`).
- `boot.ts:2184`, into `mountMeApi`, which passes it to the own personal-data download
  (`apps/server/src/me-api.ts:130`, then `personal-data-export-api.ts:28`, `:97` and
  `personal-data-readme.ts:15`, `:50`, `:69`, `:100`, the README) and to the email-address check
  email (`me-api.ts:182`).
- `apps/server/src/invoice-email.ts`: it carries **no** privacy text today (a search for
  `privacy` in it finds nothing), so S1b adds the invoice notice there rather than moving a link.
- The dashboard's live read `getGoogleConfig` depends on `google_config` alone
  (`apps/dashboard/src/api/live-queries.ts`), so S1b adds `tenants` to it once the route answers
  the stored setting.
- `apps/server/README.md:492` documents the environment setting; S1b removes it with the setting.
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
   says what this slice accepts instead. The review added (same Node): `https:///example.com`,
   `"https://\\example.com"` (a JavaScript string holding one backslash) and `https://.` all parse, and so does an address ending in a
   zero-width space (U+200B), which `/\s/` does not match: `URL.parse` keeps it as `%E2%80%8B` in a
   path (a different page), and drops it, like a soft hyphen (U+00AD), from a host. `"\u200b".trim()`
   is not `""`. `https://example.com:99999/privacy` (a port out of range) gives `null`. Round 3 also
   found these accepted by the rule and rewritten by `URL.parse` to the host they name:
   `https://@example.com/p`, `https://:@example.com/p`, `https://ex%61mple.com/p`,
   `https://0x7f.1/p` (to `127.0.0.1`), `https://example.com:/p` and
   `"https://example.com\\privacy"` (one backslash, read as `/privacy`).

5. **Task 1's rule and table, and Stryker on them.** The rule of decision 5 and Task 1's table, as
   this plan now writes them, were put in a throwaway `packages/shared/src/privacy-contact.ts` and
   `privacy-contact.test.ts` (kept, outside the repo, in `~/waitron-campaign-b/a980-s1a-plan-probe/`
   as `privacy-contact.round3.ts` and `privacy-contact.round3.test.ts`; the earlier pair without
   the round-3 rows sits beside them). `pnpm exec vitest run src/privacy-contact.test.ts` printed
   `Tests  45 passed (45)`, and `pnpm exec stryker run --mutate src/privacy-contact.ts` in
   `packages/shared` printed 51 killed, 0 survived. Two controls run on the same files: with the
   invisible-character class cut back to `/\s/`, 5 rows failed (the four web page rows with U+200B,
   U+00AD, U+200D and U+2060, and the email row with U+200B; the U+FEFF row still passed, because
   `/\s/` matches U+FEFF); with `value.length` for `[...value].length`, 1 row failed (the accepted
   500-code-point `😀` row). Before round 3, the table needed two rows to reach 0 survived. Without
   `javascript:https://example.com` the review's Stryker run left the prefix's `^` anchor alive, and
   an unanchored prefix accepts that value. Without the out-of-range port row, the `parsed === null`
   test survived on this rule, because the new prefix already refuses `https://`. The throwaway
   files and the `packages/shared/reports/` directory Stryker made were then deleted.

6. **What Chromium does to typed text** (the workspace's playwright 1.64.1, typing with
   `pressSequentially` into bare inputs). `type="url"` keeps `https://cafetería.es/privacidad` and
   `  https://example.com/p  ` exactly as typed (round 3 saw the same for `fill` and
   `keyboard.insertText`, but a script setting the input's `value` strips the surrounding spaces). `type="email"` turns `privacidad@cafetería.es` into
   `privacidad@xn--cafetera-i2a.es` (the review also saw it strip surrounding spaces).
   `type="text"` keeps both the accent and the spaces. Decision 8 follows from this.

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
   holds: it contains whitespace or an invisible format character
   (`/[\s\u00ad\u200b-\u200d\u2060]/`: whitespace, which in JavaScript includes U+FEFF, plus the
   soft hyphen, the zero-width space, non-joiner and joiner, and the word joiner); it does not start with `http://` or `https://` in any
   letter case followed by a character that is neither `/` nor `\` (`/^https?:\/\/[^/\\]/i`);
   `URL.parse(value)` is `null` (for example an out-of-range port); or the parsed address has a
   user name or a password. The anchored prefix makes a protocol check redundant, and it already
   refuses `https://` with nothing after it, so neither a protocol nor a host check is written. The
   value is **stored as typed** (trimmed), not as `URL.parse`'s rewrite, which would add a slash,
   change letter case and turn an accented host into its ASCII form (`xn--…`); for the same reason
   the typed text is never compared with the parsed host, which would refuse every accented
   Spanish domain. Against today's environment rule (probe 4) this refuses five kinds of value it
   accepts: a user name or password; whitespace; an invisible format character, which a paste from
   a web page or document can carry and which turns the link into another page (probe 4); `https:`
   without `//`; and `/` or `\` straight after `//`. Some odd spellings stay accepted: the rule does
   not try to refuse every spelling `URL.parse` rewrites. `https://.` has a row of its own in Task 1
   as accepted on purpose; the others round 3 found (probe 4) each open the host they name. Owner
   decision F.
   Worked example: `https://barejemplo.es/privacidad` and `http://barejemplo.es` are saved as
   typed; `barejemplo.es/privacidad` is refused with "Enter the page's full web address, such as
   https://example.com/privacy."

6. **What the email field accepts.** Refused as `length` above **254** code points, otherwise as
   `email` when it holds an invisible format character (the same class as decision 5) or
   `isValidEmail` refuses it. Stored trimmed and as typed: not lower-cased, because
   it is shown to people, never compared. "As typed" holds through the dashboard only because the
   field is a text input, not an email one (decision 8, probe 6).

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
     `name="privacyEmail"` with `wt-input`'s default `type="text"` and `autocomplete="off"` (it is
     the venue's address, not the person's own), each with its hint as its `placeholder`, neither
     `required`. The email field is not `type="email"`: Chromium hands an accented domain on in its
     ASCII form (probe 6), so the stored and shown value would not be what was typed. `wt-input`
     passes the native input's value straight on (`packages/ui-core/src/components/wt-input.ts:76-79`),
     and Task 6a1 pins what Chromium hands on for both fields. Save follows the
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
     `aria-label` from `venue_privacy.notice_url_help_label` (the Forms contract asks for a
     localized one, `docs/developers/design-system.md:3259`),
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
   box shows them", and it says that a configuration export does not carry them (decision 10;
   Task 8 gives the text). `apps/server/src/guide-content.test.ts:200-214` pins the
   page's section ids, so that assertion changes on purpose.

10. **The configuration export does not carry the two values.** The export names the taxpayer's
    fields one by one (`packages/provisioning/src/configuration-transfer.ts:74-118`, bundle
    `version: 8`, the import's check at `:508-537`), not through the module transfer seat, so the
    new columns are not exported unless S1a adds them to the bundle, its check, the setup paths that
    apply it (`apps/server/src/setup-api.ts:476-479`, `packages/provisioning/src/venue-apply.ts`)
    and their tests. That is a slice of its own. Nothing on the card says why it is empty after a
    move; the guide section says it (Task 8), and the backlog line for owner decision B records it
    (Task 10). Owner decision B.

    _2026-10-26: S1a2 carries them ([its plan](2026-10-26-a980-s1a2-export-privacy-contact.md))._

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
  says "Not set" for both. Nothing on the card tells the manager why; only the guide's Privacy
  section says that an export does not carry them. A manager who never reads it finds out when
  the privacy link is missing. Alternative: carry them in the bundle, a later slice.
- **C. A supervisor can see the values** (decision 7, `venue.view`). Worked example: Lucía, a
  supervisor, opens Venue settings and reads the address and email, with no Edit button.
  Alternative: show the card only to `venue.configure`.
- **D. The card sits last among the core cards on the Venue details tab** (decision 8). On a
  Spanish venue, which has the Veri\*Factu module, the order is Business, Venue, Business day,
  Defaults, Privacy, AEAT certificate: the module's certificate panel declares `order: 1`
  (`packages/fiscal-verifactu/src/dashboard/index.ts:13-14`) and module panels follow the core
  ones (`apps/dashboard/src/dashboard-app.ts:1952-1967`). Alternative: put it straight after
  Business, the venue's identity.
- **E. Last save wins** (decision 7). Worked example: two managers open Edit at the same time; Ana
  saves `privacidad@barejemplo.es`, then Jordi, whose form still shows the old value, saves a new
  web page address. Jordi's request sends only the web page, so Ana's email stays. Had Jordi also
  changed the email, his would replace hers without a warning. The Defaults card works the same way.
- **F. Stricter than the environment setting** (decision 5). Worked example:
  `https://admin:secreto@barejemplo.es/privacidad` is accepted in `WAITRON_PRIVACY_NOTICE_URL` today
  and would be refused here, so a password typed by mistake never reaches the staff emails S1b sends.
  So would `https:///barejemplo.es/privacidad`. `http://` addresses stay accepted, as today; the
  alternative is to require `https://`. A pasted address carrying an invisible character, such as a
  zero-width space at its end, is refused with the web address message rather than saved as a link
  to a page that probably does not exist. Still accepted, and stored as typed, because each opens
  the host it names: `https://.`, `https://@example.com/p`, `https://ex%61mple.com/p`,
  `https://0x7f.1/p`, `https://example.com:/p` and an address with a backslash for a slash after
  the host (decision 5).

## Global constraints

- **English only** in code, identifiers, comments, fixtures and tests. Spanish only in
  `apps/dashboard/src/i18n/strings.ts`'s Spanish half and `apps/server/src/guide/es/data-protection.md`.
  A test of Spanish text reads its expected words from `strings.ts`. Fixture addresses are
  `https://example.com/privacy` and `privacy@example.com`; the guide's Spanish examples use
  `ejemplo.es`.
- **Every database test uses `useVenueDb`.** Every refused request asserts the domain error code,
  its exact params and the status. Exact shapes use `toEqual` or `toBe`, never `toMatchObject`.
- **Fixtures use values the two sides could treat differently**: a value with surrounding spaces
  (so a writer that forgets to trim fails); an email with a decomposed accent, written in the
  test as the escapes `"jose\u0301@example.com"` and expected as `"jos\u00e9@example.com"`,
  never retyped as characters, which look identical (so a writer that skips NFC fails); a web page address in capitals (so a
  case-sensitive prefix fails); limits tested at exactly the limit and one over, once with an
  astral character (`😀`, two UTF-16 units, one code point), so counting `.length` fails.
- **Nothing else in the taxpayer row changes**: every write test compares the whole row with
  `{ ...before, <the changed columns> }`.
- **Existing assertions that change on purpose**, each named in the pull request:
  `apps/dashboard/src/dashboard-app.settings-panels.test.ts:275-295` (the card headings gain
  Privacy last), `apps/dashboard/src/dashboard-app.panel-only.test.ts:131-136` (the panels gain
  `dashboard-venue-privacy-panel` before the module's `p`), `apps/dashboard/src/dashboard-app.test.ts:1814`
  (the panels handed the app's `api` gain the new one) and `:4832-4836` (the tab holds three
  panels, not two), `apps/dashboard/src/dashboard-app.venue-settings-unsaved.test.ts:976-993` (the
  "four cards are spaced evenly" case becomes five cards, with the Privacy card's gap), and
  `apps/server/src/guide-content.test.ts:204-214` (the Data protection page's
  ids gain `privacy-settings` after `full-notice`). Lists that only grow by one entry:
  `packages/shared/src/index.test.ts` (its import list), `apps/dashboard/src/api/live-queries.test.ts:190-210`
  (the dependency table) and `scripts/write-path-tables.json`. No other existing assertion is
  expected to change; if one does, stop and say why in the handover.
- **Coverage**: `@waitron/shared`, `@waitron/provisioning`, `@waitron/server`, `@waitron/db` and
  `@waitron/dashboard` hold 98/98/98/95. No exclude or ignore comment. Mutation gates only
  `@waitron/shared` on this pull request (`mutation-shared`, `docs/developers/ci-and-gates.md:414`).
  `@waitron/db` is mutation-tested nightly with a floor of 90, and its config sets
  `"ignoreStatic": true` (`packages/db/stryker.config.json:15`), so it ignores mutants in code
  that runs only when a module loads, which is where the two schema lines are.
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
  refusal case of Task 1, including the anchored prefix's `javascript:https://…` row; the value
  stored as typed; the invisible-character rows; Stryker leaves no mutant alive (probe 5 printed 51
  killed, 0 survived on this
  table; Task 1 runs it again on the real file).
- **The routes** (decision 7): authorisation before the body; `venue.configure` for the write and
  `venue.view` for the read; nothing written on any refusal, which the transaction guarantees
  (`gated` runs inside `withTransaction`, `location-settings-api.ts:155-166`, whose write lock
  rolls back when the body throws, `packages/db/src/tenancy.ts:30-43`,
  `packages/store/src/write-queue.ts:88-95`) and the route test only observes; empty clears to
  `NULL`, never `""`; no value in a refusal.
- **The card** (decision 8): the Forms contract case by case (quiet Save, no message before the
  first Save, messages under fields, the bottom sentence, focus, Save disabled only by the form's
  own checks); the draft scope and its `*.unsaved.test.ts`; the live read and `#adopt`; the help
  badge's `mode="help-mode"`, its `aria-label` and its link; read-only for a supervisor; the email
  field is a text input (decision 8).
- **The docs that describe the tab** (Task 10): `design-system.md`'s card lists and Save-rule list,
  and a whole-tree grep for `four cards` and `Business, Venue, Business day` afterwards.
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

Write every invisible or look-alike character in the tests as a JavaScript escape (`\u0301`,
`\u00e9`, `\u00a0`, `\t`), never as the character itself.

1. Tests first, two `it.each` tables:
   - **`privacyContactValue`** (raw → value), 5 rows: `"  https://example.com/privacy  "` →
     `"https://example.com/privacy"`; `""` → `null`; `"   "` → `null`; `"\u00a0"` → `null`;
     `"jose\u0301@example.com"` → `"jos\u00e9@example.com"`.
   - **`privacyContactProblem`** (field, value → problem), 39 rows. Web page, accepted
     (`undefined`), 7 rows: `"https://example.com/privacy"`, `"http://example.com"`,
     `"HTTPS://EXAMPLE.COM/Privacy"`, `"https://example.com/" + "a".repeat(480)` (500 code points),
     `"https://example.com/" + "😀".repeat(480)` (500 code points, 980 UTF-16 units), `null`,
     `"https://."` (accepted on purpose, decision 5).
     Web page, `web_address`, 21 rows: `"example.com/privacy"`, `"https:example.com"`,
     `"ftp://example.com"`, `"javascript:alert(1)"`, `"javascript:https://example.com"`,
     `"mailto:privacy@example.com"`, `"https://"`, `"https://example.com:99999/privacy"`,
     `"https:///example.com"`, `"https://\\example.com"` (one backslash in the value),
     `"https://user:pw@example.com/p"`, `"https://user@example.com/p"`,
     `"https://:pw@example.com/p"`, `"https://example.com/priv acy"`,
     `"https://example.com/a\u00a0b"`, `"https://example.com/a\tb"`,
     `"https://example.com/privacy\u200b"`, `"https://exam\u00adple.com/privacy"`,
     `"https://example.com/a\u200db"`, `"https://example.com/a\u2060b"`,
     `"https://example.com/a\ufeffb"`. Web page, `length`, 2 rows:
     `"https://example.com/" + "a".repeat(481)`, `"https://example.com/" + "😀".repeat(481)`.
     Email, accepted, 3 rows: `"privacy@example.com"`, `"a@" + "b".repeat(249) + ".es"` (254),
     `null`. Email, `email`, 5 rows: `"privacy"`, `"privacy@example"`, `"a@b@example.com"`,
     `"pri vacy@example.com"`, `"privacy\u200b@example.com"`. Email, `length`, 1 row: `"a@" + "b".repeat(250) + ".es"` (255).
   - One case: `PRIVACY_CONTACT_MAX_LENGTH` is exactly `{ privacyNoticeUrl: 500, privacyEmail: 254 }`
     and `PRIVACY_CONTACT_FIELDS` exactly `["privacyNoticeUrl", "privacyEmail"]`.
   Run `pnpm --filter @waitron/shared exec vitest run src/privacy-contact.test.ts`; watch it fail
   (no module).
2. Write the module (decisions 4 to 6): length first, then shape; no protocol or host check
   (decision 5 says why). Run again: expected `Tests  45 passed (45)` (probe 5 printed the same
   for this table).
3. Omission controls, each run and reverted, the failing rows recorded for the pull request:
   count `.length` instead of code points (fails the 500-code-point `😀` row; the 501 one answers
   `length` either way); `>=` for `>` (fails the 500 and
   254 rows); drop the whitespace test (fails the three whitespace rows); drop the password check
   (fails `https://:pw@…`); make the prefix case-sensitive (fails the capitals row); drop the `^`
   anchor (fails the `javascript:https://example.com` row); drop `[^/\\]` from the prefix (fails
   `https:///example.com` and `https://\example.com`; `https://` is then refused by `URL.parse`); drop the `parsed === null` test
   (the port row throws instead of answering); cut the invisible-character class back to `/\s/`
   (fails the U+200B, U+00AD, U+200D and U+2060 web page rows and the U+200B email row; the U+FEFF
   row still passes, since `/\s/` matches it); skip NFC (fails the accent row).
4. Mutation, this file only:
   `pnpm --filter @waitron/shared exec stryker run --mutate src/privacy-contact.ts`. Expected: 0
   survived (probe 5 printed 51 killed, 0 survived on a rule written from this plan; a different
   but equivalent rule may give another number of mutants). A survivor is answered with a test, or
   by deleting the code it shows to be redundant; never by an ignore comment. Delete the
   `packages/shared/reports/` directory Stryker writes if it did not exist before.
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

   _2026-10-26: the comment was not kept: the route (`apps/server/src/venue-privacy.ts`) turns a
   blank value into NULL, not `savePrivacyContact`, which stores what it is given._

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
 * is no taxpayer row. It drops keys whose value is `undefined` first; with no value left it writes
 * nothing and returns `readPrivacyContact(tx)`, because drizzle's `.set()` throws `No values to
 * set` for `{}` and for `{ privacyEmail: undefined }` alike. Takes
 * checked values: it throws no code of its own. */
export async function savePrivacyContact(
  tx: Transaction,
  changes: Partial<PrivacyContact>,
): Promise<PrivacyContact | null>;
```

1. Tests first (`useVenueDb`, inserting the taxpayer row as `taxpayer-name.db.test.ts:18-26` does):
   a fresh row reads both `null`; saving both stores them and the whole row equals
   `{ ...before, privacyNoticeUrl, privacyEmail }`; saving one leaves the other; saving `null`
   stores SQL `NULL` (read back with `select privacy_email is null as unset from tenants`); with no
   taxpayer row, read and save answer `null` and `select count(*) from tenants` stays 0; saving
   `{}` and saving `{ privacyEmail: undefined }` (one `it.each`, 2 rows) each write nothing and answer
   the stored pair. Run `pnpm --filter @waitron/provisioning exec vitest run
   src/privacy-contact.db.test.ts`; watch it fail; write the file; expected `Tests  7 passed (7)`.
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
   - PUT `"jose\u0301@example.com"` (written with the escape): stored `"jos\u00e9@example.com"`.
   - Twelve refusals, one `it.each`, each asserting 400, the exact body
     `{ error: { code: "venue.detail_invalid", params } }`, and the row unchanged: an array body
     (`{ field: "body", reason: "type" }`); the string `"x"` (same); `{}`
     (`{ field: "body", reason: "required" }`); `{ legalName: "X" }`
     (`{ field: "body", reason: "unknown_field" }`); `{ privacyNoticeUrl: null }`
     (`{ field: "privacyNoticeUrl", reason: "type" }`); `{ privacyEmail: 5 }`
     (`{ field: "privacyEmail", reason: "type" }`); `example.com/privacy` (`web_address`); a
     501-code-point address (`length`); `privacy@example` (`email`); a 255-code-point email
     (`length`); a valid web page with `privacy` as the email (`email`, and the web page **not**
     written, which the transaction guarantees and this row observes); `nope` in both (`{ field: "privacyNoticeUrl", reason: "web_address" }`).
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
   instead of `null` (the clearing case fails); give PUT `venue.view` (the supervisor case fails).
   There is no control for "write the first field, then refuse the second": the route's body runs
   inside `withTransaction`, which rolls back when it throws (read, not run:
   `packages/db/src/tenancy.ts:30-43`, `packages/store/src/write-queue.ts:88-95`), so such a
   mutation would leave the row unchanged and every case green.
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

## Task 6a1: the Privacy card, its form and its own checks

Files: `apps/dashboard/src/screens/venue-privacy-panel.ts` (new),
`apps/dashboard/src/screens/venue-privacy-panel.test.ts` (new), `apps/dashboard/src/i18n/strings.ts`
(English and Spanish: all the keys below, so 6a2 adds none), `apps/dashboard/src/help-guide.ts`
(one `GUIDE_LINKS` entry, used in 6a2).

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
   that records writes, as `venue-defaults-panel.unsaved.test.ts:40-60` builds one), 19 cases:
   1. the read view shows "Not set" twice for an empty contact;
   2. the read view shows the two stored values when set;
   3. read-only (`readOnly = true`) shows the values and no Edit;
   4. Edit draws two `wt-input`s named `privacyNoticeUrl` (`type="url"`) and `privacyEmail`
      (`type="text"`, `autocomplete="off"`), with the placeholders above, neither required, and
      Save quiet and disabled;
   5. typing a change into the web page field enables Save, and typing it back makes it quiet
      again;
   6. adding only spaces around the stored web page keeps Save quiet (the web page field keeps the
      spaces it is given when typed, probe 6). The spaces go in by typing with `userEvent`, or by a
      `wt-change` event carrying the spaced value as `venue-defaults-panel.test.ts:238-241` sends one;
      never by setting the native input's `value` from a script, which Chromium's url input strips
      of surrounding spaces, so the case would pass without the code it tests;
   7. Save sends only the changed field, closes the form and shows the answered value;
   8. emptying a field and saving sends `""` and shows "Not set";
   9. nothing is said before the first Save; a Save with `example.com/privacy` sends nothing, puts
      `venue_privacy.web_address_invalid` under the field and `form.fix_fields` at the bottom, and
      focuses the field;
   10. after that failed Save, fixing the field clears both messages and enables Save, and breaking
       it again brings the message back and disables Save;
   11. a Save with `privacy@example` does the same with `venue_privacy.email_invalid`;
   12. and 13. (`it.each`, the two Task 1 rows one over each limit) a too-long value shows
       `venue_privacy.too_long` filled with `500` or `254`;
   14. a refusal `venue.detail_invalid { field: "privacyEmail", reason: "email" }` from the server
       goes under the email field with `form.fix_fields` at the bottom, and Save stays enabled;
   15. a refusal naming no field (`authorization.not_permitted`) goes in the bottom message only,
       and Save stays enabled;
   16. while the save is in flight Save shows its loading state and Save and Cancel are disabled;
   17. Enter in a field saves (`submitOnEnter`);
   18. and 19. typed with `userEvent` into the real fields, `https://cafeter\u00eda.es/privacidad`
       reaches the draft and the PUT body unchanged in the web page field, and
       `privacidad@cafeter\u00eda.es` unchanged in the email field. If case 18 fails, Chromium
       rewrites `type="url"` values on this version: make that field `type="text"` too and say so
       in the pull request.
   Run `pnpm --filter @waitron/dashboard exec vitest run src/screens/venue-privacy-panel.test.ts`;
   watch it fail.
2. Write the panel (decision 8) without the help badge or the live read's `#adopt` (6a2). Expected:
   `Tests  19 passed (19)`.
3. Omission controls, each run and reverted: compare the draft without `privacyContactValue` (case
   6 fails, provided it put the spaces in as case 6 says); disable Save on a server refusal (cases
   14 and 15 fail); give the email field `type="email"` (case 19 fails).
4. `pnpm --filter @waitron/dashboard typecheck`; at the root `pnpm exec vitest run
   scripts/native-form-fields.test.ts scripts/style-token-names.test.ts
   scripts/primary-coloured-text.test.ts`.

## Task 6a2: the card's help badge, its Spanish words and its live read

Starts from 6a1's committed panel. Files: `apps/dashboard/src/screens/venue-privacy-panel.ts`,
`apps/dashboard/src/screens/venue-privacy-panel.test.ts` (8 more cases).

1. Tests first, 8 cases:
   1. with help off, the web page field's `wt-help-tooltip` is in the page but not visible: it has
      no `data-help-on` attribute and its computed `display` is `none`
      (`packages/ui/src/components/wt-help-tooltip.ts:45-47`, `:119`);
   2. with help on (`setHelpMode(true)`, restored after) it has `mode="help-mode"`, `data-help-on`,
      `aria-label` equal to `t("venue_privacy.notice_url_help_label")`, `guide-href` equal to
      `guideHref("data-protection.staff-notice")` (`/help/en/data-protection#staff-notice`) and
      `guide-label` equal to `t("venue_privacy.notice_url_help_guide")`;
   3. the same in Spanish gives `guide-href` `/help/es/data-protection#staff-notice`;
   4. in Spanish (`setLocale("es-ES")`, restored after) the card heading, the labels and the
      placeholders are the Spanish strings, read from `strings.ts`;
   5. in Spanish the three refusal messages are the Spanish strings;
   6. a live read delivering a new stored pair updates the read view;
   7. during an edit, an untouched draft follows a live read;
   8. during an edit, a changed draft keeps what was typed when a live read arrives.
   Watch them fail.
2. Add the badge and `#adopt` (decision 8). Expected: `Tests  27 passed (27)` for the file.
3. Omission controls, each run and reverted: drop `mode="help-mode"` (case 1 fails, and so does
   `pnpm exec vitest run scripts/help-tooltip-mode.test.ts`); adopt every live read regardless of
   the draft (case 8 fails).
4. `pnpm --filter @waitron/dashboard typecheck`; at the root `pnpm exec vitest run
   scripts/guide-links.test.ts scripts/help-tooltip-mode.test.ts`.

## Task 6b: the card's draft protection and accessibility

Files: `apps/dashboard/src/screens/venue-privacy-panel.unsaved.test.ts` (new, modelled on
`venue-defaults-panel.unsaved.test.ts`), `apps/dashboard/src/screens/venue-privacy-panel.a11y.test.ts`
(new, modelled on `venue-defaults-panel.a11y.test.ts`).

1. Unsaved cases, 9: Keep on leaving with a changed draft keeps it; Discard restores the saved
   values with no write; a reverted draft leaves without asking; a draft that only added spaces
   around the stored web page leaves without asking; Cancel asks with a changed draft, Keep stays
   and Discard returns to the read view (one case, as `venue-defaults-panel.unsaved.test.ts:123`);
   reconnecting keeps the draft and its protection; removing the card releases protection;
   `venue-settings-hidden` ends an unchanged edit and keeps a changed one; turning read-only with a
   changed draft drops it and its protection. Expected `Tests  9 passed (9)`.
2. Accessibility: one `it.each` over light and dark by English and Spanish (4 cases, as
   `venue-defaults-panel.a11y.test.ts:21-29`), each looping `expectNoA11yViolations` over the states
   read view, Edit, changed, invalid (after a failed Save), saving, and Edit with help on. Expected
   `Tests  4 passed (4)`.
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
   `screens/receipt-editor-boundaries.test.ts:66` if it mounts the Venue settings page. The shared
   fixture `apps/dashboard/src/testing/department-receipt-app-fixture.ts` gains
   `"/management-api/venue-privacy": { privacyNoticeUrl: null, privacyEmail: null }` beside its
   `venue-defaults` answer (`:116-121`): it answers any path it does not know with `[]` (`:136-147`),
   which no real server sends.
2. Before any edit, run the eleven files of step 5 and write down each file's `Tests` count.
3. The pinned lists listed under "Existing assertions that change on purpose" gain the new card,
   including the even-spacing case (`dashboard-app.venue-settings-unsaved.test.ts:976-993`), which
   collects five cards and four equal gaps and is renamed to say five.
4. New app cases: in `dashboard-app.settings-panels.test.ts`, a new `it.each` over a manager and a
   supervisor (2 cases, shaped like `:219-236`): the privacy panel is editable for the manager and
   read-only for the supervisor; in `dashboard-app.venue-settings-unsaved.test.ts`, one case: leaving
   Venue settings with a changed Privacy draft asks, and Discard leaves without a write.
5. Run `dashboard-app.a11y.test.ts`, `dashboard-app.help.test.ts`, `dashboard-app.panel-only.test.ts`,
   `dashboard-app.settings-panels.test.ts`, `dashboard-app.test.ts`,
   `dashboard-app.unsaved-changes.test.ts` and `dashboard-app.venue-settings-unsaved.test.ts`, and
   the shared fixture's four other users: `dashboard-app.receipt-tab.test.ts`,
   `screens/department-receipt-editor.a11y.test.ts`, `screens/department-receipt-editor.client.test.ts`
   and `screens/department-receipt-editor.width.test.ts`. Expected: each file's count from step 2,
   plus 2 for `settings-panels` and plus 1 for `venue-settings-unsaved`, the rest unchanged, with
   nothing failed. Then `pnpm --filter @waitron/dashboard typecheck`.

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
supervisor can see them. A configuration export does not carry them, so after you set up a new box
from one, enter them again. For now Waitron only keeps them here: nothing else on the box shows
them.
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

Para quitar uno, vacía su campo y elige **Guardar**. Un encargado o un administrador puede
cambiarlos, y un supervisor puede verlos. Una exportación de la configuración no los incluye, así
que, si preparas una caja nueva a partir de una, vuelve a escribirlos. Por ahora Waitron solo los
guarda aquí: nada más en la caja los muestra.
```

Each sentence's source, checked when the text is written and again by the reviewer:

| Sentence | Source |
| --- | --- |
| Venue settings, Venue details tab, Privacy card, Edit, Save | Task 7's `CORE_SETTINGS_PANELS` entry; `strings.ts` `venue_settings.title`, `venue_settings.tab.venue_details`, `venue_settings.card.privacy`, `action.edit`, `action.save` (Spanish: «Ajustes del local», «Datos del local», «Editar», «Guardar») |
| full address starting with https:// or http://; refused without it, with a space, with a user name or password | Task 1's rule and its refusal rows (it refuses more, such as `/` straight after `//`; the guide names the cases a person is likely to type) |
| one email address | Task 1's email rows (`isValidEmail`) |
| empty its field and Save removes it | Task 4's clearing case; Task 6a1's emptying case |
| a manager or an admin can change them; a supervisor can see them | `permissions.ts:48-84`; Task 4's permission case; Task 7's read-only case; the role names as the dashboard shows them, «Encargado», «Administrador», «Supervisor» (`apps/dashboard/src/i18n/domain.ts:8-13`) |
| a configuration export does not carry them | decision 10: `packages/provisioning/src/configuration-transfer.ts:74-118` selects no privacy column |
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

## Task 10: backlog, overview, design and the design system

Files: `docs/backlog/data-protection.md`, `docs/superpowers/plans/2026-10-24-a980-data-protection-build.md`,
`docs/superpowers/specs/2026-10-22-a980-data-protection-design.md`, `docs/developers/design-system.md`.

1. Backlog, the A980 point **S1**: S1a is built (one line and this plan's name); what stays is S1b,
   with the reader list of "What this slice builds, and where the S1a/S1b line falls" and the
   guide sentence it rewrites. Each owner decision A to F that the owner has not answered becomes
   a line in the area's `## Decisions and deliberate limits`, with its default; decision B's line
   says that nothing on the card tells a manager why it is empty after a move, only the guide.
2. Overview: a dated sentence in the status paragraph (S1a built; the column names; nothing reads
   them yet; the writer added to `write-path-tables.json`), and the S1b row's note gains the three
   corrections of "What this changes in the overview".
3. Design §5.2 item 2: a dated pointer, "2026-10-26: S1a stores the setting; S1b makes the readers
   use it", not a rewrite.
4. `docs/developers/design-system.md`, the UI contract, in three places:
   - `:3915-3917` ("Venue details tab draws four cards — Business, Venue, Business day and
     Defaults", then the AEAT certificate as a fifth with Veri\*Factu): five cards, Privacy last
     among them, and the certificate a sixth, so with Veri\*Factu the order is Business, Venue,
     Business day, Defaults, Privacy, AEAT certificate; the Privacy card edits in place like Venue
     and Defaults.
   - `:5236-5240` ("Venue details holds four cards … The other four cards need `venue.view`"): the
     same five, and the Privacy card shown with `venue.view` and editable with `venue.configure`.
   - the Save-rule list (`:2825-2829`, after the A755 line): "A980 S1a: Venue settings' Privacy
     card, editing in place. Its leave cases are in
     `apps/dashboard/src/screens/venue-privacy-panel.unsaved.test.ts`;".
   Then grep the whole tree, docs included, for `four cards` and `Business, Venue, Business day`,
   and fix or leave each hit on purpose. On 2026-10-26 the other hits were: the dated A755 plan
   (`docs/superpowers/plans/2026-10-16-a755-venue-settings-cards.md`) and the dated A795 design
   (`docs/superpowers/specs/2026-10-18-a795-aeat-certificate-after-setup-design.md:261`), historical
   records left as they are; `docs/superpowers/plans/2026-10-22-a757-8-service-steps-floor.md:1167`,
   whose "four cards" is about something else; this plan; and the two test lines Task 7 changes
   (`dashboard-app.settings-panels.test.ts:275`, `dashboard-app.venue-settings-unsaved.test.ts:976`).

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
- **The readers moved and grew.** The privacy link is passed at `apps/server/src/boot.ts:2019`,
  `:2144` and `:2184`, not `:1925` and `:2069`, and S3 added a reader the overview did not list,
  `apps/server/src/invoice-customer-data-api.ts:29`, `:125`. The invoice email has no privacy text
  to move: S1b adds it. The sign-in page and the profile page both read the link from one
  route that needs no sign-in (`management-api.ts:788-790`), so S1b reads `tenants` there.
- **The migration was measured, not assumed**: two `ALTER TABLE … ADD` lines, no rebuild (probe 1).
- **The configuration export names the taxpayer's fields one by one**, so the new columns are not
  carried unless a slice adds them (decision 10, owner decision B).
