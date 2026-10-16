# A668 slice 3: Products list and publishing warnings implementation plan

> **For agentic workers:** Use `superpowers:executing-plans`, task by task, inline. The owner authorizes unattended execution without a plan approval prompt. Routine work stays with the driver; no subagents. This is an implementation slice, not a plan-only queue item.

**Goal:** Show variants' effective allergen states in Products and warn, with product links, before immediate or scheduled menu publication without blocking it.

**Architecture:** Extend the existing list read with effective allergens and their inheritance flag. Build warnings from the proposed menu document's offers, then share warning rendering and confirmation between the two dashboard publishing paths. Keep the existing publication hashes and server refusal rules.

**Tech stack:** TypeScript, Drizzle/SQLite, Lit, Vitest; real databases through `useVenueDb`, browser tests in real headless Chromium.

Use existing `useCatalogueDb` (`packages/catalogue/test/fixtures.ts:193` delegates to `useVenueDb`) and the server suite's venue helper. For every behavior change below: write the assertions first, run and inspect the expected failure, implement minimally, then run the passing checks. Do not accept skipped cases or output with no test count.

**Spec:** `docs/superpowers/specs/2026-10-14-a668-allergen-info-editor-and-till-design.md`, Products list, Publishing, Words and Testing; catalogue backlog `docs/backlog/catalogue.md`, Products and Decisions and deliberate limits.

## Constraints and traced decisions

- Read `CLAUDE.md` and the relevant sections of `docs/developers/{products,testing-guide,conventions-ui,conventions-data,design-system,writing-claims,workflow-guide}.md` before implementation; read the TDD skill before writing any code or tests.
- Keep this plan on the feature branch with the implementation. No separate docs-only landing. No migrations, fiscal changes, guard changes, global-rule changes, editor or picker work; **do not edit `apps/dashboard/src/widgets/product-editor.ts`** (laneG owns it and its picker).
- Preserve `null` = unreviewed, `{}` = reviewed none, nonempty = declared. Retain the internal `pending` filter key; change its displayed English label to **Not reviewed**, keeping **None / Declared**.
- **Copy proposals, not owner-approved Spanish:** Not reviewed → “Sin revisar”; Allergens not yet reviewed: → “Alérgenos aún sin revisar:”. Tasks 2/4 may use these provisionally for a reviewable PR; request the owner's answer during implementation and require it before landing. Reuse existing None/Declared and action labels.
- `operations.ts:listedVariantsOfProducts` already joins `parentProducts`; select `effectiveProductColumns.allergens` plus the variant's raw `products.allergens`. Add `ListedVariant.effective.allergens: ProductAllergens | null` and `ListedVariant.allergensInherited: boolean`, true exactly when that raw published column is null. Do not infer inheritance from equality or `manualAllergens`.
- Preserve `republishOverlays`/`derivation.ts:republish`: recipe-derived floors and pending derivations already affect published allergens. Read the published effective value; do not recalculate declarations, union parent values in the browser, or change recipe inheritance.
- `previewMenu` uses `buildMenuDocuments` → `listMenuOffers` → `offerRowsOn`/`readOfferVariants`. Reachable active products and active variants are included even when unavailable. Included menus and repeated placements resolve into the proposed document's offers. Use those offers, including all existing `ordering` values; introduce no sellability filter.
- Warn for each offered parent with null allergens and each active offered variant with null effective allergens, independently. Deduplicate by product/variant id in document offer order, parent before variants. Extras-only products, option labels and ingredients get no separate entries; an extra also offered as a dish is checked as that dish.
- Add one nonempty warning `{ kind: "allergens_unreviewed"; products: { id: string; name: string; parentName: string | null }[] }`; omit it when empty. Names are staff names. Variant entries use their own id/name and the offer's parent name; display `staffPresentationName` as `Parent (Variant)`.
- `publishMenu` and `queueMenuPublication` rebuild documents and compare `expectedHash`; keep their clash, overtake, unchanged, time, replay and transaction behavior. Warnings remain preview metadata, outside the document/hash. No acknowledgement field or server refusal for allergens.
- Product links use `/manage/catalogue/product/${encodeURIComponent(id)}`. Ordinary activation emits existing `wt-edit-product` with `{ productId: id }`, bubbles/composed, through `dashboard-app.ts:#onEditProduct` and the shell's leave coordinator. Use `leftToBrowser` for modified clicks; keep actual anchors and text escaping.

## Review focus

1. A reviewed variant under an unreviewed parent, and the reverse, must show/filter/warn independently (Tasks 1–3).
2. Included menus, duplicate placements, sold-out dishes, archived variants and extras-only items must use the offered set above (Task 3).
3. A replaced preview, even with the same hash, must retire an outstanding confirmation; a different date/time or opening must too (Tasks 4–5).
4. Cancel, retry, double activation and late replies must preserve the schedule draft and prevent duplicate or stale writes (Tasks 4–5).
5. Warning links must reach the variant's own page, respect unsaved navigation and browser link gestures, and remain usable at phone width (Tasks 4–5).

## Task 1: Return the effective variant declaration

**Files:** Modify `packages/catalogue/src/{product-types,operations}.ts`; test `packages/catalogue/src/variants.test.ts` and `apps/server/src/catalogue-api.test.ts`.
**Interface:** `listProducts(tx: Transaction, catalogueId?: string): Promise<Product[]>` retains its signature and adds the two required `ListedVariant` fields above; `ProductVariant`/editor inputs stay unchanged.

- [ ] Add failing `variants.test.ts` cases named `lists effective allergens and their inheritance`: parent milk, inherited variant, own eggs, explicit `{}`, and both null; include archived variants and refresh after parent edits. Assert exact maps/flags; keep price/VAT/category assertions. Extend the management response assertion in `apps/server/src/catalogue-api.test.ts:2682` with exact new fields, retaining every existing nested effective field.
- [ ] Run `pnpm --filter @waitron/catalogue exec vitest run src/variants.test.ts` and `pnpm --filter @waitron/server exec vitest run src/catalogue-api.test.ts`; observe failures on the missing allergen fields.
- [ ] Select/decode effective allergens using the existing joined expression, calculate the flag from raw null, and extend only the list type/read. No per-variant query.
- [ ] Re-run both commands; require passing test counts.
- [ ] Update required list fixtures, without changing their existing behavior, in `apps/dashboard/src/widgets/{product-list.test,product-list.a11y.test,catalogue-browser.test,extra-list-form.test,extra-list-form.a11y.test,menu-prices-table.test}.ts` and `apps/dashboard/src/screens/{catalogue-screen.test,catalogue-screen.a11y.test,menus-screen.test}.ts`. Audit each `effective: {` literal before adding fields; unrelated fallback assertions stay intact. Commit explicitly named changed files with `git commit -s`.

## Task 2: Show and filter the same effective state

**Files:** Modify `apps/dashboard/src/widgets/product-list.ts`, `apps/dashboard/src/i18n/domain.ts`; test `apps/dashboard/src/widgets/{product-list.test,product-list.a11y.test}.ts` and `apps/dashboard/src/i18n/domain.test.ts`.
**Interface:** Keep `AllergenState = "pending" | "none" | "declared"` and `allergenState`/`allergenStateName` signatures; cell, sort and filter consume Task 1's effective declaration.

- [ ] Add failing `product-list.test.ts` cases `shows inherited allergen badges in italic` and `filters variants by effective allergen state`: all three inherited states, own `{}` and own eggs under a milk parent, own reviewed variant under null parent, archived toggle, and retained `pending` filter selection. Assert `getComputedStyle(badge).fontStyle` in the table's shadow root; inherited is italic, own is normal. Assert Not reviewed/None/Declared and matching row keys, allowing tree ancestors as context. Add explicit English/provisional Spanish wording assertions in `domain.test.ts` and inherited/own axe states in `product-list.a11y.test.ts`.
- [ ] Run `pnpm --filter @waitron/dashboard exec vitest run src/widgets/product-list.test.ts src/i18n/domain.test.ts`; observe blank variant cells/wrong effective filtering and old English wording.
- [ ] Use `variant.effective.allergens` or `product.allergens` consistently in cell/sort/filter. Add an inherited badge part styled through `wt-data-table::part(...)`; preserve badge tokens and existing tree/archive behavior. Change only `ALLERGEN_STATE_NAMES.pending`, not generic status names.
- [ ] Run `pnpm --filter @waitron/dashboard exec vitest run src/widgets/product-list.test.ts src/widgets/product-list.a11y.test.ts src/i18n/domain.test.ts`; require passing counts in both axe themes. Commit this task with `git commit -s`.

## Task 3: Produce advisory warnings from the proposed offers

**Files:** Modify `packages/catalogue/src/{menu-document-types,menu-publication}.ts`; test `packages/catalogue/src/{menu-publication,menu-schedule}.test.ts`, `apps/server/src/catalogue-api.test.ts`, `apps/server/src/catalogue-api.menu-schedule.test.ts`.
**Interface:** `previewMenu(tx: Transaction, menuId: string): Promise<MenuPreview>` gains the discriminated warning defined above; immediate/queue request bodies and return types stay unchanged.

- [ ] Add failing `menu-publication.test.ts` cases `warns once for offered unreviewed products and effective variants`: null parent plus inherited-null variant; reviewed variant omitted; reviewed parent/inherited variant omitted; own `{}` omitted; recipe-pending parent warned; complete recipe-derived declaration not warned. Give staff/customer/kitchen names and dish/variant/extra allergen maps different values; assert the entire warning list, ids and parent names.
- [ ] Include active sold-out products/variants, every ordering value, included/repeated placements, and exclude archived/unplaced products/variants and extras-only products. Assert coexistence with both existing warning kinds and deterministic deduplication.
- [ ] Add real-DB publish/queue cases asserting writes succeed despite warnings; change allergens after preview and assert `menu.changed_since_preview` and no added version/publication rows on both paths. Retain clash, overtake, unchanged, replay and activation-time refusal assertions.
- [ ] Add API assertions for warning serialization and successful immediate HTTP 200/scheduled HTTP 201 without an acknowledgement field. Intentionally replace `catalogue-api.test.ts:4470,4496` empty-warning expectations for its unreviewed fixture with exact warnings; preserve the surrounding status/document assertions. Reviewed `menusFixture` declares `{}` (`test/menus-fixture.ts:74`), so its no-warning/shortcut-only checks remain meaningful; do not weaken them or silently mark unreviewed fixtures reviewed.
- [ ] Run `pnpm --filter @waitron/catalogue exec vitest run src/menu-publication.test.ts src/menu-schedule.test.ts` and `pnpm --filter @waitron/server exec vitest run src/catalogue-api.test.ts src/catalogue-api.menu-schedule.test.ts`; observe missing-warning assertions fail, while existing publish/queue checks stay intact.
- [ ] Append the new warning from `mine.document.offers` beside shortcut/portion warnings, without more database reads or changes to the frozen document, hash algorithm or publication functions.
- [ ] Run `pnpm --filter @waitron/catalogue exec vitest run src/menu-publication.test.ts src/menu-schedule.test.ts src/menu-home.test.ts` and `pnpm --filter @waitron/server exec vitest run src/catalogue-api.test.ts src/catalogue-api.menu-schedule.test.ts`; require passing counts. Commit with `git commit -s`.

## Task 4: Share linked warnings and immediate confirmation

**Files:** Create `apps/dashboard/src/widgets/menu-publish-warnings.ts`; modify `apps/dashboard/src/widgets/menu-preview.ts` and `apps/dashboard/src/i18n/strings.ts`; test existing `apps/dashboard/src/widgets/{menu-preview.test,menu-preview-navigation.test,menu-preview.a11y.test}.ts`.
**Interfaces:** Export `renderMenuWarnings(warnings: MenuPreview["warnings"], menuName: string): TemplateResult` and `renderPublishWarningConfirmation(options: PublishWarningConfirmation): TemplateResult`; options carry `preview: MenuPreview`, `menuName: string`, `actionLabel: string`, `busy: boolean`, `confirm: () => void`, `cancel: () => void`. Render the confirmation only while its host owns a valid captured preview.

- [ ] Add failing browser cases `links unreviewed products in warnings and confirmation` and `retires confirmation when preview changes`: exact product/variant hrefs and staff labels, mixed shortcut/portion/allergen warnings, cancel/Escape sending nothing, one confirmed `{ hash }` event, repeat press held during publishing, replacement/null/failed preview requiring a fresh confirmation, and retry after refusal. Preserve existing published-result warnings using the submitted warning snapshot.
- [ ] Add ordinary/keyboard navigation and Ctrl/Meta/Shift/middle-click cases, with the variant id in its link/event; extend axe states for linked warnings and confirmation in both themes. Assert the exact English/provisional Spanish warning heading.
- [ ] Run `pnpm --filter @waitron/dashboard exec vitest run src/widgets/menu-preview.test.ts src/widgets/menu-preview-navigation.test.ts`; observe missing linked warning rendering/confirmation behavior.
- [ ] Share explicit rendering by warning kind; replace `#warningWords`' catch-all shortcut count so the new warning cannot inflate it. Reuse the shared linked content in the warnings section, confirmation and successful-result summary. Use the existing `wt-dialog`/footer controls and token styles, not a new shared primitive.
- [ ] Bind confirmation to preview identity, menu and hash; retain failure/publishing/clash checks and clear it on replacement, dismissal or disconnect. Confirmed allergens never disable Publish. Implement product navigation through the existing event and `leftToBrowser` contracts.
- [ ] Run `pnpm --filter @waitron/dashboard exec vitest run src/widgets/menu-preview.test.ts src/widgets/menu-preview-navigation.test.ts src/widgets/menu-preview.a11y.test.ts`; require passing counts and axe coverage of linked warnings/confirmation in both themes. Commit with `git commit -s`.

## Task 5: Confirm warnings before queuing a new edition

**Files:** Modify `apps/dashboard/src/widgets/menu-publications.ts` and `apps/dashboard/src/screens/menus-screen.ts`; test `apps/dashboard/src/widgets/{menu-publications.test,menu-publications.unsaved.test,menu-publications.save-state.test,menu-publications.a11y.test}.ts`, `apps/dashboard/src/screens/menus-screen.test.ts`, `apps/dashboard/src/dashboard-app.unsaved-changes.test.ts`.
**Interface:** Keep `DashboardApi.scheduleMenuPublication(menuId, { expectedHash, activatesAt })`; use Task 4's confirmation with the existing schedule action label. On `menu.changed_since_preview`, emit `wt-preview-retry` for the existing menus-screen listener to refresh passively.

- [ ] Add failing `menu-publications.test.ts` case `confirms preview warnings before queueing`: valid time plus warnings makes zero API calls until confirmation, then exactly one with the captured hash/time. Test all warning kinds, links, warning-free direct scheduling, and moving an existing frozen edition without draft warnings. Assert cancel/Escape retains date/time and protected draft; Enter/double activation cannot bypass confirmation.
- [ ] Add deferred-response cases for null/replaced preview (including same hash), changed time/occurrence, close/reopen, menu switch, retry after network refusal, DST repeated/skipped time, and overtake refusal. A stale-hash response keeps the draft, requests a fresh preview, sends no automatic retry, and requires fresh confirmation; an old response/finally cannot clear a newer opening's busy/error state. Success commits/closes before refresh; failed refresh reports a read failure and offers no duplicate submission.
- [ ] Add `dashboard-app.unsaved-changes.test.ts` cases activating warning links while the schedule draft is dirty: Keep editing stays on the schedule with values intact; Discard navigates to the exact product/variant URL without queueing. Use `userEvent.click`, spy on `pushState`/`replaceState`, and await `wt-close` for dialog effects; restore locale after cases. Add screen coverage that stale queue refreshes preview without replacing the time draft.
- [ ] Run `pnpm --filter @waitron/dashboard exec vitest run src/widgets/menu-publications.test.ts src/screens/menus-screen.test.ts src/dashboard-app.unsaved-changes.test.ts`; observe the premature queue call and missing stale-refresh/navigation behavior.
- [ ] After existing local validation and unchanged checks, capture menu id, preview identity/hash, `#opening`, and detached schedule draft; show the shared confirmation before a new queue call. Confirm revalidates these plus clashes/busy/current scheduling eligibility. Invalidate consent on preview/draft/menu/opening change or close; keep the date form's action and Enter suspended while confirmation is open. Reschedule and cancel-edition paths retain their existing behavior.
- [ ] Run `pnpm --filter @waitron/dashboard exec vitest run src/widgets/menu-publications.test.ts src/widgets/menu-publications.unsaved.test.ts src/widgets/menu-publications.save-state.test.ts src/widgets/menu-publications.a11y.test.ts src/screens/menus-screen.test.ts src/dashboard-app.unsaved-changes.test.ts`; require passing counts. Commit with `git commit -s`.

## Task 6: Copy, visual checks and branch completion

- [ ] Record the owner's Spanish answer, if received; update wording assertions first, run the Task 2/4 commands to see the old copy fail, then change the strings and re-run. Otherwise identify the two provisional translations in the PR and park before landing.
- [ ] Update only slice 3's completed scope in `docs/backlog.md` and the Pending wording/Products-list detail in `docs/backlog/catalogue.md`; leave editor, picker, icons and till work assigned to their own slices. Preserve historical decisions with a dated pointer, rather than rewriting their earlier account.
- [ ] Run `pnpm --filter @waitron/catalogue typecheck` and `pnpm --filter @waitron/dashboard typecheck`; fix required consumer fixtures without weakening existing assertions. Re-run the task commands affected by any correction. No whole-workspace local test run solely for finishing.
- [ ] Start previews only with `wa-wt demo waitron-feat-a668-3-products-publish-allergens`. Inspect Products, warning list and both confirmations in light/dark at desktop and 390px; check italic inherited badges, wrapping long staff names, focus, keyboard links and enabled warning confirmations. Stop only processes you started.
- [ ] Review the branch diff for intentional changed checks: English Pending wording, formerly blank variant cells, variant filter/sort behavior, required list fields, unreviewed API warning arrays, and scheduled warning submissions now needing confirmation. Preserve every unrelated assertion; no guard/global-rule edits and no editor/picker edits.
- [ ] Announce readiness and run `finish-branch`: one Claude whole-branch run-it review after the initial rebase in its throwaway checkout, triage/fix findings inline, signed-off commits, normal push hook, reviewable PR and required CI/coverage passing on the current head. Do not repeat the whole review solely for a later rebase.
- [ ] Land only with the owner's Spanish answer recorded and the H11 landing lock held, following the authorized landing workflow. If the answer is absent, park the reviewable PR and report that single landing dependency. The plan travels with this implementation branch.
