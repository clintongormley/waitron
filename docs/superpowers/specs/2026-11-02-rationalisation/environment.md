> Appendix to [README.md](README.md), the rationalisation design of 2 November 2026: one researcher's proposal for this area, written to the shared rules. Where README.md §5 decides differently, README.md wins.

# Environment variables — a rationalised design

Read-only review of `main` at `64eeabb036` (2 November 2026). Every claim below cites the code or
the grep behind it. "Set nowhere outside tests" comes from the inventory's own greps, rechecked
here for the names that change fate (a per-name `grep -rl` over `apps packages scripts bench
deploy .github docs`, test files counted apart). I ran no tests: everything below comes from
reading the code and grepping it.

## 1. The target picture

**An environment variable is for something the box must know before its database opens, and
nothing else.** That leaves five kinds:

- **Folders and ports**: the state, venue and log folders, the listening address and ports, and
  the operator's own certificate files. The recovery page has to serve even when the database
  will not open, so these must stay outside it (`recovery-listener.ts:109,222-249`).
- **Image and compose wiring**: where the image put the web apps, the migrations and the demo
  photos; the passkey domain and the public address; the box's network addresses; which image to
  run; which Cloud this deployment talks to.
- **The box's identity**, in the box-written file `trading.env`: the node id, which environment
  this is (`WAITRON_ENV`), and why the box was set up. The node id's presence is what switches
  setup mode to trading mode (`node-config.ts:35-39`), and a restore writes this file last, as the
  moment the restored box becomes real (`restore.ts:795-812`).
- **The box's root keys**: the vault key that opens every sealed credential, the account key, and
  the backup recovery key that opens archives. A key can't be stored inside the database it
  unlocks.
- **One-off inputs to commands an operator runs by hand**: break-glass, restore, unpacking a
  recovery bundle, and the command-line venue setup.

Everything else leaves the environment:

- **Venue choices go to the shared `settings` table**, as one JSON document per module, editable
  on the dashboard and carrying a revision number so two clashing saves are refused. Four
  variables move there: tips (`payments.tipsEnabled`), the display-language override
  (`venue.displayLanguage`), the practice-mode card-provider switch (`payments.testProviders`,
  honoured only on a preproduction box), and the Google sign-in client id
  (`identity.googleClientId`). The backup settings the dashboard already keeps become the
  `backup` document. Today they are stored as a sealed credential (`archive-settings.ts:33-44`):
  the non-secret fields move to `settings`, and the bucket's secret stays a sealed credential.
- **Secrets that are not root keys go to the credentials store** (the `tenant_credentials` table,
  sealed with the vault key), where card-provider keys and the fiscal certificate already live:
  the Google client secret and the bucket key.
- **Knobs nobody sets become constants**: the duty-loop timings, the scheduler's five settings,
  log rotation, the backup-overdue threshold and the tunnel's pool size. Tests that shorten
  timings pass an option to `bootServer` instead. Every such test I checked runs the server in
  its own process (no `spawn`/`fork` in `boot.test.ts`, `boot.fiscal-retry.test.ts`,
  `boot.promote.test.ts`, `promote-endpoint-e2e.test.ts`).
- **History goes to `activity_log`**: "backup key rotated" replaces
  `WAITRON_BACKUP_KEY_ROTATED_AT`.
- **The Cloud tunnel's settings go to `cloud-connection.json`.** That file holds this physical
  box's Cloud pairing and already carries its private key (`cloud-client.ts:184-200`). It is
  deliberately left out of recovery bundles: "Cloud installation keys are excluded: a replacement
  pairs with its own key" (`state-secrets.ts:13-15`). `box_settings` would be the wrong home,
  because `node.db` travels inside every archive (`archive-entries.ts:34-36`), so a replacement
  box would inherit the old box's tunnel identity.

**Nothing in the environment-variable part needs `box_settings`.** Each per-box fact here is
either needed before the database opens (addresses, certificate files) or must not travel with
a backup (the tunnel). With the owner's one-venue-one-box decision of 2026-11-01, backup
settings are venue-wide.

**One list.** A single module declares every variable a Waitron program reads. For each one it
gives the name, which program reads it, its type, default, validation, whether it is secret, and
its one source: image, compose, box file, command input, internal, or test. `loadConfig` and
every command read through that list. At start the box logs one line naming any `WAITRON_*` it
does not know, never with values. It refuses to start on a **retired** name whose silent loss
would cost data — today, the moved backup variables. The refusal is a recovery-page code whose
fixed title says where the setting now lives. Because each name has one source, the rule "the
real environment beats the box's files" (`box-env.ts:26-31`) no longer has anything to decide.
That rule is why compose has to repeat the passkey domain and origin today (`compose.yml:26-31`).
The print agent keeps its own short list in its own `config.ts`, because the print-agent package
imports nothing else from this repository (root `CLAUDE.md` §3). One guard reads both lists.

Result: the product side goes from 111 `WAITRON_*` names to 51. Of those 51, 13 are build or
compose wiring that waitron.sh manages and 9 are one-off command inputs. Four new
`WAITRON_TEST_*` names replace 12 test overrides in the host scripts.

### How the part rules held up (E1–E7)

- **E1 holds, with one exception it did not foresee.** The tunnel is per-box but must not go into
  `box_settings`, as explained above. `WAITRON_FISCAL_TEST_SUBMISSIONS` stays in the environment:
  it says what kind of box this is for fiscal sending (`config.ts:387-395`), so it belongs with
  `WAITRON_ENV` and must never be editable on the dashboard.
- **E2 breaks as written: "one home" can't be one file.** Restore treats the three files
  differently:
  - It writes `trading.env` last, as its commit point (`restore.ts:795-812`).
  - It drops the archive's `backup.env` instead of restoring it (`restore.ts:557-561`;
    `backup-data-placement.ts:73`).
  - A recovery bundle must carry `secrets.env` and `trading.env`, while `backup.env` is optional
    (`state-secrets.ts:16-23`; `backup-optional-state.ts:10-15`).

  Merging the files would turn those whole-file rules into line-by-line edits inside restore
  code. Proposed home instead: **one owning module and one folder, three files by lifecycle**:
  - `trading.env` holds identity only. `WAITRON_ACCOUNT_KEY` leaves it, so it holds no secret.
  - `secrets.env` holds the root keys: the vault key ring plus the account key.
  - `backup.env` holds the backup recovery key only.

  Every other secret lives in the credentials store or `cloud-connection.json`. Rotation becomes
  one command per root key, each writing through that module and adding an `activity_log` entry.
  Today the vault key is rotated by hand-editing `secrets.env` and then running
  `credentials rotate` (`packages/credentials/src/cli.ts:180-187`), while the backup key is
  rotated through a dashboard route (`backup-api.ts:516`). File names stay as they are, because
  archives name them (`secrets/trading.env`, `restore.ts:95`) and Waitron Cloud's test script
  writes `backup.env` directly (`waitron-cloud/scripts/test-local-backups.mjs:471-474,582-585`,
  read only). Decision D4.
- **E3: no single list exists today.**
  - `env-value.ts` is one helper, `isUnset` (7 lines).
  - `config.ts` reads most server variables, but 30 other non-test source files also read
    `WAITRON_*` variables. Grep:
    `grep -rlE 'WAITRON_[A-Z_]+' apps packages --include=*.ts`, minus tests. Among them are
    `box-secrets.ts`, `backup-config.ts`, `cloud-client.ts`, `mirror-bind-guard.ts`,
    `till-config.ts`, `restore-command.ts`, `packages/credentials/src/keyring.ts`,
    `packages/provisioning/src/cli.ts`, `packages/db/src/venue-holder-identity.ts` and
    `packages/stream/src/litestream.ts`.
  - Nothing reports unknown names. The only `startsWith("WAITRON_")` in source is in a test
    helper (`apps/server/src/testing/zone-process-matrix.ts:109`).
  - Two readers of one name disagree: the server defaults `WAITRON_ADVERTISED_ORIGIN` to the
    management origin, but the command-line first setup refuses without it.
  - The rule that an empty value means "unset" is applied unevenly. The key ring's both-or-neither
    check tests for missing, not empty (`keyring.ts`, as the inventory notes).
- **E4 holds.**
  - The `WAITRON_FISCAL_*` set is dead in production. `allocation-configuration.ts` is imported
    only by tests (`grep -rn allocation-configuration apps packages scripts`). The one production
    path through the historical `initial-setup.ts`, `hour-configuration.ts:91-93`, hands it to
    `createHourInitialSetup`, which replaces its `configure` (the only code reading these
    variables, `initial-setup.ts:368-385`) with `configure: undefined`
    (`initial-hour-setup.ts:108-115`).
  - The backlog entry calls that code "spread into production"
    (`docs/backlog/fiscal.md:1094-1106`). The spread is real, but the code that reads the
    variables is the part production overrides.
  - The two runbook-only folder variables come from a runbook marked "Historical protocol,
    superseded 2026-10-19" (`offline-fiscal-restore.md:1-8`).
- **E5 holds.** Every `WAITRON_SH_*` and `WAITRON_BOX_*` path override points into one test
  sandbox (`waitron-sh.test.mjs:442,464-466`; `waitron-box-sh.test.mjs:117-121`). One
  `WAITRON_TEST_HOST_ROOT`, a folder put in front of every host path, replaces nine names. The
  health-check and read-wait counts become `WAITRON_TEST_HEALTH_TRIES`,
  `WAITRON_TEST_HEALTH_DELAY` and `WAITRON_TEST_READ_SECONDS`. The tests keep the cases that
  matter, including the one that reads the shipped try count out of the script
  (`waitron-sh.test.mjs:1538`). That pattern match changes to the new name.
- **E6: the single source is the dashboard record**, stored as the `backup` settings document. The
  environment keeps only the recovery key: as the root key in `backup.env`, and as the restore
  command's input. Today, setting any of nine variables in the real environment hands ownership
  to the environment and locks the dashboard (`backup-config.ts:112-128`). After that, destinations
  and schedule come from the environment while the stale threshold comes from the environment in
  both modes (`backup-config.ts:294,329`). That makes two sources with a hidden switch between them.
- **E7: no family is dead.** Four sets duplicate each other and should merge (see the mapping):
  `WAITRON_PREPROD_*` with `WAITRON_CERT_CHECK_*`, the four full-disk folders, the two
  "fail instead of skip" switches, and the bench's `LITESTREAM_BIN`.

## 2. Target list

**Before the database opens (image, compose or operator)**

| Name | What it does | Why it must exist |
|---|---|---|
| `WAITRON_STATE_DIR`, `WAITRON_VENUE_DIR`, `WAITRON_LOG_DIR` | The box's folders | Needed before anything opens |
| `WAITRON_HTTP_PORT`, `WAITRON_HTTP_HOST`, `WAITRON_HTTP_LANDING_PORT` | Where the server listens | Needed before anything listens |
| `WAITRON_TLS_CERT_FILE`, `WAITRON_TLS_KEY_FILE` | The operator's own certificate | The recovery page serves with it when the database is broken |
| `WAITRON_BOX_ADDRESSES` | The box's LAN addresses | Certificate, QR code and recovery page, before the database |
| `WAITRON_MANAGEMENT_RP_ID`, `WAITRON_MANAGEMENT_ORIGIN` | Passkey domain; the box's one public address (absorbs the advertised origin) | Required in production; image and compose wiring |
| `WAITRON_MIGRATIONS_DIR`, `WAITRON_TILL_APP_DIR`, `WAITRON_DASHBOARD_APP_DIR`, `WAITRON_SETUP_APP_DIR`, `WAITRON_DEMO_MEDIA_SOURCE` | Where the image put its files | Image layout |
| `WAITRON_LITESTREAM_BIN` | The backup streamer program | Tests and the bench point at a downloaded copy; the image uses PATH |
| `WAITRON_CLOUD_ORIGIN` | Which Cloud this deployment talks to | Deployment wiring (to be passed through compose) |
| `WAITRON_FISCAL_TEST_SUBMISSIONS` | Lets a preproduction integration box send to AEAT's test service | Environment family; never editable on the dashboard |
| `WAITRON_SETUP_PORT`, `WAITRON_PRINT_AGENT_SERVER_URL`, `WAITRON_PRINT_AGENT_SETUP_URL` | The print agent's port and addresses | Print agent wiring, one name each |
| `WAITRON_BUILD_ID`, `WAITRON_SOURCE_METADATA`, `WAITRON_IMAGE_CREATED`, `WAITRON_IMAGE_REF` | Image stamps | Build arguments |
| `WAITRON_IMAGE`, `WAITRON_PRINT_AGENT_IMAGE`, `WAITRON_PRINT_AGENT_APPARMOR`, `WAITRON_BOX_SOCKET_DIR`, `WAITRON_DIR`, `WAITRON_SH_REFRESHED` | Compose and installer wiring | Managed by waitron.sh |

**Box-written files**

| File | Holds | Why |
|---|---|---|
| `trading.env` | `WAITRON_NODE_ID`, `WAITRON_ENV`, `WAITRON_ONBOARDING_INTENT` | Identity; restore's commit point; no secrets |
| `secrets.env` | `WAITRON_CREDENTIALS_KEY` (+ version; the previous key and its version only while rotating), `WAITRON_ACCOUNT_KEY` | Root keys that open the sealed rows |
| `backup.env` | `WAITRON_BACKUP_RECOVERY_KEY` | Opens archives; restore deliberately does not copy it from an archive |
| `cloud-connection.json` | Cloud pairing + tunnel address, box id and token | This box only; never in a bundle |

**One-off command inputs:** `WAITRON_BREAKGLASS_PASSWORD`, `WAITRON_BREAKGLASS_PIN`,
`WAITRON_RECOVERY_PASSPHRASE`, `WAITRON_NODE_RECOVERY_KEY`, `WAITRON_RECOVERY_OPERATION_FILE`,
`WAITRON_ADMIN_PIN`, `WAITRON_ADMIN_PASSWORD`, `WAITRON_INITIAL_VENUE_INPUT`,
`WAITRON_SETUP_SETTINGS_FILE`, and `WAITRON_BACKUP_RECOVERY_KEY` for `restore`.

**Internal hand-off, not an operator setting:** `WAITRON_STREAM_ACCESS_KEY_ID`, and
`WAITRON_STREAM_SECRET_ACCESS_KEY`, which go into Litestream's own environment only.

**Settings documents (venue.db `settings`):** `payments` {tipsEnabled, testProviders}, `venue`
{displayLanguage}, `identity` {googleClientId}, `backup` {enabled, destinations without
secrets, schedule, retention, destinationTimeoutMs}. **Credentials store:** the Google client
secret and the bucket key. **activity_log:** backup key rotated, vault key rotated.

**Standard and third-party** (`PATH`, `HOME`, `LANG`, `LC_ALL`, `NODE_ENV`, the CA trio,
`HUSKY`, Mailpit's `MP_*`), **development** and **tests/CI**: kept, outside the product's list.
The test families gain `WAITRON_TEST_HOST_ROOT`, `WAITRON_TEST_HEALTH_TRIES`,
`WAITRON_TEST_HEALTH_DELAY`, `WAITRON_TEST_READ_SECONDS`, `WAITRON_REQUIRE_TEST_TOOLS` and
`WAITRON_FULL_DISK_ROOT`, replacing the names they absorb.

## 3. Mapping

All 220 items, in inventory order within each context. The same rows are in `rat-env-out.json`.

### Box at runtime

| Current | Fate | Target | Why |
|---|---|---|---|
| `WAITRON_ENV` | keep | trading.env (box identity file); one list | Must be known before the database opens: it picks the database and AEAT's endpoint (config.ts:341). Fiscal invariant, never dashboard-editable. |
| `WAITRON_ONBOARDING_INTENT` | keep | trading.env (box identity file) | A fact about this box's setup, checked against WAITRON_ENV at start (config.ts:363-385) and written with the node id; kept beside it so a venue copy does not carry another box's intent. |
| `WAITRON_NODE_ID` | keep | trading.env (box identity file) | Its presence is what switches setup mode to trading mode before the database opens (node-config.ts:35-39), and restore writes this file last as its commit point (restore.ts:795-812). |
| `WAITRON_ACCOUNT_KEY` | move to the keys file | secrets.env (root keys file) | A secret sitting in the identity file (trading-config.ts:40); root keys get one file, so trading.env holds no secret. |
| `WAITRON_CREDENTIALS_KEY` | keep | secrets.env (root keys file) | The vault key that opens every sealed credential row; it cannot live in the database it unlocks (keyring.ts:5). |
| `WAITRON_CREDENTIALS_KEY_VERSION` | keep | secrets.env (root keys file) | Stamped on everything the current key seals; part of the key ring. |
| `WAITRON_CREDENTIALS_KEY_PREVIOUS` | keep | secrets.env, written only by the one rotation command | Needed only during a key change; today an operator hand-edits it before `credentials rotate` (credentials/src/cli.ts:180) — the rotation command should write and later remove it. |
| `WAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION` | keep | secrets.env, written only by the one rotation command | Pairs with the previous key during rotation. |
| `WAITRON_STATE_DIR` | keep | env (folder) | A folder the box needs before anything opens (config.ts:464). |
| `WAITRON_VENUE_DIR` | keep | env (folder) | Where the database files are; needed before the database opens (config.ts:519). |
| `WAITRON_SPARE_SPACE_DIR` | replace with a boot option | parameter passed from node-entry to bootServer | An in-process hand-off written into an env object by the server for itself (node-entry.ts:428-435, read at boot.ts:1033); a function argument says the same thing without a public name. |
| `WAITRON_LOG_DIR` | keep | env (folder; image sets it) | A folder, set by the image (Dockerfile:268). |
| `WAITRON_LOG_MAX_BYTES` | make a constant | constant in config.ts (10,000,000) | Set nowhere outside config.test.ts; a tuning knob nobody sets. |
| `WAITRON_LOG_MAX_FILES` | make a constant | constant in config.ts (5) | Set nowhere outside config.test.ts. |
| `WAITRON_MIGRATIONS_DIR` | keep | env (image wiring) | Where the image puts the migration files (Dockerfile:270); dev sets its own (dev-server.mjs:68). |
| `WAITRON_HTTP_PORT` | keep | env (port) | A port, needed before anything listens. |
| `WAITRON_HTTP_HOST` | keep | env (image wiring) | Listening address; the image fixes 0.0.0.0 (Dockerfile:275), the code defaults to loopback. |
| `WAITRON_HTTP_LANDING_PORT` | keep | env (port) | A port; the Cloud fixture turns it off with 0 (cloud-integration-fixture.ts:122). |
| `WAITRON_TLS_CERT_FILE` | keep | env (file path) | An operator certificate the recovery listener needs even when the database will not open (recovery-listener.ts:109). |
| `WAITRON_TLS_KEY_FILE` | keep | env (file path) | Pairs with WAITRON_TLS_CERT_FILE. |
| `WAITRON_BOX_ADDRESSES` | keep | env (compose wiring) | Network wiring of the host, needed to mint the certificate and serve the recovery page before the database opens (config.ts:521; recovery-listener.ts:222). |
| `WAITRON_MANAGEMENT_RP_ID` | keep | env (image/compose wiring) | Passkey domain; image and compose wiring (Dockerfile:276; compose.yml:32), required in production. |
| `WAITRON_MANAGEMENT_ORIGIN` | keep | env (image/compose wiring); absorbs WAITRON_ADVERTISED_ORIGIN | The box's one public address. |
| `WAITRON_ADVERTISED_ORIGIN` | merge into WAITRON_MANAGEMENT_ORIGIN | WAITRON_MANAGEMENT_ORIGIN | Set nowhere outside tests; the server defaults it to the management origin (config.ts:539-541) but the command-line first setup has no default and refuses without it (first-setup-command-deployment.ts:173-185): two readers, two defaults, one value. |
| `WAITRON_TENANT_DOMAIN` | delete | (re-add as a venue setting when failover is designed) | Set nowhere outside config.test.ts; exists for cookies after a promotion, and today a venue has one node and no failover (root CLAUDE.md §5). |
| `WAITRON_TILL_LOCALE` | move to settings | settings: venue document, optional display-language override | A venue choice read once at boot (boot.ts:1774; venue-locale.ts:50); setup never writes it (trading-config.ts:33-41), so only dev-setup sets it. Owner decision D5. |
| `WAITRON_TILL_TIPS` | move to settings | settings: payments document, tipsEnabled | A venue's trading choice (bill-payments.ts:976,1118; till-sale.ts:1455) that only a hand-edited env file can set today. Owner decision D5. |
| `WAITRON_TILL_APP_DIR` | keep | env (image wiring) | Where the image puts the built web apps (Dockerfile:271-273). |
| `WAITRON_DASHBOARD_APP_DIR` | keep | env (image wiring) | Where the image puts the built web apps (Dockerfile:271-273). |
| `WAITRON_SETUP_APP_DIR` | keep | env (image wiring) | Where the image puts the built web apps (Dockerfile:271-273). |
| `WAITRON_MIN_TICK_MS` | make a constant | constant in code; tests pass a tuning option to bootServer | Set nowhere outside tests; the in-process boot tests that shorten it (boot.test.ts:620, boot.fiscal-retry.test.ts:98, boot.promote.test.ts:235) spawn no child process, so an option replaces the env name. |
| `WAITRON_MAX_TICK_MS` | make a constant | constant DEFAULT_MAX_TICK_MS; tests pass a tuning option | Set nowhere outside tests; health's budget is already fixed against the default, not this value (health.ts:21-26), so a constant removes a mismatch. |
| `WAITRON_SKIP_RETRY_MS` | make a constant | constant in code; tests pass a tuning option to bootServer | Set nowhere outside tests; the in-process boot tests that shorten it (boot.test.ts:620, boot.fiscal-retry.test.ts:98, boot.promote.test.ts:235) spawn no child process, so an option replaces the env name. |
| `WAITRON_SETTLEMENT_LAG_MS` | make a constant | constant in code; tests pass a tuning option to bootServer | Set nowhere outside tests; the in-process boot tests that shorten it (boot.test.ts:620, boot.fiscal-retry.test.ts:98, boot.promote.test.ts:235) spawn no child process, so an option replaces the env name. |
| `WAITRON_SCHEDULER_HORIZON_DAYS` | make a constant | constant in code; tests pass a tuning option to bootServer | Set nowhere outside tests; the in-process boot tests that shorten it (boot.test.ts:620, boot.fiscal-retry.test.ts:98, boot.promote.test.ts:235) spawn no child process, so an option replaces the env name. |
| `WAITRON_SCHEDULER_MAX_PERIODS_PER_TICK` | make a constant | constant in code; tests pass a tuning option to bootServer | Set nowhere outside tests; the in-process boot tests that shorten it (boot.test.ts:620, boot.fiscal-retry.test.ts:98, boot.promote.test.ts:235) spawn no child process, so an option replaces the env name. |
| `WAITRON_SCHEDULER_MAX_ATTEMPTS` | make a constant | constant in code; tests pass a tuning option to bootServer | Set nowhere outside tests; the in-process boot tests that shorten it (boot.test.ts:620, boot.fiscal-retry.test.ts:98, boot.promote.test.ts:235) spawn no child process, so an option replaces the env name. |
| `WAITRON_SCHEDULER_BACKOFF_BASE_MS` | make a constant | constant in code; tests pass a tuning option to bootServer | Set nowhere outside tests; the in-process boot tests that shorten it (boot.test.ts:620, boot.fiscal-retry.test.ts:98, boot.promote.test.ts:235) spawn no child process, so an option replaces the env name. |
| `WAITRON_SCHEDULER_STALE_AFTER_MS` | make a constant | constant in code; tests pass a tuning option to bootServer | Set nowhere outside tests; the in-process boot tests that shorten it (boot.test.ts:620, boot.fiscal-retry.test.ts:98, boot.promote.test.ts:235) spawn no child process, so an option replaces the env name. |
| `WAITRON_LITESTREAM_BIN` | keep | env (program path; tests and bench use it too) | The image puts litestream on PATH (Dockerfile:182); tests and the bench point at a downloaded copy. Absorbs the bench's LITESTREAM_BIN. |
| `WAITRON_STREAM_ACCESS_KEY_ID` | keep | internal child-process hand-off (listed as internal) | The server puts the bucket key into Litestream's own environment so it never lands in a file (litestream.ts:51-52,76-77); not an operator setting. |
| `WAITRON_STREAM_SECRET_ACCESS_KEY` | keep | internal child-process hand-off (listed as internal) | The server puts the bucket key into Litestream's own environment so it never lands in a file (litestream.ts:51-52,76-77); not an operator setting. |
| `WAITRON_BACKUP_DIR` | delete | settings: backup document (destinations) | A second source for the same choice: setting it locks the dashboard's backup settings (backup-config.ts:112-128). The dashboard record already carries destinations (archive-settings.ts:34-44). Owner decision D1. |
| `WAITRON_BACKUP_DESTINATIONS` | delete | settings: backup document (destinations) + bucket secret in tenant_credentials | Same choice as the dashboard's destinations; set nowhere outside tests. Owner decision D1. |
| `WAITRON_BACKUP_RECOVERY_KEY` | keep | backup.env (root key file); one-off input to the restore command | The key that opens archives must exist outside the database it protects (backup-config.ts:234; restore-command.ts:118). Leaves compose and deploy/.env. |
| `WAITRON_BACKUP_KEY_ROTATED_AT` | replace with activity_log | activity_log entry 'backup key rotated' | History, not a setting: the server writes it beside the key (backup-env-writer.ts:46) only to show when it last changed. |
| `WAITRON_BACKUP_SCHEDULE_DAYS` | delete | settings: backup document (schedule / retention) | Set nowhere outside tests; the dashboard record already holds schedule and retention (archive-settings.ts:34-44). Owner decision D1. |
| `WAITRON_BACKUP_AT` | delete | settings: backup document (schedule / retention) | Set nowhere outside tests; the dashboard record already holds schedule and retention (archive-settings.ts:34-44). Owner decision D1. |
| `WAITRON_BACKUP_INTERVAL_MS` | delete | settings: backup document (schedule / retention) | Set nowhere outside tests; the dashboard record already holds schedule and retention (archive-settings.ts:34-44). Owner decision D1. |
| `WAITRON_BACKUP_RETAIN` | delete | settings: backup document (schedule / retention) | Set nowhere outside tests; the dashboard record already holds schedule and retention (archive-settings.ts:34-44). Owner decision D1. |
| `WAITRON_BACKUP_RETAIN_DAYS` | delete | settings: backup document (schedule / retention) | Set nowhere outside tests; the dashboard record already holds schedule and retention (archive-settings.ts:34-44). Owner decision D1. |
| `WAITRON_BACKUP_STALE_AFTER_MS` | make a constant | constant (two days) | Set nowhere outside tests and read in both modes (backup-config.ts:294,329); an alert threshold nobody tunes. |
| `WAITRON_BACKUP_DESTINATION_TIMEOUT_MS` | delete | settings: backup document (destinationTimeoutMs, already a field) | Already a field of the dashboard record (archive-settings.ts:43); the env copy is the second source. |
| `WAITRON_PAYMENT_TEST_PROVIDERS` | move to settings | settings: payments document, testProviders (honoured only on a preproduction box) | A per-venue practice choice passed from deploy/.env (compose.yml:41); honouring it only in preproduction keeps the safety the env name gives (config.ts:399-407). |
| `WAITRON_FISCAL_TEST_SUBMISSIONS` | keep | env (environment family) | Says what kind of box this is for fiscal sending (config.ts:387-395); must never be dashboard-editable. Set only by tests in this repo. |
| `WAITRON_GOOGLE_CLIENT_ID` | move to settings | settings: identity document, googleClientId | An optional dashboard sign-in the owner registers with Google; set nowhere in the repo, not passed by compose, so a box gets it only by hand-editing. |
| `WAITRON_GOOGLE_CLIENT_SECRET` | move to the credentials store | tenant_credentials (purpose identity.google) | A secret; the sealed credentials store is where every other provider secret lives. |
| `WAITRON_CLOUD_ORIGIN` | keep | env (image/compose wiring; pass through compose) | Which Cloud this deployment talks to — wiring, not a venue choice. Today compose does not pass it, so a box can only get it by hand-edit. |
| `WAITRON_TUNNEL_RELAY_URL` | merge into the Cloud connection file | <state>/cloud-connection.json, written by Cloud pairing | Belongs to this physical box's Cloud pairing, which already lives in that file and is deliberately left out of recovery bundles (state-secrets.ts:13-15); box_settings would travel with node.db in backups. |
| `WAITRON_TUNNEL_BOX_ID` | merge into the Cloud connection file | <state>/cloud-connection.json, written by Cloud pairing | Belongs to this physical box's Cloud pairing, which already lives in that file and is deliberately left out of recovery bundles (state-secrets.ts:13-15); box_settings would travel with node.db in backups. |
| `WAITRON_TUNNEL_TOKEN` | merge into the Cloud connection file | <state>/cloud-connection.json (mode 0600, checked at cloud-client.ts:188) | A per-box secret issued by pairing; the file already holds the box's Cloud private key. |
| `WAITRON_TUNNEL_POOL_SIZE` | make a constant | constant (4) | Set nowhere outside tests. |
| `WAITRON_MIRROR_ALLOW_EXPOSED` | delete | (none) | Set nowhere outside tests (Cloud repo grep finds no use either); its only job is to switch off the guard that keeps a sign-in-free admin dashboard off the network (mirror-bind-guard.ts:1-3). Owner decision D3. |
| `WAITRON_SERVER_URL` | merge into WAITRON_PRINT_AGENT_SERVER_URL | WAITRON_PRINT_AGENT_SERVER_URL | One value with two names: compose copies one into the other (compose.yml:124). |
| `WAITRON_SETUP_URL` | merge into WAITRON_PRINT_AGENT_SETUP_URL | WAITRON_PRINT_AGENT_SETUP_URL | One value with two names (compose.yml:126). |
| `WAITRON_SETUP_PORT` | keep | env (port; print-agent image) | A port (Dockerfile:120). |
| `WAITRON_AGENT_NAME` | make a constant | host name (print-agent/src/config.ts:88) | Set nowhere outside tests. |
| `WAITRON_DEMO_MEDIA_SOURCE` | keep | env (image wiring) | Where the image puts demo photos (Dockerfile:269). |
| `WAITRON_BREAKGLASS_PASSWORD` | keep | one-off command input | Read only by a command an operator runs by hand. |
| `WAITRON_BREAKGLASS_PIN` | keep | one-off command input | Read only by a command an operator runs by hand. |
| `WAITRON_RECOVERY_PASSPHRASE` | keep | one-off command input | Read only by a command an operator runs by hand. |
| `WAITRON_NODE_RECOVERY_KEY` | keep | one-off restore-command input only | Keep for the command; drop the server start's env fallback (node-entry.ts:650-651; restore-request.ts:469-494), since the web form stages them in files — see Measure 1. |
| `WAITRON_RECOVERY_OPERATION_FILE` | keep | one-off restore-command input only | Keep for the command; drop the server start's env fallback (node-entry.ts:650-651; restore-request.ts:469-494), since the web form stages them in files — see Measure 1. |
| `WAITRON_ADMIN_PIN` | keep | one-off command input | Read only by a command an operator runs by hand. |
| `WAITRON_ADMIN_PASSWORD` | keep | one-off command input | Read only by a command an operator runs by hand. |
| `WAITRON_INITIAL_VENUE_INPUT` | keep | one-off command input | Read only by a command an operator runs by hand. |
| `WAITRON_SETUP_SETTINGS_FILE` | keep | one-off command input | Read only by a command an operator runs by hand. |
| `WAITRON_FISCAL_CUSTODIAN_FILE` | delete | (none) | Dead reader: allocation-configuration.ts is imported only by tests (grep), and production's hour-configuration replaces the historical `configure` that reads these with `configure: undefined` (initial-hour-setup.ts:108-115). Fiscal change, owner sign-off (backlog: retire the historical allocation formats). Decision D2. |
| `WAITRON_FISCAL_CUSTODIAN_FINGERPRINT` | delete | (none) | Dead reader: allocation-configuration.ts is imported only by tests (grep), and production's hour-configuration replaces the historical `configure` that reads these with `configure: undefined` (initial-hour-setup.ts:108-115). Fiscal change, owner sign-off (backlog: retire the historical allocation formats). Decision D2. |
| `WAITRON_FISCAL_CONFIRMATION_FILE` | delete | (none) | Dead reader: allocation-configuration.ts is imported only by tests (grep), and production's hour-configuration replaces the historical `configure` that reads these with `configure: undefined` (initial-hour-setup.ts:108-115). Fiscal change, owner sign-off (backlog: retire the historical allocation formats). Decision D2. |
| `WAITRON_FISCAL_EMERGENCY_DIRECTORY` | delete | (none) | Dead reader: allocation-configuration.ts is imported only by tests (grep), and production's hour-configuration replaces the historical `configure` that reads these with `configure: undefined` (initial-hour-setup.ts:108-115). Fiscal change, owner sign-off (backlog: retire the historical allocation formats). Decision D2. |
| `WAITRON_FISCAL_PAPER_HISTORY_FILE` | delete | (none) | Dead reader: allocation-configuration.ts is imported only by tests (grep), and production's hour-configuration replaces the historical `configure` that reads these with `configure: undefined` (initial-hour-setup.ts:108-115). Fiscal change, owner sign-off (backlog: retire the historical allocation formats). Decision D2. |
| `WAITRON_FISCAL_CLOUD_TRUST_FILE` | delete | (none) | Dead reader: allocation-configuration.ts is imported only by tests (grep), and production's hour-configuration replaces the historical `configure` that reads these with `configure: undefined` (initial-hour-setup.ts:108-115). Fiscal change, owner sign-off (backlog: retire the historical allocation formats). Decision D2. |
| `WAITRON_FISCAL_CLOUD_FINGERPRINT` | delete | (none) | Dead reader: allocation-configuration.ts is imported only by tests (grep), and production's hour-configuration replaces the historical `configure` that reads these with `configure: undefined` (initial-hour-setup.ts:108-115). Fiscal change, owner sign-off (backlog: retire the historical allocation formats). Decision D2. |
| `WAITRON_FISCAL_CLOUD_RECEIPT_DIRECTORY` | delete | (none) | Dead reader: allocation-configuration.ts is imported only by tests (grep), and production's hour-configuration replaces the historical `configure` that reads these with `configure: undefined` (initial-hour-setup.ts:108-115). Fiscal change, owner sign-off (backlog: retire the historical allocation formats). Decision D2. |
| `PATH` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `HOME` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `LANG` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `NODE_EXTRA_CA_CERTS` | keep | pass-through to the certificate-diagnosis child | Standard Node trust setting passed on unchanged (fiscal-certificate-diagnosis-runner.ts:39). |
| `SSL_CERT_FILE` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `SSL_CERT_DIR` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `MP_DATABASE` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `MP_MAX_MESSAGE_SIZE` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |

### Box install and host

| Current | Fate | Target | Why |
|---|---|---|---|
| `WAITRON_BUILD_ID` | keep | Docker build argument | Stamps the image at build time. |
| `WAITRON_SOURCE_METADATA` | keep | Docker build argument | Stamps the image at build time. |
| `WAITRON_IMAGE_CREATED` | keep | Docker build argument | Stamps the image at build time. |
| `WAITRON_IMAGE_REF` | keep | Docker build argument | Stamps the image at build time. |
| `WAITRON_IMAGE` | keep | deploy/.env, written by waitron.sh (compose wiring) | Compose wiring that waitron.sh manages (waitron.sh:218-228,361-391,403-439). |
| `WAITRON_PRINT_AGENT_IMAGE` | keep | deploy/.env, written by waitron.sh (compose wiring) | Compose wiring that waitron.sh manages (waitron.sh:218-228,361-391,403-439). |
| `WAITRON_PRINT_AGENT_APPARMOR` | keep | deploy/.env, written by waitron.sh (compose wiring) | Compose wiring that waitron.sh manages (waitron.sh:218-228,361-391,403-439). |
| `WAITRON_BOX_SOCKET_DIR` | keep | deploy/.env, written by waitron.sh (compose wiring) | Compose wiring that waitron.sh manages (waitron.sh:218-228,361-391,403-439). |
| `WAITRON_PRINT_AGENT_SERVER_URL` | keep | deploy/.env (compose wiring); the agent reads these names directly | The operator's override for an agent on another device. |
| `WAITRON_PRINT_AGENT_SETUP_URL` | keep | deploy/.env (compose wiring); the agent reads these names directly | The operator's override for an agent on another device. |
| `WAITRON_RECOVERY_PUBLIC_DIR` | delete | (none) | Exist only in a runbook marked 'Historical protocol, superseded 2026-10-19' (offline-fiscal-restore.md:1-8), to feed the dead WAITRON_FISCAL_* set. |
| `WAITRON_RECOVERY_INCIDENT_DIR` | delete | (none) | Exist only in a runbook marked 'Historical protocol, superseded 2026-10-19' (offline-fiscal-restore.md:1-8), to feed the dead WAITRON_FISCAL_* set. |
| `WAITRON_DIR` | keep | env (installer folder) | Where waitron.sh installs; an operator may move it (waitron.sh:15). |
| `WAITRON_SH_REFRESHED` | keep | internal marker | Stops the downloaded copy re-downloading itself (waitron.sh:75-78,139). |
| `WAITRON_SH_HEALTH_DELAY` | replace with test prefix | WAITRON_TEST_HEALTH_DELAY | Only scripts/waitron-sh.test.mjs sets it; one test-only prefix makes that visible in the production script. |
| `WAITRON_SH_MAX_HEALTH_TRIES` | replace with test prefix | WAITRON_TEST_HEALTH_TRIES | Only the waitron.sh test sets it. |
| `WAITRON_SH_SYSTEMD_DIR` | replace with test prefix | WAITRON_TEST_HOST_ROOT (one folder prefixed to every host path) | Four path overrides only the test sets (waitron-sh.test.mjs:442,464-466), all pointing into the test's sandbox; one root prefix replaces them. |
| `WAITRON_SH_BOX_LIB_DIR` | replace with test prefix | WAITRON_TEST_HOST_ROOT (one folder prefixed to every host path) | Four path overrides only the test sets (waitron-sh.test.mjs:442,464-466), all pointing into the test's sandbox; one root prefix replaces them. |
| `WAITRON_SH_BOX_UNIT_DIR` | replace with test prefix | WAITRON_TEST_HOST_ROOT (one folder prefixed to every host path) | Four path overrides only the test sets (waitron-sh.test.mjs:442,464-466), all pointing into the test's sandbox; one root prefix replaces them. |
| `WAITRON_SH_BLUETOOTH_DROPIN` | replace with test prefix | WAITRON_TEST_HOST_ROOT (one folder prefixed to every host path) | Four path overrides only the test sets (waitron-sh.test.mjs:442,464-466), all pointing into the test's sandbox; one root prefix replaces them. |
| `WAITRON_BOX_STATE_DIR` | replace with test prefix | WAITRON_TEST_HOST_ROOT | Only waitron-box-sh.test.mjs:117-121 sets them, all inside one sandbox folder; they also share the WAITRON_BOX_ prefix with the real compose name WAITRON_BOX_SOCKET_DIR. |
| `WAITRON_BOX_NTP_UNITS_DIRS` | replace with test prefix | WAITRON_TEST_HOST_ROOT | Only waitron-box-sh.test.mjs:117-121 sets them, all inside one sandbox folder; they also share the WAITRON_BOX_ prefix with the real compose name WAITRON_BOX_SOCKET_DIR. |
| `WAITRON_BOX_UPTIME` | replace with test prefix | WAITRON_TEST_HOST_ROOT | Only waitron-box-sh.test.mjs:117-121 sets them, all inside one sandbox folder; they also share the WAITRON_BOX_ prefix with the real compose name WAITRON_BOX_SOCKET_DIR. |
| `WAITRON_BOX_TIMESYNC_CLOCK` | replace with test prefix | WAITRON_TEST_HOST_ROOT | Only waitron-box-sh.test.mjs:117-121 sets them, all inside one sandbox folder; they also share the WAITRON_BOX_ prefix with the real compose name WAITRON_BOX_SOCKET_DIR. |
| `WAITRON_BOX_TIMESYNC_SYNCHRONIZED` | replace with test prefix | WAITRON_TEST_HOST_ROOT | Only waitron-box-sh.test.mjs:117-121 sets them, all inside one sandbox folder; they also share the WAITRON_BOX_ prefix with the real compose name WAITRON_BOX_SOCKET_DIR. |
| `WAITRON_BOX_READ_SECONDS` | replace with test prefix | WAITRON_TEST_READ_SECONDS | Only waitron-box-sh.test.mjs:304 sets it. |
| `NODE_ENV` | keep | image (Dockerfile:118,278) | No Waitron runtime reader (inventory grep), but bundled libraries may read it; harmless and standard. |
| `LC_ALL` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `HUSKY` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |

### Development

| Current | Fate | Target | Why |
|---|---|---|---|
| `WAITRON_TILL_VITE_PORT` | keep | development | Development tooling, not the product. |
| `WAITRON_DASHBOARD_VITE_PORT` | keep | development | Development tooling, not the product. |
| `WAITRON_SETUP_VITE_PORT` | keep | development | Development tooling, not the product. |
| `WAITRON_DEV_ENV_FILE` | keep | development | Development tooling, not the product. |
| `WAITRON_DEMO_REGION` | keep | development | Development tooling, not the product. |
| `WAITRON_SEED_LOCALE` | keep | development | Development tooling, not the product. |
| `WAITRON_SEED_SALES_DAYS` | keep | development | Development tooling, not the product. |
| `TESTCONTAINERS_RYUK_DISABLED` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `INKSCAPE` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `LITESTREAM_BIN` | merge into WAITRON_LITESTREAM_BIN | WAITRON_LITESTREAM_BIN | Same meaning, different name in the bench rig (bench/sqlite-failover/src/litestream.ts:95). |
| `M5_*` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |

### Tests and CI

| Current | Fate | Target | Why |
|---|---|---|---|
| `WAITRON_BENCH_ACCESS_KEY_ID` | keep | tests/CI | Test or rehearsal input; not the product. |
| `WAITRON_BENCH_SECRET_ACCESS_KEY` | keep | tests/CI | Test or rehearsal input; not the product. |
| `WAITRON_VERSITYGW_BIN` | keep | tests/CI | Test or rehearsal input; not the product. |
| `WAITRON_REQUIRE_STREAM_BINARIES` | merge into WAITRON_REQUIRE_TEST_TOOLS | WAITRON_REQUIRE_TEST_TOOLS | Two local spellings of what CI=true already does (full-disk.ts:16; aws-send-gate.e2e.test.ts:36); set nowhere in the repo. |
| `WAITRON_REQUIRE_FULL_DISK` | merge into WAITRON_REQUIRE_TEST_TOOLS | WAITRON_REQUIRE_TEST_TOOLS | Two local spellings of what CI=true already does (full-disk.ts:16; aws-send-gate.e2e.test.ts:36); set nowhere in the repo. |
| `WAITRON_FULL_DISK_DIR` | merge into WAITRON_FULL_DISK_ROOT | WAITRON_FULL_DISK_ROOT with fixed subfolder names (each still its own mount) | CI mounts four folders side by side under one parent (ci.yml:1270-1284) and passes four names (ci.yml:1293-1296). |
| `WAITRON_FULL_DISK_DIR_START_AGAIN` | merge into WAITRON_FULL_DISK_ROOT | WAITRON_FULL_DISK_ROOT with fixed subfolder names (each still its own mount) | CI mounts four folders side by side under one parent (ci.yml:1270-1284) and passes four names (ci.yml:1293-1296). |
| `WAITRON_FULL_DISK_DIR_FROM_SPARE` | merge into WAITRON_FULL_DISK_ROOT | WAITRON_FULL_DISK_ROOT with fixed subfolder names (each still its own mount) | CI mounts four folders side by side under one parent (ci.yml:1270-1284) and passes four names (ci.yml:1293-1296). |
| `WAITRON_FULL_DISK_DIR_BACKUP_ROOM` | merge into WAITRON_FULL_DISK_ROOT | WAITRON_FULL_DISK_ROOT with fixed subfolder names (each still its own mount) | CI mounts four folders side by side under one parent (ci.yml:1270-1284) and passes four names (ci.yml:1293-1296). |
| `WAITRON_TEST_TRACE_FILES` | keep | tests/CI | Test or rehearsal input; not the product. |
| `WAITRON_PRE_PUSH_FETCH_SECONDS` | keep | tests/CI | Test or rehearsal input; not the product. |
| `WAITRON_STARTUP_ENGINES` | keep | tests/CI | Test or rehearsal input; not the product. |
| `WAITRON_WRITE_GOLDEN` | keep | tests/CI | Test or rehearsal input; not the product. |
| `WAITRON_CANVAS_UPGRADE_RECEIPTS` | keep | tests/CI | Test or rehearsal input; not the product. |
| `WAITRON_STATION_ORDER_RECEIPT` | keep | tests/CI | Test or rehearsal input; not the product. |
| `WAITRON_PREPROD_PFX_BASE64` | merge into WAITRON_CERT_CHECK_* | WAITRON_CERT_CHECK_PFX_BASE64 / _PASSPHRASE / _NIF / _LEGAL_NAME | The same real certificate, passphrase, tax id and name as the certificate-check suite asks for (aeat.preprod.test.ts:7-10 vs aeat-certificate-check.preprod.test.ts:13-19); one set, typed once. |
| `WAITRON_PREPROD_PFX_PASSPHRASE` | merge into WAITRON_CERT_CHECK_* | WAITRON_CERT_CHECK_PFX_BASE64 / _PASSPHRASE / _NIF / _LEGAL_NAME | The same real certificate, passphrase, tax id and name as the certificate-check suite asks for (aeat.preprod.test.ts:7-10 vs aeat-certificate-check.preprod.test.ts:13-19); one set, typed once. |
| `WAITRON_PREPROD_NIF` | merge into WAITRON_CERT_CHECK_* | WAITRON_CERT_CHECK_PFX_BASE64 / _PASSPHRASE / _NIF / _LEGAL_NAME | The same real certificate, passphrase, tax id and name as the certificate-check suite asks for (aeat.preprod.test.ts:7-10 vs aeat-certificate-check.preprod.test.ts:13-19); one set, typed once. |
| `WAITRON_PREPROD_NOMBRE` | merge into WAITRON_CERT_CHECK_* | WAITRON_CERT_CHECK_PFX_BASE64 / _PASSPHRASE / _NIF / _LEGAL_NAME | The same real certificate, passphrase, tax id and name as the certificate-check suite asks for (aeat.preprod.test.ts:7-10 vs aeat-certificate-check.preprod.test.ts:13-19); one set, typed once. |
| `WAITRON_CERT_CHECK_PFX_BASE64` | keep | tests (also feeds the AEAT pre-production suite) | Hand-run real-certificate test input. |
| `WAITRON_CERT_CHECK_PASSPHRASE` | keep | tests (also feeds the AEAT pre-production suite) | Hand-run real-certificate test input. |
| `WAITRON_CERT_CHECK_KIND` | keep | tests (also feeds the AEAT pre-production suite) | Hand-run real-certificate test input. |
| `WAITRON_CERT_CHECK_ENVIRONMENT` | keep | tests (also feeds the AEAT pre-production suite) | Hand-run real-certificate test input. |
| `WAITRON_CERT_CHECK_NIF` | keep | tests (also feeds the AEAT pre-production suite) | Hand-run real-certificate test input. |
| `WAITRON_CERT_CHECK_LEGAL_NAME` | keep | tests (also feeds the AEAT pre-production suite) | Hand-run real-certificate test input. |
| `WAITRON_CERT_CHECK_ADDRESS_KIND` | keep | tests (also feeds the AEAT pre-production suite) | Hand-run real-certificate test input. |
| `WAITRON_INTERRUPT_FACTS` | keep | tests/CI | Test or rehearsal input; not the product. |
| `WAITRON_INTERRUPT_ENDPOINT` | keep | tests/CI | Test or rehearsal input; not the product. |
| `WAITRON_INTERRUPT_RECEIPT_DIR` | keep | tests/CI | Test or rehearsal input; not the product. |
| `TZ` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `TMPDIR` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `CI` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `AI_AGENT` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `CLAUDECODE` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `HTTPS_PROXY` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `NODE_OPTIONS` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `COMPOSE_FILE` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `COMPOSE_PROJECT_NAME` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `STRIPE_SECRET_KEY` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `GH_TOKEN` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `GITHUB_* (run identity)` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `GITHUB_OUTPUT, GITHUB_STEP_SUMMARY` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `GITHUB_WORKSPACE, RUNNER_TEMP` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `BASE_REF, SHA, EVENT, REF, REPOSITORY` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `SCOPE, PACKAGES` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `SHARD, TOTAL` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `NEEDS` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `REPO, RUN_ID, RUN_ATTEMPT, HEAD_SHA` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `JOBS_API_TRIES, JOBS_API_DELAY` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `OWNER` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `BASE_SHA` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `EXPECTED_SHA, EXPECTED_REF, EXPECTED_CREATED` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `GIT_HTTP_LOW_SPEED_LIMIT, GIT_HTTP_LOW_SPEED_TIME` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `GIT_TRACE2_EVENT` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `DEBUG` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `VITEST_PW_DEBUG` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `CODEQL_OVERLAY_DATABASE_MODE` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `STRYKER_MUTATOR_WORKER` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `CLOUD_TEST_*` | keep | tests (cross-repo contract with waitron-cloud) | Read by fixture scripts Waitron Cloud's tests start; renaming breaks that repo. |
| `DIAGNOSIS_PROCESS_TRACE` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `NO_LOCK` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `PROBE_ZONE, PROBE_CAPTURE` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `ZONE_PROCESS_MATRIX_TZ, ZONE_PROCESS_MATRIX_OBSERVED` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `PUSH_*` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `GH_STUB_HOLD` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `PYTHONPATH` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `WT_* (waitron.sh test stubs)` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `WT_* (CI main-recovery and tag-guard test stubs)` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `WT_BT_*` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `WT_RFCOMM_*` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `WB_*` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |

### One-off screenshot or rehearsal

| Current | Fate | Target | Why |
|---|---|---|---|
| `WAITRON_RUN_AWS_REHEARSAL` | keep | tests/CI | Test or rehearsal input; not the product. |
| `WAITRON_AWS_REHEARSAL_BUCKET` | keep | tests/CI | Test or rehearsal input; not the product. |
| `WAITRON_AWS_REHEARSAL_RECEIPT_DIR` | keep | tests/CI | Test or rehearsal input; not the product. |
| `AWS_PROFILE` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `AWS_REGION` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `AWS_SHARED_CREDENTIALS_FILE` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `AWS_CONFIG_FILE` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `AWS_ENDPOINT_URL` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `AWS_ENDPOINT_URL_S3` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `AWS_ACCESS_KEY_ID` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `AWS_SECRET_ACCESS_KEY` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `SUMUP_*` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `VITE_*_LOOK / _CAPTURE / _VISUAL` | keep | tests; prune each when its item is finished | One-off screenshot switches named after work items; I could not establish which items are finished, so none is marked dead here. |
| `A964_LOOK_DIR` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |
| `UI_PACKAGE_SCREENSHOTS` | keep | standard / third-party / tests and CI | Standard, third-party or test-harness variable; outside the product's list. |

## 4. How each worry is answered

**Performance.**
- Environment variables are parsed once at start, so fewer of them changes nothing at run time.
- The settings that move are read where they are used, and the payment path is the only hot
  one. Tips are read in `bill-payments.ts:976,1118` and `till-sale.ts:1455`. Today that value
  comes from the boot-time `TradingContext` (`boot.ts:1764-1771`). In the target it is one
  primary-key read of one small row, or a value held in memory and replaced whenever a save
  bumps the document's revision. One process owns the venue folder (root `CLAUDE.md` §3), so a
  held copy cannot go stale behind another writer.
- The house rule still applies: a value the till takes from its start read either refreshes
  through `setupRevision` or is listed as fixed until reload. Tips and display language must do
  one or the other.
- Constants cost nothing. They also remove a mismatch: health's staleness budget is computed from
  the default tick, not the configured one (`health.ts:21-26`).

**Data loss.**
- **The real risk is silent backup loss.** A box configured through `deploy/.env`
  (`WAITRON_BACKUP_DIR` with `WAITRON_BACKUP_RECOVERY_KEY`, `compose.yml:37-38`) would quietly
  stop backing up after an upgrade that drops those names. The answer is the retired-name refusal
  from §1: the box will not start while a moved backup variable is set, and the recovery page
  says "backups are now set on the dashboard's Backup screen". The cost is one start that does
  not sell, against months of missing backups noticed too late.
- **The root keys do not move between stores.** They stay in the same files with the same names
  and the same bundle and archive behaviour (`state-secrets.ts:16-23`;
  `backup-optional-state.ts:10-15`). The only key that moves is `WAITRON_ACCOUNT_KEY`, from
  `trading.env` to `secrets.env`. Both files are required members of every recovery bundle, so
  the account key travels exactly as before. Restore still writes `trading.env` last.
- **The tunnel token and Cloud pairing stay out of bundles** (`state-secrets.ts:13-15`), so a
  restored box does not impersonate the old one.
- **Deleting the `WAITRON_FISCAL_*` readers deletes no data.** Production does not read them.
  The change still goes through the fiscal sign-off the backlog asks for.

**Upgrades and migrations.**
- Fewer names in `compose.yml` and `deploy/.env.example` means fewer places where the image, the
  compose file and an operator's `.env` can disagree. `scripts/deploy-image-env.test.ts` already
  pins the ones that remain.
- The one list makes adding or retiring a variable a single edit. A guard compares it with every
  `WAITRON_[A-Z_]+` literal in source; that guard is weaker than its name, because it reads text,
  not what a program actually reads.
- Settings documents carry their own version and are validated on read, with code defaults for
  a missing field. Adding a field needs no table migration, and a missing document means "all
  defaults", so no migration has to seed rows.
- No backward-compatibility code is written: every box may be reset before go-live (root
  `CLAUDE.md` §3). The retired-name refusal is a check, not a data migration.
- One cross-repo contract has to move in step: Waitron Cloud's test script writes
  `WAITRON_BACKUP_DIR` into `backup.env` (`waitron-cloud/scripts/test-local-backups.mjs:471-474`).

## 5. Measure or test before building

1. **The server start's fallback to environment variables for the node recovery key and
   operation file.** Today a staged restore takes them from the process environment when its
   marker does not carry them (`restore-request.ts:469-494`; `node-entry.ts:650-651`). Remove
   the fallback in a worktree and run the restore and hour-recovery suites, plus
   `waitron-cloud`'s authorised-archive fixture, which sets `WAITRON_NODE_RECOVERY_KEY` on the
   command (`snapshot-authorised-archive.test.ts:95`). *If any current flow stages a marker
   without them,* the server keeps the fallback and the two names are listed as "command input
   or start input".
2. **Whether a hosted profile injects the vault key through the environment.** `box-env.ts:10-12`
   says "a cloud profile [can] inject the vault key without a `secrets.env`". In this repo only
   the Cloud fixture does that (`cloud-integration-fixture.ts:95,125`), and the `waitron-cloud`
   grep shows no `WAITRON_CREDENTIALS_KEY`. *If a real hosted profile does it,* the key ring's
   declared source becomes "box file, or environment for hosted profiles". That source must then
   be refused on an on-premises box, or the one-source rule fails for the most important secret.
3. **Tests that start the server as a child process and set a tuning variable.** Grep the
   child-process hosts (`apps/server/test/hour-recovery-host.ts`, the stream scenarios, the Cloud
   fixtures) for the tick and scheduler names. *If any does,* keep one test-only
   `WAITRON_TEST_TUNING` (a small JSON value) that the list honours only when `WAITRON_ENV=dev`,
   instead of an option passed in code.
4. **Proof that production ignores `WAITRON_FISCAL_*`.** The grep-and-read proof needs a run:
   on a dev box, set `WAITRON_FISCAL_CUSTODIAN_FILE` to a missing path and do a first fiscal
   setup and a restore. If production ignores the variable, both behave exactly as they do
   without it. *If either changes,* production reads it after all, and D2's deletion first needs
   its replacement path. Control: the same setting against the historical
   `allocation-configuration.ts` in its own test must fail on the missing file.
5. **The cost of reading tips on the payment path.** Time a card payment with tips read per
   request against the boot-time value. Run it on the bench box, never on the live dev slot.
   *If the read adds a measurable share of the payment's time,* hold the document in memory and
   replace it on revision change, which needs one invalidation point in the settings writer.
6. **Who sets the variables that leave the environment, outside this repo.** `wa-wt` sets dev
   ports and folders (inventory: `~/workspace/tools/wa-wt:55-57,136`). Check it sets none of the
   moved names. *If it does,* dev-setup writes the settings document instead.

## 6. Decisions for the owner

- **D1. Backups are set only on the dashboard.** Retire the environment route
  (`WAITRON_BACKUP_DIR`, `_DESTINATIONS`, schedule, retention and timeout). The box refuses to
  start while one of those names is still set, and the recovery page names the Backup screen.
  `deploy/.env` keeps only the image and agent lines.
  *Recommendation: yes.* Two sources with a hidden switch is the inconsistency the owner
  described, and the refusal turns the one data-loss risk into a visible stop.
- **D2. Delete the `WAITRON_FISCAL_*` readers now, as the first change.** This is the existing
  backlog item "Retire the historical allocation formats", landed with fiscal sign-off, together
  with the historical runbook's two folder variables.
  *Recommendation: yes, as its own fiscal PR, after Measure 4.*
- **D3. Remove the failover-only switches now:** `WAITRON_TENANT_DOMAIN`,
  `WAITRON_MIRROR_ALLOW_EXPOSED`, and `WAITRON_ADVERTISED_ORIGIN` as a separate name. When
  failover is designed, they come back as venue settings.
  *Recommendation: yes.* None is set outside tests, a venue has one node and no failover today,
  and the mirror switch exists only to switch off a safety guard.
- **D4. "One home for secrets" means one owning module and three files by lifecycle, not one
  file.** `WAITRON_ACCOUNT_KEY` moves from `trading.env` to `secrets.env`, and each root key gets
  one rotation command that logs to `activity_log`.
  *Recommendation: yes.* A single file would turn restore's whole-file rules into line-by-line
  edits in recovery code.
- **D5. Tips and display language become dashboard settings.** That means a tips switch on the
  Payments screen and an optional display-language choice on the Venue screen, instead of
  hand-edited environment lines nothing writes in production.
  *Recommendation: yes for tips, which changes what a payment offers. For display language, yes
  if staff in a venue may want a language other than the one geography gives. Otherwise delete
  the override and let geography decide, which builds less.*
