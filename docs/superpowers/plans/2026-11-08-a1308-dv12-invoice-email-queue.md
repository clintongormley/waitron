# A1308 dv12: invoice email goes through the one mail queue — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`)
> syntax for tracking.

**Goal:** An emailed invoice becomes an `outgoing_mail` row of kind `invoice`, sent by slice 3a's one
sender, and the separate invoice email worker (`apps/server/src/invoice-email-worker.ts`) is
deleted. Every behaviour that worker had stays, including its idle sweep, which ends lapsed print
claims of **every** medium. From this slice an email delivery's claim, lease, due time and attempt
count live on its mail row, so email stops writing `invoice_deliveries`' queue columns; dv13 moves A4
off them too and dv14 drops them for every medium, so the table becomes a record only in one step.

**Why here:** coordinator, 2026-11-08, confirmed by the owner on 2026-11-09: slice 3a does not move invoice email; the devices slice does,
next to the A4 move, so `invoice_deliveries` stops being a queue in one place. Split from dv13 to keep
each pull request under the size cap.

**Spec:** [README](../specs/2026-11-02-rationalisation/README.md) §5 U4, §10 ("The mail queue … reminders
and invoices 7 days"); [jobs.md](../specs/2026-11-02-rationalisation/jobs.md) §2 (the `outgoing_mail`
draft: kind `invoice`, `dedupe_key`, `not_after`); [tables-ordersales.md](../specs/2026-11-02-rationalisation/tables-ordersales.md)
§1.19. Slice 3a-ii's plan ([`2026-11-08-a1308-3a-ii-mail-queue.md`](2026-11-08-a1308-3a-ii-mail-queue.md)) defines the queue API and the sender;
this plan uses its names and does not change them, except one optional member (decision 2). Rules:
[slice rules](2026-11-08-a1308-slice-rules.md). Area order: [dv1](2026-11-08-a1308-dv1-devices-row.md).

**Base:** `main` after dv11 and slice 3a. Lines read at `a086eedfb7`; cites into 3a's code are to its
plan's names. A cite that no longer says what this plan says is a stop (rules §5.1); a cite that only moved is not.

**Owner lands:** no (rules §6). The PDF is rendered by today's unchanged `renderInvoicePdf`
(`apps/server/src/invoice-email.ts:75`) from the recorded sale; no invoice number, series or hashed
value is written.

**Pull request's first line:** "No venue is reset: no table changes. Invoice email now goes through
the mail queue." (If decision 6's assumption fails and the kind CHECK must change, the line is rules
§2's reset line for `core`.)

## Names used from slice 3a (as its plan fixes them)

`enqueueMail(tx, MailRequest)`, `readMail`, `MAIL_LIFETIME_MS` (with `invoice: 604_800_000`, 7 days),
`MailKindOwner<Prepared>` (`kind`, `deliveryRule`, `retryDelaysMs`, `longestWaitMs`, `claim`,
`compose`, `settle`), `ClaimedMail`, `MailMessage`, `MailSettlement`, `runMailPass`, `runMailLoop`,
`startMailSender`, `abandonMailClaims`, `MailPassResult` (`{ processed: false } | { processed: true;
mailId; subjectId }`), and `resolveMailDeliveryIn(tx, ring, config, rule)` with the `"invoice"` rule
(the practice inbox on a dev or Demo box even when a server is saved, else the saved server; today's
`resolveInvoiceEmailDelivery`, `apps/server/src/email-delivery.ts:68-77`). If 3a's merged code uses
other names, use them and list the mapping in the pull request.

## What it builds

- `apps/server/src/invoice-delivery.ts`:
  - `queueInvoiceEmail(tx, delivery: Pick<InvoiceDelivery, "id" | "nextAttemptAt">, now: Date)` —
    `enqueueMail` with `kind: "invoice"`, `dedupeKey: "invoice:<delivery id>"`, `subjectId` the
    delivery, `personId: null`, `notAfter: now + MAIL_LIFETIME_MS.invoice`, `nextAttemptAt` the
    delivery's, and `params: { attempt }` (decision 1). Called after the insert in
    `reserveInvoiceDelivery` (`:41-166`) when the medium is `email` and the row is new and `queued`
    (`attempt: 1`), and after the generation retry's insert (`:399-414`), for the new generation
    (`attempt: n + 1`, where `n` is the attempt the refused row carried).
  - `expireInvoiceEmail(tx, deliveryId, now)` — an email delivery whose mail row expired, whether
    still `queued` or left `sending` (a mail row released at a stepdown and then expired), becomes
    `failed` with `transport_failed`, so the record shows it was not sent, the sale is free for a new
    request (`invoice_deliveries_active_uq` counts `queued` and `sending`), and a person can send it
    again (jobs.md §2); no generation retry.
- `apps/server/src/invoice-email.ts:59-124`: `composeInvoiceEmail({ document, privacy }):
  Promise<MailMessage>` (today's subject, text and PDF attachment exactly, `:74-99`) and
  `invoiceOutcome(outcome): InvoiceDeliveryOutcome` replace `createInvoiceEmailSender` and
  `createRoutedInvoiceEmailSender`. Mapping (decision 5): sent → sent; rejected with
  `serverRefused: true` → `{ failed, transport_failed }`; rejected with `serverRefused: false` →
  `{ unknown, transport_failed }` (today's outcome for a refusal the server did not give, such as a
  TLS failure, `invoice-email.test.ts:287-310`: uncertain, not retried); unknown with
  `email.test_timeout` → `{ unknown, timeout }`; any other unknown → `{ unknown, transport_failed }`.
- `apps/server/src/invoice-mail.ts` (new): `invoiceMail(deps: { holder: string; readDocument;
  readPrivacy?; render? }): MailKindOwner<{ claim: InvoiceDeliveryClaim; delivery: InvoiceDelivery }>`
  with `deliveryRule: "invoice"`, `retryDelaysMs: []` (an invoice retries by delivery generation, as
  today, `invoice-delivery.ts:183-188`, `:399-414`), `longestWaitMs: 600_000` (`LONGEST_RETRY_WAIT_MS`,
  `:185`):
  - `claim` — `startInvoiceEmail(tx, mail.subjectId, now)` (new, in `invoice-delivery.ts`): the
    delivery `queued` → `sending`, guarded on status and medium; it writes **none** of the delivery's
    `claim_token_hash`, `claimed_by`, `claimed_agent_id`, `claimed_at`, `attempts` (decision 1).
    3a-ii requires a claim to be safe to repeat ("a claim the sender releases before sending is
    claimed again later"), so a delivery already `sending` under the same generation is claimed again
    unchanged. Neither `queued` nor that → `null` (the delivery switched to paper,
    `apps/server/src/invoice-delivery-actions.ts:222-232`, or ended). The recipient is the delivery's.
    `prepared` is `{ deliveryId, generation }`.
  - `compose` — one `withTransaction` reading the document then the privacy row (the worker's order,
    `invoice-email-worker.ts:89-92`), `duplicate: delivery.designation === "duplicate"`, then
    `render ?? composeInvoiceEmail`. A throw here ends the mail row `unknown`
    (`mail.compose_failed`, 3a-ii) and the delivery `{ unknown, transport_failed }`, as today's
    worker's catch does (`invoice-email-worker.ts:101-103`; kept by "sanitises a projection failure",
    `invoice-delivery.test.ts:2138`, and "…privacy read failure", `:2214`). The document is read in
    `compose`, not `claim`, so 3a-ii's rule for a throwing claim (settled `rejected` with a fixed
    code) never meets a document-read failure.
  - `settle` — with `prepared`: `settleInvoiceEmail(tx, prepared, invoiceOutcome(outcome), now)`
    (new, decision 3), which applies today's rules (a newer generation makes it history,
    `invoice-delivery.ts:326-336`; an `unknown` stays `unknown` unless sent; a refusal with an attempt
    left inserts the next generation, `:399-414`, its wait from `RETRY_DELAYS_MS[attempt - 1]` and its
    mail row queued with `attempt + 1`) without checking a token on the delivery: the sender matched
    the mail row's claim token in the transaction that records the outcome before calling `settle`;
    `expired`: `expireInvoiceEmail`; abandoned (no `prepared`): the mail row's delivery, if `sending`,
    ends `unknown` with `timeout` and `expired_at` (today's lapse result,
    `invoice-delivery.ts:260-287`).
  - `sweep` (decision 2) — `due`: a plain read, "is any `invoice_deliveries` row `sending` with a
    lapsed claim" (today's `or` branch at `invoice-email-worker.ts:60`; since dv11 a `receipt`
    delivery's lapse reads its job's claim), answering also **the earliest time a current claim will
    lapse**, so the loop wakes then (today's worker runs every half second, `:40-43`; without this a
    claim could turn uncertain up to the loop's 60-second ceiling late); `run`:
    `expireInvoiceDeliveryClaims(tx, now)` (today's call at `:67`).
- **Boot** (`apps/server/src/boot.ts:2417-2505`): `invoiceMail({ holder: tradingContext.nodeId,
  readDocument, readPrivacy })` joins the owners boot hands `startMailSender`; the invoice email
  controller and loop go (`boot.ts:2417-2418`, `:2489-2505`). `expireInvoiceDeliveryClaims(tx, now(),
  true)` at start stays first. `apps/server/src/background-duties.ts:33`, `:44`, `:116-120`, `:227`
  drop `invoiceEmailController` and `invoiceEmailLoop` (3a's mail duty already stops the sender).
- `resolveInvoiceEmailDelivery` (`email-delivery.ts:68-77`) becomes
  `withTransaction(db, (tx) => resolveMailDeliveryIn(tx, ring, config, "invoice"))` if 3a has not
  already done so; invoice mail to the practice inbox on Demo and dev boxes is kept.
- `apps/server/src/invoice-email-worker.ts` is deleted.

## Decisions this plan makes

1. **Email's queue facts move to the mail row now; the delivery's columns are dropped in dv14.**
   - *Due time:* the mail row's `next_attempt_at` decides (a retry generation's row gets `now +
     RETRY_DELAYS_MS[n - 1]`, `invoice-delivery.ts:183-188`, `:413`); the delivery's own
     `next_attempt_at` is still written as today but nothing reads it for email.
   - *Claim and lease:* the mail row's `claim_token` and `claimed_at` (3a); a lapse is 3a's
     `mail.claim_abandoned`, which settles as above.
   - *Attempt count* (coordinator's decision, 2026-11-08): the generation retry today stops at
     `attempts >= 5` and picks its wait from `attempts` (`:403`, `:413`). `attempts` leaves the
     delivery in dv14 (`tables-ordersales.md` §1.19), so the attempt number travels on the mail row as
     `params.attempt`: 1 for a person's request, `n + 1` for the automatic retry's new generation.
     (`made_by_retry` cannot serve: it marks a **person's** resend, `packages/db/src/schema/invoice-deliveries.ts:75`,
     written only by `apps/server/src/invoice-delivery-actions.ts:178`; the automatic retry insert
     never sets it.) The delivery's `attempts` is still written in this slice as today, so the kept
     assertions that read it (`{ status: "queued", attempts: 1 }`, then `attempts: 2` on generation 2,
     `invoice-delivery.test.ts:2452-2472`) still pass; from dv14 the test helpers read
     `params.attempt` instead.
   - `claimInvoiceDelivery` keeps serving A4 until dv13.
2. **One optional member on `MailKindOwner`, `sweep`** (signature at the end of this decision). The old worker's pass expired lapsed print
   claims of every medium even when no email was due (`invoice-email-worker.ts:60`, `:67`), and the
   alert for an A4 invoice whose agent stopped renewing depends on it
   (`alert-sources.invoice-delivery.test.ts:652-694`). In `runMailPass`'s first plain read, an owner
   whose `sweep.due` answers "due now" counts as work; in the pass's claim transaction (3a-ii's step 3),
   each such owner's `sweep.run` runs before rows are picked; the loop's next wake is the earliest of
   3a-ii's own and every owner's "next lapse" time. The pass result is still `{ processed: false }`
   when a sweep ran and no mail row was claimed. An owner without `sweep` is unchanged, so 3a's other
   kinds need nothing. If 3a's merged sender already has an equivalent hook, use it instead and say
   so. Signature: `sweep?: { due(db: Database, now: Date): Promise<{ now: boolean; nextAt: Date |
   null }>; run(tx: Transaction, now: Date): Promise<void> }`.
3. **The token-checked `reportInvoiceEmailDelivery` stays** for its direct callers: the forged
   token and holder cases (`invoice-delivery.test.ts:1813-1840`), the other call sites in that file
   (`:1503-1900`) and `invoice-customer-data.files.test.ts:131-138`. The mail owner settles through a
   separate function, `settleInvoiceEmail`, sharing the rules (a newer generation, `unknown` kept,
   the generation retry) through one private helper both call. Until dv14 both exist; dv14 decides
   whether the token form can go once the delivery's claim columns do (its plan says).
4. **Assertions that change, by design** (listed in the pull request with these reasons):
   - the six `{ processed: true, deliveryId: X }` lines in `apps/server/src/invoice-delivery.test.ts`
     (`:2191`, `:2194`, `:2197`, `:2451`, `:2467`, `:2557`) become `{ processed: true, mailId:
     expect.any(String), subjectId: X }` (the pass result's shape);
   - `:2100`, `{ processed: false }` after a pass that only ended an abandoned claim, becomes
     `{ processed: true, mailId: null }`: 3a-ii's decision F reports an abandon-only pass as
     processed;
   - `invoice-email.test.ts:275` ("reports a live invoice with no SMTP configuration as a certain
     failure") is deleted: on the queue, a row waits up to 7 days for a server to be set up instead of
     failing at once (3a-ii's `email.unconfigured` rule); its replacement is the sender's own
     unconfigured case;
   - the duty names in `background-duties.test.ts` and `handover-stepdown.test.ts`.
   **These keep their assertions unchanged** (coordinator, 2026-11-08):
   `alert-sources.invoice-delivery.test.ts:652-694`, `invoice-delivery.test.ts:2083-2107` (except
   `:2100`, above) and `:2561-2578`, and "sanitises a projection failure" (`:2138`) and "…privacy
   read failure" (`:2214`); each is re-pointed from `runInvoiceEmailPass` to `runMailPass` with
   `owners: [invoiceMail(…)]` and a `send` fake. Their set-up re-points too: the email cases' `claim`
   helper makes the delivery `sending` with a claimed mail row (its `claimed_at` is what `:2561-2578`
   moves 400 days ahead). Every other `expect` line stays as written.
5. **Refusal outcomes keep today's meaning** (coordinator's decision): only a refusal the mail
   server itself gave is a certain failure; anything else stays uncertain and is not retried.
6. **Assumption: 3a's `outgoing_mail` kind CHECK already lists `invoice`**
 (3a's plan lists it in
   `outgoingMailKinds`, Task 1). If the merged 3a left it out, this slice adds it, rebuilds core, and
   predicts `changed table outgoing_mail.checks[outgoing_mail_kind_ck].expression` under all six
   headers; that is a stop to confirm first (rules §5.2).

## What it leaves out

| Left out | Who takes it |
| --- | --- |
| Dropping `invoice_deliveries`' `attempts`, `next_attempt_at`, claim, lease and hold columns | dv14 |
| How long finished mail rows stay | A980 (README §10, "Left to other designs") |

## Files

**Create:** `apps/server/src/invoice-mail.ts`, `apps/server/src/invoice-mail.test.ts`.

**Modify:** `apps/server/src/invoice-delivery.ts`, `invoice-email.ts:59-124`, `email-delivery.ts:68-77`
(if 3a left it), `boot.ts:2417-2505`, `background-duties.ts:33`, `:44`, `:116-120`, `:227`,
`mail-sender.ts` (3a's; decision 2), `docs/developers/conventions-data.md:4719` (the invoice row:
the email worker becomes the mail sender's invoice owner and its sweep).
Tests re-pointed (set-up and the lines in decision 4 only): `apps/server/src/invoice-delivery.test.ts`
(the "invoice email worker pass" describe, `:1909-2578`, and the idle case at `:2580`),
`invoice-email.test.ts`, `till-api.deliveries.test.ts:1631`, `alert-sources.invoice-delivery.test.ts:652-694`,
`boot.zone-admission.test.ts:42`, `:90-92`, `:117`, `:328`, `boot.invoice-delivery.test.ts` (seeds),
`background-duties.test.ts`, `handover-stepdown.test.ts`.

**Delete:** `apps/server/src/invoice-email-worker.ts` (108 lines, uncounted).

## Size

| Counted | Lines |
| --- | --- |
| Code: `invoice-mail.ts` 90, `invoice-delivery.ts` 100 (start, settle path and shared helper, attempt param, expiry), `invoice-email.ts` 45, sender's sweep hook with next-lapse wake 35, boot and duties 20 | ~290 |
| Tests: new `invoice-mail.test.ts` 210 (owner, sweep, attempts, outcomes), re-pointed worker cases 220 | ~430 |
| Docs | ~5 |
| **Total** | **~725** |

Not counted: the deleted worker and the two sender builders. About 2½ hours.

## Finish line

```bash
pnpm --filter @waitron/server exec vitest run src/invoice-mail.test.ts src/mail-sender.test.ts src/invoice-delivery.test.ts src/invoice-email.test.ts src/till-api.deliveries.test.ts src/alert-sources.invoice-delivery.test.ts src/boot.invoice-delivery.test.ts src/boot.zone-admission.test.ts src/background-duties.test.ts src/handover-stepdown.test.ts src/boot.restricted-quiet.test.ts
pnpm --filter @waitron/server typecheck
git grep -n "runInvoiceEmail\|createRoutedInvoiceEmailSender\|createInvoiceEmailSender\|invoiceEmailController\|invoiceEmailLoop\|invoice-email-worker" -- apps packages scripts
```

The grep prints nothing. Manual, on a dev stack (`wa-wt reset demo <worktree>`, then `wa-wt demo
<worktree>`): email a full invoice from the order dialog; within a few seconds it is in **Email inbox**
and the order shows it sent.

## Expected protection-list difference

None: `compare` prints `EQUAL` (decision 6's exception aside). Run before and after (rules §3).

## Stop points (beyond rules §5)

1. A case in decision 4's "keep" list can pass only with a changed assertion.
2. 3a's merged sender cannot take the sweep hook without changing a fixed signature.
3. An idle pass now joins a write turn (the idle case at `invoice-delivery.test.ts:2580` and 3a's
   "an idle pass joins no write turn"): the sweep's `due` must be a plain read.

## Needs

dv11 (the receipt lapse rule the sweep now covers), slice 3a (the queue, the sender, the router).

## In-flight work folded in (rules §8)

- **Slice 3a** (reworked by the coordinator, 2026-11-08): it builds the queue, the sender and the
  router without invoice email; this plan is invoice email's move.
- **A987** (sender naming, account delivery details) touches `email-delivery.ts`; rebase on it.

---

### Task 0: base protection list

- [ ] `pnpm protection-list list --out <empty absolute dir A>` in a throwaway worktree of the base.

### Task 1: the sweep hook

- [ ] **Step 1: failing cases** in `mail-sender.test.ts`: "an owner's sweep runs on a pass with no
  due mail, and the pass reports nothing processed"; "a sweep that has nothing to do joins no write
  turn" (the shape of 3a's idle case); "an owner without a sweep is not asked". Run: FAIL.
- [ ] **Step 2:** implement decision 2 in `mail-sender.ts`. Run: PASS. Commit.

### Task 2: the invoice owner

- [ ] **Step 1: failing tests** `invoice-mail.test.ts`: "a queued email delivery is sent through the
  queue with today's subject, text and PDF" (render captured); "a delivery switched to paper is
  cancelled, not sent"; "a refused send records the delivery failed and queues the next generation
  as today, and its mail row" (two `outgoing_mail` rows, keys `invoice:<first>`, `invoice:<second>`);
  "a timeout is recorded unknown with timeout and never resent"; "a mail past its 7 days expires
  unsent and the delivery is failed with transport_failed"; "an abandoned claim at start ends the
  delivery unknown"; "the sweep ends a lapsed A4 claim and a lapsed receipt job claim on a pass with
  no mail due"; "the attempt number travels on the mail row" (four refusals in a row, then a
  person's new request: each mail row's `params.attempt` equals the delivery's `attempts` column at
  every generation, the fifth refusal queues no sixth generation, and the person's request starts at
  1); "an email claim writes none of the delivery's claim columns"; "a refusal the server did not give
  is recorded unknown and not retried"; "a mail row released and then expired frees the sale: its
  delivery ends failed"; "the sweep's next-lapse time wakes the loop when a claim lapses" (a
  `startMailSender` with `maxTickMs: 60_000`: a lapsed A4 claim turns unknown within 2 s of its lease).
  Run: FAIL.
- [ ] **Step 2:** implement `queueInvoiceEmail`, `expireInvoiceEmail`, `composeInvoiceEmail`,
  `invoiceOutcome`, `invoiceMail`. Run: PASS. Commit.

### Task 3: boot, delete the worker, re-point the tests

- [ ] **Step 1:** re-point the tests listed under Files (decision 4).
- [ ] **Step 2:** boot and duties; delete `invoice-email-worker.ts`; the router line. Run the finish
  line: PASS (stops 1–3). Commit.

### Task 4: docs, protection list, finish

- [ ] The clock-step row. Protection list after; `compare` prints `EQUAL`. The manual check on a dev
  stack. Commit; `/finish-branch`.
