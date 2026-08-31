# Dietary classification — contains-tags & diet-suitability labels

**Date:** 2026-08-31
**Status:** design, awaiting review
**Author:** brainstormed with the owner

## 1. Problem

Today a dish carries an **EU-14 allergen** declaration — a per-code `contains` / `may_contain` map,
attached to ingredients, rolled up the recipe to the product, overridable by hand, adjusted per
selected option, and rendered on the till / basket / expo / kitchen. See
`packages/catalogue/src/derivation.ts`, `packages/db/src/schema/recipes.ts`,
`packages/db/src/schema/catalogue.ts`, and the modifier↔allergen overlay work (#187).

We want a **second classification dimension** alongside allergens:

- **"Contains X" presence tags** — most usefully **contains-meat** and **contains-fish**.
- **Diet-suitability labels** — **vegan** and **vegetarian**, derived; **halal** and **kosher**,
  manual.

These are reputationally sensitive in the same way allergens are: a wrong "vegan" or "halal" claim
is a real problem, so the same cautious posture applies — **an unreviewed ingredient can never
produce a positive suitability claim.**

## 2. Core idea — one ingredient "origin" drives everything

Every ingredient gets a single **dietary origin** tag. From that one tag both the contains-tags and
the vegan/vegetarian labels are derived, rolled up the recipe exactly the way allergens are. This is
the recommended approach; the alternatives (two parallel systems, or fully-manual per-dish flags)
were rejected for duplicating the derivation machinery / drifting from the actual recipe.

### 2.1 The origin taxonomy

A nullable enum on `ingredients`. **NULL = not yet reviewed = pending**, contagious up the recipe,
the same load-bearing meaning `ingredients.allergens IS NULL` already has.

| origin         | vegan | vegetarian | contains-meat | contains-fish | notes                                              |
| -------------- | :---: | :--------: | :-----------: | :-----------: | -------------------------------------------------- |
| `plant`        |   ✓   |     ✓      |               |               | the only vegan-safe class                          |
| `dairy`        |   ✗   |     ✓      |               |               |                                                    |
| `egg`          |   ✗   |     ✓      |               |               |                                                    |
| `honey`        |   ✗   |     ✓      |               |               | bee products                                       |
| `meat`         |   ✗   |     ✗      |       ✓       |               | land/poultry/game                                  |
| `fish`         |   ✗   |     ✗      |               |       ✓       |                                                    |
| `shellfish`    |   ✗   |     ✗      |               |               | already flagged by crustaceans/molluscs allergens  |
| `other_animal` |   ✗   |     ✗      |               |               | gelatine, rennet, cochineal, animal fats — the "looks veggie but isn't" trap |

Each origin maps deterministically to its suitabilities, so the derivation rules are pure set
membership (§3). The enum values are English identifiers, consistent with the English allergen codes
(`gluten`, `fish`, …); user-visible labels come from i18n **values**, never these identifiers, so the
`english-only` guard is unaffected.

Why a separate enum rather than reusing allergens: the allergen map already tells us fish / shellfish
/ milk / egg, but it **cannot** tell us "meat" (not an allergen), "honey", "gelatine", or — critically
— "this ingredient is **plant**". A plant ingredient with no allergens is byte-identical in the
allergen map to an *uncategorised* one, so vegan can never be asserted from the allergen map alone.

## 3. Derivation semantics

### 3.1 Product level (from the base recipe)

Fold the recipe lines into a **presence set of origins** plus a **pending flag**:

- `originsPresent` = the set of origins of the product's reviewed ingredients.
- `pending` = true if **any** recipe-line ingredient has a NULL origin.

From `(originsPresent, pending)`, a pure function computes the **derived diet profile**:

- **contains-X** (presence, monotonic): true iff `X ∈ originsPresent`. Asserted from *known*
  presence, so `contains-meat` can be true even while the dish is diet-pending — an unreviewed
  ingredient cannot make a *present* meat disappear.
- **vegan**: `originsPresent ⊆ {plant}` **and** `pending` is false.
- **vegetarian**: `originsPresent ⊆ {plant, dairy, egg, honey}` **and** `pending` is false.
- **any `pending`** ⇒ vegan/vegetarian read **`unknown`**, never a positive claim. This is the same
  cautious posture as an unreviewed allergen forcing the product allergen-PENDING.

The diet profile is tri-state per label: `yes` / `no` / `unknown` (pending). Contains-tags are
boolean (a tag is either known-present or not-asserted).

### 3.2 Manual override & halal/kosher (product level)

A product-level **override** wins over derivation (mirrors the allergen `manual` overlay + republish
in `derivation.ts`):

- Force a derived label: `vegan`/`vegetarian` → `yes` | `no` (owner knows better than the
  derivation, e.g. a trusted supplier statement over an uncategorised ingredient).
- Add/remove a contains-tag by hand.
- **halal** and **kosher** live *only* in the override — manual `yes`/`no`/unset, **no derivation**,
  because they depend on certification and slaughter method, not on which ingredients are present.
  Unset ⇒ the label is simply absent (not shown), never inferred.

The **published diet profile** is `overlay(derivedProfile, override)` — a pure function, the diet
analogue of `republish()`.

### 3.3 As-served (per selected option)

Options carry an **origin overlay**, parallel to the allergen `add_allergens`/`remove_allergens`
overlay from #187:

- `add_origins: string[]` — origins this option introduces (`"add bacon"` → `["meat"]`).
- `remove_origins: string[]` — origins this option removes (`"no cheese"` → `["dairy"]`,
  `"vegan cheese instead"` → `["dairy"]`).

As-served origin set = `(basePublishedOrigins − removed) ∪ added`, with `pending` carried from the
base. The as-served diet profile is then recomputed from that set by the **same** §3.1 pure function.

**The safety direction is INVERTED relative to allergens — call this out in the code.** For
allergens the *safe* direction is to over-declare, so `add` always wins and `remove` only acts on a
reviewed base (`deriveAsServedAllergens`, "Cautious"). For diet *suitability* the dangerous move is a
**remove that upgrades a dish to suitable** (a false vegan). This falls out correctly from the
set-recompute **because pending ⇒ labels unknown**: a `remove_origins` over a pending base leaves the
base pending, so the recomputed labels stay `unknown` — you can never manufacture a false vegan by
removing an origin from an unreviewed dish. Adds that *downgrade* (add meat ⇒ not-vegetarian) always
apply. The subtlety is real and is exactly where a bug would hide, so it gets an explicit test
(§7) and a comment at the fold.

Removal is **coarse** (set-level), identical to the allergen remove: `remove_origins: ["dairy"]`
assumes the option removes *all* dairy from the plate. Documented, matches #187.

## 4. Data model changes

All on existing RLS tables; new columns are additive and ride the tables' existing FORCE RLS +
tenant-isolation policy + `app_user` grants, the same way #187's overlay columns rode
`option_group_items`' existing policy (design note in `catalogue.ts:200`). **A new column on a
tenant-scoped table needs no new policy; a new *table* would** (CLAUDE.md §3) — none here.

- `ingredients.dietary_origin` — new **pgEnum** `dietary_origin` (`plant`, `meat`, `fish`,
  `shellfish`, `dairy`, `egg`, `honey`, `other_animal`), nullable.
- `products.diet_derivation` — `jsonb` `{ origins: string[]; pending: boolean }`, written by
  `@waitron/recipes` (the diet analogue of `recipe_derivation`), nullable. Kept separate from
  `recipe_derivation` because allergen-pending and diet-pending are independent: an ingredient may
  have reviewed allergens but an uncategorised origin, or vice versa.
- `products.diet_override` — `jsonb` `{ vegan?: "yes"|"no"; vegetarian?: "yes"|"no"; halal?:
  "yes"|"no"; kosher?: "yes"|"no"; addContains?: string[]; removeContains?: string[] }`, nullable.
- `products.diet` — `jsonb` published profile
  `{ vegan: "yes"|"no"|"unknown"; vegetarian: "yes"|"no"|"unknown"; contains: string[]; halal?:
  "yes"|"no"; kosher?: "yes"|"no" }`, the diet analogue of the published `allergens` column, so the
  till/menu-filter read one field. Recomputed by `@waitron/catalogue` whenever derivation or override
  changes (mirrors how catalogue republishes `allergens`).
- `option_group_items.add_origins` — `jsonb` `string[]`, nullable.
- `option_group_items.remove_origins` — `jsonb` `string[]`, nullable.

**Migrations:** one `drizzle-kit generate` for the enum + additive columns. Because no new table and
no RLS change, no hand-written custom migration is required — but run
`pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` anyway (it scans every `tenant_id`
table) to confirm nothing regressed, and verify the enum type created cleanly. **No backfill**
(CLAUDE.md §3: pre-production, drop-and-recreate) — existing rows get NULL origin ⇒ diet-pending,
which is the correct honest state.

## 5. Derivation & override code (`packages/catalogue`, `packages/recipes`)

Mirror the allergen split exactly:

- `packages/catalogue/src/dietary.ts` — the taxonomy constant `DIETARY_ORIGINS`, `validateOrigin`,
  and the **pure, runtime-dependency-free** derivation leaf so the till can deep-import it (the way
  `as-served.ts` deep-imports `derivation.js`):
  - `deriveDietProfile(originsPresent, pending)` → derived profile (§3.1).
  - `overlayDietProfile(derived, override)` → published profile (§3.2).
  - `deriveAsServedDiet(basePublished, optionOverlays)` → as-served profile (§3.3), the diet twin of
    `deriveAsServedAllergens`.
- `packages/recipes/src/…` — the recipe module rolls ingredient origins into
  `products.diet_derivation` alongside the existing allergen roll-up (same walk over `recipe_lines`).
- `packages/catalogue/src/operations.ts` — republish `products.diet` when derivation/override change,
  beside the existing allergen republish.

New error codes in `packages/catalogue/src/errors.ts`, domain-named (CLAUDE.md §3 — name the concept,
not the package; grep siblings first): e.g. `diet.invalid_origin`, `diet.invalid_label`,
`diet.add_remove_conflict` (an override that both adds and removes the same contains-tag, mirroring
`allergen.add_remove_conflict`). Confirm the `diet.` prefix against sibling error-code families before
committing — codes are never renamed once shipped.

## 6. Surfaces

**In scope:**

1. **Recipe-authoring UI** — dashboard `recipe-screen`: set each ingredient's `dietary_origin`; set a
   per-dish diet override (force vegan/veg, halal/kosher, hand contains-tags). *Required for
   derivation to work at all.*
2. **Till menu filter** — extend `apps/till/src/menu-filter.ts` (currently menu-membership only) with
   diet predicates: "show vegan", "show vegetarian", "without meat", "without fish", reading the
   product's published `diet` field.
3. **Basket / expo / kitchen** — render diet/contains badges beside the allergen chips; the basket
   uses `deriveAsServedDiet` client-side (the `as-served.ts` pattern), the expo/KDS gets the
   as-served diet computed server-side and attached to the read (parallel to `AsServedAllergens` on
   the queue/expo item).

**Downstream (own sibling spec):**

- **Meat doneness** — `2026-08-31-order-line-customisation-design.md` auto-offers a doneness picker on
  any dish whose published `diet.contains` includes `meat` (the derived origin here). That spec
  *depends on* this one's meat origin + published `contains`; this spec has no reciprocal dependency.

**Deferred (named, not built):**

- **Customer-facing menu** — does not exist yet (backlog: "customer-facing browse", parked,
  downstream of recipes). Out of scope here; the published product-level `diet` field is designed so
  that a future customer-menu sub-project reads diet badges for free. Its own spec → plan → build.

## 7. Testing

- **Derivation leaf** — unit tests for `deriveDietProfile` / `overlayDietProfile` /
  `deriveAsServedDiet`, table-driven over the origin taxonomy: each origin's contribution to each
  label; `pending` withholds vegan/veg but not contains-meat; override wins; halal/kosher only from
  override. **Prove each guard by deletion** (CLAUDE.md §4).
- **The inverted-safety test (crux):** a `remove_origins` over a **pending** base must NOT produce a
  positive vegan/vegetarian; an `add_origins: ["meat"]` must downgrade regardless of pending. Include
  the substring/collision-style adversarial cases the allergen suite taught us to write.
- **Roll-up** (`@waitron/recipes`) — a product with one uncategorised ingredient is diet-pending; the
  origins set folds correctly; sits on PGlite unless it needs the deployment role (it doesn't — pick
  the lighter target and say why, CLAUDE.md §4).
- **Republish** (`@waitron/catalogue`) — `products.diet` recomputes when derivation or override
  changes.
- **RLS** — the new columns are covered by existing policies; add a focused assertion only if a new
  read path crosses tenants. Run `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` after
  the schema change (it catches a missing FORCE on any `tenant_id` table).
- **Menu filter / UI** — the till filter predicates; badge rendering + a11y on till/dashboard
  (browser-mode suites — do not run their `test:coverage` concurrently, memory-heavy).
- **English-only guard** — unaffected (identifiers are English); confirm by running the root guard.

## 8. Out of scope / non-goals

- Customer-facing menu app (deferred sub-project, §6).
- Pescatarian, gluten-free-as-a-diet, and other labels beyond vegan/vegetarian/halal/kosher — the
  model extends to them cleanly later (pescatarian = `originsPresent ⊆ {plant,dairy,egg,honey,fish,
  shellfish}`), but YAGNI for v1.
- Quantity-aware recipes / sub-recipes — diet presence is qualitative, like allergens; the existing
  flat `recipe_lines` composition is sufficient.
- Any backfill or backwards-compatibility (pre-production; CLAUDE.md §3).

## 9. Build order (for the plan)

1. Schema: `dietary_origin` enum + additive columns; migration; inmutabilidad check.
2. Derivation leaf `dietary.ts` (TDD, pure) — the taxonomy + the three functions + error codes.
3. Recipe roll-up into `diet_derivation`; catalogue republish into `diet`.
4. Server API: expose published `diet` on products; as-served diet on expo/KDS reads.
5. Till: menu-filter predicates; `as-served` diet; basket/expo/kitchen badges.
6. Dashboard `recipe-screen`: ingredient origin picker + per-dish override editor.

Each step is a task with its own tests; steps 2–3 are the fiscal/derivation core and get the most
scrutiny.
