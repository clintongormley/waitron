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
> comes from reading code, not from running it. Task 12's `file:line`s were read at `45693342d`
> (this branch's base when Task 12 was written), from a `git archive` of that commit; its Hono
> measurements are M7.

**Words used in this plan.**
- A **connected card reader** is a card machine the box talks to (`provider.collect`). The other
  card path, "Otro datáfono", is a card typed on a machine the box does not talk to; staff charge it
  first and then record it.
- The **two checks before the reader** are the points in the two card-reader routes after which
  the reader is asked to charge: `payIntegrated` for `POST /api/pay`
  (`apps/server/src/till-sale.ts:1106`) and `beginBillPayment` for a card on a bill
  (`apps/server/src/bill-payments.ts:1037`).
- The **full-disk stop** is what design §4.6 item 5 calls the red state for the disk: once a write
  has been refused because the disk is full, the box refuses every write the till app and the
  kitchen screens send — sales, payments, orders, kitchen sends, clock-ins — until it reads enough
  free space again (decision 4: the owner chose this, 2026-10-21). A few writes stay open; decision
  4 lists them.
- The **minimum date** is 28-10-2024, the first invoice date AEAT accepts. The fiscal library
  `@waitron/verifactu` refuses an earlier one (`validate.js:610-611` in its 0.2.1 build).
- The **issue reading** is the one clock reading every server path that records a sale takes in
  `issueMoment` (`apps/server/src/issue-moment.ts:17-27`) and hands to `recordSale`, so the sale
  row and its record carry that one instant and offset (M6).

**Goal:** no connected card is charged for a sale the box will not record — neither after a write
has failed because the disk is full, nor under a clock before 28-10-2024; once a write has failed
because the disk is full, no till or kitchen screen saves anything until someone frees space; and
the till says which of the two stopped it, and whether a card was charged, in words staff can act
on.

**Architecture:** six pieces.
1. The Veri\*Factu module learns to judge a clock reading against the minimum date
   (`refuseBeforeFirstIssueDate`, new `packages/fiscal-verifactu/src/first-issue-date.ts`) and
   offers that judgement through the fiscal seat: `FiscalBackend` gains `assertRecordableAt(reading)`
   (`packages/fiscal/src/backend.ts:171`), which `VerifactuBackend` implements by delegating to it.
   It throws a new code, `clock.unusable`, carrying the reading (`clockAt`, `offsetMinutes`). No record builder
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
   disk answers its own code, `sale.charged_not_recorded`, on every path that runs after a charge.
5. The till gives each refusal its sentence: a refused save, a sale refused before any money, a
   card charged but not recorded, and a wrong clock with its date. The dashboard gives
   `storage.disk_full` and `clock.unusable` one each.
6. While the stop holds, one gate per mount refuses every write route the till app and the
   kitchen screens use (`apps/server/src/disk-full-gate.ts`, on `mountTillApi`, `mountDeviceApi`
   and `mountScheduleApi`), registered route by route so no dashboard route is touched; the four
   sale routes refuse a new sale from inside, after answering a resend of one already recorded
   (Task 12).

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
requests (read: `gh pr list --state open`), #1944 touches three source files this slice changes:
`apps/server/src/till-api.ts` (its hunks start at `:45`-`:171`, `:1152`, `:2236`, `:2248` and
`:3199`, none in the status table at `:413-446` or at `:1248`/`:1327`),
`apps/server/src/working-order.ts` (its hunks above `:6683` remove more lines than they add, so
`priceForIssuance` moves up if it lands first; its body is not in a hunk), and `apps/till/src/i18n/strings.ts`;
it also edits `apps/server/src/department-transfer-api.test.ts`, whose `priceForIssuance` calls
Task 2 gains an argument (read: `gh pr view 1944 --json files`).
If #1944 lands first, find each site by name. #1939 touches `packages/fiscal-none/src/index.ts` and
`packages/fiscal-verifactu/src/index.ts`, which this slice does not edit. #1944 has since landed
on `main` as `509e8d42a`: besides the above, it removes `POST /api/device/pass-screen/done` and the
kitchen display's Fire and Away levers (only Ready remains in `device-levers.ts`), which Task 12b's
gate would have covered; the gate is built from the routes a mount registers, so it covers what
remains.

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

## Review round 2 (claim check)

Findings in `~/waitron-campaign-b/a798-3-plan-review/round2-check.md`, with the lane runner's
rulings. Every citation added in this round was re-read at this branch's code (`8f17dac0b`); the
two TypeScript probes the check gives were re-run (`tsc` 7.0.2), each with a compiling control.

- **I1** (`sale.charged_not_recorded` covered one after-the-charge path): decision 18, Task 7b and
  Review focus 7 now wrap all four of `/api/pay`'s — `finalizeSettle` (`till-sale.ts:1357`),
  `finalizeCapture` (`:1368`), `finalizeRecovery` (`:1305`), `finalizeSettleRecovery` (`:1308`) —
  plus the bill's captured P3. Task 7b adds a settle case and a recover case. The settle case
  cannot use the check's `recordSale` spy: `finalizeSettle` calls `settleSale` from
  `@waitron/core` directly (`till-sale.ts:49`), which takes no backend
  (`packages/core/src/settle-sale.ts:41`), so the task mocks `@waitron/core`'s `settleSale`.
- **I2** ("Otro datáfono" got the sentence that implies nothing was charged): decision 10 and
  Tasks 9a, 9b add `sale.disk_full_manual_card`, the sale-only sentence followed by today's card
  advice word for word (`apps/till/src/i18n/strings.ts:1350`, `:3041`), shown when the tender was
  a manual card; one test per surface. Not put to the owner (runner's ruling).
- **I3** (Task 8 picked the store by call index): the store is now the recorded one whose `venue`
  is `mountTillApi`'s recorded `db` (`boot.ts:1656`); the "second a start makes" sentence is gone,
  and the step names the two short-lived opens before it (`boot.ts:903`, `:926` →
  `append-only-watch.ts:31`).
- **N1** (Task 8's push did not compile): the unsubscribe is pushed as
  `async () => stopWatchingDisk()` (`boot.ts:816`; probe `round2-check/tsc-undo`, TS2345, exit 1).
- **N2** (Task 7's parameter after an optional one): `refusals` goes before `attendance?`
  (`bill-payments.ts:1046`; probe `round2-check/tsc-param`, TS1016, exit 1).
- **N3** (`priceForIssuance`'s test callers): Task 2 lists `department-transfer-api.test.ts` and
  `unpaid-invoice-delivery.test.ts` and runs both; the lane note names #1944's edit of the first.
- **N4**: `served-at-huella.test.ts` dropped from Task 1's Files list and `git add`.
- **N5** (`cause`): renamed `reason`, as the registry's siblings (`apps/server/src/errors.ts:60`,
  `:260`, `:575`, `:622`, `:1248`). The till shows the disk sentence (`sale.charged_disk_full`)
  only for `reason: "disk_full"`; the code table's entry is the cause-neutral sentence, with a test
  for another value.
- **N6** (the date in the till's zone): `clock.unusable` carries `offsetMinutes` too, and the till
  formats the instant shifted by it, in UTC (decision 11, with the `node -e` measurement and its
  control); Tasks 1, 2, 6, 7 expect the new param and Task 9a tests a pair of offsets.
- **N7**: decision 6's precedence list now reads "everything checked after the issue reading, for
  example …", adding `record-sale.ts:203-269`'s checks.
- **N8**: Task 12(c) no longer refuses in `issueMoment`; it refuses at the routes before any money
  moves, and every path after a charge goes on.
- **N9**: Task 7 says its three clock cases are part payments.
- **N10**: Task 5 says `appWith` and the `disk?` members are written in Step 1, as setup.
- **N11**: Task 1's `VerifactuBackend` case uses `expect(() => …).toThrow(…)`.
- **N12**: decision 2 names slice 2's start reading and why it is not passed down; decision 18 and
  Task 7b log `sale.charged_not_recorded` at `error` where it is thrown.

---

## Review round 3 (owner answer (a), Task 12)

The owner answered decision 4 on 2026-10-21 with (a), the design's own words: once one save has
failed on a full disk, every sale (cash, connected card and other card machine), order, kitchen
send and clock-in is refused "until someone frees space — even saves that would still fit"; the
slice still parks for the owner (decision 4 quotes the answer whole). Tasks 12a-12c, decisions
21-29 and the edits to the rest of the plan were drafted in `~/waitron-campaign-b/a798-3-task12/`
(`task-12.md`, `plan-edits.md`), from code read at `45693342d` and the Hono probes of M7. A
fresh-context check (`check.md` there: 0 Critical, 2 Important, 12 Minor) re-ran the probes, ran
the gate's design against the real till, device and schedule routes after #1944, and built the
clock-in case. Rounds 1 and 2 above are kept as written; where they call the narrow stop the
default or the owner question open, this round replaces them. Each finding, and how it was folded:

- **I1** (the sale's sentence departs from the owner's words without saying so): decision 24 says
  so, quotes both sentences and says what changes if the owner meant one sentence everywhere. The
  default stays the sale's own sentence on money surfaces (design §3, §4.6 item 2), by the lane
  runner's ruling.
- **I2** ("once space is freed, the same resend is answered as recorded" is false): removed from
  decisions 20 and 26. Decision 26 says a coded answer ends the till's resends and a later press is
  a new submission (`draft-sync.ts`'s `resendUnanswered`, `till-app.ts`'s `#submitDraft`; read),
  and names as a known, unchecked limit whether that press is refused as done or saves the round
  twice.
- **M1** (the seven POSTs may record a sighting): "save nothing of their own" in Task 12's open
  list, decisions 4 and 22, Review focus 2 and Task 12a.
- **M2** (a draft round's refusal path): added to Task 12's "What the till shows" and decision 12.
- **M3** (Architecture item 6 before item 5): item 6 now follows item 5.
- **M4** (clashing decision numbers): Task 12's decisions are numbered 21-29, after the plan's 1-20,
  so the plan keeps one list; its "recovery and replays stay open" was decision 20 in other words
  and is merged into it.
- **M5** (no proof by deletion in 12b; no schedule sweep): 12b Step 4b, and the schedule case is a
  sweep with an empty open list.
- **M6** (a whole-package coverage run for one row): 12b Step 4 runs the three files with coverage
  of `disk-full-gate.ts` alone; CI runs the package's coverage.
- **M7** (two cases' expected failures): 12a's freed-space case runs under 16 MiB first; 12a's and
  12c's Step 2 say where each freed-space case fails.
- **M8** (a write already past the gate): decision 29.
- **M9** (effects of the gate not listed): "Behaviour this slice removes" names them; Task 12's
  sign-in entry says sign-in still records working-time evidence.
- **M10** (Task 11's reader-only title): its section title and commit message.
- **M11** (12c stopped over a fixture): the settle case moves to `counter-handover.test.ts` instead.
- **M12** (`TillApiDeps.disk`'s doc named two readers): 12a's doc names every reader.

Task 4 was built with one change from its plan text, after its review: `full()` clears only if no
refusal was noted while its reading was in flight. Task 4's Interfaces and decision 3 say so.

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
- **M7 — how Hono 4.13.13 orders a gate** (for Task 12; `node` v26.11.1 running
  `~/waitron-campaign-b/a798-3-task12/probe/hono-order.mjs` and `hono-prefix.mjs` against
  `node_modules/.pnpm/hono@4.13.13/node_modules/hono/dist/index.js`, the version `apps/server`
  resolves). Each probe's gate answers 507 when a header says the disk is full; the failing case
  for "the gate reaches only the routes it is meant to" is a 507 on a route registered elsewhere.
  - P1, `app.use("/api/*", gate)` registered between two routes: the later route →
    `507 ran=[gate]`; the earlier → `200 ran=[before-handler]`; control (not full) → `200
    ran=[gate,after-handler]`. A `use` reaches every matching route registered after it.
  - P2, a sub-app's `use("*", gate)` mounted with `app.route("/", sub)`: routes the parent
    registers afterwards, `POST /api/backup/apply` and `POST /management-api/staff`, both →
    `507 ran=[sub-gate]`; the parent's route list showed `ALL /*` first.
  - P3, the gate registered on the parent with `app.on(method, path, gate)` for each write route
    of the sub-app, then `app.route("/", sub)`: `POST /api/w/1/place → 507 ran=[root-mw,gate]`,
    control `200 ran=[root-mw,gate,madehere,till-place]`; `GET /api/w/1 → 200` without the gate;
    the open `POST /api/session → 200`; the parent's later `POST /api/backup/apply` and
    `POST /api/device/battery → 200` without the gate. `hono-prefix.mjs`: a gated
    `PUT /api/w/:id` did not catch `PUT /api/w/1/label` (`200 ran=[put-label]`).

**Not measured:**
- No probe ran on Linux or on a box. The stop's clearing reads `statfs`; slice 2's F1 measured
  `freeBytes` reading 0 on HFS+, Linux tmpfs and Linux ext4 when full, and about 1.2 MB on APFS.
- A real full disk through the card routes was not run; M2 and M3 used the page-limit stand-in,
  whose free-space reading is the real disk's (plenty), which is why the tests below set free space
  through an injected `statfs` (reasoned, not run).
- The two windows of decision 17 and the start reading of decision 2 were not probed; they are built
  test-first in Tasks 4, 5, 7 and 8.
- Task 12's gate was probed on a bare Hono (M7), not on a box; Tasks 12a-12c test it on the real
  till, device and schedule routes.

---

## Decisions this plan makes that the spec does not

The owner confirms or overrides these when reviewing the plan. Each has the DEFAULT to build.

1. **What sets the full-disk stop: every write the engine refuses because the disk is full.** The
   design says "the first save that fails" (§4.6 item 5). DEFAULT: "a save that fails" means any
   statement, `begin` or `commit` on either of the venue folder's two database files that the
   engine refuses with result code 13, which slice 1 turns into `storage.disk_full`
   (`packages/store/src/disk-full.ts:4-12`) — from a till request, a dashboard request or a
   background duty alike, including one the code catches and survives (slice 1's E13 shapes). The
   store reports it (Task 3); the server's own refusals — before the reader, at the gate and in the
   sale routes (`AppError`s it throws or answers, not engine refusals) — do not report it again.
   Alternative not built: setting it in the till
   routes' error boundary, which would miss the other 76 `createErrorBoundary` call sites and every
   background duty (`grep -rn "createErrorBoundary(" apps packages | grep -v test | wc -l`: 77).
2. **Where it lives: in the server's memory, one per venue folder, made at start — and a start on a
   folder under 16 MiB free begins with it set.** DEFAULT: `createDiskFullState` in `boot.ts`,
   listening to `store.venue` and `store.node`. Right after, boot reads `freeBytes(venueDir)` once
   (`apps/server/src/free-bytes.ts:6-15`, the reading decision 3 clears on) and, below
   `FULL_DISK_BYTES`, notes a refusal (`noteFullAtStart`, Task 4), so a box restarted on a disk that
   is still full refuses its first till write, and charges no card (M2's pattern). A
   reading of exactly `FULL_DISK_BYTES` starts clear, as it clears a noted stop. An **unreadable**
   reading (`null`) at start leaves the stop clear and logs `storage.start_space_unread`: decision 3
   keeps a noted stop on `null` because an engine refusal has already proved the disk full, but at
   start nothing has, and on a filesystem that never reports free space a stop set at start could
   never clear, refusing every till write for good. The free-space watch and its alerts
   stay slice 5's (design §4.6 item 4). Slice 2's start already reads free space
   (`freeSpaceAtStart`, `apps/server/src/start-space.ts:56-119`, called at
   `apps/server/src/node-entry.ts:300`), but over the state and venue folders together, before
   migrations and before its own cleanup, and it does not pass the reading on; passing it down
   would thread a parameter through to boot for an older reading of two folders, so this reading
   is taken separately, after the long-lived open, on the venue folder that holds both database
   files.
3. **What clears it: a free-space reading of the venue folder of at least `FULL_DISK_BYTES`
   (16 MiB).** The design says "Trading comes back only when someone frees space" without saying
   how the box knows. A later successful write cannot be the sign: M2 shows small writes succeed
   after a big one failed. DEFAULT: while a refusal is noted, every till or kitchen-screen write
   the gate sees (Task 12a, 12b), each sale route (Task 12c) and each card-reader payment (Tasks 5,
   7) reads `freeBytes(venueDir)` before its first transaction; at 16 MiB or more the stop is
   forgotten and the write goes on. 16 MiB is slice 2's line between "full" and "not full"
   (`boot-failure.ts:47`): every full-disk failure it measured had at most 48 KiB free on HFS+,
   tmpfs and ext4, and about 1.2 MB reported free on APFS. A reading of `null` (the filesystem
   cannot say) keeps the stop. When nothing is noted, nothing is read. A reading clears the stop
   only if no refusal was noted while it was in flight; one noted then keeps the stop, and that
   request is refused too. Two reads that both find space log the clearing once. Deferred: the
   strip (slice 6), the Box status row and Liberar
   (slice 7), the minute-by-minute watch and its alerts (slice 5); until one of them reads free
   space, a noted stop clears only when a till or kitchen screen tries a write, so a box nobody
   writes to keeps it (backlog, Task 11).
4. **What the stop refuses: every write the till app and the kitchen screens send, until someone
   frees space — the owner's answer, (a).** Design §4.6 item 5: "the first save that fails turns
   every device red, every sale, order, kitchen send and clock-in is refused with the honest
   message of item 2 … Trading comes back only when someone frees space"; §3's table: a full disk
   "stops every other write too". The owner, 2026-10-21: "The owner chose (a), the design's own
   words (§4.6 item 5): once one save has failed on a full disk, every sale (cash, connected card
   and other card machine), order, kitchen send and clock-in is refused with "No se ha guardado: el
   equipo no tiene espacio en disco. Avisa al encargado." until someone frees space — even saves
   that would still fit. Add the task you described to feat/a798-3-refuse-before-reader before it
   is ready; the red strip keeps its planned words ("No se puede guardar nada"). The slice still
   parks for the owner to land."
   Worked example: at 21:40 a 20-line card sale fails on a full disk, nothing charged (M2). At
   21:41 Marta's one-caña cash sale, which would fit (M2), is refused "Venta no registrada: …"; at
   21:42 Ana's clock-in and at 21:43 table 4's mains are refused "No se ha guardado: …"; at 21:44 a
   card is refused before the reader. Once someone frees space, the next till write reads 16 MiB
   free and goes through. Which sentence each refusal shows, and where that departs from the
   owner's words, is decision 24.
   How it is built: Tasks 5 and 7 refuse a reader payment (decision 17). Task 12a puts a gate in
   front of every write route `mountTillApi` registers, 12b in front of `mountDeviceApi`'s and
   `mountScheduleApi`'s, each registered route by route so no dashboard route, nor any route
   mounted later, is touched (M7). 12c refuses a new sale inside the four sale routes, after their
   replay checks. **Open while the stop holds**, each still refused by itself if its own save does
   not fit: sign-in, sign-out and the session's language; the four sale routes at the gate (refused
   inside); seven POSTs that save nothing of their own (three dead-end questions, four previews),
   because a refused send-preview makes the till show its generic `table.error` and never send the
   round (read: `apps/till/src/state/party-allergy-flow.ts:19-34`, `apps/till/src/till-app.ts:3684`);
   and the device's own housekeeping (joining, zones, equipment, profile, battery). A resend of a
   sale or payment already recorded, and Pay again on a card already charged, are answered
   (decision 20). **Untouched:** every dashboard route, the provider webhook, node enrolment, and
   the background duties (filing, the pending-payment pass, printing, the release pass), whose
   writes fail by themselves and note the stop (decision 1). Decisions 21-29 settle what the
   owner's words leave open.
5. **The clock refusal is a new code, `clock.unusable { clockAt, offsetMinutes }`, declared by the Veri\*Factu
   module and offered through the fiscal seat.** Design §8 calls it "`fiscal.record_invalid` caused
   by the minimum date". Keeping that code would make the till recognise the library's own
   validation code, `FECHA_EXPEDICION_BEFORE_MINIMUM` — a Spanish identifier in general code
   (CLAUDE.md §3, English only) and a regime detail on the generic side of the seat (§5). DEFAULT:
   `clock.unusable`, beside its siblings `clock.degraded` and `clock.jump_detected` (M5), the name
   design §4.3 already gives the alert for the same cause, following the design's "one code for the
   refusal and the alert" (§4.8 a). `clockAt` is the reading's instant as ISO 8601 and
   `offsetMinutes` the reading's own offset (the till needs it to print the date the record would
   carry, decision 11): a time, not operator data, so both may go into the log the recovery page
   shows (the reason `fiscal.record_invalid`'s params carry no values,
   `packages/fiscal-verifactu/src/errors.ts:80-89`).
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
     another reason checked after the issue reading now answers `clock.unusable` instead: that
     is everything checked after the issue reading. In `fileImmediateSale`, for example, a tender
     shortfall (`settlementFor`, `till-sale.ts:941`), `selectOrderInvoice`'s refusals (`:947`),
     core `recordSale`'s own checks (counterparty, breakdown, simplified-invoice limit;
     `record-sale.ts:171-198`), its integrity check, the `sale.series_*` refusals,
     `fiscal.taxpayer_domicile_missing` and `requireRecipientAddress` (`record-sale.ts:203-269`),
     and the backend's `sif.not_registered` or foreign-recipient refusal; at the check before the reader
     (`till-sale.ts:1237-1238`) and in `beginBillPayment` (`bill-payments.ts:1078`), whatever those
     functions check after it. Under any other clock nothing changes. (read)
7. **The clock check applies to every bill payment; the stop, in Task 7, to a reader payment on a
   bill, and from Task 12c to every new bill payment (decision 4).**
   `beginBillPayment` is shared by cash, "Otro datáfono" and reader payments
   (`bill-payments.ts:1164`, `:1342`). Under a clock before the minimum date no bill can be
   completed (M1), and a part payment taken now is dated by the wrong clock. DEFAULT: every bill
   payment is refused `clock.unusable` before anything is written; Task 7 applies the stop's
   refusal when `state === "pending"` (the reader), and Task 12c drops that condition, so cash and
   "Otro datáfono" are refused too, still after the replay lookup.
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
      stop's refusal before the reader, the stop's refusal of a cash or "Otro datáfono" sale (Task
      12c), a sale whose first transaction failed (M2: `collect 0`), and a cash or "Otro
      datáfono" sale that did not fit. This is the sale's own sentence that design §4.6 item 2
      gives beside the general one; every other refused write shows the owner's sentence (the
      first bullet). Decision 24 says where this departs from the owner's words. **On an "Otro
      datáfono" tender** (a card staff have already charged on a terminal the box does not talk to:
      the counter's
      `tender.method === "card"`, `apps/till/src/widgets/tender-pay.ts:53-56`, a collect or
      found-bill card tender, a bill's manual-card contribution) the sentence is followed by
      today's card advice, word for word from `sale.refused` (`apps/till/src/i18n/strings.ts:1347-1350`,
      Spanish `:3040-3041`): "Si ya has cobrado con tarjeta en el datáfono, devuelve el importe
      ahí." / "If you already charged a card on the terminal, refund it there." Design §3's table
      words only the generic case; "No cobres hasta que se resuelva" alone would tell staff nothing
      about the card already taken, which is the case `sale.refused`'s comment
      (`strings.ts:1347-1348`) exists for.
    - **A card charged, the sale not recorded** (design §3): "Cobrado con tarjeta, pero la venta no
      se ha registrado: el equipo no tiene espacio. No vuelvas a cobrar; avisa al encargado." /
      "Card charged, but the sale is not recorded: the box is out of space. Do not charge again;
      tell a manager." — for `sale.charged_not_recorded` with `reason: "disk_full"` (decision 18).
      The code table's entry for `sale.charged_not_recorded` holds the same sentence without the
      cause, "Cobrado con tarjeta, pero la venta no se ha registrado. No vuelvas a cobrar; avisa al
      encargado." / "Card charged, but the sale is not recorded. Do not charge again; tell a
      manager.", shown for any other or missing `reason` (slice 8 adds a second).
11. **The clock sentence carries the reading's date.** Design §3 and picture 6: "Venta no
    registrada: la hora del equipo es incorrecta (marca 01/01/2001). Avisa al encargado. Si ya has
    cobrado con tarjeta en el datáfono, devuelve el importe ahí." DEFAULT: that sentence with
    `{date}` filled from the refusal's `clockAt`, formatted in the reading's own offset — the rule
    the library judges the date by (M4) — not the till's time zone: shift the instant by the
    refusal's `offsetMinutes` and format the result in UTC,
    `new Intl.DateTimeFormat(currentLocale(), { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(Date.parse(clockAt) + offsetMinutes * 60_000))`
    (M6 printed `01/01/2001` in `es-ES` and `en-GB`). Measured 2026-10-21 on Node v26.11.1 with
    `node -e`: `2024-10-27T23:30:00.000Z` at offset 0 → `27/10/2024`, at +60 → `28/10/2024`
    (the two dates M4's library gives), `2001-01-01T11:00:00.000Z` at +60 → `01/01/2001`; the
    control, the same 23:30 instant formatted in the zone `Europe/Madrid` with no shift, printed
    `28/10/2024` — the date AEAT would accept, which a till in that zone would have shown for a
    refusal made at offset 0. A `clock.unusable` carrying `clockAt` but no numeric
    `offsetMinutes` is treated as one without `clockAt`. English, the
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
    - Under the stop (decision 4) every gated write answers `507 storage.disk_full`, so the
      surfaces above show their sentence whenever the stop holds, not only when a save does not
      fit; Task 12 adds no till code. A kitchen send from a table reaches `lineWriteError` through
      `#onReleaseRefusal` (at `45693342d`: `till-app.ts:11399-11406`, from `#onGroupCommand`,
      `:11435`, and the lines send, `:11933`; read), or, for a round sent from a draft, through
      `#submitDraft`'s `draftRefusalError` → `tableWriteError` and `lineWriteError` (`till-app.ts`
      `#submitDraft`; read). Left, in backlog (a): the kitchen display's station screen shows
      nothing for any refused bump (`apps/till/src/screens/till-station-screen.ts:578-586`; read),
      and any till write surface not named here that shows its own fallback.
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
    `507` (`error-boundary.ts:34-39`), the server's own refusal before the reader included; the
    gate answers the same body and status itself, as the read-only gate does
    (`apps/server/src/read-only-gate.ts:34-37`), because a middleware is outside a route's
    boundary.
15. **No guide changes.** No guide page covers taking a payment (M5). A screen's behaviour changes
    only in which sentence a refusal shows.
16. **Parked for the owner (the build plan's decision 17, and the owner's words of 2026-10-21:
    "The slice still parks for the owner to land").** The owner's rule parks a pull request that
    changes invoices, the Veri\*Factu record chain or its hashes, invoice series or numbering, or
    AEAT filing.
    - It changes no invoice's content, no record, hash or chain link, no series or number, and
      nothing about filing; `chain.ts`, every record builder, the golden fingerprint test and the
      immutability test are untouched.
    - It refuses sales that would otherwise be issued: under a clock before the minimum date (every
      one of them was already refused, after the card was charged, M1), and every new sale while
      the full-disk stop holds, cash included (decision 4; M2 shows such sales fit and were
      recorded before this slice). It puts a refusal on every server path that records a sale
      (`issueMoment`), touches the settle handlers, and moves part payments on a bill under a
      wrong clock from accepted to refused (M1).
    DEFAULT: park, finished to green, as the owner said.
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
    `sale.charged_not_recorded { workingOrderId: string; reason: "disk_full" }`, answered `507`.
    The parameter is `reason`, as the registry's other enumerated "why" parameters are
    (`apps/server/src/errors.ts:60`, `:260`, `:575`, `:622`, `:1248`) and as the boundary's
    comment expects (`packages/server-kit/src/error-boundary.ts:43`); not `cause`, which is the
    field `diskFullIn` walks (`packages/shared/src/engine-failure.ts:26`, `:46`).
    How each path sets its answer: the stop's refusal before the reader, and a first transaction
    that fails for a full disk, answer `storage.disk_full` (nothing charged); a cash or "Otro
    datáfono" sale that fails answers `storage.disk_full` (no reader). Every path of
    `POST /api/pay` that runs after a card has been charged catches an error for which `diskFullIn`
    (`packages/shared/src/engine-failure.ts:40-51`) is true and throws the new code instead — all
    four: `finalizeSettle` (`till-sale.ts:1357`, kind `settle`), `finalizeCapture` (`:1368`, which
    rethrows every non-unique failure unchanged, `:1648-1652`), `finalizeRecovery` (`:1305`, kind
    `recover`) and `finalizeSettleRecovery` (`:1308`, kind `recover-settle`); the two recovery
    kinds exist only when a captured payment is on file (`till-sale.ts:1160-1173`). So does the
    bill reader payment's P3 (`bill-payments.ts:1387-1414`, the captured branch). The new error
    does not carry the disk-full error as a cause, because the boundary checks `diskFullIn` before
    anything else and would answer `storage.disk_full` (`error-boundary.ts:34-39`); the store's
    listener has already noted the stop (Task 3). The site that throws it logs
    `("error", "sale.charged_not_recorded", { workingOrderId })`, because the boundary logs an
    `AppError` at `warn` (`error-boundary.ts:45`) where it logged the full disk at `error`
    (`:35`). `reason` has one value today; slice 8's "Cobrado con tarjeta, pero … la hora del
    equipo es anterior a la última venta" (design §4.8 a) can add a second, and the till shows the
    disk sentence only for `reason: "disk_full"` (Task 9a). After the answer, the
    card is filed without a second charge: on `/api/pay`, Pay again takes the recovery path (M3);
    on a bill, the payment stays pending and the pending-payment pass completes it from the
    provider's row once it can (`bill-payments-loop.ts:153-158`; read). **A cross-package
    contract change** (server ↔ till): Review focus 7.
    **As built (2026-10-21):** the answer is opt-in. Only the till's two card routes set
    `sayCardChargedOnFullDisk` (`POST /api/pay` in `till-api.ts`, the bill payment route in
    `bill-payments-api.ts`), read by `afterCardCharged` (`bill-payments.ts`); every other caller of
    the same paths, the dashboard's stuck-payment resolve route among them, still answers
    `storage.disk_full` (`payments-api.stuck.test.ts`).
19. **The sale-only disk sentence's English.** Design §3 and picture 1 give only the Spanish.
    DEFAULT: "Sale not recorded: the box is out of disk space. Don't take payment until it is
    fixed; tell a manager." The Spanish is the design's, word for word.
20. **While the stop holds, a sale already recorded is answered and a card already charged is
    filed.** The owner's words refuse "every sale"; neither of these is a new one. DEFAULT: Pay
    again on a card already charged (`kind: "recover"`/`"recover-settle"`,
    `till-sale.ts:1164-1174`) files the sale without asking the reader (M3: `collect 0`), and a
    resend of a sale or payment already recorded (`till-sale.ts:663-665`, `:1129-1134`,
    `:2076-2078`; `bill-payments.ts:1054-1064`) is answered with what was recorded. Refusing the
    first would leave a charged card unrecorded until someone frees space; refusing the second
    would tell staff "Venta no registrada" about money already in the drawer or on a card. A
    recovery that does not fit answers `sale.charged_not_recorded` (Task 7b). A bill's captured
    card is completed by the pending-payment pass, which no gate touches. A resend of any other
    write (a round, a bump) during the stop is refused like a new one (decision 26 says what the
    till does next). The pull request names this decision.

Decisions 21-29 are Task 12's: what the owner's answer (a) does not settle.

21. **Where the stop is enforced: one gate per mount, registered per write route.** DEFAULT: Task
    12a's gate, on the three mounts the till app and the kitchen screens write through
    (`mountTillApi`, `mountDeviceApi`, `mountScheduleApi`). Why: an `app.use` would refuse the
    dashboard's `/api/backup/*` and `/api/box/*` (M7, P1), and a sub-app middleware leaks to every
    later route (M7, P2). A hand list of paths was rejected because a new till route would be open
    until someone added it; with this gate a new till write is refused by construction, and only
    an open route needs naming (the sweep test pins the open list).
22. **Seven POSTs that save nothing of their own stay open.** DEFAULT: the three dead-end questions
    and four previews. Why: a refused send-preview turns into the till's generic `table.error` and
    the round is never sent (read: `party-allergy-flow.ts:19-34`, `till-app.ts:3684`), hiding the
    owner's sentence. That they save nothing of their own was read, not run; if one does, its
    write goes through as a GET's does (the read-only gate's documented limit,
    `read-only-gate.ts:8-10`).
    **As built (2026-10-21):** eight POSTs. `POST /api/demo-reader/cancel` is open too: it saves
    nothing, is registered only with the practice card simulator, and refused would leave a practice
    payment waiting at the reader (`TILL_OPEN_WHILE_DISK_FULL`, `till-api.ts`; its case is in
    `till-api.fiscal-sale-paths.test.ts`).
23. **The device's own housekeeping and the staff schedule.** DEFAULT: joining, zones, equipment,
    profile and battery stay open (not a sale, order, kitchen send or clock-in; refusing them would
    unsettle the device itself); the schedule's swap and absence requests are refused, so the
    strip's "No se puede guardar nada" holds for everything a till sends except the open list.
24. **The money surfaces keep the sale's own sentence — this departs from the owner's words.** The
    owner's answer quotes one sentence for every refusal, sales included: "No se ha guardado: el
    equipo no tiene espacio en disco. Avisa al encargado." DEFAULT: on a sale or payment surface
    the till shows the design's sale sentence instead, "Venta no registrada: el equipo no tiene
    espacio en disco. No cobres hasta que se resuelva; avisa al encargado." (followed by the card
    advice after an "Otro datáfono" tender), and the owner's sentence everywhere else. Why: §4.6
    item 5 refuses "with the honest message of item 2", item 2 is "One message for any write, and
    the sale's own (§3)", and design picture 1 shows the sale's own on the pay card; "No cobres"
    tells staff not to take the money, which the general sentence does not. If the owner meant the
    one sentence everywhere, Tasks 9a and 9b show the code table's entry for `storage.disk_full`
    instead of `sale.disk_full`, and nothing on the server changes. The pull request names this
    decision.
25. **The station screen's silence.** DEFAULT: not fixed here. The station screen shows nothing for
    any refused bump today (read: `till-station-screen.ts:578-586`); under the stop its tickets
    simply do not move. Added to backlog (a) for slice 6, beside the surfaces that show their own
    fallback.
26. **A resend of any other write is refused like a new one.** The till resends a write that got no
    answer up to twice under the same submission id (`apps/till/src/state/draft-sync.ts:208-237`;
    read); if the stop is noted between the first send and a resend, the resend of a round or bump
    the box already saved is answered `storage.disk_full`, and the till says it was not saved. A
    coded answer ends the resends (`resendUnanswered` rethrows anything but a network failure,
    `apps/till/src/state/draft-sync.ts`; read), so the till does not send that submission again by
    itself; a later press sends a new submission (`#submitDraft` and the group sends draw a new
    `submissionId` each time; read). **Known limit, not checked:** whether the route then refuses
    that press as already done or saves the round a second time, sending the kitchen a duplicate.
    DEFAULT: accepted — only the four sale routes answer resends during the stop, because there a
    false "not recorded" is about money; the window is one unanswered request long.
27. **The reader routes are not behind the gate; decision 17's checks stay theirs.** `POST /api/pay`
    and the bill payment route are open at the gate, because the gate cannot tell Pay again or a
    resend from a new payment (that is decided inside the first transaction). So the gate is not the
    first check there: decision 17's read before the first transaction, its check inside it and its
    check just before the reader remain the only three, 12c moves the two inside-P1 points of
    `/api/pay` earlier so a sale owing nothing is refused too, and widens the bill's inside check to
    every new payment. The read before the first transaction is what clears the stop on those
    routes, as the gate's read does everywhere else.
28. **The gate answers before authentication.** DEFAULT: accepted, as the read-only gate does
    (`read-only-gate.ts:33-37`): an unauthenticated write to a gated route gets 507 rather than 401
    while the stop holds, and each such request reads free space once.
29. **A write already past the gate when the stop is noted still saves if it fits.** The gate reads
    the stop once, before the handler; only the sale routes and the reader payments check again
    inside their transaction. So a round, bump or clock-in that passed the gate just before another
    till's save failed, and waits in the write queue behind it, still saves if it fits (reasoned
    from Task 12a's interface; not run). DEFAULT: accepted — the window is one queued write long
    and no money moves in it.

**Questions for the owner:** none open. Decision 4 was answered (a) on 2026-10-21, and the same
answer keeps decision 16's parking. Decision 24 departs from the owner's words, and the pull request
names it so the owner can overrule it.

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
  (M1); it now answers `clock.unusable { clockAt, offsetMinutes }` at the issue reading, before the invoice number
  is allocated — on the cash and counter routes, a card's P3 and recovery, a bill's completion and
  an unpaid departure — and, under such a clock, a sale that fails for another reason checked after
  that point answers `clock.unusable` too (decision 6).
- After a write failed because the disk was full, card-reader sales charged and then refused,
  one after another (M2), until the stop is cleared by a free-space reading; and after a restart
  on a folder still under 16 MiB free, the first such sale charged and refused.
- A card charged and its sale then refused for a full disk answering `storage.disk_full`; it now
  answers `sale.charged_not_recorded`.
- After a write failed because the disk was full, every other till and kitchen-screen write still
  tried and was saved when it fitted (M2: a 1-line cash sale answered `200` after a 20-line one
  failed). It is now refused `507 storage.disk_full` until a write reads 16 MiB free — sales by
  cash, "Otro datáfono" or reader, bill payments, orders, rounds and kitchen sends, clock-ins,
  ticket bumps, table and layout changes, kitchen notes and allergy answers, refunds, reprints and
  receipt emails, opening the cash drawer by hand, department transfers and staff schedule
  requests — except the open writes of decision 4.
- A sale owing nothing taken on the reader, or an issued order owing nothing settled there, while
  the stop holds (Task 12c).
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
2. **Nothing that should go on is refused.** A recovery of a card already charged and a resend of
   a sale or payment already recorded are not refused by the stop (decision 20; Tasks 5, 12c);
   sign-in, sign-out, the seven POSTs that save nothing of their own and the device's housekeeping
   are not refused by the gate (Tasks 12a, 12b); a sale at 00:00 local on 28-10-2024 is not refused
   by the clock (Tasks 6, 7; Task 1's boundary).
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
   Thrown only after a capture and only for a full disk, on both reader routes and on every one
   of `/api/pay`'s four after-the-charge paths (settle, capture, recover, recover-settle); the till
   shows the after-the-charge sentence for it and never the sale-only one; Pay again files without
   a second charge (Tasks 7b, 9a, 9b).
8. **The fiscal guard.** `git diff main -- packages/fiscal-verifactu/src/backend.ts packages/core/src/record-sale.ts packages/fiscal-verifactu/src/chain.ts`
   shows only the added delegating method (Task 1).
9. **The choke point** (Tasks 12a-12c). Under the stop, every `/api/` write route that
   `mountTillApi`, `mountDeviceApi` and `mountScheduleApi` register answers `507 storage.disk_full`
   before its handler runs, except the open list, and nothing is written (row counts on parking,
   placing, a round, a ticket bump, a clock-in, a cash sale, a collect and a bill payment); the
   sweep tests list every route a mount registers and pin the open list as a literal; no dashboard
   route and no route mounted afterwards is refused (M7 shows why a `use` would have been); the
   four sale routes refuse after their replay checks; freed space clears the stop on the next till
   write; deleting the gate's call fails the sweep and every refusal case.

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
  (`wrapBackend`) and `packages/core/src/record-void.test.ts:377` — adding
  `assertRecordableAt: () => {}` (or the fake's, bound by hand as those helpers bind the rest).
  Setup only; no assertion changes. (`apps/server/src/served-at-huella.test.ts:92` returns
  `new VerifactuBackend(…)`, which gains the method in this task, so it compiles unchanged.)

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
  `"clock.unusable": { clockAt: string; offsetMinutes: number }`, with a doc comment: the box's
  clock reads a date before the first one AEAT accepts for an invoice (28-10-2024), so no sale can
  be recorded; `clockAt` is the reading's instant, ISO 8601, and `offsetMinutes` its offset, in
  which the date was judged.
- Produces, in `first-issue-date.ts`:
  ```ts
  /** 28-10-2024 as YYYYMMDD: `@waitron/verifactu` refuses an earlier FechaExpedicionFactura. */
  export const FIRST_ISSUE_DAY = 20241028;
  /** Throws `clock.unusable { clockAt, offsetMinutes }` when the reading's date, in its own offset, is before {@link FIRST_ISSUE_DAY}. */
  export function refuseBeforeFirstIssueDate(reading: { instant: Date; offsetMinutes: number }): void;
  ```
  It takes the date with the library's own `formatDate(instant, offsetMinutes)` (`DD-MM-YYYY`,
  `@waitron/verifactu`'s `format.d.ts`), so it reads the date exactly as the record will carry it.
- `VerifactuBackend.assertRecordableAt(reading)` calls `refuseBeforeFirstIssueDate(reading)`.
  `FakeFiscalBackend.assertRecordableAt` and `NoneBackend.assertRecordableAt` return.

- [ ] **Step 1: Write the failing tests.**
  - In `first-issue-date.test.ts`, `describe("refuseBeforeFirstIssueDate")`:
    - `"refuses a reading in 2001 with the reading's instant"`:
      `expect(() => refuseBeforeFirstIssueDate({ instant: new Date("2001-01-01T11:00:00.000Z"), offsetMinutes: 60 })).toThrow(expect.objectContaining({ code: "clock.unusable", params: { clockAt: "2001-01-01T11:00:00.000Z", offsetMinutes: 60 } }))`.
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
      reading is written `expect(() => backend.assertRecordableAt(reading)).toThrow(expect.objectContaining({ code: "clock.unusable", params: { clockAt: "2001-01-01T11:00:00.000Z", offsetMinutes: 60 } }))`
      (the method is synchronous and returns `void`, so not `rejects`); with
      `2024-10-27T23:00:00.000Z` +60, `expect(() => …).not.toThrow()`. (A pure check; no database record is written, so N8 does not apply.)
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
  git add packages/fiscal packages/fiscal-none packages/fiscal-verifactu/src/first-issue-date.ts packages/fiscal-verifactu/src/first-issue-date.test.ts packages/fiscal-verifactu/src/errors.ts packages/fiscal-verifactu/src/backend.ts packages/core/src
  git commit -s -m "The fiscal seat can say a clock reading is too early to record, and Veri*Factu knows its first day"
  ```

### Task 2: Every server path that records a sale refuses under such a clock, at its issue reading

**Files:**
- Modify: `apps/server/src/issue-moment.ts` (`issueMoment`, `:17-27`)
- Modify: its callers — `apps/server/src/till-sale.ts:936` (`fileImmediateSale`), `:1554`
  (`finalizeCapture`), `:1694` (`finalizeRecovery`); `apps/server/src/bill-payments.ts:685`
  (`issueWhenFullyPaid`); `apps/server/src/working-order.ts:6683-6695` (`priceForIssuance`, which
  gains a `backend` parameter) and its callers `apps/server/src/unpaid-departure.ts:118` and
  `apps/server/src/testing/issue-order.ts:14`, and its test callers
  `apps/server/src/department-transfer-api.test.ts:565`, `:1505`, `:1640`, `:1670`, `:1718` and
  `apps/server/src/unpaid-invoice-delivery.test.ts:134` (`grep -rn "priceForIssuance" apps/server/src`;
  setup, the new argument only). Open #1944 also edits `department-transfer-api.test.ts`; if it
  lands first, find each call by name.
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
    regime refuses the reading"`: a stub throwing `new AppError("clock.unusable", { clockAt: "x", offsetMinutes: 0 })`
    → `issueMoment` throws that error.
  - `sale-clock.test.ts`, on `provisionBillVenue` with a counter zone offering one product (as M1's
    probe set up, `~/waitron-campaign-b/a798-3-plan-probe/srv/clock.test.ts:13-25`), the route's
    clock set with `venue.appAt(clock)` to a `TrustedClock` returning a fixed
    `{ instant, offsetMinutes: 60 }`:
    - `"refuses a cash sale under a clock in 2001 by name, before the invoice number"`:
      `POST /api/sales` cash at `2001-01-01T11:00:00.000Z` →
      `409 { code: "clock.unusable", params: { clockAt: "2001-01-01T11:00:00.000Z", offsetMinutes: 60 } }`; the
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
  plus `src/department-transfer-api.test.ts src/unpaid-invoice-delivery.test.ts` and every
  `unpaid-departure*.test.ts` (`ls apps/server/src/unpaid-departure*.test.ts`) — PASS,
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
     * Whether a till write must be refused now. Reads the folder's free space only while a refusal
     * is noted, and forgets the refusal at FULL_DISK_BYTES or more.
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
  /** The refusal a till write gets while the stop holds. */
  export function diskFullRefusal(): AppError<"storage.disk_full">;
  ```
  `noteRefused` logs `("warn", "storage.disk_full_noted", {})` only when nothing was noted.
  `full()` counts `noteRefused` calls and clears only if none was made while its reading was in
  flight: a refusal noted during the read keeps the stop, and that `full()` answers `true`, so its
  request is refused too. Two reads that both find space log
  `("info", "storage.disk_space_back", { freeBytes })` once. `noteFullAtStart` logs
  `("warn", "storage.start_space_unread", {})` on a `null` reading. `diskFullRefusal()` is
  `new AppError("storage.disk_full", {})`, with no `reason`: the boundary never logs one for a
  full disk (`packages/server-kit/src/error-boundary.ts:34-39`); the refusal sites log their own
  event (Tasks 5, 7).

  **As built (2026-10-21):** `full()` records the count of `noteRefused` calls when its reading
  starts. It answers `true` when the reading is under `FULL_DISK_BYTES` or unreadable, or when any
  `noteRefused` was made while the reading was in flight — even one made after a faster reading had
  already cleared the stop (`"keeps a refusal noted after one read cleared and before a slower read
  returns"`). Otherwise it clears the stop, logging `storage.disk_space_back` only if no other
  reading cleared it first, and answers `false`. `noteRefused`'s doc also names a start under
  `FULL_DISK_BYTES`.

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
  after. `BillVenue.appWith` is fixture setup, written in this step together with the `disk?`
  members it passes (`IntegratedPayDeps`, `TillApiDeps`, and `/api/pay`'s `disk: deps.disk`), so
  the step's run fails on the missing stop and not on `venue.appWith is not a function`; nothing
  reads `disk` until Step 3.
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
  - (The sale that owes nothing is refused while the stop holds — decision 4 — and is Task 12c's
    case; this task's checks sit after its return, and Task 12c moves them. The `0.00` product is
    still created here: Task 12c's case reuses its setup.)
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
  FAILS the same way, M2's answer. The controls and the recovery case pass before and after.

- [ ] **Step 3: Implement** the read before P1, the two refusals inside it and the check
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
    `409 { code: "clock.unusable", params: { clockAt: "2001-01-01T11:00:00.000Z", offsetMinutes: 60 } }`, collect
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
  gains a parameter `refusals: { diskFull: () => boolean }`, inserted before the optional
  `attendance?: AttendanceRecorder` (`bill-payments.ts:1046`), not after it: a required parameter
  after an optional one does not compile (TS1016; probe
  `~/waitron-campaign-b/a798-3-plan-review/round2-check/tsc-param/probe.ts`, `tsc` 7.0.2, exit 1;
  the same signature with `refusals` first compiles, exit 0).
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
  - (Cash and "Otro datáfono" while the stop holds are refused from Task 12c on — decision 4 —
    and are its cases.)
  - `"answers a retry of a payment already taken while the stop holds"`: take a reader payment,
    then note, then resend the same `submissionId` → `200`, the same payment id, collect unchanged.
  - `"takes a reader payment again once the folder has 16 MiB free"` → collect +1.
  - Window 1, as Task 5's (a `full()` wrapper that queues a body noting the refusal) → `507`,
    collect unchanged, no `bill_payments` row; control → `200`, collect +1.
  - Window 2, as Task 5's (`noted()` `false` then `true`) → `507`, collect unchanged, the bill
    payment `failed`; control → `200`, collect +1.
  The three clock cases below (reader, cash, manual card) are each a PART payment, one that does
  not complete the bill: a completing payment already answers `409 clock.unusable` at P3 after
  Task 2 (with collect +1 for a reader payment), so it would not fail before this task.
  - `"refuses a reader payment under a clock in 2001, before the reader"`: `appWith({ clock })` →
    `409 { code: "clock.unusable", params: { clockAt: "2001-01-01T11:00:00.000Z", offsetMinutes: 60 } }`, collect
    unchanged, no `bill_payments` row (M1 printed `200 received`, collect 1, for a part payment).
  - `"refuses a cash part payment and a manual card under such a clock"` → `409 clock.unusable`,
    no `bill_payments` row.
  - Control `"takes a reader payment at 00:00 local on 28-10-2024"` → collect +1, in a database
    holding no record dated later (N8): run it before any case here that records a sale, or in its
    own `describe` with `resetPerTest`.

- [ ] **Step 2: Run them and watch them fail**

  Run: `pnpm --filter @waitron/server exec vitest run src/bill-payments.refuse-before-reader.test.ts`
  Expected: the stop's refusal and both windows FAIL with `200` and collect +1; the clock cases
  FAIL with `200 received` (part payments, M1); the controls and the retry pass
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
- Modify: `apps/server/src/till-sale.ts` (`payIntegrated`'s four after-the-charge paths: the
  recovery returns at `:1305` (`finalizeRecovery`) and `:1308` (`finalizeSettleRecovery`), and
  P3's `finalizeSettle` (`:1357`) and `finalizeCapture` (`:1368`))
- Modify: `apps/server/src/bill-payments.ts` (`takeReaderBillPayment`'s P3, `:1387-1414`)
- Create: `apps/server/src/card-charged-not-recorded.test.ts`

**Interfaces:**
- `"sale.charged_not_recorded": { workingOrderId: string; reason: "disk_full" }`, with a doc
  comment: a card was charged on a connected reader and its sale could not be recorded; `reason`
  says why. Status `507`.
- On `/api/pay`, all four paths that run after a card was charged are wrapped —
  `finalizeSettle`, `finalizeCapture`, `finalizeRecovery` and `finalizeSettleRecovery` (decision
  18) — and on the bill route the P3 call: an error for which `diskFullIn(error)` is true becomes
  `new AppError("sale.charged_not_recorded", { workingOrderId, reason: "disk_full" })`, thrown with
  no link to the original (decision 18), after logging
  `("error", "sale.charged_not_recorded", { workingOrderId })`; any other error is rethrown
  unchanged. On the bill route only the `captured` branch (`completeBillPayment`) is wrapped. One
  helper wraps all five calls.
- **As built (2026-10-21):** the helper, `afterCardCharged` (`bill-payments.ts`), converts only
  when its deps set `sayCardChargedOnFullDisk: true`, and only the till's `POST /api/pay` and bill
  payment routes set it; otherwise every error passes through, so the dashboard's stuck-payment
  resolve route still answers `storage.disk_full` (decision 18's note).

- [ ] **Step 1: Write the failing tests** in `card-charged-not-recorded.test.ts`, on
  `provisionBillVenue`. Each failure is made by
  `vi.spyOn(venue.backend, "recordSale").mockRejectedValueOnce(new AppError("storage.disk_full", {}))`
  (`venue.backend`, `bill-venue.ts:80`): the error the store throws for a full disk, met after the
  charge. That spy reaches `finalizeCapture` and `finalizeRecovery`, whose core `recordSale` hands
  the record to the backend. It does not reach the settle case: `finalizeSettle` calls
  `settleSale`, imported straight from `@waitron/core` (`till-sale.ts:49`), which takes no backend
  (`packages/core/src/settle-sale.ts:41`). For that case, `vi.mock("@waitron/core", …)` at the top
  of the file returns the real module with `settleSale` replaced by a function that rejects
  `new AppError("storage.disk_full", {})` once when a test arms it and otherwise calls the real
  one.
  - `"says a card was charged when its sale then fails for a full disk"`: a walk-up `/api/pay` →
    `507 { code: "sale.charged_not_recorded", params: { workingOrderId: <id>, reason: "disk_full" } }`,
    collect +1, a captured `payments` row with no sale. Then, the spy restored, Pay again
    (`lines: []`) → `200 captured`, collect unchanged, the sale filed (M3's shape).
  - `"says so when a placed order's settlement fails after the charge"`: a placed order with an
    issued invoice, built as Task 5's settle case builds it (`issueOrderInvoice`,
    `apps/server/src/testing/issue-order.ts:6-17`), `settleSale` armed to reject → `/api/pay` answers
    `507 { code: "sale.charged_not_recorded", params: { workingOrderId: <id>, reason: "disk_full" } }`,
    collect +1.
  - `"says so when Pay again recovers a charged card on a still-full disk"`: a captured payment
    with no sale on an open order (`insertCapturedPayment`, as
    `till-sale-integrated.db.test.ts:304-314` does), the `recordSale` spy rejecting → Pay again
    (`lines: []`) answers `507 { code: "sale.charged_not_recorded", params: { workingOrderId: <id>, reason: "disk_full" } }`,
    collect unchanged (M3 measured `507 storage.disk_full` and `collect 0` here before this
    slice).
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
  Expected: the four full-disk cases FAIL with `507 storage.disk_full` where
  `sale.charged_not_recorded` was expected (the boundary answers any full disk so,
  `error-boundary.ts:34-39`); the controls pass before and after.

- [ ] **Step 3: Implement** the code, its status, the helper and the five wrapped calls.

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
  const stopWatchingDisk = watchForDiskFull(diskFull, [store.venue, store.node]);
  undoOnFailure.push(async () => stopWatchingDisk());
  await noteFullAtStart(diskFull, { dir: config.venueDir, log });
  ```
  `undoOnFailure` is `Array<() => Promise<void>>` (`boot.ts:816`) and `watchForDiskFull` returns
  `() => void`, so the unsubscribe is wrapped: pushing it bare does not compile (TS2345; probe
  `~/waitron-campaign-b/a798-3-plan-review/round2-check/tsc-undo/probe.ts`, `tsc` 7.0.2, exit 1;
  the wrapped push compiles, exit 0).
  (`now` is `boot.ts:818`, `log` `:900`. CLAUDE.md §3: a duty pushes its stop onto `undoOnFailure`
  as soon as it exists.) `mountTillApi` gets `disk: diskFull`.

- [ ] **Step 1: Write the failing tests**, in the shape of `boot.clock-wiring.test.ts:1-80`
  (`serverFixture`, `vi.mock` of a module to capture what boot passes):
  - mock `./disk-full-state.js` so `createDiskFullState`, `watchForDiskFull` and `noteFullAtStart`
    record their arguments and return the real results, and `watchForDiskFull`'s returned
    unsubscribe records that it ran; mock `./till-api.js` so `mountTillApi` records its deps; mock
    `@waitron/db`, which `boot.ts` imports `openVenueDatabase` from (`boot.ts:49-55`), so each store
    `openVenueDatabase` returns is recorded.
  - `"listens to both of the venue folder's files, reads its free space, and hands the stop to the
    till routes"`: after a start, `createDiskFullState` got `dir` equal to the started server's
    venue folder; `watchForDiskFull` got that state and exactly `[s.venue, s.node]` (`toBe` each),
    where `s` is the recorded store whose `venue` is the `db` in `mountTillApi`'s recorded deps
    (boot passes `db`, which is `store.venue`, at `boot.ts:1656`). Do not pick `s` by its place in
    the call order: a start opens other short-lived stores through the same import before the
    long-lived one (the stamp probe at `boot.ts:903`, and `missingBeforeMigration` at `:926`,
    which opens one at `append-only-watch.ts:31`);
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
  - `"sale.charged_not_recorded"`: decision 10's after-the-charge sentence WITHOUT the cause (the
    one shown for a `reason` other than `"disk_full"`).
  - `"clock.unusable"`: decision 11's sentence without the bracket — es "Venta no registrada: la
    hora del equipo es incorrecta. Avisa al encargado. Si ya has cobrado con tarjeta en el
    datáfono, devuelve el importe ahí." / en "Sale not recorded: the box's clock is wrong. Tell a
    manager. If you already charged a card on the terminal, refund it there."
- `strings.ts` gains, both languages: `"sale.disk_full"` (decision 10's sale-only sentence;
  English from decision 19); `"sale.disk_full_manual_card"` (that sentence followed by today's
  card advice, word for word from `sale.refused`, `strings.ts:1350` and `:3041`: es "… avisa al
  encargado. Si ya has cobrado con tarjeta en el datáfono, devuelve el importe ahí." / en "…
  tell a manager. If you already charged a card on the terminal, refund it there.", decision 10);
  `"sale.charged_disk_full"` (decision 10's after-the-charge sentence with its cause, "… el equipo
  no tiene espacio …"); and `"sale.clock_unusable"` (decision 11's dated sentence, with `{date}`).
- `t.ts`: `export function clockUnusableText(clockAt: string, offsetMinutes: number): string` —
  `t("sale.clock_unusable")` with `{date}` replaced by the date formatted in the reading's own
  offset as decision 11 says: `new Date(Date.parse(clockAt) + offsetMinutes * 60_000)` formatted
  with `Intl.DateTimeFormat(currentLocale(), { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" })`,
  never in the till's own time zone.
- `till-app.ts`: `CounterError` gains `| { clockUnusable: { clockAt: string; offsetMinutes: number } }`,
  rendered with `clockUnusableText`.
  `function saleRefusalOf(error: unknown, tender: { manualCard: boolean }): CounterError | undefined`
  answers: for `storage.disk_full`, `"sale.disk_full_manual_card"` when `tender.manualCard` and
  `"sale.disk_full"` otherwise; for `sale.charged_not_recorded`, `"sale.charged_disk_full"` only when
  its `reason` is `"disk_full"`, and `{ code: "sale.charged_not_recorded" }` (the cause-neutral
  sentence) for any other or missing `reason`; for `clock.unusable` carrying a string `clockAt` and
  a numeric `offsetMinutes`, `{ clockUnusable: { clockAt, offsetMinutes } }`, and
  `{ code: "clock.unusable" }` for one without; `undefined` otherwise. `#onConfirmPayment` passes
  `manualCard: tender.method === "card"` (its tender is `{ method: "cash" } | { method: "card"; externalRef? }`,
  `apps/till/src/widgets/tender-pay.ts:53-56`: a card there is one staff charged on a terminal
  the box does not talk to); `#collectCard` (the connected reader) passes `false`. Both check it
  FIRST in their catch chains, ahead of `isPermanentSaleRefusal`.

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
    - the counter's "Otro datáfono" sale (`#onConfirmPayment` with a `card` tender, `api.recordSale`
      rejecting the same) shows `t("sale.disk_full_manual_card")`, which contains the card advice;
    - the counter card pay rejecting `{ code: "sale.charged_not_recorded", workingOrderId: "…", reason: "disk_full", status: 507 }`
      shows `t("sale.charged_disk_full")`; the same with `reason: "something_else"` shows
      `codeMessage("sale.charged_not_recorded")` (the cause-neutral sentence) and not
      `t("sale.charged_disk_full")`;
    - rejecting `{ code: "clock.unusable", clockAt: "2001-01-01T11:00:00.000Z", offsetMinutes: 60, status: 409 }`
      shows the dated sentence with `01/01/2001` in it (the test runs in `es-ES`; restore the
      language after, CLAUDE.md §4), and NOT `t("sale.refused")`; and rejecting
      `{ code: "clock.unusable", clockAt: "2024-10-27T23:30:00.000Z", offsetMinutes: 0, status: 409 }`
      shows `27/10/2024`, and the same instant with `offsetMinutes: 60` shows `28/10/2024` — the
      dates the record would carry (M4). Formatting in the browser's own time zone fails at least
      one of the pair whatever that zone is, because it prints one date for the one instant
      (decision 11's control).

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
- `wholeTabErrorOf`, `#onCollectOrder` and `#onFindBillPay` check `saleRefusalOf` (Task 9a) first,
  passing `manualCard: true` when the tender they sent was an "Otro datáfono" card and `false`
  otherwise (cash, or the connected reader). `wholeTabErrorOf(error)` knows no tender today
  (`till-app.ts:588`), so it gains a `tender: { manualCard: boolean }` argument that each of its
  callers (`till-app.ts:15958`, `:16059`, `:16078`, `:16152`) fills from the tender it sent.
- `PayRefusal` gains `clockAt?: string`, `offsetMinutes?: number` and `reason?: string`, copied in
  `bill-payment.ts` as `chargeable` is (`:252`), and `manualCard?: true`, which the caller that
  sent a bill's manual-card contribution sets on the refusal before it is shown (`refusalOf` does
  not know the tender; find that caller among `grep -n "refusalOf(" apps/till/src/till-app.ts`).
  `refusalText` answers, for `storage.disk_full`, `t("sale.disk_full_manual_card")` when
  `manualCard` and `t("sale.disk_full")` otherwise; `clockUnusableText(clockAt, offsetMinutes)`
  for `clock.unusable` with both; `t("sale.charged_disk_full")` for `sale.charged_not_recorded`
  with `reason: "disk_full"`; any other `sale.charged_not_recorded` already reaches `codeMessage`
  at its end (the cause-neutral sentence).

- [ ] **Step 1: Write the failing tests.**
  - `till-app-handheld-pay.test.ts`: rows in the `it.each` at `:538-552` (the presented bill's cash
    send) for `storage.disk_full` and `clock.unusable` with `clockAt` and `offsetMinutes`, and a
    card case beside `:499` (`pay` rejecting each of the three codes, `sale.charged_not_recorded`
    with `reason: "disk_full"`): the sheet shows `t("sale.disk_full")`, the dated clock sentence,
    and `t("sale.charged_disk_full")`.
  - `presented-pay-dialog.test.ts` beside `:557`: a reader payment refused with each of the three
    shows the same sentences through `refusalText`; a manual-card contribution refused
    `storage.disk_full` shows `t("sale.disk_full_manual_card")`; and `sale.charged_not_recorded`
    with another `reason` shows `codeMessage("sale.charged_not_recorded")`.
  - `till-app.test.ts`: collecting an order and paying a found bill refused `storage.disk_full`
    show `t("sale.disk_full")` for cash and `t("sale.disk_full_manual_card")` for an "Otro
    datáfono" card (one case each per surface), and refused `clock.unusable` with `clockAt` and
    `offsetMinutes` show the dated sentence.

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

### Task 12: Once a save has failed on a full disk, every till and kitchen-screen write is refused until someone frees space (decision 4: the owner chose (a))

Split into three tasks, each for one implementer, run in order after Tasks 1-10 and before Task 11:
**12a** puts one gate in front of every write route the till's mount registers; **12b** does the
same for the kitchen screens' and the staff schedule's routes and wires boot; **12c** refuses the
four sale routes from inside, after their replay checks. Each is sized well under 100 tool calls.
**Size:** 12a about 60-80 tool calls, 12b about 35-50, 12c about 60-80. Split because one
implementer doing all three would pass 150.

Every `file:line` below was read at `45693342d` (the branch's base when this task was written),
from a `git archive` of that commit, so a line moved by this branch's own Tasks 1-10 is found by
name. **#1944 landed on `main` as `509e8d42a` after this task was written:** it removes
`POST /api/device/pass-screen/done` and the kitchen levers' Fire and Away (the levers in
`device-levers.ts` now register Ready only) and moves lines in `till-api.ts`. This branch is
rebased onto it, so find each site by name; the gate covers whatever routes are left, because it
is built from the routes the mount registers.

**Why the gate is registered per route, not as one `app.use`** (M7, measured for this task with
`node` against `hono` 4.13.13, the version `apps/server` resolves; probes under
`~/waitron-campaign-b/a798-3-task12/probe/`):
- `app.use("/api/*", gate)` placed where `mountTillApi` places `madeHereAnswer` (`till-api.ts:1248`)
  runs before every `/api/*` route registered after it: P1 printed `POST /api/after -> 507
  ran=[gate]` and, for a route registered before it, `POST /api/before -> 200
  ran=[before-handler]`. Boot registers the dashboard's `/api/backup/*` (`boot.ts:2279`) and
  `/api/box/*` routes, the device API (`boot.ts:1805`) and the schedule API (`boot.ts:2015`) after
  `mountTillApi` (`boot.ts:1653`), so such a gate would refuse them.
- A sub-app's `use("*", gate)` mounted with `app.route("/", sub)` is copied into the parent as
  `ALL /*` and catches every route the parent registers afterwards: P2 printed
  `POST /api/backup/apply -> 507 ran=[sub-gate]` and `POST /management-api/staff -> 507
  ran=[sub-gate]` (`route()` copies `app.routes` entry by entry; read: `hono-base.js`'s `route`).
- Registering the gate on the parent with `app.on(method, path, gate)` for each write route of the
  sub-app, then `app.route("/", sub)`, gates exactly those routes: P3 printed
  `POST /api/w/1/place -> 507 ran=[root-mw,gate]`, control (not full) `200
  ran=[root-mw,gate,madehere,till-place]`, `GET /api/w/1 -> 200` (no gate), the open
  `POST /api/session -> 200`, and the later-registered `POST /api/backup/apply -> 200` and
  `POST /api/device/battery -> 200`, both without the gate. A gated `PUT /api/w/:id` did not catch
  `PUT /api/w/1/label` (`hono-prefix.mjs`: `-> 200 ran=[put-label]`). Root middleware registered
  earlier still runs first (`root-mw`), so the request id and CORS (`boot.ts:972`, `:1587`) wrap the
  refusal.
  Commands: `node hono-order.mjs <repo>/node_modules/.pnpm/hono@4.13.13/node_modules/hono/dist/index.js`
  and `node hono-prefix.mjs <same path>`.

**What stays open while the stop holds** (decision 4; each still fails by itself with
`storage.disk_full` if its own save does not fit):
- Sign-in, sign-out and the session's language — `POST /api/session` (`till-api.ts:1345`),
  `DELETE /api/session` (`:1427`), `PUT /api/session/locale` (`:1442`). A refused sign-out would keep
  a person signed in on a shared till; a refused sign-in would keep the next shift from reading the
  floor and its bills. Sign-in also records the person's sign-in as working-time evidence
  (`till-api.ts`, the `attendance` call in `POST /api/session`), so that evidence keeps arriving
  while clock-ins are refused.
- The four sale routes — `POST /api/sales` (`:1736`), `POST /api/pay` (`:1778`),
  `POST /api/working-orders/:id/collect` (`:2642`), `POST /api/working-orders/:id/payments`
  (`bill-payments-api.ts:227`) — open at the gate and refused inside by 12c, after their replay
  checks, because only there can a resend of a sale already recorded be told from a new one
  (`till-sale.ts:663-665`, `:1129-1134`, `:2076-2078`; `bill-payments.ts:1054-1064`), and because
  `/api/pay` decides "Pay again on a card already charged" inside its first transaction
  (`till-sale.ts:1164-1174`). See decision 20.
- Seven POSTs that save nothing of their own (each, like every GET, may record the device's
  sighting through `requireSession`): `POST /api/dead-ends/sale`, `/draft`, `/order` (`till-api.ts:1618`,
  `:3606`, `:3697`), `POST /api/working-orders/:id/payments/preview` (`bill-payments-api.ts:216`),
  `POST /api/working-orders/:id/adjustments/preview` (`adjustments-api.ts:234`),
  `POST /api/parties/:id/allergy/send-preview` (`party-allergy-api.ts:93`, answered by
  `readAllergySendView` at `:130`), `POST /api/bills/:id/move/allergy-preview`
  (`till-api.ts:4119`). That each saves nothing of its own was read, not run (their handlers and the till
  client's doc comments, `apps/till/src/api/client.ts:4350`, `:4385`). Why it matters: a refused
  send-preview makes the till show its generic `table.error` and never send the round
  (`apps/till/src/state/party-allergy-flow.ts:19-34` turns any failure into `unread`;
  `apps/till/src/till-app.ts:3684`; read), so the kitchen send itself must be the request that is
  refused, with Task 9c's sentence.
- **As built (2026-10-21):** an eighth, `POST /api/demo-reader/cancel`, registered only with the
  practice card simulator; see decision 22's note.
- On the device API (12b): the device's own housekeeping — `POST /api/device/join`
  (`device-api.ts:208`), `PUT /api/device/zones` (`:347`), `PUT /api/device/equipment` (`:379`),
  `POST /api/device/active-profile` (`:400`), `PUT /api/device/battery` (`:413`). None is a sale,
  an order, a kitchen send or a clock-in.
- Never gated, because they are not on these mounts: every dashboard route (`/management-api/*`,
  and the dashboard's `/api/backup/*` and `/api/box/*`; the dashboard client calls no other `/api/`
  write, read: `grep` of `apps/dashboard/src` for `"/api/`), the provider webhook, the node
  enrolment, and every background duty — the filing outbox, the pending-payment pass that completes
  a bill's captured card (`bill-payments-loop.ts`), the print queue and the payment release pass.
  Their writes that do not fit fail by themselves with `storage.disk_full` and note the stop
  (decision 1); this task adds no refusal there.
  **As built (2026-10-21):** that list is not complete: every route outside the three mounts is
  ungated, the print agent's `POST /print-api/agent/*` routes (`print-api.ts`) among them.

**What the till shows.** The gate and 12c answer `507 { error: { code: "storage.disk_full",
params: {} } }`, the shape the error boundary gives (`packages/server-kit/src/error-boundary.ts:34-39`)
and the read-only gate copies (`apps/server/src/read-only-gate.ts:34-37`). So Tasks 9a-9c's mapping
applies unchanged and this task adds no till code: placing, parking, table and line writes —
which a kitchen send from a table reaches through `#onReleaseRefusal` → `lineWriteError`
(`till-app.ts:11399-11406`, called from `#onGroupCommand` at `:11435` and the lines send at
`:11933`; read), or, for a round sent from a draft, through `#submitDraft`'s `draftRefusalError` →
`tableWriteError` and `lineWriteError` (`till-app.ts` `#submitDraft`; read) — discarding, the
till's ticket advance and clock-in show the owner's
sentence, "No se ha guardado: el equipo no tiene espacio en disco. Avisa al encargado." (decision 10,
the code table's entry). The money surfaces keep the sale's own sentence, "Venta no registrada: el
equipo no tiene espacio en disco. No cobres hasta que se resuelva; avisa al encargado." (design §3's
table for a sale; decisions 10 and 24), with the card advice after an "Otro datáfono" tender. Not
covered,
and left to slice 6 (Task 11, backlog (a)): the kitchen display's station screen shows nothing for
any refused bump today — it reloads its queue (`apps/till/src/screens/till-station-screen.ts:578-586`;
read) — and any till surface outside decision 12 that shows its own fallback.

### Task 12a: The gate, in front of every write route `mountTillApi` registers

**Files:**
- Create: `apps/server/src/disk-full-gate.ts`
- Modify: `apps/server/src/till-api.ts` (`mountTillApi`, `:1244-4189`: its parameter, its first
  line and its last line only; `TillApiDeps.disk`'s doc, added by Task 5)
- Modify: `apps/server/src/testing/bill-venue.ts` (`appWith`, added by Task 5: one more option)
- Create: `apps/server/src/till-api.disk-full-gate.test.ts`
- Create: `apps/server/src/till-clock.disk-full.test.ts`

**Interfaces:**
- `disk-full-gate.ts`:
  ```ts
  /**
   * Adds `routes`' routes to `root`, first putting in front of each write route under `/api/` a
   * check that answers 507 `storage.disk_full`, before the route runs, while `disk.full()` is true.
   * A route `open` names ("POST /api/session") is not checked. With no `disk`, nothing is checked.
   */
  export function mountGatedWhileDiskFull(
    root: Hono,
    routes: Hono,
    deps: { disk?: DiskFullState; log: Logger; open: ReadonlySet<string> },
  ): void;
  ```
  For each entry of `routes.routes` whose `method` is `POST`, `PUT`, `PATCH` or `DELETE`, whose
  `path` starts with `/api/`, and whose `` `${method} ${path}` `` is not in `open` and not already
  checked: `root.on(method, path, check)`. Then `root.route("/", routes)`. The check:
  `if (!(await disk.full())) return next();` else log
  `("warn", "storage.disk_full_stop_refused", { route: key, requestId: c.get("requestId") })` and
  `const err = diskFullRefusal(); return c.json({ error: { code: err.code, params: err.params } }, 507);`
  — returned directly, as `read-only-gate.ts:34-37` does, because a middleware is outside a route's
  error boundary. `/management-api/*` routes a mount registers (the demo reader's, `till-api.ts:1285`,
  `:1291`) are not under `/api/` and are never checked.
- `till-api.ts`: `mountTillApi(root: Hono, deps, log)`; its first line `const app = new Hono();`
  (every existing registration below it is unchanged and now lands on `app`, `madeHereAnswer`'s
  `app.use` at `:1248` included); its last line
  `mountGatedWhileDiskFull(root, app, { disk: deps.disk, log, open: TILL_OPEN_WHILE_DISK_FULL });`.
  `TILL_OPEN_WHILE_DISK_FULL` is a module constant beside it holding the 14 entries of "What stays
  open" (3 session, 4 sale routes, 7 POSTs that save nothing of their own), with one comment line
  per group saying why.
  `TillApiDeps.disk`'s doc says it is read by the gate, the reader payments and, through the deps
  they pass, the cash, collect and bill-payment routes; a live boot always supplies it.
- `BillVenue.appWith` gains `workforceEnabled?: boolean`, passed to `mountTillApi` (setup only).

- [ ] **Step 1: Write the failing tests.** In `till-api.disk-full-gate.test.ts`, on
  `provisionBillVenue` under `useVenueDb` with `migrationOptionsFor(manifestSets(), null)` (the
  shape of `adjustments-bill-payments.test.ts:40-45`), each case with its own
  `createDiskFullState` over a settable `statfs` stub as `till-pay.disk-full.test.ts` (Task 5) builds
  one, noted by `noteRefused()` with the stub at 0 unless the case says otherwise. Set up through
  `venue.app` (no stop); send the request under test through `venue.appWith({ disk })`. Every refused
  request asserts `status` 507 and body `{ error: { code: "storage.disk_full", params: {} } }`.
  - `"refuses every till write while a refused write is noted, except the open ones"`: mount
    `venue.appWith({ disk, workforceEnabled: true })`; list its routes from `app.routes` whose method
    is a write and whose path starts with `/api/`, deduplicated by `` `${method} ${path}` ``; send
    each with no cookie and body `{}`, every `:name` segment replaced by one fixed UUID. Expect 507
    `storage.disk_full` exactly for the routes NOT in a literal `EXPECTED_OPEN` set written in the
    test (the 14 entries above — never imported from `till-api.ts`), and a status other than 507 for
    each one in it. Report failures as the list of mismatched routes. Also expect every entry of
    `EXPECTED_OPEN` to be among the listed routes, so a renamed route fails here.
    Control `"refuses none of them while nothing is noted"`: the same sweep with a fresh state;
    no route answers 507.
  - `"parks and places no order while the stop holds"`: `POST /api/working-orders` with a new id and
    one Caña (the body `till-api.ts:1842-1890` reads) → 507, no `working_orders` row with that id.
    Control, fresh state → the route's success status and the row exists. Then, that order parked
    and the stop noted, `POST /api/working-orders/:id/place` → 507 and the order's `status`
    unchanged; control → placed.
  - `"sends no round to the kitchen while the stop holds"`: a seated party
    (`seatedWith(venue)`, `testing/bill-venue.ts:430`), then `POST /api/parties/:id/groups` with one
    Paella and `release: "fire"` (the body `seatedWith` sends, `testing/bill-venue.ts:445-454`) →
    507; that bill's `working_order_lines` and `ticket_items` counts and the `print_jobs` count
    unchanged. Control → 200 and one more ticket item.
  - `"advances no ticket item while the stop holds"`: a dish sent to the kitchen
    (`seatedWith(venue, "Ensalada")`; find its `ticket_items` row as
    `attendance-kitchen-service.test.ts:100-126` does), then
    `POST /api/ticket-items/:id/advance` with `{ stationId: <the row's station>, to: "preparing" }`
    (`till-api.ts:2174`) → 507, the row's `state` unchanged. Control → 200 and `state` `preparing`.
  - `"still answers a read"`: noted → `GET /api/working-orders/:id` of a parked order → 200.
  - `"still signs a person in and out"`: noted → `POST /api/session` with the device cookie and
    `{ personId: venue.operatorId, pin: "5555" }` (read the body at `till-api.ts:1345`) → its
    success status; `DELETE /api/session` → its success status.
  - `"refuses no route mounted after the till's"`: on the app `appWith({ disk })` returned, register
    `mountThemesApi(app, { db: venue.db }, quiet)` and a bare `app.post("/api/backup/apply", (c) => c.json({}))`,
    as boot mounts those after `mountTillApi` (`boot.ts:1856`, `:2279`); noted →
    `POST /management-api/themes` with no cookie answers its own refusal (`management_session.required`),
    not 507, and `POST /api/backup/apply` → 200.
  - `"lets a write through once the folder has 16 MiB free, and forgets the refusal"`: noted, stub
    `FULL_DISK_BYTES - 1` → park → 507; then stub `FULL_DISK_BYTES` → park → success, and
    `disk.noted()` is `false` after.
  In `till-clock.disk-full.test.ts`, on `createClockVenue` (`testing/clock-venue.ts:28`) under
  `useVenueDb` as `till-clock-api.test.ts:22-28` sets it up, a Hono with `mountTillApi` over the
  clock venue's `db` and `cfg`, `workforceEnabled: true`, `secureCookies: false`,
  `venueLocale: "es-ES"`, `clock: systemClock()` (`till-backend.ts`, as `testing/bill-venue.ts:48`
  imports it), `backend: {} as FiscalBackend` (setup: the clock routes never read it) and `disk`:
  - `"clocks no one in while the stop holds"`: `POST /api/clock/in` with `{ expectedEntryId: null }`
    and the venue's cookie (`till-clock-api.test.ts:29-40`) → 507 `storage.disk_full`, the
    `timeEntries` count unchanged. Control → 200, one more entry.

- [ ] **Step 2: Run them and watch them fail**

  Run: `pnpm --filter @waitron/server exec vitest run src/till-api.disk-full-gate.test.ts src/till-clock.disk-full.test.ts`
  Expected: the sweep FAILS listing every write route except the open ones (each answered 401, 400
  or 404, not 507); the park, place, round, advance and clock-in cases FAIL with their success status
  where 507 was expected, and the rows changed; the freed-space case FAILS on its
  first half (no gate: success where 507 was expected). The two controls, the read, the sign-in and
  the later-mounted routes
  pass before and after.

- [ ] **Step 3: Implement** `disk-full-gate.ts`, the three-line change to `mountTillApi`, the open
  set and `appWith`'s option. If anything in `mountTillApi` registers a route after it returns, STOP
  and report: the copy at its end would miss it.

- [ ] **Step 4: Run them and the till suites, and watch them pass**

  Run the command of Step 2, then
  `pnpm --filter @waitron/server exec vitest run src/till-api.test.ts src/made-here.routes.test.ts src/till-pay.disk-full.test.ts src/bill-payments.refuse-before-reader.test.ts src/till-api.profile-actions.test.ts src/till-api.profile-zones.test.ts src/till-clock-api.test.ts`
  — PASS, `Tests` counts shown (`made-here.routes.test.ts` checks `madeHereAnswer` still wraps the
  till's routes after the move onto the inner app). `pnpm --filter @waitron/server typecheck` exits 0.

- [ ] **Step 5: Prove the gate by deletion.** Replace the `mountGatedWhileDiskFull(...)` call with
  `root.route("/", app);`. Run Step 2's command: the sweep, park, place, round, advance and clock-in
  cases must FAIL as in Step 2 (if one passes, it is not testing the gate: STOP). Restore the call;
  re-run: PASS.

- [ ] **Step 6: Commit**

  ```bash
  git add apps/server/src/disk-full-gate.ts apps/server/src/till-api.ts apps/server/src/testing/bill-venue.ts apps/server/src/till-api.disk-full-gate.test.ts apps/server/src/till-clock.disk-full.test.ts
  git commit -s -m "Once a save has failed for a full disk, every till write is refused until the venue folder has 16 MiB free again"
  ```

### Task 12b: The same gate for the kitchen screens and the staff schedule, wired at boot

**Files:**
- Modify: `apps/server/src/device-api.ts` (`DeviceApiDeps`, `:97`; `mountDeviceApi`, `:192`: its
  parameter, first and last line)
- Modify: `apps/server/src/device-levers.ts` (`mountDeviceLevers`'s `deps` type, `:118-123`, only if
  the typecheck asks; it receives the inner app from `device-api.ts:447`)
- Modify: `apps/server/src/schedule-api.ts` (its deps type; `mountScheduleApi`, `:51`)
- Modify: `apps/server/src/boot.ts` (`mountDeviceApi`'s deps, `:1805-1816`; `mountScheduleApi`'s,
  `:2015`)
- Test: `apps/server/src/device-api.test.ts`, `apps/server/src/schedule-api.test.ts`,
  `apps/server/src/boot.disk-full-wiring.test.ts` (Task 8)

**Interfaces:**
- `DeviceApiDeps` and `ScheduleApiDeps` gain `disk?: DiskFullState`. Each mount takes `root`, builds
  `const app = new Hono();` first and ends with `mountGatedWhileDiskFull(root, app, { disk: deps.disk, log, open })`:
  `DEVICE_OPEN_WHILE_DISK_FULL` (the five housekeeping routes of "What stays open") for the device
  API, an empty set for the schedule (its writes, `schedule-api.ts:87`, `:106`, `:123`, are staff
  requests, which the strip's "No se puede guardar nada" covers).
- The kitchen display's writes are therefore gated by construction: at `45693342d`,
  `POST /api/device/pass-screen/done` (`device-api.ts:468`), `.../kitchen-notices/:id/acknowledge`
  (`:556`), `.../ticket-items/:id/advance` (`:578`), `.../working-orders/:id/lines/move-station`
  (`:610`) and the levers (`device-levers.ts:125`, `:161`); after #1944, whatever remains.
  `/management-api/devices/*` (`device-api.ts:652-753`) is not under `/api/` and is never gated.
- Boot passes `disk: diskFull` (Task 8's state) to both mounts; `mountDeviceApi` is called only when
  `!fencedOrMirror` (`boot.ts:1777`), inside `bootServer` (`:812`), where `diskFull` is in scope.

- [ ] **Step 1: Write the failing tests.**
  - `device-api.test.ts`, a new `describe("while a save refused for a full disk stands")`, mounting
    `mountDeviceApi` as `mountApp` does (`device-api.test.ts:235-251`) plus `disk`:
    - the same sweep as 12a's over this app's `/api/` write routes, with a literal
      `EXPECTED_OPEN` of the five housekeeping routes; control with nothing noted.
    - `"a station screen bumps nothing while the stop holds"`: `fireOrder` and
      `enrolStationScreen` as the case at `device-api.test.ts:956` sets them up; noted →
      `POST /api/device/ticket-items/:id/advance` `{ to: "preparing" }` → 507 `storage.disk_full`,
      the item's `state` unchanged. Control → 204 and `preparing`.
  - `schedule-api.test.ts`, a new `describe("while a save refused for a full disk stands")`,
    mounting `mountScheduleApi` as the file's existing cases do, plus `disk`: the same sweep as
    12a's over this app's `/api/` write routes, with an empty literal `EXPECTED_OPEN`, so every one
    answers 507 `storage.disk_full`; control with nothing noted: none answers 507 (each gives its
    own refusal, no session).
  - `boot.disk-full-wiring.test.ts`: mock `./device-api.js` and `./schedule-api.js` as the file
    mocks `./till-api.js`, recording deps; `"hands the stop to the kitchen screens' and the
    schedule's routes"`: both recorded deps carry `disk` `toBe` the state `createDiskFullState`
    returned.

- [ ] **Step 2: Run them and watch them fail**

  Run: `pnpm --filter @waitron/server exec vitest run src/device-api.test.ts src/schedule-api.test.ts src/boot.disk-full-wiring.test.ts`
  Expected: the device sweep FAILS listing the kitchen writes, and the schedule sweep listing every
  schedule write; the bump case FAILS with its success status where 507 was expected; the boot case
  FAILS with `disk`
  `undefined`. Controls and the files' existing cases pass.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run them and the suites near them, and watch them pass**

  Run the command of Step 2, then
  `pnpm --filter @waitron/server exec vitest run src/device-levers.test.ts src/boot.test.ts src/boot.failed-start.test.ts src/till-api.disk-full-gate.test.ts`
  — PASS, `Tests` counts shown. `pnpm --filter @waitron/server typecheck` exits 0.
  Then `pnpm --filter @waitron/server exec vitest run --coverage --coverage.include=src/disk-full-gate.ts src/till-api.disk-full-gate.test.ts src/device-api.test.ts src/schedule-api.test.ts`
  and read `disk-full-gate.ts`'s row (98/98/98/95); CI runs the package's coverage.

- [ ] **Step 4b: Prove the device and schedule gates by deletion.** In `mountDeviceApi` replace
  the `mountGatedWhileDiskFull(...)` call with `root.route("/", app);` and run
  `pnpm --filter @waitron/server exec vitest run src/device-api.test.ts`: the device sweep and
  the bump case must FAIL with their success or session status (if one passes, it is not testing
  the gate: STOP). Restore; PASS. Do the same in `mountScheduleApi` with
  `src/schedule-api.test.ts`.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/server/src/device-api.ts apps/server/src/device-levers.ts apps/server/src/schedule-api.ts apps/server/src/boot.ts apps/server/src/device-api.test.ts apps/server/src/schedule-api.test.ts apps/server/src/boot.disk-full-wiring.test.ts
  git commit -s -m "The kitchen screens' and the staff schedule's writes are refused too while a full-disk refusal stands"
  ```

### Task 12c: The four sale routes refuse a new sale while the stop holds, and still answer one already recorded

**Files:**
- Modify: `apps/server/src/till-sale.ts` (`TillSaleDeps`, `:75`; `runPayWorkingOrder`, `:642-752`;
  `runCollectOrder`, `:2058-2164`; `payIntegrated`'s two checks inside P1, placed by Task 5 near
  `:1194` and `:1265`)
- Modify: `apps/server/src/bill-payments.ts` (`BillPaymentDeps`, `:105`; `beginBillPayment`'s stop
  check, placed by Task 7 at `:1078`; `takeBillPayment`, `:1155-1205`)
- Modify: `apps/server/src/till-api.ts` (the deps `/api/sales` and
  `/api/working-orders/:id/collect` pass, `:1766-1767`, `:2660-2661`)
- Modify: `apps/server/src/bill-payments-api.ts` (the cash and manual-card branch, `:236-240`)
- Create: `apps/server/src/till-sales.disk-full.test.ts`
- Modify, only if the settle case moves there (Step 1): `apps/server/src/counter-handover.test.ts`
- Modify, only if Tasks 5 and 7 were built before the plan edit that moved these cases here:
  `apps/server/src/till-pay.disk-full.test.ts` (`"does not refuse a sale that owes nothing"`) and
  `apps/server/src/bill-payments.refuse-before-reader.test.ts` (`"takes cash and Otro datáfono
  while the stop holds"`)

**Interfaces:**
- `disk?: DiskFullState` moves to till-sale.ts's `TillSaleDeps` (`:75`), so `IntegratedPayDeps`
  (`:595`) inherits it, and to `BillPaymentDeps` (`bill-payments.ts:105`), so
  `ReaderBillPaymentDeps` (`:1217`) inherits it; remove the copies Tasks 5 and 7 added.
- `runPayWorkingOrder` (serving `/api/sales` through `runTillSale`, `:2214`) and `runCollectOrder`:
  before `withTransaction`, `const preRead = (await deps.disk?.full()) ?? false;`; **as built (2026-10-21)**,
  `deps.disk !== undefined && deps.disk.since() !== null && (await deps.disk.full())`, the same in
  `payIntegrated`, `takeBillPayment` and `takeReaderBillPayment`: awaiting `full()` with nothing
  noted added an event-loop tick that let another write's transaction overtake a payment's first
  transaction (b6283f6fd); inside, on the
  line after the replay return (`:663-665`; `:2076-2078`),
  `if (preRead || (deps.disk?.noted() ?? false)) refuse…(req.id)` — the same log and
  `diskFullRefusal()` as Tasks 5 and 7 (if each defined its own closure, add one exported
  `refuseForDiskStop(log: Logger | undefined, workingOrderId: string): never` to
  `disk-full-state.ts` and use it here). The unique-violation replay (`:731-751`) is untouched.
- `payIntegrated`: move Task 5's settle-branch check from before `onLive` (`:1194`) to the first
  line inside `if (outstanding !== undefined) {` (`:1181`), before the owes-nothing test (`:1182`);
  move its collect-branch check from after the zero-total return to immediately before
  `if (compareDecimal(order.gross.total, ZERO) === 0)` (`:1241`). Both stay after the replay
  (`:1129-1134`) and the recovery (`:1164-1174`). The check just before the reader is unchanged.
- `beginBillPayment`: Task 7's `if (state === "pending" && refusals.diskFull())` becomes
  `if (refusals.diskFull())`, still after the replay lookup (`:1054-1064`). `takeBillPayment` reads
  `preRead` before its transaction and passes
  `{ diskFull: () => preRead || (deps.disk?.noted() ?? false) }` instead of `() => false`.
- The routes pass `disk: deps.disk`: `/api/sales` and the collect route in the deps they build
  (`till-api.ts:1767`, `:2661`); the bill route as `takeBillPayment({ ...fiscal, disk: deps.disk }, …)`.

- [ ] **Step 1: Write the failing tests** in `till-sales.disk-full.test.ts`, set up as Task 12a's
  gate test (bill venue; a `DiskFullState` per case; setup through `venue.app`, the request under
  test through `venue.appWith({ disk })`). Every refusal asserts 507
  `{ error: { code: "storage.disk_full", params: {} } }`.
  - `"refuses a cash sale while the stop holds, and keeps nothing"`: walk-up `POST /api/sales`, one
    Caña, cash 3.00 → 507; no `working_orders` row with the id, the `sales` count and the series'
    `next_number` unchanged. Control → 200, one more sale.
  - `"refuses an Otro datáfono sale"`: the same with `tender: { method: "card" }` → 507, no
    `payments` row for the id.
  - `"answers a resend of a cash sale already recorded"`: record one (nothing noted), then note and
    resend the same `workingOrderId` → 200 with the first answer's sale, the `sales` count unchanged.
  - `"refuses to collect a placed order, and answers a collect already made"`: a placed order as
    `attendance-kitchen-service.test.ts:123-134` makes one (`placeOrder`, then the collect body it
    sends); noted → `POST /api/working-orders/:id/collect` cash → 507, the order still `placed`.
    Nothing noted → 200; then noted, resend → 200, the same sale.
  - `"refuses a bill's cash and Otro datáfono payments, and answers one already taken"`: a bill
    (`tabWith(venue, "Paella")`); noted → a cash contribution (`bill-payments.card.test.ts:98-110`'s
    body) → 507, no `bill_payments` row; a manual card → 507. A cash contribution taken with nothing
    noted, then noted and resent with the same `submissionId` → 200, the same payment id.
  - `"refuses a card sale that owes nothing"`: a walk-up of a product priced 0.00 (created as Task
    5's case creates one) on `POST /api/pay` → 507, `collectCalls` unchanged, no `working_orders`
    row.
  - `"refuses settling an issued order that owes nothing"`: a placed order whose issued invoice is
    credited whole (copy `counter-handover.test.ts`'s local `placed("issued", …)` and
    `creditWholeInvoice`, used at `:395-398`) on `POST /api/pay` → 507, the order still `placed`.
    Control → 200. If copying the setup takes more than about 15 calls, add this case to
    `counter-handover.test.ts` beside its owes-nothing case (`:395` area), as a new `it` that
    builds its own `DiskFullState` and mounts `venue.appWith({ disk })`; name the file in the
    commit.
  - `"still files a card already charged"`: re-run Task 5's case of that name; no new case.
  - `"refuses a cash sale noted while it waits for the write queue"`: Task 5's window-1 wrapper (a
    `full()` that answers `false` and queues a body calling `noteRefused()`) → 507; control → 200.
  - `"sells again once the folder has 16 MiB free"`: noted, stub `FULL_DISK_BYTES` → a cash sale
    → 200 and `disk.noted()` `false`.
  If `till-pay.disk-full.test.ts` holds `"does not refuse a sale that owes nothing"` or
  `bill-payments.refuse-before-reader.test.ts` holds `"takes cash and Otro datáfono while the stop
  holds"` (Tasks 5 and 7 built before the plan edit), change each to expect 507 and nothing written,
  renamed `"refuses a sale that owes nothing while the stop holds"` and `"refuses cash and Otro
  datáfono while the stop holds"`, in a commit of its own whose message begins
  `Changed test checks (A798 slice 3):` and lists each `file:line` with its before and after; they
  pinned decision 4's old default, which the owner's answer removes.

- [ ] **Step 2: Run them and watch them fail**

  Run: `pnpm --filter @waitron/server exec vitest run src/till-sales.disk-full.test.ts`
  Expected: every refusal case FAILS with 200 and a row written (the gate leaves these routes open
  and nothing inside refuses them yet; the 0.00 card sale passes Task 5's checks because they sit
  after its owes-nothing return); the 16 MiB case FAILS on `disk.noted()` (nothing on `/api/sales`
  reads free space yet); the
  resends, the charged-card case and the controls pass before and after.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run them and the sale suites, and watch them pass**

  Run: `pnpm --filter @waitron/server exec vitest run src/till-sales.disk-full.test.ts src/till-pay.disk-full.test.ts src/bill-payments.refuse-before-reader.test.ts src/card-charged-not-recorded.test.ts src/till-sale-integrated.db.test.ts src/till-sale.test.ts src/pay-owing-nothing.test.ts src/counter-handover.test.ts src/bill-payments.test.ts src/bill-payments.card.test.ts src/bill-payments-api.test.ts`
  — PASS, `Tests` counts shown. `pnpm --filter @waitron/server typecheck` exits 0.

- [ ] **Step 5: Prove the sale check by deletion.** Delete the check in `runPayWorkingOrder`; run
  Step 2's command: the cash, Otro datáfono and window cases must FAIL with 200 (if one passes, it
  is not testing this check: STOP). Restore; re-run: PASS.

- [ ] **Step 6: Commit**

  ```bash
  git add apps/server/src/till-sale.ts apps/server/src/bill-payments.ts apps/server/src/till-api.ts apps/server/src/bill-payments-api.ts apps/server/src/disk-full-state.ts apps/server/src/till-sales.disk-full.test.ts
  # and apps/server/src/counter-handover.test.ts if the settle case went there
  git commit -s -m "Every new sale is refused while a full-disk refusal stands; a sale already recorded and a card already charged are still answered"
  ```

### Task 11: Docs and backlog

**Files:**
- Modify: `docs/developers/conventions-data.md` (after "What the store does now", `:2352`)
- Modify: `docs/backlog.md` (`:3896-3900`; the A798-B entry, `:5409-5428`), and the matching area
  files under `docs/backlog/` for any new entry's detail

- [ ] **Step 1: conventions-data.md.** A short section, "A full disk stops the till's writes":
  the store's `onDiskFull` and what it reports (Task 3); the full-disk stop — set by a report or by
  a start under 16 MiB free, cleared by a reading of 16 MiB or more of the venue folder that any
  gated write, sale route or reader payment takes; that while it holds every write the till app
  and the kitchen screens send is refused at one gate per mount, registered route by route because
  a Hono `use` or a sub-app's middleware reaches every route registered after it (M7), with the
  open list and why (decision 4), the sale routes refusing after their replay checks (decision 20),
  and a reader payment checked before, inside and after its first transaction (decision 17);
  `sale.charged_not_recorded` after a charge (Task 7b); that the
  clock refusal is `clock.unusable`, thrown through `FiscalBackend.assertRecordableAt` at the issue
  reading (`issueMoment`) and before the reader. Name the guards and say where each is weaker than
  its name: the boot wiring test checks arguments, not a real full disk on a box; the windows'
  tests drive the stop by hand, not by two tills; the sweep tests list the routes of a mount built
  with test deps, so a route registered only in a configuration they do not build (the demo
  reader's cancel) is gated by construction but never sent; the gate refuses by verb, so a write
  inside a GET still runs, as with the read-only gate; a full-disk refusal with bytes still free
  (inodes exhausted) is noted and then cleared by the next till write's reading, no worse than
  before this slice.
- [ ] **Step 2: backlog.md.**
  - DELETE the entry "With the box's clock before 28-10-2024, a connected card is charged before the
    sale is refused" (`:3896-3900`): this slice finishes it.
  - In A798-B, say slice 3 is finished and parked for the owner in #<this pull request>, that the
    owner chose the design's wider stop on 2026-10-21 (decision 4) and slice 3 builds it, and that
    slice 4 is next.
  - Add one short entry each, in the area of A798-B, for what this slice leaves open, each naming
    its owner slice:
    (a) **slice 6**: till surfaces that still show their own fallback for a full disk — the draft
    save's refusals (`apps/till/src/state/draft-sync.ts`), the unpaid departure's handler, and any
    other write surface decision 12 does not name — which now meet it whenever the stop holds, not
    only when a save does not fit; and the kitchen display's station screen, which shows nothing
    for a refused bump (`apps/till/src/screens/till-station-screen.ts`'s `#advance`), so under the
    stop its tickets do not move and nothing says why;
    (b) **slices 5 and 6**: a noted stop clears only when a till or kitchen screen tries a write and
    reads free space, so on a box nobody writes to the red outlives the freed space unless the
    strip reads `full()` or the free-space watch clears it;
    (c) **slice 8**: corrections, substitutions and voids under a clock before 28-10-2024 still
    answer `fiscal.record_invalid`, as does the setup readiness check;
    (d) **slice 9**: `CORE_ALERTS` (`packages/db/src/alerts.ts:7`) gives the `clock.` prefix to the
    area `fiscal`, while design §4.3 puts `clock.unusable` under "Equipo"; the slice that raises it
    as an alert must settle which wins.
- [ ] **Step 3: Check and commit.** `pnpm exec prettier --file-info docs/backlog.md` prints
  `"ignored": true` (docs/ is not format-checked). Then:

  ```bash
  git add docs/developers/conventions-data.md docs/backlog.md docs/backlog
  git commit -s -m "Docs: a full disk stops the till's writes, and what A798-B slice 3 leaves open"
  ```

---

## Self-review against the spec

- §4.6 item 3 (both checks before the reader refuse while red and under a clock before
  28-10-2024): Tasks 5, 6, 7, with the settle kind added (decision 8), the in-queue windows closed
  (decision 17), and the scope of "red" stated (decision 4).
- §4.6 item 2 (one message for any write, and the sale's own): Tasks 9a-9c, 10, reached by every
  write the stop refuses (Task 12); the sale's own sentence and the after-the-charge one built
  (decisions 10, 18, 19, 24; Task 7b); the surfaces left, the kitchen display's among them, are
  backlog (a), owned by slice 6.
- §4.5 item 1 (the named refusal with today's card advice kept): Tasks 1, 2, 6, 7, 9a, 9b, with the
  date in the sentence (decision 11); the strip, `clock.unusable` as an alert and the email are not
  this slice's (slices 6, 9 and 10).
- §4.6 item 5 (set by the first save that fails; every sale, order, kitchen send and clock-in
  refused; trading back when someone frees space): Tasks 3, 4, 8 set it, with the clearing rule of
  decision 3 and the start reading of decision 2; Tasks 5, 7 and 12a-12c refuse, as the owner chose
  (decision 4), with the open writes of decisions 4 and 20 and Task 12's decisions 21-29.
- §5 (the checks reach the clock rule through the fiscal seat): Task 1's `assertRecordableAt`,
  called from the server (Tasks 2, 6, 7).
- Build plan decision 10 (the dashboard's two `server.internal` readers): Task 10.
- §8 slice 3's risks — fiscal invariants (the settle handlers, and now every sale path's issue
  reading) and a refusal's parameters (`clock.unusable { clockAt, offsetMinutes }`,
  `sale.charged_not_recorded { workingOrderId, reason }`) — are Review focus 1 to 8.
