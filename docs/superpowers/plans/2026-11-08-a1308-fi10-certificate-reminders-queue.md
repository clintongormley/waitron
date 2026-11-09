# A1308 fiscal 10: certificate expiry reminders go through the one mail queue — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete `fiscal_certificate_reminders`, the module's own outbox for AEAT certificate expiry
emails, and queue each reminder as an `outgoing_mail` row of kind `certificate_reminder`, sent by the
one sender slice 3a built. The deciding half — which certificate, which stage (warning, urgent,
expired), which people — stays in the Veri\*Factu module (jobs.md R6). And the reminders come more
often (**owner, 2026-11-09**, "these are important, bug the owner"): **weekly** from the start of the
warning period, **daily** from the urgent point, and **daily** after expiry, all stopping as soon as a
new certificate is installed. Today each person gets one email per stage.

**Architecture:** Today `claimReminder` finds the latest certificate install among this box and the
boxes in its takeover history (`readHistoryNodes` and `latestInstallAmong`, since #2570,
`df7fc95182`), decides the stage, inserts or re-claims a reminder row looked up across the same
history, and returns the wording for one recipient; the server's loop sends it over SMTP and reports
the outcome back (`packages/fiscal-verifactu/src/certificate-reminders.ts:55-158`,
`apps/server/src/certificate-reminder-worker.ts:47-80`). After this pull request the module's
`queueReminders` decides the stage and the reminder period inside it (a week in `warning`, a local
day in `urgent` and `expired`) and enqueues one mail per recipient per period with the dedupe key
`certificate:<install id>:<period>:<person id>` through slice 3a-ii's `enqueueMail`; a kind owner,
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
   and `longestWaitMs` 86,400,000. A reminder's `not_after` is the end of its period (below), never
   more than 3a-ii's seven days, so a weekly reminder the server keeps refusing is retried daily for
   its week (the owner confirmed this on 2026-11-09), and a daily one gets one try a day: the next
   day's reminder is a new row.
4. **Unconfigured email** — the sender leaves due rows untouched while email is unconfigured (3a-ii
   decision A), but it still expires every waiting row past `not_after` in the same pass, before it
   looks at the delivery (3a-ii "One pass", step 3, first two bullets). The deciding pass keeps
   today's early return while `resolveAccountEmail` answers `unconfigured`
   (`certificate-reminder-worker.ts:52-53`), so nothing is queued while email is off. A reminder
   queued while email worked, whose mail is then switched off, expires at the end of its period; the
   next period's reminder (at most a week later in `warning`, the next day in `urgent` and
   `expired`) is queued once email works. So no expired reminder is offered again: the earlier plan's
   `reofferUntriedMail` and its owner question are dropped, because the new
   schedule already sends the next one.
5. **Reopening** — 3b's `reopenMail(tx, dedupeKey, { notAfter, nextAttemptAt })` reopens a
   `cancelled` row and leaves `pending`, `sending`, `sent`, `unknown` and `expired` alone (3b Task 1's
   cases). This plan does not change it.

## Global Constraints

- Rules §1–§9 apply.
- **The same people, the same stages and the same words; more often** (owner, 2026-11-09). One
  mail per certificate, period and person, never twice: a period is a week in `warning` (counted
  from the day the warning stage begins, so the first goes that day) and a local day in `urgent`
  and `expired`. None while the venue's mail is not configured (as today: the pass returns early).
  None once a newer certificate is installed: the deciding pass reads the latest install, and the
  kind owner cancels at claim a queued row whose install is no longer the latest. The wording and the
  day it names are unchanged. `certificate-reminders.test.ts`'s cases keep their assertions where
  they describe these outcomes, re-pointed at `outgoing_mail` rows; the ones that pinned "once per
  stage" change, as listed under "Assertions that change, by design".
- **Who receives them** is unchanged: `readManagerEmailRecipients`
  (`apps/server/src/manager-email-recipients.ts`) — every active person with an email address whose
  role holds `system.manage`, which on `origin/main` (`5ed6b4dc06`) is the `manager` and `admin`
  roles (`packages/identity/src/permissions.ts:45-64`). The venue's owner signs in as an `admin`, so
  the owner is among them whenever their account is active and has an email address saved; there is
  no separate owner address to add.
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
   period's `not_after`: an `urgent` row ends no later than the certificate's expiry, so it never
   says "expires" after it has expired).
3. **The schedule's edges.** The first weekly reminder on the day `warning` begins; the switch to
   daily on the day `urgent` begins (a weekly row still waiting then is cut off by its `not_after`,
   which is capped at the urgent start); daily after expiry with no end; nothing once a newer install
   exists, including a row already queued for the old one.

---

## What it builds

- `reminderPeriod(kind, now, validUntil, timeZone)` in `certificate-dates.ts` (pure, beside
  `certificateStage` and `stageSince`, `:41-63`): `null` when `certificateStage` is `null`; otherwise
  `{ stage, period, endsAt }`:
  - `warning`: `period` = `warning:w<n>`, where `n` is the whole weeks since the warning stage's first
    local day (`localDate(validUntil) − CERTIFICATE_THRESHOLDS[kind].warning`, the day `stageSince`
    starts from); `endsAt` = local midnight 7 × (n + 1) days after that first day, or the urgent
    stage's start (`stageSince(kind, "urgent", …)`) if that is earlier.
  - `urgent`: `period` = `urgent:<local date>`; `endsAt` = the next local midnight, or `validUntil`
    if that is earlier.
  - `expired`: `period` = `expired:<local date>`; `endsAt` = the next local midnight.
  The thresholds stay `CERTIFICATE_THRESHOLDS` (`:7-12`: `sello` 90 and 30 days, `representante`
  60 and 14).
- `queueReminders(tx, { nodeId }, personIds, now)` in `certificate-reminders.ts`: reads the latest
  install among the takeover history exactly as `claimReminder` does (`:65-70`: `readHistoryNodes`,
  `latestInstallAmong`, `venueTimeZone`), takes `reminderPeriod`, and for each person enqueues
  `{ kind: "certificate_reminder", dedupeKey: \`certificate:${install.id}:${period}:${personId}\`,
  subjectId: install.id, personId, params: { stage, validUntil: install.validUntil.toISOString(), timeZone }, notAfter: endsAt }`.
  Returns how many rows it queued.
- `wordReminder({ params, language, now })`: today's `wording` and `formatDay`
  (`certificate-reminders.ts:18-53`), with the date and day count computed from `params` as
  `claimReminder` does at `:125-126`.
- The seat `FiscalCertificateSeat.reminders` (`packages/fiscal/src/contribution.ts:129`) becomes
  `{ queue, word, current }` (`current(tx, nodeId)` answers the latest install's id, or `null`);
  `slot.ts:133` wires them.
- `runCertificateReminderPass` (`apps/server/src/certificate-reminder-worker.ts`) keeps its guards
  (primary, signal, configured mail) and calls `queue` once, with the person ids
  `readManagerEmailRecipients` returns; it sends nothing. The loop keeps its hourly sleep.
- `certificateReminderMail(deps: { seat; venueLanguage })` in a new
  `apps/server/src/certificate-reminder-mail.ts` (beside 3b's `box-alert-mail.ts`): kind
  `certificate_reminder`, `deliveryRule: "notice"`, the retry values above; `claim` reads the
  person's address and language the way `readManagerEmailRecipients` does today
  (`apps/server/src/manager-email-recipients.ts`) and returns `null` (cancelling the row) when that
  person no longer receives these mails or has no address, or when the row's install (`subject_id`)
  is no longer the latest install among this box's takeover history (a new certificate was
  installed after it was queued; through the seat, `seat.reminders.current(tx)`, so the server does
  not read the fiscal tables itself); `compose` calls `seat.reminders.word`;
  `settle` does nothing. Boot adds it to the owners passed to `startMailSender`.
- Deleted: `fiscal_certificate_reminders`, `schema/certificate-reminders.ts`, `reportReminder`,
  `claimReminder`, `apps/server/src/certificate-reminder-email.ts` (its sender is the shared one),
  the boot wiring of `send` (`boot.ts:2475`), the classification entry (`classification.ts:28-32`),
  the handover manifest entry (`packages/handover/src/manifest.ts:104-110`), the backup links
  (`backup-verification-history.ts:443`; `backup-verification-secrets.ts:17`, whose list then holds
  `fiscal_certificate_installs` alone; #2570 changed that file, so the builder re-reads it).

## What it leaves out

| Left out | Who takes it |
| --- | --- |
| The decision as a runner job | jr4 Task 3, before or after this pull request: this plan changes the pass body only |
| Moving the stage check into the database | Never: jobs.md drops `fiscal_certificate_reminders_stage_ck` "with this reason" — the stage is checked by the code that builds the key |
| How long finished mail rows stay | A980 (README §10). At one row per manager per day while a certificate is urgent or expired, the queue holds more rows than today's one per stage; A980 prunes finished ones |
| Offering an expired reminder again (the earlier `reofferUntriedMail`) | Not built: the next period's reminder replaces it (owner's schedule, 2026-11-09) |

## Files

**Modify:** `packages/fiscal-verifactu/src/certificate-dates.ts`, `certificate-dates.test.ts`
(`reminderPeriod`), `packages/fiscal-verifactu/src/certificate-reminders.ts`, `certificate-reminders.test.ts`,
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
| Code: `reminderPeriod` 30, `queueReminders` 55, `wordReminder` 20, seat 15, pass 25, kind owner 60 (with the newer-install cancel), boot 6, lists 6 | ~215 |
| Tests: `reminderPeriod` cases 70 (each stage's period and end, both certificate kinds, the week and urgent edges, a time zone whose day differs from UTC), re-pointed reminder cases 130, the takeover cases 35, pass cases 60, kind-owner cases 60 (with the newer-install cancel) | ~355 |
| **Total** | **~570** |

## Finish line

```bash
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/certificate-dates.test.ts src/certificate-reminders.test.ts src/certificate-alerts.test.ts src/certificate-card.test.ts src/slot.test.ts src/backup-verification-history.test.ts src/backup-verification-secrets.test.ts src/classification.test.ts
pnpm --filter @waitron/fiscal exec vitest run
pnpm --filter @waitron/handover exec vitest run
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
2. A reminder case can only pass with a different recipient set, stage, wording or day, or with
   a count of mails other than the schedule's (one per person per week in `warning`, per local day in
   `urgent` and `expired`).
3. The pass queues while the venue's mail is unconfigured.
4. Any change to a fiscal record, to what is sent to AEAT, or to which identity or series a sale uses.

## Needs

fi9; slices 3a-ii and 3b. jr4 in either order.

**Landed by: owner.**

## Owner decisions (2026-11-09)

- **The schedule.** "These are important, bug the owner": weekly from the start of the warning
  period (90 days before expiry for `sello`, 60 for `representante`), daily from the urgent point
  (30 and 14 days), daily after expiry, all stopping as soon as a new certificate is installed.
  Built here (What it builds).
- **A reminder that expired untried while email was off.** The earlier question (offer it again?)
  falls away: with a reminder every week or every day, the next one is queued once email works, so
  nothing is offered again and `reofferUntriedMail` is not built.
- **A reminder the server keeps refusing is retried daily** within its period; **after a takeover,
  at worst one reminder email is sent twice** (Review Focus 1). Both confirmed.

(The second-box question the plan's first version asked is answered by #2570; Review Focus 1.)

## Assertions that change, by design

Owner, 2026-11-09 (the schedule). Each re-pointed case keeps its recipients, stage, words and day:

- "claims each recipient once per stage, lowest person id first, then nothing"
  (`certificate-reminders.test.ts:85`) becomes "queues one mail per manager for this week of the
  warning stage, then nothing that week": still once each in the same period, and its rows' keys
  name the period (`warning:w<n>`), not the stage alone.
- "claims again when the certificate moves from warning to urgent" (`:108`) keeps its assertion
  (a new mail at the urgent stage, with "14 day(s)") and gains its twin: "a second urgent day queues
  again".
- The handover case "the box that took over sends the next stage of the old box's certificate"
  (`:276`) keeps its assertion; its stored row's key names the urgent day.
- "claims a rejected send again only once more than 24 hours have passed" (`:124`) moves to the kind
  owner's test (3a-ii's retry), for a weekly row; a daily row is not retried after its day ends.

---

### Task 0: record the base protection list

- [ ] As fi1 Task 0, into `<A>`.

### Task 1: queue instead of claim (test first)

- [ ] **Step 1:** Check the five points in "What slice 3a-ii gives this plan" against `main`
  (stop 1 if any differs).
- [ ] **Step 2: Failing tests.** In `certificate-dates.test.ts`, for `reminderPeriod`, each with a
  `sello` and a `representante` certificate: "no period before the warning stage"; "the first
  warning day is week 0 and the seventh day later is week 1" (90 and 60 days before, then 83 and
  53); "the last warning week ends at the urgent start, not seven days on" (a week that would cross
  the 30 or 14 day point); "every urgent day is its own period, ending at the next local midnight";
  "the last urgent day ends at the certificate's expiry"; "every day after expiry is its own period";
  "periods follow the venue's local day" (`Europe/Madrid` just after local midnight, when UTC is
  still on the previous day). In `certificate-reminders.test.ts`, keeping each existing case's
  outcome except those under "Assertions that change, by design": "queues one mail per manager for
  the period the certificate is in" (the rows' kind, dedupe key `certificate:<install>:<period>:<person>`,
  person, `subject_id`, `params`, `not_after` = the period's end); "never queues the same
  certificate, period and person twice" (a second call in the same period queues 0); "queues again
  each week of the warning stage" (a week later: one more per manager); "queues again each day of
  the urgent stage and after expiry" (the next local day: one more each); "queues nothing without
  a certificate, or before the warning stage"; "queues nothing for an old certificate once a newer
  one is installed"; "stores no address" (`recipient` is null on every queued row); "a box that
  took over queues nothing for a key the first box queued" (an install and a queued row written
  under a node in this box's takeover history, then `queueReminders` on the new node in the same
  period: 0 queued, the one row unchanged). In `certificate-reminder-worker.test.ts`: "queues
  nothing while mail is unconfigured"; "queues only on the primary"; "sends nothing itself" (no
  sender is passed). Proof by deletion: with `reminderPeriod` answering the stage alone as the
  period (today's key), "queues again each week" and "queues again each day" fail; restore.
- [ ] **Step 3:** Run; FAIL. **Step 4:** Implement `queueReminders`, `wordReminder`, the seat and the
  pass. Run; PASS. Commit: "Certificate reminders are queued as outgoing mail (A1308 fiscal 10)".

### Task 2: the kind owner and the sender

- [ ] **Step 1: Failing test** `certificate-reminder-mail.test.ts`, driving `runMailPass` with
  `owners: [certificateReminderMail(…)]` as 3b's harness does (3b plan `:662`): a queued row for a
  person whose language is `es` is sent to their address with today's Spanish subject and text for
  that date and day count (expected strings copied from `certificate-reminders.test.ts`); a
  `rejected` weekly send is claimed again after a day and not before; an `unknown` one never again;
  a row for a person who no longer receives these mails is cancelled at claim; "a row queued for a
  certificate that has since been replaced is cancelled at claim and sends nothing" (queue at the
  warning stage, install a newer certificate, run a pass: the row is `cancelled`, the relay received
  nothing).
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
