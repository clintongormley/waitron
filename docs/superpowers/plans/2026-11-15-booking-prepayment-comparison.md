# Booking prepayment comparison rewrite plan

**Ask, verbatim** (Lane F queue.md, BOOKING-PREPAY, watcher 20:51 on 15 November 2026):

> the owner chose "Prepay, refund on arrival" (2026-11-15, watcher's window) over a saved card. Rewrite `docs/superpowers/specs/2026-11-15-booking-fees-and-no-show-charges.md` on that basis: which provider takes an online prepayment and refunds it on arrival, each provider's refund window quoted from its own page (SumUp: refunds "may not be possible" for some payments over 90 days old, and need balance not yet paid out; Stripe's refunds page states no card limit), fee cost per booking, and the tax side from `docs/compliance/2026-11-15-adviser-answers.md` "Deposits (adviser 1.8)" with no-show VAT as question 18. Docs only, nothing built.

**Finish line.** The owner can compare SumUp and Stripe for the chosen collect-now/refund-on-arrival booking guarantee, including bookings beyond 90 days, retained transaction costs, and the adviser's deposit ruling. Keep SumUp as the till provider. This is documentation, not permission for paid experiments or product implementation.

**Smallest route and reuse.** Rewrite the named spec around its existing eight-guests/€80 example and provenance table. Reuse current first-party checkout/refund/pricing docs and the recorded adviser answer; distinguish a full payment/refund from a card saved for a later attempt or an expiring authorisation. Give one compact comparison and hand-calculated €10/€80/€100 costs under explicitly stated Spain standard card pricing, distinguishing a published headline from a negotiated API tariff. Quote each refund-window source, preserve balance/refund-failure limits, and retain the no-show VAT question. Do not invent a refund accounting answer where the adviser has not supplied one.

**Files.** The named spec; this one-page plan; only an existing booking/backlog wording if the rewrite makes it stale. No code, tests, payment calls, fiscal builders, new feature/backlog item, guarantee protocol, product plan, or provider switch. Remove the superseded saved-card recommendation and owner question; retain a dated pointer if historical context needs it.

**Checks.** Open the provider's own current pages and retain short quote/URL/interpretation provenance rows, verify the €10/€80/€100 arithmetic, read the adviser’s deposit paragraph and question18, check links and the final diff. No runtime test: nothing executable changes. Claude reads this plan before build, then watcher clearance; a separate Sol-high Codex invocation writes the spec per RUNNER. Follow docs-only signed commit/serialised main fast-forward, never a standalone PR.

**Size.** 0 production / 0 test lines; roughly80–120 documentation additions and50–70 removals, plus this plan. Claude plan review and watcher clearance pending; no owner approval of this design claimed.
