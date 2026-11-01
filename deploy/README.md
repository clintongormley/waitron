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
`venue.db` is the venue's data; `node.db` is what this box remembers about itself (its role, its
signing key, its recovery-key check, and on a spare the main box's address and key). Only `venue.db`
streams to a bucket; a backup file carries both.
There is no database server in the app's path, no connection string and no database password.

| volume        | mounted at                     | holds                                                                                                                                                                                       |
| ------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state`       | `/var/lib/waitron/state`       | the box's identity and its database: `venue/`, `secrets.env`, `trading.env`, `backup.env`, `modules.json`, `stream/` (Litestream's configuration and process-id file), the CA and leaf PEMs |
| `logs`        | `/var/lib/waitron/logs`        | the rotating log file, and `crash-reports/`: one JSON file per process the venue watchdog killed                                                                                            |
| `backups`     | `/var/lib/waitron/backups`     | local encrypted backup archives, when they are switched on                                                                                                                                  |
| `mailpit`     | `/data`                        | the local dev/prepare mail inbox (account and invoice email captured when no SMTP credential exists; a demo's invoice email always)                                                         |
| `print_agent` | `/var/lib/waitron-print-agent` | the print agent's join token, saved config, and the pinned box CA (`server-ca.crt`)                                                                                                         |
| `box_socket`  | `/run/waitron-box`             | nothing: an empty stand-in until `waitron.sh install` names the host's socket folder in `.env`                                                                                              |

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
printing a line to say so. These files follow the requested ref; the running image
reports its own commit below. Finally it pulls the box's images, the two Waitron ones from GHCR and the
mail catcher from Docker Hub, stopping with an error if any of them fails to download, and starts the
containers.

Before any of that, unless the copy you ran is inside a git checkout, `install` fetches
`deploy/waitron.sh` itself from the ref you are installing and compares it with the copy you ran.
When there is a `.git` in the copy's folder or a folder above it, `install` says so on stderr and
uses that copy as it is. If the fetched script differs, `install` moves it into place over the copy you ran, keeping that
copy's mode and, run as root as above, its owner and group; says so; and runs `install` again from
it with the same arguments, once — so a fix to `install`'s own steps takes effect on the install
that fetches it, with no need to download the script again by hand. If something stops it fetching,
comparing or replacing the script, it says so on stderr and carries on with the copy you ran. One
such case: systemd's `fs.protected_regular` setting (from its `50-default.conf`) stops root writing
to a file another user owns in `/tmp`, so a copy you downloaded there is not updated by
`sudo bash waitron.sh install`, which reports that it could not fetch the script; download it to
your home folder instead. Installing a ref whose
`waitron.sh` predates this step leaves the box with a copy that does not update itself; download it
again with the `curl` line above before the next install. With `--reset` (below), when `install`
fetches the ref's `waitron.sh`, finds it differs from the copy you ran, and the fetched copy predates
`--reset install`, it stops before anything on the box changes; run `waitron.sh reset`, then
`waitron.sh install <ref>`, instead. Wherever it carries on with the copy you ran, that copy does the
wipe and the install.

On a box with AppArmor switched on, `install` also
fetches the print agent's AppArmor profile from the same ref, `deploy/apparmor/waitron-print-agent`,
writes it to `/etc/apparmor.d/`, loads it, and names it in `.env` as `WAITRON_PRINT_AGENT_APPARMOR`.
Docker's own default profile keeps a container off the system bus, and the print agent reaches the
box's Bluetooth service through that bus, so under Docker's default no Bluetooth printer can appear.
If the profile does not load, `install` says so and leaves the line out, and the agent runs under
Docker's default: its USB and network printers work and Bluetooth does not. The line is never written
before the profile has loaded, because Docker refuses to start a container that names a profile the
box has not loaded. It goes in `/etc/apparmor.d/` because that is the folder the boot-time
`apparmor.service` loads profiles from. On the owner's box, 2026-09-29, a restart reloaded it:
afterwards `.env` still named the profile and `bluetoothctl list` inside the print agent still
reached the Bluetooth service.

On a box whose Bluetooth service runs under systemd (`bluetooth.service`), `install` also writes
`/etc/systemd/system/bluetooth.service.d/waitron-noautopair.conf`. It runs the unit's own Bluetooth
daemon command with `--noplugin=autopair` added. On the owner's box (BlueZ 5.82, 2026-09-29),
BlueZ's `autopair` plugin answered a printer's PIN request with `0000` by itself, before the PIN
the operator typed could be asked for. BlueZ's retry then went over Low Energy, which that printer
refuses, so the printer, whose PIN is 1234, never paired. With the plugin off it paired. Where the
file is in effect, the operator types the PIN for every printer, `0000` included. `install` restarts Bluetooth only when
the file changed, so installing again does not interrupt it. A box with no `bluetooth.service`
gets one line saying so. If the file cannot be written or Bluetooth will not restart, `install`
says so, removes the file again and restarts Bluetooth without it, and carries on; the next
`install` tries again. If Bluetooth will not restart even without the file, `install` says Bluetooth
may be stopped and to run `systemctl restart bluetooth` or restart the box. It leaves alone a unit that already passes `--noplugin` or `-P`, and says
so. It also changes nothing — no file written, no reload, no restart — when another drop-in of
`bluetooth.service` sets the daemon command (`ExecStart`), or cannot be read, and names that file:
writing its own could drop that file's options. If a `waitron-noautopair.conf` from an earlier
`install` is still there, `install` leaves it in place too, says that which command Bluetooth runs
depends on both files (or may, when the other file could not be read; `systemctl cat bluetooth`
shows them), and says to delete `waitron-noautopair.conf`, then run `systemctl daemon-reload` and
`systemctl restart bluetooth`, to keep only the other file's command. To undo it, delete the file, then run `systemctl daemon-reload` and
`systemctl restart bluetooth`.

Every `install`, upgrades included, also runs `timedatectl set-ntp true` as root, with a 60-second
limit where `timeout` is installed, to ask the system to keep its clock in step with internet time, and prints one line either
way. Where that fails, or the system has no `timedatectl`, the line says that unless another time
service runs on the machine nothing keeps its clock right, and to check the clock and install a
time service such as `systemd-timesyncd`; `install` carries on. It matters because Waitron stops
taking payments while the box's clock reads earlier than its last sale. `install` switches
synchronisation back on even where someone switched it off, so a test box whose clock is set wrong
on purpose needs it switched off again after each `install`. `reset` does not touch it.

On a host with systemd, every `install` also installs the box's clock service, which lets Waitron
set this machine's clock when a confirmed time shows it is wrong; the app's container cannot set it
itself. `install` fetches three files from the same ref and writes them as root, owned
`root:root`: `deploy/box/waitron-box.sh` to `/usr/local/lib/waitron/waitron-box.sh` (mode `0755`),
and `waitron-box.socket` and `waitron-box@.service` to `/etc/systemd/system/` (mode `0644`). The
socket, `/run/waitron-box/box.sock`, belongs to a host group `waitron-box` with number 10001, the
app's own group number in its container; `install` creates the group with
`groupadd --system --gid 10001 waitron-box` when neither that name nor that number is taken. If the
name exists with another number, or another group has the number, `install` says so and installs no
service, because that group's members could then set the clock. Then it runs
`systemctl daemon-reload` and `systemctl enable --now waitron-box.socket`, restarts the socket when
its file changed, and writes `WAITRON_BOX_SOCKET_DIR=/run/waitron-box` to `.env`, so the app's
container mounts that folder. On a host without systemd, or when a step fails, it prints one line
saying Waitron cannot set this machine's clock itself, removes that `.env` line, and carries on.
`reset` leaves the service and the group alone.

The service runs only when the app asks, and sets the clock only while the system says its clock is
not synchronised. To set it, it stops the running time service (such as `systemd-timesyncd` or
chrony) with `systemctl stop`, sets the clock with `timedatectl set-time`, and starts the time
service again, also when the request is killed at its 15-second limit. It never disables the time
service, so after a power cut part way through, the time service starts at the next boot as usual.
Each set it begins writes one line, naming the time asked for and the ids of who asked, to the
system journal: `journalctl -t waitron-box` shows them.

The box has no secret it needs before it boots: the venue's databases are files in the `state`
volume that open with no password, and every other setting has a default in the image that suits a
box reached at `waitron.local`. So `.env` holds only lines `install` writes: the AppArmor line and
the clock service's line above, and, for a branch or a commit, the image tags it built there. A
plain `install` on a box with neither AppArmor nor systemd writes no `deploy/.env` at all. So `install` is non-interactive
and idempotent, and running it again later to update the box does nothing destructive, apart from deleting the
images it ran before (see Updating and operating).

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

On a box that already has a checkout of this repository, run the checkout's own script instead of
downloading it. Because the folder above that copy holds the checkout's `.git`, `install` uses it as
it is rather than fetching the ref's `waitron.sh`:

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

Run `sudo bash waitron.sh status` to see the commit, requested ref, local build time and GitHub
commit link for each running Waitron image. `install` and its `update` alias print the same lines
after the box becomes healthy. Status reads the containers' image IDs, so pulling a newer tag
does not change the reported version until you replace the containers. An image without the
source labels prints `unknown — built before A490`; a service without a running container prints
`not running`. A development image without a source commit prints `development — source unknown`.
If a Docker lookup fails, the script prints `version unavailable` for that service and carries on
to the other service and the setup links.

```bash
cd /opt/waitron
docker compose pull && docker compose up -d --remove-orphans   # updates to the published :main, unless a branch install pinned an image in .env (run `waitron.sh install` with no ref to return to :main)
docker compose ps                             # all the services, with health
docker compose logs -f app                    # the server's JSON lines
```

`docker compose pull` alone installs no clock service and updates none, because only `install` does
(see Setting up a box). A box set up before the service existed has none until `waitron.sh install`
runs again, and until then Waitron cannot set its clock.

The services are all `restart: unless-stopped`, so the box comes back on its own after a power cut and
after the app's own requested restart at the end of the setup wizard.

After an `install` (or `update`, or `--reset install`) whose box comes up healthy, `install`
deletes each image the `app` and `print-agent` containers ran before it that Docker still holds and
no Waitron container runs now, with `docker image rm` (never forced), and prints one line for
each. A deletion Docker refuses is reported with the command to run later, and does not stop the
install. On Docker's containerd image store, the default for a fresh Docker Engine 29 install,
Docker has already deleted the old pulled image and freed its space when the container was
replaced, so nothing is printed. Not deleted: images left by upgrades before this one, the mail
capture's old images, and Docker's build cache from branch installs. `docker image prune` and
`docker builder prune` delete those by hand, and also delete what other software on the machine
left. A box that does not come up healthy keeps its old images, and `reset` deletes no image. The
`docker compose pull && docker compose up` shown above deletes nothing.

### When the app will not boot

The box serves a recovery page instead of the app. It names a CODE with fixed advice for the
restaurant, then shows why the last start failed and the tail of `waitron.log`. The same failure
report also goes to the container's output:

```bash
cd /opt/waitron
docker compose logs app | tail -50    # the failed boot's error, its cause chain, and its stack
```

Both carry the caught error's own words — a missing column, a database file that would not open, the
counts behind `migrations.incomplete`, the migration hashes behind `provisioning.database_ahead` —
with any credentials embedded in a URL masked before it is written. A person's name, email or tax
number in an error's details is partly masked in the server's own log lines, on the page and in
`docker compose logs`, under the detail names Waitron lists: each word, each tax number, and
an email's part before the `@` and its domain name keep only their first and last character
around `***`, with the `@` and the ending after the last dot left whole, as in
`m***r@e***e.test`, `J***i P***g F***r` and `1***Z`; the names of things, such as a table's
label or a device's name, stay visible. The command-line tools still print an error's details on
their own terminal: the setup and credentials tools, and the restore command's venue confirmation,
which prints the venue's name and tax number on purpose so that you can type the tax number back.
The container's output also holds what happens before a start is counted, such as a start refused
for being given arguments. `docker compose logs` keeps it across the container's own restart loop,
but `docker compose up -d` on a fresh image starts a new container and the previous boot's output
goes with the old one, so read it before pulling a new image. The failed start's report is also in
`waitron.log` on the `logs` volume, which a new container keeps.

#### When the page names `append_only.triggers_changed`

Some of the venue's records, such as its tax filings and staff clock-ins, must never be changed or
deleted. The database enforces that with a pair of triggers on each of those tables: small rules
stored in the database itself that reject every update and every delete. While a trigger is gone or
changed, the records on its table can be changed too, so Waitron checks the triggers every 10
seconds while it is trading, and stops and shows this page when one is missing or its text has
changed. A start checks them too: it first puts back any that are missing from a table that is still
there, then refuses to start if one is still missing or has changed. Find out what changed a trigger
before you go on.

The page names the triggers in two lists: `missing`, the ones that were not there, and `altered`,
the ones whose text is not the text Waitron writes. Where they appear depends on when Waitron
noticed:

- When a start was refused, they are under "Why the last start failed", on the line that begins
  `params:`.
- When Waitron stopped while it was trading, the page is headed "Waitron stopped", says "Stopped
  while running." instead of a count of failed starts, and has no "Why the last start failed"
  section. Just below "Stopped while running.", `missing` is the line that begins "Missing
  triggers:" and `altered` the line that begins "Changed triggers:", their names separated by
  commas. A list with no names has no line.

A trigger in `missing` whose table is still there needs nothing from you. Press Retry, and the start
that follows puts it back and carries on trading. That start also shows a warning,
`append_only.triggers_restored`, among the dashboard's alerts until the next restart, so whoever
reads the alerts knows it happened.

A trigger in `altered` stays as it is through every start, so Retry alone brings you back to this
page. Stop the app, drop each altered trigger by name, and start the app again. The command below
prints each trigger's current text before it drops it, so keep that output for whoever investigates.
Replace `sales_append_only_update` with the names from the `altered` list, separated by spaces:

```bash
cd /opt/waitron
docker compose stop app
docker compose run --rm --entrypoint node app -e '
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync("/var/lib/waitron/state/venue/venue.db");
for (const name of process.argv.slice(1)) {
  if (!/^[a-z0-9_]+_append_only_(update|delete)$/.test(name)) throw new Error(`not an append-only trigger: ${name}`);
  const row = db.prepare("select sql from sqlite_master where type = ? and name = ? collate nocase").get("trigger", name);
  console.log(row === undefined ? `${name}: not there` : `dropping: ${row.sql}`);
  db.exec(`drop trigger if exists "${name}"`);
}
db.close();
' sales_append_only_update
docker compose start app
```

The app comes back on this page, because the refusal is still recorded. Press Retry: that start puts
the dropped triggers back, checks them, carries on trading, and shows the same dashboard warning.
Never edit rows in the database to repair it.

#### When the page names `storage.disk_full`

The box's disk is full, so Waitron cannot save anything. Before it opens its database, every start,
whatever the free space, except one that finds a backup recovery's journal at its repair stage or
unreadable, deletes the database copy and encrypted copy a backup run that was cut off
left in `backup-staging` in the state folder, found by the names a backup run gives them. It keeps
them while another process, such as a running server, holds the database folder. When the start
cannot find that out, as on a disk with no room left for the note it writes while it holds the
folder, it keeps them while that folder's holder note shows a heartbeat less than 30 seconds old.
In the same step it deletes `restore-staging/staged-recovery` in the state folder, where the setup
wizard keeps a backup uploaded for checking. On a box where a backup recovery from the setup
repair page has selected its own folders, the start does this in those folders instead.

Every start also deletes, when the state folder or the database's folder has under 256 MiB free
(a start at a backup recovery's repair stage only when the `logs` folder, followed through links, is
inside neither the state folder nor the database's folder):

- rotated log files except the newest (`waitron.log.2` and later; `waitron.log` and `waitron.log.1`
  stay);
- crash reports in the `logs` volume's `crash-reports` folder that are more than a week old.

It deletes nothing else apart from old backups and the spare file, both below: never the database,
the lock files or `recovery.json`, and no finished backup other than those old ones, even one whose
local backup folder was set inside `backup-staging`. If `logs`, its `crash-reports`
folder, `backup-staging` or `restore-staging` is a symbolic link, the start leaves it and what it
points at alone.

If that frees enough, the box starts as usual. If the start still cannot write, the page appears at
once, without counting the start, and says "The box has deleted the temporary copies, old logs and
crash reports it can make again, and the disk is still full." It says that sales and the database
are not touched, that Waitron cannot free more space by itself, and what reinstalling costs. While a
recovery that Start again discarded still holds its copy, it also names that copy's size; the
ordinary recovery page shows the same line when the failure it recorded is `storage.disk_full`. Below the
status line it shows the free space on the box's disk, read again each time you load the page. A start that fails later because the disk filled is named `storage.disk_full`
as well, and deletes the same files before it records the failure.

Free space on the disk, then press Retry. The page does not notice the freed space by itself: Retry
restarts the app, and the next start tries again.

Before it deletes the spare file (below), a start deletes old backups when the database's folder has
under 16 MiB free and the state folder holds a `backup-room-note.json` that passes the start's
checks, among them that it was written for the `venue.db` still in place. It deletes the oldest
backups in local backup folders on the database's disk: never the newest in a folder, one taken at
or before the moment the current installation began, or one in a bucket. It deletes toward 256 MiB
free or, when that is out of reach, toward the spare plus 16 MiB (24 MiB), and deletes none when
even that is out of reach. It never does this at a backup recovery's repair or selected stage. Once
the server is running it raises the same alert a backup run raises.

The box also keeps an 8 MiB spare file, `spare-space`, in the state folder. It is not venue data, and a
backup recovery's check of the box's files leaves it out. Within the server, three steps delete it:
a start, after the clean-up above and before it reads the setup state, when the state folder or the database's folder has under 8 MiB free,
or under 16 MiB after a start that failed on a full disk (never at a recovery's repair stage); a
start that finds a backup recovery Start again discarded, under 16 MiB free, just before it deletes
that recovery's copy; and the setup repair page, under 16 MiB free, before the steps of Start again
beside a stopped or discarded recovery. `waitron.sh reset` deletes it too. The room lets the box
take the database's locks and start normally instead of serving the full-disk page.

Deleting the spare writes a small marker beside it, `spare-space.released`. While the marker exists
the tills stay stopped, as on a full disk, also across restarts. A start with at least 24 MiB free,
the running box's free-space check (once a minute) or Box status's **Free** button writes the spare
back whole and deletes the marker, and the tills can save again. The running box writes the spare
back only while the marker exists. `waitron.sh reset` deletes the marker with the rest of the state
folder. A repair-stage start never shows the full-disk page; the repair page itself says when the
disk is full.

### Trying a branch before it merges

CI does not publish an image for a pull request (only pushes to `main` and `v*` tags publish to
GHCR), so there is no PR image to `pull`. Give `install` a ref — a branch name or a commit SHA —
instead of relying on the default `main`, and it builds that ref's image on the box instead of
pulling. The script resolves the ref once through GitHub's commit API, then builds both Waitron
images from that full commit. No checkout or `pnpm` is needed; a failed resolution stops the builds.

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
`provisioning.database_ahead`. On a box you use for testing, `waitron.sh --reset install <ref>`
(below) clears this by wiping the database and installing the ref in one run; on a box holding a
real venue's records, take a backup first and install a newer ref instead of resetting.

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
sudo bash waitron.sh reset          # wipe the database and settings, keep the certificate, the start-again records, and the files a Move set aside
sudo bash waitron.sh reset --all    # also wipe those, so a new certificate is minted on next boot
```

Both forms wipe every volume in the table above. Plain `reset` keeps four things inside the box's
`state` volume:

- `tls/`, which holds the certificate authority the box's devices already trust and the box's own
  certificate signed by it. Because that folder survives, a device that has already been told to
  trust this box does not need to trust it again after a plain `reset`. Two files in it go:
  `venue-ca.crt` and `venue-ca.key`, the other server's certificate authority that joining it as a
  spare left on this box, together with their working copies `venue-ca.crt.tmp` and
  `venue-ca.key.tmp`, which a join stopped while writing them can leave.
- `first-setup-start-again-confirmations/`, one small record for each Start again confirmed while
  the venue database was missing or partly unreadable, or that discarded a stopped backup recovery:
  whose setup it was, that it was confirmed on the repair page with nobody signed in, when, and the
  summary the page confirmed.
- `first-setup-start-again-choices/`, one small record for each Keep or Move choice someone made
  at Start again.
- `first-setup-set-aside/`, the files a Move set aside rather than deleted. Each Move's folder also
  holds `secrets.env`, a copy of the box's key ring file as it was at the Move, because the moved
  databases' sealed rows open only with it. Anyone who copies this folder off the box copies that
  key ring too.

`reset --all` removes the whole `state` volume, those four included, so the box mints a brand-new
certificate authority on its next boot and every device has to go through the trust step again. That includes any device with a dashboard or till tab left open across the reset:
take it through the trust step, then reopen the dashboard or till. Neither form touches `.env`, so if
a branch install pinned an image there, the box comes back on that same image. Only the data in the
volumes is wiped, and that includes the venue's databases, because they live in the `state` volume.

A reset during an unfinished first setup forgets the series name that setup chose, as Start again
does; the clock check and setup's 90–150 second wait still guard it (outside the preproduction
throwaway, a new name is the current UTC minute, taken only after a clock on another machine agrees
with the box's within 30 seconds), unless the box and the machine that confirms its clock are wrong
by the same amount.

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
The command was designed and built in #314.

A box whose join to another server stopped partway can also be reset from the setup wizard, without
a terminal, given the admin login the join used; the server refuses it in any other state. The box
restarts and, before the server opens the database, removes the venue's databases (`venue.db`,
`node.db` and their side files, and Litestream's folder beside them), `modules.json`,
`pending-adoption.json`, the record of the stopped join, the other server's certificate authority
the join left in `tls/` (`venue-ca.crt` and `venue-ca.key`, and their `.tmp` working copies) and,
last, its own request file, `reset-request.json`; everything else, including the box's own certificate files in `tls/`,
`secrets.env` and `backup.env`, is kept. It does nothing if the box has meanwhile got a `trading.env` or
holds a venue. It does not remove this box from the other server's list of machines, nor release
the installation number reserved for it there. To take the box off that list, open the other
server's dashboard, then Settings, then Servers, and in the box's row menu choose Remove and then
Clear from list (only Clear from list if the row already says Removed), before joining the box
again.

### Wiping and installing in one run

`--reset` before `install` wipes the box the way `reset` does and installs a ref on it, in one run.
It is the way to put a branch on a test box whose database that branch cannot use:

```bash
sudo bash waitron.sh --reset install <branch-or-ref>
sudo bash waitron.sh --reset --all install <branch-or-ref>   # also wipe the certificate, the start-again records, and the files a Move set aside
```

The full form is `waitron.sh --reset [--all] [--yes] [--force-production] install [ref]`. The script
may first update its own copy from the ref, as described under setting up a box. If it fetches the
ref's `waitron.sh`, finds it differs from its own and predates `--reset install`, it stops there,
before replacing its own copy, wiping or building anything, and tells you to run `waitron.sh reset`,
then `waitron.sh install <ref>`. If it carries on with its own copy instead, for example because it
could not fetch the ref's or runs from a git checkout, that copy does the wipe. It then
checks for production and asks for confirmation, reading the box with its current `compose.yml` and
image, before it fetches the box's other files or builds or pulls any image. Next it fetches the ref's files
and builds or pulls its images while the old box keeps running. Those include every other image the
ref's `compose.yml` names, such as Mailpit, pulled if missing, so an image it cannot get stops the
run before anything is wiped, though by then the box's `compose.yml` and `.env` are already set for
the ref; re-run the command. Only then does it take the box down, wipe it exactly as `reset` does,
and start it on the new images. `--yes` and `--force-production` mean what they mean for `reset`.
In a folder with no box installed there is nothing to wipe, so it says so and installs.

## Moving to a new tax ID

A new tax ID makes a new taxpayer — a sole trader forming a company, or the business being sold. A
new taxpayer has its own fiscal records, invoice numbering and certificate, so it needs a new venue
on a fresh database. Its menus, layouts, staff and settings can come from the old venue:

1. Install the same Waitron release on the new box as on the old one. The import refuses an export
   whose modules are at different versions.
2. After the old venue's last sale, open its dashboard, go to Backups, and use Configuration export.
   Note the passphrase.
3. Leave the old box and its backups as they are, and do not reset it (see
   [Resetting a box](#resetting-a-box)). Keep it switched on and online so it can send its last sales
   to AEAT; its dashboard raises an alert once a sale has waited four hours to be sent.
4. In the new box's setup wizard, choose Live, then on Import a configuration load the export with
   its passphrase. On Whose restaurant is this?, choose New tax ID, then enter the new taxpayer's
   tax ID, legal name, registered business address, invoice series and AEAT certificate.
5. Once it is running, check what came over that may still name the old business: the receipt
   header, footer, logo, phone and email (the venue's and each department's), the privacy notice
   web page and privacy email (Venue settings → Venue details → Privacy), and the staff. Staff
   arrive suspended, with no PIN or password.

The country must match: an export cannot be imported into a venue in another country. How long the
old database must be kept, and in what form, has not been checked.

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

- **A restore takes one of three sources.** `restore <backup-file>` restores an encrypted backup
  file, with its recovery key in `WAITRON_BACKUP_RECOVERY_KEY`.
  `restore --from-bucket <pack-or-kit-file>` rebuilds the box from the copy the old box kept in the
  owner's bucket. `<pack-or-kit-file>` is the venue's recovery pack PDF, made with **Make recovery
  pack** on the dashboard's Backups screen, or a recovery kit file saved before the pack replaced
  it. Either holds the bucket's key and the recovery key, so nothing secret goes on the command
  line. The file must be visible inside the container and readable by the image's user, `waitron`
  (uid 10001):
  `sudo chown 10001 recovery-pack.pdf` keeps it private at mode 0600. Otherwise the command stops
  with `cannot read kit file: /recovery-pack.pdf`.

  The command reads the bucket copy code from the file attached inside the PDF, never from its
  printed text, where a long code wraps. It restores nothing and prints one line when the pack
  holds no bucket copy code (the box had no bucket copy when the pack was made), when the PDF is not
  a Waitron recovery pack, or when the file attached inside the pack is damaged or was changed after
  it was made. The pack may also hold the server key: keep it locked away, off the box.

  **A filing node also needs its fiscal recovery operation.** Follow
  [Recover a filing box](../docs/developers/offline-fiscal-restore.md) to supply the selected
  backup's node key, a fresh allocation and current outside evidence. The source examples below
  show archive and bucket access only; add that procedure's recovery override and credentials
  when restoring Veri*Factu. The archive encryption key alone does not authorise activation.

  ```bash
  docker compose run --rm -v "$PWD/recovery-pack.pdf:/recovery-pack.pdf:ro" --entrypoint node app \
    /app/bin-restore.js restore --from-bucket /recovery-pack.pdf --confirm-venue <tax-id>
  ```

  It prints the business name, tax id and location of the copy it found, and restores nothing
  unless `--confirm-venue` names that tax id. If the old box wrote to the bucket in the last ten
  minutes, or that cannot be checked, it stops and says so; add `--confirm-old-box-gone` only when
  the old box is switched off for good. A backup file whose box was copying to a bucket gets the
  same check. Each form takes only its own flags, each once: `--confirm-venue` belongs to the
  bucket form alone, and a backup file given together with `--from-bucket` is refused. Anything
  else prints the usage line and exits 2.

  `restore --from-archive <pack-file> --archive-key <name>` downloads one archive from the bucket
  named in the venue's recovery pack PDF, or in an archive recovery pack file saved before the
  recovery pack replaced it, and restores it as `restore <backup-file>` does, with the same check
  on the old box. Either holds the bucket's key and the recovery key: keep it off the box, and
  make it visible and readable inside the container as above, or the command stops with
  `cannot read pack file: <path>`.
  `<name>` is the archive's file name as the bucket lists it. This form takes neither a backup
  file, `--from-bucket` nor `--confirm-venue`, and uses the pack's recovery key even when
  `WAITRON_BACKUP_RECOVERY_KEY` is set. An archive file downloaded from the bucket by hand
  opens with `restore <backup-file>` and its encryption key in
  `WAITRON_BACKUP_RECOVERY_KEY`. A filing node still needs the separate fiscal recovery inputs.

  ```bash
  docker compose run --rm -v "$PWD/recovery-pack.pdf:/recovery-pack.pdf:ro" --entrypoint node app \
    /app/bin-restore.js restore --from-archive /recovery-pack.pdf --archive-key <name>
  ```

  It reads the PDF's archive code the same way as `--from-bucket` reads its bucket copy code, and
  refuses in the same three cases, the first being a pack made while the box kept no backup archive
  in a bucket. The dashboard no longer shows either restore code on screen; both are in the
  recovery pack.

  **Keep older paper recovery keys.** Restoring an older backup also restores the node key
  from that time. A replaced key can work again on the restored box, while its replacement
  can be refused. Keep the older paper until every backup made before the replacement has
  been deleted. When the restored copy contains a key name, `restore.recovery_key_selected`
  names the paper you need. The node key authenticates recovery; the separate backup encryption
  key opens the backup file.

  A restore moves the old database into a hidden folder in the venue folder
  (`/var/lib/waitron/state/venue/` inside the container), named `.venue.db-replaced-` and six
  random characters, and deletes that folder once the restored database is in place. If the command
  reports `restore.placement_failed` and says the previous database could not all be put back,
  move everything in the folder it names back into the venue folder before
  `docker compose start app`. If the restore succeeded but its output shows
  `restore.db.aside_kept`, the folder that line names (`folder`) holds only the replaced database;
  the next server start tries to delete it, logging `restore.db.aside_removed` when it does and
  `restore.db.aside_kept` when it cannot. A server start that finds
  such a folder holding files and no `venue.db` beside it deletes nothing and refuses to start with
  `restore.database_set_aside`, naming the folder in its output: move everything in it back into
  the venue folder, or run the restore again. After a restore, the box also refuses to start with
  `restore.membership_invalid` when the restored copy's list of machines is damaged (cannot be
  read, or is not shaped as a list of machines), or does not pass its signature check against the
  node keys in that same copy. A box that comes up fenced or as a mirror runs only the first of
  those checks, and one still waiting to finish an adoption runs neither. The copy is left
  unchanged, so restarting reads it again: run the restore again from an older archive, or from the
  bucket if the refused copy came from an archive.

  Restore and rejoin are refused while another process, usually the running server, is using the
  venue folder (`provisioning.database_in_use`): rejoin before it reads or wipes anything, restore
  before it changes the venue folder, the box's identity or its secrets. A restore's earlier steps
  run in temporary folders under the state folder, and the bucket and archive forms download the
  whole copy or archive there first, then are refused only when they come to place it — so stop
  the server before any form. A run that downloads from the bucket, or checks a backup's bucket,
  makes its own folder (`stream-restore-`, `archive-source-check-` or, inside `restore-staging`,
  `archive-download-`, each followed by six random characters) and removes it when it ends; a run
  that is killed leaves it, holding a full copy of the venue's database or the encrypted archive,
  and the next run does not remove it. Once no restore is running, you can delete a leftover
  `stream-restore-*` or `archive-source-check-*` folder from the top of the `state` volume
  (`/var/lib/waitron/state` inside the container), or an `archive-download-*` folder from the
  `restore-staging` folder there. A `--from-archive` run that downloaded the archive but cannot
  remove its `archive-download-*` folder afterwards prints its result and then a line saying so;
  delete that folder the same way. Break-glass is the exception by design: it runs beside the server
  and takes no lock. Whatever holds the folder keeps a small file beside it,
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

`.env.example` documents every line. A box reached at `waitron.local` needs none of them set by
hand: with neither AppArmor nor systemd a plain `install` leaves it with no `.env` at all. Where AppArmor is on,
listing, pairing, forgetting and printing to Bluetooth printers needs the `WAITRON_PRINT_AGENT_APPARMOR` line `waitron.sh install` writes
there once it has loaded the profile. Where systemd runs, setting the box's clock needs the
`WAITRON_BOX_SOCKET_DIR` line `waitron.sh install` writes once the clock service's socket has
started (see Setting up a box).
The box holds no database credential, because there is no database server to hold one for. Its own secrets, the vault key ring and the CA and leaf
certificates, are minted on the first setup boot into the `state` volume and never appear here. A
box restored from a backup brings them back and, at its first trading start, replaces the leaf with
one naming its own addresses, signed by the same CA, so devices that trusted the old box need no new
trust step. A restored box that comes up fenced, as a mirror, or still waiting to finish an
adoption leaves the leaf as it is; if the replacement fails, the dashboard raises an alert and the
next start tries again. A restored copy whose list of machines is damaged (cannot be read, or is
not shaped as a list of machines) or fails its signature check stops the start before the leaf is
replaced (`restore.membership_invalid`, described under
[The operator CLIs](#the-operator-clis--two-different-invocation-forms)).

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

These development builds carry no release floor. To build a pinned image, pass the source commit
and its committer time together; the image build does not fetch them:

```bash
commit_sha=$(git rev-parse HEAD)
commit_metadata=$(git show -s --format='%H:%ct' "$commit_sha")
docker build -f deploy/Dockerfile -t waitron:pinned \
  --build-arg "WAITRON_BUILD_ID=$commit_sha" \
  --build-arg "WAITRON_SOURCE_METADATA=$commit_metadata" .
```

CI prepares the same metadata in its build context. `waitron.sh install <ref>` supplies it for
both image targets and needs `jq` to read the commit response; it installs `jq` through apt when
absent. On a host without apt, install `jq` before using a branch or commit ref.

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
