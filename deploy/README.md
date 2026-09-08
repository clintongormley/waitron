# Running a Waitron node

A node is two containers: the Waitron app and its Postgres. Everything the node keeps lives in five
named Docker volumes, so `docker volume` is the whole of a box's life — back those up and you have
backed up the box.

| volume    | mounted at                 | holds                                                                                                  |
| --------- | -------------------------- | ------------------------------------------------------------------------------------------------------ |
| `db`      | `/var/lib/postgresql`      | the cluster                                                                                            |
| `state`   | `/var/lib/waitron/state`   | the box's identity: `secrets.env`, `instance.env`, `trading.env`, `modules.json`, the CA and leaf PEMs |
| `logs`    | `/var/lib/waitron/logs`    | the rotating log file                                                                                  |
| `backups` | `/var/lib/waitron/backups` | local encrypted backup archives, when they are switched on                                             |
| `media`   | `/var/lib/waitron/media`   | product images                                                                                         |

## Preparing a box

Once per box, by whoever prepares it — never by the restaurant:

```bash
sudo ./prepare.sh
```

It installs Docker Engine and the compose plugin if they are missing (Debian and Ubuntu only; on
anything else it says so and exits 2), enables the daemon at boot, copies `compose.yml` and
`.env.example` into `/opt/waitron`, generates the box's `POSTGRES_PASSWORD` into `/opt/waitron/.env`,
pulls the images and starts them. It is non-interactive and idempotent: running it twice does
nothing the second time, and in particular it never mints a second `POSTGRES_PASSWORD` — the cluster
keeps the first one, so a regenerated `.env` would lock the app out of its own database.

It finishes by printing — and, when a monitor is attached, showing on the console — a QR of
`https://waitron.local`. That URL resolves only once the app is serving, so the whole instruction to
the restaurant is: open it on your phone, and if it does not load, wait a minute.

Set `WAITRON_DIR` to install somewhere other than `/opt/waitron` (that is how the script is
exercised on a developer machine without touching `/opt`).

The compose project is named `waitron`. On a developer machine that is also running the repository's
dev stack (`docker-compose.yml`, started by `wa-wt`, which sets `COMPOSE_PROJECT_NAME=waitron`) the
two collide, and a `docker compose up` here would reconcile that running project instead. Pass
`COMPOSE_PROJECT_NAME=waitron-<something>` when exercising this file on such a machine; on a box the
collision cannot arise.

## Updating and operating

```bash
cd /opt/waitron
docker compose pull && docker compose up -d   # update to the current :main image
docker compose ps                             # both services, with health
docker compose logs -f app                    # the server's JSON lines
```

Both services are `restart: unless-stopped`, so the box comes back on its own after a power cut and
after the app's own requested restart at the end of the setup wizard.

### The health check accepts either endpoint

`GET /health` is **503 by design** on a box that has not been provisioned yet — no duty loop means
not trading-healthy — and `GET /setup-api/status` exists **only** in setup mode. The compose
healthcheck therefore passes when EITHER returns 200. A probe on one alone would restart-loop one of
the two modes forever, so do not "simplify" it.

## The operator CLIs — two different invocation forms

The image has an `ENTRYPOINT` (`node /app/node-entry.js`) and no `CMD`, and the two ways of running a
command against it treat that entrypoint differently. Getting this wrong re-runs the bootstrap in the
middle of a cold restore, so it is worth reading twice:

- **`docker compose exec` IGNORES the entrypoint.** A command that needs the server RUNNING is just:

  ```bash
  docker compose exec app node /app/bin-break-glass.js --email owner@example.com
  ```

- **`docker compose run` APPENDS its arguments to the entrypoint.** The commands that need the
  server STOPPED must override it explicitly, or the entrypoint boots a second server first:

  ```bash
  docker compose stop app
  docker compose run --rm --entrypoint node app /app/bin-restore.js <args>
  docker compose start app
  ```

  The same `--entrypoint node` applies to `docker compose run app /app/bin-rejoin.js …`, to
  `/app/bin-recovery.js unpack …`, and to any bare `docker run` against this image.

## The box's environment — `deploy/.env`

`.env.example` documents every line. Two are worth calling out here.

**`POSTGRES_PASSWORD`** is the one secret a box needs before anything runs: the `db` container
consumes it at first start, and compose derives the app's `WAITRON_BOOTSTRAP_DATABASE_URL` from it.
`prepare.sh` generates it and never prints it. Everything else the box holds — the vault key ring,
the CA and leaf certificates, the node's own secrets — is minted on the first setup boot into the
`state` volume.

**`WAITRON_BOX_ADDRESSES`** is a comma-separated list of IPv4 literals that REPLACES interface
sniffing everywhere the box reports its own addresses: the SANs in the leaf certificate it presents,
the reach URLs and QR the setup wizard shows, and the mDNS responder's answers. Leave it empty on a
real box — host networking already sees the LAN, and unset means today's sniffing behaviour exactly.
Set it where the container cannot see the LAN itself: a bridge or cloud profile, and Docker Desktop,
whose `--network host` puts the container on the Linux VM's network (`192.168.65.x`), not on the
Mac's. Loopback addresses are refused, and a non-IPv4 entry fails the boot with
`server.config_invalid`.

**`WAITRON_MANAGEMENT_RP_ID` and `WAITRON_MANAGEMENT_ORIGIN`** are the passkey relying party and the
origin every till is handed. The image bakes `waitron.local` and `https://waitron.local`, which is
right for an on-prem box and wrong for anything reached at another name — a cloud node on this same
image, say. **A box reached at any name other than `waitron.local` MUST set both in `.env`.** They
have to be set there rather than in the box's own state, because the image's `ENV` wins over
`trading.env` (`box-env.ts` merges the process environment last). Getting this wrong does not fail
the boot: the box comes up, and then no passkey can ever be registered, because the browser checks
the relying party against the name in the address bar and raises `SecurityError` at registration.

`WAITRON_ENV` is deliberately NOT in this file. The wizard decides whether a box is a demo or a live
one and writes that into the `state` volume, so "`production` must be typed out" keeps its one home:
the wizard, not a file on the box.

## Building and running the image locally

```bash
pnpm build:image      # docker build -f deploy/Dockerfile -t waitron:dev .
```

Then point the compose at it with `WAITRON_IMAGE=waitron:dev` in `.env`.

On a Mac, Docker Desktop cannot put a container on the LAN, so the shipped host-networking profile
does not give you a reachable box. Run the bridge shape instead with an override file — which is
also the first exercise of the cloud profile:

```yaml
# compose.mac.yml
services:
  app:
    network_mode: bridge
    ports:
      - "443:443"
    extra_hosts:
      - "host.docker.internal:host-gateway"
    environment:
      WAITRON_BOOTSTRAP_DATABASE_URL: postgres://postgres:${POSTGRES_PASSWORD}@host.docker.internal:5432/postgres
```

```bash
docker compose -f compose.yml -f compose.mac.yml up -d
```

with `WAITRON_BOX_ADDRESSES` set to the Mac's own LAN address in `.env`, so the certificate the
phone is asked to trust carries an address the phone can actually reach.
