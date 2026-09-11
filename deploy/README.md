# Running a Waitron node

A node is a few containers: the Waitron app, its Postgres, a local mail capture, and the print agent.
Everything the node keeps lives in the named Docker volumes below, so `docker volume` is the whole of
a box's life — back those up and you have backed up the box.

| volume        | mounted at                     | holds                                                                                                  |
| ------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `db`          | `/var/lib/postgresql`          | the cluster                                                                                            |
| `state`       | `/var/lib/waitron/state`       | the box's identity: `secrets.env`, `instance.env`, `trading.env`, `modules.json`, the CA and leaf PEMs |
| `logs`        | `/var/lib/waitron/logs`        | the rotating log file                                                                                  |
| `backups`     | `/var/lib/waitron/backups`     | local encrypted backup archives, when they are switched on                                             |
| `media`       | `/var/lib/waitron/media`       | product images                                                                                         |
| `mailpit`     | `/data`                        | the local dev/prepare mail inbox (account email captured when no SMTP credential exists)               |
| `print_agent` | `/var/lib/waitron-print-agent` | the print agent's join token, saved config, and the pinned box CA (`server-ca.crt`)                    |

## Setting up a box

Once per box, by whoever prepares it — never by the restaurant. From nothing but a fresh
Debian/Ubuntu box with internet, fetch and run one script in one line:

```bash
curl -fsSL https://raw.githubusercontent.com/clintongormley/waitron/main/deploy/waitron.sh -o waitron.sh
sudo bash waitron.sh install
```

`install` installs Docker Engine and the compose plugin if they are missing (Debian and Ubuntu only;
on anything else it says so and exits 2), enables the daemon at boot, fetches `compose.yml` and
`.env.example` from the ref you are installing — overwriting any local copy of those two files, and
printing a line to say so, because the compose file and the image running against it must always come
from the same commit — generates the box's `POSTGRES_PASSWORD` into `.env` the first time, pulls the
published image, and starts the containers. It is non-interactive and idempotent: running it again
later (to update, say) does nothing destructive, and in particular it never mints a second
`POSTGRES_PASSWORD` — the cluster keeps the first one, so a regenerated `.env` would lock the app out
of its own database.

It finishes by printing — and, when a monitor is attached, showing on the console — a QR of
`https://waitron.local`. That URL resolves only once the app is serving, so the whole instruction to
the restaurant is: open it on your phone, and if it does not load, wait a minute.

On a box that already has a checkout of this repository, run the script directly instead of piping it
through `bash`:

```bash
sudo deploy/waitron.sh install
```

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
docker compose ps                             # all the services, with health
docker compose logs -f app                    # the server's JSON lines
```

The services are all `restart: unless-stopped`, so the box comes back on its own after a power cut and
after the app's own requested restart at the end of the setup wizard.

### When the app will not boot

The box serves a recovery page instead of the app, and that page names a CODE and shows the tail of
`waitron.log` — enough for the restaurant to act on, deliberately not enough to diagnose from. The
real reason goes somewhere the restaurant never looks and only whoever prepared the box can read:

```bash
cd /opt/waitron
docker compose logs app | tail -50    # the failed boot's error, its cause chain, and its stack
```

That output is the caught error's own words — a missing column, a refused connection, the counts
behind `migrations.incomplete`, the migration hashes behind `provisioning.database_ahead` — with any
credentials embedded in a URL masked before it is written. `docker compose logs` keeps it across the
container's own restart loop, so read it before pulling a new image: `docker compose up -d` on a
fresh image starts a new container and the previous boot's output goes with the old one.

### Trying a branch before it merges

CI does not publish an image for a pull request (only pushes to `main` and `v*` tags publish to
GHCR), so there is no PR image to `pull`. Give `install` a ref — a branch name or a commit SHA —
instead of relying on the default `main`, and it builds that ref's image on the box instead of
pulling: Docker fetches the ref itself, so no checkout or `pnpm` is needed.

```bash
sudo bash waitron.sh install <branch-or-ref> [extra docker build args…]
```

It tags the image after the ref (`waitron:<ref>`, with unsafe characters dashed and the name capped
to a valid length) and writes that tag into `.env` as `WAITRON_IMAGE` (and the print agent's
equivalent as `WAITRON_PRINT_AGENT_IMAGE`), so the box STAYS on that build across reboots and a bare
`docker compose up -d` — not just for the one run that installed it. Run `install` with no ref to go
back to the published `main` image; that removes those two lines from `.env` again. Add `sudo` if
your user is not in the `docker` group; the first build takes several minutes (it builds the whole
app).

**It can migrate the box's database one way.** If the ref you install carries a database migration,
running it changes the box's database, and there is no backward migration — installing an older ref
afterwards (a plain `install` back to `main` included) can then fail to boot with
`provisioning.database_ahead`. On a box you use for testing, `waitron.sh reset` (below) clears this
by wiping the database; on a box holding a real venue's records, take a backup first and install a
newer ref instead of resetting.

### The health check accepts either endpoint

`GET /health` is **503 by design** on a box that has not been provisioned yet — no duty loop means
not trading-healthy — and `GET /setup-api/status` exists **only** in setup mode. The compose
healthcheck therefore passes when EITHER returns 200. A probe on one alone would restart-loop one of
the two modes forever, so do not "simplify" it.

## Resetting a box

`reset` wipes a box back to a clean state — the database, the wizard's settings, and the box's local
backups — then brings it straight back up, so the next thing anyone opens is the setup wizard, as if
the box had just been installed. Use it to get a demo or test box back to a known state. It is not a
recovery tool for a box holding real trading data — see the refusal below.

```bash
sudo bash waitron.sh reset          # wipe the database and settings, keep the box's certificate
sudo bash waitron.sh reset --all    # also wipe the certificate, so a new one is minted on next boot
```

Both forms wipe the database and every other volume except one folder: plain `reset` keeps `tls/`
inside the box's `state` volume, which holds the certificate authority the phone already trusts and
the box's own certificate signed by it. Because that folder survives, a phone that has already been
told to trust this box does not need to trust it again after a plain `reset`. `reset --all` throws
`tls/` away too, so the box mints a brand-new certificate authority on its next boot and every phone
has to go through the trust step again. Neither form touches `.env`, so the box's Postgres password
and whichever image `install` last selected both survive a reset — only the data inside the
containers is wiped.

At a terminal, `reset` asks you to type the word `reset` to confirm before it wipes anything; run
without a terminal (an unattended script) it needs `--yes` instead.

**`reset` refuses on a box stamped for production.** A box that has gone live holds real records
filed with the Spanish tax agency that cannot be recreated, and `reset` would destroy them — see
`CLAUDE.md` §5 on why that data is unrecoverable. A box that has never been set up, or is still in
demo/test mode, is not stamped and resets freely with no extra flag; that is the normal demo
workflow. The only way past the refusal on a genuinely production box is deliberate: pass
`--force-production`, and, when run at a terminal, also type the word `production` when asked.
Full design: `docs/superpowers/specs/2026-09-11-waitron-sh-box-command-design.md` §4.

## The operator CLIs — two different invocation forms

The image has an `ENTRYPOINT` (`node /app/node-entry.js`) and no `CMD`, and the two ways of running a
command against it treat that entrypoint differently. Getting this wrong re-runs the bootstrap in the
middle of a cold restore, so it is worth reading twice:

- **`docker compose exec` IGNORES the entrypoint.** A command that needs the server RUNNING is just:

  ```bash
  # break-glass resets the first admin's dashboard password (the lockout IS the password). Its
  # secrets come from the ENVIRONMENT, never argv (an argv element leaks into `ps`): the new password
  # is WAITRON_BREAKGLASS_PASSWORD, and it needs the box's own DATABASE_URL + WAITRON_TILL_TENANT_ID,
  # both in the state volume's trading.env. `--person <id>` only disambiguates a tenant with >1 admin;
  # WAITRON_BREAKGLASS_PIN also resets the PIN.
  docker compose exec app sh -c '
    set -a; . /var/lib/waitron/state/trading.env; set +a
    WAITRON_BREAKGLASS_PASSWORD="a-new-dashboard-password" node /app/bin-break-glass.js
  '
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
`waitron.sh install` generates it and never prints it. Everything else the box holds — the vault key ring,
the CA and leaf certificates, the node's own secrets — is minted on the first setup boot into the
`state` volume.

**`WAITRON_BOX_ADDRESSES`** is a comma-separated list of IPv4 literals that REPLACES interface
sniffing everywhere the box reports its own addresses: the SANs in the leaf certificate it presents,
the reach URLs and QR the setup wizard shows, and the mDNS responder's answers. Leave it empty on a
real box — unset, the box advertises only its **default-route interface** (its real uplink), so the
Docker bridge interfaces every box carries (`docker0`/`br-*`, on 172.x) are not advertised and
`waitron.local` resolves to a reachable address without any override. Set it where the container
cannot see the LAN itself: a bridge or cloud profile, and Docker Desktop,
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
pnpm build:image              # docker build -f deploy/Dockerfile -t waitron:dev .
pnpm build:image:print-agent  # docker build -f deploy/Dockerfile --target print-agent -t waitron-print-agent:dev .
```

Then point the compose at both in `.env`: `WAITRON_IMAGE=waitron:dev` and
`WAITRON_PRINT_AGENT_IMAGE=waitron-print-agent:dev`. The print agent is an on-by-default service, so
without the second one a local `docker compose up` still pulls the published
`ghcr.io/clintongormley/waitron-print-agent:main`.

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
