# Running a Waitron node

A node is a few containers: the Waitron app, a local mail capture, and the print agent. Everything
the node keeps lives in the named Docker volumes below, so `docker volume` is the whole of a box's
life. Back those up and you have backed up the box.

**The venue's own database is a folder inside the `state` volume.** The app opens
`/var/lib/waitron/state/venue/`, which holds `venue.db`, `node.db`, their write-ahead sidecars,
Litestream's `.venue.db-litestream/` folder once the box has streamed to a bucket,
the `migrations.lock` file two migrating processes queue on, and the `venue.lock` file that refuses
a second process opening the folder with the lock, and `venue.holder.json`, which names the process
holding the folder (a killed holder leaves it behind for the next holder to overwrite). The state
folder itself holds `recovery.lock`, which serialises changes to `recovery.json`. While any of these
lock files is held a `-journal` appears beside it, and a crash can leave that behind. None of the
lock files holds data; do not delete them, because a process that finds one missing takes a new
lock beside the one still held.
There is no database server in the app's path, no connection string and no database password.

| volume        | mounted at                     | holds                                                                                                                                                                                       |
| ------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state`       | `/var/lib/waitron/state`       | the box's identity and its database: `venue/`, `secrets.env`, `trading.env`, `backup.env`, `modules.json`, `stream/` (Litestream's configuration and process-id file), the CA and leaf PEMs |
| `logs`        | `/var/lib/waitron/logs`        | the rotating log file, and `crash-reports/`: one JSON file per process the venue watchdog killed                                                                                            |
| `backups`     | `/var/lib/waitron/backups`     | local encrypted backup archives, when they are switched on                                                                                                                                  |
| `mailpit`     | `/data`                        | the local dev/prepare mail inbox (account email captured when no SMTP credential exists)                                                                                                    |
| `print_agent` | `/var/lib/waitron-print-agent` | the print agent's join token, saved config, and the pinned box CA (`server-ca.crt`)                                                                                                         |

A box installed before the box ran its own database server was retired also carries a `waitron_db`
volume holding that old database. Nothing reads it and nothing on the box removes it, including
`reset`. Once such a box has been upgraded, `docker volume rm waitron_db` reclaims the space.

## Setting up a box

Once per box, by whoever prepares it — never by the restaurant. From nothing but a fresh
Debian/Ubuntu box with internet, fetch and run one script in one line:

```bash
curl -fsSL https://raw.githubusercontent.com/clintongormley/waitron/main/deploy/waitron.sh -o waitron.sh
sudo bash waitron.sh install
```

`install` installs Docker Engine and the compose plugin if they are missing (Debian and Ubuntu only;
on anything else it says so and exits 2) and enables the daemon at boot. It then fetches `compose.yml`
and `.env.example` from the ref you are installing, overwriting any local copy of those two files and
printing a line to say so, because the compose file and the image running against it must always come
from the same commit. Finally it pulls the box's images, the two Waitron ones from GHCR and the
mail catcher from Docker Hub, stopping with an error if any of them fails to download, and starts the
containers.

A plain `install` writes no `deploy/.env` at all. The box has no secret it needs before it boots: the
venue's databases are files in the `state` volume that open with no password, and every other setting
has a default in the image that suits a box reached at `waitron.local`. The only thing that writes `.env` is installing a branch or a
commit, which records the image tags it built there. So `install` is non-interactive and idempotent,
and running it again later to update the box does nothing destructive.

It finishes by printing a setup address and QR code, also shown on an attached monitor:
`http://waitron.local/setup/trust`. Open that guide on the device you will use, install this box's
connection certificate, then continue to the secure site. The guide covers common operating systems
and browsers, and walks through removing any old certificate first and fully quitting the browser.
If the name does not resolve, use the box's IP address at the same path.

A browser may upgrade HTTP to HTTPS before the guide opens. Both listeners serve the guide and
certificate downloads at matching paths, but HTTPS can still show a certificate warning. Use the
browser's option to visit the local HTTP site if offered, or transfer the certificate from another
device that can reach the box. Opening the wizard directly also offers certificate help before you
enter setup details. Its Continue button checks communication with the box, not installed trust.

On a box that already has a checkout of this repository, run the script directly instead of piping it
through `bash`:

```bash
sudo deploy/waitron.sh install
```

Set `WAITRON_DIR` to install somewhere other than `/opt/waitron` (that is how the script is
exercised on a developer machine without touching `/opt`).

The compose project is named `waitron`. On a developer machine that is also running the repository's
dev stack (`docker-compose.yml`, started by `wa-wt`, which sets `COMPOSE_PROJECT_NAME=waitron`) the
two collide. A `docker compose up` here would then reconcile that running project, and because
`waitron.sh` passes `--remove-orphans` on every `up` and `down` it runs, it stops and removes the dev
stack's containers rather than warning about them. That dev stack declares no volume at all, and a
dev venue is a directory of SQLite files on the host rather than a container resource, so the seeded
venue is untouched and `wa-wt` brings the containers back. Pass
`COMPOSE_PROJECT_NAME=waitron-<something>` when exercising this file on such a machine; on a box the
collision cannot arise.

If HTTP is disabled, use the installer's **Secure help** address, `https://waitron.local/setup/trust`.
The main listener serves this guide during setup, trading, pending adoption and boot recovery.
While the listener presents your own TLS certificate, the guide directs you to whoever installed
it. It does not offer the box's fallback CA, which cannot certify that connection.

## Updating and operating

```bash
cd /opt/waitron
docker compose pull && docker compose up -d --remove-orphans   # updates to the published :main, unless a branch install pinned an image in .env (run `waitron.sh install` with no ref to return to :main)
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

That output is the caught error's own words — a missing column, a database file that would not
open, the counts behind `migrations.incomplete`, the migration hashes behind
`provisioning.database_ahead` — with any credentials embedded in a URL masked before it is written. `docker compose logs` keeps it across the
container's own restart loop, so read it before pulling a new image: `docker compose up -d` on a
fresh image starts a new container and the previous boot's output goes with the old one.

### Trying a branch before it merges

CI does not publish an image for a pull request (only pushes to `main` and `v*` tags publish to
GHCR), so there is no PR image to `pull`. Give `install` a ref — a branch name or a commit SHA —
instead of relying on the default `main`, and it builds that ref's image on the box instead of
pulling: Docker fetches the ref itself, so no checkout or `pnpm` is needed.

```bash
sudo bash waitron.sh install <branch-or-ref>
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

Both forms wipe every volume in the table above except one folder: plain `reset` keeps `tls/` inside the box's `state`
volume, which holds the certificate authority the phone already trusts and the box's own certificate
signed by it. Because that folder survives, a phone that has already been told to trust this box does
not need to trust it again after a plain `reset`. `reset --all` throws `tls/` away too, so the box
mints a brand-new certificate authority on its next boot and every phone has to go through the trust
step again. Neither form touches `.env`, so if a branch install pinned an image there, the box comes
back on that same image. Only the data in the volumes is wiped, and that includes the venue's
databases, because they live in the `state` volume.

At a terminal, `reset` asks you to type the word `reset` to confirm before it wipes anything; run
without a terminal (an unattended script) it needs `--yes` instead.

**`reset` refuses on a box stamped for production.** A box that has gone live holds real records
filed with the Spanish tax agency that cannot be recreated, and `reset` would destroy them — see
`CLAUDE.md` §5 on why that data is unrecoverable. A box that has never been set up, or is still in
demo/test mode, is not stamped and resets freely with no extra flag; that is the normal demo
workflow. A half-finished box counts as never set up: the server creates the venue database file
before it runs its migrations, so a box that failed partway through setup has the file with no
stamp table in it, and that reads as unstamped rather than as a read that failed. What is still
refused is a box whose venue file cannot be read at all, because nothing about it can be
established. The only way past the refusal on a genuinely production box is deliberate: pass
`--force-production`, and, when run at a terminal, also type the word `production` when asked.
Full design: `docs/superpowers/specs/2026-09-11-waitron-sh-box-command-design.md` §4.

## The operator CLIs — two different invocation forms

The image has an `ENTRYPOINT` (`node /app/node-entry.js`) and no `CMD`, and the two ways of running a
command against it treat that entrypoint differently:

- **`docker compose exec` IGNORES the entrypoint.** A command that needs the server RUNNING is just:

  ```bash
  # break-glass resets the first admin's dashboard password (the lockout IS the password). Its
  # secrets come from the ENVIRONMENT, never argv (an argv element leaks into `ps`): the new password
  # is WAITRON_BREAKGLASS_PASSWORD. It needs no connection setting at all — it finds the venue
  # directory the way the server does, from WAITRON_VENUE_DIR or `venue` under WAITRON_STATE_DIR,
  # and the image already sets the latter. `--person <id>` only disambiguates a venue with more than
  # one admin; WAITRON_BREAKGLASS_PIN also resets the PIN.
  docker compose exec -e WAITRON_BREAKGLASS_PASSWORD="a-new-dashboard-password" \
    app node /app/bin-break-glass.js
  ```

- **`docker compose run` APPENDS its arguments to the entrypoint.** The commands that need the
  server STOPPED must override it explicitly. The entrypoint takes no arguments and refuses any it
  is given: it exits non-zero with `server.entry_arguments_refused` before it opens anything,
  printing the first argument it received, how many more followed (never their values), and the
  form below:

  ```bash
  docker compose stop app
  docker compose run --rm --entrypoint node app /app/bin-restore.js <args>
  docker compose start app
  ```

  The same `--entrypoint node` applies to `docker compose run app /app/bin-rejoin.js …`, to
  `/app/bin-recovery.js unpack …`, and to any bare `docker run` against this image.

- **A restore takes one of two sources.** `restore <backup-file>` restores an encrypted backup
  file, with its recovery key in `WAITRON_BACKUP_RECOVERY_KEY`. `restore --from-bucket <kit-file>`
  rebuilds the box from the copy the old box kept in the owner's bucket; the recovery kit file
  holds the bucket's key and the recovery key, so nothing secret goes on the command line. The file
  must be visible inside the container and readable by the image's user, `waitron` (uid 10001):
  `sudo chown 10001 kit.txt` keeps it private at mode 0600. Otherwise the command stops with
  `cannot read kit file: /kit.txt`.

  ```bash
  docker compose run --rm -v "$PWD/kit.txt:/kit.txt:ro" --entrypoint node app \
    /app/bin-restore.js restore --from-bucket /kit.txt --confirm-venue <tax-id>
  ```

  It prints the business name, tax id and location of the copy it found, and restores nothing
  unless `--confirm-venue` names that tax id. If the old box wrote to the bucket in the last ten
  minutes, or that cannot be checked, it stops and says so; add `--confirm-old-box-gone` only when
  the old box is switched off for good. A backup file whose box was copying to a bucket gets the
  same check. Each form takes only its own flags, each once: `--confirm-venue` belongs to the
  bucket form alone, and a backup file given together with `--from-bucket` is refused. Anything
  else prints the usage line and exits 2.

  A restore moves the old database into a hidden folder in the venue folder
  (`/var/lib/waitron/state/venue/` inside the container), named `.venue.db-replaced-` and six
  random characters, and deletes that folder once the restored database is in place. If the command
  reports `restore.placement_failed` and says the previous database could not all be put back,
  move everything in the folder it names back into the venue folder before
  `docker compose start app`. If the restore succeeded but its output shows
  `restore.db.aside_kept`, the folder that line names (`folder`) holds only the replaced database;
  the next server start deletes it, logging `restore.db.aside_removed`. A server start that finds
  such a folder holding files and no `venue.db` beside it deletes nothing and refuses to start with
  `restore.database_set_aside`, naming the folder in its output: move everything in it back into
  the venue folder, or run the restore again.

  Restore and rejoin are refused while another process, usually the running server, is using the
  venue folder (`provisioning.database_in_use`): rejoin before it reads or wipes anything, restore
  before it changes the venue folder, the box's identity or its secrets. A restore's earlier steps
  run in temporary folders under the state folder, and the bucket form downloads the whole copy
  there first, then is refused only when it comes to place it — so stop the server before either
  form. A run that downloads from the bucket, or checks a backup's bucket, makes its own folder
  (`stream-restore-` or `archive-source-check-` and six random characters) and removes it when it
  ends; a run that is killed leaves it, holding a full copy of the venue's database, and the next
  run does not remove it. Once no restore is running, you can delete a leftover `stream-restore-*`
  or `archive-source-check-*` folder from the top of the `state` volume
  (`/var/lib/waitron/state` inside the container). Break-glass is the exception by design: it runs beside the
  server and takes no lock. Whatever holds the folder keeps a small file beside it,
  `venue.holder.json`, naming what kind of program it is and rewriting a heartbeat time every five
  seconds. A server start refused while that heartbeat is under 30 seconds old — a second copy of
  the app beside the running one — does not count toward the three failed starts that put the box
  on its recovery page. A refusal by a holder whose heartbeat is older, or that left no such file,
  does count, and the recovery page then names which kind of program holds the folder. A holder
  whose main thread has not run for two minutes is ended by its own watchdog thread. Before the
  kill, the watchdog writes a one-line report to the program's own output, which is
  `docker compose logs` for the app. The report includes the main thread's stack when it can be
  read. It could not be read in a test where that thread was running one long database statement. The server,
  restore and rejoin (the programs in the box's image that take the folder) also append that line
  to `waitron.log` and write it as a JSON file in the `logs` volume's `crash-reports` folder. `GET /health` reports the same holder file, without the
  process id or host.

## The box's environment — `deploy/.env`

`.env.example` documents every line, and every one of them is optional: a box reached at
`waitron.local` runs with no `.env` at all. The box holds no database credential, because there is no
database server to hold one for. Its own secrets, the vault key ring and the CA and leaf
certificates, are minted on the first setup boot into the `state` volume and never appear here. A
box restored from a backup brings them back and, at its first trading start, replaces the leaf with
one naming its own addresses, signed by the same CA, so devices that trusted the old box need no new
trust step. A restored box that comes up fenced, as a mirror, or still waiting to finish an
adoption leaves the leaf as it is; if the replacement fails, the dashboard raises an alert and the
next start tries again.

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
```

```bash
docker compose -f compose.yml -f compose.mac.yml up -d
```

with `WAITRON_BOX_ADDRESSES` set to the Mac's own LAN address in `.env`, so the certificate the
phone is asked to trust carries an address the phone can actually reach.
