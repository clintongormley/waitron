# Localization fallback via language negotiation — design sketch

_2026-08-30 · a design note for the deferred debt item "descriptions maps are keyed inconsistently
(#167)". Not yet scheduled; this records the model so the next session starts from the conclusion, not
the argument._

## Problem

String resolution is done ad hoc in several places with divergent, and in some cases dead, fallback
logic:

- `apps/dashboard/src/i18n/t.ts` `t(key, l)` = `catalogues[l]?.[key] ?? en[key]` — exact tag, then
  straight to English; no language-subtag tier (so `es-PT` skips `es-ES` and drops to English).
- `apps/dashboard/src/i18n/t.ts` `pickLocale({en,es}, l)` — region-strips then English (a *different*
  fallback from `t()`, for the two-column entries).
- `apps/dashboard/src/i18n/localized.ts` `localizedName(map)` (#167) — chosen-full → chosen-short →
  first entry; no venue-default tier.
- `apps/server/src/receipt-ticket.ts` `lineName` / `apps/server/src/kitchen-print.ts` — `map[locale]`
  (full invoice tag) → first entry.
- `apps/dashboard/src/widgets/product-list.ts` / `recipe-screen.ts` — `map["es"]` (hardcoded short) →
  first entry.

And the stored `descriptions` maps are themselves keyed inconsistently: ~123 use the full tag
(`{ "es-ES": … }`, the invoice/receipt path), ~62 use the short subtag (`{ es: … }`, the
catalogue/product path). So no single exact-key lookup is correct.

## Two domains, one algorithm

There are two string domains, and they differ **only in their terminal fallback**:

| Domain | Examples | Preference list | Terminal |
| --- | --- | --- | --- |
| **Software / UI strings** (shipped catalogues) | `t()`, `pickLocale`, nav/labels | `[chosen]` | the guaranteed **English base** (`en[key]` is always defined) |
| **Venue-entered content** (authored per-locale) | product/menu `descriptions`, receipt line names | `[chosen, venue-default]` | **any available entry** (English has no special status — the venue may never have authored it) |

Both run the **same descending-specificity negotiation**: for each preferred locale, try the exact
tag, then same-language-any-region (exact region preferred, else the venue-default region, else the
first of that language); if nothing matches any preference, use the terminal.

```
negotiate(prefs: string[], available: string[]): string | undefined
  for pref in prefs:
    if available has exact  pref            -> that
    if available has some tag whose language == language(pref)
        -> exact-region, else venue-default-region, else first-of-that-language
  -> undefined   (caller supplies the terminal: English for software; first-entry for content)
```

- **Software:** `negotiate([chosen], catalogueLocales) ?? en[key]`. This gives `es-PT → es-ES → en`
  (the `es` tier is region-tolerant matching, since no catalogue is literally keyed bare `es`).
- **Content:** `negotiate([chosen, venueDefault], Object.keys(map)) ?? Object.values(map)[0] ?? ""`.
  This gives `es-PT → es-ES → venue-default → any`.

This is RFC 4647 "lookup"-style matching (the `Intl.LocaleMatcher` shape), applied uniformly.

## Two phases

1. **Chooser (once):** resolve a *requested* locale (browser/OS/URL/geography) to a *chosen* SUPPORTED
   code. Already partly present: `resolveVenueLocale` (`override → province → country → English`,
   always returns a supported code), `SUPPORTED_LOCALES`, `setLocale`/`currentLocale`.
2. **Per-string lookup (many):** the negotiation above, over the chosen code.

The phase split is what makes region weirdness harmless: an *unsupported* `es-PT` is collapsed by the
chooser (`es-PT → es → es-ES`) and never reaches phase 2. A *supported* `es-PT` (see below) flows
through as-is and matches by exact tag or by language.

## `es-PT` as a first-class supported primary — worked cases

Supporting `es-PT` as a primary language (in both domains) must work. It does:

- **Unsupported `es-PT`:** chooser → `es-ES`; phase 2 sees `es-ES`. Exact/lang match on content.
- **Supported `es-PT`:** add to `SUPPORTED_LOCALES` (+ endonym label) and ship an `es-PT` software
  catalogue; author content under `es-PT`. Chooser returns `es-PT`. Software: `es-PT → es-ES → en` per
  key. Content authored `es-PT`: exact hit; content authored only `es-ES`: language match; else
  venue-default; else any.
- **Chosen `de-DE`, content only `{es-ES, en-GB}`:** `de-DE`/`de` miss → **venue-default** (`es-ES`)
  hits → shows Spanish, not an arbitrary language. (This is the tier `localizedName` lacks today.)

## Two invariants it rests on

1. **The chosen and venue-default languages are ALWAYS chooser outputs** (normalized supported codes).
   Enforce at every `setLocale`/preference entry point, not only at boot — a stray `setLocale("es-PT")`
   from a URL param or a stored preference would leak an unnormalized tag into phase 2. (Region-tolerant
   negotiation softens this, but the invariant keeps it predictable.)
2. **The content "default language" is the presentational venue default — NOT fiscal `invoiceLocales`.**
   `invoiceLocales` is an *ordered, fiscally-significant, per-sale-snapshotted* value
   (`packages/db/src/schema/tenants.ts:82` — its order is what the customer's document said and must
   reproduce on a reprint/rectificativa). It must never be repurposed as a UI display preference. The
   presentational default is the venue UI locale (`resolveVenueLocale`).

## Audience wrinkle (same map, different terminal — and sometimes not "pick one")

The same `descriptions` map is resolved differently by audience:

- **Operator UI** (dashboard top-sellers): terminal = venue UI default → any.
- **Customer invoice/receipt** (`lineName`): the fiscal `invoiceLocales`, which may hold **two**
  languages **both printed** on the document (spec §9 — a Barcelona venue showing Spanish + Catalan).
  So the receipt path is "render each of `invoiceLocales`, in order", not "pick one" — a different
  consumer shape from the operator UI. The negotiation primitive still serves the per-language name
  resolution within it.

## Scope when this is built

1. One shared `negotiate()` (region-tolerant, descending specificity) in `@waitron/shared` (or the
   dashboard i18n module + a server twin, since the bundle boundary forbids sharing browser/server
   freely — mirror the existing `pickLocale`).
2. Route `localizedName`, `lineName`, `product-list`, `recipe-screen`, and `t()`/`pickLocale` through
   it (software terminal = English; content terminal = any). Removes the 3–4 divergent resolvers and
   gives `t()` the missing language tier.
3. **Two coherent key conventions, bridged by the one resolver** (owner decision, 2026-08-30) — NOT one
   convention everywhere:
   - **Software UI catalogues stay keyed by the LANGUAGE subtag** (`{ en, es }` column tables in
     `apps/dashboard/src/i18n/domain.ts`, `apps/till/src/i18n/allergen-names.ts`, `strings.ts`). UI
     chrome is per-language, not per-region ("Spanish is Spanish"), so a bare-language key is correct,
     not sloppy. Region granularity there is YAGNI until a same-language-two-regions UI is ever wanted
     (`SUPPORTED_LOCALES` is two languages today). Terminal English.
   - **Venue content `descriptions` maps normalize to the full BCP-47 tag** (`es` → `es-ES`, and any
     sibling content language → its full supported tag), matching the fiscal/invoice path (already
     `es-ES`) so "any entry" is a true last resort. Consumers to convert in lockstep: `product-list.ts`
     `primaryLocale = "es"` and `recipe-screen.ts` `descriptions["es"]`, plus content test
     fixtures/seeds (no stored data to migrate — pre-production drops-and-recreates, so this is a code
     convention change). Trace every consumer before changing the keys.

   The region-tolerant resolver bridges a full-tag request to either (strip `es-ES`→`es` for a software
   field; exact/language match for content). The inconsistency #167 hit was *within* content (mixed
   `es`/`es-ES`), not the software/content split. **Timing:** do the content normalization together with
   building the shared resolver, so the two consumers are converted once (to call the resolver), not
   twice.
4. A first-class presentational **venue default UI language**, distinct from fiscal `invoiceLocales`.

None of this blocks the demo; single-locale venues are correct today via the first-entry fallback. It
matters for genuinely bilingual venues and for adding a new primary language cleanly.
