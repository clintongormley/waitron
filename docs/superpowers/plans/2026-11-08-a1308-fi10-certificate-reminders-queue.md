# A1308 fiscal 10: certificate expiry reminders go through the one mail queue — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete `fiscal_certificate_reminders`, the module's own outbox for AEAT certificate expiry
emails, and queue each reminder as an `outgoing_mail` row of kind `certificate_reminder`, sent by the
one sender slice 3a built. The deciding half — which certificate, which stage (warning, urgent,
expired), which people — stays in the Veri\*Factu module (jobs.md R6).

**Architecture:** Today `claimReminder` finds the latest certificate install among this box and the
boxes in its takeover history (`readHistoryNodes` and `latestInstallAmong`, since #2570,
`df7fc95182`), decides the stage, inserts or re-claims a reminder row looked up across the same
history, and returns the wording for one recipient; the server's loop sends it over SMTP and reports
the outcome back (`packages/fiscal-verifactu/src/certificate-reminders.ts:55-158`,
`apps/server/src/certificate-reminder-worker.ts:47-80`). After this pull request the module's
`queueReminders` decides the stage and enqueues one mail per recipient with the dedupe key
`certificate:<install id>:<stage>:<person id>` through slice 3a-ii's `enqueueMail`; a kind owner,
`certificateReminderMail` (a `MailKindOwner`, 3a-ii Task 3), reads the person's address and language
at claim and words the mail through the module's `wordReminder`; 3a-ii's sender sends and records the
outcome. The hourly decision on the primary stays (as a loop, or as jr4's `fiscal.certificate_reminders`
job if jr4 landed first), and now only queues.

**Tech stack:** TypeScript, drizzle-orm on `node:sqlite`, Vitest.

**Spec:** [tables-fiscal.md](../specs/2026-11-02-rationalisation/tables-fiscal.md) §1.1
"`fiscal_certificate_reminders` goes", §5 (its row); [jobs.md](../specs/2026-11-02-rationalisation/jobs.md)
R5, R6, "Draft: the `outgoing_mail` table" (kind, dedupe key, "Where today's protections go", "Rules
each kind needs from the queue", "Don't send after" = 7 days for `certificate_reminder`); README §5
U4; [3a-ii](2026-11-08-a1308-3a-ii-mail-queue.md) ("What it builds", Task 2's `enqueueMail` and
`MAIL_LIFETIME_MS`, Task 3's `MailKindOwner`); [3b](2026-11-08-a1308-3b-reminders-and-alerts-on-queue.md)
(`boxAlertMail`, the pattern this owner follows; `reopenMail`, Task 1, which this plan leaves as it is); [jr4](2026-11-08-a1308-jr4-working-time-and-mail.md)
Task 3 (the decision as a job; it builds against either shape); rules [2026-11-08-a1308-slice-rules.md](2026-11-08-a1308-slice-rules.md).

**Base:** `main` after fi9, with slices 3a-ii and 3b landed. Line numbers read at `9c66ef0356`
(after #2570, which changed `claimReminder` and `reportReminder` to read across the takeover
history).

**Owner lands:** yes (every fiscal-area pull request; build order). The change touches no record,
sending to AEAT or identity.

**Pull request's first line:** "Every venue is reset: fiscal-verifactu; backups and exports from
before this cannot be restored or imported." (`outgoing_mail`'s kind list already holds
`certificate_reminder`, 3a-ii "What it builds" item 1, so core's set is not rebuilt.)

## What slice 3a-ii gives this plan

Read from [3a-ii](2026-11-08-a1308-3a-ii-mail-queue.md); a name that differs on `main` is a stop
(rules §5.1):

1. **Enqueue** — `enqueueMail(tx, { kind, dedupeKey, subjectId, personId, params, notAfter })` in
   `@waitron/db`; a key already queued is not queued again and answers `queued: false`, whatever the
   row's status. `MAIL_LIFETIME_MS.certificate_reminder` is 604,800,000 ms (seven days).
2. **A kind owner** — `MailKindOwner` with `deliveryRule`, `retryDelaysMs`, `longestWaitMs`,
   `claim` (in the claim transaction: returns the recipient's address and anything prepared, or
   `null` to cancel), `compose` and `settle`; boot passes the owners to `startMailSender`.
3. **Retries** — `rejected` is retried after each of `retryDelaysMs`; `unknown` and an abandoned
   claim are never sent again; a row past `not_after` is `expired`. So today's rule, "a failed one is
   retried once its report is a day old; claimed or unknown never again"
   (`certificate-reminders.ts:55-58`, `RETRY_AFTER_MS` `:13`), becomes `retryDelaysMs` = six entries of 86,400,000 ms
   and `longestWaitMs` 86,400,000. One consequence, from the owner's seven-day lifetime (README §10):
   a reminder whose server keeps refusing it is retried for a week, not for the whole stage.
4. **Unconfigured email** — the sender leaves due rows untouched while email is unconfigured (3a-ii
   decision A), but it still expires every waiting row past `not_after` in the same pass, before it
   looks at the delivery (3a-ii "One pass", step 3, first two bullets). The deciding pass keeps
   today's early return while `resolveAccountEmail` answers `unconfigured`
   (`certificate-reminder-worker.ts:52-53`), so nothing is queued while email is off. That does not
   cover a reminder queued while email worked, whose mail is then switched off (or whose saved server
   stops resolving) for longer than seven days: the row expires untried, and its key answers
   `queued: false` for the rest of that stage, so that person gets no reminder for it. Today the row
   would be claimed whenever email came back. This plan's fix is open to the owner (below).
5. **Reopening** — 3b's `reopenMail(tx, dedupeKey, { notAfter, nextAttemptAt })` reopens a
   `cancelled` row and leaves `pending`, `sending`, `sent`, `unknown` and `expired` alone (3b Task 1's
   cases). This plan does not change it.

## Global Constraints

- Rules §1–§9 apply.
- **The same mails go to the same people at the same stages.** One mail per certificate, stage and
  person; never twice; none while the venue's mail is not configured (as today: the pass returns
  early, so a reminder waits for configuration rather than being queued and expiring; one queued
  before email went off and expired untried is offered again once it works, owner question below);
  the wording and the day it names unchanged. `certificate-reminders.test.ts`'s cases keep their assertions where
  they describe these outcomes, re-pointed at `outgoing_mail` rows.
- No email address is stored by the deciding half (`schema/certificate-reminders.ts`, the `person_id`
  comment): the row names the person.
- `outgoing_mail.subject_id` is a plain id, never a key: `verifactu_certificates` is `local` and
  `outgoing_mail` is not (CLAUDE.md §3; tables-fiscal §1.1).

## Review Focus

1. **Twice on a second box.** Answered by #2570, not left open. Since it, a box that took over reads
   the first box's install and reminder rows (`certificate-reminders.ts:65-80`, `inArray(…nodeId,
   history)`), does not resend a reminder the first box claimed or sent, and retries one it reported
   failed (the docstring at `:55-58`: "also on a box that took over from the one that wrote it"). The
   queue keeps that: the dedupe key names the install id, which `latestInstallAmong` (`certificate-record.ts:18-29`)
   finds on both boxes, so the new primary's pass answers `queued: false` for a key the first box
   queued; 3a-ii's sender drains every owned waiting row on whichever box is primary (no column ties
   a row to a box, 3a-ii "Columns"), and boot's `abandonMailClaims` turns a copied `sending` row to
   `unknown`, never sent again. Worst case, read from the two plans and not run: a row the first box
   sent after the copy was taken arrives `pending` on the second box and is sent once more, one
   duplicate email per such row. A test pins the `queued: false` half (Task 1).
2. **Wording at send time.** The day count ("in 3 day(s)") is computed when the mail is worded, as
   today (claim and send were moments apart; now queue and send may be further apart, bounded by the
   seven-day `not_after`).

---

## What it builds

- `queueReminders(tx, { nodeId }, personIds, now)` in `certificate-reminders.ts`: reads the latest
  install among the takeover history and its stage exactly as `claimReminder` does (`:65-70`:
  `readHistoryNodes`, `latestInstallAmong`, `venueTimeZone`, `certificateStage`), and for each person
  enqueues `{ kind: "certificate_reminder", dedupeKey: \`certificate:${install.id}:${stage}:${personId}\`,
  subjectId: install.id, personId, params: { stage, validUntil: install.validUntil.toISOString(), timeZone }, notAfter: now + 7 days }`.
  When `enqueueMail` answers `queued: false` and `readMail` shows the row `expired` with
  `attempts = 0` (never tried), it offers it again with `reofferUntriedMail(tx, key, { notAfter: now + 7 days, nextAttemptAt: now })`
  (owner question, default). Returns how many rows it queued or reopened.
- `wordReminder({ params, language, now })`: today's `wording` and `formatDay`
  (`certificate-reminders.ts:18-53`), with the date and day count computed from `params` as
  `claimReminder` does at `:125-126`.
- The seat `FiscalCertificateSeat.reminders` (`packages/fiscal/src/contribution.ts:129`) becomes
  `{ queue, word }`; `slot.ts:133` wires them.
- `runCertificateReminderPass` (`apps/server/src/certificate-reminder-worker.ts`) keeps its guards
  (primary, signal, configured mail) and calls `queue` once, with the person ids
  `readManagerEmailRecipients` returns; it sends nothing. The loop keeps its hourly sleep.
- `certificateReminderMail(deps: { seat; venueLanguage })` in a new
  `apps/server/src/certificate-reminder-mail.ts` (beside 3b's `box-alert-mail.ts`): kind
  `certificate_reminder`, `deliveryRule: "notice"`, the retry values above; `claim` reads the
  person's address and language the way `readManagerEmailRecipients` does today
  (`apps/server/src/manager-email-recipients.ts`) and returns `null` (cancelling the row) when that
  person no longer receives these mails or has no address; `compose` calls `seat.reminders.word`;
  `settle` does nothing. Boot adds it to the owners passed to `startMailSender`.
- Deleted: `fiscal_certificate_reminders`, `schema/certificate-reminders.ts`, `reportReminder`,
  `claimReminder`, `apps/server/src/certificate-reminder-email.ts` (its sender is the shared one),
  the boot wiring of `send` (`boot.ts:2475`), the classification entry (`classification.ts:28-32`),
  the handover manifest entry (`packages/handover/src/manifest.ts:104-110`), the backup links
  (`backup-verification-history.ts:443`; `backup-verification-secrets.ts:17`, whose list then holds
  `fiscal_certificate_installs` alone; #2570 changed that file, so the builder re-reads it).
- **`reofferUntriedMail(tx, dedupeKey, { notAfter, nextAttemptAt })`** in `packages/db/src/outgoing-mail.ts`
  (if the owner takes the default below): sets an `expired` row whose `attempts` is 0 back to
  `pending`, `finished_at` and `failure_code` null, with the times given, and answers `true`; any
  other row is left alone and answers `false`. A function of its own rather than a wider 3b
  `reopenMail`: 3b's attendance reminders call `reopenMail` when a question comes back (3b "What this
  plan takes from 3a", item 2), and 3b's Task 1 pins that it leaves an `expired` row alone
  (`it.each([… "expired"])("leaves a %s row alone")`), so widening it would change what they do; whether
  they should is not this plan's question.

## What it leaves out

| Left out | Who takes it |
| --- | --- |
| The decision as a runner job | jr4 Task 3, before or after this pull request: this plan changes the pass body only |
| Moving the stage check into the database | Never: jobs.md drops `fiscal_certificate_reminders_stage_ck` "with this reason" — the stage is checked by the code that builds the key |
| How long finished mail rows stay | A980 (README §10) |

## Files

**Modify:** `packages/db/src/outgoing-mail.ts`, `outgoing-mail.test.ts`, `packages/db/src/index.ts`
(`reofferUntriedMail`, if the owner takes the default), `packages/fiscal-verifactu/src/certificate-reminders.ts`, `certificate-reminders.test.ts`,
`slot.ts:11`, `:133`, `classification.ts`, `schema/index.ts`, `backup-verification-history.ts:443`,
`backup-verification-secrets.ts:17`, `packages/fiscal/src/contribution.ts:125-135`,
`packages/handover/src/manifest.ts:104-110`, `apps/server/src/certificate-reminder-worker.ts`,
`certificate-reminder-worker.test.ts`, `apps/server/src/boot.ts:331-332`, `:2462-2481` and where
3a-ii/3b pass `owners` to `startMailSender`, `scripts/schema-constraints.test.ts`,
`apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts` (`REMOVED_TABLES`; 0 captured rows).

**Create:** `apps/server/src/certificate-reminder-mail.ts`, `certificate-reminder-mail.test.ts`.

**Delete:** `packages/fiscal-verifactu/src/schema/certificate-reminders.ts`,
`apps/server/src/certificate-reminder-email.ts`.

**Generated:** `packages/fiscal-verifactu/drizzle/*`, `scripts/migration-baseline-epoch.json`.

## Size

| Counted (hand-written) | Lines, estimated |
| --- | --- |
| Code: `queueReminders` 55, `wordReminder` 20, seat 10, pass 25, kind owner 50, `reofferUntriedMail` 20, boot 6, lists 6 | ~190 |
| Tests: re-pointed reminder cases 120, the takeover and expired-untried cases 50, `reofferUntriedMail` cases 35 (an untried expired row reopened; a tried one, and each other status, left alone), pass cases 60, kind-owner case 40 | ~305 |
| **Total** | **~495** |

## Finish line

```bash
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/certificate-reminders.test.ts src/certificate-alerts.test.ts src/certificate-card.test.ts src/slot.test.ts src/backup-verification-history.test.ts src/backup-verification-secrets.test.ts src/classification.test.ts
pnpm --filter @waitron/fiscal exec vitest run
pnpm --filter @waitron/handover exec vitest run
pnpm --filter @waitron/db exec vitest run src/outgoing-mail.test.ts
pnpm --filter @waitron/server exec vitest run src/certificate-reminder-worker.test.ts src/certificate-reminder-mail.test.ts src/mail-sender.test.ts src/boot.test.ts scripts/demo-seed/seed.madrid-baseline.test.ts
pnpm exec vitest run scripts/schema-constraints.test.ts scripts/classification-complete.test.ts scripts/starting-migrations.test.ts scripts/two-file-foreign-keys.test.ts
git grep -nw "fiscal_certificate_reminders\|fiscalCertificateReminders\|claimReminder\|reportReminder\|createCertificateReminderSender" -- apps packages scripts ':!**/drizzle/**' ':!packages/country-es/test-fixtures/**' ':!apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts'
```

The grep prints nothing.

## Expected protection-list difference

Three headers, `composition=fiscal-verifactu`, `database=venue`, each (simulated on 2026-11-08 from
`a086eedfb7` with fi1–fi9 applied; the table had no append-only trigger):

```text
missing index fiscal_certificate_reminders.primary key(id)
missing index fiscal_certificate_reminders_uq
missing table fiscal_certificate_reminders
```

Nothing for `outgoing_mail`: its kind list already holds `certificate_reminder`.
Design reasons: tables-fiscal §5 (`fiscal_certificate_reminders` → `outgoing_mail`: "the unique
becomes its dedupe key … The FK cannot follow"); jobs.md "Where today's protections go".

## Stop points (beyond rules §5)

1. A 3a-ii name or behaviour in "What slice 3a-ii gives this plan" is not what `main` holds.
2. A reminder case can only pass with a different recipient set, stage, wording, day, or count of
   mails.
3. The pass queues while the venue's mail is unconfigured.
4. Any change to a fiscal record, to what is sent to AEAT, or to which identity or series a sale uses.

## Needs

fi9; slices 3a-ii and 3b. jr4 in either order.

**Landed by: owner.**

## Open question for the owner

**A reminder that expired untried while email was off: offer it again?** Example: a manager's
"expires in 30 days" reminder is queued on 1 March; the saved mail server is removed on 2 March and
put back on 12 March. The row expired on 8 March without a try, and every hourly pass since answers
`queued: false` for its key, so that manager gets no reminder at the 30-day stage at all; today the
row would have been claimed on 12 March. Choices:

1. **(Recommended default)** Reopen it: when the key's row is `expired` and was never tried
   (`attempts = 0`), the deciding pass offers it again with a fresh seven days, through a new
   `reofferUntriedMail` beside 3b's `reopenMail` (which stays as 3b built it). A row that was tried and kept failing for its week
   stays expired, as the seven-day lifetime intends (README §10).
2. Leave it: the person waits for the next stage's reminder (`urgent`, then `expired`), and the
   card and alerts still show the certificate's date.

The builder takes the default unless the owner answers before Task 1. (The second-box question the
plan's first version asked here is answered by #2570; Review Focus 1.)

---

### Task 0: record the base protection list

- [ ] As fi1 Task 0, into `<A>`.

### Task 1: queue instead of claim (test first)

- [ ] **Step 1:** Check the five points in "What slice 3a-ii gives this plan" against `main`
  (stop 1 if any differs).
- [ ] **Step 2: Failing tests** in `certificate-reminders.test.ts`, keeping each existing case's
  outcome: "queues one mail per manager at the stage the certificate is in" (the rows' kind, dedupe
  key, person, `subject_id`, `params`, `not_after` = now + 7 days); "never queues the same
  certificate, stage and person twice" (a second call queues 0); "queues nothing without a
  certificate, or before the warning stage"; "a new stage queues new mails"; "stores no address"
  (`recipient` is null on every queued row); "a box that took over queues nothing for a key the
  first box queued" (an install and a queued row written under a node in this box's takeover
  history, then `queueReminders` on the new node: 0 queued, the one row unchanged); "reopens a
  reminder that expired untried" and "leaves one that expired after a try" (the default). In
  `certificate-reminder-worker.test.ts`: "queues
  nothing while mail is unconfigured"; "queues only on the primary"; "sends nothing itself" (no
  sender is passed).
- [ ] **Step 3:** Run; FAIL. **Step 4:** Implement `queueReminders`, `wordReminder`, the seat and the
  pass. Run; PASS. Commit: "Certificate reminders are queued as outgoing mail (A1308 fiscal 10)".

### Task 2: the kind owner and the sender

- [ ] **Step 1: Failing test** `certificate-reminder-mail.test.ts`, driving `runMailPass` with
  `owners: [certificateReminderMail(…)]` as 3b's harness does (3b plan `:662`): a queued row for a
  person whose language is `es` is sent to their address with today's Spanish subject and text for
  that date and day count (expected strings copied from `certificate-reminders.test.ts`); a
  `rejected` send is claimed again after a day and not before; an `unknown` one never again; a row
  for a person who no longer receives these mails is cancelled at claim.
- [ ] **Step 2:** Write the owner; add it to boot's owners. Run; PASS. Commit: "The mail sender words certificate
  reminders through the fiscal module (A1308 fiscal 10)".

### Task 3: delete the table and the old sender; finish

- [ ] **Step 1:** Delete the schema file, `claimReminder`, `reportReminder`,
  `certificate-reminder-email.ts`, the boot `send` wiring, and the list entries. Rebuild the set. Run
  the Finish line. PASS.
- [ ] **Step 2:** Protection list against `<A>`: exactly "Expected protection-list difference".
- [ ] **Step 3: Documents:** `apps/server/README.md` (the reminder loop's description: it queues;
  the shared sender sends); `docs/developers/conventions-data.md` if it names the table; the guide
  needs no change (the emails' words are unchanged).
- [ ] **Step 4:** Commit; `/finish-branch` (full wave). After landing, `wa-wt reset`.
