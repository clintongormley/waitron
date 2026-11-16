# Silent provider connections implementation plan

**Goal:** Qualify whether two Payments tabs leave an unrelated box read responsive while reader-status requests wait on a silent provider. Fix only an observed stall.

**Authority:** `SILENT-PROVIDER-CONNECTIONS`, `/Users/clintongormley/waitron-campaign-f/queue.md`, started 2026-11-16 20:26. Draft only: driver inspection, Claude review and watcher clearance precede all code/tests. No experiment has run.

## Reuse and ownership

| Proposed file | Responsibility |
| --- | --- |
| `apps/server/src/payments-status-connections.browser.test.ts` (new) | Own HTTP/1.1 qualification/control and file-local support. Reuse `useVenueDb`, seeds and trading dependencies from `payments-api.test.ts`. |
| `apps/dashboard/src/screens/payments-screen.test.ts`; `apps/server/src/payments-api.test.ts` (conditional) | Respectively own slot sharing/fallback/release and route wait/answer regressions. Preserve existing behavioural assertions. |
| `apps/dashboard/src/screens/payments-screen.ts` or `apps/server/src/payments-api.ts` (conditional) | Only a status-read concurrency or wait fix justified by the experiment. Trace consumers before changing gating. |
| `docs/research/2026-11-16-silent-provider-connections.md` (new) | Record commands, versions, counts, timings and controls; limit conclusions to this browser/topology. |
| `docs/backlog/payments.md`, `docs/backlog.md` | Delete only the W48 silent-provider qualification section and its “Qualify concurrent reader status reads…” index bullet after qualification succeeds. |

Reuse `apps/server/src/certificate-diagnosis.browser.test.ts`'s temporary Vite build/real Hono listener and sibling `permission-continuation.browser.test.ts`'s actual dashboard entry, without its interception. Existing server Playwright/SumUp dependencies suffice.

## Qualification after clearance

1. Build once using `pnpm --filter @waitron/dashboard exec vite build` with a temporary config. Mount real `mountPaymentsApi`, session/me routes and `mountLiveApi`; seed a manager and six active readers. A file-local provider contribution delegates status to exported `sumupClient({ baseUrl: localOrigin, apiKey: syntheticKey, merchantCode: syntheticMerchant })`, using native fetch/default deadlines. This measures client transport and generic routing; adapter mapping remains outside this test. The local HTTP provider counts accepted requests and never sends response headers.
2. Add `unrelated read stays responsive with silent statuses`, for normal Web Locks and unavailable Web Locks (context init script removes `navigator.locks`). Use two tabs in **one BrowserContext at the identical origin**. Load the actual shell, settle bootstrap reads, then enter Payments. Await two open native EventSource streams. No `networkidle`, fetch mock or route interception; unrelated bootstrap responses may be minimal.
3. Await provider acceptance and pending status responses. Record HTTP versions, distinct occupied box sockets and provider counts. Current code suggests two shared statuses normally, four in fallback (`payments-screen.ts:169–236,798`); measure these with the two streams. Fetch `/management-api/session/me` from tab two with a unique query and `cache: "no-store"`. Require 200, the manager's identity and completion within 2 seconds while provider requests remain unanswered. Failure output includes timings/counters.
4. Add `saturated pool delays the same read until a slot is freed`. In an isolated normal-Web-Locks case, keep both shell streams and add direct browser status fetches bypassing the limiter until six distinct box connections are occupied and provider requests accepted. The probe must stay unfinished and absent from server ingress for 1 second. Abort one added browser fetch; require probe arrival/completion within 1 second. This distinguishes browser queuing from route delay. Bound gates and each measurement case below the client's 20-second deadline. Guard teardown of contexts, streams, owned sockets/listeners and temporary files.

## Decision and verification

- **Both paths pass and the control discriminates:** leave production unchanged; record the experiment and remove the two named backlog entries.
- **Either stalls:** observe the qualification failing before production edits. Prefer a minimal status-slot limit change; alternatively bound only the status route's wait. Add the owning suite's focused regression, rerun the unchanged responsiveness property/control and record the fix. Broader design goes to the watcher.
- Run `pnpm --filter @waitron/server exec vitest run src/payments-status-connections.browser.test.ts` and only a fix's affected suite. Read test counts; driver handles hooks, current-head CI and branch review.

**Exclusions:** Live SumUp/sandbox calls, Stripe, till payment-sheet changes, payment taking, shared payment deadlines, HTTP/2, schema changes and unrelated failure grids.

**Size estimate (added/deleted lines):** production **0/0** if qualification passes; conditional fix **5–25/0–15**. New browser test **250–400/0**, including local support; conditional existing-test additions **10–40/0**, preserving assertions. Separate support files **0/0**. Research **25–45/0**; backlog **0/8–12**. No new product feature or reusable framework.
