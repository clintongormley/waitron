# Content languages

## Implementation status, 2026-09-12

The `image-library` branch now stores content languages in the catalogue module and initializes
them from country/area preferences. Products, modifiers, menu sections and image metadata use the
configured default; existing translations can be edited, including sections with no offers.
Receipt-language selection remains separate. The default-change guard is implemented.

Open **Products**, then **Content languages**, for the current settings dialog. The separate
Languages page mentioned in the design below was not introduced.
[Focused test evidence](../plans/2026-09-12-image-library.md#focused-evidence-2026-09-12) records the
checks completed during development. [Final validation](../plans/2026-09-12-image-library.md#final-validation-2026-09-12)
is complete; `finish-branch` is underway.
The starting-point observations below describe the original tree, not current behaviour.

You need to add languages for products, menus, online content and image descriptions without
waiting for Waitron's interface to be translated. Configure one shared list of content languages
and choose its default. Adding a language makes translation fields available immediately; an
untranslated field displays its default-language value.

This is the prerequisite for the [image library](2026-09-12-image-library-design.md).

## Three language settings

- **Interface languages** describe the translations shipped with Waitron's buttons and screens.
  `SUPPORTED_LOCALES` currently owns these. Adding a content language does not add interface copy.
- **Content languages** are configured for the tenant and shared by products, menu content,
  modifiers, online content and the image library. They have exactly one enabled default and
  can be added at runtime.
- **Receipt languages** determine which languages appear on an invoice or receipt. They retain
  their existing ordered configuration and historical snapshots. Their selectable list remains
  independent of enabled content languages (owner decision, 2026-09-12).

## Editing and fallback

The Content languages dialog on Products shows the default and enabled languages. You can add a language,
make one the default and disable a non-default language. Use readable language names in the
picker and translation fields. The available choices must cover languages beyond the interface
catalogues, including Catalan, Galician, Basque, French, German and Italian.

Use language identifiers consistently with the existing bare-language catalogue model (`es`,
`en`, `ca`). Region-specific receipt tags remain on the receipt side of the boundary. Language
selection and supported identifier validation must share one source; do not introduce a second
hand-maintained list in each editor.

Require default-language text for required content fields. Additional translations are optional.
Resolve each field independently: requested enabled language, then configured default. Whitespace
and empty strings count as missing. Do not store fallback text as a translation: it would become
stale when you later edit the original and would falsely look translated.

Disabling a language hides it from the customer selector and ordinary editing choices but preserves
its saved translations. Re-enabling it restores those translations. The default cannot be disabled;
you must choose a replacement first. Default-change rule: refuse the switch while required
content lacks the proposed default translation, and explain that the required translations need completing. This keeps
the promised fallback available rather than silently choosing an arbitrary third language.

An online language selector offers enabled content languages. For the future online surface,
choose an enabled browser-language match or the content default. This prerequisite provides the
configuration and resolution contract; it does not create the online ordering application.

Current till and dashboard interface preferences continue to select interface copy. When displaying
content, match that preference to an enabled content language and use the configured content
default if no match or translation exists. Receipt line descriptions use the requested receipt
language and the same content default for missing product text before snapshotting the result.
An already-issued document always retains its original snapshot. Kitchen queues, the pass, retrieved
baskets and sales reports display those stored receipt-language maps, which may not contain the
current content default. For these snapshots only, try the interface language, then the current
content default, then the first nonblank stored value in sorted language-key order. Do not apply
the enabled-content-language filter to historical text or rewrite a snapshot to match new settings.

Product and modifier editors receive the site's configured content-language list, with its
default first. They must not hardcode Spanish or substitute the signed-in operator's language
for the site default (owner clarification, 2026-09-12).

## Implementation boundary and verification

Persist the tenant's content configuration in a module-owned state table. Include it in replication
and configuration transfer. Provide one browser-safe resolver shared by editors and displays, with
server-side validation of configuration and submitted translation maps. Management writes require
authorization; reads and writes carry their own tenant predicates. Live configuration refresh is
passive session activity and must preserve drafts in open editors.

Derive the initial content language from the country/area preset through the existing provisioning
path. Do not derive it from a particular operator's interface preference. Trace setup and demo seeds,
configuration import/export, product and menu editors, modifiers, till/KDS displays and the receipt
snapshot builder before changing their language selection or fallback rules.

Write failing tests for runtime addition, duplicate/unknown identifiers, removing and restoring a
language, default protection, blank translations and deterministic fallback. Include an insertion-order
control: a map with English inserted first and Spanish configured as default must display Spanish
when French is requested and missing. Prove additions beyond English/Spanish through real editor
controls and API writes. Test configuration permissions and tenant isolation as `app_user` on real
Postgres. Retain receipt snapshot assertions when threading the content default into new sales.

## Inspected starting points, 2026-09-12

- `packages/shared/src/locales.ts`: shipped interface languages.
- `packages/db/src/schema/tenants.ts:122`: location receipt-language configuration.
- `packages/country-es/src/spain.ts:201`: country pack receipt-language choices.
- `apps/dashboard/src/widgets/product-form.ts:222`: editor defaults to `["es"]`.
- `apps/dashboard/src/widgets/option-group-manager.ts:168`: modifier editor language list.
- `packages/venue-service/src/dashboard/venue-operations-screen.ts:263`: English-first name display.
- `apps/dashboard/src/i18n/localized.ts`: current first-available fallback.
- `apps/till/src/widgets/dish-format.ts`: current first-available fallback.
- `packages/catalogue/src/invoice-descriptions.ts`: catalogue-to-receipt language conversion.
- `apps/server/src/venue-locale.ts`: interface default derived at boot, distinct from receipt locale.

These observations were recorded before implementation. Later test evidence is linked in the dated
status above.
