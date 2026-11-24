# Reset a Demo or Preparation box from the dashboard

A Box administrator can reset a standalone Demo or Preparation box from the dashboard, type the confirmation word, and arrive back in Setup at its existing trusted address. The recovery page is a later slice. [Backlog request](../../backlog/box.md#resetting-a-box-without-a-terminal).

The owner said “1. box admin” on 24 November 2026, as quoted by the watcher at 14:10. The watcher’s queue maps that to **Manage boxes** (`node.manage`) and a fresh sign-in. Use that as the working choice. Confirm the mapping before starting, because **Administer this box** (`system.box_admin`) is a separate grant.

## Server

- Add `POST /management-api/servers/reset-this-box` and a `canResetThisBox` flag to the existing Servers listing in `apps/server/src/membership-removal-api.ts` and wire them in `boot.ts`. Use the existing permission, origin, read-only and fresh sign-in checks. At the press require a literal `reset`, preproduction in the running config and the saved database stamp, and a standalone serving box with its own certificate. Refuse a box joined to another, an active peer or an open handover. The read uses the same eligibility rules for visibility.
- Stage the existing plain `wiping` request in `replaced-reset.ts` and restart after the 202 reply with `restartAfterResponse`. Keep the same startup sequence and deletion order. The existing wipe empties the venue and node databases, installation state and mounted local backups while retaining the box certificate and `records/`. A dashboard request carries `venueDbIdentity` so a different database at startup cancels it. A missing database lets the existing wipe finish after an interrupted deletion. If saving the marker or asking for restart fails, roll back that request. Existing peer wipes and setup adoption keep their own checks.
- The command at a terminal also removes sidecar volumes. This slice keeps diagnostic logs, captured Demo mail and sidecar settings, and leaves external backups alone. Say so in the reset guide. Confirm this limit and the standalone limit with the watcher.

## Dashboard and checks

- Add **Reset this box** to `apps/dashboard/src/screens/servers-screen.ts` using the API client and locale strings. Show it only when the listing permits it. Use the existing dialog, typed input and sign-in flow. Explain what gets erased, offer Stop and link to Backups when available. Compare the displayed word in the dialog and send the fixed confirmation. After acceptance, check `/setup-api/status` for the new Setup page. Bound the wait so a failed restart gives a next action. Send English desktop and Spanish phone captures to the watcher before proceeding past the server half. Use the existing English and Spanish Servers guides and narrow the backlog to the recovery-page slice.
- Start each change with a focused failing test. `membership-removal-api.test.ts` covers forbidden requests staging nothing, and one accepted reply before restart. `replaced-reset.test.ts` covers a different database and an interrupted dashboard reset. A disposable startup fixture checks arrival at Setup with the same certificate. `servers-screen.test.ts` covers visibility, confirmation, Stop, and acceptance and refusal. The existing wipe tests retain their coverage of deletion and crash retries.

Estimate 200–300 implementation lines, 180–260 test lines and about 30 guide lines.
