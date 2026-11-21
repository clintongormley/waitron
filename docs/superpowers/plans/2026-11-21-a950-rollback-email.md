# A950 step 7. Email administrators when an offered upgrade rolls back

An administrator with a configured email address can learn that an offered upgrade
failed and the box reopened on its previous release, even while away from Box
status. The message names the attempted and restored versions and points to
**Box status**. The version the box reopens on needs this reader before unattended
installation is enabled. Codex wrote this plan for Lane F and Claude reviewed it.
The watcher wrote in Lane F's `questions.md` at 12:36 on 21 November,
“Cleared by the watcher (not the owner): keep the reviewed history row (the dated
event, no live status dot) and the planned rollback email.”
[Parent plan](2026-11-09-a950-shorter-upgrades.md) ·
[Box status](2026-11-21-a950-upgrade-status.md)

1. In `apps/server/src/boot.ts`, move the existing 60-second cache above the
   regular box-email duty so it and Box status share the
   `lastOfferedUpgrade` reader. Read it on the running primary, outside the write
   transaction. The host records the result after checking that the old app
   reopened, so checking once at start could miss it. An unavailable read lets
   the other box emails proceed. Reuse the validated host reply as it stands.
2. In `apps/server/src/box-alert-email.ts`, use the existing box-email duty,
   recipient checks and queue for a `rolled-back` result. Queue one
   `box_alert` per attempt and eligible person. Reuse the duty's `queuedFor`
   tracking to avoid repeat writes and use a stable rollback key to deduplicate
   across restart. Compute the deadline as the recorded finish time plus
   `MAIL_LIFETIME_MS.box_alert` (one day). In the enqueue transaction, skip a
   rollback at or past the deadline using the same time as the queue write.
   Share the transient-episode filter with `boot.ts` so both cleanup paths
   leave the queued rollback available for retry across restarts and later
   host results. Keep `box-alert-mail.ts`'s delivery and eligibility check.
   Add the `upgrade.rolled_back` mail code and version interpolation in
   `wordsFor`, with English and Spanish strings in `i18n/box-emails.ts`.
3. Update the English and Spanish Box status guides and A950's entries in
   `docs/backlog.md` and `docs/backlog/box.md`.
   The same latest-result limit applies if the box has yet to queue its email.
   The box must reopen and have email set up to send it. Editable hours, pause,
   automatic activation, the physical rehearsal and paired upgrades stay with
   their existing slices. This slice adds no host command, table or bell alert.

**Tests first.** In `box-alert-email.duty.test.ts`, check a rollback queues
one row per eligible person across two duty instances and a later attempt
queues its own rows.
Check that an upgraded result and a rollback at its deadline queue no
rollback mail. In `boot.box-emails.test.ts`, let the host read start empty,
return a rollback after the cache expires and observe the existing sender
deliver it in the recipient's language. Start a box with rollback mail already
queued and prove it still sends once even when the host result is unavailable.
Run both files first to see the missing behavior, then run the email and guide checks:
`pnpm --filter @waitron/server exec vitest run src/{box-alert-email,box-alert-email.duty,box-alert-mail,boot.box-emails,guide-content}.test.ts`.
Run the server typecheck, Claude's branch review and current-head CI.

**Estimate** +105/−25 production and +145/−0 tests and support, plus docs. One PR.
