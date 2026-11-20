# Cloud sign-in from Waitron — Lane D

Cloud sign-in is skippable, returns to Waitron in the same tab and connects automatically after sign-in. Basic services come with registration. Remote access and guest sharing require a trial or paid plan. The owner’s decisions are in Lane D questions.md on 20 November at 13:49, 13:54, 14:13 and 14:16. The watcher cleared the installed test box at 15:33 against [Lane K’s signed contract](https://github.com/waitron-io/waitron-cloud/blob/f1d2c23f013a345ad7efdf86e59e1cd8aed73f9c/docs/superpowers/plans/2026-11-20-cloud-setup-pairing.md) and requested one Claude read of this revision before build.

## 1. Release the shared contract first

D adds v4 alongside unchanged v3 in `packages/contract/src/signing/{pairing-proof,pairing-proof.test}.ts` and exports it from `src/index.ts`. Sign the exact UTF-8 array `["waitron-cloud-pair-v4",cloudOrigin,action,requestId,publicKey,"test",issuedAt,args]` in the existing `{payload,signature}` envelope:

| POST route | Signed `args` |
| --- | --- |
| `/api/pairing/start` | `[redirectUri,state,codeChallenge]` |
| `/api/pairing/redeem` | `[code,codeVerifier]` |
| `/api/pairing/status` | `[]` |
| `/api/pairing/complete` | `[countryCode,venueName,[addressLine1,addressLine2,postalCode,city,province],taxNumber,legalName]` |

Reuse Ed25519 SPKI, canonical unpadded base64url, UUID, exact re-encoding and 60-second timestamp checks; preserve K’s body and 120-character name limits. Estimate **100–160 code, 100–170 test lines**. Pin all four wire vectors, malformed/action-specific arguments, wrong origin/key/signature, timestamp boundaries and v3 compatibility; extend `test/consumer/main.ts`.

Use the existing automatic release on merge described in `docs/developers/shared-ui-preparation.md`; no publisher changes. Record the published `@waitron-io/contract` version, source commit and integrity before either app consumes v4. Cloud verifies the exact release with its workflow credential.

## 2. Connect an installed test box

Deliver the cleared **300–390 code lines**, separately from the contract, with approximately **180–280 test lines**. Limit v4 to K’s configured test key/exact HTTPS callback pair and an installed, unpaired box using an existing enrolled Cloud account. Keep v3 for pending connections, existing installations, replacement and other environments.

Change `apps/server/src/{cloud-client,cloud-api,boot}.ts` and dashboard `src/{screens/cloud-services-screen,api/client}.ts`. Read the committed venue/address and singleton taxpayer profile server-side. Reuse `cloud-client.ts`’s `activePaths` connection turn, saved Ed25519 key, private durable connection file, venue-ID save/recovery and `cloud-installation.ts` lease lifecycle. Persist one request and key, its saved profile, separate 32-byte random state and verifier, and the tab/session binding before start. Derive the S256 challenge from the verifier. Bind to the session row ID from the fresh sign-in check.

Require local management origin, a serving primary, `system.manage` and fresh management sign-in at start and before redeem/completion, including rechecks after waits. Reject the remote staff entrance. Bind the initiating tab’s secret and original local session before either signature; a forwarded callback or another signed-in browser cannot finish it. Validate the exact configured HTTPS callback and Cloud authorization origin/path, without credentials or fragments, and match authorization request ID/state/challenge/S256 against pending state. Strictly validate replies, registration and deadlines. Never replace an unresolved attempt to switch accounts. Signed status recovers lost redeem/completion replies under the same durable request/key; completion remains idempotent.

Use a tiny static bridge at `/cloud/pairing/callback`, mounted before the SPA catch-all, avoiding dashboard startup. GET only returns fixed, no-store HTML with restrictive CSP and `Referrer-Policy: no-referrer`. Read the callback with `URLSearchParams` and clear the query with `history.replaceState` before the same-origin POST. The cross-site GET can omit the Strict management cookie. The POST from the loaded box page requires it. Check the tab marker in `sessionStorage` and use `location.replace` to return to Cloud services. Keep code and verifier out of browser storage, retained history and logs. Cancellation/expiry offers retry; no extra pairing confirmation.

## 3. Prove the installed journey locally

Use failing behavioral tests first in server `cloud-{client,api}.test.ts`, preserving legacy/replacement assertions. Cover wrong tab/session/origin, lost freshness/permission/primary role, hostile URLs, expiry, malformed replies, concurrent attempts and restart/lost-reply recovery. Add bridge GET/history/log checks and a Playwright round-trip fixture exercising real same-tab navigation, reload, cancellation and return to Cloud services; retain screen checks in `cloud-services-screen.test.ts`. Normal local fixtures do not wait for K. Joint integration waits for K’s implementation and a permitted environment. **Do not deploy to, lock, reset or restart either owner test box.**

## 4. Later slices

Early setup retains the staged administrator form: Admin Next only patches the draft (`apps/setup/src/screens/admin-screen.ts:188–208`); owner claiming starts after Venue (`setup-app.ts:1280–1286`). Setup routes are unauthenticated (`apps/server/src/setup-api.ts:695–711`). There is no earlier exclusive claim: the first setup browser is installer authority, as settled at 14:16. Bind its tab registration and carry it into the later owner claim. Add reload-safe, tab-scoped draft retention and browser tests proving actual navigation preserves forms after sign-in **and Skip**, for Live and Prepare.

Early setup, address access, Cloud email and new-account enrolment remain outside the installed slice. Later reuse Venue’s address provider, K’s pre-venue lookup grant and existing signed configuration/email relay; Skip keeps manual address/SMTP. Settle signup continuation and accepted profile updates with K first.

Guest-menu preview must explain the trial requirement and offer a self-service trial path; K gates sharing, including already-shared ineligible test menus. Reuse Cloud Billing for explicit trial consent. Update affected EN/ES guides and check both themes/phone widths per slice. Cloud already has **Remove venue** (#1330). A1186, SMS, upgrades and production remain separate.
