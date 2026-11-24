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

- **Box.** In `apps/server/src/{pairing-mode,join-requests,join-api,print-api}.ts`, reuse the
  device discard rule for both kinds and keep the existing clock-step limit. Discard before
  join cap, status, list, challenge, accept, deny and hold release. Check the opening before
  reading the join body and again in the transaction. Each retry gets a new ID and challenge.
  Keep live flags by request ID in the shared holder and the last 100 denied token hashes.
  Record each inside the corresponding write. A pending row takes precedence over a matching
  denied hash. Check closure and ordering in `join-api.db.test.ts` and admission and authenticated
  denial status in `print-api.test.ts`. Update direct callers in `join-requests.test.ts`.
- **Agent.** In `packages/print-agent/src/{agent,client,host}.ts` and
  `apps/print-agent/src/{host,state,setup-page}.ts`, save the flag on the new `denied` status.
  A saved pending number means retry. Without one, keep the existing halt on refusal.
  Clear the token before the old number. Wait at remote join after probe and self-enrol, re-arm
  on failure, and show the existing pairing-closed copy with no old number. Clear both saved
  fields on approval, self-enrol or reset. Check timing and fresh requests in `agent.test.ts`,
  the wire reply in `client.test.ts`, storage in `state.test.ts` and `host.test.ts` and copy in
  `setup-page.test.ts`.
- **Dashboard.** Render the ordered rows and label in `api/client.ts`, `screens/printers-screen.ts`
  and `i18n/strings.ts`. Check labels and **Let in** in `printers-screen.test.ts`. Update both guides,
  the clock-step notes in `conventions-data.md`, the A268 spec with a dated pointer and both A269
  backlog references once verified.

The flag survives restarts once the agent receives it. If approval and disable both happen before
a pending agent polls, it can make a new request requiring fresh approval. Update remote agents
with the box. The list keeps polling after Scan ends. About 150–240 production lines and 190–300
test lines. Build after watcher clearance of this revision.
