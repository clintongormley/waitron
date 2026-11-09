# A1308 slice 3a-i — one SMTP transport that knows whether the server got the message — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Slice 3a is three pull requests, built in order by lane 2:

| PR | Plan | What | Counted lines |
| --- | --- | --- | --- |
| 3a-i | this file | the hand-over rule in the one SMTP transport (N1, N2) and the one practice-inbox router | ~385 |
| 3a-ii | [`2026-11-08-a1308-3a-ii-mail-queue.md`](2026-11-08-a1308-3a-ii-mail-queue.md) | the `outgoing_mail` table, the queue's API, the sender, the `account_action` owner, wired into the full start | ~1,115 |
| 3a-iii | [`2026-11-08-a1308-3a-iii-account-mail.md`](2026-11-08-a1308-3a-iii-account-mail.md) | password reset, invitations and email change queue their mail; an account-mail sender on the time-zone repair start; measures 11 and 15; dashboard and guide words | ~1,005 |

Invoice email does **not** change in slice 3a (coordinator, 2026-11-08). It is already durable
(`invoice_deliveries` is its queue); it joins the queue **and** this transport in the
devices-and-printing slice, when `invoice_deliveries` loses its claim columns. Until then
`invoice-email.ts:81-122` keeps its own nodemailer transport, and that slice removes it.

**Owner lands:** no (rules §6: nothing fiscal changes). **No venue reset:** no table changes.

**Goal:** The SMTP function every notice and account mail goes through reports whether the mail
server ever received the message, and one function decides between the saved server and the
practice inbox.

**Architecture:** `sendSmtpMessage` (`apps/server/src/smtp-send.ts:13-104`) stops using nodemailer's
whole transport and drives nodemailer's `SMTPConnection` on the socket it already owns, so it knows
when the server accepted `DATA` (the "hand-over"). Today it cannot: one 30-second deadline races the
whole exchange (`:82-91`) and any reply-less failure is `unknown` (`:23-32`). The outcome gains the
distinction. Today's callers keep today's behaviour through one mapping, `statusAsBefore`, until
each moves onto the queue.

**Tech Stack:** TypeScript, nodemailer 10.3.1 (`SMTPConnection`, `MailComposer`), Vitest with the
wire rig `apps/server/src/testing/smtp-settings-fixture.ts`.

**Spec:** [design README §5 U4](../specs/2026-11-02-rationalisation/README.md);
[jobs.md §1 "One mail sender, one queue"](../specs/2026-11-02-rationalisation/jobs.md); coordinator
decisions N1 and N2 of 2026-11-08 (what 3b needs). [Slice rules](2026-11-08-a1308-slice-rules.md) apply.

---

## What it builds

1. **N1 — the hand-over rule**, decided in the transport (**owner, 2026-11-09:** confirmed: mail
   that never reached the server is retried; mail handed over and then lost is never sent twice):
   - The server answered with a 4xx or 5xx reply at any step (greeting, `EHLO`, `STARTTLS`, `AUTH`,
     `MAIL FROM`, `RCPT TO`, `DATA`, or its final reply to the message) → `rejected`,
     `serverRefused: true`. Nothing was delivered and the server said so.
   - No reply, and the server never accepted `DATA` (unknown host, refused connection, TLS or
     certificate failure, a socket closed or the deadline reached before `DATA` was accepted, input
     refused before connecting) → `rejected`, `serverRefused: false`.
   - No reply after the server accepted `DATA` (socket closed, deadline, lost final acknowledgement)
     → `unknown`. So `unknown` means exactly "handed over, outcome not known".
2. **N2:** `rejected` carries `serverRefused: boolean`, true exactly when today's rule says
   `rejected` (`smtp-send.ts:23-32`, a 4xx–5xx reply), so box alerts' "stop emailing an address the
   server refused" (`box-alert-email.ts:359`) keeps its meaning when 3b reads it.
3. `statusAsBefore(outcome)`: today's three-way status, for the callers not on the queue yet —
   account mail (`account-email.ts:126-142`), missing-times mail (`attendance-email.ts:26-39`) and
   text mail for box alerts and certificate reminders (`text-email.ts:16-24`).
   `smtp-test-message.ts:20` reads only `sent` and needs no change.
4. `resolveMailDeliveryIn(tx, ring, config, rule)`: the one place that chooses the saved server or
   the practice inbox, keeping both of today's rules (`email-delivery.ts:18-53`, `:68-77`).
   `resolveEmailDelivery` keeps its optional fourth `captureOnly` argument;
   `resolveInvoiceEmailDelivery` keeps its signature. Both call the router.
5. A message-level test hook stays: `options.transport` (`smtp-send.ts:16`), a fake that is handed
   the whole message, as today. Account mail's tests (`account-email.test.ts`,
   `i18n/account-email-output.test.ts`) keep using it, with their message-object assertions, until
   3a-iii deletes `createAccountEmailSender`. A fake that takes the message stands for a server that
   accepted `DATA`: it resolves → `sent`; it rejects with a 4xx–5xx `responseCode` →
   `rejected`/`true`; any other rejection, or the deadline → `unknown`.

## What it leaves out

| Left out | Who takes it |
| --- | --- |
| The queue, the sender, the account owner | 3a-ii |
| Account mail's producers | 3a-iii |
| Dropping `statusAsBefore` for reminders and box alerts | 3b |
| Invoice email on this transport and on the queue | devices-and-printing slice |

## Files

Modify:
- `apps/server/src/smtp-send.ts` — the rewrite; `SmtpSendOutcome`; `statusAsBefore`; `options.transport` (`:16`) kept as the message-level hook.
- `apps/server/src/account-email.ts:126-142`, `apps/server/src/attendance-email.ts:26-39`, `apps/server/src/text-email.ts:16-24` — read `statusAsBefore(outcome)`.
- `apps/server/src/email-delivery.ts` — `resolveMailDeliveryIn`.
- `apps/server/src/testing/smtp-settings-fixture.ts:6-14, :28-35, :56-110` — two reply modes and a `pipelining` option.
- Tests: `apps/server/src/smtp-send.test.ts`, `smtp-send-late-dns.test.ts`, `email-delivery.test.ts`.

## Size

| Part | Counted lines (estimate) |
| --- | --- |
| Code: `smtp-send.ts` 125, `statusAsBefore` callers 10, `email-delivery.ts` 20, rig modes and pipelining 15 | **~170** |
| Tests: hand-over cases with controls, plain and pipelined, 135; the listed expectation changes 35; router table 30; `statusAsBefore` 15 | **~215** |
| **Counted total** | **~385** |

## Finish line

1. `pnpm --filter @waitron/server exec vitest run src/smtp-send.test.ts src/smtp-send-late-dns.test.ts src/smtp-test-message.test.ts src/email-delivery.test.ts src/account-email.test.ts src/i18n/account-email-output.test.ts src/attendance-email.test.ts src/attendance-email-worker.test.ts src/box-alert-email.test.ts src/certificate-reminder-email.test.ts src/invoice-email.test.ts src/management-api.accounts-and-receipt-config.test.ts src/me-api.test.ts src/recovery-page-personal-data.test.ts` — passes, `Tests` count printed.
2. `pnpm protection-list compare` prints `EQUAL`.

## Expected protection-list difference

**EQUAL.** No schema change.

## Assertions that change, by design

Only these, in `smtp-send.test.ts`, by coordinator decisions N1 and N2 (2026-11-08):

- Gain `serverRefused: true` (the rig answered 4xx/5xx): `:12`, `:13`, `:100`, `:116`, `:165`, `:317`, `:347`.
- `unknown` becomes `rejected` with `serverRefused: false`, same `reason`, because the failure came
  before the server accepted `DATA`: `:185` and `:200` (certificate), `:217` (implicit TLS against
  plain SMTP), `:230` (no greeting), `:244` (closed port), `:267` (unknown host), `:278` (input
  refused before connecting); and `smtp-send-late-dns.test.ts:38` (the deadline while the address
  lookup is still pending, so no connection was made).
- `:79` and `:297` stay `unknown`, although the coordinator's list named `:79`: both run through the
  message-level hook (`options.transport`), which stands for a server that accepted `DATA` (item 5
  above), so a deadline or a non-reply throw there is `unknown` by the rule.
- `:15` (`silent`): this rig stays silent only **after** the message (`smtp-settings-fixture.ts:68-70`
  writes no reply for it), but the case gives the whole exchange a 100 ms deadline (`:24`), so today
  the outcome depends on whether the TLS handshake and envelope finish inside 100 ms. The case's
  deadline becomes 2,000 ms, like its neighbours, and its expectation stays
  `{ status: "unknown", reason: "email.test_timeout" }`; the deadline before `DATA` is the new
  `silent-before-data` case. `:14` (`lost-ack`) stays `unknown`.

No test outside `smtp-send.test.ts` and `smtp-send-late-dns.test.ts` changes an assertion: `statusAsBefore` returns `rejected` exactly
when the old code did and `unknown` otherwise.

## Stop points (beyond rules §5)

1. Any test of account mail, missing-times mail, box alerts, certificate reminders, the settings
   test send or invoice email fails: `statusAsBefore` (or the untouched invoice path) is not keeping
   today's outcome.
2. The hand-over control (Task 1) shows the message read before the server accepted `DATA` — the
   mechanism below is wrong; the watcher decides another.
3. `smtp-send.test.ts`'s "does not let URL logging options disclose the SMTP conversation" (`:302`)
   needs any change.

## Global Constraints

- No provider text is returned or logged: only `SmtpTestCode` (`smtp-failure.ts:1-10`).
- Certificate checks are never weakened by a URL option (`smtp-send.ts:40, :80`).
- Deadline default 30 seconds (`smtp-send.ts:85`).
- The "notice" rule captures non-development Demo even with saved SMTP; development prefers saved SMTP and otherwise captures. Outside both, missing SMTP is unconfigured (keeps A987's single Demo capture rule; watcher, 2026-11-09 11:44).

## Review Focus

1. **A server that hangs after `MAIL FROM` until the deadline** — never received the message:
   `rejected`, `serverRefused: false`, `email.test_timeout`. Task 1.
2. **STARTTLS and implicit TLS** — the hand-over is detected over an encrypted session too. Task 1.
3. **A login the server refuses with 535** — `rejected`, `serverRefused: true`, as box alerts treat
   it today (**owner, 2026-11-09:** confirmed). Task 1.
4. **Cleanup that throws after an accepted send** stays `sent` (`smtp-send.test.ts:35`). Task 1.
5. **A server that advertises `PIPELINING`** — nodemailer then sends `MAIL`, `RCPT` and `DATA`
   together (`index.js:1883-1904`), and the hand-over is still detected only once `DATA` is
   accepted. Task 1's pipelined pair.
6. **A message with more than one `to` address** — no caller sends one (each passes one recipient:
   `account-email.ts:129`, `attendance-email.ts:27`, `text-email.ts:16`, `smtp-test-message.ts:14`),
   and the rule cannot be judged per recipient, so the transport refuses it before connecting
   (`rejected`, `serverRefused: false`, `email.test_refused`). Task 1.

---

### Task 1: The transport

**Files:** `smtp-send.ts`, the rig, `smtp-send.test.ts`, the three callers.

**Interfaces — produced (3a-ii and 3b use them):**

```ts
export type SmtpSendOutcome =
  | { status: "sent" }
  | { status: "rejected"; reason: SmtpTestCode; serverRefused: boolean }
  | { status: "unknown"; reason: SmtpTestCode };   // handed over, no answer

/** Today's status, for callers not on the queue yet: "rejected" only for a refusal the server
 * answered; every other failure "unknown", as before N1. */
export function statusAsBefore(outcome: SmtpSendOutcome): "sent" | "rejected" | "unknown";

export async function sendSmtpMessage(
  config: SmtpConnection,
  message: Omit<SendMailOptions, "from">,
  options?: { timeoutMs?: number; ca?: string; transport?: SmtpTransport },  // SmtpTransport as today, :6-9
): Promise<SmtpSendOutcome>;
```

Mechanism: keep today's URL parsing, owned socket and dialling (`smtp-send.ts:33-81`). Build
`new SMTPConnection({ host, port, secure, requireTLS, connection: socket, logger: false, debug:
false, tls })` (`nodemailer/lib/smtp-connection`, which takes a connected socket as `connection`:
nodemailer 10.3.1 `dist/esm/smtp-connection/index.js:230-232`). `connect`, then `login` when the URL
has a user, then compile the message with `MailComposer` (`nodemailer/lib/mail-composer`) and
`send` it with its envelope. The stream handed to `send` is a lazy `Readable` whose first `_read`
sets `handedOver = true` and then streams the compiled message. `SMTPConnection` pipes the message
only once `DATA` was accepted (`index.js:683-713`: `_setEnvelope`'s callback, then
`message.pipe(stream)`). The plan review confirmed this against nodemailer 10.3.1 over 12 runs, pipelining included (coordinator, 2026-11-08); the control cases below keep proving it. An error with a numeric
`responseCode` 400–599 → `rejected`/`true`; else `handedOver` chooses `rejected`/`false` or
`unknown`; the deadline chooses the same way with `email.test_timeout`. Reasons still come from
`classifySmtpFailure`.

- [ ] **Step 1:** add rig modes `"dropped-before-data"` (destroys the socket on `RCPT`) and `"silent-before-data"` (answers nothing to `MAIL`), and an option `pipelining: true` that adds `250-PIPELINING` to the `EHLO` answer (`smtp-settings-fixture.ts:71-74`) and answers commands that arrive together in order.
- [ ] **Step 2: Write the failing tests** in `smtp-send.test.ts`:
  - `"reports a connection dropped before DATA as never received"` → `{ status: "rejected", reason: "email.test_refused", serverRefused: false }`; **control** `lost-ack` → `unknown` (the failing implementation prints `unknown` for both).
  - `"reports a deadline before DATA as never received"` (`silent-before-data`, `timeoutMs: 100`) → `rejected`, `email.test_timeout`, `false`; **control** `silent` with `timeoutMs: 2000` → `unknown`, `email.test_timeout`.
  - Both pairs again over implicit TLS (`smtpRig(..., true)`, `ca: smtpTestTls.caCertPem`), and again with `pipelining: true`.
  - `"marks a 535 to the login as a refusal the server answered"` (`login-refused`) → `serverRefused: true`.
  - `"refuses a message with two recipients before connecting"` → `rejected`, `false`, and the rig saw no connection.
  - `statusAsBefore`: `rejected/true` → `"rejected"`; `rejected/false` → `"unknown"`; `unknown` → `"unknown"`; `sent` → `"sent"`.
  - `"treats a message-level hook that rejects without a reply as handed over"` → `unknown`; with a `responseCode` of 550 → `rejected`/`true`.
  - Apply the listed expectation changes; the four existing fake-transport cases (`:35`, `:51`, `:88`, `:284`) keep the hook.
- [ ] **Step 3: Run** `pnpm --filter @waitron/server exec vitest run src/smtp-send.test.ts` — FAIL.
- [ ] **Step 4: Implement**; the three callers read `statusAsBefore(outcome)` where they read `outcome.status` (`account-email.ts:136-141`: `uncertain` is `statusAsBefore(outcome) === "unknown"`). `createAccountEmailSender`'s second parameter (`account-email.ts:60`) still passes the hook through.
- [ ] **Step 5: Run** Finish line 1 — PASS. **Step 6:** commit.

### Task 2: One router

**Files:** `email-delivery.ts`, `email-delivery.test.ts`.

**Interfaces — produced:**

```ts
export type MailDeliveryRule = "notice" | "invoice";
/** "notice": on non-development Demo, the practice inbox; else the saved server; else the
 * practice inbox in development; else unconfigured. "invoice": the practice inbox on a development or Demo box even when a server is
 * saved; else the saved server; else unconfigured. */
export function resolveMailDeliveryIn(
  tx: Transaction, ring: KeyRing,
  config: { onboardingIntent: OnboardingIntent | undefined; devMode: boolean },
  rule: MailDeliveryRule,
): Promise<EmailDelivery>;
```

The two rules can disagree on "unconfigured" in one case: on a development box whose saved
server has an unusable `from`, the notice rule answers `unconfigured` (`email-delivery.ts:39-46`,
before its practice-inbox fallback) while the invoice rule answers `local_capture` (`:73-74`). This
retains development’s existing behavior. Non-development Demo captures under both rules, including
an unusable From; this keeps A987's single Demo capture rule (watcher, 2026-11-09 11:44). It does not matter to the queue while no invoice is queued (3a-ii's
sender resolves each rule separately anyway).

- [ ] **Step 1: Failing test** `"chooses the server or the practice inbox as each rule says"` — (devMode, intent, saved server?) × rule: dev + saved: notice `smtp`, invoice `local_capture`; non-development Demo + none, saved or unusable From: both `local_capture`; Live + saved: both `smtp`; Live + none: both `unconfigured`; dev + saved server with an unusable `from`: notice `unconfigured`, invoice `local_capture`.
- [ ] **Step 2:** FAIL. **Step 3:** implement; the two existing functions call it. **Step 4:** Finish lines 1–2 PASS. **Step 5:** commit, then `/finish-branch`.

## Backlog

None finished (`git grep -n -i "one transport\|SMTP builder" docs/backlog docs/backlog.md` finds nothing).
