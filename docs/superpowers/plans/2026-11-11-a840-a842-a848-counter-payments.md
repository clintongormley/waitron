# Till payments and cancellation (A840/A842/A848, R3 Important 2)

Codex plan. Request: `docs/backlog.md` A840/A842/A848 and Lane F queue, watcher
11 November 17:20 release and 17:55 addition of R3 Important 2. The owner answered
“yes” at 17:50 to R3 proposal 3: a sent dish leaves only through Cancel item;
whole-order cancellation is Cancel item per dish plus the order's reason.
Claude's first plan read took 482s; its corrections are incorporated. The second
read and watcher clearance are pending. No owner design approval is claimed.

**Finish line:** remove obsolete Cancel and credit at Counter; show the pressed
payment action coloured with a spinner; word empty-order refusals in EN/ES;
cancel an ordinary counter order under A758's per-dish rules and tell the kitchen.
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
2. **A842:** fix table Cash/Card in `tender-pay` first; the table still uses the
   widget without a payment window (`till-table-order-screen.ts:5134`). Remember
   the pressed action: primary/loading while busy, alternative secondary/disabled.
   Also cover Counter Pay preparation and zero-total Cash/Card fallback. Widget
   tests own these transitions/reset; one app case holds the table payment answer.
   Reuse existing sheet-loading tests; no duplicate shared-button paint tests.
3. **A848:** Pay and Send already disable at zero lines; preserve that. Reproduce
   a whole-bill Pay refusal after another device empties the bill; map
   `sale.empty_basket` through the code table and whole-payment mapper:
   “This order has no items. Add an item before continuing.” / “Este pedido no
   tiene artículos. Añade uno antes de continuar.” Check empty Send, Move this
   bill (empty bills may move), and Move dishes (empty selection sends nothing).
   Word a reachable send/move server refusal through its existing mapper; never
   enable a control or add server checks just to manufacture a refusal.
4. **R3 Important 2:** reproduce M's `reports/r3/2.patch`. Reuse Cancel item for
   each sent dish before whole cancellation: fired asks if preparation started;
   started/served asks still charge / don't charge, with existing reasons and
   permissions. Extend its party-only context/operation to an explicitly checked
   counter bill, retaining the table wrapper. Reuse its dialog, and offer plain
   Cancel order for non-invoiced waiting orders, replacing no fiscal action.
   Keep the order reason. Never abandon a retained charge: still-charge leaves
   the bill payable; close only when remaining charges are removed or paid.
   Check `abandonHeldOrder` too: unsent-only discard stays simple; sent dishes
   use those same choices. Server tests own decisions and kitchen notice/slip/
   report effects; one app journey owns choices and retained-charge display.
   R3-owner later reuses this Counter support for basket ✕ and retires Recall.

**Files:** till `till-app.ts`, `api/client.ts`, `i18n/{codes,strings}.ts`,
`widgets/{tender-pay,counter-waiting,cancel-credit-dialog,cancel-item-dialog}.ts`
and their focused siblings; counter cancellation suite retires, duration entry
goes, existing table/move tests remain. Server `working-order.ts`,
`line-cancel{,-context,-api}.ts`, route/operation tests and existing fixtures.
Preserve issued-invoice behaviour; ask if protected fiscal writers must change.

**Checks/delivery:** failing test before each fix; run every changed test file.
Inspect EN/ES, light/dark, phone/desktop; use existing accessibility helpers.
Update affected guide twins/backlog and C126's dated retirement pointer. A739
physical checks stay in the real-box session. Hook, Claude run-it reviews, one
fix-read, current-head CI, authorised landing. Forecast production +350/-170,
tests +550/-850, support +0/-1, docs +40/-30; stop above 1.5 times that or a new
behaviour. The reread must challenge the new UI/API scope and shared operation.
