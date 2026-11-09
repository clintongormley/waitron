# A1308 slice 3a-iii — password reset, invitations and email change on the mail queue — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

The last of slice 3a's three pull requests (table at the top of
[3a-i](2026-11-08-a1308-3a-i-smtp-transport.md)). **Needs 3a-ii landed**
([`2026-11-08-a1308-3a-ii-mail-queue.md`](2026-11-08-a1308-3a-ii-mail-queue.md)): the table, the
sender running on the full start, the `account_action` owner, `queueAccountMail` and
`issueQueuedAccountAction`. Lane 2.

**Owner lands:** no (rules §6: nothing fiscal). **No venue reset:** no table changes.

**Goal:** Password-reset, invitation and email-change messages are queued, so a crash or restart no
longer loses them, and every link or code is made only when the mail is sent; the answers say
"queued", in the dashboard and the guide, in English and Spanish.

**Architecture:** The reset route still answers 202 before any lookup; its background step looks
up and queues. The four invitation routes and the profile save ask whether email is set up and, if
so, queue an `account_action` row in the transaction that causes it; an invitation carries who asked
in `requested_by` (A1002 §5). 3a-ii's owner issues the action at send. The direct send path is
then unused and is deleted.

**Tech Stack:** TypeScript, Hono, Lit (dashboard), Vitest.

**Spec:** [design README §5 U4, §10 "The mail queue"](../specs/2026-11-02-rationalisation/README.md);
[jobs.md §1 (the password-reset, invitation and email-change bullets), §5 measures 11 and 15](../specs/2026-11-02-rationalisation/jobs.md);
A1002 §5. [Slice rules](2026-11-08-a1308-slice-rules.md) apply.

---

## What it builds

1. Password reset (`apps/server/src/management-api.ts:957-981`): 202 first, as today; the
   background step reads whether email is set up, looks up and queues. An unknown address writes and
   removes a decoy mail row (`writeAndRemoveDecoyAction`,
   `packages/identity/src/account-action.ts:386-424`, rewritten). `requestAccountRecoveryAction`
   (`:350-375`) is replaced.
2. Invitations: add person (`management-api.ts:1121-1168`), resend (`:1170-1188`), reset login
   (`:1254-1273`), re-enable (`:1275-1294`) queue with `queueInvitation`.
3. Email change (`apps/server/src/me-api.ts:152-196`, `packages/identity/src/profile.ts:285-345`):
   the save queues; the code is made at send, to the pending address read then.
4. `invitationSent` and `emailVerificationSent` keep their names and mean "queued"; a box with no
   email set up answers false with `email.unconfigured` and queues nothing (jobs.md §1).
5. The direct path is deleted: both `sendAccountEmail` closures (`boot.ts:2134-2145`,
   `:2594-2610`), `deliverAccountAction` and `issueRecovery` (`management-api.ts:174-227`),
   `createAccountEmailSender`, `AccountEmailSender`, `AccountEmailFailure`, `accountEmailFailure`.
6. An account-mail sender on the time-zone repair start (coordinator decision, 2026-11-08). That
   start serves sign-in and the reset page, but fixing the zone needs a signed-in session allowed
   to configure the venue; an administrator who signs in only by password would be locked out if
   the reset mail waited for a full start that cannot come.
7. Measure 11 through a real backup and restore; measure 15 — except the action's binding to the
   inviter, which A1002 cut 2 does — as a fresh sender and as a real boot; a real-boot reset case.
8. Dashboard and guide words, English and Spanish.

## What it leaves out

| Left out | Who takes it |
| --- | --- |
| Writing `issued_by` on the account action from `requested_by`, and checking the issuer's authority at send | A1002 cut 2 (A1002 §5 adds the column; the owner's `claim` is where `mail.requestedBy` is passed) |
| The alert half of measure 11 | 3b |

## Files

Create:
- `apps/server/src/mail-restore.test.ts` — measure 11.

Modify:
- `packages/identity/src/account-action.ts` (`queueAccountRecovery`, the decoy, `queueInvitation`), `packages/identity/src/profile.ts:285-345`, `packages/identity/src/index.ts`.
- `apps/server/src/management-api.ts` — deps (`:159-161`), the five routes, `deliverAccountAction` and `issueRecovery` deleted.
- `apps/server/src/me-api.ts` — deps (`:72-74`), the profile route.
- `apps/server/src/account-email.ts` — the sender half deleted.
- `apps/server/src/boot.ts` — `:276-278` imports; repair start `:2134-2211` (its `stopWork`, `:2206`); full start `:2594-2610`, `:2635-2651`, `:2820-2834`.
- `apps/dashboard/src/api/client.ts:374-382`; `apps/dashboard/src/screens/staff-screen.ts:103, 184-196`; `apps/dashboard/src/screens/profile-screen.ts:246, 690-703`; `apps/dashboard/src/i18n/strings.ts` (EN `:1148-1165`, `:1406-1409`; ES `:4991-5008`, `:5259-5262`).
- `apps/server/src/guide/en/staff.md:21, :33`; `apps/server/src/guide/es/staff.md:23, :37`; `apps/server/README.md:482-491`.
- Tests: `apps/server/src/boot.zone-admission.test.ts` (`noDuties`, `:243-245`, and the case at `:551`), `apps/server/src/boot.setup-routes.test.ts:316`, `apps/server/src/i18n/account-email-output.test.ts`, `packages/identity/src/account-action.test.ts:286-410`, `account-action.concurrency.test.ts:13, 55-63`, `profile.test.ts`; `apps/server/src/account-email.test.ts`, `account-mail.test.ts`, `management-api.accounts-and-receipt-config.test.ts`, `me-api.test.ts`, `me-api.cross-person.test.ts`, `recovery-page-personal-data.test.ts:204-235, 735-835`, `boot.test.ts:3510-3550`, `boot.venue-details.test.ts:181, 199, 364`, `boot.box-emails.test.ts:37-58, 174-175, 250-345`, `boot.invoice-delivery.test.ts` (one new describe); dashboard `staff-screen.test.ts`, `profile-screen.test.ts`, `api/client.test.ts`, `api/client-routes.test.ts`.

## Size

| Part | Counted lines (estimate) |
| --- | --- |
| Code: identity 95, `management-api.ts` 70, `me-api.ts` 25, `boot.ts` 55, dashboard 25, strings 14, guides and README 12 | **~295** |
| Tests: decoy and recovery re-points 75, measure 15 (fresh and real boot) 110, real-boot reset 50, measure 11 restore 110, route re-points 170, recovery-page re-points 50, boot re-points 40, repair-start and close cases 35, account-email re-points 20, profile 30, dashboard 20 | **~710** |
| **Counted total** | **~1,005** |
| Not counted: the deleted direct path and old decoy body, and their tests; the dashboard's `not_sent` and `uncertain` statuses, their four strings per language and their tests | — |

## Finish line

1. `pnpm --filter @waitron/identity exec vitest run src/account-action.test.ts src/account-action.concurrency.test.ts src/profile.test.ts` — passes.
2. `pnpm --filter @waitron/server exec vitest run src/account-mail.test.ts src/mail-restore.test.ts src/account-email.test.ts src/i18n/account-email-output.test.ts src/boot.zone-admission.test.ts src/boot.setup-routes.test.ts src/management-api.accounts-and-receipt-config.test.ts src/me-api.test.ts src/me-api.cross-person.test.ts src/recovery-page-personal-data.test.ts src/boot.test.ts src/boot.venue-details.test.ts src/boot.box-emails.test.ts src/boot.invoice-delivery.test.ts src/guide-content.test.ts` — passes, `Tests` count printed.
3. `pnpm --filter @waitron/dashboard exec vitest run src/screens/staff-screen.test.ts src/screens/profile-screen.test.ts src/api/client.test.ts src/api/client-routes.test.ts` — passes (browser mode: check free memory first, CLAUDE.md §2).
4. `git grep -n "sendAccountEmail\|requestAccountRecoveryAction\|createAccountEmailSender\|AccountEmailFailure\|deliverAccountAction" -- apps packages scripts` prints nothing.
5. `pnpm protection-list compare` prints `EQUAL`.
6. On a Demo dev stack: a reset for a known address and an invitation each arrive in **Email inbox** within seconds and their links work; a reset for an unknown address gives the same answer and nothing arrives. Read, not run, in this plan.

## Expected protection-list difference

**EQUAL.** No schema change: rows go into 3a-ii's `outgoing_mail` and today's
`management_account_actions`.

## Assertions that change, by design

Only these (rules §4). Reason for all but the first: jobs.md §1 moves the send after the answer ("A
person's screen can no longer hear about a send that fails … `invitationSent` and
`emailVerificationSent` keep their names but mean 'in the queue'").

- `account-action.test.ts`, `account-action.concurrency.test.ts` call `queueAccountRecovery` and
  `issueQueuedAccountAction` instead of `requestAccountRecoveryAction`; the decoy case's two
  temporary triggers sit on `outgoing_mail` instead of `management_account_actions`. Their asserted
  values stay: the unknown address writes `[insert, delete]` of one row naming a person nobody has, a
  known address `[insert]` naming the person; the purpose; the link's life; completion; one live
  action after two concurrent requests. Reason: the row a reset writes is now a queued mail (U4;
  jobs.md §1, "The background step after the answer writes the row for a known account").
- Route answers that said a send failed (`problem: "email.send_refused"` or `"email.send_timeout"`,
  `uncertain: true`) now say queued; `delivery: "sent"` becomes `"queued"`. Files:
  `management-api.accounts-and-receipt-config.test.ts`, `me-api.test.ts`, `boot.test.ts`,
  `boot.venue-details.test.ts`, `recovery-page-personal-data.test.ts`. Each failure's own property
  moves to a sender-level assertion in the same case: a refusal or a send that never reached the
  server is a `rejected` row retried; a send handed over with no answer is `unknown`, never resent;
  the log carries only codes.
- `recovery-page-personal-data.test.ts`'s logged event `account_email.send_failed`
  `{ purpose, personId, errorCode, reason }` becomes `mail.send_failed` `{ kind, mailId, errorCode }`,
  with the same personal values asserted absent and the recovery page still showing the code.
- `boot.box-emails.test.ts`'s "Prepare sends through the saved relay at both account boundaries"
  captures `accountMailMode` and `startMailSender`'s owners instead of `sendAccountEmail`, and asserts
  both modes answer `smtp` and the account owner's `deliveryRule` is `"notice"`.
- The dashboard's `not_sent` and `uncertain` status cases are deleted with those statuses;
  `account-email.test.ts`'s `AccountEmailFailure` cases are deleted with it. Its message cases and
  `i18n/account-email-output.test.ts` keep their message-object assertions: they send through
  `sendSmtpMessage(config, { to: message.email, ...composeAccountEmail(message, config) }, { transport })`
  with 3a-i's message-level hook, which hands the fake the same object `createAccountEmailSender`
  did, `from` included.
- `boot.zone-admission.test.ts`: the repair start now starts one sender, so `noDuties` (`:243-245`)
  no longer counts `startMailSender` for a repair start; each repair-start case instead asserts it
  was called once, with owners whose kinds are exactly `["account_action"]`. The case at `:551`
  ("delivers account recovery mail through the existing UTC display fallback") keeps its mail
  assertions (delivered, `UTC`, `/manage/account`, not `Invalid/Zone`) — the repair start's sender
  delivers it. Reason: the coordinator's repair-start decision, 2026-11-08.
- `boot.setup-routes.test.ts:316` ("… before close() closes the venue store, then sends its
  email"): the reset's row is written before `close()` returns (shutdown still waits for it), but
  the sender stops at close, so the mail is not sent by work left over after close. The case
  asserts the row is `pending` after close and no message has gone, then starts the server again
  and asserts the one message to `reset-person@example.test`. Reason: U4 — the queue, not leftover
  request work, carries the mail across a stop.

## Stop points (beyond rules §5)

1. **A local secondary box.** Today any box that mounts the management API sends a reset or an
   invitation at once (`boot.ts:2594-2610` resolves no role). After this slice the sender drains only
   on the singleton primary (3a-ii; `boot.ts:2434, 2448, 2471, 2494` for every other mail duty), so
   two boxes never drain one queue. Not established from the code: whether a local secondary accepts
   these requests and writes a row, and whether that row reaches the primary (that depends on how
   `venue.db` travels between boxes, which this plan did not trace). Before Task 2's implementation
   the builder starts a server with `setSingletonRole(..., "secondary")` (as
   `boot.invoice-delivery.test.ts:641-657` does), posts a reset for a known address, and reads
   `outgoing_mail`. **If a row is written, stop**: the watcher decides what a secondary does with
   account mail. If the request is refused or writes nothing, record the result in the PR and go on.
2. A re-pointed assertion would change beyond the list above.
3. `issueAccountAction` would need a change (A1002 owns its next one).

## Global Constraints

- The reset answer stays 202 before any lookup, whatever the address.
- The row holds no link, token or code (CLAUDE.md §3). `params` holds `purpose` and, for a reset or invitation, `origin` (**owner, 2026-11-09:** store it), the site address the link is built on — a request fact the sender cannot know (`managementSite`, `apps/server/src/request-from-box.ts:47-53`).
- Don't-send-after: password reset and email change 30 minutes, invitation 24 hours (`ACCOUNT_ACTION_TTL_MS`).
- Each request is its own mail (`account:<randomUUID()>`), as each is its own send today; the newest link wins because `issueAccountAction` retires the earlier one.
- The cooldown answer (`acceptInvitation`, `{ invitationSent: false }`, `management-api.ts:1177`, `:1261`, `:1282`) is unchanged and queues nothing.
- Answers: mode `"smtp"` → `{ invitationSent: true, delivery: "queued" }`; `"local_capture"` → `{ invitationSent: true, delivery: "captured" }`; `"unconfigured"` → `{ invitationSent: false, problem: "email.unconfigured", uncertain: false }`; the same three for `emailVerificationSent`. Add person keeps `{ ...created, ...answer }`, 201.
- No personal data in a log line (CLAUDE.md §3). Product text as short as its meaning allows; English and Spanish together.

## Review Focus

1. **A second email change before the first confirmation went** — both rows read the current
   pending address at claim; only the newest code works. Task 1.
2. **Email not set up** — no row and today's `email.unconfigured` answer; for a reset, known and
   unknown addresses both write nothing. Task 2.
3. **A reset or invitation through the remote staff address** — its link names the remote site, as
   today. Task 2.
4. **The time-zone repair start** — a password-only administrator still gets the reset mail, from
   that start's own account-mail sender. Task 2 (`boot.zone-admission.test.ts:551`).
5. **A reset-login press inside the minute's cooldown** — still changes nothing and queues nothing.
   Task 2.

---

### Task 1: Identity queues the three purposes

**Files:** `account-action.ts`, `profile.ts`, `index.ts` and their tests.

**Interfaces — produced:**

```ts
/** Replaces requestAccountRecoveryAction. Malformed address: nothing. Active account: a
 * password_reset row; pending: an invitation row (as :370-374). A well-formed address with neither
 * writes and removes a decoy row for a person nobody has, under deferred foreign keys. */
export function queueAccountRecovery(tx: Transaction, input: { email: string; origin: string; now?: Date }): Promise<void>;
/** An administrator's invitation: requested_by is the session's person (authorizeManager's authorizedBy). */
export function queueInvitation(tx: Transaction, input: {
  managementSessionId: string; personId: string; origin: string; now?: Date;
}): Promise<void>;
// profile.ts — emailCodeKey leaves the input (the code is made at send)
saveOwnProfile(tx, input: … & { queueEmailChange: boolean }): Promise<{ queued: boolean } | null>;  // null: address unchanged
```

The decoy: the known path runs the email lookup (`account-action.ts:356-365`) and one
`outgoing_mail` insert; the decoy runs the same lookup, `pragma defer_foreign_keys = on`, an insert
of the same kind, params shape and lifetime for a random person id, and its delete. Rewrite the
comment at `:377-385` to say exactly that and no more. **The two commits are not identical, and the
comment must not say they are:** `outgoing_mail` is a change source, so a known address's commit
writes one change-feed row and the decoy's two (insert, delete). Today's decoy writes none, because
`management_account_actions` is not a change source (`packages/identity/src/classification.ts:18-27`
lists no such source). Read, not run. The answer has already gone (202 first), and no screen
subscribes to `outgoing_mail`.

- [ ] **Step 1: Re-point and write the failing tests** — the re-points under "Assertions that change, by design"; `"records the session's person as requested_by on an invitation"`; `profile.test.ts`: a changed address with `queueEmailChange: true` queues one row (purpose `email_change`) and issues no action, with `false` queues nothing and still saves the pending address, an unchanged address returns null; `account-mail.test.ts`: `"sends an email change to the newest pending address only"` (two saves, two rows; both mails go to the second address; only the second code confirms).
- [ ] **Step 2:** Finish line 1 and `src/account-mail.test.ts` — FAIL. **Step 3:** implement. **Step 4:** PASS. **Step 5:** commit.

### Task 2: The routes queue; the direct path goes

`ManagementApiDeps` and `MeApiDeps` lose `sendAccountEmail` (and `MeApiDeps` `accountActionBaseUrl`;
the owner holds the email-change link since 3a-ii) and gain
`accountMailMode?: (tx: Transaction) => Promise<EmailDelivery["mode"]>`; absent means
`"unconfigured"`, as an absent sender does today (`management-api.ts:185-186`).

- Reset (`:957-981`), same order: answer 202, then in `setImmediate` one transaction that reads
  `accountMailMode(tx)` — before the lookup, so known and unknown addresses do the same work — and,
  unless `"unconfigured"`, `queueAccountRecovery(tx, { email, origin: passkeySite(c).origin })`;
  unconfigured logs `account_mail.unconfigured` with no parameters. A failure logs
  `account_action.request_failed` as today (`:225`). Shutdown still waits for this write
  (`management.settle`, `:1954-1957`).
- Each invitation route: `accountMailMode(tx)` and, unless unconfigured, `queueInvitation(tx, {
  managementSessionId, personId, origin: passkeySite(c).origin })` inside the transaction that
  issues today (`:1158-1163`, `:1180-1186`, `:1264-1270`, `:1285-1291`).
- Profile: read the mode in a transaction first, then `queueEmailChange: mode !== "unconfigured"`.
- Boot: both starts pass `accountMailMode: (tx) => resolveMailDeliveryIn(tx, ring, config, "notice").then((d) => d.mode)` to both APIs.
- Repair start: when `!fencedOrMirror && holders.singletonRole.current === "primary"` (on a mirror or fenced box the read-only gate already refuses these requests), `await withTransaction(db, (tx) => abandonMailClaims(tx, [owner], now()))`, then `repairMail = startMailSender({ db, owners: [owner], now, isPrimary: () => holders.singletonRole.current === "primary", signal: repairMailController.signal, resolveDelivery, log, maxTickMs: 5_000 })` with no `bus` (this start installs no change feed, `boot.ts:2215-2217`, so the short ceiling stands in for the wake), `owner` being the same `accountActionMail(...)` the full start builds (its time zone read falls back to UTC here, as today's direct send does). Register `undoOnFailure.push(async () => { repairMailController.abort(); await repairMail; })` at once, and `stopWork` (`:2206`) aborts and awaits it.

- [ ] **Step 1: Re-point the tests** as listed. In `recovery-page-personal-data.test.ts:735-835` the two refusal cases queue, then run `runMailPass` with 3a-ii's owner, the refusing relay as the saved server and the rig's `r.log`; they keep `relay.recipients` and the refusal text and assert `mail.send_failed` as listed. New: `"answers 202 and queues one reset row for a known address, and leaves no row for an unknown one"`; `"queues nothing for a known or unknown address when email is not set up"`; `"builds a remote staff request's link on the remote site"` (the row's `params.origin`); `"a reset-login press inside the cooldown queues nothing"`. In `boot.zone-admission.test.ts`, `"starts no sender on a fenced or mirror box in repair"` (control: the primary repair case starts one). The local-secondary check (Stop point 1).
- [ ] **Step 2:** Finish line 2 for these files — FAIL. **Step 3:** implement; delete the direct path. **Step 4:** PASS. **Step 5:** commit.

### Task 3: Measures 11 and 15, and the real boot

- [ ] **Step 1: Write the tests:**
  - **Measure 11**, `mail-restore.test.ts`, on `restore-email.test.ts`'s backup-and-restore harness (`runOnce` to a `LocalFsBackend`, then `restoreFromArtifactFile`): queue a password reset and an invitation at time T; back up; restore into a fresh folder; one `runMailPass` over the restored database at T + 1 hour with 3a-ii's owner and a capturing transport. The reset is `expired` and nothing went to its address — the failing case would print a captured message to that address. Control: the invitation, inside its 24 hours, goes out and its link sets up the account.
  - **Measure 15** (except the action's binding to the inviter, which A1002 cut 2 does), **fresh sender**, `account-mail.test.ts`: `"a queued invitation survives a restart"` — queue through the add-person route (`mountManagementApi` with `accountMailMode: async () => "smtp"`, no sender); then a new sender over the same database (`abandonMailClaims`, then `runMailPass`); the mail goes out, its link works, and the row's `requested_by` is the inviting administrator. Control: `"expires an invitation queued more than 24 hours ago, unsent"`. And `"a box with no email set up writes no row and answers not sent"`.
  - **Real boot**, `boot.invoice-delivery.test.ts`, new describe `"queued account mail at trading boot"` with that file's `fixture()` and `smtpFixture()` (the `:463ff` pattern): before `startServer`, seed an active person with an address and a `password_reset` row (`not_after` 30 minutes ahead), a pending person and an invitation row, and a third row whose `not_after` has passed. After start, within 5 s, `smtp.messages` holds exactly two messages, one to each person, and each link completes; the first two rows are `sent` (the invitation keeps its `requested_by`), the third `expired`. The third row is the control.
- [ ] **Step 2:** run Finish line 2 for these files — they pass only once Tasks 1–2 are in; one that passes earlier proves nothing and is rewritten. **Step 3:** commit.

### Task 4: Dashboard and guide words

`client.ts`: `delivery?: "queued" | "captured"`, `problem?: "email.unconfigured"`. The screens lose
their `not_sent` and `uncertain` statuses (`staff-screen.ts:103, 186-195`;
`profile-screen.ts:246, 692-702`).

| Key | English | Spanish |
| --- | --- | --- |
| `staff.invitation_sent` | The invitation email is on its way. Check the recipient’s inbox in a few minutes. | La invitación está en camino. Revisa la bandeja de entrada del destinatario en unos minutos. |
| `staff.invitation_captured` | The invitation is on its way to the server inbox. Open Email inbox to read it. | La invitación va a la bandeja de correo del servidor. Abre la bandeja de correo para leerla. |
| `staff.invitation_unconfigured` | No invitation was sent because email is not set up. Open Email settings, then send a new invitation. | No se ha enviado la invitación porque el correo no está configurado. Abre Correo y envía una nueva invitación. |
| `profile.email_sent` | The confirmation email is on its way. Enter the code from your new address to confirm it. | La confirmación está en camino. Introduce el código que llegue a tu nueva dirección para confirmarla. |
| `profile.email_captured` | The confirmation is on its way to the server inbox. Only an administrator can read it. | La confirmación va a la bandeja de correo del servidor. Solo un administrador puede leerla. |
| deleted | `staff.invitation_not_sent`, `staff.invitation_uncertain`, `profile.email_not_sent`, `profile.email_uncertain` | the same four |

Guides: `en/staff.md:21`'s second sentence becomes "If an invitation does not arrive within a few
minutes, check the recipient’s junk mail and Email settings before resending: only the newest link
works."; `es/staff.md:23`: "Si una invitación no llega en unos minutos, revisa el correo no deseado
del destinatario y Correo antes de reenviarla: solo funciona el enlace más reciente.".
`en/staff.md:33`: "If the confirmation cannot be sent" becomes "If email is not set up", and adds
"If the code does not arrive within a few minutes, re-enter the new address and save: only the
newest code works."; `es/staff.md:37` likewise ("Si el correo no está configurado…"; "Si el código
no llega en unos minutos, vuelve a introducir la nueva dirección y guarda: solo funciona el código
más reciente."). README `:482-491`: "Password-reset, invitation and email-change messages are queued
and sent by the box's mail sender within seconds; each link or code is made when it is sent."

- [ ] **Step 1:** update the dashboard tests (the `queued` value; delete the two statuses' cases). **Step 2:** Finish line 3 — FAIL. **Step 3:** implement. **Step 4:** Finish lines 1–5 PASS. **Step 5:** commit, then `/finish-branch`.

## Backlog

No entry is finished alone (`git grep -n -i "outgoing_mail\|mail sender" docs/backlog docs/backlog.md`
finds only dependents). A1002's plan's "Unbuilt seams" note
(`2026-11-08-a1002-custom-roles.md:41`) is A1002's to update.
