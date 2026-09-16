# Units

> **2026-09-14 — the tenant column is gone.** Every `tenant_id` column, every tenant argument and
> the `WAITRON_TILL_TENANT_ID` environment variable were removed: one database holds one taxpayer,
> as the single row of `tenants`, and nothing filters by a tenant. The text below is left as the
> record of what was built at the time; anywhere it names a tenant id, a tenant predicate or that
> variable, read it as history. Spec:
> [drop-tenant-id](2026-09-14-drop-tenant-id-design.md).

Read the [shared design](2026-09-12-products-overhaul-design.md) first.

Update, 2026-09-15: a product's unit is now optional. "Each" is no longer a sellable/seeded unit —
it is the absence of a unit (shown as Each, never stored), and the seeded `each` unit was dropped.
The "such as each, grams or kilograms" wording below records the original required-unit model, not
current behaviour. See `2026-09-15-optional-product-unit-design.md`.

You choose the unit you actually sell, such as each, grams or kilograms, and set how many decimal
places a quantity may contain. A price of 24.90 per kg with a quantity of 0.250 produces a gross
line total of 6.23 using the existing money rounding. A price per gram is a separate price; choosing
g does not convert a kg price automatically.

## Your workflow

Units has its own navigation entry and searchable table showing the resolved name and precision.
Create and Edit open the same modal form. The default-language name and precision are required;
translations for other enabled languages are optional. Precision is an integer in 0–3, with help
text explaining that 0 allows whole quantities only. Reject fractions, negative numbers, blanks,
NaN and values above the supported limit at both UI and API boundaries.

Seed each (0), g (0), kg (3), mg (0), ml (0), l (3) for a new tenant. Symbols can be identical across
languages; each uses localized labels. Seeding occurs once as part of provisioning, not on every
page load. A later provisioning call neither overwrites edits nor recreates intentionally deleted
seed units. Use a durable per-tenant seeded marker if needed, and test this explicitly.

Delete asks for confirmation and is blocked if any product uses the unit, including unavailable
products. Show a localized explanation and the referencing products. Renaming and changing precision
are allowed while in use; new quantities use the new rule, existing locked quantities retain their
snapshot. Historical references must not prevent deletion when only copied values remain. If an
actual retained reference exists, refuse deletion rather than invalidating that record.

**2026-09-13 update:** the deletion flow described in the paragraph above has been superseded. There
is no confirmation step any more — Delete attempts the delete straight away, and a refusal opens a
searchable modal of the products using the unit, where they can be ticked and moved onto another unit
in one go; when none are left, the same modal deletes the unit. What is unchanged is what may be
refused and why. Current behaviour is in `apps/dashboard/src/screens/units-screen.ts`, and the
`docs/backlog.md` Units entry records it.

The product form defaults to each, offers existing units and opens this same unit form through
“Add unit”. If the seeded each was deleted, choose explicitly rather than assuming an ID or silently
recreating it. A successful nested create selects the returned unit and retains the product draft.

## Model and boundaries

Public shape: `Unit { id, name: LocalizedText, precision: number }`. Products write `unitId` and
reads expose the resolved unit object. Catalogue owns unit definitions and assignments. Enforce
tenant-consistent references; do not introduce a core-to-catalogue migration dependency.

Keep a stable internal seed key independent of the editable display name. Deletion and assignment
must serialize via referential constraints/locking so an “unused” check cannot race with a product
save. Every product save validates that the unit belongs to the same tenant. Extend configuration
transfer and content-language gap checks. Transfer seeded state as well as definitions.

Quantities and prices travel as decimal strings. Validate precision before writing, ignoring
insignificant trailing zeroes (`1.000` is valid for precision 0). Positive sale quantities remain
required; existing return/correction paths retain their own sign rules. A unit conveys precision
and display, not a conversion factor or inventory measurement dimension. Hardware weight conversion
must use an explicit known unit mapping, never infer it from an editable translated name.

At selection time freeze the unit name and precision on the order context and carry them through
park/resume, kitchen displays and receipt/reprint rendering. Do not recover historical units from
current definitions. Audit and retire each/weight switches in browser and server validation;
custom units must have the same modifier, pricing and quantity validation paths. Coordinate the
modifier gate change with the Modifiers branch; avoid competing rewrites of the order pricer.

## Acceptance

- A new tenant sees the seeds; editing/deleting a seed survives provisioning repeated on another node.
- Required default-language names and precision errors appear beside their fields and in a summary.
- kg accepts 0.125; each rejects 0.125; precision 2 rejects 1.234 without rounding it to 1.23.
- A custom unit works through create, edit, sale, park/resume, kitchen and receipt snapshots.
- Changing a unit after parking an order does not change its unit label, quantity or total.
- An unavailable product still blocks deletion; concurrent assignment/delete cannot orphan a product.
- A different tenant's unit cannot be read, edited, deleted or attached, including by a manager session.
- Default-language changes include unit names; translations survive language disable/re-enable.

No conversions, recipes, stock tracking or arbitrary precision expansion are part of this section.
