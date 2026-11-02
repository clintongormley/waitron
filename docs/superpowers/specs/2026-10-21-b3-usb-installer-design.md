> 2026-11-01: the owner authorised the build; PR 1's plan and its re-map against main: [2026-11-01-b3-1-encrypted-disk.md](../plans/2026-11-01-b3-1-encrypted-disk.md).

> **Later A950 authority, 29 October 2026:** the owner approved its [implementation plan](../plans/2026-10-29-a950-automatic-upgrades.md), option A. The earlier pending-plan note below is superseded. B3 host, hardware and trust prerequisites remain.

# B3 — The bootable USB installer

> **A950 pointer, 29 October 2026:** the [approved A950 design](2026-10-27-a950-automatic-upgrades-design.md)
> now owns application updates, exact image retention and rollback until a clean, running restart.
> Every venue starts automatic-on with an editable 03:00–05:00 local window. References below to
> A950 as undesigned, its earlier quiet hour or tag-only retention record the earlier revision.
> B3's separate host/TPM and trust qualification gates remain; the A950 plan still needs owner approval.

**Status:** APPROVED WITH CHANGES, owner 2026-10-26 ~12:15: “We don't need the configuration
code. It's not a concern. The rest approved.” Revised by Lane F (B3r) to remove setup credentials,
repeat the disk recovery key on every sheet, and replace the terminal unlock fallback with a
Waitron preboot screen (§7.5). Q2 is answered. The owner's 2026-10-26 ~13:45 and ~14:00 CET
answers settle unlock reachability and the normal Wi-Fi boot copy (§18). Implementation details
and the retained shared-backoff proposal remain PROPOSED requirements. Actual Android Chrome
trust qualification is UNVERIFIED / NOT RUN today, with historical negative evidence and a release
hold (§7.5). Planning slices 1, 2, 3, 5, 6 and 8 is authorised; building is not.
Plan: [`2026-10-26-b3-usb-installer.md`](../plans/2026-10-26-b3-usb-installer.md).
Backlog entry: `docs/backlog.md`, "B3. The bootable USB installer". Pictures: removed from the repository on 2026-11-02.

**What the revision changed.** The first version carried every release on a large stick, needed no
internet, and erased nothing without a press on the box's screen. The owner chose instead: a small
stick that downloads the release, installing with nobody at the box, made safe by three guards (§5);
a full-screen browser on every box and no desktop, with the box's settings as Waitron screens
(§9, §10); the box's screen opening the dashboard after setup, able to become a till, and able to
start on the till (§9); the disk encrypted with its key held in the box's security chip (§7), and a
maintenance login handed out by the box itself (§11); and, during the install, the installer's own
Wi-Fi hotspot as the fallback when there is no cable (§5.3). The watcher folded W60 in: a production box offers neither Demo nor
Prepare (§12). The later owner decision accepts another LAN browser claiming an unconfigured
box first, including fresh Live pending after Prepare. W60's setup-code part is closed;
its production-mode restriction stays.

**2026-10-26 revision pointer.** The owner subsequently chose Prepare on the SAME stick-installed
box, followed by an admin's dashboard action that saves only configuration and restarts fresh Live
setup. No USB, operating-system reinstall, disk/encryption reset or promotion of the practice
database is involved. A genuinely production-started box still offers neither Demo nor Prepare;
an unprovisioned stick box offers Prepare, Live and the existing-venue paths, but not Demo (§12).
The original 2026-10-21 external research and the dated A798 pointer in §10 remain historical
provenance. The new configuration inventory is a source trace, not an execution receipt (§12.3).

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
  (`docs/superpowers/specs/2026-10-21-a947-two-box-failover-design.md:1383-1385`).
- **A798, keep trading when a part fails** — "The box image keeps its clock synchronised, with no
  terminal … the image makes it standing" (`docs/backlog/box.md:366-373`).
- **A940, the declaración responsable** — "B3's USB installer, when it is designed, copies the PDF
  onto the stick beside the installer" (`docs/superpowers/specs/2026-10-21-a940-declaracion-responsable-design.md:1124-1125`).

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
   disk key and recovery key, its name tag, the disk grown to fill the box, the print
   agent's AppArmor line, §7, §8, §12); CI builds the disk
   and installs it in a virtual machine before it is published.
3. A stolen disk, or the box started from another stick, cannot open encrypted venue data without
   its key (§7's qualification). Startup files remain readable, including the accepted normal
   Wi-Fi join copy and separate recovery leaf private key (§7.5).
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
   refuses after an ordinary kernel update stops the restaurant at its recovery screen (§7.4).
   Recovery must work on the local display and the approved preboot connection (§7.5).
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
| Clock | Nothing sets up time synchronisation | `deploy/waitron.sh` (grep `timesyncd\|timedatectl\|chrony\|ntp`: none); historical 2026-10-21 inventory, see §10's dated A798 update |
| Disk layout | Whatever the preparer chose; "The Docker volumes live on the same disk as Docker's images" | `docs/superpowers/specs/2026-10-19-a798-degraded-trading-design.md` §2.6 |
| Disk encryption | None designed; an older design pointed at "full-disk encryption, TPM-sealed auto-unlock" in a spec since deleted | `docs/superpowers/specs/2026-09-07-fiscal-cert-distribution-design.md:60` |
| Network | Assumed wired; nothing configures it | `deploy/waitron.sh` (grep `nmcli\|netplan`: none) |
| First setup | Unauthenticated; Demo and Prepare go to whoever is first, Live to the first claim | `apps/server/src/setup-api.ts:613`, `:806`; `packages/provisioning/src/first-setup-state.ts:507-515` |
| Releases | None. No `v*` tag, no GitHub Release; CI would publish `:<version>` on one | `.github/workflows/ci.yml:2770-2772` |
| Box screen | Nothing; the kiosk is a recorded lean, unbuilt | `docs/backlog/box.md:6-33` |
| Box settings (Wi-Fi, clock) | No screen; the server only reads the clock's state by running `timedatectl` | `apps/server/src/time-health.ts:34-42`; historical 2026-10-21 inventory, see §10's dated A798 update |
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
   starts, so the stick can be taken out once it says so (§5, guard 2). The installer writes
   nothing to the stick; it is never a disk-key or setup-credential carrier.
2. **Waitron's two public signing keys** (§14), against which it checks the release list and the
   disk it downloads.
3. **A folder readable on any Windows or Mac computer**, named `WAITRON`, holding: `LEEME.html` /
   `README.html` (what this stick is, the three guards in one paragraph each, and what to do with no
   internet), a `licencias` folder with the licence notices and the written offer for source code
   for the installer itself (§13), and a checksum list. No setup code is generated or stored on
   the stick, disk or closing banner (§12.5).

The release's declaración responsable (A940 §7.1) is downloaded with the release and kept on the
box, where Help → About shows it (A940's design), rather than on a stick that may be older than the
release it installs. **My call**; A940 assumed the PDF goes on the stick
(`docs/superpowers/specs/2026-10-21-a940-declaracion-responsable-design.md:1124-1125`), and §17
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
3. only for a box it is going to install (or one whose reinstall a person has confirmed), it
   confirms that the complete installer is running from memory, then says «Ya puedes quitar el USB».
   This is the removal point used by guard 2, §5.6 and the card; no code is made or written;
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
   is gone; until then it waits, saying so on the screen and the status page. Removal is mandatory
   even after setting the boot order: firmware can ignore it and start the installer again (P48).
   A stick taken out any time after «Ya puedes quitar el USB» (step 3 above) changes nothing: the install carries on and
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
checking its checksum. **The clock's time instant comes first; the venue's time zone is separate
(§10):** the HTTPS download's certificate check fails on a clock that is far wrong (P54), and a mini PC that came with Windows keeps its battery clock in local
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
makes the container fill the disk, writes the ready-made filesystem into it, checks what it wrote,
sets the boot order (guard 1), and then waits for the stick to be out (guard 2). Picture 4.

### 5.6 Where the person sees progress

- **A screen**, if one is plugged in: every step, as above.
- **A status page**, for a box with no screen: while it runs, the installer answers at
  `http://waitron-instalar.local` on the venue's network (published by Avahi, which Debian 13 has,
  P55) and, while its own Wi-Fi network is open, on that. It shows the step, the progress, «Ya
  puedes quitar el USB» and any reason it has stopped. It shows no setup code and offers no action
  but the Wi-Fi form. It exposes installation progress and stop reasons, never disk or fiscal
  keys. **My call.**
- **The printed card**, for a person with neither: plug in, start, take the stick out after the time
  the card states (measured in slice 2, so that it falls safely after step 3's «Ya puedes quitar el
  USB»), and open `waitron.local` from a phone or computer on the same network after the time it
  states.

**After the restart**, the box's screen opens the setup wizard (§9); a box with no screen is set up
from any device on the network without a setup code (§12). The installer asks
nothing the wizard asks: not the name, not new-venue-or-spare (A947), not the fiscal mode.

## 6. The disk the installer writes

**My call**, built so A950 can snapshot the venue without the operating system and roll back one
without the other. Two words used below: a **LUKS2 container** is the standard Linux format for an
encrypted part of a disk; **btrfs** is a Linux filesystem that can take instant snapshots, and its
**subvolumes** are separately snapshotted folders inside it.

| Part | Holds | Why separate |
| --- | --- | --- |
| EFI system partition, 512 MiB, FAT, not encrypted | Debian's signed boot loader (§15), also at the fallback path (guard 1) | The firmware starts from it |
| Boot partition, 1 GiB, ext4, not encrypted | The kernel and startup image (§7.2), plus separate recovery identity and minimal normal Wi-Fi join copy (§7.5) | The loader reads boot files before unlock; recovery data stays outside its measured file set |
| LUKS2 container, rest of the disk, marked as Waitron's by its partition type and name and its "subsystem" field (§5.1 guard 3) | One btrfs filesystem, in five top-level subvolumes: | Encrypted (§7) |
| `@rootfs` → `/` | Debian, Docker, the browser, the box's host service | Debian's own updates (§14) roll back separately from the venue |
| `@images` → Docker's image and container store | The Waitron images | A950 keeps the old image by its tag, not in the snapshot (`docs/backlog/box.md:76`) |
| `@volumes` → Docker's volumes folder | `waitron_state`, `waitron_backups`, `waitron_print_agent`, `waitron_mailpit` | What A950 snapshots and puts back |
| `@logs` → mounted at the `waitron_logs` volume's folder | `waitron.log` | A subvolume of its own, so a snapshot of `@volumes` does not contain it (P13) and a rollback of `@volumes` should leave it alone — the case `docs/backlog/box.md:78-79` asks for. What a rollback does to a subvolume mounted inside another's folder is untested: slice 1 tries it |
| `@host-state` → `/var/lib/waitron-host` | Retained disk-key record, physical recovery identity metadata, cutover handoff/phase and host audit | New 2026-10-26 storage call for retained recovery: outside both `@rootfs` and `@volumes` snapshots/rollback. It is not a venue backup/export source. |

- **The kernel and startup image sit outside the encryption** because Debian's loader must read them
  before anything is unlocked; neither embeds venue data or Wi-Fi secrets. The separate boot copy
  of normal Wi-Fi join fields is an accepted exception to encrypted credentials (§7.5). Whether Debian's signed loader can read
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
gives only to the box's own start-up.** A normal start is intended to unlock with no password;
§7.2 qualifies refusal from another stick, this installer included. The container protects venue
data, while unencrypted startup files expose the Wi-Fi join copy and recovery leaf private key
described in §7.5. A
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
     screen (§7.5) is a separate step of Waitron's own, after the hook.
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
5. **The recovery screen must not permit a second TPM unseal.** The box unlocks unattended or
   starts the preboot Waitron recovery screen (§7.5), after item 3's hook. The screen never opens
   an emergency shell. The fake-disk controls still have to prove this; changing the interface
   does not establish that the attack is defeated.

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
- **(f)** a deliberately broken seal stops at the preboot recovery screen, the recovery key opens it,
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
could never reach its recovery screen. It never ships. The CI virtual machine runs (a), (b), (d), (f), (g)
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
   comparing every boot-loader-measured byte before and after first start, while separately
   recording the recovery identity/Wi-Fi files staged outside that set (§7.5). **My call.**
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
matches, and a box restarted without care stops at the preboot recovery screen: anti-goal 3.

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

### 7.5 The recovery key and the preboot Waitron screen

**Owner changes, 2026-10-26:** every later recovery sheet includes the disk recovery key; restore
and spare setup include it on a separate page. When automatic unlock fails, you use a Waitron
screen on the box's display or from another device on the LAN. There is no terminal fallback.
These are design requirements, not implemented or qualified paths. Pictures 9 and 12 show the proposed screens.

The key remains 256 random bits, displayed as 64 letters in eight groups of eight from the
16-letter set in P40. First start creates it (§7.3). It opens one encrypted disk, not a fiscal
chain, backup archive or account. Every disk-key section/page names the **LUKS UUID** and box
identity, with a «Clave de recuperación del disco» section containing the key as text and a QR
code. You confirm that you kept the first sheet/page before continuing. Restoring an old venue backup on a newly installed disk prints the NEW disk's key and
UUID, never a key inferred from the backup or the restored venue's identity. Reinstall makes a
new disk/key pair; same-box configuration cutover keeps the existing pair.

**Proposed host storage and delivery choice (my call).** Keep
`/var/lib/waitron-host/disk-recovery/<LUKS UUID>.json`, versioned and mode `0600`, owned by host
root, inside the encrypted disk on the separate `@host-state` mount, outside both OS and venue rollback. Parent directories
are root-only. Before any read/write, the service verifies that `/var/lib/waitron-host` is mounted from
the expected disk's `@host-state`; a missing mount refuses rather than writing into the underlying
`@rootfs` directory. The host service checks the actual opened disk's UUID against the record and
refuses missing, mismatched, corrupt or ambiguous records. It never guesses from a venue id.
The key never enters the venue database, backups, bucket stream, configuration export, URLs,
audit fields or logs, and no key directory is mounted into the app container. This is a proposed
path and permission contract, not a claim that a file or service exists today.

First delivery uses a guarded, one-time **internal host-to-renderer channel**, bound to the actual
disk and current setup attempt. The internal capability is not a code given to the person, a setup
grant or authority to claim/preview setup. A public setup request or forgeable local-screen marker
cannot redeem it. The recipient proves the ordinary administrator identity being created during
that setup over the protected delivery connection; this must work **before publication** without
requiring an already-existing admin session. For restore/spare, use the validated adoption/recovery
authority and recipient identity established by that flow. Bind the exact verification points
after A1042's release (§12.4), rather than assuming today's recovery document contains this key.
If the flow cannot protect first delivery without a pre-existing admin, stop at that binding gate;
do not expose the key publicly or invent a setup code. A failed download can retry the same
bound delivery; “kept” retires its capability, not the host's retained disk key.

Every later sheet/download or restore/spare disk-key page uses an admin's fresh reauthentication:
password or passkey plus enrolled TOTP, as in §11. A first restore/spare delivery uses the first-
delivery rule above when that flow has not yet established a usable admin. Audit who requested
each first/later delivery, the disk UUID, document id, result and time outside the removed venue;
never audit the key. Use `no-store` responses and transient renderer memory, not a PDF retained
in the venue's recovery archive. If no disk key is available, refuse with usable retry/Stop choices;
never present a complete sheet missing its required disk section. Existing fiscal keys and
recovery credentials remain separate and retain their own checks.

**Cost of keeping it:** a privileged compromise of the running, unlocked host can obtain the
retained recovery key. Confirming the sheet no longer erases the host's last readable copy.
Root-only access and encryption protect its storage boundary; they do not protect it from host
root. Disk-key rotation after compromise is not designed here. The USB never carries the key.

**Preboot requirements, before root opens.** A separate minimal Waitron UI and unlock service run
from the unencrypted startup image, in Spanish with English one tap away, on a local display and
over cable or the saved normal Wi-Fi connection for a headless box. No terminal or emergency shell
is offered. Accept a disk key only on the local screen or at the verified trusted HTTPS recovery
hostname below. No plain-HTTP or untrusted-HTTPS key form, venue content, retained disk key or general
host socket belongs here. These are proposed implementation and qualification requirements, not
implemented Linux/browser behavior. The owner settled reachability and Wi-Fi; the exact backoff
below is a retained plan proposal, not numbers explicitly chosen in those answers.

**Approved reachability, 2026-10-26 ~13:45 CET.** While locked, `http://waitron.local` redirects
straight to `https://unlock-<installation-id>.waitron.local`. `https://waitron.local` instead
serves a deliberately untrusted redirect-only certificate, NOT signed by the box CA. The owner
accepts clicking past that one warning solely to reach the redirect. Neither entry point accepts
a key, sign-in or configuration change. The target is a fixed host-owned per-disk URL, never a
request-supplied redirect or credential-bearing URL. You enter the key only after verifying the
trusted recovery hostname against the sheet. The redirect is navigation, not proof of identity;
no warning at the actual key form may be bypassed. Qualify both entry routes in the locked boot
mode, and listener teardown/return to ordinary serving after unlock. Direct use of the sheet's
full recovery URL remains available if a browser cannot proceed through the redirect warning.

Use a separate per-disk recovery leaf certificate, signed while the normal system is unlocked by
the box's existing local certificate authority (CA), the root certificate devices are asked to
trust. The normal server certificate/private key and the CA signing key stay encrypted. Stage
only the recovery leaf/private key, PUBLIC CA certificate, public disk identity metadata and the
separate untrusted redirect-only certificate/private key under `/boot/waitron-recovery/`. None
may contain the CA signing key. These files and the Wi-Fi copy below must stay outside files read
and measured by the boot loader; do not rebuild the measured startup image on first start or on
a network/identity update. This is an extension to build, not today's certificate helper behavior.
A client already trusting that CA is the intended easy path, subject to actual-client qualification
and the Android hold below. A client using an operator's custom normal certificate may never have
trusted the box CA and follows the new-client path.

The recovery name is `unlock-<installation-id>.waitron.local`, independent of the venue name,
on HTTPS port 443. The sheet keeps the complete URL, disk UUID, PUBLIC CA SHA-256 fingerprint,
current recovery-leaf fingerprint and actual CA/leaf not-after dates. A new client compares the
downloaded CA's full fingerprint with the saved sheet or already-trusted offline recovery pack,
then installs explicit trust using qualified platform instructions. Public CA download/help is
available without a key form; the plain `waitron.local` entry itself still redirects directly.
A fingerprint shown only by an untrusted page is not a check. If the device cannot perform that
step, use a qualified already-trusting device or the local Waitron screen. This grants no setup
or sign-in authority. Apple requires a separate manual TLS trust step for downloaded certificate
profiles (P62). No phone-specific safety promise ships before qualification.

**Approved normal Wi-Fi copy, 2026-10-26 ~14:00 CET.** A Wi-Fi box keeps the normal network name
(SSID) and password, plus only validated security/join fields actually needed by the qualified
adapter, in the unencrypted boot partition. There is no separate recovery SSID and no unlock
hotspot. Cable and local-display recovery remain available. The installer-only open hotspot in
§5.3 stays separate. Anyone holding the box can extract this Wi-Fi password, including by removing
the disk or starting from another signed Debian stick. The owner accepts that cost. The operator
guide must say: **If a box is stolen, change the venue's Wi-Fi password.** Root-only permissions
do not protect this copy against physical access. Copy no arbitrary network profile, other
credentials, disk key, logs or credential-bearing URL into boot.

**Proposed minimal-copy update contract (my call).** The running host alone owns a fixed
`/boot/waitron-recovery/wifi.json`, a versioned record for one normal Wi-Fi connection. Network
requests select validated join settings, never a destination path. Initial installer handoff and
every Wi-Fi configuration change, including host-observed changes outside the dashboard, must
reconcile this record; switching to cable-only
or forgetting the selected Wi-Fi removes it. A cable temporarily plugged into a Wi-Fi-configured
box is not itself a request to forget Wi-Fi. The host serializes network changes, records a durable
encrypted pending operation on `@host-state`, applies/checks the authoritative normal configuration,
and publishes only its resulting join fields. Do not report the whole change complete until the
boot copy or its removal is durable; if the running connection changed but publication failed,
report those two outcomes and recovery availability separately.

For publication, verify the expected boot mount and root-owned directory, reject symlinks/non-regular
files, validate bounded fields, write root-only `wifi.json.next` in the same directory, flush its
bytes, atomically rename it to `wifi.json`, then flush the directory. Keep no boot-side backup or
per-profile history. The fixed Wi-Fi cleanup allowlist is `wifi.json.next` plus, for cable-only,
`wifi.json`; never scan/delete arbitrary boot paths. Remove obsolete staging copies, flush deletions,
and retain the encrypted
pending operation until reconciliation/cleanup completes. Cable-only cleanup removes the active
copy as well. On an unlocked restart reconcile unfinished operations against authoritative settings;
never replay an obsolete password over a newer configuration. Interrupted deletion can leave an old
copy until reconciliation, so do not claim secure erasure or that a failed cleanup removed physical
exposure. No general file-write RPC, arbitrary-path cleanup, secret audit fields or password-bearing
command arguments/logs are allowed. Prove measured boot bytes unchanged across all updates and
cleanup. Exact durability on the selected filesystem is a rig qualification, not a claim here.

Before unlock, read only the validated active fixed-path record, never leftover temporary copies.
A valid but stale password can fail to join; a missing/corrupt copy or unavailable adapter/network
can leave the box unreachable. Bound retries and show the actual connection failure on the local
screen; offer cable or local unlock, then repair/reconcile from the running host. Do not expose
an unauthenticated network editor, invent a hotspot or promise Wi-Fi works after a reboot/power
failure. Qualify password/SSID changes, cable-only removal, failure during publication/cleanup,
reboot with old/new/missing/corrupt records, and an unjoinable network. A valid copy alone is not
evidence of successful network reachability.

While root is unlocked the host renews the recovery leaf under the same CA before expiry, keeps
the old working pair until the new pair is checked, and writes it atomically outside the measured
image. The CA fingerprint stays the sheet's trust anchor across leaf renewal; the printed leaf
fingerprint is informational when renewal occurs. Refuse a leaf that outlives the CA. An actually
expired or unreadable recovery identity requires the local Waitron screen until the unlocked host
can renew or repair it. A headless box then needs a display and input device plugged in; an already-
trusting client cannot make an expired leaf valid. For a CLIENT clock or trust problem, use another
correctly dated qualified already-trusting device or the local screen. Discovery failure offers
the qualified certificate-matching address fallback or the local screen. Never downgrade the key
form to HTTP or disable its certificate checks; the redirect-only warning exception does not apply
to it. Qualify each cause separately, including no-internet recovery and expiry behavior.
Reinstall creates a new CA/recovery identity and sheet; restoring a venue must not replace the
physical disk's preboot identity. Same-box cutover retains it. Physical startup-disk access exposes
the recovery leaf private key and permits impersonation of its recovery hostname. That leaf key
is NOT the encrypted CA signing key and cannot mint other leaves. Do not infer broader impersonation
from the historical CA-signed control below, or infer Android safety from keeping the CA key encrypted.
Neither leaf nor CA trust proves untampered startup.

**Historical Node receipt and Android counter-evidence.** Today's CA permits the DNS subtrees
`waitron.local` and `localhost` (`apps/server/src/self-signed-cert.ts:31-35`), and
`reissueServerLeaf` signs a different leaf/key under the supplied CA (same file). The earlier
2026-10-26 synthetic Node TLS probe using those helpers accepted `unlock-a1b2.waitron.local`
with explicit CA trust, refused it without trust, and refused `waitron-unlock-a1b2.local` with
“permitted subtree violation”, plus an untrusted-client control. Those four Node handshakes do not
measure Android, initrd, mDNS, real browser trust installation, hostname-mismatch handling or expiry.
The public CA and encrypted normal leaf paths are declared in `apps/server/src/box-secrets.ts:39-51`.
Systemd's password-agent interface (P60) and NetworkManager's configuration-only early generator
(P61) do not demonstrate the proposed preboot service either.

Commit `75f17f9e36125af3a620266a584507420e7197de` records an actual 2026-09-08 Android phone run:
“a cert for a name OUTSIDE the root's permitted subtree” loaded with “a clean padlock (HTTPS 200)”.
Its server log selected the outside-subtree leaf; the recorded method removed/reinstalled the root,
closed Chrome and used fresh Incognito without warning bypass. Exact Android/Chrome versions were
not captured. The current helper retains this pointer (`apps/server/src/self-signed-cert.ts:29-33`).
This is historical negative evidence for CA name-constraint enforcement on one phone, not proof
that the actual recovery leaf passes a hostname mismatch, and not current-device qualification.
The removed historical spike document is recoverable from that literal commit, not a live file link.

**Actual Android Chrome qualification: UNVERIFIED / NOT RUN, 2026-10-26.** The owner's claim that
“any .local cert works for any domain” remains a claim to test. On the SAME actual device/build
with explicit trust in the candidate box CA, require all three outcomes without click-through:

| Input served and requested name | Required outcome |
| --- | --- |
| Actual candidate recovery leaf served for `waitron.local`, with its SANs naming only the recovery identity | FAIL hostname verification; no trusted dashboard/key form |
| Candidate-CA-signed control leaf naming an outside-permitted-subtree DNS name, requested at that matching name | FAIL CA name constraints, independently of hostname matching |
| Actual candidate recovery leaf requested at its correct `unlock-<installation-id>.waitron.local` name | PASS with explicit CA trust, no warning |

Retain device/model, Android version/build/security patch, full Chrome version, trust-store type,
installed CA fingerprint and clean trust/proceed-exception state; candidate source/image digests;
served leaf/chain fingerprints, SANs, issuer, validity, CA constraints, requested URL/SNI, server
selection/handshake evidence and visible browser result for each row. Use a controlled name inside
no permitted DNS/IP subtree for the constraints row, with matching hostname and valid dates so a
mismatch/expiry cannot masquerade as constraint enforcement. Keep the deliberately UNTRUSTED
redirect-only certificate and its accepted warning as a separate fourth navigation check; never
use it to satisfy either negative control. The positive control must pass on that same device,
build and trust configuration or the negatives are inconclusive.

The historical failure places the affected trust design and release on requalification hold. A
failed negative control, failed positive control or missing actual-device result blocks release
under this trust design. Retain the failure and seek an owner decision if review or Android results
require changing approved behavior; never silently weaken hostname/CA checks, accept broad Android
trust, substitute Node evidence or turn a warning bypass into a pass. This docs author ran no Android
check and supplies no fresh result.

Qualification must also show collision detection and a certificate-matching private-address fallback
with two boxes present; changing the address requires a leaf naming it. Unauthenticated discovery
and either redirect are not peer-identity evidence. `waitron.local` is redirect-only while locked,
never an alias on the trusted recovery leaf. Freeze the unlock target before listening: expected
disk UUID plus expected layout/state. Wrong, missing or multiple matching disks, damaged metadata
or first-start-repair state offer Stop/reinstall guidance, not a key form or automatic write.
Public preboot metadata is not trusted evidence that the disk/startup is authentic.

**Retained wrong-attempt proposal (my call):** one verifier at a time across local and all remote
clients. After each failed key, delay all clients by 2, 4, 8, 16, 32, then 60 seconds, capped at
60 until successful unlock or reboot. These numbers were not explicitly chosen in the owner's
reachability/Wi-Fi answers and do not create a new pending approval question. Malformed submissions
cannot start concurrent verification or bypass the delay. Do not log submitted bytes. Keep key
input only in process memory; never arguments, environment, files, swap, dumps, browser storage or
access logs. Clear input and close listeners on success; clear on cancel/error and release buffers
when the attempt ends. Actual memory lifetime, browser retention and crash paths need measurement.
A passer-by can see recovery waiting and delay every route with wrong keys. Reboot resets the
proposed in-memory backoff; it does not limit offline attacks on a stolen disk or grant setup,
maintenance, network-change, sign-in or admin authority.

**Worked example (illustrative, not a measurement).** Marta's Wi-Fi box refuses automatic unlock
after a firmware change. If the saved normal profile still joins, she opens `http://waitron.local`
and follows the direct redirect, or uses the full URL on the sheet. Opening `https://waitron.local`
allows only the explicitly accepted untrusted redirect warning. At the actual trusted recovery
hostname she verifies the connection and matching disk UUID before typing the disk key. Three
wrong keys impose the proposed shared 2, 4 and 8 second waits. If Wi-Fi cannot join, she plugs in
Ethernet or uses a local display/input device. If the box is stolen, the venue changes its Wi-Fi
password because the boot copy was readable. No new sign-in, setup code or first-claim authority
is involved.

**Changed-startup warning and limits.** Show «Han cambiado los archivos de arranque» when the
readable expected fingerprints differ, or say verification is unavailable when it is. Warn before
key entry, in both languages, that the startup image is unsigned and cannot prove itself honest
(P58); a modified image can hide that warning and steal a typed key. A TLS connection protects
transport under the proposed trust flow, not the preboot program's honesty. After unlock, compare
the kernel/startup-image/loader configuration against the last self-built fingerprints recorded
INSIDE the encrypted disk. Reseal only if they match; otherwise raise the changed-startup alert
and do not reseal. Record recovery-key use without key bytes. Preserve §7.2's register-extension
hook on every exit and the fake-disk negative control; there is no shell or terminal fallback.

**A dead box or a lost sheet with the chip refusing:** restore backups on a newly installed box,
which starts a new fiscal chain (§0). A moved old disk may let you read unsent records using the
matching old disk's key; whether it can trade as the same installation remains open (§17). The
retained host copy cannot help before that disk is opened. A sheet from a replacement disk cannot
unlock the old one.

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
  login (§11), the retained disk key's guarded delivery (§7.5), the name tag (§7.6), the durable
  same-box configuration handoff (§12), the minimal normal Wi-Fi boot copy's update/cleanup (§7.5), the box's
  screen (§9), the first-start failure page (§7.3), and the release check (§14), which is
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

1. **Before setup:** the setup wizard, without a setup code. After same-box Prepare-to-Live
   cutover it opens fresh Live setup with saved configuration ready (§12). No local-screen
   marker grants setup authority or access to the retained disk key.
2. **After setup: the dashboard** (`/manage`), at its sign-in page. A spare box's screen (A947)
   follows the same setting, and also shows A947's switch page while the main box is silent
   (A947 §6.6, `docs/superpowers/specs/2026-10-21-a947-two-box-failover-design.md:905-906`).
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
manager holding `device.manage`. An ordinary foreign browser has no marker and sees no card;
that browser joins through the usual «Añadir un dispositivo», number check and manager acceptance.
The marker is display-only, never evidence for host actions or disk-key delivery.

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
| **Hora** | Shows the box's time instant, whether it is synchronised and from where. **No typed time** (below); venue time zone is separate | — (read only) |
| **Pantalla de este equipo** | Panel or Caja (§9) | `system.manage` |
| **Nombre en la red** | A917's "Change network name…", which A917 places on the Servers screen (`docs/superpowers/specs/2026-10-20-a917-box-local-name-design.md:550-554`); this page links to it | A917's |
| **Reiniciar / Apagar** | Restarts or shuts down the box, after a confirmation that names what stops (sales, the tills) | `system.manage` |
| **Acceso de mantenimiento** | §11 | admin only |

**The time instant and the time zone are separate.** The owner's clarification (2026-10-21
~23:30, recorded at `~/waitron-campaign/archive/questions-to-2026-10-23.md:4517`) says you choose the
venue's time zone through its administrative area at setup, using that area's country-pack default,
and edit it later in the dashboard's venue details. The setup UI writes
`area?.timeZone ?? selectedPack.defaultTimeZone` (`apps/setup/src/screens/venue-screen.ts:646`);
the server checks the same derivation (`apps/server/src/setup-api.ts:435`, `:454`, `:490`). Venue
details renders a time-zone field (`apps/dashboard/src/screens/venue-details-panel.ts:542`). Today
that edit is conditional: the server refuses it after sales, orders, daily closes or business-day
cutover history (`apps/server/src/venue-details.ts:94-113`, `:241-259`). This clarification does not
remove those limits. Choosing the venue's time zone is separate from setting the clock's time instant.

**No hand-set clock means no typed time instant, not a ban on choosing the time zone.** The owner's
answer recorded "also the clock" as a setting
(§18 Q2 follow-up, as the watcher wrote it down). A798, whose design the owner approved, decided the
opposite: "**No 'set the clock' action anywhere in Waitron**: a clock a page can set is a way to date
sales at will" (`docs/superpowers/specs/2026-10-19-a798-degraded-trading-design.md` §6, "Decisions
revision 5 makes", decision 10).
**My call: A798's decision stands**, and the page shows the clock without setting it. Every install
now sets the clock from network time (§5.4), and the battery clock keeps it through a power cut, so
the case A798 left to "whoever installed the box … from the operating system"
(that design's §4.8 b) no longer needs a terminal. If the owner wants a hand-set clock after all, it is A798's
decision to reopen, not this page's. This paragraph records the 2026-10-21 reasoning; the dated
A798 update below records the subsequent decision.

_2026-10-24: the owner reopened it for A798 (design revision 7, §4.9). The box now sets its own
clock from AEAT's time, two agreeing tills, or an administrator's own phone or computer — never a
typed time — through this design's host service (§8), whose first requests A798-B slice 9b builds.
«Hora» still offers no typed time._

**No hotspot after setup.** The owner's hotspot answer was about the install — "At that stage we're
not protecting anything" (§18 Q5) — and the installer's hotspot (§5.3) never leads to the setup
wizard: it is the installer's own page, and Waitron is not yet on the disk. Once a box holds a
venue, an open network that anyone in the street can join, whose page moves the box onto another
Wi-Fi, would let a passer-by cut the tills off from the box (CLAUDE.md §5: "a till needs the
venue's PRIMARY"). So **a set-up box opens no network of its own**; its Wi-Fi changes through
**Red** above, from the box's screen or any device still on its network, or after plugging in a
cable. **My call**; §17 lists the case it leaves (a wireless-only box with no screen whose router
changes).

_2026-10-26 ~14:00 CET: the owner accepted a minimal unencrypted copy of the NORMAL Wi-Fi
join settings for preboot recovery (§7.5). Red's host operation updates it on every Wi-Fi change
and removes it when you choose cable-only. This adds neither a recovery SSID nor an unlock hotspot.
If the saved profile cannot join, cable/local display remains the fallback; no wireless recovery
promise follows from merely saving the password._

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
  **A box with no screen** needs one plugged in for console maintenance. Disk recovery instead
  has the local and headless preboot screen paths of §7.5.

The record recommended a password per box on a sealed card
(`docs/superpowers/specs/2026-09-11-box-maintenance-and-remote-support.md:39-41`) and warned that an
unauthenticated recovery page "must not itself grant administrative access" (`:92-96`). This design
keeps that: the password is handed out only to an authenticated admin, and the LAN recovery page
(`apps/server/src/recovery-surface.ts:28`) offers nothing of it.

## 12. Setup, and Prepare to fresh Live on the same box (W60, B3r)

**Proposed design, revised 2026-10-26.** The owner's Q2 answer is settled, not a choice to ask again:
"we shouldn't use the usb for this. We can run it from the box itself."
(`~/waitron-campaign/archive/questions-to-2026-10-23.md:4514-4519`, Q2 and its two clarifications).
Pictures 10 and 11 show this path; the old two-option picture is superseded (see the
pictures' README). The USB reinstall of §5 remains a separate, physical rebuild path.

### 12.1 Which modes a box offers

- **A box started in production:** only «En vivo» and «Ya tengo un restaurante» (restore a backup,
  or become a spare box, A947). Demo and Prepare are not drawn. The refusal
  `sif.throwaway_allocation_refused` gets its own words for a request that reaches it anyway.
  This retains W60's production rule; hiding a choice is not the server's environment check.
- **A blank stick-installed box:** Prepare, Live and «Ya tengo un restaurante», never Demo. It
  starts unprovisioned and preproduction, not production. The installer marker describes the
  available setup paths, not permission to change an existing database's environment. Selecting
  Prepare creates a practice venue; selecting Live follows fresh Live setup. A hand-installed
  preproduction box keeps its existing Demo/Prepare choices.
- **A prepared box:** an admin starts the same-box re-setup below. A fresh Live database receives
  only the allowed configuration. No practice sale, invoice number, counter or fiscal chain crosses.
  The standard/full/rectificative series *codes* are configuration defaults (§12.3), not retained
  invoice numbers or chain identity. A Live or restored production venue is never eligible for this
  action, even if a caller forges a Prepare flag or retries an old request. Reading an existing
  completion receipt is allowed; it cannot start another cutover.

These are proposed B3 rules, not claims about today's mode screen. The current server reads its
process environment and `trading.env` (`apps/server/src/box-env.ts:7`); compose passes no
`WAITRON_ENV` to the app (`deploy/compose.yml:21-45`). The later plan must bind mode checks to the
then-current authoritative deployment state, not a browser marker.

### 12.2 The admin's action: save configuration, then restart first setup

Working label: **«Empezar en Live con esta configuración»**, on the Prepare dashboard. You use it
on the box itself or from an authenticated remote dashboard. It is admin-only, with fresh
reauthentication for this action: password or passkey, plus enrolled TOTP (the authenticator-app
code) when present, as for maintenance access (§11). An existing dashboard session alone is not
enough. A non-admin gets an explanation with admin sign-in there and **Stop**; a Live box gets no
such action, and its server refuses the operation as well.

The confirmation names what you keep, what is removed and what you must reconnect (§12.3). It says
that practice sales and fiscal history will be removed and that Live starts a new venue database.
It offers **Stop** before removal and the explicit start action. It must not promise that
"everything is ready" merely because menus have been saved.

**The proposed sequence and its failure boundary:**

1. **Check before removal.** Check the authoritative Prepare/preproduction state and absence of
   Live/production history, the admin's fresh proof, installed release eligibility for Live,
   module availability and schema versions. Build the allowlisted configuration, decode it again,
   run every participating module's validation, and prove it can import into a fresh disposable
   target without making Live fiscal records. The preview must let you confirm the prospective
   Live venue/language choices before these checks. Close A989's required-language check first,
   using those selected Live languages. A missing/unsupported module, invalid configuration,
   incompatible version, missing translation, insufficient space or unreadable handoff must fail here, with
   practice intact and a reason you can act on. Live's later fiscal-readiness and clock checks
   still apply; this does not authorise changing a Live fiscal writer.
2. **Make the handoff durable.** Save the checked configuration and a pending operation record
   outside every venue-removal path, on the box's existing encrypted disk. The record binds one
   operation id to this box, this source practice venue, the bundle's digest, module versions,
   the initiating admin and the target **fresh Live** intent. Use host-owned encryption keys
   independent of the practice venue's key ring. Reopen and validate the durable copy before
   accepting removal. Keep both the handoff's secrets and the audit evidence outside the venue
   being removed. The existing import staging is not itself this handoff: it writes to `stateDir`
   and wraps the passphrase with the supplied key ring
   (`packages/provisioning/src/configuration-import.ts:21-32`, `:68-85`).
3. **Confirm the accepted first-claim boundary.** No setup grant, resume credential, recovery
   code or private-preview credential is created. After removal the unconfigured box and its
   saved-config preview are reachable by another LAN browser, including after a restart. The
   owner explicitly accepts that someone else might claim that fresh setup first. This does not
   waive the fresh admin proof BEFORE destructive cutover, or disclose the host's disk key.
4. **Stop practice writes, then cut over once.** Under exclusive ownership, stop/drain the practice
   writers and background work, recheck that the admin's proof is still fresh, rebuild and
   revalidate the final snapshot if anything changed since the preview, and bind the confirmed
   digest before removal. A changed snapshot needs a new preview/confirmation, not silent consent.
   Keep a durable cutover state that boot checks before allowing practice work again. Remove the practice venue and its
   runtime queues through the approved reset mechanism, without erasing host identity, network
   settings, the installed system, disk encryption, handoff/disk keys or audit evidence. Isolate
   practice connection settings and credentials, including any retained host-file references, so
   a restart cannot silently reuse them as Live credentials. Do not
   leave old print, email, payment or scheduled work able to run against the new venue. Do not
   relabel or move the old database into production. The precise removal set, stopping order,
   lock ownership and reset calls are the later plan's work after A1042's release; this revision
   selects no reset/locking API and changes none today. Never implement this as deleting a state
   directory that also holds the handoff, its keys or the audit.
5. **Restart into ordinary first setup with Live selected and the saved configuration ready.**
   Local and remote browsers reach the same preview without a new setup/resume credential.
   The old dashboard session is not a new venue's admin account. Review venue/taxpayer defaults,
   create the Live admin, supply missing credentials and complete the usual Live checks and
   recovery steps. Disk-key delivery has its separate protected channel (§7.5); the public preview
   contains no such key. This is new integration, not today's file-upload UI (§12.4).
6. **Finish durably.** Retain the completion receipt and link it into the new venue's audit trail.
   Remove temporary configuration copies and handoff keys only after durable completion, without
   deleting that receipt or the retained disk key. Record who requested and authorised cutover,
   the confirmed digest, phases, refusals/retries and completion in a host-owned audit journal;
   retain linked practice/Live audit records on their respective sides. Never log passwords,
   TOTP, passkey responses, disk keys or existing recovery secrets.

**An interruption retries the operation, not the erase.** Before cutover is durably committed, a
failure leaves practice available; an admin can Stop and discard the pending handoff. Once removal
starts, boot holds practice stopped and resumes the recorded phase without a setup credential.
A power cut after removal but before setup leaves the saved configuration and ordinary first setup
available to the LAN. A cut during fresh Live setup resumes that same setup attempt. Once the new
venue exists,
a repeated request must never remove it; a completion receipt answers the retry. An ambiguous or
corrupt phase stops with retry/Stop choices and retained evidence. It never returns to selling
the old database or performs an automatic second wipe. Valid pending fresh Live is LAN-claimable;
ambiguous state is refused for phase/data safety, not to reserve setup for a private browser.
The plan must bind these phases to the actual A1042 setup/reset ownership APIs and prove every boundary before building the
action. This is only **Prepare → fresh Live**, not a general reset or a Live-box eraser.

### 12.3 What the existing configuration copy carries today

**Source inspection on 2026-10-26, not a test run.** The existing export is available for Prepare
and Live (`apps/server/src/boot.ts:2033-2043`). Its route requires a management session and
`system.manage`, reads the bundle in one transaction, and encrypts it with a supplied passphrase
of at least 12 characters (`apps/server/src/configuration-export-api.ts:35-62`). That export
permission does not authorise the new destructive admin action.

The server re-exports the engine from provisioning
(`apps/server/src/configuration-transfer.ts:1-11`). `buildConfigurationBundle` reads venue details
and current series codes, then calls the table exporter
(`packages/provisioning/src/configuration-transfer.ts:86-151`). The table exporter reads only the
participating modules' explicit declarations; an undeclared contribution refuses export, and
`kind: "none"` contributes no rows (`:178-214`, `:251-329`). Composition wires those declarations
in `packages/composition/src/modules.ts:144-386`, including `MEDIA_MODULE` at `:192`.

The following is the complete declaration inventory at that source revision. Each row describes
what can cross when its module participates; it is not a promise to enable an absent module.
Except for the exclusions below, the exporter reads whole rows, not just the fields named in this
explanation (`packages/provisioning/src/configuration-transfer.ts:286-327`).

| Module / category | Declared configuration tables | Declaration receipt |
| --- | --- | --- |
| Core: menus, kitchen, products, profiles, floor layouts, printers and themes | `catalogues`, `kitchen_stations`, `kitchen_courses`, `categories`, `products`, `location_catalogues`, `ingredients`, `recipe_lines`, `device_profiles`, `floor_zones`, `dining_tables`, `floor_plan_sets`, `floor_plans`, `floor_plan_tables`, `floor_plan_placements`, `floor_plan_table_parts`, `floor_plan_table_sizes`, `print_agents`, `printers`, `page_printers`, `device_profile_printers`, `station_printers`, `custom_themes` | `packages/db/src/configuration-transfer.ts:62-113`; `packages/composition/src/modules.ts:153`, core/theme validators `packages/composition/src/modules.ts:118-124` |
| Catalogue: languages, defaults, units, menu content, options and extras | `category_details`, `content_languages`, `catalogue_settings`, `unit_seed_states`, `units`, `product_units`, `menu_items`, `menu_item_variant_overrides`, `option_lists`, `option_labels`, `extra_lists`, `extra_list_items`, `product_modifiers`, `sections`, `section_members`, `menu_details` | `packages/catalogue/src/configuration-transfer.ts:159-181`; `packages/composition/src/modules.ts:169` |
| Venue service: departments, receipts/sale rules, profile access, kitchen screens/routing, menus/timetables, hours and holidays | `departments`, `service_steps`, `department_receipts`, `department_sale_policies`, `zone_service_policies`, `zone_sale_policies`, `device_profile_service_access`, `device_profile_zones`, `device_profile_kitchen_screens`, `device_profile_kitchen_screen_stations`, `device_profile_kitchen_screen_zones`, `department_transfer_desks`, `department_transfer_destinations`, `routing_cells`, `department_floor_plan_sets`, `menu_periods`, `menu_period_staff_menus`, `routing_cell_periods`, `special_days`, `special_day_dates`, `seasons`, `department_days`, `department_day_ranges`, `zone_days`, `zone_day_ranges`, `holiday_geographies` | `packages/venue-service/src/configuration-transfer.ts:697-728`; `packages/composition/src/modules.ts:186` |
| Media: images, bytes and edits | `media_images`, `media_image_data`, `media_image_blobs`, `media_image_edits` | `packages/media/src/module.ts:13-25`, `:29-38` |
| Identity: people and profile admission rules | `persons`, `device_profile_admission_roles`, `device_profile_admission_persons` | `packages/identity/src/configuration-transfer.ts:1-23`; `packages/composition/src/modules.ts:208` |
| Workforce: employment, availability, pay-period settings, shift templates | `employments`, `availability`, `pay_period_settings`, `shift_templates` | `packages/workforce/src/configuration-transfer.ts:1-9`; `packages/composition/src/modules.ts:227` |
| Workforce Spain: agreement settings | `convenio_config` | `packages/workforce-es/src/configuration-transfer.ts:1-4`; `packages/composition/src/modules.ts:244` |
| Payments: offline policy only | `payment_policy` | `packages/payments/src/configuration-transfer.ts:1-5`; `packages/composition/src/modules.ts:256`; policy columns `packages/payments/src/schema/payment-policy.ts:12-19` |
| Adjustments: reasons and settings | `adjustment_reasons`, `adjustment_settings` | `packages/adjustments/src/configuration-transfer.ts:65-69`; `packages/composition/src/modules.ts:364` |
| Staffing: roles, assignments and planning rows | `staff_roles`, `person_staff_roles`, `staffing_days`, `staffing_blocks` | `packages/staffing/src/configuration-transfer.ts:3-11`; `packages/composition/src/modules.ts:383` |
| No transferred tables: scheduler, credentials, fiscal-verifactu, fiscal-none, bookings | Each declares `kind: "none"` | `packages/composition/src/modules.ts:271`, `:285`, `:313`, `:327`, `:346` |

**Venue defaults travel separately:** country, tax id, legal name, taxpayer domicile; location name,
receipt languages, operation description, fiscal territory, address, time zone, current business-day
start, fire control and default catalogue; and the three current series codes. The query reads
these exact fields (`packages/provisioning/src/configuration-transfer.ts:86-104`). An outstanding
future business-day-start change refuses export; the bundle uses the current effective start
(`:125-132`). It carries neither the old series rows nor their counters. Staffing planning rows
are in the allowlist, even if dated; there is no general date filter in the table export (`:286-329`).
They need review as configuration, not a promise that the Live diary starts empty in every module.
Only the settings in this inventory travel; it is not a copy of all application or host settings.

**What is excluded, stripped or disabled:**

- Retired device profiles, inactive kitchen stations/courses and floor zones, deleted printers,
  and inactive departments are left behind by their declarations
  (`packages/db/src/configuration-transfer.ts:67-104`,
  `packages/venue-service/src/configuration-transfer.ts:700`). Rows whose database foreign keys
  reach left-behind rows are removed too, repeatedly
  (`packages/provisioning/src/configuration-transfer.ts:311`, `:428-461`). This is not a general
  "active rows only" filter: product rows, for example, have no leave-behind selector.
- Person PIN/password hashes, TOTP secrets, email-verification time, Google subject, pending email
  and its folded form, and passkey-offered time are omitted
  (`packages/identity/src/configuration-transfer.ts:6-18`). Names, current email, roles and other
  unomitted person fields remain. Import skips the exporting operator and every row with their
  `person_id`; it preserves the newly provisioned admin and gives other imported people new ids,
  unusable PINs, no password/TOTP/Google link, no verified-email state and **suspended** status
  (`packages/provisioning/src/configuration-transfer.ts:695-740`). Passkey registrations and login
  sessions are not in the declaration inventory. Staff must be reviewed, reactivated and given
  fresh credentials/enrolments; the exporting admin is created through Live setup, not copied.
- Print-agent token hash, last-seen time, host, source node id, setup URL and port are omitted;
  printer poll-token hashes are omitted (`packages/db/src/configuration-transfer.ts:91-106`).
  Non-empty agent/printer/page-printer tables are flagged for reconnect (`:97`, `:103`, `:106`;
  engine `packages/provisioning/src/configuration-transfer.ts:327`). Import sets agents and both
  printer kinds **inactive**, gives agents unusable tokens, and clears page printers' agent id
  (`:741-747`). Review mappings, reconnect/re-enrol agents and printers, then enable them; staying
  on the same hardware does not retain their venue credentials.
- Product name keys, dining-table clearing state and short-name keys are omitted; import rebuilds
  the product/table keys through the modules' `afterImport` hooks
  (`packages/db/src/configuration-transfer.ts:74`, `:83`, `:112`,
  `packages/catalogue/src/configuration-transfer.ts:180`,
  `packages/provisioning/src/configuration-transfer.ts:771-773`). New row ids and declared
  references/location columns are remapped (`:708-730`).
- Actual devices and their pairings, card readers/provider registrations, backup destinations,
  Cloud/mail connections, fiscal certificates, recovery secrets, sales/orders, invoice numbers,
  fiscal records/chains, operational jobs, booking records and audit history are not copied by
  this allowlist. Device **profiles**, printing definitions and payment **policy** do cross;
  enrolments and connections must be redone. The no-table declarations above exclude credential,
  fiscal, scheduler and bookings rows. The retained host audit in §12.2 is separate evidence of
  this action, not an import of the practice venue's business history.

**A989 remains OPEN and blocks destructive re-setup.** Catalogue validation checks units, colours,
menus and duplicate names (`packages/catalogue/src/configuration-transfer.ts:77-157`), but does not
run the required-language check `content.language_required`. The engine's validator dispatches
only the declared module validators (`packages/provisioning/src/configuration-transfer.ts:587-610`). Media's own default-language
image-name check (`packages/media/src/configuration-transfer.ts:60-67`) does not close the catalogue
required-language gap. Do not claim the existing copy is ready for this action: A989 must close
the language gap before step 1 can pass, and every participating module must pass its own readiness/import checks before
removal. This revision neither fixes A989 nor expands the allowlist.

### 12.4 Today's import/prefill, and what you still redo

Today you select an encrypted export file and its passphrase on Live's source screen
(`apps/setup/src/screens/live-source-screen.ts:121-134`, `:147-185`). The setup endpoint stages it
(`apps/server/src/setup-api.ts:1475-1496`); boot selects modules and validates module schema versions
before staging (`apps/server/src/boot.ts:1271-1279`). Staging decodes and validates before writing
private files and returns venue defaults, non-empty table counts and reconnect flags
(`packages/provisioning/src/configuration-import.ts:68-86`). The UI merges those defaults, excluding
the source location id, into its draft (`apps/setup/src/setup-app.ts:1822-1837`). Its preview shows
counts and reconnect names and asks whether the taxpayer is the same or new
(`apps/setup/src/screens/configuration-preview-screen.ts:45-78`); a new-taxpayer choice clears the
taxpayer fields before the admin step (`apps/setup/src/setup-app.ts:1850-1866`). These are defaults
to review, not completed Live setup.

Both server provisioning paths call the importer inside the new venue's transaction
(`apps/server/src/boot.ts:1363-1386`,
`packages/provisioning/src/first-setup-command-deployment.ts:321-337`); the command path rechecks
bundle digest, country/taxpayer and module versions (`:73-95`). The importer revalidates and replaces
the declared configuration rows, preserving the new admin (`packages/provisioning/src/configuration-transfer.ts:614-621`,
`:695-719`). Its final location patch writes only fire control and the mapped default catalogue
(`:154-165`, `:764-770`), leaving the other details as the reviewed provisioning request wrote them.
The saved time zone is a prefill, not a bypass of setup's country/area check (§10).

For the new same-box path you still create the Live admin and credentials, confirm the real
venue/taxpayer/address/receipt-language and series defaults, supply Live's fiscal certificate and
complete its ordinary readiness, clock and recovery-sheet steps. Configure Live mail, backups and
Cloud as needed; re-enrol till devices (including the box's own till), card readers and print
agents/printers, check their profile/mapping assignments, and reactivate staff with fresh credentials.
The OS, its network and disk encryption remain installed. Fresh Live's recovery sheet includes
the SAME disk key and UUID from the retained host record (§7.5), through protected delivery.
No practice sale or chain is a starting point for Live.

### 12.5 First LAN claim is accepted (W60 closed in part)

The owner explicitly dropped the setup code on 2026-10-26 ~12:15. Generate none; write none to
stick, disk or banner; request none for setup, naming, claim, adoption, restore or preview. Remove
same-box setup-only grants, resume/recovery codes and private-preview restrictions introduced
solely to stop another browser claiming fresh setup. This includes pending fresh Live after a
restart. The accepted cost is that another person on the LAN can view the allowed configuration
and claim an unconfigured box first. W60's production-mode restriction (§12.1) is independent and
stays. Modes depend on authoritative deployment state, not possession of a credential.

Existing fiscal/recovery credentials, operation consistency/ownership checks that protect fiscal
state, and §7.5's internal disk-delivery capability remain distinct. Trace those consumers after
A1042's release: do not remove a fiscal safety check by treating its name as a setup code, and do
not retain or recreate first-claim privacy under an internal-capability label. No unauthenticated
setup/status/preview response carries the disk key. The internal capability authorises only its
protected document render, never ordinary setup access.

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
   no virtual TPM, and expects both refusals with the disk untouched (§7.7). It checks separately
   that a blank stick box offers Prepare/Live/existing-venue paths without Demo, while a
   production-started box offers neither Demo nor Prepare, including direct-request refusals (§12).
   **The proposed same-box acceptance** then prepares the stick-installed VM, saves representative
   configuration from every participating module, records practice sales, and runs the admin action
   without a USB attached. It must reach ordinary fresh Live setup with saved-config preview, a new
   database and no practice sale, invoice number, counter or chain. Assert the copied categories,
   stripped credentials, suspended staff, inactive printers and missing physical-device enrolments
   of §12.3, not only menu counts. The managed console, remote browser and unrelated LAN browser
   must reach pending fresh Live after restart without setup credentials. A forged console marker
   grants no host authority or disk key. A completed-operation replay removes nothing. Non-admin, stale reauthentication, Live
   source, missing module, version mismatch, required-language refusal and broken/unreadable handoff
   must fail before removal. Interrupt each durable phase of §12.2, including immediately after
   removal and during Live setup; assert retriable phase continuation, audit continuity and no second
   wipe of the newly created venue. Record OS/disk/encryption identity before and after. Assert no
   generated setup codes on stick/disk/banner, no setup-only grant requirement, correct key/UUID
   on first/later/restore/spare sheets, protected first delivery without a pre-existing admin,
   fresh admin proof for later copies, and key absence from logs/exports/backups/bucket. Exercise
   the approved preboot screen on local display and a headless LAN client, including shared
   backoff, both redirect entry routes, trusted-only key entry, minimal normal Wi-Fi copy/update/
   removal and failure fallback, wrong-disk refusal, teardown, changed-startup warning and reseal
   refusal. Real Android Chrome controls in §7.5 remain a separate required release gate. These are
   acceptance requirements for the build, not experiments run by this docs revision.
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
(`docs/superpowers/specs/2026-10-21-a940-declaracion-responsable-design.md:501-503`). Once the stick
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
   box by a reinstall from the stick. The 2026-10-26 revision adds only Prepare-to-fresh-Live
   re-setup without reinstalling (§12); it does not close that entry's wider reset/certificate
   questions, and adds no Live reset path.
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
   `docs/superpowers/specs/2026-10-21-a947-two-box-failover-design.md:905-906`); A947 also has the
   spare show a banner "on its own status page and on any screen attached to it" (`:443`).
9. **For A917:** its naming form is "an unauthenticated plain-HTTP write, acceptable for the same
   reason setup itself is: an unclaimed server can be set up by anyone on its network"
   (`docs/superpowers/specs/2026-10-20-a917-box-local-name-design.md:596-598`). That first-claim
   posture remains after §12's owner change; do not add a setup code to the naming form. A917's
   separate scheduling/approval limits remain its own.
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

**Q2 about practising was answered 2026-10-21 ~23:30.** Practise on the SAME box in Prepare,
then an admin saves configuration and restarts fresh Live setup from the dashboard, without USB or
OS/disk/encryption reset. The owner also clarified that the time zone is chosen through the setup
area and editable in venue details; no typed clock time is implied. Maintenance needed no change.
Receipt: `~/waitron-campaign/archive/questions-to-2026-10-23.md:4514-4519`. The previous alternative
of another practice machine or a USB reinstall is superseded, not an open approval question.

**Approved with changes, 2026-10-26 ~12:15.** The owner said: “We don't need the configuration
code. It's not a concern. The rest approved.” This supersedes the earlier revision's general
approval question. No setup code or private same-box setup grant remains; LAN first claim is an
accepted risk (§12.5). Every later recovery sheet carries the disk key, and restore/spare have
a disk-key page (§7.5). Disk unlock is a Waitron preboot UI on local display and LAN, never a
terminal. The proposed retained-host-copy choice costs protection against privileged running-host
compromise; it is not key erasure after handoff. Fresh admin reauthentication before destructive
cutover is retained.

**Unlock policy answered, 2026-10-26 ~13:45 and ~14:00 CET.** The owner chose direct HTTP
redirect from locked `waitron.local`, plus an intentionally untrusted HTTPS redirect-only entry
there, with that single warning accepted. Key entry stays on the verified trusted per-disk unlock
hostname, whose full URL and fingerprints stay on the sheet. The owner then answered “Yes that's
fine” to copying the normal Wi-Fi SSID/password to unencrypted boot, with physical extraction risk
accepted, a theft/password-change instruction and running-host update/cable-only removal (§7.5).
Cable/local display remain; no separate recovery SSID or unlock hotspot. Receipt:
`~/waitron-campaign-f/questions.md`, the two OWNER ANSWER sections beginning at line 886.
These answers supersede the earlier A/B/C picker and its pending-policy language. The retained
2/4/8/16/32/60-second shared backoff is a plan proposal, not an explicit numeric owner choice.
`question.txt` is now an FYI. Ask no new
approval question unless review or Android results require changing the approved behavior.

Planning slices 1, 2, 3, 5, 6 and 8 is authorised. No unlock-policy answer is outstanding.
Building needs a separate go-ahead, and this revision
does not close A989, A1042/API binding, A940/release or actual Linux/TPM/firmware qualification gates.
Android Chrome qualification is UNVERIFIED / NOT RUN, with historical negative evidence and the
affected trust design/release held for requalification (§7.5); no Android safety claim is approved.

## 19. Build order, one pull request each

1. **The ready-made disk** — `mkosi` build of §6, §7 and §8 in CI on every change to its inputs,
   with dracut, the hook of §7.2 item 3, the first start's sealing and test restart, the recovery
   key's creation/root-only retained record, the preboot UI/redirects/minimal Wi-Fi reader (§7.5), and the name tag's format (§7.6; the host service that writes it is slice 3);
   booted in a virtual machine with a virtual TPM to `/setup-api/status` 200 and a screenshot. Runs
   §7.2's experiments (a), (b), (d), (f), (g), (i).
   Measures:
   the compressed size, SQLite on btrfs, a rollback of `@volumes` with `@logs` mounted inside it on
   the encrypted disk, the cost of re-encrypting on first start (§7.3), and a stick-installed box's
   files against a hand-installed one's. Not yet published.
2. **The installer stick** — §5 whole: the three guards, the 60-second wait and the disks it will not
   erase unattended, the Secure Boot and TPM refusals, the network and its hotspot, the download and
   its checks, the status page, no writes to the stick and no setup credential generation; booted end to end in CI
   with Secure Boot on, including a restart with the stick left in. Measures the install time and
   the stick's size.
3. **The box's screen, host service and network** — `cage` and Chromium (§9), the host service's
   socket (§8), the start-screen setting, «Usar esta pantalla como caja», «Panel» and «Volver a la
   caja», the traps of §9, the first-start failure page (§7.3), writing the name tag (§7.6), and
   Settings → Red (§10), including the minimal Wi-Fi boot-copy update/removal (§7.5) — in the
   go-live minimum because a box installed over a phone's connection has no other way onto the
   venue's network but a cable (§5.3).
4. **The rest of the box's settings and maintenance access** — §10's other rows and §11.
5. **Publishing per release** — §13 steps 3–5, after A940's release slices.
6. **On the real box** — the first install on the chosen model: Secure Boot, the TPM, the boot-menu
   key, guard 1 and guard 3 on its firmware, the clock, §7.2's experiments (c), (e) and (h), the traps,
   a power cut with the stick put back in.
7. **The release check** — §14's service, handed to A950.
8. **Setup and same-box Prepare → fresh Live** (W60, B3r) — §12: no setup code, grant or private
   resume restriction; distinct production/stick mode rules; refusal wording; retained disk-key
   delivery on first/every later sheet and restore/spare page (§7.5). Includes the
   admin-only, freshly reauthenticated dashboard action, complete copy/reconnect disclosure,
   pre-delete module/import validation with A989 closed, host-owned encrypted configuration handoff independent
   of removed venue secrets, LAN-claimable pending fresh Live, audit continuity, retriable cutover and the refusal to erase a Live venue. Carry §13's failure
   and interruption acceptance into the plan. Bind reset/locking and setup-attempt APIs only after
   A1042's release, tracing their then-current consumers; this revision changes none. Reuse the
   ordinary fresh Live fiscal setup without changing a Live fiscal writer. If that binding would
   require fiscal changes, stop and obtain the separate fiscal authorisation before that work.

**The go-live minimum is slices 1, 2, 3, 5, 6 and 8.** A Live box runs only a release (A940 §5.1),
so the first venue's box is installed from the first release tag, which waits for A940's release
slices; encryption is in slice 1 because the owner wants it before go-live; the box's screen is the
counter till at a one-box venue (A947 §6.6 calls the counter till "often the main box's own screen",
`docs/superpowers/specs/2026-10-21-a947-two-box-failover-design.md:878`); and slice 8 puts the retained disk recovery key on every required sheet and covers the owner's
same-box Prepare-to-Live path without setup credentials. Slice 8 must include the fresh-
authentication check it needs even
though the maintenance-login feature itself remains in slice 4. Slices 4 and 7 follow. Slice 8
changes mode admission, disk-key delivery and removes practice data, so it takes the full review. This design
authorises no change to Live fiscal writers; any such discovery is a separate fiscal gate.
Planning is approved, not a build. Unlock reachability/Wi-Fi policy is settled (§18); the retained
backoff remains a proposal. Slices 1/3/6/8 must qualify the concrete preboot paths and Android
controls in §7.5 before release, preserving the historical failed constraint receipt.
Docker is unavailable on the author's machine until 2026-11-03 (task constraint); real Linux/VM
and hardware evidence remains a future gate, never replaced by mocked success or publication of
an unqualified boot image.

## 20. What this design does not settle, for the builder

- The exact registers, the hook's register, and the temporary seal or the predicted values that
  replace it (§7.2, §7.4) — by experiment, against the acceptance list.
- How a change to register 7 itself (Microsoft's newer certificate) is taken without a person
  present (§7.4).
- How the box's screen service tells Waitron which page to open, and how the box's screen marks
  itself (§9). The forgeable display marker is never proof for host actions or disk-key delivery.
- The durable encrypted configuration handoff and reset/ownership API binding after A1042's
  release (§12.2). The plan must prove LAN-claimable pending fresh Live and no second erase,
  without reintroducing setup/resume credentials.
- The exact protected first-disk-sheet integration before publication, later admin reauthentication
  and host storage implementation (§7.5), with the correct disk UUID on restore/spare.
- §7.5's concrete preboot network, redirects, TLS trust/bootstrap, minimal Wi-Fi update/durability,
  disk checks and memory lifetime need qualification under the settled owner policy. Shared
  backoff numbers remain the retained proposal. The normal server key and CA signing key stay
  encrypted; only the separate recovery/redirect leaf keys and minimal normal Wi-Fi join copy
  are available before unlock. Android controls are UNVERIFIED / NOT RUN, with release held.
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

_2026-10-26 pointer: P1–P59 below retain their original source/provenance bodies as dated
evidence, not fresh execution results. §7.5/§18 contain the current unlock/Wi-Fi policy and trust
qualification limits wherever an earlier reading would imply only encrypted credentials or a
qualified Android trust boundary._

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

### Primary-source bounds checked for the 2026-10-26 recovery revision

These quotes describe interfaces and trust steps, not a qualified Waitron recovery service.

| # | Source's own words | Consequence for the proposed design | Source |
| --- | --- | --- | --- |
| P60 | “Additional password agents may be implemented according to the systemd Password Agent Specification” | A graphical agent is an integration to build and qualify; a default terminal prompt is not the proposed UI. | [Debian 13 systemd-ask-password](https://manpages.debian.org/trixie/systemd/systemd-ask-password.1.en.html), retrieved 2026-10-26 |
| P61 | “only writes configuration” | Early network configuration alone does not start networking; qualify the installed dracut/NetworkManager service combination. | [NetworkManager nm-initrd-generator](https://networkmanager.pages.freedesktop.org/NetworkManager/NetworkManager/nm-initrd-generator.html), retrieved 2026-10-26 |
| P62 | “that certificate isn't automatically trusted for SSL” | The new-device iOS flow needs explicit trust installation; downloading a certificate does not demonstrate trust. | [Apple certificate-profile trust](https://support.apple.com/en-us/102390), retrieved 2026-10-26 |

### Repository receipt retained for Android requalification

| # | Receipt's own words | Current scope and consequence | Source |
| --- | --- | --- | --- |
| P63 | “a cert for a name OUTSIDE the root's permitted subtree”; “a clean padlock (HTTPS 200)” | One actual Android phone accepted the CA-signed outside-subtree control on 2026-09-08; versions were not captured. Historical negative evidence, not a hostname-mismatch result or current-device pass. §7.5 requires actual-device controls and holds the affected trust design/release. | Literal commit `75f17f9e36125af3a620266a584507420e7197de`, message and doc diff; current pointer `apps/server/src/self-signed-cert.ts:29-33`. No live link to the removed spike document. |
