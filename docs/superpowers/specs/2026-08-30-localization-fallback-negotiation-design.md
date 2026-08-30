# Localization fallback via language negotiation — design sketch

_2026-08-30 · a design note prompted by the #167 review (dashboard `localizedName`). Not yet scheduled;
this records the model so the next session starts from the conclusion, not the argument. The model was
worked out with the owner across several refinements; this is the settled version._

## Problem

String resolution is done ad hoc in several places with divergent — and in one case dead — fallback
logic:

- `apps/dashboard/src/i18n/t.ts` `t(key, l)` = `catalogues[l]?.[key] ?? en[key]` — exact tag, then
  straight to English; **no language-subtag tier**, so a region request (`es-ES`) that has no
  region-specific catalogue drops to English instead of the base Spanish.
- `apps/dashboard/src/i18n/t.ts` `pickLocale({en,es}, l)` — region-strips to the language then English (a
  *different* fallback from `t()`, for the two-column entries).
- `apps/dashboard/src/i18n/localized.ts` `localizedName(map)` (#167) — chosen-full → chosen-short →
  first entry. Correct today, but **no venue-default tier** (a chosen language absent from a map falls to
  an arbitrary entry, not the venue's own language).
- `apps/server/src/receipt-ticket.ts` `lineName` / `apps/server/src/kitchen-print.ts` — `map[locale]` →
  first entry.
- `apps/dashboard/src/widgets/product-list.ts` / `recipe-screen.ts` — `map["es"]` (**hardcoded** "es") →
  first entry: a non-Spanish venue's primary language is never preferred.

The stored `descriptions` maps use both `{ es: … }` and `{ es-ES: … }`. That is **not** a bug to
normalize away — under the model below the two spellings *mean different things* (a venue's primary
language vs. an explicitly-added Spain-Spanish variant).

## Two paths — same negotiation shape, keyed and terminated differently

Both paths run the **same descending-specificity walk**: exact tag → drop the region to the bare
language → terminal. There is **no lateral sibling-region jump** (`es-PT` does not detour through
`es-ES`). They differ in how strings are *keyed* and in the *terminal* (owner model, 2026-08-30):

| Path | Examples | How it is keyed | Resolution | Terminal |
| --- | --- | --- | --- | --- |
| **Software / UI chrome** | `t()`, `pickLocale`, `domain.ts`, `allergen-names.ts`, nav/labels | the bare-language catalogue IS our chosen default region: `es` ≡ es-ES, `en` ≡ en-GB. Optional partial region **overlays** (`en-US`, `es-PE`) carry only what differs and inherit the rest from the bare language | `es-PT → es → en` | the `en` source (always complete), reached for an unshipped language via the **deployment default** (e.g. en-GB) |
| **Venue-entered content** | product/menu `descriptions`, receipt line names | the venue's **primary** language is keyed by the **bare** tag (`es` = "our Spanish", whatever regional flavour they speak — a Lima venue's `es` *is* Peruvian); explicitly-added variants use full tags (`es-ES` when they add Spain-Spanish) | `chosen → bare-lang (venue primary) → venue-default → any` | **any available entry** (English has no special status — the venue may never have authored it) |

So a chosen `es-ES` looking up content keyed `{ es: … }` misses the exact tag and correctly lands on the
venue's bare-`es` primary; a venue that has *added* `{ es-ES: … }` is hit exactly. **Content keyed by the
bare language is correct — not a short-form to normalize.** #167's shipped `localizedName`
(`map[chosen] ?? map[lang] ?? first`) already does the right thing for this model; the only gap is the
missing venue-default tier and its hardcoded siblings.

The single-lookup primitive (RFC 4647 "lookup" / the `Intl.LocaleMatcher` shape):

```text
negotiate(prefs: string[], available: string[]): string | undefined
  for pref in prefs:                       # prefs already region-normalized by the chooser
    if available has exact  pref      -> that
    if available has  language(pref)  -> that          # drop the region; no lateral sibling jump
  -> undefined                               # caller supplies the terminal
```

- **Software:** `negotiate([chosen], catalogueTags) ?? en[key]`; for an unshipped language, `chosen`
  first falls to the deployment default. Gives `es-PT → es → en`.
- **Content:** `negotiate([chosen, venueDefault], Object.keys(map)) ?? Object.values(map)[0] ?? ""`.
  Gives `chosen → bare-lang → venue-default → any`.

## Two phases

1. **Chooser (once):** resolve a *requested* locale (browser / OS / URL / geography) to a *chosen*
   SUPPORTED code. Already partly present: `resolveVenueLocale` (`override → province → country →
   English`, always returns a supported code), `SUPPORTED_LOCALES` (es-ES, en-GB today),
   `setLocale`/`currentLocale`.
2. **Per-string lookup (many):** the negotiation above, over the chosen code.

The split keeps region arithmetic in phase 1, against a small fixed set of supported languages, so
phase 2 only ever sees normalized supported codes.

## Two invariants it rests on

1. **The chosen and venue-default languages are ALWAYS chooser outputs** (normalized supported codes).
   Enforce at every `setLocale`/preference entry point, not only at boot — a stray `setLocale("es-PT")`
   from a URL param or stored preference would leak an unnormalized tag into phase 2. (Region-tolerant
   negotiation softens this, but the invariant keeps it predictable.)
2. **The content "default language" is the presentational venue default — NOT fiscal `invoiceLocales`.**
   `invoiceLocales` is an *ordered, fiscally-significant, per-sale-snapshotted* value
   (`packages/db/src/schema/tenants.ts:82` — its order is what the customer's document said and must
   reproduce on a reprint/rectificativa). Never repurpose it as a UI display preference. The
   presentational default is the venue UI locale (`resolveVenueLocale`).

## Audience wrinkle (same content map, different terminal — and sometimes not "pick one")

The same `descriptions` map is resolved differently by audience:

- **Operator UI** (dashboard top-sellers): terminal = venue UI default → any.
- **Customer invoice/receipt** (`lineName`): driven by the fiscal `invoiceLocales`, which may hold **two**
  languages **both printed** on the document (spec §9 — a Barcelona venue showing Spanish + Catalan). So
  the receipt path is "render each of `invoiceLocales`, in order", not "pick one". The negotiation
  primitive still resolves each language's name within it.

## Scope when this is built

None of this blocks the demo — single-locale venues render correctly today via the first-entry fallback,
and #167's `localizedName` is already correct. It matters for genuinely bilingual venues, for a
non-Spanish venue, and for adding a new primary UI language cleanly.

1. **One shared `negotiate()`** (region-tolerant, descending specificity, no lateral jump) — in
   `@waitron/shared`, or the dashboard i18n module plus a server twin if the browser/server bundle
   boundary forbids sharing (mirror how `pickLocale` is placed).
2. **Route the resolvers through it:** `localizedName`, `lineName`, `product-list`, `recipe-screen`,
   `t()`/`pickLocale`. Software terminal = English (via deployment default); content terminal =
   venue-default → any. This removes the divergent copies and gives `t()` the missing language tier.
3. **De-hardcode the content default:** `product-list.ts` `primaryLocale = "es"` and `recipe-screen.ts`
   `descriptions["es"]` should use the **venue's configured primary language** (region-tolerant), not a
   literal `"es"`, so a non-Spanish venue works. There is **no `es → es-ES` content normalization** — the
   bare-language keys are correct.
4. **A first-class presentational venue default UI language** (half-exists via `resolveVenueLocale`),
   distinct from fiscal `invoiceLocales`, feeding both the chooser's terminal and the content
   venue-default tier.
5. **Region overlays** (`en-US`, `es-PE`) as an optional later capability: partial catalogues that
   inherit from the bare language — the negotiation already supports them, so this is additive.

## Write-side: re-key at the fiscal line — LANDED (feature B, 2026-08-30)

The read-side above is about *displaying* content. There is a separate write-side concern: a filed
line's `descriptions` must satisfy the `working_order_lines_check_locales` trigger
(`packages/db/drizzle/0004_working_orders.sql`), which requires the map keys to equal the location's
full-tag `invoice_locales` **exactly**. This is **our** receipt-completeness guard, NOT fiscal law.
Receipts (verified 2026-08-30):

- **AEAT's record carries a single `DescripcionOperacion` STRING, not a locale map.**
  `packages/verifactu/src/types.ts:149` types it `DescripcionOperacion: string`;
  `packages/verifactu/src/validate.ts:289` caps it at 500 chars;
  `packages/fiscal-verifactu/src/backend.ts:285` builds it from the sale's single
  `sale.descriptionOfOperation` (the seed value is the generic `"Venta en establecimiento"`,
  `packages/fiscal-verifactu/src/testing/seed.ts:307`). The per-line `descriptions` MAP is never
  serialized into the AEAT XML (`packages/verifactu/src/xml/serialize.ts:213` emits only the string) —
  it drives the customer RECEIPT only.
- **No AEAT language mandate for descriptions.** The AEAT developer FAQ
  (`1784456130925_FAQs-Desarrolladores.pdf`, 52 pp) contains no `idioma`/`lengua`/multi-language
  requirement for the operation description — grepped 2026-08-30 (the only two `descripci*` hits are a
  test-data note and an unrelated code-table row). Sourced from the FAQ; if a stronger receipt is
  wanted it is the Orden HAC/1177/2024 layout, not checked here.

So venues author catalogue content **bare** (`{ es: … }`), and it is **re-keyed to the location's
full-tag `invoice_locales` at the single point content enters a fiscal line**:

- **`toInvoiceLineDescriptions(catalogue, invoiceLocales)`** (`@waitron/catalogue`): for each full tag,
  region-strip to its language, take the catalogue's text for it, else graceful-fill from any entry —
  **never throws** (§5 "nothing may block a sale"), and yields exactly the `invoice_locales` keys.
- Applied in **`priceOrderLines`** (`apps/server/src/working-order.ts`), right after `priceBasket`,
  mutating each `priced.lines[i].descriptions` — which propagates to BOTH `working_order_lines` and
  `sale_lines` (the same `priced` is returned and filed). Inherited/locked paths (move/transfer,
  `priceLockedLines`) already carry full tags and are untouched.
- **Reads `locations.invoice_locales` FRESH from the DB** inside `priceOrderLines`, not the env-derived
  `cfg.invoiceLocales` (which can drift from what the trigger checks) — closing that drift **for the line
  descriptions only**. The sale HEADER's locale fields (`sales.locale`/`sales.invoice_locales`) are still
  stamped by `recordSale` from boot-time `cfg`, so a config-vs-env drift can still file a `sales` header
  inconsistent with its `sale_lines` keys. That residual write-side gap is **not** closed here (backlog
  follow-up: source the whole filed record's locale from the DB location config).
- The demo seed authors bare content (`SeedLocale = "en" | "es"`) and maps to full-tag config via
  `SEED_INVOICE_LOCALE` — content authored bare, filed full.

**Deferred follow-up:** authoring-time locale-completeness validation — today nothing requires a product
to carry every venue invoice-locale's translation, so a missing one graceful-fills (the receipt shows the
primary language in that column) rather than being caught at authoring. Graceful-fill keeps the sale
unblocked (§5); a save-time check would make the receipt genuinely complete instead.
