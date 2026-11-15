# A1150: Live product declarations

You should not have to publish a menu to correct an allergen. A1150 applies the owner's
27 October choice of one live source, recorded in [the backlog](../../backlog.md).
[A1517 decision 6](2026-11-11-a1517-allergen-proposal.md#owner-decisions-2026-11-11) is the
exception: sent till dishes and Orders history keep declarations captured at first send.
This proposed design has no watcher clearance or owner approval.

Change a burger from milk to eggs without publishing: its menu information, unsent basket,
held dishes and next kitchen read show eggs. Its already-sent till/history details keep milk;
its kitchen view and newly generated ticket show eggs. Each extra follows its own product.

## Sources and readers

Resolve chosen-product `allergens`, `dietOverride` and `dietaryDeclarations` through `variant-fallback.ts`.
Keep variant inheritance, `null` unreviewed versus `{}` reviewed-empty, and each extra's own
list. Options carry no declarations. Preserve existing derivations: labels expand direct declarations;
`diet` remains `overlayDietProfile(UNDECLARED_DIET, liveDietOverride)` as in `offerLineValues`
(`operations.ts:479`). Preserve all four diet filters; changing their policy is outside A1150.

| Reader and source | Required declaration source |
| --- | --- |
| Till `api/client.ts` conversion; `menu-filter.ts`, menu-browser/product-info/modifier-picker | Live dish, chosen variant and offered extras |
| Basket/last-added, drafts and held retrieval (`working-order.ts:5276`) | Refresh declarations by chosen product id; preserve prices, names and choices |
| `line-nutrition.ts`/`order-groups.ts`: sent till/history | Keep first-send capture and display, including extras; unsent/held remain live |
| `working-order.ts` kitchen queue, kitchen-print/ticket, kitchen-allergy/party-allergy | Keep current-product reads; draft clashes get corrected offers |
| `guest-menu-api.ts:61,148,193,251`: Cloud, preview, paper and public pages | Hydrate current declarations before `publicGuestMenu`, including earlier-version paper requests |
| Publication warnings and comparisons | Current declarations for warnings; frozen menu content for differences/status |

Product editors already read current values. `listWorkingLineContexts` still returns copied
nutrition; held retrieval must instead use batched server-side effective-product resolution,
keyed by its chosen product ids even outside current offers, including unreviewed null values and
current diet/override/declarations. Reuse the live-row resolver/query pattern in `line-nutrition.ts`,
not its filtered `readLineNutrition` result. Keep pricing/name facts and stored columns. Sent displays use their dedicated capture,
never current declarations when a capture is missing. Preserve capture replay, splitting and
later-extra behavior; held dishes capture on release.

## Smallest change and refresh

Follow the existing availability seam. Extend shared `OverlayOfferField` and `freezeOffer`
(`menu-document.ts:391`) to omit `allergens`, `diet`, `dietOverride`, `dietaryDeclarations` from
new frozen dishes/variants; omit extras' `addAllergens`/`suitableFor` too. Served types require
these fields again. Extend batched `readLiveRows`/`applyLiveFields` to supply current declarations,
with no per-line reads. Guest producers need a hydrated document type: passing a frozen document
to a declaration renderer must fail typechecking. Missing live data never falls back to old labels.

Add declarations to `liveFieldsDigest`. Existing product notifications and fifteen-second
`state/menu-state-poll.ts` reads feed `#onMenuState` (`till-app.ts:6710–6751`). Refresh existing
unsent counter/table drafts, held lines and open information/choice views on successful reads.
`menu-refresh.ts:215` skips same-version lines today; update declarations separately from price
reconciliation, without confirmation or marking a saved order edited. Keep request/in-flight guards.

Guest pages refresh on regeneration/reload; paper already printed cannot change. Cloud's
`cloud.connection` job sleeps sixty seconds between passes (`cloud-worker.ts:19–20`), and calls
`onGuestMenu` after successful active-installation refresh while primary (`:41–44`);
`boot.ts:4617` wires reconciliation. Its regenerated page digest drives publication
(`cloud-guest-menu.ts:143–163`), independently of menu publication events. These are source reads,
not a delivery guarantee.

## Publication, transition and guidance

Keep the existing single full-document hash. With declarations absent from new frozen content,
status, preview tokens, schedules, patches, included-menu checks and backup integrity share it.
Remove declaration comparisons/navigation in `menu-document.ts`/`menu-navigation.ts`, their
`ProductChangeField` variants and dashboard `menu-preview.ts:99–100` labels; keep
stale-preview refusal for publishable edits. Warnings hydrate current working offers (`menu-publication.ts:532–540`), retaining
advisory unreviewed-dish/active-variant policy; `{}` never warns. A1151 patches still exclude declarations.

**Proposed transition for watcher settlement:** retain the current document format and untouched
stored versions/hashes. A retained old edition can show Changed with no listed change until ordinary
republishing omits its old fields; an old queued edition activating later can repeat this. Included-menu
‘also on’ labels can be noisy meanwhile. Current declarations overlay retained editions immediately.
No migration, second hash, compatibility layer or reset. Once active content has the new shape,
declaration edits alone leave Current and no change row. Resolve A1308 collisions on rebase.

Update EN/ES Products, Modifiers and Table service guides, retaining anchors. Products EN
`:266,494–507,526` and ES `:278,521–534,555` contain republish/published-declaration wording.
Update developer `design-system.md:7027` and `products.md:785` too. Explain saving without
republishing, inheritance, separate extras, Recorded when sent, live kitchen reads and reopening
menu/paper previews after edits. Explain transition noise and republishing menus together when
their drafts are ready; publishing still includes other staged edits and old queued editions need review.

## Acceptance and limits

The later plan names checks in menu-document/allergen-warnings/change-navigation, server
menu-allergen-workflow/sent-line-nutrition/guest-menu API and till filter/product-info/basket suites.
Check inheritance, null/empty, dietary-only edits, same-version refresh, preserved prices and sent
versus held, all four guest producers, Cloud reconciliation, unchanged full-hash verification and
the one-time transition. No suites ran for this design. No new tables, protocols, fiscal work or
A1517 redesign. A separate reviewed plan precedes implementation.
