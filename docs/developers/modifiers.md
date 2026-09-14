# Integrating modifier authoring and selections

Use the reusable definition for configuration and explicit selections for each order. The canonical
`Modifier`, `ModifierInput`, `ModifierSelection` and `ModifierSnapshot` types are exported from
`@waitron/shared`. Catalogue validates definitions and selections through `modifier-contract.ts`;
`modifiers.ts` owns transactional writes. Browser clients keep their local wire types.

## Authoring

`GET /management-api/modifiers` returns `{ modifiers: Modifier[] }`.
`POST /management-api/modifiers`, `GET /management-api/modifiers/:id` and
`PATCH /management-api/modifiers/:id` return `{ modifier: Modifier }`. POST returns 201; PATCH takes
the complete definition input. DELETE returns `{ ok: true }`. Choices have UUIDs supplied by the
editor, so an options default can name a newly added choice before its first save.

For a venue whose default content language is English:

```http
POST /management-api/modifiers
Content-Type: application/json

{
  "type": "yes-no",
  "name": { "en": "Cutlery" },
  "defaultValue": true
}
```

A yes-no modifier carries no label fields: its own name is what the till shows. The response
includes the new UUID and normalized defaults:

```json
{
  "modifier": {
    "id": "11111111-1111-4111-8111-111111111111",
    "type": "yes-no",
    "name": { "en": "Cutlery" },
    "available": true,
    "defaultValue": true
  }
}
```

Product POST/PATCH accepts ordered `modifierIds`. Product lists return the ordered IDs, including
unavailable attachments. The existing `optionGroupIds` field and group/item endpoints remain for
the combined catalogue screen, which the Products integration removes. They address the same
`option_groups` and `option_group_items`, not another definition store. The old group cap maps into
`maxTotalQuantity`. Do not send both attachment fields in one request.

`dashboard-modifier-form` in `apps/dashboard/src/widgets/modifier-form.ts` accepts `open`, `busy`,
`locales: string[]`, `value: Modifier | null` and `fieldErrors: Record<string, string>`. It emits
`wt-submit` with `{ value: ModifierInput }` and `wt-cancel` with `{}`. The screen owns the API call
and closes the editor after a successful write. A choice-level validation error — the form's own
check, or a `choices.<index>.<field>` rejection from the server — is shown as one message under the
choices table naming the choice by its current label, so a rejection never lands on a field the
manager cannot see. Every error is also listed in the form's `wt-form-error-summary`, including a
server refusal that names no field (such as `modifier.in_use`) or a field the form does not draw
an input for (such as `defaultChoiceId`, or a name in a language the form does not show), which
appears only there. The
screen's reads use the existing option-group, item and content-language live sources.

One choice is edited in `dashboard-choice-form` (`apps/dashboard/src/widgets/choice-form.ts`), a
modal inside the modifier form. It accepts `open`, `busy`, `locales`, `kind: "extras" | "options"`,
`value: ChoiceDraft | null`, validates its own fields against the server's price and quantity
limits (`packages/catalogue/src/modifier-limits.ts`), lists what is wrong in its own error summary,
and emits `wt-choice-save` with `{ value: ChoiceDraft }` or `wt-choice-cancel` with `{}`. Nothing reaches the
server until the modifier itself is saved.

Products can compose the modifier form directly and select the saved definition. The optional choice
fields `addAllergens`, `removeAllergens`, `addOrigins`, `removeOrigins`, `dietaryEffect`, and extras
`vatClass` keep existing effects and tax inheritance. The choice form renders the allergen and
dietary effects through the shared `dashboard-allergen-dietary-picker` widget
(`apps/dashboard/src/widgets/allergen-dietary-picker.ts`): added allergens are recorded as
`contains`, and there is no presence or source field in the modifier choice UI. Products can adopt
the same widget during integration.

## Ordering and stored facts

Send `modifierSelections` on each requested parent line. For the example above:

```json
{
  "menuItemId": "22222222-2222-4222-8222-222222222222",
  "quantity": "2",
  "modifierSelections": [
    { "modifierId": "11111111-1111-4111-8111-111111111111", "type": "yes-no", "value": false }
  ]
}
```

Text, options and Yes/no become structured `modifierSnapshots` on the parent. Extras also retain
selected IDs and quantities there, while their price stays in the existing child-line machinery.
Never send the legacy `options` payload alongside canonical selections. Defaults are client draft
seeds; the server does not fill in missing answers. Duplicate modifiers and duplicate extras choices
are rejected, and every quantity is validated before summing.

The resolver validates modifiers independently of the product's unit. Extras multiply by the parent
quantity through the existing decimal pricer, including fractional quantities. Units integration
must keep its quantity/precision validator alongside this modifier validation, not gate either one
on `pricingUnit === "each"`.

Held responses carry the original snapshots and explicit selections. A quantity-only update sends
`workingOrderLineId` and the same selections, preserving the original prices. Changed answers take
the normal new-selection validation path. `TabLine.descriptions` and `modifierSnapshots`, receipt
lines and kitchen lines carry stored presentation facts. Nonprice option effects join their saved
choice IDs to current allergen/dietary declarations, matching the existing live-effects policy.

## Storage and integration order

Generated core migration `0021_product_modifiers.sql` extends the existing group/item definitions
and adds JSONB snapshots to working and sale lines. No new tables or core-to-catalogue foreign keys
are added. The catalogue generation script reports no schema change. Existing table grants,
classification and configuration-transfer ordering apply; the definition/attachment and publication
operations share a tenant-scoped transaction lock.

Selections take that lock in shared mode so definition readers can coexist. Canonical and retained
group/item writers take it exclusively before reading or changing definitions. The retained
`updateOptionGroup` and `updateOptionGroupItem` operations now require the tenant ID as their
second argument; their by-ID reads and writes also use that tenant predicate.

Regenerate generated migration collisions against the integration base rather than editing the
journal or snapshots. No backfill or shared development database reset is included. Products still
owns removal of the combined editor and final composition with Units and Categories.
Existing pre-migration rows do not acquire canonical caps from their old `max_select` values;
recreate disposable pre-production catalogue data under the approved schema/reset convention.
