# A798-B slice 10 — emails about the box, `reader.offline`, the printer notice, and `waitron.sh`

> **No migration.** Nothing in this slice adds or changes a table, an index or a trigger.
>
> **Nothing fiscal.** No task touches an invoice, the record chain or its hashes, invoice series or
> numbering, or AEAT filing. The email duty reads the Veri\*Factu module's staff notices through the
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
> **Existing assertions.** This plan changes exactly two existing test checks, both in
> `scripts/staff-notice-codes.test.ts`, declared here so no implementer has to decide them:
> 1. `:49`, the params `wordedAsUnknown` asks `staffNoticeText` with, `{ count: 2, held: 0 }`, gains
>    `printer: "Cocina", since: "2026-10-23T19:16:00.000Z"` (Task 2). Without it the guard fails on
>    the printer notice's code even when the till words it (measured, P3). The two existing keys and
>    their values are unchanged, and no existing code's wording reads `printer` or `since`.
> 2. `:65-70`, the `expect.arrayContaining([...])` of "finds the notice codes it is meant to guard",
>    gains `"printer.jobs_waiting"` (Task 3). Every existing entry stays.
>
> Both fall under the owner's standing exception (2026-09-27, about 19:10): an assertion that pins a
> whole shape, such as a list, may gain the entry a new field adds, provided every existing value is
> unchanged. Each goes in its own commit whose message begins `Changed test checks (A798 slice 10):`
> and names the `file:line` with its before and after, and the pull request names both. Everything
> else this plan touches in existing tests is new cases, mocks, type arguments of a test cache, or
> helpers. Any other assertion that turns out to need changing is a STOP: report it, do not edit it.
>
> **Size.** Each task is sized for one implementer well under 100 tool calls. An implementer past
> about 150 calls with the task unfinished stops at a passing or cleanly red point, commits, and
> returns a handover: done, left, files, each check's state.
>
> Every `file:line` below was read at `main` `3d4a2a4ce` (2026-10-23), this branch's base
> (`feat/a798-10-emails-and-install`, worktree `waitron-feat-a798-10-emails-and-install`). Every
> claim about how the box, Docker or a host behaves today cites a probe in "Measured for this plan",
> run that day on macOS (Darwin 25.6.0), Node v26.11.1, Docker 29.3.0 (Docker Desktop): scripts and
> logs under `~/waitron-campaign-b/a798-10-plan-probe/`, Vitest probes in a throwaway worktree of
> `3d4a2a4ce` (`git worktree add --detach`, `pnpm install --frozen-lockfile --offline`: `Done in 4s`,
> `install.log`), since removed. A claim marked **(read)** comes from reading code, not running it.
> Nothing was measured on a real box's Linux.

**Words used in this plan.**
- The **stop** is slice 3's full-disk stop, `DiskFullState` (`apps/server/src/disk-full-state.ts`):
  `since()` is not null while it is on.
- The **warning** is slice 5's low-space state, `FreeSpaceState` (`apps/server/src/free-space-watch.ts`):
  `current().lowSince` is not null from a reading below 2 GiB until one at 2.5 GiB or more.
- A **notice** is one staff notice (`StaffNotice`, `packages/module/src/staff-notices.ts`), shown on
  the till's strip. An **owner** is the name a notice source is filed under; the till keeps an owner's
  last notices when its check fails (`nextNotices`, `apps/till/src/state/staff-notices.ts:23-41`).
- A printer is **in trouble** when one of its document jobs has waited two minutes without printing,
  or failed with no tries left, as `printJobInTrouble` decides
  (`apps/server/src/print-job-trouble.ts:7-8`, `:24-37`); the bell's `printer.jobs_waiting` reads it.
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
line when a kitchen printer stops printing, and a device whose receipts go to a stopped printer
shows it too; and `waitron.sh install` switches on the host's time synchronisation where the system
provides it, says so either way, and deletes the images the box ran before an upgrade once the new
ones are healthy.

**Architecture:** five pieces, each small.
1. **Printer notices** (Tasks 1–4): `printersInTrouble` (`print-job-trouble.ts`) lists each active
   printer in trouble with its oldest job and whether it is a kitchen printer; the bell's printing
   source and a new per-device notice source both read it. The equipment read
   (`GET /api/device/equipment`) gains a per-device source list (`deviceSources`), because a notice
   source's context names no device (`StaffNoticeReadContext`, `packages/module/src/staff-notices.ts:18-25`).
   The till words the new code.
2. **`reader.offline`** (Task 5): the battery check keeps the provider's whole status answer and
   raises `reader.offline` when the provider says the reader is offline.
3. **Shared email pieces** (Task 6): the managers' address list and a plain-text sender moved out of
   the certificate reminders, and the email settings read inside a caller's transaction.
4. **The email duty** (Tasks 7–11): `apps/server/src/box-alert-email.ts` checks every minute, works
   out which episodes are on from the stop, the warning and the modules' notices, and sends each
   recipient each episode's email once, in their language, with words from
   `apps/server/src/i18n/box-emails.ts`. Its database reads run in a write-lock turn with no drain,
   so the full-disk email can be read on a full disk. Boot starts it in trading mode.
5. **`deploy/waitron.sh`** (Tasks 12–13): `enable_time_sync` and `delete_previous_images` in
   `cmd_install`.

**Tech stack:** TypeScript, Hono, Vitest 4 (Node for `apps/server` and the root guards; real headless
Chromium for `apps/till` and `apps/dashboard`), bash under the stubs of `scripts/waitron-sh.test.mjs`.

**Spec:** [A798 — Degraded but trading](../specs/2026-10-19-a798-degraded-trading-design.md),
revision 6. Build plan: [2026-10-21-a798-b-degraded-trading-build.md](2026-10-21-a798-b-degraded-trading-build.md)
Part 1, row 10 (risk triggers: none; LIGHT; no migration; lands itself; depends on slices 5 and 6,
both landed: #1963, #1977). Backlog: A798-B (`docs/backlog.md:4632`), "The card readers row does not
say whether a reader is switched on" (`:4664-4665`) and "The open notice list cannot be scrolled from
the keyboard once it overflows" (`:4744-4747`), both of which name slice 10.

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
  (`:445-447`): "The core supplies the disk and printer notices". §4.4 (`:522-525`) and the owner's
  answer to question 2 (`:1271-1274`): "From two minutes every till and handheld shows the amber
  strip 'Impresora Cocina no imprime · desde 21:16'; a receipt printer only on the devices whose
  receipts go to it; the sending device's own table banner stays as today."
- §4.8 b (`:718-724`): "Nothing in `deploy/` turns that on today … So the build adds it to
  `deploy/waitron.sh install`, which is already run with `sudo` on the host …: it switches on the
  host's time synchronisation where the system provides it, and prints a line when it does not."
- §2.6 (`:324-325`): "old Docker images left by upgrades, which nothing in `deploy/waitron.sh`
  deletes (grep for `prune`, `rmi`: no match)". §4.6 item 6 (`:603-605`): "Deleting old images after
  an upgrade is a follow-up for `deploy/waitron.sh` (slice 10)."
- §10 (`:1384-1388`): time synchronisation in the box image is B3's; "this design only switches
  synchronisation on at `waitron.sh install`".
- The clock-behind-the-chain email (§4.8 c) is slice 8's, with its alert; this slice builds the
  duty it will add one code to (decision 9).

---

## Measured for this plan

Logs and scripts are under `~/waitron-campaign-b/a798-10-plan-probe/`. Vitest probes ran with
`env -u AI_AGENT -u CLAUDECODE … --silent=false` in the throwaway worktree, each probe file restored
with `git checkout` after its run.

- **P1 — baselines, in this worktree, no edits.**
  `pnpm --filter @waitron/server exec vitest run src/alert-sources.test.ts src/box-staff-notices.test.ts src/device-equipment-api.test.ts src/certificate-reminder-worker.test.ts src/staff-notices.test.ts`
  → `Tests 220 passed (220)` (`b1-server.log`); one file at a time (`b3-server-per-file.log`):
  `alert-sources.test.ts` 89, `box-staff-notices.test.ts` 6, `device-equipment-api.test.ts` 85,
  `certificate-reminder-worker.test.ts` 15.
  `pnpm exec vitest run scripts/staff-notice-codes.test.ts scripts/ongoing-alert-codes.test.ts scripts/alert-codes.test.ts scripts/waitron-sh.test.mjs scripts/deploy-image-env.test.ts`
  → `Tests 213 passed (213)` (`b2-root.log`); one at a time (`b4-root-per-file.log`):
  `staff-notice-codes` 5, `ongoing-alert-codes` 2, `waitron-sh.test.mjs` 104, `deploy-image-env` 98.
- **P2 — what the battery check says today for a reader its provider reports offline, or cannot
  read.** A probe `describe` added to `apps/server/src/alert-sources.test.ts` before
  `describe("batteryAlertSource"`, reusing its `seedReader`, `stubProvider` and `readBattery`, with
  `readers.status` answering four shapes (`p1-reader-offline.log`, `Tests 4 passed | 89 skipped`):
  `{ online: false }` → `[]`; `{ online: false, batteryPercent: 50 }` → `[]`;
  `{ online: false, unreachable: true }` → `[]`; control `{ online: true, batteryPercent: 5 }` →
  `["reader.battery_low"]`. Failing case for "an offline reader raises nothing today": any `reader.*`
  code on the first two lines. The control shows the probe reaches the source. The third line is
  why decision 12 exists: SumUp and Stripe answer a status they could not read with
  `{ online: false, unreachable: true }` rather than throwing (`packages/payments-sumup/src/card-provider.ts:241-245`,
  `packages/payments-stripe/src/card-provider.ts:236`, `:251-252`) **(read)**, and the check raises
  `reader.status_unavailable` only on a throw or its 45 s deadline (`alert-sources.ts:801-816`).
- **P3 — the staff-notice guard and a code whose words need params.** Throwaway: a
  `code: "printer.jobs_waiting"` literal appended to `apps/server/src/box-staff-notices.ts`,
  `staff_notice.printer.jobs_waiting` added to both languages in `apps/till/src/i18n/strings.ts`, and
  a `staffNoticeText` branch that words it only with a string `printer` and a parseable `since`.
  `pnpm exec vitest run scripts/staff-notice-codes.test.ts` → `× the till words every notice code, …
  as more than 'needs attention'`, `expected [ 'printer.jobs_waiting' ] to deeply equal []`,
  `Tests 1 failed | 4 passed (5)` (`p2-guard-params.log`). Control: with `:49`'s params extended as
  declared above → `Tests 5 passed (5)`. Failing case for "the guard's params must change": a pass
  without the extension. It failed.
- **P4 — the printer-trouble read scans every print job.** A probe in `alert-sources.test.ts` seeded
  two printers, 50 000 printed (`done`) jobs and two stuck ones, then timed twenty
  `printingAlertSource().read` calls (`p3-trouble-timing.log`): median `3.70` ms, max `4.85`; the
  control with 0 printed jobs: median `0.25` ms, max `0.38`. The query's plan (`p3b-trouble-plan.log`,
  `EXPLAIN QUERY PLAN` of the source's own `.toSQL()`) starts `SCAN print_jobs`. Adding a redundant
  `inArray(printJobs.status, ["queued", "printing", "failed"])` to `printJobInTrouble` left it a scan
  (`p3c-plan-conjunct.log`: `SCAN print_jobs`; 20 runs of the bare query 56–58 ms at 50 000 rows) —
  so the scan is not fixed by a predicate, and this slice does not try (decision 4). Failing case
  for "the read grows with the print history": the same time at 0 and 50 000 rows. It grew about
  15×.
- **P5 — the open notice list fails axe once it overflows, and `tabindex="0"` fixes it.** A probe
  case in `apps/till/src/widgets/notice-strip.a11y.test.ts` (Chromium; 55% memory free before the
  run) opened the strip with N copies of the `SPACE` notice, keys made unique (`p4-strip-scroll.log`,
  `p4b-violation-full.log`): at N = 4, 8, 12 the list did not overflow (`scrollHeight=396
  clientHeight=396` at 12, `innerHeight=896`) and axe passed; at N = 16 and 20 it overflowed
  (`scrollHeight=528 clientHeight=447`) and failed in both themes with `scrollable-region-focusable
  [serious]: Scrollable region must have keyboard access`, target `till-notice-strip,#notice-list`.
  Control: the same cases with `ul.setAttribute("tabindex", "0")` → `Tests 4 passed`. The failing
  case is the 16-notice run; the control is the fix.
- **P6 — time synchronisation on Debian and Ubuntu.** `docker run --rm --pull=never <image>` with
  `command -v timedatectl` and `dpkg -l systemd systemd-timesyncd` (`t1-images.log`): `debian:12`,
  `debian:13` and `ubuntu:24.04` images have neither `timedatectl` nor `systemd` (container images
  are minimal; a host is not). With `apt-get update` and `apt-get install -y systemd`
  (`t2-systemd.log`): Debian 12 lists `systemd-timesyncd` `Priority: standard`, Ubuntu 24.04
  `Priority: important`; `apt-cache depends systemd` names `|Recommends: systemd-timesyncd` (with
  chrony, ntpsec and openntpd as alternatives) on both; installing `systemd` alone pulled
  `systemd-timesyncd` in on both. Then `timedatectl set-ntp true` printed `System has not been booted
  with systemd as init system (PID 1). Can't operate.` / `Failed to connect to bus: Host is down`,
  `exit=1`, and `timedatectl show -p NTP --value` the same, `exit=1`. What this shows: the command
  can be absent, and where present it can fail, so the script must treat both as "the system does
  not provide it" and carry on (Task 12). Not measured: `timedatectl set-ntp true` on a booted host
  (whether it succeeds, and whether it is quick) — nothing here boots systemd.
- **P7 — what `docker image rm <id>` does** (`rmi-probe.sh`, `t3-rmi.log`). Images built from
  `FROM scratch` under names only this probe used (`a798probe-*`), removed by name afterwards
  (`0` left): (1) an image a created, stopped container uses → `conflict: unable to delete … (must be
  forced) - image is being used by stopped container`, `exit=1`, image still present; (2) the same
  image after its tag was rebuilt over → already gone, `No such image`, `exit=1`; (3) an image with
  one tag and no container → `Untagged: …`, `Deleted: sha256:…`, `exit=0`; (4) an image tagged in two
  repositories → `conflict: … image is referenced in multiple repositories`, `exit=1`, still present.
  The daemon's storage is the containerd snapshotter (`driver-type
  io.containerd.snapshotter.v1`), which is why (2) found the old image already gone; a box on the
  classic `overlay2` store may keep it as an untagged image instead — not measured. Failing case for
  "`rm` without `-f` never deletes an image a container uses": `exit=0` on (1). It printed `exit=1`.
- **P8 — a clock before 28 October 2024 cannot open a TLS mail connection** (`tls-probe.js`,
  `t4-tls-clock.log`), in `node:26.11.1-slim` with `faketime` installed: control, real clock
  (`2026-10-23T06:05:55Z`) → `secureConnect authorized=true` to `smtp.gmail.com:465`; under
  `faketime "2001-01-01 00:00:00"` → `error CERT_NOT_YET_VALID`; under `faketime "2024-10-27 12:00:00"`
  → `error CERT_NOT_YET_VALID`. What this shows: with a clock before the first issue date, a mail
  server whose certificate was issued after that date (any server today, measured on one) refuses
  the handshake, so the `clock.unusable` email usually cannot leave the box until the clock is right
  (decision 10). Not measured: a plain, unencrypted relay, which has no certificate to check.
- **P9 — text searches** (`p9-searches.log`): `prune`, `rmi` or `image rm` in `deploy/waitron.sh`:
  none (`exit=1`); `timedatectl`, `timesyncd`, `chrony` or `ntp` in `deploy/waitron.sh`,
  `deploy/compose.yml`, `deploy/Dockerfile`: none; `reader.offline` as code: none (one test title in
  `apps/till/src/widgets/reader-picker.test.ts:42` says "reader offline" in words); `timedatectl` in
  `scripts/waitron-sh.test.mjs`: none — so no stub stands in for it today, and on a Linux machine
  with a real `timedatectl` an unstubbed call would reach the real one (Task 12); `sendSmtpMessage`'s
  callers: `account-email.ts`, `attendance-email.ts`, `certificate-reminder-email.ts`,
  `smtp-send.ts` itself.
- **Not measured:** anything on a real box; a booted host's `timedatectl`; an SMTP send from the
  duty to a real server (the duty's tests use a fake sender, Task 11's boot test the real wiring
  with a fake sender, and the Codex seat is asked for a real one under Review focus).

---

## Decisions this plan makes that the design does not

Each is a DEFAULT to build; the owner or the plan review may overrule any.

1. **Which devices show a printer's notice.** A kitchen printer in trouble shows on every device; any
   other printer only on a device whose receipt, payment-slip or full-invoice printer resolves to it
   (`readPrinterRoles`, `packages/layouts/src/device-equipment.ts:354-360`; the roles the till's
   printing uses, `apps/server/src/receipt-print.ts:81-128`). Why a kitchen printer by its stations
   rather than by which job is stuck: the owner's reason for question 2 is that "every waiter sending
   food needs to know to walk to the kitchen" (`:1288-1289`), and a dead kitchen printer whose only
   stuck job is a receipt is still dead before the next ticket is sent. Why slips and full invoices
   too, beyond the design's "receipts": a device whose slips go to a stopped printer depends on it
   the same way. Cost if wrong: a device sees a notice for a printer it prints only its slips or
   full invoices to.
2. **The notice's words and params.** Code `printer.jobs_waiting` — the bell's code for the same
   condition (`alert-sources.ts:438-439`), so one condition has one name; severity `warning`; key
   `printer.jobs_waiting:<printer id>`; params `{ printer: <name>, since: <oldest stuck job's time,
   ISO> }`. The till draws `staff_notice.printer.jobs_waiting`, "{printer} printer not printing" /
   "Impresora {printer} no imprime", then " · " and `staff_notice.since`, "since {time}" / "desde
   {time}", with the time as the till already writes one (`clockTime`, `apps/till/src/i18n/t.ts:98-100`).
   The design's English example, "Kitchen printer not printing", translated the printer's name
   "Cocina"; a printer's name is the venue's data and is never translated, so English reads "Cocina
   printer not printing". A notice whose `printer` is not a non-empty string, or whose `since` does
   not parse, is drawn as unknown, as a malformed count is (`apps/till/src/i18n/staff-notices.ts:30`).
3. **The printer notice rides on the equipment read only, under a new owner `printers`.** Not the
   Box status page, whose Printers row already shows the bell's printer alerts
   (`apps/dashboard/src/screens/box-status-rows.ts:59`). A separate owner, so a failed printer check
   keeps only the printer notices the till last showed, not stale disk notices
   (`nextNotices`, `apps/till/src/state/staff-notices.ts:23-41`). `printers` is no module's name
   (`packages/composition/src/modules.ts:141-360`, the names listed) **(read)**. Its source runs after
   the box's and the modules' sources; the reader orders by severity first
   (`apps/server/src/staff-notices.ts:102`), so where it sits matters only among warnings, after
   `storage.space_low`.
4. **One printer-trouble read per ten seconds for the whole box.** The per-device source reads
   `printersInTrouble` through one ten-second cache shared by every device
   (`createTtlCache`, `apps/server/src/ttl-cache.ts`, which also shares a read in flight). Why: every
   signed-in device asks every 15 s (`apps/till/src/state/equipment-poll.ts:4`, read in slice 6),
   each source runs in a write-lock turn (`readStaffNoticesInTurns`, `staff-notices.ts:55-71`), and
   the read scans every print job (P4: 3.7 ms at 50 000). With the cache, devices add no scans.
   Cost: a printer notice can appear or clear up to ten seconds late, on top of the 15 s poll. The
   scan itself, which the bell pays on every read, is recorded as backlog (Task 14), not fixed here.
5. **`reader.offline`.** Raised when the provider answers `online: false` without
   `unreachable: true`: warning, area `card_reader`, permission `payments.manage`, `since: null`,
   screen `payments`, key `reader.offline:<reader id>`, params `{ reader: <name> }` — the shape of its
   siblings (`alert-sources.ts:819-846`). It shares the battery check's five-minute cache
   (`boot.ts:2160`), which now keeps the whole status answer (`ReaderStatus`) instead of the battery
   figure, so it adds no provider call; an offline reader can therefore show up to five minutes
   late. The words are the design's, quoted as their siblings quote a name: "“{reader}” is offline." /
   "«{reader}» está sin conexión." The Box status page's Card readers row shows it with no change
   there, because the row takes every `card_reader` alert (`box-status-rows.ts:60`) and shows the
   first one's sentence (`:134-136`).
6. **What is emailed, and an episode of each.**
   - `storage.space_low` and `storage.disk_full` come from the stop and the warning, not from the
     notices. The two share one **disk episode**, from the first check that finds the stop on or the
     warning on until a check finds both off. In a disk episode, `storage.disk_full` is emailed once,
     the first time the stop is found on; `storage.space_low` is emailed once, the first time the
     warning is found on while the stop is off and before any `storage.disk_full` email in that
     episode. So a disk going from low to full sends both, once each; a box found full and low at
     once sends only the full disk; a stop that lifts and returns while space stays under 2.5 GiB
     sends nothing more, which is what keeps a disk hovering at full from emailing every few minutes
     (the stop lifts at 16 MiB, `boot-failure.ts:47`; the warning clears only at 2.5 GiB,
     `free-space-watch.ts`). Cost: a free-space reading the filesystem never gives leaves the warning
     off (slice 5 decision 8), so on such a disk a stop that lifts and returns starts a new episode.
   - Any other code with email words (today only `clock.unusable`) comes from the enabled modules'
     staff notices (`enabledStaffNoticeSources`, `apps/server/src/modules.ts:59-65`), read the way
     the equipment read reads them. Its episode is keyed by owner and key, starts when the notice is
     first found and ends at the first check that finds it gone **from an owner whose check
     answered**; while an owner's check fails, its episodes neither start nor end.
   - Not emailed: the unsent count, the printer notice, `reader.offline` — the design's list
     (`:508-511`) names none of them.
7. **Once per episode, per recipient, retried each minute.** An episode keeps the addresses that
   accepted it (lower-cased, trimmed). Each check sends to every managers' address the episode has not
   reached: one whose send came back `unknown` (no connection, a timeout, a sender that throws) is
   tried again the next minute; one whose send was `rejected` (a 4xx or 5xx reply,
   `smtp-send.ts:22-30`) is tried again only after a day, as the certificate reminders retry a failed
   one (`packages/fiscal-verifactu/src/certificate-reminders.ts`, `claimReminder`'s comment). A
   manager added during an episode gets it at the next check. With no email settings the duty sends
   nothing and says so once per episode; once settings appear during the episode it sends. All of
   it is in memory (design §7), so a restart during an episode can send again.
8. **The duty's clock.** The first check is one minute after start; each next one is armed one
   minute after the last finished, on an unref'd timer, as the free-space watch does
   (`free-space-watch.ts:66-82`). Why not at once: slice 5's watch takes its first reading at start,
   so the duty's first check sees it; and a start that fails within its first minute emails nothing.
   Only a node that is the primary checks (`holders.singletonRole.current === "primary"`, as the
   certificate reminders gate, `boot.ts:1790`); on any other node the check reads and sends nothing.
9. **Room for slice 8.** The clock-behind-the-chain email is a module notice code with email words:
   slice 8 adds `clock.behind_chain`'s words to `apps/server/src/i18n/box-emails.ts` and its notice
   to the module's source, and the duty sends it with no change. Its params (`clockAt`,
   `lastRecordAt`, design §4.8 c) need a placeholder the words file does not have yet; slice 8 adds
   it. Task 14 records this in the backlog.
10. **The `clock.unusable` email is built though it will usually not arrive.** P8: with the clock
    before 28 October 2024 the box cannot open a TLS mail connection, so the send comes back
    `unknown` each minute, and the episode ends when the clock is fixed, before the mail could go.
    It does arrive through a plain relay or the practice box's local mail capture. Built because the
    design asks for it (`:508`) and it costs nothing more than the other codes; the guide does not
    promise it (Task 14), and the backlog records the finding for the owner.
11. **The emails carry no figures and no link.** Each names the venue (its location's name, as the
    attendance emails do, `boot.ts:1755-1767`) and the page to open, by its menu path. No free-space
    figure: the email goes once per episode and the figure changes, while the Box status page shows
    the current one; and `apps/server` cannot use the dashboard's byte formatter
    (`packages/dashboard-kit/src/alert-messages.ts:55-70`; `@waitron/dashboard-kit` is not one of
    `apps/server/package.json`'s dependencies). No link: the certificate reminders name the page
    the same way, and the box's address is often unreachable from where an email is read. The words
    are in Task 7.
12. **A status the provider could not read stays silent, as today.** `{ online: false,
    unreachable: true }` raises neither `reader.offline` (connection unknown) nor, as today,
    `reader.status_unavailable` (P2). Making it raise `reader.status_unavailable` would add an alert
    to every box whose provider is unreachable, which the design did not ask for; Task 14 records it.
13. **The email's database reads answer on a full disk.** The location's name, the managers'
    addresses and the email settings are read in one `db.withWriteLock` turn with no change-log
    drain, never in `withTransaction`, whose closing drain is refused on a full disk while a change
    waits (`docs/developers/conventions-data.md:2571-2576`, slice 6's M2). The modules' notices are
    read in turns already (`readStaffNoticesInTurns`). Task 10 runs it on a real full filesystem, with
    the `withTransaction` read as the control.
14. **`waitron.sh install` switches on time synchronisation with `timedatectl set-ntp true`.** Run
    through `as_root`, under the same outer `timeout` command `apt_get` finds, with 60 s; never fatal;
    `install` only, never `reset`. On success one line on stdout: "waitron.sh: asked the system to
    keep its clock in step with internet time (timedatectl set-ntp true)" — words that say what was
    asked, since P6 could not show what a booted host does next. On failure, or with no
    `timedatectl`, one line on stderr that says nothing keeps the clock right, why that matters, and
    what to do. It installs no package: the design says "where the system provides it".
15. **`waitron.sh install` deletes the images the box ran before, and only those, only once the new
    box is healthy.** Before `docker compose up` it records the image ids the `app` and `print-agent`
    containers run (`docker compose ps -q <service>`, then `docker inspect -f '{{.Image}}'`, the calls
    `print_image_versions` already makes, `deploy/waitron.sh:393-431`); after `wait_healthy` succeeds
    it runs `docker image rm <id>` — never `-f` — for each recorded id the containers no longer run
    and that still exists. A refusal is one line on stderr and never fatal. Why so narrow: `rm` without
    `-f` cannot delete an image a container still uses (P7 (1)); an unhealthy upgrade keeps the old
    image for a quick way back; and the script deletes nothing it did not run, so a developer machine
    exercising `waitron.sh` keeps its other images. Not deleted: images left by upgrades before this
    slice, the mail capture's old image (its version changes rarely), and Docker's build cache from
    branch installs; Task 14 records them. `reset` deletes no image.
16. **The plain-text sender is shared, not copied.** `certificate-reminder-email.ts`'s sender moves to
    `apps/server/src/text-email.ts` as `createTextEmailSender`; the old file re-exports it under its
    old names, so the certificate reminders and their tests do not change. Why not rename the old
    file: `apps/server/test-durations.json:212` names its test file.
17. **Lands itself**, as the build plan's row 10 says: emails, an alert, a notice and the install
    script. No invoice, record, chain, series, number or filing changes.

## Questions for the owner

None. Every choice above has a conservative default; decision 10 is a finding to report, not a
question (the design already chose to email that condition).

## Behaviour this slice changes

- Managers with an email address get up to one email per disk episode for "nearly out of space",
  one for "out of space", and one per episode of a clock set before 28 October 2024.
- The bell (and the Box status page's Card readers row) shows `reader.offline`.
- Every till and handheld shows the amber printer notice for a kitchen printer in trouble; a device
  shows it for another printer it prints its receipts, slips or full invoices to.
- The till's open notice list takes keyboard focus.
- The equipment read's notices gain the `printers` owner.
- `waitron.sh install` prints one more line (time synchronisation) and, after an upgrade, one per
  deleted image.
- New log lines: `box_email.sent`, `box_email.send_failed`, `box_email.not_configured`,
  `box_email.no_recipients`, `box_email.check_failed` (Tasks 8–9), each said once per thing that
  happens, never once per minute.

---

## Global constraints

- Every commit `git commit -s`. Never `--no-verify`. Work only in this worktree. Stage explicit
  paths.
- **No migration.** No change to `packages/fiscal-verifactu`, `packages/core`, `packages/store`,
  `apps/server/src/disk-full-state.ts`, `free-space-watch.ts`, `till-sale.ts`, `bill-payments.ts`, or
  anything fiscal (decision 17). No change to `packages/module`: the notice context stays as it is
  (Architecture 1).
- General code is English only (CLAUDE.md §3). Spanish appears only in
  `apps/server/src/i18n/box-emails.ts`, `apps/till/src/i18n/strings.ts`,
  `apps/dashboard/src/i18n/alert-messages.ts` and `apps/server/src/guide/es/`. No test this plan adds
  writes a Spanish literal: it reads its expected words from those files.
- Every ongoing alert code is a `code: "…"` literal in `apps/server/src/alert-sources.ts`, worded in
  `apps/dashboard/src/i18n/alert-messages.ts` in the same commit (`scripts/ongoing-alert-codes.test.ts`,
  weaker than its name). Every notice code is a `code: "…"` literal in
  `apps/server/src/box-staff-notices.ts`, worded by the till in an earlier or the same commit
  (`scripts/staff-notice-codes.test.ts`, weaker than its name: listed files, text, one params set).
- `apps/dashboard/src/i18n/alert-messages.ts` stays free of imports (its header), because the root
  guards load it.
- Tests of the duty never wait real minutes and never sleep: the duty takes a `timer`, and tests pass
  a manual one and "tick" by calling the last armed callback, then `vi.waitFor` until the next timer
  is armed (the free-space watch's pattern, `apps/server/src/free-space-watch.test.ts`). To show
  nothing happens after a held promise is released, await `new Promise((r) => setImmediate(r))`
  twice.
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
  only processes you started, by pid.
- The shell is zsh: quote `--include='*.ts'` globs, and use `/usr/bin/grep` where an exit status
  decides anything. `timeout` does not exist on macOS; the stubs supply `timeout` and `gtimeout`.

## Review focus

1. **The episode rules (decisions 6–7).** A disk hovering at full emails once; low → full emails
   both; a module owner whose check fails neither starts nor ends an episode; `unknown` is retried the
   next minute and `rejected` after a day; a recipient who accepted is never sent the same episode
   again. Tasks 8–9 pin each one.
2. **The full-disk email reads (decision 13).** Task 10's real-disk case answers with a change
   waiting, and its control — the same reads through `withTransaction` — is refused
   `storage.disk_full`. If the control does not fail, the turn is unnecessary: report it.
3. **The printer notice's device scoping and the shared read (decisions 1, 3, 4).** A device sees a
   non-kitchen printer only through its own roles; two devices within ten seconds cause one trouble
   read; a failing printer check names only `printers` as unavailable.
4. **`reader.offline` against `unreachable` (decisions 5, 12).** An unreadable status raises nothing,
   exactly as P2 measured today.
5. **`waitron.sh` (decisions 14–15).** Hermetic stubs: `timedatectl` is stubbed for every case,
   so no case reaches a real one on Linux CI (P9). Neither new step can fail an install. Images are
   deleted only after `wait_healthy`, only by recorded id, never with `-f`, and never on `reset`.
6. **Nothing fiscal.** The duty and the notice source read; the duty's only module input is the
   staff-notice seat.

**For the Codex run-it seat** (as many commands as the claims need):
- Send the duty's email through a real SMTP server: start Mailpit
  (`docker run --rm -d -p 127.0.0.1:1025:1025 -p 127.0.0.1:8025:8025 axllent/mailpit:v1.31.6`, removing
  it by its container id afterwards), run `startBoxEmailDuty` from a scratch test with a real
  `readBoxEmailContext` on a `useVenueDb` database holding an admin with an email, `practiceMode:
  true` (so delivery is Mailpit's `smtp://127.0.0.1:1025`), the stop noted, and tick it twice; read
  `http://127.0.0.1:8025/api/v1/messages`: one message, the right subject, in the admin's language.
  Then stop Mailpit, note the stop again in a new episode, tick (the send comes back `unknown`), start
  Mailpit, tick: one message more.
- Run `deploy/waitron.sh install` under the suite's stubs with `WT_OLD_IMAGES=1` and an unhealthy
  container, and confirm no `docker image rm` is logged.
- On macOS, run Task 10's full-disk case and its control.

## Review path

**LIGHT**, as the build plan's row 10 says: no per-task reviewer, one Codex run-it review, and the
fresh-context plan-against-spec read before implementers start. Checked against each risk trigger:
no fiscal invariant (decision 17); no tenant or by-id read (the printer source reads the requesting
device's own roles, by the id its authenticated proof gives); no migration; no grant or ACL; no new
cross-package contract — the notice context in `@waitron/module` is unchanged, `deviceSources` is
internal to `apps/server`, and a new notice code is an additive value the till already draws as
unknown when it does not know it (slice 6 decision 12). The places a reviewer could argue otherwise,
named so the plan review can rule: **auth/permissions** — the emails go to holders of
`system.manage`, chosen by the certificate reminders' existing query, moved unchanged (Task 6);
**concurrency** — a new background duty that reads in write-lock turns, and one ten-second cache
shared across device reads, whose in-flight read cannot be awaited across turns because turns take
the write lock one at a time.

---

### Task 1: Printers in trouble, and whether a kitchen station prints to them

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
  /** An active kitchen station prints to it. */
  readonly kitchen: boolean;
}

/** Every active printer with a job in trouble at `now` (`printJobInTrouble`), leaving out jobs an
 * Unpair ended. */
export async function printersInTrouble(tx: Transaction, now: Date): Promise<PrinterInTrouble[]>;
```
The query is `printingAlertSource`'s (`alert-sources.ts:417-434`) moved verbatim, with its
`PRINTER_UNPAIRED` condition; then, only when it found rows, one more query: the `printerId`s of
`stationPrinters` joined to `kitchenStations` on `stationId` where `kitchenStations.active` is true
and `printerId` is among the rows' ids. `printingAlertSource` keeps its `agent.silent` part and maps
`printersInTrouble`'s rows to exactly the alerts it builds today (key, code, params
`{ printer: name, count }`, severity, `since: new Date(oldest).toISOString()`, screen).

- [ ] **Step 1: Write the failing tests** in `print-job-trouble.test.ts`, with
  `useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS] })`
  and helpers copied in shape from `alert-sources.test.ts:666-755` (`minsAgo`, `seedLocation`,
  `seedPrinter`, `seedJob`), `NOW` fixed. `describe("printersInTrouble")`:
  1. `"names an active printer whose document has waited past two minutes, with how many and the oldest"`:
     printer "Barra"; queued jobs at `minsAgo(3)` and `minsAgo(5)`, a `done` one at `minsAgo(10)` →
     `toEqual([{ id, name: "Barra", count: 2, oldest: minsAgo(5), kitchen: false }])`.
  2. `"names nothing for a young job, a drawer pulse, a job an Unpair ended, or a switched-off printer"`:
     a queued job at `minsAgo(1)`; a `kind: "drawer"` job at `minsAgo(10)`; a `failed` job at
     `minsAgo(10)` with `lastError: PRINTER_UNPAIRED`; a queued job at `minsAgo(10)` on a printer with
     `active: false` → `toEqual([])`.
  3. `"marks a printer an active kitchen station prints to"`: a `kitchenStations` row (`isDefault:
     false`, `active: true`), a `stationPrinters` row to the printer, a stuck job → `kitchen: true`.
  4. `"a printer whose only station is switched off is not a kitchen printer"`: as 3 with the station
     `active: false` → `kitchen: false`.
- [ ] **Step 2: Run and watch it fail.**
  `pnpm --filter @waitron/server exec vitest run src/print-job-trouble.test.ts` → FAILS:
  `printersInTrouble` is not exported.
- [ ] **Step 3: Implement** as the Interfaces say.
- [ ] **Step 4: Run and watch it pass; the bell unchanged; typecheck; format.** The Step 2 command →
  `Tests 4 passed (4)`.
  `pnpm --filter @waitron/server exec vitest run src/alert-sources.test.ts src/print-problems.test.ts`
  → PASS, `alert-sources.test.ts` still 89 (P1). `pnpm --filter @waitron/server typecheck` exits 0.
  `pnpm exec prettier --check apps/server/src/print-job-trouble.ts apps/server/src/print-job-trouble.test.ts apps/server/src/alert-sources.ts`.
- [ ] **Step 5: Proofs by deletion**, each restored and re-run before the next: drop the
  `kitchenStations.active` condition → case 4 FAILS; make `kitchen` always `false` → case 3 FAILS;
  drop the `PRINTER_UNPAIRED` condition → case 2 FAILS (and `alert-sources.test.ts`'s Unpair case).
- [ ] **Step 6: Commit.**
  ```bash
  git add apps/server/src/print-job-trouble.ts apps/server/src/print-job-trouble.test.ts apps/server/src/alert-sources.ts
  git commit -s -m "The box can list its printers in trouble and say which a kitchen station prints to; the bell reads the same list"
  ```

### Task 2: The till words a printer notice, and its open list takes focus

**Files:**
- Modify: `apps/till/src/i18n/strings.ts` (English after `:1734`, Spanish after `:3438`)
- Modify: `apps/till/src/i18n/staff-notices.ts` (a branch before the unsent count's, `:28`)
- Modify: `apps/till/src/i18n/staff-notices.test.ts` (cases in the `describe.each(LANGUAGES)`)
- Modify: `apps/till/src/widgets/notice-strip.ts` (`tabindex="0"` on the `<ul>`, `:173`)
- Modify: `apps/till/src/widgets/notice-strip.a11y.test.ts` (one case beside "three open")
- Modify: `scripts/staff-notice-codes.test.ts:49` (declared change 1, its own commit)

**The words** (decision 2):

| Key | English | Spanish |
| --- | --- | --- |
| `staff_notice.printer.jobs_waiting` | {printer} printer not printing | Impresora {printer} no imprime |
| `staff_notice.since` | since {time} | desde {time} |

**The branch:** for `code === "printer.jobs_waiting"`: `printer` must be a non-empty string and
`since` a string `Date.parse` reads, else `unknownText()`; then `main` is
`t("staff_notice.printer.jobs_waiting").replace("{printer}", () => printer)` and `hint` is
`t("staff_notice.since").replace("{time}", () => clockTime(Date.parse(since)))`. The function form of
`replace` keeps a name such as `$&` as it is.

- [ ] **Step 0: The declared guard change, first and on its own.** In
  `scripts/staff-notice-codes.test.ts:49`, `params: { count: 2, held: 0 }` becomes
  `params: { count: 2, held: 0, printer: "Cocina", since: "2026-10-23T19:16:00.000Z" }`.
  `pnpm exec vitest run scripts/staff-notice-codes.test.ts` → `Tests 5 passed (5)`. Commit:
  ```bash
  git add scripts/staff-notice-codes.test.ts
  git commit -s -m "Changed test checks (A798 slice 10): the staff-notice guard asks with a printer's name and a time

  scripts/staff-notice-codes.test.ts:49 — before: params { count: 2, held: 0 }; after: the same plus
  printer: \"Cocina\", since: \"2026-10-23T19:16:00.000Z\". A list gaining entries, every existing value
  unchanged (owner's standing exception, 2026-09-27). Without it the printer notice, worded only with
  those params, reads as unknown to the guard (plan P3)."
  ```
- [ ] **Step 1: Write the failing tests.**
  - `staff-notices.test.ts`, inside `describe.each(LANGUAGES)` (`setLocale(locale)` first in each):
    1. `"words a printer notice with the printer's name and the time its oldest ticket was sent"`:
       `since = "2026-10-23T19:16:00.000Z"`;
       `staffNoticeText({ code: "printer.jobs_waiting", params: { printer: "Cocina", since } })`
       `toEqual({ main: words["staff_notice.printer.jobs_waiting"].replace("{printer}", "Cocina"),
       hint: words["staff_notice.since"].replace("{time}", clockTime(Date.parse(since))) })`
       (import `clockTime` from `./t.js`).
    2. `it.each` `"words a printer notice with %j as unknown"` over `{}`, `{ printer: "", since }`,
       `{ printer: "Cocina" }`, `{ printer: "Cocina", since: "not a time" }`, `{ printer: 7, since }` →
       `toEqual({ main: words["staff_notice.unknown"], hint: words["staff_notice.tell_manager"] })`.
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
  → the new word cases FAIL in both languages (case 1: the till draws unknown and the words do not
  exist; case 3 likewise; case 2 passes already — it pins that a malformed notice stays unknown);
  the sixteen-open case FAILS in both themes with `scrollable-region-focusable` (P5). Failure
  screenshots land in `src/widgets/__screenshots__/`; delete that folder after the run (it is
  untracked).
- [ ] **Step 3: Implement** the words, the branch and `tabindex="0"` on the `<ul>`.
- [ ] **Step 4: Run and watch them pass; guard; typecheck; format.** The Step 2 command → PASS.
  `pnpm exec vitest run scripts/staff-notice-codes.test.ts` → `Tests 5 passed (5)` (no source names
  the code yet). `pnpm --filter @waitron/till typecheck` exits 0.
  `pnpm exec prettier --check apps/till/src/i18n/strings.ts apps/till/src/i18n/staff-notices.ts apps/till/src/i18n/staff-notices.test.ts apps/till/src/widgets/notice-strip.ts apps/till/src/widgets/notice-strip.a11y.test.ts`.
- [ ] **Step 5: Proofs by deletion**: remove `tabindex="0"` → the sixteen-open case FAILS
  (`scrollable-region-focusable`); replace the `since` check with none → case 2's
  `"not a time"` row FAILS; use a string replacement for `{printer}` → case 3 FAILS (`$&` expands).
- [ ] **Step 6: Commit.**
  ```bash
  git add apps/till/src/i18n/strings.ts apps/till/src/i18n/staff-notices.ts apps/till/src/i18n/staff-notices.test.ts apps/till/src/widgets/notice-strip.ts apps/till/src/widgets/notice-strip.a11y.test.ts
  git commit -s -m "The till words a printer that is not printing, with the time of its oldest ticket, and its long notice list can be scrolled from the keyboard"
  ```

### Task 3: The printer notice on the equipment read, for the devices it concerns

**Files:**
- Modify: `apps/server/src/box-staff-notices.ts` (new exports after `deviceNoticeSources`)
- Modify: `apps/server/src/device-api.ts` (`DeviceApiDeps.notices`, `:132-137`; the GET, `:406-418`)
- Modify: `apps/server/src/box-staff-notices.test.ts`
- Modify: `apps/server/src/device-equipment-api.test.ts` (cases in "GET /api/device/equipment's
  notices", `:1434`)
- Modify: `scripts/staff-notice-codes.test.ts:65-70` (declared change 2, in the task's commit)

**Interfaces** (`box-staff-notices.ts`):
```ts
/** Owner name of the printer notices; no module is named this. */
export const PRINTER_NOTICE_OWNER = "printers";
/** How long one read of the printers in trouble serves every device. */
export const PRINTER_NOTICE_CACHE_MS = 10_000;

/** The printers the device's receipts, payment slips and full invoices resolve to. */
export async function documentPrintersOf(tx: Transaction, deviceId: string): Promise<ReadonlySet<string>>;

/** A kitchen printer in trouble for any device; another only for a device in `documentPrinters`. */
export function printerStaffNoticeSource(deps: {
  deviceId: string;
  trouble: (tx: Transaction, now: Date) => Promise<readonly PrinterInTrouble[]>;
  documentPrinters?: (tx: Transaction, deviceId: string) => Promise<ReadonlySet<string>>;
}): StaffNoticeSource;

/** One source per device, all reading the printers in trouble through one cache. */
export function devicePrinterNoticeSources(deps: {
  now: () => Date;
  cacheMs?: number;
  trouble?: (tx: Transaction, now: Date) => Promise<readonly PrinterInTrouble[]>;
  documentPrinters?: (tx: Transaction, deviceId: string) => Promise<ReadonlySet<string>>;
}): (deviceId: string) => readonly OwnedStaffNoticeSource[];
```
`documentPrintersOf`: `readPrinterRoles(tx, deviceId)` (`@waitron/layouts`) filtered to roles
`receipt`, `payment_slip`, `invoice` with a non-null `resolvedId`. The source's `read({ tx, reading })`:
`rows = await trouble(tx, reading.instant)`; none → `[]`; asks `documentPrinters` only when some row
is not a kitchen printer; keeps kitchen rows and rows whose id is in the set; orders by `oldest`, then
`name`; each becomes `{ key: \`printer.jobs_waiting:${id}\`, code: "printer.jobs_waiting", severity:
"warning", params: { printer: name, since: new Date(oldest).toISOString() } }`. Defaults:
`trouble = printersInTrouble`, `documentPrinters = documentPrintersOf`, `cacheMs =
PRINTER_NOTICE_CACHE_MS`. `devicePrinterNoticeSources` makes one `createTtlCache<readonly
PrinterInTrouble[]>({ ttlMs: cacheMs, now })` and gives every device's source
`trouble: (tx, at) => cache.get("all", () => trouble(tx, at))`, owner `PRINTER_NOTICE_OWNER`.

`DeviceApiDeps.notices` gains `deviceSources?: (deviceId: string) => readonly OwnedStaffNoticeSource[]`
("Sources that depend on which device asks; read after `sources`."). The GET reads
`[...sources, ...(deps.notices.deviceSources?.(device.deviceId) ?? [])]` through the same wrapping
and reader as today.

- [ ] **Step 1: Write the failing tests.**
  - `box-staff-notices.test.ts`, `describe("printer notices")`, with `CTX` (`:6-10`) and plain-object
    rows (`PrinterInTrouble`):
    1. `"a kitchen printer in trouble shows on any device, without reading the device's printers"`:
       `trouble` → `[{ id: "k", name: "Cocina", count: 1, oldest: "2026-10-22T09:55:00.000Z", kitchen:
       true }]`; `documentPrinters = vi.fn()` → `read(CTX)` `toEqual([{ key: "printer.jobs_waiting:k",
       code: "printer.jobs_waiting", severity: "warning", params: { printer: "Cocina", since:
       "2026-10-22T09:55:00.000Z" } }])`; `documentPrinters` not called; `trouble` called with
       `(CTX.tx, AT)`.
    2. `"another printer shows only on a device that prints its documents to it"`: rows `p1` and `p2`,
       both `kitchen: false`; `documentPrinters` → `new Set(["p2"])`, called with `(CTX.tx, "d1")` →
       only `p2`'s notice.
    3. `"orders the notices by their oldest ticket, then by name"`: three kitchen rows given out of
       order → keys in order.
    4. `"no printer in trouble shows nothing and reads no device printers"`.
    5. `"devices share one read for ten seconds, then read again"`: a counting `trouble`, a settable
       `now`; `devicePrinterNoticeSources({ now, trouble, documentPrinters: async () => new Set() })`;
       read `("d1")[0].source` and `("d2")[0].source` → 1 call; `now` + 9 999 ms → read → 1; + 10 000 →
       read → 2. Both entries' `owner` is `"printers"`.
  - `device-equipment-api.test.ts`, inside "GET /api/device/equipment's notices": an app made with
    `noticeApp([], { deviceSources: devicePrinterNoticeSources({ now: () => READING.instant, cacheMs:
    0 }) })`; jobs inserted into `printJobs` at `venue.cfg.locationId` with `payload:
    Uint8Array.from([1])`, times relative to `READING.instant`:
    6. `"a kitchen printer whose ticket has waited two minutes shows on both tills"`: printer "Cocina",
       a `kitchenStations` row (`isDefault: false`), its `stationPrinters` row, a queued job three
       minutes old → for `venue.cookie` and `venue.cookie2`, `notices` `toContainEqual({ owner:
       "printers", key: \`printer.jobs_waiting:${id}\`, code: "printer.jobs_waiting", severity:
       "warning", params: { printer: "Cocina", since: <the job's time> } })`.
    7. `"a receipt printer's notice shows only on the till whose receipts go to it, and on one whose
       slips do"`: `choose(venue.cookie, "receipt", { id: fp }, "list")` and
       `choose(venue.cookie2, "receipt", { id: pp }, "list")` (each `200`); a queued job on `fp` three
       minutes old → till A's notices hold `fp`'s, till B's hold no `printers` notice; then
       `choose(venue.cookie2, "payment_slip", { id: fp }, "list")` → B's hold it too.
    8. `"a ticket under two minutes old shows nothing"`: as 6 with the job one minute old → no
       `printers` notice.
    9. `"a failing printer check names only its owner, and the box's notices still come"`:
       `noticeApp([answering("box", notice("box-error", "error"))], { deviceSources: () => [{ owner:
       "printers", source: { read: () => Promise.reject(new Error("boom")) } }] })` →
       `noticesUnavailable` `toEqual(["printers"])`, `notices` holds `box-error`.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/box-staff-notices.test.ts src/device-equipment-api.test.ts`
  → FAILS: the new exports do not exist (the first file fails to import; the second's new cases
  fail, or the file fails to import).
- [ ] **Step 3: Implement** as the Interfaces say. Then add `"printer.jobs_waiting"` to the
  `arrayContaining` list in `scripts/staff-notice-codes.test.ts:65-70` (declared change 2; committed
  separately in Step 6).
- [ ] **Step 4: Run and watch them pass; guards; typecheck; format.** The Step 2 command → PASS
  (`box-staff-notices.test.ts` 6 + 5 = 11; `device-equipment-api.test.ts` 85 + 4 = 89).
  `pnpm exec vitest run scripts/staff-notice-codes.test.ts` → `Tests 5 passed (5)`.
  `pnpm --filter @waitron/server typecheck` exits 0.
  `pnpm exec prettier --check apps/server/src/box-staff-notices.ts apps/server/src/box-staff-notices.test.ts apps/server/src/device-api.ts apps/server/src/device-equipment-api.test.ts scripts/staff-notice-codes.test.ts`.
- [ ] **Step 5: Proofs by deletion**: drop the kitchen short-cut (filter every row by the set) →
  cases 1 and 6 FAIL; drop the set filter → cases 2 and 7 FAIL; give each device its own cache →
  case 5 FAILS; drop `deviceSources` from the GET → cases 6–9 FAIL; delete the till's
  `staff_notice.printer.jobs_waiting` English line → the guard FAILS naming `printer.jobs_waiting`.
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

**The wiring:** `deviceSources: devicePrinterNoticeSources({ now })` beside `sources`, `clock` and
`filing`.

- [ ] **Step 1: Write the failing test** `"the equipment read names a kitchen printer whose ticket has
  waited two minutes"`, in the "SP-C dev override" `describe` (`:2719`), shaped like `:2775-2800`. Before
  `startServer` (CLAUDE.md §4: a test that starts the server in its own process writes only while it
  is down), in `sharedDb` at `cfg.locationId` (`loadTillConfig(TILL_ENV)`, as `:2727-2730`): a printer
  "Probe kitchen", a kitchen station (`isDefault: false`), its `stationPrinters` row, and a queued
  document job created three minutes before `new Date()`. Then GET `/api/device/equipment` with
  `DEV_DEVICE_HEADER: deviceId1` → `notices` `toContainEqual(expect.objectContaining({ owner:
  "printers", code: "printer.jobs_waiting", params: expect.objectContaining({ printer: "Probe kitchen"
  }) }))`. In `finally`, after `server.close()`, delete the job, the station link, the station and the
  printer, in that order, so the shared venue's other cases do not see them.
- [ ] **Step 2: Run and watch it fail.**
  `pnpm --filter @waitron/server exec vitest run src/boot.test.ts -t "names a kitchen printer"` → FAILS:
  no `printers` notice. (A name-filtered run proves only this case; CI runs the file.)
- [ ] **Step 3: Implement** the wiring.
- [ ] **Step 4: Run and watch it pass; neighbours; typecheck; format.** The Step 2 command → PASS.
  `pnpm --filter @waitron/server exec vitest run src/boot.test.ts -t "equipment read"` → PASS (both
  equipment cases). `pnpm --filter @waitron/server typecheck` exits 0.
  `pnpm exec prettier --check apps/server/src/boot.ts apps/server/src/boot.test.ts`.
- [ ] **Step 5: Proof by deletion**: remove `deviceSources` from boot → the case FAILS.
- [ ] **Step 6: Commit.**
  ```bash
  git add apps/server/src/boot.ts apps/server/src/boot.test.ts
  git commit -s -m "Boot gives every till's equipment read the printer notices"
  ```

### Task 5: `reader.offline`

**Files:**
- Modify: `apps/dashboard/src/i18n/alert-messages.ts` (an entry after `reader.status_unavailable`,
  `:332-335`)
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
    (`packages/dashboard-kit/src/alert-messages.ts:84`), which `alertMessage` gives on both sides.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/alert-sources.test.ts` → cases 1 and 3 FAIL (no
  `reader.offline`); case 2 passes already (it pins today's silence, P2). `memory_pressure | grep free`,
  then `pnpm --filter @waitron/dashboard exec vitest run src/screens/box-status-rows.test.ts` → the
  new case FAILS on `toContain("Reader 1")`: with no words for the code the line is the generic
  sentence.
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
    `{ mode: "unconfigured" }`, and with `true` → `{ mode: "local_capture", smtp: {...} }` equal to
    `resolveEmailDelivery(db, ring, true)`'s answer. Use the ring the file's existing cases use.
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
export const BOX_EMAIL_WORDS = { /* the table below */ } as const satisfies Record<
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
(`apps/dashboard/src/i18n/strings.ts:957`, `:4170`), "Box status" / "Estado del equipo" (`:974`,
`:4187`), "Free {size}" / "Liberar {size}" (`:3178`, `:6418`); "panel de gestión" is the Spanish
guides' name for the dashboard.

- [ ] **Step 1: Write the failing tests** in `box-alert-email.test.ts`:
  1. `it.each` over every code × `["en", "es"]`: `"words %s in %s with the venue's name"` →
     `boxEmailMessage(code, language, "Casa Pepe")` `toEqual({ subject:
     BOX_EMAIL_WORDS[code][language].subject.replaceAll("{venue}", "Casa Pepe"), text: …same… })`, and
     neither contains `"{"`.
  2. `"keeps a venue name that looks like a replacement pattern"`: venue `"$& Bar"` → the subject
     contains `"$& Bar"`.
  3. `"every code has a subject and a text in both languages, none blank"`.
  4. `"tells the storage codes from the rest"`: `isBoxEmailCode("clock.unusable")` true,
     `isBoxEmailCode("fiscal.records_unsent")` false; `STORAGE_EMAIL_CODES` `toEqual([…two…])`.
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
/** A send the mail server refused is tried again after this. */
export const BOX_EMAIL_REJECTED_RETRY_MS = 24 * 60 * 60_000;

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
rejectedAt: Map<string, number>; said: Set<string> }>`, keyed `storage.space_low`,
`storage.disk_full`, or `module:<owner>:<key>` (Task 9). One check, in order (this task: steps 1, 2,
4, 5, 6; Task 9 adds 3 and the primary gate):
1. Return (still arming the next timer) if stopped.
2. **Disk episode** (decision 6): `full = disk.since() !== null`, `low = space.current().lowSince !==
   null`. Neither → delete both storage episodes. Else want `storage.disk_full` when `full`;
   want `storage.space_low` when `low && !full && !episodes.has("storage.disk_full")`. Create a
   wanted episode if missing.
3. (Task 9) Module episodes.
4. If no episode is wanted at this check, done, with nothing read. Otherwise `ctx = await
   context()` once for this check — every minute while an episode lasts, even one every manager has
   received, so a manager added during it is found (decision 7).
5. For each wanted episode, in this order: `ctx.recipients` empty → log `box_email.no_recipients`
   (warn, `{ code }`) once per episode (`said`); next. `pending` = `ctx.recipients` whose key
   (`email.trim().toLowerCase()`) is not in `sentTo` and not rejected less than
   `BOX_EMAIL_REJECTED_RETRY_MS` ago; none → next. `ctx.delivery.mode === "unconfigured"` → log
   `box_email.not_configured` (warn, `{ code }`) once per episode; next. Else for each pending recipient, in order, stopping if
   stopped: `outcome = await send({ smtp: ctx.delivery.smtp, recipient: r.email,
   ...boxEmailMessage(code, r.language, ctx.venue) })`, a throw counting as `"unknown"`;
   `sent` → add to `sentTo`, log `box_email.sent` (info, `{ code }`); `rejected` → `rejectedAt.set(key,
   now)`; `unknown` → nothing (tried next check). No address is ever logged.
6. A throw from `context()` (or, in Task 9, `moduleNotices()`) is caught and logged
   `box_email.check_failed` (warn, `{ errorCode: codeOf(error) }`); `finally` arms the next timer
   unless stopped.

- [ ] **Step 1: Write the failing tests** in `box-alert-email.duty.test.ts`. Fakes: the manual timer of
  `free-space-watch.test.ts` (each entry `{ ms, fn, cancelled }`) and its `tick`; `disk = { since: () =>
  diskSince }`; `space = { current: () => ({ freeBytes: null, readAt: null, lowSince }) }`;
  `moduleNotices = async () => ({ notices: [], unavailable: [] })`; `context = vi.fn(async () =>
  ({ venue: "Casa Pepe", recipients, delivery }))` with `delivery = { mode: "smtp", smtp: { url:
  "smtp://127.0.0.1:1", from: "box@example.test" } }`; recipients `ana` (`es`) and `ben` (`en`);
  `send = vi.fn<TextEmailSender>(async () => "sent")`; a log spy; a settable `now`. Expected messages
  are built with `boxEmailMessage`. Cases:
  1. `"emails each manager once when the disk falls below 2 GB, in their own language"`: `lowSince`
     set → tick → two sends, `ana` with the `es` words and `ben` with the `en` words of
     `storage.space_low`; tick → no more.
  2. `"a box found full and low at once emails only the full disk"`.
  3. `"a disk going from low to full emails both, once each"`: low → tick (space_low ×2) → full → tick
     (disk_full ×2) → tick → nothing more.
  4. `"a stop that lifts and returns while space stays low sends nothing more"`: full → tick →
     `diskSince = null` (low stays) → tick → full again → tick → only the first tick's two sends.
  5. `"once both are off the episode ends, and the next fall emails again"`.
  6. `"a send that could not be made is tried the next minute; one already accepted is not"`: `send`
     answers `unknown` for `ana` the first time → tick (ana, ben) → tick (ana only) → tick (nothing).
  7. `"a send the server refused is tried again only after a day"`: `rejected` for `ben`; ticks at +1
     min and at +23 h 59 min → no send to ben; at +24 h → one.
  8. `"a sender that throws counts as not sent"`: `send` rejects once for `ana` → the next tick sends
     to ana again.
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
  `!episodes.has("storage.disk_full")` → case 3 or 4 FAILS (space_low emailed after the full disk);
  delete the storage episodes on every check instead of only when both are off → case 4 FAILS;
  drop the `sentTo` check → cases 1 and 6 FAIL; drop the day's wait → case 7 FAILS; drop the
  `said` guard → cases 9 and 11 FAIL; drop the re-arm → case 12 FAILS.
- [ ] **Step 6: Commit.**
  ```bash
  git add apps/server/src/box-alert-email.ts apps/server/src/box-alert-email.duty.test.ts
  git commit -s -m "A minute check emails the managers once when the box's disk is nearly full and once when it is full, retrying until each is sent"
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
  `stopped`, no `context()`, `moduleNotices()` or `send` is started.
- **Logging a failed send once per spell**: an episode remembers the last failed outcome it logged
  per recipient key; `box_email.send_failed` (warn, `{ code, outcome }`) is logged when a send fails
  and that recipient's previous attempt in this episode did not fail the same way.

- [ ] **Step 1: Write the failing tests** (same fakes as Task 8):
  15. `"emails a module's clock notice once, and again in a new episode"`: `moduleNotices` answers
      `{ notices: [{ owner: "fiscal-verifactu", key: "clock.unusable", code: "clock.unusable",
      severity: "error", params: {} }], unavailable: [] }` → tick (two sends with the
      `clock.unusable` words) → tick (none) → answers no notice → tick → answers it again → tick (two).
  16. `"keeps a module's episode while its check fails"`: present → tick (two) → `{ notices: [],
      unavailable: ["fiscal-verifactu"] }` → tick → present → tick → still two sends in all.
  17. `"emails no module notice without email words"`: `fiscal.records_unsent` → no send, `context`
      not called.
  18. `"a node that is not the primary reads and sends nothing"`: `isPrimary` false, low → two ticks →
      `context` and `moduleNotices` not called, no send; a timer armed after each.
  19. `"stop waits for a read in flight, and nothing is read or sent after it"`: `context` returns a
      held promise; low; call the armed `fn`; `stop()` → its promise is still pending (race it with a
      resolved marker); release the read → `stop()` resolves; `await new Promise((r) =>
      setImmediate(r))` twice → no send, `armed[0].cancelled` true, no new timer armed.
  20. `"logs a failing send once, however many minutes it fails"`: `unknown` for `ana` on three
      ticks → one `["warn", "box_email.send_failed", { code: "storage.space_low", outcome: "unknown"
      }]`; then `sent` → one `box_email.sent` for ana.
- [ ] **Step 2: Run and watch them fail.** The Task 8 command → cases 15, 16, 18, 19 and 20 FAIL; 17
  passes already (nothing reads module notices yet) — it pins that only worded codes are emailed.
- [ ] **Step 3: Implement** the additions.
- [ ] **Step 4: Run and watch it pass; typecheck; format.** `Tests 20 passed (20)`; typecheck;
  prettier as Task 8.
- [ ] **Step 5: Proofs by deletion**: drop the `unavailable` exemption → case 16 FAILS; drop
  `isBoxEmailCode` → case 17 FAILS; drop the primary gate → case 18 FAILS; make `stop` resolve at once
  → case 19 FAILS; log every failure → case 20 FAILS.
- [ ] **Step 6: Commit.**
  ```bash
  git add apps/server/src/box-alert-email.ts apps/server/src/box-alert-email.duty.test.ts
  git commit -s -m "The managers' email check also sends the clock notice a module gives, only on the primary, and stops cleanly"
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
    `seedTenant`, a `locations` row named "Casa Pepe", an admin with an address):
    `"reads the venue's name, the managers and the settings"` → `{ venue: "Casa Pepe", recipients:
    [<the admin>], delivery: { mode: "unconfigured" } }` with `practiceMode: false`, and
    `delivery.mode` `"local_capture"` with `true`. The ring: `tryGetCredential` returns before using
    it when no credential row exists (`packages/credentials/src/store.ts:47-51`), so the case may pass
    the ring `email-delivery.test.ts` uses.
  - `start-full-disk.e2e.test.ts`: `"the managers' email reads its context on a full disk with a
    change waiting"`, the shape of `:701-773`: `needDisk(ctx)`, migrate, open, seed the tenant, a
    location and an admin with an address; insert a `change_log` row and checkpoint, as `:747-750`;
    `small.fill(0)`; then `readBoxEmailContext(db, { …, practiceMode: true })` resolves twice with the
    admin and `local_capture`; and the control `resolveEmailDelivery(db, ring, true)` (its
    `withTransaction`) rejects with `expect.objectContaining({ code: "storage.disk_full" })` in the
    same state. `small.unfill()` in `finally`; after unfilling, the `change_log` row is still there.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/box-alert-email.context.test.ts src/start-full-disk.e2e.test.ts`
  → the context case FAILS (`readBoxEmailContext` not exported) and the e2e file fails to import it.
  On macOS the e2e file makes its disk with `hdiutil`; on Linux without `WAITRON_FULL_DISK_DIR` it
  skips (CLAUDE.md §4) — read the `skipped` count before believing a pass.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and watch them pass; typecheck; format.** The Step 2 command → PASS, with the new
  e2e case run, not skipped. If the control does NOT reject, STOP and report: the turn would be
  unnecessary (Review focus 2). `pnpm --filter @waitron/server typecheck`; prettier on the three files.
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
  `closeAll` in `stopWork`, beside `() => freeSpaceWatch.stop()`, `:2828`)
- Create: `apps/server/src/boot.box-emails.test.ts`
- Modify: `apps/server/src/boot.failed-start.test.ts` (a `vi.mock` for `./box-alert-email.js` beside
  the free-space one, `:87-90`; a spy helper beside the free-space one, `:180-190`; two cases beside the
  free-space watch's two)

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
and `() => boxEmails.stop()` in `stopWork`'s `closeAll`, before the store closes (it is in the list
`closeAll` runs before `closePools`).

- [ ] **Step 1: Write the failing tests.**
  - `boot.box-emails.test.ts`, copied in shape from `boot.free-space.test.ts` (its env, migrations
    copy, `setupVenue`, cookies). A hoisted holder `{ deps: undefined, armed: [], sent: [] }`;
    `vi.mock("./box-alert-email.js")` wraps the real `startBoxEmailDuty`, keeping every dep but
    passing the manual timer, `send: async (m) => { holder.sent.push(m); return "sent"; }`, and
    `context: async () => ({ ...(await deps.context()), delivery: { mode: "smtp", smtp: { url:
    "smtp://127.0.0.1:1", from: "box@example.test" } } })`, and saving the deps. One `it`,
    `"boot emails the managers when the disk is full, once"`: start; `holder.deps.disk.noteRefused()`
    (a `DiskFullState`); the bell (`/management-api/alerts`, area `box`) shows `storage.disk_full`, so
    the duty was given boot's stop; tick → `holder.sent` is one message to `owner@example.test`
    (`setupVenue`'s admin, `apps/server/src/testing/venue-fixtures.ts:92-98`) whose subject is
    `boxEmailMessage("storage.disk_full", <the admin's language>, <the location's name read from the
    database>).subject`; tick → still one. The admin has no locale and the venue is `es-ES`
    (`venue-fixtures.ts:28`), so the language is `es`; the test reads both from the database rather
    than writing them in.
  - `boot.failed-start.test.ts`: `"in trading mode, when a step after the listener is started throws,
    stopping the managers' email check"` and `"stops the managers' email check"`, the shapes of the
    free-space watch's two cases.
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
    echo "waitron.sh: could not switch on the system's time synchronisation ('timedatectl set-ntp true' failed, or this system has no timedatectl), so nothing here keeps the clock right, and Waitron stops taking payments while the clock reads earlier than its last sale — set the clock by hand, or install and enable a time service such as systemd-timesyncd" >&2
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
  2. `"carries on, and says nothing keeps the clock right, when the system cannot switch it on"`:
     `timedatectlFail: true` → status 0; `stderr` contains `could not switch on the system's time
     synchronisation` and `systemd-timesyncd`; `compose up -d` still logged.
  3. `"leaves time synchronisation alone on reset"`: an installed box (the reset cases' setup),
     `run(sb, ["reset", "--yes"])` → no `timedatectl` call.
  4. `"refuses a production reset install before touching the clock"`: the production-refusal setup of
     "refuses on a production box before fetching the box's files…" (`:1471`) → no `timedatectl` call.
- [ ] **Step 2: Run and watch them fail.** `pnpm exec vitest run scripts/waitron-sh.test.mjs` →
  cases 1 and 2 FAIL (no call, no line); 3 and 4 pass already (they pin where it must not run).
- [ ] **Step 3: Implement** the stub, the function and the call.
- [ ] **Step 4: Run and watch it pass.** The Step 2 command → `Tests 108 passed (108)` (104 + 4).
  `pnpm exec vitest run scripts/deploy-image-env.test.ts` → PASS (98; it holds every apt-get to
  `apt_get`, and this adds none). `pnpm exec prettier --check scripts/waitron-sh.test.mjs`.
  `bash -n deploy/waitron.sh` exits 0.
- [ ] **Step 5: Proofs by deletion**: remove the call → case 1 FAILS; change `else` to `exit 1` in a
  scratch copy → case 2 FAILS.
- [ ] **Step 6: Commit.**
  ```bash
  git add deploy/waitron.sh scripts/waitron-sh.test.mjs
  git commit -s -m "waitron.sh install asks the host to keep its clock in step with internet time, and says plainly when it cannot"
  ```

### Task 13: `waitron.sh install` deletes the images the box ran before

**Files:**
- Modify: `deploy/waitron.sh` (two functions before `cmd_install`, `:607`; `cmd_install`, `:624-630`)
- Modify: `scripts/waitron-sh.test.mjs` (the docker stub's `compose up` and `inspect` and `image`
  arms, `:144`, `:147-162`, `:163-172`; `sandbox()`; the comment block; a new `describe`)

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

# Deletes each image in $1 that no Waitron container runs any more. Without -f, Docker refuses an
# image any container still uses.
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
`cmd_reset` is unchanged.

**The stub:** `compose up` writes `${WT_LOG}.up` (`: > "${WT_LOG}.up"`) and exits 0 as today; with
`WT_OLD_IMAGES=1` and no `${WT_LOG}.up`, `inspect -f {{.Image}}` answers `sha256:old-app` for
`app-container` and `sha256:old-agent` for `agent-container`, else today's ids; `docker image rm`
exits 1 when `WT_RMI_FAIL=1` (logged either way). `docker image inspect` keeps its
`WT_IMAGE_MISSING` behaviour. `sandbox()` gains `oldImages` and `rmiFail`.

- [ ] **Step 1: Write the failing tests**, `describe("waitron.sh install deletes the images the box ran
  before")`:
  1. `"deletes both old images once the new box is healthy, and says so"`: `oldImages: true` → status
     0; logged `docker image rm sha256:old-app` and `docker image rm sha256:old-agent`, each after the
     last `compose ps --format` health probe; `stdout` contains `deleted the image this box ran before
     the upgrade (old-app)`.
  2. `"keeps the old images when the new box does not come up healthy"`: `oldImages: true, dockerPs:
     "unhealthy"` → status not 0; no `docker image rm`.
  3. `"deletes nothing when the box runs the same images as before"`: default stub → no `docker image
     rm`.
  4. `"deletes nothing on a first install, with no containers before"`: `WT_NO_CONTAINERS=1` → no
     `docker image rm`.
  5. `"skips an old image that is already gone"`: `oldImages: true, imageMissing: "old-app"` → no
     `rm` of `old-app`, one of `old-agent`.
  6. `"carries on, and says so, when an old image cannot be deleted"`: `oldImages: true, rmiFail:
     true` → status 0; `stderr` contains `could not delete the image this box ran before the upgrade,
     sha256:old-app`; the ready links still printed.
  7. `"records the old images before --reset install takes the box down"`: an installed box,
     `oldImages: true`, `run(sb, ["--reset", "--yes", "install"])` → both `rm`s logged, after `compose
     up -d`.
  8. `"reset deletes no image"`: `oldImages: true`, `run(sb, ["reset", "--yes"])` → no `docker image
     rm`.
- [ ] **Step 2: Run and watch them fail.** `pnpm exec vitest run scripts/waitron-sh.test.mjs` → cases
  1, 5, 6 and 7 FAIL (no deletion); 2, 3, 4 and 8 pass already (they pin where it must not delete).
- [ ] **Step 3: Implement** the stub changes, the two functions and the two `cmd_install` lines.
- [ ] **Step 4: Run and watch it pass.** `Tests 116 passed (116)` (108 + 8). Every existing case
  passes unchanged: the new `ps -q`/`inspect` calls land in arms that answer before the health-probe
  counter (`:105-106`). `pnpm exec vitest run scripts/deploy-image-env.test.ts` → PASS. `bash -n
  deploy/waitron.sh`; prettier on the test file.
- [ ] **Step 5: Proofs by deletion**: move `delete_previous_images` before `wait_healthy` (call it
  unconditionally) → case 2 FAILS; drop the `inspect` skip → case 5 FAILS; record `before` after the
  wipe block → case 7 FAILS; drop the `grep -qxF` skip → case 3 FAILS.
- [ ] **Step 6: Commit.**
  ```bash
  git add deploy/waitron.sh scripts/waitron-sh.test.mjs
  git commit -s -m "waitron.sh install deletes the images the box ran before the upgrade, once the new ones are healthy"
  ```

### Task 14: Guides, the deploy README, developer docs and the backlog

**Files:**
- Modify: `apps/server/src/guide/en/till-notices.md` and `apps/server/src/guide/es/till-notices.md`
  (`{#notices}`)
- Modify: `apps/server/src/guide/en/box-status.md` and `apps/server/src/guide/es/box-status.md`
  (`{#rows}`; a new section `{#emails}`)
- Modify: `deploy/README.md` ("Setting up a box", after the Bluetooth paragraph; "Updating and
  operating")
- Modify: `docs/developers/conventions-ui.md` (`:1582-1612`), `docs/developers/design-system.md`
  (`:5317-5320`), `docs/developers/conventions-data.md` (`:2543-2610`)
- Modify: `docs/backlog.md` (the A798-B entry `:4632-4650`; the entries at `:4664-4665` and
  `:4744-4747`; new entries after the A798-B group), `docs/backlog/box.md` (the B3 bullet, `:389-396`)
- Modify: `docs/superpowers/specs/2026-10-19-a798-degraded-trading-design.md` (§11, a dated note)

Follow `~/.claude/docs-writing-style.md`. Every sentence states what the code does after this slice,
nothing more (CLAUDE.md §1).

- [ ] **Step 1: The till guide**, English and Spanish, in `{#notices}` before the unknown notice: the
  printer notice, e.g. "**Cocina printer not printing · since 21:16** is amber. One of that printer's
  tickets has waited two minutes without printing, the ticket sent at 21:16 the oldest. A kitchen
  printer's notice shows on every till and handheld; any other printer's only on the tills and
  handhelds that print their receipts, payment slips or full invoices to it. Check the printer's
  paper, power and cable; the notice goes once it prints again." The Spanish twin in the same place,
  with the till's own Spanish words for the notice.
- [ ] **Step 2: The Box status guide**, both languages. In `{#rows}`, the Card readers bullet's "The
  page does not check whether each reader is switched on: it only shows problems the box already
  knows about." becomes "A reader its card provider reports as offline shows here, as **“Terraza” is
  offline.**; the box asks the provider about every five minutes." A new section **Emails about the
  box** `{#emails}` after `{#out-of-space}`: who (people who can manage the system and have an email
  address); when (the disk under 2 GB, the disk full, the clock set before 28 October 2024); once per
  problem, tried again each minute until the mail server accepts it, so a box with no internet sends
  it when the connection returns; a restart while the problem lasts can send it again; nothing is
  sent until the email settings are filled in; and "A box whose clock reads before 28 October 2024
  usually cannot send its email: with a date that early it cannot check the mail server's
  certificate." (P8).
- [ ] **Step 3: `deploy/README.md`.** After the Bluetooth paragraph: `install` runs
  `timedatectl set-ntp true` as root, under a 60-second limit, and prints one line either way; where
  it fails or there is no `timedatectl`, it says nothing keeps the clock right and to set the clock or
  install a time service such as `systemd-timesyncd`, and carries on; why (a clock earlier than the
  last sale stops payments). In "Updating and operating": after an `install` whose box comes up
  healthy, the images the `app` and `print-agent` containers ran before are deleted with `docker image
  rm` (never forced), with one line each, and a deletion Docker refuses is reported and does not stop
  the install; images from before this release, the mail capture's old images and Docker's build
  cache are not deleted (`docker image prune` and `docker builder prune` do that by hand); `reset`
  deletes no image.
- [ ] **Step 4: Developer docs.**
  - `conventions-ui.md`: in **Notices**, one sentence: the read's sources are the box's (`box`), the
    enabled modules', then the per-device printer source (`printers`, `deviceSources` in
    `apps/server/src/device-api.ts`), which reads the printers in trouble at most once per ten seconds
    for every device together. In **A notice code's words**, the third bullet becomes: "It asks
    `staffNoticeText` with one set of params (a count of 2, none held, a printer named "Cocina" and a
    time), so a branch that words some params as unknown is checked only for those."
  - `design-system.md`, the notice strip's **Several** bullet: the list "scrolls inside itself past
    half the screen height, and takes keyboard focus so it can be scrolled from the keyboard".
  - `conventions-data.md`, "A read on a full disk must not fail on its own housekeeping write": one
    paragraph: since A798-B slice 10 the managers' email check reads the venue's name, the managers'
    addresses and the email settings in one `withWriteLock` turn with no drain
    (`readBoxEmailContext`, `apps/server/src/box-alert-email.ts`), so the full-disk email can be
    prepared on a full disk; the case is "the managers' email reads its context on a full disk with a
    change waiting" in `start-full-disk.e2e.test.ts`.
- [ ] **Step 5: The backlog.**
  - The A798-B entry: replace "slice 7b (Reintentar ahora, parked for the owner) and slice 8 are next"
    with "slice 10 (emails to the managers about the disk and the clock, `reader.offline`, the
    printer notice on every till, and `waitron.sh` switching on time synchronisation and deleting the
    previous images) landed; slice 7b (Reintentar ahora, parked for the owner) and slice 8 are next".
  - Delete "The card readers row does not say whether a reader is switched on" (`:4664-4665`) and
    "The open notice list cannot be scrolled from the keyboard once it overflows" (`:4744-4747`): this
    slice closes both.
  - New entries, each "Left open by A798-B slice 10":
    - "**The bell's printer check scans every print job.** `printJobInTrouble`'s `or` keeps SQLite off
      the `(printer_id, status)` index: 0.25 ms with no printed jobs, 3.7 ms with 50 000
      (`EXPLAIN QUERY PLAN`: `SCAN print_jobs`; slice 10 plan P4). The bell pays it on every read; the
      till's printer notices share one read per ten seconds."
    - "**A card reader whose status the provider could not read raises nothing.** SumUp and Stripe
      answer `{ online: false, unreachable: true }` rather than throwing, so
      `reader.status_unavailable` comes only from a throw or the 45 s deadline (slice 10 plan P2)."
    - "**The email about a clock set before 28 October 2024 rarely leaves the box.** With a date that
      early the box cannot check a mail server's certificate (measured: `CERT_NOT_YET_VALID`, slice 10
      plan P8), so the email waits until the clock is fixed, when there is nothing left to say. A plain
      relay or the practice box's local capture does receive it. For the owner to know."
    - "**`waitron.sh` deletes only the images the box ran just before an upgrade.** Images left by
      upgrades before slice 10, the mail capture's old images and Docker's build cache from branch
      installs are not deleted."
    - "**Slice 8's clock-behind email joins the managers' email check.** Add `clock.behind_chain`'s
      words, with `{clockAt}` and `{lastRecordAt}`, to `apps/server/src/i18n/box-emails.ts` and the
      notice to the Veri\*Factu module's staff-notice source; the check (`box-alert-email.ts`) sends any
      module notice code that has words. Its clock can be far behind too, so P8's limit applies."
  - `docs/backlog/box.md`, the B3 bullet: "A798-B switches the host's synchronisation on at
    `waitron.sh install`; the image makes it standing." becomes "Since A798-B slice 10,
    `waitron.sh install` runs `timedatectl set-ntp true` and says so, or says that nothing keeps the
    clock right; the image makes it standing."
- [ ] **Step 6: The design's §11**, a dated note in the style of the three above it: "**2026-10-23:**
  A798-B slice 10's plan measured that an `unreachable` reader status raises nothing (P2), so §2.4's
  `reader.status_unavailable` comes only from a throw or the deadline; and that a clock before
  28-10-2024 cannot open a TLS mail connection (P8), so that condition's email rarely leaves the box."
- [ ] **Step 7: Check and commit.** `pnpm exec prettier --check deploy/README.md` (and `--file-info`
  on the `docs/` files, which print `"ignored": true`). The guides:
  `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` → PASS (the twins' ids
  match) and `pnpm exec vitest run scripts/guide-links.test.ts` → PASS. `pnpm exec vitest run
  scripts/claude-md-pointers.test.ts` → PASS. Then:
  ```bash
  git add apps/server/src/guide/en/till-notices.md apps/server/src/guide/es/till-notices.md apps/server/src/guide/en/box-status.md apps/server/src/guide/es/box-status.md deploy/README.md docs/developers/conventions-ui.md docs/developers/design-system.md docs/developers/conventions-data.md docs/backlog.md docs/backlog/box.md docs/superpowers/specs/2026-10-19-a798-degraded-trading-design.md
  git commit -s -m "Guides, the deploy README, developer docs and backlog for the managers' emails, offline readers, the printer notice and the install's new steps"
  ```

## Pull request notes

The pull request description says, in plain words:
- The two changed test checks in `scripts/staff-notice-codes.test.ts` (`:49`, `:65-70`), before and
  after, under the owner's standing exception of 2026-09-27.
- That the email about a clock before 28 October 2024 usually cannot leave the box (P8), and why it
  is built anyway (decision 10).
- That a printer notice and an offline reader can show up to ten seconds and five minutes late
  (decisions 4 and 5).
- That `waitron.sh install` now changes the host's time synchronisation and deletes the previous
  images after a healthy upgrade, and what it leaves (decisions 14 and 15).

---

## Self-review against the spec

- §8 item 10, emails (red conditions and 2 GB warning): Tasks 6–11; the clock-behind email is slice
  8's on this duty (decision 9). "Once per episode … held in memory" (`:508-511`, §7 `:1173-1175`):
  decisions 6–7, Tasks 8–9. "Retried each minute until sent once" (`:1159-1160`): decision 7, Task 8
  cases 6–8. To `system.manage` holders with an address: Task 6. The full disk can still send:
  decision 13, Task 10.
- `reader.offline` (`:492-493`, `:526-527`): Task 5, decisions 5 and 12.
- The printer notice (question 2, `:459`, `:522-525`, `:1271-1274`): Tasks 1–4, decisions 1–4.
- `waitron.sh` time synchronisation (`:718-724`, `:1384-1388`): Task 12, decision 14. Old Docker
  images (`:324-325`, `:603-605`): Task 13, decision 15.
- Backlog entries naming slice 10 (`docs/backlog.md:4664-4665`, `:4744-4747`): Tasks 5 and 2, closed
  in Task 14.
- Build plan Part 1 row 10 (LIGHT, no migration, lands itself, depends on slices 5 and 6): Review
  path, Global constraints, decision 17.
