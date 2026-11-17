# Stripe sandbox: seed the resolving person

Request: Lane F queue, STRIPE-SANDBOX-FK (watcher, 17 November 2026 05:09): “The nightly Stripe sandbox test fails with a foreign-key refusal: find what broke it and fix it.”
Usable outcome: the abandoned-attempt sandbox case resolves its payment with a real person row and passes its existing assertions against Stripe.

## Evidence and scope

Nightly `44014908481` at `77bc77e31b` failed this case while seven others passed; five preceding nightlies passed.
Commit `4f5b758700` (#3465) added `payments_resolved_by_fk` referencing `persons.id`; the sandbox's `MANAGER` is not seeded.
Reuse `seedPerson` and the manager-fixture pattern in `packages/payments-stripe/src/provider.test.ts`.
Change only `packages/payments-stripe/src/collect.sandbox.test.ts`: import `seedPerson` and seed `MANAGER` in the abandoned-attempt case before resolution.
Keep every existing assertion and real Stripe call. Add no shipped tests, helpers, product behavior or schema changes.

## One task: reproduce red, seed, verify green

1. Retain the driver's observed red/green reproduction using real migrations/database and existing `FakeStripe` in temporary `f-sandbox-person.probe.test.ts`; the unseeded case failed with error 787 and the seeded control passed (one case each).
2. Seed that person in the diagnostic and run it again: resolution must succeed. Apply the same minimal fixture correction to the existing sandbox case, then delete the diagnostic.
3. Run `pnpm --filter @waitron/payments-stripe exec vitest run src/provider.test.ts` and `pnpm --filter @waitron/payments-stripe typecheck`.
4. Complete Claude run-it branch review, address findings, use the normal hooked push, and require current-head PR CI before declaring readiness to land.
5. After merge, run `gh workflow run stripe-sandbox.yml --ref main`; inspect that run's actual eight-test result, including abandoned-attempt resolution.

## Verification ownership and completion

The temporary diagnostic owns local red/green proof of the missing-person cause; it does not ship.
Existing `collect.sandbox.test.ts` owns real Stripe abandoned-attempt resolution and its retained assertions; `provider.test.ts` checks existing provider behavior, and typecheck checks types.
`STRIPE_SECRET_KEY` is absent locally: local checks cannot establish real sandbox success; the secret-backed main workflow supplies that proof.
Existing Stripe upkeep entries remain. No matching completed backlog entry was identified by the driver; change no backlog text unless later investigation finds matching stale wording.
Forecast: production 0 lines; shipped tests +2–5/-0; support 0; plan 20–30 lines.
Claude reviews this plan before building; watcher clearance follows that review. Neither constitutes owner approval.
