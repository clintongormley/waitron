# A269 print-agent pairing retries

When the last pairing hold closes, discard pending print-agent requests. After a discard, expiry,
denial or wrong number, the agent drops the old token and number and tries again every 30 seconds
using its elapsed-time clock. The first request after setup can go out immediately. The setup page
says the agent will ask again. Open **Add an agent**, choose **Let in** and match the current number.

The owner’s choice recorded in Lane K’s questions at 10:47 on 24 November:

> the request would show up on the list again, but marked as "previously denied" and further down the list, so that the user doesn't need to rethink their decision every time only when they want to change their mind

**Deny** dismisses the current request. Show its replacement below new requests with
**Previously denied** or **Rechazado anteriormente** beside the time. Keep both actions and
the order within each group. Capture the real dialog in both languages before landing.

## Changes and checks

Write each named check first, see it fail for the expected behavior, implement and rerun.

- **Box.** Reuse the shared hold, pending table and manager routes in
  `apps/server/src/{pairing-mode,join-requests,join-api,print-api}.ts`. Check the opening before
  reading the body and in the write transaction. Keep the opening and display flag with the
  live request ID in the holder so a new opening discards old requests. Each retry gets its
  own ID and challenge. After a committed Deny, remember the request’s token hash in a bounded
  cache. Only a matching token gets `denied: true`. A matching inactive agent gets
  `revoked: true`. Both replies retain `status: "not_approved"`. Test closure, stale approval and
  list order in `join-api.db.test.ts`, and admission and token-specific replies in `print-api.test.ts`.
- **Agent.** In `packages/print-agent/src/{agent,client,host}.ts` and
  `apps/print-agent/src/{host,state,setup-page}.ts`, save the denial flag, clear the token before
  the old number and wait at the remote join step after probing and self-enrol. Re-arm until
  a request lands. Send the flag with the next request and clear it after approval or setup reset.
  A revoked agent still halts. Test timing and fresh requests in `agent.test.ts`, wire fields in
  `client.test.ts`, persistence and environment-pinned reads in `state.test.ts` and `host.test.ts`,
  and retry copy in `setup-page.test.ts`.
- **Dashboard.** Render the ordered rows and label in `api/client.ts`, `screens/printers-screen.ts`
  and `i18n/strings.ts`. Check labels and **Let in** in `printers-screen.test.ts`. Update both guides,
  the pairing notes and both A269 backlog references once verified.

The display flag survives restarts once the agent has received it. Update remote agents with
the box. The list keeps polling after Scan ends. About 180–270 production lines and 190–300 test
lines. Claude read the proposal. Build after watcher clearance of this revision.
