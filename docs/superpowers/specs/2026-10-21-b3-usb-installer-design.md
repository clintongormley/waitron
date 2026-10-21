# B3 — The bootable USB installer

**Status:** design, revised 2026-10-21 for the owner's answers to its five questions (§18) and for
W60 (§12); the revision awaits the owner's approval, and one new question (§18). Nothing in it is
built. Lane A. Backlog entry: `docs/backlog.md`, "B3. The bootable USB installer". Pictures:
[`docs/backlog/mockups/b3-usb-installer/`](../../backlog/mockups/b3-usb-installer/).

**What the revision changed.** The first version carried every release on a large stick, needed no
internet, and erased nothing without a press on the box's screen. The owner chose instead: a small
stick that downloads the release, installing with nobody at the box, made safe by three guards (§5);
a full-screen browser on every box and no desktop, with the box's settings as Waitron screens
(§9, §10); the box's screen opening the dashboard after setup, able to become a till, and able to
start on the till (§9); the disk encrypted with its key held in the box's security chip (§7), and a
maintenance login handed out by the box itself (§11); and, during the install, the installer's own
Wi-Fi hotspot as the fallback when there is no cable (§5.3). The watcher folded W60 in: a production box offers neither Demo nor
Prepare, and nobody can set up a box before its owner does (§12).

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
(A950 is a lane A campaign item for the backlog entry "Automatic upgrades that can be undone",
`docs/backlog/box.md:44-79`, not yet a design; the other three are designs):

- **A950, automatic upgrades that can be undone** — needs a disk that can take a snapshot. "The B3
  installer lays the disk out, so it can put the folder holding Docker's volumes on btrfs"
  (`docs/backlog/box.md:63-66`).
- **A947, two local boxes with failover** — "Both boxes are installed from the same stick,
  identically. The setup wizard asks which job the box does"
  (`docs/superpowers/specs/2026-10-21-a947-two-box-failover-design.md:1239-1241`).
- **A798, keep trading when a part fails** — "The box image keeps its clock synchronised, with no
  terminal … the image makes it standing" (`docs/backlog/box.md:366-373`).
- **A940, the declaración responsable** — "B3's USB installer, when it is designed, copies the PDF
  onto the stick beside the installer" (`docs/superpowers/specs/2026-10-21-a940-declaracion-responsable-design.md:863-864`).

And the owner's 2026-10-21 answer on A732 — no recovery desk: "But this isn't needed. You just
reinstall the box and start again" (recorded in lane E's questions file, outside the repository).
The stick is that reinstall, for any broken box, Live ones included (§5, guard 3). Backups held
elsewhere (an archive file, the bucket, a Cloud copy) survive the wipe and are restored in the setup
wizard.

## 1. Goals, non-goals, anti-goals

**Goals**

1. A person with no terminal skills turns a new mini PC into a Waitron box with one stick, a network
   cable (or a phone, §5.3) and nothing else — no screen, no keyboard — and ends with the box
   answering at `waitron.local`, ready for its setup wizard.
2. Every box installed from one release starts from the same disk, apart from what the installer and
   the first start write for that box (its network settings, its clock, a fresh machine identity, its
   disk key and recovery key, its name tag, its setup code, the disk grown to fill the box, the print
   agent's AppArmor line, §7, §8, §12); CI builds the disk
   and installs it in a virtual machine before it is published.
3. A stolen disk, or the box started from any other stick, shows only scrambled data (§7).
4. A stick left in, or put back into, a working box never erases it: the box keeps selling (§5).
5. The box needs no terminal after install: its screen, its network and its maintenance are reached
   through Waitron (§9–§11).

**Non-goals**

- Choosing the box's hardware model. §16 says what the image needs; buying is separate.
- How upgrades run after install. A950 designs that; this design gives it the disk layout, the host
  service it needs (§8) and the place a release is announced (§14).
- Joining a spare box, naming the box, and the fiscal setup. The setup wizard does all three (A947,
  A917); the installer asks nothing about them.
- ARM boxes. Waitron publishes `linux/amd64` images only (`.github/workflows/ci.yml:2778-2780`,
  `:2791`).
- Installing with no internet. The owner chose the small downloading stick (§18 Q1); §5.3 says what
  the person does without a connection.

**Anti-goals** — it fails, even if it works, if:

1. **A stick in a box erases a venue nobody chose to erase.** A power cut, a firmware set to start
   from USB first, and the stick still in the port must never lead to a wipe of a working venue (§5).
2. **The box stops and waits for an answer nobody can give.** A box with no screen that halts at a
   question is a failed install; the installer asks nothing of a box whose disk it can classify
   (§5.2).
3. **An encrypted box locks its own venue out after a routine update.** A key that the security chip
   refuses after an ordinary kernel update stops the restaurant at a prompt only a keyboard and the
   printed recovery key can pass (§7.4).
4. **It ships software without its licence notices**, as Litestream once did (CLAUDE.md §3,
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
| Disk encryption | None designed; an older design pointed at "full-disk encryption, TPM-sealed auto-unlock" in a spec since deleted | `docs/superpowers/specs/2026-09-07-fiscal-cert-distribution-design.md:60` |
| Network | Assumed wired; nothing configures it | `deploy/waitron.sh` (grep `nmcli\|netplan`: none) |
| First setup | Unauthenticated; Demo and Prepare go to whoever is first, Live to the first claim | `apps/server/src/setup-api.ts:613`, `:806`; `packages/provisioning/src/first-setup-state.ts:507-515` |
| Releases | None. No `v*` tag, no GitHub Release; CI would publish `:<version>` on one | `.github/workflows/ci.yml:2770-2772` |
| Box screen | Nothing; the kiosk is a recorded lean, unbuilt | `docs/backlog/box.md:6-33` |
| Box settings (Wi-Fi, clock) | No screen; the server only reads the clock's state by running `timedatectl` | `apps/server/src/time-health.ts:34-42` |
| Host-side helper | Only the print agent, which reaches the host's message bus through a mounted socket | `deploy/compose.yml:145-153` |
| Maintenance login | Nothing; a 2026-09-11 discussion record proposes one | `docs/superpowers/specs/2026-09-11-box-maintenance-and-remote-support.md:5` |

`waitron.sh install` stays as it is for a box installed by hand (§14). The installer does not run
it on the box; the ready-made disk is built to end in the same state, and a first-start service
does what `waitron.sh install` does after writing its files (§8).

## 3. The shape: a small stick that fetches a ready-made box

**The stick boots a small installer. It fetches the newest release's ready-made Waitron disk,
checks its signature, writes it onto the box's own disk inside an encrypted container, and restarts
into it once the stick has been taken out.** The ready-made disk is built once per release in CI and
is already a complete box: Debian 13, Docker, the release's Waitron images, the box files in place,
the clock service on, the full-screen browser and the box's host service (§8). On its first start
the box seals its disk key into its security chip, starts Waitron, and opens the setup wizard on its
screen if it has one (§8, §9).

**My call, against running Debian's own installer with an answer file.** Both were weighed:

| | Ready-made disk (chosen) | Debian's installer with an answer file |
| --- | --- | --- |
| What reaches each box | The disk CI built and booted | A fresh install from packages; each box can differ |
| Disk layout | Declared up front, any subvolumes (P6) | One btrfs subvolume, for `/`, only (P5); the rest by hand-written script at the end |
| A question the answers missed | Cannot happen: nothing is asked | A critical one stops the install (P3, P4) — on a box with no screen, for ever |
| Time per box | A download and a copy (measured in slice 2) | A full package install (not measured) |
| Tooling | `mkosi`, in Debian, LGPL-2.1 (P7) | `debian-installer`, remastered image (P3) |

Home Assistant ships the same kind of ready-made disk for mini PCs, but makes the user write it to
the internal disk with another tool and turn Secure Boot off (P8). This stick does the writing
itself and keeps Secure Boot — the firmware's rule that it starts only software signed by a key it
trusts — on (§15).

## 4. What is on the stick

One small file, `waitron-installer-<n>.img`, written to any stick (its size is measured in slice 2).
The stick does not change with every release: it fetches the newest one (§5.4). Its parts:

1. **A small Debian system that boots and runs the installer.** It copies itself into memory as it
   starts, so the stick can be taken out once it says so (§5, guard 2), and it never writes to the
   stick except the one file in item 3.
2. **Waitron's two public signing keys** (§14), against which it checks the release list and the
   disk it downloads.
3. **A folder readable on any Windows or Mac computer**, named `WAITRON`, holding: `LEEME.html` /
   `README.html` (what this stick is, the three guards in one paragraph each, and what to do with no
   internet), a `licencias` folder with the licence notices and the written offer for source code
   for the installer itself (§13), a checksum list, and — written by the installer at each install —
   **the setup code of each box it installed** (§12), in `codigos-de-configuracion.txt`.

The release's declaración responsable (A940 §7.1) is downloaded with the release and kept on the
box, where Help → About shows it (A940's design), rather than on a stick that may be older than the
release it installs. **My call**; A940 assumed the PDF goes on the stick
(`docs/superpowers/specs/2026-10-21-a940-declaracion-responsable-design.md:863-864`), and §17
hands that line back to A940.

## 5. What happens at the box

Pictures 1 to 4 (picture 6 shows the stick's folder and the disk). A box with a screen shows every step there, in Spanish with English one tap away;
the installer's words live in its own translation file, never in its code (CLAUDE.md §3, "General
code is English only"). A box with no screen shows nothing, and the person follows the printed card
and, if they want to watch, the status page (§5.6).

**The person's whole job:** plug in the network cable, insert the stick, press the power button;
take the stick out once the screen, the status page or the card says «Ya puedes quitar el USB»; wait
for `waitron.local` to answer. A mini PC that came with Windows may start Windows rather than the
stick, so the card names the boot-menu key for the box model Waitron sells (slice 6 finds it; §16).

**The order, every time** (**my call**), so that nothing is erased until everything that could stop
the install has been checked:

1. the installer starts and copies itself into memory;
2. it reads the disk (guard 3, §5.2) and checks the box: one internal disk, a security chip switched
   on (§7.7) and Secure Boot switched on (§15). A box that fails a check is refused here, untouched;
   a box that already holds Waitron goes guard 3's way and writes nothing to the stick;
3. only for a box it is going to install (or one whose reinstall a person has confirmed), it makes
   the box's **setup code** and writes it onto the stick (§12), then says «Ya puedes quitar el USB»
   — the one moment the stick may come out, used by guard 2, §5.6 and the card;
4. it finds the network (§5.3), sets the clock (§5.4), downloads the release and checks it (§5.4);
5. only then, the 60-second wait (§5.2), the erase and the write (§5.5);
6. the restart, once the stick is out (guard 2).

### 5.1 The three guards (the owner's, §18 Q1)

1. **Boot once.** After writing the disk, the installer puts the box's own disk first in the
   firmware's boot order (`efibootmgr --bootorder`, P47) and also installs Debian's signed loader to
   the disk's fallback path (`\EFI\BOOT\BOOTX64.EFI`, the path a firmware falls back to when its
   boot order fails or is missing, P47, P48). Debian's own pages say some firmware "ignore the boot
   order altogether" (P48); whether the chosen model does is slice 6's test. **On a firmware that
   ignores the order and starts from USB first**, guard 2 has the stick out before the box's first
   restart, and guard 3 covers a stick put back later.
2. **The stick comes out before the box restarts.** The installer runs from memory (§4 item 1).
   When it has finished writing and checking the disk, it restarts into the box only once the stick
   is gone; until then it waits, saying so on the screen and the status page. A stick taken out any
   time after «Ya puedes quitar el USB» (step 3 above) changes nothing: the install carries on and
   restarts by itself when done. A stick taken out before that just stops a start that had not
   touched the disk.
3. **A stick that finds Waitron on the disk does nothing unless a key is pressed.** The installer
   recognises the box's own disk by markers set at install and never changed afterwards — the
   partition's type and name, and the encrypted container's "subsystem" field — all readable
   without the key (P45). (Every header update rewrites the "subsystem" bytes with the same value;
   an interrupted header write is covered by LUKS2's second copy of the header, and slice 2 tests
   one.) **It also recognises every layout an earlier installer wrote.** If it
   finds one, it shows «Este equipo ya tiene Waitron («Bar Santet»). Se inicia en 15 segundos.
   Pulsa una tecla para reinstalarlo.» on any screen, waits 15 seconds, then **starts the installed
   box**: it sets the firmware's one-time boot choice to the box's own disk (`BootNext`, P47) and
   restarts. So a stick left in costs the venue one extra restart, not its afternoon. **My call**:
   the owner asked that the stick "refuse to do anything"; starting the installed box instead of
   stopping is the same refusal, without leaving a venue dark until someone finds the stick. A
   firmware that ignores `BootNext` as well would loop through the stick every start; slice 6 tests
   the chosen model, and the screen and status page then say «Quita el USB».
   - **A key pressed** (it needs a keyboard, as the owner said) opens the reinstall screen
     (picture 2): the venue's name and whether it is Live, read from the disk's name tag (§7.6),
     and a warning that the box's own backups and its own host history, which a later recovery
     checks (`docs/operations/hour-recovery.md:21-23`, "surviving host history"), go with the
     disk; the venue's data comes back only from a copy held elsewhere restored in the setup wizard,
     or from a spare box (A947), and either way this box starts a new fiscal chain (CLAUDE.md §5).
     Erasing needs the venue's name typed (**my call**, the strongest check that needs no password:
     the name is on every receipt, a stray press cannot type it), or «BORRAR» if the name tag cannot
     be read. The person may also type the box's **recovery key** (§7.5) to see what the disk holds
     — its last sale and **how many records it has not yet sent to AEAT**, which an erase loses
     unless a backup holding them is restored. **Two minutes with no typing** and the screen goes
     back to starting the installed box, as if no key had been pressed — a till box may keep a
     barcode scanner plugged in, and a scanner types like a keyboard. **My call.**
   - **The same shape as `waitron.sh`, with a different word typed.** `waitron.sh` refuses to reset
     a Live box unless run with `--force-production` and the word «production» typed
     (`deploy/waitron.sh:659-662`).

### 5.2 A box that holds anything else

A disk the installer **can classify** as holding no Waitron — empty, Windows (BitLocker-encrypted
Windows included, which the installer is expected to recognise by its on-disk signature — the
plan's to show), or another system it recognises — is erased
with no question, because the owner chose a fully unattended install (§18 Q1). **One safety, my
call:** the erase waits 60 seconds after the release has been downloaded and checked, and a screen,
if any, shows «Se borrará «Windows» en el disco Samsung SSD 980 (512 GB) en 60 segundos. Pulsa una
tecla para detenerlo.» A key stops it and offers «Instalar ahora» or «Apagar». On a box with no
screen the 60 seconds pass unseen. The stick's label and its `LEEME` say plainly that it erases any
computer that starts from it.

**A disk it cannot classify** — an encrypted container that is not Waitron's, a damaged Waitron
disk whose markers cannot be read, anything it does not recognise — is **never erased without a
key**: the installer stops and waits, saying so on the screen and the status page, and a person
with a keyboard decides, typing «BORRAR». **My call**: a stick that fails to recognise a damaged
Waitron box must not wipe it unattended (anti-goal 1). Slice 2 tests it with a long accented venue
name, a stick put back in, and a deliberately damaged marker; none may be erased.

**More than one internal disk:** the installer picks none and stops, saying so on the screen and the
status page — choosing needs a screen and keyboard. **My call**: a box Waitron sells has one disk; a
wrong guess erases the wrong one.

### 5.3 Network, and what to do without one

**Nothing is erased until the release has been downloaded and checked**, so a box with no internet
is left exactly as it was.

1. **A cable** with an address and a route to the internet: the installer goes straight on.
2. **No cable, or a cable with no internet:** after one minute the installer opens **its own Wi-Fi
   network, «Waitron-Instalar»**, with no password (the owner allowed open or one shared password,
   §18 Q5; **my call**: open, as phones join it with one tap). A phone that joins is shown the
   installer's page by the phone's own sign-in prompt for Wi-Fi networks (Android and Apple both
   check for one when they join, P52), or by opening `http://10.42.0.1`, an address the installer
   fixes in that network's settings (NetworkManager picks some 10.42.x.1 unless told, P51). The
   network **passes nothing on**: a phone on it reaches the installer's page and nothing else — not
   the internet and not a cable's network — because a "shared" network would otherwise route its
   members onward (P51); the installer builds it without NetworkManager's sharing, or with a firewall
   rule that forwards nothing (the plan picks). The page lists the networks the box can see and asks for the venue's Wi-Fi
   password — the one secret that crosses the open network, typed once, within radio range, for the
   minute it takes. The installer then closes its network and joins the venue's; if that fails, it
   opens its network again and the page says the password was wrong. (Most Wi-Fi cards cannot offer
   a network and join one at the same time; that is why it closes first — an inference, for slice 2
   to confirm on the chosen model. Intel cards offer their own network on 2.4 GHz only, P27.)
3. **No venue internet at all**, until the line arrives: the person shares a phone's mobile data —
   by the phone's own hotspot, chosen on the installer's page like any Wi-Fi network, or by a USB
   cable with the phone's USB tethering switched on, which the installer treats as a cable. Whether
   Debian's installer system recognises both kinds of phone over USB is slice 2's to show. The
   download is the ready-made disk, under 2 GiB (§13) — a large but bounded amount of mobile data.
   A box installed over a phone stays on the phone's network until someone moves it, from
   Settings → Red (§10) or by plugging in a cable.
4. **Otherwise it waits**, trying again every minute, with nothing erased; the power button turns
   it off safely at any time.

### 5.4 The release it installs

The installer reads the **release list** attached to the newest GitHub Release, checks its
signature against the keys on the stick (§14), and downloads the ready-made disk that list names,
checking its checksum. **The clock comes first:** the HTTPS download's certificate check fails on a
clock that is far wrong (P54), and a mini PC that came with Windows keeps its battery clock in local
time (P28), so the installer sets the clock from network time before it downloads anything, and
writes the result to the battery clock in UTC. The installer image's clock floor is raised to its
own build date at build time (`/usr/lib/clock-epoch`, P54), so a dead battery cannot set it to 1970.
**This closes the first version's offline clock step**: every install now has the internet, and so
network time.

The list also names the **oldest installer** each release accepts. A stick older than that says so
and stops before erasing anything — «Este USB es demasiado antiguo para Waitron 1.4.0. Descarga uno
nuevo.» **My call**: it lets a release change the disk layout without old sticks writing the old one.
And because every install fetches the newest release, **a box reinstalled to take a restore is not
older than a backup made by any released version** — so the first version's "a repair needs a stick
at least as new as the box's data" (a box refuses a database carrying migrations its image does not
ship, `assertNotAhead`, `apps/server/src/node-entry.ts:235-245`) no longer applies to them. The
exception is a backup from a box installed by hand on `:main`, which can be ahead of the newest
release; it waits for the next release.

The download is held in memory until checked, then written. **My call**; it is what makes "nothing
erased until checked" true. It needs memory for the compressed disk on top of the installer itself,
which an 8 GB box has if the disk stays under 2 GiB (§13, §16); slice 2 measures both.

### 5.5 Installing, and the restart

The installer erases the disk, lays out the boot partition and the encrypted container (§6, §7),
makes the container fill the disk, writes the ready-made filesystem into it with the box's setup
code (§12), checks what it wrote, sets the boot order (guard 1), and then waits for the stick to be out
(guard 2). Picture 4.

### 5.6 Where the person sees progress

- **A screen**, if one is plugged in: every step, as above.
- **A status page**, for a box with no screen: while it runs, the installer answers at
  `http://waitron-instalar.local` on the venue's network (published by Avahi, which Debian 13 has,
  P55) and, while its own Wi-Fi network is open, on that. It shows the step, the progress, «Ya
  puedes quitar el USB» and any reason it has stopped. It shows no setup code and offers no action
  but the Wi-Fi form, so a stranger on the network who finds it learns only that a box is being
  installed. **My call.**
- **The printed card**, for a person with neither: plug in, start, take the stick out after the time
  the card states (measured in slice 2, so that it falls safely after step 3's «Ya puedes quitar el
  USB»), and open `waitron.local` from a phone or computer on the same network after the time it
  states.

**After the restart**, the box's screen opens the setup wizard (§9); a box with no screen is set up
from any device on the network, which asks for the box's setup code (§12). The installer asks
nothing the wizard asks: not the name, not new-venue-or-spare (A947), not the fiscal mode.

## 6. The disk the installer writes

**My call**, built so A950 can snapshot the venue without the operating system and roll back one
without the other. Two words used below: a **LUKS2 container** is the standard Linux format for an
encrypted part of a disk; **btrfs** is a Linux filesystem that can take instant snapshots, and its
**subvolumes** are separately snapshotted folders inside it.

| Part | Holds | Why separate |
| --- | --- | --- |
| EFI system partition, 512 MiB, FAT, not encrypted | Debian's signed boot loader (§15), also at the fallback path (guard 1) | The firmware starts from it |
| Boot partition, 1 GiB, ext4, not encrypted | The kernel and the startup image that unlocks the disk (§7.2) | The loader reads them before the disk is unlocked |
| LUKS2 container, rest of the disk, marked as Waitron's by its partition type and name and its "subsystem" field (§5.1 guard 3) | One btrfs filesystem, in four top-level subvolumes: | Encrypted (§7) |
| `@rootfs` → `/` | Debian, Docker, the browser, the box's host service | Debian's own updates (§14) roll back separately from the venue |
| `@images` → Docker's image and container store | The Waitron images | A950 keeps the old image by its tag, not in the snapshot (`docs/backlog/box.md:76`) |
| `@volumes` → Docker's volumes folder | `waitron_state`, `waitron_backups`, `waitron_print_agent`, `waitron_mailpit` | What A950 snapshots and puts back |
| `@logs` → mounted at the `waitron_logs` volume's folder | `waitron.log` | A subvolume of its own, so a snapshot of `@volumes` does not contain it (P13) and a rollback of `@volumes` should leave it alone — the case `docs/backlog/box.md:78-79` asks for. What a rollback does to a subvolume mounted inside another's folder is untested: slice 1 tries it |

- **The kernel and startup image sit outside the encryption** because Debian's loader must read them
  before anything is unlocked; neither holds venue data. Whether Debian's signed loader can read
  them from inside the container instead, and whether that is worth its cost, is slice 1's to
  decide; the table above is the plain arrangement. **My call.**
- **Encryption does not change what A950 snapshots.** btrfs runs on the unlocked container exactly
  as it would on a bare partition, so A950's snapshot and rollback are btrfs operations on an open
  filesystem (my reading, not run); slice 1's rollback test runs on the encrypted disk.
- **Docker keeps its usual storage method on btrfs.** Docker's own advice is not to use its btrfs
  driver just because the disk is btrfs (P11). Where its image store lives depends on the Docker
  version: a fresh Docker 29 keeps images under `/var/lib/containerd`, not `/var/lib/docker` (P10),
  so `@images` covers whichever folders the chosen version uses. **My call: Docker from Docker's own
  packages, as `waitron.sh` installs today** (`deploy/waitron.sh:161-164`). Debian's own `docker.io`
  is older (26.1), and Debian's release notes warn that programs written in Go, as Docker is, get
  "limited security support" (P9).
- **SQLite on btrfs is to be measured, not assumed** (slice 1). btrfs never overwrites data in
  place ("copy on write"), and Debian's btrfs page warns against "COW on COW … databases that do
  their own COW" (P12); whether that applies to SQLite's write-ahead log (the side file where it
  writes changes first), whether `@volumes` needs copy-on-write turned off, and what turning it off
  does to A950's snapshot, are one measurement.
- **Few snapshots.** Debian's page says performance "crashes somewhere between 12 snapshots per
  subvolume and/or 100 subvolumes per volume" (P12). A950's design decides how many to keep.

## 7. Disk encryption (the owner's, §18 Q4)

**The whole venue lives on one encrypted container whose key the box's security chip (a TPM 2.0)
gives only to the box's own start-up.** A normal start unlocks with no password; the disk taken out,
or the box started from any other stick — this installer included — shows only scrambled data. A
**recovery key**, printed at setup on the venue's recovery sheet, opens it when the chip will not
(§7.5).

### 7.1 What the chip checks, and why the obvious setting is not enough

A TPM releases a sealed key only when its measurement registers (PCRs) hold the values they held
when it was sealed. Each register records part of the start-up: register 7 records whether Secure
Boot is on and **which certificates approved** each boot program; register 4 the programs' own
fingerprints; register 5 the partition table of the disk the box started from (P37); registers 8
and 9 what Debian's boot loader ran and read — its commands and the kernel command line, then the
kernel, the startup image and every other file (P33, P36). Debian 13's tools seal to **register 7 alone**
when told nothing else (P32).

**Register 7 alone does not keep out another stick.** A stick that starts Debian's same signed loader
and kernel — a Debian live stick, or this installer — is approved by the same certificates, and
register 7 records the certificates, not the programs (P34). No source says in one sentence that such
a stick then unseals the key; it follows from the sources (my inference), and **slice 1 runs the
experiment**: read the registers on the box's own start, on this installer and on a Debian live
stick, and try to unlock from the live stick. If register 7 differs between the three starts, the
inference is wrong — and the control is that register 4 or 5 must differ, or the probe is not telling
the starts apart. A second, published attack needs no other stick at all: a fake disk carrying a copy
of the real one's identity makes the box's own startup image unseal the key, fail to open the fake
disk, and fall back to a password prompt that the attacker's disk then answers, after which the
attacker's program asks the chip again (P35).

### 7.2 What the key is sealed to (requirements; the exact registers are slice 1's measurement)

**My call**, stated as what must be true rather than which registers, because the registers are
settled by the experiments below and not by reading:

1. **Secure Boot on, with the same certificates** (register 7).
2. **This box's own loader configuration, kernel and startup image** (registers 8 and 9, as Debian's
   loader measures them, P36) — which is what keeps out another stick.
3. **Only once per start, before anything else can ask** — the fix for the fake-disk attack (P35).
   systemd's own ways of doing this (boot-phase markers in register 11, and measuring the opened
   disk into register 15) run only when the kernel was started as a signed "unified kernel image",
   which this box cannot use (P56, P39). So **a small hook of Waitron's own in the startup image**,
   straight after its one attempt to unseal the key — whether that attempt worked or not — adds a
   fixed value to an otherwise unused register (register 15, which nothing else writes on this
   start, P56; with `tpm2_pcrextend`, from `tpm2-tools`, which Debian 13 ships, P32). The key is
   sealed to that register's value *before* the hook runs, so nothing that runs after it — a
   prompt, a fake disk, an attacker's program — can unseal the key again on that start. The value
   sealed to is computed, not read live, at first start (§7.3). Two consequences, both required:
   - **The chip unlock runs with its own password prompt switched off** (`headless`, P42), because
     systemd's unlock tries the chip and then asks for a password in one step; the recovery-key
     prompt (§7.5) is a separate step of Waitron's own, after the hook.
   - **Every way out of the unlock stage extends the register**, the failure paths included, and the
     startup image offers no emergency shell: dracut offers one by default (P59), so the box's kernel
     command line carries `rd.shell=0 rd.emergency=reboot` — which register 8 records, so it cannot be
     changed without breaking the seal (P36).
   Reasoning, for slice 1 to show, by experiments (c) and (i).
4. **Register 5 too, the partition table of the disk the box started from** (P37): an ordinary
   stick's partition table (a Debian live stick, this installer) differs from the box's, and nothing
   changes the box's own after install (§5.5), so it keeps ordinary sticks out in both the normal
   seal and the temporary one (§7.4). It does **not** keep out a stick made by someone who copied the
   box's partition table onto it — the table is not encrypted. Reasoning, for slice 1 to test.
5. **The recovery-key prompt is safe only because of item 3.** The box unlocks unattended or stops
   at a recovery-key prompt (§7.5); the prompt is the fallback the fake-disk attack uses, and item 3
   is what leaves it nothing to collect.

Two Debian facts shape the build, both sourced:

- **Debian 13's default startup image ignores the chip for the root disk** and asks for a password
  (an open Debian bug, P41). The image therefore uses **dracut**, which Debian 13 ships with the
  modules that unlock from the chip (P41). **My call** among the three routes P41 lists (dracut,
  Clevis, or a hook of our own); slice 1 confirms it on the box.
- **Neither of systemd's ways around fragile registers works here.** A signed register-11 policy
  needs a kernel image signed by a key the box trusts, which this box cannot have (P39, §15); and
  `systemd-pcrlock`, which predicts registers, is marked experimental in Debian 13 and says nothing
  about Debian's loader (P38).

**The acceptance experiments** (slices 1 and 6), each with the result that would fail it and, where a broken
probe would look like a pass, a control in the same run:

- **(a)** the box's own restart unlocks with nobody present — run on the second and later restarts,
  not only the first.
- **(b)** this installer and a Debian 13 live stick both fail to unlock (failing result: either
  unlocks). **Control:** for this run only, the box also carries a deliberately weak test seal
  (register 7 only), and the same command from the same live stick must **succeed** against it; a
  command that fails against both proves nothing.
- **(c)** the fake-disk attack of P35 fails against the real seal (failing result: the attacker's
  program reads the key). **Control:** the same attack, in the same run, succeeds against the weak
  test seal.
- **(d)** a kernel update followed by a restart unlocks (§7.4), with registers 8 and 9 recorded
  before and after and required to differ — an "update" that changed neither tests nothing.
- **(e)** a power cut between installing that update and the planned restart still unlocks.
- **(f)** a deliberately broken seal stops at the recovery-key prompt, the recovery key opens it,
  and the box seals itself again (§7.5).
- **(g)** a full run of Debian's automatic updates on the built image, then a restart, unlocks
  (§7.4), with registers 8 and 9 compared before and after.
- **(h)** a stick carrying a newer Debian Secure Boot loader than the box's, started in an installed
  box and then removed, and the reverse: register 7 and the box's next unattended start are
  recorded. A newer loader can record a stricter revocation level in the firmware (it measures its
  revocation data into register 7, P34), which could change register 7 on later starts or stop an
  older loader starting — an inference, which (h) tests.
- **(i)** a start with the encrypted container missing opens no console, and the chip refuses an
  unseal from it (§7.2 item 3).

**The weak test seal exists only during (b) and (c)** and is removed before every other experiment,
and every experiment that expects an unlock records **which seal opened the disk** and fails if it
was not the real one — otherwise (a), (d), (e) and (g) would pass with the real seal broken, and (f)
could never reach its prompt. It never ships. The CI virtual machine runs (a), (b), (d), (f), (g)
and (i) on every image change with a virtual TPM; (c), (e) and (h) run on the real box in slice 6.

### 7.3 How a box gets its key

The installer cannot seal the key to the box's own start-up — it is a different start-up. So
(**my call**, the arrangement P44 describes for "encrypted partitions during early first boot"):

1. The installer creates the container with a fresh random key and **one empty passphrase** as its
   only way in, and writes the ready-made disk into it.
2. On the box's **first start**, before anything else runs, the box opens the container with the
   empty passphrase, seals a key into its own chip against its own start-up (§7.2), creates the
   **recovery key** (§7.5), and **restarts once** to prove the seal opens with nobody present
   (experiment (a), on every box). Only when that restart has unlocked **through the chip** — which
   it records — does it remove the empty passphrase. A seal that fails therefore falls back to the
   empty passphrase, the box starts, and the failure page below says so; nothing waits at a prompt.
   **First start changes no file the boot loader reads** — those files are what the seal records
   (P36), and a change made after reading them would be sealed to the old ones — so the fresh machine
   identity and anything else first start writes stay out of the startup image; slice 1 checks it by
   comparing the boot partition before and after first start. **My call.**
3. **Waitron does not start while an empty passphrase remains.** The first-start service refuses.
   This is the step that makes "no venue data on a disk anyone can open" true, so it is a check, not
   an order of steps. A box in that state holds no venue, and is simply reinstalled. **Where a
   person sees it:** the box's screen, and — for a box with no screen —
   a fixed page the box's host service (§8) answers at `waitron.local` in that state, naming what
   failed and showing no secret. **My call.**

The window between the install and the first start is the few minutes the person spends taking out
the stick; the disk then holds Debian and Waitron's images but no venue. Someone who copied the
container's header in that window and stole the disk later could open it, because the container's
underlying key does not change when a passphrase is removed. Re-encrypting the whole disk on its
first start would close that, at the cost of rewriting every block; **my call: not done**, because
the disk never leaves the box between the two steps. Slice 1 measures what the re-encryption would
cost, so the call can be revisited with a number.

### 7.4 Updates that change the start-up

A new kernel, startup image or boot loader changes registers 8 and 9 (P36), and a change to the
firmware's certificate lists changes register 7 (P43) — including Microsoft's 2026 certificate
change, which Debian's newer loaders follow (P43). After any of these, the old seal no longer
matches, and a box restarted without care stops at the recovery-key prompt: anti-goal 3.

**So (my call):** anything that changes the start-up is held back from Debian's daily automatic
updates and installed only in A950's quiet hour. The held set is defined **by effect, not by a list
of names**: any package whose installation rewrites a file the boot loader reads — the kernel, the
startup image, the loader's configuration, the loader itself and Debian's signed Secure Boot
loader, and anything that triggers a rebuild of the startup image — or that changes the firmware's
certificate lists. The image build works the set out by installing each pending update in a copy
and seeing which files change; experiment (g) checks it. Each held update runs as one step:

1. add a **temporary seal** that does not depend on the registers about to change;
2. install the update;
3. restart at once;
4. on the new start, seal against the new values and remove the temporary seal.

A power cut between steps 2 and 3 is covered by the temporary seal. What the temporary seal binds to
is the weakest point of the design — for the few minutes it exists, it is looser than the normal
seal. For a kernel or startup-image update, the first candidate is registers 5 and 7 and the
hook's register (§7.2 items 1, 3 and 4): another stick is still kept out by register 5, but someone
who swapped the unencrypted startup image in those minutes would not be. A better candidate, for
slice 1 to try, avoids the looser seal altogether: the box knows the new kernel's and startup
image's fingerprints before it restarts, so it can work out the new values of registers 8 and 9 by
replaying the current start's measurement log with the changed files, and seal to those in advance.
**For a change to register 7 itself** (a new Secure Boot loader signed only by Microsoft's newer
certificate, P43), neither candidate holds, and this design does not settle it: slice 1 records
what such a change does, and until it is settled such an update is taken only with a person and the
recovery key present. The box runs no firmware updater (`fwupd`), so the certificate lists change
otherwise only by a person's hand or a firmware update — and then the recovery key opens the box
(§7.5).

### 7.5 The recovery key

Picture 9. A recovery key is 256 random bits shown as 64 letters in eight groups of eight, from a 16-letter set
chosen to be easy to type, and it is accepted wherever a password is (P40). The box creates it on its
first start (§7.3).

- **Where it goes: on the recovery sheet**, as the owner asked. The setup wizard already prints that
  sheet itself: "Download, print, or both from the recovery-document step … confirm that you kept
  the sheet before continuing" (`docs/operations/first-live-fiscal-setup.md:32-34`), and the box's
  first start, which makes the disk key, comes before setup. So the box hands the key, once, to
  Waitron, the sheet gains a section «Clave de recuperación del disco» with the key as text and a QR
  code, and the box's host service deletes its own copy when the wizard's existing "kept"
  confirmation is given. **Restore and spare probably end without a new sheet** — a restore uses the
  sheet it already has ("find the recovery sheet whose key name matches that copy",
  `docs/operations/hour-recovery.md:3-4`) — so on those paths the wizard prints the disk key as a page
  of its own (the plan confirms which paths). **A later sheet does not carry the disk key** (the box
  no longer has it), so the section says «Guarda esta hoja aunque otra la sustituya». It is never stored in the venue database: the
  database streams to the owner's bucket once one is set up, and CLAUDE.md §3 keeps anything that
  works as a key out of it ("Anything that works as a live login is stored as a hash"). Until it is
  printed, the host service keeps it readable only by itself. **My call** on the handover.
- **When it is used:** the box stops at a prompt on its screen, «Introduce la clave de
  recuperación del disco», when the chip refuses (systemd asks for a password when the chip will not
  answer, P42) — after a firmware or certificate change, a
  motherboard replaced, or a seal that went wrong. The person plugs in a screen and keyboard and
  types it, dashes included (P40); the box starts and raises an alert saying it was opened with the
  recovery key. **It seals itself to its chip again only if** the kernel, the startup image and the
  loader's configuration match fingerprints the box recorded inside the encrypted disk when it last
  built them itself; otherwise it does not reseal and raises a different alert, «Han cambiado los
  archivos de arranque». That stops the box itself trusting changed start-up files — after an
  accident, or after someone swapped them and left. It does **not** stop a swapped startup image that
  has been typed the recovery key: the startup image sits unencrypted and unsigned (§6; "No code
  signing protects initrd", P58), and once it holds the key it holds the disk. The real defence is a
  person thinking before typing it, so the prompt says first when the start-up files differ from the
  box's last record (reasoning; the prompt can only check what it can read before the disk opens).
  **My call.**
- **A dead box:** the venue's data comes back from its backups onto a new box installed from the
  stick, which starts a new fiscal chain — the owner's chosen posture (§0). The recovery key adds
  one thing backups may not have: moved into a working box of the same model, the old disk opens
  with it, so records it had not yet sent to AEAT can be read. Whether such a moved disk can then
  trade as the same installation is not designed here.
- **The sheet lost and the chip refusing:** the disk cannot be opened by anyone. The venue restores
  its backups onto a reinstalled box, exactly as for a dead box.

### 7.6 The name tag a stick can read

The reinstall screen (§5.1, guard 3) names the venue without opening the container, from a **name
tag**: the venue's name and whether it is Live, written by the box when either changes into a
record of Waitron's own kind in the container's header — readable and writable without the key, like
the rest of the header (P45). **Not** the header's label field, which holds only 48 bytes (P57) —
an accented name uses two bytes per accented letter — and **never** the fields that mark the disk
as Waitron's (§5.1 guard 3), so a name tag that fails to write cannot make a stick miss its own box.
**My call.** Anyone with the disk can read or forge it, so it only names what the warning shows; it
decides nothing, and erasing still needs a person at a keyboard. The venue's name is printed on
every receipt anyway.

### 7.7 A box with no security chip, or with Secure Boot off

**The installer refuses**, before it erases anything (§5 step 2), and says why on the screen and the
status page:

- **No security chip switched on:** «Este equipo no tiene chip de seguridad (TPM) activado. Actívalo
  en la configuración del equipo (Intel PTT o AMD fTPM) y vuelve a empezar.» Many retail boards ship
  with the chip switched off although it is there, under those names (P46).
- **Secure Boot switched off, or in its setup mode:** «Activa el arranque seguro (Secure Boot) en la
  configuración del equipo y vuelve a empezar.» With Secure Boot off, register 7 records "off" and
  any program can start — including one written to reproduce the box's own measurements and so
  satisfy the seal (reasoning, not tested). The research's source says: "Make sure Secure Boot is active and in user
  mode when binding to PCR 7, otherwise, unauthorized boot devices could unlock the encrypted
  volume" (P35's source).

**My call**: the owner decided the box is encrypted before go-live, and a box that installs with an
encryption that keeps nobody out, without anyone noticing, undoes that. The box model Waitron sells
is checked in slice 6 and set before it ships; the card says how for anyone else. CI boots the
installer once with Secure Boot off and once with no virtual TPM, and expects both refusals.

## 8. The box's operating system

What the ready-made disk holds, beyond Debian 13's base — each one named, because an image tool
installs the packages its recipe names, and a minimal recipe leaves out packages Debian's own
installer would add, such as the clock service (P23; inference, not built):

- **Docker** (§6) and the release's two Waitron images and mailpit, tagged `:<version>` (A940
  §5.5), loaded into Docker's store during the build; nothing is downloaded on first start. The
  box's `compose.yml` names those tags, never `:main`.
- **dracut and the tools that unlock the disk from the chip** (§7.2).
- **A first-start service**, which runs before Waitron on the first start only. It makes a fresh
  machine identity (`/etc/machine-id`, as systemd asks of a generic image, P30 — two boxes from one
  stick on one switch, A947, must not share one), kept out of the startup image; seals the disk
  key, restarts once to prove the seal, and only then removes the empty passphrase (§7.3). Then it
  grows the filesystem inside the container (the installer already made the container fill the
  disk, §5.5, so the partition table, which register 5 records, does not change), and
  checks that AppArmor (the Linux security module that confines the print agent) has loaded the
  print agent's profile
  before naming it in `.env` — CLAUDE.md §3's rule ("named through `WAITRON_PRINT_AGENT_APPARMOR`
  only after `waitron.sh` has loaded it"), whose cost was a print agent that silently listed no
  Bluetooth printers. Then it runs `docker compose up -d` (`deploy/waitron.sh:629`) — nothing
  starts Waitron otherwise, as a restart policy takes effect only after a container has started
  once (P29) — and waits as `wait_healthy` does (`:574-586`). After that, Docker's restart policy
  brings Waitron back after a power cut, as today.
- **The box's host service** (`waitron-box`), **my call**: one small service on the host, outside
  Docker, that does for Waitron what a container cannot — the box's settings (§10), the maintenance
  login (§11), the recovery key's handover (§7.5), the name tag (§7.6), handing Waitron the setup
  code the installer left on the disk (§12), the box's screen (§9), the first-start failure page
  (§7.3), and the release check (§14), which is
  also the "small updater with access to Docker" A950 needs (`docs/backlog/box.md:93-96`). Waitron
  reaches it through a socket in a mounted folder; it accepts a fixed list of requests and nothing
  else, and a request that changes the box carries the person and permission the server checked, so
  the box's log names who did it. One service rather than several, so there is one place that holds
  the host's powers. The app container mounts nothing like it today (`deploy/compose.yml:42-45`).
- **The box files `waitron.sh install` writes today** — `compose.yml`, `.env`, the print agent's
  AppArmor profile and the Bluetooth drop-in (`deploy/waitron.sh:184-319`). Two of those steps read
  the live host and cannot run during an image build: the AppArmor step loads the profile into the
  running kernel (`:218-225`), and the Bluetooth step reads the host's own Bluetooth service
  (`:250-255`). So the image installs the profile file and AppArmor loads it at boot (checked by the
  first-start service, above); the Bluetooth drop-in is written at build time from the image's own
  `bluetooth.service`. Keeping the two install paths equal is a test, not a promise: slice 1
  compares a stick-installed box's files with a hand-installed one's.
- **`apparmor`, `bluez` and `dbus`** — the print agent's container binds the host's D-Bus socket and
  fails to start without it (`deploy/compose.yml:149-153`).
- **Firmware for common network cards** (wired and Wi-Fi), with its notices (P25).
- **`systemd-timesyncd`, switched on**, and the battery-backed clock kept in step with it: the
  standing half of A798's clock rule (`docs/backlog/box.md:366-373`). A PC has a battery-backed
  clock (P24); the box model's must be checked (slice 6).
- **`unattended-upgrades`**, which by default takes Debian's security fixes and point releases and
  never reboots on its own (P15) — **with the packages that change the start-up held back** for
  A950's quiet hour (§7.4). Its default list takes only Debian's own sources (P15). **My call:** add
  Docker's package source, held to the image's Docker version line and installed only in the quiet
  hour, with Docker's `live-restore` setting on. Docker documents `live-restore` as keeping
  containers running across "patch releases (YY.MM.x), not for major (YY.MM) daemon upgrades"
  (P31), so a newer Docker line arrives only with a Waitron release.
- **NetworkManager**, for the box's wired and Wi-Fi connections (§10).
- **Avahi**, the service that answers a `.local` name on the network, which already answers
  `waitron.local` for a hand-installed box.
- **WireGuard's tools**, so the link Cloud sets up later (`docs/backlog/box.md:365`) needs nothing
  installed.
- **`cage` and Chromium**, the full-screen browser (§9), the owner's choice (§18 Q2). **No desktop**
  (§18 Q2): nothing else draws on the screen.
- **No SSH server and no login but the maintenance one** (§11).
- **The licence notices**: every Debian package's `/usr/share/doc/<package>/copyright` stays in
  the image, even if documentation is trimmed (Debian policy requires that file, P20).

**Debian 13 is supported until 2028-08-09, and by a separate long-term team until 2030-06-30**
(P1, P2). Chromium on Debian 13 gets only six months of fixes once Debian 14 is out (P14). So the
box must move to Debian 14 within months of its release; how is §17's first entry.

## 9. The box's screen (the owner's, §18 Q2 and Q3)

Every box carries the full-screen browser and shows it whenever a screen is plugged in. Chromium
runs under `cage`, which shows one application full-screen and lets the person do nothing outside
it (P50). Picture 5 and picture 7.

**What the screen shows:**

1. **Before setup:** the setup wizard, already holding the box's setup code, so the person at the
   box's own screen types nothing extra (§12).
2. **After setup: the dashboard** (`/manage`), at its sign-in page. A spare box's screen (A947)
   follows the same setting, and also shows A947's switch page while the main box is silent
   (A947 §6.6, `docs/superpowers/specs/2026-10-21-a947-two-box-failover-design.md:810-811`).
3. **Once the box is told to: the till.** Each box has a setting, **«Pantalla de este equipo:
   Panel / Caja»** (Settings → This box, §10), and from then on its screen starts on the till.

**«Usar esta pantalla como caja».** On the box's own screen, the dashboard shows a card offering to
make this screen a till. A manager signed in there presses it, picks the device's name and profile,
and accepts — **the usual acceptance, done in one place**. Today a till asks to join while a
manager holds the dashboard's «Añadir un dispositivo» window open (`apps/server/src/device-api.ts:216-219`),
then the manager taps the matching number of three and accepts
(`apps/server/src/join-api.ts:237`, `:270-316`, `:318-353`), all under the `device.manage`
permission. Here both sides are the same page: it opens the join window, asks to join from this
same browser, answers the number check itself (it knows the number), and leaves the manager only
the name, the profile and «Aceptar». Nothing checks today that a browser cannot accept its own join
(`rg "DeviceCookie|DEVICE_COOKIE|same browser|this browser"` over `join-api.ts`,
`join-requests.ts` and `devices-screen.ts` found nothing) — this makes that a deliberate path, still behind `device.manage`. When it is
done, the dashboard asks whether this screen should now start on the till. **My call** on the
shape; the owner asked for "one action, the usual manager acceptance". How the dashboard knows it is
on the box's own screen: the box's screen service opens it with a marker the page keeps for its
session; anyone could fake the marker, and all it does is show this card, which still needs a
manager.

**The till's menu gains «Panel».** The till's menu (`apps/till/src/widgets/till-shell.ts:873-913`)
has no way to the dashboard today, and the dashboard none back to the till
(`apps/dashboard/src/dashboard-app.ts:1806-1843`). So:

- **«Panel» in the till's menu**, on every till, **signs the till's person out** and opens the
  dashboard in the same window. The dashboard asks for its usual sign-in (email and password or
  passkey, CLAUDE.md §3's login rules), because a till's PIN session and a dashboard session are
  separate today — separate cookies and separate session tables
  (`packages/server-kit/src/management-cookie.ts:8`, `apps/server/src/till-session.ts:22`). Signing
  the till out first matters: a manager who opens the dashboard from a waiter's session must not
  come back to the till as that waiter. **My call.**
- **«Volver a la caja» in the dashboard**, shown in any browser that is an accepted till (it holds
  the device cookie, `apps/server/src/device-session.ts:15`), **signs the dashboard out** and opens
  the till at its PIN screen. **My call**: the dashboard session is the manager's, and the next
  person at the counter should meet the PIN screen, not a manager's dashboard.
- **A forgotten dashboard on a till screen** signs itself out after the till profile's idle time
  (300 seconds on the Counter profile, `packages/layouts/src/device-profile.ts:135-152`) rather than
  the dashboard's usual 30 minutes (`packages/identity/src/management-session.ts:12-13`), and
  returns to the till's PIN screen. **My call.**

**One window, no tabs.** Chromium's `--kiosk` keeps the window full-screen and refuses to leave it,
so no tab strip, address bar or close button shows, and it skips the "Restore pages?" bubble after a
power cut (P49). In Chromium's source the lock on keyboard shortcuts such as a new tab or window
belongs to a different switch (P49), so **we expect** a page that opens a new window, or a person
with a keyboard pressing Ctrl+N, to get one, and `cage` to show it maximised and alone (P50) — no
source says so outright; slice 3 checks it. Waitron's pages on the box
are meant to open nothing in a new window (the till's guide already opens inside the page,
`apps/till/src/widgets/guide-sheet.ts:105`); slice 3 checks every link
on the box's screen and what Ctrl+N, Ctrl+T and Ctrl+W do. The box also passes
`--hide-crash-restore-bubble`, which works outside ChromeOS despite its description (P49).

**If Chromium exits or crashes**, `cage` exits with it (P50), and the box's screen service, set to
restart always with a pause of a few seconds and no limit on restarts (P53), starts it again on the
screen's configured start page — the setup wizard, the dashboard or the till. Closing the only
window with Ctrl+W does the same.

The hardware notes' other traps (`docs/superpowers/specs/2026-09-18-handheld-and-till-hardware-decisions.md:188-198`)
stay slice 3's: Chromium's own certificate store must trust the box's certificate authority, which
the server makes at its first setup start (`apps/server/src/boot.ts:1012-1017`), after the image is
built; and screen blanking.

## 10. The box's settings, as Waitron screens (the owner's, §18 Q2 follow-up)

No desktop means no system settings window, so what a venue needs from the box becomes a page in
the dashboard — **Settings → Este equipo** — reached the same from the box's own screen and from any
other device. Picture 8. Each change goes through the box's host service (§8), under the permission
named beside it (the box's own settings sit under `system.manage` today, which managers hold,
`packages/identity/src/permissions.ts:56-74`):

| Setting | What it does | Permission |
| --- | --- | --- |
| **Red** | Shows the wired connection and its address; lists Wi-Fi networks, joins one, forgets one | `system.manage` |
| **Hora** | Shows the box's time, whether it is synchronised and from where. **No hand setting** (below) | — (read only) |
| **Pantalla de este equipo** | Panel or Caja (§9) | `system.manage` |
| **Nombre en la red** | A917's "Change network name…", which A917 places on the Servers screen (`docs/superpowers/specs/2026-10-20-a917-box-local-name-design.md:550-554`); this page links to it | A917's |
| **Reiniciar / Apagar** | Restarts or shuts down the box, after a confirmation that names what stops (sales, the tills) | `system.manage` |
| **Acceso de mantenimiento** | §11 | admin only |

**No hand-set clock.** The owner's answer recorded "also the clock" as a setting
(§18 Q2 follow-up, as the watcher wrote it down). A798, whose design the owner approved, decided the
opposite: "**No 'set the clock' action anywhere in Waitron**: a clock a page can set is a way to date
sales at will" (`docs/superpowers/specs/2026-10-19-a798-degraded-trading-design.md:1148-1150`).
**My call: A798's decision stands**, and the page shows the clock without setting it. Every install
now sets the clock from network time (§5.4), and the battery clock keeps it through a power cut, so
the case A798 left to "whoever installed the box … from the operating system"
(`:725-727`) no longer needs a terminal. If the owner wants a hand-set clock after all, it is A798's
decision to reopen, not this page's; the approval question names it (§18).

**No hotspot after setup.** The owner's hotspot answer was about the install — "At that stage we're
not protecting anything" (§18 Q5) — and the installer's hotspot (§5.3) never leads to the setup
wizard: it is the installer's own page, and Waitron is not yet on the disk. Once a box holds a
venue, an open network that anyone in the street can join, whose page moves the box onto another
Wi-Fi, would let a passer-by cut the tills off from the box (CLAUDE.md §5: "a till needs the
venue's PRIMARY"). So **a set-up box opens no network of its own**; its Wi-Fi changes through
**Red** above, from the box's screen or any device still on its network, or after plugging in a
cable. **My call**; §17 lists the case it leaves (a wireless-only box with no screen whose router
changes).

## 11. Maintenance access (the owner's, §18 Q4, redesigned around the encryption)

The first version had the stick hand out a maintenance password. With the disk encrypted, a stick
cannot even open the disk (§7.1), so **the one-time password now comes from the box's own running
system**, as the owner asked.

- **Opening it:** a person holding the admin role opens Settings → Este equipo → «Acceso de
  mantenimiento» and proves who they are again, as A947's switch asks: their passkey, or their
  password — plus the code from their authenticator app if they have one enrolled. The box's host service then sets a fresh password for a
  `maintenance` account and Waitron shows it once: six words, valid until the box restarts or for
  four hours, whichever comes first. **My call** on the role: the account can do anything on the
  box, so it is admin-only, like the machine permissions today (`mirror.create`,
  `packages/identity/src/permissions.ts:33-35`). The permission's name is the plan's; the owner
  prefers machine permissions named `node.*` (`docs/backlog/dashboard.md:386-389`).
- **Using it:** only at the box's own console, with a keyboard and screen. `cage` is started with
  text-console switching allowed (its `-s` option, "Allow VT switching", P50), so Ctrl+Alt+F2 shows
  a plain text login prompt;
  the password works there and nowhere else — no SSH (§8). While the window is open, the dashboard
  shows «Acceso de mantenimiento abierto hasta las 14:30» with «Cerrar», which ends it and the
  sessions it opened.
- **Recorded:** who opened it, when, and when it closed, in the venue's audit trail and the box's
  log.
- **Remote support** stays the 2026-09-11 record's later design
  (`docs/superpowers/specs/2026-09-11-box-maintenance-and-remote-support.md:85-102`).
- **A box whose Waitron will not start** cannot hand out the password, and so has no maintenance
  login: it is reinstalled from the stick and its backups restored — the owner's A732 answer (§0).
  **A box with no screen** needs one plugged in, like the recovery key (§7.5).

The record recommended a password per box on a sealed card
(`docs/superpowers/specs/2026-09-11-box-maintenance-and-remote-support.md:39-41`) and warned that an
unauthenticated recovery page "must not itself grant administrative access" (`:92-96`). This design
keeps that: the password is handed out only to an authenticated admin, and the LAN recovery page
(`apps/server/src/recovery-surface.ts:28`) offers nothing of it.

## 12. Nobody sets up a box before its owner does (W60)

Picture 10. Two loose ends the watcher folded in, from the backlog's A680 entry (`docs/backlog.md:714-722`):

**(a) A production box offers Demo and Prepare, then fails generically.** "A box started with
`WAITRON_ENV=production` still offers Demo and Preparation (`apps/setup/src/screens/mode-screen.ts`
shows only a production warning), and either one is refused with that code, so the operator sees
the wizard's generic failure" (`docs/backlog.md:715-718`; the refusal is
`packages/fiscal-verifactu/src/hour-throwaway-allocation.ts:26-30`).

- **On a box started in production, the mode screen offers only «En vivo» and «Ya tengo un
  restaurante»** (restore a backup, or become a spare box, A947); Demo and Prepare are not drawn at
  all. The refusal code `sif.throwaway_allocation_refused` gets its own words in the wizard, for a
  request that reaches it anyway. This is the backlog's fix, for a box installed by hand.
- **A box installed from the stick offers the same two** (**my call, and §18's new question**): the
  stick is for venues, and CLAUDE.md §5 says a pre-production database is never promoted. It does
  **not** start in production: like every blank box it starts unprovisioned and pre-production,
  and reaches production the way any box does today — "production is only ever reached by an owner
  choosing it in the wizard" (`.github/workflows/image-smoke.yml:191-192`). The stick-installed
  image tells the wizard only which choices to draw (a marker the plan places; the server reads its
  environment from its own process and `trading.env` in the state folder,
  `apps/server/src/box-env.ts:7`, never from compose's `.env`, which passes no `WAITRON_ENV` to the
  app, `deploy/compose.yml:21-45`). The VM test of §13 asserts a stick box's wizard draws neither
  Demo nor Prepare.
- **Practising first** is done on another machine: Demo or Prepare on any computer installed by
  hand with `waitron.sh`, then the venue's menus and layouts come across at Live setup through the
  existing Prepare-to-Live configuration copy (`packages/catalogue/src/configuration-transfer.ts`,
  named at `docs/backlog.md:1034`).

**(b) A stranger can set up an unconfigured box first.** "Demo and Preparation can be set up by
anyone who reaches the setup wizard first … on a shared network a stranger can set up an
unconfigured box in either mode before its owner does" (`docs/backlog.md:719-722`). Live is a
first-come claim today (`packages/provisioning/src/first-setup-state.ts:507-515`), and the setup
routes are unauthenticated by design (`apps/server/src/setup-api.ts:613`).

- **Every box gets a setup code**: ten digits, **made by the installer** at the start of the install
  (§5 step 3), written onto the stick and onto the new disk, where the box's host service hands it
  to Waitron on the first start; the server keeps it only as a hash. **Every request that changes
  anything while the box is not yet set up needs the code** — every `POST /setup-api/…` route
  (among them provision, adopt, the restores, the fiscal test and resetting an incomplete adoption,
  `apps/server/src/setup-api.ts:745`, `:776`, `:951`, `:1040`, `:1103`), the first-setup claim, and
  A917's naming form, which is the setup's first page (§17); so the code is asked on that first
  page. Wrong codes are counted and
  slowed like a PIN. The code stops working once setup is complete. A stick put back into a box
  that already holds Waitron writes no line (§5 step 2); an install that fails after step 3 leaves a
  line for a code that never reached a disk, and the next install writes a newer one — the newest
  line for a box's serial number is the one that counts. Slice 2 tests a stick put back into a box
  installed but not yet set up: the stick's newest line must still open the wizard. Whether the
  read-only previews (`/setup-api/restore/preview`, `:1223`, and the like) ask for the code too is
  the plan's to decide. How the dev stack (`wa-wt demo`) and the setup routes' tests supply or skip the code is the
  plan's.
- **Where the person finds it:**
  - **on the box's own screen**: the wizard there already holds it (§9), so the person at the box
    types nothing;
  - **on the stick**: the installer writes it into `WAITRON/codigos-de-configuracion.txt` with the
    date, time and the box's serial number, before it says the stick can come out (§5 step 3) — so a box
    with no screen is set up by reading the stick on any computer. A stick that installs two boxes
    (A947) holds both codes, each named by its box;
  - **for a box installed by hand**, `waitron.sh` prints it in its closing banner and on the
    box's console, beside the links it prints today (`deploy/waitron.sh:374-391`).
- **Never** on the installer's status page, its hotspot page or the LAN recovery page, all of which
  a stranger can open.
- **My call** on all of the above. The cost: a person setting up a screenless box from a phone needs
  a computer (or a phone adapter) to read the stick. The alternative weighed and rejected: a press of
  the box's power button as proof of presence, which a stranger's waiting request would collect as
  easily as the owner's.

## 13. Built and published for every release

**A release is a `v<major>.<minor>.<patch>` tag** (A940 §5.1, designed, not built). On each one, a
new CI job:

1. Builds the ready-made disk with `mkosi` from the release's images (the ones CI just published for
   that tag, `.github/workflows/ci.yml:2772`).
2. **Boots the installer in a virtual machine with Secure Boot on and a virtual TPM, installs the
   new disk onto a blank virtual disk, takes the virtual stick out, and lets it restart**; then
   waits for `/setup-api/status` to answer 200 — the same check the image smoke test makes today
   (`.github/workflows/image-smoke.yml:180-206`) — and runs §7.2's experiments (a), (b), (d), (f),
   (g) and (i). It saves a screenshot of the box's screen and fails if the setup wizard is not on it: a box
   that boots to a blank screen passes every other check (CLAUDE.md §2, "a bundle that renders
   nothing passes anyway"). It also restarts once with the virtual stick left in and checks that
   the box comes back trading (guard 3); boots the installer once with Secure Boot off and once with
   no virtual TPM, and expects both refusals with the disk untouched (§7.7); and checks that a stick
   box's wizard draws neither Demo nor Prepare (§12).
3. Attaches to the GitHub Release: the ready-made disk, its SHA-256, the signed release list (§14),
   the list of every Debian package and version in the disk, and the declaración responsable
   (A940 §7.1). **A GitHub Release file must be under 2 GiB** (P26); slice 1 measures the
   compressed disk against that, and §17 says what happens if it is over.
4. **Publishes the source of every Debian package in the disk and the installer**, kept by Waitron
   rather than pointed at Debian's mirrors (P22). For a box sent by post, GPL version 2 asks for
   the source in the parcel or a written offer good for three years to "any third party" (P19), and
   the GPL FAQ says a recipient may ask for it on physical media by post (P21). The libvips notice's
   offer for "a box Waitron supplied" (`deploy/third-party/README.md:59-62`) follows GPL version 3's
   shape, so the operating system's GPL-2 packages (the kernel among them) need their own wording.
   Both go to the lawyer question already open (`docs/compliance/action-plan.md:29-35`), which must
   now name the operating system explicitly.
5. **Names it "Waitron", never "Debian".** Debian's trademark rules forbid the name in a product's
   name and allow describing it as based on Debian (P22).

**The installer stick** is built by the same job when its own inputs change, booted the same way,
and published as its own file with its checksum and signature; a release's list names the oldest
installer it accepts (§5.4).

The licence notices for what the operating system adds (Debian's packages, Chromium, `cage`,
Wi-Fi firmware, P25) answer the open point at `docs/backlog/box.md:31-33`. The existing guards
read the Dockerfile and workflows as text (`scripts/deploy-image-env.test.ts`, its third-party
blocks) and image-smoke looks inside the container image; nothing looks at an operating-system
image, so slice 5 adds a check that the disk's package list and its notices match.

**A note for A940.** Its draft names the third-party parts as "Node.js, SQLite, Litestream, Linux
and Docker, as Q53 lists them", with the full list in `/app/third-party/`
(`docs/superpowers/specs/2026-10-21-a940-declaracion-responsable-design.md:446-448`). Once the stick
installs the operating system, Debian 13 is part of what Waitron supplies, and its notices live
under `/usr/share/doc` on the box rather than in `/app/third-party/`. A940's list and pointer change
with it.

## 14. Updates after install

A950 designs how a box upgrades; this design says only where it learns a release exists.

- **The box's host service checks once a day for a new release** (§8): the signed release list
  attached to the latest GitHub Release, checked against Waitron's public keys built into the image
  (P17) — the same list the installer reads (§5.4). It runs on the host, outside the app container
  it replaces (`docs/backlog/box.md:93-96`). Watchtower, the usual tool, is archived and its authors
  advise against commercial use (P16).
- **Every stick-installed box gets the same updates, whoever sold it.** **My call**; a venue that
  wants to stay put is A950's question.
- **Two public keys in every image and on every stick** (**my call**): the one that signs today and a
  spare kept offline, so a lost or leaked key is replaced by a list signed with the other, without
  reinstalling every box or rewriting every stick. Who holds them is the owner's, at slice 7.
- **Packages that change the start-up wait for A950's quiet hour** (§7.4).
- **A box installed by hand with `waitron.sh` has no such service** and upgrades as today.
- **Debian's own security fixes** arrive through `unattended-upgrades` (§8) whatever Waitron
  releases.

## 15. Secure Boot

**The box keeps Secure Boot on.** Debian boots with it on through a small loader signed by
Microsoft (P18). A custom image keeps that only if it uses Debian's signed loader, GRUB and kernel
unchanged, or else with our own key enrolled at the box's console (P18), which this operator
cannot do. So the image compiles none of them and adds no kernel modules of its own (`mkosi`
can install only already-signed boot files, P7). The same constraint closes systemd's signed-policy
route for the disk key (§7.2). Two things to test on the real box (slice 6):

- some machines ship with the Microsoft certificate the loader needs switched off, and fail to boot
  with "security violation" until it is switched on in the firmware menu (P18);
- Microsoft's UEFI CA 2011, which signs third-party loaders like Debian's, expired on 27 June 2026;
  Debian 13's current loader is signed with both it and its 2023 successor (P18, P43). Which of the
  two a given firmware records in register 7 is not found in any source (P43), so slice 1 records
  it. The day Debian ships a loader signed only with the new one changes register 7, which §7.4
  does not settle: until it is, that update waits for a person with the recovery key (§7.4).

## 16. What the box needs

Not a choice of model (non-goal), but what the image assumes — **my call** where the repo says
nothing:

- **x86-64, UEFI**, as every published image is `linux/amd64`.
- **A TPM 2.0, switched on** (§7.7) — on Intel boxes usually the firmware's own, called PTT (P46).
- **8 GB of memory at least, 16 GB recommended** — the box runs the server, the database and a
  browser, and the installer holds the downloaded disk in memory (§5.4); the hardware notes say 8 GB
  is the floor these machines are sold at and that the box "wants the headroom"
  (`docs/superpowers/specs/2026-09-18-handheld-and-till-hardware-decisions.md:234-239`).
- **A 128 GB disk at least** (the till machines' 128–256 GB, `:230-233`; to be checked against
  measured photo and backup growth). **One internal disk** (§5.2).
- **Gigabit Ethernet.** A947 puts both boxes on the same switch.
- **A working battery-backed clock** (A798).
- **Firmware set to switch on when mains power returns** (`hardware decisions`, `:196-197`) — a
  setting in the firmware's own menu, which this design does not try to set from the image. For a
  box Waitron sells, set before it ships, with the TPM switched on and Secure Boot on; the card says
  how for anyone else.
- **Designed and tested for the model Waitron sells.** No model is chosen yet (the hardware notes
  describe a class: "an Intel N100/N150-class chip, 128–256 GB SSD", `:230-233`). The installer finds
  NVMe, SATA and eMMC disks and the image carries Debian's firmware for common network cards, so
  other x86 mini PCs may work; only the chosen model is tested.

## 17. What this design leaves open, as backlog entries

1. **Moving a box from Debian 13 to Debian 14** without reinstalling — before Chromium's six
   months run out (P14). It changes the start-up, so it takes §7.4's step.
2. **A ready-made disk over 2 GiB** (§13): split the file or host it elsewhere, decided once slice 1
   measures it.
3. **Resetting a box without a terminal** (`docs/backlog/box.md:149-163`) is answered for the whole
   box by a reinstall from the stick. A reset that keeps the certificate has no path on a stick box;
   that entry stays open, still refused on a Live box as it asks.
4. **First Live setup's clock check** compares the box's clock with the browser's
   (`docs/operations/first-live-fiscal-setup.md:14-17`), which proves nothing when the browser is the
   box's own screen — handed to A798.
5. **A reinstall that keeps the venue's data** (rewrite the system, keep `@volumes`). Not proposed:
   the owner's A732 answer chose "reinstall the box and start again".
6. **A disk moved into a new box** (§7.5): whether it may trade as the same installation, or only be
   read for its unsent records.
7. **For A940:** the declaración responsable is downloaded with the release and shown on the box,
   not copied onto the stick (§4); and its third-party list names Debian 13, with notices under
   `/usr/share/doc` (§13).
8. **For A947:** the spare's screen follows §9's start-screen setting, and shows the switch page while
   the main box is silent, as A947 asks ("it shows the switch page",
   `docs/superpowers/specs/2026-10-21-a947-two-box-failover-design.md:810-811`); A947 also has the
   spare show a banner "on its own status page and on any screen attached to it" (`:373`).
9. **For A917:** its naming form is "an unauthenticated plain-HTTP write, acceptable for the same
   reason setup itself is: an unclaimed server can be set up by anyone on its network"
   (`docs/superpowers/specs/2026-10-20-a917-box-local-name-design.md:596-598`); §12's setup code
   changes that reason, and the form asks for the code.
10. **A wireless-only box whose router changes, with no screen and no cable to hand.** §10 offers no
    hotspot after setup; such a box needs a cable or a screen for a moment. An after-setup hotspot
    that asks for a manager's sign-in first is the idea to weigh.

## 18. The owner's answers, and the questions left

**Answered 2026-10-21, asked one at a time by the watcher** (the full words are in lane A's questions
file, outside the repository):

1. **What the stick does:** "Small stick, downloads, fully unattended., the box may not have a screen
   or keyboard", with three guards: boot once; refuse to finish until the stick is removed; do
   nothing on a disk holding Waitron unless a key is pressed. → §3–§5.
2. **The full-screen browser on every box: A**, and **no desktop**: the box's settings become
   Waitron screens. → §8–§10.
3. **The box's screen:** "boot straight into the dashboard after setup, make it easy to add itself
   as a till device, have a config option to specify that it should boot into the till interface …
   and the till menu should include a link to the dashboard." → §9.
4. **Encrypt in B3, before go-live**, with the key in the chip and a recovery key on the recovery
   sheet; the maintenance password from the box's own start-up, not from the stick. → §7, §11.
5. **Wi-Fi:** wired first, the box's own hotspot as the fallback, open or with one password shared by
   every box: "At that stage we're not protecting anything." → §5.3, §10.

**The questions left**, in [`question.txt`](../../backlog/mockups/b3-usb-installer/question.txt):

1. **Approve the revision?** It names the calls a reader would most want to overturn: starting the
   installed box after 15 seconds rather than stopping (guard 3); the 60-second wait before erasing
   another system (§5.2), and never erasing a disk it cannot classify without a key; the installer's
   open hotspot (§5.3), and **no hotspot at all once a box holds a venue** (§10); no hand-set clock,
   keeping A798's decision (§10); the till signed out when «Panel» opens the dashboard (§9);
   maintenance for admins only, at the box's own console (§11); the setup code, made by the
   installer, on the stick and asked on every setup request (§12); the installer refusing a box with
   Secure Boot off (§7.7); and the update to Microsoft's newer certificate needing a person present
   until slice 1 settles it (§7.4).
2. **Practising on a stick-installed box** (picture 11). **A (recommended):** a stick box offers only
   Live, restore or spare; practise on another computer and bring the menus across at Live setup
   (§12). **B:** the stick box offers Prepare too; going Live later is a reinstall from the stick
   that brings the prepared menus across the same way.

## 19. Build order, one pull request each

1. **The ready-made disk** — `mkosi` build of §6, §7 and §8 in CI on every change to its inputs,
   with dracut, the hook of §7.2 item 3, the first start's sealing and test restart, the recovery
   key's creation and the name tag's format (§7.6; the host service that writes it is slice 3);
   booted in a virtual machine with a virtual TPM to `/setup-api/status` 200 and a screenshot. Runs
   §7.2's experiments (a), (b), (d), (f), (g), (i).
   Measures:
   the compressed size, SQLite on btrfs, a rollback of `@volumes` with `@logs` mounted inside it on
   the encrypted disk, the cost of re-encrypting on first start (§7.3), and a stick-installed box's
   files against a hand-installed one's. Not yet published.
2. **The installer stick** — §5 whole: the three guards, the 60-second wait and the disks it will not
   erase unattended, the Secure Boot and TPM refusals, the network and its hotspot, the download and
   its checks, the status page, the setup code on the stick and the disk; booted end to end in CI
   with Secure Boot on, including a restart with the stick left in. Measures the install time and
   the stick's size.
3. **The box's screen, host service and network** — `cage` and Chromium (§9), the host service's
   socket (§8), the start-screen setting, «Usar esta pantalla como caja», «Panel» and «Volver a la
   caja», the traps of §9, the first-start failure page (§7.3), writing the name tag (§7.6), and
   Settings → Red (§10) — in the
   go-live minimum because a box installed over a phone's connection has no other way onto the
   venue's network but a cable (§5.3).
4. **The rest of the box's settings and maintenance access** — §10's other rows and §11.
5. **Publishing per release** — §13 steps 3–5, after A940's release slices.
6. **On the real box** — the first install on the chosen model: Secure Boot, the TPM, the boot-menu
   key, guard 1 and guard 3 on its firmware, the clock, §7.2's experiments (c), (e) and (h), the traps,
   a power cut with the stick put back in.
7. **The release check** — §14's service, handed to A950.
8. **Setup on a stick box** (W60) — §12: the setup code on every setup request, A917's naming form
   included; the mode screen of a production box and of a stick box; the refusal's words;
   `waitron.sh` prints the code; and the disk's recovery key on the recovery sheet, with the host
   service's copy deleted on the sheet's "kept" confirmation (§7.5).

**The go-live minimum is slices 1, 2, 3, 5, 6 and 8.** A Live box runs only a release (A940 §5.1),
so the first venue's box is installed from the first release tag, which waits for A940's release
slices; encryption is in slice 1 because the owner wants it before go-live; the box's screen is the
counter till at a one-box venue (A947 §6.6 calls the counter till "often the main box's own screen",
`docs/superpowers/specs/2026-10-21-a947-two-box-failover-design.md:783`); and the setup code closes a
way for a stranger to take a new box and puts the disk's recovery key on paper. Slices 4 and 7
follow. Slice 8 changes how setup is
authorised, so it takes the full review; none of the slices is fiscal.

## 20. What this design does not settle, for the builder

- The exact registers, the hook's register, and the temporary seal or the predicted values that
  replace it (§7.2, §7.4) — by experiment, against the acceptance list.
- How a change to register 7 itself (Microsoft's newer certificate) is taken without a person
  present (§7.4).
- How the box's screen service tells Waitron which page to open, and how the box's screen marks
  itself (§9).
- The host service's request list and its socket's permissions (§8).
- How the image build reuses `waitron.sh`'s file-writing steps (§8).
- The exact Docker version and image-store folders `@images` covers (§6).
- The installer's own screen technology; using the same `cage` and Chromium as the box keeps one
  look and one set of fonts.

## Provenance

P1–P31 were fetched 2026-10-21 with `curl`; their sources' own words are quoted in
`~/waitron-campaign/b3-design/research-external.md` (outside the repository), section numbers given.
P32–P55 and P58 were fetched for the revision, the same day, the same way; quoted in
`~/waitron-campaign/b3-design/research-external-2.md`, finding numbers (R…) given. P56 and P57 were
fetched by the revision's review and are quoted in `~/waitron-campaign/b3-design/review-r1.md`; P59
by its second review, in `review-r2.md`.

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
| P9 | Debian's `docker.io` is 26.1.5; Go and Rust packages "will be covered by limited security support" | packages.debian.org; trixie release notes §5.2.3.2 (3.4, 3.5) |
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
| P23 | debootstrap's `minbase` installs "only … required packages and apt"; `systemd-timesyncd` is priority standard; `unattended-upgrades` might not be installed | debootstrap man page; systemd `debian/control`; wiki UnattendedUpgrades (11.2, 7.2) |
| P24 | "All PCs … have a Real Time Clock built into them", battery backed | Linux `Documentation/admin-guide/rtc.rst` (11.1) |
| P25 | Intel Wi-Fi firmware may be redistributed in binary form with its notice | firmware-nonfree copyright (9.6) |
| P26 | "Each file included in a release must be under 2 GiB" | github/docs `about-releases.md:49` and `data/variables/large_files.yml` (`max_file_size: '2 GiB'`), fetched 2026-10-21 |
| P27 | iwlwifi: "AP mode on 2.4GHz … no 5GHz AP support" | wireless.docs.kernel.org iwlwifi (4.4) |
| P28 | "By default, Windows uses localtime" for the hardware clock | https://wiki.archlinux.org/title/System_time, fetched 2026-10-21 by the second review |
| P29 | "A restart policy only takes effect after a container starts successfully" | https://docs.docker.com/engine/containers/start-containers-automatically/, fetched 2026-10-21 by the second review |
| P30 | `/etc/machine-id` "should be either missing or an empty file in the generic file system image" | machine-id(5), freedesktop.org, fetched 2026-10-21 by the second review |
| P31 | "Live restore allows you to keep containers running across Docker daemon updates, but is only supported when installing patch releases (YY.MM.x), not for major (YY.MM) daemon upgrades." | https://docs.docker.com/engine/daemon/live-restore/, fetched 2026-10-21 by the third review |
| P32 | Debian 13 has systemd 257.13 and `tpm2-tools` 5.7, whose file list includes `/usr/bin/tpm2_pcrextend` (checked by the revision's second review); its `systemd-cryptenroll --tpm2-pcrs=`: "If not specified, the default is to use PCR 7 only"; systemd 258 changed the default to no registers | packages.debian.org/trixie/systemd and tpm2-tools; manpages.debian.org trixie systemd-cryptenroll(1); systemd NEWS "CHANGES WITH 258" (R1, R2, R5, R7) |
| P33 | Register meanings: 4 "Boot loader and additional drivers"; 5 "GPT/Partition table"; 7 "SecureBoot state", which "changes when … firmware certificates (PK, KEK, db, dbx, …) are updated"; 8 GRUB "Commands and kernel command line"; 9 GRUB "All files read (including kernel image)"; 11 "systemd-pcrphase … Boot phase strings" | uapi-group.org Linux TPM PCR Registry (R3) |
| P34 | Shim: "Any certificate in one of our certificate databases that matches a binary we try to load will be extended into PCR7"; "the Authenticode hash of the binary being loaded will be extended into PCR4" | rhboot/shim README.tpm (R9); EDK2 DxeImageVerificationLib (R10) |
| P35 | "Make sure Secure Boot is active and in user mode when binding to PCR 7, otherwise, unauthorized boot devices could unlock the encrypted volume"; "Only binding to PCRs measured pre-boot (PCRs 0-7) opens a vulnerability from rogue operating systems … The rogue root filesystem … is still able to receive the decryption key"; "the initrd will fall back to a password prompt, if TPM unlocking fails" | ArchWiki systemd-cryptenroll (R11); oddlama.org, 2025-01-16 (R12) |
| P36 | GRUB "will log each command executed and each file loaded into the TPM event log"; commands and kernel command line into 8, files into 9; Debian builds GRUB's `tpm` module into its signed images | Debian 13 grub2 `docs/grub.texi`; `debian/build-efi-images` (R14, R15) |
| P37 | Firmware measures the GPT of the disk it booted from into register 5 | EDK2 DxeTpm2MeasureBootLib; systemd-pcrlock(8) (R16, R17) |
| P38 | `systemd-pcrlock`: "this command is experimental for now"; its page does not mention GRUB | manpages.debian.org trixie systemd-pcrlock(8) (R18) |
| P39 | A signed register-11 policy works through a unified kernel image; with Secure Boot on, "the signing key needs to be imported in DB or MOK" | systemd-cryptenroll(1), ukify(1); wiki.debian.org/UKI (R19) |
| P40 | Recovery keys are "randomly generated … designed to ensure they are easy to type in"; 256 bits "formatted as sequences of 64 modhex characters, with dashes" | systemd-cryptenroll(1); systemd v257 `recovery-key.h` (R20a) |
| P41 | Debian bug #1031254: "ignoring unknown option 'tpm2-device'" for the root disk under initramfs-tools; still so in trixie's cryptsetup 2:2.7.5-2; Debian 13's dracut ships `01systemd-cryptsetup` and `91tpm2-tss`; clevis-initramfs exists | bugs.debian.org 1031254; cryptsetup source; dracut-core file list (R22–R24) |
| P42 | When the chip refuses, systemd-cryptsetup asks for a password "unless the headless option is set" | systemd-cryptsetup(8), crypttab(5) (R25) |
| P43 | A db/dbx update changes register 7; Microsoft UEFI CA 2011 "has now expired"; Debian's dual-signed shim; the next shim "will only be signed using the current Microsoft UEFI CA"; which db entry a firmware records for a dual-signed shim not found | PCR registry; Microsoft KB5025885; wiki.debian.org/SecureBoot/CAChanges (R26, R27) |
| P44 | `Encrypt=tpm2` formats a new partition as LUKS2; "This option has no effect if the partition already exists"; the empty key "is useful for setting up encrypted partitions during early first boot that receive their user-supplied password only in a later setup step" | repart.d(5), systemd-repart(8), Debian 13 (R28) |
| P45 | The LUKS2 binary header "contains … basic information (labels)", usable "the same way as a filesystem label"; "An attacker with physical access … can modify … the visible metadata" | LUKS2 On-Disk Format Specification 1.1.4 (R29) |
| P46 | "Most retail PC motherboards … ship with TPM turned off by default"; the option may be labelled "Intel PTT" or "AMD fTPM" | Microsoft, "Enable TPM 2.0 on your PC" (R30) |
| P47 | `BootOrder`: "The boot manager tries to boot the first active entry in this list"; `BootNext` "supersedes BootOrder for one boot only, and is deleted by the boot manager after first use"; the removable-media default path is used "any time the BootOrder variable does not exist or only points to nonexistent boot options, or if no entry in BootOrder can successfully be executed" | efibootmgr(8), Debian 13; UEFI 2.10 §3.1.2 via the Wayback Machine (R33, R34) |
| P48 | "Some implementations ignore the boot order altogether"; the removable path `\EFI\boot\bootx64.efi` "All firmware implentations have to use … to be able to run an OS installer" | wiki.debian.org/UEFI (R35); shim README.fallback (R36) |
| P49 | Chromium `--kiosk`: "In kiosk mode, we always want to be fullscreen"; no infobars in kiosk mode, the restore bubble included; the shortcut allowlist applies with `--force-app-mode`; `--hide-crash-restore-bubble` is checked in shared code | Chromium source, main branch, 2026-10-21 (R37–R39) |
| P50 | Debian 13: chromium 155, cage 0.2.0; cage "runs a single, maximized application … User interaction and activities outside the scope of the running application are prevented"; `-s` "Allow VT switching"; cage terminates when its application exits (source) | packages.debian.org; cage(1); cage 0.2.0 `cage.c` (R40, R41) |
| P51 | `nmcli device wifi hotspot`: "If not provided, nmcli will generate a password"; a "shared" network "Provides network access to other computers" and gets 10.42.x.1/24 and a DHCP server | nmcli(1), nm-settings-nmcli(5), Debian 13 (R42a, R42b) |
| P52 | Android probes `generate_204` and treats other 200–399 answers as a captive portal; Apple sends "a probe when joining your network for the first time"; RFC 8910: captive portals "will still need to implement interception techniques" | AOSP NetworkStack; developer.apple.com; RFC 8910 (R43–R45) |
| P53 | `Restart=always` restarts "regardless of whether it exited cleanly"; units started "more than burst times within an interval" are not started again | systemd.service(5), systemd.unit(5), Debian 13 (R46) |
| P54 | Certificate validity "is checked against the current system time"; systemd's clock floor is the highest of its build time, the mtime of `/usr/lib/clock-epoch` and of the last sync | openssl-verification-options(1ssl); systemd(1), systemd-timesyncd.service(8), Debian 13 (R48, R49) |
| P55 | `avahi-daemon` 0.8-16 is in Debian 13 | packages.debian.org/trixie/avahi-daemon (R47) |
| P56 | systemd v257's boot-phase services carry `ConditionSecurity=measured-uki` ("Unified Kernel Image with PCR 11 Measurements, as per systemd-stub"); `pcrextend` skips with "Kernel stub did not measure kernel image into PCR 11, skipping userspace measurement, too"; cryptsetup's register-15 measurement returns early without a measured UKI, and the other units that write register 15 (`systemd-pcrmachine`, `systemd-pcrfs@`, `systemd-pcrfs-root`) carry the same condition (checked by the second review) | systemd v257 sources (`units/systemd-pcrphase*.service.in`, `man/systemd.unit.xml:1575-1576`, `src/pcrextend/pcrextend.c:378-385`, `src/cryptsetup/cryptsetup.c:992-998`), fetched 2026-10-21 by the revision's review (`~/waitron-campaign/b3-design/review-r1.md`, H2) and again by its second (`review-r2.md`) |
| P57 | LUKS2's label and subsystem fields are 48 bytes: `#define LUKS2_LABEL_L 48` | cryptsetup `lib/luks2/luks2.h:22,88,92`, fetched 2026-10-21 by the revision's review (`review-r1.md`, H5) |
| P58 | "Firmware's UEFI SecureBoot protects shim, shim's key management protects grub and kernel. No code signing protects initrd." | Lennart Poettering, https://0pointer.net/blog/brave-new-trusted-boot-world.html (R13) |
| P59 | dracut 106's emergency script: `if getargbool 1 rd.shell || getarg rd.break; then … exec sulogin` — a shell is offered unless `rd.shell=0` | dracut-ng tag 106, `modules.d/98dracut-systemd/dracut-emergency.sh`, fetched 2026-10-21 by the revision's second review (`~/waitron-campaign/b3-design/review-r2.md`, R2-M1) |
