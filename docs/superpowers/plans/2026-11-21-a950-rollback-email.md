# A950 step 7. Email administrators when an offered upgrade rolls back

An administrator with a configured email address can learn that an offered upgrade
failed and the box reopened on its previous release, even while away from Box
status. The message names the attempted and restored versions and points to
**Box status**. The version the box reopens on needs this reader before unattended
installation is enabled. Codex wrote this plan for Lane F.
[Parent plan](2026-11-09-a950-shorter-upgrades.md) ·
[Box status](2026-11-21-a950-upgrade-status.md)

1. In `apps/server/src/boot.ts`, share the existing cached
   `lastOfferedUpgrade` reader between Box status and the regular box-email
   check. Read it in the background on the running primary, outside the write
   transaction. The host records the result after checking that the old app
   reopened, so checking once at start could miss it. An unavailable read lets
   the other box emails proceed. Reuse the validated host reply as it stands.
2. In `apps/server/src/box-alert-email.ts`, use the existing box-email duty,
   recipient checks and queue for a fresh `rolled-back` result. Queue one
   `box_alert` per attempt and eligible person. Give it a stable dedupe key
   with a rollback prefix, and let the queue's unique key keep a repeated
   read or a restart from adding another row. Its deadline is the recorded
   finish time plus the existing one-day box-email lifetime. Keep retries
   after restart and after a later host result replaces this one. Share the
   active-episode mail filter with `boot.ts` so startup and the duty both
   exclude the rollback prefix from stale-episode cancellation. Keep
   `box-alert-mail.ts`'s existing delivery and eligibility check. Add English
   and Spanish wording in `i18n/box-emails.ts`.
3. Update the English and Spanish Box status guides and the A950 backlog.
   The same latest-result limit applies if the box has yet to queue its email.
   The box must reopen and have email set up to send it. Editable hours, pause,
   automatic activation, the physical rehearsal and paired upgrades stay with
   their existing slices. This slice adds no host command, table or bell alert.

**Tests first.** In `box-alert-email.duty.test.ts`, run the existing duty and
sender against a recent rollback, then repeat the same attempt across a new
duty instance with the first mail still pending. Check the queue and one send
in the recipient's language. A new rollback can queue its own row. An upgraded
result and an expired rollback leave the queue empty. In
`boot.box-emails.test.ts`, let the wired host read start empty, then supply a
rollback and observe the existing sender. Run both files first to see the
missing mail, then run the changed email files and guide checks:
`pnpm --filter @waitron/server exec vitest run src/{box-alert-email,box-alert-email.duty,box-alert-mail,boot.box-emails,guide-content}.test.ts`.
Run the server typecheck, Claude's branch review and current-head CI.

**Estimate** +95/−25 production and +110/−0 tests and support, plus docs. One PR.
