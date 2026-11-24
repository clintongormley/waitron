# Preserve the list that a dish answered

Lane H, 24 November 14:13 queue and [backlog](../../backlog/architecture.md#bundle-small-checks-and-indexes-that-are-cheap-only-inside-a1308s-fresh-tables), after #3746.
Staff can recall an unsent dish, keep its Cooking answer after the list disappears, and answer the new required Milk list before saving. Follow the [A1308 slice rules](2026-11-08-a1308-slice-rules.md). The watcher cleared working-order storage and Lane H landing on 24 November at 14:35 in Lane H's questions.md.

The watcher cleared a further case at 15:15. If staff answer a re-created Cooking list with the same staff name, its answer replaces the removed list's answer. The server modifier and working-order tests pin the replacement. The till test pins the prompt and the single Cooking answer after reading the save back.

## Tests first

- In `apps/server/src/working-order.test.ts`, park Cooking and Sauce, delete Cooking, add Milk and republish. Saving Sauce alone must refuse with `options.label_required` for Milk and leave the line and revision intact. A save with Milk must store all three original identities and retry without changing the revision.
- In `apps/till/src/till-app.test.ts`, recall those answers against Sauce and Milk. Expect the existing `held.options_changed` banner. Choose Milk with the existing picker. Assert the save sends Sauce and Milk and reads back Cooking even when the old answer count equals the picker result's count.
- Use `pnpm --filter @waitron/server exec vitest run src/working-order.test.ts -t 'refuses a new Milk list'` and `pnpm --filter @waitron/till exec vitest run src/till-app.test.ts -t 'asks for Milk'`. Watch each fail on the old behavior before editing production code and pass afterwards.

## Implementation

- Add optional `listId` to `OptionSnapshot` in `packages/shared/src/option-selection.ts`. Always copy it in `answerFreezers` (`apps/server/src/modifier-selection.ts`) and `optionSnapshotOf` (`apps/till/src/state/held-options.ts`). Picker and draft rebuild already use the latter. Keep all six names and the existing write request.
- In `editUnsentLineOptions`, match by original list ID and keep answers of removed or inactive lists. For active lists, reuse the existing validator and freezing rules. Exempt an omission only when that list's saved staff names no longer match an available choice. Preserve a stale resend of its withdrawn answer, validate every new list, and keep malformed and duplicate refusals. An explicit valid answer replaces its own list's answer.
- Keep `working-order.ts`'s sent and single-line routing. Require original ID plus existing staff-name checks in `asksNoNewAnswer`. Keep the no-change `null`, wording refresh, order-independent equality, and sent recall/refusal for real changes. Whole-order omission and an empty answer array both validate zero selections. Single-line omission keeps stored answers.
- Rebuild same-list available selections in `held-options.ts`. In `apps/till/src/till-app.ts`, detect active offered lists with no answer of their own and reload after save when a stored ID is absent from the basket. Keep sent and failed-read handling. Set menus use their recorded offer and existing label availability. Record the withdrawn-dish offer mismatch in the till backlog.
- Remove list ids at `toStoredLines` before payment. Use names only for Orders list and till kitchen grouping, and keep the id in editable portion keys. Preserve the sale and receipt assertions.
- The PR starts with a reset notice for pre-live venues because working-order answers gain their list id. Earlier database backups lack this field. The column already holds JSON. `migration-baseline rebuild-check --set core` verifies the unchanged SQL and there is no generated migration.

## Checks and docs

- In server `working-order.test.ts` and `modifier-selection.test.ts`, update the renamed/deleted-list and three count-based retention expectations to keep the exact removed list's answer. Replace retired count and till name-assignment cases with edit and original-ID assertions. Keep the stale-withdrawn, same-name twin, still-matching omission and single-line controls.
- Server focused suites under `apps/server/src` are `working-order`, `modifier-selection`, `set-menu-edits`, `till-api`, `till-sale`, `till-api.fiscal-sale-paths`, `till-api.sell-published`, `portion-sale-projection`, `adjustments-apply`, `order-portions.filing`, `orders-list`, `receipt-language`, `receipt-ticket`, `receipt-document` and `guide-content`. Add IDs to working-order snapshot assertions, including the order half of `storedGoods` in `receipt-language.test.ts`. Keep receipt response and printed assertions intact.
- Till suites under `apps/till/src` are `till-app`, `till-app-menu-refresh`, `till-app-set-menus`, `state/{held-options,draft-lines,portion-groups}`, `widgets/modifier-picker` and `screens/till-table-order-screen{,.sent-change}`. Update authoritative fixtures. Run `@waitron/orders-sales`'s `receipt-lines.test.ts`, unchanged fiscal `write-path.e2e.test.ts` and `inmutabilidad.test.ts`, and Server, Till, Orders and Sales and affected dependents' typechecks per CI scope.
- Update the snapshot descriptions in `option-selection.ts`, `working-order.ts`, `apps/till/src/api/client.ts` and `packages/db/src/schema/orders.ts`. Update `docs/developers/{modifiers,products}.md`, both `apps/server/src/guide/{en,es}/modifiers.md` guides and `scripts/guide-links.test.ts` verification. Check the recalled dish in both languages and themes at phone and desktop widths. Remove the completed architecture backlog bullet, update its index count and retire the till backlog's answer-count rule.

**Expected protection-list difference** · Run `pnpm protection-list list --out <empty absolute dir>` from `apps/server` on base and tip, then compare. Expect `EQUAL`. Report the payment route's portion projection as a sale-path read change.

**Estimated changes** · 200–300 production and 250–400 test lines including deletions, 30–50 documentation lines, zero generated lines.
