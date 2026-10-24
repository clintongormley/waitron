# A980 slice S2a1: a staff member downloads their own data (server side)

**Status: plan, 2026-10-24. Nothing is built.** Revised the same day after the plan review (its
rulings I1–I3, M4–M10, W1–W4 are folded in below). Design:
[A980 data protection, revision 2](../specs/2026-10-22-a980-data-protection-design.md) §4.2 (the
download and its worked example), §2.1 and §2.3 (what is held), §5.3 row S2 (its tests), §8 owner
answer O5 ("staff should be able to download their own data"). Overview:
[the build plan](2026-10-24-a980-data-protection-build.md), row S2a1 and "Notes for each slice →
S2a1". Branch `feat/a980-s2a1-own-download`. No migration; reads only. FULL review (personal
data): per-task reviews run, then `/finish-branch`.

**Words used here.** A **seat** is a slot on a module's description (`WaitronModule`,
`packages/module/src/module.ts:1541-1599`) that the module fills with its own code, so shared code
can call every enabled module without naming any of them. A **part** is one contributor's share of
the download: a list of file names it may add, plus the code that reads and builds them. A **ZIP**
is the one-file archive the person downloads. **fflate** is a small JavaScript compression library
(MIT licence). A **snapshot transaction** is the one database transaction in which every part of
the download is read, so all parts describe the same moment.

## What this slice builds, and what it leaves

`GET /management-api/me/personal-data/export` answers a signed-in person with a ZIP of what the box
holds about them. In this slice the ZIP holds two files, both from the identity module:
`profile.json` and `sign-in.json`. Parts come from two places: modules fill a new seat,
`personalData`, and the server can add parts of its own (none in this slice). Decision 5 says
exactly what S2b and S2c will have to change.

Left for later, on purpose:

- **No README in the ZIP.** S2a2 adds `README.txt` (purposes, recipients, how long data is kept,
  the person's rights) in English and Spanish, from a file under `apps/server/src/i18n/`. Without
  it the ZIP is already a correct machine-readable copy of the identity data (the Article 20 part
  of design §4.2), but not yet a complete Article 15 answer, which also needs that explanation.
- **No button and no guide page.** S2a2 adds the Profile page's button and the guide text. Until
  then nothing in the dashboard links to the route, so no guide page changes here.
- **No workforce, staffing, working-time or actions files** (S2b, S2c), and no other person's
  download (S2c).

## Decisions this plan makes that the design does not

1. **The identity part is a seat contribution, not a function the route calls by name.** Identity
   is a module like the others: it is listed in `ALL_MODULES` (`packages/composition/src/modules.ts:188-202`),
   is `toggleable` (`:191`), and already fills four seats there (classification, backup check,
   change feed, configuration transfer at `:201`). The server also calls identity directly as an
   ordinary dependency (`apps/server/src/me-api.ts:15-34`; the composition comment at
   `modules.ts:129-130` calls identity one of the "ordinary dependencies of the packages that use
   them", not a slot). Default: identity fills the new seat with `IDENTITY_PERSONAL_DATA`, exported
   from `@waitron/identity` and wired into its `ALL_MODULES` entry. Why: the route then has one
   loop over enabled modules and never names a module; and a module switched off is skipped by the
   loop, where a direct call would query tables that were never created (a disabled module's
   tables are not migrated: `apps/server/src/modules.ts`, the comments on `enabledFloorAnnotators`
   and `enabledAlertSources`).

2. **A part reads inside the transaction and builds its files after it closes.** Shape, in a new
   `packages/module/src/personal-data.ts`:

   ```ts
   export interface PersonalDataSubject {
     readonly personId: string;
     /** The moment of the request, from the box's clock. */
     readonly at: Date;
     /** The venue's IANA time zone, or "UTC" when it cannot be read (decision 8). */
     readonly timeZone: string;
     /** This node's location, or null when this node has no row (decision 8). */
     readonly locationId: string | null;
   }
   export interface PersonalDataFile {
     /** A name this part declared in `files`. */
     readonly name: string;
     readonly content: string | Uint8Array;
   }
   export interface ModulePersonalData {
     /** Every file name this part may add; unique across all parts. */
     readonly files: readonly string[];
     /** Reads everything this part holds about the person, inside the caller's transaction, and
      * returns a function that builds the files once that transaction has closed. The returned
      * function must not use `tx`. */
     prepare(
       tx: Transaction,
       subject: PersonalDataSubject,
     ): Promise<() => Promise<readonly PersonalDataFile[]>>;
   }
   /** A part and who contributed it, for error messages: a module's name, or "server". */
   export interface PersonalDataPart {
     readonly owner: string;
     readonly part: ModulePersonalData;
   }
   ```

   and on `WaitronModule`, beside `timeRecordExport` (`module.ts:1579`):
   `readonly personalData?: ModulePersonalData;`. The two steps copy the time-record export's seat
   (`packages/module/src/record-export.ts:6-8`) and its route, which formats after the transaction
   and checks the session again before sending (`apps/server/src/attendance-export-api.ts:119`).
   Why it matters: `withTransaction` holds the venue's write lock for its whole body
   (`packages/db/src/tenancy.ts:30-42`), so a sale waits while a transaction is open, and S2b's
   working-time PDF must not be drawn inside one. The identity part has nothing slow to build; it
   uses the same shape so S2b changes no contract. The subject carries the time, zone and location
   the route reads anyway for the file name (decision 8), because the working-time export needs a
   location and a period (`packages/shared/src/record-export-types.ts:4-10`).

3. **File names are declared up front and checked twice.** A part lists its file names in
   `files`. Each must match `^[a-z0-9]+(?:-[a-z0-9]+)*\.(?:json|csv|pdf)$` (lower-case ASCII, so
   S2a2's `README.txt` can never collide and no name needs the ZIP's UTF-8 flag) and be unique
   across every part. `validatePersonalDataParts(parts)` refuses a bad or repeated name with the
   existing `module.config_invalid` code (`packages/module/src/errors.ts`, `{ reason }`), as
   `selectTimeRecordExport` does for two providers (`record-export.ts:9-19`). The composition test
   runs it over `ALL_MODULES`' parts, so a collision S2b introduces among modules fails before it
   ships. At run time the gatherer also refuses a built file whose name its part did not declare,
   or a name built twice, with a plain `Error` (a programming fault: the route answers
   `server.internal`, 500).

4. **One gatherer, keyed by person id, in `@waitron/module`.**
   - `personalDataParts(modules)` returns the enabled modules' seat values as parts, in module order.
   - `preparePersonalData(tx, parts, subject)` validates the parts (decision 3), calls each part's
     `prepare` in list order, each awaited before the next (never `Promise.all`: queries on one
     transaction are awaited in turn, home CLAUDE.md §3), and returns one function that builds
     every part's files in the same order and checks the names.

   It sits beside `selectTimeRecordExport`, the contract's other export helper. It takes parts, not
   modules, so the server can add parts of its own (decision 5). Nothing in it knows whose session
   asked.

5. **What S2b and S2c will change, said plainly.**
   - **The route's send function takes server-side parts.** `sendPersonalData` (decision 7) gathers
     `[...personalDataParts(modules), ...serverParts]`; `serverParts` is an optional field of the
     mount's dependencies, empty in S2a1. Server-side parts exist because some of the download
     cannot come from a module: the working-time PDF and CSV are drawn by code in `apps/server`
     (`apps/server/src/attendance-export-pdf.ts:13`, `attendance-export-csv.ts:12`), from the
     record that the `workforce-es` module provides through the `timeRecordExport` seat
     (`modules.ts:234`, read by `selectTimeRecordExport`).
   - **S2b** fills the seat in the workforce and staffing modules (their own files), and adds one
     server-side part in `apps/server` that wraps `selectTimeRecordExport(modules)` and the two
     renderers, passed through `serverParts` from `mountMeApi`. It decides the export's period,
     audience and language, which `RecordExportInput` requires (`record-export-types.ts:4-10`):
     the location and the date come from the subject, and the person's language can be read in its
     own `prepare`. The subject's `locationId` can be null (decision 8) while the export needs a
     location, so S2b also decides what a null location does (for example, leaves the working-time
     files out). S2b changes the mount call and adds a part; it does not change
     `sendPersonalData` or the gatherer.
   - **S2c** adds a second route in the same file that calls `sendPersonalData` with its own
     `authorize` step (decision 7), wrapped in the same exported error handler,
     `withPersonalDataErrors`, and adds `authorization.not_permitted: 403` to that handler's one
     map (the own route never throws it; without the entry the code would fall to the boundary's
     default 400, `packages/server-kit/src/error-boundary.ts:42`). It also adds the actions part. The core tables that part reads (sales,
     drawer openings) belong to `@waitron/db`, which does not depend on `@waitron/module` (its
     `package.json` lists no such dependency), so core's part is either a plain object of the right
     shape exported by `@waitron/db`, as `CORE_CONFIGURATION_TRANSFER` is
     (`packages/db/src/configuration-transfer.ts:25`), or assembled in composition, as
     `CORE_TRANSFER` is (`modules.ts:113-119`); S2c chooses.

6. **The ZIP is made with fflate, declared as a dependency of `@waitron/server`, not a hand-written
   writer.** Receipts:
   - fflate 0.8.3 is already installed, as a dependency of `pdfkit` and `png-js`
     (`pnpm-lock.yaml`, the `pdfkit@0.20.2` and `png-js@2.0.0` entries), but it is **not** in the
     server bundle today. Command, run 2026-10-24 from `apps/server`:
     `pnpm exec esbuild src/bin.ts --bundle --platform=node --format=esm --target=node24 --external:sharp --outfile=$T/server.js --metafile=$T/server.js.meta.json`
     (the flags `scripts/bundle-node.mjs:15-27` uses, minus the `--banner` line at `:23`). The
     metafile's inputs matching `fflate|png-js` were one file, `png-js/lib/png-js.js`, and
     `grep -c fflate` on the bundle printed `0`. pdfkit's Node entries contain no fflate:
     `grep -c fflate` printed `0` for `pdfkit/js/pdfkit.node.mjs` and `pdfkit/js/pdfkit.js` (its
     browser builds and `pdfkit.standalone.js` do mention it). So declaring fflate adds new
     third-party code to the image.
   - Its licence notice is produced without any hand step. Each server bundle's notice file is
     generated from esbuild's input list by `scripts/npm-bundle-notices.mjs` and copied to
     `/app/third-party/npm/server/` (`deploy/Dockerfile:226-234`; `deploy/third-party/README.md`,
     "Bundled npm packages"). Running that generator over a test bundle that imports fflate wrote a
     file whose first entry was `===== fflate 0.8.3 — LICENSE =====` followed by the MIT text. No
     fallback file is needed (fflate ships `LICENSE`), so `deploy/third-party/` does not change.
     The home rule on licence notices (CLAUDE.md §3, "A change adding third-party code … carries
     its licence notices") is met by that generated file; a bundled package with no notice makes
     the generator throw (`scripts/npm-bundle-notices.mjs:58`). On this pull request CI runs that
     generator, because the `bundle-smoke` job builds the server (`.github/workflows/ci.yml:497`),
     but nothing in CI reads what the notice file says, and the `image` job, which copies it into
     the image, does not run: on a pull request it runs only when an image input changed, meaning
     `deploy/` or the files image-smoke runs (its `if:` at `ci.yml:671`; `isImageInputPath`,
     `scripts/changed-scope.mjs:140-142`), and `apps/server/package.json` is neither. So Task 6
     builds the server bundle locally and reads the notice file.
   - fflate's output opens in other tools. A test bundle built with the same esbuild flags called
     `zipSync` on `profile.json` (with "Marta López" inside), `sign-in.json` and `café.txt`;
     `unzip -t` printed `No errors detected in compressed data`, and Python's `zipfile` read every
     entry with its checksum intact, the UTF-8 flag (bit 11) off for the two ASCII names and on for
     `café.txt`, compression method 8 (deflate). fflate's own `unzipSync` read the text back with
     the accent intact.
   - Against writing our own: a writer is about 60 lines of binary format plus a checksum, all of
     it ours to test to the 98/98/98/95 bar, and our tests would then need a ZIP reader too, which
     brings back either a library or a second hand-written format. fflate has no dependencies of
     its own (its `package.json` lists none). The pull request says this choice, as the overview
     asks.
   - Default details: `"fflate": "^0.8.3"` (the range pdfkit itself asks for, so one copy stays
     installed); deflate at level 6 (fflate's default; JSON shrinks well); each entry's time is the
     moment of the request. fflate writes that time in the server process's own time zone
     (`fflate/esm/index.mjs:1902-1905` uses `getHours()` and friends; in the experiment a `10:15Z`
     time read back as `12:15` on a machine in Madrid summer time). The box's process zone is not
     the venue's, and we do not correct it: the entry time is cosmetic, and the file name carries
     the venue's date (decision 8).

7. **The route, its address and its answer.**
   - `GET /management-api/me/personal-data/export`, beside the existing self-service reads under
     `/management-api/me/` (`me-api.ts:370`, `:391`; `attendance-export-api.ts:78-80`).
   - It asks only for a signed-in management session (`resolveManagementSession`), like
     `/management-api/me/attendance/export` (`attendance-export-api.ts:45-55`), and acts only for
     the person that session names. It takes no query: any query string is refused with
     `management.request_invalid` `{ field: "query" }`, as `noQuery` does
     (`apps/server/src/management-attendance-api.ts:56-59`), so `?personId=…` cannot be mistaken
     for a working way to fetch someone else. S2c gets its own address,
     `GET /management-api/staff/:id/personal-data/export`.
   - A suspended person's session is refused `person.suspended` (403) by
     `resolveManagementSession` (`packages/identity/src/management-session.ts:83-85`); their
     download is S2c's admin case. No cookie, an ended session or a person still `pending`:
     `management_session.required` (401); idle too long: `management_session.expired` (401)
     (`management-session.ts:79-86`).
   - **No last-seen stamp.** The own route's `authorize` resolves the session with `touch: false`,
     so the route writes nothing. The home rule says a housekeeping write on a read path must not
     take the read down on a full disk (CLAUDE.md §3); not writing at all is the simplest way to
     meet it. Cost: a download does not count as activity for the 30-minute idle timer
     (`IDLE_TIMEOUT_MS`, `management-session.ts:13`).
   - Answer: `Content-Type: application/zip`;
     `Content-Disposition: attachment; filename="<slug>-<date>.zip"`;
     `Cache-Control: no-store`; `X-Content-Type-Options: nosniff` (the last three as
     `attendance-export-api.ts:138-143`; its content type is set at `:134-137`).
   - Errors through a `createErrorBoundary` map of its own (log tag `personal_data.failed`, which
     is a log line's name, not an error code): `management_session.required` and
     `management_session.expired` 401, `person.suspended` 403, `module.config_invalid` 500. The
     file exports it as `withPersonalDataErrors(c, log, fn)`, the `(c, log, fn)` function
     `createErrorBoundary` returns (`packages/server-kit/src/error-boundary.ts`), because
     `sendPersonalData` takes no logger and so does not catch on its own: the own route, S2c's
     route and the test route below all wrap their call in it. No new
     error code is added, so no registry, `scripts/errors-reachable.test.ts` or
     `scripts/alert-codes.test.ts` change is due.
   - **One send function, with the caller's authorisation run in both transactions.**
     `sendPersonalData(c, deps, authorize)`, where
     `authorize: (tx: Transaction) => Promise<{ personId: string; label: string }>`. It takes the
     time; opens one transaction that runs `authorize`, reads the node's location and zone and
     calls `preparePersonalData`; closes it; builds the files; opens a second short transaction
     that runs the **same** `authorize` again and refuses (a plain `Error`, 500) if the person id
     differs from the first; zips; answers. The own route's `authorize` is
     `resolveManagementSession(tx, token, { touch: false })` mapped to
     `{ personId, label: displayName }`. S2c's will be `authorizeManager` with
     `personal_data.export` plus the target's row, so the re-check after building repeats the
     permission check too, not just "is the session alive". An ended or suspended session, or a
     lost permission, refuses in the second transaction and no bytes are sent.
     `sendPersonalData` and `withPersonalDataErrors` are exported from the file so its test can
     count the `authorize` calls through a route of its own, and so S2c can reuse both.

8. **The file name: display name, made safe, plus the venue's date.**
   - The name is the person's display name (`persons.display_name`, never empty:
     `packages/identity/src/schema/persons.ts:31`, `:89`), which `resolveManagementSession`
     already returns (`management-session.ts:68`, `:99`). It reaches the send function as
     `authorize`'s `label`.
   - Made safe in this order: Unicode compatibility decomposition (NFKD), accents removed (every
     combining mark), lower case, then `ß→ss`, `æ→ae`, `œ→oe`, `ø→o`, `ł→l`, `đ→d`, `ð→d`, `þ→th`,
     `ı→i` (letters that decomposition leaves whole), every run of anything other than `a-z` and
     `0-9` becomes one hyphen, hyphens trimmed from both ends, cut to 60 characters and trimmed
     again. If nothing is left the name is `person`. Experiment, 2026-10-24 (a throwaway
     `node -e` of exactly this function): `Marta López → marta-lopez`, `José Ñúñez → jose-nunez`,
     `Núria Col·lell → nuria-col-lell`, `Straße → strasse`, `Søren Ærø → soren-aero`,
     `Łukasz Đorđević → lukasz-dordevic`, `İlknur Işık → ilknur-isik`, `Ana María 2 → ana-maria-2`,
     `李雷 → person`, `"  ---  " → person`. Without the letter table `Straße` came out `stra-e` and
     `Søren Ærø` `s-ren-r`. `foldForSearch` (`packages/shared/src/text-search.ts:1-3`) is not
     reused: it decomposes with NFD, which keeps ligatures and similar forms whole. Because the
     result is plain ASCII, the header needs no `filename*=` form.
   - The date is today's date where the venue is: the box's clock (`now()`, a new optional
     `MeApiDeps.now`, defaulting to `() => new Date()`, as me-api reads `Date.now()` today at
     `me-api.ts:335`), turned into a calendar date in the time zone of this node's location
     (`nodes.location_id → locations.time_zone`; `nodes.location_id` is
     `packages/db/src/schema/nodes.ts:22-25`) by `civilDateOf` (`packages/reporting/src/business-day.ts:122-135`,
     already a dependency of the server). A missing node row or an unknown zone falls back to UTC,
     the same fallback as `readVenueTimeZone` (`apps/server/src/venue-time-zone.ts:5-19`); a missing
     node row also leaves the subject's `locationId` null. The location and zone are read in the
     snapshot transaction. On a mirror the node is the mirror's own (`boot.ts:2062`); if the copied
     database holds no row for it, the download is dated in UTC.

9. **Mounted from `mountMeApi`, so `apps/server/src/boot.ts` does not change.** Open pull request
   #1990 changes `boot.ts` and waits for the owner (`gh pr view 1990`, 2026-10-24: open, a fiscal
   slice the owner lands, `apps/server/src/boot.ts` among its files). `boot.ts` calls `mountMeApi`
   with `cfg: { nodeId: till.nodeId }` and `modules: setsToMigrate.map((m) => m.name)`
   (`boot.ts:2057-2065`), where `setsToMigrate` is drawn from the module host's list, which boot
   creates from `ALL_MODULES` (`boot.ts:868-874`, `:896`, `:942-943`). `mountMeApi` turns those
   names back into module descriptions with a new `modulesNamed(names)` in
   `apps/server/src/modules.ts` (the members of `ALL_MODULES`, in its order, whose name is listed)
   and calls `mountPersonalDataExportApi(app, { db, nodeId: deps.cfg.nodeId, modules, now }, log)`
   from a new `apps/server/src/personal-data-export-api.ts`. The attendance export's mount
   (`management-attendance-api.ts:67-72`) was not used: boot mounts it only when workforce is on
   and the node is the single primary (`boot.ts:2036-2046`), and the identity part must not depend
   on workforce. That the names really reach the identity part in a real start is shown by the boot
   test in Task 6, not by this reading.

10. **What the identity part contains.** Rule: every column of every identity row that names the
    person, except secrets (hashes, keys, tokens, challenges, encrypted values, the codes behind a
    sign-in ceremony), copies derived from another column (the `_folded` columns), internal row
    ids, and the `person_id` a read selects by (the person's id is already in `profile.json`); a
    secret's existence is shown as yes/no. Timestamps appear as stored (ISO 8601, UTC).

    **Order of every list**, so the output is the same on every run (row ids are random UUIDs,
    `packages/db/src/schema/columns.ts:178`, so they may only break ties the fixture never
    creates): `passkeys` by `created_at`, `deviceSessions` by `opened_at`, `dashboardSessions` by
    `created_at` and `accountEmails` by `created_at`, each then by row id; `unfinishedSetups` by kind in the fixed order two-factor, passkey,
    google-link, then by `startedAt` (by `expiresAt` for google-link, whose `startedAt` is always
    null), then row id; `deviceProfileExceptions` (no time column) by the profile's name, then the
    profile's id. The test fixture gives every row a distinct, explicit timestamp.

    **`persons`** (`packages/identity/src/schema/persons.ts:30-67`), all 20 columns:

    | Column | In? | Where, or why not |
    | --- | --- | --- |
    | `id` | in | `profile.json` `id`: the person's identifier in the venue's records, which S2b and S2c's files refer to |
    | `display_name` | in | `displayName` |
    | `display_name_folded` | out | a folded copy for the uniqueness check (`foldForUniqueness`, `packages/identity/src/fold.ts`: trimmed, normalised, lower-cased; may be null) |
    | `first_names` | in | `firstNames` |
    | `last_names` | in | `lastNames` |
    | `telephone` | in | `telephone` |
    | `pin_hash` | out | secret; shown as `sign-in.json` `pinSet` |
    | `password_hash` | out | secret; `passwordSet` |
    | `totp_secret` | out | encrypted two-factor secret; `twoFactorOn` |
    | `locale` | in | `locale` |
    | `passkey_offered_at` | in | `sign-in.json` `passkeyOfferedAt` |
    | `email` | in | `email` |
    | `email_folded` | out | a folded copy for the uniqueness check, as above |
    | `pending_email` | in | `pendingEmail` |
    | `pending_email_folded` | out | a folded copy for the uniqueness check, as above |
    | `email_verified_at` | in | `emailVerifiedAt` |
    | `google_subject` | out | Google's account identifier used to sign in; the slice brief lists "Google linked yes/no"; `googleLinked` |
    | `role` | in | `role` |
    | `status` | in | `status` |
    | `created_at` | in | `createdAt` |

    **The other identity tables that name a person** (every identity table with a `person_id`
    column, `packages/identity/src/schema/*.ts`), every column listed:

    | Table | In (and where) | Out, and why |
    | --- | --- | --- |
    | `webauthn_credentials` (passkeys) | `passkeys[]`: `name`; `aaguid` as `provider` (the provider's name, through `passkeyProviderName`, as the Profile page shows it: `profile.ts:202-231`); `created_at`; `last_used_at` | `id`, `person_id`; `credential_id` (the handle a sign-in presents, like the Google subject); `public_key` (never, per the slice brief); `counter` and `transports` (values the authenticator keeps about itself). The design's example says "passkeys: names and dates" (§4.2) |
    | `recovery_codes` | `used_at`, as `recoveryCodes: { unused, used }` counts | `id`, `person_id`; `code_hash` (secret); `created_at` (the slice brief says "count only") |
    | `sessions` (a PIN sign-in on a device) | `deviceSessions[]`: `device_id` as `device` (the device's label, joined from `devices`); `opened_at`; `ended_at` | `id`, `person_id`; `token_hash` (works as a login: home CLAUDE.md §3 "stored as a hash") |
    | `management_sessions` (dashboard sign-ins) | `dashboardSessions[]`: `created_at` as `openedAt`; `last_seen_at`; `ended_at` | `id`, `person_id`; `token_hash`, as above |
    | `management_account_actions` (invitation, password-reset and email-change emails) | `accountEmails[]`: `purpose`; `target_email` as `newEmail`; `created_at`; `expires_at`; `used_at`; `code_expires_at`; `code_attempts` | `id`, `person_id`; `token_hash`, `code_hash` (secrets) |
    | `totp_enrollments` (a two-factor setup not yet finished) | `unfinishedSetups[]` `{ kind: "two-factor" }`: `created_at` as `startedAt`; `expires_at` | `id`, `person_id`; `encrypted_secret` |
    | `webauthn_challenges` (a passkey setup not yet finished; rows with no person are sign-in attempts and are not about anyone) | `unfinishedSetups[]` `{ kind: "passkey", expiresAt: null }`: `created_at` as `startedAt` | `id`, `person_id`; `challenge` (never, per the slice brief) |
    | `google_oidc_states` (a Google link not yet finished; rows with no person are sign-ins) | `unfinishedSetups[]` `{ kind: "google-link", startedAt: null }`: `expires_at` | `id`, `person_id`; `mode` (used to pick the rows: only `link` rows carry a person, `packages/identity/src/google-oidc.ts:71`, `:86`; shown as the fixed `kind`); `state_hash`, `nonce`, `verifier` (secrets) |
    | `device_profile_admission_persons` (a device profile that lets the person in, or keeps them out, whatever their role) | `profile.json` `deviceProfileExceptions[]`: `device_profile_id` as `deviceProfile` (the profile's name, joined from `device_profiles`); `admitted` | `person_id` |

    `device_profile_admission_roles` names a role, not a person, so it is not read. Tables of other
    modules that name the person (who served a sale, working time, rota, absences) come in S2b and
    S2c (decision 5).

    **A device's label can name somebody** ("Marta's phone", design §2.3 row d1). Default: the
    label is exported for the person's own sessions, because the design's example asks for the
    device ("sessions: device, opened, ended", §4.2) and the label is how every screen names it.
    This is a reviewer decision, listed under Review focus.

    The exact files (key order as written; the part builds them with `JSON.stringify(value, null, 2)`
    plus a final newline, UTF-8):

    ```text
    profile.json  { id, displayName, firstNames, lastNames, email, pendingEmail, emailVerifiedAt,
                    telephone, locale, role, status, createdAt,
                    deviceProfileExceptions: [{ deviceProfile, admitted }] }
    sign-in.json  { pinSet, passwordSet, twoFactorOn, googleLinked, passkeyOfferedAt,
                    passkeys: [{ name, provider, createdAt, lastUsedAt }],
                    recoveryCodes: { unused, used },
                    dashboardSessions: [{ openedAt, lastSeenAt, endedAt }],
                    deviceSessions: [{ device, openedAt, endedAt }],
                    accountEmails: [{ purpose, newEmail, createdAt, expiresAt, usedAt,
                                      codeExpiresAt, codeAttempts }],
                    unfinishedSetups: [{ kind, startedAt, expiresAt }] }
    ```

    A person id with no `persons` row throws `person.not_found` (`packages/identity/src/errors.ts:42`);
    the own route cannot reach that (its session found the person), and S2c checks the row first.

11. **`sessions` is read without an index on `person_id`, and none is added.** Its only indexes
    are on the device and the token hash (`schema/sessions.ts:25-26`), and adding one is a
    migration, which this slice does not carry. Experiment, 2026-10-24: in an in-memory
    `node:sqlite` database with this table's shape and 300,000 rows (60 people), selecting one
    person's 5,000 rows sorted by time took about 9 ms on this Mac, three runs. That is not a
    measurement on a box, whose disk and processor may be slower; the read runs while the write
    lock is held, once per download. If a box measurement shows it slow, the index is its own later
    slice.

## Global constraints

- Every database test uses `useVenueDb`; every refused request asserts the domain error code.
- One snapshot transaction per download, plus the short re-check; queries on a transaction are
  awaited in turn, never `Promise.all`.
- The download never contains a hash, a token, a key, a challenge or an encrypted value. Tests look
  for them in the **unzipped** text of every file, never in the ZIP's bytes: compressed bytes would
  hide a leaked hash from a byte search, so that search would pass whether or not it leaked.
- Exact-shape assertions use `toEqual`, not `toMatchObject`, so a key added later fails a test
  (home CLAUDE.md §4: `toMatchObject` checks only the keys you list).
- English only in code and tests. No shared code names workforce or staffing.
- Coverage: `@waitron/module`, `@waitron/identity`, `@waitron/composition` and `@waitron/server`
  each hold 98/98/98/95. None of them is mutation-tested (the mutation-tested packages are `ui`,
  `ui-core`, `shared`, `fiscal` and `db`).
- Commits `git commit -s`. Run `pnpm format:check` before each commit.
- An implementer that passes about 150 tool calls with its task unfinished stops at a passing or
  cleanly failing point, commits, and hands over: what is done, what is left, the files, each
  check's state.

## Task 1 — the seat, the parts and the gatherer (`@waitron/module`)

Files: `packages/module/src/personal-data.ts` (new), `packages/module/src/personal-data.test.ts`
(new), `packages/module/src/module.ts` (the `personalData?` line), `packages/module/src/index.ts`
(exports).

Interfaces (decision 2 gives the types):

```ts
export function personalDataParts(modules: readonly WaitronModule[]): PersonalDataPart[];
export function validatePersonalDataParts(parts: readonly PersonalDataPart[]): void;
export function preparePersonalData(
  tx: Transaction,
  parts: readonly PersonalDataPart[],
  subject: PersonalDataSubject,
): Promise<() => Promise<PersonalDataFile[]>>;
```

1. Write the tests first, with stub parts (no database; pass `{} as Transaction`):
   - `personalDataParts` returns the modules that fill the seat, in module order, owned by their
     names, and skips the rest;
   - validation accepts distinct well-formed names across two parts;
   - it refuses, with `module.config_invalid`: the same name in two parts; the same name twice in
     one part; `README.txt`; `Profile.json`; `a/b.json`; `café.json`; `profile.txt`;
     `-profile.json`;
   - `preparePersonalData` calls every `prepare` before any build function, in list order, with
     the transaction and subject it was given (record the calls in an array);
   - it awaits each `prepare` before calling the next (the second stub's `prepare` must not be
     called while the first's promise is still pending: hold it with a promise the test resolves);
   - the build function returns all files in list order;
   - a built file with an undeclared name, or a name built twice, throws (not `AppError`);
   - no parts → the build function returns `[]`.
   Run `pnpm --filter @waitron/module exec vitest run src/personal-data.test.ts`; watch them fail
   because the module does not exist.
2. Write `personal-data.ts` (it imports `./errors.js`, as `record-export.ts` does), add the seat
   to `WaitronModule`, export from `index.ts`.
3. Omission controls, each run and reverted: drop the uniqueness check → the two-part duplicate
   case fails; switch the loop to `Promise.all` → the in-turn case fails; drop the undeclared-name
   check → its case fails.
4. Run `pnpm --filter @waitron/module exec vitest run` and `pnpm --filter @waitron/module typecheck`.

## Task 2 — the identity part

Files: `packages/identity/src/personal-data.ts` (new), `packages/identity/src/personal-data.test.ts`
(new), `packages/identity/src/index.ts` (export `IDENTITY_PERSONAL_DATA`).

Interface: `export const IDENTITY_PERSONAL_DATA: ModulePersonalData` with
`files: ["profile.json", "sign-in.json"]`. `prepare` runs one query per table in decision 10,
each awaited in turn, keyed by `subject.personId`; the build step only shapes and serialises what
was read. The file throws `person.not_found`, so it imports identity's `./errors.js`.

1. Tests first, in `personal-data.test.ts` (`useVenueDb` with the core and identity migrations;
   shared helpers in `packages/identity/test/fixtures.ts`):
   - **Fixture.** Marta, with a distinct value in every "in" column of `persons` and at least one
     row in every table of decision 10, each row with a distinct, explicit timestamp: two
     passkeys, three unused and two used recovery codes, a PIN session on a device labelled with a
     distinct name, an open and an ended dashboard session, one account email of each purpose, one
     row in each of the three unfinished-setup tables, and two device-profile exceptions. A
     colleague with different distinct values in every one of the same places. One sign-in
     challenge and one Google sign-in state with no person.
   - **Exact files.** Prepare, build, parse both files; `toEqual` the full expected objects of
     decision 10 (every key, every list in the order decision 10 defines). Marta's values all
     present (the design's S2 test: "a distinct value in every table that names the person, each
     asserted present").
   - **No secrets.** Gather every secret the fixture wrote, for both people: PIN hash, password
     hash, two-factor ciphertext, Google subject, both passkeys' credential ids and public keys,
     recovery-code hashes, both session token hashes, account-email token and code hashes, the
     setup ciphertext, both challenges, the Google states' hashes, nonces and verifiers. Assert
     none appears in either file's text. In the same helper, assert that Marta's telephone **is**
     found, so a search that finds nothing fails (the design's negative control is step 3 below).
   - **Only hers.** None of the colleague's distinct values appears.
   - **An empty person.** A person with only a display name gets both files, with nulls, empty
     lists, zero counts and `false`.
   - **A suspended person** gets the same files (S2c downloads them).
   - **An unknown id** throws `person.not_found`.
   Run `pnpm --filter @waitron/identity exec vitest run src/personal-data.test.ts`; watch it fail.
2. Write the part and export it.
3. Omission controls, each run and reverted, with the failing line recorded for the pull request:
   put `pinHash: person.pinHash` into `profile.json` → the no-secrets case fails (the design's
   "put one in and see it fail"); drop the `person_id` condition from the device-session query →
   "only hers" fails; drop `deviceProfileExceptions` → the exact-files case fails.
4. Run `pnpm --filter @waitron/identity exec vitest run` and
   `pnpm --filter @waitron/identity typecheck`.

## Task 3 — the completeness guard and the composition wiring

Files: `packages/identity/src/personal-data.coverage.test.ts` (new),
`packages/composition/src/modules.ts` (identity's entry gains `personalData: IDENTITY_PERSONAL_DATA`
beside `:201`), `packages/composition/src/composition.test.ts`.

1. Tests first:
   - **Tables.** From the exports of `packages/identity/src/schema/index.ts`, keep only drizzle
     tables (`is(value, SQLiteTable)`: the index also exports the `personStatus` and `personRole`
     enums), then list those with a `person_id` column (through drizzle's `getTableConfig`), plus
     `persons`; it must equal the ten tables of decision 10.
   - **Columns.** For each of those ten tables, the full column set from `getTableConfig` must
     equal the test's "in" list plus its "out" list for that table, copied from decision 10's two
     tables, with no column in both. A new column then fails the test until someone classifies it;
     S11 will add a deactivation date to `persons` and meet this. Both checks are weaker than their
     names: they know a person column only by the name `person_id`, and they prove a column was
     classified, not that the part honours the classification (Task 2's exact-files and
     no-secrets cases do that).
   - In `composition.test.ts`, beside the staff-notices and time-record cases (`:324-350`):
     identity carries `IDENTITY_PERSONAL_DATA` by reference; no other module carries the seat yet
     (S2b changes this list); `validatePersonalDataParts(personalDataParts(ALL_MODULES))` does not
     throw.
   Run `pnpm --filter @waitron/identity exec vitest run src/personal-data.coverage.test.ts` and
   `pnpm --filter @waitron/composition exec vitest run src/composition.test.ts`; watch the
   composition cases fail.
2. Wire identity's entry in `modules.ts`.
3. Omission controls: remove one table from the expected list → the tables check fails; move one
   `persons` column out of both lists → the columns check fails.
4. Run `pnpm --filter @waitron/composition exec vitest run`, and from the repository root
   `pnpm exec vitest run scripts/module-seams.test.ts scripts/english-only.test.ts scripts/workspace-cycles.test.ts`.

## Task 4 — the ZIP and the file name (`@waitron/server`)

Files: `apps/server/package.json` and `pnpm-lock.yaml` (`pnpm --filter @waitron/server add fflate@^0.8.3`),
`apps/server/src/download-archive.ts` (new), `apps/server/src/download-archive.test.ts` (new).

Interfaces:

```ts
export function archiveFileName(label: string, at: Date, timeZone: string): string; // "marta-lopez-2026-10-05.zip"
export function zipArchive(files: readonly PersonalDataFile[], at: Date): Uint8Array;
```

`archiveFileName` validates `timeZone` the way `readVenueTimeZone` does and uses UTC when it is
unknown; S3 reuses both functions for an invoice customer.

1. Tests first:
   - the names of decision 8, one case each, including `person` for an empty result and the
     60-character cut with no trailing hyphen;
   - the date: `2026-10-04T22:30:00Z` in `Europe/Madrid` gives `…-2026-10-05.zip`, and in `UTC`
     `…-2026-10-04.zip` (an instant where the two answers differ, so a function that ignored the
     zone fails); an unknown zone gives the UTC date;
   - `zipArchive`: `unzipSync` gives back exactly the names and bytes given, string content as
     UTF-8 (a `López` survives); the archive starts with `PK\x03\x04` and its last 22 bytes are the
     end record (`PK\x05\x06`; true while no archive comment is written, and `zipArchive` writes
     none) with the right entry count, read by hand, so one check does not depend on fflate's own
     reader; a single entry named `café.txt` has bit 11 set in the general-purpose flag (bytes 6-7
     of its local header) and one named `profile.json` does not.
   Run `pnpm --filter @waitron/server exec vitest run src/download-archive.test.ts`.
2. Write the module.
3. Omission controls: skip the accent removal → the `López` name case fails; format the date in
   UTC regardless → the Madrid case fails.
4. Run `pnpm --filter @waitron/server typecheck`.

## Task 5 — the route

Files: `apps/server/src/personal-data-export-api.ts` (new),
`apps/server/src/personal-data-export-api.test.ts` (new).

Interface:

```ts
export interface PersonalDataExportDeps {
  db: Database;
  nodeId: string;
  modules: readonly WaitronModule[];
  /** Parts the server adds itself; empty in S2a1 (decision 5). */
  serverParts?: readonly PersonalDataPart[];
  now?: () => Date;
}
export type PersonalDataAuthorize = (tx: Transaction) => Promise<{ personId: string; label: string }>;
export function sendPersonalData(
  c: Context,
  deps: PersonalDataExportDeps,
  authorize: PersonalDataAuthorize,
): Promise<Response>;
export function withPersonalDataErrors(
  c: Context,
  log: Logger,
  fn: () => Promise<Response>,
): Promise<Response>;
export function mountPersonalDataExportApi(app: Hono, deps: PersonalDataExportDeps, log: Logger): void;
```

The file imports `./errors.js` (it throws `management.request_invalid`). Decision 7 gives the flow.

1. Tests first (`useVenueDb` with core and identity migrations; a tenant, a location in
   `Europe/Madrid`, a node at that location; mount with the real identity entry from `ALL_MODULES`
   plus one stub server part that adds `extra.json`):
   - Marta's session, `now` at `2026-10-04T22:30:00Z`: 200; the four headers of decision 7 exactly,
     the name `marta-lopez-2026-10-05.zip`; the body unzips to exactly `profile.json`,
     `sign-in.json`, `extra.json`; `profile.json` carries her email; the stub's `prepare` received
     `{ personId: <Marta>, at: <now>, timeZone: "Europe/Madrid", locationId: <the location> }`.
   - Only hers: none of a colleague's distinct values in any unzipped file; with `?personId=<colleague>`
     the answer is 400 `management.request_invalid` `{ field: "query" }`.
   - No hash end to end: Marta's PIN hash and the token hash of the very session that asked are in
     no unzipped file; her email is (the positive control).
   - Refusals, each asserting the code: no cookie → 401 `management_session.required`; an ended
     session → 401 `management_session.required`; a session idle past `IDLE_TIMEOUT_MS` (set
     `last_seen_at` back by SQL) → 401 `management_session.expired`; a person suspended by SQL with
     a live session → 403 `person.suspended`.
   - **`authorize` runs twice.** Mount a test route whose handler is
     `withPersonalDataErrors(c, log, () => sendPersonalData(c, deps, spy))`, with a spy
     `authorize`: it is called exactly twice, once before the parts' `prepare` and once after their
     build functions (record the order). When the spy returns a different person id the second
     time, the answer is 500 `server.internal` and no ZIP.
   - Re-check after building: the stub part's build function ends Marta's session through
     `withTransaction` → 401 `management_session.required` and no ZIP. This also shows the build
     runs after the snapshot transaction has closed: had it run inside, that `withTransaction`
     would not wait but be refused at once by the write queue ("write lock: a body asked for the
     lock it is already holding", `packages/store/src/write-queue.ts:38-43`), and the route would
     answer 500 `server.internal`, not 401.
   - Nothing written: set the session's `last_seen_at` back five minutes by SQL (inside the
     30-minute idle limit, so the download is still allowed) and check it is unchanged afterwards;
     a resolve with `touch: true` would move it to the present.
   - Time zone fallback: with the node row's id not matching `deps.nodeId`, the same instant gives
     `…-2026-10-04.zip` and the stub's subject has `timeZone: "UTC"` and `locationId: null`.
   Run `pnpm --filter @waitron/server exec vitest run src/personal-data-export-api.test.ts`.
2. Write the route.
3. Omission controls: remove the second `authorize` call → the "runs twice" case and the re-check
   case fail; remove the person-id comparison → the "different person" case fails; remove the
   query refusal → the `?personId=` case fails; resolve with `touch: true` → the "nothing written"
   case fails; drop `Cache-Control` → the header case fails.
4. Run `pnpm --filter @waitron/server typecheck`.

## Task 6 — mount it from `mountMeApi`, prove it in a real start, update the backlog

Files: `apps/server/src/me-api.ts` (optional `now` in `MeApiDeps`; the mount call),
`apps/server/src/modules.ts` (`modulesNamed`), `apps/server/src/me-api.personal-data-export.test.ts`
(new), `apps/server/src/boot.personal-data-export.test.ts` (new), `docs/backlog.md`,
`docs/backlog/data-protection.md`, `docs/superpowers/plans/2026-10-24-a980-data-protection-build.md`.

1. Tests first:
   - Through `mountMeApi` with `modules: ["core", "identity"]`: a signed-in person's download is a
     ZIP holding `profile.json` with their display name. With `modules: ["core"]` the ZIP holds no
     identity file (the enabled set, not every module, is read).
   - One boot-level case, primary mode only, modelled on `boot.attendance-export.test.ts` (which
     starts a real server through `serverFixture` and `createClockVenue`): `GET
     /management-api/me/personal-data/export` with a management session answers 200,
     `application/zip`, and the ZIP's `profile.json` names the venue's person. This is the check
     for decision 9's reading of `boot.ts`.
   Run `pnpm --filter @waitron/server exec vitest run src/me-api.personal-data-export.test.ts src/boot.personal-data-export.test.ts`.
1b. The notice control, before the mount (decision 6: CI will not read the notice on this pull
   request). The route exists but nothing the server starts from imports it yet: run
   `pnpm --filter @waitron/server build` and
   `/usr/bin/grep -c "fflate 0.8.3" apps/server/dist/server.js.NOTICES.txt`, which should print
   `0`. Record it.
2. Add `modulesNamed`, the optional `now`, and the mount call inside `mountMeApi`. `boot.ts` is
   not edited. Run step 1b's two commands again: they must print `1`. Record it; starting the
   bundle is CI's `bundle-smoke` job, which runs on this pull request.
3. Omission control: remove the mount call → both new test files fail.
4. Run the existing tests that call `mountMeApi`, unedited:
   `pnpm --filter @waitron/server exec vitest run src/me-api.test.ts src/me-api.cross-person.test.ts src/me-api.no-tenant.test.ts src/management-api-passkey.test.ts`,
   and `pnpm --filter @waitron/server typecheck`.
5. Docs: in `docs/backlog/data-protection.md`, the S2 point lists only what is left (S2a2, S2b,
   S2c) and says the server route exists with no button yet; `docs/backlog.md`'s A980 entry stays
   accurate; the build overview's status line notes S2a1 built, with a link to this plan. Run
   `pnpm exec prettier --file-info <file>` on each changed doc (`docs/` is ignored by prettier, so
   it prints `"ignored": true` and no format step applies).

## Review focus

- **Secrets.** Nothing in either file is a hash, token, key, challenge, ciphertext, the Google
  subject or a passkey's credential id; the no-secrets test searches unzipped text and has its
  positive control.
- **Whose data.** The own route can only ever export the session's person: no query, no path
  parameter, the person id taken from `authorize` in both transactions and compared.
- **Authorisation after building.** The second transaction re-runs the caller's own `authorize`,
  so S2c's permission check is repeated there too.
- **What S2b and S2c change.** Decision 5: S2b adds module seat values and one server-side part
  through `serverParts`; S2c adds a route with its own `authorize` and the actions part. Neither
  changes `sendPersonalData` or the gatherer. Nothing slow runs while the write lock is held.
- **Column coverage.** Decision 10's tables against `packages/identity/src/schema/`, held by Task
  3's column check. Reviewers may disagree with an "out" (for example the Google subject or the
  passkey counter); the default follows the design's "names and dates" for passkeys and the slice
  brief's yes/no for Google.
- **Device labels (reviewer decision).** A label can name a colleague ("Marta's phone"); the
  default exports it for the person's own sessions (decision 10).
- **The new dependency.** fflate is MIT, has no dependencies of its own, and its notice reaches
  `/app/third-party/npm/server/server.js.NOTICES.txt` through the existing generator. CI builds
  the bundle on this pull request but never reads the notice text, and its image job does not run
  here (decision 6), so Task 6's notice-file count before and after the mount is the evidence
  before merge; the push to `main` builds the image for real.
- **`boot.ts` untouched**, and the boot test passes.
