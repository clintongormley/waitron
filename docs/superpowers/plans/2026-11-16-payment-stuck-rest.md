# Persistent payment failures implementation plan

**Ask:** PAYMENT-STUCK-REST in Lane F's local `queue.md`, fed by the watcher on 16 November 2026 at 17:48: finish A1089's persistent recording-failure guidance, table-order recovery and shared unknown-outcome audit. Separate Sol-high draft, checked and shortened by the driver. This plan has no owner design approval; the campaign authorises finish and landing after its gates.

**Finish line:** Staff can follow proved recovery steps for the original charged payment, including a table bill. Where no recovery action exists, the screen and EN/ES guide explain the recording fault, retain payment details and say not to charge again. Resolve the fallback audit from actual reachable responses.

**Reuse:** Existing manager provider checks, retained failed-check evidence, bill-payment worker, Counter recovery, `useVenueDb`, `payments-api.stuck.test.ts` fixtures, `testing/live-table.ts` and `testing/serve-line.ts`. TypeScript/Hono, Lit, Vitest and Markdown; execute inline with TDD.

**Leave out:** New charges, automatic retries, unlocking an unknown outcome, new actions/forms/state/schema/provider protocols, sale/invoice/filing changes, Stripe upkeep and A949. If recovery needs a change to recorded financial facts, stop that part and hand it to lane L through the watcher.

## Work and tests

- [ ] Qualify table recovery in `apps/server/src/payments-api.stuck.test.ts` through real management and till routes, reusing the manager-confirmed Counter case. Reproduce a persistent recording refusal before describing a remedy. Cover a table bill's normal bill-payment path and, if it can arise, a whole-order capture confirmed by a manager whose recording failed. Assert the original charge/reference survives, the outstanding balance is truthful, and successful recovery records once without a new collection. Use existing fixture support; no new harness. If no existing table action succeeds, document the fault and preserve the handoff rather than inventing one.
- [ ] Trace all `payment.outcome_unknown` producers to rendered consumers. Run existing missing-refund-reference server and dashboard cases. Provider outcomes permit only `unreachable` or `ambiguous`, both overridden on the stuck-payment screen; partial-refund actions have their own messages. Change shared wording only for a demonstrated reachable fallback. If none exists, narrow/delete that audit premise with the route/screen receipts; never use an invented provider reason or a missing-reason stub as proof.
- [ ] Add failing EN/ES assertions to `apps/dashboard/src/i18n/alerts.test.ts` before changing `i18n/alert-messages.ts`: retain Check with provider and the no-second-charge warning; explain the persistent recording fault and preserve its details. Reuse the loop's existing repeated-refusal case; it proves persistence, not a storage repair.
- [ ] Extend only the relevant failed-check cases in `apps/dashboard/src/screens/payments-screen.test.ts` before changing `i18n/strings.ts`. Keep listed/removed evidence and action/load distinctions; add bounded fault guidance after repeated failure. Touch `payments-screen.ts` or `i18n/codes.ts` only if a proved consumer needs different wording selection, with a failing browser test first. Preserve reason-specific messages and existing behavioral assertions.
- [ ] Update `apps/server/src/guide/{en,es}/table-service.md`, shared anchor `card-check-failed`, from the executed routes and actual till controls. Keep Counter recovery. Qualify any table instruction against existing control wiring in `apps/till/src/till-app-bill-payments.test.ts`; add a focused case only if coverage is missing. No guide promise that a blind retry, restart or cleanup repairs an unknown cause.
- [ ] Delete the completed A1089 payments entry in `docs/backlog.md`; narrow/delete the four corresponding audit rows in `docs/backlog/self-service-refusals.md`. Retain any genuine unresolved financial handoff rather than claiming its implementation.

## Verification and review

Server tests own stored outcomes, balances and absence of another collection; screen tests own wording, controls and evidence. New code changes follow observed red then minimal green. Existing-path qualification can pass immediately and is reported as such. Run changed files with `pnpm --filter @waitron/{server,dashboard,till} exec vitest run <named files>`; during implementation use exact case filters. Run server `src/guide-content.test.ts` and root `scripts/guide-links.test.ts`. Look at changed EN/ES text in both themes at phone and desktop widths. Keep evidence outside the repository.

Claude reviews this plan before build; watcher clearance follows. Then use the full payments `finish-branch` review, normal push hook, current-head CI and authorised `land-branch`. The plan does not authorise expanding scope after a failed experiment.

**Expected size:** production wording/selection +20–50/−10–25 lines; tests +120–220/−0–20; guides/audit/plan +70–110/−35–70. Approximately 300–500 changed lines, fewer if the fallback premise is obsolete. No size target to fill.
