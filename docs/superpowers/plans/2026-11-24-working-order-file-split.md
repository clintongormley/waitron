# Split the working-order server file

The 24 November Lane H queue assigns `working-order.ts` first. Developers should be able to find an order operation in a file named for it and run the same move on an open branch. Keep the product code in the Server package. Share the single script with lanes D and K and post its commit in all three lanes' `questions.md` files. Each later server file gets its own plan. Retire the move maps and tool when this queued split work ends.

| Move order under `apps/server/src/` | What goes there |
| --- | --- |
| `working-order-context.ts`, `order-line-quantities.ts` | Dependencies, attendance, simple order checks and `paysAfterSending`. Line totals and extras quantities. |
| `working-order-serving.ts`, `stored-order-lines.ts` | Released and served state and writes. Stored and bill line reads, with `toVatBreakdown`. |
| `working-order-kitchen-fire.ts`, `working-order-late-send.ts`, `working-order-pricing.ts` | Station routing and ticket creation. Late-dish checks. Basket offers, modifiers and line pricing. |
| `working-order-open.ts`, `working-order-edit-state.ts` | Open and park orders and add rounds. Read editable state and guard edits and revision changes during payment. |
| `working-order-kitchen-service.ts`, `working-order-removal.ts`, `working-order-transfer.ts` | Release dishes, advance tickets and set courses. Remove, reduce and correct dishes. Move and split lines. |
| `working-order-line-edits.ts`, `working-order-held-write.ts`, `working-order-invoice.ts` | `applyLineEdits` alone. Save and abandon held orders. Invoice choice, language, pricing and issuance. |
| `working-order-pass-groups.ts`, `working-order-station-queue.ts`, `working-order-pass.ts` | Group-station lookup. Shared queue rows and the station queue. Pass rows. |
| `working-order-counter.ts`, `working-order-held-read.ts`, `working-order-table-state.ts` | Place, cancel, collect and hand over. Read parked and placed baskets. Read seated and occupied tables. |

Require no import cycle wholly inside the 21 new files, including type imports. Move `applyLineEdits` whole into the watcher-cleared 1,250-line exception and remove the old entry from `scripts/product-file-size-limits.json`. The 24 November 16:17 Lane H watcher note clears the split and asks for the tool PR first.

- Test `scripts/move-ts-declarations.mjs` first in `scripts/move-ts-declarations.test.mjs`. Check an alias follows a moved declaration, a branch-only declaration gets a named destination, a titled test block retains its text, and an unexpected missing or unmapped name fails before writing. The move map is `scripts/working-order-split.json`. Use TypeScript's installed **Move to file** for import edits. Copy declarations from original source spans. Format the changed files, then compare function bodies and comments byte for byte and compare the signature tokens, permitting the added `export`. Check the initial move in memory before writing, too. Keep the `./errors.js` side-effect import where needed. Remove `working-order.ts` and send its re-exported imports straight to their definitions. Update live doc and code references. In `menu-engine-neutral.test.ts`, list only the moved files that carry SQL templates.
- Rehearsed on PR #4238's actual fork and tip (`58f8d2d2a44`, `658c747d12a`). TypeScript 6.0.3 reprinted `carveLines` and `applyLineEdits`. Restoring the original declarations in memory preserved both edited versions exactly, at 11,138 and 40,891 bytes. Rebase disposable copies of the open #4238 head and `feat/vat-rates-b` onto the last commit before the split. Run the same script once on each, with named destinations for their added declarations. If #4238 lands first, rehearse `feat/vat-rates-b` alone. Compare against the scripted starting tree to replay the branch delta, and check the edited declarations. Name open branches that add an old-path import in the PR. Give lanes B, C, F and L the command when the split lands.
- Move `working-order.test.ts`'s titled top-level `describe` and `it` blocks with their code. Keep one suite there for the groups with grandfathered English-guard text and the two checks cited in `CLAUDE.md`. Export the live database bindings and helpers from `apps/server/src/testing/working-order.test-support.ts`. Keep Vitest file isolation so each suite gets its own `useVenueDb` instance. Compare all 301 discovered names including repeats and the original assertions. Repoint namespace spies in `order-drafts.db.test.ts` and both party-allergy suites. Run each moved suite, those spies, `till-api.sell-published.test.ts`, `till-api.fiscal-sale-paths`, `split-table.fiscal`, `transfer-lines.filing`, `served-at-fiscal-hash`, Till's `till-app-menu-refresh.test.ts`, and the unchanged fiscal `write-path.e2e.test.ts` and `inmutabilidad.test.ts`. Run Server typecheck and affected root guards, and require CI to run the full Server suite with its duration packing.

Land the shared tool first and the full split in the second PR the same day. Run the tool from the repository root with `node scripts/move-ts-declarations.mjs <map.json>`. Each map names a `tsconfig` and a `moves` array. Each entry names the `source`, a `targets` object from destination file to declaration names, and any names to `keep` in the source. Use `describe:<title>` or `it:<title>` to name test blocks. Run it on a clean branch so you can inspect the import changes separately. Typecheck the package after the move. When a generated import mixes a type and a value, TypeScript can omit the type marker. Mark the type at its specifier. If TypeScript marks a runtime value as a type, remove that marker. In the Server split, import `TicketState` directly from `kitchen-print.js` and `takesExtras` from `@waitron/menu/src/unit-extras.js`. Repoint the three test spies to `working-order-open.js` or `working-order-kitchen-fire.js` as appropriate. Expect about 9,800 product and 9,400 test lines moved, 320 old import statements across 300 Server files, about 300 tool lines plus 1,700 lines of changed imports, and up to 250 new test and fixture lines. The scope is a source move. Schema, fiscal builders, route behaviour and other server-file splits are outside it.

## Carry an open branch across the split

Use two disposable checkouts to measure what your branch changes after the move. Set `split` to the split PR's squash commit and `branch_tip` to the branch commit you want to carry forward. Start from a checkout that has both commits. Each move took several minutes in the rehearsal.

```zsh
before=$(git rev-parse "${split}^1")
scratch=$(cd "$(mktemp -d /tmp/wt-work-order.XXXXXX)" && pwd -P)
git worktree add --detach "$scratch/base" "$before"
git worktree add --detach "$scratch/branch" "$branch_tip"
git -C "$scratch/branch" merge --no-edit --signoff "$before"
git show "${split}:scripts/working-order-split.json" | jq '.moves |= .[:1]' > "$scratch/base.json"
cp "$scratch/base.json" "$scratch/branch.json"
```

If your branch adds or removes declarations beyond those named in the map, update `branch.json` to match. Leave `base.json` as it is. Run these steps once the merge into the disposable branch checkout is clean and both moves succeed.

```zsh
for side in base branch; do
  (cd "$scratch/$side" && pnpm install --frozen-lockfile &&
    node scripts/move-ts-declarations.mjs "$scratch/$side.json" &&
    git add -A && git write-tree > "$scratch/$side.tree") || break
done
```

Once both tree files exist, inspect the branch edits that still refer to the old module or its original test suite. The map names the destination of each moved test block. Transfer edits to those cases or additions by hand. Use the direct import from its defining module for any changes to the forwarding imports left in `working-order.ts`.

```zsh
base_moved=$(cat "$scratch/base.tree")
branch_moved=$(cat "$scratch/branch.tree")
git diff "$base_moved" "$branch_moved" -- \
  apps/server/src/working-order.ts apps/server/src/working-order.test.ts
git diff --binary "$base_moved" "$branch_moved" -- . \
  ':(exclude)apps/server/src/working-order.ts' \
  ':(exclude)apps/server/src/working-order.test.ts' > "$scratch/branch-edits.patch"
git worktree add --detach "$scratch/result" "$split"
git -C "$scratch/result" apply --3way "$scratch/branch-edits.patch"
git -C "$scratch/result" diff --cached --stat
```

The patch carries your branch's changes to the landed split. Committing the raw move before rebasing produces conflicts where both sides add the same files. The VAT branch's rehearsal carries changes in both `working-order-held-read.ts` and `stored-order-lines.ts`. Resolve any conflicts, add the edits you transferred by hand, install dependencies, and typecheck Server and run your branch's focused tests in `result`.

Commit the verified replay, then return to your original feature checkout with a clean working tree. This puts your replayed changes into one signed commit. Set `backup_branch` to an unused name to keep the original commit history before moving the feature branch.

```zsh
git -C "$scratch/result" commit -s -m "Carry branch changes across the working-order split"
replayed=$(git -C "$scratch/result" rev-parse HEAD)
test -z "$(git status --porcelain)" && test "$(git rev-parse HEAD)" = "$branch_tip" &&
  git branch "$backup_branch" "$branch_tip" && git reset --keep "$replayed"
```

If you had already pushed the feature branch, update it through `finish-branch` with `--force-with-lease`. Remove the three disposable worktrees when you are done.

The landed split also adds the `./errors.js` side-effect imports, retargets the two forwarded imports and removes the forwarding file left by the tool. Using the landed split as the destination picks up those edits. If you repeat the test move itself, first remove the explicit Vitest import from `working-order.test.ts`. Server's test project supplies those globals.
