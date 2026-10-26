# A980 slice S1a2: a configuration export carries the venue's privacy notice page and privacy email

**Status: plan, 2026-10-26, the fresh plan review folded in (1 Critical, 5 Important, 8 Minor,
`~/waitron-campaign-b/a980-s1a2-plan-review.md`) under the driver's rulings of the same day, then
its round-3 check (0 Critical, 2 Important, 7 Minor, `~/waitron-campaign-b/a980-s1a2-plan-round3.md`).
Nothing was built when this was written.** Branch `feat/a980-s1a2-export-privacy-contact`, from `main` at
`27ae35c09` (S1a landed there as #2106). Owner decision: answer **B** to the S1a plan ("OWNER ANSWER
— A980 S1a plan defaults A–F", lane B's questions file, `:358-363`): a configuration export carries
the privacy notice address and the privacy email, so "a new box set up from Bar Ejemplo's export
shows both values, not 'Not set'"; the import checks them exactly as the Privacy card's save does;
the guide's "a configuration export does not carry them" sentence goes, in English and Spanish.
Design: [A980 data protection, revision 2](../specs/2026-10-22-a980-data-protection-design.md) (its
notes at `:679` and `:709` already name S1a2). Overview: [the build plan](2026-10-24-a980-data-protection-build.md),
row **S1a2** (`:103`) and build order step 4 (`:208`). Previous slice:
[the S1a plan](2026-10-26-a980-s1a-notice-settings.md), whose shape this plan copies.

**Built, 2026-10-26**, on this branch, Tasks 1 to 8. Two of the plan's statements below proved
wrong while building; they stand as written, corrected here:

- _2026-10-26: Task 4 step 5's last omission control predicted wrongly._ Leaving the parse at
  `!== 8` does not fail the too-new rows, because the `> 9` line before it still refuses format 10
  as `setup.request_invalid` on `version`. Moving that line to `> 10` does fail the too-new row of
  `packages/provisioning/src/configuration-transfer.boundaries.test.ts`.
- _2026-10-26: Task 6 step 3's map of which test reaches which import site was wrong._ The e2e rows
  and both `boot.setup-routes.test.ts` cases all reach `apps/server/src/boot.ts:1383`: the server's
  owned setup goes `setup-first-fiscal-api.ts:282` → `first-fiscal-activation.ts:129` → the
  `provision` from `boot.ts:1342`, the same one the development route calls.
  `packages/provisioning/src/first-setup-command-deployment.ts:328` is the `waitron-provision`
  command's, covered by Task 5's command rows in `first-setup-command-import.test.ts`.
- _2026-10-26: Task 8 step 2's last clause was false._ "The tests that imported an export all went
  through the development route or called the owner runtime directly": on `27ae35c09`,
  `apps/server/src/first-fiscal-setup.e2e.test.ts`'s owned Live setup rows ran under `WAITRON_ENV`
  `production`, staged an export and posted the claim with `configurationImport: true`, but sent a
  venue built from the test's own `request`, never the preview's. `conventions-data.md` says that
  instead.

**This branch also fixes an earlier defect (Task 1): no production box can be set up from a
configuration export today.** The setup app copies two location keys from every real export's
preview into the first-setup claim, and the claim refuses them (probes 1 to 3). It began with
`4e318802f` (#1752, 2026-10-20), which `git merge-base --is-ancestor 4e318802f HEAD` confirms is
on this branch's base; the setup app's copy dates from `fabdb224d` (#296). It is fixed here because
the slice's outcome, a new box showing both values, cannot be seen on a production box without it.

**No migration.** The two columns exist (`packages/db/src/schema/tenants.ts:47-48`, added by S1a's
`packages/db/drizzle/0192_privacy_contact.sql`). Task 0 step 4 checks that the branch's diff touches
no `packages/db` file.

**FULL review**: a cross-package contract changes, the bundle that `@waitron/provisioning` writes
and reads, which the server stages and imports and the setup app previews and sends back. Per-task
reviews run, then `/finish-branch`, which runs two Codex reviews, the second told to set this plan
aside and test what it does not name. **Not fiscal**: nothing an invoice prints or files changes, no
fiscal table is touched, and the golden huella test (`packages/fiscal-verifactu/src/write-path.e2e.test.ts`)
and `packages/fiscal-verifactu/src/inmutabilidad.test.ts` must pass **unedited**.

## Words used here

- The **configuration export** is the encrypted file a manager downloads from the dashboard
  (`POST /management-api/configuration-export`, `apps/server/src/configuration-export-api.ts:35-62`).
  Inside it is one JSON document, the **bundle** (`ConfigurationBundle`,
  `packages/provisioning/src/configuration-transfer.ts:168-176`), written by
  `buildConfigurationBundle` (`:64-152`). It carries a **format** number, `version: 8` today
  (`:136`); this slice moves it to 9.
- **Staging** is the setup screen's upload: `POST /setup-api/configuration`
  (`apps/server/src/setup-api.ts:1477-1503`) decodes the file, checks it, keeps it on the box's
  disk and answers a **preview** (`stageConfigurationImport`,
  `packages/provisioning/src/configuration-import.ts:68-87`; the preview is
  `{ venue: bundle.venue, counts, reconnect }`, `:86`).
- The **claim** is the setup app's request that starts a first setup on a production box:
  `POST /setup-api/first-setup/claim` (`apps/server/src/setup-first-fiscal-api.ts:400-470`). The setup
  app sends it whenever the mode is Live and the box is not a development box
  (`apps/setup/src/setup-app.ts:1031`). It accepts only the venue and location fields it lists
  (`:413-436`, through `exact`, `:154-166`). A development box skips it and provisions through
  `POST /setup-api/provision`, whose `parseVenue` ignores extra keys (`setup-api.ts:415-516`).
- The **import** is `importConfigurationTables` (`configuration-transfer.ts:614-775`), which runs
  inside the transaction that creates the new venue, after its taxpayer row is written
  (`packages/provisioning/src/venue-apply.ts:167-193`, then `beforeCommit` at `:487`). Two places
  call it: the development provision route (`apps/server/src/boot.ts:1382`) and the owned first
  setup that follows a claim (`packages/provisioning/src/first-setup-command-deployment.ts:328`).
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

1. **The setup-from-export fix**: the setup app sends the claim only the location fields the claim
   lists (decision 1).
2. **One checker** for a single privacy contact value, `privacyContactChecked`, in
   `packages/provisioning/src/privacy-contact.ts`, used by the card's save route (refactored onto it)
   and by the import (decision 8).
3. **Format 9**: the export carries a required top-level key,
   `privacyContact: { privacyNoticeUrl, privacyEmail }`, each a string or `null`; a format-8 file is
   refused as "from an older format" (decisions 2, 5 and 6).
4. **The import checks the values** with the card's rule and the card's error code, at staging,
   before anything is kept on disk (decision 7).
5. **The import writes them** on the new box's taxpayer row, inside the setup transaction, for
   Same tax ID and New tax ID alike (decisions 3 and 4).
6. **The setup screen explains a refusal** of either value, by field and cause, in English and
   Spanish (decision 9).
7. **Docs**: the guide's Privacy section in both languages, the write-list guard's header, the
   conventions notes, one CLAUDE.md rule, the backlog and the overview.

Nothing else changes: no setup request field, no venue plan action, no first-setup state key, no
setup screen field, no reader of the stored values (that stays S1b's).

## What was run while writing this plan

Each probe says what the failing case would have printed. Probes 1 and 3 by the plan's author, 2 and
4 by the plan review (`a980-s1a2-plan-review.md`, "What I ran", probes 1 to 3); every throwaway case
was removed with `git checkout` and `git status --short` then printed nothing.

1. **The claim refuses a venue key it does not list.** A throwaway case in
   `apps/server/src/setup-first-fiscal.route.test.ts`, reusing its `fixture()` (`:57-175`): abandon
   the fixture's claim, then claim again with `request` unchanged (control) and with
   `privacyEmail: "privacy@example.com"` added to the venue.
   `pnpm exec vitest run src/setup-first-fiscal.route.test.ts -t zzprobe` (in `apps/server`, with
   `AI_AGENT` and `CLAUDECODE` unset) printed `PROBE control 200 {"state":…}` and
   `PROBE privacyEmail 400 {"error":{"code":"setup.request_invalid","params":{"field":"body"}}}`.
   Had the claim ignored unknown keys, the second line would have been a 200. Decision 2 follows.
2. **The setup app sends the preview's `fireControl` and `catalogueId` in the claim** (the review's
   probe 1, in `apps/setup/src/setup-app-first-fiscal.test.ts`, driving the real app: Live, the
   `configuration-requested` event with a stubbed preview, **Same tax ID**, the admin, the venue
   screen's own **Next**). With a real-shaped preview the claim's `venue.location` keys printed as
   the eleven the claim lists plus `catalogueId` and `fireControl`; with a preview lacking them, the
   eleven alone. A real export's preview does carry both: the review printed the staged answer in
   `boot.setup-routes.test.ts:1444`'s case, `…"fireControl":"waiter","catalogueId":"8155f0be-…"…`,
   and the parse refuses a location without a string `fireControl` (`configuration-transfer.ts:516-528`).
3. **The claim refuses exactly those two keys.** The same method as probe 1, with a venue whose
   `location` also held `fireControl: "waiter"` and `catalogueId: null`: control `200`, then
   `PROBE fireControl 400 {"error":{"code":"setup.request_invalid","params":{"field":"body"}}}`. The
   review repeated it with the setup app's captured body: `real-with-import 400` against
   `stripped-with-import 503 setup.not_ready` (the key check passed; no import was staged), and a
   day cutover written with seconds (`"05:00:00"`) accepted, so it is not a second cause.
4. **When it began.** `git log -S` on the claim's `exact(raw.location` list and on
   `PreparedVenue`'s `fireControl: string;` printed only `4e318802f` (#1752); on the setup app's
   `Object.entries(preview.venue.location).filter`, only `fabdb224d` (#296).
   `git grep -n -i "fireControl\|catalogueId" -- docs/backlog.md docs/backlog/` found no entry for it.
5. **The format moved each time an older file would otherwise be refused generically.**
   `git log -S"version: 8"` on `configuration-transfer.ts` printed only `251e256a4` (A756 PR 8);
   `docs/developers/conventions-data.md:1622-1645` lists every bump from 3 to 8. Decision 6 follows.

6. **Round 3's probes** (`~/waitron-campaign-b/a980-s1a2-plan-round3.md`, "What I ran"), each a
   throwaway: Task 2's row as first written passed and its control was refused 400 `body`; a row
   copying the WHOLE preview venue (as the setup app does) passed, and the same row with
   `privacyEmail` added to the venue was refused 400 `body` (probe 2), so Task 2 now copies the whole
   venue; with the claim's location list widened to accept the two keys, the frozen request still
   held only the eleven fields (probe 5), because `parseVenue` rebuilds the venue field by field; a
   rollback case whose throwing hook first reads `readPrivacyContact(tx)` saw the two values with the
   write in place and `null`s without it, while "the row afterwards equals `before`" held both ways
   (probe 4), so Task 5 case 4 now asserts what the hook saw.

Read, not run: everything else cited by `file:line` below, on this tree.

## Decisions this plan makes that the spec does not

1. **The setup app sends the claim only the location fields the claim lists; the claim stays
   strict.** In `#onConfigurationRequested` (`apps/setup/src/setup-app.ts:2112-2118`) the draft's
   location is built from the preview's location by the keys of `LocationDraft`
   (`apps/setup/src/api/client.ts:59-71`), the setup app's own type for the location it sends, which
   holds the same eleven fields as the claim's list (`setup-first-fiscal-api.ts:424-436`), instead of
   "everything but `id`". The list is a `const` typed against `LocationDraft`, with a compile-time
   check that it names every key, so a field added to the type and not to the list fails
   `typecheck`. Why the setup app and not the server: nothing is lost by dropping the two keys,
   because the import takes `fireControl` and `catalogueId` from the bundle itself, not from the
   request (`applyPreparedLocation`, called at `configuration-transfer.ts:764-770`); and the claim
   refuses a stray key outright, which #1752 chose (`setup-first-fiscal-api.ts:413-436`); accepting
   or stripping one would turn that refusal into a silent drop. The strict lists are not what keeps
   a stray key out of `first-setup.json`: `parseVenue` rebuilds the venue field by field
   (`setup-api.ts:472-516`) and the claim freezes its output (`setup-first-fiscal-api.ts:457-466`),
   besides checking each field's type and, in the claim, each value's length (`:442-455`); round 3's
   probe 5 measured it. The venue level needs no
   change: the preview's venue keys (`PreparedVenue`, `configuration-transfer.ts:38-62`) are all on
   the claim's venue list, and decision 2 keeps the new values off it.

2. **The values travel in a new top-level key, `privacyContact`, not inside `venue`.** The bundle's
   `venue` is the preview's venue, which the setup app sends back in the claim (decision 1), and the
   claim refuses any venue key it does not list (probe 1). A top-level key never reaches the preview
   (`configuration-import.ts:86`), so the claim, its key list and the setup app's types do not change.
   - Interface, in `configuration-transfer.ts`:

     ```ts
     export interface ConfigurationBundle {
       version: 9;
       createdAt: string;
       sourceOperatorId: string;
       venue: PreparedVenue;
       privacyContact: PrivacyContact;
       modules: Record<string, number>;
       tables: Record<string, Array<Record<string, unknown>>>;
       reconnect: string[];
     }
     ```

     `PrivacyContact` is the type `packages/provisioning/src/privacy-contact.ts:4-7` already exports.
   - The export's query (`:86-104`) gains `t.privacy_notice_url as "privacyNoticeUrl"` and
     `t.privacy_email as "privacyEmail"`, and the destructuring at `:114-124` must take both out of
     the row: anything left there lands in `location` through `...rest` (`:129-133`) and so in the
     preview, which the claim refuses. Task 4's export case checks that neither key appears in
     `venue` or `venue.location`.

3. **The import writes the values, inside the setup transaction; the setup request does not carry
   them.** The taxpayer row is created from the setup request (`venue-apply.ts:167-193`), and the
   import already runs in that same transaction once the row exists (`venue-apply.ts:486-487`, called
   with the import from `boot.ts:1382-1390` and `first-setup-command-deployment.ts:328-336`). So a
   write in `importConfigurationTables`, through `savePrivacyContact`, reaches both setup paths with
   one change and rolls back with the rest of the venue if a later step fails (Task 5's rollback
   case). Carrying the values in the request instead, as the overview guessed, would change the
   claim's key list, `parseVenue`, `VenueRequest` and `planVenue`, the frozen request's key list
   (`packages/provisioning/src/first-setup-state.ts:233-255`), `venue-apply.ts`'s insert and the setup
   app's `ProvisionBody`. **So `setup-api.ts`, `venue-plan.ts`, `venue-apply.ts` and
   `first-setup-state.ts`, named by the overview's row as a starting guess, do not change.**
   - The write goes after `applyPreparedLocation` (`:764-770`) and before the modules' `afterImport`
     hooks (`:771-774`), so a hook already sees the stored values, and a hook that throws rolls the
     write back with everything else. Task 5 case 4 checks both: its throwing hook reads the values
     through the transaction first.
   - `configuration-transfer.ts` calls `savePrivacyContact`; it does not write `tenants` itself. The
     write-list guard judges the file whose text holds the write (`scripts/write-path-tables.test.ts:15-17`,
     `:27-28`), and that stays `privacy-contact.ts`, already on the list.
   - With no taxpayer row, `savePrivacyContact` updates nothing and answers `null`
     (`privacy-contact.ts:25-38`); the import ignores the answer and finishes. That cannot happen on
     either setup path (`ensure-tenant` is the plan's first action, `venue-plan.ts:155-162`, and
     `beforeCommit` runs after every action), but some import tests run without a taxpayer row, and
     Task 5 pins the behaviour with a case (review M1).

4. **The values are carried for Same tax ID and New tax ID alike.** That is the owner's answer as
   written: "a new box set up from Bar Ejemplo's export shows both values", with no condition. The
   import writes `privacyContact` whatever the new taxpayer row's tax ID, so it needs no tax ID
   comparison. Owner decision A offers the narrower reading as the alternative.

5. **An unset value travels as `null`, and both keys are always present.** That is the bundle's
   convention for an optional taxpayer field: `taxpayerDomicile` is exported as `null` when unset
   (`configuration-export-api.test.ts:109`) and a missing one is refused (`configuration-transfer.ts:527`).
   So the parse refuses a format-9 bundle whose `privacyContact` is missing, not an object, lacks
   either key, or holds anything but a string or `null` in either, as
   `setup.request_invalid { field: "artifact" }`, the answer every other malformed field gets (`:506`,
   `:536`). Like the venue check, it checks only the keys it names and ignores any other key inside
   `privacyContact` (`apps/server/src/configuration-transfer.test.ts:480-488` pins that leniency for
   `venue`).

6. **The format moves to 9, and a format-8 file is refused as "from an older format".** Home
   CLAUDE.md §3: "No backwards-compatibility or data-migration code until Waitron is in production",
   so `privacyContact` is required and there is no branch for a file without it. Leaving the format
   at 8 with a required key would refuse older files with the generic "could not be opened. Check
   the file and passphrase", the mistake format 3 was made to avoid (`conventions-data.md:1630-1638`).
   At 9, a format-8 file gets `setup.configuration_outdated`, whose message exists ("This
   configuration export is from an older format. Export it again from a current box.",
   `apps/setup/src/i18n/strings/shell.ts:137-138`). The parse's two lines move:
   `value.version > 9` → `setup.request_invalid { field: "version" }`, `value.version !== 9` →
   `setup.configuration_outdated` (`configuration-transfer.ts:480-483`). Owner decision C. The
   reverse direction: a box running format 8 refuses a format-9 file as too new (`field: "version"`),
   with the existing incompatible-version message (`shell.ts:139-140`). That message says to export
   again from a box on the current version, which does not fit this case (the file already came
   from a current box; the receiving box is the older one). The same message also answers a module
   version mismatch in either direction, so rewording it is more than a one-line change; Task 8
   step 9 records it as a backlog point instead.

7. **A value the card's rule refuses makes the whole import refuse, at staging, with the card's
   own code.** `validateConfigurationBundle` (`configuration-transfer.ts:587-611`) gains the check
   after its module and table checks. It runs at staging, before anything is written to disk
   (`boot.ts:1279-1287`), again before the owned setup's venue transaction
   (`first-setup-command-deployment.ts:94`), and first thing in the import (`configuration-transfer.ts:621`).
   Each string goes through `privacyContactChecked` (decision 8):
   `venue.detail_invalid { field: "privacyNoticeUrl" | "privacyEmail", reason: "web_address" |
   "email" | "length" }`, the web page first, as the card's route checks (`venue-privacy.ts:21`).
   `""` and a value of spaces are unset, as on the card; `null` is the bundle's way of writing unset
   (the card refuses `null` as `type`, `venue-privacy.ts:24`). The value stored is
   `privacyContactValue`'s, NFC and trimmed. No refusal carries the value: the setup boundary logs
   `params` only (`packages/server-kit/src/error-boundary.ts:41-46`). The status is 400, the
   boundary's default for an unlisted code (`error-boundary.ts:42`, stated at `setup-api.ts:242-244`),
   so `PROVISION_STATUS` does not change. Owner decision B. A value the card accepts but that is not
   the export's own (a hand-edited file holding another valid address) is imported as written; the
   passphrase is the file's only protection, as for every other field.

8. **One checker, in `@waitron/provisioning`, for the route and the import.**

   ```ts
   /** One privacy contact value as the Privacy card's save takes it: NFC and trimmed, empty is
    * null; a value the shared rule refuses throws `venue.detail_invalid { field, reason }`. */
   export function privacyContactChecked(field: PrivacyContactField, raw: string): string | null;
   ```

   It lives in `packages/provisioning/src/privacy-contact.ts`, beside the reader and writer both
   callers use; `privacyContactRequest`'s loop (`venue-privacy.ts:21-28`) calls it after its own type
   check. The route's suite, `apps/server/src/venue-privacy-api.test.ts`, passes unedited, which shows
   the route's answers unchanged for the cases that suite has (review M4), no more.
   `venue.detail_invalid` is declared only in `apps/server/src/errors.ts:60` today;
   `packages/provisioning/src/errors.ts` gains the same declaration, `{ field: string; reason: string }`,
   because every throwing file imports its own package's registry (home CLAUDE.md §3;
   `apps/server/src/errors.ts:21-24`). A code declared in two registries has precedents: a scan of
   every `packages/*/src/errors.ts` and `apps/*/src/errors.ts` for keys declared in more than one
   printed 16, `management_session.required` among them. `savePrivacyContact` keeps its stated
   contract (it throws no code of its own, `privacy-contact.ts:18-24`).

9. **No new setup screen field or row; the setup screen explains a refusal by field and cause.**
   The values are applied as carried and edited afterwards on the Privacy card; the preview screen
   does not list them (it lists copied tables, `counts`). Without a message of its own,
   `venue.detail_invalid` would fall through to "The configuration export could not be opened. Check
   the file and passphrase." (`describeConfigurationRefusal`, `apps/setup/src/setup-app.ts:412-428`),
   which names the wrong cause. So the setup app gains four sentences, for each field a "not an
   address Waitron accepts" one and a "longer than Waitron accepts" one (review M8), built like the
   duplicate-name ones (`shell.ts:143-146`, `:296-299`): what is wrong, and that the person can
   correct it on the Privacy card of the box they exported from, export again and load the new file
   (home CLAUDE.md §3, a refusal names a self-service next step). Owner decision D.

10. **The guide's Data protection record of processing does not change.** Its "Backups and the
    configuration export" entry (`apps/server/src/guide/en/data-protection.md:339-363`) and the
    "leaked configuration export" paragraph (`:487-492`) list the PEOPLE's data an export holds; the
    privacy contact is the venue's published contact, which its notices show to anyone. The
    alternative is a clause naming it in both places, in both languages.

11. **The guide's Privacy section changes two sentences.** "A configuration export does not carry
    them, so after you set up a new box from one, enter them again." (`data-protection.md:164-165`;
    Spanish `es/data-protection.md:171-172`) becomes a sentence saying the export carries them, with a
    reminder to check them after New tax ID. And "For now Waitron only keeps them here: nothing else
    on the box shows them." (`:165-166`; `es/:172-173`) stops being true in its first half, so it
    narrows to "Nothing else on the box shows them yet." (review M2). S1b still rewrites that one.

12. **No log line, and no value in an error** (S1a decision 11, unchanged).

13. **Which paths the tests cover** (review I4). The development provision route
    (`boot.setup-routes.test.ts:1444`, `:1549`, under `WAITRON_ENV: "dev"`, `:1482`, `:1602`) and
    the owned-setup command called directly (`first-setup-command-import.test.ts:141`) skip the
    claim's key check, which is how decision 1's defect went unseen. So Task 2 adds a production-path
    row to `apps/server/src/first-fiscal-setup.e2e.test.ts` (`WAITRON_ENV: "production"`, `:150`):
    stage a real export, claim with the venue built from the staged preview as the fixed setup app
    builds it, and finish the setup; Task 6 adds the privacy assertions to it.

## Open decisions for the owner (FYI, built with the default)

- **A. The privacy contact is carried with New tax ID too** (decision 4, your answer as written).
  Worked example: Bar Ejemplo (B12345678) has `https://barejemplo.es/privacidad` and
  `privacidad@barejemplo.es` saved. Its new owner sets up a box from Bar Ejemplo's export and
  chooses **New tax ID**, B87654321. The new box's Privacy card shows Bar Ejemplo's address and
  email, and once S1b lands, the new owner's staff emails link to Bar Ejemplo's notice until someone
  changes them; the guide reminds them to check. Alternative: leave both unset with New tax ID,
  because the notice names the old business as controller; the import would then compare the new
  taxpayer row's tax ID with the export's (the setup's own checks already make the two equal exactly
  when Same tax ID was chosen, `boot.ts:1354-1363`, `first-setup-command-deployment.ts:79-86`; a tax
  ID typed `60000011-a` already tidies to the export's `60000011A`, `boot.setup-routes.test.ts:1613-1625`).
- **B. A value the card would refuse stops the whole import** (decision 7). Worked example: someone
  decrypts an export, edits the email to `privacidad@barejemplo` and encrypts it again; the setup
  screen refuses the upload with "This export's privacy email is not an address Waitron accepts. On
  the box you exported from, correct it on the Privacy card in Venue settings, export again, then
  load the new export." Nothing is staged. An export Waitron wrote can only hit this if the rule
  becomes stricter after the export was made, since the card refuses the same values on save. If the
  box it came from is gone, that file cannot be imported. Alternative: import the rest and leave the
  refused value unset, saying which one.
- **C. Exports made before this slice are refused as "from an older format"** (decision 6, the
  pre-production rule). Worked example: a manager downloaded an export this afternoon, on a box
  running S1a. After S1a2 lands, the setup screen refuses it with "This configuration export is from
  an older format. Export it again from a current box." Alternative: stay at format 8 and import a
  file without the key with both values unset, which the pre-production rule asks not to build.
- **D. Setup does not show the two values** (decision 9). Worked example: setting up from Bar
  Ejemplo's export, the review screen lists menus, staff and hardware to reconnect, not the privacy
  address; after setup the Privacy card shows both. Alternative: a line on the review screen saying
  the privacy page and email will be copied.
- **FYI, no answer needed: setting up a production box from a configuration export has been
  refused since 2026-10-20 (#1752)**, at the step that claims the setup, because the setup app sent
  two menu-setting fields the box does not accept there. This branch fixes it (Task 1); a
  development box was unaffected.

## Global constraints

- **TDD.** Each task writes its failing test first, runs it and watches it fail for the reason
  named, then writes the code. Where a task's new case pins behaviour that already holds, it says so
  and names the control that makes it fail.
- **English only** in code, identifiers, comments, fixtures and tests. Spanish only in
  `apps/setup/src/i18n/strings/shell.ts`'s Spanish half and `apps/server/src/guide/es/data-protection.md`.
  A test of Spanish text reads the sentence as the setup app's existing cases do, by locale
  (`apps/setup/src/setup-app.test.ts:3053-3094`). Fixture values: `https://example.com/privacy` and
  `privacy@example.com`.
- **Every database test uses `useVenueDb`.** Every refusal asserts the domain error code and its
  exact params. Exact shapes use `toEqual` or `toBe`; `toMatchObject` only where the file's own
  siblings already use it for the same assertion.
- **Fixtures use values the two sides could treat differently**: a value with surrounding spaces (a
  path that skips `privacyContactValue` stores them), and an email with a decomposed accent. Write
  the accent with code points, never as characters, which look identical (review M5): the input
  `` `jose${String.fromCodePoint(0x301)}@example.com` `` (an e followed by a separate combining acute
  accent) and the expected `` `jos${String.fromCodePoint(0xe9)}@example.com` `` (one accented letter).
- **Nothing else in the taxpayer row changes**: each import test compares the whole row with
  `{ ...before, <the changed columns> }`.
- **Coverage**: `@waitron/provisioning`, `@waitron/server` and `@waitron/setup` hold 98/98/98/95.
  `@waitron/provisioning`'s coverage counts its own tests only (`packages/provisioning/vitest.config.ts:15-21`),
  so every new branch there needs a provisioning test. No exclude or ignore comment. None of the
  three is mutation-tested (no mutation config or script in any of them); `@waitron/shared` is not
  touched.
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

## Changed test checks

The lane's rule allows a check to change when the spec changes what it checks, provided each change
is listed. Every change to an existing test, by kind; the implementer names each in its commit and
the pull request lists them all. Anything not listed here that has to change is a STOP: say why in
the handover.

**Checks that change because the format moves to 9** (decision 6; as `251e256a4` moved them to 8):

| Where | Now | Becomes | Task |
| --- | --- | --- | --- |
| `packages/provisioning/src/configuration-transfer.boundaries.test.ts:51` | `{ value: { version: 9 }, field: "version" }` (too new) | `{ version: 10 }` | 4 |
| `apps/server/src/configuration-import.test.ts:179` | `["future version", { version: 9 }]` | `{ version: 10 }` | 4 |
| `apps/server/src/configuration-transfer.test.ts:5282` | `expect(exported.version).toBe(8)` | `toBe(9)` | 4 |

**Fixtures that gain what the new format or a real export has** (no check changes):

| Where | Change | Task |
| --- | --- | --- |
| `packages/provisioning/test/configuration-bundle.ts:5` | `version: 9`, and `privacyContact: { privacyNoticeUrl: "https://example.com/privacy", privacyEmail: "privacy@example.com" }` | 4 |
| `apps/server/src/configuration-import.test.ts:48-49` | `version: 9`, `privacyContact` with both `null` | 4 |
| `apps/server/src/configuration-transfer.test.ts:401-402` | the same | 4 |
| `apps/setup/src/setup-app.test.ts:586-610` (the stubbed preview of "stages a preparation export and prefills the live venue draft") | its location gains `fireControl: "waiter"` and `catalogueId: "catalogue"`, as a real preview has (review C1) | 1 |
| `apps/server/src/first-fiscal-setup.e2e.test.ts:94-127` (`configurationArtifact`) | the source also stores both privacy values | 6 |
| `packages/provisioning/src/first-setup-command-import.test.ts:96-106` (the fixture's source transaction) | the source also stores both privacy values | 5 |
| `apps/server/src/boot.setup-routes.test.ts:1444` and `:1549` cases, their sources | each source also stores both privacy values | 6 |

**Assertions added to existing cases** (no existing assertion changes):

| Where | Added | Task |
| --- | --- | --- |
| `packages/provisioning/src/first-setup-command-import.test.ts:173-210` | the target's privacy columns equal the two values, for both rows | 5 |
| `apps/server/src/first-fiscal-setup.e2e.test.ts`, the success branch (`:431`) | the new box's privacy columns equal the two values, for every row that finishes | 6 |
| `apps/server/src/boot.setup-routes.test.ts:1444` case | the target's privacy columns equal the two values | 6 |
| `apps/server/src/boot.setup-routes.test.ts:1549` case | after the taxpayer row assertion at `:1636-1647`, left as it is, a second `select privacy_notice_url, privacy_email from tenants` equal to the two values | 6 |
| `apps/server/src/configuration-export-api.test.ts:96-111` | `decoded.privacyContact` equals both `null` | 6 |

**Rows added to existing tables** (no existing row changes):

| Where | Rows | Task |
| --- | --- | --- |
| `apps/server/src/first-fiscal-setup.e2e.test.ts:129-137` | one, `{ …, claimFrom: "preview" }` (decision 13) | 2 |
| `packages/provisioning/src/configuration-transfer.boundaries.test.ts` ("refuses an obsolete configuration format") | one, `{ ...configurationBundle(), version: 8 }` (added 2026-10-26 in Task 8's fix round) | 8 |
| `apps/server/src/configuration-import.test.ts:96-256` (older formats) | two: format 8 with and without `privacyContact` | 4 |
| `packages/provisioning/src/configuration-transfer.boundaries.test.ts:48-81` (malformed) | five, `privacyContact` malformed | 4 |
| `apps/setup/src/setup-app.test.ts:3034-3051` (generic refusals) | one, `["venue.detail_invalid", "legalName"]` | 7 |

**One renaming**: the same table's title template (`first-fiscal-setup.e2e.test.ts:138`) gains
`, claim from $claimFrom`, so the new row's name differs from the first row's; every existing row's
name gains ", claim from undefined", and no assertion changes (Task 2).

**One restructuring with the same assertion**: in `first-fiscal-setup.e2e.test.ts:231-234` the staged
answer's body is read into a variable before the existing `toMatchObject`, so Task 2's row can use it
(Task 2).

## Review focus

- **The setup-from-export fix** (decision 1): the location list typed against `LocationDraft` with
  its exhaustiveness check; the failing setup-app case; the production-path e2e row and its control.
- **The preview stays as it is** (decision 2): no privacy key in `venue` or `venue.location`;
  `packages/provisioning/src/configuration-import.test.ts:35-40` still pins the preview as
  `{ venue, counts, reconnect }`, and with the fixture now carrying values it is the check that the
  preview leaves them out.
- **The check is the card's** (decisions 7 and 8): one function on both paths; the route's suite
  unedited and green; refusals at staging leave staged files untouched; no value in a refusal.
- **The write** (decision 3): through `savePrivacyContact` only; only the two columns; before the
  `afterImport` hooks: Task 5 case 4's hook sees the stored values through the transaction, then
  its failure leaves the row as it was; deleting the write or moving it after the hooks fails the
  case.
- **The format** (decision 6): the three changed checks, nothing else; format 8 refused as outdated.
- **Docs**: every guide sentence against the code (Task 8's table), both languages; afterwards
  `git grep -n -i "does not carry them\|no los incluye\|only keeps them here\|solo los guarda aquí"`
  over `apps` and `docs` finds only dated records.
- **Codex run-it seat**: two reviews, the second told to set this plan aside.

## Task 0: re-check before dispatching (the driver, not an implementer)

Run on the branch's then-current tip and compare with this plan. If anything differs, fix the plan
before Task 1.

1. `git grep -n "version: 8" -- 'packages/*/src/**' 'packages/*/test/**' 'apps/*/src/**'`: expected,
   `configuration-transfer.ts:136` and `:169`, and the three fixture literals in "Changed test
   checks". `git grep -n "version: 9" -- 'packages/provisioning/**/configuration*' 'apps/server/src/configuration*'`:
   expected, the two too-new rows only (a wider pathspec also finds QR-code versions in
   `apps/server/src/qr-matrix.test.ts` and `test-page.ts`).
2. `git grep -n "importConfigurationTables(" -- 'packages/*/src/**' 'apps/*/src/**' | /usr/bin/grep -v "\.test\.ts"`:
   expected, the definition and the two callers of decision 3.
3. `git grep -n "privacy" -- packages/provisioning/src/configuration-transfer.ts packages/provisioning/src/configuration-import.ts`:
   expected, nothing.
4. At the end of the branch, before `/finish-branch`: `git diff --stat main...HEAD -- packages/db`
   prints nothing.
5. The review's probe 2 (the setup app sends the two keys) is done; its receipts are in "What was run".

## Task 1: the setup app sends the claim only the claim's location fields (bugfix)

Files: `apps/setup/src/setup-app.ts` (`#onConfigurationRequested`, `:2112-2118`; a location field
list typed against `LocationDraft`), `apps/setup/src/setup-app-first-fiscal.test.ts` (one new case),
`apps/setup/src/setup-app.test.ts` (the fixture in "Changed test checks").

1. Test first, in `setup-app-first-fiscal.test.ts`, using its `mount()` (`:13-24`) and the
   `wizardApi()` from `apps/setup/test/first-setup-browser.ts`: replace `stageConfiguration` with a
   stub answering a real-shaped preview, `venue` from that test helper with
   `location: { ...venue.location, id: "source-location", fireControl: "waiter", catalogueId: "catalogue", dayCutover: "05:00:00" }`;
   pick Live, send `configuration-requested`, click **Same tax ID** on the preview screen, fill the
   admin, open the venue screen and click its own **Next** (`wt-button[data-test=next]`), as the
   review's probe 1 did. Assert the one claim request's `venue.location` keys, sorted, equal
   `Object.keys(venue.location).sort()` (the helper's location, which the claim accepts), and that
   `venue.location.dayCutover` is `"05:00:00"` (the preview's value is kept). Run
   `pnpm --filter @waitron/setup exec vitest run src/setup-app-first-fiscal.test.ts -t "preview"`;
   watch it fail with `catalogueId` and `fireControl` among the keys.
2. Fix: build the draft's location from the preview's by the listed fields. The list is
   `const CLAIM_LOCATION_FIELDS = [...] as const satisfies readonly (keyof LocationDraft)[]` with a
   type-level check that `Exclude<keyof LocationDraft, (typeof CLAIM_LOCATION_FIELDS)[number]>` is
   `never`. A field the preview lacks is left out rather than set to `undefined`.
3. Give the fixture at `setup-app.test.ts:586-610` the two keys ("Changed test checks"); its case
   must pass unchanged, and its existing `.id` check (`:622`) still holds.
4. Run the whole of `setup-app-first-fiscal.test.ts` and `setup-app.test.ts`: each its previous
   `Tests` count, plus 1 for the first, nothing failed.
5. Omission control: copy "everything but `id`" again; the new case fails. Revert.
6. `pnpm --filter @waitron/setup typecheck`; then add an OPTIONAL key (`zzProbe?: string`) to
   `LocationDraft` in a scratch edit and expect exactly one `error TS` line, on the line of
   `CLAIM_LOCATION_FIELDS`'s check; revert. (A required key breaks six test fixtures before the list
   is reached, round 3 probe 6, so both answers would look alike.)

## Task 2: a production-path row through the claim, ending in an imported venue

Files: `apps/server/src/first-fiscal-setup.e2e.test.ts` (one table row and the restructuring in
"Changed test checks").

This row pins the server's half of decision 1; it passes as soon as it is written, because the
server does not change. Its control is what makes it a test.

1. Add `claimFrom?: "preview"` to the table's rows and the row
   `{ newTaxpayer: false, change: "none", launch: "direct", claimFrom: "preview" }` (`:129-137`), and
   `, claim from $claimFrom` to the title template (`:138`; the renaming in "Changed test checks").
   Read the staged answer's body into a variable before the existing `toMatchObject` (`:231-234`).
   For this row, build the claim's venue as the setup app does: the WHOLE preview venue, with only
   its location cut down, `{ ...stagedBody.venue, location: <stagedBody.venue.location reduced to
   Object.keys(request.location)>, admin: request.admin }`, so a key a later slice adds to the
   export's `venue` reaches the claim here as it would from the setup app. Two preconditions first,
   so a failure names its cause: the preview's location has a `fireControl` property (the row is fed
   what a real export gives), and every key of the preview's venue is a key of `request` (the
   fixture request holds exactly the claim's venue list). This row, being direct, Same tax ID and
   unchanged, also runs the pre-claim refusal blocks (`:206-221`, `:239-258`) and the
   `setup.email_required` check; harmless, and it adds time.
2. Run `pnpm --filter @waitron/server exec vitest run src/first-fiscal-setup.e2e.test.ts`: the
   file's previous count plus 1, nothing failed; the new row reaches `provisioned: true` and the
   success branch's product and taxpayer reads (`:428-435`).
3. Control: build the row's location as "everything but `id`" (the setup app before Task 1); the
   claim answers 400 `setup.request_invalid { field: "body" }` and the row fails. Revert.

## Task 3: one checker for a privacy contact value

Files: `packages/provisioning/src/privacy-contact.ts` (add `privacyContactChecked`; import
`"./errors.js"`), `packages/provisioning/src/errors.ts` (declare `venue.detail_invalid`),
`packages/provisioning/src/index.ts` (export it), `packages/provisioning/src/privacy-contact.test.ts`
(new), `apps/server/src/venue-privacy.ts` (call it).

Interface: decision 8.

1. Tests first, in the new `privacy-contact.test.ts` (pure, no database), two `it.each` tables:
   - accepted (field, raw → value), 5 rows: `privacyNoticeUrl`, `"  https://example.com/privacy  "` →
     `"https://example.com/privacy"`; `privacyNoticeUrl`, `"HTTPS://EXAMPLE.COM/Privacy"` → the same
     text; `privacyNoticeUrl`, `""` → `null`; `privacyEmail`, `"   "` → `null`; `privacyEmail`, the
     decomposed-accent input → the composed expected value (Global constraints).
   - refused (field, raw → reason), 5 rows: `privacyNoticeUrl`, `"example.com/privacy"` → `web_address`;
     `privacyNoticeUrl`, `"https://user:pw@example.com/p"` → `web_address`; `privacyNoticeUrl`,
     `"https://example.com/" + "a".repeat(481)` → `length`; `privacyEmail`, `"privacy@example"` →
     `email`; `privacyEmail`, `"a@" + "b".repeat(250) + ".es"` → `length`. Each row catches the error
     and asserts `code` is `venue.detail_invalid` and `params` `toEqual` `{ field, reason }` exactly.
   Run `pnpm --filter @waitron/provisioning exec vitest run src/privacy-contact.test.ts`; watch it
   fail (no export).
2. Write `privacyContactChecked`, the registry line and the export. Expected `Tests  10 passed (10)`.
3. Refactor `privacyContactRequest` (`venue-privacy.ts:21-28`) to keep its `typeof raw !== "string"`
   refusal and then set `changes[field] = privacyContactChecked(field, raw)`. Run, unedited,
   `pnpm --filter @waitron/server exec vitest run src/venue-privacy-api.test.ts`: the same `Tests`
   count before and after, nothing failed.
4. Omission controls, each run and reverted: skip NFC (the accent row fails); return the untrimmed
   text (the spaces row fails); throw with `{ field, reason, value }` (every refused row fails).
5. `pnpm --filter @waitron/provisioning typecheck`, `pnpm --filter @waitron/server typecheck`; at the
   root `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/personal-log-params.test.ts`.

## Task 4: format 9, the export carries the values, the parse and check read them

Files: `packages/provisioning/src/configuration-transfer.ts` (the type, `version: 9`, the query and
its destructuring, the parse, `validateConfigurationBundle`),
`packages/provisioning/src/configuration-transfer.privacy-contact.test.ts` (new), and every row of
"Changed test checks" marked Task 4.

1. Tests first.
   - In the new file (`useVenueDb` with `migrationOptionsFor(manifestSets(), null)`; a source venue
     made as `first-setup-command-import.test.ts:81-106` makes one, with `applyHistoricalTestVenue`
     from `../test/allocated-venue.js` and `request` from `../test/first-setup-request.js`), 7 cases:
     1. with `savePrivacyContact` having stored both values, `buildConfigurationBundle` answers
        `version: 9` and `privacyContact` equal to them, and neither `bundle.venue` nor
        `bundle.venue.location` has a `privacyNoticeUrl` or `privacyEmail` property;
     2. with nothing stored, `privacyContact` is `{ privacyNoticeUrl: null, privacyEmail: null }`;
     3. `decodeConfigurationBundle(encodeConfigurationBundle(f))` equals `f` for the shared fixture;
     4. `validateConfigurationBundle` (modules `[]`, versions `{}`, the fixture's `modules: {}` and
        `tables: {}`) accepts `{ privacyNoticeUrl: "", privacyEmail: null }` and
        `{ privacyNoticeUrl: "   ", privacyEmail: "privacy@example.com" }` (one `it.each`, 2 rows);
     5. it refuses, one `it.each` of 3 rows each asserting `code` and exact `params`:
        `privacyNoticeUrl: "example.com/privacy"` → `{ field: "privacyNoticeUrl", reason: "web_address" }`;
        `privacyEmail: "privacy@example"` → `{ field: "privacyEmail", reason: "email" }`; both at once
        → the web page's refusal.
     Count: 1 + 1 + 1 + 2 + 3 = 8; expected `Tests  8 passed (8)` once green.
   - The boundaries malformed table gains 5 rows, each `field: "artifact"`: the fixture with
     `privacyContact` deleted; `privacyContact: "x"`; `privacyContact: []`;
     `privacyContact: { privacyNoticeUrl: null }`; `privacyContact: { privacyNoticeUrl: 5, privacyEmail: null }`.
   - The server's older-format table (`apps/server/src/configuration-import.test.ts:96-256`) gains
     `["A980 pre-privacy-contact export with the key", { version: 8 }]` and
     `["A980 pre-privacy-contact export without it", { version: 8, privacyContact: undefined }]`,
     both expecting `setup.configuration_outdated` with the staged files retained, as the table's
     other rows do.
   Run `pnpm --filter @waitron/provisioning exec vitest run src/configuration-transfer.privacy-contact.test.ts src/configuration-transfer.boundaries.test.ts`;
   watch them fail.
2. Write the change (decisions 2, 5, 6 and 7): `version: 9` in the type, the build and the parse's two
   lines; the query's two columns, taken out of the row before `...rest`; `privacyContact` in the
   returned bundle; its shape check after the venue check (`:525-537`); the rule in
   `validateConfigurationBundle` after the module and table checks, for each `PRIVACY_CONTACT_FIELDS`
   field whose value is a string, through `privacyContactChecked`.
3. Make the three format checks and three fixture literals of "Changed test checks" (Task 4 rows).
4. Run: the new file `Tests  8 passed (8)`; the boundaries file its previous count plus 5; then
   every provisioning file that imports the shared fixture
   (`git grep -l "test/configuration-bundle" -- packages/provisioning/src`) and, in `apps/server`,
   `src/configuration-import.test.ts` (previous count plus 2), `src/configuration-transfer.test.ts`,
   `src/configuration-import.previous-export.test.ts` and `src/configuration-export-api.test.ts`
   (previous counts), each `Tests` line read.
5. Omission controls, each run and reverted: leave the two columns in the row before `...rest`
   (case 1 fails on `venue.location`); accept a missing `privacyContact` (the first new boundaries
   row fails); skip the rule in `validateConfigurationBundle` (case 5 fails); leave the parse at
   `!== 8` (the two format-8 rows and the too-new rows fail).
6. `pnpm --filter @waitron/provisioning typecheck` and `pnpm --filter @waitron/server typecheck`.

## Task 5: the import writes the values

Files: `packages/provisioning/src/configuration-transfer.ts` (`importConfigurationTables`),
`packages/provisioning/src/configuration-transfer.privacy-contact.test.ts` (5 more cases),
`packages/provisioning/src/first-setup-command-import.test.ts` (the rows in "Changed test checks").

1. Tests first. These cases import the **shared fixture** (`packages/provisioning/test/configuration-bundle.ts`,
   country `GB`, tax ID `123456789`), not Task 4's export (review M7). The target is made with
   `applyVenue(planVenue(...))` as `configuration-transfer.boundaries.test.ts:265-281` makes one, on
   a second `useVenueDb`; imports run with modules `[]` and versions `{}` inside `withTransaction`,
   except case 4. 5 cases:
   1. the whole taxpayer row afterwards equals
      `{ ...before, privacyNoticeUrl: "https://example.com/privacy", privacyEmail: "privacy@example.com" }`;
   2. a target made with a different tax ID (`987654321`): the same two values are written
      (decision 4);
   3. the bundle's values written as `"  https://example.com/privacy  "` and the decomposed-accent
      email: stored trimmed and composed;
   4. **rollback**: one synthetic module, built as `moduleWith` builds one
      (`configuration-transfer.boundaries.test.ts:30-36`) with `tables: []` and an `afterImport`
      that first reads `readPrivacyContact(tx)` into a variable the test holds, then throws
      `new Error("synthetic afterImport failure")`; the bundle's `modules` and the versions name it
      at 1. Assert: the transaction rejects with that error; what the hook read equals the two
      values (the write ran, before the hooks); and the row read afterwards equals `before` (the
      rollback);
   5. **no taxpayer row**: a third `useVenueDb`, freshly migrated, with no venue; the import (target
      `{ locationId: "absent" }`) finishes, and `select count(*) as n from tenants` is `0` (review M1).
   Expected for the file once green: `Tests  13 passed (13)`.
   - `first-setup-command-import.test.ts`: the fixture's source stores both values, and the case at
     `:173-210` also expects `select privacy_notice_url as privacyNoticeUrl, privacy_email as privacyEmail from tenants`
     to equal one row holding the two values, for both `newTaxpayer` rows.
   Run `pnpm --filter @waitron/provisioning exec vitest run src/configuration-transfer.privacy-contact.test.ts src/first-setup-command-import.test.ts`;
   watch cases 1 to 4 and both command rows fail (case 4 on what its hook read). Case 5 passes
   before the write exists; its control is in step 4.
2. Write it (decision 3): after `applyPreparedLocation` and before the `afterImport` loop, call
   `savePrivacyContact(tx, { privacyNoticeUrl, privacyEmail })` with each field's
   `privacyContactChecked` value (a `null` stays `null`), ignoring its answer.
3. Run both files again: `Tests  13 passed (13)` and the command file's previous count.
4. Omission controls, each run and reverted: skip the write (cases 1 to 4 and the command rows
   fail); move the write after the `afterImport` loop (case 4 fails: its hook reads `null`s); write
   the bundle's raw strings (case 3 fails); throw when `savePrivacyContact` answers `null` (case 5
   fails).
5. `pnpm --filter @waitron/provisioning typecheck`; at the root
   `pnpm exec vitest run scripts/write-path-tables.test.ts` (expected all pass).

## Task 6: the server's setup routes, end to end

Files: `apps/server/src/first-fiscal-setup.e2e.test.ts`, `apps/server/src/boot.setup-routes.test.ts`,
`apps/server/src/configuration-import.test.ts`, `apps/server/src/configuration-export-api.test.ts`,
`scripts/write-path-tables.test.ts` (header list only), `docs/developers/conventions-data.md`
(`:897-905`). No server source file changes in this task, so these cases are written after the code;
step 3 is their control.

1. The cases ("Changed test checks", Task 6 rows):
   - `first-fiscal-setup.e2e.test.ts`: `configurationArtifact` stores both values in the source
     before `buildConfigurationBundle` (`:119`); the success branch (`:428-435`) also expects
     `select privacy_notice_url as privacyNoticeUrl, privacy_email as privacyEmail from tenants` to
     equal the two values, for every row that finishes, Task 2's production-path row included.
   - `boot.setup-routes.test.ts:1444` and `:1549` (the development path): each source stores both
     values; each target's privacy columns then equal them (for `:1549`, a second `select` after the
     untouched assertion at `:1636-1647`).
   - `configuration-import.test.ts`, a new `it.each` modelled on `:315-371`, 2 rows: a current bundle
     whose `privacyContact` holds `privacyNoticeUrl: "example.com/privacy"` or
     `privacyEmail: "privacy@example"`, staged through `POST /setup-api/configuration` with the file's
     `validate`; expected 400 `{ error: { code: "venue.detail_invalid", params: { field, reason } } }`
     and the three retained staging files unchanged.
   - `configuration-export-api.test.ts:96-111`: `decoded.privacyContact` equals both `null`.
2. Run `pnpm --filter @waitron/server exec vitest run src/first-fiscal-setup.e2e.test.ts src/boot.setup-routes.test.ts src/configuration-import.test.ts src/configuration-export-api.test.ts src/venue-privacy-api.test.ts`.
   Expected: each file's previous count, plus 2 for `configuration-import.test.ts`, nothing failed.
3. Control for both production callers: with Task 5's write commented out, the e2e rows (the owned
   setup, `first-setup-command-deployment.ts:328`) and the `boot.setup-routes.test.ts:1444` case (the
   development route, `boot.ts:1382`) fail. Restore it.
4. `scripts/write-path-tables.test.ts`'s header (`:49-51`): the `privacy-contact.ts` line also names
   "and a configuration import, inside setup's venue transaction". `conventions-data.md:901-905`:
   after "which updates `privacy_notice_url` and `privacy_email` alone", add "; a configuration
   import reaches the same writer for those two columns (A980 S1a2)". Run
   `pnpm exec vitest run scripts/write-path-tables.test.ts`.
5. `pnpm --filter @waitron/server typecheck`.

## Task 7: the setup screen explains a refused privacy value

Files: `apps/setup/src/setup-app.ts` (`describeConfigurationRefusal`, `:412-428`),
`apps/setup/src/i18n/strings/shell.ts` (four keys, English and Spanish),
`apps/setup/src/setup-app.test.ts` (beside `:3034-3094`).

Words (English / Spanish). The card and page names are the dashboard's own:
`venue_settings.card.privacy` «Privacidad», `venue_settings.title` «Ajustes del local»
(`apps/dashboard/src/i18n/strings.ts`, the S1a plan's Task 8 table).

| Key | English | Spanish |
| --- | --- | --- |
| `shell.configuration.privacy_notice_url_invalid` | This export's privacy notice web page is not an address Waitron accepts. On the box you exported from, correct it on the Privacy card in Venue settings, export again, then load the new export. | La página web del aviso de privacidad de esta exportación no es una dirección que Waitron acepte. En el equipo del que exportaste, corrígela en la tarjeta Privacidad de Ajustes del local, vuelve a exportar y carga la nueva exportación. |
| `shell.configuration.privacy_notice_url_too_long` | This export's privacy notice web page is longer than Waitron accepts. On the box you exported from, shorten it on the Privacy card in Venue settings, export again, then load the new export. | La página web del aviso de privacidad de esta exportación es más larga de lo que Waitron acepta. En el equipo del que exportaste, acórtala en la tarjeta Privacidad de Ajustes del local, vuelve a exportar y carga la nueva exportación. |
| `shell.configuration.privacy_email_invalid` | This export's privacy email is not an address Waitron accepts. On the box you exported from, correct it on the Privacy card in Venue settings, export again, then load the new export. | El correo de privacidad de esta exportación no es una dirección que Waitron acepte. En el equipo del que exportaste, corrígelo en la tarjeta Privacidad de Ajustes del local, vuelve a exportar y carga la nueva exportación. |
| `shell.configuration.privacy_email_too_long` | This export's privacy email is longer than Waitron accepts. On the box you exported from, shorten it on the Privacy card in Venue settings, export again, then load the new export. | El correo de privacidad de esta exportación es más largo de lo que Waitron acepta. En el equipo del que exportaste, acórtalo en la tarjeta Privacidad de Ajustes del local, vuelve a exportar y carga la nueva exportación. |

1. Tests first: one `it.each` of 8 rows (English and Spanish, by field and reason: `web_address`,
   `length` for the web page; `email`, `length` for the email), shaped like `:3053-3094`:
   `stageConfiguration` rejects `{ code: "venue.detail_invalid", params: { field, reason }, status: 400 }`;
   the live-source screen's bottom message is the row's sentence, the draft has no
   `configurationImport`, and no preview screen is shown. Add `["venue.detail_invalid", "legalName"]`
   to the generic table (`:3034-3051`), expecting the could-not-open sentence. Run
   `pnpm --filter @waitron/setup exec vitest run src/setup-app.test.ts -t "privacy|generic"`; watch
   the new rows fail.
2. Add the branch (field and reason select the key; `length` gives the too-long sentence, any other
   reason the not-accepted one; any other field keeps the generic sentence) and the strings. Run the
   whole file: its previous count plus 9, nothing failed.
3. Omission control: map both reasons to one key (the `length` rows fail). Revert.
4. `pnpm --filter @waitron/setup typecheck`; at the root `pnpm exec vitest run scripts/english-only.test.ts`.

## Task 8: the guide, the conventions, the backlog and the overview

Files: `apps/server/src/guide/en/data-protection.md`, `apps/server/src/guide/es/data-protection.md`,
`docs/developers/conventions-data.md`, `docs/developers/design-system.md` (`:5410`), `CLAUDE.md`
(§3, one rule), `docs/backlog/data-protection.md`, `docs/backlog.md`,
`docs/superpowers/plans/2026-10-24-a980-data-protection-build.md`,
`docs/superpowers/plans/2026-10-26-a980-s1a-notice-settings.md` (a dated pointer only).

1. The guide, `privacy-settings` section. In English (`en/data-protection.md:164-166`), replace "A
   configuration export does not carry them, so after you set up a new box from one, enter them
   again. For now Waitron only keeps them here: nothing else on the box shows them." with:

   ```md
   A configuration export carries them, so a new box set up from one shows them. If you set it up
   with **New tax ID**, check them here: they are still the old business's until you change them.
   Nothing else on the box shows them yet.
   ```

   In Spanish (`es/data-protection.md:171-173`), replace «Una exportación de la configuración no los
   incluye, así que, si preparas un equipo nuevo a partir de una, vuelve a escribirlos. Por ahora
   Waitron solo los guarda aquí: nada más en el equipo los muestra.» with:

   ```md
   Una exportación de la configuración los incluye, así que un equipo nuevo preparado a partir de
   ella los muestra. Si lo preparas con **NIF nuevo**, revísalos aquí: siguen siendo los del negocio
   anterior hasta que los cambies. Nada más en el equipo los muestra todavía.
   ```

   Each sentence's source, checked when written and again by the reviewer:

   | Sentence | Source |
   | --- | --- |
   | an export carries them | Task 4 case 1; `configuration-export-api.test.ts` (Task 6) |
   | a box set up from one shows them | Task 5 case 1; Task 6's e2e rows, the production-path row included, and `boot.setup-routes.test.ts:1444` |
   | with New tax ID they are still the old business's | Task 5 case 2; the e2e `newTaxpayer: true` rows; `boot.setup-routes.test.ts:1549`; the command file's `true` row |
   | the choice names | `apps/setup/src/i18n/strings/restore.ts:155`, `:337` |
   | nothing else on the box shows them yet | S1a decision 1, unchanged: no reader takes them until S1b |

   Then `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts`, at the root
   `pnpm exec vitest run scripts/guide-links.test.ts`, `pnpm exec prettier --file-info apps/server/src/guide/en/data-protection.md`,
   and `pnpm format:check`.
2. `conventions-data.md`: in the format history's last sentence (`:1639-1645`), edit in place:
   the list of bumps gains "and A980 S1a2 (format 9, 2026-10-26, when the copy gained the venue's
   privacy contact as the required top-level `privacyContact` key)", and "`configuration-transfer.test.ts`
   now pins format 8" (`:1644`) becomes "format 9". The dated "A756 PR 8 (format 8, 2026-10-24, …)"
   (`:1642`) stays. Under the paragraph, a new one: "The setup preview's `venue` is sent back by the setup app in
   the first-setup claim, which refuses any venue or location key it does not list
   (`apps/server/src/setup-first-fiscal-api.ts`). So a bundle value that is not a setup field lives
   outside `venue`, and the setup app copies the preview's location by `LocationDraft`'s fields
   (`apps/setup/src/setup-app.ts`). Cost: from #1752 to A980 S1a2 every Live setup from an export on
   a production box was refused at the claim, because the copy also carried `fireControl` and
   `catalogueId`; the tests that imported an export all went through the development route or called
   the owner runtime directly." `design-system.md:5410`: "format 8" becomes "format 9".
3. `CLAUDE.md` §3, in the "Data, modules and migrations" list, one rule after the "composition
   list" entry: "**A configuration bundle value that is not a setup field lives outside the bundle's
   `venue`**: the setup app sends the preview's venue back in the first-setup claim, which refuses
   keys it does not list, and copies the preview's location by `LocationDraft`'s fields. Cost: from
   #1752 to A980 S1a2 no production box could be set up from an export. Guard: the production-path
   row in `apps/server/src/first-fiscal-setup.e2e.test.ts` and the preview case in
   `apps/setup/src/setup-app-first-fiscal.test.ts`, weaker than the rule: one export shape, and the
   row cuts the location down by the test's own key list, not `LocationDraft`.
   [Detail](docs/developers/conventions-data.md)." Run
   `pnpm exec vitest run scripts/claude-md-pointers.test.ts` and `pnpm format:check`.
4. `docs/backlog/data-protection.md`: delete the **S1a2** point (`:231-244`), now finished. In the
   **S1b** point (`:205-230`) drop "Waits for S1a2 (the export point below)." and change its quoted
   guide sentence to the new "Nothing else on the box shows them yet." («Nada más en el equipo los
   muestra todavía.»). In `## Decisions and deliberate limits` (`:287`), an "A980 S1a2" entry with
   owner decisions A to D and their defaults, one line each, as the S1a entry has them.
5. `docs/backlog.md:6137-6139`: the list of built slices gains "S1a2 (the configuration export
   carries the privacy contact, and a production box can be set up from an export again)".
6. The overview: in the S1a paragraph (`:55-66`), "S1a does not, and S1a2, the next slice, adds it
   before S1b" becomes a dated line saying S1a2 is built (this plan; format 9 with the top-level
   `privacyContact`; carried with both tax ID choices; the claim fix). The **S1a2** row (`:103`)
   gains "Built: [plan](2026-10-26-a980-s1a2-export-privacy-contact.md); no migration (confirmed);
   the setup request, venue plan and first-setup state did not change (decision 3)."
7. The S1a plan's decision 10 (`2026-10-26-a980-s1a-notice-settings.md:351`): a dated line under it,
   "_2026-10-26: S1a2 carries them ([its plan](2026-10-26-a980-s1a2-export-privacy-contact.md))._"
8. `git grep -n -i "does not carry them\|no los incluye\|only keeps them here\|solo los guarda aquí\|format 8"`
   over `apps`, `docs/developers` and `docs/backlog*`: expected, only `conventions-data.md:1642`'s
   dated "A756 PR 8 (format 8, 2026-10-24, …)"; over `docs/superpowers`, only dated records.
9. `docs/backlog.md`, under "The setup wizard, onboarding and the demo venue" (`:425`), a short
   entry: a box on an older configuration format given a newer export shows "This export is not
   compatible with this Waitron version. Export it again from a box running the current
   version, …" (`apps/setup/src/i18n/strings/shell.ts:139-140`), but the file already came from a
   current box and it is the receiving box that needs updating; the same sentence answers module
   version mismatches in both directions (`describeConfigurationRefusal`,
   `apps/setup/src/setup-app.ts:412-428`), so the fix is to word the too-new case on its own.
   Found by A980 S1a2's plan review.

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
  (decision 3), and the claim's strict key lists are why the bundle keeps them out of `venue`
  (decision 2, probe 1).
- **No migration**, confirmed (Task 0 step 4). **The format moves to 9** (decision 6).
- **S1a2 also fixes setting up a production box from an export** (Task 1), broken since #1752
  (probes 2 to 4).

## How each review finding was answered

- **C1** (setup from an export refused on a production box): fixed in this branch, Tasks 1 and 2,
  in the setup app (decision 1 says why not the server); the old decision 12's "not fixed here" is gone.
- **I1** (New tax ID narrowing): the owner's literal reading is the default (decision 4); the
  narrowing is owner decision A's alternative; no tax ID comparison in the import.
- **I2** (format and the pre-production rule): format 9, `privacyContact` required, no key-missing
  branch; the changed checks are listed (decision 6, "Changed test checks").
- **I3** (rollback case): Task 5 case 4 makes a hook fail after the write.
- **I4** (production path untested): Task 2's row through the claim, with Task 6's assertions
  (decision 13).
- **I5** (edits beyond the allowed kinds; wrong line range): every edit listed under "Changed test
  checks"; the `:1549` case keeps its assertion at `:1636-1647` and gains a second one.
- **M1** (no taxpayer row): decision 3's last point and Task 5 case 5.
- **M2** (the next guide sentence goes stale): decision 11 and Task 8 step 1.
- **M3** (null on the card): decision 7 now says the card refuses `null` as `type`.
- **M4** (what the unedited suite proves): decision 8 narrowed to the suite's own cases.
- **M5** (accent fixture bytes): Global constraints write it with `String.fromCodePoint`.
- **M6** (probe 2 "likely"): replaced by the review's run receipts; Task 0 step 5 says it is done.
- **M7** (which bundle Task 5 imports): the shared fixture, stated in Task 5 step 1.
- **M8** (length named as a bad address): four sentences, by field and cause (decision 9, Task 7).

Round 3 (`~/waitron-campaign-b/a980-s1a2-plan-round3.md`):

- **I1** (Task 2's row filtered the venue): it now copies the whole preview venue, cutting only the
  location, with a venue-keys precondition; the CLAUDE.md guard hedge names the test's own key list.
- **I2** (vacuous rollback case): case 4's hook reads the values through the transaction before
  throwing; the controls are deleting the write and moving it after the hooks.
- **M1** (false reason in decision 1): replaced by "#1752 chose a refusal over a silent drop", with
  the `parseVenue` receipt (round 3 probe 5).
- **M2** (type control could not fail differently): an optional key, one expected error on the list.
- **M3** (version grep too wide): narrowed to `configuration*` paths, with the QR hits named.
- **M4** (stale "pins format 8"; the final grep): `:1644` edited in place; the grep expects only
  `:1642`'s dated line.
- **M5** (CLAUDE.md line lacked a rule and a cost): reworded as a rule with its cost and pointer.
- **M6** (duplicate row name): the title gains `$claimFrom`, the renaming listed; the extra blocks
  the row runs are named.
- **M7** (too-new message does not fit): decision 6 narrowed; a one-line change does not suffice,
  since the message also answers module mismatches, so Task 8 step 9 records a backlog point.
