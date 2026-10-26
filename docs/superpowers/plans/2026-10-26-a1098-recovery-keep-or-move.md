# A1098: after a cut-off Start again finds files it did not create, the recovery page offers Keep or Move aside — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as `subagent_type: "implementer"`; one that passes about 150 tool calls with its task unfinished stops at a passing or cleanly red point, commits, and returns a handover (done, left, files, each check's state).

**Goal:** when the box starts and finds that an earlier Start again was cut off and files it did not create have appeared since, its recovery page lists those files and, behind the administrator password the interrupted setup names, offers "Keep everything and stop" or "Move these files aside and finish Start again". Nothing the box did not create is ever deleted.

**Architecture:** the start already refuses such a box with `setup.start_again_incomplete` (A1042). This plan makes the refusal's checks collect every finding instead of stopping at the first, groups the findings into movable units, and gives the start two new refusal codes: `setup.start_again_files_found` (the page offers the choice) and `setup.start_again_kept` (Keep was chosen; the page stays). The recovery page gains its first form, served only over the box's HTTPS. A choice is bound to the exact list the page showed by a digest; it is recorded (who, when, what, which files) before anything moves; Move renames the units, unchanged, into a new folder on the same filesystem, then runs A1042's own finisher, which deletes only the interrupted attempt's marked files.

**Tech stack:** TypeScript, Hono (string-rendered page), Node `fs/promises` (`rename`, `lstat` with `bigint`), `@waitron/identity`'s `verifyPassword`, Vitest (real temporary folders; the real HTTPS listener in the boot suite; the small real filesystem of `apps/server/src/testing/full-disk.ts`), Playwright Chromium for the look.

**Spec:** the owner's answer "A1042 line 2: A" (2026-10-25 15:24, `~/waitron-campaign/questions.md`, heading "OWNER ANSWER — A1042 line 2: A") and the question it answers (same file, heading "A1042 build — line 2: …", with the worked example and the English and Spanish words); queue entry A1098 (`~/waitron-campaign/queue.md`). Read both with this plan. A1042's plan, `docs/superpowers/plans/2026-10-24-a1042-start-again-series-note.md` (D3, D5), is the code this builds on.

**Review path:** FULL (it finishes an interrupted Start again, whose note guards invoice series names). The PR ends `needs-owner-review`: the owner approves the words and lands it.

---

## OPEN QUESTIONS (for the owner, before the tasks named)

Each is a point where the code or a house rule does not fit the approved shape as it stands. Tasks not named here can be built meanwhile.

### Q1. The password box is a raw HTML field, which a house rule and its guard forbid (blocks Task 7)

`CLAUDE.md` §3: "A screen does not draw its own form field: a `<select>`, a `<textarea>` or a text `<input>` comes from a field primitive". The guard `scripts/native-form-fields.test.ts` holds an `ALLOWED` list whose comment says "the list shrinks; it does not grow" (`:43`). The recovery page is a string the server builds (`renderPage`, `apps/server/src/recovery-surface.ts:555-611`); it loads no script and no front-end bundle, because it is what the box serves when it cannot start. A `wt-input` cannot run there. Radio buttons and a hidden field are not counted by the guard (`NOT_TEXT`, `:19-30`); the password `<input type="password">` is.

*Worked example.* Elena opens `https://waitron.local` after the cut. The page shows the list, one password box, two radio choices and Continue. The password box is `<input type="password" name="password" autocomplete="current-password" required>` in `apps/server/src/recovery-start-again.ts`; the guard fails on that line.

- **A (recommended):** add one `ALLOWED` entry, `{ file: "apps/server/src/recovery-start-again.ts", lines: 1, reason: "an HTML string the server builds for the page a box serves when it cannot start, with no script or front-end bundle; the server does not depend on @waitron/ui or @waitron/ui-core" }`, following the print agent's entry (`:55-60`). The form follows design-system.md → Forms where no script is needed: both fields marked required with a visible `*` and the native `required` attribute (the browser blocks an empty submit), errors only after the first press, the field's error under the field and one bottom message above Continue. What it cannot do without a script: keep Continue disabled until the fields are filled.
- **B:** no password box on this page; send the person to the setup app for the choice. The setup app is not served while the start is refused, so this needs a second listener mode — a much larger change.

### Q2. Found items the move cannot handle safely (blocks Task 2)

The finisher stops for some findings that are not plain files: a symbolic link or a device file where the attempt's files live, a folder inside `first-setup-resolutions/` that is not a record folder (for example a backup recovery's journal, whose target holds a `venue.lock` — `CLAUDE.md` §3 "Never unlink venue.lock"), or a folder holding a lock file. Moving a folder that holds a lock file moves the lock away from the path other programs open, which is the hazard the never-unlink rule exists for (`packages/store/src/venue-lock.ts:7-10`). Separately, a found folder could hold very many files (a backup stream's folder), and the page binds its choice to a list of every one.

*Worked example.* After the cut, someone copies an older Waitron's `first-setup-resolutions/backup-recovery/` (with `…/target/venue/venue.lock` inside) into the state folder. The finisher refuses "layout unexpected: …/first-setup-resolutions/backup-recovery".

- **A (recommended):** these boxes get today's page for `setup.start_again_incomplete` — the explanation and what reinstalling would lose, no choice — the same as the owner's "setup record gone or changed" branch. Also for more than 20,000 found entries. A backlog entry records it.
- **B:** offer Keep only for them.

### Q3. Series names inside a moved-aside database are not read by the next setup (no task blocked; PR note)

After Move, the box starts a new first setup. Its name chooser reads the note (which already holds every name the interrupted attempt used: the note is raised before the deletion marker is written, `apps/server/src/first-setup-resolution.ts:461` before `:497`, read) and the new database. It does not read a database that was moved aside. If that database is a venue that traded, its series names are not in the new setup's history. Setup takes its name from the box's UTC minute after a second clock agrees within 30 seconds (`CLAUDE.md` §5), so a name the moved database took at an earlier real minute is earlier than the new one, unless that database was made with a clock running ahead. This is the same exposure a reinstall has, and reinstalling is what the owner's Keep text already names as the way out.

*Worked example.* The found `venue.db` is a restored venue whose series is `A-0CNQT` (chosen 14:51). Elena chooses Move at 16:10. The new setup chooses a name for 16:12 or later, which is later than `0CNQT`.

- **A (recommended):** no extra floor; say so in the PR notes.
- **B:** before moving, ask the fiscal module (a new module seat) for the latest name in a found database and raise the note to it. A larger change touching the fiscal module.

### Q4. One existing test assertion changes (blocks Task 6)

`apps/server/src/first-setup-resolution.boot.test.ts:594-630` "a deletion refused for an unlisted file names that file under 'Why the last start failed'" builds exactly the owner's worked example (a `venue.db` placed after the marker, `:376`) and expects the log line `recovery.serving_refused_start` with `errorCode: "setup.start_again_incomplete"` (`:627`). After this change that box is refused `setup.start_again_files_found`. The reason (`"unlisted file: venue/venue.db"`, `:621-627`) is unchanged.

- **A (recommended):** change `:627`'s `errorCode` to `"setup.start_again_files_found"` and nothing else in that case.
- **B:** keep the old code on the log line and choose the page's words some other way. That breaks the recovery page rule that "title and action are fixed strings chosen by the error code" (`CLAUDE.md` §3).

---

## Words used in this plan

- **Marker:** A1042's deletion marker `first-setup-deleting.json` in the venue folder, naming every file of the interrupted attempt with its size and SHA-256 (`packages/provisioning/src/first-setup-start-again-deletion.ts:71-79`).
- **Finisher:** `finishStartAgainDeletion` (`:488-523`), run by every start; it deletes the marked files, or refuses `setup.start_again_incomplete` and deletes nothing.
- **Finding:** one thing the finisher refuses for: a refused artifact present (`:497-500`), a file the marker does not name (`:505`), a marked file whose size or hash differs (`:506-507`), an unexpected `-wal` (`:509-515`).
- **Blocker:** a refusal that is not a finding: the marker damaged or unreadable, folders that differ, an unexpected layout (a link, a special file, an unexpected folder name), a failed check (`EACCES` and the like).
- **Unit:** what Move moves as one piece (D2).
- **Survey:** the list of units and their digest, built from the findings (D2).
- **Setup record:** the state folder's `first-setup.json`. It holds the administrator's name, email and password hash (`frozen.request.admin`, `ownerVerifier`; equal by `packages/provisioning/src/first-setup-state.ts:365`).
- **Set-aside folder:** where Move puts the units (D4).
- **Choice record:** the file that records a choice (D5).
- **Guess counter:** the file that counts wrong passwords (D6).

## Global constraints

- Fiscal gates pass **unedited**: `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts` and `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad`. No change to `registerSif`, fiscal writers, hashes, numbering, SQL, migrations, `registros_facturacion`, or the note's floor rules.
- No migration. No backwards-compatibility code (`CLAUDE.md` §3; before go-live).
- **Nothing the box did not create is ever deleted, moved before a recorded choice, or changed.** The only deletion is A1042's finisher over the marker's own files.
- **Never unlink, rename or move** `venue.lock`, `venue.lock-journal`, `venue.holder.json`, `migrations.lock` or `recovery.lock`, nor a folder that holds one. `recovery.json` is not written by anything here.
- Each new provisioning file has `import "./errors.js";`. New codes are registered in `packages/provisioning/src/errors.ts` with no params.
- The recovery page's title and action stay fixed strings chosen by the error code. Every string from outside the image (the found paths, the set-aside folder name) is HTML-escaped.
- No log line carries the administrator's name or email. `displayName` and `email` are on `PERSONAL_LOG_KEYS` (`apps/server/src/log-personal-data.ts:33-34`), but nothing here logs them at all.
- English only in code, tests and comments. Spanish only in the page's text tables (the precedent is `OPERATOR_TEXT`'s `es-ES` rows, `apps/server/src/recovery-surface.ts:260-488`) and the Spanish guide.
- Coverage holds `98/98/98/95` in `@waitron/provisioning` and `@waitron/server` (CI measures it).
- **Any change to an existing assertion not listed in "Existing assertions this plan changes" is a STOP**: the implementer reports it and does not make it.
- A Vitest run with no `Tests` count is no evidence (`CLAUDE.md` §4). Under an agent, unset `AI_AGENT` and `CLAUDECODE` to see a passing test's output. Run every command from the worktree root.
- Implementers stage explicit paths, commit with `git commit -s`, and do not push.

## Current behaviour (read at ef4322c82, runs named)

Run on 2026-10-26 at ef4322c82:

- `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/server exec vitest run src/first-setup-resolution.boot.test.ts -t "unfinishable deletion|unlisted file"`: 3 passed, 21 skipped. Its output carries `{"port":…,"tls":true,…,"event":"recovery.listening"}` and `{"errorCode":"setup.start_again_incomplete","reason":"size or hash differs: state/first-setup.json",…,"event":"recovery.serving_refused_start"}`. So the refused page is served over HTTPS by the real `serveRecovery` in that suite, and the suite's "unfinishable" box is the setup-record-changed branch.
- `node -e` with the never-wipe patterns copied from `apps/server/src/recovery-surface.test.ts:182,391`: the owner's Move sentence, English "…and the rest of the interrupted setup is removed." and Spanish «…y se quita el resto de la configuración interrumpida.», match **neither** pattern (`false`, `false`); the controls "Delete these files." and «Borra estos archivos.» match (`true`, `true`). With `|\bremov` added to the English pattern and `|\bquita|\bsuprim` to the Spanish one, both Move sentences match (`true`, `true`). So today's guard would not notice the exception at all; D8 widens it for the new text and names the one exception.

Everything below was read, not run.

**The start's refusal.** `resolveFirstSetupEntry` (`apps/server/src/first-setup-entry.ts:56-86`) calls `refusedAtStart` (`:91-112`) first: canonicalise the folders, `emptyDiscardedRecovery`, `assertNoLegacyFirstSetupWorkspace`, then `finishStartAgainDeletion`; an `AppError` whose code is in `START_REFUSALS` (`:88`) becomes `{ kind: "refused", code, roots, error }`. The supervised entry serves `recoveryApp` with `refusedAtStart: true` and a Retry that exits (`apps/server/src/node-entry.ts:394-421`); the direct entry does the same with `requestRestart` (`apps/server/src/first-setup-launch.ts:112-128`). Raw `bootServer` refuses while a marker exists (`apps/server/src/boot.ts:886`) and never finishes one.

**The finisher stops at the first finding.** It reads the marker, takes `lockVenueDatabase`, checks refused artifacts (`REFUSED`, `first-setup-start-again-deletion.ts:36-57`, checked at `:497-500`), then every listed item on disk (`itemsOnDisk`, `:264-318`) for an unlisted file or a changed size or hash, then each `-wal`, and throws at the first one (`:488-523`). A link, a special file or an unexpected folder name throws "layout unexpected" from `entries`/`itemsOnDisk` (`:205-212,270,278,301-306`).

**The recovery page.** Fixed title and action per code (`OPERATOR_TEXT`, `recovery-surface.ts:260-488`; `setup.start_again_incomplete` at `:472-485`, A1042's stop-gap words), one form (Retry, `:600-602`), no password and no other form. Its Retry exits the process (`node-entry.ts:414-416`). Its wording never suggests wiping or resetting (`:256-258`), pinned by "never suggests wiping anything, in either language" (`recovery-surface.test.ts:386-394`), which reads `OPERATOR_TEXT` and `GENERIC_TEXT` actions only. The A1042 cases "neither refused start sends the person to someone else" and "the unfinished Start again line never tells the person to reinstall" are at `:1183-1199`.

**The secure connection.** `serveRecovery` (`apps/server/src/recovery-listener.ts:131-207`) mounts the supplied app only when `inspectBoxTls` finds the box's TLS healthy (`:143-150,176`), and then serves it over HTTPS with the box's own minted leaf (`recoveryTlsFiles` → `mintedBoxLeaf`, `:152`, `apps/server/src/box-secrets.ts:65-69`). Otherwise it serves only the connection-bootstrap routes (`:154`), never the recovery app. The plain-HTTP landing listener serves certificate help only (`landingConfigFrom`, `tls: undefined`, `:239`; `docs/developers/conventions-ui.md:268-269`). In the image the port is 443 (`deploy/Dockerfile:277`). The house check for an HTTPS request is `socket instanceof TLSSocket && socket.encrypted` on `c.env.incoming.socket` (`apps/server/src/setup-first-fiscal-api.ts:765`, `setup-first-backup-api.ts:73-84`, which also checks `Origin` and `Sec-Fetch-Site`). So the page is already reached over HTTPS on a box; what is missing is a check on the request itself.

**Today's password limits are in memory.** `createPasswordThrottle` (`packages/provisioning/src/password-throttle.ts:57-177`) keeps its counts in a `Map`; the repair page's owner uses it keyed `"first-setup"` (`packages/provisioning/src/first-setup-owner.ts:149,194`). The recovery page's Retry, which anyone on the network can press, restarts the process, so an in-memory count would be cleared by one press.

**The password.** `first-setup.json` holds `ownerVerifier`, always equal to `frozen.request.admin.passwordHash` (`first-setup-state.ts:365`), and `frozen.administratorId` and `frozen.request.admin.{displayName,email}` (`:45-53`). `parseState` is exported as `parseFirstSetupState` (`packages/provisioning/src/index.ts:39`). `verifyPassword(password, stored): Promise<boolean>` (`packages/identity/src/verify-password.ts:17`). The house derives a password before taking the venue lock (`setup-first-fiscal-api.ts:834`).

**Writes and locks.** `writeDurableHostJson` writes a temporary file, syncs, renames and syncs the folder, making the folder `0700` (`packages/provisioning/src/durable-host-json.ts:66-106`); any failure, a full disk included, becomes `setup.attempt_invalid` (`:102-103`). `lockVenueDatabase` is shared within one process ("another caller in THIS process shares the hold", `packages/store/src/venue-lock.ts:71`). A1042's confirmation records are write-once by an `lstat` check (`packages/provisioning/src/first-setup-start-again-confirmation.ts:131-149`).

**Folders.** On a box the venue folder is `<state>/venue` (`apps/server/src/config.ts:529`) and only the `state` volume is mounted (`deploy/compose.yml:42-45`), so both are on one filesystem. `WAITRON_VENUE_DIR` can move the venue folder elsewhere.

**Sweeps that touch these folders.** `clearReplacedDatabases` removes only folders in the venue folder named `.venue.db-replaced-*` (`apps/server/src/restore.ts:95,635-660`); a restore removes `<venue>/.venue.db-litestream` (`:530`); `freeSpaceAtStart` removes backup staging, staged recovery copies, rotated logs and crash reports (its contract, `apps/server/src/start-space.ts:53-60`); A1042's deletion walks only names on its list (`listed`, `first-setup-start-again-deletion.ts:100-118`); a plain `waitron.sh reset` empties the state folder except `tls`, the note and the confirmations (`deploy/waitron.sh:741-748`), pinned by `scripts/waitron-sh.test.mjs:1495-1537`. `FIRST_SETUP_HOST_FILES` (`first-setup-state.ts:137-153`) is what restores and recovery bundles refuse to carry (`apps/server/src/restore.ts:238`, `apps/server/src/state-secrets.ts:87`).

**Guides.** `apps/server/src/guide/{en,es}/backup-recovery.md`, section `{#interrupted-setup}`, describes Start again and "If the page says that Start again has not finished…" (`en:41-42`). The recovery page itself serves no guide (`conventions-ui.md:268-269`).

## Decisions

### D1. Four outcomes at the start, each its own code

`refusedAtStart` keeps its order and gains three steps:

1. canonicalise, `emptyDiscardedRecovery`, `assertNoLegacyFirstSetupWorkspace` (unchanged);
2. **`assertStartAgainNotKept(roots)`** — with a marker present and a Keep record for that marker (D5), refuse `setup.start_again_kept`. Before the finisher, so a kept box stays on its page even if the found files are later removed ("This page stays until Waitron is reinstalled");
3. **`resumeStartAgainSetAside(roots)`** — finish a Move a cut interrupted (D4);
4. `finishStartAgainDeletion` (unchanged);
5. on its `setup.start_again_incomplete` only, **`classifyStartAgainRefusal(roots, error)`**: a survey of kind `choice` gives `setup.start_again_files_found` (same log-only `reason`) and the survey; anything else gives the finisher's own error back, unchanged.

| Box | Code | Page |
| --- | --- | --- |
| Found units, setup record intact | `setup.start_again_files_found` (new) | explanation, file list, password, two choices |
| Keep chosen for this marker | `setup.start_again_kept` (new) | what was chosen, what reinstalling would lose; no form |
| Setup record gone or changed; a blocker; Q2's cases | `setup.start_again_incomplete` (unchanged) | A1042's explanation and reinstall line (`recovery-surface.ts:472-485`), unchanged |

Both new codes join `START_REFUSALS`. Raw `bootServer` is unchanged (it refuses while any marker exists, `boot.ts:886`).

### D2. Findings, units, the survey and its digest

The finisher's checks become one collecting pass, `collectStartAgainFindings(roots)`, which returns `{ marker, findings, blocker }` in the finisher's present order. `finishStartAgainDeletion` throws the first finding's reason with today's exact text (`refused artifact present: …`, `unlisted file: …`, `size or hash differs: …`, `unexpected -wal: …`), or the blocker, so no existing reason changes.

Units, from findings:

- **A database:** a finding on `venue.db`, `venue.db-wal` (`venue/venue.db` listed and unchanged but its `-wal` unexpected counts), or `node.db` and its `-wal`, makes one unit of the main file and every present `-wal`, `-shm`, `-journal` beside it. A database never moves without its side files: committed rows can live in the `-wal` alone (A1042 plan, "Current behaviour").
- **A refused artifact** (file or folder, `REFUSED`) is one unit.
- **An unlisted file** is one unit, except: inside `first-setup-resolutions/<uuid>/` (or one of its `step-NNNNNN/` folders) when the marker names no file in that folder, the folder is the unit, so no folder the box did not create is ever emptied and removed by the finisher's `rmdir`.
- **A changed marked file** is one unit. A changed `state/first-setup.json` is not a unit: the survey is `explain` (setup record changed).

Survey:

```ts
export interface StartAgainEntry {
  readonly path: string; // relative to the unit's root, "/"-separated
  readonly type: "file" | "folder";
  readonly ino: string; // decimal, from lstat(…, { bigint: true })
  readonly size: string | null; // files only
  readonly mtimeNs: string | null; // files only: a folder's own times change when it is renamed into a new parent
}
export interface StartAgainUnit {
  readonly root: "venue" | "state";
  readonly path: string; // the unit's top path, as listed on the page
  readonly why: "not-created" | "changed";
  readonly entries: readonly StartAgainEntry[]; // the unit and everything under it, sorted by path
}
export type StartAgainSurvey =
  | {
      readonly kind: "choice";
      readonly attemptId: string;
      readonly frozenDigest: string;
      readonly markerSha256: string;
      readonly units: readonly StartAgainUnit[]; // sorted by (root, path)
      readonly digest: string; // sha256 hex of JSON.stringify([attemptId, frozenDigest, markerSha256, units])
    }
  | { readonly kind: "explain"; readonly reason: string };
export const START_AGAIN_ENTRY_LIMIT = 20_000;
```

`surveyStartAgainLeftovers(roots): Promise<StartAgainSurvey | null>` (`null`: no marker). It is `explain` when: the marker does not name `state/first-setup.json`, or that file is absent, or changed (the owner's "setup record gone or changed"); `parseFirstSetupState` refuses it; there is a blocker; a unit holds an entry named `venue.lock`, `venue.lock-journal`, `venue.holder.json`, `migrations.lock` or `recovery.lock`, or a link or special file; or entries exceed `START_AGAIN_ENTRY_LIMIT` (Q2 A). No file is hashed except the marked files the finisher already hashes. Metadata is enough to tell "the files differ from the listed ones": a rewrite changes `mtimeNs` or `size`, a swap changes `ino`.

### D3. The page binds the choice to the list it showed

The survey is taken once at the start and held by the page; every `GET /` draws that list. The form carries the survey's `digest` in a hidden field `listed`. The choice is accepted only if a new survey, taken **under the venue lock**, has the same digest and is still `choice`. Otherwise it is refused `setup.start_again_files_changed` with nothing changed, and the page says to press Retry, whose restart takes a fresh survey. A digest mismatch is checked before the password, so it costs no guess.

### D4. Move: where, how, and finishing after a cut

**Where.** One new folder per choice, named by the choice record's stem `<ms>-<attemptId>`:

- state units → `<state>/first-setup-set-aside/<stem>/state/<path>`;
- venue units → `<state>/first-setup-set-aside/<stem>/venue/<path>` when the venue folder and the state folder are on one filesystem (`lstat(…).dev` equal, the box's layout); otherwise `<venue>/first-setup-set-aside/<stem>/<path>`.

The name never starts `.venue.db-replaced-`, so `clearReplacedDatabases` never sees it; no sweep listed in "Current behaviour" names it (D9 adds tests).

**How.** Under the venue lock, after the choice record is written (D5):

1. Before anything else (before the record): each unit's source and its destination parent are on one filesystem, else refuse `setup.start_again_incomplete` (`reason: "set-aside on another filesystem: <root>/<path>"`). So `rename` never meets `EXDEV`, and nothing is ever copied.
2. `mkdir <root>/first-setup-set-aside` (recursive, mode `0700`), then `mkdir <stem>` **not** recursive: an existing folder refuses `setup.attempt_conflict`. Nothing is ever overwritten: before each `rename` the destination must be absent (`lstat` → `ENOENT`), inside a folder this call just made.
3. Each unit by `rename`, syncing the source and destination parents. A database unit moves `-wal`, `-shm`, `-journal` first and the main file last, so a cut leaves the main file with no stray `-wal` beside a later database.
4. Then `finishStartAgainDeletion(roots)`, A1042's own path: it re-checks the marker, finds no finding left, deletes the marked files and removes the marker. The note is not touched (it was raised before the marker, `first-setup-resolution.ts:461,497`).

**After a cut.** `resumeStartAgainSetAside(roots)` runs at every start before the finisher (D1). With a marker and a Move record for that marker, it takes the venue lock and, for each recorded unit: source present with the recorded entries and destination absent → move it; source absent and destination present with the recorded entries → done; otherwise stop and leave the rest to the finisher, whose refusal shows the page again with whatever is left. It never deletes.

**A full disk.** `rename` needs no new data blocks; `mkdir` and the record do. A failed record write refuses before anything moves. A failed `mkdir` or `rename` after the record leaves every unit either at its source or at its destination, and the next start resumes.

### D5. The choice record: who, when, what, which files

`<state>/first-setup-start-again-choices/<ms>-<attemptId>.json`, written once (an existing name refuses `setup.attempt_conflict`; the module exports no delete), by `writeDurableHostJson`, limit 8 MiB:

```ts
export interface StartAgainChoiceRecord {
  readonly version: 1;
  readonly at: string; // server clock, toISOString()
  readonly attemptId: string;
  readonly frozenDigest: string;
  readonly markerSha256: string;
  readonly choice: "keep" | "move";
  readonly administrator: { readonly administratorId: string; readonly displayName: string; readonly email: string };
  readonly ownerGeneration: number;
  readonly listed: { readonly digest: string; readonly units: readonly StartAgainUnit[] };
  readonly setAside: { readonly state: string; readonly venue: string } | null; // folders relative to their roots; null for keep
}
```

- **Who:** the administrator the setup record names, whose password was just checked.
- **Which files:** the units of the survey whose digest equals the page's (D3).
- It survives the move: it lives in the state folder's top level, which A1042's deletion never walks, and is not a unit.
- Kept like A1042's confirmation records: never deleted except by `waitron.sh reset --all` (Task 11), never carried by a restore or a recovery bundle (`FIRST_SETUP_HOST_FILES`).
- Readers: `assertStartAgainNotKept` (any `keep` record for the marker's `attemptId` and `frozenDigest`), `resumeStartAgainSetAside` (the latest `move` record for the marker), and the choice itself (a `keep` record refuses any later choice, `setup.start_again_kept`). A damaged record for the marker refuses `setup.start_again_incomplete` (reason `choice record damaged: <name>`), so the page falls back to the explanation and nothing moves.

### D6. The password and the limit on wrong guesses

The password is checked with `verifyPassword` against `ownerVerifier` from the setup record, read only from a survey of kind `choice` (the record's bytes equal the marker's fingerprint). Derivation runs before the venue lock (`setup-first-fiscal-api.ts:834`); the survey under the lock (D3) then proves the setup record is still those bytes.

**The guess counter survives a restart**, because the page's own Retry restarts the process: `<state>/first-setup-start-again-guesses.json`, `{ version: 1, attemptId, failures, waitUntil: string | null }`, written by `writeDurableHostJson` (limit 4 KiB).

- Five wrong guesses are free; after the sixth and each later one the next try waits `min(60, 2^(failures − 6))` minutes (1, 2, 4, … 60).
- The count is raised **before** the password is checked, and set back to 0 only after a correct one. A process killed mid-check, or a counter that cannot be written, never gives a free guess: an unwritable counter refuses the try without checking the password.
- A damaged counter is read as `failures: 5, waitUntil: null` and rewritten; a counter for another `attemptId` starts at 0.
- `waitUntil` is the box's wall clock: a clock set back lengthens the wait; one set forward shortens it.
- While waiting: `password.throttled` with `retryAfterSeconds` (reused, `packages/provisioning/src/errors.ts:26`).
- Every try runs in one in-process turn (`inTurn`, `packages/provisioning/src/attempt-turns.ts`), so two sent at once are counted one after the other.

### D7. The secure connection and the form

- `GET /` draws the password box and choices only when the request's socket is TLS (the house check above). Over anything else it draws the explanation and the list with the line "Open this page over the box's secure connection to choose."
- `POST /recovery-api/start-again` refuses unless TLS (403, `insecure`), refuses an `Origin` other than the request's own or a `Sec-Fetch-Site` other than `same-origin`/`none` (403, `otherPage`), takes `application/x-www-form-urlencoded` of at most 4096 bytes with exactly `password`, `choice` (`keep` | `move`) and `listed` (missing field → `setup.request_invalid` with that `field`, 400). It answers an HTML page in the request's language with `Cache-Control: no-store`.
- After Move succeeds it answers, then calls the entry's restart once the response has finished, as `/recovery-api/retry` does (`recovery-surface.ts:637-645`). After Keep it answers the kept page, and the same process then serves the kept page on `GET /`.
- The route is mounted only when the start gave the page a `choice` survey (code `setup.start_again_files_found`).

### D8. Never suggest deleting: the one named exception

The owner's 2026-09-10 rule stays whole for `OPERATOR_TEXT` (the existing guard is unchanged). The new choice text lives in its own table, `START_AGAIN_PAGE_TEXT`, and a new guard reads **every** string in it with wider patterns (English adds `\bremov`, Spanish adds `\bquita|\bsuprim`, from the run above), allowing exactly one key, `moveDetail`, in both languages: the owner-approved exception of 2026-10-25 15:24. The same case asserts `moveDetail` equals the approved words exactly, so the exception cannot drift.

### D9. Nothing sweeps the set-aside folder, the choices or the counter

`FIRST_SETUP_HOST_FILES` gains `first-setup-start-again-choices`, `first-setup-set-aside` and `first-setup-start-again-guesses.json`. A marker naming any of them is refused as damaged, as the note is. A plain `waitron.sh reset` keeps the choices and the set-aside folder (the precedent of A1042's owner answer Q4 for the note and the confirmations) and removes the counter; `reset --all` removes the state volume. Task 10 tests the sweeps listed in "Current behaviour".

## Review Focus

1. **Two browsers at once:** one chooses Keep, a page opened earlier chooses Move. The second is refused (`setup.start_again_kept`) with nothing moved. Task 5b.
2. **A power cut at each step of Move** (after the record, after each rename, before the finish, mid-finish): the next start completes the move and the finish, or shows the page again; the moved bytes are intact; nothing the box did not create is deleted. Tasks 4, 9.
3. **Retry between wrong guesses** never clears the wait: the count is on disk and is raised before the check. Tasks 3, 9.
4. **After Keep, someone removes the found files by hand:** the page still stays and nothing of the attempt is deleted. Task 6.
5. **A found database whose `-wal` holds committed rows:** moved with its side files, `-wal` first; the moved database opens with every row. Task 4.
6. **The new first setup after Move** claims, chooses a name later than the note, and its own Start again, a restore, the start's clean-up and a plain reset leave the set-aside folder and the choice records unchanged. Tasks 10, 11.

## Words for the owner's approval

New `OPERATOR_TEXT` rows (title / action):

| Code | English | Spanish |
| --- | --- | --- |
| `setup.start_again_files_found` title | Start again did not finish, and the box found files it did not expect. | «Empezar de nuevo» no terminó y el equipo encontró archivos que no esperaba. |
| … action | An earlier Start again was cut off. Since then, files have appeared on this box that Start again did not create. They may be a venue restored from a backup. The box has not changed them. | Un «Empezar de nuevo» anterior se interrumpió. Desde entonces han aparecido en este equipo archivos que «Empezar de nuevo» no creó. Pueden ser un local recuperado desde una copia de seguridad. El equipo no los ha cambiado. |
| `setup.start_again_kept` title | Start again did not finish, and everything on this box was kept. | «Empezar de nuevo» no terminó y se ha conservado todo lo que hay en este equipo. |
| … action | Nothing was moved. This page stays until Waitron is reinstalled on this box. If Waitron is reinstalled, everything on this box is lost, the kept files included. | No se ha movido nada. Esta página sigue hasta que se reinstale Waitron en este equipo. Si se reinstala Waitron, se pierde todo lo que hay en el equipo, también los archivos conservados. |

`START_AGAIN_PAGE_TEXT` (`apps/server/src/recovery-start-again.ts`):

| Key | English | Spanish |
| --- | --- | --- |
| `filesFound` | Files found: | Archivos encontrados: |
| `more(n)` | and {n} more | y {n} más |
| `password` | Administrator password | Contraseña de administrador |
| `keepTitle` | Keep everything and stop. | Conservarlo todo y parar. |
| `keepDetail` | Nothing is moved. This page stays until Waitron is reinstalled on this box. | No se mueve nada. Esta página sigue hasta que se reinstale Waitron en este equipo. |
| `moveTitle` | Move these files aside and finish Start again. | Apartar estos archivos y terminar «Empezar de nuevo». |
| `moveDetail` (**the exception**) | The files are moved, unchanged, into a new folder on the box, and the rest of the interrupted setup is removed. The box then starts a new first setup, where you can recover from a backup or set up again. Its invoice series names are never used again. | Los archivos se mueven, sin cambios, a una carpeta nueva del equipo, y se quita el resto de la configuración interrumpida. Después el equipo empieza una configuración inicial nueva, donde puedes recuperar desde una copia de seguridad o configurar de nuevo. Sus nombres de serie de facturas no se vuelven a usar. |
| `continue` | Continue | Continuar |
| `insecureForm` | Open this page over the box's secure connection to choose. | Abre esta página con la conexión segura del equipo para elegir. |
| `passwordMissing` (under the field) | Enter the administrator password. | Introduce la contraseña de administrador. |
| `choiceMissing` (under the choices) | Choose one of the two options. | Elige una de las dos opciones. |
| `fixFields` (bottom) | Check the fields marked above. Nothing was changed. | Revisa los campos marcados arriba. No se ha cambiado nada. |
| `wrongPassword` (under the field) | This is not the administrator password of the interrupted setup. Nothing was changed. | No es la contraseña de administrador de la configuración interrumpida. No se ha cambiado nada. |
| `throttled(n)` (bottom) | Too many wrong passwords. Try again in 1 minute. / … in {n} minutes. Nothing was changed. | Demasiadas contraseñas incorrectas. Vuelve a intentarlo dentro de 1 minuto. / … dentro de {n} minutos. No se ha cambiado nada. |
| `filesChanged` | The files on the box have changed since this page was opened. Nothing was changed. Press Retry to see them as they are now. | Los archivos del equipo han cambiado desde que se abrió esta página. No se ha cambiado nada. Pulsa «Reintentar un arranque normal» para verlos como están ahora. |
| `notOffered` | This choice is no longer offered. Nothing was changed. Press Retry to see the current page. | Esta opción ya no está disponible. No se ha cambiado nada. Pulsa «Reintentar un arranque normal» para ver la página actual. |
| `insecure` | Open this page over the box's secure connection to choose. Nothing was changed. | Abre esta página con la conexión segura del equipo para elegir. No se ha cambiado nada. |
| `otherPage` | This choice must be sent from this page. Nothing was changed. | Esta elección debe enviarse desde esta página. No se ha cambiado nada. |
| `busy` | Another Waitron program is using the box's files. Nothing was changed. Wait a moment, then press Continue again. | Otro programa de Waitron está usando los archivos del equipo. No se ha cambiado nada. Espera un momento y vuelve a pulsar «Continuar». |
| `diskFull` | The box's disk is full, so the choice could not be saved. Nothing was moved. | El disco del equipo está lleno, así que no se ha podido guardar la elección. No se ha movido nada. |
| `notSaved` | The box could not save the choice. Nothing was moved. Press Continue to try again. | El equipo no ha podido guardar la elección. No se ha movido nada. Pulsa «Continuar» para volver a intentarlo. |
| `notFinished` | Start again could not finish. The files it found are unchanged. Press Retry: the box carries on as it starts. | «Empezar de nuevo» no ha podido terminar. Los archivos que encontró no han cambiado. Pulsa «Reintentar un arranque normal»: el equipo continúa al arrancar. |
| `moved(folder)` | Start again has finished. The files are in {folder}. Waitron is restarting into a new first setup; reload this page in a minute. | «Empezar de nuevo» ha terminado. Los archivos están en {folder}. Waitron se está reiniciando en una configuración inicial nueva; recarga esta página dentro de un minuto. |

The Spanish Move text completes the owner's draft, which stopped at «…una configuración inicial nueva.», with the English's last two sentences. `setup.start_again_incomplete`'s words (A1042's stop-gap) are unchanged: they already are "the explanation and what reinstalling would lose".

## Existing assertions this plan changes

- `apps/server/src/first-setup-resolution.boot.test.ts:627`: `errorCode` `"setup.start_again_incomplete"` → `"setup.start_again_files_found"` (Q4; waits for the owner's answer).

Nothing else. In particular `scripts/waitron-sh.test.mjs:1495-1537` is not edited (Task 11 adds a case; the existing pattern still matches because the new clauses follow the ones it names), and every A1042 finisher reason is preserved (D2).

## Files

| File | Responsibility |
| --- | --- |
| `packages/provisioning/src/first-setup-start-again-deletion.ts` (modify) | `collectStartAgainFindings`; the finisher throws the first finding |
| `packages/provisioning/src/first-setup-start-again-leftovers.ts` (new) | units, survey, digest, `classifyStartAgainRefusal` |
| `packages/provisioning/src/first-setup-start-again-names.ts` (new) | the three new file and folder names, with no imports |
| `packages/provisioning/src/first-setup-start-again-choice.ts` (new) | choice records: write once, read for a marker, `assertStartAgainNotKept` |
| `packages/provisioning/src/first-setup-start-again-guesses.ts` (new) | the persisted guess counter |
| `packages/provisioning/src/first-setup-start-again-set-aside.ts` (new) | destinations, the move, `resumeStartAgainSetAside` |
| `packages/provisioning/src/first-setup-start-again-choose.ts` (new) | `chooseStartAgainLeftovers`: counter, password, lock, survey, record, keep or move |
| `packages/provisioning/src/errors.ts`, `index.ts`, `first-setup-state.ts` (modify) | three codes, exports, `FIRST_SETUP_HOST_FILES` |
| `apps/server/src/first-setup-entry.ts` (modify) | D1's order; the refused admission carries the survey |
| `apps/server/src/recovery-start-again.ts` (new) | `START_AGAIN_PAGE_TEXT`, the section's HTML, the POST route |
| `apps/server/src/recovery-surface.ts` (modify) | two `OPERATOR_TEXT` rows; `RecoveryDeps.startAgain`; mounting |
| `apps/server/src/node-entry.ts`, `first-setup-launch.ts` (modify) | pass the survey and the restart to the page |
| `deploy/waitron.sh`, `scripts/waitron-sh.test.mjs` | plain reset keeps the choices and the set-aside folder |
| docs | guides EN/ES, `conventions-ui.md`, `CLAUDE.md`, `deploy/README.md`, `docs/operations/first-live-fiscal-setup.md`, backlog |

---

## Tasks

### Task 0: Owner answers and a line check

- [ ] **Step 1:** Record the owner's answers to Q1–Q4 at the top of this plan (one line each, with the date). A task blocked by an unanswered question is not dispatched.
- [ ] **Step 2:** If `main` has moved past ef4322c82, run `git diff --stat ef4322c82..origin/main -- apps/server/src/first-setup-entry.ts apps/server/src/recovery-surface.ts apps/server/src/recovery-surface.test.ts apps/server/src/node-entry.ts apps/server/src/first-setup-launch.ts packages/provisioning/src/first-setup-start-again-deletion.ts packages/provisioning/src/first-setup-state.ts deploy/waitron.sh scripts/native-form-fields.test.ts`. For each file listed, re-read the lines this plan cites and correct them here before dispatch.

### Task 1: The finisher's checks collect every finding

**Files:** modify `packages/provisioning/src/first-setup-start-again-deletion.ts`; create `packages/provisioning/src/first-setup-start-again-findings.test.ts` (copy the folder helpers `attemptFolders`, `marked`, `snapshot` from `packages/provisioning/src/first-setup-start-again-note.test.ts` rather than moving them).

**Interfaces — produces:**

```ts
export type StartAgainFinding =
  | { kind: "refused-artifact"; root: "venue" | "state"; name: string }
  | { kind: "unlisted"; root: "venue" | "state"; name: string }
  | { kind: "changed"; root: "venue" | "state"; name: string }
  | { kind: "wal"; name: "venue.db-wal" | "node.db-wal" };
export async function collectStartAgainFindings(roots: { stateDir: string; venueDir: string }): Promise<{
  marker: StartAgainMarker;
  markerSha256: string;
  findings: StartAgainFinding[];
  blocker: AppError | null;
} | null>; // null: no marker. Takes no lock; throws setup.start_again_incomplete for a damaged or unreadable marker or folders that differ.
export function startAgainFindingReason(finding: StartAgainFinding): string; // today's exact reason text
```

- [ ] **Step 1: Failing tests.** In the new file: (a) "collects every finding of a box, in the finisher's order": a marked attempt, then `trading.env` in the state folder, a `venue.db` with different bytes, an unlisted `first-fiscal-documents/extra.json` and a non-empty `venue.db-wal`; expect `findings` to equal those four in order refused-artifact, changed, unlisted, wal, and `blocker` null. Today it fails with "collectStartAgainFindings is not a function" (not exported). (b) "a link among the attempt's files is a blocker, after the findings before it": `trading.env` plus a link in `first-fiscal-documents/`; expect one finding and `blocker.reason` starting `layout unexpected:`. (c) "the finisher still refuses with the first finding's reason": for the box of (a), `finishStartAgainDeletion` rejects with `reason: "refused artifact present: state/trading.env"` and the folder snapshot is unchanged.
- [ ] **Step 2:** `pnpm --filter @waitron/provisioning exec vitest run src/first-setup-start-again-findings.test.ts` — expect FAIL on (a) and (b).
- [ ] **Step 3:** Implement. `finishStartAgainDeletion` keeps its lock and its two marker reads, then calls the collector and throws `findings[0]`'s reason, else `blocker`, else deletes as today. `markerSha256` is the SHA-256 of the marker file's bytes.
- [ ] **Step 4:** Run Step 2's command, then the A1042 suites unedited: `pnpm --filter @waitron/provisioning exec vitest run src/first-setup-start-again-findings.test.ts src/first-setup-start-again-deletion.test.ts src/first-setup-start-again-note.test.ts` — all PASS (the reason cases at `first-setup-start-again-note.test.ts:867-958` among them).
- [ ] **Step 5:** `pnpm --filter @waitron/provisioning typecheck`; commit `git add` the two files; `git commit -s -m "Start again's finisher collects every finding before refusing (A1098)"`.

### Task 2: Units, the survey and the start's classification (needs Q2)

**Files:** create `packages/provisioning/src/first-setup-start-again-leftovers.ts` and `…-leftovers.test.ts`; modify `packages/provisioning/src/errors.ts` (add `"setup.start_again_files_found": Record<string, never>`), `packages/provisioning/src/index.ts`.

**Interfaces — consumes:** Task 1. **Produces:** the D2 types; `START_AGAIN_ENTRY_LIMIT`; `surveyStartAgainLeftovers(roots): Promise<StartAgainSurvey | null>`; `classifyStartAgainRefusal(roots, error: AppError): Promise<{ error: AppError; survey?: Extract<StartAgainSurvey, { kind: "choice" }> }>`.

- [ ] **Step 1: Failing tests** (each would print "is not a function" today):
  - "the owner's example: a venue.db placed after the marker is one database unit": survey `choice`, one unit `{ root: "venue", path: "venue.db", why: "not-created" }`, with `venue.db-wal` and `venue.db-shm` among its entries when present.
  - "an unexpected -wal makes the marked venue.db and its side files one unit": `why: "changed"`.
  - "a refused-artifact folder is one unit with every entry under it" (`.venue.db-litestream/` with two files).
  - "an unlisted record folder is the unit, not its files"; "an unlisted file inside a marked record folder is its own unit".
  - "the setup record changed, or gone, explains instead" (`kind: "explain"`), and "a unit holding venue.lock explains" and "a link explains" and "more than START_AGAIN_ENTRY_LIMIT entries explains" (Q2 A).
  - "the digest changes when a listed file's bytes, a folder's contents or an inode change, and not when nothing changes" (rewrite with equal size; add a file inside a folder unit; replace a file by rename; re-survey untouched).
  - "moving every unit by hand leaves the finisher nothing to refuse": for a box holding one of each finding kind, `rename` each unit out by hand in the test, then `finishStartAgainDeletion` resolves and only the marked files are gone. This pins that the survey is the exact complement of what the finisher refuses.
  - "classifyStartAgainRefusal gives files_found with the finisher's reason, and gives the finisher's error back unchanged otherwise".
- [ ] **Step 2:** `pnpm --filter @waitron/provisioning exec vitest run src/first-setup-start-again-leftovers.test.ts` — FAIL.
- [ ] **Step 3:** Implement D2. `lstat(path, { bigint: true })`, never following a link.
- [ ] **Step 4:** Step 2's command PASSES; `pnpm --filter @waitron/provisioning typecheck`.
- [ ] **Step 5:** Commit the three files with `git commit -s -m "Start again's leftovers: units, a survey and its digest (A1098)"`.

### Task 3: Choice records and the guess counter

**Files:** create `packages/provisioning/src/first-setup-start-again-names.ts`, `first-setup-start-again-choice.ts`, `…-choice.test.ts`, `…-guesses.ts`, `…-guesses.test.ts`; modify `errors.ts` (add `"setup.start_again_kept": Record<string, never>`), `index.ts`, `first-setup-state.ts` (`FIRST_SETUP_HOST_FILES` gains `START_AGAIN_CHOICES_DIR`, `START_AGAIN_SET_ASIDE_DIR` and `START_AGAIN_GUESSES_FILE`). The three names live in a new module with no imports, `packages/provisioning/src/first-setup-start-again-names.ts` (`START_AGAIN_SET_ASIDE_DIR = "first-setup-set-aside"`), which `first-setup-state.ts`, the choice, guess and set-aside modules all import. The choice module reads the marker through the deletion module, which already imports `first-setup-state.ts` indirectly; importing the names from the choice module there would close the load-order loop `first-setup-state.ts:149-151` warns about.

**Interfaces — produces:**

```ts
export const START_AGAIN_CHOICES_DIR = "first-setup-start-again-choices";
export async function writeStartAgainChoice(stateDir: string, record: Omit<StartAgainChoiceRecord, "version">): Promise<string>; // the stem
export async function readStartAgainChoices(stateDir: string, marker: { attemptId: string; frozenDigest: string }): Promise<StartAgainChoiceRecord[]>; // by name, oldest first
export async function assertStartAgainNotKept(roots: { stateDir: string; venueDir: string }): Promise<void>; // reads the marker itself
export const START_AGAIN_GUESSES_FILE = "first-setup-start-again-guesses.json";
export const START_AGAIN_FREE_GUESSES = 5;
export function startAgainWaitMs(failures: number): number;
export async function beginStartAgainGuess(stateDir: string, attemptId: string, now: Date): Promise<(outcome: "success" | "invalid") => Promise<void>>;
```

- [ ] **Step 1: Failing tests.** Choice: "a record is written once, with every field, and a second write of the same stem is refused setup.attempt_conflict"; "records for another attempt or another frozen digest are not read"; "a damaged record for the marker refuses setup.start_again_incomplete"; "assertStartAgainNotKept refuses setup.start_again_kept with a keep record for the marker, and passes with only a move record or none"; "a marker naming the choices folder, the set-aside folder or the counter is refused as damaged" (beside A1042's case for the note); "isFirstSetupHostPath names all three". Guesses: "startAgainWaitMs is 0 up to five failures, then 1, 2, 4 … minutes, and never more than 60"; "the count is on disk before the check: begin, then a new begin from a fresh import sees it raised" (the restart case); "a wrong guess past the free ones refuses the next try password.throttled with retryAfterSeconds"; "success sets the count back to 0"; "an unwritable counter refuses the try" (state folder made read-only: `beginStartAgainGuess` rejects, and the returned finish is never reached); "a damaged counter reads as five failures"; "another attempt's counter starts at 0". Today each prints "is not a function" or fails on the missing name.
- [ ] **Step 2:** `pnpm --filter @waitron/provisioning exec vitest run src/first-setup-start-again-choice.test.ts src/first-setup-start-again-guesses.test.ts src/first-setup-state.test.ts` — FAIL on the new cases.
- [ ] **Step 3:** Implement D5 and D6. Record validation follows `first-setup-start-again-confirmation.ts` (exact keys, canonical instants, UUIDs).
- [ ] **Step 4:** Step 2's command PASSES; also `src/first-setup-start-again-deletion.test.ts src/first-setup-start-again-note.test.ts`; typecheck.
- [ ] **Step 5:** Commit; `git commit -s -m "Start again choice records and a guess counter that survives a restart (A1098)"`.

### Task 4: Move aside, and finishing a Move a cut interrupted

**Files:** create `packages/provisioning/src/first-setup-start-again-set-aside.ts`, `…-set-aside.test.ts`.

**Interfaces — consumes:** Tasks 1–3. **Produces:**

```ts
export interface SetAsideIo { lstat: typeof fs.lstat; mkdir: typeof fs.mkdir; rename: (from: string, to: string) => Promise<void> } // default node:fs/promises; tests inject failures
export async function setAsideDestinations(roots: Roots, stem: string): Promise<{ state: string; venue: string }>; // relative-to-root folders for the record
export async function assertSetAsideSameFilesystem(roots: Roots, units: readonly StartAgainUnit[], destinations: { state: string; venue: string }): Promise<void>;
export async function moveStartAgainUnits(roots: Roots, record: StartAgainChoiceRecord, io?: SetAsideIo): Promise<void>; // caller holds the venue lock
export async function resumeStartAgainSetAside(roots: Roots, io?: SetAsideIo): Promise<"none" | "resumed" | "stopped">;
```

- [ ] **Step 1: Failing tests:**
  - "units move unchanged into a new folder: same bytes, same inode, same file times, relative paths kept", for a file unit, a folder unit and a database unit.
  - "a database whose -wal holds committed rows moves whole, -wal first, and opens with every row": write rows in WAL mode with `node:sqlite` and leave them in the `-wal`; record the rename order through an injected `io`; after the move open the moved `venue.db` read-only and count the rows.
  - "an existing stem folder refuses setup.attempt_conflict and moves nothing"; "an existing destination file is never overwritten".
  - "another filesystem refuses before the record and moves nothing": inject `lstat` returning a different `dev` for the venue folder.
  - "on one filesystem venue units go under the state folder's set-aside folder; on two, under the venue folder's own".
  - "a cut after the record and before the first rename: the next resume moves everything", "a cut after each rename: resume finishes the rest", "a unit changed between the cut and the resume: resume stops and moves nothing more" (each by injecting a `rename` that throws on call N, then calling `resumeStartAgainSetAside`).
  - "venue.lock, venue.holder.json and recovery.lock are never moved or unlinked": present before, same inode after.
  - "after a move, finishStartAgainDeletion deletes only the marked files, and the note's bytes are unchanged" (raise a note with `raiseStartAgainNote` first).
- [ ] **Step 2:** `pnpm --filter @waitron/provisioning exec vitest run src/first-setup-start-again-set-aside.test.ts` — FAIL ("is not a function").
- [ ] **Step 3:** Implement D4. `resumeStartAgainSetAside` takes `lockVenueDatabase(venueDir)` itself.
- [ ] **Step 4:** Step 2's command PASSES; typecheck.
- [ ] **Step 5:** Commit; `git commit -s -m "Move a cut-off Start again's found files aside, unchanged, and finish a move a cut interrupted (A1098)"`.

### Task 5a: The choice — password, counter, binding

**Files:** create `packages/provisioning/src/first-setup-start-again-choose.ts`, `…-choose.test.ts`; modify `errors.ts` (add `"setup.start_again_files_changed": Record<string, never>`), `index.ts`.

**Interfaces — produces:**

```ts
export async function chooseStartAgainLeftovers(input: {
  roots: Roots;
  password: string;
  choice: "keep" | "move";
  listed: string; // the digest the page showed
  now: () => Date;
  io?: SetAsideIo;
  verify?: (password: string, stored: string) => Promise<boolean>; // test seam; defaults to verifyPassword
}): Promise<{ choice: "keep" } | { choice: "move"; setAside: { state: string; venue: string } }>;
```

Order: one `inTurn` turn → survey without the lock (`null` or `explain` → `setup.not_ready`; a keep record → `setup.start_again_kept`; digest ≠ `listed` → `setup.start_again_files_changed`) → `beginStartAgainGuess` → `verifyPassword` (wrong → `setup.owner_required`) → `lockVenueDatabase` → survey again → digest ≠ `listed` → `setup.start_again_files_changed` → keep record check again → (Task 5b).

- [ ] **Step 1: Failing tests:** "a wrong password is refused setup.owner_required, counted, and changes no file of either folder except the counter" (folder snapshot before and after, the counter excluded); "the sixth wrong password makes the next try wait, and a new call — a restart — still waits"; "a digest from an older page is refused setup.start_again_files_changed and costs no guess"; "files changed between the password and the lock: refused, nothing changed" (a `verify` stand-in rewrites the found `venue.db` with other bytes, then answers `true`); "a box whose setup record changed refuses setup.not_ready"; "another process holding the venue folder refuses provisioning.database_in_use, nothing changed"; "two tries sent at once are counted one after the other". Today: "is not a function".
- [ ] **Step 2:** `pnpm --filter @waitron/provisioning exec vitest run src/first-setup-start-again-choose.test.ts` — FAIL.
- [ ] **Step 3:** Implement up to the second survey.
- [ ] **Step 4:** PASS; typecheck. **Step 5:** commit `git commit -s -m "The Start again choice checks the setup's administrator password, counts wrong guesses and binds to the listed files (A1098)"`.

### Task 5b: The choice — record, Keep, Move

**Files:** the same two files.

- [ ] **Step 1: Failing tests:** "Keep writes one record with who, when, what and which files, and moves nothing": the record's `administrator` equals the setup record's `administratorId`, `displayName`, `email`; `at` is the injected clock; `choice: "keep"`; `listed.units` equal the survey's; `setAside: null`; both folder snapshots unchanged except the new record and the counter. "After Keep, a later Move is refused setup.start_again_kept and moves nothing" (Review Focus 1). "Move writes the record before the first rename": inject a `rename` that reads the choices folder on its first call and finds the record. "Move then finishes Start again: the marker and the marked files are gone, the moved files are at the destination unchanged, the note and A1042's confirmation records are byte-identical". "A record that cannot be written refuses setup.attempt_invalid and moves nothing" (choices folder made read-only). "No log call and no thrown error carries the administrator's name or email" (spy on the logger seam if one is added; assert `JSON.stringify` of every thrown error and logged detail excludes both strings).
- [ ] **Step 2:** `pnpm --filter @waitron/provisioning exec vitest run src/first-setup-start-again-choose.test.ts` — the new cases FAIL.
- [ ] **Step 3:** Implement: `assertSetAsideSameFilesystem` before the record (move only), `writeStartAgainChoice`, then Keep returns, Move runs `moveStartAgainUnits` and `finishStartAgainDeletion`.
- [ ] **Step 4:** PASS, with `src/first-setup-start-again-set-aside.test.ts src/first-setup-start-again-note.test.ts`; typecheck. **Step 5:** commit `git commit -s -m "Keep records the choice; Move records it, moves the files aside and finishes Start again (A1098)"`.

### Task 6: The start's four outcomes (needs Q4)

**Files:** modify `apps/server/src/first-setup-entry.ts`, `apps/server/src/first-setup-entry.test.ts`, `apps/server/src/first-setup-resolution.boot.test.ts:627` (Q4 only).

**Interfaces — consumes:** `assertStartAgainNotKept`, `resumeStartAgainSetAside`, `classifyStartAgainRefusal`. **Produces:** `START_REFUSALS` = `["setup.workspace_unsupported", "setup.start_again_incomplete", "setup.start_again_files_found", "setup.start_again_kept"]`; the refused admission `{ kind: "refused"; code; roots; error; survey?: Extract<StartAgainSurvey, { kind: "choice" }> }`.

- [ ] **Step 1: Failing tests** in `first-setup-entry.test.ts` (its `markedDeletion` fixture, `:395-412`): "a venue.db placed after the marker is refused setup.start_again_files_found, with its survey and nothing changed"; "a keep record for the marker is refused setup.start_again_kept even after the found files are removed, and the marked files stay" (Review Focus 4); "a move record with every unit still in place is resumed and setup is served" (`kind: "normal"`, marker gone, units at the destination); "a changed setup record is still refused setup.start_again_incomplete with today's reason" — this is the existing case `:434-454`, which must pass unedited.
- [ ] **Step 2:** `pnpm --filter @waitron/server exec vitest run src/first-setup-entry.test.ts` — FAIL on the new cases.
- [ ] **Step 3:** Implement D1 in `refusedAtStart`. Apply Q4's change to `first-setup-resolution.boot.test.ts:627` only after the owner's answer is recorded in Task 0.
- [ ] **Step 4:** `pnpm --filter @waitron/server exec vitest run src/first-setup-entry.test.ts src/first-setup-resolution.boot.test.ts src/first-setup-workspace.test.ts src/recovery-state.test.ts src/first-setup-start-again-note.test.ts` — PASS. Any other failing existing assertion is a STOP.
- [ ] **Step 5:** `pnpm --filter @waitron/server typecheck`; commit `git commit -s -m "The start tells found files, a kept choice and an unfinished Start again apart (A1098)"`.

### Task 7: The page's words and its never-delete guard (needs Q1)

**Files:** create `apps/server/src/recovery-start-again.ts` (text table and HTML only in this task), `apps/server/src/recovery-start-again.test.ts`; modify `apps/server/src/recovery-surface.ts` (two `OPERATOR_TEXT` rows), `apps/server/src/recovery-surface.test.ts` (new cases only; add the two codes to `ROWS` at `:1114-1156` as new entries — adding rows changes no existing row), `scripts/native-form-fields.test.ts` (Q1 A's entry).

**Interfaces — produces:**

```ts
export const START_AGAIN_PAGE_TEXT: Readonly<Record<SupportedLocale, StartAgainPageText>>; // keys of "Words for the owner's approval"
export type StartAgainMessage =
  | { kind: "passwordMissing" | "choiceMissing" | "wrongPassword" | "filesChanged" | "notOffered" | "insecure" | "otherPage" | "busy" | "diskFull" | "notSaved" | "notFinished" }
  | { kind: "throttled"; minutes: number }
  | { kind: "moved"; folder: string };
export function renderStartAgainSection(input: {
  survey: Extract<StartAgainSurvey, { kind: "choice" }>;
  locale: SupportedLocale;
  secure: boolean;
  message?: StartAgainMessage;
  chosen?: "keep" | "move"; // re-checks the radio after a refusal
}): string; // HTML for between the action paragraph and the Retry form
```

The list shows each unit's top path as `venue/<path>` or `state/<path>`, a folder with a trailing `/`, a database unit followed by its side files, at most 50 lines then `more(n)`. Every path goes through `escapeHtml`. The form: `method="post" action="/recovery-api/start-again"`, the password box (`name="password"`, `autocomplete="current-password"`, `required`, visible `*` in its label), two radios `name="choice"` with values `keep` and `move` (`required`), each with its title in bold and its detail below, the hidden `listed`, Continue. Field errors sit under their field; one bottom message above Continue. No colour, size or font is set (the page sets none today, `recovery-surface.ts:594`).

- [ ] **Step 1: Failing tests:**
  - In `recovery-surface.test.ts`: the two new codes in `ROWS` (so "names $code in both languages", "says a refused $code start was not counted", "neither refused start sends the person to someone else" cover them); "never suggests deleting in the Start again choices, except the one owner-approved sentence" — every string of `START_AGAIN_PAGE_TEXT` (functions called with sample arguments) refused by the wider patterns of D8 except `moveDetail`, which must equal the approved English and Spanish exactly, and must match the wider pattern (the run in "Current behaviour" printed `true`, `true`). The existing "never suggests wiping anything" case stays as it is.
  - In `recovery-start-again.test.ts`: "lists the owner's example as venue/venue.db"; "escapes a found path holding markup" (a file named `<b>x</b>`); "draws no password box when the request is not secure, and says how to choose"; "shows 50 paths and 'and N more'"; "marks both fields required"; "shows each message in both languages in its place" (field messages under their field, the rest above Continue); "a Spanish string differs from its English twin for every key".
  - Today: the module does not exist, and the two codes are not in `OPERATOR_TEXT`.
- [ ] **Step 2:** `pnpm --filter @waitron/server exec vitest run src/recovery-surface.test.ts src/recovery-start-again.test.ts` — FAIL. `pnpm exec vitest run scripts/native-form-fields.test.ts` — FAIL on the new file once the password box exists.
- [ ] **Step 3:** Implement the table and `renderStartAgainSection`; add the `ALLOWED` entry (Q1 A).
- [ ] **Step 4:** The two Step 2 commands PASS, `recovery-surface.test.ts` whole; `pnpm exec vitest run scripts/english-only.test.ts scripts/native-form-fields.test.ts`; typecheck.
- [ ] **Step 5:** Commit; `git commit -s -m "The recovery page's words for found files and a kept choice, with the one approved removal sentence named in its guard (A1098)"`.

### Task 8: The page's form route, wired into both entries

**Files:** modify `apps/server/src/recovery-start-again.ts` (add `mountStartAgainChoice`), `apps/server/src/recovery-surface.ts` (`RecoveryDeps.startAgain`, `renderPage` inserts the section, `recoveryApp` mounts the route), `apps/server/src/node-entry.ts:394-421`, `apps/server/src/first-setup-launch.ts:112-128`; tests in `apps/server/src/recovery-start-again.test.ts`.

**Interfaces:**

```ts
// RecoveryDeps, recovery-surface.ts
startAgain?: {
  roots: { stateDir: string; venueDir: string };
  survey: Extract<StartAgainSurvey, { kind: "choice" }>;
  onFinished: () => Promise<void>; // the entry's restart
  choose?: typeof chooseStartAgainLeftovers; // test seam; defaults to the real one
  now?: () => Date;
};
```

Code to page: `setup.request_invalid` (field `password` or `choice`) → `passwordMissing`/`choiceMissing` + `fixFields`, 400; `setup.owner_required` → `wrongPassword`, 403; `password.throttled` → `throttled` (minutes rounded up), 429 with `Retry-After`; `setup.start_again_files_changed` → `filesChanged`, 409; `setup.not_ready` and `setup.start_again_kept` → `notOffered`, 409; `provisioning.database_in_use` → `busy`, 409; `setup.attempt_invalid` → `diskFull` when `lowestFreeBytes([stateDir, venueDir])` (`apps/server/src/start-space.ts:22`) is under `FULL_DISK_BYTES` (`apps/server/src/boot-failure.ts:47`), else `notSaved`, 409; anything else → `notFinished`, 409, logged `recovery.start_again_choice_failed` with `errorCode` only. Success: Keep → 200 with the kept code's page, and later `GET /` serves it; Move → 200 with `moved`, then `onFinished` once the response has finished. Log `recovery.start_again_choice` with `{ choice, attemptId, units: <count> }` only.

- [ ] **Step 1: Failing tests** (through `app.request` with `env` `{ incoming: { socket: new TLSSocket(new Socket()) } }`, as `apps/server/src/first-setup-start-again-note.test.ts:338-342`, and `choose` stubbed except where named): "a POST without TLS is refused 403 and choose is never called"; "a POST from another origin is refused 403"; "an over-long or wrongly typed body is refused 400"; each code-to-page row above; "Move restarts only after the answer is written"; "after Keep, GET / shows the kept page and no form"; "the log line names no person" (assert the logged fields' keys are exactly `choice`, `attemptId`, `units`); "with the real choose and a real fixture, Keep then GET shows the kept title". Today the route answers 404.
- [ ] **Step 2:** `pnpm --filter @waitron/server exec vitest run src/recovery-start-again.test.ts` — FAIL.
- [ ] **Step 3:** Implement; both entries pass `startAgain` when `admission.survey` is present, with `onFinished` = the same exit (`node-entry.ts`) or `requestRestart` (`first-setup-launch.ts`) their Retry uses.
- [ ] **Step 4:** PASS; then `pnpm --filter @waitron/server exec vitest run src/recovery-surface.test.ts src/first-setup-entry.test.ts src/first-setup-resolution.boot.test.ts`; typecheck.
- [ ] **Step 5:** Commit; `git commit -s -m "The recovery page takes the administrator password and the choice over HTTPS only (A1098)"`.

### Task 9: End to end over the real HTTPS listener, both entry modes

**Files:** modify `apps/server/src/first-setup-resolution.boot.test.ts` (new cases; its `startingBox("unlisted")`, `startIn(mode, …)` and `overHttps` helpers, `:343-460`; add a POST helper that sends a form body with the same CA).

- [ ] **Step 1: Failing tests,** `it.each(MODES)`: "the owner's example: the page lists venue/venue.db and asks for the administrator password, in English and Spanish"; "Keep: the kept page, the record on disk, and the next start serves the kept page with no form"; "Move: the answer, one restart, the next start serves setup, venue.db is at state/first-setup-set-aside/<stem>/venue/venue.db with its original bytes, and the note is unchanged"; "a page opened before a file changed cannot act: change venue.db's bytes, POST the old digest, get filesChanged, and every file is unchanged"; "six wrong passwords, Retry, a new start: the seventh try still waits" (Review Focus 3). The startingBox fixture needs a real setup record with a known password: build it with the provisioning store as `first-setup-start-again-note.test.ts`'s fixtures do, or `hashPassword` into a synthetic record validated by `parseFirstSetupState`. Today the POST answers 404.
- [ ] **Step 2:** `pnpm --filter @waitron/server exec vitest run src/first-setup-resolution.boot.test.ts` — FAIL on the new cases.
- [ ] **Step 3:** Fix only what the cases show; no production change is expected beyond Tasks 6–8.
- [ ] **Step 4:** PASS. **Step 5:** commit `git commit -s -m "Keep and Move end to end over the box's HTTPS, in both entry modes (A1098)"`.

### Task 10: Nothing sweeps the moved files; a full disk changes nothing

**Files:** create `apps/server/src/first-setup-set-aside-lifetime.test.ts`; modify `apps/server/src/start-full-disk.e2e.test.ts` (one new case in this file: CI runs it alone with the small disk, `.github/workflows/ci.yml:1094-1104`, and excludes it from the shards, `:995`; a new full-disk file would run in the shards without a disk and fail, `apps/server/src/testing/full-disk.ts:15-16`).

- [ ] **Step 1: Failing tests** — "lifetime" cases, each starting from a box after a Move (Task 5b's real path), each asserting the set-aside folder, the choices folder and the note are byte-identical and the same inodes afterwards: the next first setup claims (`kind: "normal"` at the start, then a claim through the provisioning store); `clearReplacedDatabases` and `freeSpaceAtStart({ force: true, … })`; that setup's own Start again (A1042's actions); a restore placement (`restoreDatabase`). Plus "the next setup's name is later than the note" (A1042's chooser case, `first-setup-start-again-note.test.ts:180-250`, with the box after a Move). In `start-full-disk.e2e.test.ts`: "a Move on a full disk: the record cannot be written, nothing moves, and the page says the disk is full". These pass or fail on what Tasks 4–8 built; a lifetime case that passes at once is still kept, and its failing control is stated in the commit message (delete the set-aside name from `FIRST_SETUP_HOST_FILES` and the restore case must fail).
- [ ] **Step 2:** `pnpm --filter @waitron/server exec vitest run src/first-setup-set-aside-lifetime.test.ts`; on macOS `pnpm --filter @waitron/server exec vitest run src/start-full-disk.e2e.test.ts -t "Move on a full disk"` (the harness makes its own small disk with `hdiutil`; check `memory_pressure | grep free` first).
- [ ] **Step 3:** Fix what fails. **Step 4:** PASS, with the `Tests` count read. **Step 5:** commit `git commit -s -m "Nothing sweeps the moved files, and a Move on a full disk moves nothing (A1098)"`.

### Task 11: A plain reset keeps the choices and the moved files

**Files:** modify `deploy/waitron.sh:741-748`, `scripts/waitron-sh.test.mjs` (new case only), `deploy/README.md:348-366`.

- [ ] **Step 1: Failing test** beside `:1513-1537`: "the reset's state clean-up keeps the Start again choices and the set-aside folder, and removes the guess counter" — run the command extracted from the script over a scratch state folder holding the two folders (one file each), the counter, `tls/` and `first-setup.json`; expect the two folders, `tls` and their files to remain. Today it fails: both folders are removed.
- [ ] **Step 2:** `pnpm exec vitest run scripts/waitron-sh.test.mjs` — the new case FAILS.
- [ ] **Step 3:** Append `! -name first-setup-start-again-choices ! -name first-setup-set-aside` after `! -name first-setup-start-again-confirmations` in the `find`; update the script's comment and `deploy/README.md`'s list.
- [ ] **Step 4:** The whole file PASSES, the existing cases at `:1495-1537` and `:1682` unedited.
- [ ] **Step 5:** commit `git commit -s -m "A plain reset keeps the Start again choices and the files moved aside (A1098)"`.

### Task 12: Guides, conventions, CLAUDE.md and the backlog

**Files:** `apps/server/src/guide/en/backup-recovery.md` and `es/backup-recovery.md` (one paragraph after "If the page says that Start again has not finished…", `en:41-42`, and its twin); `docs/developers/conventions-ui.md` (the recovery page section, `:1082-1180`); `CLAUDE.md` (the recovery page bullet in §3); `docs/operations/first-live-fiscal-setup.md:90-91`; `docs/backlog/setup.md:485-496` and `docs/backlog.md:467-469`.

- [ ] **Step 1: The guide paragraph.** English: "If a Start again was cut off and the box then finds files that Start again did not create, such as a venue copied from a backup, the box does not start. Its page lists the files and asks for the administrator password you chose during setup. **Keep everything and stop** leaves every file as it is, and the page then stays until Waitron is reinstalled. **Move these files aside and finish Start again** moves the files, unchanged, into a new folder on the box and finishes Start again; the box then starts a new first setup. If the files change after the page opens, the box refuses the choice and changes nothing: press **Retry a normal boot** to see them again. After five wrong passwords the page makes you wait before the next try." Spanish: «Si un «Empezar de nuevo» se interrumpió y después el equipo encuentra archivos que «Empezar de nuevo» no creó, como un local copiado desde una copia de seguridad, el equipo no arranca. Su página muestra los archivos y pide la contraseña de administrador que elegiste al configurar. **Conservarlo todo y parar** deja todos los archivos como están, y la página sigue hasta que se reinstale Waitron. **Apartar estos archivos y terminar «Empezar de nuevo»** mueve los archivos, sin cambios, a una carpeta nueva del equipo y termina «Empezar de nuevo»; después el equipo empieza una configuración inicial nueva. Si los archivos cambian después de abrir la página, el equipo rechaza la elección y no cambia nada: pulsa **Reintentar un arranque normal** para verlos de nuevo. Después de cinco contraseñas incorrectas, la página te hace esperar antes del siguiente intento.»
- [ ] **Step 2: conventions-ui.md**, a paragraph "**A Start again cut off with files it did not create** (A1098)": the four outcomes and codes; the form only for `setup.start_again_files_found`, only over TLS; the persisted counter and its policy; the digest binding; the record and where it lives; the set-aside folder; the one removal sentence as the owner's exception (2026-10-25 15:24) with its guard, weaker than its name (it reads the two text tables, not the rendered page); the found paths and the set-aside folder name added to "Strings on the page that come from outside the image".
- [ ] **Step 3: CLAUDE.md**, appended to the recovery page bullet: "Its one form, for `setup.start_again_files_found`, takes the administrator password over HTTPS only; its Move choice is the owner's one exception to never suggesting a removal (A1098). Guard: the never-delete cases in `apps/server/src/recovery-surface.test.ts`, weaker than their name: they read the text tables, not the page."
- [ ] **Step 4: Operations and backlog.** `first-live-fiscal-setup.md`: after "or refuses with a page that says what to do", one sentence naming the Keep and Move choices. Backlog: in `setup.md`'s entry, replace "Follow-up: A1098 covers files the box did not create…" with what A1098 built and what stays a manual loop (a file the box created that cannot be deleted); same in the `backlog.md` index line. New short entries (with `docs/backlog/setup.md` detail) for each point left open: Q2's boxes get only the explanation (if answered A); moved-aside files have no in-app way back (Recover from backup takes only a backup file, a bucket or Waitron Cloud); after Keep the box stays on its page even if the files are later removed by hand.
- [ ] **Step 5: Checks.** `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts`; `pnpm exec vitest run scripts/guide-links.test.ts scripts/claude-md-pointers.test.ts`; `pnpm format:check` (`CLAUDE.md` is format-checked; `docs/` is ignored — `pnpm exec prettier --file-info <file>` tells which). Commit `git commit -s -m "Guides, conventions and backlog for the recovery page's Keep or Move choice (A1098)"`.

### Task 13: Final qualification and PR notes

- [ ] **Step 1: Focused suites,** each with its `Tests` count read:
  - `pnpm --filter @waitron/provisioning exec vitest run src/first-setup-start-again-findings.test.ts src/first-setup-start-again-leftovers.test.ts src/first-setup-start-again-choice.test.ts src/first-setup-start-again-guesses.test.ts src/first-setup-start-again-set-aside.test.ts src/first-setup-start-again-choose.test.ts src/first-setup-start-again-deletion.test.ts src/first-setup-start-again-note.test.ts src/first-setup-state.test.ts`
  - `pnpm --filter @waitron/server exec vitest run src/recovery-surface.test.ts src/recovery-start-again.test.ts src/first-setup-entry.test.ts src/first-setup-resolution.boot.test.ts src/first-setup-set-aside-lifetime.test.ts src/first-setup-start-again-note.test.ts src/first-setup-workspace.test.ts src/recovery-state.test.ts src/guide-content.test.ts`
  - `pnpm exec vitest run scripts/native-form-fields.test.ts scripts/english-only.test.ts scripts/personal-log-params.test.ts scripts/errors-reachable.test.ts scripts/claude-md-pointers.test.ts scripts/guide-links.test.ts scripts/waitron-sh.test.mjs`
  - `pnpm --filter @waitron/provisioning typecheck && pnpm --filter @waitron/server typecheck && pnpm format:check`
- [ ] **Step 2: Fiscal gates, unedited:** `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts` and `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad`; `git diff --stat ef4322c82 -- packages/fiscal-verifactu` prints nothing.
- [ ] **Step 3: Look at it** (`CLAUDE.md` §4: a string-rendered page has no harness). A script outside the worktree (as A1042's `~/waitron-campaign/a1042-l1-shots/render.ts`, run with `pnpm exec tsx`, Playwright resolved from `apps/server`) renders `recoveryApp` for: the choice page with the owner's example (secure, both languages), the same with `wrongPassword`, `throttled` and `filesChanged`, the page over plain HTTP, the kept page, and the `moved` answer. Screenshot each at 375 px and 1280 px wide, with `colorScheme: "light"` and `"dark"`. Open the images and check: the list, the field, both choices and Continue are readable and nothing overflows at 375 px; each message sits where Task 7 puts it. Name the images in the commit message.
- [ ] **Step 4: PR notes** (for `/finish-branch`): the owner-approved exception — the one sentence `moveDetail`, English and Spanish, and the guard that names it; every new string ("Words for the owner's approval") for approval; the answers to Q1–Q4; the changed assertion (Q4); that a plain reset now keeps the choices and the moved files (D9); Q3's note on series names in a moved database; Review path FULL, label `needs-owner-review`.
- [ ] **Step 5:** Tell the driver the branch is ready for `finish-branch`.

## Self-review

- **Owner's requirements → tasks:** password form and check against the setup's named administrator (D6; Tasks 5a, 7, 8); limit on wrong guesses, surviving a restart (D6; Tasks 3, 9); secure connection answered from the code (Current behaviour; D7; Task 8); the two choices doing what they say (Tasks 5b, 9); nothing moved before a recorded choice (D4, D5; Task 5b); a page that showed another list refused, nothing changed (D3; Tasks 5a, 9); the record of who, when, what, which files, surviving the move (D5; Tasks 3, 5b, 10); setup record gone or changed → explanation and reinstall line only (D1; Tasks 2, 6); where the files go, never overwriting, rename not copy, full disk, never swept (D4, D9; Tasks 4, 10, 11); finishing through A1042's finisher with the note untouched (D4; Tasks 4, 5b, 10); locks (Global constraints, D4; Task 4); words in both languages (Words; Tasks 7, 12); guides (Task 12); personal data (Global constraints; Tasks 5b, 8); codes in the registry (Tasks 2, 3, 5a); the never-delete exception narrow and named (D8; Task 7). No alert code: nothing is recorded as an incident.
- **Names used across tasks:** `StartAgainFinding`, `collectStartAgainFindings`, `StartAgainSurvey`, `StartAgainUnit`, `surveyStartAgainLeftovers`, `classifyStartAgainRefusal`, `StartAgainChoiceRecord`, `writeStartAgainChoice`, `readStartAgainChoices`, `assertStartAgainNotKept`, `beginStartAgainGuess`, `setAsideDestinations`, `assertSetAsideSameFilesystem`, `moveStartAgainUnits`, `resumeStartAgainSetAside`, `chooseStartAgainLeftovers`, `renderStartAgainSection`, `mountStartAgainChoice`, `START_AGAIN_PAGE_TEXT`, `RecoveryDeps.startAgain` — each defined once, in the task named.
- **Claims:** two runs are named in "Current behaviour"; everything else there is marked read.
