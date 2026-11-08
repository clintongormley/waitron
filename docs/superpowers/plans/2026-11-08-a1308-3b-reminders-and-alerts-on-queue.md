# A1308 slice 3b — missing-times reminders and box alerts on the mail queue — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Slice 3b is split in two** (rules §1, size): **3b-i** moves missing-times reminders onto the queue
and deletes `attendance_mail`; **3b-ii** moves the managers' box alert emails onto it. Each is one
pull request. Both need [3a-i](2026-11-08-a1308-3a-i-smtp-transport.md) and
[3a-ii](2026-11-08-a1308-3a-ii-mail-queue.md) landed; neither needs 3a-iii, and
neither needs the other. Build 3b-i first: it is the one that rebuilds a starting migration.

**Owner lands:** no, for both. Read, not run: neither part writes a `sales` row, an invoice number, a
`registros_facturacion` row, the fiscal identity, AEAT sending, or a value that feeds a fiscal hash
(rules §6). 3b-i touches the working-time area only where it queues a reminder; `time_entries` (the
legal working-time record) is not touched. 3b-ii reads the fiscal module's clock notices
(`apps/server/src/box-alert-email.ts:398-407`) to word an email, as it does today, and writes nothing
fiscal.

**Pull request first lines (rules §2):**
- 3b-i: "Every venue is reset: workforce; backups and exports from before this cannot be restored or
  imported."
- 3b-ii: no reset line. It changes no table (see "Expected protection-list difference").

**Goal:** Every reminder and box alert email becomes a row in `outgoing_mail`, sent by 3a-ii's one
sender, so a restart no longer loses one that was queued. Two can still be lost: the full-disk
email, which is still sent directly because a full disk refuses the row, and a clock change's email
handed to the duty in memory (`remember`) and not yet queued, at most one minute's check away.

**Architecture:** Each kind gets a `MailKindOwner` (3a-ii's interface) in `apps/server`. The
reminder's owner keeps today's claim-time work: re-read the question, reconcile the person's day in
the claim transaction, and send nothing if the question has gone
(`apps/server/src/attendance-email-worker.ts:66-131`). The workforce code that cancels, reopens and
asks about a reminder goes through the queue's API in `@waitron/db`, keyed `attendance:<question>`;
the queue row holds the question's id as a plain value, because core cannot key into the
switchable workforce set (design U1). The box alert duty keeps deciding once a minute, as today, but
queues one row per episode per manager, keyed `alert:<episode>:<person>`, instead of sending; only
the full-disk email keeps today's in-memory direct send.

**Tech Stack:** TypeScript, drizzle-orm on `node:sqlite`, Vitest.

**Spec:** [design README §5 U4](../specs/2026-11-02-rationalisation/README.md) and §10 "The mail
queue"; [jobs.md](../specs/2026-11-02-rationalisation/jobs.md) §1 "One mail sender, one queue"
(the full-disk paragraph), §2 R5 and R7, "Draft: the `outgoing_mail` table" (its protections table
and "Rules each kind needs from the queue"), §5 measure 12;
[tables-people.md](../specs/2026-11-02-rationalisation/tables-people.md) §1 `attendance_questions`
(the five rules that must survive) and §5 (the `attendance_mail` rows). Every rule in
[the slice rules](2026-11-08-a1308-slice-rules.md) applies; this plan cites them as "rules §n".

**Base:** `main` after 3a-i and 3a-ii have landed. Line numbers below were read at `a086eedfb7`. 3a
changes `apps/server/src/boot.ts`, `background-duties.ts`, `background-duties.test.ts`,
`handover-stepdown.test.ts` and `docs/developers/conventions-data.md`, so cites into those files
will have moved: find them by the quoted text. A cite into any other file that no longer says what
this plan says is a stop (rules §5.1).

---

## What it builds

**3b-i — missing-times reminders**

1. `attendance_mail` (workforce set) is deleted. A reminder is an `outgoing_mail` row: kind
   `attendance_question`, `dedupe_key` `attendance:<question id>`, `subject_id` the question,
   `person_id` the question's person, `not_after` 7 days after it was queued
   (`MAIL_LIFETIME_MS.attendance_question`).
2. Each of the five rules in tables-people.md §1 survives, through the queue's API:
   - one mail per question: `enqueueMail` on the key (today `attendance_mail_question_uq`);
   - an unsent mail is cancelled when its question is answered, merged or retired, and a sending one
     is left alone: `cancelMail` (3a-ii), which ends only `pending` or waiting `rejected` rows;
   - a cancelled mail reopens when its question comes back, unless a send may already have gone out:
     new `reopenMail` (3a-ii's plan names it for this slice);
   - merge and retire ask "was it attempted": `readMail` status `sending`, `sent` or `unknown`;
   - the sender re-reads the question and reconciles the person's day in the claim transaction, and
     sends nothing if the question has gone: the `attendance_question` owner's `claim`.
3. The `attendance_question` kind owner, `attendanceReminderMail`, in `apps/server/src/attendance-email.ts`.
4. One addition to 3a-ii's sender: an owner's `claim` may answer `{ later: Date }` — "not now, look
   again then" — for a reminder whose person has no address yet, is suspended, or whose day is not
   over (today the worker leaves those rows untouched and picks another, `attendance-email-worker.ts:69-90, 106`).
5. The old worker loop (`attendance-email-worker.ts`) and its duty handle go.

**3b-ii — box alerts**

1. The deciding duty (`startBoxEmailDuty`, design R7) queues one `box_alert` row per episode per
   manager, keyed `alert:<episode>:<person>`, `not_after` 24 hours. An episode that is an open
   alert is keyed by the alert's id, so it is queued once however often the box restarts; any other
   episode gets a fresh id when it begins.
2. The `box_alert` kind owner, `boxAlertMail`, in a new `apps/server/src/box-alert-mail.ts`: it
   rechecks at claim that the person is still a manager with an address and that an alert's
   episode still wants its email, and words the email with today's `boxEmailMessage`.
3. The full-disk email alone keeps today's direct, in-memory send through the same SMTP builder
   (`sendSmtpMessage`, by way of `createTextEmailSender`) and writes nothing (jobs.md §1). While the
   disk is full the duty queues and cancels nothing.
4. Measure 12 as a test on a small real filesystem.

## What it leaves out

| Left out | Who takes it |
| --- | --- |
| Certificate expiry reminders (`fiscal_certificate_reminders`) | the fiscal slice (owner lands) |
| Invitations and email change (`account_action`) | 3a-iii |
| `role_membership_changed`'s owner | A1002 cut 2 |
| The job runner adopting the box alert duty's minute timer (R7 as a runner job) | batch 3 (the runner) |
| Queuing a `clock.corrected` alert's mail in the transaction that records the alert (it is still handed over in memory by `remember`, so a restart in the minute before it is queued loses it) | the venue-and-box area slice, which owns `clock-correction.ts` |
| `attendance_questions` losing `business_day`/`start_at`/`end_at`, gaining the day key | the people-and-working-time area slice |
| Pruning finished rows | A980 |

## What this plan takes from 3a, and what it adds to it

From 3a-i: `SmtpSendOutcome` with `serverRefused`, `statusAsBefore`, `resolveMailDeliveryIn` and
its `"notice"` rule. Used exactly as 3a-ii fixes them (3a-ii plan, Tasks 1–3): `outgoingMail`, `OutgoingMail`,
`enqueueMail`, `cancelMail`, `readMail`, `MAIL_LIFETIME_MS` (`@waitron/db`); `MailKindOwner`,
`ClaimedMail`, `MailMessage`, `MailSettlement`, `runMailPass`, `startMailSender`,
`abandonMailClaims`, `MAIL_CLAIM_LEASE_MS`, `MailSenderDeps` (with `signal`)
(`apps/server/src/mail-sender.ts`). 3a-i points `attendance-email.ts` and `text-email.ts` at
`statusAsBefore`; 3b-i deletes the attendance sender with its call, and the full-disk email keeps
`text-email.ts`'s today's outcomes. The kind list
already holds `attendance_question` and `box_alert`, so no slice here touches core's set.

Added here (3b-i Task 1), and nothing else of 3a-ii's changes:

```ts
// packages/db/src/outgoing-mail.ts
/** Reopens a cancelled row: one never tried goes back to pending, due at nextAttemptAt; one tried
 * before (attempts > 0, so it was refused and waiting when it was cancelled) goes back to rejected
 * and waiting, keeping its own next_attempt_at, so a reopen never shortens a saved retry wait
 * (today's end-of-day.ts:99-108; "revives a cancelled definitive rejection without shortening its
 * saved retry delay", end-of-day.obligations.test.ts:28). Any other status is left alone.
 * Returns whether it changed the row. */
export function reopenMail(
  tx: Transaction, dedupeKey: string,
  times: { notAfter: Date; nextAttemptAt: Date },
): Promise<boolean>;
// sets status, finished_at = null, not_after, and next_attempt_at only when attempts = 0;
// claim_token, claimed_at and recipient untouched (a waiting rejected row has none: 3a-ii releases them)

// apps/server/src/mail-sender.ts — MailKindOwner.claim's answer gains one member:
claim(tx, mail, now): Promise<{ recipient: string; prepared: Prepared } | { later: Date } | null>;
// { later }: the sender sets next_attempt_at to min(later, now + owner.longestWaitMs), guarded on the
// status it picked the row in; no attempt is counted, nothing is claimed, settle is not called;
// the pass answers { processed: true, mailId, subjectId }.
```

`later` is clamped to `longestWaitMs` because a row further ahead than that is treated as stamped
before a clock step back and is due at once (3a-ii's pass, the step that picks a due row: "`next_attempt_at <= now` or `> now + owner.longestWaitMs`"). If 3a's final plan already gives
`claim` a "not now" answer, 3b-i uses it under 3a's name and drops this addition.

**Needs from 3a** (coordinator, 2026-11-08). The 3a plans were still being restructured when
this was written: at 20:49 neither yet named N4, the claim order, or the untouched unconfigured row.
Names marked *assumed* are this plan's; the builder takes 3a's final names from
`docs/superpowers/plans/2026-11-08-a1308-3a-*.md` and changes nothing else. If 3a has landed without
one of these, that is a stop (stop point 1); this plan builds nothing in its place.

- **N1, when a failed send counts as uncertain** (3a-i, `SmtpSendOutcome`). A send that fails before
  the message is handed over with DATA cannot have been delivered, so it is `rejected` and retried on
  the kind's delays: DNS failure, refused connection, a TLS or certificate failure, a refused login,
  anything before DATA. Only a failure after hand-over is `unknown`, and it is never sent again.
  3b-ii needs it; 3b-i is affected by it (see "Behaviour that moves").
- **N2, whether the mail server refused** (3a-i's `serverRefused` on `SmtpSendOutcome`, passed on
  by 3a-ii's `MailSettlement`). The `rejected` settlement says whether the mail server itself
  answered with a refusal (a reply code 400–599, which is what `rejected` meant until now,
  `smtp-send.ts:29`). 3b-ii needs it.
- **N3, re-checks inside a pass** (3a-ii's `MailSenderDeps.signal`; its pass re-checks at the start
  of the claim transaction and again after `compose`, before `send`).
  `runMailPass` re-checks the stop signal and `isPrimary` inside the claim transaction and again
  between the claim and the send. A claim stopped before its send started is released to `pending`,
  with its claim cleared and its attempt not counted. 3b-i needs it.
- **N4, a test seam** between `runMailPass`'s first read and its claim transaction, *assumed*
  `MailSenderDeps.beforeClaim?: () => Promise<void>`. The reminder tests that change something
  "before the claim" use it (today they use `resolveDelivery` for that). 3b-i needs it.
- **N5, delivery and unconfigured email.** Delivery is resolved before or inside the claim, so a box
  with no email set up leaves a due row untouched: not claimed, not counted, retried as soon as
  email is set up. 3b-i needs it (today's case 504).
- **N6, a fixed claim order:** `next_attempt_at`, then `queued_at`, then a tie-breaker that keeps
  insertion order. Rows the duty queues in one transaction are claimed in the order it inserted them.
  3b-ii needs it: the duty cases that expect ANA's email before BEN's rely on it.

This plan also relies on one thing 3a-ii's plan says but does not test by name: the claim update the
sender guards on status takes effect before the transport runs (stop point 2).

## Decisions this plan makes

1. **Retry waits.** `attendance_question`: every 15 minutes until its `not_after`, today's
   `RETRY_MS` (`packages/workforce/src/attendance-mail.ts:8`): `retryDelaysMs` is 672 entries of
   900 000 (7 days / 15 minutes), `longestWaitMs: 900_000`. `box_alert`: the design asks for back-off
   (jobs.md §1, "A `rejected` mail is tried again with back-off"); today it is every minute
   (`BOX_EMAIL_CHECK_MS`, `box-alert-email.ts:204`). Chosen: `[60_000, 60_000, 300_000, 900_000, ...24 × 3_600_000]`
   (`BOX_ALERT_RETRY_DELAYS_MS`, 28 entries, covering the 24-hour life), `longestWaitMs: 3_600_000`.
   The first retry is still a minute later, so the duty tests that say "the next minute" keep their
   assertions; a wrong password makes about 28 attempts a day per manager, not 1,440, each logged.
2. **A box alert that never reached the mail server is retried** (coordinator, 2026-11-08; N1). A box
   with no internet, a wrong password or a certificate it cannot check keeps trying on the delays
   above, for up to a day, as today it keeps trying every minute (a send that is not `sent` stays out
   of `sentTo`, `box-alert-email.ts:341-365`; the guide, `apps/server/src/guide/en/box-status.md:522-525`).
   Only a send cut off after hand-over is `unknown` and not sent again (jobs.md §1). The guide
   changes only by gaining the day limit, the back-off, and that one uncertain case.
3. **Episode keys and restarts (3b-ii).** An open alert's episode is `incident:<id>`; a backup
   refusal's is `backup.run_stopped:<since>` (today's own test of a new refusal,
   `box-alert-email.ts:389`); a disk-low or module-notice episode gets `newId()` when it begins. On
   its first check with room on the disk as primary, the duty cancels every unsent `box_alert` row
   with no `subject_id` left by an earlier process; the episodes still live are begun again and
   queue again. So after a restart an alert's email (keyed by the alert) is neither lost nor sent
   twice, and a disk, backup or clock-notice email can be sent again — what the guide already says
   today ("A restart while the problem lasts can send the same email again",
   `box-status.md:529`).
4. **The box alert claim rules** (`box-alert-mail.ts`), mirroring today's episode ends
   (`box-alert-email.ts:320-367, 416-431`):
   - the person is no longer an active manager with a non-blank address → cancel (`null`);
   - a row with `subject_id` (an alert): the alert row is gone → cancel; open → send; handled and
     not `clock.corrected` → cancel; handled `clock.corrected` → send;
   - a row without `subject_id`: nothing more; the duty cancels it when its episode ends;
   - in `settle`, a `clock.corrected` row whose send the mail server refused (`serverRefused`, N2),
     with its alert handled when `settle` reads it, is cancelled with `cancelMail` in that same
     transaction. A refusal that comes after the alert is handled ends the email; a refusal before
     that, or a send that never reached the server, does not. That is today's "refused outright"
     rule (`box-alert-email.ts:320-321, 359`; `box-alert-email.duty.test.ts:219, 234, 245`).
5. **The duty queues nothing while email is not set up**, as an invitation is not queued then
   (jobs.md §1); it says `box_email.not_configured` once per episode and queues when settings appear,
   as today. The reminder, written in the end-of-day transaction where the delivery settings are
   not read, is queued regardless and waits untouched until email is set up (N5), as today.
6. **The box owner logs today's `box_email.sent` and `box_email.send_failed` lines** from `settle`,
   the second once per row per outcome (an in-memory set per row id), so the duty's log contract
   holds. The line's `outcome` keeps today's meaning: `rejected` when the mail server refused
   (`serverRefused`), otherwise `unknown`, which covers both a send that never reached the server and
   one cut off after hand-over (today's `smtp-send.ts:29` split). 3a-ii's sender adds its own
   `mail.send_failed` line on every failure.

## Assertions that change, by design (rules §4)

**3b-i** (`apps/server/src/attendance-email-worker.test.ts`, moved to `attendance-email.test.ts`):

| Case (line at `a086eedfb7`) | Change | Design |
| --- | --- | --- |
| "leaves questions with unusable email=%s unclaimed and later uses the current email" (515); "does not claim for a %s worker and retains their question" (532) | `toEqual(before)` becomes "unchanged except `nextAttemptAt`, now 15 minutes on"; the later pass runs with the clock 15 minutes on | jobs.md R5: one sender takes rows in due order, so a row not ready is put back (`later`) or it would block the rows behind it |
| every `expect(await pass()).toEqual({ processed: true })` | `{ processed: true, mailId: expect.any(String), subjectId: <question id> }` | 3a-ii's `MailPassResult` |
| "leaves unconfigured mail untouched and sends after configuration becomes available" (504) | the row stays untouched and nothing is sent, as today; the pass's answer `toEqual({ processed: false })` becomes `{ processed: false, emailUnconfigured: true }` | 3a-ii's pass: unconfigured delivery leaves the row untouched and says so in its answer |
| "expires a crash-abandoned claim even when delivery is unconfigured" (359) | its `toEqual({ processed: true })` becomes `{ processed: true, mailId: null, subjectId: null }` (the pass ended an abandoned claim and claimed nothing) | 3a-ii's pass answer |
| "resolves delivery outside the write lock and rechecks the recipient at claim time" (571) | renamed "resolves delivery in the claim and uses the address current at the claim"; the address change moves into `beforeClaim`; its assertions (the new address is the one sent to and recorded) are kept | 3a-ii resolves delivery inside the claim transaction, which holds the write lock (`packages/db/src/tenancy.ts:30-42`) |
| "settles an unstarted committed claim as unknown when %s" (405) | renamed "puts back an unstarted committed claim when %s": the row is `pending`, claim and recipient cleared, attempts as before, nothing sent (was: `unknown`, claim kept) | N3: 3a-ii releases a claim stopped before its send |
| the "attendance email duty lifecycle" describe (796-925) | deleted with `runAttendanceEmailLoop`: its idle sleep, the sleep's abort and its interval are `runMailLoop`'s, tested in 3a-ii's `mail-sender.test.ts` | jobs.md R5, one sender |

Re-pointed with their assertions kept:
- **Nine cases** use the delivery-resolution hook to change something before the claim: 161, 285, 328,
  341, 571, 674, 690, 704 and 732. Their change moves from `resolveDelivery` to N4's `beforeClaim`. So
  285 and 674 keep "row unchanged". (571's name changes; see the table.)
- **504** keeps today's silent behaviour (N5): row untouched, nothing sent, sent once email is set
  up. Only the pass's answer changes (table above).
- **"revives a cancelled definitive rejection without shortening its saved retry delay"**
  (`end-of-day.obligations.test.ts:28`) seeds its refused row with `setAttendanceMail` (`rejected`,
  attempts 1, `nextAttemptAt` 15 minutes on) instead of `claimAttendanceMail`/`reportAttendanceMail`.
  Its two final claims, refused at 14 minutes and taken at 15, become the assertion they rest on:
  the reopened row's `nextAttemptAt` is still 15 minutes after the refusal. The sender's due rule
  itself is 3a-ii's, tested there.
- **The other primary and stop cases** drive `runMailPass` through N3's re-checks: 660, 431 and 770
  ("awaits an in-flight send and its report when shutdown arrives").

`packages/workforce/src/attendance-mail.test.ts` is deleted with the functions it tests. Its cases
map to 3a-ii's `mail-sender.test.ts` as follows; the two with no counterpart there are added to it in
3b-i Task 1: "commits one recipient/token snapshot and serializes competing claimants" → new
`"two passes started together claim a due row once"`; "waits for the saved retry instant then
creates a new claim token" → "retries a refused send after each delay…"; the two step-back cases →
"sends a row whose next attempt lies 400 days ahead", "expires a claim taken 400 days ahead"; "an
old token cannot settle a newer attempt" → new `"a report under a lapsed claim changes nothing"`;
"expires abandoned claims at 60 seconds…" → the lapse in the claim transaction and `abandonMailClaims`; "refuses a
missing delivery without changing the real row" → none (claims by id no longer exist).

Checked against 3a's later additions (coordinator, 2026-11-08):
- Only waiting rows expire, and a `sending` row whose claim lapses ends `unknown`. That matches
  359 and the box case "keeps a queued email from being sent after its day" (a `pending` row).
- A claim that throws is settled `rejected` with back-off. No 3b case makes a claim throw.
- A waiting `rejected` row releases its claim and address. If 3a-ii enforces that with a database
  rule, `setAttendanceMail` cannot write a waiting `rejected` row with a claim. Then the `rejected`
  entry of "an answered question preserves attempted mail and cancels only unclaimed %s"
  (`attendance-response-commands.test.ts:528`) seeds no claim, and expects `claimToken: null` and
  `recipient: null` after the cancel. That is a change by design (3a-ii's released claim); with no
  such rule, it is unchanged. `personal-data.test.ts:606-613`'s colleague row is only checked for
  being left out, so it just seeds without the claim.
- The account-only sender in the time-zone repair start changes no 3b case. That start returns
  (`boot.ts:2201`) before the reminder and box alert duties start (`:2421`, `:2982`). The
  `boot.box-emails.test.ts` repair case checks its reminder owner only when it is not repairing
  (`:276-278`).

Re-pointed, not changed: assertions on the old sender's argument (`send.mock.calls[0]![0].locale`,
`.missingKinds`, `.venueName`, `toHaveBeenCalledExactlyOnceWith({ smtp, recipient, locale, … })`)
assert the transport's message instead: `to` is the same address and `subject`/`text` equal
`attendanceReminderMessage({ locale, businessDay, venueName, missingKinds })` with the same values.

**3b-ii** (`apps/server/src/box-alert-email.duty.test.ts`):

| Case (line) | Change | Design |
| --- | --- | --- |
| `expect(d.context).toHaveBeenCalledTimes(2)` in 219 and 273 | `1`: once the alert is handled and its rows are queued, no episode is live, so the duty reads nothing more | design R7: deciding is separate from sending |

Every other duty case keeps its assertions, including 234, 462, 490 and 818. The cases that expect
ANA's email before BEN's (335, 462, 474 and others) rely on N6: the duty queues in `context`'s
recipient order, and the sender claims rows queued in one transaction in that order. Each case's fake keeps
answering today's words, and the harness turns them into N1 and N2 outcomes (Task 5, step 1):
- `"rejected"` means the mail server refused: `rejected`, `serverRefused: true`.
- `"unknown"` means the duty case's "could not be made": the outcome for a refused connection, which
  is `rejected`, `serverRefused: false`, `email.test_connection_refused`.
- A throw from the fake means the same "not sent".

The new value `"uncertain"` gives a send cut off after hand-over (`unknown`), for the one new case
that tests it. Case 490 ("a sender that throws counts as not sent") therefore covers the duty's
meaning of a throw. What a real transport that throws counts as is 3a-ii's rule, tested in
`mail-sender.test.ts`.

Set-up changes, assertions kept (rules §4):
- **818** has seven failures before its send, more than the 1, 1, 5 and 15 minute delays fit into
  one-minute ticks. So its ticks move the clock by an hour (`d.tick({ advanceMs: 3_600_000 })`), and
  every row that has failed is due at each tick.
- **462** used `mockImplementationOnce`, which fails whichever send comes first. Its fake now fails
  ANA's first send by recipient, so the row it fails is a known one, not just the first in the order.
- **706** opens two `clock.records_misdated` alerts at once. The harness gives each alert it inserts
  its own `source`, because `incidents_open_dedup` (`packages/db/drizzle/0000_baseline.sql:1438`)
  refuses two open alerts with the same source, device, code and sale.
- **754** and **781** proved "nothing sent" because the duty sent. Now the duty only queues, and the
  harness runs the sender only in `tick`, so "send not called" proves nothing. Each also asserts
  that no `outgoing_mail` row exists after the stop, and that a sender pass afterwards sends nothing.
- **803** ("stop during a send sends to no one after it") becomes two cases, each keeping
  `expect(d.send).toHaveBeenCalledTimes(1)`:
  - the queued path: `d.check()` queues both managers' rows; `d.drain()` runs the sender with ANA's
    send held; the sender's signal is aborted, then the send released. ANA's row is `sent`, BEN's is
    still `pending` (N3).
  - the full-disk path, on the duty's own direct send: the disk is full, the first send is held, the
    duty is stopped, then the send released. Nobody else is sent it.

## Behaviour that moves

What changes for people, with no test asserting the old way (each is in the guide text in Task 6,
or the PR description for 3b-i):

**3b-i**
- A reminder whose send never reached the mail server used to end `unknown` and was never sent
  again. Now it is `rejected` and retried every 15 minutes (N1).
- A reminder still unsent 7 days after it was queued expires and is never sent; it used to wait
  indefinitely (`MAIL_LIFETIME_MS.attendance_question`, README §10). Reopening one gives it 7 more days.
- The personal-data download's `reminderEmail.status` can now be `expired`, besides today's values.
  Its `outcome` is unchanged in meaning. A reminder waiting to be retried shows `recipient: null`,
  because 3a-ii clears a waiting rejected row's claim and address; today it shows the address tried.
- A reminder whose claim throws (for example, its day's reconcile fails) is now `rejected` with
  3a-ii's fixed failure code and retried in 15 minutes, counting an attempt. Today the pass threw,
  the row stayed untouched and the next pass tried again in 30 seconds. It does not count as
  "attempted" for merges and retirements, which ask only about `sending`, `sent` and `unknown`.

**3b-ii**
- While the disk is full, only the full-disk email goes. An open alert's, a refused backup's or a
  clock notice's email waits until the disk has room, because its row cannot be written. Today
  those were sent directly while the disk was full (`box-alert-email.ts:369-446`).
- A failed alert email is retried after 1, 1, 5 and 15 minutes, then hourly, for up to a day. Today it
  is every minute for as long as the problem lasts. "Keeps trying while the alert is open" now ends
  after a day as well.
- An open alert's email is not sent again after a restart (it is keyed by the alert). A disk, backup
  or clock-notice email still can be, as the guide already says.
- A send cut off after the mail server was handed the message is not sent again.

## Files

**3b-i**

Create:
- `scripts/a1308/3b-attendance-mail-reads.mjs` — the rename script (rules §1): rewrites
  `<expr>.select().from(attendanceMail)` and `<expr>.select().from(api.attendanceMail)` when nothing
  is chained after it, to `attendanceMailRows(<expr>)`, in the test files listed below; idempotent.

Modify:
- `packages/db/src/outgoing-mail.ts`, `packages/db/src/outgoing-mail.test.ts`, `packages/db/src/index.ts` — `reopenMail`.
- `apps/server/src/mail-sender.ts`, `apps/server/src/mail-sender.test.ts` — `{ later }`, two moved cases.
- `packages/workforce/src/attendance-mail.ts` — rewritten (below).
- `packages/workforce/src/attendance-questions.ts:6-7, 73-82, 215-222`; `attendance-rota.ts:5, 46-55`; `end-of-day.ts:12, 57-67, 83-109, 215-226`; `attendance-question-responses.ts:11, 112` (import unchanged if the name is kept, which it is).
- `packages/workforce/src/personal-data.ts:12, 118-136, 224-233`.
- `packages/workforce/src/schema/attendance.ts:205-235` (delete the table and its two value lists), `schema/index.ts:21`, `index.ts:10-19`, `classification.ts:33`.
- `packages/workforce/test/fixtures.ts` — `attendanceMailRows`, `setAttendanceMail`, `insertAttendanceMail` (below).
- `apps/server/src/attendance-email.ts` — the kind owner (below).
- `apps/server/src/boot.ts:264-265` (imports), `:2421` and `:2443-2458` (the loop), `:3883` (the handle), and the `owners` list 3a-ii passes to `startMailSender`.
- `apps/server/src/background-duties.ts:40, 105-109`; `background-duties.test.ts:22, 73, 121`; `handover-stepdown.test.ts:62`.
- Tests re-pointed: `apps/server/src/attendance-email-worker.test.ts` → `git mv` to `apps/server/src/attendance-email.test.ts`; `packages/workforce/src/attendance-questions.test.ts`, `attendance-rota.test.ts`, `end-of-day.test.ts`, `end-of-day.obligations.test.ts`, `attendance-response-commands.test.ts`, `personal-data.test.ts`, `personal-data.coverage.test.ts:111-114`, `index.test.ts:20-24`, `schema-ownership.test.ts:26`, `packages/workforce/test/attendance-fixture.ts:84`; `apps/server/src/attendance-obligations.test.ts`, `attendance-restore.test.ts:16, 100`, `attendance-export-api.test.ts:84`, `management-hours-api.test.ts:108`, `personal-data-export-api.workforce.test.ts:37, 404`, `boot.attendance.test.ts:39-40, 114-116, 401-404`, `boot.box-emails.test.ts:10, 39, 62-71, 277-278, 340`, `recovery-page-personal-data.test.ts:841-870`.
- `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts:39` — `"attendance_mail"` into `REMOVED_TABLES`.
- `docs/developers/conventions-data.md:4725` (the clock-step table's attendance row).
- Generated by `pnpm --filter @waitron/server migration-baseline rebuild --set workforce`, not by hand: `packages/workforce/drizzle/**`, `scripts/migration-baseline-epoch.json`.

Delete: `apps/server/src/attendance-email-worker.ts`, `packages/workforce/src/attendance-mail.test.ts`.

**3b-ii**

Create: `apps/server/src/box-alert-mail.ts`, `apps/server/src/box-alert-mail.test.ts`.

Modify:
- `apps/server/src/box-alert-email.ts:231-460` (episodes, `deliver`, `check`, `remember`, the deps).
- `apps/server/src/manager-email-recipients.ts` — `readManagerEmailRecipient`.
- `apps/server/src/boot.ts:2982-3011` (the duty's deps) and the `owners` list.
- Tests: `apps/server/src/box-alert-email.duty.test.ts` (harness and the cases above), `start-full-disk.e2e.test.ts` (measure 12), `boot.box-emails.test.ts:72-75, 395-441`.
- Docs: `apps/server/src/guide/en/box-status.md:521-536`, `apps/server/src/guide/es/box-status.md:562-578`, `docs/developers/conventions-data.md:4540-4544`, `docs/backlog/box.md:2314-2319`.

## Size

| Part | Counted (hand-written) | Estimate |
| --- | --- | --- |
| 3b-i code | `reopenMail` 25, `{ later }` in the sender 15, `attendance-mail.ts` 50, the three workforce callers 40, personal data 20, exports and classification 10, the kind owner 110, boot 15, the rename script 35 | ~320 |
| 3b-i tests | `reopenMail` 40, sender `later` and the two moved cases 70, fixture helpers 45, the moved worker suite's harness 60 and its re-points 150 (the primary and stop cases kept), hand edits the script does not make (imports, `.update(attendanceMail)` sites, inserts) 70, server test re-points 70, the obligations revive case and the 504/359/571 answers 15 | ~520 |
| 3b-i docs | conventions-data row | ~5 |
| **3b-i total** | | **~845** |
| 3b-ii code | duty rework 130, kind owner 100, one-recipient read 15, boot 15 | ~260 |
| 3b-ii tests | duty harness 130, case set-up edits 140 (754, 781, 803 split in two, 706, 462, 818), by-design changes 10, new duty cases 130, kind owner suite 150, measure 12 80, boot re-point 20 | ~660 |
| 3b-ii docs | two guide paragraphs × 2 languages, conventions-data, backlog | ~50 |
| **3b-ii total** | | **~970** |

Not counted (rules §1): the rename script's output (about 60 call sites); deleting
`attendance-email-worker.ts` (146 lines), `attendance-mail.test.ts` (203), the `attendance_mail`
schema (31), the deleted worker lifecycle cases (about 130) and the old claim functions (about 80); the
regenerated workforce migration. About 2½ hours each.

## Finish line

Each part's finish line is in its header block, at the start of the part.

## Expected protection-list difference

**3b-i.** Six headers, `database=venue` only. Simulated on `a086eedfb7` by deleting
`attendance_mail`'s table, indexes and triggers from a real `protection-list list` output and running
`compare` (exit 1), so it is the tool's own wording; the real run is after 1a's column-order rebuild
of workforce, which compares cleanly (1a plan, "workforce: none").

For each of `composition=fiscal-none` and `composition=fiscal-verifactu`, in `phase=sql-only` and
`phase=migrated`:

```text
missing index attendance_mail.primary key(id)
missing index attendance_mail_due_idx
missing index attendance_mail_question_uq
missing table attendance_mail
```

and in `phase=change-feed` those four plus:

```text
missing trigger waitron_change_attendance_mail_delete
missing trigger waitron_change_attendance_mail_insert
missing trigger waitron_change_attendance_mail_update
```

No `extra` or `changed` line: `outgoing_mail` already lists both kinds (3a-ii Task 1), and
`attendance_questions` loses nothing (the key pointed from `attendance_mail` to it). Where each
protection goes (jobs.md §2 protections table; tables-people.md §5): `attendance_mail_question_uq` →
`outgoing_mail_key_uq` on `attendance:<question>`; `attendance_mail_due_idx` →
`outgoing_mail_due_idx`; the status, claim-pair and sending CHECKs (inside `missing table`) → 3a-ii's
same-named CHECKs on `outgoing_mail`; `attendance_mail_outcome_ck` → gone with the column, `status`
holds the outcome; the key to `attendance_questions` → dropped (U1), the owner's `claim` cancels a row
whose question is gone; the three change-feed triggers → `attendance_mail` stops being a change
source (`WORKFORCE_CHANGE_SOURCES` is built from the classification, `classification.ts:54-56`; no
dashboard query names it: `git grep attendance_mail -- apps/dashboard packages/*/src/dashboard`
finds nothing).

**3b-ii.** `EQUAL` for every entry: no table, index, CHECK or trigger changes.

## Stop points (beyond rules §5)

1. 3a has landed without a Need this part uses ("Needs from 3a"): N3, N4 and N5 for 3b-i; N1, N2 and
   N6 for 3b-ii. Check before Task 1 (3b-i) or Task 4 (3b-ii) by reading `smtp-send.ts`,
   `mail-sender.ts` and their tests.
2. The re-pointed "does not send if storage refuses to retain the claim" (its trigger now on
   `outgoing_mail`, `when new.status = 'sending'`) sends: 3a-ii's claim does not check that its update
   took. That is 3a-ii's defect; report it, do not work around it.
3. Any assertion other than those under "Assertions that change, by design" needs to change, in
   particular any about which question a reminder names, when a reminder is cancelled, reopened or
   left alone, or which manager receives which box email.
4. `seed.madrid-baseline.test.ts` fails on anything but `attendance_mail`'s absence (its captured
   count is 0: `packages/country-es/test-fixtures/demo/madrid-before-move.manifest.json:35`).
5. Measure 12's insert is accepted on the filled disk (the probe would then prove nothing), or the
   full-disk email is not sent there.
6. A duty case that answers `"unknown"` is not retried after the harness mapping of Task 5, step 1:
   3a-ii's classification does not do what N1 says.

## Global Constraints

- Rules §1–§9 apply in full. Codex builds, Claude reviews (rules §7).
- Keys: `attendance:<question id>`; `alert:<episode id>:<person id>`. `params` hold no row id, secret
  or link (3a-ii): an alert row's alert id is `subject_id`, never a param.
- Lifetimes: `MAIL_LIFETIME_MS.attendance_question` (7 days), `MAIL_LIFETIME_MS.box_alert` (24 h).
- Both owners use delivery rule `"notice"` (today's `resolveEmailDelivery`, `boot.ts:2093`).
- Every write takes the caller's `tx`; queries on one transaction are awaited in turn (CLAUDE.md §3).
- No log line carries an address, a name or a person id (CLAUDE.md §3, personal log keys).
- The full-disk email never writes to the database.

## Review Focus

1. **The five reminder rules** (tables-people.md §1): each has a test that fails if the rule is
   deleted, now pointing at `outgoing_mail` rows. Check especially the reopen: `attempts = 0` →
   `pending`, `attempts > 0` → `rejected`, and that nothing reopens a `sent`, `sending` or `unknown`
   row.
2. **The two kinds of failed send** (N1, N2): a send that never reached the server is retried; one
   cut off after hand-over is not; a handled clock change stops only after the server itself refuses.
3. **A restart in the middle of an episode** — the new duty cases: an alert's mail is sent once
   across a restart; a disk episode's leftover unsent rows are cancelled and requeued, not doubled.
4. **The `{ later }` answer** cannot starve the queue (the "unaddressed oldest question" case) and
   is clamped below `longestWaitMs`.
5. **Measure 12's probe discriminates**: what it prints when the disk is not full (the insert
   succeeds and the case fails).

---

## Part 3b-i — missing-times reminders

**Header (for queuing this pull request on its own)**
- **Needs:** 3a-i and 3a-ii landed with N3, N4 and N5 ("Needs from 3a"). Not 3b-ii, not 3a-iii.
- **Owner lands:** no. **First line:** "Every venue is reset: workforce; backups and exports from
  before this cannot be restored or imported."
- **Size:** ~845 counted lines (code ~320, tests ~520, docs ~5); about 2½ hours.
- **Protection list:** exactly the 3b-i lines under "Expected protection-list difference".
- **Stop points:** 1 (N3, N4, N5), 2, 3, 4.
- **Assertions that change** and **behaviour that moves:** the 3b-i parts of those sections.

**Finish line**, from the worktree root:

```bash
pnpm --filter @waitron/db exec vitest run src/outgoing-mail.test.ts
pnpm --filter @waitron/workforce exec vitest run
pnpm --filter @waitron/server exec vitest run src/mail-sender.test.ts src/attendance-email.test.ts src/attendance-obligations.test.ts src/attendance-restore.test.ts src/attendance-export-api.test.ts src/management-hours-api.test.ts src/personal-data-export-api.workforce.test.ts src/boot.attendance.test.ts src/boot.box-emails.test.ts src/recovery-page-personal-data.test.ts src/background-duties.test.ts src/handover-stepdown.test.ts scripts/demo-seed/seed.madrid-baseline.test.ts
pnpm exec vitest run scripts/classification-complete.test.ts scripts/live-subscriptions.test.ts scripts/append-only-triggers.test.ts scripts/append-only-migration-sets.test.ts scripts/schema-constraints.test.ts scripts/starting-migrations.test.ts scripts/migration-upgrade.test.ts scripts/alert-codes.test.ts scripts/staff-notice-codes.test.ts
pnpm --filter @waitron/composition exec vitest run src/composition.test.ts
node scripts/a1308/3b-attendance-mail-reads.mjs && git status --porcelain   # prints nothing: the script is idempotent on its own output
git grep -n -w -e attendance_mail -e attendanceMail -e attendanceMailDue -e claimAttendanceMail -e reportAttendanceMail -e expireAttendanceMailClaims -e runAttendanceEmailLoop -e runAttendanceEmailPass -e createAttendanceEmailSender -e AttendanceEmailSender -- apps packages scripts ':!**/test-fixtures/**' ':!apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts'
```

The last prints nothing (exit 1); `-w` matches whole words, so the new `attendanceMailRows` and a
comment naming `attendance_mail_claim_ck` do not count. Each Vitest run prints a `Tests` count with no failure (CLAUDE.md
§4). `pnpm --filter @waitron/workforce typecheck` and `pnpm --filter @waitron/server typecheck` pass.
`packages/workforce/src/backup-verification.ts` names no `attendance_mail` before or after
(`git grep -c attendance_mail packages/workforce/src/backup-verification.ts` printed `0` at
`a086eedfb7`), so no backup check changes (tables-people.md §5). `WORKFORCE_CONFIGURATION_TRANSFER`
(`packages/workforce/src/configuration-transfer.ts:1-9`) never listed it, so the export bundle's
format version does not change (rules §9).

### Task 0: record the base protection list

- [ ] Rules §3, into `<A>`, on the base commit (3a-ii landed).

### Task 1: the queue additions — `reopenMail`, `{ later }`, two sender cases

**Files:** `packages/db/src/outgoing-mail.ts`, `outgoing-mail.test.ts`, `index.ts`;
`apps/server/src/mail-sender.ts`, `mail-sender.test.ts`.

**Interfaces:** produces `reopenMail` and the widened `claim` answer, exactly as in "What this plan
takes from 3a, and what it adds".

- [ ] **Step 1: Failing tests.** `outgoing-mail.test.ts`:
  - `"reopens a cancelled row never tried as pending, with the times given and no finish"` — enqueue,
    `cancelMail`, `reopenMail(…, { notAfter: t+7d, nextAttemptAt: t })` → `true`; row `pending`,
    `finishedAt: null`, `nextAttemptAt`/`notAfter` as given, `claimToken: null`.
  - `"reopens a cancelled row that was refused as rejected and waiting, keeping its retry time"` —
    set the row `rejected`, `attempts: 1`, no claim, `nextAttemptAt: t+15min`, then cancel → reopen
    with `nextAttemptAt: t` → `rejected`, `finishedAt: null`, `attempts: 1`, `nextAttemptAt` still
    `t+15min`, `notAfter` as given.
  - `it.each(["pending", "sending", "sent", "unknown", "expired"])("leaves a %s row alone")` → `false`, row unchanged.
  - `"answers false for a key nobody queued"`.

  `mail-sender.test.ts` (3a-ii's test owner):
  - `"puts a row its owner is not ready for back until the time it names, and claims nothing"` —
    `claim` → `{ later: now+10s }`: row `pending`, `attempts: 0`, `claimToken: null`,
    `nextAttemptAt = now+10s`, `send` and `settle` not called; the pass answers `processed: true`.
  - `"clamps a later time beyond the kind's longest wait"` — `{ later: now+1d }` → `nextAttemptAt = now + longestWaitMs`.
  - `"a row put back does not block the row behind it"` — two due rows, the first answers `later`:
    the second is sent in the next pass.
  - `"two passes started together claim a due row once"` — `Promise.all` of two `runMailPass` → `send` called once.
  - `"a report under a lapsed claim changes nothing"` — hold `send` until the clock passes the
    lease and another pass marks it `unknown`; release with `sent`: the row stays `unknown`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/db exec vitest run src/outgoing-mail.test.ts` and
  `pnpm --filter @waitron/server exec vitest run src/mail-sender.test.ts` — the new cases FAIL.
- [ ] **Step 3: Implement.** `reopenMail`: one `update … where dedupe_key = ? and status = 'cancelled'`
  setting `status = case when attempts = 0 then 'pending' else 'rejected' end`, `finished_at = null`,
  `next_attempt_at = case when attempts = 0 then ? else next_attempt_at end`, `not_after`;
  `returning` decides the boolean. `{ later }` goes where the pass handles `owner.claim`'s answer,
  in the claim transaction.
- [ ] **Step 4: Run** — PASS. **Step 5: Commit** `git commit -s`.

### Task 2: the workforce side — the table goes, the rules go through the queue

**Files:** the workforce files, the fixture, the rename script, the seed baseline list (see Files).

**Interfaces — `packages/workforce/src/attendance-mail.ts` after this task:**

```ts
export const attendanceMailKey = (questionId: string) => `attendance:${questionId}`;
/** Queues the question's one reminder, due at `at`, kept MAIL_LIFETIME_MS.attendance_question.
 * A key already queued, whatever its status, is left as it is (today's onConflictDoNothing). */
export function queueAttendanceReminder(tx: Transaction, question: { id: string; personId: string }, at: Date): Promise<void>;
/** Today's name and meaning: pending or waiting-rejected → cancelled; a sending one is left alone. */
export function cancelUnclaimedAttendanceMail(tx: Transaction, questionId: string): Promise<void>;
/** A cancelled reminder whose question came back: reopenMail with nextAttemptAt = at, notAfter = at + 7 days. */
export function reopenAttendanceMail(tx: Transaction, questionId: string, at: Date): Promise<void>;
/** sending, sent or unknown: a send may already have gone out. */
export function attendanceMailAttempted(tx: Transaction, questionId: string): Promise<boolean>;
/** The personal-data export's and the tests' "outcome": sent/unknown/rejected as the status says;
 * cancelled or expired after an attempt → "rejected" (a cancel ends only a never-tried or a refused row); else null. */
export function attendanceMailOutcome(row: Pick<OutgoingMail, "status" | "attempts">): "sent" | "rejected" | "unknown" | null;
```

Callers:
- `attendance-questions.ts:73-82` `ensureReminder` → `cancelUnclaimedAttendanceMail` (unchanged
  branch) or `queueAttendanceReminder(tx, row, at)`. `:215-222` merge: `const attempted = await
  attendanceMailAttempted(tx, duplicate.id)` read **before** cancelling the duplicate's, as today,
  then the same two cancels.
- `attendance-rota.ts:46-55` → `cancelUnclaimedAttendanceMail(tx, id)`; the comment at `:46` stays.
- `end-of-day.ts:57-67` (`cancelReminder`) → `cancelUnclaimedAttendanceMail`; `:88-108` → one
  `reopenAttendanceMail(tx, old.id, at)` (it covers both of today's updates, which keyed on "never
  claimed" and "outcome rejected"); the comment at `:88` stays; `:215-226` → `attendanceMailAttempted`.
- `personal-data.ts:118-136`: left join `outgoingMail` on `dedupe_key = 'attendance:' || attendance_questions.id`
  (written with drizzle's `sql` template and the column, not string concatenation in JavaScript);
  `reminderEmail` keeps its five fields, `outcome` from `attendanceMailOutcome`. The export's shape
  is unchanged.

**Test fixture (`packages/workforce/test/fixtures.ts`, exported as `@waitron/workforce/test/fixtures.js`):**

```ts
/** outgoing_mail rows of kind attendance_question, in today's attendance_mail shape, ordered by next_attempt_at, id. */
export function attendanceMailRows(db: Database | Transaction): Promise<Array<{
  id: string; questionId: string; status: OutgoingMailStatus; claimToken: string | null;
  claimedAt: string | null; nextAttemptAt: string; recipient: string | null;
  outcome: "sent" | "rejected" | "unknown" | null;
}>>;
/** Sets the reminder row of a question as a test needs it: outcome given → attempts 1; a finished
 * status (sent, unknown, cancelled, expired) gets finished_at = claimedAt ?? nextAttemptAt. */
export function setAttendanceMail(db: Database | Transaction, questionId: string, fields: Partial<{
  status: OutgoingMailStatus; claimToken: string | null; claimedAt: string | null;
  nextAttemptAt: string; recipient: string | null; outcome: "sent" | "rejected" | "unknown" | null;
}>): Promise<void>;
/** For tests that seed a question by hand: the row enqueueMail would write, then setAttendanceMail. */
export function insertAttendanceMail(db: Database | Transaction, input: { questionId: string; personId: string } & Parameters<typeof setAttendanceMail>[2]): Promise<void>;
```

- [ ] **Step 1: Re-point the tests first.** Write the script; run it on the workforce and server
  test files listed under Files; then by hand: imports; the `.update(attendanceMail)…where(eq(…questionId|id, …))`
  sites (`attendance-questions.test.ts:221-229, 328-330`, `attendance-rota.test.ts:141-149`,
  `attendance-response-commands.test.ts:534-542`, `end-of-day.obligations.test.ts:48-50, 84-92,
  138-146, 166-174, 279-287`) → `setAttendanceMail`; the inserts (`personal-data.test.ts:495, 517,
  606`, `personal-data-export-api.workforce.test.ts:404`) → `insertAttendanceMail`; the raw
  `select * from attendance_mail order by id` (`attendance-export-api.test.ts:84`,
  `management-hours-api.test.ts:108`) → `select * from outgoing_mail where kind = 'attendance_question' order by id`;
  `attendance-fixture.ts:84` → `attendanceMailRows(suite.db)`;
  `personal-data.coverage.test.ts:111-114`, `index.test.ts:20-24`, `schema-ownership.test.ts:26`
  lose their `attendance_mail` entries. Add two cases to `attendance-questions.test.ts`:
  `"queues a question's reminder under its key, for its person, kept seven days"` (row `kind`,
  `dedupeKey`, `subjectId`, `personId`, `notAfter − queuedAt = 604 800 000`) and
  `"a cancelled reminder queued again for the same question stays cancelled"` (today's
  `onConflictDoNothing` meaning, `attendance-questions.ts:81`).
- [ ] **Step 2: Run** `pnpm --filter @waitron/workforce exec vitest run` — FAIL (compile).
- [ ] **Step 3: Implement**: `attendance-mail.ts`, the callers, personal data; delete the table from
  `schema/attendance.ts` with `mailStatus`/`mailOutcome`; exports; classification; add
  `"attendance_mail"` to `REMOVED_TABLES`.
- [ ] **Step 4: Rebuild** `pnpm --filter @waitron/server migration-baseline rebuild --set workforce`.
- [ ] **Step 5: Run** `pnpm --filter @waitron/workforce exec vitest run` — PASS, with every case's
  assertions as before (rules §4).
- [ ] **Step 6: Commit** `git commit -s`, citing design U4 and tables-people.md §1.

### Task 3: the `attendance_question` owner, boot, and the old loop's removal

**Files:** `apps/server/src/attendance-email.ts`, `attendance-email.test.ts` (moved), `boot.ts`,
`background-duties.ts`, and the server tests under Files. Delete `attendance-email-worker.ts`.

**Interfaces:**

```ts
// apps/server/src/attendance-email.ts
export interface AttendanceReminder {
  locale: "en" | "es"; businessDay: string; venueName: string; missingKinds: readonly ("in" | "out")[];
}
/** Today's words exactly (attendance-email.ts:19-30). */
export function attendanceReminderMessage(reminder: AttendanceReminder): MailMessage;
export const ATTENDANCE_RETRY_MS = 15 * 60_000;
export function attendanceReminderMail(deps: { nodeId: string; venueLanguage: "en" | "es" }): MailKindOwner<AttendanceReminder>;
// kind "attendance_question", deliveryRule "notice",
// retryDelaysMs: Array.from({ length: MAIL_LIFETIME_MS.attendance_question / ATTENDANCE_RETRY_MS }, () => ATTENDANCE_RETRY_MS),
// longestWaitMs: ATTENDANCE_RETRY_MS; compose → attendanceReminderMessage; settle → nothing.
```

`claim(tx, mail, now)`, in this order (today's `attendance-email-worker.ts:66-131`):

1. Read the question by `mail.subjectId`, inner-joined to its person. None → `null` (the subject is
   gone: jobs.md §2).
2. If not eligible — question `active`, `kind = 'missing-times'`, `resolvedByEntryId` null,
   `canonicalQuestionId` null; person `status = 'active'`, email non-null and non-blank after trim
   (today's `eligible`, `:69-79`) — answer `{ later: now + ATTENDANCE_RETRY_MS }`.
3. `reconcileAttendanceResponses(tx, person.id)`; `retireObsoleteRotaQuestions(tx, day)`;
   `reconcileAttendanceDay(tx, { nodeId, personId, day }, now)` (`apps/server/src/attendance-discovery.ts:50`),
   with `day` from the question's `businessDay`, `startAt`, `endAt`.
4. `readMail(tx, mail.dedupeKey)`: `cancelled` (the reconcile cancelled it) → `null`.
5. Re-read the question and person; not eligible, or the question not in `latest.questionIds` →
   `{ later: now + ATTENDANCE_RETRY_MS }`.
6. `{ recipient: email.trim(), prepared: { locale, businessDay, venueName: (await readVenue(tx)).name, missingKinds } }`,
   with locale `es-ES` → `es`, `en-GB` → `en`, else `venueLanguage`, and `missingKinds` `["out"]`
   when `openEntryId` is set, else the question's (`:119-129`).

Boot: delete the `runAttendanceEmailLoop` block (`boot.ts:2443-2458`) and `attendanceEmailLoop`
(`:2421`, `:3883`); `attendanceController` stays (the day loop uses it). Into 3a-ii's `owners`:
`...(workforceEnabled ? [attendanceReminderMail({ nodeId: tradingContext.nodeId, venueLanguage: venueLocale === "es-ES" ? "es" : "en" })] : [])`.
Today's extra start condition `isSingletonPrimary` (`:2422`) is covered by the sender's own
`isPrimary` before every pass. `background-duties.ts`: delete the `attendanceEmailLoop` handle and
closer.

- [ ] **Step 1: Re-point the tests first.**
  - `git mv apps/server/src/attendance-email-worker.test.ts apps/server/src/attendance-email.test.ts`.
    Harness: `pass(overrides)` → `runMailPass({ db, owners: [attendanceReminderMail({ nodeId, venueLanguage })], now: () => now, isPrimary: () => primary, signal: controller.signal, resolveDelivery: async (_tx, rule) => (overrides.resolveDelivery ?? defaultDelivery)(rule), beforeClaim: overrides.beforeClaim, send, log })`.
    In the nine cases listed under "Assertions that change, by design", the body that ran inside
    `resolveDelivery` before returning `{ mode: "smtp", smtp }` moves unchanged into `beforeClaim`
    where `send` is a `MailTransport` fake answering `{ status: "sent" }`; a helper
    `sent()` maps its calls to `{ recipient: message.to, subject, text }`; `mail()` →
    `attendanceMailRows(suite.db)`. The old fake's `"rejected"` / `"unknown"` answers become
    the server refusing (`rejected`, `serverRefused: true`, `email.test_refused`) and a send cut off
    after hand-over (`unknown`, `email.test_timeout`). Those are the meanings this suite's cases give
    them ("retries proven rejection…", "keeps one combined reminder after unknown…").
    Apply "Assertions that change, by design"; everything else keeps its assertions. The primary and
    stop cases (285, 405, 431, 660, 674, 770) keep their gates and `withWriteLock` spies; they now
    drive `runMailPass`, through N3's re-checks (285 and 674 through `beforeClaim`). The first case
    (`:161-247`) seeds prior statuses with `setAttendanceMail` instead of `claimAttendanceMail`/`reportAttendanceMail`.
    "does not send if storage refuses to retain the claim" puts its trigger on `outgoing_mail`.
  - `boot.attendance.test.ts`: spy 3a-ii's `startMailSender` (import `* as mailSender from "./mail-sender.js"`)
    instead of `runAttendanceEmailLoop`, and `./smtp-send.js`'s `sendSmtpMessage` instead of
    `createAttendanceEmailSender`; the enabled case asserts the row `{ status: "sent", recipient: "missing@example.test" }`
    via `attendanceMailRows`, and the transport's message equals
    `attendanceReminderMessage({ locale: "es", businessDay: "2026-01-05", venueName: <venue>, missingKinds: ["in", "out"] })`;
    the disabled case asserts `startMailSender`'s owners hold no `attendance_question`. The
    failing-start case (`:390-430`) makes the step after the day loop throw — the `startMailSender`
    spy — and keeps its assertions on the day loop's signal and `completed`; its `mailSpy` lines go.
  - `boot.box-emails.test.ts`: mock `./mail-sender.js`'s `startMailSender` to record its deps in
    `holder.mail`; `:277-278`/`:340` assert `holder.mail!.owners` has an `attendance_question` owner
    with `deliveryRule: "notice"` and that `withTransaction(suite.db, (tx) => holder.mail!.resolveDelivery(tx, "notice"))`
    answers `{ mode: "unconfigured" }` / mode `smtp`.
  - `recovery-page-personal-data.test.ts:841-870`: the message goes through
    `sendSmtpMessage(relay smtp, { to, ...attendanceReminderMessage(…) })`; assertions on the
    refusal (`rejected`, `email.test_refused`, the relay's recipients) unchanged; the `onFailure`
    half asserts the outcome's `reason` instead.
  - `background-duties.test.ts`, `handover-stepdown.test.ts`: drop `attendanceEmailLoop`.
- [ ] **Step 2: Run** the header's server finish-line command — FAIL.
- [ ] **Step 3: Implement**; delete `attendance-email-worker.ts`.
- [ ] **Step 4: Update `conventions-data.md:4725`**: the attendance row names the
  `attendance_question` owner (`apps/server/src/attendance-email.ts`) on 3a-ii's sender: a retry
  stamped further ahead than its 15-minute wait is due, and a claim stamped further ahead than the
  sender's lease ends unknown (tests: `mail-sender.test.ts`'s backward-step cases;
  `attendance-email.test.ts`, "sends a retry stamped more than its fifteen-minute delay ahead").
- [ ] **Step 5: Run** the header's whole finish line, then the protection list into `<B>` and compare: exactly
  the 3b-i prediction.
- [ ] **Step 6: Commit**, then `/finish-branch` (rules §9).

---

## Part 3b-ii — box alerts

**Header (for queuing this pull request on its own)**
- **Needs:** 3a-i and 3a-ii landed with N1, N2 and N6 ("Needs from 3a"). Not 3b-i, not 3a-iii.
- **Owner lands:** no. **First line:** no reset line; no table changes.
- **Size:** ~970 counted lines (code ~260, tests ~660, docs ~50); about 3 hours.
- **Protection list:** `EQUAL`.
- **Stop points:** 1 (N1, N2, N6), 3, 5, 6.
- **Assertions that change** and **behaviour that moves:** the 3b-ii parts of those sections.

**Finish line:**

```bash
pnpm --filter @waitron/server exec vitest run src/box-alert-email.test.ts src/box-alert-email.duty.test.ts src/box-alert-email.context.test.ts src/box-alert-mail.test.ts src/boot.box-emails.test.ts src/mail-sender.test.ts
WAITRON_REQUIRE_FULL_DISK=1 pnpm --filter @waitron/server exec vitest run src/start-full-disk.e2e.test.ts -t "full-disk email"
pnpm exec vitest run scripts/alert-codes.test.ts scripts/staff-notice-codes.test.ts scripts/live-subscriptions.test.ts scripts/classification-complete.test.ts scripts/guide-links.test.ts
pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts
```

The full-disk run must print `1 passed`, not a skip: `WAITRON_REQUIRE_FULL_DISK=1` turns a missing
small disk into a failure (`apps/server/src/testing/full-disk.ts:15-16`). On Linux it also needs
`WAITRON_FULL_DISK_DIR` (CLAUDE.md §4).

### Task 4: the `box_alert` owner

**Files:** create `apps/server/src/box-alert-mail.ts`, `box-alert-mail.test.ts`; modify
`manager-email-recipients.ts`, and `box-alert-email.ts` (export `BoxAlertCode`, today's internal
`EmailCode`, `:59`, and `boxAlertMailKey`).

**Interfaces:**

```ts
// box-alert-email.ts
export type BoxAlertCode = BoxEmailCode | IncidentEmailCode | typeof BACKUP_REFUSED_EMAIL_CODE;
export const boxAlertMailKey = (episodeId: string, personId: string) => `alert:${episodeId}:${personId}`;

// manager-email-recipients.ts — the same filter as readManagerEmailRecipients (:13-44), for one person
export function readManagerEmailRecipient(tx: Transaction, personId: string, venueLanguage: "en" | "es"): Promise<ManagerEmailRecipient | undefined>;

// box-alert-mail.ts
export const BOX_ALERT_RETRY_DELAYS_MS: readonly number[]; // [60_000, 60_000, 300_000, 900_000, ...24 × 3_600_000]
export interface BoxAlertWords { code: BoxAlertCode; language: "en" | "es"; venue: string; params?: Readonly<Record<string, unknown>> }
export function boxAlertMail(deps: { venueLanguage: "en" | "es"; log: Logger }): MailKindOwner<BoxAlertWords>;
// kind "box_alert", deliveryRule "notice", retryDelaysMs BOX_ALERT_RETRY_DELAYS_MS, longestWaitMs 3_600_000
```

A row's `params`: `{ code: BoxAlertCode, wording: string | null }` — `wording` is
`JSON.stringify` of the episode's first params for a disk, backup or module episode, and `null` for
an alert, whose words are read from its `incidents` row at claim.

`claim`: Decision 4's claim rules, then `{ recipient: recipient.email, prepared: { code, language:
recipient.language, venue: (await readVenue(tx)).name, params } }`. `compose`:
`boxEmailMessage(code, language, venue, params)`. `settle`: `sent` → `log("info", "box_email.sent",
{ code })`; `rejected`/`unknown` → `log("warn", "box_email.send_failed", { code, outcome })`, with
`outcome` `rejected` when `serverRefused` and `unknown` otherwise (Decision 6), unless this row id
already logged that outcome; then Decision 4's `clock.corrected` cancel; `expired` → nothing.

- [ ] **Step 1: Failing tests** (`useVenueDb` with core's set; persons and incidents seeded first):
  `"sends an open alert's email in the manager's own language"`; `"cancels an alert's email once the
  alert is handled"`; `"sends a handled clock change's email, tried or not"`; `"ends a handled
  clock change's email when the mail server refuses it"` (`settle` with `serverRefused: true` →
  `cancelled`); `"keeps a handled clock change's email that never reached the mail server"`
  (`serverRefused: false` → still `rejected` and waiting); `"keeps an open clock change's email the
  mail server refused"`; `"cancels an email whose alert row is gone"`; `"cancels an email for a
  person who is no longer a manager, is suspended, or has no address"`;
  `"words a disk, backup or clock-notice email from the params it was queued with"` (a clock stop's
  two times, a refusal's sizes); `"logs sent once per send and each failed outcome once per row"`;
  `"logs no address or name"`. Assert words against `boxEmailMessage`, never literals.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/box-alert-mail.test.ts` — FAIL.
- [ ] **Step 3: Implement. Step 4: Run — PASS. Step 5: Commit.**

### Task 5: the duty queues instead of sending

**Files:** `apps/server/src/box-alert-email.ts`, `box-alert-email.duty.test.ts`, `boot.ts`,
`boot.box-emails.test.ts`.

**Interfaces:** `startBoxEmailDuty`'s deps gain `db: Database` and `now: () => Date`; everything
else stays, `send` now serving only the full-disk email. Its return is unchanged
(`{ stop, remember }`).

The check (replacing `:369-446`; the read helper, timer, `stop` and the error log stay):

1. Not primary or stopped → nothing.
2. **Disk full** → today's `storage.disk_full` episode and `deliver` (`:322-367`) unchanged, with
   its in-memory `sentTo`, retries and logs; nothing else is read, queued or cancelled; return.
3. Build the live episodes: low space (unless full) with `toldAlready` = the full-disk episode's
   `sentTo`; the backup refusal; the module notices (an unavailable owner's episodes neither start
   nor end, `:425-427`); the open alerts from `readOpenEmailedIncidents`; and every `remember`ed
   `clock.corrected` alert. Each episode holds `id`, `code`, `incidentId?`, first `params`, a
   `queuedFor: Set<personId>`, and today's `said`. Episodes no longer live are ended: removed, and,
   when they have no `incidentId`, their `queuedFor` keys are cancelled in step 5.
4. If any episode is live: read `context` (as today, every check while one lasts). No recipients →
   `box_email.no_recipients` once per episode; `unconfigured` → `box_email.not_configured` once per
   episode; either way queue nothing, and drop `remember`ed entries (today's
   `:327-339`).
5. One `withTransaction`, opened only when there is something to write: on the first such check
   (room on the disk, primary) cancel each `pending`/waiting `rejected` `box_alert` row with
   `subject_id` null (Decision 3) with `cancelMail`; cancel the ended episodes' keys; then for each
   live episode and each recipient not in `queuedFor` and not in `toldAlready` (by today's
   `recipientKey`, `:247-249`), `enqueueMail({ kind: "box_alert", dedupeKey: boxAlertMailKey(id, personId),
   subjectId: incidentId ?? null, personId, params, now: deps.now(), notAfter: now + MAIL_LIFETIME_MS.box_alert })`.
   After it commits, add the pairs to `queuedFor` and drop the queued `remember`ed entries; if it
   throws, change nothing in memory (the next check tries again; `box_email.check_failed` logs it).

`remember(incident)` stores a `clock.corrected` alert until it is queued; any other code is ignored
(today it is dropped at the next check unless open, `:416-422`). Its doc comment's last sentence
(`:255-256`) becomes: "A restart before the next check queues it loses its email; the alert stays in
the bell."

Boot (`boot.ts:2982-3011`): add `db` and `now`; `send: createTextEmailSender()` stays. Into 3a-ii's
`owners`: `boxAlertMail({ venueLanguage: venueLocale === "es-ES" ? "es" : "en", log })`.

- [ ] **Step 1: Re-point the duty tests.** The harness (`box-alert-email.duty.test.ts:30-100`) gains
  `useVenueDb` (core's set), seeds ANA and BEN as active admins with their addresses and locales
  (`es-ES`, `en-GB`) and a venue named `VENUE`, and keeps one clock `t`, moved 60 s per `tick`.
  After each duty check, `tick` runs `runMailPass` until it answers `processed: false`, with
  `owners: [boxAlertMail({ venueLanguage: "en", log })]`, `resolveDelivery` answering
  `state.delivery`, and a `MailTransport` that hands `{ smtp, recipient: to, subject, text }` to the
  existing `d.send` mock and turns its `"sent" | "rejected" | "unknown"` (or throw) into an
  `SmtpSendOutcome` as "Assertions that change, by design" says: `"rejected"` → refused by the
  server; `"unknown"` and a throw → never reached (`email.test_connection_refused`, retried, N1);
  `"uncertain"` → cut off after hand-over (`unknown`). So `d.send`, `d.sent()` and `d.events` keep
  meaning what they mean. `tick` takes `{ advanceMs }` (default 60 000), and is `d.check()` (run the
  armed duty check and wait for it to re-arm) followed by `d.drain()` (sender passes until idle, with
  the harness's own `AbortController` as `signal`); cases that need the two apart call them
  separately. Alerts become `incidents` rows: `d.incidents([A, B])` opens those and handles every
  other one it opened. Each alert the harness inserts gets the next unused `source` from
  `["dashboard", "fiscal_filing", "payment_check", "kitchen_timer", "demo_seed", "readiness_test",
  "operator_script", "backup"]`, never `device`, so no two open alerts collide on
  `incidents_open_dedup`;
  `d.remember(X)` inserts X handled if absent, then calls `handle.remember`. `context` stays a fake
  over `state.recipients`, whose person ids are the seeded ones. Then apply "Assertions that change,
  by design" and the set-up changes listed there.
- [ ] **Step 2: New duty cases:**
  - `"queues one row per manager per episode, kept a day, and none again at the next check"` — low
    space: two rows, `notAfter − queuedAt = 86 400 000`, `params.code` `storage.space_low`; a second
    check writes nothing (count the write turns with a `withWriteLock` spy).
  - `"cancels an ended episode's unsent rows"` — the sender refuses; space recovers; the rows are
    `cancelled`; no further send.
  - `"an alert's email queued before a restart is sent after it, once"` — duty A queues, A stops
    before any sender pass; duty B on the same database checks with the alert still open: no new
    row; one pass sends it once.
  - `"a restart cancels a disk episode's leftover unsent rows and queues them again"` — A queues
    low space, stops; B's first check: the old rows `cancelled`, two new rows; each manager sent once.
  - `"queues nothing while the disk is full and writes nothing"` — full, with an open alert: no
    `outgoing_mail` row; only the full-disk email sent.
  - `"does not send a box email again that may have been delivered"` — `d.send` answers
    `"uncertain"` once: the row is `unknown`, and later ticks send nothing more to that manager.
  - `"retries an email that never reached the mail server on the waits 1, 1, 5 and 15 minutes"` —
    `"unknown"` four times: sends at 0, 1, 2, 7 and 22 minutes, none in between.
  - `"keeps a queued email from being sent after its day"` — queue, move the clock 24 h + 1 ms, pass:
    `expired`, not sent.
- [ ] **Step 3: `boot.box-emails.test.ts`**: the `./smtp-send.js` mock (`:72-75`) records
  `{ recipient: message.to, subject, text }` into `holder.sent` as well as answering `sent`; "boot
  emails a backup refused for room and an open old-backups-deleted alert" (`:395-441`) stores an
  SMTP credential before boot (the shape at `:202-214`) so the sender resolves `smtp`, and waits
  with `vi.waitFor` for both messages; its assertions are unchanged. "boot emails the managers when
  the disk is full, once" is unchanged.
- [ ] **Step 4: Run** the header's first finish-line command — FAIL. **Step 5: Implement. Step 6: Run — PASS.
  Step 7: Commit.**

### Task 6: measure 12, docs, finishing

- [ ] **Step 1: The measure** in `apps/server/src/start-full-disk.e2e.test.ts`, beside "the managers'
  email reads its context on a full disk with a change waiting" (`:1327`) and on its set-up (small
  folder, `applyMigrations` with `manifestSets()`, the seeded venue and admin,
  `wal_checkpoint(truncate)`), but **with no change waiting**. With a change in `change_log`, any
  `withTransaction` on a full disk is refused when it clears the waiting change, before and whatever
  it inserts (the context case's last assertion, `:1365-1367`, refuses `resolveEmailDelivery` that
  way). So that set-up could not tell an `outgoing_mail` insert being refused from a transaction
  not opening. Without a waiting change the only write is the row itself:
  `it("the full-disk email goes out directly while the queue refuses its row; with room, the low-space email is queued", …)`.
  Start `startBoxEmailDuty` with the real `readBoxEmailContext`, `readOpenEmailedIncidents(db)`, no
  notices, a fake `send` answering `sent`, a fake timer, and `disk.since()` answering a date;
  `small.fill(0)`; tick. Assert: `send` called once, with the admin's address and
  `boxEmailMessage("storage.disk_full", "en", "Corner Bistro")`; then
  `await expect(withTransaction(db, (tx) => enqueueMail(tx, { kind: "box_alert", dedupeKey: "alert:probe:<admin>", personId: <admin>, params: { code: "storage.space_low", wording: null }, notAfter: <now + 1 day> }))).rejects.toMatchObject({ code: "storage.disk_full" })`
  (caught outside the whole transaction, CLAUDE.md §2); `select count(*) from outgoing_mail` is 0.
  Control: `small.unfill()`, `disk.since()` answers `null`, `lowSince` a date; tick: `send` still
  called once, and one `outgoing_mail` row, `kind: "box_alert"`, `status: "pending"`, the admin's
  `personId`, `params.code: "storage.space_low"`.
  Before filling, assert `select count(*) from change_log` is 0, so the probe's refusal is the row's.
  **What failure prints:** if the duty tried to queue the full-disk email, `send` was called 0
  times; if the disk were not really full, the probe insert resolves and `rejects` fails — so the
  case cannot pass on a disk with room. The case shows that this one row cannot be written on a
  full disk; it does not show every queue write fails the same way. Run with `WAITRON_REQUIRE_FULL_DISK=1`; it must say `1 passed`.
- [ ] **Step 2: Guides.** `apps/server/src/guide/en/box-status.md:521-530` becomes:

  > Each person gets one email per problem, in their own language, or the venue's if they have not
  > chosen one. If it cannot be sent, because the box has no internet or the mail server refuses it
  > (for example, because the mail server settings have a wrong password), the box tries again a
  > minute later, then after longer and longer waits, for up to a day. So the email arrives once the
  > connection or the settings are fixed, if that happens within the day. If the connection breaks
  > after the mail server has been handed the email, the box cannot tell whether it went and does
  > not send it again. If the problem ends first, for example because the clock was
  > set right, the box stops trying and sends nothing. For a confirmed clock, sales dated wrongly and
  > deleted backups, the box keeps trying while their alert is open in the bell, for up to a day. The
  > full-disk email cannot be saved on a full disk, so the box sends it straight away and tries again
  > each minute while the disk stays full; every other email waits until the disk has room again. A full disk that is only partly freed is still nearly out of space, so
  > anyone the full-disk email did not reach is sent the nearly-out-of-space email instead. A
  > restart while the disk, a backup or the clock stays in trouble can send the same email again.
  > While no mail server is set up, nothing is sent.

  and `:532-536`'s second sentence becomes: "Once a change's alert is handled, the box stops trying
  to send its email to a manager whose address the mail server refused outright after that, and a restart in
  the minute before the email is queued loses it." `apps/server/src/guide/es/box-status.md:562-578`,
  the same in Spanish:

  > Cada persona recibe un correo por problema, en su propio idioma, o en el del local si no ha
  > elegido ninguno. Si no se puede enviar, porque el equipo no tiene internet o el servidor de
  > correo lo rechaza (por ejemplo, porque los ajustes del servidor de correo tienen una contraseña
  > equivocada), el equipo lo vuelve a intentar al cabo de un minuto y después con esperas cada vez
  > más largas, durante un día como mucho. Así, el correo llega en cuanto se arregla la conexión o
  > los ajustes, si es dentro de ese día. Si la conexión se corta después de entregar el correo al
  > servidor de correo, el equipo no puede saber si salió y no lo vuelve a enviar.
  > Si el problema termina antes, por ejemplo porque se puso bien la hora, el equipo deja de
  > intentarlo y no envía nada. Si se confirmó la hora, si hay ventas con fecha incorrecta o si se
  > borraron copias, el equipo lo sigue intentando mientras su aviso esté abierto en la campana,
  > durante un día como mucho. El correo de disco lleno no se puede guardar con el disco lleno, así
  > que el equipo lo envía en el acto y lo vuelve a intentar cada minuto mientras el disco siga
  > lleno; los demás correos esperan a que vuelva a haber espacio. Un disco lleno al que solo
  > se le libera parte del espacio sigue casi sin espacio, así que quien no recibió el correo de
  > disco lleno recibe en su lugar el de poco espacio. Un reinicio mientras el disco, una copia o la
  > hora siguen con problemas puede enviar el mismo correo otra vez. Mientras no haya ningún
  > servidor de correo configurado, no se envía nada.

  and: "Cuando el aviso de un cambio está resuelto, el equipo deja de intentar enviar su correo a un
  encargado cuya dirección rechazó del todo después el servidor de correo, y un reinicio en el minuto antes
  de que el correo quede en cola lo pierde."
- [ ] **Step 3: `conventions-data.md:4540-4544`**: "The managers' email duty queues one
  `outgoing_mail` row per manager for each `clock.corrected`, even after a later step has marked it
  handled (`remember`, `apps/server/src/box-alert-email.ts`; the `box_alert` owner,
  `apps/server/src/box-alert-mail.ts`). Limits: a restart in the minute before it is queued loses the
  email of an alert already handled; once it is handled, an address the mail server refuses
  outright is not tried again; and a send cut off after the email was handed over is never tried
  again (3a-ii's rule)."
- [ ] **Step 4: `docs/backlog/box.md:2314-2319`**: the email "waits until the clock is fixed" no
  longer holds. Replace with: "With a date that early the box cannot check a mail server's
  certificate (`CERT_NOT_YET_VALID`, slice 10 plan P8). That failure comes before the email is
  handed over, so the queue retries it on the box alert waits for a day, by the box's own clock;
  once the clock is set right the email is past its day and is dropped unsent. The alert stays in
  the bell. A plain relay or the practice box's local capture does receive it. For the owner to
  know." Read, not run, unless a TLS relay with a future-dated certificate is to hand; the PR says
  which.
- [ ] **Step 5: Run** the header's whole finish line; the protection list prints `EQUAL`.
- [ ] **Step 6: Commit**, then `/finish-branch` (rules §9).

## Backlog

`git grep -n -i "attendance_mail\|box alert email\|managers' email" docs/backlog docs/backlog.md`
at `a086eedfb7` finds no entry this slice finishes; `docs/backlog/box.md:2314-2319` is reworded in
3b-ii (Task 6). The A1308 entry stays open.

## Decided by the coordinator, 2026-11-08

1. A send that never reached the mail server is `rejected` and retried; only a failure after
   hand-over is `unknown` (N1, with N2's refused-or-not detail). Box alert retries stay, on the
   1, 1, 5, 15 minute then hourly waits for up to a day; the four duty cases keep their assertions.
2. The sender re-checks the primary role and the stop signal inside the claim transaction and
   between claim and send (N3). The reminder worker's re-check cases are re-pointed at the sender,
   not deleted.
3. From the review (2026-11-08): the reminder tests hook "before the claim" through N4; unconfigured
   email leaves a reminder untouched (N5); a claim stopped before its send goes back to `pending`
   (N3); the duty cases' manager order rests on N6.
