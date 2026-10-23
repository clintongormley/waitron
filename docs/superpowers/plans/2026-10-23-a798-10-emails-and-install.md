# A798-B slice 10 — emails about the box, `reader.offline`, the printer notice, and `waitron.sh`

> **No migration.** Nothing in this slice adds or changes a table, an index or a trigger.
>
> **Nothing fiscal.** No task touches an invoice, the record chain or its hashes, invoice series or
> numbering, or AEAT filing. The email duty reads the enabled modules' staff notices through the
> existing seat, read-only, the way the till's equipment read already does. The slice lands itself
> (build plan Part 1, row 10).
>
> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use
> checkbox (`- [ ]`) syntax. Each task is test-first: write the failing behavioural test, run it,
> watch it fail for the stated reason, then the minimal implementation. Implementers are dispatched
> as `subagent_type: "implementer"`. The tasks run in their numbered order; every commit leaves the
> root guards green.
>
> **Existing assertions.** This plan changes exactly two things in existing tests, both in
> `scripts/staff-notice-codes.test.ts`, declared here so no implementer has to decide them:
> 1. `:49`, the params `wordedAsUnknown` hands `staffNoticeText`, `{ count: 2, held: 0 }`, gains
>    `printer: "Kitchen", since: "2026-10-23T19:16:00.000Z"` (Task 2). This is a fixture, not an
>    assertion: it is the input the guard words each code with, and it lacks what the printer notice
>    needs. Adding what a fixture lacks is allowed by the owner's rule, and no expected value
>    changes. Without it the guard fails on the printer notice even when the till words it (P3).
> 2. `:65-70`, the `expect.arrayContaining([...])` of "finds the notice codes it is meant to guard",
>    gains `"printer.jobs_waiting"` (Task 3). A list that pins a whole shape gains one entry and every
>    existing entry stays: the owner's standing exception (2026-09-27, about 19:10). It also makes the
>    guard prove it finds the new code.
>
> Each goes in its own commit whose message begins `Changed test checks (A798 slice 10):` and names
> the `file:line` with its before and after, and the pull request names both. Everything else this
> plan touches in existing tests is new cases, mocks, type arguments of a test cache, or helpers.
> Any other assertion that turns out to need changing is a STOP: report it, do not edit it.
>
> **Size.** Each task is sized for one implementer well under 100 tool calls. An implementer past
> about 150 calls with the task unfinished stops at a passing or cleanly red point, commits, and
> returns a handover: done, left, files, each check's state.
>
> **Base.** Every `file:line` below was read at `main` `20be7ebb5` (2026-10-23), this branch's base
> after its rebase (`feat/a798-10-emails-and-install`, worktree
> `waitron-feat-a798-10-emails-and-install`); that base holds slice 8 (#2012, `bbd01f65e`). Every
> claim about how the box, Docker or a host behaves today cites a probe in "Measured for this plan",
> run on macOS (Darwin 25.6.0), Node v26.11.1, Docker 29.3.0 (Docker Desktop) unless the probe says
> otherwise: scripts and logs under `~/waitron-campaign-b/a798-10-plan-probe/` (revision 2's under
> `r2/`), the first round's Vitest probes in a throwaway worktree of `3d4a2a4ce`, since removed. A
> claim marked **(read)** comes from reading code, not running it. Nothing was measured on a real
> box's Linux.
>
> **Revision 3 (2026-10-23)** folds in the round-3 check (`~/waitron-campaign-b/a798-10-plan-review/round3.md`,
> 0 Critical, 3 Important, 7 Minor) as the lane's driver ruled; see "Round 3 findings folded" at the end.
>
> **Revision 2 (2026-10-23)** folds in the fresh-context review
> (`~/waitron-campaign-b/a798-10-plan-review/round1.md`, 0 Critical, 4 Important, 8 Minor) and the
> claim check (`…/a798-10-plan-review/claim-check.md`, 0 Critical, 2 Important, 5 Minor), as the
> lane's driver ruled: the branch rebased onto `main` and every citation re-read; the clock-behind
> email is slice 9's (decision 9, Task 14); every refused send is retried each minute (decision 7);
> English names in every test; the printer notice goes once the printer prints a later document
> (decision 18); the Docker step measured on both image stores (decision 15, P10); and every Minor.
> The disposition of each finding is in "Review findings folded" at the end.

**Words used in this plan.**
- The **stop** is slice 3's full-disk stop, `DiskFullState` (`apps/server/src/disk-full-state.ts`):
  `since()` is not null while it is on.
- The **warning** is slice 5's low-space state, `FreeSpaceState` (`apps/server/src/free-space-watch.ts`):
  `current().lowSince` is not null from a reading below 2 GiB until one at 2.5 GiB or more.
- A **notice** is one staff notice (`StaffNotice`, `packages/module/src/staff-notices.ts`), shown on
  the till's strip. An **owner** is the name a notice source is filed under; the till keeps an owner's
  last notices when its check fails (`nextNotices`, `apps/till/src/state/staff-notices.ts:23-37`).
- A printer is **in trouble** when one of its document jobs has waited two minutes without printing,
  or failed with no tries left, until a job standing in for it has printed, as `printJobInTrouble`
  decides (`apps/server/src/print-job-trouble.ts:38-78`, its doc comment `:24-37`); the bell's
  `printer.jobs_waiting` reads it, unchanged by this slice.
- A printer is **stuck** when one of its jobs in trouble has no later document job on the same
  printer that printed (decision 18). The till's printer notice reads this; the bell does not.
- A **kitchen printer** is one an active kitchen station prints to (`station_printers`,
  `packages/db/src/schema/station-printers.ts`; `kitchen_stations.active`).
- The **duty** is the new minute check that sends the emails; an **episode** is one spell of one
  emailed condition, from when the duty first sees it until it ends (decisions 6–8).
- A **managers' address** is the email address of an active person whose role holds
  `system.manage`, as the certificate reminders choose them
  (`apps/server/src/certificate-reminder-worker.ts:61-87`).

**Goal:** the managers get one email per episode when the box's disk drops below 2 GB, when it is
full, and when its clock is set before 28 October 2024, retried each minute until the mail server
accepts it; the bell says when a card reader is offline; every till and handheld shows an amber
line while a kitchen printer is stuck, and a device whose receipts go to a stuck printer shows it
too; and `waitron.sh install` switches on the host's time synchronisation where the system provides
it, says so either way, and deletes the images the box ran before an upgrade once the new ones are
healthy, where Docker has not already freed them.

**Architecture:** five pieces, each small.
1. **Printer notices** (Tasks 1–4): `printersInTrouble` (`print-job-trouble.ts`) lists each active
   printer in trouble with its oldest job, the oldest job that makes it stuck, and whether it is a
   kitchen printer; the bell's printing source and a new per-device notice source both read it. The
   equipment read (`GET /api/device/equipment`) gains a per-device source list (`deviceSources`),
   because a notice source's context names no device (`StaffNoticeReadContext`,
   `packages/module/src/staff-notices.ts:17-24`). The till words the new code.
2. **`reader.offline`** (Task 5): the battery check keeps the provider's whole status answer and
   raises `reader.offline` when the provider says the reader is offline.
3. **Shared email pieces** (Task 6): the managers' address list and a plain-text sender moved out of
   the certificate reminders, and the email settings read inside a caller's transaction.
4. **The email duty** (Tasks 7–11): `apps/server/src/box-alert-email.ts` checks every minute, works
   out which episodes are on from the stop, the warning and the modules' notices, and sends each
   recipient each episode's email once, in their language, with words from
   `apps/server/src/i18n/box-emails.ts`. Its database reads run in a write-lock turn with no drain,
   so the full-disk email can be prepared on a full disk. Boot starts it in trading mode.
5. **`deploy/waitron.sh`** (Tasks 12–13): `enable_time_sync` and `delete_previous_images` in
   `cmd_install`.

**Tech stack:** TypeScript, Hono, Vitest 4 (Node for `apps/server` and the root guards; real headless
Chromium for `apps/till` and `apps/dashboard`), bash under the stubs of `scripts/waitron-sh.test.mjs`.

**Spec:** [A798 — Degraded but trading](../specs/2026-10-19-a798-degraded-trading-design.md),
revision 6. Build plan: [2026-10-21-a798-b-degraded-trading-build.md](2026-10-21-a798-b-degraded-trading-build.md)
Part 1, row 10: "Emails (all but the clock-behind one, which is 9's), `reader.offline`, the printer
notice, `waitron.sh` | none | LIGHT | no | **lands itself** | 5, 6" (`:82`), built before slice 9,
which sends the clock-behind email "through the once-per-episode sender slice 10 builds for its own
emails" (`:118-122`). Backlog: A798-B (`docs/backlog.md:4631`), "The card readers row does not say
whether a reader is switched on" (`:4710-4711`), "The open notice list cannot be scrolled from the
keyboard once it overflows" (`:4790-4793`) and "The Clock row says 'connect the box to the internet'
where that may not help" (`:4683-4686`), each of which names slice 10.

### What the design asks for, in its own words

- §8 item 10 (`:1248-1251`): "Emails for the red conditions and the 2 GB disk warning,
  `reader.offline`, the printer notice (question 2), and in `deploy/waitron.sh`: deleting old Docker
  images after an upgrade, and switching on the host's time synchronisation at install where the
  system provides it, printing a line when it does not (§4.8 b). _Risk: none listed._"
- §4.3, Email (`:508-511`): "The red conditions (disk full, clock before 28-10-2024), the 2 GB disk
  warning, and a clock behind the chain email everyone with `system.manage` and an email address,
  once per episode (§6, default 7). 'Once per episode' is held in memory: a restart during an episode
  may send one more, which keeps the build free of a new table (§7)."
- §6 default 7 (`:1069-1071`): "Email the managers for the red conditions, as for the AEAT
  certificate … The 2 GB disk warning is emailed too, by the owner's answer to question 1."
- §6, revision 5 decision 15 (`:1159-1160`): "The email is retried each minute until sent once, so a
  box with no internet sends it when the connection returns." §4.8 c (`:857-859`): "The one-minute
  watch (part d) tries again each minute until the stop's one email is accepted by the mail server."
- §4.3, `reader.offline` (`:492-493`): "`reader.offline` (warning): '{reader} está sin conexión.' /
  '{reader} is offline.' — the check already gets this answer and ignores it (§2.4)." §4.4
  (`:526-527`): "No new staff notice … The manager gets `reader.offline`."
- §4.2's table (`:459`): "Amber | One of a printer's tickets has waited two minutes (question 2) |
  Impresora Cocina no imprime · desde 21:16 | Kitchen printer not printing · since 21:16". §4.2
  (`:438-440`): the strip "goes when the problem goes". §4.2 (`:445-447`): "The core supplies the
  disk and printer notices". §4.4 (`:522-525`) and the owner's answer to question 2 (`:1271-1274`):
  "From two minutes every till and handheld shows the amber strip …; a receipt printer only on the
  devices whose receipts go to it; the sending device's own table banner stays as today." Question 2
  (`:1279`): "'Stopped printing' means what it means today: one of the printer's tickets has waited
  two minutes."
- §4.8 b (`:718-724`): "Nothing in `deploy/` turns that on today … So the build adds it to
  `deploy/waitron.sh install`, which is already run with `sudo` on the host …: it switches on the
  host's time synchronisation where the system provides it, and prints a line when it does not."
- §2.6 (`:324-325`): "old Docker images left by upgrades, which nothing in `deploy/waitron.sh`
  deletes (grep for `prune`, `rmi`: no match)". §4.6 item 6 (`:603-605`): "Deleting old images after
  an upgrade is a follow-up for `deploy/waitron.sh` (slice 10)."
- §10 (`:1384-1388`): time synchronisation in the box image is B3's; "this design only switches
  synchronisation on at `waitron.sh install`".
- The clock-behind-the-chain email (§4.8 c) is slice 9's: build plan row 9 and `:118-122`; backlog
  "The clock stop's email is slice 9's" (`docs/backlog.md:4651-4655`). This slice builds the duty
  slice 9 sends it through (decision 9).

---

## Measured for this plan

Logs and scripts are under `~/waitron-campaign-b/a798-10-plan-probe/` (revision 2's under `r2/`).
Vitest probes ran with `env -u AI_AGENT -u CLAUDECODE … --silent=false` in a throwaway worktree of
`3d4a2a4ce`, each probe file restored with `git checkout` after its run. The rebase to `20be7ebb5`
changed none of the code those probes read (`git diff --stat 3d4a2a4ce 20be7ebb5` over
`device-api.ts`, `box-staff-notices.ts`, `alert-sources.ts`, `print-job-trouble.ts`,
`deploy/waitron.sh`, `scripts/waitron-sh.test.mjs`, `certificate-reminder-worker.ts`,
`email-delivery.ts`, `notice-strip.ts` and their tests: no lines), so their results stand.

- **P1 — baselines, no edits.**
  `pnpm --filter @waitron/server exec vitest run src/alert-sources.test.ts src/box-staff-notices.test.ts src/device-equipment-api.test.ts src/certificate-reminder-worker.test.ts src/staff-notices.test.ts`
  → `Tests 220 passed (220)` (`b1-server.log`); one file at a time (`b3-server-per-file.log`):
  `alert-sources.test.ts` 89, `box-staff-notices.test.ts` 6, `device-equipment-api.test.ts` 85,
  `certificate-reminder-worker.test.ts` 15.
  `pnpm exec vitest run scripts/staff-notice-codes.test.ts scripts/ongoing-alert-codes.test.ts scripts/alert-codes.test.ts scripts/waitron-sh.test.mjs scripts/deploy-image-env.test.ts`
  → `Tests 213 passed (213)` (`b2-root.log`); one at a time (`b4-root-per-file.log`):
  `staff-notice-codes` 5, `ongoing-alert-codes` 2, `waitron-sh.test.mjs` 104, `deploy-image-env` 98.
  The claim check re-ran each file alone and got the same counts.
- **P2 — what the battery check says today for a reader its provider reports offline, or cannot
  read.** A probe `describe` in `apps/server/src/alert-sources.test.ts`, reusing its `seedReader`,
  `stubProvider` and `readBattery`, with `readers.status` answering four shapes
  (`p1-reader-offline.log`, `Tests 4 passed | 89 skipped`): `{ online: false }` → `[]`;
  `{ online: false, batteryPercent: 50 }` → `[]`; `{ online: false, unreachable: true }` → `[]`;
  control `{ online: true, batteryPercent: 5 }` → `["reader.battery_low"]`. Failing case for "an
  offline reader raises nothing today": any `reader.*` code on the first two lines. The claim check
  reproduced all four. SumUp and Stripe answer a status they could not read with
  `{ online: false, unreachable: true }` rather than throwing
  (`packages/payments-sumup/src/card-provider.ts:241-245`, `packages/payments-stripe/src/card-provider.ts:236`,
  `:251-252`) **(read)**; SumUp's client is made outside that `try` (`:238`), so a missing credential
  throws. The check raises `reader.status_unavailable` only on a throw or its 45 s deadline
  (`alert-sources.ts:796-831`).
- **P3 — the staff-notice guard and a code whose words need params.** Throwaway: a
  `code: "printer.jobs_waiting"` literal appended to `apps/server/src/box-staff-notices.ts`, words
  for it in both languages of `apps/till/src/i18n/strings.ts`, and a `staffNoticeText` branch that
  words it only with a string `printer` and a parseable `since`.
  `pnpm exec vitest run scripts/staff-notice-codes.test.ts` → `× the till words every notice code, …`,
  `expected [ 'printer.jobs_waiting' ] to deeply equal []`, `Tests 1 failed | 4 passed (5)`
  (`p2-guard-params.log`). Control: with `:49`'s params extended → `Tests 5 passed (5)`. The probe's
  printer name was a Spanish word; the branch accepts any non-empty string, so the declared change's
  `"Kitchen"` behaves the same **(read)**.
- **P4 — the printer-trouble read scans every print job.** A probe in `alert-sources.test.ts` seeded
  two printers, 50 000 printed (`done`) jobs and two stuck ones, then timed twenty
  `printingAlertSource().read` calls (`p3-trouble-timing.log`): median `3.70` ms, max `4.85`; the
  control with no printed jobs: median `0.25` ms, max `0.38`. `EXPLAIN QUERY PLAN` of the source's own
  `.toSQL()` starts `SCAN print_jobs` (`p3b-trouble-plan.log`). A redundant
  `inArray(printJobs.status, ["queued", "printing", "failed"])` in `printJobInTrouble` left it a scan
  (`p3c-plan-conjunct.log`). Why SQLite scans is not established. Failing case for "the read grows
  with the print history": the same time at 0 and 50 000 rows. It grew about 15×.
- **P5 — the open notice list fails axe once it overflows, and `tabindex="0"` fixes it.** A probe
  case in `apps/till/src/widgets/notice-strip.a11y.test.ts` (Chromium) opened the strip with N copies
  of the `SPACE` notice, keys made unique (`p4-strip-scroll.log`, `p4b-violation-full.log`): at N = 4,
  8 and 12 the list did not overflow (`scrollHeight=396 clientHeight=396` at 12, `innerHeight=896`)
  and axe passed; at 16 and 20 it overflowed (`scrollHeight=528 clientHeight=447`) and failed in both
  themes with `scrollable-region-focusable [serious]: Scrollable region must have keyboard access`,
  target `till-notice-strip,#notice-list`. Control: the same cases with
  `ul.setAttribute("tabindex", "0")` → `Tests 4 passed`. (The backlog's "about eight wrapped
  notices" was for longer, wrapping lines; one-line notices overflow at 16.)
- **P6 — time synchronisation on Debian and Ubuntu.** `docker run --rm --pull=never <image>` with
  `command -v timedatectl` (`t1-images.log`): the `debian:12`, `debian:13` and `ubuntu:24.04` images
  have neither `timedatectl` nor `systemd` (container images are minimal; a host is not). With
  `apt-get install -y systemd` (`t2-systemd.log`): `apt-cache depends systemd` names
  `|Recommends: systemd-timesyncd` (alternatives chrony, ntpsec, openntpd) on both, and installing
  `systemd` pulled `systemd-timesyncd` in on both. `timedatectl set-ntp true` then printed `System
  has not been booted with systemd as init system (PID 1). Can't operate.`, `exit=1`. The review's
  probe (`round1.md`, experiment 1, `chrony-ntp-units.log`) found Debian 12's chrony ships
  `/usr/lib/systemd/ntp-units.d/50-chrony.list`, so `set-ntp` can drive chrony too. What this shows:
  the command can be absent, and where present it can fail, so the script must carry on either way
  (Task 12). Not measured: `set-ntp` on a booted host.
- **P7 — what `docker image rm <id>` does** on Docker Desktop's store (`rmi-probe.sh`, `t3-rmi.log`;
  the claim check reproduced it). Images built from `FROM scratch` under names only the probe used,
  removed by name afterwards: (1) an image a created, stopped container uses → `conflict: unable to
  delete … (must be forced) - image is being used by stopped container`, `exit=1`, still present;
  (3) an image with one tag and no container → `Untagged: …`, `Deleted: sha256:…`, `exit=0`; (4) an
  image tagged in two repositories → `conflict: … referenced in multiple repositories`, `exit=1`.
  Failing case for "`rm` without `-f` never deletes an image a container uses": `exit=0` on (1).
- **P8 — a clock before 28 October 2024 cannot open a TLS mail connection** (`tls-probe.js`,
  `t4-tls-clock.log`), in `node:26.11.1-slim` with `faketime`: real clock → `secureConnect
  authorized=true` to `smtp.gmail.com:465`; `faketime "2001-01-01 00:00:00"` → `error
  CERT_NOT_YET_VALID`; `faketime "2024-10-27 12:00:00"` → `error CERT_NOT_YET_VALID`. A TLS error
  carries no reply code, so `sendSmtpMessage` answers `unknown` (`smtp-send.ts:23-31`) **(read)**.
  Not measured: a plain, unencrypted relay, which has no certificate to check.
- **P9 — text searches** (`p9-searches.log`): `prune`, `rmi` or `image rm` in `deploy/waitron.sh`:
  none; `timedatectl`, `timesyncd`, `chrony` or `ntp` in `deploy/waitron.sh`, `deploy/compose.yml`,
  `deploy/Dockerfile`: none; `reader.offline` as code: none; `timedatectl` in
  `scripts/waitron-sh.test.mjs`: none — so no stub stands in for it today, and on a Linux machine an
  unstubbed call would reach the real one (Task 12). `sendSmtpMessage`'s callers:
  `account-email.ts`, `attendance-email.ts`, `certificate-reminder-email.ts`, `smtp-test-message.ts`
  (`:11`, found by the claim check), and `smtp-send.ts` itself.
- **P10 — what an upgrade leaves behind on each of Docker's image stores** (`r2/inner.sh`,
  `r2/dind-stores.log`). Two `docker:29-dind` daemons (Engine 29.9.2), each with its own storage, so
  every image, container and prune in the probe is that inner daemon's: one with
  `{"features":{"containerd-snapshotter":false}}` (`docker info`: `overlay2`, the classic store), one
  with it `true` (`overlayfs`, `driver-type io.containerd.snapshotter.v1`). In each: a local
  `registry:2`; an image `FROM busybox` with a 50 MB random file pushed as `localhost:5000/app:main`
  and pulled back (a pulled image, as a box's `:main` is); a container `c1` running it; an unrelated
  dangling image (`other:x` built twice). Then a second 50 MB image pushed to the same tag and pulled
  (the upgrade's pull), `c1` replaced by `c2` on the new image (the upgrade's `up`), then
  `docker image rm <old id>`, then `docker image prune -f`. Disk is `du -sm /var/lib/docker`.
  - **Classic store:** after the pull, `inspect` still finds the old id and it is listed dangling as
    `localhost:5000/app:<none>`; disk 302 MB, unchanged by replacing the container; `docker image rm
    <old id>` → `Untagged: localhost:5000/app@sha256:…`, `Deleted: …`, `exit=0`, disk **254 MB**
    (−48 MB). Then `prune -f` deleted the unrelated dangling image (`deleted: sha256:cc72…`,
    "Total reclaimed space: 0B").
  - **Containerd store:** after the pull, `inspect` finds nothing for the old id and nothing is listed
    dangling, while `c1` still runs it (`docker inspect -f '{{.Image}}' c1` names it); disk 360 MB.
    Replacing the container: disk **312 MB** (−48 MB) with no command of ours. `docker image rm <old
    id>` → `No such image`, `exit=1`; `prune -f` → "Total reclaimed space: 0B".
  - In both, `c2` still ran after the prune.
  - What this shows: on the classic store the old pulled image stays until it is deleted by id, and
    deleting it frees its space; on the containerd store Docker frees a pulled image's space by itself
    once no container uses it, and there is nothing left to delete. A dangling-only prune adds
    nothing on either store for the box's own images and deletes other dangling images too, so the
    plan does not use it (decision 15). Failing case for "deleting by id frees the old image on the
    classic store": disk unchanged after `rm`. It fell 48 MB. Docker Engine 29's release notes say
    the containerd store "is now the default for fresh installs" (the claim check's quotation,
    `a798-10-plan-check/engine29.md`). Not measured: an image built on the box from a branch (its
    build cache is a separate store; the claim check's `big.sh` found most of a rebuilt image's
    space in it), and a box's own Linux.
  - The probe pulled `docker:29-dind` onto Docker Desktop (with an empty `DOCKER_CONFIG`, since the
    keychain helper timed out) and removed it by name afterwards; nothing else outside the inner
    daemons was touched.
- **P11 — what a SumUp Solo nobody is using reports** (`r2/sumup-status.log`). One read-only `GET
  /v0.1/merchants/…/readers/<the owner's paired Solo>/status` at `2026-10-23T06:54:46Z`:
  `"status": "OFFLINE"`, `"state": "IDLE"`, `"connection_type": "Wi-Fi"`, `"battery_level": 46.46`,
  `"last_activity": "2026-10-13T00:11:50Z"`. SumUp's client maps anything but `ONLINE` to
  `online: false` (`packages/payments-sumup/src/sumup-client.ts:290-291`), so this reader would raise
  `reader.offline`. What this cannot show: whether the Solo is switched off or only asleep (the owner
  is away; nobody can look at it), so whether a reader that is on but idle reads `OFFLINE` is not
  established (decision 5).
- **Not measured:** anything on a real box; a booted host's `timedatectl`; an SMTP send from the
  duty to a real server (the duty's tests use a fake sender, Task 11's boot test the real wiring with
  a fake sender; the Codex seat is asked for a real one).

---

## Decisions this plan makes that the design does not

Each is a DEFAULT to build; the owner or the plan review may overrule any.

1. **Which devices show a printer's notice.** A stuck kitchen printer shows on every device at the
   box's location; any other stuck printer only on a device whose receipt, payment-slip or
   full-invoice printer resolves to it (`readPrinterRoles`, `packages/layouts/src/device-equipment.ts:354-360`;
   the roles the till's printing uses, `apps/server/src/receipt-print.ts:81-128`). Why a kitchen
   printer by its stations rather than by which job is stuck: the owner's reason for question 2 is
   that "every waiter sending food needs to know to walk to the kitchen" (`:1288-1289`). Why slips
   and full invoices too, beyond the design's "receipts": a device whose slips go to a stuck printer
   depends on it the same way. Cost if wrong: a device sees a notice for a printer it prints only its
   slips or full invoices to. **Location:** printers are filtered to the box's location
   (`till.locationId`), because `station_printers` "is not location-scoped"
   (`station-printers.ts:7-8`) and a box serves one location (`TillConfig.locationId`); the bell's
   check keeps reading every printer, as today.
2. **The notice's words and params.** Code `printer.jobs_waiting` — the bell's code for the same
   printer (`alert-sources.ts:438-439`); severity `warning`; key `printer.jobs_waiting:<printer id>`;
   params `{ printer: <name>, since: <the oldest job that makes it stuck, ISO> }`. The till draws
   `staff_notice.printer.jobs_waiting`, "Printer “{printer}” not printing" / "Impresora «{printer}» no
   imprime", then " · " and `staff_notice.since`, "since {time}" / "desde {time}", with the time as
   the till already writes one (`clockTime`, `apps/till/src/i18n/t.ts:154`). The design's example
   translated the printer's name ("Kitchen printer not printing" for a printer named "Cocina"); a
   printer's name is the venue's data and is never translated, so the name is quoted the way
   `reader.offline` quotes a reader's (decision 5), which also keeps a printer named "Kitchen printer"
   from reading "Kitchen printer printer". A notice whose `printer` is not a non-empty string, or
   whose `since` does not parse, is drawn as unknown, as a malformed count is
   (`apps/till/src/i18n/staff-notices.ts:31`).
3. **The printer notice rides on the equipment read only, under a new owner `printers`.** Not the
   Box status page, whose Printers row already shows the bell's printer alerts
   (`apps/dashboard/src/screens/box-status-rows.ts:61`). A separate owner, so a failed printer check
   keeps only the printer notices the till last showed, not stale disk notices
   (`nextNotices`, `apps/till/src/state/staff-notices.ts:23-37`). `printers` is no module's name
   (`packages/composition/src/modules.ts:141-364`) **(read)**. Its source runs after the box's and
   the modules' sources; the reader orders by severity first (`apps/server/src/staff-notices.ts:102`),
   so where it sits matters only among warnings, after `storage.space_low`.
4. **One printer-trouble read per ten seconds for the whole box.** The per-device source reads
   `printersInTrouble` through one ten-second cache shared by every device (`createTtlCache`,
   `apps/server/src/ttl-cache.ts`, which shares a read in flight and drops a rejected one). Why: every
   signed-in device asks every 15 s (`apps/till/src/state/equipment-poll.ts:4`), each source runs in a
   write-lock turn (`readStaffNoticesInTurns`, `staff-notices.ts:55-71`), and the read scans every
   print job (P4: 3.7 ms at 50 000). With the cache, devices add no scans. Cost: a printer notice can
   appear or clear up to ten seconds late, on top of the 15 s poll. The scan itself, which the bell
   pays on every read, is recorded as backlog (Task 14), not fixed here.
5. **`reader.offline`.** Raised when the provider answers `online: false` without
   `unreachable: true`: warning, area `card_reader`, permission `payments.manage`, `since: null`,
   screen `payments`, key `reader.offline:<reader id>`, params `{ reader: <name> }` — the shape of its
   siblings (`alert-sources.ts:819-846`). It shares the battery check's five-minute cache
   (`boot.ts:2160`), which now keeps the whole status answer (`ReaderStatus`) instead of the battery
   figure, so it adds no provider call. The cache is filled only by a bell or Box status read
   (`alert-sources.ts:800-806`), so while either is open the box asks the provider at most every five
   minutes, and an offline reader can show up to five minutes late. The words are the design's, the
   name quoted as their siblings quote it: "“{reader}” is offline." / "«{reader}» está sin conexión."
   The Box status page's Card readers row shows it with no change there: the row takes every
   `card_reader` alert (`box-status-rows.ts:62`) and shows the first one's sentence (`:137-139`).
   **Not settled:** P11 found the owner's unused Solo reporting `OFFLINE`; if a Solo that is on but
   asleep reports the same, the bell carries a standing warning while the reader idles. The pull
   request names it, and Task 14 records it for the owner to check against the reader.
6. **What is emailed, and an episode of each.**
   - `storage.space_low` and `storage.disk_full` come from the stop and the warning, not from the
     notices. The two share one **disk episode**, from the first check that finds the stop on or the
     warning on until a check finds both off. In a disk episode, `storage.disk_full` is emailed once,
     the first time the stop is found on; `storage.space_low` is emailed once, the first time the
     warning is found on while the stop is off and before any `storage.disk_full` email in that
     episode. So a disk going from low to full sends both, once each; a box found full and low at
     once sends only the full disk; a stop that lifts and returns while space stays under 2.5 GiB
     sends nothing more, which keeps a disk hovering at full from emailing every few minutes (the stop
     lifts at 16 MiB, `boot-failure.ts:47`; the warning clears only at 2.5 GiB). Cost: a free-space
     reading the filesystem never gives leaves the warning off (slice 5 decision 8), so on such a
     disk a stop that lifts and returns starts a new episode.
   - Any other code with email words (in this slice only `clock.unusable`) comes from the enabled
     modules' staff notices (`enabledStaffNoticeSources`, `apps/server/src/modules.ts:59-65`), read the
     way the equipment read reads them. Its episode is keyed by owner and key, starts when the notice
     is first found and ends at the first check that finds it gone **from an owner whose check
     answered**; while an owner's check fails, its episodes neither start nor end.
   - Not emailed: the unsent count, the printer notice, `reader.offline` — the design's list
     (`:508-511`) names none of them — and `clock.behind_chain`, which the module already gives
     (`packages/fiscal-verifactu/src/staff-notices.ts`, `clockStopNotices`) but which has no words
     here until slice 9 (decision 9).
7. **Once per episode, per recipient, retried each minute until sent** (design decision 15,
   `:1159-1160`). An episode keeps the addresses that accepted it (lower-cased, trimmed). Each check
   sends to every managers' address the episode has not reached. **Any failure is tried again the next
   minute**: no connection, a timeout, a sender that throws (`unknown`), and every reply the mail
   server refuses with, 4xx or 5xx (`rejected`, `smtp-send.ts:24-31`), a wrong password (535)
   included — so fixing the email settings sends the email at the next check. A manager added during
   an episode gets it at the next check. With no email settings the duty sends nothing and says so
   once per episode; once settings appear during the episode it sends. All of it is in memory (design
   §7), so a restart during an episode can send again. **Cost:** an address the server always refuses
   is tried once a minute for as long as the episode lasts — for a nearly full disk, possibly days —
   and each recipient's failures are logged at most twice per episode, once per kind (decision 8, Task 9).
8. **The duty's clock and its log.** The first check is one minute after start; each next one is
   armed one minute after the last finished, on an unref'd timer, as the free-space watch does
   (`free-space-watch.ts:66-82`). Why not at once: slice 5's watch takes its first reading at start,
   so the duty's first check sees it; and a start that fails within its first minute emails nothing.
   Only a node that is the primary checks (`holders.singletonRole.current === "primary"`, as the
   certificate reminders gate, `boot.ts:1790`); on any other node the check reads and sends nothing.
   A failed send is logged (`box_email.send_failed`, `{ code, outcome }`) at most once per outcome
   per recipient per episode: the first `rejected` and the first `unknown`, so at most two lines per
   recipient per episode however the outcomes alternate — never once a minute. No address is ever
   logged.
9. **Room for slice 9.** The clock-behind email is slice 9's (build plan `:118-122`; backlog
   `:4651-4655`). Slice 8 already gives the `clock.behind_chain` notice from the Veri\*Factu module's
   source, with `params: { ...behind }`; the duty skips it only because `box-emails.ts` has no words
   for it. The design's §4.8 c subject and body name both times (`{clockAt}`, `{lastRecordAt}`,
   design `:843-856`), and this slice's sender carries no notice values: `boxEmailMessage(code,
   language, venue)` fills only `{venue}` (Task 7), an episode keeps no params (Task 8), and the duty
   passes none. So slice 9 adds the words **and** carries the notice's values into them: it keeps the
   params of the notice that started a module episode, passes them to `boxEmailMessage`, and gives
   that function the placeholders. This slice does not build that (the lane's driver, round 3).
   Nothing in this slice reads slice 8's seat.
10. **The `clock.unusable` email is built though it will usually not arrive.** P8: with the clock
    before 28 October 2024 the box cannot open a TLS mail connection, so the send comes back
    `unknown` each minute, and the episode ends when the clock is fixed, before the mail could go.
    It does arrive through a plain relay or the practice box's local mail capture. Built because the
    design asks for it (`:508`); the guide does not promise it (Task 14), and the backlog records the
    finding for the owner.
11. **The emails carry no figures and no link.** Each names the venue (its location's name, as the
    attendance emails do, `boot.ts:1755-1767`) and the page to open, by its menu path. No free-space
    figure: the email goes once per episode and the figure changes, while the Box status page shows
    the current one; and `apps/server` cannot use the dashboard's byte formatter
    (`packages/dashboard-kit/src/alert-messages.ts:55-70`; `@waitron/dashboard-kit` is not one of
    `apps/server/package.json`'s dependencies). No link: the certificate reminders name the page the
    same way, and the box's address is often unreachable from where an email is read. The words are
    in Task 7.
12. **A status the provider could not read stays silent, as today.** `{ online: false,
    unreachable: true }` raises neither `reader.offline` (connection unknown) nor, as today,
    `reader.status_unavailable` (P2). Making it raise `reader.status_unavailable` would add an alert
    to every box whose provider is unreachable, which the design did not ask for; Task 14 records it.
13. **The email's database reads answer on a full disk.** The location's name, the managers'
    addresses and the email settings are read in one `db.withWriteLock` turn with no change-log
    drain, never in `withTransaction`, whose closing drain is refused on a full disk while a change
    waits (`docs/developers/conventions-data.md:2583-2588`, slice 6's M2). The claim check measured
    exactly this on a real full disk: the turn answered twice, and `resolveEmailDelivery`'s
    `withTransaction` was refused `storage.disk_full` — only while a change waited; with none it
    answered. Task 10 pins it.
14. **`waitron.sh install` switches on time synchronisation with `timedatectl set-ntp true`.** Run
    through `as_root`, under the outer `timeout` command `apt_get` finds, with 60 s; never fatal;
    `install` only, never `reset`; on every install, upgrades included, so a host whose
    synchronisation someone switched off is switched back on. On success one line on stdout:
    "waitron.sh: asked the system to keep its clock in step with internet time (timedatectl set-ntp
    true)" — words that say what was asked, since P6 could not show what a booted host does next. On
    failure, or with no `timedatectl`, one line on stderr that says synchronisation could not be
    switched on, that unless another time service runs on the machine nothing keeps the clock right,
    why that matters, and what to do — not that nothing keeps the clock, which a failed `set-ntp` does
    not show. It installs no package: the design says "where the system provides it".
15. **`waitron.sh install` deletes the images the box ran before, by id, where Docker has not freed
    them already, and only once the new box is healthy.** Before `docker compose up` it records the
    image ids the `app` and `print-agent` containers run (`docker compose ps -q <service>`, then
    `docker inspect -f '{{.Image}}'`, the calls `print_image_versions` already makes,
    `deploy/waitron.sh:393-431`); after `wait_healthy` succeeds it runs `docker image rm <id>` — never
    `-f` — for each recorded id the containers no longer run and that `docker image inspect` still
    finds. P10 shows why this works on both stores: on the classic store the old image is still there
    by id and deleting it frees its space (−48 MB of a 50 MB layer); on the containerd store, the
    default for a fresh Docker Engine 29 install, the old id is already gone and Docker freed the
    space itself when the old container was replaced, so the step finds nothing to do and says
    nothing. **No `docker image prune`**: P10 measured that it reclaims nothing more for the box's own
    images on either store, and on the classic store it deleted an unrelated dangling image too. A
    refusal is one line on stderr and never fatal; `rm` without `-f` cannot delete an image a
    container still uses (P7 (1)). An unhealthy upgrade keeps the old image for a quick way back, and
    `reset` deletes no image. Not deleted: images left by upgrades before this slice, the mail
    capture's old image, and Docker's build cache from branch installs (on either store); Task 14
    records them.
16. **The plain-text sender is shared, not copied.** `certificate-reminder-email.ts`'s sender moves to
    `apps/server/src/text-email.ts` as `createTextEmailSender`; the old file re-exports it under its
    old names, so the certificate reminders and their tests do not change. Why not rename the old
    file: `apps/server/test-durations.json:212` names its test file.
17. **Lands itself**, as the build plan's row 10 says: emails, an alert, a notice and the install
    script. No invoice, record, chain, series, number or filing changes.
18. **The printer notice goes once the printer prints a later document; the bell's alert is
    unchanged.** The design says the strip "goes when the problem goes" (`:438-440`), and the
    notice's own words are "not printing". `printJobInTrouble` keeps a job that failed with no tries
    left "however recent, until a later job standing in for it has printed"
    (`print-job-trouble.ts:24-37`) — a resend, a Reprint of the same ticket, or another receipt of the
    same sale — so under it a printer that came back and is printing new tickets would still be named
    "not printing" on every till. So for the notice a job in trouble counts only while no later
    document job on the same printer has printed (`status = 'done'`, a larger `rowid`, `kind =
    'document'`; "later" by `rowid`, as `printJobInTrouble` already orders jobs, `:31-36`). The
    bell's `printer.jobs_waiting` and the table's printing banner keep today's rule, which is what
    the design keeps ("means what it means today", `:1279`), so the job a printer gave up on still
    shows there until it is reprinted or resent. Cost: a printer that prints some documents but
    keeps failing others (a jam on long tickets) loses its notice at the first one that prints.

## Questions for the owner

None. Every choice above has a conservative default; decision 10 and decision 5's "not settled" are
findings to report, not questions.

## Behaviour this slice changes

- Managers with an email address get up to one email per disk episode for "nearly out of space",
  one for "out of space", and one per episode of a clock set before 28 October 2024; a send that
  fails is tried again each minute.
- The bell (and the Box status page's Card readers row) shows `reader.offline`.
- Every till and handheld at the box's location shows the amber printer notice while a kitchen
  printer is stuck; a device shows it for another stuck printer it prints its receipts, slips or
  full invoices to. It goes once the printer prints a later document.
- The till's open notice list takes keyboard focus.
- The equipment read's notices gain the `printers` owner.
- `waitron.sh install` prints one more line (time synchronisation) and, after an upgrade on the
  classic image store, one per deleted image.
- New log lines: `box_email.sent`, `box_email.send_failed`, `box_email.not_configured`,
  `box_email.no_recipients`, `box_email.check_failed` (Tasks 8–9), never once a minute.

---

## Global constraints

- Every commit `git commit -s`. Never `--no-verify`. Work only in this worktree. Stage explicit
  paths.
- **No migration.** No change to `packages/fiscal-verifactu`, `packages/core`, `packages/store`,
  `apps/server/src/disk-full-state.ts`, `free-space-watch.ts`, `till-sale.ts`, `bill-payments.ts`, or
  anything fiscal (decision 17). No change to `packages/module`: the notice context stays as it is
  (Architecture 1). No change to `printJobInTrouble` (decision 18).
- **General code is English only** (CLAUDE.md §3), tests and guards included. Spanish appears only in
  `apps/server/src/i18n/box-emails.ts`, `apps/till/src/i18n/strings.ts`,
  `apps/dashboard/src/i18n/alert-messages.ts` and `apps/server/src/guide/es/`. Test data uses English
  names — printers "Kitchen" and "Bar", the venue "Corner Bistro" — and a test reads expected words
  from those files. `scripts/english-only.test.ts` reads neither `apps/*` nor `scripts/`, so review
  greps the diff for Spanish.
- Every ongoing alert code is a `code: "…"` literal in `apps/server/src/alert-sources.ts`, worded in
  `apps/dashboard/src/i18n/alert-messages.ts` in the same commit (`scripts/ongoing-alert-codes.test.ts`,
  weaker than its name). Every notice code is a `code: "…"` literal in
  `apps/server/src/box-staff-notices.ts`, worded by the till in an earlier or the same commit
  (`scripts/staff-notice-codes.test.ts`, weaker than its name: listed files, text, one params set).
- `apps/dashboard/src/i18n/alert-messages.ts` stays free of imports (its header), because the root
  guards load it.
- Tests of the duty never wait real minutes and never sleep: the duty takes a `timer`, and tests pass
  a manual one and "tick" by calling the last armed callback, then `vi.waitFor` until the next timer
  is armed (`apps/server/src/free-space-watch.test.ts:135-165`). To show nothing happens after a held
  promise is released, await `new Promise((r) => setImmediate(r))` twice.
- Coverage stays at 98/98/98/95 in `apps/server`, `apps/till` and `apps/dashboard`. No exclude, no
  ignore comment.
- Comments only for an invariant or a non-obvious why; no history, no slice numbers in code.
- Focused runs: `pnpm --filter <pkg> exec vitest run <files>`; root guards
  `pnpm exec vitest run scripts/<guard>`. Read the `Tests` count every time; a run with no count
  proved nothing. Unset `AI_AGENT` and `CLAUDECODE` to see a passing test's console output. Every
  task runs `pnpm exec prettier --check` on the files it touched before committing (not on `docs/`,
  which prettier ignores). CI runs the package suites and coverage.
- `apps/till` and `apps/dashboard` run in real headless Chromium: check `memory_pressure | grep free`
  first and run beside another session's browser run only when free memory is well above 15%. Stop
  only processes you started, by pid. Never run `docker builder prune`, `docker system prune`, or a
  `docker image prune` on this machine's own daemon.
- The shell is zsh: quote `--include='*.ts'` globs, and use `/usr/bin/grep` where an exit status
  decides anything. `timeout` does not exist on macOS; the stubs supply `timeout` and `gtimeout`.

## Review focus

1. **The episode rules (decisions 6–8).** A disk hovering at full emails once; low → full emails
   both; a module owner whose check fails neither starts nor ends an episode; every failed send,
   refused or not, is tried the next minute; a recipient who accepted is never sent the same episode
   again; failures are logged at most once per kind per recipient per episode. Tasks 8–9 pin each one.
2. **The full-disk email reads (decision 13).** Task 10's real-disk case answers with a change
   waiting, and its control — the same reads through `withTransaction` — is refused
   `storage.disk_full`.
3. **The printer notice (decisions 1, 3, 4, 18).** A device sees a non-kitchen printer only through
   its own roles; two devices within ten seconds cause one trouble read; a failing printer check
   names only `printers` as unavailable; a later printed document clears the notice and not the
   bell's alert, and with nothing newer printed the notice stays.
4. **`reader.offline` against `unreachable` (decisions 5, 12).** An unreadable status raises nothing,
   exactly as P2 measured today.
5. **`waitron.sh` (decisions 14–15).** Hermetic stubs: `timedatectl` is stubbed for every case, so no
   case reaches a real one on Linux CI (P9). Neither new step can fail an install. Images are deleted
   only after `wait_healthy`, only by recorded id that still exists, never with `-f`, never pruned,
   never on `reset`; both image stores are modelled in the stub.
6. **Nothing fiscal.** The duty and the notice source read; the duty's only module input is the
   staff-notice seat.

**For the Codex run-it seat** (as many commands as the claims need):
- Send the duty's email through a real SMTP server: start Mailpit
  (`docker run --rm -d -p 127.0.0.1:1025:1025 -p 127.0.0.1:8025:8025 axllent/mailpit:v1.31.6`, stopping
  it by its container id afterwards), run `startBoxEmailDuty` from a scratch test with a real
  `readBoxEmailContext` on a `useVenueDb` database holding an admin with an address, `practiceMode:
  true` (so delivery is Mailpit's `smtp://127.0.0.1:1025`), the stop noted, and tick it twice; read
  `http://127.0.0.1:8025/api/v1/messages`: one message, the right subject, in the admin's language.
  Then stop Mailpit, tick (the send comes back `unknown`), start it again, tick: the message arrives.
- Stop the server while a duty read waits for the write lock behind a held write, and confirm the
  store closes cleanly and nothing is sent afterwards.
- Run `deploy/waitron.sh install` under the suite's stubs with `WT_OLD_IMAGES=1` and an unhealthy
  container, and confirm no `docker image rm` is logged.
- On macOS, run Task 10's full-disk case and its control.
- If someone can reach the owner's SumUp Solo: read its status with the reader switched on and idle
  (decision 5, P11).

## Review path

**LIGHT**, as the build plan's row 10 says: no per-task reviewer, one Codex run-it review, and the
fresh-context plan-against-spec read before implementers start. Checked against each risk trigger:
no fiscal invariant (decision 17); no tenant or by-id read (the printer source reads the requesting
device's own roles, by the id its authenticated proof gives); no migration; no grant or ACL; no new
cross-package contract — the notice context in `@waitron/module` is unchanged, `deviceSources` is
internal to `apps/server`, and a new notice code is an additive value the till already draws as
unknown when it does not know it (slice 6 decision 12). The round-1 review ruled on the two places a
reviewer could argue otherwise: recipients chosen by `system.manage` reuse the certificate
reminders' existing query unchanged, so they are not the auth trigger; and the minute check and the
shared cache write nothing and copy landed patterns, so they are not a concurrency risk needing the
full review (`round1.md`, Q2).

---

### Task 1: Printers in trouble, which are stuck, and which a kitchen station prints to

**Files:**
- Modify: `apps/server/src/print-job-trouble.ts` (new export after `printJobInTrouble`)
- Modify: `apps/server/src/alert-sources.ts` (`printingAlertSource`'s rows, `:417-445`)
- Create: `apps/server/src/print-job-trouble.test.ts`

**Interfaces** (`print-job-trouble.ts`):
```ts
export interface PrinterInTrouble {
  readonly id: string;
  readonly name: string;
  /** How many of its document jobs are in trouble. */
  readonly count: number;
  /** The oldest of them, as stored. */
  readonly oldest: string;
  /** The oldest of them with no later document printed on this printer, as stored; null when a
   * later document has printed after every one of them. */
  readonly stuckSince: string | null;
  /** An active kitchen station prints to it. */
  readonly kitchen: boolean;
}

/** Every active printer with a job in trouble at `now` (`printJobInTrouble`), leaving out jobs an
 * Unpair ended; given `locationId`, only that location's printers. */
export async function printersInTrouble(
  tx: Transaction,
  now: Date,
  options?: { locationId?: string },
): Promise<PrinterInTrouble[]>;
```
The query is `printingAlertSource`'s (`alert-sources.ts:417-434`) moved verbatim, with its
`PRINTER_UNPAIRED` condition, plus an optional `eq(printers.locationId, locationId)` and one more
selected column: `stuckSince`, the `min` of `created_at` over the group's jobs for which no
`print_jobs` row on the same printer has `kind = 'document'`, `status = 'done'` and a larger `rowid`
(a correlated `not exists` on an alias, as `printJobInTrouble`'s own subqueries are written,
`print-job-trouble.ts:51-77`). Then, only when it found rows, one more query: the `printerId`s of
`stationPrinters` joined to `kitchenStations` on `stationId` where `kitchenStations.active` is true and
`printerId` is among the rows' ids. `printingAlertSource` keeps its `agent.silent` part, calls
`printersInTrouble(tx, now)` with no location, and maps the rows to exactly the alerts it builds today
(key, code, params `{ printer: name, count }`, severity, `since: new Date(oldest).toISOString()`,
screen). `printJobInTrouble` itself is not edited.

- [ ] **Step 1: Write the failing tests** in `print-job-trouble.test.ts`, with
  `useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS] })`
  and helpers copied in shape from `alert-sources.test.ts:666-755` (`minsAgo`, `seedLocation`,
  `seedPrinter`, `seedJob`; `seedJob` may gain `attempts` and `status` as it already takes them),
  `NOW` fixed. Rows are inserted in the order written, so their `rowid`s follow it.
  `describe("printersInTrouble")`:
  1. `"names an active printer whose document has waited past two minutes, with how many and the oldest"`:
     printer "Bar"; a `done` job at `minsAgo(10)`, then queued jobs at `minsAgo(5)` and `minsAgo(3)` →
     `toEqual([{ id, name: "Bar", count: 2, oldest: minsAgo(5), stuckSince: minsAgo(5), kitchen:
     false }])`.
  2. `"names nothing for a young job, a drawer pulse, a job an Unpair ended, or a switched-off printer"`:
     a queued job at `minsAgo(1)`; a `kind: "drawer"` job at `minsAgo(10)`; a `failed` job at
     `minsAgo(10)` with `lastError: PRINTER_UNPAIRED`; a queued job at `minsAgo(10)` on a printer with
     `active: false` → `toEqual([])`.
  3. `"a printer that has printed a later document is in trouble but not stuck"`: a `failed` job with
     `attempts: MAX_DELIVERY_ATTEMPTS` at `minsAgo(10)`, then a `done` document job at `minsAgo(5)` →
     `toMatchObject([{ count: 1, oldest: minsAgo(10), stuckSince: null }])`.
  4. `"a printer whose only printed document came before its stuck one stays stuck"` (the control of
     3): the `done` job inserted first, then the given-up one → `stuckSince: minsAgo(10)`; and a `done`
     **drawer** job inserted after the given-up one does not clear it (`stuckSince` still
     `minsAgo(10)`).
  5. `"marks a printer an active kitchen station prints to"`: a `kitchenStations` row (`isDefault:
     false`, `active: true`, name "Kitchen"), a `stationPrinters` row to the printer, a stuck job →
     `kitchen: true`.
  6. `"a printer whose only station is switched off is not a kitchen printer"`: as 5 with the station
     `active: false` → `kitchen: false`.
  7. `"given a location, names only that location's printers"`: two locations, a stuck printer in
     each → with `{ locationId: first }` only the first's; with no option, both.
- [ ] **Step 2: Run and watch it fail.**
  `pnpm --filter @waitron/server exec vitest run src/print-job-trouble.test.ts` → FAILS:
  `printersInTrouble` is not exported.
- [ ] **Step 3: Implement** as the Interfaces say.
- [ ] **Step 4: Run and watch it pass; the bell unchanged; typecheck; format.** The Step 2 command →
  `Tests 7 passed (7)`.
  `pnpm --filter @waitron/server exec vitest run src/alert-sources.test.ts src/print-problems.test.ts`
  → PASS, `alert-sources.test.ts` still 89 (P1): the bell's alerts are unchanged, including a printer
  in case 3's state, which the bell still names. `pnpm --filter @waitron/server typecheck` exits 0.
  `pnpm exec prettier --check apps/server/src/print-job-trouble.ts apps/server/src/print-job-trouble.test.ts apps/server/src/alert-sources.ts`.
- [ ] **Step 5: Proofs by deletion**, each restored and re-run before the next: drop the
  `not exists` (make `stuckSince` the plain `min`) → case 3 FAILS; drop its `rowid` comparison →
  case 4 FAILS; drop its `kind = 'document'` → case 4's drawer half FAILS; drop the
  `kitchenStations.active` condition → case 6 FAILS; make `kitchen` always `false` → case 5 FAILS;
  drop the location condition → case 7 FAILS; drop the `PRINTER_UNPAIRED` condition → case 2 FAILS
  (and `alert-sources.test.ts`'s case at `:926`).
- [ ] **Step 6: Commit.**
  ```bash
  git add apps/server/src/print-job-trouble.ts apps/server/src/print-job-trouble.test.ts apps/server/src/alert-sources.ts
  git commit -s -m "The box can list its printers in trouble, which of them are still stuck, and which a kitchen station prints to; the bell reads the same list"
  ```

### Task 2: The till words a printer notice, and its open list takes focus

**Files:**
- Modify: `apps/till/src/i18n/strings.ts` (English after `:1738`, Spanish after `:3448`)
- Modify: `apps/till/src/i18n/staff-notices.ts` (a branch before the unsent count's, `:29`)
- Modify: `apps/till/src/i18n/staff-notices.test.ts` (cases in the `describe.each(LANGUAGES)`)
- Modify: `apps/till/src/widgets/notice-strip.ts` (`tabindex="0"` on the `<ul>`, `:173`)
- Modify: `apps/till/src/widgets/notice-strip.a11y.test.ts` (one case beside "three open")
- Modify: `scripts/staff-notice-codes.test.ts:49` (declared change 1, its own commit)

**The words** (decision 2):

| Key | English | Spanish |
| --- | --- | --- |
| `staff_notice.printer.jobs_waiting` | Printer “{printer}” not printing | Impresora «{printer}» no imprime |
| `staff_notice.since` | since {time} | desde {time} |

**The branch:** for `code === "printer.jobs_waiting"`: `printer` must be a non-empty string and
`since` a string `Date.parse` reads, else `unknownText()`; then `main` is
`t("staff_notice.printer.jobs_waiting").replace("{printer}", () => printer)` and `hint` is
`t("staff_notice.since").replace("{time}", () => clockTime(Date.parse(since)))`. The function form of
`replace` keeps a name such as `$&` as it is.

- [ ] **Step 0: The declared guard change, first and on its own.** In
  `scripts/staff-notice-codes.test.ts:49`, `params: { count: 2, held: 0 }` becomes
  `params: { count: 2, held: 0, printer: "Kitchen", since: "2026-10-23T19:16:00.000Z" }`.
  `pnpm exec vitest run scripts/staff-notice-codes.test.ts` → `Tests 5 passed (5)`. Commit:
  ```bash
  git add scripts/staff-notice-codes.test.ts
  git commit -s -m "Changed test checks (A798 slice 10): the staff-notice guard words each code with a printer's name and a time too

  scripts/staff-notice-codes.test.ts:49 — before: params { count: 2, held: 0 }; after: the same plus
  printer: \"Kitchen\", since: \"2026-10-23T19:16:00.000Z\". The input fixture the guard words every
  code with gains what the printer notice needs; no expected value changes (adding what a fixture
  lacks). Without it the printer notice reads as unknown to the guard (plan P3)."
  ```
- [ ] **Step 1: Write the failing tests.**
  - `staff-notices.test.ts`, inside `describe.each(LANGUAGES)` (`setLocale(locale)` first in each):
    1. `"words a printer notice with the printer's name and the time its oldest ticket was sent"`:
       first `expect(words["staff_notice.printer.jobs_waiting"]).toBeTypeOf("string")` and the same for
       `"staff_notice.since"` (so the case fails on that line, not on a `TypeError` building the
       expected value); then `since = "2026-10-23T19:16:00.000Z"`;
       `staffNoticeText({ code: "printer.jobs_waiting", params: { printer: "Kitchen", since } })`
       `toEqual({ main: words["staff_notice.printer.jobs_waiting"].replace("{printer}", "Kitchen"),
       hint: words["staff_notice.since"].replace("{time}", clockTime(Date.parse(since))) })`
       (import `clockTime` from `./t.js`).
    2. `it.each` `"words a printer notice with %j as unknown"` over `{}`, `{ printer: "", since }`,
       `{ printer: "Kitchen" }`, `{ printer: "Kitchen", since: "not a time" }`, `{ printer: 7, since }`
       → `toEqual({ main: words["staff_notice.unknown"], hint: words["staff_notice.tell_manager"] })`.
    3. `"keeps a printer name that looks like a replacement pattern"`: `printer: "$& {time}"` →
       `main` `toContain("$& {time}")`.
  - `notice-strip.a11y.test.ts`, inside the theme `describe.each`:
    `"has no violations with sixteen open, scrolling inside itself"`: notices
    `Array.from({ length: 16 }, (_, i) => ({ ...SPACE, key: \`space-${i}\` }))`; mount, click the
    button, `await el.updateComplete`; assert the list overflows —
    `el.shadowRoot!.querySelector("ul")!.scrollHeight` greater than its `clientHeight` — then
    `await expectNoA11yViolations(host)`.
- [ ] **Step 2: Run and watch them fail.** `memory_pressure | grep free` first.
  `pnpm --filter @waitron/till exec vitest run src/i18n/staff-notices.test.ts src/widgets/notice-strip.a11y.test.ts`
  → case 1 FAILS in both languages on its `toBeTypeOf("string")` line; case 3 FAILS (the till draws
  unknown); case 2 passes already — it pins that a malformed notice stays unknown, and Step 5 proves
  it; the sixteen-open case FAILS in both themes with `scrollable-region-focusable` (P5). Failure
  screenshots land in `src/widgets/__screenshots__/`; delete that untracked folder after the run.
- [ ] **Step 3: Implement** the words, the branch and `tabindex="0"` on the `<ul>`.
- [ ] **Step 4: Run and watch them pass; guard; typecheck; format.** The Step 2 command → PASS.
  `pnpm exec vitest run scripts/staff-notice-codes.test.ts` → `Tests 5 passed (5)` (no source names
  the code yet). `pnpm --filter @waitron/till typecheck` exits 0.
  `pnpm exec prettier --check apps/till/src/i18n/strings.ts apps/till/src/i18n/staff-notices.ts apps/till/src/i18n/staff-notices.test.ts apps/till/src/widgets/notice-strip.ts apps/till/src/widgets/notice-strip.a11y.test.ts`.
- [ ] **Step 5: Proofs by deletion**: remove `tabindex="0"` → the sixteen-open case FAILS
  (`scrollable-region-focusable`); drop the `since` check → case 2's `"not a time"` row FAILS; drop
  the non-empty check on `printer` → case 2's `printer: ""` row FAILS; use a string replacement for
  `{printer}` → case 3 FAILS (`$&` expands).
- [ ] **Step 6: Commit.**
  ```bash
  git add apps/till/src/i18n/strings.ts apps/till/src/i18n/staff-notices.ts apps/till/src/i18n/staff-notices.test.ts apps/till/src/widgets/notice-strip.ts apps/till/src/widgets/notice-strip.a11y.test.ts
  git commit -s -m "The till words a printer that is not printing, with the time of its oldest stuck ticket, and its long notice list can be scrolled from the keyboard"
  ```

### Task 3: The printer notice on the equipment read, for the devices it concerns

**Files:**
- Modify: `apps/server/src/box-staff-notices.ts` (new exports after `deviceNoticeSources`)
- Modify: `apps/server/src/device-api.ts` (`DeviceApiDeps.notices`, `:133-137`; the GET, `:406-418`)
- Modify: `apps/server/src/box-staff-notices.test.ts`
- Modify: `apps/server/src/device-equipment-api.test.ts` (cases in "GET /api/device/equipment's
  notices", `:1434`)
- Modify: `scripts/staff-notice-codes.test.ts:65-70` (declared change 2, its own commit)

**Interfaces** (`box-staff-notices.ts`):
```ts
/** Owner name of the printer notices; no module is named this. */
export const PRINTER_NOTICE_OWNER = "printers";
/** How long one read of the printers in trouble serves every device. */
export const PRINTER_NOTICE_CACHE_MS = 10_000;

/** The printers the device's receipts, payment slips and full invoices resolve to. */
export async function documentPrintersOf(tx: Transaction, deviceId: string): Promise<ReadonlySet<string>>;

/** A stuck kitchen printer for any device; another stuck printer only for a device in
 * `documentPrinters`. */
export function printerStaffNoticeSource(deps: {
  deviceId: string;
  trouble: (tx: Transaction, now: Date) => Promise<readonly PrinterInTrouble[]>;
  documentPrinters?: (tx: Transaction, deviceId: string) => Promise<ReadonlySet<string>>;
}): StaffNoticeSource;

/** One source per device, all reading the box location's printers in trouble through one cache. */
export function devicePrinterNoticeSources(deps: {
  now: () => Date;
  locationId: string;
  cacheMs?: number;
  trouble?: (tx: Transaction, now: Date, options: { locationId: string }) => Promise<readonly PrinterInTrouble[]>;
  documentPrinters?: (tx: Transaction, deviceId: string) => Promise<ReadonlySet<string>>;
}): (deviceId: string) => readonly OwnedStaffNoticeSource[];
```
`documentPrintersOf`: `readPrinterRoles(tx, deviceId)` (`@waitron/layouts`) filtered to roles
`receipt`, `payment_slip`, `invoice` with a non-null `resolvedId`. The source's `read({ tx, reading })`:
`rows = (await trouble(tx, reading.instant)).filter((r) => r.stuckSince !== null)`; none → `[]`; asks
`documentPrinters` only when some row is not a kitchen printer; keeps kitchen rows and rows whose id
is in the set; orders by `stuckSince`, then `name`; each becomes `{ key:
\`printer.jobs_waiting:${id}\`, code: "printer.jobs_waiting", severity: "warning", params: { printer:
name, since: new Date(stuckSince).toISOString() } }`. Defaults: `trouble = printersInTrouble`,
`documentPrinters = documentPrintersOf`, `cacheMs = PRINTER_NOTICE_CACHE_MS`.
`devicePrinterNoticeSources` makes one `createTtlCache<readonly PrinterInTrouble[]>({ ttlMs: cacheMs,
now })` and gives every device's source `trouble: (tx, at) => cache.get("all", () => trouble(tx, at,
{ locationId }))`, owner `PRINTER_NOTICE_OWNER`.

`DeviceApiDeps.notices` gains `deviceSources?: (deviceId: string) => readonly OwnedStaffNoticeSource[]`
("Sources that depend on which device asks; read after `sources`."). The GET reads
`[...sources, ...(deps.notices.deviceSources?.(device.deviceId) ?? [])]` through the same wrapping
and reader as today.

- [ ] **Step 1: Write the failing tests.**
  - `box-staff-notices.test.ts`, `describe("printer notices")`, with `CTX` (`:6-10`) and plain-object
    rows (`PrinterInTrouble`):
    1. `"a stuck kitchen printer shows on any device, without reading the device's printers"`:
       `trouble` → `[{ id: "k", name: "Kitchen", count: 1, oldest: "2026-10-22T09:50:00.000Z",
       stuckSince: "2026-10-22T09:55:00.000Z", kitchen: true }]`; `documentPrinters = vi.fn()` →
       `read(CTX)` `toEqual([{ key: "printer.jobs_waiting:k", code: "printer.jobs_waiting", severity:
       "warning", params: { printer: "Kitchen", since: "2026-10-22T09:55:00.000Z" } }])`;
       `documentPrinters` not called; `trouble` called with `(CTX.tx, AT)`.
    2. `"a printer in trouble that has printed since shows nothing"`: the same row with `stuckSince:
       null` → `toEqual([])`.
    3. `"another printer shows only on a device that prints its documents to it"`: rows `p1` and `p2`,
       both stuck and `kitchen: false`; `documentPrinters` → `new Set(["p2"])`, called with
       `(CTX.tx, "d1")` → only `p2`'s notice.
    4. `"orders the notices by when they got stuck, then by name"`: three kitchen rows given out of
       order → keys in order.
    5. `"no printer in trouble shows nothing and reads no device printers"`.
    6. `"devices share one read for ten seconds, then read again"`: a counting `trouble`, a settable
       `now`; `devicePrinterNoticeSources({ now, locationId: "loc", trouble, documentPrinters: async ()
       => new Set() })`; read `("d1")[0].source` and `("d2")[0].source` → 1 call, with `{ locationId:
       "loc" }`; `now` + 9 999 ms → read → 1; + 10 000 → read → 2. Both entries' `owner` is
       `"printers"`.
  - `device-equipment-api.test.ts`, inside "GET /api/device/equipment's notices": an app made with
    `noticeApp([], { deviceSources: devicePrinterNoticeSources({ now: () => READING.instant,
    locationId: venue.cfg.locationId, cacheMs: 0 }) })`; jobs inserted into `printJobs` at
    `venue.cfg.locationId` with `payload: Uint8Array.from([1])`, times relative to `READING.instant`,
    inserted in the order written:
    7. `"a stuck kitchen printer shows on both tills"`: printer "Kitchen", a `kitchenStations` row
       (`isDefault: false`, name "Kitchen"), its `stationPrinters` row, a queued job three minutes
       old → for `venue.cookie` and `venue.cookie2`, `notices` `toContainEqual({ owner: "printers",
       key: \`printer.jobs_waiting:${id}\`, code: "printer.jobs_waiting", severity: "warning",
       params: { printer: "Kitchen", since: <the job's time> } })`.
    8. `"a kitchen printer that printed a later ticket shows nothing, and the bell still names it"`:
       as 7, with the queued job replaced by a `failed` one at `MAX_DELIVERY_ATTEMPTS` ten minutes
       old, then a `done` document job five minutes old → no `printers` notice for either till; and
       `printingAlertSource().read` in a transaction still answers its `printer.jobs_waiting`.
       Control in the same case: delete the `done` job → the notice is back.
    9. `"a receipt printer's notice shows only on the till whose receipts go to it, and on one whose
       slips do"`: `choose(venue.cookie, "receipt", { id: fp }, "list")` and
       `choose(venue.cookie2, "receipt", { id: pp }, "list")` (each `200`); first assert the premise:
       `documentPrintersOf(tx, b)` does not contain `fp` (the profile's slip and invoice defaults are
       null in this fixture, `device-equipment-api.test.ts:120-130`, read by the claim check); a queued
       job on `fp` three minutes old → till A's notices hold one whose `key` is
       \`printer.jobs_waiting:${fp}\`, till B's hold no `printers` notice. Match by `key` only (or read
       the name from the database): the fixture names `fp` in Spanish (`:152`), and no new test line
       may write that name; then `choose(venue.cookie2, "payment_slip", { id: fp }, "list")` → B's hold it too.
    10. `"a ticket under two minutes old shows nothing"`: as 7 with the job one minute old.
    11. `"a failing printer check names only its owner, and the box's notices still come"`:
        `noticeApp([answering("box", notice("box-error", "error"))], { deviceSources: () => [{ owner:
        "printers", source: { read: () => Promise.reject(new Error("boom")) } }] })` →
        `noticesUnavailable` `toEqual(["printers"])`, `notices` holds `box-error`.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/box-staff-notices.test.ts src/device-equipment-api.test.ts`
  → FAILS: the new exports do not exist.
- [ ] **Step 3: Implement** as the Interfaces say. Then add `"printer.jobs_waiting"` to the
  `arrayContaining` list in `scripts/staff-notice-codes.test.ts:65-70` (declared change 2; committed
  separately in Step 6).
- [ ] **Step 4: Run and watch them pass; guards; typecheck; format.** The Step 2 command → PASS
  (`box-staff-notices.test.ts` 6 + 6 = 12; `device-equipment-api.test.ts` 85 + 5 = 90).
  `pnpm exec vitest run scripts/staff-notice-codes.test.ts` → `Tests 5 passed (5)`.
  `pnpm --filter @waitron/server typecheck` exits 0.
  `pnpm exec prettier --check apps/server/src/box-staff-notices.ts apps/server/src/box-staff-notices.test.ts apps/server/src/device-api.ts apps/server/src/device-equipment-api.test.ts scripts/staff-notice-codes.test.ts`.
- [ ] **Step 5: Proofs by deletion**: drop the `stuckSince !== null` filter → cases 2 and 8 FAIL;
  drop the kitchen short-cut (filter every row by the set) → cases 1 and 7 FAIL; drop the set filter →
  cases 3 and 9 FAIL; give each device its own cache → case 6 FAILS; drop `deviceSources` from the
  GET → cases 7–11 FAIL; delete the till's `staff_notice.printer.jobs_waiting` English line → the
  guard FAILS naming `printer.jobs_waiting`.
- [ ] **Step 6: Commit** — the code first, then the guard list change in a commit of its own. The
  order matters: the list may name the code only once `box-staff-notices.ts` spells it, or the
  guard's "finds the notice codes" case fails at that commit; and the code's own commit passes the
  guard because Task 2 already gave the till its words.
  ```bash
  git add apps/server/src/box-staff-notices.ts apps/server/src/box-staff-notices.test.ts apps/server/src/device-api.ts apps/server/src/device-equipment-api.test.ts
  git commit -s -m "The equipment read tells a till about a printer that has stopped printing: a kitchen printer on every till, another on the tills that print to it"
  git add scripts/staff-notice-codes.test.ts
  git commit -s -m "Changed test checks (A798 slice 10): the staff-notice guard expects to find the printer notice's code

  scripts/staff-notice-codes.test.ts:65-70 — before: arrayContaining the four codes; after: the same
  four plus \"printer.jobs_waiting\". A list gaining an entry, every existing value unchanged (owner's
  standing exception, 2026-09-27)."
  ```

### Task 4: Boot gives the equipment read the printer notices

**Files:**
- Modify: `apps/server/src/boot.ts` (`mountDeviceApi`'s `notices`, `:1845-1849`)
- Modify: `apps/server/src/boot.test.ts` (one case after "the equipment read carries the notice keys",
  `:2775-2800`, in the same `describe`)

**The wiring:** `deviceSources: devicePrinterNoticeSources({ now, locationId: till.locationId })`
beside `sources`, `clock` and `filing`.

- [ ] **Step 1: Write the failing test** `"the equipment read names a stuck kitchen printer"`, in the
  "SP-C dev override" `describe` (`:2719`), shaped like `:2775-2800`. Before `startServer` (CLAUDE.md
  §4: a test that starts the server in its own process writes only while it is down), in `sharedDb` at
  `cfg.locationId` (`loadTillConfig(TILL_ENV)`, as `:2727-2730`): a printer "Probe kitchen", a kitchen
  station (`isDefault: false`, name "Probe kitchen"), its `stationPrinters` row, and a queued document
  job created three minutes before `new Date()`. Then GET `/api/device/equipment` with
  `DEV_DEVICE_HEADER: deviceId1` → `notices` `toContainEqual(expect.objectContaining({ owner:
  "printers", code: "printer.jobs_waiting", params: expect.objectContaining({ printer: "Probe kitchen"
  }) }))`. In `finally`, after `server.close()`, delete the job, the station link, the station and the
  printer, in that order, so the shared venue's other cases do not see them.
- [ ] **Step 2: Run and watch it fail.**
  `pnpm --filter @waitron/server exec vitest run src/boot.test.ts -t "names a stuck kitchen printer"`
  → FAILS: no `printers` notice. (A name-filtered run proves only this case; CI runs the file.)
- [ ] **Step 3: Implement** the wiring.
- [ ] **Step 4: Run and watch it pass; neighbours; typecheck; format.** The Step 2 command → PASS.
  `pnpm --filter @waitron/server exec vitest run src/boot.test.ts -t "equipment read"` → PASS (both
  equipment cases). `pnpm --filter @waitron/server typecheck` exits 0.
  `pnpm exec prettier --check apps/server/src/boot.ts apps/server/src/boot.test.ts`.
- [ ] **Step 5: Proof by deletion**: remove `deviceSources` from boot → the case FAILS; pass another
  location id → the case FAILS.
- [ ] **Step 6: Commit.**
  ```bash
  git add apps/server/src/boot.ts apps/server/src/boot.test.ts
  git commit -s -m "Boot gives every till's equipment read the printer notices for its location"
  ```

### Task 5: `reader.offline`

**Files:**
- Modify: `apps/dashboard/src/i18n/alert-messages.ts` (an entry after `reader.status_unavailable`,
  `:336-339`)
- Modify: `apps/server/src/errors.ts` (`"reader.offline": { reader: string };` after `:287`)
- Modify: `apps/server/src/alert-sources.ts` (`batteryAlertSource`, `:773-857`)
- Modify: `apps/server/src/boot.ts` (`batteryCache`'s type, `:2160`)
- Modify: `apps/server/src/alert-sources.test.ts` (nine `createTtlCache<number | null>` become
  `createTtlCache<ReaderStatus>`; new cases)
- Modify: `apps/server/src/alerts-api.test.ts` (five `createTtlCache<number | null>` become
  `createTtlCache<ReaderStatus>`)
- Modify: `apps/dashboard/src/screens/box-status-rows.test.ts` (one case)

**The change:** `cache: Pick<TtlCache<ReaderStatus>, "get">`; the cache holds
`seat.readers.status(...)`'s whole answer; a reader's result is `{ kind: "reading", status }` or
`{ kind: "unavailable" }` as today. For a reading: when `status.online === false &&
status.unreachable !== true`, push `{ key: \`reader.offline:${r.id}\`, code: "reader.offline", params:
{ reader: r.name }, severity: "warning", since: null, screen: "payments" }`; then the battery exactly
as today from `status.batteryPercent ?? null`. The wording (decision 5):
`"reader.offline": { en: "“{reader}” is offline.", es: "«{reader}» está sin conexión." }`.

- [ ] **Step 1: Write the failing tests.**
  - `alert-sources.test.ts`, in `describe("batteryAlertSource")`, each provider made with
    `stubProvider` and its `readers.status` replaced:
    1. `"raises reader.offline for a reader its provider reports offline, beside its battery alert"`:
       "Terrace" answers `{ online: false, batteryPercent: 5 }`, "Counter" `{ online: true }` →
       `toEqual(expect.arrayContaining([{ key: \`reader.offline:${terraceId}\`, code: "reader.offline",
       params: { reader: "Terrace" }, severity: "warning", since: null, screen: "payments" },
       expect.objectContaining({ key: \`reader.battery_low:${terraceId}\` })]))`, and no alert keyed
       with `counterId`.
    2. `"says nothing about the connection when the provider could not read the status"`:
       `{ online: false, unreachable: true }` → `toEqual([])`.
    3. `"reads the status once for both checks within five minutes"`: `{ online: false }`, a counter;
       two reads four minutes apart → one provider call, and `reader.offline` in both answers.
  - `box-status-rows.test.ts`: `"a reader.offline alert turns the card readers row amber with its
    sentence"`: `boxStatusRows(<the file's healthy fixture with one reader>, [{ area: "card_reader",
    code: "reader.offline", params: { reader: "Reader 1" }, … }])`, in English as the file's other
    alert-line cases run (`:280`) → the `readers` row `toMatchObject({ state: "attention", line:
    alertMessage("reader.offline", { reader: "Reader 1" }, "en") })`, and its `line` `toContain("Reader
    1")`. The second check is what fails today: a code with no words gets the generic sentence
    (`packages/dashboard-kit/src/alert-messages.ts:84`) on both sides of the first (the claim check ran
    it: `expected 'Something needs attention' to contain 'Reader 1'`).
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/alert-sources.test.ts` → cases 1 and 3 FAIL (no
  `reader.offline`); case 2 passes already (it pins today's silence, P2; Step 5 proves it).
  `memory_pressure | grep free`, then
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/box-status-rows.test.ts` → the new case
  FAILS on `toContain("Reader 1")`.
- [ ] **Step 3: Implement**: the wording and the `errors.ts` entry first (so
  `scripts/ongoing-alert-codes.test.ts` stays green when the literal appears), then the source and
  the cache types in boot and the two test files.
- [ ] **Step 4: Run and watch them pass; guards; typecheck; format.**
  `pnpm --filter @waitron/server exec vitest run src/alert-sources.test.ts src/alerts-api.test.ts` →
  PASS (`alert-sources.test.ts` 89 + 3 = 92).
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/box-status-rows.test.ts src/i18n/alerts.test.ts`
  → PASS. `pnpm exec vitest run scripts/ongoing-alert-codes.test.ts` → `Tests 2 passed (2)`.
  `pnpm --filter @waitron/server typecheck` and `pnpm --filter @waitron/dashboard typecheck` exit 0.
  `pnpm exec prettier --check` on every file this task touched.
- [ ] **Step 5: Proofs by deletion**: drop `&& status.unreachable !== true` → case 2 FAILS; drop the
  push → cases 1 and 3 FAIL; delete the English wording → `ongoing-alert-codes` FAILS naming
  `reader.offline`.
- [ ] **Step 6: Commit.**
  ```bash
  git add apps/dashboard/src/i18n/alert-messages.ts apps/server/src/errors.ts apps/server/src/alert-sources.ts apps/server/src/boot.ts apps/server/src/alert-sources.test.ts apps/server/src/alerts-api.test.ts apps/dashboard/src/screens/box-status-rows.test.ts
  git commit -s -m "The bell says when a card reader is offline, and the Box status page's card readers row shows it"
  ```

### Task 6: Shared email pieces: the managers' addresses, a plain-text sender, settings in a caller's transaction

**Files:**
- Create: `apps/server/src/manager-email-recipients.ts` and `manager-email-recipients.test.ts`
- Modify: `apps/server/src/certificate-reminder-worker.ts` (`:61-87` becomes a call)
- Create: `apps/server/src/text-email.ts` (the body of `certificate-reminder-email.ts`, renamed)
- Modify: `apps/server/src/certificate-reminder-email.ts` (re-exports only)
- Modify: `apps/server/src/email-delivery.ts` (`resolveEmailDeliveryIn`, `:16-35`)
- Modify: `apps/server/src/email-delivery.test.ts` (one case)

**Interfaces:**
```ts
// manager-email-recipients.ts
export interface ManagerEmailRecipient {
  readonly personId: string;
  readonly email: string;
  readonly language: "en" | "es";
}
/** Every active person with an email address whose role holds `system.manage`: the address trimmed,
 * the language their own (`es-ES`, `en-GB`), else the venue's. */
export async function readManagerEmailRecipients(tx: Transaction, venueLanguage: "en" | "es"): Promise<ManagerEmailRecipient[]>;

// text-email.ts
export type TextEmailOutcome = "sent" | "rejected" | "unknown";
export type TextEmailSender = (message: { smtp: SmtpConnection; recipient: string; subject: string; text: string }) => Promise<TextEmailOutcome>;
export function createTextEmailSender(options?: { onFailure?: (reason: SmtpTestCode) => void }): TextEmailSender;

// certificate-reminder-email.ts — nothing else
export type { TextEmailOutcome as CertificateReminderOutcome, TextEmailSender as CertificateReminderSender } from "./text-email.js";
export { createTextEmailSender as createCertificateReminderSender } from "./text-email.js";

// email-delivery.ts
export async function resolveEmailDeliveryIn(tx: Transaction, ring: KeyRing, practiceMode: boolean): Promise<EmailDelivery>;
// resolveEmailDelivery(db, ring, practiceMode) = withTransaction(db, (tx) => resolveEmailDeliveryIn(tx, ring, practiceMode))
```
The recipients query and mapping are moved verbatim from `certificate-reminder-worker.ts:61-87`
(the order the rows come in is kept; callers do not sort).

- [ ] **Step 1: Write the failing tests.**
  - `manager-email-recipients.test.ts` (`useVenueDb({ migrations: migrationOptionsFor(manifestSets(),
    null) })`, a `person(displayName, values)` helper shaped like
    `certificate-reminder-worker.test.ts:46-55`): `"names every active manager and admin with an
    address, trimmed, in their own language or the venue's"`: an admin `es-ES` with
    `"  ana@example.test "`, a manager `en-GB`, a manager with no locale, a staff member with an
    address, a suspended manager with one (`status` as that test sets it), a manager whose address is
    `"   "` → with `"es"`, `toEqual` (sorted by `email` in the test) the first three, languages `es`,
    `en`, `es`, the first trimmed to `"ana@example.test"`.
  - `email-delivery.test.ts`: `"reads the settings inside a caller's transaction"`: with no
    credential row, `withTransaction(db, (tx) => resolveEmailDeliveryIn(tx, ring, false))` →
    `{ mode: "unconfigured" }`, and with `true` → equal to `resolveEmailDelivery(db, ring, true)`'s
    answer. Use the file's `ring` (`:27`).
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/manager-email-recipients.test.ts src/email-delivery.test.ts`
  → FAIL: the module and the export do not exist.
- [ ] **Step 3: Implement**: the three moves as the Interfaces say; the worker calls
  `readManagerEmailRecipients(tx, deps.venueLanguage)` where it built `recipients`.
- [ ] **Step 4: Run and watch them pass; the reminders unchanged; typecheck; format.** The Step 2
  command → PASS.
  `pnpm --filter @waitron/server exec vitest run src/certificate-reminder-worker.test.ts src/certificate-reminder-email.test.ts src/boot.certificate-reminders.test.ts`
  → PASS (`certificate-reminder-worker.test.ts` still 15). `pnpm --filter @waitron/server typecheck`
  exits 0. `pnpm exec prettier --check` on every file touched.
- [ ] **Step 5: Proofs by deletion**: drop the `system.manage` filter → the recipients case FAILS
  (the staff member appears), and so does the worker's "emails each active manager and admin" case;
  drop the trim → the recipients case FAILS.
- [ ] **Step 6: Commit.**
  ```bash
  git add apps/server/src/manager-email-recipients.ts apps/server/src/manager-email-recipients.test.ts apps/server/src/certificate-reminder-worker.ts apps/server/src/text-email.ts apps/server/src/certificate-reminder-email.ts apps/server/src/email-delivery.ts apps/server/src/email-delivery.test.ts
  git commit -s -m "Move the managers' email addresses, the plain-text sender and the email settings read where the box's other emails can use them"
  ```

### Task 7: The emails' words

**Files:**
- Create: `apps/server/src/i18n/box-emails.ts`
- Create: `apps/server/src/box-alert-email.ts` (this task: the code type and `boxEmailMessage` only)
- Create: `apps/server/src/box-alert-email.test.ts`

**Interfaces:**
```ts
// i18n/box-emails.ts
export const BOX_EMAIL_WORDS = { /* the words below */ } as const satisfies Record<
  string,
  Record<"en" | "es", { subject: string; text: string }>
>;

// box-alert-email.ts
export type BoxEmailCode = keyof typeof BOX_EMAIL_WORDS;
/** The codes the duty reads from the stop and the warning; every other code from module notices. */
export const STORAGE_EMAIL_CODES = ["storage.space_low", "storage.disk_full"] as const;
export function isBoxEmailCode(code: string): code is BoxEmailCode;
/** The subject and text for `code` in `language`, `{venue}` replaced by the venue's name. */
export function boxEmailMessage(code: BoxEmailCode, language: "en" | "es", venue: string): { subject: string; text: string };
```
`{venue}` is replaced everywhere with the function form of `replaceAll`, so a name such as `$&` stays
as it is.

**The words** (decision 11), verbatim:

- `storage.space_low`
  - en subject: `{venue}: the box is nearly out of disk space`
  - en text: `The box at {venue} has less than 2 GB of disk space left. Everything still works, but if the disk fills up nothing can be saved. See what is using the space on the Box status page: in the dashboard, Settings → Box status.`
  - es subject: `{venue}: al equipo le queda poco espacio en disco`
  - es text: `Al equipo de {venue} le quedan menos de 2 GB de espacio en disco. Todo sigue funcionando, pero si se llena no se podrá guardar nada. Mira qué ocupa espacio en Estado del equipo: en el panel de gestión, Ajustes → Estado del equipo.`
- `storage.disk_full`
  - en subject: `{venue}: the box is out of disk space and cannot save anything`
  - en text: `The box at {venue} is out of disk space, so nothing can be saved: no orders, payments or clock-ins. Free space on the Box status page (in the dashboard, Settings → Box status): its Free button deletes only files the box no longer needs. If that is not enough, ask whoever installed the box to free more space or fit a bigger disk.`
  - es subject: `{venue}: el equipo no tiene espacio en disco y no puede guardar nada`
  - es text: `El equipo de {venue} no tiene espacio en disco, así que no se puede guardar nada: ni pedidos, ni cobros, ni fichajes. Libera espacio en Estado del equipo (en el panel de gestión, Ajustes → Estado del equipo): su botón Liberar borra solo archivos que el equipo ya no necesita. Si no basta, pide a quien instaló el equipo que libere más espacio o ponga un disco mayor.`
- `clock.unusable`
  - en subject: `{venue}: sales can't be recorded because the box's clock is wrong`
  - en text: `The box at {venue} has its clock set before 28 October 2024, so no sale can be recorded for the tax agency until the clock is right. Connect the box to the internet; if its clock does not correct itself, ask whoever installed the box to set it.`
  - es subject: `{venue}: no se pueden registrar ventas porque la hora del equipo es incorrecta`
  - es text: `El equipo de {venue} tiene la hora puesta antes del 28 de octubre de 2024, así que no se puede registrar ninguna venta en Hacienda hasta que la hora sea correcta. Conecta el equipo a internet; si la hora no se corrige sola, pide a quien instaló el equipo que la ponga.`

The page and button names are the dashboard's own: "Settings" / "Ajustes"
(`apps/dashboard/src/i18n/strings.ts`, `nav.group.configuration`), "Box status" / "Estado del equipo"
(`nav.box_status`), "Free {size}" / "Liberar {size}" (`box_status.free`); "panel de gestión" is the
Spanish guides' name for the dashboard.

- [ ] **Step 1: Write the failing tests** in `box-alert-email.test.ts`:
  1. `it.each` over every code × `["en", "es"]`: `"words %s in %s with the venue's name"` →
     `boxEmailMessage(code, language, "Corner Bistro")` `toEqual({ subject:
     BOX_EMAIL_WORDS[code][language].subject.replaceAll("{venue}", "Corner Bistro"), text: …same… })`,
     and neither contains `"{"`.
  2. `"keeps a venue name that looks like a replacement pattern"`: venue `"$& Bar"` → the subject
     contains `"$& Bar"`.
  3. `"every code has a subject and a text in both languages, none blank"`.
  4. `"tells the storage codes from the rest"`: `isBoxEmailCode("clock.unusable")` true,
     `isBoxEmailCode("fiscal.records_unsent")` false, `isBoxEmailCode("clock.behind_chain")` false
     (slice 9 adds it); `STORAGE_EMAIL_CODES` `toEqual([…two…])`.
- [ ] **Step 2: Run and watch it fail.**
  `pnpm --filter @waitron/server exec vitest run src/box-alert-email.test.ts` → FAILS to resolve
  `./box-alert-email.js`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and watch it pass; typecheck; format.** `Tests` = 6 + 1 + 1 + 1 = 9 passed.
  `pnpm --filter @waitron/server typecheck` exits 0. `pnpm exec prettier --check
  apps/server/src/i18n/box-emails.ts apps/server/src/box-alert-email.ts apps/server/src/box-alert-email.test.ts`.
- [ ] **Step 5: Proof by deletion**: use string `replaceAll("{venue}", venue)` → case 2 FAILS.
- [ ] **Step 6: Commit.**
  ```bash
  git add apps/server/src/i18n/box-emails.ts apps/server/src/box-alert-email.ts apps/server/src/box-alert-email.test.ts
  git commit -s -m "Words for the managers' emails about the box's disk and clock, in English and Spanish"
  ```

### Task 8: The email duty: disk episodes, recipients and retries

**Files:**
- Modify: `apps/server/src/box-alert-email.ts`
- Create: `apps/server/src/box-alert-email.duty.test.ts`

**Interfaces** (added to `box-alert-email.ts`):
```ts
export const BOX_EMAIL_CHECK_MS = 60_000;

export interface BoxEmailContext {
  readonly venue: string;
  readonly recipients: readonly ManagerEmailRecipient[];
  readonly delivery: EmailDelivery;
}

/** Checks every `intervalMs`, the first one `intervalMs` after start, each next one armed after the
 * last finished. `stop` resolves once a database read in flight has finished; nothing is read or
 * sent after it. */
export function startBoxEmailDuty(deps: {
  disk: Pick<DiskFullState, "since">;
  space: Pick<FreeSpaceState, "current">;
  /** The enabled modules' notices, read in turns. */
  moduleNotices: () => Promise<StaffNoticesRead>;
  context: () => Promise<BoxEmailContext>;
  send: TextEmailSender;
  isPrimary: () => boolean;
  intervalMs: number;
  now: () => Date;
  log: Logger;
  timer?: (ms: number, fn: () => void) => Timer;
}): { stop: () => Promise<void> };
```
State, in the closure: `episodes: Map<string, { code: BoxEmailCode; sentTo: Set<string>;
said: Set<string>; logged: Map<string, Set<TextEmailOutcome>> }>`, keyed `storage.space_low`,
`storage.disk_full`, or `module:<owner>:<key>` (Task 9). One check, in order (this task: steps 1, 2,
4, 5, 6; Task 9 adds 3, the primary gate and the failure log):
1. Return (still arming the next timer) if stopped.
2. **Disk episode** (decision 6): `full = disk.since() !== null`, `low = space.current().lowSince !==
   null`. Neither → delete both storage episodes. Else want `storage.disk_full` when `full`; want
   `storage.space_low` when `low && !full && !episodes.has("storage.disk_full")`. Create a wanted
   episode if missing.
3. (Task 9) Module episodes.
4. If no episode is wanted at this check, done, with nothing read. Otherwise `ctx = await context()`
   once for this check — every minute while an episode lasts, even one every manager has received,
   so a manager added during it is found (decision 7).
5. For each wanted episode, in this order: `ctx.recipients` empty → log `box_email.no_recipients`
   (warn, `{ code }`) once per episode (`said`); next. `pending` = `ctx.recipients` whose key
   (`email.trim().toLowerCase()`) is not in `sentTo`; none → next. `ctx.delivery.mode ===
   "unconfigured"` → log `box_email.not_configured` (warn, `{ code }`) once per episode; next. Else
   for each pending recipient, in order, stopping if stopped: `outcome = await send({ smtp:
   ctx.delivery.smtp, recipient: r.email, ...boxEmailMessage(code, r.language, ctx.venue) })`, a throw
   counting as `"unknown"`; `sent` → add to `sentTo`, log `box_email.sent` (info, `{ code }`);
   `rejected` or `unknown` → nothing more here, so the recipient is pending again at the next check
   (decision 7). No address is ever logged.
6. A throw from `context()` (or, in Task 9, `moduleNotices()`) is caught and logged
   `box_email.check_failed` (warn, `{ errorCode: codeOf(error) }`); `finally` arms the next timer
   unless stopped.

- [ ] **Step 1: Write the failing tests** in `box-alert-email.duty.test.ts`. Fakes: the manual timer of
  `free-space-watch.test.ts:135-165` (each entry `{ ms, fn, cancelled }`) and its `tick`;
  `disk = { since: () => diskSince }`; `space = { current: (): FreeSpaceReading => (lowSince === null ?
  { freeBytes: null, readAt: null, lowSince: null } : { freeBytes: 1, readAt: lowSince, lowSince }) }`
  (`FreeSpaceReading` is a union whose `freeBytes: null` arm needs `lowSince: null`,
  `free-space-watch.ts:15-17`; the claim check's `tsc` refused the plain object); `moduleNotices =
  async () => ({ notices: [], unavailable: [] })`; `context = vi.fn(async () => ({ venue: "Corner
  Bistro", recipients, delivery }))` with `delivery = { mode: "smtp", smtp: { url:
  "smtp://127.0.0.1:1", from: "box@example.test" } }`; recipients `ana@example.test` (`es`) and
  `ben@example.test` (`en`); `send = vi.fn<TextEmailSender>(async () => "sent")`; a log spy; a settable
  `now`. Expected messages are built with `boxEmailMessage`. Cases:
  1. `"emails each manager once when the disk falls below 2 GB, in their own language"`: `lowSince`
     set → tick → two sends, ana with the `es` words and ben with the `en` words of
     `storage.space_low`; tick → no more.
  2. `"a box found full and low at once emails only the full disk"`.
  3. `"a disk going from low to full emails both, once each"`: low → tick (space_low ×2) → full → tick
     (disk_full ×2) → tick → nothing more.
  4. `"a stop that lifts and returns while space stays low sends nothing more"`: full and low → tick →
     `diskSince = null` (low stays) → tick → full again → tick → only the first tick's two sends.
  5. `"once both are off the episode ends, and the next fall emails again"`.
  6. `"a send that could not be made is tried the next minute; one already accepted is not"`: `send`
     answers `unknown` for ana the first time → tick (ana, ben) → tick (ana only) → tick (nothing).
  7. `"a send the mail server refused is tried again the next minute, and goes"`: `send` answers
     `rejected` for ben on the first tick (a 5xx such as a wrong password, `smtp-send.ts:24-31`) and
     `sent` after → tick (ana sent, ben refused) → tick (ben only, sent) → tick (nothing).
  8. `"a sender that throws counts as not sent"`: `send` rejects once for ana → the next tick sends to
     ana again.
  9. `"without email settings it sends nothing, says so once, and sends once settings appear"`:
     `{ mode: "unconfigured" }` → two ticks → no send, one `box_email.not_configured` line; then smtp
     → tick → two sends.
  10. `"a manager added during an episode gets it at the next check"`.
  11. `"with nobody to email it says so once"`: `recipients = []` → two ticks → one
      `box_email.no_recipients`.
  12. `"checks a minute after start, then a minute after each check finishes"`: right after start
      `armed` is `[{ ms: 60_000, … }]`; after a tick a second entry at `60_000`.
  13. `"a check whose reads throw is logged, and the next is armed"`: `context` rejects `new
      Error("boom")` → `["warn", "box_email.check_failed", { errorCode: "unknown" }]`, a timer at
      `60_000` armed.
  14. `"reads nothing when there is nothing to email"`: neither on → two ticks → `context` not called.
- [ ] **Step 2: Run and watch it fail.**
  `pnpm --filter @waitron/server exec vitest run src/box-alert-email.duty.test.ts` → FAILS:
  `startBoxEmailDuty` is not exported.
- [ ] **Step 3: Implement** steps 1, 2, 4, 5 and 6, with a `moduleNotices` that is accepted but not
  yet used, and `stop` setting `stopped` and cancelling the armed timer (Task 9 completes it).
- [ ] **Step 4: Run and watch it pass; typecheck; format.** `Tests 14 passed (14)`.
  `pnpm --filter @waitron/server typecheck` exits 0. `pnpm exec prettier --check
  apps/server/src/box-alert-email.ts apps/server/src/box-alert-email.duty.test.ts`.
- [ ] **Step 5: Proofs by deletion**, each restored before the next: drop
  `!episodes.has("storage.disk_full")` → case 3 FAILS (space_low emailed after the full disk) — if
  case 4 is what fails, say so; delete the storage episodes on every check instead of only when both
  are off → case 4 FAILS; drop the `sentTo` check → cases 1 and 6 FAIL; treat `rejected` as sent →
  case 7 FAILS; drop the `said` guard → cases 9 and 11 FAIL; drop the re-arm → case 12 FAILS; read
  `context` on every check → case 14 FAILS.
- [ ] **Step 6: Commit.**
  ```bash
  git add apps/server/src/box-alert-email.ts apps/server/src/box-alert-email.duty.test.ts
  git commit -s -m "A minute check emails the managers once when the box's disk is nearly full and once when it is full, retrying each minute until each is sent"
  ```

### Task 9: The email duty: module notices, the primary gate, stopping and logging

**Files:**
- Modify: `apps/server/src/box-alert-email.ts`
- Modify: `apps/server/src/box-alert-email.duty.test.ts`

**The additions:**
- Before step 2, `if (!deps.isPrimary())` the check reads and sends nothing (it still arms the next).
- Step 3, **module episodes** (decision 6): `read = await moduleNotices()`; for each notice with
  `isBoxEmailCode(code)` and a code not in `STORAGE_EMAIL_CODES`, want episode
  `module:${owner}:${key}` (create if missing). Then delete every `module:` episode whose owner is
  not in `read.unavailable` and which no notice of this read wants. Episodes of an owner in
  `read.unavailable` are neither created nor deleted by this read.
- **`stop()`** sets `stopped`, cancels the armed timer, and returns the promise of a `context()` or
  `moduleNotices()` call in flight (resolved, whatever it settles to), else a resolved promise. After
  `stopped`, no `context()`, `moduleNotices()` or `send` is started; a `send` already in flight is not
  awaited by `stop` (it can take 30 s, `smtp-send.ts:85`).
- **The failure log** (decision 8): when a send for a recipient fails with `outcome`, log
  `box_email.send_failed` (warn, `{ code, outcome }`) only if that episode's `logged` set for the
  recipient's key does not hold `outcome` yet; then add it. Nothing removes from the set within the
  episode, so a recipient gets at most two such lines per episode.

- [ ] **Step 1: Write the failing tests** (same fakes as Task 8):
  15. `"emails a module's clock notice once, and again in a new episode"`: `moduleNotices` answers
      `{ notices: [{ owner: "fiscal-verifactu", key: "clock.unusable", code: "clock.unusable",
      severity: "error", params: {} }], unavailable: [] }` → tick (two sends with the
      `clock.unusable` words) → tick (none) → answers no notice → tick → answers it again → tick (two).
  16. `"keeps a module's episode while its check fails"`: present → tick (two) → `{ notices: [],
      unavailable: ["fiscal-verifactu"] }` → tick → present → tick → still two sends in all.
  17. `"emails no module notice without email words"`: `fiscal.records_unsent` and
      `clock.behind_chain` → no send, `context` not called.
  18. `"a node that is not the primary reads and sends nothing"`: `isPrimary` false, low → two ticks →
      `context` and `moduleNotices` not called, no send; a timer armed after each.
  19. `"stop waits for a read in flight, and nothing is read or sent after it"`: `context` returns a
      held promise; low; call the armed `fn`; `stop()` → its promise is still pending (race it with a
      resolved marker); release the read → `stop()` resolves; `await new Promise((r) =>
      setImmediate(r))` twice → no send, `armed[0].cancelled` true, no new timer armed.
  20. `"stop during a send sends to no one after it"`: `send` holds its first call (ana's); low; call
      the armed `fn`; once `send` has been called, `stop()`; release ana's send with `"sent"`; two
      `setImmediate` turns → `send` was called once only (ben never), no new timer armed.
  21. `"logs each kind of failed send once per recipient, however the failures alternate"`: for ana,
      `rejected` on three ticks, then `unknown`, `rejected`, `unknown`, `rejected` on the next four →
      exactly two `box_email.send_failed` lines for the episode, `["warn", "box_email.send_failed", {
      code: "storage.space_low", outcome: "rejected" }]` then the same with `outcome: "unknown"`; then
      `sent` → one `box_email.sent` for ana, and still two failure lines.
- [ ] **Step 2: Run and watch them fail.** The Task 8 command → cases 15, 16, 18, 19, 20 and 21 FAIL;
  17 passes already (nothing reads module notices yet) — it pins that only worded codes are emailed,
  and Step 5 proves it.
- [ ] **Step 3: Implement** the additions.
- [ ] **Step 4: Run and watch it pass; typecheck; format.** `Tests 21 passed (21)`; typecheck;
  prettier as Task 8.
- [ ] **Step 5: Proofs by deletion**: drop the `unavailable` exemption → case 16 FAILS; drop
  `isBoxEmailCode` → case 17 FAILS; drop the primary gate → case 18 FAILS; make `stop` resolve at once
  → case 19 FAILS; drop the "stopping if stopped" check in the send loop → case 20 FAILS; log on
  every change of outcome (the revision-2 rule) → case 21 FAILS (it logs five lines).
- [ ] **Step 6: Commit.**
  ```bash
  git add apps/server/src/box-alert-email.ts apps/server/src/box-alert-email.duty.test.ts
  git commit -s -m "The managers' email check also sends the clock notice a module gives, only on the primary, logs a failing send once, and stops cleanly"
  ```

### Task 10: The email's reads answer on a full disk

**Files:**
- Modify: `apps/server/src/box-alert-email.ts` (`readBoxEmailContext`)
- Create: `apps/server/src/box-alert-email.context.test.ts`
- Modify: `apps/server/src/start-full-disk.e2e.test.ts` (one case after "the notice reader answers on
  a full disk with a change waiting…", `:701-773`)

**Interfaces:**
```ts
/** The venue's name, the managers' addresses and the email settings, read in one write-lock turn
 * with no change-log drain, so the reads answer on a full disk with a change waiting. */
export async function readBoxEmailContext(db: Database, deps: {
  ring: KeyRing;
  practiceMode: boolean;
  locationId: string;
  venueLanguage: "en" | "es";
}): Promise<BoxEmailContext>;
```
Inside `db.withWriteLock(async () => …)`, with `db` as the transaction (as `readStaffNoticesInTurns`
does, `staff-notices.ts:66`): `locations.name` for `locationId`, `readManagerEmailRecipients(db,
venueLanguage)`, `resolveEmailDeliveryIn(db, ring, practiceMode)`.

- [ ] **Step 1: Write the failing tests.**
  - `box-alert-email.context.test.ts` (`useVenueDb` with `migrationOptionsFor(manifestSets(), null)`;
    `seedTenant`, a `locations` row named "Corner Bistro", an admin with an address):
    `"reads the venue's name, the managers and the settings"` → `{ venue: "Corner Bistro", recipients:
    [<the admin>], delivery: { mode: "unconfigured" } }` with `practiceMode: false`, and
    `delivery.mode` `"local_capture"` with `true`. The ring: `tryGetCredential` returns before using
    it when no credential row exists (`packages/credentials/src/store.ts:47-51`); use the ring
    `email-delivery.test.ts:27` builds.
  - `start-full-disk.e2e.test.ts`: `"the managers' email reads its context on a full disk with a
    change waiting"`, the shape of `:701-773`: `needDisk(ctx)`, migrate, open, seed the tenant, a
    location and an admin with an address; insert a `change_log` row and checkpoint, as `:747-750`;
    `small.fill(0)`; then `readBoxEmailContext(db, { …, practiceMode: true })` resolves twice with the
    admin and `local_capture`; and the control `resolveEmailDelivery(db, ring, true)` (its
    `withTransaction`) rejects with `expect.objectContaining({ code: "storage.disk_full" })` in the
    same state — the claim check ran exactly this control and saw it refused (it answers when no
    change waits, so the `change_log` row is what makes the case). `small.unfill()` in `finally`;
    after unfilling, the `change_log` row is still there.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/box-alert-email.context.test.ts src/start-full-disk.e2e.test.ts`
  → the context case FAILS (`readBoxEmailContext` not exported) and the e2e file fails to import it.
  On macOS the e2e file makes its disk with `hdiutil`; on Linux without `WAITRON_FULL_DISK_DIR` it
  skips (CLAUDE.md §4) — read the `skipped` count before believing a pass.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and watch them pass; typecheck; format.** The Step 2 command → PASS, with the new
  e2e case run, not skipped. If the control does NOT reject, STOP and report (Review focus 2).
  `pnpm --filter @waitron/server typecheck`; prettier on the three files.
- [ ] **Step 5: Proof by deletion**: wrap the body in `withTransaction(db, …)` instead of the turn →
  the e2e case FAILS with `storage.disk_full`.
- [ ] **Step 6: Commit.**
  ```bash
  git add apps/server/src/box-alert-email.ts apps/server/src/box-alert-email.context.test.ts apps/server/src/start-full-disk.e2e.test.ts
  git commit -s -m "The managers' email reads who to write to and how, even when the disk is full"
  ```

### Task 11: Boot starts the email duty

**Files:**
- Modify: `apps/server/src/boot.ts` (after the free-space watch's `undoOnFailure.push`, `:2176`; the
  `closeAll` in `stopWork`, beside `() => freeSpaceWatch.stop()`, `:2836`)
- Create: `apps/server/src/boot.box-emails.test.ts`
- Modify: `apps/server/src/boot.failed-start.test.ts` (a `vi.mock` for `./box-alert-email.js` beside
  the free-space one, `:87-90`; a spy helper beside the free-space one, `:180-190`; two cases beside
  the free-space watch's two, `:577` and `:916`)

**The wiring:**
```ts
const emailNoticeLog = createStaffNoticeLog(log);
const emailNoticeSources = enabledStaffNoticeSources(setsToMigrate);
const boxEmails = startBoxEmailDuty({
  disk: diskFull,
  space: freeSpace,
  moduleNotices: async () => {
    const reading = emailNoticeLog.begin();
    const read = await readStaffNoticesInTurns(
      db,
      emailNoticeSources.map(({ owner, source }) => ({
        owner,
        source: { read: (ctx) => source.read({ ...ctx, filing: { enabled: filesRecords() } }) },
      })),
      { reading: tillClock.now(), log: emailNoticeLog.log },
    );
    reading.settle(read.unavailable);
    return read;
  },
  context: () =>
    readBoxEmailContext(db, {
      ring,
      practiceMode: config.devMode || till.practiceMode === true,
      locationId: till.locationId,
      venueLanguage: venueLocale === "es-ES" ? "es" : "en",
    }),
  send: createTextEmailSender(),
  isPrimary: () => holders.singletonRole.current === "primary",
  intervalMs: BOX_EMAIL_CHECK_MS,
  now,
  log,
});
undoOnFailure.push(() => boxEmails.stop());
```
and `() => boxEmails.stop()` in `stopWork`'s `closeAll`, which runs before the store closes. Every
name used is in scope there (the claim check listed each one's line).

- [ ] **Step 1: Write the failing tests.**
  - `boot.box-emails.test.ts`, copied in shape from `boot.free-space.test.ts` (its env, migrations
    copy, `setupVenue`, cookies). A hoisted holder `{ deps: undefined, armed: [], sent: [] }`;
    `vi.mock("./box-alert-email.js")` wraps the real `startBoxEmailDuty`, keeping every dep but
    passing the manual timer, `send: async (m) => { holder.sent.push(m); return "sent"; }`, and
    `context: async () => ({ ...(await deps.context()), delivery: { mode: "smtp", smtp: { url:
    "smtp://127.0.0.1:1", from: "box@example.test" } } })`, and saving the deps. One `it`,
    `"boot emails the managers when the disk is full, once"`. **Order, against a race:** a noted stop
    is cleared by any `disk.full()` call that finds room — the free-space watch's next reading or any
    gated write (`free-space-watch.ts:74`, `disk-full-gate.ts:37`) — so take the manager's cookie and
    do every request that writes **before** noting the stop, then: `holder.deps.disk.noteRefused()`;
    one bell read (`/management-api/alerts`, a read) shows `storage.disk_full` in area `box`, so the
    duty was given boot's stop; assert `holder.deps.disk.noted()` is still true; tick at once →
    `holder.sent` is one message to `owner@example.test` (`setupVenue`'s admin) whose subject is
    `boxEmailMessage("storage.disk_full", <the admin's language>, <the location's name read from the
    database>).subject`; tick → still one. The admin has no locale and the venue is `es-ES`, so the
    language is `es`; the test reads both from the database rather than writing them in. If the
    `noted()` check fails, the stop was cleared before the tick: report it rather than retrying.
  - `boot.failed-start.test.ts`: `"in trading mode, when a step after the listener is started throws,
    stopping the managers' email check"` and `"stops the managers' email check"`, the shapes of the
    free-space watch's two cases (adapted to a `stop` that returns a promise).
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/boot.box-emails.test.ts src/boot.failed-start.test.ts`
  → the new cases FAIL (`holder.deps` undefined; the spy's `stop` never called).
- [ ] **Step 3: Implement** the wiring.
- [ ] **Step 4: Run and watch them pass; neighbours; typecheck; format.** The Step 2 command → PASS.
  `pnpm --filter @waitron/server exec vitest run src/boot.free-space.test.ts src/boot.certificate-reminders.test.ts src/boot.disk-full-wiring.test.ts`
  → PASS. `pnpm --filter @waitron/server typecheck`; prettier on the three files.
- [ ] **Step 5: Proofs by deletion**: drop the `closeAll` entry → "stops the managers' email check"
  FAILS; drop the `undoOnFailure` push → the failed-start case FAILS.
- [ ] **Step 6: Commit.**
  ```bash
  git add apps/server/src/boot.ts apps/server/src/boot.box-emails.test.ts apps/server/src/boot.failed-start.test.ts
  git commit -s -m "Boot starts the managers' email check about the box's disk and clock, and stops it on close and on a failed start"
  ```

### Task 12: `waitron.sh install` switches on time synchronisation

**Files:**
- Modify: `deploy/waitron.sh` (a function after `disable_bluetooth_autopair`, `:248-319`; a call in
  `cmd_install` after `disable_bluetooth_autopair`, `:622`)
- Modify: `scripts/waitron-sh.test.mjs` (a `timedatectl` stub beside `systemctl`'s, `:250-264`, and
  its comment block, `:31-63`; a `describe` just before the health-check one, `:1156`)

**The function** (decision 14):
```bash
# A box whose clock reads earlier than its last sale stops taking payments, so install asks the host
# to keep its clock right where it can.
enable_time_sync() {
  local limit
  limit="$(command -v gtimeout || command -v timeout)" || limit=""
  if as_root ${limit:+"$limit" 60} timedatectl set-ntp true >/dev/null 2>&1; then
    echo "waitron.sh: asked the system to keep its clock in step with internet time (timedatectl set-ntp true)"
  else
    echo "waitron.sh: could not switch on the system's time synchronisation ('timedatectl set-ntp true' failed, or this system has no timedatectl). Unless another time service runs on this machine, nothing keeps its clock right, and Waitron stops taking payments while the clock reads earlier than its last sale — check the clock, and install and enable a time service such as systemd-timesyncd if there is none" >&2
  fi
}
```
**The stub:** `stub("timedatectl", '[ "${WT_TIMEDATECTL_FAIL}" = "1" ] && { echo "Failed to set ntp: NTP not supported" >&2; exit 1; }; exit 0')`
— logged like every stub; `sandbox()` gains `timedatectlFail = false` → `WT_TIMEDATECTL_FAIL`. The
comment block gains one sentence: `timedatectl` is stubbed so no case reaches a real one on a Linux
machine, and fails when `WT_TIMEDATECTL_FAIL=1`.

- [ ] **Step 1: Write the failing tests**, `describe("waitron.sh install and the host's time
  synchronisation")`:
  1. `"asks the system to keep its clock in step, and says so"`: `run(sb, ["install"])` → status 0; a
     logged call `timedatectl set-ntp true`; `stdout` contains `asked the system to keep its clock in
     step with internet time`; the `timedatectl` call comes before `compose up -d`.
  2. `"carries on, and says what that means, when the system cannot switch it on"`:
     `timedatectlFail: true` → status 0; `stderr` contains `could not switch on the system's time
     synchronisation` and `Unless another time service runs on this machine`; `compose up -d` still
     logged.
  3. `"leaves time synchronisation alone on reset"`: `installedBox(sb)` (`:1226-1229`),
     `run(sb, ["reset", "--yes"])` → no `timedatectl` call.
  4. `"refuses a production reset install before touching the clock"`: the production-refusal setup of
     "refuses on a production box before fetching the box's files…" (`:1471`) → no `timedatectl` call.
- [ ] **Step 2: Run and watch them fail.** `pnpm exec vitest run scripts/waitron-sh.test.mjs` →
  cases 1 and 2 FAIL (no call, no line); 3 and 4 pass already (they pin where it must not run;
  Step 5 proves each).
- [ ] **Step 3: Implement** the stub, the function and the call.
- [ ] **Step 4: Run and watch it pass.** The Step 2 command → `Tests 108 passed (108)` (104 + 4; the
  claim check ran these exact cases to that count). `pnpm exec vitest run
  scripts/deploy-image-env.test.ts` → PASS (98; it holds every apt-get to `apt_get`, and this adds
  none). `pnpm exec prettier --check scripts/waitron-sh.test.mjs`. `bash -n deploy/waitron.sh` exits 0.
- [ ] **Step 5: Proofs by deletion**: remove the call → case 1 FAILS; make the `else` branch `exit 1`
  → case 2 FAILS; also call `enable_time_sync` at the top of `cmd_reset` → case 3 FAILS; move the
  call in `cmd_install` above the `confirm_reset` block → case 4 FAILS.
- [ ] **Step 6: Commit.**
  ```bash
  git add deploy/waitron.sh scripts/waitron-sh.test.mjs
  git commit -s -m "waitron.sh install asks the host to keep its clock in step with internet time, and says plainly when it cannot"
  ```

### Task 13: `waitron.sh install` deletes the images the box ran before

**Files:**
- Modify: `deploy/waitron.sh` (two functions before `cmd_install`, `:607`; `cmd_install`, `:624-630`)
- Modify: `scripts/waitron-sh.test.mjs` (the docker stub's `ps -q`, `compose up`, `inspect` and
  `image` arms, `:105-106`, `:144`, `:147-162`, `:163-172`; `sandbox()`; the comment block; a new
  `describe`)

**The functions** (decision 15):
```bash
# The image each Waitron container runs now, one id per line; nothing for a service not running.
running_images() {
  local service container image
  for service in app print-agent; do
    container="$(docker compose -f "$WAITRON_DIR/compose.yml" ps -q "$service" 2>/dev/null)" || continue
    [ -n "$container" ] || continue
    image="$(docker inspect -f '{{.Image}}' "$container" 2>/dev/null)" || continue
    printf '%s\n' "$image"
  done
}

# Deletes each image in $1 that no Waitron container runs any more. On Docker's containerd image
# store an image whose tag has moved is already gone, so `inspect` skips it; without -f, Docker
# refuses an image any container still uses.
delete_previous_images() {
  local before="$1" now id
  now="$(running_images)"
  while IFS= read -r id; do
    [ -n "$id" ] || continue
    printf '%s\n' "$now" | grep -qxF -- "$id" && continue
    docker image inspect "$id" >/dev/null 2>&1 </dev/null || continue
    if docker image rm "$id" >/dev/null 2>&1 </dev/null; then
      echo "waitron.sh: deleted the image this box ran before the upgrade (${id#sha256:})"
    else
      echo "waitron.sh: could not delete the image this box ran before the upgrade, $id; it still takes disk space — 'docker image rm $id' deletes it once nothing uses it" >&2
    fi
  done <<<"$before"
}
```
In `cmd_install`, right after `cd "$WAITRON_DIR"` and before the wipe block: `local before;
before="$(running_images)"`; and the last line becomes
`if wait_healthy; then delete_previous_images "$before"; announce_ready; else report_unhealthy; fi`.
`cmd_reset` is unchanged. No `prune` of any kind (decision 15).

**The stub** models both stores (P10):
- `compose up` writes `${WT_LOG}.up` (`: > "${WT_LOG}.up"`) and `compose down` writes
  `${WT_LOG}.down` (`: > "${WT_LOG}.down"`); both exit 0 as today. (`up|down) ;;` at `:144` becomes
  two arms.)
- `ps -q app` / `ps -q print-agent`: `WT_NO_CONTAINERS=1` answers nothing, as today; the new
  `WT_NO_CONTAINERS=before` answers nothing until `${WT_LOG}.up` exists (a first install); and both
  arms answer nothing after a `down` until the next `up` — each echoes its container only when
  `{ [ ! -e "${WT_LOG}.down" ] || [ -e "${WT_LOG}.up" ]; }` — so the stub models `down` removing the
  containers. The round-3 check measured this change (`a798-10-plan-check3/scripts/`): with it the
  "record `before` after the wipe" proof fails case 7, and the whole file passes `Tests 116 passed
  (116)`; without it that proof left every case green.
- `inspect -f {{.Image}}`: with `WT_OLD_IMAGES=1` and no `${WT_LOG}.up`, `sha256:old-app` for
  `app-container` and `sha256:old-agent` for `agent-container`; else today's ids.
- `docker image inspect <id>`: absent when `WT_IMAGE_STORE=containerd` and the id starts
  `sha256:old-` (the containerd store, where the old id is gone once its tag moved); the existing
  `WT_IMAGE_MISSING` behaviour otherwise; present by default (the classic store).
- `docker image rm`: logged; exits 1 when `WT_RMI_FAIL=1`.
- `sandbox()` gains `oldImages`, `imageStore`, `rmiFail`. The comment block says what each models.

- [ ] **Step 1: Write the failing tests**, `describe("waitron.sh install deletes the images the box ran
  before")`:
  1. `"on the classic store, deletes both old images once the new box is healthy, and says so"`:
     `oldImages: true` → status 0; among the logged calls, a line **equal to** `docker image rm
     sha256:old-app` and one equal to `docker image rm sha256:old-agent` (whole-line equality, e.g.
     `loggedCalls(sb).indexOf(…)`, so a `-f` cannot slip in), each after the last `compose ps
     --format` health probe; `stdout` contains
     `deleted the image this box ran before the upgrade (old-app)`.
  2. `"keeps the old images when the new box does not come up healthy"`: `oldImages: true, dockerPs:
     "unhealthy"` → status not 0; no `docker image rm`.
  3. `"deletes nothing when the box runs the same images as before"`: default stub → no `docker image
     rm`.
  4. `"deletes nothing on a first install"`: `WT_NO_CONTAINERS=before` → status 0; no `docker image
     rm`.
  5. `"on the containerd store, where the old images are already gone, deletes nothing and says
     nothing"`: `oldImages: true, imageStore: "containerd"` → status 0; no `docker image rm`, no
     `prune` in any logged call, no `deleted the image` in `stdout`, nothing about images in `stderr`.
  6. `"carries on, and says so, when an old image cannot be deleted"`: `oldImages: true, rmiFail:
     true` → status 0; `stderr` contains `could not delete the image this box ran before the upgrade,
     sha256:old-app`; the ready links still printed.
  7. `"records the old images before --reset install takes the box down"`: `installedBox(sb)`,
     `oldImages: true`, `run(sb, ["--reset", "--yes", "install"])` → both `rm`s logged, after `compose
     up -d`.
  8. `"reset deletes no image"`: `installedBox(sb)`, `oldImages: true`, `run(sb, ["reset", "--yes"])`
     → no `docker image rm`.
- [ ] **Step 2: Run and watch them fail.** `pnpm exec vitest run scripts/waitron-sh.test.mjs` → cases
  1, 6 and 7 FAIL (no deletion); 2, 3, 4, 5 and 8 pass already (they pin where it must not delete;
  Step 5 proves each).
- [ ] **Step 3: Implement** the stub changes, the two functions and the two `cmd_install` lines.
- [ ] **Step 4: Run and watch it pass.** `Tests 116 passed (116)` (108 + 8). Every existing case passes
  unchanged: the new `ps -q`/`inspect` calls land in arms that answer before the health-probe counter
  (`:105-106`); the claim check ran the first revision's versions of these functions with the
  existing suite to 116. `pnpm exec vitest run scripts/deploy-image-env.test.ts` → PASS. `bash -n
  deploy/waitron.sh`; prettier on the test file.
- [ ] **Step 5: Proofs by deletion**, each restored before the next: call `delete_previous_images`
  before `wait_healthy` → case 2 FAILS; drop the `grep -qxF` skip → case 3 FAILS; drop `[ -n "$id" ] ||
  continue` → case 4 FAILS (with no containers before and two after, the empty id reaches `docker image
  inspect ""`, which the stub answers as present, and `rm` is logged); drop the `inspect` skip → case
  5 FAILS (`rm` is logged); record `before` after the wipe block → case 7 FAILS (only with the stub's `down` marker); add
  `-f` to the `rm` → case 1 FAILS; also call
  `delete_previous_images` from `cmd_reset` → case 8 FAILS.
- [ ] **Step 6: Commit.**
  ```bash
  git add deploy/waitron.sh scripts/waitron-sh.test.mjs
  git commit -s -m "waitron.sh install deletes the images the box ran before an upgrade, once the new ones are healthy, where Docker has not freed them already"
  ```

### Task 14: Guides, the deploy README, developer docs and the backlog

**Files:**
- Modify: `apps/server/src/guide/en/till-notices.md` and `apps/server/src/guide/es/till-notices.md`
  (`{#notices}`, `:21`)
- Modify: `apps/server/src/guide/en/box-status.md` and `apps/server/src/guide/es/box-status.md`
  (`{#rows}`'s Card readers bullet, `:42-44`; a new section `{#emails}` after `{#clock-behind}`)
- Modify: `deploy/README.md` ("Setting up a box", after the Bluetooth paragraph; "Updating and
  operating")
- Modify: `docs/developers/conventions-ui.md` (`:1582-1612`), `docs/developers/design-system.md`
  (`:5317-5320`), `docs/developers/conventions-data.md` (`:2555-2749`)
- Modify: `docs/backlog.md` (the A798-B entry `:4631-4650`; `:4683-4686`; delete `:4710-4711` and
  `:4790-4793`; new entries), `docs/backlog/box.md` (the B3 bullet, `:389-396`)
- Modify: `docs/superpowers/specs/2026-10-19-a798-degraded-trading-design.md` (§11, a dated note)

Follow `~/.claude/docs-writing-style.md`. Every sentence states what the code does after this slice,
nothing more (CLAUDE.md §1); the English guide uses English names in its examples.

- [ ] **Step 1: The till guide**, English and Spanish, in `{#notices}` before the unknown notice:
  "**Printer “Kitchen” not printing · since 21:16** is amber. A ticket sent to that printer at 21:16
  has waited two minutes or more without printing. A kitchen printer's notice shows on every till and
  handheld; any other printer's only on the tills and handhelds that print their receipts, payment
  slips or full invoices to it. Check the printer's paper, power and cable. The notice goes once the
  printer prints anything sent to it after that ticket; the ticket itself may still need reprinting
  from the table or resending from **Printers**." The Spanish twin in the same place, with the till's
  own Spanish words for the notice.
- [ ] **Step 2: The Box status guide**, both languages. In `{#rows}`, the Card readers bullet's "The
  page does not check whether each reader is switched on: it only shows problems the box already
  knows about." becomes "A reader its card provider reports as offline shows here, as **“Bar” is
  offline.** While the bell or this page is open, the box asks the provider at most every five
  minutes, so it can show a few minutes late." A new section **Emails about the box** `{#emails}`
  after `{#clock-behind}`: who gets them (people who can manage the system and have an email address);
  when (the disk under 2 GB, the disk full, the clock set before 28 October 2024); one email per
  problem, and if it cannot be sent — no internet, or the mail server refuses it, for example because
  the email settings have a wrong password — it is tried again each minute while the problem lasts,
  until the mail server accepts it, so it arrives once the connection or the settings are fixed; if the
  problem ends first (space freed, clock fixed), the retries stop and nothing is sent; a restart while the problem
  lasts can send it again; nothing is sent while the email settings are empty; and "A box whose clock
  reads before 28 October 2024 usually cannot send its email: with a date that early it cannot check
  the mail server's certificate." (P8). The clock-behind email is not listed: slice 9 adds it.
- [ ] **Step 3: `deploy/README.md`.** After the Bluetooth paragraph: every `install`, upgrades
  included, runs `timedatectl set-ntp true` as root under a 60-second limit and prints one line either
  way; where that fails or there is no `timedatectl`, it says that unless another time service runs on
  the machine nothing keeps its clock right, and to check the clock and install a time service such as
  `systemd-timesyncd`, and carries on; why (a clock earlier than the last sale stops payments); and
  that it switches synchronisation back on even where someone switched it off, so a test box whose
  clock is set wrong on purpose needs it switched off again after each install. In "Updating and
  operating": after an `install` whose box comes up healthy, each image the `app` and `print-agent`
  containers ran before that Docker still holds is deleted with `docker image rm` (never forced), with
  one line each, and a deletion Docker refuses is reported and does not stop the install; on Docker's
  containerd image store, the default for a fresh Docker Engine 29 install, the old pulled image is
  already gone and its space freed by Docker when the container is replaced, so nothing is printed;
  images from before this release, the mail capture's old images and Docker's build cache from branch
  installs are not deleted (`docker image prune` and `docker builder prune` do that by hand, and also
  delete what other software on the machine left); `reset` deletes no image.
- [ ] **Step 4: Developer docs.**
  - `conventions-ui.md`: in **Notices**, one sentence: the read's sources are the box's (`box`), the
    enabled modules', then the per-device printer source (`printers`, `deviceSources` in
    `apps/server/src/device-api.ts`), which reads its location's printers in trouble at most once per
    ten seconds for every device together, and names a printer only while it is stuck (no later
    document on it has printed). In **A notice code's words**, the bullet at `:1611` becomes: "It asks
    `staffNoticeText` with one set of params (a count of 2, none held, a printer named "Kitchen" and a
    time), so a branch that words some params as unknown is checked only for those."
  - `design-system.md`, the notice strip's **Several** bullet: the list "scrolls inside itself past
    half the screen height, and takes keyboard focus so it can be scrolled from the keyboard".
  - `conventions-data.md`, "A read on a full disk must not fail on its own housekeeping write"
    (`:2555`): one paragraph: since A798-B slice 10 the managers' email check reads the venue's name,
    the managers' addresses and the email settings in one `withWriteLock` turn with no drain
    (`readBoxEmailContext`, `apps/server/src/box-alert-email.ts`), so the full-disk email can be
    prepared on a full disk; the case is "the managers' email reads its context on a full disk with a
    change waiting" in `start-full-disk.e2e.test.ts`.
- [ ] **Step 5: The backlog** (`docs/backlog.md`).
  - The A798-B entry (`:4646`): in "…landed in #2012; slice 9 is next.", insert before "slice 9 is
    next" the clause "slice 10 (emails to the managers about the disk and a clock before 28-10-2024,
    `reader.offline`, the printer notice on every till, and `waitron.sh` switching on time
    synchronisation and deleting the images an upgrade replaced) landed;". Do not touch the slice 8
    text.
  - "The Clock row says 'connect the box to the internet' where that may not help" (`:4683-4686`):
    "On a box that does not keep its clock in step with internet time, until slice 10 switches that on
    at install;" becomes "On a box that does not keep its clock in step with internet time (since
    A798-B slice 10, `waitron.sh install` switches synchronisation on where the system provides it,
    and says so where it cannot);". The rest of the entry stays.
  - Delete "The card readers row does not say whether a reader is switched on" (`:4710-4711`) and
    "The open notice list cannot be scrolled from the keyboard once it overflows" (`:4790-4793`):
    this slice closes both.
  - "The clock stop's email is slice 9's" (`:4651-4655`) stays as it is; append one sentence: "Slice
    10's sender (`apps/server/src/box-alert-email.ts`) sends any module notice code that has words in
    `apps/server/src/i18n/box-emails.ts`, but fills only `{venue}`: slice 9 adds
    `clock.behind_chain`'s words there and also carries the notice's values (`{clockAt}`,
    `{lastRecordAt}`) into them — the episode keeps the notice's params and passes them to
    `boxEmailMessage`, which gains the placeholders. A clock set earlier than the mail server's
    certificate start cannot send either (an inference from slice 10's plan P8, not measured)."
  - New entries, each "Left open by A798-B slice 10":
    - "**The bell's printer check reads every print job.** `EXPLAIN QUERY PLAN` shows `SCAN
      print_jobs`: 0.25 ms with no printed jobs, 3.7 ms with 50 000 (slice 10 plan P4). A redundant
      status condition did not change the plan; why SQLite scans is not established. The bell pays it
      on every read; the till's printer notices share one read per ten seconds."
    - "**A card reader whose status the provider could not read raises nothing.** SumUp and Stripe
      answer `{ online: false, unreachable: true }` rather than throwing, so
      `reader.status_unavailable` comes only from a throw or the 45 s deadline (slice 10 plan P2)."
    - "**Does a SumUp Solo that is on but idle report itself offline?** The owner's unused Solo read
      `OFFLINE` (slice 10 plan P11), and SumUp's client maps anything but `ONLINE` to offline, so if an
      idle Solo does the same, the bell carries a standing `reader.offline` warning. For the owner to
      check against the reader."
    - "**The email about a clock set before 28 October 2024 rarely leaves the box.** With a date that
      early the box cannot check a mail server's certificate (`CERT_NOT_YET_VALID`, slice 10 plan P8),
      so the email waits until the clock is fixed, when there is nothing left to say. A plain relay or
      the practice box's local capture does receive it. For the owner to know."
    - "**`waitron.sh` deletes only the images the box ran just before an upgrade.** Images left by
      upgrades before slice 10 and the mail capture's old images are not deleted, nor is Docker's build
      cache from branch installs, which holds most of a rebuilt image's space."
    - "**A printer that prints some documents and fails others loses its till notice.** The notice goes
      once any later document on the printer prints (slice 10 decision 18), while the bell keeps
      naming the printer until the failed ticket is reprinted or resent."
  - `docs/backlog/box.md`, the B3 bullet (`:395`): "A798-B switches the host's synchronisation on at
    `waitron.sh install`; the image makes it standing." becomes "Since A798-B slice 10,
    `waitron.sh install` runs `timedatectl set-ntp true` and says so, or says that unless another time
    service runs nothing keeps the clock right; the image makes it standing."
- [ ] **Step 6: The design's §11**, a dated note after the three at `:1404-1408`: "**2026-10-23:**
  A798-B slice 10's plan measured that an `unreachable` reader status raises nothing (P2), so §2.4's
  `reader.status_unavailable` comes only from a throw or the deadline; that a clock before 28-10-2024
  cannot open a TLS mail connection (P8), so that condition's email rarely leaves the box; and that on
  Docker's containerd image store an upgrade's old pulled image is freed by Docker itself (P10), so on
  that store the old `app` and `print-agent` images do not pile up; the mail capture's old images stay
  on both stores."
- [ ] **Step 7: Check and commit.** `pnpm exec prettier --check deploy/README.md` (and `--file-info`
  on the `docs/` files, which print `"ignored": true`). The guides:
  `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` → PASS (the twins' ids
  match) and `pnpm exec vitest run scripts/guide-links.test.ts` → PASS. `pnpm exec vitest run
  scripts/claude-md-pointers.test.ts` → PASS. Grep the branch's diff for Spanish outside the
  translation files and the Spanish guides, over the branch's own commits only, added lines only, whole
  words only, and outside `docs/` (so this plan's own quotations of the design are not counted):
  `git diff origin/main...HEAD -- apps packages scripts deploy ':!**/i18n/**' ':!apps/server/src/guide/es/**' | /usr/bin/grep -E '^\+' | /usr/bin/grep -n -i -w -E 'cocina|barra|casa pepe|terraza|impresora|está'`
  → no line (exit 1). This command came from the round-3 check and was not run against a built
  branch: when the plan was written the branch held only the plan, so it printed nothing either way.
  Then:
  ```bash
  git add apps/server/src/guide/en/till-notices.md apps/server/src/guide/es/till-notices.md apps/server/src/guide/en/box-status.md apps/server/src/guide/es/box-status.md deploy/README.md docs/developers/conventions-ui.md docs/developers/design-system.md docs/developers/conventions-data.md docs/backlog.md docs/backlog/box.md docs/superpowers/specs/2026-10-19-a798-degraded-trading-design.md
  git commit -s -m "Guides, the deploy README, developer docs and backlog for the managers' emails, offline readers, the printer notice and the install's new steps"
  ```

## Pull request notes

The pull request description says, in plain words:
- The two changed test checks in `scripts/staff-notice-codes.test.ts` (`:49`, `:65-70`), before and
  after, and which owner exception each falls under.
- That the email about a clock before 28 October 2024 usually cannot leave the box (P8), and why it is
  built anyway (decision 10).
- That a failed send is retried every minute, refusals included, so an address the server always
  refuses is tried once a minute while the problem lasts (decision 7).
- That the till's printer notice goes once the printer prints a later document, while the bell and
  the table's banner keep naming the ticket it gave up on until it is reprinted (decision 18).
- That a printer notice and an offline reader can show up to ten seconds and five minutes late
  (decisions 4 and 5), and that an idle SumUp Solo may read as offline (P11).
- That `waitron.sh install` now switches the host's time synchronisation on at every install and,
  after a healthy upgrade, deletes the previous images on the classic image store; on the containerd
  store Docker has already freed them (decisions 14 and 15, P10).

---

## Self-review against the spec

- §8 item 10, emails (red conditions and 2 GB warning): Tasks 6–11; the clock-behind email is slice
  9's, through this duty (decision 9). "Once per episode … held in memory" (`:508-511`, §7
  `:1173-1175`): decisions 6–7, Tasks 8–9. "Retried each minute until sent once" (`:1159-1160`):
  decision 7, Task 8 cases 6–8 (refusals included). To `system.manage` holders with an address:
  Task 6. The full disk can still send: decision 13, Task 10.
- `reader.offline` (`:492-493`, `:526-527`): Task 5, decisions 5 and 12.
- The printer notice (question 2, `:459`, `:522-525`, `:1271-1274`, `:1279`; "goes when the problem
  goes", `:438-440`): Tasks 1–4, decisions 1–4 and 18.
- `waitron.sh` time synchronisation (`:718-724`, `:1384-1388`): Task 12, decision 14. Old Docker
  images (`:324-325`, `:603-605`): Task 13, decision 15, P10.
- Backlog entries naming slice 10 (`docs/backlog.md:4683-4686`, `:4710-4711`, `:4790-4793`): Tasks 5,
  2 and 12, updated or closed in Task 14.
- Build plan Part 1 row 10 (LIGHT, no migration, lands itself, depends on slices 5 and 6, built before
  9): Review path, Global constraints, decisions 9 and 17.

## Review findings folded (revision 2)

From `round1.md`:
- **I1** (slice 8 landed): rebased onto `20be7ebb5`; every citation re-read (base note); decision 9
  and Task 14 Steps 5–6 rewritten for slice 9; Task 14 edits main's A798-B sentence and the `:4683`
  entry, and appends to (rather than duplicates) "The clock stop's email is slice 9's".
- **I2** (refused sends wait a day): decision 7 — every failure retried the next minute; Task 8 case 7
  (a refused send retried and sent); Task 9 case 21 (logged once per kind per recipient; round 3 tightened it); the guide says so.
- **I3** (Spanish in tests): English names throughout; Global constraints and Task 14 Step 7's grep.
- **I4** (notice outlives a printing printer): decision 18 — the design's "goes when the problem goes"
  applied to the notice; `stuckSince` in Task 1 (cases 3–4, both sides), Task 3 cases 2 and 8; bell
  unchanged and pinned; the guide says what clears it.
- **M1** (time-sync line): decision 14 and Task 12's line no longer claim nothing keeps the clock;
  the README's every-install sentence (Task 14 Step 3).
- **M2** (reader check frequency): decision 5 and the guide sentence.
- **M3** (kitchen printers and location): decision 1, Task 1 case 7, Task 3's `locationId`, Task 4.
- **M4** (sleeping Solo): P11 measured the owner's unused Solo (`OFFLINE`); whether an idle-but-on one
  does is not established — decision 5, Codex brief, PR notes, backlog.
- **M5** (deletion proofs): Task 12 Step 5 (cases 3, 4), Task 13 Step 5 (cases 4, 8, with the new
  `WT_NO_CONTAINERS=before` knob so the `[ -n "$id" ]` proof bites), Task 9 case 20.
- **M6** (boot test race, Codex experiment): Task 11's ordering and `noted()` check; the Codex brief.
- **M7** (wording): "Printer “{printer}” not printing"; English examples in the English guide.
- **M8** (case 7's premise): Task 3 case 9 asserts B's roles first.
- **Q5** (exceptions): `:49` cites "adding what a fixture lacks".

From `claim-check.md`:
- **I1**: as round 1's I1.
- **I2** (containerd store): measured both stores in isolated daemons (P10); decision 15 rewritten —
  delete by id where it still exists, which frees the space on the classic store, and nothing to do
  on the containerd store, where Docker freed it; no prune, with the receipt; both stores modelled in
  the stub (Task 13).
- **M1** (fake does not typecheck): Task 8's `space` fake.
- **M2** (scan cause): Task 14's backlog sentence no longer gives a cause; P4 says it is not
  established.
- **M3** (line ranges): `nextNotices :23-37`, `StaffNoticeReadContext :17-24`, `printJobInTrouble
  :38-78`.
- **M4** (`smtp-test-message.ts`): added to P9.
- **M5** (Task 2 case 1's failure): the case now fails on its own `toBeTypeOf("string")` line.

## Round 3 findings folded (revision 3)

From `round3.md`:
- **I1** (slice 9 "with no other change" was false): decision 9 and Task 14's backlog sentence now say
  slice 9 must also carry the notice's values (`{clockAt}`, `{lastRecordAt}`) into the email words —
  keep the starting notice's params on the episode, pass them to `boxEmailMessage`, add the
  placeholders. Not built here, as ruled.
- **I2** (failure log repeated on every flip): an episode keeps, per recipient, the set of failure
  kinds already logged — at most two lines per recipient per episode (decision 8, Task 8's state,
  Task 9's failure log); case 21 now alternates refused and no-connection and expects exactly two
  lines; the proof "log on every change of outcome" makes it fail.
- **I3** (the "record before the wipe" proof did not bite): the stub's `down` writes a marker and the
  container lookups answer nothing after it until the next `up`, the change the round-3 check measured
  (`Tests 116 passed`, and the proof then fails case 7).
- **M1** (the Spanish grep): replaced with the round-3 check's command (the branch's own commits,
  added lines, whole words, outside `docs/`); the plan says it was not run against a built branch.
- **M2**: `clockTime` is `apps/till/src/i18n/t.ts:154`.
- **M3**: the design's §11 note no longer says old images are a classic-store problem only; the mail
  capture's old images stay on both stores.
- **M4**: Task 3 case 9 matches the notice by `key` and never writes the fixture's Spanish name.
- **M5**: Task 13 case 1 compares the whole `docker image rm sha256:old-app` line; proof "add `-f` →
  case 1 FAILS".
- **M6**: the guide says the retries stop when the problem ends, and nothing is sent then.
- **M7**: the far-behind-clock sentence is marked an inference from P8, not measured.
