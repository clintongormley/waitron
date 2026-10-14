# A639 — the Backups screen keeps a folder on the box AND a bucket at once

**Item:** lane B queue A639. **Owner decision (2026-10-14 ~10:40, watcher session):** "Both: bucket +
local". The A538 design's "one archive bucket plus optional local copies"
(`docs/superpowers/specs/2026-10-12-a538-archive-s3-design.md` §2) stands: from the dashboard the
owner keeps a folder on the box (for example a USB disk) AND one bucket (the bucket copy's bucket or
another) at the same time; each destination shows its own result, as the screen already does.

**Branch:** `feat/a639-backup-folder-and-bucket`, one pull request. **Review path:** FULL (the Save
request shape between dashboard and server changes; backup destinations). Per-task review after each
task. **Migration:** none.

## What is already true on `main` (read before building)

- The stored record already holds a LIST: `ArchiveSettings.destinations` is non-empty, ids unique,
  at most one bucket (`parseArchiveSettings`, `apps/server/src/archive-settings.ts`). Ids are fixed:
  a folder is `primary`, a bucket is `bucket`.
- The sweep, status and supervisor already fan out over several destinations, each with its own
  result (A538-3; environment-managed boxes have several today).
- Only two places force ONE: `POST /api/backup/apply` reads `destination` (one `ArchiveChoice`) and
  stores `destinations: [destination]` (`apps/server/src/backup-api.ts`), and the Backups form picks
  one of three kinds in one `wt-combobox` (`apps/dashboard/src/screens/backup-screen.ts`,
  `#renderDestinationField`; model in `backup-destination-model.ts`).
- Rotation rewrites the held settings unchanged (`/api/backup/rotate`), disable keeps them with
  `enabled: false`, and the archive recovery pack picks the held bucket with
  `.find((d) => d.kind === "s3")` — none of them assume one destination.

## Decisions this plan makes that the item does not (DEFAULT built)

1. **Request shape.** `POST /api/backup/apply` takes `destinations: ArchiveChoice[]` in place of
   `destination`. One or two entries; at most one `local-fs`; at most one of `stream-bucket` /
   `custom-s3`. The old `destination` field is removed, not kept alongside (pre-live, no
   compatibility code — CLAUDE.md §3). A body with `destination` is refused as an unknown field
   (`backup.request_invalid`, field `body`), as any unknown field is today.
2. **Refusals of the list itself** answer `backup.request_invalid` with field `destinations`: not an
   array, empty, more than two, two folders, two buckets, or an entry that is not an object. The
   cheap shape checks (an array, one or two entries, each an object) run in `readApplyBody`, where
   today's `isRecord(body.destination)` sits, so a malformed list is refused before the key checks
   inside the turn; the per-kind counts are `resolveArchiveChoices`'s. An entry's own refusal keeps
   today's field names (`dir`, `destination`, the bucket fields, `secretAccessKey`, `prefix`), so
   the screen keeps placing each beside its field.
3. **Stored order is fixed: the folder first, then the bucket**, whatever order the request listed
   them in — the stored record and the status list do not depend on how a request was written.
4. **Only the bucket is probed** before storing (as today); the folder is checked as today.
   The bucket copy's settings are read only when a bucket choice is in the list (as today).
   **A Save is all or nothing:** a failed bucket test, or unreadable bucket-copy settings when the
   bucket copy's bucket is chosen, refuses the whole Save, the folder included — nothing is
   written. This matches the existing message for a failed test ("…so nothing was saved",
   `apps/dashboard/src/i18n/codes.ts`), and keeps one Save one decision.
5. **The form:** the "Where to save backups" section becomes two controls:
   - a `wt-switch` **"A folder on this box"** (reusing `backup.destination.choice_local`, already
     "A folder on this box" / "Una carpeta de esta caja"; `name="archive-folder"`,
     `data-test="archive-folder-on"`); while on, the existing folder `wt-input` shows below it and is
     required (as today);
   - a `wt-combobox` **"Bucket"** (`name="archive-destination"`, `data-test="archive-destination"`,
     kept) with options **"No bucket"** (`none`), "The bucket copy's bucket", "Another S3-compatible
     bucket"; the stream and custom sub-fields show as today for their choice.
   - Neither chosen (switch off, "No bucket") is an invalid submission: once attempted, the bucket
     combobox carries the error **"Choose a folder on this box, a bucket, or both."** and the form's
     existing bottom message shows, and the action stays disabled until one is chosen (design-system
     → Forms). Nothing is sent. Neither control carries a required mark on its own (one of the two
     is required, not either) — deliberate; `wt-switch` has no `error` property, so the error sits
     on the combobox, which `focusFirstInvalid` reaches through `aria-invalid`.
   - Opening a fresh box: switch ON with an empty folder, "No bucket" — today's opening (folder,
     empty). **So a bucket-only Save on a fresh box now first turns the folder switch off**;
     existing tests that choose a bucket on a fresh box and save change by adding that step, and
     each goes into the Changed test checks list. Opening stored settings: switch on with the folder's path when a folder is stored;
     the bucket choice from the stored bucket (stream match → the bucket copy's bucket, otherwise
     another bucket with its fields), "No bucket" when none is stored.
   - The sentence "Backups go only to this bucket, not to a folder on this box."
     (`backup.destination.stream_replaces`, EN and ES) and its `data-test="stream-replaces"` hint are
     removed. `backup.destination.choice` / `choice_local` are replaced by the new labels; no key is
     left unused.
   - Turning the switch off keeps the typed folder in the draft (so turning it back on restores it),
     but a switched-off folder is never sent and never makes the draft differ — including in
     `#openStoredOff`'s unchanged check, which today compares raw fields: compare the request
     payloads there, or leave the folder text out while the switch is off.
   - Refusals stay under their own field until that field changes or the form is submitted again
     (design-system → Forms): a bucket-choice change clears only `customRefused`; the switch and
     folder edits clear `folderRefused`.
   - The folder field's "Enter the folder…" message shows only when the FOLDER is missing
     (`attempted && #folderMissing`), never because some other destination field is missing.
6. **Spanish:** "Una carpeta de esta caja" (switch), "Bucket" (combobox label), "Ningún bucket",
   "Elige una carpeta de esta caja, un bucket o los dos." — the implementer checks each against the
   sibling strings' vocabulary in `apps/dashboard/src/i18n/strings.ts` (the screen already says
   "bucket" and "caja").

## Global constraints

- TDD: each behaviour below gets a failing test first, seen failing for the stated reason.
- Server tests use the real database (`useVenueDb` as the existing suites do); screen tests run in
  real Chromium (`apps/dashboard` browser mode). Check `memory_pressure | grep free` before a browser
  run.
- **Changed test checks** (owner-approved for "choosing a bucket replaces the folder" in the queue
  item): every existing request body that sends `destination: X` becomes `destinations: [X]` — a
  mechanical rewrite, no assertion changes with it; every assertion that pins the single-choice
  behaviour (the `stream-replaces` hint, the combobox's old option list or label, an apply body's
  `destination` key) changes. Keep a running list of each changed check (file, test name, old →
  new) in the ledger; it goes into the PR's "Changed test checks" section.
- Keep everything A538-3/-4 made true: bounded destinations, truthful per-destination status, the
  choice preserved on rotation, held secret kept on a re-save of the same bucket place.
- No new error code. `backup.request_invalid` already maps to 400 and the screen already reads it.
- Comments only for an invariant or a non-obvious why (CLAUDE.md §1); update the doc comment on
  `resolveArchiveChoice` (it says "The one destination a dashboard Save asks for") and the comment
  in the apply route that says unreadable bucket-copy settings refuse a bucket choice "but never a
  local folder" (a folder sent beside a bucket is now refused with it — Decision 4).
- Each task runs `pnpm format:check` (scoped `pnpm exec prettier --check <files>` is fine) and the
  package's typecheck before handing back.

## Review focus

- The server refuses every malformed list before writing anything, and a refused Save leaves the
  held record unchanged.
- A Save with both stores both, the sweep writes to both, and status shows each one's own result.
- Re-saving the same bucket with an empty secret keeps the held secret when a folder is also listed.
- The screen never sends a switched-off folder, never sends `none`, and refuses "neither" without a
  request.
- The draft scope (A331 rule) sees the switch and the bucket choice: opening is quiet, a change
  enables Save, Discard restores both.

---

## Task 1 — the server takes a list (1a: `resolveArchiveChoices`, steps 1–2; 1b: the route, steps 3–7 — one implementer each)

**Files:** `apps/server/src/archive-settings.ts`, `apps/server/src/archive-settings.test.ts`,
`apps/server/src/backup-api.ts`, `apps/server/src/backup-api.route.test.ts`.

**Interface:** add `resolveArchiveChoices(choices: unknown, ctx: { venueId; stream; held }):
BackupDestination[]` beside `resolveArchiveChoice` (which stays, resolving one entry). It refuses the
list shapes in Decision 2 with `requestInvalid("destinations")`, resolves each entry through
`resolveArchiveChoice`, and returns the folder first, then the bucket. `readApplyBody` reads
`destinations` (replacing `destination` in `APPLY_FIELDS`, `ApplyBody`); the bucket copy's settings
are read when any entry's `kind` is in `BUCKET_CHOICES`; the probe runs on the resolved bucket if
there is one; `settings.destinations` is the resolved list.

Steps:
1. Failing unit cases in `archive-settings.test.ts`: a folder plus a stream-bucket resolve to
   `[local primary, s3 bucket]`; the same listed bucket-first come out folder-first; each refused
   shape (not an array, `[]`, three entries, two folders, two buckets — stream+custom and
   custom+custom — a non-object entry) throws `backup.request_invalid` with field `destinations`;
   an entry's own refusal keeps its field (e.g. a bad `dir` beside a good bucket → `dir`).
2. Implement `resolveArchiveChoices`; green.
3. Mechanically rewrite every route-test request body `destination: X` → `destinations: [X]`
   (including the `applyBody` helper and the shape table near "destination: null"; that table's
   `destination` row becomes a `destinations` row). Run the route suite: it fails (the route still
   reads `destination`).
4. Failing route cases (real database, the existing `primaryApp` / `storeStream` helpers and the
   probe-recording `buildBackend`):
   - folder + stream bucket: 200; status lists the folder then the bucket; the probe ran once, on the
     bucket, and no `waitron-probe-*` file appears in the folder; a sweep (as the existing "stores an archive" cases trigger one) writes an archive to
     both, each destination's status its own;
   - folder + custom bucket, then re-save the same pair with no secret: the held secret is kept;
   - rotation after a folder + bucket Save keeps both destinations unchanged;
   - disable then Save again with both: both stored;
   - the archive recovery pack names the bucket when the folder is listed first;
   - a refused list (two buckets), a failing bucket probe beside a good folder, and a folder +
     the bucket copy's bucket while the bucket copy's settings are unreadable (beside the existing
     parameterised unreadable case) each leave the held record and the key file unchanged;
   - a malformed list is refused with field `destinations` even when the request would also fail a
     key check (shape checked first);
   - a body with the old `destination` field is refused with field `body`.
5. Change the route; green. Run `archive-settings.test.ts`, `backup-api.route.test.ts`,
   `backup-api.archive-pack.test.ts` and `pnpm --filter @waitron/server typecheck`.
6. Grep `apps/server` for any other test or helper posting `/api/backup/apply` and update it the same
   mechanical way (the plan's survey found only the route suite).
7. Commit (`git commit -s`).

## Task 2 — the dashboard model and request type

**Files:** `apps/dashboard/src/api/client.ts` (`BackupApplyBody`), `apps/dashboard/src/api/client-routes.test.ts`
(pins `destination:` at about lines 18 and 507), `apps/dashboard/src/screens/backup-destination-model.ts`, new
`apps/dashboard/src/screens/backup-destination-model.test.ts`, `apps/dashboard/src/screens/backup-screen.ts`
(wiring only), and the screen tests that read the apply body's `destination` — at least
`backup-screen.test.ts` (about lines 183, 210, 635, 709, 846, 1496, 1519) and
`backup-screen.archive-destination.test.ts`.

`#onApplyRefused(error, sent)` (typed `BackupApplyBody["destination"]`, called from the apply and
settings saves) changes here to take the sent LIST and find the `custom-s3` / `stream-bucket` entry
by kind; `secretSentRefused` reads the custom entry's `secretAccessKey`. Behaviour is unchanged in
this task (the screen still sends one entry).

**Interface:** `BackupApplyBody.destinations: ArchiveChoice[]` replaces `destination`. In the model:
`type BucketChoice = "none" | "stream-bucket" | "custom-s3"`;
`openingDestinations(status, stream): { folderOn: boolean; folder: string; bucket: BucketChoice; custom: CustomBucket }`
(Decision 5's opening rules; replaces `openingDestination`, reading the folder and the bucket from
`status.destinations` by kind, not by position); `destinationsBody(folderOn, folder, bucket, custom):
ArchiveChoice[]` (folder entry only when `folderOn`, bucket entry only when not `none`; folder
first). `DestinationChoice` is retired with its last user in Task 3 — in this task keep the screen
compiling by having it call the new functions with the values it has today
(`folderOn = choice === "local-fs"`, `bucket = choice === "local-fs" ? "none" : choice`), so the
screen's behaviour and its tests are unchanged except where they read the apply body's key.

Steps:
1. Failing unit tests for `openingDestinations` (fresh status; folder only; stream-matched bucket
   only; custom bucket only; folder + bucket stored in either order) and `destinationsBody` (each
   combination; trimmed values as today's `destinationBody`; the secret omitted when empty).
2. Implement; green. Wire the screen as above; update any screen test that reads
   `body.destination` to read `body.destinations[0]` / the list (a changed check — list it).
3. Run the model test, `client-routes.test.ts`, `backup-screen.test.ts`,
   `backup-screen.save-state.test.ts`, `backup-screen.unsaved.test.ts`,
   `backup-screen.archive-destination.test.ts` and `pnpm --filter @waitron/dashboard typecheck`.
4. Commit.

## Task 3 — the form offers a folder and a bucket together (three slices, one implementer each)

**Files (all three slices):** `apps/dashboard/src/screens/backup-screen.ts`,
`apps/dashboard/src/i18n/strings.ts` (EN and ES), `backup-screen.archive-destination.test.ts`,
`backup-screen.unsaved.test.ts`, `backup-screen.a11y.test.ts`, `backup-screen.test.ts`,
`backup-screen.save-state.test.ts` as needed. Read `docs/developers/design-system.md` → Forms and
`docs/developers/conventions-ui.md` first. Every existing test changed (the fresh-box "turn the
folder off first" step, a changed option list or label, a changed apply-body key) goes into the
ledger's Changed test checks list: file, test name, old → new.

State: `choice: DestinationChoice` becomes `folderOn: boolean` + `bucket: BucketChoice` — in
`ArchiveDraft`, `#fields`, `#fieldsFrom`, `#prefillFromStatus` (which copies each field by hand, so
a missed assignment compiles silently), the draft scope's `restore`, the `updated()` watch list and
`archivePayload`, which sends `destinations: destinationsBody(...)`. `#folderMissing` is
`folderOn && folder.trim() === ""`; `#streamGone` and `#customMissing` read `bucket`; a new
`#nothingChosen` (`!folderOn && bucket === "none"`) joins `#destinationMissing`. The folder field's
error uses `attempted && #folderMissing`, not `#destinationHeld`. `DestinationChoice` and the old
`openingDestination` / `destinationBody` are deleted once unused.

### Task 3a — the controls, the request and the "neither" check
Steps (each a failing browser test first):
1. Rewrite the tests' destination-choosing helper(s) (e.g. `choose(el, "local-fs")`) for the two
   controls, and add the fresh-box "turn the folder off" step to each existing bucket-only Save.
2. Folder on + "Another S3-compatible bucket" filled → Save sends
   `destinations: [{kind:"local-fs",dir}, {kind:"custom-s3",…}]`.
3. Folder off + the bucket copy's bucket → sends only the bucket; the folder field is hidden.
4. Folder on + "No bucket" → sends only the folder (today's default flow).
5. Switch off + "No bucket" → Save shows "Choose a folder on this box, a bucket, or both." on the
   bucket combobox and the bottom message; no request; the action is disabled until the switch is
   turned on (with a folder) or a bucket is chosen.
6. Folder filled, custom bucket region empty, Save → the region field shows its message and the
   folder field shows none.
7. Run the backup-screen suites and `pnpm --filter @waitron/dashboard typecheck`; commit.

### Task 3b — opening, unsaved changes and where refusals land
1. A stored folder + bucket opens (Edit, and turning stored-off settings back on) with the switch
   on, the folder's path and the matching bucket choice; a stored bucket-only record opens with the
   switch OFF and "No bucket" is not chosen; a stored folder-only record opens with "No bucket".
2. Save is quiet and disabled until something changes (A331 rule; `backup-screen.unsaved.test.ts`
   — toggling the switch makes the draft dirty; Discard restores both controls; a typed folder
   kept while the switch is off does not make the draft or `#openStoredOff`'s check differ; the
   existing reconnect case still asks before discarding).
3. A refusal naming `dir` while a bucket was also sent lands under the folder, and stays there when
   the bucket choice changes; one naming a bucket field lands under that field; `destinations`
   goes to the bottom message.
4. Run the suites and typecheck; commit.

### Task 3c — strings and accessibility
1. The `stream-replaces` hint and the `backup.destination.stream_replaces` string (EN and ES) are
   gone (the existing test that asserts the hint changes — list it); the new strings exist in EN
   and ES; no string key is left unused.
2. The a11y suite covers the switch on and off and the "neither" error, in both themes.
3. Run the suites and typecheck; commit.

## Task 4 — look at it, and the docs

1. Start the dev stack from the worktree (`wa-wt demo <worktree-name>`; check the venue holders
   first per the `wa-wt reset` note if a reset is needed), sign in, open Backups, and LOOK at the
   destination section with: folder on + No bucket; folder off + the bucket copy's bucket; folder on
   + another bucket; the "neither" error — in EN and ES, light and dark, at 390 px and 1280 px.
   Save screenshots outside the repo (`~/waitron-campaign-b/a639-shots/`). Fix anything that looks
   wrong (with a test where the fault is testable).
2. Delete the backlog entry "The Backups screen offers one destination, not a bucket and a folder
   together." (`docs/backlog.md`). Grep the README files and `docs/developers` / `docs/operators` for
   any prose describing the Backups destination as one choice and update it; the A538 design spec is
   historical and stays.
3. Commit.
