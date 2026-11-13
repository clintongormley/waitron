# A1308 environment, PR 5 of 8: backups are configured only on the dashboard — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The environment can no longer configure backups or lock the Backups screen. The dashboard's
record is the only source of destinations, schedule and retention; compose and `.env` stop passing
the backup folder and key; compose passes `WAITRON_CLOUD_ORIGIN`; the practice email inbox (Mailpit)
is not started on a production box.

**Architecture:** Today, setting any of nine `WAITRON_BACKUP_*` variables in the real environment
makes backups "managed by environment": destinations and schedule then come from variables and the
dashboard refuses changes (`apps/server/src/backup-config.ts:112-128,276-347`). That whole branch is
deleted, with the `managedByEnvironment` flag that carries it to the backup supervisor, the API, the
start's backup room and the screen. The recovery key stays where it is: in `backup.env`, read
through the box's env files. Mailpit moves into a compose profile that `waitron.sh` switches on in
`.env` unless the box is stamped production.

**Tech Stack:** TypeScript, bash, Docker Compose, Lit, Vitest.

**Spec:** [`environment.md`](../specs/2026-11-02-rationalisation/environment.md) §1 E6, §3 rows
`WAITRON_BACKUP_*`, `WAITRON_CLOUD_ORIGIN`, §4 "Data loss";
[`files.md`](../specs/2026-11-02-rationalisation/files.md) §3 (":165-167") and rows 73–74;
[`jobs.md`](../specs/2026-11-02-rationalisation/jobs.md) mapping row "Practice email inbox
(Mailpit)" (`:463`) and J5 (`:609-611`); [README](../specs/2026-11-02-rationalisation/README.md) §7.
Rules: [the slice rules](2026-11-08-a1308-slice-rules.md). Part overview:
[env1](2026-11-08-a1308-env1-tuning-constants.md).

**Needs:** nothing in this part. 4b landed (it moved `MIN_PASSPHRASE_LENGTH` into
`backup-config.ts`, which this plan keeps). Cites read at `a086eedfb7`.

**Coordination with the job runner and the one backup service (batch 3).**
[jr8](2026-11-08-a1308-jr8-backups-on-the-runner.md) moves backups onto the runner and says it works
before or after env5/env6 (`:32`, `:68`); the one-backup-service part restructures the same files
(`backup-config.ts`, `backup-supervisor.ts`, `archive-settings.ts`, `backup-api.ts`). This plan and
env6 change where settings come from, not how backups run. Land env5 and env6 before the
backup-service part's first pull request starts; if jr8 or a backup-service pull request is in
flight on these files, stop and ask the watcher which goes first (rules §5.5).

**Owner lands:** no. Backups copy the venue's data but do not write a sale, an invoice number, a
fiscal record or a hashed value. Read, not run.

**No venue reset.** But: a box configured through `deploy/.env` (`WAITRON_BACKUP_DIR` with
`WAITRON_BACKUP_RECOVERY_KEY`, `compose.yml:37-38`) stops backing up after this lands, silently,
until its owner sets backups on the dashboard. The owner accepted that before go-live
(environment.md §4 "Data loss"). The pull request's first line says: "A box whose backups were set
in `deploy/.env` stops backing up until they are set on the Backups screen."

## Global Constraints

- No refusal for a retired name and no carry-over code (environment.md §1; CLAUDE.md §3).
- The recovery key keeps its one home, `backup.env`, and its rotation date stays there until A1323
  (environment.md §3 rows `WAITRON_BACKUP_RECOVERY_KEY`, `WAITRON_BACKUP_KEY_ROTATED_AT`).
- The stale threshold becomes the constant two days (`backup-config.ts:50`'s value).
- `waitron.sh` fails closed: when it cannot tell whether the box is production, it treats it as
  production (its `is_production`, `deploy/waitron.sh:573-650`), which here means Mailpit stays off.
- Every apt-get, timeout and retry rule for `waitron.sh` is unchanged (CLAUDE.md §2); this plan adds
  no network call.

## Review Focus

1. A box whose dashboard record is switched off must still report its key state without a key
   (`backup-config.ts:324-325`); deleting the environment branch must not make a switched-off record
   require a key.
2. The start's backup room (`apps/server/src/start-backup-room.ts:120-145`) skipped when "management
   changed" between the note and the start; with one source that check goes, and a note written
   before this lands (it carries `managedByEnvironment`) still reads as a note: ignore that extra
   key and keep validating its folders (`backup-room-note.ts:182`). This follows Task 1's specific
   case, confirmed by the watcher in Lane H's questions.md on 2026-11-13 at 01:30.
3. A Demo box installed before setup has no `trading.env`: `is_production` reads it as not
   production, so Mailpit starts, as a Demo box needs.
4. A Live box set up after install keeps Mailpit running until the next `waitron.sh install`, update
   or reset, which then stops and removes it. Stated in `deploy/README.md`.
5. `docker compose up -d` run by hand (`deploy/README.md:204`) must start Mailpit on a Demo box too:
   `COMPOSE_PROFILES` lives in `.env`, which compose reads itself.

---

## What it builds

1. `backup-config.ts` has one source: `resolveBackupConfig({ env, sealed, venueId })`, the dashboard
   record plus the recovery key and its date from the box's env files. `BackupConfig.source` goes.
2. `WAITRON_BACKUP_DIR`, `WAITRON_BACKUP_DESTINATIONS`, `WAITRON_BACKUP_SCHEDULE_DAYS`,
   `WAITRON_BACKUP_AT`, `WAITRON_BACKUP_INTERVAL_MS`, `WAITRON_BACKUP_RETAIN`,
   `WAITRON_BACKUP_RETAIN_DAYS`, `WAITRON_BACKUP_DESTINATION_TIMEOUT_MS` and
   `WAITRON_BACKUP_STALE_AFTER_MS` are read nowhere.
3. `managedByEnvironment` disappears from the supervisor's status, `GET /api/backup/status`, the
   settings evidence, the recovery-pack checks, the backup-room note and every dashboard screen; the
   code `backup.managed_by_environment` and the strings `stream.error.managed_by_environment` and
   `stream.error.recovery_key_too_short_managed` are deleted.
4. Compose passes neither backup name and passes `WAITRON_CLOUD_ORIGIN: ${WAITRON_CLOUD_ORIGIN:-}`;
   `.env.example` loses the backup block and gains an optional Cloud origin line.
5. Mailpit runs under the compose profile `practice-inbox`; the app no longer depends on it;
   `waitron.sh` writes `COMPOSE_PROFILES=practice-inbox` to `.env` on a box that is not production,
   and removes the line and the container on one that is.

## What it leaves out

| Left out | Who takes it |
| --- | --- |
| Archive and bucket-copy settings leaving the sealed credentials for the `backup` document | env6 |
| The rule that a real-environment value beats `backup.env` (`box-env.ts:28-31`) | kept, by neither plan: env7 keeps it because about 240 test files and the Cloud fixture pass box-file names through the environment. On a box the key now has one home anyway, because compose no longer passes it (this plan) |
| Mailpit's message cap (`files.md` row 71) | the file-layout part |
| One backup service with backends | the backup-service part |

## Interfaces

```ts
// apps/server/src/backup-config.ts
export const BACKUP_STALE_AFTER_MS = 2 * 24 * 60 * 60 * 1000;
export interface BackupConfig { /* as today, minus `source` */ }
export function resolveBackupConfig(input: { env: Env; sealed: ArchiveSettings | null; venueId: string }): BackupConfig | undefined;
export function archiveDestinations(sealed: ArchiveSettings | null): BackupDestination[];
export function loadBackupSettings(input: { env: Env; venueId: string } & SealedReader): Promise<BackupConfig | BackupConfigUnusable | undefined>;
// kept unchanged: checkedRecoveryKey, loadRecoveryKey, mintRecoveryKey, readHeldKey, loadKeyRotatedAt,
// DEFAULT/MIN/MAX_DESTINATION_TIMEOUT_MS (archive-settings.ts imports the last two)
```

**13 November 2026, watcher 03:45: review corrections supersede the placement below.**
"First install: select the image for the requested ref before any production read. Treat an
install as fresh only when compose.yml is absent AND no state volume exists; a failed docker
volume ls counts as not fresh (fail closed)." Fresh installs and resets select the inbox before
image selection; existing installations select the requested image before the new profile decision.
The existing reset confirmation still checks the installed box before changing it. `install --reset`'s image
availability check stays before the wipe; a plain source install keeps its existing image-check behavior.
Compose's own environment parser decodes profile values, then the comma-list selector trims spaces.
The USB recipe writes the profile, and upgrade config/stop includes it; upgrade restart adds an explicit inbox profile
only when its captured running-service image map includes Mailpit. Otherwise Compose uses the profiles
from the installed environment. These fixes follow the watcher's
"USB inbox and profile ... must work with the new profile" instruction; no installer or upgrade flow is added.

`deploy/waitron.sh` gains `select_practice_inbox <on|off|decide>`. It reads `.env`'s
`COMPOSE_PROFILES` line (comma-separated), adds or removes only the entry `practice-inbox`, keeps every
other entry an operator set (for example `staff-tunnel`), and writes the result with the script's
existing `env_set` (or `env_unset` when nothing is left; both at `:191-195`). With `off` it also runs
`docker compose -f "$WAITRON_DIR/compose.yml" rm -sf mailpit`. `decide` means `off` when
`is_production` (`:585`) answers production, else `on`. It runs **before anything decides which
images to pull**, because `docker compose pull` in `select_image` (`:405`) and `config --images` in
`ensure_images_present` (`:446-456`) both honour `.env`'s profiles: so the first install that turns
the profile on pulls Mailpit's image before anything is taken down, and "nothing was taken down or
wiped" (`:448`) still holds when that pull fails. Placement: in `cmd_install`, just before
`select_image "$ref"` (`:742`), with `on` when `--reset` is given (the wipe leaves the box
unprovisioned) and `decide` otherwise; in `cmd_reset`, `on`, before `wipe_box` (`:825`), for the
same reason. `wipe_box`'s `down` (`:792`) becomes
`COMPOSE_PROFILES=staff-tunnel,practice-inbox docker compose down --remove-orphans`, so a running
Mailpit is stopped with everything else.

## Files

- Modify: `apps/server/src/backup-config.ts:19-347,375-401`; `apps/server/src/backup-supervisor.ts:82,380,403`;
  `apps/server/src/backup-api.ts:91,297,451`; `apps/server/src/backup-settings-evidence.ts:144,239,251`;
  `apps/server/src/backup-recovery-pack-api.ts:126,219-221`; `apps/server/src/start-backup-room.ts:120-145`;
  `apps/server/src/backup-room-note.ts:23,78,100,182,200`; `apps/server/src/boot.ts:396,2836-2869,3354`;
  `apps/server/src/errors.ts` (`backup.managed_by_environment`, `backup.schedule_invalid` and
  `backup.destinations_invalid` if nothing else throws them after the deletion — `scripts/errors-reachable.test.ts`
  tells you).
- Modify (dashboard): `apps/dashboard/src/api/client.ts:1773-1774,2066`;
  `apps/dashboard/src/screens/backup-screen.ts:443,595,921,1241,1319,1331`;
  `apps/dashboard/src/screens/stream-settings-panel.ts:92,197,467-470`;
  `apps/dashboard/src/widgets/backup-settings-evidence.ts:334,362`;
  `apps/dashboard/src/i18n/strings.ts:2140,6006` (and the `_managed` key), `codes.ts:1060`;
  `apps/dashboard/src/testing/backup-settings-evidence-fixture.ts:25`.
- Modify (deploy): `deploy/compose.yml:18-20,34-38` and the `mailpit` service (`:84-101`);
  `deploy/.env.example:37-42`; `deploy/Dockerfile:239-241` (the comment); `deploy/waitron.sh`;
  `deploy/README.md:28,204` and its backup section.
- Tests: every file `git grep -l -E "WAITRON_BACKUP_(DIR|DESTINATIONS|SCHEDULE_DAYS|AT|INTERVAL_MS|RETAIN|RETAIN_DAYS|DESTINATION_TIMEOUT_MS|STALE_AFTER_MS)\b|managedByEnvironment|managed_by_environment|isBackupManagedByEnvironment" -- apps packages scripts`
  prints (about 30 at `a086eedfb7`; the largest are `backup-config.test.ts`,
  `stream-settings-panel.test.ts`, `backup-api.route.test.ts`, `start-backup-room.test.ts`,
  `backup-room-note.test.ts`, `backup-recovery-pack-parts.test.ts`); `scripts/waitron-sh.test.mjs`;
  `scripts/deploy-image-env.test.ts:210-214`; `scripts/dev-email.test.ts`.
- Docs: `docs/developers/aws-backup-rehearsal.md`, `docs/developers/authorised-cloud-restore-fixture.md`,
  `docs/developers/conventions-data.md`, `apps/server/README.md`, `apps/server/src/guide/en/backup-recovery.md`
  and its Spanish twin if they mention the environment source; `docs/backlog/box.md:2101` (drop the
  two variable names from that entry's list of settings; the entry itself stays open).

## Size

Counted, hand-written: about 185 lines of code (server 90, dashboard 30, compose and `.env.example`
20, `waitron.sh` 45) and about 350 lines of tests (re-pointed server suites 180, `waitron.sh` cases
and stub 130, deploy and dashboard guards 40). Not counted: the deleted environment branch and its tests (about
600 lines). About 3 hours.

## Finish line

1. `git grep -n -E "WAITRON_BACKUP_(DIR|DESTINATIONS|SCHEDULE_DAYS|AT|INTERVAL_MS|RETAIN|RETAIN_DAYS|DESTINATION_TIMEOUT_MS|STALE_AFTER_MS)\b|managedByEnvironment|managed_by_environment" -- . ':!docs/superpowers' ':!apps/server/src/backup-config.test.ts' ':!apps/server/src/backup-room-note.test.ts'`
   prints nothing (the two excluded files name retired names on purpose, in Task 1's "is not a
   backup", "stale after two days" and "an old note" cases), and `git grep -n WAITRON_BACKUP_RECOVERY_KEY -- deploy` prints nothing.
2. `pnpm --filter @waitron/server exec vitest run src/backup-config.test.ts src/backup-api.route.test.ts src/backup-api.settings-evidence.test.ts src/backup-supervisor.test.ts src/backup-recovery-pack-parts.test.ts src/backup-recovery-pack-api.make.test.ts src/start-backup-room.test.ts src/backup-room-note.test.ts src/stream-api.route.test.ts`
   and `pnpm --filter @waitron/dashboard exec vitest run src/screens/backup-screen src/screens/stream-settings-panel src/widgets/backup-settings-evidence src/api/client.test.ts src/i18n/codes.test.ts`
   each print a `Tests` count with no failure.
3. `pnpm exec vitest run scripts/waitron-sh.test.mjs scripts/deploy-image-env.test.ts scripts/dev-email.test.ts scripts/errors-reachable.test.ts`
   passes.
4. `docker compose -f deploy/compose.yml config --services` lists `app` and `print-agent` but not
   `mailpit`; with `COMPOSE_PROFILES=practice-inbox` it lists `mailpit` too.

## Expected protection-list difference

EQUAL. Any line is a stop.

## Stop points (beyond rules §5)

**Current-base correction, 2026-11-13.** The watcher cleared refreshing the protection baseline
after the rebase onto `f46da9fc0e` (#3021) at 03:25. The exact-base/candidate comparison is EQUAL.

**Current-base correction, 2026-11-13.** Handover's quote-mark reader control now uses the retained
recovery key and expects `backup.recovery_key_too_short`, with its digest assertions kept. The
watcher cleared this on 13 November at 03:10; its other empty-value controls use the retained key
and rotation stamp. The resolver no longer needs `venueId` after 5f removed its use, so no unused
argument is added.

**Current-base correction, 2026-11-13.** The watcher cleared the newer `loadBackupConfig` callers
in `backup-data-placement.ts:72` and `backup-verification-secrets.ts:92`, and the environment-only
scratch guard in `node-entry.ts:348-352`, as consumers of this removal (Lane H questions.md, 01:30).
Port these in this slice, keeping their behaviour checks. The recovery-key checks remain.

1. A behaviour suite that set a variable to configure backups asserts something the dashboard record
   cannot express (for example `WAITRON_BACKUP_INTERVAL_MS` below the record's smallest interval):
   stop; do not loosen the record's checks.
2. image-smoke brings the box up with a plain `docker compose up -d --wait` (`.github/workflows/image-smoke.yml:196-197`)
   and sets no `COMPOSE_PROFILES`; this plan keeps it that way, so the smoke runs without Mailpit,
   which nothing in it reads now that the app does not depend on Mailpit. If image-smoke fails
   because a step waits on or reads Mailpit, stop and ask.

---

### Task 1: one source for backup settings

**Files:** server files in **Files**, their tests.

- [ ] **Step 0:** record the base protection list (rules §3).
- [ ] **Step 1: Re-point the tests first.** A case that put destinations or a schedule in the
  environment to get a running backup instead saves a dashboard record with
  `writeArchiveSettings(tx, ring, archiveRecord({...}))` (`archive-settings.ts:334-350`) in its
  set-up and keeps its assertions (rules §4). A case whose subject is the environment source itself —
  parsing the nine variables, the environment winning over the record, the dashboard refusing
  `backup.managed_by_environment`, the backup room's `management_changed` skip, an evidence answer
  saying "managed by environment" — is deleted and named in the pull request. Add these cases:
  - `backup-config.test.ts`: `"a destination in the environment is not a backup"` —
    `resolveBackupConfig({ env: { WAITRON_BACKUP_DIR: "/x", WAITRON_BACKUP_RECOVERY_KEY: KEY }, sealed: null, venueId })`
    is `undefined`; `"a switched-off record needs no key"` — a record with `enabled: false` and no
    key resolves with `recoveryKey: undefined`; `"stale after two days"` — `staleAfterMs` is
    `BACKUP_STALE_AFTER_MS` (172 800 000) whatever `WAITRON_BACKUP_STALE_AFTER_MS` says.
  - `backup-room-note.test.ts`: `"an old note with managedByEnvironment reads as a note"` — the
    parser ignores the extra key (the other fields still validate), so the backup room still runs;
    control: a note missing `folders` still reads as null.
- [ ] **Step 2: Run** finish line 2's server command; the new cases fail.
- [ ] **Step 3: Implement.** Delete the environment branch and `managedByEnvironment` everywhere in
  **Files**; `boot.ts:2840-2869` keeps `readRecoveryKey` and builds `loadBackupSettings({ env: await loadBoxEnv(base, config.stateDir), readSealedWithMeta, venueId })`.
  The backup-room note stops writing the field and `:182` no longer requires it.
- [ ] **Step 4: Run** finish line 2's server command and `scripts/errors-reachable.test.ts`; pass.
- [ ] **Step 5: Commit:** `git commit -s -m "Backups are configured only on the dashboard (A1308 env5)"`

### Task 2: the screens lose the lock

**Files:** dashboard files in **Files**.

- [ ] **Step 1:** Delete the `managedByEnvironment` branches; the cases that tested the locked state
  are deleted and named; the a11y suites lose their locked-state variants. A case that checked the
  screen is writable on a primary keeps its assertion.
- [ ] **Step 2: Run** finish line 2's dashboard command; pass. **Step 3: Commit.**

### Task 3: compose, `.env` and the practice inbox

**Files:** deploy files, `scripts/waitron-sh.test.mjs`, `deploy-image-env.test.ts`, `dev-email.test.ts`.

- [ ] **Step 1: Failing cases.**
  - `deploy-image-env.test.ts`: `"passes no backup setting and the Cloud origin through compose"` —
    the app service's environment has no `WAITRON_BACKUP_` key and has
    `WAITRON_CLOUD_ORIGIN: ${WAITRON_CLOUD_ORIGIN:-}`; `.env.example` has `# WAITRON_CLOUD_ORIGIN=`
    and no `WAITRON_BACKUP_`; `"starts Mailpit only under the practice-inbox profile"` — the mailpit
    service has `profiles: [practice-inbox]` and the app service has no `depends_on: mailpit`. Delete
    `"does not enable backups…"` (`:210-214`): its subject is a retired name.
  - `waitron-sh.test.mjs`: `"turns the practice inbox on for a box that is not production"` — with
    `WT_TRADING_ENV` holding `WAITRON_ENV=preproduction`, `install` leaves `COMPOSE_PROFILES=practice-inbox`
    in `.env` and logs no `rm -sf mailpit`; `"turns it off and removes it on a production box"` —
    `WAITRON_ENV=production` → no `COMPOSE_PROFILES` line, and the docker log shows
    `compose … rm -sf mailpit` before `up`; `"keeps it off when production cannot be established"` —
    `WT_READ_ERROR=1` → as production; `"a fresh box with no trading.env gets it"` — absent file → on;
    `"keeps an operator's other profile"` — `.env` holding `COMPOSE_PROFILES=staff-tunnel` ends as
    `staff-tunnel,practice-inbox` on a preproduction box and `staff-tunnel` on a production one;
    `"pulls Mailpit before the wipe"` — `install --reset` with the Mailpit image absent from
    `WT_IMAGE_STORE` and `WT_IMAGE_PULL_FAIL` naming it dies with "nothing was taken down or wiped" and
    logs no `down`; `"reset turns it on"` — `reset` on a box whose `.env` had no profile leaves
    `practice-inbox`. For these to notice, the docker stub's `config --images` arm
    (`scripts/waitron-sh.test.mjs:155`) prints `axllent/mailpit:…` only when `COMPOSE_PROFILES`
    contains `practice-inbox`, and its `pull` arm logs the profiles it saw, as `down` does (`:158`).
  - `dev-email.test.ts`: the installed compose still pins the same Mailpit image and `mailpit:/data`.
- [ ] **Step 2: Run; fail. Step 3: Implement** the compose, `.env.example`, Dockerfile comment and
  `waitron.sh` changes per **Interfaces**. Compose's comment above `WAITRON_MANAGEMENT_RP_ID`
  (`:26-31`) keeps its reason; the backup comment (`:34-36`) goes; the Mailpit comment (`:84-86`)
  says it starts only where `waitron.sh` turned the profile on.
- [ ] **Step 4: Run** finish lines 3–4; pass.
- [ ] **Step 5: Docs** per **Files**: `deploy/README.md:28`'s Mailpit row says "Demo, Prepare and
  development boxes; not started on a production box"; the update command at `:204` gains one
  sentence that `.env`'s `COMPOSE_PROFILES` decides whether Mailpit starts; the backup section says
  backups are set on the Backups screen only.
- [ ] **Step 6: Protection list:** nothing. **Step 7: Commit**, then `/finish-branch`.

## Waitron Cloud (Cloud lane, paired pull request)

Cloud's `scripts/test-local-backups.mjs:474-478` writes `WAITRON_BACKUP_DIR=/old-backup-target` into
a venue's `backup.env` to stand for a box's own backup file, then checks that a managed restore does
not inherit `backup.env` (`:1090`). The server already ignores that line; after this plan the name is
retired, and after env7 the start reports it as a name `backup.env` does not own. The Cloud lane
replaces the line with `WAITRON_BACKUP_RECOVERY_KEY=<32 random bytes, base64url>` in a pull request
paired with this one (README §5 U11, "Waitron Cloud"). Nothing else in Cloud reads a retired name
(grep at `d4451d227`). Not paired, nothing breaks; the stand-in just stops resembling a real file.
