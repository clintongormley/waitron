# Backup + recovery-key wizard

**Date:** 2026-09-09
**Status:** design; owner brainstorm answered the scoping questions in §11. **Owner-reviewed:** the
direction is approved (§2 sequencing, demo-skip, the backup policy, keep the env honesty check, spin
out the whole-volume capture). **Fable fresh-context read: DONE** (2026-09-09) — it found three
blockers (the empty-base compose override that made the feature inert; value-based provenance that
could hand back a key decrypting nothing; a passphrase mangled by the env-file round-trip) and several
important corrections; all are folded into the body and logged in §12. The decisions in §9 are the
ones to challenge at PR; §8 is §5-adjacent, so this lands with **owner sign-off at PR**.

**Implements:** the "natural fix" the Priorities item 1 note names (`docs/backlog.md`): a fresh box
takes **no** backups until a human hand-edits `/opt/waitron/.env`, and nothing in the
plug-in-your-phone flow asks for it, so a box is one disk failure from having nothing to restore. The
engine it drives is the landed backup regime — BR-1 storage/fan-out/AES-256-GCM under
`WAITRON_BACKUP_RECOVERY_KEY` (#226), BR-2 the encrypted archive (#228), BR-3 the restore consumer
(#232), BR-4/SP-3d the filing node's fresh-chain restore hook (#248)
([backup-restore-regime](2026-09-04-backup-restore-regime-design.md)).

**Unblocks:** it does not gate other tracks; it closes the recovery hole the container-packaging step
left open (node-containers design §3.1: the box deliberately ships with backups off, fail-closed, so
baking a path could not kill a box on its first restart into trading).

---

## 1. What this is, and its scope

The backup **engine** is built and unchanged in its core: each tick it packs an archive — the
`pg_dump` **plus** the media store and a fixed list of the box's secret/identity files
(`RECOVERY_FILES`: `secrets.env`, `trading.env`, the TLS CA + leaf — so a backup is more than the
database) — encrypts the whole thing once, and fans it out to every configured destination. What is
missing is the way a **non-technical operator turns it on and keeps it healthy** without editing an
env file over SSH —
and, the part that makes a backup a *recovery*, a moment that **mints a strong recovery key and shows
it to the operator** so a copy exists off the box. A key nobody wrote down is not a recovery key: if
the disk dies, the archive it encrypted is unreadable.

This slice adds three things and extends the engine in two small ways:

1. a **`BackupSupervisor`** that owns the backup duty's lifecycle so the config can change **without a
   box restart** (hot-reload) — the same start/stop logic boot runs today, moved behind one object
   both boot and the wizard call;
2. an **authenticated backup admin surface** (routes + UI) on the trading box: see status, turn
   backups on / change where they go, set the schedule and retention **policy**, re-view the current
   recovery key, and rotate it;
3. a **first-run nudge** — the setup done-screen tells the operator the box has no backups yet and
   sends them into the admin surface once they log in; **skipped in demo mode**, which needs no real
   backups.

Engine extensions: a **wall-clock scheduler** (a chosen time of day on chosen days, in the venue's
local timezone) replacing "every N hours from boot", and **age-based retention** added beside the
existing count-based prune (keep at most N *and* nothing older than D days — prune on whichever bites
first), both driven by the new policy step (§3.3); and **capturing `backup.env` and `modules.json`
into the archive** so the backup settings and the enabled-module set survive a restore (§3.2) — an
**optional** companion to the fatal `RECOVERY_FILES` (both can be legitimately absent). The broader
"capture the whole state volume, not a curated list" change is a separate spun-out slice (§10).

**In scope:** `BackupSupervisor` (`apps/server`); a new `backup.env` box-env file and its place in
the env-source precedence (§3.2); the schedule + dual-retention extension to `loadBackupConfig` and
`runBackupSweep`; `mountBackupAdminApi` (authenticated) with the five routes in §3.4; the
recovery-key mint / show-once / override / download / re-view / rotate flow (§3.5); the UI screens and
the first-run nudge (§3.6); capturing `backup.env` and `modules.json` into the archive as optional
entries (§3.2); the `backup.*` error codes the routes reuse and any new ones; tests that prove each
guarantee.

**Out of scope, named (§10):** any backend other than local-fs — S3/Drive stay the later
destination-build task, and the wizard offers only what runs today; **re-encrypting existing archives
on rotate** (rotate warns and keeps the old key valid for old archives, §8); a config export/import
surface (that is the onboarding-mode-3 work, unrelated); changing the restore path (BR-3/BR-4 are
untouched — this slice only makes backups *happen*).

---

## 2. The operator experience, and why one surface

Onboarding today is: blank box → phone → **unauthenticated** setup mode → provision → the box
**restarts into trading** → the admin logs in. Two facts put the backup step **after** that restart,
on the authenticated trading box, not inside the unauth setup wizard:

- the recovery key is a secret, and minting it over the pre-venue unauthenticated surface is a weaker
  posture than doing it as a logged-in admin;
- the owner chose **hot-reload** (no restart to apply), which is only meaningful on a running box.

So there is **one implementation with two entry points**, which is what "both" means here:

- **First-run nudge.** The setup done-screen ends with "Your box is trading — but it has **no
  backups** yet, so there is no way back from a disk failure. Set up backups now." and a link into the
  admin surface. This is a **one-time screen**, suppressed in demo mode (`config.devMode`), where the
  box is disposable.
- **Admin surface.** The same screens are always reachable from the box's admin area to change the
  destination, adjust the policy, re-view the key, or rotate it, whether or not backups were set up at
  first run.

The **ongoing reminder** — the persistent "backups are off / stale" nag that keeps prodding an
operator who skipped — is **NOT a bespoke banner this slice builds**. It belongs in the
**notifications centre, which is not yet built** (owner, 2026-09-09). This slice's job is to make
"backups off" a first-class **reportable state** (box-status already reports backup *staleness*; §3.4
adds the explicit on/off), so the centre reads it when it lands. Until then the first-run nudge is the
only prompt, and skipping leaves the box quietly unprotected — an accepted gap named as a dependency
(§10), not a silent one.

The onboarding step is **skippable** — a local-fs destination needs a directory/volume (an attached
USB, a mounted disk) that an installer may not have on hand at first run — but skipping shows a loud
warning, and the box stays in the reportable "backups off" state the notifications centre will later
surface.

---

## 3. Architecture

### 3.1 `BackupSupervisor` — the hot-reload lifecycle owner

Today boot inlines the whole duty: build the `StorageBackend`s, open a dedicated read pool, probe it
can read the fiscal sources, start `runBackupSweep`, and wire the box-status reader — all at
[boot.ts:1625-1748](../../../apps/server/src/boot.ts). Nothing can change that config short of a
restart. This slice moves that block behind a `BackupSupervisor` that owns it and can rebuild it:

```
class BackupSupervisor {
  async reload(config: BackupConfig | undefined): Promise<void>  // stop current, start new (or stop→off)
  current(): BackupRuntimeStatus                                 // for GET /api/backup/status
  async stop(): Promise<void>                                    // shutdown hook
}
```

`reload` is the one code path that starts or stops the duty. It: aborts the running sweep and awaits
its worker, closes the old dedicated read pool, then — if the new config has a destination — builds
the new backends, opens and **probes** the new read pool (`assertBackupCanReadFiscal`, unchanged),
**takes one backup immediately**, and starts a new `runBackupSweep`, swapping the box-status reader to
the new backends. The immediate tick is not a nicety: today's `runBackupSweep` runs once **before** it
sleeps ([backup-sweep.ts:206-213](../../../apps/server/src/backup-sweep.ts)), and a wall-clock
scheduler that "sleeps to the next fire" (§3.3) would otherwise leave a just-enabled — or just-rotated
(§8) — box with **no archive under the current key** until the next scheduled slot, up to a week away.
So on enable and on rotate, `reload` produces an archive at once. A reload is **latched one-at-a-time**
(like provision) so two concurrent applies cannot race two sweeps onto the same staging dir.

Boot calls `reload(loadBackupConfig(env))` once at startup. This is the **same start behaviour** as
today (build → probe → immediate first dump → loop), now expressed through the supervisor — not a
claim that nothing changed, since the loop's cadence itself changes (§3.3). The apply route calls
`reload` after writing new config.

Only a **singleton primary** runs the duty: a mirror does not back up. `isSingletonPrimary` is a
**boot-time constant** today ([boot.ts:1172](../../../apps/server/src/boot.ts)); the supervisor must
read the **live** singleton-role holder at `reload` (the same holder box-status reads), so a box
**promoted to primary without a restart** can be enabled — otherwise the surface must say "restart
after promotion", which the plan picks (recommendation: read the live holder). `apply`/`rotate` on a
node that is **not** the primary must **refuse** (`backup.not_primary`, 409) rather than write
`backup.env` and silently no-op; `status` on such a node reports "this node does not take backups".

*Cost to reverse:* the supervisor is a refactor of existing boot code plus a `reload`; reverting means
re-inlining. Low.

### 3.2 `backup.env` and the config-source precedence

The wizard persists the backup config to a **new box-env file, `backup.env`**, in the box's state
dir, written atomically with `formatEnvFile` (the writer `writeTradingEnv` already uses). It is added
to `loadBoxEnv`'s file list ([box-env.ts:7](../../../apps/server/src/box-env.ts)) so it survives a
restart, and it is read **after** the existing files but, as with all of them, a **real-environment
value wins** (`{ ...fromFiles, ...base }`).

**A prerequisite this slice must fix first (or the feature is inert on every shipped box).** The
packaged compose passes the three backup vars as `${VAR:-}`
([compose.yml:40-42](../../../deploy/compose.yml)), so on a box with none set in the host shell they
render as **empty strings** in the container environment — and `{ ...fromFiles, ...base }` lets that
empty base value **override** the file, after which `isUnset("")` is true
([env-value.ts:15](../../../apps/server/src/env-value.ts)) and `loadBackupConfig` returns `undefined`:
backups off, whatever the wizard wrote. The house's own doctrine is that `""` **is** unset
everywhere ([env-value.ts:1-14](../../../apps/server/src/env-value.ts)) — box-env's raw override is
the one place that violates it. **Fix (recommended): `loadBoxEnv` treats an empty base value as
absent** so a file value shows through, which is house-consistent and closes the trap for *every*
var, not just backup. It changes box-env's documented "present in base always wins" contract to
"present-**and-non-empty** in base wins" — safe for cloud injection (a cloud injects real values, and
`""` never means "off", omission does) — so the node-containers design receipt and `node-entry`'s
test pin update in the **same change**, with a root-project guard that reads the rendered compose env
against the merge rule (a `deploy/` change class scoped CI drops from `apps/server`). *(Alternative:
stop compose emitting the empty defaults. The plan picks one; this spec recommends the first as the
house-consistent fix. This touches Track P's box-env/compose files — a coordination point.)*

**The wizard is the config path; env-config is not a workflow this slice adds — it is inherent.** The
box loads the real environment *over* its own files on purpose: that is what lets **Waitron Cloud
inject a cloud box's config/secrets** without the box holding a file (the box-env design's central
property, [box-env.ts:9-18](../../../apps/server/src/box-env.ts)), and it is also the break-glass /
recovery / dev path. Because env-wins is baked into how the box boots, the *only* real question is
whether the wizard **notices** when the environment owns the config — otherwise it writes `backup.env`,
the env silently overrides it, and the operator is misled. So the detection below exists as **honesty,
not as a hand-config feature**:

- **Provenance is decided by key PRESENCE in the real (base) environment, per key — never by
  comparing values.** A value comparison has two holes the review found: equal values (cloud injects
  the same string the file holds) misread as wizard-managed, and — the realistic cloud shape —
  injecting **only the key** as a secret while the file holds the rest, which an all-or-nothing check
  misses. So: if **any** `WAITRON_BACKUP_*` key is present and non-empty in the base environment, the
  whole surface is **read-only** and shows **"backups are managed by the environment on this box"**;
  `apply`/`rotate` refuse with `backup.managed_by_environment` (§3.4). This needs the **base-env key
  set threaded into where the routes mount** — today `startServer` receives only the merged object
  ([node-entry.ts:288-297](../../../apps/server/src/node-entry.ts)), so either `loadBoxEnv` returns
  provenance or the base key set is passed alongside.
- **Status and the re-view of the key derive from the supervisor's EFFECTIVE running config, never
  from `backup.env` on disk.** The partial-override case is a §5-grade trap otherwise: env injects key
  K1, the file holds K2, a `rotate` writes K2 and reloads — but the running duty encrypts under K1
  (env wins), while a file-reading `GET recovery-key` shows K2. The operator records K2, and **every
  archive is unrecoverable** while the surface reports success. Reading the effective key closes it,
  and after any `reload` the route **asserts effective == requested** or fails the request.
- Otherwise `backup.env` is authoritative and editable — the normal on-prem box.

*(Decision to challenge, §9: this honesty check could be dropped entirely — then a cloud-injected
override would defeat a wizard edit with no explanation. Kept, because that silent-override case is
exactly the confusion §1 of `CLAUDE.md` is about.)*

**The archive captures `backup.env` and `modules.json`.** So a restore brings back the backup
settings/policy (a same-node cold restore resumes backing up) **and** the enabled-module set — which
is durable config held only on disk, not a DB row ("the enabled set is not a DB row",
[module-config.ts:12](../../../apps/server/src/module-config.ts)). What a restore that **missed**
`modules.json` actually does is **refuse to boot**, not silently flip the regime: an absent file
enables every module, so both `fiscal-none` and `fiscal-verifactu` are on, and the fiscal slot throws
`module.fiscal_slot_ambiguous` ([fiscal-slot.ts:24-27](../../../packages/module/src/fiscal-slot.ts)) —
a box that will not trade until someone hand-writes the file, which is the availability hole capturing
it closes. Both files are an **optional companion** to `RECOVERY_FILES` — captured when present,
skipped when absent — NOT added to `RECOVERY_FILES` itself, whose missing-file semantics are fatal
(`recovery.state_incomplete`), and NOT folded into `collectStateSecrets`
([state-secrets.ts:29](../../../apps/server/src/state-secrets.ts)), which the **operator recovery
bundle** shares ([recovery-bundle-api.ts:67](../../../apps/server/src/recovery-bundle-api.ts)): a
**separate collector used only by the scheduled sweep** captures them, so the downloaded bundle's
contents do not silently change under this slice.

The §5 blast radius is small, because the restore-apply side needs **no change**:

- The restore writes back **any** `secrets/*` archive entry into the state dir — the classification at
  [restore.ts:152](../../../apps/server/src/restore.ts) routes every `secrets/*` entry, and the write
  is [restore.ts:371-386](../../../apps/server/src/restore.ts) →
  [state-secrets.ts:113-118](../../../apps/server/src/state-secrets.ts) — so once the sweep packs
  `secrets/backup.env` and `secrets/modules.json`, they are applied unchanged. **Exception, named:** a
  rejoin restores with `skipSecrets: true` ([restore.ts:92-93](../../../apps/server/src/restore.ts)),
  restoring **none** of `secrets/*`, so a rejoining mirror receives neither file — correct (it keeps
  its own identity), but the plan states it rather than claiming a blanket "no restore-side change".
- **Per-venue, not per-hardware:** `instance.env` (the box's DB connection, minted per hardware) is
  deliberately *not* captured, so the restore never overwrites the new box's connection. With the DB
  URL removed from `backup.env` (below), `backup.env` and `modules.json` carry only per-**venue**
  config, safe to restore onto new hardware.

That the archive then contains the very key it is encrypted under is harmless for **confidentiality** —
decrypting already requires the key. But a restore of a **pre-rotate** archive writes the **old**
`backup.env`, so the box resumes under the old key while the operator's "current" key is the new one;
they still hold the old key (they just used it to restore), but the mismatch is invisible unless
`status` shows which key is in effect (§3.4's key fingerprint). And `WAITRON_BACKUP_DIR` is a **mount
path** that may not exist on the new hardware — that failure is at least loud (`status` goes stale /
`backup.destination_failed`), so "safe to restore anywhere" is narrowed to "the fiscal/config content
is safe; the destination mount must be re-attached".

**`backup.env` deliberately does NOT hold the backup DB connection string.** It holds only per-venue
config: the destination (`WAITRON_BACKUP_DIR` / `WAITRON_BACKUP_DESTINATIONS`), the recovery key
(`WAITRON_BACKUP_RECOVERY_KEY`), and the policy vars (§3.3). The review found that persisting the DB
URL is the trap the "resumes backing up unchanged" claim tripped on: the migrator connection carries a
password **minted per hardware** and persisted in `instance.env`
([instance-bootstrap.ts:225-229](../../../apps/server/src/instance-bootstrap.ts)), so a `backup.env`
restored onto a new box would name the **dead** box's password, the boot probe would fail, and the
restored box would run with **no backups** (log-only, `backup.disabled_probe_failed`) — the opposite
of "unchanged". Instead the **supervisor derives the backup read connection at `reload`** from the
box's own live owner connection (`config.adminDatabaseUrl`, resolved from `instance.env` at
[config.ts:669-674](../../../apps/server/src/config.ts)); the operator never types a connection
string, and nothing per-hardware travels in the archive. `loadBackupConfig` is relaxed so
`WAITRON_BACKUP_DATABASE_URL` is **optional**, falling back to the box's owner connection when unset —
a hand-config box may still set it explicitly (e.g. a read replica). *(Related, believed to predate
this branch, unverified by run: `trading.env` writes `DATABASE_URL` + the migrations URL
([trading-config.ts:38-39](../../../apps/server/src/trading-config.ts)) and **is** captured and read
last, so those too name the old hardware on restore. The cold-restore connection-rebind is the
backlog's promote-Slice-4 operator-surface item, not this slice — but the §7 round-trip test restores
onto a **fresh `instance.env`** and asserts the duty starts against the new credentials, which
surfaces it.)*

*Cost to reverse:* dropping `backup.env` means the wizard cannot persist and the feature is env-only
again. The precedence rule is the same one every box-env file already follows, so it adds no new
concept.

### 3.3 The policy: a wall-clock schedule and dual retention

`BackupConfig` today carries `intervalMs`, `retain` (count) and `staleAfterMs`. The wizard's policy
step needs two things the engine does not have:

- **When** — a schedule of **days** (every day, or a chosen subset of weekdays) at a **time of day**,
  interpreted in the **venue's local timezone**. The box already stores this: the location row carries
  `time_zone` and `day_cutover` (`report-api` reads `select l.time_zone, l.day_cutover`). The time is
  either a fixed `HH:MM` the operator picks, or **"let the box choose"** — which anchors on
  **`day_cutover` + a margin**, i.e. **after the business day has closed** (so the archive captures a
  complete day, not a day still being traded) **and after the day's reports have run** (owner,
  2026-09-09). A per-box stable jitter (a few minutes, derived once from the node id) keeps a fleet
  from all firing on the same second without letting the time wander between boots. The scheduler
  computes the next fire instant from (days, time, tz) and sleeps toward it, replacing "sleep
  `intervalMs` from boot" — but it **caps each sleep at ~1h and recomputes**, rather than one
  multi-day `setTimeout`, so a clock/NTP jump or a `day_cutover`/tz edit is picked up instead of
  firing days late (`realSleep` is `timers/promises`, [loop.ts:44-46](../../../apps/server/src/loop.ts)).
  The `time_zone`/`day_cutover` read is a **tenant-scoped** query (the by-id rule, `CLAUDE.md` §3),
  run on the backup read pool the plan names.
  - **Ordering caveat, named:** there is **no scheduled report-generation job today** — reports are
    computed on demand. So "after reports" currently means only "after `day_cutover` + margin", on the
    assumption a report taken then reflects the closed day. When a nightly report duty is built, the
    box-chosen backup must fire **after it completes**, not merely after a clock margin; that ordering
    is a forward dependency (§10), not built here.
- **How long** — an **age** cap (`retain_days`) beside the existing **count** cap (`retain`). The
  sweep's prune keeps a stored artifact only if it is within **both** caps; it is pruned when it
  exceeds **either**. Age is measured off the artifact's manifest timestamp (already stored), so a
  clock that jumped does not resurrect a pruned window.

New `backup.env` vars: `WAITRON_BACKUP_SCHEDULE_DAYS` (`daily` or a weekday mask), `WAITRON_BACKUP_AT`
(`HH:MM` or `auto`), `WAITRON_BACKUP_RETAIN_DAYS` (a positive int; the age cap), and
`WAITRON_BACKUP_KEY_ROTATED_AT` (§8, so status can name when the key last changed). The legacy
`WAITRON_BACKUP_INTERVAL_MS` remains valid for a hand-configured box as a **simple interval** mode;
setting **both** an interval and a wall-clock schedule is a config conflict that fails closed
(`backup.schedule_invalid`), so there is never an ambiguous "which won". The wizard always writes the
wall-clock schedule, never the interval.

*Cost to reverse:* the scheduler and prune changes live inside `runBackupSweep` and `loadBackupConfig`.
Reverting to interval-only is dropping two vars and one branch; the archive format is untouched, so
old artifacts stay restorable either way.

### 3.4 `mountBackupAdminApi` — the authenticated routes

Mounted on the trading box beside `mountManagementApi` / `mountBoxStatusApi`, behind the box's
existing admin authorization — **the plan confirms which middleware those mounts sit behind** and
reuses it, adding no new auth mechanism:

All read/derive from the supervisor's **effective running config** (§3.2), never from `backup.env` on
disk, so the surface never contradicts what the duty is actually doing:

- **`GET /api/backup/status`** → `{ enabled, managedBy: "wizard" | "environment", destinations,
  schedule, retention, lastSuccessAt, stale, keyFingerprint, keyRotatedAt, archiveUnderCurrentKey }`.
  Reuses the box-status backup reader (`readBackupStatus`) for freshness; adds the policy, the
  managed-by flag, a **key fingerprint** (a short hash prefix — never the key) so an operator can tell
  the effective key from a restored-old-key one (§3.2), and `archiveUnderCurrentKey` (false until the
  first dump after enable/rotate lands — §3.1/§8).
- **`POST /api/backup/mint-key`** → `{ key }`. Returns a fresh strong key (32 bytes, base64url →
  well above the 12-char floor) **in the response only**. Nothing is persisted; this is the value the
  UI shows and offers as a download. Minting does not enable anything.
- **`POST /api/backup/apply`** → body `{ destinationDir, recoveryKey, schedule, retention }`.
  Validates with the **same** rules `loadBackupConfig` enforces (`recovery_key_too_short`,
  `destinations_invalid`, `schedule_invalid`) **plus** the passphrase round-trip guard (§3.5), writes
  `backup.env` atomically, calls `supervisor.reload`, and after reload **asserts the effective key ==
  the requested key** (§3.2) before returning the new status. Latched one-at-a-time; refused with
  `backup.managed_by_environment` (409) when the real env owns the config, and `backup.not_primary`
  (409) on a non-primary node (§3.1).
- **`GET /api/backup/recovery-key`** → `{ key }`. The **effective** current key (from the running
  config, not the file — §3.2), for an operator who lost their copy — authenticated-admin only, served
  only on the box's TLS listener, and its body is **never logged**. Present so re-recording never needs
  a dangerous rotation.
- **`POST /api/backup/rotate`** → body `{ recoveryKey }` (a freshly minted or operator-supplied key).
  Applies it as a new key, taking an immediate dump under it (§3.1). See §8 for the archive-safety
  contract this route carries.

Validation runs **before** any write, and `apply`/`rotate` never leave `backup.env` half-written (the
atomic write is all-or-nothing) — so a rejected request leaves the running duty exactly as it was.

### 3.5 The recovery key

- **Minted by the box by default.** `mint-key` returns a strong random key; the UI shows it once with
  a copy button, offers it as a **download file** (`waitron-recovery-key-<node>-<timestamp>.txt`,
  carrying the key plus a line naming the box and date so an operator with several boxes can tell them
  apart), and gates **apply** behind an **"I have saved this key somewhere safe"** checkbox.
- **Operator override.** An "advanced" toggle lets the operator paste their own passphrase, validated
  to the shared 12-char floor (`MIN_PASSPHRASE_LENGTH`). A pasted key is the operator's risk; the
  default path cannot produce a weak key.
- **The pasted key must survive the env-file round-trip, or the box encrypts under a different string
  than the operator recorded.** `formatEnvFile`/`parseEnvFile` trim each line and split on `\n`
  ([env-file.ts:16-17,32-35](../../../apps/server/src/env-file.ts)) — verified by running them:
  `"correct horse battery "` loses its trailing space, `"a\nb"` truncates at the newline (and can then
  fail the length floor silently on the next boot). So `apply`/`rotate` **reject** any passphrase with
  `\r`, `\n`, control characters, or leading/trailing whitespace, and **assert
  `parseEnvFile(formatEnvFile({ K: key })).K === key` before writing** — validation runs on the string
  that will actually be stored, not the raw body. The minted base64url key is safe by construction.
- **Show once at mint; re-viewable after.** The key is not re-shown inline after apply, but
  `GET /api/backup/recovery-key` lets an authenticated admin see it again deliberately. It is stored
  in `backup.env` in plaintext because an **unattended** backup must be able to encrypt with it — this
  is inherent, not a weakening; the file sits on the box's persistent volume beside its other secrets.

### 3.6 The UI

Screens follow the existing `apps/setup` / dashboard patterns (`venue-screen`, `review-screen`,
`done-screen` shapes; the same form-styles and a11y test conventions). A short flow:

1. **Destination** — a local directory path (with a plain-English hint: "an attached USB drive or a
   mounted disk"), validated non-empty and absolute.
2. **Recovery key** — minted-and-shown by default with copy + download + the saved-it checkbox; an
   advanced "paste my own" toggle.
3. **Policy** — days (daily / pick weekdays), time (a time picker, or the default **"let the box
   choose — after close and after the day's reports"**, which resolves to `day_cutover` + margin per
   §3.3), and retention (keep at most N **and** nothing older than D days, both with sensible defaults
   — a week of dailies, 30 days).
4. **Status** — after apply, and as the always-available view: on/off, last successful backup + how
   stale, where, the policy, and the managed-by note.

The setup **done-screen** gains the first-run nudge (§2), suppressed in demo mode.

---

## 4. Data flow (apply)

```
UI  --POST /api/backup/mint-key-->  server        (returns key; nothing stored)
UI shows key + download + checkbox
UI  --POST /api/backup/apply {dir,key,schedule,retention}-->  server
      refuse if env-managed (409) or non-primary (409)
      validate: loadBackupConfig rules + passphrase round-trip guard ── reject → 4xx, duty unchanged
      writeFileAtomic backup.env
      supervisor.reload(loadBackupConfig(mergedEnv))
        stop old sweep + close old pool → build backends → derive read conn → probe
        → take ONE dump now → start loop
      assert effective key == requested key
      → 200 { status }
UI shows Status
```

No restart. The **reload path** touches only the backup read pool (separate from the app `db` pool,
[boot.ts:1648](../../../apps/server/src/boot.ts)), so enabling/changing backups does not interrupt a
sale. One honest narrowing: the sweep's `encryptArtifact(packArchive(...))`
([backup-sweep.ts:159](../../../apps/server/src/backup-sweep.ts)) is synchronous CPU on the shared
event loop for the whole archive — this predates the branch (BR-2), and the "nothing external blocks a
sale" §5 rule is about the sale never *waiting on* AEAT/network/card, which still holds; a CPU-time
claim would need a measurement, so this spec does not make one.

---

## 5. Error handling and error codes

Reuse the existing domain-concept codes: `backup.recovery_key_missing`, `backup.recovery_key_too_short`,
`backup.destinations_invalid` (with its `reason`). New codes, named for the concept per
`packages/shared/src/errors.ts`: `backup.schedule_invalid` (a malformed schedule, or both an interval
and a wall-clock schedule set); `backup.recovery_key_unstorable` (a passphrase that would not survive
the env-file round-trip — §3.5); `backup.managed_by_environment` (apply/rotate refused because the real
env owns the config); `backup.not_primary` (apply/rotate on a non-primary node — §3.1); and
`backup.destination_failed` (a configured destination the sweep cannot write, surfaced in status —
§3.2). Codes are never renamed once shipped. Every file that throws imports `./errors.js`; reachability
is guarded in the root project.

---

## 6. Fiscal-safety — §5-adjacent

The wizard does not touch the fiscal chain, the SIF, or the invoice series — those move only on a
**restore** (BR-4/SP-3d), which this slice leaves alone. Its §5 relevance is the **recovery posture**:
turning backups on is what makes a cold restore possible at all. Two safety points:

- **Rotate does not re-encrypt existing archives.** After a rotate, artifacts taken before the rotate
  are still encrypted under the **old** key and can only be decrypted with it. The rotate screen warns
  loudly — "backups taken before now still need the **old** key; keep it too" — and the timestamped
  download filename lets the operator hold both. **Re-encrypting old archives is a named
  carry-forward** (§10), not built here: doing it would mean, per destination, fetching every archive,
  decrypting with the old key and re-encrypting with the new — real work with its own failure modes,
  and dangerous to do half-way.
- **The apply/reload path is decoupled from sales** (§4), so enabling or changing backups on a live
  trading venue never risks the sale path.

Because §6 touches the recovery posture, this spec gets a **Fable fresh-context read before the plan**
(`CLAUDE.md` model-selection), and lands with **owner sign-off at PR** (fiscal-adjacent).

---

## 7. Testing

- **`BackupSupervisor` reload lifecycle — real Postgres** (grants, the fiscal-read probe, and pool
  ownership all matter; PGlite's superuser would hide a grant bug). Prove: enable from off; change the
  destination; rotate the key; disable back to off. After each, assert the **old** dedicated pool is
  closed (no leak) and the **new** duty runs — and prove by deletion that removing the probe lets a
  bad connection through. Assert the **immediate dump** on enable and rotate (an archive exists under
  the new key before any sleep — §3.1/§8), and that an abort **mid-tick** during a reload is treated as
  a cancellation, not logged as `backup.failed`.
- **Empty-base override (Blocker 1)** — a `backup.env` value with the matching var set to `""` in the
  base env resolves to the FILE value (not off), and `loadBackupConfig` enables. A **root-project
  guard** reads `deploy/compose.yml`'s rendered environment against the merge rule so a var
  re-introduced with an empty default fails CI (a `deploy/` change class scoped CI drops from
  `apps/server`).
- **Env-managed provenance (Blocker 2)** — presence of **any** `WAITRON_BACKUP_*` key in the base env
  (equal-value AND partial-override, e.g. only the key injected) makes the surface read-only and
  `apply`/`rotate` 409; `status` and `GET recovery-key` return the **effective** running key, and the
  partial-override rotate case is proven NOT to hand back a key that decrypts nothing.
- **Passphrase round-trip (Blocker 3)** — the three shapes (`"…battery "`, `"a\nb"`, a control char)
  are rejected at the route, and `parseEnvFile(formatEnvFile({K:key})).K === key` holds for every
  accepted key.
- **DB connection derived, not stored (Important 4)** — `backup.env` never contains
  `WAITRON_BACKUP_DATABASE_URL`; the duty runs against `config.adminDatabaseUrl`; and the restore
  round-trip below runs onto a **fresh `instance.env`** and asserts the duty starts against the NEW
  credentials.
- **Scheduler** — the next-fire computation across day subsets, the fixed-time and `auto` cases (the
  `auto` case resolves to `day_cutover` + margin and is node-stable across boots), the ~1h sleep cap
  recomputing after a simulated clock jump, and a DST boundary in the venue tz. Age + count prune: an
  artifact pruned by age but within count, and vice-versa, and the "whichever first" boundary.
- **Archive capture of `backup.env` and `modules.json`** — a backup taken with backups on and a
  non-default module set includes both (via the sweep-only collector, NOT `collectStateSecrets`, so
  the recovery-bundle download is unchanged); a box missing either omits the absent one **without
  failing**; a restore round-trips both into the state dir; a **rejoin** (`skipSecrets`) restores
  neither. Prove a missing `modules.json` makes a restored box **refuse to boot**
  (`module.fiscal_slot_ambiguous`), the true failure — not a silent regime flip.
- **Routes** — validation parity with `loadBackupConfig`; the apply latch (a concurrent apply is
  refused, not raced); `managed_by_environment` and `not_primary` refusals; the re-view/rotate authz;
  the post-reload effective==requested assertion.
- **UI** — the saved-it checkbox gates apply; the advanced override enforces the 12-char floor; the
  first-run nudge shows in a live box and is suppressed in demo mode; a11y tests per the screen
  conventions.

Guards that read the whole tree (the compose-env guard above; any capture-completeness guard) live in
the root Vitest project.

---

## 8. Rotate — the archive-safety contract (detail)

`POST /api/backup/rotate` is `apply` with a new key and an extra confirmation. It **must**:

1. return the operator to a confirmation that names the consequence — "older archives stay under the
   old key" — with the old key re-shown (from `GET /api/backup/recovery-key`, i.e. the **effective**
   key, §3.2) so it can be recorded before it is overwritten;
2. write the new key + `WAITRON_BACKUP_KEY_ROTATED_AT` to `backup.env` and reload;
3. **take one dump immediately under the new key** (§3.1) — not "from the next tick", which under the
   wall-clock scheduler could be up to a week away and would leave the box with old archives the
   operator may have stopped tracking and no new-key archive at all.

It does **not** delete old archives, re-encrypt them, or record a per-archive key map — that map is
the carry-forward in §10. The honest guarantee (the earlier "never leaves the box unable to decrypt
*some* key" was too weak to mean anything): after rotate, **at least one archive exists under the new
key** (step 3), the old archives remain decryptable with the old key the operator was just shown and
told to keep, and `status` reports `keyRotatedAt` and a key fingerprint so "which key does this
archive need" is answerable rather than guessed.

---

## 9. Decisions to challenge at review

1. **One authenticated surface + first-run nudge**, not a step inside the unauth setup wizard (§2).
   Reverse cost: moving the mint/persist into the unauth surface and adding a restart — a rewrite of
   §2–§3.1.
2. **Hot-reload via a supervisor**, not restart-to-apply. Reverse cost: low (call `requestRestart`
   instead of `reload`), but the supervisor refactor stays useful either way.
3. **Rotate warns, does not re-encrypt** (§8). Reverse cost: the re-encrypt carry-forward is additive.
4. **Local-fs only**; the wizard offers one destination type. Reverse cost: adding a backend is the
   later destination task; the UI's destination step is written to take a second type without a
   rewrite but is not built for one now.
5. **Wall-clock schedule + dual retention** replace interval-from-boot for the wizard path; the legacy
   interval stays valid for hand-config, with a conflict error if both are set (§3.3). The box-chosen
   time anchors on `day_cutover` + margin (after close, after reports), not a fixed quiet window.
6. **The env-managed honesty check** (§3.2) — keep it (show "managed by environment", read-only), or
   drop it and accept that a cloud-injected override silently defeats a wizard edit. Written kept.
7. **The ongoing "backups off/stale" nag is deferred to the notifications centre** (§2), not built as a
   bespoke banner; this slice only makes the state reportable. Reverse cost: adding a stopgap banner is
   additive if the centre slips.

---

## 10. Out of scope / carry-forwards

- **S3 / Google Drive backends** — the later destination-build task (`docs/backlog.md` Priorities item
  1: mirror → S3 → Drive; only local-fs exists). This wizard offers local-fs only.
- **Re-encrypting existing archives on rotate** / a per-archive key map (§8).
- **Config export/import** (onboarding mode 3) — unrelated; not here.
- The named backup-regime carry-forwards (per-destination timeout, stale-`.tmp` sweep, the key-path
  traversal guard) — untouched by this slice; they land with the first network backend.
- **The ongoing "backups off / stale" reminder** — belongs in the **notifications centre** (not yet
  built, owner 2026-09-09). This slice makes the state reportable; the centre surfaces it.
- **Ordering the box-chosen backup after a nightly report job** — no such job exists yet, so the
  box-chosen time anchors on `day_cutover` + margin (§3.3). When a report duty lands, the backup should
  fire after it completes.
- **Whole-state-volume capture (allowlist → denylist) — a SEPARATE, §5-reviewed slice** (owner,
  2026-09-09). This branch adds `backup.env` + `modules.json` as an optional companion so nothing is
  lost now; the deeper change spins out: capture the whole state directory **except** an explicit
  exclusion set (`backup-staging/`, `restore-staging/`, `logs/`, the per-hardware `instance.env` and
  `recovery.json`), add a **completeness guard** that fails when a new top-level state entry is neither
  captured nor explicitly excluded (a curated list goes stale — `CLAUDE.md` §7; `modules.json` was a
  live example of exactly that gap), and give the restore-apply step per-hardware rules so a broadened
  capture never overwrites new-hardware config. Touches BR-2, BR-3 and the recovery bundle.

---

## 11. The brainstorm decisions (source)

Owner answers, 2026-09-09: placement = **both** (one surface, two entry points); destinations =
**local-fs only (MVP)**; key = **box mints, operator can override**; record gate = **download file +
checkbox**; apply = **hot-reload**; onboarding step = **skippable, loud warning, keep nagging**
(and **skip the nudge in demo mode**); admin capabilities = **view / enable-change / re-view /
rotate** (all four); schedule = **daily or chosen weekdays, at a chosen time or a box-chosen slot**;
retention = **both count and age, whichever prunes first**.

Refinements from the spec-review round (owner, 2026-09-09): the archive must also capture the backup
settings (`backup.env`) and the enabled-module set (`modules.json`), not just the DB — folded into
§1/§3.2 as a capture-only change; the whole-state-volume (allowlist→denylist) capture is spun out as
its own §5-reviewed slice (§10); the ongoing nag moves to the
**notifications centre** (not built) and this slice only makes the state reportable — §2/§10; the
box-chosen time is **after `day_cutover` and after the day's reports**, not a 02:00–06:00 window —
§3.3; and env/hand-config is not a feature but an inherent cloud-injection path, so the wizard's
env-managed check is kept only as **honesty** — §3.2/§9.

---

## 12. Fable fresh-context review (2026-09-09) — findings and resolutions

A read-only reviewer read this spec cold and verified its claims against the code (its checks were
reads plus three small runs: `docker compose config` on the deploy file, the merge semantics, and the
real `formatEnvFile`/`parseEnvFile` on three passphrases — it could not run a container). Every
finding is folded into the body above; recorded here as the receipt (a correction is a new claim,
`CLAUDE.md` §1, so each names what was checked).

- **BLOCKER — empty-base compose override made the feature inert.** `deploy/compose.yml:40-42` emits
  the backup vars as `${VAR:-}` → `""`, which overrode the file; `isUnset("")` → backups off. Fix in
  §3.2 (loadBoxEnv treats empty base as absent) + a compose-env guard in §7.
- **BLOCKER — value-based provenance could hand back a key that decrypts nothing.** The partial
  cloud-override case (env injects only the key, file holds the rest) beat an all-or-nothing check;
  rotate then showed a file key while the duty encrypted under the env key. Fix in §3.2 (provenance by
  key PRESENCE; status/re-view from the effective running config; assert effective==requested).
- **BLOCKER — a pasted passphrase did not survive the env-file round-trip** (trailing space trimmed,
  newline truncated). Fix in §3.5 (reject control/whitespace; assert `parseEnvFile(formatEnvFile)` ==
  input) + `backup.recovery_key_unstorable` in §5.
- **IMPORTANT — "per-hardware safe for free" was false: `backup.env` carried the per-hardware migrator
  URL.** Fix in §3.2/§3.3 (drop the DB URL from `backup.env`; derive at reload from
  `config.adminDatabaseUrl`; the §7 restore test uses a fresh `instance.env`). Related `trading.env`
  connection strings are the backlog's cold-restore rebind item, named not fixed here.
- **IMPORTANT — the `modules.json` rationale was a false claim:** a missed file makes the box **refuse
  to boot** (`module.fiscal_slot_ambiguous`), not silently flip the regime. Reworded in §3.2; §7 tests
  the true failure.
- **IMPORTANT — a wall-clock scheduler drops today's immediate-first-dump**, leaving a just-enabled or
  just-rotated box with no archive under the current key for up to a week. Fix in §3.1/§8 (reload takes
  one dump at once) + `WAITRON_BACKUP_KEY_ROTATED_AT` and a status key fingerprint.
- **IMPORTANT — the optional capture must NOT live in `collectStateSecrets`** (shared with the operator
  recovery-bundle download); a **sweep-only collector** instead — §3.2. And `skipSecrets` (rejoin)
  restores neither file, named in §3.2/§7.
- **IMPORTANT — `isSingletonPrimary` is a boot-time constant;** the supervisor reads the live holder at
  reload, and apply/rotate on a non-primary refuse (`backup.not_primary`) — §3.1/§5.
- **MINOR, folded:** narrowed the sale-path claim to what §5 actually guarantees (§4); abort-mid-tick
  treated as cancellation (§3.1/§7); scheduler caps each sleep ~1h and recomputes, tz read
  tenant-scoped (§3.3); `GET recovery-key` TLS-only and never logged (§3.4); restore write cited at
  both the classify and write sites (§3.2).
- **Sound as written (reviewer confirmed by read):** §5 fiscal invariants untouched (no write to
  `registros_facturacion`/series/SIF; cross-environment restore still refused; `backup.env` carries no
  environment stamp); `instance.env` not captured; restore applies any `secrets/*`; the archive
  holding its own key is confidentiality-harmless; `MIN_PASSPHRASE_LENGTH` = 12.
