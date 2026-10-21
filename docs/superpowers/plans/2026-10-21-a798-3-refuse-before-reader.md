# A798-B slice 3 — refuse before the card reader, and name the two red refusals

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
> cases, and the test doubles it touches gain a method (setup, not an assertion). Any assertion
> that turns out to need changing is a STOP: report it, do not edit it.
>
> **Size.** Each task is sized for one implementer well under 100 tool calls. An implementer past
> about 150 calls with the task unfinished stops at a passing or cleanly red point, commits, and
> returns a handover: done, left, files, each check's state.
>
> Every `file:line` below was read at `main` `c416ec2bb` on 2026-10-21 (the worktree
> `waitron-feat-a798-3-refuse-before-reader`, branch `feat/a798-3-refuse-before-reader`). Every
> claim about how the box behaves today cites a probe in "Measured for this plan", run that day on
> macOS, Node v26.11.1, `node:sqlite`, from scratch files under
> `~/waitron-campaign-b/a798-3-plan-probe/`, outside the repository. A claim marked **(read)** comes
> from reading code, not from running it.

**Words used in this plan.**
- A **connected card reader** is a card machine the box talks to (`provider.collect`). The other
  card path, "Otro datáfono", is a card typed on a machine the box does not talk to; staff charge it
  first and then record it.
- The **two checks before the reader** are the points in the two card-reader routes after which
  the reader is asked to charge: `payIntegrated` for `POST /api/pay`
  (`apps/server/src/till-sale.ts:1105`) and `beginBillPayment` for a card on a bill
  (`apps/server/src/bill-payments.ts:1037`).
- The **full-disk stop** is what design §4.6 item 5 calls the red state for the disk: once a write
  has been refused because the disk is full, the box refuses card-reader payments until it reads
  enough free space again. This plan builds it; nothing before it did.
- The **minimum date** is 28-10-2024, the first invoice date AEAT accepts. The fiscal library
  `@waitron/verifactu` refuses an earlier one (`validate.js:610-611` in its 0.2.1 build).

**Goal:** no connected card is charged for a sale the box will not record — neither after a write
has failed because the disk is full, nor under a clock before 28-10-2024 — and the till says which
of the two stopped it, in words staff can act on.

**Architecture:** four pieces.
1. The Veri\*Factu module learns to judge a clock reading against the minimum date
   (`refuseBeforeFirstIssueDate`, new `packages/fiscal-verifactu/src/first-issue-date.ts`) and
   offers that judgement through the fiscal seat: `FiscalBackend` gains `assertRecordableAt(reading)`
   (`packages/fiscal/src/backend.ts:171`). It throws a new code, `clock.unusable`, carrying the
   reading (`clockAt`). The Veri\*Factu backend's own `recordSale` calls it first, so every sale it
   files under such a clock is refused by name before anything is written.
2. The store (`packages/store`) tells listeners each time the engine refuses a write because the
   disk is full (`onDiskFull`, beside `onCommit`).
3. The server keeps the full-disk stop in memory (`apps/server/src/disk-full-state.ts`): the store's
   report sets it; a free-space reading of the venue folder of at least 16 MiB clears it.
4. The two checks before the reader ask both: the clock (through the seat) and the stop. The till
   gives `storage.disk_full` and `clock.unusable` their own sentences; the dashboard gives
   `storage.disk_full` and `clock.unusable` one each.

**Tech stack:** TypeScript, Node v26.11.1, `node:sqlite` behind drizzle (`packages/store`), Hono
(`apps/server`), Lit (`apps/till`, `apps/dashboard`), Vitest 4.1.11 (browser mode for the till and
the dashboard).

**Spec:** [A798 — Degraded but trading](../specs/2026-10-19-a798-degraded-trading-design.md),
revision 6: §2.4, §2.5, §2.6, §3 ("No card is charged while the line is crossed"), §4.5 item 1,
§4.6 items 2, 3 and 5, §5, §6 default 1, §8 slice 3, §11 item 4. Build plan:
[2026-10-21-a798-b-degraded-trading-build.md](2026-10-21-a798-b-degraded-trading-build.md) Part 1
(slice 3: FULL review path, no migration, parked by default, depends on slice 1, landed as #1936)
and Part 2 decisions 10 and 17. Slice 2 (#1941) also landed; this plan reuses its
`FULL_DISK_BYTES` (`apps/server/src/boot-failure.ts:47`). Backlog: A798-B (`docs/backlog.md:5384`)
and the clock entry under "Payments and card readers" (`docs/backlog.md:3870-3874`).

**Lane note:** one open pull request touches a file this slice changes: #1938 adds one comment line
to `apps/server/src/till-sale.ts` at `:264` (`ReceiptAdjustment`), far from the lines below (read:
`gh pr diff 1938`). The other open one, #1939, touches none of this slice's files (read: its file
list).

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
  recovery path (`kind: "recover"`, `till-sale.ts:1157-1173`) files the captured card without
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

**Not measured:**
- No probe ran on Linux or on a box. The stop's clearing reads `statfs`; slice 2's F1 measured
  `freeBytes` reading 0 on HFS+, Linux tmpfs and Linux ext4 when full, and about 1.2 MB on APFS.
- A real full disk through the card routes was not run; M2 and M3 used the page-limit stand-in,
  whose free-space reading is the real disk's (plenty), which is why the tests below set free space
  through an injected `statfs` (reasoned, not run).

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
2. **Where it lives: in the server's memory, one per venue folder, made at start.** DEFAULT:
   `createDiskFullState` in `boot.ts`, listening to `store.venue` and `store.node`. A restart forgets
   it: the first card payment after a restart on a disk that is still full can be charged and its
   sale refused, as today (M2). Slice 2's start already deletes leftovers below 256 MiB free;
   reading free space at start, and the free-space watch, are slice 5's (design §4.6 item 4).
3. **What clears it: a free-space reading of the venue folder of at least `FULL_DISK_BYTES`
   (16 MiB).** The design says "Trading comes back only when someone frees space" without saying
   how the box knows. A later successful write cannot be the sign: M2 shows small writes succeed
   after a big one failed. DEFAULT: while a refusal is noted, each card-reader payment reads
   `freeBytes(venueDir)` (`apps/server/src/free-bytes.ts:6-15`) before its first transaction; at
   16 MiB or more the stop is forgotten and the payment goes on. 16 MiB is slice 2's line between
   "full" and "not full" (`boot-failure.ts:47`): every full-disk failure it measured had at most
   48 KiB free on HFS+, tmpfs and ext4, and about 1.2 MB reported free on APFS. A reading of `null`
   (the filesystem cannot say) keeps the stop. When nothing is noted, nothing is read. Deferred:
   the strip (slice 6), the Box status row and Liberar (slice 7), the minute-by-minute watch and its
   alerts (slice 5).
4. **What the stop refuses: only a payment that would ask a connected card reader next.** The
   design's §4.6 item 5 says every sale, order, kitchen send and clock-in is refused with the
   message of item 2; §6 default 1 says "Keep selling whenever the record can be written", and M2
   shows small writes can be written after a big one failed. DEFAULT: the stop refuses `POST
   /api/pay` when it is about to ask the reader (a new or open order — "collect" — and a placed
   order whose invoice is already filed — "settle") and a reader payment on a bill. Every other
   write tries and either succeeds or fails on its own with `storage.disk_full`, which the till now
   names (Task 9). Not refused by the stop: cash, "Otro datáfono", a sale that owes nothing, a
   replay of a payment already taken, and the recovery of a card already charged (`kind:
   "recover"`/`"recover-settle"`, which never asks the reader, M3).
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
   so a regime added later has to decide.
6. **Where the clock check runs: the two checks before the reader, and the Veri\*Factu backend's
   own `recordSale`.** DEFAULT: `VerifactuBackend.recordSale` calls `refuseBeforeFirstIssueDate`
   first (`packages/fiscal-verifactu/src/backend.ts:206`), so a cash sale, a placed order, a bill
   completed by cash and a card already charged (P3) are all refused by name, with nothing written.
   Not inside `selectOrderInvoice`, which also runs when an order is created (M5). Corrections,
   substitutions and voids keep today's refusal (`fiscal.record_invalid` from the chain,
   `chain.ts:187-197`, which this slice does not edit); slice 8 stops every money route under a
   clock behind the last sale.
7. **The clock check applies to every bill payment; the stop only to a reader payment on a bill.**
   `beginBillPayment` is shared by cash, "Otro datáfono" and reader payments
   (`bill-payments.ts:1164`, `:1342`). Under a clock before the minimum date no bill can be
   completed (M1), and a part payment taken now is dated by the wrong clock. DEFAULT: every bill
   payment is refused `clock.unusable` before anything is written; the stop's refusal applies only
   when `state === "pending"` (the reader).
8. **The settle kind gets the stop but not the clock check.** A placed order whose invoice is
   already filed writes no new record when paid (`finalizeSettle`, `till-sale.ts:1866-1923`, calls
   `settleSale` and never `recordSale`; read), so
   the minimum date does not refuse it; slice 8 refuses it under a clock behind the last sale.
9. **The minimum date is a constant in `packages/fiscal-verifactu`, pinned by a test against the
   library.** The library exports none (M5). DEFAULT: `FIRST_ISSUE_DAY = 20241028` compared with
   the reading's date in its own offset (M4), and a test that runs the library's `validate` on a
   record dated by each boundary reading and requires the same answer, so a library bump that moves
   the date fails it.
10. **One sentence for a full disk, everywhere the till shows a code.** The brief and design §4.6
    item 2 give "No se ha guardado: el equipo no tiene espacio en disco. Avisa al encargado." / "Not
    saved: the box is out of disk space. Tell a manager." DEFAULT: that sentence for
    `storage.disk_full` in the till's code table, also for a sale. Not built: §3's sale-only
    sentence ("Venta no registrada: … No cobres hasta que se resuelva") and its after-the-charge one
    ("Cobrado con tarjeta, pero la venta no se ha registrado … No vuelvas a cobrar"). The second needs
    the server to tell the till that a card was charged when the sale then failed — a new answer
    shape for `/api/pay`. Meanwhile "Not saved … Tell a manager" is safe to act on: Pay again on the
    same order files it without a second charge (M3). Both become backlog entries (Task 11).
11. **The clock sentence carries no date.** Design §3 shows "(marca 01/01/2001)". DEFAULT: one
    fixed sentence per surface, so every surface that shows a code through the till's code table —
    the pay card, the presented bill's sheet, the bill pay dialog — says the same thing:
    "Venta no registrada: la hora del equipo es incorrecta. Avisa al encargado. Si ya has cobrado con
    tarjeta en el datáfono, devuelve el importe ahí." / "Sale not recorded: the box's clock is wrong.
    Tell a manager. If you already charged a card on the terminal, refund it there." The card advice
    is today's, word for word (`apps/till/src/i18n/strings.ts:1350`, `:3041`). `clockAt` still travels
    for the log. Placing an order, which takes no money, gets its own sentence without card advice,
    as `place.refused` does today (`strings.ts:1379-1381`): "Pedido no registrado: la hora del equipo
    es incorrecta. Avisa al encargado." / "Order not recorded: the box's clock is wrong. Tell a
    manager."
12. **Which till surfaces name the two refusals.** DEFAULT: the money handlers that today choose
    `sale.refused`/`sale.error` (`#onConfirmPayment` `:5984`, `#collectCard` `:6112`,
    `#onPlaceOrder` `:6935`, `#onCollectOrder` `:7033`, `#onFindBillPay` `:7665`, and
    `wholeTabErrorOf` `:588` for the presented bill's sheet), every caller of `counterError` (`:865`;
    both codes join `ACTIONABLE_REFUSALS`, `:798`), and every surface that shows a server code
    through `codeMessage` (the bill pay dialog's `refusalText`,
    `apps/till/src/widgets/pay-refusal.ts:36-68`). Other refusal mappers (`tableWriteError`,
    `lineWriteError`, draft and discard refusals) keep their own fallbacks: a backlog entry.
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
    `fiscal.record_invalid` (`apps/server/src/till-api.ts:446`); a route whose table does not name
    it answers the boundary's default `400`. `storage.disk_full` keeps the boundary's `507`
    (`packages/server-kit/src/error-boundary.ts:34-39`), the server's own refusal before the reader
    included.
15. **No guide changes.** No guide page covers taking a payment (M5). A screen's behaviour changes
    only in which sentence a refusal shows.
16. **Parked for the owner (the build plan's decision 17).** The owner's rule parks a pull request
    that changes invoices, the Veri\*Factu record chain or its hashes, invoice series or numbering,
    or AEAT filing.
    - *For landing it itself:* it changes no invoice's content, no record, hash or chain link, no
      series or number, and nothing about filing; `chain.ts`, the golden fingerprint test and the
      immutability test are untouched. Under a clock before the minimum date every sale it refuses
      was already refused, after the card was charged (M1). The only sales it refuses that would
      otherwise be issued are card-reader sales while the full-disk stop holds.
    - *For parking it:* that last refusal is real (M2: a 1-line card sale succeeded after a 20-line
      one failed, and under the stop it would be refused), it touches the sale path in the Veri\*Factu
      backend (`recordSale`) and the settle handlers, and it moves part payments on a bill under a
      wrong clock from accepted to refused (M1).
    DEFAULT: park, finished to green. The owner can say "land it".

**Questions for the owner (the default is built if unanswered):** none beyond decision 16.

---

## Behaviour this slice removes

Run at `c416ec2bb`, M5's second search found no existing test pinning any of these, so no existing
assertion should change. If one does, it belongs to this list.

- Under a clock before 28-10-2024, a connected card charged before the sale is refused, on
  `POST /api/pay` (M1: `collect calls 1`, then `409 fiscal.record_invalid`) and on a bill's
  completing card (M1: `collect 1`, then `409`).
- Under such a clock, a part payment on a bill (cash, "Otro datáfono" or a reader) accepted with the
  wrong date (M1: `200 received`).
- Under such a clock, a sale filed through the Veri\*Factu backend answering
  `fiscal.record_invalid {"fields":["FechaExpedicionFactura"],"codes":["FECHA_EXPEDICION_BEFORE_MINIMUM"]}`
  (M1); it now answers `clock.unusable { clockAt }`, before anything is written.
- After a write failed because the disk was full, card-reader sales charged and then refused,
  one after another (M2), until the stop is cleared by a free-space reading.
- The till showing "This sale cannot be filed with the tax agency … the venue's invoice settings need
  fixing" for a wrong clock (design §2.5), and its generic retry sentence for a full disk (build
  plan decision 10).
- The dashboard's stuck-payments check and translations dialog showing the generic "Something went
  wrong, try again" for a full disk.

---

## Global constraints

- Every commit `git commit -s`. Never `--no-verify`. Work in this worktree only.
- **No migration.** No change to `packages/fiscal-verifactu/src/chain.ts`, to anything that builds a
  record or its fingerprint, to invoice series or numbering, or to filing. The golden fingerprint
  test (`packages/fiscal-verifactu/src/write-path.e2e.test.ts`) and the immutability test
  (`packages/fiscal-verifactu/src/inmutabilidad.test.ts`) must pass **unedited**; Task 2 runs both.
- One new error code: `clock.unusable`, in the Veri\*Factu registry
  (`packages/fiscal-verifactu/src/errors.ts`). `storage.disk_full` is slice 1's
  (`packages/shared/src/errors.ts:60`). New log events are plain names, not `AppError` codes:
  `storage.disk_full_noted`, `storage.disk_space_back`.
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
   attempt mark, no attendance row, no `bill_payments` row (Tasks 5, 6, 7).
2. **Nothing that should go on is refused.** A recovery of a card already charged, a replay, cash,
   "Otro datáfono" and a sale that owes nothing are not refused by the stop; a sale at 00:00 local
   on 28-10-2024 is not refused by the clock (Tasks 5, 6, 7; Task 1's boundary).
3. **The date is judged as the record would be.** The check reads the reading's own offset and
   agrees with the library on both sides of the boundary (Task 1). The pre-reader check reads the
   clock at P1 and the record at P3; a clock that moves back between them is caught at P3 by the
   backend's own check (Task 2), as design §3 accepts.
4. **The stop's lifecycle.** Set by the store's report only; cleared only by a reading at or above
   16 MiB; a `null` reading keeps it; no reading while nothing is noted (Task 4). The store reports
   an engine refusal with code 13 once, and not a refusal with any other code; a listener that throws
   changes nothing the caller sees (Task 3).
5. **The seat.** `assertRecordableAt` is required on `FiscalBackend`; the none backend and the fake
   return; only the Veri\*Factu backend refuses (Tasks 1, 2).
6. **Boot wiring.** The stop listens to both of the venue folder's files and reaches both card
   routes; a refused start does not leave a listener behind (Task 8).

---

### Task 1: The minimum date as the Veri\*Factu module's rule, offered through the fiscal seat

**Files:**
- Modify: `packages/fiscal/src/backend.ts` (`FiscalBackend`, `:171-245`)
- Modify: `packages/fiscal/src/testing/fake-backend.ts` (`FakeFiscalBackend`, `:43`)
- Modify: `packages/fiscal-none/src/backend.ts` (`NoneBackend`, `:26`), and its test
  `packages/fiscal-none/src/backend.test.ts`
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
- `FakeFiscalBackend.assertRecordableAt` and `NoneBackend.assertRecordableAt` return.

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
  - In `packages/fiscal-none/src/backend.test.ts`: `"refuses no clock: a venue with no regime has no first date"`:
    `new NoneBackend().assertRecordableAt({ instant: new Date("2001-01-01T11:00:00Z"), offsetMinutes: 60 })`
    returns `undefined` and does not throw.

- [ ] **Step 2: Run them and watch them fail**

  Run: `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/first-issue-date.test.ts` and
  `pnpm --filter @waitron/fiscal-none exec vitest run src/backend.test.ts`.
  Expected: the first FAILS to import `./first-issue-date.js`; the none case FAILS with
  `assertRecordableAt is not a function`.

- [ ] **Step 3: Implement** the interface member, the registry entry, `first-issue-date.ts`, and the
  none and fake members. Do not touch `VerifactuBackend` yet (Task 2).

- [ ] **Step 4: Run them and watch them pass; typecheck every dependant**

  Run the two commands of Step 2: PASS, with `Tests` counts that include the new cases. Then
  `pnpm --filter "...@waitron/fiscal" typecheck` (the package and every workspace package that
  depends on it). `VerifactuBackend` fails it (`assertRecordableAt` missing) — expected, Task 2
  adds it — and so does each hand-built backend in the Files list: add the member to each of THOSE
  and re-run until `VerifactuBackend` is the only error left. `{} as FiscalBackend` stubs compile
  either way; Task 5 meets any that reach the new call.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/fiscal packages/fiscal-none packages/fiscal-verifactu/src/first-issue-date.ts packages/fiscal-verifactu/src/first-issue-date.test.ts packages/fiscal-verifactu/src/errors.ts packages/core/src apps/server/src/served-at-huella.test.ts
  git commit -s -m "The fiscal seat can say a clock reading is too early to record, and Veri*Factu knows its first day"
  ```

### Task 2: The Veri\*Factu backend refuses a sale under such a clock before it writes anything

**Files:**
- Modify: `packages/fiscal-verifactu/src/backend.ts` (`VerifactuBackend`, `:156`; `recordSale`,
  `:206-260`)
- Test: `packages/fiscal-verifactu/src/backend.test.ts` (or a new `backend.first-issue-date.test.ts`
  beside it, with the `useVenueDb` setup `chain.record-validation.test.ts:1-46` uses)

**Interfaces:**
- `VerifactuBackend.assertRecordableAt(reading)` calls `refuseBeforeFirstIssueDate(reading)`.
- `VerifactuBackend.recordSale` calls
  `refuseBeforeFirstIssueDate({ instant: sale.issuedAt, offsetMinutes: sale.offsetMinutes })` as its
  first statement, before `currentSif`. `sale.issuedAt`/`offsetMinutes` are the one reading the sale
  row and its record carry (`backend.ts:203-205`, "Reads NO clock of its own").

- [ ] **Step 1: Write the failing tests**, driving `recordSale` from `@waitron/core` through the
  real backend on a real database, as `chain.record-validation.test.ts:42-46` does, with the sale's
  clock set by the test (a `TrustedClock` whose `now()` returns a fixed `{ instant, offsetMinutes }`):
  - `"refuses a sale under a clock before 28-10-2024, naming the clock, and writes nothing"`: clock
    `2001-01-01T11:00:00.000Z`, +60. Rejects `{ code: "clock.unusable", params: { clockAt: "2001-01-01T11:00:00.000Z" } }`;
    `registros_facturacion`, `sales` and `envios` are empty; the node's `cadenas.secuencia` is still 0;
    the series' `next_number` is unchanged (read before and after).
  - Control `"records the same sale under a clock on 28-10-2024"`: clock
    `2024-10-27T23:00:00.000Z`, +60 → resolves; one record.
  - `"assertRecordableAt refuses the same readings recordSale refuses"`: 2001 rejects
    `clock.unusable`; the 28-10-2024 reading returns.

- [ ] **Step 2: Run them and watch them fail**

  Run: `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/backend.test.ts` (or the new file).
  Expected: the 2001 case FAILS with `fiscal.record_invalid` where `clock.unusable` was expected
  (M1 printed that code for this cause); the `assertRecordableAt` case FAILS, not a function. The
  control passes before and after.

- [ ] **Step 3: Implement** the two calls.

- [ ] **Step 4: Run the package and the two fiscal guards, unedited**

  Run: `pnpm --filter @waitron/fiscal-verifactu exec vitest run` — PASS, every file, `Tests` count
  shown; `write-path.e2e.test.ts` and `inmutabilidad.test.ts` among them, unedited
  (`git diff --stat main -- packages/fiscal-verifactu/src/write-path.e2e.test.ts packages/fiscal-verifactu/src/inmutabilidad.test.ts`
  prints nothing). Then `pnpm --filter @waitron/core exec vitest run` — PASS. Then
  `pnpm --filter "...@waitron/fiscal" typecheck` exits 0.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/fiscal-verifactu/src
  git commit -s -m "A Veri*Factu sale under a clock before 28-10-2024 is refused as clock.unusable before anything is written"
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
  /** Notes on `state` every full-disk refusal any of `stores` reports; returns the unsubscribe. */
  export function watchForDiskFull(
    state: DiskFullState,
    stores: readonly { onDiskFull(listener: () => void): () => void }[],
  ): () => void;
  /** The refusal a card-reader payment gets while the stop holds. */
  export function diskFullRefusal(): AppError<"storage.disk_full">;
  ```
  `noteRefused` logs `("warn", "storage.disk_full_noted", {})` only when nothing was noted;
  `full()` clearing logs `("info", "storage.disk_space_back", { freeBytes })`.
  `diskFullRefusal()` is `new AppError("storage.disk_full", {}, { reason: "a write was refused for a full disk; the card reader is not asked" })`.

- [ ] **Step 1: Write the failing tests** in `disk-full-state.test.ts`, with a `statfs` stub whose
  answer each case sets (`{ bavail, frsize: 1 }` gives `bavail` bytes) and which counts its calls:
  - `"is not full, and reads nothing, until a refusal is noted"`: `full()` → `false`; statfs calls 0;
    `since()` → `null`.
  - `"is full after a refusal while the folder has less than 16 MiB free"`: `noteRefused()`, statfs
    `FULL_DISK_BYTES - 1` → `full()` `true`; `since()` is the injected `now()`.
  - `"forgets the refusal at exactly 16 MiB free, and logs it once"`: statfs `FULL_DISK_BYTES` →
    `full()` `false`, `since()` `null`, one `storage.disk_space_back` log with `freeBytes`; a second
    `full()` reads nothing.
  - `"stays full when the folder's free space cannot be read"`: statfs rejects → `full()` `true`.
  - `"keeps the first time across later refusals, and logs the first only"`: two `noteRefused()` at
    two `now()` values → `since()` is the first; one `storage.disk_full_noted` log.
  - `"notes again after it cleared"`: note, clear, note → `full()` `true` with statfs 0.
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
  git commit -s -m "The server keeps a full-disk stop: set by a refused write, cleared by 16 MiB of free space"
  ```

### Task 5: `POST /api/pay` does not ask the reader while the full-disk stop holds

**Files:**
- Modify: `apps/server/src/till-sale.ts` (`IntegratedPayDeps`, `:594-604`; `payIntegrated`,
  `:1105-1391`)
- Modify: `apps/server/src/till-api.ts` (`TillApiDeps`, `:267-301`; `/api/pay`, `:1778-1835`)
- Modify: `apps/server/src/testing/bill-venue.ts` (add `appWith`)
- Create: `apps/server/src/till-pay.disk-full.test.ts`

**Interfaces:**
- `IntegratedPayDeps` and `TillApiDeps` gain `disk?: DiskFullState`, documented as `pool` is:
  optional only for suites that never reach the reader; a live boot always supplies it (Task 8).
  `/api/pay` passes `disk: deps.disk`.
- `payIntegrated`: before the P1 transaction (`:1115`), `const diskFull = (await deps.disk?.full()) ?? false;`.
  Inside P1, `if (diskFull) throw diskFullRefusal();` at exactly two points:
  - the settle branch, immediately before `if (locked.status === "placed") onLive(PLACED_ATTEMPT);` (`:1193`);
  - the collect branch, after the owes-nothing `return` (`:1240-1259`) and before `issuancePass` (`:1264`).
  Never before the replay (`:1127-1132`) or the recovery (`:1157-1173`) returns.
- `BillVenue.appWith(opts: { clock?: TrustedClock; disk?: DiskFullState }): Hono` — the same routes,
  tips on, with those deps.

- [ ] **Step 1: Write the failing tests** in `till-pay.disk-full.test.ts`, on
  `provisionBillVenue` with a counter zone offering one product, as M1's probe set up
  (`~/waitron-campaign-b/a798-3-plan-probe/srv/clock.test.ts:13-25`). A real
  `createDiskFullState` over a settable `statfs` stub, noted by calling `noteRefused()`, except in
  the last case. Every case reads `venue.card.collectCalls.length` before and after.
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
  - `"does not refuse a sale that owes nothing"`: a zero-total walk-up (an order whose one line is
    comped to zero, or the zero-total fixture the integrated tests use; find it with
    `grep -n "owes-nothing\|ZERO" apps/server/src/till-sale-integrated.db.test.ts`), noted → `200`.
  - End to end, last in the file, `"after a big sale fails on a full database, the next card sale is
    refused before the reader"`: `watchForDiskFull(state, [venue.db])`; fill to the page limit as M2
    did; a 20-line cash `/api/sales` → `507`, `state.since()` not `null`; statfs 0; a 1-line
    `/api/pay` → `507`, collect unchanged (M2 printed `200`, collect 1, for this sale before the
    slice). Then lift the limit (`pragma max_page_count = 4294967294`) and set statfs to
    `FULL_DISK_BYTES` → `200`, collect +1, sale filed. Restore the limit in a `finally`.

- [ ] **Step 2: Run them and watch them fail**

  Run: `pnpm --filter @waitron/server exec vitest run src/till-pay.disk-full.test.ts`
  Expected: the refusal cases FAIL with `200` where `507` was expected and collect +1 (the stop
  does not exist yet; `appWith` passes a `disk` nothing reads); the end-to-end case FAILS the same
  way, M2's answer. The controls, the recovery and the owes-nothing cases pass before and after.

- [ ] **Step 3: Implement** the deps, the read before P1 and the two refusals.

- [ ] **Step 4: Run the card-pay suites and watch them pass**

  Run: `pnpm --filter @waitron/server exec vitest run src/till-pay.disk-full.test.ts src/till-sale-integrated.db.test.ts src/till-api.test.ts src/till-api.fiscal-sale-paths.test.ts`
  — PASS, `Tests` counts shown. A `{} as FiscalBackend` stub never reaches this task's code; if
  one of these files fails with `assertRecordableAt is not a function`, that is Task 6 run early:
  STOP and report.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/server/src/till-sale.ts apps/server/src/till-api.ts apps/server/src/testing/bill-venue.ts apps/server/src/till-pay.disk-full.test.ts
  git commit -s -m "Pay by card refuses before the reader while a write refused for a full disk stands"
  ```

### Task 6: `POST /api/pay` refuses a sale under a clock before 28-10-2024 before the reader

**Files:**
- Modify: `apps/server/src/till-sale.ts` (`payIntegrated`, the collect branch, `:1236-1237`)
- Modify: `apps/server/src/till-api.ts` (the status table, `:446`)
- Create: `apps/server/src/till-pay.clock.test.ts`

**Interfaces:**
- In the collect branch, immediately before the existing `selectOrderInvoice` call at `:1237`
  ("Before the reader is asked: P3 could never file this sale"):
  `deps.backend.assertRecordableAt(deps.clock.now());`. Not in the settle branch (decision 8).
- The till routes' status table gains `"clock.unusable": 409`, beside `"fiscal.record_invalid": 409`.

- [ ] **Step 1: Write the failing tests** in `till-pay.clock.test.ts`, on `provisionBillVenue` and a
  counter zone, the route's clock set with `venue.appAt(clock)` to a `TrustedClock` returning a fixed
  `{ instant, offsetMinutes: 60 }`:
  - `"refuses a walk-up card sale under a clock in 2001, naming the clock, before the reader"`:
    `409 { code: "clock.unusable", params: { clockAt: "2001-01-01T11:00:00.000Z" } }`, collect
    unchanged, no `working_orders` row with the id, no `payments` row (M1 printed `collect 1` and a
    payment row).
  - `"refuses at 23:59:59.999 local on 27-10-2024, and asks the reader at 00:00 local on 28-10-2024"`:
    `2024-10-27T22:59:59.999Z` → `409 clock.unusable`, collect unchanged;
    `2024-10-27T23:00:00.000Z` → `200 captured`, collect +1 (the control).
  - `"refuses a cash sale under such a clock by the same name, writing nothing"`: `/api/sales` at
    2001 → `409 clock.unusable` (Task 2's refusal through the route; M1 printed
    `fiscal.record_invalid`), sales and records unchanged.

- [ ] **Step 2: Run them and watch them fail**

  Run: `pnpm --filter @waitron/server exec vitest run src/till-pay.clock.test.ts`
  Expected: the first FAILS with collect +1 and `409 clock.unusable` arriving only after the charge
  (Task 2 already names the refusal at P3), or with the payment row present; the boundary's first
  half the same; its control passes; the cash case passes (Task 2) — it pins the route's status.

- [ ] **Step 3: Implement** the call and the status entry.

- [ ] **Step 4: Run the card-pay suites and watch them pass**

  Run: `pnpm --filter @waitron/server exec vitest run src/till-pay.clock.test.ts src/till-pay.disk-full.test.ts src/till-sale-integrated.db.test.ts src/till-api.test.ts src/till-api.fiscal-sale-paths.test.ts src/till-sale.test.ts`
  — PASS, `Tests` counts shown. A test whose stub backend (`{} as FiscalBackend`, 13 files: `grep -rln "{} as FiscalBackend\|{} as unknown as FiscalBackend" apps/server/src`)
  now fails with `assertRecordableAt is not a function` gets `assertRecordableAt: () => {}` in its
  stub: setup, not an assertion. Run `pnpm --filter @waitron/server exec vitest run` on those files.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/server/src
  git commit -s -m "Pay by card refuses a sale under a clock before 28-10-2024 before the reader is asked"
  ```

### Task 7: Bill payments: the clock refusal for every payment, the stop for a reader payment

**Files:**
- Modify: `apps/server/src/bill-payments.ts` (`beginBillPayment`, `:1037-1122`; `takeBillPayment`,
  `:1155-1210`; `ReaderBillPaymentDeps`, `:1217`; `takeReaderBillPayment`, `:1332-1419`)
- Modify: `apps/server/src/bill-payments-api.ts` (the reader branch, `:247-270`, passes `disk: deps.disk`)
- Create: `apps/server/src/bill-payments.refuse-before-reader.test.ts`

**Interfaces:**
- `beginBillPayment`'s `now: Date` parameter becomes `reading: { instant: Date; offsetMinutes: number }`
  (both callers pass `deps.clock.now()`); every former use of `now` reads `reading.instant`. It
  gains a last parameter `refusals: { diskFull: boolean }`.
- At the existing `selectOrderInvoice` call (`:1078`), immediately before it:
  `backend.assertRecordableAt(reading);` then
  `if (state === "pending" && refusals.diskFull) throw diskFullRefusal();`. Both run after the
  replay lookup (`:1054-1064`), so a retry of a payment already taken still answers its state.
- `ReaderBillPaymentDeps` gains `disk?: DiskFullState`; `takeReaderBillPayment` reads
  `(await deps.disk?.full()) ?? false` before its first transaction. `takeBillPayment` passes
  `{ diskFull: false }`.

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
  - `"refuses a reader payment under a clock in 2001, before the reader"`: `appWith({ clock })` →
    `409 { code: "clock.unusable", params: { clockAt: "2001-01-01T11:00:00.000Z" } }`, collect
    unchanged, no `bill_payments` row (M1 printed `200 received`, collect 1, for a part payment).
  - `"refuses a cash part payment and a manual card under such a clock"` → `409 clock.unusable`,
    no `bill_payments` row.
  - Control `"takes a reader payment at 00:00 local on 28-10-2024"` → collect +1.

- [ ] **Step 2: Run them and watch them fail**

  Run: `pnpm --filter @waitron/server exec vitest run src/bill-payments.refuse-before-reader.test.ts`
  Expected: the stop's refusal FAILS with `200` and collect +1; the clock cases FAIL with `200
  received` (part payments, M1); the controls, cash-while-stopped and the retry pass before and after.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run the bill suites and watch them pass**

  Run: `pnpm --filter @waitron/server exec vitest run src/bill-payments.refuse-before-reader.test.ts src/bill-payments.card.test.ts src/bill-payments.test.ts src/bill-payments-api.test.ts src/bill-payments.cash-up.test.ts src/bill-payments-loop.test.ts src/adjustments-bill-payments.test.ts`
  — PASS, `Tests` counts shown.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/server/src/bill-payments.ts apps/server/src/bill-payments-api.ts apps/server/src/bill-payments.refuse-before-reader.test.ts
  git commit -s -m "A bill payment is refused under a clock before 28-10-2024, and a reader payment while the full-disk stop holds"
  ```

### Task 8: Boot wires the stop to the venue folder's two files and to the till routes

**Files:**
- Modify: `apps/server/src/boot.ts` (after `const store = await openVenueDatabase(config.venueDir);`,
  `:932-933`; `mountTillApi`, `:1653-1677`)
- Create: `apps/server/src/boot.disk-full-wiring.test.ts`

**Interfaces:**
- After `undoOnFailure.push(() => store.close());`:
  ```ts
  const diskFull = createDiskFullState({ dir: config.venueDir, now, log });
  undoOnFailure.push(watchForDiskFull(diskFull, [store.venue, store.node]));
  ```
  (CLAUDE.md §3: a duty pushes its stop onto `undoOnFailure` as soon as it exists.) `mountTillApi`
  gets `disk: diskFull`.

- [ ] **Step 1: Write the failing test**, in the shape of `boot.clock-wiring.test.ts:1-80`
  (`serverFixture`, `vi.mock` of the module to capture what boot passes):
  - mock `./disk-full-state.js` so `createDiskFullState` and `watchForDiskFull` record their
    arguments and return the real results; mock `./till-api.js` so `mountTillApi` records its deps.
  - `"listens to both of the venue folder's files and hands the stop to the till routes"`: after a
    start, `createDiskFullState` got `dir` equal to the started server's venue folder;
    `watchForDiskFull` got that state and two stores; `mountTillApi`'s deps carry `disk` equal to
    that state.

- [ ] **Step 2: Run it and watch it fail**

  Run: `pnpm --filter @waitron/server exec vitest run src/boot.disk-full-wiring.test.ts`
  Expected: FAILS: `createDiskFullState` was never called.

- [ ] **Step 3: Implement** the two lines and the dep.

- [ ] **Step 4: Run it, and the boot suites near it, and watch them pass**

  Run: `pnpm --filter @waitron/server exec vitest run src/boot.disk-full-wiring.test.ts src/boot.test.ts src/boot.failed-start.test.ts`
  — PASS, `Tests` counts shown. Then `pnpm --filter @waitron/server test:coverage` and read the new
  files' rows: 98/98/98/95.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/server/src/boot.ts apps/server/src/boot.disk-full-wiring.test.ts
  git commit -s -m "The started box watches its database files for a full disk and stops card-reader payments on one"
  ```

### Task 9a: The till names a full disk and a wrong clock on the pay card and the bill sheets

**Files:**
- Modify: `apps/till/src/i18n/codes.ts` (`CODE_MESSAGES`, `:6-756`)
- Modify: `apps/till/src/till-app.ts` (`wholeTabErrorOf`, `:588-600`; `ACTIONABLE_REFUSALS`,
  `:798`; `#onConfirmPayment`, `:6040-6062`; `#collectCard`, `:6190-6215`)
- Test: `apps/till/src/i18n/codes.test.ts`, `apps/till/src/till-app.test.ts` (beside
  `:9936-10060`), `apps/till/src/till-app-handheld-pay.test.ts` (beside `:499-552`),
  `apps/till/src/widgets/presented-pay-dialog.test.ts` (beside `:557`)

**Interfaces:**
- `CODE_MESSAGES` gains, both columns (decisions 10, 11):
  - `"storage.disk_full"`: en "Not saved: the box is out of disk space. Tell a manager." / es "No se
    ha guardado: el equipo no tiene espacio en disco. Avisa al encargado."
  - `"clock.unusable"`: en "Sale not recorded: the box's clock is wrong. Tell a manager. If you
    already charged a card on the terminal, refund it there." / es "Venta no registrada: la hora del
    equipo es incorrecta. Avisa al encargado. Si ya has cobrado con tarjeta en el datáfono, devuelve
    el importe ahí."
- In `till-app.ts`: `function namedRefusalOf(error: unknown): { code: "storage.disk_full" | "clock.unusable" } | undefined`,
  checked FIRST in `wholeTabErrorOf`, `#onConfirmPayment`'s and `#collectCard`'s catch chains; both
  codes join `ACTIONABLE_REFUSALS`, so `counterError` returns `{ code }` for them.

- [ ] **Step 1: Write the failing tests.**
  - `codes.test.ts`: `"names a full disk and a wrong clock in both languages, never the generic sentence"`:
    `codeMessage("storage.disk_full", "es-ES")` and `"en-GB"` equal the sentences above;
    `codeMessage("clock.unusable", …)` likewise; neither equals `codeMessage("server.internal", …)`.
  - `till-app.test.ts`, beside `"a PERMANENT fiscal refusal on a tab pay surfaces sale.refused"`
    (`:9936`) and `"tells a CARD operator what to do about the money already on the terminal"`
    (`:10025`): the counter card pay (`api.pay` rejecting `{ code: "storage.disk_full", status: 507 }`)
    and the counter cash sale (`api.recordSale` rejecting the same) each show
    `codeMessage("storage.disk_full")`; rejecting `{ code: "clock.unusable", clockAt: "2001-01-01T11:00:00.000Z", status: 409 }`
    shows `codeMessage("clock.unusable")`, and NOT `t("sale.refused")`.
  - `till-app-handheld-pay.test.ts`: two rows in the `it.each` at `:538-552` (the presented bill's
    cash send) and a card case beside `:499` (`pay` rejecting each code): the sheet's message is the
    code's sentence.
  - `presented-pay-dialog.test.ts` beside `:557`: a reader payment refused `storage.disk_full` and
    `clock.unusable` shows each code's sentence through `refusalText`.

- [ ] **Step 2: Run them and watch them fail**

  Check `memory_pressure | grep free` first. Run:
  `pnpm --filter @waitron/till exec vitest run src/i18n/codes.test.ts src/till-app.test.ts src/till-app-handheld-pay.test.ts src/widgets/presented-pay-dialog.test.ts`
  Expected: the code-table cases FAIL with the generic sentence; the pay cases FAIL with
  `t("sale.error")` for a full disk and the generic sentence or `t("sale.error")` for the clock; the
  dialog cases FAIL with the generic sentence. The existing `fiscal.record_invalid` → `sale.refused`
  cases pass before and after.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run them and watch them pass**, with the command of Step 2; `Tests` counts shown.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/till/src
  git commit -s -m "The till names a full disk and a wrong clock on the pay card and the bill sheets"
  ```

### Task 9b: The till names them when placing, collecting, paying a found bill, and saving

**Files:**
- Modify: `apps/till/src/i18n/strings.ts` (beside `place.refused`, `:1379-1381` and its Spanish twin)
- Modify: `apps/till/src/till-app.ts` (`#onPlaceOrder`, `:6990-7012`; `#onCollectOrder`,
  `:7045-7060`; `#onFindBillPay`, `:7750-7762`)
- Test: `apps/till/src/till-app.test.ts` (beside `:10540` and `:11376`), and one `counterError`
  caller that is not a payment (parking an order, `#onParkOrder`, `:7964`), in the test file that
  already covers its refusals (`grep -ln "held.park_error" apps/till/src/*.test.ts`)

**Interfaces:**
- `strings.ts` gains `"place.clock_unusable"`: en "Order not recorded: the box's clock is wrong.
  Tell a manager." / es "Pedido no registrado: la hora del equipo es incorrecta. Avisa al
  encargado." (decision 11: placing takes no money, so no card advice.)
- `#onPlaceOrder` shows `"place.clock_unusable"` for `clock.unusable` and `{ code: "storage.disk_full" }`
  for a full disk, ahead of its `place.refused` check; `#onCollectOrder` and `#onFindBillPay` check
  `namedRefusalOf` first.

- [ ] **Step 1: Write the failing tests**: placing refused `clock.unusable` shows
  `t("place.clock_unusable")` and not the card advice; refused `storage.disk_full` shows its
  sentence; collecting an order and paying a found bill refused with each code show the code's
  sentence; parking an order refused `storage.disk_full` shows its sentence instead of
  `t("held.park_error")` (or whatever fallback that handler uses today — read it first and name it
  in the test).

- [ ] **Step 2: Run them and watch them fail** (`memory_pressure` first):
  `pnpm --filter @waitron/till exec vitest run src/till-app.test.ts <the park file>` — each new
  case FAILS with today's fallback key.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run them and watch them pass**; then `pnpm --filter @waitron/till test:coverage`
  and read `till-app.ts`'s and `codes.ts`'s rows.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/till/src
  git commit -s -m "The till names a full disk and a wrong clock when placing, collecting and saving"
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
- Modify: `docs/developers/conventions-data.md` (after "What the store does now", `:2352-2375`)
- Modify: `docs/backlog.md` (`:3870-3874`; the A798-B entry, `:5384-5403`), and the matching area
  files under `docs/backlog/` for any new entry's detail

- [ ] **Step 1: conventions-data.md.** A short section, "Card-reader payments after a full disk":
  the store's `onDiskFull` and what it reports (Task 3); the full-disk stop — set by a report,
  cleared by a reading of 16 MiB or more of the venue folder, forgotten at restart; that it
  refuses only where a connected reader would be asked next, at the two named points (Tasks 5,
  7); and that the clock refusal is `clock.unusable`, thrown through `FiscalBackend.assertRecordableAt`
  and by the Veri\*Factu backend's `recordSale`. Name the guards and say where each is weaker than
  its name (the boot wiring test checks arguments, not a real full disk on a box).
- [ ] **Step 2: backlog.md.**
  - DELETE the entry "With the box's clock before 28-10-2024, a connected card is charged before the
    sale is refused" (`:3870-3874`): this slice finishes it.
  - In A798-B, say slice 3 is finished and parked for the owner in #<this pull request>, slice 4 is
    next, and the full-disk stop is in memory.
  - Add one short entry each, in the area of A798-B, for what this slice leaves open:
    (a) the after-the-charge sentence of design §3 ("Cobrado con tarjeta, pero la venta no se ha
    registrado…"), which needs `/api/pay` to answer that a card was charged when the sale then
    failed; (b) the full-disk stop is forgotten at restart, so the first card-reader sale after a
    restart on a still-full disk can be charged and refused (slice 5's watch is the home);
    (c) refusal mappers in the till that keep their own fallback for a full disk (`tableWriteError`,
    `lineWriteError`, draft and discard refusals), so "any refused save" is not yet one sentence
    everywhere; (d) corrections, substitutions and voids under a clock before 28-10-2024 still answer
    `fiscal.record_invalid` (slice 8 stops money routes under a clock behind the last sale).
- [ ] **Step 3: Check and commit.** `pnpm exec prettier --file-info docs/backlog.md` prints
  `"ignored": true` (docs/ is not format-checked). Then:

  ```bash
  git add docs/developers/conventions-data.md docs/backlog.md docs/backlog
  git commit -s -m "Docs: card-reader payments after a full disk, and what A798-B slice 3 leaves open"
  ```

---

## Self-review against the spec

- §4.6 item 3 (both checks before the reader refuse while red and under a clock before
  28-10-2024): Tasks 5, 6, 7, with the settle kind added (decision 8) and the scope of "red" stated
  (decision 4).
- §4.6 item 2 (one message for any write): Tasks 9a, 9b, 10; the surfaces left are backlog (c).
- §4.5 item 1 (the named refusal with today's card advice kept): Tasks 1, 2, 6, 7, 9a; the date in
  the sentence, the strip, `clock.unusable` as an alert and the email are not this slice's
  (decision 11; slices 6, 9 and 10).
- §4.6 item 5 (set by the first save that fails; trading back when someone frees space): Tasks 3,
  4, 8, with the clearing rule of decision 3.
- §5 (the two checks reach the clock rule through the fiscal seat): Task 1's `assertRecordableAt`.
- Build plan decision 10 (the dashboard's two `server.internal` readers): Task 10.
- §8 slice 3's risks — fiscal invariants (the settle handlers) and a refusal's parameters
  (`clock.unusable { clockAt }`) — are Review focus 1 to 5.
