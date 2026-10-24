# A980 slice S2a1: a staff member downloads their own data (server side)

**Status: plan, 2026-10-24. Nothing is built.** Design:
[A980 data protection, revision 2](../specs/2026-10-22-a980-data-protection-design.md) §4.2 (the
download and its worked example), §2.1 and §2.3 (what is held), §5.3 row S2 (its tests), §8 owner
answer O5 ("staff should be able to download their own data"). Overview:
[the build plan](2026-10-24-a980-data-protection-build.md), row S2a1 and "Notes for each slice →
S2a1". Branch `feat/a980-s2a1-own-download`. No migration; reads only. FULL review (personal
data): per-task reviews run, then `/finish-branch`.

**Words used here.** A **seat** is a slot on a module's description (`WaitronModule`,
`packages/module/src/module.ts:1541-1599`) that the module fills with its own code, so shared code
can call every enabled module without naming any of them. A **ZIP** is the one-file archive the
person downloads. **fflate** is a small JavaScript compression library (MIT licence). A
**snapshot transaction** is the one database transaction in which every part of the download is
read, so all parts describe the same moment.

## What this slice builds, and what it leaves

`GET /management-api/me/personal-data/export` answers a signed-in person with a ZIP of what the box
holds about them. In this slice the ZIP holds two files, both from the identity module:
`profile.json` and `sign-in.json`. The parts are gathered through a new seat, `personalData`, so
S2b adds the workforce and staffing files by filling the same seat in those modules, and S2c adds
an admin's download of another person as a second route that calls the same gatherer with that
person's id.

Left for later, on purpose:

- **No README in the ZIP.** S2a2 adds `README.txt` (purposes, recipients, how long data is kept,
  the person's rights) in English and Spanish, from a file under `apps/server/src/i18n/`. Without
  it the ZIP is already a correct machine-readable copy of the identity data (the Article 20 part
  of design §4.2), but not yet a complete Article 15 answer, which also needs that explanation.
- **No button and no guide page.** S2a2 adds the Profile page's button and the guide text. Until
  then nothing in the dashboard links to the route, so no guide page changes here.
- **No workforce, staffing or actions files** (S2b, S2c), and no other person's download (S2c).

## Decisions this plan makes that the design does not

1. **The identity part is a seat contribution, not a function the route calls by name.** Identity
   is a module like the others: it is listed in `ALL_MODULES` (`packages/composition/src/modules.ts:188-202`),
   is `toggleable` (`:191`), and already fills four seats there (classification, backup check,
   change feed, configuration transfer at `:201`). The server also calls identity directly as an
   ordinary dependency (`apps/server/src/me-api.ts:15-34`; the composition comment at
   `modules.ts:129-130` calls identity one of the "ordinary dependencies of the packages that use them", not a slot). Default:
   identity fills the new seat with `IDENTITY_PERSONAL_DATA`, exported from `@waitron/identity`
   and wired into its `ALL_MODULES` entry. Why: the route then has one loop over enabled modules
   and never names a part; S2b adds files exactly the same way; and a module switched off is
   skipped by the loop, where a direct call would query tables that were never created (a disabled
   module's tables are not migrated: `apps/server/src/modules.ts`, the comments on
   `enabledFloorAnnotators` and `enabledAlertSources`).

2. **The seat reads inside the transaction and builds its files after it closes.** Shape, in a new
   `packages/module/src/personal-data.ts`:

   ```ts
   export interface PersonalDataSubject {
     readonly personId: string;
   }
   export interface PersonalDataFile {
     /** A name this module declared in `files`. */
     readonly name: string;
     readonly content: string | Uint8Array;
   }
   export interface ModulePersonalData {
     /** Every file name this module may add; unique across all modules. */
     readonly files: readonly string[];
     /** Reads everything this module holds about the person, inside the caller's transaction, and
      * returns a function that builds the files once that transaction has closed. The returned
      * function must not use `tx`. */
     prepare(
       tx: Transaction,
       subject: PersonalDataSubject,
     ): Promise<() => Promise<readonly PersonalDataFile[]>>;
   }
   ```

   and on `WaitronModule`, beside `timeRecordExport` (`module.ts:1579`):
   `readonly personalData?: ModulePersonalData;`. The two steps copy the time-record export's seat
   (`packages/module/src/record-export.ts:6-8`) and its route, which formats after the transaction
   and checks the session again before sending (`apps/server/src/attendance-export-api.ts:119`).
   Why it matters here: `withTransaction` holds the venue's write lock for its whole body
   (`packages/db/src/tenancy.ts:30-42`), so a sale waits while a transaction is open, and S2b's
   working-time PDF must not be drawn inside one. The identity part has nothing slow to build; it
   uses the same shape so S2b changes no contract.

3. **File names are declared up front and checked twice.** A module lists its file names in
   `files`. Each must match `^[a-z0-9]+(?:-[a-z0-9]+)*\.(?:json|csv|pdf)$` (lower-case ASCII, so
   S2a2's `README.txt` can never collide and no name needs the ZIP's UTF-8 flag) and be unique
   across every module. `validatePersonalDataSeats(modules)` refuses a bad or repeated name with
   the existing `module.config_invalid` code (`packages/module/src/errors.ts`, `{ reason }`), as
   `selectTimeRecordExport` does for two providers (`record-export.ts:9-19`). The composition test
   runs it over `ALL_MODULES`, so a collision S2b introduces fails before it ships. At run time the
   gatherer also refuses a built file whose name the module did not declare, or a name built twice,
   with a plain `Error` (a programming fault: the route answers `server.internal`, 500).

4. **One gatherer, keyed by person id, in `@waitron/module`.**
   `preparePersonalData(tx, modules, subject)` validates the seats (decision 3), calls each enabled
   module's `prepare` in module order, each awaited before the next (never `Promise.all`: queries
   on one transaction are awaited in turn, home CLAUDE.md §3), and returns one function that builds
   every module's files in the same order and checks the names. It sits beside
   `selectTimeRecordExport`, the contract's other export helper. S2c's admin route calls it with the
   other person's id; nothing in it knows whose session asked.

5. **The ZIP is made with fflate, declared as a dependency of `@waitron/server`, not a hand-written
   writer.** Receipts:
   - fflate 0.8.3 is already installed, as a dependency of `pdfkit` and `png-js`
     (`pnpm-lock.yaml`, the `pdfkit@0.20.2` and `png-js@2.0.0` entries), but it is **not** in the
     server bundle today. Command, run 2026-10-24 from `apps/server`:
     `pnpm exec esbuild src/bin.ts --bundle --platform=node --format=esm --target=node24 --external:sharp --outfile=$T/server.js --metafile=$T/server.js.meta.json`
     (the flags `scripts/bundle-node.mjs:15-27` uses). The metafile's inputs matching
     `fflate|png-js` were one file, `png-js/lib/png-js.js`, and `grep -c fflate` on the bundle
     printed `0`. pdfkit's Node build imports fflate nowhere (`grep -l fflate` over its `js/`
     folder lists only the browser builds). So declaring fflate adds new third-party code to the
     image.
   - Its licence notice is produced without any hand step. Each server bundle's notice file is
     generated from esbuild's input list by `scripts/npm-bundle-notices.mjs` and copied to
     `/app/third-party/npm/server/` (`deploy/Dockerfile:226-234`; `deploy/third-party/README.md`,
     "Bundled npm packages"). Running that generator over a test bundle that imports fflate wrote a
     file whose first entry was `===== fflate 0.8.3 — LICENSE =====` followed by the MIT text. No
     fallback file is needed (fflate ships `LICENSE`), so `deploy/third-party/` does not change.
     The home rule on licence notices (CLAUDE.md §3, "A change adding third-party code … carries
     its licence notices") is met by that generated file; the image build fails if a bundled
     package has no notice: the generator throws (`scripts/npm-bundle-notices.mjs:58`). On this
     pull request CI runs that generator, because the `bundle-smoke` job builds the server
     (`.github/workflows/ci.yml:497`), but nothing in CI reads what the notice file says, and the
     `image` job, which copies it into the image, does not run: on a pull request it runs only when
     an image input changed, meaning `deploy/` or the files image-smoke runs (its `if:` at
     `ci.yml:671`; `isImageInputPath`, `scripts/changed-scope.mjs:140-142`), and
     `apps/server/package.json` is neither. So Task 5 builds the server bundle locally and reads the
     notice file.
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
     moment of the request. fflate writes that time in the server process's own time zone (its
     `index.mjs:1902-1905` uses `getHours()` and friends; in the experiment a `10:15Z` time read
     back as `12:15` on a machine in Madrid summer time). The box's process zone is not the
     venue's, and we do not correct it: the entry time is cosmetic, and the file name carries the
     venue's date (decision 7).

6. **The route, its address and its answer.**
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
   - **No last-seen stamp.** Both transactions resolve the session with `touch: false`, so the
     route writes nothing. The home rule says a housekeeping write on a read path must not take
     the read down on a full disk (CLAUDE.md §3); not writing at all is the simplest way to meet it.
     Cost: a download does not count as activity for the 30-minute idle timer.
   - Answer: `Content-Type: application/zip`;
     `Content-Disposition: attachment; filename="<slug>-<date>.zip"`;
     `Cache-Control: no-store`; `X-Content-Type-Options: nosniff` (the last three as
     `attendance-export-api.ts:138-143`; its content type is set at `:134-137`).
   - Errors through a `createErrorBoundary` map of its own (log tag `personal_data.failed`, which
     is a log line's name, not an error code): `management_session.required` and
     `management_session.expired` 401, `person.suspended` 403, `module.config_invalid` 500. No new
     error code is added, so no registry, `scripts/errors-reachable.test.ts` or
     `scripts/alert-codes.test.ts` change is due.
   - Flow, in one shared function S2c reuses (`sendPersonalData`): take the time; open one
     transaction that resolves the subject, reads the venue's time zone and calls
     `preparePersonalData`; close it; build the files; open a second short transaction that
     resolves the session again (an ended or suspended session refuses here and no bytes are sent);
     zip; answer. S2c passes a different "resolve the subject" step (`authorizeManager` with
     `personal_data.export`, then the target's row) and adds nothing else.

7. **The file name: display name, made safe, plus the venue's date.**
   - The name is the person's display name (`persons.display_name`, never empty:
     `packages/identity/src/schema/persons.ts:31`, `:89`), which `resolveManagementSession`
     already returns (`management-session.ts:68`, `:99`).
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
     the same fallback as `readVenueTimeZone` (`apps/server/src/venue-time-zone.ts:5-19`). The zone
     is read in the snapshot transaction. On a mirror the node is the mirror's own
     (`boot.ts:2062`); if the copied database holds no row for it, the download is dated in UTC.

8. **Mounted from `mountMeApi`, so `apps/server/src/boot.ts` does not change.** Open pull request
   #1990 changes `boot.ts` and waits for the owner (`gh pr view 1990`, 2026-10-24: open, a fiscal
   slice the owner lands, `apps/server/src/boot.ts` among its files). `boot.ts` calls `mountMeApi` with
   `cfg: { nodeId: till.nodeId }` and `modules: setsToMigrate.map((m) => m.name)`
   (`boot.ts:2057-2065`), where `setsToMigrate` is drawn from the module host's list, which boot
   creates from `ALL_MODULES` (`boot.ts:868-874`, `:896`, `:942-943`). `mountMeApi` turns those
   names back into module descriptions with a new `modulesNamed(names)` in
   `apps/server/src/modules.ts` (the members of `ALL_MODULES`, in its order, whose name is listed)
   and calls `mountPersonalDataExportApi(app, { db, nodeId: deps.cfg.nodeId, modules, now }, log)`
   from a new `apps/server/src/personal-data-export-api.ts`. The attendance export's mount
   (`management-attendance-api.ts:67-72`) was not used: boot mounts it only when workforce is on
   and the node is the single primary (`boot.ts:2036-2046`), and the identity part must not depend
   on workforce. That the names really reach the identity part in a real start is shown by the boot
   test in Task 5, not by this reading.

9. **What the identity part contains.** Rule: every column of every identity row that names the
   person, except secrets (hashes, keys, tokens, challenges, encrypted values, the codes behind a
   sign-in ceremony), copies derived from another column (the `_folded` columns), and internal row
   ids; a secret's existence is shown as yes/no. Timestamps appear as stored (ISO 8601, UTC).
   Every list is sorted by its first time column, then by row id, so the output is the same on
   every run.

   **`persons`** (`packages/identity/src/schema/persons.ts:31-67`), all 20 columns:

   | Column | In? | Where, or why not |
   | --- | --- | --- |
   | `id` | in | `profile.json` `id`: the person's identifier in the venue's records, which S2b and S2c's files refer to |
   | `display_name` | in | `displayName` |
   | `display_name_folded` | out | the display name in lower case, for a uniqueness check; adds nothing |
   | `first_names` | in | `firstNames` |
   | `last_names` | in | `lastNames` |
   | `telephone` | in | `telephone` |
   | `pin_hash` | out | secret; shown as `sign-in.json` `pinSet` |
   | `password_hash` | out | secret; `passwordSet` |
   | `totp_secret` | out | encrypted two-factor secret; `twoFactorOn` |
   | `locale` | in | `locale` |
   | `passkey_offered_at` | in | `sign-in.json` `passkeyOfferedAt` |
   | `email` | in | `email` |
   | `email_folded` | out | derived, as above |
   | `pending_email` | in | `pendingEmail` |
   | `pending_email_folded` | out | derived, as above |
   | `email_verified_at` | in | `emailVerifiedAt` |
   | `google_subject` | out | Google's account identifier used to sign in; the slice brief lists "Google linked yes/no"; `googleLinked` |
   | `role` | in | `role` |
   | `status` | in | `status` |
   | `created_at` | in | `createdAt` |

   **The other identity tables that name a person** (every identity table with a `person_id`
   column, `packages/identity/src/schema/*.ts`):

   | Table | What goes in | Left out, and why |
   | --- | --- | --- |
   | `webauthn_credentials` (passkeys) | `passkeys[]`: `name`, `provider` (the provider's name from the AAGUID, through `passkeyProviderName`, as the Profile page shows it: `profile.ts:202-231`), `createdAt`, `lastUsedAt` | `credential_id` (the handle a sign-in presents, like the Google subject), `public_key` (never, per the slice brief), `counter` and `transports` (values the authenticator keeps about itself); the design's example says "passkeys: names and dates" (§4.2) |
   | `recovery_codes` | `recoveryCodes`: `{ unused, used }` counts | `code_hash` (secret); the slice brief says "count only" |
   | `sessions` (a PIN sign-in on a device) | `deviceSessions[]`: `device` (the device's label, joined from `devices`), `openedAt`, `endedAt` | `token_hash` (works as a login: home CLAUDE.md §3 "stored as a hash") |
   | `management_sessions` (dashboard sign-ins) | `dashboardSessions[]`: `openedAt` (`created_at`), `lastSeenAt`, `endedAt` | `token_hash`, as above |
   | `management_account_actions` (invitation, password-reset and email-change emails) | `accountEmails[]`: `purpose`, `newEmail` (`target_email`, for an email change), `createdAt`, `expiresAt`, `usedAt`, `codeExpiresAt`, `codeAttempts` | `token_hash`, `code_hash` (secrets) |
   | `totp_enrollments` (a two-factor setup not yet finished) | `unfinishedSetups[]` `{ kind: "two-factor", startedAt, expiresAt }` | `encrypted_secret` |
   | `webauthn_challenges` (a passkey setup not yet finished; rows with no person are sign-in attempts and are not about anyone) | `unfinishedSetups[]` `{ kind: "passkey", startedAt, expiresAt: null }` | `challenge` (never, per the slice brief) |
   | `google_oidc_states` (a Google link not yet finished; rows with no person are sign-ins) | `unfinishedSetups[]` `{ kind: "google-link", startedAt: null, expiresAt }` | `state_hash`, `nonce`, `verifier` (secrets) |
   | `device_profile_admission_persons` (a device profile that lets the person in, or keeps them out, whatever their role) | `profile.json` `deviceProfileExceptions[]`: `deviceProfile` (the profile's name, joined from `device_profiles`), `admitted` | nothing |

   `device_profile_admission_roles` names a role, not a person, so it is not read. Tables of other
   modules that name the person (who served a sale, working time, rota, absences) come through
   their own modules' seats in S2b and S2c.

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

10. **`sessions` is read without an index on `person_id`, and none is added.** Its only indexes
    are on the device and the token hash (`schema/sessions.ts:25-26`), and adding one is a
    migration, which this slice does not carry. Experiment, 2026-10-24: in an in-memory
    `node:sqlite` database with this table's shape and 300,000 rows (60 people), selecting one
    person's 5,000 rows sorted by time took about 9 ms on this Mac, three runs. That is not a
    measurement on a box, whose disk and processor may be slower; the read runs while the write lock
    is held, once per download. If a box measurement shows it slow, the index is its own later
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

## Task 1 — the seat and the gatherer (`@waitron/module`)

Files: `packages/module/src/personal-data.ts` (new), `packages/module/src/personal-data.test.ts`
(new), `packages/module/src/module.ts` (the `personalData?` line), `packages/module/src/index.ts`
(exports).

Interfaces (decision 2 gives the types):

```ts
export function validatePersonalDataSeats(modules: readonly WaitronModule[]): void;
export function preparePersonalData(
  tx: Transaction,
  modules: readonly WaitronModule[],
  subject: PersonalDataSubject,
): Promise<() => Promise<PersonalDataFile[]>>;
```

1. Write the tests first, with stub modules (no database; pass `{} as Transaction`):
   - validation accepts distinct well-formed names across two modules, and a module without the
     seat;
   - it refuses, with `module.config_invalid`: the same name in two modules; the same name twice
     in one module; `README.txt`; `Profile.json`; `a/b.json`; `café.json`; `profile.txt`;
     `-profile.json`;
   - `preparePersonalData` calls every `prepare` before any build function, in module order, with
     the transaction and subject it was given (record the calls in an array);
   - it awaits each `prepare` before calling the next (the second stub's `prepare` must not be
     called while the first's promise is still pending: hold it with a promise the test resolves);
   - the build function returns all files in module order;
   - a built file with an undeclared name, or a name built twice, throws (not `AppError`);
   - no module with the seat → the build function returns `[]`.
   Run `pnpm --filter @waitron/module exec vitest run src/personal-data.test.ts`; watch them fail
   because the module does not exist.
2. Write `personal-data.ts` (it imports `./errors.js`, as `record-export.ts` does), add the seat
   to `WaitronModule`, export from `index.ts`.
3. Omission controls, each run and reverted: drop the uniqueness check → the two-module duplicate
   case fails; switch the loop to `Promise.all` → the in-turn case fails; drop the undeclared-name
   check → its case fails.
4. Run `pnpm --filter @waitron/module exec vitest run` and `pnpm --filter @waitron/module typecheck`.

## Task 2 — the identity part, wired into the composition list

Files: `packages/identity/src/personal-data.ts` (new), `packages/identity/src/personal-data.test.ts`
(new), `packages/identity/src/index.ts` (export `IDENTITY_PERSONAL_DATA`),
`packages/composition/src/modules.ts` (identity's entry gains `personalData: IDENTITY_PERSONAL_DATA`
beside `:201`), `packages/composition/src/composition.test.ts`.

Interface: `export const IDENTITY_PERSONAL_DATA: ModulePersonalData` with
`files: ["profile.json", "sign-in.json"]`. `prepare` runs one query per table in decision 9, each
awaited in turn, keyed by `subject.personId`; the build step only shapes and serialises what was
read.

1. Tests first, in `personal-data.test.ts` (`useVenueDb` with the core and identity migrations;
   shared helpers in `packages/identity/test/fixtures.ts`):
   - **Fixture.** Marta, with a distinct value in every "in" column of `persons` and at least one
     row in every table of decision 9: two passkeys, three unused and two used recovery codes, a
     PIN session on a device labelled with a distinct name, an open and an ended dashboard session,
     one account email of each purpose, one row in each of the three unfinished-setup tables, and
     one device-profile exception. A colleague with different distinct values in every one of the
     same places. One sign-in challenge and one Google sign-in state with no person.
   - **Exact files.** Prepare, build, parse both files; `toEqual` the full expected objects of
     decision 9 (every key, every list in its order). Marta's values all present (the design's S2
     test: "a distinct value in every table that names the person, each asserted present").
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
   - **Completeness guard.** List every table exported by `packages/identity/src/schema/index.ts`
     that has a `person_id` column (read through drizzle's table config), plus `persons`; it must
     equal the test's own list of tables the fixture seeds. A new identity table that names a
     person then fails here until the part and the fixture include it. Weaker than its name: it
     knows a person column only by the name `person_id`.
   - In `composition.test.ts`, beside the staff-notices and time-record cases (`:324-350`):
     identity carries `IDENTITY_PERSONAL_DATA` by reference; no other module carries the seat yet
     (S2b changes this list); `validatePersonalDataSeats(ALL_MODULES)` does not throw.
   Run `pnpm --filter @waitron/identity exec vitest run src/personal-data.test.ts` and
   `pnpm --filter @waitron/composition exec vitest run src/composition.test.ts`; watch them fail.
2. Write the part; export it; wire it into `modules.ts`.
3. Omission controls, each run and reverted, with the failing line recorded for the pull request:
   put `pinHash: person.pinHash` into `profile.json` → the no-secrets case fails (the design's
   "put one in and see it fail"); drop the `person_id` condition from the device-session query →
   "only hers" fails; drop `deviceProfileExceptions` → the exact-files case fails; remove one table
   from the test's seeded list → the completeness guard fails.
4. Run `pnpm --filter @waitron/identity exec vitest run`, `pnpm --filter @waitron/identity typecheck`,
   `pnpm --filter @waitron/composition exec vitest run`, and from the repository root
   `pnpm exec vitest run scripts/module-seams.test.ts scripts/english-only.test.ts scripts/workspace-cycles.test.ts`.

## Task 3 — the ZIP and the file name (`@waitron/server`)

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
   - the names of decision 7, one case each, including `person` for an empty result and the
     60-character cut with no trailing hyphen;
   - the date: `2026-10-04T22:30:00Z` in `Europe/Madrid` gives `…-2026-10-05.zip`, and in `UTC`
     `…-2026-10-04.zip` (an instant where the two answers differ, so a function that ignored the
     zone fails); an unknown zone gives the UTC date;
   - `zipArchive`: `unzipSync` gives back exactly the names and bytes given, string content as
     UTF-8 (a `López` survives); the archive starts with `PK\x03\x04` and its last 22 bytes are the
     end record (`PK\x05\x06`; true while no archive comment is written, and `zipArchive` writes
     none) with the right entry count, read by hand, so one check does not
     depend on fflate's own reader; a single entry named `café.txt` has bit 11 set in the
     general-purpose flag (bytes 6-7 of its local header) and one named `profile.json` does not.
   Run `pnpm --filter @waitron/server exec vitest run src/download-archive.test.ts`.
2. Write the module.
3. Omission controls: skip the accent removal → the `López` name case fails; format the date in
   UTC regardless → the Madrid case fails.
4. Run `pnpm --filter @waitron/server typecheck`.

## Task 4 — the route

Files: `apps/server/src/personal-data-export-api.ts` (new),
`apps/server/src/personal-data-export-api.test.ts` (new).

Interface:

```ts
export interface PersonalDataExportDeps {
  db: Database;
  nodeId: string;
  modules: readonly WaitronModule[];
  now?: () => Date;
}
export function mountPersonalDataExportApi(app: Hono, deps: PersonalDataExportDeps, log: Logger): void;
```

The file imports `./errors.js` (it throws `management.request_invalid`). Decision 6 gives the flow;
`sendPersonalData` stays private to the file until S2c needs it.

1. Tests first (`useVenueDb` with core and identity migrations; a tenant, a location in
   `Europe/Madrid`, a node at that location; mount with the real identity entry from `ALL_MODULES`
   plus one stub module whose seat adds `extra.json`):
   - Marta's session, `now` at `2026-10-04T22:30:00Z`: 200; the four headers of decision 6 exactly,
     the name `marta-lopez-2026-10-05.zip`; the body unzips to exactly `profile.json`,
     `sign-in.json`, `extra.json`; `profile.json` carries her email; the stub's `prepare` received
     `{ personId: <Marta> }`.
   - Only hers: none of a colleague's distinct values in any unzipped file; with `?personId=<colleague>`
     the answer is 400 `management.request_invalid` `{ field: "query" }`.
   - No hash end to end: Marta's PIN hash and the token hash of the very session that asked are in
     no unzipped file; her email is (the positive control).
   - Refusals, each asserting the code: no cookie → 401 `management_session.required`; an ended
     session → 401 `management_session.required`; a session idle past `IDLE_TIMEOUT_MS` (set
     `last_seen_at` back by SQL) → 401 `management_session.expired`; a person suspended by SQL with
     a live session → 403 `person.suspended`.
   - Re-check after building: the stub's build function ends Marta's session through
     `withTransaction` → 401 `management_session.required` and no ZIP. This also shows the build
     runs after the snapshot transaction has closed: inside it, that `withTransaction` would wait
     for the write lock the route holds and the test would time out.
   - Nothing written: the session's `last_seen_at` is unchanged after a download.
   - Time zone fallback: with the node row's id not matching `deps.nodeId`, the same instant gives
     `…-2026-10-04.zip`.
   Run `pnpm --filter @waitron/server exec vitest run src/personal-data-export-api.test.ts`.
2. Write the route.
3. Omission controls: remove the re-check transaction → the re-check case fails; remove the query
   refusal → the `?personId=` case fails; resolve with `touch: true` → the "nothing written" case
   fails; drop `Cache-Control` → the header case fails.
4. Run `pnpm --filter @waitron/server typecheck`.

## Task 5 — mount it from `mountMeApi`, prove it in a real start, update the backlog

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
     for decision 8's reading of `boot.ts`.
   Run `pnpm --filter @waitron/server exec vitest run src/me-api.personal-data-export.test.ts src/boot.personal-data-export.test.ts`.
2. Add `modulesNamed`, the optional `now`, and the mount call inside `mountMeApi`. `boot.ts` is
   not edited.
3. Omission control: remove the mount call → both new test files fail.
4. Run `pnpm --filter @waitron/server exec vitest run src/me-api.test.ts src/me-api.cross-person.test.ts`
   (the existing self-service tests, unedited) and `pnpm --filter @waitron/server typecheck`.
4b. The notice check CI will not make on this pull request (decision 5), with its control taken
   on this branch: before step 2 (the route exists but nothing the server starts from imports it
   yet), run `pnpm --filter @waitron/server build` and
   `/usr/bin/grep -c "fflate 0.8.3" apps/server/dist/server.js.NOTICES.txt`, which should print
   `0`; after step 2, the same two commands must print `1`. Starting the bundle is CI's
   `bundle-smoke` job, which runs on this pull request. Record both counts in the pull request.
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
  parameter, the person id taken from the resolved session in both transactions.
- **The seat contract.** S2b can add workforce and staffing files without touching the route or
  the gatherer, and S2c can add its route by passing a different subject step to
  `sendPersonalData`. Nothing slow runs while the write lock is held.
- **Column coverage.** Decision 9's tables against `packages/identity/src/schema/`; reviewers may
  disagree with an "out" (for example the Google subject or the passkey counter); the default
  follows the design's "names and dates" for passkeys and the slice brief's yes/no for Google.
- **The new dependency.** fflate is MIT, has no dependencies of its own, and its notice reaches
  `/app/third-party/npm/server/server.js.NOTICES.txt` through the existing generator. CI builds
  the bundle on this pull request but never reads the notice text, and its image job does not run
  here (decision 5), so Task 5's local notice-file count, with its before-and-after control, is the
  evidence before merge; the push to `main` builds the image for real.
- **`boot.ts` untouched**, and the boot test passes.
