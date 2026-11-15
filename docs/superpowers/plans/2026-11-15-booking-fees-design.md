# Booking fees and no-show charges: spec drafting plan

**Finish line:** You can choose a booking-card approach from a comparison of SumUp and Stripe in `docs/superpowers/specs/2026-11-15-booking-fees-and-no-show-charges.md`: about 700–900 words plus short references, capped at two pages. Expected change: documentation only, zero code/tests.

**Authority:** Lane F `queue.md`, BOOKING-FEES-DESIGN, records the owner's 2026-11-15 ~12:04 choice, “Design item first (Recommended)”, following the 09:45 request about reserving money and checking a card without charging. The owner requested the design item; no owner approval of a design or plan is recorded. The driver reads/corrects and commits this plan, obtains one Claude review and watcher clearance, then drafts the spec.

1. **Reuse existing evidence.** Read `~/waitron-campaign-f/receipts/sumup-holds-research-20261115/report.md` and `docs/research/2026-09-18-online-payment-providers-bizum.md` as research leads, not established provider capabilities. Reuse `CLAUDE.md`, `docs/developers/writing-claims.md` and `~/.claude/docs-writing-style.md` for evidence and plain-English rules.

2. **Read focused entry points found with `rg`.** Bookings: `packages/bookings/src/bookings.ts` and `packages/bookings/src/routes.ts`. Guest booking page: `docs/backlog/till.md`, A1013, describes the proposed public surface; do not invent an existing implementation. Payments: `packages/payments/src/provider.ts`, `packages/payments-sumup/src/provider.ts` and `packages/payments-stripe/src/hosted-provider.ts`. Describe affected pieces without designing interfaces or tables.

3. **Verify and compare.** Check each provider's own public documentation for saved-card later charges, authorisation holds with capture/release, and zero-amount verification. Recheck the reported SumUp €1 charge/immediate refund example. Quote, then paraphrase, with one provenance row per external claim: URL, date, exact excerpt, bounded interpretation. Separate documented limits, inference and unknowns; exclude unverified marketing promises. Check consent, authentication, hold duration and later-payment failure where relevant.

4. **Make the choice concrete.** Follow eight guests booking Saturday, with €10 each (€80) due for a no-show. Explain what venue and guest see at booking, attendance/cancellation and attempted collection. End the spec with one owner question choosing the approach and an evidence-based recommendation.

**Boundaries:** No implementation, paid/authenticated requests, signup or new fiscal policy. Update an existing backlog entry only if it actually describes the delivered design; A1013 remains open for implementation.
