# Backup + recovery-key wizard

**Date:** 2026-09-09
**Status:** design; owner brainstorm answered the eight scoping questions in §11. **Owner-reviewed:**
the direction is approved (the sequencing recommendation in §2, demo-skip, and the added backup
policy). This written spec is not yet reviewed — the decisions in §9 are the ones to challenge, and
§8 is §5-adjacent, so a Fable fresh-context read runs before the plan (`CLAUDE.md` model-selection).

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

The backup **engine** is built and unchanged in its core: it takes an encrypted `pg_dump` archive
each tick and fans it out to every configured destination. What is missing is the way a
**non-technical operator turns it on and keeps it healthy** without editing an env file over SSH —
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

Engine extensions, both driven by the new policy step (§3.3): a **wall-clock scheduler** (a chosen
time of day on chosen days, in the venue's local timezone) replacing "every N hours from boot", and
**age-based retention** added beside the existing count-based prune (keep at most N *and* nothing
older than D days — prune on whichever bites first).

**In scope:** `BackupSupervisor` (`apps/server`); a new `backup.env` box-env file and its place in
the env-source precedence (§3.2); the schedule + dual-retention extension to `loadBackupConfig` and
`runBackupSweep`; `mountBackupAdminApi` (authenticated) with the five routes in §3.4; the
recovery-key mint / show-once / override / download / re-view / rotate flow (§3.5); the UI screens and
the first-run nudge (§3.6); the `backup.*` error codes the routes reuse and any new ones; tests that
prove each guarantee.

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
  backups** yet, so there is no way back from a disk failure. Set up backups now." and a link. Once
  the admin logs in, a persistent banner / checklist item stays until backups are on. The nudge is
  **suppressed in demo mode** (`config.devMode`), where the box is disposable.
- **Admin surface.** The same screens are always reachable from the box's admin area to change the
  destination, adjust the policy, re-view the key, or rotate it, whether or not backups were set up at
  first run.

The onboarding step is **skippable** — a local-fs destination needs a directory/volume (an attached
USB, a mounted disk) that an installer may not have on hand at first run — but skipping shows a loud
warning and leaves the nag in place until backups are on.

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
starts a new `runBackupSweep`, and swaps the box-status reader to the new backends. A reload is
**latched one-at-a-time** (like provision) so two concurrent applies cannot race two sweeps onto the
same staging dir. Boot calls `reload(loadBackupConfig(env))` once at startup — identical behaviour to
today — and the apply route calls `reload` after writing new config.

Only a **singleton primary** runs the duty (today's `isSingletonPrimary` gate is preserved): a mirror
does not back up. The supervisor is constructed on every trading box but its `reload` is a no-op that
logs `backup.disabled` when the box is not the singleton primary, so the admin route can still report
"this node does not take backups" rather than 404.

*Cost to reverse:* the supervisor is a refactor of existing boot code plus a `reload`; reverting means
re-inlining. Low.

### 3.2 `backup.env` and the config-source precedence

The wizard persists the backup config to a **new box-env file, `backup.env`**, in the box's state
dir, written atomically with `formatEnvFile` (the writer `writeTradingEnv` already uses). It is added
to `loadBoxEnv`'s file list ([box-env.ts:7](../../../apps/server/src/box-env.ts)) so it survives a
restart, and it is read **after** the existing files but, as with all of them, the **real process
environment still wins** (`{ ...fromFiles, ...base }`). That precedence is the load-bearing rule:

- A box configured **by hand** via `/opt/waitron/.env` (real env) keeps that config; the wizard must
  **not** silently fight it. When `loadBackupConfig` would read a `WAITRON_BACKUP_*` value from the
  real environment rather than from `backup.env`, the admin surface shows **"backups are managed by
  the environment on this box"** and the edit controls are read-only. This is detected by comparing
  the merged env against `backup.env`'s own contents at request time.
- A box configured by the **wizard** has an empty backup section in the real env, so `backup.env` is
  authoritative and editable.

`backup.env` holds the full trio plus the policy: `WAITRON_BACKUP_DIR` (or
`WAITRON_BACKUP_DESTINATIONS`), `WAITRON_BACKUP_DATABASE_URL`, `WAITRON_BACKUP_RECOVERY_KEY`, and the
policy vars in §3.3. The operator never types a connection string: the box already holds a
suitable owner/migrator connection (it boots with `WAITRON_MIGRATIONS_DATABASE_URL`, and the backup
read must have SELECT on the dump sources and migration journals — the migrator/owner shape), so the
wizard reuses it as `WAITRON_BACKUP_DATABASE_URL`. **The plan confirms the exact connection the backup
reader needs** and that the box holds it at the moment the wizard runs — an unverified claim about a
role's privileges is the §1 defect class.

*Cost to reverse:* dropping `backup.env` means the wizard cannot persist and the feature is env-only
again. The precedence rule is the same one every box-env file already follows, so it adds no new
concept.

### 3.3 The policy: a wall-clock schedule and dual retention

`BackupConfig` today carries `intervalMs`, `retain` (count) and `staleAfterMs`. The wizard's policy
step needs two things the engine does not have:

- **When** — a schedule of **days** (every day, or a chosen subset of weekdays) at a **time of day**,
  interpreted in the **venue's local timezone**. The box already stores this: the location row carries
  `time_zone` and `day_cutover` (`report-api` reads `select l.time_zone, l.day_cutover`), and
  `day_cutover` (the business-day boundary, typically after close) is the natural **default** anchor.
  The time is either a fixed `HH:MM` the operator picks, or **"let the box choose"** — a per-box
  stable time jittered into the 02:00–06:00 quiet window (derived once from the node id so it does not
  wander between boots, and so a fleet does not all fire at 02:00). The scheduler computes the next
  fire instant from (days, time, tz) and sleeps to it, replacing "sleep `intervalMs` from boot".
- **How long** — an **age** cap (`retain_days`) beside the existing **count** cap (`retain`). The
  sweep's prune keeps a stored artifact only if it is within **both** caps; it is pruned when it
  exceeds **either**. Age is measured off the artifact's manifest timestamp (already stored), so a
  clock that jumped does not resurrect a pruned window.

New `backup.env` vars: `WAITRON_BACKUP_SCHEDULE_DAYS` (`daily` or a weekday mask), `WAITRON_BACKUP_AT`
(`HH:MM` or `auto`), `WAITRON_BACKUP_RETAIN_DAYS` (a positive int; the age cap). The legacy
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

- **`GET /api/backup/status`** → `{ enabled, managedBy: "wizard" | "environment", destinations,
  schedule, retention, lastSuccessAt, stale }`. Reuses the box-status backup reader
  (`readBackupStatus`) for freshness; adds the policy and the managed-by flag.
- **`POST /api/backup/mint-key`** → `{ key }`. Returns a fresh strong key (32 bytes, base64url →
  well above the 12-char floor) **in the response only**. Nothing is persisted; this is the value the
  UI shows and offers as a download. Minting does not enable anything.
- **`POST /api/backup/apply`** → body `{ destinationDir, recoveryKey, schedule, retention }`.
  Validates with the **same** rules `loadBackupConfig` enforces (`recovery_key_too_short`,
  `destinations_invalid`, `schedule_invalid`), writes `backup.env` atomically, calls
  `supervisor.reload`, and returns the new status. Latched one-at-a-time; refused with
  `backup.managed_by_environment` (409) when the real env owns the config.
- **`GET /api/backup/recovery-key`** → `{ key }`. The current stored key, for an operator who lost
  their copy — authenticated-admin only. Present so re-recording never needs a dangerous rotation.
- **`POST /api/backup/rotate`** → body `{ recoveryKey }` (a freshly minted or operator-supplied key).
  Applies it as a new key. See §8 for the archive-safety contract this route carries.

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
3. **Policy** — days (daily / pick weekdays), time (a time picker, defaulting to the venue's
   `day_cutover`, or "let the box choose a quiet time"), and retention (keep at most N **and** nothing
   older than D days, both with sensible defaults — a week of dailies, 30 days).
4. **Status** — after apply, and as the always-available view: on/off, last successful backup + how
   stale, where, the policy, and the managed-by note.

The setup **done-screen** gains the first-run nudge (§2), suppressed in demo mode.

---

## 4. Data flow (apply)

```
UI  --POST /api/backup/mint-key-->  server        (returns key; nothing stored)
UI shows key + download + checkbox
UI  --POST /api/backup/apply {dir,key,schedule,retention}-->  server
      validate (loadBackupConfig rules) ── reject → 4xx, duty unchanged
      writeFileAtomic backup.env
      supervisor.reload(loadBackupConfig(mergedEnv))
        stop old sweep + close old pool → build backends → probe pool → start new sweep
      → 200 { status }
UI shows Status
```

No restart. The sale path never touches any of this (the backup DB pool is separate from the app
pool), so a reload cannot block a sale — the §5 "nothing external blocks a sale" rule holds by
construction.

---

## 5. Error handling and error codes

Reuse the existing domain-concept codes: `backup.recovery_key_missing`, `backup.recovery_key_too_short`,
`backup.destinations_invalid` (with its `reason`). New codes, named for the concept per
`packages/shared/src/errors.ts`: `backup.schedule_invalid` (a malformed schedule, or both an interval
and a wall-clock schedule set) and `backup.managed_by_environment` (apply/rotate refused because the
real env owns the config). Codes are never renamed once shipped. Every file that throws imports
`./errors.js`; reachability is guarded in the root project.

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
  bad connection through.
- **Scheduler** — the next-fire computation across day subsets, the fixed-time and `auto` (jittered,
  node-stable) cases, and a DST boundary in the venue tz. Age + count prune: an artifact pruned by age
  but within count, and vice-versa, and the "whichever first" boundary.
- **Routes** — validation parity with `loadBackupConfig` (a route must reject exactly what boot
  rejects); the apply latch (a concurrent apply is refused, not raced); `managed_by_environment`
  refusal when the real env owns the config; the re-view/rotate authz.
- **Env precedence** — a real-env `WAITRON_BACKUP_*` wins over `backup.env` and the status reports
  `managedBy: "environment"` with edits disabled.
- **UI** — the saved-it checkbox gates apply; the advanced override enforces the 12-char floor; the
  first-run nudge shows in a live box and is suppressed in demo mode; a11y tests per the screen
  conventions.

Guards that read the whole tree (if any new one is needed) live in the root Vitest project.

---

## 8. Rotate — the archive-safety contract (detail)

`POST /api/backup/rotate` is `apply` with a new key and an extra confirmation. It **must**:

1. return the operator to a confirmation that names the consequence — "older archives stay under the
   old key" — with the old key re-shown (from `GET /api/backup/recovery-key`) so it can be recorded
   before it is overwritten;
2. write the new key to `backup.env` and reload;
3. from the next tick, encrypt under the new key; leave old archives untouched.

It does **not** delete old archives, re-encrypt them, or record a per-archive key map — that map is
the carry-forward in §10. The one hard rule: rotate never leaves the box in a state where **no** key
can decrypt a stored archive.

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
   interval stays valid for hand-config, with a conflict error if both are set (§3.3).

---

## 10. Out of scope / carry-forwards

- **S3 / Google Drive backends** — the later destination-build task (`docs/backlog.md` Priorities item
  1: mirror → S3 → Drive; only local-fs exists). This wizard offers local-fs only.
- **Re-encrypting existing archives on rotate** / a per-archive key map (§8).
- **Config export/import** (onboarding mode 3) — unrelated; not here.
- The named backup-regime carry-forwards (per-destination timeout, stale-`.tmp` sweep, the key-path
  traversal guard) — untouched by this slice; they land with the first network backend.

---

## 11. The brainstorm decisions (source)

Owner answers, 2026-09-09: placement = **both** (one surface, two entry points); destinations =
**local-fs only (MVP)**; key = **box mints, operator can override**; record gate = **download file +
checkbox**; apply = **hot-reload**; onboarding step = **skippable, loud warning, keep nagging**
(and **skip the nudge in demo mode**); admin capabilities = **view / enable-change / re-view /
rotate** (all four); schedule = **daily or chosen weekdays, at a chosen time or a box-chosen slot
02:00–06:00**; retention = **both count and age, whichever prunes first**.
