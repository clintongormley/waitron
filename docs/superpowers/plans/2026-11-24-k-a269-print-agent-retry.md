# A269 print-agent pairing retries

When the last pairing hold closes, discard pending print-agent requests. If a pending request is
discarded, expires, is denied or fails the number check, the agent clears its old token and code.
It waits 30 seconds on its elapsed-time clock, then asks again at most every 30 seconds until a
request lands. A first request after setup can go out immediately. The setup page tells staff the
agent will ask again. An administrator opens **Add an agent**, chooses **Let in** and matches the
current code.

The owner’s choice recorded in Lane K’s questions at 10:47 on 24 November:

> the request would show up on the list again, but marked as "previously denied" and further down the list, so that the user doesn't need to rethink their decision every time only when they want to change their mind

**Deny** dismisses the current request. Put its replacement below requests never denied, with
**Previously denied** or **Rechazado anteriormente** beside the time. Keep both actions and the
existing order within each group. Share the local English and Spanish mock-up before building.

## Changes and checks

Write each focused check first, see it fail for the named behavior, implement, then rerun it.

- **Agent.** In `packages/print-agent/src/{agent,client,host}.ts` and
  `apps/print-agent/src/{host,state,setup-page}.ts`, save a random retry ID in the existing
  pairing configuration and send it with each request to recognize the same agent. The ID only
  groups requests. Use the saved pending code to recognize a lost pending request after agent
  restart. Keep the existing revoked-agent halt, including when the box approved and disabled
  the agent before its next poll. Check the delay, fresh code and halt in `agent.test.ts`, the
  request in `client.test.ts`, saved ID in `state.test.ts` and setup copy in `setup-page.test.ts`.
- **Box.** In `apps/server/src/{pairing-mode,join-requests,join-api,print-api}.ts`, reuse the
  shared hold, pending table and management routes. Check the opening before reading the request
  body and again in the write transaction. Discard prior-opening requests before counting or
  acting on them. Give each retry its own request and challenge. Keep a bounded memory cache of
  explicit denials keyed by retry ID. It survives a closed dialog and clears on approval.
  Restart or promotion forgets the label. No schema change. Check stale approval and ordered
  same-name retries in `join-api.db.test.ts`, and cross-opening admission and revoked status in
  `print-api.test.ts`.
- **Dashboard.** In `apps/dashboard/src/{api/client,screens/printers-screen,i18n/strings}.ts`,
  add the label to the existing list. Check the rendered label, order and **Let in** in
  `printers-screen.test.ts`. Update both Printers guides and remove the A269 backlog entry when
  the behavior is verified.

About 180–260 production lines and 170–245 test lines. Build after Claude’s review and watcher
clearance. [The A269 backlog entry](../../backlog/printers.md#a-print-agent-cannot-be-discarded-when-the-join-window-shuts-a269-owner-2026-10-04--open).
