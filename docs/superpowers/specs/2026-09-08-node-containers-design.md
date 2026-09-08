# The node as two containers — design

**Date:** 2026-09-08
**Status:** approved design (brainstormed with the owner 2026-09-08); the plan follows.
**Track:** P (platform & packaging), push step 1 — the first of its three cuts. The other two
(the first-run chooser's modes 1–2; backup destinations mirror → S3 → Drive) are their own specs.
The bootable USB installer that runs this node's `prepare.sh` unattended is the NEXT Track P spec.
**Supersedes:** §15 of
[2026-08-26-appliance-onboarding-design.md](2026-08-26-appliance-onboarding-design.md) (which leaned
"stock Debian + systemd units" and called Docker Compose the technical path). Owner decision
2026-09-08 (`docs/backlog.md` → _Priorities_): a node is two containers, app + Postgres, with named
volumes; the cloud scales by many containers per server.

## 1. The problem, in one paragraph

Waitron's software side of "a blank box becomes a selling venue" exists: the server boots into a
**setup mode** when it has no venue, mints its own CA + certificate and secrets into a state
directory, serves the `apps/setup` wizard over HTTPS, provisions the venue through
`POST /setup-api/provision`, writes `trading.env` and asks to be restarted into **trading mode**
(`apps/server/src/boot.ts`, `setup-api.ts`, `trading-config.ts`). What does NOT exist is anything
that packages, starts, supervises or prepares it. Four gaps, each checked against the code:

1. **Nothing packages the app.** No Dockerfile anywhere; the only compose file is the dev Postgres
   (`docker-compose.yml`). The three web apps build with `vite build` but nothing puts their output
   where `WAITRON_{TILL,DASHBOARD,SETUP}_APP_DIR` could find it.
2. **Nothing prepares the database.** The database owned by `waitron_migrator`, its two login roles
   and the `waitron_repl` replication bootstrap are a manual CLI step (`waitron-provision instance`
   + `replicationBootstrapStatements`, `packages/provisioning/src/instance-apply.ts`,
   `replication-bootstrap.ts`). The setup boot then migrates the full schema itself
   (`boot.ts` — `applyMigrations` runs before the mode branch).
3. **Nothing starts the server the way it expects.** `dist/server.js` is `bin.ts`:
   `startServer(process.env)`. Trading mode reads the vault key ring and the `WAITRON_TILL_*` ids
   from the ENVIRONMENT, so something must load `<stateDir>/secrets.env` and `trading.env` first.
   The only thing that does is the dev launcher (`apps/server/scripts/dev-server.mjs`), whose header
   says the production equivalent is a systemd `EnvironmentFile=` pair — never written. The
   restart the wizard requests is `process.kill(process.pid, "SIGTERM")` (`boot.ts`), which assumes
   a supervisor that restarts an exited process.
4. **A container cannot see the LAN unless told how.** `listBoxIpv4` (`box-reach.ts`) enumerates
   interfaces; under Docker bridge networking it returns the container's `172.x` address, which is
   non-internal by `os.networkInterfaces` but unreachable from the venue — so the IP-QR would encode
   a dead URL and the self-signed leaf's SANs would cover the wrong address; mDNS multicast does
   not cross the bridge, so `waitron.local` stops resolving.

## 2. Decisions (owner, 2026-09-08)

- **Scope: containers alone.** Two images, one compose file, named volumes, the database bootstrap,
  networking, health/restart, a host-side `prepare.sh`, CI build + publish, and a run-it proof. The
  wizard's mode chooser and the backup destinations follow as separate specs.
- **Networking: host network on prem, bridge in the cloud.** The app container uses
  `network_mode: host` in the on-prem compose so mDNS, interface detection and port 443 work
  unchanged; Postgres stays on a private bridge publishing `127.0.0.1:5432` only. Because host
  networking cannot give many instances per server, the box's advertised addresses become
  INJECTABLE (`WAITRON_BOX_ADDRESSES`, §6) — the one code change that makes a bridge/cloud compose
  possible later without another one. This spec ships only the on-prem compose.
- **Database bootstrap: the app container, every start.** An entrypoint ensures the instance shape
  before the server boots, re-running safely, so a wiped-and-rejoined box gets its database back
  with no operator step.
- **Shipping: both.** A local `docker build` for speed and the run-it proof, and a CI job that
  builds and pushes to GHCR so the path a real box uses is exercised on every merge.
- **A box that will not boot must be recoverable without a shell.** The entrypoint keeps a
  consecutive-failure counter and, past a threshold, serves a recovery page itself instead of
  starting the server (§9). Only the supervisor half is built here; the actions an operator takes
  from that page — and any DEGRADED-but-trading mode — are the recovery spec's.
- **Plug in and go.** The restaurant never types anything on the box. Docker's restart policy
  restores the containers on every boot; the ONE-TIME preparation (`prepare.sh`) is non-interactive
  and idempotent so the bootable installer (next spec) can run it unattended. The phone is the
  screen: the box announces `waitron.local` only once it serves the setup page, and a console banner
  + QR show on a monitor if one happens to be attached.

## 3. The two images

### 3.1 The app image — `deploy/Dockerfile`, two stages

**Build stage** (`node:26`, pnpm 9.15.0 pinned from `package.json`'s `packageManager`): install the
workspace with `--frozen-lockfile`, then run the builds that already exist — `@waitron/server`'s
(`dist/server.js` + `dist/drizzle/` from `scripts/copy-migrations.mjs` + the four CLI bins
`bin-restore` / `bin-rejoin` / `bin-break-glass` / `bin-recovery`) and `vite build` for
`apps/till`, `apps/dashboard`, `apps/setup`. A new `dist/node-entry.js` (§5) is added to the
server's esbuild list.

**Runtime stage** (`node:26-slim`) copies only the build outputs into `/app` — `server.js`,
`node-entry.js`, the bins, `drizzle/`, `package.json` (the `{"type":"module"}` marker
`bundle-smoke` asserts) and the three web apps under `/app/web/{till,dashboard,setup}`. Two
installs, each measured rather than assumed (§13):

- **`postgresql-client-18`, from the PGDG apt repo — NOT Debian's own.** `node:26-slim` is Debian 13
  (trixie), whose base repos carry `postgresql-client-17` only, and `pg_dump` 17 REFUSES an 18
  server: `aborting because of server version mismatch / server version: 18.6; pg_dump version:
  17.11`, exit 1 — which would break the backup duty (`backup-sweep.ts` shells out to `pg_dump`)
  while everything else worked. Adding `apt.postgresql.org` (`trixie-pgdg`, keyring under
  `/usr/share/postgresql-common/pgdg/`) makes `postgresql-client-18` available (18.6-1.pgdg13+2)
  and the same dump succeeds. The client major must track §3.2's server major: bumping one without
  the other reintroduces exactly this failure, so the two version numbers are pinned in the
  Dockerfile beside a comment naming the other.
- **`libcap2-bin`, to `setcap cap_net_bind_service=+ep /usr/local/bin/node`.** Required by the
  on-prem profile specifically. Docker's own network namespace sets
  `net.ipv4.ip_unprivileged_port_start=0`, so a non-root process binds 443 unaided under BRIDGE
  networking — but `network_mode: host` shares the HOST namespace, where the kernel default 1024
  applies and the same bind fails `EACCES`. With the capability the bind succeeds in host mode and
  still succeeds in bridge mode, so the image carries it and both profiles work. (Docker's default
  capability set retains `CAP_NET_BIND_SERVICE`, so nothing is added at run time.)

Creates a `waitron` system user (fixed uid, §4); `USER waitron`.
`ENTRYPOINT ["node", "/app/node-entry.js"]`. No `CMD` arguments: the four CLIs are run by naming
their file (§10).

Fixed environment in the image (never operator-set): `WAITRON_STATE_DIR=/var/lib/waitron/state`,
`WAITRON_LOG_DIR=/var/lib/waitron/logs`, `WAITRON_MEDIA_DIR=/var/lib/waitron/media`,
`WAITRON_MIGRATIONS_DIR=/app/drizzle`, `WAITRON_{TILL,DASHBOARD,SETUP}_APP_DIR=/app/web/…`,
`WAITRON_HTTP_PORT=443`, `WAITRON_HTTP_HOST=0.0.0.0`, `WAITRON_MANAGEMENT_RP_ID=waitron.local` and
`WAITRON_MANAGEMENT_ORIGIN=https://waitron.local`. The server's own defaults for these are "beside
the bundle", which is a read-only image layer — every writable path is a volume (§4).

Three of those are corrections made while building the image, each with a measurement (task 8's
report carries both readings of each):

- **`WAITRON_HTTP_HOST=0.0.0.0`.** `config.ts` defaults it to `127.0.0.1`, which is right for a dev
  machine and serves nobody from a container. Without it the box comes up `healthy` — the
  healthcheck probes the same loopback — while every request from outside is reset at the TLS
  handshake. It is the one variable whose absence yields a container that reports healthy and
  serves nobody.
- **`WAITRON_MANAGEMENT_RP_ID` / `WAITRON_MANAGEMENT_ORIGIN`.** The wizard's "live" writes
  `WAITRON_ENV=production` into `trading.env`, and `config.ts` then REQUIRES both — they carry dev
  defaults only. Nothing else on a box sets them, so without them a restaurant that picks live gets
  `server.config_missing { variable: "WAITRON_MANAGEMENT_RP_ID" }` on every restart, for ever, with
  `restart: unless-stopped` guaranteeing the loop. They are pinned equal to `boot.ts`'s
  `BOX_HOSTNAME` by `apps/server/src/deploy-image-config.test.ts`, which loads the image's own
  declared environment under `WAITRON_ENV=production`.
- **`WAITRON_BACKUP_DIR` is NOT set** (it was listed here, and must not be). `loadBackupConfig` is
  fail-closed: a destination without `WAITRON_BACKUP_DATABASE_URL` and
  `WAITRON_BACKUP_RECOVERY_KEY` throws — `server.config_invalid {
  variable: "WAITRON_BACKUP_DATABASE_URL", reason: "required_with_backup_destination" }` fires
  first — so baking the path alone would take a box down at its first boot into trading, right
  after the wizard. The volume and its mount point stay; `compose.yml` passes the three together
  from the box's `.env`. Consequence, recorded in `docs/backlog.md`: a prepared box takes no
  backups until a human writes those three lines.

Image size is not a goal of this spec; correctness of the boot is. A slimmer image is a later
concern.

### 3.2 Postgres — stock `postgres:18-alpine`, no custom image

The compose `command:` carries the restart-required cluster settings exactly as the dev compose
does today: `wal_level=logical`, `track_commit_timestamp=on`, `max_slot_wal_keep_size=4GB`. The
backlog's "box image's `postgresql.conf`" IS this stanza. `pg_hba` stays the image's default
(`scram-sha-256` from any host) — safe because the database is never LAN-reachable (§6). The data
volume mounts at `/var/lib/postgresql` (the 18+ layout; the dev compose's comment records why not
`/data`). The image's `POSTGRES_PASSWORD` is the one secret the box needs before anything runs
(§7).

## 4. Volumes — a node's whole life is `docker volume`

Five named volumes, so nothing a node keeps outside Postgres lives anywhere else (cloud rule 4):

| volume | mounted at | holds |
| --- | --- | --- |
| `db` | `/var/lib/postgresql` | the cluster |
| `state` | `/var/lib/waitron/state` | `secrets.env`, `instance.env` (§5), `trading.env`, `modules.json`, the CA + leaf PEMs — the things that make this box THIS box |
| `logs` | `/var/lib/waitron/logs` | the rotating log (`WAITRON_LOG_DIR`), separate so it can be pruned without touching secrets |
| `backups` | `/var/lib/waitron/backups` | `LocalFsBackend`'s encrypted archives — the local destination; the mirror/S3/Drive destinations are the backup-destinations spec |
| `media` | `/var/lib/waitron/media` | product images — DELETED by the "images into Postgres" item (owner 2026-09-08); listed so the compose is complete today |

**Volume ownership is a boot-blocker, and the Dockerfile is what prevents it.** The runtime stage
MUST pre-create and `chown` all four `/var/lib/waitron/*` mount points to `waitron`: a fresh named
volume inherits the ownership of the image path it is mounted over, so a pre-created, chowned path
comes up owned by the app (`10001`, writable), while a path the image never created comes up
`root:root` and the non-root process cannot write to it at all (`Permission denied`) — measured
both ways, §13. A volume added later without its `mkdir`+`chown` in the image is therefore a boot
failure, not a warning. `state` files are 0600 already (`box-secrets.ts`).

## 5. The entrypoint — `apps/server/src/node-entry.ts`

The missing supervisor half, as a small TypeScript module bundled to `dist/node-entry.js` beside
`server.js`. Testable with the existing real-Postgres harness; no shell logic to mistrust. Every
start, in order:

1. **Wait for Postgres** on `WAITRON_BOOTSTRAP_DATABASE_URL` (the superuser URL compose derives
   from `.env`'s `POSTGRES_PASSWORD`, §7) — a bounded retry loop, the shape of `dev-setup.ts`'s
   `waitForPostgres`, exits non-zero with `server.config_missing` if the variable is unset.
2. **Ensure the instance — the database, its roles and the replication bootstrap, and NOTHING
   else.** Read the cluster's state with `readInstanceState`, plan with `planInstance`, apply with
   `applyInstance` — the same three functions `waitron-provision instance` runs, so the on-box
   shape and the CLI's stay one code path. Two constraints make this safe, and both are load-
   bearing:

   **It must never stamp. It migrates ONLY to unblock a virgin cluster.** `planInstance` emits
   both a `stamp` and a `migrate` action. The entrypoint never applies `stamp`; it applies `migrate`
   **only when the cluster has no `app_user` role**, and otherwise filters it out along with
   `stamp`.

   That condition is not a nicety — it is forced from both sides. `app_user` is created by the CORE
   MIGRATION (`packages/db/drizzle/0001_db_baseline_sql.sql`: `CREATE ROLE app_user NOLOGIN`), and
   `planInstance` emits `migrate` BEFORE the `grant-membership waitron_migrator → app_user` and the
   `create-role waitron_app … IN ROLE app_user` that depend on it. Filtering `migrate` unconditionally
   therefore makes a blank box fail every boot with `role "app_user" does not exist` — it would never
   provision at all. But applying it unconditionally is wrong too: `applyInstance`'s migrate case runs
   `manifestSets()`, the FULL manifest, so it would migrate modules the operator has disabled, which
   `boot.ts`'s trading branch deliberately does not (it migrates `enabledModules` only, keeping a
   soft-disabled module's data without applying its new migrations).

   Gating on `app_user`'s existence resolves both: a virgin cluster migrates once, here, which is
   the same full-schema migration setup mode would run anyway (`setup-migrates-all`, and there is no
   `modules.json` yet); every later start leaves migrations entirely to `boot.ts` and its filter. A
   wiped-and-rejoined box keeps its cluster-global roles, so it takes the later path. `app_user` is
   the honest condition because it is precisely the thing the remaining actions depend on — narrower
   and more checkable than "has anything been migrated", whose journal-watermark ambiguity
   `instance-plan.ts` records as having caused a real bug.

   Stamping is the dangerous one: `stampDeployment` is PERMANENT and one-way — a second stamp that disagrees throws
   `deployment.already_stamped` — and the environment is not known before the operator chooses it
   in the wizard. An entrypoint that stamped `preproduction` on first boot would make the box
   permanently unable to be provisioned as PRODUCTION (the wizard's own
   `provisionVenue` → `stampDeployment` would throw), which is unrecoverable without dropping the
   database. Stamping stays where the operator's choice is: the wizard, at provision time.

   **The environment it passes is read from the database, never guessed.** `planInstance` REFUSES
   up-front when `state.inside.stamp` disagrees with the requested environment
   (`instance-plan.ts` — `deployment.already_stamped`, thrown before any action is emitted), so a
   guessed value would brick every boot of an already-stamped box, not just the first. The
   entrypoint therefore passes `state.inside.stamp` when the database carries one, and
   `preproduction` only when it carries none — where no disagreement is possible and the stamp
   action is filtered away regardless. `WAITRON_ENV` is deliberately NOT consulted here: the
   database's own stamp is the authority (CLAUDE.md §5, one database per environment).

   Then the replication bootstrap, on ONE superuser connection to the TARGET database (its
   schema-local statements land in whichever database the connection is on). Two questions, asked
   separately: if `waitron_repl` does not exist at all, run the full
   `replicationBootstrapStatements`; if it exists but this DATABASE lacks the migrator's default
   SELECT for it (`readReplicationReadiness`'s `replicationHasDefaultSelect`), re-issue only
   `replicationSchemaGrantStatements` — the full array would fail at `CREATE ROLE` on the surviving
   role. A `waitron_repl` that exists WITHOUT `LOGIN REPLICATION` is refused
   (`provisioning.role_unusable`), never `ALTER`ed: the tool did not create it and does not know its
   password, the same rule `assertUsable` applies to the two instance roles. `readReplicationReadiness`'s
   own `replicationRolePresent` is deliberately NOT the create-it gate — it is the conjunction of
   existence and both attributes, so it reads "absent" for a role that exists, and `CREATE ROLE` then
   returns `42710` on every start forever. The generated passwords are written ONCE, BEFORE those
   statements run, to `<state>/instance.env` (0600, via
   `formatEnvFile`/`writeFileAtomic`) as `DATABASE_URL` (the `waitron_app` login),
   `WAITRON_MIGRATIONS_DATABASE_URL` (the migrator) and `WAITRON_REPLICATION_PASSWORD`, each
   pointing at `127.0.0.1:5432/waitron`; every later start reads them back and `planInstance` emits
   only what is missing. They are captured off the `create-role` actions, which carry the generated
   password — the CLI prints them for the same reason, and neither can recover a password it did
   not generate.

   **A rejoin needs MORE than the instance plan, and this was measured rather than reasoned about.**
   An earlier version of this paragraph claimed, under the words "checked, not assumed", that a
   rejoined box "presents database-exists + roles-exist + nothing-inside — for which this step plans
   no actions at all". The instance-plan half is right; the replication half was false, and a real
   container disproved it: `ensureInstance` → `drop database … with (force)` → `ensureInstance` left
   `replicationHasDefaultSelect: false` with **zero** `pg_default_acl` rows. `pg_authid` is
   CLUSTER-SHARED while `pg_default_acl` and table grants are PER-DATABASE, so
   `dropAndCreateDatabase` (`db-wipe.ts`, the R3 rejoin wipe) takes the two schema-local grants with
   the database while `waitron_repl` itself survives — and a gate that asks only whether the role
   exists skips the bootstrap and leaves the recreated database with no SELECT for it. Nothing fails
   at boot; it surfaces at the next adopt as `provisioning.replication_not_ready`, or as a silently
   empty initial COPY at a promotion. Hence the split above: the entrypoint DOES do work on a rejoin,
   re-issuing `replicationSchemaGrantStatements` against the new database.

   It also closes a gap `db-wipe.ts`'s header records: a crash between its drop and its create leaves
   the box dropped-not-created and "does not self-recover on re-run". Under this entrypoint it does —
   the next start plans the one `create-database` and continues.

   > **Cross-track note — supersedes CLAUDE.md §3 for a containerised node.** §3's replication bullet
   > states that "the replication role is a bootstrap the app provisioner only verifies… The app
   > performs none of it — `assertReplicationReady` verifies it instead." This design deliberately
   > moves that bootstrap INTO the container entrypoint, because the whole point of the image is that
   > a blank box needs no operator step: there is no box-image author standing between the container
   > and its first boot. `ensureInstance` therefore PERFORMS the bootstrap, and the contradiction is
   > real, not apparent. It is recorded here rather than fixed: CLAUDE.md §2–§5 belongs to another
   > track's session, so that edit needs coordinating with the track that owns it.

3. **Load the env files** into the process environment: `instance.env`, then `secrets.env`, then
   `trading.env` — **a variable already present in the environment always wins over a file**.
   That is cloud rule 4's cheap half: a cloud profile can inject `WAITRON_CREDENTIALS_KEY` from the
   environment without touching this file. (The other half — `ensureBoxSecrets` honouring an
   env-provided key instead of minting one in setup mode — is the cloud profile's, not built here.)
   `WAITRON_BOOTSTRAP_DATABASE_URL` is DELETED from the environment here: the running server never
   holds superuser credentials; its owner connection is the migrator via
   `WAITRON_ADMIN_DATABASE_URL`, which the entrypoint sets to `instance.env`'s migrator URL — the
   role that owns the tables, as `boot.ts`'s setup branch documents.
4. **Read the escalation level** from `<stateDir>/recovery.json` (§9) and act on it. This happens
   FIRST, before step 1's wait and step 2's bootstrap — a database-side failure is exactly what puts
   a box in recovery, so ordering the decision after them would make the page unreachable in most of
   the cases it exists for. At the recovery level the entrypoint serves the page and never starts
   the server; otherwise it proceeds through steps 1–3 and starts it.
5. **Start the server** through the one start/shutdown routine `bin.ts` uses today, lifted into a
   shared `runServer(env)` (`apps/server/src/run-server.ts`) so `bin.ts` and `node-entry.ts` hold no
   second copy of the signal handling. `runServer` reports one extra signal the entrypoint needs —
   that the boot STAYED UP (§9.2) — so a failure counter can be cleared honestly. A restart the
   server requests (`SIGTERM` to itself → exit 0) is a real reboot under `restart: unless-stopped`
   (§8); a boot that THROWS increments the counter and exits non-zero, and Docker restarts it into
   the next level.

The dev path is untouched: `dev-server.mjs` still sources the files itself and runs `bin.ts`;
`docker-compose.yml` stays the dev Postgres.

## 6. Networking

**On prem (the shipped compose):**

```
app   network_mode: host      # mDNS answers on the LAN, listBoxIpv4 sees the real addresses,
                              # 443 binds directly
db    networks: [internal]    # private bridge
      ports: ["127.0.0.1:5432:5432"]   # the app reaches it on loopback; the LAN never can
```

`WAITRON_ADVERTISED_ORIGIN` stays `https://waitron.local` (the `BOX_HOSTNAME` constant);
`WAITRON_HTTP_PORT=443` so every reach URL omits the port (`urlFor`, `box-reach.ts`).

**The address override — `WAITRON_BOX_ADDRESSES`** (comma-separated IPv4 literals). When set, it
replaces interface sniffing at every consumer of `listBoxIpv4` and its private twin
`defaultListIpv4` (`box-secrets.ts`'s SAN source): the leaf's SANs, `buildReachInfo` (the QR and
discovery), and the mDNS responder's `getAddresses`. `config.ts` parses it (each entry a valid
IPv4, none loopback, empty string = unset per the file's `isUnset` rule; a bad entry is
`server.config_invalid` with `variable: "WAITRON_BOX_ADDRESSES"`). Unset, today's behaviour is
byte-for-byte unchanged. This is what a bridge/cloud compose sets — and what the Mac proof sets
(§11), since Docker Desktop's `--network host` places the container on the Linux VM's network
(`192.168.65.x`, measured 2026-09-08 with `docker run --rm --network host alpine ip -4 addr`), not
on the Mac's LAN.

`box-reach.ts`'s header records that its copy of the IPv4 reader is a deliberate duplicate of
`box-secrets.ts`'s; the override retires that duplication — one reader in `box-reach.ts`, both
consumers import it, and the header's justification is deleted with it (a behaviour change retires
its receipts, CLAUDE.md §1).

## 7. Secrets and the compose `.env`

A box needs exactly ONE secret before anything runs: the Postgres admin password, because the `db`
container consumes `POSTGRES_PASSWORD` at first start. `deploy/prepare.sh` (§8) generates it into
`deploy/.env` (`openssl rand -hex 32`; never printed) and the compose derives both
`POSTGRES_PASSWORD` for `db` and `WAITRON_BOOTSTRAP_DATABASE_URL=postgres://postgres:${POSTGRES_PASSWORD}@127.0.0.1:5432/postgres`
for `app`. `deploy/.env.example` documents the two lines it may hold; `.env` is gitignored already
(root `.gitignore`).

Everything else stays as built: the vault key ring, the CA + leaf PEMs and the node secrets are
minted by `ensureBoxSecrets` on the first setup boot into the `state` volume, file-only, 0600. The
compose `.env` does NOT set `WAITRON_ENV`: the wizard decides demo/live and writes it into
`trading.env` (`writeTradingEnv`), so "`production` must be typed out" keeps its one home
(CLAUDE.md §5). An operator who wants a production box types it in the wizard, not in a file on the
box.

## 8. Start, health, restart — and the one-time preparation

**Restart.** Both services `restart: unless-stopped`. Docker restarts such a container on every
daemon start (so on every boot of the box) and after any exit, including the server's own
requested restart. `app` `depends_on: db: condition: service_healthy` with the dev compose's
`pg_isready` healthcheck copied over, so the entrypoint's wait loop is a backstop, not the
mechanism.

**Health.** The app healthcheck is a Node one-liner (`node -e …`, no curl in a slim image) that
reports healthy when EITHER `GET /health` or `GET /setup-api/status` returns 200 over the box's own
TLS (certificate verification off for the probe — it is loopback, and the cert is the box's own).
`/health` is deliberately 503 on a setup box (no duty loop → not trading-healthy;
`docs/backlog.md` → _Constraints for the firmware slices_), and `/setup-api/status` exists only in
setup mode (`mountSetup` is inside `boot.ts`'s setup branch), so a probe on either alone would
restart-loop one of the two modes. Interval 10 s, start period 60 s (the setup boot runs every
migration first).

**Logs.** The server already writes its JSON lines to stdout, so `docker compose logs` works; the
rotating file log lands in the `logs` volume. The compose caps the json-file driver
(`max-size: 10m`, `max-file: 5`) so a chatty box cannot fill the disk twice over.

**The one-time preparation — `deploy/prepare.sh`.** Run ONCE by whoever prepares the box (the
bootable installer of the next spec, or a person at a terminal); never by the restaurant.
Non-interactive and idempotent — every step is a no-op when already done:

1. install Docker Engine + the compose plugin if `docker compose version` fails (Debian/Ubuntu via
   Docker's apt repo; any other distro prints the one-line reason and exits 2 — the installer spec
   picks the distro);
2. `systemctl enable --now docker` so the daemon starts on boot;
3. copy `compose.yml` + `.env.example` to `/opt/waitron/` if absent; generate `.env` if absent
   (§7);
4. `docker compose pull` (the image is public on GHCR, §10) and `docker compose up -d`;
5. print — and, when `/dev/tty1` is writable, show on the console — the banner
   `Waitron is ready — open https://waitron.local on your phone` with a QR of that URL
   (`qrencode -t ANSIUTF8`, installed alongside), preceded by `Installing…` while steps 1–4 run.

A headless box therefore needs no screen: `waitron.local` resolves only once the app is serving
the setup page (the mDNS responder starts inside `startServer`), so "open it on your phone; if it
doesn't load, wait a minute" is the whole instruction. LEDs, beeps and anything hardware-specific
are explicitly not built — Waitron does not control the box.

## 9. Recovery when boot fails — the supervisor half

**Why this belongs here and not in the recovery spec.** The entrypoint is the only thing that
outlives a server that will not start, so it is the only thing that can serve a page to an operator
with no shell. It is being written fresh in §5; the escalation state it keeps shapes its structure,
and retrofitting that is dear. The *actions* an operator takes from that page — restore from
backup, roll back the image, undo the last module change — are the recovery spec's, not this one's.

**The failure mode this exists for.** Today a module is compiled into the image (`ALL_MODULES` is a
static import), so a box is bricked by a bad UPDATE, not a bad plugin. That changes: modules become
installable at runtime (owner, 2026-09-08 — choose Spain and the Veri\*Factu module is downloaded;
enable QR-at-table ordering, restart; remove it later, restart). Install → restart → will-not-boot
then becomes a ROUTINE path rather than a rare one, and the most valuable recovery action becomes
*undo the last module change and restart*. This section's state is shaped for that world even though
this spec cannot yet test against a real bad module.

### 9.1 One degraded level, not two — and why safe mode is NOT built here

The obvious design is a middle level: keep trading with the broken optional module switched off.
**It cannot be built on the tiers that exist, and shipping it anyway would be worse than shipping
nothing.** Every module but `core` and the two fiscal ones is `toggleable`
(`packages/composition/src/modules.ts`), and that set includes `identity` (persons, sessions, PIN
login, `authorize()`), `credentials` (the vault holding the AEAT certificate and the Stripe keys)
and `payments`. A "safe mode" that disabled every `toggleable` module would leave a box that cannot
log anyone in, cannot take a card and cannot unseal its certificate — it could not sell, which is
the one thing such a mode exists to preserve. `toggleable` means "an operator may choose not to have
this domain at provisioning time", never "a till still works without it".

Building it properly needs a new fact each module declares — whether a till can sell without it —
which is a change to the module CONTRACT (`packages/module`, `packages/composition`) and therefore
Track C's files, not Track P's. It is handed to the recovery spec with that constraint stated.
So this spec ships exactly one degraded level:

| level | what runs | can it sell? |
| --- | --- | --- |
| **normal** | the server | yes |
| **recovery** | no server; the entrypoint serves a recovery page | no |

The fiscal direction is unchanged and is the one that must never be softened: a box that cannot
hash-chain a sale locally must REFUSE to sell rather than sell unfiled. A bricked box is
recoverable; a hole in the invoice series is not (CLAUDE.md §5). Recovery mode satisfies that
trivially by running no server at all.

### 9.2 The escalation, and what resets it

`<stateDir>/recovery.json` (0600, `writeFileAtomic`) holds the consecutive-failure count and the
last failure's error code + timestamp — in the state volume, so it survives the container restart
Docker performs, and per-node, never replicated. The level is always DERIVED from the count on
read, never trusted from the file, so a hand-edited value cannot pin a box into recovery.

Normal → **recovery** after 3 consecutive failed boots. The entrypoint increments the count
**before** starting the server, not in a failure handler: a boot that HANGS never throws, and a
counter written only on a caught error would leave such a box restart-looping forever without ever
escalating. It clears the count only on a boot that STAYS UP — `startServer` resolved (migrations
applied, pools open, listener bound) and the process then survived 120 s. Clearing on "started"
alone would be a measurement where both answers look alike (CLAUDE.md §1): a module throwing five
seconds in would reset the counter on every attempt, and the box would never escalate.

`startServer` resolving is deliberately the signal, rather than a healthy `/health` probe:
`/health` is 503 on a setup box by design (§8), so a health-gated reset would treat every
unprovisioned box as a failing one and drive a perfectly good new box into recovery mode.

### 9.3 What the recovery page serves

**It is served before anything else can fail.** The entrypoint reads `recovery.json` — which needs
only the state volume — and decides FIRST, before waiting for Postgres and before the instance
bootstrap. Ordering it after those would make the page unreachable in most of the cases it exists
for, since a database-side failure is exactly what puts a box here.

A small HTTP surface on the same port, presented with the box's existing CA + leaf from the state
volume (`ensureBoxSecrets` has already minted them by the time a box can be in this state), so the
operator's already-trusted phone reaches it at the same URL with no new trust step. It states what
failed (the consecutive count, the last error code, the last 200 log lines) and offers one action:
**retry a normal boot** — a counter reset plus an exit, letting Docker's restart policy do the
restart.

Deliberately NOT here — the recovery spec designs each, and each needs its own thinking: a
degraded-but-trading mode (§9.1's module-contract change); restore from a backup over the web
(`waitron-restore` exists but is shell-only); rolling back to the previous image (the running
container cannot pull its own replacement — this likely needs the Docker socket or a second
always-up container, a real security decision); undoing the last module change (needs the
installable-module mechanism to exist first); and what to do about a migration that half-applied,
which no restart can fix.

**The honest limit of this hook:** it recovers a box whose SERVER will not boot. It cannot recover
one whose ENTRYPOINT will not run — a corrupt image or a bad entrypoint change — nor one whose
state volume has no minted certificate yet (a box that has never completed a single setup boot has
nothing to serve the page WITH; it falls back to plain HTTP on the same port, stated here rather
than left implicit). Those cases still need a shell or the bootable USB re-install of the next
spec. Keeping the entrypoint small and rarely-changed is what makes the limit acceptable.

## 10. Shipping, updating, operating

**Local:** `pnpm build:image` at the root runs `docker build -f deploy/Dockerfile -t waitron:dev .`.
This is what the run-it proof uses and what a developer iterates on.

**CI (`image` job in `ci.yml`, gated like every code job):** on every code PR, `docker buildx
build` with GHA layer caching, then a compose smoke against fresh volumes in the runner (§11). On a
push to `main` it also logs into GHCR with `GITHUB_TOKEN` and pushes
`ghcr.io/<owner>/waitron:main`, `:sha-<short>` and, for a `v*` tag, `:<version>`; the manifest is
`linux/amd64,linux/arm64` on pushes (QEMU for arm64, so a small ARM box works) and amd64-only on
PRs (speed). A `deploy/**` entry in `scripts/changed-scope.mjs` would be an OPTIMISATION,
not a correctness fix: the classifier is an allowlist of INERT paths, not of code paths, so
`deploy/**` already classifies as code today — measured, `classify(["deploy/Dockerfile"])` returns
`{ code: true, reason: "deploy/Dockerfile is not documentation" }` and
`scopeForPaths(["deploy/Dockerfile"])` returns `{ kind: "global" }`. A deploy change therefore runs
MORE CI than a package change, not less; an entry would narrow it to the image job.

**Updating a box:** `docker compose pull && docker compose up -d` — the compose pins `:main` until
release tags exist. Unattended updates are the installer spec's question (a box we did not sell
still needs them).

**Operating:** the four CLIs run from the image, and HOW the entrypoint is bypassed differs by
command — a distinction `deploy/README.md` must state, because getting it wrong re-runs the
bootstrap in the middle of a cold restore:

- `docker compose exec` IGNORES the image's `ENTRYPOINT`, so a command that needs the server
  RUNNING is simply `docker compose exec app node /app/bin-break-glass.js …`.
- `docker compose run` APPENDS its arguments to the entrypoint rather than replacing it, so the two
  commands that need the server STOPPED must override it explicitly:
  `docker compose stop app && docker compose run --rm --entrypoint node app /app/bin-restore.js …`,
  then `up -d`. The same `--entrypoint` applies to any `docker run` against this image.

## 11. Testing and the run-it proof

**Unit + real Postgres (`apps/server`, `describeEachTarget` where the harness fits):**

- `node-entry.test.ts`: the env-merge order — environment beats file, file order
  `instance` < `secrets` < `trading` — proven by deleting the rule and watching the test fail; the
  bootstrap URL is absent from the environment handed to `runServer`.
- `node-entry.pg.test.ts` (Testcontainers, superuser): a blank cluster → one run creates the
  database, both roles, the replication role and `instance.env`; a SECOND run plans zero actions
  and leaves `instance.env` byte-identical; `DROP DATABASE waitron WITH (FORCE)` then a run →
  exactly one `create-database`, and the app login from `instance.env` can still connect.
- `config.test.ts`: `WAITRON_BOX_ADDRESSES` parsing (valid, loopback refused, empty = unset, a
  non-IPv4 entry → `server.config_invalid`); `box-reach.test.ts` / `box-secrets.test.ts`: the
  override reaches the SANs and the reach URLs.
- `run-server.test.ts`: `bin.ts`'s lifted start/shutdown routine keeps its two behaviours (exit 0
  on a clean close, `server.shutdown_failed` + exit 1 otherwise).
- `recovery-escalation.test.ts` (§9): three consecutive failed boots reach recovery mode; a boot
  that stays up past the threshold resets to normal; a boot that starts and THEN throws inside the
  threshold does NOT reset — proven by deleting the stayed-up condition and watching the box never
  escalate (the negative control §9.2's reasoning rests on). The counter is written BEFORE the
  server starts, proven by a hanging boot that never throws and must still escalate — the case a
  catch-only counter loses. The recovery decision is proven to precede the Postgres wait by a test
  whose `waitForPostgres` throws: the page is still served.

**CI smoke (the `image` job):** build → `docker compose -f deploy/compose.yml --env-file <generated>
up -d --wait` against a throwaway project name → assert `GET https://127.0.0.1/setup-api/status` is
200 with `environment: "preproduction"` and `GET /setup-api/ca.crt` returns the PEM whose subject
`ensureBoxSecrets` mints → `down -v`. The runner is Linux, so this is host networking, the shipped
shape. The 443 bind as non-root is proven here every merge.

**The run-it proof, recorded in the PR** (blank volumes → wizard → selling): on this Mac,
`pnpm build:image`, then the compose with an override file that publishes `443:443` and sets
`WAITRON_BOX_ADDRESSES=<the Mac's LAN IP>` (Docker Desktop cannot put a container on the LAN, §6) —
which is also the first exercise of the bridge/cloud shape. Open the wizard on a phone, trust the
CA, provision a PREPRODUCTION venue, watch the container restart into trading mode, enrol the till,
record one sale. The host-network variant is run on a Linux box when one is at hand and its receipt
added to this file with a date. What the FAILING case prints is stated before each step
(CLAUDE.md §1): e.g. a bridge-shaped SAN list shows `172.` in `openssl x509 -text`; the override
working shows the LAN IP there and nothing else.

## 12. Out of scope, named

The recovery spec (the immediate follow-on to this one): a degraded-but-trading mode and the
module-contract field it needs (§9.1 — Track C's files), restore-from-backup over the web, image
rollback, undoing the last module change, per-module fault isolation at mount, and what to do about
a half-applied migration. Runtime-installable modules themselves (the
signed-bundle distribution mechanism) — §9 is shaped for that world but does not build it.

The wizard's four-mode chooser (modes 1–2 next); backup destinations (mirror → S3 → Drive); images
into Postgres (deletes the `media` volume); the HTTP landing page on port 80 + the name-constrained
CA (the LAN-HTTPS item); WireGuard on the box; a cloud compose (the override makes it possible; the
file is written when Waitron Cloud starts); the bootable USB installer (next spec — it runs
`prepare.sh`; open questions it owns: whether the stick carries the images so install needs no
internet, unattended updates for a box we did not sell, AP-mode WiFi onboarding); the appliance
OS image; a slimmer image.

## 13. Provenance

| claim | source | checked |
| --- | --- | --- |
| The server expects a supervisor to load `secrets.env` + `trading.env` and none exists | `apps/server/scripts/dev-server.mjs` lines 14–25; `apps/server/src/bin.ts` (`startServer(process.env)`) | read 2026-09-08 |
| The wizard's restart is `SIGTERM` to self | `apps/server/src/boot.ts` `requestRestart: () => process.kill(process.pid, "SIGTERM")` | read 2026-09-08 |
| `/health` is 503 on a setup box; `/setup-api/status` is setup-only | `docs/backlog.md` firmware constraints; `boot.ts` mounts `mountSetup` inside the setup branch; `health.ts` registers `/health` for both | read 2026-09-08 |
| Bridge networking yields a `172.x` address from `listBoxIpv4` | `os.networkInterfaces` marks only loopback `internal`; `box-reach.ts` header anticipates "a container with only loopback" | read; to be shown in the proof's failing-case print |
| Docker Desktop `--network host` on macOS is the VM's network | `docker run --rm --network host alpine:3.20 ip -4 addr` → `192.168.65.3/24 eth0` | measured 2026-09-08, Docker 29.3.0 |
| `restart: unless-stopped` restarts on daemon start and after any exit | Docker docs, "Start containers automatically": _"unless-stopped: Similar to always, except that when the container is stopped (manually or otherwise), it isn't restarted even after Docker daemon restarts."_ — i.e. a container not manually stopped IS restarted | to be re-quoted from the live page in the plan |
| `node:26-slim` is Debian 13 (trixie); its base repos carry `postgresql-client-17`, not 18 | `docker run --rm node:26-slim` → `VERSION_CODENAME=trixie`; `apt-cache policy postgresql-client-18` empty, `apt-cache search '^postgresql-client'` lists 17 | measured 2026-09-08 |
| `pg_dump` 17 refuses an 18 server; PGDG's 18 client succeeds against the same server | against `postgres:18-alpine` (server 18.6): pg_dump 17.11 → `aborting because of server version mismatch / server version: 18.6; pg_dump version: 17.11`, exit 1. Control, same server, PGDG pg_dump 18.6 → dump succeeded | measured 2026-09-08, both directions |
| PGDG `trixie-pgdg` supplies `postgresql-client-18` on this base | `apt-cache policy` after adding the repo → `Candidate: 18.6-1.pgdg13+2` | measured 2026-09-08 |
| Non-root bind to 443 fails under HOST networking and succeeds under bridge; `setcap` fixes host | same image, non-root: bridge → `listening on 443` (`ip_unprivileged_port_start` = 0); `--network host` → `FAILED EACCES` (host namespace = 1024); with `setcap cap_net_bind_service=+ep` on `/usr/local/bin/node` → `listening on 443` in host mode AND bridge, `getcap` shows `cap_net_bind_service=ep` | measured 2026-09-08, three-way with controls. Taken in Docker Desktop's Linux VM — 1024 is the kernel default, to be re-confirmed on the real Linux box at §11's host-network proof |
| A fresh named volume inherits the image path's ownership; an un-chowned path comes up root-owned and unwritable | image pre-creates + chowns `/var/lib/waitron/state` to uid 10001 → mounted volume `ls -ldn` shows `10001`, `touch` succeeds. Control, path not pre-created → `0 0`, `touch: Permission denied` | measured 2026-09-08, both directions |
| `app_user` is created by the CORE MIGRATION, and `planInstance` emits `migrate` before the actions that need it | `packages/db/drizzle/0001_db_baseline_sql.sql:4` (`CREATE ROLE app_user NOLOGIN`); `packages/provisioning/src/instance-plan.ts` emits `migrate`, then `grant-membership … app_user`, then `create-role waitron_app … IN ROLE app_user` | read 2026-09-08 (plan review) |
| `applyInstance`'s migrate case runs the FULL manifest, not an enabled subset | `packages/provisioning/src/instance-apply.ts` — `applyMigrations(withRole(…), migrationOptionsFor(manifestSets(), …))` | read 2026-09-08 |
| Every module but `core` and the two fiscal ones is `toggleable`, `identity`/`credentials`/`payments` included | `packages/composition/src/modules.ts` — tiers listed per module | read 2026-09-08 (why §9.1 builds no safe mode) |
| `docker compose exec` ignores an image ENTRYPOINT; `docker compose run` appends to it | Docker CLI reference for `run`/`exec`; `--entrypoint` is the documented override | to be re-quoted from the live page when `deploy/README.md` is written |
| `pg_dump` runs as a separate process from the app | `apps/server/src/backup-sweep.ts` header | read 2026-09-08 |
