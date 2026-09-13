# Modifiers

Read the [shared design](2026-09-12-products-overhaul-design.md) first.

You create a modifier once and attach it to any number of products. Its type determines what you
enter at the till: a note, quantities of extras, one option, or a yes/no answer. These are reusable
definitions; the choices made for an order are saved separately.

## Your workflow

Modifiers has its own navigation entry and searchable table showing name, type and availability.
Create/Edit opens the same reusable modal that Products opens through “Add modifier”. Name and all
choice labels require the default content language and accept other enabled languages. Reordering
choices or attached modifiers is explicit and preserved.

| Type    | Configuration                                                                                                                                                     | Till behavior                                                                  |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Text    | Translated name; maximum 500 characters; optional                                                                                                                 | One free-text field, no price. Entered text is not translated.                 |
| Extras  | Ordered choices with translated names, gross price additions, availability, per-choice maximum quantity and default quantity; optional total cap; required switch | Quantity controls, with selected totals visible.                               |
| Options | Ordered translated choices, availability, optional single default                                                                                                 | Exactly one radio/select choice; selection required before adding the product. |
| Yes/no  | Translated modifier name and two translated labels, stable Boolean values, default false                                                                          | One yes/no control with an explicit value.                                     |

> **Superseded detail, 2026-09-13.** Yes/no no longer has its own two translated labels (`yesLabel`,
> `noLabel`), and an extras choice has a `preselected` flag instead of a `defaultQuantity`. See
> [`2026-09-13-modifiers-editing-rework-design.md`](2026-09-13-modifiers-editing-rework-design.md).

New modifiers default to available. Unavailable modifiers stay editable but cannot be newly
attached or selected at the till. Existing attachments remain so re-enabling does not require
reconstruction. Deactivation is explicit; product authoring shows an unavailable attached modifier.
At the till an unavailable whole modifier is omitted from new selections. A required modifier
which is itself available but has no available choices makes that product temporarily unsellable
with a clear reason; do not silently drop its required constraint.

Extras default to maximum quantity 1 and default quantity 0 per choice. Prices default to 0.00;
negative additions are rejected. A group total cap is null for unlimited, otherwise a positive
integer, and counts the sum of quantities. Required means the sum must be at least one. A
preselected quantity is an integer between zero and the choice maximum. The sum of defaults may
not exceed the group cap. A required group may start with no defaults so you actively choose.

Example: bacon +1.00, maximum 2; cheese +1.00, maximum 1; total cap 2. Bacon twice costs +2.00
and leaves no room for cheese. For two product units this adds 4.00. Additions are per selected
product unit, including fractional units; this is not a per-order fee.

Options and yes/no are unpriced in this version. A priced alternative product size belongs in
Variants. An option default is either null or one available choice from that modifier. Yes/no's
true/false identities are stable even when you translate or rename the two labels.

Setting a choice unavailable clears its default as part of the same save, visibly in the editor.
If no choices remain in an available required modifier, the editor requires correcting that
configuration or deactivating the modifier. Server validation repeats the rule. A stale till
selection never silently chooses a different default when its choice becomes unavailable.

You can delete an unused modifier with confirmation. Refuse deletion while a product, menu offer
or actual retained order reference uses it; identify the dependency and offer deactivation. Do not
delete recorded selections. Block changing the type while attached to products or menu offers;
you can detach it or create a new modifier. Editing labels, prices, defaults and limits affects new
selections, while already parked/fired lines keep their snapshots.

## Public data contract

Use a discriminated union keyed by `type: "text" | "extras" | "options" | "yes-no"`, with common
`id`, `name`, `available`. The text member has no choices. Extras has `required`,
`maxTotalQuantity: number | null`, and ordered `choices` with `id`, `name`, `priceDelta`,
`available`, `maxQuantity`, `defaultQuantity`. Options has ordered `choices` with `id`, `name`,
`available` and `defaultChoiceId: string | null`. Yes/no has `yesLabel`, `noLabel`, `defaultValue`.
Reject fields from other types instead of silently persisting contradictory configuration.

Products attach an ordered `modifierIds: string[]`. Keep stable existing group/item IDs where
practical; evolve the current option-group model instead of running two parallel systems. Storage
can retain existing names; the public contract exposes the four concepts above. New tables belong
to catalogue. The branch owns mapping or retirement of old option-group APIs and UI consumers.

Order selections are explicit:

```ts
type ModifierSelection =
  | { modifierId: string; type: "text"; text: string }
  | { modifierId: string; type: "extras"; choices: { choiceId: string; quantity: number }[] }
  | { modifierId: string; type: "options"; choiceId: string }
  | { modifierId: string; type: "yes-no"; value: boolean };
```

Defaults seed a new till draft once; the client submits the resulting choices explicitly. Background
refreshes and reopened editors must not reapply defaults over deliberate selections. The server
validates type, attachment, offered choices, availability, quantity bounds and required choices;
it reads all prices/names from authoritative configuration. Validate duplicate choice entries before
summing, so negative entries or duplicates cannot evade caps. Reject duplicate modifier entries.
Empty text becomes no selection; preserve other text literally as escaped text, never HTML.

## Menus, orders and declarations

Preserve the existing explicit menu-offer publication boundary. Only modifiers published for that
offer are selectable there; attaching a definition to a product does not silently alter an existing
menu. New menu offers may copy the product's attached modifiers and available choices as initial
publication. Menu extras may retain their explicit price overrides, with defaults subject to their
published choice set. Unpublished defaults do not reappear. Expose unsatisfiable required groups as
a configuration problem instead of quietly waiving the requirement.

Priced extras use the existing parent/child pricing machinery and quantity multiplication. Store
text, option and yes/no answers as structured presentation snapshots, with labels, stable IDs and
values, without inventing charge lines for notes. Include these selections in kitchen tickets,
receipts, parked-order editing and reprints. Different answers must not collapse into one basket
line. Text modifiers remain distinct from the existing dish note and doneness controls.

Existing modifier allergen add/remove behavior must survive this overhaul. Keep those controls in
an optional “Allergens and dietary effects” section using selected-item pickers. Products owns the
shared picker redesign and removal of source/origin authoring. Coordinate direct dietary effects
with that branch: bacon on a vegan product must not retain an unqualified vegan badge. Do not
delete the existing as-served assertions merely because recipes are deferred.

## Acceptance

- Every type can be created, translated, attached and used through the actual till and server.
- Multiple products share a definition without sharing their order selections.
- Extras enforce item and total caps, required selection and defaults on browser and server.
- Unavailable/stale choices and choices from another product/tenant/menu are rejected.
- Options select exactly one; yes/no preserves explicit false; text is escaped and bounded.
- A custom/fractional unit cannot bypass constraints; repeated extras use exact decimal pricing.
- Park, change definition/default/price, resume, pay and reprint preserve recorded selections.
- A menu's explicit choice availability and price override remain authoritative.
- Modifier dietary/allergen effects still change the as-served display correctly.
- Type changes and deletion refuse live dependencies with useful errors.
