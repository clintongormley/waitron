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
installs, each measured rather than assumed (§12):

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
their file (§9).

Fixed environment in the image (never operator-set): `WAITRON_STATE_DIR=/var/lib/waitron/state`,
`WAITRON_LOG_DIR=/var/lib/waitron/logs`, `WAITRON_MEDIA_DIR=/var/lib/waitron/media`,
`WAITRON_BACKUP_DIR=/var/lib/waitron/backups`, `WAITRON_MIGRATIONS_DIR=/app/drizzle`,
`WAITRON_{TILL,DASHBOARD,SETUP}_APP_DIR=/app/web/…`, `WAITRON_HTTP_PORT=443`. The server's own
defaults for these are "beside the bundle", which is a read-only image layer — every writable
path is a volume (§4).

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
both ways, §12. A volume added later without its `mkdir`+`chown` in the image is therefore a boot
failure, not a warning. `state` files are 0600 already (`box-secrets.ts`).

## 5. The entrypoint — `apps/server/src/node-entry.ts`

The missing supervisor half, as a small TypeScript module bundled to `dist/node-entry.js` beside
`server.js`. Testable with the existing real-Postgres harness; no shell logic to mistrust. Every
start, in order:

1. **Wait for Postgres** on `WAITRON_BOOTSTRAP_DATABASE_URL` (the superuser URL compose derives
   from `.env`'s `POSTGRES_PASSWORD`, §7) — a bounded retry loop, the shape of `dev-setup.ts`'s
   `waitForPostgres`, exits non-zero with `server.config_missing` if the variable is unset.
2. **Ensure the instance.** Read the cluster's state with `readInstanceState`, plan with
   `planInstance({ database: "waitron", environment })`, apply with `applyInstance` — the SAME
   three functions `waitron-provision instance` runs, so the on-box shape and the CLI's are one
   code path. The `environment` is `WAITRON_ENV` when set in the process environment (the compose
   `.env` never sets it, §7), else `trading.env`'s if that file exists, else `preproduction` — the
   same "unset means preproduction" rule as `config.ts` (`dev` is preproduction too, as `config.ts`
   treats it — `planInstance` takes only the two `DeploymentEnvironment` values). Then `replicationBootstrapStatements` if
   `waitron_repl` is absent (`assertReplicationReady`'s probe decides). The generated passwords are
   written ONCE to `<state>/instance.env` (0600, via `formatEnvFile`/`writeFileAtomic`) as
   `DATABASE_URL` (the `waitron_app` login), `WAITRON_MIGRATIONS_DATABASE_URL` (the migrator) and
   `WAITRON_REPLICATION_PASSWORD`, each pointing at `127.0.0.1:5432/waitron`; every later start
   reads them back and `planInstance` emits only what is missing. A wiped-and-rejoined box (roles
   survive — they are cluster-level — the database is dropped `WITH (FORCE)` by `rejoin`) therefore
   gets exactly one `create-database` action and nothing else. **Interaction with `waitron-rejoin`
   and `waitron-restore` is a plan task:** both run against a STOPPED server (`docker compose run`,
   §9), and their own database creation must agree with this step's — read `bin-rejoin.ts` and
   `bin-restore.ts` before writing this; if they create the database themselves the entrypoint
   must find it and stop, never race.
3. **Load the env files** into the process environment: `instance.env`, then `secrets.env`, then
   `trading.env` — **a variable already present in the environment always wins over a file**.
   That is cloud rule 4's cheap half: a cloud profile can inject `WAITRON_CREDENTIALS_KEY` from the
   environment without touching this file. (The other half — `ensureBoxSecrets` honouring an
   env-provided key instead of minting one in setup mode — is the cloud profile's, not built here.)
   `WAITRON_BOOTSTRAP_DATABASE_URL` is DELETED from the environment here: the running server never
   holds superuser credentials; its owner connection is the migrator via
   `WAITRON_ADMIN_DATABASE_URL`, which the entrypoint sets to `instance.env`'s migrator URL — the
   role that owns the tables, as `boot.ts`'s setup branch documents.
4. **Start the server** through the one start/shutdown routine `bin.ts` uses today, lifted into a
   shared `runServer(env)` (`apps/server/src/run-server.ts`) so `bin.ts` and `node-entry.ts` hold no
   second copy of the signal handling. A restart the server requests (`SIGTERM` to itself → exit 0)
   is a real reboot under `restart: unless-stopped` (§8).

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
(§10), since Docker Desktop's `--network host` places the container on the Linux VM's network
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
4. `docker compose pull` (the image is public on GHCR, §9) and `docker compose up -d`;
5. print — and, when `/dev/tty1` is writable, show on the console — the banner
   `Waitron is ready — open https://waitron.local on your phone` with a QR of that URL
   (`qrencode -t ANSIUTF8`, installed alongside), preceded by `Installing…` while steps 1–4 run.

A headless box therefore needs no screen: `waitron.local` resolves only once the app is serving
the setup page (the mDNS responder starts inside `startServer`), so "open it on your phone; if it
doesn't load, wait a minute" is the whole instruction. LEDs, beeps and anything hardware-specific
are explicitly not built — Waitron does not control the box.

## 9. Shipping, updating, operating

**Local:** `pnpm build:image` at the root runs `docker build -f deploy/Dockerfile -t waitron:dev .`.
This is what the run-it proof uses and what a developer iterates on.

**CI (`image` job in `ci.yml`, gated like every code job):** on every code PR, `docker buildx
build` with GHA layer caching, then a compose smoke against fresh volumes in the runner (§10). On a
push to `main` it also logs into GHCR with `GITHUB_TOKEN` and pushes
`ghcr.io/<owner>/waitron:main`, `:sha-<short>` and, for a `v*` tag, `:<version>`; the manifest is
`linux/amd64,linux/arm64` on pushes (QEMU for arm64, so a small ARM box works) and amd64-only on
PRs (speed). `deploy/**` is added to `scripts/changed-scope.mjs`'s CODE paths, or the `changes`
job would skip the image build for a Dockerfile change (CLAUDE.md §2).

**Updating a box:** `docker compose pull && docker compose up -d` — the compose pins `:main` until
release tags exist. Unattended updates are the installer spec's question (a box we did not sell
still needs them).

**Operating:** the four CLIs run from the image. Ones that need the server RUNNING use
`docker compose exec app node /app/bin-break-glass.js …`; `waitron-restore` and `waitron-rejoin`,
which need it STOPPED, use `docker compose stop app && docker compose run --rm app node /app/bin-restore.js …`
then `up -d` — written in `deploy/README.md`. The entrypoint is bypassed by naming the file, so a
CLI never re-runs the bootstrap.

## 10. Testing and the run-it proof

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

## 11. Out of scope, named

The wizard's four-mode chooser (modes 1–2 next); backup destinations (mirror → S3 → Drive); images
into Postgres (deletes the `media` volume); the HTTP landing page on port 80 + the name-constrained
CA (the LAN-HTTPS item); WireGuard on the box; a cloud compose (the override makes it possible; the
file is written when Waitron Cloud starts); the bootable USB installer (next spec — it runs
`prepare.sh`; open questions it owns: whether the stick carries the images so install needs no
internet, unattended updates for a box we did not sell, AP-mode WiFi onboarding); the appliance
OS image; a slimmer image.

## 12. Provenance

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
| Non-root bind to 443 fails under HOST networking and succeeds under bridge; `setcap` fixes host | same image, non-root: bridge → `listening on 443` (`ip_unprivileged_port_start` = 0); `--network host` → `FAILED EACCES` (host namespace = 1024); with `setcap cap_net_bind_service=+ep` on `/usr/local/bin/node` → `listening on 443` in host mode AND bridge, `getcap` shows `cap_net_bind_service=ep` | measured 2026-09-08, three-way with controls. Taken in Docker Desktop's Linux VM — 1024 is the kernel default, to be re-confirmed on the real Linux box at §10's host-network proof |
| A fresh named volume inherits the image path's ownership; an un-chowned path comes up root-owned and unwritable | image pre-creates + chowns `/var/lib/waitron/state` to uid 10001 → mounted volume `ls -ldn` shows `10001`, `touch` succeeds. Control, path not pre-created → `0 0`, `touch: Permission denied` | measured 2026-09-08, both directions |
| `pg_dump` runs as a separate process from the app | `apps/server/src/backup-sweep.ts` header | read 2026-09-08 |
