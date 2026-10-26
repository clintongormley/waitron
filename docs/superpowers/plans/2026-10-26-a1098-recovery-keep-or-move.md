# A1098: after a cut-off Start again finds files it did not create, the recovery page offers Keep or Move aside — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as `subagent_type: "implementer"`; one that passes about 150 tool calls with its task unfinished stops at a passing or cleanly red point, commits, and returns a handover (done, left, files, each check's state).

**Revision 2 (plan review 1 folded, 2026-10-26).** What changed:

- **Q4 withdrawn.** The boot test's "unlisted" box has an unparseable setup record, so it stays `setup.start_again_incomplete`; no existing assertion changes. One shared test fixture with a real, parseable setup record and a known password (`startAgainAttempt`, `packages/provisioning/test/start-again-attempt.ts`) is built first and used by Tasks 1–6 and 9–10 (finding 1).
- **D4 resumes file by file** into the destination the choice record names, so a cut after a database's `-wal` moved leaves the rest of that database to follow it; Task 4b tests that cut (finding 2).
- **D6's wrong-guess limit forgives and has a ceiling:** 5 free tries, then waits of 1, 2, 4, 8, then at most 15 minutes, and one wrong guess forgiven for every 15 minutes without one. New owner question Q5; the build uses this unless the owner answers otherwise (finding 3).
- **Q3 rewritten:** a Move raises the note's time floor to the newest moved file's time plus 2½ minutes, rounded up to the minute (A1099's margin), when the box has a note. New Q6 asks whether the Move choice says that a moved venue's records not yet sent to AEAT stay unsent (finding 4).
- **Recover from a backup after a Move** is now a lifetime case. Backup recovery does not need any folder that a Move leaves non-empty to be empty, but its check of the box's files reads the set-aside folder: it reads every moved byte twice per check, copies moved non-database files into the recovery's evidence, and stops on a moved file the box cannot read. New D10 leaves the set-aside folder out of that walk. This is finding 5, plus a gap the review did not name. The probe in "Current behaviour" shows the walk reads the folder and stops on an unreadable file; the copying is read from the code.
- Minors: the full-disk mechanism is corrected, and its message gains a next step (6). The never-delete patterns are widened, with the review's two misses as cases (7). A pre-record rename probe gives "another mount point" (`EXDEV`) its own refusal and words (8). A forgotten-password sentence joins the words for approval, and `wrongPassword` says what to do (9). Q1 and Q2 now say exactly which tasks they block (10). Task 4 and Task 8 are split (Task 10 too) (11). A1042's two behaviours go to the backlog (12). Three PR-notes consequences are added (13). The `administrator` citation is fixed (14).

**Goal:** when the box starts and finds that an earlier Start again was cut off and files it did not create have appeared since, its recovery page lists those files and, behind the administrator password the interrupted setup names, offers "Keep everything and stop" or "Move these files aside and finish Start again". Nothing the box did not create is ever deleted.

**Architecture:** the start already refuses such a box with `setup.start_again_incomplete` (A1042). This plan makes the refusal's checks collect every finding instead of stopping at the first, groups the findings into movable units, and gives the start two new refusal codes: `setup.start_again_files_found` (the page offers the choice) and `setup.start_again_kept` (Keep was chosen; the page stays). The recovery page gains its first form, served only over the box's HTTPS. A choice is bound to the exact list the page showed by a digest; it is recorded (who, when, what, which files) before anything moves; Move renames the units, unchanged, into a new folder on the same filesystem, raises the note's time floor, then runs A1042's own finisher, which deletes only the interrupted attempt's marked files.

**Tech stack:** TypeScript, Hono (string-rendered page), Node `fs/promises` (`rename`, `lstat` with `bigint`), `@waitron/identity`'s `verifyPassword`, Vitest (real temporary folders; the real HTTPS listener in the boot suite; the small real filesystem of `apps/server/src/testing/full-disk.ts`), Playwright Chromium for the look.

**Spec:** the owner's answer "A1042 line 2: A" (2026-10-25 15:24, `~/waitron-campaign/questions.md`, heading "OWNER ANSWER — A1042 line 2: A") and the question it answers (same file, heading "A1042 build — line 2: …", with the worked example and the English and Spanish words); queue entry A1098 (`~/waitron-campaign/queue.md`). Read both with this plan. A1042's plan, `docs/superpowers/plans/2026-10-24-a1042-start-again-series-note.md` (D3, D5), is the code this builds on. A1099's approved design (same file, "A1042 — a damaged record of series names…" and "OWNER ANSWER — A1042 damaged: A") is where Q3's margin comes from.

**Review path:** FULL (it finishes an interrupted Start again, whose note guards invoice series names, and it changes what a backup recovery reads). The PR ends `needs-owner-review`: the owner approves the words and lands it.

---

## OPEN QUESTIONS (for the owner)

Each is a point where the code or a house rule does not fit the approved shape as it stands. Q1 blocks the tasks named. Q2, Q3, Q5 and Q6 block nothing: the build uses the recommended answer unless the owner answers otherwise, and the PR lists them for approval. Q4 was withdrawn in revision 2.

**While Q1 is open, Tasks 0–6 and 11 can be built** (Q2 is built with its option A; lane A, 2026-10-26 18:25). Task 12 (guides and backlog) describes the finished behaviour, so it waits for both answers. Task 13 waits for everything.

### Q1. The password box is a raw HTML field, which a house rule and its guard forbid (blocks Task 7, and through it Tasks 8a–10b and 13)

`CLAUDE.md` §3: "A screen does not draw its own form field: a `<select>`, a `<textarea>` or a text `<input>` comes from a field primitive". The guard `scripts/native-form-fields.test.ts` holds an `ALLOWED` list whose comment says "the list shrinks; it does not grow" (`:43`). The recovery page is a string the server builds (`renderPage`, `apps/server/src/recovery-surface.ts:555-611`); it loads no script and no front-end bundle, because it is what the box serves when it cannot start. A `wt-input` cannot run there. Radio buttons and a hidden field are not counted by the guard (`NOT_TEXT`, `:19-30`); the password `<input type="password">` is (review 1 ran the guard's own function on all three).

*Worked example.* Elena opens `https://waitron.local` after the cut. The page shows the list, one password box, two radio choices and Continue. The password box is `<input type="password" name="password" autocomplete="current-password" required>` in `apps/server/src/recovery-start-again.ts`; the guard fails on that line.

- **A (recommended):** add one `ALLOWED` entry, `{ file: "apps/server/src/recovery-start-again.ts", lines: 1, reason: "an HTML string the server builds for the page a box serves when it cannot start, with no script or front-end bundle; the server does not depend on @waitron/ui or @waitron/ui-core" }`, following the print agent's entry (`:55-60`). The form follows design-system.md → Forms where no script is needed: both fields marked required with a visible `*` and the native `required` attribute (the browser blocks an empty submit), errors only after the first press, the field's error under the field and one bottom message above Continue. What it cannot do without a script: keep Continue disabled until the fields are filled.
- **B:** no password box on this page; send the person to the setup app for the choice. The setup app is not served while the start is refused, so this needs a second listener mode — a much larger change.

### Q2. Found items the move cannot handle safely (blocks nothing since 2026-10-26 18:25: lane A builds A, the most cautious option — today's page for these boxes — and the owner may still choose B)

The finisher stops for some findings that are not plain files: a symbolic link or a device file where the attempt's files live, a folder inside `first-setup-resolutions/` that is not a record folder (for example a backup recovery's journal, whose target holds a `venue.lock` — `CLAUDE.md` §3 "Never unlink venue.lock"), or a folder holding a lock file. Moving a folder that holds a lock file moves the lock away from the path other programs open, which is the hazard the never-unlink rule exists for (`packages/store/src/venue-lock.ts:7-10`). Separately, a found folder could hold very many files (a backup stream's folder), and the page binds its choice to a list of every one.

*Worked example.* After the cut, someone copies an older Waitron's `first-setup-resolutions/backup-recovery/` (with `…/target/venue/venue.lock` inside) into the state folder. The finisher refuses "layout unexpected: …/first-setup-resolutions/backup-recovery".

- **A (recommended):** these boxes get today's page for `setup.start_again_incomplete` — the explanation and what reinstalling would lose, no choice — the same as the owner's "setup record gone or changed" branch. Also for more than 20,000 found entries. A backlog entry records it.
- **B:** offer Keep only for them. This adds a third kind of survey, which Tasks 2, 5b, 7 and 8a would each carry.

### Q3. Series names inside a moved-aside database (blocks nothing; the build uses A)

After Move, the box starts a new first setup. Its name chooser reads the note's time floor and refuses any name at or before it (`startAgainFloorSources`, `packages/provisioning/src/first-setup-start-again-note.ts:73-82`; read through `readStartAgainFloors`, `packages/provisioning/src/box-folders.ts:25-29`). The note already covers every name the interrupted attempt used: it is raised before the deletion marker is written (`apps/server/src/first-setup-resolution.ts:461` before `:497`, read). It knows nothing of a database that was moved aside. If that database is a venue that traded, and its names were chosen by a clock running ahead, a later setup or re-registration on this box could choose one of its names.

*Worked example.* The found `venue.db` came from a box whose clock ran 2 hours fast: it chose series name `A-0CNQT` for 16:40 UTC when the real time was 14:40, and its files were last written at 16:52 on that clock. Elena chooses Move at 15:10 UTC (real). Without a floor, the new setup at 15:12 chooses a name for 15:12, and a re-registration on this box at 16:40 would choose `A-0CNQT` again. With A, the note's floor becomes 16:52 + 2½ minutes = 16:54:30, rounded up to 16:55. The Move option says beforehand: "These files carry a time later than the box's clock, so a new setup can start invoice series names only from 2026-10-26 16:55 UTC." The new setup waits until then, as A1099's approved design does when its time is still to come.

- **A (recommended, the build's default):** a Move raises the note's `floorMs` to the newest modification time among the moved files, plus 150 seconds, rounded up to the next whole minute. That is the margin the owner approved for A1099 on 2026-10-25 at 15:24. It goes through the existing `raiseStartAgainNote` (`first-setup-start-again-note.ts:57-71`), keeping the note's `lastName` and `module`. That function only ever replaces the note with a strictly later floor, and the readers in production read `floorMs` alone. `lastName` is read only by tests (`apps/server/test/start-again-deleted.ts:40-48`), found by a grep of non-test `.ts` files for `readStartAgainNote` and `lastName`. So keeping it is valid by the note's own check (`parseNote`, `:23-49`) and changes nothing anyone reads. The floor is computed from the survey's `mtimeNs` values, which the digest already binds, and is stored in the choice record so a resumed Move raises the same value. When the floor is later than the box's clock, the Move option shows it (`moveFloor`). **Limits:**
  - When the box has **no** note (no attempt on it ever chose a name), `raiseStartAgainNote` needs a `lastName` that does not exist. Nothing is raised until A1099 adds its "name unknown" note; that is a backlog entry and a PR note.
  - A found file dated years ahead holds new series names off until that date. The page shows the date before the choice, and Keep is the other choice.
- **B:** no floor. The PR notes say so (revision 1's recommendation). This is the same exposure a reinstall has.
- **C:** before moving, ask the fiscal module, through a new module seat, for the latest name in a found database, and raise the note to it. Exact rather than time-based, but a larger change that touches the fiscal module and opens a database the box did not create.

### Q4. (Withdrawn in revision 2.)

Revision 1 asked to change one assertion in `apps/server/src/first-setup-resolution.boot.test.ts`. That box's setup record is `{"synthetic":"attempt"}` (`:365`), which `parseFirstSetupState` refuses (run, "Current behaviour"). Under D2 such a box gets the explanation, so it stays `setup.start_again_incomplete` and the assertion at `:627` holds unchanged.

### Q5. How the page limits wrong passwords (blocks nothing; the build uses A)

The page's Retry restarts the process, and anyone on the network can press it, so the count of wrong passwords is kept on disk. The house's PIN limit, in memory, allows 3 free tries, makes later tries wait at most 60 seconds, and starts over after 15 idle minutes (`packages/identity/src/pin-throttle.ts:13-18,58-60`). A password is longer to type than a PIN, and this count survives restarts, so the numbers differ. One rule has to hold: whoever guesses, the owner is never locked out for good.

*Worked example.* Someone on the café's Wi-Fi finds the page and tries one password an hour, all night.

- Under revision 1's rule (5 free, then waits doubling up to 60 minutes, and the count never going down), every guess from the sixth on makes everyone wait up to an hour. When Elena arrives at 09:00 the page says "Try again in 60 minutes". She gets a try only in the moment a wait ends, and the stranger's next guess starts the wait again.
- Under A, every 15 minutes without a wrong guess forgives one, so a guess an hour never takes the count past 1. Elena types her password at 09:00 and gets in at once.
- A script trying as fast as A allows gets 5 tries, then waits of 1, 2, 4 and 8 minutes, then 15 minutes for each later try: about 4 tries an hour, about 100 a day. Once it stops, Elena waits at most 15 minutes. While it keeps going, she competes with it for the one try each wait allows; no count kept on the box can tell her tries from the script's.

- **A (recommended, the build's default):**
  - 5 free tries; from the 6th wrong guess on, the next try waits 1, 2, 4, 8, then 15 minutes, and never more than 15.
  - One wrong guess is forgiven for each full 15 minutes since the last one.
  - A clock set back never lengthens a wait past 15 minutes from now.
  - Why these numbers: 15 minutes is the longest the owner ever waits after the last wrong guess, whoever made it. Forgiving one guess at a time, rather than starting over after an idle spell as the PIN limit does, stops a guesser from earning five fresh free tries just by pausing.
- **B:** the PIN limit's numbers, kept on disk (3 free, at most 60 seconds, start over after 15 idle minutes). The owner barely waits, but a script gets about 60 tries an hour.
- **C:** revision 1's rule. Strongest against guessing, but anyone on the network can keep the owner out (the example above).

### Q6. Should the Move choice say what happens to records not yet sent to AEAT? (blocks nothing; the build uses A; the words are approved with the PR)

If the found database is a venue that traded, it may hold invoice records it had not yet sent to AEAT. After Move nothing reads the set-aside folder (D9), so they stay unsent. The owner-approved Move text does not say so.

*Worked example.* The found `venue.db` is yesterday's venue restored from a backup; its last 12 invoice records were still waiting to be sent when the backup was taken. Elena chooses Move. The new setup starts empty, and those 12 records are never sent from this box.

- **A (recommended):** one more sentence under the Move choice, as its own key `moveUnsent` (not part of the approved exception, and it contains no removal word): "If these files are a venue that has made sales, invoice records it had not yet sent to AEAT stay unsent: the box sends nothing from moved files." / «Si estos archivos son un local que ha vendido, los registros de facturas que aún no había enviado a la AEAT se quedan sin enviar: el equipo no envía nada desde archivos apartados.» The PR notes say it as well.
- **B:** no sentence on the page; the PR notes only.

---

## Words used in this plan

- **Marker:** A1042's deletion marker `first-setup-deleting.json` in the venue folder, naming every file of the interrupted attempt with its size and SHA-256 (`packages/provisioning/src/first-setup-start-again-deletion.ts:71-79`).
- **Finisher:** `finishStartAgainDeletion` (`:488-523`), run by every start; it deletes the marked files, or refuses `setup.start_again_incomplete` and deletes nothing.
- **Finding:** one thing the finisher refuses for: a refused artifact present (`:497-500`), a file the marker does not name (`:505`), a marked file whose size or hash differs (`:506-507`), an unexpected `-wal` (`:509-515`).
- **Blocker:** a refusal that is not a finding: the marker damaged or unreadable, folders that differ, an unexpected layout (a link, a special file, an unexpected folder name), a failed check (`EACCES` and the like).
- **Unit:** what Move moves as one piece of the list (D2). **Piece:** one top-level path of a unit, renamed on its own (a database unit has several: its side files, then its main file).
- **Survey:** the list of units and their digest, built from the findings (D2).
- **Setup record:** the state folder's `first-setup.json`. It holds the administrator's id (`frozen.administratorId`, `packages/provisioning/src/first-setup-state.ts:48`), the setup request (`frozen.request: VenueRequest`, `:51`), whose `admin` holds the name, email and password hash (`packages/provisioning/src/venue-plan.ts:42-46`), and `ownerVerifier`, which must equal that hash (`first-setup-state.ts:365`).
- **Set-aside folder:** where Move puts the units (D4).
- **Choice record:** the file that records a choice (D5).
- **Guess counter:** the file that counts wrong passwords (D6).
- **Shared fixture:** `startAgainAttempt` (Task 1 Step 1): a real claimed setup with a known password and A1042's marker over it.

## Global constraints

- Fiscal gates pass **unedited**: `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts` and `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad`. No change to `registerSif`, fiscal writers, hashes, numbering, SQL, migrations, `registros_facturacion`, or the note's floor rules. A Move is a new **caller** of `raiseStartAgainNote` (Q3 A); the function and its rule (only ever a strictly later floor) are unchanged.
- No migration. No backwards-compatibility code (`CLAUDE.md` §3; before go-live).
- **Nothing the box did not create is ever deleted, moved before a recorded choice, or changed.** The only deletion is A1042's finisher over the marker's own files. The only things removed by this plan's own code are empty folders this plan's code made (the rename probe and its folders, D4), by `rmdir`.
- **Never unlink, rename or move** `venue.lock`, `venue.lock-journal`, `venue.holder.json`, `migrations.lock` or `recovery.lock`, nor a folder that holds one. `recovery.json` is not written by anything here.
- Each new provisioning file has `import "./errors.js";`. New codes are registered in `packages/provisioning/src/errors.ts` with no params.
- The recovery page's title and action stay fixed strings chosen by the error code. Every string from outside the image (the found paths, the set-aside folder name) is HTML-escaped.
- No log line carries the administrator's name or email. `displayName` and `email` are on `PERSONAL_LOG_KEYS` (`apps/server/src/log-personal-data.ts:33-34`), but nothing here logs them at all.
- English only in code, tests and comments. Spanish only in the page's text tables (the precedent is `OPERATOR_TEXT`'s `es-ES` rows, `apps/server/src/recovery-surface.ts:260-488`) and the Spanish guide.
- Coverage holds `98/98/98/95` in `@waitron/provisioning` and `@waitron/server` (CI measures it). The shared fixture lives in `packages/provisioning/test/`, outside the package's `coverage.include` (`src/**/*.ts`, `packages/provisioning/vitest.config.ts`), as `allocated-venue.ts` does.
- **Any change to an existing assertion is a STOP** ("Existing assertions this plan changes" lists none): the implementer reports it and does not make it.
- A Vitest run with no `Tests` count is no evidence (`CLAUDE.md` §4). Under an agent, unset `AI_AGENT` and `CLAUDECODE` to see a passing test's output. Run every command from the worktree root.
- Implementers stage explicit paths, commit with `git commit -s`, and do not push.

## Current behaviour (read at ef4322c82, runs named)

Run on 2026-10-26 at ef4322c82:

- `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/server exec vitest run src/first-setup-resolution.boot.test.ts -t "unfinishable deletion|unlisted file"`: 3 passed, 21 skipped. Its output carries `{"port":…,"tls":true,…,"event":"recovery.listening"}` and `{"errorCode":"setup.start_again_incomplete","reason":"size or hash differs: state/first-setup.json",…,"event":"recovery.serving_refused_start"}`. So the refused page is served over HTTPS by the real `serveRecovery` in that suite, and the suite's "unfinishable" box is the setup-record-changed branch.

Run on 2026-10-26 at 6d11e0b64 (revision 2), each by a throwaway file deleted afterwards:

- **A throwaway test in `packages/provisioning/src/`** (deleted; `git status` clean afterwards), `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/provisioning exec vitest run src/zz-a1098-probe.test.ts`, 1 passed. It built boxes the way the shared fixture will: a claim through `createFirstSetupStore(...).claim(...)` with the note test's `frozenAttempt` shape and `hashPassword(<known>)`, then `writeStartAgainMarker(roots, await startAgainMarkerFor(roots, …))`. It printed:
  - `synthetic: rejected setup.attempt_invalid` — `parseState({ synthetic: "attempt" }, …)`, the boot test's and `first-setup-entry.test.ts`'s `markedDeletion` record (`:401`). **Control:** `real record: resolved` — the claimed `first-setup.json` parses; `verify right: true wrong: false`.
  - `files after claim+marker: venue=first-setup-claim.json,first-setup-deleting.json state=first-setup.json`.
  - `unlisted venue.db: rejected setup.start_again_incomplete unlisted file: venue/venue.db`; `plain finish: resolved venue now=venue.lock`.
  - `12a empty folder: resolved exists after=false`: an empty `first-fiscal-documents/` made after the marker is removed by the finisher.
  - `12b journal: resolved venue now=venue.db-journal,venue.lock`: a `venue.db-journal` written beside a marked, unchanged `venue.db` is not a finding; the finisher deletes `venue.db` and leaves the journal.
  - The backup recovery's `createFirstSetupBackupWorkspace(roots).inspect(id)`: `control holder change same digest: true` (a changed `venue.holder.json` is left out); `set-aside added changes digest: true`; `set-aside bytes change digest: true`; `unreadable set-aside file: rejected EACCES` (a file under `<state>/first-setup-set-aside/` with mode `000`).
- **The never-delete patterns** (`node` on a script in a `mktemp -d` folder, removed afterwards). The current patterns (`apps/server/src/recovery-surface.test.ts:182,391`) miss "The files were deleted." and «Quítalo.» (`old: false`). The widened ones (D8) catch both (`new: true`), and still catch the controls "Delete these files." and «Borra estos archivos.» (`true`). Of every string in "Words for the owner's approval", only `moveDetail` matches the widened patterns (`moveDetail en: true es: true`, 27 keys checked).
- **Revision 1's run, kept:** the owner's Move sentence matched neither of the current patterns (`false`, `false`), so today's guard would not notice the exception.
- **Linux `rename(2)`, `EXDEV`** (`curl` of man7.org's page): "oldpath and newpath are not on the same mounted filesystem. (Linux permits a filesystem to be mounted at multiple points, but rename() does not work across different mount points, even if the same filesystem is mounted on both.)" So equal `lstat(…).dev` does not prove a rename works (D4).
- **`git blame`** on `packages/provisioning/src/first-setup-start-again-deletion.ts:34-35,290-291,477` (the side-file list without `-journal`, an empty documents folder listed for removal, folders removed by `rmdir`): every line is from e2a957138 (A1042, #2101). So the two behaviours in the `12a`/`12b` lines above predate this branch.

Everything below was read, not run.

**The start's refusal.** `resolveFirstSetupEntry` (`apps/server/src/first-setup-entry.ts:56-86`) calls `refusedAtStart` (`:91-112`) first: canonicalise the folders, `emptyDiscardedRecovery`, `assertNoLegacyFirstSetupWorkspace`, then `finishStartAgainDeletion`; an `AppError` whose code is in `START_REFUSALS` (`:88`) becomes `{ kind: "refused", code, roots, error }`. The supervised entry serves `recoveryApp` with `refusedAtStart: true` and a Retry that exits (`apps/server/src/node-entry.ts:394-421`); the direct entry does the same with `requestRestart` (`apps/server/src/first-setup-launch.ts:112-128`). Raw `bootServer` refuses while a marker exists (`apps/server/src/boot.ts:886`) and never finishes one. The image runs the supervised entry (`deploy/Dockerfile:289`, `ENTRYPOINT ["node", "/app/node-entry.js"]`), whose start's clean-up `freeSpaceAtStart` runs before `resolveFirstSetupEntry` (`node-entry.ts:313-327`, then `:328`).

**The finisher stops at the first finding.** It reads the marker, takes `lockVenueDatabase`, checks refused artifacts (`REFUSED`, `first-setup-start-again-deletion.ts:36-57`, checked at `:497-500`), then every listed item on disk (`itemsOnDisk`, `:264-318`) for an unlisted file or a changed size or hash, then each `-wal`, and throws at the first one (`:488-523`). A link, a special file or an unexpected folder name throws "layout unexpected" from `entries`/`itemsOnDisk` (`:205-212,270,278,301-306`). Side files deleted beside the databases are `-wal` and `-shm` only (`SIDE_FILES`, `:35`).

**The recovery page.** Fixed title and action per code (`OPERATOR_TEXT`, `recovery-surface.ts:260-488`; `setup.start_again_incomplete` at `:472-485`, A1042's stop-gap words), one form (Retry, `:600-602`), no password and no other form. Its Retry exits the process (`node-entry.ts:414-416`). Its wording never suggests wiping or resetting (`:256-258`), pinned by "never suggests wiping anything, in either language" (`recovery-surface.test.ts:386-394`), which reads `OPERATOR_TEXT` and `GENERIC_TEXT` actions only. The A1042 cases "neither refused start sends the person to someone else" and "the unfinished Start again line never tells the person to reinstall" are at `:1183-1199`. House style for the reinstall line is conditional, never an order: "If you reinstall Waitron, the box starts fresh, but everything on it is lost." (`recovery-surface.ts:477`).

**The secure connection.** `serveRecovery` (`apps/server/src/recovery-listener.ts:131-207`) mounts the supplied app only when `inspectBoxTls` finds the box's TLS healthy (`:143-150,176`), and then serves it over HTTPS with the box's own minted leaf (`recoveryTlsFiles` → `mintedBoxLeaf`, `:152`, `apps/server/src/box-secrets.ts:65-69`). Otherwise it serves only the connection-bootstrap routes (`:154`), never the recovery app. The plain-HTTP landing listener serves certificate help only (`landingConfigFrom`, `tls: undefined`, `:239`; `docs/developers/conventions-ui.md:268-269`). In the image the port is 443 (`deploy/Dockerfile:277`). The house check for an HTTPS request is `socket instanceof TLSSocket && socket.encrypted` on `c.env.incoming.socket` (`apps/server/src/setup-first-fiscal-api.ts:765`, `setup-first-backup-api.ts:73-84`, which also checks `Origin` and `Sec-Fetch-Site`). So the page is already reached over HTTPS on a box; what is missing is a check on the request itself.

**Today's password limits are in memory.** `createPasswordThrottle` (`packages/provisioning/src/password-throttle.ts:57-177`) keeps its counts in a `Map`; the repair page's owner uses it keyed `"first-setup"` (`packages/provisioning/src/first-setup-owner.ts:149,194`). The PIN limit is in memory too (`packages/identity/src/pin-throttle.ts:1-9`). The recovery page's Retry, which anyone on the network can press, restarts the process, so an in-memory count would be cleared by one press.

**The password.** `ownerVerifier` equals `frozen.request.admin.passwordHash` (`first-setup-state.ts:365`). `parseState` is exported as `parseFirstSetupState` (`packages/provisioning/src/index.ts:39`); it requires the record's `venueDir` and `stateDir` to equal the folders it is given (`first-setup-state.ts:401-409`). `verifyPassword(password, stored): Promise<boolean>` (`packages/identity/src/verify-password.ts:17`). The house derives a password before taking the venue lock (`setup-first-fiscal-api.ts:834`).

**Writes and locks.** `writeDurableHostJson` writes a temporary file, syncs, renames and syncs the folder, making the folder `0700` (`packages/provisioning/src/durable-host-json.ts:66-106`); any failure, a full disk included, becomes `setup.attempt_invalid` (`:102-103`). `lockVenueDatabase` is shared within one process ("another caller in THIS process shares the hold", `packages/store/src/venue-lock.ts:71`); taking it opens `begin immediate` on `venue.lock` (`:59-60`) and starts the holder file (`:88`). A1042's confirmation records are write-once by an `lstat` check (`packages/provisioning/src/first-setup-start-again-confirmation.ts:131-149`).

**Folders.** On a box the venue folder is `<state>/venue` (`apps/server/src/config.ts:529`) and only the `state` volume is mounted (`deploy/compose.yml:42-45`), so both are on one filesystem and one mount. `WAITRON_VENUE_DIR` can move the venue folder elsewhere, including onto another mount of the same disk.

**Sweeps that touch these folders.** `clearReplacedDatabases` removes only folders in the venue folder named `.venue.db-replaced-*` (`apps/server/src/restore.ts:95,635-660`); a restore removes `<venue>/.venue.db-litestream` (`:530`); `freeSpaceAtStart` removes backup staging, staged recovery copies, rotated logs and crash reports (its contract, `apps/server/src/start-space.ts:53-60`); A1042's deletion walks only names on its list (`listed`, `first-setup-start-again-deletion.ts:100-118`); a plain `waitron.sh reset` empties the state folder except `tls`, the note and the confirmations (`deploy/waitron.sh:741-748`), pinned by `scripts/waitron-sh.test.mjs:1495-1537`. `FIRST_SETUP_HOST_FILES` (`first-setup-state.ts:137-153`) is what restores and recovery bundles refuse to carry (`apps/server/src/restore.ts:238`, `apps/server/src/state-secrets.ts:87`).

**Backup recovery from the new first setup.** Its target folders are `<state>/first-setup-resolutions/backup-recovery/<id>/target/{venue,state}` (`packages/provisioning/src/first-setup-backup-workspace.ts:131-136`; made by `apps/server/src/first-setup-backup-recovery.ts:602-610`). Only those must be empty (`emptyTarget`, `apps/server/src/first-setup-backup-recovery.ts:514-541`; `first-setup-backup-workspace.ts:622-629`). A Move never touches them: a `backup-recovery` folder is a blocker (Q2), so it is never moved. So no folder recovery needs empty is left non-empty by a Move. But each check of the box's files, `originals`, walks **both whole roots** (`first-setup-backup-workspace.ts:293-374`). It skips only the recovery's own folder, its pointers, abandoned journals and the lock journal and holder files (`:309-322`). It reads and hashes every file, twice per check (`stableOriginals`, `:400-403`), and every non-abandoned read of the chain checks again (`:541`). When a record is appended, it copies every file except `venue.db`, its `-wal` and `-shm`, `venue.lock` and the stream folder into the recovery's `evidence/` (`archived`, `:406-411`; `archiveControls`, `:431`, called at `:661`). A set-aside folder in the state root is therefore read again and again, its non-database files are copied, and one unreadable moved file stops the recovery (the probe above). D10 fixes this.

**The note.** `raiseStartAgainNote(stateDir, { floorMs, lastName, module })` replaces the note only with a strictly later `floorMs` (`first-setup-start-again-note.ts:57-71`). The readers in production (`readStartAgainFloors`, `box-folders.ts:25-29`, called by `first-setup-runtime.ts:231`, `recovery-preparation.ts:211` and `node-operation-preparation.ts:101`) read `floorMs` only, through `startAgainFloorSources` (`:73-82`).

**Guides.** `apps/server/src/guide/{en,es}/backup-recovery.md`, section `{#interrupted-setup}`, describes Start again and "If the page says that Start again has not finished…" (`en:41-42`). The recovery page itself serves no guide (`conventions-ui.md:268-269`).

## Decisions

### D1. Four outcomes at the start, each its own code

`refusedAtStart` keeps its order and gains three steps:

1. canonicalise, `emptyDiscardedRecovery`, `assertNoLegacyFirstSetupWorkspace` (unchanged);
2. **`assertStartAgainNotKept(roots)`** — with a marker present and a Keep record for that marker (D5), refuse `setup.start_again_kept`. Before the finisher, so a kept box stays on its page even if the found files are later removed ("This page stays until Waitron is reinstalled");
3. **`resumeStartAgainSetAside(roots)`** — finish a Move a cut interrupted (D4). If a rename fails, it refuses `setup.start_again_incomplete` with reason `set-aside failed: <errno> <root>/<path>`. That refusal is not classified (step 5 reads only the finisher's), so the page shows the explanation, and every later start tries again;
4. `finishStartAgainDeletion` (unchanged);
5. on the finisher's `setup.start_again_incomplete` only, **`classifyStartAgainRefusal(roots, error)`**: a survey of kind `choice` gives `setup.start_again_files_found` (same log-only `reason`) and the survey; anything else gives the finisher's own error back, unchanged.

| Box | Code | Page |
| --- | --- | --- |
| Found units, setup record intact and parseable | `setup.start_again_files_found` (new) | explanation, file list, password, two choices |
| Keep chosen for this marker | `setup.start_again_kept` (new) | what was chosen, what reinstalling would lose; no form |
| Setup record gone, changed or unparseable; a blocker; Q2's cases; a resume whose rename failed | `setup.start_again_incomplete` (unchanged) | A1042's explanation and reinstall line (`recovery-surface.ts:472-485`), unchanged |

Both new codes join `START_REFUSALS`. Raw `bootServer` is unchanged (it refuses while any marker exists, `boot.ts:886`).

### D2. Findings, units, the survey and its digest

The finisher's checks become one collecting pass, `collectStartAgainFindings(roots)`, which returns `{ marker, findings, blocker }` in the finisher's present order. `finishStartAgainDeletion` throws the first finding's reason with today's exact text (`refused artifact present: …`, `unlisted file: …`, `size or hash differs: …`, `unexpected -wal: …`), or the blocker, so no existing reason changes.

Units, from findings:

- **A database:** a finding on `venue.db`, `venue.db-wal` (`venue/venue.db` listed and unchanged but its `-wal` unexpected counts), or `node.db` and its `-wal`, makes one unit of the main file and every present `-wal`, `-shm`, `-journal` beside it. A database never moves without its side files: committed rows can live in the `-wal` alone (A1042 plan, "Current behaviour"). Its pieces, in move order: `-wal`, `-shm`, `-journal` (each if present), then the main file.
- **A refused artifact** (file or folder, `REFUSED`) is one unit and one piece.
- **An unlisted file** is one unit and one piece, except: inside `first-setup-resolutions/<uuid>/` (or one of its `step-NNNNNN/` folders) when the marker names no file in that folder, the folder is the unit, so no folder the box did not create, holding a file, is emptied and removed by the finisher's `rmdir`. (An **empty** folder the box did not create produces no finding and is removed by A1042's finisher today — "Current behaviour", `12a`; a backlog entry, Task 12.)
- **A changed marked file** is one unit and one piece. A changed `state/first-setup.json` is not a unit: the survey is `explain` (setup record changed).

Survey:

```ts
export interface StartAgainEntry {
  readonly path: string; // relative to the unit's root folder ("venue" or "state"), "/"-separated
  readonly type: "file" | "folder";
  readonly ino: string; // decimal, from lstat(…, { bigint: true })
  readonly size: string | null; // files only
  readonly mtimeNs: string | null; // files only: a folder is bound by its inode and the entries under it
}
export interface StartAgainUnit {
  readonly root: "venue" | "state";
  readonly path: string; // the unit's top path, as listed on the page
  readonly why: "not-created" | "changed";
  readonly pieces: readonly string[]; // top-level paths renamed one by one, in move order
  readonly entries: readonly StartAgainEntry[]; // every piece and everything under it, sorted by path
}
export type StartAgainSurvey =
  | {
      readonly kind: "choice";
      readonly attemptId: string;
      readonly frozenDigest: string;
      readonly markerSha256: string;
      readonly units: readonly StartAgainUnit[]; // sorted by (root, path)
      readonly digest: string; // sha256 hex of JSON.stringify([attemptId, frozenDigest, markerSha256, units])
      readonly noteFloorMs: number | null; // Q3 A, computed from units; null when no file entry exists
    }
  | { readonly kind: "explain"; readonly reason: string };
export const START_AGAIN_ENTRY_LIMIT = 20_000;
export const START_AGAIN_FLOOR_MARGIN_MS = 150_000; // A1099's 2½ minutes
export function startAgainSetAsideFloorMs(units: readonly StartAgainUnit[]): number | null; // ceil to the minute of (max mtimeNs / 1e6 + margin)
```

`surveyStartAgainLeftovers(roots): Promise<StartAgainSurvey | null>` (`null`: no marker). It is `explain` when:

- the marker does not name `state/first-setup.json`, or that file is absent, or changed (the owner's "setup record gone or changed");
- `parseFirstSetupState` refuses the record (the boot test's synthetic record is one such: "Current behaviour");
- there is a blocker;
- a unit holds an entry named `venue.lock`, `venue.lock-journal`, `venue.holder.json`, `migrations.lock` or `recovery.lock`, or a link or a special file;
- or the entries exceed `START_AGAIN_ENTRY_LIMIT` (Q2 A).

No file is hashed except the marked files the finisher already hashes. Metadata is enough to tell "the files differ from the listed ones": a rewrite changes `mtimeNs` or `size`, and a swap changes `ino`. Its limit is a PR note (Task 13): a change that keeps the inode, size and time is not seen.

### D3. The page binds the choice to the list it showed

The survey is taken once at the start and held by the page; every `GET /` draws that list. The form carries the survey's `digest` in a hidden field `listed`. The choice is accepted only if a new survey, taken **under the venue lock**, has the same digest and is still `choice`. Otherwise it is refused `setup.start_again_files_changed` with nothing changed, and the page says to press Retry, whose restart takes a fresh survey. A digest mismatch is checked before the password, so it costs no guess.

### D4. Move: where, how, and finishing after a cut

**Where.** One new folder per choice, named by the choice record's stem `<ms>-<attemptId>`:

- state units → `<state>/first-setup-set-aside/<stem>/state/<path>`;
- venue units → `<state>/first-setup-set-aside/<stem>/venue/<path>` when the venue folder and the state folder report one filesystem (`lstat(…).dev` equal, the box's layout); otherwise `<venue>/first-setup-set-aside/<stem>/<path>`.

The name never starts `.venue.db-replaced-`, so `clearReplacedDatabases` never sees it; no sweep listed in "Current behaviour" names it (Task 10b adds tests), and D10 keeps the backup recovery's walk out of it.

**How.** `chooseStartAgainLeftovers`, after the password, under the venue lock, after the second survey and the Keep check (Task 5a):

1. **Folders and a rename probe, before the record.** Make `<root>/first-setup-set-aside` (recursive, mode `0700`) for each destination root, then `<stem>` **not** recursive (an existing one refuses `setup.attempt_conflict`), then its `state`/`venue` subfolders as needed. Then, for each (source root folder → destination folder) pair the units use:
   - make an empty folder `.first-setup-set-aside-probe-<stem>` in the source root folder, `rename` it into the destination folder, and `rmdir` it there.
   - Equal `dev` does not prove a rename works (`rename(2)`, "Current behaviour"). If the probe's rename fails with `EXDEV`, `rmdir` the probe and every folder this call made, and refuse `setup.start_again_set_aside_unavailable` (new code, no params). Nothing is recorded, the page says Move is not possible here (`moveUnavailable`), and Keep stays available.
   - Any other probe failure removes the same empty folders and refuses with that error (the page's `notFinished`).
   - Leftover probe folders from a cut (empty, box-named) are removed by `rmdir` at the next probe or resume.
   - The probe tests the two root folders only. A piece below a root that sits on yet another mount is found only when its own rename fails after the record, and that falls to D1 step 3's explanation page (a limit stated in the PR notes).
2. **The record** (D5), with `noteFloorMs` and the stem.
3. **The note (Q3 A).** If `noteFloorMs` is not null and a note exists, `raiseStartAgainNote(stateDir, { floorMs: noteFloorMs, lastName: note.lastName, module: note.module })`. No note: nothing is raised (Q3's limit).
4. **The pieces**, unit by unit in survey order, each unit's pieces in move order, each by `rename`, syncing the source and destination parents. Before each rename the destination must be absent (`lstat` → `ENOENT`): nothing is ever overwritten. A database's main file goes last, so a cut leaves no main file at its source without the side files that were beside it.
5. Then `finishStartAgainDeletion(roots)`, A1042's own path: it re-checks the marker, finds no finding left, deletes the marked files and removes the marker. The note is not otherwise touched (it was raised before the marker, `first-setup-resolution.ts:461,497`).

**After a cut.** `resumeStartAgainSetAside(roots)` runs at every start before the finisher (D1). With a marker and a Move record for that marker (the latest by name), it takes the venue lock and:

1. removes leftover empty probe folders (`rmdir`, box-named);
2. raises the note as step 3 above (the same value; `raiseStartAgainNote` keeps the higher, so this can repeat);
3. makes the record's destination folders if absent;
4. for each recorded unit, **piece by piece**, into the **same destination folder the record names**:
   - piece at its source with exactly the recorded entries for that piece, and destination absent → rename it;
   - source absent and destination holding exactly the recorded entries → already moved;
   - anything else → stop: move nothing more and return `"stopped"`.

The finisher's refusal then shows the page again with whatever is left. So a cut after a database's `-wal` was renamed resumes with `-shm`, `-journal` and the main file into the same folder as the `-wal`, never into a second set-aside folder. A rename that fails refuses as D1 step 3 says. It never deletes anything but empty probe folders.

*The one split it cannot prevent:* a piece changed by someone between the cut and the next start stops the resume. The remaining pieces are listed afresh, and a second Move puts them in a second folder. The PR notes say so.

**A full disk.** A try's first write is the guess counter (D6), before the password and before the lock. On a full disk that write fails, so the password is not checked and nothing is recorded or moved; the page says the disk is full (`diskFull`). Taking the venue lock writes too (`venue-lock.ts:59-60,88`), and so do the folders, the record and the note. A rename into a new folder may need a block for that folder's list (not measured). A failed write or rename after the record leaves every piece either at its source or at its destination, and the next start resumes.

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
  readonly noteFloorMs: number | null; // the floor a Move raises the note to (Q3 A); null for keep
}
```

- **Who:** the administrator the setup record names, whose password was just checked.
- **Which files:** the units of the survey whose digest equals the page's (D3), each with its pieces.
- It survives the move: it lives in the state folder's top level, which A1042's deletion never walks, and is not a unit.
- Kept like A1042's confirmation records: never deleted except by `waitron.sh reset --all` (Task 11), never carried by a restore or a recovery bundle (`FIRST_SETUP_HOST_FILES`).
- Readers: `assertStartAgainNotKept` (any `keep` record for the marker's `attemptId` and `frozenDigest`), `resumeStartAgainSetAside` (the latest `move` record for the marker), and the choice itself (a `keep` record refuses any later choice, `setup.start_again_kept`). A damaged record for the marker refuses `setup.start_again_incomplete` (reason `choice record damaged: <name>`), so the page falls back to the explanation and nothing moves.

### D6. The password and the limit on wrong guesses (Q5 A)

The password is checked with `verifyPassword` against `ownerVerifier` from the setup record, read only from a survey of kind `choice` (the record's bytes equal the marker's fingerprint, and `parseFirstSetupState` accepted it). Derivation runs before the venue lock (`setup-first-fiscal-api.ts:834`); the survey under the lock (D3) then proves the setup record is still those bytes.

**The guess counter survives a restart**, because the page's own Retry restarts the process: `<state>/first-setup-start-again-guesses.json`, `{ version: 1, attemptId, failures, lastFailureAt: string | null, waitUntil: string | null }`, written by `writeDurableHostJson` (limit 4 KiB).

| Constant | Value | Why |
| --- | --- | --- |
| `START_AGAIN_FREE_GUESSES` | 5 | a long password, mistyped once or twice, across restarts (the PIN limit allows 3 for a 4-digit PIN) |
| wait after the n-th wrong guess, n > 5 | `min(15, 2^(n − 6))` minutes: 1, 2, 4, 8, 15, 15, … | the owner never waits more than 15 minutes after the last wrong guess, whoever made it |
| `START_AGAIN_FORGIVE_MS` | 15 minutes | one wrong guess forgiven per 15 minutes since the last one: a guess an hour never builds a wait; a guesser gets about 4 tries an hour past the first 5; pausing never earns 5 fresh free tries |
| `START_AGAIN_MAX_WAIT_MS` | 15 minutes | a ceiling on every wait, the clock included |

- **Counting.** At a try, the effective count is `max(0, failures − floor((now − lastFailureAt) / 15 min))`. If `waitUntil` is later than now, refuse `password.throttled` with `retryAfterSeconds` (reused, `packages/provisioning/src/errors.ts:26`), the remaining wait capped at 15 minutes. Otherwise write `failures: effective + 1`, `lastFailureAt: now`, `waitUntil: now + wait(effective + 1)` (null within the free five) **before** the password is checked, and write `failures: 0`, both times null, only after a correct one.
- A process killed mid-check, or a counter that cannot be written, never gives a free guess: an unwritable counter refuses the try without checking the password.
- **The clock.** A stored `lastFailureAt` later than now is read as now. A stored `waitUntil` more than 15 minutes ahead is read as now + 15 minutes. So a clock set back never stretches a wait past 15 minutes, and a clock set forward shortens it.
- A damaged counter is read as `failures: 5` at the current time (the free tries spent, no wait yet) and rewritten. A counter for another `attemptId` starts at 0.
- Every try runs in one in-process turn (`inTurn`, `packages/provisioning/src/attempt-turns.ts`), so two sent at once are counted one after the other.

### D7. The secure connection and the form

- `GET /` draws the password box and choices only when the request's socket is TLS (the house check above). Over anything else it draws the explanation and the list with the line "Open this page over the box's secure connection to choose."
- `POST /recovery-api/start-again` refuses unless TLS (403, `insecure`), refuses an `Origin` other than the request's own or a `Sec-Fetch-Site` other than `same-origin`/`none` (403, `otherPage`), takes `application/x-www-form-urlencoded` of at most 4096 bytes with exactly `password`, `choice` (`keep` | `move`) and `listed` (missing field → `setup.request_invalid` with that `field`, 400). It answers an HTML page in the request's language with `Cache-Control: no-store`.
- After Move succeeds it answers, then calls the entry's restart once the response has finished, as `/recovery-api/retry` does (`recovery-surface.ts:637-645`). After Keep it answers the kept page, and the same process then serves the kept page on `GET /`.
- The route is mounted only when the start gave the page a `choice` survey (code `setup.start_again_files_found`).

### D8. Never suggest deleting: the one named exception

The owner's 2026-09-10 rule stays whole for `OPERATOR_TEXT` (the existing guard is unchanged). The new choice text lives in its own table, `START_AGAIN_PAGE_TEXT`, and a new guard reads **every** string in it with wider patterns, allowing exactly one key, `moveDetail`, in both languages (the owner-approved exception of 2026-10-25 15:24):

- English: `/\bwipe\b|\berase\b|\bdelet|\breset\b|\bremov/i` (`\bdelete\b` becomes `\bdelet`, so "deleted" is caught; `\bremov` is added).
- Spanish: `NEVER_WIPE_ES` plus `|\bquit|\bquít|\bsuprim` (so «quita» and «Quítalo» are caught).

The same case asserts `moveDetail` equals the approved words exactly, so the exception cannot drift. It also asserts the patterns catch the review's two misses, "The files were deleted." and «Quítalo.», and the controls "Delete these files." and «Borra estos archivos.» (the run in "Current behaviour").

### D9. Nothing sweeps the set-aside folder, the choices or the counter

`FIRST_SETUP_HOST_FILES` gains `first-setup-start-again-choices`, `first-setup-set-aside` and `first-setup-start-again-guesses.json`. A marker naming any of them is refused as damaged, as the note is. A plain `waitron.sh reset` keeps the choices and the set-aside folder (the precedent of A1042's owner answer Q4 for the note and the confirmations) and removes the counter; `reset --all` removes the state volume. Task 10b tests the sweeps listed in "Current behaviour".

### D10. A backup recovery's check of the box's files leaves the set-aside folder out

`originals` (`first-setup-backup-workspace.ts:293-374`) skips `join(root, "first-setup-set-aside")` for every root it reads, as it skips the lock journal and holder files (`:313-322`). Why:

- the folder is never an input to a recovery, and nothing writes it after the Move;
- without the skip, every check reads every moved byte twice, and an append copies the moved non-database files into the recovery's `evidence/` ("Current behaviour");
- one moved file the box cannot read stops the recovery with `EACCES` (the probe). A Move needs no read of the files, so such a file can be moved.

This changes the originals digest only on boxes that hold a set-aside folder, which exist only after this plan. The choices folder stays in the walk: its records are small, and a changed one is a change the recovery should see.

## Review Focus

1. **Two browsers at once:** one chooses Keep, a page opened earlier chooses Move. The second is refused (`setup.start_again_kept`) with nothing moved. Task 5b.
2. **A power cut at each step of Move** (after the record, after the note, after each piece's rename — the `-wal` alone included — before the finish, mid-finish): the next start completes the move into the same folder and the finish, or shows the page again; the moved bytes are intact; nothing the box did not create is deleted. Tasks 4b, 9.
3. **Retry between wrong guesses** never clears the wait; a guess an hour never builds one; no wait exceeds 15 minutes. Tasks 3, 9.
4. **After Keep, someone removes the found files by hand:** the page still stays and nothing of the attempt is deleted. Task 6.
5. **A found database whose `-wal` holds committed rows:** moved with its side files, `-wal` first; the moved database opens with every row, also after a cut between its pieces. Tasks 4a, 4b.
6. **The new first setup after Move** claims, chooses a name later than the raised note, and its own Start again, a restore, the start's clean-up and a plain reset leave the set-aside folder and the choice records unchanged. Tasks 10b, 11.
7. **Recover from a backup after a Move**, with a moved file the box cannot read: the recovery opens and records; the set-aside folder is unchanged and not copied. Task 10a.
8. **Another mount point:** the probe refuses before the record, and Keep still works. Task 5b.

## Words for the owner's approval

New `OPERATOR_TEXT` rows (title / action):

| Code | English | Spanish |
| --- | --- | --- |
| `setup.start_again_files_found` title | Start again did not finish, and the box found files it did not expect. | «Empezar de nuevo» no terminó y el equipo encontró archivos que no esperaba. |
| … action | An earlier Start again was cut off. Since then, files have appeared on this box that Start again did not create. They may be a venue restored from a backup. The box has not changed them. | Un «Empezar de nuevo» anterior se interrumpió. Desde entonces han aparecido en este equipo archivos que «Empezar de nuevo» no creó. Pueden ser un local recuperado desde una copia de seguridad. El equipo no los ha cambiado. |
| `setup.start_again_kept` title | Start again did not finish, and everything on this box was kept. | «Empezar de nuevo» no terminó y se ha conservado todo lo que hay en este equipo. |
| … action | Nothing was moved. This page stays until Waitron is reinstalled on this box. If Waitron is reinstalled, everything on this box is lost, the kept files included. | No se ha movido nada. Esta página sigue hasta que se reinstale Waitron en este equipo. Si se reinstala Waitron, se pierde todo lo que hay en el equipo, también los archivos conservados. |

`START_AGAIN_PAGE_TEXT` (`apps/server/src/recovery-start-again.ts`). Rows marked **new in revision 2** are new or changed:

| Key | English | Spanish |
| --- | --- | --- |
| `filesFound` | Files found: | Archivos encontrados: |
| `more(n)` | and {n} more | y {n} más |
| `password` | Administrator password | Contraseña de administrador |
| `keepTitle` | Keep everything and stop. | Conservarlo todo y parar. |
| `keepDetail` | Nothing is moved. This page stays until Waitron is reinstalled on this box. | No se mueve nada. Esta página sigue hasta que se reinstale Waitron en este equipo. |
| `moveTitle` | Move these files aside and finish Start again. | Apartar estos archivos y terminar «Empezar de nuevo». |
| `moveDetail` (**the exception**) | The files are moved, unchanged, into a new folder on the box, and the rest of the interrupted setup is removed. The box then starts a new first setup, where you can recover from a backup or set up again. Its invoice series names are never used again. | Los archivos se mueven, sin cambios, a una carpeta nueva del equipo, y se quita el resto de la configuración interrumpida. Después el equipo empieza una configuración inicial nueva, donde puedes recuperar desde una copia de seguridad o configurar de nuevo. Sus nombres de serie de facturas no se vuelven a usar. |
| `moveUnsent` (**new in revision 2**, Q6 A; always under Move) | If these files are a venue that has made sales, invoice records it had not yet sent to AEAT stay unsent: the box sends nothing from moved files. | Si estos archivos son un local que ha vendido, los registros de facturas que aún no había enviado a la AEAT se quedan sin enviar: el equipo no envía nada desde archivos apartados. |
| `moveFloor(time)` (**new in revision 2**, Q3 A; under Move only when the floor is later than the box's clock; `time` as `YYYY-MM-DD HH:MM UTC`) | These files carry a time later than the box's clock, so a new setup can start invoice series names only from {time}. | Estos archivos llevan una hora posterior a la del reloj del equipo, así que una configuración nueva solo puede empezar nombres de serie de facturas a partir de {time}. |
| `continue` | Continue | Continuar |
| `insecureForm` | Open this page over the box's secure connection to choose. | Abre esta página con la conexión segura del equipo para elegir. |
| `passwordMissing` (under the field) | Enter the administrator password. | Introduce la contraseña de administrador. |
| `choiceMissing` (under the choices) | Choose one of the two options. | Elige una de las dos opciones. |
| `fixFields` (bottom) | Check the fields marked above. Nothing was changed. | Revisa los campos marcados arriba. No se ha cambiado nada. |
| `wrongPassword` (under the field; **changed in revision 2**) | This is not the administrator password of the interrupted setup. Nothing was changed. Check it and try again: it is the password chosen when this setup began. | No es la contraseña de administrador de la configuración interrumpida. No se ha cambiado nada. Revísala y vuelve a intentarlo: es la contraseña que se eligió al empezar esta configuración. |
| `forgotten` (bottom, with `wrongPassword` and `throttled`; **new in revision 2**) | If the password is forgotten, this page cannot go further. If you reinstall Waitron, the box starts fresh, but everything on it is lost, these files included. | Si se ha olvidado la contraseña, esta página no puede seguir. Si reinstalas Waitron, el equipo empieza de cero, pero se pierde todo lo que hay en él, también estos archivos. |
| `throttled(n)` (bottom) | Too many wrong passwords. Try again in 1 minute. / … in {n} minutes. Nothing was changed. | Demasiadas contraseñas incorrectas. Vuelve a intentarlo dentro de 1 minuto. / … dentro de {n} minutos. No se ha cambiado nada. |
| `filesChanged` | The files on the box have changed since this page was opened. Nothing was changed. Press Retry to see them as they are now. | Los archivos del equipo han cambiado desde que se abrió esta página. No se ha cambiado nada. Pulsa «Reintentar un arranque normal» para verlos como están ahora. |
| `notOffered` | This choice is no longer offered. Nothing was changed. Press Retry to see the current page. | Esta opción ya no está disponible. No se ha cambiado nada. Pulsa «Reintentar un arranque normal» para ver la página actual. |
| `insecure` | Open this page over the box's secure connection to choose. Nothing was changed. | Abre esta página con la conexión segura del equipo para elegir. No se ha cambiado nada. |
| `otherPage` | This choice must be sent from this page. Nothing was changed. | Esta elección debe enviarse desde esta página. No se ha cambiado nada. |
| `busy` | Another Waitron program is using the box's files. Nothing was changed. Wait a moment, then press Continue again. | Otro programa de Waitron está usando los archivos del equipo. No se ha cambiado nada. Espera un momento y vuelve a pulsar «Continuar». |
| `diskFull` (**changed in revision 2**) | The box's disk is full, so the choice could not be saved. Nothing was moved. Press Retry: as it starts, the box frees space by clearing its own temporary copies, old logs and crash reports. Then choose again. If that is not enough, the choice cannot be saved on this box; if you reinstall Waitron, the box starts fresh, but everything on it is lost, these files included. | El disco del equipo está lleno, así que no se ha podido guardar la elección. No se ha movido nada. Pulsa «Reintentar un arranque normal»: al arrancar, el equipo libera espacio descartando sus propias copias temporales, registros antiguos e informes de fallos. Después vuelve a elegir. Si no basta, la elección no se puede guardar en este equipo; si reinstalas Waitron, el equipo empieza de cero, pero se pierde todo lo que hay en él, también estos archivos. |
| `moveUnavailable` (**new in revision 2**) | These files cannot be moved aside on this box: the system treats the folder they are in and the box's folder for moved files as separate disks, and Start again never copies files. Nothing was changed. Keep everything and stop is still available. | Estos archivos no se pueden apartar en este equipo: el sistema trata la carpeta donde están y la carpeta del equipo para archivos apartados como discos distintos, y «Empezar de nuevo» nunca copia archivos. No se ha cambiado nada. Puedes elegir «Conservarlo todo y parar». |
| `notSaved` | The box could not save the choice. Nothing was moved. Press Continue to try again. | El equipo no ha podido guardar la elección. No se ha movido nada. Pulsa «Continuar» para volver a intentarlo. |
| `notFinished` | Start again could not finish. The files it found are unchanged. Press Retry: the box carries on as it starts. | «Empezar de nuevo» no ha podido terminar. Los archivos que encontró no han cambiado. Pulsa «Reintentar un arranque normal»: el equipo continúa al arrancar. |
| `moved(folder)` | Start again has finished. The files are in {folder}. Waitron is restarting into a new first setup; reload this page in a minute. | «Empezar de nuevo» ha terminado. Los archivos están en {folder}. Waitron se está reiniciando en una configuración inicial nueva; recarga esta página dentro de un minuto. |

`diskFull`'s "clearing its own temporary copies, old logs and crash reports" is what the supervised entry's `freeSpaceAtStart` does before the first-setup check ("Current behaviour", `node-entry.ts:313-328`; `start-space.ts:53-60`). The box runs that entry (`deploy/Dockerfile:289`). The `forgotten` and `diskFull` reinstall sentences follow the house's conditional style (`recovery-surface.ts:477`) and send nobody elsewhere.

The Spanish Move text completes the owner's draft, which stopped at «…una configuración inicial nueva.», with the English's last two sentences. `setup.start_again_incomplete`'s words (A1042's stop-gap) are unchanged: they already are "the explanation and what reinstalling would lose".

## Existing assertions this plan changes

None. Revision 1's Q4 change to `apps/server/src/first-setup-resolution.boot.test.ts:627` is withdrawn: that box's record is unparseable, so it stays `setup.start_again_incomplete`. `scripts/waitron-sh.test.mjs:1495-1537` is not edited (Task 11 adds a case; the existing pattern still matches because the new clauses follow the ones it names). Every A1042 finisher reason is preserved (D2). No existing backup-workspace assertion names `first-setup-set-aside` (D10 changes only what that name does). Task 10a's Step 2 runs the whole file to show it.

## Files

| File | Responsibility |
| --- | --- |
| `packages/provisioning/test/start-again-attempt.ts` (new), `packages/provisioning/package.json` (`exports` entry) | the shared fixture `startAgainAttempt` |
| `packages/provisioning/src/first-setup-start-again-deletion.ts` (modify) | `collectStartAgainFindings`; the finisher throws the first finding |
| `packages/provisioning/src/first-setup-start-again-leftovers.ts` (new) | units, pieces, survey, digest, note floor, `classifyStartAgainRefusal` |
| `packages/provisioning/src/first-setup-start-again-names.ts` (new) | the three new file and folder names, with no imports |
| `packages/provisioning/src/first-setup-start-again-choice.ts` (new) | choice records: write once, read for a marker, `assertStartAgainNotKept` |
| `packages/provisioning/src/first-setup-start-again-guesses.ts` (new) | the persisted guess counter (D6) |
| `packages/provisioning/src/first-setup-start-again-set-aside.ts` (new) | destinations, the probe, the move, `resumeStartAgainSetAside` |
| `packages/provisioning/src/first-setup-start-again-choose.ts` (new) | `chooseStartAgainLeftovers`: counter, password, lock, survey, probe, record, note, keep or move |
| `packages/provisioning/src/first-setup-backup-workspace.ts` (modify) | D10: the originals walk skips the set-aside folder |
| `packages/provisioning/src/errors.ts`, `index.ts`, `first-setup-state.ts` (modify) | four codes, exports, `FIRST_SETUP_HOST_FILES` |
| `apps/server/src/first-setup-entry.ts` (modify) | D1's order; the refused admission carries the survey |
| `apps/server/src/recovery-start-again.ts` (new) | `START_AGAIN_PAGE_TEXT`, the section's HTML, the POST route |
| `apps/server/src/recovery-surface.ts` (modify) | two `OPERATOR_TEXT` rows; `RecoveryDeps.startAgain`; mounting |
| `apps/server/src/node-entry.ts`, `first-setup-launch.ts` (modify) | pass the survey and the restart to the page |
| `apps/server/test/first-setup-backup-recovery-fixture.ts` (modify) | an optional `prepareBox` hook for Task 10a |
| `deploy/waitron.sh`, `scripts/waitron-sh.test.mjs` | plain reset keeps the choices and the set-aside folder |
| docs | guides EN/ES, `conventions-ui.md`, `CLAUDE.md`, `deploy/README.md`, `docs/operations/first-live-fiscal-setup.md`, backlog |

---

## Tasks

### Task 0: Owner answers and a line check

- [ ] **Step 1:** Record the owner's answers to Q1 and Q2 at the top of this plan (one line each, with the date), and any answer to Q3, Q5 or Q6 (without one, the build uses each one's A). A task blocked by an unanswered Q1 or Q2 is not dispatched; Tasks 1 and 11 do not wait.
- [ ] **Step 2:** If `main` has moved past ef4322c82, run `git diff --stat ef4322c82..origin/main -- apps/server/src/first-setup-entry.ts apps/server/src/recovery-surface.ts apps/server/src/recovery-surface.test.ts apps/server/src/node-entry.ts apps/server/src/first-setup-launch.ts packages/provisioning/src/first-setup-start-again-deletion.ts packages/provisioning/src/first-setup-start-again-note.ts packages/provisioning/src/first-setup-backup-workspace.ts packages/provisioning/src/first-setup-state.ts apps/server/src/first-setup-backup-recovery.ts deploy/waitron.sh scripts/native-form-fields.test.ts`. For each file listed, re-read the lines this plan cites and correct them here before dispatch. If A1099 has landed, re-read Q3's "no note" limit: its "name unknown" note may close it.

### Task 1: The shared fixture, and the finisher's checks collect every finding

**Files:** create `packages/provisioning/test/start-again-attempt.ts`; modify `packages/provisioning/package.json` (`exports`: `"./testing/start-again-attempt": "./test/start-again-attempt.ts"`, beside `./testing/allocated-venue`); modify `packages/provisioning/src/first-setup-start-again-deletion.ts`; create `packages/provisioning/src/first-setup-start-again-findings.test.ts`.

**Interfaces — produces:**

```ts
// packages/provisioning/test/start-again-attempt.ts — imported in provisioning as "../test/start-again-attempt.js",
// elsewhere as "@waitron/provisioning/testing/start-again-attempt".
export const START_AGAIN_ADMIN_PASSWORD = "synthetic-start-again-password";
export const START_AGAIN_ADMIN = { displayName: "Elena", email: "elena@example.test" } as const;
export interface StartAgainAttempt {
  readonly roots: { readonly venueDir: string; readonly stateDir: string }; // canonical
  readonly attemptId: string;
  readonly frozenDigest: string;
  readonly administratorId: string;
}
/**
 * A first setup claimed through `createFirstSetupStore(...).claim(...)`, whose `first-setup.json`
 * `parseFirstSetupState` accepts and whose `ownerVerifier` is `hashPassword(START_AGAIN_ADMIN_PASSWORD)`,
 * then A1042's marker over it (`startAgainMarkerFor` + `writeStartAgainMarker`): the box a cut left
 * between the marker and the deletion. `before` runs after the claim and before the marker, for files
 * the attempt itself wrote (they are marked); `note` raises a note first. `base` is an empty scratch
 * folder the caller made and removes; the roots are `<base>/venue` and `<base>/state`.
 */
export async function startAgainAttempt(
  base: string,
  options?: {
    before?: (roots: { venueDir: string; stateDir: string }) => Promise<void>;
    note?: { floorMs: number; lastName: string; module: string };
  },
): Promise<StartAgainAttempt>;

// first-setup-start-again-deletion.ts
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

The fixture's claim follows `frozenAttempt` in `packages/provisioning/src/first-setup-start-again-note.test.ts:1139-1186` (a `FirstSetupFrozen` with the admin's `pinHash` and `passwordHash`), with `START_AGAIN_ADMIN`'s name and email. "Current behaviour" names the run that showed this shape parses, verifies and finishes. Tasks 2–6, 9 and 10a/10b use this fixture for every box that should be offered the choice; `markedDeletion` (`apps/server/src/first-setup-entry.test.ts:395-412`) and the boot test's `startingBox` (`apps/server/src/first-setup-resolution.boot.test.ts:345-378`) stay as they are for their existing cases.

- [ ] **Step 1: The fixture, and its own failing test** in the new test file: "the shared fixture is a real setup a Start again left: its record parses, its password verifies, the finisher finishes it, and a venue.db written after it is refused unlisted": `parseFirstSetupState(JSON.parse(<first-setup.json>), roots.venueDir, roots.stateDir)` resolves; `verifyPassword(START_AGAIN_ADMIN_PASSWORD, <ownerVerifier>)` is `true` and a wrong one `false`; on one fixture `finishStartAgainDeletion` resolves and the venue folder holds only `venue.lock`; on another, after `writeFile(<venue>/venue.db, …)`, it rejects `{ code: "setup.start_again_incomplete", reason: "unlisted file: venue/venue.db" }`. Today it fails on the missing module.
- [ ] **Step 2: Failing tests for the collector,** each on the shared fixture: (a) "collects every finding of a box, in the finisher's order": then `trading.env` in the state folder, a marked `venue.db` (written in `before`) rewritten with different bytes, an unlisted `first-fiscal-documents/extra.json` and a non-empty `venue.db-wal`; expect `findings` to equal those four in order refused-artifact, changed, unlisted, wal, and `blocker` null. Today it fails with "collectStartAgainFindings is not a function". (b) "a link among the attempt's files is a blocker, after the findings before it": `trading.env` plus a link in `first-fiscal-documents/`; expect one finding and `blocker.reason` starting `layout unexpected:`. (c) "the finisher still refuses with the first finding's reason": for the box of (a), `finishStartAgainDeletion` rejects with `reason: "refused artifact present: state/trading.env"` and the folder snapshot is unchanged (copy `tree`/`snapshot` from `first-setup-start-again-note.test.ts:381-403` rather than moving them).
- [ ] **Step 3:** `pnpm --filter @waitron/provisioning exec vitest run src/first-setup-start-again-findings.test.ts` — expect FAIL on the fixture case and (a), (b).
- [ ] **Step 4:** Implement the fixture, then the collector. `finishStartAgainDeletion` keeps its lock and its two marker reads, then calls the collector and throws `findings[0]`'s reason, else `blocker`, else deletes as today. `markerSha256` is the SHA-256 of the marker file's bytes.
- [ ] **Step 5:** Run Step 3's command, then the A1042 suites unedited: `pnpm --filter @waitron/provisioning exec vitest run src/first-setup-start-again-findings.test.ts src/first-setup-start-again-deletion.test.ts src/first-setup-start-again-note.test.ts` — all PASS (the reason cases at `first-setup-start-again-note.test.ts:867-958` among them).
- [ ] **Step 6:** `pnpm --filter @waitron/provisioning typecheck`; commit `git add` the four files; `git commit -s -m "A shared Start again fixture with a real setup record, and the finisher collects every finding before refusing (A1098)"`.

### Task 2: Units, the survey and the start's classification (needs Q2)

**Files:** create `packages/provisioning/src/first-setup-start-again-leftovers.ts` and `…-leftovers.test.ts`; modify `packages/provisioning/src/errors.ts` (add `"setup.start_again_files_found": Record<string, never>`), `packages/provisioning/src/index.ts`.

**Interfaces — consumes:** Task 1 (the fixture and the collector). **Produces:** the D2 types; `START_AGAIN_ENTRY_LIMIT`; `START_AGAIN_FLOOR_MARGIN_MS`; `startAgainSetAsideFloorMs`; `surveyStartAgainLeftovers(roots): Promise<StartAgainSurvey | null>`; `classifyStartAgainRefusal(roots, error: AppError): Promise<{ error: AppError; survey?: Extract<StartAgainSurvey, { kind: "choice" }> }>`.

- [ ] **Step 1: Failing tests,** every box from the shared fixture (each would print "is not a function" today):
  - "the owner's example: a venue.db placed after the marker is one database unit": survey `choice`, one unit `{ root: "venue", path: "venue.db", why: "not-created" }`, with `venue.db-wal` and `venue.db-shm` among its entries when present, and `pieces` `["venue.db-wal", "venue.db-shm", "venue.db"]`.
  - "an unexpected -wal makes the marked venue.db and its side files one unit": `why: "changed"`.
  - "a refused-artifact folder is one unit with every entry under it" (`.venue.db-litestream/` with two files).
  - "an unlisted record folder is the unit, not its files"; "an unlisted file inside a marked record folder is its own unit".
  - "the setup record changed, or gone, explains instead" (`kind: "explain"`); "a setup record parseFirstSetupState refuses explains" (overwrite the fixture's `first-setup.json` before the marker with `{"synthetic":"attempt"}`, the boot test's record); "a unit holding venue.lock explains"; "a link explains"; "more than START_AGAIN_ENTRY_LIMIT entries explains" (Q2 A).
  - "the digest changes when a listed file's bytes, a folder's contents or an inode change, and not when nothing changes" (rewrite with equal size; add a file inside a folder unit; replace a file by rename; re-survey untouched).
  - "the note floor is the newest moved file time plus 150 s, rounded up to the minute": set two found files' times with `utimes` to 16:52:10 and 16:40:00 UTC; expect `noteFloorMs` = 16:55:00 UTC; with the newest at exactly 16:52:30, still 16:55:00.
  - "moving every unit by hand leaves the finisher nothing to refuse": for a box holding one of each finding kind, `rename` each unit's pieces out by hand in the test, then `finishStartAgainDeletion` resolves and only the marked files are gone. This pins that the survey is the exact complement of what the finisher refuses.
  - "classifyStartAgainRefusal gives files_found with the finisher's reason, and gives the finisher's error back unchanged otherwise".
- [ ] **Step 2:** `pnpm --filter @waitron/provisioning exec vitest run src/first-setup-start-again-leftovers.test.ts` — FAIL.
- [ ] **Step 3:** Implement D2. `lstat(path, { bigint: true })`, never following a link.
- [ ] **Step 4:** Step 2's command PASSES; `pnpm --filter @waitron/provisioning typecheck`.
- [ ] **Step 5:** Commit the four files with `git commit -s -m "Start again's leftovers: units, a survey and its digest (A1098)"`.

### Task 3: Choice records and the guess counter

**Files:** create `packages/provisioning/src/first-setup-start-again-names.ts`, `first-setup-start-again-choice.ts`, `…-choice.test.ts`, `…-guesses.ts`, `…-guesses.test.ts`; modify `errors.ts` (add `"setup.start_again_kept": Record<string, never>`), `index.ts`, `first-setup-state.ts` (`FIRST_SETUP_HOST_FILES` gains `START_AGAIN_CHOICES_DIR`, `START_AGAIN_SET_ASIDE_DIR` and `START_AGAIN_GUESSES_FILE`). The three names live in a new module with no imports, `packages/provisioning/src/first-setup-start-again-names.ts` (`START_AGAIN_SET_ASIDE_DIR = "first-setup-set-aside"`), which `first-setup-state.ts`, the choice, guess and set-aside modules and the backup workspace (D10) all import. The choice module reads the marker through the deletion module, which already imports `first-setup-state.ts` indirectly; importing the names from the choice module there would close the load-order loop `first-setup-state.ts:149-151` warns about.

**Interfaces — produces:**

```ts
export const START_AGAIN_CHOICES_DIR = "first-setup-start-again-choices";
export async function writeStartAgainChoice(stateDir: string, record: Omit<StartAgainChoiceRecord, "version">): Promise<string>; // the stem
export async function readStartAgainChoices(stateDir: string, marker: { attemptId: string; frozenDigest: string }): Promise<StartAgainChoiceRecord[]>; // by name, oldest first
export async function assertStartAgainNotKept(roots: { stateDir: string; venueDir: string }): Promise<void>; // reads the marker itself
export const START_AGAIN_GUESSES_FILE = "first-setup-start-again-guesses.json";
export const START_AGAIN_FREE_GUESSES = 5;
export const START_AGAIN_FORGIVE_MS = 15 * 60_000;
export const START_AGAIN_MAX_WAIT_MS = 15 * 60_000;
export function startAgainWaitMs(failures: number): number; // 0 up to 5; then min(15, 2^(n−6)) minutes
export async function beginStartAgainGuess(stateDir: string, attemptId: string, now: Date): Promise<(outcome: "success" | "invalid") => Promise<void>>;
```

- [ ] **Step 1: Failing tests.**
  - Choice: "a record is written once, with every field, and a second write of the same stem is refused setup.attempt_conflict"; "records for another attempt or another frozen digest are not read"; "a damaged record for the marker refuses setup.start_again_incomplete"; "assertStartAgainNotKept refuses setup.start_again_kept with a keep record for the marker, and passes with only a move record or none" (the marker from the shared fixture); "a marker naming the choices folder, the set-aside folder or the counter is refused as damaged" (beside A1042's case for the note); "isFirstSetupHostPath names all three".
  - Guesses: "startAgainWaitMs is 0 up to five failures, then 1, 2, 4, 8 minutes, and never more than 15"; "the count is on disk before the check: begin, then a new begin from a fresh import sees it raised" (the restart case); "a wrong guess past the free ones refuses the next try password.throttled with retryAfterSeconds"; "one wrong guess is forgiven per 15 minutes: a wrong guess every hour for 24 hours never waits" (injected clock); "a guesser at the fastest allowed rate gets five tries and then about four an hour" (count the tries an injected clock allows in 3 hours: expect 5 + the waits' tries, and assert the exact number the rule gives); "success sets the count back to 0"; "a clock set back a year never makes a wait longer than 15 minutes" (stored `waitUntil` and `lastFailureAt` a year ahead); "an unwritable counter refuses the try" (state folder made read-only: `beginStartAgainGuess` rejects, and the returned finish is never reached); "a damaged counter reads as five failures"; "another attempt's counter starts at 0".
  - Today each prints "is not a function" or fails on the missing name.
- [ ] **Step 2:** `pnpm --filter @waitron/provisioning exec vitest run src/first-setup-start-again-choice.test.ts src/first-setup-start-again-guesses.test.ts src/first-setup-state.test.ts` — FAIL on the new cases.
- [ ] **Step 3:** Implement D5 and D6. Record validation follows `first-setup-start-again-confirmation.ts` (exact keys, canonical instants, UUIDs).
- [ ] **Step 4:** Step 2's command PASSES; also `src/first-setup-start-again-deletion.test.ts src/first-setup-start-again-note.test.ts`; typecheck.
- [ ] **Step 5:** Commit; `git commit -s -m "Start again choice records, and a guess counter that survives a restart and forgives (A1098)"`.

### Task 4a: Move aside — destinations, the probe, the pieces

**Files:** create `packages/provisioning/src/first-setup-start-again-set-aside.ts`, `…-set-aside.test.ts`; modify `errors.ts` (add `"setup.start_again_set_aside_unavailable": Record<string, never>`), `index.ts`.

**Interfaces — consumes:** Tasks 1–3. **Produces:**

```ts
export interface SetAsideIo { lstat: typeof fs.lstat; mkdir: typeof fs.mkdir; rmdir: typeof fs.rmdir; rename: (from: string, to: string) => Promise<void> } // default node:fs/promises; tests inject failures
export async function setAsideDestinations(roots: Roots, stem: string): Promise<{ state: string; venue: string }>; // relative-to-root folders for the record
export async function prepareSetAside(roots: Roots, units: readonly StartAgainUnit[], destinations: { state: string; venue: string }, io?: SetAsideIo): Promise<void>; // D4 step 1: folders + probe; refuses setup.start_again_set_aside_unavailable on EXDEV
export async function moveStartAgainUnits(roots: Roots, record: StartAgainChoiceRecord, io?: SetAsideIo): Promise<void>; // D4 steps 3–4; caller holds the venue lock
```

- [ ] **Step 1: Failing tests** (shared fixture boxes):
  - "units move unchanged into a new folder: same bytes, same inode, same file times, relative paths kept", for a file unit, a folder unit and a database unit.
  - "a database whose -wal holds committed rows moves whole, -wal first, and opens with every row": write rows in WAL mode with `node:sqlite` and leave them in the `-wal`; record the rename order through an injected `io`; after the move open the moved `venue.db` read-only and count the rows.
  - "an existing stem folder refuses setup.attempt_conflict and moves nothing"; "an existing destination file is never overwritten".
  - "the probe's EXDEV refuses setup.start_again_set_aside_unavailable, removes only the empty folders it made, and moves nothing": inject a `rename` that throws `EXDEV` for the probe; the folder snapshot afterwards equals the one before.
  - "on one filesystem venue units go under the state folder's set-aside folder; on two, under the venue folder's own" (inject `lstat` returning a different `dev`).
  - "a leftover probe folder from a cut is removed by the next prepare, and nothing else is".
  - "the note is raised to the record's floor, keeping its last name and module; with no note nothing is written" (raise a note with the fixture's `note` option; compare `readStartAgainNote` before and after).
  - "venue.lock, venue.holder.json and recovery.lock are never moved or unlinked": present before, same inode after.
  - "after a move, finishStartAgainDeletion deletes only the marked files".
- [ ] **Step 2:** `pnpm --filter @waitron/provisioning exec vitest run src/first-setup-start-again-set-aside.test.ts` — FAIL ("is not a function").
- [ ] **Step 3:** Implement D4 steps 1, 3 and 4.
- [ ] **Step 4:** Step 2's command PASSES; typecheck.
- [ ] **Step 5:** Commit; `git commit -s -m "Move a cut-off Start again's found files aside, unchanged, after a rename probe (A1098)"`.

### Task 4b: Finishing a Move a cut interrupted

**Files:** modify `packages/provisioning/src/first-setup-start-again-set-aside.ts`, `…-set-aside.test.ts`.

**Produces:** `export async function resumeStartAgainSetAside(roots: Roots, io?: SetAsideIo): Promise<"none" | "resumed" | "stopped">;` — takes `lockVenueDatabase(venueDir)` itself.

- [ ] **Step 1: Failing tests,** each by injecting a `rename` that throws on call N, then calling `resumeStartAgainSetAside` with the real `io`:
  - "a cut after the record and before the first rename: the resume moves everything into the record's folder".
  - "a cut after a database's -wal moved: the resume moves -shm and venue.db into the same folder as the -wal, and the moved database opens with every row" (the rows only in the `-wal`, as in Task 4a).
  - "a cut after each piece in turn: the resume finishes the rest, into one folder" (`it.each` over N).
  - "a cut before the note was raised: the resume raises it".
  - "a piece changed between the cut and the resume: the resume stops and moves nothing more" (rewrite a not-yet-moved piece).
  - "a rename that fails at the resume refuses setup.start_again_incomplete with reason set-aside failed: EXDEV venue/venue.db, and moves nothing more" (inject `EXDEV` on the resume's rename).
  - "no move record, or only a keep record: none, and nothing touched".
- [ ] **Step 2:** `pnpm --filter @waitron/provisioning exec vitest run src/first-setup-start-again-set-aside.test.ts` — the new cases FAIL.
- [ ] **Step 3:** Implement D4 "After a cut".
- [ ] **Step 4:** PASS; typecheck. **Step 5:** commit `git commit -s -m "Finish a Move a cut interrupted, piece by piece, into the same folder (A1098)"`.

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

- [ ] **Step 1: Failing tests** (shared fixture, password `START_AGAIN_ADMIN_PASSWORD`): "a wrong password is refused setup.owner_required, counted, and changes no file of either folder except the counter" (folder snapshot before and after, the counter excluded); "the sixth wrong password makes the next try wait, and a new call — a restart — still waits"; "a digest from an older page is refused setup.start_again_files_changed and costs no guess"; "files changed between the password and the lock: refused, nothing changed" (a `verify` stand-in rewrites the found `venue.db` with other bytes, then answers `true`); "a box whose setup record changed refuses setup.not_ready"; "another process holding the venue folder refuses provisioning.database_in_use, nothing changed"; "two tries sent at once are counted one after the other". Today: "is not a function".
- [ ] **Step 2:** `pnpm --filter @waitron/provisioning exec vitest run src/first-setup-start-again-choose.test.ts` — FAIL.
- [ ] **Step 3:** Implement up to the second survey.
- [ ] **Step 4:** PASS; typecheck. **Step 5:** commit `git commit -s -m "The Start again choice checks the setup's administrator password, counts wrong guesses and binds to the listed files (A1098)"`.

### Task 5b: The choice — probe, record, note, Keep, Move

**Files:** the same two files.

- [ ] **Step 1: Failing tests** (shared fixture):
  - "Keep writes one record with who, when, what and which files, and moves nothing": the record's `administrator` equals the fixture's `administratorId` and `START_AGAIN_ADMIN`; `at` is the injected clock; `choice: "keep"`; `listed.units` equal the survey's; `setAside: null`; `noteFloorMs: null`; both folder snapshots unchanged except the new record and the counter.
  - "After Keep, a later Move is refused setup.start_again_kept and moves nothing" (Review Focus 1).
  - "Move writes the record before the first rename": inject a `rename` that reads the choices folder on its first non-probe call and finds the record.
  - "Move raises the note to the moved files' floor before the first rename" (fixture with `note`; the same injected `rename` reads the note).
  - "Move then finishes Start again: the marker and the marked files are gone, the moved files are at the destination unchanged, and A1042's confirmation records are byte-identical".
  - "another mount point: the probe refuses setup.start_again_set_aside_unavailable, no record is written, and a Keep after it succeeds" (Review Focus 8).
  - "A record that cannot be written refuses setup.attempt_invalid and moves nothing" (choices folder made read-only).
  - "No log call and no thrown error carries the administrator's name or email" (spy on the logger seam if one is added; assert `JSON.stringify` of every thrown error and logged detail excludes both strings).
- [ ] **Step 2:** `pnpm --filter @waitron/provisioning exec vitest run src/first-setup-start-again-choose.test.ts` — the new cases FAIL.
- [ ] **Step 3:** Implement: for Move, `prepareSetAside`, then `writeStartAgainChoice`, then `moveStartAgainUnits` (note, pieces), then `finishStartAgainDeletion`; for Keep, `writeStartAgainChoice` and return.
- [ ] **Step 4:** PASS, with `src/first-setup-start-again-set-aside.test.ts src/first-setup-start-again-note.test.ts`; typecheck. **Step 5:** commit `git commit -s -m "Keep records the choice; Move records it, raises the note, moves the files aside and finishes Start again (A1098)"`.

### Task 6: The start's four outcomes

**Files:** modify `apps/server/src/first-setup-entry.ts`, `apps/server/src/first-setup-entry.test.ts` (new cases only).

**Interfaces — consumes:** `assertStartAgainNotKept`, `resumeStartAgainSetAside`, `classifyStartAgainRefusal`; the shared fixture through `@waitron/provisioning/testing/start-again-attempt`. **Produces:** `START_REFUSALS` = `["setup.workspace_unsupported", "setup.start_again_incomplete", "setup.start_again_files_found", "setup.start_again_kept"]`; the refused admission `{ kind: "refused"; code; roots; error; survey?: Extract<StartAgainSurvey, { kind: "choice" }> }`.

- [ ] **Step 1: Failing tests** in `first-setup-entry.test.ts`, each box from `startAgainAttempt` (not `markedDeletion`, whose record is unparseable):
  - "a venue.db placed after the marker is refused setup.start_again_files_found, with its survey and nothing changed";
  - "a keep record for the marker is refused setup.start_again_kept even after the found files are removed, and the marked files stay" (Review Focus 4);
  - "a move record with every unit still in place is resumed and setup is served" (`kind: "normal"`, marker gone, units at the destination);
  - "a move record whose resume rename fails is refused setup.start_again_incomplete with no survey" (inject through the resume's `io` seam, or make the destination folder read-only);
  - "the same venue.db beside the existing synthetic record is still refused setup.start_again_incomplete": `markedDeletion` plus a `venue.db` after the marker. This pins revision 2's withdrawal of Q4, beside the existing case `:434-454`, which must pass unedited.
- [ ] **Step 2:** `pnpm --filter @waitron/server exec vitest run src/first-setup-entry.test.ts` — FAIL on the new cases.
- [ ] **Step 3:** Implement D1 in `refusedAtStart`.
- [ ] **Step 4:** `pnpm --filter @waitron/server exec vitest run src/first-setup-entry.test.ts src/first-setup-resolution.boot.test.ts src/first-setup-workspace.test.ts src/recovery-state.test.ts src/first-setup-start-again-note.test.ts` — PASS, the boot test's `:594-630` case unedited. Any failing existing assertion is a STOP.
- [ ] **Step 5:** `pnpm --filter @waitron/server typecheck`; commit `git commit -s -m "The start tells found files, a kept choice and an unfinished Start again apart (A1098)"`.

### Task 7: The page's words and its never-delete guard (needs Q1)

**Files:** create `apps/server/src/recovery-start-again.ts` (text table and HTML only in this task), `apps/server/src/recovery-start-again.test.ts`; modify `apps/server/src/recovery-surface.ts` (two `OPERATOR_TEXT` rows), `apps/server/src/recovery-surface.test.ts` (new cases only; add the two codes to `ROWS` at `:1114-1156` as new entries — adding rows changes no existing row), `scripts/native-form-fields.test.ts` (Q1 A's entry).

**Interfaces — produces:**

```ts
export const START_AGAIN_PAGE_TEXT: Readonly<Record<SupportedLocale, StartAgainPageText>>; // keys of "Words for the owner's approval"
export type StartAgainMessage =
  | { kind: "passwordMissing" | "choiceMissing" | "wrongPassword" | "filesChanged" | "notOffered" | "insecure" | "otherPage" | "busy" | "diskFull" | "moveUnavailable" | "notSaved" | "notFinished" }
  | { kind: "throttled"; minutes: number }
  | { kind: "moved"; folder: string };
export function renderStartAgainSection(input: {
  survey: Extract<StartAgainSurvey, { kind: "choice" }>;
  locale: SupportedLocale;
  secure: boolean;
  now: Date; // decides whether moveFloor shows
  message?: StartAgainMessage;
  chosen?: "keep" | "move"; // re-checks the radio after a refusal
}): string; // HTML for between the action paragraph and the Retry form
```

The list shows each unit's top path as `venue/<path>` or `state/<path>`, a folder with a trailing `/`, a database unit followed by its side files, at most 50 lines then `more(n)`. Every path goes through `escapeHtml`. The form: `method="post" action="/recovery-api/start-again"`, the password box (`name="password"`, `autocomplete="current-password"`, `required`, visible `*` in its label), two radios `name="choice"` with values `keep` and `move` (`required`), each with its title in bold and its detail below (Move's detail followed by `moveUnsent`, then `moveFloor` when `survey.noteFloorMs` is later than `now`), the hidden `listed`, Continue. Field errors sit under their field; one bottom message above Continue; `forgotten` follows `wrongPassword` and `throttled`. No colour, size or font is set (the page sets none today, `recovery-surface.ts:594`).

- [ ] **Step 1: Failing tests:**
  - In `recovery-surface.test.ts`: the two new codes in `ROWS` (so "names $code in both languages", "says a refused $code start was not counted", "neither refused start sends the person to someone else" cover them). Then "never suggests deleting in the Start again choices, except the one owner-approved sentence": every string of `START_AGAIN_PAGE_TEXT` (functions called with sample arguments) is refused by D8's wider patterns except `moveDetail`. `moveDetail` must equal the approved English and Spanish exactly, and must match the wider pattern. The patterns catch "The files were deleted." and «Quítalo.» and the two controls (the run in "Current behaviour" printed `true` for each). The existing "never suggests wiping anything" case stays as it is.
  - In `recovery-start-again.test.ts`: "lists the owner's example as venue/venue.db"; "escapes a found path holding markup" (a file named `<b>x</b>`); "draws no password box when the request is not secure, and says how to choose"; "shows 50 paths and 'and N more'"; "marks both fields required"; "shows each message in both languages in its place" (field messages under their field, the rest above Continue, `forgotten` after `wrongPassword` and `throttled`); "shows moveFloor only when the floor is later than now, in UTC"; "a Spanish string differs from its English twin for every key".
  - Today: the module does not exist, and the two codes are not in `OPERATOR_TEXT`.
- [ ] **Step 2:** `pnpm --filter @waitron/server exec vitest run src/recovery-surface.test.ts src/recovery-start-again.test.ts` — FAIL. `pnpm exec vitest run scripts/native-form-fields.test.ts` — FAIL on the new file once the password box exists.
- [ ] **Step 3:** Implement the table and `renderStartAgainSection`; add the `ALLOWED` entry (Q1 A).
- [ ] **Step 4:** The two Step 2 commands PASS, `recovery-surface.test.ts` whole; `pnpm exec vitest run scripts/english-only.test.ts scripts/native-form-fields.test.ts`; typecheck.
- [ ] **Step 5:** Commit; `git commit -s -m "The recovery page's words for found files and a kept choice, with the one approved removal sentence named in its guard (A1098)"`.

### Task 8a: The page's form route

**Files:** modify `apps/server/src/recovery-start-again.ts` (add `mountStartAgainChoice`); tests in `apps/server/src/recovery-start-again.test.ts`.

**Interfaces:**

```ts
// RecoveryDeps, recovery-surface.ts (the field is added in this task; Task 8b reads it)
startAgain?: {
  roots: { stateDir: string; venueDir: string };
  survey: Extract<StartAgainSurvey, { kind: "choice" }>;
  onFinished: () => Promise<void>; // the entry's restart
  choose?: typeof chooseStartAgainLeftovers; // test seam; defaults to the real one
  now?: () => Date;
};
export function mountStartAgainChoice(app: Hono, deps: NonNullable<RecoveryDeps["startAgain"]>, render: …): void;
```

Code to page:

| Code | Page message(s) | Status |
| --- | --- | --- |
| `setup.request_invalid` (field `password` or `choice`) | `passwordMissing` / `choiceMissing`, plus `fixFields` | 400 |
| `setup.owner_required` | `wrongPassword` + `forgotten` | 403 |
| `password.throttled` | `throttled` (minutes rounded up) + `forgotten` | 429, with `Retry-After` |
| `setup.start_again_files_changed` | `filesChanged` | 409 |
| `setup.not_ready`, `setup.start_again_kept` | `notOffered` | 409 |
| `provisioning.database_in_use` | `busy` | 409 |
| `setup.start_again_set_aside_unavailable` | `moveUnavailable` | 409 |
| `setup.attempt_invalid` | `diskFull` when `lowestFreeBytes([stateDir, venueDir])` (`apps/server/src/start-space.ts:22`) is under `FULL_DISK_BYTES` (`apps/server/src/boot-failure.ts:47`), else `notSaved` | 409 |
| anything else | `notFinished`, logged `recovery.start_again_choice_failed` with `errorCode` only | 409 |

Success: Keep → 200 with the kept code's page, and later `GET /` serves it; Move → 200 with `moved`, then `onFinished` once the response has finished. Log `recovery.start_again_choice` with `{ choice, attemptId, units: <count> }` only.

- [ ] **Step 1: Failing tests** (a Hono app with only this route mounted, through `app.request` with `env` `{ incoming: { socket: new TLSSocket(new Socket()) } }`, as `apps/server/src/first-setup-start-again-note.test.ts:338-342`, and `choose` stubbed except where named): "a POST without TLS is refused 403 and choose is never called"; "a POST from another origin is refused 403"; "an over-long or wrongly typed body is refused 400"; each row of the table above (`it.each`); "Move restarts only after the answer is written"; "the log line names no person" (assert the logged fields' keys are exactly `choice`, `attemptId`, `units`); "with the real choose and the shared fixture, Keep answers the kept title". Today the route answers 404.
- [ ] **Step 2:** `pnpm --filter @waitron/server exec vitest run src/recovery-start-again.test.ts` — FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** PASS; typecheck. **Step 5:** commit `git commit -s -m "The recovery page's Start again route takes the administrator password and the choice over HTTPS only (A1098)"`.

### Task 8b: Wiring the route into the page and both entries

**Files:** modify `apps/server/src/recovery-surface.ts` (`renderPage` inserts the section, `recoveryApp` mounts the route when `startAgain` is present), `apps/server/src/node-entry.ts:394-421`, `apps/server/src/first-setup-launch.ts:112-128`; tests in `apps/server/src/recovery-start-again.test.ts` and `apps/server/src/recovery-surface.test.ts` (new cases only).

- [ ] **Step 1: Failing tests:** "recoveryApp with startAgain draws the section between the action and Retry, and mounts the route"; "recoveryApp without startAgain answers the route 404 and draws no section"; "after Keep, GET / shows the kept page and no form" (through `recoveryApp`); "the supervised entry passes the survey and its exit as onFinished"; "the direct entry passes the survey and requestRestart as onFinished" (each through the entry's existing test seams).
- [ ] **Step 2:** `pnpm --filter @waitron/server exec vitest run src/recovery-start-again.test.ts src/recovery-surface.test.ts` — FAIL on the new cases.
- [ ] **Step 3:** Implement; both entries pass `startAgain` when `admission.survey` is present, with `onFinished` = the same exit (`node-entry.ts`) or `requestRestart` (`first-setup-launch.ts`) their Retry uses.
- [ ] **Step 4:** PASS; then `pnpm --filter @waitron/server exec vitest run src/recovery-surface.test.ts src/first-setup-entry.test.ts src/first-setup-resolution.boot.test.ts`; typecheck.
- [ ] **Step 5:** Commit; `git commit -s -m "The recovery page offers the Start again choice in both entry modes (A1098)"`.

### Task 9: End to end over the real HTTPS listener, both entry modes

**Files:** modify `apps/server/src/first-setup-resolution.boot.test.ts` (new cases; its `startIn(mode, …)` and `overHttps` helpers, `:384-460`; add a POST helper that sends a form body with the same CA; add a new box kind `"found"` to `startingBox` built with `startAgainAttempt` plus the TLS files and a `venue.db` after the marker — the existing kinds and the `"unlisted"` box stay as they are).

- [ ] **Step 1: Failing tests,** `it.each(MODES)` on the `"found"` box:
  - "the owner's example: the page lists venue/venue.db and asks for the administrator password, in English and Spanish";
  - "Keep: the kept page, the record on disk, and the next start serves the kept page with no form";
  - "Move: the answer, one restart, the next start serves setup, venue.db is at state/first-setup-set-aside/<stem>/venue/venue.db with its original bytes, and the note's floor is raised" (box made with the fixture's `note`);
  - "a page opened before a file changed cannot act: change venue.db's bytes, POST the old digest, get filesChanged, and every file is unchanged";
  - "six wrong passwords, Retry, a new start: the seventh try still waits" (Review Focus 3).
  - Today the POST answers 404.
- [ ] **Step 2:** `pnpm --filter @waitron/server exec vitest run src/first-setup-resolution.boot.test.ts` — FAIL on the new cases.
- [ ] **Step 3:** Fix only what the cases show; no production change is expected beyond Tasks 6–8b.
- [ ] **Step 4:** PASS, the existing `"unlisted"` case (`:594-630`) unedited. **Step 5:** commit `git commit -s -m "Keep and Move end to end over the box's HTTPS, in both entry modes (A1098)"`.

### Task 10a: A backup recovery after a Move (D10)

**Files:** modify `packages/provisioning/src/first-setup-backup-workspace.ts` (the walk, `:309-322`), `packages/provisioning/src/first-setup-backup-workspace.test.ts` (new cases only), `apps/server/test/first-setup-backup-recovery-fixture.ts` (an optional `prepareBox?: (roots) => Promise<void>` parameter to `fixture()`, run after `archiveHost()` and before the claim), and create `apps/server/src/first-setup-set-aside-lifetime.test.ts`.

- [ ] **Step 1: Failing tests.**
  - In `first-setup-backup-workspace.test.ts`: "a set-aside folder is not one of the box's originals": `createFirstSetupBackupWorkspace(roots).inspect(id)` gives the same digest before and after a file is added to, or rewritten under, `<state>/first-setup-set-aside/` and `<venue>/first-setup-set-aside/`. **Control in the same case:** a file added beside it in the state folder changes the digest. Also "an unreadable file in the set-aside folder does not stop inspect" (mode `000`; today it rejects `EACCES` — "Current behaviour").
  - In the new lifetime file: "recover from a backup after a Move". `fixture(true, { prepareBox })`, where `prepareBox` runs `startAgainAttempt` on the roots, places a `venue.db` and a `node.db` after its marker, chooses Move through `chooseStartAgainLeftovers`, then sets one moved file to mode `000`. Then `preparedRepair`'s steps (`service.open`, then `service.prepare`, `apps/server/test/first-setup-backup-recovery-fixture.ts:122-128`) record a `prepared` record. The set-aside folder's files keep their bytes and inodes, and no file under the recovery's `evidence/` has the bytes of a moved file.
- [ ] **Step 2:** `pnpm --filter @waitron/provisioning exec vitest run src/first-setup-backup-workspace.test.ts` and `pnpm --filter @waitron/server exec vitest run src/first-setup-set-aside-lifetime.test.ts` — FAIL on the new cases.
- [ ] **Step 3:** Implement D10 (one more skipped path per root, named by `START_AGAIN_SET_ASIDE_DIR`).
- [ ] **Step 4:** PASS; then the whole backup suites unedited: `pnpm --filter @waitron/provisioning exec vitest run src/first-setup-backup-workspace` and `pnpm --filter @waitron/server exec vitest run src/first-setup-backup-recovery src/first-setup-start-again-backup.test.ts src/first-setup-backup.lifetime.test.ts`, each `Tests` count read; typecheck.
- [ ] **Step 5:** Commit; the message states the deletion control: with D10's skip removed, the lifetime case fails on `EACCES`. `git commit -s -m "A backup recovery after a Move leaves the set-aside folder out of its check of the box's files (A1098)"`.

### Task 10b: Nothing sweeps the moved files; a full disk changes nothing

**Files:** modify `apps/server/src/first-setup-set-aside-lifetime.test.ts` (new cases); modify `apps/server/src/start-full-disk.e2e.test.ts` (one new case in this file: CI runs it alone with the small disk, `.github/workflows/ci.yml:1094-1104`, and excludes it from the shards, `:995`; a new full-disk file would run in the shards without a disk and fail, `apps/server/src/testing/full-disk.ts:15-16`).

- [ ] **Step 1: Failing tests** — "lifetime" cases, each starting from a box after a real Move (shared fixture plus Task 5b's path), each asserting the set-aside folder, the choices folder and the note are byte-identical and the same inodes afterwards:
  - the next first setup claims (`kind: "normal"` at the start, then a claim through the provisioning store);
  - `clearReplacedDatabases` and `freeSpaceAtStart({ force: true, … })`;
  - that setup's own Start again (A1042's actions);
  - a restore placement (`restoreDatabase`).
  - "the next setup's name is later than the raised note" (A1042's chooser case, `first-setup-start-again-note.test.ts:180-250`, with the box after a Move whose found file's time sets the floor).
  - In `start-full-disk.e2e.test.ts`: "a Move on a full disk: the guess counter cannot be written, so the password is not checked, nothing is recorded or moved, and the page says the disk is full with its next step" (D4 "A full disk"; assert the `diskFull` text and that the choices folder is absent).
  - These pass or fail on what Tasks 4a–8b built. A lifetime case that passes at once is still kept, and its failing control is stated in the commit message: delete the set-aside name from `FIRST_SETUP_HOST_FILES`, and the restore case must fail.
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

- [ ] **Step 1: The guide paragraph.** English: "If a Start again was cut off and the box then finds files that Start again did not create, such as a venue copied from a backup, the box does not start. Its page lists the files and asks for the administrator password you chose during setup. **Keep everything and stop** leaves every file as it is, and the page then stays until Waitron is reinstalled. **Move these files aside and finish Start again** moves the files, unchanged, into a new folder on the box and finishes Start again; the box then starts a new first setup. If the files change after the page opens, the box refuses the choice and changes nothing: press **Retry a normal boot** to see them again. After five wrong passwords the page makes you wait before the next try, never more than 15 minutes." Spanish: «Si un «Empezar de nuevo» se interrumpió y después el equipo encuentra archivos que «Empezar de nuevo» no creó, como un local copiado desde una copia de seguridad, el equipo no arranca. Su página muestra los archivos y pide la contraseña de administrador que elegiste al configurar. **Conservarlo todo y parar** deja todos los archivos como están, y la página sigue hasta que se reinstale Waitron. **Apartar estos archivos y terminar «Empezar de nuevo»** mueve los archivos, sin cambios, a una carpeta nueva del equipo y termina «Empezar de nuevo»; después el equipo empieza una configuración inicial nueva. Si los archivos cambian después de abrir la página, el equipo rechaza la elección y no cambia nada: pulsa **Reintentar un arranque normal** para verlos de nuevo. Después de cinco contraseñas incorrectas, la página te hace esperar antes del siguiente intento, nunca más de 15 minutos.» If Q5 was answered other than A, the last sentence follows the answer.
- [ ] **Step 2: conventions-ui.md**, a paragraph "**A Start again cut off with files it did not create** (A1098)":
  - the four outcomes and codes;
  - the form only for `setup.start_again_files_found`, only over TLS;
  - the persisted counter and its policy (D6);
  - the digest binding;
  - the record and where it lives;
  - the set-aside folder, its probe, and D10's skip in the backup recovery's walk;
  - the note floor a Move raises (Q3);
  - the one removal sentence, as the owner's exception (2026-10-25 15:24), with its guard, which is weaker than its name (it reads the two text tables, not the rendered page);
  - the found paths and the set-aside folder name added to "Strings on the page that come from outside the image".
- [ ] **Step 3: CLAUDE.md**, appended to the recovery page bullet: "Its one form, for `setup.start_again_files_found`, takes the administrator password over HTTPS only; its Move choice is the owner's one exception to never suggesting a removal (A1098). Guard: the never-delete cases in `apps/server/src/recovery-surface.test.ts`, weaker than their name: they read the text tables, not the page."
- [ ] **Step 4: Operations and backlog.**
  - `first-live-fiscal-setup.md`: after "or refuses with a page that says what to do", one sentence naming the Keep and Move choices.
  - Backlog: in `setup.md`'s entry, replace "Follow-up: A1098 covers files the box did not create…" with what A1098 built and what stays a manual loop (a file the box created that cannot be deleted); the same in the `backlog.md` index line.
  - New short entries (with `docs/backlog/setup.md` detail) for each point left open:
    - Q2's boxes get only the explanation (if answered A);
    - moved-aside files have no in-app way back (Recover from backup takes only a backup file, a bucket or Waitron Cloud);
    - after Keep, the box stays on its page even if the files are later removed by hand;
    - a Move on a box with no note raises no floor until A1099's "name unknown" note exists (Q3);
    - a piece below a root on another mount fails after the record, and the box then shows the explanation until the mount is changed (D4);
    - **from A1042, predating this branch** (`git blame`: e2a957138, #2101; "Current behaviour" `12a`/`12b`): (1) the finisher removes, by `rmdir`, an empty folder the box did not create, because an empty unlisted folder produces no finding (`first-setup-start-again-deletion.ts:290-291,477`); (2) a stray `venue.db-journal` beside an unchanged marked `venue.db` is neither a finding nor deleted, so it stays beside the next setup's database (`:35`, where the side files are `-wal` and `-shm` only).
- [ ] **Step 5: Checks.** `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts`; `pnpm exec vitest run scripts/guide-links.test.ts scripts/claude-md-pointers.test.ts`; `pnpm format:check` (`CLAUDE.md` is format-checked; `docs/` is ignored — `pnpm exec prettier --file-info <file>` tells which). Commit `git commit -s -m "Guides, conventions and backlog for the recovery page's Keep or Move choice (A1098)"`.

### Task 13: Final qualification and PR notes

- [ ] **Step 1: Focused suites,** each with its `Tests` count read:
  - `pnpm --filter @waitron/provisioning exec vitest run src/first-setup-start-again-findings.test.ts src/first-setup-start-again-leftovers.test.ts src/first-setup-start-again-choice.test.ts src/first-setup-start-again-guesses.test.ts src/first-setup-start-again-set-aside.test.ts src/first-setup-start-again-choose.test.ts src/first-setup-start-again-deletion.test.ts src/first-setup-start-again-note.test.ts src/first-setup-state.test.ts src/first-setup-backup-workspace.test.ts`
  - `pnpm --filter @waitron/server exec vitest run src/recovery-surface.test.ts src/recovery-start-again.test.ts src/first-setup-entry.test.ts src/first-setup-resolution.boot.test.ts src/first-setup-set-aside-lifetime.test.ts src/first-setup-start-again-note.test.ts src/first-setup-workspace.test.ts src/recovery-state.test.ts src/guide-content.test.ts`
  - `pnpm exec vitest run scripts/native-form-fields.test.ts scripts/english-only.test.ts scripts/personal-log-params.test.ts scripts/errors-reachable.test.ts scripts/claude-md-pointers.test.ts scripts/guide-links.test.ts scripts/waitron-sh.test.mjs`
  - `pnpm --filter @waitron/provisioning typecheck && pnpm --filter @waitron/server typecheck && pnpm format:check`
- [ ] **Step 2: Fiscal gates, unedited:** `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts` and `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad`; `git diff --stat ef4322c82 -- packages/fiscal-verifactu` prints nothing.
- [ ] **Step 3: Look at it** (`CLAUDE.md` §4: a string-rendered page has no harness). A script outside the worktree (as A1042's `~/waitron-campaign/a1042-l1-shots/render.ts`, run with `pnpm exec tsx`, Playwright resolved from `apps/server`) renders `recoveryApp` for: the choice page with the owner's example (secure, both languages, once with `moveFloor` showing), the same with `wrongPassword` + `forgotten`, `throttled`, `filesChanged`, `diskFull` and `moveUnavailable`, the page over plain HTTP, the kept page, and the `moved` answer. Screenshot each at 375 px and 1280 px wide, with `colorScheme: "light"` and `"dark"`. Open the images and check: the list, the field, both choices and Continue are readable and nothing overflows at 375 px; each message sits where Task 7 puts it. Name the images in the commit message.
- [ ] **Step 4: PR notes** (for `/finish-branch`):
  - the owner-approved exception: the one sentence `moveDetail`, in English and Spanish, and the guard that names it;
  - every new string ("Words for the owner's approval") for approval, with the revision 2 rows marked;
  - the answers, or the defaults used, for Q1–Q3 and Q5–Q6, and that Q4 was withdrawn with no assertion changed;
  - **Q3:** the note floor a Move raises, and its two limits (no note: nothing raised; a far-future file time holds names off until then);
  - **Q6:** a moved trading venue's records not yet sent to AEAT stay unsent;
  - **D10:** a backup recovery no longer reads or copies the set-aside folder;
  - a plain reset now keeps the choices and the moved files, so their disk space comes back only with `reset --all` (D9);
  - the page lists at most 50 top-level paths, so a person may agree to move files they did not see on the page;
  - the binding uses metadata (inode, size, time), not contents, so a change that keeps all three is not seen (D2);
  - the probe tests the root folders only (D4);
  - a piece changed between a cut and the next start can split a Move across two folders (D4);
  - A1042's two behaviours now in the backlog (Task 12 Step 4);
  - Review path FULL, label `needs-owner-review`.
- [ ] **Step 5:** Tell the driver the branch is ready for `finish-branch`.

## Self-review

- **Owner's requirements → tasks:**
  - password form, checked against the setup's named administrator: D6; Tasks 5a, 7, 8a;
  - a limit on wrong guesses that survives a restart and never locks the owner out for good: D6, Q5; Tasks 3, 9;
  - a secure connection, answered from the code: Current behaviour; D7; Task 8a;
  - the two choices doing what they say: Tasks 5b, 9;
  - nothing moved before a recorded choice: D4, D5; Task 5b;
  - a page that showed another list is refused, with nothing changed: D3; Tasks 5a, 9;
  - the record of who, when, what and which files, surviving the move: D5; Tasks 3, 5b, 10b;
  - setup record gone or changed → explanation and reinstall line only: D1; Tasks 2, 6;
  - where the files go, never overwriting, rename not copy, full disk, never swept: D4, D9, D10; Tasks 4a, 4b, 10a, 10b, 11;
  - finishing through A1042's finisher: D4; Tasks 4a, 5b, 10b;
  - series names protected after a Move: Q3; Tasks 2, 4a, 4b, 10b;
  - locks: Global constraints, D4; Task 4a;
  - words in both languages: Words; Tasks 7, 12;
  - guides: Task 12;
  - personal data: Global constraints; Tasks 5b, 8a;
  - codes in the registry: Tasks 2, 3, 4a, 5a;
  - the never-delete exception narrow and named: D8; Task 7;
  - recover from a backup after a Move, as the Move text promises: D10; Task 10a.
  - No alert code: nothing is recorded as an incident.
- **Names used across tasks,** each defined once, in the task named: `startAgainAttempt`, `START_AGAIN_ADMIN_PASSWORD`, `START_AGAIN_ADMIN`, `StartAgainFinding`, `collectStartAgainFindings`, `StartAgainSurvey`, `StartAgainUnit`, `startAgainSetAsideFloorMs`, `surveyStartAgainLeftovers`, `classifyStartAgainRefusal`, `StartAgainChoiceRecord`, `writeStartAgainChoice`, `readStartAgainChoices`, `assertStartAgainNotKept`, `beginStartAgainGuess`, `setAsideDestinations`, `prepareSetAside`, `moveStartAgainUnits`, `resumeStartAgainSetAside`, `chooseStartAgainLeftovers`, `renderStartAgainSection`, `mountStartAgainChoice`, `START_AGAIN_PAGE_TEXT`, `RecoveryDeps.startAgain`.
- **Claims:** the runs are named in "Current behaviour" with what each printed; everything else there is marked read. Revision 2's replacement claims were checked by running where they describe behaviour:
  - Q4's withdrawal and the fixture's shape: the throwaway test;
  - D8's patterns: the `node` run;
  - D10's premise: the `inspect` probe, with the holder-file control;
  - the two A1042 behaviours: the probe and `git blame`.
  - The `EXDEV` premise is the Linux man page's own words, not run here: no Linux machine with two mounts of one disk was at hand.
  - Not run, and so stated where used: that a rename into a new folder may need a block (D4 "A full disk"); the readers of the note's `lastName` (a grep, Q3).
