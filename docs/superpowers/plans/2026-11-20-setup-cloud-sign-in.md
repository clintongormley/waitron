# SETUP-CLOUD-SIGN-IN — revised implementation plan

The owner set the setup flow. Lane D Codex proposes three changes for test Cloud, pending watcher clearance.

**Authority:** `/Users/clintongormley/waitron-campaign-k/questions.md` records the owner’s 19 November ~18:58 instruction: registration/login supplies basic-service access, with “nothing more needed”; second-level services require a trial. Both Lane D and K `questions.md` record 20 November 13:11: “at the start of setup, because we need access to address completion and emails during setup”; 13:20: “you can do it all from the box”; and 13:49: **“Yes, but never ask.”** The accepted flow places Cloud sign-in after administrator creation, before the venue form, registers automatically, and sends the saved venue details afterwards.

Paths prefixed with `W/` refer to Waitron. Paths prefixed with `C/` refer to Cloud at `89fda0740`. Lane K owns the Cloud implementation.

## PR 1 — Register from the box; complete addresses before saving

**Trace and authority.** Today `W/apps/setup/src/screens/admin-screen.ts:198` only patches the browser draft and navigates to Venue. `W/apps/setup/src/setup-app.ts:1402` claims first setup **after** venue submission; `W/packages/provisioning/src/first-setup-owner.ts:188` then produces the owner capability. The administrator’s `persons` row is created later by `W/packages/provisioning/src/venue-apply.ts:230`. There is no administrator proof to reuse before the form.

**Proposed minimum:** split administrator establishment from venue freezing. On Administrator Next, validate and save the administrator identity, reserved ID and existing password/PIN hash forms through the setup-flow machinery; issue the existing owner-capability form. Extend `W/packages/provisioning/src/{first-setup-owner.ts,first-setup-state.ts,setup-flow-record.ts}` and `W/apps/setup/src/first-setup-session.ts` for this preliminary stage. Creation is atomic; replacement or recovery requires the saved administrator password. Cloud routes require that proof and the existing secure-origin checks. Later live setup promotes the same identity into the normal first-fiscal claim; prepare setup retains the preliminary proof until provisioning. Preserve local setup, claim recovery and provisioning’s administrator creation. **Watcher must settle whether this staged administrator satisfies “administrator created”; it is not yet a `persons` row.**

Insert the Cloud screen between Admin and Venue for fresh live/prepare setup. Offer Continue locally and manual address entry. Limit registration to the fresh-venue path. The box completes registration on successful Cloud sign-in. The existing dashboard pairing flow and already-paired boxes stay outside this setup change.

**Cloud contract proposed to K.** `POST /api/box-registration/{login,signup-request,signup-complete}` handles sign-in and verified signup. Only completed authentication issues registration plus the existing installation lease, bound to the box public key and the same retry operation ID. K defines the continuation requests for existing sign-in checks and email verification so the person can complete them on the box. Reuse signing in `W/apps/server/src/{cloud-client.ts,cloud-signed-request.ts,cloud-installation.ts}` and add the agreed actions in `W/packages/contract/src/signing/`. Keep Cloud passwords and authentication challenges transient and out of logs.

Register with the details available at that point. With no Cloud venue ID, Cloud creates a new venue automatically. There is no venue matching prompt. Store the key and registration in the existing durable Cloud connection state, linked to the local setup attempt until provision binds the Cloud venue ID through `saveCloudVenueId` (`W/apps/server/src/boot.ts:2586`). Reuse the registration through retries and restart. On start again, restore or join, set aside only the pending new-venue connection.

`W/apps/setup/src/screens/venue-screen.ts:709` currently commits only a browser draft. Add a proof-protected server save before advancing: validate and durably record the submitted name, address, country, tax number and legal name with a revision, then enqueue proposed signed `POST /api/installations/profile`. Retry the same revision after failure/restart; newer saves supersede older ones without creating another venue. Cloud chooses or creates the business with that tax number **within that account**. Do not wait for final Provision or send typing drafts. Certificate, fiscal evidence, installation name and final provisioning results arrive later and are unnecessary for this handoff. Cloud waits stay outside local write turns.

Wire the existing address provider to signed `POST /api/installations/address-lookup`. K must adapt its current single-installation test binding (`C/packages/account-http/src/address-lookup.ts:51–69`) for the newly issued installation.

**Files:** additionally `W/apps/setup/src/{setup-app.ts,api/client.ts,screens/cloud-sign-in-screen.ts,screens/admin-screen.ts,screens/venue-screen.ts}` and `W/apps/server/src/{boot.ts,setup-api.ts,setup-first-fiscal-api.ts,setup-cloud-api.ts,provision.ts,first-fiscal-activation.ts}`.

**Red → green:** add `setup-app-cloud-sign-in.test.ts` and `setup-cloud-api.test.ts`: reject missing/wrong proof; register before Venue in live/prepare; preserve local setup; recover after restart; replay a lost registration/profile reply without duplicates; send only saved details; preserve first-fiscal ownership. Run from `W`:

- `pnpm --filter @waitron/setup exec vitest run src/setup-app-cloud-sign-in.test.ts src/screens/venue-screen.address-lookup.test.ts`
- `pnpm --filter @waitron/server exec vitest run src/setup-cloud-api.test.ts src/first-fiscal-setup.e2e.test.ts`

Observe the new assertions fail before implementation, then pass. **Finish line:** on test Cloud, signup/login entirely on the box, select an address before saving, save/retry and inspect one correctly associated Cloud venue. **Estimate:** 600–850 implementation lines; 350–500 test lines.

## PR 2 — Finish setup using Cloud account email

Modify `W/apps/setup/src/{screens/email-screen.ts,api/client.ts}`, `W/apps/server/src/{setup-email-api.ts,setup-api.ts,first-fiscal-activation.ts,cloud-client.ts}`. Offer Cloud account email when signed `POST /api/installations/configuration` returns an active relay grant. Allow that choice without SMTP in both setup paths; preserve SMTP configuration and its separate test. Persist the choice through the existing Cloud-email state and account sender (`W/apps/server/src/boot.ts:2595`).

Reuse `W/apps/server/src/cloud-email.ts` and `/v1/installations/email/{submit,status}`: supported classes are invitation, password reset and email change. No new setup-message class. K supplies the existing test grant and permitted management origin; signup verification is Cloud account mail, **not** proof of the installation relay.

**Red → green:** run `pnpm --filter @waitron/setup exec vitest run src/screens/email-screen.test.ts` and `pnpm --filter @waitron/server exec vitest run src/setup-email-provision.test.ts src/cloud-email.test.ts src/boot.box-emails.test.ts`. Add failing assertions for Cloud-only live/prepare completion, missing/revoked grants and retained SMTP behavior. Record registration → grant availability at Email → provisioning; exercise an existing supported relay message to a controlled test inbox, then a real account action after provisioning. Transport acceptance and inbox arrival are separate observations.

**Finish line:** finish test setup without SMTP and receive a real password-reset email through that installation’s relay. A controlled pre-provision relay test demonstrates early transport availability; it does not claim a real account action existed then. **Watcher question:** is that sufficient, or must setup itself deliver a real box-account message before Provision? The latter changes usable behavior and needs a settled design. **Estimate:** 130–200 implementation lines; 100–160 test lines.

## PR 3 — Hand off remote access to explicit trial consent

Modify `W/apps/dashboard/src/screens/cloud-services-screen.ts`, its `cloud-services-screen.billing.test.ts`, and `W/apps/server/src/cloud-billing.ts` only as needed. When remote access requires Connected, offer a handoff carrying the existing Cloud venue ID. Never register again or start a trial on navigation. Cloud owns eligibility, billing and explicit **Start free trial**, using existing `POST /api/account/billing/start-trial`.

**Proposed:** open Cloud Billing with that venue selected; the selector handoff is not yet agreed with K. **Watcher question:** may this trial step use Cloud Billing, or must consent also remain on the box? Recommend the existing Billing page; an in-box alternative needs K’s authenticated trial contract.

**Red → green:** `pnpm --filter @waitron/dashboard exec vitest run src/screens/cloud-services-screen.billing.test.ts`; `pnpm --filter @waitron/server exec vitest run src/cloud-billing.test.ts src/cloud-tunnel-provision.test.ts`. Assert correct venue, no trial before consent, refusal before consent and successful remote access afterwards. **Finish line:** demonstrate those states on test Cloud with unchanged installation identity. **Estimate:** 60–110 implementation lines; 60–100 test lines.

**Before build:** watcher/K settle preliminary administrator authority, authentication/challenge and signup-verification UX, provisional business placement before tax details exist, endpoint schemas/signing actions, replay/profile-revision rules, address/relay admission and trial destination. None of the proposed endpoints is agreed. Each PR includes affected EN/ES strings/guides and visual checks in both themes at phone/desktop widths. Cloud already exposes **Remove venue** (`C/apps/portal/src/installation-screen.ts:48`, `POST /api/account/installations/remove`); it revokes and hides the installation, rather than deleting venue history. Manual old-venue removal belongs to Cloud, outside Waitron. Guest-menu tier remains undecided. A1186, SMS, upgrades, production enablement, and new box billing/fiscal logic remain outside all three PRs.
