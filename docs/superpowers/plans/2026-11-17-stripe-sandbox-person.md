# Stripe sandbox: seed the resolving person

Request: Lane F queue, STRIPE-SANDBOX-FK (watcher, 17 November 2026 05:09): “The nightly Stripe sandbox test fails with a foreign-key refusal: find what broke it and fix it.”
Usable outcome: restore the existing abandoned-attempt sandbox check against real Stripe, preserving every assertion.

## Cause and smallest correction

Nightly `44014908481` at `77bc77e31b` failed this case while seven passed; the four scheduled runs on 13–16 November passed.
`4f5b758700` (#3465) added `payments_resolved_by_fk` referencing `persons.id`; the sandbox's `MANAGER` is not seeded.
`git log -1 --format=%cI 4f5b758700` prints `2026-11-16T07:29:44+01:00`; GitHub records merge at `2026-11-16T06:29:45Z`, inside the failure window.
`git merge-base --is-ancestor` exits 1 for the last passing head `630c676e2b` and 0 for the failing head `77bc77e31b`. The cause is landed, not an in-flight change.
Reuse `seedPerson` from `@waitron/db/testing/seed.js`, as `packages/payments-stripe/src/provider.test.ts` already does.
Change only `packages/payments-stripe/src/collect.sandbox.test.ts`: import that helper and call `seedPerson(suite.db, { id: MANAGER, displayName: "Manager" })` inside the abandoned-attempt case.
The seed belongs in the case because `useVenueDb` resets tables before each case; a Stripe `beforeAll` seed would be erased.
Keep every existing assertion and real Stripe call. Add no permanent tests, helpers, product behavior or schema changes.

## One task and its verification

1. Local cause isolation is complete: the temporary real-migration/database diagnostic failed with error 787 without the person and passed with the person (one case each). Logs/source remain in Lane F's `receipts/stripe-sandbox-fk-20261117/`; the diagnostic is removed, not rebuilt.
2. Apply the two-line fixture correction. Run package `typecheck` (includes sandbox sources); the normal push hook checks changed-file formatting and lint.
3. Run `pnpm --filter @waitron/payments-stripe test:sandbox`. With no local `STRIPE_SECRET_KEY`, this proves loading only and skips the real cases; never call that a sandbox pass.
4. Complete Claude run-it branch review, normal hooked push and current-head PR CI, then land.
5. Run `gh workflow run stripe-sandbox.yml --ref main` and read that run's eight-test result. If it fails, investigate under `~/waitron-campaign-shared/ci-failure-rule.md`; do not mark the item complete or call a repeat a fix.

The temporary diagnostic owns local cause isolation; the existing sandbox owns real cancellation/resolution assertions, and the secret-backed main workflow supplies completion evidence.
No matching completed backlog entry was found in the payments index or detail. Existing Stripe qualification entries remain open and need no text change for this fixture correction.
Forecast: production 0 lines; shipped tests +2–5/-0; support 0; plan about 30 lines.
Separate Sol-high draft; Claude plan review, 17 November (80 seconds), followed by driver corrections. Watcher clearance is required before build.
The owner's current campaign instruction says “The owner authorises finish-branch and land-branch.” That authorises those actions; no owner approval of this design is claimed.
