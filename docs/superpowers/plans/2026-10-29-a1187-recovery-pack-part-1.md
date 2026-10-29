# A1187 part 1: one recovery pack with today's parts — implementation plan

**Status: reviewed, 2026-10-29; the build follows this plan.** The owner approved the design and
asked for part 1 to be planned next (questions.md, 2026-10-29 ~10:30). No PR here touches the
invoice hash, the chain, invoice numbering, the invoice records or AEAT filing, so lane B lands each
one after its full review. Design: [2026-10-29-a1187-one-recovery-pack-design.md](../specs/2026-10-29-a1187-one-recovery-pack-design.md)
(owner-approved 2026-10-29; every §11 default stands except item 4: the authenticator code is asked
for only when the person has one set up).

**Plan review (2026-10-29):** a fresh review found 0 critical, 5 important and 17 minor points, all
folded and each checked against the code first. Two rulings came with it: the fresh sign-in
**accepts a recovery code** where an authenticator is set up, consumed the way sign-in consumes it;
and a server-key page that fails **no longer refuses the pack** (design §11 item 8): the page is
marked failed, no new key is committed, and the pack is still made. A narrow check of those
corrections then found 5 important and 9 minor points, also folded (unconfirmed packs named
everywhere a pack is named as holding the key; the "received" route limited to the person who made
the pack; the forgotten-password route as the next step for a person with no password and no
passkey).

**Goal.** One printable A4 PDF, the recovery pack, replaces today's three recovery documents: the
bucket-copy recovery kit, the archive recovery pack and the recovery PDF. It holds the bucket copy,
the archives and the server key (§10 part 1). Every recovery file field accepts the pack PDF itself.
Making a pack does not replace the server key unless the person ticks the box. The box keeps a
record of each pack, never its contents, and the Backups card says when the pack is out of date and
which older packs to keep. Making a pack needs a fresh sign-in at the button. Setup's first-hour
step makes pack 1.

**Out of scope.** Part 2 (the emergency start page and the emergency code's issue date, A1188) and
part 3 (the disk key page, B3). "How part 1 leaves room" below says what they plug into.

**Review weight: FULL, on every PR below.** The branch hits these risk triggers:

- **Auth and permissions:** a new fresh sign-in step (password or passkey, plus the authenticator
  code when one is set up), and new routes that hand out every secret the venue has.
- **A contract between packages:** the module seat that draws the server-key page
  (`packages/module/src/module.ts:1551-1561` today), the pack's attached file, which the fiscal
  module, the setup app, the restore command and the server all read, and the shared PDF package.
- **The fiscal module's reader** (`packages/fiscal-verifactu/src/recovery-reader.ts`).
- **A migration** (the pack record table, Task 11).
- **Concurrency:** making a pack reads the backup key, the bucket settings and the server key, and
  can replace the server key; it must not interleave with a Save, a key change or another pack.

**Not fiscal in the unrecoverable sense.** Nothing here touches `computeHuella`, the chain, invoice
numbering, `registros_facturacion` or the alta builders, so the STOP condition in the brief does not
apply. The golden huella test (`packages/fiscal-verifactu/src/write-path.e2e.test.ts`),
`packages/fiscal-verifactu/src/inmutabilidad.test.ts`, the other hash tests found by
`find packages apps -name '*huella*.test.ts'` (`packages/fiscal-verifactu/src/correction-amount.huella.test.ts`,
`money-conversion.huella.test.ts`, `sale-amount.huella.test.ts`, and
`apps/server/src/served-at-huella.test.ts`) must pass **unedited**; call this "the unedited fiscal
set" below. For the first two, an explorer read the
import lists (lines 1-41 and 1-7) and the files they import one and two levels down, and
found nothing that names `recovery` (the full transitive import walk was not run). The fiscal
module's files that do change are its reader, its server-key page, its setup recovery step and its
seat; that matches design §8.

## What was read and what was run

Read for this plan, by me: the design; the A1089 plan (for shape); the root `CLAUDE.md`;
`docs/developers/conventions-ui.md` (refusals, forms, unsaved changes); `design-system.md` → Forms;
`conventions-data.md` (core migration set, classification); `testing-guide.md` (PDF import wait);
`packages/stream/src/kit.ts`; `apps/server/src/archive-recovery-pack.ts`;
`packages/fiscal-verifactu/src/recovery-reader.ts`, `recovery-document.ts`,
`recovery-pdf-content.ts`, `recovery-pdf.ts`, `recovery-pdf-node.ts`, `recovery-delivery.ts`,
`completed-recovery-document.ts`, `recovery-key-code.ts`, `setup/recovery-key.ts:130-200`,
`setup/first-hour.ts:60-140`, `initial-hour-setup.ts:225-430`;
`packages/fiscal-verifactu/src/recovery-reader.browser.test.ts:1-140`;
`packages/module/src/module.ts:1525-1570`; `apps/server/src/recovery-document-api.ts`,
`recovery-pack-api.ts:1-40`, `recovery-document-evidence.ts`, `operation-authentication.ts`,
`own-password-ahead.ts:1-40`, `stream-api.ts:95-115` and `:270-302`, `backup-api.ts:485-580`,
`restore-command.ts:444-466` and `:540-564`, `qr-matrix.ts`, `backup-sweep.ts:323-352`;
`packages/db/src/deployment.ts:180-232`, `classification.ts`, `schema/node-sealed-state.ts`,
`schema/columns.ts` (exports); `packages/sync-enrolment/src/classification.ts:1-45`;
`packages/provisioning/src/first-setup-recovery-delivery.ts` (whole) and
`first-setup-node-key.ts:160-195`, `first-setup-activation.ts:185-205`;
`packages/identity/src/manager-login.ts:56-175`, `profile.ts:80-118`, `passkey.ts:215-302`;
`apps/server/src/management-api.ts:755-800`, `:1878-1906`, `:1937-1960`;
`apps/dashboard/src/screens/recovery-document-panel.ts`, `backup-screen.ts:1303-1324`,
`api/client.ts:4500-4580`; `apps/setup/src/screens/restore-bucket-screen.ts:275-284`;
`deploy/README.md:518-570`; `scripts/english-only.test.ts` and
`packages/db/src/english-only.ts` (package and catalogue lists); package manifests of
`apps/server`, `apps/dashboard`, `apps/setup`, `packages/fiscal-verifactu`, `packages/printing`;
the mock-ups `01-pack-en-page-1.png`, `01-pack-en-page-6.png`, `02-backups-card-light-1280.png`,
`03-sign-in-light-1280.png`.

Read by me while folding the plan review: `apps/server/src/stream-host.ts:45-65`,
`archive-settings.ts:261-311`, `backup-api.ts:325-335`, `packages/db/src/node-identity.ts:28-35`,
`packages/store/src/write-queue.ts:30-50`, `packages/identity/src/manager-login.ts:100-122`,
`profile.ts:85-110` and `:170-185`, `schema/webauthn.ts:40-55`, `passkey.ts:70-92`,
`apps/server/src/me-api.ts:105-125`, `invoice-font.ts`, `promote-api.ts:58-73`,
`apps/setup/src/screens/first-setup-backup-screen.ts:700-736`,
`apps/dashboard/src/dashboard-app.backup-unsaved.test.ts:92-102`, `errors.ts:1198-1204`,
`:1270-1278`, `packages/db/src/classification.test.ts:40-55`, and the A679 plan at `:70-72`,
`:130-133`, `:229-234`.

Read by three explorers dispatched for this plan, and cited below as read (spot-checked by me where
marked above): the setup restore screens and routes, the dashboard stream and archive-pack UI and
its tests, the setup first-hour flow and its routes, the CLI flags, the identity throttles, the
profile screen's confirm-identity fields, the drizzle sets.

**Ran:** only `grep`/`sed`/`cat`/`find` over the tree (for example
`grep -rn "readRecoveryPdf\|recovery-reader" apps packages` found exactly one production caller,
`packages/fiscal-verifactu/src/setup/recovery-key.ts:163-165`). **No test was run for this plan.**
Task 1 runs the reader's deletion controls the design asks for before the reader changes.

**Stale citations in the design.** Commit `98ee3dac3` moved lines in `backup-config.ts` and
`backup-supervisor.ts` after the design was written. Current lines (explorer, read):
`loadRecoveryKey` at `apps/server/src/backup-config.ts:233-235`, `loadKeyRotatedAt`
(`WAITRON_BACKUP_KEY_ROTATED_AT`) at `:261-263`, keeping defaults at `:48-49` (7 archives, 30
days), the interval default at `:47`; `keyFingerprint` at `apps/server/src/backup-supervisor.ts:192-194`.

## Today's three documents, traced

### The bucket-copy recovery kit

- **Format:** `KIT_PREFIX` and `RecoveryKit` at `packages/stream/src/kit.ts:7`, `:14-20`;
  `encodeRecoveryKit` at `:22-24` (no validation); `parseRecoveryKit` at `:35-71`, which splits the
  input on whitespace and takes the first token with the prefix (`:36`), so it reads a bare code or
  the downloaded text file. Refusal `backup.stream_kit_invalid` with `not_found`, `encoding` or
  `shape` (`:30-32`).
- **Route:** `GET /api/backup/stream/kit`, `apps/server/src/stream-api.ts:275-302`: `system.manage`
  (`authorize`, `:104-109`), inside the backup turns (`:278`, so a Save or rotation cannot land
  between the reads), `Cache-Control: no-store` (`:287`). Values: stream settings, the box's backup
  key (`deps.readRecoveryKey()`), the server's public signing key from the membership trust set.
- **Dashboard:** `getRecoveryKit` (`apps/dashboard/src/api/client.ts:4574-4576`); the stream panel's
  **Show recovery kit**, the kit shown after Save and re-shown after a key change with the
  keep-for-seven-days banner, Copy and **Download kit file** (explorer, read:
  `apps/dashboard/src/screens/stream-settings-panel.ts:373-447`, `:534-535`, `:569-620`, `:686-695`,
  `:847-878`).
- **Readers:** setup's **Restore from my bucket** reads the chosen file with `file.text()`
  (`apps/setup/src/screens/restore-bucket-screen.ts:277-283`) and posts the text as `kit` to
  `/setup-api/restore-bucket` and `/restore-bucket/preview`, which refuse more than
  `MAX_KIT_BYTES` (64 KiB, `apps/server/src/setup-api.ts:343`, `:1215`, `:1439`); the server parses
  it at `apps/server/src/boot.ts:1250` and `:1296` (explorer, read). The first-setup backup repair
  screen takes a pasted kit only (explorer, read: `apps/setup/src/screens/first-setup-backup-screen.ts:721-734`).
  The restore command `--from-bucket` reads the file as UTF-8 text and parses it
  (`apps/server/src/restore-command.ts:448-466`).

### The archive recovery pack

- **Format:** `ARCHIVE_PACK_PREFIX`, `ArchiveRecoveryPack` (exact keys) at
  `apps/server/src/archive-recovery-pack.ts:8`, `:14-34`; `encodeArchiveRecoveryPack` runs the
  decoder on its own output (`:60-64`); `decodeArchiveRecoveryPack` refuses several codes, a bad
  base64url body, a wrong shape (`:67-108`), as `backup.archive_recovery_pack_invalid`.
- **Route:** `GET /api/backup/archive-recovery-pack`, `apps/server/src/backup-api.ts:520-574`
  (`system.manage`, backup turns, first `s3` destination, backup key from the box's settings file,
  `no-store` at `:565`, answer `{ pack, keyFingerprint, keyRotatedAt?, revision? }`).
- **Dashboard:** the **Archive recovery pack** card inside the backups body (explorer, read:
  `backup-screen.ts:1013-1049`, `:967-1006`, `:2004-2049`, shown only with a bucket destination at
  `:1429`).
- **Readers:** only the restore command `--from-archive` (`restore-command.ts:544-564`); nothing in
  `apps/setup` reads it (explorer, read).

### The recovery PDF (server key)

- **Route:** `POST /api/box/recovery-document/reissue` and `/download`,
  `apps/server/src/recovery-document-api.ts:65-146`. Checks: encrypted socket, same origin when the
  browser names one, JSON body (`secure`, `:30-43`), `system.manage` (`:71-75`, `:90-95`), one turn
  per node (`:70`). Each reissue makes a new secret (`generatePassword`, `:85`), names it
  `YYYY-MM-DD · <uuid>` (`:101`, `:114`), asks the module seat for the whole PDF (`:98-107`), and
  only then stores the new check value and name with `setBreakGlassVerifierTx` (`:110-115`). It keeps
  the last PDF in memory for `/download` (`:53-54`, `:118`, `:121-136`), so a lost answer can be
  fetched again while the key is unchanged, and logs `recovery.document_reissued` with the person's
  id (`:119`). The dashboard calls only `/reissue` (`client.ts:4522-4532`,
  `recovery-document-panel.ts:81`); nothing calls `/download`, so in practice a lost reissue answer
  already loses the key today. The pack keeps no copy (§3), so Task 12b/16 handle a lost answer
  explicitly instead.
- **The key's facts the box keeps:** `node_roles.break_glass_verifier` and `break_glass_key_name`
  (read through `readBreakGlassVerifier` and `readBreakGlassKeyName`,
  `packages/db/src/deployment.ts:196-216`). There is no creation-day column; the day is the name's
  first ten characters.
- **Seat:** `ModuleBackupContribution.recoveryDocument` (`packages/module/src/module.ts:1551-1561`)
  takes the new key's secret and returns a whole PDF. Its one implementer is
  `FISCAL_RECOVERY_DOCUMENT` (`packages/fiscal-verifactu/src/completed-recovery-document.ts:11-55`),
  wired at `packages/composition/src/modules.ts:308`. It checks the tenant, environment, the SIF and
  the hour history before drawing (`:17-41`).
- **Drawing:** `renderRecoveryPdfWithFont` (`recovery-pdf-content.ts:14-147`) with pdfkit; rows,
  the key at `:123-124`, three warnings at `:126-140` (the one design §8 rewords is `:131-135`), one
  attached file `waitron-recovery-key-v1.json` (`:141-144`) and the Info key
  `WaitronRecoveryDigest` = SHA-256 of that file (`:48-56`).
- **Reader:** `readRecoveryPdf` (`recovery-reader.ts:90-130`), browser only (pdfjs worker `?url`,
  `:1-2`, `:21`). Two passes: pdf-lib walks the embedded-file tree and refuses a second or wrongly
  named file (`:51`, `:81`), page-level attachments (`:69-76`), and checks the Info digest
  (`:85-88`); pdfjs must also see exactly one file of that name (`:101-104`); the file must be
  canonical bytes of an exact-keys document (`recovery-document.ts:40-74`, `:87-101`;
  `recovery-reader.ts:108-115`) whose hash equals the Info digest (`:116-118`). Its one production
  caller, `setup/recovery-key.ts:163-165`, uses only `document.nodeKey.secret` after comparing
  scope, node id and key name (`:166-179`); `attachmentBytes` is discarded.
- **Setup's first-hour PDF** is drawn **in the browser**: `vf-first-setup-hour` stages a key
  through `/setup-api/first-setup/node-key`, draws the PDF with `createRecoveryDelivery`
  (`recovery-delivery.ts:30-90`), and posts only digests and the public statement
  (`documentDigest` = SHA-256 of the PDF bytes, `:50-54`). Provisioning stores that as a host JSON
  file, not a table (`first-setup-recovery-delivery.ts:189-192`, `:285`) and cannot recompute the
  document digest; it re-derives the fiscal statement through the setup seat (`:251-263`). The
  command-line setup draws the PDF on the server through `commandRecoveryDocument`
  (`initial-hour-setup.ts:245-264`). Activation installs the staged key into `node_roles` inside one
  transaction (`first-setup-node-key.ts:172-182`, called from `first-setup-activation.ts:197-205`).
- **Restore readers of the server key:** `vf-recovery-key` (above), placed in setup's recovery
  screens (explorer, read: `apps/setup/src/screens/recovery-allocation.ts:129-142`,
  `first-setup-backup-screen.ts:402-417`).

## Decisions this plan makes that the design does not

1. **A new browser-and-Node package, `@waitron/recovery-pack`,** holds the pack's attached-file
   format, the page description a part hands over, the PDF renderer (pdfkit, with the font passed
   in), the QR drawing (`qrcode`'s `create`, as `apps/server/src/qr-matrix.ts:8-17` does) and a
   pdf-lib reader for the attached file. Why a package: the pack is drawn on the server (dashboard)
   **and** in the browser (setup's first-hour step draws in the browser today), and read in the
   browser (setup, fiscal reader) **and** on Node (restore command); generic code may not import the
   fiscal module, and `@waitron/shared` is imported by every bundle. It depends on no workspace
   package that depends on `@waitron/fiscal-verifactu`.
2. **The module draws a page description, the host draws the PDF.** The seat returns rows, one
   secret (text plus QR) and notes in the person's language, plus the key file when the pack makes a
   new key; the host lays out every page in one font. This is how "the fiscal module draws page 6"
   (§3) and "return its page for the host to put into the pack" (§2) are met without merging PDFs.
3. **The attached file** is `waitron-recovery-pack-v1.json`, canonical JSON (keys sorted, the
   algorithm of `recovery-document.ts:89-97`), every key always present and `null` when a part is
   absent: `{ kind: "waitron-recovery-pack", version: 1, number, madeAt, bucketCode, archiveCode,
   backupKey, serverKey, serverKeyName, serverKeyHeldBy }`. `bucketCode` and `archiveCode` are
   today's code lines exactly. `serverKey` is the fiscal module's own key-file object, carried
   opaquely; `serverKeyHeldBy` is `{ number, madeOn, received } | null` so a reader can say which
   pack holds the key when this one does not, and whether that pack ever reached a browser
   (decision 10). The Info key `WaitronRecoveryDigest` holds the SHA-256 of these bytes,
   as today. Limit 16 KiB (the key file keeps its own 8 KiB limit).
4. **The pack record is a core-set table `recovery_packs`, classified `local`.** Why core: the
   backup and recovery host code is `apps/server`, not a module, and its existing node-owned table
   `node_sealed_state` is core (`packages/db/src/classification.ts:275-279`). Why `local`: the
   server key it describes is per node (`node_roles` is `local`, `:259`), and a node holding another
   node's copy of `venue.db` (a mirror) must read its own packs or none; every read and write names
   `node_id`. No foreign key to `persons` or `nodes` (a `local` table holds none into a venue table).
   Not append-only: one column, `received_at`, is set after the row is written (decision 10). Not a
   live-update source: it joins `NOT_CHANGE_SOURCES` (`packages/db/src/classification.ts:289`) with a
   case beside `classification.test.ts:48-51`, because no screen subscribes to it; the card re-reads
   after its own make and on load (open question 6).
5. **Parts are a fixed, ordered list in the server's pack builder**: disk key, emergency start,
   bucket copy, archives, server key. Part 1 registers the last three. Pages are numbered from what
   the pack holds, so a part-1 pack is cover + three pages (open question 1).
6. **Today's routes and screens for the three documents are retired** once the card lands (Tasks
   18a-18c), not left with no screen: `GET /api/backup/stream/kit`, `GET /api/backup/archive-recovery-pack`,
   `POST /api/box/recovery-document/{reissue,download}` and the old seat. Their only consumers are
   the dashboard screens design §6 replaces (traced above). The encoders and decoders stay: the pack
   builder and the restore readers use them. `GET /api/backup/recovery-key` stays (§6).
7. **The fresh sign-in is built on the "confirm your own credentials" check** (`verifyCurrent`,
   `packages/identity/src/profile.ts:86-106`), with its own per-person throttle, and adds a passkey
   twin. Both bind to the signed-in person, never a person id from the body (unlike
   `withAuthenticatedOperation`, `operation-authentication.ts:95-98`). A code is asked for only when
   `persons.totp_secret` is set (`profile.ts:96-105`). **Ruling (2026-10-29):** the code may be an
   authenticator code **or a recovery code**, consumed with `consumeRecoveryCode` exactly as sign-in
   does (`manager-login.ts:105-120`), matching mock-up 03's "Authenticator or recovery code". A
   person with no password (`OwnProfile.hasPassword`, `apps/dashboard/src/api/client.ts:356`;
   `verifyCurrent` refuses them at `profile.ts:90`) uses a passkey. With neither
   (`!hasPassword && passkeys.length === 0`), the next step is the forgotten-password route, in the
   words the profile screen already uses (`profile.password_recovery`,
   `apps/dashboard/src/i18n/strings.ts:1094-1095`, shown at `profile-screen.ts:932`): "To set a
   password, sign out and choose 'I've forgotten my password' when logging in." Adding a passkey is
   **not** offered as the way out: registering one needs the current password
   (`management-api.ts:1884-1896` through `verifyOwnCredentials`), which this person does not have.
8. **A server-key page that cannot be drawn is marked failed and the pack is still made, ticked or
   not** (ruling 2026-10-29, design §5 and §11 item 8). With the box ticked, no new key is committed;
   the page carries the seat's real refusal cause and says that the key was **not** replaced, and,
   **only when a key is in force**, that the current key still works and where it is (with the
   unreceived wording when its pack never reached a browser, decision 10); the dialog says the same
   before the PDF is opened.
9. **The keep-until estimate takes the key's change time as the latest archive made with the old
   key**, not the archive names' times. **A stated departure from design §4**, to be named in PR C's
   text: it errs later, so it never advises discarding a pack too early, and it needs no bucket
   listing when the card loads (open question 3).
10. **A pack counts as delivered only once the browser confirms it received the PDF.** The make
    route commits the record (and a ticked new key) before the answer leaves, and keeps no copy
    (§3), so an answer lost on the way leaves a pack nobody holds. The dialog calls
    `POST /api/backup/recovery-pack/<number>/received` when the PDF Blob has arrived whole; that
    sets `received_at`. **Nothing names an unreceived pack as a safe holder of the key**: not the
    card, not page 6's "keep that pack", not the failed-page line, not the dialog, not the checkbox
    explanation, not a reader message. Wherever a pack is named as holding the key and it has no
    `received_at`, the words say it never reached a browser; on the dashboard and in the PDF they
    are: "The current server key is on recovery pack N, made on D, which never reached a browser.
    If you do not have pack N, make a new pack with **Also make a new server key** ticked." (Setup's
    reader, where no pack can be made, has its own wording, Task 5.) The card never calls an
    unreceived pack "up to date". Only the person who made a pack can mark it received (Task 12b).
    Pack 1 from setup is recorded received, because setup's "I kept it" step confirms it. Chosen over
    a card that always hedges, because an always-on hedge would tell every venue on every visit that
    they may not have their key.
11. **No server key in force** (`readBreakGlassKeyName` null): the server-key part is `failed`
    ("this box has no server key yet"), ticked or not, and no key is made, as today's reissue
    refuses `key_missing` (`recovery-document-api.ts:96-97`).
12. **Turn names.** The make route takes the turn `recovery-document:<nodeId>`, the one today's
    reissue takes (`recovery-document-api.ts:70`), so the two cannot interleave key replacements
    while both exist (PRs C and D); `recovery-pack:<nodeId>` is the node recovery pack's
    (`recovery-pack-api.ts:38`). New server files are named `backup-recovery-pack-*.ts`, never the
    existing `recovery-pack-api.ts` or `recovery-pack.ts`.
13. **Every pack number is shown with its date** ("pack 3, made on 12 October"), on the card, in
    the dialog, on page 6 and in every reader message, so two packs are never told apart by a number
    alone.

## Global constraints

- Test first in every task: write the case, run it, watch it fail for the stated reason, then build.
- Existing assertions do not change, except the tests of the screens and routes design §6 retires
  (Tasks 18a-18c). Each retired test's protective property is restated on its replacement, named in that
  task. The fiscal reader's existing browser tests pass unedited.
- Nothing secret is logged, kept in memory after the answer, or written to the record: no backup
  key, bucket secret, server key, restore code, fingerprint or label (§4).
- English and Spanish for every word a person reads: dashboard strings in
  `apps/dashboard/src/i18n/strings.ts`, setup strings in `apps/setup/src/i18n/strings/`, the PDF's
  words in the new package's catalogue (Task 2), the fiscal page's words inline in the fiscal module
  as today (`recovery-pdf-content.ts:52`). General code is English only.
- Refusals say what happened and what each choice does, offer **Try again** and **Stop** where a
  retry can help, and never send the person to somebody else (`conventions-ui.md` → Refusals).
- Error codes name the domain: the existing `recovery.pack_invalid` (`apps/server/src/errors.ts:1190`,
  `reason: string`) gains reasons; two new codes, `recovery.pack_connection_insecure` and
  `recovery.pack_origin_refused`, replace the untruthful `authorization.not_permitted` that today's
  check answers for a plain-HTTP or cross-origin request (`recovery-document-api.ts:40`); sign-in
  refusals reuse `password.invalid`, `totp.invalid`, `password.throttled`, `passkey.*`.
- Every PR runs focused tests while building and lets the pre-push hook and CI do the rest
  (`CLAUDE.md` §2). The unedited fiscal set passes on every PR.
- **Reads inside a transaction use the transaction-taking versions.** `readStreamSettings(db, ring)`
  opens its own transaction (`apps/server/src/stream-host.ts:53-58`), as do `readArchiveSettings` /
  `readHeldArchiveSettings` (`apps/server/src/archive-settings.ts:261-270`, `:305-311`, reached from
  `backup-api.ts:329`) and `readMembershipTrustSet` (`packages/db/src/node-identity.ts:28-35`); a
  nested `withTransaction` is refused by the write queue (`packages/store/src/write-queue.ts:41-43`).
  Use `readStreamSettingsIn(tx, ring)` (`stream-host.ts:60`), and add `readArchiveSettingsIn(tx,
  ring)` and `readMembershipTrustSetIn(tx)`, each with the wrapper calling it so behaviour elsewhere
  is unchanged.
- An implementer past ~150 tool calls with its task unfinished stops at a passing or cleanly red
  point, commits, and hands over (done, left, files, each check's state).

## Pull requests

Five PRs, each leaving `main` working on its own. Each takes the full review.

| PR | Tasks | Leaves main | Depends on |
| --- | --- | --- | --- |
| **A. The pack format and every reader** | 1-7 | Readers accept a pack PDF; nothing in production makes one yet; old documents untouched | — |
| **B. Fresh sign-in at the button** | 8-9 | A tested server step and a passkey-options route, used by nothing yet | — |
| **C. The server makes the pack and remembers it** | 10-14 | A make route and a status route the dashboard does not call yet; old cards still work | A, B |
| **D. Backups shows one Recovery pack card** | 15-17, 18a-18c, 19 | The card replaces the three documents; old routes and seat retired | C |
| **E. Setup's first pack** | 20-22 | Setup's first-hour step makes pack 1 and records it | A, C |

Why split: A and B are each a risk trigger reviewed on its own (the cross-package format and fiscal
reader; auth). C adds the migration and the seat change without touching any screen. D is the
visible change and the retirement. E changes the fiscal setup flow, which has its own review surface
(`packages/provisioning`).

---

## PR A — the pack format and every reader

### Task 1 — what the reader's refusals protect (investigation, no product code)

Design §1 requires this before the reader accepts a file holding restore codes and the backup key.

**Files:** none changed. Output: a section in PR A's description, and a one-line note in this plan
under the task.

1. Run the reader's suite once green:
   `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/recovery-reader.browser.test.ts`
   (read the `Tests` count).
2. Deletion controls, each in a throwaway worktree (`git worktree add --detach <dir> HEAD`,
   `pnpm install`, remove after; never by swapping files in the working one):
   - remove `++entries !== 1 ||` at `recovery-reader.ts:51`; remove `:81`; remove the size check at
     `:101`. Record which named cases fail (expected: "conflicting", "duplicate name", "empty tree").
   - replace `exact(...)` in `recovery-document.ts:42-50` with a check that ignores extra keys; then
     separately remove the canonical-bytes comparison at `recovery-reader.ts:110-115`. Record which
     cases fail (expected: "extra secret", "duplicate JSON key", "noncanonical").
3. Read the reasons the earlier one-PDF work gave for these rules, in
   `docs/superpowers/plans/2026-10-15-a679-one-pdf-implementation.md:72` (exact attachment round
   trip or refusal), `:132` (never copy the secret attachment or node keys into another carrier) and
   `:229-234` (missing, repeated, conflicting, corrupt and oversized attachments refuse; exactly one
   attachment), and check each against the pack: the pack is a new carrier that **does** hold the
   server key, which is what design §1 decides; the register carrier `:132` protects is untouched.
4. Write down, with the failing case names as receipts: the one-attachment refusals stop two
   parsers (pdf-lib, pdfjs) from reading different files out of one PDF; the exact-keys and
   canonical-bytes refusals stop a file whose meaning differs between JSON readers, and keep the key
   file to the fields the reader checks. Trace (grep) every consumer of `readRecoveryPdf`'s result:
   today one, which uses only `nodeKey.secret`.
5. **Go / no-go.** Go when the pack file can keep both protections: exactly one attached file
   (either name), canonical exact-keys outer file, the nested server key checked by the same
   `parseRecoveryDocument` and canonical comparison, and nothing but the server-key document
   returned to the caller. If a control shows a refusal protecting something else, STOP and take
   the design's alternative (attach only the key file, print the codes); PR A then shrinks to Tasks
   2-4, 6-7 without the attachment in the fiscal reader.

**Result (2026-10-29): go.** Only "refuses hostile carrier: duplicate name" fails when every one-file
check is removed; once two names are accepted, a PDF carrying both is stopped by the one-file rule
alone, so Task 5's both-files case is required. Receipts in PR A's description.

### Task 2 — the package and the attached file's format

**Files:** `packages/recovery-pack/` (new: `package.json`, `tsconfig.json`, `vitest.config.ts`,
`eslint` as siblings do, `src/index.ts`, `src/pack-file.ts`, `src/canonical-json.ts`,
`src/i18n/strings.ts`, tests); `pnpm-workspace` membership as siblings; the root guards' package
lists (`CLAUDE.md` §2: "Adding a workspace package requires naming it in the root guards' shard
lists"): at least `scripts/changed-scope.mjs` (its package list, `"@waitron/printing"` at `:303`
shows the shape), `.github/workflows/ci.yml` (its coverage and shard jobs), the package list in
`scripts/english-only.test.ts` (`"printing"` at `:113`), and whatever else
`grep -rn 'printing' scripts/*.mjs scripts/*.test.* .github/workflows/ci.yml` finds;
`packages/db/src/english-only.ts` (`GENERIC_PACKAGES` gains `recovery-pack`; `I18N_CATALOGUES`
gains the package's `src/i18n/strings.ts`, the translation-file exception of `CLAUDE.md` §3).

**Failing tests first** (`src/pack-file.test.ts`):
- `buildRecoveryPackFile(fields)` returns bytes equal to canonical JSON; a round trip through
  `parseRecoveryPackFile(bytes)` returns the same fields. *Fails if* the builder stops sorting keys.
- `parseRecoveryPackFile` refuses: a missing key, an extra key, a key with a non-`null` wrong type,
  `kind`/`version` wrong, non-canonical bytes (leading space), a duplicate key, invalid UTF-8, more
  than 16 KiB, a `bucketCode` without `WAITRON-RECOVERY-KIT-1:` or an `archiveCode` without
  `WAITRON-ARCHIVE-PACK-1:`. Each refusal is `RecoveryPackFileError` with a `reason`. *Fails if*
  the exact-keys check is deleted ("extra key" case).
- A `serverKey` object is carried byte-for-byte: the canonical bytes of the nested object equal
  `canonicalJson(serverKey)`. *Fails if* nesting is serialised with a different algorithm.
- The package imports no Node built-in (a test reading its `src` for `node:` imports, or a browser
  project run, whichever the package's config already supports).

**Steps:** minimal package (copy `packages/printing`'s scripts and coverage thresholds 98/98/98/95
from its config); dependencies `pdfkit`, `fontkit`, `pdf-lib`, `qrcode` at the versions already in
the lockfile (`apps/server/package.json:80`, `:86-87`, `:110`); no workspace dependency.

**Checks:** `pnpm --filter @waitron/recovery-pack exec vitest run`;
`pnpm exec vitest run scripts/english-only.test.ts scripts/workspace-cycles.test.ts scripts/coverage-thresholds.test.ts scripts/ci-workflow.test.mjs scripts/changed-scope.test.mjs`.

### Task 3 — reading the attached file out of a pack PDF

**Files:** `packages/recovery-pack/src/read-pack-pdf.ts` and test.

**Failing tests first.** Build carriers with pdfkit as `recovery-reader.browser.test.ts:43-68`
does. `readRecoveryPackPdf(bytes)`:
- returns the parsed pack file for a carrier with exactly one embedded file named
  `waitron-recovery-pack-v1.json` and a matching `WaitronRecoveryDigest`;
- throws `RecoveryPackFileError` `{ reason: "not_a_pack" }` for a PDF with no embedded files, or
  whose one file has another name (so a recovery PDF from before the pack is told apart);
- refuses a second embedded file, a page-level `/AF` or `/FileAttachment` annotation, a name-tree
  cycle or depth over 16, mismatched `/F` or `/UF`, a digest mismatch, a declared size over the
  limit, and input over 8 MiB, with the same structure walk as `recovery-reader.ts:32-89`
  (pdf-lib only; it must run on Node). *Fails if* the one-file check is removed ("second file").

**Checks:** `pnpm --filter @waitron/recovery-pack exec vitest run src/read-pack-pdf.test.ts`.

### Task 4 — drawing the pack

**Files:** `packages/recovery-pack/src/page.ts` (types), `src/render-pack.ts`, `src/qr.ts`,
`src/i18n/strings.ts`, tests; dev dependencies `pdfjs-dist`, `@napi-rs/canvas`, `jsqr` (already in
the lockfile through `apps/server/package.json` devDependencies) for the QR read-back test.

The page description:
`RecoveryPackPage = { title; intro?; rows: { label; value }[]; secret?: { label; text; qr: true };
notes: string[] }`. The renderer takes `{ locale, timeZone, loadFont, cover: { legalName, taxId,
venueName, madeAt, madeBy: string | null, number }, parts: PackPart[], file: RecoveryPackFile }`,
where a `PackPart` is `{ kind: "bucket" | "archives" | "server-key", state: "included" | "absent" |
"failed" | "not-set-up", page?: RecoveryPackPage, failure?: { what: string; todo: string },
lastChanged?: string, check?: string, absentReason?: string, serverKeyLocation?: { kind: "this-pack" }
| { kind: "pack"; number; madeOn; received: boolean } | { kind: "sheet"; keyName; madeOn } }`.
`loadFont` is the
caller's: on the server, the bytes `apps/server/src/invoice-font.ts:4-6` already reads
(`assets/invoice-noto-sans.ttf`); in the fiscal module, its own asset through the loaders of
`recovery-pdf.ts:9-13` (browser) and `recovery-pdf-node.ts` (Node, with its `readFile` fallback).
Tests load the server's font file directly.

**Failing tests first** (read the PDF's text with pdfjs, as `recovery-reader.browser.test.ts:27-42`
does, in EN and ES):
- the cover has the title, legal name, NIF, venue, "made on … by …" (or "made during setup" for
  `madeBy: null`), the number, the "Which page do I need?" rows for the parts present, the "What is
  in this pack" table with each part's last-changed and check, the keep-it-locked-away warning, and
  the sentence that the Backups screen says which older packs to keep and until when, and that the
  pack holding the server key is always kept (mock-up page 1). *Fails if* that sentence is dropped;
- an absent or not-set-up part has its cover line with the reason and no page; a **failed** part
  has its cover line **and its own page** carrying `failure.what` and `failure.todo` (design §5:
  "that page says what failed and what to do"), not the part's normal content;
- the server-key page ends with the location line: "This pack holds the server key" / "The key
  itself is on recovery pack N, made on D. Keep that pack." (only for a received pack) / for an
  unreceived one, "The key itself is on recovery pack N, made on D, which never reached a browser.
  If you do not have pack N, make a new pack with **Also make a new server key** ticked." / "… on the
  recovery sheet whose key name is X, made on D"; a test per form, and *fails if* an unreceived
  pack is told "Keep that pack"; every pack number in the PDF is printed with its date (decision 13);
- every `secret` is drawn as text and as a QR code: render each page to an image (pdfjs +
  `@napi-rs/canvas`) and decode with `jsqr`; the decoded text equals the secret text, for a
  640-character bucket code. *Fails if* the QR drawing is removed or drawn from a different string;
- the PDF has exactly one embedded file, the pack file, and `readRecoveryPackPdf` (Task 3) reads it
  back equal. *Fails if* the Info digest is computed over different bytes;
- a character the font lacks is drawn as `[U+XXXX]` (as `recovery-pdf-content.ts:42-47`);
- one page per part on A4; the output is capped at 8 MiB.

**LOOK:** write the EN and ES PDFs of a full sample (all three parts, one failed part, a no-new-key
server page) to a temporary directory outside the repo, render each page to PNG, and compare by eye
with `docs/backlog/mockups/a1187-recovery-pack/01-pack-*-page-{1,4,5,6}.png`: readable in black and
white, QR codes beside their text, nothing clipped. Screenshots go in PR A.

**Checks:** `pnpm --filter @waitron/recovery-pack exec vitest run`.

### Task 5 — the fiscal reader accepts the pack

**Files:** `packages/fiscal-verifactu/package.json` (depends on `@waitron/recovery-pack`),
`src/recovery-reader.ts`, `src/setup/recovery-key.ts`, new
`src/recovery-reader.pack.browser.test.ts`, `src/setup/recovery-key.browser.test.ts` (new cases
only).

**Failing tests first** (new file; the existing `recovery-reader.browser.test.ts` passes
**unedited**):
- a pack PDF drawn by Task 4 with `serverKey` = a valid key document returns that document;
  *fails if* the reader still accepts only the key-file name;
- a PDF carrying **both** files is refused (`"Recovery PDF refused"`); *fails if* the one-file rule
  is relaxed to "one of each";
- a pack whose `serverKey` has an extra field, a non-canonical nested object, or a secret of the
  wrong form is refused;
- a pack whose `serverKey` is `null` throws a distinct error carrying `serverKeyName` and
  `serverKeyHeldBy`, and it **survives** the reader's catch-all, which today turns every error but
  the "No recovery key attachment" one into `"Recovery PDF refused"` (`recovery-reader.ts:120-126`):
  extend that pass-through to the new error and nothing else. *Fails if* the catch-all swallows it
  (the component would then show "invalid"). `vf-recovery-key` shows it as: "This recovery pack does not hold the server
  key. It is on recovery pack N, made on D: choose that pack, or type the key from it." (or, with no
  pack number, "… choose the pack or sheet whose key name is X"), EN and ES; when
  `serverKeyHeldBy.received` is false it adds "That pack never reached a browser when it was made:
  if you do not have it, the key cannot be read from any pack." (a case each);
- the pack's own bucket code, archive code and backup key never leave the reader: the returned
  object has exactly `{ document, attachmentBytes }`, and `attachmentBytes` is the key document's
  canonical bytes, not the pack file's.

**Steps:** in both passes accept exactly one embedded file named either `RECOVERY_ATTACHMENT` or
the pack name; for the pack, the size limit is the pack's; parse with `parseRecoveryPackFile`, then
run the existing `parseRecoveryDocument` and canonical comparison on `serverKey`; the digest check
covers the attached file's bytes as today. Wait for `importFile` in the component test as
`testing-guide.md` → "Wait for the native picker's PDF import" says.

**Checks:** `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/recovery-reader.browser.test.ts src/recovery-reader.pack.browser.test.ts src/setup/recovery-key.browser.test.ts`;
the unedited fiscal set: `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts src/correction-amount.huella.test.ts src/money-conversion.huella.test.ts src/sale-amount.huella.test.ts`
and `pnpm --filter @waitron/server exec vitest run src/served-at-huella.test.ts`.

**LOOK:** the new "does not hold the server key" message in `vf-recovery-key`, EN and ES, light and
dark, 390 and 1280 wide (screenshots from the browser cases, written outside the repo).

### Task 6 — the restore command takes the pack PDF

**Files:** `apps/server/package.json` (depends on `@waitron/recovery-pack`; `pdf-lib` becomes a
runtime dependency of the Node bundle through it), `apps/server/src/restore-command.ts`,
`restore-command.test.ts`, `restore-command.archive.test.ts` (new cases only), `deploy/README.md`
(the two paragraphs at `:523-529` and `:550-559`).

**Failing tests first:**
- `--from-bucket <pack.pdf>`: the file is read as bytes; one starting `%PDF-` goes through
  `readRecoveryPackPdf` and its `bucketCode` into the unchanged `parseRecoveryKit`; the restore then
  runs as with a kit file (reuse the `--from-bucket` happy-path fixture at
  `restore-command.test.ts:428`). *Fails if* the PDF is still read as UTF-8 text (which finds no
  kit and prints `not_found`).
- a pack with `bucketCode: null` prints "restore failed: the recovery pack holds no bucket copy code
  — this box had no bucket copy when the pack was made; give a pack made after the bucket copy was
  set up, or the recovery kit file"; a PDF that is not a pack prints a fixed line naming that;
- the same two for `--from-archive` with `archiveCode`;
- a text kit file and a text pack file still work (existing cases unchanged).

**Guard:** the licence notices for `pdf-lib` and `qrcode` in the image if the Node bundle did not
already carry them: run `pnpm exec vitest run scripts/deploy-image-env.test.ts` and read its
third-party blocks; add the notices to `/app/third-party/` as `CLAUDE.md` §3 requires.

**Checks:** `pnpm --filter @waitron/server exec vitest run src/restore-command.test.ts src/restore-command.archive.test.ts`.

### Task 7 — setup's bucket fields take the pack PDF

**Files:** `apps/setup/package.json`, a shared helper `apps/setup/src/pack-file-input.ts`
(`bucketCodeFromFile(file)`: sniff, read the attached file, answer the code or a refusal),
`apps/setup/src/screens/restore-bucket-screen.ts` and test,
`apps/setup/src/screens/first-setup-backup-screen.ts` and test (it takes the bucket code by paste
only today, `:720-734`; it gains a pack-or-kit file field above the paste field, through
`wt-file-input` or the field the restore screen uses), `apps/setup/src/i18n/strings/restore.ts` and
`apps/setup/src/i18n/backup-repair.ts` (EN and ES: the field label "Recovery pack or kit file",
hint, and the two refusals below); the setup guide paragraph `apps/server/src/guide/en/backup-recovery.md`
`#source` and its Spanish twin ("For a bucket copy, choose your recovery pack or paste its bucket
code"), moved here from Task 19 so the guide changes with the screen.

**Failing tests first** (`restore-bucket-screen.test.ts`, beside "reads an uploaded kit file into
the kit field" at `:254`):
- choosing a pack PDF puts its `bucketCode` into the kit field and sends that code (not the PDF) in
  the request; *fails if* the screen still calls `file.text()` on a PDF;
- a pack with no bucket code shows under the field: "This recovery pack holds no bucket copy code:
  the box had no bucket copy when it was made. Choose a newer pack, or paste the code." and keeps the
  previous kit; a PDF that is not a pack: "This PDF is not a Waitron recovery pack.";
- a text kit file still fills the field as today (existing case unchanged);
- the first-setup backup screen: choosing a pack PDF fills its kit field with the pack's
  `bucketCode` **read from the attached file**, and the request carries that code; the same two
  refusals. The page's drawn text is not a way in: a 600-character code drawn on A4 wraps, and
  `parseRecoveryKit` splits on whitespace and keeps only the first piece (`packages/stream/src/kit.ts:36`),
  so text copied out of a PDF viewer would arrive broken. The bucket page therefore says "Choose this
  PDF, or scan the QR code with a phone and paste what it reads", and never "copy this text".

**Steps:** sniff the first five bytes for `%PDF-`; dynamically import the reader so the bundle loads
pdf-lib only when a PDF is chosen; keep the generation check at `restore-bucket-screen.ts:279-282`.

**Checks:** `pnpm --filter @waitron/setup exec vitest run src/screens/restore-bucket-screen.test.ts src/screens/first-setup-backup-screen.test.ts`;
`pnpm exec vitest run scripts/native-form-fields.test.ts scripts/guide-links.test.ts`;
`pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts`.

**LOOK:** both setup screens with a pack chosen and with each refusal, EN and ES, light and dark,
390 and 1280.

---

## PR B — fresh sign-in at the button

### Task 8 — identity: checking the signed-in person's own passkey and code

**Files:** `packages/identity/src/profile.ts`, `src/passkey.ts`, `src/index.ts`, tests beside each.

**Failing tests first** (real database, `useVenueDb`):
- `beginOwnPasskeyCheck(tx, { managementSessionId, rpId })` stores a challenge bound to the
  session's person and offers only that person's credentials; a person with no passkey gets
  `passkey.not_registered`.
- `verifyOwnPasskey(tx, { managementSessionId, challengeHandle, response, rpId, origin, totp?,
  recoveryCode?, keyRing })` accepts a valid assertion from the session's person; refuses an
  assertion from **another** person's credential (`passkey.verification_failed`), a challenge bound
  to another person or to no person (a login challenge), a reused or expired challenge. It mints
  **no** session. Use the passkey test helpers the existing `passkey.test.ts` uses (browser
  credentials stubbed, library real: `CLAUDE.md` §4). **The challenge table has no purpose column**
  (`packages/identity/src/schema/webauthn.ts:48-53`: `id`, `personId`, `challenge`, `createdAt`), so
  a registration challenge of the **same** person (issued only after that person's password check,
  `apps/server/src/management-api.ts:1880-1905`) would also be accepted; a test pins that, so the
  limit is stated by a case rather than assumed, and that it still needs that person's own passkey
  and code. No schema change.
- `verifyOwnFreshSignIn(tx, { managementSessionId, currentPassword, totp?, recoveryCode?, keyRing,
  checked? })`: the password form. A person with no password is refused `password.invalid` here
  (as `profile.ts:90`); the dashboard never sends this form for them (Task 15).
- **The shared code check, `requireEnrolledCode(tx, person, { totp?, recoveryCode? }, keyRing)`**,
  used by both forms: with `persons.totp_secret` unset it asks nothing; with it set it accepts a
  valid authenticator code, or else a recovery code consumed with `consumeRecoveryCode` as sign-in
  does (`manager-login.ts:109-115`), and otherwise throws `totp.invalid`. A consumed recovery code is
  gone afterwards (a second use is refused). **Ruling 2026-10-29.**
- `verifyCurrent` (`profile.ts:86-106`) calls `requireEnrolledCode` **with no recovery code**, and
  `Credentials` gains no `recoveryCode` field, so none of its callers changes behaviour: they still
  need an authenticator code where one is set up. Its callers are `verifyOwnCredentials`
  (`:114`, used for passkey registration, `management-api.ts:1896`, and Google linking) and eight
  direct ones in `profile.ts` (`:123`, `:175`, `:181`, `:189`, `:267`, `:320`, `:337`, `:361`;
  among them `regenerateOwnRecoveryCodes` at `:170-177` and `disableOwnTotp` at `:179-185`). Only
  the new `verifyOwnFreshSignIn` and `verifyOwnPasskey` pass a recovery code. The existing
  `profile.test.ts` cases pass unedited.

**Checks:** `pnpm --filter @waitron/identity exec vitest run src/profile.test.ts src/passkey.test.ts`.

### Task 9 — the server's fresh sign-in step

**Files:** `apps/server/src/fresh-sign-in.ts` (new) and test; the passkey-options route
`POST /api/backup/recovery-pack/passkey-options` in a new `apps/server/src/backup-recovery-pack-api.ts`
(not the existing `recovery-pack-api.ts`), mounted from `boot.ts` (pass `rpId`/`origin` the way
`management-api.ts` receives them, `:150`).

`confirmFreshSignIn(deps, managementSessionId, body)` takes `{ method: "password", password, totp?,
recoveryCode? }` or `{ method: "passkey", challengeHandle, response, totp?, recoveryCode? }`, runs
the password form through `ownPasswordChanges(db, throttle)` and `verifyOwnFreshSignIn`, the passkey
form through `verifyOwnPasskey` **under the same throttle** (`throttle.begin(personId)` inside its
transaction, settled with the outcome), so guessing the code behind one's own passkey is throttled
too; it returns the person's id. **The throttle is its own instance**
(`createPasswordThrottle()`, as `apps/server/src/me-api.ts:114` keeps its own for profile changes),
not `management-api.ts:767`'s `credentialChangeThrottle`, which lives inside `mountManagementApi`;
so failures here and at profile changes are counted separately, per person each.

**Failing tests first** (real database):
- right password, no authenticator → person id; right password and code → person id; right
  password and an unused recovery code → person id, and that code is consumed;
- wrong password → `password.invalid`; authenticator set up and code missing or wrong →
  `totp.invalid`; no authenticator and a code sent → accepted (the code is ignored);
- repeated wrong passwords → `password.throttled` from the throttle, keyed by person; repeated
  wrong codes behind a valid passkey → `password.throttled` too;
- a body naming another `personId` has no effect: the person is the session's;
- a suspended person, or an expired session → the existing session refusals;
- the passkey-options route needs a management session and `system.manage`, answers `no-store`.

**Checks:** `pnpm --filter @waitron/server exec vitest run src/fresh-sign-in.test.ts`;
`pnpm exec vitest run scripts/errors-reachable.test.ts`.

---

## PR C — the server makes the pack and remembers it

### Task 10 — the seat gains the page variant (contract between packages)

**Files:** `packages/module/package.json` (type dependency on `@waitron/recovery-pack`),
`packages/module/src/module.ts`; `packages/fiscal-verifactu/src/server-key-page.ts` (new, pure,
browser and Node), `src/completed-recovery-document.ts` (adds `FISCAL_RECOVERY_PACK_PAGE`),
`src/index.ts`; `packages/composition/src/modules.ts` (beside `:308`); tests.

The new seat, beside `recoveryDocument` (which Task 18c retires):

```ts
readonly recoveryPackPage?: (
  tx: Transaction,
  node: ProvisionedNode,
  context: {
    readonly keyInForce: { readonly nodeId: string; readonly name: string };
    readonly newKey?: { readonly name: string; readonly secret: string };
    readonly createdAt: string;
    readonly locale: "en" | "es";
    readonly evidence: Readonly<Record<string, unknown>>;
  },
) => Promise<{ readonly page: RecoveryPackPage; readonly keyFile?: Readonly<Record<string, unknown>> }>;
```

`keyInForce` is always the key the box holds now; `newKey`, when present, is the key this pack
would make, with the name the host chose. The host never calls the seat when no key is in force
(decision 11: the part is `failed` without asking the module).

**Failing tests first:**
- `serverKeyPage(document, { locale, timeZone })` with a secret: rows legal name, NIF, venue,
  environment, software id, server id (`shortNodeId`), key name, created; `secret` = the grouped key
  from `encodeRecoveryKey`; notes = the first and third warnings of `recovery-pdf-content.ts:126-140`
  and the reworded second (§8): it no longer says the backup file's password is kept apart, because
  the pack holds it. EN and ES.
- without a secret: the same rows, "Created" = the key name's day, no `secret`, no key file.
- `FISCAL_RECOVERY_PACK_PAGE` refuses as `FISCAL_RECOVERY_DOCUMENT` does (tenant missing,
  environment wrong, NIF mismatch, node mismatch, hour-history contradiction:
  `completed-recovery-document.ts:28-41`), with or without `newKey`, and the refusal reaches the
  host as the seat's own code (so page 6 can say what failed); with `newKey` it returns
  `keyFile` = the `RecoveryDocument` for `newKey.name` and `newKey.secret`, whose canonical bytes equal
  `recoveryDocumentBytes(document)`; without it, no `keyFile`. Reuse the fixtures of `completed-recovery-document.test.ts`.
- `packages/composition/src/composition.test.ts` still passes; the module seam guard passes.

**Checks:** `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/server-key-page.test.ts src/completed-recovery-document.test.ts`, and the unedited fiscal set;
`pnpm --filter @waitron/composition exec vitest run`;
`pnpm exec vitest run scripts/module-seams.test.ts scripts/english-only.test.ts`.

### Task 11 — the pack record (migration)

**Files:** `packages/db/src/schema/recovery-packs.ts` (new) and the schema index;
`packages/db/src/classification.ts` (a `local` entry with its reason: "one node's recovery packs,
keyed by its node id; a node holding another node's copy reads its own or none");
`packages/db/src/recovery-packs.ts` (new: `nextRecoveryPackNumber(tx, nodeId)`,
`insertRecoveryPack(tx, row)`, `markRecoveryPackReceived(tx, nodeId, number)`, `readRecoveryPacks(db,
nodeId)`), exported from the enumerated
`exports` map; the migration **generated by drizzle-kit** in `packages/db/drizzle/` (let it pick the
number; never write one by hand).

Columns, through `schema/columns.ts`: `node_id` (`id`, not null; no foreign key, and the column's
comment says the writer takes it from the box's trading context, as
`schema/node-sealed-state.ts:10-13` does), `number` (`count`, not null), `made_at` (`ts`),
`made_by` (`id`, nullable: `null` for setup's first pack, made before any administrator session;
no foreign key to `persons`, a `state` table; the column's comment says that the make route's
`authorizeManager` establishes the person exists **when the row is written**, and that nothing
ensures they still exist later, so every reader treats a missing person as "no name"),
`received_at` (`ts`, nullable: set by the received route, decision 10), `parts` (`json`, the
per-part record below). A unique index on `(node_id, number)`, declared in the TypeScript schema.
Not a live-update source: add it to `NOT_CHANGE_SOURCES` (`classification.ts:289`) with a case
beside `classification.test.ts:48-51`.

`parts` is an array of `{ part: "bucket" | "archives" | "server-key", state: "included" | "absent"
| "failed" | "not-set-up", keyChangedAt?: string, settingsRevision?: string, destination?: "bucket" |
"folder", keyName?: string, carriedKey?: boolean }`. Parts 2 and 3 add `"emergency"`
(`codeIssuedOn`) and `"disk"` (`diskId`) entries without a migration. Never a key, code, label or
fingerprint.

**Failing tests first** (real database):
- numbers start at 1 per node and rise by one; two nodes' numbers are independent; a second insert
  of the same `(node_id, number)` is refused by the unique index;
- `readRecoveryPacks(db, nodeId)` never returns another node's rows;
- `markRecoveryPackReceived` sets `received_at` once; a second call leaves the first time; another
  node's number is not touched;
- `recovery_packs` is classified and is not in `CORE_CHANGE_SOURCES`;
- the writer refuses a `parts` entry carrying any key outside the list (a `secret` field), so
  nothing secret can reach a backup through this table.

**Guards:** `pnpm exec vitest run scripts/classification-complete.test.ts scripts/schema-constraints.test.ts scripts/migrations-match-schema.test.ts scripts/two-file-foreign-keys.test.ts scripts/column-vocabulary.test.ts scripts/journal-monotonic.test.ts scripts/no-tenant-column.test.ts scripts/id-columns-are-references.test.ts scripts/write-path-tables.test.ts`;
`pnpm --filter @waitron/db exec vitest run src/recovery-packs.test.ts src/classification.test.ts`.
The commit says why the table is core (decision 4).

### Task 12a — the parts the server builds

**Files:** `apps/server/src/backup-recovery-pack-parts.ts` (new) and test.

Three builders, each taking the make route's open transaction `tx` and answering a `PackPart` plus
its pack-file fields and its record entry. **Every database read takes `tx`** (global constraint):
`readStreamSettingsIn(tx, ring)` (`apps/server/src/stream-host.ts:60`), a new
`readArchiveSettingsIn(tx, ring)` beside `readArchiveSettings` (`archive-settings.ts:261-270`, which
then calls it), and a new `readMembershipTrustSetIn(tx)` beside `readMembershipTrustSet`
(`packages/db/src/node-identity.ts:28-35`, likewise). The box settings file is read before the
transaction opens (it is a file, not the database). A test calls each builder inside a real
`withTransaction` (*fails if* any builder opens its own: the write queue refuses re-entry,
`packages/store/src/write-queue.ts:41-43`).

- **bucket:** from `readStreamSettingsIn(tx, ring)`, the backup key (`readRecoveryKey`) and the
  server's public signing key from `readMembershipTrustSetIn(tx)`, as `stream-api.ts:279-297` does; `bucketCode` =
  `encodeRecoveryKit(...)`; page: the code as text and QR, the bucket's name, the steps for
  **Restore from my bucket**, and on a box with a fiscal module "You also need the server key: page
  N, or the pack it names". Check = `WAITRON_BACKUP_KEY_ROTATED_AT` (or the pack's time when unset,
  §4) and the stream credential's revision (`credentialRevision`, `packages/credentials/src/store.ts:131-146`).
  No settings → `absent` ("This box has no bucket copy").
- **archives:** as `backup-api.ts:529-571`, including its conversion of an unreadable stored
  record into `backup.archive_settings_unreadable` (`:533-538`, using `UNREADABLE_SETTINGS`,
  `archive-settings.ts:299-302`): add `readHeldArchiveSettingsIn(tx, ring)` beside
  `readHeldArchiveSettings` (`:305-311`, which then calls it), so the page's failure is keyed by
  that code and not by the raw credential or parse error; for the first bucket destination, `archiveCode` and the
  `restore --from-archive` steps; for a local folder, `backupKey` and the steps for setup's Restore
  from backup; none → `absent` ("This box makes no archives"). Check = the key's change time and the
  archive settings' revision.
- **server key:** asks the one module with `recoveryPackPage` (none → `absent`, "This venue files no
  invoices with the tax agency"); no key in force → `failed`, "this box has no server key yet",
  without calling the seat (decision 11); check = the key name; `carriedKey` true only when the
  ticked new key was actually committed. A seat that refuses → `failed`, ticked or not (decision 8).

A thrown refusal becomes `failed` with a page that says what failed and what to do, from a fixed
table in the package catalogue keyed by the **real** code: `backup.archive_settings_unreadable`,
`backup.recovery_key_missing` and `backup.recovery_key_too_short` (both name **Backups → Change the
recovery key**, §5), `backup.stream_signer_missing`, `sif.allocation_invalid` (with its `reason`
mapped to words: for example `history_invalid` → "the box's record of its invoice series
disagrees with what setup recorded"); any other code → "could not be read when this pack was made;
check Backups and make a new pack". No param value that could carry a secret is printed. A ticked
server-key page that failed adds the line "The server key was **not** replaced." and, **only when a
key is in force**, "The current key, on recovery pack N made on D, still works." (received pack) or
the unreceived wording of decision 10 (unreceived pack) or "… on the recovery sheet whose key name is
X" (no pack holds it). With no key in force (decision 11) neither "still works" line appears. A
test per form.

**Failing tests first** (real database, real key ring, a stream settings row and archive settings as
`backup-api.archive-pack.test.ts` sets them up): each builder's included, absent and failed cases;
an unreadable archive record fails the archive page as `backup.archive_settings_unreadable`;
the bucket code parses with `parseRecoveryKit` to the same settings; the archive code decodes with
`decodeArchiveRecoveryPack`; a local folder carries the key and no code; the too-short key fails
both bucket and archives with the Backups wording.

**Checks:** `pnpm --filter @waitron/server exec vitest run src/backup-recovery-pack-parts.test.ts`.

### Task 12b — the make route

**Files:** `apps/server/src/backup-recovery-pack-api.ts` (new) and
`backup-recovery-pack-api.test.ts`; `apps/server/src/boot.ts` (mount beside `mountBackupApi`,
`:2680`, sharing `backupTurns`); `apps/server/src/errors.ts` (`recovery.pack_connection_insecure`,
`recovery.pack_origin_refused`; `recovery.pack_invalid` gains the reasons `shape` and
`unknown_pack`); `apps/dashboard/src/i18n/codes.ts` words for the two new codes (EN and ES: "Open
the dashboard at its secure address (https://…) to make a recovery pack." and "Make the pack from
the dashboard's own page, not from another site.").

`POST /api/backup/recovery-pack` with JSON `{ locale, newServerKey: boolean, signIn: … }`:

1. `requireSecurePackRequest(c)`: the same tests as `recovery-document-api.ts:30-43` (encrypted
   socket, same origin when named, JSON), but each refusal says what is wrong:
   `recovery.pack_connection_insecure` for a plain connection, `recovery.pack_origin_refused` for a
   cross-site `Origin` or `Sec-Fetch-Site`, `recovery.pack_invalid` `shape` for a non-JSON body.
   Today's `secure()` answers `authorization.not_permitted` for the first two (`:40`), which tells a
   person with the permission that they lack it; it stays as it is until Task 18c deletes it.
2. Management session; `system.manage`.
3. `confirmFreshSignIn` (Task 9).
4. Inside step 5's turns but before its transaction, read the fiscal seat's `evidence` with
   `readRecoveryDocumentEvidence`
   (`apps/server/src/recovery-document-evidence.ts:11-30`; it reads host JSON files, not the
   database), exactly where today's reissue reads it (`recovery-document-api.ts:84`, before its
   `withTransaction` at `:89`), and pass it to the seat.
5. Inside the backup turns **and** the per-node turn `recovery-document:<nodeId>` (decision 12):
   read the box settings file, then one `withTransaction` re-authorises, reads the key in force
   (`readBreakGlassKeyName`), takes the next number, builds the three parts with `tx` (Task 12a),
   finds which pack holds the key in force (the newest **received** record with `carriedKey` for
   that key name; else the newest unreceived one, named as unreceived; else the name's day as a
   sheet), renders the PDF, and only then, when `newServerKey` was ticked **and** the server-key
   page was drawn, stores the new verifier and name (as `:110-115`); then inserts the record. A
   server-key page that fails leaves the key unchanged and the pack is still made (decision 8).
6. Answers the PDF: `application/pdf`, `Content-Disposition: attachment;
   filename="waitron-recovery-pack-<n>.pdf"`, `Cache-Control: no-store`, and headers
   `X-Waitron-Recovery-Pack: <n>` and `X-Waitron-Recovery-Pack-Key: replaced | unchanged | failed`
   so the dialog can say what happened without opening the PDF. Keeps no copy.
7. Logs `recovery.pack_made` with `{ personId, number, parts: [{ part, state }] }` only.
8. `POST /api/backup/recovery-pack/<n>/received` with the JSON body `{}`: same session, permission
   and secure-request checks, **no** fresh sign-in (it hands out nothing); marks pack `n` received
   only when it is **this node's** and its `made_by` is **the signed-in person** (only the browser
   that asked for it can have received it); otherwise, and for an unknown number,
   `recovery.pack_invalid` `{ reason: "unknown_pack" }`, so the answer does not reveal whether
   another person's pack exists.

**Failing tests first** (real database, a TLS socket as `recovery-document-api.test.ts` builds one):
- a plain-HTTP request → `recovery.pack_connection_insecure`; a cross-origin `Origin` or
  `Sec-Fetch-Site` → `recovery.pack_origin_refused`; a non-JSON body → `recovery.pack_invalid`
  `shape`; each before any read; no session → `management_session.required`; no `system.manage` →
  `authorization.not_permitted`; a wrong password → `password.invalid`, with **no** record row and
  no key change;
- a made pack: the answer reads back with `readRecoveryPackPdf` to the right codes, the record row
  has the parts' checks and no secret, the number rises;
- **the received route's refusals**, each leaving `received_at` null: a plain-HTTP request
  (`recovery.pack_connection_insecure`), another site (`recovery.pack_origin_refused`), no session
  (`management_session.required`), no `system.manage` (`authorization.not_permitted`), another
  node's number and another person's pack (both `recovery.pack_invalid` `unknown_pack`); and the
  maker's own call with `{}` sets it;
- **the two new codes' words**: cases in `apps/dashboard/src/i18n/codes.test.ts` in the pattern of
  `:219-231` (English and Spanish exist, differ from the unmapped fallback and from each other) for
  `recovery.pack_connection_insecure` and `recovery.pack_origin_refused`;
- without `newServerKey` the verifier and name are unchanged and page 6 names the pack holding the
  key; with it, the verifier changes, the pack file's `serverKey` parses with
  `parseRecoveryDocument` and its secret verifies against the stored verifier
  (`verifySecretAsync`), and `carriedKey` is true;
- a seat that throws, ticked → the pack is made, page 6 carries the seat's own cause and "the
  server key was not replaced", the verifier and name are unchanged, the record marks the part
  `failed` with `carriedKey` false, and the key header says `failed`; unticked → the same without
  the "not replaced" line. *Fails if* a failed page still commits the new verifier;
- no key in force, ticked → page 6 `failed` ("no server key yet"), no verifier written;
- **a lost answer:** make a pack with the box ticked and drop the answer (the test never reads the
  body, or the client aborts); the record row exists with `received_at` null and `carriedKey`
  true, the new verifier is in force, and the status route (Task 13) then says pack N never reached
  a browser and is the only copy of the current server key; a second make with the box ticked
  replaces the key and the status no longer names pack N as holding it. The received route sets
  `received_at`, and a pack made but never marked is never called up to date;
- a Save (`PUT` stream settings) and a key rotation started while a pack is being made wait for it
  (the turn), as `boot.test.ts:3544` proves for the kit;
- the captured log lines and the answer headers carry no code, key or secret (seed recognisable
  secrets and search for them);
- **restated from retired tests:** `no-store` (was `stream-api.route.test.ts:669`,
  `backup-api.archive-pack.test.ts:176`); nothing of the pack logged (was the comment at
  `backup-api.ts:525-527`).

**Checks:** `pnpm --filter @waitron/server exec vitest run src/backup-recovery-pack-api.test.ts src/recovery-document-api.test.ts`;
`pnpm exec vitest run scripts/errors-reachable.test.ts scripts/personal-log-params.test.ts`.

### Task 13 — what the card says

**Files:** `apps/server/src/backup-recovery-pack-status.ts` (new, pure `packStatus(...)` plus the
route `GET /api/backup/recovery-pack` in the Task 12b file) and tests.

`packStatus({ records, current, retain, retainDays, schedule, now })` answers `{ latest: null | {
number, madeAt, madeByName, received, parts }, upToDate: boolean, incomplete: boolean, unreceived:
null | { number, madeAt, holdsCurrentServerKey }, reasons: { part, kind: "key_changed" |
"settings_changed" | "set_up_after" | "removed" | "key_replaced"; at? }[], keep: { number, madeAt,
until: string | null, why: "server_key" | "backup_key" | "replaced_server_key" }[], backupsUseOlderKey:
boolean }`.

- **Unreceived packs** (decision 10): a pack with no `received_at` is never `upToDate` and never
  listed in `keep` as holding the server key. `unreceived` names, first, **any** unreceived pack
  that carried the key in force, whatever was made after it (`holdsCurrentServerKey: true`); else
  the newest unreceived pack made after the newest received one (`holdsCurrentServerKey: false`);
  else `null`.
- **The failed-reload limit** (`backup-api.ts:331-332`: "after a failed reload the supervisor still
  holds the key it loaded before the key file changed"): the status compares, in memory only, the
  key in the box settings file with the supervisor's loaded key (`supervisor.current().recoveryKey`)
  and sets `backupsUseOlderKey` when they differ; the card then says "The box's backups still use
  the backup key from before the last change, because the box could not load the new settings. A
  pack made now prints the new key; keep the older pack too until Backups shows the settings loaded."
  Neither key nor any label of either leaves the server.

- Out of date when a recorded part's check differs from now: the backup key's change time is later
  than recorded; a settings revision differs; a part recorded `absent`/`not-set-up` is now set up;
  a part now absent was included; the server key's name differs.
- **Keep-until** for a pack whose backup key or server key has since changed at time `T`: the later
  of `T + 7 days` (the bucket copy's rule, `strings.ts:1897-1898`) and the estimate
  `min(T + retain × interval, T + retainDays)` plus one interval, where `interval` is the schedule's
  interval or, for a weekly wall-clock schedule, the longest gap between scheduled days. This follows
  the sweep's rule: an archive goes when it is beyond the `retain` newest **or** older than
  `retainDays`, checked after a new archive is stored (`backup-sweep.ts:323-352`). The line names
  the caveats (§4: assumes backups keep running; not copies kept elsewhere). **Departure from
  design §4**, stated in PR C's text: `T` stands in for the newest archive made with the old key,
  which errs later and needs no bucket listing (decision 9).
- The pack holding the server key in force is always listed `server_key`, never with a date (§4).
- `madeByName` is read from `persons` by id; a missing person gives `null`.

**Failing tests first:** a table of cases covering each reason, an unreceived pack (never up to
date, never the server-key keeper, named in `unreceived`), **pack 3 made ticked and never received
followed by pack 4 made unticked and received: `unreceived` still names pack 3 with
`holdsCurrentServerKey`** (*fails if* only packs after the newest received one are considered), `backupsUseOlderKey` true and false, a
pack made with no backup key yet, the "pack's own time stands in" rule, the keep list for a replaced server key, the server key
pack never dated, and the estimate for an interval schedule and a weekly schedule. The route:
`system.manage`, no turn, answers for this node only, and the dashboard read is passive (Task 15).

**Checks:** `pnpm --filter @waitron/server exec vitest run src/backup-recovery-pack-status.test.ts src/backup-recovery-pack-api.test.ts`.

### Task 14 — wire the routes into the start, and prove the whole make on a real start

**Files:** `apps/server/src/boot.ts` (the Task 12b and 13 mounts, if not already done there), a
new `apps/server/src/boot.recovery-pack.test.ts`.

**Failing test first:** start the server as `boot.test.ts` does, with stream settings and an
archive bucket set; sign in; make a pack over the TLS listener, drawn with the production font
path (`invoice-font.ts`'s bytes, not a test font), and mark it received; the answer reads back with
`readRecoveryPackPdf` to codes that `parseRecoveryKit` and `decodeArchiveRecoveryPack` accept; the
status route then says up to date; a key rotation (`POST /api/backup/rotate`) turns it out of date
with `key_changed`. *Fails if* the mount is missing or uses another turn queue than the backup API's.

Nothing visible changes in PR C; record in the PR that the dashboard does not call the routes yet.

**Checks:** `pnpm --filter @waitron/server exec vitest run src/boot.recovery-pack.test.ts`.

---

## PR D — Backups shows one Recovery pack card

### Task 15 — client calls and the fresh sign-in fields

**Files:** `apps/dashboard/src/api/client.ts` (`makeRecoveryPack`, `markRecoveryPackReceived` (it
sends the JSON body `{}`, because the secure-request check refuses a non-JSON body),
`getRecoveryPackStatus` with the `passive` option, `recoveryPackPasskeyOptions`), `apps/dashboard/src/widgets/fresh-sign-in.ts` (new)
with `.test.ts` and `.a11y.test.ts`, `apps/dashboard/src/i18n/strings.ts`, `codes.ts`.

The widget reads the person's profile (`GET /management-api/session/me/profile`, `client.ts:2480`;
`OwnProfile.hasPassword` and `hasTotp`, `client.ts:356-357`) and draws, with `wt-input`:

- **Password** (required, `name="current-password"`, `autocomplete="current-password"`, reveal
  button in the `end` slot with an action-specific label) **only when `hasPassword`**;
- **Use a passkey instead of the password** (or, with no password, **Use your passkey**), which runs
  `startAuthentication` from `@simplewebauthn/browser` with the options from Task 9 (as
  `login-screen.ts:866-912`); a person with no passkey who presses it gets `passkey.not_registered`
  in words that say how to add one on their profile screen;
- **Authenticator or recovery code** (`name="totp"`, `autocomplete="one-time-code"`, required)
  **only when `hasTotp`**, with the hint "6-digit code from your app, or one of your recovery
  codes"; the widget sends a 6-digit entry as `totp` and anything else as `recoveryCode`;
- with **neither** a password nor a passkey (`!hasPassword && passkeys.length === 0`, from the same
  profile answer): no fields and no Make action; instead "To make a recovery pack you need to sign
  in again with a password or a passkey." followed by the existing `profile.password_recovery`
  sentence (`strings.ts:1094-1095`: sign out and choose "I've forgotten my password" when logging
  in), the forgotten-password route being the one this person can take alone (decision 7). It never
  answers `password.invalid` for a person who has no password, and never points them at adding a
  passkey, which needs a password.

The profile screen's confirm-identity fields are the model (`profile-screen.ts:444-460`,
`:532-533`).

**Failing tests first:** no code field when `hasTotp` is false (assert absence, not hiddenness);
present and required when true; the request body carries `totp` only when shown, and a recovery
code as `recoveryCode`; no password field when `hasPassword` is false, and the passkey way in still
offered; with neither (`!hasPassword && passkeys.length === 0`), the `profile.password_recovery`
sentence and no Make action; a person with no password but a passkey gets the passkey way in; a passkey run sends
`challengeHandle` and `response`; `password.invalid` puts its sentence under the password field,
`totp.invalid` under the code field, `password.throttled` and passkey failures in the bottom
message; the words come from the strings file in EN and ES; axe in both themes for each state.
Browser passkey tests stub `navigator.credentials`, keeping the library real (`CLAUDE.md` §4).

**Checks:** `pnpm --filter @waitron/dashboard exec vitest run src/widgets/fresh-sign-in src/api/client-routes.test.ts`;
`pnpm exec vitest run scripts/native-form-fields.test.ts`.

### Task 16 — the make-pack dialog

**Files:** `apps/dashboard/src/widgets/recovery-pack-dialog.ts` (new) with `.test.ts`,
`.unsaved.test.ts`, `.a11y.test.ts`; strings.

`wt-dialog` heading **Make recovery pack**; the intro sentence of mock-up 03; the fresh sign-in
fields; the **Also make a new server key** checkbox with its explanation naming the pack that holds
the current key with its date (from the status answer; decision 13), in the unreceived wording when
that pack never reached a browser; `wt-form-actions` in the footer slot with Cancel (left) and
**Make pack** (primary). It takes a draft scope from `draftScopeFor` (it holds staged
credential input; `conventions-ui.md` → Unsaved changes) and clears the password on every close.
Make pack follows design-system.md → Forms: it works until the first press; an empty required field
then gets its sentence and the action stays disabled until fixed; a request refusal never disables
it. A ticked box turns the button to the danger colour.

After the Blob arrives whole, the dialog calls `markRecoveryPackReceived(n)` (from the
`X-Waitron-Recovery-Pack` header) before handing the Blob to the card; a failed mark is retried once
and otherwise left for the card's unreceived line.

**Failing tests first:** a successful make emits the PDF Blob, marks it received, and closes with
`closeAfter("security")`; a late answer after Cancel is dropped (generation check, as
`recovery-document-panel.ts:73-97`); the password is gone after reopening; a pack answered with
`X-Waitron-Recovery-Pack-Key: failed` still hands over the PDF, and the dialog says first "The pack
was made, but the server key was **not** replaced: <cause from page 6>." followed, only when a key is
in force, by where the current key is, in the received or unreceived wording (a case each);
the checkbox explanation uses the unreceived wording when the status names that pack unreceived (a
case); **a lost answer** (the request was sent and no answer came back, or the connection dropped
mid-body, so no pack number is known): the dialog re-reads the status, and with the box ticked says
"The box may have made a recovery pack with a new server key that did not reach this browser. If it
did, the only copy of your current server key is on a pack you do not have." (naming pack N and its
date only if the re-read status names it in `unreceived`) and offers **Make a new pack with a new server
key** (pre-ticked; it needs the sign-in again) and **Stop**; unticked it says the pack may have been
made and offers **Try again** and **Stop**; *fails if* a lost ticked answer is shown as an ordinary
failure. Escape with a typed password asks Keep/Discard (`.unsaved.test.ts`); axe for empty, invalid,
busy, refused, in both themes.

**Checks:** `pnpm --filter @waitron/dashboard exec vitest run src/widgets/recovery-pack-dialog`.

### Task 17 — the card on Backups

**Files:** `apps/dashboard/src/screens/recovery-pack-card.ts` (new) with tests,
`apps/dashboard/src/screens/backup-screen.ts` (`:1308` takes the card instead of
`dashboard-recovery-document`), strings.

The card, first on the screen when `canManage`: heading **Recovery pack**, one sentence on what it
is, the status line (§4's three forms, with the keep-until sentence), the unreceived line when
`unreceived` is set (decision 10), the failed-reload line when `backupsUseOlderKey` (Task 13), rows
Last pack / Backup key / Server key (mock-up 02 without the emergency row), every pack number with
its date (decision 13), **Make recovery pack**. After a make: **Download
PDF** and **Open to print** links on a Blob URL, revoked on leave and on the next make.

**Failing tests first:** each status form's words in EN and ES (read from the strings file),
including the unreceived line with and without the server key and the failed-reload line; the card
never says "up to date" or "keep pack N: it holds the server key" for an unreceived pack; the
card re-reads its status after the screen's own writes (Save, rotate, apply, turn off), so a bucket
Save turns the line to out of date where the kit used to appear (§6); the status read is passive;
the Blob URL is revoked on disconnect (**restated** from `backup-screen.archive-destination.test.ts:1649`
and `recovery-document-panel`'s clear case); no card without `system.manage` (**restated** from
`backup-screen.test.ts:43`, and from `dashboard-app.backup-unsaved.test.ts:92-102`, which today
asserts the app passes `system.manage` from the session to `dashboard-recovery-document`: the same
assertion now names the card); axe in both themes for none, up to date, out of date, incomplete,
unreceived.

**Checks:** `pnpm --filter @waitron/dashboard exec vitest run src/screens/recovery-pack-card src/screens/backup-screen.test.ts`.

**LOOK:** the card in each state and the dialog for a person with and without an authenticator, EN
and ES, light and dark, 390 and 1280 (compare with mock-ups 02 and 03).

### Task 18a — retire the kit from the bucket-copy panel (dashboard)

**Files:** `apps/dashboard/src/screens/stream-settings-panel.ts` (Show recovery kit, the kit after
Save and after a key change, the kit block and file) and its `.test.ts`, `.a11y.test.ts`,
`.unsaved.test.ts`, `.save-state.test.ts` (the `getRecoveryKit` stubs), its strings
(`stream.show_kit`, `stream.kit.*`, EN and ES), `client.ts` (`getRecoveryKit`) and its case in
`client-routes.test.ts`.

Delete the kit tests by design §6 and §11 item 9, and list each in the PR with where its protection
now lives (Tasks 12b and 17). The panel's other cases pass unedited.

**Checks:** `pnpm --filter @waitron/dashboard exec vitest run src/screens/stream-settings-panel src/api/client-routes.test.ts`.

### Task 18b — retire the archive pack card and the old recovery-PDF panel (dashboard)

**Files:** `backup-screen.ts` (the archive pack card and its state, `#showPack`, `#dropStalePack`,
`#dropPack`), `recovery-document-panel.ts` and its tests (deleted),
`apps/dashboard/src/api/recovery-document.test.ts` (deleted with the client call it tests),
`backup-screen.archive-destination.test.ts` (its "recovery pack" describe blocks), the
`backup-screen.a11y.test.ts` pack cases, strings (`backup.pack.*`, `recovery_document.*`, EN and
ES), `client.ts` (`getArchiveRecoveryPack`, `reissueRecoveryDocument`), `client-routes.test.ts`.
**Keep:** Show the current key in the key-change dialog and the key shown once at turn-on (§6), and
their tests unchanged.

**Checks:** `pnpm --filter @waitron/dashboard exec vitest run src/screens/backup-screen src/api src/dashboard-app.backup-unsaved.test.ts`.

### Task 18c — retire today's routes and the old seat (server, contract)

**Files:** `apps/server/src/stream-api.ts` (the kit route), `backup-api.ts` (the archive pack
route), `recovery-document-api.ts` (deleted) and its mount in `recovery-pack-api.ts:8-22` (the node
recovery pack route `/api/box/recovery-pack` stays: design §9 leaves it open),
`packages/module/src/module.ts` (`recoveryDocument` removed),
`packages/fiscal-verifactu/src/completed-recovery-document.ts` (`FISCAL_RECOVERY_DOCUMENT` removed),
`packages/composition/src/modules.ts:308`, `apps/server/src/recovery-document.boot.test.ts` and
`recovery-document-api.test.ts` (deleted with the route), and their other tests.

Also: the comments in `apps/server/src/errors.ts` that name the retired routes
(`backup.recovery_key_missing` at `:1199-1202`, `backup.archive_settings_unreadable` at
`:1272-1276`) say where the codes come from now; `backup.archive_bucket_not_configured`, thrown only
by the archive pack route (`backup-api.ts:548`), is removed from `errors.ts:1295`, the route's status
map (`backup-api.ts:106`), its words at `apps/dashboard/src/i18n/codes.ts:1099` (they live only
there), and its case at `apps/dashboard/src/i18n/codes.test.ts:226-231`; any other code
the removed routes throw is removed only if `grep` finds no other throw site
(`scripts/errors-reachable.test.ts` decides).

Before deleting, trace every consumer once more:
`grep -rn "stream/kit\|archive-recovery-pack\|recovery-document/\|FISCAL_RECOVERY_DOCUMENT\|backup?.recoveryDocument\|backup!.recoveryDocument" apps packages scripts deploy docs`.
Remove only `ModuleBackupContribution.recoveryDocument` (`packages/module/src/module.ts:1551-1561`)
and its users; **leave** the setup seat of the same name, `InitialSetupContribution.recoveryDocument`
(`packages/module/src/initial-setup.ts:54-64`), its fiscal implementation
(`initial-hour-setup.ts:385-405`) and its callers (`packages/provisioning/src/first-setup-recovery-delivery.ts:96`,
`:156`, `:251`, `first-setup-activation.ts:118`, `:198`, `first-setup-command-document.ts:81`, and
`apps/server/src/first-setup-unused-assignment.ts:88`), which setup still uses. Keep
`renderRecoveryPdf` and the old key-file format: the reader still accepts old sheets and its tests
draw with it.

**Checks:** `pnpm --filter @waitron/server exec vitest run src/stream-api.route.test.ts src/backup-api.route.test.ts src/boot.test.ts`;
`pnpm --filter @waitron/fiscal-verifactu exec vitest run src/completed-recovery-document.test.ts`, and the unedited fiscal set;
`pnpm exec vitest run scripts/errors-reachable.test.ts scripts/module-seams.test.ts`.

### Task 19 — guides, operator docs, the look

1. `apps/server/src/guide/en/backup-recovery.md` and `es/` twin: `#proof` ("choose your recovery
   pack, or an older recovery PDF"); same heading ids. (`#source` changed with the setup screens in
   Task 7.)
2. `apps/server/src/guide/en/data-protection.md` (`:384`, `:493`, `:505`) and the Spanish twin:
   the kit becomes the recovery pack.
3. `deploy/README.md:566-568` (the dashboard button sentence) and anything else
   `grep -rn -i "recovery kit\|recovery pdf\|archive recovery pack" deploy docs/developers apps/*/src/guide`
   finds, including `docs/developers/cold-restore-surfaces.md` and `offline-fiscal-restore.md`.
4. `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts`;
   `pnpm exec vitest run scripts/guide-links.test.ts`.
5. **LOOK on the dev stack** (`wa-wt demo <worktree>`): make a pack with and without the tick and
   without an authenticator, open the PDF, restore the bucket field from it in setup. Screenshots
   in the PR.

---

## PR E — setup's first pack

### Task 20 — the first-hour step draws pack 1

**Files:** `packages/fiscal-verifactu/src/recovery-delivery.ts`, `src/setup/first-hour.ts`,
`src/initial-hour-setup.ts:245-264` (command-line setup), tests.

`createRecoveryDelivery` draws the pack (Task 4's renderer, font from the module's asset as
`recovery-pdf.ts:9-13`) with: number 1, `madeBy: null`, the server-key page from Task 10's
`serverKeyPage` with the secret, `serverKey` = the key document, and bucket and archives
`not-set-up`. `documentDigest` stays SHA-256 of the PDF bytes, now the whole pack, so the delivery
record covers the pack (§6); the statement is unchanged, so provisioning and the setup seat do not
change. The command path draws the same pack. Strings (EN and ES) at `first-hour.ts:91-98` and
`:129-136`: **Make recovery pack**, **I kept the recovery pack**, "Recovery pack confirmed", and
`replace` (`:98`, "Replace recovery key", and its Spanish at `:136`) becomes **Make the pack again
with a new server key**, so the step never calls the server key "the recovery key" (design "Words
used here": two keys shared that name); download name `waitron-recovery-pack-1.pdf`. Pack 1 is
recorded received at activation (Task 21), because "I kept it" confirms it.

**Failing tests first:** the delivered PDF reads back through `readRecoveryPdf` (pack branch) to
the staged key; its cover lists bucket copy and archives as "not set up yet"; `documentDigest`
equals the hash of the bytes the download link serves; the command path writes a pack.
Existing `initial-hour-setup.test.ts` and `first-setup-recovery-delivery.test.ts` cases pass
unedited.

**Checks:** `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/initial-hour-setup.test.ts src/setup src/recovery-reader.pack.browser.test.ts`;
`pnpm --filter @waitron/provisioning exec vitest run src/first-setup-recovery-delivery.test.ts src/first-setup-command-document.test.ts`.

**LOOK:** the first-hour step and the drawn pack, EN and ES, light and dark, 390 and 1280.

### Task 21 — pack 1 is recorded at activation

**Files:** `packages/provisioning/src/first-setup-node-key.ts` (inside the transaction at
`:172-182`), test.

In the branch that installs the staged key (`verifier === null && name === null`), insert pack 1
for the node: `made_by` null, `received_at` = the activation time (setup's "I kept it" confirmed
delivery), parts `server-key` included with `keyName` = the stage's name and `carriedKey` true,
bucket and archives `not-set-up`. A publication retry (the `else` branch) inserts
nothing.

**Failing tests first:** after activation `readRecoveryPacks` has exactly pack 1, received; a retried
installation leaves one row; a box with no fiscal module records nothing (no first-hour step). The
Backups card (Task 17) then says "Recovery pack 1, made during setup, …" and marks it out of date
once a bucket copy is set up.

**Checks:** `pnpm --filter @waitron/provisioning exec vitest run src/first-setup-node-key.test.ts src/first-setup-activation.test.ts`.

### Task 22 — backlog and the last look

1. `docs/backlog.md` A1187: part 1 is done, so the entry is rewritten as two short entries, part 2
   (waits for A1188 part 1) and part 3 (waits for B3's retained disk key), each pointing at the
   design; open questions the owner has not answered become their own entries.
2. LOOK on the dev stack with `wa-wt onboarding <worktree>`: run setup to the first-hour step, keep
   the pack, finish, open Backups and check the card.

---

## How part 1 leaves room for parts 2 and 3

- **Parts list.** The builder's ordered list already names `disk` and `emergency` before `bucket`;
  part 2 adds a builder for `emergency` (fed by A1188 part 1's card facts, printed only for
  `node.promote`), part 3 one for `disk` (from B3's host service). The renderer numbers pages from
  what is present, so neither changes it.
- **Record.** `parts` is JSON, so `emergency` (`codeIssuedOn`) and `disk` (`diskId`) entries need no
  migration; `packStatus` compares only recorded parts, so old records stay valid.
- **Refusing a pack.** Part 3's "no complete sheet without the disk key" is a builder that throws a
  refusing error instead of returning `failed`; Task 12b's transaction already commits nothing when
  a pack is refused.
- **Fresh sign-in.** B3's later-sheet rule (password or passkey, plus the code when set up) is the
  Task 9 step, unchanged. B3's first delivery and its record outside the venue database are part 3's.
- **Attached file.** A new restore input (for example the emergency address) would be a version 2
  file; the readers refuse an unknown version today, so a reader is never silently wrong.

## Review focus

- The fiscal reader still refuses everything it refused (its old suite unedited), and a pack never
  hands the setup page anything but the server-key document (Task 5).
- The fresh sign-in binds to the signed-in person, asks for the code exactly when one is set up, and
  is throttled (Tasks 8, 9). Try a body naming another person, and a login passkey challenge.
- Making a pack commits a new server key only after its PDF is drawn, only with the tick, and
  never when the server-key page failed (Task 12b). Try a failing seat with and without the tick.
- A lost answer never leaves the card claiming a pack the person may not hold (decision 10, Tasks
  12b, 13, 16).
- Every read inside the make route's transaction takes `tx` (Task 12a).
- Nothing secret reaches the record, a log line, a header or server memory after the answer.
- A Save or rotation cannot land between a pack's reads (the turn).
- Keep-until dates follow the sweep's actual rule; the server-key pack is never dated.

## Questions the design leaves open

Each was decided here with a conservative default; the owner may change any.

1. **Cover rows for parts not built yet.** Default: a part-1 pack lists only the bucket copy, the
   archives and the server key, numbered cover + 3 pages; no disk-key or emergency rows until those
   parts exist. Alternative: print their rows saying "not in this version", which risks saying
   "not connected to Waitron Cloud" to a venue that is.
2. **Where the PDF's shared code lives.** Default: a new package, `@waitron/recovery-pack` (decision
   1). Alternative: draw the setup pack on the server, which changes the provisioning delivery
   protocol instead.
3. **Keep-until estimate.** Default: the key's change time stands in for the newest archive made
   with the old key, which gives the same or a later date and needs no bucket listing when the card
   loads. **A stated departure from design §4** ("from the archive names' times"), to be named in
   PR C's text; listing them would give an earlier date.
4. **Recovery codes at the fresh sign-in.** *Settled by the coordinator's ruling, 2026-10-29:*
   accepted where an authenticator is set up, consumed as sign-in consumes them (decision 7). The
   earlier draft's claim that a lost phone is handled by signing in with a recovery code first was
   false: signing in with one leaves the authenticator in place (`manager-login.ts:105-120`), and
   the profile checks still demand an authenticator code (`profile.ts:96-105`, `:179`).
5. **New server key requested but its page fails.** *Settled by ruling, 2026-10-29:* the page is
   marked failed with its real cause, no new key is committed, and the pack is still made (design
   §11 item 8; decision 8).
6. **The record table.** Default: `local`, not append-only (it gains `received_at` after writing),
   not a live-update source (decision 4).
7. **A restored box.** Default: no new step in setup's restore flow; the restored box's first pack
   is made from the Backups card, names the key the restore selected, and finds the pack that holds
   it in the restored records if that node's records came back with it, else prints the key name and
   its day. Design §6's "its first pack does not make one" holds because the tick is off by default.
8. **Where Make is offered.** Default: wherever the Recovery PDF card is offered today (`canManage`),
   with no extra check that the node is the primary, as today's kit and recovery-document routes have
   none (`stream-api.ts:275-278`, `recovery-document-api.ts:66-75`).
9. **The server key's name format for a key made by a pack.** Default: unchanged from today's
   dashboard route (`YYYY-MM-DD · <uuid>`, `recovery-document-api.ts:101`), although setup and adopt
   use a four-letter suffix and the mock-up shows one.
10. **The old recovery PDF renderer.** Default: kept, because the reader still accepts old sheets and
    its existing tests draw with it; no production code calls it after PR E.
11. **A lost answer.** Default: a browser confirmation (`received_at`) decides whether a pack counts
    as delivered; the card names an unreceived pack and, when it carries the key in force, says to
    make a new pack with a new server key (decision 10). Alternative: no confirmation and a card
    that always hedges; cost: every venue is told on every visit that it may not hold its key.
12. **A paste field and the drawn code.** Default: the drawn code is for the eye and the QR code;
    setup's bucket fields read the attached file, and the page never invites copying the text,
    because a wrapped 600-character code copied from a PDF viewer would not parse (Task 7).
