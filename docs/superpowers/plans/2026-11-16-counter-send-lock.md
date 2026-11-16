# Counter Send lock implementation plan

Authority: watcher queue, 2026-11-16 14:09, `/Users/clintongormley/waitron-campaign-f/queue.md`.
Separate Sol-high draft, source-checked by Codex; first Claude read: `receipts/counter-send-lock-20261116/plan-review.md` in that lane.
Claude reread completed; watcher cleared the smaller route on 2026-11-16 at14:26, including settling its corrections without a third read. No owner design approval is claimed.

## Finish line, reuse and limits

Staff can retry a lost Send without changes to the basket breaking that retry; Park cannot silently drop an attempted edit.
A hanging held-orders read at sign-in leaves the station queue, waiting list and staff free to load.
Reuse `#unconfirmedPlace`, its order/session/visit/server checks and `WorkingOrderStore.lockEdits()` in
`apps/till/src/till-app.ts` and `apps/till/src/state/working-order.ts`; clear/load already end locks.
Reuse per-list failures and generations in `#refreshList`, and the existing helpers in the two app test files below.
No generic controller, stored record, new wording, store semantic change, widget, server/API or fiscal/payment change.
Invoice/receipt metadata and dining remain editable; its existing refusal/replay assertions stay, with the remaining recipient issue in the PR thread.

**Collect proposal for the watcher:** drop the queued extra refresh and delete its obsolete backlog bullet, rather than refresh
unused data. `screens/till-counter-screen.ts` receives `stationQueue` but never renders a station queue;
its existing test asserts that absence, and `till-app.test.ts` explicitly retains queue data without drawing a prep rail.
Run those existing checks before the deletion. Do not add a new rail or a mock card to manufacture the requested reproduction.
Watcher14:26 cleared this cut. The two existing no-rail checks passed on 2026-11-16; no collect behavior change is built.

## Test-first build

1. **Lost Send lock.** Modify `apps/till/src/till-app-counter-adjustments.test.ts` before production code.
   Rewrite “does not replay an uncertain placement after the basket changes” as the added-dish failing case:
   attempted add leaves exact lines unchanged, sends no update, and the retry reaches collect without `place.error`.
   Add one raised-sent-dish case and one Park case: attempted quantity change is refused; Park sends no update
   and clears only the unchanged basket. Keep pre-first-Send edited-save assertions intact.
   Rename the replacement-server case: attempted edits stay blocked, no update goes out, the replacement's
   dead-end preparation and Place run, and the original API is called only for its first Place.
   Add lock-release assertions to existing definite-refusal/retry cases; cover clear/reload with existing store cases.
   Watch the relevant cases fail, then change `#onPlaceOrder` in `apps/till/src/till-app.ts`.
   Take the scoped lock when Place's reply is lost, retain it through retries and metadata-preparation refusals,
   and release only on Place's own definite answer or clear/load; an older completion cannot unlock another basket.
   Keep `{id, session, visit, unlock}` in a separate transient field, so clearing retry facts cannot lose the lock after a preparation refusal.
   Add one failed waiting-order-open case; its temporary read lock must not leave the original uncertain basket editable.
   One private helper re-establishes the lock for the same order/session/visit after either `#onPayWaitingOrder` or `#reloadCounterOrder` releases its temporary lock.
   Add one menu-poll version-change case; treat the edit-locked counter as busy in `#onMenuState`, postponing
   reconciliation through the existing due flag so an automatic version adoption cannot invalidate the retry.
   Keep recipient replay, receipt-language and unchanged successful-retry assertions; do not duplicate store lock mechanics.

2. **Independent sign-in lists.** In `apps/till/src/till-app.test.ts`, add “a held-orders read that never answers
   still installs station queue, waiting list and staff at sign-in”. Gate held, assert the other exact rows before release,
   and release in cleanup. Watch it fail, then start all three `#refreshList` calls and the existing staff read together.
   Keep per-list messages and generations; pass `replaced` to each read. Run the remaining floor-data work before
   awaiting those reads, preserving the existing floor-login and newest-success/late-failure cases without duplicate tests.

## Verification, documentation and size

Run each named case red then green with `pnpm --filter @waitron/till exec vitest run <file> -t '<case>'`, then both changed files.
Run the existing store lock cases and Counter no-rail checks. Keep the prepay-zone late-failure retry test unchanged.
Inspect the existing lost-Send visual cases in English/Spanish, light/dark, phone/desktop; use the normal push hook and current-head scoped CI.
Delete the false edit-after-Send paragraph in both `apps/server/src/guide/{en,es}/kitchen-service.md`; its preceding unchanged-basket instruction stays.
Delete completed A1417 and Task16 list-loading entries in `docs/backlog/till.md`, and A1417's index line in `docs/backlog.md`; update the Task16 summary.
As cleared by the watcher, also delete the obsolete collect bullet and its history comment in `#onCollectOrder`, without changing collection behavior.
Expected production +45–80/−15–35; tests +220–340/−30–60; no new test support or generated files. Guides/backlog mainly lose text; plan about one page.
