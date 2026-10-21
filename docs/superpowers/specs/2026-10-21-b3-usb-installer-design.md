# B3 — The bootable USB installer

**Status:** design, awaiting the owner's answers to five questions (§13). Nothing in it is built.
Lane A, 2026-10-21. Backlog entry: `docs/backlog.md`, "B3. The bootable USB installer". Pictures:
[`docs/backlog/mockups/b3-usb-installer/`](../../backlog/mockups/b3-usb-installer/).

Calls marked **my call** are mine, not the owner's; each can be overturned without changing the
rest. Everything said about outside software carries a source in the Provenance section at the
end; everything said about this repository carries a `file:line`.

---

## 0. Why this exists

Today a box is installed by hand. The README's own words: "Once per box, by whoever prepares it —
never by the restaurant. From nothing but a fresh Debian/Ubuntu box with internet, fetch and run one
script in one line" (`deploy/README.md:33-34`). Before that one line, somebody has installed an
operating system, chosen its disk layout, connected it to the internet and made a login. None of
that is written down anywhere in the repository (`deploy/README.md`, read whole, documents no
operating-system, partition, network or account step).

The owner decided on 2026-10-21 that the first venue's boxes are installed from the USB installer,
which makes B3 go-live work. Four other pieces of work are already waiting on what B3 lays down
(A950 is a queued item with a backlog entry, not yet a design; the other three are designs):

- **A950, automatic upgrades that can be undone** — needs a disk that can take a snapshot. "The B3
  installer lays the disk out, so it can put the folder holding Docker's volumes on btrfs"
  (`docs/backlog/box.md:58-61`).
- **A947, two local boxes with failover** — "Both boxes are installed from the same stick,
  identically. The setup wizard asks which job the box does … so the stick does not need to know"
  (`docs/superpowers/specs/2026-10-21-a947-two-box-failover-design.md:494-496`).
- **A798, keep trading when a part fails** — "The box image keeps its clock synchronised, with no
  terminal … the image makes it standing" (`docs/backlog/box.md:356-363`).
- **A940, the declaración responsable** — "B3's USB installer, when it is designed, copies the PDF
  onto the stick beside the installer" (`docs/superpowers/specs/2026-10-21-a940-declaracion-responsable-design.md:535-536`).

And the owner's 2026-10-21 answer on A732 — no recovery desk: "But this isn't needed. You just
reinstall the box and start again" (recorded in lane E's questions file, outside the repository;
the repo's A732 entry at `docs/backlog.md:362` predates it) — makes the stick the way a broken box
is repaired, not only the way a new one starts. Backups held elsewhere (an archive file, the
bucket, a Cloud copy) survive the wipe and are restored in the setup wizard.

## 1. Goals, non-goals, anti-goals

**Goals**

1. A person with no terminal skills turns a new mini PC into a Waitron box with one stick, a screen
   and a network cable, and ends at the setup wizard's first page, in about a quarter of an hour
   (an estimate; slice 1 measures it).
2. Every box installed from one release's stick starts from the same disk, apart from what the
   installer writes for that box (its network settings, its clock, a fresh machine identity, §7);
   CI builds the stick and installs it in a virtual machine before it is published.
3. The install needs no internet (§4). The box's clock, network and disk are ready for what A798,
   A947 and A950 ask of them.
4. The same stick reinstalls a broken box, and nothing erases a box that holds a venue without a
   clear warning naming that venue.
5. The stick is built and published for every release, with its licence notices, checksums and
   the declaración responsable.

**Non-goals**

- Choosing the box's hardware model. §11 says what the image needs; buying is separate.
- How upgrades run after install. A950 designs that; this design gives it the disk layout and the
  place a release is announced (§9).
- Joining a spare box, naming the box, and the fiscal setup. The setup wizard does all three (A947
  §4, A917 §9); the installer asks nothing about them.
- Disk encryption. A stolen box today holds the venue's database and its sealed secrets on one
  unencrypted disk, exactly as a hand-installed one does; §12 lists it as a new backlog entry.
- ARM boxes. Waitron publishes `linux/amd64` images only (`.github/workflows/ci.yml:2766-2769`,
  `:2779`).

**Anti-goals** — it fails, even if it works, if:

1. **A stick left in a box erases the venue.** A power cut, a box set to boot from USB first, and
   the stick still in the port must never lead to an unattended wipe of a working venue (§5).
2. **It asks a question the operator cannot answer.** Debian's own installer, told to ask only
   critical questions, still stops on a critical one its answer file misses (P3, P4); a box left at
   a blank prompt is a failed install.
3. **It ships software without its licence notices**, as Litestream once did (CLAUDE.md §3,
   "A change adding third-party code").

## 2. What exists today, and what is missing

| What | Today | Source |
| --- | --- | --- |
| Operating system | Whatever Debian or Ubuntu the preparer installed | `deploy/README.md:33-34` |
| Docker | Installed by `waitron.sh` from Docker's own package source when missing | `deploy/waitron.sh:143-165` |
| Waitron images | Pulled from GHCR (`:main`) and Docker Hub at install | `deploy/waitron.sh:329-330` |
| Box files | `/opt/waitron/compose.yml`, `.env`, the print agent's AppArmor profile, a Bluetooth drop-in | `deploy/waitron.sh:184-319` |
| Starting after a power cut | Docker's `restart: unless-stopped`; no Waitron service | `deploy/compose.yml:12`, `deploy/README.md:165-166` |
| Clock | Nothing sets up time synchronisation | `deploy/waitron.sh` (grep `timesyncd\|timedatectl\|chrony\|ntp`: none) |
| Disk layout | Whatever the preparer chose; "The Docker volumes live on the same disk as Docker's images" | `docs/superpowers/specs/2026-10-19-a798-degraded-trading-design.md:331-332` |
| Network | Assumed wired; nothing configures it | `deploy/waitron.sh` (grep `nmcli\|netplan`: none) |
| Releases | None. No `v*` tag, no GitHub Release; CI would publish `:<version>` on one | `.github/workflows/ci.yml:2758-2760` |
| Box screen | Nothing; the kiosk is a recorded lean, unbuilt | `docs/backlog/box.md:6-29` |
| Maintenance login | Nothing; a 2026-09-11 discussion record proposes one | `docs/superpowers/specs/2026-09-11-box-maintenance-and-remote-support.md:5` |

`waitron.sh install` stays as it is for a box installed by hand (§9). The installer does not run
it on the box; the stick's image is built to end in the same state, and a first-start service
does what `waitron.sh install` does after writing its files (§7).

## 3. The shape: a stick that writes a ready-made box

**The stick boots a small installer, which writes a ready-made Waitron disk onto the box's own
disk, grows it to fill the disk, and restarts into it.** The ready-made disk is built once per
release in CI and is already a complete box: Debian 13, Docker, the release's Waitron images,
the box files in place, the clock service on, and (if the owner agrees, §13 Q2) the full-screen
browser. On its first start a Waitron service on the box starts the containers, waits for them to
answer, and shows where to go next on the box's screen (§7); the screen opens the setup wizard
once the browser is there (slice 3).

**My call, against running Debian's own installer with an answer file.** Both were weighed:

| | Ready-made disk (chosen) | Debian's installer with an answer file |
| --- | --- | --- |
| What reaches each box | The same bytes CI built and booted | A fresh install from packages on the stick; each box can differ |
| Disk layout | Declared up front, any subvolumes (P6) | One btrfs subvolume, for `/`, only (P5); the rest by hand-written script at the end |
| A question the answers missed | Cannot happen: nothing is asked but §5's | A critical one stops the install (P3, P4) |
| Time per box | Copying an image (to be measured, slice 1) | A full package install (not measured) |
| Tooling | `mkosi`, in Debian, LGPL-2.1 (P7) | `debian-installer`, remastered ISO (P3) |

Home Assistant ships the same kind of ready-made disk for mini PCs, but makes the user write it to
the internal disk with another tool and turn Secure Boot off (P8). This stick does the writing
itself and keeps Secure Boot on (§10).

## 4. What is on the stick

One file per release, `waitron-<version>-installer.img.xz`, written to a stick of 8 GB or more.
Its parts (sizes are not measured; slice 1 measures them):

1. **A small Debian system that boots and runs the installer** (§5). It runs from memory and never
   writes to the stick.
2. **The ready-made box disk** (§6), compressed.
3. **A folder readable on any Windows or Mac computer**, named `WAITRON`, holding: `LEEME.html` /
   `README.html` (what this stick is and how to use it), the release's declaración responsable as
   PDF and text (A940 §7.1), the licence notices and the written offer for source code (§8), and a
   checksum list for the stick's own files.

**Everything the box needs is on the stick: the install needs no internet.** That answers the
backlog's open question "whether the stick carries the images so install needs no internet" (the
B3 entry in `docs/backlog.md` as it stood on main 76adaee84) — with the owner's confirmation,
§13 Q1. The cost is a large
download per release instead of a small one; a GitHub Release file must be under 2 GiB (P26), so
slice 1 measures the compressed size against that limit, and §12 says what happens if it is over.

## 5. What the person installing sees

Pictures 1 to 5. Screens are in Spanish, as the venue sees them, with English one tap away; the
installer's words live in its own translation file, never in its code (CLAUDE.md §3, "General
code is English only").

**Before:** the box is unpacked, its screen (or any HDMI monitor) and a network cable plugged in,
the stick inserted, then the power button. A mini PC that came with Windows may start Windows
rather than the stick, so the stick's printed card names the boot-menu key for the box model
Waitron sells (slice 6 finds it; §11).

1. **This box and its disk** (picture 1). The installer names the release ("Waitron 1.0.0"), the
   disk it will write ("Samsung SSD, 512 GB") and what that disk holds now, in one line: "Empty",
   "Windows", "Another system", or **"A Waitron restaurant: «Bar Santet», last sale 20/10/2026
   23:41"**. Two buttons: «Borrar e instalar» and «Apagar».
   - **A disk holding a Waitron venue** gets a red warning (picture 2). It names the venue, whether
     it is Live (filing with AEAT), its last sale, and **how many records it has not yet sent to
     AEAT**, which an erase loses unless a backup holding them is restored. It says the box's own
     backups are on this disk and go with it: the venue's data comes back only from a copy held
     elsewhere (an archive file, the bucket, a Cloud copy) restored in the setup wizard, or from a
     spare box (A947); either way this box starts a new fiscal chain (CLAUDE.md §5). The button
     stays disabled until the person types the venue's name. **My call**, as the strongest check
     that needs no password: the name is on every receipt, a stray press cannot type it.
   - **This departs from `waitron.sh`**, which refuses to reset a Live box ("Recover a broken
     production box from a backup", `deploy/waitron.sh:659`). The owner's A732 answer makes a
     reinstall the repair, so the stick erases a Live box — but only with the name typed and the
     unsent count shown.
   - **It fails closed.** A disk that looks like Waitron's (the stick's own layout, or a Docker
     volume named `waitron_state`) but whose venue cannot be read — encrypted, damaged, or a layout
     the installer does not know — is treated as a venue: the warning says it may hold a
     restaurant, and the person types «BORRAR».
     The installer shows its own on-screen keyboard, since a counter touchscreen may have no
     keyboard. How it reads the venue's name and last sale without starting Waitron is the
     builder's: the venue database is a SQLite file, `venue/venue.db`, inside the state volume
     (`deploy/README.md:8`), with a write-ahead log beside it that holds the latest writes.
   - **More than one disk** — the installer picks none by itself and asks which.
   - **Nothing happens without a press.** There is no countdown and no timer that starts the
     erase. A stick left in a box that restarts after a power cut stops on this screen and stays
     there: the venue is not erased, but it is not selling either until someone removes the stick
     and restarts. Step 5 makes that less likely; anti-goal 1 is why it is never automatic.
2. **Network** (picture 3). A cable with an address shows "Cable conectado — 192.168.1.40" and
   continues by itself. With no cable, the screen lists Wi-Fi networks and asks for the password
   (§13 Q5), or offers "Configurar la red más tarde".
3. **Date and time.** Online, the installer sets the clock from the internet and says so. Offline,
   it **always** shows the box's clock and asks the person to confirm or correct it — not only when
   it reads too early. A clock that is ahead is the dangerous one: Windows keeps the battery clock
   in local time by default (P28), which Linux reads as UTC, so a mini PC that came with Windows
   would read an hour or two fast in Spain (inference, for our model to check), and an offline box
   would stamp records with a future time that later trips A798's stop on payments. The installer
   writes the confirmed time to the battery clock in UTC. A clock earlier than the release's source
   commit is refused outright, because first Live setup refuses it too
   (`packages/fiscal-verifactu/src/hour-setup-clock.ts:37`; the floor is the commit's time,
   `scripts/generate-hour-release.mjs`).
   **A gap this does not close:** once installed, a box with no login has no way to set its clock
   by hand. A798 assumes "whoever installed the box sets its clock from the operating system"
   (`docs/superpowers/specs/2026-10-19-a798-degraded-trading-design.md:725-727`), and first Live
   setup compares the box's clock with the browser's
   (`docs/operations/first-live-fiscal-setup.md:14-17`), which proves nothing when the browser is
   the box's own screen. Both are handed back to A798 (§12).
4. **Installing** (picture 4): one progress bar, "No apagues el equipo", and the time left.
5. **Done**: "Quita el USB. El equipo se reinicia solo en 10 segundos." The installer also writes
   the firmware's boot order with the box's own disk first (`efibootmgr`). Whether a firmware set
   to start from USB first follows that order is untested (slice 6); the printed card says to take
   the stick out either way.

**After the restart** (picture 5), the box's screen shows what `waitron.sh` prints today: the
links, the box's IP-address link and a QR code to the trust page (`deploy/waitron.sh:374-391`,
written to `/dev/tty1` at `:439-446`) — the IP link matters when another box already answers
`waitron.local` (A917 §4.3). With the full-screen browser (§13 Q2, slice 3) the screen instead opens
the setup wizard's first page — A917's naming page once that is built, today's "Is this page
secure?" page until then (`apps/setup/src/setup-app.ts:545`). The installer asks nothing the wizard asks: not the name,
not new-venue-or-spare (A947 §9), not the fiscal mode.

**A box with no screen of its own** needs one plugged in for the install. Pressing a button is the
whole of anti-goal 1's protection, and pressing needs a screen. **My call**; the alternative is
§13 Q1 option C.

## 6. The disk the installer writes

**My call**, built so A950 can snapshot the venue without the operating system and roll back one
without the other:

| Part | Holds | Why separate |
| --- | --- | --- |
| EFI system partition, 512 MiB, FAT | The signed boot loader (§10) | The firmware starts from it |
| btrfs, rest of the disk | Everything else, in four top-level subvolumes: | |
| `@rootfs` → `/` | Debian, Docker, the kiosk | Debian's own updates (§9) roll back separately from the venue |
| `@images` → Docker's image and container store | The Waitron images | A950 keeps the old image by its tag, not in the snapshot (`docs/backlog/box.md:65-66`) |
| `@volumes` → Docker's volumes folder | `waitron_state`, `waitron_backups`, `waitron_print_agent`, `waitron_mailpit` | What A950 snapshots and puts back |
| `@logs` → mounted at the `waitron_logs` volume's folder | `waitron.log` | A subvolume of its own, so a snapshot of `@volumes` does not contain it (P13) and a rollback of `@volumes` should leave it alone — the case `docs/backlog/box.md:68-69` asks for. What a rollback does to a subvolume mounted inside another's folder is untested: slice 1 tries it |

- **Docker keeps its usual storage method on btrfs.** Docker's own advice is not to use its btrfs
  driver just because the disk is btrfs (P11). Where its image store lives depends on the Docker
  version: a fresh Docker 29 keeps images under `/var/lib/containerd`, not `/var/lib/docker` (P10),
  so `@images` covers whichever folders the chosen version uses. **My call: Docker from Docker's own
  packages, as `waitron.sh` installs today** (`deploy/waitron.sh:161-164`). Debian's own `docker.io`
  is older (26.1), and Debian's release notes warn that Go programs like it get "limited security
  support" (P9). Docker's packages have a cost §7 pays: Debian's automatic updates do not take them
  by default.
- **SQLite on btrfs is to be measured, not assumed** (slice 1). Debian's btrfs page warns against
  "COW on COW … databases that do their own COW" (P12); whether that applies to SQLite's write-ahead
  log, whether `@volumes` needs copy-on-write turned off, and what turning it off does to A950's
  snapshot, are one measurement.
- **Few snapshots.** Debian's page says performance "crashes somewhere between 12 snapshots per
  subvolume and/or 100 subvolumes per volume" (P12). A950 should keep few — one per upgrade in
  progress would do; A950's design decides.

The ready-made disk ships small and grows to fill the box's disk on its first start
(`systemd-repart`, P6).

## 7. The box's operating system

What the ready-made disk holds, beyond Debian 13's base — each one named, because an image tool
installs the packages its recipe names, and a minimal recipe leaves out packages Debian's own
installer would add, such as the clock service (P23; inference, not built):

- **Docker** (§6) and the release's two Waitron images and mailpit, tagged `:<version>` (A940
  §5.5) — either loaded into Docker's store during the build or loaded on first start from an
  archive on the disk; the builder picks, and either way nothing is downloaded. The box's
  `compose.yml` names those tags, never `:main`.
- **A first-start service** — nothing starts Waitron otherwise: a restart policy takes effect only
  after a container has started once (P29). It runs `docker compose up -d`, waits as `wait_healthy`
  does, and prints the links, IP link and QR code to the screen as `announce_ready` does, or the
  last log lines as `report_unhealthy` does (`deploy/waitron.sh:574-601`). After that, Docker's
  restart policy brings Waitron back after a power cut, as today.
- **The box files `waitron.sh install` writes today** — `compose.yml`, `.env`, the print agent's
  AppArmor profile and the Bluetooth drop-in (`deploy/waitron.sh:184-319`). Two of those steps read
  the live host and cannot run during an image build: the AppArmor step loads the profile into the
  running kernel (`:218-225`), which at build time is the build machine's, and the Bluetooth step
  reads the host's own Bluetooth service (`:250-255`). So the image installs the profile file and
  AppArmor loads it at boot; the first-start service names it in `.env` only once AppArmor reports
  it loaded — CLAUDE.md §3's rule ("named through `WAITRON_PRINT_AGENT_APPARMOR` only after
  `waitron.sh` has loaded it"), whose cost was a print agent that silently listed no Bluetooth
  printers. The Bluetooth drop-in is written at build time from the image's own
  `bluetooth.service`. Keeping the two install paths equal is a test, not a promise: slice 1
  compares a stick-installed box's files with a hand-installed one's.
- **`apparmor`, `bluez` and `dbus`** — the print agent's container binds the host's D-Bus socket and
  fails to start without it (`deploy/compose.yml:149-153`).
- **A blank machine identity** (`/etc/machine-id`), made fresh on each box's first start, as systemd
  asks of a generic image (P30): two boxes from one stick on one switch (A947) must not share one.
- **Firmware for common network cards** (wired and Wi-Fi), with its notices (P25).
- **`systemd-timesyncd`, switched on**, and the battery-backed clock kept in step with it: the
  standing half of A798's clock rule (`docs/backlog/box.md:356-363`). A PC has a battery-backed
  clock (P24); the box model's must be checked (slice 6).
- **`unattended-upgrades`**, which by default takes Debian's security fixes and its point releases
  and never reboots on its own (P15). Its default list takes only Debian's own sources (P15), so
  Docker's packages would never be updated. **My call:** add Docker's package source to its list,
  installed only in A950's quiet hour, with Docker's `live-restore` setting on so a Docker upgrade
  does not restart Waitron's containers (the builder confirms both on the real box). When the box
  may restart for a kernel fix is also A950's quiet hour.
- **NetworkManager**, for the Wi-Fi the installer set (§5 step 2).
- **WireGuard's tools**, so the link Cloud sets up later (`docs/backlog/box.md:355`) needs nothing
  installed.
- **The full-screen browser** — `cage` and Chromium — if the owner keeps the lean (§13 Q2). Without
  it the screen is a text console showing the links and QR code above.
- **No SSH server, no desktop, no other login** unless §13 Q4 says otherwise.
- **The licence notices**: every Debian package's `/usr/share/doc/<package>/copyright` stays in
  the image, even if documentation is trimmed (Debian policy requires that file, P20).

**Debian 13 is supported until 2028-08-09, and by a separate long-term team until 2030-06-30**
(P1, P2). Chromium on Debian 13 gets only six months of fixes once Debian 14 is out (P14). So the
box must move to Debian 14 within months of its release; how is §12's first open entry.

## 8. Built and published for every release

**A release is a `v<major>.<minor>.<patch>` tag** (A940 §5.1, designed, not built). On each one, a
new CI job:

1. Builds the ready-made disk and the stick with `mkosi` from the release's images (the ones CI
   just published for that tag, `.github/workflows/ci.yml:2760`).
2. **Boots the stick in a virtual machine and installs it onto a blank virtual disk**, with Secure
   Boot on, restarts into the installed disk, and waits for `/setup-api/status` to answer 200 —
   the same check the image smoke test makes today (`.github/workflows/image-smoke.yml:180-206`).
   It saves a screenshot of the box's screen and fails if the expected screen is not on it — the
   links and QR code until slice 3, the setup page after: a stick that boots to a blank screen
   passes every other check (CLAUDE.md §2, "a bundle that renders nothing passes anyway"). The job
   presses the installer's buttons as a person would, through the virtual machine's keyboard (or
   another route the builder shows works with Secure Boot on); a released stick carries no switch
   that skips the press.
3. Attaches to the GitHub Release: the stick file, its SHA-256, a signature (cosign, verifiable
   offline against Waitron's public key, P17), the list of every Debian package and version in it,
   and the declaración responsable (A940 §7.1).
4. **Publishes the source of every Debian package in the image**, kept by Waitron rather than
   pointed at Debian's mirrors, which drop old versions (P22). For a stick or box sent by post,
   GPL version 2 asks for the source in the parcel or a written offer good for three years to "any
   third party" (P19), and the GPL FAQ says a recipient may ask for it on physical media by post
   (P21). The stick's `WAITRON` folder carries the offer. The libvips notice's offer for "a box
   Waitron supplied" (`deploy/third-party/README.md:59-62`) follows GPL version 3's shape, so the
   operating system's GPL-2 packages (the kernel among them) need their own wording. Both go to the
   lawyer question already open (`docs/compliance/action-plan.md:29-35`), which must now name the
   operating system explicitly.
5. **Names it "Waitron", never "Debian".** Debian's trademark rules forbid the name in a product's
   name and allow describing it as based on Debian (P22).

The licence notices for what the operating system adds (Debian's packages, Chromium, `cage`,
Wi-Fi firmware, P25) answer the open point at `docs/backlog/box.md:27-29`. The existing guards
read the Dockerfile and workflows as text (`scripts/deploy-image-env.test.ts`, its third-party
blocks) and image-smoke looks inside the container image; nothing looks at an operating-system
image, so slice 5 adds a check that the stick's package list and its notices match.

**A note for A940.** Its draft declaration names «el sistema operativo Linux con Docker sobre el
que se instala» and points to `/app/third-party/` for the component list
(`docs/superpowers/specs/2026-10-21-a940-declaracion-responsable-design.md:237-242`). Once the stick
ships the operating system, that line names Debian 13 as part of what Waitron supplies, and its
notices live in the stick's `licencias` folder and under `/usr/share/doc` on the box. A940's text
changes with it.

## 9. Updates after install

A950 designs how a box upgrades; this design says only where it learns a release exists, the
backlog's other open question, "unattended updates for a box we did not sell"
(`docs/backlog.md:5263-5264`).

- **A small service on the box checks once a day for a new release**: a signed list attached to
  the latest GitHub Release, checked against Waitron's public key built into the image (P17). It
  runs on the host, outside the app container it replaces (`docs/backlog/box.md:83-86`: "a timer on
  the host running `waitron.sh`, or a small updater with access to Docker"). Watchtower, the usual tool, is archived and its authors advise
  against commercial use (P16).
- **Every stick-installed box gets the same updates, whoever sold it.** A box Waitron did not sell
  checks the same list. **My call**; a venue that wants to stay put is A950's question.
- **Two public keys in every image** (**my call**): the one that signs today and a spare kept
  offline, so a lost or leaked key is replaced by a list signed with the other, without
  reinstalling every box. Who holds them is the owner's, at slice 7.
- **A repair needs a stick at least as new as the box's data.** A restore refuses a database
  written by a newer release (`apps/server/src/restore.ts:288`, through `assertNotAhead`), so a box
  that has upgraded itself past its stick is reinstalled from the newest release's stick; the
  stick's `LEEME` says so.
- **A box installed by hand with `waitron.sh` has no such service** and upgrades as today.
- **Debian's own security fixes** arrive through `unattended-upgrades` (§7) whatever Waitron
  releases.

## 10. Secure Boot

**The box keeps Secure Boot on.** Debian boots with it on through a small loader signed by
Microsoft (P18). A custom image keeps that only if it uses Debian's signed loader, GRUB and kernel
unchanged, or else with our own key enrolled at the box's console (P18), which this operator
cannot do. So the image compiles none of them and adds no kernel modules of its own (`mkosi`
can install only already-signed boot files, P7). Two things to test on the real box (slice 6):

- some machines ship with the Microsoft certificate the loader needs switched off, and fail to boot
  with "security violation" until it is switched on in the firmware menu (P18);
- Microsoft's UEFI CA 2011, which signs third-party loaders like Debian's, expired on 27 June 2026;
  Debian 13's current loader is signed with both it and its 2023 successor (P18), so the build uses
  the current one.

## 11. What the box needs

Not a choice of model (non-goal), but what the image assumes — **my call** where the repo says
nothing:

- **x86-64, UEFI**, as every published image is `linux/amd64`.
- **8 GB of memory at least, 16 GB recommended** — the box runs the server, the database and, under
  the kiosk lean, a browser; the hardware notes say 8 GB is the floor these machines are sold at
  and that the box "wants the headroom" (`docs/superpowers/specs/2026-09-18-handheld-and-till-hardware-decisions.md:234-239`).
- **A 128 GB disk at least** (the till machines' 128–256 GB, `:230-233`; to be checked against
  measured photo and backup growth).
- **Gigabit Ethernet.** A947 puts both boxes on the same switch (A947 §9).
- **A working battery-backed clock** (A798).
- **Firmware set to switch on when mains power returns** (`hardware decisions`, `:187-197`) — a
  setting in the firmware's own menu, which this design does not try to set from the image. For a
  box Waitron sells, set before it ships; the stick's printed card says how for anyone else.
- **Designed and tested for the model Waitron sells.** The installer finds NVMe, SATA and eMMC
  disks and the image carries Debian's firmware for common network cards, so other x86 mini PCs may
  work; only the model Waitron sells is tested.
- **Intel Wi-Fi, if any, runs a hotspot on 2.4 GHz only** (P27) — which matters only if the owner
  picks the hotspot (§13 Q5).

## 12. What this design leaves open, as backlog entries

1. **Moving a box from Debian 13 to Debian 14** without reinstalling — before Chromium's six
   months run out (P14).
2. **Disk encryption** (§1, non-goals) — a stolen box's data; whether to unlock with the box's
   security chip.
3. **A stick over 2 GiB** (§4): split the file or host it elsewhere, decided once slice 1 measures
   it.
4. **Changing the box's Wi-Fi after install**, when the venue changes its router, without a
   terminal: today only a reinstall does it (§5 step 2).
5. **Resetting a box without a terminal** (`docs/backlog/box.md:139-153`) is answered for the whole
   box by a reinstall from the stick. A reset that keeps the certificate has no path on a stick box
   (no login, unless §13 Q4); that entry stays open, still refused on a Live box as it asks.
6. **Setting the clock by hand without a terminal** after install, and first Live setup's clock
   check when the browser is the box's own screen (§5 step 3) — handed to A798.
7. **A reinstall that keeps the venue's data** (rewrite the system, keep `@volumes`). Not proposed:
   the owner's A732 answer chose "reinstall the box and start again".

## 13. Questions for the owner

Asked one at a time, with pictures, through the watcher. The full text, with the worked examples,
is in [`question.txt`](../../backlog/mockups/b3-usb-installer/question.txt).

1. **What the stick does.** **A (recommended):** carries everything, needs no internet, asks one
   confirmation on the box's screen before erasing (§3–§5). **B:** a small stick that downloads
   the release during the install. **C:** fully unattended, erasing with no question, for boxes
   with no screen — and a stick left in a box can erase a venue.
2. **The full-screen browser on every box** (the owner's lean of 2026-09-29). **A (recommended):**
   every box carries it and shows it whenever a screen is plugged in. **B:** a server-only box;
   tills are always separate machines or tablets.
3. **Whether the box's screen is a till** (the owner's lean of 2026-09-29). **A (recommended):** it
   joins like any other till — accepted once by a manager, the staff PIN as its lock — and a spare
   box's screen is a till of the main box, so it keeps working through a switch. This changes A947,
   which draws the spare's screen as a status page "while it waits"
   (`docs/superpowers/specs/2026-10-21-a947-two-box-failover-design.md:507-508`). **B:** the box's
   screen shows only the box's status.
4. **A maintenance login on each box** (the 2026-09-11 discussion record). **A (recommended):** a
   `maintenance` account with no standing password; booting the stick and choosing «Abrir acceso
   de mantenimiento» shows a fresh one-time password, valid until the box next restarts. The stick
   is public, so anyone with the box and a stick gets a login — the exposure the unencrypted disk
   already gives anyone holding the box. **B:** a
   password per box, printed on a sealed card when it is installed. **C:** no login at all;
   every repair is a reinstall.
5. **Wi-Fi for the box** (the backlog's "AP-mode WiFi onboarding"). **A (recommended):** the box is
   wired; with no cable, the installer's own screen picks the Wi-Fi network. **B:** the box also
   offers its own Wi-Fi hotspot, so a phone can set it up when the box has neither a screen nor a
   cable.

## 14. Build order, one pull request each

1. **The ready-made disk** — `mkosi` build of §6 and §7 in CI on every change to its inputs, booted
   in a virtual machine to `/setup-api/status` 200 and a screenshot of the links and QR code.
   Measures: the stick's compressed size, install time, SQLite on btrfs, a rollback of `@volumes`
   with `@logs` mounted inside its folder, and a stick-installed box's files against a
   hand-installed one's. Not yet published.
2. **The stick and its installer** — §5's screens, the disk check, writing and growing the disk,
   the boot order, the `WAITRON` folder; booted end to end in CI with Secure Boot on.
3. **The box's screen** — per Q2 and Q3: `cage` and Chromium, with the four traps the hardware
   notes list (`hardware decisions`, `:187-197`: the "restore pages?" bubble, Chromium's own
   certificate store, screen blanking, power-on after a power cut).
4. **Maintenance access** — per Q4.
5. **Publishing per release** — §8 steps 3–5, after A940's release slices.
6. **On the real box** — the first install on the chosen model: Secure Boot, the boot-menu key, the
   clock, the four traps, a power cut with the stick left in (anti-goal 1).
7. **The release check** — §9's service, handed to A950.

Slices 1, 2 and 5 are the go-live minimum: a Live box runs only a release (A940 §5.1), so the
first venue's stick is built from the first release tag, which waits for A940's release slices.
Slices 3 and 4 follow the answers. None is fiscal.

## 15. What this design does not settle, for the builder

- How the installer reads a venue's name, mode, last sale and unsent count from the disk (§5 step
  1), including the write-ahead log's latest writes.
- How the image build reuses `waitron.sh`'s file-writing steps (§7).
- The installer's own screen technology; using the same `cage` and Chromium as the kiosk keeps one
  look and one set of fonts.
- How the kiosk trusts the box's certificate authority, which the server mints at its first setup
  start (`apps/server/src/boot.ts:1012-1017`), after the image is built.
- The exact Docker version and image-store folders `@images` covers (§6).

## Provenance

Fetched 2026-10-21 with `curl`; the source's own words are quoted in
`~/waitron-campaign/b3-design/research-external.md` (outside the repository), section numbers given.

| # | Claim | Source (section of the research file) |
| --- | --- | --- |
| P1 | Debian 13 "trixie" is stable; regular support to 2028-08-09, LTS to 2030-06-30 | https://www.debian.org/releases/ (1.1) |
| P2 | LTS is "not handled by the Debian Security and Release teams" | https://wiki.debian.org/LTS (1.2) |
| P3 | A preseed file goes in the initrd or on a remastered image | https://www.debian.org/releases/trixie/amd64/apbs02.en.html (1.5) |
| P4 | "When the answer to a question is not present in a preseed, d-i stops and asks the user for input" (Ubuntu's page, on Debian's installer); Debian's own: `priority=critical` "stops any questions with a lower priority from being asked" | Ubuntu Subiquity docs, intro-to-autoinstall (1.12); Debian apbs02 (1.6) |
| P5 | The installer's btrfs support creates only `@rootfs` for `/` | partman-btrfs `mount.d/btrfs` and changelog v53 (1.10) |
| P6 | `systemd-repart` grows partitions and declares btrfs `Subvolumes=` (systemd 255+; Debian has 257) | systemd-repart and repart.d manuals; packages.debian.org (2.4) |
| P7 | `mkosi` builds GPT disk images, is in Debian (25.3), LGPL-2.1-or-later, and with `ShimBootloader=signed` installs only signed boot files | packages.debian.org/trixie/mkosi; mkosi man page (2.1) |
| P8 | Home Assistant OS on x86: written by the user with another tool; "Secure Boot disabled" | https://www.home-assistant.io/installation/generic-x86-64 (2.5) |
| P9 | Debian's `docker.io` is 26.1.5; Go and Rust packages "will be covered by limited security support"; "In most cases if updates are warranted for Go or Rust development libraries, they will only be released via regular point releases" | packages.debian.org; trixie release notes §5.2.3.2 (3.4, 3.5) |
| P10 | Docker 29 "uses the containerd image store by default for fresh installations"; data-root "does not affect … /var/lib/containerd" | docs.docker.com select-storage-driver and daemon (3.6, 6.4) |
| P11 | "In most cases you should use the overlay2 storage driver … Btrfs driver has known issues" | docs.docker.com btrfs-driver (6.1) |
| P12 | "COW on COW: Don't do it! … databases that do their own COW"; performance "crashes somewhere between 12 snapshots per subvolume and/or 100 subvolumes per volume" | https://wiki.debian.org/Btrfs (6.3) |
| P13 | "snapshotting is not recursive … no files in the nested subvolumes appear in the snapshot" | btrfs.readthedocs.io Subvolumes (6.2) |
| P14 | "Chromium will only receive 6 months of security support in oldstable" | trixie release notes §5.2.3.1 (5.4) |
| P15 | `unattended-upgrades` defaults: only `origin=Debian` sources (trixie and trixie-security), no `-updates`, no automatic reboot | `50unattended-upgrades.Debian` 2.12, lines 29-33 (7.1) |
| P16 | Watchtower archived; "We do **not** recommend using Watchtower in a commercial or production environment" | containrrr/watchtower README (7.3) |
| P17 | cosign verifies against a key, offline; Docker Content Trust is being retired | sigstore docs; docs.docker.com trust (7.4) |
| P18 | Debian Secure Boot via Microsoft-signed shim; custom kernels need signing and a key enrolled (MOK) at the console; some machines ship the 3rd-party CA disabled; Microsoft UEFI CA 2011 expires 27 June 2026; trixie shim dual-signed with the 2023 CA | wiki.debian.org/SecureBoot; Microsoft support article; shim-signed changelog (8.1–8.4) |
| P19 | GPLv2 §3: source with the binary, or a written offer valid three years | gnu.org GPL-2.0 (9.1) |
| P20 | "Every package must be accompanied by a verbatim copy of its distribution license(s) in the file /usr/share/doc/PACKAGE/copyright" | Debian policy §12.5 (9.5) |
| P21 | GPL FAQ: under v2, physical-media recipients may ask for source by post | gnu.org GPL FAQ (9.2) |
| P22 | Derivatives "must not be named Debian"; "run a Debian mirror to ensure source and binary availability" (that Debian's mirrors drop old versions is my inference) | wiki.debian.org/Derivatives/Guidelines; debian.org/trademark (9.4) |
| P23 | debootstrap's `minbase` installs "only … required packages and apt", its default required and important ones; `systemd-timesyncd` is priority standard; `unattended-upgrades` might not be installed | debootstrap man page; systemd `debian/control`; wiki UnattendedUpgrades (11.2, 7.2) |
| P24 | "All PCs … have a Real Time Clock built into them", battery backed | Linux `Documentation/admin-guide/rtc.rst` (11.1) |
| P25 | Intel Wi-Fi firmware may be redistributed in binary form with its notice | firmware-nonfree copyright (9.6) |
| P26 | "Each file included in a release must be under 2 GiB" | github/docs `about-releases.md:49` and `data/variables/large_files.yml` (`max_file_size: '2 GiB'`), fetched 2026-10-21 |
| P27 | iwlwifi: "AP mode on 2.4GHz … no 5GHz AP support" | wireless.docs.kernel.org iwlwifi (4.4) |
| P28 | "By default, Windows uses localtime" for the hardware clock | https://wiki.archlinux.org/title/System_time, fetched 2026-10-21 by the second review |
| P29 | "A restart policy only takes effect after a container starts successfully" | https://docs.docker.com/engine/containers/start-containers-automatically/, fetched 2026-10-21 by the second review |
| P30 | `/etc/machine-id` "should be either missing or an empty file in the generic file system image" | machine-id(5), freedesktop.org, fetched 2026-10-21 by the second review |
