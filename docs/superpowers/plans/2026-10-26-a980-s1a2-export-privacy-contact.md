# A980 slice S1a2: a configuration export carries the venue's privacy notice page and privacy email

**Status: plan, 2026-10-26. Nothing was built when this was written; no plan review has run yet.**
Branch `feat/a980-s1a2-export-privacy-contact`, from `main` at `27ae35c09` (S1a landed there as
#2106). Owner decision: answer **B** to the S1a plan ("OWNER ANSWER — A980 S1a plan defaults A–F",
lane B's questions file): a configuration export carries the privacy notice address and the privacy
email, so a new box set up from Bar Ejemplo's export shows both values, not "Not set"; the import
checks them exactly as the Privacy card's save does; the guide's "a configuration export does not
carry them" sentence goes, in English and Spanish. Design:
[A980 data protection, revision 2](../specs/2026-10-22-a980-data-protection-design.md) (its notes
at `:679` and `:709` already name S1a2). Overview: [the build plan](2026-10-24-a980-data-protection-build.md),
row **S1a2** (`:103`) and build order step 4 (`:208`). Previous slice:
[the S1a plan](2026-10-26-a980-s1a-notice-settings.md), whose shape this plan copies.

**No migration.** The two columns exist (`packages/db/src/schema/tenants.ts:47-48`, added by S1a's
`packages/db/drizzle/0192_privacy_contact.sql`); this slice changes the configuration bundle and the
code around it, not a table. Task 0 step 5 checks that the branch's diff touches no
`packages/db/drizzle` file.

**FULL review**: a cross-package contract changes, the bundle that `@waitron/provisioning` writes
and reads, which the server stages and imports and the setup app previews. Per-task reviews run,
then `/finish-branch`, which runs two Codex reviews, the second told to set this plan aside and test
what it does not name. **Not fiscal**: nothing an invoice prints or files changes, no fiscal table is
touched, and the golden huella test (`packages/fiscal-verifactu/src/write-path.e2e.test.ts`) and
`packages/fiscal-verifactu/src/inmutabilidad.test.ts` must pass **unedited**.

## Words used here

- The **configuration export** is the encrypted file a manager downloads from the dashboard
  (`POST /management-api/configuration-export`, `apps/server/src/configuration-export-api.ts:35-62`).
  Inside it is one JSON document, the **bundle** (`ConfigurationBundle`,
  `packages/provisioning/src/configuration-transfer.ts:168-176`), written by
  `buildConfigurationBundle` (`:64-152`). It carries a **format** number, `version: 8` (`:136`).
- **Staging** is the setup screen's upload: `POST /setup-api/configuration`
  (`apps/server/src/setup-api.ts:1477-1503`) decodes the file, checks it, keeps it on the box's
  disk and answers a **preview** (`stageConfigurationImport`,
  `packages/provisioning/src/configuration-import.ts:68-87`; the preview is
  `{ venue, counts, reconnect }`, `:86`).
- The **claim** is the setup app's request that starts a first setup:
  `POST /setup-api/first-setup/claim` (`apps/server/src/setup-first-fiscal-api.ts:400-470`). It
  accepts only the venue fields it lists (`:413-436`, through `exact`, `:154-166`).
- The **import** is `importConfigurationTables` (`configuration-transfer.ts:614-775`), which runs
  inside the transaction that creates the new venue, after its taxpayer row is written
  (`packages/provisioning/src/venue-apply.ts:167-193`, then `beforeCommit` at `:487`). Two places
  call it: the setup provision route (`apps/server/src/boot.ts:1382`) and the owned first-setup
  command (`packages/provisioning/src/first-setup-command-deployment.ts:328`).
- **Same tax ID** and **New tax ID** are the two choices the setup screen offers after staging
  (`apps/setup/src/i18n/strings/restore.ts:153-156`, Spanish «Mismo NIF», «NIF nuevo», `:335-338`).
  New tax ID sends `newTaxpayer: true`: a new owner or company takes the configuration.
- The **taxpayer row** is the one row of `tenants` (id 1). The **privacy contact** is its two
  columns `privacy_notice_url` and `privacy_email`, as in the S1a plan. **Unset** is SQL `NULL`.
- The **card's rule** is S1a's shared check: `privacyContactValue` (NFC, trimmed, empty becomes
  unset) and `privacyContactProblem` (`packages/shared/src/privacy-contact.ts:15-35`), applied by the
  card's save route through `privacyContactRequest` (`apps/server/src/venue-privacy.ts:11-31`),
  which refuses with `venue.detail_invalid { field, reason }`.

## What this slice builds

1. **One checker** for a single privacy contact value, `privacyContactChecked`, in
   `packages/provisioning/src/privacy-contact.ts`, used by the card's save route (refactored onto it,
   behaviour unchanged) and by the import (decision 7).
2. **The export carries the values** in a new top-level key of the bundle,
   `privacyContact: { privacyNoticeUrl, privacyEmail }`, each a string or `null` (decisions 1 and 5).
3. **The import checks them** with the card's rule and the card's error code, at staging, before
   anything is kept on disk (decision 6).
4. **The import writes them** on the new box's taxpayer row, inside the setup transaction, when the
   new box keeps the export's tax ID; with New tax ID it leaves them unset (decisions 2 and 3).
5. **The setup screen explains a refusal** of either value in English and Spanish (decision 8).
6. **Docs**: the guide's Privacy section in both languages, the write-list guard's header, the
   conventions notes, the backlog and the overview.

Nothing else changes: no setup request field, no venue plan action, no first-setup state key, no
setup screen field, no reader of the stored values (that stays S1b's).

## What was run while writing this plan

Each probe says what the failing case would have printed.

1. **The claim refuses a venue key it does not list.** In this worktree a throwaway case was
   appended to `apps/server/src/setup-first-fiscal.route.test.ts`, reusing its `fixture()`
   (`:57-175`): abandon the fixture's claim, then claim again with `request` unchanged (control) and
   with `privacyEmail: "privacy@example.com"` added to the venue.
   `pnpm exec vitest run src/setup-first-fiscal.route.test.ts -t zzprobe` (in `apps/server`, with
   `AI_AGENT` and `CLAUDECODE` unset) printed `PROBE control 200 {"state":…}` and
   `PROBE privacyEmail 400 {"error":{"code":"setup.request_invalid","params":{"field":"body"}}}`,
   `Tests  2 passed | 37 skipped (39)`. Had the claim ignored unknown keys, the second line would
   have been a 200. The file was then restored with `git checkout` and `git status --short` printed
   nothing. The setup app copies the whole preview venue into its draft
   (`apps/setup/src/setup-app.ts:2112-2118`, removing only `location.id`) and sends the draft's venue
   in the claim (`:1179`, `:1210-1216`; `apps/setup/src/api/client.ts:606-617`), so a value placed in
   the bundle's `venue` would reach the claim and be refused. Decision 1 follows.
2. **The claim also refuses the location keys a real export's preview carries today.** Same file,
   same method: a venue whose `location` also held `fireControl: "waiter"` and `catalogueId: null`,
   two keys every real preview's location carries (`PreparedVenue`, `configuration-transfer.ts:56-57`,
   filled by `buildConfigurationBundle`'s `...rest`, `:114-133`). Printed: control `200`,
   `PROBE fireControl 400 {"error":{"code":"setup.request_invalid","params":{"field":"body"}}}`.
   File restored, `git status --short` empty. Read, not run: nothing in `apps/setup/src` names
   `fireControl` or `catalogueId` (`git grep` printed nothing), and the venue screen's patch is
   merged INTO the draft, which keeps keys the patch does not name (`deepMerge`,
   `apps/setup/src/setup-app.ts:123-131`; the venue screen's patch, `screens/venue-screen.ts:630-653`).
   So, by reading, a Live setup from a real export through the setup app is refused at the claim
   today, before this slice. That is a separate defect; decision 12 says what this slice does
   about it. `git log -S` dates all three parts before this branch: the claim's location list and
   `PreparedVenue.location`'s `fireControl` to `4e318802f` (#1752), the preview spread to
   `fabdb224d` (#296).
3. **The format moved only when an older file could not import correctly.**
   `git log -S"version: 8"` on `configuration-transfer.ts` printed only `251e256a4` (A756 PR 8,
   which dropped `service_settings`); `docs/developers/conventions-data.md:1622-1645` lists every
   bump from format 3 to 8, and each one dropped or replaced a table, because an older file still
   naming it would be refused generically. Decision 4 follows.

Read, not run: everything else cited by `file:line` below, on this tree.

## Decisions this plan makes that the spec does not

1. **The values travel in a new top-level key, `privacyContact`, not inside `venue`.** The
   bundle's `venue` doubles as the setup preview's venue, which the setup app sends back in the
   claim, and the claim refuses any key it does not list (probe 1). A top-level key never reaches
   the preview, which is built from `bundle.venue`, `counts` and `reconnect` alone
   (`configuration-import.ts:86`), so the claim, its key list and the setup app's types do not change.
   The alternative, putting the keys in `venue` and stripping them from the preview, keeps two
   copies of one rule apart.
   - Interface, in `configuration-transfer.ts`:

     ```ts
     export interface ConfigurationBundle {
       version: 8;
       createdAt: string;
       sourceOperatorId: string;
       venue: PreparedVenue;
       /** Absent only in a file exported before A980 S1a2. */
       privacyContact?: PrivacyContact;
       modules: Record<string, number>;
       tables: Record<string, Array<Record<string, unknown>>>;
       reconnect: string[];
     }
     ```

     `PrivacyContact` is the type `packages/provisioning/src/privacy-contact.ts:4-7` already exports.
   - The export's query (`:86-104`) gains `t.privacy_notice_url as "privacyNoticeUrl"` and
     `t.privacy_email as "privacyEmail"`, and the destructuring at `:114-124` must take both out of
     the row: anything left there lands in `location` through `...rest` (`:129-133`) and so in the
     preview, which probe 1 shows the claim refuses. Task 2's export case checks that neither key
     appears in `venue` or `venue.location`.

2. **The import writes the values, inside the setup transaction; the setup request does not carry
   them.** The taxpayer row is created from the setup request (`venue-apply.ts:167-193`), and the
   import already runs in that same transaction once the row exists (`venue-apply.ts:486-487`, called
   with the import from `boot.ts:1382-1390` and `first-setup-command-deployment.ts:328-336`). So a
   write at the end of `importConfigurationTables`, through `savePrivacyContact`, reaches both setup
   paths with one change and rolls back with the rest of the venue if anything later fails. Carrying
   the values in the request instead, as the overview guessed, would change the claim's key list
   (`setup-first-fiscal-api.ts:413-423`), `parseVenue` (`apps/server/src/setup-api.ts:415-516`),
   `VenueRequest` and `planVenue` (`packages/provisioning/src/venue-plan.ts`), the frozen request's
   key list (`packages/provisioning/src/first-setup-state.ts:233-255`), `venue-apply.ts`'s insert and
   the setup app's `ProvisionBody`, and would hand the browser a value it never shows. **So
   `setup-api.ts`, `venue-plan.ts`, `venue-apply.ts` and `first-setup-state.ts`, named by the
   overview's row as a starting guess, do not change.**
   - `configuration-transfer.ts` calls `savePrivacyContact`; it does not write `tenants` itself. The
     write-list guard judges the file whose text holds the write (`scripts/write-path-tables.test.ts:15-17`,
     `:27-28`), and that stays `privacy-contact.ts`, already on the list
     (`scripts/write-path-tables.json`). The import reads the row's country and tax ID with a plain
     `select`, which the guard does not count as a write (its detector, `write-path-tables.test.ts:77-110`).

3. **With New tax ID the values are not carried.** The privacy contact belongs to the business that
   publishes the notice, the controller, and with New tax ID that business changes. The import tells
   the two cases apart without a new parameter: it reads the new taxpayer row and carries the values
   only when its country and tax ID equal the bundle's, compared trimmed and in capitals as
   `venue-apply.ts:187-189` compares. Both callers already refuse a Same tax ID import whose tax ID
   differs from the export's and a New tax ID import whose tax ID equals it (`boot.ts:1354-1363`,
   `first-setup-command-deployment.ts:79-86`, and at the claim `boot.ts:897-909`), so on both paths
   the row's tax ID equals the export's exactly when the person chose Same tax ID. The alternative, a
   `newTaxpayer` flag on `importConfigurationTables`'s target, would change every call: `git grep -c "importConfigurationTables("`
   over `packages` and `apps` counted 110 lines besides the definition, 94 of them in
   `apps/server/src/configuration-transfer.test.ts`. Owner decision A.

4. **The format stays 8, and a format-8 file without `privacyContact` imports with both values
   unset.** Probe 3: every earlier bump was made because an older file could no longer import
   correctly. Here an older file imports exactly as it would have before this slice, carrying
   nothing. Such a file can exist only for exports made on `main` between S1a (#2106) and this slice:
   an export from before S1a's migration is refused already, because its `core` version is one lower
   than the box's (`validateConfigurationBundle`, `configuration-transfer.ts:596-600`; the core
   version is the count of applied core migrations, `packages/migrations/src/schema-version.ts:51-64`;
   `apps/server/src/configuration-import.test.ts:924-946` refuses an earlier core version as
   `module:core`). **The pre-production rule** (home CLAUDE.md §3, "No backwards-compatibility or
   data-migration code until Waitron is in production") would allow refusing those files instead,
   by moving to format 9. This plan keeps the one `undefined` branch because the brief requires an
   older bundle to import, and because it converts nothing: absent means what that file meant. Owner
   decision C. The reverse direction is not handled: a box running S1a without S1a2 reads a new
   file's `privacyContact` as an unknown key and ignores it, as the parse checks only the fields it
   names (`configuration-transfer.ts:476-538`); its core version matches, since this slice adds no
   migration, so such an import succeeds without the values. Before go-live a box can be reset.

5. **An unset value travels as `null`, and both keys are always present in a new export.** That is
   the bundle's convention for an optional taxpayer field: `taxpayerDomicile` is exported as
   `null` when unset (`configuration-export-api.test.ts:109`) and a missing one is refused
   (`configuration-transfer.ts:527`), as are the location's nullable fields (`:532-534`). So the parse
   refuses a `privacyContact` that is present but is not an object, lacks either key, or holds
   anything but a string or `null` in either, as `setup.request_invalid { field: "artifact" }`, the
   answer every other malformed field of the bundle gets (`:506`, `:536`). Like the venue check, it
   checks only the keys it names and ignores any other key inside `privacyContact`
   (`apps/server/src/configuration-transfer.test.ts:480-488` pins that leniency for `venue`).

6. **A value the card's rule refuses makes the whole import refuse, at staging, with the card's
   own code.** `validateConfigurationBundle` (`configuration-transfer.ts:587-611`) gains the check;
   it runs at staging, before anything is written to disk (`boot.ts:1279-1287`; the owned setup's
   own staging in tests: `first-setup-command-import.test.ts:120-130`), again before the owned
   setup's venue transaction (`first-setup-command-deployment.ts:94`), and first thing in the import
   (`configuration-transfer.ts:621`). Each string goes through `privacyContactChecked` (decision 7):
   `venue.detail_invalid { field: "privacyNoticeUrl" | "privacyEmail", reason: "web_address" |
   "email" | "length" }`, the web page first, as the card's route checks
   (`PRIVACY_CONTACT_FIELDS` order, `venue-privacy.ts:21`). `null`, `""` and a value of spaces are
   unset, as on the card. The value stored is `privacyContactValue`'s, NFC and trimmed. No refusal
   carries the value (S1a decision 11): the setup boundary logs `params` only
   (`packages/server-kit/src/error-boundary.ts:41-46`). The status is 400, the boundary's default for
   an unlisted code (`error-boundary.ts:42`, stated at `setup-api.ts:242-244`), so
   `PROVISION_STATUS` does not change. The alternative, dropping a refused value and importing the
   rest, is set aside because the owner asked for the card's checks; how such a file can arise is in
   owner decision B. A value the card accepts but that is not the export's own (a hand-edited file
   with a different, valid address) is imported as written; the passphrase is the file's only
   protection, as it is for every other field.

7. **One checker, in `@waitron/provisioning`, for the route and the import.**

   ```ts
   /** One privacy contact value as the Privacy card's save takes it: NFC and trimmed, empty is
    * null; a value the shared rule refuses throws `venue.detail_invalid { field, reason }`. */
   export function privacyContactChecked(field: PrivacyContactField, raw: string): string | null;
   ```

   It lives in `packages/provisioning/src/privacy-contact.ts`, beside the reader and writer the two
   callers already use, and `privacyContactRequest`'s loop (`venue-privacy.ts:21-28`) calls it after
   its own type check. The route's suite, `apps/server/src/venue-privacy-api.test.ts`, passes
   unedited, which is the receipt that the route's answers did not change. `venue.detail_invalid` is
   declared only in `apps/server/src/errors.ts:60` today; `packages/provisioning/src/errors.ts` gains
   the same declaration, `{ field: string; reason: string }`, because every throwing file imports its
   own package's registry (home CLAUDE.md §3; `apps/server/src/errors.ts:21-24`). A code declared in
   two registries has precedents: a scan of every `packages/*/src/errors.ts` and `apps/*/src/errors.ts`
   for keys declared in more than one printed 16, `management_session.required` among them. `savePrivacyContact`
   keeps its stated contract (it throws no code of its own, `privacy-contact.ts:18-24`).

8. **No new setup screen field or row; the setup screen explains a refusal; the guide says the values
   come across.** The values are applied as carried and are edited afterwards on the Privacy card;
   the preview screen does not list them (it lists copied tables, `counts`, which the privacy
   contact is not). Without a message of its own, `venue.detail_invalid` would fall through to
   "The configuration export could not be opened. Check the file and passphrase."
   (`describeConfigurationRefusal`, `apps/setup/src/setup-app.ts:412-428`), which names the wrong
   cause. So the setup app gains two sentences, one per field, built like the duplicate-name ones
   (`apps/setup/src/i18n/strings/shell.ts:143-146`, `:296-299`), telling the person what is wrong and
   that they can correct it on the Privacy card of the box they exported from, export again and load
   the new file (home CLAUDE.md §3, a refusal names a self-service next step). Owner decision D.

9. **The guide's Data protection record of processing does not change.** Its "Backups and the
   configuration export" entry (`apps/server/src/guide/en/data-protection.md:339-363`) and the
   "leaked configuration export" paragraph (`:487-492`) list the PEOPLE's data an export holds; the
   privacy contact is the venue's published contact, which its notices show to anyone. The
   alternative is a clause naming it in both places, in both languages.

10. **The guide sentence is replaced, not just deleted.** The S1a section's sentence "A
    configuration export does not carry them, so after you set up a new box from one, enter them
    again." (`data-protection.md:164-165`; Spanish `es/data-protection.md:171-172`) becomes a
    sentence saying the export carries them with Same tax ID and not with New tax ID (Task 6 gives
    the text). The section's last sentence, "nothing else on the box shows them", stays: it is S1b's
    to rewrite.

11. **No log line, and no value in an error** (S1a decision 11, unchanged): the import logs nothing
    of its own and its refusal carries `field` and `reason` only.

12. **The claim refusing a real preview's location keys (probe 2) is not fixed here.** It predates
    this branch, it is in the setup app and the claim, which this slice does not otherwise touch,
    and S1a2's values do not travel through either (decision 1). Task 0 step 6 settles it with a
    browser run; if it reproduces, the driver files it as its own backlog item, tells the owner in
    the FYI for this plan, and this slice goes ahead. If the owner wants it fixed first, it becomes
    the slice before S1a2. Either way S1a2's own end-to-end checks drive the server routes directly
    (Tasks 3 and 4), so they do not depend on it.

## Open decisions for the owner (FYI, built with the default)

- **A. With New tax ID the privacy contact stays behind** (decision 3). Worked example: Bar Ejemplo
  (B12345678) has `https://barejemplo.es/privacidad` and `privacidad@barejemplo.es` saved. Its new
  owner sets up a box from Bar Ejemplo's export and chooses **New tax ID**, B87654321. The menus and
  staff come across; the new box's Privacy card says "Not set" for both, because the old address
  publishes the old business's notice. With **Same tax ID** the same file sets both. Alternative:
  carry them in both cases, so the new owner starts from the old business's address and must
  remember to change it.
- **B. A value the card would refuse stops the whole import** (decision 6). Worked example: someone
  decrypts an export, edits the email to `privacidad@barejemplo` and encrypts it again; the setup
  screen refuses the upload with "This export's privacy email is not an address Waitron accepts. On
  the box you exported from, correct it on the Privacy card in Venue settings, export again, then
  load the new export." Nothing is staged. An export Waitron wrote can only hit this if the rule
  becomes stricter after the export was made, since the card refuses the same values on save. If the
  box it came from is gone, that file cannot be imported. Alternative: import the rest and leave the
  refused value unset, telling the person which one.
- **C. The format stays 8; a file exported between S1a and S1a2 imports without the two values**
  (decision 4). Worked example: a manager downloaded an export this afternoon, on a box running S1a.
  After S1a2 lands, a new box set up from it shows "Not set" for both, as that file never carried
  them. Alternative: move to format 9 and refuse such files as "from an older format", as earlier
  format changes did.
- **D. Setup does not show the two values** (decision 8). Worked example: setting up from Bar
  Ejemplo's export, the review screen lists menus, staff and hardware to reconnect, not the privacy
  address; after setup the Privacy card shows both. Alternative: a line on the review screen saying
  the privacy page and email will be copied.

## Global constraints

- **TDD.** Each task writes its failing test first, runs it and watches it fail for the reason
  named, then writes the code.
- **English only** in code, identifiers, comments, fixtures and tests. Spanish only in
  `apps/setup/src/i18n/strings/shell.ts`'s Spanish half and `apps/server/src/guide/es/data-protection.md`.
  A test of Spanish text reads the expected sentence as the setup app's existing cases do, by
  locale (`apps/setup/src/setup-app.test.ts:3053-3094`). Fixture values: `https://example.com/privacy`
  and `privacy@example.com`.
- **Every database test uses `useVenueDb`.** Every refusal asserts the domain error code and its
  exact params. Exact shapes use `toEqual` or `toBe`; `toMatchObject` only where the file's own
  siblings already use it for the same assertion.
- **Fixtures use values the two sides could treat differently**: a value with surrounding spaces (a
  path that skips `privacyContactValue` stores them); an email with a decomposed accent, written as
  the escapes `"josé@example.com"` and expected as `"josé@example.com"`; a taxpayer row
  that differs from the export's (a write that ignores decision 3 fills it).
- **Nothing else in the taxpayer row changes**: each import test compares the whole row with
  `{ ...before, <the changed columns> }`.
- **Coverage**: `@waitron/provisioning`, `@waitron/server` and `@waitron/setup` hold 98/98/98/95.
  `@waitron/provisioning`'s coverage counts its own tests only (`packages/provisioning/vitest.config.ts:15-21`),
  so every new branch there needs a provisioning test, not only a server one. No exclude or ignore
  comment. None of the three is mutation-tested (home CLAUDE.md §2 lists `ui`, `ui-core`, `shared`,
  `fiscal` and `db`); `@waitron/shared` is not touched.
- **Existing assertions that change on purpose**, each named in the pull request:
  `apps/server/src/boot.setup-routes.test.ts:1627-1638` (the new-taxpayer case's taxpayer row gains
  `privacy_notice_url: null, privacy_email: null`), `apps/server/src/guide-content.test.ts` only if a
  section id changes (none is expected to). Lists that only grow: `packages/provisioning/src/index.ts`
  (one export), `packages/provisioning/src/errors.ts` (one code), the malformed-bundle table in
  `packages/provisioning/src/configuration-transfer.boundaries.test.ts:48-81`. The shared fixture
  `packages/provisioning/test/configuration-bundle.ts` gains `privacyContact`; every provisioning file
  that imports it must pass unchanged (Task 2 step 5 lists them). No other existing assertion is
  expected to change; if one does, stop and say why in the handover.
- **No new test file in `apps/server`**: its shards are packed by the committed duration table
  (home CLAUDE.md §2), so new server cases go into the existing files named below.
- **Greps** use the pathspec `'packages/*/src/**' 'apps/*/src/**'` (add `'scripts/**'` where guards
  matter); the shell's `grep` is ugrep, so call `/usr/bin/grep` where an exit status decides
  anything.
- Commits `git commit -s`; `pnpm format:check` before each commit.
- An implementer that passes about 150 tool calls with its task unfinished stops at a passing or
  cleanly failing point, commits, and hands over: what is done, what is left, the files, each check's
  state.
- Browser suites (`@waitron/setup`): check `memory_pressure | grep free` first; run beside another
  session only well above 15% free.
- Under an AI agent Vitest hides a passing test's console output; read each run's `Tests` line.

## Review focus

- **The preview stays as it is** (decision 1): no privacy key in `venue` or `venue.location`, so the
  claim is unaffected; `configuration-import.test.ts:35-40` (provisioning) still pins the preview as
  `{ venue, counts, reconnect }`.
- **The check is the card's** (decisions 6 and 7): one function on both paths; the route's suite
  unedited and green; refusals at staging leave staged files untouched; no value in a refusal.
- **Same or new taxpayer** (decision 3): the comparison, its normalisation, and the two callers'
  existing refusals that make it equal to the person's choice.
- **The write** (decision 2): through `savePrivacyContact` only; only the two columns; inside the
  venue transaction, so a later refusal rolls it back (Task 3's rollback case).
- **Older and malformed files** (decisions 4 and 5): absent imports as unset; present-but-wrong is
  `artifact`.
- **Docs**: every guide sentence against the code (Task 6's table), both languages; the backlog and
  overview no longer say the export leaves the values behind (`git grep -n -i "does not carry them\|no los incluye"` afterwards).
- **Codex run-it seat**: two reviews, the second told to set this plan aside.

## Task 0: re-check before dispatching (the driver, not an implementer)

Run on the branch's then-current tip and compare with this plan. If anything differs, fix the plan
before Task 1.

1. `git grep -n "version: 8" -- 'packages/*/src/**' 'packages/*/test/**' 'apps/*/src/**'`: expected,
   `configuration-transfer.ts:136` and `:169`, and the three test literals
   (`apps/server/src/configuration-import.test.ts:49`, `apps/server/src/configuration-transfer.test.ts:402`,
   `packages/provisioning/test/configuration-bundle.ts:5`). Another hit means the format moved: re-read
   decision 4.
2. `git grep -n "importConfigurationTables(" -- 'packages/*/src/**' 'apps/*/src/**' | /usr/bin/grep -v "\.test\.ts"`:
   expected, the definition and the two callers of decision 2 (`boot.ts`, `first-setup-command-deployment.ts`).
3. `git grep -n "privacy" -- packages/provisioning/src/configuration-transfer.ts packages/provisioning/src/configuration-import.ts`:
   expected, nothing.
4. `cat scripts/write-path-tables.json`: expected, `tenants` lists `taxpayer-name.ts`, `venue-apply.ts`
   and `privacy-contact.ts`.
5. At the end of the branch, before `/finish-branch`: `git diff --stat main...HEAD -- packages/db`
   prints nothing (no migration, no schema change).
6. **Probe 2 in the browser.** In a throwaway copy of the setup-app case "stages a preparation export
   and prefills the live venue draft" (`apps/setup/src/setup-app.test.ts:585-630`), give the stubbed
   preview's location `fireControl: "waiter"` and `catalogueId: null` and print
   `assembleBody(readDraft(el)).venue.location` after the venue screen advances. If it still holds
   `fireControl`, decision 12's defect is real: file it as its own backlog item (an item number from
   `~/waitron-campaign-shared/next-item-number`) and name it in the FYI. Delete the throwaway case.

## Task 1: one checker for a privacy contact value

Files: `packages/provisioning/src/privacy-contact.ts` (add `privacyContactChecked`; import
`"./errors.js"`), `packages/provisioning/src/errors.ts` (declare `venue.detail_invalid`),
`packages/provisioning/src/index.ts` (export it), `packages/provisioning/src/privacy-contact.test.ts`
(new), `apps/server/src/venue-privacy.ts` (call it).

Interface: decision 7.

1. Tests first, in the new `privacy-contact.test.ts` (pure, no database), two `it.each` tables:
   - accepted (field, raw → value), 5 rows: `privacyNoticeUrl`, `"  https://example.com/privacy  "` →
     `"https://example.com/privacy"`; `privacyNoticeUrl`, `"HTTPS://EXAMPLE.COM/Privacy"` → the same
     text; `privacyNoticeUrl`, `""` → `null`; `privacyEmail`, `"   "` → `null`; `privacyEmail`,
     `"josé@example.com"` → `"josé@example.com"`.
   - refused (field, raw → reason), 5 rows: `privacyNoticeUrl`, `"example.com/privacy"` → `web_address`;
     `privacyNoticeUrl`, `"https://user:pw@example.com/p"` → `web_address`; `privacyNoticeUrl`,
     `"https://example.com/" + "a".repeat(481)` → `length`; `privacyEmail`, `"privacy@example"` →
     `email`; `privacyEmail`, `"a@" + "b".repeat(250) + ".es"` → `length`. Each row catches the error
     and asserts `code` is `venue.detail_invalid` and `params` `toEqual` `{ field, reason }` exactly
     (so a value leaking into the params fails).
   Run `pnpm --filter @waitron/provisioning exec vitest run src/privacy-contact.test.ts`; watch it
   fail (no export).
2. Write `privacyContactChecked`, the registry line and the export. Expected `Tests  10 passed (10)`.
3. Refactor `privacyContactRequest` (`venue-privacy.ts:21-28`) to keep its `typeof raw !== "string"`
   refusal and then set `changes[field] = privacyContactChecked(field, raw)`. Run, unedited,
   `pnpm --filter @waitron/server exec vitest run src/venue-privacy-api.test.ts`: write down its
   `Tests` count before the refactor and expect the same count, nothing failed, after.
4. Omission controls, each run and reverted: skip NFC in `privacyContactChecked` (the accent row
   fails); return the untrimmed text (the spaces row fails); throw with `{ field, reason, value }`
   (every refused row fails on the exact params).
5. `pnpm --filter @waitron/provisioning typecheck`, `pnpm --filter @waitron/server typecheck`; at the
   root `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/personal-log-params.test.ts`.

## Task 2: the export carries the values, and the parse and check read them

Files: `packages/provisioning/src/configuration-transfer.ts` (the type, the query and its
destructuring, the parse, `validateConfigurationBundle`), `packages/provisioning/test/configuration-bundle.ts`
(the fixture gains `privacyContact: { privacyNoticeUrl: "https://example.com/privacy", privacyEmail: "privacy@example.com" }`),
`packages/provisioning/src/configuration-transfer.boundaries.test.ts` (four rows),
`packages/provisioning/src/configuration-transfer.privacy-contact.test.ts` (new).

1. Tests first.
   - In the new file (`useVenueDb` with `migrationOptionsFor(manifestSets(), null)`; a source venue
     made as `first-setup-command-import.test.ts:81-106` makes one, with `applyHistoricalTestVenue`
     from `../test/allocated-venue.js` and `request` from `../test/first-setup-request.js`), 8 cases:
     1. with `savePrivacyContact` having stored both values, `buildConfigurationBundle` answers
        `privacyContact` equal to them, and neither `bundle.venue` nor `bundle.venue.location` has a
        `privacyNoticeUrl` or `privacyEmail` property (decision 1);
     2. with nothing stored, `privacyContact` is `{ privacyNoticeUrl: null, privacyEmail: null }`;
     3. `decodeConfigurationBundle(encodeConfigurationBundle(f))` equals `f` for the shared fixture
        (which now carries values);
     4. the same round trip for the fixture with `privacyContact` deleted equals that object, with no
        `privacyContact` key added (an older file, decision 4);
     5. `validateConfigurationBundle` (modules `[]`, versions `{}`, the fixture's `modules: {}` and
        `tables: {}`) accepts `privacyContact` `{ privacyNoticeUrl: "", privacyEmail: null }` and
        `{ privacyNoticeUrl: "   ", privacyEmail: "privacy@example.com" }` (one `it.each`, 2 rows);
     6. it refuses, one `it.each` of 3 rows each asserting the error's `code` and exact `params`:
        `privacyNoticeUrl: "example.com/privacy"` → `{ field: "privacyNoticeUrl", reason: "web_address" }`;
        `privacyEmail: "privacy@example"` → `{ field: "privacyEmail", reason: "email" }`; both of
        those at once → the web page's refusal (field order).
     Count: 1 + 1 + 1 + 1 + 2 + 3 = 9; expected `Tests  9 passed (9)` once green.
   - In `configuration-transfer.boundaries.test.ts`'s malformed table (`:48-81`), 4 rows, each
     `field: "artifact"`: `privacyContact: "x"`; `privacyContact: []`;
     `privacyContact: { privacyNoticeUrl: null }` (the email key missing);
     `privacyContact: { privacyNoticeUrl: 5, privacyEmail: null }`.
   Run `pnpm --filter @waitron/provisioning exec vitest run src/configuration-transfer.privacy-contact.test.ts src/configuration-transfer.boundaries.test.ts`;
   watch them fail.
2. Write the change (decisions 1, 4, 5 and 6): the query's two columns, taken out of the row before
   `...rest`; `privacyContact` in the returned bundle; the parse's shape check after the venue check
   (`:525-537`), absent allowed; the rule in `validateConfigurationBundle` after the module checks,
   for each `PRIVACY_CONTACT_FIELDS` field whose value is a string, through `privacyContactChecked`.
3. Run the two files again: the new file `Tests  9 passed (9)`, the boundaries file its previous
   count plus 4.
4. Omission controls, each run and reverted: leave the two columns in the row before `...rest` (case
   1 fails on `venue.location`); refuse an absent `privacyContact` (case 4 fails); skip the
   rule in `validateConfigurationBundle` (case 6 fails); accept `undefined` for a key (the
   missing-key boundaries row fails).
5. Every provisioning file that imports the shared fixture passes unchanged:
   `git grep -l "test/configuration-bundle" -- packages/provisioning/src` (on this tree:
   `configuration-import.test.ts`, `configuration-transfer.boundaries.test.ts`,
   `configuration-transfer.security.test.ts`, and any other it prints), each run, each `Tests` line
   read. `configuration-import.test.ts:35-40` pins the preview as `{ venue, counts, reconnect }`; with
   the fixture now carrying values it is the check that the preview leaves them out.
6. `pnpm --filter @waitron/provisioning typecheck` and `pnpm --filter @waitron/server typecheck`
   (the server's test literals at `configuration-import.test.ts:48` and `configuration-transfer.test.ts:401`
   stay without the key, as older files, and must still typecheck).

## Task 3: the import writes the values, for the same taxpayer only

Files: `packages/provisioning/src/configuration-transfer.ts` (`importConfigurationTables`),
`packages/provisioning/src/configuration-transfer.privacy-contact.test.ts` (5 more cases),
`packages/provisioning/src/first-setup-command-import.test.ts` (its fixture and one assertion).

1. Tests first.
   - In the new file, a target venue made with `applyVenue(planVenue(...))` for country `GB`, tax ID
     `123456789` (the fixture's taxpayer), as `configuration-transfer.boundaries.test.ts:265-281`
     makes one, on a second `useVenueDb`; imports run with modules `[]` and versions `{}` inside
     `withTransaction`. 5 cases:
     1. same taxpayer: after the import the whole taxpayer row equals
        `{ ...before, privacyNoticeUrl: "https://example.com/privacy", privacyEmail: "privacy@example.com" }`;
     2. same taxpayer, the bundle's values written as `"  https://example.com/privacy  "` and
        `"josé@example.com"`: stored `"https://example.com/privacy"` and `"josé@example.com"`;
     3. a different taxpayer (the bundle's `venue.taxId` set to `"987654321"`): the row equals
        `before`;
     4. no `privacyContact` in the bundle: the row equals `before`;
     5. an invalid email in the bundle: the transaction rejects with
        `venue.detail_invalid { field: "privacyEmail", reason: "email" }` and, read after it, the row
        equals `before`.
     Expected for the file once green: `Tests  14 passed (14)`.
   - In `first-setup-command-import.test.ts`, the fixture's source transaction (`:96-106`) also calls
     `savePrivacyContact(tx, { privacyNoticeUrl: "https://example.com/privacy", privacyEmail: "privacy@example.com" })`,
     and the case at `:173-210` also expects
     `select privacy_notice_url as privacyNoticeUrl, privacy_email as privacyEmail from tenants` to
     equal one row: both `null` when `newTaxpayer`, the two values otherwise.
   Run `pnpm --filter @waitron/provisioning exec vitest run src/configuration-transfer.privacy-contact.test.ts src/first-setup-command-import.test.ts`;
   watch the new cases and the `false` row fail.
2. Write it (decisions 2 and 3): after `applyPreparedLocation` (`:764-770`) and before the modules'
   `afterImport` (`:771-774`), when `bundle.privacyContact` is present, read the taxpayer row's
   `country` and `taxId` (`id = 1`); when they equal the bundle's, trimmed and in capitals, call
   `savePrivacyContact` with each field's `privacyContactChecked` value (a `null` stays `null`).
3. Run both files again: `Tests  14 passed (14)` and the command file's previous count, nothing
   failed.
4. Omission controls, each run and reverted: write whatever the taxpayer (case 3 and the command
   file's `true` row fail); skip the write (cases 1 and 2 and the command file's `false` row fail);
   write the bundle's raw strings (case 2 fails).
5. `pnpm --filter @waitron/provisioning typecheck`; at the root `pnpm exec vitest run scripts/write-path-tables.test.ts`
   (expected all pass: the import calls the listed writer and holds no write of its own).

## Task 4: the server's setup routes, end to end

Files: `apps/server/src/boot.setup-routes.test.ts`, `apps/server/src/configuration-import.test.ts`,
`apps/server/src/configuration-export-api.test.ts`, `scripts/write-path-tables.test.ts` (header list
only), `docs/developers/conventions-data.md` (`:897-905`). No server source file changes in this task.

1. Tests first (each passes or fails only once Tasks 2 and 3 are in, so write them, run them on the
   Task 3 commit and expect them green; then run the control in step 3 to see each fail):
   - `boot.setup-routes.test.ts:1444` ("stages a prepared configuration and imports it into the
     venue a live provision mints"): after `provisionVenue` on the source, store both values with
     `savePrivacyContact`; after the boot ends, `select privacy_notice_url, privacy_email from tenants`
     on the target equals the two values.
   - `boot.setup-routes.test.ts:1549` (the new-taxpayer case): the source stores both values too, and
     the taxpayer row assertion at `:1627-1638` gains `privacy_notice_url: null, privacy_email: null`.
   - `configuration-import.test.ts`, a new `it.each` modelled on `:315-371`, 2 rows: an otherwise
     current bundle whose `privacyContact` holds `privacyNoticeUrl: "example.com/privacy"` or
     `privacyEmail: "privacy@example"`; staged through `POST /setup-api/configuration` with the
     file's `validate`; expected 400 `{ error: { code: "venue.detail_invalid", params: { field, reason } } }`
     and the three retained staging files unchanged.
   - `configuration-export-api.test.ts:95-111`: `decoded.privacyContact` equals
     `{ privacyNoticeUrl: null, privacyEmail: null }`.
2. Run `pnpm --filter @waitron/server exec vitest run src/boot.setup-routes.test.ts src/configuration-import.test.ts src/configuration-export-api.test.ts src/venue-privacy-api.test.ts`.
   Expected: each file's previous count, plus 2 for `configuration-import.test.ts`, nothing failed.
3. Control for both production callers: with the write of Task 3 step 2 commented out, the
   `boot.setup-routes.test.ts:1444` case fails (the setup provision route, `boot.ts:1382`) and so
   does the command file's `false` row (`first-setup-command-deployment.ts:328`). Restore it.
4. `scripts/write-path-tables.test.ts`'s header (`:49-51`): the `privacy-contact.ts` line also names
   "and a configuration import, inside setup's venue transaction". `conventions-data.md:901-905`:
   after "which updates `privacy_notice_url` and `privacy_email` alone", add "; a configuration
   import reaches the same writer for those two columns (A980 S1a2)". Run
   `pnpm exec vitest run scripts/write-path-tables.test.ts`.
5. `pnpm --filter @waitron/server typecheck`.

## Task 5: the setup screen explains a refused privacy value

Files: `apps/setup/src/setup-app.ts` (`describeConfigurationRefusal`, `:412-428`),
`apps/setup/src/i18n/strings/shell.ts` (two keys, English and Spanish),
`apps/setup/src/setup-app.test.ts` (beside `:3034-3094`).

Words (English / Spanish):

| Key | English | Spanish |
| --- | --- | --- |
| `shell.configuration.privacy_notice_url_invalid` | This export's privacy notice web page is not an address Waitron accepts. On the box you exported from, correct it on the Privacy card in Venue settings, export again, then load the new export. | La página web del aviso de privacidad de esta exportación no es una dirección que Waitron acepte. En el equipo del que exportaste, corrígela en la tarjeta Privacidad de Ajustes del local, vuelve a exportar y carga la nueva exportación. |
| `shell.configuration.privacy_email_invalid` | This export's privacy email is not an address Waitron accepts. On the box you exported from, correct it on the Privacy card in Venue settings, export again, then load the new export. | El correo de privacidad de esta exportación no es una dirección que Waitron acepte. En el equipo del que exportaste, corrígelo en la tarjeta Privacidad de Ajustes del local, vuelve a exportar y carga la nueva exportación. |

The card, page and tab names are the dashboard's own: `venue_settings.card.privacy` «Privacidad»,
`venue_settings.title` «Ajustes del local» (`apps/dashboard/src/i18n/strings.ts`, S1a plan Task 8's
table).

1. Tests first: one `it.each` of 4 rows (English and Spanish, each field), shaped like `:3053-3094`:
   `stageConfiguration` rejects `{ code: "venue.detail_invalid", params: { field, reason: "web_address" | "email" }, status: 400 }`;
   the live-source screen's bottom message is the sentence, the draft has no `configurationImport`,
   and no preview screen is shown. Add `["venue.detail_invalid", "legalName"]` to the "keeps other
   configuration refusals generic" table (`:3034-3051`), expecting the could-not-open sentence. Run
   `pnpm --filter @waitron/setup exec vitest run src/setup-app.test.ts -t "privacy|generic"`; watch
   the new rows fail.
2. Add the branch (the field selects the key; any other field keeps the generic sentence) and the
   strings. Expected: the new rows pass; then run the whole file and expect its previous count plus
   5, nothing failed.
3. Omission control: map both fields to one key (the email rows fail). Revert.
4. `pnpm --filter @waitron/setup typecheck`; at the root `pnpm exec vitest run scripts/english-only.test.ts`.

## Task 6: the guide, the backlog and the overview

Files: `apps/server/src/guide/en/data-protection.md`, `apps/server/src/guide/es/data-protection.md`,
`docs/backlog/data-protection.md`, `docs/backlog.md`, `docs/superpowers/plans/2026-10-24-a980-data-protection-build.md`,
`docs/superpowers/plans/2026-10-26-a980-s1a-notice-settings.md` (a dated pointer only),
`docs/developers/conventions-data.md` (the format history, `:1622-1645`).

1. The guide, `privacy-settings` section. Replace "A configuration export does not carry them, so
   after you set up a new box from one, enter them again." (`en/data-protection.md:164-165`) with:

   ```md
   A configuration export carries them, so a new box set up from one with **Same tax ID** shows
   them. With **New tax ID** the new box starts without them, because they belong to the business
   that published the notice: enter the new business's own here.
   ```

   and «Una exportación de la configuración no los incluye, así que, si preparas un equipo nuevo a
   partir de una, vuelve a escribirlos.» (`es/data-protection.md:171-172`) with:

   ```md
   Una exportación de la configuración los incluye, así que un equipo nuevo preparado a partir de
   ella con **Mismo NIF** los muestra. Con **NIF nuevo** el equipo empieza sin ellos, porque son del
   negocio que publicó el aviso: escribe aquí los del negocio nuevo.
   ```

   Each sentence's source, checked when written and again by the reviewer:

   | Sentence | Source |
   | --- | --- |
   | an export carries them | Task 2 case 1; `configuration-export-api.test.ts` (Task 4) |
   | a box set up with Same tax ID shows them | Task 3 case 1; Task 4's `boot.setup-routes.test.ts:1444` case; the command file's `false` row |
   | with New tax ID it starts without them | Task 3 case 3; Task 4's `:1549` case; the command file's `true` row |
   | the choice names | `apps/setup/src/i18n/strings/restore.ts:153`, `:155`, `:335`, `:337` |

   Then `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts`, at the root
   `pnpm exec vitest run scripts/guide-links.test.ts`, `pnpm exec prettier --file-info apps/server/src/guide/en/data-protection.md`
   to see whether the file is formatted or ignored, and `pnpm format:check`.
2. `docs/backlog/data-protection.md`: delete the **S1a2** point (`:231-244`), now finished, and in
   the **S1b** point (`:205-210`) drop "Waits for S1a2 (the export point below)." In
   `## Decisions and deliberate limits` (`:287`), under the A980 S1a entry's pattern, add an "A980
   S1a2" entry with owner decisions A to D and their defaults, one line each, and, if Task 0 step 6
   reproduced decision 12's defect, a pointer to its new item.
3. `docs/backlog.md:6137-6139`: the list of built slices gains "S1a2 (the configuration export
   carries the privacy contact)".
4. The overview: in the S1a paragraph (`:55-66`), "S1a does not, and S1a2, the next slice, adds it
   before S1b" becomes a dated line saying S1a2 is built (this plan's name; the top-level
   `privacyContact` key; format still 8; not carried with New tax ID). The **S1a2** row (`:103`)
   gains "Built: [plan](2026-10-26-a980-s1a2-export-privacy-contact.md); no migration (confirmed);
   the setup request, venue plan and first-setup state did not change (decision 2)."
5. The S1a plan's decision 10 (`2026-10-26-a980-s1a-notice-settings.md:351`): a dated line under it,
   "_2026-10-26: S1a2 carries them ([its plan](2026-10-26-a980-s1a2-export-privacy-contact.md))._"
   Not a rewrite: it records what was true when written.
6. `conventions-data.md`, at the end of the format history (`:1645`): "A980 S1a2 (2026-10-26) added
   the top-level `privacyContact` key without moving the format: a format-8 file without it imports
   with both values unset, because nothing an older file names is refused." Then
   `git grep -n -i "does not carry them\|no los incluye"` over `docs` and `apps`: expected, only the
   dated S1a plan (its decision 10, Task 8 and the open decision B, kept as history).

## Root guards to run before `/finish-branch`

`pnpm exec vitest run scripts/write-path-tables.test.ts scripts/errors-reachable.test.ts
scripts/personal-log-params.test.ts scripts/english-only.test.ts scripts/guide-links.test.ts
scripts/module-seams.test.ts scripts/workspace-cycles.test.ts scripts/claude-md-pointers.test.ts`,
each file's result read from its own lines. Then each task's focused runs, and, unedited,
`pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`.
CI runs the package suites and coverage (home CLAUDE.md §2); read its `changes` job's `packages`
output for `provisioning`, `server` and `setup` before calling the branch green.

## What this changes in the overview

- **The values do not travel through the setup request.** The overview's row guessed that
  `setup-api.ts`, `venue-plan.ts`, `venue-apply.ts` and `first-setup-state.ts` change; they do not
  (decision 2), and the claim's strict key list is why the bundle keeps them out of `venue`
  (decision 1, probe 1).
- **No migration**, confirmed (Task 0 step 5).
- **A new taxpayer does not inherit them** (decision 3), a choice the overview did not raise.
- **A likely defect on the same path** (probe 2, decision 12): a real export's preview location
  carries keys the claim refuses.
