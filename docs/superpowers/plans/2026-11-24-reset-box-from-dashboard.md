# Reset a Demo or Preparation box from the dashboard

A Box administrator can reset a standalone Demo or Preparation box from its local dashboard, type the confirmation word, and return to Setup using the box’s existing certificate. The recovery page is a later slice. [Backlog request](../../backlog/box.md#resetting-a-box-without-a-terminal).

The owner said “1. box admin” on 24 November 2026, as quoted in Lane D’s questions at 14:10. The watcher confirmed **Manage boxes** (`node.manage`) and the Servers page at 14:22. Use the existing fresh sign-in check.

## Server

- In `apps/server/src/membership-removal-api.ts` and `boot.ts`, add `POST /management-api/servers/reset-this-box` and `canResetThisBox` on the Servers listing. Keep Cloud access ineligible with `isRemoteStaffRequest`. Use the existing permission, origin, read-only and fresh sign-in checks. At the press require literal `reset`, preproduction in both the running config and the database stamp, no `joinedAnotherBox`, no pair link or open handover, and a chart that is absent or names this serving primary and any evicted boxes only. Use the same eligibility rules to show the action.
- Save the existing plain `wiping` marker in `replaced-reset.ts`, then reply 202 with the configured Setup address. Call `restartProcess` after the reply through `restartAfterResponse`. Roll back this request on failed durable save or inside a failing restart callback. The existing startup wipe empties the databases, installation state, Cloud connection and mounted local backups, and keeps the certificate and `records/`. Have validated emergency-copy placement clear the marker under its venue lock, as restore and rejoin already do, so it cannot wipe a replacement. Reuse the existing retry and deletion order.
- Confirm the standalone-only limit and retention of logs, captured Demo mail, sidecar settings and external backups with the watcher.

## Dashboard and checks

- Add a screen-level **Reset this box** action in `apps/dashboard/src/screens/servers-screen.ts` and wire the dashboard API client. Explain what goes, say captured mail stays, offer Stop and link to Backups when accessible. Use the shared input, translated confirmation word and fresh sign-in dialog. Check `/setup-api/status` for Setup, then follow the configured address. If the wait expires, link there without promising a retry. Send English desktop and Spanish phone captures to the watcher before proceeding past the server half. Update locale text, permission help, both Servers guides and both backlog entries.
- Start with focused failing tests. `membership-removal-api.test.ts` checks refusals stage nothing, including Cloud access, and acceptance replies before restarting. The emergency-copy placement test checks a replacement cancels an old request. A disposable startup fixture reaches Setup with the same certificate. `servers-screen.test.ts` covers visibility, confirmation, Stop and the result of submission. The existing wipe tests cover deletion and retries.

Estimate 200–300 implementation lines, 180–260 test lines and about 30 guide lines.
