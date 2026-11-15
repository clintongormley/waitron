# A1150: Live product declarations

You should not have to publish a menu to correct an allergen. A1150 applies the owner's
27 October choice of one live product source to allergens and diet labels, recorded in
[the backlog](../../backlog.md). The exception is
[A1517 decision 6](2026-11-11-a1517-allergen-proposal.md#owner-decisions-2026-11-11): sent till
dishes and Orders history keep declarations captured at first send. This is a proposed design,
not an implementation plan or a claim of owner approval.

For example, change a burger from milk to eggs without publishing. Its menu information,
unsent basket, held dishes and next kitchen read show eggs. A burger already sent keeps milk
in the till and history; its kitchen view and newly generated kitchen ticket show eggs. Each
extra follows its own product, independently of the burger.

## Sources and readers

Resolve the chosen product's effective `allergens` and `dietaryDeclarations` through
`variant-fallback.ts`. A variant inherits only where its own declaration permits inheritance;
never substitute the parent offer for a chosen variant. Preserve `null` as unreviewed and `{}`
as reviewed with none declared. Expand dietary labels with shared `expandDietaryDeclarations`;
derive the served `diet` profile using the declaration-first convention in `asServedDiet`,
instead of a version's legacy `diet` or `dietOverride`. Keep existing filter rules.

| Reader and inspected source today | Required source |
| --- | --- |
| Till `menuOfferToTillProduct`/`sellingValuesOf`; menu filters, tiles, product information and modifier picker consume published facts | Live effective dish, chosen variant and each offered extra |
| Basket, last-added and unsent draft products retain copied selling values; held retrieval also carries context facts | Refresh declaration fields by chosen product id, including extras; preserve prices, names and choices |
| `working-order.ts` display nutrition and Orders history | Keep `readDisplayLineNutrition` and saved first-send captures for sent dishes and extras; unsent/held declarations stay live |
| Kitchen queue, `kitchen-print.ts`/`kitchen-ticket.ts`, `kitchen-allergy.ts` and `party-allergy.ts` | Keep direct current-product reads; draft allergy checks receive corrected live offers |
| Guest preview, public menu, Cloud pages and A4 paper preparation call `publicGuestMenu` with stored documents | Apply current declarations before conversion/rendering, including a paper request naming an earlier version |
| Publish warnings, document differences, navigation targets and publication status | Current declarations for warnings; declaration-free comparisons for publication changes |

The guest path needs an explicit correction: `readGuestMenu` calls `readLiveMenu`, which returns
the stored document (`menu-publication.ts:719`). `guest-menu-api.ts` passes that document, or
`readRecordedDocuments` for paper, directly to `publicGuestMenu`. Rendering fields alone does
not establish a live source. Product editors already read current declarations.

## Smallest change and refresh

Extend `readLiveRows`/`applyLiveFields` and the shared `LiveOffer`/extra contracts to overlay
declarations in batches alongside availability. Reuse that resolution for guest producers and
held retrieval rather than introducing another source. Legacy version/context fields may remain
inert data. Missing current data must never fall back to an earlier reviewed declaration.

Include effective declarations in `liveFieldsDigest`. The till already listens for product
changes and polls menu state every fifteen seconds (`menu-state-poll.ts`); `#onMenuState`
reloads offers when `liveFields` changes. Extend application of those reads to existing unsent
counter/table drafts, held lines and open information/choice views. Today's version-gated
`refreshBasket` does not refresh a same-version declaration edit. Update declarations separately
from price reconciliation, without requiring confirmation or marking a saved order edited.
Retain request-order and in-flight guards. This promises refresh after successful existing reads,
not instantaneous delivery. Guest pages refresh on regeneration/reload; Cloud retains its existing
reconciliation, and already printed paper cannot change.

Preserve A1517's first-send capture, replay, splitting and later-extra behavior. Held dishes
capture on release. Never replace a missing sent capture with current declarations.

## Publication and guidance

Exclude dish, variant and extra declaration facts from `menu-document.ts` and
`menu-navigation.ts` publication differences. Use the same declaration-free content comparison
for status, preview tokens, duplicate publication, scheduling, patches and included-menu
dependencies. Compare both sides consistently, never a projected hash against a stored full
hash. Retain full-document hashes for stored-version/cache identity and backup/export integrity
(`backup-verification.ts:126`). Preserve stale-preview refusal for publishable content. A1151
patches continue excluding declarations. A declaration-only edit leaves publication status current
and adds no change-list row.

Keep existing advisory unreviewed-dish/active-variant warnings, evaluated from current effective
declarations; `{}` does not warn. Do not broaden warning policy. Update EN/ES Products,
Modifiers and Table service guidance, preserving shared anchors: save declarations on the
product without republishing; variants inherit, extras stay separate, sent details say
“Recorded when sent”, and kitchen reads stay current. Explain reopening guest/paper previews
after declaration edits.

## Acceptance and limits

The later build must check edit-without-republish across these readers in `menu-document.test.ts`,
`menu-allergen-warnings.test.ts`, `menu-change-navigation.test.ts`, server
`menu-allergen-workflow.test.ts`, `sent-line-nutrition.test.ts`, guest-menu API tests and till
menu-filter/product-info/basket tests. Cover inheritance, null/empty, dietary-only edits,
same-version refresh and sent-versus-held behavior. No suites were run for this design.

Scope excludes migrations, compatibility layers, new tables, protocols, fiscal changes and A1517
redesign. Build against current main, then rebase around A1308 overlap. A separate plan
must precede implementation.
