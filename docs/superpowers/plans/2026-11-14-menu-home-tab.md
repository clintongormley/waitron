# Menu Home tab implementation plan

Authority: `MENU-HOME-TAB`, `/Users/clintongormley/waitron-campaign-d/queue.md:26`; source: `docs/backlog/catalogue.md:977` and its linked detail.

> The ask: (1) the Home page tab's till preview draws the menu at the width it really gets on a till, sharing the screen with the order; (2) a product shortcut reached only through a disabled included menu says "Not shown: in a disabled included menu", as a section shortcut does; (3) a shortcut's bin button is quiet while a reorder or a display setting is saving (design-system Forms: actions quiet while saving); (4) the preview stops being a hand copy of the till's menu browser and reuses the till's rendering, or the plan says why that costs more than it saves. Screenshots in both themes and at phone width, not committed. Plan first (one page), Claude's read, then PLAN FOR APPROVAL.

Authored separately by GPT-6.1 Sol at high effort, checked and narrowed by the Codex driver; code read only. Claude completed its 2026-11-14 approach review (Lane D receipts/menu-home-tab/plan-review.md); the driver accepted its corrections below. Watcher clearance is pending. The watcher queued this exact ask on 2026-11-14 at 05:38; that record is local to Lane D. No owner design approval is recorded. Driver checks/commits this artifact before Claude's read; build waits for review and watcher clearance, then proceeds inline in one branch/PR for all four points.

## Decision and bounded build

Finish when you can judge till density with order space reserved, see the correct disabled-include reason, and cannot bin a shortcut during its home's saves.
Keep separate rendering now: grid, arrangement, indexing, paths and fills already come from shared rules (`apps/dashboard/src/widgets/device-home-preview.ts:31`, `apps/till/src/widgets/menu-browser.ts:17`).
Till templates bind availability, nutrition, counts and gestures, and mount product-info/weighing/modifier windows (`apps/till/src/widgets/menu-browser.ts:660`, `:912`); dashboard products are inert with shortcut editing (`apps/dashboard/src/widgets/device-home-preview.ts:659`, `:703`). Sharing requires extracting templates/styles/callbacks into two adapters or importing those till dependencies. Estimate: hundreds of moved lines and both apps' interaction checks, beyond this three-hour fix. Sharing CSS/thumb/paint alone still adds a cross-package presentation interface while leaving both renderers; defer that partial extraction too. Rewrite the duplication backlog item to name only copied markup/styles/helpers and the newly copied layout values; arrangement/trail logic is already shared.

- [ ] **Width:** modify `apps/dashboard/src/widgets/device-home-preview.ts` and EN/ES `apps/dashboard/src/i18n/strings.ts`.
  Inside the existing Till frame, label **Table order preview**, state that the represented till is as wide as this frame, and reserve an inert order pane. No claim of matching a 1280px till from a narrower frame. Match table ordering's 3:2 flex allocation, gap, inset/border and ≥720 screen-width switch (`apps/till/src/screens/till-table-order-screen.ts:220`, `:1165`, `:1188`, `:1922`). Use preview screen width, not dashboard viewport; below 720 show full-width Menu. Constrain search/sections/results alike; preserve handheld sizing. Counter uses 2:1 (`apps/till/src/screens/till-counter-screen.ts:120`), so use the narrower table layout as the conservative reference; add no selector or working basket.
- [ ] **Reason:** in the preview widget, use offers plus `placed.products`. Structural placements traverse includes (`packages/catalogue/src/section-graph.ts:180`); offers filter active products (`packages/catalogue/src/operations.ts:579`); documents omit disabled includes but retain offers (`packages/catalogue/src/menu-document.ts:233`, `:299`). Find offers by their productId, never their menu-item map key. Reachable hidden product with offer but no placement uses existing EN/ES `home.not_shown_disabled_menu`. Preserve extra-only, absent-offer not-on-sale and missing reasons; no API/schema change.
- [ ] **Bin:** modify `apps/dashboard/src/screens/menus-screen.ts` and the widget. Add a remove-only disabled property derived from busy, current-menu `homePending` and `#writes.pending(homeScope)`; redraw on enqueue and queue idle, including refused/dropped moves (`apps/dashboard/src/widgets/section-writes.ts:11`). Guard both removal handlers. Keep grips/repeated moves usable (`apps/dashboard/src/screens/menus-screen.ts:2127`); include display saves (`:2169`) omitted by today's binding (`:3359`). Reuse the queue unchanged.

## Tests and focused commands

Failing dashboard assertion first; inspect its expected failure, implement, rerun. Preserve behavioral assertions, especially reading order, grip focus, queued replies and remove-through-reread; change only expectations this ask supersedes.

- [ ] **Producer:** extend `packages/catalogue/src/menu-document.test.ts:2006`: inactive folder/direct includes retain the offer while omitting placement.
- [ ] **Widget:** extend `apps/dashboard/src/widgets/device-home-preview.test.ts`: pane widths/tracks at 1280/720/719/390; handheld/tile minimum/reading order; disabled-only versus absent-offer/extra-only/missing and enabled alternate placement, with one Spanish new-reason check; native bin disabled/no event, grips usable. Extend `apps/dashboard/src/widgets/device-home-preview.a11y.test.ts` in both themes.
- [ ] **Screen:** extend `apps/dashboard/src/screens/menus-screen.home-tab.test.ts`: deferred reorder/display saves block bin requests, synthetic events included; retain focus/repeated moves; recover after success/refusal. Existing queue tests retain responsibility for cancellation and navigation; add no new race suite. Preserve display/unsaved assertions below.

Run sequentially from root; inspect test counts and exit statuses:

```sh
pnpm --filter @waitron/catalogue exec vitest run src/menu-document.test.ts -t 'an inactive included menu still drops out'
pnpm --filter @waitron/dashboard exec vitest run src/widgets/device-home-preview.test.ts src/widgets/device-home-preview.a11y.test.ts src/screens/menus-screen.home-tab.test.ts src/screens/menus-screen.home-columns.test.ts src/screens/menus-screen.home-shortcuts.unsaved.test.ts
pnpm --filter @waitron/dashboard exec vitest run src/screens/menus-screen.test.ts -t 'the Home page tab'
pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts
pnpm exec vitest run scripts/guide-links.test.ts
```

## Finish and size

- [ ] Audit/update `apps/server/src/guide/en/products.md` and `apps/server/src/guide/es/products.md` together: represented frame width/enabling an included menu, matching heading IDs. Update `docs/developers/design-system.md:523`'s preview/bin contract. Delete only completed width/reason/bin entries and matching detail in `docs/backlog/catalogue.md`; rewrite the remaining duplication entry as above, retain A339 fixtures and section-scroll work, and update `docs/backlog.md`'s bundle index/count.
- [ ] Via `wa-wt demo <implementation-worktree-name>`, inspect/capture light/dark at desktop and 390 px, hidden/saving states included; compare actual table ordering at matching usable width. Read rendered widths; restore viewport/locale. Screenshots stay in ignored package `__screenshots__/` or local receipts, never committed. Finish through `finish-branch`, Claude whole-branch review, normal hook and current-head scoped CI.

Estimated added/removed lines: production +70–110/−10–25; tests +140–220/−5–15; test support +0/−0; docs +15–30/−15–30, excluding this plan. No new helper/framework/table/package/dependency; exclude live ordering, nutrition redesign and unrelated cleanup. Three-hour estimate: width 45m, reason 25m, saving 35m, checks/visuals/docs 55m, fixes 20m; review/CI waiting additional. Material departures return to Claude/watcher before build. Specs/plans are deliberately committed by the driver; campaign files remain untouched. No product code or test changes in this planning branch.
