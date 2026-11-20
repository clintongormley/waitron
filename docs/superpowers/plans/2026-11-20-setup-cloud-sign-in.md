# Cloud sign-in from Waitron

The first slice connects one installed, unpaired test box from Cloud services using an existing Cloud account. Later setup offers skippable Cloud sign-in and basic services. Remote access and guest sharing require a trial or paid plan. The owner’s decisions are in Lane D questions.md on 20 November at 13:49, 13:54, 14:13 and 14:16. The watcher cleared the installed test box at 15:33 against [Lane K’s signed contract](https://github.com/waitron-io/waitron-cloud/blob/f1d2c23f013a345ad7efdf86e59e1cd8aed73f9c/docs/superpowers/plans/2026-11-20-cloud-setup-pairing.md) and requested one Claude read, returned on 20 November at 15:44. The two decisions below go back to the watcher.

## Release the shared signing format

Add v4 alongside v3 in `packages/contract/src/signing/{pairing-proof,pairing-proof.test}.ts` and export it from `packages/contract/src/index.ts`. Use the existing signed envelope over the UTF-8 array `["waitron-cloud-pair-v4",cloudOrigin,action,requestId,publicKey,"test",issuedAt,args]`.

| POST route | Signed args |
| --- | --- |
| `/api/pairing/start` | `[redirectUri,state,codeChallenge]` |
| `/api/pairing/redeem` | `[code,codeVerifier]` |
| `/api/pairing/status` | `[]` |
| `/api/pairing/complete` | `[countryCode,venueName,[addressLine1,addressLine2,postalCode,city,province],taxNumber,legalName]` |

Reuse the Ed25519 key, canonical base64url, UUID, original byte comparison and 60-second timestamp checks. State, verifier and challenge encode 32 bytes each. Map missing address fields to empty strings and use the existing 120-code-point venue name limit. Confirm the 4,096-character payload cap against the largest supported profile. Settle the code format and venue field constraints with K before release. Start red on all four signed vectors and malformed proofs. Extend `packages/contract/test/consumer/main.ts`. Estimate 100–160 code and 100–170 test lines. The existing publish workflow releases `@waitron-io/contract` after merge. Record version, source and integrity before either app consumes v4.

## Connect an installed test box

Enable v4 via explicit HTTPS callback configuration on a test box with no Cloud venue ID or existing pairing attempt. Proposed fixture: prepare the test key in private box state before the walkthrough and give K only its public half and exact callback for Cloud’s allowlist. Keep v3 on its existing paths and revisit retirement once replacement and the other entry points can move.

In server `cloud-client.ts`, `cloud-api.ts` and `boot.ts`, reuse the connection turn, file, venue-ID save and lease lifecycle. Version the v4 pending state with request, key, random state and verifier, tab binding, original session row and phase. Snapshot the committed venue and taxpayer profile before the first complete so retries sign the same details. Save completed registration in the existing installation shape. Finish the pending test connection before installing a build that cannot read it.

Use local POSTs `/management-api/cloud/sign-in/start` with `{tab}` and `/management-api/cloud/sign-in/return` with `{tab,requestId,state,code}` or `error` in place of `code`. Require the local origin, serving primary, `system.manage` and fresh sign-in. Bind return to the original tab and session before redeem and complete. Check the exact callback and Cloud login URL with the matching request, state and S256 challenge. The return POST runs redeem and complete. Signed status recovers a lost reply with the original request and key.

Serve a fixed no-store `GET /cloud/pairing/callback` page before the dashboard, with CSP and no referrers. Parse with `URLSearchParams` and clear the tab’s history entry before the same-origin POST. Read the `sessionStorage` tab marker from the box page as the cross-site GET can omit the Strict cookie. Keep the code and verifier out of browser storage and logs. Return to Cloud services. If local proof lapsed, reuse the dashboard sign-in prompt and retry the original live request for a fresh code.

Start red in server `cloud-{client,api}.test.ts` on wrong tab/session/origin, malformed replies and recovery after a lost reply. In Playwright use a different site for Cloud and assert that the callback GET lacks the cookie and the POST has it. Prove same-tab return and retry after expired proof. Change dashboard `api/client.ts` and `screens/cloud-services-screen.ts`. Check `cloud-services-screen.test.ts`, EN/ES guides and both themes at phone and desktop widths. Estimate 300–390 code and 180–280 test lines. Joint integration needs K’s app and a test environment cleared for this work.

## Later slices

Admin Next stages the form in the browser (`apps/setup/src/screens/admin-screen.ts:188–208`). The Live owner claim follows Venue (`apps/setup/src/setup-app.ts:1280–1286`). The watcher chose the first setup browser as installer authority at 14:16. Bind pairing to it and prove the same-tab trip and Skip preserve staged forms in Live and Prepare. Signup, address lookup and email relay need K’s follow-on contracts. Skip keeps manual address and SMTP. Guest-menu preview explains the trial requirement and uses Cloud Billing for explicit trial consent. Cloud already offers Remove venue (#1330). A1186, SMS, upgrades and production are separate.
