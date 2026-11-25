# Split the Dashboard and Till API clients

- **For approval.** Lane E queue, watcher 25 November 2026 at 13:35. The driver signs off the draft,
  Claude reviews it, and the watcher clears the scope before work starts.
- **Scope for clearance.** At `5e8d24f`, Dashboard and Till are 5,934 and 5,624 lines. Their classes
  occupy lines 3001–5934 and 2684–5624. The TypeScript scan found class-private `#` names in 424 of 425
  Dashboard methods and all 249 Till methods. Node 26.13.1 rejects `this.#request` in a class that
  lacks the declaration. Keep both real classes in `client.ts`, including constructors, prototypes,
  calls and request/session state. Move domain declarations and free helpers. Ask the watcher to
  decide separately how to split the methods and bring each class within 1,000 lines.

## PR 1 · Dashboard

- Under `apps/dashboard/src/api/`, group menu reads in `menu-read-types.ts`. Group catalog, people
  and roster, venue and floor, devices, printing, sales and tax reports, box and backup, payments,
  orders, and theme. Move `layoutPath` with floor and `PageTestPage` into `printer-types.ts`.
- Estimate 2,400 declaration lines moved. Repoint the Dashboard path in
  `scripts/a4-hold-code-copies.test.ts`.

## PR 2 · Till

- After Dashboard lands, group menu, orders and drafts, payments, kitchen and pass, devices and
  equipment, floor and parties, attendance, and invoice delivery under `apps/till/src/api/`. Move
  `menuOfferToTillProduct` and its helpers into `menu-product.ts`. Move `a4HoldCodes` into
  `invoice-delivery-types.ts`.
- Estimate 2,000 declaration lines moved. Repoint the Till path in the A4 guard.

## Run for each PR

- Agree a quiet hour with the watcher before starting. Land the full app split in that hour with
  green current-head CI. Rebook if checks run past the window.
- Ship `scripts/dashboard-client-split.json` or `scripts/till-client-split.json` for
  `node scripts/move-ts-declarations.mjs <map>`. Map declarations by name. Point consumers at the
  definitions, including existing forwarded exports the mover skips. Check that forwarding exports
  are gone from `client.ts` and the changed imports introduce zero runtime cycles. Repoint live
  references. Record the remaining class work in the backlog if needed.
- Use the mover’s signature and byte-for-byte body checks. Compare exact class text from before the
  move to the formatted result. Lower each cap in `scripts/product-file-size-limits.json` from the
  measured count. Keep every new file within 1,000 lines.
- Run `pnpm --filter @waitron/<app> test src/api` and typecheck both apps. Run root
  `product-file-size.test.ts` with the new files staged and `a4-hold-code-copies.test.ts`.
  Preserve all assertions, including Dashboard’s passive GET check and Till’s tab-person suite.
  Budget 250–400 map and verification lines and 600–1,200 revised import lines per PR.
  Existing test edits are limited to import and source paths. If the mover needs a change, first
  reproduce the gap in `scripts/move-ts-declarations.test.mjs`.
- Before opening each PR, replay its full map on a disposable copy of a current affected open
  branch. Update the branch map for extra or renamed declarations when the mover refuses. Verify
  branch edits survive, including edits to the retained class. Typecheck and run focused tests.
  Share the command for lanes to run before rebasing.
  [Lane H’s replay recipe](2026-11-24-working-order-file-split.md#carry-an-open-branch-across-the-split).
- **Rehearsal.** On detached PR #4334 at `a284cdbfaefe96a8d0077dcd0aba7ada485cd940`, a temporary
  Dashboard map moved `ActivationTime` and six menu-read types into `menu-read-types.ts`. It rewrote
  `widgets/menu-publications.ts` import and preserved its new slot. The class text and all
  non-import statements in the widget matched the originals. The mover, Dashboard typecheck,
  `git diff --check`, and 166 tests in `client-routes.test.ts` and `menu-read-controller.test.ts`
  passed.
