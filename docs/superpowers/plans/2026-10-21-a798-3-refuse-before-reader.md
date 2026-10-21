# A798-B slice 3 — refuse before the card reader, and name the red refusals

> **No migration.** Nothing in this slice adds or changes a table, an index or a trigger.
>
> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use
> checkbox (`- [ ]`) syntax. Each task is test-first: write the failing behavioural test, run it,
> watch it fail for the stated reason, then the minimal implementation.
>
> **Existing assertions.** A task may change an existing assertion only where it pins behaviour
> this plan removes (listed under "Behaviour this slice removes"), and only in a separate commit
> whose message begins `Changed test checks (A798 slice 3):` and lists each `file:line` with its
> before and after. This plan expects NO existing assertion to change: every test it touches gains
> cases, and the test doubles and calls it touches gain a method or an argument (setup, not an
> assertion). Any assertion that turns out to need changing is a STOP: report it, do not edit it.
>
> **Size.** Each task is sized for one implementer well under 100 tool calls. An implementer past
> about 150 calls with the task unfinished stops at a passing or cleanly red point, commits, and
> returns a handover: done, left, files, each check's state.
>
> Every `file:line` below was read at `main` `c416ec2bb` on 2026-10-21, or, where this revision
> added or changed it, at `8f17dac0b` (the worktree `waitron-feat-a798-3-refuse-before-reader`,
> branch `feat/a798-3-refuse-before-reader`, rebased onto `8f17dac0b`). Between the two, the only
> cited file that changed is `apps/server/src/till-sale.ts` (#1938 added one line at `:264`; read:
> `git show --stat 8f17dac0b`), and every `till-sale.ts` line below was re-read at `8f17dac0b`.
> Every claim about how the box behaves today cites a probe in "Measured for this plan", run that
> day on macOS, Node v26.11.1, `node:sqlite`, from scratch files under
> `~/waitron-campaign-b/a798-3-plan-probe/`, outside the repository. A claim marked **(read)**
> comes from reading code, not from running it.

**Words used in this plan.**
- A **connected card reader** is a card machine the box talks to (`provider.collect`). The other
  card path, "Otro datáfono", is a card typed on a machine the box does not talk to; staff charge it
  first and then record it.
- The **two checks before the reader** are the points in the two card-reader routes after which
  the reader is asked to charge: `payIntegrated` for `POST /api/pay`
  (`apps/server/src/till-sale.ts:1106`) and `beginBillPayment` for a card on a bill
  (`apps/server/src/bill-payments.ts:1037`).
- The **full-disk stop** is this plan's version of what design §4.6 item 5 calls the red state for
  the disk: once a write has been refused because the disk is full, the box refuses card-reader
  payments until it reads enough free space again. Decision 4 says how it departs from the design's
  text, and that the owner has been asked.
- The **minimum date** is 28-10-2024, the first invoice date AEAT accepts. The fiscal library
  `@waitron/verifactu` refuses an earlier one (`validate.js:610-611` in its 0.2.1 build).
- The **issue reading** is the one clock reading every server path that records a sale takes in
  `issueMoment` (`apps/server/src/issue-moment.ts:17-27`) and hands to `recordSale`, so the sale
  row and its record carry that one instant and offset (M6).

**Goal:** no connected card is charged for a sale the box will not record — neither after a write
has failed because the disk is full, nor under a clock before 28-10-2024 — and the till says which
of the two stopped it, and whether a card was charged, in words staff can act on.

**Architecture:** five pieces.
1. The Veri\*Factu module learns to judge a clock reading against the minimum date
   (`refuseBeforeFirstIssueDate`, new `packages/fiscal-verifactu/src/first-issue-date.ts`) and
   offers that judgement through the fiscal seat: `FiscalBackend` gains `assertRecordableAt(reading)`
   (`packages/fiscal/src/backend.ts:171`), which `VerifactuBackend` implements by delegating to it.
   It throws a new code, `clock.unusable`, carrying the reading (`clockAt`). No record builder
   changes: `VerifactuBackend.recordSale`, core `recordSale` and `chain.ts` are untouched.
2. The server asks the seat at the issue reading: `issueMoment` calls `assertRecordableAt` on the
   reading it takes, so every server path that records a sale is refused by name before the invoice
   number is allocated. The two checks before the reader ask it too, before the card is charged.
3. The store (`packages/store`) tells listeners each time the engine refuses a write because the
   disk is full (`onDiskFull`, beside `onCommit`).
4. The server keeps the full-disk stop in memory (`apps/server/src/disk-full-state.ts`): the
   store's report sets it, a start on a folder with less than 16 MiB free sets it, and a free-space
   reading of at least 16 MiB clears it. A reader payment checks it before its first transaction,
   inside it, and again just before the reader. A card charged whose sale then fails for a full
   disk answers its own code, `sale.charged_not_recorded`.
5. The till gives each refusal its sentence: a refused save, a sale refused before any money, a
   card charged but not recorded, and a wrong clock with its date. The dashboard gives
   `storage.disk_full` and `clock.unusable` one each.

**Tech stack:** TypeScript, Node v26.11.1, `node:sqlite` behind drizzle (`packages/store`), Hono
(`apps/server`), Lit (`apps/till`, `apps/dashboard`), Vitest 4.1.11 (browser mode for the till and
the dashboard).

**Spec:** [A798 — Degraded but trading](../specs/2026-10-19-a798-degraded-trading-design.md),
revision 6: §2.4, §2.5, §2.6, §3 ("No card is charged while the line is crossed"), §4.5 item 1,
§4.6 items 2, 3 and 5, §5, §6 default 1, §8 slice 3, §9 question 1, §11 item 4. Build plan:
[2026-10-21-a798-b-degraded-trading-build.md](2026-10-21-a798-b-degraded-trading-build.md) Part 1
(slice 3: FULL review path, no migration, parked by default, depends on slice 1, landed as #1936)
and Part 2 decisions 10 and 17. Slice 2 (#1941) also landed; this plan reuses its
`FULL_DISK_BYTES` (`apps/server/src/boot-failure.ts:47`). Backlog: A798-B (`docs/backlog.md:5409`)
and the clock entry under "Payments and card readers" (`docs/backlog.md:3896-3900`). The spec's own
citations of `till-sale.ts:1236-1237` now read `:1237-1238` after #1938.

**Lane note:** #1938 merged as `8f17dac0b`; this branch is rebased onto it. Of the open pull
requests (read: `gh pr list --state open`), #1944 touches three files this slice changes:
`apps/server/src/till-api.ts` (its hunks start at `:45`-`:171`, `:1152`, `:2236`, `:2248` and
`:3199`, none in the status table at `:413-446` or at `:1248`/`:1327`),
`apps/server/src/working-order.ts` (its hunks above `:6683` remove more lines than they add, so
`priceForIssuance` moves up if it lands first; its body is not in a hunk), and `apps/till/src/i18n/strings.ts`.
If #1944 lands first, find each site by name. #1939 touches `packages/fiscal-none/src/index.ts` and
`packages/fiscal-verifactu/src/index.ts`, which this slice does not edit.

---

## Review round 1

Findings in `~/waitron-campaign-b/a798-3-plan-review/round1.md`, with the lane runner's rulings.

- **C1** (the narrow stop departs from §4.6 item 5): decision 4 now says plainly that it departs
  from the approved design text and that an owner question is open, gives three options with a
  worked example, recommends (b) with its reason, and names the knock-on for slice 6's strip. The
  narrow stop stays the default built. Optional Task 12 sketches where (a) or (c) would add their
  check, so an answer needs no replanning.
- **I1** (a payment queued behind a failing write never sees the stop): decision 17. The stop is
  checked inside the payment's first transaction and again just before the reader, through the
  existing release paths; Tasks 5 and 7 test both windows, each with a control. Task 4 adds
  `noted()`.
- **I2** (a restart forgets the stop): decision 2. At start the server reads the venue folder's
  free space once, with the clearing rule's reading and threshold, and starts with the stop set
  when under it; an unreadable reading leaves it clear and logs. Task 4 tests both directions and
  the unreadable case; Task 8 wires it. The "slice 5 owns it" deferral is gone.
- **I3** (the sale's own sentences): decisions 10, 18 and 19. The sale-only sentence and the
  after-the-charge sentence are built. Telling them apart needs a new code,
  `sale.charged_not_recorded`, which costs one extra task (Task 7b, the server side); the till side
  sits in Tasks 9a and 9b. Clock-in, the kitchen ticket advance and the table, line and discard
  mappers get the full-disk sentence where it is a one-line mapping (Task 9c); clock-in needs no
  code change, only a test, because it already shows any coded refusal through the code table
  (`apps/till/src/state/clocking.ts:32-35`, `:209`; `till-app.ts:4711-4712`; read). The draft save
  and the unpaid-departure handler are a named backlog entry owned by slice 6 (Task 11).
- **I4** (Task 2 edited `VerifactuBackend.recordSale`): removed. The clock check now runs in the
  server, at the issue reading (decision 6, Task 2), so `VerifactuBackend.recordSale`, core
  `recordSale` and `chain.ts` are untouched. One deviation from the ruling's words "backend.ts
  untouched": `packages/fiscal-verifactu/src/backend.ts` gains one new method,
  `assertRecordableAt`, delegating to `refuseBeforeFirstIssueDate`; no existing line of it changes.
  It is forced while the seat member is required: `VerifactuBackend` is declared
  `implements FiscalBackend` (`backend.ts:156`), and a class missing a required member of an
  interface it implements fails to compile (M6, TS2420 on TypeScript 7.0.2). The alternative —
  an optional member added in `slot.ts`'s `makeBackend` — would let a later regime skip the
  decision and would leave the check off every backend built with `new VerifactuBackend(...)`
  directly: 68 files do, `apps/server/src/testing/bill-venue.ts:115` among them (M6). If the
  runner still wants `backend.ts` untouched, that alternative is the way, with that cost. The
  paths that still meet the library's own refusal are listed in decision 6, with the precedence
  change and the offset finding (the brief says M1; the offset finding is M4).
- **N1** (Task 6's predicted failure): the status entry `"clock.unusable": 409` now lands in Task 2,
  before Task 6, and Task 6's Step 2 states what fails and why.
- **N2** (the clock sentence drops the date): built (decision 11). The till's client flattens a
  refusal's params onto the thrown object (`apps/till/src/api/client.ts:4848`), the till already
  interpolates a refusal's value (`overLimitOf`, `till-app.ts:813-819`, through `overLimitText`,
  `i18n/t.ts:43-45`), and `Intl.DateTimeFormat` prints `01/01/2001` for the 2001 reading in
  `es-ES` and `en-GB` (M6). The date is formatted in the till's current language
  (`currentLocale()`, `i18n/t.ts:22-24`); the till has no separate venue locale for this.
- **N3** (Task 1's commit did not typecheck): Task 1 now adds `VerifactuBackend.assertRecordableAt`.
- **N4** (the boot wiring test was weaker than Review focus 6): Task 8 now checks the two stores are
  the `venue` and `node` of the store boot opened, and that a refused start runs the unsubscribe.
- **N5** (the owes-nothing pointer found nothing): Task 5 tells the implementer to create a product
  priced `0.00`.
- **N6** (stale lane note): rewritten above; every `till-sale.ts` line re-read at `8f17dac0b`.
- **N7** (clearing only on a card payment; one log for two refusals; double log): Task 4 logs the
  clearing once even when two reads race; the stop's refusal drops its never-logged `reason`
  (`packages/server-kit/src/error-boundary.ts:34-39` logs only `requestId` for a full disk) and the
  refusal sites log their own event instead (Tasks 5, 7). That the stop clears only when a card
  payment reads free space goes to a backlog entry owned by slices 5 and 6 (Task 11), and the
  inode case to the docs (Task 11).
- **N8** (control dates will collide with slice 8): every 28-10-2024 control (Tasks 1, 2, 6, 7)
  runs in a database holding no record dated later; each step says so.
- **N9** (`clock.unusable` as a refusal; a later alert-area trap; `namedRefusalOf` redundant):
  reusing the code stays. The trap — `CORE_ALERTS` gives the `clock.` prefix to the area `fiscal`
  (`packages/db/src/alerts.ts:7`) while design §4.3 puts `clock.unusable` under "Equipo" — goes to
  a backlog entry for slice 9 (Task 11). **Disagreed** on the redundancy: the money handlers now
  need their own mapping (`saleRefusalOf`, Task 9a) because a sale shows sentences the code table's
  generic ones do not — the sale-only disk sentence and the dated clock sentence — so
  `counterError`'s `{ code }` is not enough there.

---

## Measured for this plan

The Vitest probes ran as
`env -u AI_AGENT -u CLAUDECODE NO_COLOR=1 apps/server/node_modules/.bin/vitest run --root ~/waitron-campaign-b/a798-3-plan-probe/srv <name>`
(and `packages/fiscal-verifactu/node_modules/.bin/vitest … --root …/lib` for M4) from the worktree,
importing the worktree's own `apps/server/src` and `packages/*/src`, so they ran slices 1 and 2 as
landed. M1 to M3 go through the real till routes with `provisionBillVenue`
(`apps/server/src/testing/bill-venue.ts:103`): the real Veri\*Factu backend, real filing, and the
`FakePaymentProvider` whose `collectCalls` (`packages/payments/src/testing/fake-provider.ts:84`)
counts every time the reader is asked. Before each probe the failing case is stated; it is repeated
beside each result.

- **M1 — today, a clock before 28-10-2024** (`srv/clock.test.ts`; `Tests 13 passed (13)`). The
  route's clock set by `venue.appAt(…)` to 2026-10-21T11:00Z (control), 2001-01-01T11:00Z and
  2024-10-27T11:00Z. Failing case for "today a connected card is charged before the sale is
  refused" (design §11 item 4, marked "read; not run" there): `collect 0` under 2001.
  - Control 2026: `POST /api/pay` walk-up card → `200 captured`, `collect calls 1`, a sale and a
    record written; cash `POST /api/sales` → `200`; a part card payment on a bill → `200
    received`, `collect 1`, then the completing card → `200`, `collect 1`, the sale filed; a cash
    payment completing a bill → `200`.
  - 2001 and 2024-10-27 alike: walk-up card → **`409 {"code":"fiscal.record_invalid","params":{"fields":["FechaExpedicionFactura"],"codes":["FECHA_EXPEDICION_BEFORE_MINIMUM"]}}`,
    `collect calls 1`**, `payments` 3 → 4 with no sale: **the card was charged and the sale
    refused.** Cash `/api/sales` → the same `409`, nothing written. A part card payment on a bill →
    **`200 received`, `collect 1`** (accepted, dated by the wrong clock); the completing card →
    `409` the same, **`collect 1`**, `bill_payments` 4 → 5, no sale. A cash payment completing a
    bill → `409`, nothing written.
  - The review re-ran this probe unchanged and got the same answers (round1.md, "Experiments run").
- **M2 — today, card sales on a database at its page limit** (`srv/fill.test.ts`, the page-limit
  stand-in slice 1 used: a `ballast` table filled with 16-byte rows until
  `pragma max_page_count = page_count + 2` refused, which took 345 rows). Failing case for "after one
  save fails for a full disk, a later card can still be charged and its sale not recorded": the
  later card's `collect 0`.
  - A 20-line cash sale → `507 {"code":"storage.disk_full","params":{}}`, nothing written. A 20-line
    card sale → `507`, **`collect 0`**: its first transaction, which writes the order, failed before
    the reader.
  - Then, on the same database: a 1-line card sale → `200`, `collect 1`; again → `200`; a 1-line
    cash sale → `200`. **Free room in pages already allocated held small sales after a big one
    failed** (slice 1's E12 saw the same for cash).
  - Then card sales one after another until one failed: the first → **`507 storage.disk_full`,
    `collect 1`, payments captured with no sale 0 → 1, working orders 4 → 5**; the next → **`507`,
    `collect 1`, captured with no sale 1 → 2**. Two cards charged, neither sale recorded.
- **M3 — Pay again on a charged, unrecorded order** (`srv/fill.test.ts`, continuing M2 with the
  first failed order's id and `lines: []`). Failing case for "Pay again does not charge a second
  time": `collect 1`. Still full: `507 storage.disk_full`, **`collect 0`**, nothing changed. Page
  limit lifted: `200 captured`, **`collect 0`**, captured with no sale 1 → 0, sales +1. So the
  recovery path (`kind: "recover"`, `till-sale.ts:1158-1174`) files the captured card without
  asking the reader. A real full disk: slice 2's F8 measured that after deleting the filler "the
  next transaction ok" through `openVenueStore` on HFS+ and APFS
  (`2026-10-21-a798-2-full-disk-at-start.md`, F8).
- **M4 — the library judges the minimum date in the record's own offset** (`lib/boundary.test.ts`,
  `@waitron/verifactu` 0.2.1's `buildAltaRecord`, `validate` and `formatDate`; `Tests 1 passed (1)`).
  Failing case for "the offset decides the date": the same answer for one instant at two offsets.
  - `2024-10-27T23:30:00Z` at offset 0 → `FechaExpedicion 27-10-2024`, before-minimum **true**; at
    offset +60 → `28-10-2024`, **false**.
  - At +60: `2024-10-27T22:59:59Z` → `27-10-2024`, true; `2024-10-27T23:00:00Z` → `28-10-2024`,
    false. `2024-10-28T00:00:00Z` at −60 → `27-10-2024`, true. `2001-01-01T11:00:00Z` at +60 → true;
    `2026-10-21T11:00:00Z` at +120 → false.
  - Every line also listed `CLAVE_REGIMEN_REQUIRED` and `S1_TIPO_IMPOSITIVO_REQUIRED`: the probe's
    record left those fields out, and they say nothing about the date. Task 1's agreement test must
    build a record with no other blocking issue, as `venue-fields.charset.test.ts:9-31` intends.
- **M5 — searches** (each command run at `c416ec2bb`):
  - `/usr/bin/grep -rn "FECHA_EXPEDICION_BEFORE_MINIMUM\|20241028\|2024-10-28" packages apps scripts --include='*.ts'`
    printed nothing: no repository code or test names the minimum date. The library exports no
    constant for it (read: its `index.d.ts` and `format.d.ts`).
  - `/usr/bin/grep -rn "storage.disk_full\|clock.unusable\|FECHA_EXPEDICION" apps/dashboard/src apps/till/src apps/server/src packages --include='*.test.ts'`
    found only `node-entry.full-disk.test.ts` and `recovery-surface.test.ts` (the start and the
    recovery page). No till, dashboard or route test pins what a full disk or the minimum date
    shows.
  - `/usr/bin/grep -rn "\"clock\.\|'clock\." packages apps --include='*.ts'` (less tests): the
    siblings are `clock.degraded` and `clock.jump_detected` (`packages/fiscal/src/errors.ts:9`,
    `:12`), and the bell gives the `clock.` prefix an area (`packages/db/src/alerts.ts:7`). No
    `clock.unusable` exists.
  - `ls apps/server/src/guide/en apps/server/src/guide/es`: each holds `content-and-images.md`,
    `kitchen-service.md`, `modifiers.md` and `products.md`; `grep -i "disk|space|clock|tax agency|reader|pay"`
    over the English ones found two unrelated lines. No guide page covers taking a payment.
  - `selectOrderInvoice` has eight callers (`grep -rn "selectOrderInvoice("`), including
    `working-order.ts:1589`, which runs while an order is being CREATED, not filed. That is why the
    clock check does not go inside `selectOrderInvoice` (decision 6).
- **M6 — searches and probes for this revision** (run at `8f17dac0b`):
  - `/usr/bin/grep -rn "recordSale(" apps/server/src packages --include='*.ts' | /usr/bin/grep -v "\.test\.ts\|/testing/"`:
    the server's five callers of core `recordSale` are `till-sale.ts:952` (`fileImmediateSale`),
    `:1564` (`finalizeCapture`), `:1731` (`finalizeRecovery`), `bill-payments.ts:713`
    (`issueWhenFullyPaid`) and `working-order.ts:6731` (`issueUnpaidInvoice`); the only other
    caller outside the fiscal packages is the setup readiness check,
    `packages/provisioning/src/fiscal-readiness-runner.ts:110`.
  - Each of the five passes `recordSale` the clock `issueMoment` returned
    (`till-sale.ts:936`/`:952`, `:1554`/`:1564`, `:1694`/`:1731`; `bill-payments.ts:685`/`:713`;
    `working-order.ts:6693` in `priceForIssuance`, whose result `issueUnpaidInvoice` passes at
    `:6731`), and `issueMoment` answers every `now()` with the one reading it took
    (`issue-moment.ts:17-27`); core `recordSale` reads that clock once (`record-sale.ts:275`)
    after allocating the number (`:271`) and hands its instant and offset to the backend
    (`:363-364`). `grep -rn "issueMoment(" apps/server/src` (less tests) lists exactly those five
    calls.
  - `/usr/bin/grep -rn "record_invalid" apps/server/src apps/till/src apps/dashboard/src packages --include='*.ts'`
    (less tests and `fiscal-verifactu`): `till-api.ts:446` and `apps/till/src/till-app.ts:517` only.
  - `/usr/bin/grep -rln "new VerifactuBackend(" apps packages --include='*.ts' | wc -l` → 68.
  - A TypeScript probe (`~/waitron-campaign-b/a798-3-plan-probe/tsc-implements/probe.ts`, run with
    `packages/fiscal-verifactu/node_modules/.bin/tsc --noEmit --strict`, version 7.0.2): a class
    declared `implements` an interface and missing one of its required methods →
    `error TS2420: Class 'Impl' incorrectly implements interface 'Seat'`, exit 1.
  - `node -e` on Node v26.11.1: `new Intl.DateTimeFormat(l, { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date("2001-01-01T11:00:00.000Z"))`
    → `01/01/2001` for `es-ES`, `en-GB` and `ca-ES`; with `{ dateStyle: "short" }`, `es-ES` printed
    `1/1/01`.
  - `placeOrder` (`working-order.ts:6628-6673`) and `markOrderPlaced` (`:6786-6808`) call neither
    `recordSale`, `selectOrderInvoice` nor `issueMoment` (read, and an `awk` over those lines that
    printed nothing): placing an order files no sale, so it never meets the clock refusal.

**Not measured:**
- No probe ran on Linux or on a box. The stop's clearing reads `statfs`; slice 2's F1 measured
  `freeBytes` reading 0 on HFS+, Linux tmpfs and Linux ext4 when full, and about 1.2 MB on APFS.
- A real full disk through the card routes was not run; M2 and M3 used the page-limit stand-in,
  whose free-space reading is the real disk's (plenty), which is why the tests below set free space
  through an injected `statfs` (reasoned, not run).
- The two windows of decision 17 and the start reading of decision 2 were not probed; they are built
  test-first in Tasks 4, 5, 7 and 8.

---

## Decisions this plan makes that the spec does not

The owner confirms or overrides these when reviewing the plan. Each has the DEFAULT to build.

1. **What sets the full-disk stop: every write the engine refuses because the disk is full.** The
   design says "the first save that fails" (§4.6 item 5). DEFAULT: "a save that fails" means any
   statement, `begin` or `commit` on either of the venue folder's two database files that the
   engine refuses with result code 13, which slice 1 turns into `storage.disk_full`
   (`packages/store/src/disk-full.ts:4-12`) — from a till request, a dashboard request or a
   background duty alike, including one the code catches and survives (slice 1's E13 shapes). The
   store reports it (Task 3); the server's own refusal before the reader (an `AppError` it throws,
   not an engine refusal) does not report it again. Alternative not built: setting it in the till
   routes' error boundary, which would miss the other 76 `createErrorBoundary` call sites and every
   background duty (`grep -rn "createErrorBoundary(" apps packages | grep -v test | wc -l`: 77).
2. **Where it lives: in the server's memory, one per venue folder, made at start — and a start on a
   folder under 16 MiB free begins with it set.** DEFAULT: `createDiskFullState` in `boot.ts`,
   listening to `store.venue` and `store.node`. Right after, boot reads `freeBytes(venueDir)` once
   (`apps/server/src/free-bytes.ts:6-15`, the reading decision 3 clears on) and, below
   `FULL_DISK_BYTES`, notes a refusal (`noteFullAtStart`, Task 4), so a box restarted on a disk that
   is still full refuses its first card-reader payment instead of charging it (M2's pattern). A
   reading of exactly `FULL_DISK_BYTES` starts clear, as it clears a noted stop. An **unreadable**
   reading (`null`) at start leaves the stop clear and logs `storage.start_space_unread`: decision 3
   keeps a noted stop on `null` because an engine refusal has already proved the disk full, but at
   start nothing has, and on a filesystem that never reports free space a stop set at start could
   never clear, refusing every card-reader payment for good. The free-space watch and its alerts
   stay slice 5's (design §4.6 item 4).
3. **What clears it: a free-space reading of the venue folder of at least `FULL_DISK_BYTES`
   (16 MiB).** The design says "Trading comes back only when someone frees space" without saying
   how the box knows. A later successful write cannot be the sign: M2 shows small writes succeed
   after a big one failed. DEFAULT: while a refusal is noted, each card-reader payment reads
   `freeBytes(venueDir)` before its first transaction; at 16 MiB or more the stop is forgotten and
   the payment goes on. 16 MiB is slice 2's line between "full" and "not full"
   (`boot-failure.ts:47`): every full-disk failure it measured had at most 48 KiB free on HFS+,
   tmpfs and ext4, and about 1.2 MB reported free on APFS. A reading of `null` (the filesystem
   cannot say) keeps the stop. When nothing is noted, nothing is read. Two reads that both find
   space log the clearing once. Deferred: the strip (slice 6), the Box status row and Liberar
   (slice 7), the minute-by-minute watch and its alerts (slice 5); until one of them reads free
   space, a noted stop clears only when a card-reader payment is tried (backlog, Task 11).
4. **What the stop refuses — this departs from the approved design, and an owner question is
   open; the narrow stop is the default built meanwhile.** Design §4.6 item 5, labelled the owner's
   answer to question 1, says "the first save that fails turns every device red, every sale, order,
   kitchen send and clock-in is refused with the honest message of item 2 … Trading comes back only
   when someone frees space", and §9's record of that answer repeats "A disk that fills anyway stops
   every save at once". The design's default 1 (§6) says "Keep selling whenever the record can be
   written". This plan builds less than §4.6 item 5, and the lane runner has put the choice to the
   owner in `~/waitron-campaign-b/questions.md` (A798-B slice 3). Worked example: at 21:40 a
   20-line card sale on the counter fails because the disk is full; nothing is charged (M2: its
   first transaction failed, `collect 0`). At 21:41 Marta rings up one caña for cash, which would
   fit (M2: a 1-line cash sale after the 20-line failure answered `200`). At 21:42 Ana clocks in;
   at 21:43 Luis sends table 4's mains to the kitchen; at 21:44 Marta takes a card on the
   connected reader.
   - **(a) Every write refused while the stop holds** (the design's text): the caña, Ana's
     clock-in, the mains and the card are all refused with "No se ha guardado…" until someone frees
     space.
   - **(b) The narrow stop** (the default built): only the 21:44 card is refused, before the reader
     is asked. The caña is recorded, Ana is clocked in and the kitchen gets the mains; each of
     those is refused by itself, with its sentence, only if its own save does not fit.
   - **(c) Every sale refused**: the caña and the card are refused ("Venta no registrada…") —
     every route that would record a sale or take money, cash and "Otro datáfono" included — while
     Ana's clock-in and the kitchen send go on, each refused by itself if it does not fit.

   **Recommendation: (b).** The house rule is that losing a little data is accepted and being
   unable to trade is not ("Data loss is the accepted price … being stuck offline is not", memory
   `cold-recovery-no-hot-failover-posture`, owner 2026-08-29, quoted in design §6 default 1). M2
   shows saves that fit still succeed after a big one failed, so (a) and (c) would refuse sales
   the box can record. The harm the stop exists to prevent is a card charged with no sale recorded
   (M2's loop: two cards charged, neither recorded), and (b) is the smallest rule that prevents it:
   a cash sale or an order that does not fit is refused before any card is charged, by its own
   failure. **Knock-on for slice 6:** under (b), the red strip's "No se puede guardar nada: el
   equipo no tiene espacio" (design §3, §4.6 item 2) would be false while cash sales, orders and
   clock-ins are being saved; slice 6 would need words that say card payments are stopped and saves
   may fail. Under (a) the strip's words stand; under (c) it would say sales are stopped.

   What (b) refuses, exactly: `POST /api/pay` when it is about to ask the reader (a new or open
   order — "collect" — and a placed order whose invoice is already filed — "settle") and a reader
   payment on a bill. Every other write tries and either succeeds or fails on its own with
   `storage.disk_full`, which the till now names (Tasks 9a-9c). Not refused by the stop: cash,
   "Otro datáfono", a sale that owes nothing, a replay of a payment already taken, and the recovery
   of a card already charged (`kind: "recover"`/`"recover-settle"`, which never asks the reader,
   M3). If the owner answers (a) or (c), optional Task 12 adds its check; the main tasks stay, since
   both include (b)'s refusal before the reader.
5. **The clock refusal is a new code, `clock.unusable { clockAt }`, declared by the Veri\*Factu
   module and offered through the fiscal seat.** Design §8 calls it "`fiscal.record_invalid` caused
   by the minimum date". Keeping that code would make the till recognise the library's own
   validation code, `FECHA_EXPEDICION_BEFORE_MINIMUM` — a Spanish identifier in general code
   (CLAUDE.md §3, English only) and a regime detail on the generic side of the seat (§5). DEFAULT:
   `clock.unusable`, beside its siblings `clock.degraded` and `clock.jump_detected` (M5), the name
   design §4.3 already gives the alert for the same cause, following the design's "one code for the
   refusal and the alert" (§4.8 a). `clockAt` is the reading's instant as ISO 8601: a time, not
   operator data, so it may go into the log the recovery page shows (the reason
   `fiscal.record_invalid`'s params carry no values, `packages/fiscal-verifactu/src/errors.ts:80-89`).
   The seat member is `FiscalBackend.assertRecordableAt(reading)`, REQUIRED rather than optional,
   so a regime added later has to decide; `VerifactuBackend` implements it by delegating (Review
   round 1, I4, says why that adds one method to `backend.ts`).
6. **Where the clock check runs: at the issue reading, in the server, and at the two checks before
   the reader.** DEFAULT: `issueMoment(clock, gross, fiscal)` calls `fiscal.assertRecordableAt` on
   the one reading it takes, before rating the lines (Task 2). Every server path that records a
   sale goes through it (M6): a cash or "Otro datáfono" sale and a counter collection
   (`fileImmediateSale`), a card's P3 (`finalizeCapture`), a card already charged
   (`finalizeRecovery`), a bill's completion, by any payment or by the pending-payment pass
   (`issueWhenFullyPaid`), and an unpaid departure (`priceForIssuance`, which gains a `backend`
   parameter). The check reads the very reading the record will carry, so it judges the date in
   the record's own offset, which M4 shows decides the date (`2024-10-27T23:30Z` refused at offset
   0, accepted at +60). The refusal comes inside the request's transaction, before core
   `recordSale` allocates the invoice number (`record-sale.ts:271`) and writes the sale row; what
   the transaction wrote before it (a walk-up order, dishes sent to the kitchen) rolls back with
   the request, as today. Not inside `selectOrderInvoice`, which also runs when an order is created
   (M5). `VerifactuBackend.recordSale`, core `recordSale` and `chain.ts` are not edited.
   - **Paths that still meet the library's own refusal, `fiscal.record_invalid`:** the setup
     readiness check's test sale (`packages/provisioning/src/fiscal-readiness-runner.ts:110`, not a
     till route; it does not go through `issueMoment`), and corrections, substitutions and voids,
     which go through the chain (`chain.ts:187-197`); slice 8 stops every money route under a clock
     behind the last sale. No till route that records a sale is left (M6).
   - **Precedence change:** under a clock before the minimum date, a sale that today fails for
     another reason checked after the issue reading now answers `clock.unusable` instead. In
     `fileImmediateSale` that is a tender shortfall (`settlementFor`, `till-sale.ts:941`),
     `selectOrderInvoice`'s refusals (`:947`), core `recordSale`'s own checks (counterparty,
     breakdown, simplified-invoice limit; `record-sale.ts:171-198`) and the backend's
     `sif.not_registered` or foreign-recipient refusal; at the check before the reader
     (`till-sale.ts:1237-1238`) and in `beginBillPayment` (`bill-payments.ts:1078`), whatever those
     functions check after it. Under any other clock nothing changes. (read)
7. **The clock check applies to every bill payment; the stop only to a reader payment on a bill.**
   `beginBillPayment` is shared by cash, "Otro datáfono" and reader payments
   (`bill-payments.ts:1164`, `:1342`). Under a clock before the minimum date no bill can be
   completed (M1), and a part payment taken now is dated by the wrong clock. DEFAULT: every bill
   payment is refused `clock.unusable` before anything is written; the stop's refusal applies only
   when `state === "pending"` (the reader).
8. **The settle kind gets the stop but not the clock check.** A placed order whose invoice is
   already filed writes no new record when paid (`finalizeSettle`, `till-sale.ts:1867-1925`, calls
   `settleSale` and never `recordSale`; read), so the minimum date does not refuse it; slice 8
   refuses it under a clock behind the last sale.
9. **The minimum date is a constant in `packages/fiscal-verifactu`, pinned by a test against the
   library.** The library exports none (M5). DEFAULT: `FIRST_ISSUE_DAY = 20241028` compared with
   the reading's date in its own offset (M4), and a test that runs the library's `validate` on a
   record dated by each boundary reading and requires the same answer, so a library bump that moves
   the date fails it.
10. **Three full-disk sentences on the till, by what the staff member must do.** DEFAULT:
    - **A refused save** anywhere that is not taking money (design §4.6 item 2): "No se ha guardado:
      el equipo no tiene espacio en disco. Avisa al encargado." / "Not saved: the box is out of disk
      space. Tell a manager." — the code table's entry for `storage.disk_full`.
    - **A sale refused before any money moved** (design §3's table, picture 1): "Venta no
      registrada: el equipo no tiene espacio en disco. No cobres hasta que se resuelva; avisa al
      encargado." / English in decision 19 — on every money surface, for `storage.disk_full`: the
      stop's refusal before the reader, a sale whose first transaction failed (M2: `collect 0`),
      and a cash or "Otro datáfono" sale that did not fit.
    - **A card charged, the sale not recorded** (design §3): "Cobrado con tarjeta, pero la venta no
      se ha registrado: el equipo no tiene espacio. No vuelvas a cobrar; avisa al encargado." /
      "Card charged, but the sale is not recorded: the box is out of space. Do not charge again;
      tell a manager." — for `sale.charged_not_recorded` (decision 18).
11. **The clock sentence carries the reading's date.** Design §3 and picture 6: "Venta no
    registrada: la hora del equipo es incorrecta (marca 01/01/2001). Avisa al encargado. Si ya has
    cobrado con tarjeta en el datáfono, devuelve el importe ahí." DEFAULT: that sentence with
    `{date}` filled from the refusal's `clockAt`, formatted with
    `Intl.DateTimeFormat(currentLocale(), { day: "2-digit", month: "2-digit", year: "numeric" })`
    in the till's own time zone (M6 printed `01/01/2001` in `es-ES` and `en-GB`). English, the
    plan's (the design gives none): "Sale not recorded: the box's clock is wrong (it reads {date}).
    Tell a manager. If you already charged a card on the terminal, refund it there." The card
    advice is today's, word for word (`apps/till/src/i18n/strings.ts:1350`, `:3041`). A
    `clock.unusable` arriving without `clockAt` shows the same sentence without the bracket, from
    the code table. Placing an order gets no clock sentence: placing files no sale and never meets
    the check (M6), so the earlier draft's `place.clock_unusable` is dropped.
12. **Which till surfaces name the refusals.** DEFAULT, by task:
    - Money surfaces, through a new `saleRefusalOf` checked first (Tasks 9a, 9b):
      `#onConfirmPayment` (`till-app.ts:5984`), `#collectCard` (`:6112`), `wholeTabErrorOf`
      (`:588`, the presented bill's sheet), `#onCollectOrder` (`:7033`), `#onFindBillPay` (`:7665`),
      and the bill pay dialog's `refusalText` (`apps/till/src/widgets/pay-refusal.ts:36-68`, fed by
      `apps/till/src/state/bill-payment.ts:245-256`).
    - Other surfaces, the refused-save sentence (Task 9c): every caller of `counterError` (`:865`;
      `storage.disk_full` joins `ACTIONABLE_REFUSALS`, `:798`), placing and parking among them;
      `tableWriteError` (`:645`, through `TABLE_REFUSALS`, `:523`) and so `lineWriteError`'s
      fallback (`:790-793`); `discardError` (`:877-883`); the kitchen ticket advance
      (`#onAdvanceTicketItem`, `:7774`, whose `catch` sets `station.advance_error` at `:7788`); and
      clock-in, which already shows a coded refusal through the code table (I3 above; a test only).
    - Left, with a named backlog entry owned by slice 6 (Task 11): the draft save's refusals
      (`apps/till/src/state/draft-sync.ts:129-132` and the handlers that read them) and the unpaid
      departure's handler.
13. **The dashboard's two readers of `server.internal` keep their code.** Slice 1 moved a full disk
    off `server.internal` (its E10 and E18; M2 here printed `507 storage.disk_full`), so both now
    reach their "any other code" branch: the stuck-payments check shows `codeMessage(code)`
    (`apps/dashboard/src/screens/payments-screen.ts:63-73`), and the translations dialog treats a
    full disk as a definite refusal rather than an uncertain save
    (`apps/dashboard/src/widgets/content-translations-dialog.ts:443-462`). The second is right
    because a route that answers `storage.disk_full` from one transaction kept nothing of it
    (slice 1, conventions-data.md "What the store does now"); the translations save is one
    `gated` transaction (`apps/server/src/content-translations-api.ts:162-168`; read). DEFAULT: no
    change to either file; the dashboard's code table gains `storage.disk_full` ("No se ha guardado:
    el equipo no tiene espacio en disco." / "Not saved: the box is out of disk space." — no "Tell a
    manager" on the managers' app) and `clock.unusable` ("No se ha registrado: la hora del equipo es
    incorrecta." / "Not recorded: the box's clock is wrong."), and a test pins each reader.
14. **Status codes.** DEFAULT: the till routes answer `clock.unusable` with `409`, as they answer
    `fiscal.record_invalid` (`apps/server/src/till-api.ts:446`), and `sale.charged_not_recorded`
    with `507`; a route whose table does not name a code answers the boundary's default `400`
    (`packages/server-kit/src/error-boundary.ts:42`). `storage.disk_full` keeps the boundary's
    `507` (`error-boundary.ts:34-39`), the server's own refusal before the reader included.
15. **No guide changes.** No guide page covers taking a payment (M5). A screen's behaviour changes
    only in which sentence a refusal shows.
16. **Parked for the owner (the build plan's decision 17).** The owner's rule parks a pull request
    that changes invoices, the Veri\*Factu record chain or its hashes, invoice series or numbering,
    or AEAT filing.
    - *For landing it itself:* it changes no invoice's content, no record, hash or chain link, no
      series or number, and nothing about filing; `chain.ts`, every record builder, the golden
      fingerprint test and the immutability test are untouched. Under a clock before the minimum
      date every sale it refuses was already refused, after the card was charged (M1). The only
      sales it refuses that would otherwise be issued are card-reader sales while the full-disk
      stop holds.
    - *For parking it:* that last refusal is real (M2: a 1-line card sale succeeded after a 20-line
      one failed, and under the stop it would be refused); it puts a refusal on every server path
      that records a sale (`issueMoment`) and touches the settle handlers; it moves part payments
      on a bill under a wrong clock from accepted to refused (M1); and decision 4's question is
      open.
    DEFAULT: park, finished to green. The owner can say "land it".
17. **A reader payment checks the stop three times** (review I1). Writes are serialised by the
    write queue (`packages/store/src/write-queue.ts:42-48`), so a payment that read "not full" can
    wait behind another till's write that fails for a full disk, then run its own small first
    transaction on reused pages (M2's pattern) and charge. DEFAULT: (1) before the first
    transaction, `await disk.full()` (which may clear the stop, decision 3); (2) inside the first
    transaction, at the refusal point, refuse when (1) said full OR `disk.noted()` is now true;
    (3) after that transaction commits and just before `provider.collect`, refuse when
    `disk.noted()` is true, undoing the first transaction's effects through the paths a reader that
    charged nothing already takes: on `POST /api/pay`, the attendance finished as refused and the
    in-flight mark released, as for a `failed` result (`till-sale.ts:1342-1350`); on a bill,
    `failBillPayment` (`bill-payments.ts:1280`), as for a refused start (`:1378-1383`). `noted()`
    is synchronous and reads no disk. A cleanup write that itself fails for a full disk answers
    `storage.disk_full` as well, so no card is charged either way, and a mark left behind is
    cleared by the release pass (`releasePaymentAttempt`'s doc, `till-sale.ts:1445-1450`).
18. **A card charged whose sale then fails for a full disk answers `sale.charged_not_recorded`.**
    The stop's refusal and a failure after a charge both answer `507 storage.disk_full` with empty
    params today (`error-boundary.ts:34-39`), so the till cannot tell "no card was charged" from "a
    card was charged" — and the first failure that sets the stop is the second kind (M2's loop).
    DEFAULT: a new code in the server's registry (`apps/server/src/errors.ts`),
    `sale.charged_not_recorded { workingOrderId: string; cause: "disk_full" }`, answered `507`.
    How each path sets its answer: the stop's refusal before the reader, and a first transaction
    that fails for a full disk, answer `storage.disk_full` (nothing charged); a cash or "Otro
    datáfono" sale that fails answers `storage.disk_full` (no reader); `POST /api/pay`'s P3
    (`till-sale.ts:1353-1381`) and the bill reader payment's P3 (`bill-payments.ts:1387-1414`, the
    captured branch) catch an error for which `diskFullIn` (`packages/shared/src/engine-failure.ts:40-51`)
    is true and throw the new code instead. The new error does not carry the disk-full error as a
    cause, because the boundary checks `diskFullIn` before anything else and would answer
    `storage.disk_full` (`error-boundary.ts:34-39`); the store's listener has already noted the
    stop (Task 3). `cause` has one value today; slice 8's "Cobrado con tarjeta, pero … la hora del
    equipo es anterior a la última venta" (design §4.8 a) can add a second. After the answer, the
    card is filed without a second charge: on `/api/pay`, Pay again takes the recovery path (M3);
    on a bill, the payment stays pending and the pending-payment pass completes it from the
    provider's row once it can (`bill-payments-loop.ts:153-158`; read). **A cross-package
    contract change** (server ↔ till): Review focus 7.
19. **The sale-only disk sentence's English.** Design §3 and picture 1 give only the Spanish.
    DEFAULT: "Sale not recorded: the box is out of disk space. Don't take payment until it is
    fixed; tell a manager." The Spanish is the design's, word for word.

**Questions for the owner (the default is built if unanswered):** decision 4 (asked by the lane
runner), and decision 16's parking.

---

## Behaviour this slice removes

Run at `c416ec2bb`, M5's second search found no existing test pinning any of these, so no existing
assertion should change. If one does, it belongs to this list.

- Under a clock before 28-10-2024, a connected card charged before the sale is refused, on
  `POST /api/pay` (M1: `collect calls 1`, then `409 fiscal.record_invalid`) and on a bill's
  completing card (M1: `collect 1`, then `409`).
- Under such a clock, a part payment on a bill (cash, "Otro datáfono" or a reader) accepted with the
  wrong date (M1: `200 received`).
- Under such a clock, every server path that records a sale answering
  `fiscal.record_invalid {"fields":["FechaExpedicionFactura"],"codes":["FECHA_EXPEDICION_BEFORE_MINIMUM"]}`
  (M1); it now answers `clock.unusable { clockAt }` at the issue reading, before the invoice number
  is allocated — on the cash and counter routes, a card's P3 and recovery, a bill's completion and
  an unpaid departure — and, under such a clock, a sale that fails for another reason checked after
  that point answers `clock.unusable` too (decision 6).
- After a write failed because the disk was full, card-reader sales charged and then refused,
  one after another (M2), until the stop is cleared by a free-space reading; and after a restart
  on a folder still under 16 MiB free, the first such sale charged and refused.
- A card charged and its sale then refused for a full disk answering `storage.disk_full`; it now
  answers `sale.charged_not_recorded`.
- The till showing "This sale cannot be filed with the tax agency … the venue's invoice settings need
  fixing" for a wrong clock (design §2.5), and its generic retry sentence, or the code table's
  generic one, for a full disk on the surfaces of decision 12 (build plan decision 10).
- The dashboard's stuck-payments check and translations dialog showing the generic "Something went
  wrong, try again" for a full disk.

---

## Global constraints

- Every commit `git commit -s`. Never `--no-verify`. Work in this worktree only.
- **No migration.** No change to `packages/fiscal-verifactu/src/chain.ts`, to any record builder
  (`VerifactuBackend.recordSale`, `recordCorrection`, `recordSubstitution`, core `recordSale` in
  `packages/core/src/record-sale.ts`), to anything that builds a fingerprint, to invoice series or
  numbering, or to filing. The one change in `packages/fiscal-verifactu/src/backend.ts` is a new
  method, `assertRecordableAt`, that delegates to `refuseBeforeFirstIssueDate`; no existing line of
  that file changes (check: `git diff main -- packages/fiscal-verifactu/src/backend.ts` shows only
  added lines and one import). The golden fingerprint test
  (`packages/fiscal-verifactu/src/write-path.e2e.test.ts`) and the immutability test
  (`packages/fiscal-verifactu/src/inmutabilidad.test.ts`) must pass **unedited**; Task 1 runs both.
- Two new error codes: `clock.unusable`, in the Veri\*Factu registry
  (`packages/fiscal-verifactu/src/errors.ts`), and `sale.charged_not_recorded`, in the server's
  (`apps/server/src/errors.ts`). `storage.disk_full` is slice 1's
  (`packages/shared/src/errors.ts:60`). New log events are plain names, not `AppError` codes:
  `storage.disk_full_noted`, `storage.disk_space_back`, `storage.start_space_unread`,
  `storage.disk_full_stop_refused`.
- General code is English only (CLAUDE.md §3). Spanish goes only in `apps/till/src/i18n/codes.ts`,
  `apps/till/src/i18n/strings.ts`, `apps/dashboard/src/i18n/codes.ts`, and
  `packages/fiscal-verifactu`. The till and the dashboard never name `FECHA_EXPEDICION_BEFORE_MINIMUM`.
- `packages/fiscal`'s sources must not name the regime (`packages/fiscal/src/no-regime-vocabulary.test.ts`
  forbids words such as "chain", "huella" and "hash" in code; comments are blanked before the scan).
- Coverage stays at 98/98/98/95 in `packages/fiscal`, `packages/fiscal-none`,
  `packages/fiscal-verifactu`, `packages/store`, `apps/server`, `apps/till` and `apps/dashboard`.
  `packages/fiscal` is mutation-tested on `src/backend.ts` (`packages/fiscal/stryker.config.json`,
  floor 90); this slice adds only an interface member there. No exclude, no ignore comment.
- Database tests in `apps/server` and `packages/fiscal-verifactu` use `useVenueDb`.
  `packages/store`'s open a real store on a temporary folder with `openVenueStore`
  (`packages/store/src/index.test.ts:29-38`), as slice 1's `disk-full.test.ts` does.
- **Every 28-10-2024 control runs in a database holding no record dated later than it** (review
  N8): slice 8's clock-behind stop will refuse a sale dated before the latest record. Put such a
  case in a file or `describe` whose database has no later-dated sale, or reset it first
  (`useVenueDb`'s `resetPerTest`), and say so beside the case.
- A rejected request asserts the domain code and, where it names one, its params — never
  `toBeInstanceOf(Error)` (CLAUDE.md §4).
- "The reader was never asked" is asserted as `venue.card.collectCalls.length` unchanged, read
  before and after the request, never as a mock-call count that a refused request could also leave
  at zero for another reason; each such test has a control in the other direction (the same request
  without the refusal's cause asks the reader once).
- Till and dashboard tests run in real headless Chromium: check `memory_pressure | grep free` before
  a run and scale to what is free (CLAUDE.md §2).
- Comments only for an invariant or a non-obvious why; no history.
- Focused runs: `pnpm --filter <pkg> exec vitest run <files>`. Read the `Tests` count every time;
  a run with no count proved nothing. Under this agent Vitest hides a passing test's console output;
  unset `AI_AGENT` and `CLAUDECODE` to see it. CI runs the package suites.

## Review focus

1. **Nothing is charged while a refusal stands.** For each refusal, the reader is not asked
   (`collectCalls` unchanged) and the first transaction kept nothing: no walk-up order, no payment
   attempt mark, no attendance row, no `bill_payments` row (Tasks 5, 6, 7) — including a refusal
   noted while the payment waited in the write queue, and one noted after its first transaction
   (decision 17).
2. **Nothing that should go on is refused.** A recovery of a card already charged, a replay, cash,
   "Otro datáfono" and a sale that owes nothing are not refused by the stop; a sale at 00:00 local
   on 28-10-2024 is not refused by the clock (Tasks 5, 6, 7; Task 1's boundary).
3. **The date is judged as the record would be.** The issue-reading check judges the very reading
   the record carries, in its own offset (Task 2, decision 6); the check agrees with the library on
   both sides of the boundary (Task 1). The pre-reader check reads the clock at P1 and the record
   at P3; a clock that moves back between them is caught at P3's issue reading, after the charge,
   as design §3 accepts.
4. **The stop's lifecycle.** Set by the store's report, or at start under 16 MiB free; cleared
   only by a reading at or above 16 MiB; a `null` reading keeps a noted stop and leaves a start
   clear; no reading while nothing is noted; one clearing log when two reads race (Task 4). The
   store reports an engine refusal with code 13 once, and not a refusal with any other code; a
   listener that throws changes nothing the caller sees (Task 3).
5. **The seat.** `assertRecordableAt` is required on `FiscalBackend`; the none backend and the fake
   return; only the Veri\*Factu backend refuses; `issueMoment` asks it on its one reading, and
   every server sale path passes through `issueMoment` (Tasks 1, 2; M6).
6. **Boot wiring.** The stop listens to both of the venue folder's files, reads free space once at
   start, and reaches both card routes; a refused start runs the unsubscribe (Task 8).
7. **The new wire answer, `sale.charged_not_recorded`** (cross-package contract, server ↔ till).
   Thrown only after a capture and only for a full disk, on both reader routes; the till shows
   the after-the-charge sentence for it and never the sale-only one; Pay again files without a
   second charge (Tasks 7b, 9a, 9b).
8. **The fiscal guard.** `git diff main -- packages/fiscal-verifactu/src/backend.ts packages/core/src/record-sale.ts packages/fiscal-verifactu/src/chain.ts`
   shows only the added delegating method (Task 1).

---

### Task 1: The minimum date as the Veri\*Factu module's rule, offered through the fiscal seat

**Files:**
- Modify: `packages/fiscal/src/backend.ts` (`FiscalBackend`, `:171-245`)
- Modify: `packages/fiscal/src/testing/fake-backend.ts` (`FakeFiscalBackend`, `:43`)
- Modify: `packages/fiscal-none/src/backend.ts` (`NoneBackend`, `:26`), and its test
  `packages/fiscal-none/src/backend.test.ts`
- Modify: `packages/fiscal-verifactu/src/backend.ts` — ADD the method `assertRecordableAt` to
  `VerifactuBackend` (`:156`) and its import. Change no existing line.
- Create: `packages/fiscal-verifactu/src/first-issue-date.ts`
- Create: `packages/fiscal-verifactu/src/first-issue-date.test.ts`
- Modify: `packages/fiscal-verifactu/src/errors.ts` (the `ErrorParams` block)
- Modify: every hand-built `FiscalBackend` the typecheck below names — at least
  `packages/core/src/record-sale.test.ts:153` and `packages/core/src/record-void.test.ts:168`
  (`wrapBackend`), `packages/core/src/record-void.test.ts:377`, and
  `apps/server/src/served-at-huella.test.ts:92` — adding `assertRecordableAt: () => {}` (or the
  fake's, bound by hand as those helpers bind the rest). Setup only; no assertion changes.

**Interfaces:**
- Produces, in `packages/fiscal/src/backend.ts`:
  ```ts
  /**
   * Throws this regime's refusal when a record stamped with `reading` could never be accepted, so a
   * caller can refuse before money moves. A regime with no such rule returns.
   */
  assertRecordableAt(reading: Pick<TrustedReading, "instant" | "offsetMinutes">): void;
  ```
  (`TrustedReading`, `packages/fiscal/src/clock.ts:26-28`.)
- Produces, in `packages/fiscal-verifactu/src/errors.ts`:
  `"clock.unusable": { clockAt: string }`, with a doc comment: the box's clock reads a date before
  the first one AEAT accepts for an invoice (28-10-2024), so no sale can be recorded; `clockAt` is
  the reading's instant, ISO 8601.
- Produces, in `first-issue-date.ts`:
  ```ts
  /** 28-10-2024 as YYYYMMDD: `@waitron/verifactu` refuses an earlier FechaExpedicionFactura. */
  export const FIRST_ISSUE_DAY = 20241028;
  /** Throws `clock.unusable` when the reading's date, in its own offset, is before {@link FIRST_ISSUE_DAY}. */
  export function refuseBeforeFirstIssueDate(reading: { instant: Date; offsetMinutes: number }): void;
  ```
  It takes the date with the library's own `formatDate(instant, offsetMinutes)` (`DD-MM-YYYY`,
  `@waitron/verifactu`'s `format.d.ts`), so it reads the date exactly as the record will carry it.
- `VerifactuBackend.assertRecordableAt(reading)` calls `refuseBeforeFirstIssueDate(reading)`.
  `FakeFiscalBackend.assertRecordableAt` and `NoneBackend.assertRecordableAt` return.

- [ ] **Step 1: Write the failing tests.**
  - In `first-issue-date.test.ts`, `describe("refuseBeforeFirstIssueDate")`:
    - `"refuses a reading in 2001 with the reading's instant"`:
      `expect(() => refuseBeforeFirstIssueDate({ instant: new Date("2001-01-01T11:00:00.000Z"), offsetMinutes: 60 })).toThrow(expect.objectContaining({ code: "clock.unusable", params: { clockAt: "2001-01-01T11:00:00.000Z" } }))`.
    - `it.each` over M4's boundary readings, each with its expected answer:
      `2024-10-27T22:59:59.999Z` +60 → refused; `2024-10-27T23:00:00.000Z` +60 → returns;
      `2024-10-27T23:30:00.000Z` 0 → refused; `2024-10-27T23:30:00.000Z` +60 → returns;
      `2024-10-28T00:00:00.000Z` −60 → refused; `2026-10-21T11:00:00.000Z` +120 → returns. The
      23:30 pair is the case that separates "the reading's own offset" from a comparison in UTC.
    - `"agrees with the library on every boundary reading"`: for each reading above, build an alta
      with `buildAltaRecord` dated by it (`FechaExpedicionFactura` and `generadoEn` the instant,
      `offsetMinutes` the offset), shaped like `venue-fields.charset.test.ts:9-31`, and first assert
      that the 2026 reading's record has NO blocking issue at all (`validate(record).filter((i) => i.severity === "error")`
      is `[]`) — the control M4 lacked. Then require
      `validate(record, { now: instant }).some((i) => i.code === "FECHA_EXPEDICION_BEFORE_MINIMUM")`
      to equal whether `refuseBeforeFirstIssueDate` refuses. If the record cannot be made free of
      other blocking issues, STOP and report: the agreement test is then not discriminating.
    - `"VerifactuBackend refuses the same readings"`: a `VerifactuBackend` built as
      `packages/fiscal-verifactu/src/backend.test.ts` builds one; `assertRecordableAt` with the 2001
      reading rejects `clock.unusable` with its `clockAt`; with `2024-10-27T23:00:00.000Z` +60 it
      returns. (A pure check; no database record is written, so N8 does not apply.)
  - In `packages/fiscal-none/src/backend.test.ts`: `"refuses no clock: a venue with no regime has no first date"`:
    `new NoneBackend().assertRecordableAt({ instant: new Date("2001-01-01T11:00:00Z"), offsetMinutes: 60 })`
    returns `undefined` and does not throw.

- [ ] **Step 2: Run them and watch them fail**

  Run: `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/first-issue-date.test.ts` and
  `pnpm --filter @waitron/fiscal-none exec vitest run src/backend.test.ts`.
  Expected: the first FAILS to import `./first-issue-date.js`; the none case FAILS with
  `assertRecordableAt is not a function`.

- [ ] **Step 3: Implement** the interface member, the registry entry, `first-issue-date.ts`, the
  Veri\*Factu, none and fake members.

- [ ] **Step 4: Run them and watch them pass; typecheck every dependant; run the fiscal guards**

  Run the two commands of Step 2: PASS, with `Tests` counts that include the new cases. Then
  `pnpm --filter "...@waitron/fiscal" typecheck` (the package and every workspace package that
  depends on it): each hand-built backend in the Files list fails until it gains the member; add it
  to each and re-run until it exits 0. `{} as FiscalBackend` stubs compile either way; Task 2 meets
  any that reach the new call. Then `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`
  — PASS, and `git diff --stat main -- packages/fiscal-verifactu/src/write-path.e2e.test.ts packages/fiscal-verifactu/src/inmutabilidad.test.ts`
  prints nothing. Then `git diff main -- packages/fiscal-verifactu/src/backend.ts` shows only added
  lines.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/fiscal packages/fiscal-none packages/fiscal-verifactu/src/first-issue-date.ts packages/fiscal-verifactu/src/first-issue-date.test.ts packages/fiscal-verifactu/src/errors.ts packages/fiscal-verifactu/src/backend.ts packages/core/src apps/server/src/served-at-huella.test.ts
  git commit -s -m "The fiscal seat can say a clock reading is too early to record, and Veri*Factu knows its first day"
  ```

### Task 2: Every server path that records a sale refuses under such a clock, at its issue reading

**Files:**
- Modify: `apps/server/src/issue-moment.ts` (`issueMoment`, `:17-27`)
- Modify: its callers — `apps/server/src/till-sale.ts:936` (`fileImmediateSale`), `:1554`
  (`finalizeCapture`), `:1694` (`finalizeRecovery`); `apps/server/src/bill-payments.ts:685`
  (`issueWhenFullyPaid`); `apps/server/src/working-order.ts:6683-6695` (`priceForIssuance`, which
  gains a `backend` parameter) and its callers `apps/server/src/unpaid-departure.ts:118` and
  `apps/server/src/testing/issue-order.ts:14`
- Modify: `apps/server/src/till-api.ts` (the status table, `:446`)
- Test: `apps/server/src/issue-moment.test.ts`; create `apps/server/src/sale-clock.test.ts`

**Interfaces:**
- `issueMoment(clock: TrustedClock, gross: GrossLines, fiscal: Pick<FiscalBackend, "assertRecordableAt">): IssueMoment`
  takes its one reading, calls `fiscal.assertRecordableAt(reading)`, then rates the lines as today.
  Every caller passes its `deps.backend` (or `backend`). Existing test calls gain a third argument
  `{ assertRecordableAt: () => {} }` — setup, not an assertion.
- `priceForIssuance(tx, clock, backend, cfg, id)`.
- The till routes' status table gains `"clock.unusable": 409`, beside `"fiscal.record_invalid": 409`.

- [ ] **Step 1: Write the failing tests.**
  - `issue-moment.test.ts`: `"asks the regime about the one reading it rates at"`: a clock whose
    `now()` returns a fixed reading object and counts calls; a `fiscal` stub recording its argument
    → the stub got that same object (`toBe`), `now()` was called once. And `"rates nothing when the
    regime refuses the reading"`: a stub throwing `new AppError("clock.unusable", { clockAt: "x" })`
    → `issueMoment` throws that error.
  - `sale-clock.test.ts`, on `provisionBillVenue` with a counter zone offering one product (as M1's
    probe set up, `~/waitron-campaign-b/a798-3-plan-probe/srv/clock.test.ts:13-25`), the route's
    clock set with `venue.appAt(clock)` to a `TrustedClock` returning a fixed
    `{ instant, offsetMinutes: 60 }`:
    - `"refuses a cash sale under a clock in 2001 by name, before the invoice number"`:
      `POST /api/sales` cash at `2001-01-01T11:00:00.000Z` →
      `409 { code: "clock.unusable", params: { clockAt: "2001-01-01T11:00:00.000Z" } }`; the
      counts of `sales` and `registros_facturacion`, and the series' `next_number`, read before and
      after, unchanged; no `working_orders` row with the request's id.
    - Control `"records the same sale at 00:00 local on 28-10-2024"`: `2024-10-27T23:00:00.000Z`
      +60 → `200`, one more sale. This file's database holds no record dated later than it (N8):
      no case here records a later sale before this one.

- [ ] **Step 2: Run them and watch them fail**

  Run: `pnpm --filter @waitron/server exec vitest run src/issue-moment.test.ts src/sale-clock.test.ts`
  Expected: the two `issueMoment` cases FAIL — the stub was never called, and no error was thrown;
  the cash case FAILS with `409 fiscal.record_invalid` where `clock.unusable` was expected (M1
  printed that for this request); the control passes before and after.

- [ ] **Step 3: Implement** the parameter, the call, the callers and the status entry.

- [ ] **Step 4: Run the sale suites and watch them pass**

  Run: `pnpm --filter @waitron/server exec vitest run src/issue-moment.test.ts src/sale-clock.test.ts src/till-sale.test.ts src/till-sale-integrated.db.test.ts src/till-api.fiscal-sale-paths.test.ts src/bill-payments.test.ts src/bill-payments.card.test.ts src/bill-payments-loop.test.ts`
  plus every `unpaid-departure*.test.ts` (`ls apps/server/src/unpaid-departure*.test.ts`) — PASS,
  `Tests` counts shown. A test whose stub backend (`grep -rln "{} as FiscalBackend\|{} as unknown as FiscalBackend" apps/server/src`)
  now fails with `assertRecordableAt is not a function` gets `assertRecordableAt: () => {}` in its
  stub: setup, not an assertion; run those files too. Then
  `pnpm --filter @waitron/server typecheck` exits 0.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/server/src
  git commit -s -m "Every sale the server records is refused as clock.unusable at its issue reading under a clock before 28-10-2024"
  ```

### Task 3: The store tells listeners when the engine refuses a write because the disk is full

**Files:**
- Modify: `packages/store/src/connections.ts` (`Connections`, `:81-142`; `connectionPair`, `:176-252`)
- Modify: `packages/store/src/disk-full.ts`, `write-queue.ts` (`:66`, `:84`, `:96`),
  `node-sqlite-adapter.ts` (`:98`, `:111`, `:209`, `:224`)
- Modify: `packages/store/src/index.ts` (`StoreHandle`, `:57-100`; `handle`, `:242-252`)
- Test: `packages/store/src/disk-full.test.ts`

**Interfaces:**
- Produces, on `Connections` and on `StoreHandle`:
  `onDiskFull(listener: () => void): () => void` — registers `listener`, returns the unsubscribe.
- Behaviour: each time the store turns an engine error carrying result code 13 into
  `storage.disk_full` — a statement on the writer or the reader, the queue's `begin immediate`, the
  queue's `commit`, the adapter's own `commit` or `release` — every listener is called once,
  synchronously, before the error is thrown. Re-throwing a failure the store already recorded
  (`endedBy()`), or making the fresh nested-level error of `ENDED_UNDER_SAVEPOINT`
  (`node-sqlite-adapter.ts:226-231`), calls nobody: the engine refused nothing new. A listener that
  throws, or returns a promise that rejects, is skipped, as `reportIfChanged`'s are
  (`connections.ts:242-250`). Implement it as ONE mapping helper on the connection pair that the
  current `asDiskFull(error)` call sites use, so no site can map without reporting.

- [ ] **Step 1: Write the failing tests** in `disk-full.test.ts`, in a new
  `describe("telling listeners about a full disk")`, with the file's existing helpers (a store on a
  temporary folder, `limit(db, 4)`, `fill`):
  - `"calls each listener once when a statement inside a body is refused for a full disk"`: two
    listeners registered on `store.venue`; a `withWriteLock` body that runs `fill` and lets it
    escape. Each listener was called exactly once; the run rejects `{ code: "storage.disk_full" }`.
  - `"calls it once for a statement outside any body"`: `fill` through `db.execute` with no body
    running → one call.
  - `"does not call it for a refusal that is not a full disk"` (control): a duplicate of the unique
    `body` column inside a body → the run rejects with the unique refusal; zero calls.
  - `"does not call it again for the statements a body runs after the engine ended its transaction"`:
    Q2's shape (catch `fill`, then insert `part 2`) → one call, not two, though `part 2` also throws
    `storage.disk_full`.
  - `"keeps the caller's error when a listener throws"`: a listener that throws `new Error("boom")`
    and a second that counts → the run still rejects `{ code: "storage.disk_full" }` and the second
    was called once.
  - `"stops calling a listener once unsubscribed"`: unsubscribe, `fill` again → zero further calls.
  - `"tells the node file's listeners, not the venue file's, about the node file"`: a listener on
    `store.venue` and one on `store.node`; fill `store.node` under its own page limit → node 1,
    venue 0.

- [ ] **Step 2: Run them and watch them fail**

  Run: `pnpm --filter @waitron/store exec vitest run src/disk-full.test.ts`
  Expected: every new case FAILS with `onDiskFull is not a function`; the existing cases pass.

- [ ] **Step 3: Implement** the helper, the listener set and `StoreHandle.onDiskFull`. Add one line
  to `StoreHandle`'s doc beside `onCommit` saying which refusals are reported.

- [ ] **Step 4: Run the store's suite and watch it pass**

  Run: `pnpm --filter @waitron/store exec vitest run` — PASS, `Tests` count shown. Then
  `pnpm --filter @waitron/store test:coverage` holds 98/98/98/95, and
  `pnpm --filter @waitron/store typecheck` exits 0.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/store/src
  git commit -s -m "The store tells listeners each time the engine refuses a write because the disk is full"
  ```

### Task 4: The full-disk stop, kept by the server

**Files:**
- Create: `apps/server/src/disk-full-state.ts`
- Create: `apps/server/src/disk-full-state.test.ts`

**Interfaces:**
- Consumes: `freeBytes`, `Statfs` (`apps/server/src/free-bytes.ts:3-15`); `FULL_DISK_BYTES`
  (`apps/server/src/boot-failure.ts:47`); `Logger`; `AppError`.
- Produces:
  ```ts
  export interface DiskFullState {
    /** The engine refused a write because the disk is full. Keeps the first time until cleared. */
    noteRefused(): void;
    /** Whether a refusal is noted now. Reads no disk. */
    noted(): boolean;
    /**
     * Whether a payment on a connected card reader must be refused now. Reads the folder's free
     * space only while a refusal is noted, and forgets the refusal at FULL_DISK_BYTES or more.
     */
    full(): Promise<boolean>;
    /** When the refusal now noted was first noted; null when none is. */
    since(): Date | null;
  }
  export function createDiskFullState(deps: {
    dir: string;
    now: () => Date;
    log: Logger;
    statfs?: Statfs;
  }): DiskFullState;
  /** Notes a refusal on `state` when the folder has less than FULL_DISK_BYTES free; an unreadable
   * reading notes nothing and logs. Called once, at start. */
  export function noteFullAtStart(
    state: DiskFullState,
    deps: { dir: string; log: Logger; statfs?: Statfs },
  ): Promise<void>;
  /** Notes on `state` every full-disk refusal any of `stores` reports; returns the unsubscribe. */
  export function watchForDiskFull(
    state: DiskFullState,
    stores: readonly { onDiskFull(listener: () => void): () => void }[],
  ): () => void;
  /** The refusal a card-reader payment gets while the stop holds. */
  export function diskFullRefusal(): AppError<"storage.disk_full">;
  ```
  `noteRefused` logs `("warn", "storage.disk_full_noted", {})` only when nothing was noted.
  `full()` clears only if a refusal is still noted when its reading returns, so two reads that race
  log `("info", "storage.disk_space_back", { freeBytes })` once. `noteFullAtStart` logs
  `("warn", "storage.start_space_unread", {})` on a `null` reading. `diskFullRefusal()` is
  `new AppError("storage.disk_full", {})`, with no `reason`: the boundary never logs one for a
  full disk (`packages/server-kit/src/error-boundary.ts:34-39`); the refusal sites log their own
  event (Tasks 5, 7).

- [ ] **Step 1: Write the failing tests** in `disk-full-state.test.ts`, with a `statfs` stub whose
  answer each case sets (`{ bavail, frsize: 1 }` gives `bavail` bytes) and which counts its calls:
  - `"is not full, and reads nothing, until a refusal is noted"`: `full()` → `false`; statfs calls 0;
    `since()` → `null`; `noted()` → `false`.
  - `"is full after a refusal while the folder has less than 16 MiB free"`: `noteRefused()`, statfs
    `FULL_DISK_BYTES - 1` → `noted()` `true`, `full()` `true`; `since()` is the injected `now()`.
  - `"forgets the refusal at exactly 16 MiB free, and logs it once"`: statfs `FULL_DISK_BYTES` →
    `full()` `false`, `since()` `null`, `noted()` `false`, one `storage.disk_space_back` log with
    `freeBytes`; a second `full()` reads nothing.
  - `"logs the clearing once when two reads find space together"`: noted; statfs resolves
    `FULL_DISK_BYTES` after a tick; `await Promise.all([full(), full()])` → both `false`, one
    `storage.disk_space_back` log.
  - `"stays full when the folder's free space cannot be read"`: statfs rejects → `full()` `true`.
  - `"keeps the first time across later refusals, and logs the first only"`: two `noteRefused()` at
    two `now()` values → `since()` is the first; one `storage.disk_full_noted` log.
  - `"notes again after it cleared"`: note, clear, note → `full()` `true` with statfs 0.
  - `noteFullAtStart`: `"starts full on a folder with less than 16 MiB free"` (statfs
    `FULL_DISK_BYTES - 1` → `noted()` `true`); `"starts clear at exactly 16 MiB free"` (statfs
    `FULL_DISK_BYTES` → `noted()` `false`, no `storage.disk_full_noted` log);
    `"starts clear, and says so, when free space cannot be read"` (statfs rejects → `noted()`
    `false`, one `storage.start_space_unread` log).
  - `"notes every refusal a watched store reports, until unsubscribed"`: two fake stores (objects
    whose `onDiskFull` keeps the listener); calling either listener notes; after the returned
    unsubscribe, both fakes' unsubscribes ran.
  - `"refuses with storage.disk_full"`: `diskFullRefusal()` matches `{ code: "storage.disk_full", params: {} }`.

- [ ] **Step 2: Run them and watch them fail**

  Run: `pnpm --filter @waitron/server exec vitest run src/disk-full-state.test.ts`
  Expected: FAILS to import `./disk-full-state.js`.

- [ ] **Step 3: Implement** `disk-full-state.ts`.

- [ ] **Step 4: Run them and watch them pass**

  Run the command of Step 2: PASS, `Tests` count shown.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/server/src/disk-full-state.ts apps/server/src/disk-full-state.test.ts
  git commit -s -m "The server keeps a full-disk stop: set by a refused write or a start under 16 MiB free, cleared by 16 MiB of free space"
  ```

### Task 5: `POST /api/pay` does not ask the reader while the full-disk stop holds

**Files:**
- Modify: `apps/server/src/till-sale.ts` (`IntegratedPayDeps`, `:595-605`; `payIntegrated`,
  `:1106-1382`)
- Modify: `apps/server/src/till-api.ts` (`TillApiDeps`, `:267-301`; `/api/pay`, `:1778-1835`)
- Modify: `apps/server/src/testing/bill-venue.ts` (add `appWith`)
- Create: `apps/server/src/till-pay.disk-full.test.ts`

**Interfaces:**
- `IntegratedPayDeps` and `TillApiDeps` gain `disk?: DiskFullState`, documented as `pool` is:
  optional only for suites that never reach the reader; a live boot always supplies it (Task 8).
  `/api/pay` passes `disk: deps.disk`.
- `payIntegrated` (decision 17): before the P1 transaction (`:1116`),
  `const preRead = (await deps.disk?.full()) ?? false;` and
  `const stopped = () => preRead || (deps.disk?.noted() ?? false);`. Inside P1,
  `if (stopped()) refuseForStop();` at exactly two points:
  - the settle branch, immediately before `if (locked.status === "placed") onLive(PLACED_ATTEMPT);` (`:1194`);
  - the collect branch, after the owes-nothing `return` (`:1241-1262`) and before `issuancePass` (`:1265`).
  Never before the replay (`:1129-1134`) or the recovery (`:1164-1174`) returns.
- After P1 commits, between `const attemptAt = …` (`:1323`) and the `try` around
  `provider.collect` (`:1325`): if `deps.disk?.noted() === true`, finish the attendance as refused
  and release the mark exactly as the `failed` result does (`:1342-1350`), then `refuseForStop()`.
- `refuseForStop()` logs `deps.log?.("warn", "storage.disk_full_stop_refused", { workingOrderId: req.id })`
  and throws `diskFullRefusal()`.
- `BillVenue.appWith(opts: { clock?: TrustedClock; disk?: DiskFullState }): Hono` — the same routes,
  tips on, with those deps.

- [ ] **Step 1: Write the failing tests** in `till-pay.disk-full.test.ts`, on
  `provisionBillVenue` with a counter zone offering one product, as M1's probe set up
  (`~/waitron-campaign-b/a798-3-plan-probe/srv/clock.test.ts:13-25`), and a second product priced
  `0.00` that the test creates for the owes-nothing case (no fixture provides one: review N5). A
  real `createDiskFullState` over a settable `statfs` stub, noted by calling `noteRefused()`,
  except where a case says otherwise. Every case reads `venue.card.collectCalls.length` before and
  after.
  - `"refuses a walk-up card sale while a refused write is noted, and never asks the reader"`:
    noted, statfs 0 → `507 { code: "storage.disk_full" }`, collect unchanged, no `working_orders`
    row with the request's id, no `payments` row for it.
  - Control `"asks the reader when nothing is noted"`: same request, fresh state → `200 captured`,
    collect +1.
  - `"sells again once the folder has 16 MiB free"`: noted, statfs `FULL_DISK_BYTES` → `200`,
    collect +1, `since()` `null`. And with `FULL_DISK_BYTES - 1` → `507`, collect unchanged.
  - `"refuses a placed order whose invoice is filed, before the reader"`: a placed order with an
    issued invoice (`issueOrderInvoice`, `apps/server/src/testing/issue-order.ts:6-17`; the shape of
    `till-sale-integrated.db.test.ts:1817-1957`), noted → `507`, collect unchanged, the order's
    status and `payment_attempt_at` unchanged.
  - `"files a card already charged while the stop holds, without asking the reader again"`: a
    captured payment with no sale on an open order (`insertCapturedPayment`, as
    `till-sale-integrated.db.test.ts:304-314` does), noted, page room available → Pay again
    (`lines: []`) answers `200 captured`, collect unchanged, the sale filed (M3's shape).
  - `"does not refuse a sale that owes nothing"`: a walk-up of the `0.00` product, noted → `200`,
    collect unchanged.
  - Window 1 (decision 17), `"refuses before the reader when a refusal is noted while the payment
    waits for the write queue"`: the route gets a `DiskFullState` that wraps the real one and whose
    `full()` awaits the real `full()` (false: nothing noted), then starts — without awaiting — a
    `withTransaction(venue.db, …)` body that calls `state.noteRefused()`, then returns. That body is
    queued ahead of the payment's P1 (the queue runs in order, `packages/store/src/write-queue.ts:42-48`).
    → `507 storage.disk_full`, collect unchanged, no `working_orders` row. Control: the same
    wrapper whose queued body notes nothing → `200`, collect +1. Await the queued body before the
    case ends.
  - Window 2, `"refuses before the reader when a refusal is noted after the first transaction, and
    releases the order"`: a `DiskFullState` double whose `full()` answers `false` and whose
    `noted()` answers `false` on its first call (the check inside P1) and `true` from its second
    (the check before the reader), on an open order with lines → `507`, collect unchanged, the
    order's `payment_attempt_at` back to `null`. Control: `noted()` `false` throughout → `200`,
    collect +1. (The two calls are the two the Interfaces name; if the implementation calls
    `noted()` a different number of times on this path, STOP and report rather than reshape the
    double.)
  - End to end, last in the file, `"after a big sale fails on a full database, the next card sale is
    refused before the reader"`: `watchForDiskFull(state, [venue.db])`; fill to the page limit as M2
    did; a 20-line cash `/api/sales` → `507`, `state.since()` not `null`; statfs 0; a 1-line
    `/api/pay` → `507`, collect unchanged (M2 printed `200`, collect 1, for this sale before the
    slice). Then lift the limit (`pragma max_page_count = 4294967294`) and set statfs to
    `FULL_DISK_BYTES` → `200`, collect +1, sale filed. Restore the limit in a `finally`.

- [ ] **Step 2: Run them and watch them fail**

  Run: `pnpm --filter @waitron/server exec vitest run src/till-pay.disk-full.test.ts`
  Expected: the refusal cases and both windows FAIL with `200` where `507` was expected and collect
  +1 (the stop does not exist yet; `appWith` passes a `disk` nothing reads); the end-to-end case
  FAILS the same way, M2's answer. The controls, the recovery and the owes-nothing cases pass
  before and after.

- [ ] **Step 3: Implement** the deps, the read before P1, the two refusals inside it and the check
  before the reader.

- [ ] **Step 4: Run the card-pay suites and watch them pass**

  Run: `pnpm --filter @waitron/server exec vitest run src/till-pay.disk-full.test.ts src/till-sale-integrated.db.test.ts src/till-api.test.ts src/till-api.fiscal-sale-paths.test.ts`
  — PASS, `Tests` counts shown.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/server/src/till-sale.ts apps/server/src/till-api.ts apps/server/src/testing/bill-venue.ts apps/server/src/till-pay.disk-full.test.ts
  git commit -s -m "Pay by card refuses before the reader while a write refused for a full disk stands, rechecked inside its first transaction and just before the reader"
  ```

### Task 6: `POST /api/pay` refuses a sale under a clock before 28-10-2024 before the reader

**Files:**
- Modify: `apps/server/src/till-sale.ts` (`payIntegrated`, the collect branch, `:1237-1238`)
- Create: `apps/server/src/till-pay.clock.test.ts`

**Interfaces:**
- In the collect branch, immediately before the existing `selectOrderInvoice` call at `:1238`
  ("Before the reader is asked: P3 could never file this sale"):
  `deps.backend.assertRecordableAt(deps.clock.now());`. Not in the settle branch (decision 8).

- [ ] **Step 1: Write the failing tests** in `till-pay.clock.test.ts`, on `provisionBillVenue` and a
  counter zone, the route's clock set with `venue.appAt(clock)` to a `TrustedClock` returning a fixed
  `{ instant, offsetMinutes: 60 }`:
  - `"refuses a walk-up card sale under a clock in 2001, naming the clock, before the reader"`:
    `409 { code: "clock.unusable", params: { clockAt: "2001-01-01T11:00:00.000Z" } }`, collect
    unchanged, no `working_orders` row with the id, no `payments` row (M1 printed `collect 1` and a
    payment row).
  - `"refuses at 23:59:59.999 local on 27-10-2024, and asks the reader at 00:00 local on 28-10-2024"`:
    `2024-10-27T22:59:59.999Z` → `409 clock.unusable`, collect unchanged;
    `2024-10-27T23:00:00.000Z` → `200 captured`, collect +1 (the control). This file's database
    holds no record dated later than the control (N8): no case records a later sale before it.

- [ ] **Step 2: Run them and watch them fail**

  Run: `pnpm --filter @waitron/server exec vitest run src/till-pay.clock.test.ts`
  Expected: the 2001 case and the boundary's first half FAIL on collect +1 and on the `payments`
  row: without this check P1 lets the card be charged, and the refusal arrives only at P3's issue
  reading (Task 2), still answering `409 clock.unusable` because Task 2 added the status entry
  (review N1). The control passes before and after.

- [ ] **Step 3: Implement** the call.

- [ ] **Step 4: Run the card-pay suites and watch them pass**

  Run: `pnpm --filter @waitron/server exec vitest run src/till-pay.clock.test.ts src/till-pay.disk-full.test.ts src/till-sale-integrated.db.test.ts src/till-api.test.ts src/till-api.fiscal-sale-paths.test.ts src/till-sale.test.ts`
  — PASS, `Tests` counts shown.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/server/src/till-sale.ts apps/server/src/till-pay.clock.test.ts
  git commit -s -m "Pay by card refuses a sale under a clock before 28-10-2024 before the reader is asked"
  ```

### Task 7: Bill payments: the clock refusal for every payment, the stop for a reader payment

**Files:**
- Modify: `apps/server/src/bill-payments.ts` (`beginBillPayment`, `:1037-1122`; `takeBillPayment`,
  `:1155-1210`; `ReaderBillPaymentDeps`, `:1217`; `takeReaderBillPayment`, `:1332-1419`)
- Modify: `apps/server/src/bill-payments-api.ts` (the reader branch, `:247-265`, passes `disk: deps.disk`)
- Create: `apps/server/src/bill-payments.refuse-before-reader.test.ts`

**Interfaces:**
- `beginBillPayment`'s `now: Date` parameter becomes `reading: { instant: Date; offsetMinutes: number }`
  (both callers pass `deps.clock.now()`); every former use of `now` reads `reading.instant`. It
  gains a last parameter `refusals: { diskFull: () => boolean }`.
- At the existing `selectOrderInvoice` call (`:1078`), immediately before it:
  `backend.assertRecordableAt(reading);` then
  `if (state === "pending" && refusals.diskFull()) refuseForStop();`. Both run after the replay
  lookup (`:1054-1064`), so a retry of a payment already taken still answers its state.
- `ReaderBillPaymentDeps` gains `disk?: DiskFullState`. `takeReaderBillPayment` reads
  `const preRead = (await deps.disk?.full()) ?? false;` before its first transaction and passes
  `{ diskFull: () => preRead || (deps.disk?.noted() ?? false) }`; after that transaction commits
  and before the `try` around `provider.collect` (`:1366`), if `deps.disk?.noted() === true`, it
  fails the payment as a refused start does (`withTransaction(… failBillPayment(tx, payment.id, deps.clock.now().instant, undefined, deps.attendance))`,
  `:1378-1383`) and calls `refuseForStop()`; the `finally` at `:1416` releases the live claim.
  `takeBillPayment` passes `{ diskFull: () => false }`.
- `refuseForStop()` logs `("warn", "storage.disk_full_stop_refused", { workingOrderId })` and throws
  `diskFullRefusal()`.

- [ ] **Step 1: Write the failing tests** in `bill-payments.refuse-before-reader.test.ts`, on
  `provisionBillVenue` with `tabWith` bills and the request bodies `bill-payments.card.test.ts:58-110`
  uses; collect counted before and after:
  - `"refuses a reader payment while a refused write is noted, before the reader"`: noted, statfs 0
    → `507 storage.disk_full`, collect unchanged, no `bill_payments` row.
  - Control `"asks the reader when nothing is noted"` → `200 received`, collect +1.
  - `"takes cash and Otro datáfono while the stop holds"`: noted → a cash contribution `200
    received`; a manual card `200 received` (the stop guards the reader only, decision 4).
  - `"answers a retry of a payment already taken while the stop holds"`: take a reader payment,
    then note, then resend the same `submissionId` → `200`, the same payment id, collect unchanged.
  - `"takes a reader payment again once the folder has 16 MiB free"` → collect +1.
  - Window 1, as Task 5's (a `full()` wrapper that queues a body noting the refusal) → `507`,
    collect unchanged, no `bill_payments` row; control → `200`, collect +1.
  - Window 2, as Task 5's (`noted()` `false` then `true`) → `507`, collect unchanged, the bill
    payment `failed`; control → `200`, collect +1.
  - `"refuses a reader payment under a clock in 2001, before the reader"`: `appWith({ clock })` →
    `409 { code: "clock.unusable", params: { clockAt: "2001-01-01T11:00:00.000Z" } }`, collect
    unchanged, no `bill_payments` row (M1 printed `200 received`, collect 1, for a part payment).
  - `"refuses a cash part payment and a manual card under such a clock"` → `409 clock.unusable`,
    no `bill_payments` row.
  - Control `"takes a reader payment at 00:00 local on 28-10-2024"` → collect +1, in a database
    holding no record dated later (N8): run it before any case here that records a sale, or in its
    own `describe` with `resetPerTest`.

- [ ] **Step 2: Run them and watch them fail**

  Run: `pnpm --filter @waitron/server exec vitest run src/bill-payments.refuse-before-reader.test.ts`
  Expected: the stop's refusal and both windows FAIL with `200` and collect +1; the clock cases
  FAIL with `200 received` (part payments, M1); the controls, cash-while-stopped and the retry pass
  before and after.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run the bill suites and watch them pass**

  Run: `pnpm --filter @waitron/server exec vitest run src/bill-payments.refuse-before-reader.test.ts src/bill-payments.card.test.ts src/bill-payments.test.ts src/bill-payments-api.test.ts src/bill-payments.cash-up.test.ts src/bill-payments-loop.test.ts src/adjustments-bill-payments.test.ts`
  — PASS, `Tests` counts shown.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/server/src/bill-payments.ts apps/server/src/bill-payments-api.ts apps/server/src/bill-payments.refuse-before-reader.test.ts
  git commit -s -m "A bill payment is refused under a clock before 28-10-2024, and a reader payment while the full-disk stop holds"
  ```

### Task 7b: A card charged whose sale then fails for a full disk answers `sale.charged_not_recorded`

**Files:**
- Modify: `apps/server/src/errors.ts` (the `sale.*` entries, beside `"sale.empty_basket"`, `:289`)
- Modify: `apps/server/src/till-api.ts` (the status table)
- Modify: `apps/server/src/till-sale.ts` (`payIntegrated`'s P3, `:1353-1381`)
- Modify: `apps/server/src/bill-payments.ts` (`takeReaderBillPayment`'s P3, `:1387-1414`)
- Create: `apps/server/src/card-charged-not-recorded.test.ts`

**Interfaces:**
- `"sale.charged_not_recorded": { workingOrderId: string; cause: "disk_full" }`, with a doc
  comment: a card was charged on a connected reader and its sale could not be recorded; `cause`
  says why. Status `507`.
- On both routes, the P3 call is wrapped: an error for which `diskFullIn(error)` is true becomes
  `new AppError("sale.charged_not_recorded", { workingOrderId, cause: "disk_full" })`, thrown with
  no link to the original (decision 18); any other error is rethrown unchanged. On the bill route
  only the `captured` branch (`completeBillPayment`) is wrapped.

- [ ] **Step 1: Write the failing tests** in `card-charged-not-recorded.test.ts`, on
  `provisionBillVenue`. Each failure is made by
  `vi.spyOn(venue.backend, "recordSale").mockRejectedValueOnce(new AppError("storage.disk_full", {}))`
  (`venue.backend`, `bill-venue.ts:80`): the error the store throws for a full disk, met after the
  charge.
  - `"says a card was charged when its sale then fails for a full disk"`: a walk-up `/api/pay` →
    `507 { code: "sale.charged_not_recorded", params: { workingOrderId: <id>, cause: "disk_full" } }`,
    collect +1, a captured `payments` row with no sale. Then, the spy restored, Pay again
    (`lines: []`) → `200 captured`, collect unchanged, the sale filed (M3's shape).
  - Control `"passes any other failure after the charge through unchanged"`: the spy rejects
    `new Error("boom")` → `500 { code: "server.internal" }`.
  - `"says so on a bill's reader payment that would complete the bill"`: a reader payment for the
    whole bill → `507 sale.charged_not_recorded` with the bill's `workingOrderId`, collect +1, the
    bill payment still `pending`. Then, the spy restored, one `settlePendingBillPayments` pass
    (built as `bill-payments-loop.test.ts` builds it) → the payment `received`, the invoice filed,
    collect unchanged.
  - Control on the bill: the spy rejects `new Error("boom")` → `500 server.internal`.

- [ ] **Step 2: Run them and watch them fail**

  Run: `pnpm --filter @waitron/server exec vitest run src/card-charged-not-recorded.test.ts`
  Expected: the two full-disk cases FAIL with `507 storage.disk_full` where
  `sale.charged_not_recorded` was expected (the boundary answers any full disk so,
  `error-boundary.ts:34-39`); the controls pass before and after.

- [ ] **Step 3: Implement** the code, its status and the two wraps.

- [ ] **Step 4: Run them and the card suites and watch them pass**

  Run: `pnpm --filter @waitron/server exec vitest run src/card-charged-not-recorded.test.ts src/till-pay.disk-full.test.ts src/till-sale-integrated.db.test.ts src/bill-payments.card.test.ts src/bill-payments-loop.test.ts`
  — PASS, `Tests` counts shown. Then, from the worktree root (the root project holds the guards),
  `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/alert-codes.test.ts` — PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/server/src/errors.ts apps/server/src/till-api.ts apps/server/src/till-sale.ts apps/server/src/bill-payments.ts apps/server/src/card-charged-not-recorded.test.ts
  git commit -s -m "A card charged whose sale then fails for a full disk is answered sale.charged_not_recorded, not storage.disk_full"
  ```

### Task 8: Boot wires the stop to the venue folder's two files, its free space and the till routes

**Files:**
- Modify: `apps/server/src/boot.ts` (after `const store = await openVenueDatabase(config.venueDir);`,
  `:932-933`; `mountTillApi`, `:1653-1677`)
- Create: `apps/server/src/boot.disk-full-wiring.test.ts`

**Interfaces:**
- After `undoOnFailure.push(() => store.close());`:
  ```ts
  const diskFull = createDiskFullState({ dir: config.venueDir, now, log });
  undoOnFailure.push(watchForDiskFull(diskFull, [store.venue, store.node]));
  await noteFullAtStart(diskFull, { dir: config.venueDir, log });
  ```
  (`now` is `boot.ts:818`, `log` `:900`. CLAUDE.md §3: a duty pushes its stop onto `undoOnFailure`
  as soon as it exists.) `mountTillApi` gets `disk: diskFull`.

- [ ] **Step 1: Write the failing tests**, in the shape of `boot.clock-wiring.test.ts:1-80`
  (`serverFixture`, `vi.mock` of a module to capture what boot passes):
  - mock `./disk-full-state.js` so `createDiskFullState`, `watchForDiskFull` and `noteFullAtStart`
    record their arguments and return the real results, and `watchForDiskFull`'s returned
    unsubscribe records that it ran; mock `./till-api.js` so `mountTillApi` records its deps; mock
    `@waitron/db`, which `boot.ts` imports `openVenueDatabase` from (`boot.ts:49-55`), so each store
    `openVenueDatabase` returns is recorded in call order.
  - `"listens to both of the venue folder's files, reads its free space, and hands the stop to the
    till routes"`: after a start, `createDiskFullState` got `dir` equal to the started server's
    venue folder; `watchForDiskFull` got that state and exactly `[s.venue, s.node]` (`toBe` each),
    where `s` is the store the call at `boot.ts:932` returned — the second a start makes; the
    first, `:903`, is a probe closed at `:912`;
    `noteFullAtStart` got that state and that folder; `mountTillApi`'s deps carry `disk` equal to
    that state.
  - `"a refused start stops listening"`: make a step after the wiring throw, as
    `boot.failed-start.test.ts` does for its duties → the start rejects and the recorded
    unsubscribe ran once.

- [ ] **Step 2: Run them and watch them fail**

  Run: `pnpm --filter @waitron/server exec vitest run src/boot.disk-full-wiring.test.ts`
  Expected: both FAIL: `createDiskFullState` was never called.

- [ ] **Step 3: Implement** the three lines and the dep.

- [ ] **Step 4: Run them, and the boot suites near them, and watch them pass**

  Run: `pnpm --filter @waitron/server exec vitest run src/boot.disk-full-wiring.test.ts src/boot.test.ts src/boot.failed-start.test.ts`
  — PASS, `Tests` counts shown. Then `pnpm --filter @waitron/server test:coverage` and read the new
  files' rows: 98/98/98/95.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/server/src/boot.ts apps/server/src/boot.disk-full-wiring.test.ts
  git commit -s -m "The started box watches its database files and its free space for a full disk and stops card-reader payments on one"
  ```

### Task 9a: The till's sentences, on the counter's pay card and cash sale

**Files:**
- Modify: `apps/till/src/i18n/codes.ts` (`CODE_MESSAGES`, `:6-756`)
- Modify: `apps/till/src/i18n/strings.ts` (beside `sale.refused`, `:1350`, and its Spanish twin, `:3041`)
- Modify: `apps/till/src/i18n/t.ts` (beside `overLimitText`, `:43-45`)
- Modify: `apps/till/src/till-app.ts` (`CounterError`, `:1228-1243`, and where it is rendered,
  `errorText`, `:1277-1352`; `#onConfirmPayment`, `:6040-6062`; `#collectCard`, `:6196-6215`)
- Test: `apps/till/src/i18n/codes.test.ts`, `apps/till/src/till-app.test.ts` (beside
  `:9936-10060`)

**Interfaces:**
- `CODE_MESSAGES` gains, both columns:
  - `"storage.disk_full"`: decision 10's refused-save sentence.
  - `"sale.charged_not_recorded"`: decision 10's after-the-charge sentence.
  - `"clock.unusable"`: decision 11's sentence without the bracket — es "Venta no registrada: la
    hora del equipo es incorrecta. Avisa al encargado. Si ya has cobrado con tarjeta en el
    datáfono, devuelve el importe ahí." / en "Sale not recorded: the box's clock is wrong. Tell a
    manager. If you already charged a card on the terminal, refund it there."
- `strings.ts` gains `"sale.disk_full"` (decision 10's sale-only sentence; English from decision 19)
  and `"sale.clock_unusable"` (decision 11's dated sentence, with `{date}`).
- `t.ts`: `export function clockUnusableText(clockAt: string): string` — `t("sale.clock_unusable")`
  with `{date}` replaced by `clockAt` formatted as decision 11 says.
- `till-app.ts`: `CounterError` gains `| { clockUnusable: string }`, rendered with
  `clockUnusableText`. `function saleRefusalOf(error: unknown): CounterError | undefined` answers
  `"sale.disk_full"` for `storage.disk_full`, `{ code: "sale.charged_not_recorded" }` for that code,
  `{ clockUnusable: clockAt }` for `clock.unusable` carrying a string `clockAt`, and
  `{ code: "clock.unusable" }` for one without; `undefined` otherwise. `#onConfirmPayment` and
  `#collectCard` check it FIRST in their catch chains, ahead of `isPermanentSaleRefusal`.

- [ ] **Step 1: Write the failing tests.**
  - `codes.test.ts`: `"names a full disk, a card charged but not recorded, and a wrong clock in both
    languages"`: `codeMessage(code, "es-ES")` and `"en-GB"` equal the sentences above for each of
    the three codes; none equals `codeMessage("server.internal", …)`.
  - `till-app.test.ts`, beside `"a PERMANENT fiscal refusal on a tab pay surfaces sale.refused"`
    (`:9936`) and `"tells a CARD operator what to do about the money already on the terminal"`
    (`:10025`):
    - the counter cash sale (`api.recordSale` rejecting `{ code: "storage.disk_full", status: 507 }`)
      and the counter card pay (`api.pay` rejecting the same) each show `t("sale.disk_full")`, and
      not `codeMessage("storage.disk_full")`;
    - the counter card pay rejecting `{ code: "sale.charged_not_recorded", workingOrderId: "…", cause: "disk_full", status: 507 }`
      shows `codeMessage("sale.charged_not_recorded")`;
    - rejecting `{ code: "clock.unusable", clockAt: "2001-01-01T11:00:00.000Z", status: 409 }` shows
      the dated sentence with `01/01/2001` in it (the test runs in `es-ES`; restore the language
      after, CLAUDE.md §4), and NOT `t("sale.refused")`.

- [ ] **Step 2: Run them and watch them fail**

  Check `memory_pressure | grep free` first. Run:
  `pnpm --filter @waitron/till exec vitest run src/i18n/codes.test.ts src/till-app.test.ts`
  Expected: the code-table cases FAIL with the generic sentence; the pay cases FAIL with
  `t("sale.error")`. The existing `fiscal.record_invalid` → `sale.refused` cases pass before and
  after.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run them and watch them pass**, with the command of Step 2; `Tests` counts shown.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/till/src
  git commit -s -m "The till names a full disk, a card charged but not recorded, and a wrong clock with its date on the counter's pay"
  ```

### Task 9b: The same sentences on the bill sheets and dialogs, collecting and paying a found bill

**Files:**
- Modify: `apps/till/src/till-app.ts` (`wholeTabErrorOf`, `:588-600`; `#onCollectOrder`,
  `:7045-7060`; `#onFindBillPay`, `:7750-7762`)
- Modify: `apps/till/src/state/bill-payment.ts` (`:245-256`, which builds a `PayRefusal`) and
  `apps/till/src/widgets/pay-refusal.ts` (`PayRefusal`, `:17-27`; `refusalText`, `:36-68`)
- Test: `apps/till/src/till-app-handheld-pay.test.ts` (beside `:499-552`),
  `apps/till/src/widgets/presented-pay-dialog.test.ts` (beside `:557`), `apps/till/src/till-app.test.ts`
  (beside `:10540` and `:11376`)

**Interfaces:**
- `wholeTabErrorOf`, `#onCollectOrder` and `#onFindBillPay` check `saleRefusalOf` (Task 9a) first.
- `PayRefusal` gains `clockAt?: string`, copied in `bill-payment.ts` as `chargeable` is (`:252`).
  `refusalText` answers `t("sale.disk_full")` for `storage.disk_full` and
  `clockUnusableText(clockAt)` for `clock.unusable` with a `clockAt`; `sale.charged_not_recorded`
  already reaches `codeMessage` at its end.

- [ ] **Step 1: Write the failing tests.**
  - `till-app-handheld-pay.test.ts`: rows in the `it.each` at `:538-552` (the presented bill's cash
    send) for `storage.disk_full` and `clock.unusable` with `clockAt`, and a card case beside `:499`
    (`pay` rejecting each of the three codes): the sheet shows `t("sale.disk_full")`, the dated
    clock sentence, and `codeMessage("sale.charged_not_recorded")`.
  - `presented-pay-dialog.test.ts` beside `:557`: a reader payment refused with each of the three
    shows the same sentences through `refusalText`.
  - `till-app.test.ts`: collecting an order and paying a found bill refused `storage.disk_full`
    show `t("sale.disk_full")`, and refused `clock.unusable` with `clockAt` show the dated sentence.

- [ ] **Step 2: Run them and watch them fail** (`memory_pressure` first):
  `pnpm --filter @waitron/till exec vitest run src/till-app-handheld-pay.test.ts src/widgets/presented-pay-dialog.test.ts src/till-app.test.ts`
  — each new case FAILS with today's fallback (`sale.error`, `sale.refused` or the generic sentence).

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run them and watch them pass**, `Tests` counts shown.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/till/src
  git commit -s -m "The till's bill sheets, dialogs, collect and found-bill pay name a full disk, a charged card and a wrong clock"
  ```

### Task 9c: Every other till surface shows the refused-save sentence for a full disk

**Files:**
- Modify: `apps/till/src/till-app.ts` (`TABLE_REFUSALS`, `:523`; `ACTIONABLE_REFUSALS`, `:798`;
  `discardError`, `:877-883`; `#onAdvanceTicketItem`, `:7774-7792`)
- Test: `apps/till/src/till-app.test.ts`, `apps/till/src/till-app.clock.test.ts`, and the files
  that already cover parking, table and line writes, discarding and the kitchen advance (find each
  with `grep -ln "held.park_error\|table.error\|held.stale\|station.advance_error" apps/till/src/*.test.ts`)

**Interfaces:**
- `storage.disk_full` joins `TABLE_REFUSALS` (so `tableWriteError`, and `lineWriteError`'s fallback
  to it, `:790-793`, answer `{ code }`) and `ACTIONABLE_REFUSALS` (so every `counterError` caller
  does — placing and parking among them).
- `discardError` answers `{ code }` for `storage.disk_full` too.
- `#onAdvanceTicketItem`'s `catch` binds the error and sets `{ code: "storage.disk_full" }` for that
  code, `"station.advance_error"` otherwise.
- Clock-in needs no change: `state/clocking.ts` keeps any coded refusal (`:32-35`, `:209`) and
  `#clockMessage` shows it through `codeMessage` (`till-app.ts:4711-4712`; read). Its test pins it.

- [ ] **Step 1: Write the failing tests**, one per surface, each refused
  `{ code: "storage.disk_full", status: 507 }` and each showing `codeMessage("storage.disk_full")`
  instead of today's fallback, which the test names after reading the handler: placing an order
  (`place.error`), parking (`held.park_error` or the handler's fallback), a table write
  (`table.error`), a line write, discarding a held order (`held.stale`), advancing a kitchen ticket
  item (`station.advance_error`), and clocking in (`clock.write_error` is NOT shown). A control per
  file: the same surface refused `{ code: "server.internal", status: 500 }` still shows its
  fallback.

- [ ] **Step 2: Run them and watch them fail** (`memory_pressure` first):
  `pnpm --filter @waitron/till exec vitest run <the files>` — each new case FAILS with today's
  fallback, except clock-in, which may already pass once Task 9a's code-table entry is in: if it
  does, say so in the commit message (it is then a pin, not a fix).

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run them and watch them pass**; then `pnpm --filter @waitron/till test:coverage`
  and read `till-app.ts`'s, `codes.ts`'s, `t.ts`'s and `pay-refusal.ts`'s rows.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/till/src
  git commit -s -m "The till shows the refused-save sentence for a full disk when placing, parking, editing a table, discarding, advancing a ticket and clocking in"
  ```

### Task 10: The dashboard names both, and its two readers of `server.internal` are pinned

**Files:**
- Modify: `apps/dashboard/src/i18n/codes.ts` (`CODE_MESSAGES`, ending `:1267-1271`)
- Test: the payments screen's stuck-payments tests (find with
  `grep -ln "payments.stuck.failed" apps/dashboard/src/screens/*.test.ts`), and
  `apps/dashboard/src/widgets/content-translations-dialog.review.test.ts` (its refused-save cases)

**Interfaces:**
- `"storage.disk_full"`: en "Not saved: the box is out of disk space." / es "No se ha guardado: el
  equipo no tiene espacio en disco."; `"clock.unusable"`: en "Not recorded: the box's clock is
  wrong." / es "No se ha registrado: la hora del equipo es incorrecta." (decision 13).
- No change to `payments-screen.ts` or `content-translations-dialog.ts`.

- [ ] **Step 1: Write the failing tests:**
  - payments screen: a stuck payment whose check is refused `{ code: "storage.disk_full" }` shows
    `codeMessage("storage.disk_full")`, and a check refused `{ code: "server.internal" }` still shows
    `t("payments.stuck.failed")` (the control: the branch at `payments-screen.ts:71` stands).
  - translations dialog: a save refused `{ code: "storage.disk_full" }` shows the sentence at the
    bottom of the form (`actionError`) and does NOT open the uncertain-batch review
    (`t("translations.uncertain")` absent); a save refused `{ code: "server.internal" }` still opens
    it (the control).

- [ ] **Step 2: Run them and watch them fail** (`memory_pressure` first):
  `pnpm --filter @waitron/dashboard exec vitest run <the two files>` — the full-disk cases FAIL
  with the generic sentence; the controls pass.

- [ ] **Step 3: Implement** the two entries.

- [ ] **Step 4: Run them and watch them pass**, `Tests` counts shown; then
  `pnpm --filter @waitron/dashboard exec vitest run src/i18n/codes.test.ts`.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/dashboard/src
  git commit -s -m "The dashboard names a full disk and a wrong clock"
  ```

### Task 11: Docs and backlog

**Files:**
- Modify: `docs/developers/conventions-data.md` (after "What the store does now", `:2352`)
- Modify: `docs/backlog.md` (`:3896-3900`; the A798-B entry, `:5409-5428`), and the matching area
  files under `docs/backlog/` for any new entry's detail

- [ ] **Step 1: conventions-data.md.** A short section, "Card-reader payments after a full disk":
  the store's `onDiskFull` and what it reports (Task 3); the full-disk stop — set by a report or by
  a start under 16 MiB free, cleared by a reading of 16 MiB or more of the venue folder, checked
  before, inside and after a reader payment's first transaction; that it refuses only where a
  connected reader would be asked next (Tasks 5, 7), and that the owner's choice between that and a
  wider stop is open (decision 4); `sale.charged_not_recorded` after a charge (Task 7b); that the
  clock refusal is `clock.unusable`, thrown through `FiscalBackend.assertRecordableAt` at the issue
  reading (`issueMoment`) and before the reader. Name the guards and say where each is weaker than
  its name: the boot wiring test checks arguments, not a real full disk on a box; the windows'
  tests drive the stop by hand, not by two tills; a full-disk refusal with bytes still free (inodes
  exhausted) is noted and then cleared by the next card payment's reading, no worse than before
  this slice.
- [ ] **Step 2: backlog.md.**
  - DELETE the entry "With the box's clock before 28-10-2024, a connected card is charged before the
    sale is refused" (`:3896-3900`): this slice finishes it.
  - In A798-B, say slice 3 is finished and parked for the owner in #<this pull request>, that
    decision 4's question (narrow stop or the design's wider one) is open, and that slice 4 is next.
  - Add one short entry each, in the area of A798-B, for what this slice leaves open, each naming
    its owner slice:
    (a) **slice 6**: till surfaces that still show their own fallback for a full disk — the draft
    save's refusals (`apps/till/src/state/draft-sync.ts`) and the unpaid departure's handler — so
    "any refused save" is not yet one sentence everywhere; and, under decision 4's default, the red
    strip's wording ("No se puede guardar nada" would be false);
    (b) **slices 5 and 6**: a noted stop clears only when a card-reader payment reads free space,
    so the strip must read `full()`, or the free-space watch must clear it, or the red outlives the
    freed space;
    (c) **slice 8**: corrections, substitutions and voids under a clock before 28-10-2024 still
    answer `fiscal.record_invalid`, as does the setup readiness check;
    (d) **slice 9**: `CORE_ALERTS` (`packages/db/src/alerts.ts:7`) gives the `clock.` prefix to the
    area `fiscal`, while design §4.3 puts `clock.unusable` under "Equipo"; the slice that raises it
    as an alert must settle which wins.
- [ ] **Step 3: Check and commit.** `pnpm exec prettier --file-info docs/backlog.md` prints
  `"ignored": true` (docs/ is not format-checked). Then:

  ```bash
  git add docs/developers/conventions-data.md docs/backlog.md docs/backlog
  git commit -s -m "Docs: card-reader payments after a full disk, and what A798-B slice 3 leaves open"
  ```

### Task 12 (OPTIONAL — only if the owner chooses (a) or (c) in decision 4)

Not built otherwise. A sketch, so an answer needs no replanning; turn it into a full task, with its
own failing tests and controls, when the answer comes. Both options keep Tasks 1-11.

- **(c) Every sale refused while the stop holds.** One choke point already exists: every server
  path that records a sale takes its issue reading in `issueMoment` (M6, Task 2). Give `issueMoment`
  the stop too (`if (disk?.noted()) throw diskFullRefusal()` beside `assertRecordableAt`), and have
  each route that records a sale read `await disk.full()` before its transaction, so freed space
  clears the stop before the check: `/api/sales` and pay-working-order (`runPayWorkingOrder`,
  `till-sale.ts:642`), collecting a placed order (`runCollectOrder`, `:2058`), `/api/pay` (already),
  bill payments (`takeBillPayment`, `bill-payments.ts:1155`; `beginBillPayment`'s stop check without
  `state === "pending"`), and an unpaid departure (`unpaid-departure.ts:118`). To settle with it:
  whether the recovery of a card already charged (`kind: "recover"`) is refused too (recommend
  not: it charges nothing, and refusing it only delays recording a charge), and whether the
  pending-payment pass (`bill-payments-loop.ts:159`) skips its completions while stopped.
- **(a) Every write refused while the stop holds.** One choke point: a middleware in
  `mountTillApi` beside the existing `app.use("/api/*", madeHereAnswer(…))` (`till-api.ts:1248`),
  refusing every non-GET request while `await disk.full()`. `mountTillApi` mounts the clock-in API
  (`:1250`), attendance (`:1256`) and bill payments (`:1327`) on the same app, so they are covered.
  To settle with it: boot mounts other APIs on the same Hono app after `mountTillApi`
  (`boot.ts:1817` onwards, the dashboard's among them), which an `/api/*` middleware would also
  catch, so it must be limited to the till's routes; and which writes stay open — sign-in and
  sign-out (a session row is a write), and Pay again on a card already charged.

---

## Self-review against the spec

- §4.6 item 3 (both checks before the reader refuse while red and under a clock before
  28-10-2024): Tasks 5, 6, 7, with the settle kind added (decision 8), the in-queue windows closed
  (decision 17), and the scope of "red" stated (decision 4).
- §4.6 item 2 (one message for any write, and the sale's own): Tasks 9a-9c, 10; the sale's own
  sentence and the after-the-charge one built (decisions 10, 18, 19; Task 7b); the surfaces left
  are backlog (a), owned by slice 6.
- §4.5 item 1 (the named refusal with today's card advice kept): Tasks 1, 2, 6, 7, 9a, 9b, with the
  date in the sentence (decision 11); the strip, `clock.unusable` as an alert and the email are not
  this slice's (slices 6, 9 and 10).
- §4.6 item 5 (set by the first save that fails; trading back when someone frees space): Tasks 3,
  4, 8, with the clearing rule of decision 3 and the start reading of decision 2. What it refuses
  departs from the design's text and is an open owner question (decision 4; optional Task 12).
- §5 (the checks reach the clock rule through the fiscal seat): Task 1's `assertRecordableAt`,
  called from the server (Tasks 2, 6, 7).
- Build plan decision 10 (the dashboard's two `server.internal` readers): Task 10.
- §8 slice 3's risks — fiscal invariants (the settle handlers, and now every sale path's issue
  reading) and a refusal's parameters (`clock.unusable { clockAt }`,
  `sale.charged_not_recorded { workingOrderId, cause }`) — are Review focus 1 to 8.
