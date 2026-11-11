# Till payments and cancellation (A840/A842/A848, R3 Important 2)

Codex plan. Request: `docs/backlog.md` A840/A842/A848 and Lane F queue, watcher
11 November 17:20 release and 17:55 addition of R3 Important 2. The owner answered
“yes” at 17:50 to R3 proposal 3: a sent dish leaves only through Cancel item;
whole-order cancellation is Cancel item per dish plus the order's reason.
Claude's first plan read took 482s; its corrections are incorporated. The second
Claude read took 461s. Watcher18:18 corrected its earlier18:32 refusal
note to the smaller server VOID correction below. Watcher18:50/19:15 cleared the invoice-route retirement and test ownership
correction in step1; no owner approval of this plan is claimed.

**Finish line:** remove obsolete Cancel and credit at Counter; show the pressed
payment action coloured with a spinner; word empty-order refusals in EN/ES;
tell the kitchen when a placed counter order is cancelled.
Reuse current widgets, refusal mappers, cancellation context/operation and
`wt-button.loading`. No table, migration, protected fiscal writer or hardware gate.

1. **A840:** production sale writers settle immediately, except unpaid departure,
   which closes its party (`unpaid-departure.ts:152,206`); moving that bill requires
   an open party (`bill-actions.ts:136`, `parties.ts:401`). Prove that boundary
   with one route case: unpaid departure, attempted move to Counter must answer
   `party.not_open`, with no invoiced waiting row. An accepted move falsifies it.
   Retire the counter Cancel and credit button/event/handler, counter-only dialog
   branches/wording and tests. Keep table cancellation, the server route and
   `CounterWaitingOrder.invoiceNumber`, used when paying old issued bench orders.
   Add one absence assertion to an existing waiting-widget case, no new suite.
   With the route proof passing, retire cancelPlaced's unreachable invoice-credit
   branch and whole-route/PIN acceptance tests. Preserve financial values, line
   links and own-operation refusal assertions directly on creditWholeInvoice;
   preserve invoice/credit-note reads. Keep that fiscal writer unchanged even
   though this removes its last production caller (watcher19:15; Lane L owns it).
2. **A842:** fix retained Cash/Card in `tender-pay`, including the table's
   zero-total fallback (`till-table-order-screen.ts:#paysOnSheet`). Positive
   whole bills already use the shared payment sheet. Remember
   the pressed action: primary/loading while busy, alternative secondary/disabled.
   Also cover Counter Pay preparation and zero-total Cash/Card fallback. Widget
   tests own these transitions/reset.
   Reuse existing sheet-loading tests; no duplicate shared-button paint tests.
3. **A848:** Pay and Send already disable at zero lines; preserve that. Reproduce
   a whole-bill Pay refusal after another device empties the bill; map
   `sale.empty_basket` through the code table and whole-payment mapper:
   “This order has no items. Add an item before continuing.” / “Este pedido no
   tiene artículos. Añade uno antes de continuar.” Check empty Send, Move this
   bill (empty bills may move), and Move dishes (empty selection sends nothing).
   Word a reachable send/move server refusal through its existing mapper; never
   enable a control or add server checks just to manufacture a refusal.
4. **R3 Important 2, watcher18:18 correction:** keep `cancelPlaced` and its
   route. Before abandoning the order, send a VOID correction for each fired,
   not-served kitchen item through `enqueueCorrectionSlips`, the shared notice
   and slip operation used by Cancel item and removeFromLine. Preserve the one
   order reason. Restore M's `reports/r3/2.patch` route proof: order abandoned,
   one VOID notice and one slip. No sent-dish refusal or new screen sequence.
   `abandonHeldOrder`'s choices and counter Cancel item remain in R3-owner.

**Files:** till `till-app.ts`, `api/client.ts`, `i18n/{codes,strings}.ts`,
`widgets/{tender-pay,counter-waiting,cancel-credit-dialog,cancel-item-dialog}.ts`
and their focused siblings; counter cancellation suite retires, duration entry
goes, existing table/move tests remain. Server `working-order.ts`, `till-api.ts`, `errors.ts`, the one new
route proof and any affected existing cancellation tests.
Apply the watcher19:15 test-ownership correction; protected fiscal writers stay unchanged.

**Checks/delivery:** failing test before each fix; run every changed test file.
Inspect EN/ES, light/dark, phone/desktop; use existing accessibility helpers.
Update affected guide twins/backlog and C126's dated retirement pointer. A739
physical checks stay in the real-box session. Hook, Claude run-it reviews, one
fix-read, current-head CI, authorised landing. Forecast production +80/-150,
tests +180/-850, support +0/-1, docs +40/-30. Watcher18:50 cleared
additional deletions for the retired invoice route. Stop for other growth or new behaviour. Empty Send stays disabled; verify its visible empty-basket wording.
