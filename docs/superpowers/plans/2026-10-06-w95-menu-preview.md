# W95 Menu Preview Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` for native inline execution, as Lane D selected. No automatic per-task subagents. Read `superpowers:test-driven-development` before writing implementation or tests. The separately invoked writer only writes these documents; the parent reviews them and owns implementation and workflow.

**Goal:** Inspect the proposed format-3 menu and follow every unpublished change to its exact before/after occurrence and field.

**Architecture:** Keep `MenuDocument` and its hash input unchanged. Extend the preview envelope with the live document and stable navigation metadata. A pure catalogue contract and isolated Lit renderer supply customer content; the dashboard host supplies locale, media URLs, inspection state and publication controls.

**Tech Stack:** Existing TypeScript, Lit, shared UI primitives, Vitest browser mode with Chromium, axe, catalogue `useVenueDb` suites and server route tests. No new dependency or workspace package.

**Spec:** [W95 design](../specs/2026-10-06-w95-menu-preview-design.md).

## Global constraints

- One implementation PR; no migration. Accept only document format 3.
- Keep `MenuDocument` and its hash input unchanged. Keep route URLs and publish body `{ expectedHash }`.
- No fiscal invariant, fiscal test, root guard assertion, permission or ordering policy changes.
- Preserve behaviour assertions. Spec-directed presentation/shape changes get equally strict replacements and a PR **Changed test checks** list plus campaign FYI written by the parent.
- Native inline implementation. A290 read-count optimisation and A299 dead-widget deletion remain separate work.
- Reuse `--wt-*` chrome tokens and existing field primitives; semantic name `menu-preview-view`. Spanish restaurant-menu copy uses **carta**. Clash wording is **Price override / Precio propio**, reusing `menu_prices.override_column` (`strings.ts:2022`, `:4267`).
- Default to the configured default customer language. Interface EN/ES and content language are independent.
- No draft fetches to fill missing root title translations, section descriptions, variant descriptions or availability. Mark frozen/internal-title fallback explicitly.
- No online-menu site or pixel-parity claim. The renderer takes all app-specific services as arguments.
- Coverage remains `98/98/98/95`; focused checks during implementation, normal hook once on push, required package coverage in current-head CI. No extra whole-workspace local run.

## Review focus

These less obvious cases are assigned below, alongside the queue's explicit checks:

1. A repeated included root contains a repeated nested section: all descendants remain independently navigable (T1/T4).
2. The same extra product appears on two lists and two parent dishes, or is deleted while also a standalone dish: address each real occurrence without guessing a standalone offer (T1/T4).
3. Empty/whitespace maps, disabled languages and distinct staff/customer/kitchen names must not disguise a fallback as a translation (T2/T4).
4. A local inspection survives a slow query response or menu switch: the old snapshot cannot change the new menu, and selections never change publication data (T5).
5. An image fails, a title is one long word, or a removed group is empty: the target remains named, visible and focusable at 390px (T3/T6).

## File ownership and interfaces

| Owner | Files and responsibility                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T1    | `packages/catalogue/src/menu-document-types.ts`, new `menu-navigation.ts`, new `menu-navigation.test.ts`: public preview/navigation shapes and pure occurrence/field identity. `menu-document.ts`, `menu-publication.ts` and existing tests: diff traversal, before envelope, final enrichment.                                                                                                                                                                                                        |
| T2    | New `packages/catalogue/src/customer-menu-presentation.ts` and `.test.ts`: browser-safe text/provenance and frozen price presentation.                                                                                                                                                                                                                                                                                                                                                                 |
| T3    | New `apps/dashboard/src/widgets/customer-menu-renderer.ts`, `customer-menu.ts`, `customer-menu.test.ts`, `customer-menu.a11y.test.ts`: reusable templates and dashboard interaction adapter.                                                                                                                                                                                                                                                                                                           |
| T4    | `apps/dashboard/src/widgets/menu-preview.ts`, `.test.ts`, `.a11y.test.ts`, `apps/dashboard/src/i18n/strings.ts`: panes, publication strip, change controls, before/Home views, labels.                                                                                                                                                                                                                                                                                                                 |
| T5    | `apps/dashboard/src/api/client.ts`, `screens/menus-screen.ts`, `screens/menus-screen.test.ts`; `apps/server/src/catalogue-api.test.ts`: type exports, snapshot/freshness integration and route contract. Fixture-only additions where needed in `api/live-queries.test.ts`, `api/client-routes.test.ts`, `screens/menus-screen.heading.test.ts`, `screens/menus-screen.a11y.test.ts` and existing Preview widget fixtures; their behaviour assertions remain. Production server routes need no change. |
| T6    | Widget and screen a11y/tests, `docs/developers/design-system.md`, `docs/backlog.md`: rendered evidence and final documentation.                                                                                                                                                                                                                                                                                                                                                                        |

Interfaces from the spec are authoritative:

```ts
type MenuView = { kind: "internal" } | { kind: "customer"; language: string };
type MenuText = { text: string; origin: "requested" | "default" | "staff" | "missing";
  language: string | null; missingRequested: boolean };
// MenuField, MenuTarget, MenuChangeBody and enriched MenuChange: spec Contract section.
indexMenuOccurrences(document: MenuDocument): MenuOccurrence[];
menuTargetKey(target: MenuTarget): string;
navigateMenuChanges(live: MenuDocument | null, proposed: MenuDocument,
  changes: readonly MenuChangeBody[]): MenuChange[];
resolveMenuText(map: Readonly<Record<string, string>> | null, staffName: string | null,
  view: MenuView, config: ContentLanguages): MenuText;
menuPriceRange(offer: FrozenOffer): { min: string; max: string };
```

Export `MenuView`, `MenuText` and text/range functions from `customer-menu-presentation.ts`;
export navigation types from the existing document type leaf and functions from `menu-navigation.ts`.
`menuPriceRange` uses variant effective `unitPrice`s if variants exist, otherwise the dish's.
It compares Decimal values, not strings or JavaScript floating point. `MenuOccurrence` and
`MenuPreview.live` are defined exactly in the spec. Import pure modules/types by browser-safe
deep paths; do not import catalogue's server barrel into dashboard code.

The isolated renderer exports `renderCustomerMenu(input): TemplateResult` and
`customerMenuStyles: CSSResult`. Its input is:

```ts
interface CustomerMenuRenderInput {
  document: MenuDocument;
  view: MenuView;
  languages: ContentLanguages;
  expanded: ReadonlySet<string>; // menuTargetKey of section summary targets
  detail: MenuTarget | null;
  selectedVariantId: string | null;
  picks: ReadonlyMap<string, number>; // JSON tuple [listId, extraProductId]
  options: ReadonlyMap<string, string>; // listId -> optionLabelId
  highlighted: readonly MenuTarget[];
  label: (key: string, values?: Readonly<Record<string, string>>) => string;
  mediaUrl: (filename: string) => string;
  onExpand: (target: MenuTarget) => void;
  onDetail: (target: MenuTarget | null) => void;
  onVariant: (id: string | null) => void;
  onPick: (listId: string, productId: string, quantity: number) => void;
  onOption: (listId: string, labelId: string) => void;
}
```

`label` is supplied by a dashboard adapter mapping the renderer's literal label keys to
typed `StringKey`s; never pass an unchecked arbitrary server string to `t`. The renderer
owns no global controller, API, router or persistent state. Its stylesheet travels with
the templates. `dashboard-customer-menu` exports class `CustomerMenu` with properties
`document`, `view`, `languages`, `highlighted`, `label`, `mediaUrl` and async
`reveal(target: MenuTarget): Promise<boolean>`. It owns expansion/local selections and
calls the renderer. Reveal returns false only for an unresolved target and leaves a named
inline explanation. Reveal expands ID-addressed ancestors, opens the parent detail,
selects an addressed variant and focuses the addressed list/item/label field after rendering.
Title/list/Home targets are handled by the panel where appropriate. Parent sets inspection
state explicitly when changing snapshots.

## T1: give every change a real before/after address

Source receipts: `menu-document-types.ts:142`, `menu-document.ts:594`, `:789`,
`menu-publication.ts:259`, `:287`, `:393`. Existing consumers include
`diffMenuDocuments` (`menu-document.ts:1079`), `sameEdit` (`menu-publication.ts:253`),
dashboard client/widget/screen and catalogue/server tests. Trace these again on execution head.

- [x] Add failing cases in `menu-navigation.test.ts` using format-3 documents built with
      distinguishable IDs/text and repeated section paths. Enumerate **all 16 current kinds**
      in the spec table with exact targets, plus every `ProductChangeField` and
      `SectionChangeField`. Include extra-only removal, two parent dishes/two lists, changed
      variant/label ID, missing-language name/description, changed Home subfields and root order.
      Example meaningful assertions after arranging an extra removal:

  ```ts
  expect(change.targets.before).toEqual([
    {
      kind: "product",
      sectionIds: ["drinks"],
      menuItemId: "mi-lemonade",
      productId: "lemonade",
      listId: "citrus",
      extraProductId: "lemon",
      field: { kind: "summary" },
    },
    {
      kind: "product",
      sectionIds: ["favourites", "drinks"],
      menuItemId: "mi-lemonade",
      productId: "lemonade",
      listId: "citrus",
      extraProductId: "lemon",
      field: { kind: "summary" },
    },
  ]);
  expect(change.targets.after).toEqual([]);
  expect(new Set(changes.map((c) => c.id)).size).toBe(changes.length);
  ```

- [x] Run `pnpm --filter @waitron/catalogue exec vitest run src/menu-navigation.test.ts`.
      Expected red: navigation export absent initially; after wiring, exact target assertion
      catches collapsed duplicate descendants/wrong list/extra identity. Watch both stages,
      not just an import error. Rename and reorder fixtures; assert row and target IDs stay
      identical while explanatory names change. Assert every target resolves in its own side.
      Use two sections with identical displayed names but different IDs, and two separate
      section removal rows under identical-name parents; assert their IDs/targets differ.
- [x] Before changing publication code, add expected-red envelope assertions to
      `menu-publication.test.ts`: first preview has null live; after publish/edit,
      `live.versionId` names the old publication and `live.document` has the old price/image
      even after their working rows change. Run
      `pnpm --filter @waitron/catalogue exec vitest run src/menu-publication.test.ts -t 'live snapshot'`
      using that phrase in the new cases. Expected red: `live` is undefined, not null/old snapshot.
      Assert `menuDocumentHash(preview.document) === preview.hash` and no input mutation.
- [x] Define spec types and pure index/enrichment. In `shapeOf`, keep one facts node per
      section ID but descend every occurrence with a current-path cycle check, recording every
      parent path. Keep diff kind/source/order semantics. `DiffEntry.change` uses
      `MenuChangeBody`, with required `parentSectionIds` on section add/remove and
      `listSectionId` on order changes captured directly in their emission loops. Do not
      infer them from translated/display names. Update all construction fixtures explicitly.
      `diffMenuDocuments` enriches its returned body list. `previewMenu`
      enriches **after** extra deletion/refinement/`alsoOn`, then returns
      `live: own ? { versionId: own.versionId, document: own.document! } : null`.
      Derive navigation from actual tree occurrences. Raw graph paths include the menu root,
      but exposed and frozen offer placements already omit it (`operations.ts:488`): root
      placement is `[]`. Do not strip another section ID from a frozen placement.
- [x] Retain extra-only deletion and `alsoOn` assertions. Add raw-override navigation
      controls before their implementation: changing `grossPrice` from null to the same
      effective price, or changing `menuPrice` while the variant effective price stays equal,
      must target `field: { kind: "override" }` on the exact dish/variant. Expected red:
      a price target shows two equal amounts and never reveals the changed override.
- [x] Run red then green with
      `pnpm --filter @waitron/catalogue exec vitest run src/menu-navigation.test.ts src/menu-document.test.ts src/menu-publication.test.ts`.
      Full-shape change assertions gain exact ID/targets without dropping existing values.
      Log these additions for the parent FYI. Commit signed off after the task's checks.

## T2: resolve customer text with visible provenance

Source receipts: `product-presentation.ts:52`, `:77`,
`packages/shared/src/content-languages.ts:90`, `:114`; prices are already resolved in
`menu-types.ts:31`, `:64`, `:189`. Produces the text/range functions above.

- [ ] Write failing pure tests for requested/default/staff/missing origins. Use
      staff `Counter burger`, customer EN `House burger`, ES `Hamburguesa de la casa`, kitchen
      `BURGER HOT`; give variants and modifiers distinct names too. Test `{ es: " " }`, `{}`,
      null, partially translated maps, region tags, disabled language, no translated
      description, and a wholly untranslated variant. Example:

  ```ts
  expect(
    resolveMenuText(
      { en: "House burger" },
      "Counter burger",
      { kind: "customer", language: "es" },
      { defaultLanguage: "en", languages: ["en", "es"] },
    ),
  ).toEqual({ text: "House burger", origin: "default", language: "en", missingRequested: true });
  expect(resolveMenuText(null, "Wine 175", { kind: "customer", language: "es" }, config)).toEqual({
    text: "Wine 175",
    origin: "staff",
    language: null,
    missingRequested: true,
  });
  expect(
    resolveMenuText(
      { de: "Burger DE" },
      "Counter burger",
      { kind: "customer", language: "es" },
      config,
    ),
  ).toEqual({
    text: "Counter burger",
    origin: "staff",
    language: null,
    missingRequested: true,
  });
  expect(
    resolveMenuText({ de: "Beschreibung" }, null, { kind: "customer", language: "es" }, config),
  ).toEqual({
    text: "",
    origin: "missing",
    language: null,
    missingRequested: true,
  });
  expect(menuPriceRange(offerWithVariantPrices("10.00", "2.00", "0.00"))).toEqual({
    min: "0.00",
    max: "10.00",
  });
  ```

  `config` in this example is `{ defaultLanguage: "en", languages: ["en", "es"] }`.
  Define the offer helper in this suite; no unasserted shared fixture.

- [ ] Run `pnpm --filter @waitron/catalogue exec vitest run src/customer-menu-presentation.test.ts`.
      Expected red: missing functions, then wrong provenance or lexicographic price bound.
- [ ] Reuse shared requested/default resolution, then add labelled own-staff fallback in
      this new resolver for names only, including a nonblank map stored solely in another
      language. This is a renderer-specific policy, not behaviour supplied by the shared
      resolver; leave existing shared, till and receipt resolution unchanged.
      Internal names with a
      staff name return own staff name/origin staff. A null staff name means description
      or translated unit text and forbids staff fallback; in Internal mode resolve that
      text in the configured default language. Add exact Internal-description/unit tests.
      `missingRequested` is false for an Internal staff name, true for customer text lacking the
      requested translation, including staff fallback. Price range performs no inheritance,
      recomputation of VAT or extras arithmetic.
- [ ] Rerun the focused suite plus
      `pnpm --filter @waitron/catalogue exec vitest run src/product-presentation.test.ts src/customer-menu-presentation.test.ts`.
      Existing receipt/kitchen assertions stay unchanged. Commit signed off.

## T3: render hierarchy and an interactive inspection

Consumes T1 occurrence targets and T2 text/range; produces renderer/host contract above.
Source receipts: frozen values `menu-document.ts:314`, images
`device-home-preview.ts:32`, fill `device-home.ts:68`, declarations `menu-types.ts:46`,
limits `extra-contract.ts:238`, option shape `modifier-list-types.ts:13`.

- [ ] In `customer-menu.test.ts`, mount the host with injected labels/media and a frozen
      format-3 document. Write red tests for nested/repeated/empty sections, image URLs,
      EN/ES names/descriptions, individual variant prices/range, units, allergens and dietary
      unknowns, modifier order/limits/preselection/defaults. Use conspicuously different
      effective price and override (`unitPrice: "3.50", menuPrice: null`) and different
      working-row data in later screen tests. Assert rendered value and native selection:

  ```ts
  expect(price.textContent).toContain("3.50"); // locale adapter supplies formatting
  expect(image.getAttribute("src")).toBe("/media/lemon%20slice.jpg");
  expect(fallback.textContent).toContain("Missing Spanish");
  expect(fallback.querySelector("[lang=en]")!.textContent).toBe("House burger");
  expect(nativeOption.checked).toBe(true);
  expect(document).toEqual(beforeInteraction);
  ```

  Use actual rendered nodes inside the host/shadow roots, not host properties alone.
  Assert variant customer fallback is its own name, not parent name. Wholly absent
  descriptions disappear unless explicitly targeted; no staff/kitchen/VAT text appears
  as customer content. Root title has the labelled internal-title fallback.

- [ ] Run `pnpm --filter @waitron/dashboard exec vitest run src/widgets/customer-menu.test.ts`.
      Expected red: element/rendered hierarchy absent, then correct-node values/controls absent.
- [ ] Implement the isolated renderer and host using shared primitives. Details are inline,
      read-only inspection: local variant, option and extra-count controls; no Save/Add to order
      or totals. Enforce summed counts against `maxPicks` and `maxQuantity`, show unmet
      `minPicks`; a stored cap 0, null cap and conflicting preselection remain explained and
      inspectable. Render frozen portions verbatim, and option choices without surcharge.
      Label all controls via injected interface copy. Use frozen fields only.
- [ ] Add red cases for two extras lists using the same product with different prices/caps,
      a variant image versus a parent image, failed/missing image, ordering inspection,
      null allergens versus reviewed empty allergens and pending diet. Assert the second
      list's control changes only its own native value. Assert failed image keeps name and
      focusable detail; assert null does not display a positive absence/suitability claim.
      Attach image errors as local render state, not mutations to the document.
- [ ] Add token-painting and `customer-menu.a11y.test.ts` cases for closed/expanded hierarchy,
      detail, missing translations, image failure and unmet limits in both themes. Rerun
      `pnpm --filter @waitron/dashboard exec vitest run src/widgets/customer-menu.test.ts src/widgets/customer-menu.a11y.test.ts`.
      Commit signed off.

## T4: build two panes and make every change navigable

Consumes `MenuPreview.live`, enriched changes and `CustomerMenu.reveal`. Production owner
is `menu-preview.ts`; keep `statusWords`, `publishFailure`, warning/hash confirmation and
publish events. Do not delete `documentTree`, old structure widget/editing paths or their
own checks in W95; A299 owns that cleanup.

- [ ] Add red tests to `menu-preview.test.ts` for desktop grid/mobile stacking and all spec
      target-table kinds. Arrange before and after documents where subjects genuinely exist.
      Test pointer, native Enter and Space activation, collapsed ancestor expansion, exact
      deep active element, destination rectangle inside its scroll region, changed-value
      marker and return-to-row. Dispatch real keyboard events on the rendered button (or
      browser keyboard), not a direct handler call. Example assertion pair:

  ```ts
  expect(destination.getAttribute("data-change-target")).toBe(menuTargetKey(expectedTarget));
  expect(destination.getRootNode().activeElement).toBe(destination);
  expect(destination.getBoundingClientRect().top).toBeGreaterThanOrEqual(paneTop);
  expect(destination.getBoundingClientRect().bottom).toBeLessThanOrEqual(paneBottom);
  expect(publishEvents).toEqual([{ hash: proposedHash }]);
  ```

  For nested shadow roots use their actual `ShadowRoot.activeElement`; headings carry
  `tabindex=-1`. Also check expansion/native details state, not merely a spy on scroll.

- [ ] Run `pnpm --filter @waitron/dashboard exec vitest run src/widgets/menu-preview.test.ts`.
      Expected red: rows are plain `li`s, no target focus, before snapshot or panes. Extend
      fixtures with identity/live data before adapting existing presentation assertions.
- [ ] Implement publication strip and panes. Use a native button per change plus separately
      named field/occurrence controls; no nested buttons. Source/included menu/affected menu
      copy stays visible. Resolve by target keys and IDs, await render, reveal/focus/scroll.
      Initial target selects changed customer language or explicitly staff inspection as
      specified. Highlights include text/outline. Preserve default customer view; choosing
      staff-only targets switches to Internal names, visibly.
- [ ] Add red before-view tests: removed product, removed empty section, deleted extra-only
      product, removed variant/label/list. Assert old text/image/price comes from `live.document`,
      removal label/version/date is present, proposed stays retrievable, and Publish still
      emits proposed hash. Moved product exposes all old/new paths; section removal/addition
      cross-links same ID's other side. Repeated included subtrees and two-list extras focus
      the chosen occurrence, not the first name match. Grouped multi-field changes provide
      each actual field target. Targeted absent values have a named empty-state node.
- [ ] Home/title tests start red for dead targets. Render frozen title as title target and
      `dashboard-device-home-preview` from the chosen side for Home. Focus labelled device/
      changed-setting summary. Provide existing Home-tab address link, without switching the
      hashed document to `menuHome` drafts. Home display targets expose only changed subfields.
      Retain default Home device behaviour elsewhere.
- [ ] Add EN/ES strings. Check the current Price overrides strings using
      `rg -n 'menu_prices.*(override|price)|menus.tab_prices' apps/dashboard/src/i18n/strings.ts`;
      reuse the current override field wording in clashes. Assert `Price override` /
      `Precio propio` and absence of the retired `Menu price` label. Use `wt-combobox`
      (or existing single-choice primitive) for the view selector, with semantic name.
- [ ] Run red/green focused widget tests and all existing a11y states with
      `pnpm --filter @waitron/dashboard exec vitest run src/widgets/menu-preview.test.ts src/widgets/menu-preview.a11y.test.ts`.
      Translate old staff-tree checks into customer/default/Internal assertions retaining
      whole-menu order, frozen-source and no-edit guarantees. Log old/new checks. Commit signed off.

## T5: keep the displayed snapshot and publish hash together

Source receipts: screen `:980`, `:1210`, `:2144`; routes `catalogue-api.ts:930`, `:938`;
route assertions `catalogue-api.test.ts:4519`, `:4555`; existing screen stale/concurrent
checks `menus-screen.test.ts:5194`, `:5264`, `:5275`, `:5395`, `:5457`.

- [ ] Re-export T1/T2 types in `api/client.ts` as needed; do not alter HTTP URLs/body.
      Add red route checks that Preview supplies the exact previous live version/document
      and resolvable stable targets. Full-envelope assertion at `catalogue-api.test.ts:4519`
      gains `live`; retain every existing status, changes, document and hash assertion.
      Add a second-preview request after a real included/shared edit, asserting old expected
      hash receives exact 409 domain body and writes no version/pointer/image-reference row.
- [ ] Run `pnpm --filter @waitron/server exec vitest run src/catalogue-api.test.ts -t 'preview|publish|format-2'`.
      Expected red: new envelope keys/targets absent before T1, or the new concurrency setup
      exposes a mismatch. If T1 already makes the route assertion green, retain it as a
      contract regression and reproduce the UI missing behaviour with the next tests; do
      not fabricate a failing server bug. Existing hash/format refusals remain unchanged.
- [ ] Add screen red tests for content view selection independent of interface locale;
      navigating, switching languages/before/Home and changing local choices cause zero
      extra preview calls and zero writes. Publish from Before sends proposed hash. Simulate
      a live update while detail/confirmation is open and then an out-of-order previous-menu
      response. Assert complete-envelope replacement, cleared local choices/confirmation,
      no foreign-menu text, and no focus theft. Selected row is kept only if its ID resolves.
- [ ] Implement state reset keyed to menu ID and preview snapshot/hash replacement. Attach
      content/locale controllers in the host; use the shared query watch, passive reads and
      existing dependencies. Do not turn navigation into another API loader. Keep preview/
      action failure provenance separate. On hash refusal, reread and hide old publish while
      loading; on publish success followed by failed read, keep success plus load failure.
- [ ] Assert the preview document is byte-for-byte unchanged after interactions, local
      settings are never sent, one outstanding publish emits one request, stale retry uses
      refreshed hash, unsupported format says reset and never renders a fake empty menu.
      Keep existing post-save refresh, `alsoOn`, warning confirmation and independent-menu
      publication tests. Leave fiscal/guard checks unedited.
- [ ] Run
      `pnpm --filter @waitron/dashboard exec vitest run src/screens/menus-screen.test.ts -t 'publishing|preview|Preview|Home page tab'`
      and the server command above. Run any newly added screen case not matched by that name
      filter explicitly. Also run
      `pnpm --filter @waitron/catalogue exec vitest run src/menu-publication.live.test.ts`.
      Commit signed off. Record honest Tests counts; these filters do not establish package coverage.

## T6: inspect the rendered menu and finish the documentation

- [ ] Add failing layout assertions to widget/screen suites for every combination of
      interface EN/ES, light/dark, widths **390 and 1280** with default and alternative
      customer language plus Internal mode. Set actual iframe with `page.viewport(width, 844)`;
      assert `window.innerWidth === width`. At 1280 assert preview and changes are side by
      side; at 390 assert changes below preview and no horizontal page overflow, including
      one-word title, long paths, missing translations and a removed empty section.
      Assert publication strip/action and return-to-change control remain reachable without
      moving the preview out of its pane. Expected red is incorrect rectangles/overflow,
      not an expected screenshot file missing.
- [ ] Extend `menu-preview.a11y.test.ts` and `customer-menu.a11y.test.ts` over that matrix
      for hierarchy closed/expanded, product detail, before/removal, Home/title target,
      selected change, missing text, clashes, warning confirmation, loading/failure and
      current/unpublished states. Keep all current a11y state cases. Assert named native
      controls and keyboard return separately from axe. Test token-painted focus/highlight
      with host overrides and reduced-motion scrolling. Do not weaken axe rules to pass.
- [ ] Before browser runs, inspect `memory_pressure` and current testing processes; take
      turns with other sessions rather than overlap a whole-workspace coverage run. Run
      `pnpm --filter @waitron/dashboard exec vitest run src/widgets/customer-menu.test.ts src/widgets/customer-menu.a11y.test.ts src/widgets/menu-preview.test.ts src/widgets/menu-preview.a11y.test.ts`
      and selected screen layout cases. Check actual Tests counts and each exit status.
- [ ] Save captures under a workspace-local ignored directory allowed by Vite, with paths
      calculated relative to each test, not an untracked `src/look` directory. Register app
      icons in the harness. LOOK at all eight EN/ES-theme-width combinations for hierarchy,
      product detail and removal/move, with customer languages and Internal represented.
      Inspect missing translation/image states and Home target too. Retain paths and measured
      widths in implementation receipts. A passing axe run or screenshot capture is not a look.
- [ ] Use `wa-wt demo waitron-feat-menu-preview-redesign` to open the real screen after
      focused checks; use the registered instance's URLs. Inspect a populated published menu,
      unpublished edits, a removal and concurrent stale publication through real API. Do not
      start bare `pnpm dev`. If no stack slot is available, retain browser-harness/API evidence
      and state the real-stack check as an outstanding limitation, not completed verification.
- [ ] Update design-system with Preview panes, detail inspection, fallback labelling,
      before/after navigation and mobile return control. Update the current W95 backlog
      outcome (add a W95 completion entry if there is still none) and W89's clash-wording
      and W88's phone-overflow follow-ups only where verification closes
      them. Update A299's note to say Preview no longer draws the staff tree; do not mark
      deletion done. No campaign edits by this writer. Parent writes test-change FYI.
- [ ] Run `git diff --check`, local dashboard build
      `pnpm --filter @waitron/dashboard build`, and focused types if investigating a boundary
      problem; normal scoped typechecks also run in the push hook. Formatting of docs needs
      explicit `pnpm exec prettier --ignore-path /dev/null --check docs/developers/design-system.md docs/backlog.md` because
      normal docs paths are ignored. Do not count an ignored check as formatting evidence.
- [ ] Parent runs `finish-branch`: initial rebase where required, one Claude run-it review
      of complete candidate, fixes with focused checks, normal push hook, current-head CI
      package coverage and job-by-job results. Keep one implementation PR; no repeating
      whole-branch review solely for a later rebase. Recheck shared W69/lane edits when rebasing.
      Announce readiness for `finish-branch` when branch validation is complete, or report its
      result if already running. This planning writer commits/pushes/lands nothing.

## Acceptance map and self-review

| Queue W95 check                                                                           | Implementation and meaningful evidence                                                       |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Rename obsolete clash price label                                                         | T4 native rendered EN/ES wording, no old column label.                                       |
| Two panes; state/action/warnings/clashes; phone return                                    | T4 composition, T6 rectangles/overflow and rendered look at 390/1280.                        |
| Faithful hierarchy, thumbnails, details, prices, descriptions, declarations               | T2/T3 exact frozen rendered values; T5 working-data divergence control.                      |
| Variants/modifier choices/limits/effective prices                                         | T3 native controls, distinct prices/list caps, no request/document mutation.                 |
| Internal and every enabled customer language; explicit missing translations               | T2 provenance and T3/T4 display/field targets, independent interface locale.                 |
| Reusable renderer/contract; no invented online site                                       | T1/T2 browser-safe contract, T3 isolated renderer with injected services.                    |
| Every kind pointer/keyboard control, expand/scroll/focus/highlight                        | T1 all-16-kind target matrix, T4 actual focused destination and visible rectangle.           |
| Product fields, variants/modifiers, order/sections, included hierarchy                    | T1 exact nested IDs/languages and T4 field/occurrence choice including repeated descendants. |
| Removal before view, proposed retained, old/new positions                                 | T1 before envelope, T4 real old fields, removal labels and move place controls.              |
| Menu title/Home non-node changes                                                          | T4 frozen title/Home device and settings summary, existing Home-tab link.                    |
| Source and other affected menus remain legible                                            | T1 existing attribution checks retained, T4 rendered source/included/alsoOn copy.            |
| No navigation hash recompute; stale edit/publish refusal; displayed document matches hash | T1 hash/envelope assertions, T5 exact payload/immutable document/409/no writes/refresh.      |
| Both themes/phone/desktop, test-first, docs updated                                       | Red/green each task; T6 full EN/ES × theme × width look/axe/layout; design-system/backlog.   |
| Own complete PR after input jobs; format 3 only; protected checks                         | Parent base/overlap recheck; T1/T5 A291 acceptance retained; T6 one PR/review/CI.            |

Self-review performed against the spec, inspected source pointers and every queue bullet.
No runtime checks were run by the documentation writer. Existing content limits are recorded
in the spec and exercised rather than filled from drafts. No unresolved owner decision is
needed within this scope. Parent must remap pointers on any new base and report any concrete
gap the implementation experiments reveal before claiming completion.
