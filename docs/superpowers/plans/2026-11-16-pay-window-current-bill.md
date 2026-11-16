# Pay window: the current bill — implementation plan

**Status:** Separately invoked Sol writer's driver draft; pending Claude review and watcher clearance, with no owner design approval claimed. Implement inline under Lane F RUNNER; one PR.
**Request:** PAY-WINDOW-AFTER-A739 in `~/waitron-campaign-f/queue.md`; A1300/A1291/A1266/A1191 and “The pay window, after A739” in `docs/backlog/till.md`, indexed in `docs/backlog.md`.
**Finish line:** Pay shows current payable dishes, refuses an outdated Whole bill amount, and keeps the original unanswered card payment reachable after another till moves its bill.
**Cut:** Defer A1191's grouped rows/counts/member line numbers to its own PR. All four forecast about 1,150–1,350 changed lines; this three-fix PR about 840. Keep A1191 outstanding.

## Source and reuse

- Checkout `630c676e2b`; inspected main/origin main `affd73e2ad`. `git diff --name-only HEAD..main` shows setup changes, not these payment files. Refresh backlog positions before editing.
- Whole bill currently becomes a contribution (`apps/till/src/widgets/bill-pay-dialog.ts:948`). Existing share-of-one wire support (`apps/server/src/bill-payments-api.ts:75`) and `bill-allocation.ts:214` compare confirmed applied money/tip before payment insertion (`bill-payments.ts:1262`). Reuse them; no new protocol/server allocation rule.
- Existing `TILL_LIVE_TYPES.billDraft` includes lines/payments (`apps/till/src/api/live-connection.ts:94`). Queued live refresh and disconnected 15-second fallback (`till-app.ts:5072,13296`) reread drafts/bills; `#openBillPaying` retains opening lines, while `#loadBillBalance` updates screen balance only. Reuse `payLines`, `paidQuantities` and read-generation checks.
- Trace `#followBillsRead`, `#presentedNow` and `#renderPresentedPaying`: replacement leaves `billPaying` behind and hides old-bill whole-payment confirmation. Merge abandons its source and refuses one holding payments (`apps/server/src/bill-actions.ts:133,185`); move retains its id (`move-bill.ts:171`). Preserve those gates; do not invent a pending-payment merge fixture.
- Reuse retained maps, `#unknownCardOutcome`, `#freeShownPayment`, balance/receipt reads, provider-recovery link and existing payment windows/`wt-dialog`/`FormFeedback`. Read the supplied modern-web guide in full (1–808); no new dialog/controller or focus trap.

## Decisions and test-first steps

Before each fix, add its named browser regression, run unchanged code and observe the specified failure; implement minimally, then rerun. Preserve existing behavioral assertions. Server characterization below may already pass on main.

- [ ] **A1300 — refuse the outdated whole amount.** Modify `apps/till/src/state/bill-payment.ts`, `widgets/bill-pay-dialog.ts` and `till-app.ts`. Add a UI-only whole choice carrying visible outstanding; `paymentAsk` maps it to existing `shareOf: 1`. Typed contributions retain their meaning.
  Compare whole preview with the visible amount before enabling confirmation. A difference refuses the old choice, refreshes balance and requires explicit acceptance of the displayed new amount. Preserve cash-shortage field handling when fresh preview cannot be funded. Changes after preview meet existing server allocation/editor gates.
  Reuse `bill.allocation_changed`; amend `apps/till/src/i18n/codes.ts`/`strings.ts` where needed: explain the change, that Confirm accepts new amounts, and Back returns to choices. Preserve manual-card wording about money already taken elsewhere.
  **Browser/state ownership:** new `apps/till/src/till-app-current-bill-pay.test.ts`, “Whole bill refuses €27 after a €3 dish arrives”: no take before explicit €30 acceptance; cover growth before/after preview. Extend `state/bill-payment.test.ts` for whole → share-one/original confirmed money and unchanged contribution; `widgets/bill-pay-dialog.test.ts` for visible amount in its event and operable refusal choices.
  **Server ownership:** extend `apps/server/src/bill-payments.refuse-before-reader.test.ts`: stale share-one returns `bill.allocation_changed`, writes no payment and calls no collect; fresh matching request succeeds. Use current editor envelope to reach allocation; reuse real venue/fake reader, no fiscal edits.

- [ ] **A1291 — refresh lines and balance together.** Modify `apps/till/src/till-app.ts` at existing live/fallback refresh and successful line-read application points. Include bills without prior payments; accept responses only for their dialog/bill/session. Failed reads retain successful rows; successful reads retain action refusals.
  In `widgets/bill-pay-dialog.ts`, remove departed/fully-paid picks, cap reduced quantities and retain valid picks, tender/tip input. Invalidate an unsent preview whose selected lines changed; preserve already sent/unanswered request, preview and submission id.
  **Tests:** in `till-app-current-bill-pay.test.ts`, “Pay items removes another till's moved dish while open”: subscribed `working_order_lines` event removes its row and line number from the next preview; also exercise disconnected timer refresh. Widget tests own pick reconciliation. App tests pair read failure with retained rows/refusal, and delayed old-dialog response with unchanged reopened content.

- [ ] **A1266 — close idle entry, keep original recovery.** Modify `apps/till/src/till-app.ts` when successful bills reads replace the selected bill. Close idle Pay/presented windows and refund child, retain existing draft-close handling and moved/merged explanation; never automatically pay the replacement bill.
  In-flight/unanswered payments keep a locked recovery view for the original bill independently of screen selection. After dismissal, a named Check payment action from existing retained maps reopens that view with original label/amount. Reuse existing windows; no durable storage/recovery list.
  Recovery reads original submission/payment and offers existing provider-check link while unknown. One balance read missing the payment releases nothing. Never resend an unknown reader charge, mint a replacement submission id or retarget it. Known settlement reads the original receipt, reachable after screen relocation.
  **Tests:** in `till-app-current-bill-pay.test.ts`, “idle Pay closes when its bill moves or merges”; “moved bill retains unanswered-card recovery after dismissal”; “detached recovery reads receipt without another charge”. Cover both retained maps/unknown-reader marker with reachable move/lost-reply states; assert original bill/body/id and no extra take/charge after recovery completes. Preserve logout/session guards and A773/A1399 assertions.

## Validation, size and landing

- Reuse `apps/till/test/bill-pay-app.ts`, `test/live-connection.ts`, widget helpers, and `apps/server/src/testing/bill-payment-fixture.ts`/`bill-venue.ts`; server suites retain `useVenueDb`. No provider contact/new fixture framework.
- Update `apps/server/src/guide/en/table-service.md` and `es` twin at shared `#pay-window`, plus `docs/developers/design-system.md`'s Shared bill payment window contract. Explain staff actions only. No schema/invoice/filing/deferred-close/printer changes; return to driver/watcher if required.
- Run `pnpm --filter @waitron/till exec vitest run src/till-app-current-bill-pay.test.ts src/state/bill-payment.test.ts src/widgets/bill-pay-dialog.test.ts` and `pnpm --filter @waitron/server exec vitest run src/bill-payments.refuse-before-reader.test.ts`; require test counts and expected red reasons. Run every changed test file.
- Preserve focused A1399/recorded-settlement checks in `src/till-app-bill-payments.test.ts` with `exec vitest run ... -t 'A1399|reads a recorded settled payment'`; run changed unsaved/a11y cases if affected. LOOK in EN/ES, both themes, phone/desktop, checking keyboard focus and actual close events. Guide-content/link checks, pre-push and current-head scoped CI follow through `finish-branch`; no whole-package local run solely to finish.
- **Forecast, added/removed separately:** production **+210/−65**, tests **+460/−75**, test support **+25/−5** = **840** changed lines; docs **+25/−65** separately. A1191 adds an estimated 300–500, hence the cut. Report actual counts; material growth returns to watcher under RUNNER.
- **Collision:** read-only branch inspection found `till-app.ts` changes on `feat/a1522-till-dining` (+243/−7), and registered a1389/a1420/a739/a802 branches. Never edit those worktrees; driver rebases overlapping landed changes and reruns focused checks. Overlap alone does not block work.
- At landing, delete A1300/A1291/A1266 details and completed bundle/index references, including architecture link. Retain A1191 standalone for its later PR, removing obsolete A739 wait. This writer changes no campaign state and runs no product tests.

**Unresolved product question:** none within scope. Driver handles Claude review/watcher clearance; any proposal changing money beyond staff's confirmed amount returns to them.
