# Silent-provider browser qualification, 16 November 2026

Two Chromium Payments tabs kept an unrelated authenticated box read responsive while the
provider accepted status requests and sent no reply. With Web Locks available, two status
requests and two live event streams occupied four distinct box sockets; the session read
returned HTTP 200 with the seeded manager's identity in 1.4 ms. No product fix was made.

The watcher cleared this experiment in Lane F questions.md at 20:43, following Claude's
327-second plan read. That clearance asks for a docs-only result when the deployed browser
path does not reproduce the stall. It is watcher clearance, not owner design approval.

## What ran

The experiment used Node v26.13.0, Vitest 4.1.12, Playwright's Chromium 158.0.8127.18,
a real venue database and the actual dashboard entry built by Vite. Six active SumUp readers
and a sealed synthetic credential were seeded. Both tabs shared one BrowserContext, cookie
and loopback HTTP origin. The box mounted the real Payments, session and event-stream routes.
Bootstrap-only fixture responses supplied theme, languages, alerts and disk status.

The real `SUMUP_CARD_PROVIDER` opened its native HTTP transport through the existing injected
fetch seat. A URL-only rewrite redirected it to a local HTTP listener, retaining method,
path and abort signal. That listener accepted `/v0.1/merchants/SYNTHETIC/readers/…/status`
and never responded. No browser request was intercepted, no response was fabricated for a
measured route, and no real provider was contacted.

| Observation | Web Locks present | Web Locks removed before page scripts |
| --- | --- | --- |
| Status requests started by the two screens | 2 | 4, targeting the same first two reader URLs |
| Initial status requests accepted by provider | 2 | 2 |
| Open native event streams | 2 | 2 |
| Distinct initially occupied box sockets | 4 | 4 |
| Authenticated session probe | HTTP 200, 1.4 ms | HTTP 200, 1.1 ms |

For each case, two additional direct status fetches bypassed the screen limiter and targeted
two other readers. Four provider accepts and two streams then occupied six distinct HTTP/1.1
box sockets. A fresh session probe remained unfinished for one second and never reached box
ingress. Aborting one direct browser fetch released a socket; the queued probe returned 200
with the correct identity, 1,012/1,014 ms after it started. Thus the control distinguished a
responsive four-socket setup from a saturated six-socket setup, before provider deadlines.

The first two runs failed the predicted four-provider-accepts fallback gate: only two arrived.
The diagnostic run then counted four browser-started calls to two duplicate URLs, with only
two reaching the server and provider. This records the observation; its browser-internal cause
was not established. The final experiment asserts those observed counts and both controls:
`Test Files 1 passed (1); Tests 2 passed (2)`, 7.26 seconds total. No production code or existing
test assertion changed.

## Receipts and limits

The tested source is based on `e17a465054a201ad548a2ba4bcd5afb4808ae8fe`. At measurement,
`git diff --name-only HEAD origin/main -- apps/dashboard/src/screens/payments-screen.ts
apps/server/src/payments-api.ts apps/server/src/live-api.ts packages/payments-sumup/src/card-provider.ts`
printed no changed paths. Local evidence is under
`~/waitron-campaign-f/receipts/silent-provider-connections-20261116/`: the experiment source
`qualification.browser.test.ts`, failed runs `qualification-{1,2}.log`, and final
`qualification-3.log` plus `qualification-3-{false,true}.json` containing request paths,
HTTP versions, identities and timings. To repeat, copy the source to
`apps/server/src/payments-status-connections.browser.test.ts` in an installed throwaway checkout
and run `pnpm --filter @waitron/server exec vitest run src/payments-status-connections.browser.test.ts`.
Set `SILENT_PROVIDER_EVIDENCE` to an outside filename prefix to retain the JSON observations.

This qualifies the two-tab, same-reader-list, plain loopback HTTP topology measured above.
It does not qualify appliance HTTPS, other browser engines, arbitrary tab counts, or four
distinct fallback status reads. Each additional shell has its own event stream: the two-tab
result cannot establish that every number of tabs leaves spare connections. Removing Web Locks
in Chromium does not establish how a deployed browser without that API behaves. The experiment
source stays in local receipts under the watcher's docs-only instruction; no permanent suite
or duration-table entry was added.
